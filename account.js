// ============================================================
// ACCOUNT — global sign-in, profile and Token wallet.
//
// The whole app is gated behind an account now: online play needs a stable
// uid for the room rules, My Player careers need an owner, and Tokens are
// account-wide. Everything lives under users/{uid}/ so the existing
// per-account database rules cover it.
// ============================================================

const TOKEN_REWARDS = Object.freeze({
    H2H_WIN: 30,
    LEAGUE_TITLE: 120,
    UCL_WIN: 300,
    UEL_WIN: 180
});

const TOKEN_COSTS = Object.freeze({
    MP_REROLL: 25,
    TRAINING_BOOST: 20
});

const Account = {
    fb: null,
    auth: null,
    db: null,
    user: null,
    profile: {},
    tokenBalance: 0,
    authMode: 'login',
    bound: false,
    authReady: null,
    started: false,
    entering: false,
    loadedCareers: 0,
    tokenRef: null,
    tokenHandler: null,
    pendingUsername: null,
    devUnlocked: false
};

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

function tokenIcon(size = 16) {
    return `<svg class="token-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9.1" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="6.6" stroke="currentColor" stroke-width="1" opacity=".45"/><path d="M8.6 8.4h6.8M12 8.4V16" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>`;
}

function tokenText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)).toLocaleString() : '0';
}

function accountInitial() {
    const text = accountDisplayName();
    return text ? text.charAt(0).toUpperCase() : '?';
}

// The username is the name everyone else sees. Accounts created before it
// existed fall back to the local part of the email until the owner picks one.
function accountDisplayName() {
    const named = String((Account.profile && Account.profile.username) || '').trim();
    if (named) return named;
    const email = String((Account.user && Account.user.email) || '').trim();
    return email ? email.split('@')[0] : '';
}

function accountCleanUsername(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    return /^[A-Za-z0-9._ -]{2,15}$/.test(name) ? name : null;
}

function accountFriendlyAuthError(error) {
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
    return messages[code] || accountFriendlyError(error);
}

function accountFriendlyError(error) {
    const message = (error && error.message) || String(error || 'Unknown error');
    if (/permission_denied|permission denied/i.test(message)) {
        return 'Firebase denied access. Deploy database.rules.json so each account can read and write its own users/{uid} branch.';
    }
    if (/network|offline|unavailable/i.test(message)) {
        return 'Network error. An account needs a connection to sign in and save.';
    }
    return message;
}

// ------------------------------------------------------------
// Firebase bootstrap
// ------------------------------------------------------------

async function accountEnsureFirebase() {
    const cfg = (typeof Net !== 'undefined' && Net.config) ? Net.config() : null;
    if (!cfg) {
        throw new Error('No Firebase project configured. Add your web app config to firebase-config.js, then reload.');
    }
    await Net.loadSdk();
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        throw new Error('Firebase SDK failed to load. Check your connection and reload.');
    }
    const app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(cfg);
    Account.fb = firebase;
    Account.auth = firebase.auth();
    Account.db = app.database();
    if (typeof Net !== 'undefined' && !Net.fb) {
        Net.fb = firebase;
        Net.root = Account.db.ref();
    }
    return true;
}

