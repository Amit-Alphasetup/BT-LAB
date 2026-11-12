// Re-runs every preset x symbol and compares with the recorded golden fixtures. Silent on success.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_DIR, SYMBOLS, PRESET_IDS, runOne } from './golden.lib.mjs';
const fail = m => { console.log('GOLDEN FAIL: ' + m); process.exit(1); };
if (PRESET_IDS.length !== 14) fail(`expected 14 presets, found ${PRESET_IDS.length}`);
if (SYMBOLS.length !== 3) fail(`expected 3 bar files, found ${SYMBOLS.length}`);
let n = 0, withTrades = 0;
for (const p of PRESET_IDS) for (const s of SYMBOLS) {
  const f = join(GOLDEN_DIR, `${p}__${s}.json`);
  if (!existsSync(f)) fail(`missing fixture ${p}__${s}`);
  const want = JSON.parse(readFileSync(f, 'utf8')), got = JSON.parse(JSON.stringify(runOne(p, s)));
  for (const k of Object.keys(want.stats)) if (want.stats[k] !== got.stats[k]) fail(`${p} ${s} stats.${k}: want ${want.stats[k]} got ${got.stats[k]}`);
  if (want.trades.length !== got.trades.length) fail(`${p} ${s} trade count: want ${want.trades.length} got ${got.trades.length}`);
  for (let i = 0; i < want.trades.length; i++) if (JSON.stringify(want.trades[i]) !== JSON.stringify(got.trades[i])) fail(`${p} ${s} trade ${i}: want ${JSON.stringify(want.trades[i])} got ${JSON.stringify(got.trades[i])}`);
  if (want.skipped !== got.skipped) fail(`${p} ${s} skipped: want ${want.skipped} got ${got.skipped}`);
  n++; if (want.trades.length) withTrades++;
}
if (withTrades < 30) fail(`only ${withTrades} of ${n} fixtures have trades - fixtures look empty`);
console.log(`golden ok: ${n} runs, ${withTrades} with trades`);
