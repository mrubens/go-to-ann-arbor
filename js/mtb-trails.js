import * as THREE from 'three/webgpu';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { splitByCell } from './merge-static.js';
import { nearestRoads } from './city-config.js';

// Lamp: what's on Ann Arbor's mountain bike trails (data/mtb-trails.json, Assets/Tools/build-mtb-trails.py), the dirt
// singletrack itself being drawn already with the town's other trails (golf.js buildTrails). Along each: rocks off its
// edges, roots across it, and by how hard it's rated (OpenStreetMap's mtb:scale) logs to roll over, rock gardens,
// little tabletop jumps and banked berms on the outside of its tight turns; and a post with its rating's color at each
// end and now and then along it. The berms, logs and jumps are ridden over (`top`, controllers.js rampTop).

const HW = 0.6, SURF = 0.19; // the singletrack's half width; the lawn's top over the ground, as the playgrounds stand on it
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
const BLAZE = [0x2f9e55, 0x1f5fb2, 0x1d1d1f, 0x1d1d1f];
// a berm's cross section out from the trail's edge: [out, height]
const BERM = [[0, 0], [0.35, 0.16], [0.75, 0.38], [1.05, 0.5], [1.35, 0.42], [1.75, 0.18], [2.2, 0]];
const bermAt = (o) => {
  if (o <= 0 || o >= 2.2) return 0;
  for (let k = 1; k < BERM.length; k++) if (o <= BERM[k][0]) {
    const [a, ya] = BERM[k - 1], [b, yb] = BERM[k];
    return ya + (yb - ya) * (o - a) / (b - a);
  }
  return 0;
};
// a tabletop's profile along it: up its ramp, along its top, down its landing
const JUMP_UP = 1.8, JUMP_TOP = 1.6, JUMP_DOWN = 2, JUMP_H = 0.5;
const jumpAt = (u) => {
  if (u <= 0 || u >= JUMP_UP + JUMP_TOP + JUMP_DOWN) return 0;
  if (u < JUMP_UP) return JUMP_H * Math.sin((u / JUMP_UP) * Math.PI / 2) ** 1.4;
  if (u < JUMP_UP + JUMP_TOP) return JUMP_H;
  return JUMP_H * (1 - (u - JUMP_UP - JUMP_TOP) / JUMP_DOWN);
};

// where a trail meets a road nothing of it is set on the asphalt: within a road's half width (and `pad`) of its middle
const onRoad = (x, z, pad = 0.5) => nearestRoads(x, z, 30).some((n) => n.dist < (n.road.w || 0) / 2 + pad);

// a trail's points as a walk: the point and its heading at a distance along it
function walker(t) {
  const P = [];
  for (let i = 1; i + 1 < t.length; i += 2) P.push([t[i], t[i + 1]]);
  const S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const len = S[S.length - 1];
  let i = 0;
  const at = (s) => {
    s = Math.max(0, Math.min(len, s));
    if (S[i] > s) i = 0;
    while (i + 2 < P.length && S[i + 1] < s) i++;
    const l = S[i + 1] - S[i] || 1, f = (s - S[i]) / l;
    const tx = (P[i + 1][0] - P[i][0]) / l, tz = (P[i + 1][1] - P[i][1]) / l;
    return { x: P[i][0] + (P[i + 1][0] - P[i][0]) * f, z: P[i][1] + (P[i + 1][1] - P[i][1]) * f, tx, tz, h: Math.atan2(tx, tz) };
  };
  return { len, at, count: P.length };
}

