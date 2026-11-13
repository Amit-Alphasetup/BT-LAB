// P2 (session C): Backtest Lab on the v4 dataset - stocks in the picker, the Nifty 500 universe with its survivorship label, a 50-stock
// portfolio run through getMany with progress, the default address and its fallback chain. Synthetic v4 dataset built in memory. Silent on success.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
await import('../eod2-client.js');
const S = await import('../source.js');
const PF = await import('../portfolio.js');
const SC = await import('../schemas.js');
const B = await import('../builder.js');
const HERE = dirname(fileURLToPath(import.meta.url));

const fail = m => { console.log('P2 FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const J = o => Buffer.from(JSON.stringify(o));

// ── synthetic dataset: 60 stocks, 3 ETFs, 1 index; weekdays 2023-01-02 .. 2026-03-31; histEnd 2025-12-31 ──
function weekdays(from, to) { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); return out; }
const DATES = weekdays('2023-01-02', '2026-03-31'), LATEST = DATES[DATES.length - 1], HIST_END = '2025-12-31', ID = LATEST + '-r1';
function walk(seed, px) {
  let x = seed * 7919 % 2147483647 || 1; const rnd = () => (x = x * 48271 % 2147483647) / 2147483647;
  return DATES.map(d => { const o = px * (1 + (rnd() - 0.5) * 0.01), c = o * (1 + (rnd() - 0.48) * 0.04), h = Math.max(o, c) * 1.004, l = Math.min(o, c) * 0.996; px = c;
    return [d, +o.toFixed(4), +h.toFixed(4), +l.toFixed(4), +c.toFixed(4), 100000 + Math.floor(rnd() * 5000)]; });
}
const STOCKS = Array.from({ length: 60 }, (_, i) => 'STK' + String(i + 1).padStart(2, '0')).concat([]);
STOCKS[7] = 'M&M';                                             // a real-world name that needs URL encoding
const SYMS = [...STOCKS.map(s => [s, 'EQ']), ['NIFTYBEES', 'ETF'], ['BANKBEES', 'ETF'], ['GOLDBEES', 'ETF'], ['NIFTY 50', 'INDEX']];
function dataset({ truncate } = {}) {
  const wire = {}, files = {}, tailSeries = {};
  SYMS.forEach(([sym, kind], i) => {
    let bars = walk(i + 11, 50 + i * 13);
    if (truncate === sym) bars = bars.slice(500);
    const hb = bars.filter(b => b[0] <= HIST_END), tb = bars.slice(hb.length), id = (kind === 'INDEX' ? 'IDX:' : 'NSE:') + sym;
    const doc = J({ contract: 'alphadesk-eod2/4', provider: 'EOD2', id, symbol: sym, kind, adjustment: 'x', fields: ['date', 'open', 'high', 'low', 'close', 'volume'], bars: hb });
    const hs = sha(doc), rel = `hist/${kind}/${sym}.${hs.slice(0, 12)}.json`;
    wire[enc(rel)] = doc; (tailSeries[kind] ||= {})[sym] = tb;
    files[sym] = { id, kind, hist: { path: rel, sha256: hs, bytes: doc.length, bars: hb.length, first: hb[0][0], last: hb[hb.length - 1][0] }, tailBars: tb.length, bars: bars.length,
      first: bars[0][0], last: LATEST, firstObservedDate: bars[0][0], fields: [], status: 'OK', reasons: [], ...(truncate === sym ? { historyTruncatedFrom: bars[0][0] } : {}) };
  });
  const tails = {};
  for (const [kind, series] of Object.entries(tailSeries)) { const b = J({ kind, datasetId: ID, from: '2026-01-01', series }); wire[enc(`tail/${kind}.${ID}.json`)] = b; tails[kind] = { path: `tail/${kind}.${ID}.json`, sha256: sha(b), bytes: b.length }; }
  const cal = J({ id: 'c', sessions: DATES, verifiedThrough: '2026-12-31', coverageFrom: '2023-01-01', coverageTo: '2026-12-31', holidays: [], specialSessions: [] });
  wire['cal/x/calendar.json'] = cal;
  const manifest = { contract: 'alphadesk-eod2/4', dataset: 'EOD2', datasetId: ID, snapshotBase: '', histEnd: HIST_END, publishStatus: 'PUBLISHABLE', latestCompletedSession: LATEST, latestSession: LATEST,
    windowStart: '2019-01-14', eqHistoryFloor: '2007-01-01', adjustmentPolicy: 'eod2-split-bonus+reviewed-actions', calendar: { path: 'cal/x/calendar.json', sha256: sha(cal) }, tails, files,
    excluded: { DUMMYHEG: { code: 'NOT_IN_EOD2', kind: 'EQ' } }, quarantined: {}, pendingActions: truncate ? { [truncate]: [{ date: files[truncate].first, gap: -0.5 }] } : {} };
  wire['manifest.json'] = J(manifest);
  return { wire, manifest };
}
const asked = [];
function fetchFor(hosts) {                                       // hosts: {baseUrl: wire | null (unreachable)}
  return async url => {
    const u = String(url); asked.push(u);
    const base = Object.keys(hosts).find(b => u.startsWith(b));
    if (!base) throw new Error('request to a foreign host: ' + u);
    const w = hosts[base], b = w && w[u.slice((base + 'data/').length).split('?')[0]];
    if (!b) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
}
globalThis.fetch = async url => { throw new Error('global fetch used: ' + url); };

// ── addresses ──
ok(S.DEFAULT_BASE_URL === 'https://amit-alphasetup.github.io/Amit-Alphasetup-nse-data/' && S.LEGACY_BASE_URL === 'https://amit-alphasetup.github.io/market-data/', 'addresses');
ok(S.FALLBACK_BASE_URLS[0].startsWith('https://raw.githubusercontent.com/Amit-Alphasetup/Amit-Alphasetup-nse-data/pub/') && S.FALLBACK_BASE_URLS[1] === S.LEGACY_BASE_URL, 'fallback order');
const { wire, manifest } = dataset({ truncate: 'STK03' });

// ── default address works: v4, stocks listed, Data tab says so ──
let info = await S.openDataset(S.DEFAULT_BASE_URL, { fetch: fetchFor({ [S.DEFAULT_BASE_URL]: wire }), cache: 'memory' });
ok(info.ok && info.contract === 'alphadesk-eod2/4' && info.datasetId === ID && info.fallback === false && info.baseUrl === S.DEFAULT_BASE_URL, 'opens v4: ' + JSON.stringify(info));
ok(info.kinds.EQ === 60 && info.kinds.ETF === 3 && info.kinds.INDEX === 1 && info.truncated === 1 && info.stocksFrom === '2007-01-01', 'kinds / truncated / floor');
ok(S.listSymbols('EQ').length === 60 && S.listSymbols('EQ').includes('M&M') && S.listSymbols('ETF').length === 3, 'picker lists stocks');
let html = S.datasetHTML();
ok(html.includes('60 EQ') && html.includes('stock history from') && html.includes('shortened history'), 'Data tab head');
const row = S.datasetRows().find(r => r.symbol === 'STK03');
ok(row.reasons.some(x => x.startsWith('HISTORY_FROM ' + manifest.files.STK03.first)) && html.includes('corporate action awaiting review'), 'truncated stock says from when and why');
ok(S.datasetRows().find(r => r.symbol === 'DUMMYHEG').status === 'EXCLUDED', 'excluded stock listed');

// ── one stock through loadBars: history + tail joined, adjusted scale = raw ──
const one = await S.loadBars('M&M');
ok(one.source === 'EOD2' && one.bars.t.length === DATES.length && one.bars.adj.c === one.bars.c && S.sourceTag(one) === 'Official dataset ' + ID, 'stock loads');
ok(asked.some(u => u.includes('/hist/EQ/M%26M.')), 'the & in the name is URL-encoded on the wire');
ok(new Date(one.bars.t[one.bars.t.length - 1]).toISOString().slice(0, 10) === LATEST, 'last bar is the latest session (came from the tail)');

// ── universes ──
ok(S.UNIVERSES.NIFTY500.label === "Nifty 500 (today's list — survivorship-biased)" && S.UNIVERSES.NIFTY500.biased === true, 'universe label');
ok(S.universeSymbols('NIFTY500').length === 60 && S.universeSymbols('NIFTY500_50').length === 50 && S.universeSymbols('ETFS').length === 3 && S.universeSymbols('NOPE').length === 0, 'universe symbols');

// ── portfolio on 50 stocks through getMany, with progress ──
const fifty = S.universeSymbols('NIFTY500_50'), prog = [];
const n0 = asked.length;
const many = await S.loadMany(fifty.concat(['NOTLISTED']), { onProgress: (d, t) => prog.push(d + '/' + t), loadRecord: async () => null });
ok(Object.keys(many.records).length === 50 && many.missing.length === 1 && many.missing[0].symbol === 'NOTLISTED' && many.missing[0].reasons.includes('NOT_IN_EXPORT'), 'loadMany: 50 loaded, 1 missing');
ok(prog.length === 51 && prog[0] === '1/51' && prog[50] === '51/51', 'progress ticks once per symbol: ' + prog.slice(0, 2) + '..' + prog.slice(-1));
ok(Object.values(many.tags).every(t => t === 'Official dataset ' + ID), 'every record is labelled official');
ok(asked.slice(n0).filter(u => u.includes('/tail/EQ.')).length === 0, 'the stock tail was downloaded once (with M&M), not again for 50 stocks');
const schema = SC.getPreset(SC.PRESETS[0].id);
const res = PF.runPortfolio(many.records, schema, { slots: 10, capital: 500000, ranking: Object.keys(PF.RANKING_RULES)[0], raw: false });
const chk = PF.conservationCheck(res, many.records);
ok(res.trades.length > 0 && chk.ok && res.equity.length > 500, `portfolio ran: ${res.trades.length} trades, books balance ${chk.ok}`);

// ── default address unreachable: same branch from raw.githubusercontent, said so; then the v3 dataset ──
info = await S.openDataset(S.DEFAULT_BASE_URL, { fetch: fetchFor({ [S.DEFAULT_BASE_URL]: null, [S.FALLBACK_BASE_URLS[0]]: wire }), cache: 'memory' });
ok(info.ok && info.fallback === true && info.baseUrl === S.FALLBACK_BASE_URLS[0] && info.kinds.EQ === 60, 'fallback 1: raw GitHub');
ok(S.datasetHTML().includes('served from') && S.datasetHTML().includes('raw.githubusercontent.com'), 'Data tab says where the data came from');
info = await S.openDataset(S.DEFAULT_BASE_URL, { fetch: fetchFor({ [S.DEFAULT_BASE_URL]: null, [S.FALLBACK_BASE_URLS[0]]: null, [S.LEGACY_BASE_URL]: null }), cache: 'memory' });
ok(info.ok === false && info.code === 'SOURCE_UNAVAILABLE', 'nothing reachable is reported, not thrown');
// a custom address never falls back silently
info = await S.openDataset('https://example.test/mine/', { fetch: fetchFor({ 'https://example.test/mine/': null, [S.DEFAULT_BASE_URL]: wire }), cache: 'memory' });
ok(info.ok === false, 'custom address: no silent fallback');

// ── page ──
const page = readFileSync(join(HERE, '..', 'index.html'), 'utf8'), ui = readFileSync(join(HERE, '..', 'ui.js'), 'utf8');
for (const id of ['pf-universe', 'pf-bias', 'pf-symbols']) ok(page.includes(`id="${id}"`), 'page has #' + id);
ok(page.includes("Nifty 500 (today's list — survivorship-biased)") && page.includes('Survivorship-biased'), 'universe option and warning on the page');
ok(ui.includes('SRC.loadMany(') && ui.includes("['universe', uni.label") && ui.includes("['Universe', res.universe.label"), 'portfolio uses loadMany and labels the universe on status and result');
ok(readFileSync(join(HERE, '..', 'eod2-client.js'), 'utf8').includes("alphadesk-eod2/4"), 'vendored client reads v4');
console.log(`p2 ok: v4 dataset, 60 stocks listed, 50-stock portfolio (${res.trades.length} trades) via getMany, fallback chain, universe label`);
