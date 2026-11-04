const INITIAL_BALANCE = 1000;
const MIN_BID = 10;
const STARTERS = 11;
const BENCH_SLOTS = 6;
const MAX_SQUAD_SIZE = STARTERS + BENCH_SLOTS;
const MAX_SUBS = 5;

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
const BUILD_ID = '2026-11-04.14';

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

// --- Playstyles ---
// Every player has one role identity, legal only for the positions of its group.
// A style does two things: it nudges the player's effective rating depending on
// how the role suits the match plan on both sides (fit), and it decides which
// kind of chance the player is asked to take (weights).
// `fit.own` / `fit.opp` are indexed by the three tactic phases, so a style that
// thrives against a low block only pays out when the opponent really parks it.
// Two authoring rules keep roles honest:
//   1. every phase is zero-sum — the `own` entries add to zero and the `opp`
//      entries add to zero, so a style is never a hidden stat boost;
//   2. the positive entries across a style stay under PLAYSTYLE_FIT_CLAMP, so a
//      matchup never saturates and no row of the table is wasted.
// The result is a pure trade-off: a role wins when the plan on either side of
// the pitch suits it and costs when it does not, against an average of zero.
const PLAYSTYLE_FIT_CLAMP = 3;
const PLAYSTYLES = Object.freeze({
    pitch_sentry: {
        name: 'The Pitch Sentry', group: 'GK',
        fit: { own: { defense: { high: 1.2, man: 0.4, low: -1.6 } },
               opp: { possession: { direct: 1.4, positional: -0.7, central: -0.7 } } }
    },
    citadel: {
        name: 'The Citadel', group: 'GK',
        fit: { own: { defense: { low: 1.2, zonal: 0.4, high: -1.0, man: -0.6 } },
               opp: { possession: { overload: 1.0, spatial: 0.4, positional: -0.7, direct: -0.7 } } }
    },
    deep_architect: {
        name: 'The Deep Architect', group: 'CB',
        fit: { own: { possession: { positional: 1.0, lavolpiana: 0.8, spatial: -0.6, central: -0.4, direct: -0.8 } },
               opp: { defense: { high: 0.9, man: 0.3, low: -1.2 } } },
        weights: { assist: 1.15 }
    },
    wrecker: {
        name: 'The Wrecker', group: 'CB',
        fit: { own: { defense: { man: 1.1, low: 0.7, high: -1.2, zonal: -0.6 } },
               opp: { possession: { direct: 0.9, positional: -0.5, central: -0.4 } } },
        weights: { score: 0.85, assist: 0.85, setPiece: 1.2, workload: { def: 1.25, key: 0.7 } }
    },
    phantom_pivot: {
        name: 'The Phantom Pivot', group: 'FB',
        fit: { own: { possession: { positional: 1.0, central: 0.8, direct: -1.1, overload: -0.7 } },
               opp: { transition: { gegenpress: 0.9, counter: -0.5, tacticalFoul: -0.4 } } },
        weights: { score: 0.85, assist: 1.2, workload: { def: 1.1, key: 1.1 } }
    },
    flank_railgun: {
        name: 'The Flank Railgun', group: 'FB',
        fit: { own: { possession: { overload: 1.2, direct: 0.4, central: -0.8, positional: -0.8 } },
               opp: { defense: { low: 1.0, man: -0.5, zonal: -0.5 } } },
        weights: { score: 1.05, assist: 1.35, setPiece: 1.1, workload: { def: 0.9, key: 1.3 } }
    },
    puppeteer: {
        name: 'The Puppeteer', group: 'MID',
        fit: { own: { possession: { positional: 0.9, lavolpiana: 0.9, direct: -1.1, spatial: -0.7 } },
               opp: { transition: { restAttack: 0.5, counter: 0.5, gegenpress: -1.0 } } },
        weights: { score: 0.85, assist: 1.35, setPiece: 1.1, workload: { def: 0.85, key: 1.35 } }
    },
    apex_engine: {
        name: 'The Apex Engine', group: 'MID',
        fit: { own: { defense: { high: 0.8, man: 0.4, low: -1.2 },
                      transition: { gegenpress: 0.9, restAttack: 0.3, restDefense: -0.7, balanced: -0.5 } },
               opp: { possession: { positional: 0.5, direct: -0.5 } } },
        weights: { score: 1.2, assist: 1.1, workload: { def: 1.15, key: 1.15 } }
    },
    reaper: {
        name: 'The Reaper', group: 'MID',
        fit: { own: { defense: { man: 1.1, high: 0.5, low: -0.9, zonal: -0.7 } },
               opp: { possession: { positional: 0.8, central: 0.6, lavolpiana: -0.7, direct: -0.7 } } },
        weights: { score: 0.7, assist: 0.85, workload: { def: 1.5, key: 0.8 } }
    },
    infiltrator: {
        name: 'The Infiltrator', group: 'MID',
        fit: { own: { possession: { spatial: 1.1, overload: 0.5, positional: 0.3, direct: -0.9, central: -0.5, lavolpiana: -0.5 } },
               opp: { defense: { zonal: 0.6, man: 0.3, low: -0.9 } } },
        weights: { score: 1.2, assist: 1.15, workload: { def: 0.95, key: 1.2 } }
    },
    codebreaker: {
        name: 'The Codebreaker', group: 'MID',
        fit: { own: { possession: { positional: 0.7, central: 0.5, direct: -1.2 } },
               opp: { defense: { low: 1.2, zonal: 0.5, man: -0.9, high: -0.8 } } },
        weights: { score: 1.1, assist: 1.45, setPiece: 1.2, workload: { def: 0.7, key: 1.5 } }
    },
    cutback_assassin: {
        name: 'The Cutback Assassin', group: 'WING',
        fit: { own: { possession: { central: 0.9, spatial: 0.8, direct: -1.7 } },
               opp: { defense: { low: 0.8, man: -0.4, zonal: -0.4 } } },
        weights: { score: 1.35, assist: 1.1, setPiece: 1.1, workload: { def: 0.85, key: 1.25 } }
    },
    touchline_demon: {
        name: 'The Touchline Demon', group: 'WING',
        fit: { own: { possession: { direct: 1.0, overload: 0.6, positional: -0.8, central: -0.8 } },
               opp: { defense: { high: 1.2, man: -0.8, zonal: -0.4 } } },
        weights: { score: 0.95, assist: 1.35, workload: { def: 0.9, key: 1.3 } }
    },
    shadow_maestro: {
        name: 'The Shadow Maestro', group: 'WING',
        fit: { own: { possession: { positional: 0.9, central: 0.8, overload: -0.6, direct: -1.1 } },
               opp: { defense: { high: 0.9, low: -0.9 } } },
        weights: { score: 1.05, assist: 1.3, setPiece: 1.15, workload: { def: 0.9, key: 1.4 } }
    },
    juggernaut: {
        name: 'The Juggernaut', group: 'FWD',
        fit: { own: { possession: { direct: 1.6, overload: 0.4, positional: -1.1, central: -0.9 } },
               opp: { defense: { high: 0.6, low: 0.4, man: -1.0 } } },
        weights: { score: 1.15, assist: 1.05, setPiece: 1.5, counter: 1.1, workload: { def: 0.8, key: 0.9 } }
    },
    box_assassin: {
        name: 'The Box Assassin', group: 'FWD',
        fit: { own: { possession: { direct: 0.8, overload: 0.5, positional: -0.8, central: -0.5 } },
               opp: { defense: { high: 1.2, man: 0.5, low: -1.7 } } },
        weights: { score: 1.55, assist: 0.6, setPiece: 1.25, workload: { def: 0.6, key: 0.6 } }
    },
    illusionist: {
        name: 'The Illusionist', group: 'FWD',
        fit: { own: { possession: { central: 1.2, positional: 0.7, direct: -1.2, spatial: -0.7 } },
               opp: { defense: { zonal: 0.6, high: 0.3, man: -0.9 } } },
        weights: { score: 1.05, assist: 1.25, workload: { def: 1.0, key: 1.2 } }
    },
    dimension_walker: {
        name: 'The Dimension Walker', group: 'FWD',
        fit: { own: { possession: { spatial: 0.9, overload: 0.6, positional: -0.8, direct: -0.7 } },
               opp: { defense: { zonal: 1.1, low: 0.3, man: -0.9, high: -0.5 } } },
        weights: { score: 1.4, assist: 0.7, setPiece: 1.15, workload: { def: 0.7, key: 0.8 } }
    },
    apex_predator: {
        name: 'The Apex Predator', group: 'FWD',
        // Small swings on purpose: this role is never badly placed rather than
        // great in any one spot, which is what makes it worth its rating.
        fit: { own: { possession: { positional: 0.4, spatial: 0.3, overload: 0.3, direct: -0.5, central: -0.5 } },
               opp: { defense: { high: 0.4, man: 0.3, low: -0.7 } } },
        weights: { score: 1.25, assist: 1.15, setPiece: 1.1, workload: { def: 0.9, key: 1.1 } }
    },
    wildcard: {
        name: 'The Tactical Wildcard', group: 'ANY',
        // The wildcard is bought with the out-of-position cap, not with raw fit.
        fit: { own: { possession: { positional: 0.4, central: 0.4, direct: -0.8 },
                      transition: { restDefense: 0.4, gegenpress: -0.4 } },
               opp: { defense: { man: 0.6, low: -0.6 } } },
        weights: { score: 0.95, assist: 1.05, workload: { def: 1.05, key: 1.05 } }
    }
});

