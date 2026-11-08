import * as THREE from 'three/webgpu';
import { asset, log, random } from '../lamp-game.js';
import { nativeJSON, toWorld } from './live-feeds.js';
import { groundHeight } from './terrain.js';
import { MOTO_SPECS, buildMotoGeometry, createMotoMaterial } from './motorcycles.js';
import { ROADS, blockAt } from './city-config.js';

// Lamp: the rental e-scooters standing around Ann Arbor, where they really are: the operator's public GBFS feed
// (free_bike_status, Bird's Spin system for the city), asked through the app around the page every two minutes of
// play. Each stands on its kickstand at its spot, leaning a little, turned its own way. The 140 nearest the camera are
// drawn. Without the live feed (Lamp's preview, or offline) the spots saved when this was written stand in. Others are
// left about town as riders leave them: now and then by a street, on its tree lawn or its sidewalk (`strew`). The
// player's car or bike sends any it runs into flying, tumbling ahead of it, to lie on its side where it lands (as the
// bikes in bike-racks.js do).

const FEED = 'https://gbfs.spin.pm/api/gbfs/v2_3/ann_arbor/free_bike_status';
const POLL = 120;
const SHOWN = 140;
const REACH = 320; // metres from the camera

// Scooters left about town: along each street (not a highway), now and then, one stands just past the curb on its
// tree lawn or a little further out on its sidewalk, turned any which way, where a curb island's edge really is (the
// street's own edge out of any block, the spot and a step further out in one that isn't a median or a park)
const STEP = 45, CHANCE = 0.07;
function strew() {
  const out = [];
  const h = (x, z, k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
  const kerb = (x, z) => { const b = blockAt(x, z); return b && !b.median && !(b.park > 0.6) ? b : null; };
  for (const r of ROADS) {
    if (r.highway || !(r.w > 0)) continue;
    let carry = h(r.pts[0].x, r.pts[0].z, 1) * STEP;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.1) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      for (let t = carry; t < len; t += STEP) {
        const cx = a.x + ux * t, cz = a.z + uz * t;
        if (h(cx, cz, 2) > CHANCE) continue;
        const side = h(cx, cz, 3) < 0.5 ? -1 : 1, nx = -uz * side, nz = ux * side;
        const out0 = r.w / 2 + (h(cx, cz, 4) < 0.25 ? 1.2 : 2.6); // mostly on the sidewalk, now and then the tree lawn
        const x = cx + nx * out0, z = cz + nz * out0;
        if (blockAt(cx + nx * (r.w / 2 - 0.6), cz + nz * (r.w / 2 - 0.6)) || !kerb(x, z) || !kerb(x + nx * 0.6, z + nz * 0.6)) continue;
        out.push({ x, z, yaw: h(cx, cz, 5) * Math.PI * 2, g: groundHeight(x, z), lean: -0.12, strewn: true });
      }
      carry = ((carry - len) % STEP + STEP) % STEP;
    }
  }
  log(`[scooters] ${out.length} left about town on tree lawns and sidewalks`);
  return out;
}

// The feed's spots are a phone's GPS, often a few metres out in the street: one that lands in a roadway is moved to the
// sidewalk on its side of the nearest street (else its tree lawn), where a rider would really have left it
const CELL = 40;
let segGrid = null;
function segments() {
  if (segGrid) return segGrid;
  segGrid = new Map();
  for (const r of ROADS) {
    if (r.highway || !(r.w > 0)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const x0 = Math.floor((Math.min(a.x, b.x) - r.w) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + r.w) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - r.w) / CELL), z1 = Math.floor((Math.max(a.z, b.z) + r.w) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = cx + ',' + cz;
        if (!segGrid.has(k)) segGrid.set(k, []);
        segGrid.get(k).push([a, b, r.w]);
      }
    }
  }
  return segGrid;
}
function onSidewalk(x, z) {
  let best = null, bestD = Infinity;
  for (const [a, b, w] of segments().get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || []) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
    if (L2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bestD) { bestD = d; best = { px, pz, dx, dz, L: Math.sqrt(L2), w }; }
  }
  // not in a street: a block's own ground, a plaza, a lot
  if (!best || (bestD > best.w / 2 + 0.4 && blockAt(x, z))) return { x, z };
  const ux = best.dx / best.L, uz = best.dz / best.L;
  const side = (x - best.px) * -uz + (z - best.pz) * ux >= 0 ? 1 : -1, nx = -uz * side, nz = ux * side;
  for (const out of [2.6, 3.2, 1.2]) {
    const sx = best.px + nx * (best.w / 2 + out), sz = best.pz + nz * (best.w / 2 + out);
    const b = blockAt(sx, sz);
    if (b && !b.median) return { x: sx, z: sz };
  }
  return { x, z };
}

