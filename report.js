/* ============================================================
   BACKTEST LAB — report.js  (Phase 5: Report + plots)
   Pure computation + small canvas plots. No framework.
   ============================================================ */

import { THEME } from './chart.js';

/* ================= derived analytics ================= */

/* Monthly returns from a daily equity curve -> [{y, m, pct}] */
export function monthlyReturns(bars, equity) {
  const out = [];
  let curKey = null, startVal = null, lastVal = null, y = 0, m = 0;
  for (let i = 0; i < bars.t.length; i++) {
    const v = equity[i];
    if (!Number.isFinite(v)) continue;
    const d = new Date(bars.t[i]);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (curKey === null) { curKey = key; startVal = v; y = d.getUTCFullYear(); m = d.getUTCMonth(); }
    else if (key !== curKey) {
      out.push({ y, m, pct: startVal ? (lastVal - startVal) / startVal * 100 : 0 });
      curKey = key; startVal = lastVal; y = d.getUTCFullYear(); m = d.getUTCMonth();
    }
    lastVal = v;
  }
  if (curKey !== null && startVal != null)
    out.push({ y, m, pct: startVal ? (lastVal - startVal) / startVal * 100 : 0 });
  return out;
}

/* Underwater curve: % below the running peak, per bar. */
export function drawdownSeries(equity) {
  const n = equity.length, out = new Float64Array(n).fill(NaN);
  let peak = NaN;
  for (let i = 0; i < n; i++) {
    const v = equity[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(peak) || v > peak) peak = v;
    out[i] = peak ? (v - peak) / peak * 100 : 0;
  }
  return out;
}

/* Rolling annualised return over a window of bars. */
export function rollingCagr(bars, equity, windowBars = 250) {
  const n = equity.length, out = new Float64Array(n).fill(NaN);
  for (let i = windowBars; i < n; i++) {
    const a = equity[i - windowBars], b = equity[i];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;
    const years = (bars.t[i] - bars.t[i - windowBars]) / 86400000 / 365.25;
    if (years <= 0) continue;
    out[i] = (Math.pow(b / a, 1 / years) - 1) * 100;
  }
  return out;
}

