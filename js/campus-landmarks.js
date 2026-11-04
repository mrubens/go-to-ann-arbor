import * as THREE from 'three/webgpu';
import { groundHeight } from './terrain.js';

// Lamp: three of campus's landmarks modelled by hand in place of the survey's plain blocks, on their real outlines
// (city-geodata.js's landmarks):
// - Burton Memorial Tower (Albert Kahn, 1936): a 192 ft limestone carillon tower on a 42 ft square, corner piers
//   rising past slit windows to a clock on each face, the tall louvered bell chamber at 120 ft, stepped setbacks and a
//   copper roof.
// - Hill Auditorium (Kahn, 1913): a red-brown brick hall behind a lobby front on North University, its limestone
//   base, giant pilasters between five tall arched windows, an entablature and cornice, and a low hipped roof.
// - The Michigan Union (Pond & Pond, 1919): Collegiate Gothic red brick with limestone trim and crenellated parapets,
//   its square tower over the State Street entrance with a two-storey oriel window.
// Each is two meshes (masonry, glass) of vertex colors. Their outlines go into the landmarks' colliders, which keep
// the survey's buildings out from under them.

const LIMESTONE = [0.85, 0.81, 0.73];
const LIMESTONE_DARK = [0.74, 0.70, 0.62];
const BRICK_HILL = [0.55, 0.32, 0.24];
const BRICK_UNION = [0.52, 0.27, 0.2];
const COPPER = [0.37, 0.56, 0.49];
const ROOF = [0.27, 0.27, 0.29];
const LOUVER = [0.13, 0.12, 0.11];
const DOOR = [0.2, 0.13, 0.08];
const CLOCK = [0.94, 0.91, 0.82];
const GOLD = [0.78, 0.62, 0.28];
const GLASS = [0.16, 0.2, 0.26];

