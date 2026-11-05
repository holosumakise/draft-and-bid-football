// --- Core Helpers ---
// The Tailwind runtime in the head watches the whole document, so any mutation —
// including one that writes back exactly what was already there — re-scans the
// page and invalidates style for every element on it. Renders that run on a timer
// or on every room update go through these so unchanged output stays unwritten.
function setText(el, value) { if (el && el.textContent !== value) el.textContent = value; }
function setClass(el, value) { if (el && el.className !== value) el.className = value; }
function setHTML(el, value) {
    if (!el || el.__markup === value) return;
    el.innerHTML = value;
    el.__markup = value;
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    // Matchday panels belong to the season chart and the full-time screen only.
    const keepReports = screenId === 'screen-season'
        || screenId === 'screen-match'
        || screenId === 'screen-h2h-result';
    if (!keepReports && typeof hideMatchReportPanels === 'function') hideMatchReportPanels();
    // While an online game is running the host's screen is everyone's screen.
    if (Net.online && Net.isHost && Online.gameLive) Net.publishScreen(screenId);
}

let toastTimer = null;
function showToast(msg, ms = 3500) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-msg').innerText = msg;
    toast.classList.remove('opacity-0'); toast.classList.add('opacity-100');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('opacity-100'); toast.classList.add('opacity-0'); }, ms);
}

/** Stamp the sold card and light up the winning manager's squad panel. */
function playDraftAcquisitionAnimation(player, winnerId, onComplete) {
    const finish = () => {
        gameState.draftAnimating = false;
        updateRollButton();
        if (typeof onComplete === 'function') onComplete();
    };

    const board = document.getElementById('draft-board');
    const panel = board && board.firstElementChild;
    const target = document.getElementById(`manager-card-${winnerId}`);
    if (!panel || !target || !player) return finish();

    // The stamp belongs on the player card, never across the auction panel.
    const stampHost = panel.querySelector('.draft-reveal__card .pcard')
        || panel.querySelector('.draft-reveal__card')
        || panel;
    const card = panel.querySelector('.draft-reveal__card') || panel;

    if (gameState.draftAnimating || document.querySelector('.draft-sold-stamp')) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    gameState.draftAnimating = true;
    updateRollButton();

    // Stamp as an absolute child of the card so it stays on the portrait
    const prevPos = stampHost.style.position;
    if (!prevPos || prevPos === 'static') stampHost.style.position = 'relative';
    const stamp = document.createElement('div');
    stamp.className = 'draft-sold-stamp draft-sold-stamp-inpanel';
    stamp.textContent = 'SOLD';
    stamp.style.left = '50%';
    stamp.style.top = '50%';
    stampHost.appendChild(stamp);
    void stamp.offsetWidth;
    stamp.classList.add('stamped');

    card.classList.add('draft-card-sold-react');

    const cleanup = () => {
        if (stamp.parentNode) stamp.remove();
        card.classList.remove('draft-card-sold-react');
        if (prevPos !== undefined) stampHost.style.position = prevPos;
        target.classList.remove('draft-target-receive');
        finish();
    };

    // The buyer's panel glows as the signature finishes, then the stamp fades out.
    setTimeout(() => target.classList.add('draft-target-receive'), 1900);
    setTimeout(() => {
        stamp.style.transition = 'opacity 0.4s ease';
        stamp.style.opacity = '0';
    }, 2450);
    setTimeout(cleanup, 2950);
}


/** SOLD-style stamp when a draft player is skipped / discarded (no fly animation). */
function playDraftDiscardAnimation(onComplete) {
    const finish = () => {
        if (typeof onComplete === 'function') onComplete();
    };

    const board = document.getElementById('draft-board');
    const panel = board && board.firstElementChild;
    if (!panel) return finish();

    // Keep the discard stamp on the card, same as the SOLD stamp.
    const stampHost = panel.querySelector('.draft-reveal__card .pcard')
        || panel.querySelector('.draft-reveal__card')
        || panel;
    const card = panel.querySelector('.draft-reveal__card') || panel;

    // Avoid stacking on top of an in-flight SOLD animation
    if (document.querySelector('.draft-sold-stamp')) {
        return finish();
    }

    gameState.draftAnimating = true; // block Roll until the stamp is gone, otherwise a new roll gets wiped
    updateRollButton();

    const prevPos = stampHost.style.position;
    if (!prevPos || prevPos === 'static') stampHost.style.position = 'relative';

    const stamp = document.createElement('div');
    stamp.className = 'draft-sold-stamp draft-sold-stamp-inpanel draft-discard-stamp';
    stamp.textContent = 'DISCARDED';
    stamp.style.left = '50%';
    stamp.style.top = '50%';
    stampHost.appendChild(stamp);
    void stamp.offsetWidth;
    stamp.classList.add('stamped');

    card.classList.add('draft-card-sold-react');

    // Hold the stamp long enough to read, then fade and clean up
    setTimeout(() => {
        stamp.style.transition = 'opacity 0.5s ease';
        stamp.style.opacity = '0';
        setTimeout(() => {
            if (stamp.parentNode) stamp.remove();
            card.classList.remove('draft-card-sold-react');
            if (prevPos !== undefined) stampHost.style.position = prevPos;
            gameState.draftAnimating = false;
            updateRollButton();
            finish();
        }, 500);
    }, 1250);
}



function formatBalance(amount) {
    const value = roundMoney(amount);
    return value >= 1000 ? `€${(value / 1000).toFixed(2)}B` : `€${value}M`;
}
function escapeHTML(str) { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function shortName(name) {
    const ex = ["De Bruyne", "van Dijk", "ter Stegen", "Di Maria", "Mac Allister", "Neymar Jr", "Vinicius Jr", "B. Silva", "Alexander-Arnold"];
    for (let e of ex) if (name.includes(e)) return e;
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1];
}

