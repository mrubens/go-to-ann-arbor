// Speed humps and speed tables: the ones the City of Ann Arbor's Traffic Calming program built on its streets
// (Assets/Tools/build-humps-carts-champions.py writes data/speed-humps.json), each laid across the street it's on, curb
// to curb. A hump is a 4.3 m swell 8 cm high, a table a 7 m flat top on two ramps; both are marked as Ann Arbor's are, with a
// wide white chevron per lane on each slope pointing up it. A car or bike over one is jolted, nose then tail (controllers.js calls `cross`), and one
// that hits it fast enough leaves the ground.
import * as THREE from 'three/webgpu';
import { nearestRoads } from './city-config.js';
import { groundHeight, groundTilt } from './terrain.js';

const CELL = 30;
const HEIGHT = 0.08;
// along the street (m): a hump's whole length; a table's ramps and its flat top
const HUMP = 4.3, RAMP = 1.9, TOP = 3.2;

// the height of the profile at d metres from the middle (0 off it)
const humpAt = (d) => (Math.abs(d) >= HUMP / 2 ? 0 : HEIGHT * Math.cos((d / HUMP) * Math.PI) ** 2);
const tableAt = (d) => {
  const a = Math.abs(d);
  if (a <= TOP / 2) return HEIGHT;
  if (a >= TOP / 2 + RAMP) return 0;
  const t = (a - TOP / 2) / RAMP;
  return HEIGHT * (1 - t * t * (3 - 2 * t));
};

