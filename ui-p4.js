/* ============================================================
   BACKTEST LAB — ui-p4.js
   Signals tab, Compare tab, Report extras (benchmarks, shuffle test,
   sheet check) and the Studio run id. Wiring only: the maths lives in
   signals.js, quotes.js, compare.js and extras.js.
   ============================================================ */
import * as SRC from './source.js';
import * as BD from './presets-btdesk.js';
import * as SG from './signals.js';
import * as QT from './quotes.js';
import * as CP from './compare.js';
import * as X from './extras.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kv = pairs => pairs.map(([k, v, c]) => `<div class="kv"><span>${k}</span><span class="${c || ''}">${v}</span></div>`).join('');
const inr = x => '₹' + Math.round(x).toLocaleString('en-IN'), pc = x => Number.isFinite(x) ? x.toFixed(1) + '%' : '—';
const ready = () => (window.__btlab ? window.__btlab.datasetReady : null);

function presetBoxes(host, prefix, extra = '') {
  host.innerHTML = BD.BTDESK_PRESETS.map(p => `<label class="mono" style="font-size:12px;margin-right:12px"><input type="checkbox" id="${prefix}-${p.id}" checked> ${esc(p.label)}</label>`).join('') + extra;
}
const chosen = prefix => BD.BTDESK_PRESETS.filter(p => $(prefix + '-' + p.id).checked).map(p => p.id);
function symbolsOf(universeId, textId) {
  const u = SRC.UNIVERSES[$(universeId).value];
  return { uni: u || null, syms: u ? SRC.universeSymbols($(universeId).value) : $(textId).value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) };
}
for (const [u, t] of [['sg-universe', 'sg-symbols'], ['cp-universe', 'cp-symbols']]) $(u).addEventListener('change', e => { $(t).disabled = !!SRC.UNIVERSES[e.target.value]; });
async function load(syms, statusEl) {
  await ready();
  return SRC.loadMany(syms, { loadRecord: async () => null, onProgress: (d, t) => { statusEl.innerHTML = kv([['status', `loading prices ${d} / ${t}`]]); } });
}

/* ---------------- signals ---------------- */
presetBoxes($('sg-presets'), 'sg');
let sgCards = [], sgQuotes = null;
const KIND = { gtt_buy: 'BUY — GTT', at_close_buy: 'BUY — at the close', exit: 'SELL — target', ladder: 'SELL — per lot', near: 'Nothing to place' };
function paintSignals() {
  const all = $('sg-all').checked, list = sgCards.filter(c => all || c.kind !== 'near' || c.isNear);
  $('sg-cards').innerHTML = list.length ? list.map((c, k) => {
    const q = sgQuotes && sgQuotes.quotes[c.symbol];
    const live = q ? `<div class="kv"><span>last traded</span><span class="${q.badge === 'stale' || q.badge === 'untimed' ? 'warn' : ''}">₹${q.price.toFixed(2)} · ${q.badge}${c.level ? ' · ' + ((c.level / q.price - 1) * 100).toFixed(1) + '% to the level' : ''}</span></div>` : '';
    const lines = c.kind === 'ladder' ? c.lots.map(L => `<div class="kv"><span>lot of ${L.qty} bought ₹${L.bought.toFixed(2)} on ${L.since}</span><span>sell ₹${L.target.toFixed(2)} (${L.toGoPct.toFixed(1)}% away)</span></div>`).join('')
      : kv([[c.kind === 'near' ? 'level' : 'price level', c.level != null ? '₹' + c.level.toFixed(2) : '—'], ...(c.qty ? [['quantity', c.qty]] : []),
        ...(c.distancePct != null ? [['distance from the last close', c.distancePct.toFixed(1) + '%', c.isNear ? 'warn' : '']] : []), ...(c.toGoPct != null ? [['to the target', c.toGoPct.toFixed(1) + '%']] : []),
        ...(c.note ? [['note', esc(c.note)]] : []), ...(c.condition ? [['only if', esc(c.condition)]] : [])]);
    return `<section class="section sg-card" data-kind="${c.kind}"><h2>${esc(c.symbol)} <span class="hint">${esc(c.strategy)} · ${KIND[c.kind]} · prices to ${c.asOf}</span></h2>
      <div class="section-body">${lines}${live}${c.kind === 'near' ? '' : `<div class="btn-row"><button class="btn sg-copy" data-k="${k}">Copy order text</button></div><pre class="mono sg-text" style="white-space:pre-wrap;font-size:12px">${esc(c.text)}</pre>`}</div></section>`;
  }).join('') : '<div class="notice">No orders to place for this selection. Tick the box to see how far each trigger is.</div>';
  document.querySelectorAll('.sg-copy').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(list[+b.dataset.k].text); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Select the text below'; } }));
}
$('sg-all').addEventListener('change', paintSignals);
$('sg-run').addEventListener('click', async () => {
  const { uni, syms } = symbolsOf('sg-universe', 'sg-symbols'), ids = chosen('sg');
  if (!syms.length || !ids.length) { $('sg-status').innerHTML = kv([['status', 'choose at least one symbol and one strategy', 'bad']]); return; }
  const many = await load(syms, $('sg-status'));
  const params = { perTxAmount: Number($('sg-pertx').value) || 5000, maxBuys: Number($('sg-maxbuys').value) || 5 };
  const r = SG.scanSignals(many.records, ids, params, { nearPct: Number($('sg-near').value) || 0 });
  sgCards = r.cards; sgQuotes = null;
  const n = k => r.cards.filter(c => c.kind === k).length, info = SRC.datasetInfo();
  $('sg-status').innerHTML = kv([...(uni ? [['universe', esc(uni.label), uni.biased ? 'warn' : '']] : []), ['prices to', info.ok ? esc(info.latestSession + ' · dataset ' + info.datasetId) : '—'],
    ['buy orders', n('gtt_buy') + n('at_close_buy'), 'ok'], ['sell orders', n('exit') + n('ladder')], ['near a trigger', r.cards.filter(c => c.kind === 'near' && c.isNear).length],
    ...(many.missing.length ? [['no data', esc(many.missing.map(m => m.symbol).slice(0, 15).join(', ')), 'warn']] : []),
    ...(r.skipped.length ? [['too little history', esc([...new Set(r.skipped.map(s => s.symbol))].slice(0, 15).join(', ')), 'warn']] : [])]);
  window.__lastSignals = r;
  paintSignals();
});
$('sg-quotes').addEventListener('click', async () => {
  if (!sgCards.length) { $('sg-status').innerHTML = kv([['status', 'scan first', 'warn']]); return; }
  const url = ($('f-worker') && $('f-worker').value.trim()) || localStorage.getItem('btlab_worker_url') || '';
  const q = await QT.getQuotes([...new Set(sgCards.map(c => c.symbol))], { workerUrl: url });
  sgQuotes = q; window.__lastQuotes = q;
  $('sg-status').innerHTML += kv([['live prices', q.ok ? `${Object.keys(q.quotes).length} symbols · ${q.badge} · as of ${q.asOf ? new Date(q.asOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'unknown'}` : 'not available', q.ok && q.badge !== 'stale' && q.badge !== 'untimed' ? 'ok' : 'warn'],
    ...(q.error ? [['reason', esc(q.error) + (url ? '' : ' — set the Market Bridge address on the Data tab'), 'warn']] : []), ...(q.unresolved.length ? [['no quote for', esc(q.unresolved.map(u => u.symbol).slice(0, 15).join(', ')), 'warn']] : [])]);
  if (url) localStorage.setItem('btlab_worker_url', url);
  paintSignals();
});

