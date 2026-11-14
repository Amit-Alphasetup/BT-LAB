// P8 item 6 (Node half): 3 saved runs reproduce byte-identically from their fingerprints.
// A saved run = the fingerprint inputs (datasetId, symbol, strategy, options) + the fingerprint + sha256 of the result
// (trades, equity, stats as JSON). This re-runs each from its inputs on the same dataset and compares both hashes.
//   node tests/p8_repro.test.mjs [exportDir]            check (silent on success)
//   node tests/p8_repro.test.mjs [exportDir] --record   write tests/fixtures/p8_saved_runs.json (once)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
await import('../eod2-client.js');
const S = await import('../source.js');
const E = await import('../engine.js');
const BD = await import('../presets-btdesk.js');
const SC = await import('../schemas.js');
const X = await import('../extras.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const EXP = args.find(a => !a.startsWith('--')) || join(HERE, '..', '..', 'work', 'v4_p6s2');
const FIX = join(HERE, 'fixtures', 'p8_saved_runs.json');
const fail = (...m) => { console.log('FAIL', ...m); process.exit(1); };
const fetch = async (u) => {
  const p = decodeURIComponent(new URL(u).pathname.slice(1).split('?')[0]).replace(/^data\//, '');
  try { return new Response(readFileSync(join(EXP, p)), { status: 200 }); } catch { return new Response('', { status: 404 }); }
};
globalThis.fetch = fetch;
const info = await S.openDataset('http://local.test/', { cache: 'memory', fetch });
if (!info.ok) fail('open', JSON.stringify(info).slice(0, 200));

const arr = v => (v && typeof v === 'object' && ArrayBuffer.isView(v)) ? Array.from(v) : v;
const digest = res => crypto.createHash('sha256').update(JSON.stringify({ trades: res.trades, equity: arr(res.equity), stats: res.stats },
  (k, v) => arr(v))).digest('hex');

async function run(saved) {
  const got = await S.loadBars(saved.symbol, { loadRecord: async () => null });
  if (got.source !== 'EOD2' || got.datasetId !== saved.datasetId) return { problem: `${saved.symbol}: dataset ${got.datasetId} (${got.source}), saved run used ${saved.datasetId}` };
  const raw = !!saved.options.raw;
  const res = saved.strategy.btdesk ? BD.runBtdesk(got.bars, saved.strategy.btdesk, saved.strategy.params, { raw })
    : E.runBacktest(got.bars, saved.strategy, { raw });
  const fp = await X.fingerprint({ datasetId: got.datasetId, symbol: got.bars.symbol, strategy: saved.strategy, options: { raw } });
  return { fp, result: digest(res), trades: res.trades.length };
}

if (args.includes('--record')) {
  if (existsSync(FIX)) fail(FIX, 'exists; delete it by hand to re-record');
  const bd = BD.BTDESK_PRESETS[0].id;
  const specs = [
    { symbol: 'RELIANCE', strategy: SC.getPreset('ma_stack'), options: { raw: false } },
    { symbol: 'INFY', strategy: { btdesk: bd, params: { perTxAmount: 5000, maxBuys: 5 } }, options: { raw: false } },
    { symbol: 'NIFTYBEES', strategy: SC.getPreset('golden_cross'), options: { raw: true } },
  ];
  const runs = [];
  for (const s of specs) {
    const saved = { ...s, datasetId: info.datasetId };
    const r = await run(saved);
    if (r.problem) fail(r.problem);
    if (!(r.trades > 0)) fail(s.symbol, 'no trades');
    runs.push({ ...saved, fingerprint: r.fp, resultSha256: r.result, trades: r.trades });
  }
  writeFileSync(FIX, JSON.stringify({ engine: X.ENGINE_VERSION, recordedOn: process.version, runs }, null, 1) + '\n');
  console.log('recorded', runs.map(r => `${r.symbol} ${r.fingerprint.slice(0, 12)} ${r.trades} trades`).join(' | '));
} else {
  const fx = JSON.parse(readFileSync(FIX, 'utf8'));
  if (fx.runs.length !== 3) fail('need 3 saved runs');
  for (const saved of fx.runs) {
    const r = await run(saved);
    if (r.problem) fail(r.problem);
    if (r.fp !== saved.fingerprint) fail(saved.symbol, 'fingerprint differs', r.fp, saved.fingerprint);
    if (r.result !== saved.resultSha256) fail(saved.symbol, 'result differs', r.result, saved.resultSha256);
  }
}
