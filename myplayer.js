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
    mpSetCreateStatus('', false, true);
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
// The whole origin plays as one film: every chapter beat is a real animated
// scene — a articulated player model performing the beat's action (dribbling,
// striking, walking home, signing…) on a painted backdrop, with a slow camera
// move per shot. The film stops once, at the last game, for the Pass or Shoot
// decision, then finishes on one button into the dashboard. Which beat is on
// screen is transient; story.decision is the only thing saved while it plays,
// so a reload resumes the same chapter.
// ------------------------------------------------------------

// How long each story line stays in the speech bubble before the next one
// slides in. Beat length follows from the line count, so dense scenes breathe.
const MP_CUT_LINE_MS = 3000;

const MP_CUT_ART = {
    'One Chance': 'pitch',
    'The Square Ball': 'pitch',
    'The Strike': 'pitch',
    'Empty Sky': 'sky',
    'City Champions': 'pitch',
    'The Walk Home': 'street',
    'The Leaflet': 'street',
    'Graduation Day': 'street',
    'The Scout': 'street',
    'The Handshake': 'street',
    'The Loan': 'pitch',
    'Dinner and the Ceiling': 'room',
    'The Badge': 'club',
    "The Manager's Rules": 'club',
    'The Team Sheet': 'club',
    'Graduation and the Contract': 'club',
    'The Call': 'club',
    'The Debut': 'stadium',
    'Ten Matches': 'club',
    'Matchday': 'tunnel'
};

// The face the hero wears for each beat. Nothing here defaults to a smile:
// the expression follows what is actually happening in the scene.
const MP_CUT_MOOD = {
    'One Chance': 'focused',
    'The Square Ball': 'focused',
    'The Strike': 'focused',
    'Empty Sky': 'sad',
    'City Champions': 'joy',
    'The Walk Home': 'cry',
    'The Leaflet': 'flat',
    'Graduation Day': 'smile',
    'The Scout': 'surprise',
    'The Handshake': 'joy',
    'Graduation and the Contract': 'focused',
    'The Debut': 'tense',
    'Ten Matches': 'sad',
    'The Call': 'tense',
    'The Loan': 'focused',
    'Dinner and the Ceiling': 'sleep',
    'The Badge': 'smile',
    "The Manager's Rules": 'flat',
    'The Team Sheet': 'smile',
    'Matchday': 'focused'
};

// The scout is pleased with his find; the manager and chairman are not.
const MP_CUT_OTHER_MOOD = {
    'The Scout': 'smile',
    'The Handshake': 'smile',
    'The Badge': 'flat',
    "The Manager's Rules": 'flat',
    'The Team Sheet': 'flat',
    'The Call': 'flat',
    'Graduation and the Contract': 'flat'
};

// Beats played during or immediately after a match, so the player is sweating.
const MP_CUT_SWEAT = {
    'One Chance': true,
    'The Square Ball': true,
    'The Strike': true,
    'Empty Sky': true,
    'City Champions': true,
    'The Debut': true
};

// What the model does on screen for each beat. Keys off the scene title so the
// archive MP_STORY data stays untouched.
const MP_CUT_ACTION = {
    'One Chance': 'dribble',
    'The Square Ball': 'kickpass',
    'The Strike': 'strike',
    'Empty Sky': 'skygaze',
    'City Champions': 'celebrate',
    'The Walk Home': 'walksad',
    'The Leaflet': 'leaflet',
    'Graduation Day': 'walk',
    'The Scout': 'talk',
    'The Handshake': 'handshake',
    'Graduation and the Contract': 'sign',
    'The Debut': 'run',
    'Ten Matches': 'sit',
    'The Call': 'talk',
    'The Loan': 'run',
    'Dinner and the Ceiling': 'bed',
    'The Badge': 'handshake',
    "The Manager's Rules": 'talk',
    'The Team Sheet': 'talk',
    'Matchday': 'tunnel'
};

// Two camera profiles per action, alternating by beat index so consecutive
// shots never reuse the same move. The stage carries the profile in data-cam
// and the stylesheet animates the shot from it.
const MP_CUT_CAMS = {
    dribble: ['panr', 'close'],
    kickpass: ['panr', 'in'],
    strike: ['panr', 'rise'],
    skygaze: ['rise', 'drift'],
    celebrate: ['in', 'drift'],
    walksad: ['panl', 'out'],
    leaflet: ['close', 'panr'],
    walk: ['panr', 'out'],
    talk: ['close', 'panl'],
    handshake: ['in', 'close'],
    sign: ['close', 'drift'],
    run: ['panl', 'rise'],
    sit: ['drift', 'close'],
    bed: ['drift', 'in'],
    tunnel: ['rise', 'panr']
};

function mpCutCam(beat, index) {
    const pair = MP_CUT_CAMS[beat.action];
    return (pair || ['in', 'out'])[index % 2];
}

function mpCutArt(scene) {
    return scene.art || MP_CUT_ART[scene.title] || 'street';
}

function mpCutAction(scene) {
    return scene.action || MP_CUT_ACTION[scene.title] || 'idle';
}

// --- film scene construction -----------------------------------------------
// Every beat renders one 16:9 SVG "shot": a painted backdrop for its mood plus
// the actor rig (and props/effects) performing the beat's action. All motion
// is CSS-driven; each joint group pivots on its own local origin.

function mpCutRng(seed) {
    let n = seed * 7 + 3;
    return () => {
        n = (n * 73 + 41) % 977;
        return n / 977;
    };
}

function mpCutCrowd(y, rows, seed) {
    const rnd = mpCutRng(seed);
    let dots = '';
    for (let i = 0; i < rows * 14; i++) {
        const cx = (i * 13 + Math.floor(rnd() * 8)) % 160;
        const cy = y + Math.floor(i / 14) * 4 + rnd() * 2;
        dots += `<circle cx="${cx}" cy="${cy.toFixed(1)}" r="0.7" fill="rgba(226,232,240,${(0.14 + rnd() * 0.2).toFixed(2)})"/>`;
    }
    return `<g>${dots}</g>`;
}

function mpCutGoal(x, groundY, w = 26, h = 20) {
    const top = groundY - h;
    const bx1 = x + 1.7, bx2 = x + w - 1.7;   // back posts, pulled in for perspective
    const btop = top + 2.8;                   // back bar sits lower = depth
    let net = '';
    for (let i = 0; i <= 8; i++) {            // roof net, front bar back to back bar
        const t = i / 8;
        net += `<line x1="${(x + w * t).toFixed(1)}" y1="${top}" x2="${(bx1 + (bx2 - bx1) * t).toFixed(1)}" y2="${btop}" stroke="rgba(226,232,240,0.10)" stroke-width="0.25"/>`;
    }
    for (let i = 0; i <= 6; i++) {            // back wall
        const bx = bx1 + ((bx2 - bx1) / 6) * i;
        net += `<line x1="${bx.toFixed(1)}" y1="${btop}" x2="${bx.toFixed(1)}" y2="${groundY - 0.3}" stroke="rgba(226,232,240,0.12)" stroke-width="0.25"/>`;
    }
    for (let j = 1; j < 5; j++) {
        const by = btop + ((groundY - btop) / 5) * j;
        net += `<line x1="${bx1}" y1="${by.toFixed(1)}" x2="${bx2}" y2="${by.toFixed(1)}" stroke="rgba(226,232,240,0.12)" stroke-width="0.25"/>`;
    }
    for (let j = 0; j <= 3; j++) {            // visible side net
        const t = j / 3;
        net += `<line x1="${x}" y1="${(top + (groundY - top) * t).toFixed(1)}" x2="${bx1}" y2="${(btop + (groundY - btop) * t).toFixed(1)}" stroke="rgba(226,232,240,0.10)" stroke-width="0.25"/>`;
    }
    return `<g class="mp-goal">
        <g class="mp-goal-net">${net}</g>
        <rect x="${bx1 - 0.25}" y="${btop}" width="0.5" height="${(groundY - btop).toFixed(1)}" fill="rgba(226,232,240,0.5)"/>
        <rect x="${bx2 - 0.25}" y="${btop}" width="0.5" height="${(groundY - btop).toFixed(1)}" fill="rgba(226,232,240,0.5)"/>
        <rect x="${bx1 - 0.3}" y="${btop - 0.3}" width="${(bx2 - bx1 + 0.6).toFixed(1)}" height="0.6" fill="rgba(226,232,240,0.5)"/>
        <rect x="${x - 0.55}" y="${top - 0.55}" width="${w + 1.1}" height="1.1" rx="0.55" fill="#f1f5f9"/>
        <rect x="${x - 0.55}" y="${top}" width="1.1" height="${(groundY - top).toFixed(1)}" rx="0.5" fill="#f1f5f9"/>
        <rect x="${x + w - 0.55}" y="${top}" width="1.1" height="${(groundY - top).toFixed(1)}" rx="0.5" fill="#f1f5f9"/>
        <rect x="${x + w - 0.15}" y="${top}" width="0.4" height="${(groundY - top).toFixed(1)}" rx="0.2" fill="rgba(148,163,184,0.7)"/>
    </g>`;
}

