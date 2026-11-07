import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log, random } from '../lamp-game.js';
import { nativeJSON, toWorld } from './live-feeds.js';

// Lamp: the real aircraft over Ann Arbor, from the OpenSky Network's live state vectors (its free API, asked through
// the app around the page every 20 s): airliners on the Detroit Metro approach and departures, small planes in and out
// of Ann Arbor Municipal. Each is drawn where it was reported, carried on along its track, climb and speed between
// reports and eased onto the next. A jet for anything fast or high, a high-wing single for the rest. Lamp's preview
// has no live feed: there, one moment of the sky saved when this was written (data/planes-sample.json) stands in.
// The sky is never left empty: while fewer than a few real aircraft are near town (OpenSky's free API runs out of
// asks after a while, and often few fly right over), made-up flights fill it in: airliners descending east toward
// Detroit Metro or climbing out of it, a high cruiser now and then with its contrail, and small planes to and from
// Ann Arbor Municipal. Planes are drawn through the haze (it hid anything more than a few km off) and cruisers leave a
// contrail, so one seven miles up still shows.

const AREA = { lamin: 41.95, lomin: -84.25, lamax: 42.6, lomax: -83.15 };
const URL_STATES = `https://opensky-network.org/api/states/all?lamin=${AREA.lamin}&lomin=${AREA.lomin}&lamax=${AREA.lamax}&lomax=${AREA.lomax}`;
const POLL = 60; // seconds of play between asks (the free API allows a few hundred a day)
const GROUND = 270; // m above sea level of the town's streets, the world's y = 0
const SKY = 3; // made-up flights kept up while fewer real ones are near town
const NEAR = 25000;
const ARB = toWorld(42.2229, -83.7456), DTW = toWorld(42.2124, -83.3534);
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
  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xe9edf1, roughness: 0.45, metalness: 0.15, fog: false });
  // a contrail: a long thin white streak behind a cruiser, scaled along z to its length
  // (a spread-out one, tens of metres across: a thin line miles up breaks into dots on screen; and only while the sun
  // lights it, since an unlit white streak across the night sky isn't a contrail anyone sees)
  const trailGeo = new THREE.BoxGeometry(28, 5, 1).translate(0, 0, -0.5);
  const trails = new THREE.InstancedMesh(trailGeo, new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, fog: false, depthWrite: false }), MAX);
  trails.count = 0;
  trails.frustumCulled = false;
  trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(trails);
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
  let wait = 0, busy = false, logged = false, sampleAt = null, real = 0, simId = 0;

  // a made-up flight: an approach to or departure from Detroit Metro passing over or beside town, a cruiser, or a small
  // plane to or from Ann Arbor Municipal; `along` 0..1 is how far along its path it starts
  function addFlight(along) {
    const r = random();
    let x, z, y, yaw, speed, climb, kind;
    const off = (random() - 0.5) * 9000; // how far beside town it passes
    if (r < 0.45) { // airliner: west to east down toward DTW, or out of it climbing west
      const out = random() < 0.4;
      kind = 'jet'; speed = 120 + random() * 40;
      const bx = out ? DTW.x - 4000 : -30000, bz = (out ? DTW.z : off);
      const tx = out ? -30000 : DTW.x, tz = out ? off : DTW.z;
      yaw = Math.atan2(tx - bx, -(tz - bz));
      const len = Math.hypot(tx - bx, tz - bz), t = along * len * 0.7;
      x = bx + Math.sin(yaw) * t; z = bz - Math.cos(yaw) * t;
      const y0 = out ? 900 : 4200, y1 = out ? 5000 : 900;
      climb = ((y1 - y0) / len) * speed; y = y0 + (y1 - y0) * (t / len);
    } else if (r < 0.65) { // a cruiser at 30,000-38,000 ft, any heading
      kind = 'jet'; speed = 220 + random() * 25; climb = 0; y = 9000 + random() * 2500 - GROUND;
      yaw = random() * Math.PI * 2;
      const t = (along - 0.5) * 50000;
      x = Math.cos(yaw) * off + Math.sin(yaw) * t; z = Math.sin(yaw) * off - Math.cos(yaw) * t;
    } else { // a small plane in or out of Ann Arbor Municipal, low over town
      kind = 'prop'; speed = 50 + random() * 12; climb = 0; y = 450 + random() * 500;
      const out = random() < 0.5, b = random() * Math.PI * 2, far = 22000;
      const fx = ARB.x + Math.sin(b) * far, fz = ARB.z - Math.cos(b) * far;
      const [bx, bz, tx, tz] = out ? [ARB.x, ARB.z, fx, fz] : [fx, fz, ARB.x, ARB.z];
      yaw = Math.atan2(tx - bx, -(tz - bz));
      const t = along * far * 0.85;
      x = bx + Math.sin(yaw) * t; z = bz - Math.cos(yaw) * t;
    }
    planes.set(`sim${simId++}`, { x, y, z, vx: Math.sin(yaw) * speed, vy: climb, vz: -Math.cos(yaw) * speed, yaw, kind,
      ex: 0, ey: 0, ez: 0, callsign: '', sim: true });
  }
  let simWait = 0;
  function keepSkyFull(dt) {
    simWait -= dt;
    if (simWait > 0) return;
    simWait = 2;
    let sims = 0;
    for (const [id, p] of planes) {
      if (!p.sim) continue;
      // gone past town, or landed at Ann Arbor
      if (Math.hypot(p.x, p.z) > 34000 || (p.kind === 'prop' && Math.hypot(p.x - ARB.x, p.z - ARB.z) < 600 && p.vz * (ARB.z - p.z) + p.vx * (ARB.x - p.x) < 0)) { planes.delete(id); continue; }
      sims++;
    }
    let near = 0;
    for (const p of planes.values()) if (!p.sim && Math.hypot(p.x, p.z) < NEAR) near++;
    const want = Math.max(0, SKY + 2 - near);
    const first = sims === 0;
    while (sims < want) { addFlight(first ? random() : random() * 0.15); sims++; }
  }

  function take(states, clock) {
    const seen = new Set();
    for (const s of states || []) {
      const [id, callsign, , , , lon, lat, baro, ground, speed, track, climb, , geo] = s;
      if (ground || lon == null || lat == null || speed == null) continue;
      if ((geo ?? baro) == null) continue;
      const alt = (geo ?? baro) - GROUND;
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
    for (const id of planes.keys()) if (!seen.has(id) && !id.startsWith('sim')) planes.delete(id);
    real = seen.size;
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
  function update(dt, look = 'midday') {
    const sunlit = look === 'midday' || look === 'golden';
    keepSkyFull(dt);
    wait -= dt;
    if (wait <= 0 && !busy) {
      wait = POLL;
      busy = true;
      ask().finally(() => { busy = false; });
    }
    const n = { jet: 0, prop: 0 };
    let nt = 0;
    const ease = Math.min(1, dt / 4);
    for (const p of planes.values()) {
      p.x += p.vx * dt + p.ex * ease; p.ex -= p.ex * ease;
      if (p.sim && p.kind === 'prop') { // a small plane eases down onto Ann Arbor's runway as it nears it
        const d = Math.hypot(p.x - ARB.x, p.z - ARB.z), toward = p.vx * (ARB.x - p.x) + p.vz * (ARB.z - p.z) > 0;
        if (toward && d < 6000) p.vy = -Math.max(0, p.y - 20) / Math.max(1, d / Math.hypot(p.vx, p.vz));
        else if (!toward && d < 4000) p.vy = 3;
        else p.vy = 0;
      }
      p.y = Math.max(p.sim ? 15 : 60, p.y + p.vy * dt + p.ey * ease); p.ey -= p.ey * ease;
      p.z += p.vz * dt + p.ez * ease; p.ez -= p.ez * ease;
      const mesh = kinds[p.kind];
      if (n[p.kind] >= MAX) continue;
      const speed = Math.hypot(p.vx, p.vz) || 1;
      e.set(-Math.atan2(p.vy, speed), Math.PI - p.yaw, 0);
      q.setFromEuler(e);
      m4.compose(pos.set(p.x, p.y, p.z), q, scl);
      mesh.setMatrixAt(n[p.kind]++, m4);
      if (sunlit && p.y > 7500 && nt < MAX) { // a contrail, a couple of km long, from the engines back
        scl.set(1, 1, 1800);
        m4.compose(pos.set(p.x - Math.sin(p.yaw) * 20, p.y, p.z + Math.cos(p.yaw) * 20), q, scl);
        trails.setMatrixAt(nt++, m4);
        scl.set(1, 1, 1);
      }
    }
    trails.count = nt;
    trails.instanceMatrix.needsUpdate = true;
    for (const k of Object.keys(kinds)) {
      kinds[k].count = n[k];
      kinds[k].instanceMatrix.needsUpdate = true;
    }
  }

  return { update, planes };
}

export { createPlanes };
