import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { nativeJSON, toWorld } from './live-feeds.js';

// Lamp: the real aircraft over Ann Arbor, from the OpenSky Network's live state vectors (its free API, asked through
// the app around the page every 20 s): airliners on the Detroit Metro approach and departures, small planes in and out
// of Ann Arbor Municipal. Each is drawn where it was reported, carried on along its track, climb and speed between
// reports and eased onto the next. A jet for anything fast or high, a high-wing single for the rest. Lamp's preview
// has no live feed: there, one moment of the sky saved when this was written (data/planes-sample.json) stands in.

const AREA = { lamin: 41.95, lomin: -84.25, lamax: 42.6, lomax: -83.15 };
const URL_STATES = `https://opensky-network.org/api/states/all?lamin=${AREA.lamin}&lomin=${AREA.lomin}&lamax=${AREA.lamax}&lomax=${AREA.lomax}`;
const POLL = 20; // seconds of play between asks
const MAX = 48;

function part(geo, x, y, z) { geo.translate(x, y, z); return geo; }

// An airliner about 38 m long, built nose to +z (turned to its track as it's placed)
function jetGeometry() {
  const body = new THREE.CylinderGeometry(1.95, 1.95, 30, 12, 1).rotateX(Math.PI / 2);
  const nose = part(new THREE.SphereGeometry(1.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), 0, 0, 15);
  const tailcone = part(new THREE.ConeGeometry(1.95, 7, 12).rotateX(-Math.PI / 2), 0, 0.4, -18.5);
  const wing = new THREE.BoxGeometry(34, 0.45, 5.5);
  const wpos = wing.attributes.position;
  for (let i = 0; i < wpos.count; i++) { // swept back toward the tips, narrower there
    const t = Math.abs(wpos.getX(i)) / 17;
    wpos.setZ(i, wpos.getZ(i) * (1 - 0.55 * t) - t * 6);
  }
  part(wing, 0, -0.9, 1);
  const stab = part(new THREE.BoxGeometry(12, 0.3, 3), 0, 0.6, -19);
  const fin = part(new THREE.BoxGeometry(0.35, 7, 4.5), 0, 4.6, -18.5);
  const engines = [-6.2, 6.2].map((x) => part(new THREE.CylinderGeometry(1.05, 1.05, 4.2, 10).rotateX(Math.PI / 2), x, -2.1, 3.5));
  return mergeGeometries([body, nose, tailcone, wing, stab, fin, ...engines].map((g) => g.toNonIndexed()));
}

// A high-wing single (a Cessna 172's shape), 8 m long
function propGeometry() {
  const body = new THREE.BoxGeometry(1.15, 1.35, 7.2);
  const bpos = body.attributes.position;
  for (let i = 0; i < bpos.count; i++) if (bpos.getZ(i) < 0) { bpos.setX(i, bpos.getX(i) * 0.35); bpos.setY(i, bpos.getY(i) * 0.45 + 0.25); }
  const wing = part(new THREE.BoxGeometry(11, 0.18, 1.5), 0, 0.85, 0.6);
  const stab = part(new THREE.BoxGeometry(3.4, 0.12, 0.9), 0, 0.45, -3.3);
  const fin = part(new THREE.BoxGeometry(0.12, 1.5, 1.1), 0, 1.1, -3.3);
  const gear = part(new THREE.BoxGeometry(2.2, 0.12, 0.3), 0, -0.95, 1.2);
  return mergeGeometries([body, wing, stab, fin, gear].map((g) => g.toNonIndexed()));
}

function createPlanes(group) {
  group.name = 'Planes';
  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xe9edf1, roughness: 0.45, metalness: 0.15 });
  const kinds = {
    jet: new THREE.InstancedMesh(jetGeometry(), paint, MAX),
    prop: new THREE.InstancedMesh(propGeometry(), paint, MAX)
  };
  for (const m of Object.values(kinds)) {
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }

  const planes = new Map(); // icao24 -> { x, y, z, vx, vy, vz, yaw, pitch, kind, ex, ey, ez, seen }
  let wait = 0, busy = false, logged = false, sampleAt = null;

  function take(states, clock) {
    const seen = new Set();
    for (const s of states || []) {
      const [id, callsign, , , , lon, lat, baro, ground, speed, track, climb, , geo] = s;
      if (ground || lon == null || lat == null || speed == null) continue;
      const alt = geo ?? baro;
      if (alt == null) continue;
      const { x, z } = toWorld(lat, lon);
      const yaw = (track ?? 0) * Math.PI / 180;
      const vx = Math.sin(yaw) * speed, vz = -Math.cos(yaw) * speed, vy = climb ?? 0;
      const kind = speed > 95 || alt > 3500 ? 'jet' : 'prop';
      seen.add(id);
      const p = planes.get(id);
      if (p) {
        // the error between where it's drawn and where it was reported, eased out over the next few seconds
        p.ex = x - p.x; p.ey = alt - p.y; p.ez = z - p.z;
        Object.assign(p, { vx, vy, vz, yaw, kind, callsign: (callsign || '').trim() });
      } else {
        planes.set(id, { x, y: alt, z, vx, vy, vz, yaw, kind, ex: 0, ey: 0, ez: 0, callsign: (callsign || '').trim() });
      }
    }
    for (const id of planes.keys()) if (!seen.has(id)) planes.delete(id);
    if (!logged) {
      logged = true;
      log(`[planes] ${clock}: ${planes.size} aircraft over the area${planes.size ? ` (${[...planes.values()].slice(0, 4).map((p) => p.callsign || 'unnamed').join(', ')}…)` : ''}`);
    }
  }

  async function ask() {
    const d = await nativeJSON(URL_STATES);
    if (d?.states) { take(d.states, 'OpenSky now'); return; }
    if (window.lampPreview && !sampleAt) {
      try {
        sampleAt = JSON.parse(new TextDecoder().decode(await asset('data/planes-sample.json')));
        take(sampleAt.states, 'preview, a saved moment of the sky');
      } catch { /* no planes then */ }
    }
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  function update(dt) {
    wait -= dt;
    if (wait <= 0 && !busy) {
      wait = POLL;
      busy = true;
      ask().finally(() => { busy = false; });
    }
    const n = { jet: 0, prop: 0 };
    const ease = Math.min(1, dt / 4);
    for (const p of planes.values()) {
      p.x += p.vx * dt + p.ex * ease; p.ex -= p.ex * ease;
      p.y = Math.max(60, p.y + p.vy * dt + p.ey * ease); p.ey -= p.ey * ease;
      p.z += p.vz * dt + p.ez * ease; p.ez -= p.ez * ease;
      const mesh = kinds[p.kind];
      if (n[p.kind] >= MAX) continue;
      const speed = Math.hypot(p.vx, p.vz) || 1;
      e.set(-Math.atan2(p.vy, speed), Math.PI - p.yaw, 0);
      q.setFromEuler(e);
      m4.compose(pos.set(p.x, p.y, p.z), q, scl);
      mesh.setMatrixAt(n[p.kind]++, m4);
    }
    for (const k of Object.keys(kinds)) {
      kinds[k].count = n[k];
      kinds[k].instanceMatrix.needsUpdate = true;
    }
  }

  return { update, planes };
}

export { createPlanes };
