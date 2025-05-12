// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const socket = io(); // Connect to the server

    // --- DOM Elements ---
    // Lobby Connect Screen
    const lobbyConnectContainer = document.getElementById('lobby-connect-container');
    const playerNameInput = document.getElementById('player-name');
    const createLobbyBtn = document.getElementById('create-lobby-btn');
    const lobbyIdInput = document.getElementById('lobby-id-input');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const connectErrorMsg = document.getElementById('connect-error-msg');

    // Lobby Waiting Room Screen
    const lobbyWaitingRoom = document.getElementById('lobby-waiting-room');
    const displayLobbyId = document.getElementById('display-lobby-id');
    const copyLobbyIdBtn = document.getElementById('copy-lobby-id-btn');
    const playerListLobby = document.getElementById('player-list-lobby');
    const categorySelectionContainer = document.getElementById('category-selection-container');
    const categorySelect = document.getElementById('category-select');
    const chosenCategoryDisplay = document.getElementById('chosen-category-display');
    const currentCategoryText = document.getElementById('current-category-text');
    const lobbyMessage = document.getElementById('lobby-message');
    const startGameLobbyBtn = document.getElementById('start-game-lobby-btn');
    const startGameErrorMsg = document.getElementById('start-game-error-msg');

    // Quiz Game Screen
    const quizContainer = document.getElementById('quiz-container');
    const playerInfoQuiz = document.getElementById('player-info-quiz');
    const questionCounter = document.getElementById('question-counter');
    const gameCategoryDisplay = document.getElementById('game-category-display');
    const timerDisplay = document.getElementById('timer');
    const questionText = document.getElementById('question-text');
    const optionsContainer = document.getElementById('options-container');
    const feedbackText = document.getElementById('feedback-text');
    const liveScoresList = document.getElementById('live-scores-list');
    const waitingForOthersMsg = document.getElementById('waiting-for-others-msg');

    // Game Over Screen
    const gameOverContainer = document.getElementById('game-over-container');
    const finalScoresDiv = document.getElementById('final-scores');
    const playAgainHostBtn = document.getElementById('play-again-host-btn');
    const waitingForHostPlayAgainBtn = document.getElementById('waiting-for-host-play-again-btn');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');

    // Global Notification
    const globalNotification = document.getElementById('global-notification');

    // --- Game State Variables ---
    let currentLobbyId = null;
    let currentPlayerId = null;
    let currentQuestionIndex = -1;
    let isHost = false;
    let questionTimeLimit = 15;
    let currentSelectedCategoryKey = null;

    // --- Sound Effects ---
    const sounds = {
        click: new Audio('/sounds/click.mp3'),
        correctAnswer: new Audio('/sounds/correctanswer.mp3'),
        incorrectAnswer: new Audio('/sounds/incorrectanswer.mp3'),
        menuMusic: new Audio('/sounds/menumusic.mp3'),
        newQuestion: new Audio('/sounds/newquestion.mp3'),
        streak: new Audio('/sounds/streak.mp3'),
        timesUp: new Audio('/sounds/timesup.mp3'),
        playerJoined: new Audio('/sounds/lobby_player_join.mp3'),
        gameStart: new Audio('/sounds/game_start_quiz.mp3')
    };

    sounds.menuMusic.loop = true;
    sounds.menuMusic.volume = 0.3;

    function playSound(soundName) {
        const sound = sounds[soundName];
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(error => console.log(`Error playing sound ${soundName}:`, error));
        } else {
            console.warn(`Sound not found: ${soundName}`);
        }
    }

    function startMenuMusic() {
        if (sounds.menuMusic.paused) {
            sounds.menuMusic.play().catch(error => console.log("Error playing menu music:", error));
        }
    }

    function stopMenuMusic() {
        sounds.menuMusic.pause();
        sounds.menuMusic.currentTime = 0;
    }

    function showScreen(screenElement) {
        [lobbyConnectContainer, lobbyWaitingRoom, quizContainer, gameOverContainer].forEach(s => s.classList.add('hidden'));
        screenElement.classList.remove('hidden');

        if (screenElement === lobbyConnectContainer || screenElement === lobbyWaitingRoom || screenElement === gameOverContainer) {
            startMenuMusic();
        } else {
            stopMenuMusic();
        }
    }

    function displayError(element, message, duration = 3000) {
        element.textContent = message;
        setTimeout(() => { element.textContent = ''; }, duration);
    }

    function showGlobalNotification(message, type = 'error', duration = 3000) {
        globalNotification.textContent = message;
        globalNotification.className = 'fixed top-5 right-5 p-4 rounded-lg shadow-xl text-sm z-50 animate-pulse';
        if (type === 'error') globalNotification.classList.add('bg-red-500', 'text-white');
        else if (type === 'success') globalNotification.classList.add('bg-green-500', 'text-white');
        else globalNotification.classList.add('bg-sky-500', 'text-white');

        globalNotification.classList.remove('hidden');
        setTimeout(() => {
            globalNotification.classList.add('hidden');
        }, duration);
    }

    // Fixed function to populate category selector
    function populateCategorySelector(categories, selectedCategoryKey = null) {
        categorySelect.innerHTML = '';

        console.log('Populating category selector with:', categories, 'Selected:', selectedCategoryKey);

        if (!categories || categories.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "Keine Kategorien verfügbar";
            categorySelect.appendChild(option);
            categorySelect.disabled = true;
            console.warn('No categories available for dropdown');
            return;
        }

        // Add a default "Choose category" option
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Kategorie auswählen --";
        defaultOption.disabled = true;
        categorySelect.appendChild(defaultOption);

        categories.forEach(categoryKey => {
            const option = document.createElement('option');
            option.value = categoryKey;
            option.textContent = categoryKey;
            if (selectedCategoryKey && categoryKey === selectedCategoryKey) {
                option.selected = true;
            }
            categorySelect.appendChild(option);
        });

        categorySelect.disabled = false;

        // Set currentSelectedCategoryKey based on selection
        if (selectedCategoryKey && categories.includes(selectedCategoryKey)) {
            currentSelectedCategoryKey = selectedCategoryKey;
            categorySelect.value = selectedCategoryKey;
        } else {
            currentSelectedCategoryKey = null;
            categorySelect.value = "";
        }

        handleCategoryChange();
    }

    // Fixed function to handle category changes
    function handleCategoryChange() {
        if (isHost) {
            currentSelectedCategoryKey = categorySelect.value || null;

            if (currentSelectedCategoryKey) {
                chosenCategoryDisplay.classList.remove('hidden');
                currentCategoryText.textContent = currentSelectedCategoryKey;
            } else {
                chosenCategoryDisplay.classList.add('hidden');
                currentCategoryText.textContent = "";
            }

            // Update start button state
            const playerCount = playerListLobby.children.length;
            startGameLobbyBtn.disabled = !currentSelectedCategoryKey || playerCount < 1;
        }
    }

    // Fixed updatePlayerList function
    function updatePlayerList(players, hostCategories = [], currentCatFromServer = null) {
        console.log('Updating player list:', players.length, 'players, Categories:', hostCategories, 'Current cat:', currentCatFromServer);

        playerListLobby.innerHTML = '';
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-entry';
            let nameDisplay = player.name;
            if (player.id === currentPlayerId) nameDisplay += ' (Du)';
            playerDiv.innerHTML = `<span class="player-name">${nameDisplay}</span>${player.isHost ? '<span class="player-host-badge">Host</span>' : ''}`;
            playerListLobby.appendChild(playerDiv);
        });

        const me = players.find(p => p.id === currentPlayerId);
        if (me) {
            isHost = me.isHost;

            if (isHost) {
                categorySelectionContainer.classList.remove('hidden');

                if (hostCategories && hostCategories.length > 0) {
                    populateCategorySelector(hostCategories, currentCatFromServer || currentSelectedCategoryKey);
                } else {
                    console.error('Host has no categories available');
                    categorySelect.innerHTML = '<option value="">Keine Kategorien verfügbar</option>';
                    categorySelect.disabled = true;
                }

                lobbyMessage.textContent = "Du bist der Host. Wähle eine Kategorie und starte das Spiel.";
                startGameLobbyBtn.classList.remove('hidden');

                const hasCategory = categorySelect.value && categorySelect.value !== "";
                startGameLobbyBtn.disabled = players.length < 1 || !hasCategory;
            } else {
                categorySelectionContainer.classList.add('hidden');
                startGameLobbyBtn.classList.add('hidden');
                lobbyMessage.textContent = "Warte, bis der Host das Spiel startet...";

                if (currentCatFromServer) {
                    chosenCategoryDisplay.classList.remove('hidden');
                    currentCategoryText.textContent = currentCatFromServer;
                } else {
                    chosenCategoryDisplay.classList.add('hidden');
                }
            }
        }
    }

    function updateLiveScores(scoresData) {
        liveScoresList.innerHTML = '';
        const sortedScores = [...scoresData].sort((a, b) => b.score - a.score);
        sortedScores.forEach(player => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'flex justify-between items-center text-slate-200';
            let displayName = player.name;
            if (player.id === currentPlayerId) displayName += " (Du)";
            scoreDiv.innerHTML = `<span>${displayName}</span><span class="font-semibold">${player.score} <span class="text-purple-400 text-xs">(Streak: ${player.streak || 0})</span></span>`;
            liveScoresList.appendChild(scoreDiv);
        });
    }

    // --- Event Listeners for UI ---
    createLobbyBtn.addEventListener('click', () => {
        playSound('click');
        const playerName = playerNameInput.value.trim() || 'AnonSpieler';
        socket.emit('createLobby', playerName);
        createLobbyBtn.disabled = true;
        joinLobbyBtn.disabled = true;
    });

    joinLobbyBtn.addEventListener('click', () => {
        playSound('click');
        const lobbyId = lobbyIdInput.value.trim().toUpperCase();
        const playerName = playerNameInput.value.trim() || 'AnonSpieler';
        if (lobbyId) {
            socket.emit('joinLobby', { lobbyId, playerName });
            createLobbyBtn.disabled = true;
            joinLobbyBtn.disabled = true;
        } else {
            displayError(connectErrorMsg, 'Bitte gib eine Lobby ID ein.');
        }
    });

    copyLobbyIdBtn.addEventListener('click', () => {
        playSound('click');
        if (currentLobbyId) {
            navigator.clipboard.writeText(currentLobbyId)
                .then(() => showGlobalNotification(`Lobby ID ${currentLobbyId} kopiert!`, 'success', 2000))
                .catch(err => showGlobalNotification('Kopieren der ID fehlgeschlagen.', 'error', 2000));
        }
    });

    categorySelect.addEventListener('change', handleCategoryChange);

    startGameLobbyBtn.addEventListener('click', () => {
        playSound('click');
        if (isHost && currentLobbyId) {
            const selectedCategory = categorySelect.value;
            if (!selectedCategory) {
                displayError(startGameErrorMsg, "Bitte wähle eine Fragenkategorie aus.");
                return;
            }
            currentSelectedCategoryKey = selectedCategory;
            socket.emit('startGame', { lobbyId: currentLobbyId, categoryKey: selectedCategory });
            startGameLobbyBtn.disabled = true;
        }
    });

    leaveLobbyBtn.addEventListener('click', () => {
        playSound('click');
        stopMenuMusic();
        window.location.reload();
    });

    playAgainHostBtn.addEventListener('click', () => {
        playSound('click');
        if (isHost && currentLobbyId) {
            socket.emit('playAgain', currentLobbyId);
            playAgainHostBtn.disabled = true;
        }
    });

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Verbunden mit Server, ID:', socket.id);
        createLobbyBtn.disabled = false;
        joinLobbyBtn.disabled = false;
        if (!lobbyConnectContainer.classList.contains('hidden') || !lobbyWaitingRoom.classList.contains('hidden')) {
            startMenuMusic();
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Vom Server getrennt:', reason);
        showGlobalNotification('Vom Server getrennt. Versuche erneut zu verbinden...', 'error', 5000);
        stopMenuMusic();
    });

    socket.on('lobbyCreated', (data) => {
        console.log('Lobby created event received:', data);
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        displayLobbyId.textContent = currentLobbyId;
        updatePlayerList(data.players, data.availableCategories, null);
        showScreen(lobbyWaitingRoom);
        connectErrorMsg.textContent = '';
        console.log('Lobby erstellt:', data);
    });

    socket.on('joinedLobby', (data) => {
        console.log('Joined lobby event received:', data);
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        displayLobbyId.textContent = currentLobbyId;

        const me = data.players.find(p => p.id === currentPlayerId);
        const categoriesForDisplay = (me && me.isHost) ? data.availableCategories : [];

        updatePlayerList(data.players, categoriesForDisplay, data.selectedCategory);
        showScreen(lobbyWaitingRoom);
        connectErrorMsg.textContent = '';
        console.log('Lobby beigetreten:', data);
        playSound('playerJoined');

        if (data.gameState === 'active') {
            lobbyMessage.textContent = "Spiel beigetreten. Warte auf nächste Frage.";
            stopMenuMusic();
            if (data.selectedCategory) {
                gameCategoryDisplay.textContent = data.selectedCategory;
            }
        }
    });

    socket.on('lobbyError', (message) => {
        displayError(connectErrorMsg, message);
        createLobbyBtn.disabled = false;
        joinLobbyBtn.disabled = false;
        console.error('Lobby Fehler:', message);
    });

    socket.on('playerJoined', (data) => {
        console.log('Player joined event:', data);
        const currentCategories = isHost ? (categorySelect.options.length > 0 ? Array.from(categorySelect.options).map(opt => opt.value).filter(v => v !== "") : []) : [];
        updatePlayerList(data.players, currentCategories, categorySelect.value);

        if (data.players.length > 0 && data.players[data.players.length-1].id !== currentPlayerId) {
            playSound('playerJoined');
        }
        showGlobalNotification(`${data.players[data.players.length-1].name} ist der Lobby beigetreten.`, 'info', 2000);
    });

    socket.on('playerLeft', (data) => {
        console.log('Player left event:', data);
        const currentCategories = isHost ? (categorySelect.options.length > 0 ? Array.from(categorySelect.options).map(opt => opt.value).filter(v => v !== "") : []) : [];
        updatePlayerList(data.players, currentCategories, categorySelect.value);
        showGlobalNotification(`${data.disconnectedPlayerName} hat die Lobby verlassen.`, 'info', 2000);
    });

    socket.on('hostChanged', (data) => {
        console.log('Host changed event:', data);
        updatePlayerList(data.players, data.availableCategories, categorySelect.value);
        const newHost = data.players.find(p => p.id === data.newHostId);
        if (newHost) {
            showGlobalNotification(`${newHost.name} ist jetzt der Host.`, 'info', 3000);
        }
    });

    socket.on('gameStarted', (data) => {
        console.log('Spiel startet!', data);
        stopMenuMusic();
        playSound('gameStart');
        gameCategoryDisplay.textContent = data.category || "Unbekannt";
        showScreen(quizContainer);
    });

    socket.on('newQuestion', (data) => {
        playSound('newQuestion');
        currentQuestionIndex = data.questionIndex;
        questionTimeLimit = data.timeLimit;
        gameCategoryDisplay.textContent = data.category || currentSelectedCategoryKey || "Unbekannt";

        questionText.textContent = data.question;
        questionCounter.textContent = `F: ${data.questionIndex + 1}/${data.totalQuestions}`;

        const myPlayerData = quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players) : [];
        const myPlayer = myPlayerData.find(p=>p.id === currentPlayerId);

        if (myPlayer) {
            playerInfoQuiz.textContent = `${myPlayer.name} (Punkte: ${myPlayer.score || 0})`;
        } else {
            const nameFromInput = playerNameInput.value.trim() || 'Du';
            playerInfoQuiz.textContent = `${nameFromInput} (Punkte: ...)`;
        }

        optionsContainer.innerHTML = '';
        data.options.forEach(optionText => {
            const button = document.createElement('button');
            button.textContent = optionText;
            button.classList.add('option-btn');
            button.addEventListener('click', () => {
                playSound('click');
                optionsContainer.querySelectorAll('.option-btn').forEach(btn => {
                    btn.disabled = true;
                    btn.classList.remove('selected');
                });
                button.classList.add('selected');
                socket.emit('submitAnswer', {
                    lobbyId: currentLobbyId,
                    questionIndex: currentQuestionIndex,
                    answer: optionText
                });
                feedbackText.textContent = "Warte auf andere Spieler oder Timer...";
                waitingForOthersMsg.textContent = "Deine Antwort wurde übermittelt!";
            });
            optionsContainer.appendChild(button);
        });
        feedbackText.textContent = '';
        waitingForOthersMsg.textContent = '';
        timerDisplay.textContent = `${questionTimeLimit}s`;
        timerDisplay.classList.remove('text-red-500', 'text-amber-400');
        timerDisplay.classList.add('text-amber-400');
    });

    socket.on('updateScores', (playersScoreData) => {
        quizContainer.dataset.players = JSON.stringify(playersScoreData);
        playerListLobby.dataset.players = JSON.stringify(playersScoreData);

        updateLiveScores(playersScoreData);
        const me = playersScoreData.find(p => p.id === currentPlayerId);
        if (me) {
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${me.score})`;
        }
    });

    socket.on('timerUpdate', (timeLeft) => {
        timerDisplay.textContent = `${timeLeft}s`;
        if (timeLeft <= 5 && timeLeft > 0) {
            timerDisplay.classList.remove('text-amber-400');
            timerDisplay.classList.add('text-red-500');
        } else if (timeLeft === 0) {
            timerDisplay.classList.add('text-red-500');
            feedbackText.textContent = "Zeit abgelaufen!";
            waitingForOthersMsg.textContent = "Antwort wird aufgedeckt...";
            optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);
        }
    });

    socket.on('answerResult', (data) => {
        const selectedButton = Array.from(optionsContainer.querySelectorAll('.option-btn')).find(btn => btn.classList.contains('selected'));

        if (data.isCorrect) {
            playSound('correctAnswer');
            if (data.streak > 1) {
                setTimeout(() => playSound('streak'), 200);
            }
            feedbackText.textContent = `Richtig! +${data.pointsEarned} Punkte.`;
            feedbackText.className = 'text-lg font-medium text-green-400';
            if(selectedButton) selectedButton.classList.add('correct');
        } else {
            playSound('incorrectAnswer');
            feedbackText.textContent = `Falsch. Die Antwort war ${data.correctAnswer}.`;
            feedbackText.className = 'text-lg font-medium text-red-400';
            if(selectedButton) selectedButton.classList.add('incorrect-picked');
        }

        const myPlayerData = quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players) : [];
        const me = myPlayerData.find(p => p.id === currentPlayerId);
        if (me) {
            me.score = data.score;
            me.streak = data.streak;
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${me.score})`;
        }
        waitingForOthersMsg.textContent = "Warte auf Ergebnisse...";
    });

    socket.on('questionOver', (data) => {
        if (timerDisplay.textContent === "0s") {
            playSound('timesUp');
        }

        feedbackText.textContent = `Die richtige Antwort war: ${data.correctAnswer}`;
        feedbackText.className = 'text-lg font-medium text-sky-300';
        waitingForOthersMsg.textContent = "Nächste Frage kommt...";

        optionsContainer.querySelectorAll('.option-btn').forEach(btn => {
            btn.disabled = true;
            if (btn.textContent === data.correctAnswer) {
                if (!btn.classList.contains('correct')) {
                    btn.classList.add('reveal-correct');
                }
            }
        });
        updateLiveScores(data.scores);
    });

    socket.on('gameOver', (data) => {
        stopMenuMusic();
        finalScoresDiv.innerHTML = '';
        data.finalScores.forEach((player, index) => {
            const scoreEntry = document.createElement('div');
            scoreEntry.className = 'final-score-entry';
            let medal = '';
            if (index === 0) medal = '🥇 ';
            else if (index === 1) medal = '🥈 ';
            else if (index === 2) medal = '🥉 ';

            let displayName = player.name;
            const myPlayerData = quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players) : [];
            const me = myPlayerData.find(p => p.id === currentPlayerId);
            if (me && player.name === me.name) {
                displayName += " (Du)";
            }

            scoreEntry.innerHTML = `<span>${medal}${displayName}</span><span>${player.score} Pkt</span>`;
            finalScoresDiv.appendChild(scoreEntry);
        });

        if (isHost) {
            playAgainHostBtn.classList.remove('hidden');
            playAgainHostBtn.disabled = false;
            waitingForHostPlayAgainBtn.classList.add('hidden');
        } else {
            playAgainHostBtn.classList.add('hidden');
            waitingForHostPlayAgainBtn.classList.remove('hidden');
        }
        showScreen(gameOverContainer);
        startMenuMusic();
    });

    socket.on('lobbyResetForPlayAgain', (data) => {
        console.log('Lobby reset for play again:', data);
        currentLobbyId = data.lobbyId;
        updatePlayerList(data.players, data.availableCategories, data.selectedCategory);
        showScreen(lobbyWaitingRoom);
        lobbyMessage.textContent = isHost ? "Spiel zurückgesetzt. Wähle Kategorie und starte!" : "Host hat das Spiel zurückgesetzt. Warte auf Start...";
        startGameLobbyBtn.disabled = !isHost || !categorySelect.value;
        playAgainHostBtn.disabled = false;
        console.log('Lobby zurückgesetzt für neues Spiel:', data);
    });

    // Initial setup
    showScreen(lobbyConnectContainer);
    const savedPlayerName = localStorage.getItem('quizPlayerName');
    if (savedPlayerName) {
        playerNameInput.value = savedPlayerName;
    }
    playerNameInput.addEventListener('input', () => {
        localStorage.setItem('quizPlayerName', playerNameInput.value);
    });
    lobbyIdInput.addEventListener('input', () => {
        lobbyIdInput.value = lobbyIdInput.value.toUpperCase();
    });
});