// ============================================================
// MY PLAYER — account-based career: randomizer, dashboard, schedule,
// live matches, training, rest, assets and the branching origin story.
//
// The account gate lives in account.js; every career is stored at
// users/{uid}/myPlayers/{careerId} and is only readable by that account.
// ============================================================

const MP = {
    open: false,
    view: null,
    careers: [],
    active: null,
    draft: null,
    rollBusy: false,
    createBusy: false,
    storyBusy: false,
    screenBusy: false,
    reelToken: 0,
    reelTimers: [],
    selectedFixture: null,
    calendarMonth: null,
    liveFixtureId: null,
    liveStarts: false,
    livePlayerId: null,
    liveClubSide: 1,
    cut: { beats: [], index: 0, phase: 'idle', path: null, timer: null }
};

// ------------------------------------------------------------
// Balance knobs
// ------------------------------------------------------------

const MP_START_OVR = 67;
const MP_MATCHDAY_GAP = 4;
const MP_FIRST_MATCHDAY = 3;
const MP_TRAIN_COOLDOWN_MS = 10 * 60 * 1000;
const MP_REST_COOLDOWN_MS = 8 * 60 * 1000;
const MP_REST_STAMINA = 34;
const MP_ATTR_KEYS = ['PAC', 'SHO', 'PAS', 'DRI', 'DEF', 'PHY'];

// ------------------------------------------------------------
// Pools used by the randomizer
// ------------------------------------------------------------

const MP_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

const MP_CITIES = [
    'Riverside', 'Northgate', 'Harbour City', 'Eastbrook', 'Stonebridge',
    'Meadow Park', 'Kingsway', 'Westport', 'Oakfield', 'Redhill',
    'Lakeside', 'Fairview', 'Southbank', 'Highbridge', 'Greenfield',
    'Ashford', 'Brookhaven', 'Cedar Falls', 'Dunmore', 'Elmwood'
];

const MP_C_LEAGUE_CLUBS = [
    'Riverside Athletic', 'Northgate FC', 'Harbour City', 'Ironworks United',
    'Eastbrook FC', 'Stonebridge Rangers', 'Meadow Park FC', 'Kingsway Athletic',
    'Westport Wanderers', 'Oakfield Town'
];

const MP_B_LEAGUE_CLUBS = [
    'Metro City FC', 'Union Rovers', 'Crown Athletic', 'Atlas FC',
    'Vanguard United', 'Summit City', 'Royal Park FC', 'Meridian Athletic'
];

const MP_COUNTRIES = [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
    'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas',
    'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
    'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
    'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon',
    'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
    'Comoros', 'Congo', 'DR Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
    'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
    'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
    'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia',
    'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
    'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary',
    'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
    'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati',
    'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho',
    'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
    'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
    'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco',
    'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia',
    'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger',
    'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan',
    'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
    'Philippines', 'Poland', 'Portugal', 'Puerto Rico', 'Qatar', 'Romania',
    'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
    'Sao Tome and Principe', 'Saudi Arabia', 'Scotland', 'Senegal', 'Serbia',
    'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia',
    'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan',
    'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
    'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
    'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
    'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
    'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
    'Wales', 'Yemen', 'Zambia', 'Zimbabwe', 'England', 'Northern Ireland'
];

const MP_TRAINING = [
    { id: 'sprint', name: 'Sprint Drills', attr: 'PAC', desc: 'Explosive accelerations and top-speed work.' },
    { id: 'finishing', name: 'Finishing Session', attr: 'SHO', desc: 'Striking technique, composure and shot power.' },
    { id: 'passing', name: 'Passing Patterns', attr: 'PAS', desc: 'Vision, weight of pass and long distribution.' },
    { id: 'dribbling', name: 'Close Control', attr: 'DRI', desc: 'Tight touches, turns and carrying the ball.' },
    { id: 'defending', name: 'Defensive Unit', attr: 'DEF', desc: 'Timing, positioning and duels.' },
    { id: 'gym', name: 'Strength & Power', attr: 'PHY', desc: 'Strength, stamina and aerial presence.' }
];

const MP_ASSETS = [
    { id: 'dinner', name: 'Family Dinner', cost: 250, mental: 10, stamina: 0, shield: 0.02, desc: 'A proper meal at home. Small reset, big comfort.' },
    { id: 'gym', name: 'Home Gym', cost: 800, mental: 4, stamina: 18, shield: 0.01, desc: 'Train away from the club and recover on your own schedule.' },
    { id: 'therapist', name: 'Sports Psychologist', cost: 1500, mental: 30, stamina: 0, shield: 0.08, perMatch: 0.5, desc: 'Weekly sessions that keep pressure from turning into a slump.' },
    { id: 'retreat', name: 'Weekend Retreat', cost: 2600, mental: 45, stamina: 10, shield: 0.05, desc: 'Two quiet days away from football and everyone who talks about it.' },
    { id: 'network', name: 'Support Network', cost: 4000, mental: 60, stamina: 0, shield: 0.12, perMatch: 1, desc: 'Family, friends and a manager who actually listens. A permanent safety net.' }
];

// Which starting slot each MP position takes in the 4-3-3-ish shape below.
const MP_SLOT_FOR_POS = {
    GK: 0, LB: 1, LWB: 1, CB: 2, RB: 4, RWB: 4,
    CDM: 6, CM: 5, CAM: 7, LM: 8, RM: 10,
    LW: 8, RW: 10, CF: 9, ST: 9
};

const MP_TEAM_SHAPE = ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW'];

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

function mpPick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function mpPickDifferent(list, exclude) {
    const blocked = new Set(exclude || []);
    const pool = list.filter(item => !blocked.has(item));
    return mpPick(pool.length ? pool : list);
}

function mpRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function mpClamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function mpEsc(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function mpEscAttr(value) {
    return mpEsc(value).replace(/`/g, '&#96;');
}

function mpJsArg(value) {
    return mpEsc(JSON.stringify(String(value == null ? '' : value)));
}

function mpHeight(cm) {
    const value = Number(cm);
    return Number.isFinite(value) ? `${(value / 100).toFixed(2)} m` : '—';
}

function mpPosLabel(pos) {
    return String(pos || '—').toUpperCase();
}

function mpMoney(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    return `$${n.toLocaleString()}`;
}

function mpRelativeTime(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return 'just now';
    const diff = Math.max(0, Date.now() - value);
    if (diff < 60 * 1000) return 'just now';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

function mpCooldownText(until) {
    const remaining = Number(until) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return '';
    const minutes = Math.ceil(remaining / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

function mpAvg(values) {
    const list = (values || []).filter(v => Number.isFinite(Number(v)));
    if (!list.length) return null;
    return list.reduce((sum, v) => sum + Number(v), 0) / list.length;
}

function mpOverallRating(career) {
    const stats = career && career.careerStats;
    if (!stats || !stats.ratingCount) return null;
    return stats.ratingSum / stats.ratingCount;
}

function mpNextFixture(career) {
    const fixtures = (career.schedule && career.schedule.fixtures) || [];
    return fixtures.find(fixture => !fixture.played) || null;
}

function mpFixtureDate(career, fixture) {
    const start = Number(career.startDate) || Date.now();
    return new Date(start + Number(fixture.day || 0) * 86400000);
}

function mpDateLabel(date) {
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function mpMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Zero-padded keys compare correctly as plain strings.
function mpCalendarFloorKey(career) {
    return mpMonthKey(new Date(Number(career.startDate) || Number(career.createdAt) || Date.now()));
}

// ------------------------------------------------------------
// Cloud data
// ------------------------------------------------------------

function mpRequireAccount() {
    if (typeof Account === 'undefined' || !Account.user) {
        if (typeof accountShowGate === 'function') accountShowGate();
        return false;
    }
    return true;
}

// A career is plain JSON. Fill in fields added after a career was created so an
// older or partially written record can never crash the dashboard or story.
function mpEnsureCareerShape(career) {
    if (!career) return career;

    career.story = career.story || { path: 'intro', step: 0 };
    if (!MP_STORY[career.story.path]) career.story.path = 'intro';
    if (!Number.isFinite(Number(career.story.step))) career.story.step = 0;
    career.story.clubs = career.story.clubs || {};
    if (!career.story.clubs.cLeague) career.story.clubs.cLeague = mpPick(MP_C_LEAGUE_CLUBS);
    if (!career.story.clubs.bLeague) career.story.clubs.bLeague = mpPick(MP_B_LEAGUE_CLUBS);
    if (!career.story.clubs.loan) {
        career.story.clubs.loan = mpPickDifferent(MP_C_LEAGUE_CLUBS, [career.story.clubs.cLeague]);
    }

    career.position = career.position || 'CM';
    career.age = Number(career.age) || 18;
    career.name = career.name || 'My Player';
    career.nationality = career.nationality || 'England';
    career.hometown = career.hometown || mpPick(MP_CITIES);
    career.archetype = career.archetype || 'Deep-Lying Forward';
    career.playstyle = career.playstyle || 'Athena';
    career.heightCm = Number(career.heightCm) || 180;
    career.weightKg = Number(career.weightKg) || 74;
    career.createdAt = Number(career.createdAt) || Date.now();
    career.updatedAt = Number(career.updatedAt) || career.createdAt;
    career.startDate = Number(career.startDate) || career.createdAt;

    // Attribute ratings are stored separately from career record stats.
    if (!career.attrs || typeof career.attrs !== 'object') {
        const target = mpClamp(Number(career.ovr) || MP_START_OVR, 40, 99);
        career.attrs = mpBuildStartingAttrs(career.position, career.archetype, career.playstyle, target);
    }
    MP_ATTR_KEYS.forEach(key => {
        const value = Number(career.attrs[key]);
        career.attrs[key] = Number.isFinite(value) ? mpClamp(Math.round(value), 1, 99) : 60;
    });
    career.ovr = calculateOVRFromStats(career.attrs, career.position);

    const legacy = career.stats || {};
    career.careerStats = career.careerStats || {
        matches: Number(legacy.matches) || 0,
        goals: Number(legacy.goals) || 0,
        assists: Number(legacy.assists) || 0,
        ratingSum: 0,
        ratingCount: 0
    };
    career.careerStats.matches = Number(career.careerStats.matches) || 0;
    career.careerStats.goals = Number(career.careerStats.goals) || 0;
    career.careerStats.assists = Number(career.careerStats.assists) || 0;
    career.careerStats.ratingSum = Number(career.careerStats.ratingSum) || 0;
    career.careerStats.ratingCount = Number(career.careerStats.ratingCount) || 0;

    career.club = career.club || {};
    career.club.name = career.club.name || career.story.clubs.cLeague;
    career.club.league = career.club.league || 'C League';
    career.club.salary = Number(career.club.salary) || 1450;

    career.money = Number(career.money) || 0;
    career.health = career.health || {};
    career.health.stamina = mpClamp(Number(career.health.stamina) || 100, 0, 100);
    career.health.mental = mpClamp(Number(career.health.mental) || 100, 0, 100);
    career.injury = Math.max(0, Number(career.injury) || 0);
    career.suspension = Math.max(0, Number(career.suspension) || 0);
    career.form = Array.isArray(career.form) ? career.form.filter(v => Number.isFinite(Number(v))).slice(-8) : [];
    career.trainingCooldowns = career.trainingCooldowns || {};
    career.restReadyAt = Number(career.restReadyAt) || 0;
    career.assets = Array.isArray(career.assets) ? career.assets : [];
    career.schedule = career.schedule || { fixtures: [] };
    career.schedule.fixtures = Array.isArray(career.schedule.fixtures) ? career.schedule.fixtures : [];
    mpEnsureSchedule(career);
    return career;
}

async function mpLoadCareers() {
    if (!mpRequireAccount()) throw new Error('Sign in required.');
    const snapshot = await Account.db.ref(`users/${Account.user.uid}/myPlayers`).once('value');
    const raw = snapshot.val() || {};
    MP.careers = Object.keys(raw).map(key => {
        const career = raw[key] || {};
        return mpEnsureCareerShape({ ...career, id: career.id || key });
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    Account.loadedCareers = MP.careers.length;
}

async function mpSaveCareer(career) {
    if (!mpRequireAccount()) throw new Error('Sign in required to save.');
    career.updatedAt = Date.now();
    const payload = JSON.parse(JSON.stringify(career));
    await Account.db.ref(`users/${Account.user.uid}/myPlayers/${career.id}`).set(payload);

    const index = MP.careers.findIndex(item => item.id === career.id);
    if (index >= 0) MP.careers[index] = career;
    else MP.careers.unshift(career);
    MP.careers.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    Account.loadedCareers = MP.careers.length;
}

async function mpAutosaveNow() {
    if (!MP.active) return;
    mpSetSaveState('saving');
    try {
        await mpSaveCareer(MP.active);
        mpSetSaveState('saved');
    } catch (error) {
        mpSetSaveState('error');
        if (typeof showToast === 'function') showToast(`Autosave failed: ${accountFriendlyError(error)}`, 5200);
    }
}

function mpSetSaveState(state) {
    const labels = { saved: 'Saved', saving: 'Saving…', error: 'Save failed' };
    const cls = `mp-save${state === 'saved' ? ' is-saved' : state === 'saving' ? ' is-saving' : state === 'error' ? ' is-error' : ''}`;
    ['mp-save-state', 'mp-dash-save'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = cls;
        el.innerHTML = `<span class="mp-save__dot"></span>${labels[state] || 'Cloud save'}`;
    });
}

async function mpDeleteCareer(id) {
    if (!mpRequireAccount()) return;
    const career = MP.careers.find(item => item.id === id);
    if (!career) return;
    const label = career.name || 'this career';
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    try {
        await Account.db.ref(`users/${Account.user.uid}/myPlayers/${id}`).remove();
        MP.careers = MP.careers.filter(item => item.id !== id);
        if (MP.active && MP.active.id === id) MP.active = null;
        Account.loadedCareers = MP.careers.length;
        mpRenderList();
        if (typeof showToast === 'function') showToast('My Player deleted.');
    } catch (error) {
        if (typeof showToast === 'function') showToast(`Delete failed: ${accountFriendlyError(error)}`, 5200);
    }
}

// ------------------------------------------------------------
// Entry / navigation
// ------------------------------------------------------------

function openMyPlayer() {
    if (!mpRequireAccount()) return;
    MP.open = true;
    MP.active = null;
    mpShowList();
}

function mpClose() {
    mpCutStop();
    MP.open = false;
    MP.view = null;
    MP.active = null;
    showScreen('screen-main');
    if (typeof accountRenderHud === 'function') accountRenderHud();
}

async function mpShowList() {
    if (!mpRequireAccount()) return;
    MP.open = true;
    MP.view = 'list';
    MP.active = null;
    MP.selectedFixture = null;
    MP.calendarMonth = null;

    mpSetListStatus('Loading your careers…');
    mpRenderList();
    showScreen('screen-myplayer-list');
    accountRenderHud();

    try {
        await mpLoadCareers();
        mpSetListStatus('');
    } catch (error) {
        MP.careers = [];
        mpSetListStatus(accountFriendlyError(error), true);
    }
    mpRenderList();
    accountRenderHud();
}

function mpBackToList() {
    if (!mpRequireAccount()) return;
    mpCutStop();
    MP.active = null;
    MP.view = 'list';
    MP.selectedFixture = null;
    MP.calendarMonth = null;
    mpRenderList();
    showScreen('screen-myplayer-list');
    mpSetListStatus('');
    accountRenderHud();
}

function mpOpenCareer(id) {
    const career = MP.careers.find(item => item.id === id);
    if (!career) return;
    MP.active = mpEnsureCareerShape(career);
    MP.open = true;
    MP.view = 'dashboard';
    MP.selectedFixture = null;
    MP.calendarMonth = null;
    mpRenderDashboard();
    showScreen('screen-myplayer-dashboard');
}

function mpBackToCareer() {
    mpCutStop();
    if (!MP.active) {
        mpBackToList();
        return;
    }
    MP.view = 'dashboard';
    mpRenderDashboard();
    showScreen('screen-myplayer-dashboard');
}

function mpChapterName(career) {
    const scene = mpGetScene(career).scene;
    return scene && scene.act ? scene.act : 'Chapter 1 · The Last Game';
}

function mpSetListStatus(text, isError) {
    const el = document.getElementById('mp-list-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

function mpSetCreateStatus(text, isError, asHtml) {
    const el = document.getElementById('mp-create-status');
    if (!el) return;
    if (asHtml) el.innerHTML = text || ''; else el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

// ------------------------------------------------------------
// Career list
// ------------------------------------------------------------

function mpRenderList() {
    const host = document.getElementById('mp-career-list');
    if (!host) return;

    if (!MP.careers.length) {
        host.innerHTML = `
            <div class="mp-empty">
                <b>No My Players yet</b>
                Create your first player and start the final match of his high-school season.
            </div>`;
        return;
    }

    host.innerHTML = MP.careers.map(career => {
        const chapter = mpChapterName(career);
        const next = mpNextFixture(career);
        return `
            <div class="mp-career">
                <button class="mp-career__open" onclick="mpOpenCareer(${mpJsArg(career.id)})">
                    <span class="mp-career__badge">${mpEsc(String(career.ovr || MP_START_OVR))}</span>
                    <span class="mp-career__body">
                        <span class="mp-career__name">${mpEsc(career.name || 'Unnamed Player')}</span>
                        <span class="mp-career__meta">${mpEsc(career.position || '—')} · Age ${Number(career.age) || 18} · ${mpEsc(career.nationality || '—')} · ${mpEsc(career.club ? career.club.league : 'C League')}</span>
                        <span class="mp-career__tags">${mpEsc(career.club ? career.club.name : '—')}${next ? ' · Next: ' + mpEsc(next.opponent) : ' · Season complete'}</span>
                    </span>
                    <span class="mp-career__side">
                        <span class="mp-career__chapter">${mpEsc(chapter)}</span>
                        <span class="mp-career__time">${mpEsc(mpRelativeTime(career.updatedAt))}</span>
                    </span>
                </button>
                <button class="mp-career__del" onclick="mpDeleteCareer(${mpJsArg(career.id)})" title="Delete career">Delete</button>
            </div>`;
    }).join('');
}

// ------------------------------------------------------------
// Randomizer
// ------------------------------------------------------------

function mpArchetypesFor(position) {
    return Object.keys(ARCHETYPES).filter(key => {
        const group = ARCHETYPES[key].group;
        if (group === 'ANY') return position !== 'GK';
        return (ARCHETYPE_GROUPS[group] || []).includes(position);
    });
}

function mpPlaystylesFor(position) {
    return Object.keys(PLAYSTYLES).filter(key => {
        const positions = PLAYSTYLES[key].positions || [];
        return positions.includes(position);
    });
}

function mpRollDraft() {
    const position = mpPick(MP_POSITIONS);
    const archetypes = mpArchetypesFor(position);
    const playstyles = mpPlaystylesFor(position);
    return {
        nationality: mpPick(MP_COUNTRIES),
        heightCm: mpRandomInt(155, 210),
        weightKg: mpRandomInt(55, 140),
        position,
        archetype: mpPick(archetypes.length ? archetypes : Object.keys(ARCHETYPES)),
        playstyle: mpPick(playstyles.length ? playstyles : Object.keys(PLAYSTYLES))
    };
}

function mpDraftDisplay(field) {
    const draft = MP.draft || {};
    switch (field) {
        case 'nationality': return draft.nationality || '—';
        case 'height': return mpHeight(draft.heightCm);
        case 'weight': return `${draft.weightKg || 0} kg`;
        case 'position': return mpPosLabel(draft.position);
        case 'archetype': return draft.archetype || '—';
        case 'playstyle': return draft.playstyle || '—';
        default: return '—';
    }
}

function mpReelItems(field, final) {
    const items = [];
    for (let i = 0; i < 11; i++) {
        let value = '';
        switch (field) {
            case 'nationality': value = mpPick(MP_COUNTRIES); break;
            case 'height': value = mpHeight(mpRandomInt(155, 210)); break;
            case 'weight': value = `${mpRandomInt(55, 140)} kg`; break;
            case 'position': value = mpPosLabel(mpPick(MP_POSITIONS)); break;
            case 'archetype': value = mpPick(Object.keys(ARCHETYPES)); break;
            case 'playstyle': value = mpPick(Object.keys(PLAYSTYLES)); break;
        }
        if (value && value !== final) items.push(value);
    }
    items.push(final);
    return items;
}

function mpRenderReels() {
    const host = document.getElementById('mp-reel-grid');
    if (!host) return;
    const reels = [
        ['nationality', 'Nationality'],
        ['height', 'Height'],
        ['weight', 'Weight'],
        ['position', 'Position'],
        ['archetype', 'Archetype'],
        ['playstyle', 'Playstyle']
    ];
    const idle = !MP.draft;
    host.innerHTML = reels.map(([field, label]) => `
        <div class="mp-reel" data-field="${field}">
            <div class="mp-reel__label">${label}</div>
            <div class="mp-reel__window"><div class="mp-reel__track">
                <div class="mp-reel__item">${idle ? 'Ready to roll' : mpEsc(mpDraftDisplay(field))}</div>
            </div></div>
        </div>`).join('');
}

function mpAnimateReels() {
    MP.reelTimers.forEach(timer => clearTimeout(timer));
    MP.reelTimers = [];
    const token = ++MP.reelToken;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('#mp-reel-grid .mp-reel').forEach((reel, index) => {
        const field = reel.dataset.field;
        const final = mpDraftDisplay(field);
        const track = reel.querySelector('.mp-reel__track');
        if (!track) return;

        const items = mpReelItems(field, final);
        const distance = (items.length - 1) * 46;
        track.style.transition = 'none';
        track.style.transform = 'translateY(0)';
        track.innerHTML = items.map(item => `<div class="mp-reel__item">${mpEsc(item)}</div>`).join('');

        if (reduced) {
            track.style.transform = `translateY(-${distance}px)`;
            return;
        }

        const timer = setTimeout(() => {
            if (token !== MP.reelToken) return;
            track.style.transition = 'transform 900ms cubic-bezier(.12,.72,.16,1)';
            track.style.transform = `translateY(-${distance}px)`;
        }, 30 + index * 55);
        MP.reelTimers.push(timer);
    });
}

function mpShowCreate() {
    if (!mpRequireAccount()) return;
    MP.open = true;
    MP.view = 'create';
    MP.active = null;
    MP.draft = null;
    MP.rollBusy = false;
    MP.createBusy = false;
    MP.selectedFixture = null;

    const name = document.getElementById('mp-name');
    if (name) name.value = '';
    const submit = document.getElementById('mp-create-btn');
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Create My Player';
    }
    const roll = document.getElementById('mp-roll-btn');
    if (roll) {
        roll.disabled = false;
        roll.textContent = 'Roll';
    }
    mpSetCreateStatus(`Your first roll is free. Rerolls cost ${TOKEN_COSTS.MP_REROLL} ${tokenInline(13)}.`, false, true);
    mpRenderReels();
    showScreen('screen-myplayer-create');
    accountRenderHud();
}

async function mpRollAction() {
    if (!mpRequireAccount() || MP.rollBusy) return;
    const reroll = !!MP.draft;
    MP.rollBusy = true;

    const roll = document.getElementById('mp-roll-btn');
    const submit = document.getElementById('mp-create-btn');
    if (roll) { roll.disabled = true; roll.textContent = reroll ? 'Rolling…' : 'Rolling…'; }
    if (submit) submit.disabled = true;

    if (reroll) {
        const paid = await accountSpendTokens(TOKEN_COSTS.MP_REROLL, 'My Player reroll');
        if (!paid) {
            MP.rollBusy = false;
            if (roll) { roll.disabled = false; roll.innerHTML = `Reroll · ${TOKEN_COSTS.MP_REROLL} ${tokenInline(13)}`; }
            if (submit) submit.disabled = !MP.draft;
            mpSetCreateStatus(`You need ${TOKEN_COSTS.MP_REROLL} ${tokenInline(13)} to reroll.`, true, true);
            return;
        }
        mpSetCreateStatus(`Rerolled for ${TOKEN_COSTS.MP_REROLL} ${tokenInline(13)}.`, false, true);
    } else {
        mpSetCreateStatus('Rolling your player…');
    }

    MP.draft = mpRollDraft();
    mpRenderReels();
    mpAnimateReels();
    accountRenderHud();

    setTimeout(() => {
        MP.rollBusy = false;
        if (roll) { roll.disabled = false; roll.innerHTML = `Reroll · ${TOKEN_COSTS.MP_REROLL} ${tokenInline(13)}`; }
        if (submit) submit.disabled = false;
        const hint = document.getElementById('mp-create-status');
        if (hint) {
            hint.textContent = 'Happy with the roll? Name your player and create the career.';
            hint.className = 'mp-status';
        }
    }, 1000);
}

function mpBuildStartingAttrs(position, archetype, playstyle, target = MP_START_OVR) {
    const attrs = buildRoleStats(target, position, archetype, playstyle);
    MP_ATTR_KEYS.forEach(key => { attrs[key] = mpClamp(Math.round(attrs[key]), 1, 99); });
    const weights = POS_WEIGHTS[position] || POS_WEIGHTS.CM;
    const sorted = MP_ATTR_KEYS.slice().sort((a, b) => (weights[b] || 0) - (weights[a] || 0));

    let guard = 0;
    while (calculateOVRFromStats(attrs, position) !== target && guard++ < 300) {
        const diff = target - calculateOVRFromStats(attrs, position);
        const step = diff > 0 ? 1 : -1;
        const key = sorted.find(k => step > 0 ? attrs[k] < 99 : attrs[k] > 40) || sorted[0];
        attrs[key] = mpClamp(attrs[key] + step, 40, 99);
    }
    return attrs;
}

async function mpCreateCareer() {
    if (!mpRequireAccount() || MP.createBusy) return;
    if (!MP.draft) {
        mpSetCreateStatus('Press Roll first — the reels decide everything except the name.', true);
        return;
    }

    const input = document.getElementById('mp-name');
    const name = (input?.value || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
        mpSetCreateStatus('Give your player a name with at least 2 characters.', true);
        if (input) input.focus();
        return;
    }
    if (name.length > 24) {
        mpSetCreateStatus('Keep the name to 24 characters or fewer.', true);
        return;
    }

    MP.createBusy = true;
    const submit = document.getElementById('mp-create-btn');
    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Creating…';
    }
    mpSetCreateStatus('Saving your player to your account…');

    const now = Date.now();
    const cLeague = mpPick(MP_C_LEAGUE_CLUBS);
    const bLeague = mpPick(MP_B_LEAGUE_CLUBS);
    const draft = MP.draft;
    const attrs = mpBuildStartingAttrs(draft.position, draft.archetype, draft.playstyle);

    const career = {
        id: `mp_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        version: 2,
        name,
        nationality: draft.nationality,
        heightCm: draft.heightCm,
        weightKg: draft.weightKg,
        position: draft.position,
        archetype: draft.archetype,
        playstyle: draft.playstyle,
        attrs,
        ovr: calculateOVRFromStats(attrs, draft.position),
        age: 18,
        hometown: mpPick(MP_CITIES),
        createdAt: now,
        updatedAt: now,
        startDate: now,
        money: 0,
        health: { stamina: 100, mental: 100 },
        injury: 0,
        suspension: 0,
        form: [],
        assets: [],
        trainingCooldowns: {},
        restReadyAt: 0,
        careerStats: { matches: 0, goals: 0, assists: 0, ratingSum: 0, ratingCount: 0 },
        club: { name: cLeague, league: 'C League', salary: 1450 },
        story: {
            path: 'intro',
            step: 0,
            decision: null,
            clubs: {
                cLeague,
                bLeague,
                loan: mpPickDifferent(MP_C_LEAGUE_CLUBS, [cLeague])
            }
        }
    };
    mpEnsureSchedule(career);

    try {
        await mpSaveCareer(career);
        MP.active = career;
        MP.draft = null;
        MP.createBusy = false;
        MP.view = 'story';
        MP.storyBusy = false;
        mpRenderStory();
        showScreen('screen-myplayer-story');
        if (typeof showToast === 'function') showToast(`${career.name} signs for ${career.club.name}.`);
    } catch (error) {
        MP.createBusy = false;
        mpSetCreateStatus(accountFriendlyError(error), true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Create My Player';
        }
    }
}

// ------------------------------------------------------------
// Schedule generation
// ------------------------------------------------------------

function mpEnsureSchedule(career) {
    if (!career || !career.schedule) return;
    const fixtures = career.schedule.fixtures;
    const unplayed = fixtures.filter(fixture => !fixture.played).length;
    if (unplayed >= 14) return;

    let round = fixtures.length + 1;
    for (let i = unplayed; i < 16; i++) {
        const opponents = MP_C_LEAGUE_CLUBS.filter(club => club !== career.club.name);
        const opponent = opponents[(round * 7 + round * round) % Math.max(1, opponents.length)] || opponents[0];
        fixtures.push({
            id: `fx_${career.id}_${round}`,
            round,
            opponent,
            home: round % 2 === 1,
            day: MP_FIRST_MATCHDAY + (round - 1) * MP_MATCHDAY_GAP,
            key: round % 5 === 0,
            played: false,
            result: null
        });
        round++;
    }
}

function mpLookupFixture(id) {
    if (!MP.active || !MP.active.schedule) return null;
    return MP.active.schedule.fixtures.find(fixture => fixture.id === id) || null;
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

function mpManagerDecision(career) {
    if (career.injury > 0) {
        return { starts: false, reason: `Injured — out for ${career.injury} more match${career.injury > 1 ? 'es' : ''}` };
    }
    if (career.suspension > 0) {
        return { starts: false, reason: `Suspended — ${career.suspension} more match${career.suspension > 1 ? 'es' : ''}` };
    }
    if (career.health.stamina < 32) {
        return { starts: false, reason: 'The manager rests you — stamina too low' };
    }
    if (career.health.mental < 28) {
        return { starts: false, reason: 'The manager protects you — mental state too low' };
    }
    const formAvg = mpAvg(career.form.slice(-5));
    if (formAvg != null && formAvg < 6.0) {
        return { starts: false, reason: 'Dropped — recent performances below the standard' };
    }
    if (formAvg != null && formAvg < 6.3 && career.health.stamina < 55) {
        return { starts: false, reason: 'Rotated — the manager wants fresher legs' };
    }
    return { starts: true, reason: 'Picked for the starting XI' };
}

function mpPlayerObject(career, scale = 1) {
    const attrs = {};
    MP_ATTR_KEYS.forEach(key => {
        attrs[key] = mpClamp(Math.round((Number(career.attrs[key]) || 60) * scale), 1, 99);
    });
    return {
        id: `mp_${career.id}`,
        name: career.name,
        rating: scale === 1 ? career.ovr : calculateOVRFromStats(attrs, career.position),
        displayOVR: String(Math.min(99, Math.round(scale === 1 ? career.ovr : calculateOVRFromStats(attrs, career.position)))),
        stats: attrs,
        mainPos: career.position,
        archetype: career.archetype,
        playstyle: career.playstyle,
        subPos: [],
        team: career.club ? career.club.name : '',
        nationality: career.nationality
    };
}

// A tired or drained player really is worse in the live engine: low stamina and
// low mental health shave the attributes used for every duel, chance and rating.
function mpConditionScale(career) {
    const stamina = Number(career.health.stamina) || 0;
    const mental = Number(career.health.mental) || 0;
    let scale = 1;
    if (stamina < 65) scale -= (65 - stamina) / 100 * 0.3;
    if (mental < 65) scale -= (65 - mental) / 100 * 0.16;
    return mpClamp(scale, 0.78, 1);
}

function mpHealthMarkup(career) {
    const stamina = Math.round(career.health.stamina);
    const mental = Math.round(career.health.mental);
    return `
        <div class="mp-health">
            <div class="mp-health__row">
                <div class="mp-health__top"><span>Stamina</span><b>${stamina}%</b></div>
                <div class="mp-bar"><div class="mp-bar__fill ${stamina < 35 ? 'mp-bar__fill--low' : 'mp-bar__fill--stamina'}" style="--v:${stamina}"></div></div>
            </div>
            <div class="mp-health__row">
                <div class="mp-health__top"><span>Mental health</span></div>
                <div class="mp-bar"><div class="mp-bar__fill ${mental < 35 ? 'mp-bar__fill--low' : 'mp-bar__fill--mental'}" style="--v:${mental}"></div></div>
            </div>
        </div>`;
}

function mpRenderDashboard() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const root = document.getElementById('mp-dashboard-root');
    if (!root) return;

    const subtitle = document.getElementById('mp-dash-subtitle');
    if (subtitle) subtitle.textContent = career.name;

    const player = mpPlayerObject(career);
    const avg = mpOverallRating(career);
    const next = mpNextFixture(career);

    root.innerHTML = `
        <div class="mp-dash">
            <aside class="mp-dash__side">
                <div class="mp-dash__cardwrap">${renderPlayerCard(player, { size: 'xl' })}</div>
                <div class="mp-panel">
                    <div class="mp-idcard__rows">
                        <div><span>Age</span><b>${Number(career.age) || 18}</b></div>
                        <div><span>Nationality</span><b>${mpEsc(career.nationality)}</b></div>
                        <div><span>Archetype</span><b>${mpEsc(career.archetype)}</b></div>
                        <div><span>Playstyle</span><b>${mpEsc(career.playstyle)}</b></div>
                        <div><span>Height / Weight</span><b>${mpEsc(mpHeight(career.heightCm))} · ${career.weightKg} kg</b></div>
                    </div>
                    <button class="btn btn--ghost mp-idcard__back" onclick="mpBackToList()">Back</button>
                </div>
            </aside>

            <section class="mp-dash__main">
                <div class="mp-panel">
                    <div class="mp-club-head">
                        <div>
                            <div class="eyebrow">${mpEsc(career.club.league)}</div>
                            <h3>${mpEsc(career.club.name)}</h3>
                        </div>
                        <div class="mp-club-side">
                            <b>${mpMoney(career.money)}</b>
                            <span>Saved from salary</span>
                        </div>
                    </div>

                    <div class="mp-statgrid">
                        <div class="mp-stat"><span>Salary</span><b>${mpMoney(career.club.salary)}</b><small>per week</small></div>
                        <div class="mp-stat"><span>Appearances</span><b>${career.careerStats.matches}</b><small>${career.careerStats.goals} goals · ${career.careerStats.assists} assists</small></div>
                        <div class="mp-stat"><span>Avg rating</span><b>${avg ? avg.toFixed(2) : '—'}</b><small>Sofascore style</small></div>
                    </div>

                    ${mpHealthMarkup(career)}
                </div>

                <div class="mp-panel">
                    <div class="mp-next">
                        <div class="mp-next__who">
                            <span>Next fixture</span>
                            <b>${next ? `${next.home ? 'vs' : 'at'} ${mpEsc(next.opponent)}` : 'Season complete'}</b>
                            <small>${next ? `Matchday ${next.round} · ${mpDateLabel(mpFixtureDate(career, next))}${next.key ? ' · Key match' : ''}` : 'The schedule will extend when the season rolls over.'}</small>
                        </div>
                        ${next ? `<span class="mp-next__tag">${next.key ? 'Key match' : 'League'}</span>` : ''}
                        <button class="btn btn--primary" onclick="mpOpenSchedule()">Matches</button>
                    </div>
                </div>

                <div class="mp-actions-grid">
                    <button class="mp-actionbtn mp-actionbtn--primary" onclick="mpOpenSchedule()">
                        <b>Play Match</b>
                        <small>Schedule calendar, live key matches and simulations.</small>
                    </button>
                    <button class="mp-actionbtn" onclick="mpOpenTraining()">
                        <b>Training</b>
                        <small>${MP_TRAINING.some(exercise => !mpCooldownText(career.trainingCooldowns[exercise.id])) ? 'A session is ready.' : 'All drills are on cooldown.'} Drills, boosts and rest.</small>
                    </button>
                    <button class="mp-actionbtn" onclick="mpOpenAssets()">
                        <b>Assets</b>
                        <small>Spend salary on things that protect your mental health.</small>
                    </button>
                </div>
            </section>
        </div>`;
    mpSetSaveState('saved');
    accountRenderHud();
}

// ------------------------------------------------------------
// Calendar / schedule
// ------------------------------------------------------------

function mpOpenSchedule() {
    if (!MP.active) return;
    mpEnsureSchedule(MP.active);
    MP.view = 'schedule';
    MP.selectedFixture = MP.selectedFixture || (mpNextFixture(MP.active) && mpNextFixture(MP.active).id);
    if (!MP.calendarMonth) {
        const next = mpNextFixture(MP.active);
        MP.calendarMonth = mpMonthKey(next ? mpFixtureDate(MP.active, next) : new Date());
    }
    mpRenderSchedule();
    showScreen('screen-myplayer-schedule');
}

function mpShiftCalendar(delta) {
    if (!MP.active || !MP.calendarMonth) return;
    const [year, month] = MP.calendarMonth.split('-').map(Number);
    const key = mpMonthKey(new Date(year, month - 1 + delta, 1));
    if (key < mpCalendarFloorKey(MP.active)) return;
    MP.calendarMonth = key;
    if (delta > 0) mpEnsureSchedule(MP.active);
    mpRenderSchedule();
}

function mpFixturesForDate(career, date) {
    return career.schedule.fixtures.filter(fixture => {
        const fixtureDate = mpFixtureDate(career, fixture);
        return fixtureDate.getFullYear() === date.getFullYear()
            && fixtureDate.getMonth() === date.getMonth()
            && fixtureDate.getDate() === date.getDate();
    });
}

function mpFixtureAvailability(career, fixture) {
    const unavailable = career.injury > 0 || career.suspension > 0;
    return {
        decision: mpManagerDecision(career),
        canPlay: !unavailable,
        canSim: !fixture.key && !unavailable,
        canSkip: !fixture.key || unavailable
    };
}

function mpFixtureActionButtons(career, fixture) {
    if (fixture.played) return '<span class="mp-chip">Result recorded</span>';

    const { decision, canPlay, canSim, canSkip } = mpFixtureAvailability(career, fixture);
    const buttons = [];

    buttons.push(`<button class="btn btn--primary" onclick="mpPlayFixture(${mpJsArg(fixture.id)})" ${canPlay ? '' : 'disabled'}>Play live</button>`);
    if (fixture.key) {
        buttons.push(`<span class="mp-lock">★ Key match — no simulation</span>`);
    } else {
        buttons.push(`<button class="btn btn--ghost" onclick="mpSimulateFixture(${mpJsArg(fixture.id)})" ${canSim ? '' : 'disabled'}>Simulate</button>`);
        buttons.push(`<button class="btn btn--ghost" onclick="mpBenchFixture(${mpJsArg(fixture.id)})" ${canPlay ? '' : 'disabled'}>Bench</button>`);
    }
    buttons.push(`<button class="btn btn--ghost" onclick="mpSkipFixture(${mpJsArg(fixture.id)})" ${canSkip ? '' : 'disabled'}>Skip</button>`);

    return buttons.join('');
}

function mpFixtureNote(career, fixture) {
    if (fixture.played) return '';
    const { decision, canPlay } = mpFixtureAvailability(career, fixture);
    if (decision.starts && canPlay) return '';
    const reason = mpEsc(decision.reason);
    return `<p class="mp-status" style="width:100%;margin:4px 0 0">${canPlay ? reason : `${reason}. Recovery or skipping is the only option.`}</p>`;
}

function mpRenderSchedule() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const root = document.getElementById('mp-schedule-root');
    if (!root) return;
    const subtitle = document.getElementById('mp-schedule-subtitle');
    if (subtitle) subtitle.textContent = `${career.club.league} · ${career.club.name}`;

    mpEnsureSchedule(career);
    const calendarFloor = mpCalendarFloorKey(career);
    const storedMonth = MP.calendarMonth || mpMonthKey(new Date());
    const calendarKey = storedMonth < calendarFloor ? calendarFloor : storedMonth;
    MP.calendarMonth = calendarKey;
    const [year, month] = calendarKey.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const startOffset = (first.getDay() + 6) % 7; // Monday first
    const daysInMonth = new Date(year, month, 0).getDate();
    const next = mpNextFixture(career);
    const selected = MP.selectedFixture ? mpLookupFixture(MP.selectedFixture) : next;

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push('<div class="mp-cal__day is-out"></div>');
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const fixtures = mpFixturesForDate(career, date);
        const isNext = next && mpFixtureDate(career, next).toDateString() === date.toDateString();
        cells.push(`
            <div class="mp-cal__day${isNext ? ' is-next' : ''}">
                <span class="mp-cal__date">${day}</span>
                ${fixtures.map(fixture => `
                    <button class="mp-fix${fixture.key ? ' is-key' : ''}${fixture.played ? ' is-played' : ''}"
                        onclick="mpSelectFixture(${mpJsArg(fixture.id)})" title="${mpEsc(fixture.opponent)}">
                        <b>${fixture.key ? '★ ' : ''}${mpEsc(fixture.opponent)}</b>
                        <span>MD ${fixture.round} · ${fixture.home ? 'H' : 'A'}${fixture.played ? ' · played' : ''}</span>
                    </button>`).join('')}
            </div>`);
    }
    while (cells.length % 7) cells.push('<div class="mp-cal__day is-out"></div>');

    const nextHead = next ? `
        <div class="mp-sched__next">
            <span>${next.key ? 'Key match' : 'Next match'}</span>
            <b>${next.home ? 'vs' : 'at'} ${mpEsc(next.opponent)}</b>
            <small>Matchday ${next.round} · ${mpDateLabel(mpFixtureDate(career, next))} · ${next.home ? 'Home' : 'Away'}</small>
        </div>` : '<div class="mp-sched__next"><span>Next match</span><b>Season complete</b><small>The calendar extends when the season rolls over.</small></div>';

    const selectedCard = selected && (!next || selected.id !== next.id) ? `
        <div class="mp-fixture-panel">
            <div class="mp-fixture-detail">
                <div>
                    <div class="eyebrow">${selected.key ? 'Key match' : 'Fixture'}</div>
                    <h4>${selected.home ? 'vs' : 'at'} ${mpEsc(selected.opponent)}</h4>
                    <p>Matchday ${selected.round} · ${mpDateLabel(mpFixtureDate(career, selected))} · ${selected.home ? 'Home' : 'Away'}</p>
                </div>
                <div class="mp-fixture-detail__actions">${mpFixtureActionButtons(career, selected)}</div>
                ${mpFixtureNote(career, selected)}
            </div>
        </div>` : '';

    root.innerHTML = `
        <div class="mp-panel">
            <div class="mp-head mp-head--sched">
                <div>
                    <div class="eyebrow">Season schedule</div>
                    <h2>Matches</h2>
                </div>
                ${nextHead}
            </div>

            <div class="mp-sched__actions">
                ${next ? mpFixtureActionButtons(career, next) : ''}
                <button class="btn btn--ghost" onclick="mpSimulateToKey()">Simulate to next key match</button>
            </div>
            ${next ? mpFixtureNote(career, next) : ''}

            <div class="mp-cal">
                <div class="mp-cal__head">
                    <div><h3>${monthLabel}</h3></div>
                    <div class="mp-cal__nav">
                        <button class="btn btn--ghost" onclick="mpShiftCalendar(-1)" ${calendarKey > calendarFloor ? '' : 'disabled'} aria-label="Previous month">←</button>
                        <button class="btn btn--ghost" onclick="mpShiftCalendar(1)" aria-label="Next month">→</button>
                    </div>
                </div>
                <div class="mp-cal__grid">
                    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<div class="mp-cal__dow">${day}</div>`).join('')}
                    ${cells.join('')}
                </div>
            </div>

            ${selectedCard}

            <button class="btn btn--ghost mp-panel__back" onclick="mpBackToCareer()">Back</button>
        </div>`;

    mpSetSaveState('saved');
    accountRenderHud();
}

function mpSelectFixture(id) {
    MP.selectedFixture = id;
    mpRenderSchedule();
}

// ------------------------------------------------------------
// Match engine bridge
// ------------------------------------------------------------

function mpBuildTeamState(career, includeMp, side, conditionScale = 1) {
    const isHome = side === 'home';
    const league = career.club.league;
    const base = league === 'C League' ? 64 : 70;
    const ownBoost = includeMp ? Math.round((career.ovr - MP_START_OVR) * 0.35) : 0;
    const seed = Math.floor(Math.random() * 900) + 1;

    const lineup = MP_TEAM_SHAPE.map((pos, index) => {
        const ovr = mpClamp(base + ownBoost + (isHome ? 2 : 0) + mpRandomInt(-3, 3), 52, 88);
        return { player: makeGhostPlayer(pos, ovr, career.club.name, seed * 20 + index), pos, yel: 0 };
    });

    if (includeMp) {
        const slotIndex = MP_SLOT_FOR_POS[career.position] != null ? MP_SLOT_FOR_POS[career.position] : 5;
        const mpPlayer = mpPlayerObject(career, conditionScale);
        lineup[slotIndex] = { player: mpPlayer, pos: career.position, yel: 0 };
    }

    const bench = Array.from({ length: 5 }, (_, index) => {
        const pos = ['GK', 'CB', 'CM', 'LW', 'ST'][index];
        const ovr = mpClamp(base + (isHome ? 2 : 0) + mpRandomInt(-4, 2), 52, 86);
        return makeGhostPlayer(pos, ovr, career.club.name, seed * 40 + index);
    });

    return {
        id: `mp-team-${side}`,
        name: side === 'home' ? career.club.name : null,
        lineup,
        bench,
        reserves: [],
        subs: 0,
        tactics: normalizeTactics(DEFAULT_TACTICS),
        medicalTier: 0,
        isGhost: true
    };
}

function mpOpponentTeam(career, fixture) {
    const seed = (Number(String(fixture.id).replace(/\D/g, '')) || 1) + fixture.round;
    const strength = 63 + Math.min(7, Math.floor(fixture.round / 3)) + (fixture.key ? 2 : 0);
    const lineup = MP_TEAM_SHAPE.map((pos, index) => {
        const ovr = mpClamp(strength + mpRandomInt(-4, 4), 52, 92);
        return { player: makeGhostPlayer(pos, ovr, fixture.opponent, seed * 30 + index), pos, yel: 0 };
    });
    const bench = Array.from({ length: 5 }, (_, index) => {
        const pos = ['GK', 'CB', 'CM', 'LW', 'ST'][index];
        return makeGhostPlayer(pos, mpClamp(strength + mpRandomInt(-5, 2), 52, 88), fixture.opponent, seed * 50 + index);
    });
    return {
        id: `mp-team-opp-${fixture.id}`,
        name: fixture.opponent,
        lineup,
        bench,
        reserves: [],
        subs: 0,
        tactics: normalizeTactics(DEFAULT_TACTICS),
        medicalTier: 0,
        isGhost: true
    };
}

function mpStartLiveMatch(fixture) {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const decision = mpManagerDecision(career);
    if (career.injury > 0 || career.suspension > 0) {
        if (typeof showToast === 'function') showToast(decision.reason);
        return;
    }

    MP.liveFixtureId = fixture.id;
    MP.liveStarts = decision.starts;
    MP.livePlayerId = `mp_${career.id}`;
    MP.liveClubSide = fixture.home ? 1 : 2;
    MP.selectedFixture = null;

    // Home and away are real: the club can be side 2, so the result is mapped
    // back through liveClubSide when the match ends.
    const condition = mpConditionScale(career);
    const club = mpBuildTeamState(career, decision.starts, fixture.home ? 'home' : 'away', condition);
    const opponent = mpOpponentTeam(career, fixture);
    club.name = career.club.name;
    opponent.name = fixture.opponent;
    const t1 = fixture.home ? club : opponent;
    const t2 = fixture.home ? opponent : club;

    gameState.mode = 'MP';
    gameState.managers = [];
    gameState.matchQueue = [];
    gameState.matchSim = null;
    gameState.currentMatchData = {
        isMP: true,
        fixtureId: fixture.id,
        label: `C League · Matchday ${fixture.round}`,
        t1,
        t2
    };

    prepareMatchScreen(`C League · Matchday ${fixture.round}`, t1.name, t2.name);
    forceCloseMatchRatings();
    showScreen('screen-match');
    simulateMatchSequence(t1, t2);
}

function mpOnLiveMatchFinished() {
    if (!MP.active || !MP.liveFixtureId) return;
    const sim = gameState.matchSim;
    const fixture = mpLookupFixture(MP.liveFixtureId);
    if (!sim || !fixture) {
        gameState.currentMatchData = null;
        mpOpenSchedule();
        return;
    }

    const entry = sim.ratings ? sim.ratings[MP.livePlayerId] : null;
    const rating = entry ? mpClamp(liveRatingFor(sim, entry), 1, 10) : null;
    const goals = entry ? entry.goals : 0;
    const assists = entry ? entry.assists : 0;
    const yellow = entry ? entry.yellow : 0;
    const red = entry ? !!entry.red : false;
    const clubSide = MP.liveClubSide === 2 ? 2 : 1;
    const gf = clubSide === 1 ? sim.s1 : sim.s2;
    const ga = clubSide === 1 ? sim.s2 : sim.s1;

    mpApplyMatchOutcome(MP.active, fixture, {
        starts: MP.liveStarts && !!entry,
        goals,
        assists,
        rating,
        gf,
        ga,
        yellow,
        red,
        live: true
    });

    MP.liveFixtureId = null;
    MP.livePlayerId = null;
    MP.liveClubSide = 1;
    gameState.currentMatchData = null;
    gameState.matchSim = null;
    forceCloseMatchRatings();

    MP.view = 'schedule';
    MP.selectedFixture = null;
    mpRenderSchedule();
    showScreen('screen-myplayer-schedule');
    mpAutosaveNow();
}

// ------------------------------------------------------------
// Match outcome
// ------------------------------------------------------------

function mpOwnedAssets(career) {
    return MP_ASSETS.filter(asset => career.assets.includes(asset.id));
}

function mpMentalShield(career) {
    return Math.min(0.5, mpOwnedAssets(career).reduce((sum, asset) => sum + (asset.shield || 0), 0));
}

function mpApplyMatchOutcome(career, fixture, detail) {
    // The fixture just passed, so any injury or ban carried into it has now
    // been served. New ones are added below and are not ticked away again.
    if (career.injury > 0) career.injury--;
    if (career.suspension > 0) career.suspension--;

    const beforeStamina = career.health.stamina;
    const beforeMental = career.health.mental;
    const started = !!detail.starts;
    const result = detail.gf > detail.ga ? 'W' : detail.gf === detail.ga ? 'D' : 'L';
    const shield = mpMentalShield(career);
    const salary = Math.round(career.club.salary / 4);

    let mentalDelta = 0;
    if (started) {
        mentalDelta += result === 'W' ? 3 : result === 'L' ? -3 : 0;
        if (detail.goals) mentalDelta += detail.goals * 2;
        if (detail.assists) mentalDelta += detail.assists;
        if (detail.rating != null) {
            if (detail.rating >= 8) mentalDelta += 3;
            else if (detail.rating <= 5.5) mentalDelta -= 3;
        }
        mentalDelta -= detail.yellow ? 1 : 0;
    } else {
        mentalDelta -= detail.benched === false ? 2 : 4;
    }

    if (detail.red) {
        career.suspension = Math.max(career.suspension, 1);
        mentalDelta -= 8;
    }

    // Assets soften every negative hit, not just injuries.
    if (mentalDelta < 0) mentalDelta *= (1 - shield);
    mentalDelta = Math.round(mentalDelta);
    if (mentalDelta > 0) {
        const passive = mpOwnedAssets(career).reduce((sum, asset) => sum + (asset.perMatch || 0), 0);
        mentalDelta = Math.round(mentalDelta + passive);
    }

    let staminaDelta;
    if (started) staminaDelta = fixture.key ? -22 : -18;
    else if (detail.mode === 'skip') staminaDelta = 12;
    else staminaDelta = 8;

    career.health.stamina = mpClamp(career.health.stamina + staminaDelta, 0, 100);
    career.health.mental = mpClamp(career.health.mental + mentalDelta, 0, 100);

    let injuryNote = '';
    if (started) {
        const chance = mpClamp(
            0.03 + (100 - beforeStamina) / 100 * 0.12 + (100 - beforeMental) / 100 * 0.06 + (fixture.key ? 0.03 : 0),
            0.02,
            0.35
        );
        if (Math.random() < chance) {
            const matches = mpRandomInt(1, 4);
            career.injury = Math.max(career.injury, matches);
            career.health.mental = mpClamp(career.health.mental - 12, 0, 100);
            career.health.stamina = mpClamp(career.health.stamina - 10, 0, 100);
            injuryNote = `Injured in the match — out for ${matches} match${matches > 1 ? 'es' : ''}.`;
        }
    }

    if (started) {
        career.careerStats.matches++;
        career.careerStats.goals += detail.goals || 0;
        career.careerStats.assists += detail.assists || 0;
        if (detail.rating != null) {
            career.careerStats.ratingSum += detail.rating;
            career.careerStats.ratingCount++;
            career.form.push(Number(detail.rating.toFixed(1)));
            career.form = career.form.slice(-8);
        }
    }

    career.money += salary;
    fixture.played = true;
    fixture.result = {
        gf: detail.gf,
        ga: detail.ga,
        result,
        home: fixture.home,
        rating: detail.rating == null ? null : Number(detail.rating.toFixed(1)),
        goals: detail.goals || 0,
        assists: detail.assists || 0,
        started: started
    };

    // This fixture is now behind us; injuries and bans were ticked at the top.
    const title = `${career.club.name} ${detail.gf}–${detail.ga} ${fixture.opponent}`;
    const note = injuryNote || (started ? '' : 'The manager did not use you in this match.');
    return {
        title,
        rating: detail.rating,
        goals: detail.goals || 0,
        assists: detail.assists || 0,
        stamina: Math.round(career.health.stamina - beforeStamina),
        mental: Math.round(career.health.mental - beforeMental),
        salary,
        note,
        result
    };
}

// ------------------------------------------------------------
// Quick simulation / skip / bench
// ------------------------------------------------------------

function mpQuickMatch(career, fixture, starts) {
    const home = fixture.home;
    const myStrength = 64 + (career.ovr - MP_START_OVR) * 0.35 + (home ? 2 : 0) + mpRandomInt(-3, 3);
    const oppStrength = 63 + Math.min(7, Math.floor(fixture.round / 3)) + (fixture.key ? 2 : 0) + mpRandomInt(-3, 3);
    const diff = mpClamp((myStrength - oppStrength) / 11, -0.9, 0.9);
    const lambdaMy = mpClamp(1.4 + diff - (fixture.key ? 0.1 : 0), 0.3, 3.4);
    const lambdaOpp = mpClamp(1.3 - diff + (fixture.key ? 0.15 : 0), 0.3, 3.4);
    let gf = EngineCore.samplePoisson(lambdaMy);
    let ga = EngineCore.samplePoisson(lambdaOpp);

    let goals = 0, assists = 0, rating = null;
    if (starts) {
        const roleWeight = {
            ST: 0.42, CF: 0.38, LW: 0.3, RW: 0.3, CAM: 0.27,
            LM: 0.22, RM: 0.22, CM: 0.16, CDM: 0.08,
            LWB: 0.07, RWB: 0.07, LB: 0.04, RB: 0.04, CB: 0.04, GK: 0
        }[career.position] || 0.12;
        for (let i = 0; i < gf; i++) if (Math.random() < roleWeight) goals++;
        for (let i = 0; i < gf; i++) if (Math.random() < roleWeight * 0.75) assists++;
        const resultBonus = gf > ga ? 0.35 : gf < ga ? -0.3 : 0;
        rating = 6.2 + (career.ovr - MP_START_OVR) * 0.035 + (Math.random() * 0.9 - 0.45)
            + resultBonus + goals * 0.7 + assists * 0.4
            - (100 - career.health.stamina) / 100 * 0.8
            - (100 - career.health.mental) / 100 * 0.5;
        rating = mpClamp(Number(rating.toFixed(1)), 4, 10);
    }
    return { gf, ga, goals, assists, rating };
}

function mpResolveFixture(fixture, mode) {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    if (!fixture || fixture.played) return;

    const decision = mpManagerDecision(career);
    const unavailable = career.injury > 0 || career.suspension > 0;

    if (mode === 'simulate' || mode === 'play') {
        if (unavailable) {
            if (typeof showToast === 'function') showToast(decision.reason);
            return;
        }
        const result = mpQuickMatch(career, fixture, decision.starts);
        mpApplyMatchOutcome(career, fixture, {
            starts: decision.starts,
            goals: result.goals,
            assists: result.assists,
            rating: result.rating,
            gf: result.gf,
            ga: result.ga,
            live: false
        });
    } else if (mode === 'skip') {
        mpApplyMatchOutcome(career, fixture, {
            starts: false,
            mode: 'skip',
            goals: 0,
            assists: 0,
            rating: null,
            gf: 0,
            ga: 0,
            live: false,
            benched: false
        });
        if (typeof showToast === 'function') showToast('Match skipped. You stayed fresh but the manager noticed.');
    } else {
        mpApplyMatchOutcome(career, fixture, {
            starts: false,
            mode: 'bench',
            goals: 0,
            assists: 0,
            rating: null,
            gf: 0,
            ga: 0,
            live: false,
            benched: true
        });
        if (typeof showToast === 'function') showToast('You started on the bench.');
    }

    MP.selectedFixture = null;
    mpRenderSchedule();
    mpAutosaveNow();
}

function mpPlayFixture(id) {
    const fixture = mpLookupFixture(id);
    if (!fixture || fixture.played) return;
    if (typeof showToast === 'function' && mpManagerDecision(MP.active).starts === false) {
        showToast(mpManagerDecision(MP.active).reason);
    }
    mpStartLiveMatch(fixture);
}

function mpSimulateFixture(id) {
    const fixture = mpLookupFixture(id);
    if (!fixture || fixture.played) return;
    if (fixture.key) {
        if (typeof showToast === 'function') showToast('Key matches must be played live.');
        return;
    }
    if (!window.confirm(`Simulate ${fixture.home ? 'vs' : 'at'} ${fixture.opponent}?`)) return;
    mpResolveFixture(fixture, 'simulate');
}

function mpSkipFixture(id) {
    const fixture = mpLookupFixture(id);
    if (!fixture || fixture.played) return;
    const unavailable = MP.active.injury > 0 || MP.active.suspension > 0;
    if (fixture.key && !unavailable) {
        if (typeof showToast === 'function') showToast('Key matches cannot be skipped.');
        return;
    }
    if (!window.confirm('Skip this match? You will not play, but you recover stamina.')) return;
    mpResolveFixture(fixture, 'skip');
}

function mpBenchFixture(id) {
    const fixture = mpLookupFixture(id);
    if (!fixture || fixture.played) return;
    if (fixture.key) {
        if (typeof showToast === 'function') showToast('Key matches cannot be skipped or benched away.');
        return;
    }
    mpResolveFixture(fixture, 'bench');
}

function mpSimulateToKey() {
    if (!MP.active || MP.screenBusy) return;
    const career = MP.active;
    let count = 0;

    while (count < 10) {
        const fixture = mpNextFixture(career);
        if (!fixture) break;
        if (fixture.key) {
            if (typeof showToast === 'function') showToast('Next up is a key match — it must be played live.');
            break;
        }
        if (career.injury > 0 || career.suspension > 0) {
            if (typeof showToast === 'function') showToast(mpManagerDecision(career).reason);
            break;
        }
        if (career.health.stamina < 25) {
            if (typeof showToast === 'function') showToast('Too exhausted to simulate further. Rest or skip a match.');
            break;
        }
        MP.screenBusy = true;
        const result = mpQuickMatch(career, fixture, mpManagerDecision(career).starts);
        mpApplyMatchOutcome(career, fixture, {
            starts: mpManagerDecision(career).starts,
            goals: result.goals,
            assists: result.assists,
            rating: result.rating,
            gf: result.gf,
            ga: result.ga,
            live: false
        });
        count++;
        MP.screenBusy = false;
    }

    MP.screenBusy = false;
    MP.selectedFixture = null;
    mpRenderSchedule();
    mpAutosaveNow();
    if (count && typeof showToast === 'function') showToast(`Simulated ${count} match${count > 1 ? 'es' : ''}.`);
}

// ------------------------------------------------------------
// Training / rest
// ------------------------------------------------------------

function mpOpenTraining() {
    if (!MP.active) return;
    MP.view = 'training';
    mpRenderTraining();
    showScreen('screen-myplayer-training');
}

function mpRenderTraining() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const root = document.getElementById('mp-training-root');
    if (!root) return;

    root.innerHTML = `
        <div class="mp-panel">
            <div class="mp-head">
                <div>
                    <div class="eyebrow">Player development</div>
                    <h2>Training</h2>
                    <p>Every drill raises one attribute and can raise your OVR. ${tokenInline(13)} pays to cut a drill or rest cooldown.</p>
                </div>
                <div class="token-pill"><span class="token-pill__icon" data-token-icon="15"></span><b>${tokenText(Account.tokenBalance)}</b></div>
            </div>

            <div class="mp-training-grid">
                ${MP_TRAINING.map(exercise => {
                    const value = Math.round(career.attrs[exercise.attr]);
                    const cooldown = mpCooldownText(career.trainingCooldowns[exercise.id]);
                    return `
                        <div class="mp-train">
                            <div class="mp-train__top">
                                <div>
                                    <h4>${exercise.name}</h4>
                                    <p>${exercise.desc}</p>
                                </div>
                                <div class="mp-attr"><span>${exercise.attr}</span><b>${value}</b></div>
                            </div>
                            <div class="mp-train__bar"><i style="width:${mpClamp(value, 0, 100)}%"></i></div>
                            <div class="mp-train__foot">
                                ${cooldown ? `
                                    <button class="btn btn--ghost" onclick="mpCutTrainingCooldown(${mpJsArg(exercise.id)})">Cut wait · ${TOKEN_COSTS.TRAINING_COOLDOWN} ${tokenInline(13)}</button>
                                    <button class="btn btn--primary" disabled>Train in ${cooldown}</button>`
                                : `<button class="btn btn--primary" onclick="mpDoTraining(${mpJsArg(exercise.id)})">Train +1</button>`}
                            </div>
                        </div>`;
                }).join('')}
            </div>

            <div class="mp-fixture-detail" style="margin-top:16px">
                <div>
                    <div class="eyebrow">Recovery</div>
                    <h4>Rest</h4>
                    <p>${career.health.stamina < 100 ? `Recover up to ${MP_REST_STAMINA} stamina.` : 'Stamina is already full.'} No attribute changes, no match involvement.</p>
                </div>
                <div class="mp-fixture-detail__actions">
                    <button class="btn btn--primary" onclick="mpRest()" ${mpCooldownText(career.restReadyAt) || career.health.stamina >= 100 ? 'disabled' : ''}>
                        ${career.health.stamina >= 100 ? 'Stamina full' : mpCooldownText(career.restReadyAt) ? `Ready in ${mpCooldownText(career.restReadyAt)}` : 'Rest now'}
                    </button>
                    ${mpCooldownText(career.restReadyAt) ? `<button class="btn btn--ghost" onclick="mpCutRestCooldown()">Cut wait · ${TOKEN_COSTS.TRAINING_COOLDOWN} ${tokenInline(13)}</button>` : ''}
                    <button class="btn btn--ghost" onclick="mpBackToCareer()">Back</button>
                </div>
            </div>
        </div>`;
    accountRenderHud();
}

async function mpDoTraining(exerciseId) {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const exercise = MP_TRAINING.find(item => item.id === exerciseId);
    if (!exercise) return;

    if (mpCooldownText(career.trainingCooldowns[exercise.id])) {
        if (typeof showToast === 'function') showToast(`This drill is on cooldown for ${mpCooldownText(career.trainingCooldowns[exercise.id])}.`);
        return;
    }

    const current = Math.round(career.attrs[exercise.attr]);
    const next = mpClamp(current + 1, 1, 99);
    career.attrs[exercise.attr] = next;
    career.ovr = calculateOVRFromStats(career.attrs, career.position);
    career.health.stamina = mpClamp(career.health.stamina - 8, 0, 100);
    career.trainingCooldowns[exercise.id] = Date.now() + MP_TRAIN_COOLDOWN_MS;

    if (typeof showToast === 'function') {
        showToast(`${exercise.name}: ${exercise.attr} ${current} → ${next}. OVR ${career.ovr}.`);
    }

    mpRenderTraining();
    await mpAutosaveNow();
}

// Coins buy time, never a bigger gain: paying clears the wait, it does not
// make the drill count for more.
async function mpCutTrainingCooldown(exerciseId) {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const exercise = MP_TRAINING.find(item => item.id === exerciseId);
    if (!exercise || !mpCooldownText(career.trainingCooldowns[exercise.id])) return;
    const paid = await accountSpendTokens(TOKEN_COSTS.TRAINING_COOLDOWN, `${exercise.name} cooldown`);
    if (!paid) return;
    career.trainingCooldowns[exercise.id] = 0;
    mpRenderTraining();
    await mpAutosaveNow();
}

async function mpCutRestCooldown() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    if (!mpCooldownText(career.restReadyAt)) return;
    const paid = await accountSpendTokens(TOKEN_COSTS.TRAINING_COOLDOWN, 'Rest cooldown');
    if (!paid) return;
    career.restReadyAt = 0;
    mpRenderTraining();
    await mpAutosaveNow();
}

async function mpRest() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const cooldown = mpCooldownText(career.restReadyAt);
    if (cooldown) {
        if (typeof showToast === 'function') showToast(`Rest is ready in ${cooldown}.`);
        return;
    }
    if (career.health.stamina >= 100) {
        if (typeof showToast === 'function') showToast('Stamina is already full.');
        return;
    }

    const before = career.health.stamina;
    career.health.stamina = mpClamp(career.health.stamina + MP_REST_STAMINA, 0, 100);
    career.restReadyAt = Date.now() + MP_REST_COOLDOWN_MS;

    if (MP.view === 'training') mpRenderTraining();
    else mpRenderDashboard();
    if (typeof showToast === 'function') {
        showToast(`Rested: stamina ${Math.round(before)} → ${Math.round(career.health.stamina)}.`);
    }
    await mpAutosaveNow();
}

// ------------------------------------------------------------
// Assets
// ------------------------------------------------------------

function mpOpenAssets() {
    if (!MP.active) return;
    MP.view = 'assets';
    mpRenderAssets();
    showScreen('screen-myplayer-assets');
}

function mpRenderAssets() {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const root = document.getElementById('mp-assets-root');
    if (!root) return;

    root.innerHTML = `
        <div class="mp-panel">
            <div class="mp-head">
                <div>
                    <div class="eyebrow">Lifestyle</div>
                    <h2>Assets</h2>
                    <p>Spend salary on things that keep your mental health safe. Owned assets also soften future mental hits.</p>
                </div>
                <div class="mp-club-side" style="text-align:right">
                    <b>${mpMoney(career.money)}</b>
                    <span>Available</span>
                </div>
            </div>

            <div class="mp-asset-grid">
                ${MP_ASSETS.map(asset => {
                    const owned = career.assets.filter(id => id === asset.id).length;
                    return `
                        <div class="mp-asset">
                            <div class="mp-train__top">
                                <div>
                                    <h4>${asset.name}</h4>
                                    <p>${asset.desc}</p>
                                </div>
                                ${owned ? `<span class="mp-chip">Owned ×${owned}</span>` : ''}
                            </div>
                            <div class="mp-asset__effect">
                                ${asset.mental ? `<span class="mp-chip mp-chip--mental">+${asset.mental} mental</span>` : ''}
                                ${asset.stamina ? `<span class="mp-chip mp-chip--stamina">+${asset.stamina} stamina</span>` : ''}
                                ${asset.shield ? `<span class="mp-chip">−${Math.round(asset.shield * 100)}% mental loss</span>` : ''}
                                ${asset.perMatch ? `<span class="mp-chip">+${asset.perMatch} mental / match</span>` : ''}
                            </div>
                            <div class="mp-asset__price">
                                <div class="mp-asset__cost"><span>Price:</span><b>${mpMoney(asset.cost)}</b></div>
                                <button class="btn btn--primary" onclick="mpBuyAsset(${mpJsArg(asset.id)})" ${career.money < asset.cost ? 'disabled' : ''}>Buy</button>
                            </div>
                        </div>`;
                }).join('')}
            </div>

            <div class="mp-fixture-detail" style="margin-top:16px">
                <div>
                    <div class="eyebrow">Mental health</div>
                    <h4>${Math.round(career.health.mental)}%</h4>
                    <p>Injuries, cards, skipped matches and spells on the bench all cost mental health. Assets reduce those losses.</p>
                </div>
                <div class="mp-fixture-detail__actions">
                    <button class="btn btn--ghost" onclick="mpBackToCareer()">Back</button>
                </div>
            </div>
        </div>`;
    accountRenderHud();
}

function mpBuyAsset(id) {
    if (!MP.active) return;
    const career = mpEnsureCareerShape(MP.active);
    const asset = MP_ASSETS.find(item => item.id === id);
    if (!asset) return;
    if (career.money < asset.cost) {
        if (typeof showToast === 'function') showToast(`You need ${mpMoney(asset.cost - career.money)} more.`);
        return;
    }

    career.money -= asset.cost;
    career.health.mental = mpClamp(career.health.mental + (asset.mental || 0), 0, 100);
    career.health.stamina = mpClamp(career.health.stamina + (asset.stamina || 0), 0, 100);
    career.assets.push(asset.id);
    mpRenderAssets();
    if (typeof showToast === 'function') showToast(`Bought ${asset.name}.`);
    mpAutosaveNow();
}

// ------------------------------------------------------------
// Story
// ------------------------------------------------------------

// Each scene feeds the film one beat: act, title and the mood of art it uses.
// `text` is archive only — the cutscene shows no prose.
const MP_STORY = {
    intro: [
        {
            act: 'Chapter 1 · The Last Game',
            title: 'One Chance',
            text: career => [
                `${career.hometown || 'Your city'}, final day of the high-school season. The scoreboard reads 1–1.`,
                `It is two against one. The ball sits at your feet, the keeper has already committed, and to your left your teammate is completely open, arms raised, screaming for it.`,
                `A draw is enough for them. It is not enough for you. This is the last match before everyone graduates — the last chance to give your school a memory that will outlive the season.`,
                `The first big decision of your life is already here.`
            ],
            choices: [
                { label: 'Pass to the open teammate', path: 'pass' },
                { label: 'Shoot it yourself', path: 'shoot' }
            ]
        }
    ],
    pass: [
        {
            act: 'Chapter 2 · The Long Way',
            title: 'The Square Ball',
            text: () => [
                `You roll it across the face of goal. It is the right pass. It is a perfect pass.`,
                `Your teammate meets it with the whole net open in front of him. He swings — and the ball climbs over the bar, over the fence, into the trees behind the goal.`,
                `The whistle goes. 1–1. Not enough. The season ends in the cold, and nobody says anything for a long time.`
            ]
        },
        {
            act: 'Chapter 2 · The Long Way',
            title: 'Empty Sky',
            text: () => [
                `You stand in the centre circle and look up. The sky is empty and grey. Somewhere behind you, the other team starts to celebrate.`,
                `You keep replaying it: the pass, the open goal, the miss. If you had shot, it would be different. The thought follows you off the pitch and into the changing room.`,
                `You do not cry there. Not yet.`
            ]
        },
        {
            act: 'Chapter 2 · The Long Way',
            title: 'The Walk Home',
            text: () => [
                `The streets are quiet. Your boots are over your shoulder, still muddy. The tears come halfway home, sudden and hot, and you let them.`,
                `You wish you had done it differently. You wish you had been selfish for one second.`,
                `A leaflet peels away from a lamppost, tumbles across the pavement and lands against your shoe.`
            ]
        },
        {
            act: 'Chapter 2 · The Long Way',
            title: 'The Leaflet',
            text: career => [
                `You pick it up. It is a recruitment announcement for ${career.story.clubs.cLeague}, a local club in the C League. Open trials. One month from now.`,
                `The paper is cheap and the colours are already fading, but your name could be on a real team sheet. You fold it carefully and put it in your pocket.`,
                `For the first time since the final whistle, you feel something other than regret.`
            ]
        },
        {
            act: 'Chapter 2 · The Long Way',
            title: 'Dinner and the Ceiling',
            text: () => [
                `At home, dinner is quiet. Your family does not ask about the match, which is how you know they already heard.`,
                `Later, you lie on your bed with the leaflet on your chest and stare at the ceiling. The trial is in a month. You have never wanted anything this badly.`,
                `You fall asleep with the light still on.`
            ]
        },
        {
            act: 'Chapter 2 · The Long Way',
            title: 'Graduation Day',
            text: career => [
                `The month goes by in a blur of exams, goodbyes and one last summer. Then the cap goes up, the photos are taken, and high school is officially over.`,
                `The little C League club on the leaflet has kept its place in the league after a hard season. That is why the trial is now an open recruitment day — and why the queue outside the training ground is twice as long as you expected.`,
                `You take a breath, hold the leaflet tight, and walk in. This is the first step of the rest of your life.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'The Badge',
            text: career => [
                `The trial is a cold dose of reality. Faster players, sharper coaches, a hundred hopefuls for three places. You are not one of the three.`,
                `But the club that put up the leaflet — ${career.club.name} — remembers your name. They are rebuilding for the C League season, and they offer you a squad place.`,
                `It is not the dream you drew on your ceiling. It is a start. You take it.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: "The Manager's Rules",
            text: career => [
                `Your first morning at ${career.club.name} smells of deep heat and ambition. The manager gathers the squad and does not raise his voice once.`,
                `"I do not care what you did before this week," he says. "I pick on form, fitness and attitude. Train hard, rest properly, keep your head straight, and you will play."`,
                `He looks at you a moment longer than the others. "Show me you belong."`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'The Team Sheet',
            text: career => [
                `Pre-season is a blur of running, drills and ice baths. You learn the names, the patterns, the way the senior players talk when they think nobody is listening.`,
                `On Friday, the team sheet goes up. Your name is on it, written in the manager's hard, tilted hand.`,
                `Your first professional match for ${career.club.name} is on the calendar.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'Matchday',
            text: () => [
                `You stand in the tunnel with the noise above you and the badge on your chest. Whatever happens next, it starts here.`,
                `The calendar is on the wall: sixteen fixtures, key nights circled in red. Stamina, form and your head will decide how far you go.`,
                `Welcome to the C League.`
            ],
            end: true,
            endBadge: 'Your career begins',
            endText: 'Everything from here is yours to play. The dashboard holds your calendar, training, rest and health.',
            endCta: 'Go to Dashboard'
        }
    ],
    shoot: [
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Strike',
            text: () => [
                `You do not pass. You do not think. You plant your left foot and hit it.`,
                `The ball leaves your boot like a bullet and crashes into the roof of the net. The keeper never moves.`,
                `2–1. The bench empties. The crowd — all two hundred of them — loses its mind. You run until your legs give out.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'City Champions',
            text: () => [
                `The final whistle is a blur of bodies and noise. Somebody puts a trophy in your hands and the whole team lifts you onto their shoulders.`,
                `Your school has won the city championship. For one perfect afternoon, nothing else matters.`,
                `You will remember this day for the rest of your life.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Scout',
            text: career => [
                `After the celebrations, a man in a dark coat waits by the fence. He does not look like a teacher or a parent.`,
                `"That was some strike," he says. "I am with ${career.story.clubs.bLeague}. We are putting together a city select for the regional B League. I want you in it."`,
                `Your mouth goes dry. You look back at the pitch, then at him.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Handshake',
            text: () => [
                `You shake his hand before he can finish the sentence.`,
                `He laughs, writes down your number and tells you to be at the training ground on Monday. You float home. You do not remember the walk.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'Graduation and the Contract',
            text: career => [
                `The summer disappears. Graduation comes and goes, and the morning after, you walk into the ${career.story.clubs.bLeague} training facility with a bag over your shoulder.`,
                `The contract is on the table. You read every line twice, then sign your name like you have practised it a thousand times.`,
                `A real club. A real badge. A real chance.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Debut',
            text: () => [
                `The debut comes faster than you are ready for. The stadium is bigger, the pitch is faster, and every touch feels like it is being watched.`,
                `You are not terrible. You are worse than that — you are invisible. The game moves around you and you chase it like a stranger.`,
                `When the final whistle goes, you are the first player down the tunnel.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'Ten Matches',
            text: () => [
                `It does not get better. The next ten matches are a blur of half-chances and heavy legs. Your mind is somewhere else, replaying the mistakes before you make them.`,
                `The fans start to notice. The coaches stop explaining. You sit alone in the changing room after every game, staring at your boots.`,
                `You know you are better than this. You just cannot prove it.`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Call',
            text: career => [
                `On a Tuesday morning, the chairman and the manager call you into an office. You expect the worst.`,
                `The manager does not shout. He speaks slowly, like he has already decided. "You are not ready for this level yet. Not in your head."`,
                `"We are sending you on loan to ${career.story.clubs.loan} in the C League. Train there. Play there. Find yourself again. Then come back."`
            ]
        },
        {
            act: 'Chapter 2 · The Rise',
            title: 'The Loan',
            text: career => [
                `The loan is not a punishment. It is a second chance, and you know it.`,
                `At ${career.story.clubs.loan}, the dressing room is smaller, the pitch is heavier, and nobody cares what you did in high school. They only care what you do on Saturday.`,
                `You lace up your boots, take a deep breath, and get to work. The bigger stage will have to wait.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'The Badge',
            text: career => [
                `The loan ends the way loans do: quietly. The parent club does not call. Your agent — a friend of your uncle, really — makes one more call.`,
                `${career.club.name}, rebuilding for the C League season, need bodies and believe in second chances. They offer you a one-year deal.`,
                `You sign the same afternoon. It is not the dream you drew on your ceiling. It is a start. You take it.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: "The Manager's Rules",
            text: career => [
                `Your first morning at ${career.club.name} smells of deep heat and ambition. The manager gathers the squad and does not raise his voice once.`,
                `"I do not care what you did before this week," he says. "I pick on form, fitness and attitude. Train hard, rest properly, keep your head straight, and you will play."`,
                `He looks at you a moment longer than the others. "Show me you belong."`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'The Team Sheet',
            text: career => [
                `Pre-season is a blur of running, drills and ice baths. You learn the names, the patterns, the way the senior players talk when they think nobody is listening.`,
                `On Friday, the team sheet goes up. Your name is on it, written in the manager's hard, tilted hand.`,
                `Your first professional match for ${career.club.name} is on the calendar.`
            ]
        },
        {
            act: 'Chapter 3 · The First Season',
            title: 'Matchday',
            text: () => [
                `You stand in the tunnel with the noise above you and the badge on your chest. Whatever happens next, it starts here.`,
                `The calendar is on the wall: sixteen fixtures, key nights circled in red. Stamina, form and your head will decide how far you go.`,
                `Welcome to the C League.`
            ],
            end: true,
            endBadge: 'Your career begins',
            endText: 'Everything from here is yours to play. The dashboard holds your calendar, training, rest and health.',
            endCta: 'Go to Dashboard'
        }
    ]
};

function mpGetScene(career) {
    const story = (career && career.story) || {};
    const path = MP_STORY[story.path] ? story.path : 'intro';
    const list = MP_STORY[path];
    const rawStep = Number.isFinite(Number(story.step)) ? Number(story.step) : 0;
    const step = Math.max(0, Math.min(rawStep, list.length - 1));
    return { path, list, step, scene: list[step] };
}

// ------------------------------------------------------------
// Origin story cutscene
//
// The whole origin plays as one film: every chapter beat runs back to back on a
// letterboxed stage, each beat a mood of art carrying its title card. There is
// no prose and no page turning — the film stops once, at the last game, for the
// Pass or Shoot decision, then finishes on one button into the dashboard.
// Which beat is on screen is transient; story.decision is the only thing saved
// while it plays, so a reload resumes the same chapter.
// ------------------------------------------------------------

const MP_CUT_BEAT_MS = 2600;

const MP_CUT_ART = {
    'One Chance': 'pitch',
    'The Square Ball': 'pitch',
    'The Strike': 'pitch',
    'Empty Sky': 'sky',
    'City Champions': 'sky',
    'The Walk Home': 'street',
    'The Leaflet': 'street',
    'Graduation Day': 'street',
    'The Scout': 'street',
    'The Handshake': 'street',
    'The Loan': 'street',
    'Dinner and the Ceiling': 'room',
    'The Badge': 'club',
    "The Manager's Rules": 'club',
    'The Team Sheet': 'club',
    'Graduation and the Contract': 'club',
    'The Call': 'club',
    'The Debut': 'stadium',
    'Ten Matches': 'stadium',
    'Matchday': 'stadium'
};

function mpCutArt(scene) {
    return scene.art || MP_CUT_ART[scene.title] || 'street';
}

function mpCutBeats(list) {
    return (list || []).map(scene => ({ act: scene.act, title: scene.title, art: mpCutArt(scene) }));
}

function mpCutStage() {
    return document.querySelector('#mp-story-panel .mp-cut');
}

function mpCutStop() {
    if (MP.cut.timer) clearTimeout(MP.cut.timer);
    MP.cut.timer = null;
}

function mpCutArm() {
    mpCutStop();
    if (MP.cut.phase !== 'play') return;
    MP.cut.timer = setTimeout(mpCutTick, MP_CUT_BEAT_MS);
}

function mpCutTick() {
    MP.cut.timer = null;
    if (MP.cut.index + 1 < MP.cut.beats.length) {
        MP.cut.index++;
        mpCutShowBeat();
        mpCutArm();
        return;
    }
    mpCutPhase(MP.cut.path ? 'done' : 'decide');
}

function mpCutShowBeat() {
    const stage = mpCutStage();
    const beat = MP.cut.beats[MP.cut.index];
    if (!stage || !beat) return;
    stage.dataset.art = beat.art;
    const card = stage.querySelector('.mp-cut__card');
    card.classList.remove('is-in');
    card.innerHTML = `
        <div class="mp-cut__act">${mpEsc(beat.act || 'Chapter 1 · The Last Game')}</div>
        <h2 class="mp-cut__title">${mpEsc(beat.title || 'One Chance')}</h2>`;
    void card.offsetWidth;
    card.classList.add('is-in');
}

function mpCutDecisionMarkup() {
    const scene = MP_STORY.intro.find(item => (item.choices || []).length);
    if (!scene) return '';
    return `
        <p class="mp-cut__prompt">Make your decision</p>
        <div class="mp-cut__choices">
            ${scene.choices.map(choice => `
                <button class="mp-cut__choice" onclick="mpChooseStory(${mpJsArg(choice.path)})">
                    <b>${mpEsc(choice.label)}</b>
                    <span>Choose</span>
                </button>`).join('')}
        </div>`;
}

function mpCutFootMarkup() {
    if (MP.cut.phase === 'decide') return mpCutDecisionMarkup();
    if (MP.cut.phase === 'done') return `<button class="btn btn--primary mp-cut__cta" onclick="mpFinishStory()">Go to Dashboard</button>`;
    return `<button class="mp-cut__leave" onclick="mpFinishStory()">End</button>`;
}

function mpCutPhase(phase) {
    MP.cut.phase = phase;
    mpCutStop();
    const foot = document.querySelector('#mp-story-panel .mp-cut__foot');
    if (foot) foot.innerHTML = mpCutFootMarkup();
}

function mpCutPlay(beats, path) {
    mpCutStop();
    MP.cut.beats = beats;
    MP.cut.path = path;
    MP.cut.index = 0;
    MP.cut.phase = 'play';
    mpCutShowBeat();
    mpCutPhase('play');
    mpCutArm();
}

function mpRenderStory() {
    const career = mpEnsureCareerShape(MP.active);
    if (!career) {
        mpBackToList();
        return;
    }

    const subtitle = document.getElementById('mp-story-subtitle');
    if (subtitle) subtitle.textContent = career.name || 'Career';

    const panel = document.getElementById('mp-story-panel');
    if (!panel) return;

    const decided = MP_STORY[career.story.decision] ? career.story.decision : '';
    const beats = decided ? mpCutBeats(MP_STORY[decided]) : mpCutBeats(MP_STORY.intro);
    if (!beats.length) return;

    panel.innerHTML = `
        <div class="mp-cut" data-art="${mpEscAttr(beats[0].art)}">
            <div class="mp-cut__art" aria-hidden="true"></div>
            <div class="mp-cut__rail mp-cut__rail--top" aria-hidden="true"></div>
            <div class="mp-cut__rail mp-cut__rail--bottom" aria-hidden="true"></div>
            <div class="mp-cut__card"></div>
            <div class="mp-cut__foot"></div>
        </div>`;

    mpCutPlay(beats, decided || null);
    mpSetSaveState('saved');
}

async function mpChooseStory(path) {
    if (!MP.active || MP.storyBusy || !MP_STORY[path]) return;
    MP.storyBusy = true;
    MP.active.story = MP.active.story || {};
    MP.active.story.decision = path;
    mpCutPlay(mpCutBeats(MP_STORY[path]), path);
    await mpAutosaveNow();
    MP.storyBusy = false;
}

// One button leaves the film, whenever it is pressed: the chapter reached is
// what the career card remembers.
async function mpFinishStory() {
    if (!MP.active) return;
    mpCutStop();
    const path = MP_STORY[MP.cut.path] ? MP.cut.path : 'intro';
    MP.active.story = MP.active.story || {};
    MP.active.story.path = path;
    MP.active.story.step = MP_STORY[path].length - 1;
    if (MP_STORY[MP.cut.path]) MP.active.story.decision = MP.cut.path;
    await mpAutosaveNow();
    mpBackToCareer();
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------

(function mpBoot() {
    const name = document.getElementById('mp-name');
    if (name) {
        name.addEventListener('keydown', event => {
            if (event.key === 'Enter') mpCreateCareer();
        });
    }
})();
