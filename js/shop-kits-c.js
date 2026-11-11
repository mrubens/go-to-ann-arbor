import { H0, D0, HT, SLOT, C, BRIGHTS, BOTTLES, chair, stool, tableRound, tableSquare, pendant, ceilingPanel,
  picture, plant, till, counter, shelves, bottle, bottleRow, bench, writing } from './shop-kit-core.js';

// Lamp: the rooms of the kinds of restaurant (shop-types.js SHOP_CUISINES, from each place's cuisine in OpenStreetMap):
// a pizzeria's oven, a sushi counter, a diner's stools, a smokehouse's picnic tables. What says which is the room's
// fittings and colors; nothing here is anyone's trade dress. Laid out as shop-kits.js says (the door front left).

const PI = Math.PI, E = PI / 2, W = -PI / 2, S = PI, N = 0;
const sitAt = (o = {}) => ({ pose: 'sit', table: true, ...o });

// How each is finished (as shop-kits.js STYLES; `light`, `day`, `night` over the restaurant's own where given)
export const STYLES_C = {
  pizza: { floor: 'checker', wall: 'panel', walls: [0xb8a58a, 0xc9b592, 0xa89a84], floors: [0x8a3a2c, 0x7a4034], accents: [0x8a2a20, 0x1f5a34, 0x7a1a16], day: 1.0 },
  mexican: { floor: 'tile', wall: 'band', walls: [0xd9a03a, 0xe0b45a, 0xd98a4a], floors: [0x9a5a3a, 0xa8684a], accents: [0x1c7a6a, 0xc2491c, 0x2a5aa6, 0xa8243a], day: 1.05 },
  chinese: { floor: 'wood', wall: 'wainscot', walls: [0x8a1f1c, 0x7a1a20, 0x93281c], floors: [0x3a2a22, 0x44302a], accents: [0xc9a227, 0xd9b44a] },
  japanese: { floor: 'wood', wall: 'panel', walls: [0xcbb994, 0xd6c8a8, 0xbfae8c], floors: [0x7a6a54, 0x6a5a48], accents: [0x1f2a44, 0x2a2a2c, 0x5a2a2a], day: 0.95 },
  korean: { floor: 'concrete', wall: 'plain', walls: [0x4a4a4c, 0x55524c, 0x3f4448], floors: [0x4a4642, 0x3a3632], accents: [0xb0392b, 0x2a2a2c, 0x8a6a3a] },
  noodles: { floor: 'wood', wall: 'plain', walls: [0x5a4a3a, 0x4a5246, 0x66503a], floors: [0x3a322c, 0x44382e], accents: [0xb8401e, 0xc9a227, 0x2a5a4a] },
  indian: { floor: 'wood', wall: 'wainscot', walls: [0xa8551c, 0x9a3f1c, 0xb06a22], floors: [0x4a2a20, 0x3f241c], accents: [0xd9a227, 0x7a1f3a, 0x1f6a5a] },
  mediterranean: { floor: 'tile', wall: 'band', walls: [0xdfe6ea, 0xe9e6dc, 0xd6e2ea], floors: [0x9aa0a4, 0xa8a69a], accents: [0x1f4f8a, 0x1c5a8a, 0x2a6a9a], day: 1.05 },
  italian: { floor: 'wood', wall: 'wainscot', walls: [0xcbb38a, 0xbfa57a, 0xd6c29a], floors: [0x4a3020, 0x543624], accents: [0x6a1f24, 0x2f3b2a, 0x5a2a1c] },
  diner: { floor: 'checker', wall: 'panel', walls: [0xcfd9d6, 0xd9d6c8, 0xc4d6dc], floors: [0x9a9a96, 0xa8a49c], accents: [0xa62a24, 0x1f6a8a, 0xb03a5a], day: 1.05 },
  burger: { floor: 'checker', wall: 'band', walls: [0xd8d2c2, 0xe6dfcf], floors: [0x9a9286, 0xa69c8c], accents: [0xc2261c, 0xd98a12, 0x1c1c1e], day: 1.1 },
  sandwich: { floor: 'tile', wall: 'panel', walls: [0xcfc6a8, 0xd9d2b8, 0xc4c8b0], floors: [0x8a7a64, 0x9a8a70], accents: [0x2c5a34, 0x8a3a24, 0x2a4a6a], day: 1.05 },
  chicken: { floor: 'checker', wall: 'band', walls: [0xe2d6b8, 0xe9e0c8], floors: [0x9a9286, 0xa69c8c], accents: [0xd98a12, 0xb8321e, 0xc9a227], day: 1.1 },
  steakhouse: { floor: 'wood', wall: 'wainscot', walls: [0x3a2018, 0x2f1c18, 0x442a1c], floors: [0x241812, 0x2c1c14], accents: [0x5a1c1c, 0x3a2414, 0x1f2a24], night: 0.75, day: 0.7 },
  seafood: { floor: 'wood', wall: 'panel', walls: [0x9ab8c4, 0x8aaab8, 0xa8c4c8], floors: [0x6a6a66, 0x5a6a70], accents: [0x1c4a6a, 0x1f5a5a, 0x2a3f6a] },
  barbecue: { floor: 'concrete', wall: 'wainscot', walls: [0x7a5232, 0x6a4a30, 0x86603a], floors: [0x4a3a2c, 0x3a2e24], accents: [0x7a2a1a, 0x2a1c14, 0x8a3a1c] }
};

