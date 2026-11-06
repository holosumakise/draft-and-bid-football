const INITIAL_BALANCE = 1000;
const MIN_BID = 10;
const STARTERS = 11;
const BENCH_SLOTS = 6;
const MAX_SQUAD_SIZE = STARTERS + BENCH_SLOTS;
const MAX_SUBS = 5;

// --- Squad Investment ---
// Leftover auction money can be spent on the club once drafting is done.
// Training is permanent and follows the player; medical lasts the season.
// Stadium upgrades raise gate receipts and fan growth for the rest of the save.
const INVESTMENT = Object.freeze({
    TRAINING_MAX: 3,
    // Only players at this rating or below may take a training level. A player
    // who trains up past the line keeps what he has earned but cannot train again.
    TRAINING_MAX_RATING: 97,
    // Base costs by training level; actual price is scaled down for lower OVR.
    TRAINING_COSTS: Object.freeze([50, 100, 175]),
    TRAINING_OVR_GAIN: 1,
    TRAINING_STAT_GAIN: 1,
    TRAINING_COST_MIN: 12,
    MEDICAL_COSTS: Object.freeze([90, 180]),
    MEDICAL_INJURY_REDUCTION: Object.freeze([0.15, 0.30]),
    MEDICAL_STAMINA_REDUCTION: Object.freeze([0.10, 0.20]),
    MEDICAL_CONDITIONING: Object.freeze([0, 0.4, 0.8]),
    // Stadium upgrades (legacy saves may still carry `scouting`).
    STADIUM_COSTS: Object.freeze([60, 140]),
    // Multipliers on gate receipts by stadium tier (0 / 1 / 2).
    STADIUM_TICKET_MULT: Object.freeze([1, 1.15, 1.32]),
    // Extra share of positive fan growth kept on wins; losses are unchanged.
    STADIUM_FAN_GAIN_MULT: Object.freeze([1, 1.30, 1.55]),
    // Back-compat alias so older callers that still read SCOUTING_COSTS keep working.
    SCOUTING_COSTS: Object.freeze([60, 140])
});

// Training price falls with the player's current rating. A lower-rated prospect
// pays less than a 97 at the same camp level; the curve is gentle so the top end
// stays meaningful.
function trainingCostFor(player, level) {
    const base = INVESTMENT.TRAINING_COSTS[level];
    if (base == null) return 0;
    const rating = Math.max(1, Number(player && player.rating) || 70);
    const cap = INVESTMENT.TRAINING_MAX_RATING || 97;
    const scale = Math.pow(Math.min(1, rating / cap), 1.15);
    return Math.max(INVESTMENT.TRAINING_COST_MIN || 12, Math.round(base * scale));
}

function stadiumTierOf(manager) {
    if (!manager) return 0;
    const inv = investmentOf(manager);
    const max = (INVESTMENT.STADIUM_COSTS || INVESTMENT.SCOUTING_COSTS || []).length;
    return Math.max(0, Math.min(max, Math.round(Number(inv.stadium) || 0)));
}

// Lazy accessor: older saves and rooms created before investments existed have
// no field, and a manager should never be charged for a missing object.
function investmentOf(manager) {
    if (!manager) return { medical: 0, stadium: 0 };
    if (!manager.investment || typeof manager.investment !== 'object' || Array.isArray(manager.investment)) {
        manager.investment = { medical: 0, stadium: 0 };
    }
    const medicalMax = INVESTMENT.MEDICAL_COSTS.length;
    const stadiumMax = (INVESTMENT.STADIUM_COSTS || INVESTMENT.SCOUTING_COSTS || []).length;
    manager.investment.medical = Math.max(0, Math.min(medicalMax, Math.round(Number(manager.investment.medical) || 0)));
    // Migrate legacy `scouting` into `stadium` once, then keep a mirror so any
    // leftover scouting UI still reads the same tier.
    let stadium = Number(manager.investment.stadium);
    if (!Number.isFinite(stadium) || stadium < 0) {
        stadium = Number(manager.investment.scouting) || 0;
    }
    stadium = Math.max(0, Math.min(stadiumMax, Math.round(stadium)));
    manager.investment.stadium = stadium;
    manager.investment.scouting = stadium;
    return manager.investment;
}


function medicalTierOf(entity) {
    if (!entity) return 0;
    const max = INVESTMENT.MEDICAL_COSTS.length;
    if (typeof entity.medicalTier === 'number' && Number.isFinite(entity.medicalTier)) {
        return Math.max(0, Math.min(max, Math.round(entity.medicalTier)));
    }
    const inv = entity.investment;
    return inv && Number.isFinite(inv.medical)
        ? Math.max(0, Math.min(max, Math.round(inv.medical)))
        : 0;
}

function medicalInjuryFactor(entity) {
    const tier = medicalTierOf(entity);
    return 1 - (INVESTMENT.MEDICAL_INJURY_REDUCTION[tier - 1] || 0);
}

function medicalStaminaFactor(entity) {
    const tier = medicalTierOf(entity);
    return 1 - (INVESTMENT.MEDICAL_STAMINA_REDUCTION[tier - 1] || 0);
}

function medicalConditioningBoost(entity) {
    return INVESTMENT.MEDICAL_CONDITIONING[medicalTierOf(entity)] || 0;
}

// ============================================================
// MATCH AVAILABILITY — suspensions and injuries.
//
// A player carries two optional fields:
//   outMatches: how many of his club's next matches he must miss
//   outReason:  'suspension' | 'injury'
//
// The count is ticked once after every match the club plays, then new events
// are applied, so a one-match ban means he misses exactly the next fixture.
// ============================================================
const MATCH_AVAILABILITY = Object.freeze({
    INJURY_MIN: 1,
    INJURY_MAX: 8,
    SUSPENSION_MIN: 1,
    SUSPENSION_MAX: 3
});

function playerOutMatches(player) {
    if (!player) return 0;
    const value = Math.round(Number(player.outMatches) || 0);
    return value > 0 ? value : 0;
}

function playerIsUnavailable(player) {
    return playerOutMatches(player) > 0;
}

function playerAvailability(player) {
    const matches = playerOutMatches(player);
    if (!matches) return null;
    const reason = player.outReason === 'suspension' ? 'suspension' : 'injury';
    return {
        matches,
        reason,
        code: reason === 'suspension' ? 'SUS' : 'INJ',
        label: `${reason === 'suspension' ? 'Suspended' : 'Injured'} · ${matches} match${matches === 1 ? '' : 'es'}`
    };
}

function clearPlayerAbsence(player) {
    if (!player) return;
    delete player.outMatches;
    delete player.outReason;
}

function markPlayerOut(player, matches, reason) {
    if (!player) return null;
    const length = Math.max(1, Math.round(Number(matches) || 1));
    const kind = reason === 'suspension' ? 'suspension' : 'injury';
    const current = playerOutMatches(player);
    // Keep the longer absence. If they are equal, a suspension is the more
    // serious booking and wins the label.
    if (length > current || (length === current && kind === 'suspension')) {
        player.outMatches = length;
        player.outReason = kind;
    }
    return playerAvailability(player);
}

// Deduct one fixture for every player who was already unavailable. Call this
// once per club per match, after the result and before the new events land.
function tickPlayerAbsences(squad) {
    (squad || []).forEach(player => {
        if (!player) return;
        const remaining = playerOutMatches(player) - 1;
        if (remaining > 0) player.outMatches = remaining;
        else clearPlayerAbsence(player);
    });
}

// A red card is rarely a fixed one-match ban: the enforcer and the hot head are
// more likely to pick up an extra charge. The result is 1-3 matches.
function suspensionLengthFor(player) {
    const risk = typeof playstyleBookingRateFor === 'function' ? playstyleBookingRateFor(player) : 1;
    let matches = 1;
    if (Math.random() < Math.max(0.04, Math.min(0.45, 0.20 * risk))) matches++;
    if (Math.random() < Math.max(0.01, Math.min(0.12, 0.045 * risk))) matches++;
    return Math.max(MATCH_AVAILABILITY.SUSPENSION_MIN, Math.min(MATCH_AVAILABILITY.SUSPENSION_MAX, matches));
}

// Injury length follows the player's own durability and the club's medical
// programme. Most knocks are one or two matches; fragile players occasionally
// pick up a long-term problem.
function injuryLengthFor(player, team) {
    const fragility = (typeof playstyleInjuryRate === 'function' ? playstyleInjuryRate(player) : 1)
        * (typeof medicalInjuryFactor === 'function' ? medicalInjuryFactor(team) : 1);
    const roll = Math.random();
    let matches;
    if (roll < 0.55) matches = 1;
    else if (roll < 0.82) matches = 2;
    else if (roll < 0.93) matches = 3 + Math.floor(Math.random() * 2);
    else matches = 5 + Math.floor(Math.random() * 4);
    // A fragile body can add a match or two to any knock.
    if (Math.random() < Math.max(0, (fragility - 0.8) * 0.45)) matches += 1 + Math.floor(Math.random() * 2);
    return Math.max(MATCH_AVAILABILITY.INJURY_MIN, Math.min(MATCH_AVAILABILITY.INJURY_MAX, matches));
}

// ============================================================
// AVAILABLE XI — replace unavailable starters from the bench/reserves.
// The manager's saved XI is never mutated; each match state gets a fresh copy.
// ============================================================
function positionUnitOf(pos) {
    if (pos === 'GK') return 'GK';
    if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
    if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(pos)) return 'MID';
    return 'ATT';
}

function pickAvailableReplacement(pos, pool, used) {
    const available = (pool || []).filter(player =>
        player && !playerIsUnavailable(player) && !used.has(player.id));
    if (!available.length) return null;
    const isGK = pos === 'GK';
    // Never put an outfield player in goal, and never use a second keeper outfield.
    const legal = available.filter(player => isGK ? player.mainPos === 'GK' : player.mainPos !== 'GK');
    if (!legal.length) return null;
    const samePos = legal.filter(player =>
        player.mainPos === pos || (Array.isArray(player.subPos) && player.subPos.includes(pos)));
    const sameUnit = legal.filter(player => positionUnitOf(player.mainPos) === positionUnitOf(pos));
    const shortlist = samePos.length ? samePos : (sameUnit.length ? sameUnit : legal);
    return shortlist[Math.floor(Math.random() * shortlist.length)];
}

function fillAvailableTeamSlots(lineup, bench, reserves) {
    const rawBench = (bench || []).filter(Boolean);
    const rawReserves = (reserves || []).filter(Boolean);
    const pool = [...rawBench, ...rawReserves];
    const used = new Set();
    const filledLineup = [];

    (lineup || []).forEach(slot => {
        if (!slot || !slot.player) return;
        if (!playerIsUnavailable(slot.player)) {
            filledLineup.push({ ...slot, player: slot.player });
            used.add(slot.player.id);
            return;
        }
        const replacement = pickAvailableReplacement(slot.pos, pool, used);
        if (!replacement) return;
        used.add(replacement.id);
        // `autoFor` records who was replaced so the broadcast can tell the story.
        filledLineup.push({ ...slot, player: replacement, autoFor: slot.player.id });
    });

    const freshBench = rawBench.filter(player => !playerIsUnavailable(player) && !used.has(player.id));
    const freshReserves = rawReserves.filter(player => !playerIsUnavailable(player) && !used.has(player.id));
    return { lineup: filledLineup, bench: freshBench, reserves: freshReserves };
}

// ============================================================
// MATCHDAY FINANCE — every manager starts with the same fanbase.
//
// Each match pays gate receipts from the current fan count. The result then
// moves the fanbase: wins (especially by a margin) grow it, losses shrink it.
// The next gate is therefore worth more or less, and the money lands directly
// in the balance. Ghost clubs own no balance, so only human managers settle.
// ============================================================
const MATCHDAY_FINANCE = Object.freeze({
    INITIAL_FANS: 25000,
    MIN_FANS: 4000,
    MAX_FANS: 120000,
    // €M per fan at the gate. 25,000 fans ≈ €1.5M per match.
    TICKET_PRICE: 0.00006,
    WIN_FAN_PCT: 0.020,
    DRAW_FAN_PCT: -0.004,
    LOSS_FAN_PCT: -0.020,
    MARGIN_FAN_PCT: 0.005,
    MAX_FAN_SWING: 0.06
});

function clampFanCount(value) {
    return Math.max(MATCHDAY_FINANCE.MIN_FANS, Math.min(MATCHDAY_FINANCE.MAX_FANS, Math.round(value)));
}

function fansOf(manager) {
    if (!manager) return MATCHDAY_FINANCE.INITIAL_FANS;
    const value = Number(manager.fans);
    if (!Number.isFinite(value) || value <= 0) manager.fans = MATCHDAY_FINANCE.INITIAL_FANS;
    else manager.fans = clampFanCount(value);
    return manager.fans;
}

// Money is counted in millions to one decimal. Every write to a balance goes
// through this, because plain float addition of gate receipts drifts the stored
// value into something like 80.29999999999995 that no subtraction can undo.
function roundMoney(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}

function ticketRevenueFor(fans) {
    const safe = Math.max(0, Number(fans) || 0);
    return Math.max(0.1, roundMoney(safe * MATCHDAY_FINANCE.TICKET_PRICE));
}