function createMtbTrails(group, data) {
  group.name = 'MtbTrails';
  const T = data?.trails || [];
  const rocks = [], roots = [], logs = [], posts = [], blazes = [], jumps = [], berms = [];
  for (const t of T) {
    const scale = t[0], w = walker(t);
    if (w.count < 2 || w.len < 4) continue;
    const seed = t[1] * 0.37 + t[2] * 0.11;
    // the rating's post at each end, and every 300 m along
    const stations = [0.5];
    for (let s = 300; s < w.len - 50; s += 300) stations.push(s);
    stations.push(w.len - 0.5);
    for (const s of stations) {
      const p = w.at(s), side = hash(seed, s) < 0.5 ? 1 : -1;
      const x = p.x + p.tz * side * (HW + 0.5), z = p.z - p.tx * side * (HW + 0.5);
      if (onRoad(x, z)) continue;
      posts.push({ x, y: groundHeight(x, z) + SURF - 0.15, z, yaw: p.h });
      blazes.push({ x: x + p.tz * -side * 0.055, y: groundHeight(x, z) + SURF + 0.95, z: z - p.tx * -side * 0.055, yaw: Math.atan2(-p.tz * side, p.tx * side), color: BLAZE[scale] });
    }
    // rocks off its edges, the bigger ones further off
    for (let s = 1; s < w.len; s += 2.5) {
      const r = hash(seed + s, s * 0.7);
      if (r > 0.45) continue;
      const p = w.at(s), side = r < 0.22 ? 1 : -1, size = 0.14 + hash(s, seed) * 0.42, off = HW + 0.25 + size + hash(seed, s * 1.3) * 1.4;
      const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
      if (onRoad(x, z, size)) continue;
      rocks.push({ x, y: groundHeight(x, z) + SURF - size * 0.35, z, yaw: hash(x, z) * 6.28, sx: size * (1 + hash(z, x) * 0.6), sy: size * 0.7, sz: size, color: 0.36 + hash(x * 2, z) * 0.2 });
    }
    // roots across it
    if (scale >= 1) for (let s = 6; s < w.len - 3; s += 11) {
      if (hash(seed * 2 + s, s) > 0.5) continue;
      const p = w.at(s);
      for (let k = 0; k < 2 + Math.floor(hash(s, seed * 3) * 2); k++) {
        const a = (hash(s + k, seed) - 0.5) * 0.9, u = k * 0.35, x = p.x + p.tx * u, z = p.z + p.tz * u;
        if (onRoad(x, z, HW + 0.7)) continue;
        roots.push({ x, y: groundHeight(x, z) + SURF + 0.012, z, yaw: p.h + Math.PI / 2 + a, s: HW * 2 + 0.6 + hash(k, s) * 0.8 });
      }
    }
    // rock gardens on the harder trails: a few metres of stones set in its tread
    if (scale >= 2) for (let s = 30; s < w.len - 8; s += 85) {
      for (let k = 0; k < 9; k++) {
        const p = w.at(s + hash(s, k) * 4.5), size = 0.1 + hash(k, s) * 0.12, o = (hash(k * 3, s) - 0.5) * HW * 1.8;
        const x = p.x + p.tz * o, z = p.z - p.tx * o;
        if (onRoad(x, z, size)) continue;
        rocks.push({ x, y: groundHeight(x, z) + SURF - size * 0.45, z, yaw: hash(x, z) * 6.28, sx: size * 1.3, sy: size * 0.65, sz: size, color: 0.42 + hash(z, x) * 0.15 });
      }
    }
    // logs to roll over, and on the rated trails a tabletop now and then
    if (scale >= 1) for (let s = 55; s < w.len - 10; s += 170) {
      const p = w.at(s + hash(seed, s) * 30);
      if (onRoad(p.x, p.z, HW + 0.8)) continue;
      logs.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, r: 0.13 + hash(s, seed) * 0.05, l: HW * 2 + 1.2, g: groundHeight(p.x, p.z) + SURF });
    }
    if (scale >= 1) for (let s = 120; s < w.len - 20; s += 260) {
      const p = w.at(s);
      // only on a straight bit, so it's met head on
      const q = w.at(s + JUMP_UP + JUMP_TOP + JUMP_DOWN);
      if (Math.abs(Math.atan2(Math.sin(q.h - p.h), Math.cos(q.h - p.h))) > 0.25) continue;
      if (onRoad(p.x, p.z, HW + 0.5) || onRoad(q.x, q.z, HW + 0.5)) continue;
      jumps.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz });
    }
    // berms on the outside of its tight turns
    let last = -Infinity;
    for (let s = 5; s < w.len - 5; s += 1) {
      if (s - last < 14) continue;
      const a = w.at(s - 4), b = w.at(s + 4), turn = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h));
      if (Math.abs(turn) < 0.65) continue;
      // the outside of the turn: away from the way it's turning (heading up turns it left, toward +x of the right hand)
      berms.push({ s, w, side: turn > 0 ? -1 : 1 });
      last = s;
    }
  }

  // the berms' mesh: each a mound along the turn's outside, rising from the trail's edge and easing in and out
  const bpos = [], bcol = [], bidx = [], bermSamples = [];
  for (const b of berms) {
    const n = 21, base = bpos.length / 3;
    for (let k = 0; k < n; k++) {
      const s = b.s - 5 + k * 0.5, p = b.w.at(s), env = Math.sin((k / (n - 1)) * Math.PI);
      // outward: to the trail's right is (tz, -tx); the turn's outside is `side` of that
      const ox = p.tz * b.side, oz = -p.tx * b.side;
      for (const [o, hgt] of BERM) {
        const x = p.x + ox * (HW - 0.1 + o), z = p.z + oz * (HW - 0.1 + o);
        bpos.push(x, groundHeight(x, z) + SURF + 0.008 + hgt * env, z);
        const v = 0.48 - hgt * 0.12 + hash(x, z) * 0.04;
        bcol.push(v * 0.98, v * 0.79, v * 0.58);
      }
      bermSamples.push({ x: p.x + ox * (HW - 0.1), z: p.z + oz * (HW - 0.1), ox, oz, env });
    }
    const m = BERM.length;
    for (let k = 0; k + 1 < n; k++) for (let c = 0; c + 1 < m; c++) {
      const a = base + k * m + c, bb = a + 1, cc = a + m, d = cc + 1;
      if (b.side > 0) bidx.push(a, cc, bb, bb, cc, d); else bidx.push(a, bb, cc, bb, d, cc);
    }
  }
  if (bidx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
    geo.setIndex(bidx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    // cut into 300 m squares (merge-static.js splitByCell), each hidden beyond its distance on its own: the trails
    // run all over town, and one mesh of them all was never far enough off to be hidden
    const mesh = new THREE.Mesh(geo.toNonIndexed(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    geo.dispose();
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const piece of splitByCell(mesh, 300)) piece.userData.cullDistance = 260;
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const inst = (geo, mat, list, cull, set) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, k) => {
      set(it);
      m.setMatrixAt(k, m4.compose(v, q, sc));
      if (it.color !== undefined) m.setColorAt(k, typeof it.color === 'number' && it.color < 1 ? col.setRGB(it.color, it.color * 0.98, it.color * 0.94) : col.setHex(it.color));
    });
    m.castShadow = m.receiveShadow = true;
    m.userData.cullDistance = cull;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  { // knobbly: each vertex pushed in or out a little
    const p = rockGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const f = 0.8 + hash(p.getX(i) * 3.1 + p.getY(i), p.getZ(i) * 2.3) * 0.35; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); }
    rockGeo.computeVertexNormals();
  }
  const bark = new THREE.MeshStandardNodeMaterial({ color: 0x5b4632, roughness: 0.95 });
  inst(rockGeo, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9 }), rocks, 140, (r) => { v.set(r.x, r.y, r.z); q.setFromAxisAngle(up, r.yaw); sc.set(r.sx, r.sy, r.sz); });
  inst(new THREE.CylinderGeometry(0.035, 0.05, 1, 6).rotateZ(Math.PI / 2), bark, roots, 70, (r) => { v.set(r.x, r.y, r.z); q.setFromAxisAngle(up, r.yaw - Math.PI / 2); sc.set(r.s, 1, 1); });
  inst(new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(Math.PI / 2), bark, logs, 160, (l) => { v.set(l.x, l.g + l.r * 0.85, l.z); q.setFromAxisAngle(up, Math.atan2(l.tx, l.tz)); sc.set(l.l, l.r, l.r); });
  inst(new THREE.BoxGeometry(0.1, 1.25, 0.1).translate(0, 0.625, 0), new THREE.MeshStandardNodeMaterial({ color: 0x7a5a3c, roughness: 0.9 }), posts, 180, (p) => { v.set(p.x, p.y, p.z); q.setFromAxisAngle(up, p.yaw); sc.set(1, 1, 1); });
  inst(new THREE.BoxGeometry(0.1, 0.1, 0.012), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.6 }), blazes, 120, (b) => { v.set(b.x, b.y, b.z); q.setFromAxisAngle(up, b.yaw); sc.set(1, 1, 1); });
  // the tabletops: dirt mounds along the trail, a little wider than it
  if (jumps.length) {
    const prof = [];
    for (let u = 0; u <= JUMP_UP + JUMP_TOP + JUMP_DOWN + 0.001; u += 0.3) prof.push([u, jumpAt(u)]);
    const pts = prof.map(([u, h]) => new THREE.Vector2(u, h));
    const jgeo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: HW * 2 + 0.6, bevelEnabled: false, steps: 1 });
    jgeo.translate(0, 0, -(HW * 2 + 0.6) / 2).rotateY(-Math.PI / 2); // along local +z, across local x
    inst(jgeo, new THREE.MeshStandardNodeMaterial({ color: 0x7d6347, roughness: 1 }), jumps, 220, (j) => { v.set(j.x, groundHeight(j.x, j.z) + SURF - 0.02, j.z); q.setFromAxisAngle(up, Math.atan2(j.tx, j.tz)); sc.set(1, 1, 1); });
  }

  // what's ridden over, in buckets of 32 m
  const buckets = new Map(), key = (x, z) => Math.floor(x / 32) * 100003 + Math.floor(z / 32);
  const add = (x, z, it) => {
    for (const dx of [-3, 3]) for (const dz of [-3, 3]) {
      const k = key(x + dx, z + dz);
      if (!buckets.has(k)) buckets.set(k, new Set());
      buckets.get(k).add(it);
    }
  };
  for (const l of logs) add(l.x, l.z, { kind: 'log', ...l });
  for (const j of jumps) add(j.x + j.tx * 2.7, j.z + j.tz * 2.7, { kind: 'jump', ...j });
  for (const b of bermSamples) add(b.x, b.z, { kind: 'berm', ...b });

  log(`[mtb] ${T.length} trails: ${rocks.length} rocks, ${roots.length} roots, ${logs.length} logs, ${jumps.length} tabletops, ${berms.length} berms, ${posts.length} trail posts`);
  return {
    count: T.length,
    // over a berm, a log or a tabletop at (x, z): its top, else -Infinity
    top(x, z) {
      const set = buckets.get(key(x, z));
      if (!set) return -Infinity;
      let top = -Infinity, berm = 0;
      for (const it of set) {
        const dx = x - it.x, dz = z - it.z;
        if (it.kind === 'berm') {
          if (dx * dx + dz * dz > 6.5) continue;
          const o = dx * it.ox + dz * it.oz, along = Math.abs(dx * -it.oz + dz * it.ox);
          if (along < 0.3) berm = Math.max(berm, bermAt(o) * it.env);
        } else if (it.kind === 'log') {
          const along = dx * it.tx + dz * it.tz, across = Math.abs(dx * it.tz - dz * it.tx);
          if (Math.abs(along) < it.r && across < it.l / 2) top = Math.max(top, it.g + it.r * 0.85 + Math.sqrt(it.r * it.r - along * along));
        } else {
          const along = dx * it.tx + dz * it.tz, across = Math.abs(dx * it.tz - dz * it.tx);
          if (across < HW + 0.3) { const h = jumpAt(along); if (h > 0) top = Math.max(top, groundHeight(x, z) + SURF + h); }
        }
      }
      if (berm > 0.01) top = Math.max(top, groundHeight(x, z) + SURF + berm);
      return top;
    }
  };
}

async function buildMtbTrails(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/mtb-trails.json')));
  } catch (error) { log(`[mtb] no trail data: ${error}`); }
  return createMtbTrails(group, data);
}

export { buildMtbTrails };
