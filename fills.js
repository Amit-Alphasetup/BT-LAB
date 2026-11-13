// Order model for Backtest Lab v2 (PLAN.md section 7). Pure functions, no state. bar = {o,h,l,c} on ONE adjusted price scale.
// An order is created on bar t and filled on bar t+1, except 'at_close' which fills on bar t itself.
export const ORDER_TYPES = ['market_open', 'at_close', 'stop_buy', 'limit_buy', 'limit_sell', 'stop_sell'];

/** Fill price on `bar`, or null if the order does not fill. Gap-aware: a gap through the level fills at the open. */
export function fillPrice(order, bar) {
  const L = order.level;
  switch (order.type) {
    case 'market_open': return bar.o;
    case 'at_close':    return bar.c;
    case 'stop_buy':    return bar.h >= L ? Math.max(L, bar.o) : null;
    case 'limit_buy':   return bar.l <= L ? Math.min(L, bar.o) : null;
    case 'limit_sell':  return bar.h >= L ? Math.max(L, bar.o) : null;
    case 'stop_sell':   return bar.l <= L ? Math.min(L, bar.o) : null;
    default: throw new Error('unknown order type: ' + order.type);
  }
}

/** May a lot that was filled on this bar also exit on it? Default: never. Opt-in only when the entry filled at the open. */
export function canExitOnFillBar(entryFill, bar, policy) {
  return policy === 'open_fill_only' && entryFill === bar.o;
}

/** Target and stop both reachable on one bar: assume the stop filled first (conservative). Returns 'stop' | 'target' | null. */
export function resolveExit(targetLevel, stopLevel, bar) {
  const stop = stopLevel != null && bar.l <= stopLevel, tgt = targetLevel != null && bar.h >= targetLevel;
  return stop ? 'stop' : tgt ? 'target' : null;
}

/** Is `price` a possible trade price on `bar`? (invariant: every fill lies inside its bar's low-high range) */
export function insideBar(price, bar, eps = 1e-9) {
  return price >= bar.l - eps * Math.max(1, bar.l) && price <= bar.h + eps * Math.max(1, bar.h);
}
