import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

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

  return { root, model, size, scale, wheelTrack, cameras, cameraInfo: CAMERA_INFO };
}

/** Conducción con WASD (Shift = turbo) y ajuste a la pendiente del terreno. */
export class RoverDriver {
  constructor(root, heightAt, { heading = Math.PI, limit = 320 } = {}) {
    this.root = root;
    this.heightAt = heightAt;
    this.limit = limit;
    this.position = new THREE.Vector3(0, 0, 0);
    this.heading = heading;
    this.speed = 0;
    this.keys = new Set();
    this.halfLength = 1.3;
    this.halfWidth = 1.15;
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    const down = (e) => { this.keys.add(e.code); };
    const up = (e) => { this.keys.delete(e.code); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => this.keys.clear());
    this.fit(1);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  update(dt) {
    const k = this.keys;
    const throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const steer = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
    // El real va a ~4 cm/s; aquí está acelerado para que se pueda explorar.
    const maxSpeed = k.has('ShiftLeft') || k.has('ShiftRight') ? 7 : 3;
    const target = throttle * maxSpeed;
    this.speed += (target - this.speed) * Math.min(1, dt * 2.2);
    if (Math.abs(this.speed) < 0.01 && throttle === 0) this.speed = 0;

    this.heading += steer * 0.9 * dt; // puede girar sobre sí mismo, como el real
    const f = this.forward;
    this.position.addScaledVector(f, this.speed * dt);
    this.position.x = THREE.MathUtils.clamp(this.position.x, -this.limit, this.limit);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -this.limit, this.limit);
    this.fit(Math.min(1, dt * 8));
  }

  /** Coloca el rover sobre el terreno, inclinado según la pendiente. */
  fit(blend) {
    const p = this.position;
    const f = this.forward;
    const left = new THREE.Vector3(f.z, 0, -f.x); // +X del modelo
    const pt = (a, b) => {
      const x = p.x + f.x * a + left.x * b;
      const z = p.z + f.z * a + left.z * b;
      return new THREE.Vector3(x, this.heightAt(x, z), z);
    };
    const F = pt(this.halfLength, 0), B = pt(-this.halfLength, 0);
    const L = pt(0, this.halfWidth), R = pt(0, -this.halfWidth);

    const zAxis = F.clone().sub(B).normalize();
    const xAxis = L.clone().sub(R).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();
    this._q.setFromRotationMatrix(this._m.makeBasis(xAxis, yAxis, zAxis));

    const y = (F.y + B.y + L.y + R.y) / 4;
    p.y = y;
    this.root.position.set(p.x, THREE.MathUtils.lerp(this.root.position.y, y, blend === 1 ? 1 : blend * 1.5), p.z);
    this.root.quaternion.slerp(this._q, blend);
  }
}
