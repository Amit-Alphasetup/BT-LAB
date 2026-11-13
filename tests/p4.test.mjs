// P4: signals (5 hand-computed cases), quotes against a stubbed Worker, compare, sheet diff, LTI / SIP, Monte Carlo, fingerprint.
// Writes tests/fixtures/p4_crosscheck.json for the Python check of XIRR and CAGR. Silent on success.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSignals, scanSignals, orderText } from '../signals.js';
import { getQuotes, quoteBadge, BATCH } from '../quotes.js';
import { compare, toCSV, runXirr } from '../compare.js';
import { xirr, cagrPct, ltiBenchmark, sipBenchmark, sheetDiff, parseSheetRows, monteCarlo, fingerprint } from '../extras.js';
import { runBtdesk } from '../presets-btdesk.js';
import { getPreset } from '../schemas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fail = m => { console.log('P4 FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const D0 = Date.parse('2024-01-01T00:00:00Z');
/** record from [o,h,l,c] rows on consecutive calendar days */
function rec(rows, sym = 'TST') { const col = k => Float64Array.from(rows, r => r[k]); return { symbol: sym, t: Float64Array.from(rows, (_, i) => D0 + i * 86400000), o: col(0), h: col(1), l: col(2), c: col(3), vol: new Float64Array(rows.length).fill(1e6), adj: null }; }
const flat = (n, p) => Array.from({ length: n }, () => [p, p + 1, p - 1, p]);
const day = i => new Date(D0 + i * 86400000).toISOString().slice(0, 10);
const P = { perTxAmount: 5000, maxBuys: 5 };

// ───────────── signals: 5 hand-computed cases (level, quantity, order type) ─────────────
// Case 1 — SST, armed, GTT buy. 205 quiet bars 99..101, then a bar whose low 95 sets a new 20-day low (arms), then one quiet bar.
// Level for tomorrow = highest high of the last 20 bars = 101. Quantity = floor(5000 / 101) = 49.
let rows = flat(205, 100).concat([[100, 100.5, 95, 96], [96, 97, 95.5, 96.5]]);
let s = buildSignals(rec(rows), 'sst', P, { start: day(201) });
let c = s.cards.find(x => x.kind === 'gtt_buy');
ok(c && c.orderType === 'stop_buy' && near(c.level, 101) && c.qty === 49 && c.lot === 1, 'case 1 SST GTT buy: ' + JSON.stringify(s.cards));
ok(c.text === 'BUY TST qty 49 — GTT buy, trigger ₹101.00; if it opens above, it fills at the open', 'case 1 order text: ' + c.text);
ok(!s.cards.some(x => x.kind === 'exit'), 'case 1: flat, so no exit card');

// Case 2 — SST, holding one lot, exit card. Continue case 1: next bar breaks 101 (high 103, low 100): buy stop fills at 101 (open 100.5 below it).
// Target = 101 x 1.0628 = 107.3428 for the 49 shares. The arm is consumed by the buy, so no new buy card.
rows = rows.concat([[100.5, 103, 100, 102], [102, 103, 101.5, 102.5]]);
s = buildSignals(rec(rows), 'sst', P, { start: day(201) });
c = s.cards.find(x => x.kind === 'exit');
ok(c && c.orderType === 'limit_sell' && near(c.level, 101 * 1.0628) && c.qty === 49 && near(c.avg, 101), 'case 2 SST exit: ' + JSON.stringify(s.cards));
ok(c.text === 'SELL TST qty 49 — GTT limit sell at ₹107.34', 'case 2 text: ' + c.text);
ok(!s.cards.some(x => x.kind === 'gtt_buy') && s.cards.some(x => x.kind === 'near' && /not armed/.test(x.note)), 'case 2: arm consumed -> near card, no buy');

// Case 3 — BLSH, at-close buy tomorrow. 30 bars closing 100 (25-day low close 100 -> trigger 105), then a close of 106 crossing it.
// The buy is at the NEXT close; quantity estimated on the last close: floor(5000 / 106) = 47.
rows = flat(205, 100).concat([[100, 107, 100, 106]]);
s = buildSignals(rec(rows), 'blsh', P, { start: day(200) });
c = s.cards.find(x => x.kind === 'at_close_buy');
ok(c && c.orderType === 'at_close' && c.qty === 47 && near(c.level, 106) && c.lot === 1, 'case 3 BLSH at-close buy: ' + JSON.stringify(s.cards));

