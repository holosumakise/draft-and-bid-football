// ============================================================
// GAME LOGIC - Draft & Bid Football
// ============================================================

let gameState = {
    mode: 'H2H',
    playerCount: 2,
    managers: [],
    activeDraft: null,
    auction: null,
    auctionAnchor: 0,
    draftAnimating: false,
    matchQueue: [],
    currentMatchData: null,
    skipsLeft: 10,
    difficulty: 'normal'
};

let availablePlayers = [];
let nextPlayerId = 1;
let pendingMode = 'H2H';

// --- Setup & Init ---
function selectDifficulty(key) {
    if (!DIFFICULTY_PRESETS[key]) key = 'normal';
    gameState.difficulty = key;
    document.querySelectorAll('#difficulty-options .diff-btn').forEach(btn => {
        const active = btn.dataset.diff === key;
        btn.className = `diff-btn py-2 rounded-lg text-sm font-bold border transition ${active
            ? 'border-green-400 bg-green-500 text-slate-900'
            : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400'}`;
    });
    const desc = document.getElementById('difficulty-desc');
    if (desc) desc.innerText = DIFFICULTY_PRESETS[key].desc;
}

function getDifficultyOffset() {
    return (DIFFICULTY_PRESETS[gameState.difficulty] || DIFFICULTY_PRESETS.normal).offset;
}

// The menu only picks the format now — local or online is the next step.
function selectMode(mode) {
    pendingMode = mode;
    gameState.mode = mode;
    const title = document.getElementById('choose-title');
    if (title) title.innerText = `${mode} — how do you want to play?`;
    showScreen('screen-play-choose');
}

function chooseLocal() {
    const mode = pendingMode;
    const container = document.getElementById('player-count-container');
    const select = document.getElementById('player-count');
    const difficulty = document.getElementById('difficulty-container');
    if (mode === 'H2H') {
        container.classList.add('hidden');
        difficulty.classList.add('hidden');
        gameState.playerCount = 2;
    } else {
        // Local Tournament allows 1–4 human managers (solo drafts against a ghost league).
        container.classList.remove('hidden');
        difficulty.classList.remove('hidden');
        gameState.playerCount = Math.min(4, Math.max(1, parseInt(select.value, 10) || 4));
    }
    generateNameInputs();
    selectDifficulty(gameState.difficulty);
    document.getElementById('setup-title').innerText = `${mode} Setup`;
    showScreen('screen-setup');
}

function chooseOnline() {
    const stored = localStorage.getItem('dbf.managerName') || '';
    const nameInput = document.getElementById('online-manager-name');
    if (nameInput && stored) nameInput.value = stored;
    const note = document.getElementById('online-hub-mode');
    if (note) note.innerText = pendingMode;
    setHubStatus(Net.config() ? '' : 'No Firebase project found — put your web config in firebase-config.js.');
    showScreen('screen-online-hub');
}

function backToMenu() {
    if (Net.guestLocked()) return showToast('You cannot leave while the game is running.');
    if (Net.online) Net.leaveRoom();
    Online.reset();
    showScreen('screen-main');
}

function setHubStatus(msg) {
    const el = document.getElementById('online-hub-status');
    if (el) el.innerText = msg || '';
}

// A name is required before a room can be created or joined.
function readManagerName() {
    const input = document.getElementById('online-manager-name');
    const name = (input ? input.value : '').trim().slice(0, 15);
    if (!name) {
        setHubStatus('Set your manager name first.');
        if (input) input.focus();
        return null;
    }
    localStorage.setItem('dbf.managerName', name);
    return name;
}

async function createRoom() {
    const name = readManagerName();
    if (!name) return;
    setHubStatus('Creating room…');
    try {
        const code = await Net.createRoom(name, pendingMode);
        setHubStatus('');
        Online.enterLobby(code);
    } catch (err) {
        setHubStatus(err && err.message ? err.message : 'Could not create the room.');
    }
}

async function joinRoom() {
    const name = readManagerName();
    if (!name) return;
    const code = (document.getElementById('online-room-code').value || '').trim().toUpperCase();
    if (code.length < 6) return setHubStatus('Enter the full 6-character room code.');
    setHubStatus('Joining…');
    try {
        await Net.joinRoom(name, code, pendingMode);
        setHubStatus('');
        Online.enterLobby(code);
    } catch (err) {
        setHubStatus(err && err.message ? err.message : 'Could not join that room.');
    }
}

function copyRoomCode() {
    if (!Net.roomCode) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(Net.roomCode)
            .then(() => showToast(`Room code ${Net.roomCode} copied.`))
            .catch(() => showToast(`Room code: ${Net.roomCode}`));
    } else {
        showToast(`Room code: ${Net.roomCode}`);
    }
}

function leaveRoomFromLobby() {
    if (Net.guestLocked()) return showToast('You cannot leave while the game is running.');
    Net.leaveRoom();
    Online.reset();
    showScreen('screen-main');
}

function setLobbyPlayerCount(value) {
    if (!Net.isHost) return;
    const count = Math.min(4, Math.max(2, parseInt(value, 10) || 2));
    Net.roomRef.child('lobby').update({ playerCount: count });
}

function selectLobbyDifficulty(key) {
    if (!Net.isHost || !DIFFICULTY_PRESETS[key]) return;
    Net.roomRef.child('lobby').update({ difficulty: key });
}

function startRoom() {
    if (!Net.isHost) return;
    const lobby = Net._lobby || {};
    const wanted = pendingMode === 'H2H' ? 2 : (lobby.playerCount || 4);
    const joined = Object.keys(Net._roster || {}).length;
    if (joined < wanted) return showToast(`Waiting for ${wanted - joined} more manager(s).`);
    gameState.playerCount = wanted;
    gameState.difficulty = lobby.difficulty || 'normal';
    initGame();
}

