// P6: point-in-time universes. universe.js on the real ref/membership.json (from the v4 export) + portfolio.js trading only members,
// exit-at-removal vs hold, refusal before the start date, sells on a day without a bar carried (no hang). Silent on success.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const U = await import('../universe.js');
const PF = await import('../portfolio.js');
const HERE = dirname(fileURLToPath(import.meta.url));
const fail = m => { console.log('P6 FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };

// ── real membership (built by market-data) ──
const EXP = process.env.P6_EXPORT || join(HERE, '..', '..', 'work', 'v4_p6s2');
const refPath = join(EXP, 'ref', 'membership.json');
ok(existsSync(refPath), 'no export at ' + EXP);
const json = JSON.parse(readFileSync(refPath, 'utf8')), files = JSON.parse(readFileSync(join(EXP, 'manifest.json'), 'utf8')).files;
const model = U.buildModel(json, files);
ok(U.listIndices(model).map(x => x.name).join('|') === 'NIFTY 100|NIFTY 50|NIFTY NEXT 50', 'indices');
for (const [name, ix] of Object.entries(json.indices)) {
  for (const [mon, n] of Object.entries(ix.checks.sampleCounts)) {
    const r = U.membersOn(model, name, mon + '-15');   // documented extra lines (DVR, demerger stubs) are on top of the index size
    const extra = Object.entries(json.extraLines).filter(([s, [a, b]]) => a <= mon && mon <= b && r.symbols.includes(s)).length;
    ok(r.ok && r.symbols.length - extra === n && n === ix.size, `${name} ${mon}: ${r.symbols && r.symbols.length} (-${extra}) != ${n}`);
  }
}
const n100 = U.membersOn(model, 'NIFTY 100', '2018-06-15').symbols, n50 = U.membersOn(model, 'NIFTY 50', '2018-06-15').symbols, nx = U.membersOn(model, 'NIFTY NEXT 50', '2018-06-15').symbols;
ok(n100.join() === [...new Set([...n50, ...nx])].sort().join(), 'Nifty 100 = 50 + Next 50 on a sample day');
const today = readFileSync(join(HERE, '..', '..', 'ind_nifty500list.csv'), 'utf8');   // sanity only: every Nifty 50 member today is a Nifty 500 stock
for (const s of U.membersOn(model, 'NIFTY 50', '2026-10-15').symbols) ok(today.includes(',' + s + ','), s + ' (Nifty 50 today) not in the Nifty 500 list');

// refusals
let r = U.membersOn(model, 'NIFTY 50', '2009-12-31');
ok(!r.ok && r.code === 'BEFORE_START' && r.message.includes('2010-01-01'), 'before start refused with the date');
r = U.universeFor(model, 'NIFTY 200', '2015-01-01');
ok(!r.ok && r.code === 'INDEX_NOT_AVAILABLE' && /no monthly constituent source/.test(r.message), 'Nifty 200 not built, says why');
ok(U.universeFor(model, 'NIFTY 50', '2015-02-01', '2015-01-01').code === 'BAD_DATE', 'end before start refused');

// universeFor: union over the window, and isMember per day
const u = U.universeFor(model, 'NIFTY 50', '2010-01-01', '2026-10-31');
ok(u.ok && u.symbols.length > 50 && u.symbols.length < 200, 'universe union size ' + u.symbols.length);
const gone = json.indices['NIFTY 50'].intervals.find(v => v.to && v.to < '2020-01-01' && files[v.symbol]);
ok(gone, 'a removed member with data exists');
const t = d => Date.parse(d + 'T00:00:00Z'), iso = x => new Date(x).toISOString().slice(0, 10);
const ivs = json.indices['NIFTY 50'].intervals.filter(v => v.symbol === gone.symbol);
const inAny = d => ivs.some(v => v.from <= d && (!v.to || d <= v.to));
const after = iso(t(gone.to) + 86400000);
ok(u.isMember(gone.symbol, t(gone.to)) && u.isMember(gone.symbol, t(gone.from)), 'member on its first and last day');
ok(u.isMember(gone.symbol, t(after)) === inAny(after), 'day after removal follows the intervals');
ok(!u.isMember(gone.symbol, t('2009-12-31')), 'nothing is a member before the start date');
const missing = U.pastMembersWithoutData(model, files);
ok(missing.length >= 20 && missing.some(m => m.symbol === 'RANBAXY') && !missing.some(m => m.symbol === 'RELIANCE'), 'past members without data: ' + missing.length);

// ── portfolio: trade only while a member ──
const DAYS = [];
for (let d = t('2020-01-01'); DAYS.length < 60; d += 86400000) { const w = new Date(d).getUTCDay(); if (w && w < 6) DAYS.push(d); }
const rec = (sym, skip = new Set()) => {
  const tt = DAYS.filter((_, i) => !skip.has(i)), n = tt.length, c = Float64Array.from(tt, (_, i) => 100 + i);
  return { v: 1, symbol: sym, t: Float64Array.from(tt), o: c, h: c, l: c, c, vol: new Float64Array(n).fill(1e9), adj: null, splits: [], dividends: [] };
};
const schema = { id: 'p6', label: 'p6', indicators: [], entry: { join: 'ALL', conditions: [['gt', 'close', 0]] }, exit: { accounting: 'FIFO', condition: ['lt', 'close', 0] }, costs: { preset: 'none' } };

const mk = (from, to) => ({ index: 'TEST', startDate: iso(DAYS[0]), isMember: (s, x) => s === 'AAA' ? x >= DAYS[from] && x <= DAYS[to] : s === 'BBB' });
const recs = () => ({ AAA: rec('AAA'), BBB: rec('BBB'), CCC: rec('CCC') });
const free = PF.runPortfolio(recs(), schema, { slots: 3, capital: 300000 });
ok(new Set(free.trades.map(x => x.symbol)).size === 3, 'no membership: all 3 trade');
const ex = PF.runPortfolio(recs(), schema, { slots: 3, capital: 300000, membership: mk(10, 30), onRemoval: 'exit' });
const aaa = ex.trades.filter(x => x.symbol === 'AAA');
ok(!ex.trades.some(x => x.symbol === 'CCC'), 'never a member: never traded');
const entryOf = x => x.entryTime ?? x.entryDate ?? x.entry?.t ?? x.buyDate, exitOf = x => x.exitTime ?? x.exitDate ?? x.exit?.t ?? x.sellDate;
ok(aaa.length && aaa.every(x => +entryOf(x) > DAYS[10] && +entryOf(x) <= DAYS[31]), 'AAA bought only after it joined: ' + aaa.map(x => iso(+entryOf(x))));
const rem = aaa.find(x => (x.exitReason || x.reason) === 'index_removal');
ok(rem && +exitOf(rem) === DAYS[32], 'AAA sold at the open after its last member day: ' + JSON.stringify(aaa.map(x => [x.exitReason || x.reason, iso(+exitOf(x))])));
ok(ex.portfolio.membership && ex.portfolio.membership.onRemoval === 'exit', 'result records the membership option');
const hold = PF.runPortfolio(recs(), schema, { slots: 3, capital: 300000, membership: mk(10, 30), onRemoval: 'hold' });
const aaaH = hold.trades.filter(x => x.symbol === 'AAA');
ok(aaaH.length && !aaaH.some(x => (x.exitReason || x.reason) === 'index_removal') && aaaH.some(x => (x.exitReason || x.reason) === 'end_of_data'), 'hold: kept to the end');
ok(PF.conservationCheck(ex, recs()).ok && PF.conservationCheck(hold, recs()).ok, 'books balance');

// a sell due on a day without a bar is carried to the next bar (used to loop forever)
const gap = { AAA: rec('AAA', new Set([32, 33, 34])), BBB: rec('BBB') };
const g = PF.runPortfolio(gap, schema, { slots: 2, capital: 200000, membership: mk(10, 30), onRemoval: 'exit' });
const gr = g.trades.find(x => x.symbol === 'AAA' && (x.exitReason || x.reason) === 'index_removal');
ok(gr && +exitOf(gr) === DAYS[35] && Number.isFinite(g.equity[g.equity.length - 1]), 'carried sell fills at the next bar');
