import * as THREE from 'three/webgpu';
import { positionWorld, normalWorld, cameraPosition, vertexColor, mx_noise_float, smoothstep, step, mix, max, abs, floor, fract, float, vec3, color } from 'three/tsl';
import { builder, groundOf, strips, landmarkGlass } from './campus-landmarks.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';
import { cityUniforms } from './tsl-materials.js';
import { XBOX } from './device-tier.js';

// Lamp: the rest of Ann Arbor's landmark buildings, modelled by hand on the city survey's own outline of each (found by
// a point inside it, so the model stands exactly where the survey's plain block stood, which it replaces):
// - Michigan League (1929): brick with limestone bands and a dentilled cornice, round-arched windows below, tall ones
//   (some paired) and small square ones above, a steep slate roof with dormers and tall chimneys, and the stone
//   frontispiece of three arches under a balustrade facing Ingalls Mall.
// - Rackham Building (1938): Art Deco limestone on a granite base, bronze windows deep between fluted piers with
//   Deco spandrels and carved frieze panels, the bronze-doored south entrance and the green copper hipped roof.
// - Museum of Art: Alumni Memorial Hall (1910), limestone with window surrounds, a balustrade and its Ionic colonnade
//   on State Street, and the 2009 Frankel Wing behind it, stone panels and glass, cantilevered over S University.
// - Hatcher Graduate Library: the 1920 front on the Diag in buff brick with five tall arched windows in a stone
//   centre, and the taller stacks behind.
// - Crisler Center (1967): the round arena, concrete walls with a blue and maize band under its low domed roof.
// - Yost Ice Arena (1923): the brick field house with its barrel-vaulted roof and great arched end windows.
// - Kerrytown Market & Shops: three old brick buildings round a courtyard, each its own height and brick, with
//   segmental-arched windows, wood-and-glass shopfronts, loading-dock decks and the Kerrytown Chime's belfry.
// - Ann Arbor Farmers Market: long open sheds, gabled along their length on green steel trusses, the stalls' tables
//   under them (no walls, so you can walk under them).
// - Ann Arbor District Library downtown: tan brick and precast, bronze window bands between brick piers, a deep fascia,
//   the Fifth Ave entrance's two-storey glass bay under a thin canopy on posts.
// - Tower Plaza: the 26-storey brown brick tower, windows in vertical strips, and its rooftop penthouse.
// - The Gandy Dancer (1886): the Michigan Central depot in rough fieldstone with red sandstone arches, a red hipped
//   roof, its round tower and the platform porch along the tracks.
// - Huron High School (1969, Lane, Riebe, Weiland): three storeys of brown brick under a concrete fascia, its round
//   classroom pods joined by a long diagonal spine, curved wings around them, the gym block to the north, glass dome
//   skylights over the pods and ribbon windows wrapping every curve.
// - Atomic Object (123 N Ashley, 1926): cream brick with a shaped parapet, tall glass bays and punched windows.
// - Nickels Arcade (1915-18): the terra cotta State St front with its arched portico, the yellow brick Maynard end, and
//   the gable-skylit gallery between them, shopfronts down both sides, that you can walk through.
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
    // a big arch needs finer steps to read as a curve
    const n = Math.max(6, Math.round(w * 1.6));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * (Math.PI / 2), a1 = ((k + 1) / n) * (Math.PI / 2), hw = Math.cos((a0 + a1) / 2) * r;
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
  const K = ktTools(B, T);
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  const EAVE = 13.4, IN = 3, RIDGE = 19.2, SLOPE = (RIDGE - EAVE) / IN;
  B.prism(r, g - 2, Y(1.2), LIME_DARK);
  const fe = edgeFacing(r, -1, 0), isFront = (e) => Math.abs(e.ax - fe.ax) < 0.01 && Math.abs(e.az - fe.az) < 0.01;
  // brick walls, stone bands and a dentilled cornice; windows a floor at a time: round-arched with keystones on the
  // ground floor, tall ones under flat stone arches on the second (paired in every third bay), small square ones on
  // the third; a dormer over every other bay, on the slate roof
  edgesOf(r).forEach((e, ei) => {
    K.face(e, 0, e.L, Y(1.2), Y(EAVE), 0.01, BRICK_LEAGUE, B.brick);
    T.ebox(e, -0.05, e.L + 0.05, Y(1.1), Y(1.35), 0, 0.15, LIME);
    T.ebox(e, -0.05, e.L + 0.05, Y(4.8), Y(5.1), 0, 0.15, LIME);
    T.ebox(e, -0.15, e.L + 0.15, Y(12.6), Y(13.0), 0, 0.25, LIME);
    for (let u = 0.25; u < e.L - 0.1; u += 0.5) T.ebox(e, u - 0.09, u + 0.09, Y(12.4), Y(12.6), 0, 0.18, LIME);
    T.ebox(e, -0.3, e.L + 0.3, Y(13.0), Y(EAVE), 0, 0.45, LIME);
    if (e.L < 3.2) return;
    const n = Math.floor((e.L - 0.8) / 3.2), off = (e.L - n * 3.2) / 2 + 1.6;
    for (let k = 0; k < n; k++) {
      const u = off + k * 3.2;
      if (isFront(e) && Math.abs(u - e.L / 2) < 8.6) continue;
      T.earch(e, u, Y(2.0), Y(4.4), 1.5, 0.03, GLASS);
      T.ebox(e, u - 0.18, u + 0.18, Y(4.2), Y(4.75), 0, 0.12, LIME);
      T.ebox(e, u - 0.9, u + 0.9, Y(1.85), Y(2.0), 0, 0.14, LIME);
      const pair = (k + ei) % 3 === 1;
      for (const du of pair ? [-0.45, 0.45] : [0]) {
        const w = pair ? 0.7 : 1.3;
        K.face(e, u + du - w / 2, u + du + w / 2, Y(5.6), Y(7.9), 0.02, GLASS, B.glass);
        K.face(e, u + du - 0.03, u + du + 0.03, Y(5.6), Y(7.9), 0.04, KT_SASH);
        K.face(e, u + du - w / 2, u + du + w / 2, Y(6.9), Y(6.96), 0.04, KT_SASH);
      }
      T.ebox(e, u - 0.95, u + 0.95, Y(7.9), Y(8.3), 0, 0.1, LIME);
      T.ebox(e, u - 0.85, u + 0.85, Y(5.45), Y(5.6), 0, 0.14, LIME);
      K.face(e, u - 0.6, u + 0.6, Y(9.3), Y(10.7), 0.02, GLASS, B.glass);
      K.face(e, u - 0.03, u + 0.03, Y(9.3), Y(10.7), 0.04, KT_SASH);
      T.ebox(e, u - 0.75, u + 0.75, Y(9.15), Y(9.3), 0, 0.14, LIME);
      // a dormer over every other bay, its face a metre in from the wall, set in the slate
      if (k % 2 || e.L < 6) continue;
      const d0 = -0.9, d1 = -2.6, y0 = EAVE + 0.9 * SLOPE - 0.2, y1 = y0 + 2.2, top = y1 + 0.9, w = 0.85;
      T.ebox(e, u - w, u + w, Y(y0), Y(y1), d1, d0, SLATE);
      K.face(e, u - 0.5, u + 0.5, Y(y0 + 0.3), Y(y1 - 0.3), d0 + 0.02, GLASS, B.glass);
      T.ebox(e, u - 0.6, u + 0.6, Y(y0 + 0.2), Y(y0 + 0.3), d0, d0 + 0.08, LIME);
      K.face(e, u - 0.03, u + 0.03, Y(y0 + 0.3), Y(y1 - 0.3), d0 + 0.04, KT_SASH);
      const P = (uu, y, d) => K.P(e, uu, Y(y), d);
      B.quad(B.stone, P(u - w - 0.15, y1, d0 + 0.2), P(u, top, d0 + 0.2), P(u, top, d1), P(u - w - 0.15, y1, d1), SLATE);
      B.quad(B.stone, P(u, top, d0 + 0.2), P(u + w + 0.15, y1, d0 + 0.2), P(u + w + 0.15, y1, d1), P(u, top, d1), SLATE);
      B.tri(B.stone, P(u - w, y1, d0), P(u + w, y1, d0), P(u, top - 0.1, d0), LIME);
    }
  });
  // the slate roof, steeper than before, a ridge cap round its flat, and tall chimneys of the brick with stone caps
  const flat = T.slope(insetRing(r, -0.3), Y(EAVE), IN, Y(RIDGE), SLATE);
  B.prism(flat, Y(RIDGE), Y(RIDGE + 0.15), [0.2, 0.2, 0.22]);
  const es = edgesOf(r);
  for (const e of es.slice(0, 6)) {
    const p = K.P(e, e.L * 0.3, 0, -IN - 0.6);
    B.box(p[0] - 0.7, p[0] + 0.7, Y(RIDGE - 1), Y(RIDGE + 2.6), p[2] - 0.45, p[2] + 0.45, BRICK_LEAGUE);
    B.box(p[0] - 0.8, p[0] + 0.8, Y(RIDGE + 2.6), Y(RIDGE + 2.8), p[2] - 0.55, p[2] + 0.55, LIME);
    for (const dx of [-0.35, 0.35]) B.box(p[0] + dx - 0.12, p[0] + dx + 0.12, Y(RIDGE + 2.8), Y(RIDGE + 3.2), p[2] - 0.12, p[2] + 0.12, [0.5, 0.3, 0.22]);
  }
  // the frontispiece on the west wall: limestone, three tall arches, a balustrade
  const e = fe, c = e.L / 2;
  T.ebox(e, c - 8, c + 8, Y(0), Y(14.4), 0, 0.7, LIME);
  for (const du of [-5, 0, 5]) {
    T.earch(e, c + du, Y(0.3), Y(5.6), 2.6, 0.72, BRONZE, B.stone);
    T.earch(e, c + du, Y(6.6), Y(12.2), 2.4, 0.72, GLASS);
  }
  for (const du of [-7.5, -2.5, 2.5, 7.5]) T.ebox(e, c + du - 0.45, c + du + 0.45, Y(0), Y(13.6), 0.7, 1.0, LIME_DARK);
  T.ebox(e, c - 8.3, c + 8.3, Y(14.4), Y(15.4), -0.2, 0.9, LIME_DARK);
  for (let u = c - 7.8; u < c + 7.9; u += 0.4) T.ebox(e, u - 0.08, u + 0.08, Y(15.4), Y(16.2), 0.1, 0.3, LIME);
  T.ebox(e, c - 8.3, c + 8.3, Y(16.2), Y(16.45), 0, 0.4, LIME_DARK);
  return { s, maxY: Y(RIDGE + 0.15) };
}

// The Rackham Building (1938, William Kapp of Smith, Hinchman & Grylls): Art Deco in Indiana limestone on a pink-grey
// granite base under a green copper hipped roof. Two tall storeys of windows stacked in bays between shallow fluted
// stone piers, so each window sits deep in its reveal: bronze frames and mullions, a bronze spandrel panel with a
// stepped Deco pattern between the floors, and over each bay a carved stone panel in the frieze (a stepped chevron),
// under a stepped cornice. The south front on E Washington (the recess between its end pavilions): three tall bronze
// doors with grilles over them in a stepped stone surround, wide granite steps, bronze lanterns. The curved north wall
// round the lecture hall is blind but for its piers and carved panels.
const RK_LIME = [0.86, 0.83, 0.75];
const RK_LIME_DARK = [0.74, 0.71, 0.64];
const RK_GRANITE = [0.5, 0.4, 0.38];
const RK_BRONZE = [0.26, 0.19, 0.11];
const RK_BRONZE_LIGHT = [0.42, 0.32, 0.18];
const RK_COPPER = [0.36, 0.56, 0.48];
const RK_COPPER_DARK = [0.29, 0.47, 0.4];
function rackham(B, T) {
  const s = surveyAt(834, -132);
  if (!s) return null;
  const K = ktTools(B, T);
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  const BASE = 1.6, TOP = 17, PITCH = 4.4;
  B.prism(r, g - 2, Y(BASE), RK_GRANITE);
  B.prism(r, Y(TOP) - 0.05, Y(TOP), [0.3, 0.3, 0.31]);
  const front = edgeFacing(r, 0, 1), isFront = (e) => Math.abs(e.ax - front.ax) < 0.01 && Math.abs(e.az - front.az) < 0.01;
  // a carved panel: a stepped chevron in relief on a sunk field
  const relief = (e, u, y0, y1, w) => {
    K.face(e, u - w / 2, u + w / 2, y0, y1, 0.36, RK_LIME_DARK);
    for (let k = 0; k < 4; k++) {
      const hw = (w / 2) * (1 - k * 0.22), y = y0 + 0.12 + k * ((y1 - y0 - 0.24) / 4);
      T.ebox(e, u - hw + 0.1, u + hw - 0.1, y, y + (y1 - y0) / 8, 0.36, 0.42, RK_LIME);
    }
    T.ebox(e, u - 0.06, u + 0.06, y0 + 0.1, y1 - 0.1, 0.36, 0.44, RK_LIME);
  };
  // a fluted pier from y0 to y1
  const pier = (e, u, y0, y1, w = 0.9) => {
    T.ebox(e, u - w / 2, u + w / 2, y0, y1, 0, 0.35, RK_LIME);
    for (const f of [-0.22, 0, 0.22]) K.face(e, u + f * w - 0.03, u + f * w + 0.03, y0 + 0.4, y1 - 0.3, 0.351, RK_LIME_DARK);
  };
  for (const e of edgesOf(r)) {
    K.face(e, 0, e.L, Y(BASE), Y(TOP), 0.01, RK_LIME);
    // the granite base's top course and the stepped cornice
    T.ebox(e, -0.1, e.L + 0.1, Y(BASE - 0.25), Y(BASE), 0, 0.45, RK_GRANITE);
    T.ebox(e, -0.1, e.L + 0.1, Y(TOP - 1.9), Y(TOP - 1.6), 0, 0.42, RK_LIME_DARK);
    T.ebox(e, -0.15, e.L + 0.15, Y(TOP - 0.6), Y(TOP - 0.3), 0, 0.5, RK_LIME);
    T.ebox(e, -0.25, e.L + 0.25, Y(TOP - 0.3), Y(TOP + 0.3), 0, 0.65, RK_LIME_DARK);
    if (e.L < 3) continue;
    const blind = e.nz < -0.4 && e.L < 12; // the curved hall's segments
    const n = Math.max(1, Math.round(e.L / PITCH)), w = e.L / n;
    for (let k = 0; k <= n; k++) pier(e, k * w, Y(BASE), Y(TOP - 1.9), k === 0 || k === n ? 1.2 : 0.9);
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * w, ww = Math.min(2.4, w - 1.5);
      relief(e, u, Y(TOP - 1.55), Y(TOP - 0.65), Math.min(2.6, w - 1.1));
      if (blind || ww < 0.8) { relief(e, u, Y(6), Y(10), Math.min(2, w - 1.3)); continue; }
      if (isFront(e) && Math.abs(u - e.L / 2) < 9.5) continue;
      // the two windows, the bronze spandrel between, the frames and mullions
      for (const [y0, y1] of [[2.6, 8.2], [9.9, 14.9]]) {
        K.face(e, u - ww / 2, u + ww / 2, Y(y0), Y(y1), 0.02, GLASS, B.glass);
        for (const yy of [y0, y1 - 0.1]) T.ebox(e, u - ww / 2, u + ww / 2, Y(yy), Y(yy + 0.1), 0.02, 0.1, RK_BRONZE);
        for (const du of [-ww / 2, -ww / 6, ww / 6, ww / 2 - 0.08]) T.ebox(e, u + du, u + du + 0.08, Y(y0), Y(y1), 0.02, 0.1, RK_BRONZE);
        T.ebox(e, u - ww / 2, u + ww / 2, Y(y0 + (y1 - y0) * 0.7), Y(y0 + (y1 - y0) * 0.7 + 0.08), 0.02, 0.1, RK_BRONZE);
      }
      K.face(e, u - ww / 2, u + ww / 2, Y(8.3), Y(9.8), 0.04, RK_BRONZE);
      for (let j = 0; j < 3; j++) T.ebox(e, u - ww / 2 + 0.2 + j * 0.2, u + ww / 2 - 0.2 - j * 0.2, Y(8.5 + j * 0.4), Y(8.6 + j * 0.4), 0.04, 0.08, RK_BRONZE_LIGHT);
      // a stone sill under the lower window
      T.ebox(e, u - ww / 2 - 0.1, u + ww / 2 + 0.1, Y(2.45), Y(2.6), 0, 0.3, RK_LIME_DARK);
    }
  }
  // the copper roof: hipped in from the cornice, its standing seams, the ridge's flat
  const top = T.slope(insetRing(r, -0.2), Y(TOP + 0.3), 5, Y(24.5), RK_COPPER);
  const eaves = insetRing(r, -0.2), inner = insetRing(r, 4.8), m = eaves.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, L = Math.hypot(eaves[j * 2] - eaves[i * 2], eaves[j * 2 + 1] - eaves[i * 2 + 1]);
    for (let t = 0.6 / L; t < 1; t += 1.2 / L) {
      const ax = eaves[i * 2] + (eaves[j * 2] - eaves[i * 2]) * t, az = eaves[i * 2 + 1] + (eaves[j * 2 + 1] - eaves[i * 2 + 1]) * t;
      const bx = inner[i * 2] + (inner[j * 2] - inner[i * 2]) * t, bz = inner[i * 2 + 1] + (inner[j * 2 + 1] - inner[i * 2 + 1]) * t;
      K.beam([ax, Y(TOP + 0.35), az], [bx, Y(24.45), bz], 0.06, RK_COPPER_DARK);
    }
  }
  B.prism(top, Y(24.5), Y(24.8), RK_COPPER_DARK);
  // the south front: a stepped stone surround round three tall bronze doors, grilles over them, steps and lanterns
  const e = front, c = e.L / 2;
  T.ebox(e, c - 9.5, c + 9.5, Y(BASE), Y(TOP - 1.9), 0, 0.5, RK_LIME);
  T.ebox(e, c - 8.5, c + 8.5, Y(BASE), Y(TOP - 1.2), 0.5, 0.9, RK_LIME);
  T.ebox(e, c - 7.6, c + 7.6, Y(TOP - 1.2), Y(TOP + 0.6), 0, 0.95, RK_LIME_DARK);
  for (const du of [-4.6, 0, 4.6]) {
    // the door's reveal (stone jambs), the bronze door leaves with their panels, the grille over them
    T.ebox(e, c + du - 2.05, c + du - 1.75, Y(0.6), Y(14.4), 0.5, 1.25, RK_LIME_DARK);
    T.ebox(e, c + du + 1.75, c + du + 2.05, Y(0.6), Y(14.4), 0.5, 1.25, RK_LIME_DARK);
    K.face(e, c + du - 1.75, c + du + 1.75, Y(0.6), Y(6.4), 0.92, RK_BRONZE);
    for (let y = 1.1; y < 6.2; y += 1.25) T.ebox(e, c + du - 1.6, c + du + 1.6, Y(y), Y(y + 0.08), 0.92, 0.97, RK_BRONZE_LIGHT);
    T.ebox(e, c + du - 0.04, c + du + 0.04, Y(0.6), Y(6.4), 0.92, 0.98, RK_BRONZE_LIGHT);
    T.ebox(e, c + du - 1.75, c + du + 1.75, Y(6.4), Y(7.1), 0.92, 1.0, RK_BRONZE);
    K.face(e, c + du - 1.75, c + du + 1.75, Y(7.1), Y(14.2), 0.92, GLASS, B.glass);
    for (let u = -1.5; u <= 1.51; u += 0.5) T.ebox(e, c + du + u - 0.04, c + du + u + 0.04, Y(7.1), Y(14.2), 0.93, 1.0, RK_BRONZE);
    for (const y of [9.5, 11.9]) T.ebox(e, c + du - 1.75, c + du + 1.75, Y(y), Y(y + 0.1), 0.93, 1.0, RK_BRONZE);
    relief(e, c + du, Y(14.5), Y(15.5), 3.2);
  }
  // the granite steps across the front, and a lantern at each end of them
  for (let k = 0; k < 4; k++) T.ebox(e, c - 11, c + 11, g - 1, Y(0.15 * (4 - k)), 0.9, 1.6 + k * 0.45, RK_GRANITE);
  for (const du of [-12, 12]) {
    T.ebox(e, c + du - 0.5, c + du + 0.5, g - 0.5, Y(1.2), 1.4, 2.4, RK_GRANITE);
    K.beam(K.P(e, c + du, Y(1.2), 1.9), K.P(e, c + du, Y(4.2), 1.9), 0.18, RK_BRONZE);
    T.ebox(e, c + du - 0.3, c + du + 0.3, Y(4.2), Y(5.0), 1.6, 2.2, [0.95, 0.85, 0.6], B.glass);
    T.ebox(e, c + du - 0.36, c + du + 0.36, Y(5.0), Y(5.15), 1.54, 2.26, RK_BRONZE);
  }
  return { s, maxY: Y(24.8) };
}

