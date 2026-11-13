// P3 oracle test: the five BT/DESK presets against the frozen dashboard engines (oracle fixtures: 5 engines x 4 stocks from 2015).
//  1. fillModel 'sheet'  -> every trade equals the oracle: entry date, entry price, exit date, exit price (within 0.01) and quantity. 100%.
//  2. fillModel 'honest' -> the same rules with order-model fills: invariants hold on every run; every difference from the sheet run is
//     explained by one of the rule-level exceptions in tests/oracle-exceptions.json (each names the impossible fill it removes).
// Writes tests/fixtures/oracle_crosscheck.json for the independent Python check of costs and XIRR. Silent on success.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBtdesk, BTDESK_PRESETS } from '../presets-btdesk.js';
import { xirr } from '../extras.js';

const HERE = dirname(fileURLToPath(import.meta.url)), ORACLE = join(HERE, '..', '..', 'oracle', 'fixtures');
const fail = m => { console.log('ORACLE FAIL: ' + m); process.exit(1); };
const day = ms => new Date(ms).toISOString().slice(0, 10), r4 = x => +(+x).toFixed(4);
const SYMBOLS = ['RELIANCE', 'HDFCBANK', 'TATASTEEL', 'INFY'];
const EXC = JSON.parse(readFileSync(join(HERE, 'oracle-exceptions.json'), 'utf8'));
const excFor = id => EXC.filter(e => e.preset === id || e.preset === '*');

function record(sym) {
  const d = JSON.parse(readFileSync(join(ORACLE, 'series', sym + '.json'), 'utf8')), col = k => Float64Array.from(d.bars, r => r[k]);
  return { symbol: sym, t: Float64Array.from(d.bars, r => Date.parse(r[0] + 'T00:00:00Z')), o: col(1), h: col(2), l: col(3), c: col(4), vol: col(5), adj: null };
}
let total = 0, honestTrades = 0, honestSame = 0, gapSells = 0, gapBuys = 0;
const cross = [];
for (const sym of SYMBOLS) {
  const fx = JSON.parse(readFileSync(join(ORACLE, 'btdesk', sym + '.json'), 'utf8')), rec = record(sym);
  if (rec.t.length !== fx.bars) fail(`${sym}: series has ${rec.t.length} bars, fixture was recorded on ${fx.bars}`);
  for (const p of BTDESK_PRESETS) {
    const want = fx.engines[p.id].trades;
    // ── 1. sheet fills: exact parity ──
    const sheet = runBtdesk(rec, p.id, fx.params, { fillModel: 'sheet', start: fx.start });
    if (!sheet.ok) fail(`${p.id} ${sym}: ${sheet.reason}`);
    if (sheet.trades.length !== want.length) fail(`${p.id} ${sym}: ${sheet.trades.length} trades, oracle ${want.length}`);
    sheet.trades.forEach((t, k) => {
      const w = want[k], got = [day(t.entryDate), r4(t.entryPrice), day(t.exitDate), r4(t.exitPrice), t.qty];
      if (got[0] !== w[0] || got[2] !== w[2] || Math.abs(got[1] - w[1]) > 0.01 || Math.abs(got[3] - w[3]) > 0.01 || got[4] !== w[4]) fail(`${p.id} ${sym} trade ${k}: ${JSON.stringify(got)} vs oracle ${JSON.stringify(w)}`);
      total++;
    });
    if (!sheet.invariants.problems.every(x => /fill outside/.test(x)) || sheet.invariants.problems.some(x => /equity|negative cash|fill bar/.test(x))) fail(`${p.id} ${sym} sheet ledger: ${sheet.invariants.problems[0]}`);
    // ── 2. honest fills: invariants + every difference explained ──
    const hon = runBtdesk(rec, p.id, fx.params, { start: fx.start });
    if (!hon.invariants.ok) fail(`${p.id} ${sym} honest invariants: ${hon.invariants.problems.slice(0, 2).join('; ')}`);
    if (hon.meta.fillModel !== 'honest' || !(hon.meta.capital >= fx.params.perTxAmount * fx.params.maxBuys)) fail(`${p.id} ${sym}: meta`);
    const B = rec, allowed = new Set(excFor(p.id).map(e => e.rule));
    for (const f of hon.fills) {
      const o = B.o[f.i], atLevel = f.level != null && Math.abs(f.price - f.level) < 1e-9;
      if (f.side === 'sell') { if (!atLevel) { if (!(f.price === o && o > f.level) || !allowed.has('target_gap_up_fills_at_open')) fail(`${p.id} ${sym}: unexplained sell ${f.price} on ${day(B.t[f.i])}`); gapSells++; } }
      else if (f.type === 'stop_buy') { if (!atLevel) { if (!(f.price === o && o > f.level) || !allowed.has('buy_stop_gap_up_fills_at_open')) fail(`${p.id} ${sym}: unexplained buy ${f.price} on ${day(B.t[f.i])}`); gapBuys++; } }
      else if (f.type === 'at_close') { if (f.price !== B.c[f.i]) fail(`${p.id} ${sym}: at_close fill is not the close`); }
      else fail(`${p.id} ${sym}: unexpected fill type ${f.type}`);
    }
    if (p.id === 'smartavg' && !allowed.has('midpoint_buy_becomes_close')) fail('smartavg exception missing');
    honestTrades += hon.trades.length;
    const key = t => day(t.entryDate) + '|' + day(t.exitDate) + '|' + r4(t.entryPrice) + '|' + r4(t.exitPrice);
    const sk = new Set(sheet.trades.map(key)); honestSame += hon.trades.filter(t => sk.has(key(t))).length;
    // cross-check material for Python: every fill, the costs charged, and the XIRR of the cash flows
    if ((sym === 'RELIANCE' || sym === 'INFY') && (p.id === 'sst' || p.id === 'sstlifo')) {
      const flows = hon.fills.map(f => [day(B.t[f.i]), f.side, f.price, f.qty]);
      const last = B.t.length - 1, openVal = hon.open ? hon.open.qty * B.c[last] : 0;
      const cf = hon.fills.map(f => ({ t: B.t[f.i], v: (f.side === 'buy' ? -1 : 1) * f.price * f.qty })).concat(openVal ? [{ t: B.t[last], v: openVal }] : []);
      cross.push({ preset: p.id, symbol: sym, fills: flows, costsTotal: hon.trades.reduce((a, t) => a + t.costs, 0), openBuyCosts: null,
        cashEnd: hon.cash[last], capital: hon.meta.capital, lastDate: day(B.t[last]), openValue: openVal, xirrGross: xirr(cf) });
    }
  }
}
// rule-level exceptions: each must name the impossible fill it removes
for (const e of EXC) if (!e.preset || !e.rule || !/impossible|cannot|not a tradable|never traded/i.test(e.reason || '')) fail('exception without a reason naming the impossible fill: ' + JSON.stringify(e));
writeFileSync(join(HERE, 'fixtures', 'oracle_crosscheck.json'), JSON.stringify(cross));
console.log(`oracle ok: ${total} trades equal the BT/DESK engines (5 presets x 4 stocks, sheet fills); honest fills: ${honestTrades} trades, ${honestSame} identical, ${gapSells} target fills and ${gapBuys} buy-stop fills moved to the open; invariants hold on 40 runs`);
