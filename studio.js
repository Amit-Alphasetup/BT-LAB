/* ============================================================
   BACKTEST LAB — studio.js  (Phase 6: video presentation mode)
   Built to be screen-recorded directly. Every frame carries the
   wordmark and the disclaimer.
   ============================================================ */

import { money, pct, day } from './report.js';

/* ================= verdict ================= */
/*
  The one-line conclusion. Deliberately blunt and never forward-looking:
  it describes what happened, never what will happen.
*/

export function verdict(result, benchmark) {
  const s = result.stats, b = benchmark?.stats;
  if (!s.trades) {
    return { line: 'It never triggered once.', tone: 'flat',
             detail: 'Not a single entry in the whole period.' };
  }
  if (!b) {
    return { line: s.netPnl >= 0 ? 'It made money.' : 'It lost money.',
             tone: s.netPnl >= 0 ? 'up' : 'down', detail: '' };
  }
  const gap = s.cagr - b.cagr;
  const beat = gap > 0;
  let line, tone;
  if (s.netPnl < 0)              { line = 'It lost money.'; tone = 'down'; }
  else if (gap < -3)             { line = 'Buy and hold won. Comfortably.'; tone = 'down'; }
  else if (gap < 0)              { line = 'Buy and hold won.'; tone = 'down'; }
  else if (gap < 1)              { line = 'A dead heat with doing nothing.'; tone = 'flat'; }
  else if (gap < 4)              { line = 'It beat buy and hold, barely.'; tone = 'up'; }
  else                           { line = 'It beat buy and hold.'; tone = 'up'; }
  const detail = `${pct(s.cagr)} a year against ${pct(b.cagr)} for buy and hold, ` +
                 `with a ${pct(-Math.abs(s.maxDD))} worst drawdown.`;
  return { line, tone, detail, gap, beat };
}

/* The hook card: the question, with the answer withheld. */
export function hook(result, schema) {
  const period = result.bars
    ? `${new Date(result.bars.t[0]).getUTCFullYear()}–${new Date(result.meta.dataAsOf || result.bars.t[result.bars.t.length - 1]).getUTCFullYear()}`
    : '';
  const years = result.bars
    ? Math.round((result.bars.t[result.bars.t.length - 1] - result.bars.t[0]) / 86400000 / 365.25)
    : 0;
  return {
    kicker: `${years} YEARS · ${result.stats.trades} TRADES`,
    line: schema.label || 'This strategy',
    sub: (schema.note || '').trim(),
    period,
  };
}

/* ================= slides ================= */
/*
  A deck is a list of frames the Studio steps through. Each frame is
  data only — rendering lives in the UI so the same deck works in
  9:16 and 16:9.
*/

export function buildDeck(result, benchmark, schema, opts = {}) {
  const s = result.stats;
  const v = verdict(result, benchmark);
  const h = hook(result, schema);
  const raw = opts.rawResult;

  const deck = [
    { kind: 'hook', ...h },
    { kind: 'rules', title: 'The rules', items: describeRules(schema) },
  ];

  if (raw && !result.meta.raw) {
    deck.push({
      kind: 'compare',
      title: 'Same strategy, two numbers',
      left:  { label: 'What gets shown', value: pct(raw.stats.cagr), tone: 'raw' },
      right: { label: 'After real charges', value: pct(s.cagr), tone: 'real' },
      note: `${money(s.totalCosts)} paid in brokerage, taxes and slippage across ${s.trades} trades.`,
    });
  }

  deck.push(
    { kind: 'metric', label: 'Compound annual return', value: pct(s.cagr), tone: toneOf(s.cagr),
      sub: benchmark ? `Buy and hold: ${pct(benchmark.stats.cagr)}` : '' },
    { kind: 'metric', label: 'Worst drawdown', value: pct(-Math.abs(s.maxDD)), tone: 'down',
      sub: `${s.maxDDDays} bars before it made a new high` },
    { kind: 'metric', label: 'Win rate', value: pct(s.winRate), tone: toneOf(s.winRate - 50),
      sub: `${s.wins} winners, ${s.losses} losers` },
    { kind: 'verdict', title: v.line, tone: v.tone, detail: v.detail,
      strategy: schema.label, period: result.bars ? `${day(result.bars.t[0])} – ${day(result.meta.dataAsOf || result.bars.t[result.bars.t.length - 1])}` : '' },
  );
  return deck;
}

