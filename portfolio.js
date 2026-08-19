/* ============================================================
   BACKTEST LAB — portfolio.js  (Phase 7: portfolio-level backtest)

   Runs one schema across many symbols against a single shared
   capital pool with a limited number of slots. This is the number
   nobody publishes: the same strategy on a real portfolio.

   Order of operations per day (fixed, and disclosed on screen):
     1. exits fill first, so their proceeds are spendable the same day
     2. surviving buy signals are ranked by the configured rule
     3. buys fill while slots and cash allow; the rest are recorded
        as skipped, with the reason
   ============================================================ */

import { computeIndicators, tradeCost, slippedPrice, COST_PRESETS, computeStats } from './engine.js';

export const RANKING_RULES = {
  momentum:   { label: 'Strongest 20-day momentum first', fn: (c) => -c.mom20 },
  weakest:    { label: 'Weakest 20-day momentum first',   fn: (c) => c.mom20 },
  cheapest:   { label: 'Furthest below its 20-day average first', fn: (c) => c.distPct },
  alphabetical: { label: 'Alphabetical (fully deterministic)', fn: () => 0 },
};

/* Ties always break alphabetically, so a run is reproducible bar for bar. */
function rankSignals(cands, ruleKey) {
  const rule = RANKING_RULES[ruleKey] || RANKING_RULES.alphabetical;
  return cands.slice().sort((a, b) => {
    const d = rule.fn(a) - rule.fn(b);
    if (d !== 0 && Number.isFinite(d)) return d;
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });
}

/* ---------- signal extraction ----------
   Reuses the single-symbol engine's own condition evaluation by
   replaying the schema per symbol and recording the bars on which
   it would have entered or exited, without sizing anything.
*/

import { evalExpr } from './engine.js';

function signalsFor(bars, schema, ind) {
  const n = bars.t.length;
  const entries = new Uint8Array(n);
  const indBars = bars.adj ? { o: bars.adj.o, h: bars.adj.h, l: bars.adj.l, c: bars.adj.c, vol: bars.vol } : bars;
  let warm = 1;
  for (const i of (schema.indicators || [])) for (const k of ['period','slow','signal']) if (i[k] > warm) warm = i[k];

  for (let i = warm + 1; i < n; i++) {
    const ctx = { bars: indBars, ind, i, pos: { lotCount: 0 } };
    ctx.prev = { bars: indBars, ind, i: i - 1, pos: { lotCount: 0 } };
    const conds = schema.entry?.conditions || [];
    const results = conds.map(c => truthy(evalExpr(c, ctx)));
    const fire = (schema.entry?.join || 'ALL') === 'ANY' ? results.some(Boolean) : results.every(Boolean);
    if (fire) entries[i] = 1;
  }
  return { entries, indBars, ind, warm };
}

function truthy(x) { return x === true || (typeof x === 'number' && x !== 0 && Number.isFinite(x)); }

/* ---------- the portfolio run ---------- */

