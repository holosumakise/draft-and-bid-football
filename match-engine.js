
// --- Live match speed ---
// 1x = normal, 2x = half the delay, instant = resolve each minute immediately.
let matchSpeed = 1;

function matchDelay(ms) {
    if (matchSpeed === 'instant') return 0;
    if (matchSpeed === 2) return Math.max(0, Math.round(ms / 2));
    return ms;
}

function setMatchSpeed(speed) {
    matchSpeed = speed === 'instant' ? 'instant' : (Number(speed) === 2 ? 2 : 1);

    const activeId = matchSpeed === 'instant' ? 'speed-btn-instant' : `speed-btn-${matchSpeed}`;
    ['speed-btn-1', 'speed-btn-2', 'speed-btn-instant'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const active = id === activeId;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // If a period is already running, reschedule its pending tick so the change is felt now.
    const sim = gameState && gameState.matchSim;
    if (sim && !sim.finished && typeof sim.scheduleTick === 'function') {
        sim.scheduleTick(matchSpeed === 'instant' ? 0 : matchDelay(250));
    }
}

function getDynamicOVR(player, targetPos) {
    if (!player) return 0;
    if (targetPos === 'SUB') return player.rating;
    if (player.mainPos === targetPos) return player.rating;
    const subPositions = Array.isArray(player.subPos) ? player.subPos : [];
    if (subPositions.includes(targetPos)) return player.rating;
    if (targetPos === 'GK') return Math.max(1, Math.round(player.rating * 0.3));
    if (player.mainPos === 'GK') return Math.max(1, Math.round(player.rating * 0.15));
    const loss = positionPenaltyPct(player.mainPos, targetPos, player);
    return Math.max(1, Math.round(player.rating * (1 - loss)));
}


// A Tactical Wildcard is the one style that genuinely earns its keep in an
// unfamiliar slot, because the role is defined by reading the shape, not the
// patch of grass. Everyone else pays the full out-of-position price.
function positionPenaltyPct(from, to, player) {
    if (from === to) return 0;
    const wildcard = player && player.archetype === 'Wildcard';
    const scale = pct => wildcard ? Math.min(pct, 0.06) : pct;
    const override = OUT_OF_POS_OVERRIDES[`${from}>${to}`];
    if (override != null) return scale(override);
    const a = POSITION_META[from], b = POSITION_META[to];
    if (!a || !b) return scale(0.3);
    const unitGap = Math.abs(a.unit - b.unit);
    if (unitGap >= 2) {
        if (a.channel !== 'C' && b.channel !== 'C') {
            return scale(a.channel === b.channel ? 0.13 : 0.18);
        }
        return scale(0.25);
    }
    let pct = unitGap * 0.06 + Math.abs(a.depth - b.depth) * 0.04;
    if (a.channel !== b.channel) pct += (a.channel === 'C' || b.channel === 'C') ? 0.03 : 0.04;
    if (unitGap === 0) pct = Math.max(0.03, pct);
    return scale(Math.min(0.25, pct));
}

function calcPosition(x, y, isGK) {
    if (isGK) return "GK";
    if (y <= 33) { if (x <= 33) return "LW"; if (x >= 67) return "RW"; if (y >= 22) return "CF"; return "ST"; }
    if (y <= 66) { if (x <= 18) return y > 45 ? "LWB" : "LM"; if (x >= 82) return y > 45 ? "RWB" : "RM"; if (x <= 35) return "LM"; if (x >= 65) return "RM"; if (y <= 46) return "CAM"; if (y >= 56) return "CDM"; return "CM"; }
    if (x <= 25) return "LB"; if (x >= 75) return "RB"; return "CB";
}

// --- Match Logic & Tournament ---
function sumFormationOVR(m) {
    let total = 0, count = 0;
    const chemistry = getFormationChemistry(m);
    m.formation.forEach(n => {
        if (!n.assignedPlayerId) return;
        const p = m.squad.find(x => x.id === n.assignedPlayerId);
        if (!p) return;
        total += getDynamicOVR(p, n.pos) + (chemistry.bonuses.get(p.id) || 0);
        count++;
    });
    return { total, count };
}

function pickRand(arr) {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
}

function createTeamState(m) {
    const rawLineup = m.formation
        .filter(node => node.assignedPlayerId)
        .map(node => ({ player: m.squad.find(player => player.id === node.assignedPlayerId), pos: node.pos, yel: 0 }))
        .filter(slot => slot.player);
    const rawBench = m.bench
        .filter(slot => slot.assignedPlayerId)
        .map(slot => m.squad.find(player => player.id === slot.assignedPlayerId))
        .filter(Boolean);
    const assignedIds = new Set([...rawLineup, ...rawBench].map(slot => slot.player ? slot.player.id : slot.id));
    const rawReserves = m.squad.filter(player => !assignedIds.has(player.id));
    // Suspended/injured starters are replaced from the bench and reserves for
    // this match only. The manager's saved XI is untouched.
    const available = typeof fillAvailableTeamSlots === 'function'
        ? fillAvailableTeamSlots(rawLineup, rawBench, rawReserves)
        : { lineup: rawLineup, bench: rawBench, reserves: rawReserves };
    return {
        id: m.id, name: m.name,
        lineup: available.lineup, bench: available.bench, reserves: available.reserves, subs: 0,
        tactics: normalizeTactics(m.tactics),
        medicalTier: medicalTierOf(m)
    };
}

// Split strength into attack / midfield / defence (engine-core.js) so a
// lopsided XI is not treated as identical to a balanced one with the same OVR.
// Missing starters lose ground on every line, not just the average.
// `oppTactics` lets each player's archetype pay off (or cost) against the
// specific match plan they are facing. A habit then rides on top of the job:
// it decides how the same player behaves inside that plan, and an armband
// settles the two lines that have to keep their shape.
function getStrengthBreakdown(team, oppTactics) {
    const valid = (team && team.lineup ? team.lineup : []).filter(slot => slot && slot.player);
    if (!valid.length) return { overall: 0, att: 0, mid: 0, def: 0, count: 0 };

    const chemistry = team.isGhost === true ? new Map() : getLineupChemistry(valid);
    const entries = valid.map(slot => ({
        pos: slot.pos,
        ovr: getDynamicOVR(slot.player, slot.pos) + (chemistry.get(slot.player.id) || 0)
            + archetypeFitDelta(slot.player, team.tactics, oppTactics)
            + playstyleFitDelta(slot.player, team.tactics, oppTactics)
    }));
    const breakdown = EngineCore.strengthBreakdown(entries);
    const missingPlayersPenalty = Math.max(0, STARTERS - valid.length) * 3.5;
    if (!missingPlayersPenalty) return applyLeadership(applyConditioning(breakdown, team), team);

    return applyLeadership(applyConditioning({
        overall: breakdown.overall - missingPlayersPenalty,
        att: breakdown.att - missingPlayersPenalty,
        mid: breakdown.mid - missingPlayersPenalty,
        def: breakdown.def - missingPlayersPenalty,
        count: breakdown.count
    }, team), team);
}

// A fitter squad closes games a little better: the medical programme is not a
// star signing, just a small edge on every line.
function applyConditioning(breakdown, team) {
    const fit = medicalConditioningBoost(team);
    if (!fit) return breakdown;
    return {
        ...breakdown,
        overall: breakdown.overall + fit,
        att: breakdown.att + fit,
        mid: breakdown.mid + fit,
        def: breakdown.def + fit
    };
}

// Leadership is a calm-at-the-back bonus, not a goal machine: the armband holds
// the defensive line and the screen in front of it, and never lifts the attack.
function applyLeadership(breakdown, team) {
    const lead = leadershipRating(team);
    if (!lead) return breakdown;
    return {
        ...breakdown,
        def: breakdown.def + lead,
        mid: breakdown.mid + lead * 0.5
    };
}

function getStrength(team) {
    return getStrengthBreakdown(team).overall;
}


function weightedPick(entries) {
    const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
    if (total <= 0) return entries.length ? entries[Math.floor(Math.random() * entries.length)].item : null;
    let r = Math.random() * total;
    for (const e of entries) {
        r -= Math.max(0, e.weight);
        if (r <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
}

// Position role weights for goal / assist distribution (lineup slot, not mainPos)

function getGoal(t, kind = 'open') {
    const scorerEntries = t.lineup
        .filter(l => l.player && l.pos !== 'GK' && l.player.mainPos !== 'GK')
        .map(l => {
            const p = l.player, st = p.stats || {};
            const sho = st.SHO ?? p.rating ?? 70;
            const pac = st.PAC ?? 70;
            const dri = st.DRI ?? 70;
            const pos = l.pos || p.mainPos;
            const openRole = SCORER_ROLE[pos] ?? 0.6;
            const role = kind === 'setpiece' ? (SET_PIECE_SCORER_ROLE[pos] ?? openRole) : openRole;
            const finish = Math.pow(Math.max(40, sho) / 100, 1.55);
            const mobility = 0.14 * (pac / 100) + 0.12 * (dri / 100);
            const starBias = Math.pow(Math.max(55, p.rating ?? 70) / 100, 1.1);
            // The role decides which kind of chance a player is asked to take: a
            // poacher wants the open-play ball in the box, a target man the corner.
            // The habit then decides how he takes it — from range, on the break, on
            // the head, or as the fresh body thrown on late.
            const style = archetypeWeights(p);
            const habit = playstyleWeights(p);
            const styleFactor = kind === 'setpiece' ? style.setPiece * habit.setPiece
                : kind === 'counter' ? style.counter * habit.counter
                : style.score * habit.score;
            let weight = role * (finish * 0.72 + mobility * 0.28) * starBias * 100 * styleFactor;
            // Counter goals run through the quickest players.
            if (kind === 'counter') weight *= 0.72 + (pac / 100) * 0.75;
            if (l.cameOn) weight *= habit.sub;
            return { item: p, weight };
        });

    const scorer = weightedPick(scorerEntries) || { name: 'Own Goal', team: 'Unknown', id: -1, stats: {} };
    const outfield = t.lineup.filter(slot =>
        slot.player && slot.player.id !== scorer.id && slot.pos !== 'GK' && slot.player.mainPos !== 'GK'
    );
    const avgPassing = outfield.length
        ? outfield.reduce((sum, slot) => sum + (slot.player.stats?.PAS ?? slot.player.rating ?? 70), 0) / outfield.length
        : 70;
    // Stronger teams complete more assisted goals; still leave room for solo efforts.
    // Set pieces are almost always delivered by a specialist.
    const assistChance = kind === 'setpiece'
        ? 0.82
        : clamp(0.58 + ((avgPassing - 72) / 100) * 0.5, 0.48, 0.88);

    let assister = null;
    if (outfield.length && Math.random() < assistChance) {
        const assistEntries = outfield.map(slot => {
            const player = slot.player;
            const stats = player.stats || {};
            const passing = stats.PAS ?? player.rating ?? 70;
            const dribbling = stats.DRI ?? 70;
            const position = slot.pos || player.mainPos;
            const openRole = ASSIST_ROLE[position] ?? 0.7;
            const role = kind === 'setpiece' ? (SET_PIECE_ASSIST_ROLE[position] ?? openRole) : openRole;
            const vision = Math.pow(Math.max(40, passing) / 100, 1.45);
            const carry = 0.16 * (dribbling / 100);
            const starBias = Math.pow(Math.max(55, player.rating ?? 70) / 100, 1.08);
            // A dead ball is delivered by the man who can put it on a sixpence.
            const habit = playstyleWeights(player);
            const habitFactor = kind === 'setpiece' ? habit.assist * habit.delivery : habit.assist;
            return { item: player, weight: role * (vision + carry) * starBias * 100 * archetypeWeights(player).assist * habitFactor };
        });
        const selectedAssister = weightedPick(assistEntries);
        if (selectedAssister) assister = selectedAssister;
    }
    return {
        scorer: scorer.name,
        scorerId: scorer.id,
        assister: assister?.name || null,
        assisterId: assister?.id ?? null,
        kind
    };
}

// --- Match-day tactics, ratings and substitutions ---

let matchTactics = normalizeTactics(DEFAULT_TACTICS);

function getTacticsMultipliers() {
    return getTacticsProfileFor(matchTactics);
}

function pctLabel(value) {
    const pct = Math.round((value - 1) * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
}

function tacticsOptionButton(kind, key, opt, active, extraClass = '') {
    const selected = active
        ? 'border-green-400 bg-green-500/15 text-green-300'
        : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400';
    return `<button type="button" aria-pressed="${active ? 'true' : 'false'}" onclick="setTacticsOption('${kind}', '${key}')" class="text-left px-3 py-2 rounded-lg border transition ${selected} ${extraClass}">
        <div class="text-xs font-bold leading-tight">${opt.label}</div>
        <div class="text-[10px] leading-tight mt-0.5 ${active ? 'text-green-200/80' : 'text-slate-500'}">${opt.short}</div>
    </button>`;
}

function renderTacticsOptions() {
    const possKeys = Object.keys(TACTICS_POSSESSION);
    document.getElementById('attack-options').innerHTML = possKeys.map((key, index) => {
        const opt = TACTICS_POSSESSION[key];
        const span = possKeys.length % 2 === 1 && index === possKeys.length - 1 ? 'col-span-2' : '';
        return tacticsOptionButton('possession', key, opt, matchTactics.possession === key, span);
    }).join('');
    document.getElementById('block-options').innerHTML = Object.entries(TACTICS_DEFENSE).map(([key, opt]) =>
        tacticsOptionButton('defense', key, opt, matchTactics.defense === key)
    ).join('');
    document.getElementById('marking-options').innerHTML = Object.entries(TACTICS_TRANSITION).map(([key, opt]) =>
        tacticsOptionButton('transition', key, opt, matchTactics.transition === key)
    ).join('');
    updateTacticsSummary();
}

function setTacticsOption(kind, key) {
    if (kind === 'possession' && TACTICS_POSSESSION[key]) matchTactics.possession = key;
    else if (kind === 'defense' && TACTICS_DEFENSE[key]) matchTactics.defense = key;
    else if (kind === 'transition' && TACTICS_TRANSITION[key]) matchTactics.transition = key;
    renderTacticsOptions();
}

function updateTacticsSummary() {
    const plan = normalizeTactics(matchTactics);
    const profile = getTacticsProfileFor(plan);
    const planLabel = `${TACTICS_POSSESSION[plan.possession].label} · ${TACTICS_DEFENSE[plan.defense].label} · ${TACTICS_TRANSITION[plan.transition].label}`;
    const row = (label, value, good) => {
        const tone = Math.abs(value - 1) < 0.005 ? 'text-slate-300' : good ? 'text-green-400' : 'text-red-400';
        return `<div class="flex justify-between gap-3"><span>${label}</span><span class="font-bold ${tone}">${pctLabel(value)}</span></div>`;
    };
    const tips = [];
    if (plan.defense === 'high' || plan.defense === 'man') tips.push('High engagement fades after 70′.');
    if (plan.defense === 'low') tips.push('Low block gets harder to break late.');
    if (plan.possession === 'positional' || plan.possession === 'central') tips.push('Possession play is exposed if transition is soft.');
    if (plan.possession === 'direct') tips.push('Route One punishes high presses.');
    if (plan.transition === 'gegenpress') tips.push('Gegenpressing costs stamina and cards.');
    if (plan.transition === 'tacticalFoul') tips.push('Tactical fouling racks up cards and set pieces.');
    if (plan.transition === 'counter' || plan.transition === 'restAttack') tips.push('Counter setups punish expansive opponents.');
    document.getElementById('tactics-summary').innerHTML = `
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${planLabel}</div>
        ${row('Chance creation', profile.attack, profile.attack >= 1)}
        ${row('Conceding risk', profile.concede, profile.concede <= 1)}
        ${row('Control', 1 + profile.control, profile.control >= 0)}
        ${row('Counter exposure', profile.transition, profile.transition <= 1)}
        ${row('Card risk', profile.card, profile.card <= 1)}
        ${row('Stamina cost', profile.stamina, profile.stamina <= 1)}
        ${tips.length ? `<div class="text-[10px] text-amber-400 pt-1 leading-snug">${tips.slice(0, 2).join(' ')}</div>` : ''}`;
}

function confirmTactics() {
    const modal = document.getElementById('tactics-modal'), panel = document.getElementById('tactics-panel');
    modal.classList.add('opacity-0'); panel.classList.add('scale-95');
    setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 200);

    if (pendingTacticsManagerId !== null) {
        const mId = pendingTacticsManagerId;
        pendingTacticsManagerId = null;
        const m = gameState.managers.find(x => x.id === mId);
        m.tactics = normalizeTactics(matchTactics);

        m.formationLocked = true;
        renderPitchNodes(mId); renderBenchNodes(mId);
        const btn = document.getElementById(`lock-btn-${mId}`);
        btn.innerText = "Formation & Tactics Confirmed"; 
        btn.classList.replace('bg-slate-700', 'bg-green-600'); btn.disabled = true;
        const autoBtn = document.getElementById(`autofill-btn-${mId}`);
        if (autoBtn) { autoBtn.disabled = true; autoBtn.classList.add('opacity-40', 'cursor-not-allowed'); }
        showToast(`${m.name} locked formation & tactics!`);
        updateRollButton(); renderDraftBoard(); checkMatchReady();
        Net.publishOwn(mId);
        Net.publishInfo();
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    }
}

function createMatchRatings(sim) {
    const map = {};
    [sim.t1, sim.t2].forEach((team, index) => {
        (team.lineup || []).forEach(slot => {
            if (!slot || !slot.player) return;
            const actions = drawRatingActions(slot.pos, slot.player);
            map[slot.player.id] = { player: slot.player, team: index + 1, pos: slot.pos, goals: 0, assists: 0, yellow: 0, red: 0, played: true, perf: rollPerformance(slot.player), defActions: actions.defActions, keyPasses: actions.keyPasses };
        });
    });
    return map;
}

function ensureRatingEntry(sim, player, teamNo, pos) {
    if (!sim.ratings[player.id]) {
        const slotPos = pos || player.mainPos;
        const actions = drawRatingActions(slotPos, player);
        sim.ratings[player.id] = { player, team: teamNo, pos: slotPos, goals: 0, assists: 0, yellow: 0, red: 0, played: true, perf: rollPerformance(player), defActions: actions.defActions, keyPasses: actions.keyPasses };
    }
    return sim.ratings[player.id];
}

function applyViewEvent(sim, e) {
    if (e.type === 'goal') {
        if (e.t === 1) sim.view.s1++; else sim.view.s2++;
        if (e.scorerId != null && sim.ratings[e.scorerId]) sim.ratings[e.scorerId].goals++;
        if (e.assisterId != null && sim.ratings[e.assisterId]) sim.ratings[e.assisterId].assists++;
        document.getElementById('match-score-1').innerText = sim.view.s1;
        document.getElementById('match-score-2').innerText = sim.view.s2;
    } else if (e.type === 'yellow') {
        if (sim.ratings[e.id]) sim.ratings[e.id].yellow++;
    } else if (e.type === 'red') {
        if (sim.ratings[e.id]) { sim.ratings[e.id].yellow = 0; sim.ratings[e.id].red = true; }
    }
}

function liveRatingFor(sim, entry) {
    const own = entry.team === 1 ? sim.s1 : sim.s2;
    const opp = entry.team === 1 ? sim.s2 : sim.s1;
    const conceded = sim.finished ? opp : (entry.team === 1 ? sim.view.s2 : sim.view.s1);
    const slotPos = entry.pos || entry.player.mainPos;
    const role = ratingRole(slotPos);
    const isGK = role === 'GK';
    const isDEF = role === 'DEF';
    let teamResult = null;
    if (sim.finished) {
        if (own > opp) teamResult = 'W';
        else if (own < opp) teamResult = 'L';
    }
    return sofaScoreMatchRating({
        goals: entry.goals, assists: entry.assists, isGK, isDEF,
        cleanSheet: sim.finished && conceded === 0,
        goalsConceded: conceded,
        yellow: entry.yellow, red: entry.red, teamResult,
        goalDiff: own - opp,
        perf: entry.perf || 0,
        saves: isGK && sim.gkSaves ? (sim.gkSaves[entry.team] || 0) : 0,
        defActions: entry.defActions || 0,
        keyPasses: entry.keyPasses || 0
    });
}

function renderMatchRatings(sim) {
    const body = document.getElementById('ratings-body');
    if (!body) return;
    // A guest has no simulation metrics, only the host's finished numbers.
    if (Array.isArray(sim.remoteRatings)) {
        body.innerHTML = renderRemoteRatings(sim.remoteRatings, sim);
        return;
    }
    const groups = [1, 2].map(teamNo => {
        const team = teamNo === 1 ? sim.t1 : sim.t2;
        const rows = Object.values(sim.ratings)
            .filter(entry => entry.team === teamNo && entry.played)
            .sort((a, b) => liveRatingFor(sim, b) - liveRatingFor(sim, a));
        const html = rows.map(entry => {
            const rating = liveRatingFor(sim, entry);
            const cls = rating >= 8 ? 'bg-emerald-500 text-slate-900' : rating >= 7 ? 'bg-blue-500 text-white' : rating >= 6 ? 'bg-slate-600 text-white' : 'bg-red-500 text-white';
            const marks = [];
            if (entry.goals) marks.push(`<span class="text-emerald-400 font-black">${entry.goals}G</span>`);
            if (entry.assists) marks.push(`<span class="text-blue-400 font-black">${entry.assists}A</span>`);
            if (entry.red) marks.push('<span class="inline-block w-2 h-3 bg-red-500 rounded-sm"></span>');
            else if (entry.yellow) marks.push('<span class="inline-block w-2 h-3 bg-yellow-400 rounded-sm"></span>');
            return `<div class="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-700 rounded px-2 py-1.5">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">${escapeHTML(entry.player.name)} <span class="text-[9px] text-slate-500 font-bold">${escapeHTML(entry.player.mainPos)}</span></div>
                    <div class="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5">${marks.join(' ') || '&nbsp;'}</div>
                </div>
                <div class="text-sm font-black px-1.5 py-0.5 rounded ${cls}">${rating.toFixed(1)}</div>
            </div>`;
        }).join('');
        return `<div>
            <div class="text-[11px] font-bold uppercase tracking-wider ${teamNo === 1 ? 'text-blue-400' : 'text-red-400'} mb-2">${escapeHTML(team.name)}</div>
            <div class="space-y-1">${html}</div>
        </div>`;
    }).join('');
    body.innerHTML = `<div class="grid md:grid-cols-2 gap-4">${groups}</div>`;
}

// Ratings arrive from the host as a flat list of display rows.
function renderRemoteRatings(rows, sim) {
    const teams = [sim.t1?.name || 'Team 1', sim.t2?.name || 'Team 2'];
    const groups = [1, 2].map(teamNo => {
        const list = rows
            .filter(row => row.team === teamNo)
            .sort((a, b) => b.rating - a.rating);
        const html = list.map(row => {
            const rating = Number(row.rating) || 6;
            const cls = rating >= 8 ? 'bg-emerald-500 text-slate-900' : rating >= 7 ? 'bg-blue-500 text-white' : rating >= 6 ? 'bg-slate-600 text-white' : 'bg-red-500 text-white';
            const marks = [];
            if (row.goals) marks.push(`<span class="text-emerald-400 font-black">${row.goals}G</span>`);
            if (row.assists) marks.push(`<span class="text-blue-400 font-black">${row.assists}A</span>`);
            if (row.red) marks.push('<span class="inline-block w-2 h-3 bg-red-500 rounded-sm"></span>');
            else if (row.yellow) marks.push('<span class="inline-block w-2 h-3 bg-yellow-400 rounded-sm"></span>');
            return `<div class="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-700 rounded px-2 py-1.5">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-white truncate">${escapeHTML(row.name)} <span class="text-[9px] text-slate-500 font-bold">${escapeHTML(row.mainPos || '')}</span></div>
                    <div class="text-[9px] text-slate-400 flex items-center gap-1 mt-0.5">${marks.join(' ') || '&nbsp;'}</div>
                </div>
                <div class="text-sm font-black px-1.5 py-0.5 rounded ${cls}">${rating.toFixed(1)}</div>
            </div>`;
        }).join('');
        return `<div>
            <div class="text-[11px] font-bold uppercase tracking-wider ${teamNo === 1 ? 'text-blue-400' : 'text-red-400'} mb-2">${escapeHTML(teams[teamNo - 1])}</div>
            <div class="space-y-1">${html || '<div class="text-xs text-slate-500 italic">No ratings yet.</div>'}</div>
        </div>`;
    }).join('');
    return `<div class="grid md:grid-cols-2 gap-4">${groups}</div>`;
}

function toggleMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        if (gameState.matchSim) renderMatchRatings(gameState.matchSim);
        modal.classList.remove('hidden'); modal.classList.add('flex');
        setTimeout(() => { modal.classList.remove('opacity-0'); document.getElementById('ratings-panel').classList.remove('scale-95'); }, 10);
    } else {
        closeMatchRatings();
    }
}

function closeMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    document.getElementById('ratings-panel').classList.add('scale-95');
    setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 200);
}

function forceCloseMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    modal.classList.add('hidden', 'opacity-0');
    modal.classList.remove('flex');
    const panel = document.getElementById('ratings-panel');
    if (panel) panel.classList.add('scale-95');
}

function simulateMatchSequence(t1, t2) {
    const isEurope = Boolean(gameState.currentMatchData?.isEurope);
    const sim = {
        t1, t2, isEurope,
        matchId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        s1: 0, s2: 0,
        view: { s1: 0, s2: 0 },
        minuteCount: 0, lastGoalMinute: -15,
        cards: { 1: 0, 2: 0 },
        ratings: {},
        penRes: null,
        penLine: null,
        penStarted: false,
        stats: null,
        finished: false,
        injuryExtraMinutes: 0,   // accumulated from player subs → real added time
        timelineTimer: null,
        broadcastLog: []         // every simulated minute, mirrored to remote devices
    };
    sim.ratings = createMatchRatings(sim);
    gameState.matchSim = sim;

    // Live first half → second half → (ET/pens if needed). Half time is a beat in
    // the timeline, not a substitution window — the bench is used by the sim.
    runLivePeriod(sim, 1, 45, false, () => {
        appendTimelineLabel('HALF TIME');
        const htClock = document.getElementById('match-live-time');
        if (htClock) htClock.innerText = 'HT';
        setTimeout(() => runLivePeriod(sim, 46, 90, false, () => finishOrExtraTime(sim)), matchDelay(1400));
    });
}

