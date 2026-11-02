
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
    const loss = positionPenaltyPct(player.mainPos, targetPos);
    return Math.max(1, Math.round(player.rating * (1 - loss)));
}


function positionPenaltyPct(from, to) {
    if (from === to) return 0;
    const override = OUT_OF_POS_OVERRIDES[`${from}>${to}`];
    if (override != null) return override;
    const a = POSITION_META[from], b = POSITION_META[to];
    if (!a || !b) return 0.3;
    const unitGap = Math.abs(a.unit - b.unit);
    if (unitGap >= 2) {
        if (a.channel !== 'C' && b.channel !== 'C') {
            return a.channel === b.channel ? 0.13 : 0.18;
        }
        return 0.25;
    }
    let pct = unitGap * 0.06 + Math.abs(a.depth - b.depth) * 0.04;
    if (a.channel !== b.channel) pct += (a.channel === 'C' || b.channel === 'C') ? 0.03 : 0.04;
    if (unitGap === 0) pct = Math.max(0.03, pct);
    return Math.min(0.25, pct);
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
    const lineup = m.formation
        .filter(node => node.assignedPlayerId)
        .map(node => ({ player: m.squad.find(player => player.id === node.assignedPlayerId), pos: node.pos, yel: 0 }))
        .filter(slot => slot.player);
    const bench = m.bench
        .filter(slot => slot.assignedPlayerId)
        .map(slot => m.squad.find(player => player.id === slot.assignedPlayerId))
        .filter(Boolean);
    const assignedIds = new Set([...lineup, ...bench].map(slot => slot.player ? slot.player.id : slot.id));
    const reserves = m.squad.filter(player => !assignedIds.has(player.id));
    return { id: m.id, name: m.name, lineup, bench, reserves, subs: 0, tactics: m.tactics || { mentality: 'balanced', press: 'mid' } };
}

