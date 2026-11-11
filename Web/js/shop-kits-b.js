import { H0, D0, HT, SLOT, C, BRIGHTS, MUTED, CLOTHES, shadeHex, chair, stool, tableRound, pendant, ceilingPanel,
  trackSpots, picture, plant, till, monitor, counter, shelves, goods, bottleRow, bench, armchair, stanchion, rope, bike,
  mannequin, garments, strip, writing } from './shop-kit-core.js';

// Lamp: more of the rooms behind the shopfronts' glass (shop-kits.js has the rest, and says how they're laid out)

const PI = Math.PI, E = PI / 2, W = -PI / 2, S = PI, N = 0;

function apparel(K) {
  K.shell({ skirting: 0x8a8376 });
  // rails of clothes along both walls, a shelf of folded things over each
  const wallRail = (x, z0, z1, ry) => K.group(x, (z0 + z1) / 2, ry, () => {
    const w = z1 - z0;
    garments(K, -w / 2 + 0.15, w / 2 - 0.15, 1.62, 0.3, { step: 0.07 });
    for (const sx of [-w / 2 + 0.05, 0, w / 2 - 0.05]) K.rod(sx, 1.62, 0.02, sx, 1.62, 0.3, 0.012, C.chrome);
    K.box(0, 1.95, 0.2, w, 0.03, 0.4, 0xd9d4c8);
    for (let x = -w / 2 + 0.25; x < w / 2 - 0.2; x += 0.42) {
      const n = 2 + Math.floor(K.rand() * 4);
      for (let k = 0; k < n; k++) K.box(x, 1.98 + k * 0.045, 0.2, 0.3, 0.042, 0.32, K.pick(CLOTHES), { faces: 'ftrl' });
    }
  }, { stretch: true });
  wallRail(H0, 0.5, 4.3, W);
  wallRail(-H0, 1.9, 4.5, E);
  // a rack along the room and a round one
  K.group(-0.2, 3.25, 0, () => {
    garments(K, -0.8, 0.8, 1.45, 0, { step: 0.07, long: 0.85, short: 0.6 });
    for (const sx of [-0.88, 0.88]) { K.rod(sx, 0, 0, sx, 1.45, 0, 0.016, C.chrome); K.box(sx, 0, 0, 0.05, 0.03, 0.5, C.chrome); }
    K.shadow(0, 0, 2.1, 0.8);
  });
  K.group(-1.25, 1.95, 0, () => {
    K.cyl(0, 0, 0, 0.3, 0.03, C.chrome, { seg: 10 });
    K.cyl(0, 0.03, 0, 0.02, 1.42, C.chrome, { seg: 5, open: true });
    K.cyl(0, 1.44, 0, 0.5, 0.02, C.chrome, { seg: 14, open: true });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * PI * 2, len = 0.55 + K.rand() * 0.3;
      K.box(Math.sin(a) * 0.5, 1.36 - len, Math.cos(a) * 0.5, 0.42, len, 0.04, K.pick(CLOTHES), { ry: a + E, faces: 'fbrlu' });
    }
    K.shadow(0, 0, 1.3, 1.3);
  });
  // a table of folded shirts
  K.group(0.9, 1.75, 0, () => {
    K.box(0, 0.74, 0, 1.4, 0.05, 0.8, C.oak);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.62, 0, sz * 0.32, 0.06, 0.74, 0.06, C.oak, { faces: 'fbrl' });
    K.shadow(0, 0, 1.7, 1.1);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const n = 2 + Math.floor(K.rand() * 4), col = K.pick(CLOTHES);
      for (let k = 0; k < n; k++) K.box(-0.5 + i * 0.34, 0.79 + k * 0.045, -0.19 + j * 0.38, 0.28, 0.042, 0.32, k % 2 ? shadeHex(col, 0.85) : col);
    }
  });
  // dummies in the window, on a low stand
  K.group(2.05, 0.6, 0, () => { K.box(0, 0, 0, 2.5, 0.16, 0.8, 0xd9d4c8); });
  mannequin(K, 1.2, 0.6, S + 0.25, { top: 0x8a1f24, legs: 0x22242c });
  mannequin(K, 2.1, 0.55, S, { top: 0xd9b99a, legs: 0x2c3e50, skirt: true });
  mannequin(K, 2.95, 0.6, S - 0.3, { top: 0x2e6f6a, legs: 0x51473d });
  // the back: a tall mirror, two fitting rooms behind curtains, the till
  K.group(0.3, D0, 0, () => {
    K.box(0, 0.25, -0.03, 0.8, 1.95, 0.05, C.oak);
    K.plane(0, 1.22, -0.06, 0.68, 1.82, 'S', 0xcfdfe4, { glow: 0.35 });
    K.plane(-0.12, 1.5, -0.064, 0.1, 1.0, 'S', 0xeef6f8, { glow: 0.45, ry: 0 });
  });
  K.group(-2.2, D0 - 0.5, 0, () => {
    K.box(0, 0, 0, 0.05, 2.2, 1.0, 0xd9d4c8); K.box(-1.1, 0, 0, 0.05, 2.2, 1.0, 0xd9d4c8); K.box(1.1, 0, 0, 0.05, 2.2, 1.0, 0xd9d4c8);
    K.rod(-1.1, 2.1, -0.48, 1.1, 2.1, -0.48, 0.015, C.chrome);
    for (const cx of [-0.55, 0.55]) for (let i = 0; i < 7; i++) {
      K.box(cx - 0.36 + i * 0.12, 0.12, -0.48 + (i % 2) * 0.04, 0.12, 1.96, 0.03, 0xffffff, { slot: SLOT.accent, k: i % 2 ? 1.25 : 0.85, faces: 'fbrl' });
    }
  });
  counter(K, 1.5, 3.1, 4.35, 0.6, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak });
  till(K, 2.6, 1.0, 4.65);
  K.box(1.8, 1.0, 4.6, 0.3, 0.2, 0.2, 0xe3d5c0);
  trackSpots(K, -2.4, 2.8, 2.0, 5);
  trackSpots(K, -2.4, 2.8, 3.8, 5);
  K.spot(2.4, 5.05, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
  K.spot(2.75, 2.5, E, 'browse');
  K.spot(0.9, 2.45, S, 'lean');
  K.spot(-0.2, 2.7, N, 'browse');
  K.spot(-2.8, 3.3, W, 'browse');
  K.spot(1.9, 3.8, N, 'counter', { h: 1.0 });
}