function generateNameInputs() {
    const count = gameState.mode === 'H2H'
        ? 2
        : Math.min(4, Math.max(1, parseInt(document.getElementById('player-count').value, 10) || 4));
    gameState.playerCount = count;
    const container = document.getElementById('names-container');
    container.innerHTML = '';
    for (let i = 1; i <= count; i++) {
        container.innerHTML += `
            <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Manager ${i} Name</label>
                <input type="text" id="manager-name-${i}" value="Manager ${i}" class="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white outline-none focus:border-green-400" maxlength="15">
            </div>`;
    }
}

// Online rooms take names from the roster; local play reads the setup inputs.
function managerNamesForGame(count) {
    if (Net.online) {
        const slotNames = Online.rosterBySlot();
        return Array.from({ length: count }, (_, i) => slotNames[i] || `Manager ${i + 1}`);
    }
    return Array.from({ length: count }, (_, i) => {
        const input = document.getElementById(`manager-name-${i + 1}`);
        return (input ? input.value : '').trim() || `Manager ${i + 1}`;
    });
}

function initGame() {
    clearAuctionTimer();
    if (typeof SaveGame !== 'undefined') SaveGame.resetFinished();
    if (typeof hideMatchReportPanels === 'function') hideMatchReportPanels();
    if (Net.ownsGame()) initializePlayerDB();
    gameState.matchQueue = [];
    gameState.currentMatchData = null;
    gameState.season = null;
    gameState.europe = null;
    gameState.managers = [];
    gameState.matchSim = null;
    gameState.auction = null;
    gameState.auctionAnchor = 0;
    const takenNames = new Set();
    const names = managerNamesForGame(gameState.playerCount);
    for (let i = 1; i <= gameState.playerCount; i++) {
        // Names must be unique: European brackets and match records identify teams by name
        let name = names[i - 1];
        const base = name;
        for (let n = 2; takenNames.has(name.toLowerCase()); n++) name = `${base} ${n}`;
        takenNames.add(name.toLowerCase());
        gameState.managers.push({
            id: i, name,
            balance: INITIAL_BALANCE, squad: [], formationLocked: false,
            investment: { medical: 0, stadium: 0 },
            fans: MATCHDAY_FINANCE.INITIAL_FANS,
            ticketRevenue: 0,
            bench: Array.from({length: BENCH_SLOTS}, (_, idx) => ({ id: `b${idx}`, pos: 'SUB', assignedPlayerId: null }))
        });
    }
    
    renderDOMForManagers();
    gameState.activeDraft = null;
    gameState.draftAnimating = false;
    // One skip pool for the whole room, spent only when every club passes.
    gameState.skipsLeft = 10;
    gameState._gkPhaseToast = false;
    renderDraftBoard();
    updateRollButton();
    document.getElementById('matchup-btn-container').classList.add('hidden');
    document.getElementById('matchup-btn-container').classList.remove('flex');

    Online.beginGame();

    showScreen('screen-game');
    if (typeof SaveGame !== 'undefined') SaveGame.save();
}

// Local play and the online host can leave from the game screen. Leaving as the
// host deletes the room, and every guest is sent back to the menu with a notice.
// Online guests have no exit once the game is live (see Net.guestLocked).
function leaveGameToMenu() {
    if (Net.guestLocked()) return showToast('Only the host can end an online game.');
    // Before the room is torn down: closing it makes this device the clock owner
    // again (ownsAuctionClock is `!online || isHost`), so a still-ticking shot clock
    // would go on expiring turns and selling players into a squad nobody is playing.
    clearAuctionTimer();
    gameState.matchSim = null;
    if (Net.online) {
        Net.leaveRoom();
        Online.reset();
        showScreen('screen-main');
        showToast('Room closed — all managers were sent back to the menu.');
    } else {
        showScreen('screen-main');
    }
    if (typeof SaveGame !== 'undefined') SaveGame.updateResumeButton();
}

function resumeSavedGame() {
    if (typeof SaveGame === 'undefined') return;
    if (Net.online) return showToast('Leave the online room before resuming a local save.');
    const snapshot = SaveGame.load();
    if (!snapshot) return showToast('No saved game found.');

    clearAuctionTimer();
    availablePlayers = snapshot.availablePlayers || [];
    nextPlayerId = snapshot.nextPlayerId || 1;
    const saved = snapshot.state || {};
    gameState = {
        ...gameState,
        ...saved,
        // Anything mid-tick is deliberately dropped: resumes start from a safe screen.
        activeDraft: null,
        auction: null,
        draftAnimating: false,
        matchSim: null,
        matchQueue: [],
        currentMatchData: null
    };
    if (!Array.isArray(gameState.managers) || !gameState.managers.length) {
        return showToast('That save is empty.');
    }

    renderDOMForManagers();
    renderDraftBoard();
    updateRollButton();
    checkMatchReady();

    // A local save made during the mid-season pause carries the league run (and
    // usually the market) in progress, so put the manager straight back there.
    // The market may be empty if the save landed during the half-time chart.
    if (snapshot.seasonRun
        && typeof restoreSeasonRun === 'function' && typeof resumeMidSeasonTransfer === 'function') {
        const run = restoreSeasonRun(snapshot.seasonRun);
        if (run && resumeMidSeasonTransfer(snapshot.transfer || null, run)) {
            showToast('Mid-season transfer window restored.');
            return;
        }
    }

    if (gameState.season && Array.isArray(gameState.season.finalTable) && gameState.season.finalTable.length) {
        showScreen('screen-season-results');
        showSeasonResults();
    } else {
        showScreen('screen-game');
    }
    showToast('Saved game restored.');
}