function mpCutPitch() {
    let stripes = '';
    for (let i = 0; i < 10; i += 2) {
        const t1 = i * 16, t2 = (i + 1) * 16;
        const b1 = 80 + (t1 - 80) * 2.4, b2 = 80 + (t2 - 80) * 2.4;
        stripes += `<polygon points="${t1},36 ${t2},36 ${b2.toFixed(1)},90 ${b1.toFixed(1)},90" fill="rgba(255,255,255,0.045)"/>`;
    }
    return `
        <rect x="0" y="0" width="160" height="36" fill="#0a1c2e"/>
        <ellipse cx="34" cy="10" rx="30" ry="12" fill="rgba(226,232,240,0.10)"/>
        <ellipse cx="128" cy="14" rx="26" ry="10" fill="rgba(226,232,240,0.07)"/>
        <rect x="0" y="24" width="160" height="12" fill="#071522"/>
        ${mpCutCrowd(24, 3, 5)}
        <rect x="0" y="36" width="160" height="54" fill="#0d3a2d"/>
        ${stripes}
        <polygon points="79.4,36 80.6,36 80.6,90 79.4,90" fill="rgba(255,255,255,0.10)"/>
        <ellipse cx="80" cy="62" rx="17" ry="5.5" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="0.5"/>
        ${mpCutGoal(124, 68)}
        <rect x="0" y="88" width="160" height="2" fill="#062b21"/>`;
}

function mpCutSky() {
    return `
        <rect x="0" y="0" width="160" height="74" fill="#12253c"/>
        <g class="mp-cloud" style="animation-duration:34s">
            <ellipse cx="36" cy="20" rx="16" ry="4.5" fill="rgba(203,213,225,0.16)"/>
            <ellipse cx="48" cy="23" rx="10" ry="3.2" fill="rgba(203,213,225,0.12)"/>
        </g>
        <g class="mp-cloud" style="animation-duration:46s;animation-delay:-18s">
            <ellipse cx="112" cy="30" rx="20" ry="5" fill="rgba(203,213,225,0.12)"/>
            <ellipse cx="96" cy="33" rx="11" ry="3.4" fill="rgba(203,213,225,0.09)"/>
        </g>
        <g class="mp-cloud" style="animation-duration:58s;animation-delay:-30s">
            <ellipse cx="70" cy="12" rx="13" ry="3.6" fill="rgba(203,213,225,0.10)"/>
        </g>
        <rect x="0" y="74" width="160" height="16" fill="#0d3a2d"/>
        <ellipse cx="80" cy="80" rx="26" ry="4.5" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.5"/>`;
}

function mpCutLamp(x) {
    return `<g>
        <rect x="${x - 0.7}" y="26" width="1.4" height="48" fill="#0b0812"/>
        <rect x="${x - 3}" y="24" width="6" height="2.4" rx="1" fill="#0b0812"/>
        <circle cx="${x}" cy="27.6" r="2.1" fill="rgba(251,191,36,0.85)"/>
        <circle class="mp-glowsoft" cx="${x}" cy="27.6" r="5" fill="rgba(251,191,36,0.18)"/>
    </g>`;
}

function mpCutRain() {
    const rnd = mpCutRng(17);
    let drops = '';
    for (let i = 0; i < 22; i++) {
        const x = (rnd() * 164 - 2).toFixed(1);
        drops += `<line class="mp-rain" x1="${x}" y1="-8" x2="${x}" y2="-2" style="animation-delay:-${(rnd() * 0.9).toFixed(2)}s"/>`;
    }
    return `<g>${drops}</g>`;
}

function mpCutStreet(action) {
    const scroll = action === 'walk' || action === 'walksad';
    const props = offset => `
        <g transform="translate(${offset},0)">
            <rect x="6" y="18" width="30" height="58" fill="#161022"/>
            <rect x="42" y="30" width="22" height="46" fill="#1b142b"/>
            <rect x="100" y="12" width="34" height="64" fill="#140f20"/>
            <rect x="140" y="34" width="26" height="42" fill="#191226"/>
            <rect x="12" y="26" width="3" height="4" fill="rgba(251,191,36,0.55)"/>
            <rect x="24" y="40" width="3" height="4" fill="rgba(251,191,36,0.35)"/>
            <rect x="108" y="24" width="3" height="4" fill="rgba(251,191,36,0.5)"/>
            <rect x="122" y="44" width="3" height="4" fill="rgba(251,191,36,0.3)"/>
            <rect x="148" y="52" width="3" height="4" fill="rgba(251,191,36,0.4)"/>
            ${mpCutLamp(72)}
            ${mpCutLamp(128)}
        </g>`;
    return `
        <rect x="0" y="0" width="160" height="76" fill="#191326"/>
        ${scroll ? `<g class="mp-scroll">${props(0)}${props(160)}</g>` : props(0)}
        <rect x="0" y="74" width="160" height="16" fill="#221b30"/>
        <rect x="0" y="74" width="160" height="1.2" fill="rgba(251,191,36,0.18)"/>
        ${action === 'walksad' ? mpCutRain() : ''}`;
}

function mpCutRoom() {
    return `
        <rect x="0" y="0" width="160" height="90" fill="#221913"/>
        <rect x="0" y="0" width="160" height="90" fill="rgba(0,0,0,0.25)"/>
        <rect x="20" y="16" width="26" height="24" fill="#0e1626"/>
        <rect x="19" y="15" width="28" height="26" fill="none" stroke="#3d2c1e" stroke-width="1.6"/>
        <line x1="33" y1="15" x2="33" y2="41" stroke="#3d2c1e" stroke-width="1.2"/>
        <circle cx="27" cy="24" r="3.4" fill="rgba(226,232,240,0.5)"/>
        <polygon points="20,41 46,41 58,90 8,90" fill="rgba(226,232,240,0.05)"/>
        <rect x="96" y="30" width="14" height="10" fill="#2c1f16" stroke="#4a3524" stroke-width="0.8"/>
        <rect x="99" y="33" width="8" height="4" fill="rgba(251,191,36,0.25)"/>
        <rect x="60" y="66" width="86" height="5" fill="#3a2417"/>
        <rect x="64" y="71" width="4" height="12" fill="#2c1b10"/>
        <rect x="138" y="71" width="4" height="12" fill="#2c1b10"/>
        <rect x="60" y="62" width="86" height="6" rx="2" fill="#4a2f1c"/>`;
}