function finishOrExtraTime(sim) {
    const clock = document.getElementById('match-live-time');
    appendTimelineLabel('FULL TIME');
    if (clock) clock.innerText = 'FT';

    if (sim.s1 !== sim.s2) {
        setTimeout(() => finishMatchSimulation(sim), matchDelay(600));
        return;
    }

    sim.wentToET = true;
    appendTimelineLabel('EXTRA TIME');
    if (clock) clock.innerText = 'ET';
    runLivePeriod(sim, 91, 105, true, () => {
        appendTimelineLabel('HALF TIME (ET)');
        setTimeout(() => {
            runLivePeriod(sim, 106, 120, true, () => {
                appendTimelineLabel('END OF EXTRA TIME');
                if (sim.s1 !== sim.s2) {
                    setTimeout(() => finishMatchSimulation(sim), matchDelay(600));
                } else {
                    appendTimelineLabel('PENALTY SHOOTOUT');
                    const penClock = document.getElementById('match-live-time');
                    if (penClock) penClock.innerText = 'PEN';
                    startPenaltyShootout(sim);
                }
            });
        }, matchDelay(1400));
    });
}

function getTacticsProfileFor(tactics) {
    const plan = normalizeTactics(tactics);
    const poss = TACTICS_POSSESSION[plan.possession];
    const defense = TACTICS_DEFENSE[plan.defense];
    const trans = TACTICS_TRANSITION[plan.transition];
    return {
        plan,
        possessionKey: plan.possession,
        defenseKey: plan.defense,
        transitionKey: plan.transition,
        attackKey: plan.possession,
        blockKey: plan.defense,
        attack: poss.attack * defense.attack * trans.attack,
        concede: defense.concede * trans.concede,
        control: poss.control + defense.control + trans.control,
        transition: poss.transition * defense.transition * trans.transition,
        card: poss.card * defense.card * trans.card,
        stamina: poss.stamina * defense.stamina * trans.stamina,
        setPiece: poss.setPiece * defense.setPiece * trans.setPiece,
        fouls: defense.fouls * trans.fouls,
        counter: poss.counter * (trans.counter || 1),
        vsDefense: poss.vsDefense
    };
}