// Which slots may carry which style. Group membership follows the same lines as
// POSITION_META, and the wildcard is the one style any outfield role can take.
const PLAYSTYLE_GROUPS = Object.freeze({
    GK: ['GK'],
    CB: ['CB'],
    FB: ['LB', 'RB', 'LWB', 'RWB'],
    MID: ['CDM', 'CM', 'CAM'],
    WING: ['LW', 'RW', 'LM', 'RM'],
    FWD: ['CF', 'ST'],
    ANY: ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'LM', 'RM', 'CF', 'ST']
});

function playstylePositions(key) {
    const style = PLAYSTYLES[key];
    return style ? PLAYSTYLE_GROUPS[style.group] || [] : [];
}

function playstyleOf(player) {
    const key = player && player.playstyle;
    if (!key || !PLAYSTYLES[key]) return null;
    const pos = player.mainPos;
    if (pos && !playstylePositions(key).includes(pos)) return null;
    return key;
}

// How much the role suits this player in this specific matchup, in rating points.
function playstyleFitDelta(player, ownTactics, oppTactics) {
    const key = playstyleOf(player);
    if (!key) return 0;
    const fit = PLAYSTYLES[key].fit || {};
    const own = ownTactics || DEFAULT_TACTICS;
    const opp = oppTactics || DEFAULT_TACTICS;
    let delta = 0;
    const phases = ['possession', 'defense', 'transition'];
    phases.forEach(phase => {
        if (fit.own && fit.own[phase]) delta += fit.own[phase][own[phase]] || 0;
        if (fit.opp && fit.opp[phase]) delta += fit.opp[phase][opp[phase]] || 0;
    });
    return Math.max(-PLAYSTYLE_FIT_CLAMP, Math.min(PLAYSTYLE_FIT_CLAMP, delta));
}