// ---------------------------------------------------------------------------------------------------------------------
// What several of them share
function serviceCounter(K, { x0 = -2.2, x1 = 3.2, z = 3.7, h = 1.02, front = 0xffffff, slot = SLOT.accent, top = 0xd8d4cc, tills = [-0.7, 1.3], staff = true } = {}) {
  counter(K, x0, x1, z, 0.7, h, { front, slot, top, kick: 0x2a2a2a });
  for (const x of tills) {
    till(K, x, h, z + 0.28);
    if (staff) K.spot(x, z + 0.9, S, 'counter', { role: 'staff', h, roam: 0.25 });
  }
}
// the menu overhead: lit boards with pictures and prices
function menuBoards(K, { x0 = -1.55, n = 4, z = 3.915, food = [0x9a5a2a, 0xc9a227, 0xb6382c, 0x4a8a3a], bar = 0xb6382c } = {}) {
  K.group(0, 0, 0, () => K.box(x0 + (n - 1) * 0.685, 2.3, z + 0.135, n * 1.37 + 0.1, 0.78, 0.26, 0x26262a), { stretch: true });
  for (let i = 0; i < n; i++) {
    K.group(x0 + i * 1.37, z, 0, () => {
      K.plane(0, 2.69, 0, 1.27, 0.64, 'S', 0xfff1cf, { glow: 1 });
      K.cyl(-0.36, 2.76, -0.008, 0.17, 0.004, food[i % food.length], { seg: 10, rx: E, center: true, glow: 0.9 });
      K.cyl(-0.36, 2.76, -0.012, 0.1, 0.004, food[(i + 2) % food.length], { seg: 8, rx: E, center: true, glow: 0.9 });
      K.plane(-0.36, 2.48, -0.008, 0.4, 0.07, 'S', bar, { glow: 0.9 });
      for (let r = 0; r < 5; r++) {
        K.plane(0.2 + K.rand() * 0.08, 2.9 - r * 0.105, -0.008, 0.5 + K.rand() * 0.16, 0.04, 'S', 0x3a2a20, { glow: 0.5 });
        K.plane(0.55, 2.9 - r * 0.105, -0.008, 0.09, 0.04, 'S', bar, { glow: 0.9 });
      }
    });
  }
}
function chalkboard(K, x, w = 2.6, y = 2.35, cols = 3) {
  K.group(x, D0, 0, () => {
    K.plane(0, y, -0.02, w + 0.12, 1.0, 'S', C.woodD);
    K.plane(0, y, -0.026, w, 0.88, 'S', 0x1f2526);
    writing(K, 0, y, -0.03, w - 0.2, 0.76, 'S', { rows: 6, cols });
  }, { anchor: [Math.max(-1, Math.min(1, x / 2.5)), 1] });
}
// the kitchen's line along the back wall: steel, a hood, a warm light under it
function kitchenLine(K, { hood = true } = {}) {
  K.group(0, 0, 0, () => {
    K.box(0.5, 0, D0 - 0.3, 5.6, 0.9, 0.6, 0xa9aeb2);
    K.box(0.5, 0.9, D0 - 0.3, 5.7, 0.03, 0.64, 0xc8ccd0);
    K.plane(0.5, 1.45, D0 - 0.012, 5.6, 0.95, 'S', 0xcfd4d4);
    if (hood) { K.box(0.5, 1.95, D0 - 0.32, 4.0, 0.34, 0.62, 0x9aa0a4); K.plane(0.5, 1.93, D0 - 0.3, 3.6, 0.4, 'D', 0xffc880, { glow: 0.8 }); }
  }, { stretch: true });
}
function booth(K, bx, bz, { top = 0xe6dfcf, col = 0xffffff, slot = SLOT.accent, w = 1.2 } = {}) {
  K.group(bx, bz, 0, () => {
    K.box(0, 0.72, 0, w, 0.04, 0.62, top);
    K.cyl(0, 0, 0, 0.06, 0.72, C.steel, { seg: 6 });
    K.cyl(-0.3, 0.76, -0.1, 0.04, 0.12, 0xf4f1ea, { seg: 6, r2: 0.05 });
    K.cyl(0.22, 0.76, 0.08, 0.11, 0.012, 0xf4f1ea, { seg: 10 });
  });
  for (const [dz, ry] of [[-0.72, N], [0.72, S]]) {
    K.group(bx, bz + dz, ry, () => {
      bench(K, w + 0.02, { slot, col, depth: 0.46, back: 1.15 });
      K.spot(-0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
      K.spot(0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
    });
  }
}
// a table for two (its chairs along x, or along z)
function twoTop(K, x, z, { cloth = null, top = C.wood, alongZ = false, frame = C.woodD, seat = null, centre = null } = {}) {
  tableSquare(K, x, z, 0.7, 0.7, { cloth, top, places: alongZ ? [[0, 0.2], [0, -0.2]] : [[0.2, 0], [-0.2, 0]], centre });
  if (alongZ) { chair(K, x, z - 0.6, N, { frame, seat, spot: sitAt() }); chair(K, x, z + 0.6, S, { frame, seat, spot: sitAt() }); }
  else { chair(K, x - 0.6, z, E, { frame, seat, spot: sitAt() }); chair(K, x + 0.6, z, W, { frame, seat, spot: sitAt() }); }
}
function fourTop(K, x, z, { cloth = null, top = C.wood, frame = C.woodD, seat = null, centre = 'candle', w = 0.9 } = {}) {
  tableSquare(K, x, z, w, w, { cloth, top, places: [[0.27, 0], [-0.27, 0], [0, 0.27], [0, -0.27]], centre });
  const d = w / 2 + 0.2;
  chair(K, x, z - d, N, { frame, seat, spot: sitAt() }); chair(K, x, z + d, S, { frame, seat, spot: sitAt() });
  chair(K, x - d, z, E, { frame, seat, spot: sitAt() }); chair(K, x + d, z, W, { frame, seat, spot: sitAt() });
}
// a paper lantern hung from the ceiling
function lantern(K, x, z, y, col, { r = 0.17, tall = 1.1, glow = 1 } = {}) {
  K.group(x, z, 0, () => {
    K.box(0, y + r * tall, 0, 0.01, HT - y - r * tall, 0.01, C.black, { faces: 'fbrl' });
    K.sph(0, y, 0, r, col, { ws: 8, hs: 6, sy: tall, glow });
    K.cyl(0, y + r * tall - 0.02, 0, r * 0.4, 0.04, C.black, { seg: 6 });
    K.cyl(0, y - r * tall - 0.02, 0, r * 0.4, 0.04, C.black, { seg: 6 });
  });
}
// a counter along the window to eat at, looking out
function windowBar(K, x0, x1, n) {
  K.group(0, 0, 0, () => { K.box((x0 + x1) / 2, 1.0, 0.32, x1 - x0, 0.05, 0.36, C.oak); for (const x of [x0 + 0.1, x1 - 0.1]) K.box(x, 0, 0.32, 0.05, 1.0, 0.3, C.char); }, { stretch: true });
  for (let i = 0; i < n; i++) stool(K, x0 + (x1 - x0) * (i + 0.5) / n, 0.78, 0.76, { ry: S, seat: C.woodL, spot: { pose: 'bar', h: 0.76, table: true } });
}
// a low glass case on a counter: `fill(x)` puts something in at each place along it
function topCase(K, x0, x1, y, z, fill, { h = 0.4, d = 0.5 } = {}) {
  K.group(0, 0, 0, () => {
    K.box((x0 + x1) / 2, y + h, z, x1 - x0, 0.02, d, 0xcfe0e0);
    for (const x of [x0, x1]) for (const dz of [-d / 2, d / 2]) K.box(x, y, z + dz, 0.02, h, 0.02, C.chrome, { faces: 'fbrl' });
    K.plane((x0 + x1) / 2, y + h - 0.01, z, x1 - x0 - 0.04, d - 0.04, 'D', 0xfff3dc, { glow: 0.8 });
  }, { stretch: true });
  for (let x = x0 + 0.18; x < x1 - 0.1; x += 0.3) K.group(x, z, 0, () => fill(0, y));
}
const queue = (K, x, h = 1.02) => { K.spot(x, 3.12, N, 'counter', { h, prio: 1 }); K.spot(x + 0.15, 2.4, N, 'stand', { prio: 3 }); };

// ---------------------------------------------------------------------------------------------------------------------
function pizza(K) {
  K.shell();
  // the oven: a brick arch in the back wall, its mouth glowing
  K.group(-1.3, D0 - 0.35, 0, () => {
    K.box(0, 0, 0, 2.0, 2.1, 0.7, 0x8a4a34);
    K.box(0, 2.1, 0, 2.1, 0.12, 0.76, 0x5a3024);
    K.box(0, 2.22, 0.1, 0.5, 0.98, 0.4, 0x5a5a5c);
    K.cyl(0, 1.05, -0.36, 0.52, 0.04, 0x1a0e0a, { seg: 14, rx: E, center: true, sy: 1 });
    K.cyl(0, 1.02, -0.385, 0.42, 0.02, 0xff8a2a, { seg: 12, rx: E, center: true, glow: 1.3 });
    K.cyl(0, 0.92, -0.39, 0.3, 0.02, 0xffd27a, { seg: 10, rx: E, center: true, glow: 1.4 });
    K.box(0, 0, -0.37, 1.2, 0.98, 0.04, 0x8a4a34);
    K.box(0, 0.95, -0.42, 1.3, 0.06, 0.2, 0x9a9488);
    for (let i = 0; i < 4; i++) K.cyl(-0.7 + i * 0.14, 0.02, -0.5 - (i % 2) * 0.1, 0.07, 0.5, 0x7a5a3c, { seg: 6, rx: E, center: true });
    K.spot(0.2, -1.0, N, 'work', { role: 'staff' });
  });
  K.group(-2.55, D0 - 0.2, 0, () => { K.rod(0, 0, 0, 0.1, 1.9, 0.12, 0.018, C.oak); K.box(0.11, 1.9, 0.12, 0.34, 0.4, 0.02, C.oak, { rz: -0.05 }); });
  // the counter: pies under glass, the till, boxes stacked behind
  serviceCounter(K, { x0: 0.2, x1: 3.2, z: 3.8, tills: [2.6] });
  topCase(K, 0.4, 2.1, 1.02, 4.05, (x, y) => {
    K.cyl(0, y + 0.02, 0, 0.13, 0.02, 0xd9a860, { seg: 10 });
    K.cyl(0, y + 0.04, 0, 0.11, 0.008, K.pick([0xc0392b, 0xd9862a, 0xe8d8a0]), { seg: 10 });
    for (let i = 0; i < 4; i++) K.cyl(Math.cos(i * 1.6) * 0.06, y + 0.048, Math.sin(i * 1.6) * 0.06, 0.02, 0.006, 0x8a1f1c, { seg: 5 });
  });
  K.group(2.0, D0 - 0.28, 0, () => {
    K.box(0, 0, 0, 2.4, 0.9, 0.5, 0x6e4c30); K.box(0, 0.9, 0, 2.46, 0.03, 0.54, C.oak);
    for (let s = 0; s < 3; s++) for (let k = 0; k < 4 + s * 2; k++) K.box(-0.7 + s * 0.6, 0.93 + k * 0.045, 0, 0.42, 0.04, 0.42, k % 3 ? 0xe8e0cc : 0xc9b48a, { ry: (k % 2) * 0.06 });
  });
  chalkboard(K, 1.9, 2.2, 2.45, 2);
  // red-check tables
  const cloth = 0xb0291f;
  for (const [x, z, az] of [[-0.3, 1.5, false], [2.4, 1.3, true], [0.9, 2.75, false], [2.75, 2.7, true]]) {
    twoTop(K, x, z, { cloth, alongZ: az, centre: null });
    K.group(x, z, 0, () => { K.plane(0, 0.765, 0, 0.5, 0.5, 'U', 0xf4f1ea, { ry: PI / 4 }); K.cyl(0.05, 0.77, 0.03, 0.035, 0.15, 0x2f5a2a, { seg: 6, r2: 0.02 }); });
  }
  for (const [x, z] of [[-0.3, 1.5], [2.4, 1.3], [0.9, 2.75]]) pendant(K, x, z, 2.1, { shade: 0x8a2a20, r: 0.2 });
  picture(K, -H0, 1.7, 2.6, 0.8, 0.6, 'E', { rnd: K.rand }); picture(K, -H0, 1.7, 3.8, 0.6, 0.8, 'E', { rnd: K.rand });
  K.spot(2.6, 3.2, N, 'counter', { h: 1.02, prio: 1 });
}

function mexican(K) {
  K.shell();
  serviceCounter(K, { x0: -1.6, x1: 3.2, tills: [-0.9, 1.4], top: 0xe8dcc0 });
  // the counter's front in bright tiles
  K.group(0, 0, 0, () => { for (let i = 0; i < 16; i++) for (let r = 0; r < 3; r++) K.plane(-1.45 + i * 0.3, 0.3 + r * 0.26, 3.694, 0.22, 0.22, 'S', [0xf1c40f, 0x1c7a6a, 0xc2491c, 0xf4f1ea, 0x2a5aa6][(i + r * 2) % 5]); }, { stretch: true });
  menuBoards(K, { x0: -0.9, n: 3, food: [0xd9862a, 0x4a8a3a, 0xb6382c, 0xc9a227], bar: 0x1c7a6a });
  kitchenLine(K);
  // the fillings in a row under glass
  topCase(K, -0.2, 0.9, 1.02, 3.98, (x, y) => K.box(0, y + 0.01, 0, 0.24, 0.07, 0.3, K.pick([0x4a8a3a, 0xb6382c, 0xe8d8a0, 0x7a4a2a, 0xf1c40f, 0xf4f1ea])), { h: 0.3 });
  // the salsa bar along the left wall
  K.group(-H0 + 0.3, 3.0, E, () => {
    K.box(0, 0, 0, 1.6, 0.9, 0.5, 0xffffff, { slot: SLOT.accent }); K.box(0, 0.9, 0, 1.66, 0.04, 0.56, 0xe8dcc0);
    [0xb0291f, 0x4a8a3a, 0xd9862a, 0x7a2a1a, 0xf1c40f].forEach((c, i) => { K.cyl(-0.56 + i * 0.28, 0.94, 0, 0.1, 0.06, 0x2a2a2c, { seg: 8 }); K.cyl(-0.56 + i * 0.28, 0.99, 0, 0.085, 0.015, c, { seg: 8 }); });
    K.shadow(0, 0, 1.9, 0.9);
  });
  // strings of cut-paper flags across the room
  for (const z of [1.3, 2.6]) K.group(0, 0, 0, () => {
    K.rod(-H0, 2.75, z, H0, 2.75, z, 0.006, 0x2a2a2c);
    for (let i = 0; i < 17; i++) K.box(-3.25 + i * 0.4, 2.48, z, 0.3, 0.26, 0.006, [0xe84393, 0xf1c40f, 0x16a085, 0xe67e22, 0x2980b9, 0x8e44ad][i % 6], { faces: 'fb' });
  }, { stretch: true });
  const seat = 'accent';
  twoTop(K, 2.6, 1.3, { top: 0xd9a05a, alongZ: true, frame: 0x6e4c30, seat }); twoTop(K, 0.6, 1.5, { top: 0xd9a05a, frame: 0x6e4c30, seat });
  fourTop(K, 1.9, 2.75, { top: 0xd9a05a, frame: 0x6e4c30, seat, centre: 'vase', w: 0.8 });
  plant(K, 3.1, 0.45, 1.3, { pot: 0xc2491c });
  for (const [x, z] of [[-1.4, 1.6], [1.6, 1.6], [0, 3.0]]) ceilingPanel(K, x, z, 1.1, 0.5);
  queue(K, -0.9);
}

function chinese(K) {
  K.shell({ skirting: 0x1a0e0c });
  // round tables, a turning tray in the middle of each
  for (const [x, z, n] of [[0.1, 1.9, 5], [2.2, 3.5, 5]]) {
    K.group(x, z, 0, () => {
      K.cyl(0, 0.71, 0, 0.68, 0.04, 0xefeae0, { seg: 16 }); K.cyl(0, 0.5, 0, 0.7, 0.21, 0xefeae0, { seg: 16, open: true, k: 0.86 });
      K.cyl(0, 0, 0, 0.08, 0.7, C.char, { seg: 6 });
      K.cyl(0, 0.76, 0, 0.3, 0.02, 0x3a1c14, { seg: 14 });
      [0xd9862a, 0x4a8a3a, 0xf4f1ea, 0xb0291f].forEach((c, i) => { K.cyl(Math.cos(i * 1.57) * 0.16, 0.78, Math.sin(i * 1.57) * 0.16, 0.085, 0.03, 0xf4f1ea, { seg: 8, r2: 0.1 }); K.cyl(Math.cos(i * 1.57) * 0.16, 0.805, Math.sin(i * 1.57) * 0.16, 0.075, 0.008, c, { seg: 8 }); });
      K.cyl(0, 0.78, 0, 0.05, 0.12, 0xf4f1ea, { seg: 6 });
      K.shadow(0, 0, 1.7, 1.7, 0.6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2 + 0.3;
        K.cyl(Math.sin(a) * 0.48, 0.752, Math.cos(a) * 0.48, 0.08, 0.03, 0xf4f1ea, { seg: 8, r2: 0.09 });
        chair(K, Math.sin(a) * 0.98, Math.cos(a) * 0.98, a + PI, { frame: 0x2a1410, seat: 'accent', spot: sitAt() });
      }
    });
    lantern(K, x, z, 2.2, 0xd9281c, { r: 0.2, tall: 0.85 });
  }
  for (const [x, z] of [[-1.6, 3.2], [2.6, 1.4], [-0.6, 4.4], [1.0, 3.0]]) lantern(K, x, z, 2.35, 0xd9281c, { r: 0.15, tall: 0.85 });
  // the desk at the back, bags waiting on it; a tank of fish; a round gold-framed panel
  serviceCounter(K, { x0: -2.9, x1: -1.0, z: 4.3, tills: [-1.6], front: 0x2a1410, slot: 0, top: 0x1a0e0c });
  for (let i = 0; i < 3; i++) K.box(-2.6 + i * 0.26, 1.02, 4.6, 0.2, 0.26, 0.14, 0xc9a06a);
  K.group(1.2, D0 - 0.3, 0, () => {
    K.box(0, 0, 0, 1.5, 0.8, 0.5, 0x2a1410);
    K.box(0, 0.8, 0, 1.5, 0.7, 0.45, 0x3a9ac4, { glow: 0.8 });
    K.box(0, 1.5, 0, 1.54, 0.08, 0.5, 0x2a1410);
    for (let i = 0; i < 6; i++) K.box(-0.55 + i * 0.22, 0.95 + (i % 3) * 0.17, -0.228, 0.08, 0.04, 0.004, i % 2 ? 0xff8a2a : 0xf4f1ea, { glow: 0.9 });
  });
  K.group(-0.3, D0, 0, () => { K.cyl(0, 2.0, -0.03, 0.62, 0.03, 0xc9a227, { seg: 20, rx: E, center: true }); K.cyl(0, 2.0, -0.05, 0.54, 0.03, 0x5a1414, { seg: 20, rx: E, center: true }); K.plane(0, 2.0, -0.07, 0.5, 0.06, 'S', 0xc9a227); K.plane(0, 2.0, -0.07, 0.06, 0.5, 'S', 0xc9a227); });
  K.group(0, 0, 0, () => K.box(0, 2.85, D0 - 0.03, 6.8, 0.1, 0.04, 0xc9a227), { stretch: true });
  for (const z of [2.4, 3.9]) picture(K, -H0, 1.7, z, 0.5, 1.1, 'E', { frame: 0xc9a227, art: [0xf2e6c8, 0x2a1410, 0xb0291f], rnd: K.rand });
  K.spot(-0.9, 3.3, S, 'stand', { role: 'staff', roam: 0.5 });
}

function japanese(K) {
  K.shell({ skirting: 0x6a5a48 });
  const wood = 0xc9a876, dark = 0x2a2a2c;
  // the sushi counter: pale wood, fish under glass, the chef behind
  counter(K, -1.2, 3.2, 3.5, 0.75, 1.02, { front: wood, top: 0xd9be92, kick: dark });
  topCase(K, -1.0, 3.0, 1.02, 3.95, (x, y) => { for (const dz of [-0.1, 0.08]) K.box(0, y + 0.01, dz, 0.2, 0.035, 0.07, K.pick([0xe8826a, 0xf4a08a, 0xf4f1ea, 0xc0392b, 0xe6a23a]), { ry: 0.3 }); }, { h: 0.26, d: 0.4 });
  for (let i = 0; i < 5; i++) {
    const x = -0.7 + i * 0.85;
    stool(K, x, 3.05, 0.76, { seat: wood, col: dark, spot: { pose: 'bar', h: 0.76, table: true, prio: i === 2 ? 1 : 3 } });
    K.box(x, 1.022, 3.62, 0.3, 0.012, 0.18, 0x1c1c1e); K.cyl(x + 0.24, 1.02, 3.62, 0.03, 0.06, 0xf4f1ea, { seg: 6 });
  }
  K.spot(0.2, 4.75, S, 'work', { role: 'staff' }); K.spot(2.0, 4.75, S, 'counter', { role: 'staff', h: 1.02, roam: 0.4 });
  // behind: shelves of bottles and bowls, a knife rack; the kitchen's doorway under a split curtain
  K.group(1.2, D0, S, () => shelves(K, 3.6, 1.2, 0.22, 3, { frame: wood, y0: 0.05, sides: false, fill: (k, x0, x1, y, d, lvl) => {
    if (lvl === 1) bottleRow(k, x0 + 0.05, x1 - 0.05, y, d - 0.1, { step: 0.16, h: 0.3, palette: [0xf4f1ea, 0x2f5a4a, 0x1c2c4a, 0xc9b48a] });
    else for (let x = x0 + 0.12; x < x1; x += 0.24) k.cyl(x, y, d - 0.1, 0.07, 0.07, k.pick([0x1c1c1e, 0xf4f1ea, 0x2a3a5a]), { seg: 8, r2: 0.09 });
  } }), { y: 1.2, stretch: true });
  K.group(0, 0, 0, () => { K.box(1.2, 0, D0 - 0.25, 4.0, 0.9, 0.5, wood); K.box(1.2, 0.9, D0 - 0.25, 4.06, 0.03, 0.54, 0xd9be92); }, { stretch: true });
  K.group(-2.4, D0, 0, () => {
    K.plane(0, 1.05, -0.012, 1.0, 2.1, 'S', 0x1a1410);
    K.rod(-0.6, 2.12, -0.06, 0.6, 2.12, -0.06, 0.015, dark);
    for (let i = 0; i < 3; i++) { K.box(-0.36 + i * 0.36, 1.45, -0.06, 0.34, 0.66, 0.01, 0xffffff, { slot: SLOT.accent, faces: 'fb' }); K.cyl(-0.36 + i * 0.36, 1.8, -0.07, 0.08, 0.005, 0xf4f1ea, { seg: 10, rx: E, center: true }); }
  });
  // two tables by the window, paper lanterns, a branch in a vase
  twoTop(K, 0.4, 1.35, { top: wood, frame: dark }); twoTop(K, 2.5, 1.35, { top: wood, frame: dark });
  for (const x of [-0.6, 1.0, 2.6]) lantern(K, x, 3.5, 2.2, 0xfff0d0, { r: 0.16, tall: 1.5 });
  lantern(K, 0.4, 1.35, 2.2, 0xfff0d0, { r: 0.2, tall: 0.9 }); lantern(K, 2.5, 1.35, 2.2, 0xfff0d0, { r: 0.2, tall: 0.9 });
  K.group(-H0 + 0.3, 3.6, 0, () => { K.box(0, 0, 0, 0.4, 0.7, 0.9, wood); K.cyl(0, 0.7, 0, 0.08, 0.3, dark, { seg: 8, r2: 0.05 }); K.rod(0, 1.0, 0, 0.12, 1.7, 0.2, 0.012, 0x4a3323); K.rod(0.06, 1.35, 0.1, -0.08, 1.75, -0.12, 0.01, 0x4a3323); for (const [x, y, z] of [[0.12, 1.7, 0.2], [-0.08, 1.75, -0.12], [0.03, 1.5, 0.06]]) K.sph(x, y, z, 0.06, 0xf4b8c4, { ws: 5, hs: 3 }); });
  for (let i = 0; i < 4; i++) K.group(-H0 + 0.012, 2.3 + i * 0.5, 0, () => K.plane(0, 1.7, 0, 0.16, 0.7, 'E', 0xf2ebdc));
}

function korean(K) {
  K.shell({ skirting: 0x1c1c1e });
  // tables with a grill set into each, a hood down over it
  for (const [x, z] of [[-0.2, 1.7], [2.4, 1.6], [1.0, 3.3], [-1.6, 3.6]]) {
    K.group(x, z, 0, () => {
      K.box(0, 0.7, 0, 1.2, 0.05, 0.8, 0x3a2e26); K.box(0, 0, 0, 0.5, 0.7, 0.4, 0x2a2624);
      K.cyl(0, 0.752, 0, 0.19, 0.012, 0x1a1a1c, { seg: 12 }); K.cyl(0, 0.762, 0, 0.14, 0.006, 0xff7a2a, { seg: 10, glow: 1 });
      for (const [dx, dz, c] of [[-0.42, 0.2, 0xb0291f], [-0.42, -0.2, 0x4a8a3a], [0.42, 0.2, 0xf4f1ea], [0.42, -0.2, 0xd9862a], [-0.3, 0, 0xe8d8a0], [0.3, 0, 0x7a4a2a]]) { K.cyl(dx, 0.752, dz, 0.055, 0.03, 0xf4f1ea, { seg: 6, r2: 0.065 }); K.cyl(dx, 0.78, dz, 0.05, 0.006, c, { seg: 6 }); }
      K.cyl(0, 1.75, 0, 0.26, 0.2, 0x9aa0a4, { seg: 10, r2: 0.09 }); K.cyl(0, 1.95, 0, 0.08, HT - 1.95, 0x9aa0a4, { seg: 8, open: true });
      K.shadow(0, 0, 1.6, 1.3, 0.6);
    });
    chair(K, x - 0.32, z - 0.62, N, { frame: 0x2a2624, spot: sitAt() }); chair(K, x + 0.32, z - 0.62, N, { frame: 0x2a2624, spot: sitAt() });
    chair(K, x - 0.32, z + 0.62, S, { frame: 0x2a2624, spot: sitAt() }); chair(K, x + 0.32, z + 0.62, S, { frame: 0x2a2624 });
  }
  // the back: a counter, a fridge of green bottles, the menu in strips on the wall
  serviceCounter(K, { x0: 0.8, x1: 3.2, z: 4.5, tills: [1.6], front: 0x2a2624, slot: 0, top: 0x3a2e26 });
  K.group(-2.6, D0 - 0.33, 0, () => {
    K.box(0, 0, 0, 1.3, 2.0, 0.62, 0x2a2a2c); K.plane(0, 1.05, -0.315, 1.14, 1.7, 'S', 0xe6f6ea, { glow: 2 });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) K.plane(-0.48 + i * 0.12, 0.4 + r * 0.42, -0.32, 0.07, 0.28, 'S', i % 4 === 3 ? 0xd9c27a : 0x2f7a3a, { glow: 2 });
  });
  for (let i = 0; i < 6; i++) K.group(-1.2 + i * 0.36, D0 - 0.012, 0, () => { K.plane(0, 2.0, 0, 0.26, 0.9, 'S', 0xf2ebdc); for (let r = 0; r < 5; r++) K.plane(0, 2.34 - r * 0.15, -0.006, 0.05, 0.1, 'S', 0x2a2a2c); });
  for (const z of [2.0, 3.4]) picture(K, H0, 1.7, z, 0.9, 0.6, 'W', { frame: 0x1c1c1e, rnd: K.rand });
  for (const [x, z] of [[-1.5, 2.0], [1.5, 2.4], [0, 4.2]]) ceilingPanel(K, x, z, 0.9, 0.4, 0xffe6c0);
  K.spot(-0.6, 2.9, E, 'stand', { role: 'staff', roam: 0.5 });
}

function noodles(K) {
  K.shell({ skirting: 0x1c1410 });
  // a counter to eat at, facing the open kitchen: pots on the range, cooks at work
  counter(K, -1.6, 3.2, 3.3, 0.55, 1.02, { front: 0x5a4028, top: 0x8a6a44, kick: 0x1c1410 });
  for (let i = 0; i < 6; i++) {
    const x = -1.2 + i * 0.8;
    stool(K, x, 2.9, 0.76, { seat: 0x8a6a44, spot: { pose: 'bar', h: 0.76, table: true, prio: (i * 3) % 6 } });
    K.cyl(x, 1.022, 3.45, 0.11, 0.07, i % 2 ? 0x1c1c1e : 0xf4f1ea, { seg: 10, r2: 0.13 }); K.cyl(x, 1.085, 3.45, 0.115, 0.006, 0xd9a860, { seg: 10 });
  }
  K.group(0, 0, 0, () => {
    K.box(0.8, 0, D0 - 0.35, 5.0, 0.88, 0.7, 0x8a9094); K.box(0.8, 0.88, D0 - 0.35, 5.1, 0.03, 0.74, 0xc8ccd0);
    K.box(0.8, 2.0, D0 - 0.4, 4.6, 0.4, 0.8, 0x8a9094); K.plane(0.8, 1.98, D0 - 0.4, 4.2, 0.5, 'D', 0xffc880, { glow: 0.8 });
    K.plane(0.8, 1.45, D0 - 0.012, 5.0, 1.0, 'S', 0xcfd4d4);
  }, { stretch: true });
  for (const [x, r, h] of [[-0.9, 0.24, 0.42], [-0.2, 0.2, 0.34], [1.2, 0.26, 0.46], [2.0, 0.18, 0.2], [2.7, 0.22, 0.38]]) { K.cyl(x, 0.91, D0 - 0.38, r, h, 0xb4b8bc, { seg: 12 }); K.cyl(x, 0.91 + h, D0 - 0.38, r * 0.92, 0.006, 0xe6c88a, { seg: 12 }); }
  K.spot(-0.5, 4.5, S, 'work', { role: 'staff' }); K.spot(1.6, 4.5, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
  // lanterns over the counter, the menu in strips of paper, little tables by the window
  for (let i = 0; i < 5; i++) lantern(K, -1.0 + i * 0.95, 3.2, 2.25, i % 2 ? 0xff8a3a : 0xd9281c, { r: 0.14, tall: 1.4 });
  for (let i = 0; i < 7; i++) K.group(-H0 + 0.012, 2.1 + i * 0.3, 0, () => { K.plane(0, 1.9, 0, 0.2, 0.7, 'E', i % 3 ? 0xf2ebdc : 0xe8c84a); for (let r = 0; r < 4; r++) K.plane(0.006, 2.14 - r * 0.15, 0, 0.1, 0.05, 'E', 0x2a2a2c); });
  twoTop(K, 0.3, 1.2, { top: 0x8a6a44, frame: 0x1c1410 }); twoTop(K, 2.5, 1.2, { top: 0x8a6a44, frame: 0x1c1410 });
  K.group(H0 - 0.25, 2.3, 0, () => { K.box(0, 0, 0, 0.4, 0.8, 0.7, 0x5a4028); for (let i = 0; i < 4; i++) bottle(K, 0, 0.8, -0.24 + i * 0.16, 0.24, [0x2a1a14, 0xb0291f, 0x2a1a14, 0xd9862a][i]); });
  pendant(K, 0.3, 1.2, 2.15, { shade: 0x1c1410 }); pendant(K, 2.5, 1.2, 2.15, { shade: 0x1c1410 });
}

function indian(K) {
  K.shell({ skirting: 0x2a1410 });
  const cloth = 0xe0a030, brass = C.brass;
  fourTop(K, -0.3, 1.9, { cloth, seat: 'accent', centre: 'vase' }); fourTop(K, 1.9, 3.5, { cloth, seat: 'accent' });
  twoTop(K, 2.5, 1.4, { cloth, alongZ: true, seat: 'accent', centre: 'candle' });
  // pierced brass lamps
  for (const [x, z] of [[-0.3, 1.9], [1.9, 3.5], [2.5, 1.4], [-1.6, 3.6]]) K.group(x, z, 0, () => {
    K.box(0, 2.4, 0, 0.01, HT - 2.4, 0.01, C.black, { faces: 'fbrl' });
    K.sph(0, 2.2, 0, 0.2, brass, { ws: 8, hs: 6, sy: 1.1 }); K.sph(0, 2.2, 0, 0.15, 0xffc86a, { ws: 8, hs: 6, sy: 1.1, glow: 1 });
    for (let i = 0; i < 6; i++) K.sph(Math.cos(i * 1.05) * 0.2, 2.2, Math.sin(i * 1.05) * 0.2, 0.035, 0xffd98a, { ws: 4, hs: 3, glow: 1 });
    K.cyl(0, 1.95, 0, 0.03, 0.08, brass, { seg: 6, r2: 0.01 });
  });
  // arches along the back wall, a brass plate in each; a carved screen by the door
  for (let i = 0; i < 4; i++) K.group(-2.4 + i * 1.6, D0, 0, () => {
    K.plane(0, 1.2, -0.012, 1.1, 1.7, 'S', 0x6a1f1c); K.cyl(0, 2.05, -0.012, 0.55, 0.004, 0x6a1f1c, { seg: 14, rx: E, center: true });
    K.plane(0, 1.2, -0.02, 0.96, 1.6, 'S', 0xd9a03a, { k: 0.75 }); K.cyl(0, 2.0, -0.02, 0.48, 0.004, 0xd9a03a, { seg: 14, rx: E, center: true, k: 0.75 });
    K.cyl(0, 1.6, -0.035, 0.24, 0.01, brass, { seg: 14, rx: E, center: true }); K.cyl(0, 1.6, -0.045, 0.12, 0.01, 0xd9c27a, { seg: 10, rx: E, center: true });
  });
  K.group(-1.6, 1.9, E, () => {
    K.box(0, 0, 0, 1.5, 0.08, 0.1, 0x2a1410); K.box(0, 1.9, 0, 1.5, 0.08, 0.1, 0x2a1410); for (const sx of [-0.72, 0.72]) K.box(sx, 0, 0, 0.07, 1.95, 0.09, 0x2a1410);
    for (let i = 0; i < 8; i++) { K.rod(-0.7 + i * 0.2, 0.08, 0, -0.7 + i * 0.2 + 0.36, 1.9, 0, 0.012, 0x4a2a1c); K.rod(-0.7 + i * 0.2 + 0.36, 0.08, 0, -0.7 + i * 0.2, 1.9, 0, 0.012, 0x4a2a1c); }
    K.shadow(0, 0, 1.7, 0.4);
  });
  // warm dishes under domes on a side table
  K.group(-H0 + 0.35, 3.9, E, () => {
    K.box(0, 0, 0, 2.2, 0.85, 0.55, 0x2a1410); K.box(0, 0.85, 0, 2.3, 0.03, 0.6, 0xe0a030);
    for (let i = 0; i < 4; i++) { K.box(-0.8 + i * 0.53, 0.88, 0, 0.42, 0.1, 0.34, 0xc8ccd0); K.sph(-0.8 + i * 0.53, 0.98, 0, 0.2, 0xd9dcde, { ws: 8, hs: 4, half: true, sy: 0.7, sz: 0.8 }); K.sph(-0.8 + i * 0.53, 1.13, 0, 0.025, brass, { ws: 4, hs: 3 }); }
    K.shadow(0, 0, 2.5, 0.9);
  });
  serviceCounter(K, { x0: 2.0, x1: 3.2, z: 4.6, tills: [2.6], front: 0x2a1410, slot: 0, top: 0x4a2a1c });
  picture(K, H0, 1.7, 2.6, 0.7, 1.0, 'W', { frame: brass, art: [0x1f6a5a, 0xd9a227, 0x7a1f3a], rnd: K.rand });
  K.spot(0.6, 4.4, S, 'stand', { role: 'staff', roam: 0.5 });
}

function mediterranean(K) {
  K.shell({ skirting: 0x4a5a6a });
  serviceCounter(K, { x0: -1.8, x1: 3.2, tills: [2.4], top: 0xf2f4f2, front: 0xf2f4f2, slot: 0 });
  // blue and white tiles down the counter's front
  K.group(0, 0, 0, () => { for (let i = 0; i < 17; i++) for (let r = 0; r < 3; r++) if ((i + r) % 2) K.plane(-1.66 + i * 0.3, 0.3 + r * 0.26, 3.694, 0.26, 0.26, 'S', 0xffffff, { slot: SLOT.accent }); }, { stretch: true });
  topCase(K, -1.5, 1.2, 1.02, 3.98, (x, y) => K.box(0, y + 0.01, 0, 0.24, 0.07, 0.3, K.pick([0x4a8a3a, 0xb6382c, 0xe8d8a0, 0xf4f1ea, 0x8e44ad, 0xd9862a, 0x7ab02a])), { h: 0.3 });
  kitchenLine(K, { hood: false });
  // the spits turning before their heat
  for (const x of [-0.6, 0.5]) K.group(x, D0 - 0.3, 0, () => {
    K.box(0.02, 0.93, 0.12, 0.55, 0.95, 0.12, 0x8a9094); K.plane(0.02, 1.4, 0.055, 0.42, 0.8, 'S', 0xff6a2a, { glow: 1 });
    K.cyl(0, 0.93, -0.08, 0.16, 0.03, 0xc8ccd0, { seg: 10 }); K.cyl(0, 0.93, -0.08, 0.012, 1.0, 0xc8ccd0, { seg: 5 });
    K.cyl(0, 1.02, -0.08, 0.1, 0.72, x < 0 ? 0x8a4a2a : 0xb8793a, { seg: 10, r2: 0.16 });
  });
  K.group(1.9, D0 - 0.3, 0, () => { for (let i = 0; i < 4; i++) K.cyl(-0.3 + i * 0.2, 0.93 + i * 0.012, 0, 0.11, 0.012, 0xe8d8a0, { seg: 10 }); bottleRow(K, 0.5, 1.0, 0.93, 0, { step: 0.14, h: 0.3, palette: [0x6a7a2a, 0x8a7a2a] }); });
  menuBoards(K, { x0: -0.9, n: 3, food: [0xb8793a, 0x4a8a3a, 0xe8d8a0, 0xb6382c], bar: 0x1f4f8a });
  // white tables, blue chairs, an olive tree in a pot, lamps of blue glass
  for (const [x, z, az] of [[-0.2, 1.5, false], [2.5, 1.3, true], [1.2, 2.7, false]]) { twoTop(K, x, z, { top: 0xf2f4f2, alongZ: az, frame: 0xf2f4f2, seat: 'accent', centre: 'vase' }); pendant(K, x, z, 2.1, { shade: 0x1f4f8a, r: 0.16, cone: false }); }
  plant(K, 3.05, 2.6, 1.7, { pot: 0xf2f4f2 });
  picture(K, -H0, 1.75, 3.0, 1.2, 0.8, 'E', { frame: 0xf2f4f2, art: [0x9ac4e0, 0x1f4f8a, 0xf2f4f2], rnd: K.rand });
  K.spot(-0.1, 4.6, S, 'work', { role: 'staff' });
  queue(K, 2.4);
}

function italian(K) {
  K.shell();
  const cloth = 0xf4f1ea;
  fourTop(K, -0.3, 1.9, { cloth, seat: 'accent' }); fourTop(K, 0.2, 4.0, { cloth, seat: 'accent', centre: 'vase' });
  for (const z of [1.5, 3.0]) { twoTop(K, 2.6, z, { cloth, alongZ: false, seat: 'accent', centre: 'candle' }); pendant(K, 2.6, z, 2.05, { shade: 0x2f3b2a, r: 0.18 }); }
  pendant(K, -0.3, 1.9, 2.05, { shade: 0x2f3b2a, r: 0.2 }); pendant(K, 0.2, 4.0, 2.05, { shade: 0x2f3b2a, r: 0.2 });
  // racks of wine across the back wall, an arch through to the kitchen between them
  for (const x of [-2.3, 2.3]) K.group(x, D0, S, () => shelves(K, 2.2, 2.4, 0.3, 6, { frame: 0x3d2a1c, back: 0x1a120e, fill: (k, x0, x1, y, d) => {
    for (let bx = x0 + 0.06; bx < x1; bx += 0.105) if (k.rand() > 0.12) { k.cyl(bx, y + 0.045, d - 0.16, 0.04, 0.28, k.pick([0x1f3a1c, 0x2a1414, 0x1c2414, 0x3a2a14]), { seg: 6, rx: E, center: true }); k.cyl(bx, y + 0.045, d - 0.012, 0.018, 0.02, k.pick([0x8a1f24, 0xc9a227, 0x1c1c1e]), { seg: 5, rx: E, center: true }); }
  } }));
  K.group(0, D0, 0, () => {
    K.plane(0, 1.05, -0.012, 1.5, 2.1, 'S', 0xffd9a0, { glow: 0.6 }); K.cyl(0, 2.1, -0.012, 0.75, 0.004, 0xffd9a0, { seg: 16, rx: E, center: true, glow: 0.6 });
    K.plane(0, 0.5, -0.02, 1.5, 1.0, 'S', 0x8a9094, { glow: 0.3 });
    for (const sx of [-0.8, 0.8]) K.box(sx, 0, -0.06, 0.14, 2.15, 0.12, 0x9a8a72);
  });
  // a sideboard: bread, oil, a big wheel of cheese; pictures; the host
  K.group(-H0 + 0.3, 3.4, E, () => {
    K.box(0, 0, 0, 1.7, 0.9, 0.5, 0x3d2a1c); K.box(0, 0.9, 0, 1.76, 0.04, 0.56, 0x6e4c30);
    K.cyl(-0.5, 0.94, 0, 0.2, 0.14, 0xe0b85a, { seg: 12 }); bottleRow(K, 0.0, 0.6, 0.94, 0, { step: 0.13, h: 0.32, palette: [0x6a7a2a, 0x2a1414, 0x1f3a1c] });
    K.shadow(0, 0, 2.0, 0.9);
  });
  for (const z of [2.2, 4.6]) picture(K, -H0, 1.8, z, 0.6, 0.8, 'E', { rnd: K.rand });
  picture(K, H0, 1.8, 2.25, 1.2, 0.8, 'W', { rnd: K.rand }); picture(K, H0, 1.8, 4.3, 0.7, 0.9, 'W', { rnd: K.rand });
  K.group(-1.5, 1.2, 0, () => { K.box(0, 0, 0, 0.5, 1.05, 0.38, 0x3d2a1c); K.box(0, 1.05, 0.02, 0.56, 0.04, 0.44, 0x6e4c30, { rx: 0.25 }); K.shadow(0, 0, 0.8, 0.7); K.spot(0, 0.55, S, 'counter', { role: 'staff', h: 1.02 }); });
  K.spot(1.4, 4.6, S, 'stand', { role: 'staff', roam: 0.5 });
}

function diner(K) {
  K.shell({ skirting: 0x3a3a3a });
  // the long counter: chrome-edged, stools along it, a pie under a dome, coffee on
  counter(K, -2.0, 3.2, 3.5, 0.6, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xe8e4da, kick: 0x8a9094 });
  K.group(0, 0, 0, () => { K.box(0.6, 0.94, 3.49, 5.2, 0.05, 0.02, C.chrome); K.box(0.6, 0.3, 3.49, 5.2, 0.03, 0.02, C.chrome); }, { stretch: true });
  for (let i = 0; i < 7; i++) {
    const x = -1.6 + i * 0.75;
    K.group(x, 3.08, 0, () => {
      K.cyl(0, 0.7, 0, 0.18, 0.08, 0xffffff, { seg: 12, slot: SLOT.accent }); K.cyl(0, 0.68, 0, 0.185, 0.025, C.chrome, { seg: 12 });
      K.cyl(0, 0, 0, 0.04, 0.68, C.chrome, { seg: 6 }); K.cyl(0, 0, 0, 0.17, 0.03, C.chrome, { seg: 10 });
      K.shadow(0, 0, 0.5, 0.5, 0.7);
      K.spot(0, 0, 0, 'bar', { h: 0.78, table: true, prio: (i * 3) % 7 });
    });
    if (i % 2) { K.cyl(x, 1.022, 3.7, 0.11, 0.012, 0xf4f1ea, { seg: 10 }); K.cyl(x + 0.2, 1.022, 3.66, 0.04, 0.08, 0xf4f1ea, { seg: 6 }); }
  }
  K.group(-1.2, 3.85, 0, () => { K.cyl(0, 1.02, 0, 0.2, 0.03, C.chrome, { seg: 12 }); K.cyl(0, 1.05, 0, 0.16, 0.05, 0xc8914e, { seg: 12 }); K.sph(0, 1.05, 0, 0.2, 0xd6e6e8, { ws: 10, hs: 4, half: true, sy: 0.8 }); });
  till(K, 2.7, 1.02, 3.8);
  // behind it: the pass to the kitchen, the coffee, the shake mixer; a clock in neon
  K.group(0, 0, 0, () => {
    K.box(0.6, 0, D0 - 0.3, 5.4, 0.9, 0.6, 0xa9aeb2); K.box(0.6, 0.9, D0 - 0.3, 5.5, 0.03, 0.64, 0xc8ccd0);
    K.plane(0.6, 1.5, D0 - 0.012, 3.0, 0.7, 'S', 0xffd9a0, { glow: 0.7 }); K.box(0.6, 1.12, D0 - 0.06, 3.1, 0.05, 0.2, C.chrome);
  }, { stretch: true });
  for (let i = 0; i < 6; i++) K.plane(-0.2 + i * 0.3, 1.78, D0 - 0.02, 0.1, 0.16, 'S', i % 2 ? 0xf2efe6 : 0xbcd8f0);
  K.group(-1.6, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.5, 0.45, 0.35, 0x2a2a2c); for (const x of [-0.12, 0.12]) K.cyl(x, 0.96, -0.24, 0.08, 0.16, 0x4a2c1a, { seg: 8, r2: 0.09 }); });
  K.group(2.6, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.2, 0.5, 0.2, 0x7ac4b8); K.cyl(0, 0.96, -0.16, 0.05, 0.2, C.chrome, { seg: 6, r2: 0.06 }); });
  K.group(-2.6, D0 - 0.04, 0, () => { for (let i = 0; i < 12; i++) { const a0 = i / 12 * PI * 2, a1 = (i + 1) / 12 * PI * 2; K.rod(Math.cos(a0) * 0.3, 2.3 + Math.sin(a0) * 0.3, 0, Math.cos(a1) * 0.3, 2.3 + Math.sin(a1) * 0.3, 0, 0.02, 0xffffff, { slot: SLOT.accent, glow: 1.4, seg: 5 }); } K.cyl(0, 2.3, 0.01, 0.27, 0.01, 0xf4f1ea, { seg: 14, rx: E, center: true }); K.rod(0, 2.3, -0.01, 0.1, 2.44, -0.01, 0.01, C.black); K.rod(0, 2.3, -0.01, -0.14, 2.3, -0.01, 0.01, C.black); });
  // booths by the window
  booth(K, 2.85, 1.55); booth(K, 0.85, 1.55);
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [0, 2.9]]) ceilingPanel(K, x, z, 1.1, 0.5);
  for (const x of [-0.8, 0.8, 2.4]) pendant(K, x, 3.5, 2.15, { shade: C.chrome, r: 0.15 });
  K.spot(-0.4, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.8 }); K.spot(2.3, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
}

