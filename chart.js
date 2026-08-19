/* ============================================================
   BACKTEST LAB — chart.js  (Phase 4: Chart + markers + replay)
   Primary renderer: TradingView Lightweight Charts (CDN).
   Fallback renderer: built-in canvas, so the app still works
   when the CDN is blocked — same public API either way.
   ============================================================ */

const LWC_SRC = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';

let lwcPromise = null;

export function loadLightweightCharts(timeoutMs = 6000) {
  if (lwcPromise) return lwcPromise;
  lwcPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.LightweightCharts) return resolve(window.LightweightCharts);
    const s = document.createElement('script');
    s.src = LWC_SRC;
    s.async = true;
    const timer = setTimeout(() => resolve(null), timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(window.LightweightCharts || null); };
    s.onerror = () => { clearTimeout(timer); resolve(null); };
    document.head.appendChild(s);
  });
  return lwcPromise;
}

/* ---------- shared data shaping (pure — unit tested) ---------- */

export const THEME = {
  bg: '#14120F', panel: '#1D1915', rule: '#38302A',
  paper: '#EDE4D3', dim: '#9A8E7C', faint: '#6B6154',
  amber: '#E39B2E', up: '#5B9E76', down: '#C05B45',
};

export function toCandles(bars, upto = Infinity) {
  const out = [];
  for (let i = 0; i < bars.t.length; i++) {
    if (i > upto) break;
    out.push({
      time: Math.floor(bars.t[i] / 1000),
      open: bars.o[i], high: bars.h[i], low: bars.l[i], close: bars.c[i],
    });
  }
  return out;
}

export function toLine(bars, values, upto = Infinity) {
  const out = [];
  for (let i = 0; i < bars.t.length; i++) {
    if (i > upto) break;
    const v = values[i];
    if (Number.isFinite(v)) out.push({ time: Math.floor(bars.t[i] / 1000), value: v });
  }
  return out;
}

export function toEquityLine(bars, equity, upto = Infinity) {
  return toLine(bars, equity, upto);
}

/* One marker per fill. Entry markers below the bar, exit markers above. */
export function toMarkers(trades, bars, upto = Infinity) {
  const marks = [];
  for (const tr of trades) {
    if (tr.entryIdx <= upto) {
      marks.push({
        time: Math.floor(bars.t[tr.entryIdx] / 1000),
        position: 'belowBar', color: THEME.up, shape: 'arrowUp',
        text: 'B ' + fmt(tr.entryPrice),
        _idx: tr.entryIdx, _kind: 'entry',
      });
    }
    if (tr.exitIdx <= upto) {
      marks.push({
        time: Math.floor(bars.t[tr.exitIdx] / 1000),
        position: 'aboveBar', color: tr.net >= 0 ? THEME.up : THEME.down, shape: 'arrowDown',
        text: 'S ' + fmt(tr.exitPrice) + '  ' + (tr.pct >= 0 ? '+' : '') + tr.pct.toFixed(1) + '%',
        _idx: tr.exitIdx, _kind: 'exit',
      });
    }
  }
  marks.sort((a, b) => a.time - b.time || (a._kind === 'exit' ? -1 : 1));
  return marks;
}

/* Marker count must equal 2 per trade (entry + exit) within range — Gate 4 checks this. */
export function markerAudit(trades, bars) {
  const marks = toMarkers(trades, bars);
  const entries = marks.filter(m => m._kind === 'entry');
  const exits = marks.filter(m => m._kind === 'exit');
  const priceMismatch = [];
  for (const tr of trades) {
    const e = marks.find(m => m._idx === tr.entryIdx && m._kind === 'entry');
    if (e && !e.text.includes(fmt(tr.entryPrice))) priceMismatch.push(tr.entryIdx);
  }
  return { total: marks.length, entries: entries.length, exits: exits.length, trades: trades.length, priceMismatch };
}

const fmt = (n) => Number(n).toFixed(2);

/* ---------- indicator colouring ---------- */

const PALETTE = ['#E39B2E', '#8FB8D8', '#C89BD8', '#8ED0B4', '#D8A78F', '#A8A8C0'];
export function indicatorColor(i) { return PALETTE[i % PALETTE.length]; }

/* ============================================================
   Renderer — Lightweight Charts when available, canvas otherwise
   ============================================================ */

export async function createChart(container, opts = {}) {
  const LWC = opts.forceFallback ? null : await loadLightweightCharts();
  return LWC ? lwcRenderer(LWC, container, opts) : canvasRenderer(container, opts);
}

/* ---------- Lightweight Charts renderer ---------- */

