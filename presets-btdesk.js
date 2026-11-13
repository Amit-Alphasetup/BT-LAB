/* ============================================================
   BACKTEST LAB — presets-btdesk.js
   The five BT/DESK dashboard strategies, rebuilt as presets. The RULES are the
   dashboard's, checked trade for trade against its frozen engines
   (tests/oracle.test.mjs). The FILLS come from the order model (fills.js):

     fillModel 'honest' (default)  every fill is a price the bar really traded:
        buy stops fill at max(level, open), targets at max(target, open).
     fillModel 'sheet'             the dashboard's own bookkeeping: a triggered
        order is booked exactly at its level (and Smart Averaging at the
        day's mid-point). Kept only to prove the rules are the same.

   Pure functions. bars = the app's record {t,o,h,l,c,vol} (adjusted scale).
   ============================================================ */
import { fillPrice, insideBar } from './fills.js';
import { tradeCost, COST_PRESETS, computeStats } from './engine.js';

export const BTDESK_DEFAULTS = { perTxAmount: 5000, maxBuys: 5, blshTarget: 10, superBreakoutTarget: 4.71, sst1: 6.28, sst2: 8, sst3: 10,
  sstLifoTarget: 6, smartAvgTarget: 6.28, smartAvgDipParam: 0.4, smartAvgDipMode: 'literal' };

export const BTDESK_PRESETS = [
  { id: 'superbreakout', label: 'SuperBreakout', warmup: 200, entryOrder: 'at_close', exitOrder: 'limit_sell',
    note: 'Close above the 5, 10, 15, 50, 100 and 200-day averages: buy at that close. Sell at +4.71% on cost.' },
  { id: 'smartavg', label: 'Smart Averaging', warmup: 200, entryOrder: 'at_close', exitOrder: 'limit_sell',
    note: 'Always invested: buys a lot, adds up to five, sells everything at +6.28% on the average and starts again the next day.' },
  { id: 'blsh', label: 'BLSH', warmup: 200, entryOrder: 'at_close', exitOrder: 'limit_sell',
    note: "Close crosses above 5% over the 25-day low close: buy at the next day's close. Sell all at +10% on the average." },
  { id: 'sst', label: 'SST (FIFO)', warmup: 200, entryOrder: 'stop_buy', exitOrder: 'limit_sell',
    note: 'Touch the 20-day low, then break the previous 20-day high: buy stop at that high. Sell all at 6.28 / 8 / 10% on the average by number of lots.' },
  { id: 'sstlifo', label: 'SST 2.0 LIFO', warmup: 20, entryOrder: 'stop_buy', exitOrder: 'limit_sell',
    note: 'Armed at the 20-day low, buy stop at the previous 20-day high; every lot sells on its own +6%.' },
];
export const getBtdeskPreset = id => BTDESK_PRESETS.find(p => p.id === id) || null;

const day = ms => new Date(ms).toISOString().slice(0, 10);
const lotQty = (amount, price) => (!(price > 0) || !(amount > 0)) ? 0 : Math.floor(amount / price);
function sma(c, i, p) { if (i - p + 1 < 0) return null; let s = 0; for (let k = i - p + 1; k <= i; k++) s += c[k]; return s / p; }
function rollMax(a, i, p) { if (i - p + 1 < 0) return null; let m = -Infinity; for (let k = i - p + 1; k <= i; k++) m = Math.max(m, a[k]); return m; }
function rollMin(a, i, p) { if (i - p + 1 < 0) return null; let m = Infinity; for (let k = i - p + 1; k <= i; k++) m = Math.min(m, a[k]); return m; }