// Kept as an alias: older modules and saved games may call this name.
function getTacticsMultipliersFor(tactics) {
    return getTacticsProfileFor(tactics);
}

// The same plan meets a different plan: style-vs-block, marking-vs-attack,
// control, counter exposure and set-piece pressure all land here so both the
// live minute engine and the headless league simulator use one calculation.
function getTacticsMatchupFor(tacticsA, tacticsB) {
    const a = getTacticsProfileFor(tacticsA);
    const b = getTacticsProfileFor(tacticsB);
    const controlEdge = clamp(a.control - b.control, -0.45, 0.45);
    const aStyle = (a.vsDefense && a.vsDefense[b.defenseKey]) || 1;
    const bStyle = (b.vsDefense && b.vsDefense[a.defenseKey]) || 1;
    const aSetPiece = 1 + ((a.setPiece * b.fouls) - 1) * TACTICS_SET_PIECE_ATTACK_WEIGHT;
    const bSetPiece = 1 + ((b.setPiece * a.fouls) - 1) * TACTICS_SET_PIECE_ATTACK_WEIGHT;
    const aCounterBoost = Math.min(0.40, Math.max(0, b.transition - 1) * a.counter * TACTICS_COUNTER_SCALE);
    const bCounterBoost = Math.min(0.40, Math.max(0, a.transition - 1) * b.counter * TACTICS_COUNTER_SCALE);
    const aAttack = a.attack * aSetPiece * (1 + controlEdge * TACTICS_CONTROL_SCALE) * aStyle * (1 + aCounterBoost);
    const bAttack = b.attack * bSetPiece * (1 - controlEdge * TACTICS_CONTROL_SCALE) * bStyle * (1 + bCounterBoost);
    return {
        a: {
            ...a,
            attack: aAttack,
            concede: a.concede,
            counterBoost: aCounterBoost,
            controlEdge,
            setPieceShare: clamp(TACTICS_SET_PIECE_GOAL_SHARE * a.setPiece * b.fouls, 0.04, 0.38)
        },
        b: {
            ...b,
            attack: bAttack,
            concede: b.concede,
            counterBoost: bCounterBoost,
            controlEdge: -controlEdge,
            setPieceShare: clamp(TACTICS_SET_PIECE_GOAL_SHARE * b.setPiece * a.fouls, 0.04, 0.38)
        }
    };
}

// Late-game life: pressing legs go, low blocks sit deeper, and the side chasing
// the game leans into its attacking style.
function getTacticsSituationalFor(sim, side, mul) {
    let attack = mul.attack;
    let concede = mul.concede;
    const minute = sim.minuteCount;
    const margin = side === 1 ? sim.s1 - sim.s2 : sim.s2 - sim.s1;
    if (minute > 70) {
        if (mul.defenseKey === 'high' || mul.defenseKey === 'man') { attack *= 0.86; concede *= 1.06; }
        if (mul.transitionKey === 'gegenpress') { attack *= 0.92; concede *= 1.05; }
        if (mul.defenseKey === 'low' || mul.transitionKey === 'restDefense') concede *= 0.92;
        if ((mul.possessionKey === 'direct' || mul.transitionKey === 'counter' || mul.transitionKey === 'restAttack') && margin < 0) {
            attack *= 1.10; concede *= 1.04;
        }
        if ((mul.possessionKey === 'positional' || mul.possessionKey === 'central') && margin > 0) concede *= 0.95;
        if (mul.possessionKey === 'overload' && margin < 0) { attack *= 1.08; concede *= 1.04; }
        if (mul.possessionKey === 'spatial' && margin < 0) { attack *= 1.06; concede *= 1.03; }
    }
    return { attack, concede };
}

function pickGoalKind(mul, setPieceShare = mul.setPieceShare) {
    if (Math.random() < setPieceShare) return 'setpiece';
    const counterChance = clamp(mul.counterBoost * 1.4, 0, 0.45);
    if (counterChance > 0 && Math.random() < counterChance) return 'counter';
    return 'open';
}

// Dead-ball volume is not only the plan: a side with a long-thrower and a couple of
// trick merchants wins more free kicks, and a side of enforcer and hot-heads gives
// more away. Both move the share of goals that come from a set piece.
function setPieceShareFor(team, oppTeam, mul) {
    const share = mul.setPieceShare + playstyleSetPieceBoost(team);
    return clamp(share * playstyleFoulsGiven(oppTeam), 0.04, 0.42);
}

// How much is the match actually on the line? Zeus carriers are worth nothing in
// a dead rubber, so the pressure is a number, not a flag: level late beats a
// one-goal margin, and both beat a game already won.
function getBigGamePressure(sim, side) {
    const margin = side === 1 ? sim.s1 - sim.s2 : sim.s2 - sim.s1;
    const minute = sim.minuteCount;
    if (minute < 75) return 0;
    if (margin === 0) return 1;
    return Math.abs(margin) === 1 ? 0.55 : 0;
}

/** Simulate + display a period minute-by-minute so subs can pause on dead balls. */
function simulateMinute(sim, displayTime, isOT) {
    const { t1, t2 } = sim;
    sim.minuteCount++;
    if (!sim.cards) sim.cards = { 1: 0, 2: 0 };
    // Minutes actually spent on the pitch, which added time and substitutions both extend.
    [t1, t2].forEach(tm => (tm.lineup || []).forEach(slot => { slot.min = (slot.min || 0) + 1; }));
    const events = [];
    // The same ATT/MID/DEF edge that decides a league match decides this one.
    // engine-core.js converts it to expected goals for each side; tactics then
    // scale those expectations without changing the underlying model.
    const breakdown1 = getStrengthBreakdown(t1, t2.tactics);
    const breakdown2 = getStrengthBreakdown(t2, t1.tactics);
    const edge = EngineCore.matchupEdge(breakdown1, breakdown2);
    const expected = EngineCore.expectedGoals({
        edge,
        base: BASE_EXPECTED_GOALS_PER_TEAM,
        coefficient: MATCH_STRENGTH_COEFFICIENT
    });
    const perMinute1 = EngineCore.goalChancePerMinute(expected.lambdaA);
    const perMinute2 = EngineCore.goalChancePerMinute(expected.lambdaB);

    const matchup = getTacticsMatchupFor(t1.tactics, t2.tactics);
    const mul1 = matchup.a;
    const mul2 = matchup.b;
    const sit1 = getTacticsSituationalFor(sim, 1, mul1);
    const sit2 = getTacticsSituationalFor(sim, 2, mul2);

    const coh1 = archetypeCoherence(t1, t2.tactics) * playstyleCoherence(t1, t2.tactics);
    const coh2 = archetypeCoherence(t2, t1.tactics) * playstyleCoherence(t2, t1.tactics);
    // A Zeus only lifts his side once the match is actually on the line.
    const nerve1 = playstyleClutchBoost(t1, getBigGamePressure(sim, 1));
    const nerve2 = playstyleClutchBoost(t2, getBigGamePressure(sim, 2));

    let chance1 = Math.max(0.005, perMinute1 * sit1.attack * sit2.concede * coh1 * nerve1);
    let chance2 = Math.max(0.005, perMinute2 * sit2.attack * sit1.concede * coh2 * nerve2);

    if (isOT) { chance1 *= 0.5; chance2 *= 0.5; }
    // Teams feel each other out: goals are rarer in the opening minutes, easing back to normal by minute 7
    if (sim.minuteCount <= 6) {
        const openingFactor = 0.25 + (sim.minuteCount - 1) * 0.13; // 0.25 at minute 1 -> 0.90 at minute 6
        chance1 *= openingFactor; chance2 *= openingFactor;
    }
    if (sim.minuteCount - sim.lastGoalMinute < 5) { chance1 *= 0.35; chance2 *= 0.35; }

    const roll = Math.random();
    if (roll < chance1) {
        sim.s1++; sim.lastGoalMinute = sim.minuteCount;
        events.push({ type: 'goal', t: 1, ...getGoal(t1, pickGoalKind(mul1, setPieceShareFor(t1, t2, mul1))) });
    } else if (roll < chance1 + chance2) {
        sim.s2++; sim.lastGoalMinute = sim.minuteCount;
        events.push({ type: 'goal', t: 2, ...getGoal(t2, pickGoalKind(mul2, setPieceShareFor(t2, t1, mul2))) });
    } else {
        // Hot heads and enforcers make the match more fractious overall, and one of
        // them is the likelier offender — a flat random pick would hide the tag.
        const booking = Math.sqrt(playstyleBookingRate(t1) * playstyleBookingRate(t2));
        const cardChance = (isOT ? 0.005 : 0.015) * Math.max(0.5, (mul1.card + mul2.card) / 2) * booking;
        if (Math.random() < cardChance) {
            const cardShare1 = mul1.card / (mul1.card + mul2.card);
            let tn = Math.random() < cardShare1 ? 1 : 2;
            const tm = tn === 1 ? t1 : t2;
            const offenders = tm.lineup.filter(l => l.pos !== 'GK' && l.player);
            const p = weightedPick(offenders.map(l => ({ item: l, weight: playstyleEffects(l.player).card })));
            if (p) {
                sim.cards[tn] = (sim.cards[tn] || 0) + 1;
                p.yel++;
                if (p.yel >= 2) {
                    tm.lineup = tm.lineup.filter(x => x !== p);
                    events.push({ type: 'red', t: tn, name: p.player.name, id: p.player.id });
                } else {
                    events.push({ type: 'yellow', t: tn, name: p.player.name, id: p.player.id });
                }
            }
        }
    }

    // Substitutions are decided outside the goal branch: a minute that produces a
    // goal still has to run the bench check, or changes bunch up after quiet spells.
    [1, 2].forEach(tn => applyAutomaticSub(sim, tn === 1 ? t1 : t2, tn, events));

    return { displayTime, events };
}

