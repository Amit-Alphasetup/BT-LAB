// P5 session 2 oracle test: AlphaDesk LIFO and DM presets against AlphaDesk's own runs (oracle/alphadesk, recorded in Chrome from the
// live file by tools/record_alphadesk.mjs). Same inputs -> every trade equal, end equity / NAV equal to 1e-6. Silent on success.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAlphadeskLifo, runAlphadeskDM, histMapFromRecords, TENET_NOT_PORTED, ALPHADESK_PRESETS, lifoFriction } from '../presets-alphadesk.js';

const HERE = dirname(fileURLToPath(import.meta.url)), DIR = join(HERE, '..', '..', 'oracle', 'alphadesk');
const fail = m => { console.log('P5B FAIL: ' + m); process.exit(1); };
const EXC = JSON.parse(readFileSync(join(HERE, 'oracle-exceptions-alphadesk.json'), 'utf8'));
const near = (a, b, tol = 1e-6) => (a == null && b == null) || Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const toMap = hist => Object.fromEntries(Object.entries(hist).map(([s, rows]) => [s, Object.fromEntries(rows.map(r => [r[0], { open: r[1], high: r[2], low: r[3], close: r[4], vol: r[5] }]))]));
let total = 0; const cross = [];
for (const f of ['lifo_next-open', 'lifo_sheet-close', 'dm_next-open', 'dm_sheet-close']) {
  const path = join(DIR, f + '.json'); if (!existsSync(path)) fail('missing oracle fixture ' + f);
  const fx = JSON.parse(readFileSync(path, 'utf8')), hm = toMap(fx.hist), want = fx.trades;
  if (fx.engine === 'lifo') {
    const r = runAlphadeskLifo(hm, fx.params, { config: fx.config, universe: fx.universe, excluded: fx.excluded });
    if (r.trades.length !== want.length) fail(`${f}: ${r.trades.length} trades, AlphaDesk ${want.length}`);
    r.trades.forEach((t, k) => { const w = want[k];
      for (const key of ['buyDate', 'sym', 'qty', 'sellDate', 'avgCount', 'exitReason', 'signalDate']) if (t[key] !== w[key]) fail(`${f} trade ${k} ${key}: ${t[key]} vs ${w[key]}`);
      for (const key of ['buyPrice', 'sellPrice', 'invested', 'grossPnl', 'netPnl']) if (!near(t[key], w[key])) fail(`${f} trade ${k} ${key}: ${t[key]} vs ${w[key]}`); total++; });
    if (!near(r.endEq, fx.summary.endEq)) fail(`${f}: end equity ${r.endEq} vs ${fx.summary.endEq}`);
    if (r.equity.length !== fx.summary.days) fail(`${f}: ${r.equity.length} days vs ${fx.summary.days}`);
    for (const e of r.equity) if (Math.abs(e.cash + e.positions - e.eq) > 1e-6) fail(`${f}: cash + positions != equity on ${e.d}`);
    for (const x of r.fills) { const b = hm[x.sym][x.date]; if (x.price < b.low - 1e-9 || x.price > b.high + 1e-9) { if (!EXC.some(e => e.rule === 'fill_outside_bar' && e.preset === 'lifo')) fail(`${f}: fill outside the bar ${x.sym} ${x.date}`); } }
    if (f === 'lifo_next-open') cross.push({ preset: 'lifo', capital: r.capital, endEq: r.endEq, fills: r.fills.map(x => [x.date, x.sym, x.side, x.price, x.qty, x.cost]),
      open: r.open.map(o => [o.qty, o.last]), brokerage: fx.config.brokerage, slippage: fx.config.slippage });
  } else {
    const r = runAlphadeskDM(hm, fx.params, { etfs: fx.dmEtfs });
    if (!r.ok) fail(`${f}: ${r.reason}`);
    if (r.tradeLog.length !== want.length) fail(`${f}: ${r.tradeLog.length} rows, AlphaDesk ${want.length}`);
    r.tradeLog.forEach((t, k) => { const w = want[k];
      for (const key of ['date', 'sym', 'action', 'entryDate']) if ((t[key] ?? null) !== (w[key] ?? null)) fail(`${f} row ${k} ${key}: ${t[key]} vs ${w[key]}`);
      for (const key of ['entryPrice', 'exitPrice', 'units', 'pnl']) if (!near(t[key] ?? null, w[key] ?? null)) fail(`${f} row ${k} ${key}: ${t[key]} vs ${w[key]}`); total++; });
    if (!near(r.endNav, fx.summary.endNav)) fail(`${f}: end NAV ${r.endNav} vs ${fx.summary.endNav}`);
    if (r.equity.length !== fx.summary.rebalances) fail(`${f}: ${r.equity.length} rebalances vs ${fx.summary.rebalances}`);
  }
}
// app records -> histMap round trip
const rec = { symbol: 'X', t: Float64Array.from([Date.parse('2024-01-01T00:00:00Z'), Date.parse('2024-01-02T00:00:00Z')]), o: [1, 2], h: [1, 2], l: [1, 2], c: [1, 2], vol: [5, 6] };
const m = histMapFromRecords({ X: rec }, { from: '2024-01-02' });
if (JSON.stringify(m) !== '{"X":{"2024-01-02":{"open":2,"high":2,"low":2,"close":2,"vol":6}}}') fail('histMapFromRecords');
if (!/pairs|weekly/i.test(TENET_NOT_PORTED) || ALPHADESK_PRESETS.length !== 2) fail('Tenet must be listed as not ported');
if (lifoFriction({ brokerage: 25, slippage: 0 }, 'BUY', 10, 100).friction !== 29.69) fail('friction ' + lifoFriction({ brokerage: 25, slippage: 0 }, 'BUY', 10, 100).friction);
for (const e of EXC) if (!e.preset || !e.rule || !e.reason) fail('exception without a reason');
writeFileSync(join(HERE, 'fixtures', 'alphadesk_crosscheck.json'), JSON.stringify(cross));
console.log(`p5b ok: ${total} AlphaDesk trades and rebalance rows reproduced (LIFO + DM, next open + sheet close); Tenet listed as not ported`);
