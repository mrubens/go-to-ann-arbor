import * as THREE from 'three/webgpu';
import { positionWorld, attribute, mx_noise_float, smoothstep, mix, float, vec3, abs, fract, max, min, time } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';

// Lamp: Ann Arbor's outdoor swimming pools where OpenStreetMap has them (data/pools.json, Assets/Tools/build-pools.py):
// backyard and apartment pools, and the parks' and clubs' big ones with dark lane lines on their floors. Each is clear
// turquoise water a few centimetres over the highest ground round it, in a pale concrete coping that steps down to the
// lawn where the yard slopes away. All the water is one mesh and all the copings another.
//
// The water is real (`at`): terrain.js's waterLevel and riverDepth answer for it as for the river, so the player swims
// in it, the camera goes murky under it and things splash into it; controllers.js's getGroundHeight takes its floor
// (shallow at one end, deep at the other) for walking, driving and riding, and a car or a bike driven in sinks to the
// floor and is slowed by the water (`trap`); the floor curves up along every wall to the rim, so it drives up and out,
// and a swimmer climbs out the same way.

const BUCKET = 32;
const COPING = 0.38; // the coping's width round the water
const LIP = 0.07; // its top over the water
const DECK = 2.6; // a big pool's concrete deck beyond the coping

// the polygon's area in x-z, positive when it winds counter-clockwise seen from above (+y)
const area = (pts) => {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};

const insidePoly = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// each corner pushed `d` outwards along the mitre of its two sides (pts with a negative area in (x, z), whose outside
// is on the left of each side: outward is (-dz, dx) of a side's direction)
function offset(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = pts[(i + n - 1) % n], [x, z] = pts[i], [nx, nz] = pts[(i + 1) % n];
    let ax = x - px, az = z - pz, bx = nx - x, bz = nz - z;
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    // outward normals of the two sides
    const n1x = -az, n1z = ax, n2x = -bz, n2z = bx;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const k = Math.min(3, 1 / Math.max(0.35, mx * n1x + mz * n1z));
    out.push([x + mx * d * k, z + mz * d * k]);
  }
  return out;
}

function waterMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const deep = attribute('deep', 'float'); // 0 at the shallow end, 1 at the deep end
  const c1 = mx_noise_float(vec3(p.x.mul(1.3), p.y.mul(1.3), time.mul(0.45)));
  // clear water over the tiled basin: pale at the shallow end, a deeper blue and less see-through where it's deep
  m.colorNode = mix(vec3(0.3, 0.78, 0.86), vec3(0.04, 0.38, 0.6), deep);
  m.opacityNode = mix(float(0.34), float(0.62), deep);
  m.roughnessNode = float(0.03);
  m.metalnessNode = float(0.0);
  // the surface's little ripples, in the light it gives back
  m.emissiveNode = vec3(0.02, 0.06, 0.07).mul(max(float(0), c1));
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  return m;
}

// light dancing on the basin: two layers of noise drifting against each other, sharpened into bright webs
function caustics() {
  const p = positionWorld.xz;
  const c1 = mx_noise_float(vec3(p.x.mul(1.3), p.y.mul(1.3), time.mul(0.45)));
  const c2 = mx_noise_float(vec3(p.x.mul(2.1).add(7.3), p.y.mul(2.1), time.mul(-0.6)));
  return smoothstep(0.55, 0.95, float(1).sub(abs(c1.add(c2).mul(0.6))));
}

// a faint grout grid of square tiles `size` across, from two coordinates in metres
const grout = (a, b, size) => max(
  smoothstep(0.42, 0.47, abs(fract(a.div(size)).sub(0.5))),
  smoothstep(0.42, 0.47, abs(fract(b.div(size)).sub(0.5))));

function floorMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  // across the pool from its side wall, along it, and the span along its lane that has a line (0, 0 for none)
  const lane = attribute('lane', 'vec4');
  const across = abs(fract(lane.x.div(2.5)).sub(0.5)).mul(2.5);
  const a = lane.z.add(2), b = lane.w.sub(2), has = smoothstep(0.5, 1, lane.w.sub(lane.z));
  // the lane lines down its floor, 25 cm wide, ending in a T two metres short of each end wall
  const stem = float(1).sub(smoothstep(0.11, 0.135, across)).mul(smoothstep(a.sub(0.02), a, lane.y)).mul(float(1).sub(smoothstep(b, b.add(0.02), lane.y)));
  const tee = float(1).sub(smoothstep(0.48, 0.52, across)).mul(max(
    float(1).sub(smoothstep(0.11, 0.135, abs(lane.y.sub(a)))), float(1).sub(smoothstep(0.11, 0.135, abs(lane.y.sub(b))))));
  const line = max(stem, tee).mul(has);
  const tile = mix(vec3(0.78, 0.93, 0.96), vec3(0.6, 0.8, 0.86), grout(lane.x, lane.y, 0.3).mul(0.55));
  m.colorNode = mix(tile, vec3(0.05, 0.14, 0.36), line).add(caustics().mul(0.35));
  m.roughnessNode = float(0.5);
  m.metalnessNode = float(0.0);
  m.side = THREE.DoubleSide;
  return m;
}

function wallMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const tile = attribute('tile', 'vec2'); // along the wall and down from the water's surface, in metres
  // white tile with a band of dark blue at the waterline, as a pool's walls have
  const band = float(1).sub(smoothstep(0.15, 0.17, tile.y));
  const base = mix(vec3(0.84, 0.94, 0.96), vec3(0.66, 0.82, 0.88), grout(tile.x, tile.y, 0.15).mul(0.6));
  m.colorNode = mix(base, vec3(0.06, 0.2, 0.45), band).add(caustics().mul(float(0.25).mul(float(1).sub(band))));
  m.roughnessNode = float(0.35);
  m.metalnessNode = float(0.0);
  m.side = THREE.DoubleSide;
  return m;
}

function copingMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const n = mx_noise_float(positionWorld.mul(3.1)).mul(0.5).add(0.5);
  const joints = smoothstep(0.47, 0.49, abs(fract(positionWorld.x.add(positionWorld.z).mul(1 / 0.6)).sub(0.5)));
  m.colorNode = vec3(0.8, 0.78, 0.73).mul(n.mul(0.14).add(0.86)).mul(float(1).sub(joints.mul(0.25)));
  m.roughnessNode = float(0.85);
  m.side = THREE.DoubleSide;
  return m;
}

function deckMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const tw = attribute('tw', 'vec2'); // the pool's own frame, so the joints run square to its walls
  const n = mx_noise_float(positionWorld.mul(4.3)).mul(0.5).add(0.5);
  const joints = max(smoothstep(0.485, 0.495, abs(fract(tw.x.div(3)).sub(0.5))), smoothstep(0.485, 0.495, abs(fract(tw.y.div(3)).sub(0.5))));
  m.colorNode = vec3(0.86, 0.83, 0.77).mul(n.mul(0.1).add(0.9)).mul(float(1).sub(joints.mul(0.3)));
  m.roughnessNode = float(0.92);
  m.side = THREE.DoubleSide;
  return m;
}

function ropeMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const r = attribute('rope', 'vec2'); // along the rope and its length, in metres
  const end = min(r.x, r.y.sub(r.x));
  // floats 15 cm long, red for the last five metres at each end, blue and white in threes between
  const k = r.x.div(0.15).floor();
  const white = smoothstep(0.5, 0.6, fract(k.div(6)));
  const col = mix(mix(vec3(0.05, 0.25, 0.75), vec3(0.95, 0.95, 0.95), white), vec3(0.85, 0.08, 0.08), float(1).sub(smoothstep(4.95, 5.05, end)));
  const groove = smoothstep(0.38, 0.5, abs(fract(r.x.div(0.15)).sub(0.5)));
  m.colorNode = col.mul(float(1).sub(groove.mul(0.45)));
  m.roughnessNode = float(0.45);
  return m;
}

