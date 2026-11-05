import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';

// Lamp: the Ann Arbor Skatepark in Veterans Memorial Park (data/skate-park.json, Assets/Tools/build-skate-park.py),
// poured concrete within its mapped outline: a lip of quarter pipes all the way round its edge with steel coping on top
// (so the narrow north arm is a snake run between two walls), a deep round bowl in its wide south end, and in the plaza
// between them a pyramid funbox, a ledge, a manual pad and a flat bar. Outside the lip a bank runs down to the lawn, so
// it can be ridden into from anywhere. One surface, sampled on a grid and laid on the ground; `top(x, z)` is that
// surface (and the ledge's and pad's tops) for walking, riding and driving on, as the playgrounds' slides are.

const STEP = 0.35, BASE = LIFT.lawn + 0.03;
const LIP = 1.15, DECK = 0.4, WALL = 2.8, BANK = 2.6; // the quarter pipes round the edge: height, flat deck, transition, the bank outside
const BOWL_H = 1.9, BOWL_WALL = 3.4, BOWL_DECK = 1.4, BOWL_BANK = 3;
const curve = (t) => Math.pow(Math.min(1, Math.max(0, t)), 2.2);
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

function createSkatePark(group, data) {
  group.name = 'SkatePark';
  const O = data?.outline || [];
  const n = O.length / 2;
  if (n < 4) return { top: () => -Infinity, count: 0 };
  // inside distance: positive within the outline, negative outside
  const sdist = (x, z) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = O[j * 2], az = O[j * 2 + 1], bx = O[i * 2], bz = O[i * 2 + 1];
      if ((bz > z) !== (az > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
      const ex = bx - ax, ez = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      d = Math.min(d, Math.hypot(x - ax - ex * u, z - az - ez * u));
    }
    return inside ? d : -d;
  };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const x = O[i * 2], z = O[i * 2 + 1];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); cx += x / n; cz += z / n;
  }
  // its long axis, from the outline's spread
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < n; i++) { const dx = O[i * 2] - cx, dz = O[i * 2 + 1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), tx = Math.cos(ang), tz = Math.sin(ang), nx = -tz, nz = tx;

  // the bowl: in the roomiest place at one end, as deep in from the edge as it can be
  let bowl = null, wideEnd = null;
  for (const end of [1, -1]) {
    let best = null;
    for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
      if (((x - cx) * tx + (z - cz) * tz) * end < 6) continue;
      const s = sdist(x, z);
      if (!best || s > best.s) best = { x, z, s };
    }
    if (best && (!bowl || best.s > bowl.s)) { bowl = best; wideEnd = end; }
  }
  const R = bowl ? Math.min(8, bowl.s - 0.6) : 0, floorR = Math.max(2.5, R - BOWL_WALL);
  // the plaza's pieces, toward the other end from the bowl
  const clear = (x, z, room) => sdist(x, z) > room && (!bowl || Math.hypot(x - bowl.x, z - bowl.z) > R + BOWL_DECK + BOWL_BANK + room - 1);
  let fun = null;
  for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) {
    if (!clear(x, z, 4.5)) continue;
    const s = sdist(x, z);
    if (!fun || s > fun.s) fun = { x, z, s };
  }
  const boxes = []; // the ledge and the pad: { x, z, yaw, l, w, h }
  const place = (l, w, h, tries) => {
    for (const [a, b] of tries) {
      const x = fun.x + tx * a + nx * b, z = fun.z + tz * a + nz * b;
      if (clear(x, z, Math.max(l, w) / 2 + 1.2) && boxes.every((o) => Math.hypot(o.x - x, o.z - z) > 4.5)) { const o = { x, z, l, w, h }; boxes.push(o); return o; }
    }
    return null;
  };
  let rail = null;
  if (fun) {
    place(4.2, 0.55, 0.45, [[0, 5.5], [0, -5.5], [6.5, 0], [-6.5, 0], [5, 4], [-5, -4]]); // the ledge
    place(5, 2, 0.3, [[0, -5.5], [0, 5.5], [-6.5, 0], [6.5, 0], [-5, 4], [5, -4]]); // the manual pad
    for (const [a, b] of [[7, 3], [-7, -3], [7, -3], [-7, 3], [0, 8], [0, -8]]) {
      const x = fun.x + tx * a + nx * b, z = fun.z + tz * a + nz * b;
      if (clear(x, z, 3.5) && boxes.every((o) => Math.hypot(o.x - x, o.z - z) > 3.5)) { rail = { x, z, l: 5 }; break; }
    }
  }
  const inBox = (o, x, z) => {
    const dx = x - o.x, dz = z - o.z;
    return Math.abs(dx * tx + dz * tz) <= o.l / 2 && Math.abs(dx * nx + dz * nz) <= o.w / 2;
  };

  // the surface over (x, z) above the ground, from its inside distance s; null off the park
  const surface = (x, z, s) => {
    if (s < -BANK) return null;
    let f = s < 0 ? LIP * (1 + s / BANK) : s < DECK ? LIP : LIP * curve(1 - (s - DECK) / WALL);
    if (bowl) {
      const r = Math.hypot(x - bowl.x, z - bowl.z);
      const b = r < floorR ? 0 : r < R ? BOWL_H * curve((r - floorR) / (R - floorR)) : r < R + BOWL_DECK ? BOWL_H : BOWL_H * Math.max(0, 1 - (r - R - BOWL_DECK) / BOWL_BANK);
      // inside the bowl it's the bowl's, round its rim the higher of the two
      f = r < R ? b : Math.max(f, b);
    }
    if (fun) {
      const dx = x - fun.x, dz = z - fun.z, a = Math.abs(dx * tx + dz * tz) - 1.6, c = Math.abs(dx * nx + dz * nz) - 1.3;
      const p = 0.55 * Math.max(0, 1 - Math.max(a, c, 0) / 2.3);
      f = Math.max(f, p);
    }
    return f;
  };

  const cols = Math.ceil((maxX - minX + 2 * BANK + 2) / STEP) + 1, rows = Math.ceil((maxZ - minZ + 2 * BANK + 2) / STEP) + 1;
  const x0 = minX - BANK - 1, z0 = minZ - BANK - 1;
  const F = new Float32Array(cols * rows).fill(NaN); // the surface above the ground, as drawn
  const T = new Float32Array(cols * rows).fill(NaN); // and as stood on, with the ledge's and pad's tops
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP, f = surface(x, z, sdist(x, z));
    if (f == null) continue;
    F[j * cols + i] = f;
    let t = f;
    for (const o of boxes) if (inBox(o, x, z)) t = Math.max(t, o.h);
    T[j * cols + i] = t;
  }

  // the surface's mesh: a vertex at each sample on the park, a cell where all four are
  const index = new Int32Array(cols * rows).fill(-1);
  const pos = [], colr = [], idx = [];
  const ground = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (Number.isNaN(F[k])) continue;
    const x = x0 + i * STEP, z = z0 + j * STEP, g = groundHeight(x, z);
    ground[k] = g;
    index[k] = pos.length / 3;
    pos.push(x, g + BASE + F[k], z);
    // concrete, a little mottled, darker where it's worn in the bowl's floor and the run's bottom
    const v = 0.6 + hash(x, z) * 0.05 - (F[k] < 0.05 ? 0.04 : 0);
    colr.push(v, v * 0.985, v * 0.955);
  }
  for (let j = 0; j + 1 < rows; j++) for (let i = 0; i + 1 < cols; i++) {
    const a = index[j * cols + i], b = index[j * cols + i + 1], c = index[(j + 1) * cols + i], d = index[(j + 1) * cols + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const concrete = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.88 });
  const surf = new THREE.Mesh(geo, concrete);
  surf.receiveShadow = true;
  surf.castShadow = true;
  surf.userData.cullDistance = 700;
  group.add(surf);

  // steel coping: along the lip's inner edge round the outline, and round the bowl's rim
  const coping = [];
  const copeAt = (ax, az, bx, bz, y) => coping.push([ax, az, bx, bz, y]);
  for (let i = 0; i < n; i++) {
    const p = (k) => [O[((k + n) % n) * 2], O[((k + n) % n) * 2 + 1]];
    const off = (k) => {
      // a point a deck's width in from the outline at vertex k, along the two edges' inward normals
      const [ax, az] = p(k - 1), [bx, bz] = p(k), [qx, qz] = p(k + 1);
      let mx = -(bz - az) - (qz - bz), mz = (bx - ax) + (qx - bx);
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
      if (sdist(bx + mx * 0.3, bz + mz * 0.3) < 0) { mx = -mx; mz = -mz; }
      return [bx + mx * DECK, bz + mz * DECK];
    };
    const [ax, az] = off(i), [bx, bz] = off(i + 1);
    // not where it runs into the bowl's deck
    if (bowl && Math.hypot((ax + bx) / 2 - bowl.x, (az + bz) / 2 - bowl.z) < R + BOWL_DECK) continue;
    copeAt(ax, az, bx, bz, LIP);
  }
  if (bowl) for (let k = 0; k < 56; k++) {
    const a0 = (k / 56) * Math.PI * 2, a1 = ((k + 1) / 56) * Math.PI * 2;
    copeAt(bowl.x + Math.sin(a0) * R, bowl.z + Math.cos(a0) * R, bowl.x + Math.sin(a1) * R, bowl.z + Math.cos(a1) * R, BOWL_H);
  }
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.3 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const copeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), steel, Math.max(1, coping.length));
  coping.forEach(([ax, az, bx, bz, y], k) => {
    const ya = groundHeight(ax, az) + BASE + y + 0.01, yb = groundHeight(bx, bz) + BASE + y + 0.01;
    dir.set(bx - ax, yb - ya, bz - az);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    copeMesh.setMatrixAt(k, m4.compose(v3.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2), q, sc.set(1, len + 0.02, 1)));
  });
  copeMesh.count = coping.length;
  copeMesh.castShadow = true;
  copeMesh.userData.cullDistance = 260;
  copeMesh.instanceMatrix.needsUpdate = true;
  copeMesh.computeBoundingSphere();
  group.add(copeMesh);

  // the ledge and the pad: concrete blocks with steel angle on their top edges, set level on the low side
  const yaw = Math.atan2(-tz, tx);
  const blocks = [], angles = [];
  for (const o of boxes) {
    const g = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => groundHeight(o.x + tx * a * o.l / 2 + nx * b * o.w / 2, o.z + tz * a * o.l / 2 + nz * b * o.w / 2)));
    o.y = g + BASE;
    blocks.push(o);
    for (const s of [-1, 1]) angles.push({ x: o.x + nx * s * (o.w / 2 - 0.02), y: o.y + o.h, z: o.z + nz * s * (o.w / 2 - 0.02), l: o.l });
  }
  const blockGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const blockMesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardNodeMaterial({ color: 0xa3a19b, roughness: 0.85 }), Math.max(1, blocks.length));
  blocks.forEach((o, k) => blockMesh.setMatrixAt(k, m4.compose(v3.set(o.x, o.y - 0.3, o.z), q.setFromAxisAngle(up, yaw), sc.set(o.l, o.h + 0.3, o.w))));
  blockMesh.count = blocks.length;
  const angleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 0.05).translate(0, -0.02, 0), steel, Math.max(1, angles.length));
  angles.forEach((a, k) => angleMesh.setMatrixAt(k, m4.compose(v3.set(a.x, a.y + 0.002, a.z), q.setFromAxisAngle(up, yaw), sc.set(a.l, 1, 1))));
  angleMesh.count = angles.length;
  // the flat bar: a round rail on two posts, knee high
  let railMesh = null;
  if (rail) {
    const g = groundHeight(rail.x, rail.z) + BASE;
    const bar = new THREE.CylinderGeometry(0.03, 0.03, rail.l, 10).rotateZ(Math.PI / 2).translate(0, 0.34, 0);
    const posts = [-1, 1].map((s) => new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8).translate(s * (rail.l / 2 - 0.3), 0.04, 0));
    railMesh = new THREE.Mesh(mergeGeometries([bar, ...posts]), steel);
    railMesh.position.set(rail.x, g, rail.z);
    railMesh.rotation.y = yaw;
    railMesh.castShadow = true;
    railMesh.userData.cullDistance = 200;
  }
  for (const m of [blockMesh, angleMesh]) {
    m.castShadow = m.receiveShadow = true;
    m.userData.cullDistance = 260;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
  }
  if (railMesh) group.add(railMesh);

  log(`[skate park] ${data.name || 'skate park'}: ${idx.length / 3} triangles of concrete, bowl ${bowl ? `${(R * 2).toFixed(1)} m across` : 'none'}, ${boxes.length} blocks${rail ? ', a flat bar' : ''}, ${coping.length} lengths of coping`);
  return {
    count: 1,
    // the park's surface at (x, z) for walking, riding and driving on, else -Infinity
    top(x, z) {
      const fi = (x - x0) / STEP, fj = (z - z0) / STEP, i = Math.floor(fi), j = Math.floor(fj);
      if (i < 0 || j < 0 || i + 1 >= cols || j + 1 >= rows) return -Infinity;
      const k = j * cols + i, a = T[k], b = T[k + 1], c = T[k + cols], d = T[k + cols + 1];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) return -Infinity;
      const u = fi - i, w = fj - j;
      // a block's top is flat to its edge, not eased between samples
      for (const o of boxes) if (inBox(o, x, z)) return o.y + o.h;
      return groundHeight(x, z) + BASE + (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
    }
  };
}

async function buildSkatePark(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/skate-park.json')));
  } catch (error) { log(`[skate park] no skate park data: ${error}`); }
  return createSkatePark(group, data);
}

export { buildSkatePark };
