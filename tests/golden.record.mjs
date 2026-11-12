// Usage: node tests/golden.record.mjs   — (re)writes fixtures/golden/<preset>__<symbol>.json. Run only on purpose.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_DIR, SYMBOLS, PRESET_IDS, runOne } from './golden.lib.mjs';
mkdirSync(GOLDEN_DIR, { recursive: true });
let n = 0, trades = 0;
for (const p of PRESET_IDS) for (const s of SYMBOLS) {
  const g = runOne(p, s); trades += g.trades.length; n++;
  writeFileSync(join(GOLDEN_DIR, `${p}__${s}.json`), JSON.stringify(g));
}
console.log(`recorded ${n} fixtures (${PRESET_IDS.length} presets x ${SYMBOLS.length} symbols), ${trades} trades`);
