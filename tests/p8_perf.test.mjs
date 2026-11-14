// P8 item 1: Nifty 500 x 20 years portfolio run in Node, target < 60 s (PLAN.md §10 P8 gate).
// Reads a local v4 export (default ../../work/v4_p6s2) through the real client + source.js, like the P6 report.
// Silent on success unless --verbose. Writes tests/reports/p8_perf.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
await import('../eod2-client.js');
const S = await import('../source.js');
const PF = await import('../portfolio.js');
const SC = await import('../schemas.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) || join(HERE, '..', '..', 'work', 'v4_p6s2');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT_MS = 60000;
const fetch = async (u) => {
  const p = decodeURIComponent(new URL(u).pathname.slice(1).split('?')[0]).replace(/^data\//, '');
  try { return new Response(readFileSync(join(EXP, p)), { status: 200 }); } catch { return new Response('', { status: 404 }); }
};
globalThis.fetch = fetch;
const fail = (...m) => { console.log('FAIL', ...m); process.exit(1); };

const info = await S.openDataset('http://local.test/', { cache: 'memory', fetch });
if (!info.ok) fail('open', JSON.stringify(info).slice(0, 300));
const man = JSON.parse(readFileSync(join(EXP, 'manifest.json'), 'utf8'));
const eq = Object.entries(man.files).filter(([, f]) => f.kind === 'EQ').map(([s]) => s);
if (eq.length < 450) fail('only', eq.length, 'stocks in the export');
const TO = info.latestSession;
const FROM = (Number(TO.slice(0, 4)) - 20) + TO.slice(4);

const t0 = performance.now();
const many = await S.loadMany(eq, { from: FROM, warmup: 260, loadRecord: async () => null });
const loadMs = performance.now() - t0;
const records = many.records;
const n = Object.keys(records).length;
if (n < 450) fail('loaded', n, 'of', eq.length);

const schema = SC.getPreset('ma_stack');
const t1 = performance.now();
const r = PF.runPortfolio(records, schema, { slots: 20, capital: 1000000, ranking: 'momentum' });
const runMs = performance.now() - t1;
const chk = PF.conservationCheck(r, records);
if (!chk.ok) fail('conservation', JSON.stringify(chk.problems.slice(0, 3)));
const earliestMs = Math.min(...Object.values(records).map(x => x.t[0]));
const earliest = new Date(earliestMs > 1e11 ? earliestMs : earliestMs * 1000).toISOString().slice(0, 10);
const out = { dataset: info.datasetId, from: FROM, to: TO, stocks: n, trades: r.trades.length,
  loadMs: Math.round(loadMs), runMs: Math.round(runMs), limitMs: LIMIT_MS, node: process.version, earliestBar: earliest };
writeFileSync(join(HERE, 'reports', 'p8_perf.json'), JSON.stringify(out, null, 1) + '\n');
if (runMs >= LIMIT_MS) fail('portfolio run took', Math.round(runMs), 'ms >= 60000', JSON.stringify(out));
if (VERBOSE) console.log(JSON.stringify(out));
