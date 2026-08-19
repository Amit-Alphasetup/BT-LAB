/* ============================================================
   BACKTEST LAB — data.js  (Phase 1: Data Layer + Speed Core)
   Plan: MASTER PLAN v2.0, Part C, Phase 1 (C1.1 build order)
   No build step. Load with <script type="module">.
   ============================================================ */

export const DB_NAME = 'btlab';
export const DB_VERSION = 1;
export const STORE_BARS = 'bars';      // key: symbol
export const STORE_META = 'meta';      // key: arbitrary (settings, corrections)

/* ---------- C1.1 #1: IndexedDB wrapper + quota/eviction handling ---------- */

let _dbp = null;

export function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      // Safari private mode throws synchronously
      return reject(new Error('IndexedDB unavailable (private browsing?): ' + e.message));
    }
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE_BARS)) db.createObjectStore(STORE_BARS);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
  return _dbp;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

export async function idbPut(store, key, value) {
  const db = await openDB();
  try {
    return await wrap(tx(db, store, 'readwrite').put(value, key));
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''))) {
      throw new Error('QUOTA_EXCEEDED');
    }
    throw e;
  }
}

export async function idbGet(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, 'readonly').get(key));
}

export async function idbKeys(store) {
  const db = await openDB();
  return wrap(tx(db, store, 'readonly').getAllKeys());
}

export async function idbDelete(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, 'readwrite').delete(key));
}

export async function idbClear(store) {
  const db = await openDB();
  return wrap(tx(db, store, 'readwrite').clear());
}

/* iOS Safari evicts PWA storage after ~7 days of non-use unless persisted. */
export async function ensurePersistence() {
  const out = { supported: false, persisted: false, quota: null, usage: null };
  if (navigator.storage && navigator.storage.persist) {
    out.supported = true;
    try {
      out.persisted = await navigator.storage.persisted();
      if (!out.persisted) out.persisted = await navigator.storage.persist();
    } catch (_) { /* ignore */ }
  }
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      out.quota = est.quota; out.usage = est.usage;
    } catch (_) { /* ignore */ }
  }
  return out;
}

/* ---------- C1.1 #2: stored bar format (typed arrays) ---------- */
/*
  Stored record per symbol:
  {
    v: 1,                       // record format version
    symbol: 'RELIANCE',
    t: Float64Array,            // epoch ms, ascending, unique
    o,h,l,c: Float64Array,      // as-traded prices
    vol: Float64Array,
    adj: { o,h,l,c } | null,    // split-adjusted scale (null until adjustment runs)
    splits: [{date, ratio}],
    dividends: [{date, amount}],
    source: 'yahoo'|'bhavcopy'|'csv'|'seed',
    lastDate: epoch ms,
    downloadedAt: epoch ms,
    flags: []                   // e.g. ['CA_ANOMALY']
  }
  IndexedDB structured-clone preserves TypedArrays natively — no serialization needed.
*/

export function emptyRecord(symbol) {
  return {
    v: 1, symbol,
    t: new Float64Array(0), o: new Float64Array(0), h: new Float64Array(0),
    l: new Float64Array(0), c: new Float64Array(0), vol: new Float64Array(0),
    adj: null, splits: [], dividends: [],
    source: null, lastDate: null, downloadedAt: null, flags: []
  };
}

function concatF64(a, b) {
  const out = new Float64Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

/* Merge new rows [{t,o,h,l,c,vol}] into a record. Dedupes by timestamp, keeps ascending. */
export function mergeRows(rec, rows, source) {
  if (!rows || !rows.length) return rec;
  const existing = new Map();
  for (let i = 0; i < rec.t.length; i++) existing.set(rec.t[i], i);

  const fresh = [];
  for (const r of rows) {
    if (!Number.isFinite(r.t) || !Number.isFinite(r.c)) continue;
    if (existing.has(r.t)) {
      const i = existing.get(r.t);
      rec.o[i] = r.o; rec.h[i] = r.h; rec.l[i] = r.l; rec.c[i] = r.c; rec.vol[i] = r.vol || 0;
    } else {
      fresh.push(r);
    }
  }
  if (fresh.length) {
    fresh.sort((a, b) => a.t - b.t);
    rec.t = concatF64(rec.t, Float64Array.from(fresh.map(r => r.t)));
    rec.o = concatF64(rec.o, Float64Array.from(fresh.map(r => r.o)));
    rec.h = concatF64(rec.h, Float64Array.from(fresh.map(r => r.h)));
    rec.l = concatF64(rec.l, Float64Array.from(fresh.map(r => r.l)));
    rec.c = concatF64(rec.c, Float64Array.from(fresh.map(r => r.c)));
    rec.vol = concatF64(rec.vol, Float64Array.from(fresh.map(r => r.vol || 0)));
    // re-sort whole series if the appended block wasn't strictly after existing data
    if (rec.t.length > 1 && !isAscending(rec.t)) sortRecord(rec);
  }
  rec.source = source || rec.source;
  rec.lastDate = rec.t.length ? rec.t[rec.t.length - 1] : null;
  rec.downloadedAt = Date.now();
  rec.adj = null; // invalidate adjusted scale; recompute on demand
  return rec;
}

function isAscending(t) {
  for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) return false;
  return true;
}

