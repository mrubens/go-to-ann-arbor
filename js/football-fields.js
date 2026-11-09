import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log } from '../lamp-game.js';
import { setOnTerrain } from './terrain.js';
import { LIFT } from './ground-lifts.js';

// Lamp: the high schools' football fields (OpenStreetMap's leisure=pitch sport=american_football, each the stadium
// field of its school): Pioneer's Hollway Field, Huron's and Skyline's. Each is a regulation field set on the mapped
// pitch's middle and long axis (the mapped outlines run a little wider than the field): 100 yards between the goal
// lines and 10-yard end zones, 53⅓ yards across, the turf mowed in a stripe every 5 yards, white chalk sidelines, end
// lines, a yard line every 5 yards, the high school hash marks (53 ft 4 in in from each sideline) and the sideline
// ticks, and a yellow gooseneck goalpost centred on each end line (23 ft 4 in between the uprights, the crossbar at
// 10 ft). Huron's has its running track round it, fitted to the mapped track's outline (sport=athletics), six lanes;
// the others have none mapped round them. No numbers, logos or end zone paint: the map can't vouch for them. The
// ground is one mesh laid on the ground's slope; the goalposts are instanced.

const YD = 0.9144;
// [x, z] of the pitch's middle, its long axis [dx, dz], and Huron's track: its middle's offset in the field's frame
// (along, across), the half-length of its straights and the inner radius of its curves
const FIELDS = [
  { name: 'Hollway Field (Pioneer High)', at: [-297.8, 2198.5], axis: [4, 117] },
  { name: 'Huron High', at: [3833, -19.5], axis: [-60, 92], track: { off: [1.3, 2.1], straight: 50, inner: 33.7, lanes: 6 } },
  { name: 'Skyline High', at: [-2338.3, -2654], axis: [3, 119] },
  // Pioneer's running track, beside Hollway Field to its west (OSM 512165619): a track with grass inside, no field
  { name: 'Pioneer track', at: [-428, 2205.5], axis: [4, 117], trackOnly: true, track: { off: [0, 0], straight: 48.5, inner: 30.7, lanes: 6 } }
];

const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };

// a gooseneck goalpost facing +z (the field): the post behind the end line, the neck forward over it, the crossbar
// across at 10 ft and the uprights up 10 ft more
function goalpostGeometry() {
  const R = 0.085, bar = 3.05, half = 7.11 / 2, up = 3.05 + 6.1;
  const neck = 1.6;
  return mergeGeometries([
    new THREE.CylinderGeometry(R * 1.3, R * 1.4, bar - 0.7, 12).translate(0, (bar - 0.7) / 2, -neck),
    // the neck, slanting up and forward from the post's top to the crossbar's middle
    new THREE.CylinderGeometry(R, R * 1.2, Math.hypot(neck, 0.7), 10).rotateX(Math.atan2(neck, 0.7)).translate(0, bar - 0.35, -neck / 2),
    new THREE.CylinderGeometry(R, R, half * 2, 12).rotateZ(Math.PI / 2).translate(0, bar, 0),
    new THREE.CylinderGeometry(R * 0.75, R * 0.75, up - bar, 10).translate(-half, (bar + up) / 2, 0),
    new THREE.CylinderGeometry(R * 0.75, R * 0.75, up - bar, 10).translate(half, (bar + up) / 2, 0),
    // the padding round the foot of the post
    new THREE.CylinderGeometry(0.3, 0.3, 1.8, 14).translate(0, 0.9, -neck)
  ].map(flat));
}

