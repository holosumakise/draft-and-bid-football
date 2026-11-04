// ============================================================
// LIVE AUCTION — one bidder at a time, every bid public.
//
// Bidding is strictly turn-based: the current bidder is the only manager with
// controls. The amount lives in the input field itself, so it is visible only
// to the manager holding the device.
// ============================================================

let auctionClockId = null;

// PASS is deliberate: it must be held down, so a mis-tap cannot end a club's
// auction. The progress fill is driven by CSS in index.html.
const PASS_HOLD_MS = 900;
let passHold = null;

function clearAuctionTimer() {
    if (auctionClockId) {
        clearInterval(auctionClockId);
        auctionClockId = null;
    }
}

function auctionManagerById(id) {
    return gameState.managers.find(m => m.id === id) || null;
}

function auctionEligibleIds() {
    return gameState.managers
        .filter(m => !m.formationLocked && m.squad.length < MAX_SQUAD_SIZE && getManagerMaxBid(m) >= MIN_BID)
        .map(m => m.id);
}

// Rotate who opens the bidding so no club always gets first refusal.
function rotateOpeningOrder(ids) {
    if (ids.length < 2) return ids.slice();
    gameState.auctionAnchor = (gameState.auctionAnchor + 1) % ids.length;
    return ids.slice(gameState.auctionAnchor).concat(ids.slice(0, gameState.auctionAnchor));
}

function getOpenAuction() {
    return gameState.auction && gameState.auction.status === 'open' ? gameState.auction : null;
}

function auctionBidFloor() {
    const a = gameState.auction;
    if (!a) return MIN_BID;
    return a.highBid > 0 ? a.highBid + 1 : MIN_BID;
}

// After the leader passes or times out, the best remaining bid takes over. A
// passed club's earlier bid is not a debt owed by anybody else.
function recomputeAuctionHighBid(a) {
    if (!a) return;
    let bestId = null, best = 0;
    auctionActiveIds().forEach(id => {
        const bid = a.topBidOf[id] || 0;
        if (bid > best) { best = bid; bestId = id; }
    });
    a.highBid = best;
    a.highBidderId = best > 0 ? bestId : null;
}

function auctionActiveIds() {
    const a = gameState.auction;
    if (!a) return [];
    return a.order.filter(id => !a.out[id]);
}

function auctionCurrentBidderId() {
    const a = getOpenAuction();
    return a ? a.order[a.turnIdx] : null;
}

// A bidder stays in only while they can still outbid the current high bid.
function auctionCanAffordToRaise(managerId) {
    const m = auctionManagerById(managerId);
    return !!m && getManagerMaxBid(m) >= auctionBidFloor();
}

function startAuction() {
    const draft = gameState.activeDraft;
    if (!draft) return false;
    const eligible = rotateOpeningOrder(auctionEligibleIds());

    if (!eligible.length) {
        // Nobody can cover the reserve, so this costs no skip.
        finishAuctionUnsold(draft.player, true);
        return false;
    }

    gameState.auction = {
        order: eligible,
        turnIdx: 0,
        turnSerial: 1,
        highBid: 0,
        highBidderId: null,
        topBidOf: {},
        out: {},
        status: 'open',
        turnEndsAt: Date.now() + SHOT_CLOCK_MS
    };
    clearAuctionTimer();
    auctionClockId = setInterval(tickAuctionClock, AUCTION_TICK_MS);
    openAuctionTurn();
    return true;
}

