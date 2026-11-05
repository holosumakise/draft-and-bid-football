// ============================================================
// LEAGUE · SEASON (Tournament mode only)
// ============================================================
function isGhostStat(st) { return !gameState.managers.some(m => m.id === st.teamId); }
function ghostAwardFactor(st) { return isGhostStat(st) ? GHOST_AWARD_FACTOR : 1; }


function avgPoolOVRByPos() {
    const buckets = {};
    availablePlayers.forEach(p => {
        if (!buckets[p.mainPos]) buckets[p.mainPos] = [];
        buckets[p.mainPos].push(p.rating);
    });
    gameState.managers.forEach(m => m.squad.forEach(p => {
        if (!buckets[p.mainPos]) buckets[p.mainPos] = [];
        buckets[p.mainPos].push(p.rating);
    }));
    const avg = {};
    Object.keys(POS_WEIGHTS).forEach(pos => {
        const arr = buckets[pos] || [72];
        avg[pos] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    });
    return avg;
}


function makeGhostPlayer(pos, ovr, club, idx) {
    const fi = Math.abs((idx * 17 + pos.charCodeAt(0) * 3) % GHOST_FIRST.length);
    const li = Math.abs((idx * 31 + (club || '').length * 7) % GHOST_LAST.length);
    const name = `${GHOST_FIRST[fi]} ${GHOST_LAST[li]}`;
    // Ghost roles come from the name and the club's own rating ladder — the same
    // player is the same player on every machine — and the armband still only
    // lands on the best man in the side.
    const archetype = archetypeForName(pos, name);
    const playstyle = playstyleForName(pos, name, (ovr - 68) / 17);
    return {
        id: 90000 + idx, name, rating: ovr, displayOVR: String(Math.min(99, ovr)),
        rank: null, stats: buildRoleStats(ovr, pos, archetype, playstyle),
        mainPos: pos, archetype, playstyle,
        subPos: [], team: club, nationality: 'World'
    };
}

// A drafted club keeps its armbands behind a rating gate, because there the band is
// the player's standing among the greats of the game. A generated club sits a whole
// ladder below that board, so its leaders are elected inside the squad instead: the
// best man wears it, his deputy wears the other one, at about the rates the drafted
// board itself shows. The roll comes from the club's name, so the same side is the
// same side on every machine.
function electGhostLeaders(lineup, clubName) {
    const ranked = lineup.slice().sort((a, b) => b.player.rating - a.player.rating ||
        playstyleHash(b.player.name) - playstyleHash(a.player.name));
    const captain = ranked[0];
    if (captain && playstyleHash(`${clubName}|armband`) % 100 < 65) {
        captain.player.playstyle = 'Odin';
        refreshRoleStats(captain.player);
    }
    const deputy = ranked[1];
    if (deputy && playstyleHash(`${clubName}|deputy`) % 100 < 40) {
        deputy.player.playstyle = 'Apollo';
        refreshRoleStats(deputy.player);
    }
}

function buildGhostTeam(clubName, avgByPos, seed, strengthOffset = -4, tierBiasOverride = null) {
    const shape = [
        { pos: 'GK' },
        { pos: 'LB' }, { pos: 'CB' }, { pos: 'CB' }, { pos: 'RB' },
        { pos: 'CM' }, { pos: 'CDM' }, { pos: 'CM' },
        { pos: 'LW' }, { pos: 'ST' }, { pos: 'RW' }
    ];
    // Early seeds lean top-half; later seeds lean relegation scrap
    const tierBias = tierBiasOverride != null ? tierBiasOverride : clamp(6 - Math.floor((seed - 1) * 0.55), -5, 6);
    const lineup = shape.map((slot, index) => {
        const clubBias = ((seed * 17 + index * 3) % 9) - 4;
        const base = (avgByPos[slot.pos] || 75) + clubBias + strengthOffset + tierBias;
        const ovr = clamp(base + Math.round((Math.random() * 5) - 2), 56, 96);
        const player = makeGhostPlayer(slot.pos, ovr, clubName, seed * 20 + index);
        return { player, pos: slot.pos, yel: 0 };
    });
    electGhostLeaders(lineup, clubName);
    const benchPositions = ['GK', 'CB', 'LB', 'CM', 'CDM', 'ST'];
    const bench = benchPositions.map((pos, index) => {
        const benchOffset = strengthOffset - 2 + Math.floor(tierBias * 0.5);
        const base = (avgByPos[pos] || 75) + benchOffset + ((seed * 11 + index * 5) % 7) - 3;
        const ovr = clamp(base + Math.round((Math.random() * 5) - 2), 53, 92);
        return makeGhostPlayer(pos, ovr, clubName, seed * 20 + 11 + index);
    });

    return {
        id: 1000 + seed, name: clubName, isGhost: true, lineup, bench, reserves: [], subs: 0
    };
}

function initSeasonPlayerStats(manager) {
    const map = {};
    manager.squad.forEach(p => {
        map[p.id] = {
            id: p.id, name: p.name, team: manager.name, teamId: manager.id, mainPos: p.mainPos,
            goals: 0, assists: 0, cleanSheets: 0, apps: 0, minutes: 0,
            yellows: 0, reds: 0, ratingSum: 0, ratingCount: 0, goalsConcededAsGK: 0
        };
    });
    return map;
}

function initGhostTeamStats(team) {
    const map = {};
    [...(team.lineup || []).map(slot => slot.player), ...(team.bench || []), ...(team.reserves || [])]
        .filter(Boolean)
        .forEach(player => {
            map[player.id] = {
                id: player.id, name: player.name, team: team.name, teamId: team.id, mainPos: player.mainPos,
                goals: 0, assists: 0, cleanSheets: 0, apps: 0, minutes: 0,
                yellows: 0, reds: 0, ratingSum: 0, ratingCount: 0, goalsConcededAsGK: 0
            };
        });
    return map;
}

function ratingRole(pos) {
    if (pos === 'GK') return 'GK';
    if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
    if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
    return 'ATT';
}

function samplePoisson(lambda) {
    const limit = Math.exp(-Math.max(0, lambda));
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > limit && k < 24);
    return k - 1;
}

// The role sets how much of the unglamorous work a player is asked for: a
// destroyer wins balls all afternoon, a poacher hardly tracks back.
function drawRatingActions(pos, player) {
    const mean = RATING_ACTION_MEAN[pos] || RATING_ACTION_MEAN.CM;
    const work = archetypeWeights(player).workload;
    const habit = playstyleWeights(player).workload;
    return {
        defActions: samplePoisson(mean.def * work.def * habit.def),
        keyPasses: samplePoisson(mean.key * work.key * habit.key)
    };
}

function rollPerformance(player) {
    const stats = player.stats || {};
    const raw = key => (typeof stats[key] === 'number' ? stats[key] : player.rating);
    const pos = player.mainPos;
    const role = ratingRole(pos);
    let base;
    if (role === 'GK') {
        base = (raw('DEF') - 72) * 0.008 + (raw('PAS') - 72) * 0.004;
    } else if (role === 'DEF') {
        base = (raw('DEF') - 72) * 0.009 + (raw('PHY') - 72) * 0.004 + (raw('PAS') - 72) * 0.003;
    } else if (role === 'MID') {
        base = (raw('PAS') - 72) * 0.007 + (raw('DRI') - 72) * 0.005 + (raw('DEF') - 72) * 0.003;
    } else {
        base = (raw('SHO') - 72) * 0.007 + (raw('DRI') - 72) * 0.005 + (raw('PAC') - 72) * 0.003;
    }
    // Every role's attribute spread is rescaled to the same ceiling so no position starts
    // with a systematically higher or lower performance roll.
    const span = { GK: 0.28, DEF: 0.37, MID: 0.35, ATT: 0.36 }[role];
    const noise = Math.random() * 0.26 - 0.13;
    return clamp(base * (0.36 / span) + noise, -0.45, 0.45);
}

function sofaScoreMatchRating({ goals, assists, isGK, isDEF, cleanSheet, goalsConceded, yellow, red, teamResult, goalDiff = 0, perf = 0, saves = 0, defActions = 0, keyPasses = 0 }) {
    let rating = 6.45;
    if (goals > 0) rating += goals * (isGK ? 1.4 : isDEF ? 1.1 : 1.0);
    if (assists > 0) rating += assists * 0.7;
    if (cleanSheet) rating += isGK ? 0.55 : isDEF ? 0.45 : 0.1;
    if (goalsConceded > 0) {
        if (isGK) rating -= Math.min(0.6, goalsConceded * 0.10);
        else if (isDEF) rating -= Math.min(0.6, goalsConceded * 0.08);
        else rating -= Math.min(0.3, goalsConceded * 0.03);
    }
    if (isGK && saves > 0) rating += Math.min(0.8, saves * 0.10);
    rating += Math.min(0.55, Math.max(0, defActions) * 0.06);
    rating += Math.min(0.3, Math.max(0, keyPasses) * 0.03);
    if (teamResult === 'W') rating += 0.2;
    else if (teamResult === 'L') rating -= 0.2;
    rating += clamp(goalDiff, -4, 4) * 0.04;
    rating += perf;
    if (yellow) rating -= 0.25;
    if (red) rating -= 1.2;
    return clamp(Math.round(rating * 10) / 10, 4.0, 10.0);
}

function selectActiveLineup(team) {
    // Suspended/injured starters are replaced from the bench and reserves for
    // this fixture only. The saved XI on the manager card is left alone.
    const available = typeof fillAvailableTeamSlots === 'function'
        ? fillAvailableTeamSlots(team.lineup, team.bench, team.reserves)
        : { lineup: team.lineup || [] };
    return (available.lineup || [])
        .filter(slot => slot?.player)
        .map(slot => ({ ...slot, yel: 0, cameOn: 0 }));
}

// League matches are not minute-by-minute, so substitutions are planned up front:
// starters sometimes leave early and a bench player inherits the remaining minutes.
// Without this, only the XI ever appears on the season team-stats board.
function planLeagueAppearances(team) {
    const starters = selectActiveLineup(team);
    const bench = (team.bench || [])
        .filter(player => player && (typeof playerIsUnavailable !== 'function' || !playerIsUnavailable(player)))
        .slice();
    // Prefer like-for-like, then same unit, then anyone (never a second GK for an outfield slot).
    const unitOf = pos => {
        if (pos === 'GK') return 'GK';
        if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
        if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
        return 'ATT';
    };
    const pickBench = (pos, used) => {
        const available = bench.filter(p => p && !used.has(p.id));
        if (!available.length) return null;
        const isGkSlot = pos === 'GK';
        const pool = available.filter(p => isGkSlot ? p.mainPos === 'GK' : p.mainPos !== 'GK');
        const candidates = pool.length ? pool : (isGkSlot ? [] : available.filter(p => p.mainPos !== 'GK'));
        if (!candidates.length) return null;
        const samePos = candidates.filter(p => p.mainPos === pos || (p.subPos || []).includes(pos));
        const sameUnit = candidates.filter(p => unitOf(p.mainPos) === unitOf(pos));
        const shortlist = samePos.length ? samePos : (sameUnit.length ? sameUnit : candidates);
        return shortlist[Math.floor(Math.random() * shortlist.length)];
    };

    const usedBench = new Set(starters.map(slot => slot.player.id));
    let subsMade = 0;
    const maxSubs = typeof MAX_SUBS === 'number' ? MAX_SUBS : 5;
    const appearances = [];
    // The medical programme also cuts the chance of an early knock in the
    // abstract league sim, where injuries are represented as early changes.
    const injuryFactor = medicalInjuryFactor(team);

    // Shuffle so the 5-sub cap isn't always eaten by the GK/defenders listed first.
    const order = starters.slice().sort(() => Math.random() - 0.5);
    order.forEach(slot => {
        let minutes = 90;
        let yellow = false;
        let red = false;
        let injury = false;
        // A habit decides how the same body behaves over a season: the enforcer and
        // the hot head collect bookings, the captain and the technician do not.
        const booking = playstyleBookingRateFor(slot.player);
        const cardRoll = Math.random();
        if (cardRoll < 0.012 * booking) {
            red = true;
            minutes = Math.min(minutes, 30 + Math.floor(Math.random() * 40));
        } else if (cardRoll < 0.082 * booking) {
            yellow = true;
        }

        // Planned rotation / injury / tactical change — only if a bench option exists.
        if (!red && subsMade < maxSubs) {
            let subOff = false;
            // Real-football substitution pattern: keepers almost never come off, forwards
            // and midfielders get pulled most. ~3 changes per match on average.
            const unit = unitOf(slot.pos);
            const lateChance  = unit === 'GK' ? 0.005 : unit === 'DEF' ? 0.20 : unit === 'MID' ? 0.30 : 0.36;
            // A fragile body is the one a manager takes off early; an iron man plays on.
            const earlyChance = unit === 'GK' ? 0 : 0.05 * playstyleInjuryRate(slot.player) * injuryFactor;
            if (Math.random() < lateChance) {
                minutes = 58 + Math.floor(Math.random() * 28); // 58–85
                subOff = true;
            } else if (Math.random() < earlyChance) {
                minutes = 40 + Math.floor(Math.random() * 20); // 40–59 (injury / tactical)
                subOff = true;
                injury = true; // an early knock, not a planned rest
            }
            if (subOff) {
                const inn = pickBench(slot.pos, usedBench);
                if (inn) {
                    usedBench.add(inn.id);
                    subsMade++;
                    const rest = Math.max(1, 90 - minutes);
                    appearances.push({
                        player: slot.player, pos: slot.pos, minutes, yellow, red, injury, fromStart: true
                    });
                    appearances.push({
                        player: inn, pos: slot.pos, minutes: rest, yellow: false, red: false, fromStart: false, replaces: slot.player.id
                    });
                    return;
                }
            }
        }

        // Red card: try to replace with a bench player for the rest of the match.
        if (red && subsMade < maxSubs) {
            const inn = pickBench(slot.pos, usedBench);
            if (inn) {
                usedBench.add(inn.id);
                subsMade++;
                const rest = Math.max(1, 90 - minutes);
                appearances.push({
                    player: slot.player, pos: slot.pos, minutes, yellow, red, injury, fromStart: true
                });
                appearances.push({
                    player: inn, pos: slot.pos, minutes: rest, yellow: false, red: false, fromStart: false, replaces: slot.player.id
                });
                return;
            }
        }

        appearances.push({
            player: slot.player, pos: slot.pos, minutes, yellow, red, injury, fromStart: true
        });
    });

    return appearances;
}

