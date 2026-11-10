// Potholes: Ann Arbor's open pothole reports in the City's SeeClickFix 311 system (the ones a2potholes.com maps),
// fetched by Assets/Tools/build-potholes.py into data/potholes.json. Each report's point is usually at the curb or an
// address, so it's moved onto the street beside it, into the wheel path on that side; the longer it has been open, the
// bigger it is. Drawn as one instanced patch of broken asphalt whose normals lean in, so the light reads a dip; a car or
// bike that runs a wheel through one is jolted (`jolt`, called from controllers.js), with a thump in main.js.
import * as THREE from 'three/webgpu';
import { nearestRoads } from './city-config.js';
import { groundHeight, groundTilt } from './terrain.js';

const CELL = 20;
const lin = (hex) => new THREE.Color(hex);

// a unit pothole (1 m across): a ragged rim of cracked asphalt, a crumbly slope and a dark wet bottom
function potholeGeometry() {
  const R = [0, 0.28, 0.42, 0.5, 0.62], N = 18, pos = [], nor = [], col = [], idx = [];
  const rim = (k) => 1 + 0.18 * Math.sin(k * 2.3) + 0.12 * Math.sin(k * 5.1 + 1) + 0.07 * Math.sin(k * 9.7);
  const shade = [lin(0x0d0e10), lin(0x17181a), lin(0x242527), lin(0x2c2d2f), lin(0x34322f)];
  const lean = [0, 0.55, 0.7, 0.35, -0.12]; // how far each ring's normal leans in (the slope faces the middle)
  for (let r = 0; r < R.length; r++) for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, s = R[r] * (r ? rim(k) * (r === 4 ? 1.08 : 1) : 0);
    pos.push(Math.sin(a) * s, 0, Math.cos(a) * s);
    const n = new THREE.Vector3(-Math.sin(a) * lean[r], 1, -Math.cos(a) * lean[r]).normalize();
    nor.push(n.x, n.y, n.z);
    const c = shade[r];
    col.push(c.r, c.g, c.b);
  }
  for (let r = 0; r + 1 < R.length; r++) for (let k = 0; k < N; k++) {
    const a = r * N + k, b = r * N + ((k + 1) % N), c = a + N, d = b + N;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// the nearest street to (x, z) within 25 m: the point on its middle, its direction, and its width
function streetBeside(x, z) {
  const near = nearestRoads(x, z, 25)[0];
  if (!near) return null;
  const { pts, w } = near.road;
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], dx = pts[i + 1].x - a.x, dz = pts[i + 1].z - a.z, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + t * dx, pz = a.z + t * dz, d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { x: px, z: pz, ux: dx / L, uz: dz / L, d }; }
  }
  return best && { ...best, w: w || 8 };
}

function buildPotholes(group, data) {
  group.name = 'Potholes';
  const raw = data?.potholes || [];
  const holes = [];
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const x = raw[i], z = raw[i + 1], days = raw[i + 2];
    const s = streetBeside(x, z);
    if (!s) continue;
    // in the wheel path on the side of the street the report was made from
    const side = Math.sign((x - s.x) * s.uz - (z - s.z) * s.ux) || 1;
    const off = side * Math.max(0.6, s.w / 4 - 0.4 + ((i * 7919) % 9) * 0.05);
    const hx = s.x + s.uz * off, hz = s.z - s.ux * off;
    const r = Math.min(0.75, 0.34 + Math.sqrt(days) * 0.045 + ((i * 104729) % 7) * 0.02);
    holes.push({ x: hx, z: hz, r, yaw: (i * 2.399) % (Math.PI * 2), hitAt: -1 });
  }

  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -3;
  mat.polygonOffsetUnits = -3;
  const mesh = new THREE.InstancedMesh(potholeGeometry(), mat, Math.max(1, holes.length));
  mesh.name = 'PotholePatches';
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  holes.forEach((h, i) => {
    const [pitch, roll] = groundTilt(h.x, h.z, h.yaw, h.r * 2, h.r * 2);
    e.set(-pitch, h.yaw, -roll, 'YXZ');
    q.setFromEuler(e);
    p.set(h.x, groundHeight(h.x, h.z) + 0.012, h.z);
    sc.set(h.r * 2, 1, h.r * 2 * 0.8);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
  });
  mesh.count = holes.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);

  const cells = new Map();
  // each hole filed in every cell its edge reaches, so a wheel just across a cell line still finds it
  for (const h of holes) {
    for (let cx = Math.floor((h.x - h.r) / CELL); cx <= Math.floor((h.x + h.r) / CELL); cx++) {
      for (let cz = Math.floor((h.z - h.r) / CELL); cz <= Math.floor((h.z + h.r) / CELL); cz++) {
        const k = cx * 100000 + cz;
        (cells.get(k) || cells.set(k, []).get(k)).push(h);
      }
    }
  }
  const at = (x, z, now) => {
    const list = cells.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (!list) return null;
    for (const h of list) {
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz < h.r * h.r * 0.7 && now - h.hitAt > 0.6) return h;
    }
    return null;
  };

  return {
    count: holes.length,
    // a car's or bike's wheel run into a pothole this step: { x, z, side (-1 left, 1 right), front, depth 0..1 } or null
    jolt(c, now, bike = false) {
      const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
      const wheels = bike ? [[0, 0.55], [0, -0.55]] : [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]];
      for (const [sx, fz] of wheels) {
        const x = c.position.x + sin * fz - cos * sx, z = c.position.z + cos * fz + sin * sx;
        const h = at(x, z, now);
        if (!h) continue;
        h.hitAt = now;
        return { x: h.x, z: h.z, side: Math.sign(sx), front: fz > 0, depth: Math.min(1, h.r / 0.6) };
      }
      return null;
    }
  };
}

export { buildPotholes };
