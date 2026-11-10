import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { buildRig, DEFAULT_REST, SIDES, WHEELS } from './rig.js';

// Medidas reales de Perseverance (NASA): 3,0 m de largo, 2,7 m de ancho, 2,2 m de alto.
const REAL_LENGTH = 3.0;

// Piezas del modelo de la NASA que son cámaras (las tapas y cables se excluyen).
const CAMERA_PATTERN = /cam|camera|watson|lens/i;
const NOT_CAMERA = /cover|wiring|bracket/i;
const CAMERA_INFO = {
  Mastcam_Z_cams: 'Mastcam-Z: cámaras estéreo con zoom del mástil',
  NavCams: 'Navcams: cámaras de navegación del mástil',
  lens: 'Lente del cabezal del mástil (probablemente SuperCam)',
  hazcams_front: 'Hazcams delanteras: evitan obstáculos',
  hazcams_rear: 'Hazcams traseras: evitan obstáculos',
  WATSON: 'WATSON: cámara de primer plano en la torreta del brazo (SHERLOC)',
  Up_Look_Camera: 'Cámara que mira hacia arriba (registró el descenso)',
  Down_Look_Camera: 'Cámara que mira hacia abajo (registró el aterrizaje)',
};

export async function loadRover(url = '/models/perseverance.glb') {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  draco.dispose();

  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // Escala a tamaño real: el largo (eje Z, de Hazcams traseras a delanteras) = 3,0 m
  model.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(model);
  const rawSize = raw.getSize(new THREE.Vector3());
  const scale = REAL_LENGTH / rawSize.z;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  // Centrado en planta y con las ruedas apoyadas en y = 0
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  const size = box.getSize(new THREE.Vector3());

  const root = new THREE.Group();
  root.name = 'Perseverance';
  root.add(model);
  root.updateMatrixWorld(true);

  // Separación entre las ruedas izquierdas y derechas (para las huellas)
  let wheelTrack = 2.3;
  const wheels = root.getObjectByName('Wheels_objs');
  if (wheels) {
    const wb = new THREE.Box3().setFromObject(wheels);
    wheelTrack = (wb.max.x - wb.min.x) - 0.4; // centro de la banda de rodadura
  }

  const cameras = [];
  model.traverse((o) => {
    if (o.name && CAMERA_PATTERN.test(o.name) && !NOT_CAMERA.test(o.name)) cameras.push(o);
  });

  // Ruedas y suspensión articuladas (rocker-bogie)
  const rig = buildRig(root);
  if (!rig) console.warn('[Perseverance] No se pudo articular la suspensión: el rover irá rígido');

  return { root, model, size, scale, wheelTrack, cameras, cameraInfo: CAMERA_INFO, rig };
}


// ─────────────────────────── Física de conducción ───────────────────────────

/** Datos reales de Perseverance (NASA/JPL). */
export const PERCY = {
  maxSpeed: 0.042, // m/s: 4,2 cm/s, su máximo en suelo plano y duro (152 m por hora)
  maxStep: 0.4, // m: no puede pasar por encima de rocas más altas (~40 cm)
  clearance: 0.6, // m: altura libre bajo la panza (aprox.)
  tiltLimit: 30, // °: aguanta 45° sin volcar, pero sus conductores no pasan de 30°
};

// Valores del juego (estimados: la NASA no los publica así)
const ARC_RADIUS = 3; // m: radio de giro al avanzar con A/D
const STEER_RATE = THREE.MathUtils.degToRad(30); // rad/s simulados de los motores de dirección
const STEER_TOLERANCE = THREE.MathUtils.degToRad(2); // error con el que ya puede rodar
const ACCEL_TIME = 1; // s simulados para llegar a la velocidad pedida
export const TIME_SCALE = 50; // el tiempo del juego va 50 veces más rápido
export const TIME_SCALE_FAST = 150; // con Shift
const DEG = 180 / Math.PI;
const CORNERS = ['LF', 'LR', 'RF', 'RR'];

/**
 * Qué tiene que hacer una rueda para que el rover avance a v (m/s) y gire a w (rad/s)
 * alrededor del eje de las ruedas centrales. Devuelve el ángulo de dirección ideal.
 * Es la geometría de Ackermann doble: delanteras y traseras giran en sentidos opuestos.
 */