export function describeRules(schema) {
  const items = [];
  const inds = (schema.indicators || []).map(i => i.key);
  if (inds.length) items.push('Uses ' + inds.join(', '));

  const join = schema.entry?.join === 'ANY' ? 'any of' : 'all of';
  items.push(`Buy when ${join}: ` + (schema.entry?.conditions || []).map(readable).join('; '));

  const ex = schema.exit || {};
  const exits = [];
  if (ex.targetPct != null) exits.push(`+${ex.targetPct}% target`);
  if (ex.stopPct != null) exits.push(`−${ex.stopPct}% stop`);
  if (ex.trailPct != null) exits.push(`${ex.trailPct}% trailing stop`);
  if (ex.timeStopBars != null) exits.push(`${ex.timeStopBars}-bar time limit`);
  if (ex.condition) exits.push(readable(ex.condition));
  if (exits.length) items.push('Sell on: ' + exits.join(', '));

  if (schema.pyramiding?.enabled) items.push(`Adds up to ${schema.pyramiding.maxLots} lots on further signals`);
  items.push('Fills at the next open. Charges and slippage applied.');
  return items;
}

const OP_WORDS = {
  cross_above: 'crosses above', cross_below: 'crosses below',
  gt: 'is above', lt: 'is below', gte: 'is at or above', lte: 'is at or below',
  eq: 'equals', within_pct: 'is within % of',
};

export function readable(expr) {
  if (!Array.isArray(expr)) return String(expr);
  const [op, a, b] = expr;
  if (op === 'and') return expr.slice(1).map(readable).join(' and ');
  if (op === 'or') return expr.slice(1).map(readable).join(' or ');
  if (op === 'not') return 'not ' + readable(a);
  if (op === 'mult') return `${pctOf(b)} of ${readable(a)}`;
  const word = OP_WORDS[op] || op;
  return `${readable(a)} ${word} ${readable(b)}`;
}
const pctOf = (f) => (Number(f) * 100).toFixed(Number(f) * 100 % 1 ? 1 : 0) + '%';

function toneOf(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }

/* ================= count-up animation ================= */
/*
  Returns a stepper rather than running a timer itself, so it is
  testable and honours reduced-motion at the call site.
*/

export function countUp(target, { duration = 900, steps = 30 } = {}) {
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const eased = 1 - Math.pow(1 - p, 3);
    frames.push(target * eased);
  }
  frames[frames.length - 1] = target;
  return { frames, interval: duration / steps };
}

export function animateNumber(el, target, format, opts = {}) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || opts.instant) { el.textContent = format(target); return () => {}; }
  const { frames, interval } = countUp(target, opts);
  let i = 0;
  const timer = setInterval(() => {
    el.textContent = format(frames[i++]);
    if (i >= frames.length) clearInterval(timer);
  }, interval);
  return () => clearInterval(timer);
}

/* ================= frame furniture ================= */

export const DISCLAIMER = 'Backtested · hypothetical · educational only · not investment advice';

/* Publish-lag check: a deck must not carry data newer than the cutoff. */
export function publishCheck(result, { lagDays = 90, now = Date.now() } = {}) {
  const bars = result.bars;
  const problems = [];
  if (!bars || !bars.t.length) return { ok: false, problems: ['No data in this result.'] };
  const lastDate = result.meta.dataAsOf || bars.t[bars.t.length - 1];
  const ageDays = (now - lastDate) / 86400000;
  if (ageDays < lagDays)
    problems.push(`Data runs to ${day(lastDate)} — inside the ${lagDays}-day publishing lag. Set an end date at least ${Math.ceil(lagDays - ageDays)} days earlier before recording.`);
  if (result.meta.raw)
    problems.push('This result is in RAW mode. Show the real number alongside it, or the video overstates the strategy.');
  if (!result.stats.trades)
    problems.push('No trades were taken, so there is no performance to show.');
  return { ok: problems.length === 0, problems, lastDate, ageDays };
}