function sortRecord(rec) {
  const idx = Array.from(rec.t.keys()).sort((a, b) => rec.t[a] - rec.t[b]);
  const pick = (arr) => Float64Array.from(idx, i => arr[i]);
  rec.t = pick(rec.t); rec.o = pick(rec.o); rec.h = pick(rec.h);
  rec.l = pick(rec.l); rec.c = pick(rec.c); rec.vol = pick(rec.vol);
}

export async function saveRecord(rec) { return idbPut(STORE_BARS, rec.symbol, rec); }
export async function loadRecord(symbol) { return idbGet(STORE_BARS, symbol); }

/* ---------- C1.1 #3-4: fetch sources + rate-limited waterfall ---------- */

const PROXIES = [
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

/* token bucket per source: max N concurrent, backoff on 429 */
class Limiter {
  constructor(concurrency = 3) {
    this.max = concurrency; this.active = 0; this.q = []; this.penaltyUntil = 0;
  }
  async run(fn) {
    if (this.active >= this.max) await new Promise(r => this.q.push(r));
    const wait = this.penaltyUntil - Date.now();
    if (wait > 0) await sleep(wait);
    this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      const next = this.q.shift(); if (next) next();
    }
  }
  penalize(ms) { this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + ms); }
}

export const limiter = new Limiter(3);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url, { timeout = 30000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status === 429) { const e = new Error('RATE_LIMIT'); e.code = 429; throw e; }
    if (!res.ok) { const e = new Error('HTTP_' + res.status); e.code = res.status; throw e; }
    return await res.text();
  } finally { clearTimeout(timer); }
}

/* Yahoo: full history for one symbol in ONE request — the backfill workhorse. */
export function yahooURL(symbol, { range = '25y', interval = '1d', suffix = '.NS' } = {}) {
  const t = encodeURIComponent(symbol + suffix);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${t}` +
         `?range=${range}&interval=${interval}&events=div%2Csplit`;
}

export function parseYahoo(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r) throw new Error('YAHOO_EMPTY');
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close ? q.close[i] : null;
    if (c == null) continue;                       // Yahoo emits nulls on halts
    rows.push({
      t: ts[i] * 1000,
      o: q.open?.[i] ?? c, h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c, c, vol: q.volume?.[i] ?? 0
    });
  }
  const ev = r.events || {};
  const splits = Object.values(ev.splits || {}).map(s => ({
    date: s.date * 1000,
    ratio: (s.numerator && s.denominator) ? (s.numerator / s.denominator)
         : parseRatio(s.splitRatio)
  }));
  const dividends = Object.values(ev.dividends || {}).map(d => ({
    date: d.date * 1000, amount: d.amount
  }));
  return { rows, splits, dividends };
}

function parseRatio(str) {
  if (!str) return 1;
  const m = String(str).split(/[:\/]/);
  return m.length === 2 ? Number(m[0]) / Number(m[1]) : 1;
}

/* Try direct, then each proxy, with backoff. Returns parsed JSON. */
export async function fetchYahoo(symbol, opts = {}) {
  const url = yahooURL(symbol, opts);
  const candidates = [url, ...PROXIES.map(p => p(url))];
  let lastErr = null;
  for (const cand of candidates) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const txt = await limiter.run(() => fetchText(cand));
        return JSON.parse(txt);
      } catch (e) {
        lastErr = e;
        if (e.code === 429) { limiter.penalize(Math.min(60000, 2000 * Math.pow(2, attempt))); }
        else if (attempt === 0) { await sleep(500); }
        else break;
      }
    }
  }
  throw lastErr || new Error('FETCH_FAILED');
}

/* ---------- Bhavcopy: one file = whole market for one day (top-up path) ---------- */

/* NSE's own URL. Often blocked without cookies -> proxy attempt, then manual fallback. */
export function bhavcopyURL(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ymd}.csv`;
}

