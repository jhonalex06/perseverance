// npm run check — abre la escena en Chrome invisible, captura pantalla y lista errores de consola.
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

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90_000 });
} catch {
  errors.push('[timeout] La escena no terminó de cargar (window.__ready) en 90 s');
}
await page.waitForTimeout(1500);
fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'check.png') });

// Prueba de conducción: avanza, gira a la izquierda y sigue avanzando
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
await page.keyboard.down('KeyA');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyA');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'check-drive.png') });

const drive = await page.evaluate(() => window.__drive?.() ?? null);
await browser.close();
if (server) await server.close();

console.log(`\nCarga: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Capturas: ${path.join(OUT, 'check.png')}  ${path.join(OUT, 'check-drive.png')}`);
if (drive) console.log('Rover tras conducir:', JSON.stringify(drive));
console.log(`\nConsola (${logs.length}):`);
for (const l of logs) console.log('  ' + l);
console.log(`\nErrores (${errors.length}):`);
for (const e of errors) console.log('  ' + e);
process.exit(errors.length ? 1 : 0);
