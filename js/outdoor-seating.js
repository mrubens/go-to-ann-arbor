import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { blockAt, TOWN_BOUNDS } from './city-config.js';

// Lamp: outdoor seating (data/outdoor-seating.json, Assets/Tools/build-outdoor-seating.py, from OpenStreetMap): the
// patios mapped as their own areas, set with tables in rows along their long side, and a row of tables on the sidewalk
// out front of each cafe, restaurant and bar that says it has seats outside, along its storefront (where its sign is).
// A cafe's are little round bistro tables with two chairs and an umbrella over some; a restaurant's square tables for
// four, most under an umbrella, behind a low black railing; a bar's long picnic tables; and a patio that isn't a food or
// drink place's (apartments, offices, campus) a few plain picnic tables.
//
// Every kind is one instanced mesh (the umbrellas' canopies in their own colors), chunked and dropped past a couple of
// hundred metres by the scene culling. A car knocks them about (`obstacles`, knockdowns.js): chairs and tables fly, an
// umbrella's table tips over with it. `seats` lists where someone sits: each chair and each side of a picnic bench.

const CANOPIES = [0x1f3a5f, 0x7a1f24, 0xe8e2d4, 0x2f5136, 0x2a2a2a, 0xc9b48a];
const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

const flat = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (parts) => mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return flat(g); }));
const rod = (r, x0, y0, z0, x1, y1, z1, seg = 8) => {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
};

// a bistro chair, facing +z: a bent-tube frame, a seat of slats, a curved back
function chairGeometry() {
  const p = [], r = 0.011, s = 0.21, seat = 0.46;
  for (const x of [-s, s]) {
    p.push(rod(r, x, 0, s, x * 0.95, seat, s * 0.9));
    p.push(rod(r, x, 0, -s, x * 0.95, seat, -s * 0.9));
    p.push(rod(r, x * 0.95, seat, -s * 0.9, x * 0.92, 0.86, -s * 1.12));
  }
  p.push(rod(r, -s * 0.92, 0.86, -s * 1.12, s * 0.92, 0.86, -s * 1.12, 6));
  p.push(rod(r * 0.8, -s, 0.16, s, s, 0.16, s, 6), rod(r * 0.8, -s, 0.16, -s, s, 0.16, -s, 6));
  for (let k = 0; k < 5; k++) {
    const z = -s * 0.85 + (k / 4) * s * 1.75;
    p.push(new THREE.BoxGeometry(s * 2.05, 0.016, 0.062).translate(0, seat + 0.008, z));
  }
  for (let k = 0; k < 3; k++) {
    const y = 0.62 + k * 0.09;
    const slat = new THREE.CylinderGeometry(0.27, 0.27, 0.05, 14, 1, true, Math.PI - 0.82, 1.64);
    slat.scale(1, 1, 0.55).translate(0, y, -s * 0.95 + 0.27 * 0.55 * 0.8 - 0.04 - (k * 0.012));
    p.push(slat);
  }
  return merge(p);
}

// a bistro table: a round top on a pedestal over a cast foot
function bistroGeometry() {
  return merge([
    new THREE.CylinderGeometry(0.34, 0.34, 0.025, 28).translate(0, 0.735, 0),
    new THREE.TorusGeometry(0.335, 0.012, 6, 28).rotateX(Math.PI / 2).translate(0, 0.725, 0),
    new THREE.CylinderGeometry(0.028, 0.032, 0.7, 10).translate(0, 0.37, 0),
    new THREE.CylinderGeometry(0.06, 0.24, 0.05, 18).translate(0, 0.025, 0),
    new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10).translate(0, 0.705, 0)
  ]);
}

// a square table for four, on four legs, with the umbrella's hole in the middle
function squareGeometry() {
  const p = [new THREE.BoxGeometry(0.86, 0.03, 0.86).translate(0, 0.74, 0), new THREE.BoxGeometry(0.8, 0.06, 0.8).translate(0, 0.7, 0)];
  for (const x of [-0.37, 0.37]) for (const z of [-0.37, 0.37]) p.push(new THREE.BoxGeometry(0.04, 0.7, 0.04).translate(x, 0.35, z));
  return merge(p);
}