// Case 4 — SST 2.0 LIFO ladder. Arm (low 95), next bar buy stop at 101 with the open at 102 -> fills 102, qty floor(5000/102) = 49,
// target 102 x 1.06 = 108.12. One lot in the ladder; the bar after a buy is not armed.
rows = flat(205, 100).concat([[100, 100.5, 95, 96], [102, 104, 101.5, 103], [103, 104, 102, 103]]);
s = buildSignals(rec(rows), 'sstlifo', P, { start: day(201) });
c = s.cards.find(x => x.kind === 'ladder');
ok(c && c.lots.length === 1 && c.lots[0].qty === 49 && near(c.lots[0].bought, 102) && near(c.lots[0].target, 108.12) && c.orderType === 'limit_sell', 'case 4 LIFO ladder: ' + JSON.stringify(s.cards));
ok(c.text === 'SELL TST qty 49 — GTT limit sell at ₹108.12', 'case 4 text: ' + c.text);

// Case 5 — SuperBreakout near-trigger. 205 bars at 100 then a close of 99.5: below the averages (all about 100). Nothing to place;
// the card gives the level (the highest of the six averages) and says it is near (within 2%).
rows = flat(205, 100).concat([[100, 100.5, 99, 99.5]]);
s = buildSignals(rec(rows), 'superbreakout', P, { start: day(200), nearPct: 2 });
c = s.cards[0];
const sma5 = (100 * 4 + 99.5) / 5;
const sma200 = (100 * 199 + 99.5) / 200;                       // 99.9975: the highest of the six (the 5-day average is 99.9)
ok(s.cards.length === 1 && c.kind === 'near' && near(c.level, sma200) && c.isNear === true && near(c.distancePct, (sma200 / 99.5 - 1) * 100) && sma5 < sma200, 'case 5 SuperBreakout near: ' + JSON.stringify(c));
// and when the close IS above all six averages while flat: an at-close buy for the whole amount (5000 x 5 = 25000 -> floor(25000/103) = 242)... already bought at that close by the rules:
rows = flat(205, 100).concat([[100, 104, 100, 103]]);
s = buildSignals(rec(rows), 'superbreakout', P, { start: day(200) });
ok(s.cards.length === 1 && s.cards[0].kind === 'exit' && s.cards[0].qty === 242 && near(s.cards[0].level, 103 * 1.0471), 'SuperBreakout bought at the close -> exit card: ' + JSON.stringify(s.cards));
// scan: orders before near cards; an instrument with too little history is reported, not thrown
const scan = scanSignals({ AAA: rec(flat(205, 100).concat([[100, 100.5, 95, 96], [96, 97, 95.5, 96.5]]), 'AAA'), TINY: rec(flat(5, 50), 'TINY') }, ['sstlifo', 'sst'], P, { start: day(201) });
ok(scan.cards[0].kind === 'gtt_buy' && scan.skipped.length === 2 && scan.skipped[0].symbol === 'TINY', 'scan order and skipped: ' + JSON.stringify(scan.skipped));
ok(orderText({ kind: 'near', symbol: 'X', note: 'waiting' }) === 'X: nothing to place — waiting', 'near text');