function accountBindAuth() {
    if (Account.bound) return Account.authReady || Promise.resolve(Account.user);

    Account.bound = true;
    Account.authReady = accountEnsureFirebase().then(() => new Promise(resolve => {
        Account.auth.onAuthStateChanged(user => {
            const realUser = user && !user.isAnonymous ? user : null;
            const previousUid = Account.user && Account.user.uid;
            Account.user = realUser;

            // Online play stores its own auth uid. Keep it pointed at the real
            // account, and clear it on sign-out so a room can never inherit an
            // anonymous or previous account identity.
            if (typeof Net !== 'undefined') {
                if (realUser) {
                    Net.fb = Account.fb;
                    if (!Net.root) Net.root = Account.db.ref();
                    Net._authUser = user;
                    Net.authUid = user.uid;
                } else if (previousUid || (Net._authUser && !Net._authUser.isAnonymous)) {
                    Net._authUser = null;
                    Net.authUid = null;
                }
            }

            if (!realUser) {
                accountUnwatchTokens();
                Account.tokenBalance = 0;
                Account.profile = {};
                accountRenderHud();
                if (Account.started) accountShowGate();
                resolve(null);
                return;
            }

            accountLoadProfile()
                .catch(() => {
                    Account.tokenBalance = 0;
                    Account.profile = {};
                })
                .then(() => {
                    accountRenderHud();
                    if (!previousUid || previousUid !== realUser.uid) accountEnterApp();
                    resolve(realUser);
                });
        });
    })).catch(error => {
        Account.bound = false;
        Account.authReady = null;
        throw error;
    });

    return Account.authReady;
}

async function accountLoadProfile() {
    if (!Account.user || !Account.db) return Account.profile;
    const uid = Account.user.uid;
    const snapshot = await Account.db.ref(`users/${uid}/profile`).once('value');
    const profile = snapshot.val() || {};
    Account.profile = profile;
    Account.tokenBalance = Number(profile.tokens) || 0;

    // First sign-in creates the profile. The Token wallet starts at zero; the
    // only way to earn is winning online matches, and the only way to lose is
    // spending it yourself.
    if (!profile.createdAt) {
        const now = Date.now();
        const patch = {
            email: Account.user.email || '',
            username: accountCleanUsername(Account.pendingUsername) || '',
            createdAt: now,
            lastSeenAt: now,
            tokens: Account.tokenBalance
        };
        Account.pendingUsername = null;
        Account.profile = { ...profile, ...patch };
        Account.db.ref(`users/${uid}/profile`).update(patch).catch(() => {});
    } else {
        Account.db.ref(`users/${uid}/profile/lastSeenAt`).set(Date.now()).catch(() => {});
    }

    // Keep a live listener on the wallet. Besides syncing the HUD across tabs,
    // this primes the local cache that Firebase transactions read: without it a
    // spend can look at a null cache and wrongly report "not enough Tokens".
    accountWatchTokens(uid);
    return Account.profile;
}

function accountWatchTokens(uid) {
    accountUnwatchTokens();
    if (!Account.db || !uid) return;
    const ref = Account.db.ref(`users/${uid}/profile/tokens`);
    if (typeof ref.on !== 'function') return;
    const handler = snap => {
        if (!Account.user || Account.user.uid !== uid) return;
        Account.tokenBalance = Number(snap.val()) || 0;
        accountRenderHud();
    };
    Account.tokenRef = ref;
    Account.tokenHandler = handler;
    ref.on('value', handler);
}

function accountUnwatchTokens() {
    if (Account.tokenRef && Account.tokenHandler) {
        try { Account.tokenRef.off('value', Account.tokenHandler); } catch (e) {}
    }
    Account.tokenRef = null;
    Account.tokenHandler = null;
}

function accountRefreshProfile() {
    return accountLoadProfile().then(() => {
        accountRenderHud();
        return Account.tokenBalance;
    });
}

// ------------------------------------------------------------
// Token wallet
// ------------------------------------------------------------

async function accountAwardTokens(amount, eventId, reason) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!Account.user || !Account.db || !value) return false;

    try {
        if (eventId) {
            const guard = await Account.db.ref(`users/${Account.user.uid}/tokenEvents/${eventId}`).transaction(current => {
                if (current) return; // already paid for this event
                return { amount: value, reason: reason || 'Online win', at: Date.now() };
            });
            if (!guard || !guard.committed) return false;
        }

        const result = await Account.db.ref(`users/${Account.user.uid}/profile/tokens`).transaction(current => {
            const n = Number(current) || 0;
            return Math.max(0, n + value);
        });
        Account.tokenBalance = Number(result && result.snapshot && result.snapshot.val()) || 0;
        accountRenderHud();
        if (typeof showToast === 'function') showToast(`+${tokenText(value)} Tokens · ${reason || 'Reward'}`, 4200);
        return true;
    } catch (error) {
        if (typeof showToast === 'function') showToast(`Token reward failed: ${accountFriendlyError(error)}`, 5200);
        return false;
    }
}