/* Each machine returns events: buys [{i, price, qty, type}], sells [{i, price, qty, type, level}], trades (one per exit) and `open`. */
function machine(id, B, s0, P, sheet) {
  const { o, h, l, c } = B, n = c.length, bar = i => ({ o: o[i], h: h[i], l: l[i], c: c[i] });
  const buys = [], sells = [], trades = [];
  /* target exit: sheet = strict High > level, booked at the level; honest = resting limit sell */
  const targetFill = (level, i) => sheet ? (h[i] > level ? level : null) : fillPrice({ type: 'limit_sell', level }, bar(i));

  if (id === 'superbreakout') {
    const t = P.superBreakoutTarget / 100, amt = P.perTxAmount * P.maxBuys;
    let prevQty = null, prevInv = 0, prevExit = false, eI = null;
    for (let i = s0; i < n; i++) {
      const ss = [5, 10, 15, 50, 100, 200].map(p => sma(c, i, p));
      const allAbove = ss.every(v => v != null && c[i] > v);
      const buy = prevQty !== null ? false : (allAbove && lotQty(amt, c[i]) > 0);
      let qty, inv;
      if (prevExit) { qty = null; inv = 0; } else if (buy) { qty = lotQty(amt, c[i]); inv = c[i] * qty; } else { qty = prevQty; inv = prevInv; }
      let px = null;
      if (!buy && qty !== null && inv > 0) {
        if (sheet) { if ((h[i] * qty - inv) / inv > t) px = (inv / qty) * (1 + t); }
        else px = targetFill((inv / qty) * (1 + t), i);
      }
      if (buy) { eI = i; buys.push({ i, price: c[i], qty, type: 'at_close' }); }
      if (px != null) { sells.push({ i, price: px, qty, type: 'limit_sell', level: (inv / qty) * (1 + t) }); trades.push({ eI, xI: i, entry: inv / qty, exit: px, qty, buys: 1 }); eI = null; }
      prevQty = qty; prevInv = inv; prevExit = px != null;
    }
    return { buys, sells, trades };
  }

  if (id === 'smartavg') {
    const t = P.smartAvgTarget / 100, dip = P.smartAvgDipMode === 'grid' ? -Math.abs(P.smartAvgDipParam) : P.smartAvgDipParam;
    let pReady = null, pBuy = false, pExit = false, pQty = 0, pInv = 0, pPl = null, eI = null, nb = 0;
    for (let i = s0; i < n; i++) {
      const boot = i === s0, buyPrice = sheet ? (h[i] + l[i]) / 2 : c[i];           // the sheet books the day's mid-point: not a tradable price
      const afford = lotQty(P.perTxAmount, buyPrice) > 0;
      let ready, buy;
      if (boot) { ready = 1; buy = afford; }
      else { ready = pExit ? 1 : (pBuy ? pReady + 1 : pReady); buy = pExit ? afford : (ready <= P.maxBuys && afford && pPl != null && pPl < dip * (ready - 1)); }
      const qty = buy ? lotQty(P.perTxAmount, buyPrice) : 0, inv = buy ? buyPrice * qty : 0, fresh = boot || pExit;
      const tq = fresh ? qty : pQty + qty, ti = fresh ? inv : pInv + inv, avg = tq > 0 ? ti / tq : null;
      const pl = avg != null ? (c[i] - avg) / avg : null, target = avg != null ? avg * (1 + t) : null;
      if (fresh) { eI = i; nb = 0; }
      if (buy) { nb++; buys.push({ i, price: buyPrice, qty, type: sheet ? 'sheet_midpoint' : 'at_close' }); }
      const px = (tq > 0 && !buy && target != null) ? targetFill(target, i) : null;
      if (px != null) { sells.push({ i, price: px, qty: tq, type: 'limit_sell', level: target }); trades.push({ eI, xI: i, entry: avg, exit: px, qty: tq, buys: nb }); }
      pReady = ready; pBuy = buy; pExit = px != null; pQty = tq; pInv = ti; pPl = pl;
    }
    return { buys, sells, trades };
  }

  if (id === 'blsh') {
    const t = P.blshTarget / 100, trig = i => { const lo = rollMin(c, i, 25); return lo == null ? null : lo * 1.05; };
    let pExit = false, pBuy = false, pReady = 1, pQty = 0, pInv = 0, eI = null, nb = 0;
    for (let i = Math.max(s0, 25); i < n; i++) {
      const tp = trig(i - 1), exec = pExit ? null : (pBuy ? c[i] : null);            // yesterday's signal fills at today's close
      const qty = exec != null ? lotQty(P.perTxAmount, exec) : 0, inv = exec != null ? exec * qty : 0;
      const ready = pExit ? 1 : ((pBuy && qty > 0) ? pReady + 1 : pReady);
      const buy = tp != null && ready <= P.maxBuys && c[i - 1] < tp && c[i] > tp && exec === null && lotQty(P.perTxAmount, c[i]) > 0;
      const tq = pExit ? qty : pQty + qty, ti = pExit ? inv : pInv + inv, avg = tq > 0 ? ti / tq : null, target = avg != null ? avg * (1 + t) : null;
      if ((pExit || pQty === 0) && qty > 0) { eI = i; nb = 0; }
      if (qty > 0) { nb++; buys.push({ i, price: exec, qty, type: 'at_close' }); }
      const px = (tq > 0 && !buy && exec === null && target != null) ? targetFill(target, i) : null;
      if (px != null) { sells.push({ i, price: px, qty: tq, type: 'limit_sell', level: target }); trades.push({ eI, xI: i, entry: avg, exit: px, qty: tq, buys: nb }); eI = null; nb = 0; }
      pExit = px != null; pBuy = buy; pReady = ready; pQty = tq; pInv = ti;
    }
    return { buys, sells, trades };
  }

  if (id === 'sst') {
    const tiers = [P.sst1 / 100, P.sst2 / 100, P.sst3 / 100];
    let pArmed = false, pBuy = false, pExit = false, pReady = 1, pQty = 0, pInv = 0, pTarget = null, eI = null, lastN = null;
    for (let i = s0; i < n; i++) {
      const l20 = rollMin(l, i, 20), h20p = i > 0 ? rollMax(h, i - 1, 20) : null;
      const touched = l20 !== null && l[i] <= l20 + 1e-9;
      const armed = pBuy ? false : (pExit ? touched : (pArmed || touched));
      const ready = pExit ? 1 : pBuy ? pReady + 1 : pReady;
      let buy = !pExit && ready <= P.maxBuys && armed && h20p !== null && h[i] > h20p && l[i] < h20p && lotQty(P.perTxAmount, h20p) > 0;
      // sheet: booked at the level. honest: a buy stop at the level fills at max(level, open) - the open, when the day opened above it
      const buyPrice = buy ? (sheet ? h20p : fillPrice({ type: 'stop_buy', level: h20p }, bar(i))) : null;
      const qty = buy ? lotQty(P.perTxAmount, buyPrice) : 0;
      if (buy && qty === 0) buy = false;                                            // honest fill dearer than the level: the lot may no longer be affordable
      const inv = buy ? buyPrice * qty : 0;
      const tq = pExit ? qty : pQty + qty, ti = pExit ? inv : pInv + inv, avg = tq > 0 ? ti / tq : null;
      let target;
      if (buy && avg != null) target = avg * (1 + (ready === 1 ? tiers[0] : ready === 2 ? tiers[1] : tiers[2]));
      else if (pExit) target = null; else target = pTarget;
      if (buy && (pExit || pQty === 0 || eI === null)) eI = i;
      if (buy) { lastN = ready; buys.push({ i, price: buyPrice, qty, type: 'stop_buy', level: h20p }); }
      const px = (!buy && tq > 0 && target !== null) ? targetFill(target, i) : null;
      if (px != null) { sells.push({ i, price: px, qty: tq, type: 'limit_sell', level: target }); trades.push({ eI, xI: i, entry: avg, exit: px, qty: tq, buys: lastN }); eI = null; lastN = null; }
      pArmed = armed; pBuy = buy; pExit = px != null; pReady = ready; pQty = tq; pInv = ti; pTarget = target;
    }
    return { buys, sells, trades };
  }

  if (id === 'sstlifo') {
    const t = (P.sstLifoTarget != null ? P.sstLifoTarget : 6) / 100, lots = [];
    let pArmed = false, pBought = false;
    for (let i = s0; i < n; i++) {
      const l20 = rollMin(l, i, 20), h20p = i > 0 ? rollMax(h, i - 1, 20) : null;
      const touched = l20 !== null && l[i] <= l20 + 1e-9, armed = pBought ? false : (pArmed || touched);
      let buy = pArmed && !pBought && h20p !== null && h[i] > h20p && lotQty(P.perTxAmount, h20p) > 0;
      const buyPrice = buy ? Math.max(h20p, o[i]) : null, qty = buy ? lotQty(P.perTxAmount, buyPrice) : 0;   // same as fillPrice(stop_buy) once High > level
      if (buy) { lots.push({ i, price: buyPrice, qty, target: buyPrice * (1 + t) }); buys.push({ i, price: buyPrice, qty, type: 'stop_buy', level: h20p }); }
      for (let k = lots.length - 1; k >= 0; k--) {
        const L = lots[k];
        if (L.i === i) continue;                                                    // never on the fill bar
        const px = targetFill(L.target, i);
        if (px != null) { sells.push({ i, price: px, qty: L.qty, type: 'limit_sell', level: L.target }); trades.push({ eI: L.i, xI: i, entry: L.price, exit: px, qty: L.qty, buys: 1 }); lots.splice(k, 1); }
      }
      pArmed = armed; pBought = buy;
    }
    return { buys, sells, trades };
  }
  throw new Error('unknown BT/DESK preset: ' + id);
}