function applySideMatchEffects(team, playerStats, goalsAgainst, trackScoring) {
    if (!playerStats) return [];
    const isDefPos = position => ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
    const cleanSheet = goalsAgainst === 0;
    const appearances = planLeagueAppearances(team);
    const events = [];

    // The scoring model names players from the starting XI. If that starter was replaced,
    // roll a minute for the goal/assist: after he left, the credit goes to his substitute.
    const subFor = new Map();
    const starterEntry = new Map();
    appearances.forEach(e => {
        if (e.fromStart) starterEntry.set(e.player.id, e);
        else if (e.replaces != null) subFor.set(e.replaces, e);
    });
    const creditTo = id => {
        const sub = subFor.get(id);
        const st = starterEntry.get(id);
        if (!sub || !st) return id;
        // A Super-Sub is the man a manager sends on for a goal, so the share that
        // lands on him is bigger than the minutes he actually played.
        const share = clamp((90 - st.minutes) / 90 * playstyleEffects(sub.player).sub, 0, 1);
        return Math.random() < share ? sub.player.id : id;
    };
    const goalCredits = trackScoring.goals.map(creditTo);
    const assistCredits = trackScoring.assists.map(creditTo);

    appearances.forEach(entry => {
        const stats = playerStats[entry.player.id];
        if (!stats) return;

        if (entry.red) {
            stats.reds++;
            events.push({ player: entry.player, type: 'suspension' });
        } else if (entry.yellow) {
            stats.yellows++;
            events.push({ player: entry.player, type: 'yellow' });
        }
        // A booking and a knock can happen to the same player in the same match.
        if (!entry.red && entry.injury) events.push({ player: entry.player, type: 'injury' });

        stats.apps++;
        stats.minutes += entry.minutes;
        // Clean sheets only count for players who saw most of the match on a defensive line.
        if (cleanSheet && isDefPos(entry.pos) && entry.minutes >= 45) stats.cleanSheets++;
        if (entry.pos === 'GK') {
            // Scale goals conceded by share of the match for backup keepers.
            stats.goalsConcededAsGK += goalsAgainst * (entry.minutes / 90);
        }

        // Goals/assists go to whoever was on the pitch when they happened (starter or sub).
        const goalsByPlayer = goalCredits.filter(id => id === entry.player.id).length;
        const assistsByPlayer = assistCredits.filter(id => id === entry.player.id).length;
        if (goalsByPlayer) stats.goals += goalsByPlayer;
        if (assistsByPlayer) stats.assists += assistsByPlayer;

        const actions = drawRatingActions(entry.pos, entry.player);
        // Short cameos get a slightly quieter action load so 15-minute runs do not look like full 90s.
        const minuteScale = clamp(entry.minutes / 90, 0.25, 1);
        const rating = sofaScoreMatchRating({
            goals: goalsByPlayer,
            assists: assistsByPlayer,
            isGK: entry.pos === 'GK',
            isDEF: isDefPos(entry.pos) && entry.pos !== 'GK',
            cleanSheet: cleanSheet && entry.minutes >= 45,
            goalsConceded: goalsAgainst,
            yellow: entry.yellow,
            red: entry.red,
            teamResult: trackScoring.result,
            goalDiff: trackScoring.goals.length - goalsAgainst,
            perf: rollPerformance(entry.player) * minuteScale,
            saves: entry.pos === 'GK' ? Math.max(0, Math.round((samplePoisson(4.6) - goalsAgainst) * minuteScale)) : 0,
            defActions: Math.round((actions.defActions || 0) * minuteScale),
            keyPasses: Math.round((actions.keyPasses || 0) * minuteScale)
        });
        stats.ratingSum += Math.max(3, rating);
        stats.ratingCount++;
    });
    return events;
}

// A league match is a big one when both sides are chasing the same prize — the top
// of the table or survival — and they are close enough that the result matters to
// both. That is the only situation a Zeus carrier's nerve is worth anything.
function leagueMatchPressure(teamA, teamB) {
    const run = _seasonRun;
    if (!run || !run.rowsById || !run.table.length) return 0;
    const a = run.rowsById.get(teamA.id);
    const b = run.rowsById.get(teamB.id);
    if (!a || !b || !a._pos || !b._pos) return 0;
    const size = run.table.length;
    const promotionZone = Math.max(4, Math.round(size * 0.25));
    const relegationZone = size - Math.max(3, Math.round(size * 0.2)) + 1;
    const titleRace = a._pos <= promotionZone && b._pos <= promotionZone;
    const survival = a._pos >= relegationZone && b._pos >= relegationZone;
    if (!titleRace && !survival) return 0;
    return Math.abs(a.pts - b.pts) <= 3 ? 1 : 0.5;
}

// Post-match bookkeeping for one club in the abstract league: tick old
// absences, apply this match's cards/knocks, then bank the gate and move the
// fanbase. Ghost clubs have no manager and therefore no wallet or fans.
function settleLeagueTeam(team, result, goalsFor, goalsAgainst, events) {
    if (!team) return;
    const manager = (gameState.managers || []).find(m =>
        String(m.id) === String(team.managerId ?? team.id));
    if (!manager) return;

    if (typeof tickPlayerAbsences === 'function') tickPlayerAbsences(manager.squad);
    const injuries = [];
    const suspensions = [];
    let yellows = 0;
    (events || []).forEach(event => {
        if (!event || !event.player) return;
        if (event.type === 'yellow') { yellows++; return; }
        const player = (manager.squad || []).find(p => p.id === event.player.id);
        if (!player) return;
        if (event.type === 'suspension') {
            const out = markPlayerOut(player, suspensionLengthFor(player), 'suspension');
            suspensions.push({ name: player.name, matches: out ? out.matches : 1 });
        } else if (event.type === 'injury') {
            const out = markPlayerOut(player, injuryLengthFor(player, team), 'injury');
            injuries.push({ name: player.name, matches: out ? out.matches : 1 });
        }
    });

    const finance = awardMatchdayFinance(manager, result, goalsFor, goalsAgainst);
    // Keep a per-match summary for the live panels the season screen shows while
    // the table animates. Ghost clubs never reach this point.
    if (_seasonRun && Array.isArray(_seasonRun.currentReports)) {
        _seasonRun.currentReports.push({
            managerId: manager.id,
            name: manager.name,
            result, goalsFor, goalsAgainst,
            revenue: finance ? finance.revenue : 0,
            fansBefore: finance ? finance.fansBefore : fansOf(manager),
            fansAfter: finance ? finance.fansAfter : fansOf(manager),
            fanDelta: finance ? finance.fanDelta : 0,
            totalRevenue: Number(manager.ticketRevenue) || 0,
            yellows, injuries, suspensions
        });
    }
}

function simulateLeagueMatch(teamA, teamB, statsA, statsB) {
    const originalLineupA = teamA.lineup;
    const originalLineupB = teamB.lineup;
    teamA.lineup = selectActiveLineup(teamA);
    teamB.lineup = selectActiveLineup(teamB);

    try {
        // ATT/MID/DEF edge + home advantage, then the same full match-plan matchup
        // the live engine uses. Home advantage is a small nudge, not a different model.
        const breakdownA = getStrengthBreakdown(teamA, teamB.tactics);
        const breakdownB = getStrengthBreakdown(teamB, teamA.tactics);
        const edge = EngineCore.matchupEdge(breakdownA, breakdownB);
        const expected = EngineCore.expectedGoals({
            edge,
            base: BASE_EXPECTED_GOALS_PER_TEAM,
            coefficient: MATCH_STRENGTH_COEFFICIENT,
            homeAdvantage: LEAGUE_HOME_ADVANTAGE
        });
        const tactics = getTacticsMatchupFor(teamA.tactics, teamB.tactics);
        // Habits ride on top of the plan: an XI that suits its own tactics and the
        // armband on the pitch are worth goals the same way a archetype is.
        const pressure = leagueMatchPressure(teamA, teamB);
        const cohA = archetypeCoherence(teamA, teamB.tactics) * playstyleCoherence(teamA, teamB.tactics);
        const cohB = archetypeCoherence(teamB, teamA.tactics) * playstyleCoherence(teamB, teamA.tactics);
        const nerveA = playstyleClutchBoost(teamA, pressure);
        const nerveB = playstyleClutchBoost(teamB, pressure);
        const lambdaA = clamp(expected.lambdaA * tactics.a.attack * tactics.b.concede * cohA * nerveA, 0.2, 4.0);
        const lambdaB = clamp(expected.lambdaB * tactics.b.attack * tactics.a.concede * cohB * nerveB, 0.2, 4.0);

        let goalsForA = EngineCore.samplePoisson(lambdaA);
        let goalsForB = EngineCore.samplePoisson(lambdaB);
        // Natural Poisson results — no forced late winners (real pro draw rate ≈ 23–26%)
        const resultA = goalsForA > goalsForB ? 'W' : goalsForA === goalsForB ? 'D' : 'L';
        const resultB = goalsForB > goalsForA ? 'W' : goalsForA === goalsForB ? 'D' : 'L';

        const goalIdsA = [], assistIdsA = [];
        for (let index = 0; index < goalsForA; index++) {
            const goal = getGoal(teamA, pickGoalKind(tactics.a, setPieceShareFor(teamA, teamB, tactics.a)));
            if (goal.scorerId >= 0) goalIdsA.push(goal.scorerId);
            if (goal.assisterId != null) assistIdsA.push(goal.assisterId);
        }
        const goalIdsB = [], assistIdsB = [];
        for (let index = 0; index < goalsForB; index++) {
            const goal = getGoal(teamB, pickGoalKind(tactics.b, setPieceShareFor(teamB, teamA, tactics.b)));
            if (goal.scorerId >= 0) goalIdsB.push(goal.scorerId);
            if (goal.assisterId != null) assistIdsB.push(goal.assisterId);
        }

        const eventsA = applySideMatchEffects(teamA, statsA, goalsForB, { goals: goalIdsA, assists: assistIdsA, result: resultA });
        const eventsB = applySideMatchEffects(teamB, statsB, goalsForA, { goals: goalIdsB, assists: assistIdsB, result: resultB });
        settleLeagueTeam(teamA, resultA, goalsForA, goalsForB, eventsA);
        settleLeagueTeam(teamB, resultB, goalsForB, goalsForA, eventsB);
        return { gf: goalsForA, ga: goalsForB, result: resultA };
    } finally {
        teamA.lineup = originalLineupA;
        teamB.lineup = originalLineupB;
    }
}

function sortLeagueTable(rows) {
    return rows.slice().sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.name.localeCompare(b.name);
    });
}

function prepareTournament() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host simulates the matches.');
    gameState.matchQueue = [];
    const managers = gameState.managers;

    if (gameState.mode === 'H2H') {
        gameState.matchQueue.push({ t1: createTeamState(managers[0]), t2: createTeamState(managers[1]), label: 'H2H' });
        Net.publishInfo();
        renderBracket();
        return;
    }
    startGhostSeason();
}

function createDoubleRoundRobinSchedule(teams) {
    if (teams.length < 2 || teams.length % 2 !== 0) {
        throw new Error('A double round-robin requires an even number of at least two teams.');
    }

    const rotation = teams.slice();
    const firstLeg = [];
    for (let round = 0; round < teams.length - 1; round++) {
        const fixtures = [];
        for (let index = 0; index < rotation.length / 2; index++) {
            fixtures.push([rotation[index], rotation[rotation.length - 1 - index]]);
        }
        firstLeg.push(fixtures);
        const last = rotation.pop();
        rotation.splice(1, 0, last);
    }
    const secondLeg = firstLeg.map(fixtures => fixtures.map(([home, away]) => [away, home]));
    return [...firstLeg, ...secondLeg];
}

function getSeasonStatsForTeam(team, playerStatsByManager, ghostStatsById) {
    return team.isGhost ? ghostStatsById[team.id] : playerStatsByManager[team.managerId];
}

function calculateLeagueGhostOffset(humans, avgByPos) {
    const typicalPositions = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'];
    const poolBaseline = typicalPositions.reduce((sum, position) => sum + (avgByPos[position] || 75), 0) / typicalPositions.length;
    const humanBaseline = humans.reduce((sum, team) => sum + getStrength(team), 0) / Math.max(1, humans.length);
    // Light pull toward human strength so ghosts scale with the draft without collapsing
    return clamp(Math.round((humanBaseline - poolBaseline) * 0.45 - 2), -14, 8);
}

function startGhostSeason() {
    const avgByPos = avgPoolOVRByPos();
    const humans = gameState.managers.map(manager => {
        const team = createTeamState(manager);
        team.isGhost = false;
        team.managerId = manager.id;
        return team;
    });

    const ghostStrengthOffset = calculateLeagueGhostOffset(humans, avgByPos);
    const leagueGhostStrengthOffset = clamp(ghostStrengthOffset - LEAGUE_GHOST_NERF + getDifficultyOffset(), -22, 10);
    const needGhosts = 20 - humans.length;
    const ghosts = Array.from({ length: needGhosts }, (_, index) =>
        buildGhostTeam(GHOST_CLUB_NAMES[index], avgByPos, index + 1, leagueGhostStrengthOffset)
    );

    const allTeams = [...humans, ...ghosts];
    for (let index = allTeams.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [allTeams[index], allTeams[swapIndex]] = [allTeams[swapIndex], allTeams[index]];
    }
    const schedule = createDoubleRoundRobinSchedule(allTeams);
    const table = allTeams.map(team => ({
        id: team.id, name: team.name, isHuman: !team.isGhost, managerId: team.managerId || null,
        p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0
    }));
    const rowsById = new Map(table.map(row => [row.id, row]));

    const playerStatsByManager = {};
    gameState.managers.forEach(manager => {
        playerStatsByManager[manager.id] = initSeasonPlayerStats(manager);
    });
    const ghostStatsById = {};
    ghosts.forEach(ghost => {
        ghostStatsById[ghost.id] = initGhostTeamStats(ghost);
    });

    const humanSeries = {};
    humans.forEach(team => {
        humanSeries[team.id] = { id: team.id, name: team.name, managerId: team.managerId, positions: [], results: [], fans: [] };
    });

    _seasonRun = {
        allTeams, humans, ghosts, schedule, table, rowsById,
        playerStatsByManager, ghostStatsById, humanSeries, lastSnapshot: null
    };

    // Half-way through the league the managers get a transfer window. It needs at
    // least two human clubs: ghost clubs never trade, so a solo league has no
    // possible partner and goes straight to the second half.
    const midSeason = Math.floor(SEASON_MATCHDAYS / 2);
    const windowAvailable = typeof openTransferWindow === 'function'
        && gameState.managers.length >= 2;
    if (!windowAvailable) {
        playSeasonMatchdays(1, SEASON_MATCHDAYS);
        return finishGhostSeason();
    }
    playSeasonMatchdays(1, midSeason);
    // Let the first half play out on the season screen before the market opens,
    // otherwise the window appears before the league has been shown at all.
    showMidSeasonBreak(midSeason, () => {
        if (!_seasonRun) return;
        openTransferWindow(_seasonRun, () => {
            playSeasonMatchdays(midSeason + 1, SEASON_MATCHDAYS);
            finishGhostSeason(midSeason);
        });
    });
}

// A display-only season object for the halfway table. finishGhostSeason() builds
// the real one once the second half is played.
function buildSeasonView(run, midSeason) {
    const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24'];
    return {
        finalTable: (run.lastSnapshot || []).slice(),
        playerStatsByManager: run.playerStatsByManager,
        ghostStatsById: run.ghostStatsById,
        humanSeries: Object.values(run.humanSeries || {}).map((series, index) => ({ ...series, color: colors[index % colors.length] })),
        matchdayReports: run.matchdayReports || {},
        leagueSize: run.table.length,
        midSeason: !!midSeason
    };
}

function showMidSeasonBreak(midSeason, onContinue) {
    if (!_seasonRun) { onContinue(); return; }
    gameState.season = buildSeasonView(_seasonRun, true);
    showScreen('screen-season');
    Net.publishSeason();
    const wrap = document.getElementById('season-next-wrap');
    if (wrap) { wrap.classList.add('hidden'); wrap.classList.remove('flex'); }
    buildSeasonChartChrome();
    animateSeasonChart(0, midSeason, () => setTimeout(onContinue, 900));
}

let _seasonRun = null; // kept out of gameState on purpose (it holds the whole fixture list)

// The mid-season pause is the only moment a league exists across two turns, so
// it is the only point that needs a JSON-safe copy for SaveGame. Teams travel as
// data and the fixture list as team ids; restoreSeasonRun() puts the object
// references back together.
function serializeSeasonRun(run) {
    if (!run || !Array.isArray(run.allTeams)) return null;
    return {
        teams: run.allTeams.map(team => ({
            id: team.id, name: team.name, isGhost: !!team.isGhost, managerId: team.managerId ?? null,
            lineup: team.lineup || [], bench: team.bench || [], reserves: team.reserves || [],
            subs: team.subs || 0, tactics: team.tactics || null
        })),
        schedule: (run.schedule || []).map(matchday => matchday.map(pair => [pair[0].id, pair[1].id])),
        humanIds: (run.humans || []).map(team => team.id),
        ghostIds: (run.ghosts || []).map(team => team.id),
        table: (run.table || []).map(row => ({ ...row })),
        playerStatsByManager: run.playerStatsByManager || {},
        ghostStatsById: run.ghostStatsById || {},
        humanSeries: run.humanSeries || {},
        matchdayReports: run.matchdayReports || {},
        lastSnapshot: run.lastSnapshot || null
    };
}

