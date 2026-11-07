import * as THREE from 'three/webgpu';
import { color, smoothstep } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';
import { cityUniforms } from './tsl-materials.js';
import { XBOX } from './device-tier.js';

// Lamp: the town's parking structures (data/parking-structures.json, Assets/Tools/build-parking-structures.py, from
// OpenStreetMap), driven and walked up floor by floor. Each stands on its mapped outline in place of the survey's plain
// block (`replaces`): an open ground floor on the ground, then a concrete deck a floor every FLOOR metres above the
// highest ground under it, the top one open to the sky. Precast spandrels with a cap run round every deck's edge on
// square columns; the ramp bay (the builder's strip) runs down the middle or along one wall between two walls through
// every floor, its ramps stacked a floor apart, all climbing the same way: up one, along the deck beside it and back to
// its low end for the next. A brick stair tower stands in a corner, light poles on the ramp walls' tops over the roof,
// lights under every deck between its double tees' stems, painted stalls with wheel stops, yellow-topped curbs up the
// ramps, panel joints down the spandrels, plinths and corbels on the columns, a steel door onto every deck from the
// tower. One open corner of the roof rises gently over the railing, clear of stalls, to drive up and off. Its cars are the parked cars' own (parked-cars.js takes
// `stalls`): about three in ten stalls taken, fewer on the roof.
// `top(x, z, y)` is the deck or ramp under someone at height y there (the highest within a step above them), or
// -Infinity: controllers.js makes it their ground. `colliders` are the spandrels, the ramp walls, the columns and the
// tower, each only as high as it stands, so a car on one floor drives under the next floor's walls.