// --- Automatic substitutions ---
// A starter holds their form for about an hour, then loses it every minute at a rate
// set by their body; the bench is only used when fresh legs really beat that fade, and
// which position gets refreshed follows the scoreline rather than the ratings alone.
const SUB_WINDOW_START = 57;
const SUB_MIN_GAIN = 0.5;      // below this the swap is noise, so leave the starter on

function getStaminaFade(slot, tactics, team) {
    const played = (slot.min || 0) - SUB_WINDOW_START;
    if (played <= 0) return 0;
    const stats = (slot.player && slot.player.stats) || {};
    const engine = 1 + ((stats.PHY || 65) - 65) / 90 + ((stats.PAC || 65) - 65) / 260;
    const running = getTacticsProfileFor(tactics).stamina;
    // An iron man runs the same plan for longer; a fragile body goes earlier.
    const chassis = playstyleEffects(slot.player).stamina;
    // The medical programme buys back some of the late-game fade.
    const fitness = medicalStaminaFactor(team);
    return Math.min(0.18, played * 0.005 * running * chassis * fitness / Math.max(0.6, engine));
}

function getLiveOVR(slot, tactics, team) {
    return getDynamicOVR(slot.player, slot.pos) * (1 - getStaminaFade(slot, tactics, team));
}

function pitchUnit(pos) {
    const meta = POSITION_META[pos];
    return meta ? meta.unit : 1;
}

function pickAutoSub(sim, tm, tn, forced = false, early = false) {
    // A player who just came on is not taken off again, and the keeper stays put.
    const onPitch = tm.lineup.filter(slot => slot.pos !== 'GK' && slot.player && (slot.min || 0) >= 8);
    const bench = (tm.bench || []).filter(p => p.mainPos !== 'GK');
    if (!onPitch.length || !bench.length) return null;

    const margin = tn === 1 ? sim.s1 - sim.s2 : sim.s2 - sim.s1;
    const late = sim.minuteCount > 74;
    // Chasing pushes bodies forward; protecting a lead wants the fresh legs at the back.
    const demand = margin < 0 ? (late ? 1.2 : 0.7) : margin > 0 && late ? -0.9 : 0;

    let best = null;
    onPitch.forEach(out => {
        const live = getLiveOVR(out, tm.tactics, tm);
        bench.forEach(inn => {
            const naturalFit = inn.mainPos === out.pos || (inn.subPos || []).includes(out.pos) ? 0.8 : 0;
            // Early changes are injuries / knocks, so who goes off follows the body:
            // a fragile starter is the one the manager loses, an iron man plays on.
            const frailty = early ? (playstyleEffects(out.player).injury - 1) * 6 : 0;
            const gain = (getDynamicOVR(inn, out.pos) - live) + naturalFit + frailty
                + (pitchUnit(inn.mainPos) - pitchUnit(out.pos)) * demand
                + Math.random() * (early ? 12 : 1.5);
            if (!best || gain > best.gain) best = { out, inn, gain };
        });
    });
    if (!best) return null;

    // A gassed player is a liability even when the bench cannot offer an upgrade, so
    // fatigue on its own can force the change.
    // Planned changes (see buildSubPlan) always happen; only unplanned ones need a real upgrade.
    if (!forced && best.gain < SUB_MIN_GAIN && getStaminaFade(best.out, tm.tactics, tm) < 0.12) return null;
    return best;
}

// Each team gets its own substitution plan at kick-off, so the number and timing of
// changes varies the way real matches do: a few teams make 2-3, many make 4, some use all
// five, and changes come in windows (often two or three at the same minute) rather than
// one every few minutes. A few happen early (knocks) or at half-time.
function buildSubPlan(tm) {
    const cap = typeof MAX_SUBS === 'number' ? MAX_SUBS : 5;
    const r = Math.random();
    let target = r < 0.03 ? 1 : r < 0.12 ? 2 : r < 0.36 ? 3 : r < 0.68 ? 4 : 5;
    target = Math.min(target, cap);

    const plan = [];
    // An early change for a knock, usually just one. A dressing room full of
    // fragile bodies loses players this way; an iron man does not.
    const frailty = tm ? playstyleInjuryRisk(tm) : 1;
    if (target >= 2 && Math.random() < clamp(0.10 * frailty, 0.03, 0.30)) plan.push({ minute: 18 + Math.floor(Math.random() * 27), early: true });
    // Half-time tweak.
    if (plan.length < target && Math.random() < 0.14) plan.push({ minute: 46, early: false });
    // Main windows in the second half.
    const windows = [
        56 + Math.floor(Math.random() * 12),   // 56-67
        68 + Math.floor(Math.random() * 10),   // 68-77
        78 + Math.floor(Math.random() * 10)    // 78-87
    ];
    const weights = [0.38, 0.40, 0.22];
    while (plan.length < target) {
        const roll = Math.random();
        const w = roll < weights[0] ? 0 : roll < weights[0] + weights[1] ? 1 : 2;
        plan.push({ minute: windows[w], early: false });
    }
    return plan.sort((x, y) => x.minute - y.minute);
}

function applyAutomaticSub(sim, tm, tn, events) {
    const cap = typeof MAX_SUBS === 'number' ? MAX_SUBS : 5;
    // New plan for every match (team states are rebuilt per match, but key it to the sim to be safe).
    if (tm.subPlanFor !== sim) {
        tm.subPlanFor = sim;
        tm.subPlan = buildSubPlan(tm);
    }
    const minute = sim.minuteCount;
    const margin = tn === 1 ? sim.s1 - sim.s2 : sim.s2 - sim.s1;

    // Game state can add a change: a trailing side with changes left throws on fresh attackers.
    if ((minute === 70 || minute === 78 || minute === 84) && margin < 0 && (tm.subs || 0) + tm.subPlan.length < cap && Math.random() < 0.35) {
        tm.subPlan.push({ minute, early: false });
    }
    // Extra time: managers often get one more change.
    if ((minute === 91 || minute === 106) && (tm.subs || 0) + tm.subPlan.length < cap && Math.random() < 0.35) {
        tm.subPlan.push({ minute, early: false });
    }

    while (tm.subPlan.length && tm.subPlan[0].minute <= minute) {
        const planned = tm.subPlan.shift();
        if ((tm.subs || 0) >= cap) return;

        const choice = pickAutoSub(sim, tm, tn, true, planned.early);
        if (!choice) continue;

        const outName = choice.out.player.name;
        const outId = choice.out.player.id;
        tm.bench = tm.bench.filter(x => x.id !== choice.inn.id);
        choice.out.player = choice.inn;
        choice.out.min = 0;
        choice.out.yel = 0;
        // Early changes are knocks. Remember who came off so the post-match
        // settlement can give him a real injury length.
        if (planned.early) {
            sim.injuryOuts = sim.injuryOuts || [];
            sim.injuryOuts.push({ t: tn, id: outId, name: outName });
        }
        // The slot remembers that it is now filled from the bench, which is what a
        // Super-Sub's finishing bonus hangs on.
        choice.out.cameOn = minute;
        tm.subs = (tm.subs || 0) + 1;
        ensureRatingEntry(sim, choice.inn, tn, choice.out.pos);
        events.push({ type: 'sub', t: tn, inName: choice.inn.name, outName, id: choice.inn.id });
        sim.injuryExtraMinutes = (sim.injuryExtraMinutes || 0) + 0.5 + Math.random() * 0.5;
    }
}