function restoreSeasonRun(data) {
    if (!data || !Array.isArray(data.teams) || !Array.isArray(data.schedule)) return null;
    const teams = data.teams.map(team => ({
        id: team.id, name: team.name, isGhost: !!team.isGhost, managerId: team.managerId ?? null,
        lineup: team.lineup || [], bench: team.bench || [], reserves: team.reserves || [],
        subs: team.subs || 0, tactics: team.tactics || null
    }));
    const byId = new Map(teams.map(team => [String(team.id), team]));
    const schedule = data.schedule.map(matchday => matchday.map(pair => {
        const a = byId.get(String(pair[0]));
        const b = byId.get(String(pair[1]));
        return a && b ? [a, b] : null;
    }).filter(Boolean));
    const table = (data.table || []).map(row => ({ ...row }));
    return {
        allTeams: teams,
        humans: (data.humanIds || []).map(id => byId.get(String(id))).filter(Boolean),
        ghosts: (data.ghostIds || []).map(id => byId.get(String(id))).filter(Boolean),
        schedule,
        table,
        rowsById: new Map(table.map(row => [row.id, row])),
        playerStatsByManager: data.playerStatsByManager || {},
        ghostStatsById: data.ghostStatsById || {},
        humanSeries: data.humanSeries || {},
        matchdayReports: data.matchdayReports || {},
        lastSnapshot: data.lastSnapshot || null
    };
}

// Resume a league that was saved while the transfer window was open.
function resumeMidSeasonTransfer(savedWindow, run) {
    if (!run || typeof openTransferWindow !== 'function') return false;
    const midSeason = Math.floor(SEASON_MATCHDAYS / 2);
    _seasonRun = run;
    openTransferWindow(run, () => {
        playSeasonMatchdays(midSeason + 1, SEASON_MATCHDAYS);
        finishGhostSeason(midSeason);
    }, savedWindow);
    return true;
}

function playSeasonMatchdays(from, to) {
    const { schedule, table, rowsById, playerStatsByManager, ghostStatsById, humanSeries } = _seasonRun;
    if (!_seasonRun.matchdayReports) _seasonRun.matchdayReports = {};
    for (let matchday = from; matchday <= to; matchday++) {
        _seasonRun.currentReports = [];
        for (const [teamA, teamB] of schedule[matchday - 1]) {
            const statsA = getSeasonStatsForTeam(teamA, playerStatsByManager, ghostStatsById);
            const statsB = getSeasonStatsForTeam(teamB, playerStatsByManager, ghostStatsById);
            const { gf, ga, result } = simulateLeagueMatch(teamA, teamB, statsA, statsB);
            const resultB = result === 'W' ? 'L' : result === 'L' ? 'W' : 'D';

            applyMatchResult(rowsById.get(teamA.id), gf, ga, result);
            applyMatchResult(rowsById.get(teamB.id), ga, gf, resultB);
            if (humanSeries[teamA.id]) {
                humanSeries[teamA.id].results.push(result);
                const managerA = gameState.managers.find(m => String(m.id) === String(teamA.managerId ?? teamA.id));
                if (managerA) humanSeries[teamA.id].fans.push(fansOf(managerA));
            }
            if (humanSeries[teamB.id]) {
                humanSeries[teamB.id].results.push(resultB);
                const managerB = gameState.managers.find(m => String(m.id) === String(teamB.managerId ?? teamB.id));
                if (managerB) humanSeries[teamB.id].fans.push(fansOf(managerB));
            }
        }

        // Freeze this matchday's human-club reports before the next one starts.
        _seasonRun.matchdayReports[matchday] = (_seasonRun.currentReports || []).slice();
        _seasonRun.currentReports = null;

        const ranked = sortLeagueTable(table);
        ranked.forEach((row, index) => {
            row._pos = index + 1;
            if (humanSeries[row.id]) humanSeries[row.id].positions.push(row._pos);
        });

        _seasonRun.lastSnapshot = ranked.map(row => ({
            id: row.id, name: row.name, isHuman: row.isHuman, managerId: row.managerId,
            p: row.p, w: row.w, d: row.d, l: row.l,
            gf: row.gf, ga: row.ga, gd: row.gd, pts: row.pts, pos: row._pos
        }));
    }

    // Balances and fanbases changed for every human club; push the new wallet
    // state once and refresh any manager cards still in the DOM.
    if (typeof Net !== 'undefined' && Net.online && Net.isHost && typeof Net.publishManagers === 'function') {
        Net.publishManagers();
    }
    if (typeof updateDashboard === 'function') {
        gameState.managers.forEach(manager => updateDashboard(manager.id));
    }
}

function finishGhostSeason(startFrom = 0) {
    const { table, playerStatsByManager, ghostStatsById, humanSeries, lastSnapshot } = _seasonRun;
    const ghosts = _seasonRun.ghosts;
    const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24'];
    const seriesList = Object.values(humanSeries).map((series, index) => ({ ...series, color: colors[index % colors.length] }));
    gameState.season = {
        finalTable: lastSnapshot,
        playerStatsByManager,
        ghostStatsById,
        humanSeries: seriesList,
        matchdayReports: _seasonRun.matchdayReports || {},
        leagueSize: table.length
    };

    showScreen('screen-season');
    Net.publishSeason();
    if (typeof SaveGame !== 'undefined') SaveGame.schedule(200);
    const nextWrap = document.getElementById('season-next-wrap');
    if (nextWrap) { nextWrap.classList.add('hidden'); nextWrap.classList.remove('flex'); }
    const matchdayLabel = document.getElementById('season-md-label');
    if (matchdayLabel) matchdayLabel.classList.add('md-pulse');
    buildSeasonChartChrome();
    // The halfway break already animated matchdays 1..startFrom, so replaying from
    // zero would rewind the chart the player just watched.
    animateSeasonChart(startFrom);
    _seasonRun = null;
}

function applyMatchResult(row, gf, ga, result) {
    if (!row) return;
    row.p++; row.gf += gf; row.ga += ga; row.gd = row.gf - row.ga;
    if (result === 'W') { row.w++; row.pts += 3; }
    else if (result === 'D') { row.d++; row.pts += 1; }
    else row.l++;
}

function buildSeasonChartChrome() {
    const series = gameState.season.humanSeries;
    const strips = document.getElementById('season-wdl-strips');
    strips.innerHTML = series.map(s => `
        <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold w-20 truncate shrink-0" style="color:${s.color}">${escapeHTML(s.name)}</span>
            <div id="wdl-strip-${s.id}" class="flex-1 flex gap-px overflow-hidden h-5 items-center"></div>
            <span id="wdl-record-${s.id}" class="text-[10px] text-slate-400 font-mono w-24 text-right shrink-0" title="W-D-L · fans">0-0-0</span>
        </div>
    `).join('');

    document.getElementById('season-legend').innerHTML = series.map(s =>
        `<span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background:${s.color}"></span>${escapeHTML(s.name)}</span>`
    ).join('');
}

function drawSeasonChart(upToMd) {
    const canvas = document.getElementById('season-chart');
    if (!canvas) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth, h = parent.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = { l: 36, r: 12, t: 16, b: 28 };
    const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
    const leagueSize = gameState.season.leagueSize || 20;
    const series = gameState.season.humanSeries;

    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#020617'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;

    for (let p = 1; p <= leagueSize; p++) {
        if (p !== 1 && p !== Math.ceil(leagueSize / 2) && p !== leagueSize && p % 4 !== 0) continue;
        const y = pad.t + ((p - 1) / (leagueSize - 1)) * plotH;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
        ctx.fillStyle = '#475569'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(String(p), pad.l - 6, y + 3);
    }
    
    for (let md = 0; md <= SEASON_MATCHDAYS; md += 5) {
        const x = pad.l + (md / SEASON_MATCHDAYS) * plotW;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH); ctx.stroke();
        ctx.fillStyle = '#475569'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(md), x, h - 8);
    }

    ctx.save();
    ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif';
    ctx.translate(12, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center';
    ctx.fillText('Position', 0, 0);
    ctx.restore();

    const xAt = (md) => pad.l + (md / SEASON_MATCHDAYS) * plotW;
    const yAt = (pos) => pad.t + ((pos - 1) / (leagueSize - 1)) * plotH;

    series.forEach(s => {
        const pts = s.positions.slice(0, upToMd);
        if (!pts.length) return;

        ctx.strokeStyle = s.color + '55'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); const startPos = pts[0]; ctx.moveTo(xAt(0), yAt(startPos));
        pts.forEach((pos, i) => ctx.lineTo(xAt(i + 1), yAt(pos))); ctx.stroke();

        ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(xAt(0), yAt(startPos));
        pts.forEach((pos, i) => ctx.lineTo(xAt(i + 1), yAt(pos))); ctx.stroke();

        pts.forEach((pos, i) => {
            const x = xAt(i + 1), y = yAt(pos);
            ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(x, y, i === pts.length - 1 ? 4.5 : 2.5, 0, Math.PI * 2); ctx.fill();
            if (i === pts.length - 1) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        });
        
        ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(xAt(0), yAt(startPos), 4, 0, Math.PI * 2); ctx.fill();
    });
}

function updateWdlStrips(upToMd) {
    const series = gameState.season.humanSeries;
    series.forEach(s => {
        const strip = document.getElementById(`wdl-strip-${s.id}`);
        const rec = document.getElementById(`wdl-record-${s.id}`);
        if (!strip) return;
        const results = s.results.slice(0, upToMd);
        let w = 0, d = 0, l = 0;
        strip.innerHTML = results.map(r => {
            if (r === 'W') { w++; return `<span class="inline-block w-1.5 sm:w-2 h-3.5 rounded-sm bg-emerald-500" title="W"></span>`; }
            if (r === 'D') { d++; return `<span class="inline-block w-1.5 sm:w-2 h-3.5 rounded-sm bg-slate-500" title="D"></span>`; }
            l++; return `<span class="inline-block w-1.5 sm:w-2 h-3.5 rounded-sm bg-red-500" title="L"></span>`;
        }).join('');
        if (rec) rec.innerText = `${w}-${d}-${l}`;
    });
}

function animateSeasonChart(mdIndex, limit = SEASON_MATCHDAYS, onDone) {
    const total = SEASON_MATCHDAYS;
    if (mdIndex > limit) {
        if (typeof hideSeasonEventPanel === 'function') hideSeasonEventPanel();
        const label = document.getElementById('season-md-label');
        label.classList.remove('md-pulse');
        const complete = limit >= total;
        label.innerText = complete ? 'Season complete' : `Halfway · Matchday ${limit}`;
        const wrap = document.getElementById('season-next-wrap');
        if (wrap) {
            const show = complete && !(gameState.season && gameState.season.midSeason);
            wrap.classList.toggle('hidden', !show);
            wrap.classList.toggle('flex', show);
        }
        if (typeof onDone === 'function') onDone();
        return;
    }
    document.getElementById('season-md-label').innerText = `Matchday ${mdIndex} / ${total}`;
    document.getElementById('season-progress-bar').style.width = `${(mdIndex / total) * 100}%`;
    drawSeasonChart(mdIndex);
    updateWdlStrips(mdIndex);
    let delay = 85;
    if (mdIndex < 3 || mdIndex > 34) delay = 140;
    if (mdIndex % 5 === 0) delay = 180;
    // Stale panels from an earlier matchday or a live match never carry over.
    if (typeof hideMatchReportLayer === 'function') hideMatchReportLayer();
    const reports = (gameState.season && gameState.season.matchdayReports)
        ? gameState.season.matchdayReports[mdIndex]
        : null;
    // The updates panel tracks the replay on every matchday. Only an injury or a
    // ban stops it, and then nothing moves until Continue is pressed.
    const blocked = matchReportHasEvents(reports) && typeof showSeasonEventPanel === 'function'
        && showSeasonEventPanel(reports, mdIndex, () => animateSeasonChart(mdIndex + 1, limit, onDone));
    if (blocked) return;
    if (typeof showSeasonEventPanel === 'function') showSeasonEventPanel(reports, mdIndex, null);
    setTimeout(() => animateSeasonChart(mdIndex + 1, limit, onDone), delay);
}

function collectAllPlayerStats() {
    // A player can appear in more than one club's map after a mid-season move,
    // or in an older save where the stat record was not moved. Merge by player
    // id so the awards always use his full-season totals.
    const byPlayer = new Map();
    const add = st => {
        if (!st || st.id == null) return;
        const key = String(st.id);
        const rec = byPlayer.get(key);
        if (!rec) { byPlayer.set(key, { ...st }); return; }
        ['goals', 'assists', 'cleanSheets', 'apps', 'minutes', 'yellows', 'reds',
            'ratingSum', 'ratingCount', 'goalsConcededAsGK'].forEach(field => {
            rec[field] = (rec[field] || 0) + (st[field] || 0);
        });
        if (st.name) rec.name = st.name;
        if (st.mainPos) rec.mainPos = st.mainPos;
        if (st.team) { rec.team = st.team; rec.teamId = st.teamId; }
    };
    const byMgr = gameState.season.playerStatsByManager;
    if (byMgr) {
        Object.keys(byMgr).forEach(mid => {
            Object.values(byMgr[mid] || {}).forEach(add);
        });
    }
    const ghostStats = gameState.season.ghostStatsById;
    if (ghostStats) {
        Object.keys(ghostStats).forEach(gid => {
            Object.values(ghostStats[gid] || {}).forEach(add);
        });
    }
    // The club that currently holds the player is his team for display, even
    // though the totals above include the spell at his previous club.
    gameState.managers.forEach(m => (m.squad || []).forEach(p => {
        const rec = byPlayer.get(String(p.id));
        if (rec) { rec.team = m.name; rec.teamId = m.id; }
    }));
    return Array.from(byPlayer.values());
}