function burger(K) {
  K.shell({ skirting: 0x4a4a48 });
  serviceCounter(K, { tills: [-0.7, 1.3] });
  menuBoards(K, { food: [0x9a5a2a, 0xc9a227, 0xb6382c, 0x4a8a3a] });
  kitchenLine(K);
  for (let i = 0; i < 9; i++) K.box(-1.4 + i * 0.42, 0.93, D0 - 0.36 + (i % 2) * 0.12, 0.2, 0.09, 0.2, i % 3 ? 0xe8c84a : 0xf2efe6);
  // a soda fountain, and a burger big on the wall
  K.group(2.75, 4.0, 0, () => { K.box(0, 1.02, 0, 0.7, 0.6, 0.5, 0x2a2c30); for (let i = 0; i < 5; i++) { K.plane(-0.26 + i * 0.13, 1.47, -0.256, 0.1, 0.16, 'S', BRIGHTS[(i * 3) % BRIGHTS.length], { glow: 0.8 }); K.box(-0.26 + i * 0.13, 1.24, -0.29, 0.03, 0.08, 0.06, C.chrome); } });
  K.group(-H0 + 0.012, 3.6, 0, () => {
    [[1.95, 0.24, 0xc8914e, 0.62], [1.75, 0.07, 0x4a8a3a, 0.72], [1.66, 0.07, 0xc0392b, 0.66], [1.57, 0.06, 0xf1c40f, 0.72], [1.44, 0.14, 0x5a3220, 0.68], [1.26, 0.16, 0xc8914e, 0.64]].forEach(([y, h, c, w], i) => K.plane(i * 0.002, y, 0, w * 2, h, 'E', c));
  });
  booth(K, 2.85, 1.75); booth(K, 0.85, 1.75);
  K.group(-H0 + 0.3, 2.3, E, () => { K.box(0, 0, 0, 0.6, 1.1, 0.5, 0x6a5a48); K.box(0, 1.1, 0, 0.5, 0.03, 0.4, 0x7a4a2a); K.shadow(0, 0.1, 0.8, 0.8); });
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
  queue(K, -0.7); K.spot(1.3, 3.1, N, 'stand', { prio: 2 });
}

