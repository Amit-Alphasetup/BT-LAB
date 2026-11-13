// P3 engine v2: schema migration (v1 results unchanged), the order model inside runBacktest, one price scale, run invariants. Silent on success.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBacktest, checkInvariants, SCHEMA_VERSION } from '../engine.js';
import { PRESETS, getPreset, migrate, validateSchema } from '../schemas.js';
import * as B from '../builder.js';
import { GOLDEN_DIR, SYMBOLS, PRESET_IDS, runOne, loadRecord } from './golden.lib.mjs';

const fail = m => { console.log('ENGINE2 FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const D0 = Date.parse('2024-01-01T00:00:00Z');
/** bars from rows [o,h,l,c]; optional adj rows on a second scale */
function rec(rows, adjRows) {
  const col = (r, k) => Float64Array.from(r, x => x[k]);
  const out = { symbol: 'T', t: Float64Array.from(rows, (_, i) => D0 + i * 86400000), o: col(rows, 0), h: col(rows, 1), l: col(rows, 2), c: col(rows, 3), vol: new Float64Array(rows.length).fill(1e6), adj: null };
  if (adjRows) out.adj = { o: col(adjRows, 0), h: col(adjRows, 1), l: col(adjRows, 2), c: col(adjRows, 3), factor: new Float64Array(rows.length).fill(1) };
  return out;
}
const base = (over = {}) => migrate({ schemaVersion: 1, id: 't', label: 't', indicators: [], entry: { join: 'ALL', conditions: [['gt', 'close', 100]] },
  exit: { accounting: 'FIFO', targetPct: 10 }, pyramiding: { enabled: false }, sizing: { mode: 'fixed', value: 10000, capital: 100000 },
  costs: { preset: 'none', slippageBps: 0, gapAware: false, volumeCapPct: 0 }, ...over });
const flat = (n, p = 90) => Array.from({ length: n }, () => [p, p, p, p]);

// ── migration ──
ok(SCHEMA_VERSION === 2 && PRESETS.every(p => p.schemaVersion === 1), 'presets are stored as v1, engine is v2');
for (const id of PRESET_IDS) {
  const s = getPreset(id);
  ok(s.schemaVersion === 2 && s.entry.order.type === 'market_open' && s.exit.order.type === 'market_open' && s.sameBarExit === 'never', id + ' migrates to market_open / never');
  ok(validateSchema(s).length === 0 || id === 'buy_hold' || validateSchema(s).every(e => !/order|sameBar|version/.test(e)), id + ' validates: ' + validateSchema(s).join('; '));
  const rt = B.roundTrip(s);
  ok(rt.entry.order.type === 'market_open' && rt.sameBarExit === 'never' && rt.schemaVersion === 2, id + ' keeps its orders through the form');
}
ok(['smart_averaging', 'sst_v1', 'sst_2_lifo'].every(id => /v1 approximation/.test(getPreset(id).label)), 'next-open approximations are labelled');
ok(JSON.stringify(migrate(migrate(PRESETS[0]))) === JSON.stringify(migrate(PRESETS[0])), 'migrate is idempotent');
let threw = false; try { migrate({ schemaVersion: 3 }); } catch (e) { threw = /newer version/.test(e.message); } ok(threw, 'newer schema refused');
ok(B.migrateSchema({ id: 'x', entry: { conditions: [['gt', 'close', 1]] }, exit: { targetPct: 5 } }).schemaVersion === 2, 'pre-versioning file migrates');
ok(validateSchema(base({ entry: { join: 'ALL', conditions: [['gt', 'close', 1]], order: { type: 'stop_buy' } } })).some(e => /needs a price level/.test(e)), 'stop_buy without a level is invalid');
ok(validateSchema(base({ exit: { order: { type: 'limit_sell' } } })).some(e => /needs a target/.test(e)), 'limit_sell exit without a target is invalid');

// ── v1 results unchanged + invariants on every golden run (42) ──
let runs = 0;
for (const s of SYMBOLS) {
  const r = loadRecord(s);
  for (const p of PRESET_IDS) {
    if (readFileSync(join(GOLDEN_DIR, `${p}__${s}.json`), 'utf8') !== JSON.stringify(runOne(p, s, r))) fail(`${p} on ${s}: migrated schema differs from the v1 golden result`);
    const res = runBacktest(r, getPreset(p), { raw: false }), inv = checkInvariants(res, r);
    ok(inv.ok, `${p} on ${s} invariants: ${inv.problems.slice(0, 2).join('; ')}`);
    ok(res.fills.every(f => f.type === 'market_open'), `${p} on ${s}: every v1 fill is market_open`);
    runs++;
  }
}

// ── market_open (default): signal on bar 2's close, fill at bar 3's open; target signalled on a close, sold at the next open ──
let rows = flat(2).concat([[100, 102, 99, 101], [103, 104, 102, 103], [103, 115, 103, 114], [116, 117, 115, 116], [116, 116, 116, 116]]);
let res = runBacktest(rec(rows), base(), {});
ok(res.trades[0].entryPrice === 103 && res.trades[0].entryIdx === 3 && res.trades[0].exitPrice === 116 && res.trades[0].exitIdx === 5, 'market_open: ' + JSON.stringify(res.trades[0]));

// ── at_close entry fills on the signal bar itself; resting limit_sell target ──
const atClose = (over = {}) => base({ entry: { join: 'ALL', conditions: [['gt', 'close', 100]], order: { type: 'at_close' } }, exit: { accounting: 'FIFO', targetPct: 10, order: { type: 'limit_sell' } }, ...over });
rows = flat(2).concat([[100, 102, 99, 101], [101, 105, 100, 104], [104, 112, 104, 111.5], [111, 111, 111, 111]]);
res = runBacktest(rec(rows), atClose(), {});
let t = res.trades[0];
ok(t.entryIdx === 2 && t.entryPrice === 101, 'at_close buys the signal bar close: ' + JSON.stringify(t));
ok(t.exitIdx === 4 && Math.abs(t.exitPrice - 111.1) < 1e-9 && t.reason === 'target', 'limit_sell fills at the target level inside the bar: ' + JSON.stringify(t));
ok(Math.abs(res.equity[2] - 100000) < 1e-9 && checkInvariants(res, rec(rows)).ok, 'equity on the at_close bar is re-marked; invariants ok');
// target reachable on the entry bar itself is NOT taken (no exit on the fill bar)
rows = flat(2).concat([[100, 120, 99, 101], [101, 105, 100, 104], [104, 104, 104, 104]]);
res = runBacktest(rec(rows), atClose(), {});
ok(res.trades[0].reason === 'end_of_data', 'no exit on the fill bar');
// gap up through the target: fills at the open, not at the level
rows = flat(2).concat([[100, 102, 99, 101], [118, 119, 117, 118], [118, 118, 118, 118]]);
res = runBacktest(rec(rows), atClose(), {});
ok(res.trades[0].exitIdx === 3 && res.trades[0].exitPrice === 118 && res.fills.find(f => f.side === 'sell').type === 'limit_sell', 'gap through the target fills at the open');

// ── stop first when target and stop are both reachable on one bar; counted ──
const both = atClose({ exit: { accounting: 'FIFO', targetPct: 10, stopPct: 5, order: { type: 'limit_sell' }, stopOrder: { type: 'stop_sell' } } });
rows = flat(2).concat([[100, 102, 99, 101], [101, 115, 90, 100], [100, 100, 100, 100]]);
res = runBacktest(rec(rows), both, {});
ok(res.trades[0].reason === 'stop' && Math.abs(res.trades[0].exitPrice - 101 * 0.95) < 1e-9 && res.meta.bothReachable === 1, 'stop assumed first, counted: ' + JSON.stringify(res.trades[0]));
// gap down through the stop fills at the open
rows = flat(2).concat([[100, 102, 99, 101], [90, 91, 89, 90], [90, 90, 90, 90]]);
res = runBacktest(rec(rows), both, {});
ok(res.trades[0].reason === 'stop' && res.trades[0].exitPrice === 90, 'gap through the stop fills at the open');

// ── stop_buy with a level expression: valid for the next bar only ──
const stopBuy = base({ indicators: [{ key: 'hh3', type: 'HIGHEST', source: 'high', period: 3 }], entry: { join: 'ALL', conditions: [['gt', 'close', 100]], order: { type: 'stop_buy', level: 'hh3' } },
  exit: { accounting: 'FIFO', targetPct: 50 } });
rows = flat(4).concat([[100, 106, 99, 101], [102, 108, 101, 107], [107, 107, 107, 107]]);       // hh3 on the signal bar = 106; next bar reaches 108 -> fill 106
res = runBacktest(rec(rows), stopBuy, {});
ok(res.trades[0].entryIdx === 5 && res.trades[0].entryPrice === 106 && res.fills[0].type === 'stop_buy', 'stop_buy fills at the level: ' + JSON.stringify(res.trades[0]));
rows = flat(4).concat([[100, 106, 99, 101], [102, 105, 99, 99], [99, 99, 99, 99]]);              // never reaches 106; close falls back under 100
res = runBacktest(rec(rows), stopBuy, {});
ok(res.trades.length === 0 && res.skipped.some(s => s.reason === 'order_not_filled'), 'unfilled stop order expires');
rows = flat(4).concat([[100, 106, 99, 101], [110, 112, 109, 111], [111, 111, 111, 111]]);        // gaps over the level: fills at the open
res = runBacktest(rec(rows), stopBuy, {});
ok(res.trades[0].entryPrice === 110, 'stop_buy gap fills at the open');

// ── sameBarExit: open_fill_only lets a lot bought at the open leave on that bar; default never ──
const sb = pol => base({ sameBarExit: pol, exit: { accounting: 'FIFO', targetPct: 10, order: { type: 'limit_sell' } } });
rows = flat(2).concat([[100, 102, 99, 101], [101, 115, 100, 114], [114, 114, 114, 114]]);        // bought at open 101 on bar 3; high 115 > 111.1
res = runBacktest(rec(rows), sb('open_fill_only'), {});
ok(res.trades[0].entryIdx === 3 && res.trades[0].exitIdx === 3 && Math.abs(res.trades[0].exitPrice - 111.1) < 1e-9 && checkInvariants(res, rec(rows)).ok, 'open_fill_only exits on the fill bar');
res = runBacktest(rec(rows), sb('never'), {});
ok(res.trades[0].exitIdx !== 3, 'default: no exit on the fill bar');

// ── one scale: with an adjusted series present, fills, marking and targets all use it; the as-traded close is display only ──
const raw = flat(2, 900).concat([[1000, 1020, 990, 1010], [1030, 1040, 1020, 1030], [1030, 1150, 1030, 1140], [1160, 1170, 1150, 1160], [1160, 1160, 1160, 1160]]);
const adj = raw.map(r => r.map(x => x / 10));
res = runBacktest(rec(raw, adj), base(), {});
ok(res.trades[0].entryPrice === 103 && res.trades[0].exitPrice === 116 && res.meta.asTradedLast === 1160, 'fills on the adjusted scale: ' + JSON.stringify(res.trades[0]));

// ── invariants catch a tampered run ──
rows = flat(2).concat([[100, 102, 99, 101], [101, 105, 100, 104], [104, 112, 104, 111.5], [111, 111, 111, 111]]);
res = runBacktest(rec(rows), atClose(), {});
const bad = { ...res, fills: res.fills.map((f, k) => k === 0 ? { ...f, raw: 150 } : f) };
ok(!checkInvariants(bad, rec(rows)).ok && checkInvariants(bad, rec(rows)).problems[0].includes('outside'), 'fill outside the bar is caught');
const bad2 = { ...res, equity: res.equity.map(x => x + 5) };
ok(!checkInvariants(bad2, rec(rows)).ok, 'cash + positions != equity is caught');
console.log(`engine2 ok: ${runs} golden runs unchanged with invariants, order model (at_close, stop_buy, limit_sell, stop_sell, same-bar rule), one scale`);