function mpCutClub() {
    let lockers = '';
    for (let i = 0; i < 6; i++) {
        const x = 8 + i * 11;
        lockers += `<rect x="${x}" y="26" width="9.4" height="40" rx="0.8" fill="${i % 2 ? '#132036' : '#16253e'}" stroke="#0b1424" stroke-width="0.5"/>
        <line x1="${x + 2}" y1="30" x2="${x + 7.4}" y2="30" stroke="#0b1424" stroke-width="0.7"/>
        <line x1="${x + 2}" y1="32.4" x2="${x + 7.4}" y2="32.4" stroke="#0b1424" stroke-width="0.7"/>`;
    }
    return `
        <rect x="0" y="0" width="160" height="90" fill="#0e1830"/>
        ${lockers}
        <circle class="mp-glowsoft" cx="80" cy="10" r="9" fill="rgba(226,232,240,0.10)"/>
        <rect x="72" y="4" width="16" height="2.4" rx="1" fill="#0a1220"/>
        <path d="M30,30 l4,-2 4,2 0,9 -3,0 0,6 -2,0 0,-6 -3,0 Z" fill="rgba(52,211,153,0.5)"/>
        <rect x="0" y="74" width="160" height="16" fill="#131f38"/>
        <rect x="8" y="68" width="52" height="3" rx="1.2" fill="#2e4470"/>
        <rect x="10" y="71" width="3" height="5" fill="#1a2740"/>
        <rect x="55" y="71" width="3" height="5" fill="#1a2740"/>`;
}

function mpCutStadium() {
    const rows = [[16, 10], [22, 12], [28, 14]];
    let tiers = '';
    rows.forEach(([y, count], r) => {
        for (let i = 0; i < count; i++) {
            tiers += `<circle class="mp-crowddot" cx="${(i * 12 + (r % 2) * 6) % 162}" cy="${y + (i % 3)}" r="0.8" fill="rgba(226,232,240,${0.12 + (i % 4) * 0.05})" style="animation-delay:-${((i * 0.37 + r) % 3).toFixed(2)}s"/>`;
        }
    });
    return `
        <rect x="0" y="0" width="160" height="44" fill="#0a1526"/>
        <polygon points="0,44 160,44 160,20 0,26" fill="#0d1c33"/>
        ${tiers}
        <g class="mp-flood">
            <rect x="18" y="2" width="1.4" height="18" fill="#060d1a"/>
            <rect x="13" y="0" width="11" height="3.4" rx="1" fill="#12233c"/>
            <circle cx="18.5" cy="5" r="7" fill="rgba(226,232,240,0.14)"/>
            <rect x="140" y="2" width="1.4" height="18" fill="#060d1a"/>
            <rect x="135" y="0" width="11" height="3.4" rx="1" fill="#12233c"/>
            <circle cx="140.5" cy="5" r="7" fill="rgba(226,232,240,0.14)"/>
        </g>
        <rect x="0" y="44" width="160" height="46" fill="#0d3a2d"/>
        <polygon points="0,44 160,44 160,50 0,48" fill="#123f31"/>
        <rect x="0" y="88" width="160" height="2" fill="#062b21"/>`;
}

// Matchday: inside the players' tunnel, side on. The far wall runs left to
// right and the corridor opens at the right-hand end onto the floodlit pitch,
// so it is obvious where the walk leads. The dressing room door is behind them.
function mpCutTunnel() {
    let panels = '';
    for (let i = 0; i < 5; i++) {
        const x = 6 + i * 24;
        panels += `<rect x="${x}" y="20" width="22" height="38" fill="${i % 2 ? '#151f33' : '#18243a'}"/>
            <line x1="${x + 22}" y1="20" x2="${x + 22}" y2="58" stroke="#0d1526" stroke-width="0.6"/>`;
    }
    let lights = '';
    for (let i = 0; i < 5; i++) {
        const x = 12 + i * 23;
        const w = 15 - i * 1.1;
        lights += `<rect x="${x}" y="15.4" width="${w.toFixed(1)}" height="1.5" rx="0.75" fill="#e2e8f0" opacity="0.8"/>
            <polygon points="${x},17 ${(x + w).toFixed(1)},17 ${(x + w + 4).toFixed(1)},58 ${(x - 4).toFixed(1)},58" fill="rgba(226,232,240,0.045)"/>`;
    }
    return `
        <rect x="0" y="0" width="160" height="90" fill="#0b1220"/>
        <rect x="0" y="0" width="160" height="16" fill="#0a1020"/>
        <rect x="0" y="16" width="160" height="1.4" fill="#1d2a42"/>
        ${panels}
        <rect x="0" y="58" width="126" height="16" fill="#101a2c"/>
        <rect x="0" y="57.4" width="126" height="1.2" fill="#25344f"/>
        <rect x="0" y="46" width="126" height="1.1" rx="0.55" fill="#2b3c5a"/>
        ${lights}
        <rect x="8" y="26" width="17" height="32" rx="0.6" fill="#0a1120"/>
        <rect x="9.4" y="27.4" width="14.2" height="29.2" fill="#132038"/>
        <circle cx="22" cy="43" r="0.7" fill="#4b5f80"/>
        <path d="M40,28 l7,-3 7,3 0,11 -7,5 -7,-5 Z" fill="#10203a" stroke="rgba(52,211,153,0.45)" stroke-width="0.7"/>
        <path d="M44,32 l3,-1.4 3,1.4 0,5 -3,2.2 -3,-2.2 Z" fill="rgba(52,211,153,0.35)"/>
        <rect x="0" y="74" width="160" height="16" fill="#161e2e"/>
        <rect x="0" y="74" width="160" height="1.2" fill="#243350"/>
        <rect x="0" y="81" width="126" height="0.8" fill="rgba(226,232,240,0.07)"/>
        <!-- the corridor mouth: jamb, then the pitch and stands beyond it -->
        <rect x="122" y="16" width="5" height="62" fill="#070d18"/>
        <rect x="127" y="16" width="33" height="44" fill="#0d1c33"/>
        ${mpCutCrowd(24, 4, 9)}
        <rect x="127" y="56" width="33" height="18" fill="#12503c"/>
        <polygon points="127,56 160,56 160,60 127,58" fill="#176048"/>
        <rect x="127" y="74" width="33" height="16" fill="#1a6b4f"/>
        <rect class="mp-tunglow" x="127" y="16" width="33" height="74" fill="rgba(226,232,240,0.16)"/>
        <polygon points="127,58 160,58 160,90 96,90" fill="rgba(226,232,240,0.10)"/>
        <polygon points="127,74 160,74 160,90 84,90" fill="rgba(226,232,240,0.13)"/>`;
}

function mpCutBackdrop(art, action) {
    if (art === 'pitch') return mpCutPitch();
    if (art === 'sky') return mpCutSky();
    if (art === 'street') return mpCutStreet(action);
    if (art === 'room') return mpCutRoom();
    if (art === 'club') return mpCutClub();
    if (art === 'tunnel') return mpCutTunnel();
    return mpCutStadium();
}

// Faces are drawn in head-local coordinates: skull centre (0.3,-5.6) r4.1,
// actor facing +x, so the nose-side eye is the right-hand one.
const MP_CUT_FACES = {
    joy: { eyes: 'open', brows: 'lift', mouth: 'M0.7,-3.9 Q2.3,-2.35 3.9,-3.9' },
    smile: { eyes: 'open', brows: 'none', mouth: 'M1.2,-3.7 Q2.3,-2.95 3.4,-3.7' },
    flat: { eyes: 'open', brows: 'none', mouth: 'M1.4,-3.5 L3.2,-3.5' },
    focused: { eyes: 'narrow', brows: 'draw', mouth: 'M1.5,-3.45 L3.1,-3.6' },
    tense: { eyes: 'open', brows: 'draw', mouth: 'M1.4,-3.25 Q2.3,-3.9 3.2,-3.3' },
    sad: { eyes: 'open', brows: 'worry', mouth: 'M1.3,-3.15 Q2.3,-3.95 3.3,-3.15' },
    cry: { eyes: 'narrow', brows: 'worry', mouth: 'M1.3,-3.1 Q2.3,-4.0 3.3,-3.1', tears: true },
    surprise: { eyes: 'wide', brows: 'raise', mouth: 'gape' },
    sleep: { eyes: 'shut', brows: 'none', mouth: 'M1.6,-3.4 Q2.3,-3.05 3.0,-3.4' }
};