// Hand the gavel to the next manager still in, or settle the player. The loop
// only walks the seat order, so a full circuit is enough to find a bidder.
function openAuctionTurn() {
    const a = gameState.auction;
    if (!a || a.status !== 'open') return;

    for (let guard = 0; guard <= a.order.length; guard++) {
        const active = auctionActiveIds();
        if (!active.length) { finishAuctionUnsold(currentAuctionPlayer(), false); return; }

        // One club left: only their own bid can be the price. If nobody ever bid,
        // the high bid stays 0 and their pass discards the player instead of
        // inventing a sale.
        if (active.length === 1) {
            const lastMan = active[0];
            const own = a.topBidOf[lastMan] || 0;
            a.highBidderId = own ? lastMan : null;
            a.highBid = own;

            // Nobody left to raise against and no reason to ask a club to bid
            // itself up: if they cannot afford the next credit, sell now.
            if (a.highBidderId === lastMan && !auctionCanAffordToRaise(lastMan)) {
                finishAuctionSold();
                return;
            }

            a.turnIdx = a.order.indexOf(lastMan);
            a.turnSerial = (a.turnSerial || 0) + 1;
            a.turnEndsAt = Date.now() + SHOT_CLOCK_MS;
            Net.publishAuctionNow();
            renderDraftBoard();
            return;
        }

        const bidderId = a.order[a.turnIdx];
        // A leader who can no longer add a credit is not "out": they can still buy
        // at the price they already set, so they must reach the buy/pass panel.
        const holdsHighBid = a.highBidderId === bidderId && a.highBid > 0;
        if (a.out[bidderId] || (!holdsHighBid && !auctionCanAffordToRaise(bidderId))) {
            a.out[bidderId] = true;
            recomputeAuctionHighBid(a);
            a.turnIdx = (a.turnIdx + 1) % a.order.length;
            continue;
        }

        // Offline guest: do not park the room on a shot clock nobody can answer.
        // Auto-pass (or hammer if they already hold the high bid) and keep moving.
        if (typeof Net !== 'undefined' && Net.online && Net.ownsAuctionClock() && !Net.isManagerConnected(bidderId)) {
            if (holdsHighBid) {
                finishAuctionSold();
                return;
            }
            a.out[bidderId] = true;
            recomputeAuctionHighBid(a);
            a.turnIdx = (a.turnIdx + 1) % a.order.length;
            continue;
        }

        a.turnSerial = (a.turnSerial || 0) + 1;
        a.turnEndsAt = Date.now() + SHOT_CLOCK_MS;
        Net.publishAuctionNow();
        renderDraftBoard();
        return;
    }

    // Safety valve: never spin forever if the seat order is in a bad state. If a
    // live high bid exists, honour it rather than discarding a player somebody won.
    if (a.highBidderId && a.highBid > 0) finishAuctionSold();
    else finishAuctionUnsold(currentAuctionPlayer(), false);
}

function advanceAuctionTurn() {
    const a = gameState.auction;
    if (!a) return;
    a.turnIdx = (a.turnIdx + 1) % a.order.length;
    openAuctionTurn();
}

function currentAuctionPlayer() {
    return gameState.activeDraft ? gameState.activeDraft.player : null;
}

function tickAuctionClock() {
    const a = gameState.auction;
    if (!a) { clearAuctionTimer(); return; }
    if (a.status !== 'open') { clearAuctionTimer(); return; }
    renderAuctionClock();
    // Only the device that owns the auction can end a turn on time.
    if (Date.now() < a.turnEndsAt) return;
    if (!Net.ownsAuctionClock()) return;
    expireAuctionTurn();
}

// Silence on the shot clock: a leading club's bid already stands, so time
// running out buys the player. Everyone else is simply out.
function expireAuctionTurn() {
    const a = gameState.auction;
    const bidderId = auctionCurrentBidderId();
    if (!a || !bidderId) return;
    if (bidderId === a.highBidderId && a.highBid > 0) {
        applyAuctionAction(bidderId, { type: 'hammer' });
        return;
    }
    // Silence never bids a club up against itself. Even with the room out of skips
    // the clock just puts this bidder out and hands the next club the turn.
    a.out[bidderId] = true;
    recomputeAuctionHighBid(a);
    advanceAuctionTurn();
}

// The single place auction state changes. Host-only when online.
function applyAuctionAction(managerId, action) {
    const a = gameState.auction;
    if (!a || a.status !== 'open' || !action || typeof action !== 'object') return;
    const m = auctionManagerById(managerId);
    if (!m) return;

    if (Number(managerId) !== Number(a.order[a.turnIdx])) return;
    const holdsHighBid = Number(a.highBidderId) === Number(managerId) && a.highBid > 0;

    if (action.type === 'raise') {
        // You cannot outbid yourself. The only decisions while leading are buy
        // and pass; this is what keeps the auction moving under a 9s clock.
        if (holdsHighBid) return showToast('You already hold the high bid — buy or pass.');
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount)) return;
        if (amount < auctionBidFloor()) return showToast(`Bid must reach at least €${auctionBidFloor()}M.`);
        if (amount > getManagerMaxBid(m)) {
            return showToast(`${m.name} can bid at most €${getManagerMaxBid(m)}M (keeps €${getManagerReserve(m)}M for the XI).`);
        }
        a.highBid = amount;
        a.highBidderId = managerId;
        a.topBidOf[managerId] = amount;
        advanceAuctionTurn();
        return;
    }

    if (action.type === 'pass') {
        // A leading club may pass: their bid is withdrawn and the next best live
        // bid takes over, or the player is discarded if nobody else bid.
        a.out[managerId] = true;
        recomputeAuctionHighBid(a);
        advanceAuctionTurn();
        return;
    }

    if (action.type === 'hammer' && holdsHighBid) finishAuctionSold();
}