// two stainless handrails curving over the coping and down the wall, with three steps under the water (local: x along
// the wall, z into the pool, y up from the water's surface)
function ladderGeometry() {
  const parts = [];
  for (const sx of [-0.27, 0.27]) {
    const path = new THREE.CatmullRomCurve3([[-0.55, LIP], [-0.5, 0.75], [-0.32, 0.97], [-0.05, 0.93], [0.08, 0.6], [0.13, 0.1], [0.14, -1.1]]
      .map(([z, y]) => new THREE.Vector3(sx, y, z)));
    const tube = new THREE.TubeGeometry(path, 22, 0.022, 6, false);
    tube.deleteAttribute('uv');
    parts.push(tube);
  }
  for (const y of [-0.3, -0.62, -0.94]) {
    const step = new THREE.BoxGeometry(0.52, 0.035, 0.09).translate(0, y, 0.15);
    step.deleteAttribute('uv');
    parts.push(step);
  }
  return mergeGeometries(parts);
}

const painted = (geo, hex) => {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv');
  return geo;
};

// a starting block at the end of a lane (local z into the pool, y up from the deck)
function blockGeometry() {
  const top = new THREE.BoxGeometry(0.52, 0.05, 0.62);
  top.rotateX(0.18).translate(0, 0.72, -0.02);
  return mergeGeometries([
    painted(new THREE.BoxGeometry(0.42, 0.7, 0.42).translate(0, 0.35, -0.1), 0xf0f2f4),
    painted(top, 0x1d4f9c),
    painted(new THREE.BoxGeometry(0.5, 0.03, 0.03).translate(0, 0.42, 0.26), 0xc9ced3)
  ]);
}

// a lifeguard's tall white chair, its seat two metres up, facing the pool (local +z)
function chairGeometry() {
  const parts = [];
  const white = 0xf3f3ef;
  for (const sx of [-0.38, 0.38]) {
    for (const [z0, z1] of [[-0.55, -0.2], [0.55, 0.25]]) {
      const len = Math.hypot(2.05, z1 - z0);
      parts.push(painted(new THREE.BoxGeometry(0.08, len, 0.08).rotateX(Math.atan2(z1 - z0, 2.05)).translate(sx, 1.02, (z0 + z1) / 2), white));
    }
    parts.push(painted(new THREE.BoxGeometry(0.06, 0.55, 0.06).translate(sx, 2.35, -0.25), white));
  }
  for (const y of [0.45, 0.9, 1.35]) parts.push(painted(new THREE.BoxGeometry(0.82, 0.05, 0.12).translate(0, y, 0.52 - y * 0.12), white));
  parts.push(painted(new THREE.BoxGeometry(0.9, 0.08, 0.6).translate(0, 2.06, 0), white));
  parts.push(painted(new THREE.BoxGeometry(0.8, 0.07, 0.5).translate(0, 2.13, 0.02), 0xd23a2a));
  parts.push(painted(new THREE.BoxGeometry(0.82, 0.45, 0.06).translate(0, 2.4, -0.27), 0xd23a2a));
  parts.push(painted(new THREE.BoxGeometry(0.82, 0.05, 0.3).translate(0, 1.55, 0.48), white));
  return mergeGeometries(parts);
}

// the polygon's corners with points added along each side, every `step` metres or less
function densify(pts, step) {
  const out = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let j = 0; j < k; j++) out.push([x0 + (x1 - x0) * j / k, z0 + (z1 - z0) * j / k]);
  }
  return out;
}

