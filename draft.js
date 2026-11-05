
// ============================================================
// STATS & OVR SYSTEM
// ============================================================


function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function generateStatsFromRating(baseRating, mainPos) {
    const w = POS_WEIGHTS[mainPos] || POS_WEIGHTS.CM;
    const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const maxW = Math.max(...keys.map(k => w[k] ?? 0.05));
    // Tight noise so higher-OVR players stay consistently strong without wild spikes
    const noise = () => (Math.random() * 5 - 2.5);

    let stats = {};
    for (const k of keys) {
        const importance = (w[k] ?? 0.05) / maxW; // 0..1 relative to position's top attribute
        // Primary attributes sit near/above OVR; weak attributes fall well below it
        const offset = importance * 7 - (1 - importance) * 16;
        stats[k] = Math.round(baseRating + offset + noise());
    }

    for (const k of keys) stats[k] = clamp(stats[k], 40, 110);

    if (mainPos === 'GK') {
        // Keepers: hands/reflexes/positioning map to DEF/PHY; kicking (SHO) and speed stay low
        stats.SHO = clamp(Math.round(baseRating * 0.35 + noise()), 20, 55);
        stats.PAC = clamp(Math.round(baseRating * 0.55 + noise()), 30, 72);
        stats.PAS = clamp(Math.round(baseRating * 0.72 + noise()), 40, 95);
        stats.DRI = clamp(Math.round(baseRating * 0.70 + noise()), 40, 95);
        stats.DEF = clamp(Math.round(baseRating + 4 + noise()), 60, 110);
        stats.PHY = clamp(Math.round(baseRating + 2 + noise()), 55, 110);
    }
    return stats;
}

function calculateOVRFromStats(stats, mainPos) {
    const w = POS_WEIGHTS[mainPos] || POS_WEIGHTS.CM;
    const raw = stats.PAC*w.PAC + stats.SHO*w.SHO + stats.PAS*w.PAS + stats.DRI*w.DRI + stats.DEF*w.DEF + stats.PHY*w.PHY;
    return Math.round(raw);
}

function getRankInfo(ovr) {
    if (ovr >= 106) return { rank: 'GOAT', display: '🐐', color: 'from-amber-300 to-yellow-500 text-slate-900', badge: '🐐' };
    if (ovr >= 101) return { rank: 'INVINCIBLE', display: '🛡️', color: 'from-purple-400 to-fuchsia-500 text-white', badge: '🛡️' };
    return { rank: null, display: String(Math.min(100, ovr)), color: 'from-green-400 to-green-600 text-slate-900', badge: '' };
}


function targetOVRForRank(i) {
    return RANK_OVR_TABLE[i] ?? 85;
}

function enrichPlayer(p, rankIndex = 99) {
    const ovr = rankIndex < RANK_OVR_TABLE.length ? targetOVRForRank(rankIndex) : 85;
    const mainPos = typeof p.mainPos === 'string' ? p.mainPos : 'CM';
    const stats = generateStatsFromRating(ovr, mainPos);
    const w = POS_WEIGHTS[mainPos] || POS_WEIGHTS.CM;
    const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];

    // Soft-cap attributes that barely affect this position's OVR
    if (mainPos !== 'GK') {
        keys.forEach(k => {
            const weight = w[k] ?? 0;
            if (weight < 0.10) stats[k] = Math.min(stats[k], ovr - 14);
            else if (weight < 0.15) stats[k] = Math.min(stats[k], ovr - 6);
        });
    }

    // Converge toward target OVR by nudging weighted attributes proportionally
    for (let n = 0; n < 16; n++) {
        const diff = ovr - calculateOVRFromStats(stats, mainPos);
        if (diff === 0) break;
        const step = diff > 0 ? 1 : -1;
        // Prefer adjusting higher-weight stats so the profile stays position-true
        const ordered = keys.slice().sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0));
        for (const k of ordered) {
            if (mainPos !== 'GK' && (w[k] ?? 0) < 0.08) continue;
            stats[k] = clamp(stats[k] + step, 40, 110);
            if (ovr === calculateOVRFromStats(stats, mainPos)) break;
        }
    }

    const rankInfo = getRankInfo(ovr);

    // Curated role identity when the pool declares one; otherwise the style is
    // drawn from the name so the same player always gets the same role.
    // Keepers must always land on a GK-group archetype (Sweeper Keeper / Goalkeeper).
    let style = (typeof playerPlaystyles !== 'undefined' && playerPlaystyles[p.name])
        || (typeof playstyleForName === 'function' ? playstyleForName(mainPos, p.name) : null);
    if (mainPos === 'GK' && typeof PLAYSTYLES !== 'undefined') {
        const legalGk = style && PLAYSTYLES[style] && PLAYSTYLES[style].group === 'GK';
        if (!legalGk) {
            style = (typeof playstyleForName === 'function' ? playstyleForName('GK', p.name) : null)
                || 'citadel';
        }
    }

    // The habit is curated for the players whose reputation is the habit, and read
    // off the shape of the body for everyone else — but that reading needs the whole
    // position list, so it happens in assignSpecialities once the pool is built.
    const habit = (typeof playerSpecialities !== 'undefined' && playerSpecialities[p.name]) || null;

    return {
        id: nextPlayerId++, name: p.name, rating: ovr, displayOVR: rankInfo.display,
        rank: rankInfo.rank, rankColor: rankInfo.color, rankBadge: rankInfo.badge, stats,
        mainPos,
        playstyle: style || null,
        speciality: habit || null,
        subPos: Array.isArray(p.subPos) ? p.subPos.filter(s => typeof s === 'string') : [],
        team: p.team || '',
        nationality: p.nationality || 'World'
    };
}