function renderDOMForManagers() {
    const infoContainer = document.getElementById('managers-info');
    const pitchContainer = document.getElementById('pitches-container');
    infoContainer.innerHTML = ''; pitchContainer.innerHTML = '';

    const n = gameState.managers.length;
    let gridCls, pitchCls;
    if (n === 1) {
        gridCls = 'grid-cols-1 max-w-xl mx-auto';
        pitchCls = 'grid-cols-1 max-w-md mx-auto';
    } else if (n === 2) {
        gridCls = 'grid-cols-1 md:grid-cols-2';
        pitchCls = 'grid-cols-1 md:grid-cols-2';
    } else if (n === 3) {
        gridCls = 'grid-cols-1 md:grid-cols-3';
        pitchCls = 'grid-cols-1 md:grid-cols-3';
    } else {
        gridCls = 'grid-cols-1 md:grid-cols-2';
        pitchCls = 'grid-cols-1 md:grid-cols-2';
    }
    infoContainer.className = `managers-grid ${gridCls}`;
    pitchContainer.className = `pitches-grid ${pitchCls}`;

    const colors = ['blue', 'red', 'purple', 'orange'];

    gameState.managers.forEach((m, idx) => {
        const c = colors[idx % colors.length];
        const locked = !!m.formationLocked;
        const canEdit = Net.canControl(m.id);
        const presetKey = m.formationPreset || '4-4-2';
        const presetOptions = Object.keys(FORMATION_PRESETS).map(key => `
            <option value="${key}" ${presetKey === key ? 'selected' : ''}>${FORMATION_PRESETS[key].label || key}</option>`).join('');

        infoContainer.innerHTML += `
            <div id="manager-card-${m.id}" class="manager-card" data-accent="${c}">
                <div class="manager-card__top">
                    <div class="manager-avatar">M${m.id}</div>
                    <div style="min-width:0;flex:1;">
                        <h3 class="manager-card__name">
                            <span>${escapeHTML(m.name)}</span>
                            <span id="m${m.id}-conn" class="hidden text-[9px] font-black uppercase tracking-wider text-amber-300 bg-amber-950 border border-amber-700 rounded px-1.5 py-0.5 shrink-0">Reconnecting</span>
                        </h3>
                        <div class="manager-card__meta">Team OVR <b id="m${m.id}-ovr-live">0</b> · <span id="m${m.id}-count">0</span>/${MAX_SQUAD_SIZE} squad</div>
                    </div>
                    <div class="manager-card__balance" id="m${m.id}-balance-wrap">
                        <span id="m${m.id}-balance">€1.00B</span>
                        <small>Balance</small>
                    </div>
                </div>

                <button type="button" id="m${m.id}-invest-btn" class="club-invest" onclick="openInvestment(${m.id})">
                    <span>Club Investment</span>
                    <small id="m${m.id}-invest-summary">Training · Medical · Scouting</small>
                </button>

                <div id="m${m.id}-budget" class="budget-track hidden">
                    <div class="budget-track__labels">
                        <span>Available <b id="m${m.id}-maxbid">€0M</b></span>
                        <span>Reserved <i id="m${m.id}-reserve">€0M</i></span>
                    </div>
                    <div class="budget-track__bar" title="Green = available to bid · Amber = reserved to fill remaining starting XI slots">
                        <div id="m${m.id}-budget-bar" style="width:100%;background:#34d399"></div>
                        <div id="m${m.id}-reserve-bar" style="width:0%;background:#fbbf24"></div>
                    </div>
                </div>

                <div id="m${m.id}-chem" class="chem-line"></div>

                <div class="squad-list-wrap">
                    <div class="squad-list-head">Squad <span>Tap a player for card</span></div>
                    <ul id="m${m.id}-squad" class="squad-list"></ul>
                </div>
            </div>`;

        pitchContainer.innerHTML += `
            <div class="pitch-wrap" data-accent="${c}">
                <div class="pitch-team">
                    <h3>${escapeHTML(m.name)} <span>XI</span></h3>
                    <span class="pitch-team__ovr" id="pitch-ovr-${m.id}">${locked ? 'Locked' : 'Drafting'}</span>
                </div>
                <div class="formation-bar">
                    <label for="formation-${m.id}">Formation</label>
                    <select id="formation-${m.id}" class="formation-select" ${canEdit && !locked ? '' : 'disabled'}
                        onchange="changeFormation(${m.id}, this.value)">
                        ${presetOptions}
                    </select>
                </div>
                <p id="m${m.id}-formation-hint" class="pitch-hint"></p>
                <div class="pitch" id="pitch-${m.id}">
                    <div class="center-circle"></div><div class="center-dot"></div>
                    <div class="penalty-box-top"></div><div class="six-yard-top"></div>
                    <div class="penalty-box-bottom"></div><div class="six-yard-bottom"></div>
                </div>
                <div class="bench-label">Bench · ${BENCH_SLOTS} slots</div>
                <div id="bench-${m.id}" class="bench-area"></div>
                <div class="pitch-actions">
                    <button id="lock-btn-${m.id}" onclick="lockFormation(${m.id})" class="btn btn--primary">${locked ? 'Formation Locked' : 'Confirm Formation'}</button>
                    <button onclick="autoFillLineup(${m.id})" id="autofill-btn-${m.id}" class="btn btn--dark">Auto-fill Best XI</button>
                </div>
            </div>`;
    });

    gameState.managers.forEach(m => { updateDashboard(m.id); initPitch(m.id); });

    // Remote clubs are read-only here: their manager edits the XI on their own device.
    if (Net.online) {
        gameState.managers.forEach(m => {
            if (Net.canControl(m.id)) return;
            [`lock-btn-${m.id}`, `autofill-btn-${m.id}`].forEach(id => {
                const btn = document.getElementById(id);
                if (btn) { btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed'); }
            });
            const select = document.getElementById(`formation-${m.id}`);
            if (select) select.disabled = true;
            const hint = document.getElementById(`m${m.id}-formation-hint`);
            if (hint) hint.innerHTML = '<span class="text-slate-500 italic">This manager sets their own XI on their device.</span>';
        });
    }
}

function updateConnectionBadge(id) {
    const el = document.getElementById(`m${id}-conn`);
    if (!el) return;
    const online = typeof Net !== 'undefined' && Net.online;
    const connected = !online || (typeof Net.isManagerConnected === 'function' && Net.isManagerConnected(id));
    el.classList.toggle('hidden', connected);
}

function updateDashboard(id) {
    const m = gameState.managers.find(x => x.id === id);
    if (!m) return;

    const balEl = document.getElementById(`m${id}-balance`);
    const balWrap = document.getElementById(`m${id}-balance-wrap`);
    const isSolo = gameState.managers.length === 1;

    // Money now buys squad investment, so a solo manager still needs to see it.
    if (balWrap) balWrap.classList.remove('hidden');
    if (balEl) setText(balEl, formatBalance(m.balance));

    updateConnectionBadge(id);

    setText(document.getElementById(`m${id}-count`), String(m.squad.length));
    const list = document.getElementById(`m${id}-squad`);
    if (!list) return;
    setHTML(list, m.squad.length === 0
        ? '<li class="squad-empty">No players yet.</li>'
        : m.squad.map(p => renderSquadRow(p, {
            managerId: m.id,
            price: isSolo ? null : p.price
        })).join(''));

    updateBudgetTracker(id);
    updateChemistryDisplay(id);
    if (typeof updateInvestmentEntry === 'function') updateInvestmentEntry(id);
}

// ============================================================
// MATCHDAY PANELS
//
// A small stack of cards, one per human manager: under the league chart when a
// matchday has an injury or a ban, and floating at full time in a live match. Each card names the club,
// its result, the gate receipt, the fan movement, and any cards or injuries.
// ============================================================
const MATCH_REPORT_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24'];

function reportManagerColor(managerId) {
    const index = (gameState.managers || []).findIndex(m => String(m.id) === String(managerId));
    return MATCH_REPORT_COLORS[(index >= 0 ? index : 0) % MATCH_REPORT_COLORS.length];
}

function reportMatchPlural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

// One card per human club: result, gate, fans and any cards or injuries.
function matchReportCardsHTML(list) {
    return list.map(report => {
        const delta = Number(report.fanDelta) || 0;
        const deltaText = delta === 0
            ? '<em>—</em>'
            : `<em class="${delta < 0 ? 'down' : ''}">${delta > 0 ? '▲ +' : '▼ −'}${formatFanCount(Math.abs(delta))}</em>`;

        const injuries = (report.injuries || []).map(item => `
            <div class="match-report__event match-report__event--injury">🚑 <span><b>${escapeHTML(item.name)}</b> · out ${reportMatchPlural(item.matches, 'match', 'matches')}</span></div>`).join('');
        const suspensions = (report.suspensions || []).map(item => `
            <div class="match-report__event match-report__event--suspension">🟥 <span><b>${escapeHTML(item.name)}</b> · ${reportMatchPlural(item.matches, 'match', 'matches')} ban</span></div>`).join('');
        const yellows = Number(report.yellows) > 0
            ? `<div class="match-report__event match-report__event--yellow">🟨 ${reportMatchPlural(report.yellows, 'yellow card', 'yellow cards')}</div>`
            : '';
        const noEvents = !injuries && !suspensions && !yellows
            ? '<div class="match-report__empty">No new cards or injuries.</div>'
            : '';

        return `<div class="match-report" style="--report-accent:${reportManagerColor(report.managerId)}">
            <div class="match-report__head">
                <span class="match-report__name">${escapeHTML(report.name || 'Club')}</span>
                <span class="match-report__score match-report__score--${report.result}">${report.result} ${report.goalsFor}–${report.goalsAgainst}</span>
            </div>
            <div class="match-report__row"><span>Gate</span><b>+${formatBalance(report.revenue || 0)}</b></div>
            <div class="match-report__row"><span>Fans</span>${deltaText}</div>
            ${report.pens ? `<div class="match-report__row"><span>Penalties</span><b>${escapeHTML(report.pens)}</b></div>` : ''}
            ${injuries}${suspensions}${yellows}${noEvents}
        </div>`;
    }).join('');
}

// Floating full-time card for a live (non-European) match.
function showMatchdayReportPanels(reports, meta = {}) {
    const layer = document.getElementById('match-report-layer');
    if (!layer) return;
    const list = (reports || []).filter(Boolean);
    if (!list.length) return hideMatchReportPanels();

    const heading = meta.matchday ? `Matchday ${meta.matchday}` : (meta.title || 'Match update');
    layer.innerHTML = `<div class="match-report__title"><span>${escapeHTML(heading)}</span><button type="button" class="match-report__close" onclick="hideMatchReportPanels()" aria-label="Dismiss match updates">×</button></div>` + matchReportCardsHTML(list);
    layer.classList.remove('hidden');
}

function hideMatchReportLayer() {
    const layer = document.getElementById('match-report-layer');
    if (layer) {
        layer.classList.add('hidden');
        layer.innerHTML = '';
    }
}

function hideMatchReportPanels() {
    hideMatchReportLayer();
    hideSeasonEventPanel();
}

// A matchday counts as carrying events when it leaves something behind that the
// manager has to read: a ban, an injury or a booking.
function matchReportHasEvents(reports) {
    return (reports || []).filter(Boolean).some(report =>
        (report.injuries || []).length || (report.suspensions || []).length || Number(report.yellows) > 0);
}

// League replay: the updates for every club sit under the chart on every matchday.
// Only a matchday carrying events stops the replay and waits for Continue.
// Returns false (and shows nothing) when there is nowhere to show the panel, so the
// caller can carry on instead of waiting for a button that does not exist.
function showSeasonEventPanel(reports, matchday, onContinue) {
    const panel = document.getElementById('season-event-panel');
    const list = (reports || []).filter(Boolean);
    if (!panel || !list.length) return false;
    const blocking = typeof onContinue === 'function';
    panel.innerHTML = `
        <div class="season-event__head">Matchday ${matchday} · Updates</div>
        <div class="season-event__cards">${matchReportCardsHTML(list)}</div>
        ${blocking ? '<div class="season-event__foot"><button type="button" id="season-event-continue" class="season-event__btn">Continue</button></div>' : ''}`;
    panel.classList.remove('hidden');
    if (!blocking) return false;
    const button = document.getElementById('season-event-continue');
    button.onclick = () => {
        if (button.disabled) return;
        button.disabled = true;
        hideSeasonEventPanel();
        onContinue();
    };
    try { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); button.focus({ preventScroll: true }); } catch (err) { /* cosmetic */ }
    return true;
}

