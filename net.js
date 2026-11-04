// ============================================================
// ONLINE — Firebase Realtime Database rooms.
//
// One device (the host) owns the simulation: it rolls the draft, runs the
// auction clock, plays matches and advances the season. Every other device
// renders the host's published state and sends its own manager's actions
// back. In local mode every method below is inert, so gameplay code can call
// Net.* unconditionally.
// ============================================================

const Net = {
    online: false,
    isHost: false,
    roomCode: null,
    selfId: null,        // this device's client id
    myManagerId: null,   // which club this device controls
    mode: 'H2H',
    fb: null,
    root: null,
    roomRef: null,
    listeners: [],
    pending: {},         // throttled publishes
    _conn: { connected: false, ever: false },
    _handlers: {},

    SESSION_KEY: 'dbf.session',

    // --- role helpers ---
    canControl(managerId) {
        if (!this.online) return true;
        if (managerId === null || managerId === undefined || this.myManagerId === null || this.myManagerId === undefined) return false;
        return Number(managerId) === Number(this.myManagerId);
    },
    // Only one device may end a turn on a shot-clock expiry, or bids would double-fire.
    ownsAuctionClock() { return !this.online || this.isHost; },
    ownsGame() { return !this.online || this.isHost; },
    // Once an online game is live a guest has no way out: only the host can end it.
    guestLocked() {
        return this.online && !this.isHost && (this._started === true || (!!this._meta && this._meta.status === 'live'));
    },

    // --- guest session: lets a refreshed page drop back into the same room and seat ---
    saveSession(name) {
        if (!this.online || this.isHost) return;
        try {
            localStorage.setItem(this.SESSION_KEY, JSON.stringify({
                code: this.roomCode, selfId: this.selfId, name, slot: this.myManagerId, mode: this.mode, at: Date.now()
            }));
        } catch (e) {}
    },
    loadSession() {
        try {
            const s = JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null');
            if (!s || !s.code || !s.selfId || !Number.isFinite(s.slot)) return null;
            if (!Number.isFinite(s.at) || Date.now() - s.at > ROOM_TTL_MS) { this.clearSession(); return null; }
            return s;
        } catch (e) { return null; }
    },
    clearSession() {
        try { localStorage.removeItem(this.SESSION_KEY); } catch (e) {}
    },

    // --- firebase bootstrap (loaded on demand so local play stays offline-safe) ---
    loadSdk() {
        if (typeof firebase !== 'undefined' && firebase.initializeApp && firebase.auth) return Promise.resolve();
        if (window.__netSdkPromise) return window.__netSdkPromise;
        const load = src => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
        const base = 'https://www.gstatic.com/firebasejs/10.12.5/';
        // App → Auth → Database. Anonymous auth is what lets the security rules
        // pin every write to a real uid instead of an open project URL.
        window.__netSdkPromise = load(`${base}firebase-app-compat.js`)
            .then(() => load(`${base}firebase-auth-compat.js`))
            .then(() => load(`${base}firebase-database-compat.js`));
        return window.__netSdkPromise;
    },

    config() {
        const stored = (() => {
            try { return JSON.parse(localStorage.getItem('dbf.firebase') || 'null'); } catch (e) { return null; }
        })();
        if (stored && stored.apiKey && stored.databaseURL) return stored;
        if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.databaseURL) return window.FIREBASE_CONFIG;
        return null;
    },

    async connect() {
        if (this.fb && this._authUser) return true;
        const cfg = this.config();
        if (!cfg) throw new Error('No Firebase project configured. Paste your web config into firebase-config.js — it needs a databaseURL — then reload.');
        await this.loadSdk();
        if (!this.fb) {
            const app = (typeof firebase.apps !== 'undefined' && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg);
            this.fb = firebase;
            this.root = app.database().ref();
        }
        // Anonymous sign-in gives a stable auth uid for security rules.
        // Roster seats are keyed by slot, not uid — so two tabs in the same
        // browser (same auth uid) can still occupy different seats without
        // overwriting each other.
        if (!this._authUser) {
            const auth = this.fb.auth();
            let user = auth.currentUser;
            if (!user) {
                const cred = await auth.signInAnonymously();
                user = cred.user;
            }
            this._authUser = user;
        }
        // Always refresh — a stale authUid breaks cmd rules (from must equal auth.uid)
        // and the host can no longer map the joiner to a roster seat.
        this.authUid = this._authUser.uid;
        if (!this.selfId) {
            // Per-tab client id (survives refresh in this tab, unique across tabs).
            try {
                const key = 'dbf.clientId';
                let id = sessionStorage.getItem(key);
                if (!id) {
                    id = this.newSelfId();
                    sessionStorage.setItem(key, id);
                }
                this.selfId = id;
            } catch (e) {
                this.selfId = this.newSelfId();
            }
        }
        return true;
    },

    // --- room lifecycle ---
    makeCode() {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = new Uint8Array(6);
        (window.crypto || {}).getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => bytes[i] = Math.floor(Math.random() * 256));
        return Array.from(bytes).map(b => alphabet[b % alphabet.length]).join('');
    },

    async createRoom(name, mode) {
        await this.connect();
        // selfId is the anonymous auth uid set in connect().
        // A code that is already taken aborts the transaction, so draw another one
        // instead of mistaking someone else's room for ours.
        let code = null;
        for (let attempt = 0; attempt < 6 && !code; attempt++) {
            const candidate = this.makeCode();
            const ref = this.root.child('rooms').child(candidate);
            const result = await ref.transaction(current => {
                if (current) return; // taken: abort
                return {
                    meta: { code: candidate, hostId: this.authUid, status: 'lobby', mode, build: BUILD_ID, createdAt: this.serverNow() },
                    lobby: { playerCount: mode === 'H2H' ? 2 : 4, difficulty: 'normal' },
                    roster: {
                        '1': {
                            uid: this.authUid,
                            clientId: this.selfId,
                            name,
                            slot: 1,
                            isHost: true,
                            joinedAt: this.serverNow(),
                            connected: true
                        }
                    }
                };
            });
            if (result && result.committed && result.snapshot.exists()) {
                code = candidate;
                this.roomRef = ref;
            }
        }
        if (!code) throw new Error('Could not create the room. Try again.');
        this.online = true;
        this.isHost = true;
        this.roomCode = code;
        this.mode = mode;
        this.myManagerId = 1;
        this.attach();
        return code;
    },

    async joinRoom(name, code, mode) {
        await this.connect();
        // selfId is the anonymous auth uid set in connect().
        const roomRef = this.root.child('rooms').child(code.toUpperCase());
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();
        // A room without meta is a leftover stub, not a real room.
        if (!snapshot.exists() || !room || !room.meta) throw new Error(`No room with code ${code.toUpperCase()} found.`);
        if (this.isExpired(room.meta)) {
            roomRef.remove().catch(() => {});
            throw new Error('That room has expired.');
        }
        if (room.meta.build && room.meta.build !== BUILD_ID) {
            throw new Error('That room runs a different version of the game. Reload this page to update, then try again.');
        }
        if (room.meta && room.meta.status !== 'lobby') throw new Error('That game has already started.');
        if (room.meta && room.meta.mode !== mode) throw new Error(`That room is a ${room.meta.mode} room.`);

        const takenSlots = Object.values((room && room.roster) || {}).map(r => r.slot);
        const capacity = ((room && room.lobby && room.lobby.playerCount) || (mode === 'H2H' ? 2 : 4));
        let slot = 0;
        for (let i = 1; i <= capacity; i++) if (!takenSlots.includes(i)) { slot = i; break; }
        if (!slot) throw new Error(takenSlots.length >= 4 ? 'The room is full.' : 'All slots for this room are taken.');

        this.roomRef = roomRef;
        // Seats are keyed by slot number so a second device (or tab) never
        // overwrites the host's roster entry.
        await this.roomRef.child('roster').child(String(slot)).set({
            uid: this.authUid,
            clientId: this.selfId,
            name,
            slot,
            isHost: false,
            joinedAt: this.serverNow(),
            connected: true
        });
        this.online = true;
        this.isHost = false;
        this.roomCode = code.toUpperCase();
        this.mode = mode;
        this.myManagerId = slot;
        this.saveSession(name);
        this.attach();
        return this.roomCode;
    },

    // Called once on page load. A guest who refreshes (or reopens the tab) is put
    // straight back into the room and seat they had; a guest of a live game has
    // nowhere else to go.
    async resumeSession() {
        const s = this.loadSession();
        if (!s || this.online) return false;
        await this.connect();
        const roomRef = this.root.child('rooms').child(s.code);
        const room = (await roomRef.once('value')).val();
        if (!room || !room.meta || this.isExpired(room.meta)) {
            this.clearSession();
            if (room && room.meta) roomRef.remove().catch(() => {});
            showToast('The room you were in no longer exists.', 6000);
            return false;
        }
        const roster = room.roster || {};
        const slotKey = String(s.slot);
        const seat = roster[slotKey] || Object.values(roster).find(r => r && r.slot === s.slot);
        // Prefer restoring the same seat if it is free or still ours.
        const ours = seat && (seat.clientId === this.selfId || seat.uid === this.authUid || seat.clientId === s.selfId);
        if (!seat || ours) {
            await roomRef.child('roster').child(slotKey).set({
                uid: this.authUid,
                clientId: this.selfId,
                name: s.name,
                slot: s.slot,
                isHost: false,
                joinedAt: this.serverNow(),
                connected: true
            });
            roster[slotKey] = { uid: this.authUid, clientId: this.selfId, name: s.name, slot: s.slot, isHost: false, connected: true };
        } else {
            // Seat taken by someone else after we left.
            this.clearSession();
            return false;
        }
        this.roomRef = roomRef;
        this.online = true;
        this.isHost = false;
        this.roomCode = s.code;
        this.mode = room.meta.mode || s.mode || 'H2H';
        this.myManagerId = s.slot;
        // Prime what the listeners would deliver, so the start-up below does not
        // depend on which snapshot happens to arrive first.
        this._roster = roster;
        this._lobby = room.lobby || null;
        this._meta = room.meta;
        Online.resumeGuest(room);
        this.attach();
        return true;
    },

    // Rooms older than ROOM_TTL_MS are dead weight; whoever finds one removes it.
    isExpired(meta) {
        return !!meta && Number.isFinite(meta.createdAt) && Date.now() - meta.createdAt > ROOM_TTL_MS;
    },

    newSelfId() {
        return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    },

    serverNow() { return this.fb.database.ServerValue.TIMESTAMP; },

    leaveRoom() {
        this.detach();
        this.clearSession();
        if (this.roomRef) {
            // Without this a stale disconnect handler would write into the room (or
            // recreate it as a stub) the next time this tab goes offline.
            try { this.roomRef.onDisconnect().cancel(); } catch (e) {}
            try {
                if (this.myManagerId != null) {
                    this.roomRef.child('roster').child(String(this.myManagerId)).onDisconnect().cancel();
                }
            } catch (e) {}
            if (this.isHost) {
                // The host leaving deletes the whole room; every guest sees meta vanish.
                this.roomRef.remove().catch(() => {});
            } else if (this.myManagerId != null) {
                this.roomRef.child('roster').child(String(this.myManagerId)).remove().catch(() => {});
            }
        }
        this.online = false;
        this.isHost = false;
        this.roomRef = null;
        this.roomCode = null;
        this.myManagerId = null;
        // A second room in this tab must behave like the first: the start flag, the
        // last room's roster and any publish still waiting in the throttle all belong
        // to the room that just closed.
        this._started = false;
        this._roster = null;
        this._meta = null;
        this._lobby = null;
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
        this.pending = {};
    },

    attach() {
        this.detach();
        const conn = this.root.child('.info/connected');
        this.listeners.push([conn, conn.on('value', snap => {
            this._conn.connected = snap.val() === true;
            if (this._conn.connected) { this._conn.ever = true; this.armPresence(); }
            this.renderPresence();
        })]);

        this.listeners.push([this.roomRef.child('roster'), this.roomRef.child('roster').on('value', v => this.onRoster(v.val()))]);
        this.listeners.push([this.roomRef.child('lobby'), this.roomRef.child('lobby').on('value', v => this.onLobby(v.val()))]);
        this.listeners.push([this.roomRef.child('meta'), this.roomRef.child('meta').on('value', v => this.onMeta(v.val()))]);

        if (this.isHost) {
            this.listeners.push([this.roomRef.child('cmd'), this.roomRef.child('cmd').on('child_added', s => this.onCommand(s))]);
            // Remote managers are edited on their own devices; the host mirrors those
            // fields so its simulation, dashboards and lock check see them.
            const managers = this.roomRef.child('game/managers');
            this.listeners.push([managers, managers.on('value', v => Online.onManagersNode(v.val()))]);
        } else {
            ['draft', 'auction', 'managers', 'info', 'screen', 'season', 'europe', 'match', 'transfer'].forEach(key => {
                const ref = this.roomRef.child('game').child(key);
                this.listeners.push([ref, ref.on('value', v => this.onGameState(key, v.val()))]);
            });
        }
        this.armPresence();
    },

    armPresence() {
        if (!this.roomRef || !this._conn.connected) return;
        if (this.isHost) {
            // The host owns the simulation, so a host that goes away (closed tab,
            // refresh, lost connection) takes the room with it.
            this.roomRef.onDisconnect().remove();
            // Keep seat 1 marked connected while the host is here.
            if (this.myManagerId != null) {
                const seat = this.roomRef.child('roster').child(String(this.myManagerId));
                seat.update({ connected: true, uid: this.authUid, clientId: this.selfId }).catch(() => {});
            }
            return;
        }
        if (this.myManagerId == null) return;
        const me = this.roomRef.child('roster').child(String(this.myManagerId));
        me.onDisconnect().update({ connected: false });
        me.update({ connected: true, uid: this.authUid, clientId: this.selfId });
        clearInterval(this._heartbeat);
        this._heartbeat = setInterval(() => {
            if (this._conn.connected) me.update({ connected: true, seen: this.serverNow() });
        }, 10000);
    },

    detach() {
        this.listeners.forEach(([ref, handle]) => { try { ref.off(null, handle); } catch (e) {} });
        this.listeners = [];
        clearInterval(this._heartbeat);
    },

    // --- client -> host ---
    send(type, payload) {
        if (!this.online || this.isHost || !this.roomRef) return;
        // Commands must land as direct children of cmd, one per command. A
        // cmd/{clientId}/{pushId} nesting fires child_added only for the first
        // command of each client; every later one is a child_changed the host
        // listener never sees, so bids would silently vanish.
        const key = `${this.selfId}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const fromUid = (this._authUser && this._authUser.uid) || this.authUid || (this.fb && this.fb.auth && this.fb.auth().currentUser && this.fb.auth().currentUser.uid) || this.selfId;
        this.authUid = fromUid;
        this.roomRef.child('cmd').child(key).set({
            from: fromUid, type, payload: payload === undefined ? null : payload, at: this.serverNow()
        }).catch(err => {
            try { showToast('Bid failed to send — check connection.', 4000); } catch (e) {}
            console.warn('Net.send failed', err);
        });
    },

    onCommand(snap) {
        const cmd = snap.val();
        // Anything we can't read is dropped for good, or it would sit in the
        // mailbox and mask the commands behind it.
        if (!cmd || !cmd.type) { snap.ref.remove().catch(() => {}); return; }
        const clientId = cmd.from || String(snap.key).split('__')[0];
        let slot = this.slotOfClient(clientId);
        const payload = cmd.payload || {};
        // Prefer the seat claimed in the payload when it belongs to this sender
        // (guards against uid/clientId mismatches after roster-key changes).
        const claimed = payload.managerId;
        if (claimed != null && this._roster) {
            const entry = this._roster[String(claimed)]
                || Object.values(this._roster).find(r => r && Number(r.slot) === Number(claimed));
            // Only trust the claimed seat when the sender owns it.
            if (entry && (entry.uid === clientId || entry.clientId === clientId)) {
                slot = Number(entry.slot != null ? entry.slot : claimed);
            }
        }
        if (slot === null || !Number.isFinite(Number(slot))) { snap.ref.remove().catch(() => {}); return; }
        slot = Number(slot);
        const handler = this._handlers.onAction;
        // Consume it: a stored command would replay on the host's next reload.
        snap.ref.remove().catch(() => {});
        if (handler) handler(slot, cmd.type, payload);
    },

    slotOfClient(clientId) {
        if (!this._roster || clientId == null) return null;
        // Roster is keyed by slot; match auth uid or per-tab clientId on the entry.
        for (const [key, r] of Object.entries(this._roster)) {
            if (!r) continue;
            if (r.uid === clientId || r.clientId === clientId || String(r.slot) === String(clientId) || key === String(clientId)) {
                return Number.isFinite(r.slot) ? r.slot : Number(key);
            }
        }
        return null;
    },

    // Online only: is the device that owns this manager still connected?
    // Local play always returns true. Missing roster entry is treated as online
    // so a brief RTDB blip does not auto-pass a turn.
    isManagerConnected(managerId) {
        if (!this.online || !this._roster) return true;
        const entry = this._roster[String(managerId)]
            || Object.values(this._roster).find(r => r && r.slot === managerId);
        if (!entry) return true;
        return entry.connected !== false;
    },

    // Auth uid for a manager slot, or null.
    clientIdForSlot(managerId) {
        if (!this._roster) return null;
        const entry = this._roster[String(managerId)]
            || Object.values(this._roster).find(r => r && r.slot === managerId);
        return entry ? (entry.uid || entry.clientId || null) : null;
    },

    auctionAction(managerId, action) {
        const mid = Number(managerId);
        if (this.online && !this.isHost && mid !== Number(this.myManagerId)) return;
        if (!this.online || this.isHost) { applyAuctionAction(mid, action); return; }
        this.send('auction', { managerId: mid, action });
    },

    // --- host -> clients (throttled per subtree) ---
    publish(key, value) {
        if (!this.online || !this.isHost || !this.roomRef) return;
        this.pending[key] = value;
        if (this._flushTimer) return;
        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            const updates = {};
            Object.keys(this.pending).forEach(k => { updates[`game/${k}`] = this.pending[k]; });
            this.pending = {};
            this.roomRef.update(updates).catch(() => {});
        }, 140);
    },

    publishNow(key, value) {
        if (!this.online || !this.isHost || !this.roomRef) return;
        delete this.pending[key];
        this.roomRef.child('game').child(key).set(value === undefined ? null : value).catch(() => {});
    },

    publishAuction() { this.publish('auction', serializeAuction(gameState.auction)); },
    publishDraft() { this.publish('draft', serializeDraft(gameState.activeDraft)); },
    // A club's data has two authors, so it has two paths: the host owns the squad
    // list and the wallet, the player who owns the club owns the XI and the plan.
    publishAuctionNow() { this.publishNow('auction', serializeAuction(gameState.auction)); },
    publishDraftNow() { this.publishNow('draft', serializeDraft(gameState.activeDraft)); },
    publishManagers(managerId) {
        if (!this.online || !this.isHost) return;
        const list = managerId === undefined || managerId === null
            ? gameState.managers
            : gameState.managers.filter(m => m.id === managerId);
        list.forEach(m => this.publish(`managers/${m.id}/host`, serializeManagerHost(m)));
    },
    // Works for the host's own club and for a guest's club.
    publishOwn(managerId) {
        if (!this.online || !this.roomRef) return;
        const m = gameState.managers.find(x => x.id === managerId);
        if (!m) return;
        // Own fields belong to that manager's device, so this write is direct:
        // the throttled publish queue is host-only and would drop every client.
        this.roomRef.child('game/managers').child(m.id).child('own').set(serializeManagerOwn(m)).catch(() => {});
    },
    publishInfo() {
        this.publish('info', {
            mode: gameState.mode, difficulty: gameState.difficulty, skipsLeft: gameState.skipsLeft,
            queue: (gameState.matchQueue || []).map(m => ({ label: m.label || '', t1: { name: m.t1?.name || '' }, t2: { name: m.t2?.name || '' } }))
        });
    },
    publishScreen(screenId) { this.publish('screen', screenId); },
    publishSeason() { this.publishNow('season', serializeSeason(gameState.season)); },
    publishEurope() { this.publishNow('europe', serializeEurope(gameState.europe)); },
    publishTransfer() {
        if (!this.online || !this.isHost) return;
        this.publish('transfer', (typeof TransferWindow !== 'undefined' && TransferWindow) ? TransferWindow.snapshot() : null);
    },
    publishTransferNow() {
        if (!this.online || !this.isHost || !this.roomRef) return;
        this.publishNow('transfer', (typeof TransferWindow !== 'undefined' && TransferWindow) ? TransferWindow.snapshot() : null);
    },
    publishMatch(value) { this.publish('match', value); },

    // --- client side ---
    onRoster(roster) {
        this._roster = roster || {};
        if (this._handlers.onRoster) this._handlers.onRoster(this._roster);
        this.renderPresence();
    },

    onLobby(lobby) {
        this._lobby = lobby || null;
        if (this._handlers.onLobby) this._handlers.onLobby(this._lobby);
    },

    // The room is gone (host left, host dropped, or the room was closed). Everyone
    // still inside is sent back to the menu with a notice.
    disband(message) {
        if (!this.online) return;
        this.leaveRoom();
        showToast(message, 8000);
        if (this._handlers.onEnd) this._handlers.onEnd(message);
    },

    onMeta(meta) {
        const hadMeta = !!this._meta;
        this._meta = meta || null;
        if (!meta) {
            if (this.online && hadMeta) {
                this.disband(this.isHost
                    ? 'Connection lost — the room was closed.'
                    : 'The host left the room, so the game has been disbanded.');
            }
            return;
        }
        if (this._handlers.onMeta) this._handlers.onMeta(this._meta);
        if (meta && meta.status === 'live' && !this.isHost && !this._started) {
            this._started = true;
            if (this._handlers.onStart) this._handlers.onStart(meta);
        }
        if (meta && meta.status === 'closed' && this.online) {
            this.disband('The host left the room, so the game has been disbanded.');
        }
    },

    onGameState(key, value) {
        if (value === null && key !== 'draft' && key !== 'auction' && key !== 'transfer') return;
        const handler = this._handlers.onState;
        if (handler) handler(key, value);
    },

    renderPresence() {
        const dot = document.getElementById('online-status-dot');
        const label = document.getElementById('online-status-label');
        if (!this.online) {
            if (dot) dot.className = 'hidden';
            if (label) label.innerText = '';
            return;
        }
        if (dot) {
            dot.classList.remove('hidden');
            dot.className = `inline-block w-2.5 h-2.5 rounded-full ${this._conn.connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`;
        }
        if (label) label.innerText = this._conn.connected ? '' : 'Reconnecting…';
    }
};

// ============================================================
// Serializers — only plain data crosses the wire.
// ============================================================

function serializePlayer(p) {
    if (!p) return null;
    const out = {};
    Object.keys(p).forEach(k => {
        const v = p[k];
        if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
        else if (Array.isArray(v) && v.every(x => typeof x === 'string')) out[k] = v.slice();
        else if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => typeof x === 'number')) out[k] = { ...v };
    });
    out.sold = !!p.sold;
    return out;
}

// Host-authored: what the auction and the wallet decide.
function serializeManagerHost(m) {
    return { id: m.id, name: m.name, balance: m.balance, squad: (m.squad || []).map(serializePlayer) };
}

// Player-authored: the shape, the XI, the bench and the match plan.
function serializeManagerOwn(m) {
    return {
        id: m.id,
        formationPreset: m.formationPreset || '4-4-2',
        formationLocked: !!m.formationLocked,
        formation: (m.formation || []).map(n => ({ id: n.id, x: n.x, y: n.y, isGK: !!n.isGK, pos: n.pos, assignedPlayerId: n.assignedPlayerId ?? null })),
        bench: (m.bench || []).map(n => ({ id: n.id, pos: n.pos, assignedPlayerId: n.assignedPlayerId ?? null })),
        tactics: m.tactics ? normalizeTactics(m.tactics) : null
    };
}

function serializeDraft(d) {
    if (!d) return null;
    // While the reels are still spinning the player stays off the wire, so a rival
    // cannot inspect the room and see who is about to appear. What does travel is the
    // pair of symbols the reels land on plus how much spin is left, which is what makes
    // every screen show one reel and stop it at the same moment. The nonce seeds the
    // strip, so even the blurred symbols match.
    if (d.state === 'spinning') {
        const p = d.player || {};
        return {
            state: 'spinning', player: null, result: null, nonce: d.nonce || null,
            spin: {
                pos: p.mainPos || null,
                nat: p.nationality || null,
                club: p.team || null,
                remaining: d.spinEndsAt ? Math.max(0, d.spinEndsAt - Date.now()) : null
            }
        };
    }
    // The pickup wheel is decided by the host, so the club order and the landing
    // segment travel with the card. The player is visible here because the wheel
    // itself has to name the player being handed out.
    if (d.state === 'picked' && d.pick) {
        return {
            state: 'picked',
            nonce: d.nonce || null,
            player: serializePlayer(d.player),
            result: null,
            pick: {
                order: d.pick.order.slice(),
                lands: d.pick.lands,
                remaining: d.pick.endsAt ? Math.max(0, d.pick.endsAt - Date.now()) : null
            }
        };
    }
    return {
        state: d.state,
        nonce: d.nonce || null,
        player: d.player ? serializePlayer(d.player) : null,
        result: d.result ? { winnerName: d.result.winnerName } : null
    };
}

function serializeAuction(a) {
    if (!a) return null;
    return {
        order: a.order.slice(), turnIdx: a.turnIdx, turnSerial: a.turnSerial || 0, highBid: a.highBid,
        highBidderId: a.highBidderId, topBidOf: { ...a.topBidOf }, out: { ...a.out },
        status: a.status, turnEndsAt: a.turnEndsAt,
        // Remote devices rebase their countdown from this instead of comparing
        // turnEndsAt to their own wall clock, which is not the host's wall clock.
        turnRemaining: a.turnEndsAt ? Math.max(0, a.turnEndsAt - Date.now()) : 0
    };
}

// The league is simulated in one pass on the host, so the whole table,
// per-matchday positions and result icons travel together.
function serializeSeason(season) {
    if (!season) return null;
    return {
        finalTable: (season.finalTable || []).map(r => ({ ...r })),
        humanSeries: (season.humanSeries || []).map(s => ({ id: s.id, name: s.name, managerId: s.managerId, color: s.color, positions: s.positions.slice(), results: s.results.slice() })),
        leagueSize: season.leagueSize,
        midSeason: !!season.midSeason,
        awards: season.awards || null,
        ceremony: season.ceremony || null,
        playerStatsByManager: season.playerStatsByManager || null,
        ghostStatsById: season.ghostStatsById || null
    };
}

// teamState and humanRef are host-only objects (and humanRef cycles), so the
// bracket travels as a display projection instead.
function serializeEurope(e) {
    if (!e) return null;
    const node = t => t ? { name: t.name, isHuman: !!t.isHuman, managerId: t.humanRef ? t.humanRef.managerId : null, tier: t.tier ?? null } : null;
    return {
        currentRoundIdx: e.currentRoundIdx ?? 0,
        bracketPending: !!e.bracketPending,
        participants: (e.participants || []).map(h => ({
            managerId: h.managerId, name: h.name, leaguePos: h.leaguePos, competition: h.competition,
            roundReached: h.roundReached || null, eliminated: !!h.eliminated, champion: !!h.champion,
            path: h.path || [], euroStats: h.euroStats || null
        })),
        brackets: Object.fromEntries(Object.entries(e.brackets || {}).map(([comp, rounds]) => [comp, rounds.map(round => round.map(m => ({
            id: m.id, t1: node(m.t1), t2: node(m.t2), played: !!m.played, s1: m.s1 ?? null, s2: m.s2 ?? null,
            pen1: m.pen1 ?? null, pen2: m.pen2 ?? null, winnerName: m.winner ? (m.winner.name || m.winner) : null
        })))])),
        queue: (e.queue || []).map(q => ({ tieId: q.match ? q.match.id : null, humanManagerId: q.human ? q.human.managerId : null, comp: q.comp, roundIdx: q.roundIdx }))
    };
}

function serializeMatchView(sim) {
    if (!sim) return null;
    return {
        label: gameState.matchBroadcast?.label || '',
        name1: sim.t1?.name || '', name2: sim.t2?.name || '',
        avatar1: shortName(sim.t1?.name || ''), avatar2: shortName(sim.t2?.name || ''),
        matchId: sim.matchId || null,
        s1: sim.s1 || 0, s2: sim.s2 || 0,
        finished: !!sim.finished,
        penStarted: !!sim.penStarted,
        penRes: sim.penRes || null,
        penLine: sim.penLine || null,
        stats: sim.stats || null,
        log: (sim.broadcastLog || []).slice(-160),
        // Guests have no ratings metrics of their own; send the finished display
        // rows so the Player Ratings button works on every device.
        ratings: sim.finished
            ? Object.values(sim.ratings || {}).map(entry => ({
                name: entry.player?.name || '',
                mainPos: entry.pos || entry.player?.mainPos || '',
                team: entry.team,
                goals: entry.goals || 0,
                assists: entry.assists || 0,
                yellow: entry.yellow || 0,
                red: entry.red ? 1 : 0,
                rating: Math.round(liveRatingFor(sim, entry) * 10) / 10
            }))
            : null
    };
}

// Closing or reloading the host's tab ends the game for everyone. onDisconnect
// does this on the server; this is the immediate best-effort version.
window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    if (Net.online && Net.isHost && Net.roomRef) {
        try { Net.roomRef.remove(); } catch (e) {}
    }
});
