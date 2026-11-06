import * as THREE from 'three';
import { fbm, heightAt } from './terrain.js';

function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 1.3 + seed, v.z * 1.3 + v.y * 0.7, 3, seed);
    const r = 1 + n * 0.55;
    v.multiplyScalar(r);
    v.y *= 0.65; // achatadas
    // Facetas: aplanar la base
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

export function createRocks({ count = 1800, radius = 170 } = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: true });
  const variants = [rockGeometry(1.1), rockGeometry(4.7), rockGeometry(9.3)];
  const perVariant = Math.ceil(count / variants.length);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  const base = new THREE.Color(0x5e3220);
  const alt = new THREE.Color(0x8a5236);

  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);

  variants.forEach((geo, vi) => {
    const mesh = new THREE.InstancedMesh(geo, mat, perVariant);
    for (let i = 0; i < perVariant; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.7) * radius;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      // Más rocas donde no hay dunas altas (zonas de grava)
      const sizeRoll = rand();
      let k = 0.15 + Math.pow(sizeRoll, 6) * 2.8;
      if (i < 6 && vi === 0) { // unas cuantas grandes cerca de la cámara
        p.set(-14 + i * 6 + rand() * 3, 0, 8 + rand() * 12);
        k = 1.2 + rand() * 1.4;
      }
      p.y = heightAt(p.x, p.z) - k * 0.15;
      e.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
      q.setFromEuler(e);
      s.set(k * (0.8 + rand() * 0.6), k * (0.7 + rand() * 0.5), k * (0.8 + rand() * 0.6));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      col.copy(base).lerp(alt, rand());
      mesh.setColorAt(i, col);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}
