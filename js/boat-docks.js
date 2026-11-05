import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight, nearestWater, riverDepth, riverbedHeight, waterLevel } from './terrain.js';

// Lamp: the docks and boat launches on the Huron and its ponds (data/boat-docks.json, Assets/Tools/build-boat-docks.py),
// all but the Gallup Park livery's own (gallup-livery.js). Each dock is a timber deck of planks laid across it, in
// sections a couple of metres long that follow it from the bank out over the water, on posts running down to the
// riverbed, with a canoe, a kayak or a rowboat tied up alongside some of them. Each launch is a concrete ramp from the
// bank down under the water. Everything one instanced mesh per piece. `dockTop` is walked on, as the livery's docks
// are; `collide` keeps the player's boat off the docks and the boats tied there.

const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
const SECTION = 2.4, CLEAR = 0.45; // a deck section's length; its top above the water
const BOAT_COLORS = [0xd9342b, 0x2f6fae, 0x2f9e55, 0xe6b422, 0xe8e2d4, 0x9a3b2a, 0x17807a];
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

// a deck section 1 long (local x, scaled to the section) and 1 wide (local z, scaled to the dock), its top at 0: planks
// laid across it with a finger's gap between them, on two stringers underneath
function deckGeometry() {
  const parts = [];
  const n = 10;
  for (let k = 0; k < n; k++) parts.push(new THREE.BoxGeometry(1 / n - 0.012, 0.045, 1).translate(-0.5 + (k + 0.5) / n, -0.0225, 0));
  for (const s of [-0.42, 0.42]) parts.push(new THREE.BoxGeometry(1, 0.16, 0.05).translate(0, -0.125, s));
  return mergeGeometries(parts.map(flat));
}
// a post, its top at 0 and running 1 down (scaled to the water's depth and a little into the bed)
const postGeometry = () => flat(new THREE.CylinderGeometry(0.09, 0.1, 1, 8).translate(0, -0.5, 0));
// a launch's slab, 1 long (local x, down the slope) and 1 wide, 0.2 thick
function rampGeometry() {
  const parts = [new THREE.BoxGeometry(1, 0.2, 1).translate(0, -0.1, 0)];
  return mergeGeometries(parts.map(flat));
}

// the boats tied up: a hull along local z, its waterline at 0, scaled from a unit shape
function hullShape(L, B, H, open) {
  const shape = (geo, height, lift) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.abs(pos.getZ(i)));
      pos.setXYZ(i, pos.getX(i) * B * (1 - 0.6 * t * t), pos.getY(i) * height * (1 - 0.2 * t * t) + lift + 0.08 * t ** 3, pos.getZ(i) * L);
    }
    return geo;
  };
  const parts = [shape(new THREE.SphereGeometry(1, 18, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), H, H * 0.55)];
  if (!open) parts.push(shape(new THREE.SphereGeometry(1, 18, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0.1, H * 0.55));
  const g = mergeGeometries(parts.map(flat));
  g.computeVertexNormals();
  return g;
}
// the open boats' insides: thwarts or bench seats across them, a little under the gunwale
function seatsGeometry(L, B, H, n) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const z = -L * 0.55 + (k / Math.max(1, n - 1)) * L * 1.1, t = Math.abs(z / L);
    parts.push(new THREE.BoxGeometry(B * 2 * (1 - 0.6 * t * t) * 0.92, 0.035, n > 2 ? 0.07 : 0.26).translate(0, H * 0.4, z));
  }
  return mergeGeometries(parts.map(flat));
}
const BOATS = {
  kayak: { L: 1.8, B: 0.32, H: 0.2, open: false, seats: 0 },
  canoe: { L: 2.4, B: 0.42, H: 0.34, open: true, seats: 3 },
  rowboat: { L: 1.9, B: 0.7, H: 0.42, open: true, seats: 2 }
};