function builder() {
  const stone = { pos: [], col: [] }, glass = { pos: [], col: [] };
  const lin = new Map();
  const linear = (c) => { if (!lin.has(c)) lin.set(c, c.map((v) => v ** 2.2)); return lin.get(c); };
  const tri = (m, a, b, c, col) => {
    m.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const l = linear(col);
    for (let k = 0; k < 3; k++) m.col.push(l[0], l[1], l[2]);
  };
  const quad = (m, a, b, c, d, col) => { tri(m, a, b, c, col); tri(m, a, c, d, col); };
  // an axis-aligned box (no bottom)
  const box = (x0, x1, y0, y1, z0, z1, col, m = stone) => {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    quad(m, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], col);
    quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);
    quad(m, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
    quad(m, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col);
    quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
  };
  // a box on one face of a block centred at (cx, cz): u along the face, d out from it (from the face at `half`)
  const faceBox = (cx, cz, half, side, u0, u1, y0, y1, d0, d1, col, m = stone) => {
    const [nx, nz] = SIDES[side], tx = -nz, tz = nx;
    const ax = cx + nx * (half + d0) + tx * u0, az = cz + nz * (half + d0) + tz * u0;
    const bx = cx + nx * (half + d1) + tx * u1, bz = cz + nz * (half + d1) + tz * u1;
    box(ax, bx, y0, y1, az, bz, col, m);
  };
  // a flat disc standing on a face, d out from it
  const faceDisc = (cx, cz, half, side, u, y, r, d, col, m = stone, n = 24) => {
    const [nx, nz] = SIDES[side], tx = -nz, tz = nx;
    const P = (a, rr) => [cx + nx * (half + d) + tx * (u + Math.cos(a) * rr), y + Math.sin(a) * rr, cz + nz * (half + d) + tz * (u + Math.cos(a) * rr)];
    const c = P(0, 0);
    for (let k = 0; k < n; k++) tri(m, c, P(((k + 1) / n) * Math.PI * 2, r), P((k / n) * Math.PI * 2, r), col);
  };
  // a round-topped window on a face (an arch of `n` steps over its rectangle)
  const faceArch = (cx, cz, half, side, u, y0, y1, w, d, col, m = glass) => {
    const r = w / 2;
    faceBox(cx, cz, half, side, u - r, u + r, y0, y1 - r, d, d + 0.06, col, m);
    const steps = 5;
    for (let k = 0; k < steps; k++) {
      const a = ((k + 0.5) / steps) * (Math.PI / 2), hw = Math.cos(a) * r;
      faceBox(cx, cz, half, side, u - hw, u + hw, y1 - r + Math.sin((k / steps) * Math.PI / 2) * r,
        y1 - r + Math.sin(((k + 1) / steps) * Math.PI / 2) * r, d, d + 0.06, col, m);
    }
  };
  // walls of a ring (x, z pairs), from y0 to y1, with a flat top
  const prism = (ring, y0, y1, col, top = col) => {
    const pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      quad(stone, [a.x, y0, a.y], [b.x, y0, b.y], [b.x, y1, b.y], [a.x, y1, a.y], col);
    }
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, []))
      tri(stone, [pts[i].x, y1, pts[i].y], [pts[j].x, y1, pts[j].y], [pts[k].x, y1, pts[k].y], top);
  };
  // windows along every wall of a ring: `floors` [y0, y1] rows, one every `every` m along each wall, set `d` out
  const ringWindows = (ring, floors, every, w, col, d = 0.04) => {
    const n = ring.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const s = area > 0 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < every * 1.2) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz * s, nz = tx * s;
      const count = Math.floor(L / every);
      const off = (L - count * every) / 2 + every / 2;
      for (let k = 0; k < count; k++) {
        const u = off + k * every, ox = ax + tx * u + nx * d, oz = az + tz * u + nz * d;
        for (const [y0, y1] of floors) {
          const p = (uu, y) => [ox + tx * uu, y, oz + tz * uu];
          quad(glass, p(-w / 2, y0), p(w / 2, y0), p(w / 2, y1), p(-w / 2, y1), col);
          // a limestone sill under each
          const q = (uu, y, dd) => [ox + tx * uu + nx * dd, y, oz + tz * uu + nz * dd];
          quad(stone, q(-w / 2 - 0.1, y0 - 0.05, 0.12), q(w / 2 + 0.1, y0 - 0.05, 0.12), q(w / 2 + 0.1, y0 - 0.05, 0), q(-w / 2 - 0.1, y0 - 0.05, 0), LIMESTONE);
          quad(stone, q(-w / 2 - 0.1, y0 - 0.2, 0.12), q(w / 2 + 0.1, y0 - 0.2, 0.12), q(w / 2 + 0.1, y0 - 0.05, 0.12), q(-w / 2 - 0.1, y0 - 0.05, 0.12), LIMESTONE);
        }
      }
    }
  };
  // crenellations along every wall of a ring, on top of y
  const ringBattlements = (ring, y, h, merlon, col) => {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      // the parapet's coping, then a merlon every other step
      for (let u = 0; u < L; u += merlon * 2) {
        const u1 = Math.min(L, u + merlon);
        const p = (uu, yy) => [ax + tx * uu, yy, az + tz * uu];
        quad(stone, p(u, y), p(u1, y), p(u1, y + h), p(u, y + h), col);
        quad(stone, p(u1, y + h), p(u1, y), p(u, y), p(u, y + h), col);
      }
    }
  };
  const hip = (x0, x1, z0, z1, y0, y1, col) => {
    // a hipped roof: a ridge along the longer side
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
    if (hx >= hz) {
      const r0 = [x0 + hz, y1, cz], r1 = [x1 - hz, y1, cz];
      quad(stone, [x0, y0, z0], r0, r1, [x1, y0, z0], col);
      quad(stone, [x1, y0, z1], r1, r0, [x0, y0, z1], col);
      tri(stone, [x0, y0, z1], r0, [x0, y0, z0], col);
      tri(stone, [x1, y0, z0], r1, [x1, y0, z1], col);
    } else {
      const r0 = [cx, y1, z0 + hx], r1 = [cx, y1, z1 - hx];
      quad(stone, [x1, y0, z0], r0, r1, [x1, y0, z1], col);
      quad(stone, [x0, y0, z1], r1, r0, [x0, y0, z0], col);
      tri(stone, [x0, y0, z0], r0, [x1, y0, z0], col);
      tri(stone, [x1, y0, z1], r1, [x0, y0, z1], col);
    }
  };
  return { stone, glass, tri, quad, box, faceBox, faceDisc, faceArch, prism, ringWindows, ringBattlements, hip };
}
// the four faces: north (-z), east (+x), south (+z), west (-x)
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const groundOf = (ring) => {
  let g = Infinity;
  for (let i = 0; i < ring.length; i += 2) g = Math.min(g, groundHeight(ring[i], ring[i + 1]));
  return g;
};

