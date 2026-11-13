import { fillPrice, canExitOnFillBar, resolveExit } from '../fills.js';
let n = 0, bad = 0; const eq = (a, b, m) => { n++; if (a !== b) { bad++; console.log('FAIL', m, 'got', a, 'want', b); } };
const bar = { o: 100, h: 110, l: 95, c: 105 };
eq(fillPrice({ type: 'market_open' }, bar), 100, 'market_open');
eq(fillPrice({ type: 'at_close' }, bar), 105, 'at_close');
eq(fillPrice({ type: 'stop_buy', level: 108 }, bar), 108, 'stop_buy touched');
eq(fillPrice({ type: 'stop_buy', level: 98 }, bar), 100, 'stop_buy gap-up fills at open, not level');
eq(fillPrice({ type: 'stop_buy', level: 111 }, bar), null, 'stop_buy not reached');
eq(fillPrice({ type: 'stop_buy', level: 110 }, bar), 110, 'stop_buy exact high');
eq(fillPrice({ type: 'limit_buy', level: 97 }, bar), 97, 'limit_buy touched');
eq(fillPrice({ type: 'limit_buy', level: 102 }, bar), 100, 'limit_buy gap-down fills at open');
eq(fillPrice({ type: 'limit_buy', level: 94 }, bar), null, 'limit_buy not reached');
eq(fillPrice({ type: 'limit_sell', level: 109 }, bar), 109, 'limit_sell touched');
eq(fillPrice({ type: 'limit_sell', level: 99 }, bar), 100, 'limit_sell gap-up fills at open');
eq(fillPrice({ type: 'limit_sell', level: 111 }, bar), null, 'limit_sell not reached');
eq(fillPrice({ type: 'stop_sell', level: 96 }, bar), 96, 'stop_sell touched');
eq(fillPrice({ type: 'stop_sell', level: 101 }, bar), 100, 'stop_sell gap-down fills at open');
eq(fillPrice({ type: 'stop_sell', level: 94 }, bar), null, 'stop_sell not reached');
for (const t of ['stop_buy', 'limit_buy', 'limit_sell', 'stop_sell']) for (const L of [90, 95, 99, 100, 104, 110, 115]) {
  const p = fillPrice({ type: t, level: L }, bar); n++; if (p != null && (p < bar.l || p > bar.h)) { bad++; console.log('FAIL fill outside bar', t, L, p); } }
eq(canExitOnFillBar(100, bar, undefined), false, 'no same-bar exit by default');
eq(canExitOnFillBar(100, bar, 'open_fill_only'), true, 'opt-in, filled at open');
eq(canExitOnFillBar(108, bar, 'open_fill_only'), false, 'opt-in, intraday fill');
eq(resolveExit(109, 96, bar), 'stop', 'both hit -> stop first');
eq(resolveExit(109, 90, bar), 'target', 'target only');
eq(resolveExit(120, 90, bar), null, 'neither');
let threw = false; try { fillPrice({ type: 'x' }, bar); } catch { threw = true; } eq(threw, true, 'unknown type throws');
console.log(bad ? `FAILED ${bad}/${n}` : `ok ${n} assertions`); process.exit(bad ? 1 : 0);