// a counter-height case with a glass top: little bright things on dark velvet
function jewelCase(K, w, d, { base = 0xffffff, slot = SLOT.accent } = {}) {
  K.box(0, 0, 0, w, 0.78, d, base, { slot });
  K.box(0, 0.78, 0, w - 0.04, 0.02, d - 0.04, 0x14161c);
  K.plane(0, 0.99, 0, w - 0.06, d - 0.06, 'D', 0xfff6e0, { glow: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(sx * (w / 2 - 0.012), 0.78, sz * (d / 2 - 0.012), 0.02, 0.24, 0.02, C.brass, { faces: 'fbrl' });
  K.box(0, 1.0, 0, w, 0.02, d, C.brass, { faces: 'fbrl' });
  K.box(0, 1.005, 0, w - 0.03, 0.006, d - 0.03, 0xd6e6e8);
  const gems = [0xf4d27a, 0xe8e8f0, 0xf4d27a, 0x7ad0f4, 0xf47a9a, 0x9af4b0, 0xe8e8f0];
  for (let x = -w / 2 + 0.14; x < w / 2 - 0.1; x += 0.2) {
    for (let z = -d / 2 + 0.12; z < d / 2 - 0.08; z += 0.17) {
      if (K.rand() < 0.25) continue;
      const g = K.pick(gems);
      if (K.rand() < 0.5) K.box(x, 0.8, z, 0.09, 0.03, 0.09, 0x1c2234), K.sph(x, 0.845, z, 0.022, g, { glow: 0.8, ws: 5, hs: 3 });
      else K.cyl(x, 0.8, z, 0.045, 0.012, g, { seg: 8, open: true, glow: 0.7 });
    }
  }
}
function jewelry_gift(K) {
  K.shell({ skirting: 0x14161c });
  K.group(0.2, 4.35, 0, () => jewelCase(K, 4.0, 0.6), { stretch: true });
  K.group(H0 - 0.75, 2.6, E, () => jewelCase(K, 2.6, 0.6), { stretch: true });
  K.group(-0.5, 2.1, 0, () => {
    K.box(0, 0, 0, 0.6, 0.95, 0.6, 0xffffff, { slot: SLOT.accent });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(sx * 0.28, 0.95, sz * 0.28, 0.02, 0.5, 0.02, C.brass, { faces: 'fbrl' });
    K.box(0, 1.45, 0, 0.6, 0.02, 0.6, C.brass);
    K.plane(0, 1.44, 0, 0.5, 0.5, 'D', 0xfff6e0, { glow: 0.9 });
    // a necklace on a bust
    K.cyl(0, 0.97, 0, 0.1, 0.26, 0x1c2234, { seg: 8, r2: 0.05 });
    K.cyl(0, 1.12, 0.02, 0.085, 0.012, 0xf4d27a, { seg: 8, open: true, rx: 0.5, glow: 0.8 });
    K.shadow(0, 0, 0.9, 0.9);
  });
  // lit niches in the back wall, a thing in each
  const things = (x, y, z, i) => {
    if (i % 3 === 0) { K.cyl(x, y, z, 0.07, 0.2, BRIGHTS[i % 12], { seg: 8, r2: 0.035 }); K.sph(x, y + 0.24, z, 0.06, BRIGHTS[(i + 4) % 12], { ws: 6, hs: 4 }); }
    else if (i % 3 === 1) { K.box(x, y, z, 0.16, 0.16, 0.12, MUTED[i % 12]); K.box(x, y + 0.16, z, 0.17, 0.02, 0.13, C.brass); }
    else { K.cyl(x, y, z, 0.09, 0.03, 0xe8e8f0, { seg: 8 }); K.cyl(x, y + 0.03, z, 0.03, 0.17, 0xe8e8f0, { seg: 6, r2: 0.07 }); }
  };
  for (let i = 0; i < 5; i++) {
    K.group(-2.4 + i * 1.2, D0, 0, () => {
      for (const y of [1.25, 1.95]) {
        K.plane(0, y + 0.25, -0.012, 0.8, 0.56, 'S', 0xfff0d0, { glow: 0.8 });
        K.box(0, y - 0.05, -0.08, 0.86, 0.03, 0.16, C.brass);
        things(-0.18, y - 0.02, -0.09, i * 2 + (y > 1.5 ? 1 : 0));
        things(0.2, y - 0.02, -0.09, i * 2 + 5 + (y > 1.5 ? 1 : 0));
      }
    });
  }
  // presents on shelves along the left wall, and a stand of cards
  K.group(-H0, 3.6, E, () => shelves(K, 3.0, 2.0, 0.28, 4, { frame: 0x2a2420, y0: 0.5, fill: goods(BRIGHTS, { size: 0.18, tall: 0.24 }) }), { stretch: true });
  K.group(-1.7, 3.4, 0, () => {
    K.cyl(0, 0, 0, 0.22, 0.03, C.char, { seg: 8 }); K.cyl(0, 0.03, 0, 0.02, 1.55, C.char, { seg: 5, open: true });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2 + r * 0.3;
      K.box(Math.sin(a) * 0.2, 0.5 + r * 0.27, Math.cos(a) * 0.2, 0.13, 0.19, 0.012, K.pick(BRIGHTS), { ry: a, rx: -0.15 });
    }
    K.shadow(0, 0, 0.7, 0.7);
  });
  trackSpots(K, -2.6, 2.9, 2.2, 5);
  trackSpots(K, -2.6, 2.9, 4.2, 5);
  K.spot(0.2, 4.95, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
  K.spot(0.9, 3.75, N, 'lean');
  K.spot(2.1, 2.5, E, 'lean');
  K.spot(-0.5, 2.75, S, 'lean');
  K.spot(-2.8, 3.5, W, 'browse');
}

function grocery(K) {
  K.shell({ skirting: 0x7a7a74 });
  const packs = goods(BRIGHTS, { size: 0.17, tall: 0.24 });
  // gondolas down the room: goods both sides, an end facing the window
  for (const gx of [0.55, 2.2]) {
    for (const ry of [E, W]) K.group(gx, 3.05, ry, () => shelves(K, 2.8, 1.55, 0.3, 4, { frame: 0xd9dcd8, back: 0xc4c8c4, y0: 0.14, fill: packs }), { stretch: true });
    K.group(gx, 1.62, S, () => shelves(K, 0.62, 1.55, 0.28, 4, { frame: 0xd9dcd8, back: 0xc4c8c4, y0: 0.14, fill: goods([0xd9862a, 0xc0392b, 0xf1c40f], { size: 0.17 }) }));
    K.group(gx, 1.5, 0, () => K.plane(0, 1.7, 0.1, 0.62, 0.22, 'S', 0xffffff, { slot: SLOT.accent }));
    K.shadow(gx, 3.0, 1.1, 3.4, 0.66);
  }
  // coolers along the back wall, lit all night
  K.group(0, 0, 0, () => {
    K.box(0, 0, D0 - 0.3, 6.6, 2.15, 0.6, 0x3a3f44);
    K.plane(0, 2.28, D0 - 0.61, 6.6, 0.24, 'S', 0xffffff, { slot: SLOT.accent });
  }, { stretch: true });
  for (let i = 0; i < 7; i++) {
    K.group(-2.82 + i * 0.94, D0 - 0.61, 0, () => {
      K.plane(0, 1.12, 0, 0.84, 1.95, 'S', 0xdff2ff, { glow: 2 });
      for (let r = 0; r < 5; r++) {
        K.plane(0, 0.22 + r * 0.38, -0.004, 0.84, 0.025, 'S', 0x8a9298);
        const col = K.pick(BRIGHTS), two = K.pick(BRIGHTS);
        for (let b = 0; b < 6; b++) K.plane(-0.33 + b * 0.132, 0.36 + r * 0.38, -0.006, 0.1, 0.24, 'S', b < 3 ? col : two, { glow: 2 });
      }
      K.box(0.4, 0.9, -0.02, 0.025, 0.5, 0.03, C.chrome);
    });
  }
  // the checkout by the door
  K.group(-1.95, 2.75, 0, () => {
    K.box(0, 0, 0, 0.62, 0.92, 1.7, 0xffffff, { slot: SLOT.accent });
    K.box(0, 0.92, 0, 0.68, 0.035, 1.76, 0x2a2c30);
    K.box(0.02, 0.957, -0.25, 0.44, 0.006, 0.9, 0x16181a);
    K.shadow(0, 0, 1.0, 2.0);
    // sweets at the till
    for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) K.box(0.36, 0.25 + r * 0.22, -0.6 + i * 0.13, 0.08, 0.12, 0.11, K.pick(BRIGHTS), { faces: 'rtfb' });
  });
  till(K, -1.95, 0.957, 3.25, E);
  // fruit and vegetables in the window
  K.group(2.55, 0.85, 0, () => {
    K.box(0, 0, 0.15, 1.6, 0.5, 0.9, 0x7a5a3c);
    K.box(0, 0.5, 0.42, 1.6, 0.3, 0.36, 0x7a5a3c);
    const fruit = [0xd9862a, 0xb0291f, 0x7ab02a, 0xf1c40f, 0xb0291f, 0x5a8a2a, 0xe6b422, 0x8a3a8a];
    for (let c = 0; c < 4; c++) for (let row = 0; row < 2; row++) {
      const col = fruit[(c + row * 4) % fruit.length], y = row ? 0.8 : 0.5, z = row ? 0.42 : -0.05;
      K.box(-0.6 + c * 0.4, y, z, 0.38, 0.05, 0.34, 0x5a4026);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) K.sph(-0.71 + c * 0.4 + i * 0.11, y + 0.085 + ((i + j) % 2) * 0.03, z - 0.1 + j * 0.1, 0.055, col, { ws: 5, hs: 3 });
    }
    K.shadow(0, 0.1, 1.9, 1.3);
  });
  K.group(-H0, 4.2, E, () => shelves(K, 1.6, 1.9, 0.3, 5, { frame: 0xd9dcd8, back: 0xc4c8c4, fill: packs }));
  for (const x of [-1.6, 0.55, 2.4]) strip(K, x, 0.8, 4.6);
  K.spot(-2.75, 2.9, E, 'counter', { role: 'staff', h: 0.95 });
  K.spot(-1.3, 2.9, W, 'counter', { h: 0.95 });
  K.spot(1.35, 3.0, E, 'browse');
  K.spot(-0.6, 4.55, N, 'browse');
  K.spot(1.4, 1.2, E, 'lean');
  K.spot(-0.25, 2.6, E, 'browse');
}