/* Histogram of trade returns. */
export function pnlHistogram(trades, bucketPct = 2) {
  const buckets = new Map();
  for (const t of trades) {
    const b = Math.floor(t.pct / bucketPct) * bucketPct;
    buckets.set(b, (buckets.get(b) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([lo, n]) => ({ lo, hi: lo + bucketPct, n }));
}

/* Best and worst calendar year. */
export function yearlyReturns(bars, equity) {
  const byYear = new Map();
  for (let i = 0; i < bars.t.length; i++) {
    const v = equity[i];
    if (!Number.isFinite(v)) continue;
    const y = new Date(bars.t[i]).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, { first: v, last: v });
    else byYear.get(y).last = v;
  }
  return [...byYear.entries()].map(([y, o]) => ({ y, pct: o.first ? (o.last - o.first) / o.first * 100 : 0 }));
}

/* ================= report assembly ================= */

export function buildReport(result, benchmark, opts = {}) {
  const s = result.stats;
  const b = benchmark?.stats;
  const bars = result.bars;

  return {
    headline: [
      { label: 'Net P&L', value: money(s.netPnl), tone: tone(s.netPnl) },
      { label: 'CAGR', value: pct(s.cagr), tone: tone(s.cagr) },
      { label: 'Max drawdown', value: pct(-Math.abs(s.maxDD)), tone: 'down', sub: s.maxDDDays + ' bars to recover' },
      { label: 'vs Buy & hold', value: b ? pct(s.cagr - b.cagr) : '—', tone: b ? tone(s.cagr - b.cagr) : '', sub: b ? 'B&H ' + pct(b.cagr) : '' },
    ],
    groups: [
      {
        title: 'Returns',
        rows: [
          ['Total return', pct(s.totalReturnPct), tone(s.totalReturnPct)],
          ['CAGR', pct(s.cagr), tone(s.cagr)],
          ['Final equity', money(s.finalEquity)],
          ['Buy & hold CAGR', b ? pct(b.cagr) : '—'],
          ['Difference', b ? pct(s.cagr - b.cagr) : '—', b ? tone(s.cagr - b.cagr) : ''],
        ],
      },
      {
        title: 'Risk',
        rows: [
          ['Max drawdown', pct(-Math.abs(s.maxDD)), 'down'],
          ['Longest drawdown', s.maxDDDays + ' bars'],
          ['Volatility (annual)', pct(s.volatility)],
          ['Sharpe', num(s.sharpe)],
          ['Sortino', num(s.sortino)],
          ['Calmar', num(s.calmar)],
        ],
      },
      {
        title: 'Trades',
        rows: [
          ['Total trades', String(s.trades)],
          ['Win rate', pct(s.winRate)],
          ['Average win', money(s.avgWin), 'up'],
          ['Average loss', money(-Math.abs(s.avgLoss)), 'down'],
          ['Payoff ratio', num(s.payoff)],
          ['Profit factor', num(s.profitFactor)],
          ['Expectancy per trade', money(s.expectancy), tone(s.expectancy)],
          ['Worst losing streak', s.maxConsecLosses + ' trades'],
          ['Average holding', Math.round(s.avgBars) + ' bars'],
        ],
      },
      {
        title: 'Charges',
        rows: [
          ['Total charges paid', money(s.totalCosts)],
          ['Gross P&L', money(s.grossPnl), tone(s.grossPnl)],
          ['Net P&L', money(s.netPnl), tone(s.netPnl)],
          ['Cost drag on CAGR', pct(-Math.abs(s.costDragPct)), 'down'],
          ['Charges applied', result.meta.raw ? 'NONE — raw numbers' : result.meta.costPreset, result.meta.raw ? 'warn' : ''],
        ],
      },
    ],
    caveats: caveats(result, opts),
    period: bars ? `${day(bars.t[0])} to ${day(result.meta.dataAsOf || bars.t[bars.t.length - 1])}` : '',
  };
}

export function caveats(result, opts = {}) {
  const list = [
    'Backtested and hypothetical — these trades were never placed.',
    'Benchmark is price return: cash dividends are excluded from both the strategy and buy & hold, which understates buy & hold by roughly 1.5–3% a year.',
    `Fills are taken at the next bar's open after a signal closes, with ${result.schema?.costs?.slippageBps ?? 5} bps of slippage plus a gap adjustment.`,
  ];
  if (result.meta.raw)
    list.unshift('RAW MODE — no brokerage, taxes or slippage are applied. These numbers are not achievable.');
  if (opts.universe)
    list.push('Universe is today\'s index membership applied to the whole period, so delisted and demoted names are missing. Results are biased upward.');
  if (result.skipped?.length)
    list.push(`${result.skipped.length} signals were not taken because of cash or daily-volume limits.`);
  return list;
}

/* ================= formatting ================= */

export const money = v => (v < 0 ? '−₹' : '₹') + Math.abs(Math.round(v)).toLocaleString('en-IN');
export const pct = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
export const num = v => Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '—';
export const tone = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
export const day = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '—';
export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ================= plots (canvas, no dependency) ================= */

function setup(canvas, h) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const w = canvas.parentElement?.clientWidth || canvas.width || 340;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = '100%'; canvas.style.height = h + 'px';
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = THEME.panel; g.fillRect(0, 0, w, h);
  g.font = '10px ui-monospace, monospace';
  return { g, w, h };
}

export function plotEquity(canvas, bars, equity, benchEquity, height = 170) {
  const { g, w, h } = setup(canvas, height);
  const padL = 6, padR = 48, padB = 16, padT = 8;
  const cw = w - padL - padR, ch = h - padT - padB;
  const vals = [];
  for (let i = 0; i < equity.length; i++) {
    if (Number.isFinite(equity[i])) vals.push(equity[i]);
    if (benchEquity && Number.isFinite(benchEquity[i])) vals.push(benchEquity[i]);
  }
  if (vals.length < 2) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1; hi += pad; lo -= pad;
  const x = i => padL + i / (equity.length - 1) * cw;
  const y = v => padT + (hi - v) / (hi - lo) * ch;

  g.strokeStyle = THEME.rule; g.lineWidth = .5; g.fillStyle = THEME.faint; g.textAlign = 'left';
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3, yy = y(v);
    g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + cw, yy); g.stroke();
    g.fillText(compact(v), padL + cw + 4, yy + 3);
  }
  if (benchEquity) line(g, benchEquity, x, y, THEME.faint, 1);
  line(g, equity, x, y, THEME.amber, 1.6);
  g.fillStyle = THEME.amber; g.fillText('strategy', padL + 2, padT + 9);
  if (benchEquity) { g.fillStyle = THEME.faint; g.fillText('buy & hold', padL + 62, padT + 9); }
}

