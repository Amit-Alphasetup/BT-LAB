// P8 unit checks: service-worker SHELL list = every app file in BT-LAB root; the fetch handler leaves data, quotes,
// other hosts and query-string URLs alone, serves shell files network-first and from the cache when the network fails.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const require = createRequire(import.meta.url);
let bad = 0; const no = m => { console.log('FAIL', m); bad++; };

// 1. SHELL covers the folder exactly (sw.js itself excluded: the browser fetches it outside the cache)
const src = readFileSync(join(APP, 'sw.js'), 'utf8');
const { SHELL } = new Function('self', src + '\nreturn { SHELL };')({ addEventListener() {} });
const files = readdirSync(APP, { withFileTypes: true }).filter(d => d.isFile() && /\.(js|css|html|svg|json)$/.test(d.name) && d.name !== 'sw.js' && d.name !== 'package.json').map(d => d.name).sort();
const listed = SHELL.filter(s => s !== './').sort();
if (files.join() !== listed.join()) no('SHELL differs from folder: missing ' + files.filter(f => !listed.includes(f)) + ' extra ' + listed.filter(f => !files.includes(f)));
if (!readFileSync(join(APP, 'index.html'), 'utf8').includes("navigator.serviceWorker.register('sw.js')")) no('index.html does not register sw.js');

// 2. fetch handler in a fake worker scope
const store = new Map(); const handlers = {};
let online = true;
const caches = {
  open: async () => ({ put: async (r, res) => store.set(r.url, res), addAll: async () => {} }),
  match: async (r) => store.get(typeof r === 'string' ? 'https://h.test/app/' + r : r.url),
  keys: async () => [], delete: async () => true,
};
const self = { location: new URL('https://h.test/app/sw.js'), registration: { scope: 'https://h.test/app/' },
  addEventListener: (n, f) => { handlers[n] = f; }, skipWaiting: () => {}, clients: { claim: () => {} } };
const fetchStub = async (req) => { if (!online) throw new TypeError('Failed to fetch'); return new Response('net:' + req.url, { status: 200 }); };
new Function('self', 'caches', 'fetch', src)(self, caches, fetchStub);
const fire = async (u, mode = 'no-cors') => {
  let p = null; const req = { url: u, method: 'GET', mode };
  handlers.fetch({ request: req, respondWith: x => { p = x; } });
  return p ? await (await p)?.text?.() ?? 'error' : null;
};
for (const u of ['https://h.test/app/data/manifest.json', 'https://amit-alphasetup.github.io/x/manifest.json', 'https://bridge.test/quotes?symbols=A',
  'https://h.test/app/ui.js?v=2', 'https://h.test/other/ui.js'])
  if ((await fire(u)) !== null) no('intercepted ' + u);
if ((await fire('https://h.test/app/ui.js')) !== 'net:https://h.test/app/ui.js') no('shell not served from network when online');
await new Promise(r => setTimeout(r, 0));
online = false;
if ((await fire('https://h.test/app/ui.js')) !== 'net:https://h.test/app/ui.js') no('offline: shell not served from cache');
store.set('https://h.test/app/index.html', new Response('shell-index'));
if ((await fire('https://h.test/app/', 'navigate')) !== 'shell-index') no('offline navigation does not fall back to index.html');
// 3. Studio publish check: datasetId required, 90-day lag, corrections ledger
const ST = await import('../studio.js');
const ledger = JSON.parse(readFileSync(join(APP, 'corrections.json'), 'utf8'));
if (!Array.isArray(ledger.corrections) || ledger.version !== 1) no('corrections.json shape');
const D = s => Date.parse(s + 'T00:00:00Z');
const NOW = D('2026-11-14');
const mk = (last, ds, src = 'EOD2') => ({ bars: { symbol: 'RELIANCE', t: [D('2020-01-01'), D(last)] }, meta: {}, stats: { trades: 3 },
  dataSource: { source: src, datasetId: ds } });
const ok = ST.publishCheck(mk('2026-08-01', '2026-11-12-r1'), { now: NOW, corrections: ledger });
if (!ok.ok || ok.datasetId !== '2026-11-12-r1') no('clean run blocked: ' + ok.problems);
const lag = ST.publishCheck(mk('2026-10-01', '2026-11-12-r1'), { now: NOW, corrections: ledger });
if (lag.ok || !/90-day publishing lag/.test(lag.problems.join())) no('lag not enforced');
const day89 = ST.publishCheck(mk('2026-08-17', '2026-11-12-r1'), { now: NOW, corrections: ledger });
const day90 = ST.publishCheck(mk('2026-08-16', '2026-11-12-r1'), { now: NOW, corrections: ledger });
if (day89.ok || !day90.ok) no('lag edge: 89 days ' + day89.ok + ', 90 days ' + day90.ok);
for (const [src, ds] of [['YAHOO', null], ['CSV', null], ['EOD2', 'latest']])
  if (ST.publishCheck(mk('2026-08-01', ds, src), { now: NOW, corrections: ledger }).ok) no('published without a dataset id: ' + src + ' ' + ds);
if (ST.publishCheck(mk('2026-08-01', '2026-11-12-r1'), { now: NOW }).ok) no('published without the corrections ledger');
const fix = { corrections: [{ date: '2026-11-20', symbols: ['RELIANCE'], what: 'split factor', fixedInDataset: '2026-11-20-r1', evidence: 'x' }] };
if (ST.publishCheck(mk('2026-08-01', '2026-11-12-r1'), { now: NOW, corrections: fix }).ok) no('older dataset than a correction published');
if (!ST.publishCheck(mk('2026-08-01', '2026-11-20-r1'), { now: NOW, corrections: fix }).ok) no('dataset with the fix blocked');
if (!ST.publishCheck(mk('2026-08-01', '2026-11-12-r1'), { now: NOW, corrections: { corrections: [{ ...fix.corrections[0], symbols: ['INFY'] }] } }).ok) no('other symbol\'s correction blocked');
if (ST.publishCheck(mk('2026-08-01', '2026-11-12-r1'), { now: NOW, corrections: { corrections: [{ ...fix.corrections[0], symbols: ['*'] }] } }).ok) no('"*" correction ignored');
if (!(ST.compareDatasetId('2026-11-12-r2', '2026-11-12-r1') > 0 && ST.compareDatasetId('2026-11-12-r9', '2026-11-13-r1') < 0 && ST.compareDatasetId('x', '2026-11-12-r1') === null)) no('compareDatasetId');
if (bad) process.exit(1);
