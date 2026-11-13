/* ============================================================
   BACKTEST LAB — source.js
   One loader for price history. Order: the official EOD2 dataset,
   then a file the user imported, then Yahoo — and Yahoo only when
   the user has ticked "allow unofficial source". Every result says
   where it came from. EOD2 prices are already adjusted, so the
   adjusted scale equals the raw scale and no jump check is run.
   Needs globalThis.EOD2Client (eod2-client.js, a classic script).
   ============================================================ */

export const DEFAULT_BASE_URL = 'https://amit-alphasetup.github.io/Amit-Alphasetup-nse-data/';   // v4: ETFs + indices + stocks
export const LEGACY_BASE_URL = 'https://amit-alphasetup.github.io/market-data/';                  // v3: ETFs + indices only
/* Tried in order, only when the DEFAULT address cannot be reached: the same published branch read straight from GitHub, then the v3 dataset. */
export const FALLBACK_BASE_URLS = ['https://raw.githubusercontent.com/Amit-Alphasetup/Amit-Alphasetup-nse-data/pub/', LEGACY_BASE_URL];
export const UNIVERSES = {
  NIFTY500: { label: "Nifty 500 (today's list — survivorship-biased)", kind: 'EQ', biased: true },
  NIFTY500_50: { label: "Nifty 500, first 50 by name (today's list — survivorship-biased)", kind: 'EQ', biased: true, limit: 50 },
  ETFS: { label: 'All ETFs in the dataset', kind: 'ETF', biased: false },
};
export const SOURCE_LABEL = { EOD2: 'Official dataset', CSV: 'Imported file', YAHOO: 'Yahoo — unofficial' };
const IMPORTED = new Set(['csv', 'bhavcopy', 'seed']);
const UNOFFICIAL = new Set(['yahoo', 'worker']);

let ds = { baseUrl: null, snap: null, error: null };

const ms = d => Date.parse(d + 'T00:00:00Z');
const num = v => (v === null || v === undefined) ? NaN : v;

/* Open the published dataset. Never throws: {ok:false, code, detail} on any problem. */
export async function openDataset(baseUrl = DEFAULT_BASE_URL, opts = {}) {
  const C = globalThis.EOD2Client;
  ds = { baseUrl, snap: null, error: null, asked: baseUrl };
  if (!C) { ds.error = { ok: false, code: 'CLIENT_MISSING', detail: 'eod2-client.js is not loaded' }; return ds.error; }
  const cache = opts.cache || (globalThis.indexedDB ? 'indexeddb' : 'memory');
  const tryOpen = async (url) => {
    const client = C.create({ baseUrl: url, cache, dbName: opts.dbName || 'eod2_v4', fetch: opts.fetch });
    try { return await client.openSnapshot(); } catch (e) { return { ok: false, code: 'SOURCE_UNAVAILABLE', detail: String((e && e.message) || e) }; }
  };
  let snap = await tryOpen(baseUrl);
  if (!snap.ok && baseUrl === DEFAULT_BASE_URL && opts.fallback !== false) {
    for (const url of FALLBACK_BASE_URLS) {
      const s2 = await tryOpen(url);
      if (s2.ok) { snap = s2; ds.baseUrl = url; break; }
    }
  }
  if (!snap.ok) { ds.error = snap; return snap; }
  ds.snap = snap;
  return datasetInfo();
}

export function datasetInfo() {
  if (!ds.snap) return ds.error || { ok: false, code: 'NOT_OPEN', detail: 'dataset not opened' };
  const m = ds.snap.manifest;
  const kinds = {};
  for (const e of Object.values(m.files)) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  return { ok: true, baseUrl: ds.baseUrl, fallback: ds.baseUrl !== ds.asked, datasetId: m.datasetId, latestSession: m.latestCompletedSession || m.latestSession, windowStart: m.windowStart || null,
    stocksFrom: m.eqHistoryFloor || null, contract: m.contract, symbols: Object.keys(m.files).length, kinds, truncated: Object.keys(m.pendingActions || {}).length,
    quarantined: Object.keys(m.quarantined || {}).length, excluded: Object.keys(m.excluded || {}).length };
}

/* Symbols of a named universe (UNIVERSES). 'NIFTY500' is the list of stocks in the dataset = today's index members: survivorship-biased. */
export function universeSymbols(id) {
  const u = UNIVERSES[id];
  if (!u || !ds.snap) return [];
  const all = listSymbols(u.kind);
  return u.limit ? all.slice(0, u.limit) : all;
}

