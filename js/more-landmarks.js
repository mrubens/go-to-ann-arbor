import * as THREE from 'three/webgpu';
import { builder, groundOf } from './campus-landmarks.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';

// Lamp: the rest of Ann Arbor's landmark buildings, modelled by hand on the city survey's own outline of each (found by
// a point inside it, so the model stands exactly where the survey's plain block stood, which it replaces):
// - Michigan League (1929): tan-red brick, limestone bands, a slate mansard, a stone frontispiece of three arches
//   facing Ingalls Mall.
// - Rackham Building (1938): pale limestone, tall bronze-framed windows and its green copper hipped roof.
// - Museum of Art, Alumni Memorial Hall (1910): limestone with a colonnade of columns along State Street.
// - Hatcher Graduate Library: the 1920 front on the Diag in buff brick with five tall arched windows in a stone
//   centre, and the taller stacks behind.
// - Crisler Center (1967): the round arena, concrete walls with a blue and maize band under its low domed roof.
// - Yost Ice Arena (1923): the brick field house with its barrel-vaulted roof and great arched end windows.
// - Kerrytown: the old brick market buildings under a gabled roof.
// - Ann Arbor Farmers Market: the long open sheds on green steel posts (no walls, so you can walk under them).
// - Ann Arbor District Library downtown: brick and concrete with long bands of windows.
// - Tower Plaza: the 26-storey brown brick tower, windows in vertical strips, and its rooftop penthouse.
// Colliders follow each outline in strips, so the neighbours stay; the survey's block is dropped by `replaces`.

const LIME = [0.84, 0.8, 0.72];
const LIME_DARK = [0.72, 0.68, 0.6];
const BRICK_LEAGUE = [0.6, 0.38, 0.28];
const BRICK_BUFF = [0.74, 0.62, 0.46];
const BRICK_RED = [0.5, 0.26, 0.19];
const BRICK_BROWN = [0.42, 0.29, 0.22];
const SLATE = [0.24, 0.25, 0.28];
const COPPER = [0.36, 0.56, 0.48];
const ROOF = [0.27, 0.27, 0.29];
const CONCRETE = [0.7, 0.68, 0.64];
const BLUE = [0.04, 0.14, 0.3];
const MAIZE = [0.95, 0.75, 0.1];
const GREEN_STEEL = [0.16, 0.34, 0.24];
const TIN = [0.62, 0.64, 0.64];
const GLASS = [0.15, 0.19, 0.25];
const BRONZE = [0.28, 0.2, 0.12];

// the survey's building with a point inside it, its outline as [x, z, ...] and its height
function surveyAt(x, z) {
  for (const b of REAL_BUILDINGS) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    for (const p of b.polygons) {
      if (!polygonContains(p, x, z)) continue;
      return { b, ring: p.outer.flatMap((q) => [q.x, q.z]), height: b.height };
    }
  }
  return null;
}

// the walls of a ring, each with its outward normal, longest first
function edgesOf(ring) {
  const n = ring.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  const s = area > 0 ? -1 : 1, out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    out.push({ ax, az, L, tx, tz, nx: -tz * s, nz: tx * s });
  }
  return out.sort((a, b) => b.L - a.L);
}
// the longest wall facing (dx, dz)
const edgeFacing = (ring, dx, dz) => edgesOf(ring).find((e) => e.nx * dx + e.nz * dz > 0.8) || edgesOf(ring)[0];