function showSeasonResults() {
    if (typeof hideMatchReportPanels === 'function') hideMatchReportPanels();
    const final = gameState.season.finalTable;
    const champion = final[0];
    const soloSeason = gameState.managers.length === 1;
    const titleEl = document.querySelector('#screen-season-results h2');
    if (titleEl) titleEl.textContent = soloSeason ? 'Season Result' : 'Season Complete';
    
    if (soloSeason) {
        const myRow = final.find(r => r.isHuman) || champion;
        document.getElementById('season-champion-banner').innerHTML =
            `Finished <span class="text-emerald-400 font-bold">#${myRow.pos}</span> · <span class="text-white font-black">${myRow.pts}</span> pts · ${myRow.w}W ${myRow.d}D ${myRow.l}L`;
    } else {
        document.getElementById('season-champion-banner').innerHTML =
            `🏆 <span class="text-emerald-400 font-bold">${escapeHTML(champion.name)}</span> are League champions with <span class="text-white font-black">${champion.pts}</span> pts`;
    }

    const tableEl = document.getElementById('season-final-table');
    tableEl.innerHTML = final.map(r => {
        const humanCls = r.isHuman ? 'human' : '';
        const nameCls = r.isHuman ? 'text-emerald-300 font-bold' : 'text-slate-300';
        const medal = r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : '';
        let euro = '';
        if (r.isHuman) {
            if (r.pos <= 4) euro = ' <span class="text-[9px] text-blue-400 font-bold">UCL</span>';
            else if (r.pos <= 8) euro = ' <span class="text-[9px] text-orange-400 font-bold">UEL</span>';
            else euro = ' <span class="text-[9px] text-slate-500">OUT</span>';
        }
        return `
            <div class="season-row grid grid-cols-12 gap-1 items-center px-2 py-1.5 rounded-lg border border-slate-800 text-sm ${humanCls}">
                <span class="col-span-1 font-black text-slate-400">${medal || r.pos}</span>
                <span class="col-span-4 truncate ${nameCls}">${escapeHTML(r.name)}${euro}</span>
                <span class="col-span-1 text-center text-slate-400">${r.p}</span>
                <span class="col-span-1 text-center">${r.w}</span>
                <span class="col-span-1 text-center">${r.d}</span>
                <span class="col-span-1 text-center">${r.l}</span>
                <span class="col-span-1 text-center ${r.gd > 0 ? 'text-green-400' : r.gd < 0 ? 'text-red-400' : 'text-slate-400'}">${r.gd > 0 ? '+' : ''}${r.gd}</span>
                <span class="col-span-2 text-right font-black">${r.pts}</span>
            </div>`;
    }).join('');

    const stats = collectAllPlayerStats().filter(s => (s.minutes || 0) > 0);
    // Season awards need a real sample: one or two good cameos must not beat a starter's full season.
    const AWARD_MIN_MINUTES = 600;
    const POTM_MIN_MINUTES = 1500;
    const awardPool = stats.filter(s => (s.minutes || 0) >= AWARD_MIN_MINUTES);
    const scoringPool = awardPool.length ? awardPool : stats;
    const topScorer = scoringPool.slice().sort((a, b) => b.goals * ghostAwardFactor(b) - a.goals * ghostAwardFactor(a) || b.assists - a.assists)[0];
    const topAssist = scoringPool.slice().sort((a, b) => b.assists * ghostAwardFactor(b) - a.assists * ghostAwardFactor(a) || b.goals - a.goals)[0];
    const gkStats = stats.filter(s => s.mainPos === 'GK' && (s.minutes || 0) >= 600);
    const goldenGlove = gkStats.slice().sort((a, b) => b.cleanSheets * ghostAwardFactor(b) - a.cleanSheets * ghostAwardFactor(a) || a.goalsConcededAsGK - b.goalsConcededAsGK)[0]
        || stats.filter(s => s.mainPos === 'GK').sort((a, b) => b.cleanSheets - a.cleanSheets)[0];
    const potmPool = stats.filter(s => (s.minutes || 0) >= POTM_MIN_MINUTES);
    const potm = (potmPool.length ? potmPool : scoringPool).slice().sort((a, b) => {
        const ra = (a.ratingCount ? a.ratingSum / a.ratingCount : 0) - (isGhostStat(a) ? GHOST_RATING_PENALTY : 0);
        const rb = (b.ratingCount ? b.ratingSum / b.ratingCount : 0) - (isGhostStat(b) ? GHOST_RATING_PENALTY : 0);
        if (rb !== ra) return rb - ra;
        return (b.goals + b.assists) - (a.goals + a.assists);
    })[0];

    const avgRating = (s) => s && s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(2) : '—';

    gameState.season.awards = { topScorer, topAssist, goldenGlove, potm };

    const awards = [
        { title: 'Golden Boot', icon: '⚽', team: topScorer ? topScorer.team : '', sub: topScorer ? `${topScorer.goals} goals` : '—', name: topScorer?.name },
        { title: 'Best Playmaker', icon: '🅰️', team: topAssist ? topAssist.team : '', sub: topAssist ? `${topAssist.assists} assists` : '—', name: topAssist?.name },
        { title: 'Golden Glove', icon: '🧤', team: goldenGlove ? goldenGlove.team : '', sub: goldenGlove ? `${goldenGlove.cleanSheets} clean sheets` : '—', name: goldenGlove?.name },
        { title: 'Player of the Season', icon: '⭐', team: potm ? potm.team : '', sub: potm ? `${avgRating(potm)} Sofa · ${potm.goals}G ${potm.assists}A` : '—', name: potm?.name }
    ];

    document.getElementById('season-awards').innerHTML = awards.map(a => `
        <div class="award-card">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${a.icon} ${a.title}</div>
            <div class="text-lg font-black text-white truncate">${a.name ? escapeHTML(a.name) : '—'}</div>
            <div class="text-[11px] font-bold text-emerald-300/90 truncate mt-0.5">${a.team ? escapeHTML(a.team) : '—'}</div>
            <div class="text-xs text-slate-400 mt-1">${a.sub}</div>
        </div>
    `).join('');

    // Final money picture, kept separate from the player awards. The total gate
    // is tracked on the manager, because the balance also contains auction cash.
    const financeEl = document.getElementById('season-finances');
    if (financeEl) {
        const ordered = [];
        final.filter(r => r.isHuman).forEach(r => {
            const m = gameState.managers.find(x => String(x.id) === String(r.managerId ?? r.id));
            if (m && !ordered.includes(m)) ordered.push(m);
        });
        gameState.managers.forEach(m => { if (!ordered.includes(m)) ordered.push(m); });
        financeEl.innerHTML = ordered.length ? ordered.map(m => {
            const series = (gameState.season.humanSeries || []).find(s => String(s.managerId) === String(m.id));
            const color = series ? series.color : '#34d399';
            const fans = typeof fansOf === 'function' ? fansOf(m) : (Number(m.fans) || 0);
            const gate = Math.max(0, Number(m.ticketRevenue) || 0);
            return `<div class="season-finance-row">
                <div class="season-finance-row__name" style="color:${color}">${escapeHTML(m.name)}</div>
                <div class="season-finance-row__stats">
                    <span class="season-finance-row__fans">👥 <b>${formatFanCount(fans)}</b> fans</span>
                    <span>🎟️ <b>${formatBalance(gate)}</b> ticket revenue</span>
                </div>
            </div>`;
        }).join('') : '<div class="text-sm text-slate-500">No human clubs in this season.</div>';
    }

    const qual = {};
    final.filter(r => r.isHuman).forEach(r => {
        if (r.pos <= 4) qual[r.id] = 'UCL';
        else if (r.pos <= 8) qual[r.id] = 'UEL';
        else qual[r.id] = null;
    });

    const anyEuro = Object.values(qual).some(Boolean);
    const btn = document.getElementById('btn-to-europe');
    if (btn) {
        if (!anyEuro) {
            btn.textContent = 'Awards Ceremony 🏆';
            btn.onclick = () => showAwardsCeremony();
        } else {
            btn.textContent = 'Continue to Europe 🏆';
            btn.onclick = () => startEuropeanCampaign();
        }
    }
    showScreen('screen-season-results');
}

// ============================================================
// EUROPEAN COMPETITIONS (UCL / Europa vs Ghosts)
// ============================================================

function drawEuroOpponent(comp, roundIdx, usedNames) {
    const pool = EURO_CLUB_POOL[comp];
    const weights = EURO_ROUND_TIER_WEIGHTS[comp][roundIdx] || EURO_ROUND_TIER_WEIGHTS[comp][0];
    const entries = [];
    [1, 2, 3, 4, 5].forEach(tier => {
        pool[tier].forEach(name => {
            if (usedNames.has(name)) return;
            // Weight is split across the tier so deep tiers aren't favoured just by having more clubs
            entries.push({ item: { name, tier }, weight: (weights[tier - 1] / pool[tier].length) + 0.00001 });
        });
    });
    if (!entries.length) {
        usedNames.clear();
        return drawEuroOpponent(comp, roundIdx, usedNames);
    }
    return weightedPick(entries);
}

function buildEuroGhost(comp, roundIdx, uniqueSeed, club) {
    const avgByPos = avgPoolOVRByPos();
    const humanBaseline = gameState.managers.length
        ? gameState.managers.reduce((sum, m) => sum + getStrength(createTeamState(m)), 0) / gameState.managers.length
        : 85;
    const typicalPositions = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'];
    const poolBaseline = typicalPositions.reduce((sum, pos) => sum + (avgByPos[pos] || 75), 0) / typicalPositions.length;
    const baseOffset = Math.round(humanBaseline - poolBaseline);

    // Strength = scaled human level - nerf + competition bonus + gentle round ramp + the club's own tier.
    const competitionOffset = clamp(
        Math.round(baseOffset * 0.5 - EURO_GHOST_NERF + (comp === 'UCL' ? 3 : -1) + roundIdx * 0.7 + (EURO_TIER_DELTA[club.tier] ?? 0) + getDifficultyOffset()),
        -20, 4
    );
    // -5 tier bias keeps the same bench/starter calibration European ghosts always had
    return buildGhostTeam(club.name, avgByPos, 500 + uniqueSeed * 13 + roundIdx * 7, competitionOffset, -5);
}

// Ghost-vs-ghost ties used to be a coin flip. Use the same expected-goals model
// as every other match, fed by the club's tier (and by real strength whenever a
// team state is available), so a tier-1 giant usually beats a tier-5 minnow.
function ghostTiePower(team) {
    if (!team) return 80;
    // The group stage already rated every club on the campaign's own ruler, so a
    // seeded bracket tie reads the same number the table was built from.
    if (Number.isFinite(team.power)) return team.power;
    if (Array.isArray(team.lineup) && team.lineup.some(slot => slot && slot.player)) {
        return getStrength(team);
    }
    const tier = Number(team.tier) || 3;
    const tierBonus = (EURO_TIER_DELTA[tier] ?? 0) * 2.5;
    return 84 + tierBonus + (team.isHuman ? 2.5 : 0);
}

function simulateGhostTie(m) {
    const edge = ghostTiePower(m.t1) - ghostTiePower(m.t2);
    const expected = EngineCore.expectedGoals({
        edge,
        base: BASE_EXPECTED_GOALS_PER_TEAM,
        coefficient: 0.05
    });
    // A knockout tie is the big game every Zeus is bought for, and the
    // shootout belongs to whoever actually nails penalties under that pressure.
    const lambdaA = expected.lambdaA * playstyleClutchBoost(m.t1, 1);
    const lambdaB = expected.lambdaB * playstyleClutchBoost(m.t2, 1);
    m.s1 = EngineCore.samplePoisson(lambdaA);
    m.s2 = EngineCore.samplePoisson(lambdaB);

    if (m.s1 === m.s2) {
        // Weighted shootout: the stronger side still has to earn it from 12 yards.
        const nerve = playstylePenaltyEdge(m.t1) - playstylePenaltyEdge(m.t2);
        const p1Wins = clamp(0.5 + edge * 0.025 + nerve * 1.2, 0.25, 0.75);
        const firstWins = Math.random() < p1Wins;
        const win = 3 + Math.floor(Math.random() * 3);
        const lose = Math.max(0, win - 1 - Math.floor(Math.random() * 2));
        m.pen1 = firstWins ? win : lose;
        m.pen2 = firstWins ? lose : win;
        m.winner = firstWins ? m.t1 : m.t2;
    } else {
        m.winner = m.s1 > m.s2 ? m.t1 : m.t2;
    }
    m.played = true;
}

// ============================================================
// EUROPEAN GROUP STAGE
// Thirty-two clubs per competition, eight groups of four, home and away.
// Every tie is simulated — a manager's own group matches included, played
// by the engine on the eleven they actually picked.
// ============================================================

const EURO_GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
// The three ways to split four clubs into two ties, then the same three with
// the venues reversed: every pairing is met twice and no club plays twice a
// matchday, so each side gets three home games and three away.
const EURO_GROUP_PAIRINGS = [
    [[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]],
    [[3, 0], [2, 1]], [[2, 0], [3, 1]], [[1, 0], [3, 2]]
];
const EURO_GROUP_MATCHDAYS = 6;
const EURO_GROUP_SIZE = 4;
const EURO_GROUP_QUALIFERS = 2;

function euroShuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// One ruler for the whole campaign: a manager's club is worth the strength of
// the XI they picked, an invited club is the human average shifted by its tier.
function euroNodePower(node, baseline) {
    const raw = node.isHuman
        ? getStrength(node.humanRef.teamState)
        : baseline + (EURO_TIER_DELTA[node.tier] ?? 0) * 2.5;
    return Math.round(raw * 10) / 10;
}

// Pots, the draw itself and the six matchdays. `balls` records the draw in the
// order it happened so the screen can replay it instead of showing a done deal.
function buildEuroGroupStage(comp, humanNodes, baseline) {
    const teams = [...humanNodes];
    const used = new Set(teams.map(t => t.name));

    // Europe's group stage always contains the elite, so they are seeded in
    // before the weighted draw tops the field up from the lower tiers.
    euroShuffle((EURO_CLUB_POOL[comp][1] || []).map(name => ({ name, tier: 1 }))).forEach(club => {
        if (teams.length >= 32 || used.has(club.name)) return;
        used.add(club.name);
        teams.push({ name: club.name, isHuman: false, tier: club.tier });
    });
    while (teams.length < 32) {
        const club = drawEuroOpponent(comp, 0, used);
        used.add(club.name);
        teams.push({ name: club.name, isHuman: false, tier: club.tier });
    }

    teams.forEach(t => { t.power = euroNodePower(t, baseline); });

    // Strength seeds the four pots of eight, so the best clubs cannot meet
    // until the knockout rounds — and one club from each pot lands in each group.
    const ranked = [...teams].sort((a, b) => b.power - a.power || String(a.name).localeCompare(String(b.name)));
    const pots = [0, 1, 2, 3].map(p => ranked.slice(p * 8, p * 8 + 8));
    const groups = EURO_GROUP_LETTERS.map(() => []);
    const balls = [];
    pots.forEach((pot, potIdx) => {
        euroShuffle(pot).forEach((team, seat) => {
            team.groupIdx = seat;
            team.groupLetter = EURO_GROUP_LETTERS[seat];
            team.pot = potIdx + 1;
            groups[seat].push(team);
            balls.push({ pot: potIdx + 1, groupIdx: seat, name: team.name, isHuman: !!team.isHuman });
        });
    });

    const fixtures = [];
    for (let md = 0; md < EURO_GROUP_MATCHDAYS; md++) {
        const day = [];
        groups.forEach((clubs, gi) => {
            EURO_GROUP_PAIRINGS[md].forEach((pair, k) => {
                day.push({ id: `G${gi}_${md}_${k}`, gi, md, t1: clubs[pair[0]], t2: clubs[pair[1]], played: false });
            });
        });
        // The manager's own game is the last one revealed on each matchday.
        fixtures.push(euroShuffle(day).sort(m => (m.t1.isHuman || m.t2.isHuman) ? 1 : 0));
    }

    return { teams, pots, groups, balls, fixtures, playedMatchdays: 0 };
}

function simulateGroupTie(m) {
    const edge = (m.t1.power ?? 84) - (m.t2.power ?? 84);
    const expected = EngineCore.expectedGoals({
        edge,
        base: EURO_GROUP_GOALS_PER_TEAM,
        coefficient: 0.05,
        homeAdvantage: EURO_GROUP_HOME_ADVANTAGE
    });
    // Group football is not a knockout night, so the big-game habits carry less
    // here than they do from the round of 16 onwards.
    const nerveA = playstyleClutchBoost(m.t1.humanRef?.teamState, 0.4);
    const nerveB = playstyleClutchBoost(m.t2.humanRef?.teamState, 0.4);
    m.s1 = EngineCore.samplePoisson(clamp(expected.lambdaA * nerveA, 0.2, 4.0));
    m.s2 = EngineCore.samplePoisson(clamp(expected.lambdaB * nerveB, 0.2, 4.0));
    m.played = true;
}

function runEuroGroupMatchday(mdIndex, onlyComp) {
    const euro = gameState.europe;
    if (!euro) return;
    ['UCL', 'UEL'].forEach(comp => {
        if (onlyComp && comp !== onlyComp) return;
        const stage = euro.groups[comp];
        if (!stage) return;
        (stage.fixtures[mdIndex] || []).forEach(m => { if (!m.played) simulateGroupTie(m); });
        stage.playedMatchdays = Math.max(stage.playedMatchdays || 0, mdIndex + 1);
    });
}

function runEuroGroupStage() {
    for (let md = 0; md < EURO_GROUP_MATCHDAYS; md++) runEuroGroupMatchday(md);
}

function euroGroupMatches(comp, gi) {
    const stage = gameState.europe?.groups?.[comp];
    if (!stage) return [];
    return stage.fixtures.flat().filter(m => m.gi === gi);
}

