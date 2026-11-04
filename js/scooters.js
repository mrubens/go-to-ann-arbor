import * as THREE from 'three/webgpu';
import { asset, log } from '../lamp-game.js';
import { nativeJSON, toWorld } from './live-feeds.js';
import { groundHeight } from './terrain.js';
import { MOTO_SPECS, buildMotoGeometry, createMotoMaterial } from './motorcycles.js';

// Lamp: the rental e-scooters standing around Ann Arbor, where they really are: the operator's public GBFS feed
// (free_bike_status, Bird's Spin system for the city), asked through the app around the page every two minutes of
// play. Each stands on its kickstand at its spot, leaning a little, turned its own way. The 140 nearest the camera are
// drawn. Without the live feed (Lamp's preview, or offline) the spots saved when this was written stand in.

const FEED = 'https://gbfs.spin.pm/api/gbfs/v2_3/ann_arbor/free_bike_status';
const POLL = 120;
const SHOWN = 140;
const REACH = 320; // metres from the camera

function createScooters(group) {
  group.name = 'Scooters';
  const spec = MOTO_SPECS.escooter;
  const mesh = new THREE.InstancedMesh(buildMotoGeometry(spec, true), createMotoMaterial(0x24272b), SHOWN);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  group.add(mesh);

  let spots = []; // { x, z, yaw, g }
  let wait = 0, busy = false, logged = false, regather = 0, triedSample = false;
  const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

  // the ones the player rode off on stay gone, though the feed still has them where they stood
  const ridden = new Set();
  const keyOf = (x, z) => `${Math.round(x)},${Math.round(z)}`;
  function take(list, from) {
    spots = list.map(([lat, lon]) => {
      const { x, z } = toWorld(lat, lon);
      return { x, z, yaw: hash(x, z) * Math.PI * 2, g: groundHeight(x, z) };
    }).filter((s) => !ridden.has(keyOf(s.x, s.z)));
    regather = 0;
    if (!logged) { logged = true; log(`[scooters] ${from}: ${spots.length} standing around town`); }
  }

  async function ask() {
    const d = await nativeJSON(FEED);
    const bikes = d?.data?.bikes;
    if (Array.isArray(bikes)) {
      take(bikes.filter((b) => !b.is_disabled && Number.isFinite(b.lat)).map((b) => [b.lat, b.lon]), 'Spin now');
      return;
    }
    if (!triedSample && !spots.length) {
      triedSample = true;
      try {
        take(JSON.parse(new TextDecoder().decode(await asset('data/scooters-sample.json'))).bikes, 'their spots when last seen');
      } catch (error) { log(`[scooters] no saved spots: ${error}`); }
    }
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const near = [];
  function update(dt, cam) {
    wait -= dt;
    if (wait <= 0 && !busy) {
      wait = POLL;
      busy = true;
      ask().catch((error) => log(`[scooters] ${error}`)).finally(() => { busy = false; });
    }
    regather -= dt;
    if (regather > 0 || !cam) return;
    regather = 0.5;
    near.length = 0;
    for (const s of spots) {
      const d = Math.hypot(s.x - cam.x, s.z - cam.z);
      if (d < REACH) near.push([d, s]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const n = Math.min(SHOWN, near.length);
    for (let i = 0; i < n; i++) {
      const s = near[i][1];
      e.set(0, s.yaw, -0.12); // on its kickstand
      q.setFromEuler(e);
      m4.compose(pos.set(s.x, s.g + 0.02, s.z), q, one);
      mesh.setMatrixAt(i, m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // the scooter nearest (x, z) within reach, scored by `facing` as the player's other choices are (controllers.js
  // enterOrExit: on foot, F beside one rides it off, as a bike off a rack)
  function nearest(x, z, reach, facing = () => 1) {
    let best = null, score = Infinity;
    for (const s of spots) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d >= reach) continue;
      const sc = (d / reach) * facing(s.x, s.z);
      if (sc < score) { score = sc; best = s; }
    }
    return best ? { slot: best, x: best.x, z: best.z, yaw: best.yaw, d: Math.hypot(best.x - x, best.z - z), from: made } : null;
  }
  // ride it off: gone from where it stood, and its look for the player's ride
  function ride(slot) {
    ridden.add(keyOf(slot.x, slot.z));
    spots = spots.filter((s) => s !== slot);
    regather = 0;
    return { kind: 'escooter', hex: 0x24272b, style: 0 };
  }

  const made = { update, nearest, take: ride };
  return made;
}

export { createScooters };
