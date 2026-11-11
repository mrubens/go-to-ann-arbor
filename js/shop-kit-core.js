import * as THREE from 'three/webgpu';

// Lamp: what the rooms behind the shopfronts' glass are modelled with (shop-kits.js lays out a room for each kind of
// business; shop-interiors.js draws them). A kit is one merged, vertex-colored shape of a whole furnished room in a
// room's own space: x across the bay as someone on the sidewalk sees it (left to right, the door at the front left),
// y up from the floor, z into the building from the glass. It is modelled for a room 7 m wide, 5.5 m deep and 3.2 m
// high and fits any other: each vertex carries how far it moves as the room grows (`aux.xy`: the metre along each
// wall moves with that wall, the middle spreads), so a chair keeps its size and a counter along the back grows.
// `aux.z` is what a vertex is made of (SLOT: plain, or tinted the business's own wall, floor or accent color), `aux.w`
// how much it shines by itself (1 a lamp while the shop is open, 2 lit all night).

export const H0 = 3.5, D0 = 5.5, HT = 3.2;
export const SLOT = { plain: 0, wall: 1, floor: 2, accent: 3, left: 5, right: 6, ceiling: 7 };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const anchorX = (x) => clamp(x / (H0 - 1), -1, 1);
export const anchorZ = (z) => clamp((z - 1) / (D0 - 2), 0, 1);

