import * as THREE from 'three/webgpu';
import { Fn, attribute, texture, uv, mix, vec3, float, step, normalMap, normalView, normalize } from 'three/tsl';
import { Body, paintFeathers } from './animal-models.js';

// The birds of the river and the sky (animals.js): mallards (drakes and hens), Canada geese, the great blue heron and
// the red-tailed hawk. One skeleton for every bird (a body, a neck of three, a head, a tail, two wings of three and two
// legs of three), each species its own proportions and colours, built as lofted rings like the squirrel
// (animal-models.js), with one feather texture shared by all of them.
//
// Model space: metres, +z the way it faces, +y up, +x its left, its feet at y = 0. The wings are made spread; posing
// folds them back along the flanks (the shoulder rolls the wing's face down and swings it back, the elbow and wrist
// fold it in a Z) and spreads them to flap or soar.

const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ============================================================================
// 1. THE SPECIES
// ============================================================================
// Each part's colour comes from `paint(part, p, n, u)`: [the A plumage, the B plumage] (a mallard's drake and hen);
// u is how far along the part (0 at its root). `mat` gives aMat: (bare skin or bill, eye, pale feather edges, gloss).
const SPECIES = {
  mallard: {
    len: 0.40, w: 0.085, h: 0.072, d: 0.078, cy: 0.155, rise: 0.02, float: 0.138, zfold: 0.55,
    neck: [[0, 0.178, 0.165], [0, 0.205, 0.198], [0, 0.228, 0.218], [0, 0.248, 0.228]], neckR: [0.042, 0.026],
    head: { r: 0.031, long: 1.25 }, bill: { len: 0.056, w: 0.019, h: 0.0085, droop: 0.003, tip: 0.7 },
    legs: { x: 0.038, hip: [0.13, -0.03], knee: [0.07, -0.005], ankle: 0.016, r: 0.0075, foot: { len: 0.055, w: 0.028 } },
    tail: { len: 0.075, w: 0.05, up: 0.035 }, wing: { half: 0.4, chord: 0.12, at: [0.056, 0.19, 0.085], tipShape: 0.25, sweep: 0.06 },
    paint(part, p, n, u) {
      const top = sm(-0.2, 0.5, n.y);
      if (part === 'bill') return [C(0xc4b13c), mixC(C(0xb7782f), C(0x3a2b1d), sm(0.2, 0.6, n.y) * sm(0.15, 0.4, u) * (1 - sm(0.75, 0.95, u)))];
      if (part === 'leg' || part === 'foot') return [C(0xe27a26), C(0xd98a3a)];
      if (part === 'head') {
        const stripe = Math.exp(-(((p.y - (this.neck[3][1] + 0.008)) / 0.005) ** 2)) * sm(0.2, 0.6, u);
        return [C(0x1b4f2a), mixC(mixC(C(0x8c6d4c), C(0x3a2a1c), Math.max(top * 0.7, stripe)), C(0xb39a78), sm(-0.2, -0.6, n.y) * 0.6)];
      }
      if (part === 'neck') {
        const ring = Math.exp(-(((u - 0.42) / 0.09) ** 2));
        return [u > 0.42 ? C(0x1b4f2a) : mixC(C(0x55301f), C(0xf2f1ea), ring), mixC(C(0x8e6c48), C(0xa88a66), u)];
      }
      if (part === 'tail') return [mixC(C(0x111111), C(0xd9d6cf), sm(0.35, 0.6, u)), C(0x7d6043)];
      if (part === 'wing') {
        // the blue speculum with its white bars along the trailing edge of the inner wing; the outer wing grey-brown
        const spec = sm(0.12, 0.2, u) * (1 - sm(0.45, 0.52, u)) * sm(0.55, 0.7, p.chord) * top;
        const bar = spec > 0 && (p.chord > 0.9 || p.chord < 0.6) ? 1 : 0;
        const under = mixC(C(0xd7d4ce), C(0x8e877e), sm(0.7, 1, u));
        const a = mixC(mixC(C(0x8d8478), C(0x6e665d), sm(0.6, 1, u)), C(0x2c3c9c), spec);
        const b = mixC(mixC(C(0x80664b), C(0x5d4934), sm(0.6, 1, u)), C(0x2c3c9c), spec);
        return [mixC(mixC(a, C(0xf4f3ef), bar * spec), under, 1 - top), mixC(mixC(b, C(0xf4f3ef), bar * spec), under, 1 - top)];
      }
      // the body: chestnut breast, grey flanks finely barred, a darker back, a black rump (drake); mottled brown (hen)
      const z = p.z / this.len + 0.5;
      const back = top * sm(0.25, 0.8, n.y);
      let a = mixC(C(0xb4b1a9), C(0x786e60), back);
      a = mixC(a, C(0x5a2f20), sm(0.72, 0.82, z) * (1 - back * 0.5));
      a = mixC(a, C(0x121212), (1 - sm(0.12, 0.2, z)));
      const b = mixC(mixC(C(0x9a7652), C(0x6a4e34), back), C(0xb39472), sm(-0.2, -0.7, n.y));
      return [a, b];
    },
    mat(part, p, n, u) {
      if (part === 'bill' || part === 'leg' || part === 'foot') return [1, 0, 0, 0];
      if (part === 'head') return [0, 0, 0.1, 0.85];
      if (part === 'body') return [0, 0, 0.35, 0];
      return [0, 0, 0.5, 0];
    }
  },
  goose: {
    len: 0.62, w: 0.128, h: 0.105, d: 0.112, cy: 0.33, rise: 0.035, float: 0.29, zfold: 1,
    neck: [[0, 0.385, 0.27], [0, 0.5, 0.325], [0, 0.615, 0.345], [0, 0.705, 0.37]], neckR: [0.06, 0.03],
    head: { r: 0.04, long: 1.35 }, bill: { len: 0.058, w: 0.02, h: 0.016, droop: 0.004, tip: 0.55 },
    legs: { x: 0.055, hip: [0.27, -0.03], knee: [0.15, -0.005], ankle: 0.022, r: 0.012, foot: { len: 0.095, w: 0.05 } },
    tail: { len: 0.11, w: 0.08, up: 0.035 }, wing: { half: 0.76, chord: 0.21, at: [0.085, 0.395, 0.16], tipShape: 0.35, sweep: 0.12 },
    paint(part, p, n, u) {
      if (part === 'bill' || part === 'leg' || part === 'foot') { const k = C(0x141414); return [k, k]; }
      if (part === 'head') {
        // the white chinstrap: from under the chin up the cheeks
        const cheek = sm(0.35, 0.6, Math.abs(n.x)) * sm(0.25, -0.15, n.y) * sm(0.15, 0.4, u) * (1 - sm(0.8, 0.95, u));
        const chin = sm(-0.4, -0.75, n.y) * sm(0.2, 0.5, u);
        const k = mixC(C(0x121212), C(0xf0eee6), Math.max(cheek, chin));
        return [k, k];
      }
      if (part === 'neck') { const k = mixC(C(0xcfc5b2), C(0x131313), sm(0.04, 0.16, u)); return [k, k]; }
      if (part === 'tail') { const k = mixC(C(0xf0eee6), C(0x141414), sm(0.12, 0.3, u) * sm(-0.6, 0, n.y)); return [k, k]; }
      if (part === 'wing') {
        const top = sm(-0.2, 0.5, n.y);
        const k = mixC(mixC(mixC(C(0x6c5d4e), C(0x2c2620), sm(0.6, 0.85, u)), C(0x5a5048), 1 - top), C(0x3c342c), sm(0.85, 1, p.chord) * 0.5);
        return [k, k];
      }
      const z = p.z / this.len + 0.5, top = sm(-0.1, 0.6, n.y);
      let k = mixC(C(0xc5b9a3), C(0x6d5e4e), top);
      k = mixC(k, C(0xd6ccb8), sm(0.75, 0.9, z) * (1 - top));
      k = mixC(k, C(0xf1efe8), (1 - sm(0.1, 0.22, z)) * sm(0.2, -0.4, n.y));
      return [k, k];
    },
    mat(part) {
      if (part === 'bill' || part === 'leg' || part === 'foot') return [1, 0, 0, 0];
      if (part === 'head' || part === 'neck') return [0, 0, 0.05, 0.25];
      return [0, 0, part === 'body' || part === 'wing' ? 0.9 : 0.4, 0];
    }
  },
  heron: {
    len: 0.44, w: 0.085, h: 0.1, d: 0.1, cy: 0.88, rise: 0.08, float: 0.0, zfold: 1,
    neck: [[0, 0.98, 0.16], [0, 1.1, 0.205], [0, 1.2, 0.16], [0, 1.3, 0.2]], neckR: [0.048, 0.021],
    head: { r: 0.03, long: 1.5 }, bill: { len: 0.13, w: 0.0105, h: 0.0125, droop: 0.002, tip: 0.05 },
    legs: { x: 0.04, hip: [0.84, -0.01], knee: [0.46, 0.015], ankle: 0.03, r: 0.0105, foot: { len: 0.11, w: 0.034 } },
    tail: { len: 0.11, w: 0.07, up: -0.04 }, wing: { half: 0.86, chord: 0.31, at: [0.07, 0.97, 0.14], tipShape: 0.65, sweep: 0.08 },
    paint(part, p, n, u) {
      if (part === 'bill') { const k = mixC(C(0xd1a43c), C(0x5c4e2c), sm(0.2, 0.7, n.y) * 0.6); return [k, k]; }
      if (part === 'leg' || part === 'foot') { const k = C(0x5e5a40); return [k, k]; }
      if (part === 'head') {
        // a white face and crown with the black stripe back over the eye to the plume
        const stripe = sm(0.25, 0.55, n.y) * sm(0.2, 0.55, Math.abs(n.x) + 0.3) * (1 - sm(0.55, 0.8, u));
        const k = mixC(C(0xeceae4), C(0x18181c), stripe);
        return [k, k];
      }
      if (part === 'neck') {
        const front = sm(0.2, 0.75, n.z) + sm(-0.2, -0.7, n.y) * 0.5;
        const k = mixC(mixC(C(0x8b8b86), C(0xa39d94), u), mixC(C(0xe9e6de), C(0x3b3b40), Math.abs(Math.sin(p.y * 260)) > 0.9 ? 0.5 : 0), Math.min(1, front));
        return [k, k];
      }
      if (part === 'tail') { const k = C(0x5f6c78); return [k, k]; }
      if (part === 'wing') {
        const top = sm(-0.2, 0.5, n.y);
        const k = mixC(mixC(C(0x6b7c8b), C(0x1f2125), sm(0.55, 0.75, u)), mixC(C(0x5c6a76), C(0x2a2c30), sm(0.55, 0.75, u)), 1 - top);
        return [mixC(k, C(0x7a4b31), sm(0.08, 0.02, u) * top * 0.8), mixC(k, C(0x7a4b31), sm(0.08, 0.02, u) * top * 0.8)];
      }
      const top = sm(-0.2, 0.5, n.y);
      let k = mixC(C(0x4f5258), C(0x6e7f8e), top);
      k = mixC(k, C(0xdedbd2), sm(0.8, 0.95, p.z / this.len + 0.5) * sm(0.3, 0.9, n.z));
      return [k, k];
    },
    mat(part) {
      if (part === 'bill' || part === 'leg' || part === 'foot') return [1, 0, 0, 0];
      return [0, 0, part === 'wing' ? 0.25 : 0.15, 0];
    }
  },
  hawk: {
    len: 0.36, w: 0.08, h: 0.075, d: 0.088, cy: 0.25, rise: 0.02, float: 0, zfold: 0.5,
    neck: [[0, 0.272, 0.15], [0, 0.29, 0.168], [0, 0.305, 0.18], [0, 0.315, 0.188]], neckR: [0.058, 0.046],
    head: { r: 0.042, long: 1.1 }, bill: { len: 0.034, w: 0.012, h: 0.017, droop: 0.016, tip: 0.2 },
    legs: { x: 0.035, hip: [0.2, 0.0], knee: [0.1, 0.03], ankle: 0.02, r: 0.012, foot: { len: 0.05, w: 0.03 } },
    tail: { len: 0.21, w: 0.12, up: 0.0 }, wing: { half: 0.6, chord: 0.28, at: [0.06, 0.28, 0.08], tipShape: 0.7, sweep: 0.04 },
    paint(part, p, n, u) {
      const top = sm(-0.2, 0.5, n.y);
      if (part === 'bill') { const k = mixC(C(0x2f2f31), C(0xd8b74a), sm(0.25, 0.1, u)); return [k, k]; }
      if (part === 'leg' || part === 'foot') { const k = mixC(C(0xd9b83a), C(0xefe6d3), sm(0.5, 0.2, u) * (part === 'leg' ? 1 : 0)); return [k, k]; }
      if (part === 'head') { const k = mixC(C(0x4e3524), C(0xe6dac2), sm(0.1, -0.6, n.y) * 0.8); return [k, k]; }
      if (part === 'tail') { const k = mixC(C(0xe9d5bd), C(0xb24f27), top); return [mixC(k, C(0x2a1a12), sm(0.9, 0.97, u) * top), k]; }
      if (part === 'wing') {
        // pale beneath with the dark bar along the leading edge and dark tips; brown above
        const bar = sm(0.2, 0.0, p.chord) * sm(0.05, 0.15, u) * (1 - sm(0.45, 0.55, u));
        const under = mixC(mixC(C(0xeee6d6), C(0x2c211a), Math.max(bar, sm(0.88, 0.98, u) * 0.85)), C(0x8c7a68), sm(0.85, 1, p.chord) * 0.4);
        const k = mixC(under, mixC(C(0x5b3f2b), C(0x3a2a1e), sm(0.6, 1, u)), top);
        return [k, k];
      }
      // cream below with the dark streaked belly band; brown above
      const z = p.z / this.len + 0.5;
      const band = sm(0.25, 0.4, z) * (1 - sm(0.55, 0.65, z)) * sm(0.2, -0.3, n.y) * (Math.sin(p.x * 180) > 0.2 ? 1 : 0.45);
      const k = mixC(mixC(C(0xece2cc), C(0x3d2a1c), band * 0.8), C(0x5a3e2a), top);
      return [k, k];
    },
    mat(part) {
      if (part === 'bill' || part === 'leg' || part === 'foot') return [1, 0, 0, 0];
      return [0, 0, 0.55, 0];
    }
  }
};

