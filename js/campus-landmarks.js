import * as THREE from 'three/webgpu';
import { color, float, mix, smoothstep } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { groundHeight } from './terrain.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';
import { gameTime } from './game-clock.js';
import { setBellTower } from './burton-bells.js';

// Lamp: three of campus's landmarks modelled by hand in place of the survey's plain blocks, on their real outlines
// (city-geodata.js's landmarks):
// - Burton Memorial Tower (Albert Kahn, 1936): a 192 ft limestone carillon tower on a 42 ft square, corner piers
//   rising past slit windows to a clock on each face, the tall louvered bell chamber at 120 ft, stepped setbacks and a
//   copper roof.
// - Hill Auditorium (Kahn, 1913): a red-brown brick hall behind a lobby front on North University, its limestone
//   base, giant pilasters between five tall arched windows, an entablature and cornice; the hall's sides in bays of
//   brick pilasters, round-arched windows over low ones, a modillioned cornice, a low hipped roof with ventilators,
//   the taller stage house at the back, and the wings either side of the front.
// - The Michigan Union (Pond & Pond, 1919): Collegiate Gothic red brick with limestone trim, buttresses, mullioned
//   windows and battlements, its turreted tower over a carved limestone entrance on State Street.
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
    // a big arch needs finer steps to read as a curve
    const steps = Math.max(5, Math.round(w * 1.6));
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
  // windows along every wall of a ring: `floors` [y0, y1] rows over `base` (the building's ground), one every `every` m
  // along each wall, set `d` out
  const ringWindows = (ring, floors, every, w, col, d = 0.04, base = groundOf(ring) - 0.3) => {
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
        for (const [r0, r1] of floors) {
          const y0 = base + r0, y1 = base + r1;
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
    // the clock: a cream dial on a stone panel, its ring and hours in gold; its hands turn with the time the game shows
    // (burtonHands)
    B.faceBox(cx, cz, H - 0.3, side, -2.6, 2.6, Y(31.2), Y(36.2), 0, 0.12, LIMESTONE_DARK);
    B.faceDisc(cx, cz, H - 0.3, side, 0, Y(33.7), 2.15, 0.14, GOLD);
    B.faceDisc(cx, cz, H - 0.3, side, 0, Y(33.7), 1.95, 0.16, CLOCK);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2, r = 1.68;
      B.faceDisc(cx, cz, H - 0.3, side, Math.cos(a) * r, Y(33.7) + Math.sin(a) * r, h % 3 ? 0.07 : 0.13, 0.18, LOUVER, B.stone, 6);
    }
    const [nx, nz] = SIDES[side];
    DIALS.push({ x: cx + nx * (H - 0.3), y: Y(33.7), z: cz + nz * (H - 0.3), nx, nz });
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
  // the bells hang in the chamber (burton-bells.js)
  setBellTower({ x: cx, y: Y(BELL + 6), z: cz });
  return { minX: cx - H - 0.3, maxX: cx + H + 0.3, minZ: cz - H - 0.3, maxZ: cz + H + 0.3, maxY: Y(58.5) };
}