function createPools(group, data) {
  group.name = 'Pools';
  const pools = [];
  const buckets = new Map();
  const key = (bx, bz) => bx * 100003 + bz;
  const water = { pos: [], deep: [], idx: [] };
  const floor = { pos: [], lane: [], idx: [] };
  const wall = { pos: [], tile: [], idx: [] };
  const rim = { pos: [], idx: [] };
  const deck = { pos: [], tw: [], idx: [] };
  const ropes = [], ladders = [], blocks = [], chairs = [];
  // a seat facing `in` (x, z) at (x, y, z): its yaw turns local +z that way
  const facing = (inX, inZ) => Math.atan2(inX, inZ);

  for (const rec of data?.pools || []) {
    const [kind, depth] = rec;
    const big = kind === 1;
    let pts = [];
    for (let i = 2; i + 1 < rec.length; i += 2) pts.push([rec[i], rec[i + 1]]);
    if (pts.length < 3) continue;
    // wound so its area in (x, z) is negative, which is what faces up (+y)
    if (area(pts) > 0) pts = pts.reverse();
    const n = pts.length;
    // the water stands just over the highest ground round it, the lowest is where the coping's skirt goes down to
    let gmax = -Infinity, gmin = Infinity, cx = 0, cz = 0;
    for (const [x, z] of pts) {
      const g = groundHeight(x, z);
      gmax = Math.max(gmax, g); gmin = Math.min(gmin, g);
      cx += x / n; cz += z / n;
    }
    for (const [x, z] of offset(pts, COPING)) { const g = groundHeight(x, z); gmax = Math.max(gmax, g); gmin = Math.min(gmin, g); }
    // (over a park's lawn, which the ground draws a little above itself)
    const level = gmax + LIFT.lawn + 0.05;
    // its long way, along its longest wall (square to its walls, an L-shaped pool too): the shallow end at one end of
    // it, the deep at the other
    let ux = 1, uz = 0, longest = 0, longI = 0;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0);
      if (l > longest) { longest = l; longI = i; ux = (x1 - x0) / l; uz = (z1 - z0) / l; }
    }
    const tOf = (x, z) => (x - cx) * ux + (z - cz) * uz, wOf = (x, z) => -(x - cx) * uz + (z - cz) * ux;
    const at2 = (t, w) => [cx + ux * t - uz * w, cz + uz * t + ux * w];
    const tw = pts.map(([x, z]) => [tOf(x, z), wOf(x, z)]);
    let t0 = Infinity, t1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (const [t, w] of tw) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
    const len = Math.max(1, t1 - t0);
    const shallowAt = (x, z) => 1 - smooth01((tOf(x, z) - t0) / len);
    // how far out from the walls the floor curves up: wider for a deeper pool, at most a third of its width
    const bowl = Math.max(1, Math.min(0.34 * (w1 - w0), 0.34 * len, 1.2 + depth * 0.8));
    const pool = {
      pts, level, kind, depth,
      minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity,
      // the floor: about a metre down at the shallow end, sloping to `depth` at the deep end, and curving up along
      // every wall to the rim like a bowl's, so whatever falls in can drive or climb back out
      floor(x, z) {
        const base = level - (depth - (depth - 1.05) * shallowAt(x, z));
        let d = Infinity;
        for (let i = 0; i < n; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n], ex = bx - ax, ez = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
          d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
        }
        if (!insidePoly(pts, x, z)) return level - 0.03;
        if (d >= bowl) return base;
        const u = 1 - d / bowl;
        return base + (level - 0.03 - base) * u ** 1.6;
      }
    };
    for (const [x, z] of pts) {
      pool.minX = Math.min(pool.minX, x); pool.maxX = Math.max(pool.maxX, x);
      pool.minZ = Math.min(pool.minZ, z); pool.maxZ = Math.max(pool.maxZ, z);
    }
    pools.push(pool);
    for (let bx = Math.floor(pool.minX / BUCKET); bx <= Math.floor(pool.maxX / BUCKET); bx++) {
      for (let bz = Math.floor(pool.minZ / BUCKET); bz <= Math.floor(pool.maxZ / BUCKET); bz++) {
        const k = key(bx, bz);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(pool);
      }
    }
    // the longest stretch of water along the pool at w across it: [from, to] along, or null
    const span = (w) => {
      const hits = [];
      for (let i = 0; i < n; i++) {
        const [ta, wa] = tw[i], [tb, wb] = tw[(i + 1) % n];
        if ((wa > w) !== (wb > w)) hits.push(ta + (tb - ta) * (w - wa) / (wb - wa));
      }
      hits.sort((p, q) => p - q);
      let best = null;
      for (let i = 0; i + 1 < hits.length; i += 2) if (!best || hits[i + 1] - hits[i] > best[1] - best[0]) best = [hits[i], hits[i + 1]];
      return best;
    };
    // a big pool's lanes, 2.5 m wide across it from its side wall, each with its span when it runs 20 m or more
    const lanes = [];
    if (big) {
      for (let k = 0; w0 + 2.5 * (k + 1) <= w1 + 0.3; k++) {
        const s = span(w0 + 1.25 + 2.5 * k);
        lanes.push(s && s[1] - s[0] >= 20 ? s : null);
      }
    }

    // the water: the outline triangulated at the surface
    const base = water.pos.length / 3;
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [x, z] of pts) { water.pos.push(x, level, z); water.deep.push(1 - shallowAt(x, z)); }
    // each triangle wound to face up (+y): a negative area in (x, z)
    for (const [a, b, c] of tris) {
      const [ax, az] = pts[a], [bx, bz] = pts[b], [qx, qz] = pts[c];
      if ((bx - ax) * (qz - az) - (bz - az) * (qx - ax) < 0) water.idx.push(base + a, base + b, base + c);
      else water.idx.push(base + a, base + c, base + b);
    }

    // the basin's floor: a half-metre grid in the pool's frame, sloping from the shallow end to the deep, a little past the
    // walls all round (that part is under the ground)
    const grown = offset(pts, 0.9);
    const FS = 0.5; // the floor's grid, fine enough for the curve up the walls
    const nt = Math.ceil((len + 2) / FS), nw = Math.ceil((w1 - w0 + 2) / FS), fb = floor.pos.length / 3;
    const fid = new Map();
    const fv = (i, j) => {
      const k = i * (nw + 1) + j;
      let id = fid.get(k);
      if (id === undefined) {
        const t = t0 - 1 + i * FS, w = w0 - 1 + j * FS, [x, z] = at2(t, w);
        const L = lanes[Math.max(0, Math.min(lanes.length - 1, Math.floor((w - w0) / 2.5)))];
        id = fb + fid.size; fid.set(k, id);
        floor.pos.push(x, pool.floor(x, z), z);
        floor.lane.push(w - w0, t, L ? L[0] : 0, L ? L[1] : 0);
      }
      return id;
    };
    for (let i = 0; i < nt; i++) {
      for (let j = 0; j < nw; j++) {
        const [x, z] = at2(t0 - 1 + (i + 0.5) * FS, w0 - 1 + (j + 0.5) * FS);
        if (!insidePoly(grown, x, z)) continue;
        const a = fv(i, j), b = fv(i + 1, j), c = fv(i + 1, j + 1), d = fv(i, j + 1);
        // facing up: t then w is turned the way the outline is, so the wind follows the frame's sign
        floor.idx.push(a, d, b, b, d, c);
      }
    }

    // the walls: tiled, from just under the coping down to the floor, a strip every metre and a half along each side
    let along = 0;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0);
      const k = Math.max(1, Math.ceil(l / 1.5)), wb = wall.pos.length / 3;
      for (let j = 0; j <= k; j++) {
        const x = x0 + (x1 - x0) * j / k, z = z0 + (z1 - z0) * j / k, y = pool.floor(x, z) - 0.05;
        wall.pos.push(x, level - 0.02, z, x, y, z);
        wall.tile.push(along + l * j / k, 0.02, along + l * j / k, level - y);
      }
      for (let j = 0; j < k; j++) { const a = wb + j * 2; wall.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      along += l;
    }

    // the coping: a flat ring round the water, its inner face down into the water, its outer skirt down to the lawn
    const outer = offset(pts, COPING), top = level + LIP, low = Math.min(gmin, level) - 0.25;
    const rb = rim.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i], [ox, oz] = outer[i];
      rim.pos.push(x, level - 0.3, z, x, top, z, ox, top, oz, ox, low, oz);
    }
    for (let i = 0; i < n; i++) {
      const a = rb + i * 4, b = rb + ((i + 1) % n) * 4;
      for (let s = 0; s < 3; s++) {
        const p0 = a + s, p1 = a + s + 1, q0 = b + s, q1 = b + s + 1;
        rim.idx.push(p0, q0, p1, p1, q0, q1);
      }
    }

    // a big pool's concrete deck round the coping, its outer edge on the lawn, a skirt under it
    if (big) {
      const dense = densify(pts, 2.5), m = dense.length;
      const inn = offset(dense, COPING - 0.02), out = offset(dense, COPING + DECK), db = deck.pos.length / 3;
      for (let i = 0; i < m; i++) {
        const [ix, iz] = inn[i], [ox, oz] = out[i], g = groundHeight(ox, oz);
        deck.pos.push(ix, top - 0.012, iz, ox, Math.min(top, g + LIFT.lawn + 0.03), oz, ox, g - 0.3, oz);
        deck.tw.push(tOf(ix, iz), wOf(ix, iz), tOf(ox, oz), wOf(ox, oz), tOf(ox, oz), wOf(ox, oz));
      }
      for (let i = 0; i < m; i++) {
        const a = db + i * 3, b = db + ((i + 1) % m) * 3;
        deck.idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }

    // ladders down the long walls, two metres in from each end (one near the deep end in a small pool)
    const ladderOn = (i, s) => {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0);
      if (l < 2.5) return;
      const dx = (x1 - x0) / l, dz = (z1 - z0) / l, d = Math.min(s, l / 2);
      for (const along2 of s === null ? [l / 2] : [d, l - d]) ladders.push([x0 + dx * along2, level, z0 + dz * along2, facing(dz, -dx)]);
    };
    // the long walls: the longest, and those running the same way at least half as long
    const longWalls = [];
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0);
      if (l >= longest * 0.5 && Math.abs(((x1 - x0) * ux + (z1 - z0) * uz) / l) > 0.95) longWalls.push(i);
    }
    if (big) for (const i of longWalls) ladderOn(i, 2);
    else ladderOn(longI, null);

    if (big) {
      // a lane rope between each pair of lanes that both run their length, red at the ends, on the water
      for (let k = 1; k < lanes.length; k++) {
        if (!lanes[k - 1] || !lanes[k]) continue;
        const s = span(w0 + 2.5 * k);
        if (!s || s[1] - s[0] < 20) continue;
        const a = s[0] + 0.15, b = s[1] - 0.15, L = b - a;
        const geo = new THREE.CylinderGeometry(0.06, 0.06, L, 8, 1, true).rotateX(Math.PI / 2);
        geo.deleteAttribute('uv');
        const pos = geo.attributes.position, r = new Float32Array(pos.count * 2);
        for (let v = 0; v < pos.count; v++) { r[v * 2] = pos.getZ(v) + L / 2; r[v * 2 + 1] = L; }
        geo.setAttribute('rope', new THREE.BufferAttribute(r, 2));
        const [mx, mz] = at2((a + b) / 2, w0 + 2.5 * k);
        geo.rotateY(Math.atan2(ux, uz)).translate(mx, level + 0.01, mz);
        ropes.push(geo);
      }
      // starting blocks at the deep end of each lane, on the coping
      lanes.forEach((s, k) => {
        if (!s) return;
        const [x, z] = at2(s[1] + 0.42, w0 + 1.25 + 2.5 * k);
        blocks.push([x, top, z, facing(-ux, -uz)]);
      });
      // a lifeguard's chair out on the deck at the middle of each long wall
      for (const i of longWalls) {
        const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0);
        const dx = (x1 - x0) / l, dz = (z1 - z0) / l, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const ox = -dz, oz = dx, d = COPING + 1.3, gx = mx + ox * d, gz = mz + oz * d;
        chairs.push([gx, Math.min(top, groundHeight(gx, gz) + LIFT.lawn + 0.03), gz, facing(-ox, -oz)]);
      }
    }
  }

  let waterMesh = null;
  if (pools.length) {
    const mesh = (attrs, idx, material, name, flatShaded = false) => {
      let g = new THREE.BufferGeometry();
      for (const [k, [arr, size]] of Object.entries(attrs)) g.setAttribute(k, new THREE.Float32BufferAttribute(arr, size));
      g.setIndex(idx);
      if (flatShaded) g = g.toNonIndexed();
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, material);
      m.name = name;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    // The basin is drawn first, then the water's outline just under its surface fills the depth there without any
    // colour, so the lawn the ground draws over the pool afterwards is hidden and the basin shows through the water
    const basin = mesh({ position: [floor.pos, 3], lane: [floor.lane, 4] }, floor.idx, floorMaterial(), 'Pool floor');
    const walls = mesh({ position: [wall.pos, 3], tile: [wall.tile, 2] }, wall.idx, wallMaterial(), 'Pool walls');
    basin.renderOrder = walls.renderOrder = -2;
    waterMesh = mesh({ position: [water.pos, 3], deep: [water.deep, 1] }, water.idx, waterMaterial(), 'Pool water');
    const cutMat = new THREE.MeshBasicNodeMaterial();
    cutMat.colorWrite = false;
    const cut = new THREE.Mesh(waterMesh.geometry, cutMat);
    cut.name = 'Pool opening';
    cut.position.y = -0.015;
    cut.renderOrder = -1;
    group.add(cut);
    // flat-shaded: each quad its own corners, so the coping's top and faces keep sharp edges
    const rimMesh = mesh({ position: [rim.pos, 3] }, rim.idx, copingMaterial(), 'Pool coping', true);
    rimMesh.castShadow = true;
    if (deck.idx.length) mesh({ position: [deck.pos, 3], tw: [deck.tw, 2] }, deck.idx, deckMaterial(), 'Pool deck');
    if (ropes.length) {
      const r = new THREE.Mesh(mergeGeometries(ropes), ropeMaterial());
      r.name = 'Lane ropes';
      group.add(r);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, list, name) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, yaw], k) => m.setMatrixAt(k, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(up, yaw), one)));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = m.receiveShadow = true;
      m.name = name;
      group.add(m);
    };
    inst(ladderGeometry(), new THREE.MeshStandardNodeMaterial({ color: 0xd9dee3, metalness: 0.9, roughness: 0.22 }), ladders, 'Pool ladders');
    const paintMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55 });
    inst(blockGeometry(), paintMat, blocks, 'Starting blocks');
    inst(chairGeometry(), paintMat, chairs, 'Lifeguard chairs');
  }
  // the pool whose water is at (x, z), or null
  function at(x, z) {
    const list = buckets.get(key(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
    if (!list) return null;
    for (const p of list) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      if (insidePoly(p.pts, x, z)) return p;
    }
    return null;
  }

  // a car or a bike sunk in a pool (where it was last frame, (px, py, pz), under its water): the water holds it back,
  // and it drives out up the curved floor by a wall. Returns whether it's in one.
  function trap(ent, px, py, pz, dt) {
    const was = at(px, pz);
    if (!was || py > was.level - 0.5) {
      if (!was) ent._inPool = false;
      return false;
    }
    if (!ent._inPool) { ent._inPool = true; log(`[pool] a ${ent.bike ? 'bike' : ent.type === 'cyclist' ? 'bicycle' : 'car'} went into a pool`); }
    ent.speed *= Math.exp(-dt * 1.1);
    if (ent.vx) ent.vx *= Math.exp(-dt * 3);
    if (ent.vz) ent.vz *= Math.exp(-dt * 3);
    return true;
  }

  log(`[pools] ${pools.length} pools (${pools.filter((p) => p.kind === 1).length} big ones with lanes), ${(water.pos.length + floor.pos.length + wall.pos.length + rim.pos.length + deck.pos.length) / 3} vertices, ${ropes.length} lane ropes, ${ladders.length} ladders, ${chairs.length} lifeguard chairs`);
  return { at, trap, count: pools.length };
}

function smooth01(t) {
  t = Math.min(1, Math.max(0, (t - 0.25) / 0.5));
  return t * t * (3 - 2 * t);
}

async function buildPools(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/pools.json')));
  } catch (error) { log(`[pools] no pool data: ${error}`); }
  return createPools(group, data);
}

export { buildPools };