// ============================================================================
// 2. THE SKELETON, the same names for every bird
// ============================================================================
function birdBones(S) {
  const { len, cy } = S, L = S.legs, W = S.wing, N = S.neck;
  const tipZ = N[3][2] + S.head.r * S.head.long * 0.8 + S.bill.len;
  const bones = [
    { name: 'root', parent: null, at: [0, 0, 0] },
    { name: 'body', parent: 'root', at: [0, cy, 0] },
    { name: 'tail', parent: 'body', at: [0, cy + 0.2 * S.h, -len * 0.42], end: [0, cy + S.tail.up + 0.2 * S.h, -len * 0.5 - S.tail.len] },
    { name: 'neck0', parent: 'body', at: N[0] },
    { name: 'neck1', parent: 'neck0', at: N[1] },
    { name: 'neck2', parent: 'neck1', at: N[2] },
    { name: 'head', parent: 'neck2', at: N[3], end: [0, N[3][1] - S.bill.droop, tipZ] }
  ];
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const [wx, wy, wz] = W.at;
    bones.push(
      { name: 'shoulder' + side, parent: 'body', at: [s * wx, wy, wz] },
      { name: 'elbow' + side, parent: 'shoulder' + side, at: [s * (wx + W.half * 0.3), wy, wz] },
      { name: 'hand' + side, parent: 'elbow' + side, at: [s * (wx + W.half * 0.62), wy, wz], end: [s * (wx + W.half), wy, wz - W.sweep] },
      { name: 'thigh' + side, parent: 'body', at: [s * L.x, L.hip[0], L.hip[1]] },
      { name: 'shin' + side, parent: 'thigh' + side, at: [s * L.x, L.knee[0], L.knee[1]] },
      { name: 'foot' + side, parent: 'shin' + side, at: [s * L.x, L.ankle, L.knee[1] - 0.01], end: [s * L.x, 0.004, L.knee[1] + L.foot.len] }
    );
  }
  return bones;
}
const toR = (n) => n.replace(/L$/, 'R');

