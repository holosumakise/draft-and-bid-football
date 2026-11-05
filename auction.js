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

// --- Keyboard controls ---------------------------------------------------
// Only ever act for the club whose turn it is on this device, and never steal a
// key from an input the player is typing in.
//   V          press RAISE, or BUY when you hold the high bid
//   Z / X      raise by +1 / +5
//   C        hold to pass (release early to cancel)
function auctionKeysActive() {
    const a = getOpenAuction();
    if (!a) return null;
    const bidderId = auctionCurrentBidderId();
    if (bidderId == null || !Net.canControl(bidderId)) return null;
    return a;
}

function isTextEntry(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}

// V presses whichever button the panel is actually offering, so the key can
// never do something the disabled button already forbids.
function pressAuctionPrimaryButton() {
    const button = document.getElementById('btn-bid-buy') || document.getElementById('btn-bid-raise');
    if (!button || button.disabled) return false;
    button.click();
    return true;
}

function isPassKey(key) { return key === 'c' || key === 'C'; }
function isBuyKey(key) { return key === 'v' || key === 'V'; }

document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const onPassButton = !!(event.target && event.target.closest && event.target.closest('.pass-hold-btn'));
    if (onPassButton && isPassKey(event.key)) return;
    if (!auctionKeysActive()) return;
    const typing = isTextEntry(event.target);

    if (isBuyKey(event.key)) {
        // Unlike Enter, V never activates a focused button on its own, so there is no
        // double-bid to guard against here — only keystrokes typed into a field.
        if (typing && event.target !== document.getElementById('bid-entry-field')) return;
        event.preventDefault();
        pressAuctionPrimaryButton();
        return;
    }

    // C is a hold, never a tap: one stray press must not pass for you.
    if (isPassKey(event.key)) {
        if (typing) return;
        event.preventDefault();
        if (event.repeat || passHold) return;
        const button = document.querySelector('.pass-hold-btn');
        if (button) startPassHold(button);
        return;
    }

    if (typing) return;

    if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        auctionControl('raise', null, BID_RAISE_STEPS[0]);
        return;
    }
    if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        auctionControl('raise', null, BID_RAISE_STEPS[1]);
    }
});

document.addEventListener('keyup', event => {
    if (isPassKey(event.key) && passHold) {
        event.preventDefault();
        cancelPassHold();
    }
});

function finishAuctionSold() {
    const a = gameState.auction;
    const draft = gameState.activeDraft;
    if (!a || !draft || !a.highBidderId) return;

    const winner = auctionManagerById(a.highBidderId);
    const price = a.highBid;
    a.status = 'sold';
    clearAuctionTimer();

    winner.balance = roundMoney(winner.balance - price);
    winner.squad.push({ ...draft.player, price });
    draft.player.sold = true;
    draft.result = { winnerName: winner.name, price };
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();

    gameState.auction = null;
    // Publish the settled card now, not when the local fly animation ends: the
    // host's tab is often backgrounded while it waits on a guest, and guests use
    // player.sold to know they may lock their XI again.
    Net.publishAuctionNow();
    Net.publishDraftNow();
    Net.publishManagers(winner.id);
    showSaleRecap(draft.player, winner.name, price);
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

    winner.balance = roundMoney(winner.balance - price);
    winner.squad.push({ ...draft.player, price });
    draft.player.sold = true;
    draft.result = { winnerName: winner.name, price };

    Net.publishDraftNow();
    Net.publishManagers(winner.id);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    showSaleRecap(draft.player, winner.name, price);
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
        setText(clock, a.status === 'open' ? `${seconds}s` : 'Closed');
        setClass(clock, `auction__clock${seconds <= 5 && a.status === 'open' ? ' is-danger' : ''}`);
    }
    // The drain is a transform, so it runs on the compositor; the bar's box never
    // changes size and nothing under it has to be laid out again.
    if (bar) bar.style.transform = `scaleX(${clamp(left / SHOT_CLOCK_MS, 0, 1)})`;
}

function auctionStatusChip(managerId) {
    const a = gameState.auction;
    const m = auctionManagerById(managerId);
    const colors = ['#60a5fa', '#fb7185', '#a78bfa', '#fb923c'];
    const dotColor = colors[Math.max(0, gameState.managers.findIndex(x => x.id === managerId)) % colors.length];
    const isTurn = !!a && a.status === 'open' && auctionCurrentBidderId() === managerId;
    const offline = typeof Net !== 'undefined' && Net.online && typeof Net.isManagerConnected === 'function' && !Net.isManagerConnected(managerId);
    const leading = !!a && a.highBidderId === managerId && a.highBid > 0;
    const label = !a ? '—'
        : a.out[managerId] ? 'OUT'
        : offline ? 'OFFLINE'
        : leading ? `LEADING €${a.highBid}M`
        : isTurn ? 'BIDDING NOW' : 'WAITING';
    const stateClass = a && a.out[managerId] ? 'is-out'
        : offline ? 'is-offline'
        : leading ? 'is-leading'
        : isTurn ? 'is-turn' : '';
    return `
        <div class="auction-chip ${stateClass}">
            <span class="dot" style="background:${dotColor}"></span>
            <div class="auction-chip__body">
                <span class="auction-chip__name">${escapeHTML(m ? m.name : '?')}</span>
                <span class="auction-chip__state">${escapeHTML(label)}</span>
            </div>
        </div>`;
}