// Burton Memorial Tower: 58.5 m (192 ft) over its 12.8 m square, the bell chamber's floor at 36.6 m (120 ft)
function burtonTower(B, site) {
  const ring = site.ring;
  const cx = (ring[0] + ring[2] + ring[4] + ring[6]) / 4, cz = (ring[1] + ring[3] + ring[5] + ring[7]) / 4;
  const g = groundOf(ring) - 0.3;
  const H = 6.4, BELL = 36.6;
  const Y = (y) => g + y;
  // a darker plinth, the shaft, and its four corner piers standing proud of the faces
  B.box(cx - H - 0.25, cx + H + 0.25, g - 2, Y(1.4), cz - H - 0.25, cz + H + 0.25, LIMESTONE_DARK);
  B.box(cx - H + 0.3, cx + H - 0.3, Y(1.4), Y(BELL), cz - H + 0.3, cz + H - 0.3, LIMESTONE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    B.box(cx + sx * H, cx + sx * (H - 2.6), Y(1.4), Y(BELL + 1.2), cz + sz * H, cz + sz * (H - 2.6), LIMESTONE);
  for (let side = 0; side < 4; side++) {
    // three slit windows a floor up the middle of each face, between fluted piers, under limestone spandrels
    for (let f = 0; f < 8; f++) {
      const y0 = 4 + f * 3.4;
      for (const u of [-1.7, 0, 1.7]) B.faceBox(cx, cz, H - 0.3, side, u - 0.35, u + 0.35, Y(y0), Y(y0 + 2.5), 0.02, 0.05, GLASS, B.glass);
    }
    for (const u of [-2.55, -0.85, 0.85, 2.55]) B.faceBox(cx, cz, H - 0.3, side, u - 0.16, u + 0.16, Y(3.4), Y(31), 0, 0.16, LIMESTONE_DARK);
    // the door on the north face, under a stone hood
    if (side === 0) {
      B.faceBox(cx, cz, H - 0.3, side, -1.3, 1.3, Y(0), Y(3.6), 0.4, 0.46, DOOR);
      B.faceBox(cx, cz, H - 0.3, side, -1.9, 1.9, Y(3.6), Y(4.2), 0, 0.8, LIMESTONE_DARK);
    }
    // the clock: a cream dial on a stone panel, its ring and hours in gold, its hands at ten past ten
    B.faceBox(cx, cz, H - 0.3, side, -2.6, 2.6, Y(31.2), Y(36.2), 0, 0.12, LIMESTONE_DARK);
    B.faceDisc(cx, cz, H - 0.3, side, 0, Y(33.7), 2.15, 0.14, GOLD);
    B.faceDisc(cx, cz, H - 0.3, side, 0, Y(33.7), 1.95, 0.16, CLOCK);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2, r = 1.68;
      B.faceDisc(cx, cz, H - 0.3, side, Math.cos(a) * r, Y(33.7) + Math.sin(a) * r, h % 3 ? 0.07 : 0.13, 0.18, LOUVER, B.stone, 6);
    }
    const hand = (a, len, w) => {
      const ux = Math.cos(a), uy = Math.sin(a);
      const [nx, nz] = SIDES[side], tx = -nz, tz = nx;
      const P = (u, y) => [cx + nx * (H - 0.3 + 0.2) + tx * u, Y(33.7) + y, cz + nz * (H - 0.3 + 0.2) + tz * u];
      B.quad(B.stone, P(-uy * w, ux * w), P(ux * len - uy * w, uy * len + ux * w), P(ux * len + uy * w, uy * len - ux * w), P(uy * w, -ux * w), LOUVER);
    };
    hand(Math.PI / 2 - (10 + 10 / 60) / 12 * Math.PI * 2, 1.05, 0.07);
    hand(Math.PI / 2 - (10 / 60) * Math.PI * 2, 1.6, 0.05);
  }
  // a cornice, then the bell chamber, set back, with three tall louvered openings a face
  B.box(cx - H - 0.15, cx + H + 0.15, Y(BELL), Y(BELL + 1.2), cz - H - 0.15, cz + H + 0.15, LIMESTONE_DARK);
  const BH = 5.7, TOP = BELL + 12;
  B.box(cx - BH, cx + BH, Y(BELL + 1.2), Y(TOP), cz - BH, cz + BH, LIMESTONE);
  for (let side = 0; side < 4; side++) {
    for (const u of [-2.6, 0, 2.6]) {
      B.faceArch(cx, cz, BH, side, u, Y(BELL + 2.4), Y(TOP - 1.2), 1.5, 0.01, LOUVER, B.stone);
      for (let k = 0; k < 9; k++) B.faceBox(cx, cz, BH, side, u - 0.72, u + 0.72, Y(BELL + 2.8 + k * 0.85), Y(BELL + 2.95 + k * 0.85), 0, 0.12, LIMESTONE_DARK);
    }
    for (const u of [-1.3, 1.3]) B.faceBox(cx, cz, BH, side, u - 0.22, u + 0.22, Y(BELL + 1.2), Y(TOP), 0, 0.2, LIMESTONE);
  }
  // stepped setbacks, then a copper roof
  B.box(cx - BH - 0.2, cx + BH + 0.2, Y(TOP), Y(TOP + 0.8), cz - BH - 0.2, cz + BH + 0.2, LIMESTONE_DARK);
  B.box(cx - 4.9, cx + 4.9, Y(TOP + 0.8), Y(TOP + 3), cz - 4.9, cz + 4.9, LIMESTONE);
  B.box(cx - 4.1, cx + 4.1, Y(TOP + 3), Y(TOP + 4.8), cz - 4.1, cz + 4.1, LIMESTONE);
  B.box(cx - 4.3, cx + 4.3, Y(TOP + 4.8), Y(TOP + 5.3), cz - 4.3, cz + 4.3, LIMESTONE_DARK);
  B.hip(cx - 4.0, cx + 4.0, cz - 4.0, cz + 4.0, Y(TOP + 5.3), Y(58.5), COPPER);
  return { minX: cx - H - 0.3, maxX: cx + H + 0.3, minZ: cz - H - 0.3, maxZ: cz + H + 0.3, maxY: Y(58.5) };
}