function idealSteer(p, v, w, z0) {
  const vx = w * (p.z - z0);
  const vz = v - w * p.x;
  if (Math.abs(vx) < 1e-9 && Math.abs(vz) < 1e-9) return null;
  let a = Math.atan2(vx, vz);
  if (a > Math.PI / 2) a -= Math.PI; // mejor rodar hacia atrás que girar más de 90°
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
}

/** Velocidad (m/s) de una rueda orientada a «steer» para ese movimiento del cuerpo. */
function wheelSpeed(p, v, w, z0, steer) {
  const vx = w * (p.z - z0);
  const vz = v - w * p.x;
  return vx * Math.sin(steer) + vz * Math.cos(steer);
}

/**
 * Conducción con WASD (Shift = tiempo más rápido) con la física de Perseverance:
 * - 6 ruedas con motor; solo las 4 de las esquinas tienen dirección.
 * - Para cambiar de maniobra se detiene, orienta las ruedas y luego rueda.
 * - Puede girar sobre sí mismo (ruedas de esquina en diagonal).
 * - Suspensión rocker-bogie: cada rueda se apoya en su suelo y la barra
 *   diferencial inclina el cuerpo con la media de los dos lados.
 * - Patina en las subidas, se bloquea ante rocas demasiado altas y no pasa de 30°.
 */
