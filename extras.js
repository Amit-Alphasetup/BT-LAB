/* ============================================================
   BACKTEST LAB — extras.js
   Pure helpers ported from the BT/DESK dashboard (no DOM): money-weighted
   return (XIRR). More arrive in P4 (sheet diff, LTI/SIP benchmarks,
   Monte Carlo, run fingerprint).
   ============================================================ */

/* XIRR: the yearly rate r at which sum( v_k / (1+r)^((t_k - t_0)/365 days) ) = 0.
   flows = [{t: epoch ms, v: rupees}] with at least one negative and one positive value. Returns a fraction (0.12 = 12%) or NaN. */
export function xirr(flows) {
  const f = flows.filter(x => x && Number.isFinite(x.v) && x.v !== 0).sort((a, b) => a.t - b.t);
  if (f.length < 2 || !f.some(x => x.v < 0) || !f.some(x => x.v > 0)) return NaN;
  const t0 = f[0].t, yrs = f.map(x => (x.t - t0) / 86400000 / 365);
  const npv = r => { let s = 0; for (let k = 0; k < f.length; k++) s += f[k].v / Math.pow(1 + r, yrs[k]); return s; };
  let lo = -0.9999, hi = 10, flo = npv(lo), fhi = npv(hi);
  if (!(flo * fhi < 0)) return NaN;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
export function cagrPct(startValue, endValue, t0, t1) {
  const years = Math.max(0.001, (t1 - t0) / (365.25 * 86400000));
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

/* LTI benchmark ("long-term investor"): all the money buys whole shares at the first close on/after `start` and is never sold.
   -> {qty, invested, leftover, finalValue, cagr, xirr, equity:[[date, value]]}. A share dearer than the capital = stays in cash. */
export function ltiBenchmark(bars, capital, start) {
  const n = bars.t.length, c = bars.adj ? bars.adj.c : bars.c;
  let s = start ? Array.from(bars.t).findIndex(t => dayOf(t) >= start) : 0;
  if (s < 0 || !n) return { ok: false, reason: 'no bar at or after the start date' };
  const qty = Math.floor(capital / c[s]), invested = qty * c[s], leftover = capital - invested;
  const equity = []; for (let i = s; i < n; i++) equity.push([dayOf(bars.t[i]), qty * c[i] + leftover]);
  const finalValue = equity[equity.length - 1][1];
  const x = qty ? xirr([{ t: bars.t[s], v: -invested }, { t: bars.t[n - 1], v: qty * c[n - 1] }]) * 100 : 0;
  return { ok: true, qty, invested, leftover, finalValue, cagr: cagrPct(capital, finalValue, bars.t[s], bars.t[n - 1]), xirr: x, equity };
}

/* SIP benchmark: the same capital split into equal instalments, one on the first trading day of each month from `start`; whole shares,
   the unspent part of an instalment is carried to the next one. -> {instalments, invested, qty, leftover, finalValue, xirr, dates} */
export function sipBenchmark(bars, capital, start) {
  const n = bars.t.length, c = bars.adj ? bars.adj.c : bars.c;
  let s = start ? Array.from(bars.t).findIndex(t => dayOf(t) >= start) : 0;
  if (s < 0 || !n) return { ok: false, reason: 'no bar at or after the start date' };
  const idx = []; let prev = '';
  for (let i = s; i < n; i++) { const ym = dayOf(bars.t[i]).slice(0, 7); if (ym !== prev) { idx.push(i); prev = ym; } }
  const per = capital / idx.length, flows = [];
  let cash = 0, qty = 0, invested = 0;
  for (const i of idx) {
    cash += per;
    const q = Math.floor(cash / c[i]);
    if (q > 0) { qty += q; cash -= q * c[i]; invested += q * c[i]; flows.push({ t: bars.t[i], v: -q * c[i] }); }
  }
  const value = qty * c[n - 1];
  if (qty) flows.push({ t: bars.t[n - 1], v: value });
  return { ok: true, instalments: idx.length, perInstalment: per, invested, qty, leftover: cash, finalValue: value + (capital - invested), xirr: qty ? xirr(flows) * 100 : 0,
    dates: idx.map(i => dayOf(bars.t[i])) };
}

/* Sheet diff: the app's trades against rows copied from a sheet, matched on the entry date.
   app = [{entryDate (ms or 'YYYY-MM-DD'), entryPrice, exitDate, exitPrice, qty}], sheet = same fields (dates as text).
   -> {matched, differing:[{entryDate, fields:{name:[app, sheet]}}], onlyApp, onlySheet, ok} */
export function sheetDiff(app, sheet, tol = 0.01) {
  const d = x => typeof x === 'number' ? dayOf(x) : String(x || '').slice(0, 10);
  const norm = t => ({ entryDate: d(t.entryDate), entryPrice: +t.entryPrice, exitDate: t.exitDate == null || t.exitDate === '' ? '' : d(t.exitDate), exitPrice: t.exitPrice == null || t.exitPrice === '' ? null : +t.exitPrice, qty: t.qty == null || t.qty === '' ? null : +t.qty });
  const group = rows => { const m = new Map(); for (const r of rows.map(norm)) (m.get(r.entryDate) || m.set(r.entryDate, []).get(r.entryDate)).push(r); return m; };
  const A = group(app), S = group(sheet), out = { matched: 0, differing: [], onlyApp: [], onlySheet: [] };
  for (const [date, as] of A) {
    const ss = S.get(date) || [];
    as.forEach((a, k) => {
      const s = ss[k];
      if (!s) { out.onlyApp.push(a); return; }
      const fields = {};
      if (Math.abs(a.entryPrice - s.entryPrice) > tol) fields.entryPrice = [a.entryPrice, s.entryPrice];
      if (a.exitDate !== s.exitDate) fields.exitDate = [a.exitDate, s.exitDate];
      if (a.exitPrice != null && s.exitPrice != null && Math.abs(a.exitPrice - s.exitPrice) > tol) fields.exitPrice = [a.exitPrice, s.exitPrice];
      if (a.qty != null && s.qty != null && a.qty !== s.qty) fields.qty = [a.qty, s.qty];
      if (Object.keys(fields).length) out.differing.push({ entryDate: date, fields }); else out.matched++;
    });
    for (const s of ss.slice(as.length)) out.onlySheet.push(s);
  }
  for (const [date, ss] of S) if (!A.has(date)) out.onlySheet.push(...ss);
  out.ok = !out.differing.length && !out.onlyApp.length && !out.onlySheet.length;
  return out;
}
/** sheet rows from pasted text: date, entry price, exit date, exit price, quantity per line (tab or comma separated; a header line is skipped). */
export function parseSheetRows(text) {
  return String(text || '').split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p[0]))
    .map(p => ({ entryDate: p[0], entryPrice: +p[1], exitDate: p[2] || '', exitPrice: p[3] === '' || p[3] == null ? null : +p[3], qty: p[4] === '' || p[4] == null ? null : +p[4] }));
}