function lwcRenderer(LWC, container, opts) {
  container.innerHTML = '';
  const chart = LWC.createChart(container, {
    layout: { background: { color: THEME.bg }, textColor: THEME.dim, fontFamily: 'ui-monospace, monospace', fontSize: 11 },
    grid: { vertLines: { color: THEME.rule }, horzLines: { color: THEME.rule } },
    rightPriceScale: { borderColor: THEME.rule },
    timeScale: { borderColor: THEME.rule, rightOffset: 4 },
    crosshair: { mode: LWC.CrosshairMode ? LWC.CrosshairMode.Normal : 0 },
    height: opts.height || 380,
    autoSize: true,
  });

  const candles = chart.addCandlestickSeries({
    upColor: THEME.up, downColor: THEME.down,
    borderUpColor: THEME.up, borderDownColor: THEME.down,
    wickUpColor: THEME.up, wickDownColor: THEME.down,
  });

  const volume = chart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    color: THEME.rule,
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  const indSeries = new Map();
  let api = { kind: 'lwc', chart, candles, volume, indSeries };

  api.setData = (bars, ind, upto = Infinity) => {
    candles.setData(toCandles(bars, upto));
    volume.setData(toLine(bars, bars.vol, upto).map(p => ({ time: p.time, value: p.value, color: THEME.rule })));
    let i = 0;
    for (const [key, values] of Object.entries(ind || {})) {
      if (!indSeries.has(key)) {
        indSeries.set(key, chart.addLineSeries({
          color: indicatorColor(i), lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        }));
      }
      indSeries.get(key).setData(toLine(bars, values, upto));
      i++;
    }
  };
  api.setMarkers = (trades, bars, upto = Infinity) => candles.setMarkers(toMarkers(trades, bars, upto));
  api.focusRange = (fromIdx, toIdx, bars) => {
    chart.timeScale().setVisibleRange({
      from: Math.floor(bars.t[Math.max(0, fromIdx - 10)] / 1000),
      to: Math.floor(bars.t[Math.min(bars.t.length - 1, toIdx + 10)] / 1000),
    });
  };
  api.fitContent = () => chart.timeScale().fitContent();
  api.destroy = () => chart.remove();
  return api;
}

/* ---------- canvas fallback renderer ---------- */