function fanReactionFor(result, goalDiff) {
    const margin = Math.abs(Number(goalDiff) || 0);
    const swing = MATCHDAY_FINANCE.MARGIN_FAN_PCT * margin;
    const max = MATCHDAY_FINANCE.MAX_FAN_SWING;
    if (result === 'W') return Math.max(-max, Math.min(max, MATCHDAY_FINANCE.WIN_FAN_PCT + swing));
    if (result === 'L') return Math.max(-max, Math.min(max, MATCHDAY_FINANCE.LOSS_FAN_PCT - swing));
    return MATCHDAY_FINANCE.DRAW_FAN_PCT;
}

function formatFanCount(value) {
    const fans = Math.max(0, Math.round(Number(value) || 0));
    if (fans >= 1000000) return `${(fans / 1000000).toFixed(1)}M`;
    if (fans >= 1000) return `${(fans / 1000).toFixed(1)}K`;
    return String(fans);
}

function awardMatchdayFinance(manager, result, goalsFor, goalsAgainst) {
    if (!manager) return null;
    const before = fansOf(manager);
    const tier = typeof stadiumTierOf === 'function' ? stadiumTierOf(manager) : 0;
    const ticketMult = (INVESTMENT.STADIUM_TICKET_MULT && INVESTMENT.STADIUM_TICKET_MULT[tier]) || 1;
    const fanGainMult = (INVESTMENT.STADIUM_FAN_GAIN_MULT && INVESTMENT.STADIUM_FAN_GAIN_MULT[tier]) || 1;
    const baseRevenue = ticketRevenueFor(before);
    const revenue = roundMoney(baseRevenue * ticketMult);
    const balance = Number(manager.balance) || 0;
    manager.balance = roundMoney(balance + revenue);
    // Cumulative gate receipts for the season report. Balance also holds the
    // unspent auction money, so it cannot be used to infer ticket income.
    manager.ticketRevenue = roundMoney((Number(manager.ticketRevenue) || 0) + revenue);
    let pct = fanReactionFor(result, (Number(goalsFor) || 0) - (Number(goalsAgainst) || 0));
    // Better facilities accelerate growth on good results; they do not soften losses.
    if (pct > 0) pct *= fanGainMult;
    const after = clampFanCount(before * (1 + pct));
    manager.fans = after;
    manager.lastGate = revenue;
    manager.lastFanDelta = after - before;
    manager.lastResult = result;
    return { revenue, fansBefore: before, fansAfter: after, fanDelta: after - before, pct, stadiumTier: tier };
}



// --- Chemistry ---
// Players in the starting XI link through a shared nation or a shared club.
// The bonus follows how many linked players the XI carries: 2 = +1, 3-5 = +2,
// 6 or more = +3. A player can sit in several groups at once and takes the best
// link only — links never stack, or a doubly-linked star would out-rate his card.
const CHEMISTRY = Object.freeze({
    LINK_MIN: 2,
    WARM_MIN: 3,
    STRONG_MIN: 6,
    LINK_BONUS: 1,
    WARM_BONUS: 2,
    STRONG_BONUS: 3
});
const CHEMISTRY_KINDS = ['nation', 'club'];

function chemistryBonusFor(count) {
    if (count >= CHEMISTRY.STRONG_MIN) return CHEMISTRY.STRONG_BONUS;
    if (count >= CHEMISTRY.WARM_MIN) return CHEMISTRY.WARM_BONUS;
    if (count >= CHEMISTRY.LINK_MIN) return CHEMISTRY.LINK_BONUS;
    return 0;
}

// --- Live auction: one bidder at a time, every bid public ---
// 9s is enough to think, short enough that four managers do not sit through a
// minute of dead air per player.
const SHOT_CLOCK_MS = 9000;
const AUCTION_TICK_MS = 200;
const BID_RAISE_STEPS = [1, 5];

// --- Shared balance model (engine-core.js) ---
// One expected-goals baseline for the live match engine, the league simulator
// and sim/lab.js, so tuning a number here changes every mode at once.
const BASE_EXPECTED_GOALS_PER_TEAM = 1.32;
const MATCH_STRENGTH_COEFFICIENT = 0.016;
const LEAGUE_HOME_ADVANTAGE = 0.10;

// Draft rolls weight stars a little more heavily than journeymen. The term is
// deliberately modest: 1 + (ovr - 85) * 0.06 makes a 107 about 2.3x as likely as
// an 85, and floors very low ratings instead of making them impossible.
const DRAFT_OVR_BASELINE = 85;
const DRAFT_OVR_WEIGHT = 0.06;
const DRAFT_OVR_MIN_WEIGHT = 0.25;

// Online room housekeeping.
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;      // a room older than this is treated as expired and deleted when someone touches it
// Bump on every deploy. A room records the build that created it and refuses guests
// running a different one, so host and guests never simulate with different rules.
const BUILD_ID = '2026-11-06.14';

// Typing this into the small field at the bottom of the account panel reveals a
// Token top-up for your own wallet. Change it whenever you want to keep it private.
const TOKEN_DEV_CODE = 'DBF2026';

// Once the room's skips are gone, an unwanted player is handed to one club picked at
// random. The wheel spins this long, then pauses before the sale is announced.
const WHEEL_MS = 2400;
const WHEEL_GAP = 400;

const DIFFICULTY_PRESETS = {
    easy: { label: 'Easy', offset: -6, desc: 'Easy: ghost clubs are a step weaker. Good for learning the draft.' },
    normal: { label: 'Normal', offset: -1, desc: 'Normal: competitive league — strong drafts win, but ghosts can punish mistakes.' },
    hard: { label: 'Hard', offset: 3, desc: 'Hard: ghost clubs are tougher. Dropped points are expected.' },
    legend: { label: 'Legend', offset: 6, desc: 'Legend: ghosts near your level. Every upgrade and result matters.' }
};

// Display-only: keepers read keeper labels. Stat keys and all balance math stay PAC/SHO/PAS/DRI/DEF/PHY.
const GK_STAT_LABELS = Object.freeze({ PAC: 'SPD', SHO: 'KIC', PAS: 'HAN', DRI: 'DIV', DEF: 'REF', PHY: 'POS' });
function statLabel(key, isGK) {
    return isGK && GK_STAT_LABELS[key] ? GK_STAT_LABELS[key] : key;
}
const POS_WEIGHTS = {
    GK:  { PAC:0.05, SHO:0.05, PAS:0.10, DRI:0.10, DEF:0.40, PHY:0.30 },
    CB:  { PAC:0.10, SHO:0.05, PAS:0.15, DRI:0.10, DEF:0.35, PHY:0.25 },
    LB:  { PAC:0.20, SHO:0.05, PAS:0.20, DRI:0.15, DEF:0.25, PHY:0.15 },
    RB:  { PAC:0.20, SHO:0.05, PAS:0.20, DRI:0.15, DEF:0.25, PHY:0.15 },
    LWB: { PAC:0.22, SHO:0.08, PAS:0.20, DRI:0.18, DEF:0.20, PHY:0.12 },
    RWB: { PAC:0.22, SHO:0.08, PAS:0.20, DRI:0.18, DEF:0.20, PHY:0.12 },
    CDM: { PAC:0.12, SHO:0.10, PAS:0.25, DRI:0.15, DEF:0.23, PHY:0.15 },
    CM:  { PAC:0.12, SHO:0.15, PAS:0.28, DRI:0.20, DEF:0.15, PHY:0.10 },
    CAM: { PAC:0.12, SHO:0.20, PAS:0.28, DRI:0.25, DEF:0.05, PHY:0.10 },
    LM:  { PAC:0.22, SHO:0.15, PAS:0.20, DRI:0.23, DEF:0.08, PHY:0.12 },
    RM:  { PAC:0.22, SHO:0.15, PAS:0.20, DRI:0.23, DEF:0.08, PHY:0.12 },
    LW:  { PAC:0.25, SHO:0.20, PAS:0.15, DRI:0.25, DEF:0.05, PHY:0.10 },
    RW:  { PAC:0.25, SHO:0.20, PAS:0.15, DRI:0.25, DEF:0.05, PHY:0.10 },
    CF:  { PAC:0.15, SHO:0.30, PAS:0.15, DRI:0.20, DEF:0.05, PHY:0.15 },
    ST:  { PAC:0.18, SHO:0.35, PAS:0.10, DRI:0.15, DEF:0.05, PHY:0.17 }
};
const RANK_OVR_TABLE = [
    107, 104, 103, 100, 100, 100,
    ...Array.from({ length: 50 }, (_, i) => 99 - Math.floor(i / (50 / 15)))
];

// The one shape every club plays. Each slot declares its own position so the pitch
// UI, auto-fill and the match engine all agree. The trade-off is positional fit:
// two strikers means fewer natural midfield slots to hide an out-of-position star.
const FORMATION_PRESETS = Object.freeze({
    '4-4-2': {
        label: '4-4-2',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 15, y: 48, pos: 'LM' }, { x: 38, y: 49, pos: 'CM' }, { x: 62, y: 49, pos: 'CM' }, { x: 85, y: 48, pos: 'RM' },
            { x: 38, y: 24, pos: 'ST' }, { x: 62, y: 24, pos: 'ST' }
        ]
    },
    '4-3-3': {
        label: '4-3-3',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 50, y: 55, pos: 'CDM' }, { x: 30, y: 43, pos: 'CM' }, { x: 70, y: 43, pos: 'CM' },
            { x: 18, y: 25, pos: 'LW' }, { x: 50, y: 20, pos: 'ST' }, { x: 82, y: 25, pos: 'RW' }
        ]
    },
    '4-2-3-1': {
        label: '4-2-3-1',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 36, y: 56, pos: 'CDM' }, { x: 64, y: 56, pos: 'CDM' },
            { x: 16, y: 40, pos: 'LM' }, { x: 50, y: 38, pos: 'CAM' }, { x: 84, y: 40, pos: 'RM' },
            { x: 50, y: 19, pos: 'ST' }
        ]
    },
    '4-1-4-1': {
        label: '4-1-4-1',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 50, y: 57, pos: 'CDM' },
            { x: 14, y: 43, pos: 'LM' }, { x: 38, y: 44, pos: 'CM' }, { x: 62, y: 44, pos: 'CM' }, { x: 86, y: 43, pos: 'RM' },
            { x: 50, y: 20, pos: 'ST' }
        ]
    },
    '4-3-2-1': {
        label: '4-3-2-1',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 50, y: 56, pos: 'CDM' }, { x: 30, y: 46, pos: 'CM' }, { x: 70, y: 46, pos: 'CM' },
            { x: 32, y: 32, pos: 'CAM' }, { x: 68, y: 32, pos: 'CAM' },
            { x: 50, y: 18, pos: 'ST' }
        ]
    },
    '4-1-2-1-2': {
        label: '4-1-2-1-2 (diamond)',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 15, y: 70, pos: 'LB' }, { x: 38, y: 72, pos: 'CB' }, { x: 62, y: 72, pos: 'CB' }, { x: 85, y: 70, pos: 'RB' },
            { x: 50, y: 57, pos: 'CDM' },
            { x: 16, y: 44, pos: 'LM' }, { x: 84, y: 44, pos: 'RM' },
            { x: 50, y: 32, pos: 'CAM' },
            { x: 38, y: 19, pos: 'ST' }, { x: 62, y: 19, pos: 'ST' }
        ]
    },
    '3-5-2': {
        label: '3-5-2',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 28, y: 73, pos: 'CB' }, { x: 50, y: 74, pos: 'CB' }, { x: 72, y: 73, pos: 'CB' },
            { x: 11, y: 50, pos: 'LWB' }, { x: 32, y: 48, pos: 'CM' }, { x: 50, y: 57, pos: 'CDM' }, { x: 68, y: 48, pos: 'CM' }, { x: 89, y: 50, pos: 'RWB' },
            { x: 40, y: 23, pos: 'ST' }, { x: 60, y: 23, pos: 'ST' }
        ]
    },
    '3-4-2-1': {
        label: '3-4-2-1',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 28, y: 73, pos: 'CB' }, { x: 50, y: 74, pos: 'CB' }, { x: 72, y: 73, pos: 'CB' },
            { x: 13, y: 50, pos: 'LM' }, { x: 38, y: 51, pos: 'CM' }, { x: 62, y: 51, pos: 'CM' }, { x: 87, y: 50, pos: 'RM' },
            { x: 30, y: 32, pos: 'CAM' }, { x: 70, y: 32, pos: 'CAM' },
            { x: 50, y: 17, pos: 'ST' }
        ]
    },
    '5-3-2': {
        label: '5-3-2',
        slots: [
            { x: 50, y: 86, isGK: true, pos: 'GK' },
            { x: 8, y: 62, pos: 'LWB' }, { x: 30, y: 73, pos: 'CB' }, { x: 50, y: 75, pos: 'CB' }, { x: 70, y: 73, pos: 'CB' }, { x: 92, y: 62, pos: 'RWB' },
            { x: 28, y: 48, pos: 'CM' }, { x: 50, y: 50, pos: 'CDM' }, { x: 72, y: 48, pos: 'CM' },
            { x: 40, y: 23, pos: 'ST' }, { x: 60, y: 23, pos: 'ST' }
        ]
    }
});
function getFormationPreset(key) {
    return FORMATION_PRESETS[key] || FORMATION_PRESETS['4-4-2'];
}