function salon(K) {
  K.shell();
  // stations along the right wall: a mirror ringed with bulbs, a shelf, a chair
  const stations = [1.25, 2.85, 4.45];
  stations.forEach((z, i) => {
    K.group(H0, z, W, () => {
      K.box(0, 0.95, 0.03, 0.86, 1.3, 0.05, C.woodD);
      K.plane(0, 1.6, 0.06, 0.74, 1.18, 'N', 0xd3e4ea, { glow: 0.4 });
      K.plane(0.12, 1.75, 0.064, 0.1, 0.7, 'N', 0xf0f8fa, { glow: 0.5 });
      for (let b = 0; b < 5; b++) K.sph(-0.32 + b * 0.16, 2.3, 0.08, 0.035, C.bulb, { glow: 1, ws: 5, hs: 3 });
      K.box(0, 0.84, 0.16, 0.9, 0.04, 0.3, C.woodD);
      bottleRow(K, -0.35, 0.3, 0.88, 0.18, { step: 0.11, h: 0.16, palette: [0xe84393, 0x7ad0f4, 0xf4f1ea, 0x2c3e50, 0x9af4b0] });
    });
    // the chair: a deep seat on a chrome post, a footrest
    K.group(H0 - 1.05, z, E, () => {
      K.cyl(0, 0, 0, 0.3, 0.03, C.chrome, { seg: 12 });
      K.cyl(0, 0.03, 0, 0.05, 0.36, C.chrome, { seg: 6, open: true });
      K.box(0, 0.38, 0.02, 0.54, 0.13, 0.52, 0xffffff, { slot: SLOT.accent });
      K.box(0, 0.5, -0.24, 0.52, 0.56, 0.1, 0xffffff, { slot: SLOT.accent, k: 0.9, rx: -0.1 });
      for (const s of [-1, 1]) K.box(s * 0.3, 0.62, 0, 0.06, 0.04, 0.4, C.chrome);
      K.box(0, 0.14, 0.42, 0.34, 0.03, 0.12, C.chrome);
      K.shadow(0, 0, 0.9, 0.9);
      K.spot(0, 0.04, 0, 'sit', { h: 0.52, pair: i, prio: 1 + i });
      K.spot(0, -0.62, 0, 'work', { role: 'staff', pair: i });
    });
  });
  // a basin to wash at, at the back on the left
  K.group(-H0 + 0.35, 4.6, E, () => {
    K.box(0, 0, 0, 0.6, 0.8, 0.5, C.woodD);
    K.box(0, 0.8, 0.02, 0.56, 0.16, 0.46, 0xf4f1ea);
    K.box(0, 0.93, 0.04, 0.42, 0.04, 0.32, 0x16181a);
    K.rod(0, 0.96, -0.18, 0, 1.12, -0.05, 0.015, C.chrome);
  });
  // somewhere to wait, the desk, things to buy behind it
  K.group(-H0 + 0.3, 2.75, E, () => {
    bench(K, 1.7, { slot: SLOT.accent, col: 0xffffff, depth: 0.5, back: 0.9 });
    K.spot(-0.4, 0.05, 0, 'read', { h: 0.45, prio: 2 });
    K.spot(0.45, 0.05, 0, 'sit', { h: 0.45, prio: 6 });
  });
  K.group(-2.3, 2.75, 0, () => { K.box(0, 0, 0, 0.5, 0.42, 0.8, C.woodD); K.box(0.02, 0.42, 0.1, 0.28, 0.012, 0.2, 0xe84393, { ry: 0.3 }); K.box(-0.05, 0.42, -0.2, 0.28, 0.012, 0.2, 0x7ad0f4, { ry: -0.2 }); });
  counter(K, -1.3, 0.5, 4.3, 0.55, 1.05, { front: 0xffffff, slot: SLOT.accent, top: 0xe8e4da });
  till(K, -0.2, 1.05, 4.58);
  K.group(-0.4, D0, S, () => shelves(K, 2.2, 1.3, 0.2, 3, { frame: 0xe8e4da, y0: 0.05, sides: false, fill: (k, x0, x1, y, d) =>
    bottleRow(k, x0 + 0.05, x1 - 0.05, y, d - 0.08, { step: 0.1, h: 0.2, palette: [0xe84393, 0x7ad0f4, 0xf4f1ea, 0x2c3e50, 0x9af4b0, 0xf1c40f] }) }), { y: 1.1 });
  plant(K, 0.1, 0.55, 1.4);
  for (const z of stations) pendant(K, 1.4, z, 2.2, { shade: 0xe8e4da, r: 0.2 });
  ceilingPanel(K, -1.5, 2.6, 1.2, 0.6);
  K.spot(-0.5, 4.95, S, 'counter', { role: 'staff', h: 1.05 });
}