function initializePlayerDB() {
    availablePlayers = [];
    nextPlayerId = 1;
    // A fresh board means the ghost-tag weighting measured off the old one is wrong.
    specialityBoardWeights = null;
    const usedNames = new Set();
    const norm = name => name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

    if (typeof playerPool === 'undefined' || !playerPool) {
        console.error('[Draft] playerPool is not defined. Load your player data script before game.js.');
        return;
    }

    // Accept any top-level group names in playerPool.
    const poolGroups = Object.keys(playerPool);
    if (!poolGroups.length) {
        console.error('[Draft] playerPool is an empty object.');
        return;
    }

    const PER_POS_LIMIT = RANK_OVR_TABLE.length; // fixed 56-player lists

    poolGroups.forEach(group => {
        const byPos = playerPool[group];
        if (!byPos || typeof byPos !== 'object') return;

        // Support both { ST: [...], GK: [...] } and a flat array under a group
        if (Array.isArray(byPos)) {
            byPos.slice(0, PER_POS_LIMIT).forEach((p, idx) => {
                if (!p || !p.name) return;
                const key = norm(p.name);
                if (usedNames.has(key)) return; // no duplicates by name
                usedNames.add(key);
                availablePlayers.push(enrichPlayer({ ...p, mainPos: p.mainPos || 'CM' }, idx));
            });
            return;
        }

        Object.keys(byPos).forEach(pos => {
            const list = byPos[pos];
            if (!Array.isArray(list)) return;
            // Exactly up to 56 per position list; index 0 gets top OVR
            list.slice(0, PER_POS_LIMIT).forEach((p, idx) => {
                if (!p || !p.name) return;
                const key = norm(p.name);
                if (usedNames.has(key)) return; // no duplicates across positions either
                usedNames.add(key);
                availablePlayers.push(enrichPlayer({ ...p, mainPos: p.mainPos || pos }, idx));
            });
        });
    });

    // Every habit is read against the players who share the position, so the whole
    // pool has to exist before a single card can be tagged.
    if (typeof assignSpecialities === 'function') assignSpecialities(availablePlayers);

    for (let i = availablePlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availablePlayers[i], availablePlayers[j]] = [availablePlayers[j], availablePlayers[i]];
    }
    if (!availablePlayers.length) {
        console.error('[Draft] Loaded 0 players from playerPool. Keys:', poolGroups);
    }
}

// --- Chemistry ---
// Links form inside the starting XI only. Nation and club links run on the same
// tiers, and every helper below takes a `kind`, which is why a player maps to a
// *list* of groups: a player who has played for several clubs is linked through
// each of them.
function chemistryKeysOf(player, kind) {
    if (!player) return [];
    const label = value => String(value || '').trim().toLowerCase();
    if (kind === 'club') {
        const clubs = Array.isArray(player.clubs) && player.clubs.length ? player.clubs : [player.team];
        return [...new Set(clubs.map(label).filter(Boolean))];
    }
    return [label(player.nationality) || 'world'];
}

