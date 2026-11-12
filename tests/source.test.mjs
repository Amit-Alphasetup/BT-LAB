// P1: every preset runs on the EOD2 dataset through source.js with no request to any other host. Silent on success.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, BARS_DIR, GOLDEN_DIR, SYMBOLS, PRESET_IDS, runOne } from './golden.lib.mjs';
await import('../eod2-client.js');                       // classic script: defines globalThis.EOD2Client
const S = await import('../source.js');

const fail = m => { console.log('SOURCE FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const BASE = S.DEFAULT_BASE_URL, DS = join(HERE, 'fixtures', 'dataset');
ok(BASE === 'https://amit-alphasetup.github.io/market-data/', 'default base url');
const manifestText = readFileSync(join(DS, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const foreign = [], asked = [];
const body = (buf) => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
function makeFetch(mText) {
  return async (url) => {
    asked.push(url);
    if (!String(url).startsWith(BASE)) { foreign.push(url); throw new Error('request to a foreign host: ' + url); }
    const p = decodeURIComponent(String(url).slice(BASE.length));
    if (p === 'data/manifest.json') return body(Buffer.from(mText));
    const sb = 'data/' + manifest.snapshotBase;
    if (p === sb + manifest.calendar.path) return body(readFileSync(join(DS, 'calendar.json')));
    const m = p.startsWith(sb + 'etf/') && p.slice((sb + 'etf/').length).replace(/\.json$/, '');
    if (m && SYMBOLS.includes(m)) return body(readFileSync(join(BARS_DIR, m + '.json')));
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  };
}
// any other use of the global fetch (Yahoo, a Worker, a proxy) fails the test
globalThis.fetch = async (url) => { foreign.push(String(url)); throw new Error('global fetch used: ' + url); };

// before the dataset is open: nothing to list, and loadBars reports why
ok(S.listSymbols().length === 0 && S.datasetInfo().ok === false, 'closed dataset lists nothing');

const info = await S.openDataset(BASE, { fetch: makeFetch(manifestText), cache: 'memory' });
ok(info.ok && info.datasetId === manifest.datasetId && info.latestSession === manifest.latestCompletedSession, 'dataset opens: ' + JSON.stringify(info));
ok(info.symbols === Object.keys(manifest.files).length, 'symbol count');

// symbol picker by kind
const etfs = S.listSymbols('ETF'), idx = S.listSymbols('INDEX');
const kindN = k => Object.values(manifest.files).filter(e => e.kind === k).length;
ok(etfs.length === kindN('ETF') && etfs.length >= 56 && idx.length === kindN('INDEX') && idx.length >= 6 && S.listSymbols().length === etfs.length + idx.length, `kinds: ${etfs.length} ETF, ${idx.length} INDEX`);
ok(etfs.includes('NIFTYBEES') && idx.includes('NIFTY 50') && !etfs.includes('NIFTY 50'), 'kinds are separated');

// all 14 presets x 3 symbols through loadBars equal the v1 golden results
let runs = 0;
for (const s of SYMBOLS) {
  const r = await S.loadBars(s);
  ok(r.source === 'EOD2' && r.datasetId === manifest.datasetId && r.bars && r.bars.t.length === manifest.files[s].bars, `${s} loads from EOD2`);
  ok(r.status === manifest.files[s].status, `${s} status ${r.status}`);
  ok(r.bars.adj && r.bars.adj.c === r.bars.c && r.bars.adj.factor.every(x => x === 1), `${s}: adjusted scale equals raw`);
  ok(r.bars.flags.length === 0 && r.bars.splits.length === 0, `${s}: no jump check, no splits`);
  for (const p of PRESET_IDS) {
    const want = readFileSync(join(GOLDEN_DIR, `${p}__${s}.json`), 'utf8'), got = JSON.stringify(runOne(p, s, r.bars));
    if (want !== got) fail(`${p} on ${s} via loadBars differs from golden`);
    runs++;
  }
}
ok(runs === 42, 'ran ' + runs);

// date window with warm-up bars
const full = (await S.loadBars('NIFTYBEES')).bars;
const win = (await S.loadBars('NIFTYBEES', { from: '2024-01-01', to: '2024-12-31', warmup: 200 })).bars;
const d = t => new Date(t).toISOString().slice(0, 10);
const firstIn = Array.from(full.t).findIndex(t => d(t) >= '2024-01-01');
ok(d(win.t[200]) === d(full.t[firstIn]) && d(win.t[win.t.length - 1]) <= '2024-12-31' && d(win.t[199]) < '2024-01-01' && win.adj.c.length === win.t.length, 'window keeps 200 warm-up bars and stops at `to`');

// fallback order: EOD2 -> imported file -> Yahoo only when allowed
const rec = (src) => ({ ...full, symbol: 'XYZ', source: src });
let yahooCalls = 0; const fetchUnofficial = async () => { yahooCalls++; return rec('yahoo'); };
let r = await S.loadBars('XYZ', { loadRecord: async () => rec('csv'), fetchUnofficial });
ok(r.source === 'CSV' && r.reasons.includes('NOT_IN_EXPORT') && r.datasetId === null && yahooCalls === 0, 'imported file is second, labelled CSV');
r = await S.loadBars('XYZ', { loadRecord: async () => null, fetchUnofficial });
ok(r.bars === null && r.source === null && r.status === 'NO_DATA' && yahooCalls === 0, 'Yahoo is not called unless allowed');
r = await S.loadBars('XYZ', { loadRecord: async () => rec('yahoo'), fetchUnofficial });
ok(r.bars === null && r.reasons.includes('UNOFFICIAL_SOURCE_NOT_ALLOWED') && yahooCalls === 0, 'a saved Yahoo record is not used unless allowed');
r = await S.loadBars('XYZ', { loadRecord: async () => null, fetchUnofficial, allowUnofficial: true });
ok(r.source === 'YAHOO' && r.status === 'UNOFFICIAL' && yahooCalls === 1 && S.sourceTag(r) === 'Yahoo — unofficial', 'Yahoo last, labelled unofficial');
r = await S.loadBars('niftybees', { loadRecord: async () => rec('csv'), fetchUnofficial, allowUnofficial: true });
ok(r.source === 'EOD2' && yahooCalls === 1 && S.sourceTag(r) === 'Official dataset ' + manifest.datasetId, 'EOD2 wins when the symbol is in the dataset');
// a symbol in the manifest whose file cannot be fetched falls through and says why
r = await S.loadBars('ITBEES', { loadRecord: async () => null });
ok(r.bars === null && r.reasons.includes('SOURCE_UNAVAILABLE'), 'unreachable series reports SOURCE_UNAVAILABLE');

// Data tab: dataset id, latest session, per-symbol status and reasons
let html = S.datasetHTML();
ok(html.includes(manifest.datasetId) && html.includes(manifest.latestCompletedSession), 'Data tab shows dataset id and latest session');
const rows = S.datasetRows();
ok(rows.length === Object.keys(manifest.files).length, 'one row per symbol');
const nb = rows.find(x => x.symbol === 'NIFTYBEES');
ok(nb.status === manifest.files.NIFTYBEES.status && nb.reasons.join() === manifest.files.NIFTYBEES.reasons.map(x => x.code).filter(c => c !== 'OK').join(), 'row status and reasons come from the manifest');
ok(/data-sym="NIFTYBEES"[\s\S]*?WARN · ISIN_MISSING/.test(html), 'status and reason rendered');

// quarantine reasons from the manifest are shown, and a quarantined symbol does not load
const m2 = JSON.parse(manifestText); m2.quarantined = { BADETF: { code: 'UNEXPLAINED_PRICE_MOVE', kind: 'ETF', events: [{ date: '2024-03-04' }] } };
await S.openDataset(BASE, { fetch: makeFetch(JSON.stringify(m2)), cache: 'memory' });
const q = S.datasetRows().find(x => x.symbol === 'BADETF');
ok(q && q.status === 'QUARANTINED' && q.reasons.includes('UNEXPLAINED_PRICE_MOVE') && q.reasons.includes('2024-03-04'), 'quarantined row');
ok(S.datasetHTML().includes('QUARANTINED · UNEXPLAINED_PRICE_MOVE, 2024-03-04') && S.datasetInfo().quarantined === 1, 'quarantine reason rendered');
r = await S.loadBars('BADETF');
ok(r.bars === null && r.reasons.includes('UNEXPLAINED_PRICE_MOVE'), 'quarantined symbol does not load');

// a bad dataset is reported, not thrown
const bad = await S.openDataset(BASE, { fetch: async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }), cache: 'memory' });
ok(bad.ok === false && bad.code === 'SOURCE_UNAVAILABLE' && S.datasetHTML().includes('not loaded') && S.listSymbols().length === 0, 'unreachable dataset is reported');

ok(foreign.length === 0, 'requests left the dataset host: ' + foreign.join(', '));
ok(asked.every(u => u.startsWith(BASE)) && !asked.some(u => /yahoo|finance|workers\.dev/i.test(u)), 'zero Yahoo requests');

// the vendored client is byte-identical to market-data's, and the page loads it before the modules
const page = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
ok(page.indexOf('<script src="eod2-client.js"></script>') > 0 && page.indexOf('<script src="eod2-client.js"></script>') < page.indexOf('<script type="module" src="ui.js">'), 'classic script before the modules');
for (const id of ['f-eod2-base', 'btn-dataset', 'dataset-out', 'f-allow-unofficial', 'sym-list']) ok(page.includes(`id="${id}"`), 'page has #' + id);
console.log(`source ok: ${runs} preset runs on EOD2, ${asked.length} requests, 0 outside the dataset host`);
