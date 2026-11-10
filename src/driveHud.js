/**
 * Indicador de conducción (abajo a la derecha): velocidad real, tiempo
 * acelerado, ruedas, suspensión y avisos. Usa el estilo del control de misión.
 */
const num = (v, d = 1) =>
  v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
const signed = (v) => (v > 0 ? '+' : '') + num(v);

export function createDriveHud(driver) {
  injectStyles();
  const el = document.createElement('aside');
  el.className = 'dh';
  el.setAttribute('aria-label', 'Conducción');
  el.innerHTML = `
    <div class="dh-top"><span class="dh-title">Conducción</span><span class="dh-warp"></span></div>
    <div class="dh-speed"><b></b><small>cm/s reales</small><span class="dh-rpm"></span></div>
    <dl>
      <dt>Inclinación</dt><dd class="dh-tilt"></dd>
      <dt>Rockers</dt><dd class="dh-rocker"></dd>
      <dt>Deslizamiento</dt><dd class="dh-slip"></dd>
    </dl>
    <div class="dh-msg" aria-live="polite"></div>
    <div class="dh-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> conducir · <kbd>Shift</kbd> tiempo ×150</div>`;
  document.body.append(el);
  const $ = (s) => el.querySelector(s);
  let last = '';

  return function update() {
    const s = driver.state;
    const msg = s.blocked
      ? s.blocked.tipo === 'inclinacion'
        ? `Detenido: se inclinaría ${num(s.blocked.grados, 0)}° (máximo 30°)`
        : s.blocked.tipo === 'panza'
          ? `Detenido: la roca tocaría la panza (${num(s.blocked.metros, 2)} m)`
          : `Detenido: roca de ${num(s.blocked.metros, 2)} m (pasa hasta 0,40 m)`
      : s.aligning ? 'Orientando las ruedas antes de rodar…'
        : s.realSpeed === 0 && s.yawRate ? `Girando sobre sí mismo a ${num(Math.abs(s.yawRate))}°/s reales` : '';
    const maxRpm = Math.max(...Object.values(s.wheels).map((w) => Math.abs(w.rpm)));
    const html = [
      `×${s.timeScale}`,
      num(s.realSpeed * 100),
      `ruedas ${num(maxRpm)} rpm`,
      `${num(s.tilt)}°`,
      `izq ${signed(s.rocker.L)}° · der ${signed(s.rocker.R)}°`,
      `${num(s.slip * 100, 0)} %`,
      msg,
    ];
    const key = html.join('|');
    if (key === last) return;
    last = key;
    $('.dh-warp').textContent = `tiempo ${html[0]}`;
    $('.dh-speed b').textContent = html[1];
    $('.dh-rpm').textContent = html[2];
    $('.dh-tilt').textContent = html[3];
    $('.dh-rocker').textContent = html[4];
    $('.dh-slip').textContent = html[5];
    $('.dh-msg').textContent = msg;
    el.dataset.alert = s.blocked ? 'stop' : s.aligning ? 'steer' : '';
  };
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
  .dh {
    position: fixed; right: 16px; bottom: 16px; z-index: 5; width: 270px;
    padding: 10px 14px 10px; display: grid; gap: 6px;
    background: rgba(14, 12, 13, 0.74); border: 1px solid rgba(255, 214, 186, 0.12); border-radius: 10px;
    backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
    color: #f1ebe4; font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  }
  .dh-top { display: flex; justify-content: space-between; align-items: baseline; }
  .dh-title { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #ff8a4c; font-weight: 600; }
  .dh-warp { font-family: var(--mono); font-size: 11px; color: #6fd3ff; }
  .dh-speed { display: flex; align-items: baseline; gap: 5px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .dh-speed b { font-size: 22px; font-weight: 600; }
  .dh-speed small { color: #ff8a4c; font-size: 12px; }
  .dh-rpm { margin-left: auto; color: rgba(241,235,228,.6); font-size: 11px; }
  .dh dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .dh dt { color: rgba(241,235,228,.6); }
  .dh dd { margin: 0; text-align: right; font-family: var(--mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .dh-msg:empty { display: none; }
  .dh-msg { font-size: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(111, 211, 255, .12); color: #bfe9ff; }
  .dh[data-alert="stop"] .dh-msg { background: rgba(255, 120, 90, .16); color: #ffc2b2; }
  .dh-keys { color: rgba(241,235,228,.5); font-size: 11px; }
  .dh kbd { font-family: var(--mono); font-size: 10px; border: 1px solid rgba(255,255,255,.25); border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; margin-right: 2px; color: #f1ebe4; }
  @media (max-width: 720px) { .dh { left: 16px; right: 16px; width: auto; } .dh-keys { display: none; } }`;
  document.head.append(style);
}