function hideSeasonEventPanel() {
    const panel = document.getElementById('season-event-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
}

function updateBudgetTracker(id) {
    const m = gameState.managers.find(x => x.id === id);
    const wrap = document.getElementById(`m${id}-budget`);
    if (!m || !wrap) return;

    if (gameState.managers.length === 1) {
        wrap.classList.add('hidden');
        return;
    }

    const reserve = getManagerReserve(m);
    const maxBid = getManagerMaxBid(m);
    const total = Math.max(1, m.balance);
    const spendPct = Math.max(0, Math.min(100, (maxBid / total) * 100));
    const reservePct = Math.max(0, Math.min(100, (reserve / total) * 100));

    wrap.classList.remove('hidden');
    const maxEl = document.getElementById(`m${id}-maxbid`);
    const reserveEl = document.getElementById(`m${id}-reserve`);
    const spendBar = document.getElementById(`m${id}-budget-bar`);
    const reserveBar = document.getElementById(`m${id}-reserve-bar`);
    if (maxEl) setText(maxEl, `€${maxBid}M`);
    if (reserveEl) setText(reserveEl, `€${reserve}M`);
    if (spendBar) spendBar.style.width = `${spendPct}%`;
    if (reserveBar) reserveBar.style.width = `${reservePct}%`;
}

function updateChemistryDisplay(id) {
    const m = gameState.managers.find(x => x.id === id);
    const el = document.getElementById(`m${id}-chem`);
    if (!m || !el) return;

    const chem = getFormationChemistry(m);
    if (!chem.players.length) {
        setHTML(el, '<b>Chemistry</b> · place players to build links.');
        return;
    }

    const groups = getChemistryGroups(chem.players);
    const detail = groups.length
        ? groups.map(group => `<span class="chem-group chem-group--${group.kind}">${escapeHTML(group.label)} ${group.count}×</span> <em>+${group.bonus}</em>`).join(' · ')
        : '<span>No links in the XI.</span>';

    setHTML(el, `<b>Chemistry</b> · ${detail}`);
}

function updateTeamOVR(id) {
    const m = gameState.managers.find(x => x.id === id);
    if (!m) return;
    const { total, count } = sumFormationOVR(m);
    const ovr = count === 0 ? 0 : Math.round(total / count);
    setText(document.getElementById(`m${id}-ovr-live`), String(ovr));
}

// --- Core Rules & OVR ---
function buildFormationFromPreset(key) {
    const preset = getFormationPreset(key);
    return preset.slots.map((slot, index) => ({
        id: index,
        x: slot.x,
        y: slot.y,
        isGK: !!slot.isGK,
        pos: slot.pos || (slot.isGK ? 'GK' : calcPosition(slot.x, slot.y, false)),
        assignedPlayerId: null
    }));
}

function initPitch(id) {
    const m = gameState.managers.find(x => x.id === id);
    // A preset key from an older save that no longer exists would leave the club built
    // as 4-4-2 while still claiming the dead shape, and the select could not be re-picked.
    m.formationPreset = FORMATION_PRESETS[m.formationPreset] ? m.formationPreset : '4-4-2';
    // A resumed save (or any re-render mid-draft) already carries a XI. Rebuilding
    // it here would silently unassign every player, so only seed a fresh club.
    if (!Array.isArray(m.formation) || !m.formation.length) {
        m.formation = buildFormationFromPreset(m.formationPreset);
    }
    renderPitchNodes(id); renderBenchNodes(m.id);
}

// OVR shown for a player in a formation slot, including the chemistry bonus.
function formationOvrInfo(player, node, chemBonus) {
    const baseOVR = getDynamicOVR(player, node.pos);
    const dynamicOVR = baseOVR + chemBonus;
    const isFit = baseOVR >= player.rating - 1;
    if (isFit && player.rank) {
        return { label: player.displayOVR, color: player.rank === 'GOAT' ? 'text-amber-300' : 'text-fuchsia-300' };
    }
    const color = dynamicOVR < player.rating * 0.7 ? 'text-red-400' : (dynamicOVR < player.rating ? 'text-yellow-400' : 'text-green-400');
    return { label: String(Math.min(100, dynamicOVR)), color };
}

function renderPitchNodes(managerId) {
    const pitch = document.getElementById(`pitch-${managerId}`);
    if (!pitch) return;
    pitch.querySelectorAll('.pitch-node').forEach(n => n.remove());
    pitch.querySelectorAll('.chem-lines').forEach(n => n.remove());
    const m = gameState.managers.find(x => x.id === managerId);
    if (!m) return;
    const chemistry = getFormationChemistry(m);
    // In an online room a rival's pitch is a preview: no handles, no dragging.
    const editable = !m.formationLocked && Net.canControl(managerId);

    // Draw the strongest links under the tokens so the XI reads at a glance.
    // Both kinds use one polyline each and only the four loudest are drawn, or a
    // squad with nation and club groups side by side becomes a spider web.
    const groups = getChemistryGroups(chemistry.players).slice(0, 4);
    if (groups.length) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'chem-lines');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        groups.forEach(group => {
            const points = m.formation
                .map(node => ({ node, player: m.squad.find(p => p.id === node.assignedPlayerId) }))
                .filter(item => item.player && chemistryKeysOf(item.player, group.kind).includes(group.key))
                .map(item => `${item.node.x},${item.node.y}`);
            if (points.length < 2) return;
            const line = document.createElementNS(svgNS, 'polyline');
            line.setAttribute('points', points.join(' '));
            line.setAttribute('class', `chem-line chem-line--${group.kind}${group.bonus >= CHEMISTRY.STRONG_BONUS ? ' is-strong' : ''}`);
            line.setAttribute('title', `${group.label} ×${group.count}`);
            svg.appendChild(line);
        });
        if (svg.childNodes.length) pitch.appendChild(svg);
    }

    m.formation.forEach(nodeData => {
        const el = document.createElement('div'); el.className = 'pitch-node';
        el.style.left = `${nodeData.x}%`; el.style.top = `${nodeData.y}%`;
        el.dataset.managerId = String(m.id);
        el.dataset.nodeId = String(nodeData.id);
        el.dataset.slotType = 'pitch';
        const player = m.squad.find(p => p.id === nodeData.assignedPlayerId);

        const chemBonus = player ? (chemistry.bonuses.get(player.id) || 0) : 0;
        const ovrInfo = player ? formationOvrInfo(player, nodeData, chemBonus) : null;
        const chemRing = chemBonus >= CHEMISTRY.STRONG_BONUS ? 'chem-strong' : (chemBonus > 0 ? 'chem-warm' : '');
        const gkClass = nodeData.isGK ? 'pitch-node-circle--gk' : '';

        el.innerHTML = `
            <div class="relative">
                <div class="pitch-node-circle ${gkClass} ${chemRing} ${m.formationLocked ? 'locked' : ''} ${nodeData.isGK ? 'gk-fixed' : ''}">
                    ${player ? `<span class="node-ovr">${ovrInfo.label}</span>` : ''}
                    <span class="node-pos">${nodeData.pos}</span>
                </div>
                ${editable && !player ? `<button onclick="openPlayerSelect(${m.id}, ${nodeData.id}, 'pitch')" class="pitch-node__add" title="Assign player">+</button>` : ''}
                ${editable && player ? `<button onclick="removePlayerFromNode(${m.id}, ${nodeData.id}, 'pitch')" class="pitch-node__remove" title="Remove player">&times;</button>` : ''}
            </div>
            ${player ? `<div class="pitch-node-label" title="${escapeHTML(player.team || 'Player')}${chemBonus ? ` · Chemistry +${chemBonus}` : ''}"><span>${escapeHTML(shortName(player.name))}</span>${chemBonus ? `<i>+${chemBonus}</i>` : ''}</div>` : ''}`;
        pitch.appendChild(el);
        if (!nodeData.isGK && editable) makeDraggable(el, pitch, m, nodeData);
    });
}

