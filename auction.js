// ============================================================
// LIVE AUCTION — one bidder at a time, every bid public.
//
// Replaces simultaneous sealed bidding. With two inputs on screen at once a
// hot-seat manager could read the rival's number before committing their own,
// so bidding is now strictly turn-based: the current bidder is the only one
// with controls, and their custom amount stays masked until they commit it.
// ============================================================

let auctionClockId = null;
// The amount the current bidder is typing. Held in memory rather than in a
// visible field so a bystander cannot read it before it is committed.
let bidEntry = '';

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
    bidEntry = '';

    if (!eligible.length) {
        // Nobody can cover the reserve, so this costs no skip.
        finishAuctionUnsold(draft.player, true);
        return false;
    }

    gameState.auction = {
        playerId: draft.player.id,
        order: eligible,
        turnIdx: 0,
        highBid: 0,
        highBidderId: null,
        topBidOf: {},
        out: {},
        status: 'open',
        turnEndsAt: Date.now() + SHOT_CLOCK_MS,
        mustBuy: gameState.skipsLeft <= 0
    };
    clearAuctionTimer();
    auctionClockId = setInterval(tickAuctionClock, AUCTION_TICK_MS);
    openAuctionTurn();
    return true;
}

// Hand the gavel to the next manager still in, or settle the player.
function openAuctionTurn() {
    const a = gameState.auction;
    if (!a || a.status !== 'open') return;

    for (let guard = 0; guard <= a.order.length + 1; guard++) {
        const active = auctionActiveIds();
        if (!active.length) { finishAuctionUnsold(currentAuctionPlayer(), false); return; }

        // One bidder left and they hold the bid: if they cannot top it there is
        // nothing to decide, so the hammer falls. Otherwise they get the usual
        // "will you go higher?" turn that a real auctioneer offers.
        if (active.length === 1 && a.highBidderId === active[0]) {
            const lastMan = active[0];
            if (!auctionCanAffordToRaise(lastMan)) { finishAuctionSold(); return; }
            a.turnIdx = a.order.indexOf(lastMan);
            a.turnEndsAt = Date.now() + SHOT_CLOCK_MS;
            bidEntry = '';
            Net.publishAuctionNow();
            renderDraftBoard();
            return;
        }

        // The high bidder can only stop being eligible by being marked out for
        // affordability, so the last club still in takes the player at their own
        // best bid; that keeps BUY's price honest for the club that is pressing it.
        if (active.length === 1) {
            const lastMan = active[0];
            a.highBidderId = lastMan;
            a.highBid = a.topBidOf[lastMan] || MIN_BID;
            a.turnIdx = a.order.indexOf(lastMan);
            a.turnEndsAt = Date.now() + SHOT_CLOCK_MS;
            bidEntry = '';
            Net.publishAuctionNow();
            renderDraftBoard();
            return;
        }

        const bidderId = a.order[a.turnIdx];
        if (!a.out[bidderId] && auctionCanAffordToRaise(bidderId)) {
            a.turnEndsAt = Date.now() + SHOT_CLOCK_MS;
            bidEntry = '';
            Net.publishAuctionNow();
            renderDraftBoard();
            return;
        }

        a.out[bidderId] = true;
        a.turnIdx = (a.turnIdx + 1) % a.order.length;
    }

    finishAuctionUnsold(currentAuctionPlayer(), false);
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

// Silence on the shot clock: the high bidder buys, everyone else is out.
function expireAuctionTurn() {
    const a = gameState.auction;
    const bidderId = auctionCurrentBidderId();
    if (!a || !bidderId) return;
    if (bidderId === a.highBidderId && a.highBid > 0) {
        applyAuctionAction(bidderId, { type: 'hammer' });
    } else if (a.mustBuy && auctionCanAffordToRaise(bidderId)) {
        applyAuctionAction(bidderId, { type: 'raise', amount: auctionBidFloor() });
    } else {
        applyAuctionAction(bidderId, { type: 'pass' });
    }
}

// The single place auction state changes. Host-only when online.
function applyAuctionAction(managerId, action) {
    const a = gameState.auction;
    if (!a || a.status !== 'open') return;
    if (managerId !== a.order[a.turnIdx]) return;

    const m = auctionManagerById(managerId);
    if (!m) return;
    const holdsHighBid = a.highBidderId === managerId && a.highBid > 0;

    if (action.type === 'raise') {
        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount)) return;
        if (amount < auctionBidFloor()) return showToast(`Bid must reach at least €${auctionBidFloor()}M.`);
        if (amount > getManagerMaxBid(m)) {
            return showToast(`${m.name} can bid at most €${getManagerMaxBid(m)}M (keeps €${getManagerReserve(m)}M for the XI).`);
        }
        a.highBid = amount;
        a.highBidderId = managerId;
        a.topBidOf[managerId] = amount;
        bidEntry = '';
        advanceAuctionTurn();
        return;
    }

    if (action.type === 'pass') {
        if (holdsHighBid) return showToast('You hold the high bid — raise or buy.');
        if (a.mustBuy && auctionCanAffordToRaise(managerId)) return showToast('No skips left — you must bid.');
        a.out[managerId] = true;
        bidEntry = '';
        advanceAuctionTurn();
        return;
    }

    if (action.type === 'hammer' && holdsHighBid) finishAuctionSold();
}