// ───────────── quotes against a stubbed Worker ─────────────
const T = Date.parse('2026-11-12T08:00:00Z');                    // Thursday 13:30 IST: market open
ok(quoteBadge(T - 60000, T) === 'provisional' && quoteBadge(T - 20 * 60000, T) === 'stale' && quoteBadge(NaN, T) === 'untimed', 'badges in market hours');
const EVE = Date.parse('2026-11-12T13:00:00Z'), CLOSE = Date.parse('2026-11-12T10:00:00Z');                  // 18:30 IST; 15:30 IST
ok(quoteBadge(CLOSE, EVE) === 'final' && quoteBadge(T, EVE) === 'stale', 'after the close: closing price final, a mid-day price stale');
ok(quoteBadge(CLOSE, Date.parse('2026-11-14T06:00:00Z')) === 'final' && quoteBadge(CLOSE, Date.parse('2026-11-13T05:00:00Z')) === 'stale', 'weekend: last close final; next session trading: stale');
ok(quoteBadge(T + 3600000, T) === 'stale', 'a quote from the future is not current');
const syms = Array.from({ length: 230 }, (_, i) => 'S' + i), calls = [];
const worker = async url => {
  const u = new URL(url); calls.push(u);
  const list = u.searchParams.get('symbols').split(',');
  const quotes = list.filter(x => x !== 'S7' && x !== 'S150').map(x => ({ symbol: x, price: 100 + +x.slice(1), open: 99, high: 101, low: 98, changePct: 1, asOf: new Date(T - 30000).toISOString(), tradingSymbol: x }));
  quotes.push({ symbol: 'INTRUDER', price: 5, asOf: new Date(T).toISOString() });
  return { ok: true, status: 200, json: async () => ({ ok: true, quotes, unresolved: list.includes('S7') ? [{ symbol: 'S7', error: 'NO_INSTRUMENT' }] : [] }) };
};
let q = await getQuotes(syms, { workerUrl: 'https://bridge.test/', fetch: worker, now: T });
ok(BATCH === 100 && q.requests === 3 && calls.map(u => u.searchParams.get('symbols').split(',').length).join() === '100,100,30', 'batches of 100: ' + calls.length);
ok(calls[0].pathname === '/quotes' && Object.keys(q.quotes).length === 228 && !q.quotes.INTRUDER, 'path, count, a symbol that was not asked for is dropped');
ok(q.quotes.S5.price === 105 && q.quotes.S5.badge === 'provisional' && q.badge === 'provisional' && q.asOf === T - 30000, 'quote fields and badge');
ok(q.unresolved.length === 2 && q.unresolved.find(u => u.symbol === 'S7').error === 'NO_INSTRUMENT' && q.unresolved.find(u => u.symbol === 'S150').error === 'NOT_RETURNED', 'unresolved: ' + JSON.stringify(q.unresolved));
q = await getQuotes(['A', 'B'], { workerUrl: 'https://bridge.test', fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, quotes: [{ symbol: 'A', price: 10, asOf: new Date(T - 3600000).toISOString() }, { symbol: 'B', price: 20 }] }) }), now: T });
ok(q.quotes.A.badge === 'stale' && q.quotes.B.badge === 'untimed' && q.badge === 'stale', 'stale and untimed badges');
q = await getQuotes(['A'], { workerUrl: 'https://bridge.test', fetch: async () => { throw new Error('Origin not allowed'); }, now: T });
ok(!q.ok && q.unresolved[0].error === 'REQUEST_FAILED' && /Origin not allowed/.test(q.error), 'a failed request is reported, not thrown');
q = await getQuotes(['A'], { workerUrl: '', now: T });
ok(!q.ok && /not set/.test(q.error) && q.requests === 0, 'no Worker address');

// ───────────── XIRR, LTI, SIP ─────────────
ok(near(xirr([{ t: D0, v: -1000 }, { t: D0 + 365 * 86400000, v: 1100 }]), 0.10, 1e-9), 'XIRR 10% in one year');
ok(Number.isNaN(xirr([{ t: D0, v: -1000 }])) && Number.isNaN(xirr([{ t: D0, v: 5 }, { t: D0 + 1e9, v: 6 }])), 'XIRR needs money out and money in');
// price doubles 100 -> 200 over 730 days
const ramp = Array.from({ length: 731 }, (_, i) => { const p = 100 + i * (100 / 730); return [p, p, p, p]; });
const lti = ltiBenchmark(rec(ramp), 10050, day(0));
ok(lti.qty === 100 && near(lti.invested, 10000) && near(lti.leftover, 50) && near(lti.finalValue, 20050) && near(lti.cagr, cagrPct(10050, 20050, D0, D0 + 730 * 86400000), 1e-9), 'LTI: ' + JSON.stringify({ ...lti, equity: 0 }));
ok(near(lti.xirr, (Math.pow(2, 365 / 730) - 1) * 100, 1e-6), 'LTI XIRR = doubling in two years: ' + lti.xirr);
const sip = sipBenchmark(rec(ramp), 24000, day(0));
ok(sip.instalments === 24 && sip.dates[0] === '2024-01-01' && sip.dates[1] === '2024-02-01' && near(sip.perInstalment, 1000), 'SIP schedule: ' + sip.instalments + ' ' + sip.dates.slice(0, 2));
ok(sip.qty > 0 && near(sip.invested + sip.leftover, 24000, 1e-6) && sip.xirr > 0 && sip.xirr < lti.xirr * 3, 'SIP books: ' + JSON.stringify({ q: sip.qty, inv: sip.invested, x: sip.xirr }));
ok(ltiBenchmark(rec(flat(10, 100)), 50, day(0)).qty === 0 && ltiBenchmark(rec(flat(10, 100)), 50, '2030-01-01').ok === false, 'LTI: unaffordable share stays cash; no bar after start');