// The University of Michigan Museum of Art: Alumni Memorial Hall (1910, Donaldson & Meier), Beaux-Arts limestone, its
// Ionic colonnade between two end pavilions on State Street, and the Maxine and Stuart Frankel and Frankel Family Wing
// (2009, Allied Works) behind it to the south and east, toward S University. Laid out by hand inside the survey's one
// outline of both (found by a point inside it):
// - the hall: a banded base, windows in moulded stone surrounds (the ground floor's under cornice hoods, the upper
//   ones with keystones), the entablature with its dentils, and a balustrade round the roof over it; the colonnade's
//   columns with bases and volute capitals on a porch up a flight of steps; skylights on the flat roof;
// - the wing: pale limestone panels in a grid of joints, a full-height glass front along S University with the upper
//   floors cantilevered out over the walk as a stone box with a long window, its rounded glass corner to the east,
//   ribbons of windows elsewhere, a thin metal coping.
const MA_LIME = [0.86, 0.83, 0.76];
const MA_LIME_DARK = [0.74, 0.71, 0.64];
const MA_PANEL = [0.83, 0.82, 0.78];
const MA_JOINT = [0.66, 0.65, 0.62];
const MA_MULLION = [0.22, 0.23, 0.24];
const MA_ROOF = [0.42, 0.42, 0.43];
function museumOfArt(B, T) {
  const s = surveyAt(705, 450);
  if (!s) return null;
  const K = ktTools(B, T);
  const g = groundOf(s.ring) - 0.3, Y = (y) => g + y;
  // Alumni Memorial Hall: the north pavilion, the middle block behind the colonnade, the south pavilion
  const hall = [
    [678, 417.5, 713, 417.2, 713, 433.3, 678.5, 433.5],
    [696.5, 433.3, 713, 433.3, 713, 455, 696.5, 455],
    [681.5, 455, 713, 455, 713, 471, 677.6, 471, 677.5, 464, 681.6, 464]
  ];
  // the Frankel Wing: along S University with its rounded corner, and the strip on the north-east
  const wing = [
    [677.6, 471, 713, 471, 713, 456.5, 719.5, 456.5, 719.5, 466, 724, 467, 726, 469, 726.5, 472, 726, 476, 724, 477.5, 719, 478.5,
      719, 489.5, 684.5, 489.5, 684.5, 481, 678, 481.5],
    [713, 417.2, 738.5, 417, 739, 430.5, 713, 431]
  ];
  // a point a metre in front of a wall: is it inside another part of the museum?
  const parts = [...hall, ...wing];
  const polys = parts.map((p) => ({ ring: p, poly: { outer: ringPts(p), holes: [] } }));
  const inside = (x, z, own) => polys.some(({ ring, poly }) => ring !== own && polygonContains(poly, x, z));
  const H = 13.6, ATTIC = 15.2;
  // a window in a moulded stone surround
  const surround = (e, u, y0, y1, w, hood) => {
    K.face(e, u - w / 2, u + w / 2, Y(y0), Y(y1), 0.02, GLASS, B.glass);
    T.ebox(e, u - w / 2 - 0.25, u - w / 2, Y(y0 - 0.1), Y(y1 + 0.1), 0, 0.1, MA_LIME_DARK);
    T.ebox(e, u + w / 2, u + w / 2 + 0.25, Y(y0 - 0.1), Y(y1 + 0.1), 0, 0.1, MA_LIME_DARK);
    T.ebox(e, u - w / 2 - 0.25, u + w / 2 + 0.25, Y(y1), Y(y1 + 0.3), 0, 0.1, MA_LIME_DARK);
    T.ebox(e, u - w / 2 - 0.35, u + w / 2 + 0.35, Y(y0 - 0.3), Y(y0 - 0.1), 0, 0.2, MA_LIME_DARK);
    K.face(e, u - 0.04, u + 0.04, Y(y0), Y(y1), 0.05, MA_MULLION);
    K.face(e, u - w / 2, u + w / 2, Y(y0 + (y1 - y0) * 0.62), Y(y0 + (y1 - y0) * 0.62 + 0.07), 0.05, MA_MULLION);
    if (hood) {
      T.ebox(e, u - w / 2 - 0.5, u + w / 2 + 0.5, Y(y1 + 0.35), Y(y1 + 0.6), 0, 0.4, MA_LIME);
      for (const du of [-w / 2 - 0.4, w / 2 + 0.25]) T.ebox(e, u + du, u + du + 0.15, Y(y1 - 0.2), Y(y1 + 0.35), 0, 0.3, MA_LIME_DARK);
    } else {
      T.ebox(e, u - 0.25, u + 0.25, Y(y1 - 0.1), Y(y1 + 0.45), 0, 0.18, MA_LIME);
    }
  };
  for (const ring of hall) {
    B.prism(ring, g - 2, Y(1.4), MA_LIME_DARK);
    B.prism(ring, Y(H) - 0.05, Y(H), MA_ROOF);
    for (const e of edgesOf(ring)) {
      const front = (u) => !inside(e.ax + e.tx * u + e.nx * 0.8, e.az + e.tz * u + e.nz * 0.8, ring);
      if (!front(e.L / 2)) continue;
      K.face(e, 0, e.L, Y(1.4), Y(H), 0.01, MA_LIME);
      // the base's bands, the floor band, the entablature: architrave, frieze, dentils and the cornice
      for (let y = 0.45; y < 1.4; y += 0.45) K.face(e, 0, e.L, Y(y), Y(y + 0.05), 0.012, MA_JOINT);
      T.ebox(e, -0.05, e.L + 0.05, Y(1.3), Y(1.55), 0, 0.2, MA_LIME_DARK);
      T.ebox(e, -0.05, e.L + 0.05, Y(6.3), Y(6.6), 0, 0.15, MA_LIME_DARK);
      T.ebox(e, -0.1, e.L + 0.1, Y(11.9), Y(12.4), 0, 0.2, MA_LIME_DARK);
      for (let u = 0.2; u < e.L - 0.1; u += 0.5) T.ebox(e, u - 0.1, u + 0.1, Y(12.95), Y(13.15), 0, 0.3, MA_LIME_DARK);
      T.ebox(e, -0.4, e.L + 0.4, Y(13.15), Y(13.6), 0, 0.65, MA_LIME);
      // the balustrade: a plinth, balusters, a rail, pedestals at the ends
      T.ebox(e, 0, e.L, Y(H), Y(H + 0.3), -0.1, 0.25, MA_LIME_DARK);
      for (let u = 0.6; u < e.L - 0.5; u += 0.42) T.ebox(e, u - 0.08, u + 0.08, Y(H + 0.3), Y(ATTIC - 0.2), 0.02, 0.18, MA_LIME);
      T.ebox(e, -0.1, e.L + 0.1, Y(ATTIC - 0.2), Y(ATTIC), -0.12, 0.28, MA_LIME_DARK);
      for (const u of [0.2, e.L - 0.2]) T.ebox(e, u - 0.4, u + 0.4, Y(H), Y(ATTIC + 0.15), -0.1, 0.3, MA_LIME);
      if (e.L < 4) continue;
      // the windows in their surrounds
      const n = Math.max(1, Math.floor(e.L / 4.2)), w = e.L / n;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) * w;
        if (!front(u)) continue;
        surround(e, u, 2.4, 5.3, 1.7, true);
        surround(e, u, 7.4, 11.0, 1.7, false);
      }
    }
  }
  // the colonnade in the recess facing State St: a porch up the steps, six Ionic columns, the entablature over them
  const recess = edgesOf(hall[1]).find((e) => e.nx < -0.8);
  if (recess) {
    const e = recess, c = e.L / 2, span = e.L - 3;
    T.ebox(e, -1.5, e.L + 1.5, g - 1, Y(1.4), 0, 4.6, MA_LIME_DARK);
    for (let k = 0; k < 4; k++) T.ebox(e, c - span / 2 - 1, c + span / 2 + 1, g - 1, Y(1.4 - 0.35 * (k + 1)), 4.6, 5.0 + k * 0.42, MA_LIME_DARK);
    for (let k = 0; k < 6; k++) {
      const u = c - span / 2 + (k * span) / 5;
      T.ebox(e, u - 0.65, u + 0.65, Y(1.4), Y(1.75), 2.35, 3.65, MA_LIME_DARK);
      T.ebox(e, u - 0.55, u + 0.55, Y(1.75), Y(2.0), 2.45, 3.55, MA_LIME);
      T.ecolumn(e, u, Y(2.0), Y(10.9), 0.48, 3, MA_LIME);
      // the capital: an echinus, the volutes either side, the abacus
      T.ebox(e, u - 0.55, u + 0.55, Y(10.9), Y(11.25), 2.45, 3.55, MA_LIME_DARK);
      for (const sg of [-1, 1]) T.ebox(e, u + sg * 0.62 - 0.14, u + sg * 0.62 + 0.14, Y(10.75), Y(11.25), 2.4, 3.6, MA_LIME);
      T.ebox(e, u - 0.7, u + 0.7, Y(11.25), Y(11.45), 2.3, 3.7, MA_LIME);
    }
    T.ebox(e, -0.5, e.L + 0.5, Y(11.45), Y(12.95), 0, 3.85, MA_LIME);
    for (let u = 0; u < e.L; u += 0.5) T.ebox(e, u - 0.1, u + 0.1, Y(12.95), Y(13.15), 3.6, 4.0, MA_LIME_DARK);
    T.ebox(e, -0.5, e.L + 0.5, Y(13.15), Y(13.6), 0, 4.3, MA_LIME);
    T.ebox(e, -0.5, e.L + 0.5, Y(H), Y(ATTIC + 0.4), 3.2, 3.9, MA_LIME);
    // the three doors behind the columns
    for (const du of [-4, 0, 4]) {
      K.face(e, c + du - 1.1, c + du + 1.1, Y(1.4), Y(5.4), 0.03, [0.24, 0.18, 0.11]);
      K.face(e, c + du - 1.1, c + du + 1.1, Y(5.6), Y(7.2), 0.03, GLASS, B.glass);
      T.ebox(e, c + du - 1.4, c + du + 1.4, Y(5.4), Y(5.6), 0, 0.25, MA_LIME_DARK);
    }
  }
  // skylights over the galleries
  for (const [x0, x1, z0, z1] of [[684, 708, 421, 430], [684, 708, 459, 468], [700, 710, 437, 452]]) {
    B.box(x0, x1, Y(H), Y(H + 0.6), z0, z1, MA_LIME_DARK);
    B.hip(x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2, Y(H + 0.6), Y(H + 2.0), [0.55, 0.6, 0.62]);
    for (let x = x0 + 1.5; x < x1 - 1; x += 1.5) K.beam([x, Y(H + 0.62), z0 + 0.2], [x, Y(H + 2.0), (z0 + z1) / 2], 0.06, MA_MULLION);
  }

  // the Frankel Wing
  const FH = 15.2;
  for (const ring of wing) {
    B.prism(ring, g - 2, Y(0.3), MA_LIME_DARK);
    B.prism(ring, Y(FH) - 0.05, Y(FH), MA_ROOF);
    for (const e of edgesOf(ring)) {
      const free = (u) => !inside(e.ax + e.tx * u + e.nx * 0.8, e.az + e.tz * u + e.nz * 0.8, ring);
      if (!free(e.L / 2)) continue;
      T.ebox(e, -0.05, e.L + 0.05, Y(FH), Y(FH + 0.25), -0.1, 0.12, [0.55, 0.56, 0.57]);
      const south = e.nz > 0.8 && e.L > 20, curved = e.L < 5.5;
      if (curved) {
        // the rounded corner: glass all the way up between slim fins
        K.face(e, 0, e.L, Y(0.3), Y(FH), 0.01, GLASS, B.glass);
        T.ebox(e, 0, 0.08, Y(0.3), Y(FH), 0, 0.3, MA_MULLION);
        for (const y of [4.8, 9.8]) T.ebox(e, 0, e.L, Y(y), Y(y + 0.25), 0, 0.2, MA_PANEL);
        continue;
      }
      if (south) {
        // the glass front at the foot, the cantilevered stone box over it with its long window
        K.face(e, 0.5, e.L - 0.5, Y(0.3), Y(5.0), 0.01, GLASS, B.glass);
        for (let u = 0.5; u <= e.L - 0.49; u += 1.6) T.ebox(e, u - 0.05, u + 0.05, Y(0.3), Y(5.0), 0, 0.12, MA_MULLION);
        T.ebox(e, 0.5, e.L - 0.5, Y(2.9), Y(3.0), 0, 0.12, MA_MULLION);
        const out = 3.2;
        T.ebox(e, 2, e.L - 6, Y(5.0), Y(FH - 0.2), 0, out, MA_PANEL);
        for (let y = 6.5; y < FH - 0.5; y += 1.5) K.face(e, 2, e.L - 6, Y(y), Y(y + 0.04), out + 0.01, MA_JOINT);
        for (let u = 2 + 3; u < e.L - 6; u += 3) K.face(e, u, u + 0.04, Y(5.0), Y(FH - 0.2), out + 0.01, MA_JOINT);
        K.face(e, 4, e.L - 8, Y(8.6), Y(11.0), out + 0.02, GLASS, B.glass);
        for (let u = 4; u <= e.L - 7.99; u += 2) T.ebox(e, u - 0.05, u + 0.05, Y(8.6), Y(11.0), out, out + 0.1, MA_MULLION);
        K.face(e, 0, e.L, Y(5.0), Y(FH), 0.01, MA_PANEL);
        continue;
      }
      // elsewhere: stone panels in their grid, ribbons of windows on the upper floors
      K.face(e, 0, e.L, Y(0.3), Y(FH), 0.01, MA_PANEL);
      for (let y = 1.8; y < FH; y += 1.5) K.face(e, 0, e.L, Y(y), Y(y + 0.04), 0.015, MA_JOINT);
      for (let u = 3; u < e.L; u += 3) K.face(e, u, u + 0.04, Y(0.3), Y(FH), 0.015, MA_JOINT);
      if (e.L > 6) {
        for (const [y0, y1] of [[1.0, 3.8], [6.2, 8.4], [10.6, 12.8]]) {
          if (y0 < 2 && e.nz < 0.5) continue; // the street doors and windows only toward S University
          K.face(e, 1.2, e.L - 1.2, Y(y0), Y(y1), 0.03, GLASS, B.glass);
          for (let u = 1.2; u <= e.L - 1.19; u += 1.8) T.ebox(e, u - 0.04, u + 0.04, Y(y0), Y(y1), 0.02, 0.1, MA_MULLION);
        }
      }
    }
  }
  return { s, maxY: Y(ATTIC + 0.4) };
}
const ringPts = (r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push({ x: r[i], z: r[i + 1] }); return out; };