function bank(K) {
  K.shell({ skirting: 0x4a4a48 });
  // the tellers' counter: stone front, glass above it, a screen at each window
  counter(K, -1.5, 3.3, 4.0, 0.7, 1.1, { front: 0x8a867a, top: 0x3a332c });
  K.group(0, 0, 0, () => {
    K.box(0.9, 2.0, 4.1, 4.8, 0.06, 0.08, C.brass);
    K.plane(0.9, 2.2, D0 - 0.012, 4.6, 0.36, 'S', 0xffffff, { slot: SLOT.accent });
  }, { stretch: true });
  [-0.6, 0.9, 2.4].forEach((x, i) => {
    K.group(x, 4.1, 0, () => {
      for (const sx of [-0.7, 0.7]) K.box(sx, 1.1, 0, 0.04, 0.9, 0.06, C.brass);
      K.box(0, 1.1, -0.06, 0.4, 0.015, 0.2, 0x16181a);
    });
    monitor(K, x + 0.3, 1.1, 4.5, S + 0.3, 0.42);
    if (i < 2) K.spot(x, 4.95, S, 'counter', { role: 'staff', h: 1.08 });
  });
  K.group(0.9, D0, 0, () => { K.cyl(0, 2.7, -0.03, 0.2, 0.04, 0xf4f1ea, { seg: 14, rx: E, center: true }); K.rod(0, 2.7, -0.055, 0.08, 2.78, -0.055, 0.008, C.black); K.rod(0, 2.7, -0.055, 0, 2.56, -0.055, 0.008, C.black); });
  // the line: posts and belts, a runner
  K.group(0, 0, 0, () => K.plane(0.15, 0.008, 2.7, 1.2, 2.3, 'U', 0xffffff, { slot: SLOT.accent, k: 0.8 }), { stretch: true });
  const posts = [[-0.6, 1.6], [-0.6, 2.7], [-0.6, 3.6], [0.9, 1.6], [0.9, 2.7], [0.9, 3.6]];
  for (const [x, z] of posts) stanchion(K, x, z, C.chrome);
  for (const i of [0, 1, 3, 4]) K.group(0, 0, 0, () => K.rod(posts[i][0], 0.9, posts[i][1], posts[i + 1][0], 0.9, posts[i + 1][1], 0.016, 0xffffff, { slot: SLOT.accent }), { stretch: true });
  // a banker's desk on the right, two chairs before it
  K.group(2.55, 1.75, 0, () => {
    K.box(0, 0.7, 0, 0.75, 0.05, 1.5, 0x4a3828);
    K.box(0.2, 0, 0, 0.04, 0.7, 1.4, 0x4a3828); K.box(-0.3, 0, -0.68, 0.6, 0.7, 0.04, 0x4a3828); K.box(-0.3, 0, 0.68, 0.6, 0.7, 0.04, 0x4a3828);
    K.box(-0.1, 0.752, -0.45, 0.22, 0.012, 0.3, C.paper);
    K.shadow(0, 0, 1.1, 1.8);
  });
  monitor(K, 2.7, 0.75, 2.0, W + 0.3, 0.42);
  chair(K, 3.2, 1.75, W, { frame: C.char, seat: 'accent', spot: { pose: 'type', table: true, role: 'staff', pair: 9 } });
  chair(K, 1.85, 1.4, E, { frame: C.char, seat: 'accent', spot: { table: true, pair: 9, prio: 3 } });
  chair(K, 1.85, 2.1, E, { frame: C.char, seat: 'accent' });
  // the cash machine in the wall inside the door, a table to write at
  K.group(-H0 + 0.26, 2.6, E, () => {
    K.box(0, 0, 0, 0.7, 1.75, 0.5, 0x39424c);
    K.plane(0, 1.58, 0.252, 0.6, 0.2, 'N', 0xffffff, { slot: SLOT.accent, glow: 2 });
    K.plane(0, 1.2, 0.252, 0.4, 0.3, 'N', 0x9fd0ff, { glow: 2 });
    K.box(0, 0.86, 0.3, 0.44, 0.04, 0.14, 0x8a9298, { rx: 0.4 });
    K.plane(0, 0.7, 0.252, 0.36, 0.04, 'N', 0x08090a);
    K.shadow(0, 0.15, 0.9, 0.8);
  });
  K.group(-H0 + 0.25, 4.1, 0, () => { K.box(0, 1.0, 0, 0.45, 0.04, 1.1, 0x4a3828); K.box(0, 0, 0, 0.3, 1.0, 0.08, 0x4a3828); K.box(0, 1.04, 0.2, 0.2, 0.01, 0.12, C.paper); K.box(0, 1.04, -0.2, 0.2, 0.01, 0.12, C.paper); });
  plant(K, -2.5, 5.0, 1.6);
  for (const [x, z] of [[-1.7, 1.6], [0.2, 1.6], [2.1, 1.6], [-1.7, 3.4], [0.2, 3.4], [2.1, 3.4]]) ceilingPanel(K, x, z, 1.1, 0.55, 0xf4f8ff);
  K.spot(0.15, 3.35, N, 'counter', { h: 1.08, prio: 1 });
  K.spot(0.15, 2.5, N, 'stand', { prio: 2 });
  K.spot(-2.75, 2.6, W, 'counter', { h: 1.0, prio: 4 });
  K.spot(0.2, 1.75, N, 'stand', { prio: 6 });
}