// a picnic table along local x: a plank top and two benches on two A-frames
function picnicGeometry() {
  const p = [], L = 1.85;
  for (let k = 0; k < 4; k++) p.push(new THREE.BoxGeometry(L, 0.04, 0.17).translate(0, 0.76, -0.27 + k * 0.18));
  for (const side of [-1, 1]) for (let k = 0; k < 2; k++) p.push(new THREE.BoxGeometry(L, 0.04, 0.13).translate(0, 0.45, side * (0.56 + k * 0.14 - 0.07)));
  for (const x of [-0.62, 0.62]) {
    for (const side of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.09, 0.95, 0.04);
      leg.rotateX(side * 0.66).translate(x, 0.39, side * 0.3);
      p.push(leg);
    }
    p.push(new THREE.BoxGeometry(0.09, 0.05, 1.5).translate(x, 0.405, 0));
    p.push(new THREE.BoxGeometry(0.09, 0.05, 0.7).translate(x, 0.71, 0));
  }
  return merge(p);
}

// an umbrella over a table: the pole and its eight ribs (one mesh, dark), and its canopy (another, in its color)
function poleGeometry() {
  const p = [new THREE.CylinderGeometry(0.019, 0.019, 2.35, 8).translate(0, 1.175, 0), new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8).translate(0, 2.3, 0)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    p.push(rod(0.008, 0, 2.34, 0, Math.cos(a) * 1.18, 2.08, Math.sin(a) * 1.18, 4));
    p.push(rod(0.006, 0, 1.95, 0, Math.cos(a) * 0.62, 2.21, Math.sin(a) * 0.62, 4));
  }
  return merge(p);
}
function canopyGeometry() {
  // eight panels, each sagging a little between its ribs, with a short valance
  const pos = [], R = 1.2, top = 2.37, rim = 2.07, n = 8, sub = 4;
  const pt = (a, t) => {
    const k = (a / (Math.PI * 2 / n)) % 1, sag = Math.sin(k * Math.PI) * 0.035 * t;
    return [Math.cos(a) * R * t, top + (rim - top) * t - sag, Math.sin(a) * R * t];
  };
  for (let i = 0; i < n * sub; i++) {
    const a0 = (i / (n * sub)) * Math.PI * 2, a1 = ((i + 1) / (n * sub)) * Math.PI * 2;
    for (let j = 0; j < 3; j++) {
      const t0 = j / 3, t1 = (j + 1) / 3;
      const A = pt(a0, t0), B = pt(a1, t0), C = pt(a1, t1), D = pt(a0, t1);
      pos.push(...A, ...C, ...B, ...A, ...D, ...C);
    }
    const C = pt(a1, 1), D = pt(a0, 1);
    pos.push(...D, C[0], C[1] - 0.16, C[2], ...C, ...D, D[0], D[1] - 0.16, D[2], C[0], C[1] - 0.16, C[2]);
  }
  pos.push(0, top + 0.06, 0, 0.04, top, 0, -0.04, top, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// a low railing panel, 2 m long along local x: two rails on posts
function railGeometry() {
  return merge([
    new THREE.BoxGeometry(2, 0.04, 0.04).translate(0, 0.9, 0),
    new THREE.BoxGeometry(2, 0.03, 0.03).translate(0, 0.3, 0),
    new THREE.BoxGeometry(0.05, 0.92, 0.05).translate(-0.97, 0.46, 0),
    new THREE.BoxGeometry(0.22, 0.02, 0.22).translate(-0.97, 0.01, 0)
  ]);
}

const insidePoly = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const edgeDist = (pts, x, z) => {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j], [bx, bz] = pts[i], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const u = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(x - ax - ex * u, z - az - ez * u));
  }
  return d;
};

