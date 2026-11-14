// P5 (session 1): AlphaDesk bridge — deep-link round trip, ledger reader (browser storage, full backup file, LIFO ledger CSV),
// Market Bridge address, round trips from fills, "actual vs backtest". Writes tests/fixtures/p5_crosscheck.json for the Python check.
// The sample export is SYNTHETIC, shaped like AlphaDesk's exportFullBackup / exportLifoCSV output. Silent on success.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as AB from '../alphadesk-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fail = m => { console.log('P5 FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ───────────── deep link ─────────────
const P = { start: '2019-01-14', end: '2026-11-12', slots: '40', avgFall: '6', minProfit: '200', maxLots: '3', scanTopN: '10', compound: true, liquidRate: '6' };
const link = AB.encodeLink({ preset: 'lifo', sym: 'M&M', params: P }, '../BT-LAB/');
ok(link.startsWith('../BT-LAB/?from=alphadesk&preset=lifo&sym=M%26M&p='), 'link shape: ' + link);
ok(!/[+/=]/.test(link.split('&p=')[1]), 'p must be base64url');
const back = AB.parseLink(link.slice(link.indexOf('?')));
eq(back, { ok: true, from: 'alphadesk', preset: 'lifo', sym: 'M&M', params: P }, 'round trip');
// exactly what AlphaDesk's link builds: btoa(JSON) made url-safe
const adP = Buffer.from(JSON.stringify(P)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
eq(AB.parseLink('?from=alphadesk&preset=lifo&sym=&p=' + adP), { ok: true, from: 'alphadesk', preset: 'lifo', sym: '', params: P }, 'AlphaDesk-built link');
eq(AB.parseLink('?from=alphadesk&preset=lifo'), { ok: true, from: 'alphadesk', preset: 'lifo', sym: '', params: {} }, 'link with no params');
ok(AB.parseLink('').ok === false && AB.parseLink('?preset=lifo').ok === false, 'not from AlphaDesk -> not a hand-off');
const bad = AB.parseLink('?from=alphadesk&preset=dm&p=%%%not-base64');
ok(bad.ok === true && bad.preset === 'dm' && bad.error && JSON.stringify(bad.params) === '{}', 'broken p is reported, never thrown');
const uni = AB.parseLink(AB.encodeLink({ preset: 'tenet', sym: 'GOLDBEES', params: { note: '₹ ok — yes' } }).replace(/^[^?]*/, ''));
ok(uni.params.note === '₹ ok — yes', 'non-ASCII params survive');
ok(AB.parseLink('?from=alphadesk&preset=<script>&sym=a b').preset === '' && AB.parseLink('?from=alphadesk&sym=nifty%2050').sym === 'NIFTY 50', 'preset id is sanitised, symbol upper-cased');

// ───────────── ledger: three sources ─────────────
const LIFO = [
  { id: 'b1', date: '2024-01-10', sym: 'NIFTYBEES', type: 'BUY', qty: 100, price: 240.5, turn: 24050, friction: 30, lifoProfit: 0, avgBuy: 0, linkedBuyId: '', reason: '' },
  { id: 'b2', date: '2024-02-01', sym: 'NIFTYBEES', type: 'BUY', qty: 60, price: 228.25, turn: 13695, friction: 28, linkedBuyId: '', reason: 'avg' },
  { id: 'b3', date: '2024-02-05', sym: 'GOLDBEES', type: 'BUY', qty: 200, price: 52.1, linkedBuyId: '', reason: '' },
  { id: 's1', date: '2024-02-20', sym: 'NIFTYBEES', type: 'SELL', qty: 60, price: 241.75, linkedBuyId: 'b2', reason: 'target' },
  { id: 's2', date: '2024-03-15', sym: 'NIFTYBEES', type: 'SELL', qty: 40, price: 251.0, linkedBuyId: '', reason: 'target' },      // no link: latest open lot first (b1), partial
  { id: 'x', date: 'bad', sym: 'NIFTYBEES', type: 'BUY', qty: 0, price: 0 },                                                         // unusable row is dropped and counted
];
const DM = [{ id: 'm1', date: '2024-04-01', etf: 'JUNIORBEES', type: 'BUY', units: 30, price: 610.4 }, { id: 'm2', date: '2024-05-02', etf: 'JUNIORBEES', type: 'SELL', units: 30, price: 655.15, pnl: 1342.5 }];
const STATE = { lifoLedger: LIFO, momTrades: DM, config: { marketBridgeUrl: 'https://alphadesk.example.workers.dev/', capital: 157731 }, _rev: 7 };
const store = txt => ({ getItem: k => (k === 'alphadesk_v1' ? txt : null), setItem() { throw new Error('the bridge must never write'); }, removeItem() { throw new Error('the bridge must never write'); } });

const L = AB.readLedger(store(JSON.stringify(STATE)));
ok(L.ok && L.fills.length === 7 && L.dropped === 1, 'storage read: ' + JSON.stringify({ ok: L.ok, n: L.fills && L.fills.length, d: L.dropped }));
eq(L.fills[0], { book: 'LIFO', date: '2024-01-10', symbol: 'NIFTYBEES', type: 'BUY', qty: 100, price: 240.5, id: 'b1', linkedBuyId: '' }, 'LIFO fill shape');
eq(L.fills[6], { book: 'DM', date: '2024-05-02', symbol: 'JUNIORBEES', type: 'SELL', qty: 30, price: 655.15, id: 'm2', linkedBuyId: '' }, 'DM fill shape');
eq(L.symbols, ['GOLDBEES', 'JUNIORBEES', 'NIFTYBEES'], 'symbols');
ok(AB.marketBridgeUrl(store(JSON.stringify(STATE))) === 'https://alphadesk.example.workers.dev', 'bridge address, no trailing slash');
ok(AB.marketBridgeUrl(store(null)) === '' && AB.marketBridgeUrl(store('{broken')) === '' && AB.marketBridgeUrl(store(JSON.stringify({ config: { marketBridgeUrl: 'javascript:alert(1)' } }))) === '', 'bridge address: missing / broken / not https -> empty');
for (const [txt, why] of [[null, 'nothing saved'], ['{broken', 'broken JSON'], ['[]', 'not an object'], [JSON.stringify({ config: {} }), 'no ledger']]) {
  const r = AB.readLedger(store(txt)); ok(r.ok === false && typeof r.reason === 'string' && r.reason, 'readLedger must fail softly on ' + why);
}
ok(AB.readLedger({ getItem() { throw new Error('SecurityError'); } }).ok === false && AB.readLedger(undefined).ok === false, 'storage that throws / is absent');

// full backup file (exportFullBackup): {_meta, state, extras}
const backup = JSON.stringify({ _meta: { version: 3, appName: 'AlphaDesk', exportedAt: '2026-11-14T05:00:00.000Z', lifoTrades: 6, momTrades: 2, secretsIncluded: false }, state: STATE, extras: {} }, null, 2);
const F = AB.importLedgerText(backup, 'AlphaDesk_backup_2026-11-14T05-00-00.json');
ok(F.ok && F.source.includes('backup') && JSON.stringify(F.fills) === JSON.stringify(L.fills), 'backup file gives the same fills as the browser storage');
// LIFO ledger CSV (exportLifoCSV + dlCSV): BOM, 5 header rows, column row, build row last, quoted cells
const csv = '﻿' + ['AlphaDesk — LIFO Live Ledger Export,,,,,,,,', 'Exported,"14/11/2026, 10:30:00 am",,,,,,,', 'Capital,157731,Slots,40,AvgFall%,6,MinProfit₹,200', 'MaxLots,3,ScanTopN,,Brokerage,25,Slippage%,0.05', ',,,,,,,,',
  'Date,Symbol,Type,Qty,Price,Turnover,Friction,LIFO P&L,Avg Buy,Reason',
  ...LIFO.slice(0, 5).map(t => [t.date, t.sym, t.type, t.qty, t.price, '', '', '0.00', '0.00', t.reason ? `"${t.reason}, ""quoted"""` : ''].join(',')),
  '# AlphaDesk build,2026-11-14-v3.22-R28,814fecf65c33'].join('\n');
const C = AB.importLedgerText(csv, 'lifo_ledger_2026-11-14.csv');
ok(C.ok && C.fills.length === 5 && C.source.includes('CSV'), 'ledger CSV: ' + JSON.stringify({ ok: C.ok, n: C.fills && C.fills.length, r: C.reason }));
eq(C.fills.map(f => [f.date, f.symbol, f.type, f.qty, f.price]), LIFO.slice(0, 5).map(t => [t.date, t.sym, t.type, t.qty, t.price]), 'CSV fills');
ok(AB.importLedgerText('hello,world\n1,2', 'x.csv').ok === false && AB.importLedgerText('{"a":1}', 'x.json').ok === false && AB.importLedgerText('', 'x').ok === false, 'a file that is not an AlphaDesk export is refused');
const viaFile = await AB.importLedgerFile({ name: 'b.json', text: async () => backup });
ok(viaFile.ok && viaFile.fills.length === 7, 'importLedgerFile reads a File-like object');
ok((await AB.importLedgerFile({ name: 'b.json', text: async () => { throw new Error('unreadable'); } })).ok === false, 'unreadable file fails softly');

// ───────────── round trips ─────────────
const RT = AB.roundTrips(L.fills, 'niftybees');
// s1 is linked to b2 (60 @ 228.25 -> 241.75). s2 has no link: latest open lot first = b1 (b2 is fully sold), 40 of 100. 60 of b1 stay open.
eq(RT.trades.map(t => [t.entryDate, t.entryPrice, t.qty, t.exitDate, t.exitPrice, t.open]), [
  ['2024-01-10', 240.5, 40, '2024-03-15', 251, false], ['2024-01-10', 240.5, 60, '', null, true], ['2024-02-01', 228.25, 60, '2024-02-20', 241.75, false]], 'round trips');
ok(near(RT.trades[0].pnl, 40 * (251 - 240.5)) && near(RT.trades[2].pnl, 60 * (241.75 - 228.25)) && RT.trades[1].pnl === null, 'round-trip P&L (before charges)');
ok(near(RT.closedPnl, 420 + 810) && RT.openQty === 60 && RT.unmatchedSells === 0, 'totals: ' + JSON.stringify([RT.closedPnl, RT.openQty]));
const over = AB.roundTrips([{ book: 'LIFO', date: '2024-01-02', symbol: 'A', type: 'SELL', qty: 5, price: 10, id: 's', linkedBuyId: '' }], 'A');
ok(over.trades.length === 0 && over.unmatchedSells === 5, 'a sell with no buy is counted, not invented');
const sameDay = AB.roundTrips([{ book: 'DM', date: '2024-01-02', symbol: 'A', type: 'SELL', qty: 5, price: 12, id: 's', linkedBuyId: '' }, { book: 'DM', date: '2024-01-02', symbol: 'A', type: 'BUY', qty: 5, price: 10, id: 'b', linkedBuyId: '' }], 'A');
ok(sameDay.trades.length === 1 && sameDay.trades[0].open === false && near(sameDay.trades[0].pnl, 10), 'same-day buy is placed before the sell');

// ───────────── actual vs backtest ─────────────
const ms = d => Date.parse(d + 'T00:00:00Z');
const BT = [
  { entryDate: ms('2024-01-11'), exitDate: ms('2024-03-14'), entryPrice: 241.0, exitPrice: 250.0, qty: 41, net: 300.5, reason: 'target' },   // 1 day from the actual 2024-01-10 entries
  { entryDate: ms('2024-02-01'), exitDate: ms('2024-02-21'), entryPrice: 228.25, exitPrice: 242.0, qty: 60, net: 790, reason: 'target' },
  { entryDate: ms('2024-06-03'), exitDate: ms('2024-06-20'), entryPrice: 255, exitPrice: 262, qty: 10, net: 55, reason: 'target' },           // only in the backtest
  { entryDate: ms('2024-07-01'), exitDate: ms('2024-07-31'), entryPrice: 260, exitPrice: 259, qty: 10, net: -20, reason: 'end_of_data' },     // still open in the backtest
];
const V = AB.actualVsBacktest(RT.trades, BT, { windowDays: 5 });
eq(V.rows.map(r => [r.actual ? r.actual.entryDate : '', r.backtest ? r.backtest.entryDate : '', r.gapDays]), [
  ['2024-01-10', '2024-01-11', 1], ['2024-01-10', '', null], ['2024-02-01', '2024-02-01', 0], ['', '2024-06-03', null], ['', '2024-07-01', null]], 'rows');
eq([V.summary.both, V.summary.onlyActual, V.summary.onlyBacktest], [2, 1, 2], 'summary counts');
ok(near(V.summary.actualClosedPnl, 1230) && near(V.summary.backtestClosedNet, 300.5 + 790 + 55) && V.summary.backtestOpen === 1 && V.summary.actualOpen === 1, 'summary money: ' + JSON.stringify(V.summary));
ok(near(V.rows[0].entryPriceDiffPct, (240.5 / 241.0 - 1) * 100) && V.rows[2].entryPriceDiffPct === 0, 'entry price difference');
ok(AB.actualVsBacktest(RT.trades, BT, { windowDays: 0 }).summary.both === 1, 'window 0 = same day only');
const empty = AB.actualVsBacktest([], [], {}); ok(empty.rows.length === 0 && empty.summary.both === 0 && empty.summary.actualClosedPnl === 0, 'empty inputs');

writeFileSync(join(HERE, 'fixtures', 'p5_crosscheck.json'), JSON.stringify({ fills: L.fills, symbol: 'NIFTYBEES', closedPnl: RT.closedPnl, openQty: RT.openQty,
  trades: RT.trades.map(t => [t.entryDate, t.entryPrice, t.qty, t.exitDate, t.exitPrice, t.pnl]), backtestClosedNet: V.summary.backtestClosedNet, bt: BT.map(t => [t.net, t.reason]) }));