/* Monte Carlo: the same closed trades in a shuffled order. Changes only the ORDER of the net results: it creates no new trades and says
   nothing about the future. -> {runs, trades, actual:{final, maxDD}, maxDD:{p5,p50,p95}, final} (drawdowns in %) */
export function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function percentile(sorted, p) { if (!sorted.length) return NaN; const x = (sorted.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x); return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo); }
function ddOf(pnls, capital) { let eq = capital, peak = eq, max = 0; for (const p of pnls) { eq += p; if (eq > peak) peak = eq; const dd = peak > 0 ? (peak - eq) / peak : 0; if (dd > max) max = dd; } return { final: eq, maxDD: max * 100 }; }
export function monteCarlo(netPnls, { runs = 2000, seed = 42, capital = 100000 } = {}) {
  const p = netPnls.filter(Number.isFinite);
  if (p.length < 5) return { ok: false, reason: 'needs at least 5 closed trades' };
  const n = Math.min(10000, Math.max(100, runs | 0)), rnd = mulberry32(seed), dds = [];
  for (let s = 0; s < n; s++) {
    const a = p.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    dds.push(ddOf(a, capital).maxDD);
  }
  dds.sort((x, y) => x - y);
  const actual = ddOf(p, capital);
  return { ok: true, runs: n, trades: p.length, seed, capital, actual, final: actual.final, maxDD: { p5: percentile(dds, 0.05), p50: percentile(dds, 0.5), p95: percentile(dds, 0.95) } };
}

/* Run fingerprint: sha256 over the dataset id, the strategy definition, the options and the engine version. Same four inputs -> same
   run, on any machine. Keys are sorted so the order they were written in does not matter. */
export const ENGINE_VERSION = 'btlab-engine-2.0';
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v ?? null);
export async function fingerprint({ datasetId, symbol, strategy, options = {}, engine = ENGINE_VERSION }) {
  const text = stable({ datasetId: datasetId || null, symbol: symbol || null, strategy, options, engine });
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