/* Parses sec_bhavdata_full CSV. Header names are space-padded in NSE's file. */
export function parseBhavcopy(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('BHAV_EMPTY');
  const head = lines[0].split(',').map(s => s.trim().toUpperCase());
  const col = (name) => head.indexOf(name);
  const iSym = col('SYMBOL'), iSer = col('SERIES'), iDate = col('DATE1');
  const iO = col('OPEN_PRICE'), iH = col('HIGH_PRICE'), iL = col('LOW_PRICE');
  const iC = col('CLOSE_PRICE'), iV = col('TTL_TRD_QNTY');
  if (iSym < 0 || iC < 0) throw new Error('BHAV_FORMAT');

  const out = new Map();   // symbol -> row
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',').map(s => s.trim());
    // Tolerate column-count drift: require only the fields we actually read.
    const needed = Math.max(iSym, iSer, iDate, iO, iH, iL, iC, iV);
    if (f.length <= needed) continue;
    const series = (f[iSer] || '').toUpperCase();
    if (series !== 'EQ' && series !== 'BE') continue;     // equities only
    const t = parseBhavDate(f[iDate]);
    if (!t) continue;
    const c = Number(f[iC]);
    if (!Number.isFinite(c)) continue;
    out.set(f[iSym], {
      t, o: Number(f[iO]) || c, h: Number(f[iH]) || c,
      l: Number(f[iL]) || c, c, vol: Number(f[iV]) || 0
    });
  }
  return out;
}

/* NSE writes dates as "01-Aug-2026" */
const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
export function parseBhavDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) { const d = Date.parse(s); return Number.isFinite(d) ? d : null; }
  const mo = MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return null;
  return Date.UTC(Number(m[3]), mo, Number(m[1]));
}

export async function fetchBhavcopy(date) {
  const url = bhavcopyURL(date);
  const candidates = [...PROXIES.map(p => p(url)), url];
  let lastErr = null;
  for (const cand of candidates) {
    try {
      const txt = await limiter.run(() => fetchText(cand));
      if (/^\s*</.test(txt)) throw new Error('BHAV_HTML');   // got a block page
      return parseBhavcopy(txt);
    } catch (e) { lastErr = e; }
  }
  const err = lastErr || new Error('BHAV_FAILED');
  err.manualURL = url;      // UI shows this so you can download it by hand
  throw err;
}

/* ---------- C1.1 #6: manual file import (CSV / bhavcopy / generic OHLCV) ---------- */

export function parseGenericCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const head = lines[0].split(',').map(s => s.trim().toLowerCase());
  const find = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iD = find('date','timestamp','date1');
  const iO = find('open','open_price'), iH = find('high','high_price');
  const iL = find('low','low_price'), iC = find('close','close_price','adj close');
  const iV = find('volume','ttl_trd_qnty');
  if (iD < 0 || iC < 0) throw new Error('CSV_FORMAT');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',').map(s => s.trim());
    const t = parseBhavDate(f[iD]) ?? Date.parse(f[iD]);
    const c = Number(f[iC]);
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
    rows.push({ t, o: Number(f[iO]) || c, h: Number(f[iH]) || c, l: Number(f[iL]) || c, c, vol: Number(f[iV]) || 0 });
  }
  return rows;
}

/* ---------- C1.1 #8: corporate-action sanity tripwire ---------- */

