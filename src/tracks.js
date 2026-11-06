import * as THREE from 'three';

function treadTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#a8a8a8';
  ctx.fillRect(0, 0, 64, 128);
  // Grousers en "V" de las ruedas de Perseverance
  ctx.strokeStyle = '#5a5a5a';
  ctx.lineWidth = 7;
  for (let y = -16; y < 144; y += 21) {
    ctx.beginPath();
    ctx.moveTo(2, y + 8); ctx.lineTo(32, y); ctx.lineTo(62, y + 8);
    ctx.stroke();
  }
  // Bordes suaves
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0)');
  g.addColorStop(0.88, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Huellas de las ruedas: dos tiras (izquierda y derecha) en un búfer circular.
 * Se tiñen multiplicando el color del suelo, así se ven como surcos oscuros.
 */
export function createTracks(heightAt, { maxSegments = 4000, width = 0.42, spacing = 0.25 } = {}) {
  const total = maxSegments * 2;
  const positions = new Float32Array(total * 4 * 3);
  const uvs = new Float32Array(total * 4 * 2);
  const index = new Uint32Array(total * 6);
  for (let i = 0; i < total; i++) {
    const v = i * 4, j = i * 6;
    index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const mat = new THREE.MeshBasicMaterial({
    map: treadTexture(),
    transparent: true,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    toneMapped: false,
    fog: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  let cursor = 0;
  const sides = [null, null]; // último punto de cada lado: {x, z, px, pz, v}
  const last = new THREE.Vector3(Infinity, 0, Infinity);

  function writeQuad(a, b) {
    const i = cursor;
    cursor = (cursor + 1) % total;
    const hw = width / 2;
    const corners = [
      [a.x - a.px * hw, a.z - a.pz * hw, 0, a.v],
      [a.x + a.px * hw, a.z + a.pz * hw, 1, a.v],
      [b.x - b.px * hw, b.z - b.pz * hw, 0, b.v],
      [b.x + b.px * hw, b.z + b.pz * hw, 1, b.v],
    ];
    corners.forEach(([x, z, u, v], k) => {
      const o = (i * 4 + k) * 3;
      positions[o] = x; positions[o + 1] = heightAt(x, z) + 0.015; positions[o + 2] = z;
      const t = (i * 4 + k) * 2;
      uvs[t] = u; uvs[t + 1] = v;
    });
  }

  /** Llamar cada fotograma con el centro del eje trasero, el avance y la separación de ruedas. */
  function update(center, forward, wheelTrack) {
    const moved = Math.hypot(center.x - last.x, center.z - last.z);
    if (moved < spacing) return;
    const reset = moved > 3; // primer punto o salto: no unir
    last.copy(center);
    const px = forward.z, pz = -forward.x; // perpendicular (izquierda)
    for (let s = 0; s < 2; s++) {
      const off = (s === 0 ? 1 : -1) * wheelTrack / 2;
      const prev = sides[s];
      const p = {
        x: center.x + px * off, z: center.z + pz * off, px, pz,
        v: prev && !reset ? prev.v + moved / 0.45 : 0,
      };
      if (prev && !reset) writeQuad(prev, p);
      sides[s] = p;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
  }

  return { mesh, update };
}