function hatcher(B, T) {
  const front = surveyAt(840, 365), stacks = surveyAt(840, 410);
  if (!front) return null;
  const r = front.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  B.prism(r, g - 2, Y(1.6), LIME_DARK);
  T.walls(r, Y(1.6), Y(15.6), BRICK_BUFF);
  B.ringWindows(r, [[2.8, 5.4], [6.8, 9.6], [11, 13.6]], 3.4, 1.5, GLASS, 0.03, g);
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
    B.ringWindows(q, rows, 2.4, 0.7, GLASS, 0.03, g);
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

// Kerrytown Market & Shops: three old brick commercial buildings on the block between N Fourth and N Fifth Aves south
// of E Kingsley, joined into one market of shops in 1969, each still its own height and brick, round a small courtyard,
// with the Farmers Market's sheds against its south side. On the survey's three outlines (found by a point inside each):
// - the corner building at Kingsley and Fifth: two storeys of red brick under a slate gable that runs along Kingsley,
//   its gable end to Fifth Ave;
// - the Fifth Ave building south of the courtyard: three storeys of warm orange-red brick under a corbelled parapet,
//   the Kerrytown Chime's little open timber belfry on its roof by Fifth;
// - the Fourth Ave building by the market: three tall storeys of darker brown brick, plain, its flat parapet higher.
// Segmental-arched windows (a shallow brick arch over each, a stone sill under) a floor at a time; wood-and-glass
// shopfronts with their doors along the streets (Fifth, and the sides toward the market and Detroit St; no awnings);
// back walls plainer, with fewer windows; and wooden loading-dock decks under shed roofs on posts facing each other
// across the courtyard, with steps down. The brick is brickMaterial's courses; the glass is the landmarks' (lit at night).
const KT_BRICK = { corner: [0.5, 0.25, 0.19], fifth: [0.6, 0.35, 0.24], fourth: [0.4, 0.26, 0.2] };
const KT_ARCH = [0.36, 0.17, 0.13];
const KT_STONE = [0.7, 0.66, 0.58];
const KT_BASE = [0.46, 0.43, 0.39];
const KT_WOOD = [[0.12, 0.22, 0.16], [0.3, 0.1, 0.08], [0.15, 0.11, 0.08], [0.1, 0.17, 0.2]];
const KT_SASH = [0.86, 0.83, 0.74];
const KT_DECK = [0.42, 0.31, 0.21];
const KT_DECK_DARK = [0.3, 0.22, 0.15];
const KT_TIMBER = [0.55, 0.47, 0.37];
const KT_BELL = [0.3, 0.22, 0.12];
const KT_GOLD = [0.7, 0.56, 0.26];
function ktTools(B, T) {
  // a point on a wall: u along it, y up, d out from it
  const P = (e, u, y, d) => [e.ax + e.tx * u + e.nx * d, y, e.az + e.tz * u + e.nz * d];
  // one face on a wall, facing out
  const face = (e, u0, u1, y0, y1, d, col, m = B.stone) => B.quad(m, P(e, u0, y0, d), P(e, u1, y0, d), P(e, u1, y1, d), P(e, u0, y1, d), col);
  // a square beam from p to q, s thick (its four sides)
  const beam = (p, q, s, col, m = B.stone) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz) || 1;
    const t = [dx / L, dy / L, dz / L];
    const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let u = cr(t, up); const ul = Math.hypot(...u); u = u.map((v) => (v / ul) * s / 2);
    let v = cr(t, u); const vl = Math.hypot(...v); v = v.map((w) => (w / vl) * s / 2);
    const c = (o, a, b) => [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]];
    const n = (a) => a.map((w) => -w);
    const k = [[u, v], [n(u), v], [n(u), n(v)], [u, n(v)]];
    for (let i = 0; i < 4; i++) {
      const [a1, b1] = k[i], [a2, b2] = k[(i + 1) % 4];
      B.quad(m, c(p, a1, b1), c(p, a2, b2), c(q, a2, b2), c(q, a1, b1), col);
    }
  };
  // a segmental-arched window: glass from y0 up to y1 and a shallow arch `rise` over that, a rowlock arch of darker
  // brick round its head, a stone sill, pale sash frames and a meeting rail
  const segWin = (e, u, y0, y1, w, rise = 0.3, sash = KT_SASH) => {
    const h = rise, R = (w * w / 4 + h * h) / (2 * h), cy = y1 + h - R, phi = Math.asin(Math.min(1, w / 2 / R)), n = 5;
    const arc = (k, r) => { const a = -phi * 1.12 + (k / n) * phi * 2.24; return [u + Math.sin(a) * r, cy + Math.cos(a) * r]; };
    face(e, u - w / 2, u + w / 2, y0, y1, 0.02, GLASS, B.glass);
    for (let k = 0; k < n; k++) {
      const a0 = -phi + (k / n) * phi * 2, a1 = -phi + ((k + 1) / n) * phi * 2;
      B.tri(B.glass, P(e, u, y1, 0.02), P(e, u + Math.sin(a0) * R, cy + Math.cos(a0) * R, 0.02), P(e, u + Math.sin(a1) * R, cy + Math.cos(a1) * R, 0.02), GLASS);
      const [p0u, p0y] = arc(k, R + 0.02), [p1u, p1y] = arc(k + 1, R + 0.02), [q0u, q0y] = arc(k, R + 0.3), [q1u, q1y] = arc(k + 1, R + 0.3);
      B.quad(B.brick, P(e, p0u, p0y, 0.035), P(e, p1u, p1y, 0.035), P(e, q1u, q1y, 0.035), P(e, q0u, q0y, 0.035), KT_ARCH);
    }
    T.ebox(e, u - w / 2 - 0.12, u + w / 2 + 0.12, y0 - 0.16, y0, 0, 0.14, KT_STONE);
    face(e, u - w / 2, u - w / 2 + 0.08, y0, y1, 0.04, sash);
    face(e, u + w / 2 - 0.08, u + w / 2, y0, y1, 0.04, sash);
    face(e, u - w / 2, u + w / 2, (y0 + y1) / 2 - 0.04, (y0 + y1) / 2 + 0.04, 0.04, sash);
    face(e, u - w / 2, u + w / 2, y1 - 0.06, y1, 0.04, sash);
  };
  // a wood-and-glass shopfront from u0 to u1 over a wall's ground y: bays of a panelled bulkhead, a big pane, a
  // transom of small lights and a sign band under a cornice, wood pilasters between, and a door in each bay, its own
  // colours per bay
  const shopfront = (e, u0, u1, y, k0 = 0) => {
    const n = Math.max(1, Math.round((u1 - u0) / 6)), bw = (u1 - u0) / n;
    for (let i = 0; i < n; i++) {
      const a = u0 + i * bw, b = a + bw, wood = KT_WOOD[(k0 + i) % KT_WOOD.length];
      const door = i % 2 ? a + 0.5 : b - 1.6; // the door at alternate ends, so pairs of shops share a pier
      T.ebox(e, a, a + 0.4, y, y + 4.3, 0, 0.22, wood);
      if (i === n - 1) T.ebox(e, b - 0.4, b, y, y + 4.3, 0, 0.22, wood);
      // the bulkhead and its panel, either side of the door
      for (const [p, q] of [[a + 0.4, door], [door + 1.1, b - (i === n - 1 ? 0.4 : 0)]]) {
        if (q - p < 0.3) continue;
        T.ebox(e, p, q, y, y + 0.75, 0, 0.12, wood);
        face(e, p + 0.15, q - 0.15, y + 0.15, y + 0.6, 0.13, KT_WOOD[(k0 + i + 2) % KT_WOOD.length]);
        face(e, p, q, y + 0.75, y + 3.1, 0.03, GLASS, B.glass);
        face(e, (p + q) / 2 - 0.04, (p + q) / 2 + 0.04, y + 0.75, y + 3.1, 0.06, wood);
      }
      // the door: glass over a wood panel, in a wood frame, a stone step
      face(e, door, door + 1.1, y + 1.0, y + 2.75, 0.02, GLASS, B.glass);
      face(e, door, door + 1.1, y, y + 1.0, 0.025, wood);
      T.ebox(e, door - 0.08, door, y, y + 3.1, 0, 0.1, wood);
      T.ebox(e, door + 1.1, door + 1.18, y, y + 3.1, 0, 0.1, wood);
      T.ebox(e, door - 0.1, door + 1.2, y - 0.3, y, 0, 0.45, KT_STONE);
      // the transom's small lights and the sign band under a moulded cornice
      face(e, a + 0.4, b, y + 3.25, y + 3.75, 0.03, GLASS, B.glass);
      T.ebox(e, a + 0.4, b, y + 3.1, y + 3.25, 0, 0.12, wood);
      for (let u = a + 1.2; u < b - 0.3; u += 0.8) face(e, u - 0.03, u + 0.03, y + 3.25, y + 3.75, 0.05, wood);
      T.ebox(e, a, b, y + 3.75, y + 4.35, 0, 0.16, wood);
      T.ebox(e, a - 0.05, b + 0.05, y + 4.35, y + 4.5, 0, 0.3, wood);
    }
  };
  return { P, face, beam, segWin, shopfront };
}

// is (x, z) inside one of the survey's buildings other than `self` (the market's open sheds aside)?
function otherBuildingAt(x, z, self, open) {
  for (const b of REAL_BUILDINGS) {
    if (b === self || b === open || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    for (const p of b.polygons) if (polygonContains(p, x, z)) return true;
  }
  return false;
}

function kerrytown(B, T) {
  const K = ktTools(B, T), { face, beam, segWin, shopfront } = K;
  const out = [];
  // the street walls (shops along them) by the way they face: Fifth Ave east, Kingsley north, the market south,
  // Fourth Ave west
  const facing = (e, dx, dz) => e.nx * dx + e.nz * dz > 0.8;
  const market = surveyAt(168, -470)?.b;
  const building = ({ at, brick, floors, H, roof, shops, front }) => {
    const s = surveyAt(at[0], at[1]);
    if (!s) return null;
    const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
    const roofY = roof === 'gable' ? H : H - 0.9;
    B.prism(r, g - 2, Y(0.5), KT_BASE);
    // the walls: a stone base, then brick to the roof (a parapet's inner face over a flat roof), the roof itself
    B.prism(r, Y(roofY) - 0.05, Y(roofY), [0.25, 0.25, 0.27]);
    for (const e of edgesOf(r)) {
      face(e, 0, e.L, Y(0.5), Y(H), 0.012, brick, B.brick);
      if (roof !== 'gable') face(e, e.L, 0, Y(roofY), Y(H), -0.3, brick, B.brick);
      // the ground under this wall (the ground floor's doors and shopfronts stand on it)
      const gw = Math.min(groundHeight(e.ax, e.az), groundHeight(e.ax + e.tx * e.L, e.az + e.tz * e.L)) - 0.3;
      const lift = Math.min(Math.max(0, gw - g), floors[0][0] - 0.2);
      const street = shops.some(([dx, dz]) => facing(e, dx, dz));
      const back = !street && !front.some(([dx, dz]) => facing(e, dx, dz));
      // a party wall or one a metre from its neighbour gets no windows
      const free = (u) => !otherBuildingAt(e.ax + e.tx * u + e.nx * 1.2, e.az + e.tz * u + e.nz * 1.2, s.b, market);
      if (e.L < 2.6) continue;
      // the shopfronts, then each floor's windows
      if (street && e.L > 5.5 && free(e.L / 2)) shopfront(e, 0.6, e.L - 0.6, Y(lift + 0.15), Math.round(e.ax));
      const pitch = back ? 4.2 : 2.9;
      const n = Math.max(1, Math.floor((e.L - 1.2) / pitch)), off = (e.L - n * pitch) / 2 + pitch / 2;
      for (let f = 0; f < floors.length; f++) {
        if (f === 0 && street && e.L > 5.5) continue;
        const [y0, y1, w] = floors[f];
        for (let k = 0; k < n; k++) {
          const u = off + k * pitch;
          if (!free(u)) continue;
          // the back's ground floor: every other window, a plain door at its middle
          if (f === 0 && back && k % 2) continue;
          segWin(e, u, Y(y0 + (f === 0 ? lift : 0)), Y(y1 + (f === 0 ? lift : 0)), w);
        }
      }
      // the stone base course and a stone belt course over the ground floor
      T.ebox(e, 0, e.L, Y(0.4), Y(0.6), 0, 0.06, KT_STONE);
      if (roof !== 'gable') {
        // a corbelled brick cornice: two stepped courses over a row of dentils, under a stone coping
        T.ebox(e, -0.05, e.L + 0.05, Y(H - 1.05), Y(H - 0.9), 0, 0.09, brick, B.brick);
        T.ebox(e, -0.1, e.L + 0.1, Y(H - 0.9), Y(H - 0.7), 0, 0.18, brick, B.brick);
        for (let u = 0.3; u < e.L - 0.2; u += 0.55) T.ebox(e, u - 0.12, u + 0.12, Y(H - 1.4), Y(H - 1.05), 0, 0.1, brick, B.brick);
        T.ebox(e, -0.1, e.L + 0.1, Y(H), Y(H + 0.15), -0.35, 0.1, KT_STONE);
      } else {
        T.ebox(e, -0.1, e.L + 0.1, Y(H - 0.35), Y(H), 0, 0.14, KT_STONE);
      }
    }
    return { s, r, g, Y, roofY };
  };

  // the corner building at Kingsley and Fifth
  const A = building({ at: [175, -556], brick: KT_BRICK.corner, H: 8.2, roof: 'gable', front: [[0, 1], [0, -1]],
    floors: [[1.0, 3.6, 1.5], [5.0, 7.0, 1.2]], shops: [[1, 0]] });
  if (A) {
    const { r, Y, s } = A;
    // its slate gable along Kingsley: the ridge between the middles of the two short walls, the eaves out over the
    // long ones, a brick gable end at each short wall (Fifth Ave's with a round window) under a stone rake
    const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
    let i0 = 0, best = 0;
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length, L = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]); if (L > best) { best = L; i0 = i; } }
    const c = (k) => pts[(i0 + k) % pts.length];
    const a0 = c(0), a1 = c(1), b1 = c(2), b0 = c(3);
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const m0 = mid(a0, b0), m1 = mid(a1, b1);
    const eaveY = Y(8.2), ridgeY = Y(12.6), o = 0.45;
    const away = (p, m, d) => { const dx = p[0] - m[0], dz = p[1] - m[1], l = Math.hypot(dx, dz); return [p[0] + (dx / l) * d, p[1] + (dz / l) * d]; };
    const ext = (p, q, d) => { const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz); return [p[0] + (dx / l) * d, p[1] + (dz / l) * d]; };
    // eave corners out by `o` from the walls and past the gable ends by 0.3
    const A0 = ext(away(a0, m0, o), a1, 0.3), A1 = ext(away(a1, m1, o), a0, 0.3), B0 = ext(away(b0, m0, o), b1, 0.3), B1 = ext(away(b1, m1, o), b0, 0.3);
    const R0 = ext(m0, m1, 0.3), R1 = ext(m1, m0, 0.3);
    const dropY = eaveY - o * (ridgeY - eaveY) / Math.hypot(a0[0] - m0[0], a0[1] - m0[1]);
    const v = (p, y) => [p[0], y, p[1]];
    B.quad(B.stone, v(A0, dropY), v(A1, dropY), v(R1, ridgeY), v(R0, ridgeY), SLATE);
    B.quad(B.stone, v(B1, dropY), v(B0, dropY), v(R0, ridgeY), v(R1, ridgeY), SLATE);
    // the fascia boards and the ridge's cap
    beam(v(A0, dropY - 0.1), v(A1, dropY - 0.1), 0.22, KT_STONE);
    beam(v(B0, dropY - 0.1), v(B1, dropY - 0.1), 0.22, KT_STONE);
    beam(v(R0, ridgeY + 0.05), v(R1, ridgeY + 0.05), 0.2, [0.2, 0.2, 0.22]);
    for (const [p, q, m] of [[a0, b0, m0], [a1, b1, m1]]) {
      B.tri(B.brick, v(p, eaveY), v(q, eaveY), v(m, ridgeY - 0.05), KT_BRICK.corner);
      beam(v(p, eaveY + 0.1), v(m, ridgeY + 0.15), 0.3, KT_STONE);
      beam(v(q, eaveY + 0.1), v(m, ridgeY + 0.15), 0.3, KT_STONE);
    }
    // a round window in the gable end on Fifth Ave (the short wall facing east)
    const gableEnd = edgesOf(r).find((e) => e.nx > 0.8);
    if (gableEnd) {
      const u = gableEnd.L / 2, cy = Y(10.0);
      for (let k = 0; k < 12; k++) {
        const t0 = (k / 12) * Math.PI * 2, t1 = ((k + 1) / 12) * Math.PI * 2;
        B.tri(B.glass, K.P(gableEnd, u, cy, 0.03), K.P(gableEnd, u + Math.cos(t0) * 0.75, cy + Math.sin(t0) * 0.75, 0.03), K.P(gableEnd, u + Math.cos(t1) * 0.75, cy + Math.sin(t1) * 0.75, 0.03), GLASS);
        B.quad(B.stone, K.P(gableEnd, u + Math.cos(t0) * 0.75, cy + Math.sin(t0) * 0.75, 0.05), K.P(gableEnd, u + Math.cos(t1) * 0.75, cy + Math.sin(t1) * 0.75, 0.05),
          K.P(gableEnd, u + Math.cos(t1) * 0.98, cy + Math.sin(t1) * 0.98, 0.05), K.P(gableEnd, u + Math.cos(t0) * 0.98, cy + Math.sin(t0) * 0.98, 0.05), KT_STONE);
      }
    }
    // two brick chimneys on the ridge
    for (const t of [0.25, 0.7]) {
      const x = m0[0] + (m1[0] - m0[0]) * t, z = m0[1] + (m1[1] - m0[1]) * t;
      B.box(x - 0.45, x + 0.45, ridgeY - 1.5, ridgeY + 1.3, z - 0.45, z + 0.45, KT_BRICK.corner);
      B.box(x - 0.55, x + 0.55, ridgeY + 1.3, ridgeY + 1.45, z - 0.55, z + 0.55, KT_STONE);
    }
    out.push({ s, maxY: ridgeY, decks: [] });
  }

  // the Fifth Ave building, south of the courtyard
  const C = building({ at: [175, -526], brick: KT_BRICK.fifth, H: 11.4, roof: 'flat', front: [[0, -1]],
    floors: [[1.0, 3.7, 1.5], [5.0, 7.1, 1.25], [8.3, 10.0, 1.25]], shops: [[1, 0], [0, 1]] });
  if (C) {
    const { r, Y, s, roofY } = C;
    // the Kerrytown Chime's belfry by Fifth Ave: four timber posts over a railed deck, a pyramid roof on them, a
    // finial, and its bells hung in the open
    const cx = 190.5, cz = -527, hw = 1.5, y0 = Y(roofY), y1 = y0 + 3.6;
    B.box(cx - hw - 0.2, cx + hw + 0.2, y0, y0 + 0.4, cz - hw - 0.2, cz + hw + 0.2, KT_TIMBER);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam([cx + sx * hw, y0 + 0.4, cz + sz * hw], [cx + sx * hw, y1, cz + sz * hw], 0.24, KT_TIMBER);
    for (const [p, q] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) {
      beam([cx + p[0] * hw, y0 + 1.3, cz + p[1] * hw], [cx + q[0] * hw, y0 + 1.3, cz + q[1] * hw], 0.12, KT_TIMBER);
      beam([cx + p[0] * hw, y1 - 0.1, cz + p[1] * hw], [cx + q[0] * hw, y1 - 0.1, cz + q[1] * hw], 0.2, KT_TIMBER);
      // a cross brace under each side's head
      beam([cx + p[0] * hw, y1 - 0.9, cz + p[1] * hw], [cx + (p[0] + q[0]) / 2 * hw, y1 - 0.1, cz + (p[1] + q[1]) / 2 * hw], 0.1, KT_TIMBER);
      beam([cx + q[0] * hw, y1 - 0.9, cz + q[1] * hw], [cx + (p[0] + q[0]) / 2 * hw, y1 - 0.1, cz + (p[1] + q[1]) / 2 * hw], 0.1, KT_TIMBER);
    }
    B.hip(cx - hw - 0.45, cx + hw + 0.45, cz - hw - 0.45, cz + hw + 0.45, y1, y1 + 2.2, [0.32, 0.5, 0.44]);
    beam([cx, y1 + 2.1, cz], [cx, y1 + 3.1, cz], 0.08, KT_GOLD);
    // the bells, smaller down the frame
    for (const [bx, bz, br] of [[-0.6, -0.5, 0.42], [0.55, -0.45, 0.36], [0, 0.55, 0.3], [-0.55, 0.5, 0.25], [0.6, 0.6, 0.22]]) {
      const top = y1 - 0.3, ring = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring.push(cx + bx + Math.cos(a) * br, cz + bz + Math.sin(a) * br); }
      B.prism(ring, top - br * 1.6, top - br * 1.5, KT_BELL);
      for (let k = 0; k < 8; k++) {
        const j = (k + 1) % 8;
        B.quad(B.stone, [ring[k * 2], top - br * 1.5, ring[k * 2 + 1]], [ring[j * 2], top - br * 1.5, ring[j * 2 + 1]],
          [cx + bx + (ring[j * 2] - cx - bx) * 0.55, top, cz + bz + (ring[j * 2 + 1] - cz - bz) * 0.55],
          [cx + bx + (ring[k * 2] - cx - bx) * 0.55, top, cz + bz + (ring[k * 2 + 1] - cz - bz) * 0.55], KT_BELL);
      }
      beam([cx + bx, top, cz + bz], [cx + bx, y1 - 0.1, cz + bz], 0.05, [0.1, 0.1, 0.1]);
    }
    // rooftop units and a roof hatch, back from Fifth
    B.box(162, 165.5, Y(roofY), Y(roofY + 1.5), -531, -528.5, [0.6, 0.61, 0.61]);
    B.box(170, 172, Y(roofY), Y(roofY + 1.0), -523, -521, [0.55, 0.56, 0.56]);
    // its roof is the parapet's height; the belfry a solid of its own on it
    out.push({ s, maxY: Y(11.55), decks: [{ minX: cx - hw - 0.45, maxX: cx + hw + 0.45, minZ: cz - hw - 0.45, maxZ: cz + hw + 0.45,
      minY: y0, maxY: y1 + 2.2, keepsSurvey: true }] });
  }

  // the Fourth Ave building, by the market
  const D = building({ at: [130, -516], brick: KT_BRICK.fourth, H: 12.6, roof: 'flat', front: [[-1, 0]],
    floors: [[1.1, 3.9, 1.5], [5.4, 7.6, 1.3], [9.0, 11.0, 1.3]], shops: [[0, 1]] });
  if (D) {
    const { s, Y, r, roofY } = D;
    // its entrance on Fourth Ave: a door under a transom and a stone lintel
    const w = edgesOf(r).find((e) => e.nx < -0.8);
    if (w) {
      const u = w.L / 2;
      face(w, u - 0.9, u + 0.9, Y(0.5), Y(2.9), 0.02, GLASS, B.glass);
      face(w, u - 0.9, u + 0.9, Y(3.0), Y(3.6), 0.02, GLASS, B.glass);
      T.ebox(w, u - 1.05, u - 0.9, Y(0.5), Y(3.6), 0, 0.12, KT_WOOD[0]);
      T.ebox(w, u + 0.9, u + 1.05, Y(0.5), Y(3.6), 0, 0.12, KT_WOOD[0]);
      T.ebox(w, u - 0.9, u + 0.9, Y(2.9), Y(3.0), 0, 0.12, KT_WOOD[0]);
      T.ebox(w, u - 1.3, u + 1.3, Y(3.6), Y(3.95), 0, 0.2, KT_STONE);
      T.ebox(w, u - 1.4, u + 1.4, Y(0) - 0.3, Y(0.5), 0, 1.2, KT_STONE);
    }
    B.box(125, 128, Y(roofY), Y(roofY + 1.6), -520, -517.5, [0.6, 0.61, 0.61]);
    out.push({ s, maxY: Y(12.75), decks: [] });
  }

  // the loading-dock decks: wood on posts a metre up, a shed roof over them on posts, steps down at one end; solid to
  // walk into (a jump gets up on them), the posts left open
  const deck = (x0, x1, z0, z1, wallZ, gY, stepsAt, high = 0.95) => {
    const top = gY + high, out2 = wallZ < (z0 + z1) / 2 ? 1 : -1; // which way is away from the wall
    B.box(x0, x1, top - 0.12, top, z0, z1, KT_DECK);
    for (let x = x0; x < x1 + 0.01; x += 0.45) B.box(x - 0.01, x + 0.01, top, top + 0.005, z0, z1, KT_DECK_DARK);
    B.box(x0, x1, gY - 0.3, top - 0.12, out2 > 0 ? z1 - 0.08 : z0, out2 > 0 ? z1 : z0 + 0.08, KT_DECK_DARK);
    const outer = out2 > 0 ? z1 : z0, inner = out2 > 0 ? z0 : z1;
    const roofIn = gY + 4.75, roofOut = gY + 3.95;
    for (let x = x0 + 0.2; x <= x1 - 0.19; x += Math.max(2.5, (x1 - x0 - 0.4) / Math.round((x1 - x0 - 0.4) / 3))) {
      beam([x, gY - 0.3, outer - out2 * 0.15], [x, roofOut, outer - out2 * 0.15], 0.18, KT_DECK);
      // a railing between the posts
      beam([x, top + 0.95, outer - out2 * 0.15], [Math.min(x1 - 0.2, x + 3), top + 0.95, outer - out2 * 0.15], 0.07, KT_DECK);
    }
    // the shed roof: corrugated metal from the wall out past the posts
    B.quad(B.stone, [x0 - 0.3, roofIn, inner], [x1 + 0.3, roofIn, inner], [x1 + 0.3, roofOut - 0.1, outer + out2 * 0.5], [x0 - 0.3, roofOut - 0.1, outer + out2 * 0.5], [0.45, 0.47, 0.47]);
    beam([x0 - 0.3, roofOut - 0.1, outer + out2 * 0.5], [x1 + 0.3, roofOut - 0.1, outer + out2 * 0.5], 0.12, [0.38, 0.4, 0.4]);
    beam([x0, roofOut - 0.2, outer - out2 * 0.15], [x1, roofOut - 0.2, outer - out2 * 0.15], 0.2, KT_DECK);
    // the steps down at one end
    const sx = stepsAt < 0 ? x0 : x1, dir = stepsAt;
    for (let k = 0; k < 4; k++) {
      if (k * 0.24 >= high - 0.05) break;
      const y = gY + k * 0.24, d = (Math.ceil(high / 0.24) - k) * 0.3;
      const a = sx + dir * d, b = sx;
      B.box(Math.min(a, b), Math.max(a, b), y, y + 0.24, z0 + 0.2, z1 - 0.2, KT_DECK);
    }
    return { minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: top, keepsSurvey: true };
  };
  const yAt = (x, z) => groundHeight(x, z) - 0.05;
  const level = (x0, x1, z) => Math.min(yAt(x0, z), yAt(x1, z));
  const byS = (q) => out.find((o) => o.s === q?.s);
  // in the courtyard: along the corner building's south wall and the Fifth Ave building's north wall (the alley on
  // the market side is the survey's parking lot, so none there)
  if (A) byS(A).decks.push(deck(165, 180, -546.3, -543.8, -546.6, level(165, 180, -545), -1));
  if (C) byS(C).decks.push(deck(164.2, 181.2, -539.6, -536.9, -536.5, level(164, 181, -538), 1));
  // colliders: each building's own strips, then its decks
  return out.map(({ s, maxY, decks }) => ({ s, maxY, colliders: [...strips(s.ring, maxY), ...decks] }));
}