const POSITION_META = {
    CB: { unit: 0, depth: 0.0, channel: 'C' }, LB: { unit: 0, depth: 0.5, channel: 'L' }, RB: { unit: 0, depth: 0.5, channel: 'R' },
    LWB: { unit: 0, depth: 0.7, channel: 'L' }, RWB: { unit: 0, depth: 0.7, channel: 'R' },
    CDM: { unit: 1, depth: 1.0, channel: 'C' }, CM: { unit: 1, depth: 1.5, channel: 'C' }, CAM: { unit: 1, depth: 2.0, channel: 'C' },
    LM: { unit: 1, depth: 1.6, channel: 'L' }, RM: { unit: 1, depth: 1.6, channel: 'R' },
    LW: { unit: 2, depth: 2.5, channel: 'L' }, RW: { unit: 2, depth: 2.5, channel: 'R' },
    CF: { unit: 2, depth: 2.8, channel: 'C' }, ST: { unit: 2, depth: 3.2, channel: 'C' }
};

const OUT_OF_POS_OVERRIDES = {
    'LB>RB': 0.08, 'RB>LB': 0.08, 'LWB>RWB': 0.08, 'RWB>LWB': 0.08,
    'LW>RW': 0.07, 'RW>LW': 0.07, 'LM>RM': 0.07, 'RM>LM': 0.07,
    'LM>LW': 0.03, 'LW>LM': 0.04, 'RM>RW': 0.03, 'RW>RM': 0.04,
    'LM>RW': 0.07, 'RW>LM': 0.08, 'RM>LW': 0.07, 'LW>RM': 0.08,
    'LWB>LM': 0.05, 'LM>LWB': 0.06, 'RWB>RM': 0.05, 'RM>RWB': 0.06,
    'LWB>LW': 0.08, 'LW>LWB': 0.09, 'RWB>RW': 0.08, 'RW>RWB': 0.09,
    'CB>CDM': 0.08, 'CDM>CB': 0.09, 'CDM>CAM': 0.06, 'CAM>CDM': 0.08,
    'CAM>CF': 0.06, 'CF>CAM': 0.08, 'CAM>ST': 0.08, 'ST>CAM': 0.10,
    'ST>LW': 0.08, 'ST>RW': 0.08, 'LW>ST': 0.09, 'RW>ST': 0.09,
    'CF>LW': 0.07, 'CF>RW': 0.07, 'LW>CF': 0.07, 'RW>CF': 0.07
};
const FALLBACK_DRAFT_POSITIONS = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'CF', 'ST'];
const SCORER_ROLE = Object.freeze({
    ST: 3.6, CF: 2.9,
    LW: 1.9, RW: 1.9,
    CAM: 1.45, LM: 1.15, RM: 1.15,
    CM: 0.95,
    CDM: 0.45, LWB: 0.55, RWB: 0.55,
    LB: 0.32, RB: 0.32, CB: 0.28
});
const ASSIST_ROLE = Object.freeze({
    CAM: 2.6, CM: 2.15,
    LW: 2.0, RW: 2.0, LM: 1.85, RM: 1.85,
    CF: 1.35, ST: 0.95,
    CDM: 1.15, LWB: 1.25, RWB: 1.25,
    LB: 0.9, RB: 0.9, CB: 0.3
});
const SEASON_MATCHDAYS = 38;
const LEAGUE_GHOST_NERF = 11;
// Rival-club (ghost) players count for less when individual awards are decided, so a human-drafted star
// usually wins. Displayed stats stay real; only the ranking is handicapped.
const GHOST_AWARD_FACTOR = 0.8;       // goals / assists / clean sheets are worth 80% for ghosts
const GHOST_RATING_PENALTY = 0.25;    // average-rating handicap for ghosts (Player of the Season)
const EURO_GHOST_NERF = 17; // keeps European ghosts clearly below a well-drafted squad
const GHOST_CLUB_NAMES = [
    "Northgate FC", "Riverbank United", "Crown Athletic", "Harbor City",
    "Ironworks Rovers", "Lakeside Town", "Castleford", "Milltown",
    "Redcliff Wanderers", "Silverport", "Oakwood", "Highbury Ghosts",
    "Westend Albion", "Eastmere", "Southgate Rovers", "Bluefield",
    "Goldstone", "Ashford United", "Pinehill", "Stormbridge"
];
const GHOST_FIRST = [
    'Luca', 'Marco', 'Niklas', 'Jonas', 'Felix', 'Tobias', 'Leon', 'Erik', 'Oscar', 'Hugo',
    'Mateo', 'Diego', 'Carlos', 'Pablo', 'Alvaro', 'Sergio', 'Ivan', 'Niko', 'Luka', 'Dusan',
    'Andre', 'Pierre', 'Theo', 'Noah', 'Adam', 'Sam', 'Ben', 'Alex', 'Max', 'Kai',
    'Youssef', 'Amine', 'Rafael', 'Tiago', 'Bruno', 'Pedro', 'Joao', 'Ricardo', 'Milan', 'Stefan'
];
const GHOST_LAST = [
    'Müller', 'Schmidt', 'Weber', 'Fischer', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter',
    'Garcia', 'Martinez', 'Lopez', 'Sanchez', 'Perez', 'Gonzalez', 'Rodriguez', 'Fernandez', 'Ruiz', 'Diaz',
    'Silva', 'Santos', 'Oliveira', 'Costa', 'Pereira', 'Ferreira', 'Almeida', 'Rocha', 'Carvalho', 'Gomes',
    'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco',
    'Novak', 'Horvat', 'Kovac', 'Nowak', 'Kowalski', 'Jankovic', 'Petrovic', 'Ivanovic', 'Popov', 'Dimitrov'
];
// Defensive actions and key passes are not simulated event-by-event, so each role draws a
// typical workload here. The means are set so every role earns a comparable rating credit.
const RATING_ACTION_MEAN = {
    GK: { def: 0.0, key: 0.2 },
    CB: { def: 5.5, key: 0.5 },
    LB: { def: 4.35, key: 1.4 },
    RB: { def: 4.35, key: 1.4 },
    LWB: { def: 4.1, key: 1.6 },
    RWB: { def: 4.1, key: 1.6 },
    CDM: { def: 4.8, key: 1.5 },
    CM: { def: 2.5, key: 2.3 },
    CAM: { def: 1.35, key: 2.7 },
    LM: { def: 1.85, key: 2.2 },
    RM: { def: 1.85, key: 2.2 },
    LW: { def: 0.9, key: 2.0 },
    RW: { def: 0.9, key: 2.0 },
    CF: { def: 0.7, key: 1.2 },
    ST: { def: 0.6, key: 1.0 }
};

const EURO_ROUNDS = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
// Tier 1 = elite, 5 = underdog. Opponents are drawn by round: early rounds lean to the
// lower/mid tiers, and the closer you get to the final the more elite the opposition becomes.
const EURO_CLUB_POOL = {
    UCL: {
        1: ['Real Madrid', 'Manchester City', 'Bayern Munich', 'Barcelona', 'Paris Saint-Germain', 'Liverpool', 'Inter Milan', 'Arsenal'],
        2: ['Atlético Madrid', 'Juventus', 'AC Milan', 'Chelsea', 'Borussia Dortmund', 'Bayer Leverkusen', 'Napoli', 'Newcastle United', 'Atalanta'],
        3: ['Benfica', 'Porto', 'Sporting CP', 'RB Leipzig', 'Ajax', 'PSV Eindhoven', 'Aston Villa', 'Marseille', 'Monaco'],
        4: ['Feyenoord', 'Lille', 'Celtic', 'Club Brugge', 'Galatasaray', 'Real Sociedad', 'Girona', 'VfB Stuttgart', 'Brest'],
        5: ['Shakhtar Donetsk', 'Red Bull Salzburg', 'Young Boys', 'FC Copenhagen', 'Dinamo Zagreb', 'Red Star Belgrade', 'Slavia Prague', 'Sparta Prague', 'Sturm Graz']
    },
    UEL: {
        1: ['Manchester United', 'Tottenham', 'Roma', 'Lazio', 'Sevilla', 'Villarreal'],
        2: ['West Ham', 'Real Betis', 'Fiorentina', 'Eintracht Frankfurt', 'Brighton', 'Lyon', 'Athletic Club', 'Bologna'],
        3: ['Nice', 'Rennes', 'SC Freiburg', 'Union Berlin', 'VfL Wolfsburg', 'Fenerbahçe', 'Braga', 'Rangers'],
        4: ['Olympiacos', 'PAOK', 'Anderlecht', 'Genk', 'Union Saint-Gilloise', 'AZ Alkmaar', 'FC Twente', 'FC Basel'],
        5: ['Maccabi Tel Aviv', 'Ludogorets', 'Qarabağ', 'Ferencváros', 'Bodø/Glimt', 'Molde', 'Legia Warsaw', 'Viktoria Plzeň', 'Hajduk Split', 'Dynamo Kyiv', 'Panathinaikos', 'Midtjylland']
    }
};
// Probability of facing each tier (index 0 = tier 1) per round
const EURO_ROUND_TIER_WEIGHTS = {
    UCL: [[0.08, 0.22, 0.32, 0.28, 0.10], [0.20, 0.32, 0.30, 0.14, 0.04], [0.38, 0.38, 0.18, 0.06, 0.00], [0.55, 0.35, 0.10, 0.00, 0.00]],
    UEL: [[0.04, 0.16, 0.32, 0.30, 0.18], [0.12, 0.28, 0.32, 0.20, 0.08], [0.28, 0.38, 0.24, 0.08, 0.02], [0.45, 0.38, 0.15, 0.02, 0.00]]
};
const EURO_TIER_DELTA = { 1: 3, 2: 1.5, 3: 0, 4: -1.5, 5: -3 };
// Europe's group nights are more open than a league afternoon and the home crowd
// carries more of it. Benchmarked against the real group stage: ~2.95 goals a
// match with roughly 45% home / 23% draw / 32% away.
const EURO_GROUP_GOALS_PER_TEAM = 1.44;
const EURO_GROUP_HOME_ADVANTAGE = 0.18;
const CEREMONY_AWARDS = [
    { key: 'ballon',   title: "Ballon d'Or",                   icon: '🏆', accent: '#fbbf24', criteria: 'Season performance + trophies + big-game impact' },
    { key: 'european', title: 'FIFA Best European Player',     icon: '⭐', accent: '#60a5fa', criteria: 'European nationals · form + domestic success' },
    { key: 'world',    title: 'FIFA World Player of the Year', icon: '🌍', accent: '#34d399', criteria: 'Non-European nationals · form + continental success' },
    { key: 'shoe',     title: 'European Golden Shoe',          icon: '👟', accent: '#fb923c', criteria: 'Most league goals (×2 weighting)' }
];

const EURO_NATIONALITY_SET = new Set([
    'england', 'scotland', 'wales', 'northern ireland', 'ireland', 'republic of ireland', 'uk', 'united kingdom', 'great britain',
    'france', 'spain', 'portugal', 'italy', 'germany', 'west germany', 'east germany', 'netherlands', 'holland', 'belgium',
    'switzerland', 'austria', 'luxembourg', 'denmark', 'sweden', 'norway', 'finland', 'iceland', 'faroe islands',
    'poland', 'czech republic', 'czechia', 'czechoslovakia', 'slovakia', 'hungary', 'romania', 'bulgaria',
    'serbia', 'croatia', 'slovenia', 'bosnia', 'bosnia and herzegovina', 'montenegro', 'north macedonia', 'macedonia', 'albania', 'kosovo', 'yugoslavia',
    'greece', 'turkey', 'turkiye', 'cyprus', 'malta', 'ukraine', 'russia', 'soviet union', 'ussr', 'belarus', 'moldova',
    'lithuania', 'latvia', 'estonia', 'georgia', 'armenia',
    'english', 'scottish', 'welsh', 'irish', 'french', 'spanish', 'portuguese', 'italian', 'german', 'dutch', 'belgian', 'swiss',
    'austrian', 'danish', 'swedish', 'norwegian', 'finnish', 'icelandic', 'polish', 'czech', 'slovak', 'hungarian', 'romanian',
    'bulgarian', 'serbian', 'croatian', 'slovenian', 'bosnian', 'montenegrin', 'albanian', 'greek', 'turkish', 'ukrainian', 'russian'
]);

const EURO_OUTCOME_POINTS = {
    UCL: { champion: 30, final: 18, sf: 11, qf: 6, r16: 3 },
    UEL: { champion: 14, final: 9, sf: 5, qf: 3, r16: 1 }
};
const AWARD_FORMULAS = {
    ballon:   { perf: 1.0, big: 1.0, euro: 1.0, league: 0.7, prestige: 1.0 },  // trophies + Europe matter most
    european: { perf: 1.1, big: 0.6, euro: 0.6, league: 1.0, prestige: 0.5 },  // domestic consistency matters more
    world:    { perf: 1.0, big: 0.9, euro: 0.9, league: 0.5, prestige: 1.0 }   // continental stage + star power
};

// --- Match plan ---
// Three independent phases from modern coaching: how you build in possession,
// how you defend out of possession, and how you handle the moments of transition.
// Each profile feeds chance creation, control, counters, cards, stamina and set pieces.
const DEFAULT_TACTICS = Object.freeze({ possession: 'positional', defense: 'mid', transition: 'balanced' });