function chemistryLabelOf(player, kind, key) {
    if (kind === 'club') {
        const clubs = Array.isArray(player.clubs) && player.clubs.length ? player.clubs : [player.team];
        return clubs.find(club => String(club || '').trim().toLowerCase() === key) || player.team || 'Club';
    }
    return player.nationality || 'World';
}

// How many linked players each group has, per kind of link.
function countChemistryLinks(players) {
    const counts = {};
    CHEMISTRY_KINDS.forEach(kind => { counts[kind] = new Map(); });
    (players || []).filter(Boolean).forEach(player => {
        CHEMISTRY_KINDS.forEach(kind => {
            chemistryKeysOf(player, kind).forEach(key => {
                counts[kind].set(key, (counts[kind].get(key) || 0) + 1);
            });
        });
    });
    return counts;
}

// The best link one player can claim. A doubly-linked player takes the stronger
// link instead of adding them up, so a bonus never out-grows the card.
function bestChemistryLink(player, counts) {
    let best = { bonus: 0, kind: null, key: null, label: null, count: 0 };
    CHEMISTRY_KINDS.forEach(kind => {
        chemistryKeysOf(player, kind).forEach(key => {
            const count = (counts[kind] && counts[kind].get(key)) || 0;
            const bonus = chemistryBonusFor(count);
            if (bonus > best.bonus || (bonus > 0 && bonus === best.bonus && count > best.count)) {
                best = { bonus, kind, key, label: chemistryLabelOf(player, kind, key), count };
            }
        });
    });
    return best;
}

function getChemistryBonuses(players) {
    const list = (players || []).filter(Boolean);
    const counts = countChemistryLinks(list);
    const bonuses = new Map();
    list.forEach(player => { bonuses.set(player.id, bestChemistryLink(player, counts).bonus); });
    return bonuses;
}

function getFormationPlayers(manager) {
    if (!manager || !Array.isArray(manager.formation)) return [];
    return manager.formation
        .map(node => manager.squad.find(player => player.id === node.assignedPlayerId))
        .filter(Boolean);
}

function getFormationChemistry(manager) {
    const players = getFormationPlayers(manager);
    const bonuses = getChemistryBonuses(players);
    let total = 0;
    bonuses.forEach(bonus => { total += bonus; });
    return { players, bonuses, total };
}

function getLineupChemistry(lineup) {
    return getChemistryBonuses((lineup || []).map(slot => slot && slot.player).filter(Boolean));
}

// Every link group worth a bonus, so the pitch can draw the nation lines and the
// club lines side by side.
function getChemistryGroups(players) {
    const groups = new Map();
    const list = (players || []).filter(Boolean);
    const counts = countChemistryLinks(list);
    list.forEach(player => {
        CHEMISTRY_KINDS.forEach(kind => {
            chemistryKeysOf(player, kind).forEach(key => {
                const count = counts[kind].get(key) || 0;
                const bonus = chemistryBonusFor(count);
                if (bonus <= 0) return;
                const id = `${kind}:${key}`;
                if (!groups.has(id)) {
                    groups.set(id, { id, kind, key, label: chemistryLabelOf(player, kind, key), count, bonus });
                }
            });
        });
    });
    return [...groups.values()]
        .filter(group => group.count >= CHEMISTRY.LINK_MIN)
        .sort((a, b) => b.bonus - a.bonus || b.count - a.count);
}

function getManagerReserve(manager) {
    if (!manager) return 0;
    return Math.max(0, STARTERS - manager.squad.length - 1) * MIN_BID;
}

function getManagerMaxBid(manager) {
    if (!manager) return 0;
    return Math.max(0, manager.balance - getManagerReserve(manager));
}

// --- Drafting System ---
function updateRollButton() {
    const btn = document.getElementById('btn-roll');
    const lockedOut = gameState.managers.every(m => m.formationLocked || m.squad.length >= MAX_SQUAD_SIZE);
    const spinning = gameState.activeDraft && (gameState.activeDraft.state === 'spinning' || gameState.activeDraft.state === 'picked');
    const animating = !!gameState.draftAnimating;
    const auctionOpen = !!gameState.auction;
    btn.disabled = lockedOut || spinning || animating || auctionOpen || !Net.ownsGame();
    btn.classList.toggle('opacity-50', btn.disabled); btn.classList.toggle('cursor-not-allowed', btn.disabled);
    const skipEl = document.getElementById('skips-left-label');
    if (skipEl) {
        skipEl.innerText = `Skips ${gameState.skipsLeft}`;
        skipEl.className = `draft-skip${gameState.skipsLeft <= 0 ? ' is-low' : ''}`;
    }
    Net.publishInfo();
}