function medical(K) {
  K.shell({ skirting: 0x8a9290 });
  // reception: a desk with a lower end, a screen, a sign with a cross on the wall behind
  counter(K, 0.3, 3.2, 3.95, 0.6, 1.1, { front: 0xf2f4f2, top: 0xffffff, slot: 0 });
  K.group(0, 0, 0, () => K.plane(1.75, 0.55, 3.944, 2.9, 0.16, 'S', 0xffffff, { slot: SLOT.accent }), { stretch: true });
  monitor(K, 1.5, 0.78, 4.5, S, 0.46);
  K.group(1.75, D0, 0, () => {
    K.plane(0, 2.1, -0.014, 1.5, 0.7, 'S', 0xf6f8f6);
    K.plane(-0.45, 2.1, -0.02, 0.12, 0.4, 'S', 0xffffff, { slot: SLOT.accent }); K.plane(-0.45, 2.1, -0.02, 0.4, 0.12, 'S', 0xffffff, { slot: SLOT.accent });
    writing(K, 0.25, 2.1, -0.02, 0.8, 0.4, 'S', { rows: 3, col: 0x5a6a70 });
  });
  K.group(1.6, 4.75, 0, () => {
    K.cyl(0, 0, 0, 0.26, 0.03, C.char, { seg: 8 }); K.cyl(0, 0.03, 0, 0.03, 0.4, C.char, { seg: 5 });
    K.box(0, 0.43, 0, 0.46, 0.08, 0.44, 0xffffff, { slot: SLOT.accent }); K.box(0, 0.5, 0.2, 0.42, 0.45, 0.06, 0xffffff, { slot: SLOT.accent });
    K.spot(0, 0, S, 'type', { h: 0.5, table: true, role: 'staff' });
  });
  // the door through to the rooms
  K.group(-2.3, D0, 0, () => {
    K.box(0, 0, -0.03, 1.0, 2.15, 0.06, 0xd9dcd8); K.plane(0, 1.04, -0.065, 0.86, 2.02, 'S', 0xb9c4c2);
    K.box(0.32, 1.0, -0.08, 0.04, 0.14, 0.03, C.chrome); K.plane(0, 1.55, -0.07, 0.24, 0.6, 'S', 0xdff0f4, { glow: 0.5 });
  });
  // chairs to wait in: joined in rows along both walls
  const row = (x, z, ry, n) => K.group(x, z, ry, () => {
    K.box(0, 0.36, -0.02, n * 0.56, 0.04, 0.06, C.chrome);
    for (let i = 0; i < n; i++) {
      const cx = (i - (n - 1) / 2) * 0.56;
      K.box(cx, 0.4, 0.02, 0.5, 0.06, 0.46, 0xffffff, { slot: SLOT.accent });
      K.box(cx, 0.5, -0.2, 0.5, 0.42, 0.05, 0xffffff, { slot: SLOT.accent, k: 0.88, rx: -0.12 });
      K.spot(cx, 0.04, 0, i === 1 ? 'read' : 'sit', { h: 0.46, prio: (i * 2 + (x < 0 ? 1 : 0)) % 5 });
    }
    for (const s of [-1, 1]) { K.box(s * (n * 0.28 - 0.1), 0, 0, 0.04, 0.38, 0.04, C.chrome); K.box(s * (n * 0.28 - 0.1), 0, 0, 0.05, 0.03, 0.5, C.chrome); }
    K.shadow(0, 0.05, n * 0.6 + 0.2, 0.9, 0.7);
  });
  row(H0 - 0.33, 1.9, W, 4);
  row(-H0 + 0.33, 3.0, E, 3);
  // a low table of magazines, a plant, a water cooler, notices
  K.group(0.1, 2.3, 0, () => {
    K.box(0, 0.34, 0, 1.0, 0.04, 0.55, 0xc9b99a);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.44, 0, sz * 0.22, 0.04, 0.34, 0.04, 0xc9b99a, { faces: 'fbrl' });
    [[-0.25, 0.05, 0.3, 0x2980b9], [0.1, -0.08, -0.2, 0xc0392b], [0.3, 0.1, 0.5, 0xf1c40f]].forEach(([x, z, ry, c]) => K.box(x, 0.38, z, 0.21, 0.012, 0.28, c, { ry }));
    K.shadow(0, 0, 1.3, 0.85);
  });
  plant(K, 3.0, 0.5, 1.5, { pot: 0xe8e4da });
  K.group(-H0 + 0.25, 4.75, E, () => {
    K.box(0, 0, 0, 0.32, 1.0, 0.32, 0xf2f4f2);
    K.cyl(0, 1.0, 0, 0.13, 0.36, 0x9fd0ef, { seg: 8, r2: 0.11 });
    K.plane(0, 0.8, 0.162, 0.2, 0.14, 'N', 0x3a3f44);
  });
  for (const [z, w, h] of [[1.5, 0.5, 0.7], [2.3, 0.5, 0.7]]) picture(K, H0, 1.85, z, w, h, 'W', { frame: 0xf2f4f2, art: [0xf6f8f6, 0x3d6f86, 0x9fd0ef], rnd: K.rand });
  picture(K, -H0, 1.85, 3.0, 0.9, 0.6, 'E', { frame: 0xf2f4f2, art: [0xdfe9e6, 0x4a8a6a, 0xf6f8f6], rnd: K.rand });
  for (const [x, z] of [[-1.7, 1.6], [1.7, 1.6], [-1.7, 3.6], [1.7, 3.6]]) ceilingPanel(K, x, z, 1.2, 0.6, 0xf2faff);
  K.spot(1.2, 3.4, N, 'counter', { h: 1.08, prio: 2 });
}

function bike_sports(K) {
  K.shell({ skirting: 0x3a3a3a });
  const paint = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xe67e22, 0xecf0f1, 0x16a085];
  // bikes side on in the window, each on a stand
  [[-0.2, 1.15, 0], [1.75, 1.3, 1], [0.7, 2.75, 2], [2.6, 2.8, 4]].forEach(([x, z, c]) => {
    bike(K, x, 0.03, z, c % 2 ? 0 : PI, paint[c]);
    K.group(x, z, 0, () => { K.box(-0.52, 0, 0, 0.3, 0.03, 0.34, 0x2a2a2c); K.box(-0.52, 0.03, 0.06, 0.03, 0.3, 0.03, 0x2a2a2c); K.shadow(0, 0, 1.9, 0.6, 0.7); });
  });
  // more hung along the back wall, over a rack of wheels
  [[-1.2, 5], [0.7, 3], [2.5, 6]].forEach(([x, c]) => bike(K, x, 1.55, D0 - 0.16, 0, paint[c], { rz: 0.12 }));
  K.group(0, 0, 0, () => K.box(0.6, 1.45, D0 - 0.1, 5.6, 0.05, 0.16, 0x55595e), { stretch: true });
  for (let i = 0; i < 6; i++) K.group(-1.6 + i * 0.75, D0 - 0.12, 0, () => {
    K.cyl(0, 0.38, 0, 0.34, 0.035, 0x121214, { seg: 14, open: true, center: true, rx: E });
    K.cyl(0, 0.38, 0, 0.31, 0.02, 0xb8bcc0, { seg: 14, open: true, center: true, rx: E });
  });
  // the workshop: a stand with a bike up in it, a bench, tools on a board
  K.group(2.3, 4.25, 0, () => {
    K.cyl(0, 0, 0.35, 0.3, 0.03, 0x2a2a2c, { seg: 8 }); K.cyl(0, 0.03, 0.35, 0.03, 1.4, 0xb0392b, { seg: 6, open: true });
    K.rod(0, 1.4, 0.35, 0, 1.42, 0.05, 0.025, 0x2a2a2c);
  });
  bike(K, 2.3, 0.62, 4.25, 0, paint[5], { rz: -0.1 });
  K.group(H0 - 0.3, 4.4, W, () => {
    K.box(0, 0, 0, 1.9, 0.86, 0.55, 0x4a3323); K.box(0, 0.86, 0, 2.0, 0.05, 0.6, C.oak);
    K.plane(0, 1.7, -0.27, 1.9, 1.1, 'N', 0xa98a5a);
    for (let i = 0; i < 12; i++) K.box(-0.8 + (i % 6) * 0.32, 1.35 + Math.floor(i / 6) * 0.45, -0.25, 0.05, 0.22 + (i % 3) * 0.06, 0.02, i % 4 ? 0x8a9298 : 0xb0392b);
    K.box(-0.5, 0.91, 0, 0.3, 0.12, 0.2, 0xb0392b); K.cyl(0.5, 0.91, 0.05, 0.05, 0.16, 0x2980b9, { seg: 6 });
  });
  // helmets and shoes along the left wall, jerseys over them, a bin of balls
  K.group(-H0, 3.5, E, () => {
    shelves(K, 3.2, 1.5, 0.3, 3, { frame: 0x55595e, y0: 0.35, fill: (k, x0, x1, y, d, lvl) => {
      for (let x = x0 + 0.16; x < x1 - 0.1; x += 0.32) {
        if (lvl > 0) k.sph(x, y, d - 0.15, 0.125, k.pick(paint), { ws: 8, hs: 4, half: true, sz: 1.2 });
        else { k.box(x, y, d - 0.16, 0.24, 0.11, 0.28, k.pick([0xecf0f1, 0x2c3e50, 0xc0392b, 0x1c1c1e])); }
      }
    } });
    K.rod(-1.5, 2.45, 0.1, 1.5, 2.45, 0.1, 0.012, C.chrome);
    for (let i = 0; i < 6; i++) {
      const c = paint[(i * 2 + 1) % paint.length];
      K.box(-1.25 + i * 0.5, 1.75, 0.08, 0.36, 0.62, 0.03, c); K.box(-1.25 + i * 0.5, 2.2, 0.08, 0.6, 0.17, 0.03, c);
      K.plane(-1.25 + i * 0.5, 2.1, 0.098, 0.2, 0.16, 'N', 0xf4f1ea);
    }
  }, { stretch: true });
  K.group(-1.3, 2.9, 0, () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.3, 0, sz * 0.3, 0.025, 0.75, 0.025, 0x2a2a2c, { faces: 'fbrl' });
    for (const y of [0.1, 0.72]) { K.rod(-0.3, y, -0.3, 0.3, y, -0.3, 0.012, 0x2a2a2c); K.rod(-0.3, y, 0.3, 0.3, y, 0.3, 0.012, 0x2a2a2c); K.rod(-0.3, y, -0.3, -0.3, y, 0.3, 0.012, 0x2a2a2c); K.rod(0.3, y, -0.3, 0.3, y, 0.3, 0.012, 0x2a2a2c); }
    [[-0.13, 0.25, -0.12, 0xe67e22], [0.14, 0.26, 0.1, 0xecf0f1], [-0.1, 0.5, 0.12, 0xf1c40f], [0.12, 0.55, -0.1, 0xc0392b], [0, 0.78, 0, 0x27ae60]].forEach(([x, y, z, c]) => K.sph(x, y, z, 0.14, c, { ws: 8, hs: 5 }));
    K.shadow(0, 0, 0.9, 0.9);
  });
  counter(K, -2.9, -1.4, 4.4, 0.55, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak });
  till(K, -2.2, 1.0, 4.68);
  for (const x of [-1.6, 0.6, 2.4]) strip(K, x, 0.9, 4.4, 0xfff6e6);
  K.spot(-2.1, 5.05, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
  K.spot(1.55, 4.3, E, 'work', { role: 'staff' });
  K.spot(0.7, 2.05, N, 'lean');
  K.spot(-2.75, 3.6, W, 'browse');
  K.spot(-0.75, 1.75, S, 'stand');
  K.spot(-1.9, 3.85, N, 'counter', { h: 1.0 });
}

