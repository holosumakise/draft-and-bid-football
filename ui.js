// --- Core Helpers ---
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
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

// A backgrounded tab never paints, so rAF callbacks are never reached. An online
// host normally sits in a background tab while it waits for a guest's bid, and
// the fly-over is the only thing that re-enables the Roll button — hence the timer.
function runWhenPainted(fn) {
    let done = false;
    const run = () => { if (done) return; done = true; fn(); };
    requestAnimationFrame(run);
    setTimeout(run, 300);
}

/** Animate a drafted player from the draft panel into the winning manager's squad card. */
function playDraftAcquisitionAnimation(player, winnerId, onComplete) {    // Mobile-proof scroll lock: pin body with position:fixed (works on iOS where overflow:hidden fails)
    let scrollLocked = false;
    let lockedScrollY = 0;
    const blockTouch = (e) => { e.preventDefault(); };

    const lockScroll = () => {
        if (scrollLocked) return;
        scrollLocked = true;
        lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${lockedScrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
        document.addEventListener('touchmove', blockTouch, { passive: false, capture: true });
        window.addEventListener('touchmove', blockTouch, { passive: false, capture: true });
    };

    const unlockScroll = () => {
        if (!scrollLocked) return;
        scrollLocked = false;
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.touchAction = '';
        document.removeEventListener('touchmove', blockTouch, { capture: true });
        window.removeEventListener('touchmove', blockTouch, { capture: true });
        window.scrollTo(0, lockedScrollY);
    };

    const finish = () => {
        unlockScroll();
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

    if (gameState.draftAnimating || document.getElementById('draft-fly-overlay') || document.querySelector('.draft-sold-stamp')) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    gameState.draftAnimating = true;
    updateRollButton();

    // Instant scroll into view, then lock (so measurements can't drift)
    try { target.scrollIntoView({ behavior: 'instant', block: 'nearest' }); } catch (_) {
        try { target.scrollIntoView({ block: 'nearest' }); } catch (__) {}
    }
    lockScroll();

    runWhenPainted(() => {
        const src = panel.getBoundingClientRect();
        const dst = target.getBoundingClientRect();
        if (src.width < 4 || dst.width < 4) return finish();

        const x0 = src.left + src.width / 2;
        const y0 = src.bottom - 6;
        const x1 = dst.left + dst.width / 2;
        const y1 = dst.top + Math.min(40, dst.height * 0.3);

        const drop = Math.max(36, Math.min(90, (y1 - y0) * 0.5));
        const cornerY = y0 + drop;
        const dx = x1 - x0;
        const useL = Math.abs(dx) > 36;

        let pathD;
        if (useL) {
            // Smooth L using cubics only (arcs break dash-length animation in some browsers)
            const midY = cornerY;
            pathD = [
                `M ${x0} ${y0}`,
                `C ${x0} ${y0 + (midY - y0) * 0.55}, ${x0} ${midY}, ${x0 + (x1 - x0) * 0.15} ${midY}`,
                `C ${x0 + (x1 - x0) * 0.55} ${midY}, ${x1} ${midY}, ${x1} ${midY + (y1 - midY) * 0.35}`,
                `L ${x1} ${y1}`
            ].join(' ');
        } else {
            pathD = `M ${x0} ${y0} C ${x0} ${(y0 + y1) / 2}, ${x1} ${(y0 + y1) / 2}, ${x1} ${y1}`;
        }

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

        panel.classList.add('draft-panel-sold-react');

        const overlay = document.createElement('div');
        overlay.id = 'draft-fly-overlay';

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        // Explicit pixel size + viewBox so path coords (viewport px) map 1:1 on every path shape
        svg.setAttribute('width', String(vw));
        svg.setAttribute('height', String(vh));
        svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
        svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;';

        // Hidden full path — only used for length / point sampling
        const guide = document.createElementNS(svgNS, 'path');
        guide.setAttribute('d', pathD);
        guide.setAttribute('fill', 'none');
        guide.setAttribute('stroke', 'none');
        svg.appendChild(guide);

        // Visible trail that grows by rewriting `d` each frame (reliable on turns)
        const trail = document.createElementNS(svgNS, 'path');
        trail.setAttribute('fill', 'none');
        trail.setAttribute('stroke', '#34d399');
        trail.setAttribute('stroke-width', '3');
        trail.setAttribute('stroke-linecap', 'round');
        trail.setAttribute('stroke-linejoin', 'round');
        trail.setAttribute('class', 'draft-fly-arrow-line');
        trail.style.opacity = '1';
        trail.style.filter = 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.55))';
        svg.appendChild(trail);

        const head = document.createElementNS(svgNS, 'polygon');
        head.setAttribute('class', 'draft-fly-arrow-head');
        head.style.opacity = '0';
        head.style.fill = '#34d399';
        head.style.filter = 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.55))';
        svg.appendChild(head);
        overlay.appendChild(svg);

        const circle = document.createElement('div');
        circle.className = 'draft-fly-circle';
        circle.style.left = `${x0}px`;
        circle.style.top = `${y0}px`;
        overlay.appendChild(circle);
        document.body.appendChild(overlay);

        let pathLen = 0;
        try { pathLen = guide.getTotalLength() || 0; } catch (_) { pathLen = 0; }
        if (pathLen < 8) {
            // Fallback length estimate
            pathLen = Math.hypot(x1 - x0, y1 - y0) + Math.abs(dx) * 0.3 + 40;
        }

        const cleanup = () => {
            if (stamp.parentNode) stamp.remove();
            if (overlay.parentNode) overlay.remove();
            panel.classList.remove('draft-panel-sold-react');
            if (prevPos !== undefined) stampHost.style.position = prevPos;
            target.classList.remove('draft-target-receive');
            finish();
        };

        const pointAt = (t) => {
            try {
                const pt = guide.getPointAtLength(pathLen * t);
                return { x: pt.x, y: pt.y };
            } catch (_) {
                return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
            }
        };

        // Build visible trail up to progress e (0..1) by sampling the guide path
        const buildTrail = (e) => {
            const n = Math.max(2, Math.ceil(e * 48));
            let d = '';
            for (let i = 0; i <= n; i++) {
                const p = pointAt(e * (i / n));
                d += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
            }
            trail.setAttribute('d', d);
        };

        setTimeout(() => {
            circle.style.transition = 'opacity 0.2s ease, transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
            circle.style.opacity = '1';
            circle.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 220);

        setTimeout(() => {
            const duration = 1300;
            const t0 = performance.now();
            let landed = false;

            function ease(t) {
                return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            }

            // The stamp holds while the arrow lands, then the whole overlay clears.
            const arrive = () => {
                if (landed) return;
                landed = true;
                buildTrail(1);
                head.style.opacity = '1';
                target.classList.add('draft-target-receive');
                circle.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
                circle.style.opacity = '0';
                circle.style.transform = 'translate(-50%, -50%) scale(0.35)';
                trail.style.transition = 'opacity 0.85s ease';
                head.style.transition = 'opacity 0.85s ease';
                trail.style.opacity = '0';
                head.style.opacity = '0';
                setTimeout(() => {
                    stamp.style.transition = 'opacity 0.4s ease';
                    stamp.style.opacity = '0';
                }, 500);
                setTimeout(cleanup, 1100);
            };

            function frame(now) {
                if (landed) return;
                const t = Math.min(1, (now - t0) / duration);
                const e = ease(t);
                const p = pointAt(e);

                buildTrail(e);

                // Point arrowhead along the last segment of the path
                if (e > 0.05) {
                    const prev = pointAt(Math.max(0, e - 0.04));
                    const ang = Math.atan2(p.y - prev.y, p.x - prev.x);
                    const hl = 12;
                    head.setAttribute('points', [
                        `${p.x},${p.y}`,
                        `${p.x - hl * Math.cos(ang - 0.4)},${p.y - hl * Math.sin(ang - 0.4)}`,
                        `${p.x - hl * Math.cos(ang + 0.4)},${p.y - hl * Math.sin(ang + 0.4)}`
                    ].join(' '));
                    head.style.opacity = e > 0.75 ? String(Math.min(1, (e - 0.75) / 0.25)) : '0';
                }

                circle.style.left = `${p.x}px`;
                circle.style.top = `${p.y}px`;
                const s = 1 + Math.sin(e * Math.PI) * 0.1;
                circle.style.transform = `translate(-50%, -50%) scale(${s})`;

                if (t < 1) {
                    requestAnimationFrame(frame);
                } else {
                    arrive();
                }
            }
            requestAnimationFrame(frame);
            // A backgrounded tab never reaches an animation frame, and an online host
            // spends most of the auction in a background tab while a guest bids. The
            // fly-over is what re-enables Roll, so land it from a timer instead.
            setTimeout(() => {
                if (landed) return;
                const p = pointAt(1);
                circle.style.transition = 'none';
                circle.style.left = `${p.x}px`;
                circle.style.top = `${p.y}px`;
                arrive();
            }, duration + 900);
        }, 320);
    });
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

    // Avoid stacking on top of an in-flight SOLD animation
    if (document.querySelector('.draft-sold-stamp') || document.getElementById('draft-fly-overlay')) {
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

    panel.classList.add('draft-panel-sold-react');

    // Hold the stamp long enough to read, then fade and clean up
    setTimeout(() => {
        stamp.style.transition = 'opacity 0.5s ease';
        stamp.style.opacity = '0';
        setTimeout(() => {
            if (stamp.parentNode) stamp.remove();
            panel.classList.remove('draft-panel-sold-react');
            if (prevPos !== undefined) stampHost.style.position = prevPos;
            gameState.draftAnimating = false;
            updateRollButton();
            finish();
        }, 500);
    }, 1250);
}



