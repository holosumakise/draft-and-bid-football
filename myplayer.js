// ============================================================
// MY PLAYER — online, account-based career mode.
//
// The mode is deliberately self-contained: local/H2H/Tournament keep working
// without an account, while every My Player career lives under
// users/{uid}/myPlayers/{careerId} and is only readable by that account.
// ============================================================

const MP = {
    open: false,
    view: null,
    fb: null,
    auth: null,
    db: null,
    user: null,
    authBound: false,
    authReady: null,
    firstAuth: false,
    authMode: 'login',
    careers: [],
    active: null,
    draft: null,
    storyBusy: false,
    reelToken: 0,
    reelTimers: []
};

// ------------------------------------------------------------
// Pools used by the randomizer
// ------------------------------------------------------------

const MP_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

const MP_POSITION_LABELS = {
    GK: 'Goalkeeper',
    CB: 'Centre-back',
    LB: 'Left-back',
    RB: 'Right-back',
    LWB: 'Left wing-back',
    RWB: 'Right wing-back',
    CDM: 'Defensive mid',
    CM: 'Central mid',
    CAM: 'Attacking mid',
    LM: 'Left mid',
    RM: 'Right mid',
    LW: 'Left wing',
    RW: 'Right wing',
    CF: 'Centre-forward',
    ST: 'Striker'
};

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

// Countries and football nations. This is intentionally broad so the
// Nationality reel really can land anywhere in the world.
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

// A value safe to drop straight into an inline handler as a JS string literal:
// JSON.stringify handles quotes/backslashes, then the HTML escaping protects the
// attribute itself. Used for Firebase keys in generated rows.
function mpJsArg(value) {
    return mpEsc(JSON.stringify(String(value == null ? '' : value)));
}

function mpHeight(cm) {
    const value = Number(cm);
    return Number.isFinite(value) ? `${(value / 100).toFixed(2)} m` : '—';
}

function mpPosLabel(pos) {
    return MP_POSITION_LABELS[pos] || pos || '—';
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

function mpFriendlyError(error) {
    const message = (error && error.message) || String(error || 'Unknown error');
    if (/permission_denied|permission denied/i.test(message)) {
        return 'Firebase denied access. Deploy database.rules.json so each account can read and write its own users/{uid} branch.';
    }
    if (/network|offline|unavailable/i.test(message)) {
        return 'Network error. My Player needs a connection to save your career.';
    }
    return message;
}

function mpFriendlyAuthError(error) {
    const code = (error && error.code) || '';
    const messages = {
        'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/user-not-found': 'Email or password is incorrect.',
        'auth/wrong-password': 'Email or password is incorrect.',
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/invalid-login-credentials': 'Email or password is incorrect.',
        'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.',
        'auth/operation-not-allowed': 'Email/Password sign-in is disabled. Enable it in Firebase Authentication, then try again.',
        'auth/unauthorized-domain': 'This domain is not authorized in Firebase Authentication settings.'
    };
    return messages[code] || mpFriendlyError(error);
}

// ------------------------------------------------------------
// Firebase / account bootstrap
// ------------------------------------------------------------

async function mpEnsureFirebase() {
    const cfg = (typeof Net !== 'undefined' && Net.config) ? Net.config() : null;
    if (!cfg) {
        throw new Error('No Firebase project configured. Add your web app config to firebase-config.js, then reload.');
    }
    await Net.loadSdk();
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        throw new Error('Firebase SDK failed to load. Check your connection and reload.');
    }
    const app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg);
    MP.fb = firebase;
    MP.auth = firebase.auth();
    MP.db = app.database();
    if (typeof Net !== 'undefined' && !Net.fb) {
        Net.fb = firebase;
        Net.root = MP.db.ref();
    }
    return true;
}

function mpBindAuth() {
    if (MP.authBound) return MP.authReady || Promise.resolve(MP.user);

    MP.authBound = true;
    MP.authReady = mpEnsureFirebase().then(() => new Promise(resolve => {
        MP.auth.onAuthStateChanged(user => {
            const realUser = user && !user.isAnonymous ? user : null;
            MP.user = realUser;

            // Keep the online module's cached identity in step. Without this, a
            // device that played anonymously first would keep using that uid
            // after the player signs into My Player.
            if (typeof Net !== 'undefined') {
                if (realUser) {
                    Net.fb = MP.fb;
                    if (!Net.root) Net.root = MP.db.ref();
                    Net._authUser = user;
                    Net.authUid = user.uid;
                } else if (!Net._authUser || !Net._authUser.isAnonymous) {
                    Net._authUser = null;
                    Net.authUid = null;
                }
            }

            if (!MP.firstAuth) {
                MP.firstAuth = true;
                resolve(MP.user);
                return;
            }
            if (MP.open) mpOnAuthChanged();
        });
    })).catch(error => {
        MP.authBound = false;
        MP.authReady = null;
        throw error;
    });

    return MP.authReady;
}

