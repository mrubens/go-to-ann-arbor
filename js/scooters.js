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

  function take(list, from) {
    spots = list.map(([lat, lon]) => {
      const { x, z } = toWorld(lat, lon);
      return { x, z, yaw: hash(x, z) * Math.PI * 2, g: groundHeight(x, z) };
    });
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

  return { update };
}

export { createScooters };