const MP_CUT_EYES = {
    open: `<circle cx="0.85" cy="-5.0" r="0.5" fill="#1b1410"/><circle cx="2.55" cy="-4.9" r="0.5" fill="#1b1410"/>`,
    narrow: `<path d="M0.35,-5.05 L1.35,-5.0 M2.05,-4.95 L3.05,-4.9" fill="none" stroke="#1b1410" stroke-width="0.55" stroke-linecap="round"/>`,
    wide: `<ellipse cx="0.85" cy="-5.05" rx="0.62" ry="0.76" fill="#f4f1ea"/><circle cx="0.98" cy="-5.0" r="0.36" fill="#1b1410"/>
        <ellipse cx="2.6" cy="-4.95" rx="0.62" ry="0.76" fill="#f4f1ea"/><circle cx="2.73" cy="-4.9" r="0.36" fill="#1b1410"/>`,
    shut: `<path d="M0.3,-5.15 Q0.85,-4.62 1.4,-5.1 M2.0,-5.1 Q2.55,-4.58 3.1,-5.05" fill="none" stroke="#1b1410" stroke-width="0.34" stroke-linecap="round"/>`
};

const MP_CUT_BROWS = {
    none: '',
    lift: `<path d="M0.25,-6.3 Q0.85,-6.62 1.45,-6.3 M2.0,-6.26 Q2.6,-6.58 3.2,-6.26" fill="none" stroke="#241b12" stroke-width="0.3" stroke-linecap="round"/>`,
    raise: `<path d="M0.2,-6.55 Q0.85,-6.98 1.5,-6.55 M1.95,-6.5 Q2.6,-6.93 3.25,-6.5" fill="none" stroke="#241b12" stroke-width="0.3" stroke-linecap="round"/>`,
    draw: `<path d="M0.25,-6.4 L1.45,-6.0 M1.95,-5.94 L3.15,-6.24" fill="none" stroke="#241b12" stroke-width="0.34" stroke-linecap="round"/>`,
    worry: `<path d="M0.25,-6.02 L1.4,-6.34 M2.0,-6.38 L3.15,-6.06" fill="none" stroke="#241b12" stroke-width="0.32" stroke-linecap="round"/>`
};

function mpCutFace(mood) {
    const f = MP_CUT_FACES[mood] || MP_CUT_FACES.flat;
    const mouth = f.mouth === 'gape'
        ? `<ellipse class="mp-a-mouth mp-a-mouth--rest" cx="2.3" cy="-3.4" rx="0.6" ry="0.78" fill="#5d2f23"/>`
        : `<path class="mp-a-mouth-line" d="${f.mouth}" fill="none" stroke="#7a4232" stroke-width="0.34" stroke-linecap="round"/>
           <ellipse class="mp-a-mouth" cx="2.3" cy="-3.5" rx="0.72" ry="0.5" fill="#5d2f23"/>`;
    const tears = f.tears ? `<path class="mp-tear" d="M1.0,-4.3 C1.45,-3.75 1.5,-3.35 1.0,-3.15 C0.5,-3.35 0.55,-3.75 1.0,-4.3 Z" fill="rgba(191,219,254,0.9)"/>` : '';
    return `${MP_CUT_EYES[f.eyes]}${MP_CUT_BROWS[f.brows]}${mouth}${tears}`;
}

// Match beats only: beads welling at the brow and temple, then running down.
function mpCutSweat() {
    const drop = (x, y, delay) => `<g transform="translate(${x},${y})"><path class="mp-sweat__drop" style="animation-delay:${delay}s" d="M0,-0.85 C0.5,-0.2 0.55,0.3 0,0.68 C-0.55,0.3 -0.5,-0.2 0,-0.85 Z" fill="rgba(226,232,240,0.92)"/></g>`;
    return `<g class="mp-sweat">
        <path d="M-2.9,-7.2 Q0.3,-8.1 3.3,-7.0" fill="none" stroke="rgba(248,250,252,0.22)" stroke-width="0.7" stroke-linecap="round"/>
        ${drop(3.7, -6.3, -0.15)}
        ${drop(-2.9, -5.6, -0.95)}
        ${drop(3.2, -8.0, -1.6)}
    </g>`;
}

function mpCutHead(o) {
    const skin = o.skin || '#c98e63';
    const skinD = o.skinD || '#a06f4b';
    return `
        <rect x="-1.15" y="-3.2" width="2.3" height="3.5" fill="${skinD}"/>
        <circle cx="0.3" cy="-5.6" r="4.1" fill="${skin}"/>
        <circle cx="-3.5" cy="-4.8" r="0.72" fill="${skinD}"/>
        <path d="M-3.79,-5.3 A4.1,4.1 0 1 1 4.39,-5.3 Q0.3,-6.6 -3.79,-5.3 Z" fill="${o.hair || '#241b12'}"/>
        ${mpCutFace(o.mood)}
        ${o.sweat ? mpCutSweat() : ''}`;
}

