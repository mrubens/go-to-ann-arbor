import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { polygonContains } from './building-collision.js';

// The town's helipads, from OpenStreetMap (aeroway=helipad, © OpenStreetMap contributors, ODbL), in the city's metres
// (city-geodata.js's frame): Michigan Medicine's heliport on University Hospital, Survival Flight's pair by the medical
// campus, and the pad on the roof east of them. Each is painted where it is: on the roof of the building under it (the
// tallest collider whose outline holds its centre), else on the ground, so the helicopter can set down on it as it
// would on any roof (controllers.js helicopterFloor). St. Joseph Mercy's, east of US-23, is beyond the town's edge.
const PADS = [
  { name: 'UMMC Heliport', outline: [1479.3, -649.5, 1477.6, -654.0, 1479.2, -656.9, 1482.2, -658.1, 1485.3, -657.3, 1487.2, -654.8, 1487.2, -651.7, 1485.4, -649.2, 1482.4, -648.3] },
  { name: 'Survival Flight pad 1', outline: [1705.3, -636.7, 1704.0, -643.0, 1708.0, -648.1, 1714.4, -648.4, 1718.4, -644.8, 1719.0, -639.5, 1716.1, -635.1, 1710.4, -633.7] },
  { name: 'Survival Flight pad 2', outline: [1732.5, -607.7, 1731.2, -613.9, 1735.1, -619.0, 1741.6, -619.3, 1745.5, -615.8, 1746.2, -610.5, 1743.2, -606.0, 1737.5, -604.6] },
  { name: 'Medical campus roof pad', square: true, outline: [1798.8, -284.0, 1782.4, -283.6, 1782.7, -267.4, 1799.2, -267.6] }
];

const PAD = new THREE.Color(0x4a4f55), PAINT = new THREE.Color(0xf4f4ef), CROSS = new THREE.Color(0xc8202c);

// the top of what's under (x, z): the tallest building's roof holding it, else the ground
function topAt(colliders, x, z) {
  let top = groundHeight(x, z);
  for (const c of colliders) {
    if (c.thin || c.onHit || !(c.maxY > top)) continue;
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.polygon && !polygonContains(c.polygon, x, z)) continue;
    if (c.obb) {
      const o = c.obb, dx = x - o.cx, dz = z - o.cz;
      if (Math.abs(dx * o.cs - dz * o.sn) > o.hx || Math.abs(dx * o.sn + dz * o.cs) > o.hz) continue;
    }
    top = c.maxY;
  }
  return top;
}

// a flat piece lying on the pad, painted one colour
function piece(geo, col, x, y, z, yaw) {
  geo.rotateX(-Math.PI / 2).rotateY(yaw).translate(x, y, z);
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(c, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

function buildHelipads(group, colliders) {
  const parts = [], spots = [];
  for (const p of PADS) {
    const o = p.outline;
    let cx = 0, cz = 0;
    for (let i = 0; i < o.length; i += 2) { cx += o[i]; cz += o[i + 1]; }
    cx /= o.length / 2; cz /= o.length / 2;
    let r = Infinity;
    for (let i = 0; i < o.length; i += 2) r = Math.min(r, Math.hypot(o[i] - cx, o[i + 1] - cz));
    // (a square's corners are its half-diagonal out: its half-side is that over √2)
    if (p.square) r /= Math.SQRT2;
    r = Math.max(5, r);
    // the H runs along a square pad's first side; a round one's faces north
    const yaw = p.square ? Math.atan2(-(o[3] - o[1]), o[2] - o[0]) : 0;
    const y = topAt(colliders, cx, cz) + 0.06;
    if (p.square) parts.push(piece(new THREE.PlaneGeometry(r * 2, r * 2), PAD, cx, y, cz, yaw));
    else parts.push(piece(new THREE.CircleGeometry(r, 32), PAD, cx, y, cz, yaw));
    // the touchdown circle, and in it a red cross behind a white H (a hospital's pad)
    parts.push(piece(new THREE.RingGeometry(r * 0.72, r * 0.8, 40), PAINT, cx, y + 0.01, cz, yaw));
    const s = r * 0.5;
    parts.push(piece(new THREE.PlaneGeometry(s * 1.5, s * 0.5), CROSS, cx, y + 0.015, cz, yaw));
    parts.push(piece(new THREE.PlaneGeometry(s * 0.5, s * 1.5), CROSS, cx, y + 0.015, cz, yaw));
    const hx = s * 0.36, bar = s * 0.13, tall = s * 0.95;
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    for (const side of [-1, 1]) parts.push(piece(new THREE.PlaneGeometry(bar, tall), PAINT, cx + cs * side * hx, y + 0.02, cz - sn * side * hx, yaw));
    parts.push(piece(new THREE.PlaneGeometry(hx * 2, bar), PAINT, cx, y + 0.02, cz, yaw));
    spots.push({ name: p.name, x: cx, z: cz, y, r });
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  mesh.name = 'Helipads';
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = 900;
  group.name = 'Helipads';
  group.add(mesh);
  log(`[helipads] ${spots.map((s) => `${s.name} at ${Math.round(s.y - groundHeight(s.x, s.z))} m up`).join('; ')}`);
  return { spots };
}

export { buildHelipads, PADS };
