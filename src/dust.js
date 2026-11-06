import * as THREE from 'three';

export function createDust({ count = 5000, extent = 160, height = 30 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * extent;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * extent;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);

  const mat = new THREE.PointsMaterial({
    size: 0.35, map: tex, color: 0xe8b07c, transparent: true, opacity: 0.55,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const wind = new THREE.Vector3(3.5, 0.15, 1.2);
  function update(dt, center) {
    const a = geo.attributes.position.array;
    const half = extent / 2;
    for (let i = 0; i < count; i++) {
      const j = i * 3;
      a[j] += wind.x * dt * (0.6 + (i % 7) * 0.08);
      a[j + 1] += Math.sin((a[j] + i) * 0.05) * dt * 0.3;
      a[j + 2] += wind.z * dt;
      if (a[j] > half) a[j] -= extent;
      if (a[j + 2] > half) a[j + 2] -= extent;
      if (a[j + 1] > height) a[j + 1] = 0; else if (a[j + 1] < 0) a[j + 1] = height;
    }
    geo.attributes.position.needsUpdate = true;
    points.position.set(center.x, center.y - 8, center.z);
  }
  return { points, update };
}
