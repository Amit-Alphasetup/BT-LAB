/* ============================================================
   BACKTEST LAB — presets-alphadesk.js
   AlphaDesk's LIFO and Dual Momentum backtests, rebuilt as presets.
   The rules are a line-for-line port of AlphaDesk's runLifoBacktestCore and
   runDMBacktestCore (R27), checked trade for trade against AlphaDesk's own runs
   recorded in Chrome (oracle/alphadesk, tests/p5b.test.mjs). AlphaDesk itself
   is not changed. Fill models are AlphaDesk's own two: 'next-open' (default)
   and 'sheet-close'.
   Tenet is NOT ported: see TENET_NOT_PORTED.
   Pure functions. histMap = {SYM: {'YYYY-MM-DD': {open, high, low, close, vol}}}.
   ============================================================ */

export const TENET_NOT_PORTED = 'Tenet trades index/ETF PAIRS on WEEKLY candles (green/red pairs, bid weeks, pool limits, per-pair daily LIFO sells). '
  + 'Backtest Lab\'s engine has no pairs, no weekly bars and no capital pools, so Tenet stays in AlphaDesk (plan §14 defers weekly bars and Tenet engine features).';

export const LIFO_UNIVERSE = [['NIFTYBEES','equity'],['JUNIORBEES','equity'],['MIDSMALL','equity'],['MID150BEES','equity'],['BANKBEES','equity'],['PSUBNKBEES','equity'],['ITBEES','equity'],['PHARMABEES','equity'],['AUTOBEES','equity'],['CONSUMBEES','equity'],['GOLDBEES','gold'],['SILVERBEES','gold'],['HDFCSML250','equity'],['MOM100','equity'],['MOM30IETF','equity'],['MOMENTUM50','equity'],['MAFANG','international'],['MON100','international'],['MONQ50','international'],['HNGSNGBEES','international'],['CPSEETF','equity'],['INFRAIETF','equity'],['MOREALTY','equity'],['MODEFENCE','equity'],['METALIETF','equity'],['ALPHA','equity'],['NEXT50IETF','equity'],['EVINDIA','equity'],['MOENERGY','equity'],['OILIETF','equity'],['TNIDETF','equity'],['EQUAL50ADD','equity'],['LIQUIDBEES','debt']].map(([sym, assetClass]) => ({ sym, name: sym, assetClass }));
export const DM_UNIVERSE = ['NIFTYBEES','JUNIORBEES','MID150BEES','BANKBEES','PSUBNKBEES','ITBEES','PHARMABEES','AUTOBEES','CONSUMBEES','GOLDBEES','SILVERBEES','HDFCSML250','MOM30IETF','MOMENTUM50','MAFANG','MON100','MONQ50','CPSEETF','INFRAIETF','MOREALTY','MODEFENCE','METALIETF','ALPHA','NEXT50IETF','OILIETF','EQUAL50ADD','TATSILV','HDFCSILVER','SILVERIETF','TATAGOLD','GOLDIETF','HDFCGOLD','SBISILVER','PVTBANIETF','SILVER','GOLD1','GROWWPOWER'];
export const ALPHADESK_DEFAULTS = {
  config: { brokerage: 25, slippage: 0.05, minProfit: 200, maxAvgPerDay: 1, wl52Method: 'spike', fixedTargetOn: false, fixedTargetPct: 8, highGuardPct: 5, sellOnFall: true, buyOnRise: false },
  lifo: { capital: 157731, slots: 40, avgFall: 6, minProfit: 200, minVol: 50000, maxLots: 3, maxScan: 20, maxBuysPerDay: 3, maxAvgPerDay: 1, wl52Method: 'spike', fixedTargetOn: false, fixedTargetPct: 8,
    btHighGuard: false, btHighGuardPct: 5, btCompound: false, btLiquidRate: 0, sellOnFall: true, buyOnRise: false, executionMode: 'next-open' },
  dm: { lookback: 182, hurdle: 6, slots: 3, skimPct: 0.25, frPct: 0.0017, executionMode: 'next-open', niftyOn: true, minVol: 50000, btDmCompound: false, rebalDays: 30, momCapital: 300000 },
};
export const ALPHADESK_PRESETS = [
  { id: 'lifo', label: 'AlphaDesk LIFO', note: 'ETFs nearest their 52-week low are bought one slot each; a lot is averaged after a fall; every lot sells on its own target (6/5/4/3.14% by how much capital is in use, and at least the minimum profit).' },
  { id: 'dm', label: 'AlphaDesk Dual Momentum', note: 'Every rebalance the top ETFs by return over the lookback that beat the hurdle are held; empty slots and a Nifty below its 200-day average go to LIQUIDBEES; a gain past the skim level is booked.' },
];