// On-screen controls route here: local machines act directly, clients ask the host.
function auctionControl(type, amount, step) {
    const a = getOpenAuction();
    const bidderId = auctionCurrentBidderId();
    if (!a || bidderId == null) return;
    if (!Net.canControl(bidderId)) return showToast('Not your turn.');

    if (type === 'raise') {
        // With nobody bid yet the quick buttons place the opening bid at the reserve.
        const base = step ? Math.max(MIN_BID, (a.highBid || 0) + step) : null;
        const target = amount !== null && amount !== undefined ? amount : base;
        if (!Number.isFinite(target)) return showToast('Enter an amount first.');
        // Validate before clearing the field so a rejected amount is not lost.
        const m = auctionManagerById(bidderId);
        if (target < auctionBidFloor()) return showToast(`Bid must reach at least €${auctionBidFloor()}M.`);
        if (m && target > getManagerMaxBid(m)) {
            return showToast(`${m.name} can bid at most €${getManagerMaxBid(m)}M (keeps €${getManagerReserve(m)}M for the XI).`);
        }
        clearBidField();
        Net.auctionAction(bidderId, { type, amount: target });
        return;
    }
    clearBidField();
    Net.auctionAction(bidderId, { type });
}

// --- Bid amount field ----------------------------------------------------
// The typed amount lives only in the input element. Every new turn carries a
// new serial, so a stale number can never be carried into somebody's next turn.
function bidFieldValue() {
    const field = document.getElementById('bid-entry-field');
    if (!field) return null;
    const digits = String(field.value || '').replace(/\D/g, '');
    const amount = parseInt(digits, 10);
    return Number.isFinite(amount) ? amount : null;
}

function clearBidField() {
    const field = document.getElementById('bid-entry-field');
    if (!field) return;
    field.value = '';
    syncBidRaiseButton();
}

// Keep the RAISE button in step with the field without storing a second copy.
function syncBidRaiseButton() {
    const raiseBtn = document.getElementById('btn-bid-raise');
    if (!raiseBtn) return;
    const amount = bidFieldValue();
    const a = getOpenAuction();
    const bidder = a ? auctionManagerById(auctionCurrentBidderId()) : null;
    const maxBid = bidder ? getManagerMaxBid(bidder) : 0;
    const affordable = !!a && maxBid >= auctionBidFloor();
    raiseBtn.disabled = !(amount !== null && affordable);
}

function onBidInput(field) {
    if (!field) return;
    // Digits only, capped so a paste cannot overflow the field.
    const digits = String(field.value || '').replace(/\D/g, '').slice(0, 6);
    if (field.value !== digits) field.value = digits;
    syncBidRaiseButton();
}

// --- PASS: hold to confirm ----------------------------------------------
// A single tap used to end a club's auction by accident. The button now has to
// be held; leaving it, releasing it or losing focus cancels immediately.
function startPassHold(button) {
    if (!button) return;
    const a = getOpenAuction();
    const bidderId = auctionCurrentBidderId();
    if (!a || bidderId == null || !Net.canControl(bidderId)) return;
    cancelPassHold();
    passHold = {
        button,
        bidderId: Number(bidderId),
        turnSerial: a.turnSerial || 0,
        timer: setTimeout(finishPassHold, PASS_HOLD_MS)
    };
    button.classList.add('pass-holding');
    button.setAttribute('aria-pressed', 'true');
}

function finishPassHold() {
    const hold = passHold;
    passHold = null;
    if (!hold) return;
    hold.button.classList.remove('pass-holding');
    hold.button.setAttribute('aria-pressed', 'false');
    // The turn may have moved on while the button was held; never pass for the
    // wrong manager or on a stale turn.
    const a = getOpenAuction();
    if (!a || Number(auctionCurrentBidderId()) !== hold.bidderId) return;
    if ((a.turnSerial || 0) !== hold.turnSerial) return;
    if (!Net.canControl(hold.bidderId)) return;
    auctionControl('pass');
}

