import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawOver } from './terrain.js';
import { createParkLawnMaterial } from './tsl-materials.js';
import { GOLF_HOLES } from './golf-holes.js';

// Ann Arbor's golf courses (GEO.golf from build-annarbor.py: OpenStreetMap's fairways, greens, tees and cart paths,
// with fairways and bunkers filled in where a course isn't mapped): fairways mown in light and dark stripes along their
// length, close-cut greens with a pin and flag on each, tees, sand bunkers and asphalt cart paths, all lying on the
// lawn of the course.

// Each fairway's long axis, for its mowing stripes
function mowAngle(ring) {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p.x; cz += p.z; }
  cx /= ring.length; cz /= ring.length;
  let xx = 0, zz = 0, xz = 0;
  for (const p of ring) { const dx = p.x - cx, dz = p.z - cz; xx += dx * dx; zz += dz * dz; xz += dx * dz; }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

// A ring's corners rounded off (Chaikin, `n` times): the fairways filled in where a course isn't mapped are its open
// grass less the tree crowns, which leaves them saw-toothed; rounded, they read as mown shapes
function smooth(ring, n = 3) {
  let r = ring;
  for (let k = 0; k < n && r.length >= 3; k++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      out.push({ x: p.x * 0.75 + q.x * 0.25, z: p.z * 0.75 + q.z * 0.25 }, { x: p.x * 0.25 + q.x * 0.75, z: p.z * 0.25 + q.z * 0.75 });
    }
    r = out;
  }
  return r;
}

function tagged(geo, angle) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n).fill(angle);
  geo.setAttribute('mow', new THREE.BufferAttribute(arr, 1));
  return geo;
}

// A strip `w` wide along a line of flat x, z pairs, at height y: mitred at each bend (capped where it turns sharply)
// and cut every couple of metres along its length, so it follows the ground it's laid on
function ribbon(flat, w, y) {
  const h = w / 2;
  const P = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i], z = flat[i + 1];
    if (P.length && Math.hypot(x - P[P.length - 1][0], z - P[P.length - 1][1]) < 0.05) continue;
    P.push([x, z]);
  }
  const pos = [];
  if (P.length < 2) return emptyGeo();
  // each point's offset to the left: the average of its two segments' normals, lengthened to keep the width
  const L = [];
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return [dx / l, dz / l]; };
  for (let i = 0; i < P.length; i++) {
    const d0 = dir(P[Math.max(0, i - 1)], P[Math.max(1, i)]);
    const d1 = dir(P[Math.min(P.length - 2, i)], P[Math.min(P.length - 1, i + 1)]);
    let nx = -(d0[1] + d1[1]), nz = d0[0] + d1[0];
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const cos = Math.max(0.5, nx * -d1[1] + nz * d1[0]);
    L.push([nx * h / cos, nz * h / cos]);
  }
  for (let i = 0; i + 1 < P.length; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
      const lx0 = L[i][0] + (L[i + 1][0] - L[i][0]) * t0, lz0 = L[i][1] + (L[i + 1][1] - L[i][1]) * t0;
      const lx1 = L[i][0] + (L[i + 1][0] - L[i][0]) * t1, lz1 = L[i][1] + (L[i + 1][1] - L[i][1]) * t1;
      const A = [ax + lx0, y, az + lz0], B = [ax - lx0, y, az - lz0], C = [bx - lx1, y, bz - lz1], D = [bx + lx1, y, bz + lz1];
      pos.push(...A, ...C, ...B, ...A, ...D, ...C);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return geo;
}

function emptyGeo() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  return geo;
}

// A ground overlay's material, drawn in front of the lawn it lies on wherever the two meet
function overlay(color) {
  const mat = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.95 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  return mat;
}

function addMerged(group, geos, mat, name) {
  if (!geos.length) return;
  for (const g of geos) { g.deleteAttribute('uv'); }
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
  m.name = name;
  m.receiveShadow = true;
  group.add(m);
}

