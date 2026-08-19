/* ============================================================
   BACKTEST LAB — engine.js  (Phase 2: Engine + Strategy Schema)
   Pure functions. No DOM, no IndexedDB. Runs in a Worker or main thread.
   MASTER PLAN v2.0 Part C Phase 2.
   ============================================================ */

export const SCHEMA_VERSION = 1;

/* ================= INDICATORS ================= */
/* All take Float64Array in, return Float64Array of same length, NaN during warmup. */

export function SMA(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i];
    if (i >= period) sum -= src[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function EMA(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i < period - 1) { sum += src[i]; continue; }
    if (i === period - 1) { sum += src[i]; out[i] = sum / period; continue; }
    out[i] = src[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function WMA(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  const denom = period * (period + 1) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += src[i - period + 1 + j] * (j + 1);
    out[i] = acc / denom;
  }
  return out;
}

/* Wilder's RSI */
export function RSI(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  if (n < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = src[i] - src[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/* Wilder's ATR — needs h,l,c */
export function ATR(h, l, c, period) {
  const n = c.length, out = new Float64Array(n).fill(NaN);
  if (n < period + 1) return out;
  const tr = new Float64Array(n);
  tr[0] = h[0] - l[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period + 1; i < n; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}

export function STDDEV(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = 0;
    for (let j = i - period + 1; j <= i; j++) m += src[j];
    m /= period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = src[j] - m; v += d * d; }
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

export function HIGHEST(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
  return out;
}

export function LOWEST(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (src[j] < m) m = src[j];
    out[i] = m;
  }
  return out;
}

export function ROC(src, period) {
  const n = src.length, out = new Float64Array(n).fill(NaN);
  for (let i = period; i < n; i++) {
    const prev = src[i - period];
    out[i] = prev ? (src[i] - prev) / prev * 100 : NaN;
  }
  return out;
}

/* ================= INDICATOR REGISTRY ================= */

export const INDICATORS = {
  SMA:     { args: ['period'], src: true,  fn: (bars, src, a) => SMA(src, a.period) },
  EMA:     { args: ['period'], src: true,  fn: (bars, src, a) => EMA(src, a.period) },
  WMA:     { args: ['period'], src: true,  fn: (bars, src, a) => WMA(src, a.period) },
  RSI:     { args: ['period'], src: true,  fn: (bars, src, a) => RSI(src, a.period) },
  ROC:     { args: ['period'], src: true,  fn: (bars, src, a) => ROC(src, a.period) },
  STDDEV:  { args: ['period'], src: true,  fn: (bars, src, a) => STDDEV(src, a.period) },
  HIGHEST: { args: ['period'], src: true,  fn: (bars, src, a) => HIGHEST(src, a.period) },
  LOWEST:  { args: ['period'], src: true,  fn: (bars, src, a) => LOWEST(src, a.period) },
  AVGVOL:  { args: ['period'], src: false, fn: (bars, _s, a) => SMA(bars.vol, a.period) },
  ATR:     { args: ['period'], src: false, fn: (bars, _s, a) => ATR(bars.h, bars.l, bars.c, a.period) },
  BBUPPER: { args: ['period', 'mult'], src: true, fn: (bars, src, a) => {
    const m = SMA(src, a.period), s = STDDEV(src, a.period), n = src.length;
    const o = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) o[i] = m[i] + s[i] * (a.mult || 2);
    return o;
  }},
  BBLOWER: { args: ['period', 'mult'], src: true, fn: (bars, src, a) => {
    const m = SMA(src, a.period), s = STDDEV(src, a.period), n = src.length;
    const o = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) o[i] = m[i] - s[i] * (a.mult || 2);
    return o;
  }},
  MACD: { args: ['fast', 'slow'], src: true, fn: (bars, src, a) => {
    const f = EMA(src, a.fast || 12), s = EMA(src, a.slow || 26), n = src.length;
    const o = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) o[i] = f[i] - s[i];
    return o;
  }},
  MACDSIG: { args: ['fast', 'slow', 'signal'], src: true, fn: (bars, src, a) => {
    const f = EMA(src, a.fast || 12), s = EMA(src, a.slow || 26), n = src.length;
    const macd = new Float64Array(n).fill(NaN);
    for (let i = 0; i < n; i++) macd[i] = f[i] - s[i];
    return EMA(macd, a.signal || 9);
  }},
};

/* Compute every indicator declared in a schema. Returns {key: Float64Array}. */
export function computeIndicators(bars, schema) {
  const out = {};
  for (const ind of (schema.indicators || [])) {
    const def = INDICATORS[ind.type];
    if (!def) throw new Error('Unknown indicator: ' + ind.type);
    const srcArr = def.src ? pickSource(bars, ind.source || 'close') : null;
    out[ind.key] = def.fn(bars, srcArr, ind);
  }
  return out;
}

function pickSource(bars, name) {
  switch (name) {
    case 'open': return bars.o;
    case 'high': return bars.h;
    case 'low': return bars.l;
    case 'close': return bars.c;
    case 'volume': return bars.vol;
    case 'hl2': { const n = bars.c.length, a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = (bars.h[i] + bars.l[i]) / 2; return a; }
    default: throw new Error('Unknown source: ' + name);
  }
}

/* ================= EXPRESSION EVALUATOR ================= */
/*
  Prefix arrays: ["gt", "close", "sma200"]
  Operands: number | bar field | indicator key | position field | nested expression
*/

const BAR_FIELDS = new Set(['open', 'high', 'low', 'close', 'volume']);
const POS_FIELDS = new Set(['lotBuyPrice', 'lastBuyPrice', 'avgBuyPrice', 'barsHeld', 'lotCount', 'peakPrice']);

export function evalExpr(expr, ctx) {
  if (expr === null || expr === undefined) return NaN;
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') return resolveOperand(expr, ctx);
  if (!Array.isArray(expr)) throw new Error('Bad expression: ' + JSON.stringify(expr));

  const [op, ...args] = expr;
  const v = (k) => evalExpr(args[k], ctx);

  switch (op) {
    case 'add':  return v(0) + v(1);
    case 'sub':  return v(0) - v(1);
    case 'mult': return v(0) * v(1);
    case 'div':  { const d = v(1); return d === 0 ? NaN : v(0) / d; }
    case 'min':  return Math.min(v(0), v(1));
    case 'max':  return Math.max(v(0), v(1));
    case 'abs':  return Math.abs(v(0));

    case 'gt':  return v(0) >  v(1);
    case 'gte': return v(0) >= v(1);
    case 'lt':  return v(0) <  v(1);
    case 'lte': return v(0) <= v(1);
    case 'eq':  return v(0) === v(1);

    case 'and': return args.every(a => truthy(evalExpr(a, ctx)));
    case 'or':  return args.some(a => truthy(evalExpr(a, ctx)));
    case 'not': return !truthy(v(0));

    case 'cross_above': {
      const a = evalExpr(args[0], ctx), b = evalExpr(args[1], ctx);
      const pa = evalExpr(args[0], ctx.prev), pb = evalExpr(args[1], ctx.prev);
      if (!allFinite(a, b, pa, pb)) return false;
      return pa <= pb && a > b;
    }
    case 'cross_below': {
      const a = evalExpr(args[0], ctx), b = evalExpr(args[1], ctx);
      const pa = evalExpr(args[0], ctx.prev), pb = evalExpr(args[1], ctx.prev);
      if (!allFinite(a, b, pa, pb)) return false;
      return pa >= pb && a < b;
    }
    case 'within_pct': {
      const a = v(0), b = v(1), pct = v(2);
      if (!allFinite(a, b, pct) || b === 0) return false;
      return Math.abs(a - b) / Math.abs(b) * 100 <= pct;
    }
    case 'pct_of': {           // value as % of reference: ["pct_of", close, entryPrice] -> 106 means +6%
      const a = v(0), b = v(1);
      return b === 0 ? NaN : a / b * 100;
    }
    default: throw new Error('Unknown operator: ' + op);
  }
}

function truthy(x) { return x === true || (typeof x === 'number' && x !== 0 && Number.isFinite(x)); }
function allFinite(...xs) { return xs.every(x => Number.isFinite(x)); }

function resolveOperand(name, ctx) {
  if (name === 'close')  return ctx.bars.c[ctx.i];
  if (name === 'open')   return ctx.bars.o[ctx.i];
  if (name === 'high')   return ctx.bars.h[ctx.i];
  if (name === 'low')    return ctx.bars.l[ctx.i];
  if (name === 'volume') return ctx.bars.vol[ctx.i];
  if (ctx.ind && ctx.ind[name]) return ctx.ind[name][ctx.i];
  if (ctx.pos && name in ctx.pos) return ctx.pos[name];
  const num = Number(name);
  if (Number.isFinite(num)) return num;
  throw new Error('Unknown operand: ' + name);
}

/* ctx.prev: same ctx one bar back (for cross detection) */
function makeCtx(bars, ind, i, pos) {
  const ctx = { bars, ind, i, pos };
  ctx.prev = i > 0 ? { bars, ind, i: i - 1, pos } : { bars, ind, i: 0, pos };
  return ctx;
}

/* ================= COSTS (Zerodha delivery preset) ================= */

export const COST_PRESETS = {
  zerodha_delivery: {
    label: 'Zerodha delivery (equity)',
    brokeragePct: 0,          // ₹0 on delivery
    brokerageMax: 0,
    sttBuyPct: 0.1,           // 0.1% on buy
    sttSellPct: 0.1,          // 0.1% on sell
    exchangePct: 0.00297,     // NSE transaction charges
    gstPct: 18,               // on (brokerage + exchange + sebi)
    sebiPct: 0.0001,          // ₹10 per crore
    stampBuyPct: 0.015,       // 0.015% on buy only
    dpSell: 15.93,            // flat per sell scrip per day (incl GST)
  },
  zerodha_intraday: {
    label: 'Zerodha intraday (equity)',
    brokeragePct: 0.03, brokerageMax: 20,
    sttBuyPct: 0, sttSellPct: 0.025,
    exchangePct: 0.00297, gstPct: 18, sebiPct: 0.0001,
    stampBuyPct: 0.003, dpSell: 0,
  },
  none: {
    label: 'RAW — no costs',
    brokeragePct: 0, brokerageMax: 0, sttBuyPct: 0, sttSellPct: 0,
    exchangePct: 0, gstPct: 0, sebiPct: 0, stampBuyPct: 0, dpSell: 0,
  },
};

export function tradeCost(side, price, qty, preset = COST_PRESETS.zerodha_delivery) {
  const turnover = price * qty;
  const p = preset;
  let brokerage = turnover * (p.brokeragePct / 100);
  if (p.brokerageMax) brokerage = Math.min(brokerage, p.brokerageMax);
  const stt = turnover * ((side === 'buy' ? p.sttBuyPct : p.sttSellPct) / 100);
  const exch = turnover * (p.exchangePct / 100);
  const sebi = turnover * (p.sebiPct / 100);
  const gst = (brokerage + exch + sebi) * (p.gstPct / 100);
  const stamp = side === 'buy' ? turnover * (p.stampBuyPct / 100) : 0;
  const dp = side === 'sell' ? (p.dpSell || 0) : 0;
  const total = brokerage + stt + exch + sebi + gst + stamp + dp;
  return { brokerage, stt, exch, sebi, gst, stamp, dp, total };
}

/* Gap-aware slippage: base bps + extra proportional to the overnight gap. */
export function slippedPrice(side, fillPrice, prevClose, cfg = {}) {
  const baseBps = cfg.slippageBps ?? 5;
  let bps = baseBps;
  if (cfg.gapAware !== false && Number.isFinite(prevClose) && prevClose > 0) {
    const gapPct = Math.abs(fillPrice - prevClose) / prevClose * 100;
    bps += gapPct * (cfg.gapFactor ?? 10);   // 1% gap -> +10bps
  }
  const adj = fillPrice * (bps / 10000);
  return side === 'buy' ? fillPrice + adj : fillPrice - adj;
}

/* ================= BACKTEST ENGINE ================= */
/*
  bars: {t,o,h,l,c,vol} Float64Arrays (as-traded)  + optional adj:{o,h,l,c}
  schema: strategy definition
  Rules baked in:
   - conditions evaluate on bar CLOSE using adjusted scale
   - fills execute NEXT BAR OPEN using as-traded prices  (no look-ahead)
   - exits are checked before entries on each bar
*/

export function runBacktest(bars, schema, options = {}) {
  const n = bars.t.length;
  if (n < 2) return emptyResult(schema, bars);

  const costPreset = options.raw
    ? COST_PRESETS.none
    : (COST_PRESETS[schema.costs?.preset] || COST_PRESETS.zerodha_delivery);

  // Indicators computed on adjusted scale when available (split-safe maths)
  const indBars = bars.adj
    ? { o: bars.adj.o, h: bars.adj.h, l: bars.adj.l, c: bars.adj.c, vol: bars.vol }
    : bars;
  const ind = computeIndicators(indBars, schema);

  const startIdx = warmupBars(schema);
  const dataAsOf = options.dataAsOf ?? Infinity;      // publish-lag cutoff (SEBI policy)

  const cap0 = schema.sizing?.capital ?? 100000;
  let cash = cap0;
  let lots = [];                 // {qty, price, tIdx, cost}
  const trades = [];
  const equity = new Float64Array(n).fill(NaN);
  const skipped = [];

  let pendingEntry = false, pendingExit = null;   // signals raised on close, filled next open

  for (let i = startIdx; i < n; i++) {
    if (bars.t[i] > dataAsOf) break;

    const prevClose = i > 0 ? bars.c[i - 1] : NaN;

    /* ---- fills from signals raised on the previous bar's close ---- */
    if (pendingExit) {
      const px = slippedPrice('sell', bars.o[i], prevClose, schema.costs);
      cash += closeLots(lots, pendingExit, px, i, bars, trades, costPreset, pendingExit.reason);
      pendingExit = null;
    }
    if (pendingEntry) {
      const px = slippedPrice('buy', bars.o[i], prevClose, schema.costs);
      const qty = sizeOrder(cash, px, schema, bars, i, lots.length);
      if (qty > 0) {
        const c = tradeCost('buy', px, qty, costPreset);
        const outlay = px * qty + c.total;
        if (outlay <= cash) {
          cash -= outlay;
          lots.push({ qty, price: px, tIdx: i, cost: c.total, peak: px });
        } else {
          skipped.push({ tIdx: i, reason: 'insufficient_cash' });
        }
      } else {
        skipped.push({ tIdx: i, reason: 'volume_cap_or_size_zero' });
      }
      pendingEntry = false;
    }

    /* ---- mark equity on this bar's close ---- */
    let posVal = 0;
    for (const L of lots) { posVal += L.qty * bars.c[i]; if (bars.c[i] > L.peak) L.peak = bars.c[i]; }
    equity[i] = cash + posVal;

    /* ---- evaluate signals on this close (fill next open) ---- */
    const pos = positionCtx(lots, bars, i);
    const ctx = makeCtx(indBars, ind, i, pos);

    if (lots.length) {
      const ex = checkExit(schema, ctx, bars, i, lots);
      if (ex) pendingExit = ex;
    }
    if (!pendingExit) {
      const canAdd = lots.length === 0
        ? true
        : (schema.pyramiding?.enabled && lots.length < (schema.pyramiding.maxLots ?? 1));
      if (canAdd && evalCondition(schema.entry, ctx)) {
        if (lots.length === 0 || checkPyramidTrigger(schema, ctx)) pendingEntry = true;
      }
    }
  }

  /* close any open position at the last bar's close (mark-to-market exit) */
  if (lots.length) {
    const i = lastValidIdx(bars, dataAsOf);
    cash += closeLots(lots, { mode: 'all' }, bars.c[i], i, bars, trades, costPreset, 'end_of_data');
    equity[i] = cash;
  }

  forwardFill(equity);
  return { schema, meta: metaOf(bars, schema, costPreset, options), trades, equity, skipped,
           stats: computeStats(trades, equity, bars, cap0) };
}

function warmupBars(schema) {
  let m = 1;
  for (const ind of (schema.indicators || [])) {
    for (const k of ['period', 'slow', 'signal']) if (ind[k] > m) m = ind[k];
  }
  return m + 1;
}

function positionCtx(lots, bars, i) {
  if (!lots.length) return { lotCount: 0 };
  const last = lots[lots.length - 1];
  let qty = 0, cost = 0, peak = -Infinity;
  for (const L of lots) { qty += L.qty; cost += L.qty * L.price; if (L.peak > peak) peak = L.peak; }
  return {
    lotCount: lots.length,
    lotBuyPrice: exitLot(lots, 'LIFO').price,
    lastBuyPrice: last.price,
    avgBuyPrice: qty ? cost / qty : 0,
    barsHeld: i - lots[0].tIdx,
    peakPrice: peak,
  };
}

function exitLot(lots, accounting) {
  if (accounting === 'FIFO') return lots[0];
  if (accounting === 'LIFO') return lots[lots.length - 1];
  return lots[0];
}

function evalCondition(block, ctx) {
  if (!block) return false;
  const conds = block.conditions || [];
  if (!conds.length) return false;
  const results = conds.map(c => truthy(evalExpr(c, ctx)));
  return (block.join || 'ALL') === 'ANY' ? results.some(Boolean) : results.every(Boolean);
}

function checkPyramidTrigger(schema, ctx) {
  const p = schema.pyramiding;
  if (!p || !p.enabled) return false;
  if (!p.trigger) return true;
  return truthy(evalExpr(p.trigger, ctx));
}

function checkExit(schema, ctx, bars, i, lots) {
  const ex = schema.exit || {};
  const accounting = ex.accounting || 'FIFO';
  const L = exitLot(lots, accounting);
  const price = bars.c[i];

  if (ex.targetPct != null && price >= L.price * (1 + ex.targetPct / 100))
    return { mode: ex.exitLotsAtOnce === false ? 'one' : 'all', accounting, reason: 'target' };

  if (ex.stopPct != null && price <= L.price * (1 - ex.stopPct / 100))
    return { mode: 'all', accounting, reason: 'stop' };

  if (ex.trailPct != null) {
    const peak = ctx.pos.peakPrice;
    if (Number.isFinite(peak) && price <= peak * (1 - ex.trailPct / 100))
      return { mode: 'all', accounting, reason: 'trail' };
  }

  if (ex.timeStopBars != null && ctx.pos.barsHeld >= ex.timeStopBars)
    return { mode: 'all', accounting, reason: 'time' };

  if (ex.condition && truthy(evalExpr(ex.condition, ctx)))
    return { mode: 'all', accounting, reason: 'condition' };

  return null;
}

function closeLots(lots, spec, price, i, bars, trades, costPreset, reason) {
  const accounting = spec.accounting || 'FIFO';
  const toClose = spec.mode === 'one'
    ? [accounting === 'LIFO' ? lots.pop() : lots.shift()]
    : lots.splice(0, lots.length);

  let proceeds = 0;
  for (const L of toClose) {
    const c = tradeCost('sell', price, L.qty, costPreset);
    const gross = (price - L.price) * L.qty;
    const net = gross - c.total - L.cost;
    proceeds += price * L.qty - c.total;
    trades.push({
      entryIdx: L.tIdx, exitIdx: i,
      entryDate: bars.t[L.tIdx], exitDate: bars.t[i],
      entryPrice: L.price, exitPrice: price,
      qty: L.qty, gross, costs: c.total + L.cost, net,
      pct: L.price ? (price - L.price) / L.price * 100 : 0,
      bars: i - L.tIdx, reason,
    });
  }
  return proceeds;
}

function sizeOrder(cash, price, schema, bars, i, openLots) {
  const s = schema.sizing || {};
  let budget;
  if (s.mode === 'capitalFraction') budget = cash * (s.value ?? 0.1);
  else budget = Math.min(s.value ?? 10000, cash);
  let qty = Math.floor(budget / price);

  // volume participation cap (MASTER PLAN B10)
  const cap = schema.costs?.volumeCapPct;
  if (cap) {
    const win = Math.min(20, i);           // use whatever history exists
    let avgVol = 0;
    if (win > 0) {
      for (let j = i - win; j < i; j++) avgVol += bars.vol[j];
      avgVol /= win;
    } else {
      avgVol = bars.vol[i];                // first bar: use its own volume
    }
    const maxQty = Math.floor(avgVol * (cap / 100));
    if (qty > maxQty) qty = maxQty;
  }
  return Math.max(0, qty);
}

function lastValidIdx(bars, dataAsOf) {
  for (let i = bars.t.length - 1; i >= 0; i--) if (bars.t[i] <= dataAsOf) return i;
  return bars.t.length - 1;
}

function forwardFill(arr) {
  let last = NaN;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) last = arr[i];
    else if (Number.isFinite(last)) arr[i] = last;
  }
}

