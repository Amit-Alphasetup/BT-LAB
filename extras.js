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