// Hill Auditorium: its lobby front along North University (the outline's north part), the hall behind it
function hillAuditorium(B, site) {
  const g = groundOf(site.ring) - 0.3;
  const Y = (y) => g + y;
  // the hall: the outline's back, brick over a limestone base. Down its sides, brick pilasters with stone caps between
  // bays of a low window under a stone lintel and a tall round-arched window over it in a stone arch with a keystone;
  // a stone frieze, a row of modillions and the cornice over them; a low hipped roof with two ventilators on its
  // ridge; and at the back the taller stage house, blind brick but for a few small windows, its loading door and the
  // stage door under a little stone hood
  const hx0 = 742.6, hx1 = 795.4, hz0 = 39.2, hz1 = 81.4;
  const hall = [hx0, hz0, hx1, hz0, hx1, hz1, hx0, hz1];
  const hcx = (hx0 + hx1) / 2, hcz = (hz0 + hz1) / 2, hw = (hx1 - hx0) / 2, hd = (hz1 - hz0) / 2;
  B.prism(hall, g - 2, Y(3), LIMESTONE_DARK);
  B.prism(hall, Y(3), Y(15.5), BRICK_HILL, ROOF);
  B.box(hx0 - 0.15, hx1 + 0.15, Y(2.8), Y(3.1), hz0 - 0.15, hz1 + 0.15, LIMESTONE);
  for (const side of [1, 3]) {
    // u runs along the side; the front's wings cover its first 6 m
    const u0 = side === 1 ? -hd + 6.5 : -hd + 0.5, u1 = side === 1 ? hd - 0.5 : hd - 6.5, n = 7, bay = (u1 - u0) / n;
    for (let k = 0; k <= n; k++) {
      const u = u0 + k * bay;
      B.faceBox(hcx, hcz, hw, side, u - 0.45, u + 0.45, Y(3), Y(15.2), 0, 0.35, BRICK_HILL);
      B.faceBox(hcx, hcz, hw, side, u - 0.55, u + 0.55, Y(14.6), Y(15.2), 0, 0.42, LIMESTONE);
      B.faceBox(hcx, hcz, hw, side, u - 0.55, u + 0.55, Y(3), Y(3.6), 0, 0.42, LIMESTONE);
    }
    for (let k = 0; k < n; k++) {
      const u = u0 + (k + 0.5) * bay;
      B.faceBox(hcx, hcz, hw, side, u - 1.0, u + 1.0, Y(4.6), Y(7.2), 0.02, 0.06, GLASS, B.glass);
      B.faceBox(hcx, hcz, hw, side, u - 1.2, u + 1.2, Y(7.2), Y(7.6), 0, 0.16, LIMESTONE);
      B.faceBox(hcx, hcz, hw, side, u - 1.15, u + 1.15, Y(4.4), Y(4.6), 0, 0.16, LIMESTONE);
      B.faceArch(hcx, hcz, hw, side, u, Y(8.6), Y(14.0), 2.5, 0.01, LIMESTONE, B.stone);
      B.faceArch(hcx, hcz, hw, side, u, Y(8.8), Y(13.8), 1.9, 0.04, GLASS);
      B.faceBox(hcx, hcz, hw, side, u - 0.05, u + 0.05, Y(8.8), Y(13.0), 0.05, 0.1, LIMESTONE);
      B.faceBox(hcx, hcz, hw, side, u - 0.95, u + 0.95, Y(11.2), Y(11.3), 0.05, 0.1, LIMESTONE);
      B.faceBox(hcx, hcz, hw, side, u - 0.22, u + 0.22, Y(13.6), Y(14.2), 0, 0.14, LIMESTONE_DARK);
      B.faceBox(hcx, hcz, hw, side, u - 1.25, u + 1.25, Y(8.45), Y(8.6), 0, 0.16, LIMESTONE);
    }
  }
  // the frieze, the modillions under the cornice, the cornice
  B.box(hx0 - 0.2, hx1 + 0.2, Y(15.2), Y(16.1), hz0 - 0.2, hz1 + 0.2, LIMESTONE);
  for (const side of [1, 2, 3]) {
    const half = side === 2 ? hd : hw, len = side === 2 ? hw : hd;
    for (let u = -len + 0.4; u < len - 0.3; u += 0.8) B.faceBox(hcx, hcz, half, side, u - 0.12, u + 0.12, Y(16.1), Y(16.35), 0.2, 0.6, LIMESTONE_DARK);
  }
  B.box(hx0 - 0.7, hx1 + 0.7, Y(16.35), Y(16.8), hz0 - 0.7, hz1 + 0.7, LIMESTONE);
  B.hip(hx0 - 0.4, hx1 + 0.4, hz0 - 0.4, hz1 - 12, Y(16.8), Y(21.2), ROOF);
  for (const x of [hcx - 8, hcx + 8]) {
    B.box(x - 1.3, x + 1.3, Y(19.5), Y(21.9), hz0 + 12, hz0 + 14.6, [0.35, 0.36, 0.36]);
    B.hip(x - 1.6, x + 1.6, hz0 + 11.7, hz0 + 14.9, Y(21.9), Y(22.7), ROOF);
  }
  // the stage house at the back: brick to 21 m, a stone band and coping, its own low hip
  const sz0 = hz1 - 13, sx0 = hx0 + 2, sx1 = hx1 - 2;
  B.box(sx0, sx1, Y(15.5), Y(21), sz0, hz1, BRICK_HILL);
  B.box(sx0 - 0.15, sx1 + 0.15, Y(20.4), Y(21.3), sz0 - 0.15, hz1 + 0.15, LIMESTONE);
  B.hip(sx0 - 0.3, sx1 + 0.3, sz0 - 0.3, hz1 + 0.3, Y(21.3), Y(23.4), ROOF);
  // its back wall (south): a stone band at each floor, a few small windows high up, the loading door and stage door
  for (const y of [7.5, 12.5]) B.faceBox(hcx, hcz, hd, 2, -hw, hw, Y(y), Y(y + 0.3), 0, 0.12, LIMESTONE);
  for (const u of [-18, -12, 12, 18]) for (const y of [9, 14, 17.5]) B.faceBox(hcx, hcz, hd, 2, u - 0.7, u + 0.7, Y(y), Y(y + 1.8), 0.02, 0.06, GLASS, B.glass);
  B.faceBox(hcx, hcz, hd, 2, 4, 9, Y(0), Y(5.2), 0.02, 0.06, [0.3, 0.32, 0.33]);
  for (let y = 0.4; y < 5.1; y += 0.35) B.faceBox(hcx, hcz, hd, 2, 4, 9, Y(y), Y(y + 0.04), 0.06, 0.08, [0.22, 0.23, 0.24]);
  B.faceBox(hcx, hcz, hd, 2, 3.7, 9.3, Y(5.2), Y(5.6), 0, 0.2, LIMESTONE);
  B.faceBox(hcx, hcz, hd, 2, -6.6, -5.2, Y(0.3), Y(2.7), 0.02, 0.06, DOOR);
  B.faceBox(hcx, hcz, hd, 2, -7.2, -4.6, Y(2.9), Y(3.15), 0, 1.4, LIMESTONE);
  for (const u of [-14, 14]) B.faceBox(hcx, hcz, hd, 2, u - 0.9, u + 0.9, Y(4.4), Y(6.6), 0.02, 0.06, GLASS, B.glass);
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
  // the side wings flanking the front, a storey lower: brick on the stone base, a stone band and cornice, pairs of
  // windows on their fronts and outer sides
  for (const [x0, x1, outer] of [[hx0, fx0, 3], [fx1, hx1, 1]]) {
    B.box(x0, x1, g - 2, Y(3), hz0 - 0.2, hz0 + 6, LIMESTONE_DARK);
    B.box(x0, x1, Y(3), Y(12), hz0 - 0.2, hz0 + 6, BRICK_HILL);
    B.box(x0 - 0.2, x1 + 0.2, Y(11.4), Y(12.7), hz0 - 0.4, hz0 + 6, LIMESTONE);
    B.box(x0 - 0.1, x1 + 0.1, Y(2.8), Y(3.2), hz0 - 0.3, hz0 + 6, LIMESTONE);
    const wcx = (x0 + x1) / 2, wcz = hz0 + 2.9, wd = 3.1, ww = (x1 - x0) / 2;
    for (const y of [4.2, 8.0]) {
      for (const du of [-1.1, 1.1]) {
        B.faceBox(wcx, wcz, wd, 0, du - 0.5, du + 0.5, Y(y), Y(y + 2.4), 0.02, 0.06, GLASS, B.glass);
        B.faceBox(wcx, wcz, wd, 0, du - 0.65, du + 0.65, Y(y - 0.2), Y(y), 0, 0.14, LIMESTONE);
        B.faceBox(wcx, wcz, wd, 0, du - 0.65, du + 0.65, Y(y + 2.4), Y(y + 2.7), 0, 0.14, LIMESTONE);
      }
      for (const du of [-1.2, 1.2]) {
        B.faceBox(wcx, wcz, ww, outer, du - 0.5, du + 0.5, Y(y), Y(y + 2.4), 0.02, 0.06, GLASS, B.glass);
        B.faceBox(wcx, wcz, ww, outer, du - 0.65, du + 0.65, Y(y - 0.2), Y(y), 0, 0.14, LIMESTONE);
        B.faceBox(wcx, wcz, ww, outer, du - 0.65, du + 0.65, Y(y + 2.4), Y(y + 2.7), 0, 0.14, LIMESTONE);
      }
    }
  }
  // the hall (with the wings along its front) and the lobby front with its steps, each its own box, so the walks in
  // front of the wings stay open; the survey's block is dropped (`replaces`) and its neighbors kept
  const keep = { keepsSurvey: true };
  return [
    { minX: hx0 - 0.2, maxX: hx1 + 0.2, minZ: hz0 - 0.4, maxZ: hz1 + 0.2, maxY: Y(23.4), ...keep, replaces: surveyInside(site.ring) },
    { minX: fx0 - 0.5, maxX: fx1 + 0.5, minZ: fz - 1.5, maxZ: fz1, maxY: Y(18.6), ...keep }
  ];
}

