/* ============================================================
   BACKTEST LAB — ui.js  (Phase 3 wiring)
   ============================================================ */

import * as B from './builder.js';
import { INDICATORS } from './engine.js';
import * as D from './data.js';
import * as CH from './chart.js';
import * as RP from './report.js';
import * as ST from './studio.js';
import * as PF from './portfolio.js';

const $ = id => document.getElementById(id);
let form = B.schemaToForm(B.getPreset('ma_stack'));
if (!form.symbol) form.symbol = 'RELIANCE';   // UI default only; schema stays symbol-free
let rawMode = false;

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('screen-' + tab.dataset.screen).classList.add('active');
    if (tab.dataset.screen === 'library') renderLibrary();
    if (tab.dataset.screen === 'json') refreshJson();
  });
});

/* ---------------- indicator rows ---------------- */

function indRow(ind, i) {
  const types = Object.keys(INDICATORS);
  const def = INDICATORS[ind.type] || {};
  const args = def.args || [];
  const el = document.createElement('div');
  el.className = 'rule-row';
  el.innerHTML = `
    <span class="idx">${i + 1}</span>
    <select data-k="type">${types.map(t => `<option ${t === ind.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
    ${def.src ? `<select data-k="source">${B.SOURCES.map(s => `<option ${s === (ind.source || 'close') ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}
    ${args.map(a => `<input data-k="${a}" type="number" min="1" value="${ind[a] ?? ''}" placeholder="${a}" style="max-width:78px">`).join('')}
    <button class="kill" data-kill="${i}" aria-label="Remove indicator">✕</button>`;
  el.querySelectorAll('[data-k]').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.k;
      form.indicators[i][k] = (k === 'type' || k === 'source') ? inp.value : Number(inp.value);
      if (k === 'type' || k === 'period' || k === 'slow') {
        const others = form.indicators.filter((_, j) => j !== i).map(x => x.key);
        form.indicators[i].key = B.suggestKey(form.indicators[i].type, form.indicators[i], others);
      }
      renderAll();
    });
  });
  el.querySelector('[data-kill]').addEventListener('click', () => {
    form.indicators.splice(i, 1); renderAll();
  });
  return el;
}

function renderIndicators() {
  const host = $('ind-list');
  host.innerHTML = '';
  if (!form.indicators.length) {
    host.innerHTML = '<div class="muted mono" style="font-size:12px;padding:6px 0">None — price-only rules still work.</div>';
  }
  form.indicators.forEach((ind, i) => host.appendChild(indRow(ind, i)));
}

/* ---------------- condition rows ---------------- */

function condRow(row, i, onChange, onKill, opts = {}) {
  const operands = B.operandChoices(form);
  const extra = opts.positionOperands ? ['lastBuyPrice', 'lotBuyPrice', 'avgBuyPrice', 'peakPrice'] : [];
  const all = [...operands, ...extra];
  const el = document.createElement('div');
  el.className = 'rule-row';

  const optList = (sel) => all.map(o => `<option ${o === sel ? 'selected' : ''}>${o}</option>`).join('')
    + (all.includes(row.right) || !opts.allowNumber ? '' : '');

  el.innerHTML = `
    ${opts.hideIndex ? '' : `<span class="idx">${i + 1}</span>`}
    <select data-k="left">${optList(row.left)}</select>
    <select data-k="op">${B.COMPARATORS.map(c => `<option value="${c.op}" ${c.op === row.op ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
    <select data-k="right">${all.map(o => `<option ${o === row.right ? 'selected' : ''}>${o}</option>`).join('')}
      <option value="__num" ${!all.includes(row.right) ? 'selected' : ''}>a number…</option></select>
    <input data-k="num" type="number" step="any" value="${all.includes(row.right) ? '' : row.right}"
           placeholder="value" style="max-width:76px;${all.includes(row.right) ? 'display:none' : ''}">
    <input data-k="factor" type="number" step="0.01" value="${row.factor ?? 1}" title="multiplier on the right side"
           style="max-width:64px;${all.includes(row.right) ? '' : 'display:none'}">
    ${onKill ? `<button class="kill" aria-label="Remove condition">✕</button>` : ''}`;

  el.querySelectorAll('[data-k]').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.k;
      if (k === 'right') {
        if (inp.value === '__num') { row.right = '0'; }
        else { row.right = inp.value; }
      } else if (k === 'num') {
        row.right = inp.value;
      } else if (k === 'factor') {
        row.factor = Number(inp.value);
      } else {
        row[k] = inp.value;
      }
      onChange();
      renderAll();
    });
  });
  if (onKill) el.querySelector('.kill').addEventListener('click', () => { onKill(); renderAll(); });
  return el;
}

