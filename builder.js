/* ============================================================
   BACKTEST LAB — builder.js  (Phase 3: Strategy Builder)
   Form <-> schema round-trip. No strategy logic lives here.
   ============================================================ */

import { INDICATORS } from './engine.js';
import { PRESETS, getPreset, validateSchema, SCHEMA_VERSION } from './schemas.js';

const LIB_KEY = 'btlab_library_v1';

/* ---------- option vocabularies ---------- */

export const SOURCES = ['close', 'open', 'high', 'low', 'volume', 'hl2'];

export const COMPARATORS = [
  { op: 'cross_above', label: 'crosses above' },
  { op: 'cross_below', label: 'crosses below' },
  { op: 'gt',          label: 'is above' },
  { op: 'lt',          label: 'is below' },
  { op: 'gte',         label: 'is at or above' },
  { op: 'lte',         label: 'is at or below' },
  { op: 'within_pct',  label: 'is within % of' },
];

export const BAR_OPERANDS = ['close', 'open', 'high', 'low', 'volume'];

/* Operands available given the indicators currently declared. */
export function operandChoices(schema) {
  const inds = (schema.indicators || []).map(i => i.key);
  return [...BAR_OPERANDS, ...inds];
}

/* ---------- condition <-> row ----------
   A row is the flat shape the form edits:
   { left, op, right, factor, pct }
   It serialises to a prefix expression, with `factor` wrapping the
   right operand in a multiplier so "close is below 97% of sma20"
   is expressible without a formula editor.
*/

export function rowToExpr(row) {
  const right = (row.factor != null && row.factor !== 1 && row.factor !== '')
    ? ['mult', row.right, Number(row.factor)]
    : coerce(row.right);
  if (row.op === 'within_pct') return ['within_pct', coerce(row.left), right, Number(row.pct ?? 1)];
  return [row.op, coerce(row.left), right];
}

export function exprToRow(expr) {
  if (!Array.isArray(expr)) return { left: 'close', op: 'gt', right: String(expr ?? 0), factor: 1 };
  const [op, left, right, pct] = expr;
  const row = { left: String(left), op, factor: 1, pct: pct ?? 1 };
  if (Array.isArray(right) && right[0] === 'mult') {
    row.right = String(right[1]);
    row.factor = Number(right[2]);
  } else {
    row.right = String(right);
  }
  return row;
}

function coerce(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return (v !== '' && Number.isFinite(n) && !BAR_OPERANDS.includes(v)) ? n : v;
}

/* ---------- form model <-> schema ---------- */
/*
  The form model is the plain object the UI binds to. Keeping it separate
  from the schema means the schema stays the stable published artifact.
*/

export function schemaToForm(schema) {
  return {
    id: schema.id || 'custom',
    label: schema.label || 'Untitled strategy',
    note: schema.note || '',
    symbol: schema.symbol || '',
    indicators: (schema.indicators || []).map(i => ({ ...i })),
    entryJoin: schema.entry?.join || 'ALL',
    entryRows: (schema.entry?.conditions || []).map(exprToRow),
    exit: {
      accounting: schema.exit?.accounting || 'FIFO',
      targetPct: nz(schema.exit?.targetPct),
      stopPct: nz(schema.exit?.stopPct),
      trailPct: nz(schema.exit?.trailPct),
      timeStopBars: nz(schema.exit?.timeStopBars),
      useCondition: !!schema.exit?.condition,
      conditionRow: schema.exit?.condition ? exprToRow(schema.exit.condition) : { left: 'close', op: 'cross_below', right: 'close', factor: 1 },
      exitLotsAtOnce: schema.exit?.exitLotsAtOnce !== false,
    },
    pyramiding: {
      enabled: !!schema.pyramiding?.enabled,
      maxLots: schema.pyramiding?.maxLots ?? 3,
      triggerRow: schema.pyramiding?.trigger ? exprToRow(schema.pyramiding.trigger)
                : { left: 'close', op: 'lte', right: 'lastBuyPrice', factor: 0.95 },
    },
    sizing: {
      mode: schema.sizing?.mode || 'fixed',
      value: schema.sizing?.value ?? 20000,
      capital: schema.sizing?.capital ?? 100000,
      compounds: schema.sizing?.compounds !== false,
    },
    costs: {
      preset: schema.costs?.preset || 'zerodha_delivery',
      slippageBps: schema.costs?.slippageBps ?? 5,
      gapAware: schema.costs?.gapAware !== false,
      gapFactor: schema.costs?.gapFactor ?? 10,
      volumeCapPct: schema.costs?.volumeCapPct ?? 2,
    },
  };
}