// The articulated player model. Every joint group pivots on its own local
// (0,0): the stylesheet pairs transform-origin:0 0 with transform-box:view-box.
// A fill-box origin would not work here — a group's fill-box encloses its
// animated children, so the hip and shoulder would slide as the knee and elbow
// bend, tearing the limbs off the body.
function mpCutRig(mod, o) {
    const kit = o.kit || '#10b981';
    const kit2 = o.kit2 || '#0b3b2e';
    const skin = o.skin || '#c98e63';
    const skinD = o.skinD || '#a06f4b';
    const coat = o.coat || kit;
    const sleeve = o.coat ? coat : (o.sleeve || kit);
    const trousers = o.legs || null;

    // Hip is the group origin; knee sits at (0.2,9.3). The shorts sleeve lives
    // inside the thigh so it swings with the leg, and the pelvis yoke drawn later
    // on the torso hides the seam at the hip.
    const leg = (near) => {
        const thighFill = trousers || (near ? skin : skinD);
        const shinFill = trousers || (near ? skin : skinD);
        return `
            <path d="M-1.8,0 C-2.2,4 -1.8,7.4 -1.2,9.4 L1.7,9.2 C2,6.6 2,3.2 1.8,0 Z" fill="${thighFill}"/>
            ${trousers ? '' : `<path d="M-2.3,-1.4 C-2.6,1.6 -2.5,3.8 -2.2,5.4 L2.3,5.3 C2.6,3.5 2.6,1.4 2.4,-1.4 Z" fill="${kit2}"/>`}
            <g transform="translate(0.2,9.3)"><g class="mp-a-shin">
                <circle cx="0" cy="0.2" r="1.5" fill="${shinFill}"/>
                <path d="M-1.6,0 C-1.9,3.4 -1.5,6.2 -1,7.8 L1.5,7.8 C1.8,5.6 1.8,2.6 1.6,0 Z" fill="${shinFill}"/>
                ${trousers ? `<path d="M-1.7,4.4 L1.7,4.4 L1.6,7.9 L-1.5,7.9 Z" fill="${trousers}"/>`
                    : `<path d="M-1.65,3.0 L1.7,3.0 L1.55,7.9 L-1.45,7.9 Z" fill="${near ? kit : kit2}"/>
                       <path d="M-1.65,3.0 L1.7,3.0 L1.68,3.9 L-1.62,3.9 Z" fill="rgba(248,250,252,0.55)"/>`}
                <path d="M-1.7,7.2 L1.6,7.2 L2.9,10.4 Q3.0,10.9 2.4,10.9 L-2.4,10.9 Q-2.9,10.9 -2.8,10.4 Z" fill="#0f1115"/>
            </g></g>`;
    };

    // Shoulder is the group origin; elbow sits at (0.5,8). A short sleeve leaves
    // the forearm bare, which is what reads as a footballer rather than a coat.
    const arm = (near) => {
        const skinFill = near ? skin : skinD;
        return `
            <path d="M-1.3,0 C-1.7,3.2 -1.5,6 -0.6,8.2 L1.7,7.8 C1.4,5.4 1.3,2.6 1.3,0 Z" fill="${o.coat ? sleeve : skinFill}"/>
            ${o.coat ? '' : `<path d="M-1.45,3.9 L1.4,3.9 L1.7,7.9 L-0.6,8.3 Z" fill="${skinFill}"/>`}
            <path d="M-1.9,-0.9 C-2.3,1.6 -2.2,3.4 -1.9,4.5 L1.9,4.4 C2.2,3.2 2.2,1.2 1.9,-0.9 Q0,-1.9 -1.9,-0.9 Z" fill="${sleeve}"/>
            <circle cx="0.1" cy="0.2" r="1.7" fill="${sleeve}"/>
            <g transform="translate(0.5,8)"><g class="mp-a-fore">
                <circle cx="0" cy="0.1" r="1.25" fill="${o.coat ? sleeve : skinFill}"/>
                <path d="M-1.2,0 C-1.5,2.8 -1.3,5 -0.7,6.6 L1.4,6.4 C1.2,4.6 1.2,2.2 1.2,0 Z" fill="${o.coat ? sleeve : skinFill}"/>
                <circle class="mp-a-hand" cx="0.2" cy="7.7" r="1.4" fill="${skinFill}"/>
                ${near && o.hold === 'scroll' ? `<g transform="translate(0.2,7.7) rotate(-24)">
                    <rect x="-2.8" y="-0.8" width="5.6" height="1.6" rx="0.8" fill="#f8fafc"/>
                    <rect x="1.1" y="-1.0" width="1.7" height="2" rx="0.35" fill="#b45309"/>
                </g>` : ''}
            </g></g>`;
    };

    return `
    <ellipse class="mp-a-shadow" cx="0" cy="21.2" rx="8.5" ry="1.7" fill="rgba(0,0,0,0.4)"/>
    <g class="mp-actor ${mod}${o.dark ? ' mp-actor--dark' : ''}">
        <g transform="translate(-2.6,1)"><g class="mp-a-leg mp-a-leg--b">${leg(false)}</g></g>
        <g transform="translate(2.6,1)"><g class="mp-a-leg mp-a-leg--f">${leg(true)}</g></g>
        <g class="mp-a-torso">
            <path d="M-4.6,2 C-5.4,-6 -5.2,-13 -4,-16.6 C-1.8,-17.8 1.8,-17.8 4,-16.6 C5.2,-13 5.4,-6 4.6,2 Z" fill="${coat}"/>
            <path d="M2.6,-16.9 C4.4,-13.4 4.9,-6 4.2,2 L4.6,2 C5.4,-6 5.2,-13 4,-16.6 Z" fill="rgba(0,0,0,0.16)"/>
            <path d="M-1.9,-17.2 Q0,-15.5 1.9,-17.2 Q0,-16.4 -1.9,-17.2 Z" fill="${kit2}"/>
            ${trousers ? `<path d="M-4.9,0.2 L4.9,0.2 L4.7,4.4 L-4.7,4.4 Z" fill="${trousers}"/>`
                : `<path d="M-5.1,-0.6 Q0,-1.6 5.1,-0.6 L4.8,4.9 Q0,5.9 -4.8,4.9 Z" fill="${kit2}"/>`}
            ${o.coat ? `<path d="M-1.4,-16.5 L2.4,-16.5 L0.5,-10.8 Z" fill="#e2e8f0"/><path d="M0.1,-16.1 L1.5,-15.7 L1,-11.4 L-0.2,-11.8 Z" fill="#7f2d2d"/>` : ''}
            <g transform="translate(-4.4,-14.6)"><g class="mp-a-arm mp-a-arm--b">${arm(false)}</g></g>
            <g transform="translate(0,-16.8)"><g class="mp-a-head">${mpCutHead({ skin, skinD, mood: o.mood, sweat: o.sweat })}</g></g>
            <g transform="translate(4.4,-14.6)"><g class="mp-a-arm mp-a-arm--f">${arm(true)}</g></g>
        </g>
    </g>`;
}

function mpCutBall(x, y) {
    return `<g transform="translate(${x},${y})"><g class="mp-ball"><g class="mp-ball-spin">
        <circle r="2.1" fill="#f8fafc"/>
        <path d="M0,-0.95 L0.9,-0.29 L0.55,0.77 L-0.55,0.77 L-0.9,-0.29 Z" fill="#334155"/>
        <path d="M-1.95,-0.62 L-1.32,-0.98 L-0.98,-0.3 L-1.66,0.12 Z" fill="#334155"/>
        <path d="M1.95,-0.62 L1.32,-0.98 L0.98,-0.3 L1.66,0.12 Z" fill="#334155"/>
        <path d="M-0.6,1.62 L0.6,1.62 L0.34,2.05 L-0.34,2.05 Z" fill="#334155"/>
        <path d="M0.9,1.9 A2.1,2.1 0 0 0 2.05,0.3 L1.55,0.25 A1.6,1.6 0 0 1 0.68,1.44 Z" fill="rgba(15,23,42,0.12)"/>
    </g></g></g>`;
}

function mpCutConfetti() {
    const colors = ['#f59e0b', '#34d399', '#60a5fa', '#f472b6', '#e2e8f0'];
    const rnd = mpCutRng(29);
    let out = '';
    for (let i = 0; i < 16; i++) {
        const x = (rnd() * 156 + 2).toFixed(1);
        out += `<rect class="mp-cfp" x="${x}" y="-4" width="1.6" height="2.6" fill="${colors[i % colors.length]}" style="animation-delay:-${(rnd() * 1.7).toFixed(2)}s;animation-duration:${(1.4 + rnd() * 0.9).toFixed(2)}s"/>`;
    }
    return `<g>${out}</g>`;
}

function mpCutStreaks() {
    return `<g class="mp-streak">
        <line x1="44" y1="48" x2="52" y2="48" style="animation-delay:-.2s"/>
        <line x1="40" y1="56" x2="50" y2="56" style="animation-delay:-.55s"/>
        <line x1="46" y1="64" x2="54" y2="64" style="animation-delay:-.75s"/>
    </g>`;
}

// Debut: photographers' flashes popping in the stands.
function mpCutFlashes() {
    return `<g>
        <circle class="mp-flashdot" cx="30" cy="26" r="1.1" fill="#f8fafc" style="animation-delay:-.3s"/>
        <circle class="mp-flashdot" cx="74" cy="30" r="0.9" fill="#f8fafc" style="animation-delay:-1.1s"/>
        <circle class="mp-flashdot" cx="112" cy="24" r="1.2" fill="#f8fafc" style="animation-delay:-1.7s"/>
        <circle class="mp-flashdot" cx="142" cy="31" r="0.9" fill="#f8fafc" style="animation-delay:-.7s"/>
        <circle class="mp-flashdot" cx="52" cy="22" r="0.8" fill="#f8fafc" style="animation-delay:-2.2s"/>
        <circle class="mp-flashdot" cx="94" cy="27" r="1" fill="#f8fafc" style="animation-delay:-2.6s"/>
    </g>`;
}

// Keeper: a smaller, mirrored rig in keeper colours standing on the given
// ground line. `commit` sends him off his line at the ball (the 2v1 scenes);
// without it he holds his ready set in the goalmouth (the Strike).
function mpCutKeeper(x, groundY, commit) {
    const s = 0.8;
    const y = groundY - 21.2 * s;
    const KEEPER = { kit: '#eab308', kit2: '#713f12', sleeve: '#eab308', legs: '#111827', mood: 'tense' };
    return `<g transform="translate(${x},${y.toFixed(2)}) scale(${-s},${s})">`
        + mpCutRig('mp-actor--keeper' + (commit ? ' mp-actor--commit' : ''), KEEPER) + `</g>`;
}

// Leaflet: a club stand with flyers to take one from.
function mpCutLeafletStand() {
    return `<g>
        <rect x="100.6" y="50" width="1.2" height="27.5" fill="#3a2a1a"/>
        <rect x="96.4" y="45.4" width="9.6" height="1.1" rx="0.5" fill="#5b3a26"/>
        <rect x="96.4" y="46.5" width="9.6" height="5.2" rx="0.6" fill="#4a3524"/>
        <rect x="97.3" y="47.4" width="3.5" height="2.7" rx="0.3" fill="#e8e2d4"/>
    </g>`;
}