function passHoldButton(extraClass = '') {
    return `<button type="button"
        class="pass-hold-btn btn-pass ${extraClass}"
        onpointerdown="startPassHold(this)" onpointerup="cancelPassHold()" onpointerleave="cancelPassHold()" onpointercancel="cancelPassHold()"
        onkeydown="if (!event.repeat && (isPassKey(event.key) || event.key === 'Enter')) { event.preventDefault(); startPassHold(this); }"
        onkeyup="cancelPassHold()" onblur="cancelPassHold()"
        oncontextmenu="return false" aria-label="Hold to pass">
        <span class="pass-hold-fill" aria-hidden="true"></span>
        <span class="relative z-10">HOLD TO PASS [C]</span>
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
        <div class="auction">
            <div class="auction__head">
                <span>Live Auction</span>
                <span id="auction-clock" class="auction__clock">${Math.ceil(SHOT_CLOCK_MS / 1000)}s</span>
            </div>
            <div class="auction__bar"><div id="auction-clock-bar" style="transform:scaleX(1)"></div></div>
            <div class="auction__bid ${a.highBid > 0 ? 'is-live' : ''}">
                ${a.highBid > 0 ? `
                    <div class="auction__bid-label">Current Bid</div>
                    <div class="auction__bid-row">
                        <span class="auction__bid-name">${escapeHTML(highBidderName)}</span>
                        <span class="auction__bid-value">€${a.highBid}M</span>
                    </div>` : `
                    <div class="auction__bid-label">Opening Bid</div>
                    <div class="auction__bid-row"><span class="auction__bid-value">€${MIN_BID}M</span></div>`}
            </div>
            <div class="auction__chips">${a.order.map(id => auctionStatusChip(id)).join('')}</div>
        </div>`;

    if (!mine) {
        return `
            ${header}
            <div class="auction__actions" style="text-align:center;padding:8px 0;">
                <span class="eyebrow">Current Bidder</span>
                <span style="font-family:var(--font-display);font-size:22px;font-weight:900;line-height:1.1;color:var(--text);">${escapeHTML(bidder ? bidder.name : 'Next bidder')}</span>
                <span class="auction-note">${holdsHighBid ? `Decides whether to raise or buy at €${a.highBid}M.` : `Must reach €${floor}M to stay in.`}</span>
            </div>`;
    }

    // Leading clubs have only two decisions now: take the player, or walk away.
    // Raising your own bid is blocked so a 9s clock is never spent on nothing.
    if (holdsHighBid) {
        return `
            ${header}
            <div class="auction__actions">
                ${standing.length > 1 ? '<p class="auction-note">You hold the high bid.</p>' : ''}
                <div class="auction__bid-value" style="text-align:center;">€${a.highBid}M</div>
                <p class="auction-note">is the price</p>
                <button type="button" id="btn-bid-buy" onclick="auctionControl('hammer')" class="btn-buy">BUY AT €${a.highBid}M [V]</button>
                ${passHoldButton()}
            </div>`;
    }

    const raiseSteps = BID_RAISE_STEPS.map((step, index) => `
        <button type="button" onclick="auctionControl('raise', null, ${step})" ${canRaise ? '' : 'disabled'}
            class="bid-step">+${step} [${index === 0 ? 'Z' : 'X'}]</button>`).join('');

    return `
        ${header}
        <div class="auction__actions">
            <div class="bid-row">
                <input type="text" inputmode="numeric" autocomplete="off" id="bid-entry-field" value=""
                    data-bid-turn="${a.turnSerial || 0}"
                    placeholder="Bid €${floor}M+" aria-label="Bid for ${escapeHTML(bidder ? bidder.name : 'current manager')} in millions" oninput="onBidInput(this)"
                    class="bid-input">
            </div>
            <div class="bid-steps">${raiseSteps}</div>
            <button type="button" id="btn-bid-raise" onclick="auctionControl('raise', bidFieldValue())"
                   class="btn-raise" disabled>RAISE [V]</button>
            ${passHoldButton()}
            ${!canRaise ? '<p class="auction-note" style="color:#fb7185;">You cannot cover the current bid.</p>' : ''}
        </div>`;
}