// The table is derived from the results rather than stored, so a second device
// (or a re-render) can never drift away from the first.
function euroGroupTable(comp, gi) {
    const stage = gameState.europe?.groups?.[comp];
    if (!stage) return [];
    const rows = new Map(stage.groups[gi].map(team => [team, { team, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
    euroGroupMatches(comp, gi).forEach(m => {
        if (!m.played) return;
        const home = rows.get(m.t1), away = rows.get(m.t2);
        home.p++; away.p++;
        home.gf += m.s1; home.ga += m.s2;
        away.gf += m.s2; away.ga += m.s1;
        if (m.s1 > m.s2) { home.w++; away.l++; home.pts += 3; }
        else if (m.s1 < m.s2) { away.w++; home.l++; away.pts += 3; }
        else { home.d++; away.d++; home.pts++; away.pts++; }
    });
    return rankGroupRows(comp, gi, [...rows.values()]);
}

function rankGroupRows(comp, gi, rows) {
    rows.forEach(r => { r.gd = r.gf - r.ga; });
    const byOverall = (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
        || (b.team.power ?? 0) - (a.team.power ?? 0)
        || String(a.team.name).localeCompare(String(b.team.name));
    rows.sort(byOverall);

    // Level on points, goal difference and goals scored: UEFA settles those
    // ties on the mini-league between the clubs concerned before reaching
    // for anything else.
    let start = 0;
    while (start < rows.length) {
        let end = start;
        while (end + 1 < rows.length
            && rows[end + 1].pts === rows[start].pts
            && rows[end + 1].gd === rows[start].gd
            && rows[end + 1].gf === rows[start].gf) end++;
        if (end > start) {
            const cluster = rows.slice(start, end + 1);
            const mini = new Map(cluster.map(r => [r.team, { pts: 0, gd: 0, gf: 0 }]));
            euroGroupMatches(comp, gi).forEach(m => {
                if (!m.played) return;
                const a = mini.get(m.t1), b = mini.get(m.t2);
                if (!a || !b) return;
                a.gf += m.s1; a.gd += m.s1 - m.s2;
                b.gf += m.s2; b.gd += m.s2 - m.s1;
                if (m.s1 > m.s2) a.pts += 3;
                else if (m.s1 < m.s2) b.pts += 3;
                else { a.pts++; b.pts++; }
            });
            cluster.sort((x, y) => {
                const mx = mini.get(x.team), my = mini.get(y.team);
                return my.pts - mx.pts || my.gd - mx.gd || my.gf - mx.gf || byOverall(x, y);
            });
            rows.splice(start, cluster.length, ...cluster);
        }
        start = end + 1;
    }
    return rows;
}

function emptyEuroBracket(teams) {
    const bracket = [[], [], [], []];
    for (let i = 0; i < 8; i++) {
        bracket[0].push({ id: `R0_${i}`, t1: teams[i * 2], t2: teams[i * 2 + 1], played: false });
    }
    for (let r = 1; r < 4; r++) {
        for (let i = 0; i < 8 / Math.pow(2, r); i++) {
            bracket[r].push({ id: `R${r}_${i}`, t1: null, t2: null, played: false });
        }
    }
    return bracket;
}

// Two from each group go through, and a group winner may only be drawn
// against a runner-up from a different group.
function qualifyEuroKnockout(comp) {
    const euro = gameState.europe;
    const stage = euro.groups[comp];
    if (!stage) return null;

    const winners = [], runners = [];
    for (let gi = 0; gi < EURO_GROUP_LETTERS.length; gi++) {
        const rows = euroGroupTable(comp, gi);
        winners.push(rows[0].team);
        runners.push(rows[1].team);
        rows.slice(EURO_GROUP_QUALIFERS).forEach(r => {
            if (!r.team.isHuman) return;
            r.team.humanRef.eliminated = true;
            r.team.humanRef.roundReached = 'Group stage';
        });
    }

    let order = euroShuffle(runners);
    let guard = 0;
    while (guard++ < 300 && order.some((r, i) => r.groupIdx === winners[i].groupIdx)) order = euroShuffle(runners);

    const teams = [];
    winners.forEach((w, i) => teams.push(w, order[i]));
    euro.brackets[comp] = emptyEuroBracket(teams);
    return teams;
}

// ============================================================
// EUROPEAN GROUP STAGE SHOW
// The draw, the six matchdays and the flight into the last sixteen. Every timer
// is tagged with a generation, so pressing Skip retires the whole sequence
// instead of leaving orphaned animations behind.
// ============================================================

const EURO_BALL_MS = 76;
const EURO_MD_MS = 1150;
const EURO_FLY_MS = 300;
const EURO_SEAT_STAGGER = 70;

const EuroShow = {
    timers: [],
    gen: 0,
    clear() { this.timers.forEach(clearTimeout); this.timers = []; },
    after(ms, fn) {
        const gen = this.gen;
        const id = setTimeout(() => {
            this.timers = this.timers.filter(t => t !== id);
            if (gen === this.gen) fn();
        }, ms);
        this.timers.push(id);
    }
};

function euroEl(id) { return document.getElementById(id); }

// The stages carry their own display rules, so hide them inline as well as with
// the utility class — whichever stylesheet wins the tie, the stage disappears.
function euroVis(el, show) {
    if (!el) return;
    el.classList.toggle('hidden', !show);
    el.style.display = show ? '' : 'none';
}

function euroFly(source, target, label, onLand) {
    const host = euroEl('euro-bracket-scroll');
    if (!host || !source || !target) { if (onLand) onLand(); return; }
    const hostRect = host.getBoundingClientRect();
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const chip = document.createElement('div');
    chip.className = 'euro-fly';
    chip.textContent = label;
    host.appendChild(chip);
    const x0 = from.left - hostRect.left + host.scrollLeft;
    const y0 = from.top - hostRect.top + host.scrollTop;
    const x1 = to.left - hostRect.left + host.scrollLeft;
    const y1 = to.top - hostRect.top + host.scrollTop;
    chip.style.transform = `translate(${x0}px, ${y0}px) scale(.92)`;
    requestAnimationFrame(() => {
        chip.style.transition = `transform ${EURO_FLY_MS}ms cubic-bezier(.2,.7,.3,1)`;
        chip.style.transform = `translate(${x1}px, ${y1}px)`;
    });
    EuroShow.after(EURO_FLY_MS + 20, () => {
        chip.remove();
        if (onLand) onLand();
    });
}

function euroDrawMarkup(comp) {
    const stage = gameState.europe.groups[comp];
    const pots = [1, 2, 3, 4].map(p => `
        <div class="euro-pot" data-pot="${p}">
            <div class="euro-pot__label">Pot ${p}</div>
            <div class="euro-pot__balls">${stage.balls.slice((p - 1) * 8, p * 8).map((b, k) =>
                `<span class="euro-ball" data-seq="${(p - 1) * 8 + k}" title="${escapeHTML(b.name)}"></span>`).join('')}
            </div>
        </div>`).join('');
    const slots = stage.groups.map((clubs, gi) => `
        <div class="euro-slot" data-gi="${gi}">
            <div class="euro-slot__head">Group ${EURO_GROUP_LETTERS[gi]}</div>
            <div class="euro-slot__rows"></div>
        </div>`).join('');
    return `<div class="euro-md"><span>Group stage draw</span><button class="euro-skip" type="button">Skip</button></div>
            <div class="euro-pots">${pots}</div><div class="euro-draw__groups">${slots}</div>`;
}

// One ball leaves its pot every EURO_BALL_MS; the flights overlap, so the draw
// reads as a continuous machine rather than thirty-two separate gestures.
function runEuroDraw(comp, onDone) {
    const stage = gameState.europe.groups[comp];
    const drawEl = euroEl('euro-draw-stage');
    if (!drawEl) { onDone(); return; }
    drawEl.innerHTML = euroDrawMarkup(comp);
    euroVis(drawEl, true);
    drawEl.querySelector('.euro-skip').onclick = skipEuroGroupPresentation;
    const balls = stage.balls;
    let seq = 0;
    const step = () => {
        if (seq >= balls.length) {
            EuroShow.after(420, () => { euroVis(drawEl, false); onDone(); });
            return;
        }
        const ball = balls[seq];
        const chip = drawEl.querySelector(`.euro-ball[data-seq="${seq}"]`);
        if (chip) chip.classList.add('gone');
        const slot = drawEl.querySelector(`.euro-slot[data-gi="${ball.groupIdx}"]`);
        if (slot) slot.classList.add('landing');
        euroFly(chip, slot && slot.querySelector('.euro-slot__rows'), ball.name, () => {
            if (!slot) return;
            const row = document.createElement('div');
            row.className = 'euro-slot__row' + (ball.isHuman ? ' human' : '');
            row.textContent = ball.name;
            slot.querySelector('.euro-slot__rows').appendChild(row);
            slot.classList.remove('landing');
        });
        seq++;
        EuroShow.after(EURO_BALL_MS, step);
    };
    step();
}

function euroGroupsMarkup(comp, md) {
    const stage = gameState.europe.groups[comp];
    const head = md < 0
        ? '<span>Group stage</span>'
        : `<span>Matchday <b>${md + 1}</b> / ${EURO_GROUP_MATCHDAYS}</span>`;
    const cards = stage.groups.map((clubs, gi) => {
        const rows = euroGroupTable(comp, gi);
        const decided = md === EURO_GROUP_MATCHDAYS - 1;
        const body = rows.map((r, i) => {
            const cls = ['euro-row'];
            if (r.team.isHuman) cls.push('human');
            if (decided) cls.push(i < EURO_GROUP_QUALIFERS ? 'zone-in' : 'zone-out');
            return `<div class="${cls.join(' ')}" data-team="${escapeHTML(r.team.name)}">
                <span>${i + 1}</span>
                <span class="euro-row__name">${escapeHTML(r.team.name)}</span>
                <span class="euro-row__gd">${r.gd > 0 ? `+${r.gd}` : r.gd}</span>
                <span class="euro-row__pts">${r.pts}</span>
            </div>`;
        }).join('');
        const ties = (stage.fixtures[md] || []).filter(m => m.gi === gi).map(m =>
            `<div>${escapeHTML(m.t1.name)} ${m.s1}-${m.s2} ${escapeHTML(m.t2.name)}</div>`).join('');
        return `<div class="euro-group" data-gi="${gi}">
            <div class="euro-group__head">Group ${EURO_GROUP_LETTERS[gi]}</div>
            ${body}
            <div class="euro-group__day">${ties}</div>
        </div>`;
    }).join('');
    return `<div class="euro-md">${head}<button class="euro-skip" type="button">Skip</button></div>
            <div class="euro-groups">${cards}</div>`;
}

// Repaints the eight tables, then slides each row from where it was to where it
// now ranks, so a result visibly moves a club up or down the group.
function renderEuroTables(comp, md) {
    const host = euroEl('euro-groups-stage');
    if (!host) return;
    const wasTop = new Map();
    const wasPts = new Map();
    host.querySelectorAll('.euro-row').forEach(r => {
        wasTop.set(r.dataset.team, r.getBoundingClientRect().top);
        wasPts.set(r.dataset.team, r.querySelector('.euro-row__pts').textContent);
    });
    host.innerHTML = euroGroupsMarkup(comp, md);
    host.querySelectorAll('.euro-row').forEach(r => {
        const old = wasTop.get(r.dataset.team);
        if (old != null) {
            const delta = old - r.getBoundingClientRect().top;
            if (Math.abs(delta) > 1) {
                r.style.transition = 'none';
                r.style.transform = `translateY(${delta}px)`;
                requestAnimationFrame(() => { r.style.transition = ''; r.style.transform = ''; });
            }
        }
        if (wasPts.get(r.dataset.team) !== r.querySelector('.euro-row__pts').textContent) r.classList.add('landing');
    });
    const skip = host.querySelector('.euro-skip');
    if (skip) skip.onclick = skipEuroGroupPresentation;
}

// The tables start empty and fill one matchday at a time. Results are simulated
// a matchday ahead of being shown, which is what makes the re-sort meaningful.
function runEuroMatchdays(comp, onDone) {
    const host = euroEl('euro-groups-stage');
    if (!host) { onDone(); return; }
    renderEuroTables(comp, -1);
    euroVis(host, true);
    let md = 0;
    const step = () => {
        if (md >= EURO_GROUP_MATCHDAYS) { EuroShow.after(700, onDone); return; }
        runEuroGroupMatchday(md, comp);
        renderEuroTables(comp, md);
        md++;
        EuroShow.after(EURO_MD_MS, step);
    };
    EuroShow.after(650, step);
}

// The two qualifying clubs from each table fly down into the last sixteen.
function flyIntoR16(comp, onDone) {
    const host = euroEl('euro-groups-stage');
    const bracket = gameState.europe.brackets[comp];
    if (!host || !bracket || !host.querySelector('.euro-groups')) { onDone(); return; }
    const rowsByTeam = new Map();
    host.querySelectorAll('.euro-row').forEach(r => rowsByTeam.set(r.dataset.team, r));
    host.insertAdjacentHTML('beforeend', `<div class="euro-r16">
        <div class="euro-group__head">Round of 16</div>
        <div class="euro-r16__grid">${bracket[0].map(m => `
            <div class="euro-r16__tie" data-tie="${m.id}">
                <div class="euro-r16__seat" data-slot="1"></div>
                <div class="euro-r16__seat" data-slot="2"></div>
            </div>`).join('')}
        </div></div>`);
    const seats = [];
    bracket[0].forEach(m => {
        [m.t1, m.t2].forEach((team, k) => {
            const cell = host.querySelector(`.euro-r16__tie[data-tie="${m.id}"] .euro-r16__seat[data-slot="${k + 1}"]`);
            if (cell) seats.push({ team, cell });
        });
    });
    let landed = 0;
    // Bring the landing grid into view without losing the tables it flies from.
    const scroll = euroEl('euro-bracket-scroll');
    const grid = host.querySelector('.euro-r16');
    if (scroll && grid) {
        const gap = grid.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom;
        if (gap > 0) scroll.scrollTop += gap + 10;
    }
    seats.forEach((s, i) => {
        EuroShow.after(i * EURO_SEAT_STAGGER, () => {
            const source = rowsByTeam.get(s.team.name);
            if (source) source.classList.add('moved');
            euroFly(source, s.cell, s.team.name, () => {
                s.cell.textContent = s.team.name;
                s.cell.classList.add('filled');
                if (s.team.isHuman) s.cell.classList.add('human');
                if (++landed >= seats.length) EuroShow.after(450, onDone);
            });
        });
    });
}

// Plays the group stage out for each competition the managers entered, one
// competition at a time: draw, six matchdays, then the flight into the bracket.
function presentEuroGroups(onDone) {
    const comps = ['UCL', 'UEL'].filter(c => gameState.europe.groups[c]);
    const tabs = euroEl('euro-comp-tabs');
    const title = euroEl('euro-screen-title');
    EuroShow.silentPaint = false;
    euroVis(euroEl('euro-bracket-stage'), false);
    if (title) title.textContent = 'European Group Stage';
    const sub = euroEl('euro-bracket-sub');
    if (sub) sub.textContent = 'The draw, then six matchdays — every tie simulated.';
    euroVis(euroEl('btn-bracket-next'), false);
    euroVis(euroEl('btn-bracket-final'), false);
    // The spectacle is local: a client's screen stays where it was until there is
    // a real bracket to show it.
    if (Net.online) showScreenLocal('screen-euro-bracket');
    else showScreen('screen-euro-bracket');
    euroVis(tabs, comps.length > 1);
    let i = 0;
    const nextComp = () => {
        if (i >= comps.length) { onDone(); return; }
        const comp = comps[i++];
        tabs.querySelectorAll('.euro-comp-tab').forEach(t => t.classList.toggle('on', t.dataset.comp === comp));
        const scroll = euroEl('euro-bracket-scroll');
        if (scroll) scroll.scrollTop = 0;
        runEuroDraw(comp, () => runEuroMatchdays(comp, () => {
            qualifyEuroKnockout(comp);
            flyIntoR16(comp, () => EuroShow.after(600, () => {
                euroVis(euroEl('euro-groups-stage'), false);
                nextComp();
            }));
        }));
    };
    nextComp();
}

// Retires the animation and puts every result on the books in one go.
function skipEuroGroupPresentation() {
    EuroShow.clear();
    EuroShow.gen++;
    runEuroGroupStage();
    ['UCL', 'UEL'].forEach(comp => {
        if (gameState.europe.groups[comp] && !gameState.europe.brackets[comp]) qualifyEuroKnockout(comp);
    });
    [euroEl('euro-draw-stage'), euroEl('euro-groups-stage')].forEach(el => {
        if (!el) return;
        el.innerHTML = '';
        euroVis(el, false);
    });
    finishEuroGroupStage();
}

function finishEuroGroupStage() {
    runEuroGroupStage();
    ['UCL', 'UEL'].forEach(comp => {
        if (gameState.europe.groups[comp] && !gameState.europe.brackets[comp]) qualifyEuroKnockout(comp);
    });
    const title = euroEl('euro-screen-title');
    if (title) title.textContent = 'European Bracket';
    euroVis(euroEl('euro-comp-tabs'), false);
    // The last sixteen has already been drawn out on screen — the first paint of
    // the real bracket should not replay it.
    EuroShow.silentPaint = true;
    advanceEuroQueue();
    if (!gameState.europe.queue.length) return showAwardsCeremony();
    showEuropeBracket();
}

// Rebuilds the queue of human fixtures for the current round. When nothing is left to play in the
// round it seeds the next one (or crowns the champions after the final) and carries on.
// Push known winners into the next round as soon as a tie is decided.
function propagateEuroWinners() {
    const euro = gameState.europe;
    if (!euro || !euro.brackets) return;
    ['UCL', 'UEL'].forEach(comp => {
        const bracket = euro.brackets[comp];
        if (!bracket) return;
        for (let r = 0; r < bracket.length - 1; r++) {
            const matches = bracket[r];
            const nextMatches = bracket[r + 1];
            if (!matches || !nextMatches) continue;
            for (let i = 0; i < matches.length; i += 2) {
                const slot = nextMatches[Math.floor(i / 2)];
                if (!slot || slot.played) continue;
                const a = matches[i];
                const b = matches[i + 1];
                slot.t1 = (a && a.played && a.winner) ? a.winner : null;
                slot.t2 = (b && b.played && b.winner) ? b.winner : null;
            }
        }
    });
}

function advanceEuroQueue() {
    const euro = gameState.europe;
    euro.queue = [];
    const roundIdx = euro.currentRoundIdx;
    if (roundIdx >= EURO_ROUNDS.length) return; // tournament already finished

    // Process each bracket top→bottom. Ghost ties only resolve when every
    // earlier tie in that competition is already finished, so lower matches
    // don't show scores before upper ones (including human fixtures) are played.
    ['UCL', 'UEL'].forEach(comp => {
        const matches = euro.brackets[comp] && euro.brackets[comp][roundIdx];
        if (!matches) return;
        let blockedByHuman = false;
        matches.forEach(m => {
            if (m.played) return;
            if (blockedByHuman) return; // leave later ties unplayed for now
            if (m.t1.isHuman || m.t2.isHuman) {
                euro.queue.push({ comp, roundIdx, match: m });
                blockedByHuman = true;
            } else {
                simulateGhostTie(m);
            }
        });
    });
    propagateEuroWinners();
    if (euro.queue.length) return; // human fixtures still to play

    ['UCL', 'UEL'].forEach(comp => {
        const bracket = euro.brackets[comp];
        if (!bracket) return;
        const matches = bracket[roundIdx];
        const nextMatches = bracket[roundIdx + 1];
        if (nextMatches) {
            for (let i = 0; i < matches.length; i += 2) {
                nextMatches[i / 2].t1 = matches[i].winner;
                nextMatches[i / 2].t2 = matches[i + 1].winner;
            }
        } else {
            matches.forEach(m => {
                if (m.winner && m.winner.isHuman) m.winner.humanRef.champion = true;
            });
        }
    });
    euro.currentRoundIdx++;
    advanceEuroQueue();
}

function startEuropeanCampaign() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host runs the European campaign.');
    const final = gameState.season.finalTable;
    const humans = gameState.managers.map(m => {
        const row = final.find(r => r.isHuman && r.managerId === m.id);
        const pos = row ? row.pos : 99;
        let comp = null;
        if (pos <= 4) comp = 'UCL';
        else if (pos <= 8) comp = 'UEL';
        return {
            managerId: m.id, name: m.name, leaguePos: pos, competition: comp,
            teamState: createTeamState(m), roundReached: null, eliminated: !comp,
            champion: false, path: [], euroStats: {}
        };
    });

    gameState.europe = {
        participants: humans, brackets: {}, groups: {}, queue: [], currentRoundIdx: 0,
        pending: null, seedCounter: 0, bracketPending: false
    };

    // Invited clubs are rated against the average of the managers in the draw, so
    // a stacked squad and a rebuilt one both land in a group that makes sense.
    const qualified = humans.filter(h => h.competition);
    const baseline = qualified.length
        ? qualified.reduce((sum, h) => sum + getStrength(h.teamState), 0) / qualified.length
        : 84;

    let anyGroups = false;
    ['UCL', 'UEL'].forEach(comp => {
        const compHumans = humans.filter(h => h.competition === comp);
        if (!compHumans.length) return;
        const nodes = compHumans.map(h => ({ name: h.name, isHuman: true, humanRef: h }));
        gameState.europe.groups[comp] = buildEuroGroupStage(comp, nodes, baseline);
        anyGroups = true;
    });

    if (!anyGroups) return showAwardsCeremony();

    presentEuroGroups(finishEuroGroupStage);
}

// Shared reset of the match screen.
function prepareMatchScreen(label, name1, name2) {
    gameState.matchBroadcast = { label, name1, name2 };
    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setText('match-header-label', label);
    setText('match-m1-name', name1);
    setText('match-m2-name', name2);
    setText('match-m1-avatar', name1.substring(0, 2).toUpperCase());
    setText('match-m2-avatar', name2.substring(0, 2).toUpperCase());
    setText('match-score-1', '0');
    setText('match-score-2', '0');
    setText('match-live-time', "0'");

    const timeline = document.getElementById('match-timeline');
    const penBoard = document.getElementById('pen-board');
    if (timeline) timeline.innerHTML = '<div class="timeline-center-line"></div>';

    document.getElementById('match-stats-container')?.classList.add('hidden');
    document.getElementById('match-actions')?.classList.add('hidden');
    penBoard?.classList.add('hidden');
    const confetti = document.getElementById('confetti-canvas');
    if (confetti) confetti.getContext('2d').clearRect(0, 0, window.innerWidth, window.innerHeight);
}

function launchEuropeMatch() {
    const euro = gameState.europe;
    if (!euro || !euro.pending) return;
    const { comp, roundName, match, human1, human2, ghost } = euro.pending;

    euro.queue.shift();
    euro.current = euro.pending;
    euro.pending = null;

    let t1State = cloneTeamStateForMatch(human1 ? human1.teamState : ghost);
    let t2State = cloneTeamStateForMatch(human2 ? human2.teamState : ghost);
    t1State.name = match.t1.name;
    t2State.name = match.t2.name;

    // Tactics and the "ask referee" button always control side 1,
    // so a human drawn as the second team is moved to side 1 (the result is mapped back afterwards).
    euro.current.swapped = !human1 && !!human2;
    if (euro.current.swapped) [t1State, t2State] = [t2State, t1State];

    gameState.currentMatchData = { t1: t1State, t2: t2State, label: `${comp} ${roundName}`, isEurope: true };
    gameState.matchQueue = [];

    prepareMatchScreen(`${comp} · ${roundName}`, t1State.name, t2State.name);
    forceCloseMatchRatings();
    showScreen('screen-match');
    simulateMatchSequence(t1State, t2State);
}

// Fresh per-match copy of a team state so cards/subs in Europe never leak into the saved squad
function cloneTeamStateForMatch(team) {
    const fresh = typeof fillAvailableTeamSlots === 'function'
        ? fillAvailableTeamSlots(team.lineup, team.bench, team.reserves)
        : { lineup: team.lineup, bench: team.bench, reserves: team.reserves };
    return {
        ...team,
        lineup: (fresh.lineup || []).map(slot => ({ ...slot, yel: 0, min: 0, cameOn: 0 })),
        bench: (fresh.bench || []).slice(),
        reserves: (fresh.reserves || []).slice(),
        subs: 0,
        nextSubCheckMinute: 0
    };
}

// Adds one finished European match to a human manager's euroStats (read by the awards code)
function recordEuropeanPlayerStats(human, sim) {
    if (!human || !sim || !sim.ratings) return;
    const teamNo = sim.t1 && sim.t1.name === human.name ? 1 : 2;
    const opp = teamNo === 1 ? sim.s2 : sim.s1;
    const squadIds = new Set((gameState.managers.find(m => m.id === human.managerId)?.squad || []).map(p => p.id));
    if (!human.euroStats) human.euroStats = {};

    Object.values(sim.ratings).forEach(entry => {
        if (!entry || entry.team !== teamNo || !entry.player) return;
        if (squadIds.size && !squadIds.has(entry.player.id)) return;
        const id = entry.player.id;
        const st = human.euroStats[id] || (human.euroStats[id] = {
            apps: 0, goals: 0, assists: 0, cleanSheets: 0, ratingSum: 0, ratingCount: 0
        });
        st.apps++;
        st.goals += entry.goals || 0;
        st.assists += entry.assists || 0;
        const pos = entry.pos || entry.player.mainPos;
        if (opp === 0 && ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) st.cleanSheets++;
        st.ratingSum += liveRatingFor(sim, entry);
        st.ratingCount++;
    });
}

function onEuropeMatchFinished(gf, ga, penalties = null) {
    const euro = gameState.europe;
    const cur = euro?.current;
    if (!cur) return;

    // The sim ran with the sides swapped when the human was drawn second: map the result back to the tie
    if (cur.swapped) {
        [gf, ga] = [ga, gf];
        if (penalties) penalties = { p1: penalties.p2, p2: penalties.p1 };
    }

    const match = cur.match;
    match.s1 = gf;
    match.s2 = ga;
    match.pen1 = penalties ? penalties.p1 : null;
    match.pen2 = penalties ? penalties.p2 : null;
    
    const t1Won = penalties ? penalties.p1 > penalties.p2 : gf > ga;
    match.winner = t1Won ? match.t1 : match.t2;
    match.played = true;

    if (cur.human1) {
        recordEuropeanPlayerStats(cur.human1, gameState.matchSim);
        cur.human1.roundReached = cur.roundName;
        if (!t1Won) cur.human1.eliminated = true;
        else if (cur.roundIdx === 3) cur.human1.champion = true;
        cur.human1.path.push({ round: cur.roundName, opponent: match.t2.name, gf, ga, won: t1Won, penalties });
    }
    if (cur.human2) {
        recordEuropeanPlayerStats(cur.human2, gameState.matchSim);
        cur.human2.roundReached = cur.roundName;
        if (t1Won) cur.human2.eliminated = true;
        else if (cur.roundIdx === 3) cur.human2.champion = true;
        cur.human2.path.push({ round: cur.roundName, opponent: match.t1.name, gf: ga, ga: gf, won: !t1Won, penalties: penalties ? { p1: penalties.p2, p2: penalties.p1 } : null });
    }

    euro.current = null;
    propagateEuroWinners();
    Net.publishEurope();
}

function renderEuropeBracketScreen() {
    const euro = gameState.europe;
    const stage = document.getElementById('euro-bracket-stage');
    if (!stage) return;

    const before = euroBracketSnapshot(stage);
    const shortRounds = ['R16', 'QF', 'SF', 'Final'];
    stage.innerHTML = ['UCL', 'UEL'].map(comp => {
        const bracket = euro.brackets[comp];
        if (!bracket) return '';
        
        const columns = EURO_ROUNDS.map((roundName, i) => {
            const matches = bracket[i];
            const matchHtml = matches.map(m => {
                const t1 = m.t1 || { name: 'TBD' };
                const t2 = m.t2 || { name: 'TBD' };
                const s1 = m.played ? `${m.s1}${m.pen1 != null ? ` (${m.pen1})` : ''}` : '-';
                const s2 = m.played ? `${m.s2}${m.pen2 != null ? ` (${m.pen2})` : ''}` : '-';
                const win1 = m.played && m.winner === t1;
                const win2 = m.played && m.winner === t2;
                
                const h1Cls = t1.isHuman ? 'text-blue-300 font-bold' : (win1 ? 'text-slate-200' : 'text-slate-400');
                const h2Cls = t2.isHuman ? 'text-blue-300 font-bold' : (win2 ? 'text-slate-200' : 'text-slate-400');
                
                return `
                <div class="euro-tie ${m.played ? 'played' : ''}" data-tie="${comp}_${m.id}" style="margin-bottom: 6px; padding: 6px 8px; border: 1px solid #334155; border-radius: 8px; font-size: 11px; background: #0f172a; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
                    <div class="flex justify-between mb-1 ${win1 ? 'text-emerald-400' : ''}" data-seat="${comp}_${m.id}_1" data-team="${escapeHTML(m.t1 ? t1.name : '')}">
                        <span class="truncate pr-2 ${h1Cls}">${escapeHTML(t1.name)}</span>
                        <span class="font-mono font-bold ${win1 ? 'text-emerald-400' : 'text-slate-500'}" data-score="1">${s1}</span>
                    </div>
                    <div class="flex justify-between ${win2 ? 'text-emerald-400' : ''}" data-seat="${comp}_${m.id}_2" data-team="${escapeHTML(m.t2 ? t2.name : '')}">
                        <span class="truncate pr-2 ${h2Cls}">${escapeHTML(t2.name)}</span>
                        <span class="font-mono font-bold ${win2 ? 'text-emerald-400' : 'text-slate-500'}" data-score="2">${s2}</span>
                    </div>
                </div>`;
            }).join('');
            
            return `
            <div class="euro-round-col" style="flex: 1; min-width: 140px; display: flex; flex-direction: column; justify-content: space-around;">
                <div class="euro-round-head text-center text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">${shortRounds[i]}</div>
                <div class="flex flex-col justify-around h-full">${matchHtml}</div>
            </div>`;
        }).join('');

        return `<div class="euro-bracket-comp mb-8 p-4 bg-slate-900 rounded-xl border border-slate-700">
            <div class="flex items-center gap-3 mb-4">
                <span class="text-xs font-black uppercase tracking-widest ${comp === 'UCL' ? 'text-blue-400' : 'text-orange-400'}">${comp === 'UCL' ? 'Champions League' : 'Europa League'}</span>
                <span class="h-px flex-1 bg-slate-700"></span>
            </div>
            <div class="flex gap-4 w-full overflow-x-auto custom-scrollbar pb-2" style="min-height: 420px;">${columns}</div>
        </div>`;
    }).join('');

    const sub = document.getElementById('euro-bracket-sub');
    if (sub) {
        const next = (euro.queue || []).find(q => q.match)?.match;
        const nextMatch = next ? `${next.t1.name} vs ${next.t2.name}` : 'Tournament Finished';
        sub.innerHTML = `Knockout progress <span class="text-slate-500">· Next: ${escapeHTML(nextMatch)}</span>`;
    }

    animateEuroBracket(stage, before);
}

// What the screen showed before this repaint — who occupied each seat and which
// ties already had scores. The animation pass works entirely from that.
function euroBracketSnapshot(stage) {
    const seats = new Map();
    const played = new Set();
    stage.querySelectorAll('[data-seat]').forEach(el => seats.set(el.dataset.seat, el.dataset.team || ''));
    stage.querySelectorAll('[data-tie]').forEach(el => { if (el.classList.contains('played')) played.add(el.dataset.tie); });
    return { seats, played };
}

// A club that has just appeared in a round moves there from the tie that sent it
// through, and ties resolved off-screen uncover their scores one after another
// rather than all at once.
function animateEuroBracket(stage, before) {
    const silentSeats = EuroShow.silentPaint;
    EuroShow.silentPaint = false;
    EuroShow.clear();
    EuroShow.gen++;

    const moved = silentSeats ? [] : [...stage.querySelectorAll('[data-seat]')].filter(el =>
        el.dataset.team && before.seats.get(el.dataset.seat) !== el.dataset.team);
    if (moved.length) {
        // Round 0 is filled by the group stage, which has already been animated.
        const euroSeatKey = /^([A-Z]+)_R(\d)_(\d+)_(\d)$/;
        const bySeatTeam = new Map();
        stage.querySelectorAll('[data-seat]').forEach(el => {
            const m = euroSeatKey.exec(el.dataset.seat);
            if (m && el.dataset.team) bySeatTeam.set(`${m[1]}|${m[2]}|${el.dataset.team}`, el);
        });
        const flights = [];
        moved.forEach(el => {
            const m = euroSeatKey.exec(el.dataset.seat);
            if (!m) return;
            const from = bySeatTeam.get(`${m[1]}|${Number(m[2]) - 1}|${el.dataset.team}`);
            if (from) flights.push({ from, to: el, name: el.dataset.team });
        });
        const host = euroEl('euro-bracket-scroll');
        if (host && flights.length) {
            const hostRect = host.getBoundingClientRect();
            const targetRect = flights[0].to.getBoundingClientRect();
            if (targetRect.bottom > hostRect.bottom - 16 || targetRect.top < hostRect.top + 16)
                host.scrollTop += targetRect.top - hostRect.top - hostRect.height / 3;
        }
        flights.forEach((f, i) => {
            EuroShow.after(i * 90, () => {
                f.to.classList.add('seat-land');
                euroFly(f.from, f.to, f.name, () => f.to.classList.remove('seat-land'));
            });
        });
    }

    const fresh = [...stage.querySelectorAll('[data-tie]')].filter(el =>
        el.classList.contains('played') && !before.played.has(el.dataset.tie));
    fresh.forEach(el => el.querySelectorAll('[data-score]').forEach(s => s.classList.add('score-mask')));
    fresh.forEach((el, i) => EuroShow.after(200 + i * 240, () => {
        el.querySelectorAll('[data-score]').forEach(s => {
            s.classList.remove('score-mask');
            s.classList.add('score-live');
        });
    }));
}

function wireEuropeFinishButtons() {
    const btn = document.getElementById('btn-bracket-final');
    if (!btn) return;
    btn.textContent = 'Awards Ceremony 🏆';
    btn.onclick = () => showAwardsCeremony();
}

function showEuropeBracket() {
    const euro = gameState.europe;
    if (!euro) return;

    advanceEuroQueue();
    wireEuropeFinishButtons();

    euroVis(euroEl('euro-bracket-stage'), true);
    renderEuropeBracketScreen();
    Net.publishEurope();

    const btnNext = document.getElementById('btn-bracket-next');
    const btnFinal = document.getElementById('btn-bracket-final');

    if (btnNext) btnNext.onclick = euroBracketNextMatch;
    if (euro.queue.length > 0) {
        euroVis(btnNext, true);
        euroVis(btnFinal, false);
    } else {
        euroVis(btnNext, false);
        euroVis(btnFinal, true);
    }

    showScreen('screen-euro-bracket');
}

function euroBracketNextMatch() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host plays the ties.');
    const euro = gameState.europe;
    if (!euro || euro.queue.length === 0) { showAwardsCeremony(); return; }

    // Build the next human fixture and go straight into the match —
    // never show the intermediate screen-europe "Play Match" panel.
    advanceEuroQueue();
    if (!euro.queue.length) {
        showEuropeBracket();
        return;
    }

    const job = euro.queue[0];
    const { comp, roundIdx, match } = job;
    const roundName = EURO_ROUNDS[roundIdx];

    let h1 = match.t1.isHuman ? match.t1.humanRef : null;
    let h2 = match.t2.isHuman ? match.t2.humanRef : null;
    let opp = h1 ? match.t2 : match.t1;

    euro.seedCounter++;
    let ghostTeam = null;
    if (!opp.isHuman) {
        ghostTeam = buildEuroGhost(comp, roundIdx, euro.seedCounter * 31, opp);
        ghostTeam.name = opp.name;
    }

    euro.pending = { comp, roundIdx, roundName, match, human1: h1, human2: h2, ghost: ghostTeam, job };
    launchEuropeMatch();
}

// ============================================================
// AWARDS CEREMONY (shown after the European tournaments, before the final summary)
// ============================================================
// 'EU' | 'NON' | 'UNK' (no usable nationality data)
function nationalityRegion(nat) {
    const key = String(nat || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (!key || key === 'world' || key === 'unknown') return 'UNK';
    return EURO_NATIONALITY_SET.has(key) ? 'EU' : 'NON';
}

function euroOutcome(part) {
    if (!part || !part.competition || !part.path || !part.path.length) return null;
    const comp = part.competition;
    const name = comp === 'UCL' ? 'Champions League' : 'Europa League';
    let tier = 'r16', label = `${name} round of 16`;
    if (part.champion) { tier = 'champion'; label = `${name} winner`; }
    else if (part.roundReached === 'Final') { tier = 'final'; label = `${name} finalist`; }
    else if (part.roundReached === 'Semi-final') { tier = 'sf'; label = `${name} semi-finalist`; }
    else if (part.roundReached === 'Quarter-final') { tier = 'qf'; label = `${name} quarter-finalist`; }
    return { comp, tier, label, bonus: EURO_OUTCOME_POINTS[comp][tier] };
}
function leagueBonusForPos(pos) {
    if (!pos) return 0;
    return ({ 1: 14, 2: 9, 3: 6, 4: 4 })[pos] || (pos <= 8 ? 2 : 0);
}

// One record per human-drafted player: league + European numbers merged, plus team context
function buildAwardCandidates() {
    const season = gameState.season || {};
    const final = season.finalTable || [];
    const europe = gameState.europe;
    const out = [];
    // collectAllPlayerStats merges both spells of a transferred player and points
    // his record at the club that holds him now.
    const mergedLeague = new Map(collectAllPlayerStats().map(s => [String(s.id), s]));
    gameState.managers.forEach(m => {
        const row = final.find(r => r.isHuman && r.managerId === m.id) || null;
        const part = europe && europe.participants ? europe.participants.find(h => h.managerId === m.id) : null;
        const euro = (part && part.euroStats) || {};
        const outcome = euroOutcome(part);
        const euroTies = part && part.path ? part.path.length : 0;
        (m.squad || []).forEach(p => {
            const L = mergedLeague.get(String(p.id)) || {}, E = euro[p.id] || {};
            const ratingCount = (L.ratingCount || 0) + (E.ratingCount || 0);
            const c = {
                id: p.id, name: p.name, pos: p.mainPos, ovr: p.rating || 80,
                nationality: p.nationality || 'World', region: nationalityRegion(p.nationality),
                teamName: m.name, managerId: m.id, isGhost: false,
                leaguePos: row ? row.pos : null, outcome, euroTies,
                lApps: L.apps || 0, eApps: E.apps || 0,
                lGoals: L.goals || 0, eGoals: E.goals || 0,
                lAssists: L.assists || 0, eAssists: E.assists || 0,
                cleanSheets: (L.cleanSheets || 0) + (E.cleanSheets || 0),
                minutes: (L.minutes || 0) + (E.apps || 0) * 85
            };
            c.apps = c.lApps + c.eApps;
            c.goals = c.lGoals + c.eGoals;
            c.assists = c.lAssists + c.eAssists;
            c.avgRating = ratingCount ? ((L.ratingSum || 0) + (E.ratingSum || 0)) / ratingCount : 0;
            out.push(c);
        });
    });
    return out;
}

// Raw, unweighted building blocks of every "player of the year" score
function awardBase(c) {
    const role = ratingRole(c.pos);
    const goalW = role === 'GK' ? 4 : role === 'DEF' ? 2 : role === 'MID' ? 1.25 : 1;
    const assistW = role === 'ATT' ? 0.75 : role === 'MID' ? 0.85 : 1.1;
    const csW = role === 'GK' ? 0.45 : role === 'DEF' ? 0.3 : 0;
    const availability = clamp(c.minutes / 2700, 0.35, 1);
    const compMult = c.outcome && c.outcome.comp === 'UCL' ? 1 : 0.6;
    const euroShare = c.euroTies ? clamp(c.eApps / c.euroTies, 0, 1) : 0;
    const leagueShare = clamp(c.lApps / SEASON_MATCHDAYS, 0, 1);
    return {
        ratingPts: c.avgRating ? Math.max(0, c.avgRating - 6.2) * 38 * availability : 0,
        goalPts: c.goals * goalW,
        assistPts: c.assists * assistW,
        csPts: c.cleanSheets * csW,
        bigGamePts: (c.eGoals * 1.0 + c.eAssists * 0.6) * compMult,
        euroPts: c.outcome ? c.outcome.bonus * euroShare : 0,
        leaguePts: leagueBonusForPos(c.leaguePos) * leagueShare,
        prestigePts: Math.max(0, (c.ovr - 85) * 0.2)
    };
}

// Weights: how much each block counts for each award
function scoreForAward(c, key) {
    const f = AWARD_FORMULAS[key], b = awardBase(c);
    const avg = c.avgRating.toFixed(2);
    const ratingWord = c.avgRating >= 7.6 ? 'Elite' : c.avgRating >= 7.2 ? 'Outstanding' : 'Solid';
    const parts = [
        { pts: b.ratingPts * f.perf, text: `${ratingWord} ${avg} average rating` },
        { pts: (b.goalPts + b.assistPts) * f.perf, text: `${c.goals} goals & ${c.assists} assists` },
        { pts: b.csPts * f.perf, text: `${c.cleanSheets} clean sheets` },
        { pts: b.bigGamePts * f.big, text: `${c.eGoals}G ${c.eAssists}A on the European stage` },
        { pts: b.euroPts * f.euro, text: c.outcome ? c.outcome.label : '' },
        { pts: b.leaguePts * f.league, text: c.leaguePos === 1 ? 'League champion' : `Finished #${c.leaguePos} in the league` }
    ];
    const score = parts.reduce((s, p) => s + p.pts, 0) + b.prestigePts * f.prestige;
    const reasons = parts.filter(p => p.pts >= 1 && p.text).sort((a, b2) => b2.pts - a.pts).slice(0, 3).map(p => p.text);
    return { score, reasons };
}

function rankCandidates(list, key) {
    return list.map(c => ({ c, ...scoreForAward(c, key) }))
        .sort((a, b) => b.score - a.score || b.c.avgRating - a.c.avgRating || b.c.goals - a.c.goals);
}

function ceremonyChips(c) {
    const role = ratingRole(c.pos);
    const chips = [
        { k: 'Apps', v: c.apps }, { k: 'Goals', v: c.goals }, { k: 'Assists', v: c.assists },
        { k: 'Avg', v: c.avgRating ? c.avgRating.toFixed(2) : '—' }
    ];
    // Only keepers are judged on a shutout in front of the camera; a back four
    // gets the same attacking line as everyone else.
    chips.push(role === 'GK' ? { k: 'CS', v: c.cleanSheets } : { k: 'Euro G+A', v: c.eGoals + c.eAssists });
    return chips;
}

function computeCeremonyAwards() {
    const def = key => CEREMONY_AWARDS.find(a => a.key === key);
    const cands = buildAwardCandidates();
    const eligible = cands.filter(c => c.apps >= 10 && c.minutes >= 900);
    const pool = eligible.length ? eligible : cands.filter(c => c.apps > 0);
    // If the data has no real nationalities at all, don't lock anyone out of the regional awards
    const hasNationality = pool.some(c => c.region !== 'UNK');
    const isEuro = c => !hasNationality || c.region === 'EU';
    const isNon = c => !hasNationality || c.region === 'NON';

    const toYearly = (key, ranked, entry) => {
        const d = def(key);
        if (!entry) return { ...d, winner: null, score: 0, runnerUp: null, chips: [], reasons: ['No eligible player this season'] };
        const next = ranked.find(r => r !== entry);
        const c = entry.c;
        return {
            ...d,
            winner: { id: c.id, name: c.name, teamName: c.teamName, managerId: c.managerId, pos: c.pos, nationality: c.nationality, isGhost: false },
            score: entry.score,
            runnerUp: next ? { name: next.c.name, score: next.score } : null,
            chips: ceremonyChips(c), reasons: entry.reasons
        };
    };

    // The three "player of the year" awards go to three different people
    const ballonRank = rankCandidates(pool, 'ballon');
    const ballon = ballonRank[0] || null;
    const taken = new Set(ballon ? [ballon.c.id] : []);

    const euroRank = rankCandidates(pool.filter(isEuro), 'european');
    const euro = euroRank.find(r => !taken.has(r.c.id)) || euroRank[0] || null;
    if (euro) taken.add(euro.c.id);

    const worldRank = rankCandidates(pool.filter(isNon), 'world');
    const world = worldRank.find(r => !taken.has(r.c.id)) || worldRank[0] || null;

    // Golden Shoe: league goals ×2, then European goals, assists, fewer minutes. Includes rival league clubs.
    const shoeDef = def('shoe');
    const league = collectAllPlayerStats().filter(s => (s.minutes || 0) > 0);
    const shoePool = league.filter(s => s.minutes >= 600);
    const shoeList = (shoePool.length ? shoePool : league).map(s => {
        const mine = cands.find(c => c.id === s.id && c.managerId === s.teamId);
        const eg = mine ? mine.eGoals : 0;
        return { s, mine, eg, pts: s.goals * 2 * ghostAwardFactor(s) };
    }).sort((a, b) => b.pts - a.pts || b.eg - a.eg || b.s.assists - a.s.assists || a.s.minutes - b.s.minutes);
    const top = shoeList[0];
    let shoe;
    if (!top || top.s.goals <= 0) {
        shoe = { ...shoeDef, winner: null, score: 0, runnerUp: null, chips: [], reasons: ['Nobody scored enough to qualify'] };
    } else {
        const { s, mine } = top, next = shoeList[1];
        const gpg = s.apps ? (s.goals / s.apps).toFixed(2) : '0.00';
        const chips = [{ k: 'League G', v: s.goals }, { k: 'Assists', v: s.assists }, { k: 'Apps', v: s.apps }, { k: 'G/Game', v: gpg }];
        if (mine) chips.push({ k: 'Euro G', v: mine.eGoals });
        const reasons = [`Top league scorer with ${s.goals} goals`];
        if (next) reasons.push(next.pts === top.pts ? `Won the tie-break over ${next.s.name}` : `${top.pts - next.pts} pts clear of ${next.s.name}`);
        shoe = {
            ...shoeDef,
            winner: { id: s.id, name: s.name, teamName: s.team, managerId: mine ? mine.managerId : null, pos: s.mainPos, nationality: mine ? mine.nationality : '', isGhost: !mine },
            score: top.pts, runnerUp: next ? { name: next.s.name, score: next.pts } : null, chips, reasons
        };
    }

    return [toYearly('ballon', ballonRank, ballon), toYearly('european', euroRank, euro), toYearly('world', worldRank, world), shoe];
}

// ---------- Ceremony UI ----------
let ceremonyState = { token: 0, skip: false };

function injectCeremonyStyles() {
    if (document.getElementById('ceremony-styles')) return;
    const style = document.createElement('style');
    style.id = 'ceremony-styles';
    style.textContent = `
    .cer-wrap{width:100%;max-width:760px;margin:0 auto;padding:16px 12px 28px;overflow-y:auto;max-height:100%;}
    .cer-head{text-align:center;margin-bottom:12px;}
    .cer-kicker{font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#fbbf24;font-weight:800;}
    .cer-title{font-size:26px;font-weight:900;color:#fff;margin-top:2px;}
    .cer-status{font-size:12px;color:#94a3b8;margin-top:4px;min-height:16px;}
    .cer-frame{border:2px solid rgba(251,191,36,.55);border-radius:20px;padding:12px;background:linear-gradient(160deg,rgba(30,41,59,.92),rgba(15,23,42,.96));box-shadow:0 0 44px rgba(251,191,36,.12), inset 0 0 30px rgba(0,0,0,.45);}
    .cer-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .cer-slot{--accent:#fbbf24;--amp:0;position:relative;min-height:230px;border-radius:14px;border:1px solid #334155;background:#0b1220;padding:12px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden;transition:border-color .3s, box-shadow .3s;}
    .cer-slot .cer-ico{font-size:30px;filter:grayscale(1);opacity:.55;}
    .cer-slot .cer-sname{font-size:11px;font-weight:800;color:#cbd5e1;margin-top:6px;letter-spacing:.04em;}
    .cer-slot .cer-crit{font-size:9px;color:#64748b;margin-top:4px;max-width:90%;}
    .cer-slot .cer-q{font-size:34px;font-weight:900;color:#334155;margin-top:8px;}
    .cer-slot.shaking{animation:cerShake .09s infinite;border-color:var(--accent);box-shadow:0 0 calc(10px + var(--amp)*5px) var(--accent);}
    .cer-slot.shaking .cer-q{color:var(--accent);}
    @keyframes cerShake{
        0%{transform:translate(0,0) rotate(0)}
        20%{transform:translate(calc(var(--amp)*-1px),calc(var(--amp)*.6px)) rotate(calc(var(--amp)*-.35deg))}
        40%{transform:translate(calc(var(--amp)*1px),calc(var(--amp)*-.8px)) rotate(calc(var(--amp)*.3deg))}
        60%{transform:translate(calc(var(--amp)*-.8px),calc(var(--amp)*-.5px)) rotate(calc(var(--amp)*-.2deg))}
        80%{transform:translate(calc(var(--amp)*.9px),calc(var(--amp)*.7px)) rotate(calc(var(--amp)*.35deg))}
        100%{transform:translate(0,0) rotate(0)}
    }
    .cer-slot.revealed{border-color:var(--accent);background:radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent) 22%, #0b1220), #0b1220 70%);box-shadow:0 0 22px color-mix(in srgb, var(--accent) 35%, transparent);justify-content:flex-start;}
    .cer-slot.popped{animation:cerPop .65s cubic-bezier(.2,1.7,.4,1);}
    @keyframes cerPop{0%{transform:scale(.55);opacity:.3}55%{transform:scale(1.13)}100%{transform:scale(1);opacity:1}}
    .cer-in{opacity:0;transform:translateY(6px);animation:cerIn .45s forwards;}
    .cer-slot.instant .cer-in{animation:none;opacity:1;transform:none;}
    @keyframes cerIn{to{opacity:1;transform:none}}
    .cer-win-ico{font-size:30px;}
    .cer-win-award{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-top:2px;}
    .cer-win-name{font-size:17px;font-weight:900;color:#fff;margin-top:6px;line-height:1.15;}
    .cer-win-meta{font-size:10px;color:#94a3b8;margin-top:2px;}
    .cer-chips{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:8px;}
    .cer-chip{background:#111c30;border:1px solid #26344d;border-radius:8px;padding:2px 6px;min-width:42px;}
    .cer-chip b{display:block;font-size:13px;color:#fff;font-weight:900;line-height:1.1;}
    .cer-chip span{font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;}
    .cer-why{font-size:10px;color:#cbd5e1;margin-top:8px;line-height:1.35;}
    .cer-why em{color:var(--accent);font-style:normal;font-weight:800;}
    .cer-runner{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;padding:5px 10px;border-radius:999px;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.35);max-width:94%;}
    .cer-runner .cer-rlabel{font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;white-space:nowrap;}
    .cer-runner .cer-rname{font-size:12px;font-weight:800;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .cer-spark{position:absolute;left:50%;top:42%;width:6px;height:6px;border-radius:2px;background:var(--accent);pointer-events:none;animation:cerSpark .8s ease-out forwards;}
    @keyframes cerSpark{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
    .cer-actions{display:flex;gap:10px;justify-content:center;margin-top:16px;}
    .cer-btn{padding:10px 20px;border-radius:12px;font-weight:900;font-size:14px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer;}
    .cer-btn.primary{background:#22c55e;border-color:#22c55e;color:#0f172a;}
    .cer-btn.hidden{display:none;}
    @media (max-width:420px){.cer-slot{min-height:250px}.cer-win-name{font-size:15px}}
    `;
    document.head.appendChild(style);
}

function ensureCeremonyScreen() {
    let el = document.getElementById('screen-awards-ceremony');
    if (el) return el;
    injectCeremonyStyles();
    const ref = document.getElementById('screen-final-summary');
    el = document.createElement('div');
    el.id = 'screen-awards-ceremony';
    // Reuse the layout classes of the other screens so it behaves like them
    el.className = ref ? ref.className.replace(/\bactive\b/g, '').trim() : 'screen';
    if (!el.classList.contains('screen')) el.classList.add('screen');
    (ref && ref.parentNode ? ref.parentNode : document.body).appendChild(el);
    return el;
}

function ceremonySlotIdleHTML(a) {
    return `<div class="cer-ico">${a.icon}</div><div class="cer-sname">${escapeHTML(a.title)}</div><div class="cer-crit">${escapeHTML(a.criteria)}</div><div class="cer-q">?</div>`;
}

function ceremonySlotWinnerHTML(r) {
    if (!r.winner) {
        return `<div class="cer-win-ico cer-in">${r.icon}</div><div class="cer-win-award cer-in">${escapeHTML(r.title)}</div>
            <div class="cer-win-name cer-in" style="animation-delay:.1s;color:#94a3b8">Not awarded</div>`;
    }
    const w = r.winner;
    const meta = [w.pos, w.nationality && w.nationality !== 'World' ? w.nationality : '', w.teamName].filter(Boolean).map(escapeHTML).join(' · ');
    const chips = r.chips.map((c, i) => `<div class="cer-chip cer-in" style="animation-delay:${0.35 + i * 0.1}s"><b>${escapeHTML(String(c.v))}</b><span>${escapeHTML(c.k)}</span></div>`).join('');
    return `<div class="cer-win-ico cer-in">${r.icon}</div>
        <div class="cer-win-award cer-in">${escapeHTML(r.title)}</div>
        <div class="cer-win-name cer-in" style="animation-delay:.12s">${escapeHTML(w.name)}</div>
        <div class="cer-win-meta cer-in" style="animation-delay:.2s">${meta}</div>
        <div class="cer-chips">${chips}</div>
        ${r.runnerUp ? `<div class="cer-runner cer-in" style="animation-delay:1.05s"><span class="cer-rlabel">🥈 Runner-up</span><span class="cer-rname">${escapeHTML(r.runnerUp.name)}</span></div>` : ''}`;
}

function renderCeremonyShell(results) {
    const el = ensureCeremonyScreen();
    el.innerHTML = `
        <div class="cer-wrap">
            <div class="cer-head">
                <div class="cer-kicker">Season Honours</div>
                <div class="cer-title">Awards Ceremony</div>
                <div class="cer-status" id="cer-status">The envelopes are ready…</div>
            </div>
            <div class="cer-frame"><div class="cer-grid">
                ${results.map(r => `<div class="cer-slot" id="cer-slot-${r.key}" style="--accent:${r.accent}">${ceremonySlotIdleHTML(r)}</div>`).join('')}
            </div></div>
            <div class="cer-actions">
                <button class="cer-btn" id="cer-skip" onclick="skipCeremony()">Skip ⏭</button>
                <button class="cer-btn primary hidden" id="cer-continue" onclick="finishCeremony()">View Final Summary →</button>
            </div>
        </div>`;
}

function ceremonyWait(ms, token) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            if (ceremonyState.token !== token) return reject(new Error('ceremony-cancelled'));
            if (ceremonyState.skip || Date.now() - started >= ms) return resolve();
            setTimeout(tick, 40);
        };
        tick();
    });
}