async function mpEnsureProfile(user) {
    if (!MP.db || !user) return;
    try {
        await MP.db.ref(`users/${user.uid}/profile`).update({
            email: user.email || '',
            lastSeenAt: Date.now()
        });
    } catch (error) {
        // Profile metadata is a convenience; career access still works (or fails
        // with a clear rules message) through the myPlayers branch.
    }
}

function mpOnAuthChanged() {
    if (!MP.open) return;
    if (MP.user) {
        mpEnsureProfile(MP.user).catch(() => {});
        mpShowList();
    } else {
        MP.careers = [];
        MP.active = null;
        MP.view = 'auth';
        mpShowAuth();
    }
}

// ------------------------------------------------------------
// Entry / navigation
// ------------------------------------------------------------

async function openMyPlayer() {
    MP.open = true;
    MP.view = 'auth';
    MP.active = null;
    showScreen('screen-myplayer-auth');
    mpResetAuthUI();
    mpSetAuthStatus('Connecting to your account…');

    try {
        await mpBindAuth();
        if (MP.user) {
            await mpShowList();
        } else {
            mpShowAuth();
        }
    } catch (error) {
        mpSetAuthStatus(mpFriendlyError(error), true);
    }
}

function mpClose() {
    MP.open = false;
    MP.view = null;
    MP.active = null;
    showScreen('screen-main');
}

function mpShowAuth() {
    if (!MP.open) MP.open = true;
    MP.view = 'auth';
    MP.active = null;
    showScreen('screen-myplayer-auth');
    mpResetAuthUI();
}

async function mpShowList() {
    if (!MP.user) {
        mpShowAuth();
        return;
    }
    MP.open = true;
    MP.view = 'list';
    MP.active = null;

    const emailEl = document.getElementById('mp-account-email');
    if (emailEl) emailEl.textContent = MP.user.email || 'Signed in';

    mpSetListStatus('Loading your careers…');
    mpRenderList();
    showScreen('screen-myplayer-list');

    try {
        await mpLoadCareers();
        mpSetListStatus('');
    } catch (error) {
        MP.careers = [];
        mpSetListStatus(mpFriendlyError(error), true);
    }
    mpRenderList();
}

function mpBackToList() {
    if (!MP.user) {
        mpShowAuth();
        return;
    }
    MP.active = null;
    MP.view = 'list';
    mpRenderList();
    showScreen('screen-myplayer-list');
    mpSetListStatus('');
}

// ------------------------------------------------------------
// Cloud data
// ------------------------------------------------------------

// Careers are plain JSON, so a partially written or future-version record must
// never crash the story renderer. Fill in the opening chapter and club names.
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
    return career;
}