export function formToSchema(form) {
  const schema = {
    schemaVersion: SCHEMA_VERSION,
    id: form.id || 'custom',
    label: form.label || 'Untitled strategy',
    note: form.note || '',
    symbol: form.symbol || undefined,
    indicators: (form.indicators || []).map(i => {
      const out = { key: i.key, type: i.type };
      if (INDICATORS[i.type]?.src) out.source = i.source || 'close';
      for (const a of (INDICATORS[i.type]?.args || [])) if (i[a] != null && i[a] !== '') out[a] = Number(i[a]);
      return out;
    }),
    entry: {
      join: form.entryJoin || 'ALL',
      conditions: (form.entryRows || []).map(rowToExpr),
    },
    exit: { accounting: form.exit.accounting || 'FIFO' },
    pyramiding: { enabled: !!form.pyramiding.enabled },
    sizing: {
      mode: form.sizing.mode,
      value: Number(form.sizing.value),
      capital: Number(form.sizing.capital),
      compounds: !!form.sizing.compounds,
    },
    costs: {
      preset: form.costs.preset,
      slippageBps: Number(form.costs.slippageBps),
      gapAware: !!form.costs.gapAware,
      gapFactor: Number(form.costs.gapFactor ?? 10),
      volumeCapPct: Number(form.costs.volumeCapPct),
    },
  };

  const ex = form.exit;
  if (isNum(ex.targetPct))    schema.exit.targetPct = Number(ex.targetPct);
  if (isNum(ex.stopPct))      schema.exit.stopPct = Number(ex.stopPct);
  if (isNum(ex.trailPct))     schema.exit.trailPct = Number(ex.trailPct);
  if (isNum(ex.timeStopBars)) schema.exit.timeStopBars = Number(ex.timeStopBars);
  if (ex.useCondition)        schema.exit.condition = rowToExpr(ex.conditionRow);
  if (ex.exitLotsAtOnce === false) schema.exit.exitLotsAtOnce = false;

  if (form.pyramiding.enabled) {
    schema.pyramiding.maxLots = Number(form.pyramiding.maxLots);
    schema.pyramiding.trigger = rowToExpr(form.pyramiding.triggerRow);
  }
  if (!schema.symbol) delete schema.symbol;
  return schema;
}

function nz(v) { return (v == null) ? '' : v; }
function isNum(v) { return v !== '' && v != null && Number.isFinite(Number(v)); }

/* ---------- auto key naming ---------- */

export function suggestKey(type, params, existing = []) {
  const base = type.toLowerCase() + (params.period ?? params.slow ?? '');
  let k = base, n = 2;
  while (existing.includes(k)) k = base + '_' + (n++);
  return k;
}

/* ---------- library (localStorage) ---------- */

export function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const saved = raw ? JSON.parse(raw) : [];
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}

export function saveToLibrary(schema) {
  const lib = loadLibrary();
  const i = lib.findIndex(s => s.id === schema.id);
  if (i >= 0) lib[i] = schema; else lib.push(schema);
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  return lib;
}

export function deleteFromLibrary(id) {
  const lib = loadLibrary().filter(s => s.id !== id);
  localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  return lib;
}

export function allStrategies() {
  const saved = loadLibrary();
  const savedIds = new Set(saved.map(s => s.id));
  return [...saved, ...PRESETS.filter(p => !savedIds.has(p.id))];
}

/* ---------- schema migration ---------- */

export function migrateSchema(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a strategy file.');
  if (raw.schemaVersion === SCHEMA_VERSION) return raw;
  if (raw.schemaVersion == null) {
    // pre-versioning file: assume v1 shape, tag it
    return { ...raw, schemaVersion: SCHEMA_VERSION };
  }
  if (raw.schemaVersion > SCHEMA_VERSION)
    throw new Error(`This strategy was made in a newer version (v${raw.schemaVersion}). Update the app to open it.`);
  throw new Error(`Cannot read schema version ${raw.schemaVersion}.`);
}

/* ---------- round-trip check (used by Gate 3) ---------- */

export function roundTrip(schema) {
  return formToSchema(schemaToForm(schema));
}

export { PRESETS, getPreset, validateSchema, SCHEMA_VERSION };
