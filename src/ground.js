/**
 * Suelo que «siente» el rover: el terreno de dunas más las rocas.
 *
 * Cada roca se aproxima como un elipsoide (su forma es una esfera deformada,
 * achatada al 65 % en altura; ver rocks.js). Las ruedas pueden subirse a las
 * rocas pequeñas y las grandes las bloquean.
 */
const CELL = 6; // m, tamaño de la rejilla para buscar rocas cercanas rápido
const ROCK_HEIGHT = 0.65 * 1.05; // achatado de rocks.js con un margen por el relieve

export function createGround(terrainHeightAt, rocks = []) {
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;

  const shapes = rocks.map((r) => {
    const rx = r.sx, rz = r.sz, ry = r.sy * ROCK_HEIGHT;
    const top = r.y + ry;
    return {
      x: r.x, z: r.z, rx, rz, ry, cy: r.y,
      cos: Math.cos(r.yaw), sin: Math.sin(r.yaw),
      // cuánto sobresale del suelo en su punto más alto
      protrusion: top - terrainHeightAt(r.x, r.z),
    };
  }).filter((s) => s.protrusion > 0.02);

  for (const s of shapes) {
    const reach = Math.max(s.rx, s.rz);
    for (let i = Math.floor((s.x - reach) / CELL); i <= Math.floor((s.x + reach) / CELL); i++) {
      for (let j = Math.floor((s.z - reach) / CELL); j <= Math.floor((s.z + reach) / CELL); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }

  /** Roca más alta bajo el punto (x, z): altura de su superficie ahí y cuánto sobresale. */
  function rockAt(x, z) {
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let best = null;
    if (!list) return best;
    for (const s of list) {
      const dx = x - s.x, dz = z - s.z;
      // a ejes locales de la roca (giro en Y)
      const u = dx * s.cos - dz * s.sin;
      const v = dx * s.sin + dz * s.cos;
      const q = (u / s.rx) ** 2 + (v / s.rz) ** 2;
      if (q >= 1) continue;
      const surface = s.cy + s.ry * Math.sqrt(1 - q);
      if (!best || surface > best.surface) best = { surface, protrusion: s.protrusion };
    }
    return best;
  }

  return {
    terrainHeightAt,
    rockAt,
    /** Altura del suelo en (x, z), contando rocas. */
    heightAt(x, z) {
      const t = terrainHeightAt(x, z);
      const r = rockAt(x, z);
      return r ? Math.max(t, r.surface) : t;
    },
  };
}