function createFootballFields(group) {
  group.name = 'FootballFields';
  const pos = [], col = [];
  const tmp = new THREE.Color();
  let cx = 0, cz = 0, fx = 0, fz = 1, rx = -1, rz = 0;
  // (a, b): a along the field from midfield, b across it
  const W = (a, b) => [cx + fx * a + rx * b, cz + fz * a + rz * b];
  const tri = (p0, p1, p2, y, hex) => {
    tmp.setHex(hex);
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const pts = cross < 0 ? [p0, p1, p2] : [p0, p2, p1];
    for (const p of pts) { pos.push(p[0], y, p[1]); col.push(tmp.r, tmp.g, tmp.b); }
  };
  const quad = (a0, a1, b0, b1, y, hex) => {
    const p = [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)];
    tri(p[0], p[1], p[2], y, hex); tri(p[0], p[2], p[3], y, hex);
  };
  const line = (a0, b0, a1, b1, y, w = 0.1, hex = 0xf4f3ee) => {
    const da = a1 - a0, db = b1 - b0, len = Math.hypot(da, db) || 1, na = (-db / len) * w / 2, nb = (da / len) * w / 2;
    const p = [W(a0 - na, b0 - nb), W(a1 - na, b1 - nb), W(a1 + na, b1 + nb), W(a0 + na, b0 + nb)];
    tri(p[0], p[1], p[2], y, hex); tri(p[0], p[2], p[3], y, hex);
  };
  // a ring between two stadium-shaped outlines (straights ±s along a, curves of radius r0..r1 round their ends)
  const ring = (oa, ob, s, r0, r1, y, hex, n = 24) => {
    const P = (r, k) => {
      // round the outline: the right straight, the far curve, the left straight, the near curve
      const t = k / n;
      if (t < 0.25) { const u = t / 0.25; return [oa - s + u * 2 * s, ob + r]; }
      if (t < 0.5) { const u = (t - 0.25) / 0.25 * Math.PI; return [oa + s + Math.sin(u) * r, ob + Math.cos(u) * r]; }
      if (t < 0.75) { const u = (t - 0.5) / 0.25; return [oa + s - u * 2 * s, ob - r]; }
      const u = (t - 0.75) / 0.25 * Math.PI; return [oa - s - Math.sin(u) * r, ob - Math.cos(u) * r];
    };
    for (let k = 0; k < n; k++) {
      const a = P(r0, k), b = P(r0, k + 1), c = P(r1, k + 1), d = P(r1, k);
      tri(W(...a), W(...b), W(...c), y, hex); tri(W(...a), W(...c), W(...d), y, hex);
    }
  };

  const Y = LIFT.lawn;
  const HL = 60 * YD, HW = 160 / 6 * YD; // half the length end line to end line, half the width
  const posts = [];
  for (const F of FIELDS) {
    [cx, cz] = F.at;
    const L = Math.hypot(...F.axis);
    fx = F.axis[0] / L; fz = F.axis[1] / L; rx = -fz; rz = fx;

    if (F.track) {
      const { off: [oa, ob], straight: s, inner, lanes } = F.track;
      const outer = inner + lanes * 1.22;
      // the infield's grass inside it, the rubber, and white lane lines
      ring(oa, ob, s, 0, inner, Y + 0.014, 0x4c8236, 96);
      ring(oa, ob, s, inner, outer, Y + 0.018, 0xa4513a, 96);
      for (let k = 0; k <= lanes; k++) {
        const r = inner + k * 1.22;
        ring(oa, ob, s, r - 0.025, r + 0.025, Y + 0.022, 0xf4f3ee, 96);
      }
    }
    if (F.trackOnly) continue;
    // the turf round the field, a little darker, then the field in 5-yard stripes
    quad(-HL - 4, HL + 4, -HW - 4, HW + 4, Y + 0.025, 0x467c33);
    for (let k = 0; k < 24; k++) {
      const a0 = -HL + k * 5 * YD, a1 = a0 + 5 * YD;
      quad(a0, a1, -HW, HW, Y + 0.03, k & 1 ? 0x5a9443 : 0x4e8839);
    }
    const yl = Y + 0.06;
    // the border: sidelines and end lines, 4 in wide
    line(-HL, -HW, HL, -HW, yl, 0.12); line(-HL, HW, HL, HW, yl, 0.12);
    line(-HL, -HW, -HL, HW, yl, 0.12); line(HL, -HW, HL, HW, yl, 0.12);
    // the goal lines and a line every 5 yards
    for (let yd = 0; yd <= 100; yd += 5) {
      const a = -50 * YD + yd * YD;
      line(a, -HW, a, HW, yl, yd % 50 === 0 ? 0.2 : 0.1);
    }
    // each yard between: the hash marks and the ticks in from the sidelines
    const hash = HW - (160 / 9) * YD; // 53 ft 4 in in from each sideline
    for (let yd = 1; yd < 100; yd++) {
      if (yd % 5 === 0) continue;
      const a = -50 * YD + yd * YD;
      for (const s of [-1, 1]) {
        line(a, s * (HW - 0.1), a, s * (HW - 0.7), yl, 0.1);
        line(a, s * hash, a, s * (hash + 0.6), yl, 0.1);
      }
    }
    // the try lines, 3 yards out from each goal
    for (const s of [-1, 1]) line(s * 47 * YD, -0.5, s * 47 * YD, 0.5, yl, 0.1);
    // the goalposts on the end lines, facing in
    for (const s of [-1, 1]) {
      const [px, pz] = W(s * HL, 0);
      posts.push([px, pz, Math.atan2(-s * fx, -s * fz)]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  const ground = new THREE.Mesh(g, mat);
  ground.name = 'FootballGround';
  ground.receiveShadow = true;
  group.add(ground);

  const yellow = new THREE.MeshStandardNodeMaterial({ color: 0xf2cf1d, roughness: 0.45, metalness: 0.2 });
  const m = new THREE.InstancedMesh(goalpostGeometry(), yellow, posts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  posts.forEach(([x, z, yaw], k) => { q.setFromAxisAngle(up, yaw); m.setMatrixAt(k, m4.compose(v.set(x, Y, z), q, one)); });
  m.castShadow = true; m.receiveShadow = true;
  m.userData.cullDistance = 500;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  group.add(m);

  const lifted = setOnTerrain(group);
  log(`[football] ${FIELDS.filter((F) => !F.trackOnly).length} high school fields, ${posts.length} goalposts, ${pos.length / 9} ground triangles`);
  return Promise.resolve(lifted).then(() => ({ count: FIELDS.length }));
}

function buildFootballFields(group) {
  return createFootballFields(group);
}

// Lamp: each field's outline for the map (city-map.js): the field end line to end line and sideline to sideline as
// four world [x, z] corners, and Huron's track as its outer and inner edges
function footballOutlines() {
  const HL = 60 * YD, HW = 160 / 6 * YD;
  return FIELDS.map((F) => {
    const L = Math.hypot(...F.axis), fx = F.axis[0] / L, fz = F.axis[1] / L, rx = -fz, rz = fx;
    const W = (a, b) => [F.at[0] + fx * a + rx * b, F.at[1] + fz * a + rz * b];
    const field = [W(-HL, -HW), W(HL, -HW), W(HL, HW), W(-HL, HW)];
    let track = null;
    if (F.track) {
      const { off: [oa, ob], straight: st, inner, lanes } = F.track;
      const edge = (r) => {
        const pts = [];
        for (let k = 0; k <= 16; k++) { const u = k / 16 * Math.PI; pts.push(W(oa + st + Math.sin(u) * r, ob + Math.cos(u) * r)); }
        for (let k = 0; k <= 16; k++) { const u = k / 16 * Math.PI; pts.push(W(oa - st - Math.sin(u) * r, ob - Math.cos(u) * r)); }
        return pts;
      };
      track = { outer: edge(inner + lanes * 1.22), inner: edge(inner) };
    }
    return { name: F.name, field, track, mid: W(0, 0), across: [W(0, -HW), W(0, HW)] };
  });
}

// Lamp: whether a point is on a football field's grounds (within 85 m of its middle: the field, its track and aprons)
const nearFootballField = (x, z) => FIELDS.some((F) => Math.hypot(x - F.at[0], z - F.at[1]) < (F.trackOnly ? 100 : 85));

// the city's survey draws Huron's home grandstand as a 9 m block of a building on the track's east side; the bleachers
// (bleachers.js, data/bleachers.json) build it instead, so buildings.js leaves out any surveyed building over here
// (and the low building just behind it, which the stand's back rows ran into); Pioneer's two grandstands the same
const GRANDSTANDS = [[3874.1, 9.8], [3882.58, 16.24], [-342.09, 2220.03], [-254.48, 2207.02], [-2385.8, -2651.8], [-2296.5, -2654.6]];

export { buildFootballFields, footballOutlines, nearFootballField, GRANDSTANDS };
