import { TelemetryAPI } from './telemetry.js';
import { nasaWaypointsProvider, lightTimeProvider } from './providers.js';
import { DATOS } from './points.js';
import { solAt, jezeroHour } from './orbits.js';

const COLOR = { 'nasa.waypoint': '#ff8a4c', 'calculo.luz': '#6fd3ff' };
const RETRY_MS = 30_000;

/**
 * Panel de control de misión sobre la escena. La tecla T lo oculta y lo muestra.
 * Estado legible para pruebas en window.__mision.
 */
export function createMissionControl({ toggleKey = 'KeyT' } = {}) {
  const telemetry = new TelemetryAPI();
  telemetry.addProvider(nasaWaypointsProvider());
  telemetry.addProvider(lightTimeProvider());

  injectStyles();
  const state = { visible: true, datos: {} };
  window.__mision = state;

  const panel = el('aside', { class: 'mc', 'aria-label': 'Control de misión' });
  const head = el('header', { class: 'mc-head' });
  head.innerHTML = `
    <div class="mc-title"><span class="mc-led" aria-hidden="true"></span>Control de misión<kbd title="Ocultar panel">T</kbd></div>
    <div class="mc-sub">Percy · cráter Jezero, Marte</div>
    <div class="mc-clock" aria-live="off"></div>`;
  panel.append(head);
  const clock = head.querySelector('.mc-clock');

  const tab = el('button', { class: 'mc-tab', type: 'button', hidden: '' });
  tab.innerHTML = '<kbd>T</kbd> Control de misión';
  tab.addEventListener('click', () => setVisible(true));
  document.body.append(panel, tab);

  const cards = DATOS.map((obj) => createCard(obj, telemetry, state, panel));

  function tickClock() {
    const now = Date.now();
    const h = jezeroHour(now);
    const hh = String(Math.floor(h)).padStart(2, '0');
    const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    const utc = new Date(now).toISOString().slice(11, 19);
    clock.innerHTML = `<b>SOL ${Math.floor(solAt(now))}</b><span>${hh}:${mm} en Jezero</span><span>${utc} UTC</span>`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  function setVisible(v) {
    state.visible = v;
    panel.hidden = !v;
    tab.hidden = v;
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== toggleKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return;
    setVisible(!state.visible);
  });
  window.addEventListener('resize', () => cards.forEach((c) => c.redraw()));

  return { telemetry, setVisible };
}