/* runBtdesk(record, presetId, params, {fillModel, start, raw}) -> the app's result shape (trades, equity, stats, meta) + fills, open, invariants. */
export function runBtdesk(bars, id, params = {}, options = {}) {
  const preset = getBtdeskPreset(id);
  if (!preset) throw new Error('unknown BT/DESK preset: ' + id);
  const P = { ...BTDESK_DEFAULTS, ...params }, sheet = options.fillModel === 'sheet';
  const B = bars.adj ? { o: bars.adj.o, h: bars.adj.h, l: bars.adj.l, c: bars.adj.c } : bars;      // one adjusted scale for everything
  const n = bars.t.length;
  let s0 = options.start ? Array.from(bars.t).findIndex(t => day(t) >= options.start) : preset.warmup;
  if (s0 < 0) s0 = n;
  const empty = why => ({ ok: false, reason: why, preset: id, trades: [], equity: new Float64Array(n).fill(NaN), fills: [], skipped: [], open: null,
    stats: computeStats([], new Float64Array(0), bars, P.perTxAmount * P.maxBuys), meta: { strategy: preset.label, fillModel: sheet ? 'sheet' : 'honest', params: P } });
  if (s0 >= n) return empty('no bars at/after the start date');
  if (s0 < preset.warmup) return empty(`only ${s0} bars before the start (needs ${preset.warmup})`);
  const ev = machine(id, B, s0, P, sheet);

  /* ---- one ledger for every preset: costs, cash, equity, invariants ---- */
  const cp = options.raw ? COST_PRESETS.none : COST_PRESETS.zerodha_delivery;
  const buyCost = new Map(), fills = [];
  const byBar = new Map();
  for (const b of ev.buys) { (byBar.get(b.i) || byBar.set(b.i, { buys: [], sells: [] }).get(b.i)).buys.push(b); fills.push({ i: b.i, side: 'buy', type: b.type, price: b.price, qty: b.qty, level: b.level }); }
  for (const s of ev.sells) { (byBar.get(s.i) || byBar.set(s.i, { buys: [], sells: [] }).get(s.i)).sells.push(s); fills.push({ i: s.i, side: 'sell', type: s.type, price: s.price, qty: s.qty, level: s.level }); }
  const cashFlow = new Float64Array(n), qtyAt = new Float64Array(n), sellCostAt = new Map();
  let q = 0;
  for (let i = 0; i < n; i++) {
    const e = byBar.get(i);
    if (e) {
      for (const b of e.buys) { const k = tradeCost('buy', b.price, b.qty, cp).total; buyCost.set(b, k); cashFlow[i] -= b.price * b.qty + k; q += b.qty; }
      if (e.sells.length) {                                                         // DP charge once per sell day, shared by quantity
        const tq = e.sells.reduce((a, s) => a + s.qty, 0), turnover = e.sells.reduce((a, s) => a + s.price * s.qty, 0);
        const k = tradeCost('sell', turnover / tq, tq, cp).total;
        for (const s of e.sells) { sellCostAt.set(s, k * s.qty / tq); cashFlow[i] += s.price * s.qty - k * s.qty / tq; q -= s.qty; }
      }
    }
    qtyAt[i] = q;
  }
  let run = 0, low = 0;
  for (let i = 0; i < n; i++) { run += cashFlow[i]; if (run < low) low = run; }
  const capital = Math.max(P.perTxAmount * P.maxBuys, Math.ceil(-low));            // never a negative cash balance (SST 2.0 has no lot limit)
  const equity = new Float64Array(n).fill(NaN), cash = new Float64Array(n);
  run = capital;
  for (let i = 0; i < n; i++) { run += cashFlow[i]; cash[i] = run; if (i >= s0) equity[i] = run + qtyAt[i] * B.c[i]; }

  // trades in the app's shape; buy-side costs of a cycle are attached to the trade that closes it
  const buysLeft = ev.buys.slice();
  const trades = ev.trades.map((tr, k) => {
    const s = ev.sells[k];
    let bc = 0;
    if (id === 'sstlifo') { const j = buysLeft.findIndex(b => b.i === tr.eI); bc = buyCost.get(buysLeft[j]); buysLeft.splice(j, 1); }
    else while (buysLeft.length && buysLeft[0].i <= tr.xI) bc += buyCost.get(buysLeft.shift());
    const gross = (tr.exit - tr.entry) * tr.qty, costs = bc + sellCostAt.get(s);
    return { entryIdx: tr.eI, exitIdx: tr.xI, entryDate: bars.t[tr.eI], exitDate: bars.t[tr.xI], entryPrice: tr.entry, exitPrice: tr.exit, qty: tr.qty,
      gross, costs, net: gross - costs, pct: (tr.exit - tr.entry) / tr.entry * 100, bars: tr.xI - tr.eI, reason: 'target', lots: tr.buys };
  });
  const openQty = qtyAt[n - 1], openBuys = id === 'sstlifo' ? buysLeft : buysLeft.filter(b => b.qty > 0);
  const openInv = openBuys.reduce((a, b) => a + b.price * b.qty, 0);
  const open = openQty > 0 ? { qty: openQty, avgPrice: openInv / openQty, invested: openInv, lots: openBuys.length, value: openQty * B.c[n - 1],
    asTradedLast: bars.c[n - 1], since: bars.t[openBuys[0].i] } : null;

  // invariants (PLAN section 7): fills inside the bar, no exit on the fill bar, cash + position = equity
  const problems = [];
  if (!sheet) for (const f of fills) if (!insideBar(f.price, { l: B.l[f.i], h: B.h[f.i] })) problems.push(`fill outside the bar on ${day(bars.t[f.i])}: ${f.side} ${f.price}`);
  const buyBars = new Set(ev.buys.map(b => b.i));
  if (id === 'sstlifo') { for (const tr of ev.trades) if (tr.xI === tr.eI) problems.push('exit on the fill bar ' + day(bars.t[tr.xI])); }
  else for (const s of ev.sells) if (buyBars.has(s.i)) problems.push('exit on a fill bar ' + day(bars.t[s.i]));
  for (let i = s0; i < n; i++) if (Math.abs(equity[i] - (cash[i] + qtyAt[i] * B.c[i])) > 1e-6) { problems.push('cash + position != equity on ' + day(bars.t[i])); break; }
  if (cash.some(x => x < -1e-6)) problems.push('negative cash');

  const forStats = equity.slice(s0), statBars = { t: bars.t.slice(s0), c: B.c.slice(s0) };
  return { ok: true, preset: id, trades, equity, cash, fills, skipped: [], open, invariants: { ok: problems.length === 0, problems },
    stats: computeStats(trades, forStats, statBars, capital),
    meta: { schemaVersion: 2, strategy: preset.label, symbol: bars.symbol || null, bars: n, from: bars.t[s0], to: bars.t[n - 1], capital, costPreset: cp.label,
      raw: !!options.raw, fillModel: sheet ? 'sheet' : 'honest', params: P, entryOrder: preset.entryOrder, exitOrder: preset.exitOrder, runAt: Date.now() } };
}
