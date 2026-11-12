import * as THREE from 'three/webgpu';
import { attribute, positionWorld, normalWorld, cameraPosition, vertexColor, mx_noise_float, smoothstep, step, mix, max,
  abs, floor, fract, float, vec3, normalize, sin } from 'three/tsl';
import { polygonContains } from './building-collision.js';
import { cityUniforms } from './tsl-materials.js';
import { XBOX, TOUCH_DEVICE, TIER } from './device-tier.js';
import { splitByCell } from './merge-static.js';

// Ann Arbor's churches: the survey's buildings on the city's religious parcels, drawn as churches rather than as
// windowed blocks. Each is built of one of three materials, picked per building: brick, stone (ashlar) or white
// clapboard, drawn as courses by the walls' own shader (`pat`, an attribute: brick, clapboard, ashlar, and slate on the
// roofs), with stone or wood trim. A plain nave gets a steep gable along its length with real eaves (overhang, fascia,
// soffit, a ridge cap) and its gable ends; an irregular plan its outline under a flat roof behind a coping.
// The windows are openings cut through the wall (the wall's face triangulated round them, a reveal going in, the
// glass set back inside), so nothing lies on the wall's face to fight it: lancets on the stone churches, round-arched
// ones on brick and clapboard, each with a hood mould or casing, a sill and tracery (a mullion forking at the
// springing), between buttresses on the masonry. The stained glass is leaded in quarries and glows warm from inside at
// dusk and night (cityUniforms.uInteriorGlow). The entrance is a deep arched portal with wooden doors at its back and
// steps up to it; a rose window in the front gable where it fits. The tower, at one end, is one of: a broached spire
// with pinnacles, a battlemented top with corner pinnacles, an octagonal cupola with a dome (brick), or a white
// steeple of belfry stage and spire (clapboard); its belfry openings louvred. Small chapels have a bellcote instead.
// Every church goes into two meshes (masonry and glass) for the whole city; on a phone, the Xbox or a tier without
// shadows the arches have fewer steps, the windows wider apart on big outlines, and there's no tracery, hood moulds,
// buttresses, louvres, door planks or quarries' lead (about 1,200 triangles a church against 4,000), and on the Xbox
// and a phone the two meshes are cut into 600 m squares, each hidden past the landmarks' reach.

// (Lamp: Ann Arbor's stone churches are brown and gray fieldstone and rubble, St Andrew's, First Methodist, Zion)
const STONE = [[0.6, 0.53, 0.45], [0.52, 0.48, 0.43], [0.66, 0.6, 0.52], [0.56, 0.5, 0.44]];
// a postwar church's brick: tan, buff and brown
const POSTWAR_BRICK = [[0.62, 0.45, 0.32], [0.55, 0.36, 0.26], [0.68, 0.55, 0.4], [0.5, 0.32, 0.24]];
const BRICK = [[0.5, 0.25, 0.19], [0.56, 0.3, 0.22], [0.45, 0.26, 0.2], [0.6, 0.38, 0.27]];
const CLAP = [[0.92, 0.91, 0.87], [0.9, 0.88, 0.82]];
const TRIM_STONE = [0.78, 0.74, 0.66];
const TRIM_WOOD = [0.95, 0.94, 0.9];
const SLATE = [0.24, 0.25, 0.28];
const SHINGLE = [0.36, 0.36, 0.37];
const COPPER = [0.33, 0.52, 0.45];
const DOOR = [[0.3, 0.16, 0.09], [0.16, 0.2, 0.15], [0.42, 0.12, 0.1]];
const LOUVER = [0.16, 0.15, 0.14];
const CROSS = [0.72, 0.60, 0.30];
const GLASS = [[0.16, 0.22, 0.55], [0.55, 0.13, 0.15], [0.18, 0.4, 0.26], [0.55, 0.4, 0.12], [0.36, 0.18, 0.45]];
// the walls' patterns (the `pat` attribute)
const PAT = { plain: 0, brick: 1, clap: 2, ashlar: 3, slate: 4 };

/** A church's plan: its oriented box (along its longest wall) and how well the footprint fills it, or null */
export function churchPlan(b) {
  const ring = b.polygons[0] && b.polygons[0].outer;
  if (!ring || ring.length < 3) return null;
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const dx = c.x - a.x, dz = c.z - a.z, L = Math.hypot(dx, dz);
    if (L > best) { best = L; ux = dx / L; uz = dz / L; }
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const u = p.x * ux + p.z * uz, v = -p.x * uz + p.z * ux;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    area += p.x * q.z - q.x * p.z;
  }
  let L = u1 - u0, W = v1 - v0;
  if (L < 9 || W < 7 || L * W > 5000) return null;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  let ax = ux, az = uz;
  if (W > L) { [L, W] = [W, L]; ax = -uz; az = ux; }
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ax, az, L, W, fill: Math.abs(area / 2) / (L * W) };
}

const hash = (ch, k) => { const s = Math.sin((ch.cx * 12.9898 + ch.cz * 78.233 + k * 37.719)) * 43758.5453; return s - Math.floor(s); };

/** How a church (a churches item: the building with its ground and plan) is drawn: a gabled box or its outline, its
 * material, and where its tower stands and what's on it (inside an irregular outline, at whichever end it fits, or
 * none). buildings.js builds its colliders from the same. */
