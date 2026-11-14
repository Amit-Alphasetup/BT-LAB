/* P8: service worker for the app shell only. Price data is NOT cached here: it stays in the client's IndexedDB cache.
   Shell files: network first (a new deploy shows at once), cache when offline. Any other request (other hosts, data/,
   quotes) is not touched. SHELL must list every app file; tests/p8.test.mjs checks it against the folder. */
const CACHE = 'btlab-shell-v1';
const SHELL = ['./', 'index.html', 'app.css', 'icon.svg', 'manifest.json',
  'alphadesk-bridge.js', 'builder.js', 'chart.js', 'compare.js', 'corrections.json', 'data.js', 'engine.js', 'eod2-client.js', 'extras.js',
  'fills.js', 'portfolio.js', 'presets-alphadesk.js', 'presets-btdesk.js', 'quotes.js', 'report.js', 'schemas.js',
  'signals.js', 'source.js', 'studio.js', 'ui-p4.js', 'ui-p5.js', 'ui.js', 'universe.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('btlab-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function isShell(url) {
  if (url.origin !== self.location.origin) return false;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return false;
  const rel = url.pathname.slice(scope.pathname.length) || './';
  return SHELL.includes(rel) && !url.search;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isShell(url)) return;                        // data, quotes, other hosts: browser default
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