function dispensary(K) {
  K.shell({ skirting: 0x5a5c56 });
  // a plain lobby: the desk behind glass, a locked door through, a few chairs
  counter(K, 0.2, 3.2, 4.1, 0.6, 1.1, { front: 0xd9dad2, top: 0x3a3f3a });
  K.group(0, 0, 0, () => {
    for (const x of [0.25, 1.7, 3.15]) K.box(x, 1.1, 4.16, 0.04, 0.9, 0.05, 0x3a3f3a);
    K.box(1.7, 2.0, 4.16, 3.1, 0.05, 0.08, 0x3a3f3a);
    K.plane(1.7, 2.45, D0 - 0.012, 2.6, 0.12, 'S', 0xffffff, { slot: SLOT.accent, glow: 0.8 });
  }, { stretch: true });
  monitor(K, 1.9, 1.1, 4.6, S, 0.42);
  K.group(-2.2, D0, 0, () => {
    K.box(0, 0, -0.03, 1.05, 2.15, 0.06, 0x3a3f3a); K.plane(0, 1.04, -0.065, 0.9, 2.02, 'S', 0x8a8f88);
    K.box(0.62, 1.2, -0.03, 0.1, 0.16, 0.03, 0x16181a); K.plane(0.62, 1.31, -0.05, 0.06, 0.03, 'S', 0x7af08a, { glow: 2 });
  });
  K.group(-1.2, 3.5, 0, () => {
    K.box(0, 0, 0, 0.5, 1.1, 0.4, 0x3a3f3a); K.box(0, 1.1, 0.02, 0.56, 0.03, 0.44, 0xd9dad2, { rx: 0.2 });
    K.plane(0, 0.7, -0.202, 0.3, 0.3, 'S', 0xffffff, { slot: SLOT.accent });
    K.shadow(0, 0, 0.8, 0.7);
  });
  for (const z of [1.3, 1.95, 2.6]) chair(K, H0 - 0.33, z, W, { frame: C.char, seat: 'accent', spot: { prio: z > 2 ? 4 : z > 1.5 ? 6 : 2 } });
  K.group(H0 - 0.3, 3.3, 0, () => { K.box(0, 0, 0, 0.45, 0.45, 0.45, 0x3a3f3a); K.box(0, 0.45, 0, 0.26, 0.012, 0.2, C.paper); });
  plant(K, 2.9, 0.5, 1.7, { pot: 0x3a3f3a });
  plant(K, -3.0, 4.9, 1.4, { pot: 0x3a3f3a });
  picture(K, -H0, 1.7, 3.2, 1.2, 0.8, 'E', { frame: 0x3a3f3a, art: [0xdfe6da, 0x4f9a55, 0x8ab88a], rnd: K.rand });
  trackSpots(K, -2.4, 2.8, 2.4, 4);
  K.spot(1.5, 4.95, S, 'counter', { role: 'staff', h: 1.08 });
  K.spot(-1.2, 4.05, S, 'counter', { role: 'staff', h: 1.08 });
  K.spot(1.2, 3.5, N, 'counter', { h: 1.08, prio: 1 });
  K.spot(-1.0, 2.7, N, 'stand', { prio: 3 });
}