/* ---------------- compare ---------------- */
presetBoxes($('cp-presets'), 'cp', `<label class="mono" style="font-size:12px"><input type="checkbox" id="cp-built"> the strategy on the Strategy tab</label>`);
let cpResult = null, cpMeta = {};
const table = (cols, rows) => `<table class="mono" style="font-size:12px;border-collapse:collapse;width:100%"><tr>${cols.map(c => `<th style="text-align:${c[2] || 'right'};padding:4px 8px">${c[1]}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => `<td style="text-align:${c[2] || 'right'};padding:4px 8px">${c[3] ? c[3](r[c[0]], r) : esc(r[c[0]])}</td>`).join('')}</tr>`).join('')}</table>`;
$('cp-run').addEventListener('click', async () => {
  const { uni, syms } = symbolsOf('cp-universe', 'cp-symbols');
  const params = { perTxAmount: Number($('cp-pertx').value) || 5000, maxBuys: Number($('cp-maxbuys').value) || 5 };
  const strategies = chosen('cp').map(id => ({ kind: 'btdesk', id, params }));
  if ($('cp-built').checked && window.__btlab) { const B = window.__btlab.B; strategies.push({ kind: 'schema', schema: B.formToSchema(window.__btlab.form) }); }
  if (!syms.length || !strategies.length) { $('cp-status').innerHTML = kv([['status', 'choose at least one symbol and one strategy', 'bad']]); return; }
  const many = await load(syms, $('cp-status'));
  const t0 = performance.now(), res = CP.compare(strategies, many.records, { start: $('cp-start').value || undefined });
  const info = SRC.datasetInfo();
  cpResult = res; window.__lastCompare = res;
  cpMeta = { dataset: info.ok ? info.datasetId : '', 'prices to': info.ok ? info.latestSession : '', universe: uni ? uni.label : 'own list', start: $('cp-start').value, 'rupees per buy': params.perTxAmount, 'max buys': params.maxBuys };
  $('cp-status').innerHTML = kv([...(uni ? [['universe', esc(uni.label), uni.biased ? 'warn' : '']] : []), ['runs', res.rows.length + ' in ' + Math.round(performance.now() - t0) + ' ms', 'ok'],
    ...(many.missing.length ? [['no data', esc(many.missing.map(m => m.symbol).slice(0, 15).join(', ')), 'warn']] : []),
    ...(res.skipped.length ? [['left out', esc(res.skipped.slice(0, 8).map(s => s.symbol + ': ' + s.reason).join('; ')), 'warn']] : [])]);
  $('cp-results').style.display = '';
  $('cp-summary').innerHTML = table([['strategy', 'Strategy', 'left'], ['symbols', 'Symbols'], ['xirr', 'Median XIRR', '', pc], ['cagr', 'Median CAGR', '', pc], ['maxDD', 'Median max fall', '', pc], ['worstDD', 'Worst fall', '', pc],
    ['trades', 'Trades'], ['profitable', 'Profitable', '', (v, r) => v + ' of ' + r.symbols], ['netPnl', 'Net P&L', '', inr]], res.summary);
  $('cp-rows').innerHTML = table([['strategy', 'Strategy', 'left'], ['symbol', 'Symbol', 'left'], ['xirr', 'XIRR', '', pc], ['cagr', 'CAGR', '', pc], ['maxDD', 'Max fall', '', pc], ['trades', 'Trades'], ['netPnl', 'Net P&L', '', inr],
    ['open', 'Open', '', v => v ? 'yes' : '']], res.rows.slice().sort((a, b) => a.symbol.localeCompare(b.symbol) || b.xirr - a.xirr).slice(0, 400));
  $('cp-csv').disabled = false;
});
$('cp-csv').addEventListener('click', () => {
  if (!cpResult) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([CP.toCSV(cpResult, cpMeta)], { type: 'text/csv' }));
  a.download = 'compare_' + (cpMeta.dataset || 'run') + '.csv'; a.click();
});