function cancelPassHold() {
    if (!passHold) return;
    const hold = passHold;
    passHold = null;
    clearTimeout(hold.timer);
    hold.button.classList.remove('pass-holding');
    hold.button.setAttribute('aria-pressed', 'false');
}

window.addEventListener('pointerup', cancelPassHold);
window.addEventListener('blur', cancelPassHold);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPassHold(); });

function finishAuctionSold() {
    const a = gameState.auction;
    const draft = gameState.activeDraft;
    if (!a || !draft || !a.highBidderId) return;

    const winner = auctionManagerById(a.highBidderId);
    const price = a.highBid;
    a.status = 'sold';
    clearAuctionTimer();

    winner.balance -= price;
    winner.squad.push({ ...draft.player, price });
    draft.player.sold = true;
    draft.result = { winnerName: winner.name };
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();

    gameState.auction = null;
    // Publish the settled card now, not when the local fly animation ends: the
    // host's tab is often backgrounded while it waits on a guest, and guests use
    // player.sold to know they may lock their XI again.
    Net.publishAuctionNow();
    Net.publishDraftNow();
    Net.publishManagers(winner.id);
    playDraftAcquisitionAnimation(draft.player, winner.id, () => {
        updateDashboard(winner.id);
        gameState.activeDraft = null;
        // Remote devices must see the card go away, or their "resolve the
        // current player first" guard blocks them from ever locking an XI.
        Net.publishDraftNow();
        renderDraftBoard();
        updateRollButton();
    });
    showToast(`${winner.name} signs ${draft.player.name} for €${price}M.`);
}

// --- Random pickup wheel ---
// The wheel carries the same clubs that were allowed to bid: room in the squad, the
// reserve still payable, and not locked out of the draft.
function pickupClubs() {
    return gameState.managers.filter(m =>
        !m.formationLocked &&
        (m.squad || []).length < MAX_SQUAD_SIZE && getManagerMaxBid(m) >= MIN_BID
    );
}

function startRandomPickup(player) {
    const draft = gameState.activeDraft;
    const clubs = pickupClubs();
    if (!draft || !clubs.length) return false;

    draft.state = 'picked';
    draft.pick = {
        order: clubs.map(m => m.id),
        lands: Math.floor(Math.random() * clubs.length),
        endsAt: Date.now() + WHEEL_MS + WHEEL_GAP
    };
    Net.publishDraftNow();
    renderDraftBoard();
    updateRollButton();

    setTimeout(settleRandomPickup, WHEEL_MS + WHEEL_GAP);
    return true;
}

function settleRandomPickup() {
    const draft = gameState.activeDraft;
    const pick = draft && draft.pick;
    if (!pick) return;

    const winner = auctionManagerById(pick.order[pick.lands]);
    const price = MIN_BID;
    draft.pick = null;
    draft.state = 'revealed';

    winner.balance -= price;
    winner.squad.push({ ...draft.player, price });
    draft.player.sold = true;
    draft.result = { winnerName: winner.name };

    Net.publishDraftNow();
    Net.publishManagers(winner.id);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    playDraftAcquisitionAnimation(draft.player, winner.id, () => {
        updateDashboard(winner.id);
        gameState.activeDraft = null;
        Net.publishDraftNow();
        renderDraftBoard();
        updateRollButton();
    });
    showToast(`${winner.name} wins the wheel and takes ${draft.player.name} for €${price}M.`);
}

function finishAuctionUnsold(player, free) {
    const a = gameState.auction;
    if (a) a.status = 'unsold';
    clearAuctionTimer();
    if (!player) return;

    // Skips are gone and still nobody wanted this player, so the wheel decides who
    // is stuck with them. Runs before the card is marked unsold, otherwise every
    // screen would show a discard and then have to undo it.
    if (!free && gameState.skipsLeft <= 0 && startRandomPickup(player)) {
        gameState.auction = null;
        Net.publishAuctionNow();
        return;
    }

    if (gameState.activeDraft) {
        gameState.activeDraft.player.sold = true;
        gameState.activeDraft.result = { winnerName: null };
    }

    gameState.auction = null;
    Net.publishAuctionNow();
    Net.publishDraftNow();

    const finish = () => {
        gameState.activeDraft = null;
        Net.publishDraftNow();
        renderDraftBoard();
        updateRollButton();
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    };

    if (free) {
        showToast('No manager can afford the minimum bid.');
        finish();
        return;
    }

    // Every club has passed, and that is the only thing that spends a room skip.
    gameState.skipsLeft = Math.max(0, gameState.skipsLeft - 1);
    updateRollButton();
    playDraftDiscardAnimation(() => {
        showToast(`Player passed. Skips left: ${gameState.skipsLeft}`);
        finish();
    });
}