function teamHasGK(m) { return m.squad.some(p => p.mainPos === 'GK'); }
function allEligibleTeamsHaveGK() {
    return gameState.managers.every(team =>
        team.formationLocked || team.squad.length >= MAX_SQUAD_SIZE || teamHasGK(team)
    );
}


function getDraftPositionGroup(position) {
    if (position === 'GK') return 'GK';
    if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position)) return 'DEF';
    if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(position)) return 'MID';
    return 'ATT';
}

function getDraftPositionFit(player, position) {
    if (!player || !position) return 0;
    if (player.mainPos === position) return 1;
    if ((player.subPos || []).includes(position)) return 0.85;
    if (getDraftPositionGroup(player.mainPos) === getDraftPositionGroup(position)) return 0.28;
    return 0.04;
}

function getManagerDraftPositionNeed(manager, candidate) {
    const squad = manager.squad || [];
    const positions = (manager.formation || [])
        .map(slot => slot && slot.pos)
        .filter(position => POS_WEIGHTS[position]);
    const targets = positions.length ? positions : FALLBACK_DRAFT_POSITIONS;
    let needScore = 0;

    targets.forEach(position => {
        const coverage = squad.reduce((total, player) => {
            if (player.mainPos === position) return total + 1;
            if ((player.subPos || []).includes(position)) return total + 0.9;
            if (getDraftPositionGroup(player.mainPos) === getDraftPositionGroup(position)) return total + 0.25;
            return total;
        }, 0);

        const deficit = coverage < 0.5 ? 3.4 : coverage < 1.25 ? 1.5 : coverage < 2.25 ? 0.35 : 0.08;
        needScore += deficit * getDraftPositionFit(candidate, position);
    });

    return needScore;
}

function getPositionalDraftWeight(player, managers = gameState.managers) {
    const activeManagers = managers.filter(manager =>
        manager && !manager.formationLocked && (manager.squad || []).length < MAX_SQUAD_SIZE
    );
    if (!activeManagers.length) return 1;

    const averageNeed = activeManagers.reduce(
        (sum, manager) => sum + getManagerDraftPositionNeed(manager, player), 0
    ) / activeManagers.length;
    return clamp(1 + averageNeed * 1.15, 1, 30);
}