function renderBenchNodes(managerId) {
    const container = document.getElementById(`bench-${managerId}`);
    if (!container) return;
    container.innerHTML = '';
    const m = gameState.managers.find(x => x.id === managerId);
    if (!m) return;
    const editable = !m.formationLocked && Net.canControl(managerId);
    m.bench.forEach(nodeData => {
        const el = document.createElement('div'); el.className = 'bench-node';
        el.dataset.managerId = String(m.id);
        el.dataset.nodeId = String(nodeData.id);
        el.dataset.slotType = 'bench';
        const player = m.squad.find(p => p.id === nodeData.assignedPlayerId);
        el.innerHTML = `
            <div class="bench-circle ${player ? 'filled' : ''}">
                ${player
                    ? `<span class="bench-ovr">${player.displayOVR ?? player.rating}</span><span class="bench-name">${escapeHTML(shortName(player.name))}</span>`
                    : '<span>SUB</span>'}
            </div>
            ${editable && !player ? `<button onclick="openPlayerSelect(${m.id}, '${nodeData.id}', 'bench')" class="pitch-node__add" title="Assign bench player">+</button>` : ''}
            ${editable && player ? `<button onclick="removePlayerFromNode(${m.id}, '${nodeData.id}', 'bench')" class="pitch-node__remove" title="Remove bench player">&times;</button>` : ''}`;
        container.appendChild(el);
        if (player && editable) makeBenchDraggable(el, m, nodeData);
    });
}