export function runPortfolio(records, schema, options = {}) {
  const {
    slots = 10,
    capital = 500000,
    ranking = 'momentum',
    raw = false,
    dataAsOf = Infinity,
  } = options;

  const costPreset = raw ? COST_PRESETS.none
    : (COST_PRESETS[schema.costs?.preset] || COST_PRESETS.zerodha_delivery);

  /* --- build a merged, de-duplicated calendar --- */
  const symbols = Object.keys(records).sort();
  if (!symbols.length) return emptyPortfolio(schema, options);

  const prep = {};
  const dateSet = new Set();
  for (const sym of symbols) {
    const bars = records[sym];
    if (!bars || !bars.t.length) continue;
    const ind = computeIndicators(bars.adj ? { ...bars, ...bars.adj, vol: bars.vol } : bars, schema);
    prep[sym] = { bars, ...signalsFor(bars, schema, ind), idxByTime: indexByTime(bars) };
    for (let i = 0; i < bars.t.length; i++) if (bars.t[i] <= dataAsOf) dateSet.add(bars.t[i]);
  }
  const calendar = [...dateSet].sort((a, b) => a - b);
  if (calendar.length < 2) return emptyPortfolio(schema, options);

  /* --- state --- */
  let cash = capital;
  const positions = new Map();          // symbol -> {lots:[{qty,price,dayIdx,cost,peak}]}
  const trades = [];
  const skipped = [];
  const equity = new Float64Array(calendar.length).fill(NaN);
  const concurrent = new Uint16Array(calendar.length);
  const pendingBuys = [];               // filled at next day's open
  const pendingSells = [];

  const accounting = schema.exit?.accounting || 'FIFO';

  for (let d = 0; d < calendar.length; d++) {
    const today = calendar[d];

    /* ---- 1. fills from yesterday's signals: SELLS FIRST ---- */
    while (pendingSells.length) {
      const s = pendingSells.shift();
      const p = prep[s.symbol];
      const i = p.idxByTime.get(today);
      if (i == null) { pendingSells.push({ ...s, retry: (s.retry || 0) + 1 }); if (s.retry > 3) {} else continue; }
      const px = slippedPrice('sell', p.bars.o[i], p.bars.c[i - 1], schema.costs);
      cash += closeSymbolLots(positions, s.symbol, s.mode, accounting, px, today, i, trades, costPreset, s.reason, p);
    }

    while (pendingBuys.length) {
      const bsig = pendingBuys.shift();
      const p = prep[bsig.symbol];
      const i = p.idxByTime.get(today);
      if (i == null) continue;
      const open = positions.get(bsig.symbol);
      const isNew = !open || !open.lots.length;
      if (isNew && positions.size >= slots) { skipped.push({ date: today, symbol: bsig.symbol, reason: 'no_slot' }); continue; }
      const px = slippedPrice('buy', p.bars.o[i], p.bars.c[i - 1], schema.costs);
      const qty = sizeFor(cash, px, schema, p.bars, i, slots, capital);
      if (qty <= 0) { skipped.push({ date: today, symbol: bsig.symbol, reason: 'size_zero_or_volume_cap' }); continue; }
      const c = tradeCost('buy', px, qty, costPreset);
      const outlay = px * qty + c.total;
      if (outlay > cash) { skipped.push({ date: today, symbol: bsig.symbol, reason: 'no_cash' }); continue; }
      cash -= outlay;
      if (!positions.has(bsig.symbol)) positions.set(bsig.symbol, { lots: [] });
      positions.get(bsig.symbol).lots.push({ qty, price: px, dayIdx: d, cost: c.total, peak: px, tIdx: i });
    }

    /* ---- 2. mark the book ---- */
    let posVal = 0;
    for (const [sym, pos] of positions) {
      const p = prep[sym];
      const i = p.idxByTime.get(today);
      const px = i != null ? p.bars.c[i] : lastKnownClose(p, today);
      for (const L of pos.lots) { posVal += L.qty * px; if (px > L.peak) L.peak = px; }
    }
    equity[d] = cash + posVal;
    concurrent[d] = positions.size;

    /* ---- 3. evaluate today's closes for tomorrow's fills ---- */
    // exits
    for (const [sym, pos] of positions) {
      const p = prep[sym];
      const i = p.idxByTime.get(today);
      if (i == null) continue;
      const ex = exitDecision(schema, pos, p, i, accounting);
      if (ex) pendingSells.push({ symbol: sym, mode: ex.mode, reason: ex.reason });
    }
    // entries — collect, then rank
    const cands = [];
    for (const sym of symbols) {
      const p = prep[sym];
      if (!p) continue;
      const i = p.idxByTime.get(today);
      if (i == null || !p.entries[i]) continue;
      const open = positions.get(sym);
      const hasPos = open && open.lots.length;
      if (hasPos && !(schema.pyramiding?.enabled && open.lots.length < (schema.pyramiding.maxLots ?? 1))) continue;
      if (hasPos && schema.pyramiding?.trigger) {
        const ctx = posCtx(p, open, i);
        if (!truthy(evalExpr(schema.pyramiding.trigger, ctx))) continue;
      }
      cands.push({
        symbol: sym,
        mom20: momentum(p.bars, i, 20),
        distPct: distFromMean(p.bars, i, 20),
      });
    }
    const ranked = rankSignals(cands, ranking);
    const freeSlots = slots - positions.size;
    let taken = 0;
    for (const c of ranked) {
      const isNew = !positions.has(c.symbol) || !positions.get(c.symbol).lots.length;
      if (isNew && taken >= freeSlots) { skipped.push({ date: today, symbol: c.symbol, reason: 'no_slot' }); continue; }
      pendingBuys.push({ symbol: c.symbol });
      if (isNew) taken++;
    }
  }

  /* ---- close everything on the last day ---- */
  const dLast = calendar.length - 1;
  for (const sym of [...positions.keys()]) {
    const p = prep[sym];
    const i = p.idxByTime.get(calendar[dLast]) ?? p.bars.t.length - 1;
    cash += closeSymbolLots(positions, sym, 'all', accounting, p.bars.c[i], calendar[dLast], i, trades, costPreset, 'end_of_data', p);
  }
  equity[dLast] = cash;
  forwardFill(equity);

  const pseudoBars = { t: Float64Array.from(calendar) };
  const stats = computeStats(trades, equity, pseudoBars, capital);

  return {
    schema, trades, equity, skipped, calendar,
    stats,
    portfolio: {
      slots, capital, ranking,
      rankingLabel: (RANKING_RULES[ranking] || RANKING_RULES.alphabetical).label,
      symbols: symbols.length,
      concurrent,
      slotUtilisation: avg(concurrent) / slots * 100,
      cashDragPct: cashDrag(equity, concurrent, slots),
      perSymbol: perSymbol(trades),
      skippedCount: skipped.length,
    },
    meta: {
      strategy: schema.label || schema.id,
      mode: 'portfolio',
      raw, dataAsOf: dataAsOf === Infinity ? null : dataAsOf,
      costPreset: costPreset.label,
      from: calendar[0], to: calendar[dLast],
      runAt: Date.now(),
    },
  };
}