// ───────────── sheet diff ─────────────
const app = [{ entryDate: D0, entryPrice: 100, exitDate: D0 + 5 * 86400000, exitPrice: 110, qty: 50 }, { entryDate: D0 + 10 * 86400000, entryPrice: 105, exitDate: D0 + 12 * 86400000, exitPrice: 111.3, qty: 47 }, { entryDate: D0 + 20 * 86400000, entryPrice: 90, exitDate: null, exitPrice: null, qty: 55 }];
const sheet = parseSheetRows('Entry,Price,Exit,Price,Qty\n2024-01-01,100.004,2024-01-06,110,50\n2024-01-11,105,2024-01-13,112.5,47\n2024-02-15,80,2024-02-20,88,62\n');
ok(sheet.length === 3 && sheet[1].exitPrice === 112.5, 'sheet rows parsed, header skipped');
const df = sheetDiff(app, sheet);
ok(df.matched === 1 && df.differing.length === 1 && df.differing[0].entryDate === '2024-01-11' && df.differing[0].fields.exitPrice.join() === '111.3,112.5', 'diff: ' + JSON.stringify(df.differing));
ok(df.onlyApp.length === 1 && df.onlyApp[0].entryDate === '2024-01-21' && df.onlySheet.length === 1 && df.onlySheet[0].entryDate === '2024-02-15' && df.ok === false, 'only-app / only-sheet');
ok(sheetDiff(app.slice(0, 1), sheet.slice(0, 1)).ok === true, 'within tolerance = same');

// ───────────── Monte Carlo ─────────────
const pn = [500, -200, 300, -400, 800, -100, 250, -350, 600, 150];
const mc = monteCarlo(pn, { runs: 500, seed: 7, capital: 10000 });
ok(mc.ok && mc.runs === 500 && near(mc.final, 10000 + pn.reduce((a, b) => a + b, 0)) && mc.maxDD.p5 <= mc.maxDD.p50 && mc.maxDD.p50 <= mc.maxDD.p95, 'Monte Carlo ordered percentiles');
ok(JSON.stringify(monteCarlo(pn, { runs: 500, seed: 7, capital: 10000 })) === JSON.stringify(mc) && JSON.stringify(monteCarlo(pn, { runs: 500, seed: 8, capital: 10000 })) !== JSON.stringify(mc), 'same seed same answer');
// actual order: equity 10500, 10300, 10600, 10200 ... worst fall from a peak: 10600 -> 10200 = 3.7736%
ok(near(mc.actual.maxDD, (10600 - 10200) / 10600 * 100, 1e-9) && monteCarlo([1, 2, 3]).ok === false, 'actual drawdown by hand; too few trades refused');

// ───────────── fingerprint ─────────────
const fa = await fingerprint({ datasetId: '2026-11-12-r1', symbol: 'RELIANCE', strategy: { id: 'sst', params: { a: 1, b: 2 } }, options: { raw: false } });
const fb = await fingerprint({ options: { raw: false }, strategy: { params: { b: 2, a: 1 }, id: 'sst' }, symbol: 'RELIANCE', datasetId: '2026-11-12-r1' });
const fc = await fingerprint({ datasetId: '2026-11-12-r2', symbol: 'RELIANCE', strategy: { id: 'sst', params: { a: 1, b: 2 } }, options: { raw: false } });
ok(/^[0-9a-f]{64}$/.test(fa) && fa === fb && fa !== fc, 'fingerprint: key order does not matter, the dataset does');

