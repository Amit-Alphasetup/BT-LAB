/* ============================================================
   BACKTEST LAB — signals.js
   What to do at the NEXT session, from data up to the latest bar: the
   dashboard strategies (presets-btdesk.js) are run to the last bar and
   their end state is turned into order cards.

   Card kinds
     gtt_buy       a buy stop whose level is known in advance (SST)
     at_close_buy  buy at the next session's close (BLSH, Smart Averaging) or when the close confirms (SuperBreakout)
     exit          a resting limit sell at the target, whole position
     ladder        one limit sell per open lot (SST 2.0)
     near          nothing to place yet; how far the trigger is
   Quantity comes from the preset's sizing rule (rupees per buy / price) on the
   as-traded price. No live data here: quotes.js adds the last traded price.
   Pure functions.
   ============================================================ */
import { runBtdesk, getBtdeskPreset } from './presets-btdesk.js';

const day = ms => new Date(ms).toISOString().slice(0, 10);
const r2 = x => Math.round(x * 100) / 100;
const qtyFor = (amount, price) => (price > 0 && amount > 0) ? Math.floor(amount / price) : 0;
const pctTo = (from, to) => (to / from - 1) * 100;

/** Plain text a person can paste into a broker's order window or a note. */
export function orderText(c) {
  const p = x => '₹' + r2(x).toFixed(2);
  if (c.kind === 'gtt_buy') return `BUY ${c.symbol} qty ${c.qty} — GTT buy, trigger ${p(c.level)}; if it opens above, it fills at the open`;
  if (c.kind === 'at_close_buy') return `BUY ${c.symbol} qty ${c.qty} — market order near the close (~${p(c.level)})${c.condition ? '; only if ' + c.condition : ''}`;
  if (c.kind === 'exit') return `SELL ${c.symbol} qty ${c.qty} — GTT limit sell at ${p(c.level)}`;
  if (c.kind === 'ladder') return c.lots.map(L => `SELL ${c.symbol} qty ${L.qty} — GTT limit sell at ${p(L.target)}`).join('\n');
  return `${c.symbol}: nothing to place — ${c.note}`;
}

/** cards for one symbol and one dashboard strategy. bars = the app's record; nearPct = how close counts as "near". */
export function buildSignals(bars, presetId, params = {}, opts = {}) {
  const preset = getBtdeskPreset(presetId), nearPct = opts.nearPct ?? 2;
  const res = runBtdesk(bars, presetId, params, { start: opts.start });
  if (!res.ok) return { ok: false, reason: res.reason, cards: [] };
  const P = res.meta.params, e = res.end, n = bars.t.length, last = bars.c[n - 1], sym = bars.symbol || opts.symbol || '';
  const cards = [], base = { preset: presetId, strategy: preset.label, symbol: sym, asOf: day(bars.t[n - 1]), lastClose: last };
  const add = c => { const card = { ...base, ...c }; card.text = orderText(card); cards.push(card); };
  const near = (level, note) => { const d = pctTo(last, level); add({ kind: 'near', level, distancePct: d, isNear: Math.abs(d) <= nearPct, note }); };

  if (presetId === 'sstlifo') {
    if (e.ladder.length) add({ kind: 'ladder', orderType: 'limit_sell', qty: e.qty, lots: e.ladder.map(L => ({ qty: L.qty, bought: L.price, target: L.target, since: day(bars.t[L.since]), toGoPct: pctTo(last, L.target) })) });
    if (e.armed && qtyFor(P.perTxAmount, e.level) > 0) add({ kind: 'gtt_buy', orderType: 'stop_buy', level: e.level, qty: qtyFor(P.perTxAmount, e.level), note: 'armed at the 20-day low; buys when the high passes the 20-day high' });
    else near(e.low20, e.armed ? 'one lot costs more than the amount per buy' : 'not armed: arms when the low touches the 20-day low');
    return { ok: true, cards, end: e };
  }
  if (e.holding) add({ kind: 'exit', orderType: 'limit_sell', level: e.target, qty: e.qty, avg: e.avg, toGoPct: pctTo(last, e.target) });

  if (presetId === 'superbreakout') {
    if (!e.holding) {
      if (!e.canBuyNext) add({ kind: 'near', level: e.smaMax, distancePct: pctTo(last, e.smaMax), isNear: false, note: 'just sold: the rules stay flat for one session' });
      else if (last > e.smaMax && qtyFor(e.amount, last) > 0) add({ kind: 'at_close_buy', orderType: 'at_close', level: last, qty: qtyFor(e.amount, last), condition: `the close stays above ₹${r2(e.smaMax).toFixed(2)} (all six averages)` });
      else near(e.smaMax, 'buys at a close above all six moving averages');
    }
  } else if (presetId === 'smartavg') {
    if (e.buyNext && e.ready <= P.maxBuys && qtyFor(P.perTxAmount, last) > 0) add({ kind: 'at_close_buy', orderType: 'at_close', level: last, qty: qtyFor(P.perTxAmount, last), lot: e.ready });
    else if (e.holding) add({ kind: 'near', level: e.target, distancePct: pctTo(last, e.target), isNear: Math.abs(pctTo(last, e.target)) <= nearPct, note: e.ready > P.maxBuys ? 'all lots bought: waiting for the target' : 'no add today' });
  } else if (presetId === 'blsh') {
    if (e.buyNext && qtyFor(P.perTxAmount, last) > 0) add({ kind: 'at_close_buy', orderType: 'at_close', level: last, qty: qtyFor(P.perTxAmount, last), lot: e.ready, note: 'the close crossed the trigger today: the buy is at the NEXT close' });
    else if (e.ready <= P.maxBuys && e.trigger != null) near(e.trigger, 'buys the day after the close crosses above 5% over the 25-day low close');
  } else if (presetId === 'sst') {
    const q = qtyFor(P.perTxAmount, e.level);
    if (e.blocked) near(e.level, 'just sold: the rules place no buy on the next session');
    else if (!e.lotsLeft) near(e.target ?? e.level, 'all lots bought: waiting for the target');
    else if (e.armed && q > 0) add({ kind: 'gtt_buy', orderType: 'stop_buy', level: e.level, qty: q, lot: e.ready, note: 'armed; valid only if the day also trades below the level' });
    else near(e.low20, e.armed ? 'one lot costs more than the amount per buy' : 'not armed: arms when the low touches the 20-day low');
  }
  return { ok: true, cards, end: e };
}

/** every chosen strategy on every symbol. records = {SYM: bars}. -> {cards, skipped:[{symbol, preset, reason}]} sorted: orders first, then near, by distance. */
export function scanSignals(records, presetIds, params = {}, opts = {}) {
  const cards = [], skipped = [];
  for (const [sym, bars] of Object.entries(records)) for (const id of presetIds) {
    const r = buildSignals({ ...bars, symbol: bars.symbol || sym }, id, params, opts);
    if (!r.ok) { skipped.push({ symbol: sym, preset: id, reason: r.reason }); continue; }
    cards.push(...r.cards);
  }
  const rank = c => ({ gtt_buy: 0, at_close_buy: 1, exit: 2, ladder: 3, near: 4 }[c.kind]);
  cards.sort((a, b) => rank(a) - rank(b) || Math.abs(a.distancePct ?? a.toGoPct ?? 0) - Math.abs(b.distancePct ?? b.toGoPct ?? 0) || a.symbol.localeCompare(b.symbol));
  return { cards, skipped };
}