// Averaging those slot deltas over the XI is the part a manager actually controls:
// a team-sheet built around one plan gets rewarded with chances, a mismatched one
// pays for it. Every style is zero-sum, so the league average stays where the
// goals-per-match calibration put it and only the split between the two clubs moves.
const PLAYSTYLE_COHERENCE_SCALE = 0.04;

function playstyleCoherence(team, oppTactics) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const total = slots.reduce((sum, slot) => sum + playstyleFitDelta(slot.player, team.tactics, oppTactics), 0);
    return 1 + PLAYSTYLE_COHERENCE_SCALE * (total / slots.length);
}

// A stable style for a name with no curated entry, which is how ghost clubs get
// their roles: same name, same position, same style, on every machine.
function playstyleForName(pos, name) {
    const legal = Object.keys(PLAYSTYLES).filter(key =>
        PLAYSTYLE_GROUPS[PLAYSTYLES[key].group].includes(pos) && PLAYSTYLES[key].group !== 'ANY');
    if (!legal.length) return null;
    let hash = 0;
    const label = String(name || '');
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return legal[hash % legal.length];
}

function playstyleWeights(player) {
    const key = playstyleOf(player);
    const style = key ? PLAYSTYLES[key] : null;
    const w = (style && style.weights) || {};
    return {
        score: w.score ?? 1,
        assist: w.assist ?? 1,
        setPiece: w.setPiece ?? 1,
        counter: w.counter ?? 1,
        workload: w.workload || { def: 1, key: 1 }
    };
}

// ============================================================
// SPECIALITIES — the habits a scout writes next to the role.
//
// A playstyle answers "what job does this player do on the pitch", a speciality
// answers "what does he do when the ball is dead, the game is tight, or his legs
// go". The two are independent: a Box Assassin who is also a Penalty Specialist
// is a poacher you must not foul inside the box.
//
// Same authoring rules as PLAYSTYLES:
//   1. every `fit` phase is zero-sum, so a speciality is never a hidden stat boost;
//   2. the other fields are trade-offs, not free upgrades — the aggressive tags buy
//      actions with fouls and cards, the durable tags buy minutes with nothing else.
// ============================================================
const SPECIALITY_FIT_CLAMP = 2;
const SPECIALITY_LEAD_CAP = 1.5;
const SPECIALITY_LEAD_SCALE = 0.7;

const SP_ALL = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];
const SP_OUT = SP_ALL.filter(p => p !== 'GK');
const SP_DEF = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM'];
const SP_FB = ['LB', 'RB', 'LWB', 'RWB'];
const SP_MID = ['CDM', 'CM', 'CAM', 'LM', 'RM'];
const SP_ATT = ['CAM', 'LW', 'RW', 'CF', 'ST'];
const SP_WING = ['LW', 'RW', 'LM', 'RM'];
const SP_STRIKER = ['CF', 'ST'];

