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

    // --- role helpers ---
    canControl(managerId) {
        if (!this.online) return true;
        return managerId !== null && managerId !== undefined && managerId === this.myManagerId;
    },
    // Only one device may end a turn on a shot-clock expiry, or bids would double-fire.
    ownsAuctionClock() { return !this.online || this.isHost; },
    ownsGame() { return !this.online || this.isHost; },

    // --- firebase bootstrap (loaded on demand so local play stays offline-safe) ---
    loadSdk() {
        if (typeof firebase !== 'undefined' && firebase.initializeApp) return Promise.resolve();
        if (window.__netSdkPromise) return window.__netSdkPromise;
        const load = src => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
        const base = 'https://www.gstatic.com/firebasejs/10.12.5/';
        window.__netSdkPromise = load(`${base}firebase-app-compat.js`).then(() => load(`${base}firebase-database-compat.js`));
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
        if (this.fb) return true;
        const cfg = this.config();
        if (!cfg) throw new Error('No Firebase project configured. Paste your web config into firebase-config.js — it needs a databaseURL — then reload.');
        await this.loadSdk();
        if (!this.fb) {
            const app = typeof firebase.apps === 'function' && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
            this.fb = firebase;
            this.root = app.database().ref();
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
        this.selfId = this.newSelfId();
        const code = this.makeCode();
        this.roomRef = this.root.child('rooms').child(code);
        await this.roomRef.transaction(current => {
            if (current) return; // extremely unlikely collision; abort and let the caller retry
            return {
                meta: { code, hostId: this.selfId, status: 'lobby', mode, createdAt: this.serverNow() },
                lobby: { playerCount: mode === 'H2H' ? 2 : 4, difficulty: 'normal' },
                roster: { [this.selfId]: { name, slot: 1, isHost: true, joinedAt: this.serverNow(), connected: true } },
                game: null,
                cmd: null
            };
        });
        const snapshot = await this.roomRef.once('value');
        if (!snapshot.exists()) throw new Error('Could not create the room. Try again.');
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
        this.selfId = this.newSelfId();
        const roomRef = this.root.child('rooms').child(code.toUpperCase());
        const snapshot = await roomRef.once('value');
        const room = snapshot.val();
        if (!snapshot.exists()) throw new Error(`No room with code ${code.toUpperCase()} found.`);
        if (room.meta && room.meta.status !== 'lobby') throw new Error('That game has already started.');
        if (room.meta && room.meta.mode !== mode) throw new Error(`That room is a ${room.meta.mode} room.`);

        const takenSlots = Object.values((room && room.roster) || {}).map(r => r.slot);
        const capacity = ((room && room.lobby && room.lobby.playerCount) || (mode === 'H2H' ? 2 : 4));
        let slot = 0;
        for (let i = 1; i <= capacity; i++) if (!takenSlots.includes(i)) { slot = i; break; }
        if (!slot) throw new Error(takenSlots.length >= 4 ? 'The room is full.' : 'All slots for this room are taken.');

        this.roomRef = roomRef;
        await this.roomRef.child('roster').child(this.selfId).set({
            name, slot, isHost: false, joinedAt: this.serverNow(), connected: true
        });
        this.online = true;
        this.isHost = false;
        this.roomCode = code.toUpperCase();
        this.mode = mode;
        this.myManagerId = slot;
        this.attach();
        return this.roomCode;
    },

    newSelfId() {
        return 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    },

    serverNow() { return this.fb.database.ServerValue.TIMESTAMP; },

    leaveRoom() {
        this.detach();
        if (this.roomRef) {
            this.roomRef.child('roster').child(this.selfId).remove().catch(() => {});
            if (this.isHost) this.roomRef.remove().catch(() => {});
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
            ['draft', 'auction', 'managers', 'info', 'screen', 'season', 'europe', 'match'].forEach(key => {
                const ref = this.roomRef.child('game').child(key);
                this.listeners.push([ref, ref.on('value', v => this.onGameState(key, v.val()))]);
            });
        }
        this.armPresence();
    },

    armPresence() {
        if (!this.roomRef || !this._conn.connected) return;
        const me = this.roomRef.child('roster').child(this.selfId);
        me.onDisconnect().update({ connected: false });
        me.update({ connected: true });
        clearInterval(this._heartbeat);
        this._heartbeat = setInterval(() => { if (this._conn.connected) me.update({ connected: true, seen: this.serverNow() }); }, 10000);
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
        this.roomRef.child('cmd').child(key).set({
            from: this.selfId, type, payload: payload === undefined ? null : payload, at: this.serverNow()
        });
    },

    onCommand(snap) {
        const cmd = snap.val();
        // Anything we can't read is dropped for good, or it would sit in the
        // mailbox and mask the commands behind it.
        if (!cmd || !cmd.type) { snap.ref.remove().catch(() => {}); return; }
        const clientId = cmd.from || String(snap.key).split('__')[0];
        const slot = this.slotOfClient(clientId);
        if (slot === null) { snap.ref.remove().catch(() => {}); return; }
        const handler = this._handlers.onAction;
        // Consume it: a stored command would replay on the host's next reload.
        snap.ref.remove().catch(() => {});
        if (handler) handler(slot, cmd.type, cmd.payload || {});
    },

    slotOfClient(clientId) {
        const r = this._roster && this._roster[clientId];
        return r ? r.slot : null;
    },

    auctionAction(managerId, action) {
        if (managerId !== this.myManagerId && this.online && !this.isHost) return;
        if (!this.online || this.isHost) { applyAuctionAction(managerId, action); return; }
        this.send('auction', { managerId, action });
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

    onMeta(meta) {
        this._meta = meta || null;
        if (this._handlers.onMeta) this._handlers.onMeta(this._meta);
        if (meta && meta.status === 'live' && !this.isHost && !this._started) {
            this._started = true;
            if (this._handlers.onStart) this._handlers.onStart(meta);
        }
        if (meta && meta.status === 'closed' && this.online) {
            showToast('The host closed the room.');
            this.leaveRoom();
            if (this._handlers.onEnd) this._handlers.onEnd('Host closed the room.');
        }
    },

    onGameState(key, value) {
        if (value === null && key !== 'draft' && key !== 'auction') return;
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
        tactics: m.tactics ? { mentality: m.tactics.mentality, press: m.tactics.press } : null
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
        order: a.order.slice(), turnIdx: a.turnIdx, highBid: a.highBid,
        highBidderId: a.highBidderId, topBidOf: { ...a.topBidOf }, out: { ...a.out },
        status: a.status, turnEndsAt: a.turnEndsAt,
        // Ceilings never leave the host. Publishing only the ids lets a guest
        // show an AUTO badge without leaking what its rival is willing to pay.
        proxyIds: Object.keys(gameState.auctionProxies || {}).map(Number),
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
        awards: season.awards || null,
        ceremony: season.ceremony || null,
        playerStatsByManager: season.playerStatsByManager || null,
        ghostStatsById: season.ghostStatsById || null,
        // Rotations travel too: a guest should be able to see who was rested,
        // injured or suspended without asking the host.
        availabilityLog: season.availabilityLog || null
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
