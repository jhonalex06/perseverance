import * as THREE from 'three';
import { fbm } from './terrain.js';

export function createSky({ sunDir, fogColor }) {
  const group = new THREE.Group();

  const uniforms = {
    sunDir: { value: sunDir.clone() },
    zenith: { value: new THREE.Color(0x7a4a2e) },
    horizon: { value: fogColor.clone() },
    sunGlow: { value: new THREE.Color(0xaabfd6) },   // halo azulado del atardecer marciano
    sunColor: { value: new THREE.Color(0xfff0dc) },
    warm: { value: new THREE.Color(0xf0b070) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, zenith, horizon, sunGlow, sunColor, warm;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float c = max(dot(d, normalize(sunDir)), 0.0);
        col += warm * pow(c, 5.0) * 0.35;               // resplandor cálido amplio
        col = mix(col, sunGlow, clamp(pow(c, 40.0) * 0.85, 0.0, 1.0)); // halo azul
        col += sunColor * pow(c, 900.0) * 3.0;           // brillo del disco
        col += sunColor * smoothstep(0.99955, 0.9998, c) * 4.0; // disco solar
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.renderOrder = -1;
  group.add(dome);

  // Lunas: Fobos (grande, irregular) y Deimos (pequeña)
  const moonTex = makeMoonTexture();
  const makeMoon = (radius, squash, seed) => {
    const g = new THREE.IcosahedronGeometry(1, 4);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + fbm(v.x * 1.8 + seed, v.y * 1.8 + v.z, 3, seed) * 0.25);
      p.setXYZ(i, v.x * squash.x, v.y * squash.y, v.z * squash.z);
    }
    g.computeVertexNormals();
    // Pálidas y algo translúcidas: vistas a través del polvo de un cielo de día
    const m = new THREE.MeshStandardMaterial({
      map: moonTex, color: 0xe6d6c4, roughness: 1, fog: false,
      emissive: 0xb88a64, emissiveIntensity: 0.55,
      transparent: true, opacity: 0.8, depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.setScalar(radius);
    return mesh;
  };
  const phobos = makeMoon(12, new THREE.Vector3(1.35, 1.0, 1.1), 3);
  phobos.position.copy(new THREE.Vector3(0.42, 0.095, -1).normalize().multiplyScalar(800));
  phobos.rotation.set(0.4, 1.2, 0.2);
  const deimos = makeMoon(6.5, new THREE.Vector3(1.2, 1.0, 0.9), 8);
  deimos.position.copy(new THREE.Vector3(0.75, 0.15, -1).normalize().multiplyScalar(800));
  group.add(phobos, deimos);

  return { group, uniforms, phobos, deimos };
}

function makeMoonTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x / 40, y / 40, 5, 11) * 0.5 + 0.5;
    const g = 110 + n * 120;
    const i = (y * size + x) * 4;
    img.data[i] = g; img.data[i + 1] = g * 0.92; img.data[i + 2] = g * 0.85; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Cráteres
  for (let k = 0; k < 40; k++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 16;
    const grd = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    grd.addColorStop(0, 'rgba(40,30,25,0.55)');
    grd.addColorStop(0.8, 'rgba(60,45,35,0.25)');
    grd.addColorStop(1, 'rgba(230,215,200,0.25)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