/* ---------- AlphaDesk helpers, ported as they are ---------- */
const finiteParam = (value, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) => { const n = Number(value); if (!Number.isFinite(n)) return fallback; const v = integer ? Math.trunc(n) : n; return (v >= min && v <= max) ? v : fallback; };
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function lifoFriction(cfg, type, qty, price) {
  const turn = Number(qty) * Number(price), b = Number(cfg?.brokerage), sp = Number(cfg?.slippage);
  const brok = Number.isFinite(b) && b >= 0 ? b : 25, slipPct = Number.isFinite(sp) && sp >= 0 ? sp : 0;
  const stt = type === 'SELL' ? turn * 0.00001 : 0, exch = turn * 0.0000322, sebi = turn * 0.000001, stamp = type === 'BUY' ? turn * 0.00015 : 0;
  const gst = (brok + exch + sebi) * 0.18, slip = turn * (slipPct / 100);
  return { turn, friction: +(brok + stt + exch + sebi + stamp + gst + slip).toFixed(2) };
}
export function resolveTarget(invested, equity, c) {
  if (c.fixedTargetOn) { const v = parseFloat(c.fixedTargetPct); return (isFinite(v) && v > 0) ? v : 8; }
  const base = equity || c.capital || 100000, pct = (invested / (base || 1)) * 100;
  return pct < 70 ? 6.0 : pct < 80 ? 5.0 : pct < 90 ? 4.0 : 3.14;
}
const resolveMinProfit = c => { const v = parseFloat(c.minProfit); return (isFinite(v) && v >= 0) ? v : 200; };
const lifoCapacityDecision = ({ deployed = 0, committedCapacity = 0, slot = 0, equity = 0, freeCash = 0, committedCash = 0, buyCost = 0 } = {}) =>
  ({ capitalBlocked: (Number(deployed) + Number(committedCapacity) + Number(slot)) > (Number(equity) * 1.05), cashBlocked: (Number(committedCash) + Number(buyCost)) > Number(freeCash) });
function evaluateLifoEntryGate(c) {
  if (c.soldOutToday) return 'same-day-reentry';
  if (!c.isHeld && c.peakBlocked) return 'peak-guard';
  if (c.isHeld && !c.avgEligible) return 'not-avg-eligible';
  if (c.buyOnRise && !(Number(c.dailyChg) > 0)) return 'rise-gate';
  return 'ok';
}
const NEW_LISTING_SKIP_SESSIONS = 30;
export function newListingCutoffs(histMap, skip = NEW_LISTING_SKIP_SESSIONS) {
  if (!histMap || typeof histMap !== 'object') return {};
  const syms = Object.keys(histMap), sorted = h => h && typeof h === 'object' ? Object.keys(h).sort() : [];
  const nb = sorted(histMap.NIFTYBEES);
  const ref = nb.length ? nb[Math.min(4, nb.length - 1)] : (syms.map(s => { const d = sorted(histMap[s]); return d[Math.min(4, d.length - 1)]; }).filter(Boolean).sort()[0] || null);
  const cut = {};
  if (ref && skip > 0) for (const sym of syms) { if (sym === 'NIFTYBEES') continue; const ds = sorted(histMap[sym]); if (ds.length && ds[0] > ref) cut[sym] = ds.length > skip ? ds[skip] : '9999-12-31'; }
  return cut;
}
const withoutListingBars = (h, cutoff) => { if (!cutoff || !h) return h; const o = {}; for (const d of Object.keys(h)) if (d >= cutoff) o[d] = h[d]; return o; };
const buildHistIndex = hist => Object.keys(hist).map(k => ({ ts: new Date(k).getTime(), close: hist[k].close })).filter(e => e.close > 0).sort((a, b) => a.ts - b.ts);
function get52WHigh(ix, dateTs) { const cutoff = dateTs - 365 * 86400000; let high = 0; for (const e of ix) { if (e.ts >= dateTs) break; if (e.ts >= cutoff && e.close > high) high = e.close; } return high; }
function getRawMinLow(ix, dateTs) { const cutoff = dateTs - 364 * 86400000; let low = Infinity; for (const e of ix) { if (e.ts >= dateTs) break; if (e.ts >= cutoff && e.close < low) low = e.close; } return low === Infinity ? 0 : low; }
function getSpikeFilteredLow(ix, dateTs, thresh = 0.08) {
  const cutoff = dateTs - 365 * 86400000, win = [];
  for (let i = 0; i < ix.length; i++) { const e = ix[i]; if (e.ts >= dateTs) break; if (e.ts >= cutoff) win.push({ close: e.close, i }); }
  if (!win.length) return 0;
  const all = ix.map(e => e.close); let low = Infinity;
  for (const w of win) { const nb = []; for (let k = Math.max(0, w.i - 2); k <= Math.min(all.length - 1, w.i + 2); k++) nb.push(all[k]); nb.sort((a, b) => a - b); const med = nb[Math.floor(nb.length / 2)]; if (w.close < med * (1 - thresh)) continue; if (w.close < low) low = w.close; }
  if (low === Infinity) for (const w of win) if (w.close < low) low = w.close;
  return low === Infinity ? 0 : low;
}
const compute52WL = (ix, ts, m) => m === 'raw' ? getRawMinLow(ix, ts) : getSpikeFilteredLow(ix, ts);

