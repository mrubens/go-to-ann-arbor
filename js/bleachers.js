import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';

// Lamp: the town's bleachers (data/bleachers.json, Assets/Tools/build-bleachers.py): the ones mapped by the fields and
// tracks (OpenStreetMap), and a little three-row set by each ball diamond that has none. Aluminium seat and foot planks
// row over row, a step up each, on steel stringers every couple of metres, a guardrail across the back of the tall
// ones. Each is set level on the lowest ground under it, its legs running down into the slope. All one instanced mesh
// per piece: the planks and rails scaled to their length, the stringers to the stand's depth and height.
// `colliders` keep everything out of them but the way up their front, as the stadium's rows are: on foot a row at a
// time (`top`, the footboard or seat under them), and on wheels up one slope from the front row to the back (`ramp`),
// to fly off the back or the sides; `seats` lists where someone sits, a metre apart along each row.

const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
const RISE = 0.38;

// the planks of a row, 1 m long along local x (scaled to the row), the seat behind and the footboard in front
function seatGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(1, 0.035, 0.125).translate(0, 0, -0.07),
    new THREE.BoxGeometry(1, 0.035, 0.125).translate(0, 0, 0.065),
    new THREE.BoxGeometry(1, 0.05, 0.02).translate(0, -0.035, 0.125)
  ].map(flat));
}
function footGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(1, 0.03, 0.12).translate(0, 0, -0.065),
    new THREE.BoxGeometry(1, 0.03, 0.12).translate(0, 0, 0.065)
  ].map(flat));
}
// a stringer frame, 1 deep (local z, front at +0.5) and 1 high (scaled to the stand): the sloped beam the planks sit
// on, a leg at the front and one at the back, both running a metre into the ground, and a brace between them
function frameGeometry() {
  const beam = (y0, z0, y1, z1, w = 0.06) => {
    const len = Math.hypot(y1 - y0, z1 - z0);
    return new THREE.BoxGeometry(0.05, len, w).rotateX(Math.atan2(z1 - z0, y1 - y0)).translate(0, (y0 + y1) / 2, (z0 + z1) / 2);
  };
  return mergeGeometries([
    beam(0.08, 0.5, 1, -0.5, 0.08),
    beam(-1, 0.48, 0.1, 0.48),
    beam(-1, -0.48, 1, -0.48),
    beam(-0.2, 0.48, 0.55, -0.48, 0.04)
  ].map(flat));
}
// the back rail, 1 m long (scaled), with a post at one end
function railGeometry() {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.022, 0.022, 1, 6).rotateZ(Math.PI / 2).translate(0, 1.0, 0),
    new THREE.CylinderGeometry(0.022, 0.022, 1, 6).rotateZ(Math.PI / 2).translate(0, 0.5, 0),
    new THREE.CylinderGeometry(0.025, 0.025, 1.05, 6).translate(-0.5, 0.52, 0)
  ].map(flat));
}