function createCard(obj, telemetry, state, panel) {
  const key = obj.identifier.key;
  const meta = telemetry.getMetadata(obj);
  const provider = telemetry.providerOf(obj);
  const color = COLOR[obj.type] ?? '#ff8a4c';
  const live = Boolean(provider?.supportsSubscribe?.(obj));

  const card = el('section', { class: 'mc-card', 'data-key': key, 'data-estado': 'cargando' });
  card.style.setProperty('--c', color);
  card.innerHTML = `
    <div class="mc-row">
      <h3>${obj.name}</h3>
      <span class="mc-src" title="${provider?.source ?? ''}">${live ? '<i class="mc-live"></i>' : ''}${provider?.name ?? 'sin proveedor'}</span>
    </div>
    <div class="mc-body">
      <div class="mc-read">
        <div class="mc-val"><span class="mc-wait">recibiendo…</span></div>
        <div class="mc-detail"></div>
      </div>
      <div class="mc-plot">
        <canvas class="mc-chart" aria-hidden="true"></canvas>
        <div class="mc-axis"><span>sol 0</span><span>toda la misión</span><span class="mc-axis-end"></span></div>
      </div>
    </div>
    <p class="mc-frase">Esperando la primera señal.</p>`;
  panel.append(card);
  const $ = (s) => card.querySelector(s);

  const status = (state.datos[key] = {
    nombre: obj.name,
    unidad: meta.range.unit,
    proveedor: provider?.name ?? null,
    estado: 'cargando',
    valor: null,
    texto: null,
    puntos: 0,
    ultimoSol: null,
  });

  let data = [];
  let values = [];
  const valueOf = (d) => d[meta.range.source];
  const domainOf = (d) => d[meta.domain.source];

  function show(datum) {
    const value = valueOf(datum);
    const parts = obj.formato(value);
    $('.mc-val').innerHTML = parts.map(([n, u]) => `<b>${n}</b><small>${u}</small>`).join(' ');
    $('.mc-frase').textContent = obj.frase({ value, values, data });
    $('.mc-detail').textContent = obj.detalle
      ? obj.detalle(datum)
      : `sol ${domainOf(datum)} · ${data.length} manejos`;
    Object.assign(status, {
      estado: 'ok',
      valor: value,
      texto: parts.map((p) => p.join(' ')).join(' '),
      puntos: data.length,
      ultimoSol: Math.floor(domainOf(datum)),
    });
    card.dataset.estado = 'ok';
  }

  function redraw() {
    if (!data.length) return;
    const xMax = Math.max(solAt(Date.now()), domainOf(data[data.length - 1]));
    $('.mc-axis-end').textContent = `sol ${Math.floor(xMax)}`;
    drawChart($('.mc-chart'), data, domainOf, valueOf, xMax, color, (v) => obj.formato(v).map((p) => p.join(' ')).join(' '));
  }

  async function load() {
    try {
      data = await telemetry.request(obj);
      if (!data.length) throw new Error('el proveedor no devolvió datos');
      values = data.map(valueOf);
      show(data[data.length - 1]);
      redraw();
      if (live) {
        telemetry.subscribe(obj, (datum) => {
          data[data.length - 1] = datum; // el último punto es «ahora»
          values[values.length - 1] = valueOf(datum);
          show(datum);
          redraw();
        });
      }
    } catch (err) {
      status.estado = 'error';
      card.dataset.estado = 'error';
      $('.mc-val').innerHTML = '<span class="mc-wait">sin señal</span>';
      $('.mc-frase').textContent = `No llegó el dato (${err.message}). Reintento en ${RETRY_MS / 1000} s.`;
      console.warn(`[Control de misión] ${obj.name}: ${err.message}`);
      setTimeout(load, RETRY_MS);
    }
  }
  load();
  return { redraw };
}