// The Ann Arbor Farmers Market: long open sheds on the survey's outline of their roofs, each a gable along its own
// length on green steel trusses (a post each side, a tie, rafters to the ridge, a king post and braces) every 6 m or
// so, a pale standing-seam metal roof with its ridge cap, and the stalls' tables down both sides under the eaves, with
// produce crates on some. The north shed along the Kerrytown side, the long one along Detroit St and two short sheds
// off it, and the stub by Fifth Ave; laid out by hand on the outline (found by a point inside it). Open: only the posts
// stop anyone.
function farmersMarket(B, T) {
  const s = surveyAt(168, -470);
  if (!s) return null;
  const K = ktTools(B, T), { beam } = K;
  const g = groundOf(s.ring) - 0.2;
  // each shed: from a to b along its ridge, w wide
  const sheds = [
    { a: [115.5, -501.25], b: [184.5, -498.5], w: 8.6 },
    { a: [192.1, -501.6], b: [147.1, -442.1], w: 8.4 },
    { a: [144, -476], b: [172.5, -475.8], w: 8.6 },
    { a: [138, -452.25], b: [154.5, -452.1], w: 8.4 },
    { a: [191.75, -511.5], b: [191.75, -502.5], w: 8.5 }
  ];
  const ROOF_TOP = [0.72, 0.73, 0.71], ROOF_SEAM = [0.6, 0.61, 0.6], TABLE = [0.48, 0.35, 0.22], CLOTH = [[0.75, 0.2, 0.15], [0.2, 0.4, 0.6], [0.85, 0.8, 0.65]];
  const CROPS = [[0.85, 0.4, 0.1], [0.7, 0.12, 0.1], [0.4, 0.55, 0.15], [0.55, 0.3, 0.45], [0.9, 0.75, 0.2]];
  const colliders = [];
  let maxY = g;
  sheds.forEach(({ a, b, w }, si) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
    const at = (u, v, y) => [a[0] + tx * u + nx * v, y, a[1] + tz * u + nz * v];
    const gy = Math.min(groundHeight(...[a[0], a[1]]), groundHeight(b[0], b[1]), groundHeight((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) - 0.15;
    const eave = gy + 3.5, ridge = gy + 5.6, hw = w / 2, o = 0.6;
    maxY = Math.max(maxY, ridge);
    // the roof's two slopes, out past the posts, a seam every 0.6 m and the ridge's cap
    const ey = eave - (o * (ridge - eave)) / hw;
    for (const sg of [-1, 1]) {
      B.quad(B.stone, at(-0.4, sg * (hw + o), ey), at(L + 0.4, sg * (hw + o), ey), at(L + 0.4, 0, ridge), at(-0.4, 0, ridge), ROOF_TOP);
      // the underside, darker, a little below
      B.quad(B.stone, at(L + 0.4, sg * (hw + o), ey - 0.08), at(-0.4, sg * (hw + o), ey - 0.08), at(-0.4, 0, ridge - 0.08), at(L + 0.4, 0, ridge - 0.08), [0.36, 0.38, 0.36]);
      for (let u = 0.2; u < L + 0.3; u += 0.6) {
        B.quad(B.stone, at(u - 0.03, sg * (hw + o), ey + 0.025), at(u + 0.03, sg * (hw + o), ey + 0.025), at(u + 0.03, 0, ridge + 0.025), at(u - 0.03, 0, ridge + 0.025), ROOF_SEAM);
      }
      beam(at(-0.4, sg * (hw + o), ey - 0.04), at(L + 0.4, sg * (hw + o), ey - 0.04), 0.12, GREEN_STEEL);
    }
    beam(at(-0.45, 0, ridge + 0.04), at(L + 0.45, 0, ridge + 0.04), 0.22, ROOF_SEAM);
    // the trusses: a post each side, a tie across, rafters to the ridge, a king post, braces; purlins between them
    const n = Math.max(1, Math.round(L / 6)), step = L / n;
    for (let k = 0; k <= n; k++) {
      const u = k * step, pv = hw - 0.3;
      for (const sg of [-1, 1]) {
        beam(at(u, sg * pv, gy - 0.3), at(u, sg * pv, eave), 0.2, GREEN_STEEL);
        // a knee brace from the post to the tie
        beam(at(u, sg * pv, eave - 0.9), at(u, sg * (pv - 0.9), eave), 0.08, GREEN_STEEL);
        beam(at(u, sg * pv, eave), at(u, 0, ridge - 0.12), 0.14, GREEN_STEEL);
        beam(at(u, sg * pv * 0.5, eave), at(u, 0, ridge - 0.15), 0.07, GREEN_STEEL);
        const p = at(u, sg * pv, 0);
        colliders.push({ minX: p[0] - 0.15, maxX: p[0] + 0.15, minZ: p[2] - 0.15, maxZ: p[2] + 0.15, maxY: eave, keepsSurvey: true });
      }
      beam(at(u, -pv, eave), at(u, pv, eave), 0.12, GREEN_STEEL);
      beam(at(u, 0, eave), at(u, 0, ridge - 0.1), 0.08, GREEN_STEEL);
      if (k < n) {
        for (const v of [-pv, -pv * 0.5, 0, pv * 0.5, pv]) {
          const y = v === 0 ? ridge - 0.2 : eave + ((ridge - eave) * (1 - Math.abs(v) / pv)) - 0.12;
          beam(at(u, v, Math.abs(v) === pv ? eave : y), at(u + step, v, Math.abs(v) === pv ? eave : y), 0.08, GREEN_STEEL);
        }
        // the stalls in this bay, both sides: a table under a cloth, crates of produce on some
        for (const sg of [-1, 1]) {
          const c0 = u + 0.6, c1 = u + step - 0.6, v0 = sg * (pv - 2.0), v1 = sg * (pv - 1.0);
          const q = (uu, vv, yy) => at(uu, vv, yy);
          const box = (u0, u1, w0, w1, y0, y1, col) => {
            const A = q(u0, w0, y0), Bq = q(u1, w0, y0), C = q(u1, w1, y0), D = q(u0, w1, y0);
            const A2 = q(u0, w0, y1), B2 = q(u1, w0, y1), C2 = q(u1, w1, y1), D2 = q(u0, w1, y1);
            B.quad(B.stone, A2, B2, C2, D2, col);
            B.quad(B.stone, A, Bq, B2, A2, col); B.quad(B.stone, Bq, C, C2, B2, col);
            B.quad(B.stone, C, D, D2, C2, col); B.quad(B.stone, D, A, A2, D2, col);
          };
          const hash = (si * 31 + k * 7 + (sg > 0 ? 3 : 0)) % 10;
          if (hash === 9) continue; // an empty stall
          box(c0, c1, Math.min(v0, v1), Math.max(v0, v1), gy + 0.72, gy + 0.78, TABLE);
          box(c0 + 0.02, c1 - 0.02, Math.min(v0, v1) - 0.02, Math.max(v0, v1) + 0.02, gy + 0.3, gy + 0.72, CLOTH[hash % 3]);
          if (XBOX || hash % 3 === 0) continue;
          for (let cu = c0 + 0.3; cu < c1 - 0.5; cu += 0.75) {
            const crop = CROPS[(hash + Math.round(cu * 3)) % CROPS.length];
            box(cu, cu + 0.55, Math.min(v0, v1) + 0.15, Math.min(v0, v1) + 0.75, gy + 0.78, gy + 0.98, TABLE);
            box(cu + 0.04, cu + 0.51, Math.min(v0, v1) + 0.19, Math.min(v0, v1) + 0.71, gy + 0.98, gy + 1.05, crop);
          }
        }
      }
    }
  });
  return { s, maxY, colliders };
}

// The downtown library (Alden B. Dow's 1957 building, its 1974 and 1991 additions): tan brick and precast concrete,
// four floors over Library Lane in the main block and two in the front wing on Fifth Ave. Each floor a band of
// bronze-tinted windows in dark bronze frames between brick piers, a precast spandrel at each floor line, the corners
// left solid brick, a deep precast fascia at the top and the plant room set back on the roof. The front wing: a
// ribbon of tall windows on Fifth, its entrance a two-storey glass bay in bronze mullions under a thin flat canopy
// that reaches out over the walk on slim posts, a low limestone sign wall (no lettering) and a book drop.
const LIB_BRICK = [0.66, 0.54, 0.4];
const LIB_PRECAST = [0.78, 0.75, 0.68];
const LIB_BRONZE = [0.2, 0.15, 0.1];
const LIB_GLASS = [0.3, 0.27, 0.22];
const LIB_ROOF = [0.3, 0.3, 0.31];
// a band of windows along a wall between brick piers: floors [y0, y1] (over the ground y), a pier every `every` m,
// solid brick `end` m in from each corner; windows only where nothing stands a metre in front
function windowBands(B, T, K, e, Y, floors, { every = 3, pier = 0.55, end = 1.6, brick = LIB_BRICK, frame = LIB_BRONZE,
  glass = LIB_GLASS, spandrel = LIB_PRECAST, free = () => true, mullions = 1 } = {}) {
  const u0 = end, u1 = e.L - end;
  if (u1 - u0 < every) return;
  const n = Math.max(1, Math.round((u1 - u0) / every)), w = (u1 - u0) / n;
  for (const [y0, y1] of floors) {
    for (let k = 0; k < n; k++) {
      const a = u0 + k * w, b = a + w, mid = (a + b) / 2;
      if (!free(mid)) continue;
      K.face(e, a + pier / 2, b - pier / 2, Y(y0), Y(y1), 0.02, glass, B.glass);
      // the frame round it and its mullions
      T.ebox(e, a + pier / 2, b - pier / 2, Y(y0), Y(y0 + 0.08), 0, 0.08, frame);
      T.ebox(e, a + pier / 2, b - pier / 2, Y(y1 - 0.08), Y(y1), 0, 0.08, frame);
      for (let m = 1; m <= mullions; m++) {
        const u = a + pier / 2 + ((b - a - pier) * m) / (mullions + 1);
        T.ebox(e, u - 0.04, u + 0.04, Y(y0), Y(y1), 0, 0.08, frame);
      }
      // the brick pier at its left (and the last one's right), standing proud
      T.ebox(e, a - pier / 2, a + pier / 2, Y(y0 - 0.1), Y(y1 + 0.1), 0, 0.16, brick, B.brick);
      if (k === n - 1) T.ebox(e, b - pier / 2, b + pier / 2, Y(y0 - 0.1), Y(y1 + 0.1), 0, 0.16, brick, B.brick);
    }
    // the precast spandrel under the band
    T.ebox(e, u0 - pier, u1 + pier, Y(y0 - 0.75), Y(y0 - 0.1), 0, 0.2, spandrel);
  }
}

function districtLibrary(B, T) {
  const s = surveyAt(235, 160);
  if (!s) return null;
  const K = ktTools(B, T);
  const w = surveyAt(200, 160);
  const free = (self) => (e) => (u) => !otherBuildingAt(e.ax + e.tx * u + e.nx * 1.2, e.az + e.tz * u + e.nz * 1.2, self);
  // the main block: four floors
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y, H = Math.max(16, s.height - 0.5);
  B.prism(r, g - 2, Y(0.6), CONCRETE);
  B.prism(r, Y(H - 1.2) - 0.05, Y(H - 1.2), LIB_ROOF);
  for (const e of edgesOf(r)) {
    K.face(e, 0, e.L, Y(0.6), Y(H - 1.6), 0.01, LIB_BRICK, B.brick);
    if (e.L < 4) continue;
    windowBands(B, T, K, e, Y, [[1.3, 3.5], [5.0, 7.4], [8.8, 11.2], [12.4, 14.4]].filter(([, y1]) => y1 < H - 1.9), { free: free(s.b)(e), every: 3.2 });
    // the fascia: a deep precast band, its soffit and a thin coping; its back face over the roof
    T.ebox(e, -0.3, e.L + 0.3, Y(H - 1.6), Y(H), 0, 0.3, LIB_PRECAST);
    K.face(e, e.L, 0, Y(H - 1.2), Y(H), -0.25, LIB_PRECAST);
    T.ebox(e, -0.35, e.L + 0.35, Y(H), Y(H + 0.12), -0.3, 0.35, [0.62, 0.6, 0.55]);
    T.ebox(e, 0, e.L, Y(0.4), Y(0.6), 0, 0.08, LIB_PRECAST);
  }
  // the plant room and its louvres, set back on the roof, and two units
  const pr = scaleRing(r, 0.42);
  B.prism(pr, Y(H - 1.2), Y(H + 2.8), [0.58, 0.57, 0.54], LIB_ROOF);
  for (const e of edgesOf(pr)) for (let u = 0.6; u < e.L - 0.5; u += 0.35) K.face(e, u, u + 0.18, Y(H), Y(H + 2.2), 0.02, [0.36, 0.36, 0.35]);
  const out = [{ s, maxY: Y(H + 2.8) }];
  if (!w) return out;
  // the front wing on Fifth Ave: two floors
  const wr = w.ring, wg = groundOf(wr) - 0.3, WY = (y) => wg + y, wh = Math.max(8.4, w.height + 1.2);
  B.prism(wr, wg - 2, WY(0.5), CONCRETE);
  B.prism(wr, WY(wh - 1.1) - 0.05, WY(wh - 1.1), LIB_ROOF);
  const front = edgeFacing(wr, -1, 0), c = front.L / 2;
  for (const e of edgesOf(wr)) {
    K.face(e, 0, e.L, WY(0.5), WY(wh - 1.4), 0.01, LIB_BRICK, B.brick);
    T.ebox(e, -0.3, e.L + 0.3, WY(wh - 1.4), WY(wh), 0, 0.3, LIB_PRECAST);
    K.face(e, e.L, 0, WY(wh - 1.1), WY(wh), -0.25, LIB_PRECAST);
    T.ebox(e, -0.35, e.L + 0.35, WY(wh), WY(wh + 0.12), -0.3, 0.35, [0.62, 0.6, 0.55]);
    if (e.L < 4) continue;
    const f = free(w.b)(e);
    if (Math.abs(e.ax - front.ax) < 0.01 && Math.abs(e.az - front.az) < 0.01) {
      // tall windows down Fifth either side of the entrance, the upper floor's band over them
      const left = { ...e, L: c - 7 }, right = { ...e, ax: e.ax + e.tx * (c + 7), az: e.az + e.tz * (c + 7), L: e.L - c - 7 };
      for (const part of [left, right]) {
        windowBands(B, T, K, part, WY, [[0.9, 3.6]], { every: 2.6, end: 1.2, mullions: 0, free: () => true });
        windowBands(B, T, K, part, WY, [[4.6, 6.4]], { every: 2.6, end: 1.2, free: () => true });
      }
    } else {
      windowBands(B, T, K, e, WY, [[1.1, 3.4], [4.6, 6.4]], { every: 3.2, free: f });
    }
  }
  // the entrance: a two-storey glass bay standing out from the front between brick fins, bronze mullions and
  // transoms, the doors at its foot
  const e = front, bh = wh - 1.5;
  T.ebox(e, c - 6.4, c - 5.6, WY(0), WY(wh), 0, 2.2, LIB_BRICK, B.brick);
  T.ebox(e, c + 5.6, c + 6.4, WY(0), WY(wh), 0, 2.2, LIB_BRICK, B.brick);
  K.face(e, c - 5.6, c + 5.6, WY(0.4), WY(bh), 1.6, LIB_GLASS, B.glass);
  for (let u = c - 5.6; u <= c + 5.61; u += 1.4) T.ebox(e, u - 0.05, u + 0.05, WY(0.4), WY(bh), 1.6, 1.72, LIB_BRONZE);
  for (const y of [0.4, 3.0, 3.4, bh - 0.1]) T.ebox(e, c - 5.6, c + 5.6, WY(y), WY(y + 0.1), 1.6, 1.72, LIB_BRONZE);
  for (const du of [-2.1, -0.7, 0.7]) K.face(e, c + du + 0.05, c + du + 1.35, WY(0.45), WY(2.8), 1.73, [0.12, 0.1, 0.08]);
  T.ebox(e, c - 5.6, c + 5.6, WY(bh), WY(wh), 0, 1.75, LIB_PRECAST);
  // the canopy: a thin precast slab out over the walk on four slim posts
  T.ebox(e, c - 8, c + 8, WY(3.9), WY(4.25), 1.7, 6.5, LIB_PRECAST);
  for (const du of [-7.2, -2.4, 2.4, 7.2]) K.beam(K.P(e, c + du, WY(0), 6.0), K.P(e, c + du, WY(3.9), 6.0), 0.16, LIB_BRONZE);
  // a low limestone sign wall on the walk (no lettering) and the book drop beside the doors
  T.ebox(e, c - 13, c - 8.5, wg - 0.5, WY(1.3), 4.5, 5.1, [0.8, 0.77, 0.7]);
  T.ebox(e, c + 6.8, c + 7.6, WY(0.3), WY(1.4), 2.2, 2.9, [0.25, 0.28, 0.32]);
  const walls = strips(wr, WY(wh + 0.12));
  // the canopy's posts (the walk stays open under it)
  for (const du of [-7.2, -2.4, 2.4, 7.2]) {
    const p = K.P(e, c + du, 0, 6.0);
    walls.push({ minX: p[0] - 0.15, maxX: p[0] + 0.15, minZ: p[2] - 0.15, maxZ: p[2] + 0.15, maxY: WY(3.9), keepsSurvey: true });
  }
  const bay = [K.P(e, c - 6.4, 0, 0), K.P(e, c + 6.4, 0, 2.2)];
  walls.push({ minX: Math.min(bay[0][0], bay[1][0]), maxX: Math.max(bay[0][0], bay[1][0]), minZ: Math.min(bay[0][2], bay[1][2]),
    maxZ: Math.max(bay[0][2], bay[1][2]), maxY: WY(wh), keepsSurvey: true });
  out.push({ s: w, maxY: WY(wh + 0.12), colliders: walls });
  return out;
}

function towerPlaza(B, T) {
  const s = surveyAt(496, 182);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y, h = s.height;
  B.prism(r, g - 2, Y(4.2), CONCRETE);
  T.walls(r, Y(4.2), Y(h - 4), BRICK_BROWN);
  const rows = [];
  for (let y = 5; y < h - 6; y += 3.05) rows.push([y, y + 1.8]);
  B.ringWindows(r, rows, 2.7, 1.2, GLASS, 0.03, g);
  // the lobby's glass under a canopy, the top band and the penthouse
  for (const e of edgesOf(r)) if (e.L > 8) T.ebox(e, 1.5, e.L - 1.5, Y(0.3), Y(3.8), 0.02, 0.06, GLASS, B.glass);
  T.band(r, Y(4), Y(4.4), CONCRETE, 0.4);
  T.walls(r, Y(h - 4), Y(h), CONCRETE);
  B.prism(scaleRing(r, 0.45), Y(h), Y(h + 4.5), CONCRETE);
  return { s, maxY: Y(h + 4.5) };
}

// The Gandy Dancer: the 1886 Michigan Central depot, Richardsonian Romanesque in rough fieldstone with red sandstone
// arches and bands, under a broad hipped roof of red tile with deep eaves, its platform porch along the tracks (north)
// and a squat round tower with a cone roof on the street side. Laid out along its long wall (u) and across it (v,
// negative toward the tracks), from the survey's outline.
const FIELDSTONE = [[0.5, 0.46, 0.41], [0.44, 0.4, 0.37], [0.56, 0.5, 0.43], [0.4, 0.37, 0.35], [0.52, 0.44, 0.36]];
const SANDSTONE = [0.52, 0.27, 0.2];
const RED_TILE = [0.4, 0.19, 0.14];
const PORCH_WOOD = [0.3, 0.2, 0.14];
function gandyDancer(B, T) {
  const s = surveyAt(560, -840);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  // the long wall on the tracks' side sets the frame
  const e0 = edgeFacing(r, 0.44, -0.9);
  const tx = e0.tx * Math.sign(e0.tx || 1), tz = e0.tz * Math.sign(e0.tx || 1), nx = -tz, nz = tx;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const u = r[i] * tx + r[i + 1] * tz, v = r[i] * nx + r[i + 1] * nz;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  // which way across is the tracks (north)
  const north = Math.sign(-nz) || 1;
  const P = (u, v, y) => [tx * u + nx * v, y, tz * u + nz * v];
  const rect = (a0, a1, b0, b1, y0, y1, col) => B.prism([...P(a0, b0, 0), ...P(a1, b0, 0), ...P(a1, b1, 0), ...P(a0, b1, 0)]
    .filter((_, i) => i % 3 !== 1), y0, y1, col);
  // an oriented hipped roof
  const hip = (a0, a1, b0, b1, y0, y1, col) => {
    const h = Math.min((b1 - b0) / 2, (a1 - a0) / 2), bc = (b0 + b1) / 2;
    const r0 = P(a0 + h, bc, y1), r1 = P(a1 - h, bc, y1);
    B.quad(B.stone, P(a0, b0, y0), r0, r1, P(a1, b0, y0), col);
    B.quad(B.stone, P(a1, b1, y0), r1, r0, P(a0, b1, y0), col);
    B.tri(B.stone, P(a0, b1, y0), r0, P(a0, b0, y0), col);
    B.tri(B.stone, P(a1, b0, y0), r1, P(a1, b1, y0), col);
  };

  B.prism(r, g - 2, Y(0.6), SANDSTONE);
  T.walls(r, Y(0.6), Y(5.6), FIELDSTONE[0]);
  // rough boulders standing a little proud of the walls, in a few tones (by a fixed hash, so it's the same each time)
  let seed = 7;
  const hash = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const e of edgesOf(r)) {
    if (e.L < 1.5) continue;
    for (let y = 0.7; y < 5.2; y += 0.55) {
      for (let u = 0.2 + hash() * 0.5; u < e.L - 0.4; u += 0.6 + hash() * 0.7) {
        const w = 0.35 + hash() * 0.45, h = 0.3 + hash() * 0.22;
        T.ebox(e, u, Math.min(e.L - 0.1, u + w), Y(y), Y(y + h), 0, 0.04 + hash() * 0.05, FIELDSTONE[Math.floor(hash() * 5)]);
      }
    }
    // tall round-arched windows and doors in red sandstone, a sandstone band at their sills and springing
    for (let u = 2; u < e.L - 1.6; u += 3.4) {
      T.earch(e, u, Y(0.9), Y(4.7), 2.2, 0.06, SANDSTONE, B.stone);
      T.earch(e, u, Y(1.1), Y(4.45), 1.6, 0.1, GLASS);
    }
    T.ebox(e, 0, e.L, Y(0.6), Y(0.95), 0, 0.12, SANDSTONE);
  }
  T.band(r, Y(5.3), Y(5.75), SANDSTONE, 0.18);
  // the broad red roofs with deep eaves: the depot's main hall, and the lower baggage wing at its east end
  const span = u1 - u0, split = u0 + span * 0.73, eave = 1.6;
  hip(u0 - eave, split + 0.5, v0 - eave, v1 + eave, Y(5.6), Y(13.2), RED_TILE);
  hip(split - 0.5, u1 + eave, v0 - eave * 0.8, v1 + eave * 0.8, Y(5.6), Y(10.6), RED_TILE);
  // a gabled dormer over the front door and two stone chimneys
  const vf = north < 0 ? v1 : v0, vb = north < 0 ? v0 : v1, out = north < 0 ? 1 : -1;
  const um = u0 + span * 0.42;
  rect(um - 3, um + 3, vf - out * 1.5, vf + out * 0.4, Y(5.6), Y(9.2), FIELDSTONE[2]);
  B.quad(B.stone, P(um - 3.4, vf + out * 0.6, Y(9.2)), P(um, vf + out * 0.6, Y(11.6)), P(um, vf - out * 5, Y(11.6)), P(um - 3.4, vf - out * 5, Y(9.2)), RED_TILE);
  B.quad(B.stone, P(um, vf + out * 0.6, Y(11.6)), P(um + 3.4, vf + out * 0.6, Y(9.2)), P(um + 3.4, vf - out * 5, Y(9.2)), P(um, vf - out * 5, Y(11.6)), RED_TILE);
  B.tri(B.stone, P(um - 3, vf + out * 0.42, Y(9.2)), P(um + 3, vf + out * 0.42, Y(9.2)), P(um, vf + out * 0.42, Y(11.2)), FIELDSTONE[2]);
  // its face: boulders like the walls below, a pair of arched windows in sandstone, a band at their sills
  const [dax, , daz] = P(um - 3, vf + out * 0.4, 0);
  const df = { ax: dax, az: daz, L: 6, tx, tz, nx: nx * out, nz: nz * out };
  for (let y = 5.8; y < 9; y += 0.55) {
    for (let u = 0.1 + hash() * 0.4; u < 5.6; u += 0.6 + hash() * 0.6) {
      T.ebox(df, u, Math.min(5.95, u + 0.35 + hash() * 0.4), Y(y), Y(y + 0.3 + hash() * 0.2), 0, 0.04 + hash() * 0.05, FIELDSTONE[Math.floor(hash() * 5)]);
    }
  }
  for (const u of [1.8, 4.2]) {
    T.earch(df, u, Y(6.3), Y(8.7), 1.6, 0.1, SANDSTONE, B.stone);
    T.earch(df, u, Y(6.45), Y(8.5), 1.1, 0.14, GLASS);
  }
  T.ebox(df, 0, 6, Y(6.1), Y(6.35), 0, 0.16, SANDSTONE);
  for (const uc of [u0 + span * 0.2, u0 + span * 0.6]) rect(uc - 0.7, uc + 0.7, -0.7 + (v0 + v1) / 2, 0.7 + (v0 + v1) / 2, Y(10), Y(15), FIELDSTONE[3]);
  // the round tower on the street side, its cone roof above the eaves
  const tu = u0 + span * 0.12, tv = vf + out * 1.2, tr = 2.8, tower = [];
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; tower.push(...P(tu + Math.cos(a) * tr, tv + Math.sin(a) * tr, 0).filter((_, i) => i !== 1)); }
  B.prism(tower, g - 1, Y(9.5), FIELDSTONE[4]);
  B.prism(insetRing(tower, -0.2), Y(9.2), Y(9.7), SANDSTONE);
  const apex = P(tu, tv, Y(15.5));
  const ex = insetRing(tower, -0.5);
  for (let k = 0; k < 14; k++) {
    const j = (k + 1) % 14;
    B.tri(B.stone, [ex[k * 2], Y(9.7), ex[k * 2 + 1]], apex, [ex[j * 2], Y(9.7), ex[j * 2 + 1]], RED_TILE);
  }
  for (let k = 0; k < 14; k += 2) {
    const a = ((k + 0.5) / 14) * Math.PI * 2, c = P(tu + Math.cos(a) * (tr + 0.06), tv + Math.sin(a) * (tr + 0.06), 0);
    B.box(c[0] - 0.3, c[0] + 0.3, Y(6.4), Y(8.3), c[2] - 0.3, c[2] + 0.3, GLASS, B.glass);
  }
  // the platform porch along the tracks: a long low roof on timber posts
  const pv0 = vb, pv1 = vb - out * 4.2;
  const a = Math.min(pv0, pv1), b = Math.max(pv0, pv1);
  for (let u = u0 + 2; u < split; u += 4) rect(u - 0.13, u + 0.13, (north < 0 ? a + 0.2 : b - 0.46), (north < 0 ? a + 0.46 : b - 0.2), Y(0.3), Y(3.6), PORCH_WOOD);
  const lowV = north < 0 ? a : b;
  B.quad(B.stone, P(u0 + 0.5, lowV, Y(3.6)), P(split, lowV, Y(3.6)), P(split, vb, Y(4.6)), P(u0 + 0.5, vb, Y(4.6)), RED_TILE);
  B.quad(B.stone, P(u0 + 0.5, vb, Y(4.55)), P(split, vb, Y(4.55)), P(split, lowV, Y(3.55)), P(u0 + 0.5, lowV, Y(3.55)), PORCH_WOOD);
  return { s, maxY: Y(13.2) };
}