// ============================================================================
// 3. THE BODY: torso, neck, head and bill, eyes, tail, wings and legs
// ============================================================================
function birdBody(S, detail) {
  const b = new Body(birdBones(S).map((x) => ({ ...x })));
  const hi = detail > 0;
  const segs = hi ? 26 : 8, steps = hi ? 4 : 1;
  const part = (name, extra = {}) => ({
    col: (p, n, a, u, side) => S.paint(name, { x: p.x, y: p.y, z: p.z, chord: extra.chordAt ? extra.chordAt(p) : 0 }, n, u, side),
    mat: (p, n, a, u) => S.mat(name, p, n, u)
  });
  const { len, w, h, d, cy, rise } = S;

  // the torso, tail to breast: fuller in front, the breast rounded down to the water
  const prof = [[0, 0.16], [0.07, 0.58], [0.22, 0.88], [0.42, 1], [0.62, 1], [0.8, 0.9], [0.92, 0.66], [0.985, 0.32], [1, 0.08]];
  b.loft(prof.map(([t, k]) => ({ c: [0, cy + rise * (t - 0.5) + 0.15 * h * (1 - k), -len / 2 + t * len], rx: w * k, ry: h * k, down: d * k })),
    { segs, steps, bones: ['body', 'tail', 'neck0'], scale: 14, vScale: 14, fluff: 0.01, ...part('body') });

  // the neck, from the top of the breast through its three bones to the back of the head
  const N = S.neck, [r0, r1] = S.neckR;
  const nk = [
    { c: [0, N[0][1] - 0.6 * r0, N[0][2] - 0.4 * r0], rx: r0 * 1.15, ry: r0 * 1.1 },
    { c: N[0], rx: r0, ry: r0 * 1.05 },
    { c: N[1], rx: r0 * 0.55 + r1 * 0.45, ry: r0 * 0.58 + r1 * 0.45 },
    { c: N[2], rx: r1 * 1.05, ry: r1 * 1.1 },
    { c: [0, N[3][1] + 0.1 * S.head.r, N[3][2] - 0.1 * S.head.r], rx: r1 * 1.1, ry: r1 * 1.2 }
  ];
  b.loft(nk, { segs: hi ? 20 : 7, steps, bones: ['body', 'neck0', 'neck1', 'neck2', 'head'], scale: 26, vScale: 26, ...part('neck') });

  // the head: the skull, a little long, then the bill
  const hr = S.head.r, hl = S.head.long, hc = [0, N[3][1] + hr * 0.35, N[3][2] + hr * 0.25];
  const hk = [
    { c: [0, hc[1] - hr * 0.1, hc[2] - hr * 0.95 * hl], rx: hr * 0.12 },
    { c: [0, hc[1], hc[2] - hr * 0.75 * hl], rx: hr * 0.68, ry: hr * 0.72, down: hr * 0.66 },
    { c: [0, hc[1] + hr * 0.04, hc[2] - hr * 0.25 * hl], rx: hr * 0.92, ry: hr * 0.95, down: hr * 0.88 },
    { c: [0, hc[1] + hr * 0.02, hc[2] + hr * 0.2 * hl], rx: hr * 0.86, ry: hr * 0.88, down: hr * 0.82 },
    { c: [0, hc[1] - hr * 0.08, hc[2] + hr * 0.58 * hl], rx: hr * 0.6, ry: hr * 0.55, down: hr * 0.6 },
    { c: [0, hc[1] - hr * 0.2, hc[2] + hr * 0.8 * hl], rx: S.bill.w * 1.1, ry: S.bill.h * 1.3, down: S.bill.h * 1.2 }
  ];
  b.loft(hk, { segs, steps, bones: ['head', 'neck2'], scale: 40, vScale: 40, ...part('head') });
  const B = S.bill, bz = hc[2] + hr * 0.8 * hl, by = hc[1] - hr * 0.2;
  const bill = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, wide = 1 - t * (1 - B.tip) - (t > 0.85 ? (t - 0.85) / 0.15 * B.tip * 0.85 : 0);
    bill.push({ c: [0, by - B.droop * t * t, bz + t * B.len], rx: Math.max(0.0008, B.w * wide), ry: Math.max(0.0006, B.h * (1 - t * 0.75) * 0.55), down: Math.max(0.0006, B.h * (1 - t * 0.7) * 0.5) });
  }
  b.loft(bill, { segs: hi ? 14 : 6, steps: hi ? 2 : 1, bones: ['head'], scale: 60, ...part('bill') });
  for (const s of [1, -1]) {
    b.ball([s * hr * 0.74, hc[1] + hr * 0.15, hc[2] + hr * 0.18 * hl], hr * 0.2, { segs: hi ? 14 : 5, rings: hi ? 7 : 3, bones: ['head'], col: () => [C(0x0a0806), C(0x0a0806)], mat: () => [0, 1, 0, 0] });
  }

  // the tail: a flat fan off the rump
  const T = S.tail, tz = -len * 0.42, ty = cy + 0.2 * h;
  b.loft([
    { c: [0, ty, tz + 0.02], rx: T.w * 0.45, ry: 0.012 },
    { c: [0, ty + T.up * 0.2, tz - T.len * 0.3], rx: T.w * 0.75, ry: 0.009 },
    { c: [0, ty + T.up * 0.6, tz - T.len * 0.75], rx: T.w * 0.95, ry: 0.006 },
    { c: [0, ty + T.up, tz - T.len * 1.05], rx: T.w * 0.9, ry: 0.004 },
    { c: [0, ty + T.up * 1.05, tz - T.len * 1.12], rx: T.w * 0.4, ry: 0.002 }
  ], { segs: hi ? 16 : 6, steps: hi ? 2 : 1, bones: ['tail', 'body'], scale: 10, vScale: 10, ...part('tail') });

  // the wings: along +x from the shoulder, the leading edge on the bones, the chord behind; tapered to the tip
  const Wg = S.wing, [wx, wy, wz] = Wg.at;
  const wingKeys = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const chord = Wg.chord * (u < 0.55 ? 1 - u * 0.12 : (1 - 0.066) * (1 - ((u - 0.55) / 0.45) ** (1.3 + Wg.tipShape)) * 0.82 + 0.12 * (1 - u));
    const sweep = Wg.sweep * u * u;
    wingKeys.push({ c: [wx + u * Wg.half - (i === 0 ? 0.01 : 0), wy, wz - sweep - chord * 0.5], rx: Math.max(0.004, chord * 0.5), ry: Math.max(0.0018, 0.016 * (Wg.chord / 0.2) * (1 - u * 0.75)) });
  }
  const chordAt = (p) => {
    const u = Math.max(0, Math.min(1, (Math.abs(p.x) - wx) / Wg.half));
    return Math.max(0, Math.min(1, (wz - Wg.sweep * u * u - p.z) / Math.max(0.01, Wg.chord * (1 - u * 0.5))));
  };
  const wingOpts = { segs: hi ? 18 : 6, steps: hi ? 3 : 1, upRef: [0, 1, 0], bones: ['shoulderL', 'elbowL', 'handL'], swap: toR, scale: 9, vScale: 9 };
  for (const mirror of [false, true]) {
    const wp = part('wing', { chordAt });
    b.loft(wingKeys, { ...wingOpts, mirror, col: (p, n, a, t, side) => S.paint('wing', { x: p.x, y: p.y, z: p.z, chord: chordAt(p) }, n, Math.max(0, (Math.abs(p.x) - wx) / Wg.half)), mat: wp.mat });
  }

  // the legs: thigh feathers into the belly, the bare shank, the webbed or toed foot
  const L = S.legs, legOpts = { segs: hi ? 10 : 4, steps: hi ? 3 : 1, upRef: [0, 0, 1], bones: ['thighL', 'shinL', 'footL'], swap: toR, scale: 50 };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [L.x, L.hip[0] + 0.01, L.hip[1]], rx: L.r * 2.2 },
      { c: [L.x, L.hip[0] - (L.hip[0] - L.knee[0]) * 0.4, (L.hip[1] + L.knee[1]) / 2], rx: L.r * 1.25 },
      { c: [L.x, L.knee[0], L.knee[1]], rx: L.r },
      { c: [L.x, (L.knee[0] + L.ankle) / 2, L.knee[1] - 0.005], rx: L.r * 0.85 },
      { c: [L.x, L.ankle + 0.004, L.knee[1] - 0.01], rx: L.r * 0.9 }
    ], { ...legOpts, mirror, ...part('leg') });
    const F = L.foot;
    b.loft([
      { c: [L.x, 0.006, L.knee[1] - 0.018], rx: F.w * 0.12, ry: 0.004 },
      { c: [L.x, 0.005, L.knee[1] + F.len * 0.15], rx: F.w * 0.32, ry: 0.0035 },
      { c: [L.x, 0.004, L.knee[1] + F.len * 0.55], rx: F.w * 0.48, ry: 0.003 },
      { c: [L.x, 0.004, L.knee[1] + F.len * 0.88], rx: F.w * 0.5, ry: 0.0025 },
      { c: [L.x, 0.004, L.knee[1] + F.len], rx: F.w * 0.18, ry: 0.0018 }
    ], { segs: hi ? 10 : 4, steps: hi ? 2 : 1, upRef: [0, 1, 0], bones: ['footL', 'shinL'], swap: toR, mirror, scale: 50, ...part('foot') });
  }
  return b;
}

