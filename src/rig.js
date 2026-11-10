import * as THREE from 'three';

/**
 * Convierte las ruedas y la suspensión del modelo de la NASA en piezas móviles.
 *
 * En el .glb, las 6 ruedas son una sola malla («Wheels_objs») y toda la
 * suspensión otra («suspension»). Aquí se separan por grupos de triángulos
 * conectados y se cuelgan de una jerarquía como la del rover real:
 *
 *   cuerpo
 *   └─ rocker (izq/der)           gira sobre el cuerpo; la barra diferencial lo une al otro lado
 *      ├─ dirección delantera     gira en vertical
 *      │  └─ rueda delantera      rueda sobre su eje
 *      └─ bogie                   gira sobre el rocker
 *         ├─ rueda central        fija: no tiene dirección
 *         └─ dirección trasera
 *            └─ rueda trasera
 *
 * Ejes del rover: +Z hacia delante, +Y arriba, +X a la izquierda.
 */

// Pivotes medidos sobre el modelo ya escalado a tamaño real (m).
const ROCKER_PIVOT = { x: 0.78, y: 0.87, z: 0.385 };
const BOGIE_PIVOT = { x: 0.8, y: 0.635, z: -0.35 };

export const SIDES = ['L', 'R']; // L = izquierda (+X), R = derecha (−X)
export const WHEELS = ['LF', 'LM', 'LR', 'RF', 'RM', 'RR'];

/** Medidas de reserva (las del modelo) por si no se puede articular. */
export const DEFAULT_REST = {
  radius: 0.255,
  rocker: ROCKER_PIVOT,
  bogie: BOGIE_PIVOT,
  wheels: {
    LF: { x: 1.03, y: 0.255, z: 1.235 }, LM: { x: 1.145, y: 0.255, z: 0.09 }, LR: { x: 1.03, y: 0.255, z: -0.95 },
    RF: { x: -1.03, y: 0.255, z: 1.235 }, RM: { x: -1.145, y: 0.255, z: 0.09 }, RR: { x: -1.03, y: 0.255, z: -0.95 },
  },
};

const wheelSlot = (c) => (c.x >= 0 ? 'L' : 'R') + (c.z > 0.6 ? 'F' : c.z < -0.4 ? 'R' : 'M');

/** A qué pieza pertenece un trozo de la suspensión, según dónde está su centro. */
function suspensionPart(c) {
  const side = c.x >= 0 ? 'L' : 'R';
  if (Math.abs(c.x) < 0.66 && c.y > 0.88) return 'body'; // barra diferencial y sus bielas
  if (c.z > 1.0) return side + 'F:steer'; // soporte de dirección delantero
  if (c.z < -0.8) return side + 'R:steer'; // soporte de dirección trasero
  if (c.y < 0.62 && c.z > -0.3) return side + ':bogie'; // brazo y soporte de la rueda central
  return side + (c.z > -0.17 ? ':rocker' : ':bogie');
}

/**
 * Parte una malla en varias según sus grupos de triángulos conectados.
 * classify(centro) devuelve la clave de la pieza. Las mallas nuevas comparten
 * los vértices de la original (solo cambia el índice) y quedan en el espacio de root.
 */
function splitMesh(mesh, classify, boxes) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index.array;
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]);
    parent[find(idx[t + 1])] = a;
    parent[find(idx[t + 2])] = a;
  }

  const v = new THREE.Vector3();
  const comps = new Map();
  for (let i = 0; i < pos.count; i++) {
    const r = find(i);
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { sum: new THREE.Vector3(), n: 0, box: new THREE.Box3() }));
    c.sum.add(v); c.n++; c.box.expandByPoint(v);
  }
  const keyOf = new Map();
  for (const [r, c] of comps) {
    const k = classify(c.sum.divideScalar(c.n));
    keyOf.set(r, k);
    if (!boxes.has(k)) boxes.set(k, new THREE.Box3());
    boxes.get(k).union(c.box);
  }

  const tris = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const k = keyOf.get(find(idx[t]));
    if (!tris.has(k)) tris.set(k, []);
    tris.get(k).push(idx[t], idx[t + 1], idx[t + 2]);
  }

  const out = [];
  for (const [k, list] of tris) {
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
    geo.setIndex(list);
    geo.boundingBox = g.boundingBox;
    geo.boundingSphere = g.boundingSphere;
    const part = new THREE.Mesh(geo, mesh.material);
    part.name = `${mesh.name}:${k}`;
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    mesh.matrixWorld.decompose(part.position, part.quaternion, part.scale);
    out.push([k, part]);
  }
  mesh.removeFromParent();
  return out;
}