// Lamp: a kit for walls in detail, where u runs along a wall, y up, and d out from its face. A wall (E) is its start
// (ax, az), its direction (tx, tz), its outward normal (nx, nz) and its length L.
const LEAD = [0.09, 0.09, 0.1];
function wallKit(B) {
  const P = (E, u, y, d) => [E.ax + E.tx * u + E.nx * d, y, E.az + E.tz * u + E.nz * d];
  const at = (E, u, d) => P(E, u, 0, d);
  // a box on a wall (no back face where it sits on the wall, unless `back`)
  const ob = (E, u0, u1, y0, y1, d0, d1, col, m = B.stone, back = false) => {
    const p = (u, y, d) => P(E, u, y, d), q = (a, b, c, e) => B.quad(m, a, b, c, e, col);
    q(p(u0, y0, d1), p(u1, y0, d1), p(u1, y1, d1), p(u0, y1, d1));
    q(p(u0, y1, d1), p(u1, y1, d1), p(u1, y1, d0), p(u0, y1, d0));
    q(p(u0, y0, d0), p(u1, y0, d0), p(u1, y0, d1), p(u0, y0, d1));
    q(p(u0, y0, d0), p(u0, y0, d1), p(u0, y1, d1), p(u0, y1, d0));
    q(p(u1, y0, d1), p(u1, y0, d0), p(u1, y1, d0), p(u1, y1, d1));
    if (back) q(p(u1, y0, d0), p(u0, y0, d0), p(u0, y1, d0), p(u1, y1, d0));
  };
  // a sloped stone weathering: its top falls from d0 at y1 to d1 at y0
  const wedge = (E, u0, u1, y0, y1, d0, d1, col) => {
    const p = (u, y, d) => P(E, u, y, d);
    B.quad(B.stone, p(u0, y1, d0), p(u0, y0, d1), p(u1, y0, d1), p(u1, y1, d0), col);
    B.tri(B.stone, p(u0, y0, d0), p(u0, y0, d1), p(u0, y1, d0), col);
    B.tri(B.stone, p(u1, y0, d1), p(u1, y0, d0), p(u1, y1, d0), col);
    B.quad(B.stone, p(u0, y0, d0), p(u1, y0, d0), p(u1, y0, d1), p(u0, y0, d1), col);
  };
  const V2 = (pts) => pts.map(([u, y]) => new THREE.Vector2(u, y));
  // a flat outline of [u, y] points laid on the wall at d
  const fill = (E, pts, d, col, m = B.stone) => {
    const v = V2(pts), tris = THREE.ShapeUtils.triangulateShape(v, []);
    for (const [i, j, k] of tris) B.tri(m, P(E, v[i].x, v[i].y, d), P(E, v[j].x, v[j].y, d), P(E, v[k].x, v[k].y, d), col);
  };
  // an outline with holes cut through it, standing from d0 to d1: its face, and the reveals round its edges and holes
  const slab = (E, outline, holes, d0, d1, col, m = B.stone) => {
    const o = V2(outline), hs = holes.map(V2);
    const tris = THREE.ShapeUtils.triangulateShape(o, hs), all = o.concat(...hs);
    for (const [i, j, k] of tris) B.tri(m, P(E, all[i].x, all[i].y, d1), P(E, all[j].x, all[j].y, d1), P(E, all[k].x, all[k].y, d1), col);
    for (const r of [o, ...hs]) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      B.quad(m, P(E, a.x, a.y, d0), P(E, b.x, b.y, d0), P(E, b.x, b.y, d1), P(E, a.x, a.y, d1), col);
    }
  };
  const rect = (u0, u1, y0, y1) => [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
  // a four-centred (Tudor) arch over a span of 2r, springing at y = 0: quarter-span arcs at the haunches running on in
  // straight lines to a low point at the crown; its points from (r, 0) over the crown to (-r, 0)
  const tudorRise = (r) => r * 0.866;
  const tudor = (r, n = 7) => {
    const r1 = r * 0.5, th = Math.PI / 3, side = [];
    for (let k = 0; k <= n; k++) { const a = (k / n) * th; side.push([r - r1 + r1 * Math.cos(a), r1 * Math.sin(a)]); }
    return [...side, [0, tudorRise(r)], ...side.slice().reverse().map(([u, y]) => [-u, y])];
  };
  // an arched opening centred at uc: its sill at yb, its arch springing at ys
  const archShape = (uc, r, yb, ys) => [[uc - r, yb], [uc + r, yb], ...tudor(r).map(([u, y]) => [uc + u, ys + y])];
  // the moulding of one arched order, from its outer span R in to r
  const archBand = (uc, R, r, yb, ys) => [[uc - R, yb], ...tudor(R).reverse().map(([u, y]) => [uc + u, ys + y]), [uc + R, yb],
    [uc + r, yb], ...tudor(r).map(([u, y]) => [uc + u, ys + y]), [uc - r, yb]];
  const disc = (E, u, y, r, d, col, n = 16) => {
    const c = P(E, u, y, d);
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      B.tri(B.stone, c, P(E, u + Math.cos(a0) * r, y + Math.sin(a0) * r, d), P(E, u + Math.cos(a1) * r, y + Math.sin(a1) * r, d), col);
    }
  };
  // a stone window of `lights` lights between mullions, cut by transoms, the top lights Tudor-arched if `arch`: leaded
  // glass, the frame standing proud of the wall, and (unless `plain`) a sloped sill and a hood mould with its returns
  const win = (E, u, y0, y1, lights, { arch = false, transoms = [], lw = 0.78, mul = 0.16, f = 0.14, plain = false } = {}) => {
    const W = lights * lw + (lights - 1) * mul, L0 = u - W / 2, holes = [];
    const cuts = [y0, ...transoms.flatMap((t) => [t - 0.06, t + 0.06]), y1];
    for (let k = 0; k < lights; k++) {
      const a = L0 + k * (lw + mul), b = a + lw, c = (a + b) / 2;
      for (let s = 0; s < cuts.length; s += 2) {
        const top = s + 2 >= cuts.length && arch, h0 = cuts[s], h1 = top ? cuts[s + 1] - tudorRise(lw / 2) : cuts[s + 1];
        const hole = top ? archShape(c, lw / 2, h0, h1) : rect(a, b, h0, h1);
        holes.push(hole);
        fill(E, hole, 0.02, GLASS, B.glass);
        // the leading: a bar up the middle and one across every 0.6 m or so
        ob(E, c - 0.012, c + 0.012, h0, top ? cuts[s + 1] : h1, 0.02, 0.03, LEAD, B.stone);
        const bars = Math.floor((h1 - h0) / 0.6);
        for (let j = 1; j <= bars; j++) { const y = h0 + ((h1 - h0) * j) / (bars + 1); ob(E, a, b, y - 0.012, y + 0.012, 0.02, 0.03, LEAD, B.stone); }
      }
    }
    slab(E, rect(L0 - f, L0 + W + f, y0 - 0.08, y1 + f), holes, 0, 0.1, LIMESTONE);
    if (plain) return;
    ob(E, L0 - f - 0.08, L0 + W + f + 0.08, y0 - 0.24, y0 - 0.12, 0, 0.18, LIMESTONE);
    wedge(E, L0 - f - 0.08, L0 + W + f + 0.08, y0 - 0.12, y0 - 0.06, 0.1, 0.18, LIMESTONE);
    const hu0 = L0 - f - 0.14, hu1 = L0 + W + f + 0.14, hy = y1 + f;
    ob(E, hu0, hu1, hy, hy + 0.13, 0, 0.15, LIMESTONE);
    ob(E, hu0, hu0 + 0.16, hy - 0.4, hy, 0, 0.15, LIMESTONE);
    ob(E, hu1 - 0.16, hu1, hy - 0.4, hy, 0, 0.15, LIMESTONE);
  };
  // a solid along a plan of [u, d] points that starts and ends on the wall, from yA to yB, capped top and bottom
  const bayPrism = (E, pts, yA, yB, col) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ua, da] = pts[i], [ub, db] = pts[i + 1];
      B.quad(B.stone, P(E, ua, yA, da), P(E, ub, yA, db), P(E, ub, yB, db), P(E, ua, yB, da), col);
    }
    for (const y of [yA, yB]) for (let i = 1; i + 1 < pts.length; i++)
      B.tri(B.stone, P(E, pts[0][0], y, pts[0][1]), P(E, pts[i][0], y, pts[i][1]), P(E, pts[i + 1][0], y, pts[i + 1][1]), col);
  };
  // a three-sided stone oriel standing out of the wall at u, w wide and `depth` deep, from y0 to y1: corbelled out in
  // three courses below, `rows` storeys of mullioned lights round its faces, and a battlemented top
  const oriel = (E, u, y0, y1, w, depth, rows = 2) => {
    const wf = w - 1.6 * depth;
    const plan = (s, grow = 0) => {
      const fu = wf / 2 + ((1 - s) * (w - wf)) / 2;
      return [[u - w / 2 - grow, 0], [u - fu - grow, depth * s + grow], [u + fu + grow, depth * s + grow], [u + w / 2 + grow, 0]];
    };
    for (let k = 1; k <= 3; k++) bayPrism(E, plan(1 - 0.25 * k, 0.04 * (3 - k)), y0 - 0.3 * k, y0 - 0.3 * (k - 1), LIMESTONE);
    bayPrism(E, plan(1), y0, y1, LIMESTONE);
    bayPrism(E, plan(1, 0.12), y1, y1 + 0.28, LIMESTONE);
    bayPrism(E, plan(1), y1 + 0.28, y1 + 0.8, LIMESTONE);
    const pts = plan(1), c = at(E, u, depth * 0.3);
    for (let i = 0; i < 3; i++) {
      const A = at(E, pts[i][0], pts[i][1]), Bp = at(E, pts[i + 1][0], pts[i + 1][1]);
      const L = Math.hypot(Bp[0] - A[0], Bp[2] - A[2]), tx = (Bp[0] - A[0]) / L, tz = (Bp[2] - A[2]) / L;
      let nx = -tz, nz = tx;
      if (nx * ((A[0] + Bp[0]) / 2 - c[0]) + nz * ((A[2] + Bp[2]) / 2 - c[2]) < 0) { nx = -nx; nz = -nz; }
      const F = { ax: A[0], az: A[2], tx, tz, nx, nz, L };
      const lights = Math.max(1, Math.round((L - 0.4) / 0.9)), lw = Math.min(0.72, (L - 0.45 - (lights - 1) * 0.13) / lights);
      const rowH = (y1 - y0 - 0.5 - rows * 0.45) / rows;
      for (let r = 0; r < rows; r++) {
        const ry0 = y0 + 0.5 + r * (rowH + 0.45);
        win(F, L / 2, ry0, ry0 + rowH, lights, { lw, mul: 0.13, f: 0.1, plain: true, arch: r === rows - 1 });
      }
      const n = Math.max(1, Math.floor(L / 0.8));
      for (let k = 0; k < n; k++) { const m = ((k + 0.5) / n) * L; ob(F, m - 0.2, m + 0.2, y1 + 0.8, y1 + 1.25, -0.3, 0, LIMESTONE, B.stone, true); }
    }
  };
  // an octagonal shaft round (cx, cz), r to its corners, its faces square to the axes
  const oct = (cx, cz, r, y0, y1, col, top = col) => {
    const v = [];
    for (let k = 0; k < 8; k++) { const a = ((k + 0.5) * Math.PI) / 4; v.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    for (let k = 0; k < 8; k++) {
      const a = v[k], b = v[(k + 1) % 8];
      B.quad(B.stone, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col);
      B.tri(B.stone, [cx, y1, cz], [a[0], y1, a[1]], [b[0], y1, b[1]], top);
    }
  };
  const octCone = (cx, cz, r, y0, y1, col) => {
    for (let k = 0; k < 8; k++) {
      const a = ((k + 0.5) * Math.PI) / 4, b = ((k + 1.5) * Math.PI) / 4;
      B.tri(B.stone, [cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, y0, cz + Math.sin(b) * r], [cx, y1, cz], col);
    }
  };
  // one face of an octagon as a wall, u from its middle
  const octFace = (cx, cz, r, k) => {
    const a = (k * Math.PI) / 4, nx = Math.cos(a), nz = Math.sin(a), ap = r * Math.cos(Math.PI / 8);
    return { ax: cx + nx * ap, az: cz + nz * ap, tx: -nz, tz: nx, nx, nz, L: 2 * r * Math.sin(Math.PI / 8) };
  };
  // one face of a square block centred at (cx, cz) as a wall, u from its middle
  const face = (cx, cz, half, side) => {
    const [nx, nz] = SIDES[side];
    return { ax: cx + nx * half, az: cz + nz * half, tx: -nz, tz: nx, nx, nz, L: half * 2 };
  };
  // every wall of a ring, facing out, each knowing whether its ends turn outward (s0, s1 = 1), inward (-1) or run on (0)
  const edges = (ring) => {
    const n = ring.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]; }
    const s = area > 0 ? -1 : 1, out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.3) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      out.push({ ax, az, tx, tz, nx: -tz * s, nz: tx * s, L, s0: 0, s1: 0 });
    }
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length], c = a.nx * b.tx + a.nz * b.tz;
      const turn = c < -0.3 ? 1 : c > 0.3 ? -1 : 0;
      a.s1 = turn; b.s0 = turn;
    }
    return out;
  };
  return { P, at, ob, wedge, fill, slab, rect, tudorRise, archShape, archBand, disc, win, oriel, oct, octCone, octFace, face, edges };
}

