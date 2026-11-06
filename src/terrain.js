import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

const perlin = new ImprovedNoise();
const SEED = 17.3;

export function fbm(x, z, octaves = 4, seed = 0) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += perlin.noise(x * freq, z * freq, SEED + seed + o * 7.1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Altura y "fase de duna" (0 valle → 1 cresta) en (x, z). */
export function sample(x, z) {
  // Ondulación de gran escala
  let h = fbm(x * 0.0035, z * 0.0035, 4) * 18;

  // Coordenadas deformadas para que las dunas serpenteen
  const wx = x + fbm(x * 0.008, z * 0.008, 2, 50) * 40;
  const wz = z + fbm(x * 0.008, z * 0.008, 2, 90) * 40;
  const along = wx * 0.8 + wz * 0.6; // perpendicular al viento

  // Dunas asimétricas: ladera de barlovento suave, sotavento empinado
  const u = along * 0.035;
  const s = u - Math.floor(u);
  let dune = s < 0.78 ? s / 0.78 : (1 - s) / 0.22;
  dune = smooth(dune);
  const mask = THREE.MathUtils.clamp(0.55 + fbm(x * 0.006, z * 0.006, 2, 30) * 1.4, 0, 1);
  h += dune * mask * 5.5;

  // Ondas de arena (ripples) y grano fino
  h += Math.sin(along * 0.85 + fbm(x * 0.05, z * 0.05, 1, 5) * 3) * 0.05 * (0.4 + mask);
  h += fbm(x * 0.06, z * 0.06, 3, 70) * 0.5;

  return { h, dune: dune * mask };
}

export const heightAt = (x, z) => sample(x, z).h;

export function createTerrain({ size = 700, segments = 420 } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  const dark = new THREE.Color(0x6e2e14);
  const mid = new THREE.Color(0xa24a20);
  const light = new THREE.Color(0xc87a42);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const { h, dune } = sample(x, z);
    pos.setY(i, h);

    const n = fbm(x * 0.03, z * 0.03, 3, 200) * 0.5 + 0.5;
    const t = THREE.MathUtils.clamp(dune * 0.7 + n * 0.45, 0, 1);
    c.copy(dark).lerp(mid, Math.min(t * 1.6, 1));
    if (t > 0.6) c.lerp(light, (t - 0.6) / 0.4);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
