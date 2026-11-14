/* ============================================================
   BACKTEST LAB — ui-p5.js
   AlphaDesk hand-off: the notice shown when the page is opened from
   AlphaDesk, the Market Bridge address taken from AlphaDesk's settings,
   and the "Actual vs backtest" section of the Report.
   Wiring only: the logic lives in alphadesk-bridge.js (read-only).
   ============================================================ */
import * as AB from './alphadesk-bridge.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kv = pairs => pairs.map(([k, v, c]) => `<div class="kv"><span>${k}</span><span class="${c || ''}">${v}</span></div>`).join('');
const inr = x => (x < 0 ? '−₹' : '₹') + Math.abs(Math.round(x)).toLocaleString('en-IN');
const storage = () => { try { return window.localStorage; } catch (e) { return null; } };

/* ---------------- opened from AlphaDesk ---------------- */
const NAMES = { lifo: 'LIFO', dm: 'Dual Momentum', tenet: 'Tenet' };
const LABELS = { start: 'from', end: 'to', slots: 'slots', avgFall: 'average after a fall of %', minProfit: 'minimum profit ₹', maxLots: 'most lots', scanTopN: 'scan top', compound: 'compounding', liquidRate: 'idle cash rate %' };
const hand = AB.parseLink(location.search);
window.__handoff = hand;
if (hand.ok) {
  const shown = Object.entries(hand.params).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').slice(0, 20)
    .map(([k, v]) => `${esc(LABELS[k] || k)} ${esc(v === true ? 'on' : v === false ? 'off' : String(v).slice(0, 40))}`);
  $('handoff').innerHTML = `<b>Opened from AlphaDesk${hand.preset ? ' — ' + esc(NAMES[hand.preset] || hand.preset) : ''}.</b> `
    + (shown.length ? 'Settings received: ' + shown.join(' · ') + '. ' : '')
    + (hand.error ? `<span class="warn">${esc(hand.error)}.</span> ` : '')
    + 'AlphaDesk\'s own strategies are not in Backtest Lab yet, so nothing has been run with these settings. '
    + (hand.sym ? `The symbol is set to ${esc(hand.sym)}.` : 'You can run any strategy here and compare it with your AlphaDesk trades on the Report tab.');
  $('handoff').classList.remove('hidden');
  if (hand.sym && $('f-symbol')) { $('f-symbol').value = hand.sym; $('f-symbol').dispatchEvent(new Event('change', { bubbles: true })); }
}

/* ---------------- Market Bridge address from AlphaDesk (only when none is set here) ---------------- */
{
  const st = storage(), own = st ? (() => { try { return st.getItem('btlab_worker_url') || ''; } catch (e) { return ''; } })() : '';
  const fromAd = AB.marketBridgeUrl(st);
  window.__bridgeFromAlphaDesk = '';
  if (fromAd && !own && $('f-worker') && !$('f-worker').value.trim()) { $('f-worker').value = fromAd; window.__bridgeFromAlphaDesk = fromAd; }
}

/* ---------------- actual vs backtest ---------------- */
let last = null, fileLedger = null;
window.addEventListener('btlab:run', e => { last = e.detail; $('av-out').innerHTML = ''; });
const cell = (d, p, q) => (d ? `${d}<br>₹${Number(p).toFixed(2)}${q != null ? ' × ' + q : ''}` : '—');
function paint(ledger) {
  if (!last) { $('av-out').innerHTML = kv([['status', 'run a backtest first', 'warn']]); return; }
  if (!ledger.ok) { $('av-out').innerHTML = kv([['AlphaDesk ledger', esc(ledger.reason), 'warn'], ['what to do', 'export a full backup or the LIFO ledger CSV from AlphaDesk, then load that file here', 'muted']]); return; }
  const sym = String(last.bars.symbol || '').toUpperCase(), rt = AB.roundTrips(ledger.fills, sym);
  const v = AB.actualVsBacktest(rt.trades, last.trades, { windowDays: Math.max(0, Number($('av-window').value) || 0) });
  window.__lastActualVs = { symbol: sym, source: ledger.source, fills: ledger.fills.length, ...v };
  const head = kv([['ledger', esc(ledger.source) + ` · ${ledger.fills.length} buys and sells in ${ledger.symbols.length} symbols`], ['symbol', esc(sym)],
    ...(ledger.dropped ? [['rows that could not be read', ledger.dropped, 'warn']] : []), ...(rt.unmatchedSells ? [['sold with no matching buy in the ledger', rt.unmatchedSells + ' units', 'warn']] : [])]);
  if (!rt.trades.length) { $('av-out').innerHTML = head + kv([['result', `no AlphaDesk trades in ${esc(sym)}` + (ledger.symbols.length ? ' — the ledger has: ' + esc(ledger.symbols.slice(0, 20).join(', ')) : ''), 'warn']]); return; }
  const s = v.summary;
  const rows = v.rows.slice(0, 300).map(r => {
    const a = r.actual, b = r.backtest;
    return `<tr><td>${a ? cell(a.entryDate, a.entryPrice, a.qty) : '—'}</td><td>${a ? (a.open ? 'open' : cell(a.exitDate, a.exitPrice)) : '—'}</td><td>${a && !a.open ? inr(a.pnl) : '—'}</td>`
      + `<td>${b ? cell(b.entryDate, b.entryPrice, b.qty) : '—'}</td><td>${b ? (b.open ? 'open' : cell(b.exitDate, b.exitPrice)) : '—'}</td><td>${b && !b.open ? inr(b.net) : '—'}</td>`
      + `<td>${r.gapDays == null ? '—' : (r.gapDays > 0 ? '+' : '') + r.gapDays + ' d<br>' + (r.entryPriceDiffPct >= 0 ? '+' : '') + r.entryPriceDiffPct.toFixed(1) + '%'}</td></tr>`;
  }).join('');
  $('av-out').innerHTML = head + kv([['in both', s.both, s.both ? 'ok' : 'warn'], ['only in AlphaDesk', s.onlyActual, s.onlyActual ? 'warn' : ''], ['only in the backtest', s.onlyBacktest, s.onlyBacktest ? 'warn' : ''],
    ['AlphaDesk closed trades, profit before charges', inr(s.actualClosedPnl) + (s.actualOpen ? ` · ${s.actualOpen} still open` : '')], ['backtest closed trades, profit after charges', inr(s.backtestClosedNet) + (s.backtestOpen ? ` · ${s.backtestOpen} still open` : '')],
    ['how to read this', 'the two sides differ in money per trade and in strategy; compare the dates and prices, not the rupee totals', 'muted']])
    + `<div style="overflow-x:auto"><table class="mono av-table" style="font-size:11px;border-collapse:collapse;width:100%"><tr>${['AlphaDesk bought', 'sold', 'P&L', 'Backtest bought', 'sold', 'net', 'entry gap'].map(h => `<th style="text-align:left;padding:4px 6px">${h}</th>`).join('')}</tr>${rows}</table></div>`;
  $('av-out').querySelectorAll('td').forEach(td => { td.style.padding = '4px 6px'; td.style.verticalAlign = 'top'; });
}
$('av-run').addEventListener('click', () => paint(fileLedger || AB.readLedger(storage())));
$('av-pick').addEventListener('click', () => $('av-file').click());
$('av-file').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const r = await AB.importLedgerFile(f); e.target.value = '';
  if (r.ok) fileLedger = r;
  paint(r);
});
