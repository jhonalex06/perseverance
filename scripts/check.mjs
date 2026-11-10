// npm run check — abre la escena en Chrome invisible, comprueba el control de misión (4 datos + tecla T) y la física de conducción, captura pantalla y lista errores de consola.
// Usa el Chrome del sistema (playwright-core, sin descargar navegadores).
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const OUT = path.resolve('screenshots');
let url = process.env.CHECK_URL || 'http://localhost:5173/';

async function isUp(u) {
  try { return (await fetch(u)).ok; } catch { return false; }
}

let server = null;
if (!(await isUp(url))) {
  console.log(`No hay servidor en ${url}; arrancando Vite temporal...`);
  server = await createServer({ server: { port: 5199 }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (m) => {
  const line = `[${m.type()}] ${m.text()}`;
  (m.type() === 'error' ? errors : logs).push(line);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`); });

// La CDN de la NASA responde 403 a Chrome sin ventana (HeadlessChrome), así que en el check
// el JSON lo descarga Node (sin disfrazarse de nada) y se lo entrega a la página tal cual.
// En tu Chrome normal el juego lo pide directamente a la NASA.
const nasa = { peticiones: 0, http: null, bytes: 0 };
await page.route(/mars\.nasa\.gov\/mmgis-maps\/M20\/Layers\/json\/M20_waypoints\.json/, async (route) => {
  nasa.peticiones++;
  try {
    const r = await fetch(route.request().url(), { signal: AbortSignal.timeout(30_000) });
    const body = Buffer.from(await r.arrayBuffer());
    Object.assign(nasa, { http: r.status, bytes: body.length });
    await route.fulfill({
      status: r.status, body,
      headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'access-control-allow-origin': '*' },
    });
  } catch (e) {
    errors.push(`[nasa] No se pudo descargar el historial de manejos: ${e.message}`);
    await route.abort();
  }
});

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90_000 });
} catch {
  errors.push('[timeout] La escena no terminó de cargar (window.__ready) en 90 s');
}
await page.waitForTimeout(1500);

// Control de misión: los 4 datos tienen que llegar con números reales y plausibles
const MISION = {
  distancia: { min: 1, max: 200, puntos: 100 },        // km recorridos (NASA)
  altura: { min: -5000, max: 1000, puntos: 100 },      // m sobre el nivel cero (NASA)
  inclinacion: { min: 0, max: 45, puntos: 100 },       // grados (NASA)
  luz: { min: 180, max: 1400, puntos: 1000 },          // s: entre 3 y 23,3 min (cálculo, un punto por sol)
};
try {
  await page.waitForFunction(
    (keys) => keys.every((k) => window.__mision?.datos?.[k]?.estado === 'ok'),
    Object.keys(MISION), { timeout: 45_000 },
  );
} catch {
  errors.push('[mision] Los 4 datos no cargaron en 45 s');
}
const mision = await page.evaluate(() => window.__mision ?? null);
if (!mision) errors.push('[mision] No existe window.__mision: el panel no arrancó');
for (const [key, r] of Object.entries(MISION)) {
  const d = mision?.datos?.[key];
  if (!d) { errors.push(`[mision] Falta el dato «${key}»`); continue; }
  if (d.estado !== 'ok') errors.push(`[mision] ${d.nombre}: estado «${d.estado}»`);
  else if (!Number.isFinite(d.valor) || d.valor < r.min || d.valor > r.max)
    errors.push(`[mision] ${d.nombre}: valor fuera de rango (${d.valor}, esperado ${r.min}…${r.max})`);
  else if (d.puntos < r.puntos) errors.push(`[mision] ${d.nombre}: solo ${d.puntos} puntos en la gráfica (mínimo ${r.puntos})`);
  if (!d.proveedor) errors.push(`[mision] ${d.nombre}: no tiene proveedor`);
  if (!d.unidad) errors.push(`[mision] ${d.nombre}: no tiene unidad`);
}

fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'check.png') });

// Tecla T: oculta y vuelve a mostrar el panel
const panelShown = () => page.evaluate(() => {
  const el = document.querySelector('.mc');
  return { estado: window.__mision?.visible, pantalla: !!el && getComputedStyle(el).display !== 'none' };
});
await page.keyboard.press('KeyT');
await page.waitForTimeout(300);
const trasT = await panelShown();
await page.screenshot({ path: path.join(OUT, 'check-oculto.png') });
await page.keyboard.press('KeyT');
await page.waitForTimeout(300);
const trasTT = await panelShown();
if (trasT.estado !== false || trasT.pantalla) errors.push('[mision] La tecla T no ocultó el panel');
if (trasTT.estado !== true || !trasTT.pantalla) errors.push('[mision] Una segunda T no volvió a mostrar el panel');

// Prueba de conducción con la física de Perseverance
const snap = () => page.evaluate(() => window.__drive?.() ?? null);
const fisica = [];
const expect = (ok, msg) => { fisica.push(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) errors.push(`[fisica] ${msg}`); };
const WHEEL_IDS = ['LF', 'LM', 'LR', 'RF', 'RM', 'RR'];
const d0 = await snap();
expect(d0?.fisica?.articulated, 'Ruedas y suspensión separadas en piezas móviles');

// 1) Recto: las 6 ruedas giran igual, ninguna dirigida, a 4,2 cm/s reales
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
const d1 = await snap();
const w1 = d1.fisica.wheels;
expect(WHEEL_IDS.every((id) => w1[id].turns > d0.fisica.wheels[id].turns + 0.05), 'Recto: las 6 ruedas ruedan hacia delante');
expect(WHEEL_IDS.every((id) => Math.abs(w1[id].steer) < 1), 'Recto: ruedas sin girar la dirección');
expect(Math.abs(d1.fisica.realSpeed - 0.042) < 0.003 || d1.fisica.slip > 0, `Recto: velocidad real ${(d1.fisica.realSpeed * 100).toFixed(1)} cm/s (Percy: 4,2 cm/s)`);
expect(Math.abs(d1.fisica.rocker.L + d1.fisica.rocker.R) < 0.05, `Barra diferencial: rockers opuestos (${d1.fisica.rocker.L}° y ${d1.fisica.rocker.R}°)`);

// 2) Arco a la izquierda: delanteras y traseras giran en sentidos opuestos
await page.keyboard.down('KeyA');
await page.waitForTimeout(4000);
const d2 = await snap();
const w2 = d2.fisica.wheels;
expect(w2.LF.steer > 3 && w2.LR.steer < -3 && w2.LM.steer === 0, `Arco: delantera ${w2.LF.steer}°, trasera ${w2.LR.steer}°, central fija`);
expect(d2.heading > d1.heading, 'Arco: el rumbo gira a la izquierda');
await page.keyboard.up('KeyA');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(1500);

// 3) Giro sobre sí mismo: esquinas en diagonal, sin desplazarse
const d3a = await snap();
await page.keyboard.down('KeyA');
await page.waitForTimeout(4000);
const d3 = await snap();
await page.keyboard.up('KeyA');
const w3 = d3.fisica.wheels;
const moved = Math.hypot(d3.x - d3a.x, d3.z - d3a.z);
expect(Math.abs(w3.LF.steer) > 30 && Math.sign(w3.LF.steer) === -Math.sign(w3.LR.steer), `Sobre sí mismo: esquinas en diagonal (${w3.LF.steer}° / ${w3.LR.steer}°)`);
expect(d3.heading > d3a.heading + 0.05 && moved < 0.05, `Sobre sí mismo: gira ${((d3.heading - d3a.heading) * 57.3).toFixed(0)}° moviéndose ${moved.toFixed(2)} m`);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'check-drive.png') });

const drive = await snap();
await browser.close();
if (server) await server.close();

console.log(`\nCarga: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Capturas: ${path.join(OUT, 'check.png')}  ${path.join(OUT, 'check-drive.png')}`);
if (drive) {
  const { fisica: f, ...pos } = drive;
  console.log('Rover tras conducir:', JSON.stringify(pos));
  console.log(`\nFísica (tiempo ×${f.timeScale}, inclinación ${f.tilt}°, rockers ${f.rocker.L}°/${f.rocker.R}°, bogies ${f.bogie.L}°/${f.bogie.R}°):`);
  for (const l of fisica) console.log('  ' + l);
}
if (mision) {
  console.log(`\nControl de misión (JSON de la NASA: HTTP ${nasa.http}, ${(nasa.bytes / 1024).toFixed(0)} KB, ${nasa.peticiones} petición/es):`);
  for (const d of Object.values(mision.datos)) {
    console.log(`  ${d.estado === 'ok' ? '✓' : '✗'} ${d.nombre.padEnd(30)} ${String(d.texto ?? '—').padEnd(16)} ${String(d.puntos).padStart(5)} puntos · ${d.proveedor}`);
  }
  console.log(`  Tecla T: ${!trasT.pantalla && trasTT.pantalla ? '✓ oculta y vuelve a mostrar' : '✗ no funciona'}`);
}
console.log(`\nConsola (${logs.length}):`);
for (const l of logs) console.log('  ' + l);
console.log(`\nErrores (${errors.length}):`);
for (const e of errors) console.log('  ' + e);
process.exit(errors.length ? 1 : 0);