// In Possession (Build-Up & Attacking)
const TACTICS_POSSESSION = Object.freeze({
    positional: {
        label: 'Positional Play',
        short: 'Zones, triangles, fluid rotations',
        attack: 1.05, control: 0.16, transition: 1.06, card: 0.96, stamina: 1.02, setPiece: 1.00, counter: 0.88,
        vsDefense: { high: 0.96, mid: 1.03, low: 1.06, zonal: 1.02, man: 0.98 }
    },
    lavolpiana: {
        label: 'La Salida Lavolpiana',
        short: 'DM drops between CBs; fullbacks bomb on',
        attack: 1.06, control: 0.12, transition: 1.08, card: 0.97, stamina: 1.06, setPiece: 0.98, counter: 0.92,
        vsDefense: { high: 1.00, mid: 1.04, low: 1.02, zonal: 1.03, man: 0.99 }
    },
    spatial: {
        label: 'Spatial Exploitation',
        short: 'Half-spaces & Zone 14',
        attack: 1.10, control: 0.08, transition: 1.05, card: 0.98, stamina: 1.04, setPiece: 1.02, counter: 1.00,
        vsDefense: { high: 1.02, mid: 1.05, low: 0.98, zonal: 1.04, man: 1.01 }
    },
    overload: {
        label: 'Overloads & Isolation',
        short: 'Load one flank, switch to the free man',
        attack: 1.13, control: 0.03, transition: 1.06, card: 1.02, stamina: 1.08, setPiece: 1.04, counter: 1.06,
        vsDefense: { high: 1.05, mid: 1.04, low: 1.00, zonal: 1.05, man: 0.97 }
    },
    central: {
        label: 'Central Overloads',
        short: 'False 9 & inverted fullbacks',
        attack: 1.08, control: 0.14, transition: 1.10, card: 0.97, stamina: 1.10, setPiece: 0.96, counter: 0.94,
        vsDefense: { high: 1.01, mid: 1.05, low: 1.00, zonal: 1.03, man: 0.98 }
    },
    direct: {
        label: 'Route One',
        short: 'Bypass midfield; target-man hold-up',
        attack: 1.09, control: -0.14, transition: 0.92, card: 1.04, stamina: 1.02, setPiece: 1.14, counter: 1.18,
        vsDefense: { high: 1.10, mid: 0.98, low: 0.92, zonal: 0.97, man: 1.04 }
    }
});

// Out of Possession (Defending)
const TACTICS_DEFENSE = Object.freeze({
    high: {
        label: 'High Press',
        short: 'High engagement line; squeeze space',
        attack: 1.07, concede: 1.10, control: 0.12, transition: 1.16, card: 1.32, stamina: 1.34, setPiece: 0.98, fouls: 1.18
    },
    mid: {
        label: 'Mid Block',
        short: 'Balanced engagement line and shape',
        attack: 1.00, concede: 0.98, control: 0.02, transition: 1.00, card: 1.00, stamina: 1.00, setPiece: 1.00, fouls: 1.00
    },
    low: {
        label: 'Low Block',
        short: 'Deep Catenaccio shape; protect the box',
        attack: 0.88, concede: 0.80, control: -0.18, transition: 0.86, card: 0.82, stamina: 0.88, setPiece: 0.94, fouls: 0.90
    },
    zonal: {
        label: 'Zonal Mid Block',
        short: 'Guard zones; pass on runners',
        attack: 0.99, concede: 0.96, control: 0.04, transition: 0.97, card: 0.90, stamina: 0.96, setPiece: 1.00, fouls: 0.88
    },
    man: {
        label: 'Man-to-Man Press',
        short: 'Track runners; disrupt creators',
        attack: 1.04, concede: 0.94, control: -0.02, transition: 1.08, card: 1.28, stamina: 1.20, setPiece: 1.02, fouls: 1.26
    }
});

// Transitions (Change of Possession)
const TACTICS_TRANSITION = Object.freeze({
    gegenpress: {
        label: 'Gegenpressing',
        short: 'Swarm the ball the second it is lost',
        attack: 1.04, concede: 1.06, control: 0.06, transition: 1.22, card: 1.18, stamina: 1.28, setPiece: 0.98, fouls: 1.12,
        counter: 0.85
    },
    restDefense: {
        label: 'Rest-Defense',
        short: 'Structure while attacking; kill counters',
        attack: 0.96, concede: 0.88, control: 0.02, transition: 0.82, card: 0.94, stamina: 0.94, setPiece: 1.00, fouls: 0.95,
        counter: 0.90
    },
    counter: {
        label: 'Counter-Attack',
        short: 'Vertical transition the moment you win it',
        attack: 1.08, concede: 1.04, control: -0.08, transition: 0.96, card: 1.02, stamina: 1.06, setPiece: 1.02, fouls: 1.00,
        counter: 1.28
    },
    restAttack: {
        label: 'Rest-Attack',
        short: 'Leave forwards high as outlets',
        attack: 1.06, concede: 1.08, control: -0.06, transition: 1.04, card: 1.00, stamina: 1.04, setPiece: 0.98, fouls: 0.98,
        counter: 1.20
    },
    balanced: {
        label: 'Balanced',
        short: 'Standard recover and progress',
        attack: 1.00, concede: 1.00, control: 0.00, transition: 1.00, card: 1.00, stamina: 1.00, setPiece: 1.00, fouls: 1.00,
        counter: 1.00
    },
    tacticalFoul: {
        label: 'Tactical Fouling',
        short: 'Stop the counter with a foul high up',
        attack: 0.98, concede: 0.94, control: 0.00, transition: 0.90, card: 1.35, stamina: 0.98, setPiece: 1.06, fouls: 1.40,
        counter: 0.95
    }
});