function getStrength(team) {
    const valid = (team.lineup || []).filter(slot => slot && slot.player);
    if (!valid.length) return 0;
    const chemistry = team.isGhost === true ? new Map() : getLineupChemistry(valid);
    const chemistryBonus = valid.reduce((sum, slot) => sum + (chemistry.get(slot.player.id) || 0), 0);
    const averageOVR = (valid.reduce((sum, slot) => sum + getDynamicOVR(slot.player, slot.pos), 0) + chemistryBonus) / valid.length;
    const missingPlayersPenalty = Math.max(0, STARTERS - valid.length) * 3.5;
    return averageOVR - missingPlayersPenalty;
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

function getGoal(t) {
    const scorerEntries = t.lineup
        .filter(l => l.player && l.pos !== 'GK' && l.player.mainPos !== 'GK')
        .map(l => {
            const p = l.player, st = p.stats || {};
            const sho = st.SHO ?? p.rating ?? 70;
            const pac = st.PAC ?? 70;
            const dri = st.DRI ?? 70;
            const pos = l.pos || p.mainPos;
            const role = SCORER_ROLE[pos] ?? 0.6;
            const finish = Math.pow(Math.max(40, sho) / 100, 1.55);
            const mobility = 0.14 * (pac / 100) + 0.12 * (dri / 100);
            const starBias = Math.pow(Math.max(55, p.rating ?? 70) / 100, 1.1);
            return { item: p, weight: role * (finish * 0.72 + mobility * 0.28) * starBias * 100 };
        });

    const scorer = weightedPick(scorerEntries) || { name: 'Own Goal', team: 'Unknown', id: -1, stats: {} };
    const outfield = t.lineup.filter(slot =>
        slot.player && slot.player.id !== scorer.id && slot.pos !== 'GK' && slot.player.mainPos !== 'GK'
    );
    const avgPassing = outfield.length
        ? outfield.reduce((sum, slot) => sum + (slot.player.stats?.PAS ?? slot.player.rating ?? 70), 0) / outfield.length
        : 70;
    // Stronger teams complete more assisted goals; still leave room for solo efforts
    const assistChance = clamp(0.58 + ((avgPassing - 72) / 100) * 0.5, 0.48, 0.88);

    let assister = null;
    if (outfield.length && Math.random() < assistChance) {
        const assistEntries = outfield.map(slot => {
            const player = slot.player;
            const stats = player.stats || {};
            const passing = stats.PAS ?? player.rating ?? 70;
            const dribbling = stats.DRI ?? 70;
            const position = slot.pos || player.mainPos;
            const role = ASSIST_ROLE[position] ?? 0.7;
            const vision = Math.pow(Math.max(40, passing) / 100, 1.45);
            const carry = 0.16 * (dribbling / 100);
            const starBias = Math.pow(Math.max(55, player.rating ?? 70) / 100, 1.08);
            return { item: player, weight: role * (vision + carry) * starBias * 100 };
        });
        const selectedAssister = weightedPick(assistEntries);
        if (selectedAssister) assister = selectedAssister;
    }
    return {
        scorer: scorer.name,
        scorerId: scorer.id,
        assister: assister?.name || null,
        assisterId: assister?.id ?? null
    };
}

// --- Match-day tactics, ratings and substitutions ---

let matchTactics = { mentality: 'balanced', press: 'mid' };
let matchRatingsOpen = false;
let htSelection = null;

function getTacticsMultipliers() {
    return getTacticsMultipliersFor(matchTactics);
}

function pctLabel(value) {
    const pct = Math.round((value - 1) * 100);
    return `${pct > 0 ? '+' : ''}${pct}%`;
}

function renderTacticsOptions() {
    document.getElementById('mentality-options').innerHTML = Object.entries(TACTICS_MENTALITY).map(([key, opt]) => {
        const active = matchTactics.mentality === key;
        return `<button type="button" onclick="setTacticsOption('mentality', '${key}')" class="py-2 rounded-lg text-sm font-bold border transition ${active ? 'border-green-400 bg-green-500 text-slate-900' : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400'}">${opt.label}</button>`;
    }).join('');
    document.getElementById('press-options').innerHTML = Object.entries(TACTICS_PRESS).map(([key, opt]) => {
        const active = matchTactics.press === key;
        return `<button type="button" onclick="setTacticsOption('press', '${key}')" class="py-2 rounded-lg text-sm font-bold border transition ${active ? 'border-green-400 bg-green-500 text-slate-900' : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-400'}">${opt.label}</button>`;
    }).join('');
    updateTacticsSummary();
}

function setTacticsOption(kind, key) {
    if (kind === 'mentality') matchTactics.mentality = key;
    else if (kind === 'press') matchTactics.press = key;
    renderTacticsOptions();
}

function updateTacticsSummary() {
    const mul = getTacticsMultipliers();
    document.getElementById('tactics-summary').innerHTML = `
        <div class="flex justify-between"><span>Chance creation</span><span class="font-bold ${mul.attack >= 1 ? 'text-green-400' : 'text-red-400'}">${pctLabel(mul.attack)}</span></div>
        <div class="flex justify-between"><span>Goals conceded risk</span><span class="font-bold ${mul.concede <= 1 ? 'text-green-400' : 'text-red-400'}">${pctLabel(mul.concede)}</span></div>
        <div class="flex justify-between"><span>Card risk</span><span class="font-bold ${mul.card <= 1 ? 'text-green-400' : 'text-red-400'}">${pctLabel(mul.card)}</span></div>
        ${matchTactics.press === 'high' ? '<div class="text-[10px] text-amber-400 pt-1">High press fades after 70 minutes as legs tire.</div>' : ''}`;
}

function confirmTactics() {
    const modal = document.getElementById('tactics-modal'), panel = document.getElementById('tactics-panel');
    modal.classList.add('opacity-0'); panel.classList.add('scale-95');
    setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 200);

    if (pendingTacticsManagerId !== null) {
        const mId = pendingTacticsManagerId;
        pendingTacticsManagerId = null;
        const m = gameState.managers.find(x => x.id === mId);
        m.tactics = { mentality: matchTactics.mentality, press: matchTactics.press };

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
    }
}

function createMatchRatings(sim) {
    const map = {};
    [sim.t1, sim.t2].forEach((team, index) => {
        (team.lineup || []).forEach(slot => {
            if (!slot || !slot.player) return;
            const actions = drawRatingActions(slot.pos);
            map[slot.player.id] = { player: slot.player, team: index + 1, pos: slot.pos, goals: 0, assists: 0, yellow: 0, red: 0, played: true, perf: rollPerformance(slot.player), defActions: actions.defActions, keyPasses: actions.keyPasses };
        });
    });
    return map;
}