const FLOOR = 3.2, SLAB = 0.36, PARAPET = 1.05, STEP = 0.7;
const COL_EVERY = 7.6, COL = 0.56;
const TOWER = 5.4;
// the spandrels' middle in from the outline (their outer face 4 cm proud of the slabs' edges, so the two never fight)
const INSET = 0.07;
// the precast double tees' stems under every deck, a stem every RIB_EVERY metres
const RIB = 0.42, RIB_W = 0.16, RIB_EVERY = 1.2;
// the roof's raised corner: a wedge across it, flat this far in from the corner along its bisector, at the full rise
// (well over the cap, so a car's nose clears the railing before it gets there) this close, laid in cells this big
const BANK = { reach: 9, full: 3.4, rise: PARAPET + 0.4, cell: 0.6 };
const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
const hash = (x, z, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

const PAINT = { slab: 0xa9a59d, under: 0x8f8c86, spandrel: 0xcbc4b5, cap: 0xd9d3c6, column: 0xb7b2a8, ramp: 0x9d9a93,
  wall: 0xbdb8ae, floor: 0x86837d, brick: 0x8b4e3b, glass: 0x2d3943, steel: 0x5d6368, stop: 0xb9b4aa,
  joint: 0x77736c, yellow: 0xe0b52a, door: 0x4a5560 };

function painted(g, hex) {
  g = flat(g);
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// a box from (u0, y0, v0) to (u1, y1, v1) in a structure's frame
const slabBox = (u0, u1, y0, y1, v0, v1) => new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0).translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
// a box along the world segment a → b, `t` thick, from y0 to y1, its middle `inset` to the left of the way it runs
function edgeBox(ax, az, bx, bz, y0, y1, t, inset = 0) {
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
  const nx = -dz, nz = dx;
  return new THREE.BoxGeometry(L, y1 - y0, t).rotateY(-Math.atan2(dz, dx))
    .translate((ax + bx) / 2 + nx * inset, (y0 + y1) / 2, (az + bz) / 2 + nz * inset);
}
const obbOf = (ax, az, bx, bz, t, inset, minY, maxY) => {
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
  const cx = (ax + bx) / 2 - dz * inset, cz = (az + bz) / 2 + dx * inset, hx = L / 2, hz = t / 2;
  // obb's local x along (cs, -sn) in world terms as buildingContact reads it: lx = dx*cs - dz*sn
  const cs = dx, sn = -dz;
  const ex = Math.abs(dx) * hx + Math.abs(dz) * hz, ez = Math.abs(dz) * hx + Math.abs(dx) * hz;
  return { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY, obb: { cx, cz, hx, hz, cs, sn }, thin: true, keepsSurvey: true };
};

// the survey's buildings this structure stands in: each whose middle is inside its outline
function surveyed(poly, minX, maxX, minZ, maxZ) {
  const out = [];
  for (const b of REAL_BUILDINGS) {
    if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
    const ring = b.polygons[0]?.outer;
    if (!ring?.length) continue;
    let x = 0, z = 0;
    for (const p of ring) { x += p.x; z += p.z; }
    x /= ring.length; z /= ring.length;
    if (polygonContains(poly, x, z)) out.push(b);
  }
  return out;
}

function createParkingStructures(group, data) {
  group.name = 'ParkingStructures';
  const S = data?.structures || [];
  const colliders = [], footprints = [], stalls = [], built = [];
  const stripes = [], stops = [], fixtures = [], heads = [], ribSets = [];
  const bucket = new Map(), CELL = 64;
  let floors = 0;

  for (const s of S) {
    const [cx, cz, ux, uz] = s.frame;
    const [uA, uB, v0, v1] = s.strip;
    // the frame's u along (ux, uz), v to its left, (-uz, ux)
    const W = (u, v) => [cx + ux * u - uz * v, cz + uz * u + ux * v];
    const local = (x, z) => [(x - cx) * ux + (z - cz) * uz, -(x - cx) * uz + (z - cz) * ux];
    const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux))
      .setPosition(cx, 0, cz);
    const ring = [];
    for (let i = 0; i < s.outline.length; i += 2) ring.push({ x: s.outline[i], z: s.outline[i + 1] });
    const poly = { outer: ring, holes: [] };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    let g0 = -Infinity, gLow = Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      const [u, v] = local(p.x, p.z);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
      const g = groundHeight(p.x, p.z);
      g0 = Math.max(g0, g); gLow = Math.min(gLow, g);
    }
    for (let u = uMin + 4; u < uMax - 2; u += 8) for (let v = vMin + 4; v < vMax - 2; v += 8) {
      const [x, z] = W(u, v);
      if (polygonContains(poly, x, z)) { const g = groundHeight(x, z); g0 = Math.max(g0, g); gLow = Math.min(gLow, g); }
    }
    const blocks = surveyed(poly, minX, maxX, minZ, maxZ);
    if (!blocks.length && !s.levels) continue;
    // its floors: as mapped, else as high as the survey measured it (a floor every FLOOR metres, the roof's spandrel on top)
    const tall = blocks.reduce((h, b) => Math.max(h, b.height || 0), 0);
    const levels = Math.max(2, Math.min(9, s.levels || Math.round((tall - PARAPET) / FLOOR) + 1));
    const G = g0 + LIFT.lawn;
    const deckY = (k) => G + k * FLOOR;
    const topK = levels - 1, roofY = deckY(topK);
    const [ax0, az0] = W(uA, (v0 + v1) / 2);
    const gA = groundHeight(ax0, az0) + LIFT.lawn;
    // ramp k from deck k at uA to deck k + 1 at uB (the ground's own height at its foot for the first)
    const rampY = (k, t) => (k === 0 ? gA + t * (deckY(1) - gA) : deckY(k) + t * FLOOR);

    const parts = [];
    const first = colliders.length;
    // the ground floor, laid on the ground in 3 m squares
    const cell = 3;
    for (let u = uMin; u < uMax; u += cell) for (let v = vMin; v < vMax; v += cell) {
      const [mx, mz] = W(u + cell / 2, v + cell / 2);
      if (!polygonContains(poly, mx, mz)) continue;
      const q = new THREE.PlaneGeometry(cell, cell, 1, 1).rotateX(-Math.PI / 2).translate(u + cell / 2, 0, v + cell / 2);
      const pos = q.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const [x, z] = W(pos.getX(i), pos.getZ(i));
        pos.setY(i, groundHeight(x, z) + LIFT.lawn + 0.012);
      }
      parts.push(painted(q, PAINT.floor).applyMatrix4(frame));
    }
    // the decks: the outline less the ramp bay, a slab each floor
    for (const d of s.decks) {
      const toShape = (f, Ctor) => { const sh = new Ctor(); for (let i = 0; i < f.length; i += 2) (i ? sh.lineTo(f[i], f[i + 1]) : sh.moveTo(f[i], f[i + 1])); return sh; };
      const shape = toShape(d[0], THREE.Shape);
      for (const h of d.slice(1)) shape.holes.push(toShape(h, THREE.Path));
      const slab = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false, curveSegments: 1 }).rotateX(Math.PI / 2);
      for (let k = 1; k <= topK; k++) parts.push(painted(slab.clone().translate(0, deckY(k), 0), k === topK ? PAINT.slab : PAINT.under));
    }
    // the double tees' stems under every deck, across it from the outline to the ramp bay's walls
    const ringL = ring.map((p) => local(p.x, p.z)), ribs = [], ribYaw = Math.atan2(-uz, ux);
    for (let u = uMin + RIB_EVERY; u < uMax - 0.3; u += RIB_EVERY) {
      const vs = [];
      for (let i = 0; i < ringL.length; i++) {
        const [pu, pv] = ringL[i], [qu, qv] = ringL[(i + 1) % ringL.length];
        if ((pu - u) * (qu - u) < 0) vs.push(pv + (u - pu) / (qu - pu) * (qv - pv));
      }
      vs.sort((p, q) => p - q);
      const inBay = u > uA - 0.12 && u < uB + 0.12;
      for (let i = 0; i + 1 < vs.length; i += 2) {
        const spans = inBay ? [[vs[i] + 0.2, Math.min(vs[i + 1] - 0.2, v0 - 0.12)], [Math.max(vs[i] + 0.2, v1 + 0.12), vs[i + 1] - 0.2]] : [[vs[i] + 0.2, vs[i + 1] - 0.2]];
        for (const [a, b] of spans) {
          if (b - a < 0.6) continue;
          const [x, z] = W(u, (a + b) / 2);
          for (let k = 1; k <= topK; k++) ribs.push([x, deckY(k) - SLAB - RIB / 2, z, ribYaw, b - a]);
        }
      }
    }
    ribSets.push(ribs);
    const body = [];
    // the ramps, sloped slabs between the bay's walls
    const hw = (v1 - v0) / 2, vm = (v0 + v1) / 2, run = uB - uA;
    for (let k = 0; k < topK; k++) {
      const y0 = rampY(k, 0), y1 = rampY(k, 1), len = Math.hypot(run, y1 - y0), pitch = Math.atan2(y1 - y0, run);
      body.push(painted(new THREE.BoxGeometry(len, 0.3, hw * 2 - 0.1).translate(0, -0.15, 0).rotateZ(pitch)
        .translate((uA + uB) / 2, (y0 + y1) / 2, vm), PAINT.ramp));
      // a curb along each wall, its top painted yellow
      for (const side of [-1, 1]) {
        const cv = vm + side * (hw - 0.27);
        body.push(painted(new THREE.BoxGeometry(len, 0.15, 0.26).translate(0, 0.075, 0).rotateZ(pitch).translate((uA + uB) / 2, (y0 + y1) / 2, cv), PAINT.wall));
        body.push(painted(new THREE.BoxGeometry(len, 0.01, 0.27).translate(0, 0.155, 0).rotateZ(pitch).translate((uA + uB) / 2, (y0 + y1) / 2, cv), PAINT.yellow));
      }
    }
    // the bay's two walls, through every floor
    const wallTop = roofY + PARAPET + 0.15;
    for (const v of [v0, v1]) {
      body.push(painted(slabBox(uA, uB, gLow - 0.3, wallTop, v - 0.12, v + 0.12), PAINT.wall));
      body.push(painted(slabBox(uA - 0.05, uB + 0.05, wallTop, wallTop + 0.07, v - 0.18, v + 0.18), PAINT.cap));
      const [ax, az] = W(uA, v), [bx, bz] = W(uB, v);
      colliders.push(obbOf(ax, az, bx, bz, 0.3, 0, gLow - 1, wallTop));
      // light poles along the walls' tops over the roof, a head leaning out each side
      for (let u = uA + 4; u < uB - 2; u += 12) {
        body.push(painted(slabBox(u - 0.24, u + 0.24, wallTop + 0.07, wallTop + 0.6, v - 0.24, v + 0.24), PAINT.cap));
        body.push(painted(slabBox(u - 0.17, u + 0.17, wallTop + 0.6, wallTop + 0.64, v - 0.17, v + 0.17), PAINT.steel));
        body.push(painted(new THREE.CylinderGeometry(0.075, 0.12, 5.5, 14).translate(u, wallTop + 0.64 + 2.75, v), PAINT.steel));
        body.push(painted(slabBox(u - 0.06, u + 0.06, wallTop + 6.05, wallTop + 6.15, v - 1.2, v + 1.2), PAINT.steel));
        const [hx, hz] = W(u, v - 1.2), [jx, jz] = W(u, v + 1.2);
        heads.push([hx, wallTop + 6.0, hz], [jx, wallTop + 6.0, jz]);
      }
    }
    // across the bay under the last ramp's high end on the ground floor, and across its low end on the roof
    body.push(painted(slabBox(uB - 0.12, uB + 0.12, gLow - 0.3, deckY(1) - 0.3, v0, v1), PAINT.wall));
    body.push(painted(slabBox(uA - 0.12, uA + 0.12, roofY - SLAB, wallTop, v0, v1), PAINT.wall));
    for (const [u, y0, y1] of [[uB, gLow - 1, deckY(1) - 0.3], [uA, roofY - SLAB, wallTop]]) {
      const [ax, az] = W(u, v0), [bx, bz] = W(u, v1);
      colliders.push(obbOf(ax, az, bx, bz, 0.3, 0, y0, y1));
    }
    for (const p of body) parts.push(p.applyMatrix4(frame));
    // round the outline: columns from the ground to the roof's spandrel, the spandrels and their caps on every deck
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.3) continue;
      // inward: the outline's winding decides which side is in
      const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const inSide = polygonContains(poly, mx - dz * 0.6, mz + dx * 0.6) ? 1 : -1;
      for (let k = 1; k <= topK; k++) {
        const y = deckY(k);
        parts.push(painted(edgeBox(a.x, a.z, b.x, b.z, y - SLAB - 0.1, y + PARAPET, 0.22, INSET * inSide), PAINT.spandrel));
        parts.push(painted(edgeBox(a.x, a.z, b.x, b.z, y + PARAPET, y + PARAPET + 0.07, 0.34, INSET * inSide), PAINT.cap));
        // a reveal along each spandrel's face, and a drip under the cap
        parts.push(painted(edgeBox(a.x, a.z, b.x, b.z, y + 0.32, y + 0.36, 0.25, INSET * inSide), PAINT.under));
        parts.push(painted(edgeBox(a.x, a.z, b.x, b.z, y + PARAPET - 0.03, y + PARAPET, 0.235, INSET * inSide), PAINT.under));
        // the joints between its precast panels, about every 3 m
        const panels = Math.max(1, Math.round(L / 3));
        for (let j = 1; j < panels; j++) {
          const t0 = j / panels - 0.018 / L, t1 = j / panels + 0.018 / L;
          parts.push(painted(edgeBox(a.x + (b.x - a.x) * t0, a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.z + (b.z - a.z) * t1,
            y - SLAB - 0.1, y + PARAPET, 0.012, (INSET - 0.11 - 0.004) * inSide), PAINT.joint));
        }
        colliders.push(obbOf(a.x, a.z, b.x, b.z, 0.3, 0.12 * inSide, y - SLAB - 0.1, y + PARAPET + 0.07));
      }
      const count = Math.max(1, Math.round(L / COL_EVERY));
      for (let c = 0; c < count; c++) {
        const t = c / count, x = a.x + (b.x - a.x) * t + (-dz) * 0.32 * inSide, z = a.z + (b.z - a.z) * t + dx * 0.32 * inSide;
        const g = groundHeight(x, z) - 0.3;
        const turn = -Math.atan2(dz, dx);
        parts.push(painted(new THREE.BoxGeometry(COL, roofY + PARAPET - g, COL).rotateY(turn).translate(x, (g + roofY + PARAPET) / 2, z), PAINT.column));
        // a plinth at its foot, and a corbel under each deck on its inner face
        const gl = groundHeight(x, z) + LIFT.lawn;
        parts.push(painted(new THREE.BoxGeometry(COL + 0.16, gl + 0.35 - g, COL + 0.16).rotateY(turn).translate(x, (g + gl + 0.35) / 2, z), PAINT.cap));
        for (let k = 1; k <= topK; k++) {
          const yb = deckY(k) - SLAB;
          parts.push(painted(new THREE.BoxGeometry(COL, 0.34, 0.34).translate(0, 0, 0.45 * inSide).rotateY(turn).translate(x, yb - 0.17, z), PAINT.column));
        }
        const r = COL * 0.6;
        colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY: g, maxY: roofY + PARAPET, thin: true, keepsSurvey: true });
      }
    }
    // the stair tower, in the corner at the ramp's foot away from the bay
    let tower = null;
    const away = Math.abs(vMax - vm) > Math.abs(vMin - vm) ? 1 : -1;
    for (const [su, sv] of [[-1, away], [1, away], [-1, -away], [1, -away]]) {
      const tu = su < 0 ? uMin + TOWER / 2 + 0.4 : uMax - TOWER / 2 - 0.4, tv = sv > 0 ? vMax - TOWER / 2 - 0.4 : vMin + TOWER / 2 + 0.4;
      const ok = [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, b]) => polygonContains(poly, ...W(tu + a * TOWER / 2, tv + b * TOWER / 2)))
        && (tv + TOWER / 2 < v0 - 1 || tv - TOWER / 2 > v1 + 1);
      if (ok) { tower = { u: tu, v: tv }; break; }
    }
    if (tower) {
      const top = roofY + 3.6, g = gLow - 0.3, { u, v } = tower, h = TOWER / 2;
      const t = [];
      t.push(painted(slabBox(u - h, u + h, g, top, v - h, v + h), PAINT.brick));
      t.push(painted(slabBox(u - h - 0.1, u + h + 0.1, top, top + 0.25, v - h - 0.1, v + h + 0.1), PAINT.cap));
      // its glass stair face, outward, floor to roof
      const out = (v > vm ? 1 : -1) * (h + 0.03);
      t.push(painted(slabBox(u - h + 0.6, u + h - 0.6, g + 0.6, top - 0.5, v + out - 0.03, v + out + 0.03), PAINT.glass));
      for (let k = 1; k <= topK + 1; k++) t.push(painted(slabBox(u - h + 0.55, u + h - 0.55, deckY(Math.min(k, topK)) + (k > topK ? 2.2 : -0.1), deckY(Math.min(k, topK)) + (k > topK ? 2.32 : 0.05), v + out - 0.06, v + out + 0.06), PAINT.brick));
      // mullions down the glass, and a steel door onto every deck on the side facing in
      for (let mu = u - h + 0.6; mu <= u + h - 0.55; mu += 0.85) t.push(painted(slabBox(mu - 0.035, mu + 0.035, g + 0.6, top - 0.5, v + out - 0.06, v + out + 0.06), PAINT.steel));
      const inn = -(v > vm ? 1 : -1);
      for (let k = 0; k <= topK; k++) {
        const fy = k === 0 ? G : deckY(k), face = v + inn * h;
        t.push(painted(slabBox(u - 0.5, u + 0.5, fy, fy + 2.15, Math.min(face, face + inn * 0.04), Math.max(face, face + inn * 0.04)), PAINT.door));
        t.push(painted(slabBox(u - 0.62, u + 0.62, fy + 2.15, fy + 2.27, Math.min(face, face + inn * 0.07), Math.max(face, face + inn * 0.07)), PAINT.cap));
      }
      for (const p of t) parts.push(p.applyMatrix4(frame));
      const corners = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => W(u + a, v + b));
      const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
      const [tx, tz] = W(u, v);
      colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: g, maxY: top + 0.25,
        obb: { cx: tx, cz: tz, hx: h, hz: h, cs: ux, sn: -uz }, thin: true, keepsSurvey: true });
    }
    // one corner of the roof rises gently over the railing: the open corner (clear of the bay and the tower) with the
    // longest walls, the deck swelling across it from flat BANK.reach in to over the cap, so a car run into it rides up and off
    const area2 = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0);
    const banks = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      const e1x = b.x - a.x, e1z = b.z - a.z, e2x = c.x - b.x, e2z = c.z - b.z;
      if (Math.hypot(e1x, e1z) < 4 || Math.hypot(e2x, e2z) < 4) continue;
      const cross = e1x * e2z - e1z * e2x;
      // convex corners only, turning by a third of a right angle or more
      if (cross * area2 <= 0 || Math.atan2(Math.abs(cross), e1x * e2x + e1z * e2z) < 0.6) continue;
      const [u, v] = local(b.x, b.z);
      if (Math.hypot(Math.max(uA - u, 0, u - uB), Math.max(v0 - v, 0, v - v1)) < 5) continue;
      if (tower && Math.hypot(u - tower.u, v - tower.v) < TOWER + 3) continue;
      // the way in from the corner, halfway between its walls
      const l1 = Math.hypot(e1x, e1z), l2 = Math.hypot(e2x, e2z);
      let ix = -e1x / l1 + e2x / l2, iz = -e1z / l1 + e2z / l2;
      const il = Math.hypot(ix, iz) || 1; ix /= il; iz /= il;
      // its whole run in from the corner on the roof's deck
      let clear = true;
      for (let t = 1; t <= BANK.reach + 4 && clear; t += 1) {
        const [pu, pv] = local(b.x + ix * t, b.z + iz * t);
        clear = polygonContains(poly, b.x + ix * t, b.z + iz * t) && Math.hypot(Math.max(uA - pu, 0, pu - uB), Math.max(v0 - pv, 0, pv - v1)) > 2;
      }
      if (clear) banks.push({ x: b.x, z: b.z, u, v, ix, iz, size: Math.min(l1, l2) });
    }
    banks.sort((p, q) => q.size - p.size);
    banks.length = Math.min(banks.length, 1);
    const inBay = (u, v) => u >= uA && u <= uB && v >= v0 && v <= v1;
    // how far the roof stands above its deck at (x, z)
    const bank = (x, z) => {
      if (!banks.length) return 0;
      const [u, v] = local(x, z);
      if (inBay(u, v)) return 0;
      let h = 0;
      for (const k of banks) {
        const d = (x - k.x) * k.ix + (z - k.z) * k.iz;
        if (d >= BANK.reach) continue;
        const t = Math.min(1, (BANK.reach - d) / (BANK.reach - BANK.full));
        h = Math.max(h, BANK.rise * t ** 1.5);
      }
      return h;
    };
    if (banks.length) {
      const pos = [], nor = [], cs = BANK.cell, e = 0.25;
      const vert = (u, v) => {
        const [x, z] = W(u, v);
        // its slope from the heights either side, for smooth shading
        const gu = (bank(...W(u + e, v)) - bank(...W(u - e, v))) / (2 * e), gv = (bank(...W(u, v + e)) - bank(...W(u, v - e))) / (2 * e);
        const l = Math.hypot(gu, 1, gv);
        pos.push(u, roofY + 0.008 + bank(x, z), v);
        nor.push(-gu / l, 1 / l, -gv / l);
      };
      const done = new Set();
      for (const k of banks) {
        const R = BANK.reach * 2.5;
        const u0 = Math.floor((k.u - R) / cs), u1 = Math.ceil((k.u + R) / cs);
        const w0 = Math.floor((k.v - R) / cs), w1 = Math.ceil((k.v + R) / cs);
        for (let i = u0; i < u1; i++) for (let j = w0; j < w1; j++) {
          const key = i * 100000 + j;
          if (done.has(key)) continue;
          const mu = (i + 0.5) * cs, mv = (j + 0.5) * cs, [mx, mz] = W(mu, mv);
          if ((mx - k.x) * k.ix + (mz - k.z) * k.iz > BANK.reach + cs || inBay(mu, mv) || !polygonContains(poly, mx, mz)) continue;
          done.add(key);
          const p0 = [i * cs, j * cs], p1 = [(i + 1) * cs, j * cs], p2 = [(i + 1) * cs, (j + 1) * cs], p3 = [i * cs, (j + 1) * cs];
          for (const p of [p0, p2, p1, p0, p3, p2]) vert(p[0], p[1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      parts.push(painted(g, PAINT.slab).applyMatrix4(frame));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), null);
    mesh.name = s.name || 'Parking structure';
    mesh.castShadow = mesh.receiveShadow = true;
    built.push(mesh);
    // the survey's blocks it stands in are left out (buildings.js), each named by one of its colliders
    blocks.forEach((b, i) => { if (colliders[first + i]) colliders[first + i].replaces = b; });
    footprints.push({ minX, maxX, minZ, maxZ });

    // the stalls on every floor: lines between them, wheel stops at their noses, and about three in ten taken
    const inTower = (x, z) => {
      if (!tower) return false;
      const [u, v] = local(x, z);
      return Math.abs(u - tower.u) < TOWER / 2 + 2.8 && Math.abs(v - tower.v) < TOWER / 2 + 2.8;
    };
    for (let k = 0; k <= topK; k++) {
      for (let i = 0; i < s.stalls.length; i += 3) {
        const x = s.stalls[i], z = s.stalls[i + 1], yaw = s.stalls[i + 2];
        if (inTower(x, z) || (k === topK && bank(x, z) > 0)) continue;
        const y = k === 0 ? groundHeight(x, z) + LIFT.lawn + 0.02 : deckY(k) + 0.006;
        const fx = Math.sin(yaw), fz = Math.cos(yaw), ax = Math.cos(yaw), az = -Math.sin(yaw);
        for (const side of [-1, 1]) stripes.push([x + ax * side * 1.3, y, z + az * side * 1.3, yaw]);
        stops.push([x + fx * 2.05, y, z + fz * 2.05, yaw]);
        const fill = k === topK ? 0.14 : 0.3;
        if (hash(x, z, 11 + k) < fill) {
          // nose in, a few backed in; parked-cars.js's spots stand at y above the ground's own height
          const way = hash(x, z, 23 + k) < 0.85 ? 0 : Math.PI;
          const px = x - fx * 0.25, pz = z - fz * 0.25;
          stalls.push({ x: px, z: pz, yaw: yaw + way, y: k === 0 ? LIFT.lawn + 0.012 : deckY(k) - groundHeight(px, pz), deck: k > 0 });
        }
      }
      // lights under every deck, one every bay or so along each aisle, between the stems
      if (k < topK) {
        for (let u = uMin + 4; u < uMax - 3; u += 8.4) for (const v of [v0 - 7.5, v1 + 7.5, (vMin + v0) / 2, (vMax + v1) / 2]) {
          const [x, z] = W(u, v);
          if (polygonContains(poly, x, z) && (v < v0 - 1 || v > v1 + 1)) fixtures.push([x, deckY(k + 1) - SLAB - 0.05, z, Math.atan2(ux, uz)]);
        }
      }
    }
    floors += levels;

    // where someone stands on it
    const rec = { poly, minX, maxX, minZ, maxZ, local, uA, uB, v0, v1, topK, deckY, rampY, levels, roofY, bank };
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const key = ix * 100000 + iz;
        if (!bucket.has(key)) bucket.set(key, []);
        bucket.get(key).push(rec);
      }
    }
  }

  const concrete = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  for (const m of built) {
    m.material = concrete;
    group.add(m);
    m.updateMatrixWorld(true);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const ribMat = new THREE.MeshStandardNodeMaterial({ color: PAINT.under, roughness: 0.92 }), ribGeo = flat(new THREE.BoxGeometry(RIB_W, RIB, 1)), sc = new THREE.Vector3();
  for (const list of ribSets) {
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(ribGeo, ribMat, list.length);
    list.forEach(([x, y, z, yaw, len], k) => m.setMatrixAt(k, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(up, yaw), sc.set(1, 1, len))));
    m.castShadow = false; m.receiveShadow = true;
    m.userData.cullDistance = XBOX ? 150 : 240;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
  }
  const inst = (geo, mat, list, cull, shadow = false) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, yaw = 0], k) => m.setMatrixAt(k, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(up, yaw), one)));
    m.castShadow = shadow; m.receiveShadow = true;
    m.userData.cullDistance = cull;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  const paint = new THREE.MeshStandardNodeMaterial({ color: 0xe9e6dc, roughness: 0.8 });
  // Lamp: on the Xbox the stall lines and wheel stops are left out, and the lights show only close by (fewer draws downtown)
  if (!XBOX) {
    inst(new THREE.PlaneGeometry(0.11, 5.0).rotateX(-Math.PI / 2), paint, stripes, 160);
    const stopMat = new THREE.MeshStandardNodeMaterial({ color: PAINT.stop, roughness: 0.95 });
    inst(flat(new THREE.BoxGeometry(1.8, 0.13, 0.16).translate(0, 0.065, 0)), stopMat, stops, 120);
  }
  const lit = new THREE.MeshStandardNodeMaterial({ color: 0xdfe3e6, roughness: 0.5 });
  lit.emissiveNode = color(0xf2f4ff).mul(smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow).mul(2.2).add(0.06));
  inst(flat(new THREE.BoxGeometry(1.25, 0.08, 0.3)), lit, fixtures, XBOX ? 120 : 220);
  inst(flat(new THREE.BoxGeometry(0.55, 0.12, 0.32)), lit, heads, XBOX ? 200 : 420);

  // the highest deck or ramp under (x, z) within a step above y, or -Infinity
  const top = (x, z, y) => {
    if (!(y > -Infinity)) return -Infinity;
    const list = bucket.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (!list) return -Infinity;
    let best = -Infinity;
    for (const r of list) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ || !polygonContains(r.poly, x, z)) continue;
      const [u, v] = r.local(x, z);
      if (u >= r.uA && u <= r.uB && v >= r.v0 && v <= r.v1) {
        const t = (u - r.uA) / (r.uB - r.uA);
        for (let k = 0; k < r.topK; k++) { const h = r.rampY(k, t); if (h <= y + STEP && h > best) best = h; }
      } else {
        for (let k = 1; k <= r.topK; k++) { const h = r.deckY(k); if (h <= y + STEP && h > best) best = h; }
      }
      // up a roof corner's rise
      const h = r.roofY + r.bank(x, z);
      if (h > r.roofY && h <= y + STEP && h > best) best = h;
    }
    return best;
  };
  // the underside of the deck or ramp over someone at height y there (the lowest more than a step above them), or
  // Infinity: what a camera following them inside keeps under
  const ceiling = (x, z, y) => {
    const list = bucket.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (!list) return Infinity;
    let best = Infinity;
    for (const r of list) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ || !polygonContains(r.poly, x, z)) continue;
      const [u, v] = r.local(x, z);
      if (u >= r.uA && u <= r.uB && v >= r.v0 && v <= r.v1) {
        const t = (u - r.uA) / (r.uB - r.uA);
        for (let k = 0; k < r.topK; k++) { const h = r.rampY(k, t) - SLAB; if (h > y + STEP && h < best) best = h; }
      } else {
        for (let k = 1; k <= r.topK; k++) { const h = r.deckY(k) - SLAB - RIB; if (h > y + STEP && h < best) best = h; }
      }
    }
    return best;
  };
  const inside = (x, z) => {
    const list = bucket.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    return !!list && list.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && polygonContains(r.poly, x, z));
  };
  log(`[parking structures] ${built.length} structures, ${floors} floors, ${stalls.length} cars parked in them`);
  return { count: built.length, colliders, footprints, stalls, top, ceiling, inside };
}

async function buildParkingStructures(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/parking-structures.json')));
  } catch (error) { log(`[parking structures] no structure data: ${error}`); }
  return createParkingStructures(group, data);
}

export { buildParkingStructures };
