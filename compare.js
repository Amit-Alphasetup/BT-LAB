/* ============================================================
   BACKTEST LAB — compare.js
   Many strategies x one universe -> one ranked table.
   A "strategy" is {kind:'btdesk', id, params} or {kind:'schema', schema}.
   Per run: CAGR, XIRR (money-weighted, from the fills), max drawdown,
   trades, exposure, net P&L. Per strategy: the same, summarised over
   the universe (median CAGR / XIRR / drawdown, totals for trades and P&L).
   Pure functions.
   ============================================================ */
import { runBacktest } from './engine.js';
import { runBtdesk, getBtdeskPreset } from './presets-btdesk.js';
import { xirr } from './extras.js';

const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

/** XIRR of a run: every buy is money out, every sell money in, an open position is valued at the last close. Charges included. */
export function runXirr(res, bars) {
  const flows = [];
  for (const f of (res.fills || [])) flows.push({ t: bars.t[f.i], v: (f.side === 'buy' ? -1 : 1) * f.price * f.qty });
  const last = bars.t.length - 1;
  if (res.open) flows.push({ t: bars.t[last], v: res.open.value });
  for (const t of res.trades) {
    if (t.reason === 'end_of_data') flows.push({ t: t.exitDate, v: t.exitPrice * t.qty });   // the closing mark is not a fill
    if (t.costs) flows.push({ t: t.exitDate, v: -t.costs });                                // a trade's charges (both sides) leave on its exit day
  }
  return xirr(flows) * 100;
}

export function strategyLabel(s) { return s.kind === 'btdesk' ? getBtdeskPreset(s.id).label : (s.schema.label || s.schema.id); }

/** one strategy on one symbol -> row */
export function runOne(strategy, symbol, bars, opts = {}) {
  const res = strategy.kind === 'btdesk' ? runBtdesk(bars, strategy.id, strategy.params || {}, { raw: opts.raw, start: opts.start })
    : runBacktest(bars, strategy.schema, { raw: opts.raw });
  if (strategy.kind === 'btdesk' && !res.ok) return { strategy: strategyLabel(strategy), symbol, ok: false, reason: res.reason };
  const s = res.stats;
  return { strategy: strategyLabel(strategy), symbol, ok: true, cagr: s.cagr, xirr: runXirr(res, bars), maxDD: Math.abs(s.maxDD), trades: s.trades, winRate: s.winRate,
    exposure: s.exposurePct, netPnl: s.netPnl + (res.open ? res.open.value - res.open.invested : 0), open: !!res.open };
}

/** compare(strategies, records) -> {rows (every run), summary (one line per strategy, best median XIRR first), skipped} */
export function compare(strategies, records, opts = {}) {
  const rows = [], skipped = [];
  for (const st of strategies) for (const [sym, bars] of Object.entries(records)) {
    const r = runOne(st, sym, bars, opts);
    (r.ok ? rows : skipped).push(r);
  }
  const summary = strategies.map(st => {
    const label = strategyLabel(st), mine = rows.filter(r => r.strategy === label);
    return { strategy: label, symbols: mine.length, cagr: median(mine.map(r => r.cagr)), xirr: median(mine.map(r => r.xirr)), maxDD: median(mine.map(r => r.maxDD)),
      worstDD: mine.length ? Math.max(...mine.map(r => r.maxDD)) : NaN, trades: mine.reduce((a, r) => a + r.trades, 0), exposure: median(mine.map(r => r.exposure)),
      netPnl: mine.reduce((a, r) => a + r.netPnl, 0), profitable: mine.filter(r => r.netPnl > 0).length };
  }).sort((a, b) => (Number.isFinite(b.xirr) ? b.xirr : -Infinity) - (Number.isFinite(a.xirr) ? a.xirr : -Infinity));
  return { rows, summary, skipped };
}

const COLS = [['strategy', 'Strategy'], ['symbol', 'Symbol'], ['cagr', 'CAGR %'], ['xirr', 'XIRR %'], ['maxDD', 'Max drawdown %'], ['trades', 'Trades'], ['winRate', 'Win rate %'], ['exposure', 'Exposure %'], ['netPnl', 'Net P&L'], ['open', 'Open position']];
const cell = v => typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : '"' + String(v ?? '').replace(/"/g, '""') + '"';
/** CSV with one header row and the same columns on every line. meta lines (dataset, universe label) go first as comments. */
export function toCSV(result, meta = {}) {
  const head = Object.entries(meta).map(([k, v]) => `# ${k},${cell(String(v))}`);
  return head.concat([COLS.map(c => c[1]).join(',')], result.rows.map(r => COLS.map(c => cell(r[c[0]])).join(','))).join('\n') + '\n';
}