function ensureRatingEntry(sim, player, teamNo, pos) {
    if (!sim.ratings[player.id]) {
        const slotPos = pos || player.mainPos;
        const actions = drawRatingActions(slotPos);
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

function toggleMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        if (gameState.matchSim) renderMatchRatings(gameState.matchSim);
        modal.classList.remove('hidden'); modal.classList.add('flex');
        setTimeout(() => { modal.classList.remove('opacity-0'); document.getElementById('ratings-panel').classList.remove('scale-95'); }, 10);
        matchRatingsOpen = true;
    } else {
        closeMatchRatings();
    }
}

function closeMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    matchRatingsOpen = false;
    modal.classList.add('opacity-0');
    document.getElementById('ratings-panel').classList.add('scale-95');
    setTimeout(() => { modal.classList.remove('flex'); modal.classList.add('hidden'); }, 200);
}

function forceCloseMatchRatings() {
    const modal = document.getElementById('ratings-modal');
    if (!modal) return;
    matchRatingsOpen = false;
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
        ratings: {},
        htSubs: [],
        penRes: null,
        penLine: null,
        penStarted: false,
        stats: null,
        finished: false,
        injuryExtraMinutes: 0,   // accumulated from player subs → real added time
        pendingStoppageSubs: [], // subs made in current window (for timeline)
        timelineTimer: null,
        broadcastLog: [],        // every simulated minute, mirrored to remote devices
        onSubModalClose: null
    };
    sim.ratings = createMatchRatings(sim);
    gameState.matchSim = sim;

    // Live first half → HT dead-ball window → second half → (ET/pens if needed)
    runLivePeriod(sim, 1, 45, false, () => {
        appendTimelineLabel('HALF TIME');
        const htClock = document.getElementById('match-live-time');
        if (htClock) htClock.innerText = 'HT';
        openSubstitutionModal(sim, {
            title: 'Half Time',
            subtitle: 'Make substitutions, then continue.',
            continueLabel: 'Start Second Half',
            forceOpen: true,
            onContinue: () => {
                runLivePeriod(sim, 46, 90, false, () => {
                    finishOrExtraTime(sim);
                });
            }
        });
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

    appendTimelineLabel('EXTRA TIME');
    if (clock) clock.innerText = 'ET';
    runLivePeriod(sim, 91, 105, true, () => {
        appendTimelineLabel('HALF TIME (ET)');
        openSubstitutionModal(sim, {
            title: 'Half Time (ET)',
            subtitle: 'Extra-time substitutions.',
            continueLabel: 'Continue Extra Time',
            forceOpen: true,
            onContinue: () => {
                runLivePeriod(sim, 106, 120, true, () => {
                    appendTimelineLabel('END OF EXTRA TIME');
                    if (sim.s1 !== sim.s2) {
                        setTimeout(() => finishMatchSimulation(sim), matchDelay(600));
                    } else {
                        appendTimelineLabel('PENALTY SHOOTOUT');
                        if (clock) clock.innerText = 'PEN';
                        startPenaltyShootout(sim);
                    }
                });
            }
        });
    });
}

function getTacticsMultipliersFor(tactics) {
    if (!tactics) tactics = { mentality: 'balanced', press: 'mid' };
    const mentality = TACTICS_MENTALITY[tactics.mentality] || TACTICS_MENTALITY.balanced;
    const press = TACTICS_PRESS[tactics.press] || TACTICS_PRESS.mid;
    return { attack: mentality.attack * press.attack, concede: mentality.concede * press.concede, card: press.card, pressKey: tactics.press || 'mid' };
}

/** Simulate + display a period minute-by-minute so subs can pause on dead balls. */
function simulateMinute(sim, displayTime, isOT) {
    const { t1, t2 } = sim;
    sim.minuteCount++;
    const events = [];
    const strengthDifference = getStrength(t1) - getStrength(t2);
    const goalChancePerMinute = 0.042;
    const shareForTeam1 = clamp(0.5 + strengthDifference * 0.012, 0.22, 0.78);

    const mul1 = getTacticsMultipliersFor(t1.tactics);
    const mul2 = getTacticsMultipliersFor(t2.tactics);

    let attackMult1 = mul1.attack;
    let concedeMult1 = mul1.concede;
    if (mul1.pressKey === 'high' && sim.minuteCount > 70) attackMult1 *= 0.86;
    if (mul1.pressKey === 'low' && sim.minuteCount > 70) concedeMult1 *= 0.94;

    let attackMult2 = mul2.attack;
    let concedeMult2 = mul2.concede;
    if (mul2.pressKey === 'high' && sim.minuteCount > 70) attackMult2 *= 0.86;
    if (mul2.pressKey === 'low' && sim.minuteCount > 70) concedeMult2 *= 0.94;

    let chance1 = Math.max(0.005, goalChancePerMinute * shareForTeam1 * attackMult1 * concedeMult2);
    let chance2 = Math.max(0.005, goalChancePerMinute * (1 - shareForTeam1) * attackMult2 * concedeMult1);

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
        events.push({ type: 'goal', t: 1, ...getGoal(t1) });
    } else if (roll < chance1 + chance2) {
        sim.s2++; sim.lastGoalMinute = sim.minuteCount;
        events.push({ type: 'goal', t: 2, ...getGoal(t2) });
    } else {
        if (Math.random() < (isOT ? 0.005 : 0.015)) {
            const cardShare1 = mul1.card / (mul1.card + mul2.card);
            let tn = Math.random() < cardShare1 ? 1 : 2;
            const tm = tn === 1 ? t1 : t2;
            const p = pickRand(tm.lineup.filter(l => l.pos !== 'GK' && l.player));
            if (p) {
                p.yel++;
                if (p.yel >= 2) {
                    tm.lineup = tm.lineup.filter(x => x !== p);
                    events.push({ type: 'red', t: tn, name: p.player.name, id: p.player.id });
                } else {
                    events.push({ type: 'yellow', t: tn, name: p.player.name, id: p.player.id });
                }
            }
        }

        // Auto-subs for both teams based on tactics/calculated approach
        [1, 2].forEach(tn => {
            const tm = tn === 1 ? t1 : t2;
            if (sim.minuteCount > 55 && Math.random() < 0.035) {
                if ((tm.subs || 0) < MAX_SUBS && tm.bench && tm.bench.length) {
                    const outC = tm.lineup.filter(l => l.pos !== 'GK');
                    const inC = tm.bench.filter(p => p.mainPos !== 'GK');
                    if (outC.length && inC.length) {
                        outC.sort((a, b) => getDynamicOVR(a.player, a.pos) - getDynamicOVR(b.player, b.pos));
                        let bestOut = null; let bestIn = null; let bestGain = -999;
                        for (let o of outC) {
                            for (let i of inC) {
                                const gain = (getDynamicOVR(i, o.pos) + (sim.minuteCount > 75 ? 3 : 1)) - getDynamicOVR(o.player, o.pos);
                                if (gain > bestGain) { bestGain = gain; bestOut = o; bestIn = i; }
                            }
                        }
                        if (!bestOut || !bestIn) { bestOut = pickRand(outC); bestIn = pickRand(inC); }
                        if (bestOut && bestIn) {
                            const outName = bestOut.player.name;
                            tm.bench = tm.bench.filter(x => x.id !== bestIn.id);
                            bestOut.player = bestIn; bestOut.yel = 0;
                            tm.subs = (tm.subs || 0) + 1;
                            ensureRatingEntry(sim, bestIn, tn, bestOut.pos);
                            events.push({ type: 'sub', t: tn, inName: bestIn.name, outName, id: bestIn.id });
                            sim.injuryExtraMinutes = (sim.injuryExtraMinutes || 0) + 0.5 + Math.random() * 0.5;
                        }
                    }
                }
            }
        });
    }
    return { displayTime, events };
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

        // Pause if a sub window is open
        if (sim.subModalOpen) {
            scheduleNext(200);
            return;
        }

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

    step.events.forEach(e => {
        const isL = e.t === 1;
        let cHtml = '';
        applyViewEvent(sim, e);

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
        } else if (e.type === 'sub') {
            cHtml = `<div class="timeline-card py-1 px-3 bg-slate-50 border border-slate-200 flex items-center gap-1.5 w-auto max-w-[70%]">
                <span class="text-[9px] font-black text-slate-500 shrink-0">SUB</span>
                <span class="text-[10px] font-bold text-emerald-700 truncate">${escapeHTML(e.inName)}</span>
                <span class="text-[9px] text-slate-400 shrink-0">⇄</span>
                <span class="text-[10px] font-bold text-red-600 line-through truncate">${escapeHTML(e.outName)}</span>
            </div>`;
        }

        if (cHtml && tl) {
            const isAddedTime = step.displayTime.includes('+');
            const row = document.createElement('div');
            row.className = `timeline-event ${isL ? 'left-side' : 'right-side'}`;
            row.innerHTML = `
                ${isL ? cHtml : '<div class="w-1/2"></div>'}
                <div class="timeline-time-bubble ${isAddedTime ? 'time-injury' : ''}">${step.displayTime.replace("'", "")}</div>
                ${!isL ? cHtml : '<div class="w-1/2"></div>'}
            `;
            tl.appendChild(row);
            if (tl.parentElement) tl.parentElement.scrollTop = tl.parentElement.scrollHeight;
        }
    });
}

