/* ============================================================
   BACKTEST LAB — alphadesk-bridge.js
   Read-only bridge to AlphaDesk (plan r2 section 9, levels L2/L3):
   - the ledger AlphaDesk saved in this browser (same origin only),
     or an AlphaDesk export file (full backup JSON, LIFO ledger CSV)
   - the Market Bridge address from AlphaDesk's settings
   - the hand-off link AlphaDesk opens
   - "actual vs backtest": ledger round trips beside backtest trades
   Nothing here writes to AlphaDesk's storage. Pure functions, no DOM.
   ============================================================ */
export const STATE_KEY = 'alphadesk_v1';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const dayMs = d => Date.parse(d + 'T00:00:00Z');
const isoOf = x => (typeof x === 'number' ? new Date(x).toISOString().slice(0, 10) : String(x || '').slice(0, 10));

/* ---------------- hand-off link ---------------- */
const b64uEncode = s => { let bin = ''; for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64uDecode = s => { const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

/** {preset, sym, params} -> "<base>?from=alphadesk&preset=..&sym=..&p=<base64url JSON>" */
export function encodeLink({ preset = '', sym = '', params = {} } = {}, base = '') {
  return `${base}?from=alphadesk&preset=${encodeURIComponent(preset)}&sym=${encodeURIComponent(sym)}&p=${b64uEncode(JSON.stringify(params || {}))}`;
}
/** location.search -> {ok:true, from, preset, sym, params[, error]} | {ok:false}. Never throws. */
export function parseLink(search) {
  let q; try { q = new URLSearchParams(String(search || '').replace(/^[^?]*\?/, '')); } catch (e) { return { ok: false }; }
  if (q.get('from') !== 'alphadesk') return { ok: false };
  const preset = /^[a-z0-9_-]{1,40}$/.test(q.get('preset') || '') ? q.get('preset') : '';
  const out = { ok: true, from: 'alphadesk', preset, sym: String(q.get('sym') || '').trim().toUpperCase().slice(0, 40), params: {} };
  const p = q.get('p');
  if (p) {
    try { const v = JSON.parse(b64uDecode(p)); if (v && typeof v === 'object' && !Array.isArray(v)) out.params = v; else out.error = 'the settings in the link are not a list of values'; }
    catch (e) { out.error = 'the settings in the link could not be read'; }
  }
  return out;
}

/* ---------------- ledger ---------------- */
function toFill(t, book) {
  if (!t || typeof t !== 'object') return null;
  const f = { book, date: String(t.date || '').slice(0, 10), symbol: String(t.sym || t.etf || t.symbol || '').trim().toUpperCase(), type: String(t.type || '').trim().toUpperCase(),
    qty: Number(t.qty ?? t.units), price: Number(t.price), id: String(t.id ?? ''), linkedBuyId: String(t.linkedBuyId ?? '') };
  if (!ISO.test(f.date) || isNaN(dayMs(f.date)) || !f.symbol || (f.type !== 'BUY' && f.type !== 'SELL') || !(f.qty > 0) || !(f.price > 0)) return null;
  return f;
}
function pack(lifo, dm, source, extra = {}) {
  const fills = []; let dropped = 0;
  for (const [rows, book] of [[lifo, 'LIFO'], [dm, 'DM']]) for (const t of rows || []) { const f = toFill(t, book); if (f) fills.push(f); else dropped++; }
  fills.forEach((f, i) => { f._i = i; });
  fills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i));
  fills.forEach(f => { delete f._i; });
  return { ok: true, source, fills, dropped, symbols: [...new Set(fills.map(f => f.symbol))].sort(), ...extra };
}
function fromState(st, source) {
  if (!st || typeof st !== 'object' || Array.isArray(st)) return { ok: false, reason: 'not an AlphaDesk save' };
  if (!Array.isArray(st.lifoLedger) && !Array.isArray(st.momTrades)) return { ok: false, reason: 'no AlphaDesk ledger in it' };
  return pack(Array.isArray(st.lifoLedger) ? st.lifoLedger : [], Array.isArray(st.momTrades) ? st.momTrades : [], source);
}
function rawState(storage) {
  let txt;
  try { txt = storage.getItem(STATE_KEY); } catch (e) { return { err: 'this browser does not let Backtest Lab read saved data' }; }
  if (txt == null || txt === '') return { err: 'AlphaDesk has not saved anything in this browser (open both apps from the same web address, or load an AlphaDesk export file)' };
  try { return { st: JSON.parse(txt) }; } catch (e) { return { err: 'the AlphaDesk save in this browser could not be read' }; }
}
/** AlphaDesk's ledger from this browser's storage. Read-only. {ok:true, source, fills, dropped, symbols} | {ok:false, reason} */
export function readLedger(storage = globalThis.localStorage) {
  if (!storage) return { ok: false, reason: 'no browser storage here' };
  const r = rawState(storage);
  return r.err ? { ok: false, reason: r.err } : fromState(r.st, 'AlphaDesk in this browser');
}
/** The Market Bridge address saved in AlphaDesk's settings ('' when absent or not https). */
export function marketBridgeUrl(storage = globalThis.localStorage) {
  if (!storage) return '';
  const r = rawState(storage), u = r.st && r.st.config && typeof r.st.config.marketBridgeUrl === 'string' ? r.st.config.marketBridgeUrl.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u.replace(/\/+$/, '') : '';
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** Text of an AlphaDesk export: the full backup (JSON) or the LIFO ledger CSV. Same result shape as readLedger. */
export function importLedgerText(text, name = '') {
  const t = String(text || '').replace(/^﻿/, '');
  if (!t.trim()) return { ok: false, reason: 'the file is empty' };
  if (t.trimStart()[0] === '{') {
    let j; try { j = JSON.parse(t); } catch (e) { return { ok: false, reason: 'the file is not readable JSON' }; }
    const isBackup = j && j._meta && j.state && typeof j.state === 'object';
    return fromState(isBackup ? j.state : j, isBackup ? `AlphaDesk backup file${j._meta.exportedAt ? ' of ' + String(j._meta.exportedAt).slice(0, 10) : ''}` : 'AlphaDesk save file');
  }
  const rows = csvRows(t), h = rows.findIndex(r => r[0] === 'Date' && r[1] === 'Symbol' && r[2] === 'Type' && r[3] === 'Qty' && r[4] === 'Price');
  if (!/AlphaDesk/.test((rows[0] || [])[0] || '') || h < 0) return { ok: false, reason: 'not an AlphaDesk ledger export' + (name ? ' (' + name + ')' : '') };
  const body = rows.slice(h + 1).filter(r => r.length >= 5 && !String(r[0]).startsWith('#') && r.some(c => c !== ''));
  return pack(body.map((r, k) => ({ id: 'csv' + k, date: r[0], sym: r[1], type: r[2], qty: r[3], price: r[4] })), [], 'AlphaDesk LIFO ledger CSV');
}
/** A File (or anything with .text()) chosen by the user. Never throws. */
export async function importLedgerFile(file) {
  try { return importLedgerText(await file.text(), file.name || ''); } catch (e) { return { ok: false, reason: 'the file could not be read' }; }
}

/* ---------------- round trips ---------------- */
/** Fills of one symbol -> buy/sell round trips. A sell closes the lot it names (linkedBuyId), otherwise the latest open lot first.
 *  P&L is before charges: qty x (sell - buy). Sells with nothing to close are counted in unmatchedSells, never invented. */
export function roundTrips(fills, symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  const mine = (fills || []).filter(f => f.symbol === sym).map((f, i) => ({ ...f, _i: i })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a._i - b._i));
  const lots = [], trades = []; let unmatchedSells = 0;
  const sell = (f, qty, final) => {
    let left = qty;
    const take = L => { const n = Math.min(L.left, left); if (n > 0) { trades.push({ symbol: sym, book: L.book, entryDate: L.date, entryPrice: L.price, qty: n, exitDate: f.date, exitPrice: f.price, pnl: n * (f.price - L.price), open: false }); L.left -= n; left -= n; } };
    if (f.linkedBuyId) { const L = lots.find(x => x.id === f.linkedBuyId && x.book === f.book); if (L) take(L); }
    for (let k = lots.length - 1; k >= 0 && left > 0; k--) if (lots[k].book === f.book) take(lots[k]);
    if (left > 0 && final) unmatchedSells += left;
    return left;
  };
  for (let a = 0; a < mine.length;) {
    let b = a; while (b < mine.length && mine[b].date === mine[a].date) b++;
    const later = [];
    for (const f of mine.slice(a, b)) {
      if (f.type === 'BUY') lots.push({ id: f.id, book: f.book, date: f.date, price: f.price, left: f.qty });
      else { const left = sell(f, f.qty, false); if (left > 0) later.push([f, left]); }   // a sell entered before its same-day buy
    }
    for (const [f, left] of later) sell(f, left, true);
    a = b;
  }
  for (const L of lots) if (L.left > 0) trades.push({ symbol: sym, book: L.book, entryDate: L.date, entryPrice: L.price, qty: L.left, exitDate: '', exitPrice: null, pnl: null, open: true });
  trades.sort((x, y) => (x.entryDate < y.entryDate ? -1 : x.entryDate > y.entryDate ? 1 : (x.open - y.open) || (x.exitDate < y.exitDate ? -1 : x.exitDate > y.exitDate ? 1 : 0)));
  return { symbol: sym, trades, closedPnl: trades.reduce((s, t) => s + (t.open ? 0 : t.pnl), 0), openQty: trades.reduce((s, t) => s + (t.open ? t.qty : 0), 0), unmatchedSells };
}