// The Michigan Union: Collegiate Gothic red brick on its real outline. A limestone plinth and water table, string
// courses, clasping buttresses at the corners with stepped set-offs, brick pilasters between bays, mullioned and
// transomed limestone windows (Tudor-arched lights on the ground floor) with sills and hood moulds, two-storey oriels
// on the State Street wings, a corbelled cornice and battlements with coping. Over the State Street door rises the
// tower: octagonal corner turrets with their own battlements and slit windows, a great three-light window, and in front
// a limestone frontispiece with a deep, moulded Tudor-arched portal, its oriel, a blind arcade, buttresses and pinnacles.
function michiganUnion(B, site) {
  const ring = site.ring;
  const g = groundOf(ring) - 0.3;
  const Y = (y) => g + y;
  const K = wallKit(B);
  // the entrance bay's own points come out of the outline: it's built as a frontispiece of its own
  const main = [];
  for (let i = 0; i < ring.length; i += 2) if (!(ring[i] > 602.5 && ring[i + 1] > 487 && ring[i + 1] < 498)) main.push(ring[i], ring[i + 1]);
  const T = { x0: 590.0, x1: 601.6, z0: 486.8, z1: 498.4 }, tcx = (T.x0 + T.x1) / 2, tcz = (T.z0 + T.z1) / 2, th = 5.8, TOP = 32.4;
  const nearTower = (x, z, m) => x > T.x0 - m && x < 604.5 && z > T.z0 - m && z < T.z1 + m;
  const ORIELS = [[601.0, 480.6], [601.7, 510.5]];
  B.prism(main, g - 2, Y(1.4), LIMESTONE_DARK);
  B.prism(main, Y(1.4), Y(18.9), BRICK_UNION, ROOF);
  const FLOORS = [
    { y0: 2.4, y1: 4.6, arch: true },
    { y0: 6.4, y1: 9.0, transoms: [8.0] },
    { y0: 9.9, y1: 12.3, transoms: [11.4] },
    { y0: 13.2, y1: 15.4 },
    { y0: 16.2, y1: 17.8 }
  ];
  for (const E of K.edges(main)) {
    const mid = K.at(E, E.L / 2, 0);
    if (nearTower(mid[0], mid[2], 0.5)) continue; // behind the tower
    const ext = (d) => [-E.s0 * d, E.L + E.s1 * d];
    const band = (y0, y1, d, col = LIMESTONE) => { const [u0, u1] = ext(d); K.ob(E, u0, u1, Y(y0), Y(y1), 0, d, col); };
    // the plinth and its sloped water table, the string courses and the corbelled cornice
    band(-2, 1.25, 0.12, LIMESTONE_DARK);
    { const [u0, u1] = ext(0.12); K.wedge(E, u0, u1, Y(1.25), Y(1.5), 0, 0.12, LIMESTONE_DARK); }
    band(5.2, 5.7, 0.16);
    band(18.2, 18.45, 0.1);
    band(18.45, 18.9, 0.22);
    // the parapet, its coping, and battlements along it
    { const [u0, u1] = ext(0); K.ob(E, u0, u1, Y(18.9), Y(19.7), -0.4, 0, BRICK_UNION, B.stone, true); }
    { const [u0, u1] = ext(0.06); K.ob(E, u0, u1, Y(19.7), Y(19.9), -0.46, 0.06, LIMESTONE, B.stone, true); }
    if (E.L > 2.4) {
      const n = Math.floor((E.L - 0.4) / 1.6), off = (E.L - n * 1.6) / 2 + 0.3;
      for (let k = 0; k < n; k++) {
        const u = off + k * 1.6, p = K.at(E, u + 0.5, 0);
        if (nearTower(p[0], p[2], 0.9)) continue;
        K.ob(E, u, u + 1.0, Y(19.9), Y(20.7), -0.4, 0, BRICK_UNION, B.stone, true);
        K.ob(E, u - 0.05, u + 1.05, Y(20.7), Y(20.86), -0.45, 0.05, LIMESTONE, B.stone, true);
      }
    }
    // clasping buttresses at the outer corners, stepping back twice under sloped stone weatherings
    const pier = (atStart) => {
      const seg = (y0, y1, d, col = BRICK_UNION, d0 = 0) => atStart ? K.ob(E, -d, 0.9, Y(y0), Y(y1), d0, d, col) : K.ob(E, E.L - 0.9, E.L + d, Y(y0), Y(y1), d0, d, col);
      const slope = (y0, y1, d0, d1) => atStart ? K.wedge(E, -d1, 0.9, Y(y0), Y(y1), d0, d1, LIMESTONE) : K.wedge(E, E.L - 0.9, E.L + d1, Y(y0), Y(y1), d0, d1, LIMESTONE);
      seg(1.4, 5.2, 0.42);
      slope(5.2, 5.6, 0.28, 0.42);
      seg(5.2, 12.4, 0.28);
      slope(12.4, 12.8, 0.16, 0.28);
      seg(12.4, 21.0, 0.16);
      seg(21.0, 21.2, 0.21, LIMESTONE, -0.05);
    };
    if (E.L > 2) {
      const a = K.at(E, 0, 0), b = K.at(E, E.L, 0);
      if (E.s0 > 0 && !nearTower(a[0], a[2], 1)) pier(true);
      if (E.s1 > 0 && !nearTower(b[0], b[2], 1)) pier(false);
    }
    // the bays: pilasters between them, a window to each floor, and an oriel in the one nearest each of the wings' marks
    const a0 = E.s0 > 0 ? 1.3 : 0.4, a1 = E.L - (E.s1 > 0 ? 1.3 : 0.4), span = a1 - a0;
    if (span < 1.4) continue;
    const n = Math.max(1, Math.round(span / 3.9)), bay = span / n;
    const lights = bay > 5 ? 3 : bay > 2.7 ? 2 : 1;
    let orielK = -1;
    for (const [x, z] of ORIELS) {
      const u = (x - E.ax) * E.tx + (z - E.az) * E.tz, d = (x - E.ax) * E.nx + (z - E.az) * E.nz;
      if (Math.abs(d) < 0.8 && u > 0 && u < E.L && bay > 3.6) orielK = Math.min(n - 1, Math.max(0, Math.floor((u - a0) / bay)));
    }
    for (let k = 0; k < n; k++) {
      const u = a0 + (k + 0.5) * bay, p = K.at(E, u, 0);
      if (nearTower(p[0], p[2], 2.3)) continue;
      for (let f = 0; f < FLOORS.length; f++) {
        if (k === orielK && (f === 1 || f === 2)) continue;
        const F = FLOORS[f];
        K.win(E, u, Y(F.y0), Y(F.y1), lights, { arch: F.arch, transoms: (F.transoms || []).map(Y) });
      }
      if (k === orielK) K.oriel(E, u, Y(6.3), Y(12.8), Math.min(bay - 0.7, 3.6), 0.95, 2);
      if (k > 0) {
        const q = K.at(E, a0 + k * bay, 0);
        if (!nearTower(q[0], q[2], 1.5)) K.ob(E, a0 + k * bay - 0.24, a0 + k * bay + 0.24, Y(1.4), Y(18.2), 0, 0.12, BRICK_UNION);
      }
    }
  }

  // the tower: brick over a stone plinth, banded in limestone, battlemented, with a turret at each corner
  B.box(T.x0, T.x1, g - 2, Y(1.4), T.z0, T.z1, LIMESTONE_DARK);
  B.box(T.x0, T.x1, Y(1.4), Y(TOP), T.z0, T.z1, BRICK_UNION);
  B.box(T.x0 + 0.3, T.x1 - 0.3, Y(TOP), Y(TOP + 0.05), T.z0 + 0.3, T.z1 - 0.3, ROOF);
  const BANDS = [[5.2, 5.7, 0.16], [18.2, 18.45, 0.1], [18.45, 18.9, 0.22], [25.5, 25.8, 0.12], [31.5, 31.85, 0.12], [31.85, 32.4, 0.26]];
  for (let side = 0; side < 4; side++) {
    const F = K.face(tcx, tcz, th, side);
    for (const [y0, y1, d] of BANDS) if (!(side === 1 && y0 === 25.5)) K.ob(F, -th, th, Y(y0), Y(y1), 0, d, LIMESTONE);
    K.ob(F, -th, th, Y(TOP), Y(TOP + 0.8), -0.4, 0, BRICK_UNION, B.stone, true);
    K.ob(F, -th - 0.06, th + 0.06, Y(TOP + 0.8), Y(TOP + 1.0), -0.46, 0.06, LIMESTONE, B.stone, true);
    for (let c = -3.5; c <= 3.51; c += 1.4) {
      K.ob(F, c - 0.4, c + 0.4, Y(TOP + 1.0), Y(TOP + 1.85), -0.4, 0, BRICK_UNION, B.stone, true);
      K.ob(F, c - 0.45, c + 0.45, Y(TOP + 1.85), Y(TOP + 2.0), -0.45, 0.05, LIMESTONE, B.stone, true);
    }
    if (side === 1) {
      // the great window over State Street: three lights, two transoms, Tudor-arched heads
      K.win(F, 0, Y(20.2), Y(30.9), 3, { lw: 1.15, mul: 0.22, f: 0.2, arch: true, transoms: [Y(23.8), Y(27.4)] });
    } else {
      for (const u of [-2.3, 2.3]) {
        K.win(F, u, Y(20.2), Y(23.9), 2, { transoms: [Y(22.6)] });
        K.win(F, u, Y(26.5), Y(30.8), 2, { arch: true, transoms: [Y(28.4)] });
      }
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = tcx + sx * (th - 0.35), cz = tcz + sz * (th - 0.35);
    K.oct(cx, cz, 1.28, g - 2, Y(1.4), LIMESTONE_DARK);
    K.oct(cx, cz, 1.2, Y(1.4), Y(34.6), BRICK_UNION);
    for (const [y0, y1, d] of BANDS) K.oct(cx, cz, 1.2 + d * 0.8, Y(y0), Y(y1), LIMESTONE);
    K.oct(cx, cz, 1.36, Y(34.6), Y(34.9), LIMESTONE);
    K.oct(cx, cz, 1.48, Y(34.9), Y(35.8), BRICK_UNION, ROOF);
    K.oct(cx, cz, 1.55, Y(35.8), Y(35.95), LIMESTONE, ROOF);
    for (let k = 0; k < 8; k++) {
      const Fk = K.octFace(cx, cz, 1.48, k);
      K.ob(Fk, -0.2, 0.2, Y(35.95), Y(36.7), -0.3, 0, BRICK_UNION, B.stone, true);
      K.ob(Fk, -0.24, 0.24, Y(36.7), Y(36.82), -0.34, 0.04, LIMESTONE, B.stone, true);
      // slit windows on its outward faces, all the way up on the front pair
      const a = (k * Math.PI) / 4;
      if (Math.cos(a) * sx + Math.sin(a) * sz < 0.2) continue;
      const S = K.octFace(cx, cz, 1.2, k);
      for (const y of sx > 0 ? [7.2, 10.6, 14.0, 20.6, 23.4, 27.0, 29.8] : [20.6, 23.4, 27.0, 29.8]) {
        K.ob(S, -0.2, 0.2, Y(y - 0.15), Y(y + 1.3), 0, 0.05, LIMESTONE);
        K.ob(S, -0.09, 0.09, Y(y), Y(y + 1.15), 0.05, 0.07, GLASS, B.glass);
      }
    }
  }

  // the frontispiece on State Street, in limestone: a deep portal of three moulded orders under a hood mould
  const Eb = { ax: 603.25, az: 492.55, tx: 0, tz: 1, nx: 1, nz: 0, L: 8.1 };
  const R = 2.15, SPRING = Y(3.4), SILL = Y(0.6);
  B.box(T.x1, 602.45, g - 2, Y(18.9), 488.5, 496.6, LIMESTONE);
  K.slab(Eb, K.rect(-4.05, 4.05, g - 2, Y(18.9)), [K.archShape(0, R, SILL, SPRING)], -0.8, 0, LIMESTONE);
  K.slab(Eb, K.archBand(0, R, R - 0.2, SILL, SPRING), [], -0.8, -0.3, LIMESTONE_DARK);
  K.slab(Eb, K.archBand(0, R - 0.2, R - 0.4, SILL, SPRING), [], -0.8, -0.55, LIMESTONE);
  // the doors: two oak leaves of raised panels, their meeting stile, and iron ring pulls
  K.fill(Eb, K.archShape(0, R - 0.4, SILL, SPRING), -0.7, DOOR);
  K.ob(Eb, -0.05, 0.05, SILL, SPRING + 1.4, -0.7, -0.66, LOUVER);
  for (const s of [-1, 1]) {
    for (const [y0, y1] of [[0.85, 1.9], [2.1, 3.2]]) K.ob(Eb, s * 0.25, s * 1.45, Y(y0), Y(y1), -0.7, -0.66, [0.26, 0.17, 0.1]);
    K.disc(Eb, s * 0.22, Y(2.0), 0.09, -0.64, LOUVER, 10);
  }
  const hoodY = SPRING + K.tudorRise(R) + 0.3;
  K.ob(Eb, -R - 0.5, R + 0.5, hoodY, hoodY + 0.18, 0, 0.16, LIMESTONE);
  for (const s of [-1, 1]) {
    K.ob(Eb, s * (R + 0.32), s * (R + 0.5), SPRING - 0.2, hoodY, 0, 0.16, LIMESTONE);
    // a carved shield in each spandrel
    K.disc(Eb, s * 1.55, SPRING + 1.45, 0.3, 0.04, LIMESTONE_DARK, 16);
    K.disc(Eb, s * 1.55, SPRING + 1.45, 0.2, 0.07, LIMESTONE, 16);
    // a lantern on an iron bracket beside the door
    const lu = s * 3.0;
    K.ob(Eb, lu - 0.04, lu + 0.04, Y(3.05), Y(3.13), 0, 0.2, LOUVER);
    K.ob(Eb, lu - 0.15, lu + 0.15, Y(2.55), Y(3.25), 0.16, 0.46, GLASS, B.glass, true);
    K.ob(Eb, lu - 0.19, lu + 0.19, Y(3.25), Y(3.38), 0.12, 0.5, LOUVER, B.stone, true);
    K.ob(Eb, lu - 0.12, lu + 0.12, Y(2.45), Y(2.55), 0.19, 0.43, LOUVER, B.stone, true);
    // the angle buttresses, set off above the portal, ending in octagonal pinnacles over the parapet
    const bu0 = s < 0 ? -4.05 : 3.45, bu1 = bu0 + 0.6;
    K.ob(Eb, bu0, bu1, g - 2, Y(6.0), 0, 0.55, LIMESTONE);
    K.wedge(Eb, bu0, bu1, Y(6.0), Y(6.4), 0.3, 0.55, LIMESTONE);
    K.ob(Eb, bu0, bu1, Y(6.0), Y(19.9), 0, 0.3, LIMESTONE);
    const pc = K.at(Eb, (bu0 + bu1) / 2, 0.05);
    K.oct(pc[0], pc[2], 0.38, Y(19.9), Y(21.3), LIMESTONE);
    K.oct(pc[0], pc[2], 0.46, Y(21.3), Y(21.5), LIMESTONE_DARK);
    K.octCone(pc[0], pc[2], 0.36, Y(21.5), Y(23.2), LIMESTONE);
  }
  // the steps up to it between low cheek walls
  for (let k = 0; k < 4; k++) B.box(603.25, 603.25 + 0.38 * (4 - k), g - 1, Y(0.15 * (k + 1)), 489.3, 495.8, LIMESTONE_DARK);
  for (const [z0, z1] of [[488.7, 489.3], [495.8, 496.4]]) {
    B.box(603.25, 604.85, g - 1, Y(0.9), z0, z1, LIMESTONE);
    B.box(603.2, 604.95, Y(0.9), Y(1.05), z0 - 0.05, z1 + 0.05, LIMESTONE_DARK);
  }
  // over the portal: a string course, the two-storey oriel on its corbels, a blind arcade and a battlemented top
  K.ob(Eb, -3.45, 3.45, Y(6.0), Y(6.4), 0, 0.16, LIMESTONE_DARK);
  K.oriel(Eb, 0, Y(7.4), Y(14.6), 5.0, 1.15, 2);
  K.ob(Eb, -3.1, 3.1, Y(15.45), Y(15.62), 0, 0.12, LIMESTONE_DARK);
  for (let k = -2; k <= 2; k++) {
    K.fill(Eb, K.archShape(k * 1.2, 0.4, Y(15.62), Y(17.0)), 0.01, LIMESTONE_DARK);
    K.slab(Eb, K.archBand(k * 1.2, 0.5, 0.4, Y(15.62), Y(17.0)), [], 0, 0.08, LIMESTONE);
  }
  K.ob(Eb, -3.45, 3.45, Y(18.2), Y(18.45), 0, 0.1, LIMESTONE);
  K.ob(Eb, -3.45, 3.45, Y(18.45), Y(18.9), 0, 0.22, LIMESTONE);
  K.ob(Eb, -3.45, 3.45, Y(18.9), Y(19.7), -0.35, 0, LIMESTONE, B.stone, true);
  for (let c = -2.4; c <= 2.41; c += 1.2) K.ob(Eb, c - 0.32, c + 0.32, Y(19.7), Y(20.5), -0.35, 0, LIMESTONE, B.stone, true);

  // tall brick chimneys over the roof, with stone bands, caps and clay pots
  for (const [cx, cz] of [[560, 470], [536, 500], [590, 515], [550, 530]]) {
    B.box(cx - 0.55, cx + 0.55, Y(18.9), Y(24.2), cz - 1.1, cz + 1.1, BRICK_UNION);
    B.box(cx - 0.63, cx + 0.63, Y(23.3), Y(23.6), cz - 1.18, cz + 1.18, LIMESTONE);
    B.box(cx - 0.65, cx + 0.65, Y(24.2), Y(24.45), cz - 1.2, cz + 1.2, LIMESTONE);
    for (const o of [-0.6, 0, 0.6]) K.oct(cx, cz + o, 0.17, Y(24.45), Y(25.1), [0.62, 0.36, 0.27]);
  }

  // The colliders follow the outline in strips (the plaza round it stays open), the roof at the battlements and the
  // tower to its top. The survey's blocks inside it are what the model stands for, but its main block runs on south
  // past the outline as a wing the model doesn't draw: that block is cut back to the wing (`reshapes`), and the rest
  // are dropped (`replaces`).
  const out = strips(ring, Y(20.5));
  out.push({ minX: T.x0, maxX: 604.5, minZ: T.z0, maxZ: T.z1, maxY: Y(37), keepsSurvey: true });
  let ringMaxZ = -Infinity;
  for (let i = 1; i < ring.length; i += 2) ringMaxZ = Math.max(ringMaxZ, ring[i]);
  const blocks = surveyInside(ring);
  const wingOf = (b) => {
    const far = b.polygons[0].outer.filter((p) => p.z > ringMaxZ + 2);
    if (b.polygons.length !== 1 || far.length < 3) return null;
    const x0 = Math.min(...far.map((p) => p.x)), x1 = Math.max(...far.map((p) => p.x));
    let r = clipRing(b.polygons[0].outer, (p) => p.z >= ringMaxZ, (a, c) => ({ x: a.x + (c.x - a.x) * (ringMaxZ - a.z) / (c.z - a.z), z: ringMaxZ }));
    for (const [x, keep] of [[x1, (p) => p.x <= x1], [x0, (p) => p.x >= x0]]) {
      r = clipRing(r, keep, (a, c) => ({ x, z: a.z + (c.z - a.z) * (x - a.x) / (c.x - a.x) }));
    }
    if (r.length < 3) return null;
    const xs = r.map((p) => p.x), zs = r.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return { ...b, polygons: [{ outer: r, holes: [] }], minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  };
  const replaced = [];
  let reshape = null;
  for (const b of blocks) {
    const wing = !reshape && wingOf(b);
    if (wing) reshape = { from: b, to: wing };
    else replaced.push(b);
  }
  out[0].replaces = replaced;
  if (reshape) out[0].reshapes = reshape;
  return out;
}

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

// The survey's blocks a model stands for: those whose middle is inside its outline ([x, z, ...])
function surveyInside(ring) {
  const outer = [];
  for (let i = 0; i < ring.length; i += 2) outer.push({ x: ring[i], z: ring[i + 1] });
  const poly = { outer, holes: [] };
  return REAL_BUILDINGS.filter((b) => polygonContains(poly, b.cx, b.cz));
}

// A ring of {x, z} cut to one side of a line: `inside(p)` keeps a point, `cross(a, b)` is where an edge leaves or enters
function clipRing(ring, inside, cross) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length], b = ring[i];
    if (inside(b)) { if (!inside(a)) out.push(cross(a, b)); out.push(b); } else if (inside(a)) out.push(cross(a, b));
  }
  return out;
}