function openSubstitutionModal(sim, opts = {}) {
    if (!opts.forceOpen) {
        if (opts.onContinue) opts.onContinue();
        return;
    }
    // Instant speed resolves the match without stopping at half-time windows.
    if (matchSpeed === 'instant') {
        if (typeof opts.onContinue === 'function') setTimeout(opts.onContinue, 0);
        return;
    }
    sim.subModalOpen = true;
    sim.onSubModalClose = opts.onContinue || null;

    // Online: the away club's manager decides on their own device.
    if (Net.online && Net.isHost && !Net.canControl(sim.t1.id)) {
        Online.askRemoteHalfTime(sim, opts);
        return;
    }

    htSelection = null;
    sim.pendingSwap = null; // { outIndex, inIndex, outName, inName }

    // Reuse ht-score line as status (no match result)
    const scoreEl = document.getElementById('ht-score');
    if (scoreEl) {
        scoreEl.innerText = opts.subtitle || 'Tap pitch player → then bench player';
        scoreEl.classList.add('text-slate-400', 'text-xs');
        scoreEl.classList.remove('text-sm');
    }
    // Try to set modal heading without showing the scoreline
    const panel = document.getElementById('ht-panel');
    if (panel) {
        const heading = panel.querySelector('h2, h3, .ht-heading');
        if (heading) heading.innerText = opts.title || 'Substitution';
    }

    const contBtn = document.querySelector('#ht-modal button[onclick*="startSecondHalf"], #ht-continue, button[onclick*="startSecondHalfFromModal"]');
    if (contBtn) contBtn.innerText = opts.continueLabel || 'Resume Match';

    document.getElementById('ht-subs-left').innerText = `Subs left: ${Math.max(0, MAX_SUBS - (sim.t1.subs || 0))}`;
    renderHalfTimeLists(sim);

    // Swap preview lives in the compact HT panel markup
    updateSwapPreview(sim);

    const modal = document.getElementById('ht-modal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            if (panel) panel.classList.remove('scale-95');
        }, 10);
    }
}