function createOutdoorSeating(group, data) {
  group.name = 'OutdoorSeating';
  // the ground a table stands on: the sidewalk's top on a curbed block, else the ground (as the player walks it)
  const floorAt = (x, z) => {
    const b = blockAt(x, z);
    return groundHeight(x, z) + (b && !(b.park > 0.6 && !b.median) ? TOWN_BOUNDS.sidewalkHeight : 0);
  };
  const sets = []; // { x, z, yaw, style, umbrella, chairs: [[dx, dz, yaw]] }
  const rails = [];
  const place = (x, z, yaw, style, k) => {
    const r = hash(x * 0.37 + k, z * 0.53);
    const umbrella = style === 1 ? r < 0.8 : style === 0 ? r < 0.35 : false;
    const chairs = [];
    if (style === 0) {
      const a = yaw + (r - 0.5) * 0.6;
      for (const s of [-1, 1]) chairs.push([Math.cos(a) * 0.6 * s, -Math.sin(a) * 0.6 * s, a + (s > 0 ? -Math.PI / 2 : Math.PI / 2) + (hash(k, s) - 0.5) * 0.5]);
    } else if (style === 1) {
      for (let q = 0; q < 4; q++) {
        if (hash(k * 1.7, q) < 0.12) continue; // one pulled away now and then
        const a = yaw + (q * Math.PI) / 2, out = 0.62 + hash(k, q * 3.1) * 0.1;
        chairs.push([Math.sin(a) * out, Math.cos(a) * out, a + Math.PI + (hash(q, k) - 0.5) * 0.3]);
      }
    }
    sets.push({ x, z, yaw, style, umbrella, chairs, canopy: CANOPIES[Math.floor(hash(Math.round(x / 40), Math.round(z / 40)) * CANOPIES.length)] });
  };

  // the storefront rows: a step out from the wall, along it
  const fronts = data?.fronts || [];
  for (let i = 0; i + 4 < fronts.length; i += 5) {
    const [wx, wz, h, width, style] = fronts.slice(i, i + 5);
    const nx = Math.sin(h), nz = Math.cos(h), tx = nz, tz = -nx;
    const gap = style === 0 ? 1.7 : style === 1 ? 2.2 : 2.6, out = style === 2 ? 1.5 : 1.25;
    const n = Math.max(1, Math.floor(width / gap));
    for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * gap, x = wx + nx * out + tx * u, z = wz + nz * out + tz * u;
      if (!blockAt(x, z)) continue; // off the sidewalk: in the street
      place(x, z, style === 2 ? h + Math.PI / 2 : h, style, i + k);
    }
    // a restaurant's railing round its tables, along the sidewalk side
    if (style === 1) {
      const rn = Math.max(1, Math.ceil((n * gap) / 2));
      for (let k = 0; k < rn; k++) {
        const u = (k - (rn - 1) / 2) * 2, x = wx + nx * (out + 1.05) + tx * u, z = wz + nz * (out + 1.05) + tz * u;
        if (blockAt(x, z)) rails.push({ x, z, yaw: h + Math.PI / 2 });
      }
    }
  }

  // the patios: tables in rows along the long way, kept clear of the edges
  for (const rec of data?.patios || []) {
    const style = rec[0], pts = [];
    for (let i = 1; i + 1 < rec.length; i += 2) pts.push([rec[i], rec[i + 1]]);
    if (pts.length < 3) continue;
    let best = 0, ang = 0, cx = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      cx += ax / pts.length; cz += az / pts.length;
      const L = Math.hypot(bx - ax, bz - az);
      if (L > best) { best = L; ang = Math.atan2(bx - ax, bz - az); }
    }
    const ux = Math.sin(ang), uz = Math.cos(ang), vx = uz, vz = -ux;
    const gu = style === 3 || style === 2 ? 3.4 : style === 1 ? 2.4 : 2.0, gv = style === 3 || style === 2 ? 2.8 : gu;
    let r = 0, minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of pts) {
      const u = (x - cx) * ux + (z - cz) * uz, v = (x - cx) * vx + (z - cz) * vz;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    let count = 0;
    const cap = style === 3 ? 8 : 30;
    for (let u = minU + gu / 2; u < maxU && count < cap; u += gu) {
      for (let v = minV + gv / 2; v < maxV && count < cap; v += gv) {
        const x = cx + ux * u + vx * v, z = cz + uz * u + vz * v;
        if (!insidePoly(pts, x, z) || edgeDist(pts, x, z) < (style >= 2 ? 1.2 : 0.8)) continue;
        place(x, z, style >= 2 ? ang + Math.PI / 2 : ang, style, ++r);
        count++;
      }
    }
  }

  const count = (f) => sets.reduce((n, s) => n + f(s), 0);
  const nChairs = count((s) => s.chairs.length), nBistro = count((s) => (s.style === 0 ? 1 : 0)),
    nSquare = count((s) => (s.style === 1 ? 1 : 0)), nPicnic = count((s) => (s.style >= 2 ? 1 : 0)), nUmb = count((s) => (s.umbrella ? 1 : 0));
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x1d1f21, metalness: 0.55, roughness: 0.42 });
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x8a6a4a, roughness: 0.8 });
  const canopyMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  const mk = (geo, mat, n, cull) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = 0;
    m.castShadow = m.receiveShadow = true;
    m.userData.cullDistance = cull;
    group.add(m);
    return m;
  };
  const chairs = mk(chairGeometry(), metal, nChairs, 160);
  const bistros = mk(bistroGeometry(), metal, nBistro, 200);
  const squares = mk(squareGeometry(), metal, nSquare, 200);
  const picnics = mk(picnicGeometry(), wood, nPicnic, 240);
  const poles = mk(poleGeometry(), metal, nUmb, 220);
  const canopies = mk(canopyGeometry(), canopyMat, nUmb, 320);
  const railing = mk(railGeometry(), metal, rails.length, 180);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const put = (mesh, x, y, z, yaw) => {
    q.setFromAxisAngle(up, yaw);
    m4.compose(pos.set(x, y, z), q, one);
    const i = mesh.count++;
    mesh.setMatrixAt(i, m4);
    return i;
  };
  const obstacles = [], seats = [];
  for (const s of sets) {
    const g = floorAt(s.x, s.z);
    const mesh = s.style === 0 ? bistros : s.style === 1 ? squares : picnics;
    const ti = put(mesh, s.x, g, s.z, s.yaw);
    const parts = [mesh, ti];
    if (s.umbrella) {
      // tilted a hair, each its own way, as they never quite stand straight
      parts.push(poles, put(poles, s.x, g, s.z, s.yaw));
      const ci = put(canopies, s.x, g, s.z, hash(s.x, s.z) * 6.28);
      canopies.setColorAt(ci, col.setHex(s.canopy));
      parts.push(canopies, ci);
    }
    const kind = s.style >= 2 ? 'picnic' : s.umbrella ? 'parasol' : 'table';
    obstacles.push({ x: s.x, z: s.z, r: s.style >= 2 ? 0.9 : s.style === 1 ? 0.48 : 0.36, kind, height: s.umbrella ? 2.4 : 0.76, parts });
    if (s.style >= 2) {
      // both benches, three places along each
      for (const side of [-1, 1]) for (const a of [-0.6, 0, 0.6]) {
        const ox = Math.cos(s.yaw) * a + Math.sin(s.yaw) * side * 0.63, oz = -Math.sin(s.yaw) * a + Math.cos(s.yaw) * side * 0.63;
        seats.push({ x: s.x + ox, z: s.z + oz, y: g + 0.47, yaw: s.yaw + (side > 0 ? Math.PI : 0), kind: 'bench', of: obstacles.length - 1 });
      }
    }
    for (const [dx, dz, yaw] of s.chairs) {
      const x = s.x + dx, z = s.z + dz, cg = floorAt(x, z);
      const ci = put(chairs, x, cg, z, yaw);
      obstacles.push({ x, z, r: 0.26, kind: 'chair', height: 0.86, parts: [chairs, ci] });
      seats.push({ x, z, y: cg + 0.47, yaw, kind: 'chair', of: obstacles.length - 1 });
    }
  }
  for (const r of rails) put(railing, r.x, floorAt(r.x, r.z), r.z, r.yaw);
  for (const m of [chairs, bistros, squares, picnics, poles, canopies, railing]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    if (!m.count) m.visible = false;
  }

  log(`[outdoor seating] ${sets.length} tables (${nBistro} cafe, ${nSquare} restaurant, ${nPicnic} picnic), ${nChairs} chairs, ${nUmb} umbrellas, ${rails.length} railing panels`);
  return { obstacles, seats, count: sets.length };
}

async function buildOutdoorSeating(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/outdoor-seating.json')));
  } catch (error) { log(`[outdoor seating] no seating data: ${error}`); }
  return createOutdoorSeating(group, data);
}

export { buildOutdoorSeating };