// the ring moved in by d (each wall moved in, its corners where the moved walls meet)
function insetRing(ring, d) {
  const n = ring.length / 2;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  const s = area > 0 ? 1 : -1, out = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const x = ring[i * 2], z = ring[i * 2 + 1];
    const e1 = [x - ring[p * 2], z - ring[p * 2 + 1]], e2 = [ring[q * 2] - x, ring[q * 2 + 1] - z];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    // inward normals of the two walls
    const n1 = [-e1[1] / l1 * s, e1[0] / l1 * s], n2 = [-e2[1] / l2 * s, e2[0] / l2 * s];
    const bx = n1[0] + n2[0], bz = n1[1] + n2[1], bl = Math.hypot(bx, bz);
    if (bl < 1e-3) { out.push(x + n1[0] * d, z + n1[1] * d); continue; }
    const cos = (bx / bl) * n1[0] + (bz / bl) * n1[1];
    const k = d / Math.max(0.35, cos);
    out.push(x + (bx / bl) * k, z + (bz / bl) * k);
  }
  return out;
}
const scaleRing = (ring, k) => {
  let cx = 0, cz = 0;
  for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
  cx /= ring.length / 2; cz /= ring.length / 2;
  return ring.map((v, i) => (i % 2 ? cz + (v - cz) * k : cx + (v - cx) * k));
};

// colliders that follow a ring in strips across z, so they keep off the buildings beside it
function strips(ring, maxY, step = 4) {
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 1; i < ring.length; i += 2) { z0 = Math.min(z0, ring[i]); z1 = Math.max(z1, ring[i]); }
  const n = ring.length / 2, out = [];
  for (let z = z0; z < z1; z += step) {
    const zb = Math.min(z1, z + step), zm = (z + zb) / 2, xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const az = ring[i * 2 + 1], bz = ring[j * 2 + 1];
      if ((az <= zm) === (bz <= zm)) continue;
      xs.push(ring[i * 2] + ((zm - az) / (bz - az)) * (ring[j * 2] - ring[i * 2]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] < 0.8) continue;
      out.push({ minX: xs[k] + 0.3, maxX: xs[k + 1] - 0.3, minZ: z + 0.15, maxZ: zb - 0.15, maxY, keepsSurvey: true });
    }
  }
  return out;
}

function tools(B) {
  // a box on a wall: u along it, d out from it
  const ebox = (e, u0, u1, y0, y1, d0, d1, col, m = B.stone) => {
    const P = (u, y, d) => [e.ax + e.tx * u + e.nx * d, y, e.az + e.tz * u + e.nz * d];
    const a = P(u0, y0, d0), b = P(u1, y0, d0), c = P(u1, y0, d1), f = P(u0, y0, d1);
    const a2 = P(u0, y1, d0), b2 = P(u1, y1, d0), c2 = P(u1, y1, d1), f2 = P(u0, y1, d1);
    B.quad(m, a2, f2, c2, b2, col);
    B.quad(m, a, b, c, f, col);
    B.quad(m, f, c, c2, f2, col);
    B.quad(m, b, a, a2, b2, col);
    B.quad(m, c, b, b2, c2, col);
    B.quad(m, a, f, f2, a2, col);
  };
  // a round-topped opening on a wall
  const earch = (e, u, y0, y1, w, d, col, m = B.glass) => {
    const r = w / 2;
    ebox(e, u - r, u + r, y0, y1 - r, d, d + 0.05, col, m);
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * (Math.PI / 2), a1 = ((k + 1) / 6) * (Math.PI / 2), hw = Math.cos((a0 + a1) / 2) * r;
      ebox(e, u - hw, u + hw, y1 - r + Math.sin(a0) * r, y1 - r + Math.sin(a1) * r, d, d + 0.05, col, m);
    }
  };
  // a round column (octagonal) standing out from a wall
  const ecolumn = (e, u, y0, y1, r, d, col) => {
    const cx = e.ax + e.tx * u + e.nx * d, cz = e.az + e.tz * u + e.nz * d, ring = [];
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ring.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r); }
    B.prism(ring, y0, y1, col);
  };
  // the ring's walls, with their windows: rows of [y0, y1], one every `every` m
  const walls = (ring, y0, y1, col, top = ROOF) => B.prism(ring, y0, y1, col, top);
  // a band around the ring, standing proud by d
  const band = (ring, y0, y1, col, d = 0.15) => B.prism(insetRing(ring, -d), y0, y1, col);
  // a roof sloping in from the ring at y0 by `inset` to y1, flat on top
  const slope = (ring, y0, inset, y1, col) => {
    const inner = insetRing(ring, inset), n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.quad(B.stone, [ring[i * 2], y0, ring[i * 2 + 1]], [ring[j * 2], y0, ring[j * 2 + 1]],
        [inner[j * 2], y1, inner[j * 2 + 1]], [inner[i * 2], y1, inner[i * 2 + 1]], col);
    }
    B.prism(inner, y1 - 0.02, y1, col);
    return inner;
  };
  return { ebox, earch, ecolumn, walls, band, slope };
}

