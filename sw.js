// ============================================================
// SERVICE WORKER — offline shell.
//
// The game is a pile of plain scripts, so caching the shell is enough to keep
// it playable without a connection. Firebase traffic is never cached: stale
// room state is worse than an honest offline error.
// ============================================================

const CACHE = 'dbf-shell-v1';
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './players.js',
    './config.js',
    './engine-core.js',
    './firebase-config.js',
    './game.js',
    './net.js',
    './online.js',
    './ui.js',
    './draft.js',
    './auction.js',
    './match-engine.js',
    './season.js',
    './save.js',
    './vendor/tailwind.js'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // One missing optional file must not abort the whole install.
        await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) {
            // Refresh in the background so the next load gets the new build.
            event.waitUntil(fetch(request).then(response => {
                if (response && response.ok) return caches.open(CACHE).then(cache => cache.put(request, response.clone()));
            }).catch(() => {}));
            return cached;
        }
        try {
            const response = await fetch(request);
            if (response && response.ok) {
                const cache = await caches.open(CACHE);
                cache.put(request, response.clone()).catch(() => {});
            }
            return response;
        } catch (err) {
            if (request.mode === 'navigate') {
                const fallback = await caches.match('./index.html');
                if (fallback) return fallback;
            }
            throw err;
        }
    })());
});