// --- Archetypes ---
// Every player has one positional Archetype, legal only for the positions of its group.
// A style does three things: it shapes the six attributes the player is rated on, it
// nudges his effective rating depending on how the role suits the match plan on both
// sides (fit), and it decides which kind of chance he is asked to take (weights).
// `attrs` is the role's body: points spent on the attributes the job demands and taken
// back from the ones it does not. It is weighted against POS_WEIGHTS of the position it
// is authored for, so it adds up to zero rating and a Poacher and a False 9 at the same
// overall are visibly different men.
// `fit.own` / `fit.opp` are indexed by the three tactic phases, so a style that
// thrives against a low block only pays out when the opponent really parks it.
// Two authoring rules keep roles honest:
//   1. every phase is zero-sum — the `own` entries add to zero and the `opp`
//      entries add to zero, so a style is never a hidden stat boost;
//   2. the positive entries across a style stay under ARCHETYPE_FIT_CLAMP, so a
//      matchup never saturates and no row of the table is wasted.
// The result is a pure trade-off: a role wins when the plan on either side of
// the pitch suits it and costs when it does not, against an average of zero.
const ARCHETYPE_FIT_CLAMP = 3;
const ARCHETYPES = Object.freeze({
    // --- Goalkeepers ---
    'Sweeper Keeper': {
        attrs: { PAC: 14, SHO: 9, PAS: 9, DRI: 4, DEF: -4, PHY: -3 },
        group: 'GK',
        fit: { own: { defense: { high: 1.2, man: 0.4, low: -1.6 } },
               opp: { possession: { direct: 1.4, positional: -0.7, central: -0.7 } } }
    },
    'Goalkeeper': {
        attrs: { PAC: -12, SHO: -8, PAS: -8, DRI: -4, DEF: 4, PHY: 2 },
        group: 'GK',
        fit: { own: { defense: { low: 1.2, zonal: 0.4, high: -1.0, man: -0.6 } },
               opp: { possession: { overload: 1.0, spatial: 0.4, positional: -0.7, direct: -0.7 } } }
    },
    // --- Centre-backs ---
    'Ball-Playing Defender': {
        attrs: { PAC: 3, SHO: -1, PAS: 13, DRI: 3, DEF: -5, PHY: -4 },
        group: 'CB',
        fit: { own: { possession: { positional: 1.0, lavolpiana: 0.8, spatial: -0.6, central: -0.4, direct: -0.8 } },
               opp: { defense: { high: 0.9, man: 0.3, low: -1.2 } } },
        weights: { assist: 1.15 }
    },
    'No-Nonsense Defender': {
        attrs: { PAC: -6, SHO: -4, PAS: -13, DRI: -9, DEF: 8, PHY: 5 },
        group: 'CB',
        fit: { own: { defense: { man: 1.1, low: 0.7, high: -1.2, zonal: -0.6 } },
               opp: { possession: { direct: 0.9, positional: -0.5, central: -0.4 } } },
        weights: { score: 0.85, assist: 0.85, setPiece: 1.2, workload: { def: 1.25, key: 0.7 } }
    },
    'Central Defender': {
        attrs: { PAC: -5, SHO: -2, PAS: -6, DRI: -4, DEF: 4, PHY: 2 },
        group: 'CB',
        fit: { own: { defense: { zonal: 0.9, mid: 0.5, high: -0.6, man: -0.8 } },
               opp: { possession: { positional: 0.7, central: 0.4, direct: -0.6, overload: -0.5 } } },
        weights: { score: 0.8, assist: 0.85, setPiece: 1.15, workload: { def: 1.2, key: 0.75 } }
    },
    'Libero': {
        attrs: { PAC: 4, SHO: -2, PAS: 11, DRI: 6, DEF: -6, PHY: -2 },
        group: 'CB',
        fit: { own: { possession: { positional: 0.9, lavolpiana: 0.7, direct: -0.9, overload: -0.7 },
                      defense: { high: 0.6, mid: 0.2, low: -0.8 } },
               opp: { transition: { gegenpress: 0.7, counter: -0.4, restDefense: -0.3 } } },
        weights: { assist: 1.25, score: 0.9, workload: { def: 1.05, key: 1.15 } }
    },
    'Wide Centre-Back': {
        attrs: { PAC: 7, SHO: -1, PAS: 6, DRI: 6, DEF: -4, PHY: -3 },
        group: 'CB',
        fit: { own: { possession: { overload: 0.9, spatial: 0.6, central: -0.7, positional: -0.8 },
                      defense: { high: 0.5, man: 0.3, low: -0.8 } },
               opp: { possession: { direct: 0.6, positional: -0.3, central: -0.3 } } },
        weights: { score: 0.95, assist: 1.1, setPiece: 1.1, workload: { def: 1.1, key: 1.0 } }
    },
    // --- Full-backs / wing-backs ---
    'Inverted Wing-Back': {
        attrs: { PAC: 2, SHO: -1, PAS: 9, DRI: 6, DEF: -9, PHY: -3 },
        group: 'FB',
        fit: { own: { possession: { positional: 1.0, central: 0.8, direct: -1.1, overload: -0.7 } },
               opp: { transition: { gegenpress: 0.9, counter: -0.5, tacticalFoul: -0.4 } } },
        weights: { score: 0.85, assist: 1.2, workload: { def: 1.1, key: 1.1 } }
    },
    'Complete Wing-Back': {
        attrs: { PAC: 8, SHO: 2, PAS: 7, DRI: 7, DEF: -10, PHY: -10 },
        group: 'FB',
        fit: { own: { possession: { overload: 1.2, direct: 0.4, central: -0.8, positional: -0.8 } },
               opp: { defense: { low: 1.0, man: -0.5, zonal: -0.5 } } },
        weights: { score: 1.05, assist: 1.35, setPiece: 1.1, workload: { def: 0.9, key: 1.3 } }
    },
    'Wing-Back': {
        attrs: { PAC: 7, SHO: 0, PAS: 4, DRI: 4, DEF: -8, PHY: -5 },
        group: 'FB',
        fit: { own: { possession: { overload: 0.9, spatial: 0.6, direct: 0.3, positional: -0.9, central: -0.9 },
                      transition: { counter: 0.5, restAttack: 0.3, restDefense: -0.8 } },
               opp: { defense: { high: 0.7, low: -0.4, man: -0.3 } } },
        weights: { score: 1.0, assist: 1.3, workload: { def: 0.95, key: 1.2 } }
    },
    'No-Nonsense Full-Back': {
        attrs: { PAC: 2, SHO: -4, PAS: -9, DRI: -5, DEF: 8, PHY: 3 },
        group: 'FB',
        fit: { own: { defense: { low: 1.0, man: 0.6, high: -0.9, zonal: -0.7 },
                      possession: { direct: 0.4, positional: -0.4 } },
               opp: { possession: { direct: 0.9, overload: 0.3, positional: -0.6, central: -0.6 } } },
        weights: { score: 0.75, assist: 0.9, setPiece: 1.05, workload: { def: 1.3, key: 0.7 } }
    },
    // --- Midfield ---
    'Deep-Lying Playmaker': {
        attrs: { PAC: -3, SHO: -3, PAS: 7, DRI: 2, DEF: -5, PHY: -4 },
        group: 'MID',
        fit: { own: { possession: { positional: 0.9, lavolpiana: 0.9, direct: -1.1, spatial: -0.7 } },
               opp: { transition: { restAttack: 0.5, counter: 0.5, gegenpress: -1.0 } } },
        weights: { score: 0.85, assist: 1.35, setPiece: 1.1, workload: { def: 0.85, key: 1.35 } }
    },
    'Box-to-Box Midfielder': {
        attrs: { PAC: 6, SHO: 0, PAS: -6, DRI: 0, DEF: 2, PHY: 2 },
        group: 'MID',
        fit: { own: { defense: { high: 0.8, man: 0.4, low: -1.2 },
                      transition: { gegenpress: 0.9, restAttack: 0.3, restDefense: -0.7, balanced: -0.5 } },
               opp: { possession: { positional: 0.5, direct: -0.5 } } },
        weights: { score: 1.2, assist: 1.1, workload: { def: 1.15, key: 1.15 } }
    },
    'Ball-Winning Midfielder': {
        attrs: { PAC: 3, SHO: -3, PAS: -4, DRI: -2, DEF: 9, PHY: 5 },
        group: 'MID',
        fit: { own: { defense: { man: 1.0, high: 0.6, low: -0.9, zonal: -0.7 },
                      transition: { gegenpress: 0.7, tacticalFoul: 0.4, restDefense: -0.6, counter: -0.5 } },
               opp: { possession: { positional: 0.6, central: 0.3, direct: -0.5, overload: -0.4 } } },
        weights: { score: 0.9, assist: 0.95, workload: { def: 1.35, key: 0.8 } }
    },
    'Roaming Playmaker': {
        attrs: { PAC: 2, SHO: 0, PAS: 2, DRI: 5, DEF: -10, PHY: -5 },
        group: 'MID',
        fit: { own: { possession: { spatial: 1.1, overload: 0.5, positional: 0.3, direct: -0.9, central: -0.5, lavolpiana: -0.5 } },
               opp: { defense: { zonal: 0.6, man: 0.3, low: -0.9 } } },
        weights: { score: 1.2, assist: 1.15, workload: { def: 0.95, key: 1.2 } }
    },
    'Advanced Playmaker': {
        attrs: { PAC: -2, SHO: 4, PAS: 5, DRI: 3, DEF: -11, PHY: -6 },
        group: 'MID',
        fit: { own: { possession: { positional: 0.7, central: 0.5, direct: -1.2 } },
               opp: { defense: { low: 1.2, zonal: 0.5, man: -0.9, high: -0.8 } } },
        weights: { score: 1.1, assist: 1.45, setPiece: 1.2, workload: { def: 0.7, key: 1.5 } }
    },
    'Mezzala': {
        attrs: { PAC: 5, SHO: 2, PAS: 1, DRI: 3, DEF: -7, PHY: -4 },
        group: 'MID',
        fit: { own: { possession: { spatial: 0.9, overload: 0.7, central: 0.3, positional: -0.8, direct: -0.6, lavolpiana: -0.5 } },
               opp: { defense: { zonal: 0.7, low: 0.4, man: -0.6, high: -0.5 } } },
        weights: { score: 1.15, assist: 1.2, setPiece: 1.05, workload: { def: 0.9, key: 1.25 } }
    },
    'Carrilero': {
        attrs: { PAC: 2, SHO: -4, PAS: 1, DRI: -3, DEF: 4, PHY: 1 },
        group: 'MID',
        fit: { own: { possession: { positional: 0.6, spatial: 0.5, overload: 0.3, direct: -0.7, central: -0.7 },
                      defense: { mid: 0.5, high: 0.3, low: -0.8 } },
               opp: { transition: { counter: 0.5, gegenpress: 0.3, restAttack: -0.4, restDefense: -0.4 } } },
        weights: { score: 0.9, assist: 1.15, workload: { def: 1.15, key: 1.1 } }
    },
    'Anchor Man': {
        attrs: { PAC: -2, SHO: -4, PAS: 1, DRI: -4, DEF: 7, PHY: 5 },
        group: 'MID',
        fit: { own: { defense: { low: 1.0, man: 0.6, high: -0.9, zonal: -0.7 },
                      possession: { positional: 0.5, lavolpiana: 0.4, direct: -0.5, overload: -0.4 } },
               opp: { possession: { direct: 0.8, overload: 0.4, positional: -0.6, central: -0.6 } } },
        weights: { score: 0.7, assist: 0.95, setPiece: 1.1, workload: { def: 1.4, key: 0.75 } }
    },
    'Half-Back': {
        attrs: { PAC: -4, SHO: -5, PAS: 4, DRI: -4, DEF: 3, PHY: 0 },
        group: 'MID',
        fit: { own: { possession: { lavolpiana: 1.0, positional: 0.7, direct: -0.9, spatial: -0.8 },
                      defense: { mid: 0.5, low: 0.3, high: -0.8 } },
               opp: { defense: { high: 0.7, man: 0.3, low: -1.0 } } },
        weights: { score: 0.75, assist: 1.2, setPiece: 1.05, workload: { def: 1.2, key: 1.1 } }
    },
    'Trequartista': {
        attrs: { PAC: -1, SHO: 3, PAS: 4, DRI: 5, DEF: -11, PHY: -6 },
        group: 'MID',
        fit: { own: { possession: { central: 1.1, positional: 0.6, spatial: 0.3, direct: -1.0, overload: -1.0 } },
               opp: { defense: { zonal: 0.9, low: 0.5, man: -0.8, high: -0.6 } } },
        weights: { score: 1.25, assist: 1.35, setPiece: 1.15, workload: { def: 0.55, key: 1.45 } }
    },
    // --- Wingers ---
    'Inside Forward': {
        attrs: { PAC: 1, SHO: 5, PAS: -4, DRI: 2, DEF: -11, PHY: -6 },
        group: 'WING',
        fit: { own: { possession: { central: 0.9, spatial: 0.8, direct: -1.7 } },
               opp: { defense: { low: 0.8, man: -0.4, zonal: -0.4 } } },
        weights: { score: 1.35, assist: 1.1, setPiece: 1.1, workload: { def: 0.85, key: 1.25 } }
    },
    'Classic Winger': {
        attrs: { PAC: 7, SHO: -6, PAS: 0, DRI: 2, DEF: -6, PHY: -9 },
        group: 'WING',
        fit: { own: { possession: { direct: 1.0, overload: 0.6, positional: -0.8, central: -0.8 } },
               opp: { defense: { high: 1.2, man: -0.8, zonal: -0.4 } } },
        weights: { score: 0.95, assist: 1.35, workload: { def: 0.9, key: 1.3 } }
    },
    'Inverted Winger': {
        attrs: { PAC: 2, SHO: -2, PAS: 2, DRI: 4, DEF: -11, PHY: -6 },
        group: 'WING',
        fit: { own: { possession: { positional: 0.9, central: 0.8, overload: -0.6, direct: -1.1 } },
               opp: { defense: { high: 0.9, low: -0.9 } } },
        weights: { score: 1.05, assist: 1.3, setPiece: 1.15, workload: { def: 0.9, key: 1.4 } }
    },
    'Wide Target Man': {
        attrs: { PAC: 2, SHO: 4, PAS: 1, DRI: -4, DEF: -4, PHY: 1 },
        group: 'WING',
        fit: { own: { possession: { direct: 1.1, overload: 0.7, spatial: 0.2, positional: -1.0, central: -1.0 } },
               opp: { defense: { high: 0.8, man: 0.3, low: -0.6, zonal: -0.5 } } },
        weights: { score: 1.2, assist: 1.15, setPiece: 1.35, counter: 1.1, workload: { def: 0.85, key: 1.0 } }
    },
    // --- Forwards ---
    'Target Forward': {
        attrs: { PAC: -9, SHO: 5, PAS: -8, DRI: -9, DEF: -9, PHY: 12 },
        group: 'FWD',
        fit: { own: { possession: { direct: 1.6, overload: 0.4, positional: -1.1, central: -0.9 } },
               opp: { defense: { high: 0.6, low: 0.4, man: -1.0 } } },
        weights: { score: 1.15, assist: 1.05, setPiece: 1.5, counter: 1.1, workload: { def: 0.8, key: 0.9 } }
    },
    'Poacher': {
        attrs: { PAC: 5, SHO: 8, PAS: -13, DRI: -3, DEF: -19, PHY: -4 },
        group: 'FWD',
        fit: { own: { possession: { direct: 0.8, overload: 0.5, positional: -0.8, central: -0.5 } },
               opp: { defense: { high: 1.2, man: 0.5, low: -1.7 } } },
        weights: { score: 1.55, assist: 0.6, setPiece: 1.25, workload: { def: 0.6, key: 0.6 } }
    },
    'False 9': {
        attrs: { PAC: 1, SHO: -5, PAS: 11, DRI: 7, DEF: -11, PHY: -3 },
        group: 'FWD',
        fit: { own: { possession: { central: 1.2, positional: 0.7, direct: -1.2, spatial: -0.7 } },
               opp: { defense: { zonal: 0.6, high: 0.3, man: -0.9 } } },
        weights: { score: 1.05, assist: 1.25, workload: { def: 1.0, key: 1.2 } }
    },
    'Raumdeuter': {
        attrs: { PAC: 6, SHO: 7, PAS: -11, DRI: 1, DEF: -17, PHY: -10 },
        group: 'FWD',
        fit: { own: { possession: { spatial: 0.9, overload: 0.6, positional: -0.8, direct: -0.7 } },
               opp: { defense: { zonal: 1.1, low: 0.3, man: -0.9, high: -0.5 } } },
        weights: { score: 1.4, assist: 0.7, setPiece: 1.15, workload: { def: 0.7, key: 0.8 } }
    },
    'Complete Forward': {
        attrs: { PAC: 2, SHO: 3, PAS: 0, DRI: 2, DEF: -13, PHY: -6 },
        group: 'FWD',
        // Small swings on purpose: this role is never badly placed rather than
        // great in any one spot, which is what makes it worth its rating.
        fit: { own: { possession: { positional: 0.4, spatial: 0.3, overload: 0.3, direct: -0.5, central: -0.5 } },
               opp: { defense: { high: 0.4, man: 0.3, low: -0.7 } } },
        weights: { score: 1.25, assist: 1.15, setPiece: 1.1, workload: { def: 0.9, key: 1.1 } }
    },
    'Advanced Forward': {
        attrs: { PAC: 6, SHO: 4, PAS: -7, DRI: -1, DEF: -17, PHY: -6 },
        group: 'FWD',
        fit: { own: { possession: { spatial: 0.8, overload: 0.7, direct: 0.4, positional: -0.9, central: -1.0 },
                      transition: { counter: 0.6, restAttack: 0.3, restDefense: -0.9 } },
               opp: { defense: { high: 1.0, man: 0.4, low: -0.8, zonal: -0.6 } } },
        weights: { score: 1.4, assist: 1.05, counter: 1.2, workload: { def: 0.85, key: 1.0 } }
    },
    'Deep-Lying Forward': {
        attrs: { PAC: 2, SHO: -3, PAS: 8, DRI: 6, DEF: -11, PHY: -4 },
        group: 'FWD',
        fit: { own: { possession: { positional: 0.9, central: 0.8, lavolpiana: 0.3, direct: -1.0, overload: -1.0 } },
               opp: { defense: { zonal: 0.7, high: 0.4, man: -0.6, low: -0.5 } } },
        weights: { score: 1.0, assist: 1.4, setPiece: 1.1, workload: { def: 0.9, key: 1.35 } }
    },
    'Pressing Forward': {
        attrs: { PAC: 6, SHO: 1, PAS: -4, DRI: 0, DEF: 3, PHY: -8 },
        group: 'FWD',
        fit: { own: { defense: { high: 1.1, man: 0.5, low: -1.0, zonal: -0.6 },
                      transition: { gegenpress: 1.0, counter: 0.3, restDefense: -0.7, balanced: -0.6 } },
               opp: { possession: { positional: 0.6, central: 0.4, direct: -0.5, overload: -0.5 } } },
        weights: { score: 1.15, assist: 1.05, workload: { def: 1.25, key: 0.95 } }
    },
    'Shadow Striker': {
        attrs: { PAC: 3, SHO: 6, PAS: -5, DRI: 0, DEF: -18, PHY: -6 },
        group: 'FWD',
        fit: { own: { possession: { central: 0.9, spatial: 0.7, positional: 0.3, direct: -0.9, overload: -1.0 } },
               opp: { defense: { zonal: 1.0, man: 0.3, high: -0.5, low: -0.8 } } },
        weights: { score: 1.45, assist: 0.95, setPiece: 1.05, workload: { def: 0.75, key: 1.1 } }
    },
    // --- Any position ---
    'Wildcard': {
        attrs: { PAC: 0, SHO: 0, PAS: 0, DRI: 0, DEF: 0, PHY: 0 },
        group: 'ANY',
        // The wildcard is bought with the out-of-position cap, not with raw fit.
        fit: { own: { possession: { positional: 0.4, central: 0.4, direct: -0.8 },
                      transition: { restDefense: 0.4, gegenpress: -0.4 } },
               opp: { defense: { man: 0.6, low: -0.6 } } },
        weights: { score: 0.95, assist: 1.05, workload: { def: 1.05, key: 1.05 } }
    }
});

// Which slots may carry which style. Group membership follows the same lines as
// POSITION_META, and the wildcard is the one style any outfield role can take.
const ARCHETYPE_GROUPS = Object.freeze({
    GK: ['GK'],
    CB: ['CB'],
    FB: ['LB', 'RB', 'LWB', 'RWB'],
    MID: ['CDM', 'CM', 'CAM'],
    WING: ['LW', 'RW', 'LM', 'RM'],
    FWD: ['CF', 'ST'],
    ANY: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'LM', 'RM', 'CF', 'ST']
});