// ───────────── compare on real series (oracle fixtures) + CSV ─────────────
const ORACLE = join(HERE, '..', '..', 'oracle', 'fixtures', 'series');
const load = sym => { const d = JSON.parse(readFileSync(join(ORACLE, sym + '.json'), 'utf8')), col = k => Float64Array.from(d.bars, r => r[k]); return { symbol: sym, t: Float64Array.from(d.bars, r => Date.parse(r[0] + 'T00:00:00Z')), o: col(1), h: col(2), l: col(3), c: col(4), vol: col(5), adj: null }; };
const cut = (r, from) => { const a = Array.from(r.t).findIndex(t => new Date(t).toISOString().slice(0, 10) >= from); const sl = x => x.slice(a); return { ...r, t: sl(r.t), o: sl(r.o), h: sl(r.h), l: sl(r.l), c: sl(r.c), vol: sl(r.vol) }; };
const recs = { RELIANCE: cut(load('RELIANCE'), '2013-01-01'), INFY: cut(load('INFY'), '2013-01-01') };
const strategies = [{ kind: 'btdesk', id: 'sst', params: P }, { kind: 'btdesk', id: 'sstlifo', params: P }, { kind: 'schema', schema: getPreset('golden_cross') }];
const cmp = compare(strategies, recs, { start: '2015-01-01' });
ok(cmp.rows.length === 6 && cmp.summary.length === 3 && cmp.skipped.length === 0, 'compare rows: ' + cmp.rows.length);
ok(cmp.rows.every(r => Number.isFinite(r.cagr) && Number.isFinite(r.maxDD) && r.maxDD >= 0 && Number.isFinite(r.xirr)), 'every row has CAGR, XIRR, drawdown: ' + JSON.stringify(cmp.rows.find(r => !Number.isFinite(r.xirr))));
ok(cmp.summary[0].xirr >= cmp.summary[1].xirr && cmp.summary[1].xirr >= cmp.summary[2].xirr && cmp.summary.every(x => x.symbols === 2), 'summary ranked by median XIRR');
const sstRow = cmp.rows.find(r => r.strategy === 'SST (FIFO)' && r.symbol === 'RELIANCE'), direct = runBtdesk(recs.RELIANCE, 'sst', P, { start: '2015-01-01' });
ok(sstRow.trades === direct.trades.length && near(sstRow.xirr, runXirr(direct, recs.RELIANCE), 1e-9), 'compare row = a direct run');
const csv = toCSV(cmp, { dataset: '2026-11-12-r1', universe: 'test' }).trim().split('\n');
ok(csv[0] === '# dataset,"2026-11-12-r1"' && csv[2].split(',').length === 10 && csv.slice(2).every(l => l.split(',').length === 10) && csv.length === 2 + 1 + 6, 'CSV aligned: ' + csv[2]);

// material for the Python cross-check
writeFileSync(join(HERE, 'fixtures', 'p4_crosscheck.json'), JSON.stringify({
  lti: { start: 10050, end: lti.finalValue, days: 730, cagr: lti.cagr, flows: [[0, -10000], [730, 20000]], xirr: lti.xirr },
  sip: { flows: sip.dates.map((d, k) => [Math.round((Date.parse(d) - D0) / 86400000), null]).length, xirr: sip.xirr },
  sipFlows: (() => { const r = rec(ramp), out = []; let cash = 0, qty = 0; const per = 1000; let prev = ''; for (let i = 0; i < 731; i++) { const ym = day(i).slice(0, 7); if (ym !== prev) { prev = ym; cash += per; const k = Math.floor(cash / r.c[i]); if (k) { qty += k; cash -= k * r.c[i]; out.push([i, -k * r.c[i]]); } } } out.push([730, qty * r.c[730]]); return out; })(),
  run: { flows: direct.fills.map(f => [Math.round((recs.RELIANCE.t[f.i] - recs.RELIANCE.t[0]) / 86400000), (f.side === 'buy' ? -1 : 1) * f.price * f.qty]).concat(direct.open ? [[Math.round((recs.RELIANCE.t[recs.RELIANCE.t.length - 1] - recs.RELIANCE.t[0]) / 86400000), direct.open.value]] : []).concat(direct.trades.map(t => [Math.round((t.exitDate - recs.RELIANCE.t[0]) / 86400000), -t.costs])), xirr: sstRow.xirr },
}));
console.log(`p4 ok: 5 signal cases, quotes (3 batches, badges, unresolved), compare ${cmp.rows.length} runs + CSV, sheet diff, LTI/SIP, Monte Carlo, fingerprint`);