function michiganLeague(B, T) {
  const s = surveyAt(891, 37);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(1.2), LIME_DARK);
  T.walls(r, Y(1.2), Y(13.4), BRICK_LEAGUE);
  B.ringWindows(r, [[2.2, 4.4], [5.4, 7.8], [8.8, 11.2]], 3.2, 1.4, GLASS, 0.03);
  T.band(r, Y(4.8), Y(5.1), LIME);
  T.band(r, Y(12.6), Y(13.4), LIME, 0.25);
  T.slope(r, Y(13.4), 3, Y(17.4), SLATE);
  // the frontispiece on the west wall: limestone, three tall arches, a balustrade
  const e = edgeFacing(r, -1, 0), c = e.L / 2;
  T.ebox(e, c - 8, c + 8, Y(0), Y(14.4), 0, 0.7, LIME);
  for (const du of [-5, 0, 5]) {
    T.earch(e, c + du, Y(0.3), Y(5.6), 2.6, 0.72, BRONZE, B.stone);
    T.earch(e, c + du, Y(6.6), Y(12.2), 2.4, 0.72, GLASS);
  }
  for (const du of [-7.5, -2.5, 2.5, 7.5]) T.ebox(e, c + du - 0.45, c + du + 0.45, Y(0), Y(13.6), 0.7, 1.0, LIME_DARK);
  T.ebox(e, c - 8.3, c + 8.3, Y(14.4), Y(15.4), -0.2, 0.9, LIME_DARK);
  return { s, maxY: Y(17.4) };
}

function rackham(B, T) {
  const s = surveyAt(834, -132);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(1.6), LIME_DARK);
  T.walls(r, Y(1.6), Y(17), LIME);
  B.ringWindows(r, [[3, 8.4], [10, 15]], 4.4, 2, GLASS, 0.03);
  T.band(r, Y(8.9), Y(9.4), LIME_DARK);
  T.band(r, Y(16.2), Y(17.6), LIME_DARK, 0.4);
  // the copper roof
  T.slope(r, Y(17.6), 5, Y(24.5), COPPER);
  // the entrance on the north: three tall bronze doors under a stone frame, up wide steps
  const e = edgeFacing(r, 0, -1), c = e.L / 2;
  T.ebox(e, c - 9, c + 9, Y(0), Y(15.5), 0, 0.9, LIME);
  for (const du of [-4.5, 0, 4.5]) {
    T.ebox(e, c + du - 1.6, c + du + 1.6, Y(0.8), Y(6.5), 0.9, 0.95, BRONZE);
    T.ebox(e, c + du - 1.6, c + du + 1.6, Y(7.2), Y(14), 0.9, 0.95, GLASS, B.glass);
  }
  for (let k = 0; k < 4; k++) T.ebox(e, c - 10, c + 10, g - 1, Y(0.2 * (4 - k)), 0.9, 1.4 + k * 0.5, LIME_DARK);
  return { s, maxY: Y(24.5) };
}