// One unit-wide (x, across the street) strip of the profile along z, in the street's asphalt, with a row of white teeth
// up each slope 6 mm above it
function profileGeometry(profileAt, half, oneWay = false) {
  const ROWS = 14, COLS = 2, pos = [], col = [], idx = [];
  const asphalt = new THREE.Color(0x3b3c3f), paint = new THREE.Color(0xe9e9e2);
  for (let r = 0; r <= ROWS; r++) {
    const z = -half + (2 * half * r) / ROWS;
    for (let c = 0; c <= COLS; c++) {
      pos.push(-0.5 + c / COLS, profileAt(z), z);
      col.push(asphalt.r, asphalt.g, asphalt.b);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const a = r * (COLS + 1) + c, b = a + 1, d = a + COLS + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  // the markings, as Ann Arbor paints them: in each lane a wide white chevron on each slope, both pointing the way the
  // lane drives (">>"), the arms not quite meeting at the point
  const lift = 0.006, THICK = 0.4, SEG = 6;
  const tri = (a, b, c) => {
    // upward-facing whatever order the corners came in
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
    const v = pos.length / 3;
    for (const p of uz * vx - ux * vz > 0 ? [a, b, c] : [a, c, b]) { pos.push(...p); col.push(paint.r, paint.g, paint.b); }
    idx.push(v, v + 1, v + 2);
  };
  const at = (x, z) => [x, profileAt(z) + lift, z];
  const zTip = profileAt === humpAt ? 0.45 : TOP / 2 + 0.15, zFoot = half - 0.35;
  for (const d of oneWay ? [1] : [1, -1]) for (const s of [-1, 1]) {
    // traffic heading d along z: its lane (the right-hand one, or the middle of a one-way), one chevron on each slope,
    // both pointing the way it drives, so together they read ">>" across the hump
    const cx = oneWay ? 0 : -0.25 * d;
    const flip = s === d; // the slope it drives down: the point down it
    const zT = flip ? zFoot - THICK : zTip, zE = flip ? zTip + THICK : zFoot - THICK, grow = flip ? -1 : 1;
    for (const side of [-1, 1]) {
      // one arm: from beside the point out and back, THICK wide along the street
      const x0 = cx + side * 0.025, x1 = cx + side * 0.2;
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        const xa = x0 + (x1 - x0) * t0, xb = x0 + (x1 - x0) * t1;
        const za = s * (zT + (zE - zT) * t0), zb = s * (zT + (zE - zT) * t1);
        const p0 = at(xa, za), p1 = at(xb, zb), p2 = at(xb, zb + s * grow * THICK), p3 = at(xa, za + s * grow * THICK);
        tri(p0, p1, p2); tri(p0, p2, p3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// the nearest street to (x, z) within 20 m: the point on its middle, its direction and width
function streetAt(x, z) {
  const near = nearestRoads(x, z, 20)[0];
  if (!near || near.road.highway) return null;
  const { pts, w, dir } = near.road;
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], dx = pts[i + 1].x - a.x, dz = pts[i + 1].z - a.z, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + t * dx, pz = a.z + t * dz, d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { x: px, z: pz, ux: dx / L, uz: dz / L, d }; }
  }
  if (!best) return null;
  // a one-way street: its direction turned the way traffic goes
  if (dir < 0) { best.ux = -best.ux; best.uz = -best.uz; }
  return { ...best, oneWay: !!dir, w: Math.max(6, Math.min(12, w || 8)) };
}

function buildSpeedHumps(group, data) {
  group.name = 'SpeedHumps';
  const raw = data?.humps || [];
  // by kind (0 hump, 1 table) and street: 0 two-way, 1 one-way
  const list = [[], [], [], []];
  for (let i = 0; i + 4 < raw.length; i += 5) {
    const s = streetAt(raw[i], raw[i + 1]);
    if (!s) continue;
    const kind = raw[i + 4];
    list[kind + (s.oneWay ? 2 : 0)].push({ x: s.x, z: s.z, ux: s.ux, uz: s.uz, w: s.w, kind, half: kind ? TOP / 2 + RAMP : HUMP / 2 });
  }
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  list.forEach((humps, n) => {
    if (!humps.length) return;
    const kind = n % 2, oneWay = n >= 2;
    const half = kind ? TOP / 2 + RAMP : HUMP / 2;
    const mesh = new THREE.InstancedMesh(profileGeometry(kind ? tableAt : humpAt, half, oneWay), mat, humps.length);
    mesh.name = kind ? 'SpeedTables' : 'SpeedHumps';
    mesh.receiveShadow = true;
    humps.forEach((h, i) => {
      const yaw = Math.atan2(h.ux, h.uz);
      const [pitch, roll] = groundTilt(h.x, h.z, yaw, half * 2, h.w);
      e.set(-pitch, yaw, -roll, 'YXZ');
      q.setFromEuler(e);
      p.set(h.x, groundHeight(h.x, h.z) + 0.005, h.z);
      sc.set(h.w, 1, 1);
      mesh.setMatrixAt(i, m.compose(p, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  const all = list.flat();
  const cells = new Map();
  for (const h of all) {
    const k = Math.floor(h.x / CELL) * 100000 + Math.floor(h.z / CELL);
    (cells.get(k) || cells.set(k, []).get(k)).push(h);
  }
  // the hump an axle went over between (x0, z0) and (x1, z1), or null
  const over = (x0, z0, x1, z1) => {
    const list = cells.get(Math.floor(x1 / CELL) * 100000 + Math.floor(z1 / CELL));
    if (!list) return null;
    for (const h of list) {
      const a = (x0 - h.x) * h.ux + (z0 - h.z) * h.uz, b = (x1 - h.x) * h.ux + (z1 - h.z) * h.uz;
      if (Math.sign(a) === Math.sign(b) || Math.abs(a - b) > 6) continue;
      if (Math.abs((x1 - h.x) * h.uz - (z1 - h.z) * h.ux) < h.w / 2 + 0.3) return h;
    }
    return null;
  };

  return {
    count: all.length,
    // an axle of the car (or bike) that went over a hump this step, from (px, pz) to where it is now:
    // { x, z, front, table } or null
    cross(c, px, pz, bike = false) {
      const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
      for (const f of bike ? [0.55, -0.55] : [1.35, -1.35]) {
        const h = over(px + sin * f, pz + cos * f, c.position.x + sin * f, c.position.z + cos * f);
        if (h) return { x: h.x, z: h.z, front: f > 0, table: h.kind === 1 };
      }
      return null;
    }
  };
}

export { buildSpeedHumps };