function archetypePositions(key) {
    const style = ARCHETYPES[key];
    return style ? ARCHETYPE_GROUPS[style.group] || [] : [];
}

function archetypeOf(player) {
    const key = player && player.archetype;
    if (!key || !ARCHETYPES[key]) return null;
    const pos = player.mainPos;
    if (pos && !archetypePositions(key).includes(pos)) return null;
    return key;
}

// How much the role suits this player in this specific matchup, in rating points.
function archetypeFitDelta(player, ownTactics, oppTactics) {
    const key = archetypeOf(player);
    if (!key) return 0;
    const fit = ARCHETYPES[key].fit || {};
    const own = ownTactics || DEFAULT_TACTICS;
    const opp = oppTactics || DEFAULT_TACTICS;
    let delta = 0;
    const phases = ['possession', 'defense', 'transition'];
    phases.forEach(phase => {
        if (fit.own && fit.own[phase]) delta += fit.own[phase][own[phase]] || 0;
        if (fit.opp && fit.opp[phase]) delta += fit.opp[phase][opp[phase]] || 0;
    });
    return Math.max(-ARCHETYPE_FIT_CLAMP, Math.min(ARCHETYPE_FIT_CLAMP, delta));
}

// Averaging those slot deltas over the XI is the part a manager actually controls:
// a team-sheet built around one plan gets rewarded with chances, a mismatched one
// pays for it. Every style is zero-sum, so the league average stays where the
// goals-per-match calibration put it and only the split between the two clubs moves.
const ARCHETYPE_COHERENCE_SCALE = 0.04;

function archetypeCoherence(team, oppTactics) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const total = slots.reduce((sum, slot) => sum + archetypeFitDelta(slot.player, team.tactics, oppTactics), 0);
    return 1 + ARCHETYPE_COHERENCE_SCALE * (total / slots.length);
}

// A stable style for a name with no curated entry, which is how ghost clubs get
// their roles: same name, same position, same style, on every machine.
function archetypeForName(pos, name) {
    const legal = Object.keys(ARCHETYPES).filter(key =>
        ARCHETYPE_GROUPS[ARCHETYPES[key].group].includes(pos) && ARCHETYPES[key].group !== 'ANY');
    if (!legal.length) return null;
    let hash = 0;
    const label = String(name || '');
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return legal[hash % legal.length];
}

function archetypeWeights(player) {
    const key = archetypeOf(player);
    const style = key ? ARCHETYPES[key] : null;
    const w = (style && style.weights) || {};
    return {
        score: w.score ?? 1,
        assist: w.assist ?? 1,
        setPiece: w.setPiece ?? 1,
        counter: w.counter ?? 1,
        workload: w.workload || { def: 1, key: 1 }
    };
}

// The attribute shape a role identity buys a player. Both tables carry their deltas
// weighted-zero-sum against POS_WEIGHTS of the position they were authored for, so the
// six numbers trade points with each other and never move the overall rating.
function roleAttributeTilt(archetypeKey, playstyleKey) {
    const tilt = { PAC: 0, SHO: 0, PAS: 0, DRI: 0, DEF: 0, PHY: 0 };
    const arch = archetypeKey && ARCHETYPES[archetypeKey] ? ARCHETYPES[archetypeKey].attrs : null;
    const habit = playstyleKey && PLAYSTYLES[playstyleKey] ? PLAYSTYLES[playstyleKey].attrs : null;
    [arch, habit].forEach(table => {
        if (!table) return;
        Object.keys(tilt).forEach(k => { tilt[k] += table[k] || 0; });
    });
    return tilt;
}

// ============================================================
// PLAYSTYLES — the secondary habit layered on top of the Archetype.
//
// An archetype answers "what job does this player do on the pitch"; a playstyle is
// the reputation tag for dead balls, clutch moments, durability and technical habits.
// The keys are the names the scout strip prints, and every entry is named after the
// myth the community gave the habit — Boreas for the quickest man in the side,
// Athena for the one who stands over a corner. Example: a Poacher wearing Achilles is
// a box threat you must not foul.
//
// Same authoring rules as ARCHETYPES:
//   1. every `fit` phase is zero-sum, so a playstyle is never a hidden stat boost;
//   2. `attrs` is weighted-zero-sum, so a habit shapes the six numbers without
//      buying rating;
//   3. the other fields are trade-offs, not free upgrades — the aggressive tags buy
//      actions with fouls and cards, the durable tags buy minutes with nothing else.
// ============================================================
const PLAYSTYLE_FIT_CLAMP = 2;
const PLAYSTYLE_LEAD_CAP = 1.5;
const PLAYSTYLE_LEAD_SCALE = 0.7;

const SP_ALL = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const SP_OUT = SP_ALL.filter(p => p !== 'GK');
const SP_DEF = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'];
const SP_FB = ['LB', 'RB', 'LWB', 'RWB'];
const SP_MID = ['CDM', 'CM', 'CAM', 'LM', 'RM'];
const SP_ATT = ['CAM', 'LW', 'RW', 'CF', 'ST'];
const SP_WING = ['LW', 'RW', 'LM', 'RM'];
const SP_STRIKER = ['CF', 'ST'];

const PLAYSTYLES = Object.freeze({
    // --- Dead-ball & tactical specialists ---
    'Odin': {
        attrs: { PAC: -1, SHO: -1, PAS: 1, DRI: -1, DEF: 3, PHY: 2 },
        group: 'Dead Ball', positions: SP_ALL,
        lead: 1, card: 0.9,
        fit: { own: { defense: { high: 0.4, man: 0.3, low: -0.7 } },
               opp: { transition: { gegenpress: 0.5, counter: -0.5 } } }
    },
    'Athena': {
        attrs: { PAC: -4, SHO: 3, PAS: 5, DRI: -1, DEF: -3, PHY: -3 },
        group: 'Dead Ball',
        positions: ['CAM', 'CM', 'CDM', 'LM', 'RM'].concat(SP_WING, SP_FB, SP_STRIKER),
        setPiece: 1.45, delivery: 1.85, pen: 0.02, taker: true,
        fit: { own: { possession: { positional: 0.6, central: 0.4, direct: -1.0 } } }
    },
    'Achilles': {
        attrs: { PAC: -1, SHO: 4, PAS: 0, DRI: -1, DEF: -2, PHY: -3 },
        group: 'Dead Ball', positions: SP_OUT,
        pen: 0.09, taker: true, setPiece: 1.1,
        fit: { own: { possession: { central: 0.5, direct: -0.5 } } }
    },
    'Atlas': {
        attrs: { PAC: -1, SHO: 0, PAS: -1, DRI: -3, DEF: 4, PHY: 7 },
        group: 'Dead Ball',
        positions: SP_FB.concat(['CB']),
        delivery: 1.6, aerial: 1.3, extraSetPieces: 0.03,
        fit: { own: { possession: { overload: 0.5, direct: 0.4, positional: -0.9 } } }
    },

    // --- Leadership & mental modifiers ---
    'Apollo': {
        attrs: { PAC: -1, SHO: -1, PAS: 0, DRI: -1, DEF: 2, PHY: 1 },
        group: 'Mind', positions: SP_ALL,
        lead: 0.5, card: 0.95
    },
    'Heimdall': {
        attrs: { PAC: -1, SHO: -2, PAS: -1, DRI: -2, DEF: 3, PHY: 2 },
        group: 'Mind', positions: SP_ALL,
        lead: 0.25, card: 0.8, fouls: 0.9,
        fit: { own: { defense: { zonal: 0.5, man: -0.5 } } }
    },
    'Zeus': {
        attrs: { PAC: -1, SHO: 4, PAS: -2, DRI: -2, DEF: 2, PHY: 2 },
        group: 'Mind', positions: SP_OUT,
        clutch: 1.35, card: 0.9,
        fit: { own: { defense: { high: 0.5, man: 0.3, low: -0.8 } },
               opp: { possession: { direct: 0.6, positional: -0.6 } } }
    },
    'Hermes': {
        attrs: { PAC: 4, SHO: 1, PAS: -1, DRI: 2, DEF: -5, PHY: -4 },
        group: 'Mind',
        positions: SP_WING.concat(SP_STRIKER, ['CAM', 'CM']),
        sub: 1.5,
        fit: { own: { possession: { direct: 0.5, spatial: 0.4, positional: -0.9 } } }
    },
    'Ares': {
        attrs: { PAC: -2, SHO: -2, PAS: -2, DRI: -5, DEF: 6, PHY: 8 },
        group: 'Mind', positions: SP_DEF,
        card: 1.45, fouls: 1.15, aerial: 1.25, workload: { def: 1.2, key: 0.9 },
        fit: { own: { defense: { man: 0.6, low: 0.4, high: -1.0 } } }
    },
    'Fenrir': {
        attrs: { PAC: 3, SHO: -2, PAS: -3, DRI: -2, DEF: 3, PHY: 4 },
        group: 'Mind', positions: SP_OUT,
        card: 1.7, fouls: 1.18, workload: { def: 1.1, key: 1 },
        fit: { own: { defense: { high: 0.5, man: 0.4, low: -0.9 },
                      transition: { gegenpress: 0.6, restDefense: -0.6 } } }
    },

    // --- Physical & durability tags ---
    'Talos': {
        attrs: { PAC: 4, SHO: -2, PAS: -2, DRI: -3, DEF: 2, PHY: 6 },
        group: 'Body', positions: SP_ALL,
        stamina: 0.72, injury: 0.55, workload: { def: 1.08, key: 1.05 }
    },
    'Prometheus': {
        attrs: { PAC: 2, SHO: 2, PAS: 1, DRI: 3, DEF: -2, PHY: -8 },
        group: 'Body', positions: SP_ALL,
        injury: 2.1, stamina: 1.25
    },
    'Heracles': {
        attrs: { PAC: 5, SHO: -3, PAS: -2, DRI: 0, DEF: 4, PHY: 3 },
        group: 'Body', positions: SP_OUT,
        stamina: 0.85, workload: { def: 1.25, key: 1.15 },
        fit: { own: { defense: { high: 0.5, zonal: 0.3, low: -0.8 },
                      transition: { gegenpress: 0.4, balanced: -0.4 } } }
    },
    'Boreas': {
        attrs: { PAC: 8, SHO: -2, PAS: -2, DRI: 2, DEF: -3, PHY: -5 },
        group: 'Body',
        positions: SP_FB.concat(SP_WING, SP_ATT),
        counter: 1.35,
        fit: { own: { possession: { direct: 0.7, overload: 0.4, positional: -1.1 } },
               opp: { defense: { high: 1.0, low: -1.0 } } }
    },
    'Ymir': {
        attrs: { PAC: -3, SHO: 4, PAS: -2, DRI: -5, DEF: 3, PHY: 8 },
        group: 'Body',
        positions: ['CB', 'CDM', 'CM', 'LB', 'RB'].concat(SP_STRIKER),
        aerial: 1.7, setPiece: 1.2,
        fit: { own: { possession: { central: 0.4, spatial: -0.4 } },
               opp: { possession: { overload: 0.5, direct: 0.4, positional: -0.9 } } }
    },

    // --- Technical & behavioural tendencies ---
    'Artemis': {
        attrs: { PAC: -1, SHO: 7, PAS: -2, DRI: -3, DEF: -1, PHY: 0 },
        group: 'Craft',
        positions: ['CM', 'CAM', 'CDM', 'LM', 'RM'].concat(SP_WING, SP_STRIKER),
        longShot: 1.6,
        fit: { own: { possession: { central: 0.6, spatial: 0.4, positional: -1.0 } } }
    },
    'Loki': {
        attrs: { PAC: -3, SHO: 0, PAS: 2, DRI: 7, DEF: -5, PHY: -4 },
        group: 'Craft',
        positions: ['CAM', 'CM'].concat(SP_WING, SP_STRIKER),
        flair: 1.3, card: 0.9, fouls: 0.92,
        fit: { own: { possession: { spatial: 0.7, positional: 0.3, direct: -1.0 } },
               opp: { defense: { man: 0.6, zonal: -0.6 } } }
    },
    'Thor': {
        attrs: { PAC: 4, SHO: -2, PAS: -3, DRI: -2, DEF: 6, PHY: -2 },
        group: 'Craft',
        positions: SP_DEF.concat(['CM']),
        card: 1.5, fouls: 1.2, workload: { def: 1.18, key: 0.95 },
        fit: { own: { defense: { man: 0.7, high: 0.4, low: -1.1 } } }
    },
    'Perseus': {
        attrs: { PAC: -4, SHO: -1, PAS: 3, DRI: 1, DEF: -1, PHY: -1 },
        group: 'Craft', positions: SP_OUT,
        card: 0.7, fouls: 0.8,
        fit: { own: { defense: { zonal: 0.5, low: 0.3, man: -0.8 } } }
    }
});

// The four families the tags come from, in the order a scout reads them.
const PLAYSTYLE_GROUPS = Object.freeze({
    'Dead Ball': ['Odin', 'Athena', 'Achilles', 'Atlas'],
    'Mind': ['Apollo', 'Heimdall', 'Zeus', 'Hermes', 'Ares', 'Fenrir'],
    'Body': ['Talos', 'Prometheus', 'Heracles', 'Boreas', 'Ymir'],
    'Craft': ['Artemis', 'Loki', 'Thor', 'Perseus']
});