function createBoatDocks(group, data) {
  group.name = 'BoatDocks';
  const D = data?.docks || [], S = data?.slips || [];
  const decks = [], posts = [], ramps = [], boats = { kayak: [], canoe: [], rowboat: [] };
  const runs = [], moored = [];
  // a deck's height over (x, z): above the water where it's out over it, a step above the ground on the bank
  const deckAt = (x, z) => (riverDepth(x, z) > 0.02 ? waterLevel(x, z) ?? groundHeight(x, z) : groundHeight(x, z)) + (riverDepth(x, z) > 0.02 ? CLEAR : 0.3);
  for (let i = 0; i + 4 < D.length; i += 5) {
    const [ax, az, bx, bz, w] = D.slice(i, i + 5);
    const len = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / len, tz = (bz - az) / len, yaw = Math.atan2(-tz, tx);
    const nx = tz, nz = -tx; // across it
    const n = Math.max(1, Math.round(len / SECTION)), step = len / n;
    // the deck's height at each section's ends, never lower than the water under it
    const ys = [];
    for (let k = 0; k <= n; k++) ys.push(deckAt(ax + tx * step * k, az + tz * step * k));
    for (let k = 0; k < n; k++) {
      const y0 = ys[k], y1 = ys[k + 1], mx = ax + tx * step * (k + 0.5), mz = az + tz * step * (k + 0.5);
      decks.push({ x: mx, y: (y0 + y1) / 2, z: mz, yaw, pitch: Math.atan2(y1 - y0, step), sx: Math.hypot(step, y1 - y0) + 0.02, sz: w });
    }
    for (let k = 0; k <= n; k++) {
      const px = ax + tx * step * k, pz = az + tz * step * k, top = ys[k] - 0.15;
      for (const s of [-1, 1]) {
        const qx = px + nx * s * (w / 2 - 0.08), qz = pz + nz * s * (w / 2 - 0.08);
        const bed = riverDepth(qx, qz) > 0.02 ? riverbedHeight(qx, qz) - 0.4 : groundHeight(qx, qz) - 0.3;
        if (top - bed > 0.1) posts.push({ x: qx, y: top, z: qz, yaw: 0, sx: 1, sy: top - bed, sz: 1 });
      }
    }
    runs.push({ ax, az, tx, tz, len, hw: w / 2, ys, step });
    // a boat or two tied up alongside where it's out over deep enough water
    let tied = 0;
    for (let u = 1.6; u < len - 1.2 && tied < 3; u += 3.6) {
      const h = hash(ax + u * 3.1, az - u);
      if (h > 0.55) continue;
      const s = h < 0.28 ? 1 : -1, kind = h < 0.18 ? 'canoe' : h < 0.4 ? 'kayak' : 'rowboat', b = BOATS[kind];
      const off = w / 2 + b.B + 0.25, x = ax + tx * u + nx * s * off, z = az + tz * u + nz * s * off;
      if (riverDepth(x, z) < 0.4 || riverDepth(x + tx * b.L, z + tz * b.L) < 0.3 || riverDepth(x - tx * b.L, z - tz * b.L) < 0.3) continue;
      const level = waterLevel(x, z);
      if (level == null) continue;
      // along the dock, bow either way
      const boat = { x, y: level - 0.04, z, yaw: Math.atan2(tx, tz) + (hash(x, z) < 0.5 ? Math.PI : 0) + (h - 0.25) * 0.15, color: BOAT_COLORS[Math.floor(hash(z, x) * BOAT_COLORS.length)] };
      moored.push({ x, z, tx, tz, L: b.L, B: b.B, kind, k: boats[kind].length, boat, taken: false });
      boats[kind].push(boat);
      tied++;
    }
  }
  // the launches: a ramp from the bank down into the water toward the nearest open water
  let launches = 0;
  for (let i = 0; i + 1 < S.length; i += 2) {
    const [x, z] = [S[i], S[i + 1]];
    const water = nearestWater(x, z, 60);
    if (!water) continue;
    const d = Math.hypot(water.x - x, water.z - z) || 1, fx = (water.x - x) / d, fz = (water.z - z) / d;
    // its foot: the first point out from the bank under the water
    let edge = 0;
    for (let k = -6; k < 40; k++) if (riverDepth(x + fx * k * 0.5, z + fz * k * 0.5) > 0.05) { edge = k * 0.5; break; }
    const x0 = x + fx * (edge - 5), z0 = z + fz * (edge - 5), x1 = x + fx * (edge + 3), z1 = z + fz * (edge + 3);
    const level = waterLevel(x1, z1);
    if (level == null) continue;
    const y0 = groundHeight(x0, z0) + 0.06, y1 = Math.min(level - 0.35, riverbedHeight(x1, z1) + 0.15);
    const run = Math.hypot(x1 - x0, z1 - z0);
    ramps.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, yaw: Math.atan2(-fz, fx), pitch: Math.atan2(y1 - y0, run), sx: Math.hypot(run, y1 - y0), sy: 1, sz: 4 });
    launches++;
  }

  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x8a6a4a, roughness: 0.85 });
  const piling = new THREE.MeshStandardNodeMaterial({ color: 0x4f3d2c, roughness: 0.9 });
  const concrete = new THREE.MeshStandardNodeMaterial({ color: 0x9c9a94, roughness: 0.92 });
  const hullMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.45, side: THREE.DoubleSide });
  const seatMat = new THREE.MeshStandardNodeMaterial({ color: 0x6b5032, roughness: 0.8 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const inst = (geo, mat, list, cull, colored) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => {
      q.setFromEuler(e.set(0, it.yaw, it.pitch || 0));
      m.setMatrixAt(k, m4.compose(v.set(it.x, it.y, it.z), q, sc.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1)));
      if (colored) m.setColorAt(k, col.setHex(it.color));
    });
    m.castShadow = m.receiveShadow = true;
    m.userData.cullDistance = cull;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  inst(deckGeometry(), wood, decks, 380);
  inst(postGeometry(), piling, posts, 240);
  inst(rampGeometry(), concrete, ramps, 420);
  const boatMeshes = {};
  for (const [kind, b] of Object.entries(BOATS)) {
    boatMeshes[kind] = [inst(hullShape(b.L, b.B, b.H, b.open), hullMat, boats[kind], 300, true)];
    if (b.seats) boatMeshes[kind].push(inst(seatsGeometry(b.L, b.B, b.H, b.seats), seatMat, boats[kind], 160));
  }
  // a boat taken off its dock is gone from its spot until it's put back
  let taken = -1;
  const show = (i, on) => {
    const m = moored[i];
    if (!m) return;
    m.taken = !on;
    const it = m.boat;
    q.setFromEuler(e.set(0, it.yaw, 0));
    for (const mesh of boatMeshes[m.kind]) {
      if (!mesh) continue;
      mesh.setMatrixAt(m.k, m4.compose(v.set(it.x, it.y, it.z), q, sc.setScalar(on ? 1 : 0)));
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  // the runs in buckets of 64 m, for walking and bumping
  const buckets = new Map(), key = (i, j) => i * 100003 + j;
  for (const r of runs) {
    const pad = r.hw + 2;
    const xs = [r.ax, r.ax + r.tx * r.len], zs = [r.az, r.az + r.tz * r.len];
    for (let i = Math.floor((Math.min(...xs) - pad) / 64); i <= Math.floor((Math.max(...xs) + pad) / 64); i++)
      for (let j = Math.floor((Math.min(...zs) - pad) / 64); j <= Math.floor((Math.max(...zs) + pad) / 64); j++) {
        const k = key(i, j);
        if (!buckets.has(k)) buckets.set(k, { runs: [], boats: [] });
        buckets.get(k).runs.push(r);
      }
  }
  for (const b of moored) {
    const k = key(Math.floor(b.x / 64), Math.floor(b.z / 64));
    if (!buckets.has(k)) buckets.set(k, { runs: [], boats: [] });
    buckets.get(k).boats.push(b);
  }
  const push = { x: 0, z: 0 };

  const nBoats = moored.length;
  log(`[docks] ${runs.length} dock runs (${decks.length} sections, ${posts.length} posts), ${launches} launches, ${nBoats} boats tied up`);
  return {
    count: runs.length,
    // standing on a dock: its deck's height at (x, z), else -Infinity
    dockTop(x, z) {
      const b = buckets.get(key(Math.floor(x / 64), Math.floor(z / 64)));
      if (!b) return -Infinity;
      let top = -Infinity;
      for (const r of b.runs) {
        const dx = x - r.ax, dz = z - r.az, along = dx * r.tx + dz * r.tz;
        if (along < -0.1 || along > r.len + 0.1 || Math.abs(dx * r.tz - dz * r.tx) > r.hw + 0.05) continue;
        const f = Math.max(0, Math.min(r.ys.length - 1.001, along / r.step)), k = Math.floor(f);
        top = Math.max(top, r.ys[k] + (r.ys[k + 1] - r.ys[k]) * (f - k));
      }
      return top;
    },
    // the player's boat at (x, z) against the docks and the boats tied to them: how far to move it to clear them, or null
    collide(x, z, heading) {
      const b = buckets.get(key(Math.floor(x / 64), Math.floor(z / 64)));
      if (!b) return null;
      push.x = push.z = 0;
      const fx = Math.sin(heading), fz = Math.cos(heading);
      // the hull as three circles along it
      for (const s of [-0.9, 0, 0.9]) {
        const cx = x + fx * s, cz = z + fz * s, rad = 0.45;
        for (const r of b.runs) {
          const dx = cx - r.ax, dz = cz - r.az, along = Math.max(0, Math.min(r.len, dx * r.tx + dz * r.tz));
          const ox = dx - r.tx * along, oz = dz - r.tz * along, side = ox * -r.tz + oz * r.tx;
          // the nearest point on the deck's rectangle
          const cs = Math.max(-r.hw, Math.min(r.hw, side));
          const px = r.ax + r.tx * along - r.tz * cs, pz = r.az + r.tz * along + r.tx * cs;
          const qx = cx - px, qz = cz - pz, d = Math.hypot(qx, qz);
          if (d < rad && d > 1e-4) { push.x += qx / d * (rad - d); push.z += qz / d * (rad - d); }
          else if (d <= 1e-4) { const sg = side >= 0 ? 1 : -1; push.x += -r.tz * sg * rad; push.z += r.tx * sg * rad; }
        }
        for (const m of b.boats) {
          if (m.taken) continue;
          const dx = cx - m.x, dz = cz - m.z, along = Math.max(-m.L, Math.min(m.L, dx * m.tx + dz * m.tz));
          const qx = dx - m.tx * along, qz = dz - m.tz * along, d = Math.hypot(qx, qz), reach = rad + m.B;
          if (d < reach && d > 1e-4) { push.x += qx / d * (reach - d); push.z += qz / d * (reach - d); }
        }
      }
      return push.x || push.z ? { x: push.x, z: push.z, struck: 0 } : null;
    },
    // a boat tied up at a dock within `reach` of (x, z), or null
    nearest(x, z, reach) {
      let best = null, bd = reach * reach;
      const i0 = Math.floor((x - reach) / 64), i1 = Math.floor((x + reach) / 64), j0 = Math.floor((z - reach) / 64), j1 = Math.floor((z + reach) / 64);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const b = buckets.get(key(i, j));
        if (!b) continue;
        for (const m of b.boats) {
          if (m.taken) continue;
          // the nearest point along its hull
          const dx = x - m.x, dz = z - m.z, along = Math.max(-m.L, Math.min(m.L, dx * m.tx + dz * m.tz));
          const d = (dx - m.tx * along) ** 2 + (dz - m.tz * along) ** 2;
          if (d < bd) { bd = d; best = { i: moored.indexOf(m), kind: m.kind, x: m.x, z: m.z, d: Math.sqrt(d) }; }
        }
      }
      return best;
    },
    // takes it off the dock (and puts back the one taken before), saying where the player's boat goes and how it faces
    take(i) {
      const m = moored[i];
      if (!m) return null;
      if (taken >= 0) show(taken, true);
      taken = i;
      show(i, false);
      return { kind: m.kind, x: m.x, y: m.boat.y + 0.04, z: m.z, heading: m.boat.yaw };
    },
    release() { if (taken >= 0) show(taken, true); taken = -1; },
    get taken() { return taken; }
  };
}

async function buildBoatDocks(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/boat-docks.json')));
  } catch (error) { log(`[docks] no dock data: ${error}`); }
  return createBoatDocks(group, data);
}

export { buildBoatDocks };