function museumOfArt(B, T) {
  const s = surveyAt(705, 450);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(1.4), LIME_DARK);
  T.walls(r, Y(1.4), Y(13.2), LIME);
  B.ringWindows(r, [[2.6, 5.6], [7.2, 11]], 4, 1.8, GLASS, 0.03);
  T.band(r, Y(12.4), Y(13.6), LIME_DARK, 0.4);
  T.walls(r, Y(13.6), Y(15), LIME);
  // the colonnade along State Street (west): eight columns on a stone porch, under the entablature
  const e = edgeFacing(r, -1, 0), c = e.L / 2, span = Math.min(28, e.L - 6);
  T.ebox(e, c - span / 2 - 1.5, c + span / 2 + 1.5, g - 1, Y(1.4), 0, 4.2, LIME_DARK);
  for (let k = 0; k < 3; k++) T.ebox(e, c - span / 2 - 1.5, c + span / 2 + 1.5, g - 1, Y(1.4 - 0.35 * (k + 1)), 4.2, 4.6 + k * 0.45, LIME_DARK);
  for (let k = 0; k < 8; k++) {
    const u = c - span / 2 + (k * span) / 7;
    T.ebox(e, u - 0.7, u + 0.7, Y(1.4), Y(1.9), 2.3, 3.7, LIME);
    T.ecolumn(e, u, Y(1.9), Y(11.6), 0.55, 3, LIME);
    T.ebox(e, u - 0.75, u + 0.75, Y(11.6), Y(12.1), 2.25, 3.75, LIME);
  }
  T.ebox(e, c - span / 2 - 1.5, c + span / 2 + 1.5, Y(12.1), Y(13.6), 0, 4, LIME);
  T.ebox(e, c - span / 2 - 1.8, c + span / 2 + 1.8, Y(13.6), Y(14.2), -0.2, 4.3, LIME_DARK);
  for (let k = 0; k < 3; k++) T.ebox(e, c - 2.2 + k * 2.2 - 0.9, c - 2.2 + k * 2.2 + 0.9, Y(1.4), Y(5.2), 0.02, 0.06, BRONZE);
  return { s, maxY: Y(15) };
}

function hatcher(B, T) {
  const front = surveyAt(840, 365), stacks = surveyAt(840, 410);
  if (!front) return null;
  const r = front.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(1.6), LIME_DARK);
  T.walls(r, Y(1.6), Y(15.6), BRICK_BUFF);
  B.ringWindows(r, [[2.8, 5.4], [6.8, 9.6], [11, 13.6]], 3.4, 1.5, GLASS, 0.03);
  T.band(r, Y(15.6), Y(17), LIME, 0.3);
  // the stone centre on the Diag (north): five tall arched windows between pilasters, over the doors
  const e = edgeFacing(r, 0, -1), c = e.L / 2;
  T.ebox(e, c - 15, c + 15, Y(0), Y(16), 0, 0.6, LIME);
  for (let k = 0; k < 5; k++) {
    const u = c - 12 + k * 6;
    T.earch(e, u, Y(5), Y(14.2), 3.4, 0.62, GLASS);
    T.ebox(e, u - 1.3, u + 1.3, Y(0.4), Y(3.6), 0.62, 0.66, BRONZE);
  }
  for (let k = 0; k <= 5; k++) T.ebox(e, c - 15 + k * 6 - 0.5, c - 15 + k * 6 + 0.5, Y(0), Y(15.4), 0.6, 0.95, LIME_DARK);
  T.ebox(e, c - 15.3, c + 15.3, Y(16), Y(17.4), -0.1, 1.1, LIME_DARK);
  const out = [{ s: front, maxY: Y(17.4) }];
  if (stacks) {
    const q = stacks.ring, h = stacks.height;
    B.prism(q, g - 2, Y(1.6), LIME_DARK);
    T.walls(q, Y(1.6), Y(h - 1), BRICK_BUFF);
    const rows = [];
    for (let y = 3; y < h - 3; y += 3) rows.push([y, y + 1.9]);
    B.ringWindows(q, rows, 2.4, 0.7, GLASS, 0.03);
    T.band(q, Y(h - 1), Y(h), LIME, 0.25);
    out.push({ s: stacks, maxY: Y(h) });
  }
  return out;
}

