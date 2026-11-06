import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTerrain, heightAt } from './terrain.js';
import { createRocks } from './rocks.js';
import { createSky } from './sky.js';
import { createDust } from './dust.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fogColor = new THREE.Color(0xd39a66); // caramelo polvoriento
scene.fog = new THREE.FogExp2(fogColor, 0.0055);

// Sol de tarde, bajo sobre el horizonte
const sunDir = new THREE.Vector3(-0.45, 0.17, -1).normalize();

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2500);
const camX = 0, camZ = 32;
camera.position.set(camX, heightAt(camX, camZ) + 4.5, camZ);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, heightAt(0, 0) + 4, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3;
controls.maxDistance = 200;

// Mundo
scene.add(createTerrain());
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
sun.shadow.radius = 4;
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

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  controls.update();
  placeSun();
  sky.group.position.copy(camera.position);
  sky.phobos.rotation.y = t * 0.02;
  dust.update(dt, camera.position);
  renderer.render(scene, camera);
});

window.__ready = true;