export function churchLayout(ch) {
  const { plan, ground, height } = ch;
  const { ax, az } = plan, bx = -az, bz = ax;
  const rect = plan.fill > 0.78 && ch.polygons.length === 1;
  const hl = plan.L / 2, hw = plan.W / 2;
  // the roof: a steep gable (about 50°) whose ridge is the surveyed height; irregular plans keep a flat top
  // (Lamp: out past the town that stood by 1950 a church is a postwar one: a low gable over brick walls with plain tall
  // windows, no Gothic tower or spire)
  const postwar = Math.hypot(ch.cx, ch.cz) > 2300;
  const roofH = rect ? Math.min(plan.W * (postwar ? 0.32 : 0.6), height * (postwar ? 0.4 : 0.5), 14) : 0;
  const eave = ground + Math.max(4.5, height - roofH);
  const ridge = ground + height + 0.22;
  const tw = Math.max(3.6, Math.min(plan.W * 0.38, 7));
  let towerEnd = hash(ch, 2) < 0.5 ? -1 : 1;
  let hasTower = !postwar && plan.L > 12 && height > 6;
  // (over an outline, the tower stands inside it: at the other end if not the first, or not at all)
  const at = (end) => end * (hl - tw / 2 + 0.8);
  if (hasTower && !rect) {
    const fits = (end) => {
      const u = at(end) - end * 0.8; // pulled in to the outline's end
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([su, sv]) => {
        const uu = u + su * tw / 2, vv = sv * tw / 2;
        return polygonContains({ outer: ch.polygons[0].outer, holes: [] }, plan.cx + ax * uu + bx * vv, plan.cz + az * uu + bz * vv);
      });
    };
    if (fits(towerEnd)) { /* keep */ } else if (fits(-towerEnd)) towerEnd = -towerEnd;
    else hasTower = false;
  }
  // its material: clapboard only on a small one, else brick or stone
  const m = hash(ch, 5);
  // (a church its street photo shows: red or tan brick, stone, or painted, which on a church is white clapboard;
  // data/building-looks.json, buildings.js passes it as `facade`)
  const seen = [null, 'brick', 'brick', 'stone', 'clap', null][ch.facade || 0];
  const material = seen || (postwar ? 'brick' : m < 0.22 && height < 14 && plan.L < 40 ? 'clap' : m < 0.6 ? 'brick' : 'stone');
  const k = hash(ch, 6);
  const top = !hasTower ? 'none'
    : material === 'clap' ? 'steeple'
    : material === 'stone' ? (k < 0.55 ? 'spire' : 'battlement')
    : (k < 0.6 ? 'spire' : 'cupola');
  const towerU = rect ? at(towerEnd) : at(towerEnd) - towerEnd * 0.8;
  const towerTop = ridge + Math.max(3, tw * 0.9);
  const spireH = top === 'spire' ? Math.min(26, Math.max(7, tw * 2.8))
    : top === 'battlement' ? 1.6
    : top === 'cupola' ? tw * 1.25
    : top === 'steeple' ? tw * 1.0 + Math.min(18, tw * 2.4) : 0;
  return { rect, hl, hw, roofH, eave, ridge, tw, towerEnd, towerU, hasTower, towerTop, spireH, material, top, postwar };
}

