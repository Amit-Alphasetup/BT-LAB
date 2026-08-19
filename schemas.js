/* ============================================================
   BACKTEST LAB — schemas.js
   Preset strategy definitions. All unnamed / generic — never
   attributed to a person. MASTER PLAN v2.0 B6.
   ============================================================ */

export const SCHEMA_VERSION = 1;

const baseSizing = { mode: 'fixed', value: 20000, capital: 100000, compounds: true };
const baseCosts  = { preset: 'zerodha_delivery', slippageBps: 5, gapAware: true, gapFactor: 10, volumeCapPct: 2 };

export const PRESETS = [
  {
    schemaVersion: 1,
    id: 'ma_stack',
    label: 'Moving-average stack breakout',
    note: 'Price closes above all five moving averages, crossing the fastest on the signal day.',
    indicators: [
      { key: 'sma5',   type: 'SMA', source: 'close', period: 5 },
      { key: 'sma20',  type: 'SMA', source: 'close', period: 20 },
      { key: 'sma50',  type: 'SMA', source: 'close', period: 50 },
      { key: 'sma100', type: 'SMA', source: 'close', period: 100 },
      { key: 'sma200', type: 'SMA', source: 'close', period: 200 },
    ],
    entry: { join: 'ALL', conditions: [
      ['cross_above', 'close', 'sma5'],
      ['gt', 'close', 'sma20'],
      ['gt', 'close', 'sma50'],
      ['gt', 'close', 'sma100'],
      ['gt', 'close', 'sma200'],
    ]},
    exit: { accounting: 'FIFO', condition: ['cross_below', 'close', 'sma20'], stopPct: 8 },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'golden_cross',
    label: 'Golden cross / death cross',
    note: '50-day MA crosses above the 200-day MA; exit on the reverse cross.',
    indicators: [
      { key: 'sma50',  type: 'SMA', source: 'close', period: 50 },
      { key: 'sma200', type: 'SMA', source: 'close', period: 200 },
    ],
    entry: { join: 'ALL', conditions: [['cross_above', 'sma50', 'sma200']] },
    exit: { accounting: 'FIFO', condition: ['cross_below', 'sma50', 'sma200'] },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing, mode: 'capitalFraction', value: 0.95 }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'rsi2_meanrev',
    label: 'Short-period RSI mean reversion',
    note: 'Buy deep 2-period RSI oversold above the long trend; exit on RSI recovery.',
    indicators: [
      { key: 'rsi2',   type: 'RSI', source: 'close', period: 2 },
      { key: 'sma200', type: 'SMA', source: 'close', period: 200 },
    ],
    entry: { join: 'ALL', conditions: [
      ['lt', 'rsi2', 10],
      ['gt', 'close', 'sma200'],
    ]},
    exit: { accounting: 'FIFO', condition: ['gt', 'rsi2', 70], timeStopBars: 15, stopPct: 8 },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'bb_bounce',
    label: 'Bollinger band bounce',
    note: 'Buy a close below the lower band; exit at the middle band.',
    indicators: [
      { key: 'bbl',  type: 'BBLOWER', source: 'close', period: 20, mult: 2 },
      { key: 'sma20', type: 'SMA',    source: 'close', period: 20 },
    ],
    entry: { join: 'ALL', conditions: [['lt', 'close', 'bbl']] },
    exit: { accounting: 'FIFO', condition: ['gte', 'close', 'sma20'], stopPct: 10, timeStopBars: 30 },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'high52w',
    label: '52-week-high momentum',
    note: 'Buy new 52-week highs; trail the position.',
    indicators: [
      { key: 'hh250', type: 'HIGHEST', source: 'high', period: 250 },
      { key: 'sma50', type: 'SMA',     source: 'close', period: 50 },
    ],
    entry: { join: 'ALL', conditions: [
      ['gte', 'close', ['mult', 'hh250', 0.999]],
      ['gt', 'close', 'sma50'],
    ]},
    exit: { accounting: 'FIFO', trailPct: 15, condition: ['cross_below', 'close', 'sma50'] },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'macd_cross',
    label: 'MACD signal cross',
    note: 'MACD line crosses above its signal line; exit on the reverse.',
    indicators: [
      { key: 'macd', type: 'MACD',    source: 'close', fast: 12, slow: 26 },
      { key: 'sig',  type: 'MACDSIG', source: 'close', fast: 12, slow: 26, signal: 9 },
    ],
    entry: { join: 'ALL', conditions: [['cross_above', 'macd', 'sig']] },
    exit: { accounting: 'FIFO', condition: ['cross_below', 'macd', 'sig'], stopPct: 10 },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'donchian',
    label: 'Donchian channel breakout',
    note: 'Buy a 20-day high; exit on a 10-day low.',
    indicators: [
      { key: 'hh20', type: 'HIGHEST', source: 'high', period: 20 },
      { key: 'll10', type: 'LOWEST',  source: 'low',  period: 10 },
    ],
    entry: { join: 'ALL', conditions: [['gte', 'close', 'hh20']] },
    exit: { accounting: 'FIFO', condition: ['lte', 'close', 'll10'] },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'smart_averaging',
    label: 'Averaging-down grid',
    note: 'Buy the first dip, add a lot on every further fall, exit each lot at a fixed profit (LIFO).',
    indicators: [
      { key: 'sma20', type: 'SMA', source: 'close', period: 20 },
    ],
    entry: { join: 'ALL', conditions: [['lt', 'close', ['mult', 'sma20', 0.97]]] },
    exit: { accounting: 'LIFO', targetPct: 6, exitLotsAtOnce: false },
    pyramiding: { enabled: true, maxLots: 5, trigger: ['lte', 'close', ['mult', 'lastBuyPrice', 0.94]] },
    sizing: { ...baseSizing, value: 15000 }, costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'sst_v1',
    label: 'Swing trading — 20-day-high breakout, target on average',
    note: "Day's high crosses the 20-day high; average down on further signals; sell everything when the average price is up 6.28%.",
    indicators: [
      { key: 'hh20', type: 'HIGHEST', source: 'high', period: 20 },
    ],
    entry: { join: 'ALL', measureOn: 'high', conditions: [
      ['gte', 'close', 'hh20'],
    ]},
    exit: { accounting: 'FIFO', measureOn: 'high',
            condition: ['gte', 'close', ['mult', 'avgBuyPrice', 1.0628]] },
    pyramiding: { enabled: true, maxLots: 5, trigger: ['gte', 'close', 'hh20'] },
    sizing: { mode: 'fixed', value: 5000, capital: 100000, compounds: true },
    costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'sst_2_lifo',
    label: 'Swing trading 2.0 — armed at the 20-day low, LIFO exits',
    note: 'A stock arms when it touches its 20-day low, then buys when it breaks the 20-day high. Each lot sells on its own +6%, newest first.',
    indicators: [
      { key: 'hh20', type: 'HIGHEST', source: 'high', period: 20 },
      { key: 'll20', type: 'LOWEST',  source: 'low',  period: 20 },
    ],
    entry: { join: 'ALL', measureOn: 'high', conditions: [
      ['armed_since', ['lte', 'low', 'll20'], 250],
      ['gte', 'close', 'hh20'],
    ]},
    exit: { accounting: 'LIFO', targetPct: 6, exitLotsAtOnce: false },
    pyramiding: { enabled: true, maxLots: 999,
                  trigger: ['lte', 'hh20', ['mult', 'lastBuyPrice', 0.95]] },
    sizing: { mode: 'capitalFraction', value: 0.02, capital: 500000, compounds: true },
    costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'turtle_55',
    label: 'Channel breakout — 55-day high in, 20-day low out',
    note: 'Buy a close above the 55-day high; sell on a close below the 20-day low. No target, no stop.',
    indicators: [
      { key: 'hh55', type: 'HIGHEST', source: 'high', period: 55 },
      { key: 'll20', type: 'LOWEST',  source: 'low',  period: 20 },
    ],
    entry: { join: 'ALL', conditions: [['gt', 'close', 'hh55']] },
    exit: { accounting: 'FIFO', condition: ['lt', 'close', 'll20'] },
    pyramiding: { enabled: false },
    sizing: { mode: 'capitalFraction', value: 0.95, capital: 100000, compounds: true },
    costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'sma100_breakout',
    label: '100-day average breakout, target on average price',
    note: 'Buy when the close crosses above the 100-day average; average down on further crosses; sell all at +6.28% on the average price.',
    indicators: [
      { key: 'sma100', type: 'SMA', source: 'close', period: 100 },
    ],
    entry: { join: 'ALL', conditions: [['cross_above', 'close', 'sma100']] },
    exit: { accounting: 'FIFO', condition: ['gte', 'close', ['mult', 'avgBuyPrice', 1.0628]] },
    pyramiding: { enabled: true, maxLots: 5, trigger: ['cross_above', 'close', 'sma100'] },
    sizing: { mode: 'fixed', value: 5000, capital: 100000, compounds: true },
    costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'darvas_box',
    label: 'Box breakout — armed at a 20-day low, buy the box top',
    note: "After a 20-day low forms the box floor, buy when the day's high clears the 20-day high. Sell all at +6.28% on the average price.",
    indicators: [
      { key: 'hh20', type: 'HIGHEST', source: 'high', period: 20 },
      { key: 'll20', type: 'LOWEST',  source: 'low',  period: 20 },
    ],
    entry: { join: 'ALL', measureOn: 'high', conditions: [
      ['armed_since', ['lte', 'low', 'll20'], 60],
      ['gte', 'close', 'hh20'],
    ]},
    exit: { accounting: 'FIFO', measureOn: 'high',
            condition: ['gte', 'close', ['mult', 'avgBuyPrice', 1.0628]] },
    pyramiding: { enabled: true, maxLots: 5, trigger: ['gte', 'close', 'hh20'] },
    sizing: { mode: 'fixed', value: 5000, capital: 100000, compounds: true },
    costs: { ...baseCosts },
  },
  {
    schemaVersion: 1,
    id: 'buy_hold',
    label: 'Buy and hold (benchmark)',
    note: 'Buy on the first bar, never sell. The bar every strategy must clear.',
    indicators: [],
    entry: { join: 'ALL', conditions: [['gt', 'close', 0]] },
    exit: { accounting: 'FIFO' },
    pyramiding: { enabled: false },
    sizing: { ...baseSizing, mode: 'capitalFraction', value: 0.98 }, costs: { ...baseCosts },
  },
];