function refreshLineup(managerId) {
    clearLineupSelection();
    renderPitchNodes(managerId);
    renderBenchNodes(managerId);
    updateTeamOVR(managerId);
    updateDashboard(managerId);
    Net.publishOwn(managerId);
}

function swapLineupSlots(managerId, pitchNodeId, benchNodeId) {
    const m = gameState.managers.find(x => x.id === managerId);
    if (!m || m.formationLocked || !Net.canControl(managerId)) return false;
    const pitchNode = m.formation.find(node => String(node.id) === String(pitchNodeId));
    const benchNode = m.bench.find(node => String(node.id) === String(benchNodeId));
    if (!pitchNode || !benchNode) return false;

    const pitchPlayerId = pitchNode.assignedPlayerId || null;
    const benchPlayerId = benchNode.assignedPlayerId || null;
    if (!pitchPlayerId && !benchPlayerId) return false;

    pitchNode.assignedPlayerId = benchPlayerId;
    benchNode.assignedPlayerId = pitchPlayerId;
    refreshLineup(m.id);
    return true;
}

function swapPitchSlots(managerId, firstNodeId, secondNodeId) {
    const m = gameState.managers.find(x => x.id === managerId);
    if (!m || m.formationLocked || !Net.canControl(managerId)) return false;
    const first = m.formation.find(node => String(node.id) === String(firstNodeId));
    const second = m.formation.find(node => String(node.id) === String(secondNodeId));
    if (!first || !second || first === second) return false;
    if (!first.assignedPlayerId && !second.assignedPlayerId) return false;

    const temp = first.assignedPlayerId || null;
    first.assignedPlayerId = second.assignedPlayerId || null;
    second.assignedPlayerId = temp;
    refreshLineup(m.id);
    return true;
}

function swapBenchSlots(managerId, firstNodeId, secondNodeId) {
    const m = gameState.managers.find(x => x.id === managerId);
    if (!m || m.formationLocked || !Net.canControl(managerId)) return false;
    const first = m.bench.find(node => String(node.id) === String(firstNodeId));
    const second = m.bench.find(node => String(node.id) === String(secondNodeId));
    if (!first || !second || first === second) return false;
    if (!first.assignedPlayerId && !second.assignedPlayerId) return false;

    const temp = first.assignedPlayerId || null;
    first.assignedPlayerId = second.assignedPlayerId || null;
    second.assignedPlayerId = temp;
    refreshLineup(m.id);
    return true;
}

// Click-to-swap: click a filled player, then click another slot. Clicking the same
// player again cancels. Empty slots can still be assigned with the + button.
let lineupSelection = null;

function lineupNodeFor(manager, type, nodeId) {
    if (!manager) return null;
    return type === 'pitch'
        ? manager.formation.find(node => String(node.id) === String(nodeId))
        : manager.bench.find(node => String(node.id) === String(nodeId));
}

function clearLineupSelection() {
    lineupSelection = null;
    document.querySelectorAll('.pitch-node.selected, .bench-node.selected')
        .forEach(node => node.classList.remove('selected'));
}

function highlightLineupSelection() {
    document.querySelectorAll('.pitch-node.selected, .bench-node.selected')
        .forEach(node => node.classList.remove('selected'));
    if (!lineupSelection) return;
    const container = document.getElementById(
        lineupSelection.type === 'pitch' ? `pitch-${lineupSelection.managerId}` : `bench-${lineupSelection.managerId}`
    );
    if (!container) return;
    const target = [...container.querySelectorAll('[data-node-id]')]
        .find(node => String(node.dataset.nodeId) === String(lineupSelection.nodeId));
    if (target) target.classList.add('selected');
}

function handleLineupClick(manager, type, nodeId) {
    if (!manager || manager.formationLocked) return;
    const node = lineupNodeFor(manager, type, nodeId);
    if (!node) return;

    if (!lineupSelection || lineupSelection.managerId !== manager.id) {
        if (!node.assignedPlayerId) {
            openPlayerSelect(manager.id, nodeId, type);
            return;
        }
        lineupSelection = { managerId: manager.id, type, nodeId };
        highlightLineupSelection();
        return;
    }

    const sameNode = lineupSelection.type === type && String(lineupSelection.nodeId) === String(nodeId);
    if (sameNode) {
        clearLineupSelection();
        return;
    }

    if (lineupSelection.type === 'pitch' && type === 'pitch') {
        swapPitchSlots(manager.id, lineupSelection.nodeId, nodeId);
    } else if (lineupSelection.type === 'bench' && type === 'bench') {
        swapBenchSlots(manager.id, lineupSelection.nodeId, nodeId);
    } else {
        swapLineupSlots(manager.id, lineupSelection.type === 'pitch' ? lineupSelection.nodeId : nodeId,
            lineupSelection.type === 'bench' ? lineupSelection.nodeId : nodeId);
    }
    clearLineupSelection();
}


function clearDropTargets() {
    document.querySelectorAll('.pitch-node.drop-target, .bench-node.drop-target')
        .forEach(node => node.classList.remove('drop-target'));
}

function dropTargetAt(clientX, clientY, managerId, selector) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const under = document.elementFromPoint(clientX, clientY);
    const target = under && under.closest(selector);
    if (!target || String(target.dataset.managerId) !== String(managerId)) return null;
    return target;
}