function sandwich(K) {
  K.shell();
  // the long deli case: meats and cheeses, salads; a slicer and the bread behind
  K.group(0, 0, 0, () => {
    K.box(0.6, 0, 3.95, 5.0, 0.55, 0.72, 0xffffff, { slot: SLOT.accent }); K.box(0.6, 0.55, 3.95, 5.04, 0.03, 0.76, 0xe6e2d8);
    K.box(0.6, 1.25, 3.97, 5.04, 0.03, 0.72, 0xe6e2d8); K.plane(0.6, 0.95, 4.3, 5.0, 0.7, 'S', 0xf2efe6);
    for (const x of [-1.88, -0.2, 1.4, 3.08]) K.box(x, 0.58, 3.61, 0.025, 0.67, 0.025, C.chrome, { faces: 'fbrl' });
    K.plane(0.6, 1.22, 3.95, 4.8, 0.5, 'D', 0xfff3dc, { glow: 0.9 });
  }, { stretch: true });
  const deli = [0xe8a0a0, 0xf1d27a, 0xb85a4a, 0xf4f1ea, 0xd9862a, 0x7ab02a, 0xe8c8a0, 0x8a3a2a];
  for (let i = 0; i < 12; i++) K.group(-1.6 + i * 0.4, 3.95, 0, () => {
    K.box(0, 0.58, 0, 0.34, 0.012, 0.5, 0x8a8f94);
    if (i % 3 === 2) K.box(0, 0.6, 0, 0.28, 0.08, 0.4, deli[(i * 3) % 8]);
    else for (const dz of [-0.14, 0.08]) K.cyl(0, 0.68, dz, 0.075, 0.2, deli[(i + (dz > 0 ? 3 : 0)) % 8], { seg: 8, rx: E, center: true });
  });
  till(K, 2.7, 1.28, 3.98);
  K.group(0, 0, 0, () => { K.box(0.6, 0, D0 - 0.3, 5.2, 0.9, 0.6, 0xd9d2c4); K.box(0.6, 0.9, D0 - 0.3, 5.26, 0.03, 0.64, C.oak); }, { stretch: true });
  K.group(-1.2, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.45, 0.2, 0.4, 0xb4b8bc); K.cyl(0.05, 1.22, -0.05, 0.17, 0.02, 0xdfe2e4, { seg: 14, rz: E, center: true }); K.box(-0.1, 1.13, 0, 0.2, 0.2, 0.3, 0xb4b8bc); });
  K.group(0.3, D0 - 0.3, 0, () => { for (let i = 0; i < 5; i++) K.sph(i * 0.26, 1.0, 0, 0.08, i % 2 ? 0xb8793a : 0xd9a860, { ws: 7, hs: 4, sx: 1.5, sy: 0.85 }); });
  chalkboard(K, 0.8, 3.4, 2.3, 4);
  K.spot(-0.3, 4.75, S, 'work', { role: 'staff' }); K.spot(2.4, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
  // crisps on a rack, drinks in a cooler, stools at the window, a couple of tables
  K.group(-H0, 2.5, E, () => shelves(K, 1.0, 1.6, 0.26, 4, { frame: C.char, y0: 0.3, fill: (k, x0, x1, y, d) => { for (let x = x0 + 0.08; x < x1; x += 0.17) k.box(x, y, d - 0.08, 0.15, 0.22, 0.06, k.pick(BRIGHTS), { rx: -0.12 }); } }));
  K.group(-H0 + 0.33, 3.7, E, () => { K.box(0, 0, 0, 0.9, 1.95, 0.62, 0x2a2a2c); K.plane(0, 1.0, 0.315, 0.76, 1.7, 'N', 0xe6f2fa, { glow: 2 }); for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) K.plane(-0.3 + i * 0.12, 0.4 + r * 0.42, 0.32, 0.08, 0.26, 'N', BRIGHTS[(i + r * 5) % 12], { glow: 2 }); });
  windowBar(K, 0.3, 3.2, 4);
  twoTop(K, 0.2, 2.2, { top: C.oak }); twoTop(K, 2.4, 2.3, { top: C.oak });
  for (const x of [-0.9, 0.6, 2.1]) pendant(K, x, 3.7, 2.15, { shade: 0x2a2a2c, r: 0.17 });
  ceilingPanel(K, 0.8, 1.6, 1.2, 0.5);
  K.spot(0.9, 3.1, N, 'lean', { prio: 1 }); K.spot(2.6, 3.1, N, 'counter', { h: 1.2, prio: 2 });
}

