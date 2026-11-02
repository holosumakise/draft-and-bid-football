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
        container.classList.remove('hidden');
        difficulty.classList.remove('hidden');
        gameState.playerCount = parseInt(select.value) || 4;
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
    const count = gameState.mode === 'H2H' ? 2 : (parseInt(document.getElementById('player-count').value, 10) || 4);
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
            balance: INITIAL_BALANCE, squad: [], formationLocked: false, skipLeft: MAX_SKIPS,
            bench: Array.from({length: BENCH_SLOTS}, (_, idx) => ({ id: `b${idx}`, pos: 'SUB', assignedPlayerId: null }))
        });
    }
    
    renderDOMForManagers();
    gameState.activeDraft = null;
    gameState.draftAnimating = false;
    gameState._gkPhaseToast = false;
    renderDraftBoard();
    updateRollButton();
    document.getElementById('matchup-btn-container').classList.add('hidden');
    document.getElementById('matchup-btn-container').classList.remove('flex');

    Online.beginGame();

    showScreen('screen-game');
}


// ============================================================
// GAME BOOTSTRAP (state + setup orchestration)
// ============================================================