/* ---------------- report extras + studio id (after every run) ---------------- */
let last = null;
window.addEventListener('btlab:run', async e => {
  const res = last = e.detail, bars = res.bars, cap = res.meta.capital ?? res.schema?.sizing?.capital ?? 100000;
  const from = new Date(res.meta.from ?? bars.t[0]).toISOString().slice(0, 10);
  const lti = X.ltiBenchmark(bars, cap, from), sip = X.sipBenchmark(bars, cap, from), mine = CP.runXirr(res, bars);
  $('x-bench').innerHTML = kv([['this strategy — XIRR on the money it actually used', pc(mine)], ['this strategy — CAGR on the whole capital', pc(res.stats.cagr)],
    ['buy once and hold from ' + from, lti.ok ? `${pc(lti.cagr)} a year · ends ${inr(lti.finalValue)}` : '—'], ['monthly instalments (SIP) from ' + from, sip.ok ? `XIRR ${pc(sip.xirr)} · ${sip.instalments} instalments` : '—'],
    ['note', 'benchmarks carry no charges and no dividends', 'muted']]);
  $('x-mc-out').innerHTML = ''; $('x-sheet-out').innerHTML = '';
  const strategy = res.btdesk ? { btdesk: res.btdesk.id, params: res.btdesk.params } : res.schema;
  const fp = await X.fingerprint({ datasetId: res.dataSource?.datasetId, symbol: bars.symbol, strategy, options: { raw: !!res.meta.raw } });
  res.fingerprint = fp;
  $('studio-id').textContent = `dataset ${res.dataSource?.datasetId || 'not the official dataset'} · run ${fp.slice(0, 16)} · engine ${X.ENGINE_VERSION}`;
});
$('x-mc-run').addEventListener('click', () => {
  if (!last) return;
  const cap = last.meta.capital ?? last.schema?.sizing?.capital ?? 100000;
  const mc = X.monteCarlo(last.trades.map(t => t.net), { runs: Number($('x-mc-n').value), seed: Number($('x-mc-seed').value), capital: cap });
  $('x-mc-out').innerHTML = mc.ok ? kv([['closed trades shuffled', mc.trades + ' × ' + mc.runs.toLocaleString('en-IN')], ['largest fall, actual order', pc(mc.actual.maxDD)], ['largest fall, median of shuffles', pc(mc.maxDD.p50)],
    ['largest fall, 95 in 100 shuffles stay under', pc(mc.maxDD.p95), 'warn'], ['what this is', 'the same trades in another order. It makes no new trades and says nothing about the future.', 'muted']]) : kv([['shuffle test', esc(mc.reason), 'warn']]);
});
$('x-sheet-run').addEventListener('click', () => {
  if (!last) return;
  const rows = X.parseSheetRows($('x-sheet').value);
  if (!rows.length) { $('x-sheet-out').innerHTML = kv([['sheet', 'no rows found — each line needs a date like 2024-01-31 first', 'warn']]); return; }
  const d = X.sheetDiff(last.trades.filter(t => t.reason !== 'end_of_data'), rows);
  $('x-sheet-out').innerHTML = kv([['same', d.matched, d.ok ? 'ok' : ''], ['different', d.differing.length, d.differing.length ? 'bad' : 'ok'], ['only in this run', d.onlyApp.length, d.onlyApp.length ? 'warn' : 'ok'], ['only in the sheet', d.onlySheet.length, d.onlySheet.length ? 'warn' : 'ok'],
    ...d.differing.slice(0, 12).map(x => [x.entryDate, esc(Object.entries(x.fields).map(([k, v]) => `${k}: app ${v[0]} / sheet ${v[1]}`).join(' · ')), 'bad'])]);
});