// The Amtrak station (1983), just west of the Gandy Dancer: one storey of variegated brown brick, the waiting room's
// floor-to-ceiling windows toward Depot St, a band of clerestory glass under a black metal roof that cantilevers out
// on deep eaves, and a long canopy along the platform on the tracks' side.
const BROWN_BRICK = [[0.42, 0.27, 0.2], [0.36, 0.23, 0.17], [0.47, 0.31, 0.22]];
const BLACK_METAL = [0.07, 0.075, 0.08];
const DARK_FRAME = [0.12, 0.12, 0.13];
function amtrakStation(B, T) {
  const s = surveyAt(429, -903);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.2, Y = (y) => g + y;
  B.prism(r, g - 1, Y(0.4), BROWN_BRICK[1]);
  T.walls(r, Y(0.4), Y(3.4), BROWN_BRICK[0]);
  // the brick's mix of tones, course by course
  for (const e of edgesOf(r)) {
    for (let y = 0.5, k = 0; y < 3.3; y += 0.32, k++) T.ebox(e, 0, e.L, Y(y), Y(y + 0.08), 0, 0.02, BROWN_BRICK[k % 3]);
    // the clerestory: a band of glass all round where the walls meet the roof
    T.ebox(e, 0.3, e.L - 0.3, Y(3.4), Y(4.1), -0.15, -0.1, GLASS, B.glass);
    for (let u = 0.3; u <= e.L - 0.29; u += 1.5) T.ebox(e, u - 0.05, u + 0.05, Y(3.4), Y(4.1), -0.16, -0.06, DARK_FRAME);
  }
  // the waiting room's tall windows and the doors, on the street side
  const front = edgeFacing(r, -0.44, 0.9), mid = front.L / 2;
  T.ebox(front, mid - 7, mid + 7, Y(0.4), Y(3.3), 0.02, 0.06, GLASS, B.glass);
  for (let u = mid - 7; u <= mid + 7.01; u += 1.75) T.ebox(front, u - 0.06, u + 0.06, Y(0.4), Y(3.3), 0.02, 0.12, DARK_FRAME);
  T.ebox(front, mid - 7, mid + 7, Y(3.2), Y(3.35), 0.02, 0.14, DARK_FRAME);
  // the black roof floating over the clerestory, out over deep eaves, its low hip and the fascia's edge
  const eave = insetRing(r, -2.2);
  B.prism(eave, Y(4.1), Y(4.45), BLACK_METAL, BLACK_METAL);
  T.slope(eave, Y(4.45), 4, Y(5.4), BLACK_METAL);
  // the platform canopy along the tracks: a black roof on slim posts
  const back = edgeFacing(r, 0.44, -0.9);
  T.ebox(back, -14, back.L + 14, Y(3.5), Y(3.75), 2.2, 6.5, BLACK_METAL);
  for (let u = -12; u <= back.L + 12; u += 6) T.ebox(back, u - 0.1, u + 0.1, g - 0.3, Y(3.5), 5.8, 6, DARK_FRAME);
  return { s, maxY: Y(5.4) };
}

