// ============================================================
// SQUAD INVESTMENT
//
// Leftover auction money buys something other than a trade tip:
//   - Training camp: permanent +1 OVR and +1 to every stat per level,
//     capped at three levels per player and rising in price.
//   - Medical & fitness: season-long reduction of injury risk, late-game
//     fatigue and a small conditioning edge on every line.
//   - Stadium: better facilities raise ticket revenue and fan growth rate
//     after every matchday.
//
// The host owns money, squads and programmes. In an online room a guest
// sends an `invest` command and receives the result in the manager snapshot.
// ============================================================

const Investment = (() => {
    const TABS = [
        ['training', 'Training'],
        ['medical', 'Medical'],
        ['stadium', 'Stadium']
    ];
    const STAT_KEYS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const TRACK_MAX = {
        medical: INVESTMENT.MEDICAL_COSTS.length,
        stadium: (INVESTMENT.STADIUM_COSTS || INVESTMENT.SCOUTING_COSTS || []).length
    };

    let state = null;
    let modal = null;

    const esc = value => (typeof escapeHTML === 'function' ? escapeHTML(value) : String(value == null ? '' : value));
    const money = value => (typeof formatBalance === 'function' ? formatBalance(value) : '€' + value + 'M');
    const clampNum = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

    function manager(id) {
        return (gameState.managers || []).find(m => String(m.id) === String(id)) || null;
    }

    function isGuest() {
        return typeof Net !== 'undefined' && Net.online && !Net.isHost;
    }

    function canControl(id) {
        return typeof Net === 'undefined' || typeof Net.canControl !== 'function' || Net.canControl(id);
    }

    // Spending is allowed once this club can no longer draft, so the reserve
    // that protects the starting XI is never eaten by an upgrade. The transfer
    // window passes force=true because every squad is already built there.
    function canInvest(m, force) {
        if (!m || !canControl(m.id)) return false;
        if (force) return true;
        if (m.formationLocked) return true;
        if ((m.squad || []).length >= MAX_SQUAD_SIZE) return true;
        if (typeof getManagerMaxBid === 'function' && getManagerMaxBid(m) < MIN_BID) return true;
        return false;
    }

    function posGroup(pos) {
        if (pos === 'GK') return 'gk';
        if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'def';
        if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'mid';
        return 'fwd';
    }

    function open(managerId, force) {
        const m = manager(managerId);
        if (!m) {
            showToast('Manager not found.');
            return;
        }
        if (!canInvest(m, force)) {
            showToast('Finish your draft first — lock your formation to spend leftover money.');
            return;
        }
        const sameManager = state && String(state.managerId) === String(m.id);
        state = { managerId: m.id, tab: sameManager ? state.tab : 'training', force: !!force };
        ensureModal();
        render();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => { if (modal) modal.classList.add('inv-open'); }, 12);
    }

    function close() {
        if (!modal) return;
        state = null;
        // Hidden content must not keep keyboard focus, or the browser blocks
        // aria-hidden on the dialog and assistive tech loses its place.
        if (modal.contains(document.activeElement)) document.activeElement.blur();
        modal.classList.remove('inv-open');
        modal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            if (!modal || state) return;
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 190);
    }

    function ensureModal() {
        if (modal) return;
        const style = document.createElement('style');
        style.id = 'investment-styles';
        style.textContent = `
            .inv-bg { position:fixed; inset:0; z-index:80; display:none; align-items:center; justify-content:center; padding:14px; background:rgba(2,6,23,.86); opacity:0; transition:opacity .18s ease; }
            .inv-bg.flex { display:flex; }
            .inv-bg.inv-open { opacity:1; }
            .inv-panel { width:100%; max-width:600px; max-height:calc(100vh - 28px); display:flex; flex-direction:column; overflow:hidden; background:linear-gradient(160deg,#101d33,#080e19); border:1px solid #334155; border-radius:18px; box-shadow:0 24px 70px rgba(0,0,0,.65); transform:translateY(10px) scale(.98); transition:transform .18s ease; }
            .inv-bg.inv-open .inv-panel { transform:none; }
            .inv-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 18px 13px; border-bottom:1px solid #1e293b; }
            .inv-head h3 { margin:0; font-size:18px; font-weight:900; color:#f8fafc; }
            .inv-head p { margin:4px 0 0; font-size:12px; color:#94a3b8; }
            .inv-head p b { color:#34d399; }
            .inv-x { width:32px; height:32px; flex-shrink:0; border-radius:9px; border:1px solid #334155; background:#111c30; color:#cbd5e1; font-size:20px; line-height:1; cursor:pointer; }
            .inv-x:hover { border-color:#34d399; }
            .inv-tabs { display:flex; gap:4px; padding:10px 16px 0; border-bottom:1px solid #1e293b; flex-wrap:wrap; }
            .inv-tab { border:0; border-bottom:2px solid transparent; background:transparent; color:#94a3b8; font-size:12px; font-weight:900; padding:9px 10px; cursor:pointer; }
            .inv-tab:hover { color:#e2e8f0; }
            .inv-tab.on { color:#a7f3d0; border-bottom-color:#34d399; }
            .inv-tab span { margin-left:4px; font-size:9px; color:#64748b; }
            .inv-body { padding:14px 16px 16px; overflow-y:auto; }
            .inv-help { margin:0 0 10px; font-size:11.5px; line-height:1.55; color:#94a3b8; }
            .inv-help b { color:#e2e8f0; }
            .inv-list { display:flex; flex-direction:column; gap:5px; }
            .inv-row { display:grid; grid-template-columns:36px minmax(0,1fr) auto auto; align-items:center; gap:9px; padding:7px 8px; border-radius:10px; border:1px solid #1e293b; background:#0b1220; }
            .inv-pos { width:34px; text-align:center; padding:3px 0; border-radius:7px; font-size:10px; font-weight:900; letter-spacing:.04em; background:#1e293b; color:#cbd5e1; }
            .inv-pos--gk { background:#2b2109; color:#fcd34d; }
            .inv-pos--def { background:#0f2438; color:#7dd3fc; }
            .inv-pos--mid { background:#0d2b23; color:#6ee7b7; }
            .inv-pos--fwd { background:#2b1220; color:#f9a8d4; }
            .inv-row__main { min-width:0; display:flex; flex-direction:column; gap:1px; }
            .inv-row__main b { font-size:12.5px; font-weight:800; color:#f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .inv-row__main small { font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .inv-pips { display:inline-flex; gap:3px; }
            .inv-pips i { width:8px; height:8px; border-radius:999px; background:#1e293b; border:1px solid #334155; }
            .inv-pips i.on { background:#34d399; border-color:#34d399; }
            .inv-btn { padding:7px 10px; border-radius:9px; border:1px solid #334155; background:#111c30; color:#e2e8f0; font-size:11px; font-weight:800; cursor:pointer; white-space:nowrap; }
            .inv-btn:hover:not(:disabled) { border-color:#34d399; }
            .inv-btn.go { background:#059669; border-color:#059669; color:#fff; }
            .inv-btn:disabled { opacity:.45; cursor:not-allowed; }
            .inv-done { font-size:10px; font-weight:900; color:#34d399; }
            .inv-card { border:1px solid #1e293b; background:#0b1220; border-radius:14px; padding:12px; margin-bottom:10px; }
            .inv-card h4 { margin:0 0 2px; font-size:13px; font-weight:900; color:#f8fafc; }
            .inv-card p { margin:4px 0 0; font-size:11.5px; color:#94a3b8; line-height:1.5; }
            .inv-card__top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
            .inv-card__top > div { min-width:0; }
            .inv-card__cost { color:#fcd34d; font-weight:900; white-space:nowrap; font-size:11px; }
            .inv-effects { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }
            .inv-effect { font-size:10px; font-weight:800; color:#a7f3d0; background:#052e22; border:1px solid #065f46; border-radius:999px; padding:3px 7px; }
            .inv-effect.off { color:#94a3b8; background:#0f172a; border-color:#334155; }
            .inv-effect.next { color:#fcd34d; background:#2b2109; border-color:#713f12; }
            .inv-report { margin-top:14px; border-top:1px solid #1e293b; padding-top:12px; }
            .inv-report__head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
            .inv-report__head h4 { margin:0; font-size:13px; font-weight:900; color:#f8fafc; }
            .inv-report__head span { font-size:10px; color:#64748b; font-weight:800; }
            .inv-fit { display:grid; grid-template-columns:36px minmax(0,1fr) auto; align-items:center; gap:9px; padding:7px 8px; border-radius:10px; border:1px solid #1e293b; background:#0b1220; }
            .inv-fit.warn { border-color:#78350f; background:#1c1206; }
            .inv-fit.ok { border-color:#3f3f1a; background:#141406; }
            .inv-fit.good { border-color:#14532d; background:#08251a; }
            .inv-fit__gain { font-size:12px; font-weight:900; color:#34d399; }
            .inv-fit.warn .inv-fit__gain { color:#fbbf24; }
            .inv-dossier { border:1px solid #1e293b; background:#0b1220; border-radius:12px; padding:10px 11px; margin-top:8px; }
            .inv-dossier__top { display:flex; justify-content:space-between; gap:8px; align-items:baseline; }
            .inv-dossier__top b { color:#f8fafc; font-size:13px; }
            .inv-dossier__top span { color:#64748b; font-size:10px; font-weight:800; white-space:nowrap; }
            .inv-dossier__plan { margin-top:5px; font-size:11.5px; color:#94a3b8; }
            .inv-dossier__plan strong { color:#fcd34d; }
            .inv-dossier__star { margin-top:3px; font-size:11px; color:#94a3b8; }
            .inv-dossier__star b { color:#e2e8f0; }
            .inv-foot { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 16px; border-top:1px solid #1e293b; background:#060b16; }
            .inv-foot span { font-size:10.5px; color:#64748b; }
            @media (max-width:560px) {
                .inv-body { padding:12px; }
                .inv-row { grid-template-columns:34px minmax(0,1fr) auto; }
                .inv-row .inv-pips { display:none; }
                .inv-card__top { flex-direction:column; }
                .inv-card__cost { align-self:flex-start; }
            }
        `;
        document.head.appendChild(style);

        modal = document.createElement('div');
        modal.id = 'investment-modal';
        modal.className = 'inv-bg hidden';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="inv-panel" role="dialog" aria-modal="true" aria-label="Club Investment">
                <header class="inv-head">
                    <div>
                        <h3>Club Investment</h3>
                        <p id="inv-sub"></p>
                    </div>
                    <button type="button" class="inv-x" data-act="close" aria-label="Close investment">×</button>
                </header>
                <nav class="inv-tabs" id="inv-tabs" role="tablist"></nav>
                <div class="inv-body" id="inv-body"></div>
                <footer class="inv-foot">
                    <span id="inv-foot-note">Training is permanent · Medical lasts the season · Stadium is permanent</span>
                    <button type="button" class="inv-btn" data-act="close">Done</button>
                </footer>
            </div>`;
        document.body.appendChild(modal);

        modal.addEventListener('click', e => {
            if (e.target === modal) return close();
            const btn = e.target.closest && e.target.closest('[data-act]');
            if (!btn || btn.disabled) return;
            const act = btn.getAttribute('data-act');
            const id = btn.getAttribute('data-id');
            if (act === 'close') return close();
            if (act === 'tab') {
                if (state) { state.tab = id; render(); }
                return;
            }
            if (act === 'train') return purchase('training', id);
            if (act === 'medical') return purchase('medical');
            if (act === 'stadium' || act === 'scouting') return purchase('stadium');
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) close();
        });
    }

    function render() {
        if (!state || !modal) return;
        const m = manager(state.managerId);
        if (!m) return close();
        const inv = investmentOf(m);

        document.getElementById('inv-sub').innerHTML = `${esc(m.name)} · <b>${money(m.balance)}</b> available`;
        // No upgrade counts here: the entry point should not advertise which
        // programmes (or how many players) have already been bought.
        document.getElementById('inv-tabs').innerHTML = TABS.map(([key, label]) =>
            `<button type="button" class="inv-tab ${state.tab === key ? 'on' : ''}" data-act="tab" data-id="${key}" role="tab" aria-selected="${state.tab === key}">${label}</button>`
        ).join('');

        const body = state.tab === 'medical'
            ? medicalHTML(m, inv)
            : state.tab === 'stadium' || state.tab === 'scouting'
                ? stadiumHTML(m, inv)
                : trainingHTML(m);

        document.getElementById('inv-body').innerHTML = body;
        document.getElementById('inv-foot-note').innerText = isGuest()
            ? 'Requests are confirmed by the host.'
            : 'Training is permanent · Medical lasts the season · Stadium is permanent';
    }

    function trainingHTML(m) {
        const trainable = (m.squad || []).slice()
            .filter(p => (Number(p.rating) || 0) <= INVESTMENT.TRAINING_MAX_RATING)
            .sort((a, b) => (b.rating || 0) - (a.rating || 0));

        const rows = trainable.map(p => {
            const level = Math.max(0, Math.min(INVESTMENT.TRAINING_MAX, Math.round(Number(p.trainingLevel) || 0)));
            const maxed = level >= INVESTMENT.TRAINING_MAX;
            const cost = maxed ? 0 : (typeof trainingCostFor === 'function'
                ? trainingCostFor(p, level)
                : INVESTMENT.TRAINING_COSTS[level]);
            const afford = !maxed && m.balance >= cost;
            const pips = Array.from({ length: INVESTMENT.TRAINING_MAX }, (_, index) =>
                `<i class="${index < level ? 'on' : ''}"></i>`).join('');
            const nextOvr = (Number(p.rating) || 70) + INVESTMENT.TRAINING_OVR_GAIN;
            const ratingLine = maxed
                ? `${p.mainPos} ${p.rating} · Level ${level}/${INVESTMENT.TRAINING_MAX}`
                : `${p.mainPos} ${p.rating} → ${nextOvr} · Level ${level}/${INVESTMENT.TRAINING_MAX}`;
            const action = maxed
                ? '<span class="inv-done">Maxed</span>'
                : `<button type="button" class="inv-btn ${afford ? 'go' : ''}" data-act="train" data-id="${p.id}" ${afford ? '' : 'disabled'}>${afford ? `Train · ${money(cost)}` : `Need ${money(cost)}`}</button>`;
            return `<div class="inv-row">
                <span class="inv-pos inv-pos--${posGroup(p.mainPos)}">${esc(p.mainPos)}</span>
                <span class="inv-row__main">
                    <b>${esc(p.name)}</b>
                    <small>${esc(ratingLine)}</small>
                </span>
                <span class="inv-pips" title="Training level ${level}/${INVESTMENT.TRAINING_MAX}">${pips}</span>
                ${action}
            </div>`;
        }).join('');

        const hidden = (m.squad || []).filter(p => (Number(p.rating) || 0) > INVESTMENT.TRAINING_MAX_RATING).length;
        const empty = !trainable.length
            ? `<p class="inv-help">No players rated ${INVESTMENT.TRAINING_MAX_RATING} or below are available to train.</p>`
            : '';
        const note = hidden
            ? `<p class="inv-help" style="opacity:.75">${hidden} player${hidden === 1 ? '' : 's'} above ${INVESTMENT.TRAINING_MAX_RATING} OVR hidden — they cannot train.</p>`
            : '';

        return `<p class="inv-help"><b>Training camp</b> — a permanent +${INVESTMENT.TRAINING_OVR_GAIN} OVR and +${INVESTMENT.TRAINING_STAT_GAIN} to every stat. Only players rated ${INVESTMENT.TRAINING_MAX_RATING} or below appear here. Lower-rated players cost less per level. Each player can take ${INVESTMENT.TRAINING_MAX} levels, and every level costs more than the last.</p>
            ${note}${empty}${rows}`;
    }

    function medicalHTML(m, inv) {
        const tier = inv.medical;
        const max = TRACK_MAX.medical;
        const nextCost = tier < max ? INVESTMENT.MEDICAL_COSTS[tier] : null;
        const afford = nextCost != null && m.balance >= nextCost;
        const injury = Math.round((INVESTMENT.MEDICAL_INJURY_REDUCTION[tier - 1] || 0) * 100);
        const stamina = Math.round((INVESTMENT.MEDICAL_STAMINA_REDUCTION[tier - 1] || 0) * 100);
        const conditioning = INVESTMENT.MEDICAL_CONDITIONING[tier] || 0;
        const nextInjury = Math.round((INVESTMENT.MEDICAL_INJURY_REDUCTION[tier] || 0) * 100);
        const nextStamina = Math.round((INVESTMENT.MEDICAL_STAMINA_REDUCTION[tier] || 0) * 100);
        const nextConditioning = INVESTMENT.MEDICAL_CONDITIONING[tier + 1] || 0;
        const pips = Array.from({ length: max }, (_, index) => `<i class="${index < tier ? 'on' : ''}"></i>`).join('');

        const effects = tier === 0
            ? '<span class="inv-effect off">No programme</span>'
            : `<span class="inv-effect">−${injury}% injury risk</span>
               <span class="inv-effect">−${stamina}% late-game fatigue</span>
               <span class="inv-effect">+${conditioning} team strength</span>`;
        const nextEffects = nextCost == null ? '' : `
            <div class="inv-effects">
                <span class="inv-effect next">Next: −${nextInjury}% injury</span>
                <span class="inv-effect next">−${nextStamina}% fatigue</span>
                <span class="inv-effect next">+${nextConditioning} team strength</span>
            </div>`;
        const action = nextCost == null
            ? '<span class="inv-done">Top level active</span>'
            : `<button type="button" class="inv-btn ${afford ? 'go' : ''}" data-act="medical" ${afford ? '' : 'disabled'}>${afford ? `Upgrade · ${money(nextCost)}` : `Need ${money(nextCost)}`}</button>`;

        return `<div class="inv-card">
                <div class="inv-card__top">
                    <div>
                        <h4>Medical &amp; Fitness Programme · Level ${tier}/${max}</h4>
                        <p>Keeps fragile players on the pitch and fresh legs in the last twenty minutes. The conditioning edge applies to the league simulator and live matches.</p>
                    </div>
                    <span class="inv-card__cost">${nextCost != null ? money(nextCost) : 'Top level'}</span>
                </div>
                <div class="inv-pips" style="margin-top:9px">${pips}</div>
                <div class="inv-effects">${effects}</div>
                ${nextEffects}
                <div style="margin-top:11px">${action}</div>
            </div>
            <p class="inv-help">Medical is bought once per club and lasts for the rest of the season. It does not stack with another club's programme.</p>`;
    }

    function stadiumHTML(m, inv) {
        const tier = Math.max(0, Math.round(Number(inv.stadium) || Number(inv.scouting) || 0));
        const max = TRACK_MAX.stadium;
        const costs = INVESTMENT.STADIUM_COSTS || INVESTMENT.SCOUTING_COSTS;
        const nextCost = tier >= max ? 0 : costs[tier];
        const afford = tier < max && m.balance >= nextCost;
        const action = tier >= max
            ? '<span class="inv-done">Top level</span>'
            : `<button type="button" class="inv-btn ${afford ? 'go' : ''}" data-act="stadium" ${afford ? '' : 'disabled'}>${afford ? `Upgrade · ${money(nextCost)}` : `Need ${money(nextCost)}`}</button>`;

        const ticketMult = (INVESTMENT.STADIUM_TICKET_MULT && INVESTMENT.STADIUM_TICKET_MULT[tier]) || 1;
        const fanMult = (INVESTMENT.STADIUM_FAN_GAIN_MULT && INVESTMENT.STADIUM_FAN_GAIN_MULT[tier]) || 1;
        const ticketPct = Math.round((ticketMult - 1) * 100);
        const fanPct = Math.round((fanMult - 1) * 100);
        const levelName = tier === 0 ? 'Municipal ground' : tier === 1 ? 'Modern stands' : 'Cathedral of football';
        const pips = Array.from({ length: max }, (_, index) =>
            `<i class="${index < tier ? 'on' : ''}"></i>`).join('');

        const fans = typeof fansOf === 'function' ? fansOf(m) : (m.fans || 0);
        const baseGate = typeof ticketRevenueFor === 'function' ? ticketRevenueFor(fans) : 0;
        const nextGate = Math.round(baseGate * ticketMult * 10) / 10;
        const fansLabel = typeof formatFanCount === 'function' ? formatFanCount(fans) : String(fans);

        const nextTicketMult = tier < max ? (INVESTMENT.STADIUM_TICKET_MULT[tier + 1] || ticketMult) : ticketMult;
        const nextFanMult = tier < max ? (INVESTMENT.STADIUM_FAN_GAIN_MULT[tier + 1] || fanMult) : fanMult;

        return `
            <div class="inv-track">
                <div class="inv-track__top">
                    <div>
                        <h3>Stadium · Level ${tier}/${max}</h3>
                        <p class="inv-help" style="margin:4px 0 0">${esc(levelName)}. Better facilities raise gate receipts every match and accelerate fan growth after wins.</p>
                    </div>
                    <div style="text-align:right">
                        <div class="inv-pips" title="Stadium level ${tier}/${max}">${pips}</div>
                        <div style="margin-top:8px">${action}</div>
                    </div>
                </div>
                <div class="inv-report" style="margin-top:12px">
                    <div class="inv-report__head"><h4>Current effect</h4><span>${tier >= max ? 'Top level' : 'Active'}</span></div>
                    <div class="inv-row" style="grid-template-columns:1fr auto">
                        <span class="inv-row__main"><b>Ticket revenue</b><small>Current fanbase ${esc(fansLabel)} · base gate €${baseGate}M</small></span>
                        <span class="inv-done" style="color:#34d399">+${ticketPct}% · €${nextGate}M / match</span>
                    </div>
                    <div class="inv-row" style="grid-template-columns:1fr auto">
                        <span class="inv-row__main"><b>Fan growth</b><small>Applied on wins and positive results only</small></span>
                        <span class="inv-done" style="color:#34d399">+${fanPct}% rate</span>
                    </div>
                    ${tier < max ? `
                    <div class="inv-row" style="grid-template-columns:1fr auto;opacity:.85">
                        <span class="inv-row__main"><b>Next upgrade</b><small>Tickets +${Math.round((nextTicketMult - 1) * 100)}% · Fan growth +${Math.round((nextFanMult - 1) * 100)}%</small></span>
                        <span class="inv-done">${money(nextCost)}</span>
                    </div>` : ''}
                </div>
            </div>`;
    }

    function scoutingHTML(m, inv) {
        // Legacy alias — stadium replaced scouting.
        return stadiumHTML(m, inv);
    }

    function purchase(kind, playerId) {
        if (!state) return;
        const m = manager(state.managerId);
        if (!m) return;
        if (!canInvest(m, state.force)) {
            showToast('Finish your draft first — lock your formation to spend leftover money.');
            return;
        }

        if (isGuest()) {
            Net.send('invest', {
                managerId: Number(Net.myManagerId),
                action: kind,
                playerId: playerId == null ? null : playerId
            });
            showToast('Investment request sent to the host.');
            return;
        }

        const result = apply(m, kind, playerId);
        if (!result.ok) {
            showToast(result.error);
            return;
        }
        afterChange(m, result.message);
    }

    function apply(m, kind, playerId) {
        if (kind === 'training') {
            const player = (m.squad || []).find(p => String(p.id) === String(playerId));
            if (!player) return { ok: false, error: 'That player is no longer in your squad.' };
            if ((Number(player.rating) || 0) > INVESTMENT.TRAINING_MAX_RATING) {
                return { ok: false, error: `Only players rated ${INVESTMENT.TRAINING_MAX_RATING} or below can train.` };
            }
            const level = Math.max(0, Math.min(INVESTMENT.TRAINING_MAX, Math.round(Number(player.trainingLevel) || 0)));
            if (level >= INVESTMENT.TRAINING_MAX) return { ok: false, error: 'That player has already maxed out training.' };
            const cost = typeof trainingCostFor === 'function'
                ? trainingCostFor(player, level)
                : INVESTMENT.TRAINING_COSTS[level];
            if ((Number(m.balance) || 0) < cost) return { ok: false, error: `Not enough money — ${money(cost)} needed.` };

            m.balance -= cost;
            player.trainingLevel = level + 1;
            player.stats = player.stats || {};
            STAT_KEYS.forEach(key => {
                const current = typeof player.stats[key] === 'number' ? player.stats[key] : (Number(player.rating) || 70);
                player.stats[key] = clampNum(current + INVESTMENT.TRAINING_STAT_GAIN, 40, 110);
            });
            player.rating = clampNum((Number(player.rating) || 70) + INVESTMENT.TRAINING_OVR_GAIN, 1, 120);

            const rankInfo = typeof getRankInfo === 'function'
                ? getRankInfo(player.rating)
                : { display: String(Math.min(100, player.rating)), rank: null, color: '', badge: '' };
            player.displayOVR = rankInfo.display;
            player.rank = rankInfo.rank;
            player.rankColor = rankInfo.color;
            player.rankBadge = rankInfo.badge;

            return { ok: true, message: `${player.name} trained to level ${player.trainingLevel}: +${INVESTMENT.TRAINING_OVR_GAIN} OVR.` };
        }

        if (kind === 'medical') {
            const inv = investmentOf(m);
            if (inv.medical >= TRACK_MAX.medical) return { ok: false, error: 'The medical programme is already at its top level.' };
            const cost = INVESTMENT.MEDICAL_COSTS[inv.medical];
            if ((Number(m.balance) || 0) < cost) return { ok: false, error: `Not enough money — ${money(cost)} needed.` };
            m.balance -= cost;
            inv.medical += 1;
            return { ok: true, message: `Medical programme upgraded to level ${inv.medical}.` };
        }

        if (kind === 'stadium' || kind === 'scouting') {
            const inv = investmentOf(m);
            const max = TRACK_MAX.stadium;
            const tier = Math.max(0, Math.round(Number(inv.stadium) || Number(inv.scouting) || 0));
            if (tier >= max) return { ok: false, error: 'The stadium is already at its top level.' };
            const costs = INVESTMENT.STADIUM_COSTS || INVESTMENT.SCOUTING_COSTS;
            const cost = costs[tier];
            if ((Number(m.balance) || 0) < cost) return { ok: false, error: `Not enough money — ${money(cost)} needed.` };
            m.balance -= cost;
            inv.stadium = tier + 1;
            inv.scouting = inv.stadium;
            const label = inv.stadium === 1 ? 'Modern stands' : 'Cathedral of football';
            return { ok: true, message: `Stadium upgraded to level ${inv.stadium}: ${label}. Gate receipts and fan growth improved.` };
        }

        return { ok: false, error: 'Unknown investment.' };
    }

    function afterChange(m, message) {
        // Rebuild the pitch tokens, squad list and OVR so a trained player reads
        // his new rating everywhere. Only the device that owns this club may run
        // refreshLineup: it republishes the XI, and the host must not overwrite a
        // guest's own formation from its local copy.
        const local = typeof Net === 'undefined' || !Net.online || Net.canControl(m.id);
        if (typeof refreshLineup === 'function' && document.getElementById(`pitch-${m.id}`)) {
            if (local) {
                refreshLineup(m.id);
            } else {
                if (typeof renderPitchNodes === 'function') renderPitchNodes(m.id);
                if (typeof renderBenchNodes === 'function') renderBenchNodes(m.id);
                if (typeof updateTeamOVR === 'function') updateTeamOVR(m.id);
                if (typeof updateDashboard === 'function') updateDashboard(m.id);
            }
        } else {
            if (typeof updateDashboard === 'function') updateDashboard(m.id);
            if (typeof updateTeamOVR === 'function') updateTeamOVR(m.id);
        }
        if (typeof updateInvestmentEntry === 'function') updateInvestmentEntry(m.id);
        if (typeof Net !== 'undefined' && Net.online && Net.isHost && typeof Net.publishManagers === 'function') {
            Net.publishManagers(m.id);
        }
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
        showToast(message);
        render();
    }

    function hostAction(managerId, action, payload) {
        const m = manager(managerId);
        if (!m) return;
        const result = apply(m, action, payload && payload.playerId);
        if (!result.ok) {
            showToast(result.error);
            return;
        }
        afterChange(m, result.message);
    }

    function onManagersUpdated() {
        if (state && modal && !modal.classList.contains('hidden')) render();
    }

    return {
        open,
        close,
        hostAction,
        onManagersUpdated,
        refresh() { if (state) render(); },
        isOpen() { return !!state && !!modal && !modal.classList.contains('hidden'); }
    };
})();

function openInvestment(managerId, force) {
    Investment.open(managerId, force);
}

function closeInvestment() {
    Investment.close();
}

// The dashboard entry is deliberately static: it must not advertise which
// programmes or training levels were already bought. Only visibility changes.
function updateInvestmentEntry(id) {
    const m = (gameState.managers || []).find(x => String(x.id) === String(id));
    const btn = document.getElementById(`m${id}-invest-btn`);
    if (!m || !btn) return;
    const canControl = typeof Net === 'undefined' || typeof Net.canControl !== 'function' || Net.canControl(m.id);
    btn.classList.toggle('hidden', !canControl);
    if (!canControl) return;

    const summary = document.getElementById(`m${id}-invest-summary`);
    if (summary) summary.innerText = 'Training · Medical · Stadium';
}