function runLivePeriod(sim, start, end, isOT, onDone) {
    let minute = start;
    let totalAdded = 0; // decided when the period ends, so subs made during it count
    let injuryIndex = 0;
    let phase = 'regular'; // regular | injury

    function scheduleNext(delay) {
        clearTimeout(sim.timelineTimer);
        sim.timelineTimer = setTimeout(tick, delay);
    }
    sim.scheduleTick = scheduleNext;

    function tick() {
        if (sim.finished) return;

        if (phase === 'regular') {
            if (minute > end) {
                phase = 'injury';
                injuryIndex = 1;
                const baseAdded = Math.floor(Math.random() * (isOT ? 2 : 4)) + 1;
                const subAdded = Math.min(6, Math.ceil(sim.injuryExtraMinutes || 0));
                sim.injuryExtraMinutes = Math.max(0, (sim.injuryExtraMinutes || 0) - subAdded);
                totalAdded = baseAdded + subAdded;
            }
        }

        if (phase === 'injury') {
            if (injuryIndex > totalAdded) {
                // Retire this period's scheduler: until the next period installs its
                // own, a speed click would re-enter a finished period and fire its
                // onDone twice, skipping half-time or starting the second half twice.
                sim.scheduleTick = null;
                onDone();
                return;
            }
        }

        const displayTime = phase === 'regular' ? `${minute}'` : `${end}+${injuryIndex}'`;
        const step = simulateMinute(sim, displayTime, isOT);
        displayTimelineStep(step, sim);

        if (phase === 'regular') minute++;
        else injuryIndex++;

        scheduleNext(matchDelay(250));
    }

    scheduleNext(matchDelay(300));
}

function appendTimelineLabel(label) {
    const tl = document.getElementById('match-timeline');
    if (!tl) return;
    tl.insertAdjacentHTML('beforeend', `<div class="w-full flex justify-center my-4 relative z-20"><div class="bg-slate-800 text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest">${label}</div></div>`);
    if (tl.parentElement) tl.parentElement.scrollTop = tl.parentElement.scrollHeight;
}

// Push the current match state to remote devices (host only).
function broadcastMatch(sim) {
    if (sim === gameState.matchSim && Net.online && Net.isHost) {
        Net.publishMatch(serializeMatchView(sim));
    }
}

// Substitutions that land in the same minute share one card per team.
function subCardHtml(subs, extraClass = '', maxWidth = '') {
    const lines = subs.map(e => `
        <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-black text-slate-500 shrink-0">SUB</span>
            <span class="text-[10px] font-bold text-emerald-700 truncate">${escapeHTML(e.inName)}</span>
            <span class="text-[9px] text-slate-400 shrink-0">⇄</span>
            <span class="text-[10px] font-bold text-red-600 line-through truncate">${escapeHTML(e.outName)}</span>
        </div>`).join('');
    return `<div class="timeline-card py-1 px-3 bg-slate-50 border border-slate-200 flex flex-col gap-0.5 w-auto max-w-[70%] ${extraClass}"${maxWidth ? ` style="max-width:${maxWidth}"` : ''}>${lines}</div>`;
}

function displayTimelineStep(step, sim) {
    // The host mirrors the match to remote devices: every real event is pushed
    // immediately, quiet minutes only every 10th tick so the clock still moves.
    if (sim === gameState.matchSim && Net.online && Net.isHost) {
        const log = (sim.broadcastLog = sim.broadcastLog || []);
        log.push(step);
        if ((step.events && step.events.length) || log.length % 10 === 0) {
            Net.publishMatch(serializeMatchView(sim));
        }
    }

    const tl = document.getElementById('match-timeline');
    const clock = document.getElementById('match-live-time');
    if (clock) clock.innerText = step.displayTime;

    if (!step.events || !step.events.length) return;

    step.events.forEach(e => applyViewEvent(sim, e));

    const isAddedTime = step.displayTime.includes('+');
    const timeLabel = step.displayTime.replace("'", '');
    const timeBubble = `<div class="timeline-time-bubble ${isAddedTime ? 'time-injury' : ''}">${timeLabel}</div>`;

    step.events.forEach(e => {
        // Subs are grouped below, so every team's changes in this minute land on
        // the same timeline row instead of repeating the time bubble.
        if (e.type === 'sub') return;
        const isL = e.t === 1;
        let cHtml = '';

        if (e.type === 'goal') {
            cHtml = `
                <div class="timeline-card animate-reveal">
                    <div class="font-bold text-slate-800 text-sm md:text-base flex items-center gap-1"><span class="text-[10px]">⚽</span> ${escapeHTML(e.scorer)}</div>
                    ${e.assister ? `<div class="text-[10px] text-blue-500 font-semibold mt-1 flex items-center gap-1"><span class="inline-block w-4 h-4 rounded-full bg-blue-100 text-blue-600 text-[9px] font-black flex items-center justify-center leading-none">A</span>${escapeHTML(e.assister)}</div>` : ''}
                    <div class="absolute ${isL?'-right-12':'-left-12'} top-1/2 -translate-y-1/2 font-black text-xl text-slate-800">${sim.view.s1}-${sim.view.s2}</div>
                </div>`;
        } else if (e.type === 'yellow') {
            cHtml = `<div class="timeline-card py-1 px-3 bg-yellow-50 flex items-center gap-2 w-auto max-w-[40%]"><div class="w-2 h-3 bg-yellow-400 rounded-sm"></div><div class="text-xs font-bold text-slate-700 truncate">${escapeHTML(e.name)}</div></div>`;
        } else if (e.type === 'red') {
            cHtml = `<div class="timeline-card py-1 px-3 bg-red-50 flex items-center gap-2 w-auto max-w-[40%]"><div class="w-2 h-3 bg-red-500 rounded-sm"></div><div class="text-xs font-bold text-slate-700 truncate">${escapeHTML(e.name)}</div></div>`;
        }

        if (cHtml && tl) {
            const row = document.createElement('div');
            row.className = `timeline-event ${isL ? 'left-side' : 'right-side'}`;
            row.innerHTML = `
                ${isL ? cHtml : '<div class="w-1/2"></div>'}
                ${timeBubble}
                ${!isL ? cHtml : '<div class="w-1/2"></div>'}
            `;
            tl.appendChild(row);
            if (tl.parentElement) tl.parentElement.scrollTop = tl.parentElement.scrollHeight;
        }
    });

    // Every substitution in this minute is compacted onto one row: one time
    // bubble, with team 1 on the left and team 2 on the right when both change.
    const subs = step.events.filter(e => e.type === 'sub');
    if (!subs.length || !tl) return;
    const subs1 = subs.filter(e => e.t === 1);
    const subs2 = subs.filter(e => e.t === 2);
    let rowHtml;
    if (subs1.length && subs2.length) {
        rowHtml = `<div class="timeline-event split-sides">
            <div class="w-1/2 flex justify-start">${subCardHtml(subs1, 'left-card', '92%')}</div>
            <div class="w-1/2 flex justify-end">${subCardHtml(subs2, 'right-card', '92%')}</div>
            ${timeBubble}
        </div>`;
    } else if (subs1.length) {
        rowHtml = `<div class="timeline-event left-side">${subCardHtml(subs1)}${timeBubble}<div class="w-1/2"></div></div>`;
    } else {
        rowHtml = `<div class="timeline-event right-side"><div class="w-1/2"></div>${timeBubble}${subCardHtml(subs2)}</div>`;
    }
    tl.insertAdjacentHTML('beforeend', rowHtml);
    if (tl.parentElement) tl.parentElement.scrollTop = tl.parentElement.scrollHeight;
}

// ============================================================
// PENALTY SHOOTOUT
// ============================================================