async function accountSpendTokens(amount, reason) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!Account.user || !Account.db || !value) return false;

    try {
        const result = await Account.db.ref(`users/${Account.user.uid}/profile/tokens`).transaction(current => {
            const n = Number(current) || 0;
            if (n < value) return; // abort: not enough Tokens
            return n - value;
        });
        if (!result || !result.committed) {
            if (typeof showToast === 'function') showToast(`Not enough Tokens. You need ${tokenText(value)}.`);
            return false;
        }
        Account.tokenBalance = Number(result.snapshot.val()) || 0;
        accountRenderHud();
        return true;
    } catch (error) {
        if (typeof showToast === 'function') showToast(`Token spend failed: ${accountFriendlyError(error)}`, 5200);
        return false;
    }
}

// ------------------------------------------------------------
// Gate / menu
// ------------------------------------------------------------

function accountShowGate() {
    showScreen('screen-auth');
    accountSetAuthMode(Account.authMode || 'login');
}

function accountEnterApp() {
    Account.entering = true;
    accountRenderHud();
    if (typeof MP !== 'undefined' && MP.open) {
        // A sign-in while inside My Player should land on the career list.
        if (typeof mpShowList === 'function') mpShowList();
        return;
    }
    showScreen('screen-main');
}

async function accountStart() {
    if (Account.started) return;
    Account.started = true;
    Account.authMode = 'login';
    showScreen('screen-auth');
    accountSetAuthStatus('Connecting to your account…');
    accountHookFormKeys();

    try {
        await accountBindAuth();
        if (!Account.user) {
            accountShowGate();
            accountSetAuthStatus('');
        }
    } catch (error) {
        accountSetAuthStatus(accountFriendlyError(error), true);
    }
}

function accountSetAuthMode(mode) {
    Account.authMode = mode === 'signup' ? 'signup' : 'login';
    const signup = Account.authMode === 'signup';

    const submit = document.getElementById('auth-submit');
    if (submit) {
        submit.disabled = false;
        submit.textContent = signup ? 'Create account' : 'Sign in';
    }
    const toggle = document.getElementById('auth-toggle');
    if (toggle) toggle.textContent = signup ? 'I already have an account' : 'Create an account';
    const sub = document.getElementById('auth-sub');
    if (sub) {
        sub.textContent = signup
            ? 'Create a free account to play online, save My Player careers and collect Tokens.'
            : 'Sign in to play online, save My Player careers and collect Tokens.';
    }
    const wrap = document.getElementById('auth-confirm-wrap');
    if (wrap) wrap.classList.toggle('hidden', !signup);
    const signupFields = document.getElementById('auth-signup-fields');
    if (signupFields) signupFields.classList.toggle('hidden', !signup);
    const password = document.getElementById('auth-password');
    if (password) password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    accountSetAuthStatus('');
}

function accountToggleAuthMode() {
    const username = document.getElementById('auth-username');
    const password = document.getElementById('auth-password');
    const confirm = document.getElementById('auth-confirm');
    if (username) username.value = '';
    if (password) password.value = '';
    if (confirm) confirm.value = '';
    accountSetAuthMode(Account.authMode === 'signup' ? 'login' : 'signup');
    const email = document.getElementById('auth-email');
    if (email) email.focus();
}