function playstylePositions(key) {
    const sp = PLAYSTYLES[key];
    return sp ? sp.positions : [];
}

function playstyleOf(player) {
    const key = player && player.playstyle;
    if (!key || !PLAYSTYLES[key]) return null;
    const pos = player.mainPos;
    if (pos && !playstylePositions(key).includes(pos)) return null;
    return key;
}

// The key is the name the scout strip prints, so there is nothing to look up.
function playstyleName(player) {
    return playstyleOf(player) || '';
}

const PLAYSTYLE_DEFAULTS = Object.freeze({
    lead: 0, setPiece: 1, delivery: 1, aerial: 1, longShot: 1, counter: 1, flair: 1,
    sub: 1, clutch: 1, card: 1, fouls: 1, stamina: 1, injury: 1,
    extraSetPieces: 0, pen: 0, taker: false, workload: { def: 1, key: 1 }
});

function playstyleEffects(player) {
    const key = playstyleOf(player);
    const sp = key ? PLAYSTYLES[key] : null;
    const out = {};
    Object.keys(PLAYSTYLE_DEFAULTS).forEach(field => {
        out[field] = sp && sp[field] !== undefined ? sp[field] : PLAYSTYLE_DEFAULTS[field];
    });
    out.workload = { ...(PLAYSTYLE_DEFAULTS.workload), ...((sp && sp.workload) || {}) };
    return out;
}

// Tactic fit, on the same zero-sum contract as a archetype but capped a point
// tighter: a habit is a smaller part of a player than the job he is asked to do.
function playstyleFitDelta(player, ownTactics, oppTactics) {
    const key = playstyleOf(player);
    if (!key) return 0;
    const fit = PLAYSTYLES[key].fit || {};
    const own = ownTactics || DEFAULT_TACTICS;
    const opp = oppTactics || DEFAULT_TACTICS;
    let delta = 0;
    ['possession', 'defense', 'transition'].forEach(phase => {
        if (fit.own && fit.own[phase]) delta += fit.own[phase][own[phase]] || 0;
        if (fit.opp && fit.opp[phase]) delta += fit.opp[phase][opp[phase]] || 0;
    });
    return Math.max(-PLAYSTYLE_FIT_CLAMP, Math.min(PLAYSTYLE_FIT_CLAMP, delta));
}

const PLAYSTYLE_COHERENCE_SCALE = 0.03;

function playstyleCoherence(team, oppTactics) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const total = slots.reduce((sum, slot) => sum + playstyleFitDelta(slot.player, team.tactics, oppTactics), 0);
    return 1 + PLAYSTYLE_COHERENCE_SCALE * (total / slots.length);
}

// One armband is worth a point of calm to everyone else on the pitch; the armband
// plus a vice-captain is worth a little more, and the band never stacks twice.
function leadershipRating(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    const lead = slots.reduce((sum, slot) => sum + playstyleEffects(slot.player).lead, 0);
    return Math.min(PLAYSTYLE_LEAD_CAP, lead) * PLAYSTYLE_LEAD_SCALE;
}

// Dead-ball volume: long throws and tricks win more free kicks than a side that
// never leaves its feet, so the XI's habits move the share of goals from set pieces.
function playstyleSetPieceBoost(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    return Math.min(0.05, slots.reduce((sum, slot) => sum + playstyleEffects(slot.player).extraSetPieces, 0));
}

// How many free kicks this XI gives away, relative to a disciplined side.
function playstyleFoulsGiven(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + playstyleEffects(slot.player).fouls, 0) / slots.length;
    return Math.max(0.85, Math.min(1.15, avg));
}

// Habits that would move the league's overall rate if left raw — measured across the
// XIs a match week actually puts out (generated clubs plus the drafted one) and centred,
// so a tag is a difference between two clubs rather than a global inflation of cards and
// injuries. Each figure is the mean of the quantity its own consumer multiplies, so the
// per-man booking and knock-off rolls land on 1.00 and the team frailty on its own
// higher figure. Re-measured against the curated board, whose habit mix is not the
// auto-assigned one these were first read off: mean card 0.996, mean injury 1.070, and
// the frailty quantity 1.365.
const PLAYSTYLE_CARD_CENTRE = 1.00;
const PLAYSTYLE_INJURY_CENTRE = 1.07;
const PLAYSTYLE_INJURY_TEAM_CENTRE = 1.365;

// How badly this XI behaves when it does: Fenrir and Ares turn challenges into
// bookings, Perseus and Heimdall talk the referee down.
function playstyleBookingRate(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + playstyleEffects(slot.player).card, 0) / slots.length;
    return Math.max(0.85, Math.min(1.2, avg / PLAYSTYLE_CARD_CENTRE));
}

// How often this XI loses a man to a knock. One fragile body in eleven is enough to
// change a substitution, so the risk leans on the worst offender, not the mean.
function playstyleInjuryRisk(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + playstyleEffects(slot.player).injury, 0) / slots.length;
    const worst = slots.reduce((max, slot) => Math.max(max, playstyleEffects(slot.player).injury), 1);
    // A medical programme keeps fragile bodies on the pitch.
    const fit = medicalInjuryFactor(team);
    return Math.max(0.4, Math.min(1.7, ((avg * 0.5 + worst * 0.5) / PLAYSTYLE_INJURY_TEAM_CENTRE) * fit));
}

// One player's own injury appetite, on the same centre as the team figure.
function playstyleInjuryRate(player) {
    return Math.max(0.5, playstyleEffects(player).injury / PLAYSTYLE_INJURY_CENTRE);
}

// One player's own booking appetite, on the same centre as the team figure.
function playstyleBookingRateFor(player) {
    return Math.max(0.6, playstyleEffects(player).card / PLAYSTYLE_CARD_CENTRE);
}

function playstyleWeights(player) {
    const sp = playstyleEffects(player);
    return {
        score: (sp.flair >= 1 ? sp.flair : 1) * sp.longShot,
        assist: sp.flair * sp.delivery,
        setPiece: sp.setPiece * sp.aerial,
        counter: sp.counter,
        sub: sp.sub,
        delivery: sp.delivery,
        workload: sp.workload
    };
}

// A habit only pays when the match is actually on the line, so a squad of Zeus
// carriers is worth a few percent in a knockout leg and nothing in a dead rubber.
const PLAYSTYLE_PRESSURE_SCALE = 0.06;
const PLAYSTYLE_PRESSURE_CAP = 0.06;

function playstyleClutchBoost(team, pressure) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length || !pressure) return 1;
    const total = slots.reduce((sum, slot) => sum + (playstyleEffects(slot.player).clutch - 1), 0);
    const gain = Math.min(PLAYSTYLE_PRESSURE_CAP, total * PLAYSTYLE_PRESSURE_SCALE);
    return 1 + gain * Math.max(0, Math.min(1, pressure));
}

// Spot-kick quality: `pen` is the shift in conversion, `taker` who steps up first.

// How reliable a side is from twelve yards, read off the men who would actually
// step up: one world-class taker lifts the whole shoot-out, a squad of nervous
// penalty-takers does not.
function playstylePenaltyEdge(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player && slot.pos !== 'GK');
    if (!slots.length) return 0;
    const takers = slots.filter(slot => playstyleEffects(slot.player).taker);
    if (!takers.length) return 0;
    // Only the first five kicks are properly taken by the chosen five, so a deep
    // bench of takers adds nothing on top of the best of them.
    const chosen = takers.slice(0, 5).map(slot => playstyleEffects(slot.player).pen);
    const best = Math.max(...chosen);
    return chosen.reduce((sum, pen) => sum + pen, 0) / Math.max(5, chosen.length) + best * 0.2;
}

// A stable tag for a name with no curated entry — which is how a generated ghost
// squad gets its habits. The roll follows the frequency each tag actually appears at
// in the drafted pool, so an AI club looks like a real club rather than a uniform
// spread, and the armbands are still held back for the players good enough to wear them.
const PLAYSTYLE_FREQUENCY = Object.freeze({
    Boreas: 136, Athena: 107, Loki: 104, Ymir: 65,
    Artemis: 57, Achilles: 55, Heracles: 54, Odin: 49,
    Thor: 49, Prometheus: 47, Heimdall: 42, Ares: 41,
    Apollo: 37, Perseus: 37, Talos: 36, Zeus: 34,
    Atlas: 23, Fenrir: 19, Hermes: 8
});

// A centre-half is a far likelier captain than a winger, so the global spread above
// is only the fallback: once the draft board exists, ghost tags are weighted by how
// often each habit actually lands on that position. Measured once and kept, because
// the board is the same 616 names for the life of the save.
let playstyleBoardWeights = null;
function playstyleBoardWeightsByPos() {
    if (playstyleBoardWeights) return playstyleBoardWeights;
    const byPos = {};
    const board = (typeof availablePlayers !== 'undefined' && Array.isArray(availablePlayers)) ? availablePlayers : [];
    board.forEach(player => {
        const key = player && player.playstyle;
        if (!key || !PLAYSTYLES[key] || !player.mainPos) return;
        const bucket = byPos[player.mainPos] = byPos[player.mainPos] || {};
        bucket[key] = (bucket[key] || 0) + 1;
    });
    playstyleBoardWeights = Object.keys(byPos).length ? byPos : null;
    return playstyleBoardWeights;
}

function playstyleTagWeight(pos, key) {
    const byPos = playstyleBoardWeightsByPos();
    const bucket = byPos && byPos[pos];
    // The bucket counts the men still on the board, so a habit the humans already
    // drafted away is not impossible for a ghost club — fall back to the league-wide
    // rate instead of zero, or an exhausted position collapses onto one identical tag.
    if (bucket) return bucket[key] || PLAYSTYLE_FREQUENCY[key] || 10;
    return PLAYSTYLE_FREQUENCY[key] || 10;
}

function playstyleForName(pos, name, band) {
    const legal = Object.keys(PLAYSTYLES).filter(key => {
        if (!PLAYSTYLES[key].positions.includes(pos)) return false;
        const floor = PLAYSTYLE_STRICT_BAND[key];
        return floor === undefined || (band || 0) >= floor;
    });
    if (!legal.length) return null;
    const weights = legal.map(key => playstyleTagWeight(pos, key));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!total) return legal[0];
    let roll = playstyleHash(String(name || '') + '|' + pos) % total;
    for (let i = 0; i < legal.length; i++) {
        roll -= weights[i];
        if (roll < 0) return legal[i];
    }
    return legal[legal.length - 1];
}

function playstyleHash(name) {
    let hash = 0;
    const label = String(name || '');
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return hash;
}

// Habits are read off the body: the quickest man in the squad gets the counter
// tag, the strongest gets the aerial one, the calmest technician gets the ball on
// the half-hour. A habit first has to be *possible* for the player — the gate,
// measured against the peers who play his position — which is what keeps Odin
// and Zeus on the shoulders of the players who would really wear them
// instead of spreading evenly over the whole pool.
// The three habits about standing in front of other men are held for the players
// rated highly enough to wear them, whether the tag comes from the draft board or
// from a generated ghost club.
const PLAYSTYLE_STRICT_BAND = Object.freeze({ 'Odin': 0.78, 'Apollo': 0.5, 'Zeus': 0.68 });

const PLAYSTYLE_GATES = Object.freeze({
    'Odin': (z, p, r) => r >= PLAYSTYLE_STRICT_BAND['Odin'],
    'Apollo': (z, p, r) => r >= PLAYSTYLE_STRICT_BAND['Apollo'],
    'Zeus': (z, p, r) => r >= PLAYSTYLE_STRICT_BAND['Zeus'],
    'Hermes': (z, p, r) => r <= 0.45 && z.PAC >= 0.3,
    'Achilles': z => z.SHO >= 0.4,
    'Athena': z => z.PAS >= 0.4,
    'Atlas': z => z.PHY >= 0.4,
    'Boreas': z => z.PAC >= 0.6 && z.PAC > z.DRI,
    'Ymir': z => z.PHY >= 0.4,
    'Artemis': z => z.SHO >= 0.4,
    'Loki': z => z.DRI >= 0.4,
    'Prometheus': z => z.PHY <= -0.2 && z.DRI >= 0,
    'Ares': z => z.DEF >= 0.3 && z.PHY >= 0.2,
    'Fenrir': z => z.PHY >= 0.3,
    'Thor': z => z.DEF >= 0.3,
    'Talos': z => z.PHY >= 0.3 && z.PAC >= 0.2,
    'Heracles': z => z.DEF >= 0.2 && z.PAC >= 0.2,
    'Perseus': z => z.PAS >= 0.2,
    'Heimdall': (z, p, r) => z.DEF >= 0.25,
});