function chicken(K) {
  K.shell({ skirting: 0x4a4a48 });
  serviceCounter(K, { tills: [-0.7, 1.3] });
  menuBoards(K, { food: [0xd9a03a, 0xc8914e, 0xb6382c, 0xe8d8a0], bar: 0xd98a12 });
  kitchenLine(K);
  // the warmer: pieces golden under its lamps, tubs stacked beside
  K.group(2.5, 4.0, 0, () => {
    K.box(0, 1.02, 0, 1.0, 0.1, 0.5, 0x8a9094); K.box(0, 1.62, 0, 1.0, 0.08, 0.5, 0x8a9094); for (const sx of [-0.48, 0.48]) K.box(sx, 1.12, 0, 0.03, 0.5, 0.5, 0x8a9094);
    K.plane(0, 1.61, 0, 0.9, 0.44, 'D', 0xffb050, { glow: 1 });
    for (let i = 0; i < 12; i++) K.sph(-0.36 + (i % 6) * 0.145, 1.17 + Math.floor(i / 6) * 0.07, -0.08 + (i % 2) * 0.16, 0.065, i % 3 ? 0xc8862a : 0xb06a1c, { ws: 5, hs: 3, sy: 0.8, glow: 0.35 });
  });
  for (let i = 0; i < 5; i++) K.group(-1.8 + (i % 3) * 0.26, 4.0, 0, () => { const y = 1.02 + Math.floor(i / 3) * 0.2; K.cyl(0, y, 0, 0.09, 0.2, 0xf4f1ea, { seg: 8, r2: 0.12 }); K.cyl(0, y + 0.07, 0, 0.105, 0.06, 0xffffff, { seg: 8, r2: 0.113, open: true, slot: SLOT.accent }); });
  booth(K, 2.85, 1.75); twoTop(K, 0.9, 1.4, { top: 0xe6dfcf, frame: C.char, seat: 'accent' }); twoTop(K, 0.5, 2.7, { top: 0xe6dfcf, frame: C.char, seat: 'accent' });
  K.group(0, 0, 0, () => K.plane(-H0 + 0.012, 1.75, 4.0, 2.6, 0.5, 'E', 0xffffff, { slot: SLOT.accent }), { stretch: true });
  K.group(-H0 + 0.3, 2.3, E, () => { K.box(0, 0, 0, 0.6, 1.1, 0.5, 0x6a5a48); K.box(0, 1.1, 0, 0.5, 0.03, 0.4, 0x7a4a2a); K.shadow(0, 0.1, 0.8, 0.8); });
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
  queue(K, -0.7); K.spot(1.3, 3.1, N, 'stand', { prio: 2 });
}

