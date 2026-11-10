import * as THREE from 'three/webgpu';
import { uv, vec3, float, sqrt, dot, smoothstep, max, mix, fract, sin, floor, vec2, uniform } from 'three/tsl';
import { log } from '../lamp-game.js';
import { cityUniforms } from './tsl-materials.js';

// Lamp: the moon in tonight's real phase, by the game's clock: its age since a known new moon (6 Jan 2000, 18:14 UTC)
// over the synodic month. A disc far out in the sky where the night light comes from (lighting.js's moonlight), lit on
// its sunward side (the right while it waxes, as seen from Michigan), faint gray maria on it; it fades in as night
// falls and out at dawn, and is gone at new moon.

const SYNODIC = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const DIR = new THREE.Vector3(-0.42, 0.68, 0.60).normalize(); // lighting.js TIME_PRESETS.midnight.sunDir
// its size as seen from 40 km; it's drawn inside the camera's far plane (9 km on a phone, 14 on the Xbox) and scaled to
// keep that size
const DISTANCE = 40000, RADIUS = 520;

function moonAge(now = Date.now()) {
  const days = (now - NEW_MOON) / 864e5;
  return ((days / SYNODIC) % 1 + 1) % 1;
}

const PHASES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];

function createMoon(group) {
  group.name = 'Moon';
  const age = moonAge();
  const angle = age * Math.PI * 2;
  const uSun = uniform(new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)));
  const lit = (1 - Math.cos(angle)) / 2;

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
  {
    const p = uv().mul(2).sub(1);
    const r2 = dot(p, p);
    const disc = float(1).sub(smoothstep(0.96, 1.0, r2));
    const n = vec3(p.x, p.y, sqrt(max(float(0), float(1).sub(r2))));
    const light = smoothstep(-0.04, 0.08, dot(n, uSun));
    // the maria, a few soft dark seas
    const q = p.mul(2.2);
    const seas = smoothstep(0.55, 0.85, hash(floor(q.add(0.3))).mul(0.6).add(hash(floor(q.mul(1.7))).mul(0.4)));
    const face = mix(vec3(0.95, 0.94, 0.9), vec3(0.62, 0.63, 0.64), seas.mul(0.6));
    // earthshine leaves the dark side just visible
    const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
    mat.colorNode = face.mul(mix(float(0.035), float(1.6), light));
    mat.opacityNode = disc.mul(night);
  }

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2), mat);
  mesh.name = 'Moon';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = lit > 0.015;
  group.add(mesh);
  log(`[moon] ${PHASES[Math.round(age * 8) % 8]}, ${Math.round(lit * 100)}% lit`);

  function update(camera) {
    if (!mesh.visible || !camera) return;
    const distance = Math.min(DISTANCE, (camera.far || DISTANCE) * 0.9);
    mesh.scale.setScalar(distance / DISTANCE);
    mesh.position.copy(camera.position).addScaledVector(DIR, distance);
    mesh.lookAt(camera.position);
  }
  return { update, lit };
}

export { createMoon, moonAge };