/* Many symbols at once (portfolio runs): the dataset's symbols go through the client's getMany (bounded parallel downloads, hash-checked),
   anything else through loadBars. -> { records: {SYM: bars}, tags: {SYM: sourceTag}, missing: [{symbol, reasons}] } */
export async function loadMany(symbols, o = {}) {
  const syms = [...new Set(symbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))];
  const out = { records: {}, tags: {}, missing: [] };
  let done = 0;
  const tick = () => { done++; if (o.onProgress) o.onProgress(done, syms.length); };
  const inDs = [], rest = [];
  const names = ds.snap ? new Set(Object.keys(ds.snap.manifest.files).map(k => k.toUpperCase())) : new Set();
  for (const s of syms) (names.has(s) ? inDs : rest).push(s);
  if (inDs.length) {
    const got = await ds.snap.getMany(inDs, { concurrency: o.concurrency || 6, onProgress: tick });
    for (const s of inDs) {
      const r = got[s];
      if (r && r.ok) { out.records[s] = sliceRecord(recordFromBars(r.meta.symbol, r.bars, 'EOD2'), o); out.tags[s] = sourceTag({ source: 'EOD2', datasetId: ds.snap.id }); }
      else out.missing.push({ symbol: s, reasons: [r ? r.code : 'SOURCE_UNAVAILABLE'] });
    }
  }
  for (const s of rest) {
    const r = await loadBars(s, o);
    if (r.bars && r.bars.t.length) { out.records[s] = r.bars; out.tags[s] = sourceTag(r); } else out.missing.push({ symbol: s, reasons: r.reasons });
    tick();
  }
  return out;
}

/* Symbols in the dataset, optionally of one kind ('ETF' | 'INDEX' | 'EQ'), sorted. */
export function listSymbols(kind) {
  if (!ds.snap) return [];
  const f = ds.snap.manifest.files;
  return Object.keys(f).filter(s => !kind || f[s].kind === kind).sort();
}