function formatBalance(amount) { return amount >= 1000 ? `€${(amount / 1000).toFixed(2)}B` : `€${amount}M`; }
function formatPositions(player) {
    if (!player) return "";
    const main = typeof player.mainPos === "string" ? player.mainPos : "";
    const subs = Array.isArray(player.subPos) ? player.subPos.filter(p => typeof p === "string") : [];
    return [main, ...subs].filter(Boolean).join("/");
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

    if (balWrap) {
        if (isSolo) balWrap.classList.add('hidden');
        else balWrap.classList.remove('hidden');
    }
    if (balEl && !isSolo) balEl.innerText = formatBalance(m.balance);

    updateConnectionBadge(id);

    document.getElementById(`m${id}-count`).innerText = m.squad.length;
    const list = document.getElementById(`m${id}-squad`);
    if (!list) return;
    list.innerHTML = m.squad.length === 0
        ? '<li class="squad-empty">No players yet.</li>'
        : m.squad.map(p => renderSquadRow(p, {
            managerId: m.id,
            price: isSolo ? null : p.price
        })).join('');

    updateBudgetTracker(id);
    updateChemistryDisplay(id);
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
    if (maxEl) maxEl.innerText = `€${maxBid}M`;
    if (reserveEl) reserveEl.innerText = `€${reserve}M`;
    if (spendBar) spendBar.style.width = `${spendPct}%`;
    if (reserveBar) reserveBar.style.width = `${reservePct}%`;
}

