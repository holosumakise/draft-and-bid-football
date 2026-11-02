// ============================================================
// ONLINE GLUE — lobby rendering plus the host↔client handoff.
//
// net.js moves data; this file decides what to do with it:
//   • the host publishes everything the game needs
//   • a client renders the same screens from those snapshots
//   • bidding decisions travel back as commands, while each manager keeps
//     direct write access to their own XI, bench and match plan
// ============================================================

const Online = {
    gameLive: false,
    mirror: null,        // client-side stand-in for the host's match sim
    mirrorSeen: 0,
    mirrorKey: null,
    pendingManagers: null,

    install() {
        Net._handlers.onRoster = roster => this.renderLobby(roster, Net._lobby);
        Net._handlers.onLobby = lobby => this.renderLobby(Net._roster, lobby);
        Net._handlers.onAction = (slot, type, payload) => this.onAction(slot, type, payload);
        Net._handlers.onState = (key, value) => this.onState(key, value);
        Net._handlers.onStart = meta => this.onHostStart(meta);
        Net._handlers.onEnd = reason => this.onRoomClosed(reason);
    },

    reset() {
        this.gameLive = false;
        this.mirror = null;
        this.mirrorSeen = 0;
        this.mirrorKey = null;
        this.pendingManagers = null;
        this.note('');
    },

    // --- Lobby ---
    enterLobby(code) {
        const codeEl = document.getElementById('lobby-code');
        if (codeEl) codeEl.innerText = code;
        this.gameLive = false;
        this.renderLobby(Net._roster, Net._lobby);
        Net.renderPresence();
        showScreen('screen-lobby');
    },

    rosterBySlot() {
        const names = [];
        Object.values(Net._roster || {}).forEach(entry => {
            if (entry && Number.isFinite(entry.slot) && entry.slot >= 1) names[entry.slot - 1] = entry.name || `Manager ${entry.slot}`;
        });
        return names;
    },

    renderLobby(roster, lobby) {
        if (Net.online && !this.gameLive && document.getElementById('screen-lobby')?.classList.contains('active')) {
            const entries = Object.entries(roster || {}).sort((a, b) => (a[1].slot || 0) - (b[1].slot || 0));
            const wanted = Net.mode === 'H2H' ? 2 : (lobby?.playerCount || 4);
            const list = document.getElementById('lobby-roster');
            if (list) {
                const colors = ['blue', 'red', 'purple', 'orange'];
                list.innerHTML = Array.from({ length: wanted }, (_, i) => {
                    const slot = i + 1;
                    const entry = entries.find(([, r]) => r.slot === slot);
                    const c = colors[i % colors.length];
                    if (!entry) {
                        return `<div class="flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-600 bg-slate-900/40 px-3 py-2">
                            <span class="text-sm text-slate-500 italic">Slot ${slot} — waiting</span>
                            <span class="text-[10px] font-bold text-slate-600">EMPTY</span>
                        </div>`;
                    }
                    const [, r] = entry;
                    const you = r.slot === Net.myManagerId;
                    return `<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2">
                        <span class="flex items-center gap-2 min-w-0">
                            <span class="w-2.5 h-2.5 rounded-full shrink-0 ${r.connected ? 'bg-emerald-400' : 'bg-slate-600'}"></span>
                            <span class="text-sm font-bold text-${c}-400 truncate">${escapeHTML(r.name)}</span>
                            ${r.isHost ? '<span class="text-[9px] font-black text-amber-300 bg-amber-950 border border-amber-700 rounded px-1.5 py-0.5 shrink-0">HOST</span>' : ''}
                        </span>
                        ${you ? '<span class="text-[10px] font-bold text-slate-400 shrink-0">YOU</span>' : ''}
                    </div>`;
                }).join('');
            }

            const hostPanel = document.getElementById('lobby-host-controls');
            const guestNote = document.getElementById('lobby-guest-note');
            if (hostPanel) hostPanel.classList.toggle('hidden', !Net.isHost);
            if (guestNote) guestNote.classList.toggle('hidden', Net.isHost);

            if (Net.isHost) {
                const select = document.getElementById('lobby-player-count');
                if (select && lobby) select.value = String(lobby.playerCount || 2);
                const countWrap = document.getElementById('lobby-count-container');
                if (countWrap) countWrap.classList.toggle('hidden', Net.mode === 'H2H');
                const diffWrap = document.getElementById('lobby-difficulty-container');
                if (diffWrap) diffWrap.classList.toggle('hidden', Net.mode === 'H2H');
                this.paintLobbyDifficulty(lobby?.difficulty || 'normal');
                const start = document.getElementById('btn-start-room');
                if (start) {
                    const enough = Object.keys(roster || {}).length >= wanted;
                    start.disabled = !enough;
                    start.innerText = enough ? 'Start Game' : `Waiting for managers (${Object.keys(roster || {}).length}/${wanted})`;
                }
            }
        }
    },

    paintLobbyDifficulty(key) {
        document.querySelectorAll('#lobby-difficulty-options .diff-btn').forEach(btn => {
            const active = btn.dataset.diff === key;
            btn.className = `diff-btn py-2 rounded-lg text-sm font-bold border transition ${active
                ? 'border-green-400 bg-green-500 text-slate-900'
                : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400'}`;
        });
    },

    // --- Start of play ---
    beginGame() {
        this.gameLive = true;
        this.pendingManagers = null;
        if (!Net.online) return;
        if (!Net.isHost) return;
        Net.roomRef.child('meta').update({ status: 'live', startedAt: Net.serverNow(), playerCount: gameState.managers.length });
        Net.publishManagers();
        Net.publishOwn(Net.myManagerId);
        Net.publishInfo();
        Net.publishDraft();
        Net.publishAuction();
        Net.publishNow('season', null);
        Net.publishNow('europe', null);
        Net.publishNow('match', null);
        Net.publishScreen('screen-game');
    },

    note(msg) {
        const el = document.getElementById('online-note');
        if (!el) return;
        el.innerText = msg || '';
        el.classList.toggle('hidden', !msg || !Net.online);
    },

    // --- Host: decisions sent in by remote managers ---
    onAction(slot, type, payload) {
        if (!Net.isHost) return;
        if (type === 'auction') {
            // A command may only ever act for the manager who sent it.
            if (payload.managerId !== slot) return;
            applyAuctionAction(slot, payload.action || {});
        }
    },

    // --- Client: host state arriving as snapshots ---
    onHostStart(meta) {
        gameState.mode = meta?.mode || Net.mode || 'H2H';
        gameState.playerCount = meta?.playerCount || (gameState.mode === 'H2H' ? 2 : (Net._lobby?.playerCount || 4));
        gameState.difficulty = meta?.difficulty || Net._lobby?.difficulty || 'normal';
        initGame();
    },

    onRoomClosed() {
        this.reset();
        showScreen('screen-main');
    },

    onState(key, value) {
        if (Net.isHost) return;
        switch (key) {
            case 'info': this.applyInfo(value); break;
            case 'managers': this.onManagersNode(value); break;
            case 'draft': this.applyDraft(value); break;
            case 'auction': this.applyAuction(value); break;
            case 'screen': this.applyScreen(value); break;
            case 'match': this.applyMatch(value); break;
            case 'season': this.applySeason(value); break;
            case 'europe': this.applyEurope(value); break;
        }
    },

    applyInfo(info) {
        if (!info) return;
        gameState.mode = info.mode || gameState.mode;
        gameState.difficulty = info.difficulty || gameState.difficulty;
        if (Number.isFinite(info.skipsLeft)) gameState.skipsLeft = info.skipsLeft;
        if (Array.isArray(info.queue)) gameState.remoteQueue = info.queue;
        updateRollButton();
        renderDraftBoard();
    },

    // Both sides call this: the host to pick up remote XIs, a client to mirror
    // the whole league of clubs. Own fields are skipped for the manager this
    // device controls — that data originates here, echoing it back would fight
    // an in-progress drag.
    onManagersNode(map) {
        if (!map) return;
        if (!gameState.managers.length) {
            this.pendingManagers = map;
            return;
        }
        Object.keys(map).forEach(key => {
            const id = Number(key);
            const m = gameState.managers.find(x => x.id === id);
            if (!m) return;
            const node = map[key] || {};
            const host = node.host || {};
            const own = node.own || {};
            if (Array.isArray(host.squad)) m.squad = host.squad.filter(Boolean);
            if (typeof host.balance === 'number') m.balance = host.balance;
            if (host.name) m.name = host.name;
            if (!Net.canControl(id)) {
                if (Array.isArray(own.formation)) m.formation = own.formation.map(fillNode);
                if (Array.isArray(own.bench)) m.bench = own.bench.map(fillBenchNode);
                if (own.tactics) m.tactics = { mentality: own.tactics.mentality || 'balanced', press: own.tactics.press || 'mid' };
                m.formationPreset = own.formationPreset || '4-4-2';
                m.formationLocked = !!own.formationLocked;
            }
            if (document.getElementById(`manager-card-${id}`)) {
                updateDashboard(id);
                updateTeamOVR(id);
            }
        });
        if (document.getElementById('screen-game')?.classList.contains('active')) {
            gameState.managers.forEach(m => {
                if (Net.canControl(m.id)) return;
                renderPitchNodes(m.id);
                renderBenchNodes(m.id);
                const btn = document.getElementById(`lock-btn-${m.id}`);
                if (btn && m.formationLocked) {
                    btn.innerText = 'Formation & Tactics Confirmed';
                    btn.disabled = true;
                }
            });
            checkMatchReady();
        }
        renderDraftBoard();
    },

    applyDraft(draft) {
        gameState.activeDraft = draft ? { ...draft, player: draft.player ? { ...draft.player } : null } : null;
        gameState.draftAnimating = !!draft && draft.state === 'spinning';
        if (!draft) { gameState._renderedPlayerId = null; clearAuctionTimer(); }
        renderDraftBoard();
        updateRollButton();
    },

    applyAuction(auction) {
        if (!auction) {
            gameState.auction = null;
            clearAuctionTimer();
            renderDraftBoard();
            return;
        }
        gameState.auction = { ...auction, out: auction.out || {}, topBidOf: auction.topBidOf || {}, order: auction.order || [] };
        // A guest's clock is its own; rebasing the deadline from the remaining
        // time keeps its countdown honest even when the two devices disagree.
        if (auction.status === 'open' && Number.isFinite(auction.turnRemaining)) {
            gameState.auction.turnEndsAt = Date.now() + auction.turnRemaining;
        }
        if (auction.status === 'open' && !auctionClockId) {
            auctionClockId = setInterval(tickAuctionClock, AUCTION_TICK_MS);
        }
        if (auction.status !== 'open') clearAuctionTimer();
        renderDraftBoard();
        if (auction.turnEndsAt && auction.status === 'open') {
            const who = gameState.managers.find(m => m.id === auction.order[auction.turnIdx]);
            // Read the rebased deadline above, not the host's wall-clock value, or a
            // device with a skewed clock reports the wrong seconds left.
            if (Net.canControl(auction.order[auction.turnIdx])) this.note(`Your turn to bid — ${Math.max(0, Math.ceil((gameState.auction.turnEndsAt - Date.now()) / 1000))}s left`);
            else if (who) this.note(`${who.name} is bidding…`);
        } else {
            this.note('');
        }
    },

    applyScreen(screenId) {
        if (!screenId || screenId === document.querySelector('.screen.active')?.id) return;
        if (screenId === 'screen-lobby' || screenId === 'screen-main') {
            this.gameLive = screenId !== 'screen-main';
        }
        showScreenLocal(screenId);
        if (screenId === 'screen-season' && gameState.season) this.playSeasonChart();
        if (screenId === 'screen-season-results' && gameState.season) showSeasonResults();
        if (screenId === 'screen-euro-bracket' && gameState.europe) renderEuropeBracketScreen();
        if (screenId === 'screen-bracket') renderBracket();
        if (screenId === 'screen-awards-ceremony' && gameState.season) showAwardsCeremony();
        if (screenId === 'screen-final-summary' && gameState.season) showFinalSummary();
        if (screenId === 'screen-h2h-result' && this.mirror) showH2HResult(this.mirror);
        this.describeScreen(screenId);
    },

    describeScreen(id) {
        if (id === 'screen-season' || id === 'screen-euro-bracket') { this.note('Waiting for host...'); return; }
        this.note('');
    },

    applyMatch(view) {
        if (!view) { this.mirror = null; this.mirrorSeen = 0; this.mirrorKey = null; return; }
        const key = `${view.matchId || ''}|${view.name1}|${view.name2}`;
        if (key !== this.mirrorKey) {
            this.mirrorKey = key;
            this.mirrorSeen = 0;
            prepareMatchScreen(view.label || 'MATCH', view.name1 || 'Team 1', view.name2 || 'Team 2');
            this.mirror = {
                t1: { name: view.name1 || 'Team 1', id: null }, t2: { name: view.name2 || 'Team 2', id: null },
                s1: 0, s2: 0, view: { s1: 0, s2: 0 }, ratings: {}, finished: false
            };
            const a1 = document.getElementById('match-m1-avatar');
            const a2 = document.getElementById('match-m2-avatar');
            if (a1) a1.innerText = view.avatar1 || shortName(view.name1 || '');
            if (a2) a2.innerText = view.avatar2 || shortName(view.name2 || '');
        }
        const log = Array.isArray(view.log) ? view.log : [];
        const sim = this.mirror;
        if (!sim) return;
        log.slice(this.mirrorSeen).forEach(step => displayTimelineStep(step, sim));
        this.mirrorSeen = log.length;
        sim.s1 = view.s1 || 0; sim.s2 = view.s2 || 0;
        if (view.penStarted) this.renderPenMirror(view);
        if (view.stats) this.renderStatsMirror(view);
        if (view.finished) {
            sim.finished = true;
            sim.penRes = view.penRes || null;
            // The host's "Continue" button is theirs alone; the client just watches.
            document.getElementById('match-actions')?.classList.add('hidden');
            this.note('Waiting for host...');
        }
    },

    renderStatsMirror(view) {
        const s = view.stats;
        const bars = document.getElementById('match-stats-bars');
        if (!bars) return;
        const total = Math.max(1, s.t1S + s.t2S);
        bars.innerHTML = `
            <div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${s.poss1}%</span><span>POSSESSION</span><span>${100 - s.poss1}%</span></div>
            <div class="w-full bg-slate-200 h-2 rounded flex overflow-hidden mb-3"><div class="bg-blue-500 h-full" style="width:${s.poss1}%"></div><div class="bg-red-500 h-full" style="width:${100 - s.poss1}%"></div></div>
            <div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${s.t1S}</span><span>SHOTS</span><span>${s.t2S}</span></div>
            <div class="w-full bg-slate-200 h-2 rounded flex overflow-hidden"><div class="bg-blue-500 h-full" style="width:${(s.t1S / total) * 100}%"></div><div class="bg-red-500 h-full" style="width:${(s.t2S / total) * 100}%"></div></div>`;
        document.getElementById('match-stats-container')?.classList.remove('hidden');
    },

    renderPenMirror(view) {
        const board = document.getElementById('pen-board');
        if (!board || !view) return;
        const kicks = [[], []];
        (Array.isArray(view.penLine) ? view.penLine : []).forEach(k => kicks[k.side === 1 ? 1 : 0].push(!!k.scored));
        const res = view.penRes;
        const note = res
            ? `🏆 ${(res.p1 > res.p2 ? view.name1 : view.name2) || ''} win ${res.p1}–${res.p2} on penalties`
            : 'Shootout in progress…';
        const dot = r => `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:900;background:${r === undefined ? 'transparent' : r ? '#22c55e' : '#ef4444'};border:2px solid ${r === undefined ? '#94a3b8' : r ? '#16a34a' : '#b91c1c'};color:#fff">${r === undefined ? '' : r ? '✓' : '✕'}</span>`;
        const row = (name, list, goals) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
            <span style="width:96px;font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(name)}</span>
            <div style="display:flex;gap:4px;flex:1;justify-content:center;flex-wrap:wrap;">${list.slice(-5).map(dot).join('')}</div>
            <span style="width:24px;text-align:right;font-size:20px;font-weight:900;">${goals}</span></div>`;
        const g = list => list.filter(Boolean).length;
        board.innerHTML = `<div style="border:1px solid #cbd5e1;border-radius:14px;padding:12px;margin:8px 0;background:rgba(148,163,184,.08);">
            <div style="text-align:center;font-size:10px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Penalty Shootout</div>
            ${row(view.name1 || '', kicks[0], g(kicks[0]))}
            ${row(view.name2 || '', kicks[1], g(kicks[1]))}
            <div style="text-align:center;font-size:12px;font-weight:700;margin-top:6px;min-height:18px;">${escapeHTML(note)}</div>
        </div>`;
        const timeline = document.getElementById('match-timeline');
        if (timeline?.parentElement && board.parentElement !== timeline.parentElement) {
            timeline.insertAdjacentElement('afterend', board);
        }
        board.classList.remove('hidden');
    },

    applySeason(season) {
        if (!season) return;
        gameState.season = season;
        if (document.getElementById('screen-season')?.classList.contains('active')) this.playSeasonChart();
        if (document.getElementById('screen-season-results')?.classList.contains('active')) showSeasonResults();
    },

    // Clients get the finished table, so they replay the chart at their own pace.
    playSeasonChart() {
        if (!gameState.season?.humanSeries) return;
        buildSeasonChartChrome();
        animateSeasonChart(0);
    },

    applyEurope(europe) {
        if (!europe) { gameState.europe = null; return; }
        gameState.europe = { ...europe, brackets: europe.brackets || {} };
        // The queue arrives as ids. Pointing each entry back at its bracket node gives
        // this device the same queue shape the host renders with.
        gameState.europe.queue = (europe.queue || []).map(q => ({
            ...q,
            match: (gameState.europe.brackets[q.comp]?.[q.roundIdx] || []).find(m => m.id === q.tieId) || null
        }));
        // A winner crosses the wire as a name; point it back at the bracket's own team
        // object so the finished ties highlight on this device too.
        Object.values(gameState.europe.brackets).forEach(rounds => (rounds || []).forEach(round => (round || []).forEach(m => {
            if (!m.played || !m.winnerName) return;
            m.winner = m.t1 && m.t1.name === m.winnerName ? m.t1 : m.t2;
        })));
        if (document.getElementById('screen-euro-bracket')?.classList.contains('active')) {
            renderEuropeBracketScreen();
            // Advancing the bracket is the host's job.
            const next = document.getElementById('btn-bracket-next');
            const fin = document.getElementById('btn-bracket-final');
            [next, fin].forEach(b => { if (b) { b.disabled = true; b.classList.add('opacity-40', 'cursor-not-allowed'); } });
        }
    },

};

function fillNode(n) {
    return { id: n.id, x: n.x, y: n.y, isGK: !!n.isGK, pos: n.pos, assignedPlayerId: n.assignedPlayerId ?? null };
}

function fillBenchNode(n) {
    return { id: n.id, pos: n.pos || 'SUB', assignedPlayerId: n.assignedPlayerId ?? null };
}

// showScreen() publishes when the host is live; this is the raw switch used by
// a client following along, so no echo is produced.
function showScreenLocal(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId)?.classList.add('active');
}

Online.install();