export function detectAnomalies(rec, { threshold = 0.40 } = {}) {
  const hits = [];
  const splitDays = new Set(rec.splits.map(s => dayKey(s.date)));
  for (let i = 1; i < rec.c.length; i++) {
    const prev = rec.c[i - 1], cur = rec.c[i];
    if (!prev) continue;
    const move = Math.abs(cur - prev) / prev;
    if (move > threshold && !splitDays.has(dayKey(rec.t[i]))) {
      hits.push({ date: rec.t[i], from: prev, to: cur, move });
    }
  }
  return hits;
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ---------- C1.1 #9: split adjustment (dual scale) ---------- */
/* Indicators run on adjusted scale; order prices come from as-traded. */
export function buildAdjusted(rec) {
  const n = rec.t.length;
  const factor = new Float64Array(n).fill(1);
  const splits = [...rec.splits].sort((a, b) => b.date - a.date);
  for (const s of splits) {
    if (!s.ratio || s.ratio === 1) continue;
    for (let i = 0; i < n; i++) if (rec.t[i] < s.date) factor[i] /= s.ratio;
  }
  const scale = (arr) => { const out = new Float64Array(n); for (let i = 0; i < n; i++) out[i] = arr[i] * factor[i]; return out; };
  rec.adj = { o: scale(rec.o), h: scale(rec.h), l: scale(rec.l), c: scale(rec.c), factor };
  return rec;
}

/* ---------- C1.1 #7: incremental top-up + freshness ---------- */

export function tradingDaysStale(lastDate, now = Date.now()) {
  if (!lastDate) return Infinity;
  let days = 0;
  const d = new Date(lastDate);
  while (d.getTime() < now - 86400000) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

/* ---------- Bulk downloader with checkpoint/resume ---------- */

const CKPT_KEY = 'bulk_checkpoint';

export async function bulkDownload(symbols, { onProgress, resume = true, opts = {} } = {}) {
  let done = new Set();
  if (resume) {
    const ck = await idbGet(STORE_META, CKPT_KEY);
    if (ck && ck.list === symbols.join(',')) done = new Set(ck.done);
  }
  const failed = [];
  for (const sym of symbols) {
    if (done.has(sym)) { onProgress?.({ symbol: sym, status: 'cached', done: done.size, total: symbols.length }); continue; }
    try {
      const json = await fetchYahoo(sym, opts);
      const { rows, splits, dividends } = parseYahoo(json);
      let rec = (await loadRecord(sym)) || emptyRecord(sym);
      rec.splits = splits; rec.dividends = dividends;
      rec = mergeRows(rec, rows, 'yahoo');
      buildAdjusted(rec);
      const anomalies = detectAnomalies(rec);
      rec.flags = anomalies.length ? ['CA_ANOMALY'] : [];
      rec.anomalies = anomalies;
      await saveRecord(rec);
      done.add(sym);
      await idbPut(STORE_META, CKPT_KEY, { list: symbols.join(','), done: [...done], at: Date.now() });
      onProgress?.({ symbol: sym, status: 'ok', bars: rec.t.length, flags: rec.flags, done: done.size, total: symbols.length });
    } catch (e) {
      failed.push({ symbol: sym, error: e.message });
      onProgress?.({ symbol: sym, status: 'fail', error: e.message, done: done.size, total: symbols.length });
    }
  }
  return { done: [...done], failed };
}

export async function clearCheckpoint() { return idbDelete(STORE_META, CKPT_KEY); }

/* ---------- C1.1 #5: seed archive export/import ---------- */

export async function exportSeed(symbols) {
  const list = symbols || await idbKeys(STORE_BARS);
  const payload = { format: 'btlab-seed', v: 1, createdAt: Date.now(), symbols: {} };
  for (const sym of list) {
    const rec = await loadRecord(sym);
    if (!rec) continue;
    payload.symbols[sym] = {
      t: Array.from(rec.t), o: Array.from(rec.o), h: Array.from(rec.h),
      l: Array.from(rec.l), c: Array.from(rec.c), vol: Array.from(rec.vol),
      splits: rec.splits, dividends: rec.dividends, source: rec.source
    };
  }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function importSeed(jsonText) {
  const payload = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  if (payload.format !== 'btlab-seed') throw new Error('SEED_FORMAT');
  let count = 0;
  for (const [sym, s] of Object.entries(payload.symbols)) {
    const rec = emptyRecord(sym);
    rec.t = Float64Array.from(s.t); rec.o = Float64Array.from(s.o);
    rec.h = Float64Array.from(s.h); rec.l = Float64Array.from(s.l);
    rec.c = Float64Array.from(s.c); rec.vol = Float64Array.from(s.vol);
    rec.splits = s.splits || []; rec.dividends = s.dividends || [];
    rec.source = 'seed'; rec.lastDate = rec.t.length ? rec.t[rec.t.length - 1] : null;
    rec.downloadedAt = Date.now();
    buildAdjusted(rec);
    await saveRecord(rec);
    count++;
  }
  return count;
}

/* ---------- Universe (ported tiers) ---------- */
export const NIFTY_50 = ['RELIANCE','HDFCBANK','ICICIBANK','INFY','TCS','ITC','LT','SBIN','BHARTIARTL','AXISBANK','KOTAKBANK','HINDUNILVR','BAJFINANCE','ASIANPAINT','MARUTI','TITAN','SUNPHARMA','ULTRACEMCO','WIPRO','NESTLEIND','ONGC','NTPC','POWERGRID','TATAMOTORS','TATASTEEL','JSWSTEEL','ADANIENT','ADANIPORTS','HCLTECH','TECHM','GRASIM','CIPLA','DRREDDY','BAJAJFINSV','BAJAJ-AUTO','HEROMOTOCO','EICHERMOT','BRITANNIA','COALINDIA','DIVISLAB','APOLLOHOSP','HINDALCO','INDUSINDBK','SBILIFE','HDFCLIFE','BPCL','TATACONSUM','LTIM','SHRIRAMFIN','TRENT'];