/* App records {symbol,t,o,h,l,c,vol} -> AlphaDesk's histMap, optionally cut to [from, to]. */
export function histMapFromRecords(records, { from = null, to = null } = {}) {
  const out = {};
  for (const [sym, r] of Object.entries(records)) {
    const m = {};
    for (let i = 0; i < r.t.length; i++) { const d = new Date(r.t[i]).toISOString().slice(0, 10); if ((from && d < from) || (to && d > to)) continue; m[d] = { open: r.o[i], high: r.h[i], low: r.l[i], close: r.c[i], vol: r.vol[i] || 0 }; }
    out[sym] = m;
  }
  return out;
}

/* ---------- LIFO (AlphaDesk runLifoBacktestCore) ---------- */
export function runAlphadeskLifo(histMapIn, p, ctx = {}) {
  const cfg = { ...ALPHADESK_DEFAULTS.config, ...(ctx.config || {}) }, uni = ctx.universe || LIFO_UNIVERSE, excluded = new Set(ctx.excluded || []);
  const histMap = {}; for (const [s, h] of Object.entries(histMapIn)) { histMap[s] = {}; for (const [d, b] of Object.entries(h)) histMap[s][d] = { ...b }; }
  const sameClose = p.executionMode === 'sheet-close', executionMode = sameClose ? 'sheet-close' : 'next-open';
  const { startDate, endDate } = p;
  const capital = finiteParam(p.capital, finiteParam(cfg.capital, 100000, { min: 0.01 }), { min: 0.01 });
  const slots = finiteParam(p.slots, finiteParam(cfg.slots, 40, { min: 1, integer: true }), { min: 1, integer: true });
  const avgFall = finiteParam(p.avgFall, 6, { min: 0 });
  const minProfit = resolveMinProfit({ minProfit: p.minProfit != null ? p.minProfit : cfg.minProfit });
  const minVol = finiteParam(p.minVol, 0, { min: 0 });
  const maxLots = finiteParam(p.maxLots, 3, { min: 1, integer: true }), maxScan = finiteParam(p.maxScan, 20, { min: 1, integer: true });
  const maxBuysPerDay = finiteParam(p.maxBuysPerDay, 3, { min: 0, integer: true });
  const maxAvgPerDay = finiteParam(p.maxAvgPerDay, cfg.maxAvgPerDay != null ? cfg.maxAvgPerDay : 1, { min: 0, integer: true });
  const wl52Method = p.wl52Method || cfg.wl52Method || 'spike';
  const fixedTargetOn = p.fixedTargetOn != null ? p.fixedTargetOn : !!cfg.fixedTargetOn;
  const fixedTargetPct = finiteParam(p.fixedTargetPct != null ? p.fixedTargetPct : cfg.fixedTargetPct, 8, { min: 0.01 });
  const btHighGuard = !!p.btHighGuard, btHighGuardPct = finiteParam(p.btHighGuardPct, finiteParam(cfg.highGuardPct, 5, { min: 0 }), { min: 0 });
  const btCompound = !!p.btCompound, btLiquidRate = finiteParam(p.btLiquidRate, 0, { min: 0 });
  const sellOnFall = p.sellOnFall !== undefined ? !!p.sellOnFall : !!cfg.sellOnFall, buyOnRise = p.buyOnRise !== undefined ? !!p.buyOnRise : !!cfg.buyOnRise;
  const fr = (t, q, px) => lifoFriction(cfg, t, q, px).friction;
  let slotSize = capital / slots, totalLiqYield = 0;
  const executionGaps = [];
  const histIndex = {}; for (const s of Object.keys(histMap)) histIndex[s] = buildHistIndex(histMap[s]);
  Object.keys(histMap).forEach(sym => { const h = histMap[sym], ds = Object.keys(h).sort(); for (let j = 1; j < ds.length; j++) if (!h[ds[j]].prev && h[ds[j - 1]]?.close > 0) h[ds[j]].prev = h[ds[j - 1]].close; });
  const listingCut = newListingCutoffs(histMap), entryIndex = {};
  Object.keys(listingCut).forEach(sym => { entryIndex[sym] = buildHistIndex(withoutListingBars(histMap[sym], listingCut[sym])); });
  const allDays = new Set(); Object.values(histMap).forEach(h => Object.keys(h).forEach(d => allDays.add(d)));
  const tradingDays = [...allDays].filter(d => d >= startDate && d <= endDate).sort();
  const openLots = {}; let usedCapital = 0, cash = capital, liqParked = 0, reservedCash = 0;
  const pendingBuys = [], pendingSells = [], lastPx = {}, trades = [], equity = [], fills = [];
  for (const day of tradingDays) {
    const dayTs = new Date(day).getTime();
    const snapshotAll = uni.filter(e => !excluded.has(e.sym)).map(etf => {
      const h = histMap[etf.sym], today = h?.[day]; if (!today?.close) return null;
      const ix = entryIndex[etf.sym] || histIndex[etf.sym], low52 = compute52WL(ix, dayTs, wl52Method), high52 = get52WHigh(ix, dayTs);
      return { sym: etf.sym, name: etf.name, close: today.close, low52, prox: low52 > 0 ? ((today.close - low52) / low52) * 100 : 999, distHigh: high52 > 0 ? ((high52 - today.close) / high52) * 100 : null,
        dailyChg: today.prev ? ((today.close - today.prev) / today.prev) * 100 : 0, vol: today.vol };
    }).filter(Boolean);
    const snapshotEntry = snapshotAll.filter(s => !(minVol > 0 && s.vol > 0 && s.vol < minVol) && !(listingCut[s.sym] && day < listingCut[s.sym]));
    const executePending = (resolve, label) => {
      for (const o of pendingSells.splice(0, pendingSells.length)) {
        const ex = resolve(o.sym), lot = (openLots[o.sym] || []).find(l => l.id === o.lotId);
        if (!lot || lot.closed) continue;
        if (!ex.px) { pendingSells.push(o); executionGaps.push({ date: day, sym: o.sym, side: 'SELL' }); continue; }
        const qty = lot.qty, cost = qty * lot.price, curr = qty * ex.px, sf = fr('SELL', qty, ex.px), bf = fr('BUY', qty, lot.price);
        const grossPnl = curr - cost, netPnl = grossPnl - sf - bf;
        trades.push({ buyDate: lot.date, sym: o.sym, buyPrice: lot.price, qty, invested: cost, sellDate: day, sellPrice: ex.px, holdDays: Math.round((new Date(day) - new Date(lot.date)) / 86400000),
          avgCount: lot.avgCount || 0, grossPnl, netPnl, pnlPct: (netPnl / cost) * 100, exitReason: o.exitReason || 'Target Hit', signalDate: o.signalDate, executionMode });
        fills.push({ date: day, sym: o.sym, side: 'sell', price: ex.px, qty, cost: sf });
        usedCapital -= cost; cash += curr - sf; reservedCash = Math.max(0, reservedCash - (o.reserved || 0)); lot.closed = true;
        if (btCompound && netPnl !== 0) slotSize = Math.max(0, slotSize + netPnl / slots);
      }
      for (const o of pendingBuys.splice(0, pendingBuys.length)) {
        const ex = resolve(o.sym); if (!ex.px) { pendingBuys.push(o); executionGaps.push({ date: day, sym: o.sym, side: 'BUY' }); continue; }
        const bf = fr('BUY', o.qty, ex.px), buyCost = o.qty * ex.px + bf, reserved = o.reserved || 0;
        if (cash < buyCost) { reservedCash = Math.max(0, reservedCash - reserved); continue; }
        reservedCash = Math.max(0, reservedCash - reserved); cash -= buyCost; usedCapital += o.qty * ex.px;
        (openLots[o.sym] = openLots[o.sym] || []).push({ date: day, price: ex.px, qty: o.qty, name: o.name, avgCount: o.avgCount || 0, closed: false, id: o.id, signalDate: o.signalDate });
        fills.push({ date: day, sym: o.sym, side: 'buy', price: ex.px, qty: o.qty, cost: bf, label });
      }
    };
    const execOpen = sym => { const b = histMap[sym]?.[day]; return b && b.open > 0 ? { px: b.open } : { px: 0 }; };
    const execClose = sym => ({ px: histMap[sym]?.[day]?.close || 0 });
    if (!sameClose) executePending(execOpen, 'next-open');
    const effEq = () => btCompound ? (cash + usedCapital + liqParked) : capital;
    const targetPct = resolveTarget(usedCapital, effEq() || capital, { fixedTargetOn, fixedTargetPct, capital });
    Object.keys(openLots).forEach(sym => {
      const lots = openLots[sym]; if (!lots?.length) return;
      const snap = snapshotAll.find(s => s.sym === sym); if (!snap) return;
      lots.forEach(lot => {
        if (lot.closed) return;
        const cost = lot.qty * lot.price, gain = lot.qty * snap.close - cost, gainPct = (gain / cost) * 100;
        const net = gain - fr('SELL', lot.qty, snap.close) - fr('BUY', lot.qty, lot.price);
        if (gainPct < targetPct || net < minProfit) return;
        if (sellOnFall && !(snap.dailyChg < 0)) return;
        if (pendingSells.some(o => o.lotId === lot.id)) return;
        pendingSells.push({ sym, lotId: lot.id, signalDate: day, exitReason: sellOnFall ? 'Target+Trailing' : 'Target Hit', reserved: 0 });
      });
      openLots[sym] = lots.filter(l => !l.closed); if (!openLots[sym].length) delete openLots[sym];
    });
    const soldOutToday = new Set([...trades.filter(t => t.sellDate === day).map(t => t.sym), ...pendingSells.map(o => o.sym)]);
    const ranked = [...snapshotEntry].filter(s => !excluded.has(s.sym)).sort((a, b) => a.prox - b.prox).slice(0, maxScan);
    let buysToday = 0, avgToday = 0, capitalHalted = false;
    const afford = cost => { if (btLiquidRate > 0 && cash < cost && liqParked > 0) { const w = Math.min(liqParked, cost - cash); liqParked -= w; cash += w; } return !lifoCapacityDecision({ freeCash: cash, committedCash: 0, buyCost: cost }).cashBlocked; };
    const exhausted = () => { const committed = pendingBuys.reduce((a, o) => a + Number(o.capacityReserve || slotSize), 0); return lifoCapacityDecision({ deployed: usedCapital, committedCapacity: committed, slot: slotSize, equity: effEq(), freeCash: cash, committedCash: reservedCash, buyCost: 0 }).capitalBlocked; };
    for (const s of ranked) {
      if (buysToday >= maxBuysPerDay) break;
      if ((openLots[s.sym] || []).some(l => !l.closed)) continue;
      const gate = evaluateLifoEntryGate({ isHeld: false, peakBlocked: btHighGuard && s.distHigh !== null && s.distHigh <= btHighGuardPct, soldOutToday: soldOutToday.has(s.sym), buyOnRise, dailyChg: s.dailyChg, avgEligible: false });
      if (gate === 'same-day-reentry' || gate === 'peak-guard') continue;
      if (exhausted()) { capitalHalted = true; break; }
      if (gate === 'rise-gate') continue;
      const qty = Math.ceil(slotSize / s.close) || 1, est = qty * s.close + fr('BUY', qty, s.close);
      if (!afford(est + reservedCash)) continue;
      pendingBuys.push({ sym: s.sym, name: s.name, qty, avgCount: 0, signalDate: day, reserved: est, capacityReserve: slotSize, id: `bt-${s.sym}-${day}` }); reservedCash += est; buysToday++;
    }
    if (buysToday === 0 && !capitalHalted) {
      for (const s of ranked) {
        if (avgToday >= maxAvgPerDay) break;
        const active = (openLots[s.sym] || []).filter(l => !l.closed);
        if (!active.length || pendingSells.some(o => o.sym === s.sym) || active.length >= maxLots) continue;
        const last = active[active.length - 1], fall = ((s.close - last.price) / last.price) * 100;
        if (!(fall <= -avgFall)) continue;
        const gate = evaluateLifoEntryGate({ isHeld: true, peakBlocked: false, soldOutToday: soldOutToday.has(s.sym), buyOnRise, dailyChg: s.dailyChg, avgEligible: true });
        if (gate === 'same-day-reentry' || gate === 'rise-gate') continue;
        if (exhausted()) { capitalHalted = true; break; }
        const qty = Math.ceil(slotSize / s.close) || 1, est = qty * s.close + fr('BUY', qty, s.close);
        if (!afford(est + reservedCash)) continue;
        pendingBuys.push({ sym: s.sym, name: s.name, qty, avgCount: active.length, signalDate: day, reserved: est, capacityReserve: slotSize, id: `bt-${s.sym}-${day}-avg${active.length}` }); reservedCash += est;
        avgToday++; buysToday++;
      }
    }
    if (sameClose) executePending(execClose, 'sheet-close');
    if (btLiquidRate > 0) { const r = btLiquidRate / 100 / 252; totalLiqYield += liqParked * r; liqParked *= (1 + r); const free = cash - slotSize; if (free > slotSize && buysToday === 0) { liqParked += free; cash -= free; totalLiqYield += free * r; } }
    snapshotAll.forEach(s => lastPx[s.sym] = s.close);
    let mtm = 0; Object.keys(openLots).forEach(sym => openLots[sym].forEach(l => { if (!l.closed) mtm += l.qty * (lastPx[sym] || l.price); }));
    equity.push({ d: day, eq: cash + mtm + liqParked, cash, positions: mtm + liqParked });
  }
  const open = []; Object.keys(openLots).forEach(sym => openLots[sym].forEach(l => { if (!l.closed) open.push({ sym, date: l.date, price: l.price, qty: l.qty, last: lastPx[sym] || l.price }); }));
  return { ok: true, preset: 'lifo', executionMode, trades, fills, equity, open, pending: { buys: pendingBuys.length, sells: pendingSells.length, reservedCash }, executionGaps,
    endEq: equity.length ? equity[equity.length - 1].eq : capital, capital, liqYield: totalLiqYield };
}