function canvasRenderer(container, opts) {
  container.innerHTML = '';
  const cvs = document.createElement('canvas');
  cvs.style.width = '100%';
  cvs.style.display = 'block';
  container.appendChild(cvs);
  const note = document.createElement('div');
  note.className = 'muted mono';
  note.style.cssText = 'font-size:10px;padding:6px 0 0';
  note.textContent = 'Chart library unavailable — using the built-in renderer.';
  container.appendChild(note);

  const state = { bars: null, ind: null, trades: [], upto: Infinity, from: 0, to: Infinity };
  const height = opts.height || 380;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth || 360;
    cvs.width = w * dpr; cvs.height = height * dpr;
    cvs.style.height = height + 'px';
    const g = cvs.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = THEME.bg; g.fillRect(0, 0, w, height);
    if (!state.bars) return;

    const b = state.bars;
    const last = Math.min(b.t.length - 1, state.upto);
    const first = Math.max(0, Math.min(state.from, last - 1));
    const end = Math.min(last, state.to);
    const n = end - first + 1;
    if (n < 2) return;

    const padL = 8, padR = 52, padT = 10, padB = 22;
    const cw = w - padL - padR, ch = height - padT - padB - 40;

    let hi = -Infinity, lo = Infinity;
    for (let i = first; i <= end; i++) { if (b.h[i] > hi) hi = b.h[i]; if (b.l[i] < lo) lo = b.l[i]; }
    const pad = (hi - lo) * 0.06 || 1;
    hi += pad; lo -= pad;
    const x = i => padL + (i - first) / (n - 1) * cw;
    const y = p => padT + (hi - p) / (hi - lo) * ch;

    // grid
    g.strokeStyle = THEME.rule; g.lineWidth = 0.5; g.font = '10px ui-monospace, monospace';
    g.fillStyle = THEME.faint; g.textAlign = 'left';
    for (let k = 0; k <= 4; k++) {
      const p = lo + (hi - lo) * k / 4, yy = y(p);
      g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + cw, yy); g.stroke();
      g.fillText(p.toFixed(0), padL + cw + 5, yy + 3);
    }

    // candles (thin bars when dense)
    const bw = Math.max(1, Math.min(7, cw / n * 0.7));
    for (let i = first; i <= end; i++) {
      const up = b.c[i] >= b.o[i];
      g.strokeStyle = g.fillStyle = up ? THEME.up : THEME.down;
      const xi = x(i);
      g.beginPath(); g.moveTo(xi, y(b.h[i])); g.lineTo(xi, y(b.l[i])); g.lineWidth = 1; g.stroke();
      if (bw >= 2) {
        const top = y(Math.max(b.o[i], b.c[i]));
        const hgt = Math.max(1, Math.abs(y(b.o[i]) - y(b.c[i])));
        g.fillRect(xi - bw / 2, top, bw, hgt);
      }
    }

    // indicators
    let ci = 0;
    for (const values of Object.values(state.ind || {})) {
      g.strokeStyle = indicatorColor(ci++); g.lineWidth = 1; g.beginPath();
      let started = false;
      for (let i = first; i <= end; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) { started = false; continue; }
        if (!started) { g.moveTo(x(i), y(v)); started = true; } else g.lineTo(x(i), y(v));
      }
      g.stroke();
    }

    // markers
    for (const tr of state.trades) {
      if (tr.entryIdx >= first && tr.entryIdx <= end) tri(g, x(tr.entryIdx), y(b.l[tr.entryIdx]) + 9, THEME.up, 1);
      if (tr.exitIdx >= first && tr.exitIdx <= end) tri(g, x(tr.exitIdx), y(b.h[tr.exitIdx]) - 9, tr.net >= 0 ? THEME.up : THEME.down, -1);
    }

    // equity strip
    if (state.equity) {
      const ey0 = padT + ch + 12, eh = 30;
      let emin = Infinity, emax = -Infinity;
      for (let i = first; i <= end; i++) { const v = state.equity[i]; if (Number.isFinite(v)) { if (v < emin) emin = v; if (v > emax) emax = v; } }
      if (Number.isFinite(emin) && emax > emin) {
        g.strokeStyle = THEME.amber; g.lineWidth = 1.2; g.beginPath();
        let st = false;
        for (let i = first; i <= end; i++) {
          const v = state.equity[i]; if (!Number.isFinite(v)) continue;
          const yy = ey0 + eh - (v - emin) / (emax - emin) * eh;
          if (!st) { g.moveTo(x(i), yy); st = true; } else g.lineTo(x(i), yy);
        }
        g.stroke();
        g.fillStyle = THEME.faint; g.fillText('EQUITY', padL, ey0 - 2);
      }
    }

    // date axis
    g.fillStyle = THEME.faint; g.textAlign = 'center';
    for (const i of [first, Math.floor((first + end) / 2), end]) {
      g.fillText(new Date(b.t[i]).toISOString().slice(0, 7), x(i), height - 6);
    }
  }

  function tri(g, cx, cy, color, dir) {
    g.fillStyle = color; g.beginPath();
    g.moveTo(cx, cy - 5 * dir); g.lineTo(cx - 4, cy + 3 * dir); g.lineTo(cx + 4, cy + 3 * dir);
    g.closePath(); g.fill();
  }

  const api = {
    kind: 'canvas',
    setData: (bars, ind, upto = Infinity) => { state.bars = bars; state.ind = ind; state.upto = upto; state.to = upto; draw(); },
    setMarkers: (trades, bars, upto = Infinity) => { state.trades = trades.filter(t => t.entryIdx <= upto); draw(); },
    setEquity: (equity) => { state.equity = equity; draw(); },
    focusRange: (a, b2) => { state.from = Math.max(0, a - 10); state.to = b2 + 10; draw(); },
    fitContent: () => { state.from = 0; state.to = Infinity; draw(); },
    destroy: () => { container.innerHTML = ''; },
  };
  window.addEventListener('resize', draw);
  return api;
}

/* ============================================================
   Replay — the reel format. Steps bar by bar, revealing signals.
   ============================================================ */

export function createReplay(chartApi, bars, result, opts = {}) {
  const total = bars.t.length;
  let i = opts.startAt ?? Math.max(0, firstSignalIdx(result) - 30);
  let timer = null;
  let speed = opts.speed ?? 24;         // bars per second

  const listeners = new Set();
  const emit = () => listeners.forEach(f => f({ i, total, done: i >= total - 1 }));

  function render() {
    chartApi.setData(bars, result.indicators || {}, i);
    chartApi.setMarkers(result.trades, bars, i);
    if (chartApi.setEquity) chartApi.setEquity(result.equity);
    emit();
  }

  const api = {
    get index() { return i; },
    get total() { return total; },
    onTick: (f) => { listeners.add(f); return () => listeners.delete(f); },
    seek: (n) => { i = clamp(n, 0, total - 1); render(); },
    step: (d = 1) => api.seek(i + d),
    play: () => {
      if (timer) return;
      timer = setInterval(() => {
        if (i >= total - 1) { api.pause(); return; }
        i++; render();
      }, 1000 / speed);
    },
    pause: () => { clearInterval(timer); timer = null; emit(); },
    get playing() { return !!timer; },
    setSpeed: (s) => { speed = s; if (timer) { api.pause(); api.play(); } },
    destroy: () => { api.pause(); listeners.clear(); },
  };
  render();
  return api;
}

function firstSignalIdx(result) {
  return result.trades?.length ? result.trades[0].entryIdx : 0;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