// Every score weights one attribute against the others the same body could have
// spent, so it reads the shape of a player rather than his level: `d` is how far an
// attribute sits from this player's own average, and `b` — the rating band — is only
// spent by the habits about standing in front of other men.
const PLAYSTYLE_SCORES = Object.freeze({
    'Odin': (d, b) => 0.85 * d.DEF + 0.70 * d.PAS + 0.55 * d.PHY + 0.95 * b,
    'Apollo': (d, b) => 0.60 * d.DEF + 0.30 * d.PHY + 0.75 * b,
    'Heimdall': d => 0.90 * d.DEF - 0.50 * d.DRI + 0.15 * d.PHY,
    'Zeus': (d, b) => 0.85 * d.SHO + 0.45 * d.DRI + 0.90 * b,
    'Hermes': (d, b) => 1.05 * d.PAC + 0.40 * d.DRI + 0.30 * d.SHO - 0.55 * b,
    'Ares': d => 0.85 * d.DEF + 0.85 * d.PHY - 0.70 * d.DRI,
    'Fenrir': d => 0.75 * d.PHY + 0.50 * d.PAC - 0.60 * d.PAS - 0.60 * d.DEF,
    'Talos': d => 0.85 * d.PHY + 0.60 * d.PAC - 0.50 * d.DRI,
    'Prometheus': d => -0.85 * d.PHY - 0.50 * d.PAC + 0.70 * d.DRI,
    'Heracles': d => 0.55 * d.PAC + 0.50 * d.DEF + 0.40 * d.PHY - 0.40 * d.SHO,
    'Boreas': d => 1.10 * d.PAC - 0.60 * d.PHY - 0.40 * d.DEF,
    'Ymir': d => 1.00 * d.PHY + 0.50 * d.SHO - 0.60 * d.DRI - 0.40 * d.PAS,
    'Artemis': d => 1.00 * d.SHO + 0.50 * d.PHY - 0.60 * d.DRI - 0.50 * d.PAS,
    'Athena': d => 1.00 * d.PAS + 0.50 * d.SHO - 0.70 * d.PAC - 0.40 * d.PHY,
    'Achilles': (d, b) => 0.90 * d.SHO + 0.60 * d.PAS - 0.70 * d.DRI - 0.40 * d.PAC + 0.20 * b,
    'Atlas': d => 1.00 * d.PHY - 0.60 * d.DRI - 0.40 * d.PAS,
    'Loki': d => 1.00 * d.DRI + 0.40 * d.PAS - 0.70 * d.PHY - 0.40 * d.DEF,
    'Thor': d => 1.00 * d.DEF + 0.50 * d.PAC - 0.80 * d.PHY - 0.60 * d.PAS,
    'Perseus': d => 0.90 * d.PAS + 0.50 * d.DEF - 0.70 * d.PAC - 0.40 * d.PHY
});

// The role a player is already asked to play nudges the habit on top of it, which
// keeps the two panels of the scout strip telling one story.
const PLAYSTYLE_ARCHETYPE_PRIOR = Object.freeze({
    'Sweeper Keeper': { 'Odin': 0.5, 'Heimdall': 0.5 },
    'Goalkeeper': { 'Odin': 0.5, 'Talos': 0.5 },
    'Ball-Playing Defender': { 'Odin': 0.5, 'Athena': 0.6 },
    'No-Nonsense Defender': { 'Thor': 0.7, 'Ares': 0.6 },
    'Central Defender': { 'Talos': 0.6, 'Perseus': 0.4 },
    'Libero': { 'Odin': 0.5, 'Athena': 0.5, 'Perseus': 0.4 },
    'Wide Centre-Back': { 'Atlas': 0.5, 'Ymir': 0.5, 'Boreas': 0.3 },
    'Inverted Wing-Back': { 'Heracles': 0.6, 'Boreas': 0.5 },
    'Complete Wing-Back': { 'Boreas': 0.7, 'Athena': 0.5, 'Atlas': 0.5 },
    'Wing-Back': { 'Boreas': 0.7, 'Heracles': 0.5 },
    'No-Nonsense Full-Back': { 'Thor': 0.7, 'Ares': 0.5, 'Talos': 0.4 },
    'Deep-Lying Playmaker': { 'Athena': 0.8, 'Loki': 0.4 },
    'Box-to-Box Midfielder': { 'Heracles': 0.6, 'Artemis': 0.5 },
    'Ball-Winning Midfielder': { 'Ares': 0.7, 'Thor': 0.5 },
    'Roaming Playmaker': { 'Boreas': 0.6, 'Zeus': 0.4 },
    'Advanced Playmaker': { 'Athena': 0.7, 'Loki': 0.5 },
    'Mezzala': { 'Artemis': 0.5, 'Loki': 0.5, 'Heracles': 0.4 },
    'Carrilero': { 'Heracles': 0.7, 'Perseus': 0.4 },
    'Anchor Man': { 'Ares': 0.5, 'Perseus': 0.5, 'Talos': 0.4 },
    'Half-Back': { 'Odin': 0.4, 'Athena': 0.5, 'Perseus': 0.5 },
    'Trequartista': { 'Loki': 0.7, 'Athena': 0.5, 'Achilles': 0.3 },
    'Inside Forward': { 'Loki': 0.6, 'Artemis': 0.4 },
    'Classic Winger': { 'Boreas': 0.7, 'Hermes': 0.4 },
    'Inverted Winger': { 'Athena': 0.6, 'Loki': 0.5 },
    'Wide Target Man': { 'Ymir': 0.7, 'Atlas': 0.4 },
    'Target Forward': { 'Ymir': 0.7, 'Zeus': 0.4 },
    'Poacher': { 'Ymir': 0.5, 'Achilles': 0.5 },
    'False 9': { 'Loki': 0.8, 'Perseus': 0.4 },
    'Raumdeuter': { 'Zeus': 0.5, 'Ymir': 0.4 },
    'Complete Forward': { 'Zeus': 0.6, 'Achilles': 0.5 },
    'Advanced Forward': { 'Boreas': 0.6, 'Zeus': 0.5 },
    'Deep-Lying Forward': { 'Athena': 0.5, 'Loki': 0.5 },
    'Pressing Forward': { 'Heracles': 0.7, 'Fenrir': 0.3 },
    'Shadow Striker': { 'Zeus': 0.5, 'Boreas': 0.4 },
    'Wildcard': { 'Heracles': 0.4 }
});

// Mean and spread of every attribute inside each position list.
function playstylePeerBuckets(list) {
    const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const byPos = new Map();
    list.forEach(p => {
        if (!p || !p.mainPos) return;
        const bucket = byPos.get(p.mainPos) || { n: 0, sum: {}, sq: {} };
        keys.forEach(k => {
            const v = (p.stats && p.stats[k]) || 0;
            bucket.sum[k] = (bucket.sum[k] || 0) + v;
            bucket.sq[k] = (bucket.sq[k] || 0) + v * v;
        });
        bucket.n++;
        byPos.set(p.mainPos, bucket);
    });
    const buckets = new Map();
    byPos.forEach((bucket, pos) => {
        const mean = {}, sd = {};
        keys.forEach(k => {
            const m = bucket.sum[k] / bucket.n;
            const variance = Math.max(0, bucket.sq[k] / bucket.n - m * m);
            mean[k] = m;
            sd[k] = Math.max(1, Math.sqrt(variance));
        });
        buckets.set(pos, { keys, mean, sd });
    });
    return buckets;
}

function playstyleZScores(player, buckets) {
    const bucket = buckets && buckets.get(player.mainPos);
    const z = { PAC: 0, SHO: 0, PAS: 0, DRI: 0, DEF: 0, PHY: 0 };
    if (bucket) {
        bucket.keys.forEach(k => {
            z[k] = (((player.stats && player.stats[k]) || 0) - bucket.mean[k]) / bucket.sd[k];
        });
    }
    return z;
}

// 0 at 85, 1 at the top of the ladder — the band the leadership habits look at.
function playstyleRatingBand(player) {
    const rating = (player && player.rating) || 85;
    return Math.max(0, Math.min(1, (rating - 85) / 22));
}

function playstyleScoreFor(player, key, buckets) {
    const z = playstyleZScores(player, buckets);
    const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const own = keys.reduce((sum, k) => sum + z[k], 0) / keys.length;
    const d = {};
    keys.forEach(k => { d[k] = z[k] - own; });
    const prior = (PLAYSTYLE_ARCHETYPE_PRIOR[player.archetype] || {})[key] || 0;
    return PLAYSTYLE_SCORES[key](d, playstyleRatingBand(player)) + prior;
}

// The armband and the big-game nerve are about who a player is among other men, so
// they are never granted to someone whose season simply did not qualify. When no
// habit clears its gate the rest are read off his shape, but these three stay behind
// the rating band.
const PLAYSTYLE_STRICT = Object.freeze(['Odin', 'Apollo', 'Zeus']);

// The whole pool is scored in one pass, because "the quickest keeper" is only
// meaningful against the other keepers.
function bestPlaystyleFor(player, buckets) {
    const z = playstyleZScores(player, buckets);
    const band = playstyleRatingBand(player);
    const byPos = Object.keys(PLAYSTYLES).filter(key => PLAYSTYLES[key].positions.includes(player.mainPos));
    if (!byPos.length) return null;
    const clears = key => !PLAYSTYLE_GATES[key] || PLAYSTYLE_GATES[key](z, player, band);
    const possible = byPos.filter(clears);
    // A player who passes none of the gates is still tagged by shape rather than
    // drawn from a hat, so the panel never turns into noise.
    const candidates = possible.length ? possible
        : byPos.filter(key => !PLAYSTYLE_STRICT.includes(key) || clears(key));
    let best = null, bestScore = -Infinity;
    candidates.forEach(key => {
        // A sliver of name noise keeps two identical profiles at the same rank
        // from both landing on the same habit.
        const score = playstyleScoreFor(player, key, buckets) + (playstyleHash(player.name + key) % 1000) / 1000 * 0.08;
        if (score > bestScore) { bestScore = score; best = key; }
    });
    return best;
}

function assignPlaystyles(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const buckets = playstylePeerBuckets(list);
    list.forEach(player => {
        if (!player || player.playstyle) return;
        player.playstyle = bestPlaystyleFor(player, buckets);
    });
    return list;
}

// How hard control, counters and set pieces pull on the final goal rates.
const TACTICS_CONTROL_SCALE = 0.18;
const TACTICS_COUNTER_SCALE = 0.45;
const TACTICS_SET_PIECE_ATTACK_WEIGHT = 0.22;
const TACTICS_SET_PIECE_GOAL_SHARE = 0.16;

// Set-piece goals favour aerial defenders and front-post strikers rather than
// the usual open-play finishers.
const SET_PIECE_SCORER_ROLE = Object.freeze({
    CB: 2.4, ST: 1.9, CF: 1.5, CDM: 1.2,
    LB: 0.9, RB: 0.9, LWB: 0.8, RWB: 0.8,
    CAM: 0.8, CM: 0.7, LM: 0.6, RM: 0.6, LW: 0.7, RW: 0.7
});
const SET_PIECE_ASSIST_ROLE = Object.freeze({
    CAM: 2.4, LM: 2.0, RM: 2.0, CM: 1.8,
    LB: 1.6, RB: 1.6, LWB: 1.5, RWB: 1.5,
    LW: 1.4, RW: 1.4, CDM: 1.0, ST: 0.5, CF: 0.6, CB: 0.6
});

// Saves and older rooms may still hold { attackStyle, block, marking } or the
// even older { mentality, press }. Map those onto the new three-phase plan.
function normalizeTactics(tactics) {
    const source = tactics || {};
    const validPoss = TACTICS_POSSESSION[source.possession];
    const validDef = TACTICS_DEFENSE[source.defense];
    const validTrans = TACTICS_TRANSITION[source.transition];
    if (validPoss && validDef && validTrans) {
        return { possession: source.possession, defense: source.defense, transition: source.transition };
    }

    // Migrate from the previous attackStyle / block / marking shape.
    let possession = source.possession;
    if (!TACTICS_POSSESSION[possession]) {
        const legacyAttack = source.attackStyle
            || (source.mentality === 'attacking' ? 'overload' : source.mentality === 'defensive' ? 'direct' : null);
        const attackMap = {
            positional: 'positional', tiki: 'positional', overload: 'overload',
            direct: 'direct', inverted: 'central'
        };
        possession = attackMap[legacyAttack] || DEFAULT_TACTICS.possession;
    }

    let defense = source.defense;
    if (!TACTICS_DEFENSE[defense]) {
        const legacyBlock = source.block
            || (source.press === 'high' ? 'high' : source.press === 'low' ? 'low' : null);
        if (source.marking === 'man') defense = 'man';
        else if (source.marking === 'zonal' && (legacyBlock === 'mid' || !legacyBlock)) defense = 'zonal';
        else defense = TACTICS_DEFENSE[legacyBlock] ? legacyBlock : DEFAULT_TACTICS.defense;
    }

    let transition = source.transition;
    if (!TACTICS_TRANSITION[transition]) {
        if (source.block === 'high' || source.press === 'high') transition = 'gegenpress';
        else if (source.attackStyle === 'direct') transition = 'counter';
        else if (source.block === 'low' || source.press === 'low') transition = 'restDefense';
        else transition = DEFAULT_TACTICS.transition;
    }

    return {
        possession: TACTICS_POSSESSION[possession] ? possession : DEFAULT_TACTICS.possession,
        defense: TACTICS_DEFENSE[defense] ? defense : DEFAULT_TACTICS.defense,
        transition: TACTICS_TRANSITION[transition] ? transition : DEFAULT_TACTICS.transition
    };
}
const PEN_KICK_DELAY = 1100;