// On-screen controls route here: local machines act directly, clients ask the host.
function auctionControl(type, amount, step) {
    const a = getOpenAuction();
    const bidderId = auctionCurrentBidderId();
    if (!a || !bidderId) return;
    if (!Net.canControl(bidderId)) return showToast('Not your turn.');

    if (type === 'raise') {
        const base = a.highBid > 0 && step ? a.highBid + step : null;
        const target = amount !== null && amount !== undefined ? amount : base;
        if (!Number.isFinite(target)) return showToast('Enter an amount first.');
        Net.auctionAction(bidderId, { type, amount: target });
        return;
    }
    Net.auctionAction(bidderId, { type });
}

function setBidEntry(value) {
    bidEntry = String(value).replace(/\D/g, '').slice(0, 6);
    const preview = document.getElementById('bid-entry-preview');
    // One dot per digit: the bidder sees that typing registered without the
    // amount itself being readable over their shoulder before they commit.
    if (preview) preview.innerText = bidEntry ? `•${'•'.repeat(bidEntry.length - 1)}M` : '—';
    const raiseBtn = document.getElementById('btn-bid-raise');
    if (raiseBtn) raiseBtn.disabled = !bidEntry;
}

function bidEntryValue() {
    const amount = parseInt(bidEntry, 10);
    return Number.isFinite(amount) ? amount : null;
}

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
    draft.result = {
        winnerName: winner.name,
        price,
        bids: a.order.map(id => ({
            name: auctionManagerById(id)?.name || '?',
            amount: id === winner.id ? price : (a.topBidOf[id] || 0)
        }))
    };

    gameState.auction = null;
    bidEntry = '';
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

function finishAuctionUnsold(player, free) {
    const a = gameState.auction;
    if (a) a.status = 'unsold';
    clearAuctionTimer();
    if (!player) return;

    const bids = (a ? a.order : []).map(id => ({
        name: auctionManagerById(id)?.name || '?',
        amount: a ? (a.topBidOf[id] || 0) : 0
    }));

    if (gameState.activeDraft) {
        gameState.activeDraft.player.sold = true;
        gameState.activeDraft.result = { winnerName: null, price: 0, bids };
    }

    gameState.auction = null;
    bidEntry = '';
    Net.publishAuctionNow();
    Net.publishDraftNow();

    const finish = () => {
        gameState.activeDraft = null;
        Net.publishDraftNow();
        renderDraftBoard();
        updateRollButton();
    };

    if (free) {
        showToast('No manager can afford the minimum bid.');
        finish();
        return;
    }

    gameState.skipsLeft--;
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
        clock.className = `font-mono font-black ${seconds <= 5 && a.status === 'open' ? 'text-red-400 animate-pulse' : 'text-amber-300'}`;
    }
    if (bar) bar.style.width = `${clamp((left / SHOT_CLOCK_MS) * 100, 0, 100)}%`;
}