function updateChemistryDisplay(id) {
    const m = gameState.managers.find(x => x.id === id);
    const el = document.getElementById(`m${id}-chem`);
    if (!m || !el) return;

    const chem = getFormationChemistry(m);
    if (!chem.players.length) {
        el.innerHTML = '<b>Chemistry</b> · place players to build links.';
        return;
    }

    const groups = getChemistryGroups(chem.players);
    const detail = groups.length
        ? groups.map(group => `<span class="chem-group chem-group--${group.kind}">${escapeHTML(group.label)} ${group.count}×</span> <em>+${group.bonus}</em>`).join(' · ')
        : '<span>No links in the XI.</span>';

    el.innerHTML = `<b>Chemistry</b> · ${detail}`;
}

function updateTeamOVR(id) {
    const m = gameState.managers.find(x => x.id === id);
    if (!m) return;
    const { total, count } = sumFormationOVR(m);
    const ovr = count === 0 ? 0 : Math.round(total / count);
    document.getElementById(`m${id}-ovr-live`).innerText = String(ovr);
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

// A new shape seats the club's best XI for that shape, with a nudge toward the men
// already on the pitch: 4-4-2 to 4-3-3 should move a line, not drop half a squad.
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
    m.formationPreset = key;
    m.formation = buildFormationFromPreset(key);
    const used = new Set();
    let filled = 0;
    optimalLineupAssignment(m.formation, m.squad, p => onPitch.has(p.id) ? 0.5 : 0).forEach((player, index) => {
        m.formation[index].assignedPlayerId = player ? player.id : null;
        if (player) { used.add(player.id); filled++; }
    });
    fillBenchFromSquad(m, used);

    renderPitchNodes(mId); renderBenchNodes(mId); updateTeamOVR(mId); updateDashboard(mId);
    Net.publishOwn(mId);
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    showToast(`${FORMATION_PRESETS[key].label}: ${filled}/${STARTERS} starters placed.`);
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