const SPECIALITIES = Object.freeze({
    // --- Dead-ball & tactical specialists ---
    captain: {
        name: 'Captain', group: 'Dead-Ball & Tactical Specialist', positions: SP_ALL,
        lead: 1, card: 0.9,
        fit: { own: { defense: { high: 0.4, man: 0.3, low: -0.7 } },
               opp: { transition: { gegenpress: 0.5, counter: -0.5 } } }
    },
    set_piece_specialist: {
        name: 'Set-Piece Specialist', group: 'Dead-Ball & Tactical Specialist',
        positions: ['CAM', 'CM', 'CDM', 'LM', 'RM'].concat(SP_WING, SP_FB, SP_STRIKER),
        setPiece: 1.45, delivery: 1.85, pen: 0.02, taker: true,
        fit: { own: { possession: { positional: 0.6, central: 0.4, direct: -1.0 } } }
    },
    penalty_specialist: {
        name: 'Penalty Specialist', group: 'Dead-Ball & Tactical Specialist', positions: SP_OUT,
        pen: 0.09, taker: true, setPiece: 1.1,
        fit: { own: { possession: { central: 0.5, direct: -0.5 } } }
    },
    long_throw_specialist: {
        name: 'Long-Throw Specialist', group: 'Dead-Ball & Tactical Specialist',
        positions: SP_FB.concat(['CB']),
        delivery: 1.6, aerial: 1.3, extraSetPieces: 0.03,
        fit: { own: { possession: { overload: 0.5, direct: 0.4, positional: -0.9 } } }
    },

    // --- Leadership & mental modifiers ---
    vice_captain: {
        name: 'Vice-Captain', group: 'Leadership & Mental Modifier', positions: SP_ALL,
        lead: 0.5, card: 0.95
    },
    vocal_organizer: {
        name: 'Vocal Organizer', group: 'Leadership & Mental Modifier', positions: SP_ALL,
        lead: 0.25, card: 0.8, fouls: 0.9,
        fit: { own: { defense: { zonal: 0.5, man: -0.5 } } }
    },
    big_game_player: {
        name: 'Big Game Player', group: 'Leadership & Mental Modifier', positions: SP_OUT,
        clutch: 1.35, card: 0.9,
        fit: { own: { defense: { high: 0.5, man: 0.3, low: -0.8 } },
               opp: { possession: { direct: 0.6, positional: -0.6 } } }
    },
    super_sub: {
        name: 'Super-Sub', group: 'Leadership & Mental Modifier',
        positions: SP_WING.concat(SP_STRIKER, ['CAM', 'CM']),
        sub: 1.5,
        fit: { own: { possession: { direct: 0.5, spatial: 0.4, positional: -0.9 } } }
    },
    enforcer: {
        name: 'Enforcer', group: 'Leadership & Mental Modifier', positions: SP_DEF,
        card: 1.45, fouls: 1.15, aerial: 1.25, workload: { def: 1.2, key: 0.9 },
        fit: { own: { defense: { man: 0.6, low: 0.4, high: -1.0 } } }
    },
    hot_head: {
        name: 'Hot-Head', group: 'Leadership & Mental Modifier', positions: SP_OUT,
        card: 1.7, fouls: 1.18, workload: { def: 1.1, key: 1 },
        fit: { own: { defense: { high: 0.5, man: 0.4, low: -0.9 },
                      transition: { gegenpress: 0.6, restDefense: -0.6 } } }
    },

    // --- Physical & durability tags ---
    iron_man: {
        name: 'Iron Man', group: 'Physical & Durability Tag', positions: SP_ALL,
        stamina: 0.72, injury: 0.55, workload: { def: 1.08, key: 1.05 }
    },
    injury_prone: {
        name: 'Injury Prone', group: 'Physical & Durability Tag', positions: SP_ALL,
        injury: 2.1, stamina: 1.25
    },
    workhorse: {
        name: 'Workhorse', group: 'Physical & Durability Tag', positions: SP_OUT,
        stamina: 0.85, workload: { def: 1.25, key: 1.15 },
        fit: { own: { defense: { high: 0.5, zonal: 0.3, low: -0.8 },
                      transition: { gegenpress: 0.4, balanced: -0.4 } } }
    },
    speedster: {
        name: 'Speedster', group: 'Physical & Durability Tag',
        positions: SP_FB.concat(SP_WING, SP_ATT),
        counter: 1.35,
        fit: { own: { possession: { direct: 0.7, overload: 0.4, positional: -1.1 } },
               opp: { defense: { high: 1.0, low: -1.0 } } }
    },
    aerial_threat: {
        name: 'Aerial Threat', group: 'Physical & Durability Tag',
        positions: ['CB', 'CDM', 'CM', 'LB', 'RB'].concat(SP_STRIKER),
        aerial: 1.7, setPiece: 1.2,
        fit: { own: { possession: { central: 0.4, spatial: -0.4 } },
               opp: { possession: { overload: 0.5, direct: 0.4, positional: -0.9 } } }
    },

    // --- Technical & behavioural tendencies ---
    distance_shooter: {
        name: 'Distance Shooter', group: 'Technical & Behavioural Tendency',
        positions: ['CM', 'CAM', 'CDM', 'LM', 'RM'].concat(SP_WING, SP_STRIKER),
        longShot: 1.6, score: 1.05,
        fit: { own: { possession: { central: 0.6, spatial: 0.4, positional: -1.0 } } }
    },
    trickster: {
        name: 'Flair / Trickster', group: 'Technical & Behavioural Tendency',
        positions: ['CAM', 'CM'].concat(SP_WING, SP_STRIKER),
        flair: 1.3, card: 0.9, fouls: 0.92,
        fit: { own: { possession: { spatial: 0.7, positional: 0.3, direct: -1.0 } },
               opp: { defense: { man: 0.6, zonal: -0.6 } } }
    },
    dives_into_tackles: {
        name: 'Dives Into Tackles', group: 'Technical & Behavioural Tendency',
        positions: SP_DEF.concat(['CM']),
        card: 1.5, fouls: 1.2, workload: { def: 1.18, key: 0.95 },
        fit: { own: { defense: { man: 0.7, high: 0.4, low: -1.1 } } }
    },
    stays_on_feet: {
        name: 'Stays on Feet', group: 'Technical & Behavioural Tendency', positions: SP_OUT,
        card: 0.7, fouls: 0.8,
        fit: { own: { defense: { zonal: 0.5, low: 0.3, man: -0.8 } } }
    }
});