export function buildChurches(items) {
  const lean = XBOX || TOUCH_DEVICE || TIER.shadows === false;
  const ARC = lean ? 2 : 4;
  const stone = { pos: [], col: [], pat: [] }, glass = { pos: [], col: [] };
  // colors are written as seen (sRGB); the vertex colors want them linear
  const lin = new Map();
  const linear = (col) => { if (!lin.has(col)) lin.set(col, col.map((c) => c ** 2.2)); return lin.get(col); };
  let curPat = 0;
  const tri = (m, a, b, c, col) => {
    m.pos.push(...a, ...b, ...c);
    const l = linear(col);
    for (let k = 0; k < 3; k++) m.col.push(l[0], l[1], l[2]);
    if (m.pat) m.pat.push(curPat, curPat, curPat);
  };
  const quad = (m, a, b, c, d, col) => { tri(m, a, b, c, col); tri(m, a, c, d, col); };
  const withPat = (p, fn) => { const was = curPat; curPat = p; fn(); curPat = was; };
  // a square beam from p to q, s thick
  const beam = (p, q, s, col, m = stone) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz) || 1;
    const t = [dx / L, dy / L, dz / L], up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let u = cr(t, up); const ul = Math.hypot(...u); u = u.map((v) => (v / ul) * s / 2);
    let v = cr(t, u); const vl = Math.hypot(...v); v = v.map((w) => (w / vl) * s / 2);
    const c = (o, a, b) => [o[0] + a[0] + b[0], o[1] + a[1] + b[1], o[2] + a[2] + b[2]];
    const n = (a) => a.map((w) => -w);
    const kk = [[u, v], [n(u), v], [n(u), n(v)], [u, n(v)]];
    for (let i = 0; i < 4; i++) {
      const [a1, b1] = kk[i], [a2, b2] = kk[(i + 1) % 4];
      quad(m, c(p, a1, b1), c(p, a2, b2), c(q, a2, b2), c(q, a1, b1), col);
    }
  };

  // A wall seen face on: a frame (its start, direction along it and its outward normal), points on it as (u, y, d)
  const frameOf = (ox, oz, tx, tz, nx, nz) => ({ ox, oz, tx, tz, nx, nz, P: (u, y, d = 0) => [ox + tx * u + nx * d, y, oz + tz * u + nz * d] });
  // a box on a wall: u0..u1 along it, y0..y1 up, d0..d1 out from its face
  const lbox = (F, u0, u1, y0, y1, d0, d1, col, m = stone) => {
    const P = F.P;
    quad(m, P(u0, y1, d0), P(u1, y1, d0), P(u1, y1, d1), P(u0, y1, d1), col);
    quad(m, P(u0, y0, d1), P(u1, y0, d1), P(u1, y1, d1), P(u0, y1, d1), col);
    quad(m, P(u0, y0, d0), P(u0, y0, d1), P(u0, y1, d1), P(u0, y1, d0), col);
    quad(m, P(u1, y0, d1), P(u1, y0, d0), P(u1, y1, d0), P(u1, y1, d1), col);
    quad(m, P(u0, y0, d0), P(u1, y0, d0), P(u1, y0, d1), P(u0, y0, d1), col);
  };
  // an opening's outline as (u, y) points, anticlockwise from its bottom left: a lancet (two arcs struck from the
  // springing points), a round arch, a rectangle or a circle
  const opening = (kind, u, w, y0, y1) => {
    const r = w / 2, pts = [];
    if (kind === 'circle') {
      const cy = (y0 + y1) / 2, rr = (y1 - y0) / 2, n = ARC * 3;
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push([u + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      return pts;
    }
    if (kind === 'rect') return [[u - r, y0], [u + r, y0], [u + r, y1], [u - r, y1]];
    if (kind === 'lancet') {
      const rise = w * 0.866, spring = Math.max(y0 + 0.3, y1 - rise);
      pts.push([u - r, y0], [u + r, y0], [u + r, spring]);
      // the right arc struck from the left springing point (radius w), up to the apex, then the left one down
      for (let k = 1; k < ARC; k++) { const a = (k / ARC) * (Math.PI / 3); pts.push([u - r + Math.cos(a) * w, spring + Math.sin(a) * w]); }
      pts.push([u, spring + rise]);
      for (let k = ARC - 1; k >= 1; k--) { const a = (k / ARC) * (Math.PI / 3); pts.push([u + r - Math.cos(a) * w, spring + Math.sin(a) * w]); }
      pts.push([u - r, spring]);
      return pts;
    }
    const spring = Math.max(y0 + 0.3, y1 - r);
    pts.push([u - r, y0], [u + r, y0]);
    for (let k = 0; k <= ARC * 2; k++) { const a = (k / (ARC * 2)) * Math.PI; pts.push([u + Math.cos(a) * r, spring + Math.sin(a) * r]); }
    return pts;
  };
  // A wall face from its outline [(u, y)] with openings cut through it: the face triangulated round them, a reveal
  // `depth` deep into each, and what fills its back (glass, or a door: `fill(points, d)`)
  const wallWithOpenings = (F, contour, holes, col, pat) => {
    const v2 = (pts) => pts.map(([u, y]) => new THREE.Vector2(u, y));
    const c2 = v2(contour), h2 = holes.map((h) => v2(h.pts));
    const all = [...c2, ...h2.flat()];
    withPat(pat, () => {
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(c2, h2)) {
        tri(stone, F.P(all[a].x, all[a].y), F.P(all[b].x, all[b].y), F.P(all[c].x, all[c].y), col);
      }
    });
    for (const h of holes) {
      const pts = h.pts, d = -h.depth;
      for (let i = 0; i < pts.length; i++) {
        const [ua, ya] = pts[i], [ub, yb] = pts[(i + 1) % pts.length];
        quad(stone, F.P(ua, ya, 0), F.P(ub, yb, 0), F.P(ub, yb, d), F.P(ua, ya, d), h.reveal || col);
      }
      h.fill(pts, d);
    }
  };
  // glass in an opening, set back to d, its tracery in front of it
  const glazed = (F, pane, tracery) => (pts, d) => {
    const p2 = pts.map(([u, y]) => new THREE.Vector2(u, y));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(p2, [])) tri(glass, F.P(p2[a].x, p2[a].y, d), F.P(p2[b].x, p2[b].y, d), F.P(p2[c].x, p2[c].y, d), pane);
    if (tracery && !lean) tracery(d + 0.06);
  };
  // a mullion forking at the springing into two lights (a lancet's Y-tracery, or a round arch's)
  const yTracery = (F, u, w, y0, y1, kind, col) => (d) => {
    const spring = kind === 'lancet' ? y1 - w * 0.866 : y1 - w / 2;
    beam(F.P(u, y0, d), F.P(u, spring, d), 0.09, col);
    beam(F.P(u, spring, d), F.P(u - w * 0.3, y1 - (y1 - spring) * 0.25, d), 0.08, col);
    beam(F.P(u, spring, d), F.P(u + w * 0.3, y1 - (y1 - spring) * 0.25, d), 0.08, col);
    beam(F.P(u - w / 2, spring, d), F.P(u + w / 2, spring, d), 0.07, col);
  };
  // a hood mould (masonry) or casing (wood) round an opening's head (all round a circle): a band
  // standing out from the wall, its face and its outer edge, each edge pushed out square to itself
  const surround = (F, pts, col, width, out, full = false) => {
    const n = pts.length;
    const cu = pts.reduce((s2, x) => s2 + x[0], 0) / n, cy = pts.reduce((s2, x) => s2 + x[1], 0) / n;
    // (the head only, not the jambs, unless it's a circle)
    for (let i = full ? 0 : 2; i < (full ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let pu = -(b[1] - a[1]), py = b[0] - a[0];
      const l = Math.hypot(pu, py) || 1;
      pu /= l; py /= l;
      if (pu * ((a[0] + b[0]) / 2 - cu) + py * ((a[1] + b[1]) / 2 - cy) < 0) { pu = -pu; py = -py; }
      const a2 = [a[0] + pu * width, a[1] + py * width], b2 = [b[0] + pu * width, b[1] + py * width];
      quad(stone, F.P(a[0], a[1], out), F.P(b[0], b[1], out), F.P(b2[0], b2[1], out), F.P(a2[0], a2[1], out), col);
      quad(stone, F.P(a2[0], a2[1], 0), F.P(b2[0], b2[1], 0), F.P(b2[0], b2[1], out), F.P(a2[0], a2[1], out), col);
    }
  };
  // a window: the opening, its hood mould, sill and tracery
  const windowIn = (F, kind, u, w, y0, y1, pane, trim, wood) => {
    const pts = opening(kind, u, w, y0, y1);
    lbox(F, u - w / 2 - 0.14, u + w / 2 + 0.14, y0 - 0.2, y0, 0, 0.16, trim);
    if (!lean) surround(F, pts, trim, wood ? 0.14 : 0.2, wood ? 0.06 : 0.1);
    return { pts, depth: wood ? 0.18 : 0.38, reveal: trim, fill: glazed(F, pane, kind === 'circle' ? null : yTracery(F, u, w, y0, y1, kind, trim)) };
  };
  // a rose window: a circle cut through, glass behind a ring and spokes
  const roseIn = (F, u, cy, rr, pane, trim) => {
    const pts = opening('circle', u, rr * 2, cy - rr, cy + rr);
    if (!lean) surround(F, pts, trim, 0.22, 0.1, true);
    return { pts, depth: 0.35, reveal: trim, fill: (p, d) => {
      glazed(F, pane, null)(p, d);
      if (lean) return;
      const n = 8;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        beam(F.P(u + Math.cos(a) * rr * 0.28, cy + Math.sin(a) * rr * 0.28, d + 0.06), F.P(u + Math.cos(a) * rr, cy + Math.sin(a) * rr, d + 0.06), 0.08, trim);
        const b = ((k + 1) / n) * Math.PI * 2;
        beam(F.P(u + Math.cos(a) * rr * 0.28, cy + Math.sin(a) * rr * 0.28, d + 0.06), F.P(u + Math.cos(b) * rr * 0.28, cy + Math.sin(b) * rr * 0.28, d + 0.06), 0.08, trim);
      }
    } };
  };
  // the entrance: a deep arched portal, double doors at its back (planks standing proud, the split between them),
  // steps up to it out in front
  const portalIn = (F, kind, u, w, sill, h, ground, trim, door) => {
    const pts = opening(kind, u, w, sill, sill + h);
    if (!lean) surround(F, pts, trim, 0.3, 0.16);
    const steps = Math.max(1, Math.round((sill - ground) / 0.17));
    for (let k = 0; k < steps; k++) lbox(F, u - w / 2 - 0.6 - (steps - k) * 0.1, u + w / 2 + 0.6 + (steps - k) * 0.1, ground - 0.4, ground + (k + 1) * (sill - ground) / steps, 0, (steps - k) * 0.32 + 0.05, trim);
    return { pts, depth: 0.7, reveal: trim, fill: (p, d) => {
      const p2 = p.map(([uu, y]) => new THREE.Vector2(uu, y));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(p2, [])) tri(stone, F.P(p2[a].x, p2[a].y, d), F.P(p2[b].x, p2[b].y, d), F.P(p2[c].x, p2[c].y, d), door);
      if (!lean) for (let x = u - w / 2 + 0.22; x < u + w / 2 - 0.1; x += 0.22) lbox(F, x - 0.02, x + 0.02, sill + 0.05, sill + h - (kind === 'rect' ? 0.1 : w / 2), d, d + 0.03, [door[0] * 0.7, door[1] * 0.7, door[2] * 0.7]);
      lbox(F, u - 0.04, u + 0.04, sill, sill + h - (kind === 'rect' ? 0 : w * 0.3), d, d + 0.05, [0.08, 0.06, 0.05]);
      for (const sg of [-1, 1]) lbox(F, u + sg * 0.25 - 0.05, u + sg * 0.25 + 0.05, sill + 1.0, sill + 1.12, d, d + 0.09, [0.15, 0.14, 0.13]);
    } };
  };

  for (const ch of items) {
    const { plan, ground, minGround = ground, height } = ch;
    const base = Math.min(minGround, ground) - 0.5;
    const r = (k) => hash(ch, k);
    const lay = churchLayout(ch);
    const { rect, hl, hw, eave, ridge, tw, towerEnd, towerU, hasTower, towerTop, spireH, material, top, postwar } = lay;
    const wall = postwar ? POSTWAR_BRICK[Math.floor(r(7) * POSTWAR_BRICK.length)] : material === 'brick' ? BRICK[Math.floor(r(7) * BRICK.length)] : material === 'stone' ? STONE[Math.floor(r(7) * STONE.length)] : CLAP[Math.floor(r(7) * CLAP.length)];
    const pat = material === 'brick' ? PAT.brick : material === 'stone' ? PAT.ashlar : PAT.clap;
    const wood = material === 'clap';
    const trim = wood ? TRIM_WOOD : TRIM_STONE;
    const roofCol = wood ? SHINGLE : SLATE;
    const kind = postwar ? 'rect' : material === 'stone' ? 'lancet' : 'round';
    const pane = GLASS[Math.floor(r(1) * GLASS.length)];
    const pane2 = GLASS[(GLASS.indexOf(pane) + 2) % GLASS.length];
    const door = DOOR[Math.floor(r(8) * DOOR.length)];
    const { ax, az } = plan, bx = -az, bz = ax;
    const P = (u, v, y) => [plan.cx + ax * u + bx * v, y, plan.cz + az * u + bz * v];
    const sill = ground + Math.min(2, (eave - ground) * 0.28), wTop = eave - 0.8;
    const ww = Math.min(1.6, (eave - ground) * 0.2);
    const front = hasTower ? -towerEnd : (r(3) < 0.5 ? -1 : 1);

    // the walls: the box for a plain nave, the surveyed outline otherwise
    const rings = rect
      ? [[P(-hl, -hw, 0), P(hl, -hw, 0), P(hl, hw, 0), P(-hl, hw, 0)].map(([x, , z]) => ({ x, z }))]
      : ch.polygons.map((p) => p.outer);
    let doorDone = hasTower;
    for (const ring of rings) {
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area += p.x * q.z - q.x * p.z; }
      const out = area > 0 ? -1 : 1; // which side of each edge is outside
      // the longest edge of an outline, for its door when it has no tower
      let longest = -1, lmax = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], l = Math.hypot(q.x - p.x, q.z - p.z); if (l > lmax) { lmax = l; longest = i; } }
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const tx = dx / len, tz = dz / len, nx = -tz * out, nz = tx * out;
        const F = frameOf(p.x, p.z, tx, tz, nx, nz);
        const along = Math.abs(tx * ax + tz * az);
        const gableEnd = rect && along < 0.5;
        // a gable end's wall rises to the ridge in the middle
        const contour = gableEnd
          ? [[0, base], [len, base], [len, eave], [len / 2, ridge - 0.05], [0, eave]]
          : [[0, base], [len, base], [len, eave], [0, eave]];
        const holes = [];
        const towerHere = (u) => {
          if (!hasTower) return false;
          const x = p.x + tx * u, z = p.z + tz * u, du = (x - plan.cx) * ax + (z - plan.cz) * az;
          return Math.abs(du - towerU) < tw / 2 + 1.2;
        };
        if (gableEnd) {
          // which end: the front (rose and door, unless the tower stands there) or the back (a tall window)
          const du = ((p.x + q.x) / 2 - plan.cx) * ax + ((p.z + q.z) / 2 - plan.cz) * az;
          const isFront = Math.sign(du) === front;
          const rr = Math.min(plan.W * 0.17, 2.6, (ridge - eave) * 0.42);
          if (isFront) {
            // the door's height, and the rose over it where the gable has room for it
            const dh = Math.min(3.8, eave - ground - 1.2);
            const doorTop = hasTower ? -Infinity : ground + 0.5 + dh + 0.4;
            const cy = Math.max(eave + rr * 0.35, doorTop + 0.35 + rr);
            const room = (len / 2) * (1 - (cy - eave) / (ridge - eave));
            const roseFits = rr > 0.8 && cy + rr < ridge - 0.5 && room > rr + 0.4;
            if (roseFits) holes.push(roseIn(F, len / 2, cy, rr, pane2, trim));
            if (!hasTower) {
              holes.push(portalIn(F, kind, len / 2, 2.2, ground + 0.5, dh, ground, trim, door));
              doorDone = true;
              for (const sg of [-1, 1]) if (len > 9) holes.push(windowIn(F, kind, len / 2 + sg * Math.min(3.4, len / 4), ww * 0.8, sill, wTop - 0.6, pane, trim, wood));
            } else if (!roseFits && len > 5) holes.push(windowIn(F, kind, len / 2, ww * 1.3, sill, eave + (ridge - eave) * 0.35, pane, trim, wood));
          } else if (!towerHere(len / 2) && len > 5) {
            holes.push(windowIn(F, kind, len / 2, Math.min(2.6, len * 0.22), sill, eave + (ridge - eave) * 0.3, pane2, trim, wood));
          }
        } else if (len >= 4.5 && eave - ground >= 4) {
          // the long walls (or an outline's): a window a bay, a buttress between bays on masonry
          const bay = lean ? 5.2 : 3.8, n = Math.max(1, Math.floor((len - 1.5) / bay)), off = (len - n * bay) / 2;
          const doorHere = !doorDone && !rect && i === longest && len > 7;
          for (let k = 0; k < n; k++) {
            const u = off + (k + 0.5) * bay;
            if (towerHere(u)) continue;
            if (doorHere && Math.abs(u - len / 2) < bay * 0.75) continue;
            holes.push(windowIn(F, kind, u, ww, sill, wTop, pane, trim, wood));
          }
          if (doorHere) {
            holes.push(portalIn(F, kind, len / 2, 2.2, ground + 0.5, Math.min(3.8, eave - ground - 1.2), ground, trim, door));
            doorDone = true;
          }
          if (!wood && !lean && rect) {
            for (let k = 0; k <= n; k++) {
              const u = off + k * bay;
              if (u < 0.4 || u > len - 0.4 || towerHere(u)) continue;
              const bt = eave - 1.4;
              withPat(pat, () => lbox(F, u - 0.3, u + 0.3, base, bt - 1.2, 0, 0.6, wall));
              withPat(pat, () => lbox(F, u - 0.3, u + 0.3, bt - 1.2, bt, 0, 0.3, wall));
              const P2 = F.P;
              quad(stone, P2(u - 0.3, bt - 1.2, 0.6), P2(u + 0.3, bt - 1.2, 0.6), P2(u + 0.3, bt, 0.3), P2(u - 0.3, bt, 0.3), trim);
            }
          }
        }
        wallWithOpenings(F, contour, holes, wall, pat);
        // a plinth course along its foot and, under a flat roof, a coping
        lbox(F, -0.05, len + 0.05, base, ground + 0.45, 0, 0.12, trim);
        if (!rect) lbox(F, -0.1, len + 0.1, eave - 0.3, eave + 0.15, -0.25, 0.15, trim);
        else if (!gableEnd) lbox(F, -0.05, len + 0.05, eave - 0.35, eave - 0.1, 0, 0.18, trim);
      }
      // a flat roof over an irregular plan
      if (!rect) {
        const shape = ring.map((p) => new THREE.Vector2(p.x, p.z));
        for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(shape, [])) {
          tri(stone, [ring[a].x, eave - 0.05, ring[a].z], [ring[b].x, eave - 0.05, ring[b].z], [ring[c].x, eave - 0.05, ring[c].z], roofCol);
        }
      }
    }

    if (rect) {
      // the gable: slate (or shingle) slopes out over the walls and past the ends, their thickness, the soffit under
      // the eaves, the fascia, the verge boards up the gable ends and the ridge's cap
      const o = 0.55, ov = 0.4, th = 0.18, drop = o * (ridge - eave) / hw;
      withPat(PAT.slate, () => {
        quad(stone, P(-hl - ov, -hw - o, eave - drop), P(hl + ov, -hw - o, eave - drop), P(hl + ov, 0, ridge), P(-hl - ov, 0, ridge), roofCol);
        quad(stone, P(hl + ov, hw + o, eave - drop), P(-hl - ov, hw + o, eave - drop), P(-hl - ov, 0, ridge), P(hl + ov, 0, ridge), roofCol);
      });
      for (const s of [-1, 1]) {
        quad(stone, P(-hl - ov, s * (hw + o), eave - drop - th), P(hl + ov, s * (hw + o), eave - drop - th), P(hl + ov, s * hw, eave - th), P(-hl - ov, s * hw, eave - th), trim);
        quad(stone, P(-hl - ov, s * (hw + o), eave - drop), P(hl + ov, s * (hw + o), eave - drop), P(hl + ov, s * (hw + o), eave - drop - th), P(-hl - ov, s * (hw + o), eave - drop - th), trim);
        for (const e of [-1, 1]) {
          const u = e * (hl + ov);
          quad(stone, P(u, s * (hw + o), eave - drop), P(u, 0, ridge), P(u, 0, ridge - th), P(u, s * (hw + o), eave - drop - th), trim);
          quad(stone, P(u, s * (hw + o), eave - drop - th), P(u, 0, ridge - th), P(u - e * 0.3, 0, ridge - th), P(u - e * 0.3, s * (hw + o), eave - drop - th), trim);
        }
      }
      beam(P(-hl - ov, 0, ridge + 0.04), P(hl + ov, 0, ridge + 0.04), 0.22, wood ? SHINGLE : [0.18, 0.18, 0.2]);
      // a bellcote on a small chapel's front gable: a little gabled pier with an open arch and a bell
      if (!hasTower && plan.L < 26) {
        const u = front * (hl - 0.3);
        // its two piers, a little gable over them, the bell hung between
        withPat(pat, () => { for (const sv of [-0.65, 0.65]) beam(P(u, sv, ridge - 0.6), P(u, sv, ridge + 1.8), 0.4, wall); });
        beam(P(u, -0.95, ridge + 1.95), P(u, 0, ridge + 2.6), 0.32, roofCol);
        beam(P(u, 0.95, ridge + 1.95), P(u, 0, ridge + 2.6), 0.32, roofCol);
        beam(P(u, -0.1, ridge + 1.75), P(u, -0.1, ridge + 1.95), 0.9, trim);
        beam(P(u, -0.1, ridge + 0.85), P(u, -0.1, ridge + 1.4), 0.36, [0.3, 0.22, 0.12]);
      }
    }

    // the tower
    if (hasTower) {
      const h2 = tw / 2, cxT = plan.cx + ax * towerU, czT = plan.cz + az * towerU;
      const TP = (u, v, y) => P(towerU + u, v, y);
      const C = [TP(-h2, -h2, 0), TP(h2, -h2, 0), TP(h2, h2, 0), TP(-h2, h2, 0)];
      const bel0 = towerTop - Math.min(tw * 1.1, 5), bel1 = towerTop - 0.7;
      for (let i = 0; i < 4; i++) {
        const a = C[i], b = C[(i + 1) % 4];
        const ex = (b[0] - a[0]) / tw, ez = (b[2] - a[2]) / tw;
        let nx = (a[0] + b[0]) / 2 - cxT, nz = (a[2] + b[2]) / 2 - czT; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
        const F = frameOf(a[0], a[2], ex, ez, nx, nz);
        const holes = [];
        // the belfry: a pair of louvred openings (one on a narrow tower), a small window lower down, the door in the
        // face looking out from the end
        const pair = tw > 5;
        const bw = pair ? tw * 0.22 : tw * 0.36;
        for (const du of pair ? [-tw * 0.17, tw * 0.17] : [0]) {
          const pts = opening(kind, tw / 2 + du, bw, bel0, bel1);
          if (!lean) surround(F, pts, trim, 0.16, 0.08);
          holes.push({ pts, depth: 0.5, reveal: trim, fill: (pp, d) => {
            const p2 = pp.map(([u, y]) => new THREE.Vector2(u, y));
            for (const [x, y, z] of THREE.ShapeUtils.triangulateShape(p2, [])) tri(stone, F.P(p2[x].x, p2[x].y, d), F.P(p2[y].x, p2[y].y, d), F.P(p2[z].x, p2[z].y, d), [0.06, 0.06, 0.07]);
            if (lean) return;
            for (let y = bel0 + 0.3; y < bel1 - bw * 0.6; y += 0.45) beam(F.P(tw / 2 + du - bw / 2 + 0.05, y, d * 0.5), F.P(tw / 2 + du + bw / 2 - 0.05, y, d * 0.5), 0.1, LOUVER);
          } });
        }
        const outward = nx * ax * towerEnd + nz * az * towerEnd > 0.8;
        if (outward) {
          holes.push(portalIn(F, kind, tw / 2, Math.min(2.2, tw * 0.45), ground + 0.5, Math.min(3.8, eave - ground - 0.8), ground, trim, door));
          if (bel0 - (ground + 5) > 3) holes.push(windowIn(F, kind, tw / 2, Math.min(1.2, tw * 0.25), ground + 5.4, Math.min(bel0 - 1.5, ground + 9), pane, trim, wood));
        } else if (bel0 - (eave + 0.5) > 3) {
          holes.push(windowIn(F, kind, tw / 2, Math.min(1.0, tw * 0.22), eave + 0.6, Math.min(bel0 - 1.2, eave + 3.6), pane, trim, wood));
        }
        wallWithOpenings(F, [[0, base], [tw, base], [tw, towerTop], [0, towerTop]], holes, wall, pat);
        // string courses, and the cornice at the shaft's top
        lbox(F, -0.1, tw + 0.1, base, ground + 0.45, 0, 0.14, trim);
        lbox(F, -0.1, tw + 0.1, bel0 - 0.5, bel0 - 0.3, 0, 0.14, trim);
        lbox(F, -0.25, tw + 0.25, towerTop - 0.05, towerTop + 0.35, 0, 0.25, trim);
        // angle buttresses at the corners of a masonry tower
        if (!wood && !lean) {
          withPat(pat, () => {
            lbox(F, -0.25, 0.35, base, bel0 - 1.4, 0, 0.35, wall);
            lbox(F, tw - 0.35, tw + 0.25, base, bel0 - 1.4, 0, 0.35, wall);
          });
        }
      }
      const y0 = towerTop + 0.35, apexY = y0 + spireH;
      const cross = (cy) => {
        beam(TP(0, 0, cy), TP(0, 0, cy + 1.6), 0.12, CROSS);
        beam(TP(0, -0.42, cy + 1.05), TP(0, 0.42, cy + 1.05), 0.1, CROSS);
      };
      // an octagonal spire from radius rr at y up to the apex, broached at its foot over a square
      const spire = (yb, rr, ya, col) => {
        const apex = TP(0, 0, ya);
        withPat(PAT.slate, () => {
          for (let k = 0; k < 8; k++) {
            const a0 = (k + 0.5) / 8 * Math.PI * 2, a1 = (k + 1.5) / 8 * Math.PI * 2;
            tri(stone, TP(Math.cos(a0) * rr, Math.sin(a0) * rr, yb), TP(Math.cos(a1) * rr, Math.sin(a1) * rr, yb), apex, col);
          }
        });
        return apex;
      };
      // a pinnacle: a square shaft and a pyramid on it
      const pinnacle = (u, v, yb, h, sz, col) => {
        beam(TP(u, v, yb), TP(u, v, yb + h * 0.45), sz, col);
        const a = TP(u, v, yb + h), c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => TP(u + x * sz / 2, v + y * sz / 2, yb + h * 0.45));
        for (let k = 0; k < 4; k++) tri(stone, c[k], c[(k + 1) % 4], a, col);
      };
      const spireCol = r(4) < 0.3 ? COPPER : SLATE;
      if (top === 'spire') {
        // the broaches: triangles from the square's corners up onto the octagon's diagonal faces
        const rr = h2 * 0.92;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const ang = Math.atan2(sv, su);
          tri(stone, TP(su * h2, sv * h2, y0), TP(Math.cos(ang - Math.PI / 8) * rr, Math.sin(ang - Math.PI / 8) * rr, y0 + tw * 0.35), TP(Math.cos(ang + Math.PI / 8) * rr, Math.sin(ang + Math.PI / 8) * rr, y0 + tw * 0.35), spireCol);
          if (!lean) pinnacle(su * (h2 + 0.05), sv * (h2 + 0.05), y0, 2.4, 0.42, trim);
        }
        spire(y0, rr, apexY, spireCol);
        cross(apexY);
      } else if (top === 'battlement') {
        // a parapet with merlons on each face, a flat lead roof, pinnacles at the corners
        for (let i = 0; i < 4; i++) {
          const a = C[i], b = C[(i + 1) % 4];
          const ex = (b[0] - a[0]) / tw, ez = (b[2] - a[2]) / tw;
          let nx = (a[0] + b[0]) / 2 - cxT, nz = (a[2] + b[2]) / 2 - czT; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
          const F = frameOf(a[0], a[2], ex, ez, nx, nz);
          withPat(pat, () => lbox(F, -0.2, tw + 0.2, y0, y0 + 0.6, -0.3, 0.2, wall));
          const n = Math.max(3, Math.round(tw / 0.9) | 1), mw = (tw + 0.4) / n;
          for (let k = 0; k < n; k += 2) withPat(pat, () => lbox(F, -0.2 + k * mw, -0.2 + (k + 1) * mw, y0 + 0.6, y0 + 1.25, -0.3, 0.2, wall));
          lbox(F, -0.25, tw + 0.25, y0 + 0.55, y0 + 0.65, -0.35, 0.25, trim);
        }
        B_flat(TP, h2, y0 + 0.1, [0.3, 0.3, 0.32]);
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pinnacle(su * h2, sv * h2, y0 + 0.6, spireH - 0.6, 0.55, trim);
        beam(TP(0, 0, y0 + 0.1), TP(0, 0, y0 + 1.5), 0.08, [0.2, 0.2, 0.2]);
      } else if (top === 'cupola') {
        // an octagonal drum of arches on posts, a dome of rings, a lantern and finial
        const rr = h2 * 0.7, hp = spireH * 0.35, n = 8;
        B_flat(TP, h2, y0 + 0.05, [0.3, 0.3, 0.32]);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          beam(TP(Math.cos(a) * rr, Math.sin(a) * rr, y0), TP(Math.cos(a) * rr, Math.sin(a) * rr, y0 + hp), 0.26, trim);
        }
        for (let k = 0; k < n; k++) {
          const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
          beam(TP(Math.cos(a0) * rr, Math.sin(a0) * rr, y0 + hp), TP(Math.cos(a1) * rr, Math.sin(a1) * rr, y0 + hp), 0.32, trim);
        }
        const rings = [[1.12, 0], [1.0, 0.12], [0.82, 0.25], [0.55, 0.36], [0.22, 0.45]];
        for (let j = 0; j + 1 < rings.length; j++) {
          for (let k = 0; k < n; k++) {
            const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
            const [s0, h0] = rings[j], [s1, h1] = rings[j + 1];
            quad(stone, TP(Math.cos(a0) * rr * s0, Math.sin(a0) * rr * s0, y0 + hp + h0 * spireH), TP(Math.cos(a1) * rr * s0, Math.sin(a1) * rr * s0, y0 + hp + h0 * spireH),
              TP(Math.cos(a1) * rr * s1, Math.sin(a1) * rr * s1, y0 + hp + h1 * spireH), TP(Math.cos(a0) * rr * s1, Math.sin(a0) * rr * s1, y0 + hp + h1 * spireH), COPPER);
          }
        }
        beam(TP(0, 0, y0 + hp + 0.45 * spireH - 0.1), TP(0, 0, apexY), 0.12, CROSS);
      } else if (top === 'steeple') {
        // a smaller square belfry stage of open arches, its cornice, then a tall octagonal spire, white
        const s2 = h2 * 0.72, hs = tw * 1.0;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) beam(TP(su * s2, sv * s2, y0), TP(su * s2, sv * s2, y0 + hs), 0.34, trim);
        for (let i = 0; i < 4; i++) {
          const [su0, sv0] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][i], [su1, sv1] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(i + 1) % 4];
          beam(TP(su0 * s2, sv0 * s2, y0 + 0.2), TP(su1 * s2, sv1 * s2, y0 + 0.2), 0.3, trim);
          beam(TP(su0 * s2, sv0 * s2, y0 + hs - 0.15), TP(su1 * s2, sv1 * s2, y0 + hs - 0.15), 0.4, trim);
          // a rail between the posts
          beam(TP(su0 * s2, sv0 * s2, y0 + 1.0), TP(su1 * s2, sv1 * s2, y0 + 1.0), 0.1, trim);
        }
        B_flat(TP, s2 + 0.25, y0 + hs, trim);
        beam(TP(0, 0, y0 + hs - 1.6), TP(0, 0, y0 + hs - 0.4), 0.7, [0.3, 0.22, 0.12]);
        spire(y0 + hs, s2 * 0.95, apexY, wood ? TRIM_WOOD : spireCol);
        cross(apexY);
      }

      // a flat roof over a square
      function B_flat(TPf, hh, y, col) {
        quad(stone, TPf(-hh, -hh, y), TPf(hh, -hh, y), TPf(hh, hh, y), TPf(-hh, hh, y), col);
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'Churches';
  const add = (m, material, name) => {
    if (!m.pos.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
    if (m.pat) geometry.setAttribute('pat', new THREE.Float32BufferAttribute(m.pat, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(stone, masonryMaterial(lean), 'ChurchMasonry');
  add(glass, stainedGlass(lean), 'ChurchGlass');
  // on the Xbox and a phone, cut by where they stand so the far ones are culled and hidden by distance as the
  // landmarks are, rather than the whole city's churches drawn whenever one is in view
  if (XBOX || TOUCH_DEVICE) {
    for (const o of [...group.children]) splitByCell(o, 600);
    const reach = TIER.landmarkReach || 900;
    for (const o of group.children) o.userData.cullDistance = reach / (TIER.farCut || 1);
  }
  return group;
}

// The walls' courses, by their `pat`: brick in running bond (68 mm courses, 203 mm bricks), clapboard (a shadow under
// each 180 mm board), ashlar (blocks 0.45 by 0.9 m, a tone each) and, on the roofs, slates in courses; each fading
// to its plain colour with distance so it doesn't shimmer, plain on the lean tiers
function masonryMaterial(lean) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, side: THREE.DoubleSide });
  if (lean) { m.vertexColors = true; return m; }
  const pat = attribute('pat', 'float');
  const is = (k) => float(1).sub(step(0.5, abs(pat.sub(k))));
  const n = normalize(normalWorld), dist = positionWorld.distance(cameraPosition);
  const wallish = step(abs(n.y), 0.5);
  // along a wall, whichever way it faces
  const along = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x));
  // brick
  const by = positionWorld.y.div(0.0677), brow = floor(by), bu = along.div(0.203).add(brow.mul(0.5));
  const bnear = float(1).sub(smoothstep(12, 30, dist)).mul(wallish);
  const brick = float(1).sub(max(step(fract(by), 0.15), step(fract(bu), 0.045)).mul(0.28).mul(bnear))
    .mul(mx_noise_float(vec3(floor(bu), brow, 0.5)).mul(0.09).mul(bnear).add(1));
  // clapboard
  const cy = fract(positionWorld.y.div(0.18));
  const clap = float(1).sub(smoothstep(0.78, 1.0, cy).mul(0.22).mul(float(1).sub(smoothstep(30, 70, dist))).mul(wallish));
  // ashlar
  // (Lamp: random-coursed fieldstone, as Ann Arbor's stone churches are, not even 0.45 by 0.9 m blocks, which read as
  // concrete block: 0.3 m courses stepped every 0.6 m along the wall, stones 0.35 to 0.75 m long, each its own
  // shade, in dark mortar)
  const acol = floor(along.div(0.6));
  const ay = positionWorld.y.add(fract(sin(acol.mul(31.7)).mul(4375.85)).sub(0.5).mul(0.11)).div(0.3), arow = floor(ay);
  const arh = fract(sin(arow.mul(17.13)).mul(4375.85));
  const au = along.div(arh.mul(0.4).add(0.35)).add(arh.mul(7.0));
  const anear = float(1).sub(smoothstep(25, 60, dist)).mul(wallish);
  const ashlar = float(1).sub(max(smoothstep(0.1, 0.04, fract(ay)), smoothstep(0.08, 0.03, fract(au))).mul(0.5).mul(anear))
    .mul(mx_noise_float(vec3(floor(au), arow, 2.5)).mul(0.3).mul(anear).add(1));
  // slates on a slope (the courses follow the height), a spire's or a roof's
  const sy = positionWorld.y.div(0.16), srow = floor(sy);
  const snear = float(1).sub(smoothstep(30, 80, dist));
  const slate = float(1).sub(smoothstep(0.8, 1.0, fract(sy)).mul(0.3).mul(snear))
    .mul(mx_noise_float(vec3(floor(along.add(positionWorld.x).div(0.3).add(srow.mul(0.5))), srow, 4.5)).mul(0.12).mul(snear).add(1));
  const f = is(0).add(is(1).mul(brick)).add(is(2).mul(clap)).add(is(3).mul(ashlar)).add(is(4).mul(slate));
  m.colorNode = vertexColor().mul(f);
  return m;
}

