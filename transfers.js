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
            acting: null, tab: 'market', filter: 'all', modal: null,
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
    function injectStyles() {
        if (document.getElementById('tw-styles')) return;
        const st = document.createElement('style');
        st.id = 'tw-styles';
        st.textContent = `
        #screen-transfer-window { overflow-y:auto; padding:20px 16px 90px; color:#e2e8f0; }
        .tw-wrap { max-width:960px; margin:0 auto; }
        .tw-title { font-size:22px; font-weight:800; color:#34d399; margin:0; }
        .tw-sub { color:#94a3b8; font-size:13px; margin:2px 0 14px; }
        .tw-row-top { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
        .tw-chip { padding:7px 12px; border-radius:10px; border:1px solid #334155; background:#0f172a; color:#cbd5e1; font-size:13px; font-weight:700; cursor:pointer; }
        .tw-chip.on { background:#064e3b; border-color:#34d399; color:#6ee7b7; }
        .tw-chip.tw-static { cursor:default; }
        .tw-chip small { display:block; font-weight:500; color:#94a3b8; font-size:11px; }
        .tw-card { background:#0b1220; border:1px solid #1e293b; border-radius:12px; padding:10px 12px; margin-bottom:10px; }
        .tw-h { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#64748b; font-weight:800; margin:14px 0 6px; }
        .tw-pl { display:flex; align-items:center; gap:10px; padding:7px 4px; border-bottom:1px solid #162033; }
        .tw-pl:last-child { border-bottom:0; }
        .tw-pos { width:38px; font-size:11px; font-weight:800; color:#94a3b8; }
        .tw-name { flex:1; font-weight:700; font-size:14px; }
        .tw-name em { font-style:normal; font-size:11px; color:#94a3b8; font-weight:500; margin-left:6px; }
        .tw-ovr { font-weight:800; color:#fbbf24; width:30px; text-align:right; }
        .tw-val { width:64px; text-align:right; color:#94a3b8; font-size:12px; }
        .tw-tag { font-size:10px; font-weight:800; padding:2px 6px; border-radius:6px; background:#7c2d12; color:#fdba74; margin-left:6px; }
        .tw-btn { padding:6px 12px; border-radius:8px; border:1px solid #334155; background:#111c30; color:#e2e8f0; font-weight:700; font-size:12px; cursor:pointer; }
        .tw-btn:hover:not(:disabled) { border-color:#34d399; }
        .tw-btn:disabled { opacity:.4; cursor:not-allowed; }
        .tw-btn.go { background:#059669; border-color:#059669; color:#fff; }
        .tw-btn.no { background:#7f1d1d; border-color:#7f1d1d; color:#fff; }
        .tw-offer { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
        .tw-offer .txt { flex:1; min-width:240px; font-size:14px; line-height:1.4; }
        .tw-badge { background:#ef4444; color:#fff; border-radius:999px; font-size:11px; padding:1px 7px; margin-left:6px; }
        .tw-foot { position:fixed; left:0; right:0; bottom:0; padding:12px 16px; background:#060b16ee; border-top:1px solid #1e293b; display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
        .tw-modal-bg { position:fixed; inset:0; background:#000a; display:flex; align-items:center; justify-content:center; z-index:50; padding:16px; }
        .tw-modal { background:#0b1220; border:1px solid #334155; border-radius:14px; padding:18px; width:100%; max-width:430px; }
        .tw-modal select, .tw-modal input { width:100%; background:#0f172a; color:#e2e8f0; border:1px solid #334155; border-radius:8px; padding:8px; margin:4px 0 10px; font-size:14px; }
        .tw-log { font-size:12px; color:#94a3b8; }
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
        return el;
    }

    function playerRow(p, extra) {
        const v = Adapter.value(p);
        return `<div class="tw-pl"><span class="tw-pos">${esc(p.mainPos)}</span>
            <span class="tw-name">${esc(p.name)}${S.listed[p.id] ? '<span class="tw-tag">FOR SALE</span>' : ''}<em>${esc(p.team || '')}</em></span>
            <span class="tw-ovr">${esc(p.rating)}</span>${v != null ? `<span class="tw-val">${esc(Adapter.fmt(v))}</span>` : ''}
            ${extra || ''}</div>`;
    }

    function offerText(o) {
        const A = mgr(o.from), B = mgr(o.to);
        const give = A && A.squad.find(p => String(p.id) === String(o.give));
        const want = B && B.squad.find(p => String(p.id) === String(o.want));
        if (!give || !want) return 'Offer no longer valid.';
        const cash = o.cash > 0 ? ` <b>+ ${esc(Adapter.fmt(o.cash))}</b>` : '';
        return `<b>${esc(A.name)}</b> offers <b>${esc(give.name)}</b> (${esc(give.mainPos)} ${esc(give.rating)})${cash} for <b>${esc(want.name)}</b> (${esc(want.mainPos)} ${esc(want.rating)}) from <b>${esc(B.name)}</b>`;
    }

    function render() {
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

        const mgrChips = gameState.managers.map(m => {
            const inc = pendingOffers().filter(o => String(o.to) === String(m.id)).length;
            const used = Math.max(0, MAX_TRADES - tradesLeft(m.id));
            const attrs = (!online() && hostDevice) ? ` data-act="acting" data-id="${m.id}"` : '';
            const cls = `tw-chip ${String(m.id) === String(me.id) ? 'on' : ''}${online() ? ' tw-static' : ''}`;
            return `<button type="button" class="${cls}"${attrs}>${esc(m.name)}${S.ready[m.id] ? ' ✓' : ''}${inc ? `<span class="tw-badge">${inc}</span>` : ''}<small>${used}/${MAX_TRADES} trades${Adapter.hasBudget(m) ? ' · ' + esc(Adapter.fmt(Adapter.getBudget(m))) : ''}</small></button>`;
        }).join('');

        const tabs = [['market', 'Market'], ['squad', 'My squad'], ['inbox', 'Offers' + (incoming.length ? ` (${incoming.length})` : '')]]
            .map(([k, label]) => `<button type="button" class="tw-chip ${S.tab === k ? 'on' : ''}" data-act="tab" data-id="${k}">${label}</button>`).join('');

        let body = '';
        if (S.tab === 'market') {
            if (!others.length) {
                body += '<div class="tw-sub">There are no other managers in this league, so no trades can be made. Press “I’m done” to continue.</div>';
            } else {
                const filters = [`<button type="button" class="tw-chip ${S.filter === 'all' ? 'on' : ''}" data-act="filter" data-id="all">Everyone</button>`,
                    `<button type="button" class="tw-chip ${S.filter === 'sale' ? 'on' : ''}" data-act="filter" data-id="sale">For sale only</button>`]
                    .concat(others.map(m => `<button type="button" class="tw-chip ${S.filter === String(m.id) ? 'on' : ''}" data-act="filter" data-id="${m.id}">${esc(m.name)}</button>`)).join('');
                body += `<div class="tw-row-top">${filters}</div>`;
                let anyCards = false;
                others.filter(m => S.filter === 'all' || S.filter === 'sale' || S.filter === String(m.id)).forEach(m => {
                    let list = (m.squad || []).slice().sort((a, b) => (S.listed[b.id] ? 1 : 0) - (S.listed[a.id] ? 1 : 0) || b.rating - a.rating);
                    if (S.filter === 'sale') list = list.filter(p => S.listed[p.id]);
                    if (!list.length) return;
                    anyCards = true;
                    body += `<div class="tw-h">${esc(m.name)}${tradesLeft(m.id) <= 0 ? ' · no trades left' : ''}</div><div class="tw-card">` +
                        list.map(p => {
                            const has = pendingOffers().some(o => String(o.from) === String(me.id) && String(o.want) === String(p.id));
                            const dis = !canTrade || tradesLeft(m.id) <= 0 || has;
                            return playerRow(p, `<button type="button" class="tw-btn go" data-act="request" data-id="${p.id}" ${dis ? 'disabled' : ''}>${has ? 'Offer sent' : 'Make offer'}</button>`);
                        }).join('') + '</div>';
                });
                if (!anyCards) body += '<div class="tw-sub">Nobody has anything on the market right now.</div>';
            }
        } else if (S.tab === 'squad') {
            body += `<div class="tw-sub">Put a player up for sale and other managers can offer you a player (plus cash) for him. You choose which deal to accept.</div><div class="tw-card">` +
                (me.squad || []).slice().sort((a, b) => b.rating - a.rating).map(p => playerRow(p,
                    `<button type="button" class="tw-btn" data-act="list" data-id="${p.id}">${S.listed[p.id] ? 'Take off market' : 'List for sale'}</button>`)).join('') + '</div>';
        } else {
            body += `<div class="tw-h">Offers for you</div>`;
            body += incoming.length ? incoming.map(o => `<div class="tw-card tw-offer"><div class="txt">${offerText(o)}</div>
                <button type="button" class="tw-btn go" data-act="accept" data-id="${o.id}" ${canTrade && tradesLeft(o.from) > 0 ? '' : 'disabled'}>Accept</button>
                <button type="button" class="tw-btn no" data-act="decline" data-id="${o.id}">Decline</button></div>`).join('')
                : '<div class="tw-sub">No offers waiting.</div>';
            body += `<div class="tw-h">Offers you sent</div>`;
            body += sent.length ? sent.map(o => `<div class="tw-card tw-offer"><div class="txt">${offerText(o)}</div>
                <button type="button" class="tw-btn" data-act="withdraw" data-id="${o.id}">Withdraw</button></div>`).join('')
                : '<div class="tw-sub">Nothing pending.</div>';
        }

        const modal = S.modal ? modalHTML(me) : '';
        const closeBtn = hostDevice
            ? `<button type="button" class="tw-btn ${allReady ? 'go' : ''}" data-act="close">${allReady ? 'Start the second half' : 'Close window now'}</button>`
            : '<button type="button" class="tw-btn" disabled>Waiting for host…</button>';
        el.innerHTML = `<div class="tw-wrap">
            <h2 class="tw-title">Mid-Season Transfer Window</h2>
            <div class="tw-sub">Halfway through the league. Swap players with other managers — at most ${MAX_TRADES} trades each. You are acting as <b>${esc(me.name)}</b>${canTrade ? '' : ' (no trades left)'}.</div>
            <div class="tw-row-top">${mgrChips}</div>
            <div class="tw-row-top">${tabs}</div>
            ${body}
            ${S.log.length ? `<div class="tw-h">Completed trades</div><div class="tw-card tw-log">${S.log.map(esc).join('<br>')}</div>` : ''}
        </div>
        <div class="tw-foot">
            <button type="button" class="tw-btn ${S.ready[me.id] ? '' : 'go'}" data-act="ready">${S.ready[me.id] ? 'Not done yet' : "I'm done"}</button>
            ${closeBtn}
        </div>${modal}`;
    }

    function modalHTML(me) {
        const B = gameState.managers.find(m => (m.squad || []).some(p => String(p.id) === String(S.modal.want)));
        const want = B && (B.squad || []).find(p => String(p.id) === String(S.modal.want));
        if (!want) { S.modal = null; return ''; }
        const mine = (me.squad || []).filter(p => isGK(p) === isGK(want)).sort((a, b) => b.rating - a.rating);
        if (!mine.length) {
            return `<div class="tw-modal-bg"><div class="tw-modal">
                <div class="tw-title" style="font-size:18px">Cannot offer for ${esc(want.name)}</div>
                <div class="tw-sub">You have no ${isGK(want) ? 'goalkeeper' : 'outfield player'} to swap. Goalkeepers can only be traded for goalkeepers.</div>
                <div style="display:flex;justify-content:flex-end"><button type="button" class="tw-btn" data-act="modal-cancel">Close</button></div>
            </div></div>`;
        }
        if (!mine.some(p => String(p.id) === String(S.modal.give))) S.modal.give = mine[0].id;
        const give = mine.find(p => String(p.id) === String(S.modal.give));
        const diff = want.rating - give.rating;
        const cashBlock = Adapter.hasBudget(me)
            ? `<label>Extra cash from you (you have ${esc(Adapter.fmt(Adapter.getBudget(me)))})</label>
               <input type="number" min="0" max="${Adapter.getBudget(me)}" step="1" value="${S.modal.cash || 0}" data-field="cash">` : '';
        return `<div class="tw-modal-bg"><div class="tw-modal">
            <div class="tw-title" style="font-size:18px">Offer for ${esc(want.name)}</div>
            <div class="tw-sub">${esc(want.mainPos)} · ${esc(want.rating)} · ${esc(B.name)}</div>
            <label>You give</label>
            <select data-field="give">${mine.map(p => `<option value="${p.id}" ${String(p.id) === String(S.modal.give) ? 'selected' : ''}>${esc(p.mainPos)} · ${esc(p.name)} (${esc(p.rating)})</option>`).join('')}</select>
            <div class="tw-sub" id="tw-hint">${diff > 0 ? `You are asking for a player ${diff} rated higher — add cash to tempt ${esc(B.name)}.` : diff < 0 ? `You are offering a player ${-diff} rated higher.` : 'Equal ratings.'}</div>
            ${cashBlock}
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="tw-btn" data-act="modal-cancel">Cancel</button>
                <button type="button" class="tw-btn go" data-act="modal-send">Send offer</button>
            </div></div></div>`;
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
            case 'tab': S.tab = raw; break;
            case 'filter': S.filter = raw; break;
            case 'request': S.modal = { want: id, give: null, cash: 0 }; break;
            case 'modal-cancel': S.modal = null; break;
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
        render();
    }

    function onClick(e) {
        const btn = e.target.closest && e.target.closest('[data-act]');
        if (!btn || !S || btn.disabled) return;
        const act = btn.getAttribute('data-act');
        const raw = btn.getAttribute('data-id');
        const id = resolveId(act, raw);

        if (online() && !Net.isHost) return guestAction(act, id, raw);

        switch (act) {
            case 'acting': S.acting = id; S.modal = null; break;
            case 'tab': S.tab = raw; break;
            case 'filter': S.filter = raw; break;
            case 'request': S.modal = { want: id, give: null, cash: 0 }; break;
            case 'modal-cancel': S.modal = null; break;
            case 'modal-send': return sendOffer(S.acting, S.modal.want, S.modal.give, S.modal.cash);
            case 'list': return toggleList(S.acting, id);
            case 'accept': return respond(S.acting, id, true);
            case 'decline': return respond(S.acting, id, false);
            case 'withdraw': return withdraw(S.acting, id);
            case 'ready': return toggleReady(S.acting);
            case 'close': return closeWindow();
        }
        render();
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