async function ceremonyShake(slot, ms, token) {
    slot.classList.add('shaking');
    const started = Date.now();
    const timer = setInterval(() => {
        const t = clamp((Date.now() - started) / ms, 0, 1);
        slot.style.setProperty('--amp', (1 + t * 6).toFixed(2));
    }, 40);
    try { await ceremonyWait(ms, token); }
    finally { clearInterval(timer); slot.classList.remove('shaking'); slot.style.setProperty('--amp', 0); }
}

function ceremonyBurst(slot) {
    for (let i = 0; i < 22; i++) {
        const s = document.createElement('div');
        const ang = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 90;
        s.className = 'cer-spark';
        s.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
        s.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
        s.style.animationDelay = `${Math.random() * 0.08}s`;
        slot.appendChild(s);
        setTimeout(() => s.remove(), 1000);
    }
}

function revealCeremonySlot(r, animate) {
    const slot = document.getElementById(`cer-slot-${r.key}`);
    if (!slot) return;
    slot.classList.add('revealed');
    slot.classList.toggle('instant', !animate);
    slot.innerHTML = ceremonySlotWinnerHTML(r);
    if (animate) {
        slot.classList.add('popped');
        ceremonyBurst(slot);
        setTimeout(() => slot.classList.remove('popped'), 800);
    }
}