/* One row per symbol for the Data tab, quarantined and excluded symbols included with their reasons. */
export function datasetRows() {
  if (!ds.snap) return [];
  const m = ds.snap.manifest, rows = [];
  for (const [s, e] of Object.entries(m.files))
    rows.push({ symbol: s, kind: e.kind, status: e.status, reasons: (e.reasons || []).map(r => r.code).filter(c => c !== 'OK').concat(e.historyTruncatedFrom ? ['HISTORY_FROM ' + e.historyTruncatedFrom + ' (corporate action awaiting review)'] : []), first: e.first, last: e.last, bars: e.bars });
  for (const [s, q] of Object.entries(m.quarantined || {}))
    rows.push({ symbol: s, kind: q.kind || '', status: 'QUARANTINED', reasons: [q.code || 'QUARANTINED'].concat((q.events || []).map(ev => ev.date || ev.code || '').filter(Boolean)), first: null, last: null, bars: 0 });
  for (const [s, x] of Object.entries(m.excluded || {}))
    rows.push({ symbol: s, kind: x.kind || '', status: 'EXCLUDED', reasons: [x.code || 'EXCLUDED'], first: null, last: null, bars: 0 });
  return rows.sort((a, b) => (a.kind + a.symbol).localeCompare(b.kind + b.symbol));
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Data tab markup: dataset id, latest session, then every symbol with its status and reasons. */
export function datasetHTML() {
  const i = datasetInfo();
  if (!i.ok) return `<div class="kv"><span>official dataset</span><span class="bad">not loaded — ${esc(i.code)}</span></div><div class="kv"><span>detail</span><span class="warn">${esc(i.detail || '')}</span></div>`;
  const cls = st => st === 'OK' ? 'ok' : st === 'WARN' ? 'warn' : 'bad';
  const head = [['dataset', i.datasetId, 'ok'], ['latest session', i.latestSession], ['served from', i.baseUrl, i.fallback ? 'warn' : ''],
    ['ETF + index history from', i.windowStart || '—'], ...(i.stocksFrom ? [['stock history from', i.stocksFrom + ' (each stock: its own first clean bar)']] : []),
    ['symbols', i.symbols + ' — ' + Object.entries(i.kinds).map(([k, n]) => n + ' ' + k).join(', ')],
    ...(i.truncated ? [['stocks with a shortened history', i.truncated + ' — a corporate action awaits review', 'warn']] : []),
    ['quarantined', i.quarantined, i.quarantined ? 'bad' : 'ok']].map(([k, v, c]) => `<div class="kv"><span>${k}</span><span class="${c || ''}">${esc(v)}</span></div>`).join('');
  const body = datasetRows().map(r => `<div class="kv" data-sym="${esc(r.symbol)}"><span>${esc(r.symbol)} <span class="muted">${esc(r.kind)}${r.last ? ' · ' + r.first + ' to ' + r.last : ''}</span></span><span class="${cls(r.status)}">${esc(r.status)}${r.reasons.length ? ' · ' + esc(r.reasons.join(', ')) : ''}</span></div>`).join('');
  return head + `<div class="figure-label" style="margin-top:14px">Per symbol</div>` + body;
}

/* Series rows [[date,o,h,l,c,v]] -> the engine's record. adjusted = raw. */
export function recordFromBars(symbol, rows, source = 'EOD2') {
  const col = k => Float64Array.from(rows, r => num(r[k]));
  const rec = { v: 1, symbol, t: Float64Array.from(rows, r => ms(r[0])), o: col(1), h: col(2), l: col(3), c: col(4), vol: Float64Array.from(rows, r => r[5] || 0),
    adj: null, splits: [], dividends: [], source, lastDate: rows.length ? ms(rows[rows.length - 1][0]) : null, downloadedAt: Date.now(), flags: [] };
  rec.adj = { o: rec.o, h: rec.h, l: rec.l, c: rec.c, factor: new Float64Array(rows.length).fill(1) };
  return rec;
}

/* Keep bars inside [from, to] plus `warmup` bars before `from`. Dates are 'YYYY-MM-DD'. */
export function sliceRecord(rec, { from, to, warmup = 0 } = {}) {
  if (!from && !to) return rec;
  const n = rec.t.length, f = from ? ms(from) : -Infinity, t = to ? ms(to) : Infinity;
  let a = 0; while (a < n && rec.t[a] < f) a++;
  let b = n; while (b > 0 && rec.t[b - 1] > t) b--;
  a = Math.max(0, a - warmup);
  if (a === 0 && b === n) return rec;
  const cut = arr => arr.slice(a, b);
  const out = { ...rec, t: cut(rec.t), o: cut(rec.o), h: cut(rec.h), l: cut(rec.l), c: cut(rec.c), vol: cut(rec.vol) };
  out.adj = rec.adj ? { o: cut(rec.adj.o), h: cut(rec.adj.h), l: cut(rec.adj.l), c: cut(rec.adj.c), factor: cut(rec.adj.factor) } : null;
  out.lastDate = out.t.length ? out.t[out.t.length - 1] : null;
  return out;
}

/* loadBars(symbol, {from, to, warmup, allowUnofficial, loadRecord, fetchUnofficial})
   -> { bars, source: 'EOD2'|'CSV'|'YAHOO'|null, datasetId, status, reasons }
   loadRecord(symbol): the record saved in this browser (data.js loadRecord). fetchUnofficial(symbol): downloads from Yahoo. */
export async function loadBars(symbol, o = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  const reasons = [];
  if (ds.snap) {
    const r = await ds.snap.getSeries(sym);
    if (r.ok) return { bars: sliceRecord(recordFromBars(r.meta.symbol, r.bars, 'EOD2'), o), source: 'EOD2', datasetId: ds.snap.id, status: r.meta.status, reasons: r.meta.reasons.map(x => x.code).filter(c => c !== 'OK') };
    reasons.push(r.code);
  } else reasons.push((ds.error && ds.error.code) || 'DATASET_NOT_OPEN');

  const saved = o.loadRecord ? await o.loadRecord(sym) : null;
  const has = saved && saved.t && saved.t.length;
  if (has && IMPORTED.has(saved.source)) return { bars: sliceRecord(saved, o), source: 'CSV', datasetId: null, status: 'UNVERIFIED', reasons };
  if (o.allowUnofficial) {
    if (has && UNOFFICIAL.has(saved.source)) return { bars: sliceRecord(saved, o), source: 'YAHOO', datasetId: null, status: 'UNOFFICIAL', reasons };
    if (o.fetchUnofficial) {
      try { const rec = await o.fetchUnofficial(sym); if (rec && rec.t.length) return { bars: sliceRecord(rec, o), source: 'YAHOO', datasetId: null, status: 'UNOFFICIAL', reasons }; }
      catch (e) { reasons.push('YAHOO_FAILED'); }
    }
  } else if (has && UNOFFICIAL.has(saved.source)) reasons.push('UNOFFICIAL_SOURCE_NOT_ALLOWED');
  return { bars: null, source: null, datasetId: ds.snap ? ds.snap.id : null, status: 'NO_DATA', reasons };
}

/* Short label for headers and reports, e.g. "Official dataset 2026-11-11-r1". */
export function sourceTag(res) {
  if (!res || !res.source) return 'no data';
  return SOURCE_LABEL[res.source] + (res.datasetId ? ' ' + res.datasetId : '');
}