function makeBenchDraggable(element, m, nodeData) {
    let isDragging = false, moved = false, startX = 0, startY = 0, lastPoint = null;
    const getPoint = e => e.touches ? e.touches[0] : e;

    const doDrag = e => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const point = getPoint(e);
        if (!point) return;
        if (Math.abs(point.clientX - startX) + Math.abs(point.clientY - startY) > 6) moved = true;
        lastPoint = point;
        if (!moved) return;
        clearDropTargets();
        const target = dropTargetAt(point.clientX, point.clientY, m.id, `.pitch-node[data-manager-id="${m.id}"]`);
        if (target) target.classList.add('drop-target');
    };

    const endDrag = e => {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchmove', doDrag);
        document.removeEventListener('touchend', endDrag);
        element.style.pointerEvents = '';
        element.classList.remove('dragging');
        clearDropTargets();

        if (!moved) {
            handleLineupClick(m, 'bench', nodeData.id);
            return;
        }

        const point = lastPoint || getPoint(e);
        const target = point && dropTargetAt(point.clientX, point.clientY, m.id, `.pitch-node[data-manager-id="${m.id}"]`);
        if (target) swapLineupSlots(m.id, target.dataset.nodeId, nodeData.id);
    };

    const startDrag = e => {
        if (m.formationLocked || !nodeData.assignedPlayerId || e.target.closest('button')) return;
        if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
        const point = getPoint(e);
        if (!point) return;
        startX = point.clientX; startY = point.clientY; lastPoint = point; moved = false;
        isDragging = true;
        element.style.pointerEvents = 'none';
        element.classList.add('dragging');
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchmove', doDrag, { passive: false });
        document.addEventListener('touchend', endDrag);
    };

    element.onmousedown = startDrag;
    element.ontouchstart = startDrag;
}

function makeDraggable(element, container, m, nodeData) {
    let isDragging = false, moved = false, startX, startY, lastPoint = null;
    const getPoint = e => e.touches ? e.touches[0] : e;
    
    const doDrag = e => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const pt = getPoint(e);
        if (!pt) return;
        if (Math.abs(pt.clientX - startX) + Math.abs(pt.clientY - startY) > 6) moved = true;
        lastPoint = pt;
        if (!moved) return;

        const rect = container.getBoundingClientRect();
        let px = (nodeData.x/100)*rect.width + (pt.clientX - startX);
        let py = (nodeData.y/100)*rect.height + (pt.clientY - startY);
        px = Math.max(20, Math.min(px, rect.width - 20));
        py = Math.max(20, Math.min(py, rect.height - 20));
        element.style.left = `${(px/rect.width)*100}%`;
        element.style.top = `${(py/rect.height)*100}%`;
        
        const posSpan = element.querySelector('.node-pos');
        if (posSpan) posSpan.innerText = calcPosition((px/rect.width)*100, (py/rect.height)*100, false);

        clearDropTargets();
        const benchTarget = dropTargetAt(pt.clientX, pt.clientY, m.id, `.bench-node[data-manager-id="${m.id}"]`);
        if (benchTarget) benchTarget.classList.add('drop-target');
    };
    
    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', doDrag); document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchmove', doDrag); document.removeEventListener('touchend', endDrag);
        element.style.zIndex = 10;
        element.style.pointerEvents = '';
        clearDropTargets();

        if (!moved) {
            handleLineupClick(m, 'pitch', nodeData.id);
            return;
        }

        if (lastPoint) {
            const benchTarget = dropTargetAt(lastPoint.clientX, lastPoint.clientY, m.id, `.bench-node[data-manager-id="${m.id}"]`);
            if (benchTarget) {
                swapLineupSlots(m.id, nodeData.id, benchTarget.dataset.nodeId);
                return;
            }
        }
        
        nodeData.x = parseFloat(element.style.left);
        nodeData.y = parseFloat(element.style.top);
        nodeData.pos = calcPosition(nodeData.x, nodeData.y, false);
        renderPitchNodes(m.id); updateTeamOVR(m.id);
        Net.publishOwn(m.id);
    };

    const startDrag = e => {
        if (m.formationLocked || e.target.closest('button')) return;
        if (e.type === 'touchstart' && e.cancelable) e.preventDefault();
        const pt = getPoint(e); if (!pt) return;
        startX = pt.clientX; startY = pt.clientY; lastPoint = pt; moved = false;
        isDragging = true; element.style.zIndex = 100;
        element.style.pointerEvents = 'none';
        document.addEventListener('mousemove', doDrag); document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchmove', doDrag, { passive: false }); document.addEventListener('touchend', endDrag);
    };
    element.onmousedown = startDrag; element.ontouchstart = startDrag;
}

// --- Modals ---
let modalState = { managerId: null, nodeId: null, type: null, filter: 'ALL', timer: null };

function pickerFilterOf(player) {
    const pos = player && player.mainPos;
    if (pos === 'GK') return 'GK';
    if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
    if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
    if (['LW', 'RW', 'CF', 'ST'].includes(pos)) return 'ATT';
    return 'MID';
}

function pickerMatchesFilter(player, filter) {
    return filter === 'ALL' || pickerFilterOf(player) === filter;
}

function renderPickerFilters(avail) {
    const wrap = document.getElementById('picker-filters');
    if (!wrap) return;
    const filters = [
        { key: 'ALL', label: 'All' },
        { key: 'GK', label: 'GK' },
        { key: 'DEF', label: 'DEF' },
        { key: 'MID', label: 'MID' },
        { key: 'ATT', label: 'ATT' }
    ];
    wrap.innerHTML = filters.map(item => {
        const count = item.key === 'ALL' ? avail.length : avail.filter(player => pickerFilterOf(player) === item.key).length;
        return `<button type="button" class="picker-filter ${modalState.filter === item.key ? 'is-active' : ''}" onclick="setPickerFilter('${item.key}')">${item.label} <span style="opacity:.55">${count}</span></button>`;
    }).join('');
}

function setPickerFilter(filter) {
    modalState.filter = filter;
    renderPlayerPickerList();
}