function rollPlayers() {
    if (!Net.ownsGame()) return showToast('Only the host rolls the draft.');
    if (gameState.draftAnimating) return;
    const d = gameState.activeDraft;
    if (d && (d.state === 'spinning' || d.state === 'picked')) return;
    if (d && d.state === 'revealed' && !d.player.sold) return showToast("Resolve current player first!");
    if (gameState.auction) return showToast("Auction in progress — settle it first.");

    const ownedNames = new Set(gameState.managers.flatMap(m => m.squad.map(p => p.name)));
    availablePlayers = availablePlayers.filter(p => !ownedNames.has(p.name));
    if (!availablePlayers.length) {
        const hint = (typeof playerPool === 'undefined')
            ? 'playerPool is missing — load player data before game.js'
            : 'playerPool has no usable players (check console)';
        return showToast('Draft pool empty! ' + hint);
    }

    let pool = availablePlayers;
    const goalkeepersSecured = allEligibleTeamsHaveGK();
    if (!goalkeepersSecured) {
        const gkPool = availablePlayers.filter(p => p.mainPos === 'GK');
        if (gkPool.length) {
            pool = gkPool;
            if (!gameState._gkPhaseToast) {
                gameState._gkPhaseToast = true;
                showToast("Goalkeeper phase — active teams need a GK first");
            }
        }
    } else {
        gameState._gkPhaseToast = false;
    }

    let pickIdx = 0;

    const weights = pool.map(player => {
        const positionalWeight = getPositionalDraftWeight(player);
        // Ratchets the pool toward stars without making journeymen impossible.
        // The floor keeps a low-rated player selectable at roughly a quarter of
        // an average one instead of letting the term go negative.
        const ovr = typeof player.rating === 'number' ? player.rating : DRAFT_OVR_BASELINE;
        const ovrWeight = Math.max(DRAFT_OVR_MIN_WEIGHT, 1 + (ovr - DRAFT_OVR_BASELINE) * DRAFT_OVR_WEIGHT);
        const base = player.mainPos === 'GK' ? positionalWeight * 0.05 : positionalWeight;
        return base * ovrWeight;
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    if (totalWeight > 0) {
        let roll = Math.random() * totalWeight;
        for (let index = 0; index < pool.length; index++) {
            roll -= weights[index];
            if (roll <= 0) {
                pickIdx = index;
                break;
            }
        }
    } else {
        pickIdx = Math.floor(Math.random() * pool.length);
    }

    const tmpl = pool[pickIdx];
    const masterIdx = availablePlayers.findIndex(p => p.id === tmpl.id);
    if (masterIdx >= 0) availablePlayers.splice(masterIdx, 1);

    const draft = {
        player: { ...tmpl, sold: false }, state: 'spinning', result: null,
        nonce: Date.now(),
        spinEndsAt: Date.now() + REEL.POS_MS + REEL.GAP_AFTER
    };
    gameState.activeDraft = draft;
    gameState.auction = null;

    updateRollButton();
    renderDraftBoard();
    Net.publishDraftNow();
    Net.publishAuctionNow();

    // The reels are driven by the render above, so both the host and every guest
    // device spin them; only the host decides when the card is revealed.
    setTimeout(() => {
        if (gameState.activeDraft !== draft) return; // game was reset while the reels were spinning
        draft.state = 'revealed';
        // Immediate: the shot clock for the opener starts in the same tick, and
        // a guest must not be handed a turn before the card reaches its screen.
        Net.publishDraftNow();
        if (gameState.managers.length > 1 && Net.ownsGame()) startAuction();
        renderDraftBoard(); updateRollButton();
    }, REEL.POS_MS + REEL.GAP_AFTER);
}

// --- Draft reel ---
// Decorative spin played on every device that renders a 'spinning' card. The host's
// reel lands on the rolled player; a guest is not told who it is yet, so its reel
// simply stops on a random triple and the revealed snapshot brings the real card.
const REEL = {
    ITEM_H: 36, VISIBLE: 3, SPIN_ITEMS: 18,
    NAT_MS: 1400, CLUB_MS: 1800, POS_MS: 2200, GAP_AFTER: 280
};
const REEL_POSITIONS = ['GK','CB','LB','RB','LWB','RWB','CDM','CM','CAM','LM','RM','LW','RW','CF','ST'];
const REEL_NATIONS = ["England","Spain","Italy","Germany","France","Brazil","Argentina","Portugal","Netherlands","Belgium"];
const REEL_CLUBS = ["Real Madrid","Barcelona","Milan","Juventus","Inter","Liverpool","Manchester United","Bayern Munich","Ajax","Boca Juniors"];

// The scrolling strip is seeded from the roll itself, so every device shows the
// same symbols in the same order instead of a different blur on each screen.
function reelSeed(seed) {
    let s = (seed || 0) >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function reelItems(pool, finalValue, rand) {
    const pick = rand || Math.random;
    const items = [];
    for (let i = 0; i < REEL.SPIN_ITEMS; i++) items.push(pool[Math.floor(pick() * pool.length)]);
    items.push(finalValue);
    for (let i = 0; i < 2; i++) items.push(pool[Math.floor(pick() * pool.length)]);
    return items;
}

function fillReel(trackEl, items, sizeClass) {
    trackEl.innerHTML = items.map((t) => `<div class="reel-item ${sizeClass}" style="height:${REEL.ITEM_H}px">${escapeHTML(String(t ?? ""))}</div>`).join('');
}

function spinReel(trackEl, durationMs) {
    const offset = (REEL.VISIBLE - 1) / 2;
    const targetY = -((REEL.SPIN_ITEMS - offset) * REEL.ITEM_H);
    trackEl.style.transition = 'none';
    trackEl.style.transform = 'translateY(0px)';
    void trackEl.offsetHeight;
    trackEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
    trackEl.style.transform = `translateY(${targetY}px)`;
}

function runDraftReel(player, spin, nonce) {
    const posTrack = document.getElementById('reel-pos');
    const natTrack = document.getElementById('reel-nat');
    const clubTrack = document.getElementById('reel-club');
    const posCol = document.getElementById('col-pos');
    const natCol = document.getElementById('col-nat');
    const clubCol = document.getElementById('col-club');
    if (!posTrack || !natTrack || !clubTrack || !posCol || !natCol || !clubCol) return;

    const nats = availablePlayers.length
        ? [...new Set(availablePlayers.map(p => p.nationality))].filter(Boolean)
        : REEL_NATIONS;
    const clubs = availablePlayers.length
        ? [...new Set(availablePlayers.map(p => p.team))].filter(Boolean)
        : REEL_CLUBS;
    // The name and OVR stay hidden until the reveal, but the three symbols the reels
    // land on travel with the spin, so every screen stops on the same triple.
    const finalNat = (player && player.nationality) || (spin && spin.nat) || pickRand(nats);
    const finalClub = (player && player.team) || (spin && spin.club) || pickRand(clubs);
    const finalPos = (player && player.mainPos) || (spin && spin.pos) || pickRand(REEL_POSITIONS);

    // A device that picks the spin up late shortens it so its reels still stop when
    // the host reveals, rather than running a full lap behind everyone else.
    const full = REEL.POS_MS + REEL.GAP_AFTER;
    const left = spin && Number.isFinite(spin.remaining) ? spin.remaining : full;
    const scale = clamp(left / full, 0.3, 1);
    const natMs = Math.round(REEL.NAT_MS * scale);
    const clubMs = Math.round(REEL.CLUB_MS * scale);
    const posMs = Math.round(REEL.POS_MS * scale);

    const rand = reelSeed(nonce);
    fillReel(natTrack, reelItems(nats, finalNat, rand), 'reel-nat-text');
    fillReel(clubTrack, reelItems(clubs, finalClub, rand), 'reel-club-text');
    fillReel(posTrack, reelItems(REEL_POSITIONS, finalPos, rand), 'reel-pos-text');

    // Left-to-right: Nationality → Club → Position, each stopping after the last.
    natCol.classList.add('slot-spinning');
    clubCol.classList.add('slot-spinning');
    posCol.classList.add('slot-spinning');

    requestAnimationFrame(() => {
        spinReel(natTrack, natMs);
        spinReel(clubTrack, clubMs);
        spinReel(posTrack, posMs);
    });

    setTimeout(() => { natCol.classList.remove('slot-spinning'); natCol.classList.add('slot-locked'); }, natMs);
    setTimeout(() => { clubCol.classList.remove('slot-spinning'); clubCol.classList.add('slot-locked'); }, clubMs);
    setTimeout(() => { posCol.classList.remove('slot-spinning'); posCol.classList.add('slot-locked'); }, posMs);
}

// The host draws the wheel and sends the landing index, so every screen spins the
// same clubs in the same order and stops on the same one at the same moment.
function renderPickupWheel(board, d) {
    const pick = d.pick;
    const order = pick ? pick.order : null;
    if (!d.player || !order || !order.length) return;

    // Unrelated updates re-render the board constantly; rebuilding the card would
    // reset the rotation mid-spin, so a wheel already running for this player stays.
    const token = `${d.player.id}:${order.join(',')}:${pick.lands}`;
    if (gameState._wheelFor === token &&
        board.firstElementChild?.dataset?.draftCard === String(d.player.id)) return;
    gameState._wheelFor = token;

    const clubs = order.map(id => auctionManagerById(id) || { name: '?' });
    const seg = 360 / clubs.length;
    const colors = ['#1d4ed8', '#b91c1c', '#6d28d9', '#c2410c', '#047857', '#0e7490'];
    const stops = clubs.map((c, i) => `${colors[i % colors.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(', ');
    // Labels run along the radius. Conic angles start at 12 o'clock but an unrotated
    // label points at 3, hence the -90; a label whose radius points left would render
    // upside down, so those names are turned back inside their own box.
    const labels = clubs.map((c, i) => {
        const angle = (i + 0.5) * seg;
        const text = escapeHTML(String(c.name).slice(0, 12));
        const inner = angle > 180 ? `<span class="wheel-flip">${text}</span>` : text;
        return `<div class="wheel-label" style="transform:rotate(${angle - 90}deg)">${inner}</div>`;
    }).join('');

    board.innerHTML = `
        <div data-draft-card="${d.player.id}" class="draft-pickup">
            <div class="eyebrow" style="color:#fbbf24;">Skips gone · Pickup wheel</div>
            <div class="draft-pickup__body">
                <div class="draft-pickup__card">${renderPlayerCard(d.player, { size: 'sm' })}</div>
                <div class="relative w-[200px] h-[200px]">
                    <div id="pickup-wheel" class="wheel" style="background:conic-gradient(from 0deg, ${stops})">${labels}</div>
                    <div class="wheel-hub">€${MIN_BID}M</div>
                    <div class="wheel-pointer"></div>
                </div>
            </div>
            <p class="auction-note">${escapeHTML(d.player.name)} goes to the club the wheel stops on.</p>
        </div>`;

    const wheel = document.getElementById('pickup-wheel');
    // A late device shortens its spin so it settles near the host, with a floor so a
    // last-moment joiner still sees a wheel rather than an instant snap.
    const full = WHEEL_MS + WHEEL_GAP;
    const left = Number.isFinite(pick.remaining) ? pick.remaining : full;
    const spinMs = Math.round(WHEEL_MS * clamp(left / full, 0.3, 1));
    const target = 360 * 4 - (pick.lands * seg + seg / 2);
    // Same forced-reflow start the reels use, so the spin also begins on a device
    // whose tab is backgrounded and therefore not running animation frames.
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    void wheel.offsetHeight;
    wheel.style.transition = `transform ${spinMs}ms cubic-bezier(0.12, 0.8, 0.2, 1)`;
    wheel.style.transform = `rotate(${target}deg)`;
}

// The bid amount lives in the input, but renderDraftBoard() rebuilds the whole
// panel on every publish. Preserve what is being typed only while the auction is
// still on the same turn: a new turn must always start with an empty field.
function captureBidFieldState() {
    const field = document.getElementById('bid-entry-field');
    if (!field) return null;
    return {
        turn: field.dataset.bidTurn || '',
        value: field.value,
        focused: document.activeElement === field,
        start: typeof field.selectionStart === 'number' ? field.selectionStart : null,
        end: typeof field.selectionEnd === 'number' ? field.selectionEnd : null
    };
}

function restoreBidFieldState(state) {
    if (!state) return;
    const field = document.getElementById('bid-entry-field');
    if (!field) return;
    if ((field.dataset.bidTurn || '') !== state.turn) return;
    field.value = state.value;
    if (typeof onBidInput === 'function') onBidInput(field);
    if (!state.focused) return;
    field.focus();
    if (state.start === null || state.end === null) return;
    try { field.setSelectionRange(state.start, state.end); } catch (e) {}
}

function draftEmptyStateHtml() {
    return `
        <div class="draft-empty">
            <div class="draft-empty__ball"></div>
            <b>Ready to draft</b>
            <small>Press Roll Draft to reveal the first player from the pool.</small>
        </div>`;
}

function renderDraftBoard() {
    const board = document.getElementById('draft-board');
    // A rebuilt board destroys the PASS button, so never leave a hold running.
    if (typeof cancelPassHold === 'function') cancelPassHold();
    const bidFieldState = captureBidFieldState();
    const d = gameState.activeDraft;
    if (!d) { gameState._renderedPlayerId = null; board.innerHTML = draftEmptyStateHtml(); return; }
    const { player, state, result } = d;

    if (state === 'spinning') {
        board.innerHTML = `
            <div class="draft-spin">
                <div class="draft-spin__back"><span>?</span></div>
                <div class="draft-spin__reels">
                    <div id="col-nat" class="slot-col">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nation</span>
                        <div class="reel-window"><div class="reel-track" id="reel-nat"></div><div class="reel-mask-top"></div><div class="reel-mask-bot"></div><div class="reel-highlight"></div></div>
                    </div>
                    <div id="col-club" class="slot-col">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Club</span>
                        <div class="reel-window"><div class="reel-track" id="reel-club"></div><div class="reel-mask-top"></div><div class="reel-mask-bot"></div><div class="reel-highlight"></div></div>
                    </div>
                    <div id="col-pos" class="slot-col">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Position</span>
                        <div class="reel-window"><div class="reel-track" id="reel-pos"></div><div class="reel-mask-top"></div><div class="reel-mask-bot"></div><div class="reel-highlight"></div></div>
                    </div>
                </div>
                <div class="auction-note">The pool is deciding...</div>
            </div>`;
        // Every device that shows a spinning card animates it once per roll, so a
        // guest sees the same reel as the host instead of a frozen window.
        const spinToken = d.nonce || (player && player.id);
        if (spinToken && gameState._reelFor !== spinToken) {
            gameState._reelFor = spinToken;
            runDraftReel(player, d.spin, spinToken);
        }
    } else if (state === 'picked') {
        renderPickupWheel(board, d);
    } else if (state === 'revealed') {
        const isSolo = gameState.managers.length === 1;
        if (player.sold) {
            const won = !!(result && result.winnerName);
            if (won) {
                // A sale is told by the SOLD stamp and the arrow flying to the buyer's
                // panel. Other updates re-render through here, so the board must not be
                // touched while that is running or the animation is cut short.
                if (gameState.draftAnimating || document.getElementById('draft-fly-overlay')) return;
                const winner = gameState.managers.find(m => m.name === result.winnerName);
                const cardShowing = board.firstElementChild?.dataset?.draftCard === String(player.id);
                if (winner && cardShowing) {
                    // A guest never runs the sale itself: it replays the same fly-over
                    // for the club the host just sold to.
                    playDraftAcquisitionAnimation(player, winner.id, () => {
                        gameState.activeDraft = null;
                        Net.publishDraftNow();
                        renderDraftBoard();
                        updateRollButton();
                    });
                    return;
                }
                gameState.activeDraft = null;
                Net.publishDraftNow();
                board.innerHTML = draftEmptyStateHtml();
                return;
            }
            // An unsold player needs no recap panel — the DISCARDED stamp on the card
            // every device is already showing is the whole story. The stamp must not be
            // wiped by a re-render, so anything mid-animation leaves the board alone.
            if (gameState.draftAnimating || document.querySelector('.draft-sold-stamp')) return;
            const skipCardShowing = board.firstElementChild?.dataset?.draftCard === String(player.id);
            if (skipCardShowing) {
                playDraftDiscardAnimation(() => {
                    gameState.activeDraft = null;
                    Net.publishDraftNow();
                    renderDraftBoard();
                    updateRollButton();
                });
                return;
            }
            gameState.activeDraft = null;
            Net.publishDraftNow();
            board.innerHTML = draftEmptyStateHtml();
        } else {
            let actionHtml;
            if (isSolo) {
                const m = gameState.managers[0];
                const out = m.squad.length >= MAX_SQUAD_SIZE;
                actionHtml = `
                    <div class="auction__actions">
                        <p class="auction-note">${out ? 'Squad full — you can only skip this player.' : 'Solo draft — take the player or skip.'}</p>
                        <div style="display:flex;gap:7px;">
                            <button onclick="soloSkipPlayer()" class="btn btn--ghost" style="flex:1;">Skip</button>
                            <button onclick="soloTakePlayer()" class="btn btn--primary" style="flex:1;" ${out ? 'disabled' : ''}>Take Player</button>
                        </div>
                    </div>`;
            } else {
                actionHtml = renderAuctionPanel();
            }

            const freshCard = gameState._renderedPlayerId !== player.id;
            gameState._renderedPlayerId = player.id;
            const focusManager = gameState.managers.find(m => Net.canControl(m.id)) || gameState.managers[0];
            const scoutHtml = renderScoutStrip(player, focusManager ? focusManager.id : null);
            board.innerHTML = `
                <div data-draft-card="${player.id}" class="draft-reveal ${freshCard ? 'animate-reveal' : ''}">
                    <div class="draft-reveal__card">
                        ${renderPlayerCard(player, { size: 'xl' })}
                    </div>
                    <div class="draft-reveal__side">
                        ${scoutHtml}
                        ${actionHtml}
                    </div>
                </div>`;
            restoreBidFieldState(bidFieldState);
        }
    }
}

function soloTakePlayer() {
    const d = gameState.activeDraft; if (!d || d.player.sold) return;
    const m = gameState.managers[0];
    if (!m) return;
    if (m.squad.length >= MAX_SQUAD_SIZE) return showToast('Squad full!');
    
    const price = 0;
    m.squad.push({ ...d.player, price });
    d.player.sold = true;
    d.result = { winnerName: m.name };
    playDraftAcquisitionAnimation(d.player, m.id, () => {
        updateDashboard(m.id);
        gameState.activeDraft = null; // destination known via animation — skip SOLD result panel
        renderDraftBoard();
        updateRollButton();
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    });
}

function soloSkipPlayer() {
    const d = gameState.activeDraft; if (!d || d.player.sold) return;
    const m = gameState.managers[0];
    if (!m) return;
    gameState.skipsLeft = Math.max(0, gameState.skipsLeft - 1);
    d.player.sold = true;
    d.result = { winnerName: null };
    playDraftDiscardAnimation(() => {
        showToast(`Player passed. Skips left: ${gameState.skipsLeft}`);
        gameState.activeDraft = null;
        renderDraftBoard();
        updateRollButton();
        if (typeof SaveGame !== 'undefined') SaveGame.schedule();
    });
}