// The four families the tags come from, in the order a scout reads them.
const SPECIALITY_GROUPS = Object.freeze({
    'Dead-Ball & Tactical Specialist': ['captain', 'set_piece_specialist', 'penalty_specialist', 'long_throw_specialist'],
    'Leadership & Mental Modifier': ['vice_captain', 'vocal_organizer', 'big_game_player', 'super_sub', 'enforcer', 'hot_head'],
    'Physical & Durability Tag': ['iron_man', 'injury_prone', 'workhorse', 'speedster', 'aerial_threat'],
    'Technical & Behavioural Tendency': ['distance_shooter', 'trickster', 'dives_into_tackles', 'stays_on_feet']
});

function specialityPositions(key) {
    const sp = SPECIALITIES[key];
    return sp ? sp.positions : [];
}

function specialityOf(player) {
    const key = player && player.speciality;
    if (!key || !SPECIALITIES[key]) return null;
    const pos = player.mainPos;
    if (pos && !specialityPositions(key).includes(pos)) return null;
    return key;
}

function specialityName(player) {
    const key = specialityOf(player);
    return key ? SPECIALITIES[key].name : '';
}

const SPECIALITY_DEFAULTS = Object.freeze({
    lead: 0, setPiece: 1, delivery: 1, aerial: 1, longShot: 1, counter: 1, flair: 1,
    sub: 1, clutch: 1, card: 1, fouls: 1, stamina: 1, injury: 1,
    extraSetPieces: 0, pen: 0, taker: false, workload: { def: 1, key: 1 }
});

function specialityEffects(player) {
    const key = specialityOf(player);
    const sp = key ? SPECIALITIES[key] : null;
    const out = {};
    Object.keys(SPECIALITY_DEFAULTS).forEach(field => {
        out[field] = sp && sp[field] !== undefined ? sp[field] : SPECIALITY_DEFAULTS[field];
    });
    out.workload = { ...(SPECIALITY_DEFAULTS.workload), ...((sp && sp.workload) || {}) };
    return out;
}

// Tactic fit, on the same zero-sum contract as a playstyle but capped a point
// tighter: a habit is a smaller part of a player than the job he is asked to do.
function specialityFitDelta(player, ownTactics, oppTactics) {
    const key = specialityOf(player);
    if (!key) return 0;
    const fit = SPECIALITIES[key].fit || {};
    const own = ownTactics || DEFAULT_TACTICS;
    const opp = oppTactics || DEFAULT_TACTICS;
    let delta = 0;
    ['possession', 'defense', 'transition'].forEach(phase => {
        if (fit.own && fit.own[phase]) delta += fit.own[phase][own[phase]] || 0;
        if (fit.opp && fit.opp[phase]) delta += fit.opp[phase][opp[phase]] || 0;
    });
    return Math.max(-SPECIALITY_FIT_CLAMP, Math.min(SPECIALITY_FIT_CLAMP, delta));
}

const SPECIALITY_COHERENCE_SCALE = 0.03;

function specialityCoherence(team, oppTactics) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const total = slots.reduce((sum, slot) => sum + specialityFitDelta(slot.player, team.tactics, oppTactics), 0);
    return 1 + SPECIALITY_COHERENCE_SCALE * (total / slots.length);
}

// One armband is worth a point of calm to everyone else on the pitch; the armband
// plus a vice-captain is worth a little more, and the band never stacks twice.
function leadershipRating(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    const lead = slots.reduce((sum, slot) => sum + specialityEffects(slot.player).lead, 0);
    return Math.min(SPECIALITY_LEAD_CAP, lead) * SPECIALITY_LEAD_SCALE;
}

// Dead-ball volume: long throws and tricks win more free kicks than a side that
// never leaves its feet, so the XI's habits move the share of goals from set pieces.
function specialitySetPieceBoost(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    return Math.min(0.05, slots.reduce((sum, slot) => sum + specialityEffects(slot.player).extraSetPieces, 0));
}

// How many free kicks this XI gives away, relative to a disciplined side.
function specialityFoulsGiven(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + specialityEffects(slot.player).fouls, 0) / slots.length;
    return Math.max(0.85, Math.min(1.15, avg));
}

// Habits that would move the league's overall rate if left raw — measured across the
// XIs a match week actually puts out (generated clubs plus the drafted one) and centred,
// so a tag is a difference between two clubs rather than a global inflation of cards and
// injuries. Each figure is the mean of the quantity its own consumer multiplies: the
// per-man booking and knock-off rolls land on 1.00, and the team frailty is centred on
// its own higher figure because it leans on the worst body in the XI by design.
const SPECIALITY_CARD_CENTRE = 1.04;
const SPECIALITY_INJURY_CENTRE = 1.03;
const SPECIALITY_INJURY_TEAM_CENTRE = 1.25;

