// public/script.js

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
    populateVoices(); // Call once initially
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

    // --- Helper Functions ---
    function updateMuteButtonAppearance() {
        if (muteBtn) {
            muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
            const baseClasses = 'fixed bottom-5 right-5 text-white font-semibold py-2 px-4 rounded-lg shadow-md z-50 transition-all duration-300 opacity-80 hover:opacity-100';
            if (isMuted) {
                muteBtn.className = baseClasses + ' bg-red-600 hover:bg-red-700';
            } else {
                muteBtn.className = baseClasses + ' bg-sky-600 hover:bg-sky-700';
            }
        }
    }

    function speak(text, lang = 'de-DE', onEndCallback = null, isQuestion = false) {
        if (isMuted || !synth || !text) {
            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Muted, synth not available, or no text. Skipping speech.`);
            if (onEndCallback) onEndCallback(); // Call callback immediately if muted/unavailable
            return;
        }

        // Cancel previous speech *before* starting new one
        if (synth.speaking) {
            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Cancelling previous speech.`);
            synth.cancel();
        }

        // Short delay to ensure cancellation completes before speaking again
        setTimeout(() => {
            currentSpeechUtterance = new SpeechSynthesisUtterance(text);
            currentSpeechUtterance.lang = lang;

            // Attempt to find a German voice explicitly
            let targetVoice = voices.find(voice => voice.lang === lang && voice.name.toLowerCase().includes('german'));
            if (!targetVoice) {
                // Fallback to first available voice for the language
                targetVoice = voices.find(voice => voice.lang === lang);
            }
            if (!targetVoice && voices.length > 0) {
                // Fallback to the default voice if no language match
                targetVoice = voices.find(voice => voice.default);
            }

            if (targetVoice) {
                currentSpeechUtterance.voice = targetVoice;
            } else {
                console.warn(`[DEBUG] TTS: No suitable voice found for lang '${lang}'. Using browser default.`);
            }

            currentSpeechUtterance.onend = () => {
                console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Finished speaking - `, text.substring(0, 30) + "...");
                currentSpeechUtterance = null;
                if (onEndCallback) onEndCallback();
            };
            currentSpeechUtterance.onerror = (event) => {
                console.error(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Error - `, event);
                currentSpeechUtterance = null;
                if (onEndCallback) onEndCallback(); // Also call callback on error
            };

            console.log(`[DEBUG] TTS (${isQuestion ? 'Question' : 'Text'}): Attempting to speak:`, text.substring(0, 30) + "...", 'with voice:', currentSpeechUtterance.voice ? currentSpeechUtterance.voice.name : 'default');
            synth.speak(currentSpeechUtterance);
        }, 100); // 100ms delay
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
            // Mute existing sounds? Not easily done without Web Audio API nodes
        } else {
            // Unmuting - maybe restart music if appropriate
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
        // Allow click sound even when muted, but quieter
        if (isMuted && soundName === 'click' && sounds[soundName]) {
            sounds[soundName].volume = soundEffectsVolume * 0.3; // Quieter click when muted
            sounds[soundName].currentTime = 0;
            sounds[soundName].play().catch(error => console.log(`Error playing muted click ${soundName}:`, error));
            return;
        }

        if (isMuted) return; // Don't play other sounds if muted

        const sound = sounds[soundName];
        if (sound) {
            sound.currentTime = 0; // Reset playback to start
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

        // Stop speech only if changing away from quiz screen or to game over
        if (synth && synth.speaking && (screenElement !== quizContainer || screenElement === gameOverContainer)) {
            console.log('[DEBUG] TTS: Screen changed away from quiz or to game over, cancelling speech.');
            synth.cancel();
        }

        [lobbyConnectContainer, lobbyWaitingRoom, quizContainer, gameOverContainer].forEach(s => {
            if(s) s.classList.add('hidden');
        });
        if (screenElement) {
            screenElement.classList.remove('hidden');
        } else {
            console.error("[DEBUG] showScreen: screenElement is null or undefined!");
            return; // Exit if screenElement is invalid
        }

        // Music control based on screen
        if (screenElement === lobbyConnectContainer || screenElement === lobbyWaitingRoom || screenElement === gameOverContainer) {
            startMenuMusic();
        } else {
            stopMenuMusic();
        }

        // Host control visibility
        if (screenElement === quizContainer) {
            if (isHost && hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.remove('hidden');
                hostTogglePauseBtn.disabled = false;
                hostTogglePauseBtn.textContent = isGamePaused ? 'Fortsetzen' : 'Pause Spiel'; // Update text based on actual pause state
            } else if (hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.add('hidden');
            }
        } else {
            if (hostTogglePauseBtn) hostTogglePauseBtn.classList.add('hidden');
            if (gamePausedOverlay) gamePausedOverlay.classList.add('hidden'); // Ensure pause overlay is hidden if not on quiz screen
        }
    }

    function displayError(element, message, duration = 3000) {
        if(element) {
            element.textContent = message;
            if (duration > 0) {
                setTimeout(() => { element.textContent = ''; }, duration);
            }
        } else {
            console.warn("[DEBUG] displayError: element is null for message:", message);
            showGlobalNotification(message, 'error', duration); // Fallback to global notification
        }
    }

    function showGlobalNotification(message, type = 'error', duration = 3000) {
        if(globalNotification) {
            globalNotification.textContent = message;
            globalNotification.className = 'fixed top-5 right-5 p-4 rounded-lg shadow-xl text-sm z-50 animate-pulse'; // Base classes
            if (type === 'error') globalNotification.classList.add('bg-red-500', 'text-white');
            else if (type === 'success') globalNotification.classList.add('bg-green-500', 'text-white');
            else globalNotification.classList.add('bg-sky-500', 'text-white'); // Default/info

            globalNotification.classList.remove('hidden');
            setTimeout(() => {
                globalNotification.classList.add('hidden');
            }, duration);
        } else {
            console.log(`[GLOBAL NOTIFICATION / ${type}]: ${message}`); // Log if element not found
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

        categorySelect.innerHTML = ''; // Clear existing options

        if (allAvailableCategoriesCache.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "Keine Kategorien verfügbar";
            categorySelect.appendChild(option);
            categorySelect.disabled = true;
            console.warn('[DEBUG] populateCategorySelector - No categories available.');
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
            return;
        }

        // Add default placeholder option
        const defaultOption = document.createElement('option');
        defaultOption.value = "";
        defaultOption.textContent = "-- Kategorie auswählen --";
        defaultOption.disabled = true; // Makes it unselectable after choosing another
        defaultOption.selected = !selectedCategoryKey; // Select if no category is pre-selected
        categorySelect.appendChild(defaultOption);
        console.log('[DEBUG] populateCategorySelector - Added default option.');

        // Add actual category options
        allAvailableCategoriesCache.forEach(categoryKey => {
            const option = document.createElement('option');
            option.value = categoryKey;
            option.textContent = categoryKey; // Display the key itself as the text
            if (selectedCategoryKey && categoryKey === selectedCategoryKey) {
                option.selected = true; // Pre-select if a category is already chosen
            }
            categorySelect.appendChild(option);
        });
        console.log('[DEBUG] populateCategorySelector - Added all category options.');

        // Update state and display based on selection
        if (selectedCategoryKey && allAvailableCategoriesCache.includes(selectedCategoryKey)) {
            currentSelectedCategoryKey = selectedCategoryKey;
            categorySelect.value = selectedCategoryKey; // Ensure dropdown reflects the value
            if(currentCategoryText) currentCategoryText.textContent = selectedCategoryKey;
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
        } else {
            currentSelectedCategoryKey = null; // Reset if selected category is invalid or none
            categorySelect.value = ""; // Reset dropdown to placeholder
            if(currentCategoryText) currentCategoryText.textContent = "";
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
        }
        categorySelect.disabled = !isHost; // Enable/disable based on host status

        console.log('[DEBUG] populateCategorySelector - END. currentSelectedCategoryKey:', currentSelectedCategoryKey, 'categorySelect.value:', categorySelect.value);
    }

    function handleCategoryChange() {
        console.log('[DEBUG] handleCategoryChange - START. Current categorySelect.value:', categorySelect.value, 'isHost:', isHost);
        if (isHost) {
            currentSelectedCategoryKey = categorySelect.value || null;
            console.log('[DEBUG] handleCategoryChange - Host selected category:', currentSelectedCategoryKey);

            if (currentLobbyId && currentSelectedCategoryKey) { // Only emit if a valid category is selected
                socket.emit('hostSelectedCategory', { lobbyId: currentLobbyId, categoryKey: currentSelectedCategoryKey });
            } else if (!currentSelectedCategoryKey){
                console.log('[DEBUG] handleCategoryChange - Host selected placeholder, no category emitted.');
                // Optionally emit null to sync others if needed:
                // socket.emit('hostSelectedCategory', { lobbyId: currentLobbyId, categoryKey: null });
            } else {
                console.warn("[DEBUG] handleCategoryChange: currentLobbyId is null, cannot emit selection.");
            }

            const playerCount = playerListLobby ? playerListLobby.children.length : 0;
            if(startGameLobbyBtn) startGameLobbyBtn.disabled = !currentSelectedCategoryKey || playerCount < 1;
            console.log('[DEBUG] handleCategoryChange - Start Game Button Disabled:', startGameLobbyBtn ? startGameLobbyBtn.disabled : 'N/A');

            // Update the display text
            if (currentSelectedCategoryKey) {
                if(currentCategoryText) currentCategoryText.textContent = currentSelectedCategoryKey;
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
            } else {
                if(currentCategoryText) currentCategoryText.textContent = "";
                if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
            }
        } else {
            console.log('[DEBUG] handleCategoryChange - Not host, no action taken for emission.');
            // Non-host UI should have already been updated by 'categoryUpdatedByHost' event
        }
    }

    function updatePlayerList(players, initialLobbyCategories = [], currentCatFromServer = null) {
        console.log('[DEBUG] updatePlayerList - START. Players:', players.length, 'InitialLobbyCategories:', JSON.stringify(initialLobbyCategories), 'CurrentCatFromServer:', currentCatFromServer, 'CurrentPlayerId:', currentPlayerId);

        if (!playerListLobby) {
            console.error("[DEBUG] updatePlayerList: playerListLobby element not found!");
            return;
        }
        playerListLobby.innerHTML = ''; // Clear previous list

        const me = players.find(p => p.id === currentPlayerId);
        if (me) {
            isHost = me.isHost;
            console.log('[DEBUG] updatePlayerList - Updated local isHost to:', isHost);
        } else {
            console.warn('[DEBUG] updatePlayerList - Current player not found in player list. Assuming not host.');
            isHost = false; // Default to not host if player data is missing
        }

        // Populate player list display
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player-entry flex justify-between items-center bg-slate-600/50 p-3 rounded-md shadow'; // Use flex for alignment
            let nameDisplay = player.name;
            if (player.id === currentPlayerId) {
                nameDisplay += ' (Du)';
                if (player.isHost) { // Highlight current player if they are also host
                    // Maybe add a specific class or style here if needed
                    playerDiv.classList.add('border-l-4', 'border-sky-400', 'pl-2'); // Example highlight
                }
            }
            playerDiv.innerHTML = `<span class="player-name font-medium">${nameDisplay}</span>${player.isHost ? '<span class="player-host-badge ml-2 bg-sky-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Host</span>' : ''}`;
            playerListLobby.appendChild(playerDiv);
        });
        console.log('[DEBUG] updatePlayerList - Player list populated.');

        // Determine categories to show in dropdown
        const categoriesForDropdown = (Array.isArray(initialLobbyCategories) && initialLobbyCategories.length > 0)
            ? initialLobbyCategories
            : allAvailableCategoriesCache; // Fallback to cached categories if none provided initially

        console.log('[DEBUG] updatePlayerList - categoriesForDropdown determined as:', JSON.stringify(categoriesForDropdown));

        // Populate and configure category selector
        if (categorySelectionContainer) {
            if (categoriesForDropdown && categoriesForDropdown.length > 0) {
                categorySelectionContainer.classList.remove('hidden');
                console.log('[DEBUG] updatePlayerList - Category selection container UNHIDDEN.');
                // Use the category provided by the server if available, otherwise fallback to local state
                populateCategorySelector(categoriesForDropdown, currentCatFromServer !== null ? currentCatFromServer : currentSelectedCategoryKey);
            } else {
                categorySelectionContainer.classList.add('hidden'); // Hide if no categories
                console.log('[DEBUG] updatePlayerList - No categories to display, category selection container HIDDEN.');
            }
        } else {
            console.error("[DEBUG] updatePlayerList: categorySelectionContainer element not found!");
        }

        // Adjust UI based on host status
        if (isHost) {
            if(lobbyMessage) lobbyMessage.textContent = "Du bist der Host. Wähle eine Kategorie und starte das Spiel.";
            if(startGameLobbyBtn) {
                startGameLobbyBtn.classList.remove('hidden');
                const playerCount = playerListLobby.children.length;
                // Disable start if no category selected OR fewer than 1 player (host included)
                startGameLobbyBtn.disabled = !categorySelect.value || playerCount < 1;
                console.log('[DEBUG] updatePlayerList - Host UI updated. Start button unhidden. Disabled:', startGameLobbyBtn.disabled);
            }
            if (categorySelect) categorySelect.disabled = false; // Ensure host can select

        } else { // Non-host UI
            if(lobbyMessage) lobbyMessage.textContent = "Warte, bis der Host das Spiel startet oder eine Kategorie wählt...";
            if(startGameLobbyBtn) startGameLobbyBtn.classList.add('hidden'); // Hide start button for non-hosts
            if (categorySelect) categorySelect.disabled = true; // Disable category selection for non-hosts

            // Display the category chosen by the host
            const categoryToShow = currentCatFromServer !== null ? currentCatFromServer : currentSelectedCategoryKey;
            if (categoryToShow) {
                if(currentCategoryText) currentCategoryText.textContent = categoryToShow;
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
        liveScoresList.innerHTML = ''; // Clear previous scores
        const sortedScores = [...scoresData].sort((a, b) => b.score - a.score); // Sort by score descending
        sortedScores.forEach(player => {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'player-entry-quiz'; // Use base class from style.css
            if (player.id === currentPlayerId) {
                scoreDiv.classList.add('current-player-highlight'); // Highlight current player
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
        const playerName = playerNameInput.value.trim() || `Anon_${Math.random().toString(36).substring(2, 6)}`; // Default name if empty
        localStorage.setItem('quizPlayerName', playerName); // Save name
        socket.emit('createLobby', playerName);
        createLobbyBtn.disabled = true; // Disable buttons after action
        if(joinLobbyBtn) joinLobbyBtn.disabled = true;
    });

    if(joinLobbyBtn) joinLobbyBtn.addEventListener('click', () => {
        playSound('click');
        const lobbyId = lobbyIdInput.value.trim().toUpperCase();
        const playerName = playerNameInput.value.trim() || `Anon_${Math.random().toString(36).substring(2, 6)}`; // Default name if empty
        localStorage.setItem('quizPlayerName', playerName); // Save name
        if (lobbyId && lobbyId.length === 6) { // Basic validation for Lobby ID format
            socket.emit('joinLobby', { lobbyId, playerName });
            if(createLobbyBtn) createLobbyBtn.disabled = true;
            joinLobbyBtn.disabled = true;
        } else {
            displayError(connectErrorMsg, 'Bitte gib eine gültige 6-stellige Lobby ID ein.');
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
            // Ensure local state matches dropdown before emitting
            currentSelectedCategoryKey = selectedCategoryFromDropdown;
            console.log(`[DEBUG] startGameLobbyBtn click - Emitting startGame with category: ${currentSelectedCategoryKey}`);
            socket.emit('startGame', { lobbyId: currentLobbyId, categoryKey: currentSelectedCategoryKey });
            startGameLobbyBtn.disabled = true; // Disable after starting
        }
    });

    if(leaveLobbyBtn) leaveLobbyBtn.addEventListener('click', () => {
        playSound('click');
        stopMenuMusic();
        if (synth && synth.speaking) synth.cancel();
        // Instead of reload, which can be disruptive, try disconnecting and showing the initial screen
        socket.disconnect();
        currentLobbyId = null;
        currentPlayerId = null;
        isHost = false;
        isGamePaused = false;
        showScreen(lobbyConnectContainer);
        if(createLobbyBtn) createLobbyBtn.disabled = false;
        if(joinLobbyBtn) joinLobbyBtn.disabled = false;
        if(lobbyIdInput) lobbyIdInput.value = ''; // Clear lobby input
        if(connectErrorMsg) connectErrorMsg.textContent = ''; // Clear errors
        socket.connect(); // Reconnect for new session
        console.log('[DEBUG] Left lobby, returned to connect screen.');
    });

    if(playAgainHostBtn) playAgainHostBtn.addEventListener('click', () => {
        playSound('click');
        if (isHost && currentLobbyId) {
            socket.emit('playAgain', currentLobbyId);
            playAgainHostBtn.disabled = true; // Disable temporarily
        }
    });

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            playSound('click'); // Play click sound *before* toggling mute state
            toggleMute();
        });
    }

    function triggerHostPause() {
        if (currentLobbyId && isHost && quizContainer && !quizContainer.classList.contains('hidden')) {
            console.log('[DEBUG] Triggering hostTogglePause. isGamePaused (client-side before emit):', isGamePaused);
            socket.emit('hostTogglePause', { lobbyId: currentLobbyId });
            // Visually disable button immediately, state updated by server event
            if (hostTogglePauseBtn) hostTogglePauseBtn.disabled = true;
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

    // Keyboard shortcut for pause (Spacebar) for Host
    document.addEventListener('keydown', (event) => {
        // Check if focus is not on an input/select/textarea to avoid interference
        const activeElementTag = document.activeElement ? document.activeElement.tagName : null;
        const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElementTag);

        if (event.code === 'Space' && isHost && quizContainer && !quizContainer.classList.contains('hidden') && !isInputFocused) {
            event.preventDefault(); // Prevent default spacebar action (like scrolling)
            playSound('click');
            triggerHostPause();
        }
    });


    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('[DEBUG] Connected to server with ID:', socket.id);
        // Re-enable buttons on connect/reconnect
        if(createLobbyBtn) createLobbyBtn.disabled = false;
        if(joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (lobbyConnectContainer && !lobbyConnectContainer.classList.contains('hidden')) {
            startMenuMusic(); // Start music if on connect screen
        }
        // Attempt rejoining if previously in a lobby? More complex state needed.
    });

    socket.on('disconnect', (reason) => {
        console.log('[DEBUG] Vom Server getrennt:', reason);
        showGlobalNotification('Verbindung zum Server verloren. Versuche erneut...', 'error', 5000);
        stopMenuMusic();
        if (synth && synth.speaking) synth.cancel(); // Stop speech on disconnect
        // Reset UI or show appropriate message
        if (!gameOverContainer || gameOverContainer.classList.contains('hidden')) {
            // If not on game over screen, likely need to go back to connect screen
            showScreen(lobbyConnectContainer);
            if(createLobbyBtn) createLobbyBtn.disabled = false; // Re-enable after disconnect
            if(joinLobbyBtn) joinLobbyBtn.disabled = false;
            if(lobbyIdInput) lobbyIdInput.value = '';
            if(connectErrorMsg) connectErrorMsg.textContent = 'Verbindung verloren.';
        }
        isGamePaused = false; // Reset pause state
        if (gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
    });

    socket.on('lobbyCreated', (data) => {
        console.log('[DEBUG] lobbyCreated event received:', JSON.stringify(data));
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        if(displayLobbyId) displayLobbyId.textContent = currentLobbyId;

        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];
        console.log('[DEBUG] lobbyCreated - allAvailableCategoriesCache set to:', JSON.stringify(allAvailableCategoriesCache));

        updatePlayerList(data.players, allAvailableCategoriesCache, null); // Null for category initially

        showScreen(lobbyWaitingRoom);
        if(connectErrorMsg) connectErrorMsg.textContent = ''; // Clear any previous errors
    });

    socket.on('joinedLobby', (data) => {
        console.log('[DEBUG] joinedLobby event received:', JSON.stringify(data));
        currentLobbyId = data.lobbyId;
        currentPlayerId = data.playerId;
        if(displayLobbyId) displayLobbyId.textContent = currentLobbyId;

        allAvailableCategoriesCache = Array.isArray(data.allCategoriesForLobby) ? [...data.allCategoriesForLobby] : [];
        console.log('[DEBUG] joinedLobby - allAvailableCategoriesCache set:', JSON.stringify(allAvailableCategoriesCache));

        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        showScreen(lobbyWaitingRoom);
        if(connectErrorMsg) connectErrorMsg.textContent = '';

        // If joining a game already in progress
        if (data.gameState === 'active') {
            if(lobbyMessage) lobbyMessage.textContent = "Spiel beigetreten. Warte auf nächste Frage.";
            showScreen(quizContainer); // Show quiz screen immediately
            stopMenuMusic();
            if (gameCategoryDisplay && data.selectedCategory) {
                gameCategoryDisplay.textContent = data.selectedCategory;
            }
            // Handle pause state if joined mid-pause
            isGamePaused = data.isPaused;
            if (data.isPaused) {
                if(gamePausedOverlay) gamePausedOverlay.classList.remove('hidden');
                if(pauseResumeMessage) {
                    pauseResumeMessage.textContent = isHost ?
                        "Spiel pausiert. (Leertaste zum Fortsetzen)" : // Host sees resume option
                        "Das Spiel ist pausiert. Warte auf den Host.";
                }
                if(hostTogglePauseBtn) {
                    hostTogglePauseBtn.textContent = 'Fortsetzen'; // Show resume text
                    hostTogglePauseBtn.disabled = !isHost;
                }
                if(optionsContainer) optionsContainer.querySelectorAll('button').forEach(btn => btn.disabled = true); // Disable options
                if(timerDisplay && data.remainingTime !== undefined) {
                    timerDisplay.textContent = isHost ? `Pausiert (${Math.ceil(data.remainingTime)}s)` : `Pausiert`;
                } else if (timerDisplay) {
                    timerDisplay.textContent = 'Pausiert';
                }
            }
        }
    });

    socket.on('categoryUpdatedByHost', (categoryKey) => {
        console.log('[DEBUG] categoryUpdatedByHost received:', categoryKey);
        currentSelectedCategoryKey = categoryKey; // Update local state

        // Update dropdown selection visually
        if (categorySelect) {
            if (categoryKey && categorySelect.querySelector(`option[value="${categoryKey}"]`)) {
                categorySelect.value = categoryKey;
            } else {
                categorySelect.value = ""; // Select placeholder if category is null or invalid
            }
        }

        // Update the text display below the dropdown
        if (categoryKey) {
            if(currentCategoryText) currentCategoryText.textContent = categoryKey;
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.remove('hidden');
        } else {
            if(currentCategoryText) currentCategoryText.textContent = "";
            if(chosenCategoryDisplay) chosenCategoryDisplay.classList.add('hidden');
        }

        // Re-evaluate start button state for host
        if (isHost && startGameLobbyBtn) {
            const playerCount = playerListLobby ? playerListLobby.children.length : 0;
            startGameLobbyBtn.disabled = !currentSelectedCategoryKey || playerCount < 1;
        }
        console.log('[DEBUG] categoryUpdatedByHost - UI updated for category:', categoryKey);
    });


    socket.on('lobbyError', (message) => {
        displayError(connectErrorMsg, message, 5000); // Show error longer
        // Re-enable connect buttons on error
        if(createLobbyBtn) createLobbyBtn.disabled = false;
        if(joinLobbyBtn) joinLobbyBtn.disabled = false;
        console.error('[DEBUG] Lobby Fehler:', message);
    });

    socket.on('startGameError', (message) => {
        displayError(startGameErrorMsg, message, 5000);
        if (isHost && startGameLobbyBtn) {
            startGameLobbyBtn.disabled = false; // Re-enable start button on error
        }
        console.error('[DEBUG] Start Game Error:', message);
    });

    socket.on('playerJoined', (data) => {
        console.log('[DEBUG] playerJoined event received (another player):', JSON.stringify(data));
        allAvailableCategoriesCache = Array.isArray(data.allCategoriesForLobby) ? [...data.allCategoriesForLobby] : allAvailableCategoriesCache;
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);

        if (data.joinedPlayerId !== currentPlayerId) { // Don't notify self
            playSound('playerJoined');
            showGlobalNotification(`${data.joinedPlayerName} ist der Lobby beigetreten.`, 'info', 2000);
        }
    });

    socket.on('playerLeft', (data) => {
        console.log('[DEBUG] playerLeft event received:', JSON.stringify(data));
        // Update player list using the latest data
        allAvailableCategoriesCache = Array.isArray(data.allCategoriesForLobby) ? [...data.allCategoriesForLobby] : allAvailableCategoriesCache; // Update cache if needed
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory);
        showGlobalNotification(`${data.disconnectedPlayerName} hat die Lobby verlassen.`, 'info', 2000);
    });

    socket.on('hostChanged', (data) => {
        console.log('[DEBUG] hostChanged event received:', JSON.stringify(data));
        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory); // Update list and roles
        const newHost = data.players.find(p => p.id === data.newHostId);
        if (newHost) {
            showGlobalNotification(`${newHost.name} ist jetzt der Host.`, 'info', 3000);
        }
        // Update host-specific UI elements (like pause button visibility) based on new `isHost` status
        if (quizContainer && !quizContainer.classList.contains('hidden')) { // Check if quiz screen is active
            if (isHost && hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.remove('hidden');
                hostTogglePauseBtn.disabled = false; // Enable for new host
                hostTogglePauseBtn.textContent = isGamePaused ? 'Fortsetzen' : 'Pause Spiel';
            } else if (hostTogglePauseBtn) {
                hostTogglePauseBtn.classList.add('hidden'); // Hide for non-host
            }
        }
    });


    socket.on('gameStarted', (data) => {
        console.log('[DEBUG] gameStarted event received:', JSON.stringify(data));
        stopMenuMusic();
        playSound('gameStart');
        if(gameCategoryDisplay) gameCategoryDisplay.textContent = data.category || "Unbekannt";
        showScreen(quizContainer);
        isGamePaused = false; // Ensure game starts unpaused
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
        if(hostTogglePauseBtn) {
            hostTogglePauseBtn.textContent = 'Pause Spiel'; // Reset button text
            hostTogglePauseBtn.disabled = !isHost; // Enable/disable based on host status
        }
    });

    socket.on('newQuestion', (data) => {
        wasTimedOut = false; // Reset timeout flag
        // Ensure game is treated as resumed visually if it was paused
        if (isGamePaused) {
            isGamePaused = false; // Update local state
            if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');
            if(hostTogglePauseBtn && isHost) {
                hostTogglePauseBtn.textContent = 'Pause Spiel'; // Set button text to 'Pause'
                hostTogglePauseBtn.disabled = false;
            }
        }

        // --- Read Question Aloud ---
        speak(data.question, 'de-DE', null, true);
        // --- --------------- ---

        currentQuestionIndex = data.questionIndex;
        questionTimeLimit = data.timeLimit;
        if(gameCategoryDisplay) gameCategoryDisplay.textContent = data.category || currentSelectedCategoryKey || "Unbekannt";

        console.log('[DEBUG] newQuestion - Received question data:', data);
        if (questionText) {
            questionText.textContent = data.question;
        } else {
            console.error('[DEBUG] newQuestion - questionText element NOT found!');
        }

        if(questionCounter) questionCounter.textContent = `F: ${data.questionIndex + 1}/${data.totalQuestions}`;

        // Update score display (might be slightly behind until 'updateScores' event)
        const myPlayerData = quizContainer && quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players || '[]') : [];
        const myPlayer = myPlayerData.find(p=>p.id === currentPlayerId);
        if (playerInfoQuiz) {
            const nameFromInput = playerNameInput ? playerNameInput.value.trim() || 'Du' : 'Du';
            const scoreToDisplay = myPlayer ? myPlayer.score : (playerInfoQuiz.textContent.match(/Punkte: (\d+)/)?.[1] || 0);
            playerInfoQuiz.textContent = `${myPlayer ? myPlayer.name : nameFromInput} (Punkte: ${scoreToDisplay})`;
        }


        // Create Option Buttons
        if(optionsContainer) {
            optionsContainer.innerHTML = ''; // Clear previous options

            const optionStyles = [
                { bg: 'bg-sky-700', hover: 'hover:bg-sky-600', border: 'border-sky-500', focusRing: 'focus:ring-sky-500' },
                { bg: 'bg-emerald-700', hover: 'hover:bg-emerald-600', border: 'border-emerald-500', focusRing: 'focus:ring-emerald-500' },
                { bg: 'bg-amber-700', hover: 'hover:bg-amber-600', border: 'border-amber-500', focusRing: 'focus:ring-amber-500' },
                { bg: 'bg-violet-700', hover: 'hover:bg-violet-600', border: 'border-violet-500', focusRing: 'focus:ring-violet-500' }
            ];
            const prefixes = ['A.) ', 'B.) ', 'C.) ', 'D.) ']; // Changed to A,B,C,D

            data.options.forEach((optionText, index) => {
                const button = document.createElement('button');
                button.textContent = (prefixes[index] || '') + optionText; // Add prefix
                button.dataset.originalAnswer = optionText; // Store original answer without prefix

                // Base classes for structure and transitions
                button.className = 'option-btn w-full p-4 rounded-lg text-left text-slate-100 font-medium border transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-opacity-75 disabled:opacity-60 disabled:cursor-not-allowed';

                // Apply specific colors
                const currentStyle = optionStyles[index % optionStyles.length];
                button.classList.add(currentStyle.bg, currentStyle.hover, currentStyle.border, currentStyle.focusRing);

                button.disabled = isGamePaused; // Ensure buttons are enabled if game isn't paused

                button.addEventListener('click', () => {
                    // --- Play sound effect ---
                    playSound('click'); // Should play concurrently with speech
                    // --- ----------------- ---

                    // Disable all buttons and style the selected one
                    optionsContainer.querySelectorAll('button').forEach(btn => {
                        btn.disabled = true;
                        btn.classList.remove('ring-4', 'ring-white', 'ring-opacity-75'); // Remove selection indicator from others
                    });
                    button.classList.add('ring-4', 'ring-white', 'ring-opacity-75'); // Add indicator to clicked button

                    // Send answer
                    socket.emit('submitAnswer', {
                        lobbyId: currentLobbyId,
                        questionIndex: currentQuestionIndex,
                        answer: button.dataset.originalAnswer // Send original answer
                    });
                    if(feedbackText) feedbackText.textContent = ''; // Clear previous feedback
                    if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Antwort übermittelt. Warte auf andere Spieler oder Timer...";
                });
                optionsContainer.appendChild(button);
            });
        }

        // Reset feedback and timer display
        if(feedbackText) feedbackText.textContent = '';
        if(waitingForOthersMsg) waitingForOthersMsg.textContent = '';
        if(timerDisplay) {
            timerDisplay.textContent = isGamePaused ? 'Pausiert' : `${questionTimeLimit}s`;
            timerDisplay.classList.remove('text-red-500', 'text-amber-400'); // Clear color classes
            if (!isGamePaused) timerDisplay.classList.add('text-amber-400'); // Set default color if not paused
        }
    });


    socket.on('updateScores', (playersScoreData) => {
        // Store player data for potential use (like updating player name/score display)
        if(quizContainer) quizContainer.dataset.players = JSON.stringify(playersScoreData);

        updateLiveScores(playersScoreData); // Update the live scoreboard section

        // Update the main player info display at the top
        const me = playersScoreData.find(p => p.id === currentPlayerId);
        if (me && playerInfoQuiz) {
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${me.score})`;
        }
    });


    socket.on('timerUpdate', (timeLeft) => {
        if (isGamePaused) { // Handle paused state display
            if(timerDisplay) {
                timerDisplay.textContent = isHost ?
                    `Pausiert (${Math.ceil(timeLeft)}s)` : // Show remaining time for host
                    `Pausiert`;
                timerDisplay.classList.remove('text-red-500', 'text-amber-400'); // No color when paused
            }
            return; // Don't process timer colors if paused
        }

        if(!timerDisplay) return; // Exit if timer display element not found

        timerDisplay.textContent = `${timeLeft}s`;
        // Apply color coding based on time remaining
        if (timeLeft <= 5 && timeLeft > 0) {
            timerDisplay.classList.remove('text-amber-400');
            timerDisplay.classList.add('text-red-500'); // Red for last 5 seconds
        } else if (timeLeft === 0) {
            wasTimedOut = true; // Set flag when time runs out
            timerDisplay.classList.add('text-red-500'); // Keep red at 0
            if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Zeit abgelaufen! Antwort wird aufgedeckt...";
            if(optionsContainer) optionsContainer.querySelectorAll('button').forEach(btn => btn.disabled = true); // Disable options on timeout
        } else {
            timerDisplay.classList.remove('text-red-500'); // Ensure red is removed if > 5s
            timerDisplay.classList.add('text-amber-400'); // Default amber color
        }
    });

    socket.on('answerResult', (data) => {
        console.log('[DEBUG] answerResult received:', data);

        // Update local score display immediately based on result
        const myPlayerData = quizContainer && quizContainer.dataset.players ? JSON.parse(quizContainer.dataset.players || '[]') : [];
        const me = myPlayerData.find(p => p.id === currentPlayerId);
        if (me && playerInfoQuiz) {
            // Update score and streak in local dataset representation if needed
            const playerIndex = myPlayerData.findIndex(p => p.id === currentPlayerId);
            if(playerIndex !== -1) {
                myPlayerData[playerIndex].score = data.score;
                myPlayerData[playerIndex].streak = data.streak;
                if(quizContainer) quizContainer.dataset.players = JSON.stringify(myPlayerData);
            }
            // Update visual display
            playerInfoQuiz.textContent = `${me.name} (Punkte: ${data.score})`;
        }

        // Play sound based on correctness
        playSound(data.isCorrect ? 'correctAnswer' : 'incorrectAnswer');
        if (data.isCorrect && data.streak > 1) {
            // Play streak sound slightly delayed after correct sound
            setTimeout(() => playSound('streak'), 300);
        }


        // Update feedback text (optional, could just wait for questionOver)
        if(feedbackText) {
            feedbackText.textContent = `Deine Antwort wurde registriert. ${data.isCorrect ? '(Korrekt)' : '(Falsch)'}`;
            feedbackText.className = `text-lg font-medium ${data.isCorrect ? 'text-green-400' : 'text-red-400'}`;
        }
        // Keep waiting message active
        if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Warte auf Ergebnisse aller Spieler...";
    });


    socket.on('questionOver', (data) => {
        console.log('[DEBUG] questionOver received:', data, 'wasTimedOut:', wasTimedOut);
        if (wasTimedOut && !isGamePaused) { // Play times up sound only if timer actually hit zero
            playSound('timesUp');
        }
        wasTimedOut = false; // Reset flag

        // Clear intermediate feedback
        if(feedbackText) feedbackText.textContent = '';

        if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Richtige Antwort wird angezeigt...";

        // --- Visual Feedback: Flash Correct Answer ---
        if (optionsContainer && data.correctIndex !== undefined && data.correctIndex !== -1) {
            const buttons = optionsContainer.querySelectorAll('button');
            buttons.forEach(btn => {
                btn.disabled = true; // Ensure all are disabled
                // Clear previous visual states
                btn.classList.remove('ring-4', 'ring-white', 'ring-opacity-75', 'selected', 'correct', 'incorrect-picked', 'reveal-correct', 'flash-correct');
            });

            const correctButton = buttons[data.correctIndex];
            if (correctButton) {
                correctButton.classList.add('flash-correct'); // Apply flash style

                // Optional: Also apply a persistent style like reveal-correct during/after flash
                // correctButton.classList.add('reveal-correct');

                // Remove the flashing class after 3 seconds (matching server duration)
                setTimeout(() => {
                    if (correctButton) { // Check if button still exists
                        correctButton.classList.remove('flash-correct');
                        // Optionally remove reveal-correct too if it was added
                        // correctButton.classList.remove('reveal-correct');
                    }
                    if(waitingForOthersMsg) waitingForOthersMsg.textContent = "Nächste Frage kommt..."; // Update status after flash ends
                }, 3000); // Duration matches CORRECT_ANSWER_DISPLAY_DURATION
            } else {
                console.warn("Correct button element not found for index:", data.correctIndex);
            }
        } else {
            // Fallback if index is missing or invalid
            console.warn("Correct index not provided or invalid in questionOver data.");
            if(optionsContainer) optionsContainer.querySelectorAll('button').forEach(btn => { btn.disabled = true; }); // Still disable buttons
        }
        // --- End Visual Feedback ---

        updateLiveScores(data.scores); // Update scores based on final data for the round

        // --- NO SPEECH FOR ANSWER ---
        // const textToSpeak = `Die richtige Antwort war: ${data.correctAnswer}`;
        // speak(textToSpeak, ...);
        // --- -------------------- ---

        // Server controls the delay before the next question starts via CORRECT_ANSWER_DISPLAY_DURATION
    });


    socket.on('gameOver', (data) => {
        stopMenuMusic(); // Stop any quiz music
        if (synth && synth.speaking) synth.cancel(); // Stop any ongoing speech
        isGamePaused = false; // Reset pause state
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden');

        if(finalScoresDiv) {
            finalScoresDiv.innerHTML = ''; // Clear previous scores
            data.finalScores.forEach((player, index) => {
                const scoreEntry = document.createElement('div');
                scoreEntry.className = 'final-score-entry'; // Base class
                let medal = '';
                if (index === 0) medal = '🥇 '; // Gold
                else if (index === 1) medal = '🥈 '; // Silver
                else if (index === 2) medal = '🥉 '; // Bronze

                let displayName = player.name;
                if (player.originalId === currentPlayerId) {
                    displayName += " (Du)"; // Identify current player
                    // Add specific styling for current player's entry if desired
                    scoreEntry.classList.add('border-l-4', 'border-sky-300', 'pl-2'); // Example highlight
                }

                // Apply medal styles based on rank (index) via CSS classes or direct style manipulation
                if (index === 0) scoreEntry.classList.add('final-score-gold');
                else if (index === 1) scoreEntry.classList.add('final-score-silver');
                else if (index === 2) scoreEntry.classList.add('final-score-bronze');


                scoreEntry.innerHTML = `<span class="flex-grow">${medal}${displayName}</span><span class="font-semibold">${player.score} Pkt</span>`;
                finalScoresDiv.appendChild(scoreEntry);
            });
        }

        // Control Play Again / Leave buttons
        if (isHost) {
            if(playAgainHostBtn) playAgainHostBtn.classList.remove('hidden');
            if(playAgainHostBtn) playAgainHostBtn.disabled = false; // Enable button for host
            if(waitingForHostPlayAgainBtn) waitingForHostPlayAgainBtn.classList.add('hidden');
        } else {
            if(playAgainHostBtn) playAgainHostBtn.classList.add('hidden');
            if(waitingForHostPlayAgainBtn) waitingForHostPlayAgainBtn.classList.remove('hidden');
        }
        showScreen(gameOverContainer);
        startMenuMusic(); // Start menu music on game over screen
    });


    socket.on('lobbyResetForPlayAgain', (data) => {
        console.log('[DEBUG] lobbyResetForPlayAgain received:', JSON.stringify(data));
        if (synth && synth.speaking) synth.cancel(); // Stop speech if any
        currentLobbyId = data.lobbyId; // Reaffirm lobby ID
        allAvailableCategoriesCache = Array.isArray(data.availableCategories) ? [...data.availableCategories] : [];

        // Reset game state variables
        currentQuestionIndex = -1;
        currentSelectedCategoryKey = null;
        isGamePaused = false;
        wasTimedOut = false;

        // Update UI
        updatePlayerList(data.players, allAvailableCategoriesCache, data.selectedCategory); // Update player list, reset category selection
        showScreen(lobbyWaitingRoom); // Go back to waiting room
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden'); // Ensure pause overlay is hidden
        if(hostTogglePauseBtn) { // Reset pause button state
            hostTogglePauseBtn.textContent = 'Pause Spiel';
            hostTogglePauseBtn.disabled = !isHost;
        }

        if(lobbyMessage) lobbyMessage.textContent = isHost ? "Spiel zurückgesetzt. Wähle Kategorie und starte!" : "Host hat das Spiel zurückgesetzt. Warte auf Start...";
        if (startGameLobbyBtn && isHost) { // Reset start button state for host
            startGameLobbyBtn.disabled = !categorySelect.value || data.players.length < 1;
            startGameLobbyBtn.classList.remove('hidden');
        } else if (startGameLobbyBtn) {
            startGameLobbyBtn.classList.add('hidden');
        }
        if(playAgainHostBtn) playAgainHostBtn.disabled = false; // Re-enable play again button in case it was clicked fast
    });


    socket.on('gamePaused', (data) => {
        console.log('[DEBUG] gamePaused event received. Remaining time:', data.remainingTime);
        isGamePaused = true; // Set local pause state
        if (synth && synth.speaking) synth.cancel(); // Pause any speech
        if(gamePausedOverlay) gamePausedOverlay.classList.remove('hidden'); // Show overlay
        if(pauseResumeMessage) {
            pauseResumeMessage.textContent = isHost ?
                "Spiel pausiert. (Leertaste zum Fortsetzen)" : // Host sees resume option
                "Das Spiel ist pausiert. Warte auf den Host.";
        }
        if(hostTogglePauseBtn && isHost) {
            hostTogglePauseBtn.textContent = 'Fortsetzen'; // Change button text
            hostTogglePauseBtn.disabled = false; // Ensure button is enabled for host
        }

        // Disable option buttons while paused
        if(optionsContainer) optionsContainer.querySelectorAll('button').forEach(btn => btn.disabled = true);
        // Update timer display for paused state
        if(timerDisplay && data.remainingTime !== undefined) {
            timerDisplay.textContent = isHost ? `Pausiert (${Math.ceil(data.remainingTime)}s)` : `Pausiert`;
        } else if(timerDisplay) {
            timerDisplay.textContent = 'Pausiert';
        }
    });


    socket.on('gameResumed', () => {
        console.log('[DEBUG] gameResumed event received.');
        isGamePaused = false; // Update local pause state
        if(gamePausedOverlay) gamePausedOverlay.classList.add('hidden'); // Hide overlay

        if(hostTogglePauseBtn && isHost) {
            hostTogglePauseBtn.textContent = 'Pause Spiel'; // Change button text back
            hostTogglePauseBtn.disabled = false; // Ensure button is enabled
        }

        // Re-enable option buttons *unless* they were already answered/revealed
        if(optionsContainer) {
            optionsContainer.querySelectorAll('button').forEach(btn => {
                // Check if the button indicates a final state (selected, correct, etc.)
                const isFinalState = btn.classList.contains('ring-4') || // Check for selection ring
                    btn.classList.contains('correct') ||
                    btn.classList.contains('incorrect-picked') ||
                    btn.classList.contains('reveal-correct') ||
                    btn.classList.contains('flash-correct'); // Also check flash
                if (!isFinalState) { // Only re-enable if not in a final state
                    btn.disabled = false;
                }
            });
        }
        console.log('[DEBUG] gameResumed: UI updated for resume.');
        // Timer will update via 'timerUpdate' events from server
    });


    // --- Initial Setup ---
    showScreen(lobbyConnectContainer); // Start at the connection screen
    updateMuteButtonAppearance(); // Set initial mute button style

    // Load saved player name
    const savedPlayerName = localStorage.getItem('quizPlayerName');
    if (savedPlayerName && playerNameInput) {
        playerNameInput.value = savedPlayerName;
    }
    // Save player name on input
    if(playerNameInput) playerNameInput.addEventListener('input', () => {
        localStorage.setItem('quizPlayerName', playerNameInput.value);
    });
    // Force lobby ID input to uppercase
    if(lobbyIdInput) lobbyIdInput.addEventListener('input', () => {
        lobbyIdInput.value = lobbyIdInput.value.toUpperCase();
    });
});