// Loan: the holdall the player arrives with at his new club.
function mpCutKitBag() {
    return `<g>
        <rect x="50" y="72.6" width="9.4" height="5" rx="1.6" fill="#1f2937"/>
        <rect x="52.8" y="71.2" width="3.8" height="1.8" rx="0.9" fill="#111827"/>
        <path d="M52.2,72.8 Q54.7,69.6 57.2,72.8" fill="none" stroke="#111827" stroke-width="0.8"/>
        <ellipse cx="54.7" cy="77.8" rx="5.4" ry="0.7" fill="rgba(0,0,0,0.35)"/>
    </g>`;
}

// Dinner and the Ceiling: asleep on his back, side on. The head is the normal
// rig head rotated a quarter turn so the face points at the ceiling, the duvet
// carries the shape of the body under it, and only the duvet breathes.
function mpCutLyingFigure() {
    return `
        <g class="mp-actor--hero">
            <path d="M60,62.6 Q59.5,58.4 67,58.2 Q75,58 75.5,62.6 Z" fill="#e2ded4"/>
            <path d="M62,62.6 Q64,60.4 69,60.2" fill="none" stroke="rgba(0,0,0,0.10)" stroke-width="0.6"/>
            <g transform="translate(73,56) rotate(-90)"><g class="mp-a-head">${mpCutHead({ mood: 'sleep' })}</g></g>
            <g class="mp-breathe">
                <path d="M74,62.6 C74,56.4 78,53.6 85,54 C93,54.4 98,57 106,57.4 C116,57.9 124,58.8 131,59.8 C134,60.2 136,58.4 139,58.6 C142,58.8 143.5,61 143.5,62.6 Z" fill="#3b4a63"/>
                <path d="M85,54 C93,54.4 98,57 106,57.4 C116,57.9 124,58.8 131,59.8 L131,61 C123,59.8 114,59 105,58.6 C97,58.2 91,56 84,55.6 Z" fill="rgba(248,250,252,0.10)"/>
                <path d="M100,57.2 Q101,60 100.6,62.6" fill="none" stroke="rgba(0,0,0,0.16)" stroke-width="0.7"/>
                <path d="M119,58.6 Q120,60.6 119.6,62.6" fill="none" stroke="rgba(0,0,0,0.14)" stroke-width="0.7"/>
            </g>
            <g transform="rotate(-6 85.5 57.2)">
                <rect x="82" y="55" width="7" height="4.4" rx="0.5" fill="#f1f5f9"/>
                <rect x="83.2" y="56" width="4.6" height="0.6" fill="#b45309" opacity="0.7"/>
                <rect x="83.2" y="57.2" width="3.4" height="0.5" fill="#b45309" opacity="0.5"/>
            </g>
            <path d="M76,54.6 C82,54.4 87,55.6 90,56.8 L89.4,58.8 C85,57.6 80,56.8 75.6,57.2 Z" fill="#c98e63"/>
            <circle cx="90.4" cy="57.8" r="1.5" fill="#c98e63"/>
            <path d="M73.6,54.2 Q77.6,53.2 79.4,54.8 L78.8,57.8 Q76,57.6 74,57.4 Z" fill="#2e3d55"/>
        </g>`;
}

// Contract: a desk between the player and the club official. The player sits
// behind it with his legs under the top, so the desk reads as furniture in
// front of a whole body rather than a torso floating over an empty gap.
function mpCutSignDesk() {
    return `
        <rect x="62" y="57" width="56" height="3.2" rx="1" fill="#3a2a1a"/>
        <rect x="62" y="57" width="56" height="1" rx="0.5" fill="#4d3823"/>
        <rect x="65" y="60.2" width="3.6" height="18.8" fill="#2b1f13"/>
        <rect x="111" y="60.2" width="3.6" height="18.8" fill="#2b1f13"/>
        <g transform="rotate(-2 89 55.6)">
            <rect x="82" y="53.2" width="14" height="5.6" rx="0.4" fill="#f8fafc"/>
            <line x1="84" y1="54.6" x2="94" y2="54.6" stroke="#94a3b8" stroke-width="0.3"/>
            <line x1="84" y1="55.7" x2="94" y2="55.7" stroke="#94a3b8" stroke-width="0.3"/>
            <path d="M84.5,57.1 q1.6,-1.1 3.2,0 q1.6,1.1 3.2,0" fill="none" stroke="#334155" stroke-width="0.4"/>
        </g>`;
}

function mpCutSeatedLegs(x, y, near) {
    const trouser = near ? '#1f2a3c' : '#18222f';
    return `<g transform="translate(${x},${y})">
        <path d="M-3.5,-2.2 Q3,-2.6 9,-1.4 L9.6,3.2 Q3,3.6 -3.5,2.8 Z" fill="${trouser}"/>
        <path d="M6.4,1.6 L10.2,1.6 L10.8,14.4 L7,14.4 Z" fill="${trouser}"/>
        <path d="M6.6,14 L11,14 L14.4,16.4 Q14.8,17 14,17 L6.4,17 Q5.8,17 5.9,16.4 Z" fill="#0f1115"/>
    </g>`;
}

function mpCutSeatedWriter() {
    const upper = `
        <path d="M-1.3,0 C-1.7,3.2 -1.5,6 -0.6,8.2 L1.7,7.8 C1.4,5.4 1.3,2.6 1.3,0 Z" fill="#2e3d55"/>
        <circle cx="0.1" cy="0.2" r="1.7" fill="#2e3d55"/>`;
    return `
        <g class="mp-actor--hero">
            <rect x="63.6" y="45" width="3.4" height="19.6" rx="1.2" fill="#243349"/>
            <rect x="63.6" y="62.6" width="16.4" height="3" rx="1.2" fill="#2b3648"/>
            <rect x="65" y="65.6" width="2.6" height="13.4" fill="#1a2740"/>
            <rect x="76.4" y="65.6" width="2.6" height="13.4" fill="#1a2740"/>
            ${mpCutSeatedLegs(70, 63, false)}
            ${mpCutSeatedLegs(74, 63, true)}
            <g transform="translate(72,63) rotate(8)"><g class="mp-a-torso">
                <path d="M-4.6,2 C-5.4,-6 -5.2,-13 -4,-16.6 C-1.8,-17.8 1.8,-17.8 4,-16.6 C5.2,-13 5.4,-6 4.6,2 Z" fill="#2e3d55"/>
                <path d="M-1.9,-17.2 Q0,-15.5 1.9,-17.2 Q0,-16.4 -1.9,-17.2 Z" fill="#1f2a3c"/>
                <g transform="translate(-4.4,-14.6)"><g class="mp-a-arm mp-a-arm--b">${upper}
                    <g transform="translate(0.5,8)"><g class="mp-a-fore">
                        <path d="M-1.2,0 C-1.5,2.8 -1.3,5 -0.7,6.6 L1.4,6.4 C1.2,4.6 1.2,2.2 1.2,0 Z" fill="#2e3d55"/>
                        <circle cx="0.2" cy="7.7" r="1.4" fill="#a06f4b"/>
                    </g></g>
                </g></g>
                <g transform="translate(0,-16.8)"><g class="mp-a-head">${mpCutHead({ mood: 'focused' })}</g></g>
            </g></g>
            ${mpCutSignDesk()}
            <g transform="translate(72,63) rotate(8)"><g transform="translate(4.4,-14.6)"><g class="mp-a-arm mp-a-arm--f">${upper}
                <g transform="translate(0.5,8)"><g class="mp-a-fore mp-write-fore">
                    <path d="M-1.2,0 C-1.5,2.8 -1.3,5 -0.7,6.6 L1.4,6.4 C1.2,4.6 1.2,2.2 1.2,0 Z" fill="#2e3d55"/>
                    <circle cx="0.2" cy="7.7" r="1.4" fill="#c98e63"/>
                    <line x1="-1.04" y1="6.74" x2="2.9" y2="9.68" stroke="#e8e2d4" stroke-width="0.7" stroke-linecap="round"/>
                </g></g>
            </g></g></g>
        </g>`;
}