function gallery(K) {
  K.shell({ skirting: 0xd9d6ce });
  // pictures round the walls
  const ART = [[0xe8e0cc, 0xc0392b, 0x2c3e50], [0x1c2a3a, 0xf1c40f, 0xe67e22], [0xf2efe6, 0x16181a, 0x8a8f94], [0x2e6f6a, 0xf4f1ea, 0xd9862a], [0x8a1f24, 0xf1c40f, 0x1c1c1e], [0xdfe6ea, 0x2980b9, 0x27ae60], [0xf0d9d6, 0x8e44ad, 0x2c3e50]];
  const hang = (x, y, z, w, h, face, i) => picture(K, x, y, z, w, h, face, { frame: i % 2 ? 0x16181a : 0xd9c9a4, art: ART[i % ART.length], rnd: K.rand });
  hang(0.2, 1.65, D0, 2.2, 1.4, 'S', 0); hang(-2.3, 1.6, D0, 1.0, 1.2, 'S', 1); hang(2.5, 1.6, D0, 0.9, 0.9, 'S', 2);
  hang(-H0, 1.6, 2.6, 1.2, 0.9, 'E', 3); hang(-H0, 1.6, 4.3, 0.8, 1.1, 'E', 4);
  hang(H0, 1.6, 1.3, 0.9, 1.2, 'W', 5); hang(H0, 1.6, 2.9, 1.5, 1.0, 'W', 6); hang(H0, 1.6, 4.5, 0.8, 0.8, 'W', 1);
  // sculpture: stacked blocks on a plinth, a ball in a ring, a tall twist by the window
  K.group(-0.7, 2.2, 0, () => {
    K.box(0, 0, 0, 0.5, 1.0, 0.5, 0xf2efe6);
    for (let i = 0; i < 5; i++) K.box(0.03 * Math.sin(i * 2), 1.0 + i * 0.13, 0.03 * Math.cos(i * 3), 0.3 - i * 0.03, 0.13, 0.22 + (i % 2) * 0.08, 0x7a5a3c, { ry: i * 0.5 });
    K.shadow(0, 0, 0.9, 0.9);
  });
  K.group(1.6, 3.6, 0, () => {
    K.box(0, 0, 0, 0.6, 0.8, 0.6, 0xf2efe6);
    K.sph(0, 1.08, 0, 0.2, 0xffffff, { slot: SLOT.accent, ws: 10, hs: 7 });
    K.cyl(0, 1.08, 0, 0.3, 0.05, 0x16181a, { seg: 16, open: true, center: true, rx: 0.5, rz: 0.4 });
    K.shadow(0, 0, 1.0, 1.0);
  });
  K.group(2.7, 0.9, 0, () => {
    K.box(0, 0, 0, 0.5, 0.12, 0.5, 0x16181a);
    for (let i = 0; i < 9; i++) K.box(0, 0.12 + i * 0.2, 0, 0.26 - i * 0.012, 0.2, 0.26 - i * 0.012, 0x9aa0a6, { ry: i * 0.35 });
    K.shadow(0, 0, 0.8, 0.8);
  });
  K.group(0.3, 2.9, 0, () => { K.box(0, 0.36, 0, 1.5, 0.08, 0.42, 0x16181a); K.box(-0.6, 0, 0, 0.06, 0.36, 0.38, 0x16181a); K.box(0.6, 0, 0, 0.06, 0.36, 0.38, 0x16181a); K.shadow(0, 0, 1.8, 0.7); });
  // the desk in the back corner
  K.group(-2.5, 4.6, 0, () => {
    K.box(0, 0.72, 0, 1.3, 0.04, 0.6, 0xf2efe6); K.box(-0.6, 0, 0, 0.04, 0.72, 0.56, 0xf2efe6); K.box(0.6, 0, 0, 0.04, 0.72, 0.56, 0xf2efe6); K.box(0, 0.2, -0.28, 1.2, 0.52, 0.03, 0xf2efe6);
    K.box(0.3, 0.76, 0, 0.3, 0.014, 0.21, 0x9a9da0); K.box(0.3, 0.77, 0.11, 0.3, 0.2, 0.012, 0x9a9da0, { rx: 0.2 });
    for (let k = 0; k < 3; k++) K.box(-0.35, 0.76 + k * 0.012, 0.02, 0.15, 0.01, 0.21, k % 2 ? 0xc0392b : C.paper, { ry: k * 0.15 });
    K.shadow(0, 0, 1.6, 0.9);
  });
  chair(K, -2.5, 5.1, S, { frame: 0x16181a, spot: { pose: 'type', table: true, role: 'staff' } });
  trackSpots(K, -2.6, 2.9, 1.6, 5);
  trackSpots(K, -2.6, 2.9, 4.4, 6);
  trackSpots(K, 1.0, 4.6, 2.6, 4, { alongZ: true });
  K.spot(0.0, 4.3, N, 'stand');
  K.spot(2.6, 2.75, E, 'stand');
  K.spot(0.55, 4.25, N, 'stand');
  K.spot(-2.7, 2.6, W, 'stand');
  K.spot(-0.1, 2.5, W, 'stand');
}

