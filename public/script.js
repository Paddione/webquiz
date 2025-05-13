// public/script.js
// This is the version from the artifact "multiplayer_quiz_js_tts_feature"
// with the title "script.js (Robust Answer Reveal & TTS Timing)"
// It uses the consolidated `speak()` function.

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const lobbyConnectContainer = document.getElementById('lobby-connect-container');
    const playerNameInput = document.getElementById('player-name');
    const createLobbyBtn = document.getElementById('create-lobby-btn');
    const lobbyIdInput = document.getElementById('lobby-id-input');
    const joinLobbyBtn = document.getElementById('join-lobby-btn');
    const connectErrorMsg = document.getElementById('connect-error-msg');

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

    const gameOverContainer = document.getElementById('game-over-container');
    const finalScoresDiv = document.getElementById('final-scores');
    const playAgainHostBtn = document.getElementById('play-again-host-btn');
    const waitingForHostPlayAgainBtn = document.getElementById('waiting-for-host-play-again-btn');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');

    const globalNotification = document.getElementById('global-notification');
    const muteBtn = document.getElementById('mute-btn');

    const hostTogglePauseBtn = document.getElementById('host-toggle-pause-btn');
    const gamePausedOverlay = document.getElementById('game-paused-overlay');
    const pauseResumeMessage = document.getElementById('pause-resume-message');

    // --- Game State Variables ---
    let currentLobbyId = null;
    let currentPlayerId = null;
    let currentQuestionIndex = -1;
    let isHost = false;
    let questionTimeLimit = 60;
    let currentSelectedCategoryKey = null;
    let allAvailableCategoriesCache = [];
    let isMuted = false;
    let isGamePaused = false;
    let wasTimedOut = false;

    // --- Speech Synthesis ---
    console.log('[DEBUG] Initializing Speech Synthesis...');
    const synth = window.speechSynthesis;
    let voices = [];
    let currentSpeechUtterance = null; // To manage the current utterance being spoken

    function populateVoices() {
        voices = synth.getVoices();
        console.log('[DEBUG] TTS Voices loaded/changed:', voices.length);
    }
    if (synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = populateVoices;
    }
    populateVoices();
    console.log('[DEBUG] Speech Synthesis initialized. Synth object:', synth);


    // --- Sound Effects ---
    const soundEffectsVolume = 0.3;
    const menuMusicVolume = 0.5;

    const sounds = {
        click: new Audio('/sounds/click.mp3'),
        correctAnswer: new Audio('/sounds/correctanswer.mp3'),
        incorrectAnswer: new Audio('/sounds/incorrectanswer.mp3'),
        menuMusic: new Audio('/sounds/menumusic.mp3'),
        streak: new Audio('/sounds/streak.mp3'),
        timesUp: new Audio('/sounds/timesup.mp3'),
        playerJoined: new Audio('/sounds/lobby_player_join.mp3'),
        gameStart: new Audio('/sounds/game_start_quiz.mp3')
    };

    sounds.menuMusic.loop = true;
    sounds.menuMusic.volume = menuMusicVolume;

    function updateMuteButtonAppearance() {
        if (muteBtn) {
            muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
            if (isMuted) {
                muteBtn.classList.remove('bg-sky-600', 'hover:bg-sky-700');
                muteBtn.classList.add('bg-red-600', 'hover:bg-red-700');
            } else {
                muteBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
                muteBtn.classList.add('bg-sky-600', 'hover:bg-sky-700');
            }
        }
    }

    // Consolidated speak function
    function speak(text, lang = 'de-DE', onEndCallback = null, isQuestion = false) {
        if (isMuted || !synth || !text) {
            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Muted, synth not available, or no text. Skipping speech.`);
            if (onEndCallback) onEndCallback();
            return;
        }

        if (synth.speaking) {
            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Cancelling previous speech.`);
            synth.cancel();
        }

        setTimeout(() => {
            currentSpeechUtterance = new SpeechSynthesisUtterance(text);
            currentSpeechUtterance.lang = lang;

            const targetVoice = voices.find(voice => voice.lang === lang && voice.name.toLowerCase().includes('german'));
            if (targetVoice) {
                currentSpeechUtterance.voice = targetVoice;
            } else {
                const defaultLangVoice = voices.find(voice => voice.lang === lang);
                if (defaultLangVoice) currentSpeechUtterance.voice = defaultLangVoice;
            }

            currentSpeechUtterance.onend = () => {
                console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Finished speaking - `, text);
                currentSpeechUtterance = null;
                if (onEndCallback) onEndCallback();
            };
            currentSpeechUtterance.onerror = (event) => {
                console.error(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Error - `, event);
                currentSpeechUtterance = null;
                if (onEndCallback) onEndCallback();
            };

            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Attempting to speak:`, text, 'with voice:', currentSpeechUtterance.voice ? currentSpeechUtterance.voice.name : 'default');
            synth.speak(currentSpeechUtterance);
        }, 100);
    }


    function toggleMute() {
        isMuted = !isMuted;
        updateMuteButtonAppearance();
        if (isMuted) {
            stopMenuMusic();
            if (synth && synth.speaking) {
                console.log('[DEBUG] TTS: Muting, cancelling speech.');
                synth.cancel();
            }
        } else {
            const currentScreenElement = [lobbyConnectContainer, lobbyWaitingRoom, gameOverContainer].find(
                s => s && !s.classList.contains('hidden')
            );
            if (currentScreenElement) {
                startMenuMusic();
            }
        }
        console.log('[DEBUG] Mute toggled. isMuted:', isMuted);
    }

    function playSound(soundName) {
        if (isMuted && soundName !== 'click') return;
        if (isMuted && soundName === 'click' && sounds[soundName]) {
            sounds[soundName].volume = soundEffectsVolume * 0.5;
            sounds[soundName].currentTime = 0;
            sounds[soundName].play().catch(error => console.log(`Error playing sound ${soundName}:`, error));
            return;
        }
        if (isMuted) return;

        const sound = sounds[soundName];
        if (sound) {
            sound.currentTime = 0;
            if (soundName !== 'menuMusic') {
                sound.volume = soundEffectsVolume;
            } else {
                sound.volume = menuMusicVolume;
            }
            sound.play().catch(error => console.log(`Error playing sound ${soundName}:`, error));
        } else {
            console.warn(`Sound not found: ${soundName}`);
        }
    }

    function startMenuMusic() {
        if (isMuted) return;
        sounds.menuMusic.volume = menuMusicVolume;
        if (sounds.menuMusic.paused) {
            sounds.menuMusic.play().catch(error => console.log("Error playing menu music:", error));
        }
    }

    function stopMenuMusic() {
        sounds.menuMusic.pause();
        sounds.menuMusic.currentTime = 0;
    }

    function showScreen(screenElement) {
        console.log('[DEBUG] showScreen called for:', screenElement ? screenElement.id : 'undefined element');

        if (synth && synth.speaking && screenElement !== quizContainer) {
            console.log('[DEBUG] TTS: Screen changed, cancelling speech.');
            synth.cancel();
        }

        [lobbyConnectContainer, lobbyWaitingRoom, quizContainer, gameOverContainer].forEach(s => {
            if(s) s.classList.add('hidden');
        });
        if (screenElement) {
            screenElement.classList.remove('hidden');
        } else {
            console.error("[DEBUG] showScreen: screenElement is null or undefined!");
            return;
        }

        if (screenElement === lobbyConnectContainer || screenElement === lobbyWaitingRoom || screenElement === gameOverContainer) {
            startMenuMusic();
        } else {
            stopMenuMusic();
        }

        if (screenElement === quizContainer) {
            if (isHost && hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.remove('hidden');
                hostTogglePauseBtn.disabled = false;
                hostTogglePauseBtn.textContent = 'Pause Spiel';
            } else if (hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.add('hidden');
            }
        } else {
            if (hostTogglePauseBtn) hostTogglePauseBtn.classList.add('hidden');
            if (gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
        }
    }

    function displayError(element, message, duration = 3000) {
        if(element) {
            element.textContent = message;
            setTimeout(() => { element.textContent = ''; }, duration);
        } else {
            console.warn("[DEBUG] displayError: element is null for message:", message);
        }
    }

    function showGlobalNotification(message, type = 'error', duration = 3000) {
        if(globalNotification) {
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
    }

    function populateCategorySelector(categories, selectedCategoryKey = null) {
        console.log('[DEBUG] populateCategorySelector - START. Categories received:', JSON.stringify(categories), 'Selected:', selectedCategoryKey);

        if (!categorySelect) {
            console.error("[DEBUG] populateCategorySelector: categorySelect element not found!");
            return;
        }

        allAvailableCategoriesCache = Array.isArray(categories) ? [...categories] : [];
        console.log('[DEBUG] populateCategorySelector - allAvailableCategoriesCache updated:', JSON.stringify(allAvailableCategoriesCache));

        categorySelect.innerHTML = '';

        if (allAvailableCategoriesCache.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "Keine Kategorien verfügbar";
            categorySelect.appendChild(option);
            categorySelect.disabled = true;
            console.warn('[DEBUG] populateCategorySelector - No categories available for dropdown (allAvailableCategoriesCache is empty).');
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
            return;
        }

        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Kategorie auswählen --";
        defaultOption.disabled = true;
        defaultOption.selected = !selectedCategoryKey;
        categorySelect.appendChild(defaultOption);
        console.log('[DEBUG] populateCategorySelector - Added default option.');

        allAvailableCategoriesCache.forEach(categoryKey => {
            const option = document.createElement('option');
            option.value = categoryKey;
            option.textContent = categoryKey;
            if (selectedCategoryKey && categoryKey === selectedCategoryKey) {
                option.selected = true;
            }
            categorySelect.appendChild(option);
        });
        console.log('[DEBUG] populateCategorySelector - Added all category options. Current HTML:', categorySelect.innerHTML);

        if (selectedCategoryKey && allAvailableCategoriesCache.includes(selectedCategoryKey)) {
            currentSelectedCategoryKey = selectedCategoryKey;
            categorySelect.value = selectedCategoryKey;
            if(currentCategoryText) currentCategoryText.textContent = selectedCategoryKey;
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
        } else {
            currentSelectedCategoryKey = null;
            categorySelect.value = "";
            if(currentCategoryText) currentCategoryText.textContent = "";
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
        }

        console.log('[DEBUG] populateCategorySelector - END. currentSelectedCategoryKey:', currentSelectedCategoryKey, 'categorySelect.value:', categorySelect.value);
    }

    function handleCategoryChange() {
        console.log('[DEBUG] handleCategoryChange - START. Current categorySelect.value:', categorySelect.value, 'isHost:', isHost);
        if (isHost) {
            currentSelectedCategoryKey = categorySelect.value || null;
            console.log('[DEBUG] handleCategoryChange - Host selected category:', currentSelectedCategoryKey);

            if (currentLobbyId) {
                socket.emit('hostSelectedCategory', { lobbyId: currentLobbyId, categoryKey: currentSelectedCategoryKey });
            } else {
                console.warn("[DEBUG] handleCategoryChange: currentLobbyId is null, cannot emit selection.");
            }

            const playerCount = playerListLobby ? playerListLobby.children.length : 0;
            if(startGameLobbyBtn) startGameLobbyBtn.disabled = !currentSelectedCategoryKey || playerCount < 1;
            console.log('[DEBUG] handleCategoryChange - Start Game Button Disabled:', startGameLobbyBtn ? startGameLobbyBtn.disabled : 'N/A');

            if (currentSelectedCategoryKey) {
                if(currentCategoryText) currentCategoryText.textContent = currentSelectedCategoryKey;
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
            } else {
                if(currentCategoryText) currentCategoryText.textContent = "";
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
            }
        } else {
            console.log('[DEBUG] handleCategoryChange - Not host, no action taken for emission.');
        }
    }

    function updatePlayerList(players, initialLobbyCategories = [], currentCatFromServer = null) {
        console.log('[DEBUG] updatePlayerList - START. Players:', players.length, 'InitialLobbyCategories:', JSON.stringify(initialLobbyCategories), 'CurrentCatFromServer:', currentCatFromServer, 'CurrentPlayerId:', currentPlayerId);

        if (!playerListLobby) {
            console.error("[DEBUG] updatePlayerList: playerListLobby element not found!");
            return;
        }
        playerListLobby.innerHTML = '';

        const me = players.find(p => p.id === currentPlayerId);
        if (me) {
            isHost = me.isHost;
            console.log('[DEBUG] updatePlayerList - Updated local isHost to:', isHost);
        } else {
            console.warn('[DEBUG] updatePlayerList - Current player not found in player list. Assuming not host.');
            isHost = false;
        }

        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-entry';
            let nameDisplay = player.name;
            if (player.id === currentPlayerId) {
                nameDisplay += ' (Du)';
                if (player.isHost) {
                    playerDiv.classList.add('current-player-highlight');
                }
            }
            playerDiv.innerHTML = `<span class="player-name">${nameDisplay}</span>${player.isHost ? '<span class="player-host-badge">Host</span>' : ''}`;
            playerListLobby.appendChild(playerDiv);
        });
        console.log('[DEBUG] updatePlayerList - Player list populated.');

        const categoriesForDropdown = (Array.isArray(initialLobbyCategories) && initialLobbyCategories.length > 0)
            ? initialLobbyCategories
            : allAvailableCategoriesCache;

        console.log('[DEBUG] updatePlayerList - categoriesForDropdown determined as:', JSON.stringify(categoriesForDropdown));

        if (categorySelectionContainer) {
            if (categoriesForDropdown && categoriesForDropdown.length > 0) {
                categorySelectionContainer.classList.remove('hidden');
                console.log('[DEBUG] updatePlayerList - Category selection container UNHIDDEN.');
                populateCategorySelector(categoriesForDropdown, currentCatFromServer || currentSelectedCategoryKey);
            } else {
                categorySelectionContainer.classList.add('hidden');
                console.log('[DEBUG] updatePlayerList - No categories to display, category selection container HIDDEN.');
            }
        } else {
            console.error("[DEBUG] updatePlayerList: categorySelectionContainer element not found!");
        }

        if (categorySelect) {
            categorySelect.disabled = !isHost;
            console.log('[DEBUG] updatePlayerList - Category select disabled state set to:', categorySelect.disabled);
        } else {
            console.error("[DEBUG] updatePlayerList: categorySelect element not found for disabling!");
        }

        if (isHost) {
            if(lobbyMessage) lobbyMessage.textContent = "Du bist der Host. Wähle eine Kategorie und starte das Spiel.";
            if(startGameLobbyBtn) {
                startGameLobbyBtn.classList.remove('hidden');
                const playerCount = playerListLobby.children.length;
                startGameLobbyBtn.disabled = !categorySelect.value || playerCount < 1;
                console.log('[DEBUG] updatePlayerList - Host UI updated. Start button unhidden. Disabled:', startGameLobbyBtn.disabled);
            }
        } else {
            if(lobbyMessage) lobbyMessage.textContent = "Warte, bis der Host das Spiel startet oder eine Kategorie wählt...";
            if(startGameLobbyBtn) startGameLobbyBtn.classList.add('hidden');

            if (currentCatFromServer) {
                if(currentCategoryText) currentCategoryText.textContent = currentCatFromServer;
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
            } else {
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
            }
            console.log('[DEBUG] updatePlayerList - Non-Host UI updated.');
        }
        console.log('[DEBUG] updatePlayerList - END.');
    }

    function updateLiveScores(scoresData) {
        if (!liveScoresList) return;
        liveScoresList.innerHTML = '';
        const sortedScores = [...scoresData].sort((a, b) => b.score - a.score);
        sortedScores.forEach(player => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'player-entry-quiz';
            if (player.id === currentPlayerId) {
                scoreDiv.classList.add('current-player-highlight');
            }

            let displayName = player.name;
            if (player.id === currentPlayerId) displayName += " (Du)";

            scoreDiv.innerHTML = `
                <span class="player-name-quiz">${displayName}</span>
                <div>
                    <span class="player-score-quiz">${player.score} Pkt</span>
                    <span class="player-streak-quiz">(Streak: ${player.streak || 0})</span>
                </div>`;
            liveScoresList.appendChild(scoreDiv);
        });
    }

    // --- Event Listeners for UI ---
    if(createLobbyBtn) createLobbyBtn.addEventListener('click', () => {
        playSound('click');
        const playerName = playerNameInput.value.trim() || 'AnonSpieler';
        socket.emit('createLobby', playerName);
        createLobbyBtn.disabled = true;
        if(joinLobbyBtn) joinLobbyBtn.disabled = true;
    });

    if(joinLobbyBtn) joinLobbyBtn.addEventListener('click', () => {
        playSound('click');
        const lobbyId = lobbyIdInput.value.trim().toUpperCase();
        const playerName = playerNameInput.value.trim() || 'AnonSpieler';
        if (lobbyId) {
            socket.emit('joinLobby', { lobbyId, playerName });
            if(createLobbyBtn) createLobbyBtn.disabled = true;
            joinLobbyBtn.disabled = true;
        } else {
            displayError(connectErrorMsg, 'Bitte gib eine Lobby ID ein.');
        }
    });

    if(copyLobbyIdBtn) copyLobbyIdBtn.addEventListener('click', () => {
        playSound('click');
        if (currentLobbyId) {
            navigator.clipboard.writeText(currentLobbyId)
                .then(() => showGlobalNotification(`Lobby ID ${currentLobbyId} kopiert!`, 'success', 2000))
                .catch(err => showGlobalNotification('Kopieren der ID fehlgeschlagen.', 'error', 2000));
        }
    });

    if(categorySelect) categorySelect.addEventListener('change', handleCategoryChange);

    if(startGameLobbyBtn) startGameLobbyBtn.addEventListener('click', () => {
        playSound('click');
        if (isHost && currentLobbyId) {
            const selectedCategoryFromDropdown = categorySelect.value;
            if (!selectedCategoryFromDropdown) {
                displayError(startGameErrorMsg, "Bitte wähle eine Fragenkategorie aus.");
                return;
            }
            console.log(`[DEBUG] startGameLobbyBtn click - Emitting startGame with category: ${currentSelectedCategoryKey} (from dropdown: ${selectedCategoryFromDropdown})`);
            socket.emit('startGame', { lobbyId: currentLobbyId, categoryKey: currentSelectedCategoryKey });
            startGameLobbyBtn.disabled = true;
        }
    });

    if(leaveLobbyBtn) leaveLobbyBtn.addEventListener('click', () => {
        playSound('click');
        stopMenuMusic();
        if (synth && synth.speaking) synth.cancel();
        window.location.reload();
    });

    if(playAgainHostBtn) playAgainHostBtn.addEventListener('click', () => {
        playSound('click');
        if (isHost && currentLobbyId) {
            socket.emit('playAgain', currentLobbyId);
            playAgainHostBtn.disabled = true;
        }
    });

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            playSound('click');
            toggleMute();
        });
    }

    function triggerHostPause() {
        if (currentLobbyId && isHost && quizContainer && !quizContainer.classList.contains('hidden')) {
            console.log('[DEBUG] Triggering hostTogglePause. isGamePaused (client-side before emit):', isGamePaused);
            socket.emit('hostTogglePause', { lobbyId: currentLobbyId });
        } else {
            console.log('[DEBUG] Conditions not met for triggering host pause.');
        }
    }

    if (hostTogglePauseBtn) {
        hostTogglePauseBtn.addEventListener('click', () => {
            playSound('click');
            triggerHostPause();
        });
    }

    document.addEventListener('keydown', (event) => {
        if ((event.code === 'Space' || event.key === ' ') &&
            isHost &&
            quizContainer && !quizContainer.classList.contains('hidden') &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {

            event.preventDefault();
            playSound('click');
            triggerHostPause();
        }
    });

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('[DEBUG] Connected to server with ID:', socket.id);
        if(createLobbyBtn) createLobbyBtn.disabled = false;
        if(joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (lobbyConnectContainer && !lobbyConnectContainer.classList.contains('hidden') ||
            lobbyWaitingRoom && !lobbyWaitingRoom.classList.contains('hidden')) {
            startMenuMusic();
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('[DEBUG] Vom Server getrennt:', reason);
        showGlobalNotification('Vom Server getrennt. Versuche erneut zu verbinden...', 'error', 5000);
        stopMenuMusic();
        if (synth && synth.speaking) synth.cancel();
        if (isGamePaused && gamePausedOverlay) {
            gamePausedOverlay.classList.add('hidden');
            isGamePaused = false;
        }
    });

    socket.on('lobbyCreated', (data) => {
        console.log('[DEBUG] lobbyCreated event received from server:', JSON.stringify(data));
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        if(displayLobbyId) displayLobbyId.textContent = currentLobbyId;

        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];
        console.log('[DEBUG] lobbyCreated - allAvailableCategoriesCache set to:', JSON.stringify(allAvailableCategoriesCache));

        updatePlayerList(data.players, allAvailableCategoriesCache, null);

        showScreen(lobbyWaitingRoom);
        if(connectErrorMsg) connectErrorMsg.textContent = '';
    });

    socket.on('joinedLobby', (data) => {
        console.log('[DEBUG] joinedLobby event received:', JSON.stringify(data));
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        if(displayLobbyId) displayLobbyId.textContent = currentLobbyId;

        allAvailableCategoriesCache = Array.isArray(data.allCategoriesForLobby) ? [...data.allCategoriesForLobby] : [];
        console.log('[DEBUG] joinedLobby - allAvailableCategoriesCache set to:', JSON.stringify(allAvailableCategoriesCache));

        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        showScreen(lobbyWaitingRoom);
        if(connectErrorMsg) connectErrorMsg.textContent = '';

        if (data.gameState === 'active') {
            if(lobbyMessage) lobbyMessage.textContent = "Spiel beigetreten. Warte auf nächste Frage.";
            stopMenuMusic();
            if (gameCategoryDisplay && data.selectedCategory) {
                gameCategoryDisplay.textContent = data.selectedCategory;
            }
            if (data.isPaused) {
                isGamePaused = true;
                if(gamePausedOverlay) gamePausedOverlay.classList.remove('hidden');
                if(pauseResumeMessage) {
                    pauseResumeMessage.textContent = isHost ?
                        "Spiel pausiert. (Leertaste zum Pausieren/Fortsetzen)" :
                        "Das Spiel ist pausiert. Warte auf den Host.";
                }
                if(hostTogglePauseBtn) {
                    hostTogglePauseBtn.textContent = 'Pause Spiel';
                    hostTogglePauseBtn.disabled = !isHost;
                }
                if(optionsContainer) optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);
            }
        }
    });

    socket.on('categoryUpdatedByHost', (categoryKey) => {
        console.log('[DEBUG] categoryUpdatedByHost received:', categoryKey);
        currentSelectedCategoryKey = categoryKey;

        if (categorySelect && categorySelect.options.length > 0) {
            categorySelect.value = categoryKey || "";
        } else if (categorySelect) {
            console.warn("[DEBUG] categoryUpdatedByHost: categorySelect has no options, cannot set value.");
        }

        if (categoryKey) {
            if(currentCategoryText) currentCategoryText.textContent = categoryKey;
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
        } else {
            if(currentCategoryText) currentCategoryText.textContent = "";
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
        }

        if (isHost && startGameLobbyBtn) {
            const playerCount = playerListLobby ? playerListLobby.children.length : 0;
            startGameLobbyBtn.disabled = !currentSelectedCategoryKey || playerCount < 1;
        }
        console.log('[DEBUG] categoryUpdatedByHost - UI updated for category:', categoryKey);
    });

    socket.on('lobbyError', (message) => {
        displayError(connectErrorMsg, message);
        if(createLobbyBtn) createLobbyBtn.disabled = false;
        if(joinLobbyBtn) joinLobbyBtn.disabled = false;
        console.error('[DEBUG] Lobby Fehler:', message);
    });

    socket.on('startGameError', (message) => {
        displayError(startGameErrorMsg, message);
        if (isHost && startGameLobbyBtn) {
            startGameLobbyBtn.disabled = false;
        }
        console.error('[DEBUG] Start Game Error:', message);
    });

    socket.on('playerJoined', (data) => {
        console.log('[DEBUG] playerJoined event received (another player):', JSON.stringify(data));
        allAvailableCategoriesCache = Array.isArray(data.allCategoriesForLobby) ? [...data.allCategoriesForLobby] : allAvailableCategoriesCache;
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);

        if (data.joinedPlayerId !== currentPlayerId) {
            playSound('playerJoined');
            showGlobalNotification(`${data.joinedPlayerName} ist der Lobby beigetreten.`, 'info', 2000);
        }
    });

    socket.on('playerLeft', (data) => {
        console.log('[DEBUG] playerLeft event received:', JSON.stringify(data));
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        showGlobalNotification(`${data.disconnectedPlayerName} hat die Lobby verlassen.`, 'info', 2000);
    });

    socket.on('hostChanged', (data) => {
        console.log('[DEBUG] hostChanged event received:', JSON.stringify(data));
        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        const newHost = data.players.find(p => p.id === data.newHostId);
        if (newHost) {
            showGlobalNotification(`${newHost.name} ist jetzt der Host.`, 'info', 3000);
        }
        if (quizContainer && !quizContainer.classList.contains('hidden')) {
            if (isHost && hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.remove('hidden');
                hostTogglePauseBtn.disabled = false;
                hostTogglePauseBtn.textContent = 'Pause Spiel';
            } else if (hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.add('hidden');
            }
        }
    });

    socket.on('gameStarted', (data) => {
        console.log('[DEBUG] gameStarted event received:', JSON.stringify(data));
        stopMenuMusic();
        playSound('gameStart');
        if(gameCategoryDisplay) gameCategoryDisplay.textContent = data.category || "Unbekannt";
        showScreen(quizContainer);
        isGamePaused = false;
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
        if(hostTogglePauseBtn) {
            hostTogglePauseBtn.textContent = 'Pause Spiel';
            hostTogglePauseBtn.disabled = !isHost;
        }
    });

    socket.on('newQuestion', (data) => {
        wasTimedOut = false;
        if (isGamePaused) {
            isGamePaused = false;
            if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
            if(hostTogglePauseBtn && isHost) {
                hostTogglePauseBtn.textContent = 'Pause Spiel';
                hostTogglePauseBtn.disabled = false;
            }
        }

        // Use the consolidated speak function for questions
        speak(data.question, 'de-DE', null, true);

        currentQuestionIndex = data.questionIndex;
        questionTimeLimit = data.timeLimit;
        if(gameCategoryDisplay) gameCategoryDisplay.textContent = data.category || currentSelectedCategoryKey || "Unbekannt";

        console.log('[DEBUG] newQuestion - Received question data:', data);
        if (questionText) {
            console.log('[DEBUG] newQuestion - questionText element found. Setting text to:', data.question);
            questionText.textContent = data.question;
        } else {
            console.error('[DEBUG] newQuestion - questionText element NOT found!');
        }

        if(questionCounter) questionCounter.textContent = `F: ${data.questionIndex + 1}/${data.totalQuestions}`;

        const myPlayerData = quizContainer && quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players) : [];
        const myPlayer = myPlayerData.find(p=>p.id === currentPlayerId);

        if (playerInfoQuiz) {
            if (myPlayer) {
                playerInfoQuiz.textContent = `${myPlayer.name} (Punkte: ${myPlayer.score || 0})`;
            } else {
                const nameFromInput = playerNameInput ? playerNameInput.value.trim() || 'Du' : 'Du';
                playerInfoQuiz.textContent = `${nameFromInput} (Punkte: ...)`;
            }
        }

        if(optionsContainer) {
            optionsContainer.innerHTML = '';
            data.options.forEach(optionText => {
                const button = document.createElement('button');
                button.textContent = optionText;
                button.className = 'option-btn';
                button.disabled = isGamePaused;
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
                    if(feedbackText) feedbackText.textContent = '';
                    if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Antwort übermittelt. Warte auf andere Spieler oder Timer...";
                });
                optionsContainer.appendChild(button);
            });
        }
        if(feedbackText) feedbackText.textContent = '';
        if(waitingForOthersMsg) waitingForOthersMsg.textContent = '';
        if(timerDisplay) {
            timerDisplay.textContent = isGamePaused ? 'Pausiert' : `${questionTimeLimit}s`;
            timerDisplay.classList.remove('text-red-500');
            if (!isGamePaused) timerDisplay.classList.add('text-amber-400');
        }
    });

    socket.on('updateScores', (playersScoreData) => {
        if(quizContainer) quizContainer.dataset.players = JSON.stringify(playersScoreData);
        updateLiveScores(playersScoreData);
        const me = playersScoreData.find(p => p.id === currentPlayerId);
        if (me && playerInfoQuiz) {
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${me.score})`;
        }
    });

    socket.on('timerUpdate', (timeLeft) => {
        if (isGamePaused) {
            if(timerDisplay) {
                timerDisplay.textContent = isHost ?
                    `Pausiert (${Math.ceil(timeLeft)}s)` :
                    `Pausiert`;
            }
            return;
        }
        if(!timerDisplay) return;
        timerDisplay.textContent = `${timeLeft}s`;
        if (timeLeft <= 5 && timeLeft > 0) {
            timerDisplay.classList.remove('text-amber-400');
            timerDisplay.classList.add('text-red-500');
        } else if (timeLeft === 0) {
            wasTimedOut = true;
            timerDisplay.classList.add('text-red-500');
            if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Zeit abgelaufen! Antwort wird aufgedeckt...";
            if(optionsContainer) optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);
        } else {
            timerDisplay.classList.remove('text-red-500');
            timerDisplay.classList.add('text-amber-400');
        }
    });

    socket.on('answerResult', (data) => {
        console.log('[DEBUG] answerResult received:', data);

        const myPlayerData = quizContainer && quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players) : [];
        const me = myPlayerData.find(p => p.id === currentPlayerId);
        if (me && playerInfoQuiz) {
            me.score = data.score;
            me.streak = data.streak;
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${me.score})`;
        }
        if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Warte auf Ergebnisse aller Spieler...";
        if(feedbackText) {
            feedbackText.textContent = `Deine Antwort wurde registriert.`;
            feedbackText.className = 'text-lg font-medium text-slate-300';
        }
    });

    socket.on('questionOver', (data) => {
        console.log('[DEBUG] questionOver received:', data, 'wasTimedOut:', wasTimedOut);
        if (wasTimedOut && !isGamePaused) {
            playSound('timesUp');
        }
        wasTimedOut = false;

        if(feedbackText) {
            feedbackText.textContent = '';
        }
        if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Richtige Antwort wird vorgelesen...";

        if(optionsContainer) {
            optionsContainer.querySelectorAll('.option-btn').forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('selected', 'correct', 'incorrect-picked', 'reveal-correct');
                const btnText = btn.textContent.trim().toLowerCase();
                const correctAnswerText = data.correctAnswer.trim().toLowerCase();
                console.log(`[DEBUG] Highlighting Check - Button: "${btnText}" vs Correct: "${correctAnswerText}"`);
                if (btnText === correctAnswerText) {
                    btn.classList.add('reveal-correct');
                    console.log(`[DEBUG] Highlighting applied to: "${btn.textContent}"`);
                }
            });
        }
        updateLiveScores(data.scores);

        const textToSpeak = `Die richtige Antwort war: ${data.correctAnswer}`;
        speak(textToSpeak, 'de-DE', () => {
            if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Nächste Frage kommt...";
            setTimeout(() => {
                if (isHost && currentLobbyId && !isGamePaused) {
                    console.log('[DEBUG] Host emitting hostReadyForNextQuestion after TTS and 5s delay.');
                    socket.emit('hostReadyForNextQuestion', { lobbyId: currentLobbyId });
                }
            }, 5000);
        }, false); // false for isQuestion
    });

    socket.on('gameOver', (data) => {
        stopMenuMusic();
        if (synth && synth.speaking) synth.cancel();
        isGamePaused = false;
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');

        if(finalScoresDiv) {
            finalScoresDiv.innerHTML = '';
            data.finalScores.forEach((player, index) => {
                const scoreEntry = document.createElement('div');
                scoreEntry.className = 'final-score-entry';
                let medal = '';
                if (index === 0) medal = '🥇 ';
                else if (index === 1) medal = '🥈 ';
                else if (index === 2) medal = '🥉 ';

                let displayName = player.name;
                if (player.originalId === currentPlayerId) {
                    displayName += " (Du)";
                }
                scoreEntry.innerHTML = `<span>${medal}${displayName}</span><span>${player.score} Pkt</span>`;
                finalScoresDiv.appendChild(scoreEntry);
            });
        }

        if (isHost) {
            if(playAgainHostBtn) playAgainHostBtn.classList.remove('hidden');
            if(playAgainHostBtn) playAgainHostBtn.disabled = false;
            if(waitingForHostPlayAgainBtn) waitingForHostPlayAgainBtn.classList.add('hidden');
        } else {
            if(playAgainHostBtn) playAgainHostBtn.classList.add('hidden');
            if(waitingForHostPlayAgainBtn) waitingForHostPlayAgainBtn.classList.remove('hidden');
        }
        showScreen(gameOverContainer);
        startMenuMusic();
    });

    socket.on('lobbyResetForPlayAgain', (data) => {
        console.log('[DEBUG] lobbyResetForPlayAgain received:', JSON.stringify(data));
        if (synth && synth.speaking) synth.cancel();
        currentLobbyId = data.lobbyId;
        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        showScreen(lobbyWaitingRoom);
        isGamePaused = false;
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
        if(hostTogglePauseBtn) {
            hostTogglePauseBtn.textContent = 'Pause Spiel';
            hostTogglePauseBtn.disabled = !isHost;
        }

        if(lobbyMessage) lobbyMessage.textContent = isHost ? "Spiel zurückgesetzt. Wähle Kategorie und starte!" : "Host hat das Spiel zurückgesetzt. Warte auf Start...";
        if(startGameLobbyBtn) startGameLobbyBtn.disabled = !isHost || !categorySelect.value;
        if(playAgainHostBtn) playAgainHostBtn.disabled = false;
    });

    socket.on('gamePaused', (data) => {
        console.log('[DEBUG] gamePaused event received. Remaining time:', data.remainingTime);
        isGamePaused = true;
        if (synth && synth.speaking) synth.cancel();
        if(gamePausedOverlay) gamePausedOverlay.classList.remove('hidden');
        if(pauseResumeMessage) {
            pauseResumeMessage.textContent = isHost ?
                "Spiel pausiert. (Leertaste zum Pausieren/Fortsetzen)" :
                "Das Spiel ist pausiert. Warte auf den Host.";
        }
        if(hostTogglePauseBtn && isHost) {
            hostTogglePauseBtn.textContent = 'Pause Spiel';
            hostTogglePauseBtn.disabled = false;
        }

        if(optionsContainer) optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.disabled = true);
        if(timerDisplay && data.remainingTime !== undefined) {
            timerDisplay.textContent = isHost ? `Pausiert (${Math.ceil(data.remainingTime)}s)` : `Pausiert`;
        } else if(timerDisplay) {
            timerDisplay.textContent = 'Pausiert';
        }
    });

    socket.on('gameResumed', () => {
        console.log('[DEBUG] gameResumed event received.');
        isGamePaused = false;
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');

        if(hostTogglePauseBtn && isHost) {
            hostTogglePauseBtn.textContent = 'Pause Spiel';
            hostTogglePauseBtn.disabled = false;
        }

        if(optionsContainer) {
            optionsContainer.querySelectorAll('.option-btn').forEach(btn => {
                const isAnsweredOrRevealed = btn.classList.contains('selected') ||
                    btn.classList.contains('correct') ||
                    btn.classList.contains('incorrect-picked') ||
                    btn.classList.contains('reveal-correct');
                if (!isAnsweredOrRevealed) {
                    btn.disabled = false;
                }
            });
        }
        console.log('[DEBUG] gameResumed: UI updated for resume.');
    });

    // Initial setup
    showScreen(lobbyConnectContainer);
    updateMuteButtonAppearance();
    const savedPlayerName = localStorage.getItem('quizPlayerName');
    if (savedPlayerName && playerNameInput) {
        playerNameInput.value = savedPlayerName;
    }
    if(playerNameInput) playerNameInput.addEventListener('input', () => {
        localStorage.setItem('quizPlayerName', playerNameInput.value);
    });
    if(lobbyIdInput) lobbyIdInput.addEventListener('input', () => {
        lobbyIdInput.value = lobbyIdInput.value.toUpperCase();
    });
});