// Ten Matches: alone on the changing-room bench after the game, hunched
// forward over his knees with his hands hanging and his head down.
function mpCutSeatedSad() {
    const benchLeg = (dx, fill, sock) => `<g transform="translate(${dx},0)">
        <path d="M-2,65.6 Q4,65.2 10.4,66.6 L11,71 Q4,71.4 -2,70.8 Z" fill="${fill}"/>
        <path d="M7.6,69 L11.4,69 L12,79 L8.2,79 Z" fill="${fill}"/>
        <path d="M8,73 L11.7,73 L12,79 L8.3,79 Z" fill="${sock}"/>
        <path d="M7.8,78.6 L12.2,78.6 L15.6,80.6 Q16,81.2 15.2,81.2 L7.6,81.2 Q7,81.2 7.1,80.6 Z" fill="#0f1115"/>
    </g>`;
    const arm = (sleeveFill, skinFill) => `
        <path d="M-1.3,0 C-1.7,3.2 -1.5,6 -0.6,8.2 L1.7,7.8 C1.4,5.4 1.3,2.6 1.3,0 Z" fill="${skinFill}"/>
        <path d="M-1.9,-0.9 C-2.3,1.6 -2.2,3.4 -1.9,4.5 L1.9,4.4 C2.2,3.2 2.2,1.2 1.9,-0.9 Q0,-1.9 -1.9,-0.9 Z" fill="${sleeveFill}"/>
        <circle cx="0.1" cy="0.2" r="1.7" fill="${sleeveFill}"/>
        <g transform="translate(0.5,8)"><g class="mp-a-fore">
            <path d="M-1.2,0 C-1.5,2.8 -1.3,5 -0.7,6.6 L1.4,6.4 C1.2,4.6 1.2,2.2 1.2,0 Z" fill="${skinFill}"/>
            <circle cx="0.2" cy="7.7" r="1.4" fill="${skinFill}"/>
        </g></g>`;
    return `
        <g class="mp-actor--hero">
            <ellipse cx="42" cy="81.4" rx="12" ry="1.6" fill="rgba(0,0,0,0.35)"/>
            <g transform="translate(33,0)">
                ${benchLeg(-3, '#a06f4b', '#0b3b2e')}
                <path d="M-4.4,64.4 Q1,63.8 3.6,65.2 L4,71.8 Q-1,72 -4.6,71.2 Z" fill="#082f24"/>
                ${benchLeg(0, '#c98e63', '#10b981')}
                <path d="M-2.4,64.4 Q3,63.8 5.6,65.2 L6,71.8 Q1,72 -2.6,71.2 Z" fill="#0b3b2e"/>
            </g>
            <g transform="translate(36,68) rotate(30)"><g class="mp-a-torso">
                <path d="M-4.6,2 C-5.4,-6 -5.2,-13 -4,-16.6 C-1.8,-17.8 1.8,-17.8 4,-16.6 C5.2,-13 5.4,-6 4.6,2 Z" fill="#10b981"/>
                <path d="M-5.1,-0.6 Q0,-1.6 5.1,-0.6 L4.8,4.9 Q0,5.9 -4.8,4.9 Z" fill="#0b3b2e"/>
                <g transform="translate(-4.4,-14.6)"><g class="mp-a-arm mp-a-arm--b">${arm('#0d9668', '#a06f4b')}</g></g>
                <g transform="translate(0,-16.8)"><g class="mp-a-head">${mpCutHead({ mood: 'sad' })}</g></g>
                <g transform="translate(4.4,-14.6)"><g class="mp-a-arm mp-a-arm--f">${arm('#10b981', '#c98e63')}</g></g>
            </g></g>
        </g>`;
}

function mpCutActors(beat) {
    const action = beat.action;
    const title = beat.title || '';
    const mood = MP_CUT_MOOD[title] || 'flat';
    const otherMood = MP_CUT_OTHER_MOOD[title] || 'flat';
    const HERO = { kit: '#10b981', kit2: '#0b3b2e', mood, sweat: !!MP_CUT_SWEAT[title] };
    const LOAN = { kit: '#3b82f6', kit2: '#1e3a8a', sleeve: '#3b82f6', mood };   // loan hero wears the new club's colours
    const COAT = { coat: '#26334a', kit: '#26334a', kit2: '#1a2434', skin: '#b57f56', skinD: '#8f6242', legs: '#151d2c', mood: otherMood };
    const at = (x, rig, flip) => `<g transform="translate(${x},58)${flip ? ' scale(-1,1)' : ''}">${rig}</g>`;
    switch (action) {
        case 'dribble':
            if (title === 'One Chance') {
                // the 2v1 before the choice: keeper committed, teammate open behind him
                return at(68, mpCutRig('mp-actor--hero', HERO)) + mpCutBall(79, 78.6)
                    + mpCutKeeper(96, 74, true)
                    + at(112, mpCutRig('mp-actor--mate mp-actor--appeal', Object.assign({}, HERO, { mood: 'surprise' })));
            }
            return at(68, mpCutRig('mp-actor--hero', HERO)) + mpCutBall(79, 78.6);
        case 'run':
            if (title === 'The Loan') return at(64, mpCutRig('mp-actor--hero', LOAN)) + mpCutKitBag() + mpCutStreaks();
            if (title === 'The Debut') return at(64, mpCutRig('mp-actor--hero', HERO)) + mpCutStreaks() + mpCutFlashes();
            return at(64, mpCutRig('mp-actor--hero', HERO)) + mpCutStreaks();
        case 'kickpass':
            if (title === 'The Square Ball') {
                // keeper beaten off his line; the mate traps the square ball then
                // swings it over the bar into the trees
                return at(70, mpCutRig('mp-actor--hero', HERO)) + mpCutBall(77, 76.5)
                    + mpCutKeeper(96, 74, true)
                    + at(114, mpCutRig('mp-actor--mate', Object.assign({}, HERO, { mood: 'surprise' })));
            }
            return at(70, mpCutRig('mp-actor--hero', HERO)) + mpCutBall(77, 76.5);
        case 'strike':
            return at(70, mpCutRig('mp-actor--hero', HERO)) + mpCutBall(77, 76.5)
                + mpCutKeeper(137, 68, false)
                + `<rect class="mp-flash" x="0" y="0" width="160" height="90" fill="#f8fafc"/>`;
        case 'skygaze':
            return at(80, mpCutRig('mp-actor--hero', HERO));
        case 'celebrate':
            return at(80, mpCutRig('mp-actor--hero', HERO)) + mpCutConfetti();
        case 'walk':
        case 'walksad':
            if (title === 'Graduation Day') {
                // diploma scroll gripped in the front hand, swings with it
                return at(76, mpCutRig('mp-actor--hero', Object.assign({}, HERO, { hold: 'scroll' })));
            }
            return at(76, mpCutRig('mp-actor--hero', HERO));
        case 'leaflet':
            return at(86, mpCutRig('mp-actor--hero', HERO)) + mpCutLeafletStand() + `<g transform="translate(103.2,48.7)"><g class="mp-leaflet">
                <rect x="-3" y="-2" width="6" height="4" rx="0.4" fill="#e8e2d4"/>
                <rect x="-2.2" y="-1" width="4.4" height="0.7" fill="#b45309"/>
                <rect x="-2.2" y="0.4" width="3.2" height="0.5" fill="#b45309"/>
            </g></g>`;
        case 'talk':
            return at(64, mpCutRig('mp-actor--hero', HERO)) + at(100, mpCutRig('mp-actor--other', COAT), true);
        case 'handshake':
            // 66 and 96 place the two front shoulders 21.2 apart; the posed arms
            // reach in so the characters' own round hands meet and touch.
            return at(66, mpCutRig('mp-actor--hero', HERO))
                + at(96, mpCutRig('mp-actor--other', COAT), true);
        case 'sign':
            // club official waits across the desk while the contract is signed
            return at(128, mpCutRig('mp-actor--other', COAT), true) + mpCutSeatedWriter();
        case 'sit':
            return mpCutSeatedSad();
        case 'bed':
            return mpCutLyingFigure();
        case 'tunnel':
            // a teammate already ahead of him, silhouetted against the pitch light
            return at(76, mpCutRig('mp-actor--hero', HERO))
                + `<g transform="translate(106,60.2) scale(0.9)">${mpCutRig('mp-actor--dark', Object.assign({ dark: true, mood: 'flat' }, HERO))}</g>`;
        default:
            return at(80, mpCutRig('mp-actor--hero', HERO));
    }
}

