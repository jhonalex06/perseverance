import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTerrain, heightAt } from './terrain.js';
import { createRocks } from './rocks.js';
import { createSky } from './sky.js';
import { createDust } from './dust.js';
import { loadRover, RoverDriver } from './rover.js';
import { createTracks } from './tracks.js';
import { createMissionControl } from './mission/panel.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

// Control de misión: telemetría real de Percy (tecla T para ocultar)
createMissionControl();

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0xd39a66); // caramelo polvoriento
scene.fog = new THREE.FogExp2(fogColor, 0.0055);

// Sol de tarde, bajo sobre el horizonte
const sunDir = new THREE.Vector3(-0.45, 0.17, -1).normalize();

// Mundo
scene.add(createTerrain());

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 2500);
camera.position.set(5, heightAt(5, 9) + 3.2, 9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, heightAt(0, 0) + 1.3, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minDistance = 4;
controls.maxDistance = 120;
scene.add(createRocks());
const sky = createSky({ sunDir, fogColor });
scene.add(sky.group);
const dust = createDust();
scene.add(dust.points);

// Luces
const sun = new THREE.DirectionalLight(0xffc999, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3; // bordes suaves (PCF)
const sc = sun.shadow.camera;
sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
sc.near = 1; sc.far = 600;
scene.add(sun, sun.target);

scene.add(new THREE.HemisphereLight(0xe9b585, 0x5a2814, 0.9));
const bounce = new THREE.DirectionalLight(0xc9784a, 0.35); // rebote del suelo/cielo opuesto
bounce.position.copy(sunDir).multiplyScalar(-100).setY(30);
scene.add(bounce);

function placeSun() {
  const t = controls.target;
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(sunDir, 300);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Rover
const tracks = createTracks(heightAt);
scene.add(tracks.mesh);
let rover = null, driver = null;
const followOffset = new THREE.Vector3();
const spherical = new THREE.Spherical();

loadRover().then((r) => {
  rover = r;
  scene.add(r.root);
  driver = new RoverDriver(r.root, heightAt, { heading: Math.PI });
  controls.target.copy(driver.position).add(new THREE.Vector3(0, 1.3, 0));

  console.log(`[Perseverance] Tamaño: ${r.size.x.toFixed(2)} × ${r.size.y.toFixed(2)} × ${r.size.z.toFixed(2)} m (ancho × alto × largo), escala ${r.scale.toFixed(4)}`);
  console.log(`[Perseverance] Piezas que son cámaras (${r.cameras.length}):`);
  for (const c of r.cameras) console.log(`  • ${c.name} — ${r.cameraInfo[c.name] ?? 'cámara'}`);
  window.roverCameras = r.cameras.map((c) => c.name);
  window.__drive = () => ({
    x: +driver.position.x.toFixed(2), y: +driver.position.y.toFixed(2), z: +driver.position.z.toFixed(2),
    heading: +driver.heading.toFixed(2), speed: +driver.speed.toFixed(2),
    fps: +(frames / timer.getElapsed()).toFixed(1),
  });
  window.__ready = true;
}).catch((err) => {
  console.error('[Perseverance] No se pudo cargar el modelo:', err);
});

function followRover(dt) {
  const target = driver.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  const delta = target.clone().sub(controls.target);
  controls.target.copy(target);
  camera.position.add(delta);

  // Al conducir, la cámara se coloca poco a poco detrás del rover
  const moving = Math.min(1, Math.abs(driver.speed) / 2);
  if (moving > 0) {
    followOffset.copy(camera.position).sub(target);
    spherical.setFromVector3(followOffset);
    const behind = driver.heading + Math.PI;
    let d = behind - spherical.theta;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    spherical.theta += d * Math.min(1, dt * 1.6 * moving);
    followOffset.setFromSpherical(spherical);
    camera.position.copy(target).add(followOffset);
  }
  // Nunca bajo el suelo
  const ground = heightAt(camera.position.x, camera.position.z) + 0.6;
  if (camera.position.y < ground) camera.position.y = ground;
}

const timer = new THREE.Timer();
let frames = 0;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  frames++;
  if (driver) {
    driver.update(dt);
    const rear = driver.position.clone().addScaledVector(driver.forward, -1.0);
    tracks.update(rear, driver.forward, rover.wheelTrack);
    followRover(dt);
  }
  controls.update();
  placeSun();
  sky.group.position.copy(camera.position);
  sky.phobos.rotation.y = t * 0.02;
  dust.update(dt, camera.position);
  renderer.render(scene, camera);
});

