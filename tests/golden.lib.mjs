// Golden fixtures for the v1 engine: every preset in schemas.js on 3 ETF series, run exactly as ui.js runs it
// (record built the way data.js builds one, runBacktest(rec, schema, { raw: false })).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBacktest } from '../engine.js';
import { PRESETS, getPreset } from '../schemas.js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const BARS_DIR = join(HERE, 'fixtures', 'bars');
export const GOLDEN_DIR = join(HERE, 'fixtures', 'golden');
export const SYMBOLS = readdirSync(BARS_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
export const PRESET_IDS = PRESETS.map(p => p.id);

const day = ms => new Date(ms).toISOString().slice(0, 10);
const r6 = x => (typeof x === 'number' && Number.isFinite(x)) ? Math.round(x * 1e6) / 1e6 : (typeof x === 'number' ? null : x);

export function loadRecord(symbol) {
  const d = JSON.parse(readFileSync(join(BARS_DIR, symbol + '.json'), 'utf8'));
  const col = k => Float64Array.from(d.bars, r => r[k]);
  return { v: 1, symbol, t: Float64Array.from(d.bars, r => Date.parse(r[0] + 'T00:00:00Z')), o: col(1), h: col(2), l: col(3), c: col(4), vol: col(5),
    adj: null, splits: [], dividends: [], source: 'seed', lastDate: null, downloadedAt: null, flags: [] };
}

export function runOne(presetId, symbol, record) {
  const res = runBacktest(record || loadRecord(symbol), getPreset(presetId), { raw: false });
  const stats = {}; for (const [k, v] of Object.entries(res.stats)) stats[k] = r6(v);
  return { preset: presetId, symbol, stats, skipped: res.skipped.length,
    trades: res.trades.map(t => [day(t.entryDate), r6(t.entryPrice), day(t.exitDate), r6(t.exitPrice), t.qty]) };
}