export function plotDrawdown(canvas, dd, height = 110) {
  const { g, w, h } = setup(canvas, height);
  const padL = 6, padR = 48, padB = 14, padT = 8;
  const cw = w - padL - padR, ch = h - padT - padB;
  let worst = 0;
  for (const v of dd) if (Number.isFinite(v) && v < worst) worst = v;
  if (worst === 0) worst = -1;
  const x = i => padL + i / (dd.length - 1) * cw;
  const y = v => padT + (v / worst) * ch;

  g.fillStyle = 'rgba(192,91,69,.22)';
  g.beginPath(); g.moveTo(padL, padT);
  for (let i = 0; i < dd.length; i++) if (Number.isFinite(dd[i])) g.lineTo(x(i), y(dd[i]));
  g.lineTo(padL + cw, padT); g.closePath(); g.fill();
  line(g, dd, x, y, THEME.down, 1.2);
  g.fillStyle = THEME.faint; g.textAlign = 'left';
  g.fillText(worst.toFixed(1) + '%', padL + cw + 4, padT + ch);
  g.fillText('0%', padL + cw + 4, padT + 4);
}

export function plotHistogram(canvas, hist, height = 130) {
  const { g, w, h } = setup(canvas, height);
  if (!hist.length) return;
  const padL = 6, padR = 6, padB = 18, padT = 8;
  const cw = w - padL - padR, ch = h - padT - padB;
  const maxN = Math.max(...hist.map(b => b.n));
  const bw = cw / hist.length;
  hist.forEach((b, i) => {
    const bh = (b.n / maxN) * ch;
    g.fillStyle = b.lo >= 0 ? THEME.up : THEME.down;
    g.fillRect(padL + i * bw + 1, padT + ch - bh, Math.max(1, bw - 2), bh);
  });
  g.fillStyle = THEME.faint; g.textAlign = 'center';
  g.fillText(hist[0].lo + '%', padL + bw / 2, h - 5);
  g.fillText(hist[hist.length - 1].hi + '%', padL + cw - bw / 2, h - 5);
}

export function plotRolling(canvas, roll, height = 120) {
  const { g, w, h } = setup(canvas, height);
  const padL = 6, padR = 44, padB = 14, padT = 8;
  const cw = w - padL - padR, ch = h - padT - padB;
  const vals = Array.from(roll).filter(Number.isFinite);
  if (vals.length < 2) return;
  let lo = Math.min(...vals, 0), hi = Math.max(...vals, 0);
  const pad = (hi - lo) * 0.08 || 1; hi += pad; lo -= pad;
  const x = i => padL + i / (roll.length - 1) * cw;
  const y = v => padT + (hi - v) / (hi - lo) * ch;
  g.strokeStyle = THEME.rule; g.lineWidth = .5;
  g.beginPath(); g.moveTo(padL, y(0)); g.lineTo(padL + cw, y(0)); g.stroke();
  line(g, roll, x, y, THEME.amber, 1.3);
  g.fillStyle = THEME.faint; g.textAlign = 'left';
  g.fillText(hi.toFixed(0) + '%', padL + cw + 4, padT + 6);
  g.fillText(lo.toFixed(0) + '%', padL + cw + 4, padT + ch);
}

function line(g, arr, x, y, color, width) {
  g.strokeStyle = color; g.lineWidth = width; g.beginPath();
  let started = false;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) { started = false; continue; }
    if (!started) { g.moveTo(x(i), y(v)); started = true; } else g.lineTo(x(i), y(v));
  }
  g.stroke();
}

const compact = v => Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr'
                  : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + 'L'
                  : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0);

/* Monthly heatmap as HTML (a table reads better than a canvas here). */
export function monthlyHeatmapHTML(monthly) {
  if (!monthly.length) return '';
  const years = [...new Set(monthly.map(m => m.y))].sort();
  const byKey = new Map(monthly.map(m => [m.y + ':' + m.m, m.pct]));
  const cell = (v) => {
    if (v == null) return `<td class="mh-empty"></td>`;
    const a = Math.min(1, Math.abs(v) / 12);
    const c = v >= 0 ? `rgba(91,158,118,${0.18 + a * 0.62})` : `rgba(192,91,69,${0.18 + a * 0.62})`;
    return `<td style="background:${c}" title="${v.toFixed(1)}%">${v.toFixed(0)}</td>`;
  };
  const head = `<tr><th></th>${MONTHS.map(m => `<th>${m[0]}</th>`).join('')}<th>Yr</th></tr>`;
  const rows = years.map(y => {
    let acc = 1, any = false;
    for (let m = 0; m < 12; m++) { const v = byKey.get(y + ':' + m); if (v != null) { acc *= 1 + v / 100; any = true; } }
    const yr = any ? (acc - 1) * 100 : null;
    return `<tr><th>${y}</th>${MONTHS.map((_, m) => cell(byKey.get(y + ':' + m))).join('')}${cell(yr)}</tr>`;
  }).join('');
  return `<table class="heatmap">${head}${rows}</table>`;
}