/* ---------- helpers ---------- */

function indexByTime(bars) {
  const m = new Map();
  for (let i = 0; i < bars.t.length; i++) m.set(bars.t[i], i);
  return m;
}

function lastKnownClose(p, today) {
  let best = NaN;
  for (let i = 0; i < p.bars.t.length; i++) {
    if (p.bars.t[i] > today) break;
    best = p.bars.c[i];
  }
  return best;
}

function exitLotOf(lots, accounting) {
  return accounting === 'LIFO' ? lots[lots.length - 1] : lots[0];
}

function posCtx(p, pos, i) {
  const lots = pos.lots;
  let qty = 0, cost = 0, peak = -Infinity;
  for (const L of lots) { qty += L.qty; cost += L.qty * L.price; if (L.peak > peak) peak = L.peak; }
  const ctx = {
    bars: p.indBars, ind: p.ind, i,
    pos: {
      lotCount: lots.length,
      lastBuyPrice: lots[lots.length - 1]?.price,
      lotBuyPrice: lots[0]?.price,
      avgBuyPrice: qty ? cost / qty : 0,
      peakPrice: peak,
      barsHeld: i - (lots[0]?.tIdx ?? i),
    },
  };
  ctx.prev = { ...ctx, i: Math.max(0, i - 1) };
  return ctx;
}

function exitDecision(schema, pos, p, i, accounting) {
  const ex = schema.exit || {};
  const L = exitLotOf(pos.lots, accounting);
  if (!L) return null;
  const price = p.bars.c[i];

  if (ex.targetPct != null && price >= L.price * (1 + ex.targetPct / 100))
    return { mode: ex.exitLotsAtOnce === false ? 'one' : 'all', reason: 'target' };
  if (ex.stopPct != null && price <= L.price * (1 - ex.stopPct / 100))
    return { mode: 'all', reason: 'stop' };
  if (ex.trailPct != null) {
    let peak = -Infinity;
    for (const x of pos.lots) if (x.peak > peak) peak = x.peak;
    if (Number.isFinite(peak) && price <= peak * (1 - ex.trailPct / 100)) return { mode: 'all', reason: 'trail' };
  }
  if (ex.timeStopBars != null && (i - L.tIdx) >= ex.timeStopBars) return { mode: 'all', reason: 'time' };
  if (ex.condition) {
    const ctx = posCtx(p, pos, i);
    if (truthy(evalExpr(ex.condition, ctx))) return { mode: 'all', reason: 'condition' };
  }
  return null;
}

