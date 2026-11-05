// ============================================================
// MID-SEASON TRANSFER WINDOW (league / tournament mode)
// ------------------------------------------------------------
// Opens once, halfway through the league. Managers swap players with each other:
//   - "Make offer": ask for another manager's player, give one of yours (+ optional cash from you)
//   - "List for sale": put your player on the market; others offer a player (+ cash) for him
// The receiver can accept or decline. Each manager can complete at most MAX_TRADES trades
// (a trade = one player-for-player swap, whether you started it or accepted it).
// Ghost clubs never take part.
//
// Online: the host owns the window state and every trade. Guests send transfer
// commands and render the host's published snapshot; a device can only ever act
// for the club it controls.
// ============================================================
(function () {
    'use strict';

    const MAX_TRADES = (typeof TRANSFER_MAX_TRADES === 'number') ? TRANSFER_MAX_TRADES : 2;

    // ---- ADAPTER: the only place that knows how money / prices are stored on your objects ----
    // This game keeps a manager's money in `balance` (in €M) and the price paid on each squad player in `price`.
    const BUDGET_KEYS = ['balance'];
    const VALUE_KEYS = ['price'];
    const Adapter = {
        budgetKey(m) { return BUDGET_KEYS.find(k => typeof m[k] === 'number') || null; },
        hasBudget(m) { return !!this.budgetKey(m); },
        getBudget(m) { const k = this.budgetKey(m); return k ? m[k] : 0; },
        addBudget(m, delta) { const k = this.budgetKey(m); if (k) m[k] += delta; },
        value(p) { const k = VALUE_KEYS.find(key => typeof p[key] === 'number'); return k ? p[k] : null; },
        fmt(v) { return v == null ? '–' : (typeof formatBalance === 'function' ? formatBalance(v) : '€' + v + 'M'); }
    };

    let S = null; // state of the open window (host/local) or the host snapshot (guest)

    // ---------- environment ----------
    const online = () => typeof Net !== 'undefined' && !!Net.online;
    const isHost = () => !online() || !!(typeof Net !== 'undefined' && Net.isHost);

    // ---------- lookups ----------
    const mgr = id => gameState.managers.find(m => String(m.id) === String(id));
    const isGK = p => p.mainPos === 'GK';
    const tradesLeft = id => MAX_TRADES - (S.trades[id] || 0);
    const esc = s => (typeof escapeHTML === 'function' ? escapeHTML(String(s)) : String(s));
    const toast = msg => { if (typeof showToast === 'function') showToast(msg); };
    const pendingOffers = () => S.offers.filter(o => o.status === 'pending');

    function blankState() {
        return {
            run: null, onClose: null,
            offers: [], seq: 1, trades: {}, ready: {}, listed: {}, log: [],
            swaps: [], swapSeq: 0, noticeSeq: 0, noticeText: '',
            acting: null, tab: 'market', filter: 'clubs', posFilter: 'all', modal: null, listing: false,
            appliedSwaps: {}, seenNotice: 0
        };
    }

    // Firebase may hand an empty or sparse array back as an object; normalise
    // either shape so a snapshot never silently loses its offers.
    const asArray = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

    function applyShared(snap) {
        if (!snap) return;
        S.offers = asArray(snap.offers).map(o => ({ ...o }));
        S.seq = Number(snap.seq) || 1;
        S.trades = { ...(snap.trades || {}) };
        S.ready = { ...(snap.ready || {}) };
        S.listed = { ...(snap.listed || {}) };
        S.log = asArray(snap.log).slice();
        S.swaps = asArray(snap.swaps).map(sw => ({ ...sw }));
        S.swapSeq = Number(snap.swapSeq) || 0;
        S.noticeSeq = Number(snap.noticeSeq) || 0;
        S.noticeText = snap.noticeText || '';
    }

    // ---------- host -> room ----------
    function snapshot() {
        if (!S) return null;
        return {
            offers: S.offers.map(o => ({ ...o })),
            seq: S.seq,
            trades: { ...S.trades },
            ready: { ...S.ready },
            listed: { ...S.listed },
            log: S.log.slice(),
            swaps: S.swaps.map(sw => ({ ...sw })),
            swapSeq: S.swapSeq,
            noticeSeq: S.noticeSeq,
            noticeText: S.noticeText
        };
    }

    function publishShared(now) {
        // Local/offline games save the window and the paused season run so a
        // reload can come back to the same market. Online games save nothing.
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
        if (!online() || !Net.isHost || typeof Net.publishTransfer !== 'function') return;
        if (now) Net.publishTransferNow();
        else Net.publishTransfer();
    }

    // Host-side feedback is also broadcast, so the guest that sent the action sees
    // the same message (including validation errors).
    function notify(msg) {
        toast(msg);
        if (!S) return;
        S.noticeSeq += 1;
        S.noticeText = msg;
        S.seenNotice = S.noticeSeq;
    }

    // ---------- rules ----------
    function validate(o) {
        const A = mgr(o.from), B = mgr(o.to);
        if (!A || !B) return 'Manager not found.';
        if (String(A.id) === String(B.id)) return 'Pick another manager.';
        const give = A.squad.find(p => String(p.id) === String(o.give));
        const want = B.squad.find(p => String(p.id) === String(o.want));
        if (!give || !want) return 'One of the players is no longer available.';
        if (tradesLeft(A.id) <= 0) return A.name + ' has used all ' + MAX_TRADES + ' trades.';
        if (tradesLeft(B.id) <= 0) return B.name + ' has used all ' + MAX_TRADES + ' trades.';
        if (isGK(give) !== isGK(want)) return 'Goalkeepers can only be swapped for goalkeepers.';
        if (o.cash > 0 && !Adapter.hasBudget(A)) return 'Cash is not available in this game.';
        if (o.cash > Adapter.getBudget(A)) return A.name + ' cannot afford the extra cash.';
        return null;
    }

    // The incoming player takes the exact lineup / bench slot of the one who left.
    function replaceInManager(m, outId, inPlayer) {
        const i = m.squad.findIndex(p => String(p.id) === String(outId));
        if (i >= 0) m.squad[i] = inPlayer;
        (m.formation || []).forEach(n => { if (String(n.assignedPlayerId) === String(outId)) n.assignedPlayerId = inPlayer.id; });
        (m.bench || []).forEach(s => { if (String(s.assignedPlayerId) === String(outId)) s.assignedPlayerId = inPlayer.id; });
    }

    // Season stats follow the player to his new club.
    function moveStats(fromMgr, toMgr, player) {
        if (!S.run || !S.run.playerStatsByManager) return;
        const maps = S.run.playerStatsByManager;
        const src = maps[fromMgr.id] || {};
        const dst = maps[toMgr.id] || (maps[toMgr.id] = {});
        const rec = src[player.id] || {
            id: player.id, name: player.name, mainPos: player.mainPos,
            goals: 0, assists: 0, cleanSheets: 0, apps: 0, minutes: 0,
            yellows: 0, reds: 0, ratingSum: 0, ratingCount: 0, goalsConcededAsGK: 0
        };
        delete src[player.id];
        rec.team = toMgr.name;
        rec.teamId = toMgr.id;
        dst[player.id] = rec;
    }

    function execute(o) {
        const A = mgr(o.from), B = mgr(o.to);
        if (!A || !B) return;
        const give = A.squad.find(p => String(p.id) === String(o.give));
        const want = B.squad.find(p => String(p.id) === String(o.want));
        if (!give || !want) return;
        replaceInManager(A, give.id, want);
        replaceInManager(B, want.id, give);
        moveStats(A, B, give);
        moveStats(B, A, want);
        if (o.cash > 0) { Adapter.addBudget(A, -o.cash); Adapter.addBudget(B, o.cash); }
        S.trades[A.id] = (S.trades[A.id] || 0) + 1;
        S.trades[B.id] = (S.trades[B.id] || 0) + 1;
        delete S.listed[give.id];
        delete S.listed[want.id];
        o.status = 'accepted';
        S.log.unshift(`${A.name} ⇄ ${B.name}: ${give.name} for ${want.name}` + (o.cash > 0 ? ` (+${Adapter.fmt(o.cash)})` : ''));
        // The host already moved the players in its own copy. Remember the swap so
        // each guest can move the same player in its own XI / bench.
        S.swaps.push({
            seq: ++S.swapSeq,
            a: A.id, b: B.id,
            aOut: give.id, aIn: want.id,
            bOut: want.id, bIn: give.id
        });

        // Anything that depended on these players or on a manager who is now out of trades is dead.
        pendingOffers().forEach(p => {
            const ids = [p.give, p.want];
            if (ids.includes(give.id) || ids.includes(want.id) || tradesLeft(p.from) <= 0 || tradesLeft(p.to) <= 0) p.status = 'void';
        });

        if (online() && Net.isHost) Net.publishManagers();
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    }

    function sendOffer(fromId, wantId, giveId, cash) {
        const A = mgr(fromId);
        if (!A) return notify('Manager not found.');
        const owner = gameState.managers.find(m => (m.squad || []).some(p => String(p.id) === String(wantId)));
        if (!owner) return notify('Player not found.');
        if (String(owner.id) === String(A.id)) return notify('That player is already yours.');
        const give = (A.squad || []).find(p => String(p.id) === String(giveId));
        if (!give) return notify('Choose one of your own players.');
        const o = {
            id: S.seq++, from: A.id, to: owner.id, give: give.id, want: wantId,
            cash: Math.max(0, Math.floor(Number(cash) || 0)), status: 'pending'
        };
        const err = validate(o);
        if (err) return notify(err);
        if (S.offers.some(x => x.status === 'pending' && String(x.from) === String(fromId) && String(x.want) === String(wantId))) {
            return notify('You already have an offer on that player.');
        }
        S.offers.push(o);
        S.modal = null;
        notify('Offer sent to ' + owner.name + '.');
        render();
        publishShared(true);
    }

    function respond(actorId, id, accept) {
        const o = S.offers.find(x => x.id === id && x.status === 'pending');
        if (!o) return;
        if (String(o.to) !== String(actorId)) return notify('That offer is not yours to answer.');
        if (!accept) {
            o.status = 'declined';
            notify('Offer declined.');
            render();
            publishShared(true);
            return;
        }
        const err = validate(o);
        if (err) { o.status = 'void'; notify(err); render(); publishShared(true); return; }
        execute(o);
        notify('Trade completed!');
        render();
        publishShared(true);
    }

    function withdraw(actorId, id) {
        const o = S.offers.find(x => x.id === id && x.status === 'pending');
        if (!o) return;
        if (String(o.from) !== String(actorId)) return notify('That offer is not yours to withdraw.');
        o.status = 'withdrawn';
        notify('Offer withdrawn.');
        render();
        publishShared(true);
    }

    function toggleList(actorId, playerId) {
        const m = mgr(actorId);
        if (!m) return;
        const p = (m.squad || []).find(x => String(x.id) === String(playerId));
        if (!p) return notify('That player is not in your squad.');
        if (S.listed[playerId]) delete S.listed[playerId];
        else S.listed[playerId] = true;
        render();
        publishShared(true);
    }

    function toggleReady(actorId) {
        const m = mgr(actorId);
        if (!m) return;
        S.ready[m.id] = !S.ready[m.id];
        render();
        publishShared(true);
    }

    // ---------- UI ----------
    const CASH_STEP = 5;

    function posGroup(pos) {
        const key = String(pos || '').toUpperCase();
        if (key === 'GK') return 'gk';
        const meta = typeof POSITION_META !== 'undefined' ? POSITION_META[key] : null;
        if (meta) return ['def', 'mid', 'fwd'][meta.unit] || 'mid';
        if (/(CB|LB|RB|WB)$/.test(key)) return 'def';
        if (key === 'ST' || key === 'CF' || key === 'LW' || key === 'RW') return 'fwd';
        return 'mid';
    }

    function injectStyles() {
        if (document.getElementById('tw-styles')) return;
        const st = document.createElement('style');
        st.id = 'tw-styles';
        st.textContent = `
        #screen-transfer-window { overflow-y:auto; padding:18px 14px 116px; color:#e2e8f0; }
        .tw-wrap { width:100%; max-width:960px; margin:0 auto; display:flex; flex-direction:column; gap:12px; padding-bottom:84px; }
        .tw-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; padding-bottom:12px; border-bottom:1px solid #1e293b; }
        .tw-title { font-size:19px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; color:#34d399; margin:0; }
        .tw-sub { color:#94a3b8; font-size:12px; margin:3px 0 0; }
        .tw-sub b { color:#e2e8f0; }
        .tw-head__act { display:flex; align-items:center; gap:8px; }
        .tw-seatbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .tw-seatbar__label { font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:#64748b; font-weight:900; }
        .tw-seats { display:flex; gap:6px; flex-wrap:wrap; }
        .tw-note { color:#64748b; font-size:12.5px; padding:14px 10px; text-align:center; border:1px dashed #1e293b; border-radius:12px; }
        .tw-help { margin:0; padding:10px 12px; border:1px solid #1e293b; border-radius:10px; background:#0b1220; color:#94a3b8; font-size:12px; line-height:1.55; }
        .tw-help b { color:#cbd5e1; }
        .tw-help i { color:#34d399; font-style:normal; font-weight:900; }
        .tw-chip { padding:7px 11px; border-radius:10px; border:1px solid #24344f; background:#0b1220; color:#cbd5e1; font-size:12.5px; font-weight:800; cursor:pointer; text-align:left; line-height:1.25; }
        .tw-chip.on { background:#064e3b; border-color:#34d399; color:#a7f3d0; }
        .tw-chip.tw-static { cursor:default; }
        .tw-chip small { display:block; font-weight:600; color:#64748b; font-size:10.5px; }
        .tw-chip.on small { color:#6ee7b7; }
        .tw-chip i { font-style:normal; color:#34d399; margin-left:5px; }
        .tw-tabs { display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; border-radius:12px; background:#0b1220; border:1px solid #1e293b; }
        .tw-tab { padding:10px 8px; border:0; border-radius:9px; background:transparent; color:#94a3b8; font-weight:800; font-size:13px; cursor:pointer; }
        .tw-tab.on { background:#064e3b; color:#a7f3d0; }
        .tw-tab span { display:inline-block; margin-left:5px; padding:0 6px; border-radius:999px; background:#334155; color:#e2e8f0; font-size:11px; }
        .tw-tab.on span { background:#34d399; color:#04231a; }
        .tw-h { font-size:11px; letter-spacing:.10em; text-transform:uppercase; color:#64748b; font-weight:900; margin:2px; }
        .tw-h span { letter-spacing:0; text-transform:none; font-weight:700; color:#475569; }
        .tw-group { display:flex; flex-direction:column; gap:6px; }
        .tw-viewbar .tw-h { margin:0; }
        .tw-clubs { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:8px; }
        .tw-club { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding:12px; border-radius:12px; border:1px solid #1e293b; background:#0b1220; color:#e2e8f0; text-align:left; cursor:pointer; font:inherit; }
        .tw-club:hover { border-color:#34d399; }
        .tw-club--listed { grid-column:1/-1; border-color:#134e4a; background:linear-gradient(90deg,#062a24,#0b1220); }
        .tw-club__name { display:block; font-size:13.5px; font-weight:900; }
        .tw-club__meta { display:block; margin-top:2px; font-size:11px; color:#64748b; }
        .tw-club__side { display:flex; align-items:center; gap:8px; flex-shrink:0; }
        .tw-club__go { color:#34d399; font-size:11.5px; font-weight:900; white-space:nowrap; }
        .tw-pill { padding:1px 7px; border-radius:999px; background:#064e3b; color:#6ee7b7; font-size:10.5px; font-weight:900; }
        .tw-viewbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
        .tw-viewbar__left { display:flex; align-items:center; gap:8px; min-width:0; flex-wrap:wrap; }
        .tw-back { padding:5px 9px; border-radius:8px; border:1px solid #334155; background:#0b1220; color:#cbd5e1; font-weight:800; font-size:11.5px; cursor:pointer; white-space:nowrap; }
        .tw-back:hover { border-color:#34d399; }
        .tw-seg { display:inline-flex; gap:2px; padding:3px; border-radius:10px; background:#0b1220; border:1px solid #1e293b; }
        .tw-seg button { border:0; background:transparent; color:#94a3b8; font-size:11px; font-weight:800; padding:5px 8px; border-radius:7px; cursor:pointer; }
        .tw-seg button.on { background:#064e3b; color:#a7f3d0; }
        .tw-card { background:#0b1220; border:1px solid #1e293b; border-radius:14px; padding:0 10px; }
        .tw-card--flat { margin:0; }
        .tw-pl { display:grid; grid-template-columns:38px minmax(0,1fr) 40px 58px auto; align-items:center; gap:9px; min-height:46px; padding:7px 0; border-bottom:1px solid #162033; }
        .tw-pl:last-child { border-bottom:0; }
        .tw-pos { width:36px; flex-shrink:0; text-align:center; padding:3px 0; border-radius:7px; font-size:10px; font-weight:900; letter-spacing:.04em; background:#1e293b; color:#cbd5e1; }
        .tw-pos--gk { background:#2b2109; color:#fcd34d; }
        .tw-pos--def { background:#0f2438; color:#7dd3fc; }
        .tw-pos--mid { background:#0d2b23; color:#6ee7b7; }
        .tw-pos--fwd { background:#2b1220; color:#f9a8d4; }
        .tw-name { min-width:0; display:flex; align-items:baseline; gap:6px; overflow:hidden; }
        .tw-name b { min-width:0; font-weight:700; font-size:13.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .tw-name em { font-style:normal; font-size:11px; color:#64748b; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .tw-ovr { width:34px; flex-shrink:0; text-align:center; padding:3px 0; border-radius:8px; background:#111c30; border:1px solid #24344f; font-weight:900; font-size:12.5px; }
        .tw-ovr.is-elite { color:#fbbf24; border-color:#78350f; background:#241a06; }
        .tw-val { width:58px; text-align:right; color:#64748b; font-size:11px; }
        .tw-tag { flex-shrink:0; font-size:8.5px; font-weight:900; letter-spacing:.06em; padding:2px 5px; border-radius:6px; background:#7c2d12; color:#fdba74; }
        .tw-btn { padding:7px 12px; border-radius:9px; border:1px solid #334155; background:#111c30; color:#e2e8f0; font-weight:800; font-size:12px; cursor:pointer; flex-shrink:0; white-space:nowrap; }
        .tw-btn:hover:not(:disabled) { border-color:#34d399; }
        .tw-btn:disabled { opacity:.4; cursor:not-allowed; }
        .tw-btn.go { background:#059669; border-color:#059669; color:#fff; }
        .tw-btn.no { background:#7f1d1d; border-color:#991b1b; color:#fecaca; }
        .tw-btn.sm { padding:4px 9px; font-size:11px; }
        .tw-btn--squad { background:#0b1220; border-color:#34d399; color:#a7f3d0; }
        .tw-btn--list { min-width:72px; }
        .tw-btn--offer { min-width:66px; }
        .tw-offer { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:10px 0; border-bottom:1px solid #162033; }
        .tw-offer:last-child { border-bottom:0; }
        .tw-swap { flex:1; min-width:230px; display:flex; align-items:stretch; gap:8px; }
        .tw-swap__side { flex:1; padding:6px 9px; border-radius:10px; background:#111c30; border:1px solid #24344f; }
        .tw-swap__side--in { border-color:#14532d; background:#08251a; }
        .tw-swap__side--out { border-color:#3f2d4a; background:#1a1024; }
        .tw-swap__side span { display:block; font-size:9.5px; letter-spacing:.10em; text-transform:uppercase; color:#64748b; font-weight:900; }
        .tw-swap__side b { display:block; font-size:13px; margin-top:2px; }
        .tw-swap__side small { color:#94a3b8; font-size:11px; }
        .tw-swap__arrow { align-self:center; color:#34d399; font-weight:900; }
        .tw-offer__act { display:flex; gap:7px; }
        .tw-badge { background:#ef4444; color:#fff; border-radius:999px; font-size:10.5px; font-weight:900; padding:0 6px; margin-left:5px; }
        .tw-foot { position:fixed; left:0; right:0; bottom:0; padding:11px 14px; background:#060b16f2; border-top:1px solid #1e293b; display:flex; gap:10px; align-items:center; justify-content:center; flex-wrap:wrap; z-index:30; }
        .tw-foot__hint { font-size:11.5px; color:#64748b; }
        .tw-modal-bg { position:fixed; inset:0; background:#000c; display:flex; align-items:center; justify-content:center; z-index:60; padding:14px; }
        .tw-modal { background:#0b1220; border:1px solid #334155; border-radius:16px; width:100%; max-width:460px; max-height:calc(100vh - 28px); display:flex; flex-direction:column; overflow:hidden; }
        .tw-modal--list { max-width:520px; }
        .tw-modal__head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:16px 16px 12px; border-bottom:1px solid #1e293b; }
        .tw-modal__head h3 { margin:0; font-size:16px; font-weight:900; color:#e2e8f0; }
        .tw-modal__head p { margin:3px 0 0; color:#94a3b8; font-size:12px; }
        .tw-modal__x { width:30px; height:30px; flex-shrink:0; border-radius:8px; border:1px solid #334155; background:#111c30; color:#cbd5e1; font-size:18px; line-height:1; cursor:pointer; }
        .tw-modal__x:hover { border-color:#34d399; }
        .tw-modal__body { padding:12px 16px; overflow-y:auto; }
        .tw-modal label { display:block; font-size:10.5px; letter-spacing:.10em; text-transform:uppercase; color:#64748b; font-weight:900; margin-top:10px; }
        .tw-modal select, .tw-modal input { width:100%; background:#0f172a; color:#e2e8f0; border:1px solid #334155; border-radius:9px; padding:9px; margin-top:5px; font-size:14px; }
        .tw-cashrow { display:flex; gap:6px; margin-top:7px; flex-wrap:wrap; }
        .tw-hintline { font-size:11.5px; color:#94a3b8; margin-top:9px; }
        .tw-modal__act { display:flex; gap:8px; justify-content:flex-end; padding:12px 16px; border-top:1px solid #1e293b; }
        .tw-log { font-size:12px; color:#94a3b8; line-height:1.7; padding:9px 10px; }
        @media (max-width:640px) {
            .tw-val { display:none; }
            .tw-pl { grid-template-columns:34px minmax(0,1fr) 36px auto; gap:7px; min-height:44px; }
            .tw-name { display:flex; }
            .tw-name em { display:none; }
            .tw-name b { font-size:13px; }
            .tw-clubs { grid-template-columns:1fr; }
            .tw-offer { align-items:stretch; }
            .tw-swap { flex-direction:column; min-width:0; }
            .tw-swap__arrow { display:none; }
            .tw-offer__act { width:100%; justify-content:flex-end; }
            .tw-foot__hint { display:none; }
            .tw-head__act { width:100%; }
            .tw-head__act .tw-btn { width:100%; }
        }
        `;
        document.head.appendChild(st);
    }

    function ensureScreen() {
        let el = document.getElementById('screen-transfer-window');
        if (el) return el;
        injectStyles();
        const ref = document.getElementById('screen-season');
        el = document.createElement('div');
        el.id = 'screen-transfer-window';
        el.className = ref ? ref.className.replace(/\bactive\b/g, '').trim() : 'screen';
        if (!el.classList.contains('screen')) el.classList.add('screen');
        (ref && ref.parentNode ? ref.parentNode : document.body).appendChild(el);
        el.addEventListener('click', onClick);
        el.addEventListener('input', onInput);
        el.addEventListener('change', onInput);
        el.addEventListener('keydown', e => {
            if (e.key === 'Escape' && S && (S.modal || S.listing)) {
                S.modal = null;
                S.listing = false;
                render();
            }
        });
        return el;
    }

    function playerRow(p, extra, opts) {
        opts = opts || {};
        const v = Adapter.value(p);
        const club = opts.club === false
            ? ''
            : (typeof opts.club === 'string' ? opts.club : (p.team || p.nationality || ''));
        return `<div class="tw-pl">
            <span class="tw-pos tw-pos--${posGroup(p.mainPos)}">${esc(p.mainPos)}</span>
            <span class="tw-name"><b>${esc(p.name)}</b>${opts.tag === false || !S.listed[p.id] ? '' : '<span class="tw-tag">LISTED</span>'}${club ? `<em>${esc(club)}</em>` : ''}</span>
            <span class="tw-ovr${p.rating >= 90 ? ' is-elite' : ''}">${esc(p.rating)}</span>
            <span class="tw-val">${v != null ? esc(Adapter.fmt(v)) : ''}</span>
            ${extra || ''}</div>`;
    }

    const ownListed = m => (m.squad || []).filter(p => S.listed[p.id]).length;

    // Every listed player in the league except the acting club's own men.
    function listedElsewhere() {
        const out = [];
        gameState.managers.forEach(m => {
            if (String(m.id) === String(S.acting)) return;
            (m.squad || []).forEach(p => { if (S.listed[p.id]) out.push({ p, m }); });
        });
        return out;
    }

    const matchesPos = p => S.posFilter === 'all' || posGroup(p.mainPos) === S.posFilter;

    function posFilterHTML() {
        return `<div class="tw-seg" role="group" aria-label="Filter by position">` +
            [['all', 'All'], ['gk', 'GK'], ['def', 'Def'], ['mid', 'Mid'], ['fwd', 'Att']]
                .map(([key, label]) => `<button type="button" class="${S.posFilter === key ? 'on' : ''}" data-act="pos" data-id="${key}" aria-pressed="${S.posFilter === key}">${label}</button>`).join('') +
            '</div>';
    }

    function viewBar(title, meta) {
        return `<div class="tw-viewbar">
            <div class="tw-viewbar__left">
                <button type="button" class="tw-back" data-act="club" data-id="clubs">← All clubs</button>
                <span class="tw-h">${esc(title)}${meta ? ` <span>${esc(meta)}</span>` : ''}</span>
            </div>
            ${posFilterHTML()}
        </div>`;
    }

    function offerButton(me, owner, p) {
        const already = pendingOffers().some(o => String(o.from) === String(me.id) && String(o.want) === String(p.id));
        const disabled = tradesLeft(me.id) <= 0 || tradesLeft(owner.id) <= 0 || already;
        return `<button type="button" class="tw-btn go tw-btn--offer" data-act="request" data-id="${p.id}" ${disabled ? 'disabled' : ''}>${already ? 'Offered' : 'Offer'}</button>`;
    }

    function clubChooserHTML(me, others, listedTotal) {
        const cards = others.map(m => {
            const count = ownListed(m);
            const left = tradesLeft(m.id);
            return `<button type="button" class="tw-club" data-act="club" data-id="${m.id}">
                <span>
                    <span class="tw-club__name">${esc(m.name)}</span>
                    <span class="tw-club__meta">${(m.squad || []).length} players · ${left}/${MAX_TRADES} swaps left</span>
                </span>
                <span class="tw-club__side">
                    ${count ? `<span class="tw-pill">${count} listed</span>` : ''}
                    <span class="tw-club__go">Browse →</span>
                </span>
            </button>`;
        }).join('');
        return `<p class="tw-help"><b>How it works:</b> pick a club <i>→</i> offer one of your players (+ cash) <i>→</i> they accept or decline. Want offers? Open <b>My squad</b> and list players you would trade.</p>
            <div class="tw-clubs">
                <button type="button" class="tw-club tw-club--listed" data-act="club" data-id="listed">
                    <span>
                        <span class="tw-club__name">Listed players</span>
                        <span class="tw-club__meta">Everyone currently on the market</span>
                    </span>
                    <span class="tw-club__side"><span class="tw-pill">${listedTotal}</span><span class="tw-club__go">View →</span></span>
                </button>
                ${cards}
            </div>`;
    }

    function listedViewHTML(me, listed) {
        const list = listed.filter(entry => matchesPos(entry.p)).sort((a, b) => b.p.rating - a.p.rating);
        let body;
        if (!listed.length) {
            body = '<div class="tw-note">Nobody has listed a player yet. Open “My squad” to put one of yours on the market.</div>';
        } else if (!list.length) {
            body = '<div class="tw-note">No listed players in this position.</div>';
        } else {
            body = `<div class="tw-card">${list.map(({ p, m }) => playerRow(p, offerButton(me, m, p), { club: m.name, tag: false })).join('')}</div>`;
        }
        return `${viewBar('Listed players', `${listed.length} on the market`)}${body}`;
    }

    function clubViewHTML(me, m) {
        const players = (m.squad || []).slice().sort((a, b) => b.rating - a.rating);
        const list = players.filter(matchesPos);
        const left = tradesLeft(m.id);
        const head = viewBar(m.name, `${players.length} players · ${left}/${MAX_TRADES} swaps left`);
        const warning = left <= 0 ? `<p class="tw-help">${esc(m.name)} has used all ${MAX_TRADES} swaps, so no deal can be made here.</p>` : '';
        const body = list.length
            ? `<div class="tw-card">${list.map(p => playerRow(p, offerButton(me, m, p))).join('')}</div>`
            : '<div class="tw-note">No players in this position.</div>';
        return `${head}${warning}${body}`;
    }

    function listingHTML(me) {
        const squad = (me.squad || []).slice().sort((a, b) => b.rating - a.rating);
        const count = ownListed(me);
        const rows = squad.length
            ? squad.map(p => playerRow(p,
                `<button type="button" class="tw-btn tw-btn--list${S.listed[p.id] ? ' go' : ''}" data-act="list" data-id="${p.id}">${S.listed[p.id] ? 'Unlist' : 'List'}</button>`,
                { club: false })).join('')
            : '<div class="tw-note">Your squad is empty.</div>';
        return `<div class="tw-modal-bg">
            <div class="tw-modal tw-modal--list" role="dialog" aria-modal="true" aria-label="My squad">
                <div class="tw-modal__head">
                    <div><h3>My squad</h3><p>${count} listed · others can offer a player for them.</p></div>
                    <button type="button" class="tw-modal__x" data-act="list-close" aria-label="Close">×</button>
                </div>
                <div class="tw-modal__body"><div class="tw-card tw-card--flat">${rows}</div></div>
                <div class="tw-modal__act"><button type="button" class="tw-btn go" data-act="list-close">Done</button></div>
            </div>
        </div>`;
    }

    // One offer, read as "who comes / who goes". `give` always leaves o.from and
    // `want` always arrives there, so the club that received the offer sees the
    // two sides in the opposite order to the club that sent it.
    function offerHTML(o, actions) {
        const A = mgr(o.from), B = mgr(o.to);
        const give = A && A.squad.find(p => String(p.id) === String(o.give));
        const want = B && B.squad.find(p => String(p.id) === String(o.want));
        if (!give || !want) return `<div class="tw-card"><div class="tw-note">This offer is no longer valid.</div></div>`;
        const mine = String(o.to) === String(S.acting);
        const gets = mine ? give : want;
        const pays = mine ? want : give;
        const side = (label, p, cls) => `<div class="tw-swap__side ${cls}">
            <span>${label}</span><b>${esc(p.name)}</b>
            <small>${esc(p.mainPos)} ${esc(p.rating)} · ${esc((p.team || '').trim() || '—')}</small></div>`;
        return `<div class="tw-card"><div class="tw-offer">
            <div class="tw-swap">
                ${side('You get', gets, 'tw-swap__side--in')}
                <div class="tw-swap__arrow">⇄</div>
                ${side('You give', pays, 'tw-swap__side--out')}
            </div>
            ${o.cash > 0 ? `<div class="tw-hintline">${mine ? '+' : '−'} ${esc(Adapter.fmt(o.cash))} cash</div>` : ''}
            <div class="tw-offer__act">${actions}</div>
        </div></div>`;
    }

    function render(resetScroll) {
        const el = document.getElementById('screen-transfer-window');
        if (!el || !S) return;
        if (!gameState.managers || !gameState.managers.length) return;
        if (online()) S.acting = Number(Net.myManagerId);
        const me = mgr(S.acting);
        if (!me) return;
        const others = gameState.managers.filter(m => String(m.id) !== String(me.id));
        const incoming = pendingOffers().filter(o => String(o.to) === String(me.id));
        const sent = pendingOffers().filter(o => String(o.from) === String(me.id));
        const canTrade = tradesLeft(me.id) > 0;
        const allReady = gameState.managers.every(m => S.ready[m.id]);
        const hostDevice = isHost();
        const listed = listedElsewhere();
        const ownCount = ownListed(me);

        const seatChips = gameState.managers.map(m => {
            const inc = pendingOffers().filter(o => String(o.to) === String(m.id)).length;
            const used = Math.max(0, MAX_TRADES - tradesLeft(m.id));
            const attrs = (!online() && hostDevice) ? ` data-act="acting" data-id="${m.id}"` : '';
            const cls = `tw-chip ${String(m.id) === String(me.id) ? 'on' : ''}${online() ? ' tw-static' : ''}`;
            return `<button type="button" class="${cls}"${attrs} aria-pressed="${String(m.id) === String(me.id)}">${esc(m.name)}${S.ready[m.id] ? '<i>✓</i>' : ''}${inc ? `<span class="tw-badge">${inc}</span>` : ''}<small>${used}/${MAX_TRADES} swaps</small></button>`;
        }).join('');

        const seats = (!online() && hostDevice)
            ? `<div class="tw-seatbar"><span class="tw-seatbar__label">Managing</span><div class="tw-seats" title="Switch club">${seatChips}</div></div>`
            : '';

        const sub = online()
            ? `You are <b>${esc(me.name)}</b> · ${tradesLeft(me.id)}/${MAX_TRADES} swaps left`
            : `Halfway through the league · ${MAX_TRADES} swaps per club`;

        const tabs = [['market', 'Market', 0], ['offers', 'Offers', incoming.length]]
            .map(([k, label, count]) => `<button type="button" class="tw-tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-id="${k}" role="tab" aria-selected="${S.tab === k}">${label}${count ? `<span>${count}</span>` : ''}</button>`).join('');

        let body = '';
        if (S.tab === 'market') {
            if (!others.length) {
                body += '<div class="tw-note">No other clubs in this league, so no swaps are possible. End the window to play the second half.</div>';
            } else {
                const validClub = S.filter === 'clubs' || S.filter === 'listed'
                    || others.some(m => String(m.id) === String(S.filter));
                if (!validClub) { S.filter = 'clubs'; S.posFilter = 'all'; }
                if (!canTrade) body += `<p class="tw-help">You have used all ${MAX_TRADES} swaps. You can still browse and list players.</p>`;
                if (S.filter === 'clubs') body += clubChooserHTML(me, others, listed.length);
                else if (S.filter === 'listed') body += listedViewHTML(me, listed);
                else body += clubViewHTML(me, others.find(m => String(m.id) === String(S.filter)));
            }
        } else {
            body += `<p class="tw-help">Accepting a swap moves both players and uses one trade for each club.</p>`;
            body += `<div class="tw-group"><div class="tw-h">For you${incoming.length ? ` <span>· ${incoming.length}</span>` : ''}</div>`;
            body += incoming.length ? incoming.map(o => offerHTML(o,
                `<button type="button" class="tw-btn go" data-act="accept" data-id="${o.id}" ${canTrade && tradesLeft(o.from) > 0 ? '' : 'disabled'}>Accept</button>
                <button type="button" class="tw-btn no" data-act="decline" data-id="${o.id}">Decline</button>`)).join('')
                : '<div class="tw-note">No club has asked you for a player.</div>';
            body += '</div>';
            body += `<div class="tw-group"><div class="tw-h">Sent by you${sent.length ? ` <span>· ${sent.length}</span>` : ''}</div>`;
            body += sent.length ? sent.map(o => offerHTML(o,
                `<button type="button" class="tw-btn" data-act="withdraw" data-id="${o.id}">Withdraw</button>`)).join('')
                : '<div class="tw-note">You have not asked anyone for a player yet.</div>';
            body += '</div>';
        }

        const log = (S.tab === 'offers' && S.log.length)
            ? `<div class="tw-h">Completed swaps</div><div class="tw-card tw-log">${S.log.map(esc).join('<br>')}</div>` : '';
        const modal = S.listing ? listingHTML(me) : (S.modal ? modalHTML(me) : '');
        const doneCount = gameState.managers.filter(m => S.ready[m.id]).length;
        const closeBtn = hostDevice
            ? `<button type="button" class="tw-btn ${allReady ? 'go' : ''}" data-act="close">${allReady ? 'Play the second half' : 'End window'}</button>`
            : '<button type="button" class="tw-btn" disabled>Waiting for host…</button>';

        const scrollTop = el.scrollTop;
        const oldModalBody = el.querySelector('.tw-modal__body');
        const modalScroll = oldModalBody ? oldModalBody.scrollTop : 0;
        el.innerHTML = `<div class="tw-wrap">
            <header class="tw-head">
                <div>
                    <h2 class="tw-title">Transfer window</h2>
                    <p class="tw-sub">${sub}</p>
                </div>
                <div class="tw-head__act">
                    <button type="button" class="tw-btn tw-btn--squad" data-act="list-open" aria-haspopup="dialog">My squad${ownCount ? ` · ${ownCount} listed` : ''}</button>
                </div>
            </header>
            ${seats}
            <nav class="tw-tabs" role="tablist">${tabs}</nav>
            ${body}
            ${log}
        </div>
        <div class="tw-foot">
            <button type="button" class="tw-btn ${S.ready[me.id] ? '' : 'go'}" data-act="ready" aria-pressed="${!!S.ready[me.id]}">${S.ready[me.id] ? 'Keep trading' : 'Done trading'}</button>
            <span class="tw-foot__hint">${doneCount}/${gameState.managers.length} clubs done</span>
            ${closeBtn}
        </div>${modal}`;
        el.scrollTop = resetScroll ? 0 : scrollTop;
        const newModalBody = el.querySelector('.tw-modal__body');
        if (newModalBody) newModalBody.scrollTop = resetScroll ? 0 : modalScroll;
    }

    function modalHTML(me) {
        const B = gameState.managers.find(m => (m.squad || []).some(p => String(p.id) === String(S.modal.want)));
        const want = B && (B.squad || []).find(p => String(p.id) === String(S.modal.want));
        if (!want) { S.modal = null; return ''; }
        const mine = (me.squad || []).filter(p => isGK(p) === isGK(want)).sort((a, b) => b.rating - a.rating);
        if (!mine.length) {
            return `<div class="tw-modal-bg"><div class="tw-modal" role="dialog" aria-modal="true" aria-label="No swap available">
                <div class="tw-modal__head">
                    <div><h3>No ${isGK(want) ? 'goalkeeper' : 'outfield player'} to swap</h3></div>
                    <button type="button" class="tw-modal__x" data-act="modal-cancel" aria-label="Close">×</button>
                </div>
                <div class="tw-modal__body">
                    <p class="tw-hintline">Goalkeepers only trade for goalkeepers. ${esc(B.name)} wants ${esc(want.name)}, and you have nobody at ${esc(want.mainPos)} to send back.</p>
                </div>
                <div class="tw-modal__act"><button type="button" class="tw-btn" data-act="modal-cancel">Close</button></div>
            </div></div>`;
        }
        if (!mine.some(p => String(p.id) === String(S.modal.give))) S.modal.give = mine[0].id;
        const give = mine.find(p => String(p.id) === String(S.modal.give));
        const diff = want.rating - give.rating;
        const budget = Adapter.getBudget(me);
        const cash = Math.min(S.modal.cash || 0, budget);
        const cashRow = Adapter.hasBudget(me)
            ? `<label>Add cash from you · ${esc(Adapter.fmt(budget))} available</label>
               <input type="number" inputmode="numeric" min="0" max="${budget}" step="1" value="${cash}" data-field="cash">
               <div class="tw-cashrow">
                   <button type="button" class="tw-btn sm" data-act="cash" data-id="down">− ${CASH_STEP}</button>
                   <button type="button" class="tw-btn sm" data-act="cash" data-id="up">+ ${CASH_STEP}</button>
                   <button type="button" class="tw-btn sm" data-act="cash" data-id="zero">0</button>
                   <button type="button" class="tw-btn sm" data-act="cash" data-id="max">Max</button>
               </div>` : '';
        const hint = diff > 0
            ? `You are asking for a player ${diff} higher — cash usually tempts ${esc(B.name)}.`
            : diff < 0 ? `You are offering ${-diff} higher, so they may take this without cash.`
            : 'Even ratings — cash is what tips the deal.';
        return `<div class="tw-modal-bg"><div class="tw-modal" role="dialog" aria-modal="true" aria-label="Make an offer">
            <div class="tw-modal__head">
                <div>
                    <h3>Offer for ${esc(want.name)}</h3>
                    <p>${esc(B.name)} · ${esc(want.mainPos)} ${esc(want.rating)}${want.team ? ' · ' + esc(want.team) : ''}</p>
                </div>
                <button type="button" class="tw-modal__x" data-act="modal-cancel" aria-label="Close">×</button>
            </div>
            <div class="tw-modal__body">
                <label>You give</label>
                <select data-field="give">${mine.map(p => `<option value="${p.id}" ${String(p.id) === String(S.modal.give) ? 'selected' : ''}>${esc(p.mainPos)} ${esc(p.rating)} · ${esc(p.name)}</option>`).join('')}</select>
                ${cashRow}
                <div class="tw-hintline">${hint}</div>
            </div>
            <div class="tw-modal__act">
                <button type="button" class="tw-btn" data-act="modal-cancel">Cancel</button>
                <button type="button" class="tw-btn go" data-act="modal-send">Send offer</button>
            </div>
        </div></div>`;
    }

    // The number field is the fiddly control on a phone, so the offer dialog also
    // steps cash in fixed amounts. Capped at the budget; validation still runs on send.
    function adjustCash(kind) {
        if (!S || !S.modal) return;
        const me = mgr(S.acting);
        const budget = me ? Math.max(0, Adapter.getBudget(me)) : 0;
        const current = Math.max(0, Math.floor(Number(S.modal.cash) || 0));
        const next = kind === 'up' ? current + CASH_STEP
            : kind === 'down' ? current - CASH_STEP
            : kind === 'zero' ? 0 : budget;
        S.modal.cash = Math.min(budget, Math.max(0, Math.floor(next)));
        render();
    }

    function onInput(e) {
        const f = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
        if (!f || !S || !S.modal) return;
        if (f === 'cash') S.modal.cash = Math.max(0, Math.floor(Number(e.target.value) || 0));
        if (f === 'give' && e.type === 'change') {
            const me = mgr(S.acting);
            const pick = me && (me.squad || []).find(pl => String(pl.id) === e.target.value);
            if (pick) S.modal.give = pick.id;
            render();
        }
    }

    function resolveId(act, raw) {
        let id = raw;
        if (act === 'acting') {
            const m = gameState.managers.find(x => String(x.id) === raw);
            if (m) id = m.id;
        } else if (act === 'accept' || act === 'decline' || act === 'withdraw') {
            id = Number(raw);
        } else if (act === 'request' || act === 'list') {
            gameState.managers.forEach(m => (m.squad || []).forEach(pl => { if (String(pl.id) === raw) id = pl.id; }));
        }
        return id;
    }

    function sendCommand(extra) {
        if (!online() || Net.isHost) return;
        Net.send('transfer', Object.assign({ managerId: Number(Net.myManagerId) }, extra));
    }

    // A guest may only change local view state in place; anything that changes the
    // window is sent to the host and comes back as a snapshot.
    function guestAction(act, id, raw) {
        switch (act) {
            case 'acting': return;
            case 'tab': S.tab = raw; S.modal = null; S.listing = false; break;
            case 'club': S.filter = raw; S.posFilter = 'all'; break;
            case 'pos': S.posFilter = raw; break;
            case 'list-open': S.listing = true; S.modal = null; break;
            case 'list-close': S.listing = false; break;
            case 'request': S.listing = false; S.modal = { want: id, give: null, cash: 0 }; break;
            case 'modal-cancel': S.modal = null; break;
            case 'cash': return adjustCash(raw);
            case 'modal-send': {
                if (!S.modal) return;
                const m = S.modal;
                S.modal = null;
                sendCommand({ action: 'offer', want: m.want, give: m.give, cash: m.cash });
                break;
            }
            case 'list': {
                // Optimistic: the host's snapshot is the source of truth.
                if (S.listed[id]) delete S.listed[id]; else S.listed[id] = true;
                sendCommand({ action: 'list', playerId: id });
                break;
            }
            case 'accept': sendCommand({ action: 'accept', offerId: id }); break;
            case 'decline': sendCommand({ action: 'decline', offerId: id }); break;
            case 'withdraw': sendCommand({ action: 'withdraw', offerId: id }); break;
            case 'ready': S.ready[S.acting] = !S.ready[S.acting]; sendCommand({ action: 'ready' }); break;
            case 'close': return;
        }
        render(act === 'tab' || act === 'club');
    }

    function onClick(e) {
        if (!S) return;
        const btn = e.target.closest && e.target.closest('[data-act]');
        if (!btn) {
            if (e.target.classList && e.target.classList.contains('tw-modal-bg')) {
                S.modal = null;
                S.listing = false;
                render();
            }
            return;
        }
        if (btn.disabled) return;
        const act = btn.getAttribute('data-act');
        const raw = btn.getAttribute('data-id');
        const id = resolveId(act, raw);

        if (online() && !Net.isHost) return guestAction(act, id, raw);

        switch (act) {
            case 'acting': S.acting = id; S.modal = null; S.listing = false; S.filter = 'clubs'; S.posFilter = 'all'; break;
            case 'tab': S.tab = raw; S.modal = null; S.listing = false; break;
            case 'club': S.filter = raw; S.posFilter = 'all'; break;
            case 'pos': S.posFilter = raw; break;
            case 'list-open': S.listing = true; S.modal = null; break;
            case 'list-close': S.listing = false; break;
            case 'request': S.listing = false; S.modal = { want: id, give: null, cash: 0 }; break;
            case 'modal-cancel': S.modal = null; break;
            case 'cash': return adjustCash(raw);
            case 'modal-send': return sendOffer(S.acting, S.modal.want, S.modal.give, S.modal.cash);
            case 'list': return toggleList(S.acting, id);
            case 'accept': return respond(S.acting, id, true);
            case 'decline': return respond(S.acting, id, false);
            case 'withdraw': return withdraw(S.acting, id);
            case 'ready': return toggleReady(S.acting);
            case 'close': return closeWindow();
        }
        render(act === 'tab' || act === 'club' || act === 'acting');
    }

    // Host side of a guest command. `managerId` is the seat the room says sent it.
    function hostAction(managerId, action, payload) {
        if (!S || !isHost()) return;
        const mid = Number(managerId);
        if (!Number.isFinite(mid)) return;
        payload = payload || {};
        switch (action) {
            case 'offer': return sendOffer(mid, payload.want, payload.give, payload.cash);
            case 'list': return toggleList(mid, payload.playerId);
            case 'accept': return respond(mid, Number(payload.offerId), true);
            case 'decline': return respond(mid, Number(payload.offerId), false);
            case 'withdraw': return withdraw(mid, Number(payload.offerId));
            case 'ready': return toggleReady(mid);
        }
    }

    // A guest moved a player in its own XI / bench. Its local copy of those
    // assignments is the one that drives its next formation edit, so apply the
    // same swap the host made.
    function remapOwnSwaps() {
        if (!online()) return;
        const mine = Number(Net.myManagerId);
        const m = mgr(mine);
        if (!m) return;
        let changed = false;
        S.swaps.forEach(sw => {
            if (S.appliedSwaps[sw.seq]) return;
            let outId = null, inId = null;
            if (Number(sw.a) === mine) { outId = sw.aOut; inId = sw.aIn; }
            else if (Number(sw.b) === mine) { outId = sw.bOut; inId = sw.bIn; }
            if (outId == null) return;
            (m.formation || []).forEach(n => {
                if (String(n.assignedPlayerId) === String(outId)) { n.assignedPlayerId = inId; changed = true; }
            });
            (m.bench || []).forEach(n => {
                if (String(n.assignedPlayerId) === String(outId)) { n.assignedPlayerId = inId; changed = true; }
            });
            S.appliedSwaps[sw.seq] = true;
        });
        if (changed) {
            if (typeof refreshLineup === 'function' && document.getElementById(`pitch-${mine}`)) refreshLineup(mine);
            else if (typeof Net.publishOwn === 'function') Net.publishOwn(mine);
        }
    }

    function applySnapshot(snap) {
        if (snap === null || snap === undefined) { S = null; return; }
        const fresh = !S;
        if (!S) S = blankState();
        applyShared(snap);
        if (online()) S.acting = Number(Net.myManagerId);
        remapOwnSwaps();
        if (fresh) S.seenNotice = S.noticeSeq;
        else if (S.noticeSeq > S.seenNotice) {
            S.seenNotice = S.noticeSeq;
            if (S.noticeText) toast(S.noticeText);
        }
        if (document.getElementById('screen-transfer-window')?.classList.contains('active')) render();
    }

    function closeWindow() {
        if (!S) return;
        if (online() && !Net.isHost) return;
        const allReady = gameState.managers.every(m => S.ready[m.id]);
        if (!allReady && typeof confirm === 'function' && !confirm('Not every manager is done. Close the transfer window anyway?')) return;
        const { run, onClose } = S;
        // Rebuild the human teams from the (possibly changed) squads; keep the same objects
        // because the fixture list points at them.
        if (run && Array.isArray(run.humans)) {
            run.humans.forEach(team => {
                const m = mgr(team.managerId);
                if (!m) return;
                const fresh = createTeamState(m);
                Object.assign(team, { lineup: fresh.lineup, bench: fresh.bench, reserves: fresh.reserves, tactics: fresh.tactics, subs: 0 });
            });
        }
        // Bring the squad lists, pitch and balances on the game screen in line with the new squads.
        gameState.managers.forEach(m => {
            try {
                if (typeof refreshLineup === 'function') refreshLineup(m.id);
                else if (typeof updateDashboard === 'function') updateDashboard(m.id);
            } catch (err) { console.warn('Transfer refresh failed for', m.name, err); }
        });
        S = null;
        if (online() && Net.isHost && typeof Net.publishTransferNow === 'function') Net.publishTransferNow();
        if (typeof onClose === 'function') onClose();
    }

    function openTransferWindow(run, onClose, restored) {
        if (online() && !Net.isHost) return;
        ensureScreen();
        S = blankState();
        S.run = run;
        S.onClose = onClose;
        S.acting = online()
            ? Number(Net.myManagerId)
            : (gameState.managers[0] ? gameState.managers[0].id : null);
        gameState.managers.forEach(m => { S.trades[m.id] = 0; S.ready[m.id] = false; });
        // A reloaded local save brings back the offers, trades and listings.
        if (restored) applyShared(restored);
        showScreen('screen-transfer-window');
        render();
        publishShared(true);
    }

    function clearWindow() {
        S = null;
    }

    // Guest: the screen arrived before (or after) the state snapshot.
    function showGuestWindow() {
        if (!online() || Net.isHost) return;
        ensureScreen();
        if (!S) { S = blankState(); S.acting = Number(Net.myManagerId); }
        render();
    }

    globalThis.openTransferWindow = openTransferWindow;
    globalThis.TransferWindow = {
        open: openTransferWindow,
        showGuest: showGuestWindow,
        applySnapshot,
        hostAction,
        snapshot,
        persist: snapshot,
        clear: clearWindow,
        _send: (...a) => sendOffer(...a),
        _respond: respond,
        _state: () => S,
        _validate: validate
    };
})();