function renderPlayerPickerList() {
    const m = gameState.managers.find(x => x.id === modalState.managerId);
    if (!m) return;
    const node = modalState.type === 'pitch'
        ? m.formation.find(n => n.id === modalState.nodeId)
        : m.bench.find(n => n.id === modalState.nodeId);
    if (!node) return;

    const assigned = [...m.formation, ...m.bench].map(n => n.assignedPlayerId).filter(id => id);
    const avail = m.squad.filter(player => !assigned.includes(player.id));
    renderPickerFilters(avail);

    const filtered = avail.filter(player => pickerMatchesFilter(player, modalState.filter));
    filtered.sort((a, b) => {
        const av = node.pos === 'SUB' ? a.rating : getDynamicOVR(a, node.pos);
        const bv = node.pos === 'SUB' ? b.rating : getDynamicOVR(b, node.pos);
        return bv - av || b.rating - a.rating;
    });

    const list = document.getElementById('modal-player-list');
    if (!list) return;
    list.innerHTML = filtered.length ? filtered.map(player => {
        const dOvr = node.pos === 'SUB' ? player.rating : getDynamicOVR(player, node.pos);
        const isFit = node.pos === 'SUB' || dOvr >= player.rating - 1;
        const fitText = node.pos === 'SUB'
            ? `OVR ${player.rating}`
            : `OVR at ${node.pos}: <b>${Math.round(dOvr)}</b>${isFit ? ' · natural' : ''}`;
        return `
            <div class="picker-card" role="button" tabindex="0" onclick="assignPlayer(${player.id})"
                 onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();assignPlayer(${player.id})}">
                ${renderPlayerCard(player, { size: 'md' })}
                <span class="picker-card__fit">${fitText}</span>
                <button type="button" class="picker-card__info" title="View full card"
                    onclick="event.stopPropagation();openPlayerCard(${player.id}, ${m.id})">i</button>
            </div>`;
    }).join('') : '<div class="picker-empty">No available players for this slot.</div>';
}

function openPlayerSelect(mId, nId, type) {
    clearLineupSelection();
    clearTimeout(modalState.timer);
    modalState = { managerId: mId, nodeId: nId, type, filter: 'ALL', timer: null };
    const m = gameState.managers.find(x => x.id === mId);
    if (!m) return;
    const node = type === 'pitch' ? m.formation.find(n => n.id === nId) : m.bench.find(n => n.id === nId);
    if (!node) return;

    document.getElementById('modal-pos-name').innerText = node.pos;
    const sub = document.getElementById('modal-picker-sub');
    if (sub) sub.innerText = type === 'pitch'
        ? `Best available players for the ${node.pos} slot`
        : 'Best available players for the bench';
    renderPlayerPickerList();

    const modal = document.getElementById('player-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    setTimeout(() => {
        const first = modal.querySelector('#modal-player-list .picker-card') || modal.querySelector('.modal-close');
        if (first) first.focus();
    }, 30);
}

