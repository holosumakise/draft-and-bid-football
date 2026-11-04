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
    const variance = () => Math.round((Math.random() * 6) - 3);
    const stats = {
        PAC: clamp(ovr + variance(), 45, 105), SHO: clamp(ovr + variance(), 40, 105),
        PAS: clamp(ovr + variance(), 45, 105), DRI: clamp(ovr + variance(), 45, 105),
        DEF: clamp(ovr + variance(), 40, 105), PHY: clamp(ovr + variance(), 45, 105)
    };
    if (pos === 'GK') {
        stats.SHO = clamp(stats.SHO - 20, 20, 55);
        stats.PAC = clamp(stats.PAC - 12, 30, 70);
        stats.DEF = clamp(stats.DEF + 6, 60, 105);
    }
    const fi = Math.abs((idx * 17 + pos.charCodeAt(0) * 3) % GHOST_FIRST.length);
    const li = Math.abs((idx * 31 + (club || '').length * 7) % GHOST_LAST.length);
    const name = `${GHOST_FIRST[fi]} ${GHOST_LAST[li]}`;
    return {
        id: 90000 + idx, name, rating: ovr, displayOVR: String(Math.min(99, ovr)),
        rank: null, stats, mainPos: pos, subPos: [], team: club, era: 'ghost', nationality: 'World'
    };
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

function drawRatingActions(pos) {
    const mean = RATING_ACTION_MEAN[pos] || RATING_ACTION_MEAN.CM;
    return { defActions: samplePoisson(mean.def), keyPasses: samplePoisson(mean.key) };
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
    return (team.lineup || [])
        .filter(slot => slot?.player)
        .map(slot => ({ ...slot, yel: 0 }));
}