// a roof between rings scaled toward the middle: [scale, height] from the eaves up
function dome(B, ring, layers, col) {
  const n = ring.length / 2;
  for (let l = 0; l + 1 < layers.length; l++) {
    const a = scaleRing(ring, layers[l][0]), b = scaleRing(ring, layers[l + 1][0]), ya = layers[l][1], yb = layers[l + 1][1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      B.quad(B.stone, [a[i * 2], ya, a[i * 2 + 1]], [a[j * 2], ya, a[j * 2 + 1]], [b[j * 2], yb, b[j * 2 + 1]], [b[i * 2], yb, b[i * 2 + 1]], col);
    }
  }
  const last = layers[layers.length - 1];
  B.prism(scaleRing(ring, last[0]), last[1] - 0.02, last[1], col);
}

function crisler(B, T) {
  const s = surveyAt(140, 1620);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(7.4), CONCRETE);
  T.band(r, Y(7.4), Y(9.4), BLUE, 0.05);
  T.band(r, Y(9.4), Y(10), MAIZE, 0.08);
  T.walls(r, Y(10), Y(11), CONCRETE);
  // concrete fins around the wall, glass between them at the doors' level
  for (const e of edgesOf(r)) {
    for (let u = 1; u < e.L - 0.5; u += 4.5) T.ebox(e, u - 0.3, u + 0.3, Y(0), Y(11.2), 0, 0.7, CONCRETE);
    for (let u = 3.25; u < e.L - 2; u += 4.5) T.ebox(e, u - 1.7, u + 1.7, Y(0.3), Y(3.4), 0.02, 0.06, GLASS, B.glass);
  }
  dome(B, r, [[1.03, Y(11)], [0.86, Y(15)], [0.64, Y(19.5)], [0.38, Y(22.6)], [0.12, Y(24)]], [0.78, 0.78, 0.76]);
  return { s, maxY: Y(24) };
}

function yost(B, T) {
  const s = surveyAt(607, 1340);
  if (!s) return null;
  const x0 = s.b.minX + 0.5, x1 = s.b.maxX - 0.5, z0 = s.b.minZ + 0.5, z1 = s.b.maxZ - 0.5;
  const g = groundOf(s.ring) - 0.3, Y = (y) => g + y;
  const W = 12, cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, wallH = 12, rise = 11;
  B.box(x0, x1, g - 2, Y(1.2), z0, z1, LIME_DARK);
  B.box(x0, x1, Y(1.2), Y(wallH), z0, z1, BRICK_RED);
  B.box(x0 - 0.2, x1 + 0.2, Y(wallH), Y(wallH + 0.6), z0 - 0.2, z1 + 0.2, LIME);
  // the barrel vault along the hall, its arch in segments
  const arc = (k) => { const a = Math.PI - (k / W) * Math.PI; return [cx + Math.cos(a) * hw, Y(wallH + 0.6) + Math.sin(a) * rise]; };
  for (let k = 0; k < W; k++) {
    const [ax, ay] = arc(k), [bx, by] = arc(k + 1);
    B.quad(B.stone, [ax, ay, z0 - 0.3], [ax, ay, z1 + 0.3], [bx, by, z1 + 0.3], [bx, by, z0 - 0.3], k % 2 ? ROOF : [0.3, 0.3, 0.32]);
  }
  // the gable ends: brick filling the arch, a great arched window in each, and the doors below
  for (const [z, side] of [[z0, 0], [z1, 2]]) {
    for (let k = 0; k < W; k++) {
      const [ax, ay] = arc(k), [bx, by] = arc(k + 1);
      B.quad(B.stone, [ax, Y(wallH), z], [bx, Y(wallH), z], [bx, by, z], [ax, ay, z], BRICK_RED);
      B.quad(B.stone, [bx, Y(wallH), z], [ax, Y(wallH), z], [ax, ay, z], [bx, by, z], BRICK_RED);
    }
    B.faceArch(cx, (z0 + z1) / 2, (z1 - z0) / 2, side, 0, Y(5), Y(wallH + rise - 2), 16, 0.03, GLASS);
    B.faceBox(cx, (z0 + z1) / 2, (z1 - z0) / 2, side, -3, 3, Y(0.3), Y(3.6), 0.02, 0.06, BRONZE);
    B.faceBox(cx, (z0 + z1) / 2, (z1 - z0) / 2, side, -9, 9, Y(4.2), Y(4.6), 0, 0.3, LIME);
  }
  // tall arched windows down both sides, between brick buttresses
  for (const side of [1, 3]) {
    const half = hw, len = z1 - z0, cz = (z0 + z1) / 2;
    for (let u = -len / 2 + 5; u < len / 2 - 3; u += 7) {
      B.faceArch(cx, cz, half, side, u + 3.5, Y(3.5), Y(10.6), 2.6, 0.03, GLASS);
      B.faceBox(cx, cz, half, side, u - 0.5, u + 0.5, Y(1.2), Y(wallH), 0, 0.6, BRICK_RED);
    }
  }
  const ring = [x0, z0, x1, z0, x1, z1, x0, z1];
  return { s: { ...s, ring }, maxY: Y(wallH + rise) };
}