async function mpLoadCareers() {
    if (!MP.user || !MP.db) throw new Error('Sign in required.');
    const snapshot = await MP.db.ref(`users/${MP.user.uid}/myPlayers`).once('value');
    const raw = snapshot.val() || {};
    MP.careers = Object.keys(raw).map(key => {
        const career = raw[key] || {};
        return mpEnsureCareerShape({ ...career, id: career.id || key });
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function mpSaveCareer(career) {
    if (!MP.user || !MP.db) throw new Error('Sign in required to save.');
    career.updatedAt = Date.now();
    const payload = JSON.parse(JSON.stringify(career));
    await MP.db.ref(`users/${MP.user.uid}/myPlayers/${career.id}`).set(payload);

    const index = MP.careers.findIndex(item => item.id === career.id);
    if (index >= 0) MP.careers[index] = career;
    else MP.careers.unshift(career);
    MP.careers.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function mpAutosaveNow() {
    if (!MP.active) return;
    mpSetSaveState('saving');
    try {
        await mpSaveCareer(MP.active);
        mpSetSaveState('saved');
    } catch (error) {
        mpSetSaveState('error');
        if (typeof showToast === 'function') showToast(`Autosave failed: ${mpFriendlyError(error)}`, 5200);
    }
}

async function mpDeleteCareer(id) {
    if (!MP.user || !MP.db) return;
    const career = MP.careers.find(item => item.id === id);
    if (!career) return;
    const label = career.name || 'this career';
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    try {
        await MP.db.ref(`users/${MP.user.uid}/myPlayers/${id}`).remove();
        MP.careers = MP.careers.filter(item => item.id !== id);
        if (MP.active && MP.active.id === id) MP.active = null;
        mpRenderList();
        if (typeof showToast === 'function') showToast('My Player deleted.');
    } catch (error) {
        if (typeof showToast === 'function') showToast(`Delete failed: ${mpFriendlyError(error)}`, 5200);
    }
}

async function mpSignOut() {
    if (!MP.auth) return;
    try {
        await MP.auth.signOut();
    } catch (error) {
        if (typeof showToast === 'function') showToast('Could not sign out. Try again.');
    }
}

// ------------------------------------------------------------
// Auth screen
// ------------------------------------------------------------

function mpResetAuthUI() {
    MP.authMode = 'login';
    const email = document.getElementById('mp-auth-email');
    const password = document.getElementById('mp-auth-password');
    const confirm = document.getElementById('mp-auth-confirm');
    if (email) email.value = '';
    if (password) password.value = '';
    if (confirm) confirm.value = '';
    mpSetAuthMode('login');
}

function mpSetAuthMode(mode) {
    MP.authMode = mode === 'signup' ? 'signup' : 'login';
    const signup = MP.authMode === 'signup';

    const submit = document.getElementById('mp-auth-submit');
    if (submit) {
        submit.disabled = false;
        submit.textContent = signup ? 'Create account' : 'Sign in';
    }
    const toggle = document.getElementById('mp-auth-toggle');
    if (toggle) toggle.textContent = signup ? 'I already have an account' : 'Create an account';
    const sub = document.getElementById('mp-auth-sub');
    if (sub) {
        sub.textContent = signup
            ? 'Create a free account. Every My Player career is saved to it and visible only to you.'
            : 'Sign in so every career is saved to your account — and only yours.';
    }
    const wrap = document.getElementById('mp-auth-confirm-wrap');
    if (wrap) wrap.classList.toggle('hidden', !signup);
    const password = document.getElementById('mp-auth-password');
    if (password) password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    mpSetAuthStatus('');
}

function mpToggleAuthMode() {
    const password = document.getElementById('mp-auth-password');
    const confirm = document.getElementById('mp-auth-confirm');
    if (password) password.value = '';
    if (confirm) confirm.value = '';
    mpSetAuthMode(MP.authMode === 'signup' ? 'login' : 'signup');
    const email = document.getElementById('mp-auth-email');
    if (email) email.focus();
}

async function mpSubmitAuth() {
    const submit = document.getElementById('mp-auth-submit');
    const email = (document.getElementById('mp-auth-email')?.value || '').trim();
    const password = document.getElementById('mp-auth-password')?.value || '';
    const confirm = document.getElementById('mp-auth-confirm')?.value || '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        mpSetAuthStatus('Enter a valid email address.', true);
        return;
    }
    if (password.length < 6) {
        mpSetAuthStatus('Password must be at least 6 characters.', true);
        return;
    }
    if (MP.authMode === 'signup' && password !== confirm) {
        mpSetAuthStatus('Passwords do not match.', true);
        return;
    }

    const mode = MP.authMode;
    if (submit) {
        submit.disabled = true;
        submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    }
    mpSetAuthStatus('');

    try {
        await mpBindAuth();
        if (mode === 'signup') {
            await MP.auth.createUserWithEmailAndPassword(email, password);
        } else {
            await MP.auth.signInWithEmailAndPassword(email, password);
        }
        // onAuthStateChanged takes over and loads the career list.
    } catch (error) {
        mpSetAuthStatus(mpFriendlyAuthError(error), true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
        }
    }
}

function mpSetAuthStatus(text, isError) {
    const el = document.getElementById('mp-auth-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

function mpSetListStatus(text, isError) {
    const el = document.getElementById('mp-list-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

function mpSetCreateStatus(text, isError) {
    const el = document.getElementById('mp-create-status');
    if (!el) return;
    el.textContent = text || '';
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
        const position = career.position || '—';
        return `
            <div class="mp-career">
                <button class="mp-career__open" onclick="mpOpenCareer(${mpJsArg(career.id)})">
                    <span class="mp-career__badge">${mpEsc(position)}</span>
                    <span class="mp-career__body">
                        <span class="mp-career__name">${mpEsc(career.name || 'Unnamed Player')}</span>
                        <span class="mp-career__meta">Age ${Number(career.age) || 18} · ${mpEsc(career.nationality || '—')} · ${mpEsc(mpHeight(career.heightCm))} · ${mpEsc((Number(career.weightKg) || 0) + ' kg')}</span>
                        <span class="mp-career__tags">${mpEsc(career.archetype || '—')} · ${mpEsc(career.playstyle || '—')}</span>
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

function mpOpenCareer(id) {
    const career = MP.careers.find(item => item.id === id);
    if (!career) return;
    MP.active = mpEnsureCareerShape(career);
    MP.view = 'story';
    MP.storyBusy = false;
    mpRenderStory();
    showScreen('screen-myplayer-story');
}

function mpChapterName(career) {
    const scene = mpGetScene(career).scene;
    return scene && scene.act ? scene.act : 'Chapter 1 · The Last Game';
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
    host.innerHTML = reels.map(([field, label]) => `
        <div class="mp-reel" data-field="${field}">
            <div class="mp-reel__label">${label}</div>
            <div class="mp-reel__window"><div class="mp-reel__track"></div></div>
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
    if (!MP.user) {
        mpShowAuth();
        return;
    }
    MP.open = true;
    MP.view = 'create';
    MP.active = null;
    MP.draft = mpRollDraft();

    const name = document.getElementById('mp-name');
    if (name) name.value = '';
    const submit = document.getElementById('mp-create-btn');
    if (submit) {
        submit.disabled = false;
        submit.textContent = 'Create My Player';
    }
    mpSetCreateStatus('');
    mpRenderReels();
    showScreen('screen-myplayer-create');
    mpAnimateReels();
    setTimeout(() => {
        const input = document.getElementById('mp-name');
        if (input) input.focus();
    }, 80);
}

function mpRollAgain() {
    MP.draft = mpRollDraft();
    mpSetCreateStatus('');
    mpRenderReels();
    mpAnimateReels();
}

async function mpCreateCareer() {
    if (!MP.user) {
        mpShowAuth();
        return;
    }
    if (!MP.draft) MP.draft = mpRollDraft();

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
    const career = {
        id: `mp_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        version: 1,
        name,
        nationality: draft.nationality,
        heightCm: draft.heightCm,
        weightKg: draft.weightKg,
        position: draft.position,
        archetype: draft.archetype,
        playstyle: draft.playstyle,
        age: 18,
        hometown: mpPick(MP_CITIES),
        createdAt: now,
        updatedAt: now,
        stats: { matches: 0, goals: 0, assists: 0 },
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

    try {
        await mpSaveCareer(career);
        MP.active = career;
        MP.view = 'story';
        MP.storyBusy = false;
        mpRenderStory();
        showScreen('screen-myplayer-story');
    } catch (error) {
        mpSetCreateStatus(mpFriendlyError(error), true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Create My Player';
        }
    }
}

// ------------------------------------------------------------
// Story
// ------------------------------------------------------------

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
                `The little C League club on the leaflet has just been promoted. That is why the trial is now a B League recruitment day — and why the queue outside the training ground is twice as long as you expected.`,
                `You take a breath, hold the leaflet tight, and walk in. This is the first step of the rest of your life.`
            ],
            end: true
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
            ],
            end: true
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

function mpRenderStory() {
    const career = mpEnsureCareerShape(MP.active);
    if (!career) {
        mpBackToList();
        return;
    }

    const subtitle = document.getElementById('mp-story-subtitle');
    if (subtitle) subtitle.textContent = career.name || 'Career';

    const identity = document.getElementById('mp-story-player');
    if (identity) identity.innerHTML = mpIdentityMarkup(career);

    const panel = document.getElementById('mp-story-panel');
    if (!panel) return;

    const { list, step, scene } = mpGetScene(career);
    const paragraphs = typeof scene.text === 'function' ? scene.text(career) : (scene.text || []);
    const isEnd = !!scene.end || step >= list.length - 1;
    const choices = scene.choices || [];

    const body = paragraphs.map(paragraph => `<p>${mpEsc(paragraph)}</p>`).join('');
    const progress = list.map((_, index) => `<span class="mp-progress__dot${index <= step ? ' is-on' : ''}"></span>`).join('');

    let actions = '';
    if (choices.length) {
        actions = `
            <div class="mp-choices">
                ${choices.map(choice => `
                    <button class="mp-choice" onclick="mpChooseStory('${mpEscAttr(choice.path)}')">
                        <span>${mpEsc(choice.label)}</span>
                        <span class="mp-choice__arrow">→</span>
                    </button>`).join('')}
            </div>`;
    } else if (isEnd) {
        actions = `
            <div class="mp-story__end">
                <div class="mp-story__end-badge">To be continued</div>
                <p>This is the end of the current build. Your career is saved — come back when the next chapter arrives.</p>
                <button class="btn btn--primary" onclick="mpBackToList()">Back to My Players</button>
            </div>`;
    } else {
        actions = `
            <div class="mp-story__actions">
                <button class="btn btn--primary" onclick="mpAdvanceStory()">Continue <span>→</span></button>
            </div>`;
    }

    panel.innerHTML = `
        <div class="mp-story__top">
            <div>
                <div class="mp-story__chapter">${mpEsc(scene.act || 'Chapter 1 · The Last Game')}</div>
                <h2 class="mp-story__title">${mpEsc(scene.title || 'One Chance')}</h2>
            </div>
            <div class="mp-story__progress" aria-label="Story progress">${progress}</div>
        </div>
        <div class="mp-story__text">${body}</div>
        ${actions}
        <div class="mp-story__foot">Part ${step + 1} of ${list.length} · Autosaves after every step</div>`;

    mpSetSaveState('saved');
}

function mpIdentityMarkup(career) {
    return `
        <div class="mp-idcard">
            <div class="mp-idcard__top">
                <div class="mp-idcard__badge">${mpEsc(career.position || '—')}</div>
                <div class="mp-idcard__names">
                    <div class="mp-idcard__name">${mpEsc(career.name || 'My Player')}</div>
                    <div class="mp-idcard__meta">${Number(career.age) || 18} · ${mpEsc(career.nationality || '—')} · ${mpEsc(career.hometown || '—')}</div>
                </div>
            </div>
            <div class="mp-idcard__rows">
                <div><span>Height</span><b>${mpEsc(mpHeight(career.heightCm))}</b></div>
                <div><span>Weight</span><b>${mpEsc((Number(career.weightKg) || 0) + ' kg')}</b></div>
                <div><span>Position</span><b>${mpEsc(mpPosLabel(career.position))}</b></div>
                <div><span>Archetype</span><b>${mpEsc(career.archetype || '—')}</b></div>
                <div><span>Playstyle</span><b>${mpEsc(career.playstyle || '—')}</b></div>
                <div><span>Career</span><b>${mpEsc(mpChapterName(career))}</b></div>
            </div>
            <button class="btn btn--ghost mp-idcard__back" onclick="mpBackToList()">My Players</button>
        </div>`;
}

async function mpChooseStory(path) {
    if (!MP.active || MP.storyBusy || !MP_STORY[path]) return;
    MP.storyBusy = true;
    MP.active.story = MP.active.story || {};
    MP.active.story.path = path;
    MP.active.story.step = 0;
    MP.active.story.decision = path;
    mpRenderStory();
    await mpAutosaveNow();
    MP.storyBusy = false;
}

async function mpAdvanceStory() {
    if (!MP.active || MP.storyBusy) return;
    const { list, step } = mpGetScene(MP.active);
    if (step >= list.length - 1) return;
    MP.storyBusy = true;
    MP.active.story = MP.active.story || {};
    MP.active.story.path = MP_STORY[MP.active.story.path] ? MP.active.story.path : 'intro';
    MP.active.story.step = step + 1;
    mpRenderStory();
    await mpAutosaveNow();
    MP.storyBusy = false;
}

function mpSetSaveState(state) {
    const el = document.getElementById('mp-save-state');
    if (!el) return;
    const labels = { saved: 'Saved', saving: 'Saving…', error: 'Save failed' };
    el.className = `mp-save${state === 'saved' ? ' is-saved' : state === 'saving' ? ' is-saving' : state === 'error' ? ' is-error' : ''}`;
    el.innerHTML = `<span class="mp-save__dot"></span>${labels[state] || 'Cloud save'}`;
}

// ------------------------------------------------------------
// Small boot wiring (script lives at the bottom of index.html)
// ------------------------------------------------------------

(function mpBoot() {
    const password = document.getElementById('mp-auth-password');
    const confirm = document.getElementById('mp-auth-confirm');
    if (password) {
        password.addEventListener('keydown', event => {
            if (event.key === 'Enter') mpSubmitAuth();
        });
    }
    if (confirm) {
        confirm.addEventListener('keydown', event => {
            if (event.key === 'Enter') mpSubmitAuth();
        });
    }
    const name = document.getElementById('mp-name');
    if (name) {
        name.addEventListener('keydown', event => {
            if (event.key === 'Enter') mpCreateCareer();
        });
    }
})();