// Hill Auditorium: its lobby front along North University (the outline's north part), the hall behind it
function hillAuditorium(B, site) {
  const g = groundOf(site.ring) - 0.3;
  const Y = (y) => g + y;
  // the hall: the outline's back, brick over a limestone base, under a low hipped roof
  const hx0 = 742.6, hx1 = 795.4, hz0 = 39.2, hz1 = 81.4;
  const hall = [hx0, hz0, hx1, hz0, hx1, hz1, hx0, hz1];
  B.prism(hall, g - 2, Y(3), LIMESTONE_DARK);
  B.prism(hall, Y(3), Y(15.5), BRICK_HILL, ROOF);
  B.box(hx0 - 0.3, hx1 + 0.3, Y(15.5), Y(16.3), hz0 - 0.3, hz1 + 0.3, LIMESTONE);
  B.hip(hx0 + 1, hx1 - 1, hz0 + 1, hz1 - 1, Y(16.3), Y(22), ROOF);
  B.ringWindows([hx1, hz0, hx1, hz1, hx0, hz1, hx0, hz0], [[4.5, 7.5], [9.5, 13.5]], 4.6, 1.5, GLASS);
  // the lobby front: limestone base, five tall arched windows between giant pilasters, an entablature and cornice
  const fx0 = 751.8, fx1 = 786.9, fz = 27.9, fz1 = 44;
  const fcx = (fx0 + fx1) / 2, half = (fz1 - fz) / 2, fcz = (fz + fz1) / 2;
  B.box(fx0, fx1, g - 2, Y(4.2), fz, fz1, LIMESTONE_DARK);
  B.box(fx0, fx1, Y(4.2), Y(15), fz + 0.4, fz1, BRICK_HILL);
  B.box(fx0 - 0.2, fx1 + 0.2, Y(15), Y(16.6), fz, fz1, LIMESTONE);
  B.box(fx0 - 0.5, fx1 + 0.5, Y(16.6), Y(17.3), fz - 0.4, fz1, LIMESTONE_DARK);
  B.box(fx0 + 0.6, fx1 - 0.6, Y(17.3), Y(18.6), fz + 0.4, fz1 - 0.6, LIMESTONE);
  // (faces seen from the north: u along the face runs east to west)
  const W = fx1 - fx0, bays = 5, bay = (W - 4) / bays;
  for (let k = 0; k <= bays; k++) {
    const u = -W / 2 + 2 + k * bay;
    // the giant pilasters, with a base and capital
    B.faceBox(fcx, fcz, half, 0, u - 0.6, u + 0.6, Y(4.2), Y(15), -0.4, 0.15, LIMESTONE);
    B.faceBox(fcx, fcz, half, 0, u - 0.8, u + 0.8, Y(14.3), Y(15), -0.4, 0.3, LIMESTONE);
    B.faceBox(fcx, fcz, half, 0, u - 0.8, u + 0.8, Y(4.2), Y(4.8), -0.4, 0.3, LIMESTONE);
  }
  for (let k = 0; k < bays; k++) {
    const u = -W / 2 + 2 + (k + 0.5) * bay;
    B.faceArch(fcx, fcz, half, 0, u, Y(5.6), Y(14), bay - 2.4, -0.38, GLASS);
    // mullions and a transom in each window
    B.faceBox(fcx, fcz, half, 0, u - 0.06, u + 0.06, Y(5.6), Y(13.4), -0.32, -0.28, LIMESTONE);
    B.faceBox(fcx, fcz, half, 0, u - (bay - 2.4) / 2, u + (bay - 2.4) / 2, Y(10.2), Y(10.4), -0.32, -0.28, LIMESTONE);
    // a door under each, under a limestone lintel, up three steps
    B.faceBox(fcx, fcz, half, 0, u - 1.1, u + 1.1, Y(0.9), Y(3.6), 0.01, 0.05, DOOR);
    B.faceBox(fcx, fcz, half, 0, u - 1.5, u + 1.5, Y(3.6), Y(4.0), 0, 0.25, LIMESTONE);
  }
  for (let k = 0; k < 3; k++) B.faceBox(fcx, fcz, half, 0, -W / 2 + 1, W / 2 - 1, g - 1, Y(0.3 * (3 - k)), 0, 0.5 + k * 0.45, LIMESTONE_DARK);
  // the side wings flanking the front, a storey lower
  B.box(hx0, fx0, g - 2, Y(12), hz0 - 0.2, hz0 + 6, BRICK_HILL);
  B.box(fx1, hx1, g - 2, Y(12), hz0 - 0.2, hz0 + 6, BRICK_HILL);
  B.box(hx0 - 0.2, fx0, Y(12), Y(12.7), hz0 - 0.4, hz0 + 6, LIMESTONE);
  B.box(fx1, hx1 + 0.2, Y(12), Y(12.7), hz0 - 0.4, hz0 + 6, LIMESTONE);
  return { minX: hx0 - 0.2, maxX: hx1 + 0.2, minZ: fz - 1.5, maxZ: hz1 + 0.2, maxY: Y(22) };
}

