import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, cameraPosition, clamp, float, fract, length, smoothstep, step, time, uv, vec2, vec3, vec4, mix } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { asset, log, random } from '../lamp-game.js';
import { nativeJSON, toWorld } from './live-feeds.js';
import { groundHeight } from './terrain.js';
import { AIRPORT } from './airport-data.js';

// Lamp: the real aircraft over Ann Arbor, from the OpenSky Network's live state vectors (its free API, asked through
// the app around the page every 20 s): airliners on the Detroit Metro approach and departures, small planes in and out
// of Ann Arbor Municipal. Each is drawn where it was reported, carried on along its track, climb and speed between
// reports and eased onto the next. A jet for anything fast or high, a high-wing single for the rest. Lamp's preview
// has no live feed: there, one moment of the sky saved when this was written (data/planes-sample.json) stands in.
// The sky is never left empty: while fewer than a few real aircraft are near town (OpenSky's free API runs out of
// asks after a while, and often few fly right over), made-up flights fill it in: airliners descending east toward
// Detroit Metro or climbing out of it, a high cruiser now and then with its contrail, and small planes to and from
// Ann Arbor Municipal, down its runway's glide path to touch down and roll out, or off it climbing away. Planes are drawn through the haze (it hid anything more than a few km off) and cruisers leave a
// contrail, so one seven miles up still shows.