/** Construye el rig. root debe estar en el origen, sin girar. Devuelve null si el modelo no encaja. */
export function buildRig(root) {
  root.updateMatrixWorld(true);
  const wheelsNode = root.getObjectByName('Wheels_objs');
  const suspNode = root.getObjectByName('suspension');
  if (!wheelsNode || !suspNode) return null;
  const meshes = (node) => { const m = []; node.traverse((o) => o.isMesh && m.push(o)); return m; };
  if ([...meshes(wheelsNode), ...meshes(suspNode)].some((m) => !m.geometry.index)) return null;

  const boxes = new Map();
  const wheelParts = meshes(wheelsNode).flatMap((m) => splitMesh(m, wheelSlot, boxes));
  const suspParts = meshes(suspNode).flatMap((m) => splitMesh(m, suspensionPart, boxes));

  // Centros y radio de las ruedas, medidos sobre la geometría
  const rest = { wheels: {}, radius: 0, rocker: ROCKER_PIVOT, bogie: BOGIE_PIVOT };
  for (const w of WHEELS) {
    const box = boxes.get(w);
    if (!box) return null;
    const c = box.getCenter(new THREE.Vector3());
    rest.wheels[w] = { x: c.x, y: c.y, z: c.z };
    rest.radius += (box.max.y - box.min.y) / 2 / WHEELS.length;
  }

  const joints = { rocker: {}, bogie: {}, steer: {}, spin: {} };
  const group = (name, p, parent) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(p.x, p.y, p.z);
    root.add(g);
    root.updateMatrixWorld(true);
    if (parent !== root) parent.attach(g);
    return g;
  };
  for (const s of SIDES) {
    const sx = s === 'L' ? 1 : -1;
    const rocker = group(`rocker_${s}`, { ...ROCKER_PIVOT, x: sx * ROCKER_PIVOT.x }, root);
    const bogie = group(`bogie_${s}`, { ...BOGIE_PIVOT, x: sx * BOGIE_PIVOT.x }, rocker);
    joints.rocker[s] = rocker;
    joints.bogie[s] = bogie;
    for (const [pos, holder] of [['F', rocker], ['M', bogie], ['R', bogie]]) {
      const w = s + pos;
      const steer = group(`steer_${w}`, rest.wheels[w], holder);
      joints.steer[w] = steer;
      joints.spin[w] = group(`spin_${w}`, rest.wheels[w], steer);
    }
  }

  root.updateMatrixWorld(true);
  for (const [k, part] of wheelParts) joints.spin[k].attach(part);
  for (const [k, part] of suspParts) {
    if (k === 'body') root.attach(part);
    else if (k.endsWith(':steer')) joints.steer[k.slice(0, 2)].attach(part);
    else joints[k.slice(2)][k[0]].attach(part);
  }

  return {
    rest,
    joints,
    /** Coloca las articulaciones. Ángulos en radianes. */
    pose({ rocker, bogie, steer, spin }) {
      for (const s of SIDES) {
        joints.rocker[s].rotation.x = -rocker[s]; // ángulo «morro arriba» positivo
        joints.bogie[s].rotation.x = -bogie[s];
      }
      for (const w of WHEELS) {
        joints.steer[w].rotation.y = steer[w]; // positivo = hacia la izquierda
        joints.spin[w].rotation.x = spin[w]; // positivo = rodar hacia delante
      }
    },
  };
}