function renderEntry() {
  const host = $('entry-list');
  host.innerHTML = '';
  if (!form.entryRows.length) {
    host.innerHTML = '<div class="muted mono" style="font-size:12px;padding:6px 0">Add at least one condition.</div>';
  }
  form.entryRows.forEach((row, i) => {
    host.appendChild(condRow(row, i, () => {}, () => form.entryRows.splice(i, 1)));
  });
}

function renderExitCond() {
  const wrap = $('exit-cond-wrap');
  wrap.classList.toggle('hidden', !form.exit.useCondition);
  const host = $('exit-cond-list');
  host.innerHTML = '';
  if (form.exit.useCondition) {
    host.appendChild(condRow(form.exit.conditionRow, 0, () => {}, null, { hideIndex: true }));
  }
}

function renderPyr() {
  $('pyr-wrap').classList.toggle('hidden', !form.pyramiding.enabled);
  const host = $('pyr-cond-list');
  host.innerHTML = '';
  if (form.pyramiding.enabled) {
    host.appendChild(condRow(form.pyramiding.triggerRow, 0, () => {}, null,
      { hideIndex: true, positionOperands: true }));
  }
}

/* ---------------- scalar bindings ---------------- */

function bind(id, get, set, ev = 'change') {
  const el = $(id);
  if (!el) return;
  el.addEventListener(ev, () => { set(el.type === 'checkbox' ? el.checked : el.value); renderAll(); });
  bind.all = bind.all || [];
  bind.all.push(() => {
    const v = get();
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
}

bind('f-symbol', () => form.symbol, v => form.symbol = String(v).toUpperCase());
bind('f-label',  () => form.label,  v => form.label = v);
bind('f-note',   () => form.note,   v => form.note = v);
bind('f-entry-join', () => form.entryJoin, v => form.entryJoin = v);
bind('f-entry-measure', () => form.entryMeasureOn, v => form.entryMeasureOn = v);
bind('f-exit-measure', () => form.exit.measureOn, v => form.exit.measureOn = v);
bind('f-target', () => form.exit.targetPct, v => form.exit.targetPct = v);
bind('f-stop',   () => form.exit.stopPct,   v => form.exit.stopPct = v);
bind('f-trail',  () => form.exit.trailPct,  v => form.exit.trailPct = v);
bind('f-timestop', () => form.exit.timeStopBars, v => form.exit.timeStopBars = v);
bind('f-accounting', () => form.exit.accounting, v => form.exit.accounting = v);
bind('f-use-exit-cond', () => form.exit.useCondition, v => form.exit.useCondition = v);
bind('f-capital', () => form.sizing.capital, v => form.sizing.capital = v);
bind('f-size-mode', () => form.sizing.mode, v => form.sizing.mode = v);
bind('f-size-value', () => form.sizing.value, v => form.sizing.value = v);
bind('f-pyr', () => form.pyramiding.enabled, v => form.pyramiding.enabled = v);
bind('f-maxlots', () => form.pyramiding.maxLots, v => form.pyramiding.maxLots = v);
bind('f-cost-preset', () => form.costs.preset, v => form.costs.preset = v);
bind('f-slippage', () => form.costs.slippageBps, v => form.costs.slippageBps = v);
bind('f-volcap', () => form.costs.volumeCapPct, v => form.costs.volumeCapPct = v);

/* ---------------- validation ---------------- */

function renderValidation() {
  const schema = B.formToSchema(form);
  const errs = B.validateSchema(schema);
  const box = $('validation');
  if (!errs.length) {
    box.className = 'hidden';
    box.innerHTML = '';
    $('btn-run').disabled = false;
  } else {
    box.className = 'notice bad';
    box.innerHTML = `<b>This strategy can't run yet</b><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
    $('btn-run').disabled = true;
  }
  return { schema, errs };
}

/* ---------------- master render ---------------- */

function renderAll() {
  (bind.all || []).forEach(f => f());
  $('f-size-label').textContent = form.sizing.mode === 'fixed'
    ? 'Amount per trade ₹' : 'Fraction of capital (0–1)';
  renderIndicators();
  renderEntry();
  renderExitCond();
  renderPyr();
  renderValidation();
  $('doc-strategy').textContent = (form.label || 'UNTITLED').toUpperCase();
}

/* ---------------- add buttons ---------------- */

$('add-ind').addEventListener('click', () => {
  const keys = form.indicators.map(i => i.key);
  form.indicators.push({ key: B.suggestKey('SMA', { period: 50 }, keys), type: 'SMA', source: 'close', period: 50 });
  renderAll();
});
$('add-entry').addEventListener('click', () => {
  form.entryRows.push({ left: 'close', op: 'gt', right: form.indicators[0]?.key || '0', factor: 1 });
  renderAll();
});

/* ---------------- RAW / REAL stamp ---------------- */

function setRaw(on) {
  rawMode = on;
  $('sw-raw').setAttribute('aria-pressed', String(on));
  $('sw-real').setAttribute('aria-pressed', String(!on));
  $('cost-note').innerHTML = on
    ? '<b>Raw</b> — no brokerage, no taxes, no slippage. Every strategy looks better here. This is the number most videos show you.'
    : 'Real applies Zerodha delivery charges — STT, exchange, GST, SEBI, stamp duty and DP — plus slippage. Raw strips every charge, which is the number most strategy videos show.';
}
$('sw-raw').addEventListener('click', () => setRaw(true));
$('sw-real').addEventListener('click', () => setRaw(false));

/* ---------------- save / export / import ---------------- */

$('btn-save').addEventListener('click', () => {
  const { schema, errs } = renderValidation();
  if (errs.length) return;
  schema.id = slug(schema.label);
  form.id = schema.id;
  B.saveToLibrary(schema);
  toast('Saved to library.');
});

$('btn-export').addEventListener('click', () => {
  const { schema } = renderValidation();
  const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug(schema.label) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const schema = B.migrateSchema(JSON.parse(await f.text()));
    const errs = B.validateSchema(schema);
    if (errs.length) { toast('That file has problems: ' + errs[0], true); return; }
    form = B.schemaToForm(schema);
    renderAll();
    toast('Loaded ' + (schema.label || schema.id));
  } catch (err) { toast(err.message, true); }
});

/* ---------------- library ---------------- */

function renderLibrary() {
  const host = $('lib-list');
  const saved = new Set(B.loadLibrary().map(s => s.id));
  host.innerHTML = '';
  for (const s of B.allStrategies()) {
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.innerHTML = `
      <span class="mark">${saved.has(s.id) ? '★' : '·'}</span>
      <span class="txt"><b>${esc(s.label)}</b><small>${esc(s.note || '')}</small></span>`;
    el.addEventListener('click', () => {
      form = B.schemaToForm(s);
      document.querySelector('.tab[data-screen="build"]').click();
      renderAll();
    });
    host.appendChild(el);
  }
}

/* ---------------- advanced JSON ---------------- */

function refreshJson() {
  $('json-box').value = JSON.stringify(B.formToSchema(form), null, 2);
  $('json-msg').innerHTML = '';
}
$('json-refresh').addEventListener('click', refreshJson);
$('json-load').addEventListener('click', () => {
  try {
    const schema = B.migrateSchema(JSON.parse($('json-box').value));
    const errs = B.validateSchema(schema);
    if (errs.length) {
      $('json-msg').innerHTML = `<div class="notice bad">${errs.map(esc).join('<br>')}</div>`;
      return;
    }
    form = B.schemaToForm(schema);
    renderAll();
    $('json-msg').innerHTML = '<div class="notice">Loaded into the form.</div>';
  } catch (e) {
    $('json-msg').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
  }
});

/* ---------------- data tab ---------------- */

const WORKER_KEY = 'btlab_worker_url';
$('f-worker').value = localStorage.getItem(WORKER_KEY) || '';
$('f-worker').addEventListener('change', e => localStorage.setItem(WORKER_KEY, e.target.value.trim()));

$('btn-storage').addEventListener('click', async () => {
  try {
    const p = await D.ensurePersistence();
    $('storage-out').innerHTML = kv([
      ['persisted', p.persisted ? 'yes' : 'no — data may be evicted', p.persisted ? 'ok' : 'warn'],
      ['used', mb(p.usage)], ['available', mb(p.quota)],
    ]);
  } catch (e) { $('storage-out').innerHTML = kv([['error', e.message, 'bad']]); }
});

$('btn-fetch').addEventListener('click', async () => {
  const sym = form.symbol;
  const worker = $('f-worker').value.trim();
  $('data-out').innerHTML = kv([['status', 'downloading ' + sym + '…']]);
  try {
    const json = worker
      ? await (await fetch(`${worker.replace(/\/+$/, '')}/yf?symbol=${encodeURIComponent(sym)}&range=25y`)).json()
      : await D.fetchYahoo(sym);
    if (json.error) throw new Error(json.error);
    const { rows, splits, dividends } = D.parseYahoo(json);
    let rec = (await D.loadRecord(sym)) || D.emptyRecord(sym);
    rec.splits = splits; rec.dividends = dividends;
    rec = D.mergeRows(rec, rows, worker ? 'worker' : 'yahoo');
    D.buildAdjusted(rec);
    const anom = D.detectAnomalies(rec);
    rec.flags = anom.length ? ['CA_ANOMALY'] : []; rec.anomalies = anom;
    await D.saveRecord(rec);
    showRecord(rec, anom);
  } catch (e) {
    $('data-out').innerHTML = kv([
      ['error', esc(e.message), 'bad'],
      ['next', worker ? 'check the Worker is deployed' : 'set a Worker URL above', 'warn'],
    ]);
  }
});

$('btn-cached').addEventListener('click', async () => {
  const rec = await D.loadRecord(form.symbol);
  if (!rec) { $('data-out').innerHTML = kv([['cached', 'nothing for ' + form.symbol, 'warn']]); return; }
  showRecord(rec, rec.anomalies || []);
});

function showRecord(rec, anom) {
  const stale = D.tradingDaysStale(rec.lastDate);
  $('data-out').innerHTML = kv([
    ['bars', rec.t.length, 'ok'],
    ['first', day(rec.t[0])],
    ['last', day(rec.lastDate)],
    ['years', (rec.t.length / 250).toFixed(1)],
    ['splits', rec.splits.length],
    ['unexplained jumps', anom.length, anom.length ? 'warn' : 'ok'],
    ['freshness', stale <= 3 ? 'current' : stale + ' trading days behind', stale <= 3 ? 'ok' : 'warn'],
  ]);
  $('doc-data').textContent = `DATA TO ${day(rec.lastDate)}`;
}

$('btn-csv').addEventListener('click', () => $('file-csv').click());
$('file-csv').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  try {
    const head = text.split('\n')[0];
    if (/SYMBOL/i.test(head) && /SERIES/i.test(head)) {
      const map = D.parseBhavcopy(text);
      let n = 0;
      for (const [sym, row] of map) {
        let rec = (await D.loadRecord(sym)) || D.emptyRecord(sym);
        rec = D.mergeRows(rec, [row], 'bhavcopy');
        await D.saveRecord(rec); n++;
      }
      $('csv-out').innerHTML = kv([['bhavcopy symbols merged', n, 'ok']]);
    } else {
      const rows = D.parseGenericCSV(text);
      let rec = (await D.loadRecord(form.symbol)) || D.emptyRecord(form.symbol);
      rec = D.mergeRows(rec, rows, 'csv');
      D.buildAdjusted(rec);
      await D.saveRecord(rec);
      $('csv-out').innerHTML = kv([['rows added to ' + form.symbol, rows.length, 'ok'], ['total bars', rec.t.length]]);
    }
  } catch (err) { $('csv-out').innerHTML = kv([['error', esc(err.message), 'bad']]); }
});

/* ---------------- run (handed to Phase 4/5) ---------------- */

let chartApi = null, replay = null, lastRun = null;

$('btn-run').addEventListener('click', async () => {
  const { schema, errs } = renderValidation();
  if (errs.length) return;
  const rec = await D.loadRecord(form.symbol);
  if (!rec || !rec.t.length) {
    toast('No price data for ' + form.symbol + ' — download it on the Data tab first.', true);
    return;
  }
  const { runBacktest, computeIndicators } = await import('./engine.js');
  const t0 = performance.now();
  const res = runBacktest(rec, schema, { raw: rawMode });
  res.indicators = computeIndicators(rec.adj ? { ...rec, ...rec.adj, vol: rec.vol } : rec, schema);
  res.bars = rec;
  const ms = (performance.now() - t0).toFixed(0);
  lastRun = res;
  window.__lastResult = res;

  const s = res.stats;
  toast(`${res.trades.length} trades · net ₹${Math.round(s.netPnl).toLocaleString('en-IN')} · CAGR ${s.cagr.toFixed(1)}% · ${ms}ms`);

  document.querySelector('.tab[data-screen="chart"]').click();
  await renderChart(res, rec, schema);
});

async function renderChart(res, bars, schema) {
  $('chart-empty').style.display = 'none';
  $('chart-wrap').style.display = '';
  $('trades-wrap').style.display = '';
  $('chart-title').textContent = (schema.symbol || form.symbol) + ' · ' + (schema.label || '');
  if (replay) replay.destroy();
  if (chartApi) chartApi.destroy();

  chartApi = await CH.createChart($('chart-host'), { height: 380 });
  $('chart-engine').textContent = chartApi.kind === 'lwc' ? '' : 'built-in renderer';

  chartApi.setData(bars, res.indicators, Infinity);
  chartApi.setMarkers(res.trades, bars, Infinity);
  if (chartApi.setEquity) chartApi.setEquity(res.equity);
  chartApi.fitContent();

  replay = CH.createReplay(chartApi, bars, res, { startAt: bars.t.length - 1 });
  replay.onTick(({ i, total, done }) => {
    $('rp-date').textContent = new Date(bars.t[i]).toISOString().slice(0, 10);
    $('rp-progress').textContent = `${i + 1} / ${total}`;
    $('rp-play').textContent = replay.playing ? '❚❚ Pause' : (done ? '▶ Replay' : '▶ Play');
  });

  renderTrades(res, bars);
  buildReportTab(res, bars, schema);
  buildStudioTab(res, schema);
}

/* ---------------- report tab ---------------- */

let reportState = null;

async function buildReportTab(res, bars, schema) {
  const { runBacktest, buyAndHold, COST_PRESETS } = await import('./engine.js');
  const preset = COST_PRESETS[schema.costs?.preset] || COST_PRESETS.zerodha_delivery;
  const bh = buyAndHold(bars, schema.sizing?.capital ?? 100000, res.meta.raw ? COST_PRESETS.none : preset);
  const other = runBacktest(bars, schema, { raw: !res.meta.raw });
  other.bars = bars;
  reportState = { res, other, bh, bars, schema, showingRaw: !!res.meta.raw };
  paintReport();
}

function paintReport() {
  if (!reportState) return;
  const { bh, bars, schema, showingRaw } = reportState;
  const active = showingRaw
    ? (reportState.res.meta.raw ? reportState.res : reportState.other)
    : (reportState.res.meta.raw ? reportState.other : reportState.res);

  $('report-empty').style.display = 'none';
  $('report-body').style.display = '';
  $('rep-real').setAttribute('aria-pressed', String(!showingRaw));
  $('rep-raw').setAttribute('aria-pressed', String(showingRaw));

  const rep = RP.buildReport(active, bh);
  $('rep-title').textContent = (schema.symbol || form.symbol) + ' · ' + (schema.label || '');
  $('rep-period').textContent = rep.period;

  $('rep-headline').innerHTML = rep.headline.map(c => `
    <div class="headline-cell">
      <div class="figure-label">${esc(c.label)}</div>
      <div class="figure ${c.tone || ''}">${esc(c.value)}</div>
      ${c.sub ? `<small>${esc(c.sub)}</small>` : ''}
    </div>`).join('');

  $('rep-groups').innerHTML = rep.groups.map(g => `
    <section class="section"><h2>${esc(g.title)}</h2><div class="section-body">
      ${g.rows.map(r => `<div class="kv"><span>${esc(r[0])}</span><span class="${r[2] || ''}">${esc(r[1])}</span></div>`).join('')}
    </div></section>`).join('');

  $('rep-caveats').innerHTML = rep.caveats.map(c => `<li>${esc(c)}</li>`).join('');

  RP.plotEquity($('plot-equity'), bars, active.equity, bh.equity);
  RP.plotDrawdown($('plot-dd'), RP.drawdownSeries(active.equity));
  RP.plotHistogram($('plot-hist'), RP.pnlHistogram(active.trades));
  RP.plotRolling($('plot-roll'), RP.rollingCagr(bars, active.equity, 250));
  $('rep-heatmap').innerHTML = RP.monthlyHeatmapHTML(RP.monthlyReturns(bars, active.equity));
}

$('rep-raw').addEventListener('click', () => { if (reportState) { reportState.showingRaw = true; paintReport(); } });
$('rep-real').addEventListener('click', () => { if (reportState) { reportState.showingRaw = false; paintReport(); } });

$('rep-csv').addEventListener('click', () => {
  if (!reportState) return;
  const active = reportState.showingRaw
    ? (reportState.res.meta.raw ? reportState.res : reportState.other)
    : (reportState.res.meta.raw ? reportState.other : reportState.res);
  const head = 'entry_date,exit_date,entry_price,exit_price,qty,gross,costs,net,pct,bars,reason';
  const rows = active.trades.map(t => [
    day(t.entryDate), day(t.exitDate), t.entryPrice.toFixed(2), t.exitPrice.toFixed(2),
    t.qty, t.gross.toFixed(2), t.costs.toFixed(2), t.net.toFixed(2), t.pct.toFixed(2), t.bars, t.reason,
  ].join(','));
  download([head, ...rows].join('\n'), (form.symbol || 'trades') + '_trades.csv', 'text/csv');
});

/* ---------------- studio tab ---------------- */

let deck = [], deckIdx = 0;

function buildStudioTab(res, schema) {
  const other = reportState?.other;
  const bh = reportState?.bh;
  deck = ST.buildDeck(res, bh, schema, { rawResult: res.meta.raw ? null : other });
  deckIdx = 0;
  $('studio-empty').style.display = 'none';
  $('studio-body').style.display = '';
  const chk = ST.publishCheck(res);
  $('studio-warn').innerHTML = chk.ok
    ? ''
    : `<div class="notice bad"><b>Check before recording</b><ul>${chk.problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
  paintSlide();
}

function paintSlide() {
  if (!deck.length) return;
  const f = deck[Math.max(0, Math.min(deckIdx, deck.length - 1))];
  $('st-count').textContent = `${deckIdx + 1} / ${deck.length}`;
  $('stage-foot').textContent = ST.DISCLAIMER;
  const host = $('stage-content');
  host.innerHTML = renderSlide(f);
  const fig = host.querySelector('[data-count]');
  if (fig) {
    const target = Number(fig.dataset.count);
    const suffix = fig.dataset.suffix || '';
    ST.animateNumber(fig, target, v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + suffix);
  }
}

function renderSlide(f) {
  switch (f.kind) {
    case 'hook':
      return `<div class="st-kicker">${esc(f.kicker)}</div>
              <div class="st-head">${esc(f.line)}</div>
              ${f.sub ? `<div class="st-sub">${esc(f.sub)}</div>` : ''}
              <div class="st-sub">${esc(f.period)}</div>`;
    case 'rules':
      return `<div class="st-label">${esc(f.title)}</div>
              <ul class="st-list">${f.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'compare':
      return `<div class="st-label">${esc(f.title)}</div>
              <div class="st-compare">
                <div><div class="st-label">${esc(f.left.label)}</div><div class="st-figure raw">${esc(f.left.value)}</div></div>
                <div><div class="st-label">${esc(f.right.label)}</div><div class="st-figure up">${esc(f.right.value)}</div></div>
              </div>
              <div class="st-sub">${esc(f.note)}</div>`;
    case 'metric': {
      const numeric = parseFloat(String(f.value).replace(/[^0-9.\-]/g, '')) * (String(f.value).includes('−') ? -1 : 1);
      return `<div class="st-label">${esc(f.label)}</div>
              <div class="st-figure ${f.tone}" data-count="${numeric}" data-suffix="%">${esc(f.value)}</div>
              ${f.sub ? `<div class="st-sub">${esc(f.sub)}</div>` : ''}`;
    }
    case 'verdict':
      return `<div class="st-label">${esc(f.strategy || '')}</div>
              <div class="st-verdict ${f.tone}">${esc(f.title)}</div>
              <div class="st-sub">${esc(f.detail)}</div>
              <div class="st-label">${esc(f.period || '')}</div>`;
    default: return '';
  }
}

$('st-next').addEventListener('click', () => { if (deckIdx < deck.length - 1) { deckIdx++; paintSlide(); } });
$('st-prev').addEventListener('click', () => { if (deckIdx > 0) { deckIdx--; paintSlide(); } });
$('st-ratio').addEventListener('click', () => {
  const stage = $('stage');
  const to916 = !stage.classList.contains('r916');
  stage.classList.toggle('r916', to916);
  stage.classList.toggle('r169', !to916);
  $('st-ratio').textContent = to916 ? '9:16' : '16:9';
});

/* ---------------- portfolio tab ---------------- */

$('pf-ranking').innerHTML = Object.entries(PF.RANKING_RULES)
  .map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');

$('pf-run').addEventListener('click', async () => {
  const { schema, errs } = renderValidation();
  if (errs.length) { toast('Fix the strategy first.', true); return; }
  const syms = $('pf-symbols').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!syms.length) { toast('List at least two symbols.', true); return; }

  $('pf-status').innerHTML = kv([['status', 'loading ' + syms.length + ' symbols…']]);
  const records = {};
  const missing = [];
  for (const sym of syms) {
    const rec = await D.loadRecord(sym);
    if (rec && rec.t.length) records[sym] = rec; else missing.push(sym);
  }
  if (missing.length) {
    $('pf-status').innerHTML = kv([['not downloaded', missing.join(', '), 'bad'],
      ['fix', 'download these on the Data tab first', 'warn']]);
    if (!Object.keys(records).length) return;
  }

  const t0 = performance.now();
  const res = PF.runPortfolio(records, schema, {
    slots: Number($('pf-slots').value),
    capital: Number($('pf-capital').value),
    ranking: $('pf-ranking').value,
    raw: rawMode,
  });
  const ms = (performance.now() - t0).toFixed(0);
  const chk = PF.conservationCheck(res, records);

  $('pf-status').innerHTML = kv([
    ['symbols', Object.keys(records).length, 'ok'],
    ['trades', res.trades.length],
    ['run time', ms + ' ms'],
    ['book balances', chk.ok ? 'yes' : 'NO — see console', chk.ok ? 'ok' : 'bad'],
  ]);
  if (!chk.ok) console.warn('portfolio conservation problems', chk.problems);

  renderPortfolio(res);
  window.__lastPortfolio = res;
});

function renderPortfolio(res) {
  $('pf-results').style.display = '';
  const s = res.stats, p = res.portfolio;
  $('pf-headline').innerHTML = [
    ['Net P&L', RP.money(s.netPnl), RP.tone(s.netPnl), ''],
    ['CAGR', RP.pct(s.cagr), RP.tone(s.cagr), ''],
    ['Max drawdown', RP.pct(-Math.abs(s.maxDD)), 'down', s.maxDDDays + ' days'],
    ['Slots used', p.slotUtilisation.toFixed(0) + '%', '', p.slots + ' available'],
  ].map(([l, v, t, sub]) => `<div class="headline-cell">
      <div class="figure-label">${l}</div><div class="figure ${t}">${v}</div>
      ${sub ? `<small>${sub}</small>` : ''}</div>`).join('');

  RP.plotEquity($('pf-plot'), { t: Float64Array.from(res.calendar) }, res.equity, null);

  $('pf-stats').innerHTML = kv([
    ['Trades', String(s.trades)],
    ['Win rate', RP.pct(s.winRate)],
    ['Profit factor', RP.num(s.profitFactor)],
    ['Sharpe', RP.num(s.sharpe)],
    ['Charges paid', RP.money(s.totalCosts)],
    ['Cash idle', RP.pct(p.cashDragPct)],
    ['Ranking rule', p.rankingLabel, 'warn'],
    ['Charges applied', res.meta.raw ? 'NONE — raw' : res.meta.costPreset, res.meta.raw ? 'warn' : ''],
  ]);

  $('pf-symbols-out').innerHTML = p.perSymbol.length
    ? p.perSymbol.map(x => `<div class="kv"><span>${esc(x.symbol)} <span class="muted">${x.trades} trades</span></span>
        <span class="${x.net >= 0 ? 'ok' : 'bad'}">${RP.money(x.net)}</span></div>`).join('')
    : '<div class="muted mono" style="font-size:12px">No trades.</div>';

  const byReason = {};
  for (const sk of res.skipped) byReason[sk.reason] = (byReason[sk.reason] || 0) + 1;
  const labels = { no_slot: 'No free slot', no_cash: 'Not enough cash', size_zero_or_volume_cap: 'Order too small or volume-capped' };
  $('pf-skipped').innerHTML = Object.keys(byReason).length
    ? Object.entries(byReason).map(([r, n]) => `<div class="kv"><span>${labels[r] || r}</span><span class="warn">${n}</span></div>`).join('')
      + `<div class="notice" style="margin-top:10px">Every one of these was a real signal the strategy produced and the portfolio could not take. On a single stock they would all have been filled.</div>`
    : '<div class="muted mono" style="font-size:12px">Every signal was taken.</div>';
}

function download(text, name, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}


$('rp-play').addEventListener('click', () => {
  if (!replay) return;
  if (replay.playing) { replay.pause(); return; }
  if (replay.index >= replay.total - 1) replay.seek(0);
  replay.play();
});
$('rp-back').addEventListener('click', () => replay && replay.step(-1));
$('rp-fwd').addEventListener('click', () => replay && replay.step(1));
$('rp-all').addEventListener('click', () => { if (replay) { replay.pause(); replay.seek(replay.total - 1); chartApi.fitContent(); } });
$('rp-speed').addEventListener('change', e => replay && replay.setSpeed(Number(e.target.value)));

function renderTrades(res, bars) {
  $('trades-count').textContent = res.trades.length + ' fills';
  const host = $('trades-list');
  host.innerHTML = '';
  if (!res.trades.length) {
    host.innerHTML = '<div class="muted mono" style="font-size:12px;padding:10px 0">This strategy never triggered on this data. That is a result too.</div>';
    return;
  }
  for (const tr of res.trades) {
    const el = document.createElement('div');
    el.className = 'kv';
    el.style.cursor = 'pointer';
    const sign = tr.net >= 0 ? 'ok' : 'bad';
    el.innerHTML = `<span>${day(tr.entryDate)} → ${day(tr.exitDate)} <span class="muted">${tr.reason}</span></span>
      <span class="${sign}">${tr.pct >= 0 ? '+' : ''}${tr.pct.toFixed(1)}% · ₹${Math.round(tr.net).toLocaleString('en-IN')}</span>`;
    el.addEventListener('click', () => {
      if (replay) replay.pause();
      chartApi.focusRange(tr.entryIdx, tr.exitIdx, bars);
    });
    host.appendChild(el);
  }
}

/* ---------------- helpers ---------------- */

function kv(pairs) {
  return pairs.map(([k, v, c]) => `<div class="kv"><span>${k}</span><span class="${c || ''}">${v}</span></div>`).join('');
}
const mb = b => b == null ? '—' : (b / 1048576).toFixed(0) + ' MB';
const day = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '—';
const slug = s => (s || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'custom';
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function toast(msg, bad) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:99;padding:12px 14px;border-radius:3px;font:12.5px/1.45 ui-monospace,monospace;box-shadow:0 6px 24px rgba(0,0,0,.5)';
    document.body.appendChild(el);
  }
  el.style.background = bad ? '#3A1E19' : '#1D2A22';
  el.style.color = bad ? '#E7A896' : '#BFE3CE';
  el.style.border = '1px solid ' + (bad ? '#C05B45' : '#5B9E76');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, 5200);
}

/* ---------------- boot ---------------- */
renderAll();
setRaw(false);
$('btn-storage').click();
window.__btlab = { get form() { return form; }, B, D };