function steakhouse(K) {
  K.shell({ skirting: 0x120a08 });
  const cloth = 0xefeae0, leather = { slot: SLOT.accent, col: 0xffffff };
  // deep booths down the right wall, tables under cloths in the room
  for (const z of [1.5, 3.1, 4.7]) K.group(2.75, z, 0, () => {
    K.box(0, 0.71, 0, 1.2, 0.04, 0.7, cloth); K.box(0, 0.5, 0, 1.2, 0.21, 0.7, cloth, { faces: 'fbrl', k: 0.86 }); K.cyl(0, 0, 0, 0.06, 0.7, C.char, { seg: 6 });
    K.cyl(0, 0.75, 0, 0.03, 0.07, 0x8a2a22, { seg: 6 }); K.sph(0, 0.845, 0, 0.022, 0xffd27a, { glow: 1, ws: 5, hs: 3, sy: 1.5 });
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.18, 0.18]) K.cyl(dx, 0.752, dz, 0.11, 0.012, 0xf4f1ea, { seg: 10 });
  });
  for (const z of [0.75, 2.3, 3.9, 5.2]) K.group(2.75, z, z < 1 ? N : S, () => { bench(K, 1.3, { ...leather, depth: 0.5, back: 1.3 }); });
  for (const z of [1.5, 3.1]) { K.spot(2.45, z - 0.55, N, 'sit', sitAt()); K.spot(3.05, z + 0.55, S, 'sit', sitAt()); K.spot(2.45, z + 0.55, S, 'sit', sitAt()); }
  fourTop(K, -0.3, 2.0, { cloth, frame: 0x2a1a12, seat: 'accent' }); fourTop(K, 0.3, 4.1, { cloth, frame: 0x2a1a12, seat: 'accent' });
  for (const [x, z] of [[2.75, 1.5], [2.75, 3.1], [-0.3, 2.0], [0.3, 4.1]]) pendant(K, x, z, 1.95, { shade: 0x2a1410, r: 0.16, glow: 0xffb866 });
  // a hearth in the back wall, a lit cabinet of bottles, pictures under their own lamps
  K.group(-1.5, D0 - 0.2, 0, () => {
    K.box(0, 0, 0, 1.8, 1.5, 0.4, 0x6a625a); K.box(0, 1.5, -0.03, 2.0, 0.1, 0.5, 0x2a1a12);
    K.plane(0, 0.55, -0.204, 1.0, 0.8, 'S', 0x0e0806); K.plane(0, 0.4, -0.21, 0.7, 0.4, 'S', 0xff7a2a, { glow: 1.2 }); K.plane(0, 0.32, -0.214, 0.4, 0.2, 'S', 0xffd27a, { glow: 1.4 });
    for (let i = 0; i < 3; i++) K.cyl(-0.25 + i * 0.25, 0.2, -0.24, 0.05, 0.6, 0x2a1a12, { seg: 5, rz: E, center: true });
  });
  K.group(1.0, D0, S, () => shelves(K, 1.6, 2.2, 0.26, 4, { frame: 0x2a1a12, back: 0xffb866, y0: 0.9, fill: (k, x0, x1, y, d) => bottleRow(k, x0 + 0.05, x1 - 0.05, y, d - 0.1, { step: 0.1, h: 0.3, palette: BOTTLES }) }));
  K.group(1.0, D0 - 0.25, 0, () => { K.box(0, 0, 0, 1.6, 0.9, 0.5, 0x2a1a12); });
  for (const z of [2.4, 3.8]) { picture(K, -H0, 1.75, z, 0.9, 0.7, 'E', { frame: 0xa98a3a, rnd: K.rand }); K.group(-H0 + 0.08, z, 0, () => { K.box(0, 2.18, 0, 0.1, 0.03, 0.4, C.brass); K.plane(0.02, 2.17, 0, 0.06, 0.36, 'D', C.bulb, { glow: 1 }); }); }
  K.group(-1.5, 1.2, 0, () => { K.box(0, 0, 0, 0.5, 1.05, 0.38, 0x2a1a12); K.box(0, 1.05, 0.02, 0.56, 0.04, 0.44, 0x4a2a1c, { rx: 0.25 }); K.sph(-0.2, 1.2, -0.1, 0.035, C.bulb, { glow: 1, ws: 5, hs: 3 }); K.shadow(0, 0, 0.8, 0.7); K.spot(0, 0.55, S, 'counter', { role: 'staff', h: 1.02 }); });
  K.spot(1.3, 2.9, E, 'stand', { role: 'staff', roam: 0.4 });
}

