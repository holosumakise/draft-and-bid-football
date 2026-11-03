// ============================================================
// SAVE / RESUME — one local snapshot of a draft in progress.
//
// Only plain, JSON-safe game data is stored. Live simulation objects
// (gameState.matchSim) and the European bracket hold cross-references back to
// managers, so they are deliberately excluded: a resume starts from the draft
// or the season results, never from the middle of a ticking match.
// ============================================================

const SaveGame = {
    KEY: 'dbf.save.v2',
    MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,   // forget saves older than a month
    _timer: null,
    _warned: false,

    // Online rooms are never saved: the host owns the simulation and a guest's
    // state lives in the room, so a local snapshot of one would be meaningless.
    _blocked() {
        return typeof Net !== 'undefined' && !!Net.online;
    },

    // A save only counts if it is readable, current-version and inside MAX_AGE_MS,
    // so the Resume button never offers something load() would reject.
    has() {
        let raw = null;
        try { raw = localStorage.getItem(this.KEY); } catch (e) { return false; }
        if (!raw) return false;
        try {
            const data = JSON.parse(raw);
            if (data && data.version === 2 && data.state && Number.isFinite(data.savedAt)
                && Date.now() - data.savedAt <= this.MAX_AGE_MS) return true;
        } catch (e) {}
        this.clear();
        return false;
    },

    setResumeVisible(visible) {
        const btn = document.getElementById('btn-resume-save');
        if (btn) btn.classList.toggle('hidden', !visible);
    },

    updateResumeButton() {
        this.setResumeVisible(this.has());
    },

    snapshot() {
        return {
            version: 2,
            savedAt: Date.now(),
            // Managers are fully plain data: squad players, formation nodes,
            // bench slots and tactics all serialise without cycles.
            state: {
                mode: gameState.mode,
                playerCount: gameState.playerCount,
                difficulty: gameState.difficulty,
                skipsLeft: gameState.skipsLeft,
                auctionAnchor: gameState.auctionAnchor || 0,
                auctionProxies: {},
                managers: gameState.managers,
                season: gameState.season || null,
                _gkPhaseToast: !!gameState._gkPhaseToast
            },
            availablePlayers,
            nextPlayerId
        };
    },

    save() {
        if (this._blocked()) return;
        if (typeof gameState === 'undefined' || !Array.isArray(gameState.managers) || !gameState.managers.length) return;
        try {
            localStorage.setItem(this.KEY, JSON.stringify(this.snapshot()));
            this._warned = false;
            this.setResumeVisible(true);
        } catch (e) {
            if (!this._warned) {
                this._warned = true;
                if (typeof showToast === 'function') showToast('Could not save locally (storage full?).');
            }
        }
    },

    // Draft animations fire several updates in a row; debounce so we write once.
    schedule(delay = 700) {
        if (this._blocked()) return;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => { this._timer = null; this.save(); }, delay);
    },

    load() {
        let raw = null;
        try { raw = localStorage.getItem(this.KEY); } catch (e) { return null; }
        if (!raw) return null;
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { this.clear(); return null; }
        if (!data || data.version !== 2 || !data.state) { this.clear(); return null; }
        if (!Number.isFinite(data.savedAt) || Date.now() - data.savedAt > this.MAX_AGE_MS) {
            this.clear();
            return null;
        }
        return data;
    },

    clear() {
        try { localStorage.removeItem(this.KEY); } catch (e) {}
        this.setResumeVisible(false);
    }
};

// Best-effort final write. A player can close the tab mid-draft and still come
// back to the squad they had gathered.
window.addEventListener('beforeunload', () => {
    if (SaveGame._timer) {
        clearTimeout(SaveGame._timer);
        SaveGame._timer = null;
        SaveGame.save();
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') SaveGame.schedule(250);
});

SaveGame.updateResumeButton();