const _c = new THREE.Color(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _L = new THREE.Matrix4(), _W = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
const rgbCache = new Map();
export const lin = (hex) => {
  let v = rgbCache.get(hex);
  if (!v) { _c.setHex(hex); rgbCache.set(hex, (v = [_c.r, _c.g, _c.b])); }
  return v;
};
export const mixHex = (a, b, t) => {
  const p = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return p.getHex();
};
export const shadeHex = (a, f) => new THREE.Color(a).multiplyScalar(f).getHex();

// the six faces of a unit box (centred): [normal, four corners counter-clockwise seen from outside]
const FACES = {
  f: [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
  b: [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  r: [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
  l: [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
  t: [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
  u: [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
};
const geoCache = new Map();
function geoArrays(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    let geo = make();
    if (geo.index) geo = geo.toNonIndexed();
    g = { p: geo.attributes.position.array, n: geo.attributes.normal.array };
    geoCache.set(key, g);
  }
  return g;
}

export class Kit {
  constructor(seed = 1) {
    this.P = []; this.N = []; this.C = []; this.X = [];
    this.spots = [];
    this.M = new THREE.Matrix4();
    this.anchor = null; // [ax, az] while inside a group (it moves as one thing), null: each vertex by its own place
    this.inGroup = false;
    let s = seed >>> 0;
    this.rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  pick(list) { return list[Math.floor(this.rand() * list.length) % list.length]; }
  range(a, b) { return a + (b - a) * this.rand(); }

  // things made inside `fn` are placed at (x, z) turned `ry` (their +z towards (sin ry, cos ry)) and move as one;
  // `stretch`: they grow with the room instead (a run of shelves along a wall)
  group(x, z, ry, fn, { y = 0, stretch = false, anchor = null } = {}) {
    const M0 = this.M, a0 = this.anchor, g0 = this.inGroup, s0 = this.stretching;
    _L.makeRotationY(ry).setPosition(x, y, z);
    this.M = M0.clone().multiply(_L);
    if (stretch) { this.anchor = null; this.stretching = true; }
    else if (!g0 || s0) {
      _v.setFromMatrixPosition(this.M);
      this.anchor = anchor || [anchorX(_v.x), anchorZ(_v.z)];
      this.stretching = false;
    }
    this.inGroup = true;
    fn();
    this.M = M0; this.anchor = a0; this.inGroup = g0; this.stretching = s0;
  }

  // triangles (flat arrays of positions and normals), through `local` (a Matrix4 or null) and the group's place
  emit(pos, nor, col, o = {}, local = null) {
    const rgb = typeof col === 'number' ? lin(col) : col;
    const W = local ? _W.multiplyMatrices(this.M, local) : this.M;
    _m3.setFromMatrix4(W);
    const slot = o.slot || 0, glow = o.glow || 0, anc = o.anchor || this.anchor, k = o.k ?? 1;
    for (let i = 0; i < pos.length; i += 3) {
      _v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(W);
      _n.set(nor[i], nor[i + 1], nor[i + 2]).applyMatrix3(_m3).normalize();
      this.P.push(_v.x, _v.y, _v.z);
      this.N.push(_n.x, _n.y, _n.z);
      const kk = o.kv ? o.kv[i / 3] : k;
      this.C.push(rgb[0] * kk, rgb[1] * kk, rgb[2] * kk);
      this.X.push(anc ? anc[0] : anchorX(_v.x), anc ? anc[1] : anchorZ(_v.z), slot, glow);
    }
  }
  local(x, y, z, o) {
    if (!o.rx && !o.ry && !o.rz) return _L.makeTranslation(x, y, z);
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
    return _L.compose(_v.set(x, y, z), _q, _one);
  }

  // a box standing on y, centred on (x, z); `faces` leaves some out ('f' +z, 'b', 'l', 'r', 't' top, 'u' under)
  box(x, y, z, w, h, d, col, o = {}) {
    const faces = o.faces || 'fbrltu';
    const pos = [], nor = [];
    for (const ch of faces) {
      const [n, q] = FACES[ch];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(q[i][0] * w / 2, q[i][1] * h / 2, q[i][2] * d / 2);
        nor.push(n[0], n[1], n[2]);
      }
    }
    const L = this.local(x, y + h / 2, z, o).clone();
    this.emit(pos, nor, col, o, L);
  }
  // a flat panel centred on (x, y, z), facing 'S' the street (-z), 'N', 'E' (+x), 'W', 'U' up or 'D' down
  plane(x, y, z, w, h, face, col, o = {}) {
    const g = geoArrays('plane', () => new THREE.PlaneGeometry(1, 1));
    const rot = { N: [0, 0], S: [0, Math.PI], E: [0, Math.PI / 2], W: [0, -Math.PI / 2], U: [-Math.PI / 2, 0], D: [Math.PI / 2, 0] }[face];
    _q.setFromEuler(_e.set(rot[0], rot[1] + (o.ry || 0), 0, 'YXZ'));
    const L = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _a.set(w, h, 1));
    this.emit(g.p, g.n, col, o, L);
  }
  cyl(x, y, z, r, h, col, o = {}) {
    const seg = o.seg || 10, r2 = o.r2 ?? r, open = !!o.open;
    const g = geoArrays(`cyl${seg}${open}${(r2 / r).toFixed(3)}`, () => new THREE.CylinderGeometry(r2 / r, 1, 1, seg, 1, open));
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
    const L = new THREE.Matrix4().compose(_v.set(x, y + (o.center ? 0 : h / 2), z), _q, _a.set(r, h, r * (o.sz || 1)));
    this.emit(g.p, g.n, col, o, L);
  }
  sph(x, y, z, r, col, o = {}) {
    const ws = o.ws || 8, hs = o.hs || 5, half = !!o.half;
    const g = geoArrays(`sph${ws}_${hs}${half}`, () => new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI));
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
    const L = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _a.set(r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1)));
    this.emit(g.p, g.n, col, o, L);
  }
  // a thin bar from one point to another
  rod(x0, y0, z0, x1, y1, z1, r, col, o = {}) {
    const seg = o.seg || 4;
    const g = geoArrays(`rod${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true));
    _a.set(x0, y0, z0); _b.set(x1, y1, z1);
    const len = _a.distanceTo(_b);
    if (len < 1e-5) return;
    _q.setFromUnitVectors(_up, _n.subVectors(_b, _a).divideScalar(len));
    const L = new THREE.Matrix4().compose(_v.addVectors(_a, _b).multiplyScalar(0.5), _q, new THREE.Vector3(r, len, r));
    this.emit(g.p, g.n, col, o, L);
  }
  // where someone is: on their feet or their seat at (x, z), facing `ry`; `pose` and what else shop-interiors.js reads
  spot(x, z, ry, pose, o = {}) {
    _v.set(x, 0, z).applyMatrix4(this.M);
    _n.set(Math.sin(ry), 0, Math.cos(ry)).transformDirection(this.M);
    this.spots.push({ x: _v.x, z: _v.z, ax: anchorX(_v.x), az: anchorZ(_v.z), fx: _n.x, fz: _n.z, pose, role: 'guest', ...o });
  }

  // the room itself: floor, walls, ceiling, a skirting board
  shell({ skirting = 0x2a2623 } = {}) {
    const w = H0 * 2;
    this.plane(0, 0, D0 / 2, w, D0, 'U', 0xffffff, { slot: SLOT.floor });
    this.plane(0, HT, D0 / 2, w, D0, 'D', 0xffffff, { slot: SLOT.ceiling });
    this.plane(0, HT / 2, D0, w, HT, 'S', 0xffffff, { slot: SLOT.wall });
    this.plane(-H0, HT / 2, D0 / 2, D0, HT, 'E', 0xffffff, { slot: SLOT.left });
    this.plane(H0, HT / 2, D0 / 2, D0, HT, 'W', 0xffffff, { slot: SLOT.right });
    if (skirting != null) {
      this.box(0, 0, D0 - 0.012, w, 0.11, 0.024, skirting, { faces: 'bt' });
      this.box(-H0 + 0.012, 0, D0 / 2, 0.024, 0.11, D0, skirting, { faces: 'rt', slot: SLOT.left, k: 0.25 });
      this.box(H0 - 0.012, 0, D0 / 2, 0.024, 0.11, D0, skirting, { faces: 'lt', slot: SLOT.right, k: 0.25 });
    }
  }
  // a soft dark patch on the floor under something (a shade of the floor's own color)
  shadow(x, z, w, d, k = 0.62) {
    const pos = [], nor = [], kv = [], n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      pos.push(0, 0, 0, Math.sin(a0) * w / 2, 0, Math.cos(a0) * d / 2, Math.sin(a1) * w / 2, 0, Math.cos(a1) * d / 2);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      kv.push(k, 1, 1);
    }
    this.emit(pos, nor, 0xffffff, { slot: SLOT.floor, kv }, new THREE.Matrix4().makeTranslation(x, 0.015, z));
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.X, 4));
    // the staff first, then the customers in the order the room fills
    const spots = this.spots.map((sp, i) => ({ prio: 5, ...sp, i })).sort((p, q) => (q.role === 'staff') - (p.role === 'staff') || p.prio - q.prio || p.i - q.i);
    return { geometry: g, spots, triangles: this.P.length / 9 };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Furniture and fittings, each built facing +z at the place given (a chair's sitter looks along +z)
export const C = {
  woodD: 0x3d2a1c, wood: 0x6e4c30, woodL: 0xa9824f, oak: 0xc09a62, white: 0xe8e4da, cream: 0xd9cfb8, black: 0x161618,
  char: 0x2a2b2e, steel: 0x8c9298, chrome: 0xc4c8cc, brass: 0xa98a3a, glass: 0xb7d2d4, bulb: 0xffe6b8, cool: 0xeaf4ff,
  green: 0x3f6a3a, leaf: 0x4d7d3f, pot: 0x8a5a3c, red: 0xa62a24, paper: 0xece6d6, screen: 0x9fcfff
};
export const BRIGHTS = [0xc0392b, 0xe67e22, 0xf1c40f, 0x27ae60, 0x2980b9, 0x8e44ad, 0xe84393, 0x16a085, 0xd35400, 0xecf0f1, 0x2c3e50, 0xf39c12];
export const MUTED = [0x7a2e2a, 0x2f4a5c, 0x4a5a3a, 0x8a6a3a, 0x3a3440, 0x9a8a72, 0x5a3a2a, 0x2a3a34, 0xb0a48c, 0x6a4a5a, 0x34495e, 0x7a7468];
export const CLOTHES = [0x2c3e50, 0xecf0f1, 0x8a1f24, 0x3a5a40, 0xd9b99a, 0x1c1c1e, 0x5a6f8a, 0xc9a227, 0x7a4a6a, 0x9aa7b8, 0xb4532a, 0x4a4a4a, 0xe3d5c0, 0x2e6f6a];

export function chair(K, x, z, ry, { frame = C.wood, seat = null, spot = null } = {}) {
  K.group(x, z, ry, () => {
    K.box(0, 0.42, 0, 0.42, 0.045, 0.42, seat === 'accent' ? 0xffffff : seat ?? frame, seat === 'accent' ? { slot: SLOT.accent } : {});
    for (const s of [-1, 1]) {
      K.box(s * 0.18, 0, 0.18, 0.035, 0.42, 0.035, frame, { faces: 'fbrl' });
      K.box(s * 0.18, 0, -0.19, 0.035, 0.9, 0.035, frame, { faces: 'fbrlt' });
    }
    K.box(0, 0.64, -0.19, 0.34, 0.22, 0.025, frame);
    K.shadow(0, 0, 0.5, 0.5, 0.7);
    if (spot) K.spot(0, 0.02, 0, spot.pose || 'sit', { h: 0.45, ...spot });
  });
}
export function stool(K, x, z, h = 0.76, { col = C.char, seat = C.woodD, spot = null, ry = 0 } = {}) {
  K.group(x, z, ry, () => {
    K.cyl(0, h - 0.05, 0, 0.17, 0.05, seat, { seg: 10 });
    K.cyl(0, 0.02, 0, 0.025, h - 0.07, col, { seg: 5, open: true });
    K.cyl(0, 0, 0, 0.2, 0.02, col, { seg: 10 });
    K.cyl(0, 0.3, 0, 0.15, 0.015, col, { seg: 10, open: true });
    K.shadow(0, 0, 0.44, 0.44, 0.7);
    if (spot) K.spot(0, 0, 0, spot.pose || 'sit', { h: h, ...spot });
  });
}
export function tableRound(K, x, z, r, h = 0.74, { top = C.woodL, leg = C.char } = {}) {
  K.group(x, z, 0, () => {
    K.cyl(0, h - 0.035, 0, r, 0.035, top, { seg: 14 });
    K.cyl(0, 0.02, 0, 0.035, h - 0.05, leg, { seg: 6, open: true });
    K.cyl(0, 0, 0, r * 0.62, 0.025, leg, { seg: 10 });
    K.shadow(0, 0, r * 2.1, r * 2.1, 0.66);
  });
}
// a dining table, maybe under a cloth, set for `places` (plates and glasses), a candle or a little vase on it
export function tableSquare(K, x, z, w, d, { cloth = null, top = C.wood, places = [], centre = 'candle', h = 0.75 } = {}) {
  K.group(x, z, 0, () => {
    if (cloth != null) {
      K.box(0, h - 0.02, 0, w + 0.04, 0.03, d + 0.04, cloth);
      K.box(0, h - 0.24, 0, w + 0.04, 0.22, d + 0.04, cloth, { faces: 'fbrl', k: 0.86 });
    } else K.box(0, h - 0.04, 0, w, 0.04, d, top);
    K.cyl(0, 0.02, 0, 0.045, h - 0.06, C.char, { seg: 6, open: true });
    K.box(0, 0, 0, w * 0.5, 0.03, d * 0.5, C.char);
    K.shadow(0, 0, w + 0.25, d + 0.25, 0.6);
    for (const [px, pz] of places) {
      K.cyl(px, h + 0.012, pz, 0.115, 0.012, 0xf4f1ea, { seg: 10 });
      K.cyl(px + (pz > 0 ? -0.17 : 0.17), h + 0.012, pz * 0.8 + (px > 0 ? -0.02 : 0.02), 0.03, 0.1, 0xcfe0e4, { seg: 6, r2: 0.036 });
    }
    if (centre === 'candle') {
      K.cyl(0, h + 0.012, 0, 0.035, 0.07, 0x8a2a22, { seg: 6 });
      K.sph(0, h + 0.105, 0, 0.022, 0xffd27a, { glow: 1, ws: 5, hs: 3, sy: 1.5 });
    } else if (centre === 'vase') {
      K.cyl(0, h + 0.012, 0, 0.03, 0.13, 0xdfe6e8, { seg: 6 });
      K.sph(0, h + 0.2, 0, 0.06, 0xc8453a, { ws: 5, hs: 3 });
    }
  });
}
export function pendant(K, x, z, y = 2.05, { shade = C.char, r = 0.17, glow = C.bulb, cone = true } = {}) {
  K.group(x, z, 0, () => {
    K.box(0, y + 0.2, 0, 0.012, HT - y - 0.2, 0.012, C.black, { faces: 'fbrl' });
    K.cyl(0, y, 0, r, 0.2, shade, { seg: 10, r2: cone ? r * 0.25 : r * 0.9, open: true });
    K.cyl(0, y + 0.012, 0, r * 0.93, 0.004, glow, { seg: 10, glow: 1 });
    K.sph(0, y + 0.03, 0, r * 0.32, glow, { glow: 1, ws: 6, hs: 4 });
  });
}
export function ceilingPanel(K, x, z, w, d, col = 0xfff8ec) {
  K.plane(x, HT - 0.012, z, w + 0.08, d + 0.08, 'D', 0x9a9a96, { anchor: [anchorX(x), anchorZ(z)] });
  K.plane(x, HT - 0.02, z, w, d, 'D', col, { glow: 1, anchor: [anchorX(x), anchorZ(z)] });
}
// a row of spotlights on a black track, along x (or z), at depth z (or x)
export function trackSpots(K, x0, x1, z, n, { alongZ = false, col = 0xfff2dc } = {}) {
  const P = (t, y) => (alongZ ? [z, y, t] : [t, y, z]);
  K.group(0, 0, 0, () => {
    const mid = (x0 + x1) / 2, len = Math.abs(x1 - x0);
    K.box(...P(mid, HT - 0.05), alongZ ? 0.04 : len, 0.03, alongZ ? len : 0.04, C.black);
    for (let i = 0; i < n; i++) {
      const t = x0 + (x1 - x0) * (i + 0.5) / n, [px, , pz] = P(t, 0);
      K.cyl(px, HT - 0.2, pz, 0.05, 0.13, C.black, { seg: 6 });
      K.cyl(px, HT - 0.205, pz, 0.042, 0.006, col, { seg: 6, glow: 1 });
    }
  }, { stretch: true });
}
// a framed picture flat on a wall: `face` the way it looks ('S' on the back wall, 'E' on the left, 'W' on the right)
export function picture(K, x, y, z, w, h, face, { frame = C.woodD, art = null, glow = 0, rnd = Math.random } = {}) {
  const out = { S: [0, -1], N: [0, 1], E: [1, 0], W: [-1, 0] }[face], side = face === 'S' || face === 'N';
  const at = (k) => [x + out[0] * k, z + out[1] * k];
  K.group(0, 0, 0, () => {
    let [px, pz] = at(0.02);
    K.plane(px, y, pz, w, h, face, frame);
    [px, pz] = at(0.028);
    const bg = art ? art[0] : MUTED[Math.floor(rnd() * MUTED.length)];
    K.plane(px, y, pz, w - 0.08, h - 0.08, face, bg, { glow });
    // a few blocks of color: a horizon, a sun, a stripe
    const cols = art || [bg, BRIGHTS[Math.floor(rnd() * BRIGHTS.length)], MUTED[Math.floor(rnd() * MUTED.length)], 0xe8e0cc];
    [px, pz] = at(0.034);
    const bh = (h - 0.08) * (0.25 + rnd() * 0.3);
    K.plane(px, y - (h - 0.08) / 2 + bh / 2, pz, w - 0.08, bh, face, cols[2 % cols.length], { glow });
    [px, pz] = at(0.04);
    const s = Math.min(w, h) * (0.18 + rnd() * 0.16), off = (rnd() - 0.5) * (w - 0.2 - s);
    K.plane(side ? px + off : px, y + (rnd() - 0.3) * (h - 0.2 - s) * 0.6, side ? pz : pz + off, s, s, face, cols[1 % cols.length], { glow });
  }, { anchor: [anchorX(x), anchorZ(z)] });
}
export function plant(K, x, z, h = 1.3, { pot = C.pot } = {}) {
  K.group(x, z, 0, () => {
    K.cyl(0, 0, 0, 0.16, 0.34, pot, { seg: 8, r2: 0.21 });
    K.cyl(0, 0.34, 0, 0.025, h * 0.45, 0x4a3a28, { seg: 4, open: true });
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = 0.16 + (i % 2) * 0.08, y = 0.5 + (h - 0.6) * (i / (n - 1));
      K.sph(Math.cos(a) * r * 0.8, y, Math.sin(a) * r * 0.8, 0.26 - i * 0.02, i % 2 ? C.leaf : C.green, { ws: 6, hs: 4, sy: 0.8 });
    }
    K.shadow(0, 0, 0.6, 0.6, 0.68);
  });
}
// a till: a little box, a screen tilted up at whoever stands behind (+z)
export function till(K, x, y, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, y, 0, 0.34, 0.09, 0.3, C.char);
    K.box(0, y + 0.09, 0.06, 0.04, 0.16, 0.04, C.char);
    K.box(0, y + 0.2, 0.08, 0.3, 0.22, 0.025, C.black, { rx: -0.25 });
    K.plane(0, y + 0.31, 0.102, 0.26, 0.17, 'N', C.screen, { glow: 0.8 });
  });
}
export function monitor(K, x, y, z, ry = 0, w = 0.5) {
  K.group(x, z, ry, () => {
    K.box(0, y, 0, 0.2, 0.015, 0.14, C.char);
    K.box(0, y, -0.02, 0.035, 0.2, 0.03, C.char);
    K.box(0, y + 0.14, -0.01, w, w * 0.6, 0.02, C.black);
    K.plane(0, y + 0.14 + w * 0.3, 0.002, w - 0.04, w * 0.6 - 0.04, 'N', 0xbcd8f0, { glow: 0.75 });
    K.box(0, y, 0.2, 0.36, 0.015, 0.12, 0x2c2c30);
  });
}
// a counter along x from x0 to x1, its front (the customers' side) at z0, `d` deep; grows with the room
export function counter(K, x0, x1, z0, d, h, { front = C.wood, top = C.woodL, slot = 0, kick = C.black, alongZ = false, flip = 1 } = {}) {
  const w = x1 - x0, mid = (x0 + x1) / 2;
  K.group(0, 0, 0, () => {
    const B = (cx, y, cz, bw, bh, bd, col, o) => (alongZ ? K.box(cz, y, cx, bd, bh, bw, col, o) : K.box(cx, y, cz, bw, bh, bd, col, o));
    const zc = z0 + flip * d / 2;
    B(mid, 0.1, zc, w, h - 0.14, d, front, slot ? { slot } : {});
    B(mid, 0, zc + flip * 0.03, w - 0.04, 0.1, d - 0.06, kick);
    B(mid, h - 0.04, zc - flip * 0.02, w + 0.06, 0.04, d + 0.1, top);
  }, { stretch: true });
}
// a shelf unit against a wall, `w` wide, its back at z = 0 and its front at +z; `fill(K, x0, x1, y, depth, level)`
// stocks each board
export function shelves(K, w, h, depth, levels, { frame = C.wood, back = null, y0 = 0.12, fill = null, sides = true } = {}) {
  if (back != null) K.plane(0, h / 2, 0.01, w, h, 'N', back);
  if (sides) for (const s of [-1, 1]) K.box(s * (w / 2 - 0.015), 0, depth / 2, 0.03, h, depth, frame);
  const gap = (h - y0) / levels;
  for (let i = 0; i <= levels; i++) {
    const y = y0 + gap * i;
    if (i < levels || sides) K.box(0, y - 0.025, depth / 2, w - 0.04, 0.025, depth, frame, { faces: 'ftu' });
    if (fill && i < levels) fill(K, -w / 2 + 0.05, w / 2 - 0.05, y, depth, i, gap - 0.04);
  }
}
// rows of books, their spines to +z
export function books(K, x0, x1, y, depth, level, room) {
  let x = x0;
  while (x < x1 - 0.03) {
    const r = K.rand();
    if (r < 0.06) { x += 0.08 + K.rand() * 0.14; continue; }
    if (r < 0.1 && x < x1 - 0.3) {
      // a pile lying flat
      const n = 2 + Math.floor(K.rand() * 3);
      for (let j = 0; j < n; j++) K.box(x + 0.12, y + j * 0.035, depth - 0.1, 0.22, 0.032, 0.15, K.pick(MUTED.concat(BRIGHTS)), { faces: 'ftrl' });
      x += 0.27;
      continue;
    }
    const w = 0.028 + K.rand() * 0.034, h = Math.min(room, room * (0.62 + K.rand() * 0.36));
    const col = K.rand() < 0.8 ? K.pick(MUTED) : K.pick(BRIGHTS);
    const lean = r > 0.965 ? 0.22 : 0;
    K.box(x + w / 2 + lean * h * 0.5, y, depth - 0.03 - K.rand() * 0.03, w - 0.004, h, 0.16, col, { faces: 'ftrl', rz: -lean, k: 0.75 + K.rand() * 0.3 });
    x += w + lean * h;
  }
}
// rows of packets, tins and boxes
export function goods(palette = BRIGHTS, { size = 0.2, tall = 0.24 } = {}) {
  return (K, x0, x1, y, depth, level, room) => {
    let x = x0;
    while (x < x1 - size * 0.5) {
      const run = 2 + Math.floor(K.rand() * 3), col = K.pick(palette), w = size * (0.7 + K.rand() * 0.5), h = Math.min(room, tall * (0.6 + K.rand() * 0.55));
      const round = K.rand() < 0.3;
      for (let j = 0; j < run && x < x1 - w * 0.6; j++) {
        if (round) K.cyl(x + w / 2, y, depth - 0.02 - w / 2, w * 0.42, h, col, { seg: 6 });
        else K.box(x + w / 2, y, depth - 0.02 - w * 0.4, w - 0.02, h, w * 0.8, col, { faces: 'ftrl' });
        if (!round && K.rand() < 0.8) K.plane(x + w / 2, y + h * 0.55, depth - 0.018, (w - 0.02) * 0.7, h * 0.3, 'N', 0xf2efe6);
        x += w;
      }
      x += K.rand() < 0.2 ? 0.08 : 0.01;
    }
  };
}
export function bottle(K, x, y, z, h, col) {
  K.cyl(x, y, z, 0.036, h * 0.62, col, { seg: 5, open: true });
  K.cyl(x, y + h * 0.62, z, 0.036, h * 0.14, col, { seg: 5, r2: 0.014, open: true });
  K.cyl(x, y + h * 0.76, z, 0.014, h * 0.24, col, { seg: 4 });
}
export const BOTTLES = [0x2f5a2a, 0x6a3a14, 0xb8862a, 0xd9d2c0, 0x1c2c4a, 0x7a1f1f, 0x3a6a5a, 0xc9a84a, 0x9ab6c0];
export function bottleRow(K, x0, x1, y, z, { step = 0.1, h = 0.3, palette = BOTTLES } = {}) {
  for (let x = x0; x <= x1; x += step * (0.9 + K.rand() * 0.3)) {
    if (K.rand() < 0.1) continue;
    bottle(K, x, y, z + (K.rand() - 0.5) * 0.03, h * (0.8 + K.rand() * 0.35), K.pick(palette));
  }
}
// a bench or a banquette along x, its back at -z: seat and back cushions
export function bench(K, w, { seat = 0.45, depth = 0.5, back = 0.95, col = C.wood, slot = 0, legs = true } = {}) {
  const o = slot ? { slot } : {};
  K.box(0, seat - 0.12, 0, w, 0.12, depth, col, o);
  if (legs) K.box(0, 0, 0, w - 0.06, seat - 0.12, depth - 0.08, C.char);
  if (back) K.box(0, seat - 0.02, -depth / 2 + 0.05, w, back - seat + 0.02, 0.1, col, { ...o, k: 0.9 });
  K.shadow(0, 0.05, w + 0.1, depth + 0.2, 0.68);
}
export function armchair(K, x, z, ry, { slot = SLOT.accent, col = 0xffffff, spot = null } = {}) {
  K.group(x, z, ry, () => {
    const o = { slot };
    K.box(0, 0.12, 0.02, 0.62, 0.32, 0.6, col, o);
    K.box(0, 0.44, -0.27, 0.62, 0.5, 0.16, col, { ...o, k: 0.9 });
    for (const s of [-1, 1]) K.box(s * 0.36, 0.12, 0, 0.13, 0.5, 0.7, col, { ...o, k: 0.82 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(sx * 0.3, 0, sz * 0.26, 0.05, 0.12, 0.05, C.woodD, { faces: 'fbrl' });
    K.shadow(0, 0, 0.95, 0.9, 0.62);
    if (spot) K.spot(0, 0.04, 0, spot.pose || 'sit', { h: 0.45, ...spot });
  });
}
// a post with a belt or a rope to the next
export function stanchion(K, x, z, col = C.brass) {
  K.group(x, z, 0, () => {
    K.cyl(0, 0, 0, 0.16, 0.03, col, { seg: 10 });
    K.cyl(0, 0.03, 0, 0.025, 0.92, col, { seg: 6, open: true });
    K.sph(0, 0.97, 0, 0.045, col, { ws: 6, hs: 4 });
  });
}
export function rope(K, x0, z0, x1, z1, col, sag = 0.14) {
  const n = 4;
  K.group(0, 0, 0, () => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, y = (t) => 0.9 - Math.sin(t * Math.PI) * sag;
      K.rod(x0 + (x1 - x0) * t0, y(t0), z0 + (z1 - z0) * t0, x0 + (x1 - x0) * t1, y(t1), z0 + (z1 - z0) * t1, 0.018, col);
    }
  }, { stretch: true });
}
// a bicycle, side on: along x, its wheels on the floor at y
export function bike(K, x, y, z, ry, col, { rz = 0 } = {}) {
  K.group(x, z, ry, () => {
    const W = 0.34, O = { rx: Math.PI / 2 };
    const P = (px, py) => {
      const c = Math.cos(rz), s = Math.sin(rz);
      return [px * c - py * s, y + px * s + py * c];
    };
    const tube = (a, b, r, c) => { const [ax, ay] = P(...a), [bx, by] = P(...b); K.rod(ax, ay, 0, bx, by, 0, r, c); };
    for (const wx of [-0.52, 0.52]) {
      const [cx, cy] = P(wx, W);
      K.cyl(cx, cy, 0, W, 0.035, 0x121214, { seg: 14, open: true, center: true, ...O });
      K.cyl(cx, cy, 0, W - 0.03, 0.02, 0xb8bcc0, { seg: 14, open: true, center: true, ...O });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 4 + rz;
        K.rod(cx - Math.cos(a) * (W - 0.03), cy - Math.sin(a) * (W - 0.03), 0, cx + Math.cos(a) * (W - 0.03), cy + Math.sin(a) * (W - 0.03), 0, 0.004, 0xb8bcc0, { seg: 3 });
      }
    }
    const bb = [-0.06, 0.3], seat = [-0.2, 0.86], head = [0.36, 0.84], rear = [-0.52, W], front = [0.52, W];
    tube(bb, seat, 0.02, col); tube(seat, head, 0.019, col); tube(bb, head, 0.022, col);
    tube(rear, bb, 0.014, col); tube(rear, seat, 0.012, col); tube(head, front, 0.016, col);
    tube(seat, [-0.23, 0.97], 0.012, 0x9a9da0); tube(head, [0.33, 0.99], 0.012, 0x9a9da0);
    const [sx, sy] = P(-0.24, 0.975), [hx, hy] = P(0.33, 0.99), [bx, by] = P(...bb);
    K.box(sx, sy, 0, 0.24, 0.035, 0.11, C.black, { rz });
    K.rod(hx, hy, -0.24, hx, hy, 0.24, 0.013, C.black);
    K.cyl(bx, by, 0.05, 0.09, 0.008, 0x9a9da0, { seg: 8, center: true, ...O });
    K.rod(bx, by, 0.07, bx + 0.12, by - 0.12, 0.07, 0.01, 0x55585c);
  }, { y: 0 });
}
// a shop's dummy on its stand, dressed
export function mannequin(K, x, z, ry, { top = 0x2c3e50, legs = 0x22242c, skirt = false, skin = 0xd8d2c8 } = {}) {
  K.group(x, z, ry, () => {
    K.cyl(0, 0, 0, 0.2, 0.02, C.chrome, { seg: 10 });
    if (skirt) K.cyl(0, 0.55, 0, 0.3, 0.5, legs, { seg: 8, r2: 0.16 });
    for (const s of [-1, 1]) {
      K.cyl(s * 0.09, 0.02, 0, 0.055, skirt ? 0.55 : 0.5, skirt ? skin : legs, { seg: 6, r2: 0.07, open: true });
      if (!skirt) K.cyl(s * 0.09, 0.52, 0, 0.075, 0.48, legs, { seg: 6, r2: 0.095, open: true });
      // arms hanging a little out from the sides
      K.cyl(s * 0.245, 0.88, 0, 0.04, 0.56, top, { seg: 5, r2: 0.05, rz: s * 0.09 });
      K.sph(s * 0.27, 0.86, 0, 0.04, skin, { ws: 5, hs: 3 });
    }
    K.cyl(0, 0.98, 0, 0.16, 0.2, skirt ? legs : top, { seg: 8, r2: 0.14, sz: 0.7 });
    K.cyl(0, 1.16, 0, 0.14, 0.3, top, { seg: 8, r2: 0.19, sz: 0.68 });
    K.cyl(0, 1.44, 0, 0.19, 0.06, top, { seg: 8, r2: 0.07, sz: 0.68 });
    K.cyl(0, 1.5, 0, 0.045, 0.09, skin, { seg: 6 });
    K.sph(0, 1.68, 0.01, 0.1, skin, { ws: 8, hs: 6, sy: 1.18 });
    K.shadow(0, 0, 0.5, 0.5, 0.7);
  });
}
// clothes on hangers along a rail from x0 to x1 at height y (the rail along x; each thing hangs across it)
export function garments(K, x0, x1, y, z, { step = 0.075, long = 0.75, short = 0.5, palette = CLOTHES, rail = C.chrome } = {}) {
  K.rod(x0 - 0.06, y, z, x1 + 0.06, y, z, 0.013, rail);
  for (let x = x0; x <= x1; x += step * (0.85 + K.rand() * 0.4)) {
    if (K.rand() < 0.08) { x += 0.08; continue; }
    const col = K.pick(palette), len = short + (long - short) * K.rand(), w = 0.4 + K.rand() * 0.08;
    K.box(x, y - 0.1 - len, z, 0.04, len, w, col, { faces: 'rlfbu', k: 0.8 + K.rand() * 0.3 });
    K.box(x, y - 0.1, z, 0.04, 0.05, w * 0.78, col, { faces: 'rlfbt', k: 0.8 });
    K.rod(x, y - 0.05, z, x, y, z, 0.006, rail, { seg: 3 });
  }
}
// a fluorescent strip on the ceiling, along z
export function strip(K, x, z0, z1, col = 0xf4fbff, alongX = false) {
  const len = z1 - z0, mid = (z0 + z1) / 2;
  K.group(0, 0, 0, () => {
    if (alongX) { K.box(mid, HT - 0.06, x, len, 0.05, 0.16, 0xb8bcbc); K.plane(mid, HT - 0.065, x, len - 0.04, 0.12, 'D', col, { glow: 1 }); }
    else { K.box(x, HT - 0.06, mid, 0.16, 0.05, len, 0xb8bcbc); K.plane(x, HT - 0.065, mid, 0.12, len - 0.04, 'D', col, { glow: 1 }); }
  }, { stretch: true });
}
// rows of chalk writing on a board that faces the street
export function writing(K, x, y, z, w, h, face, { col = 0xe9e6dc, rows = 6, cols = 1, glow = 0 } = {}) {
  const out = { S: [0, -1], N: [0, 1], E: [1, 0], W: [-1, 0] }[face], side = face === 'S' || face === 'N';
  const cw = w / cols;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const len = cw * (r === 0 ? 0.55 : 0.4 + K.rand() * 0.45) - 0.06, yy = y + h / 2 - (r + 0.6) * (h / rows);
      const along = -w / 2 + c * cw + 0.04 + len / 2;
      K.plane(side ? x + along : x + out[0] * 0.006, yy, side ? z + out[1] * 0.006 : z + along, len, r === 0 ? h / rows * 0.5 : h / rows * 0.28,
        face, r === 0 ? col : shadeHex(col, 0.8), { glow });
    }
  }
}
