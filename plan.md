# Paisaje de Marte con Vite + Three.js

## Context
Carpeta vacía (solo CLAUDE.md). Node 22, npm 10, Chrome en /usr/bin/google-chrome. Objetivo: escena cinematográfica de Marte visible en vivo en el navegador de Cursor en <2 min, luego mejoras verificadas con `npm run check`.

## Paso 1 — Arranque rápido (<2 min)
- Escribir a mano `package.json` (type module; scripts `dev: vite --host`, `check: node scripts/check.mjs`), `index.html`, `src/main.js` mínimo (terreno con ruido + cielo naranja + luz). No usar `npm create` interactivo.
- `npm i three vite` y `npm i -D playwright-core` (sin descarga de navegadores).
- `npm run dev` en background (puerto 5173) y pasar la URL.

## Paso 2 — Escena completa (src/)
- `terrain.js`: PlaneGeometry alta resolución, dunas con ruido simplex fBm + crestas direccionales, color por vértice (óxido/ocre), MeshStandardMaterial.
- `rocks.js`: InstancedMesh de IcosahedronGeometry deformadas, dispersas sobre la altura del terreno.
- `sky.js`: domo con shader de gradiente caramelo/butterscotch, halo azulado alrededor del sol (rasgo real del atardecer marciano), Phobos y Deimos como esferas pequeñas con textura de ruido.
- Iluminación: DirectionalLight baja y cálida con PCFSoftShadowMap, HemisphereLight, `scene.fog` FogExp2 color polvo; ACESFilmic tone mapping.
- Partículas de polvo (Points) flotando; OrbitControls para mirar.

## Paso 3 — `npm run check` (scripts/check.mjs)
- playwright-core `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle','--enable-unsafe-swiftshader'] })`.
- Abrir http://localhost:5173 (si no responde, levantar vite programáticamente), esperar render, guardar `screenshots/check.png`, listar errores de consola/pageerror, exit 1 si hay errores.

## Verificación (máx. 3 rondas)
Tras cada mejora grande: `npm run check`, leer la captura, corregir. Listo cuando 0 errores y la captura muestre dunas, rocas, cielo caramelo con polvo, sol cálido con sombras suaves y las dos lunas.
