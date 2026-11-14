// P6 step 6: survivorship report. 3 presets x 3 indices (Nifty 50, Next 50, 100), 2010-01-01 .. latest session:
//  A = TODAY's members applied to the whole period (survivorship-biased), B = point-in-time, sell at removal, C = point-in-time, hold.
// Reads a local v4 export (default ../../../work/v4_p6s2) through the real client + source.js. Writes p6_survivorship.{json,md} here.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
await import('../../eod2-client.js');
const S = await import('../../source.js');
const U = await import('../../universe.js');
const PF = await import('../../portfolio.js');
const SC = await import('../../schemas.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = process.argv[2] || join(HERE, '..', '..', '..', 'work', 'v4_p6s2');
const BASE = 'http://local.test/';
const fetch = async (u) => {
  const p = decodeURIComponent(new URL(u).pathname.slice(1).split('?')[0]).replace(/^data\//, '');
  try { const b = readFileSync(join(EXP, p)); return new Response(b, { status: 200 }); } catch { return new Response('', { status: 404 }); }
};
globalThis.fetch = fetch;
const info = await S.openDataset(BASE, { cache: 'memory', fetch });
if (!info.ok) { console.log('open failed', info); process.exit(1); }
const model = await S.loadMembership(fetch);
if (!model.ok) { console.log('membership failed', model); process.exit(1); }

const FROM = '2010-01-01', TO = info.latestSession, PRESETS = ['ma_stack', 'golden_cross', 'high52w'], INDICES = ['NIFTY 50', 'NIFTY NEXT 50', 'NIFTY 100'];
const opts = { slots: 10, capital: 500000, ranking: 'momentum' };
const rows = [];
for (const index of INDICES) {
  const pit = U.universeFor(model, index, FROM, TO); pit.index = index;
  const todayList = U.membersOn(model, index, TO).symbols;
  const all = [...new Set([...pit.symbols, ...todayList])];
  const many = await S.loadMany(all, { from: FROM, warmup: 260, loadRecord: async () => null });
  const recs = syms => Object.fromEntries(syms.filter(s => many.records[s]).map(s => [s, many.records[s]]));
  const missing = pit.symbols.filter(s => !many.records[s]);
  // A: today's list, but no trades before FROM either (warm-up only), same as B/C
  const fromOnly = { isMember: (s, t) => t >= Date.parse(FROM + 'T00:00:00Z'), index, startDate: FROM };
  for (const id of PRESETS) {
    const schema = SC.getPreset(id);
    const run = (label, records, extra) => {
      const r = PF.runPortfolio(records, schema, { ...opts, ...extra });
      const chk = PF.conservationCheck(r, records);
      if (!chk.ok) { console.log('conservation failed', index, id, label, chk.problems.slice(0, 3)); process.exit(1); }
      const st = r.stats;
      rows.push({ index, preset: id, run: label, symbols: Object.keys(records).length, trades: r.trades.length,
        removalSells: r.trades.filter(x => (x.exitReason || x.reason) === 'index_removal').length,
        cagr: +st.cagr.toFixed(2), maxDD: +st.maxDD.toFixed(2), finalEquity: Math.round(st.finalEquity) });
    };
    run('A today-list', recs(todayList), { membership: fromOnly, onRemoval: 'hold' });
    run('B pit-exit', recs(pit.symbols), { membership: pit, onRemoval: 'exit' });
    run('C pit-hold', recs(pit.symbols), { membership: pit, onRemoval: 'hold' });
  }
  rows.push({ index, missingNoData: missing });
}

const out = { dataset: info.datasetId, from: FROM, to: TO, options: opts, rows };
writeFileSync(join(HERE, 'p6_survivorship.json'), JSON.stringify(out, null, 1) + '\n');
const md = [`# P6 survivorship report`, ``, `Dataset ${info.datasetId}, ${FROM} .. ${TO}, 10 slots, Rs 5,00,000, ranking momentum, Zerodha delivery costs.`,
  `A = today's members over the whole period (biased) · B = point-in-time, sell at the next open after removal · C = point-in-time, hold until the strategy sells.`, ``,
  `| Index | Preset | Run | Symbols | Trades | Removal sells | CAGR % | Max DD % | Final Rs |`, `|---|---|---|---|---|---|---|---|---|`,
  ...rows.filter(r => r.preset).map(r => `| ${r.index} | ${r.preset} | ${r.run} | ${r.symbols} | ${r.trades} | ${r.removalSells} | ${r.cagr} | ${r.maxDD} | ${r.finalEquity.toLocaleString('en-IN')} |`), ``,
  ...rows.filter(r => r.missingNoData).map(r => `- ${r.index}: ${r.missingNoData.length} past members with no price data (not tradable in B/C): ${r.missingNoData.join(', ') || 'none'}`), ``];
writeFileSync(join(HERE, 'p6_survivorship.md'), md.join('\n'));
console.log(md.slice(5, -1).join('\n'));
