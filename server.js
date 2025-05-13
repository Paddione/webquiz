// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Game Configuration ---
const QUESTION_TIME_LIMIT = 60; // seconds
const CORRECT_ANSWER_DISPLAY_DURATION = 3000; // milliseconds
const MAX_PLAYERS = 8; // NEW: Define max players

let allQuestionSets = {};
let availableCategories = [];

function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function loadQuestions() {
    try {
        const questionsPath = path.join(__dirname, 'questions.json');
        const data = fs.readFileSync(questionsPath, 'utf8');
        allQuestionSets = JSON.parse(data);
        availableCategories = Object.keys(allQuestionSets);
        if (availableCategories.length === 0) {
            console.error("No question categories found or questions.json is empty. Using fallback.");
            allQuestionSets = {
                "Fallback Fragen": [
                    { question: "Was ist 2 + 2?", options: ["3", "4", "5", "6"], answer: "4" },
                    { question: "Was ist die Hauptstadt von Frankreich?", options: ["Berlin", "Madrid", "Paris", "Rom"], answer: "Paris" }
                ]
            };
            availableCategories = Object.keys(allQuestionSets);
        }
        console.log('Question sets loaded successfully. Categories:', availableCategories.join(', '));
    } catch (error) {
        console.error('Error loading questions.json:', error);
        console.error("Using fallback questions due to error.");
        allQuestionSets = {
            "Fallback Fragen": [
                { question: "Was ist 2 + 2?", options: ["3", "4", "5", "6"], answer: "4" },
                { question: "Was ist die Hauptstadt von Frankreich?", options: ["Berlin", "Madrid", "Paris", "Rom"], answer: "Paris" }
            ]
        };
        availableCategories = Object.keys(allQuestionSets);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    socket.on('createLobby', (playerName) => {
        const lobbyId = generateLobbyId();
        lobbies[lobbyId] = {
            id: lobbyId,
            players: [{ id: socket.id, name: playerName || `Spieler ${socket.id.substring(0,4)}`, score: 0, streak: 0, isHost: true, hasAnswered: false }],
            currentQuestionIndex: -1,
            questions: [],
            selectedCategory: null,
            gameState: 'waiting',
            isPaused: false,
            remainingTimeOnPause: null,
            questionStartTime: null,
            questionTimerInterval: null,
            questionTimeout: null,
            playerAnswers: {},
        };
        socket.join(lobbyId);
        socket.emit('lobbyCreated', {
            lobbyId,
            players: lobbies[lobbyId].players,
            playerId: socket.id,
            availableCategories: availableCategories
        });
        console.log(`Lobby ${lobbyId} created by ${playerName} (${socket.id})`);
    });

    socket.on('joinLobby', ({ lobbyId, playerName }) => {
        const lobby = lobbies[lobbyId];
        if (lobby) {
            if (lobby.gameState !== 'waiting' && lobby.gameState !== 'active') {
                socket.emit('lobbyError', 'Das Spiel in dieser Lobby ist bereits beendet.');
                return;
            }
            // UPDATED: Check against MAX_PLAYERS
            if (lobby.gameState === 'active' && lobby.players.length >= MAX_PLAYERS && !lobby.players.find(p => p.id === socket.id)) {
                socket.emit('lobbyError', 'Diese Lobby ist voll und das Spiel läuft bereits.');
                return;
            }
            // UPDATED: Check against MAX_PLAYERS
            if (lobby.gameState === 'waiting' && lobby.players.length >= MAX_PLAYERS) {
                socket.emit('lobbyError', 'Diese Lobby ist voll.');
                return;
            }

            const newPlayer = { id: socket.id, name: playerName || `Spieler ${socket.id.substring(0,4)}`, score: 0, streak: 0, isHost: false, hasAnswered: false };
            lobby.players.push(newPlayer);
            socket.join(lobbyId);

            socket.emit('joinedLobby', {
                lobbyId,
                players: lobby.players,
                playerId: socket.id,
                gameState: lobby.gameState,
                selectedCategory: lobby.selectedCategory,
                allCategoriesForLobby: availableCategories,
                isPaused: lobby.isPaused,
                remainingTime: lobby.isPaused ? lobby.remainingTimeOnPause : undefined
            });
            socket.to(lobbyId).emit('playerJoined', {
                players: lobby.players,
                joinedPlayerId: socket.id,
                joinedPlayerName: newPlayer.name,
                allCategoriesForLobby: availableCategories,
                selectedCategory: lobby.selectedCategory
            });
            console.log(`${newPlayer.name} (${socket.id}) joined lobby ${lobbyId}`);
        } else {
            socket.emit('lobbyError', 'Lobby nicht gefunden.');
        }
    });

    socket.on('hostSelectedCategory', ({ lobbyId, categoryKey }) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost)) {
            lobby.selectedCategory = categoryKey;
            console.log(`Lobby ${lobbyId}: Host ${socket.id} selected category ${categoryKey}`);
            io.to(lobbyId).emit('categoryUpdatedByHost', categoryKey);
        } else {
            console.warn(`Unauthorized category selection attempt or lobby not found. Lobby: ${lobbyId}, Socket: ${socket.id}`);
        }
    });

    socket.on('startGame', ({ lobbyId, categoryKey }) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost)) {
            if (lobby.players.length < 1) { // Minimum 1 player to start (host can play alone if desired)
                socket.emit('startGameError', 'Nicht genügend Spieler, um das Spiel zu starten.');
                return;
            }
            if (!lobby.selectedCategory || lobby.selectedCategory !== categoryKey) {
                if (!lobby.selectedCategory && allQuestionSets[categoryKey]) {
                    lobby.selectedCategory = categoryKey;
                } else if (!lobby.selectedCategory) {
                    socket.emit('startGameError', 'Bitte wähle zuerst eine gültige Fragenkategorie aus.');
                    return;
                }
            }

            if (!allQuestionSets[lobby.selectedCategory]) {
                socket.emit('startGameError', 'Ungültige Fragenkategorie ausgewählt.');
                return;
            }

            lobby.questions = shuffleArray([...allQuestionSets[lobby.selectedCategory]]);
            if (!lobby.questions || lobby.questions.length === 0) {
                socket.emit('startGameError', `Keine Fragen in der Kategorie "${lobby.selectedCategory}" gefunden.`);
                lobby.selectedCategory = null;
                io.to(lobbyId).emit('categoryUpdatedByHost', null);
                return;
            }

            lobby.gameState = 'active';
            lobby.isPaused = false;
            lobby.remainingTimeOnPause = null;
            lobby.currentQuestionIndex = -1;
            lobby.playerAnswers = {};
            io.to(lobbyId).emit('gameStarted', { lobbyId, players: lobby.players, category: lobby.selectedCategory });
            console.log(`Game started in lobby ${lobbyId} with category "${lobby.selectedCategory}"`);
            sendNextQuestion(lobbyId);
        } else {
            socket.emit('startGameError', 'Nur der Host kann das Spiel starten oder die Lobby wurde nicht gefunden.');
        }
    });

    socket.on('submitAnswer', ({ lobbyId, questionIndex, answer }) => {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active' || lobby.isPaused || lobby.currentQuestionIndex !== questionIndex) {
            console.log(`Invalid answer submission for lobby ${lobbyId} by ${socket.id} (paused: ${lobby ? lobby.isPaused : 'N/A'})`);
            return;
        }

        const player = lobby.players.find(p => p.id === socket.id);
        if (!player || player.hasAnswered) {
            console.log(`Player ${socket.id} already answered or not found in lobby ${lobbyId}`);
            return;
        }

        player.hasAnswered = true;
        const timeTaken = (Date.now() - lobby.questionStartTime) / 1000;
        const currentQuestion = lobby.questions[lobby.currentQuestionIndex];

        if (!currentQuestion) {
            console.error(`Error: currentQuestion is undefined in lobby ${lobbyId} at index ${lobby.currentQuestionIndex}.`);
            socket.emit('answerResult', {
                isCorrect: false,
                correctAnswer: "Fehler: Frage nicht gefunden",
                score: player.score,
                streak: player.streak,
                pointsEarned: 0
            });
            return;
        }

        const isCorrect = currentQuestion.answer === answer;
        let pointsEarned = 0;

        if (isCorrect) {
            player.streak++;
            const timeRemaining = Math.max(0, QUESTION_TIME_LIMIT - timeTaken);
            const pointsFromTime = Math.floor(timeRemaining);

            pointsEarned = pointsFromTime * player.streak;

        } else {
            player.streak = 0;
            pointsEarned = 0;
        }
        player.score += pointsEarned;

        if (!lobby.playerAnswers[questionIndex]) {
            lobby.playerAnswers[questionIndex] = {};
        }
        lobby.playerAnswers[questionIndex][socket.id] = { answer, isCorrect, pointsEarned, timeTaken };

        socket.emit('answerResult', {
            isCorrect,
            correctAnswer: currentQuestion.answer,
            score: player.score,
            streak: player.streak,
            pointsEarned
        });

        const allAnswered = lobby.players.every(p => p.hasAnswered);
        if (allAnswered && !lobby.isPaused) {
            clearTimeout(lobby.questionTimeout);
            clearInterval(lobby.questionTimerInterval);
            processQuestionEnd(lobbyId);
        }
    });

    socket.on('hostTogglePause', ({ lobbyId }) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost) && lobby.gameState === 'active') {
            if (lobby.isPaused) {
                lobby.isPaused = false;
                io.to(lobbyId).emit('gameResumed');
                console.log(`Lobby ${lobbyId} resumed by host.`);
                if (lobby.remainingTimeOnPause !== null) {
                    const timePassedBeforePause = QUESTION_TIME_LIMIT - lobby.remainingTimeOnPause;
                    lobby.questionStartTime = Date.now() - (timePassedBeforePause * 1000);
                    startQuestionTimer(lobby, lobby.remainingTimeOnPause);
                    lobby.remainingTimeOnPause = null;
                } else {
                    console.warn(`Lobby ${lobbyId} resumed, but remainingTimeOnPause was null. Starting timer with full duration.`);
                    lobby.questionStartTime = Date.now();
                    startQuestionTimer(lobby, QUESTION_TIME_LIMIT);
                }
            } else {
                lobby.isPaused = true;
                if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
                if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);

                const elapsedTime = (Date.now() - lobby.questionStartTime) / 1000;
                lobby.remainingTimeOnPause = Math.max(0, QUESTION_TIME_LIMIT - elapsedTime);

                io.to(lobbyId).emit('gamePaused', { remainingTime: lobby.remainingTimeOnPause });
                console.log(`Lobby ${lobbyId} paused by host. Time left: ${lobby.remainingTimeOnPause}`);
            }
        } else {
            console.warn(`Host toggle pause denied for lobby ${lobbyId} by socket ${socket.id}. Conditions not met.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        for (const lobbyId in lobbies) {
            const lobby = lobbies[lobbyId];
            const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const disconnectedPlayer = lobby.players.splice(playerIndex, 1)[0];
                console.log(`Player ${disconnectedPlayer.name} removed from lobby ${lobbyId}`);

                if (lobby.players.length === 0) {
                    console.log(`Lobby ${lobbyId} is empty, deleting.`);
                    clearTimeout(lobby.questionTimeout);
                    clearInterval(lobby.questionTimerInterval);
                    delete lobbies[lobbyId];
                } else {
                    let hostChanged = false;
                    if (disconnectedPlayer.isHost && lobby.players.length > 0) {
                        lobby.players[0].isHost = true;
                        hostChanged = true;
                    }
                    io.to(lobbyId).emit('playerLeft', {
                        players: lobby.players,
                        disconnectedPlayerName: disconnectedPlayer.name,
                        disconnectedPlayerId: disconnectedPlayer.id,
                        selectedCategory: lobby.selectedCategory
                    });
                    if (hostChanged) {
                        io.to(lobbyId).emit('hostChanged', {
                            newHostId: lobby.players[0].id,
                            players: lobby.players,
                            availableCategories: availableCategories,
                            selectedCategory: lobby.selectedCategory
                        });
                    }

                    if (lobby.gameState === 'active' && !lobby.isPaused && lobby.players.every(p => p.hasAnswered)) {
                        clearTimeout(lobby.questionTimeout);
                        clearInterval(lobby.questionTimerInterval);
                        processQuestionEnd(lobbyId);
                    } else if (lobby.gameState === 'active' && lobby.players.length === 0) {
                        console.log(`Game in lobby ${lobbyId} ended due to all players disconnecting.`);
                        clearTimeout(lobby.questionTimeout);
                        clearInterval(lobby.questionTimerInterval);
                        delete lobbies[lobbyId];
                    }
                }
                break;
            }
        }
    });

    function startQuestionTimer(lobby, duration) {
        if (!lobby) {
            console.error("startQuestionTimer called with null lobby");
            return;
        }
        console.log(`[DEBUG] Starting question timer for lobby ${lobby.id} with duration ${duration}s`);
        if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
        if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);

        let timeLeft = Math.ceil(duration);
        io.to(lobby.id).emit('timerUpdate', timeLeft);

        lobby.questionTimerInterval = setInterval(() => {
            if (lobby.isPaused) {
                console.log(`[DEBUG] Timer interval skipped for lobby ${lobby.id} because game is paused.`);
                return;
            }
            timeLeft--;
            io.to(lobby.id).emit('timerUpdate', timeLeft);
            console.log(`[DEBUG] Timer update for lobby ${lobby.id}: ${timeLeft}s left`);
            if (timeLeft <= 0) {
                console.log(`[DEBUG] Timer interval clearing for lobby ${lobby.id} as timeLeft is ${timeLeft}`);
                clearInterval(lobby.questionTimerInterval);
            }
        }, 1000);

        lobby.questionTimeout = setTimeout(() => {
            if (lobby.isPaused) {
                console.log(`[DEBUG] Question timeout skipped for lobby ${lobby.id} because game is paused.`);
                return;
            }
            console.log(`Time up for question ${lobby.currentQuestionIndex} in lobby ${lobby.id}`);
            if(lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
            processQuestionEnd(lobby.id);
        }, Math.ceil(duration) * 1000);
    }

    function sendNextQuestion(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active' || lobby.isPaused) {
            console.log(`[DEBUG] sendNextQuestion for ${lobbyId} aborted. GameState: ${lobby ? lobby.gameState : 'N/A'}, Paused: ${lobby ? lobby.isPaused : 'N/A'}`);
            return;
        }

        lobby.players.forEach(p => p.hasAnswered = false);
        lobby.currentQuestionIndex++;

        if (!lobby.questions || lobby.currentQuestionIndex >= lobby.questions.length) {
            endGame(lobbyId);
            return;
        }

        const question = lobby.questions[lobby.currentQuestionIndex];
        if (!question) {
            console.error(`Error: Question at index ${lobby.currentQuestionIndex} for category ${lobby.selectedCategory} is undefined.`);
            endGame(lobbyId);
            return;
        }

        const questionData = {
            question: question.question,
            options: question.options,
            questionIndex: lobby.currentQuestionIndex,
            totalQuestions: lobby.questions.length,
            timeLimit: QUESTION_TIME_LIMIT,
            category: lobby.selectedCategory
        };

        lobby.questionStartTime = Date.now();
        lobby.remainingTimeOnPause = null;
        io.to(lobbyId).emit('newQuestion', questionData);
        io.to(lobbyId).emit('updateScores', lobby.players.map(p => ({id: p.id, name: p.name, score: p.score, streak: p.streak })));

        startQuestionTimer(lobby, QUESTION_TIME_LIMIT);
        console.log(`[DEBUG] Sent new question ${lobby.currentQuestionIndex + 1} for lobby ${lobbyId}`);
    }

    function processQuestionEnd(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active' || lobby.isPaused) {
            console.log(`[DEBUG] processQuestionEnd for ${lobbyId} aborted. GameState: ${lobby ? lobby.gameState : 'N/A'}, Paused: ${lobby ? lobby.isPaused : 'N/A'}`);
            return;
        }

        if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
        if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);
        lobby.questionTimerInterval = null;
        lobby.questionTimeout = null;

        const currentQuestion = lobby.questions[lobby.currentQuestionIndex];
        if(!currentQuestion){
            console.error("processQuestionEnd: currentQuestion is undefined. Lobby:", lobbyId, "Index:", lobby.currentQuestionIndex);
            sendNextQuestion(lobbyId);
            return;
        }
        io.to(lobbyId).emit('questionOver', {
            correctAnswer: currentQuestion.answer,
            scores: lobby.players.map(p => ({ id: p.id, name: p.name, score: p.score, streak: p.streak }))
        });
        console.log(`[DEBUG] Question ${lobby.currentQuestionIndex + 1} over for lobby ${lobbyId}. Displaying answer.`);

        setTimeout(() => {
            sendNextQuestion(lobbyId);
        }, CORRECT_ANSWER_DISPLAY_DURATION);
    }

    function endGame(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
        if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);

        lobby.gameState = 'finished';
        lobby.isPaused = false;
        const finalScores = lobby.players
            .map(p => ({ name: p.name, score: p.score, originalId: p.id }))
            .sort((a, b) => b.score - a.score);

        io.to(lobbyId).emit('gameOver', { finalScores });
        console.log(`Game ended in lobby ${lobbyId}. Final scores:`, finalScores.map(s => ({name: s.name, score: s.score})));
    }

    socket.on('playAgain', (lobbyId) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost)) {
            lobby.players.forEach(p => {
                p.score = 0;
                p.streak = 0;
                p.hasAnswered = false;
            });
            lobby.currentQuestionIndex = -1;

            lobby.selectedCategory = null;
            lobby.questions = [];

            lobby.gameState = 'waiting';
            lobby.isPaused = false;
            lobby.remainingTimeOnPause = null;
            lobby.playerAnswers = {};

            if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
            if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);
            lobby.questionTimerInterval = null;
            lobby.questionTimeout = null;

            io.to(lobbyId).emit('lobbyResetForPlayAgain', {
                lobbyId: lobby.id,
                players: lobby.players,
                gameState: lobby.gameState,
                availableCategories: availableCategories,
                selectedCategory: null
            });
            console.log(`Lobby ${lobbyId} reset for a new game. Host needs to select category.`);
        } else {
            socket.emit('lobbyError', 'Nur der Host kann das Spiel neu starten oder die Lobby wurde nicht gefunden.');
        }
    });

});

let lobbies = {};

server.listen(PORT, () => {
    loadQuestions();
    console.log(`Quiz server running on http://localhost:${PORT}`);
    console.log(`To play, open public/index.html in your browser or navigate to the root URL.`);
    console.log(`If using Docker, it will be mapped to http://localhost:4000 (or as per your docker-compose.yml)`);
});