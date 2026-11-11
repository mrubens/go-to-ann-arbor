import * as THREE from 'three/webgpu';
import { uv, vec3, float, dot, smoothstep, max, mix, sin, uniform, attribute, positionWorld, cameraPosition, normalize, clamp, pow } from 'three/tsl';
import { log } from '../lamp-game.js';
import { STARS } from './star-catalog.js';
import { gameMoment } from './game-clock.js';

// Lamp: the night sky's stars where they really are over Ann Arbor at the game's time (game-clock.js gameMoment):
// every naked-eye star (star-catalog.js) as a small soft quad on a sphere round the camera, laid out once in the sky's
// own frame (right ascension and declination) and turned each frame by the local sidereal time and tilted to Ann
// Arbor's latitude, so the Dipper wheels round Polaris, Orion rises in winter evenings and the summer triangle is high
// in July. They come out as the sky darkens (lighting.js nightFactor), go behind the weather's clouds, sink into the
// haze near the horizon and twinkle a little; the town's lights wash the faint ones out, so the countryside, high up
// in the helicopter, or out at the Arb shows more than downtown.

const LAT = 42.2808 * Math.PI / 180, LON = -83.7430; // Ann Arbor
const DISTANCE = 30000;
// how many of the stars show: brighter than this magnitude downtown, and out in the dark country
const LIMIT_TOWN = 4.2, LIMIT_COUNTRY = 5.4;

// Greenwich mean sidereal time (degrees) at a Date's milliseconds
function siderealDegrees(ms) {
  const d = ms / 864e5 + 2440587.5 - 2451545.0;
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
}

// B-V colour index to a star's tint
function tint(bv, out) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  // blue-white through white and yellow to orange-red
  if (t < 0) out.setRGB(0.72, 0.8, 1.0);
  else if (t < 0.4) out.setRGB(0.72 + t * 0.7, 0.8 + t * 0.45, 1.0);
  else if (t < 1.0) out.setRGB(1.0, 0.98 - (t - 0.4) * 0.22, 1.0 - (t - 0.4) * 0.6);
  else out.setRGB(1.0, 0.85 - (t - 1.0) * 0.2, 0.64 - (t - 1.0) * 0.25);
  return out;
}

function createStars(group) {
  group.name = 'Stars';
  const n = STARS.length / 4;
  const pos = new Float32Array(n * 12), uvs = new Float32Array(n * 8), col = new Float32Array(n * 12), mags = new Float32Array(n * 4);
  const index = new Uint32Array(n * 6);
  const c = new THREE.Color(), e = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const ra = STARS[i * 4] / 100 * Math.PI / 180, dec = STARS[i * 4 + 1] / 100 * Math.PI / 180;
    const mag = STARS[i * 4 + 2] / 100, bv = STARS[i * 4 + 3] / 100;
    e.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
    // a quad facing the centre, a point of light: nearly the same small size for all (about 1 px for the faintest at a
    // usual view, 2-3 for Sirius), their brightness carrying the difference
    up.set(0, 0, 1);
    if (Math.abs(e.z) > 0.99) up.set(1, 0, 0);
    a.crossVectors(up, e).normalize(); b.crossVectors(e, a);
    const size = 0.0009 + 0.00022 * Math.max(0, 5.6 - mag);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    tint(bv, c);
    corners.forEach(([u, v], k) => {
      const j = i * 4 + k;
      pos[j * 3] = e.x + (a.x * u + b.x * v) * size;
      pos[j * 3 + 1] = e.y + (a.y * u + b.y * v) * size;
      pos[j * 3 + 2] = e.z + (a.z * u + b.z * v) * size;
      uvs[j * 2] = u; uvs[j * 2 + 1] = v;
      col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b;
      mags[j] = mag + (i % 97) / 1000; // (the thousandths: each its own twinkle)
    });
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('mag', new THREE.BufferAttribute(mags, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);

  const uShow = uniform(0), uLimit = uniform(LIMIT_TOWN), uTime = uniform(0);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  {
    const m = attribute('mag', 'float');
    const p = uv();
    const r2 = dot(p, p);
    const core = max(float(0), float(1).sub(r2)).pow(2.2);
    // brighter by magnitude (each one 2.5 times the next), fading out at the sky's limit tonight
    const bright = pow(float(2.512), float(1.2).sub(m)).min(6).mul(1.6).add(0.22);
    const seen = smoothstep(uLimit.add(0.35), uLimit.sub(0.35), m);
    // low in the sky: dimmed by the thicker air and lost in the haze below about 3 degrees
    const dir = normalize(positionWorld.sub(cameraPosition));
    const air = smoothstep(0.0, 0.17, dir.y);
    // twinkling, more near the horizon
    const twinkle = float(1).add(sin(uTime.mul(9.0).add(m.mul(6283.0))).mul(sin(uTime.mul(5.3).add(m.mul(3911.0)))).mul(mix(float(0.28), float(0.08), air)));
    mat.colorNode = attribute('color', 'vec3').mul(core.mul(bright).mul(seen).mul(air).mul(twinkle).mul(uShow));
    mat.opacityNode = float(1);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Stars';
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  group.add(mesh);

  const rot = new THREE.Matrix4(), sinP = Math.sin(LAT), cosP = Math.cos(LAT);
  let shownAt = -1;
  // `night`: lighting.js nightFactor; `cover`: the clouds' cover; `dark`: 0 in town to 1 out in the country or high up
  function update(camera, { night = 0, cover = 0, dark = 0, time = 0 } = {}) {
    const show = smoothstep01(0.4, 0.82, night) * Math.max(0, 1 - Math.max(0, cover - 0.15) * 1.6);
    uShow.value = show;
    mesh.visible = show > 0.01 && !!camera;
    if (!mesh.visible) return;
    uLimit.value = LIMIT_TOWN + (LIMIT_COUNTRY - LIMIT_TOWN) * Math.max(0, Math.min(1, dark));
    uTime.value = time;
    // the sky's frame turned by the local sidereal time and tilted to the latitude: east x, up y, south z
    const L = (siderealDegrees(gameMoment()) + LON) * Math.PI / 180, sL = Math.sin(L), cL = Math.cos(L);
    rot.set(
      -sL, cL, 0, 0,
      cL * cosP, sL * cosP, sinP, 0,
      -(-cL * sinP), -(-sL * sinP), -cosP, 0,
      0, 0, 0, 1);
    const distance = Math.min(DISTANCE, (camera.far || DISTANCE) * 0.85);
    mesh.matrix.copy(rot).premultiply(m4.makeScale(distance, distance, distance)).setPosition(camera.position);
    // (set outright: the city's parts aren't walked for their matrices every frame)
    mesh.matrixWorld.multiplyMatrices(group.matrixWorld, mesh.matrix);
    if (shownAt < 0) { shownAt = 1; log(`[stars] ${n} stars, the sky's local sidereal time ${(((L * 180 / Math.PI) % 360 + 360) % 360 / 15).toFixed(2)} h`); }
  }
  const m4 = new THREE.Matrix4();
  return { update, count: n };
}

function smoothstep01(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export { createStars, siderealDegrees };