// League matches are not minute-by-minute, so substitutions are planned up front:
// starters sometimes leave early and a bench player inherits the remaining minutes.
// Without this, only the XI ever appears on the season team-stats board.
function planLeagueAppearances(team) {
    const starters = selectActiveLineup(team);
    const bench = (team.bench || []).filter(Boolean).slice();
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

    const usedBench = new Set();
    let subsMade = 0;
    const maxSubs = typeof MAX_SUBS === 'number' ? MAX_SUBS : 5;
    const appearances = [];

    starters.forEach(slot => {
        let minutes = 90;
        let yellow = false;
        let red = false;
        const cardRoll = Math.random();
        if (cardRoll < 0.012) {
            red = true;
            minutes = Math.min(minutes, 30 + Math.floor(Math.random() * 40));
        } else if (cardRoll < 0.082) {
            yellow = true;
        }

        // Planned rotation / injury / tactical change — only if a bench option exists.
        if (!red && subsMade < maxSubs) {
            let subOff = false;
            if (Math.random() < 0.14) {
                minutes = 60 + Math.floor(Math.random() * 25); // 60–84
                subOff = true;
            } else if (Math.random() < 0.04) {
                minutes = 45 + Math.floor(Math.random() * 20); // 45–64
                subOff = true;
            }
            if (subOff) {
                const inn = pickBench(slot.pos, usedBench);
                if (inn) {
                    usedBench.add(inn.id);
                    subsMade++;
                    const rest = Math.max(1, 90 - minutes);
                    appearances.push({
                        player: slot.player, pos: slot.pos, minutes, yellow, red, fromStart: true
                    });
                    appearances.push({
                        player: inn, pos: slot.pos, minutes: rest, yellow: false, red: false, fromStart: false
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
                    player: slot.player, pos: slot.pos, minutes, yellow, red, fromStart: true
                });
                appearances.push({
                    player: inn, pos: slot.pos, minutes: rest, yellow: false, red: false, fromStart: false
                });
                return;
            }
        }

        appearances.push({
            player: slot.player, pos: slot.pos, minutes, yellow, red, fromStart: true
        });
    });

    return appearances;
}

function applySideMatchEffects(team, playerStats, goalsAgainst, trackScoring) {
    if (!playerStats) return;
    const isDefPos = position => ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position);
    const cleanSheet = goalsAgainst === 0;
    const appearances = planLeagueAppearances(team);

    appearances.forEach(entry => {
        const stats = playerStats[entry.player.id];
        if (!stats) return;

        if (entry.red) stats.reds++;
        else if (entry.yellow) stats.yellows++;

        stats.apps++;
        stats.minutes += entry.minutes;
        // Clean sheets only count for players who saw most of the match on a defensive line.
        if (cleanSheet && isDefPos(entry.pos) && entry.minutes >= 45) stats.cleanSheets++;
        if (entry.pos === 'GK') {
            // Scale goals conceded by share of the match for backup keepers.
            stats.goalsConcededAsGK += goalsAgainst * (entry.minutes / 90);
        }

        // Goals/assists stay on the players the scoring model named (almost always starters).
        const goalsByPlayer = entry.fromStart
            ? trackScoring.goals.filter(id => id === entry.player.id).length
            : 0;
        const assistsByPlayer = entry.fromStart
            ? trackScoring.assists.filter(id => id === entry.player.id).length
            : 0;
        if (goalsByPlayer) stats.goals += goalsByPlayer;
        if (assistsByPlayer) stats.assists += assistsByPlayer;

        const actions = drawRatingActions(entry.pos);
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
}

function simulateLeagueMatch(teamA, teamB, statsA, statsB) {
    const originalLineupA = teamA.lineup;
    const originalLineupB = teamB.lineup;
    teamA.lineup = selectActiveLineup(teamA);
    teamB.lineup = selectActiveLineup(teamB);

    try {
        // ATT/MID/DEF edge + home advantage, then the same full match-plan matchup
        // the live engine uses. Home advantage is a small nudge, not a different model.
        const breakdownA = getStrengthBreakdown(teamA);
        const breakdownB = getStrengthBreakdown(teamB);
        const edge = EngineCore.matchupEdge(breakdownA, breakdownB);
        const expected = EngineCore.expectedGoals({
            edge,
            base: BASE_EXPECTED_GOALS_PER_TEAM,
            coefficient: MATCH_STRENGTH_COEFFICIENT,
            homeAdvantage: LEAGUE_HOME_ADVANTAGE
        });
        const tactics = getTacticsMatchupFor(teamA.tactics, teamB.tactics);
        const lambdaA = clamp(expected.lambdaA * tactics.a.attack * tactics.b.concede, 0.2, 4.0);
        const lambdaB = clamp(expected.lambdaB * tactics.b.attack * tactics.a.concede, 0.2, 4.0);

        let goalsForA = EngineCore.samplePoisson(lambdaA);
        let goalsForB = EngineCore.samplePoisson(lambdaB);
        // Natural Poisson results — no forced late winners (real pro draw rate ≈ 23–26%)
        const resultA = goalsForA > goalsForB ? 'W' : goalsForA === goalsForB ? 'D' : 'L';
        const resultB = goalsForB > goalsForA ? 'W' : goalsForA === goalsForB ? 'D' : 'L';

        const goalIdsA = [], assistIdsA = [];
        for (let index = 0; index < goalsForA; index++) {
            const kind = Math.random() < tactics.a.setPieceShare
                ? 'setpiece'
                : (Math.random() < clamp(tactics.a.counterBoost * 1.4, 0, 0.45) ? 'counter' : 'open');
            const goal = getGoal(teamA, kind);
            if (goal.scorerId >= 0) goalIdsA.push(goal.scorerId);
            if (goal.assisterId != null) assistIdsA.push(goal.assisterId);
        }
        const goalIdsB = [], assistIdsB = [];
        for (let index = 0; index < goalsForB; index++) {
            const kind = Math.random() < tactics.b.setPieceShare
                ? 'setpiece'
                : (Math.random() < clamp(tactics.b.counterBoost * 1.4, 0, 0.45) ? 'counter' : 'open');
            const goal = getGoal(teamB, kind);
            if (goal.scorerId >= 0) goalIdsB.push(goal.scorerId);
            if (goal.assisterId != null) assistIdsB.push(goal.assisterId);
        }

        applySideMatchEffects(teamA, statsA, goalsForB, { goals: goalIdsA, assists: assistIdsA, result: resultA });
        applySideMatchEffects(teamB, statsB, goalsForA, { goals: goalIdsB, assists: assistIdsB, result: resultB });
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

    let lastSnapshot = null;
    const humanSeries = {};
    humans.forEach(team => {
        humanSeries[team.id] = { id: team.id, name: team.name, managerId: team.managerId, positions: [], results: [] };
    });

    for (let matchday = 1; matchday <= SEASON_MATCHDAYS; matchday++) {
        for (const [teamA, teamB] of schedule[matchday - 1]) {
            const statsA = getSeasonStatsForTeam(teamA, playerStatsByManager, ghostStatsById);
            const statsB = getSeasonStatsForTeam(teamB, playerStatsByManager, ghostStatsById);
            const { gf, ga, result } = simulateLeagueMatch(teamA, teamB, statsA, statsB);
            const resultB = result === 'W' ? 'L' : result === 'L' ? 'W' : 'D';

            applyMatchResult(rowsById.get(teamA.id), gf, ga, result);
            applyMatchResult(rowsById.get(teamB.id), ga, gf, resultB);
            if (humanSeries[teamA.id]) humanSeries[teamA.id].results.push(result);
            if (humanSeries[teamB.id]) humanSeries[teamB.id].results.push(resultB);
        }

        const ranked = sortLeagueTable(table);
        ranked.forEach((row, index) => {
            row._pos = index + 1;
            if (humanSeries[row.id]) humanSeries[row.id].positions.push(row._pos);
        });

        lastSnapshot = ranked.map(row => ({
            id: row.id, name: row.name, isHuman: row.isHuman, managerId: row.managerId,
            p: row.p, w: row.w, d: row.d, l: row.l,
            gf: row.gf, ga: row.ga, gd: row.gd, pts: row.pts, pos: row._pos
        }));
    }

    const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24'];
    const seriesList = Object.values(humanSeries).map((series, index) => ({ ...series, color: colors[index % colors.length] }));
    gameState.season = {
        finalTable: lastSnapshot,
        playerStatsByManager,
        ghostStatsById,
        humanSeries: seriesList,
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
    animateSeasonChart(0);
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
            <span id="wdl-record-${s.id}" class="text-[10px] text-slate-400 font-mono w-16 text-right shrink-0">0-0-0</span>
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

function animateSeasonChart(mdIndex) {
    const total = SEASON_MATCHDAYS;
    if (mdIndex > total) {
        document.getElementById('season-md-label').classList.remove('md-pulse');
        document.getElementById('season-md-label').innerText = 'Season complete';
        const wrap = document.getElementById('season-next-wrap');
        if (wrap) { wrap.classList.remove('hidden'); wrap.classList.add('flex'); }
        return;
    }
    document.getElementById('season-md-label').innerText = `Matchday ${mdIndex} / ${total}`;
    document.getElementById('season-progress-bar').style.width = `${(mdIndex / total) * 100}%`;
    drawSeasonChart(mdIndex);
    updateWdlStrips(mdIndex);

    let delay = 85;
    if (mdIndex < 3 || mdIndex > 34) delay = 140;
    if (mdIndex % 5 === 0) delay = 180;
    setTimeout(() => animateSeasonChart(mdIndex + 1), delay);
}

function collectAllPlayerStats() {
    const all = [];
    const byMgr = gameState.season.playerStatsByManager;
    if (byMgr) {
        Object.keys(byMgr).forEach(mid => {
            Object.values(byMgr[mid]).forEach(st => all.push(st));
        });
    }
    const ghostStats = gameState.season.ghostStatsById;
    if (ghostStats) {
        Object.keys(ghostStats).forEach(gid => {
            Object.values(ghostStats[gid]).forEach(st => all.push(st));
        });
    }
    return all;
}

function showSeasonResults() {
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

    const xiBox = document.getElementById('season-xi-stats');
    const byMgr = gameState.season.playerStatsByManager;
    xiBox.innerHTML = gameState.managers.map(m => {
        const stats = Object.values(byMgr[m.id] || {}).filter(s => (s.minutes || 0) > 0)
            .sort((a, b) => {
                const ra = a.ratingCount ? a.ratingSum / a.ratingCount : 0;
                const rb = b.ratingCount ? b.ratingSum / b.ratingCount : 0;
                return rb - ra;
            });
        const rows = stats.map(s => {
            const avg = s.ratingCount ? (s.ratingSum / s.ratingCount).toFixed(2) : '—';
            const mins = s.minutes || 0;
            return `<tr class="border-b border-slate-800/80">
                <td class="py-1 pr-2 text-slate-400 text-[10px] font-bold">${s.mainPos}</td>
                <td class="py-1 pr-2 text-white text-xs font-semibold truncate max-w-[120px]">${escapeHTML(s.name)}</td>
                <td class="py-1 px-1 text-center text-xs text-slate-300">${mins}'</td>
                <td class="py-1 px-1 text-center text-xs text-emerald-400 font-bold">${s.goals}</td>
                <td class="py-1 px-1 text-center text-xs text-blue-400 font-bold">${s.assists}</td>
                <td class="py-1 px-1 text-center text-xs text-amber-300 font-black">${avg}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="text-slate-500 text-xs py-2">No minutes tracked.</td></tr>';
        return `<div class="mb-5">
            <h3 class="text-sm font-bold text-emerald-400 mb-2">${escapeHTML(m.name)} · Squad Stats</h3>
            <div class="overflow-x-auto rounded-lg border border-slate-700">
                <table class="w-full text-left">
                    <thead class="bg-slate-800 text-[10px] uppercase text-slate-500">
                        <tr>
                            <th class="py-1.5 px-2">Pos</th><th class="py-1.5 px-2">Player</th>
                            <th class="py-1.5 px-1 text-center">Mins</th><th class="py-1.5 px-1 text-center">G</th>
                            <th class="py-1.5 px-1 text-center">A</th><th class="py-1.5 px-1 text-center">Sofa</th>
                        </tr>
                    </thead>
                    <tbody class="px-2">${rows}</tbody>
                </table>
            </div>
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
        { title: 'Golden Boot', icon: '⚽', sub: topScorer ? `${topScorer.goals} goals` : '—', name: topScorer?.name },
        { title: 'Best Playmaker', icon: '🅰️', sub: topAssist ? `${topAssist.assists} assists` : '—', name: topAssist?.name },
        { title: 'Golden Glove', icon: '🧤', sub: goldenGlove ? `${goldenGlove.cleanSheets} clean sheets` : '—', name: goldenGlove?.name },
        { title: 'Player of the Season', icon: '⭐', sub: potm ? `${avgRating(potm)} Sofa · ${potm.goals}G ${potm.assists}A` : '—', name: potm?.name }
    ];

    document.getElementById('season-awards').innerHTML = awards.map(a => `
        <div class="award-card">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${a.icon} ${a.title}</div>
            <div class="text-lg font-black text-white truncate">${a.name ? escapeHTML(a.name) : '—'}</div>
            <div class="text-xs text-slate-400 mt-1">${a.sub}</div>
        </div>
    `).join('');

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
    m.s1 = EngineCore.samplePoisson(expected.lambdaA);
    m.s2 = EngineCore.samplePoisson(expected.lambdaB);

    if (m.s1 === m.s2) {
        // Weighted shootout: the stronger side still has to earn it from 12 yards.
        const p1Wins = clamp(0.5 + edge * 0.025, 0.25, 0.75);
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
        participants: humans, brackets: {}, queue: [], currentRoundIdx: 0,
        pending: null, seedCounter: 0, bracketPending: false
    };

    ['UCL', 'UEL'].forEach(comp => {
        const compHumans = humans.filter(h => h.competition === comp);
        if (!compHumans.length) return;
        
        const teams = compHumans.map(h => ({ name: h.name, isHuman: true, humanRef: h }));
        const usedNames = new Set(compHumans.map(h => h.name));
        
        while (teams.length < 16) {
            const club = drawEuroOpponent(comp, 0, usedNames);
            usedNames.add(club.name);
            teams.push({ name: club.name, isHuman: false, tier: club.tier });
        }
        
        for (let i = 15; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teams[i], teams[j]] = [teams[j], teams[i]];
        }
        
        const bracket = [ [], [], [], [] ];
        for (let i = 0; i < 8; i++) {
            bracket[0].push({ id: `R0_${i}`, t1: teams[i*2], t2: teams[i*2+1], played: false });
        }
        for (let r = 1; r < 4; r++) {
            for (let i = 0; i < 8 / Math.pow(2, r); i++) {
                bracket[r].push({ id: `R${r}_${i}`, t1: null, t2: null, played: false });
            }
        }
        gameState.europe.brackets[comp] = bracket;
    });
    
    advanceEuroQueue();

    if (!gameState.europe.queue.length) return showAwardsCeremony();

    showEuropeBracket();
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
    return {
        ...team,
        lineup: (team.lineup || []).map(slot => ({ ...slot, yel: 0, min: 0 })),
        bench: (team.bench || []).slice(),
        reserves: (team.reserves || []).slice(),
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
                <div class="euro-tie ${m.played ? 'played' : ''}" style="margin-bottom: 6px; padding: 6px 8px; border: 1px solid #334155; border-radius: 8px; font-size: 11px; background: #0f172a; box-shadow: inset 0 0 10px rgba(0,0,0,0.5);">
                    <div class="flex justify-between mb-1 ${win1 ? 'text-emerald-400' : ''}">
                        <span class="truncate pr-2 ${h1Cls}">${escapeHTML(t1.name)}</span>
                        <span class="font-mono font-bold ${win1 ? 'text-emerald-400' : 'text-slate-500'}">${s1}</span>
                    </div>
                    <div class="flex justify-between ${win2 ? 'text-emerald-400' : ''}">
                        <span class="truncate pr-2 ${h2Cls}">${escapeHTML(t2.name)}</span>
                        <span class="font-mono font-bold ${win2 ? 'text-emerald-400' : 'text-slate-500'}">${s2}</span>
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
    
    renderEuropeBracketScreen();
    Net.publishEurope();
    
    const btnNext = document.getElementById('btn-bracket-next');
    const btnFinal = document.getElementById('btn-bracket-final');
    
    if (btnNext) btnNext.onclick = euroBracketNextMatch;
    if (euro.queue.length > 0) {
        if (btnNext) btnNext.classList.remove('hidden');
        if (btnFinal) btnFinal.classList.add('hidden');
    } else {
        if (btnNext) btnNext.classList.add('hidden');
        if (btnFinal) btnFinal.classList.remove('hidden');
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
    gameState.managers.forEach(m => {
        const row = final.find(r => r.isHuman && r.managerId === m.id) || null;
        const part = europe && europe.participants ? europe.participants.find(h => h.managerId === m.id) : null;
        const league = (season.playerStatsByManager && season.playerStatsByManager[m.id]) || {};
        const euro = (part && part.euroStats) || {};
        const outcome = euroOutcome(part);
        const euroTies = part && part.path ? part.path.length : 0;
        (m.squad || []).forEach(p => {
            const L = league[p.id] || {}, E = euro[p.id] || {};
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
    chips.push(role === 'GK' || role === 'DEF' ? { k: 'CS', v: c.cleanSheets } : { k: 'Euro G+A', v: c.eGoals + c.eAssists });
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