async function accountSubmitAuth() {
    const submit = document.getElementById('auth-submit');
    const email = (document.getElementById('auth-email')?.value || '').trim();
    const password = document.getElementById('auth-password')?.value || '';
    const confirm = document.getElementById('auth-confirm')?.value || '';
    const username = accountCleanUsername(document.getElementById('auth-username')?.value);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        accountSetAuthStatus('Enter a valid email address.', true);
        return;
    }
    if (Account.authMode === 'signup' && !username) {
        accountSetAuthStatus('Pick a username: 2-15 letters, numbers, spaces, dot, underscore or dash.', true);
        return;
    }
    if (password.length < 6) {
        accountSetAuthStatus('Password must be at least 6 characters.', true);
        return;
    }
    if (Account.authMode === 'signup' && password !== confirm) {
        accountSetAuthStatus('Passwords do not match.', true);
        return;
    }

    const mode = Account.authMode;
    if (submit) {
        submit.disabled = true;
        submit.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    }
    accountSetAuthStatus('');

    try {
        await accountBindAuth();
        if (mode === 'signup') {
            Account.pendingUsername = username || '';
            await Account.auth.createUserWithEmailAndPassword(email, password);
        } else {
            await Account.auth.signInWithEmailAndPassword(email, password);
        }
        // onAuthStateChanged loads the profile and opens the menu.
    } catch (error) {
        Account.pendingUsername = null;
        accountSetAuthStatus(accountFriendlyAuthError(error), true);
        if (submit) {
            submit.disabled = false;
            submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
        }
    }
}

function accountSetAuthStatus(text, isError) {
    const el = document.getElementById('auth-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

function accountHookFormKeys() {
    ['auth-email', 'auth-username', 'auth-password', 'auth-confirm'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || el.dataset.authHooked) return;
        el.dataset.authHooked = '1';
        el.addEventListener('keydown', event => {
            if (event.key === 'Enter') accountSubmitAuth();
        });
    });
}

async function accountSignOut() {
    if (!Account.auth) return;
    try {
        await Account.auth.signOut();
        if (typeof Net !== 'undefined') {
            Net._authUser = null;
            Net.authUid = null;
        }
        Account.user = null;
        Account.profile = {};
        Account.tokenBalance = 0;
        Account.authMode = 'login';
        Account.pendingUsername = null;
        Account.devUnlocked = false;
        accountUnwatchTokens();
        accountRenderHud();
        accountCloseInfo();
        accountShowGate();
        if (typeof showToast === 'function') showToast('Signed out.');
    } catch (error) {
        if (typeof showToast === 'function') showToast('Could not sign out. Try again.');
    }
}

// ------------------------------------------------------------
// HUD + account info
// ------------------------------------------------------------

function accountRenderHud() {
    const name = accountDisplayName() || (Account.user ? 'Player' : '—');
    const initial = accountInitial();

    // Screens build their own token pills long after boot, so hydrate any icon
    // that was injected by a renderer and is still empty.
    document.querySelectorAll('[data-token-icon]').forEach(el => {
        if (!el.innerHTML.trim()) el.innerHTML = tokenIcon(Number(el.dataset.tokenIcon) || 16);
    });

    document.querySelectorAll('[data-account-name]').forEach(el => { el.textContent = name; });
    document.querySelectorAll('[data-account-avatar]').forEach(el => { el.textContent = initial; });
    document.querySelectorAll('[data-token-count]').forEach(el => { el.textContent = tokenText(Account.tokenBalance); });
    const infoTokens = document.getElementById('account-info-tokens');
    if (infoTokens) infoTokens.textContent = tokenText(Account.tokenBalance);

    const emailEl = document.getElementById('mp-account-email');
    if (emailEl) emailEl.textContent = Account.user ? (Account.user.email || 'Signed in') : 'Not signed in';
}

