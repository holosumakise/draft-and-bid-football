const INITIAL_BALANCE = 1000;
const MIN_BID = 10;
const STARTERS = 11;
const BENCH_SLOTS = 6;
const MAX_SQUAD_SIZE = STARTERS + BENCH_SLOTS;
const MAX_SUBS = 5;

// --- Chemistry ---
// Players sharing the same nation form a link in the starting XI.
// 2 linked players = +1 OVR each; 3+ linked players = +3 OVR each.
const CHEMISTRY = Object.freeze({
    WARM_MIN: 2,
    STRONG_MIN: 3,
    WARM_BONUS: 1,
    STRONG_BONUS: 3
});

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
const BUILD_ID = '2026-11-04.9';

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