// --- Presentation ---

function renderAuctionClock() {
    const clock = document.getElementById('auction-clock');
    const bar = document.getElementById('auction-clock-bar');
    const a = gameState.auction;
    if (!a || (!clock && !bar)) return;
    const left = Math.max(0, a.turnEndsAt - Date.now());
    const seconds = Math.ceil(left / 1000);
    if (clock) {
        clock.innerText = a.status === 'open' ? `${seconds}s` : 'Closed';
        clock.className = `font-mono font-black text-base shrink-0 ${seconds <= 5 && a.status === 'open' ? 'text-red-400 animate-pulse' : 'text-amber-300'}`;
    }
    if (bar) bar.style.width = `${clamp((left / SHOT_CLOCK_MS) * 100, 0, 100)}%`;
}

function auctionStatusChip(managerId) {
    const a = gameState.auction;
    const m = auctionManagerById(managerId);
    // Static accent classes so Tailwind can see them; one colour per seat.
    const palettes = [
        { ring: 'border-blue-400', dot: 'bg-blue-400' },
        { ring: 'border-red-400', dot: 'bg-red-400' },
        { ring: 'border-purple-400', dot: 'bg-purple-400' },
        { ring: 'border-orange-400', dot: 'bg-orange-400' }
    ];
    const palette = palettes[Math.max(0, gameState.managers.findIndex(x => x.id === managerId)) % palettes.length];
    const isTurn = !!a && a.status === 'open' && auctionCurrentBidderId() === managerId;
    const offline = typeof Net !== 'undefined' && Net.online && typeof Net.isManagerConnected === 'function' && !Net.isManagerConnected(managerId);
    const leading = !!a && a.highBidderId === managerId && a.highBid > 0;
    const label = !a ? '—'
        : a.out[managerId] ? 'OUT'
        : offline ? 'OFFLINE'
        : leading ? `LEADING €${a.highBid}M`
        : isTurn ? 'BIDDING NOW' : 'WAITING';
    const tone = a && a.out[managerId] ? 'border-slate-700 bg-slate-800/60 text-slate-500'
        : offline ? 'border-amber-600 bg-amber-950/70 text-amber-200'
        : leading ? 'border-emerald-400 bg-emerald-900/70 text-emerald-100'
        : isTurn ? `${palette.ring} bg-slate-800 text-white shadow-lg`
        : 'border-slate-600 bg-slate-800/70 text-slate-300';
    const dot = a && a.out[managerId] ? 'bg-slate-600'
        : offline ? 'bg-amber-400'
        : leading ? 'bg-emerald-400'
        : isTurn ? `${palette.dot} animate-pulse`
        : 'bg-slate-500';
    return `
        <div class="flex items-center gap-2 rounded-lg border-2 px-2 py-2 ${tone}">
            <span class="w-2.5 h-2.5 rounded-full shrink-0 ${dot}"></span>
            <div class="min-w-0 flex-1 leading-tight">
                <div class="text-[13px] font-black truncate">${escapeHTML(m ? m.name : '?')}</div>
                <div class="text-[11px] font-black uppercase tracking-widest truncate">${escapeHTML(label)}</div>
            </div>
        </div>`;
}

function passHoldButton(extraClass = '') {
    return `<button type="button"
        class="pass-hold-btn relative overflow-hidden w-full py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg font-bold text-sm select-none ${extraClass}"
        onpointerdown="startPassHold(this)" onpointerup="cancelPassHold()" onpointerleave="cancelPassHold()" onpointercancel="cancelPassHold()"
        onkeydown="if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); startPassHold(this); }"
        onkeyup="cancelPassHold()" onblur="cancelPassHold()"
        oncontextmenu="return false" aria-label="Hold to pass">
        <span class="pass-hold-fill" aria-hidden="true"></span>
        <span class="relative z-10">HOLD TO PASS</span>
    </button>`;
}