const AREA = { lamin: 41.95, lomin: -84.25, lamax: 42.6, lomax: -83.15 };
const URL_STATES = `https://opensky-network.org/api/states/all?lamin=${AREA.lamin}&lomin=${AREA.lomin}&lamax=${AREA.lamax}&lomax=${AREA.lomax}`;
const POLL = 60; // seconds of play between asks (the free API allows a few hundred a day)
const GROUND = 270; // m above sea level of the town's streets, the world's y = 0
const SKY = 3; // made-up flights kept up while fewer real ones are near town
const NEAR = 25000;
const DTW = toWorld(42.2124, -83.3534);
const MAX = 48;
// Ann Arbor Municipal's paved runway (6/24), which the made-up small planes land on and take off from along its heading
const RUNWAY = (() => {
  const r = AIRPORT.runways.find((w) => !w.grass);
  if (!r) return null;
  const [ax, az] = r.a, [bx, bz] = r.b, len = Math.hypot(bx - ax, bz - az);
  return { ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len };
})();
const GLIDE = Math.tan(3 * Math.PI / 180), TOUCHDOWN = 250, WHEELS = 1.25, FINAL = 33, LIFTOFF = 32;

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
  // their lights after dark: a red beacon and a white strobe, a few pixels across however far (only what's seen of a
  // plane at night); one draw, drawn only at night and while one's up
  const beams = new Float32Array(MAX * 4);
  const lights = (() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const at = new THREE.InstancedBufferAttribute(beams, 4);
    at.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBeam', at);
    geo.instanceCount = 0;
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const beam = attribute('aBeam', 'vec4');
    const dist = length(beam.xyz.sub(cameraPosition));
    mat.positionNode = beam.xyz;
    mat.scaleNode = vec2(clamp(dist.mul(0.006), 1.5, 80.0));
    const r = length(uv().sub(0.5)).mul(2.0);
    const spot = float(1.0).sub(smoothstep(0.0, 1.0, r)).pow(2.0);
    // (each plane's own phase: the strobe a double flash every ~1.3 s, the beacon a slower red pulse)
    const t = fract(time.mul(0.77).add(beam.w));
    const strobe = step(t, 0.05).add(step(0.12, t).mul(step(t, 0.17)));
    const beacon = smoothstep(0.5, 0.6, t).mul(smoothstep(0.85, 0.75, t));
    const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
    mat.colorNode = vec4(mix(vec3(1.0, 0.08, 0.04).mul(beacon).mul(3.0), vec3(1.0, 1.0, 1.0).mul(6.0), strobe).mul(spot).mul(night), 1.0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'PlaneLights';
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  })();
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
    } else if (RUNWAY) { // a small plane in or out of Ann Arbor Municipal along its runway's heading, either way
      kind = 'prop';
      const R = RUNWAY, out = random() < 0.5, fwd = random() < 0.5, dx = fwd ? R.ux : -R.ux, dz = fwd ? R.uz : -R.uz;
      // (the threshold it lands over, or the end it starts its take-off run from)
      const tx = fwd ? R.ax : R.bx, tz = fwd ? R.az : R.bz, field = groundHeight((R.ax + R.bx) / 2, (R.az + R.bz) / 2) + WHEELS;
      const cruise = 50 + random() * 12, level = 450 + random() * 500, far = 22000;
      yaw = Math.atan2(dx, -dz);
      let t, phase;
      if (out) { // from the runway (or, filling the sky at the start, already climbing away along its heading)
        t = along < 0.15 ? 0 : along * far * 0.85;
        phase = t ? 'out' : 'run';
        speed = t ? cruise : 0;
        y = t ? Math.min(field + level, field + t * 0.08) : field;
      } else { // in along the runway's extended centreline toward its threshold, from far out
        t = -far + along * far * 0.85;
        phase = 'in';
        speed = cruise;
        y = Math.min(field + level, field + (TOUCHDOWN - t) * GLIDE);
      }
      x = tx + dx * t; z = tz + dz * t; climb = 0;
      planes.set(`sim${simId++}`, { x, y, z, vx: dx * speed, vy: 0, vz: dz * speed, yaw, kind, ex: 0, ey: 0, ez: 0, callsign: '', sim: true,
        ground: { phase, dx, dz, tx, tz, field, cruise, level, speed } });
      return;
    } else return;
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
      // gone past town, or landed at Ann Arbor and rolled out (flyProp)
      if (Math.hypot(p.x, p.z) > 34000 || p.ground?.phase === 'done') { planes.delete(id); continue; }
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

  // a made-up small plane's flight along the runway: down the 3° glide to touch down past the threshold, rolling out
  // and slowing to a stop (then let go), or its take-off run, lifting off and climbing to its height, then on out
  function flyProp(p, dt) {
    const g = p.ground, s = (p.x - g.tx) * g.dx + (p.z - g.tz) * g.dz;
    let vy = 0;
    if (g.phase === 'in') {
      if (s < -3000) g.speed = g.cruise; else g.speed = Math.max(FINAL, g.speed - 1.5 * dt);
      const want = Math.min(g.field + g.level, g.field + Math.max(0, TOUCHDOWN - s) * GLIDE);
      if (want < p.y) vy = -g.speed * GLIDE;
      p.y = Math.min(p.y, want);
      if (s >= TOUCHDOWN) { g.phase = 'roll'; p.y = g.field; }
    } else if (g.phase === 'roll') {
      g.speed = Math.max(0, g.speed - 3 * dt);
      p.y = g.field;
      if (g.speed < 4) g.phase = 'done';
    } else if (g.phase === 'run') {
      g.speed = Math.min(g.cruise, g.speed + 2.5 * dt);
      if (g.speed >= LIFTOFF) g.phase = 'out';
      p.y = g.field;
    } else if (g.phase === 'out') {
      g.speed = Math.min(g.cruise, g.speed + 1 * dt);
      if (p.y < g.field + g.level) { vy = 4; p.y = Math.min(g.field + g.level, p.y + vy * dt); }
    }
    p.vx = g.dx * g.speed; p.vz = g.dz * g.speed; p.vy = vy;
    p.x += p.vx * dt; p.z += p.vz * dt;
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
    let nt = 0, nl = 0;
    const ease = Math.min(1, dt / 4);
    for (const p of planes.values()) {
      if (p.ground) flyProp(p, dt);
      else {
        p.x += p.vx * dt + p.ex * ease; p.ex -= p.ex * ease;
        p.y = Math.max(p.sim ? 15 : 60, p.y + p.vy * dt + p.ey * ease); p.ey -= p.ey * ease;
        p.z += p.vz * dt + p.ez * ease; p.ez -= p.ez * ease;
      }
      const mesh = kinds[p.kind];
      if (n[p.kind] >= MAX) continue;
      const speed = Math.hypot(p.vx, p.vz) || 1;
      e.set(-Math.atan2(p.vy, speed), Math.PI - p.yaw, 0);
      q.setFromEuler(e);
      m4.compose(pos.set(p.x, p.y, p.z), q, scl);
      mesh.setMatrixAt(n[p.kind]++, m4);
      if (nl < MAX) { beams[nl * 4] = p.x; beams[nl * 4 + 1] = p.y; beams[nl * 4 + 2] = p.z; beams[nl * 4 + 3] = (p.phase ??= random()); nl++; }
      if (sunlit && p.y > 7500 && nt < MAX) { // a contrail, a couple of km long, from the engines back
        scl.set(1, 1, 1800);
        m4.compose(pos.set(p.x - Math.sin(p.yaw) * 20, p.y, p.z + Math.cos(p.yaw) * 20), q, scl);
        trails.setMatrixAt(nt++, m4);
        scl.set(1, 1, 1);
      }
    }
    // (an empty one isn't drawn at all: no draw for the contrails on most frames, or for a kind with none up)
    lights.geometry.instanceCount = nl;
    lights.visible = nl > 0 && look !== 'midday' && look !== 'golden';
    if (lights.visible) lights.geometry.attributes.aBeam.needsUpdate = true;
    trails.count = nt;
    trails.visible = nt > 0;
    trails.instanceMatrix.needsUpdate = true;
    for (const k of Object.keys(kinds)) {
      kinds[k].count = n[k];
      kinds[k].visible = n[k] > 0;
      kinds[k].instanceMatrix.needsUpdate = true;
    }
  }

  return { update, planes };
}

export { createPlanes };