function updateSwapPreview(sim) {
    const preview = document.getElementById('ht-swap-preview');
    if (!preview) return;
    if (htSelection == null) {
        preview.innerHTML = `<p class="text-xs text-slate-500 text-center leading-tight">Tap pitch player → then bench player</p>`;
        return;
    }
    const out = sim.t1.lineup[htSelection];
    if (!out) { preview.innerHTML = ''; return; }
    preview.innerHTML = `
        <div class="flex items-center justify-center gap-2 text-xs font-bold">
            <span class="px-2 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 truncate max-w-[44%]">↓ ${escapeHTML(out.player.name)}</span>
            <span class="text-slate-400">⇄</span>
            <span class="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300/80 border border-emerald-500/30 border-dashed truncate max-w-[44%]">↑ Pick bench</span>
        </div>`;
}

function renderHalfTimeLists(sim) {
    const lineupEl = document.getElementById('ht-lineup');
    const benchEl = document.getElementById('ht-bench');
    if (!lineupEl || !benchEl) return;

    lineupEl.innerHTML = sim.t1.lineup.map((slot, index) => {
        const selected = htSelection === index;
        const fit = getDynamicOVR(slot.player, slot.pos);
        return `<button type="button" onclick="selectHalfTimePlayer(${index})" class="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded border text-left transition ${selected ? 'border-red-400 bg-red-500/20 ring-1 ring-red-400/50' : 'border-slate-700 bg-slate-900 hover:border-slate-500'}">
            <span class="flex items-center gap-1 min-w-0">
                ${selected ? '<span class="text-red-400 shrink-0 text-xs" title="Coming off">↓</span>' : ''}
                <span class="text-xs font-bold text-white truncate leading-tight">${escapeHTML(slot.player.name)}</span>
            </span>
            <span class="text-[10px] font-black text-slate-400 shrink-0">${slot.pos} · ${Math.min(100, Math.round(fit))}</span>
        </button>`;
    }).join('');

    benchEl.innerHTML = sim.t1.bench.length ? sim.t1.bench.map((player, index) => {
        const canClick = htSelection != null;
        return `<button type="button" onclick="subOnHalfTime(${index})" class="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded border text-left transition ${canClick ? 'border-slate-700 bg-slate-900 hover:border-emerald-400' : 'border-slate-800 bg-slate-900/60 opacity-70'}">
            <span class="flex items-center gap-1 min-w-0">
                ${canClick ? '<span class="text-emerald-400 shrink-0 text-xs">↑</span>' : ''}
                <span class="text-xs font-bold text-white truncate leading-tight">${escapeHTML(player.name)}</span>
            </span>
            <span class="text-[10px] font-black ${player.mainPos === 'GK' ? 'text-yellow-400' : 'text-slate-400'} shrink-0">${player.mainPos} · ${Math.min(100, player.rating)}</span>
        </button>`;
    }).join('') : '<p class="text-xs text-slate-500 italic py-1">Bench is empty.</p>';

    updateSwapPreview(sim);
}