function metaOf(bars, schema, costPreset, options) {
  return {
    schemaVersion: SCHEMA_VERSION,
    strategy: schema.label || schema.id,
    symbol: schema.symbol || null,
    bars: bars.t.length,
    from: bars.t[0], to: bars.t[bars.t.length - 1],
    costPreset: costPreset.label,
    raw: !!options.raw,
    dataAsOf: options.dataAsOf ?? null,
    runAt: Date.now(),
  };
}

function emptyResult(schema, bars) {
  return { schema, meta: metaOf(bars, schema, COST_PRESETS.none, {}), trades: [], equity: new Float64Array(0),
           skipped: [], stats: computeStats([], new Float64Array(0), bars, schema.sizing?.capital ?? 100000) };
}

/* ================= STATS ================= */

export function computeStats(trades, equity, bars, capital0) {
  const s = {
    trades: trades.length, wins: 0, losses: 0, winRate: 0,
    grossPnl: 0, totalCosts: 0, netPnl: 0,
    avgWin: 0, avgLoss: 0, payoff: 0, profitFactor: 0, expectancy: 0,
    maxConsecLosses: 0, avgBars: 0, exposurePct: 0,
    finalEquity: capital0, totalReturnPct: 0, cagr: 0,
    maxDD: 0, maxDDDays: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0,
    costDragPct: 0,
  };
  if (!trades.length && !equity.length) return s;

  let winSum = 0, lossSum = 0, consec = 0, barsHeld = 0;
  for (const t of trades) {
    s.grossPnl += t.gross; s.totalCosts += t.costs; s.netPnl += t.net;
    barsHeld += t.bars;
    if (t.net > 0) { s.wins++; winSum += t.net; consec = 0; }
    else { s.losses++; lossSum -= t.net; consec++; if (consec > s.maxConsecLosses) s.maxConsecLosses = consec; }
  }
  s.winRate = trades.length ? s.wins / trades.length * 100 : 0;
  s.avgWin = s.wins ? winSum / s.wins : 0;
  s.avgLoss = s.losses ? lossSum / s.losses : 0;
  s.payoff = s.avgLoss ? s.avgWin / s.avgLoss : 0;
  s.profitFactor = lossSum ? winSum / lossSum : (winSum ? Infinity : 0);
  s.expectancy = trades.length ? s.netPnl / trades.length : 0;
  s.avgBars = trades.length ? barsHeld / trades.length : 0;

  const eq = Array.from(equity).filter(Number.isFinite);
  if (eq.length > 1) {
    s.finalEquity = eq[eq.length - 1];
    s.totalReturnPct = (s.finalEquity - capital0) / capital0 * 100;

    const days = (bars.t[bars.t.length - 1] - bars.t[0]) / 86400000;
    const years = days / 365.25;
    if (years > 0 && s.finalEquity > 0)
      s.cagr = (Math.pow(s.finalEquity / capital0, 1 / years) - 1) * 100;

    // drawdown
    let peak = eq[0], peakIdx = 0, maxDD = 0, maxDDLen = 0;
    for (let i = 1; i < eq.length; i++) {
      if (eq[i] > peak) { peak = eq[i]; peakIdx = i; }
      const dd = (peak - eq[i]) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      const len = i - peakIdx;
      if (dd > 0 && len > maxDDLen) maxDDLen = len;
    }
    s.maxDD = maxDD; s.maxDDDays = maxDDLen;

    // daily returns
    const rets = [];
    for (let i = 1; i < eq.length; i++) if (eq[i - 1]) rets.push(eq[i] / eq[i - 1] - 1);
    if (rets.length > 1) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
      const sd = Math.sqrt(varr);
      const downs = rets.filter(r => r < 0);
      const dsd = downs.length ? Math.sqrt(downs.reduce((a, b) => a + b * b, 0) / downs.length) : 0;
      s.volatility = sd * Math.sqrt(252) * 100;
      s.sharpe = sd ? (mean / sd) * Math.sqrt(252) : 0;
      s.sortino = dsd ? (mean / dsd) * Math.sqrt(252) : 0;
      s.calmar = maxDD ? s.cagr / maxDD : 0;
    }
    // cost drag: CAGR difference if costs were zero
    if (capital0 > 0 && s.grossPnl !== s.netPnl) {
      const gEquity = capital0 + s.grossPnl;
      const years = (bars.t[bars.t.length - 1] - bars.t[0]) / 86400000 / 365.25;
      if (years > 0 && gEquity > 0) {
        const gCagr = (Math.pow(gEquity / capital0, 1 / years) - 1) * 100;
        s.costDragPct = gCagr - s.cagr;
      }
    }
  }
  return s;
}