function auctionStatusChip(managerId) {
    const a = gameState.auction;
    const m = auctionManagerById(managerId);
    const colors = ['blue', 'red', 'purple', 'orange'];
    const color = colors[Math.max(0, gameState.managers.findIndex(x => x.id === managerId)) % colors.length];
    const isTurn = !!a && a.status === 'open' && auctionCurrentBidderId() === managerId;
    const label = !a ? '—'
        : a.out[managerId] ? 'OUT'
        : a.highBidderId === managerId ? `HIGH €${a.highBid}M`
        : isTurn ? 'BIDDING' : 'WAITING';
    const tone = a && a.out[managerId] ? 'text-slate-500 bg-slate-800 border-slate-700'
        : a && a.highBidderId === managerId ? 'text-emerald-300 bg-emerald-950 border-emerald-700'
        : isTurn ? `text-${color}-300 bg-slate-800 border-${color}-500 animate-pulse`
        : 'text-slate-400 bg-slate-800 border-slate-700';
    return `<span class="text-[10px] font-bold px-2 py-1 rounded-md border ${tone} whitespace-nowrap">${escapeHTML(m ? m.name : '?')}: ${label}</span>`;
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

    const header = `
        <div class="w-full mb-2 shrink-0">
            <div class="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1 gap-2">
                <span class="truncate">Live auction · ${a.highBid > 0 ? `high €${a.highBid}M (${escapeHTML(highBidderName)})` : `opens at €${MIN_BID}M`}</span>
                <span id="auction-clock" class="font-mono font-black text-amber-300 shrink-0">${Math.ceil(SHOT_CLOCK_MS / 1000)}s</span>
            </div>
            <div class="w-full h-1.5 rounded-full overflow-hidden bg-slate-700">
                <div id="auction-clock-bar" class="h-full bg-amber-400 transition-all duration-200" style="width:100%"></div>
            </div>
            <div class="flex flex-wrap gap-1 mt-2">${a.order.map(id => auctionStatusChip(id)).join('')}</div>
            ${a.mustBuy ? '<p class="text-[10px] font-bold text-red-400 mt-1">No skips left — this player must be bought.</p>' : ''}
        </div>`;

    if (!mine) {
        return `
            ${header}
            <div class="flex-1 flex flex-col items-center justify-center gap-2 text-center py-4">
                <span class="text-sm font-black text-white">${escapeHTML(bidder ? bidder.name : 'Next bidder')} is up</span>
                <span class="text-xs text-slate-400">${holdsHighBid ? `Decides whether to raise or buy at €${a.highBid}M.` : `Must reach €${floor}M to stay in.`}</span>
            </div>`;
    }

    // Everyone else has passed, so there is nothing left to bid against: the only
    // real choice is taking the player at the price already on the table.
    const standing = auctionActiveIds();
    if (standing.length === 1 && standing[0] === bidderId) {
        return `
            ${header}
            <div class="flex-1 flex flex-col justify-center gap-2">
                <div class="text-[11px] font-bold text-slate-300">Only club left · €${a.highBid}M is the price</div>
                <button type="button" onclick="auctionControl('hammer')"
                   class="w-full py-3 bg-orange-500 hover:bg-orange-400 text-white rounded-lg font-black text-base shadow">BUY AT €${a.highBid}M</button>
            </div>`;
    }

    const raiseSteps = BID_RAISE_STEPS.map(step => `
        <button type="button" onclick="auctionControl('raise', null, ${step})" ${canRaise ? '' : 'disabled'}
            class="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-black">+${step}</button>`).join('');

    return `
        ${header}
        <div class="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
            <div class="text-[11px] font-bold text-slate-300">Your turn, ${escapeHTML(bidder ? bidder.name : '')} · max €${maxBid}M</div>
            <div class="flex items-center gap-1.5">
                <input type="password" inputmode="numeric" autocomplete="off" id="bid-entry-field" value=""
                    placeholder="Bid €${floor}M+" oninput="setBidEntry(this.value)"
                    class="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-lg px-2 py-2 text-sm text-white tracking-widest focus:border-emerald-400 outline-none">
                <span class="text-[10px] font-bold text-slate-400 whitespace-nowrap">Bid <span id="bid-entry-preview" class="text-emerald-300 font-mono">—</span></span>
            </div>
            <div class="flex gap-1.5">${raiseSteps}</div>
            ${holdsHighBid
                ? `<button type="button" onclick="auctionControl('hammer')"
                       class="w-full py-2.5 bg-orange-500 hover:bg-orange-400 text-white rounded-lg font-black text-sm shadow">BUY AT €${a.highBid}M</button>`
                : `<button type="button" id="btn-bid-raise" onclick="auctionControl('raise', bidEntryValue())" ${canRaise && bidEntry ? '' : 'disabled'}
                       class="w-full py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 rounded-lg font-black text-sm shadow">RAISE</button>
                   <button type="button" onclick="auctionControl('pass')" ${(a.mustBuy && canRaise) ? 'disabled' : ''}
                       class="w-full py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm">PASS</button>`}
            ${!canRaise ? '<p class="text-[10px] font-bold text-red-400">You cannot cover the current bid.</p>' : ''}
        </div>`;
}