// ============================================================================
// 4. THE MATERIAL: each vertex its colour (A or B), the feathers' texture over it
// ============================================================================
function featherMaterial(tex, plumage = 'A') {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 });
  const am = attribute('aMat', 'vec4'), col = attribute(plumage === 'B' ? 'aColB' : 'aColA', 'vec3');
  const isEye = step(0.9, am.y), bare = am.x;
  m.colorNode = Fn(() => {
    const f = texture(tex.color, uv());
    const lum = f.r.mul(1.55);
    const c = col.mul(lum).mul(f.b.mul(0.3).add(0.75)).toVar();
    // pale feather edges, stronger where the species is scaled or barred
    c.assign(mix(c, c.mul(1.45).add(0.035), am.z.mul(f.g)));
    return vec3(mix(mix(c, col, bare), vec3(0.01, 0.008, 0.006), isEye));
  })();
  m.roughnessNode = mix(mix(mix(float(0.82), float(0.42), am.w), float(0.5), bare), float(0.1), isEye);
  m.normalNode = normalize(mix(normalMap(texture(tex.normal, uv()), float(0.7)), normalView, step(0.5, bare.add(isEye))));
  return m;
}

// ============================================================================
// 5. POSES: swimming, standing, walking, grazing, dabbling, flying, soaring
// ============================================================================
/**
 * p: { fold (1 folded – 0 spread), flap (phase 0–1), beat (how hard), glide (wings held up a little), walk, step
 * (phase), paddle, graze (neck down to the grass), dabble (tipped up, tail in the air), alert (neck up), hiss (neck out
 * low), tuck (head drawn in, asleep), legsUp (tucked in flight), trail (a heron's legs out behind), yaw (the head),
 * time, seed, zfold }
 */
