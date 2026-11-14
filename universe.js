/* Point-in-time index universes (P6). Reads ref/membership.json (schema membership/1, built by market-data
   scripts/build_membership.py from NSE's monthly index files). Pure functions: no fetch, no DOM.

   model = buildModel(membershipJson, manifestFiles?)
     manifestFiles (manifest.files) maps a past member's ISIN to the dataset's CURRENT symbol (renames);
     without it, the symbol written in the interval is used.
   membersOn(model, index, 'YYYY-MM-DD')        -> { ok, symbols } | { ok:false, code, message }
   universeFor(model, index, from, to)          -> { ok, symbols, intervals, isMember(sym, tMs) } | { ok:false, ... }
   Dates before an index's startDate are refused: the sources do not prove membership there. */

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);

export function buildModel(json, files) {
  if (!json || json.schema !== 'membership/1' || !json.indices) throw new Error('membership: unknown schema');
  const isinToSym = new Map();
  for (const [sym, e] of Object.entries(files || {})) if (e && e.isin) isinToSym.set(e.isin, sym);
  const indices = {};
  for (const [name, ix] of Object.entries(json.indices)) {
    const intervals = (ix.intervals || []).map(v => ({
      symbol: (v.isin && isinToSym.get(v.isin)) || v.symbol, histSymbol: v.symbol, isin: v.isin || null,
      from: v.from, to: v.to || null, evidence: v.evidence || null }));
    indices[name] = { name, startDate: ix.startDate, size: ix.size, definition: ix.definition || null, lastFile: ix.lastFile || null, intervals };
  }
  return { indices, notBuilt: json.notBuilt || {}, generatedAt: json.generatedAt || null };
}

/* Past or present members with no price file in the dataset (delisted before EOD2 kept them, or excluded). -> [{symbol, indices, lastTo}] */
export function pastMembersWithoutData(model, files) {
  const have = new Set(Object.keys(files || {}));
  const out = new Map();
  for (const ix of Object.values(model.indices)) for (const v of ix.intervals) if (!have.has(v.symbol)) {
    const r = out.get(v.symbol) || { symbol: v.symbol, indices: new Set(), lastTo: '' };
    r.indices.add(ix.name); if ((v.to || '9999') > r.lastTo) r.lastTo = v.to || 'today';
    out.set(v.symbol, r);
  }
  return [...out.values()].map(r => ({ ...r, indices: [...r.indices].sort() })).sort((a, b) => a.symbol < b.symbol ? -1 : 1);
}

export function listIndices(model) {
  return Object.values(model.indices).map(ix => ({ name: ix.name, startDate: ix.startDate, size: ix.size }));
}

function check(model, index, from, to) {
  const ix = model.indices[index];
  if (!ix) {
    const why = model.notBuilt[index];
    return { ok: false, code: 'INDEX_NOT_AVAILABLE', message: why ? `${index}: ${why}` : `${index}: no point-in-time list in this dataset` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (to != null && !/^\d{4}-\d{2}-\d{2}$/.test(to)))
    return { ok: false, code: 'BAD_DATE', message: 'dates must be YYYY-MM-DD' };
  if (to != null && to < from) return { ok: false, code: 'BAD_DATE', message: 'end date is before start date' };
  if (from < ix.startDate)
    return { ok: false, code: 'BEFORE_START', message: `${index} membership is proven only from ${ix.startDate}; ${from} is earlier. Start the test on or after ${ix.startDate}.` };
  return { ok: true, ix };
}

const live = (v, d) => v.from <= d && (v.to == null || d <= v.to);
const overlaps = (v, a, b) => v.from <= b && (v.to == null || v.to >= a);

export function membersOn(model, index, date) {
  const c = check(model, index, date, date);
  if (!c.ok) return c;
  const symbols = [...new Set(c.ix.intervals.filter(v => live(v, date)).map(v => v.symbol))].sort();
  return { ok: true, index, date, symbols };
}

/* Every symbol that was a member at any time in [from, to] (to defaults to today), plus a fast per-day test. */
export function universeFor(model, index, from, to) {
  const end = to || iso(Date.now());
  const c = check(model, index, from, end);
  if (!c.ok) return c;
  const bySym = new Map();
  for (const v of c.ix.intervals) if (overlaps(v, from, end)) {
    if (!bySym.has(v.symbol)) bySym.set(v.symbol, []);
    bySym.get(v.symbol).push(v);
  }
  const startMs = Date.parse(from + 'T00:00:00Z');          // from >= startDate (checked); earlier bars are indicator warm-up only
  const isMember = (sym, tMs) => {
    if (tMs < startMs) return false;
    const list = bySym.get(sym);
    if (!list) return false;
    const d = iso(Math.floor(tMs / DAY) * DAY);
    return list.some(v => live(v, d));
  };
  return { ok: true, index, from, to: end, startDate: c.ix.startDate, symbols: [...bySym.keys()].sort(), intervals: bySym, isMember };
}