function theatre(K) {
  K.shell({ skirting: 0x1a1412 });
  // the stand: sweets under glass, popcorn, drinks, a lit menu over it
  counter(K, -0.3, 3.2, 4.0, 0.7, 1.05, { front: 0xffffff, slot: SLOT.accent, top: 0x2a2020 });
  K.group(0, 0, 0, () => { K.plane(1.45, 0.6, 3.994, 3.2, 0.7, 'S', 0xfff3d6, { glow: 0.5 }); K.box(1.45, 2.35, 4.1, 3.7, 0.7, 0.2, 0x2a1416); }, { stretch: true });
  for (let i = 0; i < 12; i++) K.box(0.0 + i * 0.26, 0.3 + (i % 3) * 0.2, 3.985, 0.2, 0.14, 0.02, BRIGHTS[(i * 5) % 12], { glow: 0.5 });
  for (let i = 0; i < 3; i++) K.group(0.3 + i * 1.15, 3.99, 0, () => {
    K.plane(0, 2.7, 0, 1.05, 0.56, 'S', 0xfff1cf, { glow: 1 });
    writing(K, 0, 2.7, -0.006, 0.9, 0.46, 'S', { rows: 4, col: 0x4a2a20, glow: 0.6 });
  });
  K.group(2.5, 4.3, 0, () => {
    K.box(0, 1.05, 0, 0.7, 0.75, 0.55, 0xf6e7a0, { glow: 0.8 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(sx * 0.35, 1.05, sz * 0.27, 0.035, 0.78, 0.035, 0xb0291f, { faces: 'fbrl' });
    K.box(0, 1.8, 0, 0.78, 0.16, 0.62, 0xb0291f);
    K.sph(0, 1.2, 0, 0.26, 0xf4d27a, { ws: 8, hs: 4, sy: 0.6, glow: 0.8 });
  });
  K.group(0.9, 4.35, 0, () => {
    K.box(0, 1.05, 0, 0.6, 0.55, 0.45, 0x2a2c30);
    for (let i = 0; i < 4; i++) K.plane(-0.21 + i * 0.14, 1.44, -0.228, 0.1, 0.16, 'S', BRIGHTS[(i * 3 + 1) % 12], { glow: 0.8 });
  });
  for (let i = 0; i < 4; i++) K.cyl(1.6 + i * 0.12, 1.05, 4.2, 0.05, 0.16, i % 2 ? 0xb0291f : 0xf4f1ea, { seg: 6, r2: 0.065 });
  // the box office at the back on the left
  K.group(-2.3, D0 - 0.4, 0, () => {
    K.box(0, 0, 0, 1.5, 1.05, 0.8, 0x3a2020); K.box(0, 1.05, -0.3, 0.5, 0.02, 0.2, C.brass);
    K.box(0, 2.15, 0, 1.6, 0.3, 0.86, 0x3a2020); K.plane(0, 2.3, -0.435, 1.3, 0.2, 'S', 0xffe6a0, { glow: 1 });
    for (const sx of [-0.73, 0.73]) K.box(sx, 1.05, -0.38, 0.05, 1.1, 0.06, C.brass);
    K.spot(0, 0.1, S, 'counter', { role: 'staff', h: 1.02 });
  });
  // posters in lit cases along both walls
  const poster = (x, z, face, i) => picture(K, x, 1.65, z, 0.95, 1.35, face, { frame: C.brass, glow: 0.8,
    art: [[0x1c2a4a, 0xf1c40f, 0xc0392b], [0x8a1f24, 0xf4f1ea, 0x16181a], [0x16404a, 0xe67e22, 0xf4f1ea], [0x2a1a3a, 0xe84393, 0x7ad0f4]][i % 4], rnd: K.rand });
  poster(H0, 1.3, 'W', 0); poster(H0, 2.8, 'W', 1); poster(-H0, 2.5, 'E', 2); poster(-H0, 3.9, 'E', 3);
  // ropes to queue between
  const posts = [[-0.4, 1.5], [-0.4, 2.6], [-0.4, 3.5], [1.0, 1.5], [1.0, 2.6], [1.0, 3.5]];
  for (const [x, z] of posts) stanchion(K, x, z);
  for (const i of [0, 1, 3, 4]) rope(K, posts[i][0], posts[i][1], posts[i + 1][0], posts[i + 1][1], 0x8a1f24);
  // rows of bulbs overhead
  for (const z of [1.2, 2.4, 3.6]) for (let i = 0; i < 9; i++) K.group(-2.8 + i * 0.7, z, 0, () => K.sph(0, HT - 0.05, 0, 0.05, 0xffe2a0, { glow: 1, ws: 6, hs: 3 }));
  K.group(1.6, 2.0, 0, () => K.plane(0, 0.008, 0, 1.2, 0.8, 'U', 0xffffff, { slot: SLOT.accent, k: 0.5 }));
  K.spot(1.5, 4.95, S, 'counter', { role: 'staff', h: 1.05, roam: 0.6 });
  K.spot(0.3, 3.35, N, 'counter', { h: 1.05 });
  K.spot(0.3, 2.6, N, 'stand');
  K.spot(0.25, 1.9, N, 'stand');
  K.spot(2.2, 3.3, N, 'counter', { h: 1.05 });
  K.spot(2.85, 2.2, E, 'stand');
}

// an office the public walks into: an agent's, a cleaner's, a repairer's
function service(K) {
  K.shell({ skirting: 0x4a4a48 });
  const desk = (x, z, ry, pair) => K.group(x, z, ry, () => {
    K.box(0, 0.7, 0, 1.5, 0.04, 0.72, 0xc9b99a);
    K.box(-0.72, 0, 0, 0.04, 0.7, 0.68, 0x8a8f94); K.box(0.72, 0, 0, 0.04, 0.7, 0.68, 0x8a8f94); K.box(0, 0.25, -0.34, 1.4, 0.45, 0.03, 0x8a8f94);
    K.box(0.5, 0, 0.05, 0.4, 0.66, 0.55, 0x9aa0a4);
    K.box(-0.45, 0.742, 0.1, 0.22, 0.012, 0.3, C.paper); K.cyl(0.55, 0.74, -0.15, 0.04, 0.1, 0x2c3e50, { seg: 6 });
    monitor(K, 0, 0.74, 0.05, 0, 0.5);
    K.shadow(0, 0, 1.8, 1.1);
    // the one whose desk it is, and whoever came in to see them
    K.group(0, 0.75, 0, () => {
      K.cyl(0, 0, 0, 0.26, 0.03, C.char, { seg: 8 }); K.cyl(0, 0.03, 0, 0.03, 0.4, C.char, { seg: 5 });
      K.box(0, 0.43, 0, 0.46, 0.08, 0.44, 0xffffff, { slot: SLOT.accent }); K.box(0, 0.5, 0.2, 0.42, 0.5, 0.06, 0xffffff, { slot: SLOT.accent });
      K.spot(0, 0, S, 'type', { h: 0.5, table: true, role: 'staff' });
    });
    chair(K, -0.3, -0.85, N, { frame: C.char, seat: 'accent', spot: { table: true, prio: 2 + pair * 2 } });
    chair(K, 0.4, -0.9, N, { frame: C.char, seat: 'accent' });
  });
  desk(1.7, 2.3, 0, 0);
  desk(-0.9, 3.9, 0, 1);
  // filing cabinets and a board of notices along the back, a printer, a plant, a cooler
  K.group(1.8, D0 - 0.3, 0, () => {
    for (let i = 0; i < 4; i++) {
      K.box(-0.75 + i * 0.5, 0, 0, 0.47, 1.35, 0.6, i % 2 ? 0x8a8f94 : 0x9aa0a4);
      for (let d = 0; d < 4; d++) { K.plane(-0.75 + i * 0.5, 0.2 + d * 0.33, -0.302, 0.42, 0.3, 'S', 0xa9aeb2); K.box(-0.75 + i * 0.5, 0.3 + d * 0.33, -0.31, 0.14, 0.02, 0.02, C.chrome); }
    }
    K.box(-0.5, 1.35, 0, 0.5, 0.3, 0.45, 0xd9dcd8); K.plane(-0.5, 1.5, -0.226, 0.2, 0.06, 'S', C.screen, { glow: 0.8 });
    for (let k = 0; k < 3; k++) K.box(0.4, 1.35 + k * 0.1, 0, 0.36, 0.09, 0.28, [0x7a5a3c, 0xc9b99a, 0x7a5a3c][k]);
  });
  K.group(-1.2, D0, 0, () => {
    K.plane(0, 1.75, -0.02, 1.8, 1.1, 'S', 0x9a7a4c); K.box(0, 1.18, -0.02, 1.86, 1.14, 0.03, 0x6e4c30, { faces: 'rltu' });
    for (let i = 0; i < 9; i++) K.plane(-0.65 + (i % 3) * 0.62 + (K.rand() - 0.5) * 0.1, 2.05 - Math.floor(i / 3) * 0.33, -0.026, 0.3 + K.rand() * 0.14, 0.22 + K.rand() * 0.06, 'S', K.pick([C.paper, 0xf1e6a0, 0xbcd8f0, 0xf0c8c8, C.paper]));
  });
  K.group(-H0 + 0.3, 4.7, E, () => { K.box(0, 0, 0, 0.32, 1.0, 0.32, 0xf2f4f2); K.cyl(0, 1.0, 0, 0.13, 0.36, 0x9fd0ef, { seg: 8, r2: 0.11 }); });
  // a counter inside the door with a bell and leaflets, chairs under the window
  K.group(-1.2, 2.2, 0, () => {
    K.box(0, 0, 0, 1.3, 1.02, 0.45, 0xffffff, { slot: SLOT.accent }); K.box(0, 1.02, 0, 1.38, 0.04, 0.52, 0xc9b99a);
    for (let i = 0; i < 3; i++) K.box(-0.4 + i * 0.2, 1.06, 0.05, 0.14, 0.2, 0.06, BRIGHTS[i * 4], { rx: -0.2 });
    K.cyl(0.4, 1.06, 0, 0.05, 0.04, C.brass, { seg: 8, r2: 0.02 });
    K.shadow(0, 0, 1.6, 0.8);
  });
  for (const x of [2.3, 2.95]) chair(K, x, 0.5, N, { frame: C.char, seat: 'accent', spot: x > 2.5 ? { pose: 'read', prio: 4 } : null });
  plant(K, 0.3, 0.55, 1.5);
  picture(K, H0, 1.7, 3.6, 1.3, 0.9, 'W', { frame: 0x3a3f44, art: [0xcfe0ea, 0x4a8a6a, 0xd9c9a4], rnd: K.rand });
  K.group(-H0 + 0.03, 3.3, 0, () => { K.cyl(0, 2.3, 0, 0.18, 0.04, 0xf4f1ea, { seg: 14, rz: E, center: true }); });
  for (const [x, z] of [[-1.7, 1.6], [1.7, 1.6], [-1.7, 3.8], [1.7, 3.8]]) ceilingPanel(K, x, z, 1.2, 0.6, 0xf4f8f4);
  K.spot(-1.2, 1.55, N, 'counter', { h: 1.02, prio: 3 });
}

export const KITS_B = { apparel, jewelry_gift, grocery, salon, bank, medical, bike_sports, dispensary, gallery, theatre, service };