function poseBird(bones, map, p) {
  const r = (n) => bones[map[n]].rotation;
  for (const b of bones) b.rotation.set(0, 0, 0);
  const t = p.time, f = p.fold, unf = 1 - f;
  const sw = Math.sin(p.flap * Math.PI * 2), up = Math.max(0, Math.cos(p.flap * Math.PI * 2 + 0.6));

  // the body tips up to dabble and rolls with a waddle
  r('body').x = 1.75 * p.dabble + 0.05 * Math.sin(t * 1.3 + p.seed) * (1 - p.walk) * 0.3;
  r('body').z = 0.08 * Math.sin(p.step * Math.PI * 2) * p.walk;
  r('body').y = 0.05 * Math.sin(p.step * Math.PI * 2) * p.walk;

  // the neck
  const bob = 0.06 * Math.sin(p.step * Math.PI * 4) * p.walk;
  r('neck0').x = 0.85 * p.graze - 0.35 * p.alert + 0.75 * p.hiss - 0.6 * p.tuck - 0.4 * p.retract + bob;
  r('neck1').x = 0.55 * p.graze - 0.1 * p.alert - 0.25 * p.hiss + 0.95 * p.tuck + 1.25 * p.retract;
  r('neck2').x = 0.35 * p.graze + 0.1 * p.alert - 0.35 * p.hiss + 0.35 * p.tuck - 1.0 * p.retract - 0.3 * p.dabble;
  r('head').x = -0.4 * p.graze + 0.25 * p.alert - 0.15 * p.hiss - 0.4 * p.tuck + 0.15 * p.retract + 0.08 * Math.sin(t * 6 + p.seed) * p.graze;
  r('neck1').y = p.yaw * 0.35;
  r('neck2').y = p.yaw * 0.3;
  r('head').y = p.yaw * 0.45;

  // the tail: cocked and wagged
  r('tail').x = -0.15 * p.dabble - 0.1 * (1 - f) + 0.04 * Math.sin(t * 2.1 + p.seed);
  r('tail').y = 0.12 * Math.sin(t * 9 + p.seed) * Math.max(0, Math.sin(t * 0.7 + p.seed) - 0.85) * 6;

  // the wings: folded back along the flanks, or spread and beating
  const z = p.zfold;
  for (const [side, k] of [['L', 1], ['R', -1]]) {
    const sh = r('shoulder' + side), el = r('elbow' + side), ha = r('hand' + side);
    sh.order = 'YXZ';
    sh.z = k * (unf * (p.beat * 0.95 * sw + p.glide * 0.12));
    sh.x = -Math.PI / 2 * f * 0.94;
    sh.y = k * (Math.PI / 2 * f * 0.97 + unf * 0.25 * up * p.beat);
    el.z = -k * (2.6 * z * f) + k * unf * (-0.25 * up * p.beat + p.glide * 0.04);
    el.y = k * unf * 0.35 * up * p.beat;
    ha.z = k * (2.55 * z * f) + k * unf * (-0.35 * sw * p.beat * 0.5 + p.glide * 0.08);
    ha.y = k * (unf * (0.55 * up * p.beat + 0.08 * p.glide) + f * 0.1 * (1 - z));

    // the legs: alternating to walk, kicking under water, tucked up or trailing to fly
    const ph = p.step * Math.PI * 2 + (k > 0 ? 0 : Math.PI), kick = p.paddle * Math.sin(t * 7 + (k > 0 ? 0 : Math.PI));
    r('thigh' + side).x = -0.5 * Math.sin(ph) * p.walk + 0.6 * kick + 1.35 * p.legsUp + 1.45 * p.trail;
    r('shin' + side).x = 0.55 * Math.max(0, Math.cos(ph)) * p.walk + 0.3 * Math.max(0, kick) - 1.9 * p.legsUp - 0.05 * p.trail;
    r('foot' + side).x = -0.35 * Math.max(0, -Math.sin(ph)) * p.walk + 1.2 * p.legsUp + 0.7 * p.trail;
  }
}