// Lamp: Huron Hills' holes, which the city's course data leaves out (it has only the outline, so its fairways were the
// open grass build-annarbor.py fills in): OpenStreetMap's line for each of the 18 (golf-holes.js), from its tee to its
// green, laid out here as a tee box, a mown fairway strip along the line (on all but the short par 3s), a green at
// its end with its pin and a bunker or two. The course's open grass within reach of them becomes rough (park lawn).
// Flat [x, z, ...] rings, as GEO.golf's.
const hash01 = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const ellipse = (cx, cz, rx, rz, a, n = 18) => {
  const out = [], c = Math.cos(a), s = Math.sin(a);
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2, u = Math.cos(t) * rx, v = Math.sin(t) * rz;
    out.push(cx + u * c - v * s, cz + u * s + v * c);
  }
  return out;
};
// a strip along a polyline, `w(t)` wide at t 0..1 of its length, from `t0` to `t1` m along it
function strip(line, t0, t1, w) {
  const pts = [], cum = [0];
  for (let i = 2; i < line.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]));
  const len = cum[cum.length - 1];
  const at = (t) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < t) k++;
    const f = (t - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    const ax = line[k * 2 - 2], az = line[k * 2 - 1], bx = line[k * 2], bz = line[k * 2 + 1], l = Math.hypot(bx - ax, bz - az) || 1;
    return [ax + (bx - ax) * f, az + (bz - az) * f, (bx - ax) / l, (bz - az) / l];
  };
  const left = [], right = [], n = 10;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n, [x, z, dx, dz] = at(t), h = w(t / len) / 2;
    left.push(x - dz * h, z + dx * h);
    right.unshift(z - dx * h, x + dz * h);
  }
  for (let i = 0; i < right.length; i += 2) pts.push(right[i + 1], right[i]);
  return [...left, ...pts];
}
function mappedHoles(golf, holes) {
  const greens = [], tees = [], bunkers = [], pins = [], fairways = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { line } of holes) {
    for (let i = 0; i < line.length; i += 2) { minX = Math.min(minX, line[i]); maxX = Math.max(maxX, line[i]); minZ = Math.min(minZ, line[i + 1]); maxZ = Math.max(maxZ, line[i + 1]); }
    const n = line.length;
    let len = 0;
    for (let i = 2; i < n; i += 2) len += Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
    const ta = Math.atan2(line[3] - line[1], line[2] - line[0]), ga = Math.atan2(line[n - 1] - line[n - 3], line[n - 2] - line[n - 4]);
    const gx = line[n - 2], gz = line[n - 1], r = hash01(gx, gz);
    tees.push([ellipse(line[0] + Math.cos(ta) * 4, line[1] + Math.sin(ta) * 4, 8, 5, ta, 8)]);
    // the green: longer along the line of play, bigger on the longer holes
    const gr = len > 280 ? 14 : len > 160 ? 12 : 10.5;
    greens.push([ellipse(gx, gz, gr + r * 3, gr * 0.78 + r * 2, ga + (r - 0.5) * 0.5)]);
    pins.push(gx + (r - 0.5) * 5, gz + (hash01(gz, gx) - 0.5) * 4);
    for (let k = 0; k < 1 + (r < 0.65 ? 1 : 0); k++) {
      const b = ga + Math.PI / 2 * (k ? -1 : 1) * (0.8 + r * 0.6), d = gr + 6;
      bunkers.push([ellipse(gx + Math.cos(b) * d, gz + Math.sin(b) * d, 5 + r * 1.5, 2.8, b + Math.PI / 2, 12)]);
    }
    // the fairway, from past the forward tees to short of the green, widest in the landing zone; a long hole's
    // fairway bunker at the landing zone's edge
    if (len > 190) {
      fairways.push([strip(line, Math.min(90, len * 0.3), len - gr - 2, (t) => 26 + Math.sin(Math.PI * Math.min(1, t * 1.15)) * 12)]);
      if (len > 300) {
        const t = Math.min(len - 60, 210), s = strip(line, t, t + 1, () => 2 * (24 + r * 4) * (r < 0.5 ? 1 : -1));
        bunkers.push([ellipse(s[0], s[1], 6, 3.2, ta, 12)]);
      }
    }
  }
  // the course's open grass there gives way to the holes
  const centre = (f) => { let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; } return [x / (f.length / 2), z / (f.length / 2)]; };
  const kept = golf.fairways.filter((rings) => {
    const [x, z] = centre(rings[0]);
    return x < minX - 60 || x > maxX + 60 || z < minZ - 60 || z > maxZ + 60;
  });
  return { ...golf, fairways: [...kept, ...fairways], greens: [...golf.greens, ...greens], tees: [...golf.tees, ...tees],
    bunkers: [...golf.bunkers, ...bunkers], pins: [...golf.pins, ...pins] };
}

// The courses as they're drawn and played: the map's own greens, tees, bunkers and fairways, with Huron Hills' holes
// laid along their mapped lines. A fairway with no mapped green or tee near it stays a fairway: no hole is made up for it
function layOutHoles(golf) {
  return mappedHoles(golf, GOLF_HOLES);
}