function closeModal() {
    const modal = document.getElementById('player-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    clearTimeout(modalState.timer);
    modalState.timer = setTimeout(() => modal.classList.add('hidden'), 180);
}

function assignPlayer(pId) {
    const m = gameState.managers.find(x => x.id === modalState.managerId);
    if (!m || !Net.canControl(m.id)) return;
    if (!m.squad.some(player => player.id === pId)) return;
    const node = modalState.type === 'pitch' ? m.formation.find(n => n.id === modalState.nodeId) : m.bench.find(n => n.id === modalState.nodeId);
    if (!node) return;
    // The list was built when the modal opened, so a remote update can have seated this
    // man elsewhere meanwhile. Unseat him first: one player, one spot.
    [...m.formation, ...m.bench].forEach(other => {
        if (other !== node && other.assignedPlayerId === pId) other.assignedPlayerId = null;
    });
    node.assignedPlayerId = pId;
    modalState.type === 'pitch' ? renderPitchNodes(m.id) : renderBenchNodes(m.id);
    updateTeamOVR(m.id); updateDashboard(m.id); closeModal();
    Net.publishOwn(m.id);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
}
function removePlayerFromNode(mId, nId, type) {
    const m = gameState.managers.find(x => x.id === mId);
    if (!m || !Net.canControl(mId)) return;
    const node = type === 'pitch' ? m.formation.find(n => n.id === nId) : m.bench.find(n => n.id === nId);
    if (!node) return;
    node.assignedPlayerId = null;
    type === 'pitch' ? renderPitchNodes(mId) : renderBenchNodes(mId);
    updateTeamOVR(mId); updateDashboard(mId);
    Net.publishOwn(mId);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
}
function optimalLineupAssignment(nodes, squad, keepBonus) {
    const slotCount = nodes.length;
    const assignment = new Array(slotCount).fill(null);
    if (!slotCount || !squad.length) return assignment;

    const isGK = p => p.mainPos === 'GK' || (Array.isArray(p.subPos) && p.subPos.includes('GK'));
    const canFill = (p, node) => node.isGK ? isGK(p) : p.mainPos !== 'GK';
    const stay = typeof keepBonus === 'function' ? keepBonus : () => 0;
    const values = squad.map(p => nodes.map(node => {
        if (!canFill(p, node)) return -Infinity;
        return getDynamicOVR(p, node.pos) + (p.mainPos === node.pos ? 0.01 : 0) + stay(p);
    }));

    const full = 1 << slotCount;
    const layers = Array.from({ length: squad.length + 1 }, () => new Float64Array(full).fill(-Infinity));
    const picked = Array.from({ length: squad.length + 1 }, () => new Int8Array(full).fill(-1));
    layers[0][0] = 0;

    for (let i = 0; i < squad.length; i++) {
        const prev = layers[i], next = layers[i + 1], pick = picked[i + 1], vals = values[i];
        for (let mask = 0; mask < full; mask++) {
            const score = prev[mask];
            if (score === -Infinity) continue;
            if (score > next[mask]) { next[mask] = score; pick[mask] = -1; }
            for (let j = 0; j < slotCount; j++) {
                const gain = vals[j];
                if (gain === -Infinity || (mask & (1 << j))) continue;
                const nextMask = mask | (1 << j);
                if (score + gain > next[nextMask]) { next[nextMask] = score + gain; pick[nextMask] = j; }
            }
        }
    }

    let bestMask = 0, bestScore = -Infinity;
    for (let mask = 0; mask < full; mask++) {
        if (layers[squad.length][mask] > bestScore) { bestScore = layers[squad.length][mask]; bestMask = mask; }
    }

    let mask = bestMask;
    for (let i = squad.length; i > 0; i--) {
        const slot = picked[i][mask];
        if (slot >= 0) { assignment[slot] = squad[i - 1]; mask ^= 1 << slot; }
    }
    return assignment;
}

function autoFillLineup(mId) {
    const m = gameState.managers.find(x => x.id === mId);
    if (!m || m.formationLocked) return;
    if (!Net.canControl(mId)) return showToast('Only that manager can set their own XI.');
    const draft = gameState.activeDraft;
    if (draft && (draft.state === 'spinning' || draft.state === 'picked' || (draft.state === 'revealed' && !draft.player.sold))) {
        return showToast('Resolve the current player before auto-filling.');
    }
    if (!m.squad.length) return showToast('No players drafted yet.');

    const used = new Set();
    const assignment = optimalLineupAssignment(m.formation, m.squad);
    let filled = 0;
    m.formation.forEach((node, index) => {
        const player = assignment[index];
        node.assignedPlayerId = player ? player.id : null;
        if (player) { used.add(player.id); filled++; }
    });

    fillBenchFromSquad(m, used);

    renderPitchNodes(mId); renderBenchNodes(mId); updateTeamOVR(mId); updateDashboard(mId);
    Net.publishOwn(mId);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    const gkNode = m.formation.find(n => n.isGK);
    const noGkNote = filled > 0 && gkNode && !gkNode.assignedPlayerId ? ' No GK in squad — goalkeeper slot left open.' : '';
    showToast(`${filled}/${STARTERS} starters placed for ${m.name}.${noGkNote}`);
}

// The bench takes whoever the XI has no room for, best-rated first.
function fillBenchFromSquad(m, used) {
    m.bench.forEach(slot => {
        let best = null, bestRating = -Infinity;
        m.squad.forEach(p => {
            if (used.has(p.id)) return;
            if (p.rating > bestRating) { bestRating = p.rating; best = p; }
        });
        slot.assignedPlayerId = best ? best.id : null;
        if (best) used.add(best.id);
    });
}

// A new shape rearranges the men already on the pitch into their closest new
// slots. Empty slots stay empty and the bench is left alone — filling the team
// is what Auto-fill Best XI is for.
function changeFormation(mId, key) {
    const m = gameState.managers.find(x => x.id === mId);
    if (!m) return;
    const keep = () => {
        const select = document.getElementById(`formation-${m.id}`);
        if (select) select.value = m.formationPreset || '4-4-2';
    };
    if (m.formationLocked) { keep(); return showToast('Formation is locked.'); }
    if (!Net.canControl(mId)) { keep(); return showToast('Only that manager can set their own XI.'); }
    if (!FORMATION_PRESETS[key]) { keep(); return; }
    const draft = gameState.activeDraft;
    if (draft && (draft.state === 'spinning' || draft.state === 'picked' || (draft.state === 'revealed' && !draft.player.sold))) {
        keep();
        return showToast('Resolve the current player before changing formation.');
    }

    const onPitch = new Set(m.formation.map(node => node.assignedPlayerId).filter(Boolean));
    const keptPlayers = m.squad.filter(p => onPitch.has(p.id));
    m.formationPreset = key;
    m.formation = buildFormationFromPreset(key);
    let kept = 0;
    if (keptPlayers.length) {
        optimalLineupAssignment(m.formation, keptPlayers).forEach((player, index) => {
            m.formation[index].assignedPlayerId = player ? player.id : null;
            if (player) kept++;
        });
    }

    renderPitchNodes(mId); renderBenchNodes(mId); updateTeamOVR(mId); updateDashboard(mId);
    Net.publishOwn(mId);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    showToast(`${FORMATION_PRESETS[key].label}: ${kept}/${STARTERS} starters kept.`);
}

let pendingTacticsManagerId = null;

function openTacticsModalForManager(mId) {
    pendingTacticsManagerId = mId;
    const m = gameState.managers.find(x => x.id === mId);
    document.getElementById('tactics-matchup').innerText = `${m.name} Tactics`;
    matchTactics = normalizeTactics(m.tactics);
    renderTacticsOptions();
    const modal = document.getElementById('tactics-modal'), panel = document.getElementById('tactics-panel');
    modal.classList.remove('hidden'); modal.classList.add('flex');
    setTimeout(() => { modal.classList.remove('opacity-0'); panel.classList.remove('scale-95'); }, 10);
}

function lockFormation(mId) {
    const m = gameState.managers.find(x => x.id === mId);
    if (!m || m.formationLocked) return;
    if (!Net.canControl(mId)) return showToast('Only that manager can lock their own club.');
    const draft = gameState.activeDraft;
    if (draft && (draft.state === 'spinning' || draft.state === 'picked' || (draft.state === 'revealed' && !draft.player.sold))) {
        return showToast('Resolve the current player before locking formations.');
    }
    if (m.formation.filter(n => n.assignedPlayerId).length < STARTERS) return showToast(`Place ${STARTERS} players first!`);
    
    const gkNode = m.formation.find(n => n.isGK), gk = m.squad.find(p => p.id === gkNode.assignedPlayerId);
    if (gk && m.gkWarned !== gk.id && getDynamicOVR(gk, 'GK') < gk.rating) {
        m.gkWarned = gk.id; return showToast(`${gk.name} isn't a GK. Press Confirm again to lock anyway.`);
    }
    openTacticsModalForManager(mId);
}

function checkMatchReady() {
    const wrap = document.getElementById('matchup-btn-container');
    if (!wrap) return;
    const allLocked = gameState.managers.every(m => m.formationLocked);
    if (!Net.ownsGame()) {
        // Running the matches is the host's button; guests just wait for it.
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
        if (allLocked) Online.note('Waiting for host...');
        return;
    }
    if (allLocked) {
        wrap.classList.remove('hidden');
        wrap.classList.add('flex');
    }
}

// --- How it works guide ---
let howToReturnFocus = null;

function openHowTo() {
    const modal = document.getElementById('howto-modal'), panel = document.getElementById('howto-panel');
    if (!modal || !panel) return;
    if (modal.classList.contains('hidden')) howToReturnFocus = document.activeElement;
    modal.classList.remove('hidden'); modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        panel.classList.remove('scale-95');
        const closeBtn = panel.querySelector('button[aria-label="Close guide"]');
        if (closeBtn) closeBtn.focus();
    }, 10);
}

function closeHowTo() {
    const modal = document.getElementById('howto-modal'), panel = document.getElementById('howto-panel');
    if (!modal || !panel) return;
    modal.classList.add('opacity-0'); panel.classList.add('scale-95');
    const restore = howToReturnFocus;
    howToReturnFocus = null;
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        if (restore && typeof restore.focus === 'function') restore.focus();
    }, 200);
}

function closeTacticsModal() {
    const modal = document.getElementById('tactics-modal'), panel = document.getElementById('tactics-panel');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('opacity-0');
    if (panel) panel.classList.add('scale-95');
    setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 200);
    pendingTacticsManagerId = null;
}

// Escape closes the topmost dismissible modal.
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const isOpen = id => {
        const modal = document.getElementById(id);
        return modal && !modal.classList.contains('hidden');
    };
    if (isOpen('card-modal')) { closePlayerCard(); return; }
    if (isOpen('howto-modal')) { closeHowTo(); return; }
    if (isOpen('player-modal')) { closeModal(); return; }
    if (isOpen('tactics-modal')) { closeTacticsModal(); return; }
    if (isOpen('ratings-modal')) { closeMatchRatings(); return; }
});