function seafood(K) {
  K.shell({ skirting: 0x2a3f4a });
  // the raw bar: shellfish on a bed of ice, lemons, the day's catch chalked up behind
  counter(K, -0.6, 3.2, 3.8, 0.7, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xd8dcd8 });
  K.group(0, 0, 0, () => { K.box(1.3, 1.02, 4.12, 3.4, 0.14, 0.5, 0xe6f2f6, { rx: -0.12 }); K.box(1.3, 1.02, 4.38, 3.5, 0.2, 0.04, C.chrome); }, { stretch: true });
  for (let i = 0; i < 16; i++) K.group(-0.2 + (i % 8) * 0.43, 4.0 + Math.floor(i / 8) * 0.22, 0, () => {
    const y = 1.17 + Math.floor(i / 8) * 0.03;
    if (i % 5 === 0) K.sph(0, y + 0.03, 0, 0.045, 0xf1c40f, { ws: 5, hs: 3 });
    else if (i % 5 === 3) { K.box(0, y, 0, 0.22, 0.05, 0.09, 0xc0392b, { ry: 0.5 }); K.box(0.1, y, 0.06, 0.1, 0.04, 0.04, 0xc0392b); }
    else { K.cyl(0, y, 0, 0.06, 0.02, 0x8a8f8c, { seg: 7, sz: 0.75 }); K.cyl(0, y + 0.018, 0, 0.045, 0.006, 0xe8e0d0, { seg: 7, sz: 0.75 }); }
  });
  for (let i = 0; i < 4; i++) stool(K, 0.1 + i * 0.8, 3.35, 0.76, { seat: 0xd8dcd8, spot: { pose: 'bar', h: 0.76, table: true, prio: i === 1 ? 1 : 4 } });
  chalkboard(K, 1.3, 2.6, 2.3, 2);
  K.spot(1.3, 4.9, S, 'work', { role: 'staff' });
  // tables under cloths, lanterns, round mirrors like portholes, a rope along the wall
  fourTop(K, -0.4, 1.9, { cloth: 0xf4f1ea, seat: 'accent', centre: 'vase' }); twoTop(K, 2.5, 1.4, { cloth: 0xf4f1ea, alongZ: true, seat: 'accent', centre: 'candle' });
  twoTop(K, -2.1, 3.8, { cloth: 0xf4f1ea, alongZ: true, seat: 'accent', centre: 'candle' });
  for (const [x, z] of [[-0.4, 1.9], [2.5, 1.4], [-2.1, 3.8]]) K.group(x, z, 0, () => { K.box(0, 2.25, 0, 0.01, HT - 2.25, 0.01, C.black, { faces: 'fbrl' }); K.cyl(0, 2.0, 0, 0.1, 0.22, 0xffe6b0, { seg: 8, glow: 1 }); K.cyl(0, 2.22, 0, 0.13, 0.04, C.brass, { seg: 8, r2: 0.05 }); K.cyl(0, 1.97, 0, 0.12, 0.03, C.brass, { seg: 8 }); });
  for (const z of [2.2, 3.4, 4.6]) K.group(H0 - 0.02, z, 0, () => { K.cyl(0, 1.75, 0, 0.3, 0.04, C.brass, { seg: 16, rz: E, center: true }); K.cyl(-0.012, 1.75, 0, 0.24, 0.04, 0xcfe4ea, { seg: 16, rz: E, center: true, glow: 0.4 }); });
  K.group(0, 0, 0, () => { for (let i = 0; i < 8; i++) { const z0 = 1.9 + i * 0.42, y = (t) => 2.45 - Math.sin(t * PI) * 0.1; K.rod(-H0 + 0.04, y(0), z0, -H0 + 0.04, y(0.5), z0 + 0.21, 0.02, 0xc9b48a); K.rod(-H0 + 0.04, y(0.5), z0 + 0.21, -H0 + 0.04, y(1), z0 + 0.42, 0.02, 0xc9b48a); } }, { stretch: true });
  picture(K, -H0, 1.6, 2.6, 1.1, 0.7, 'E', { frame: 0xf4f1ea, art: [0x9ac4d8, 0x1c4a6a, 0xf4f1ea], rnd: K.rand });
  K.spot(-1.2, 3.0, S, 'stand', { role: 'staff', roam: 0.4 });
}