export class RoverDriver {
  constructor(root, rig, ground, { heading = Math.PI, limit = 320 } = {}) {
    this.root = root;
    this.rig = rig;
    this.ground = ground;
    this.limit = limit;
    this.position = new THREE.Vector3(0, 0, 0);
    this.heading = heading;
    this.v = 0; // m/s reales del cuerpo
    this.w = 0; // rad/s reales del cuerpo
    this.speed = 0; // m/s en pantalla (con el tiempo acelerado)
    this.timeScale = TIME_SCALE;
    this.slip = 0;
    this.blocked = null;
    this.aligning = false;

    const rest = rig?.rest ?? DEFAULT_REST;
    this.rest = rest;
    this.wheels = rest.wheels;
    this.radius = rest.radius;
    this.z0 = (rest.wheels.LM.z + rest.wheels.RM.z) / 2;
    this.cornerRadius = Math.max(...CORNERS.map((id) => Math.hypot(rest.wheels[id].x, rest.wheels[id].z - this.z0)));
    this.steer = Object.fromEntries(WHEELS.map((id) => [id, 0]));
    this.spin = Object.fromEntries(WHEELS.map((id) => [id, 0]));
    this.wheelV = Object.fromEntries(WHEELS.map((id) => [id, 0]));

    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.place();
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  update(dt) {
    const k = this.keys;
    const throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const steerKey = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
    this.timeScale = k.has('ShiftLeft') || k.has('ShiftRight') ? TIME_SCALE_FAST : TIME_SCALE;
    const h = dt * this.timeScale; // segundos simulados en este fotograma

    // 1. Lo que pide el conductor
    let v = 0, w = 0;
    if (throttle) {
      v = throttle * PERCY.maxSpeed;
      w = (steerKey * PERCY.maxSpeed) / ARC_RADIUS; // arco
    } else if (steerKey) {
      w = (steerKey * PERCY.maxSpeed) / this.cornerRadius; // sobre sí mismo
    }
    // Ninguna rueda puede pasar de la velocidad máxima: en las curvas la de fuera manda
    const fastest = Math.max(...WHEELS.map((id) => Math.hypot(w * (this.wheels[id].z - this.z0), v - w * this.wheels[id].x)));
    if (fastest > PERCY.maxSpeed) { v *= PERCY.maxSpeed / fastest; w *= PERCY.maxSpeed / fastest; }

    // 2. Motores de dirección: se detiene, orienta las ruedas y después rueda
    let worst = 0;
    const targets = {};
    for (const id of CORNERS) {
      const t = v || w ? idealSteer(this.wheels[id], v, w, this.z0) : null;
      targets[id] = t ?? this.steer[id];
      worst = Math.max(worst, Math.abs(targets[id] - this.steer[id]));
    }
    this.aligning = worst > STEER_TOLERANCE;
    const stopped = Math.abs(this.v) < 0.002 && Math.abs(this.w) < 0.002;
    if (stopped || !this.aligning) {
      for (const id of CORNERS) {
        const err = targets[id] - this.steer[id];
        this.steer[id] += THREE.MathUtils.clamp(err, -STEER_RATE * h, STEER_RATE * h);
      }
    }

    // 3. Arranque y frenado suaves
    const a = Math.min(1, h / ACCEL_TIME);
    this.v += ((this.aligning ? 0 : v) - this.v) * a;
    this.w += ((this.aligning ? 0 : w) - this.w) * a;
    if (Math.abs(this.v) < 1e-5) this.v = 0;
    if (Math.abs(this.w) < 1e-5) this.w = 0;

    // 4. Cada rueda gira a su propia velocidad
    for (const id of WHEELS) {
      this.wheelV[id] = wheelSpeed(this.wheels[id], this.v, this.w, this.z0, this.steer[id]);
    }

    // 5. Deslizamiento: en cuesta arriba las ruedas giran más de lo que avanza el rover
    const climb = Math.sign(this.v) * (this.pose?.pitch ?? 0) * DEG;
    this.slip = this.v ? THREE.MathUtils.clamp((climb - 5) / 25, 0, 0.85) : 0;
    const move = 1 - this.slip;

    // 6. Mover el cuerpo, si no hay obstáculo delante
    if (this.v || this.w) {
      const turn = this.w * move * h;
      const mid = this.heading + turn / 2;
      const nh = this.heading + turn;
      const nx = THREE.MathUtils.clamp(this.position.x + Math.sin(mid) * this.v * move * h, -this.limit, this.limit);
      const nz = THREE.MathUtils.clamp(this.position.z + Math.cos(mid) * this.v * move * h, -this.limit, this.limit);
      const obstacle = this.obstacleAt(nx, nz, nh);
      if (obstacle) {
        this.blocked = obstacle;
        this.v = this.w = 0;
        for (const id of WHEELS) this.wheelV[id] = 0;
      } else {
        this.blocked = null;
        this.heading = nh;
        this.position.x = nx;
        this.position.z = nz;
      }
    }
    for (const id of WHEELS) this.spin[id] += (this.wheelV[id] / this.radius) * h;
    this.speed = this.v * move * this.timeScale;

    // 7. Suspensión
    this.place();
  }

  /** ¿Choca o vuelca el rover si se coloca ahí? Devuelve el motivo o null. */
  obstacleAt(px, pz, heading) {
    const s = Math.sin(heading), c = Math.cos(heading);
    const at = (x, z) => [px + x * c + z * s, pz - x * s + z * c];
    for (const id of WHEELS) {
      const rock = this.ground.rockAt(...at(this.wheels[id].x, this.wheels[id].z));
      if (rock && rock.protrusion > PERCY.maxStep) return { tipo: 'roca', metros: rock.protrusion };
    }
    for (const [x, z] of [[0, -0.6], [0, 0], [0, 0.6], [0.5, 0], [-0.5, 0]]) {
      const [wx, wz] = at(x, z);
      const rock = this.ground.rockAt(wx, wz);
      const height = rock ? rock.surface - this.ground.terrainHeightAt(wx, wz) : 0;
      if (height > PERCY.clearance) return { tipo: 'panza', metros: height };
    }
    const tilt = tiltOf(this.solve(px, pz, heading));
    if (tilt > PERCY.tiltLimit && tilt > tiltOf(this.pose)) return { tipo: 'inclinacion', grados: tilt };
    return null;
  }

  /**
   * Suspensión rocker-bogie en 2D por cada lado, con los ejes del rover:
   * 1) el bogie se apoya en la rueda central y la trasera;
   * 2) el rocker une el pivote del bogie con la rueda delantera;
   * 3) la barra diferencial deja el cuerpo a la media de los dos rockers.
   * Ángulos «morro arriba» positivos; roll positivo = lado izquierdo más alto.
   */
  solve(px, pz, heading) {
    const { wheels, radius, rocker: Pr0, bogie: Pb0 } = this.rest;
    const s = Math.sin(heading), c = Math.cos(heading);
    const groundY = (x, z) => this.ground.heightAt(px + x * c + z * s, pz - x * s + z * c) + radius;
    const rot = (dz, dy, a) => [dz * Math.cos(a) - dy * Math.sin(a), dz * Math.sin(a) + dy * Math.cos(a)];
    const out = { rocker: {}, bogie: {}, pivot: {} };
    for (const side of SIDES) {
      const F = wheels[side + 'F'], M = wheels[side + 'M'], R = wheels[side + 'R'];
      const cF = groundY(F.x, F.z), cM = groundY(M.x, M.z), cR = groundY(R.x, R.z);
      const yW = (F.y + M.y + R.y) / 3;
      const beta = Math.atan2(cM - cR, M.z - R.z) - Math.atan2(M.y - R.y, M.z - R.z);
      const [oz, oy] = rot(Pb0.z - (M.z + R.z) / 2, Pb0.y - (M.y + R.y) / 2, beta);
      const Pb = { z: (M.z + R.z) / 2 + oz, y: (cM + cR) / 2 + oy };
      const rho = Math.atan2(cF - Pb.y, F.z - Pb.z) - Math.atan2(yW - Pb0.y, F.z - Pb0.z);
      const [, dy] = rot(Pr0.z - Pb0.z, Pr0.y - Pb0.y, rho);
      out.rocker[side] = rho;
      out.bogie[side] = beta;
      out.pivot[side] = Pb.y + dy;
    }
    out.pitch = (out.rocker.L + out.rocker.R) / 2;
    out.roll = Math.atan2(out.pivot.L - out.pivot.R, 2 * Pr0.x);
    // Altura del cuerpo para que sus pivotes queden donde dicen los rockers
    this._e.set(-out.pitch, 0, out.roll);
    this._q.setFromEuler(this._e);
    let y = 0;
    for (const side of SIDES) {
      const p = new THREE.Vector3(side === 'L' ? Pr0.x : -Pr0.x, Pr0.y, Pr0.z).applyQuaternion(this._q);
      y += (out.pivot[side] - p.y) / 2;
    }
    out.y = y;
    out.rockerRel = { L: out.rocker.L - out.pitch, R: out.rocker.R - out.pitch };
    out.bogieRel = { L: out.bogie.L - out.rocker.L, R: out.bogie.R - out.rocker.R };
    return out;
  }

  /** Coloca cuerpo y articulaciones según la suspensión. */
  place() {
    const pose = this.solve(this.position.x, this.position.z, this.heading);
    this.pose = pose;
    this.position.y = pose.y;
    this.root.position.copy(this.position);
    this._e.set(-pose.pitch, this.heading, pose.roll);
    this.root.quaternion.setFromEuler(this._e);
    this.rig?.pose({ rocker: pose.rockerRel, bogie: pose.bogieRel, steer: this.steer, spin: this.spin });
  }

  /** Estado legible para el panel y para npm run check. */
  get state() {
    const p = this.pose;
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      timeScale: this.timeScale,
      realSpeed: Math.abs(this.v) * (1 - this.slip), // m/s
      yawRate: r2(this.w * (1 - this.slip) * DEG), // °/s reales
      slip: this.slip,
      aligning: this.aligning,
      blocked: this.blocked,
      pitch: r2(p.pitch * DEG), roll: r2(p.roll * DEG), tilt: r2(tiltOf(p)),
      rocker: { L: r2(p.rockerRel.L * DEG), R: r2(p.rockerRel.R * DEG) },
      bogie: { L: r2(p.bogieRel.L * DEG), R: r2(p.bogieRel.R * DEG) },
      wheels: Object.fromEntries(WHEELS.map((id) => [id, {
        steer: r2(this.steer[id] * DEG),
        rpm: r2((this.wheelV[id] / (2 * Math.PI * this.radius)) * 60),
        turns: r2(this.spin[id] / (2 * Math.PI)),
      }])),
      articulated: Boolean(this.rig),
    };
  }
}

const tiltOf = (pose) => (pose ? Math.acos(Math.cos(pose.pitch) * Math.cos(pose.roll)) * DEG : 0);