function kerrytown(B, T) {
  const s = surveyAt(175, -556);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(0.5), LIME_DARK);
  T.walls(r, Y(0.5), Y(7), BRICK_RED);
  for (const e of edgesOf(r)) {
    for (let u = 2.5; u < e.L - 2; u += 3.6) {
      T.earch(e, u, Y(0.8), Y(3.8), 2, 0.03, GLASS);
      T.ebox(e, u - 0.7, u + 0.7, Y(4.6), Y(6.2), 0.03, 0.06, GLASS, B.glass);
      T.ebox(e, u - 0.85, u + 0.85, Y(6.2), Y(6.45), 0, 0.15, LIME);
    }
  }
  T.band(r, Y(7), Y(7.4), LIME, 0.2);
  // a gabled roof along its length
  const x0 = s.b.minX, x1 = s.b.maxX, z0 = s.b.minZ, z1 = s.b.maxZ, zc = (z0 + z1) / 2, top = Y(11);
  B.quad(B.stone, [x0 - 0.3, Y(7.4), z0 - 0.3], [x0 - 0.3, top, zc], [x1 + 0.3, top, zc], [x1 + 0.3, Y(7.4), z0 - 0.3], SLATE);
  B.quad(B.stone, [x1 + 0.3, Y(7.4), z1 + 0.3], [x1 + 0.3, top, zc], [x0 - 0.3, top, zc], [x0 - 0.3, Y(7.4), z1 + 0.3], SLATE);
  for (const x of [x0, x1]) B.tri(B.stone, [x, Y(7.4), z0], [x, top - 0.3, zc], [x, Y(7.4), z1], BRICK_RED);
  for (const x of [x0, x1]) B.tri(B.stone, [x, Y(7.4), z1], [x, top - 0.3, zc], [x, Y(7.4), z0], BRICK_RED);
  return { s, maxY: top };
}

function farmersMarket(B, T) {
  const s = surveyAt(168, -470);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.2, Y = (y) => g + y, poly = s.b.polygons[0];
  // green steel posts on a grid under the roof, the roof's tin edge and its low pitch
  for (let x = s.b.minX + 2; x < s.b.maxX - 1; x += 6) {
    for (let z = s.b.minZ + 2; z < s.b.maxZ - 1; z += 6) {
      if (!polygonContains(poly, x, z) || !polygonContains(poly, x + 1.2, z) || !polygonContains(poly, x - 1.2, z) ||
        !polygonContains(poly, x, z + 1.2) || !polygonContains(poly, x, z - 1.2)) continue;
      B.box(x - 0.14, x + 0.14, g - 0.5, Y(4.1), z - 0.14, z + 0.14, GREEN_STEEL);
      // a stall's table beside every other post
      if (((x + z) | 0) % 2) B.box(x + 0.6, x + 2.6, Y(0.8), Y(0.9), z - 0.5, z + 0.5, [0.5, 0.36, 0.22]);
    }
  }
  const eave = insetRing(r, -0.6);
  B.prism(eave, Y(4.1), Y(4.4), GREEN_STEEL, TIN);
  T.slope(eave, Y(4.4), 2.5, Y(5.2), TIN);
  return { s, maxY: Y(5.2), open: true };
}