function barbecue(K) {
  K.shell({ skirting: 0x2a1c14 });
  // picnic tables: planks, a bench either side, a roll of paper and the sauces on each
  for (const [x, z] of [[0.2, 1.6], [2.3, 2.9], [-0.4, 3.5]]) K.group(x, z, 0, () => {
    for (let i = 0; i < 4; i++) K.box(0, 0.72, -0.3 + i * 0.2, 1.7, 0.04, 0.18, i % 2 ? 0xa9824f : 0xb89060);
    for (const sx of [-0.7, 0.7]) { K.rod(sx, 0, -0.55, sx, 0.72, 0.2, 0.03, 0x7a5a3c); K.rod(sx, 0, 0.55, sx, 0.72, -0.2, 0.03, 0x7a5a3c); K.box(sx, 0.4, 0, 0.05, 0.05, 1.5, 0x7a5a3c); }
    for (const sz of [-0.66, 0.66]) { K.box(0, 0.42, sz, 1.7, 0.04, 0.24, 0xa9824f); }
    K.cyl(-0.55, 0.82, 0, 0.06, 0.24, 0xf4f1ea, { seg: 8, rz: E, center: true });
    bottle(K, 0.5, 0.76, -0.06, 0.2, 0xb0291f); bottle(K, 0.6, 0.76, 0.06, 0.2, 0xd9a227);
    K.box(0, 0.762, 0.05, 0.4, 0.012, 0.3, 0xc9a06a); K.box(0, 0.775, 0.05, 0.2, 0.05, 0.14, 0x5a2a1a);
    K.shadow(0, 0, 2.0, 1.8, 0.62);
    for (const [dx, dz, ry] of [[-0.4, -0.66, N], [0.4, -0.66, N], [-0.4, 0.66, S], [0.4, 0.66, S]]) K.spot(dx, dz, ry, 'sit', sitAt({ h: 0.45 }));
  });
  // the smoker's door in the back wall, a stack of split wood beside it
  K.group(-1.8, D0 - 0.25, 0, () => {
    K.box(0, 0, 0, 1.7, 2.3, 0.5, 0x1c1a1a); K.box(0, 2.3, 0.05, 0.3, HT - 2.3, 0.3, 0x1c1a1a);
    for (const y of [0.35, 1.3]) { K.box(0, y, -0.26, 1.4, 0.8, 0.04, 0x2a2826); K.box(0.55, y + 0.36, -0.3, 0.05, 0.1, 0.05, C.chrome); K.plane(0, y - 0.02, -0.285, 1.42, 0.02, 'S', 0xff6a1a, { glow: 1 }); }
    K.cyl(-0.4, 1.7, -0.29, 0.09, 0.02, 0xf4f1ea, { seg: 10, rx: E, center: true });
  });
  K.group(-3.0, D0 - 0.35, 0, () => { for (let r = 0; r < 5; r++) for (let i = 0; i < 4 - (r > 3 ? 1 : 0); i++) K.cyl(-0.3 + i * 0.2 + (r % 2) * 0.1, 0.09 + r * 0.17, 0, 0.09, 0.5, r % 2 ? 0x8a6a44 : 0x6a4a30, { seg: 6, rx: E, center: true }); });
  // where you order: a counter under butcher's paper, the menu on boards, trays
  serviceCounter(K, { x0: 0.3, x1: 3.2, z: 4.3, tills: [2.5], front: 0x7a5232, slot: 0, top: 0xc9a06a });
  K.group(1.2, 4.6, 0, () => { K.box(0, 1.02, 0, 0.5, 0.012, 0.4, 0xb4b8bc); K.box(0, 1.03, 0, 0.3, 0.07, 0.16, 0x5a2a1a); K.box(0.15, 1.03, 0.1, 0.12, 0.04, 0.1, 0xe8c84a); });
  K.group(1.7, D0, 0, () => { for (let i = 0; i < 3; i++) { K.plane(-0.9 + i * 0.9, 2.2, -0.02, 0.8, 1.0, 'S', 0x3a2a1c); writing(K, -0.9 + i * 0.9, 2.2, -0.026, 0.7, 0.9, 'S', { rows: 6, col: 0xf6e2b8 }); } });
  // a string of bulbs across the room
  for (const z of [1.4, 3.0]) K.group(0, 0, 0, () => { K.rod(-H0, 2.7, z, H0, 2.7, z, 0.006, 0x1c1c1c); for (let i = 0; i < 12; i++) K.sph(-3.2 + i * 0.58, 2.64, z, 0.045, 0xffd98a, { glow: 1, ws: 5, hs: 3 }); }, { stretch: true });
  K.group(H0 - 0.012, 2.4, 0, () => { K.plane(0, 1.9, 0, 1.2, 0.5, 'W', 0x2a1c14); K.plane(-0.006, 1.9, 0, 1.0, 0.1, 'W', 0xf6e2b8); });
  K.spot(1.2, 5.0, S, 'work', { role: 'staff' });
  K.spot(2.5, 3.7, N, 'counter', { h: 1.02, prio: 1 });
}

export const KITS_C = { pizza, mexican, chinese, japanese, korean, noodles, indian, mediterranean, italian, diner, burger, sandwich, chicken, steakhouse, seafood, barbecue };