function selectHalfTimePlayer(index) {
    htSelection = htSelection === index ? null : index;
    if (gameState.matchSim) renderHalfTimeLists(gameState.matchSim);
}

function subOnHalfTime(benchIndex) {
    const sim = gameState.matchSim;
    if (!sim) return;
    if (htSelection == null) return showToast('Select a player on the pitch first.');
    if ((sim.t1.subs || 0) >= MAX_SUBS) return showToast('No substitutions left.');
    if (!applyHalfTimeSwap(sim, htSelection, benchIndex)) return;
    htSelection = null;
    const subsLeft = document.getElementById('ht-subs-left');
    if (subsLeft) subsLeft.innerText = `Subs left: ${Math.max(0, MAX_SUBS - sim.t1.subs)}`;
    renderHalfTimeLists(sim);
}

// One substitution on the simulated side, shared by the local modal and by a
// remote manager's decision relayed through the host.
function applyHalfTimeSwap(sim, outIndex, benchIndex) {
    const slot = sim.t1.lineup[outIndex];
    const incoming = sim.t1.bench[benchIndex];
    if (!slot || !incoming) return false;
    if ((sim.t1.subs || 0) >= MAX_SUBS) return false;

    const outgoing = slot.player;
    sim.t1.bench.splice(benchIndex, 1); // substituted players cannot return
    sim.t1.lineup[outIndex] = { player: incoming, pos: slot.pos, yel: 0 };
    sim.t1.subs = (sim.t1.subs || 0) + 1;
    ensureRatingEntry(sim, incoming, 1, slot.pos);

    // Each human sub adds real injury time (~30–60s → rounded into extra minutes)
    sim.injuryExtraMinutes = (sim.injuryExtraMinutes || 0) + 0.5 + Math.random() * 0.5;

    const subEvent = { type: 'sub', t: 1, inName: incoming.name, outName: outgoing.name };
    sim.htSubs.push(subEvent);
    // Show on timeline immediately when subbing mid-match
    const clock = document.getElementById('match-live-time');
    displayTimelineStep({ displayTime: (clock && clock.innerText) || "SUB", events: [subEvent] }, sim);
    showToast(`${incoming.name} ⇄ ${outgoing.name}`);
    return true;
}