function drawChart(canvas, data, getX, getY, xMax, color, label) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  let lo = Infinity, hi = -Infinity;
  for (const d of data) { const y = getY(d); if (y < lo) lo = y; if (y > hi) hi = y; }
  const span = hi - lo || 1;
  const top = 14, bottom = h - 4, left = 2, right = w - 6;
  const X = (x) => left + (x / xMax) * (right - left);
  const Y = (y) => bottom - ((y - lo) / span) * (bottom - top);

  // rejilla: máximo, medio y mínimo
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (const y of [top, (top + bottom) / 2, bottom]) {
    ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(right, Math.round(y) + 0.5); ctx.stroke();
  }

  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(X(getX(d)), Y(getY(d))) : ctx.moveTo(X(getX(d)), Y(getY(d)))));
  const last = data[data.length - 1];
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, hexA(color, 0.28));
  fill.addColorStop(1, hexA(color, 0));
  ctx.save();
  ctx.lineTo(X(getX(last)), bottom);
  ctx.lineTo(X(getX(data[0])), bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(X(getX(d)), Y(getY(d))) : ctx.moveTo(X(getX(d)), Y(getY(d)))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const ex = X(getX(last)), ey = Y(getY(last));
  ctx.fillStyle = hexA(color, 0.25);
  ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(ex, ey, 2.8, 0, Math.PI * 2); ctx.fill();

  ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(232,226,218,0.6)';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`máx ${label(hi)}`, left, top - 4);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function el(tag, attrs = {}) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function injectStyles() {
  if (document.getElementById('mc-styles')) return;
  const style = el('style', { id: 'mc-styles' });
  style.textContent = `
  .mc, .mc-tab {
    --mc-bg: rgba(14, 12, 13, 0.74); --mc-line: rgba(255, 214, 186, 0.12);
    --mc-ink: #f1ebe4; --mc-muted: rgba(241, 235, 228, 0.6); --mc-accent: #ff8a4c;
    --mc-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --mc-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-family: var(--mc-sans); color: var(--mc-ink);
  }
  .mc {
    position: fixed; top: 16px; left: 16px; z-index: 5; width: 400px;
    max-height: calc(100% - 32px); overflow-y: auto; overscroll-behavior: contain;
    background: var(--mc-bg); border: 1px solid var(--mc-line); border-radius: 10px;
    backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
    box-shadow: 0 10px 40px rgba(20, 6, 0, 0.35);
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent;
  }
  .mc-head { padding: 10px 14px 9px; border-bottom: 1px solid var(--mc-line); display: grid; gap: 2px; }
  .mc-title {
    display: flex; align-items: center; gap: 8px; font-family: var(--mc-mono);
    font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mc-accent); font-weight: 600;
  }
  .mc-title kbd { margin-left: auto; }
  .mc kbd, .mc-tab kbd {
    font-family: var(--mc-mono); font-size: 11px; color: var(--mc-ink); letter-spacing: 0;
    border: 1px solid rgba(255,255,255,.28); border-bottom-width: 2px; border-radius: 4px; padding: 0 6px;
  }
  .mc-led { width: 7px; height: 7px; border-radius: 50%; background: #7dff9a; box-shadow: 0 0 8px #7dff9a; }
  .mc-sub { font-size: 13px; color: var(--mc-muted); }
  .mc-clock { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--mc-mono); font-size: 11.5px; color: var(--mc-muted); font-variant-numeric: tabular-nums; }
  .mc-clock b { color: var(--mc-ink); font-weight: 600; }
  .mc-card { padding: 10px 14px; border-bottom: 1px solid var(--mc-line); display: grid; gap: 6px; }
  .mc-body { display: grid; grid-template-columns: 148px minmax(0, 1fr); gap: 12px; align-items: end; }
  .mc-read { display: grid; gap: 2px; min-width: 0; }
  .mc-plot { min-width: 0; }
  .mc-card:last-child { border-bottom: 0; }
  .mc-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .mc-card h3 { margin: 0; font-size: 11px; font-family: var(--mc-mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--mc-muted); font-weight: 600; }
  .mc-src { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--c); opacity: .9; white-space: nowrap; }
  .mc-live { width: 6px; height: 6px; border-radius: 50%; background: var(--c); animation: mc-pulse 1.6s ease-in-out infinite; }
  .mc-val { font-family: var(--mc-mono); font-variant-numeric: tabular-nums; line-height: 1.1; min-height: 30px; }
  .mc-val b { font-size: 24px; font-weight: 600; color: var(--mc-ink); }
  .mc-val small { font-size: 13px; color: var(--c); margin-left: 3px; }
  .mc-wait { font-size: 13px; color: var(--mc-muted); }
  .mc-card[data-estado="cargando"] .mc-wait::after { content: ""; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: var(--c); animation: mc-pulse 1s ease-in-out infinite; }
  .mc-card[data-estado="error"] .mc-wait { color: #ffb0a0; }
  .mc-detail { font-family: var(--mc-mono); font-size: 11px; color: var(--mc-muted); font-variant-numeric: tabular-nums; min-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mc-chart { width: 100%; height: 46px; display: block; }
  .mc-axis { display: flex; justify-content: space-between; font-family: var(--mc-mono); font-size: 10px; color: rgba(241,235,228,.42); }
  .mc-frase { margin: 0; font-size: 12.5px; line-height: 1.4; color: rgba(241,235,228,.86); text-wrap: pretty; }
  .mc-tab {
    position: fixed; left: 16px; bottom: 16px; z-index: 5; display: inline-flex; align-items: center; gap: 8px;
    background: var(--mc-bg); border: 1px solid var(--mc-line); border-radius: 999px; padding: 6px 12px 6px 8px;
    font-size: 12px; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  }
  .mc-tab:hover { border-color: var(--mc-accent); }
  .mc-tab:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .mc[hidden], .mc-tab[hidden] { display: none !important; }
  @keyframes mc-pulse { 50% { opacity: .25; } }
  @media (prefers-reduced-motion: reduce) { .mc-live, .mc-card .mc-wait::after { animation: none; } }
  @media (max-width: 720px) {
    .mc { width: auto; right: 16px; max-height: 52%; }
    .mc-body { grid-template-columns: 132px minmax(0, 1fr); }
  }`;
  document.head.append(style);
}