/* ---------------- actual vs backtest ---------------- */
/** Ledger round trips beside backtest trades. Each actual trade is paired with the nearest not-yet-paired backtest entry within
 *  `windowDays` calendar days. Backtest trades closed by 'end_of_data' count as open. Actual P&L is before charges, backtest net is after. */
export function actualVsBacktest(actual, backtest, { windowDays = 5 } = {}) {
  const bt = (backtest || []).map(t => ({ entryDate: isoOf(t.entryDate), entryPrice: +t.entryPrice, qty: +t.qty, exitDate: t.reason === 'end_of_data' ? '' : isoOf(t.exitDate), exitPrice: t.reason === 'end_of_data' ? null : +t.exitPrice,
    net: t.reason === 'end_of_data' ? null : +t.net, open: t.reason === 'end_of_data' })).sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0));
  const used = new Array(bt.length).fill(false), rows = [];
  for (const a of actual || []) {
    let best = -1, bestGap = Infinity;
    bt.forEach((t, k) => { if (used[k]) return; const g = Math.abs(dayMs(t.entryDate) - dayMs(a.entryDate)) / DAY; if (g <= windowDays && g < bestGap) { best = k; bestGap = g; } });
    if (best >= 0) { used[best] = true; const t = bt[best]; rows.push({ actual: a, backtest: t, gapDays: Math.round((dayMs(t.entryDate) - dayMs(a.entryDate)) / DAY), entryPriceDiffPct: (a.entryPrice / t.entryPrice - 1) * 100 }); }
    else rows.push({ actual: a, backtest: null, gapDays: null, entryPriceDiffPct: null });
  }
  bt.forEach((t, k) => { if (!used[k]) rows.push({ actual: null, backtest: t, gapDays: null, entryPriceDiffPct: null }); });
  const key = r => (r.actual || r.backtest).entryDate;
  rows.forEach((r, i) => { r._i = i; }); rows.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : x._i - y._i)); rows.forEach(r => { delete r._i; });
  const A = actual || [];
  return { rows, summary: { both: rows.filter(r => r.actual && r.backtest).length, onlyActual: rows.filter(r => r.actual && !r.backtest).length, onlyBacktest: rows.filter(r => !r.actual && r.backtest).length,
    actualClosedPnl: A.reduce((s, t) => s + (t.open ? 0 : t.pnl), 0), actualOpen: A.filter(t => t.open).length, backtestClosedNet: bt.reduce((s, t) => s + (t.open ? 0 : t.net), 0), backtestOpen: bt.filter(t => t.open).length } };
}