function startPenaltyShootout(sim) {
    const board = document.getElementById('pen-board');
    const teams = [sim.t1, sim.t2];

    // The list is the team's own pick order: the men who actually take penalties step up
    // first, and the keeper is left till sudden death, exactly as a real side lines up.
    const takerScore = player => ((player.stats && player.stats.SHO) || player.rating || 70)
        + (playstyleEffects(player).pen * 100);
    const takersFor = team => {
        const slots = (team.lineup || []).filter(l => l && l.player);
        const outfield = slots.filter(l => l.pos !== 'GK').map(l => l.player).sort((a, b) => {
            const byHabit = (playstyleEffects(b).taker ? 1 : 0) - (playstyleEffects(a).taker ? 1 : 0);
            return byHabit || takerScore(b) - takerScore(a);
        });
        const gk = slots.find(l => l.pos === 'GK');
        if (gk) outfield.push(gk.player);
        return outfield.length ? outfield : [{ name: team.name, stats: { SHO: 70 } }];
    };
    const keeperOf = team => {
        const g = (team.lineup || []).find(l => l && l.player && l.pos === 'GK');
        return g ? g.player : null;
    };
    const takers = teams.map(takersFor);
    const keepers = teams.map(keeperOf);
    const kicks = [[], []];
    const goals = i => kicks[i].filter(Boolean).length;

    const scores = (taker, keeper) => {
        const shooting = (taker.stats && taker.stats.SHO) || taker.rating || 75;
        const keeping = (keeper && keeper.stats && keeper.stats.DEF) || 75;
        return Math.random() < clamp(0.76 + (shooting - 75) * 0.004 - (keeping - 75) * 0.0025
            + playstyleEffects(taker).pen, 0.5, 0.93);
    };

    const isDecided = () => {
        const taken = [kicks[0].length, kicks[1].length];
        const g = [goals(0), goals(1)];
        const suddenDeath = Math.max(taken[0], taken[1]) > 5 || (taken[0] >= 5 && taken[1] >= 5);
        if (suddenDeath) return taken[0] === taken[1] && g[0] !== g[1];
        return g[0] > g[1] + (5 - taken[1]) || g[1] > g[0] + (5 - taken[0]);
    };

    const render = (note, finalText) => {
        if (!board) return;
        
        const slotsShown = 5; 
        const maxKicks = Math.max(kicks[0].length, kicks[1].length);
        const startIndex = maxKicks > 5 ? maxKicks - 5 : 0;
        
        const rows = teams.map((team, i) => {
            const currentKicks = kicks[i];
            const displayKicks = currentKicks.slice(startIndex, startIndex + 5);
            
            const dots = Array.from({ length: slotsShown }, (_, k) => {
                const r = displayKicks[k];
                const style = r === undefined ? 'background:transparent;border:2px solid #94a3b8;color:transparent;'
                    : r ? 'background:#22c55e;border:2px solid #16a34a;color:#fff;' : 'background:#ef4444;border:2px solid #b91c1c;color:#fff;';
                return `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:900;${style}">${r === undefined ? '' : r ? '✓' : '✕'}</span>`;
            }).join('');
            
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                <span style="width:96px;font-size:12px;font-weight:800;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(team.name)}</span>
                <div style="display:flex;gap:4px;flex:1;justify-content:center;flex-wrap:wrap;">${dots}</div>
                <span style="width:24px;text-align:right;font-size:20px;font-weight:900;">${goals(i)}</span>
            </div>`;
        }).join('');
        
        board.innerHTML = `<div style="border:1px solid #cbd5e1;border-radius:14px;padding:12px;margin:8px 0;background:rgba(148,163,184,.08);">
            <div style="text-align:center;font-size:10px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Penalty Shootout</div>
            ${rows}
            <div style="text-align:center;font-size:12px;font-weight:700;margin-top:6px;min-height:18px;">${finalText || note || ''}</div>
        </div>`;
    };

    if (board) {
        const timeline = document.getElementById('match-timeline');
        if (timeline) {
            // Append after the timeline so the center line doesn't cut through
            timeline.insertAdjacentElement('afterend', board);
        }
        board.classList.remove('hidden');
    }
    
    render('Shootout begins…');
    sim.penStarted = true;
    broadcastMatch(sim);
    const content = document.getElementById('match-content');
    const scrollDown = () => { if (content) content.scrollTo({ top: content.scrollHeight, behavior: 'smooth' }); };
    scrollDown();

    let side = 0;
    const kick = () => {
        if (gameState.matchSim !== sim || sim.finished) return;
        const taker = takers[side][kicks[side].length % takers[side].length];
        const scored = scores(taker, keepers[1 - side]);
        kicks[side].push(scored);
        (sim.penLine = sim.penLine || []).push({ side, name: taker.name, scored });
        broadcastMatch(sim);
        render(`${escapeHTML(taker.name)} ${scored ? 'scores ⚽' : 'misses ❌'}`);
        scrollDown();

        if (isDecided()) {
            sim.penRes = { p1: goals(0), p2: goals(1) };
            const winner = sim.penRes.p1 > sim.penRes.p2 ? sim.t1 : sim.t2;
            render('', `🏆 ${escapeHTML(winner.name)} win ${sim.penRes.p1}–${sim.penRes.p2} on penalties`);
            setTimeout(() => finishMatchSimulation(sim), matchDelay(1400));
            return;
        }
        side = 1 - side;
        sim.timelineTimer = setTimeout(kick, matchDelay(PEN_KICK_DELAY));
    };
    sim.timelineTimer = setTimeout(kick, matchDelay(PEN_KICK_DELAY));
}

// Applies the human consequences of a live match: suspensions for red cards,
// injuries for early knocks, the gate receipt and the fan reaction. A guest
// never owns this state, so it is settled on the host only.
function settleLiveMatch(sim) {
    if (!sim || sim.settled) return;
    sim.settled = true;
    if (typeof Net !== 'undefined' && Net.online && !Net.ownsGame()) return;

    const pen = sim.penRes;
    const sides = [
        { t: 1, team: sim.t1, gf: sim.s1, ga: sim.s2 },
        { t: 2, team: sim.t2, gf: sim.s2, ga: sim.s1 }
    ];
    let changed = false;
    const reports = [];

    sides.forEach(side => {
        const manager = (gameState.managers || []).find(m =>
            side.team && String(m.id) === String(side.team.id));
        if (!manager) return;

        let result = side.gf > side.ga ? 'W' : side.gf === side.ga ? 'D' : 'L';
        if (pen) result = (side.t === 1 ? pen.p1 > pen.p2 : pen.p2 > pen.p1) ? 'W' : 'L';
        const pens = pen ? (side.t === 1 ? `${pen.p1}–${pen.p2}` : `${pen.p2}–${pen.p1}`) : null;

        // First clear the fixture a previously banned/injured man has just missed,
        // then add anything that happened in this match.
        if (typeof tickPlayerAbsences === 'function') tickPlayerAbsences(manager.squad);

        const suspensions = [];
        const injuries = [];
        let yellows = 0;
        Object.values(sim.ratings || {}).forEach(entry => {
            if (!entry || entry.team !== side.t || !entry.player) return;
            if (entry.yellow) yellows += Number(entry.yellow) || 0;
            if (!entry.red) return;
            const player = (manager.squad || []).find(p => p.id === entry.player.id);
            if (!player) return;
            const out = markPlayerOut(player, suspensionLengthFor(player), 'suspension');
            suspensions.push({ name: player.name, matches: out ? out.matches : 1 });
            changed = true;
        });

        (sim.injuryOuts || []).filter(entry => entry.t === side.t).forEach(entry => {
            const player = (manager.squad || []).find(p => p.id === entry.id);
            if (!player) return;
            const out = markPlayerOut(player, injuryLengthFor(player, side.team), 'injury');
            injuries.push({ name: player.name, matches: out ? out.matches : 1 });
            changed = true;
        });

        const finance = awardMatchdayFinance(manager, result, side.gf, side.ga);
        reports.push({
            managerId: manager.id,
            name: manager.name,
            result, goalsFor: side.gf, goalsAgainst: side.ga, pens,
            revenue: finance ? finance.revenue : 0,
            fansBefore: finance ? finance.fansBefore : fansOf(manager),
            fansAfter: finance ? finance.fansAfter : fansOf(manager),
            fanDelta: finance ? finance.fanDelta : 0,
            totalRevenue: Number(manager.ticketRevenue) || 0,
            yellows, injuries, suspensions
        });
        changed = true;
    });

    // European ties settle the same consequences but never pop the report up, and a
    // quiet matchday needs no card: the updates panel under the chart already says it.
    if (!sim.isEurope && reports.length && typeof matchReportHasEvents === 'function'
        && matchReportHasEvents(reports) && typeof showMatchdayReportPanels === 'function') {
        showMatchdayReportPanels(reports, { title: pen ? 'Full time · penalties' : 'Full time' });
    }

    if (!changed) return;
    if (typeof updateDashboard === 'function') {
        gameState.managers.forEach(manager => updateDashboard(manager.id));
    }
    if (typeof Net !== 'undefined' && Net.online && Net.isHost && typeof Net.publishManagers === 'function') {
        Net.publishManagers();
    }
    if (typeof SaveGame !== 'undefined') SaveGame.schedule();
}

function finishMatchSimulation(sim) {
    if (sim.finished) return; // never record a result twice
    sim.finished = true;
    settleLiveMatch(sim);
    clearTimeout(sim.timelineTimer);
    finishVisuals(sim);
}


function finishVisuals(sim) {
    const { t1, t2, s1, s2, penRes } = sim;
    
    document.getElementById('match-actions').classList.remove('hidden');
    
    const str1 = getStrength(t1) || 70;
    const str2 = getStrength(t2) || 70;
    const strRatio = str1 / (str1 + str2);
    const etFactor = sim.wentToET ? 1.33 : 1;   // 120 minutes instead of 90
    const noise = amp => (Math.random() * 2 - 1) * amp;

    // --- Possession: control (tactics) + strength, kept in a believable 30-70 band ---
    const tactics = getTacticsMatchupFor(t1.tactics, t2.tactics);
    const controlEdge = tactics.a.control - tactics.b.control;
    let poss1 = Math.round(50 + controlEdge * 34 + (strRatio - 0.5) * 22 + noise(4));
    poss1 = clamp(poss1, 30, 70);

    // --- Shots: volume follows territory, tactics and the scoreline (leaders sit back) ---
    const tacticTilt = clamp((tactics.a.attack * tactics.b.concede - tactics.b.attack * tactics.a.concede) * 5, -5, 5);
    const totShots = Math.round((18 + Math.random() * 8 + (s1 + s2) * 1.5) * etFactor);
    const shotShare1 = clamp(
        0.5 + (poss1 - 50) * 0.004 + (strRatio - 0.5) * 0.25 + tacticTilt * 0.012 + (s1 - s2) * 0.015 + noise(0.04),
        0.25, 0.75
    );
    let t1S = Math.round(totShots * shotShare1);
    // Every goal is a shot, so nobody can have fewer shots than goals.
    t1S = clamp(t1S, s1, totShots - s2);
    const t2S = totShots - t1S;

    // --- Shots on target: ~1/3 to 1/2 of shots, never fewer than the goals scored ---
    const onTargetFor = (shots, goals) => clamp(Math.round(shots * (0.33 + Math.random() * 0.14)), goals, shots);
    const onTarget1 = onTargetFor(t1S, s1);
    const onTarget2 = onTargetFor(t2S, s2);
    sim.gkSaves = { 1: Math.max(0, onTarget2 - s2), 2: Math.max(0, onTarget1 - s1) };

    // --- Corners: roughly a third of shots end in one, split by who is attacking ---
    const totCorners = Math.max(2, Math.round((t1S + t2S) * 0.36 + noise(2)));
    const cornerShare1 = clamp(t1S / Math.max(1, t1S + t2S) + noise(0.06), 0.1, 0.9);
    const corners1 = clamp(Math.round(totCorners * cornerShare1), 0, totCorners);
    const corners2 = totCorners - corners1;

    // --- Offsides: caught by the OPPONENT's high line / press, more when you attack more ---
    const highLineOf = tc => (tc.defenseKey === 'high' || tc.defenseKey === 'man' || tc.transitionKey === 'gegenpress') ? 1.25 : 1;
    const attackShare1 = t1S / Math.max(1, t1S + t2S);
    const offsidesFor = (opponentLine, share) => Math.max(0, Math.round((1 + Math.random() * 3.5) * opponentLine * (0.6 + share) * (sim.wentToET ? 1.2 : 1)));
    const offsides1 = offsidesFor(highLineOf(tactics.b), attackShare1);
    const offsides2 = offsidesFor(highLineOf(tactics.a), 1 - attackShare1);

    // --- Fouls: dirtier tactics and the side chasing the ball foul more; cards need fouls ---
    const foulBias1 = tactics.a.fouls || 1;
    const foulBias2 = tactics.b.fouls || 1;
    const cards1 = (sim.cards && sim.cards[1]) || 0;
    const cards2 = (sim.cards && sim.cards[2]) || 0;
    const floor1 = cards1 * 2, floor2 = cards2 * 2;
    const totFouls = Math.max(Math.round((16 + Math.random() * 10) * etFactor), floor1 + floor2 + 4);
    const foulShare1 = 0.5 + (foulBias1 - foulBias2) * 0.18 + (50 - poss1) * 0.002 + noise(0.06);
    const fouls1 = clamp(Math.round(totFouls * foulShare1), Math.max(3, floor1), totFouls - Math.max(3, floor2));
    const fouls2 = totFouls - fouls1;

    // Bars are drawn from the two numbers themselves, so "43%" strings can no longer break the width.
    const barRow = (left, label, right, fmt = v => v, colorL = 'bg-blue-500', colorR = 'bg-red-500') => {
        const sum = left + right;
        const wL = sum > 0 ? Math.round((left / sum) * 100) : 50;
        const wR = 100 - wL;
        return `
        <div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${fmt(left)}</span><span>${label}</span><span>${fmt(right)}</span></div>
        <div class="w-full bg-slate-200 h-2 rounded flex overflow-hidden mb-3"><div class="${colorL} h-full" style="width:${wL}%"></div><div class="${colorR} h-full" style="width:${wR}%"></div></div>`;
    };
    const statBars = `
        ${barRow(poss1, 'POSSESSION', 100 - poss1, v => v + '%')}
        ${barRow(t1S, 'SHOTS', t2S)}
        ${barRow(onTarget1, 'SHOTS ON TARGET', onTarget2)}
        ${barRow(corners1, 'CORNERS', corners2)}
        ${barRow(offsides1, 'OFFSIDES', offsides2)}
        ${barRow(fouls1, 'FOULS', fouls2)}
    `;
    document.getElementById('match-stats-bars').innerHTML = statBars;
    document.getElementById('match-stats-container').classList.remove('hidden');

    const actualS1 = penRes ? s1 + penRes.p1 : s1;
    const actualS2 = penRes ? s2 + penRes.p2 : s2;
    // Either winner gets the confetti: this is not a home-team broadcast.
    if (actualS1 !== actualS2 || penRes) triggerConfetti();


    sim.stats = { poss1, t1S, t2S, onTarget1, onTarget2, corners1, corners2, offsides1, offsides2, fouls1, fouls2 };
    broadcastMatch(sim);

    if (gameState.currentMatchData?.isEurope && typeof onEuropeMatchFinished === 'function') {
        onEuropeMatchFinished(s1, s2, penRes);
    }
    
    setTimeout(() => {
        const content = document.getElementById('match-content');
        if (content) content.scrollTo({ top: content.scrollHeight, behavior: 'smooth' });
    }, 100);
}

function finishMatch() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host continues.');
    if (gameState.europe && gameState.europe.bracketPending) return;
    forceCloseMatchRatings();
    // My Player runs its matches through this same engine, but the result is
    // written back into the career instead of a tournament bracket.
    if (gameState.mode === 'MP' && typeof mpOnLiveMatchFinished === 'function') {
        mpOnLiveMatchFinished();
        return;
    }
    if (gameState.europe && gameState.currentMatchData && gameState.currentMatchData.isEurope) {
        gameState.currentMatchData = null;
        gameState.europe.bracketPending = true;
        setTimeout(() => {
            gameState.europe.bracketPending = false;
            showEuropeBracket();
        }, 300);
        return;
    }
    if (gameState.matchQueue.length > 0) {
        renderBracket();
    } else if (gameState.mode === 'H2H' && gameState.matchSim) {
        showH2HResult(gameState.matchSim);
    } else {
        leaveGameToMenu();
    }
}

function showH2HResult(sim) {
    const { t1, t2, s1, s2, penRes } = sim;
    const t1Won = penRes ? penRes.p1 > penRes.p2 : s1 > s2;
    const winner = t1Won ? t1 : t2;
    document.getElementById('h2h-winner').innerText = winner.name;
    document.getElementById('h2h-team-1').innerText = t1.name;
    document.getElementById('h2h-team-2').innerText = t2.name;
    document.getElementById('h2h-final-score').innerText = `${s1} - ${s2}`;
    document.getElementById('h2h-score-note').innerText = penRes
        ? `Penalties: ${penRes.p1} - ${penRes.p2}`
        : 'Decided in normal time';
    showScreen('screen-h2h-result');
    if (typeof SaveGame !== 'undefined' && !Net.online) SaveGame.markFinished();

    // Online Head to Head pays the winner's account. Tokens are written under
    // the winner's own uid, so each device checks its own manager and claims
    // its own reward; the match id makes the claim idempotent across screens.
    if (Net.online && typeof accountAwardTokens === 'function') {
        const mine = (gameState.managers || []).find(m => String(m.id) === String(Net.myManagerId));
        if (mine && winner && winner.name === mine.name) {
            const stamp = sim.matchId || `${sim.s1}-${sim.s2}-${sim.t1?.name || ''}-${sim.t2?.name || ''}`;
            accountAwardTokens(TOKEN_REWARDS.H2H_WIN, `h2h_${Net.roomCode || 'room'}_${stamp}`, 'H2H win');
        }
    }
    const rematch = document.getElementById('h2h-rematch-btn');
    if (rematch) {
        const guest = Net.online && !Net.ownsGame();
        rematch.disabled = guest;
        rematch.classList.toggle('opacity-40', guest);
        rematch.classList.toggle('cursor-not-allowed', guest);
    }
}

function h2hRematch() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host starts a rematch.');
    if (typeof SaveGame !== 'undefined') SaveGame.resetFinished();
    const [m1, m2] = gameState.managers;
    gameState.matchQueue = [{ t1: createTeamState(m1), t2: createTeamState(m2), label: 'H2H' }];
    Net.publishInfo();
    startNextMatch();
}

function triggerConfetti(canvasId = 'confetti-canvas') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const pieces = Array.from({length: 150}, () => ({ x: canvas.width/2, y: canvas.height-50, vx: (Math.random()-0.5)*25, vy: (Math.random()-1.2)*20, size: Math.random()*10+5, color: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7'][Math.floor(Math.random()*5)], rot: Math.random()*360, rotS: (Math.random()-0.5)*10 }));
    function animate() {
        ctx.clearRect(0,0,canvas.width,canvas.height); let act=false;
        pieces.forEach(p => {
            p.x+=p.vx; p.y+=p.vy; p.vy+=0.4; p.rot+=p.rotS;
            if(p.y<canvas.height) act=true;
            ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180); ctx.fillStyle=p.color; ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size); ctx.restore();
        });
        if(act) requestAnimationFrame(animate);
    }
    animate();
}