// Stained glass: the vertex colour leaded in diamond quarries, a little gloss by day, and lit warm from inside at
// dusk and night as the city's windows are (cityUniforms.uInteriorGlow)
function stainedGlass(lean) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide });
  const n = normalize(normalWorld);
  const along = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x));
  const glow = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
  let lead = float(0);
  if (!lean) {
    const near = float(1).sub(smoothstep(15, 40, positionWorld.distance(cameraPosition)));
    const d1 = fract(along.add(positionWorld.y).div(0.32)), d2 = fract(along.sub(positionWorld.y).div(0.32));
    const tone = mx_noise_float(vec3(floor(along.add(positionWorld.y).div(0.32)), floor(along.sub(positionWorld.y).div(0.32)), 7.5)).mul(0.25);
    lead = max(step(d1, 0.06), step(d2, 0.06)).mul(near);
    m.colorNode = vertexColor().mul(tone.add(1)).mul(float(1).sub(lead.mul(0.8)));
  } else {
    m.colorNode = vertexColor();
  }
  // (the light behind the glass warm, the glass's own colour carried over it)
  const lit = mix(vertexColor(), vec3(1.0, 0.72, 0.4), 0.35);
  m.emissiveNode = lit.mul(mix(float(0.05), float(1.5), glow)).mul(float(1).sub(lead.mul(0.85)));
  return m;
}