// The Michigan Union: its real outline in red brick with limestone bands and battlements, and its tower over the
// State Street door (the outline's west front, between its two wings)
function michiganUnion(B, site) {
  const ring = site.ring;
  const g = groundOf(ring) - 0.3;
  const Y = (y) => g + y;
  B.prism(ring, g - 2, Y(1.4), LIMESTONE_DARK);
  B.prism(ring, Y(1.4), Y(16), BRICK_UNION, ROOF);
  B.ringWindows(ring, [[2.4, 4.6], [5.8, 8], [9.2, 11.4], [12.6, 14.6]], 3.3, 1.5, GLASS, 0.03);
  // limestone string courses and a crenellated parapet with its coping
  for (const [y0, y1] of [[5.2, 5.5], [15.6, 16.1]]) {
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const a = [ring[i], ring[i + 1]], b = [ring[j], ring[j + 1]];
      B.quad(B.stone, [a[0], Y(y0), a[1]], [b[0], Y(y0), b[1]], [b[0], Y(y1), b[1]], [a[0], Y(y1), a[1]], LIMESTONE);
    }
  }
  B.prism(ring, Y(16), Y(16.9), BRICK_UNION, ROOF);
  B.ringBattlements(ring, Y(16.9), 0.8, 1.0, LIMESTONE);
  // the tower: 12 m square, its face on the front between the wings, up to 33 m with corner piers and pinnacles
  const tz = 500.6, th = 6.2, tx0 = 529.6;
  const tcx = tx0 + th, tcz = tz;
  B.box(tx0, tx0 + 2 * th, g - 2, Y(1.4), tz - th, tz + th, LIMESTONE_DARK);
  B.box(tx0, tx0 + 2 * th, Y(1.4), Y(30), tz - th, tz + th, BRICK_UNION);
  for (const sz of [-1, 1]) for (const sx of [0, 1]) {
    const x = tx0 + sx * 2 * th, z = tz + sz * th;
    B.box(x - 0.8, x + 0.8, Y(1.4), Y(31.2), z - 0.8, z + 0.8, BRICK_UNION);
    B.box(x - 0.95, x + 0.95, Y(31.2), Y(31.6), z - 0.95, z + 0.95, LIMESTONE);
    B.hip(x - 0.7, x + 0.7, z - 0.7, z + 0.7, Y(31.6), Y(34), LIMESTONE);
  }
  for (const y of [5.2, 17.5, 28.6]) B.box(tx0 - 0.15, tx0 + 2 * th + 0.15, Y(y), Y(y + 0.4), tz - th - 0.15, tz + th + 0.15, LIMESTONE);
  B.box(tx0 - 0.1, tx0 + 2 * th + 0.1, Y(30), Y(30.6), tz - th - 0.1, tz + th + 0.1, LIMESTONE);
  B.ringBattlements([tx0, tz - th, tx0, tz + th, tx0 + 2 * th, tz + th, tx0 + 2 * th, tz - th], Y(30.6), 0.9, 0.9, LIMESTONE);
  // the front: a Tudor-arched door in a limestone surround, the two-storey oriel above, tall windows to the top
  const S = 3; // west
  B.faceBox(tcx, tcz, th, S, -2.6, 2.6, Y(0), Y(5), 0, 0.35, LIMESTONE);
  B.faceArch(tcx, tcz, th, S, 0, Y(0.2), Y(4.4), 2.8, 0.36, DOOR, B.stone);
  B.faceBox(tcx, tcz, th, S, -3, 3, Y(6), Y(14.5), 0, 1.1, LIMESTONE);
  for (const u of [-2.1, -0.7, 0.7, 2.1]) {
    B.faceBox(tcx, tcz, th, S, u - 0.55, u + 0.55, Y(6.6), Y(9.6), 1.1, 1.14, GLASS, B.glass);
    B.faceBox(tcx, tcz, th, S, u - 0.55, u + 0.55, Y(10.4), Y(13.8), 1.1, 1.14, GLASS, B.glass);
  }
  B.box(tx0 - 1.25, tx0 + 0.2, Y(14.5), Y(15.1), tz - 3.2, tz + 3.2, LIMESTONE_DARK);
  for (let side = 0; side < 4; side++) {
    for (const u of [-2.2, 0, 2.2]) {
      if (side === S) {
        B.faceArch(tcx, tcz, th, side, u, Y(18.4), Y(27.8), 1.3, 0.03, GLASS);
      } else {
        B.faceBox(tcx, tcz, th, side, u - 0.6, u + 0.6, Y(18.6), Y(22.4), 0.03, 0.06, GLASS, B.glass);
        B.faceArch(tcx, tcz, th, side, u, Y(23.4), Y(27.8), 1.2, 0.03, GLASS);
      }
    }
  }
  // the box the colliders take: the outline's own extent
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]); maxZ = Math.max(maxZ, ring[i + 1]);
  }
  return { minX: minX - 0.3, maxX: maxX + 0.3, minZ: minZ - 0.3, maxZ: maxZ + 0.3, maxY: Y(34) };
}

const MODELS = [
  ['Burton Memorial Tower', burtonTower],
  ['Hill Auditorium', hillAuditorium],
  ['Michigan Union', michiganUnion]
];

function buildCampusLandmarks(group, colliders, sites) {
  const B = builder();
  const built = [];
  for (const [name, make] of MODELS) {
    const site = sites[name];
    if (!site || !site.ring) continue;
    colliders.push(make(B, site));
    built.push(name);
  }
  const mesh = (m, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const out = new THREE.Mesh(geo, mat);
    out.castShadow = true;
    out.receiveShadow = true;
    return out;
  };
  const stone = mesh(B.stone, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }));
  stone.name = 'CampusLandmarkMasonry';
  const glass = mesh(B.glass, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide, emissive: 0x1c1409 }));
  glass.name = 'CampusLandmarkGlass';
  group.add(stone, glass);
  return built;
}

export { buildCampusLandmarks, builder, groundOf };
