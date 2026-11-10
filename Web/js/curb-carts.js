// Trash, recycling and compost carts out at the curb on pickup day. The City of Ann Arbor picks up each house's trash
// and recycling on the same weekday, by zone (its Collection Routes, written into data/collection-days.json by
// Assets/Tools/build-humps-carts-champions.py); compost goes out the same day from April to mid-December. So on a
// weekday, every house and duplex in that day's zone (its address points, on single- and two-family land) has a dark blue
// trash cart and a royal blue recycling cart in the street at its curb, and about a third a brown compost cart too. A car
// sends them flying (knockdowns.js: main.js makes each one's collider from `obstacles`).
import * as THREE from 'three/webgpu';
import { nearestRoads } from './city-config.js';
import { landUseAt, LAND_USE } from './districts.js';
import { groundHeight } from './terrain.js';
import { curbParking } from './parked-cars.js';

// Ann Arbor's carts: dark blue for trash, royal blue for recycling, brown for compost
const COLORS = { trash: 0x18233f, recycling: 0x2456c8, compost: 0x5e3f24 };

// Which weekday it is in Ann Arbor (1 Monday ... 7 Sunday), and whether compost is being picked up
function today() {
  const now = Date.now();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'numeric', day: 'numeric' })
    .formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  const month = +get('month'), date = +get('day');
  const compost = month >= 4 && (month < 12 || date <= 15);
  return { day, compost, name: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day] };
}

function inRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// the street in front of (x, z), within 40 m: the nearest point on its middle, its direction and width
function streetBeside(x, z) {
  const near = nearestRoads(x, z, 40)[0];
  if (!near || near.road.highway) return null;
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

// A 96-gallon cart, its foot at the origin, its front (+z) to the street: a tapered tub, a lid, a handle across the
// back and two wheels under it. White where the instance's color shows, dark on the wheels.
function cartGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, shade = 1, taper = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (taper) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { p.setX(i, p.getX(i) * (1 - taper)); p.setZ(i, p.getZ(i) * (1 - taper)); }
    }
    g.translate(x, y, z);
    parts.push([g, shade]);
  };
  box(0.64, 0.98, 0.8, 0, 0.06 + 0.49, 0, 1, 0.12); // the tub
  box(0.68, 0.05, 0.86, 0, 1.065, 0.01, 0.85); // the lid
  box(0.6, 0.045, 0.045, 0, 1.0, -0.45, 0.8); // the handle
  for (const x of [-0.3, 0.3]) {
    const g = new THREE.CylinderGeometry(0.14, 0.14, 0.07, 8);
    g.rotateZ(Math.PI / 2);
    g.translate(x, 0.14, -0.33);
    parts.push([g, 0.12]);
  }
  const pos = [], nor = [], col = [], idx = [];
  for (const [g0, shade] of parts) {
    const g = g0;
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(shade, shade, shade);
    }
    for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// a steady number in 0..1 for a place, so the same house always puts out the same carts
const hash = (x, z, k) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

function buildCurbCarts(group, data, addresses) {
  group.name = 'CurbCarts';
  const { day, compost, name } = today();
  const rings = data?.zones?.[day] || [];
  const carts = [];
  if (rings.length && addresses?.length) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
    }
    const taken = new Map(); // 6 m squares of curb already holding a house's carts
    const free = (x, z) => {
      const k = Math.floor(x / 6) * 100000 + Math.floor(z / 6);
      if (taken.has(k)) return false;
      taken.set(k, true);
      return true;
    };
    // kept out of the stalls a parked car stands in and out of the driveways' mouths (parked-cars.js)
    const { spots, nearCut } = curbParking();
    const stallCells = new Map();
    for (const st of spots) {
      const k = Math.floor(st.x / 20) * 100000 + Math.floor(st.z / 20);
      if (!stallCells.has(k)) stallCells.set(k, []);
      stallCells.get(k).push(st);
    }
    const inStall = (x, z) => {
      const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const st of stallCells.get((gx + i) * 100000 + gz + j) || []) if (Math.hypot(st.x - x, st.z - z) < 3.6) return true;
      }
      return false;
    };
    const clear = (x, z) => !inStall(x, z) && !nearCut(x, z, 3.2);
    for (let i = 0; i + 2 < addresses.length; i += 3) {
      const x = addresses[i], z = addresses[i + 1];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const use = landUseAt(x, z);
      if (use !== LAND_USE.SINGLE_FAMILY && use !== LAND_USE.TWO_FAMILY) continue;
      let inside = false;
      for (const r of rings) if (inRing(r, x, z)) inside = !inside;
      if (!inside) continue;
      const s = streetBeside(x, z);
      if (!s || s.d < 4) continue;
      // in the street at the curb on the house's side, just up the street from in front of it (clear of the drive)
      const side = Math.sign((x - s.x) * s.uz - (z - s.z) * s.ux) || 1;
      const nx = s.uz * side, nz = -s.ux * side; // from the street's middle toward the house
      const off = s.w / 2 - 0.45;
      const kinds = ['trash', 'recycling'];
      if (compost && hash(x, z, 2) < 0.35) kinds.push('compost');
      // (and down the street from it, the drive's other side, where up the street is a parked car or the drive)
      const reach = (kinds.length - 1) * 0.4;
      const along = 2.2 + hash(x, z, 1) * 1.2;
      let cx = 0, cz = 0, ok = false;
      for (const a of [along, -along, along + 2.5, -along - 2.5]) {
        cx = s.x + nx * off + s.ux * a; cz = s.z + nz * off + s.uz * a;
        if (clear(cx - s.ux * reach, cz - s.uz * reach) && clear(cx + s.ux * reach, cz + s.uz * reach)) { ok = true; break; }
      }
      if (!ok || !free(cx, cz)) continue;
      // facing the street, side by side along the curb, each a little askew
      const yaw = Math.atan2(-nx, -nz);
      kinds.forEach((kind, k) => {
        const a = (k - (kinds.length - 1) / 2) * 0.8;
        carts.push({ kind, x: cx + s.ux * a, z: cz + s.uz * a, yaw: yaw + (hash(x, z, 3 + k) - 0.5) * 0.35 });
      });
    }
  }

  const obstacles = [];
  if (carts.length) {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const mesh = new THREE.InstancedMesh(cartGeometry(), mat, carts.length);
    mesh.name = 'CurbCarts';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
    carts.forEach((c, i) => {
      p.set(c.x, groundHeight(c.x, c.z), c.z);
      q.setFromAxisAngle(up, c.yaw);
      mesh.setMatrixAt(i, m.compose(p, q, one));
      mesh.setColorAt(i, color.setHex(COLORS[c.kind]));
      obstacles.push({ x: c.x, z: c.z, r: 0.36, kind: 'cart', height: 1.1, parts: [mesh, i] });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return { count: carts.length, day: rings.length ? name : null, obstacles };
}

// The weekday name whose carts would be out now (as buildCurbCarts's `day`), or null when no zone's are: main.js
// compares it with the carts built, when Ann Arbor's date turns over while it's played
function cartDay(data) {
  const { day, name } = today();
  return (data?.zones?.[day] || []).length ? name : null;
}

export { buildCurbCarts, cartDay };