function accountSetNameStatus(text, isError) {
    const el = document.getElementById('account-name-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'mp-status' + (isError ? ' is-error' : '');
}

// The owner can rename themselves at any time; the name only ever comes from
// this profile, so rooms and the HUD pick it up on the next render.
async function accountSaveUsername() {
    if (!Account.user || !Account.db) return;
    const input = document.getElementById('account-username-input');
    const name = accountCleanUsername(input && input.value);
    if (!name) {
        accountSetNameStatus('Use 2-15 letters, numbers, spaces, dot, underscore or dash.', true);
        return;
    }
    if (name === accountDisplayName()) {
        accountSetNameStatus('');
        return;
    }
    if (input) input.value = name;
    try {
        await Account.db.ref(`users/${Account.user.uid}/profile/username`).set(name);
        Account.profile = { ...Account.profile, username: name };
        accountRenderHud();
        const title = document.getElementById('account-info-title');
        if (title) title.textContent = name;
        accountSetNameStatus('');
        if (typeof showToast === 'function') showToast(`You are now ${name}.`);
    } catch (error) {
        accountSetNameStatus(accountFriendlyError(error), true);
    }
}

// ------------------------------------------------------------
// Hidden Token top-up (revealed by TOKEN_DEV_CODE)
// ------------------------------------------------------------

const TOKEN_TOPUP_MAX = 100000;

function accountDevCodeCheck(value) {
    const code = String(value || '').trim();
    const unlocked = typeof TOKEN_DEV_CODE !== 'undefined' && !!code && code === TOKEN_DEV_CODE;
    Account.devUnlocked = unlocked;
    const topup = document.getElementById('account-dev-topup');
    if (topup) topup.classList.toggle('hidden', !unlocked);
    if (unlocked) {
        const input = document.getElementById('account-dev-code');
        if (input) input.value = '';
    }
}

async function accountDevAddTokens() {
    if (!Account.devUnlocked || !Account.user) return;
    const raw = Math.floor(Number(document.getElementById('account-dev-amount')?.value));
    if (!Number.isFinite(raw) || raw < 1) {
        if (typeof showToast === 'function') showToast('Enter how many Tokens to add.');
        return;
    }
    await accountAwardTokens(Math.min(raw, TOKEN_TOPUP_MAX), null, 'Manual top-up');
}

function accountShowInfo() {
    if (!Account.user) {
        accountShowGate();
        return;
    }
    const modal = document.getElementById('account-modal');
    if (!modal) return;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    const name = accountDisplayName() || 'Player';
    setText('account-info-title', name);
    setText('account-info-email', Account.user.email || 'Signed in');
    setText('account-info-uid', Account.user.uid || '—');
    setText('account-info-tokens', tokenText(Account.tokenBalance));
    setText('account-info-players', String(Account.loadedCareers || 0));
    setText('account-info-avatar', accountInitial());

    const nameInput = document.getElementById('account-username-input');
    if (nameInput) nameInput.value = name === 'Player' ? '' : name;
    accountSetNameStatus('');

    Account.devUnlocked = false;
    const devCode = document.getElementById('account-dev-code');
    if (devCode) devCode.value = '';
    const devTopup = document.getElementById('account-dev-topup');
    if (devTopup) devTopup.classList.add('hidden');

    const created = Number(Account.profile && Account.profile.createdAt);
    setText('account-info-since', Number.isFinite(created) && created > 0
        ? new Date(created).toLocaleDateString()
        : 'Today');

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    if (Account.db) {
        Account.db.ref(`users/${Account.user.uid}/myPlayers`).once('value')
            .then(snapshot => {
                const count = Object.keys(snapshot.val() || {}).length;
                Account.loadedCareers = count;
                setText('account-info-players', String(count));
                if (typeof MP !== 'undefined' && MP.careers) Account.loadedCareers = Math.max(count, MP.careers.length);
            })
            .catch(() => {});
    }
}

function accountCloseInfo() {
    const modal = document.getElementById('account-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
}

function accountBoot() {
    document.querySelectorAll('[data-token-icon]').forEach(el => {
        el.innerHTML = tokenIcon(Number(el.dataset.tokenIcon) || 16);
    });
    const start = () => accountStart();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
}

accountBoot();