// Huron High School (1969) on Fuller Rd: the survey's one outline of its pods, spine and wings, three storeys of
// brown brick with ribbon windows following each wall at its own ground (the site falls toward the river), a concrete
// fascia standing proud of the roof, the taller gym block to the north, and a glass dome skylight on each round pod.
const HURON_BRICK = [[0.45, 0.28, 0.2], [0.4, 0.25, 0.18], [0.5, 0.32, 0.23]];
const HURON_CONCRETE = [0.66, 0.63, 0.58];
function huronHigh(B, T) {
  const s = surveyAt(3746, -205);
  if (!s) return null;
  const r = s.ring, n = r.length / 2;
  let low = Infinity, sum = 0;
  for (let i = 0; i < n; i++) { const h = groundHeight(r[i * 2], r[i * 2 + 1]); low = Math.min(low, h); sum += h; }
  const roof = sum / n + Math.min(12, Math.max(10, s.height)), top = roof + 0.5;
  B.prism(r, low - 2, roof, HURON_BRICK[0], ROOF);
  for (const e of edgesOf(r)) {
    const ge = groundHeight(e.ax + e.tx * e.L / 2 + e.nx * 2, e.az + e.tz * e.L / 2 + e.nz * 2) - 0.3;
    // a plinth of concrete where the wall meets the ground, the brick's courses in three tones
    T.ebox(e, 0, e.L, low - 1, ge + 0.6, 0, 0.05, HURON_CONCRETE);
    if (e.L > 6) for (let y = ge + 0.9, k = 0; y < roof - 1.6; y += 0.9, k++) T.ebox(e, 0, e.L, y, y + 0.12, 0, 0.02, HURON_BRICK[1 + (k % 2)]);
    // the ribbon windows, one band a storey, with their frames
    if (e.L > 2.4) {
      for (const [y0, y1] of [[1.1, 2.6], [4.7, 6.2], [8.3, 9.6]]) {
        if (ge + y1 > roof - 1.4) continue;
        T.ebox(e, 0.5, e.L - 0.5, ge + y0, ge + y1, 0.02, 0.07, GLASS, B.glass);
        T.ebox(e, 0.5, e.L - 0.5, ge + y0 - 0.25, ge + y0, 0.02, 0.2, HURON_CONCRETE);
        const count = Math.max(1, Math.round((e.L - 1) / 3.6));
        for (let k = 1; k < count; k++) { const u = 0.5 + (k * (e.L - 1)) / count; T.ebox(e, u - 0.08, u + 0.08, ge + y0, ge + y1, 0.02, 0.11, DARK_FRAME); }
      }
    }
    // the fascia: a deep concrete band standing proud of the wall and above the roof
    T.ebox(e, -0.3, e.L + 0.3, roof - 1.3, top, 0, 0.35, HURON_CONCRETE);
  }
  // the gym block to the north, a storey taller, blank brick with a band of clerestory glass under its fascia
  const gym = [3661, -366.5, 3698.5, -361.5, 3694.5, -293.3, 3649.8, -299];
  const gTop = roof + 4.5;
  B.prism(gym, roof - 0.5, gTop - 1.3, HURON_BRICK[1], ROOF);
  for (const e of edgesOf(gym)) {
    T.ebox(e, 1, e.L - 1, gTop - 2.9, gTop - 1.6, 0.02, 0.07, GLASS, B.glass);
    T.ebox(e, -0.3, e.L + 0.3, gTop - 1.3, gTop, 0, 0.35, HURON_CONCRETE);
  }
  B.prism(gym, gTop - 1.3, gTop - 1.25, ROOF);
  // a glass dome skylight on each round pod, on a concrete curb
  for (const [cx, cz, rad] of [[3664, -257, 6], [3802, -169, 8]]) {
    const ring = [], layers = 5;
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; ring.push(cx + Math.cos(a) * rad, cz + Math.sin(a) * rad); }
    B.prism(scaleRing(ring, 1.12), roof, roof + 0.6, HURON_CONCRETE);
    for (let l = 0; l < layers; l++) {
      const a0 = (l / layers) * (Math.PI / 2), a1 = ((l + 1) / layers) * (Math.PI / 2);
      const ra = scaleRing(ring, Math.cos(a0)), rb = scaleRing(ring, Math.max(0.02, Math.cos(a1)));
      const ya = roof + 0.6 + Math.sin(a0) * rad * 0.45, yb = roof + 0.6 + Math.sin(a1) * rad * 0.45;
      for (let i = 0; i < 16; i++) {
        const j = (i + 1) % 16;
        B.quad(B.glass, [ra[i * 2], ya, ra[i * 2 + 1]], [ra[j * 2], ya, ra[j * 2 + 1]], [rb[j * 2], yb, rb[j * 2 + 1]], [rb[i * 2], yb, rb[i * 2 + 1]], GLASS);
      }
    }
    // the dome's ribs
    for (let i = 0; i < 16; i += 2) {
      const a = (i / 16) * Math.PI * 2;
      for (let l = 0; l < layers; l++) {
        const p0 = (l / layers) * (Math.PI / 2), p1 = ((l + 1) / layers) * (Math.PI / 2);
        const x0 = cx + Math.cos(a) * rad * Math.cos(p0), z0 = cz + Math.sin(a) * rad * Math.cos(p0);
        const x1 = cx + Math.cos(a) * rad * Math.cos(p1), z1 = cz + Math.sin(a) * rad * Math.cos(p1);
        const y0 = roof + 0.6 + Math.sin(p0) * rad * 0.45, y1 = roof + 0.6 + Math.sin(p1) * rad * 0.45;
        const ox = -Math.sin(a) * 0.07, oz = Math.cos(a) * 0.07;
        B.quad(B.stone, [x0 - ox, y0 + 0.04, z0 - oz], [x0 + ox, y0 + 0.04, z0 + oz], [x1 + ox, y1 + 0.04, z1 + oz], [x1 - ox, y1 + 0.04, z1 - oz], DARK_FRAME);
      }
    }
  }
  // rooftop units on the spine
  for (const [x, z] of [[3730, -225], [3752, -208], [3708, -238]]) B.box(x - 2.2, x + 2.2, roof, roof + 1.8, z - 1.5, z + 1.5, TIN);
  // the main doors on the spine's south side, under a flat concrete canopy on slim columns
  const e = edgeFacing(r, 0.6, 0.8), c = e.L / 2, ge = groundHeight(e.ax + e.tx * c + e.nx * 4, e.az + e.tz * c + e.nz * 4) - 0.3;
  T.ebox(e, c - 6, c + 6, ge, ge + 3, 0.02, 0.08, GLASS, B.glass);
  for (let u = c - 6; u <= c + 6.01; u += 2) T.ebox(e, u - 0.07, u + 0.07, ge, ge + 3, 0.02, 0.12, DARK_FRAME);
  T.ebox(e, c - 9, c + 9, ge + 3.4, ge + 4, 0, 5, HURON_CONCRETE);
  for (const du of [-8.4, -2.8, 2.8, 8.4]) T.ecolumn(e, c + du, ge - 0.3, ge + 3.4, 0.22, 4.4, HURON_CONCRETE);
  return { s, maxY: gTop };
}