// How badly this XI behaves when it does: the enforcer and the hot head turn
// challenges into bookings, the captain and the technician talk the referee down.
function specialityBookingRate(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + specialityEffects(slot.player).card, 0) / slots.length;
    return Math.max(0.85, Math.min(1.2, avg / SPECIALITY_CARD_CENTRE));
}

// How often this XI loses a man to a knock. One fragile body in eleven is enough to
// change a substitution, so the risk leans on the worst offender, not the mean.
function specialityInjuryRisk(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length) return 1;
    const avg = slots.reduce((sum, slot) => sum + specialityEffects(slot.player).injury, 0) / slots.length;
    const worst = slots.reduce((max, slot) => Math.max(max, specialityEffects(slot.player).injury), 1);
    return Math.max(0.6, Math.min(1.7, (avg * 0.5 + worst * 0.5) / SPECIALITY_INJURY_TEAM_CENTRE));
}

// One player's own injury appetite, on the same centre as the team figure.
function specialityInjuryRate(player) {
    return Math.max(0.5, specialityEffects(player).injury / SPECIALITY_INJURY_CENTRE);
}

// One player's own booking appetite, on the same centre as the team figure.
function specialityBookingRateFor(player) {
    return Math.max(0.6, specialityEffects(player).card / SPECIALITY_CARD_CENTRE);
}

function specialityWeights(player) {
    const sp = specialityEffects(player);
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

// A habit only pays when the match is actually on the line, so a squad of Big Game
// Players is worth a few percent in a knockout leg and nothing in a dead rubber.
const SPECIALITY_PRESSURE_SCALE = 0.06;
const SPECIALITY_PRESSURE_CAP = 0.06;

function specialityClutchBoost(team, pressure) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player);
    if (!slots.length || !pressure) return 1;
    const total = slots.reduce((sum, slot) => sum + (specialityEffects(slot.player).clutch - 1), 0);
    const gain = Math.min(SPECIALITY_PRESSURE_CAP, total * SPECIALITY_PRESSURE_SCALE);
    return 1 + gain * Math.max(0, Math.min(1, pressure));
}

// Spot-kick quality: `pen` is the shift in conversion, `taker` who steps up first.

// How reliable a side is from twelve yards, read off the men who would actually
// step up: one world-class taker lifts the whole shoot-out, a squad of nervous
// penalty-takers does not.
function specialityPenaltyEdge(team) {
    const slots = ((team && team.lineup) || []).filter(slot => slot && slot.player && slot.pos !== 'GK');
    if (!slots.length) return 0;
    const takers = slots.filter(slot => specialityEffects(slot.player).taker);
    if (!takers.length) return 0;
    // Only the first five kicks are properly taken by the chosen five, so a deep
    // bench of takers adds nothing on top of the best of them.
    const chosen = takers.slice(0, 5).map(slot => specialityEffects(slot.player).pen);
    const best = Math.max(...chosen);
    return chosen.reduce((sum, pen) => sum + pen, 0) / Math.max(5, chosen.length) + best * 0.2;
}

// A stable tag for a name with no curated entry — which is how a generated ghost
// squad gets its habits. The roll follows the frequency each tag actually appears at
// in the drafted pool, so an AI club looks like a real club rather than a uniform
// spread, and the armbands are still held back for the players good enough to wear them.
const SPECIALITY_FREQUENCY = Object.freeze({
    speedster: 136, set_piece_specialist: 107, trickster: 104, aerial_threat: 65,
    distance_shooter: 57, penalty_specialist: 55, workhorse: 54, captain: 49,
    dives_into_tackles: 49, injury_prone: 47, vocal_organizer: 42, enforcer: 41,
    vice_captain: 37, stays_on_feet: 37, iron_man: 36, big_game_player: 34,
    long_throw_specialist: 23, hot_head: 19, super_sub: 8
});

// A centre-half is a far likelier captain than a winger, so the global spread above
// is only the fallback: once the draft board exists, ghost tags are weighted by how
// often each habit actually lands on that position. Measured once and kept, because
// the board is the same 616 names for the life of the save.
let specialityBoardWeights = null;
function specialityBoardWeightsByPos() {
    if (specialityBoardWeights) return specialityBoardWeights;
    const byPos = {};
    const board = (typeof availablePlayers !== 'undefined' && Array.isArray(availablePlayers)) ? availablePlayers : [];
    board.forEach(player => {
        const key = player && player.speciality;
        if (!key || !SPECIALITIES[key] || !player.mainPos) return;
        const bucket = byPos[player.mainPos] = byPos[player.mainPos] || {};
        bucket[key] = (bucket[key] || 0) + 1;
    });
    specialityBoardWeights = Object.keys(byPos).length ? byPos : null;
    return specialityBoardWeights;
}

function specialityTagWeight(pos, key) {
    const byPos = specialityBoardWeightsByPos();
    const bucket = byPos && byPos[pos];
    if (bucket) return bucket[key] || 0;
    return SPECIALITY_FREQUENCY[key] || 10;
}