function buildGolf(group, golf, flatGeo, toRing, y) {
  if (!golf) return;
  golf = layOutHoles(golf);
  const fairways = [], greens = [], tees = [], bunkers = [];
  for (const rings of golf.fairways) {
    const r = rings.map((f) => smooth(toRing(f)));
    fairways.push(tagged(flatGeo(r, y), mowAngle(r[0])));
  }
  for (const rings of golf.tees) {
    const r = rings.map(toRing);
    tees.push(tagged(flatGeo(r, y + 0.004), mowAngle(r[0])));
  }
  for (const rings of golf.greens) {
    const r = rings.map((f) => smooth(toRing(f), 2));
    greens.push(tagged(flatGeo(r, y + 0.008), mowAngle(r[0]) + Math.PI / 4));
  }
  for (const rings of golf.bunkers) bunkers.push(flatGeo(rings.map((f) => smooth(toRing(f), 2)), y + 0.006));
  // the course's own lawn, cut closer: a little lighter on the fairways, more on the tees and greens
  addMerged(group, fairways, createParkLawnMaterial(false, { width: 8, lift: 0.1 }), 'GolfFairways');
  addMerged(group, tees, createParkLawnMaterial(false, { width: 2, lift: 0.18 }), 'GolfTees');
  addMerged(group, greens, createParkLawnMaterial(false, { width: 1.5, lift: 0.28 }), 'GolfGreens');
  addMerged(group, bunkers, new THREE.MeshStandardNodeMaterial({ color: 0xe0cfa0, roughness: 1 }), 'GolfBunkers');
  addMerged(group, golf.paths.filter((p) => p.length >= 4).map((p) => ribbon(p, 2.4, y + 0.012)),
    new THREE.MeshStandardNodeMaterial({ color: 0x55575a, roughness: 0.9 }), 'GolfCartPaths');

  // The pins: a white flagstick with a flag, red on the front nine's greens and yellow on the back's
  const P = golf.pins;
  if (!P.length) return;
  const stick = new THREE.CylinderGeometry(0.02, 0.02, 2.3, 5).translate(0, 1.15, 0);
  const flag = new THREE.BufferGeometry();
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.3, 0, 0, 1.85, 0, 0.55, 2.08, 0, 0, 2.3, 0, 0.55, 2.08, 0, 0, 1.85, 0], 3));
  flag.computeVertexNormals();
  const cup = new THREE.CircleGeometry(0.11, 10).rotateX(-Math.PI / 2).translate(0, 0.003, 0);
  const sticks = new THREE.InstancedMesh(stick, new THREE.MeshStandardNodeMaterial({ color: 0xf4f4f0, roughness: 0.5 }), P.length / 2);
  const flags = new THREE.InstancedMesh(flag, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), P.length / 2);
  const cups = new THREE.InstancedMesh(cup, new THREE.MeshBasicNodeMaterial({ color: 0x151515 }), P.length / 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const red = new THREE.Color(0xd8282b), yellow = new THREE.Color(0xf3c518);
  for (let i = 0; i < P.length / 2; i++) {
    const x = P[i * 2], z = P[i * 2 + 1];
    // every flag blows the same way, with the wind
    q.setFromAxisAngle(up, 0.6 + Math.sin(x * 0.13 + z * 0.07) * 0.25);
    m.compose(new THREE.Vector3(x, y + 0.01, z), q, one);
    sticks.setMatrixAt(i, m); flags.setMatrixAt(i, m); cups.setMatrixAt(i, m);
    flags.setColorAt(i, i % 2 ? red : yellow);
  }
  for (const im of [sticks, flags, cups]) { im.castShadow = im !== cups; group.add(im); }
  sticks.name = 'GolfPins';
}

// Trails through the parks, woods and campus lawns (GEO.trails from build-annarbor.py, OpenStreetMap's paths and
// footways with the city's Non-Motorized Routes' materials, and the city's trails and shared-use paths OSM is missing):
// packed dirt or gravel on the woodland paths (kind 1), pale gray concrete on the park walks (0), dark asphalt on the
// bike paths and shared-use paths (2). The boardwalks (3) and steps (4) are bike-routes.js's
function buildTrails(group, trails, y) {
  if (!trails) return;
  const dirt = [], paved = [], asphalt = [];
  for (const t of trails) {
    if (t.length < 6 || t[0] > 2) continue;
    (t[0] === 1 ? dirt : t[0] === 2 ? asphalt : paved).push(ribbon(t.slice(2), t[1], t[0] === 1 ? y : y + (t[0] === 2 ? 0.008 : 0.004)));
  }
  // Lamp: in front of the lawn but behind the city's own paving (driveways and the campus's walks, drawn over the lawn
  // as if 6 cm up): the map's footpaths run a little off the surveyed walks, so where the two overlap the walk wins,
  // and a paved path is the walks' own concrete, so it carries on from them seamlessly where the survey has none
  addMerged(group, dirt, drawOver(overlay(0x8f7c5e), 0.03), 'TrailsDirt');
  addMerged(group, paved, drawOver(overlay(0xa29e96), 0.03), 'TrailsPaved');
  addMerged(group, asphalt, drawOver(overlay(0x55575a), 0.07), 'TrailsAsphalt');
}

export { buildGolf, buildTrails, layOutHoles };