/* ---------- Dual Momentum (AlphaDesk runDMBacktestCore; NAV starts at 100) ---------- */
export function computeDmDecision(histMap, asOfDate, { lookback = 182, hurdle = 6, slots = 3, niftyOn = true, minVol = 0, etfs = [] } = {}) {
  const hurdlePct = (Math.pow(1 + hurdle / 100, lookback / 365.25) - 1) * 100, seasoned = newListingCutoffs(histMap);
  const pxAt = (sym, date) => { const h = histMap?.[sym]; if (!h) return null; const c = seasoned[sym] || ''; const ds = Object.keys(h).filter(d => d <= date && d >= c).sort(); if (!ds.length) return null; const b = h[ds.at(-1)]; return { close: +b.close || 0, vol: +b.vol || 0 }; };
  const retAt = (sym, date) => { const cur = pxAt(sym, date); if (!cur?.close) return null; const past = new Date(date + 'T00:00:00Z'); past.setUTCDate(past.getUTCDate() - lookback); const old = pxAt(sym, past.toISOString().slice(0, 10)); if (!old?.close) return null; return { sym, ret: (cur.close / old.close - 1) * 100, lastVol: cur.vol }; };
  let niftyOk = true, niftyError = '';
  if (niftyOn) { const h = histMap?.NIFTYBEES, ds = h ? Object.keys(h).filter(d => d <= asOfDate).sort() : []; if (ds.length < 200) { niftyOk = false; niftyError = 'NIFTYBEES has fewer than 200 bars'; } else { const last = +h[ds.at(-1)].close || 0, ma = ds.slice(-200).reduce((a, d) => a + (+h[d].close || 0), 0) / 200; if (!(last > 0 && ma > 0)) { niftyOk = false; niftyError = 'NIFTYBEES 200DMA inputs are invalid'; } else niftyOk = last >= ma; } }
  const ranked = [];
  for (const sym of etfs) { if (sym === 'NIFTYBEES') continue; const r = retAt(sym, asOfDate); if (!r) continue; if (minVol > 0 && r.lastVol > 0 && r.lastVol < minVol) continue; ranked.push(r); }
  ranked.sort((a, b) => b.ret - a.ret); const qualified = ranked.filter(r => r.ret > hurdlePct); let topPicks = [];
  if (niftyOn && !niftyOk && !niftyError) topPicks = Array.from({ length: slots }, () => ({ sym: 'LIQUIDBEES' }));
  else if (!niftyError) for (let i = 0; i < slots; i++) topPicks.push(i < qualified.length ? qualified[i] : { sym: 'LIQUIDBEES' });
  return { dataOk: !niftyError, niftyOk, niftyError, ranked, topPicks };
}
export function runAlphadeskDM(histMap, p, ctx = {}) {
  const sameClose = p.executionMode === 'sheet-close', executionMode = sameClose ? 'sheet-close' : 'next-open';
  const { fromDate, toDate } = p;
  const lookback = finiteParam(p.lookback, 182, { min: 1, integer: true }), hurdle = finiteParam(p.hurdle, 6, { min: 0 }), slots = finiteParam(p.slots, 3, { min: 1, integer: true });
  const skimPct = finiteParam(p.skimPct, 0.25, { min: 0 }), frPct = finiteParam(p.frPct, 0.0012, { min: 0 }), niftyOn = !!p.niftyOn, minVol = finiteParam(p.minVol, 0, { min: 0 });
  const dmCompound = p.btDmCompound != null ? !!p.btDmCompound : !!p.dmCompound, rebalDays = finiteParam(p.rebalDays, 30, { min: 1, integer: true });
  const momCapital = finiteParam(p.momCapital, 100000, { min: 0.01 });
  const etfs = [...(p.etfs || ctx.etfs || DM_UNIVERSE)]; if (!etfs.includes('NIFTYBEES')) etfs.push('NIFTYBEES');
  const allDates = new Set(); Object.values(histMap).forEach(h => Object.keys(h).forEach(d => { if (d >= fromDate && d <= toDate) allDates.add(d); }));
  const sortedDates = [...allDates].sort();
  if (sortedDates.length < 30) return { ok: false, reason: 'Not enough data in range.' };
  const sched = [];
  for (let idx = 0; idx < sortedDates.length - 1; idx += rebalDays) {
    const sigDate = sortedDates[Math.min(idx + rebalDays - 1, sortedDates.length - 2)], execDate = sortedDates[Math.min(idx + rebalDays, sortedDates.length - 1)];
    if (sigDate >= toDate || sigDate >= execDate) break; sched.push({ sigDate, execDate });
  }
  if (sched.length < 2) return { ok: false, reason: 'Not enough rebalance periods in range.' };
  const px = (sym, date) => { const h = histMap[sym]; if (!h) return null; const ds = Object.keys(h).filter(d => d <= date).sort(); return ds.length ? h[ds[ds.length - 1]].close : null; };
  const execPx = (sym, date) => { const h = histMap[sym]; if (!h) return null; const b = h[date]; if (sameClose) return b?.close || px(sym, date); return b?.open > 0 ? b.open : null; };
  const executionGaps = [], gap = (sym, date) => { if (!sameClose) executionGaps.push({ date, sym }); };
  let cash = 100, slotSz = 100 / slots, liqValue = 0, liqSlots = 0, liqEntryDate = '', liqCost = 0, prevExec = fromDate;
  const positions = {}, tradeLog = [], equity = [];
  const held = (sym, pos) => Math.round((new Date(sym) - new Date(pos)) / 86400000);
  for (const { sigDate, execDate: sched_ } of sched) {
    const execDate = sameClose ? sigDate : sched_;
    const dec = computeDmDecision(histMap, sigDate, { lookback, hurdle, slots, niftyOn, minVol, etfs: etfs.filter(x => x !== 'NIFTYBEES') });
    if (!dec.dataOk) return { ok: false, reason: `DM data gate failed on ${sigDate}: ${dec.niftyError}` };
    const newTop = dec.topPicks.map(x => x.sym), newLiq = newTop.filter(s => s === 'LIQUIDBEES').length, oldLiq = liqSlots;
    const close = (sym, action, reason) => { const pos = positions[sym], cp = execPx(sym, execDate); if (!cp) { gap(sym, execDate); return; } const val = pos.units * cp, f = val * frPct; cash += val - f;
      tradeLog.push({ date: execDate, sym, action, entryDate: pos.entryDate, entryPrice: pos.entryPrice, exitPrice: cp, units: +pos.units.toFixed(4), friction: +f.toFixed(2), exitReason: reason, pnl: (val - f) - pos.costBasis, holdDays: held(execDate, pos.entryDate) }); delete positions[sym]; };
    Object.entries(positions).forEach(([sym, pos]) => { const cp = execPx(sym, execDate); if (!cp) return; const g = (cp - pos.entryPrice) / pos.entryPrice; if (g >= skimPct) close(sym, 'SKIM', 'skim'); else return; });
    Object.keys(positions).forEach(sym => { if (!newTop.includes(sym)) close(sym, 'SELL', 'dropped'); });
    if (liqValue > 0 && liqSlots > 0) { const a = px('LIQUIDBEES', prevExec), b = px('LIQUIDBEES', execDate); if (a > 0 && b > 0) liqValue *= b / a; }
    if (newLiq < oldLiq && liqValue > 0) { const rel = oldLiq - newLiq, per = liqValue / oldLiq, released = rel * per, cps = liqCost / oldLiq, cr = rel * cps;
      tradeLog.push({ date: execDate, sym: 'LIQUIDBEES', action: 'EXIT', units: rel, friction: 0, entryDate: liqEntryDate, entryPrice: cps, exitPrice: per, costBasis: cr, pnl: released - cr, holdDays: held(execDate, liqEntryDate) });
      cash += released; liqValue -= released; liqCost = newLiq > 0 ? liqCost - cr : 0; liqSlots = newLiq; if (liqSlots === 0) liqEntryDate = ''; }
    newTop.filter(s => s !== 'LIQUIDBEES').forEach(sym => { if (positions[sym]) return; const cp = execPx(sym, execDate); if (!cp) { gap(sym, execDate); return; } if (slotSz <= 0 || cash < slotSz - 1e-9) return;
      const f = slotSz * frPct, units = (slotSz - f) / cp; positions[sym] = { units, entryPrice: cp, entryDate: execDate, costBasis: slotSz }; cash -= slotSz;
      tradeLog.push({ date: execDate, sym, action: 'BUY', entryDate: execDate, entryPrice: cp, exitPrice: null, units: +units.toFixed(4), friction: +f.toFixed(2), costBasis: +slotSz.toFixed(2), pnl: null, holdDays: null }); });
    if (newLiq > oldLiq) { const add = newLiq - oldLiq, want = add * slotSz, v = Math.min(want, Math.max(0, cash)); liqValue += v; liqCost += v; cash -= v; if (!liqEntryDate) liqEntryDate = execDate; liqSlots = newLiq;
      tradeLog.push({ date: execDate, sym: 'LIQUIDBEES', action: 'BUY', units: add, entryDate: execDate, entryPrice: v / add, costBasis: v, exitPrice: null, pnl: null, holdDays: null }); }
    if (cash < -1e-9) return { ok: false, reason: 'negative cash on ' + execDate };
    let nav = cash + liqValue; Object.entries(positions).forEach(([sym, pos]) => { nav += pos.units * (px(sym, execDate) || pos.entryPrice); });
    equity.push({ date: execDate, nav: Math.max(0, nav) });
    if (dmCompound) { const pnl = tradeLog.filter(t => t.date === execDate && t.pnl != null).reduce((s, t) => s + t.pnl, 0); if (pnl !== 0) slotSz = Math.max(0, slotSz + pnl / slots); }
    prevExec = execDate;
  }
  if (equity.length < 3) return { ok: false, reason: 'Not enough months simulated.' };
  return { ok: true, preset: 'dm', executionMode, tradeLog, equity, executionGaps, endNav: equity[equity.length - 1].nav, momCapital, positions };
}