function closeSymbolLots(positions, symbol, mode, accounting, price, date, i, trades, costPreset, reason, p) {
  const pos = positions.get(symbol);
  if (!pos || !pos.lots.length) return 0;
  const toClose = mode === 'one'
    ? [accounting === 'LIFO' ? pos.lots.pop() : pos.lots.shift()]
    : pos.lots.splice(0, pos.lots.length);

  let proceeds = 0;
  for (const L of toClose) {
    const c = tradeCost('sell', price, L.qty, costPreset);
    const gross = (price - L.price) * L.qty;
    trades.push({
      symbol,
      entryDate: p.bars.t[L.tIdx], exitDate: date,
      entryIdx: L.tIdx, exitIdx: i,
      entryPrice: L.price, exitPrice: price, qty: L.qty,
      gross, costs: c.total + L.cost, net: gross - c.total - L.cost,
      pct: L.price ? (price - L.price) / L.price * 100 : 0,
      bars: i - L.tIdx, reason,
    });
    proceeds += price * L.qty - c.total;
  }
  if (!pos.lots.length) positions.delete(symbol);
  return proceeds;
}

function sizeFor(cash, price, schema, bars, i, slots, capital) {
  const s = schema.sizing || {};
  let budget;
  if (s.mode === 'capitalFraction') budget = capital * (s.value ?? (1 / slots));
  else budget = Math.min(s.value ?? (capital / slots), cash);
  budget = Math.min(budget, cash);
  let qty = Math.floor(budget / price);

  const cap = schema.costs?.volumeCapPct;
  if (cap) {
    const win = Math.min(20, i);
    let avgVol = 0;
    if (win > 0) { for (let j = i - win; j < i; j++) avgVol += bars.vol[j]; avgVol /= win; }
    else avgVol = bars.vol[i];
    const maxQty = Math.floor(avgVol * (cap / 100));
    if (qty > maxQty) qty = maxQty;
  }
  return Math.max(0, qty);
}

function momentum(bars, i, period) {
  const j = i - period;
  if (j < 0 || !bars.c[j]) return 0;
  return (bars.c[i] - bars.c[j]) / bars.c[j] * 100;
}

function distFromMean(bars, i, period) {
  if (i < period) return 0;
  let m = 0;
  for (let k = i - period + 1; k <= i; k++) m += bars.c[k];
  m /= period;
  return m ? (bars.c[i] - m) / m * 100 : 0;
}

function perSymbol(trades) {
  const m = new Map();
  for (const t of trades) {
    if (!m.has(t.symbol)) m.set(t.symbol, { symbol: t.symbol, trades: 0, net: 0, wins: 0 });
    const e = m.get(t.symbol);
    e.trades++; e.net += t.net; if (t.net > 0) e.wins++;
  }
  return [...m.values()].sort((a, b) => b.net - a.net);
}

function avg(arr) { let s = 0; for (const v of arr) s += v; return arr.length ? s / arr.length : 0; }

function cashDrag(equity, concurrent, slots) {
  let idleDays = 0;
  for (const c of concurrent) if (c < slots) idleDays++;
  return concurrent.length ? idleDays / concurrent.length * 100 : 0;
}

function forwardFill(arr) {
  let last = NaN;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) last = arr[i];
    else if (Number.isFinite(last)) arr[i] = last;
  }
}

function emptyPortfolio(schema, options) {
  return {
    schema, trades: [], equity: new Float64Array(0), skipped: [], calendar: [],
    stats: computeStats([], new Float64Array(0), { t: new Float64Array(0) }, options.capital ?? 500000),
    portfolio: { slots: options.slots ?? 10, capital: options.capital ?? 500000, ranking: options.ranking ?? 'momentum',
                 rankingLabel: '', symbols: 0, concurrent: new Uint16Array(0), slotUtilisation: 0,
                 cashDragPct: 0, perSymbol: [], skippedCount: 0 },
    meta: { strategy: schema.label || schema.id, mode: 'portfolio', raw: !!options.raw, from: null, to: null, runAt: Date.now() },
  };
}

/* Conservation audit — cash plus holdings must equal equity every day. */
export function conservationCheck(result, records) {
  const problems = [];
  const eq = result.equity;
  for (let i = 1; i < eq.length; i++) {
    if (!Number.isFinite(eq[i])) { problems.push({ day: i, reason: 'non-finite equity' }); continue; }
    if (eq[i] < 0) problems.push({ day: i, reason: 'negative equity' });
  }
  const sumNet = result.trades.reduce((a, t) => a + t.net, 0);
  const expected = result.portfolio.capital + sumNet;
  const actual = result.stats.finalEquity;
  if (Math.abs(expected - actual) > 1)
    problems.push({ reason: 'final equity does not equal capital + net P&L', expected, actual });
  return { ok: problems.length === 0, problems };
}