function specialityForName(pos, name, band) {
    const legal = Object.keys(SPECIALITIES).filter(key => {
        if (!SPECIALITIES[key].positions.includes(pos)) return false;
        const floor = SPECIALITY_STRICT_BAND[key];
        return floor === undefined || (band || 0) >= floor;
    });
    if (!legal.length) return null;
    const weights = legal.map(key => specialityTagWeight(pos, key));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (!total) return legal[0];
    let roll = specialityHash(String(name || '') + '|' + pos) % total;
    for (let i = 0; i < legal.length; i++) {
        roll -= weights[i];
        if (roll < 0) return legal[i];
    }
    return legal[legal.length - 1];
}

function specialityHash(name) {
    let hash = 0;
    const label = String(name || '');
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return hash;
}

// Habits are read off the body: the quickest man in the squad gets the counter
// tag, the strongest gets the aerial one, the calmest technician gets the ball on
// the half-hour. A habit first has to be *possible* for the player — the gate,
// measured against the peers who play his position — which is what keeps Captain
// and Big Game Player on the shoulders of the players who would really wear them
// instead of spreading evenly over the whole pool.
// The three habits about standing in front of other men are held for the players
// rated highly enough to wear them, whether the tag comes from the draft board or
// from a generated ghost club.
const SPECIALITY_STRICT_BAND = Object.freeze({ captain: 0.78, vice_captain: 0.5, big_game_player: 0.68 });

const SPECIALITY_GATES = Object.freeze({
    captain: (z, p, r) => r >= SPECIALITY_STRICT_BAND.captain,
    vice_captain: (z, p, r) => r >= SPECIALITY_STRICT_BAND.vice_captain,
    big_game_player: (z, p, r) => r >= SPECIALITY_STRICT_BAND.big_game_player,
    super_sub: (z, p, r) => r <= 0.45 && z.PAC >= 0.3,
    penalty_specialist: z => z.SHO >= 0.4,
    set_piece_specialist: z => z.PAS >= 0.4,
    long_throw_specialist: z => z.PHY >= 0.4,
    speedster: z => z.PAC >= 0.6 && z.PAC > z.DRI,
    aerial_threat: z => z.PHY >= 0.4,
    distance_shooter: z => z.SHO >= 0.4,
    trickster: z => z.DRI >= 0.4,
    injury_prone: z => z.PHY <= -0.2 && z.DRI >= 0,
    enforcer: z => z.DEF >= 0.3 && z.PHY >= 0.2,
    hot_head: z => z.PHY >= 0.3,
    dives_into_tackles: z => z.DEF >= 0.3,
    iron_man: z => z.PHY >= 0.3 && z.PAC >= 0.2,
    workhorse: z => z.DEF >= 0.2 && z.PAC >= 0.2,
    stays_on_feet: z => z.PAS >= 0.2,
    vocal_organizer: (z, p, r) => z.DEF >= 0.25,
});

// Every score weights one attribute against the others the same body could have
// spent, so it reads the shape of a player rather than his level: `d` is how far an
// attribute sits from this player's own average, and `b` — the rating band — is only
// spent by the habits about standing in front of other men.
const SPECIALITY_SCORES = Object.freeze({
    captain: (d, b) => 0.85 * d.DEF + 0.70 * d.PAS + 0.55 * d.PHY + 0.95 * b,
    vice_captain: (d, b) => 0.60 * d.DEF + 0.30 * d.PHY + 0.75 * b,
    vocal_organizer: d => 0.90 * d.DEF - 0.50 * d.DRI + 0.15 * d.PHY,
    big_game_player: (d, b) => 0.85 * d.SHO + 0.45 * d.DRI + 0.90 * b,
    super_sub: (d, b) => 1.05 * d.PAC + 0.40 * d.DRI + 0.30 * d.SHO - 0.55 * b,
    enforcer: d => 0.85 * d.DEF + 0.85 * d.PHY - 0.70 * d.DRI,
    hot_head: d => 0.75 * d.PHY + 0.50 * d.PAC - 0.60 * d.PAS - 0.60 * d.DEF,
    iron_man: d => 0.85 * d.PHY + 0.60 * d.PAC - 0.50 * d.DRI,
    injury_prone: d => -0.85 * d.PHY - 0.50 * d.PAC + 0.70 * d.DRI,
    workhorse: d => 0.55 * d.PAC + 0.50 * d.DEF + 0.40 * d.PHY - 0.40 * d.SHO,
    speedster: d => 1.10 * d.PAC - 0.60 * d.PHY - 0.40 * d.DEF,
    aerial_threat: d => 1.00 * d.PHY + 0.50 * d.SHO - 0.60 * d.DRI - 0.40 * d.PAS,
    distance_shooter: d => 1.00 * d.SHO + 0.50 * d.PHY - 0.60 * d.DRI - 0.50 * d.PAS,
    set_piece_specialist: d => 1.00 * d.PAS + 0.50 * d.SHO - 0.70 * d.PAC - 0.40 * d.PHY,
    penalty_specialist: (d, b) => 0.90 * d.SHO + 0.60 * d.PAS - 0.70 * d.DRI - 0.40 * d.PAC + 0.20 * b,
    long_throw_specialist: d => 1.00 * d.PHY - 0.60 * d.DRI - 0.40 * d.PAS,
    trickster: d => 1.00 * d.DRI + 0.40 * d.PAS - 0.70 * d.PHY - 0.40 * d.DEF,
    dives_into_tackles: d => 1.00 * d.DEF + 0.50 * d.PAC - 0.80 * d.PHY - 0.60 * d.PAS,
    stays_on_feet: d => 0.90 * d.PAS + 0.50 * d.DEF - 0.70 * d.PAC - 0.40 * d.PHY
});

