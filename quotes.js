/* ============================================================
   BACKTEST LAB — quotes.js
   Live quotes through the Market Bridge Worker (the one AlphaDesk uses):
     GET <worker>/quotes?symbols=A,B,C  ->  {quotes:[{symbol, price, open, high, low, changePct, asOf, tradingSymbol}], unresolved:[{symbol,error}]}
   Symbols go in batches of 100. Every quote gets a badge:
     provisional  a market-hours price of today: it can still change before the close
     final        a price from at or after the close (15:30 IST) of the latest session
     stale        older than it should be
     untimed      the Worker gave no time for it: never trusted as current
   Pure except for the fetch that is passed in (or the global one).
   ============================================================ */
export const BATCH = 100;
const IST = 330 * 60000, CLOSE_MIN = 15 * 60 + 30, OPEN_MIN = 9 * 60 + 15;
const ist = ms => { const d = new Date(ms + IST); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() }; };

/** badge for a quote observed at asOfMs, judged at nowMs. staleMin = allowed age during market hours. */
export function quoteBadge(asOfMs, nowMs, staleMin = 15) {
  if (!Number.isFinite(asOfMs)) return 'untimed';
  if (asOfMs > nowMs + 60000) return 'stale';                                    // a time in the future is not a current price
  const q = ist(asOfMs), n = ist(nowMs), marketOpenNow = n.dow >= 1 && n.dow <= 5 && n.min >= OPEN_MIN && n.min < CLOSE_MIN;
  if (q.date === n.date) {
    if (marketOpenNow) return (nowMs - asOfMs) > staleMin * 60000 ? 'stale' : 'provisional';
    return q.min >= CLOSE_MIN - 5 ? 'final' : (n.min < OPEN_MIN ? 'final' : 'stale');
  }
  if (marketOpenNow) return 'stale';                                             // the market is trading and this is a previous day's price
  const ageDays = (Date.parse(n.date) - Date.parse(q.date)) / 86400000;
  return (q.min >= CLOSE_MIN - 5 && ageDays <= 4) ? 'final' : 'stale';           // last close, seen in the evening / at the weekend
}

const norm = s => String(s || '').trim().toUpperCase();

/** getQuotes(symbols, {workerUrl, fetch, now}) -> {ok, quotes:{SYM:{price, open, high, low, changePct, asOf, badge}}, unresolved:[{symbol,error}], asOf, badge, requests, error} */
export async function getQuotes(symbols, o = {}) {
  const base = String(o.workerUrl || '').trim().replace(/\/+$/, ''), doFetch = o.fetch || globalThis.fetch, now = o.now ?? Date.now();
  const want = [...new Set((symbols || []).map(norm).filter(Boolean))];
  const out = { ok: false, quotes: {}, unresolved: [], asOf: null, badge: 'untimed', requests: 0, error: '' };
  if (!base) { out.error = 'Market Bridge address is not set'; out.unresolved = want.map(s => ({ symbol: s, error: 'NO_WORKER' })); return out; }
  if (!want.length) { out.ok = true; return out; }
  const errors = [];
  for (let i = 0; i < want.length; i += BATCH) {
    const part = want.slice(i, i + BATCH), asked = new Set(part);
    out.requests++;
    let j;
    try {
      const r = await doFetch(`${base}/quotes?symbols=${encodeURIComponent(part.join(','))}`);
      j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || 'HTTP ' + r.status);
    } catch (e) {
      errors.push(String((e && e.message) || e));
      for (const s of part) out.unresolved.push({ symbol: s, error: 'REQUEST_FAILED' });
      continue;
    }
    for (const q of (Array.isArray(j.quotes) ? j.quotes : [])) {
      const s = norm(q && q.symbol);
      if (!asked.has(s) || !(+q.price > 0)) continue;                             // never accept a symbol that was not asked for
      const t = q.asOf ? Date.parse(q.asOf) : NaN;
      out.quotes[s] = { price: +q.price, open: +q.open || null, high: +q.high || null, low: +q.low || null, changePct: Number.isFinite(+q.changePct) ? +q.changePct : null,
        asOf: Number.isFinite(t) ? t : null, badge: quoteBadge(t, now, o.staleMin), source: q.source || 'market-bridge' };
      asked.delete(s);
    }
    const why = new Map((Array.isArray(j.unresolved) ? j.unresolved : []).map(u => [norm(u.symbol), u.error || 'UNRESOLVED']));
    for (const s of asked) out.unresolved.push({ symbol: s, error: why.get(s) || 'NOT_RETURNED' });
  }
  const times = Object.values(out.quotes).map(q => q.asOf).filter(Number.isFinite);
  out.asOf = times.length ? Math.max(...times) : null;
  const badges = new Set(Object.values(out.quotes).map(q => q.badge));
  out.badge = badges.has('stale') ? 'stale' : badges.has('untimed') ? 'untimed' : badges.has('provisional') ? 'provisional' : badges.size ? 'final' : 'untimed';
  out.ok = Object.keys(out.quotes).length > 0;
  out.error = errors.join('; ');
  return out;
}