export function getPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  return p ? JSON.parse(JSON.stringify(p)) : null;
}

/* ---------- validation ---------- */

export function validateSchema(schema) {
  const errs = [];
  if (!schema) return ['schema is empty'];
  if (schema.schemaVersion !== SCHEMA_VERSION)
    errs.push(`schema version ${schema.schemaVersion} — this app expects ${SCHEMA_VERSION}`);
  if (!schema.id) errs.push('missing id');
  if (!schema.entry || !(schema.entry.conditions || []).length)
    errs.push('entry needs at least one condition');

  const keys = new Set((schema.indicators || []).map(i => i.key));
  if (keys.size !== (schema.indicators || []).length)
    errs.push('indicator keys must be unique');

  for (const ind of (schema.indicators || [])) {
    if (!ind.key) errs.push('an indicator has no key');
    if (ind.period != null && ind.period < 1) errs.push(`${ind.key}: period must be >= 1`);
    if (ind.type === 'RSI' && ind.period < 2) errs.push(`${ind.key}: RSI period must be >= 2`);
  }

  const ex = schema.exit || {};
  if (ex.targetPct != null && ex.targetPct <= 0) errs.push('target % must be greater than 0');
  if (ex.stopPct != null && ex.stopPct <= 0) errs.push('stop % must be greater than 0');
  if (ex.targetPct != null && ex.stopPct != null && ex.stopPct >= ex.targetPct)
    errs.push('stop % should be smaller than target % (otherwise the stop fires first every time)');
  if (ex.trailPct != null && (ex.trailPct <= 0 || ex.trailPct >= 100))
    errs.push('trail % must be between 0 and 100');
  if (ex.timeStopBars != null && ex.timeStopBars < 1) errs.push('time stop must be at least 1 bar');
  if (!ex.condition && ex.targetPct == null && ex.stopPct == null &&
      ex.trailPct == null && ex.timeStopBars == null && schema.id !== 'buy_hold')
    errs.push('no exit rule defined — the position would never be closed');

  const sz = schema.sizing || {};
  if ((sz.capital ?? 0) <= 0) errs.push('capital must be greater than 0');
  if (sz.mode === 'capitalFraction' && (sz.value <= 0 || sz.value > 1))
    errs.push('capital fraction must be between 0 and 1');
  if (sz.mode === 'fixed' && sz.value <= 0) errs.push('fixed size must be greater than 0');

  const py = schema.pyramiding || {};
  if (py.enabled && (py.maxLots ?? 0) < 2) errs.push('pyramiding needs maxLots of at least 2');

  return errs;
}