const MODELS = [
  ['Burton Memorial Tower', burtonTower],
  ['Hill Auditorium', hillAuditorium],
  ['Michigan Union', michiganUnion]
];

// Burton Tower's dials (their middles and which way they face), gathered as it's built
const DIALS = [];

// The clock's hands, the hour and minute hand on each of the four dials: one instanced quad, turned at most once a
// second as it's drawn, by the time the game shows (game-clock.js: Ann Arbor's real time under "Now", a preset's own)
function burtonHands() {
  if (!DIALS.length) return null;
  const geo = new THREE.BufferGeometry();
  // a unit hand along +x from the arbor, ±1 across, facing +z
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const lin = LOUVER.map((v) => v ** 2.2);
  const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(lin[0], lin[1], lin[2]), roughness: 0.7, side: THREE.DoubleSide });
  const hands = new THREE.InstancedMesh(geo, mat, DIALS.length * 2);
  hands.name = 'BurtonClockHands';
  let cx = 0, cy = 0, cz = 0;
  for (const d of DIALS) { cx += d.x / DIALS.length; cy += d.y / DIALS.length; cz += d.z / DIALS.length; }
  hands.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 9);
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Yv = new THREE.Vector3(), Z = new THREE.Vector3();
  let shownAt = -Infinity, shown = NaN;
  const set = () => {
    const sec = gameTime().sec;
    if (sec === shown) return;
    shown = sec;
    // clockwise from twelve: the hour hand round in 12 hours, the minute hand in one
    const turns = [[(sec / 43200) % 1, 1.05, 0.07, 0.22], [(sec / 3600) % 1, 1.6, 0.05, 0.2]];
    let i = 0;
    for (const d of DIALS) {
      // u runs toward the viewer's left as they face the dial (tx, tz), so clockwise is measured with +θ
      const tx = -d.nz, tz = d.nx;
      for (const [turn, len, w, out] of turns) {
        const a = Math.PI / 2 + turn * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
        X.set(tx * ux, uy, tz * ux).multiplyScalar(len);
        Yv.set(-tx * uy, ux, -tz * uy).multiplyScalar(w);
        Z.set(d.nx, 0, d.nz);
        m.makeBasis(X, Yv, Z).setPosition(d.x + d.nx * out, d.y, d.z + d.nz * out);
        hands.setMatrixAt(i++, m);
      }
    }
    hands.instanceMatrix.needsUpdate = true;
  };
  set();
  hands.onBeforeRender = function () {
    const now = performance.now();
    if (now - shownAt < 1000) return;
    shownAt = now;
    set();
  };
  return hands;
}

function buildCampusLandmarks(group, colliders, sites) {
  const B = builder();
  const built = [];
  DIALS.length = 0;
  for (const [name, make] of MODELS) {
    const site = sites[name];
    if (!site || !site.ring) continue;
    colliders.push(...[].concat(make(B, site)));
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
  const glass = mesh(B.glass, landmarkGlass());
  glass.name = 'CampusLandmarkGlass';
  group.add(stone, glass);
  const hands = burtonHands();
  if (hands) group.add(hands);
  return built;
}

// The hand-modeled landmarks' glass: dark by day, lit warm from inside at dusk and night as the survey buildings'
// windows round them are (cityUniforms.uInteriorGlow)
function landmarkGlass() {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide });
  mat.emissiveNode = color(0xffcf8a).mul(mix(float(0.012), float(0.75), smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow)));
  return mat;
}

export { buildCampusLandmarks, builder, groundOf, strips, landmarkGlass };