function mpCutSceneSvg(beat) {
    return `<svg class="mp-cut__svg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${mpCutBackdrop(beat.art, beat.action)}${mpCutActors(beat)}</svg>`;
}

function mpCutBeats(list, career) {
    return (list || []).map(scene => ({
        act: scene.act,
        title: scene.title,
        art: mpCutArt(scene),
        action: mpCutAction(scene),
        lines: typeof scene.text === 'function' ? scene.text(career) : []
    }));
}

function mpCutStage() {
    return document.querySelector('#mp-story-panel .mp-cut');
}

function mpCutStop() {
    if (MP.cut.timer) clearTimeout(MP.cut.timer);
    if (MP.cut.lineTimer) clearTimeout(MP.cut.lineTimer);
    MP.cut.timer = null;
    MP.cut.lineTimer = null;
}

function mpCutTick() {
    MP.cut.timer = null;
    if (MP.cut.index + 1 < MP.cut.beats.length) {
        MP.cut.index++;
        mpCutShowBeat();
        return;
    }
    mpCutPhase(MP.cut.path ? 'done' : 'decide');
}

function mpCutShowBeat() {
    const stage = mpCutStage();
    const beat = MP.cut.beats[MP.cut.index];
    if (!stage || !beat) return;
    stage.dataset.art = beat.art;
    stage.dataset.act = beat.action;
    stage.dataset.cam = mpCutCam(beat, MP.cut.index);
    const film = stage.querySelector('.mp-cut__film');
    if (film) {
        film.classList.remove('is-in');
        film.innerHTML = mpCutSceneSvg(beat);
        void film.offsetWidth;
        film.classList.add('is-in');
    }
    MP.cut.line = 0;
    mpCutShowLine();
    if (MP.cut.timer) clearTimeout(MP.cut.timer);
    const hold = Math.max(2600, (beat.lines || []).length * MP_CUT_LINE_MS + 900);
    MP.cut.timer = setTimeout(mpCutTick, hold);
}

// Who owns a line: quoted lines are dialogue (the other character's in
// two-hander scenes, the hero's elsewhere), everything else is narration.
function mpCutSpeaker(beat, line) {
    if (line.indexOf('"') === -1) return 'narrator';
    const duo = beat.action === 'talk' || beat.action === 'handshake';
    return duo ? 'other' : 'hero';
}

function mpCutShowLine() {
    const stage = mpCutStage();
    if (!stage) return;
    const beat = MP.cut.beats[MP.cut.index];
    const lines = (beat && beat.lines) || [];
    const bubble = stage.querySelector('.mp-cut__bubble');
    if (MP.cut.line >= lines.length) {
        stage.classList.remove('is-talking');
        if (bubble) bubble.classList.remove('is-in');
        return;
    }
    const line = lines[MP.cut.line];
    const speaker = mpCutSpeaker(beat, line);
    stage.dataset.speaker = speaker;
    if (bubble) {
        const say = bubble.querySelector('.mp-cut__say');
        if (say) say.textContent = line;
        bubble.classList.remove('is-in');
        mpCutPlaceBubble(stage, speaker);
        void bubble.offsetWidth;
        bubble.classList.add('is-in');
    }
    stage.classList.toggle('is-talking', speaker === 'hero' || speaker === 'other');
    if (MP.cut.lineTimer) clearTimeout(MP.cut.lineTimer);
    MP.cut.lineTimer = setTimeout(() => {
        MP.cut.lineTimer = null;
        MP.cut.line++;
        mpCutShowLine();
    }, MP_CUT_LINE_MS);
}

// Dialogue comes from the character: anchor the bubble just above the
// speaker's head (screen coords already include the camera move). Narration
// stays as a centred caption with no tail.
function mpCutPlaceBubble(stage, speaker) {
    const bubble = stage.querySelector('.mp-cut__bubble');
    if (!bubble) return;
    bubble.style.left = '';
    bubble.style.right = '';
    bubble.style.bottom = '';
    bubble.classList.toggle('mp-cut__bubble--say', speaker === 'hero' || speaker === 'other');
    if (speaker !== 'hero' && speaker !== 'other') return;
    const say = bubble.querySelector('.mp-cut__say');
    const head = stage.querySelector(speaker === 'other'
        ? '.mp-actor--other .mp-a-head'
        : '.mp-actor--hero .mp-a-head')
        || stage.querySelector('.mp-actor--hero');
    const box = stage.getBoundingClientRect();
    if (!head || !box.width) return;
    if (say) {
        bubble.style.left = '0px';
        bubble.style.right = 'auto';
    }
    const w = say ? say.offsetWidth : 280;
    const r = head.getBoundingClientRect();
    const cx = r.left + r.width / 2 - box.left;
    bubble.style.left = Math.round(Math.min(Math.max(cx - w / 2, 18), Math.max(box.width - w - 18, 18))) + 'px';
    bubble.style.bottom = Math.round(Math.min(Math.max(box.bottom - r.top + 10, 90), box.height - 140)) + 'px';
}

// Tap anywhere on the film to skip: first the remaining lines of this beat,
// then the beat itself. Buttons keep working normally.
function mpCutTap(event) {
    if (event.target.closest && event.target.closest('button')) return;
    if (MP.cut.phase !== 'play') return;
    const beat = MP.cut.beats[MP.cut.index];
    if (!beat) return;
    if (MP.cut.line + 1 < (beat.lines || []).length) {
        if (MP.cut.lineTimer) clearTimeout(MP.cut.lineTimer);
        MP.cut.line++;
        mpCutShowLine();
        return;
    }
    if (MP.cut.timer) clearTimeout(MP.cut.timer);
    mpCutTick();
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
    const stage = mpCutStage();
    if (stage && phase !== 'play') {
        stage.classList.remove('is-talking');
        const bubble = stage.querySelector('.mp-cut__bubble');
        if (bubble) bubble.classList.remove('is-in');
    }
    const foot = document.querySelector('#mp-story-panel .mp-cut__foot');
    if (foot) foot.innerHTML = mpCutFootMarkup();
}

function mpCutPlay(beats, path) {
    mpCutStop();
    MP.cut.beats = beats;
    MP.cut.path = path;
    MP.cut.index = 0;
    MP.cut.line = 0;
    MP.cut.phase = 'play';
    mpCutPhase('play');
    mpCutShowBeat();
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
    const beats = decided
        ? mpCutBeats(MP_STORY[decided], career)
        : mpCutBeats(MP_STORY.intro, career);
    if (!beats.length) return;

    panel.innerHTML = `
        <div class="mp-cut" data-art="${mpEscAttr(beats[0].art)}" data-act="${mpEscAttr(beats[0].action)}" data-cam="in" data-speaker="hero" onclick="mpCutTap(event)">
            <div class="mp-cut__art" aria-hidden="true"></div>
            <div class="mp-cut__film" aria-hidden="true"></div>
            <div class="mp-cut__veil" aria-hidden="true"></div>
            <div class="mp-cut__bubble" aria-live="polite"><div class="mp-cut__say"></div></div>
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
    mpCutPlay(mpCutBeats(MP_STORY[path], MP.active), path);
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