function createBleachers(group, data) {
  group.name = 'Bleachers';
  const B = data?.bleachers || [];
  const seatsL = [], footsL = [], framesL = [], railsL = [];
  const colliders = [], seats = [], stands = [], grid = new Map();
  const CELL = 64, cellKey = (i, j) => i * 65536 + j;
  for (let i = 0; i + 4 < B.length; i += 5) {
    const [cx, cz, h, length, depth] = B.slice(i, i + 5);
    const fx = Math.sin(h), fz = Math.cos(h), ax = Math.cos(h), az = -Math.sin(h);
    const rows = Math.max(2, Math.min(10, Math.round(depth / 0.62)));
    const step = depth / rows;
    // level on the lowest ground under it
    let g = Infinity;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) g = Math.min(g, groundHeight(cx + ax * u * length + fx * v * depth, cz + az * u * length + fz * v * depth));
    g += 0.1;
    const P = (u, v) => [cx + ax * u + fx * v, cz + az * u + fz * v];
    for (let r = 0; r < rows; r++) {
      const v = depth / 2 - (r + 0.5) * step, y = g + r * RISE;
      const [sx, sz] = P(0, v - step * 0.18), [qx, qz] = P(0, v + step * 0.3);
      seatsL.push([sx, y + 0.44, sz, h, length]);
      footsL.push([qx, y + 0.06, qz, h, length]);
      for (let u = -length / 2 + 0.5; u < length / 2; u += 1) {
        const [px, pz] = P(u, v - step * 0.18);
        seats.push({ x: px, z: pz, y: y + 0.46, yaw: h, kind: 'bleacher' });
      }
    }
    const H = (rows - 1) * RISE + 0.44, n = Math.max(2, Math.ceil(length / 2.4) + 1);
    for (let k = 0; k < n; k++) {
      const u = -length / 2 + 0.15 + (k / (n - 1)) * (length - 0.3), [px, pz] = P(u, 0);
      framesL.push([px, g, pz, h, 1, H, depth]);
    }
    if (rows >= 4) {
      const [px, pz] = P(0, -depth / 2 - 0.05);
      railsL.push([px, g + H, pz, h, length]);
    }
    const stand = { cx, cz, fx, fz, ax, az, length, depth, rows, step, g, H };
    stands.push(stand);
    const R = Math.hypot(length, depth) / 2;
    for (let i = Math.floor((cx - R) / CELL); i <= Math.floor((cx + R) / CELL); i++) {
      for (let j = Math.floor((cz - R) / CELL); j <= Math.floor((cz + R) / CELL); j++) {
        const k = cellKey(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(stand);
      }
    }
    // solid boxes along it, a stand's depth square each; one is walked or driven into only where the row (on foot) or
    // the slope (on wheels) there is within a step of the feet or wheels: from the front, along it once up on it, or,
    // as the stadium's rows are, jumped up onto from the side going fast enough (the step a car takes grows with speed)
    const top = g + H + (rows >= 4 ? 1.05 : 0.1);
    for (let u = -length / 2 + depth / 2; u < length / 2 + 0.01; u += depth) {
      const [px, pz] = P(Math.min(u, length / 2 - depth / 2), 0), r = depth / 2;
      colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, minY: g - 1, maxY: top,
        stand: true, stepOn: (x, z, y, mode, climb = 0.6) => mode === 'person' ? surface(stand, x, z, true) <= y + 0.55
          : (mode === 'car' || mode === 'cyclist') && slope(stand, x, z, true) <= y + climb });
    }
  }

  const alum = new THREE.MeshStandardNodeMaterial({ color: 0xc3c8cc, metalness: 0.75, roughness: 0.32 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x6d7378, metalness: 0.6, roughness: 0.5 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, list, cull) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, yaw, sx, sy = 1, sz = 1], k) => {
      q.setFromAxisAngle(up, yaw);
      m.setMatrixAt(k, m4.compose(v.set(x, y, z), q, sc.set(sx, sy, sz)));
    });
    m.castShadow = m.receiveShadow = true;
    m.userData.cullDistance = cull;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  inst(seatGeometry(), alum, seatsL, 320);
  inst(footGeometry(), alum, footsL, 260);
  inst(frameGeometry(), steel, framesL, 260);
  inst(railGeometry(), steel, railsL, 260);

  // the footboard or seat of the row under (x, z), or -Infinity off the stand; `near` takes the nearest point of it
  function surface(S, x, z, near = false) {
    const dx = x - S.cx, dz = z - S.cz;
    let u = dx * S.ax + dz * S.az, v = dx * S.fx + dz * S.fz;
    if (near) {
      u = Math.max(-S.length / 2, Math.min(S.length / 2, u));
      v = Math.max(-S.depth / 2, Math.min(S.depth / 2, v));
    } else if (Math.abs(u) > S.length / 2 || Math.abs(v) > S.depth / 2) return -Infinity;
    const f = (S.depth / 2 - v) / S.step, r = Math.min(S.rows - 1, Math.max(0, Math.floor(f)));
    return S.g + r * RISE + (f - r < 0.45 ? 0.095 : 0.46);
  }
  // the slope over the rows' fronts, from the front footboard to the back seat, or -Infinity off the stand
  function slope(S, x, z, near = false) {
    const dx = x - S.cx, dz = z - S.cz;
    let u = dx * S.ax + dz * S.az, v = dx * S.fx + dz * S.fz;
    if (near) v = Math.max(-S.depth / 2, Math.min(S.depth / 2, v));
    else if (Math.abs(u) > S.length / 2 || Math.abs(v) > S.depth / 2) return -Infinity;
    return S.g + 0.1 + (S.H - 0.1) * (S.depth / 2 - v) / S.depth;
  }
  function standRamp(x, z) {
    const list = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    let best = -Infinity;
    if (list) for (const S of list) best = Math.max(best, slope(S, x, z));
    return best;
  }
  // on foot: the row under them, one within a step of their feet or below them (a stand's underside is never stood on)
  function standTop(x, z, y = Infinity) {
    const list = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    let best = -Infinity;
    if (list) for (const S of list) {
      const s = surface(S, x, z);
      if (s > best && s <= y + 0.55) best = s;
    }
    return best;
  }

  log(`[bleachers] ${B.length / 5} stands, ${seatsL.length} rows, ${seats.length} places to sit`);
  return { colliders, seats, top: standTop, ramp: standRamp, count: B.length / 5 };
}

async function buildBleachers(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/bleachers.json')));
  } catch (error) { log(`[bleachers] no bleacher data: ${error}`); }
  return createBleachers(group, data);
}

export { buildBleachers };