async function runCeremonySequence(results, token) {
    const status = document.getElementById('cer-status');
    try {
        for (const r of results) {
            const slot = document.getElementById(`cer-slot-${r.key}`);
            if (!slot) continue;
            if (!ceremonyState.skip) {
                if (status) status.textContent = `And the winner of the ${r.title} is…`;
                await ceremonyShake(slot, 1600, token);
            }
            revealCeremonySlot(r, !ceremonyState.skip);
            if (!ceremonyState.skip) await ceremonyWait(1700, token);
        }
        if (status) status.textContent = 'Congratulations to all the winners!';
        document.getElementById('cer-skip')?.classList.add('hidden');
        document.getElementById('cer-continue')?.classList.remove('hidden');
    } catch (err) {
        if (!err || err.message !== 'ceremony-cancelled') console.error('[Ceremony]', err);
    }
}

function skipCeremony() { ceremonyState.skip = true; }

function finishCeremony() {
    ceremonyState.token++; // cancel any running sequence
    showFinalSummary();
}

function showAwardsCeremony() {
    try {
        if (!gameState.season) { showFinalSummary(); return; }
        if (!gameState.season.ceremony) gameState.season.ceremony = computeCeremonyAwards();
        const results = gameState.season.ceremony;
        Net.publishSeason();
        renderCeremonyShell(results);
        showScreen('screen-awards-ceremony');
        const token = ++ceremonyState.token;
        ceremonyState.skip = false;
        setTimeout(() => runCeremonySequence(results, token), 800);
    } catch (err) {
        console.error('[Ceremony] failed, going straight to summary', err);
        showFinalSummary();
    }
}

