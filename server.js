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
            questions: [], // Will be set when game starts with a category
            selectedCategory: null, // Store the selected category
            gameState: 'waiting', // waiting, active, finished
            questionStartTime: null,
            questionTimerInterval: null,
            playerAnswers: {},
        };
        socket.join(lobbyId);
        // Send available categories to the host
        socket.emit('lobbyCreated', { lobbyId, players: lobbies[lobbyId].players, playerId: socket.id, availableCategories });
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
            // Non-hosts don't need the category list initially, but they will see the chosen one if game starts
            socket.emit('joinedLobby', { lobbyId, players: lobby.players, playerId: socket.id, gameState: lobby.gameState, selectedCategory: lobby.selectedCategory, availableCategories: lobby.players.find(p=>p.id === socket.id && p.isHost) ? availableCategories : [] });
            io.to(lobbyId).emit('playerJoined', { players: lobby.players });
            console.log(`${playerName} (${socket.id}) joined lobby ${lobbyId}`);
        } else {
            socket.emit('lobbyError', 'Lobby nicht gefunden.');
        }
    });

    socket.on('startGame', ({ lobbyId, categoryKey }) => {
        const lobby = lobbies[lobbyId];
        if (lobby && lobby.players.find(p => p.id === socket.id && p.isHost)) {
            if (lobby.players.length < 1) {
                socket.emit('lobbyError', 'Nicht genügend Spieler, um das Spiel zu starten.');
                return;
            }
            if (!categoryKey || !allQuestionSets[categoryKey]) {
                socket.emit('lobbyError', 'Ungültige Fragenkategorie ausgewählt.');
                return;
            }

            lobby.selectedCategory = categoryKey;
            lobby.questions = shuffleArray([...allQuestionSets[categoryKey]]); // Use questions from selected category
            if (!lobby.questions || lobby.questions.length === 0) {
                socket.emit('lobbyError', `Keine Fragen in der Kategorie "${categoryKey}" gefunden.`);
                // Reset to allow re-selection or error handling
                lobby.selectedCategory = null;
                lobby.questions = [];
                return;
            }

            lobby.gameState = 'active';
            lobby.currentQuestionIndex = -1;
            io.to(lobbyId).emit('gameStarted', { lobbyId, players: lobby.players, category: lobby.selectedCategory });
            console.log(`Game started in lobby ${lobbyId} with category "${lobby.selectedCategory}"`);
            sendNextQuestion(lobbyId);
        } else {
            socket.emit('lobbyError', 'Nur der Host kann das Spiel starten oder die Lobby wurde nicht gefunden.');
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
            console.error(`Error: currentQuestion is undefined in lobby ${lobbyId} at index ${lobby.currentQuestionIndex}. This should not happen.`);
            // Attempt to gracefully handle or end game for this lobby
            // For now, just prevent further errors for this answer
            socket.emit('answerResult', {
                isCorrect: false,
                correctAnswer: "Fehler: Frage nicht gefunden",
                score: player.score,
                streak: player.streak,
                pointsEarned: 0
            });
            // Consider ending the game or moving to next question if possible
            // processQuestionEnd(lobbyId); // This might be risky if state is corrupt
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
                    if (disconnectedPlayer.isHost && lobby.players.length > 0) {
                        lobby.players[0].isHost = true;
                        io.to(lobbyId).emit('hostChanged', { newHostId: lobby.players[0].id, players: lobby.players, availableCategories: availableCategories });
                    }
                    io.to(lobbyId).emit('playerLeft', { players: lobby.players, disconnectedPlayerName: disconnectedPlayer.name });

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
        if (!question) { // Safety check
            console.error(`Error: Question at index ${lobby.currentQuestionIndex} for category ${lobby.selectedCategory} is undefined.`);
            endGame(lobbyId); // End game if questions run out unexpectedly
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
        if(!currentQuestion){ // Safety check if question index is out of bounds or questions array is empty
            console.error("processQuestionEnd: currentQuestion is undefined. Lobby:", lobbyId, "Index:", lobby.currentQuestionIndex);
            // Potentially end game or skip to next if possible, but this indicates a problem.
            sendNextQuestion(lobbyId); // Try to move to next or end game
            return;
        }
        io.to(lobbyId).emit('questionOver', {
            correctAnswer: currentQuestion.answer,
            scores: lobby.players.map(p => ({ id: p.id, name: p.name, score: p.score, streak: p.streak }))
        });

        setTimeout(() => {
            sendNextQuestion(lobbyId);
        }, 4000);
    }

    function endGame(lobbyId) {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;

        lobby.gameState = 'finished';
        const finalScores = lobby.players
            .map(p => ({ name: p.name, score: p.score }))
            .sort((a, b) => b.score - a.score);

        io.to(lobbyId).emit('gameOver', { finalScores });
        console.log(`Game ended in lobby ${lobbyId}. Final scores:`, finalScores);
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
            // Questions and category remain as selected for the previous game,
            // or host can choose a new one if UI allows before starting again.
            // For simplicity, we keep the same category and re-shuffle.
            if (lobby.selectedCategory && allQuestionSets[lobby.selectedCategory]) {
                lobby.questions = shuffleArray([...allQuestionSets[lobby.selectedCategory]]);
            } else {
                // Fallback or error if category was lost
                lobby.questions = [];
                console.error(`Play Again: Category ${lobby.selectedCategory} not found for lobby ${lobbyId}`);
            }
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
                availableCategories: availableCategories, // Send categories again for host
                selectedCategory: lobby.selectedCategory // Inform about current category
            });
            console.log(`Lobby ${lobbyId} reset for a new game with category ${lobby.selectedCategory}.`);
        } else {
            socket.emit('lobbyError', 'Nur der Host kann das Spiel neu starten oder die Lobby wurde nicht gefunden.');
        }
    });

});

// Global lobbies object
let lobbies = {};

// --- Start Server ---
server.listen(PORT, () => {
    loadQuestions();
    console.log(`Quiz server running on http://localhost:${PORT}`);
    console.log(`To play, open public/index.html in your browser or navigate to the root URL.`);
    console.log(`If using Docker, it will be mapped to http://localhost:4000`);
});