// Atomic Object's Ann Arbor office: 123 N Ashley St, the Ashley Square building (1926, offices since; Duo Security's
// headquarters from 2014, Atomic Object's since 2025), on the south-west corner of Ashley and Ann, Ashley Terrace's
// ten storeys hard against its south wall. Modelled from the building's photo on atomicobject.com: cream brick to a
// flat roof about 12 m up, the parapet shaped over the south end (a low shoulder, a raking rise to a peak, a step and a
// raised flat block) with a corbelled dentil course under the coping; on Ashley three tall two-storey glass bays in
// black frames between broad brick piers (the middle one the recessed entrance, the north one the cafe's wide front),
// then two storeys of punched windows: wide four-light windows on the ground floor, squarer ones above. No sign on the
// front (the photo shows none). The Ann St and back walls carry on the same windows, as no photo shows them.
const AO_BRICK = [0.7, 0.66, 0.57];
const AO_PIER = [0.68, 0.64, 0.55];
const AO_TRIM = [0.75, 0.72, 0.64];
const AO_BASE = [0.46, 0.45, 0.42];
const AO_FRAME = [0.11, 0.1, 0.09];
const AO_ROOF = [0.32, 0.32, 0.33];
// a wall from a to b, its normal turned toward (ox, oz)
function wallFrame(ax, az, bx, bz, ox, oz) {
  const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
  let nx = -tz, nz = tx;
  if (nx * ox + nz * oz < 0) { nx = -nx; nz = -nz; }
  return { ax, az, L, tx, tz, nx, nz };
}
function atomicObject(B, T) {
  const s = surveyAt(-134, -280);
  if (!s) return null;
  const r = s.ring, g = groundOf(r) - 0.3, Y = (y) => g + y;
  const H = 9.6; // the wings' parapet; the centre's gable rises 2.3 m over it
  const R = H - 0.9; // the roof, behind the parapet
  // the brick (its courses and joints drawn by brickMaterial) is its own mesh: a skin over the walls, and the piers,
  // parapets and gable face made of it
  const brickOf = (col) => (col === AO_BRICK || col === AO_PIER ? B.brick : B.stone);
  B.prism(r, g - 2, Y(0.45), AO_BASE);
  T.walls(r, Y(0.45), Y(R), AO_BRICK, AO_ROOF);
  for (const e of edgesOf(r)) T.ebox(e, 0, e.L, Y(0.45), Y(R), 0, 0.012, AO_BRICK, B.brick);
  // the parapet and its coping round the roof (Ashley's shaped front has its own), and rooftop units back from the street
  for (const e of edgesOf(r)) {
    T.ebox(e, 0, e.L, Y(R), Y(H), -0.3, 0.012, AO_BRICK, B.brick);
    if (e.nx < 0.9) T.ebox(e, -0.06, e.L + 0.06, Y(H), Y(H + 0.16), -0.36, 0.08, AO_TRIM);
  }
  B.box(-142, -138, Y(R), Y(R + 1.8), -282, -278.5, [0.62, 0.63, 0.63]);
  B.box(-136, -133, Y(R), Y(R + 1.5), -266, -263.5, [0.62, 0.63, 0.63]);
  B.box(-152, -149.5, Y(R), Y(R + 1.1), -263, -260, [0.55, 0.56, 0.56]);

  // a flat shape on a wall: points [u, y] over the ground, between d0 and d1 out from it
  const slab = (e, pts, d0, d1, col, m = brickOf(col)) => {
    const P = (u, y, d) => [e.ax + e.tx * u + e.nx * d, g + y, e.az + e.tz * u + e.nz * d];
    const v = pts.map(([u, y]) => new THREE.Vector2(u, y));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v, [])) {
      B.tri(m, P(v[i].x, v[i].y, d1), P(v[j].x, v[j].y, d1), P(v[k].x, v[k].y, d1), col);
      B.tri(m, P(v[k].x, v[k].y, d0), P(v[j].x, v[j].y, d0), P(v[i].x, v[i].y, d0), col);
    }
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      B.quad(m, P(a.x, a.y, d0), P(b.x, b.y, d0), P(b.x, b.y, d1), P(a.x, a.y, d1), col);
    }
  };
  const box = (e, u0, u1, y0, y1, d0, d1, col, m = brickOf(col)) => T.ebox(e, u0, u1, Y(y0), Y(y1), d0, d1, col, m);
  // a window in black frames: glass set in by `inset`, `cols` lights across and transoms at `bars` (heights over y0)
  // Set back in the brick: a brick reveal round it standing 0.2 m proud of the wall (the wall can't be cut, so the
  // window's depth is made by the reveal), the reflective glass at the back, slim dark frames and bars over it, and
  // `blinds` (the share of its height from the top) drawn just behind the glass as pale blinds half let down
  const win = (e, u0, u1, y0, y1, { cols = 1, bars = [], d = 0, inset = 0.2, f = 0.06, blinds = 0, reveal = true } = {}) => {
    if (reveal) {
      const r = 0.14;
      box(e, u0 - f - r, u1 + f + r, y1 + f, y1 + f + r, d, d + inset, AO_BRICK);
      box(e, u0 - f - r, u0 - f, y0 - f, y1 + f, d, d + inset, AO_BRICK);
      box(e, u1 + f, u1 + f + r, y0 - f, y1 + f, d, d + inset, AO_BRICK);
    }
    box(e, u0, u1, y0, y1, d + 0.01, d + 0.03, [0.42, 0.47, 0.52], B.aoGlass);
    if (blinds > 0) box(e, u0, u1, y1 - (y1 - y0) * blinds, y1, d + 0.03, d + 0.035, [0.82, 0.82, 0.8]);
    const fd = d + 0.03, fo = d + 0.075;
    box(e, u0 - f, u1 + f, y0 - f, y0, fd, fo, AO_FRAME);
    box(e, u0 - f, u1 + f, y1, y1 + f, fd, fo, AO_FRAME);
    box(e, u0 - f, u0, y0, y1, fd, fo, AO_FRAME);
    box(e, u1, u1 + f, y0, y1, fd, fo, AO_FRAME);
    for (let k = 1; k < cols; k++) { const u = u0 + ((u1 - u0) * k) / cols; box(e, u - 0.03, u + 0.03, y0, y1, fd, fo, AO_FRAME); }
    for (const b of bars) box(e, u0, u1, y0 + b - 0.03, y0 + b + 0.03, fd, fo, AO_FRAME);
  };
  // the corbelled dentils under a coping, from (u0, y0) to (u1, y1)
  const dentils = (e, u0, y0, u1, y1, d = 0) => {
    const n = Math.max(1, Math.round(Math.hypot(u1 - u0, y1 - y0) / 0.42));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, u = u0 + (u1 - u0) * t, y = y0 + (y1 - y0) * t;
      box(e, u - 0.1, u + 0.1, y - 0.42, y - 0.24, d, d + 0.1, AO_TRIM);
    }
    // a plain course over them
    slab(e, [[u0, y0 - 0.24], [u1, y1 - 0.24], [u1, y1 - 0.12], [u0, y0 - 0.12]], d, d + 0.06, AO_PIER);
  };

  // bays of a wide four-light window below and a squarer one above, brick pilasters between (the Ann St side)
  const bays = (e, from, to, every) => {
    const n = Math.max(1, Math.floor((to - from) / every)), w = (to - from) / n;
    for (let k = 0; k < n; k++) {
      const u0 = from + k * w, u1 = u0 + w;
      if (k > 0) box(e, u0 - 0.3, u0 + 0.3, 0.45, H - 0.6, 0, 0.12, AO_PIER);
      win(e, u0 + 0.5, u1 - 0.5, 0.75, 3.55, { cols: 4 });
      box(e, u0 + 0.35, u1 - 0.35, 0.55, 0.75, 0, 0.16, AO_TRIM);
      const c = (u0 + u1) / 2;
      win(e, c - 0.85, c + 0.85, 5.3, 7.4, { bars: [1.45] });
      box(e, c - 1, c + 1, 5.12, 5.3, 0, 0.14, AO_TRIM);
      // a soldier course over each upper window
      box(e, c - 1.05, c + 1.05, 7.5, 7.75, 0, 0.06, AO_PIER);
    }
    // the floor line between the storeys
    box(e, from, to, 4.3, 4.5, 0, 0.08, AO_PIER);
  };
  // Ashley St (east), south to north: u 0 at the corner by Ashley Terrace. As the street view shows it: a plain wing of
  // two bays by the tower; the raised centre (a glass bay, the recessed entrance and a glass bay between broad brick
  // piers under a stone band, the parapet stepping up into a low gable with dentils and stone accents); and the long,
  // lower north wing of wide ground-floor windows with small ones above
  const E = wallFrame(-121, -254, -119.5, -294.5, 1, 0), LE = E.L;
  box(E, 0, LE, 0, 0.45, 0, 0.08, AO_BASE);
  const P0 = 7.6, P1 = 22.9, PC = (P0 + P1) / 2, G0 = PC - 5.9, G1 = PC + 5.9;
  // the raised gable over the centre: a step at each end, a shoulder, a step, and the rake up to the middle
  const gable = [[G0, H], [G0, H + 0.6], [G0 + 1.3, H + 0.6], [G0 + 1.3, H + 0.85], [PC, H + 2.3], [G1 - 1.3, H + 0.85], [G1 - 1.3, H + 0.6], [G1, H + 0.6], [G1, H]];
  slab(E, gable, -0.35, 0.05, AO_BRICK);
  const cope = (u0, y0, u1, y1) => {
    const a = Math.atan2(y1 - y0, u1 - u0), oy = 0.16 / Math.cos(a);
    slab(E, [[u0 - 0.06, y0], [u1 + 0.06, y1], [u1 + 0.06, y1 + oy], [u0 - 0.06, y0 + oy]], -0.42, 0.1, AO_TRIM);
  };
  cope(0, H, G0, H); cope(G0, H + 0.6, G0 + 1.3, H + 0.6); cope(G0 + 1.3, H + 0.85, PC, H + 2.3);
  cope(PC, H + 2.3, G1 - 1.3, H + 0.85); cope(G1 - 1.3, H + 0.6, G1, H + 0.6); cope(G1, H, LE, H);
  for (const [u, y0, y1] of [[G0, H, H + 0.76], [G0 + 1.3, H + 0.6, H + 1.01], [G1 - 1.3, H + 0.6, H + 1.01], [G1, H, H + 0.76]]) box(E, u - 0.1, u + 0.1, y0, y1, -0.42, 0.1, AO_TRIM);
  dentils(E, 0.2, H, G0 - 0.15, H, 0.02);
  dentils(E, G0 + 0.1, H + 0.6, G0 + 1.2, H + 0.6, 0.02);
  dentils(E, G0 + 1.4, H + 0.87, PC - 0.05, H + 2.26, 0.02);
  dentils(E, PC + 0.05, H + 2.26, G1 - 1.4, H + 0.87, 0.02);
  dentils(E, G1 - 1.2, H + 0.6, G1 - 0.1, H + 0.6, 0.02);
  dentils(E, G1 + 0.15, H, LE - 0.2, H, 0.02);

  // the centre: broad brick piers, the two glass bays set in between them and the entrance set further back
  const PIER = 0.55, TOP = 7.2;
  for (const [u0, u1] of [[P0, 9.3], [12.7, 13.9], [17.3, 18.5], [21.9, P1]]) {
    box(E, u0, u1, 0, TOP, 0, PIER, AO_PIER);
    box(E, u0 - 0.05, u1 + 0.05, 0, 0.45, 0, PIER + 0.05, AO_BASE);
  }
  // the stone band over them, and the brick of the gable's face above it with a thin stone line and stone squares
  box(E, P0, P1, TOP, TOP + 0.35, 0, PIER + 0.08, AO_TRIM);
  box(E, P0, P1, TOP + 0.35, H, 0, 0.3, AO_BRICK);
  box(E, G0 + 0.6, G1 - 0.6, H - 0.75, H - 0.65, 0.3, 0.36, AO_TRIM);
  for (const u of [P0 + 1.5, P0 + 3.4, P1 - 3.4, P1 - 1.5]) box(E, u - 0.16, u + 0.16, TOP + 1.0, TOP + 1.32, 0.3, 0.37, AO_TRIM);
  win(E, 9.3, 12.7, 0.15, TOP, { cols: 3, bars: [2.4, 4.75], d: 0.32, reveal: false });
  win(E, 18.5, 21.9, 0.15, TOP, { cols: 3, bars: [2.4, 4.75], d: 0.32, reveal: false });
  win(E, 14.0, 17.2, 0.05, TOP - 0.25, { cols: 3, bars: [2.6, 4.9], d: 0.05, reveal: false });
  // the entrance's deep reveal: its soffit and the door in the middle light
  box(E, 13.9, 17.3, TOP - 0.25, TOP, 0, PIER, AO_PIER);
  box(E, PC - 0.55, PC - 0.47, 0.05, 2.6, 0.03, 0.16, AO_FRAME);
  box(E, PC + 0.47, PC + 0.55, 0.05, 2.6, 0.03, 0.16, AO_FRAME);
  box(E, PC - 0.55, PC + 0.55, 2.52, 2.6, 0.03, 0.16, AO_FRAME);
  // lamps on the piers either side of the entrance
  for (const u of [13.3, 17.9]) box(E, u - 0.08, u + 0.08, 2.6, 3.1, PIER, PIER + 0.14, [0.62, 0.63, 0.64]);

  // how far the sidewalk in front of u stands over the building's base (Ashley climbs to the north), so the ground-floor
  // windows sit their height over it rather than sunk in it
  const lift = (u) => Math.max(0, groundHeight(E.ax + E.tx * u + E.nx * 1.5, E.az + E.tz * u + E.nz * 1.5) + 0.15 - g);
  // the south wing by the tower: two bays, a wide four-light window on each floor, stone squares between them
  box(E, 0, 0.6, 0.45, H, 0, 0.14, AO_PIER);
  for (let k = 0; k < 2; k++) {
    const u0 = 0.6 + k * 3.5, u1 = u0 + 3.5, c = (u0 + u1) / 2;
    const l = lift(c);
    win(E, u0 + 0.3, u1 - 0.3, l + 0.6, l + 2.6, { cols: 4, blinds: 0.35 });
    box(E, u0 + 0.2, u1 - 0.2, l + 0.42, l + 0.6, 0, 0.16, AO_TRIM);
    win(E, u0 + 0.3, u1 - 0.3, 4.4, 6.9, { cols: 4, bars: [0.6] });
    box(E, u0 + 0.2, u1 - 0.2, 4.22, 4.4, 0, 0.16, AO_TRIM);
    box(E, c - 0.25, c + 0.25, 3.35, 3.75, 0, 0.06, AO_TRIM);
  }
  // the north wing: bays of a wide ground-floor window and two small windows above, stone squares under the parapet
  const nb = Math.max(1, Math.floor((LE - 0.7 - P1) / 4.4)), nw = (LE - 0.7 - P1) / nb;
  for (let k = 0; k < nb; k++) {
    const u0 = P1 + k * nw, u1 = u0 + nw, c = (u0 + u1) / 2;
    const l = lift(c);
    win(E, u0 + 0.35, u1 - 0.35, l + 0.4, l + 2.7, { cols: 4, blinds: 0.55 });
    box(E, u0 + 0.25, u1 - 0.25, l + 0.26, l + 0.4, 0, 0.16, AO_TRIM);
    for (const du of [-1, 1]) {
      win(E, c + du - 0.55, c + du + 0.55, l + 3.6, l + 5.3, { bars: [0.85] });
      box(E, c + du - 0.68, c + du + 0.68, l + 3.44, l + 3.6, 0, 0.14, AO_TRIM);
    }
    box(E, c - 0.14, c + 0.14, 7.2, 7.48, 0, 0.06, AO_TRIM);
  }
  box(E, LE - 0.7, LE, 0.45, H, 0, 0.14, AO_PIER);

  // Ann St (north), west to east, its corner pier meeting Ashley's
  const N = wallFrame(-148.5, -295.5, -119.5, -294.5, 0, -1);
  box(N, 0, N.L, 0, 0.45, 0, 0.08, AO_BASE);
  bays(N, 0.8, N.L - 0.8, 4.4);
  box(N, 0, 0.6, 0.45, H, 0, 0.14, AO_PIER);
  box(N, N.L - 0.6, N.L, 0.45, H, 0, 0.14, AO_PIER);
  dentils(N, 0.2, H, N.L - 0.2, H, 0.02);
  // the back walls: plain brick with the upper windows only
  for (const [ax, az, bx, bz, ox, oz] of [[-145, -267, -144, -285, -1, 0], [-161.5, -255.5, -161, -268, -1, 0], [-161, -268, -145, -267, 0, -1], [-149, -285, -148.5, -295.5, -1, 0]]) {
    const e = wallFrame(ax, az, bx, bz, ox, oz);
    for (let u = 2.2; u < e.L - 2; u += 4.4) win(e, u - 0.85, u + 0.85, 5.3, 7.4, { bars: [1.45] });
  }
  return { s, maxY: Y(H + 2.4) };
}

