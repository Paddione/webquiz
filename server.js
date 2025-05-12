// server.js
// This is the backend server for the multiplayer quiz game.
// It uses Express to serve web pages and Socket.IO for real-time communication.

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000; // Port for the server to listen on

// --- Game Configuration ---
const QUESTION_TIME_LIMIT = 15; // seconds
const BASE_POINTS_CORRECT = 100;
const TIME_BONUS_MULTIPLIER = 5; // Points per second remaining
const STREAK_BONUS = 25; // Extra points for each consecutive correct answer after the first

let allQuestionSets = {}; // To store loaded questions, categorized
let availableCategories = []; // To store the names of the categories

// --- Utility Functions ---
/**
 * Generates a unique ID for lobbies.
 * @returns {string} A 6-character alphanumeric ID.
 */
function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Loads questions from the structured JSON file.
 */
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

/**
 * Shuffles an array in place.
 * @param {Array} array - The array to shuffle.
 * @returns {Array} The shuffled array.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}


// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Socket.IO Connection Handling ---
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
            questionStartTime: null,
            questionTimerInterval: null,
            playerAnswers: {},
        };
        socket.join(lobbyId);
        socket.emit('lobbyCreated', {
            lobbyId,
            players: lobbies[lobbyId].players,
            playerId: socket.id,
            availableCategories: availableCategories // Send all available categories to the host
        });
        console.log(`Lobby ${lobbyId} created by ${playerName} (${socket.id})`);
    });

    socket.on('joinLobby', ({ lobbyId, playerName }) => {
        const lobby = lobbies[lobbyId];
        if (lobby) {
            if (lobby.gameState !== 'waiting') {
                socket.emit('lobbyError', 'Das Spiel in dieser Lobby hat bereits begonnen.');
                return;
            }
            if (lobby.players.length >= 4) {
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
                allCategoriesForLobby: availableCategories // Send all categories for UI consistency
            });
            // Notify other players
            socket.to(lobbyId).emit('playerJoined', {
                players: lobby.players,
                joinedPlayerId: socket.id,
                joinedPlayerName: newPlayer.name,
                allCategoriesForLobby: availableCategories, // Send all categories for UI consistency
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
            // Emit to all in lobby (including host for consistency, or use socket.to(lobbyId).emit(...))
            io.to(lobbyId).emit('categoryUpdatedByHost', categoryKey);
        } else {
            console.warn(`Unauthorized category selection attempt or lobby not found. Lobby: ${lobbyId}, Socket: ${socket.id}`);
        }
    });

    socket.on('startGame', ({ lobbyId, categoryKey }) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost)) {
            if (lobby.players.length < 1) {
                socket.emit('startGameError', 'Nicht genügend Spieler, um das Spiel zu starten.');
                return;
            }
            // Category should have been set by 'hostSelectedCategory' and stored in lobby.selectedCategory
            // We use categoryKey from the client as a final confirmation, but server's lobby.selectedCategory should be the truth
            if (!lobby.selectedCategory || lobby.selectedCategory !== categoryKey) {
                console.warn(`Category mismatch or not selected for lobby ${lobbyId}. Client sent: ${categoryKey}, Server has: ${lobby.selectedCategory}`);
                // Optionally re-affirm or error
                if (!lobby.selectedCategory && allQuestionSets[categoryKey]) { // If server had none, but client sent valid
                    lobby.selectedCategory = categoryKey;
                } else if (!lobby.selectedCategory) {
                    socket.emit('startGameError', 'Bitte wähle zuerst eine gültige Fragenkategorie aus.');
                    return;
                }
                // If they differ, server's current selectedCategory takes precedence
            }

            if (!allQuestionSets[lobby.selectedCategory]) {
                socket.emit('startGameError', 'Ungültige Fragenkategorie ausgewählt.');
                return;
            }

            lobby.questions = shuffleArray([...allQuestionSets[lobby.selectedCategory]]);
            if (!lobby.questions || lobby.questions.length === 0) {
                socket.emit('startGameError', `Keine Fragen in der Kategorie "${lobby.selectedCategory}" gefunden.`);
                lobby.selectedCategory = null; // Reset if category is empty
                io.to(lobbyId).emit('categoryUpdatedByHost', null); // Inform clients category is reset
                return;
            }

            lobby.gameState = 'active';
            lobby.currentQuestionIndex = -1;
            lobby.playerAnswers = {}; // Reset answers for new game
            io.to(lobbyId).emit('gameStarted', { lobbyId, players: lobby.players, category: lobby.selectedCategory });
            console.log(`Game started in lobby ${lobbyId} with category "${lobby.selectedCategory}"`);
            sendNextQuestion(lobbyId);
        } else {
            socket.emit('startGameError', 'Nur der Host kann das Spiel starten oder die Lobby wurde nicht gefunden.');
        }
    });

    socket.on('submitAnswer', ({ lobbyId, questionIndex, answer }) => {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active' || lobby.currentQuestionIndex !== questionIndex) {
            console.log(`Invalid answer submission for lobby ${lobbyId} by ${socket.id}`);
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
            pointsEarned = BASE_POINTS_CORRECT;
            const timeRemaining = Math.max(0, QUESTION_TIME_LIMIT - timeTaken);
            pointsEarned += Math.floor(timeRemaining * TIME_BONUS_MULTIPLIER);
            if (player.streak > 1) {
                pointsEarned += (player.streak -1) * STREAK_BONUS;
            }
        } else {
            player.streak = 0;
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
        if (allAnswered) {
            clearTimeout(lobby.questionTimeout);
            clearInterval(lobby.questionTimerInterval);
            processQuestionEnd(lobbyId);
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
                    // Emit playerLeft first
                    io.to(lobbyId).emit('playerLeft', {
                        players: lobby.players,
                        disconnectedPlayerName: disconnectedPlayer.name,
                        selectedCategory: lobby.selectedCategory // Keep clients informed of current category
                    });
                    // Then emit hostChanged if it occurred
                    if (hostChanged) {
                        io.to(lobbyId).emit('hostChanged', {
                            newHostId: lobby.players[0].id,
                            players: lobby.players,
                            availableCategories: availableCategories, // Send all categories for new host
                            selectedCategory: lobby.selectedCategory
                        });
                    }

                    if (lobby.gameState === 'active' && lobby.players.every(p => p.hasAnswered)) {
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

    function sendNextQuestion(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active') return;

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
        io.to(lobbyId).emit('newQuestion', questionData);
        io.to(lobbyId).emit('updateScores', lobby.players.map(p => ({id: p.id, name: p.name, score: p.score, streak: p.streak })));

        if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
        if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);

        let timeLeft = QUESTION_TIME_LIMIT;
        lobby.questionTimerInterval = setInterval(() => {
            io.to(lobbyId).emit('timerUpdate', timeLeft--);
            if (timeLeft < 0) {
                clearInterval(lobby.questionTimerInterval);
            }
        }, 1000);

        lobby.questionTimeout = setTimeout(() => {
            console.log(`Time up for question ${lobby.currentQuestionIndex} in lobby ${lobbyId}`);
            clearInterval(lobby.questionTimerInterval);
            processQuestionEnd(lobbyId);
        }, QUESTION_TIME_LIMIT * 1000);
    }

    function processQuestionEnd(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby || lobby.gameState !== 'active' || !lobby.questions || lobby.questions.length === 0) return;

        clearInterval(lobby.questionTimerInterval);
        clearTimeout(lobby.questionTimeout);
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

        setTimeout(() => {
            sendNextQuestion(lobbyId);
        }, 4000); // Time to show correct answer
    }

    function endGame(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'finished';
        const finalScores = lobby.players
            .map(p => ({ name: p.name, score: p.score, originalId: p.id })) // Add originalId for client-side self-identification
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

            // Category is reset, host needs to choose again.
            const previousCategory = lobby.selectedCategory;
            lobby.selectedCategory = null;
            lobby.questions = []; // Clear questions

            lobby.gameState = 'waiting';
            lobby.playerAnswers = {};

            if (lobby.questionTimerInterval) clearInterval(lobby.questionTimerInterval);
            if (lobby.questionTimeout) clearTimeout(lobby.questionTimeout);
            lobby.questionTimerInterval = null;
            lobby.questionTimeout = null;

            io.to(lobbyId).emit('lobbyResetForPlayAgain', {
                lobbyId: lobby.id,
                players: lobby.players,
                gameState: lobby.gameState,
                availableCategories: availableCategories, // Send all categories again
                selectedCategory: null // Explicitly null as host needs to re-select
            });
            console.log(`Lobby ${lobbyId} reset for a new game. Host needs to select category.`);
        } else {
            socket.emit('lobbyError', 'Nur der Host kann das Spiel neu starten oder die Lobby wurde nicht gefunden.');
        }
    });

});

// Global lobbies object
let lobbies = {};

// --- Start Server ---
server.listen(PORT, () => {
    loadQuestions(); // Load questions at startup
    console.log(`Quiz server running on http://localhost:${PORT}`);
    console.log(`To play, open public/index.html in your browser or navigate to the root URL.`);
    console.log(`If using Docker, it will be mapped to http://localhost:4000 (or as per your docker-compose.yml)`);
});