function renderAuctionPanel() {
    const a = gameState.auction;
    if (!a) return '';

    const bidderId = auctionCurrentBidderId();
    const bidder = auctionManagerById(bidderId);
    const mine = Net.canControl(bidderId);
    const holdsHighBid = a.highBidderId === bidderId && a.highBid > 0;
    const floor = auctionBidFloor();
    const maxBid = bidder ? getManagerMaxBid(bidder) : 0;
    const canRaise = maxBid >= floor;
    const highBidderName = a.highBidderId ? (auctionManagerById(a.highBidderId)?.name || '') : '';
    const standing = auctionActiveIds();

    const header = `
        <div class="w-full mb-2 shrink-0">
            <div class="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 gap-2">
                <span class="truncate">Live Auction</span>
                <span id="auction-clock" class="font-mono font-black text-base text-amber-300 shrink-0">${Math.ceil(SHOT_CLOCK_MS / 1000)}s</span>
            </div>
            <div class="w-full h-1.5 rounded-full overflow-hidden bg-slate-700">
                <div id="auction-clock-bar" class="h-full bg-amber-400 transition-all duration-200" style="width:100%"></div>
            </div>
            <div class="mt-2 rounded-xl border-2 px-3 py-2 text-center ${a.highBid > 0 ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-600 bg-slate-900/60'}">
                ${a.highBid > 0 ? `
                    <div class="text-[10px] font-black uppercase tracking-[0.22em] text-amber-400">Current Bid</div>
                    <div class="mt-0.5 flex items-baseline justify-center gap-1.5 flex-wrap leading-none">
                        <span class="text-2xl font-black text-white break-words">${escapeHTML(highBidderName)}</span>
                        <span class="text-xl font-black text-slate-500">-</span>
                        <span class="text-2xl font-black text-amber-300">€${a.highBid}M</span>
                    </div>` : `
                    <div class="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Opening Bid</div>
                    <div class="mt-0.5 text-2xl font-black leading-none text-amber-300">€${MIN_BID}M</div>`}
            </div>
            <div class="grid grid-cols-2 gap-1.5 mt-2">${a.order.map(id => auctionStatusChip(id)).join('')}</div>
        </div>`;

    if (!mine) {
        return `
            ${header}
            <div class="flex-1 flex flex-col justify-center gap-1.5 text-center py-3">
                <span class="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">On The Clock</span>
                <span class="text-2xl font-black text-white leading-tight break-words">${escapeHTML(bidder ? bidder.name : 'Next bidder')}</span>
                <span class="text-sm font-bold text-slate-300">${holdsHighBid ? `Decides whether to raise or buy at €${a.highBid}M.` : `Must reach €${floor}M to stay in.`}</span>
            </div>`;
    }

    // Leading clubs have only two decisions now: take the player, or walk away.
    // Raising your own bid is blocked so a 9s clock is never spent on nothing.
    if (holdsHighBid) {
        return `
            ${header}
            <div class="flex-1 flex flex-col justify-center gap-2">
                ${standing.length > 1 ? '<div class="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">You hold the high bid</div>' : ''}
                <div class="text-center text-2xl font-black leading-none text-amber-300">€${a.highBid}M</div>
                <div class="text-center text-xs font-bold text-slate-400">is the price</div>
                <button type="button" onclick="auctionControl('hammer')"
                   class="w-full py-3 bg-orange-500 hover:bg-orange-400 text-white rounded-lg font-black text-base shadow">BUY AT €${a.highBid}M</button>
                ${passHoldButton()}
            </div>`;
    }

    const raiseSteps = BID_RAISE_STEPS.map(step => `
        <button type="button" onclick="auctionControl('raise', null, ${step})" ${canRaise ? '' : 'disabled'}
            class="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black">+${step}</button>`).join('');

    return `
        ${header}
        <div class="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
            <div class="flex items-center gap-1.5">
                <input type="text" inputmode="numeric" autocomplete="off" id="bid-entry-field" value=""
                    data-bid-turn="${a.turnSerial || 0}"
                    placeholder="Bid €${floor}M+" oninput="onBidInput(this)"
                    class="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white tracking-widest focus:border-emerald-400 outline-none">
            </div>
            <div class="flex gap-1.5">${raiseSteps}</div>
            <button type="button" id="btn-bid-raise" onclick="auctionControl('raise', bidFieldValue())"
                   class="w-full py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 rounded-lg font-black text-sm shadow" disabled>RAISE</button>
            ${passHoldButton()}
            ${!canRaise ? '<p class="text-[10px] font-bold text-red-400">You cannot cover the current bid.</p>' : ''}
        </div>`;
}