function showFinalSummary() {
    const final = gameState.season.finalTable;
    const awards = gameState.season.awards || {};
    const participants = (gameState.europe && gameState.europe.participants) || gameState.managers.map(m => {
        const row = final.find(r => r.isHuman && r.managerId === m.id);
        return { managerId: m.id, name: m.name, leaguePos: row ? row.pos : 99, competition: null, eliminated: true, champion: false, path: [], roundReached: null };
    });

    const awardBelongsTo = (award, participant) => Boolean(award && (
        award.teamId != null ? award.teamId === participant.managerId : award.team === participant.name
    ));

    const scoreTeam = (h) => {
        let pts = 0;
        pts += Math.max(0, 21 - h.leaguePos) * 3;
        if (h.champion && h.competition === 'UCL') pts += 50;
        else if (h.champion && h.competition === 'UEL') pts += 35;
        else if (h.roundReached === 'Final') pts += h.competition === 'UCL' ? 30 : 20;
        else if (h.roundReached === 'Semi-final') pts += h.competition === 'UCL' ? 18 : 12;
        else if (h.roundReached === 'Quarter-final') pts += h.competition === 'UCL' ? 10 : 7;
        else if (h.roundReached === 'Round of 16') pts += h.competition === 'UCL' ? 5 : 3;
        
        if (awardBelongsTo(awards.topScorer, h)) pts += 8;
        if (awardBelongsTo(awards.topAssist, h)) pts += 6;
        if (awardBelongsTo(awards.goldenGlove, h)) pts += 6;
        if (awardBelongsTo(awards.potm, h)) pts += 12;
        
        if (h.leaguePos === 1) pts += 15;
        return pts;
    };

    const ranked = participants.map(h => ({ ...h, bestScore: scoreTeam(h) })).sort((a, b) => b.bestScore - a.bestScore);
    const best = ranked[0];

    if (gameState.managers.length === 1 && best) {
        document.getElementById('best-team-banner').innerHTML = `Season score: <span class="text-amber-300 font-black">${best.bestScore}</span> pts`;
    } else {
        document.getElementById('best-team-banner').innerHTML = best ? `⭐ Best Team of the Season: <span class="text-amber-300 font-black">${escapeHTML(best.name)}</span> <span class="text-slate-500">(${best.bestScore} pts)</span>` : '—';
    }

    const cards = document.getElementById('final-summary-cards');
    cards.innerHTML = ranked.map((h, idx) => {
        const cups = [];
        if (h.leaguePos === 1) cups.push('League Title');
        if (h.champion && h.competition === 'UCL') cups.push('UCL Champions');
        if (h.champion && h.competition === 'UEL') cups.push('Europa Champions');
        if (!h.champion && h.roundReached === 'Final') cups.push(`${h.competition} Runners-up`);

        const inds = [];
        if (awardBelongsTo(awards.topScorer, h)) inds.push(`Golden Boot (${escapeHTML(awards.topScorer.name)})`);
        if (awardBelongsTo(awards.topAssist, h)) inds.push(`Best Playmaker (${escapeHTML(awards.topAssist.name)})`);
        if (awardBelongsTo(awards.goldenGlove, h)) inds.push(`Golden Glove (${escapeHTML(awards.goldenGlove.name)})`);
        if (awardBelongsTo(awards.potm, h)) inds.push(`Player of the Season (${escapeHTML(awards.potm.name)})`);
        (gameState.season.ceremony || []).forEach(a => {
            if (a.winner && !a.winner.isGhost && a.winner.managerId === h.managerId) inds.push(`${a.title} (${escapeHTML(a.winner.name)})`);
        });

        let euroLine = 'Did not qualify for Europe';
        if (h.competition === 'UCL') euroLine = h.champion ? 'UCL Champions 🏆' : (h.roundReached ? `UCL · reached ${h.roundReached}` : 'UCL · exited early');
        if (h.competition === 'UEL') euroLine = h.champion ? 'Europa Champions 🏆' : (h.roundReached ? `Europa · reached ${h.roundReached}` : 'Europa · exited early');

        const medal = idx === 0 ? '⭐' : `#${idx + 1}`;

        return `<div class="award-card border ${idx === 0 ? 'border-amber-500/50' : 'border-slate-700'}">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <div class="text-lg font-black text-white">${medal} ${escapeHTML(h.name)}</div>
                    <div class="text-xs text-slate-400">Season score: <span class="text-amber-300 font-bold">${h.bestScore}</span></div>
                </div>
                <div class="text-right text-xs text-slate-400">League <span class="text-white font-bold">#${h.leaguePos}</span></div>
            </div>
            <div class="text-sm text-slate-300 mb-1"><span class="text-slate-500">Europe:</span> ${euroLine}</div>
            <div class="text-sm text-slate-300 mb-1"><span class="text-slate-500">Cups:</span> ${cups.length ? cups.map(c => `<span class="text-yellow-300">${c}</span>`).join(', ') : '<span class="text-slate-500">None</span>'}</div>
            <div class="text-sm text-slate-300"><span class="text-slate-500">Individual:</span> ${inds.length ? inds.join(', ') : '<span class="text-slate-500">None</span>'}</div>
        </div>`;
    }).join('');

    showScreen('screen-final-summary');
    // The run is over: nothing left to resume from the main menu.
    if (typeof SaveGame !== 'undefined' && !Net.online) SaveGame.markFinished();
}

function renderBracket() {
    const guest = Net.online && !Net.ownsGame();
    const q = guest ? (gameState.remoteQueue || []) : gameState.matchQueue;
    if (q.length === 0) {
        // A guest device follows the host's screen; only the host ends the run.
        if (guest) return;
        return leaveGameToMenu();
    }

    const isH2H = gameState.mode === 'H2H';
    const titleEl = document.getElementById('bracket-title');
    if (titleEl) titleEl.innerText = isH2H ? 'Head to Head' : 'Tournament Bracket';
    const nextBtn = document.getElementById('btn-next-match');
    if (nextBtn) {
        nextBtn.innerText = isH2H ? 'Play Match ⚔️' : 'Play Next Match';
        if (guest) { nextBtn.disabled = true; nextBtn.classList.add('opacity-40', 'cursor-not-allowed'); }
    }
    
    const list = document.getElementById('bracket-queue');
    list.innerHTML = q.map((m, i) => {
        const n1 = escapeHTML(m.t1.name);
        const n2 = escapeHTML(m.t2.name);
        const active = i === 0 ? 'bg-blue-900 border-blue-500 scale-105' : 'bg-slate-800 border-slate-700 opacity-70';
        return `<div class="p-4 rounded-xl border-2 ${active} shadow flex justify-between font-bold items-center transition-all">
            ${isH2H ? '' : `<span class="text-sm text-slate-400 w-24 text-left">${m.label}</span>`}
            <span class="text-white flex-1 text-right pr-4">${n1}</span>
            <span class="text-yellow-500 px-2 text-xl font-black">VS</span>
            <span class="text-white flex-1 text-left pl-4">${n2}</span>
        </div>`;
    }).join('');
    
    showScreen('screen-bracket');
}

function startNextMatch() {
    if (Net.online && !Net.ownsGame()) return showToast('Only the host plays the matches.');
    const match = gameState.matchQueue.shift();
    if (!match) return;
    gameState.currentMatchData = match;
    Net.publishInfo();

    prepareMatchScreen(match.label, match.t1.name, match.t2.name);
    forceCloseMatchRatings();
    showScreen('screen-match');
    simulateMatchSequence(match.t1, match.t2);
}