/* Buy & hold benchmark on the same bars/capital. */
export function buyAndHold(bars, capital0, costPreset = COST_PRESETS.zerodha_delivery, dataAsOf = Infinity) {
  const n = bars.t.length;
  if (n < 2) return { equity: new Float64Array(0), stats: computeStats([], new Float64Array(0), bars, capital0) };
  const endIdx = lastValidIdx(bars, dataAsOf);
  const buyPx = bars.o[1];
  const qty = Math.floor(capital0 / buyPx);
  const buyCost = tradeCost('buy', buyPx, qty, costPreset).total;
  let cash = capital0 - qty * buyPx - buyCost;
  const equity = new Float64Array(n).fill(NaN);
  for (let i = 1; i <= endIdx; i++) equity[i] = cash + qty * bars.c[i];
  const sellCost = tradeCost('sell', bars.c[endIdx], qty, costPreset).total;
  equity[endIdx] -= sellCost;
  const trade = {
    entryIdx: 1, exitIdx: endIdx, entryDate: bars.t[1], exitDate: bars.t[endIdx],
    entryPrice: buyPx, exitPrice: bars.c[endIdx], qty,
    gross: (bars.c[endIdx] - buyPx) * qty,
    costs: buyCost + sellCost,
    net: (bars.c[endIdx] - buyPx) * qty - buyCost - sellCost,
    pct: (bars.c[endIdx] - buyPx) / buyPx * 100,
    bars: endIdx - 1, reason: 'hold',
  };
  forwardFill(equity);
  return { equity, trades: [trade], stats: computeStats([trade], equity, bars, capital0) };
}