// ============================================================================
// 6. A SPECIES' KIT: the near body (skinned, posed per bird), a far stand-in baked in its usual pose, the materials
// ============================================================================
const FOLDED = { fold: 1, flap: 0, beat: 0, glide: 0, walk: 0, step: 0, paddle: 0, graze: 0, dabble: 0, alert: 0, hiss: 0, tuck: 0, retract: 0, legsUp: 0, trail: 0, yaw: 0, time: 0, seed: 0, zfold: 1 };

function makeSkeleton(defs) {
  const index = Object.fromEntries(defs.map((d, i) => [d.name, i]));
  const bones = defs.map((d) => { const b = new THREE.Bone(); b.name = d.name; return b; });
  defs.forEach((d, i) => {
    const parent = d.parent ? defs[index[d.parent]] : null;
    bones[i].position.set(d.at[0] - (parent?.at[0] || 0), d.at[1] - (parent?.at[1] || 0), d.at[2] - (parent?.at[2] || 0));
    if (parent) bones[index[d.parent]].add(bones[i]);
  });
  return { bones, index };
}

let sharedFeathers = null, featherUsers = 0;

function createBirdKit(kind, { farCount = 12, farPose = FOLDED } = {}) {
  const S = SPECIES[kind];
  if (!sharedFeathers) sharedFeathers = paintFeathers({ seed: 31, rows: 10, perRow: 7 });
  featherUsers++;
  const tex = sharedFeathers;
  const defs = birdBones(S);
  const nearBody = birdBody(S, 1), farBody = birdBody(S, 0);
  const nearGeo = nearBody.geometry();
  const inverses = defs.map((b) => new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
  const mats = { A: featherMaterial(tex, 'A'), B: featherMaterial(tex, 'B') };
  const size = Math.max(S.wing.half * 2 + 0.2, S.neck[3][1] + 0.2);
  const sphere = new THREE.Sphere(new THREE.Vector3(0, S.cy, 0), size * 0.75);

  // the far stand-in: the low body posed once (folded, or as the hawk soars) and baked, so it needs no skeleton
  const farSkinned = farBody.geometry();
  const bake = new THREE.SkinnedMesh(farSkinned, mats.A);
  const sk = makeSkeleton(defs);
  bake.add(sk.bones[0]);
  bake.bind(new THREE.Skeleton(sk.bones, inverses), new THREE.Matrix4());
  poseBird(sk.bones, sk.index, { ...FOLDED, zfold: S.zfold, ...farPose });
  bake.updateMatrixWorld(true);
  bake.skeleton.update();
  const farGeo = new THREE.BufferGeometry();
  const pos = farSkinned.attributes.position, out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); bake.applyBoneTransform(i, v); v.toArray(out, i * 3); }
  farGeo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  for (const k of ['uv', 'aMat', 'aColA', 'aColB']) farGeo.setAttribute(k, farSkinned.attributes[k]);
  farGeo.setIndex(farSkinned.index);
  farGeo.computeVertexNormals();
  farGeo.computeBoundingSphere();
  farSkinned.deleteAttribute('skinIndex'); farSkinned.deleteAttribute('skinWeight');

  const far = {};
  for (const [k, m] of Object.entries(mats)) {
    const inst = new THREE.InstancedMesh(farGeo, m, farCount);
    inst.count = 0;
    inst.frustumCulled = false;
    inst.castShadow = true;
    inst.name = `${kind} far (${k})`;
    far[k] = inst;
  }
  function make(plumage = 'A') {
    const { bones, index } = makeSkeleton(defs);
    const mesh = new THREE.SkinnedMesh(nearGeo, mats[plumage]);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    mesh.boundingSphere = sphere;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = kind;
    return { mesh, bones, index, plumage };
  }
  const bytes = (g) => Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength || 0);
  return {
    kind, spec: S, make, far, materials: mats, pose: (body, p) => { p.zfold = S.zfold; poseBird(body.bones, body.index, p); },
    stats: { triangles: nearGeo.index.count / 3, farTriangles: farGeo.index.count / 3, bytes: bytes(nearGeo) + bytes(farGeo), textureBytes: featherUsers === 1 ? tex.bytes : 0 },
    dispose() {
      nearGeo.dispose(); farGeo.dispose();
      for (const m of Object.values(mats)) m.dispose();
      if (--featherUsers === 0) { tex.color.dispose(); tex.normal.dispose(); sharedFeathers = null; }
    }
  };
}

export { createBirdKit, poseBird, SPECIES as BIRD_SPECIES, FOLDED as BIRD_FOLDED, makeSkeleton };