function createScooters(group) {
  group.name = 'Scooters';
  const spec = MOTO_SPECS.escooter;
  const mesh = new THREE.InstancedMesh(buildMotoGeometry(spec, true), createMotoMaterial(0x24272b), SHOWN);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  group.add(mesh);

  let spots = []; // { x, z, yaw, g, lean }: the feed's, then the strewn ones
  let feed = [];
  const strewn = strew();
  let wait = 0, busy = false, logged = false, regather = 0, triedSample = false;
  const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

  // the ones the player rode off on stay gone, though the feed still has them where they stood
  const ridden = new Set();
  const keyOf = (x, z) => `${Math.round(x)},${Math.round(z)}`;
  function take(list, from) {
    // one flying or lying knocked over keeps on as it is, though the feed has it where it stood
    const kept = new Map(feed.filter((s) => s.fly || s.down).map((s) => [s.key, s]));
    feed = list.map(([lat, lon]) => {
      const w = toWorld(lat, lon), key = keyOf(w.x, w.z);
      if (kept.has(key)) return kept.get(key);
      const { x, z } = onSidewalk(w.x, w.z);
      return { key, x, z, yaw: hash(x, z) * Math.PI * 2, g: groundHeight(x, z), lean: -0.12 };
    }).filter((s) => !ridden.has(s.key));
    spots = feed.concat(strewn);
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
  const near = [], shown = [];
  const fq = new THREE.Quaternion(), fq2 = new THREE.Quaternion(), fax = new THREE.Vector3();
  function draw() {
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      if (s.fly) m4.compose(pos.set(s.x, s.fly.y, s.z), s.fly.q, one);
      else {
        e.set(0, s.yaw, s.lean); // on its kickstand, or lying on its side
        q.setFromEuler(e);
        m4.compose(pos.set(s.x, s.g + 0.02 + (s.down ? 0.2 : 0), s.z), q, one);
      }
      mesh.setMatrixAt(i, m4);
    }
    mesh.count = shown.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // the player's car or bike running into one: it goes flying ahead of it, tumbling, and lies where it lands
  const flying = new Set();
  const bodyOf = (ent, mode) => mode === 'car' ? (ent.bike ? [0.45, 1.15] : [1.0, 2.35]) : mode === 'cyclist' ? [0.35, 0.9] : null;
  let cue = null;
  function strike(ent, mode) {
    const body = ent && bodyOf(ent, mode), sp = ent?.speed || 0;
    if (!body || Math.abs(sp) < 2.2) return;
    const px = ent.position.x, pz = ent.position.z, sn = Math.sin(ent.heading), cs = Math.cos(ent.heading);
    let hits = 0;
    for (const s of shown) {
      if (s.fly || Math.abs(s.x - px) > 4 || Math.abs(s.z - pz) > 4 || Math.abs(ent.position.y - s.g) > 2) continue;
      const dx = s.x - px, dz = s.z - pz, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) > body[0] + 0.25 || Math.abs(lz) > body[1] + 0.4) continue;
      const a = Math.abs(sp), side = Math.sign(lx) || 1, across = (0.3 + random() * 0.6) * a * side;
      const fling = 0.95 + random() * 0.35;
      e.set(0, s.yaw, s.lean);
      s.fly = {
        y: s.g + 0.02 + (s.down ? 0.2 : 0), vx: sn * sp * fling + cs * across, vz: cs * sp * fling - sn * across, vy: Math.min(9, 2 + a * 0.4),
        q: new THREE.Quaternion().setFromEuler(e), ax: cs * (0.5 + random()), ay: (random() - 0.5) * 1.5, az: -sn * (0.5 + random()),
        w: Math.min(18, 5 + a * 0.7), bounces: 0, settle: 0, side: random() < 0.5 ? -1 : 1
      };
      s.down = false;
      flying.add(s);
      hits++;
      cue?.('crash', { x: s.x, y: s.g + 0.5, z: s.z }, Math.min(0.6, 0.18 + a * 0.02));
    }
    if (hits) { ent.speed *= Math.pow(mode === 'cyclist' ? 0.6 : 0.98, hits); log(`[scooters] knocked ${hits} flying at ${Math.round(Math.abs(sp) * 2.237)} mph`); }
  }
  function fly(dt) {
    for (const s of flying) {
      const f = s.fly;
      if (f.settle > 0) {
        f.settle += dt * 3;
        e.set(0, s.yaw, f.side * 1.4);
        fq2.setFromEuler(e);
        f.q.slerp(fq2, Math.min(1, f.settle * 0.5));
        f.y += (s.g + 0.22 - f.y) * Math.min(1, dt * 8);
        if (f.settle >= 2) { s.fly = null; s.down = true; s.lean = f.side * 1.4; flying.delete(s); }
        continue;
      }
      f.vy -= 9.8 * dt;
      s.x += f.vx * dt; s.z += f.vz * dt; f.y += f.vy * dt;
      f.q.premultiply(fq.setFromAxisAngle(fax.set(f.ax, f.ay, f.az).normalize(), f.w * dt));
      s.g = groundHeight(s.x, s.z);
      const floor = s.g + 0.25;
      if (f.y < floor) {
        f.y = floor;
        if (f.vy < -1.5) {
          if (++f.bounces === 1) cue?.('thud', { x: s.x, y: f.y, z: s.z }, Math.min(0.5, 0.12 - f.vy * 0.04));
          f.vy = -f.vy * 0.35; f.vx *= 0.6; f.vz *= 0.6; f.w *= 0.55;
        } else {
          f.vy = 0;
          const k = Math.exp(-dt * 4);
          f.vx *= k; f.vz *= k; f.w *= Math.exp(-dt * 6);
          if (Math.hypot(f.vx, f.vz) < 0.25) {
            fax.set(0, 0, 1).applyQuaternion(f.q);
            if (Math.hypot(fax.x, fax.z) > 0.2) s.yaw = Math.atan2(fax.x, fax.z);
            f.settle = 1e-3;
          }
        }
      }
    }
    draw();
  }

  function update(dt, cam, ent = null, mode = null, sound = null) {
    cue = sound;
    strike(ent, mode);
    if (flying.size) fly(dt);
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
    shown.length = 0;
    for (let i = 0; i < Math.min(SHOWN, near.length); i++) shown.push(near[i][1]);
    // one still flying stays drawn though it's left the nearest few
    for (const f of flying) if (!shown.includes(f) && shown.length < SHOWN) shown.push(f);
    draw();
  }

  // the scooter nearest (x, z) within reach, scored by `facing` as the player's other choices are (controllers.js
  // enterOrExit: on foot, F beside one rides it off, as a bike off a rack)
  function nearest(x, z, reach, facing = () => 1) {
    let best = null, score = Infinity;
    for (const s of spots) {
      if (s.fly || s.down) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d >= reach) continue;
      const sc = (d / reach) * facing(s.x, s.z);
      if (sc < score) { score = sc; best = s; }
    }
    return best ? { slot: best, x: best.x, z: best.z, yaw: best.yaw, d: Math.hypot(best.x - x, best.z - z), from: made } : null;
  }
  // ride it off: gone from where it stood, and its look for the player's ride
  function ride(slot) {
    if (slot.key) ridden.add(slot.key);
    feed = feed.filter((s) => s !== slot);
    const k = strewn.indexOf(slot);
    if (k >= 0) strewn.splice(k, 1);
    spots = feed.concat(strewn);
    regather = 0;
    return { kind: 'escooter', hex: 0x24272b, style: 0 };
  }

  spots = feed.concat(strewn);
  const made = { update, nearest, take: ride };
  return made;
}

export { createScooters };
