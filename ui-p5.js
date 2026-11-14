/* ============================================================
   BACKTEST LAB — ui-p5.js
   AlphaDesk hand-off: the notice shown when the page is opened from
   AlphaDesk, the Market Bridge address taken from AlphaDesk's settings,
   and the "Actual vs backtest" section of the Report.
   Wiring only: the logic lives in alphadesk-bridge.js (read-only).
   ============================================================ */
import * as AB from './alphadesk-bridge.js';
import * as AD from './presets-alphadesk.js';
import * as SRC from './source.js';

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
    + (hand.preset === 'lifo' || hand.preset === 'dm' ? 'These settings are filled into "AlphaDesk strategies" on the Portfolio tab; press Run there. '
      : hand.preset === 'tenet' ? 'Tenet is not in Backtest Lab: ' + esc(AD.TENET_NOT_PORTED) + ' ' : '')
    + (hand.sym ? `The symbol is set to ${esc(hand.sym)}.` : 'You can also compare any run with your AlphaDesk trades on the Report tab.');
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

/* ---------------- AlphaDesk strategies (presets-alphadesk.js) ---------------- */
const LINK_KEYS = { start: 'startDate', end: 'endDate', slots: 'slots', capital: 'capital', avgFall: 'avgFall', minProfit: 'minProfit', maxLots: 'maxLots', scanTopN: 'maxScan', compound: 'btCompound', liquidRate: 'btLiquidRate' };
const fromLink = {};
if (hand.ok && (hand.preset === 'lifo' || hand.preset === 'dm')) {
  for (const [k, v] of Object.entries(hand.params)) if (LINK_KEYS[k] && v !== '' && v != null) fromLink[LINK_KEYS[k]] = (v === 'ON' ? true : v === 'OFF' ? false : (typeof v === 'string' && v !== '' && !isNaN(+v) && k !== 'start' && k !== 'end') ? +v : v);
  $('ad-preset').value = hand.preset;
}
{ const to = new Date(), f = new Date(); f.setUTCFullYear(f.getUTCFullYear() - 3);
  $('ad-from').value = fromLink.startDate || f.toISOString().slice(0, 10); $('ad-to').value = fromLink.endDate || to.toISOString().slice(0, 10); }
const adNote = () => { const p = AD.ALPHADESK_PRESETS.find(x => x.id === $('ad-preset').value); $('ad-note').textContent = p.note + (Object.keys(fromLink).length && $('ad-preset').value === hand.preset ? ' Settings from the AlphaDesk link are used.' : ' AlphaDesk\'s default settings are used.'); };
$('ad-preset').addEventListener('change', adNote); adNote();
$('ad-run').addEventListener('click', async () => {
  const id = $('ad-preset').value, mode = $('ad-mode').value, from = $('ad-from').value, to = $('ad-to').value, out = $('ad-out');
  if (!from || !to || from >= to) { out.innerHTML = kv([['dates', 'pick a start before the end', 'warn']]); return; }
  if (!SRC.datasetInfo().ok) { out.innerHTML = kv([['official dataset', 'not loaded — open the Data tab', 'bad']]); return; }
  const syms = id === 'lifo' ? AD.LIFO_UNIVERSE.map(e => e.sym) : [...new Set([...AD.DM_UNIVERSE, 'LIQUIDBEES'])];
  out.innerHTML = kv([['status', 'loading ' + syms.length + ' ETFs…']]);
  const warm = new Date(from + 'T00:00:00Z'); warm.setUTCDate(warm.getUTCDate() - (id === 'lifo' ? 366 : 182 + 221));
  const got = await SRC.loadMany(syms, { onProgress: (d, n) => { out.innerHTML = kv([['status', `loading ${d} of ${n}`]]); } });
  const hm = AD.histMapFromRecords(got.records, { from: warm.toISOString().slice(0, 10), to });
  const linked = id === hand.preset ? fromLink : {};
  const uni = AD.LIFO_UNIVERSE.filter(e => hm[e.sym]);
  const r = id === 'lifo' ? AD.runAlphadeskLifo(hm, { ...AD.ALPHADESK_DEFAULTS.lifo, ...linked, startDate: from, endDate: to, executionMode: mode }, { universe: uni })
    : AD.runAlphadeskDM(hm, { ...AD.ALPHADESK_DEFAULTS.dm, ...linked, fromDate: from, toDate: to, executionMode: mode, etfs: AD.DM_UNIVERSE.filter(s => hm[s]) });
  window.__lastAlphadesk = r;
  const miss = got.missing.length ? [['not in the dataset', esc(got.missing.map(m => m.symbol).join(', ')), 'warn']] : [];
  if (!r.ok) { out.innerHTML = kv([...miss, ['result', esc(r.reason), 'bad']]); return; }
  if (id === 'lifo') {
    const won = r.trades.filter(t => t.netPnl > 0).length, net = r.trades.reduce((a, t) => a + t.netPnl, 0);
    out.innerHTML = kv([...miss, ['completed trades', r.trades.length], ['winning', r.trades.length ? Math.round(won / r.trades.length * 100) + '%' : '—'], ['closed profit after charges', inr(net)],
      ['still open', r.open.length + ' lots'], ['capital → end value', inr(r.capital) + ' → ' + inr(r.endEq), r.endEq >= r.capital ? 'ok' : 'bad'], ['fills', mode === 'sheet-close' ? 'same close (sheet)' : 'next session open']])
      + `<div style="overflow-x:auto"><table class="mono" style="font-size:11px;width:100%"><tr><th>ETF</th><th>bought</th><th>sold</th><th>net</th></tr>${r.trades.slice(-200).reverse().map(t => `<tr><td>${esc(t.sym)}</td><td>${t.buyDate} ₹${t.buyPrice.toFixed(2)}×${t.qty}</td><td>${t.sellDate} ₹${t.sellPrice.toFixed(2)}</td><td>${inr(t.netPnl)}</td></tr>`).join('')}</table></div>`;
  } else {
    const c = r.momCapital, yrs = Math.max(0.1, (Date.parse(r.equity.at(-1).date) - Date.parse(from)) / (365.25 * 86400000)), cagr = (Math.pow(r.endNav / 100, 1 / yrs) - 1) * 100;
    out.innerHTML = kv([...miss, ['rebalances', r.equity.length], ['buys and sells', r.tradeLog.length], ['capital → end value', inr(c) + ' → ' + inr(c * r.endNav / 100), r.endNav >= 100 ? 'ok' : 'bad'],
      ['growth per year', cagr.toFixed(1) + '%'], ['held now', esc(Object.keys(r.positions).join(', ') || 'LIQUIDBEES / cash')]])
      + `<div style="overflow-x:auto"><table class="mono" style="font-size:11px;width:100%"><tr><th>date</th><th>ETF</th><th>action</th><th>price</th></tr>${r.tradeLog.slice(-200).reverse().map(t => `<tr><td>${t.date}</td><td>${esc(t.sym)}</td><td>${t.action}</td><td>${t.exitPrice != null ? t.exitPrice.toFixed(2) : t.entryPrice != null ? t.entryPrice.toFixed(2) : ''}</td></tr>`).join('')}</table></div>`;
  }
});

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