function districtLibrary(B, T) {
  const s = surveyAt(235, 160);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y, h = s.height;
  B.prism(r, g - 2, Y(0.6), CONCRETE);
  T.walls(r, Y(0.6), Y(h - 0.8), BRICK_BROWN);
  // long bands of windows a floor, between concrete bands
  for (let f = 0; f < 4; f++) {
    const y = 0.9 + f * 4.2;
    if (y + 3 > h - 1) break;
    for (const e of edgesOf(r)) if (e.L > 6) T.ebox(e, 1, e.L - 1, Y(y), Y(y + (f ? 2.2 : 3)), 0.02, 0.06, GLASS, B.glass);
    T.band(r, Y(y + 3.3), Y(y + 4), CONCRETE, 0.12);
  }
  T.band(r, Y(h - 0.8), Y(h), CONCRETE, 0.25);
  return { s, maxY: Y(h) };
}

function towerPlaza(B, T) {
  const s = surveyAt(496, 182);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y, h = s.height;
  B.prism(r, g - 2, Y(4.2), CONCRETE);
  T.walls(r, Y(4.2), Y(h - 4), BRICK_BROWN);
  const rows = [];
  for (let y = 5; y < h - 6; y += 3.05) rows.push([y, y + 1.8]);
  B.ringWindows(r, rows, 2.7, 1.2, GLASS, 0.03);
  // the lobby's glass under a canopy, the top band and the penthouse
  for (const e of edgesOf(r)) if (e.L > 8) T.ebox(e, 1.5, e.L - 1.5, Y(0.3), Y(3.8), 0.02, 0.06, GLASS, B.glass);
  T.band(r, Y(4), Y(4.4), CONCRETE, 0.4);
  T.walls(r, Y(h - 4), Y(h), CONCRETE);
  B.prism(scaleRing(r, 0.45), Y(h), Y(h + 4.5), CONCRETE);
  return { s, maxY: Y(h + 4.5) };
}

const MODELS = [
  ['Michigan League', michiganLeague],
  ['Rackham Building', rackham],
  ['Museum of Art', museumOfArt],
  ['Hatcher Library', hatcher],
  ['Crisler Center', crisler],
  ['Yost Ice Arena', yost],
  ['Kerrytown', kerrytown],
  ['Farmers Market', farmersMarket],
  ['District Library', districtLibrary],
  ['Tower Plaza', towerPlaza]
];

function buildMoreLandmarks(group, colliders) {
  const B = builder(), T = tools(B), built = [];
  for (const [name, make] of MODELS) {
    const made = make(B, T);
    if (!made) continue;
    for (const { s, maxY, open } of [].concat(made)) {
      // the first strip carries the survey block it replaces (an open shed's strip is only a post's footprint)
      const c = open ? [{ minX: s.b.cx - 0.2, maxX: s.b.cx + 0.2, minZ: s.b.cz - 0.2, maxZ: s.b.cz + 0.2, maxY, keepsSurvey: true }] : strips(s.ring, maxY);
      if (!c.length) continue;
      c[0].replaces = s.b;
      colliders.push(...c);
    }
    built.push(name);
  }
  const mesh = (m, mat, name) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const out = new THREE.Mesh(geo, mat);
    out.name = name;
    out.castShadow = true;
    out.receiveShadow = true;
    return out;
  };
  group.add(
    mesh(B.stone, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }), 'MoreLandmarksMasonry'),
    mesh(B.glass, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide, emissive: 0x1c1409 }), 'MoreLandmarksGlass'));
  return built;
}

export { buildMoreLandmarks };