// The role a player is already asked to play nudges the habit on top of it, which
// keeps the two panels of the scout strip telling one story.
const SPECIALITY_PLAYSTYLE_PRIOR = Object.freeze({
    pitch_sentry: { captain: 0.5, vocal_organizer: 0.5 },
    citadel: { captain: 0.5, iron_man: 0.5 },
    deep_architect: { captain: 0.5, set_piece_specialist: 0.6 },
    wrecker: { dives_into_tackles: 0.7, enforcer: 0.6 },
    phantom_pivot: { workhorse: 0.6, speedster: 0.5 },
    flank_railgun: { speedster: 0.7, set_piece_specialist: 0.5, long_throw_specialist: 0.5 },
    puppeteer: { set_piece_specialist: 0.8, trickster: 0.4 },
    apex_engine: { workhorse: 0.6, distance_shooter: 0.5 },
    reaper: { enforcer: 0.7, dives_into_tackles: 0.5 },
    infiltrator: { speedster: 0.6, big_game_player: 0.4 },
    codebreaker: { set_piece_specialist: 0.7, trickster: 0.5 },
    cutback_assassin: { trickster: 0.6, distance_shooter: 0.4 },
    touchline_demon: { speedster: 0.7, super_sub: 0.4 },
    shadow_maestro: { set_piece_specialist: 0.6, trickster: 0.5 },
    juggernaut: { aerial_threat: 0.7, big_game_player: 0.4 },
    box_assassin: { aerial_threat: 0.5, penalty_specialist: 0.5 },
    illusionist: { trickster: 0.8, stays_on_feet: 0.4 },
    dimension_walker: { big_game_player: 0.5, aerial_threat: 0.4 },
    apex_predator: { big_game_player: 0.6, penalty_specialist: 0.5 },
    wildcard: { workhorse: 0.4 }
});

// Mean and spread of every attribute inside each position list.
function specialityPeerBuckets(list) {
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

function specialityZScores(player, buckets) {
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
function specialityRatingBand(player) {
    const rating = (player && player.rating) || 85;
    return Math.max(0, Math.min(1, (rating - 85) / 22));
}

function specialityScoreFor(player, key, buckets) {
    const z = specialityZScores(player, buckets);
    const keys = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];
    const own = keys.reduce((sum, k) => sum + z[k], 0) / keys.length;
    const d = {};
    keys.forEach(k => { d[k] = z[k] - own; });
    const prior = (SPECIALITY_PLAYSTYLE_PRIOR[player.playstyle] || {})[key] || 0;
    return SPECIALITY_SCORES[key](d, specialityRatingBand(player)) + prior;
}

// The armband and the big-game nerve are about who a player is among other men, so
// they are never granted to someone whose season simply did not qualify. When no
// habit clears its gate the rest are read off his shape, but these three stay behind
// the rating band.
const SPECIALITY_STRICT = Object.freeze(['captain', 'vice_captain', 'big_game_player']);

// The whole pool is scored in one pass, because "the quickest keeper" is only
// meaningful against the other keepers.
function bestSpecialityFor(player, buckets) {
    const z = specialityZScores(player, buckets);
    const band = specialityRatingBand(player);
    const byPos = Object.keys(SPECIALITIES).filter(key => SPECIALITIES[key].positions.includes(player.mainPos));
    if (!byPos.length) return null;
    const clears = key => !SPECIALITY_GATES[key] || SPECIALITY_GATES[key](z, player, band);
    const possible = byPos.filter(clears);
    // A player who passes none of the gates is still tagged by shape rather than
    // drawn from a hat, so the panel never turns into noise.
    const candidates = possible.length ? possible
        : byPos.filter(key => !SPECIALITY_STRICT.includes(key) || clears(key));
    let best = null, bestScore = -Infinity;
    candidates.forEach(key => {
        // A sliver of name noise keeps two identical profiles at the same rank
        // from both landing on the same habit.
        const score = specialityScoreFor(player, key, buckets) + (specialityHash(player.name + key) % 1000) / 1000 * 0.08;
        if (score > bestScore) { bestScore = score; best = key; }
    });
    return best;
}

function assignSpecialities(list) {
    if (!Array.isArray(list) || !list.length) return list;
    const buckets = specialityPeerBuckets(list);
    list.forEach(player => {
        if (!player || player.speciality) return;
        player.speciality = bestSpecialityFor(player, buckets);
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