// Nickels Arcade (326-330 S State St, Herman Pipp, 1915-18; National Register 1987): a three-storey block with a
// 261 ft skylit gallery through it from State St to Maynard St. As Wikipedia and SAH Archipedia describe it: on State a
// three-bay front in buff glazed terra cotta, the middle bay the open portico (here its tall round arch between giant
// pilasters, shop and office windows in the flanking bays); on Maynard a plainer front of yellow brick with terra cotta
// trim; inside, a gable skylight of metal-framed wire-glass panels over the passage, shopfronts two storeys high (with
// a mezzanine) down both sides with office windows above, the gallery split into three by segmental arches (the State
// St third carrying on the front's terra cotta, the Maynard one a vestibule), and a floor of square red tiles in black
// borders. No shop names: the shopfronts are plain. Walkable: its colliders are the two shop ranges either side of the
// passage, the arches' piers and the roof over the gallery, so you can walk it end to end.
const NA_TERRA = [0.86, 0.8, 0.66];
const NA_TERRA_DARK = [0.74, 0.68, 0.55];
const NA_BRICK = [0.8, 0.67, 0.43];
const NA_PLASTER = [0.82, 0.78, 0.69];
const NA_WOOD = [0.16, 0.2, 0.17];
const NA_IRON = [0.13, 0.14, 0.14];
const NA_TILE = [0.52, 0.18, 0.13];
const NA_JOINT = [0.05, 0.05, 0.05];
const NA_SHOP = [0.42, 0.34, 0.24];
const NA_OFFICE = [0.3, 0.33, 0.36];
function nickelsArcade(B, T) {
  const s = surveyAt(576, 140.25);
  if (!s) return null;
  // u along the passage from Maynard (west, u 0) to State (east, u L); v across it, south positive
  const F = wallFrame(535.5, 141, 616.25, 139.75, 0, 1), L = F.L;
  const HW = 10.1, PW = 2.4; // the block's half width, the passage's (between the shopfronts' walls)
  const P = (u, v) => [F.ax + F.tx * u + F.nx * v, F.az + F.tz * u + F.nz * v];
  const gAt = (u, v = 0) => groundHeight(...P(u, v));
  const gW = gAt(-1.5), gE = gAt(L + 1.5);
  let gMin = Math.min(gW, gE);
  for (let u = 0; u <= L; u += 4) for (const v of [-HW, 0, HW]) gMin = Math.min(gMin, gAt(u, v));
  // the floors are level from the higher street; the shopfronts and fronts come down to the ground in front of them
  const gT = Math.max(gW, gE), H = (y) => gT + y;
  // (over the city's paved slab, which is drawn 0.16 m over the ground: ground-lifts.js)
  const floorAt = (u) => gAt(Math.max(0, Math.min(L, u))) + LIFT.lawn + 0.03;
  const bx = (u0, u1, y0, y1, v0, v1, col, m = B.stone) => T.ebox(F, u0, u1, y0, y1, v0, v1, col, m);
  const W3 = (u, y, v) => { const [x, z] = P(u, v); return [x, y, z]; };
  const ROOF_Y = 10.6, EAVE = 10.6, RIDGE = 12.0, TOP = 12.4;

  // the two ranges either side of the passage, the roof over them, parapets round the outside
  for (const sg of [-1, 1]) {
    bx(0, L, gMin - 1, H(ROOF_Y), sg * PW, sg * HW, NA_PLASTER);
    bx(0, L, H(ROOF_Y), H(ROOF_Y + 0.05), sg * PW, sg * HW, ROOF);
    bx(0, L, H(ROOF_Y), H(TOP - 0.9), sg * (HW - 0.3), sg * HW, NA_PLASTER);
    // the skylight's curb along the passage
    bx(0, L, H(ROOF_Y - 0.1), H(ROOF_Y + 0.3), sg * PW, sg * (PW + 0.35), NA_TERRA_DARK);
    // rooftop units back from the streets
    bx(30 + sg * 12, 34 + sg * 12, H(ROOF_Y), H(ROOF_Y + 1.4), sg * 5.5, sg * 8, [0.6, 0.61, 0.61]);
  }

  // the floor: red square tiles set in black, a row every 0.6 m following the ground (and a little out of each end)
  const TL = 0.6, TN = 8, tw = (2 * PW) / TN;
  const flat = (ua, ub, va, vb, yy, col) => B.quad(B.stone, W3(ua, yy, va), W3(ua, yy, vb), W3(ub, yy, vb), W3(ub, yy, va), col);
  for (let u = -0.6; u < L + 0.6; u += TL) {
    const y = floorAt(u + TL / 2);
    flat(u, u + TL, -PW, PW, y, NA_JOINT);
    for (let k = 0; k < TN; k++) flat(u + 0.035, u + TL - 0.035, -PW + k * tw + 0.035, -PW + (k + 1) * tw - 0.035, y + 0.012, NA_TILE);
  }

  // a box between two points in the (v, y) plane at u, w along u, t thick (a rafter or a bar)
  const beam = (u, va, ya, vb, yb, w, t, col) => {
    const dv = vb - va, dy = yb - ya, l = Math.hypot(dv, dy) || 1, ov = (-dy / l) * t, oy = (dv / l) * t;
    const c = [[va, ya], [vb, yb], [vb - ov, yb - oy], [va - ov, ya - oy]];
    const p = (k, du) => W3(u + du, c[k][1], c[k][0]);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; B.quad(B.stone, p(k, -w / 2), p(j, -w / 2), p(j, w / 2), p(k, w / 2), col); }
    B.quad(B.stone, p(0, -w / 2), p(3, -w / 2), p(2, -w / 2), p(1, -w / 2), col);
    B.quad(B.stone, p(0, w / 2), p(1, w / 2), p(2, w / 2), p(3, w / 2), col);
  };
  // the gable skylight: wire glass between iron rafters every 1.5 m, glazing bars, purlins, the ridge and eave bars
  const n = Math.round(L / 1.5), du = L / n;
  for (let k = 0; k < n; k++) {
    const u0 = k * du, u1 = u0 + du;
    for (const sg of [-1, 1]) {
      B.quad(B.skylight, W3(u0, H(EAVE), sg * PW), W3(u1, H(EAVE), sg * PW), W3(u1, H(RIDGE), 0), W3(u0, H(RIDGE), 0), [0.8, 0.86, 0.82]);
      beam(u0 + du / 2, sg * PW, H(EAVE) + 0.02, 0, H(RIDGE) + 0.02, 0.04, 0.05, NA_IRON);
      beam(u0, sg * PW, H(EAVE) - 0.02, 0, H(RIDGE) - 0.02, 0.09, 0.16, NA_IRON);
    }
  }
  for (const sg of [-1, 1]) beam(L, sg * PW, H(EAVE) - 0.02, 0, H(RIDGE) - 0.02, 0.09, 0.16, NA_IRON);
  bx(0, L, H(RIDGE) - 0.1, H(RIDGE) + 0.08, -0.08, 0.08, NA_IRON);
  for (const sg of [-1, 1]) {
    bx(0, L, H(EAVE) - 0.16, H(EAVE) + 0.02, sg * (PW - 0.1), sg * PW, NA_IRON);
    for (const f of [1 / 3, 2 / 3]) {
      const v = sg * PW * (1 - f), y = H(EAVE + (RIDGE - EAVE) * f);
      bx(0, L, y - 0.08, y - 0.02, v - 0.03, v + 0.03, NA_IRON);
    }
  }

  // an arch's soffit: segmental, half span hs rising `rise` from the spring at ys (round when rise = hs)
  const soffit = (hs, rise, ys) => {
    const R = (hs * hs + rise * rise) / (2 * rise), yc = ys + rise - R;
    return (v) => yc + Math.sqrt(Math.max(0, R * R - v * v));
  };
  // the wall over an arch, from its soffit (and a band `ring` deep round it) up to yt, in slices across it
  // (each slice's underside runs straight from one end's height on the curve to the other's, so the arch reads smooth)
  const vyPrism = (u0, u1, q, col, m = B.stone) => {
    const p = (k, u) => W3(u, q[k][1], q[k][0]);
    for (let k = 0; k < 4; k++) { const j = (k + 1) % 4; B.quad(m, p(k, u0), p(j, u0), p(j, u1), p(k, u1), col); }
    B.quad(m, p(0, u0), p(1, u0), p(2, u0), p(3, u0), col);
    B.quad(m, p(3, u1), p(2, u1), p(1, u1), p(0, u1), col);
  };
  const archFill = (u0, u1, hs, rise, ys, yt, col, m, ring, ringCol, ringU) => {
    const f = soffit(hs, rise, ys), N = Math.max(16, Math.round(hs * 8));
    for (let k = 0; k < N; k++) {
      const va = -hs + (2 * hs * k) / N, vb = va + (2 * hs) / N, ya = f(va), yb = f(vb);
      vyPrism(u0, u1, [[va, ya + ring], [vb, yb + ring], [vb, yt], [va, yt]], col, m);
      vyPrism(ringU[0], ringU[1], [[va, ya], [vb, yb], [vb, yb + ring], [va, ya + ring]], ringCol);
    }
  };

  // the segmental arches across the gallery: at the State St third, and the Maynard vestibule's
  const arches = [7.3, L - 26.7];
  for (const ua of arches) {
    const a0 = ua - 0.35, a1 = ua + 0.35;
    for (const sg of [-1, 1]) {
      bx(a0, a1, floorAt(ua) - 0.1, H(7.6), sg * PW, sg * (PW - 0.45), NA_TERRA);
      bx(a0 - 0.08, a1 + 0.08, floorAt(ua) - 0.1, floorAt(ua) + 0.5, sg * PW, sg * (PW - 0.52), NA_TERRA_DARK);
      bx(a0 - 0.08, a1 + 0.08, H(7.45), H(7.75), sg * PW, sg * (PW - 0.55), NA_TERRA_DARK);
    }
    archFill(a0, a1, PW - 0.45, 1.0, H(7.6), H(EAVE), NA_TERRA, B.stone, 0.3, NA_TERRA_DARK, [a0 - 0.06, a1 + 0.06]);
    bx(a0 - 0.1, a1 + 0.1, H(8.45), H(9.0), -0.25, 0.25, NA_TERRA_DARK);
  }

  // the shopfronts down each side, in bays of about 4.2 m between terra cotta piers, and the office windows over them
  const sections = [[0.6, 7.3 - 0.45], [7.3 + 0.45, L - 26.7 - 0.45], [L - 26.7 + 0.45, L - 0.6]];
  for (const sg of [-1, 1]) {
    const v = (d) => sg * (PW - d);
    for (const [si, [s0, s1]] of sections.entries()) {
      const face = si === 2 ? NA_TERRA : NA_PLASTER;
      // the gallery's wall over the shops, and its cornices
      bx(s0 - 0.3, s1 + 0.3, H(5.2), H(EAVE), v(0), v(0.02), face);
      bx(s0 - 0.3, s1 + 0.3, H(5.15), H(5.5), v(0), v(0.3), NA_TERRA_DARK);
      bx(s0 - 0.3, s1 + 0.3, H(9.0), H(9.4), v(0), v(0.38), NA_TERRA_DARK);
      const nb = Math.max(1, Math.round((s1 - s0) / 4.2)), w = (s1 - s0) / nb;
      for (let k = 0; k <= nb; k++) bx(s0 + k * w - 0.2, s0 + k * w + 0.2, floorAt(s0 + k * w) - 0.1, H(9.0), v(0), v(0.2), NA_TERRA);
      for (let k = 0; k < nb; k++) {
        const u0 = s0 + k * w + 0.2, u1 = u0 + w - 0.4, c = (u0 + u1) / 2, f = floorAt(c);
        const left = (k + (sg > 0 ? 1 : 0) + si) % 2 === 0, door = left ? [u0 + 0.1, u0 + 1.15] : [u1 - 1.15, u1 - 0.1];
        const g0 = left ? door[1] + 0.06 : u0 + 0.05, g1 = left ? u1 - 0.05 : door[0] - 0.06;
        // a dark-painted wooden front: bulkhead, display glass, the door, the transom lights, a fascia and the mezzanine
        bx(u0, u1, f - 0.06, H(5.2), v(0), v(0.02), NA_WOOD);
        bx(g0, g1, f - 0.06, f + 0.5, v(0), v(0.16), NA_WOOD);
        bx(g0, g1, f + 0.5, f + 2.7, v(0.1), v(0.12), NA_SHOP, B.glass);
        bx(door[0], door[1], f, f + 2.25, v(0.04), v(0.06), [0.25, 0.22, 0.18], B.glass);
        for (const ue of [door[0] - 0.06, door[1]]) bx(ue, ue + 0.06, f, f + 2.7, v(0), v(0.14), NA_WOOD);
        bx(door[0], door[1], f + 2.25, f + 2.32, v(0), v(0.14), NA_WOOD);
        bx(u0, u1, f + 2.7, f + 2.82, v(0), v(0.16), NA_WOOD);
        bx(u0, u1, f + 2.82, f + 3.4, v(0.1), v(0.12), [0.62, 0.6, 0.5], B.glass);
        for (let t = u0 + 0.45; t < u1 - 0.2; t += 0.45) bx(t - 0.02, t + 0.02, f + 2.82, f + 3.4, v(0.1), v(0.15), NA_WOOD);
        bx(u0, u1, f + 3.4, f + 3.95, v(0), v(0.22), NA_WOOD);
        bx(u0, u1, f + 3.95, H(4.95), v(0.1), v(0.12), NA_OFFICE, B.glass);
        for (const t of [u0 + (u1 - u0) / 3, u0 + (2 * (u1 - u0)) / 3]) bx(t - 0.04, t + 0.04, f + 3.95, H(4.95), v(0.1), v(0.16), NA_WOOD);
        bx(u0, u1, H(4.95), H(5.15), v(0), v(0.18), NA_WOOD);
        // two office windows above, a sash bar and a stone sill each
        for (const o of [-0.25, 0.25]) {
          const wc = c + o * (u1 - u0), a = wc - 0.6, b = wc + 0.6;
          bx(a, b, H(6.0), H(8.3), v(0.0), v(0.03), NA_OFFICE, B.glass);
          bx(a - 0.06, b + 0.06, H(5.9), H(6.0), v(0), v(0.12), NA_TERRA_DARK);
          bx(a - 0.06, b + 0.06, H(8.3), H(8.4), v(0), v(0.08), NA_WOOD);
          for (const e of [a - 0.06, b]) bx(e, e + 0.06, H(6.0), H(8.3), v(0), v(0.08), NA_WOOD);
          bx(a, b, H(7.12), H(7.18), v(0), v(0.06), NA_WOOD);
        }
      }
    }
  }
  // lamps hung down the middle on rods from the ridge
  for (let u = 4; u < L - 2; u += 6.5) {
    if (arches.some((a) => Math.abs(a - u) < 1.2)) continue;
    bx(u - 0.02, u + 0.02, H(7.7), H(RIDGE - 0.1), -0.02, 0.02, NA_IRON);
    bx(u - 0.2, u + 0.2, H(7.2), H(7.7), -0.2, 0.2, [1, 0.86, 0.62], B.glass);
    bx(u - 0.26, u + 0.26, H(7.65), H(7.75), -0.26, 0.26, NA_IRON);
  }

  // State St: buff terra cotta in three bays, giant pilasters, the round-arched portico in the middle, a cornice and
  // a raised parapet over the arch (no lettering)
  const fe = (u0, u1, y0, y1, v0, v1, col, m) => bx(L + u0, L + u1, y0, y1, v0, v1, col, m);
  fe(-0.02, 0.02, gE - 0.5, H(11.75), -HW, -2.5, NA_TERRA);
  fe(-0.02, 0.02, gE - 0.5, H(11.75), 2.5, HW, NA_TERRA);
  archFill(L - 0.6, L + 0.02, 2.5, 2.5, H(5.6), H(11.75), NA_TERRA, B.stone, 0.4, NA_TERRA_DARK, [L, L + 0.18]);
  fe(0, 0.3, H(7.85), H(8.6), -0.3, 0.3, NA_TERRA_DARK); // the keystone
  // a fanlight in the arch's head over an iron transom bar
  {
    const f = soffit(2.5, 2.5, H(5.6)), N = 16;
    fe(-0.3, -0.18, H(5.5), H(5.68), -2.5, 2.5, NA_IRON);
    for (let k = 0; k < N; k++) {
      const va = -2.5 + (5 * k) / N, vb = va + 5 / N;
      fe(-0.28, -0.26, H(5.68), f((va + vb) / 2), va, vb, [0.55, 0.6, 0.62], B.aoGlass);
    }
    for (const vv of [-1.25, 0, 1.25]) fe(-0.3, -0.24, H(5.68), f(vv), vv - 0.03, vv + 0.03, NA_IRON);
  }
  for (const sg of [-1, 1]) {
    // giant pilasters either side of the arch and at the corners, base blocks and capitals
    for (const [a, b] of [[2.5, 3.5], [HW - 0.8, HW]]) {
      fe(0, 0.4, gE - 0.4, H(10.5), sg * a, sg * b, NA_TERRA);
      fe(0, 0.5, gE - 0.4, H(0.9), sg * (a - 0.08), sg * (b + 0.08), NA_TERRA_DARK);
      fe(0, 0.55, H(10.2), H(10.6), sg * (a - 0.1), sg * (b + 0.1), NA_TERRA_DARK);
    }
    // the flanking bay: shop window and transom, a panel, then the second- and third-floor windows in threes
    const v0 = sg * 3.6, v1 = sg * (HW - 0.9), vm = (v0 + v1) / 2, hw = Math.abs(v1 - v0) / 2;
    const gs = gAt(L + 1.5, vm);
    fe(0, 0.16, gs - 0.3, gs + 0.5, v0, v1, NA_TERRA_DARK);
    fe(0.04, 0.06, gs + 0.5, H(3.4), v0, v1, NA_SHOP, B.glass);
    for (const t of [-hw / 3, hw / 3]) fe(0.04, 0.12, gs + 0.5, H(3.4), vm + t - 0.04, vm + t + 0.04, NA_WOOD);
    fe(0, 0.14, H(3.4), H(3.55), v0, v1, NA_WOOD);
    fe(0.04, 0.06, H(3.55), H(4.5), v0, v1, [0.62, 0.6, 0.5], B.glass);
    for (let t = -hw + 0.5; t < hw - 0.2; t += 0.5) fe(0.04, 0.1, H(3.55), H(4.5), vm + t - 0.02, vm + t + 0.02, NA_WOOD);
    fe(0, 0.2, H(4.5), H(4.7), v0, v1, NA_TERRA_DARK);
    fe(0, 0.12, H(4.9), H(5.6), vm - hw + 0.3, vm + hw - 0.3, NA_TERRA_DARK);
    for (const [y0, y1] of [[6.0, 8.3], [8.9, 10.0]]) {
      fe(-0.2, -0.18, H(y0), H(y1), vm - hw + 0.25, vm + hw - 0.25, NA_OFFICE, B.aoGlass);
      for (const t of [-hw + 0.25, -hw / 3, hw / 3, hw - 0.25]) fe(-0.2, 0.02, H(y0), H(y1), vm + t - 0.18, vm + t + 0.18, NA_TERRA);
      fe(-0.2, 0.12, H(y0 - 0.15), H(y0), vm - hw + 0.1, vm + hw - 0.1, NA_TERRA_DARK);
      fe(-0.2, 0.02, H(y1), H(y1 + 0.15), vm - hw + 0.25, vm + hw - 0.25, NA_TERRA);
    }
  }
  // the entablature, cornice and parapet over all three bays, raised over the arch
  fe(0, 0.45, H(10.6), H(11.3), -HW, HW, NA_TERRA);
  fe(0, 0.75, H(11.3), H(11.55), -HW - 0.1, HW + 0.1, NA_TERRA_DARK);
  fe(-0.3, 0.3, H(11.55), H(TOP), -HW, HW, NA_TERRA);
  fe(-0.3, 0.35, H(TOP), H(TOP + 0.12), -HW, HW, NA_TERRA_DARK);
  fe(-0.3, 0.3, H(TOP), H(13.1), -3.5, 3.5, NA_TERRA);
  fe(-0.32, 0.36, H(13.1), H(13.25), -3.6, 3.6, NA_TERRA_DARK);
  fe(0.3, 0.36, H(11.8), H(12.9), -2.9, 2.9, NA_TERRA_DARK);

  // Maynard: yellow brick, terra cotta trim, a lower round arch into the vestibule, shop windows either side, two rows
  // of paired windows, a terra cotta cornice
  const fw = (u0, u1, y0, y1, v0, v1, col, m) => bx(-u1, -u0, y0, y1, v0, v1, col, m);
  fw(-0.02, 0.02, gW - 0.5, H(TOP - 0.3), -HW, -2.4, NA_BRICK, B.brick);
  fw(-0.02, 0.02, gW - 0.5, H(TOP - 0.3), 2.4, HW, NA_BRICK, B.brick);
  archFill(-0.02, 0.5, 2.4, 2.4, H(3.6), H(TOP - 0.3), NA_BRICK, B.brick, 0.35, NA_TERRA, [-0.15, 0]);
  fw(0, 0.22, H(5.65), H(6.3), -0.28, 0.28, NA_TERRA_DARK);
  for (const sg of [-1, 1]) {
    fw(0, 0.3, gW - 0.4, H(3.6), sg * 2.4, sg * 3.0, NA_TERRA);
    const v0 = sg * 3.6, v1 = sg * (HW - 0.8), vm = (v0 + v1) / 2, hw = Math.abs(v1 - v0) / 2;
    const gs = gAt(-1.5, vm);
    fw(0, 0.14, gs - 0.3, gs + 0.5, v0, v1, NA_TERRA_DARK);
    fw(0.03, 0.05, gs + 0.5, H(3.3), v0, v1, NA_SHOP, B.glass);
    fw(0, 0.12, H(3.3), H(3.5), v0 - sg * 0.1, v1 + sg * 0.1, NA_TERRA);
    for (const [y0, y1] of [[5.0, 7.3], [8.1, 10.0]]) {
      for (const o of [-0.5, 0.5]) {
        const c = vm + o * hw, a = c - 0.75, b = c + 0.75;
        fw(-0.18, -0.16, H(y0), H(y1), a, b, NA_OFFICE, B.aoGlass);
        fw(-0.18, 0.12, H(y0 - 0.15), H(y0), a - 0.1, b + 0.1, NA_TERRA);
        fw(-0.18, 0.06, H(y1), H(y1 + 0.25), a - 0.15, b + 0.15, NA_TERRA);
        for (const e of [a - 0.15, b]) fw(-0.18, 0.0, H(y0), H(y1), e, e + 0.15, NA_BRICK, B.brick);
        fw(-0.16, -0.12, H(y0 + (y1 - y0) * 0.55), H(y0 + (y1 - y0) * 0.55 + 0.05), a, b, NA_WOOD);
      }
    }
  }
  fw(0, 0.1, gW - 0.5, H(TOP - 0.3), -HW, -HW + 0.5, NA_BRICK, B.brick);
  fw(0, 0.1, gW - 0.5, H(TOP - 0.3), HW - 0.5, HW, NA_BRICK, B.brick);
  fw(0, 0.4, H(10.6), H(10.9), -HW - 0.05, HW + 0.05, NA_TERRA);
  fw(-0.3, 0.3, H(TOP - 0.3), H(TOP - 0.15), -HW, HW, NA_TERRA_DARK);

  // colliders: the two ranges (to their shopfronts' faces), the arches' piers, and the roof over the gallery
  const poly = (u0, u1, v0, v1, y0, y1) => {
    const outer = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)].map(([x, z]) => ({ x, z }));
    const xs = outer.map((q) => q.x), zs = outer.map((q) => q.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: y0, maxY: y1, polygon: { outer, holes: [] }, keepsSurvey: true };
  };
  const colliders = [poly(0, L, -HW, -(PW - 0.12), gMin - 1, H(TOP)), poly(0, L, PW - 0.12, HW, gMin - 1, H(TOP))];
  for (const ua of arches) for (const sg of [-1, 1]) colliders.push(poly(ua - 0.4, ua + 0.4, sg * PW, sg * (PW - 0.5), gMin - 1, H(EAVE)));
  colliders.push(poly(0, L, -PW, PW, H(9.6), H(RIDGE)));
  return { s, maxY: H(13.25), colliders };
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
  ['Tower Plaza', towerPlaza],
  ['Gandy Dancer', gandyDancer],
  ['Amtrak Station', amtrakStation],
  ['Huron High School', huronHigh],
  ['Atomic Object', atomicObject],
  ['Nickels Arcade', nickelsArcade]
];

// Face brick in running bond (modular courses 68 mm, bricks 203 mm), joints a little darker and each brick a shade off
// its neighbours; past 9-24 m it settles to the plain colour so it doesn't shimmer. The courses run along whichever of
// x and z the wall faces across; a top face is left plain.
function brickMaterial() {
  // (the colour attribute read in colorNode only: with vertexColors on as well it would be multiplied in twice)
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const n = normalWorld;
  const along = mix(positionWorld.x, positionWorld.z, step(abs(n.z), abs(n.x)));
  const y = positionWorld.y.div(0.0677), row = floor(y);
  const u = along.div(0.203).add(row.mul(0.5));
  const near = float(1).sub(smoothstep(9, 24, positionWorld.distance(cameraPosition))).mul(step(abs(n.y), 0.5));
  const joint = max(step(fract(y), 0.15), step(fract(u), 0.045)).mul(near);
  const tone = mx_noise_float(vec3(floor(u), row, 0.5)).mul(0.08).mul(near).add(1);
  m.colorNode = vertexColor().mul(tone).mul(float(1).sub(joint.mul(0.28)));
  return m;
}

// Plate glass that gives back the sky and the street (the landmarks' glass, nearly a mirror), still lit from inside at
// dusk and night as theirs is
function clearGlass() {
  const m = landmarkGlass();
  m.roughness = 0.04;
  m.metalness = 0.92;
  return m;
}

// Wire glass, one see-through material (on the Xbox a pale opaque tint): a little green, a little milky, and lit from
// below at dusk and night as the gallery's lamps come on
function skylightGlass() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0xd4e2dc, roughness: 0.35, metalness: 0.1, side: THREE.DoubleSide,
    transparent: !XBOX, opacity: XBOX ? 1 : 0.34, depthWrite: XBOX });
  m.emissiveNode = color(0xffd7a0).mul(mix(float(XBOX ? 0.05 : 0.01), float(0.55), smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow)));
  return m;
}

function buildMoreLandmarks(group, colliders) {
  const B = builder(), T = tools(B), built = [];
  B.brick = { pos: [], col: [] };
  B.aoGlass = { pos: [], col: [] };
  B.skylight = { pos: [], col: [] };
  for (const [name, make] of MODELS) {
    const made = make(B, T);
    if (!made) continue;
    for (const { s, maxY, open, colliders: own } of [].concat(made)) {
      // the first strip carries the survey block it replaces (an open shed's strip is only a post's footprint; a model
      // with a way through it, as Nickels Arcade, gives its own walls)
      const c = own || (open ? [{ minX: s.b.cx - 0.2, maxX: s.b.cx + 0.2, minZ: s.b.cz - 0.2, maxZ: s.b.cz + 0.2, maxY, keepsSurvey: true }] : strips(s.ring, maxY));
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
    mesh(B.glass, landmarkGlass(), 'MoreLandmarksGlass'),
    mesh(B.brick, brickMaterial(), 'MoreLandmarksBrick'),
    mesh(B.aoGlass, clearGlass(), 'MoreLandmarksClearGlass'));
  // the arcade's wire-glass skylight lets the sun through (no shadow of its own, only its iron's) and glows at night
  if (B.skylight.pos.length) {
    const sky = mesh(B.skylight, skylightGlass(), 'MoreLandmarksSkylight');
    sky.castShadow = false;
    sky.receiveShadow = false;
    sky.renderOrder = 2;
    group.add(sky);
  }
  return built;
}

export { buildMoreLandmarks };