function startSecondHalfFromModal() {
    if (Online.finishHt()) return;
    closeSubstitutionModal(true);
}

function closeSubstitutionModal(runContinue) {
    const sim = gameState.matchSim;
    if (Net.online && Net.isHost) {
        Online.clearHtWait();
        Net.publishLock(null);
    }
    const modal = document.getElementById('ht-modal');
    const panel = document.getElementById('ht-panel');
    if (modal) {
        modal.classList.add('opacity-0');
        if (panel) panel.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }, 200);
    }
    if (sim) {
        sim.subModalOpen = false;
        const cb = sim.onSubModalClose;
        sim.onSubModalClose = null;
        if (runContinue && typeof cb === 'function') {
            setTimeout(cb, matchDelay(250));
        }
    }
}

// ============================================================
// PENALTY SHOOTOUT
// ============================================================

function startPenaltyShootout(sim) {
    const board = document.getElementById('pen-board');
    const teams = [sim.t1, sim.t2];

    const takersFor = team => {
        const slots = (team.lineup || []).filter(l => l && l.player);
        const outfield = slots.filter(l => l.pos !== 'GK').map(l => l.player)
            .sort((a, b) => ((b.stats && b.stats.SHO) || 0) - ((a.stats && a.stats.SHO) || 0));
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
        return Math.random() < clamp(0.76 + (shooting - 75) * 0.004 - (keeping - 75) * 0.0025, 0.5, 0.93);
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

function finishMatchSimulation(sim) {
    if (sim.finished) return; // never record a result twice
    sim.finished = true;
    clearTimeout(sim.timelineTimer);
    finishVisuals(sim);
}


function finishVisuals(sim) {
    const { t1, t2, s1, s2, penRes } = sim;
    
    document.getElementById('match-actions').classList.remove('hidden');
    
    const str1 = getStrength(t1) || 70;
    const str2 = getStrength(t2) || 70;
    const strRatio = str1 / (str1 + str2);
    let poss1 = Math.round(strRatio * 100 + (Math.random() * 16 - 8));
    poss1 = Math.max(30, Math.min(70, poss1));
    const totShots = 8 + Math.floor(Math.random() * 14) + s1 + s2;
    let t1S = Math.round(totShots * (poss1 / 100) + (s1 - s2) * 0.8 + (Math.random() * 3 - 1.5));
    t1S = Math.max(1, Math.min(totShots - 1, t1S));
    const t2S = totShots - t1S;

    const statBars = `
        <div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${poss1}%</span><span>POSSESSION</span><span>${100 - poss1}%</span></div>
        <div class="w-full bg-slate-200 h-2 rounded flex overflow-hidden mb-3"><div class="bg-blue-500 h-full" style="width:${poss1}%"></div><div class="bg-red-500 h-full" style="width:${100 - poss1}%"></div></div>
        <div class="flex justify-between text-xs font-bold text-slate-500 mb-1"><span>${t1S}</span><span>SHOTS</span><span>${t2S}</span></div>
        <div class="w-full bg-slate-200 h-2 rounded flex overflow-hidden"><div class="bg-blue-500 h-full" style="width:${(t1S / totShots) * 100}%"></div><div class="bg-red-500 h-full" style="width:${(t2S / totShots) * 100}%"></div></div>
    `;
    document.getElementById('match-stats-bars').innerHTML = statBars;
    document.getElementById('match-stats-container').classList.remove('hidden');

    const onTarget1 = Math.max(s1, Math.round(t1S * (0.34 + Math.random() * 0.16)));
    const onTarget2 = Math.max(s2, Math.round(t2S * (0.34 + Math.random() * 0.16)));
    sim.gkSaves = { 1: Math.max(0, onTarget2 - s2), 2: Math.max(0, onTarget1 - s1) };

    const actualS1 = penRes ? s1 + penRes.p1 : s1;
    const actualS2 = penRes ? s2 + penRes.p2 : s2;
    if (actualS1 > actualS2) triggerConfetti();

    sim.stats = { poss1, t1S, t2S, onTarget1, onTarget2 };
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
        showScreen('screen-main');
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
}

function h2hRematch() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host starts a rematch.');
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
