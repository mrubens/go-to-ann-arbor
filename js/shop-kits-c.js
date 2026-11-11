import { H0, D0, HT, SLOT, C, BRIGHTS, BOTTLES, chair, stool, tableRound, tableSquare, pendant, ceilingPanel,
  picture, plant, till, counter, shelves, bottle, bottleRow, bench, armchair, writing } from './shop-kit-core.js';

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
  diner: { floor: 'checker', wall: 'panel', walls: [0xcfd9d6, 0xd9d6c8, 0xc4d6dc], floors: [0x9a9a96, 0xa8a49c], accents: [0xa62a24, 0x1f6a8a, 0xb03a5a], day: 0.9, night: 0.7 },
  burger: { floor: 'checker', wall: 'band', walls: [0xd8d2c2, 0xe6dfcf], floors: [0x9a9286, 0xa69c8c], accents: [0xc2261c, 0xd98a12, 0x1c1c1e], day: 1.1 },
  sandwich: { floor: 'tile', wall: 'panel', walls: [0xcfc6a8, 0xd9d2b8, 0xc4c8b0], floors: [0x8a7a64, 0x9a8a70], accents: [0x2c5a34, 0x8a3a24, 0x2a4a6a], day: 1.05 },
  chicken: { floor: 'checker', wall: 'band', walls: [0xe2d6b8, 0xe9e0c8], floors: [0x9a9286, 0xa69c8c], accents: [0xd98a12, 0xb8321e, 0xc9a227], day: 1.1 },
  steakhouse: { floor: 'wood', wall: 'wainscot', walls: [0x3a2018, 0x2f1c18, 0x442a1c], floors: [0x241812, 0x2c1c14], accents: [0x5a1c1c, 0x3a2414, 0x1f2a24], night: 0.75, day: 0.7 },
  seafood: { floor: 'wood', wall: 'panel', walls: [0x9ab8c4, 0x8aaab8, 0xa8c4c8], floors: [0x6a6a66, 0x5a6a70], accents: [0x1c4a6a, 0x1f5a5a, 0x2a3f6a] },
  barbecue: { floor: 'concrete', wall: 'wainscot', walls: [0x7a5232, 0x6a4a30, 0x86603a], floors: [0x4a3a2c, 0x3a2e24], accents: [0x7a2a1a, 0x2a1c14, 0x8a3a1c] }
};

// ---------------------------------------------------------------------------------------------------------------------
// What several of them share. Each kind has two or three layouts (`v`): the same fittings, each made by a little
// function that takes its place, set out another way.

// What's made inside `fn` as if against the back wall (x along it, the wall at z = D0) stands against the right wall
// instead (x counted from depth `zc`, towards the street), or the left (x towards the back): a counter with its
// kitchen behind turns to a side wall whole. Each thing inside still moves and stretches by its own place. (Not for
// `picture` or `ceilingPanel`, which say where they move themselves.)
const onRight = (K, zc, fn) => K.group(H0 - D0, zc, E, fn, { stretch: true });
const onLeft = (K, zc, fn) => K.group(D0 - H0, zc, W, fn, { stretch: true });
// Things made in `fn` at (x, z), turned `ry`, move as one, and so do the people at them (in a plain group each person
// moves by where they are instead, and slides off their chair in a room of another size)
function unit(K, x, z, ry, fn) {
  K.group(x, z, ry, () => { const n = K.spots.length, a = K.anchor; fn(); for (let i = n; i < K.spots.length; i++) { K.spots[i].ax = a[0]; K.spots[i].az = a[1]; } });
}

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
  });
}
// the kitchen's line along the back wall: steel, a hood, a warm light under it
function kitchenLine(K, { hood = true, x0 = -2.3, x1 = 3.3 } = {}) {
  const mid = (x0 + x1) / 2, w = x1 - x0;
  K.group(0, 0, 0, () => {
    K.box(mid, 0, D0 - 0.3, w, 0.9, 0.6, 0xa9aeb2);
    K.box(mid, 0.9, D0 - 0.3, w + 0.1, 0.03, 0.64, 0xc8ccd0);
    K.plane(mid, 1.45, D0 - 0.012, w, 0.95, 'S', 0xcfd4d4);
    if (hood) { K.box(mid, 1.95, D0 - 0.32, w - 1.6, 0.34, 0.62, 0x9aa0a4); K.plane(mid, 1.93, D0 - 0.3, w - 2.0, 0.4, 'D', 0xffc880, { glow: 0.8 }); }
  }, { stretch: true });
}
// a counter to order at, the menu lit above it, the kitchen's line behind (the menu centred over the counter, or on `menuAt`)
function fastLine(K, x0, x1, { z = 3.7, tills, kitchen = [x0 - 0.1, x1 + 0.1], hood = true, n = Math.round((x1 - x0 - 0.2) / 1.37), menuAt = (x0 + x1) / 2, food, bar, ...how } = {}) {
  serviceCounter(K, { x0, x1, z, tills, ...how });
  menuBoards(K, { x0: menuAt - (n - 1) * 0.685, n, z: z + 0.215, food, bar });
  kitchenLine(K, { x0: kitchen[0], x1: kitchen[1], hood });
}
// tiles down a counter's front: `of(i, r)` gives each its color and how it's made, or nothing for a gap
function tiles(K, x0, x1, z, size, of) {
  K.group(0, 0, 0, () => {
    for (let i = 0; i < Math.floor((x1 - x0 + 0.01) / 0.3); i++) for (let r = 0; r < 3; r++) { const t = of(i, r); if (t) K.plane(x0 + 0.15 + i * 0.3, 0.3 + r * 0.26, z - 0.006, size, size, 'S', t[0], t[1] || {}); }
  }, { stretch: true });
}
// a booth: a table between two benches (turned by `ry`, its benches then either side along x)
function booth(K, bx, bz, { top = 0xe6dfcf, col = 0xffffff, slot = SLOT.accent, w = 1.2, ry = 0 } = {}) {
  unit(K, bx, bz, ry, () => {
    K.box(0, 0.72, 0, w, 0.04, 0.62, top);
    K.cyl(0, 0, 0, 0.06, 0.72, C.steel, { seg: 6 });
    K.cyl(-0.3, 0.76, -0.1, 0.04, 0.12, 0xf4f1ea, { seg: 6, r2: 0.05 });
    K.cyl(0.22, 0.76, 0.08, 0.11, 0.012, 0xf4f1ea, { seg: 10 });
    for (const [dz, r] of [[-0.72, N], [0.72, S]]) {
      K.group(0, dz, r, () => {
        bench(K, w + 0.02, { slot, col, depth: 0.46, back: 1.15 });
        K.spot(-0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
        K.spot(0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
      });
    }
  });
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
// a banquette along the back wall from x0 to x1: `n` little tables before it, a chair across each (`each(x, z)` sets
// something more on a table)
function banquette(K, x0, x1, n, { z = D0 - 0.3, col = 0xffffff, slot = SLOT.accent, back = 1.1, cloth = null, top = C.wood, centre = null, frame = C.woodD, seat = null, each = null } = {}) {
  K.group((x0 + x1) / 2, z, S, () => bench(K, x1 - x0, { col, slot, back }), { stretch: true });
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / n;
    K.spot(x, z - 0.05, S, 'sit', sitAt({ h: 0.45 }));
    tableSquare(K, x, z - 0.68, 0.7, 0.7, { cloth, top, places: [[0, 0.2], [0, -0.2]], centre });
    chair(K, x, z - 1.28, N, { frame, seat, spot: sitAt() });
    if (each) each(x, z - 0.68);
  }
}
// a long table to share, `n` places down each side on chairs or on stools (along x, or turned by `ry`)
function longTable(K, x, z, n, { ry = 0, w = 0.8, top = C.oak, cloth = null, leg = C.char, stools = false, frame = C.woodD, seat = null, each = null } = {}) {
  const len = n * 0.62, h = 0.75;
  unit(K, x, z, ry, () => {
    if (cloth != null) { K.box(0, h - 0.02, 0, len + 0.04, 0.03, w + 0.04, cloth); K.box(0, h - 0.24, 0, len + 0.04, 0.22, w + 0.04, cloth, { faces: 'fbrl', k: 0.86 }); }
    else K.box(0, h - 0.05, 0, len, 0.05, w, top);
    for (const s of [-1, 1]) K.box(s * (len / 2 - 0.3), 0, 0, 0.08, h - 0.05, w - 0.25, leg);
    K.shadow(0, 0, len + 0.3, w + 0.4, 0.6);
    for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * 0.62;
      for (const s of [-1, 1]) {
        if (stools) stool(K, px, s * (w / 2 + 0.2), 0.47, { ry: s < 0 ? N : S, seat: top, spot: sitAt({ h: 0.47 }) });
        else chair(K, px, s * (w / 2 + 0.22), s < 0 ? N : S, { frame, seat, spot: sitAt() });
        if (!each) K.cyl(px, h + 0.012, s * (w / 2 - 0.2), 0.115, 0.012, 0xf4f1ea, { seg: 10 });
      }
      if (each) each(px, h);
    }
  });
}
// a tall round table to stand or perch at, `n` stools round it (the first towards `a0`)
function highTop(K, x, z, n, { a0 = 0, top = C.oak, seat = C.woodL } = {}) {
  tableRound(K, x, z, 0.36, 1.05, { top });
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * PI * 2;
    stool(K, x + Math.sin(a) * 0.6, z + Math.cos(a) * 0.6, 0.76, { ry: a + PI, seat, spot: { pose: 'bar', h: 0.76, table: true } });
  }
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
// someone ordering at a counter whose front is at `z`, someone waiting behind
const queue = (K, x, h = 1.02, z = 3.7) => { K.spot(x, z - 0.58, N, 'counter', { h, prio: 1 }); K.spot(x + 0.15, z - 1.3, N, 'stand', { prio: 3 }); };
// the bin by the door, trays left on top
function bin(K, x, z, ry) { K.group(x, z, ry, () => { K.box(0, 0, 0, 0.6, 1.1, 0.5, 0x6a5a48); K.box(0, 1.1, 0, 0.5, 0.03, 0.4, 0x7a4a2a); K.shadow(0, 0.1, 0.8, 0.5); }); }
// the host's stand by the door, the book open on it (and maybe its little lamp)
function hostStand(K, x, z, { wood = 0x3d2a1c, top = 0x6e4c30, lamp = false } = {}) {
  unit(K, x, z, 0, () => {
    K.box(0, 0, 0, 0.5, 1.05, 0.38, wood); K.box(0, 1.05, 0.02, 0.56, 0.04, 0.44, top, { rx: 0.25 });
    if (lamp) K.sph(-0.2, 1.2, -0.1, 0.035, C.bulb, { glow: 1, ws: 5, hs: 3 });
    K.shadow(0, 0, 0.8, 0.7); K.spot(0, 0.55, S, 'counter', { role: 'staff', h: 1.02 });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// the pizzeria's oven: a brick arch against a wall (the back wall, or turned to a side one), its mouth glowing, the
// split wood under the ledge, whoever works it
function pizzaOven(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 2.0, 2.1, 0.7, 0x8a4a34);
    K.box(0, 2.1, -0.02, 2.1, 0.12, 0.72, 0x5a3024);
    K.box(0, 2.22, 0.1, 0.5, 0.98, 0.4, 0x5a5a5c);
    K.cyl(0, 1.05, -0.36, 0.52, 0.04, 0x1a0e0a, { seg: 14, rx: E, center: true, sy: 1 });
    K.cyl(0, 1.02, -0.385, 0.42, 0.02, 0xff8a2a, { seg: 12, rx: E, center: true, glow: 1.3 });
    K.cyl(0, 0.92, -0.39, 0.3, 0.02, 0xffd27a, { seg: 10, rx: E, center: true, glow: 1.4 });
    K.box(0, 0, -0.37, 1.2, 0.98, 0.04, 0x8a4a34);
    K.box(0, 0.95, -0.42, 1.3, 0.06, 0.2, 0x9a9488);
    for (let i = 0; i < 4; i++) K.cyl(-0.7 + i * 0.14, 0.09, -0.5 - (i % 2) * 0.1, 0.07, 0.5, 0x7a5a3c, { seg: 6, rx: E, center: true });
    K.spot(0.2, -1.0, N, 'work', { role: 'staff' });
  });
}
// the peel leant on the back wall
function pizzaPeel(K, x) { K.group(x, D0 - 0.2, 0, () => { K.rod(0, 0, 0, 0.1, 1.9, 0.12, 0.018, C.oak); K.box(0.11, 1.9, 0.12, 0.34, 0.4, 0.02, C.oak, { rz: -0.05 }); }); }
// the counter: pies under glass from c0 to c1, the till
function pizzaCounter(K, x0, x1, z, tillX, c0, c1) {
  serviceCounter(K, { x0, x1, z, tills: [tillX] });
  topCase(K, c0, c1, 1.02, z + 0.25, (x, y) => {
    K.cyl(0, y + 0.02, 0, 0.13, 0.02, 0xd9a860, { seg: 10 });
    K.cyl(0, y + 0.04, 0, 0.11, 0.008, K.pick([0xc0392b, 0xd9862a, 0xe8d8a0]), { seg: 10 });
    for (let i = 0; i < 4; i++) K.cyl(Math.cos(i * 1.6) * 0.06, y + 0.048, Math.sin(i * 1.6) * 0.06, 0.02, 0.006, 0x8a1f1c, { seg: 5 });
  });
}
// a table against the wall behind, `n` stacks of flat boxes on it
function pizzaBoxes(K, x, z, n = 3) {
  K.group(x, z, 0, () => {
    K.box(0, 0, 0, n * 0.6 + 0.6, 0.9, 0.5, 0x6e4c30); K.box(0, 0.9, 0, n * 0.6 + 0.66, 0.03, 0.54, C.oak);
    for (let s = 0; s < n; s++) for (let k = 0; k < 4 + s * 2; k++) K.box((s - (n - 1) / 2) * 0.6 - 0.1, 0.93 + k * 0.045, 0, 0.42, 0.04, 0.42, k % 3 ? 0xe8e0cc : 0xc9b48a, { ry: (k % 2) * 0.06 });
  });
}
// what's on a red-check cloth: a paper square, the oil
const CHECK = 0xb0291f;
const checkSet = (K, x, z) => K.group(x, z, 0, () => { K.plane(0, 0.765, 0, 0.5, 0.5, 'U', 0xf4f1ea, { ry: PI / 4 }); K.cyl(0.05, 0.77, 0.03, 0.035, 0.15, 0x2f5a2a, { seg: 6, r2: 0.02 }); });
function checkTable(K, x, z, { alongZ = false, four = false } = {}) {
  if (four) fourTop(K, x, z, { cloth: CHECK, centre: null }); else twoTop(K, x, z, { cloth: CHECK, alongZ, centre: null });
  checkSet(K, x, z);
}
function pizza(K, v = 0) {
  K.shell();
  const shade = { shade: 0x8a2a20, r: 0.2 };
  if (v === 1) {
    // the oven in the middle of the back wall; the counter down the right wall, its pies towards the window; a
    // banquette of red-check tables down the left, a table for four in the window
    pizzaOven(K, -0.4, D0 - 0.35);
    pizzaPeel(K, -1.75);
    onRight(K, 3.3, () => {
      pizzaCounter(K, -1.6, 1.6, 3.75, -0.4, 0.1, 1.4);
      pizzaBoxes(K, -0.5, D0 - 0.28, 2);
      chalkboard(K, 0, 2.2, 2.45, 2);
      queue(K, -0.4, 1.02, 3.75);
    });
    onLeft(K, 3.3, () => {
      banquette(K, -1.5, 1.3, 3, { cloth: CHECK, each: (x, z) => { checkSet(K, x, z); pendant(K, x, z, 2.1, shade); } });
    });
    checkTable(K, 0, 1.6, { four: true }); pendant(K, 0, 1.6, 2.1, shade);
    picture(K, -H0, 1.95, 2.7, 0.8, 0.6, 'E', { rnd: K.rand }); picture(K, -H0, 1.95, 3.9, 0.6, 0.7, 'E', { rnd: K.rand });
    return;
  }
  if (v === 2) {
    // a slice shop: the counter right across, the oven and its cook at work behind it; stools at the window, a few
    // tables down the left wall
    pizzaOven(K, 0.6, D0 - 0.35);
    pizzaPeel(K, -0.8);
    pizzaCounter(K, -1.3, 3.2, 3.2, 2.6, -1.0, 1.9);
    pizzaBoxes(K, 2.6, D0 - 0.28, 1);
    chalkboard(K, -2.2, 2.0, 2.3, 2);
    windowBar(K, -0.4, 3.2, 5);
    checkTable(K, -2.85, 2.6, { alongZ: true }); checkTable(K, -2.85, 4.4, { alongZ: true }); checkTable(K, 0, 2.1);
    for (const [x, z] of [[-2.85, 2.6], [-2.85, 4.4], [0, 2.1]]) pendant(K, x, z, 2.1, shade);
    for (const x of [-0.5, 1.6]) pendant(K, x, 3.5, 2.2, { shade: 0x2a2a2c, r: 0.16 });
    picture(K, H0, 1.8, 2.4, 0.8, 0.6, 'W', { rnd: K.rand });
    queue(K, 2.6, 1.02, 3.2);
    return;
  }
  // the oven in the back wall on the left; the counter beside it: pies under glass, the till, boxes stacked behind
  pizzaOven(K, -1.3, D0 - 0.35);
  pizzaPeel(K, -2.55);
  pizzaCounter(K, 0.2, 3.2, 3.8, 2.6, 0.4, 2.1);
  pizzaBoxes(K, 2.0, D0 - 0.28);
  chalkboard(K, 1.9, 2.2, 2.45, 2);
  // red-check tables
  for (const [x, z, alongZ] of [[-0.3, 1.5, false], [2.4, 1.3, true], [0.9, 2.75, false], [-1.2, 2.9, false]]) checkTable(K, x, z, { alongZ });
  for (const [x, z] of [[-0.3, 1.5], [2.4, 1.3], [0.9, 2.75]]) pendant(K, x, z, 2.1, shade);
  picture(K, -H0, 1.7, 2.6, 0.8, 0.6, 'E', { rnd: K.rand }); picture(K, -H0, 1.7, 3.8, 0.6, 0.8, 'E', { rnd: K.rand });
  K.spot(2.6, 3.2, N, 'counter', { h: 1.02, prio: 1 });
}

// the taqueria's counter: its front in bright tiles, the fillings in a row under glass from `c0`, the menu and the
// kitchen behind
function taqueria(K, x0, x1, tills, c0, how = {}) {
  const z = how.z ?? 3.7;
  fastLine(K, x0, x1, { tills, top: 0xe8dcc0, food: [0xd9862a, 0x4a8a3a, 0xb6382c, 0xc9a227], bar: 0x1c7a6a, ...how });
  tiles(K, x0, x1, z, 0.22, (i, r) => [[0xf1c40f, 0x1c7a6a, 0xc2491c, 0xf4f1ea, 0x2a5aa6][(i + r * 2) % 5]]);
  topCase(K, c0, c0 + 1.1, 1.02, z + 0.28, (x, y) => K.box(0, y + 0.01, 0, 0.24, 0.07, 0.3, K.pick([0x4a8a3a, 0xb6382c, 0xe8d8a0, 0x7a4a2a, 0xf1c40f, 0xf4f1ea])), { h: 0.3 });
}
// the salsa bar: tubs of five colors on a tiled stand, its back to a wall
function salsaBar(K, x, z, ry) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.6, 0.9, 0.5, 0xffffff, { slot: SLOT.accent }); K.box(0, 0.9, 0, 1.66, 0.04, 0.56, 0xe8dcc0);
    [0xb0291f, 0x4a8a3a, 0xd9862a, 0x7a2a1a, 0xf1c40f].forEach((c, i) => { K.cyl(-0.56 + i * 0.28, 0.94, 0, 0.1, 0.06, 0x2a2a2c, { seg: 8 }); K.cyl(-0.56 + i * 0.28, 0.99, 0, 0.085, 0.015, c, { seg: 8 }); });
    K.shadow(0, 0, 1.9, 0.5);
  });
}
// strings of cut-paper flags across the room
function paperFlags(K, zs) {
  for (const z of zs) K.group(0, 0, 0, () => {
    K.rod(-H0, 2.75, z, H0, 2.75, z, 0.006, 0x2a2a2c);
    for (let i = 0; i < 17; i++) K.box(-3.25 + i * 0.4, 2.48, z, 0.3, 0.26, 0.006, [0xe84393, 0xf1c40f, 0x16a085, 0xe67e22, 0x2980b9, 0x8e44ad][i % 6], { faces: 'fb' });
  }, { stretch: true });
}
function mexican(K, v = 0) {
  K.shell();
  const wood = { top: 0xd9a05a, frame: 0x6e4c30, seat: 'accent' };
  if (v === 1) {
    // the counter and the kitchen down the right wall; the salsa bar against the back; one long table to share, stools
    // at the window, a table for two by the left wall
    onRight(K, 3.5, () => {
      taqueria(K, -1.6, 1.6, [-0.9, 0.8], -0.5, { z: 3.75 });
      queue(K, -0.9, 1.02, 3.75);
    });
    salsaBar(K, -1.3, D0 - 0.3, S);
    paperFlags(K, [1.3, 2.9]);
    longTable(K, -0.4, 2.9, 3, { ...wood, each: (x, h) => { K.cyl(x, h + 0.012, 0.2, 0.115, 0.012, 0xf4f1ea, { seg: 10 }); K.cyl(x, h + 0.012, -0.2, 0.115, 0.012, 0xf1c40f, { seg: 10 }); } });
    windowBar(K, -1.2, 1.5, 4);
    twoTop(K, -2.9, 3.1, { ...wood, alongZ: true });
    plant(K, 2.9, 0.9, 1.3, { pot: 0xc2491c });
    for (const [x, z] of [[-1.4, 1.6], [-0.4, 2.9], [-1.4, 4.2]]) ceilingPanel(K, x, z, 1.1, 0.5);
    return;
  }
  if (v === 2) {
    // a short counter and its kitchen in the back corner behind the door; the salsa bar on the far wall; two booths
    // at the window, a table for four
    taqueria(K, -3.2, 0.4, [-2.3, -0.5], -1.95, { n: 2 });
    salsaBar(K, H0 - 0.3, 4.3, W);
    paperFlags(K, [1.5, 3.2]);
    booth(K, 2.85, 1.55, { top: 0xd9a05a }); booth(K, 0.9, 1.55, { top: 0xd9a05a });
    fourTop(K, 1.5, 3.8, { ...wood, centre: 'vase', w: 0.8 });
    plant(K, -3.0, 2.3, 1.3, { pot: 0xc2491c });
    for (const [x, z] of [[1.9, 1.55], [1.5, 3.8]]) pendant(K, x, z, 2.2, { shade: 0xc2491c, r: 0.2, cone: false });
    for (const x of [-2.2, -0.6]) ceilingPanel(K, x, 3.0, 1.1, 0.5);
    queue(K, -0.5);
    return;
  }
  // the counter along the back; the salsa bar along the left wall; tables
  taqueria(K, -1.6, 3.2, [-0.9, 1.4], -0.2, { n: 3, menuAt: 0.47, kitchen: [-2.3, 3.3] });
  salsaBar(K, -H0 + 0.3, 3.0, E);
  paperFlags(K, [1.3, 2.6]);
  twoTop(K, 2.6, 1.3, { ...wood, alongZ: true }); twoTop(K, 0.6, 1.5, wood);
  fourTop(K, 1.9, 2.75, { ...wood, centre: 'vase', w: 0.8 });
  plant(K, 3.1, 0.45, 1.3, { pot: 0xc2491c });
  for (const [x, z] of [[-1.4, 1.6], [1.6, 1.6], [0, 3.0]]) ceilingPanel(K, x, z, 1.1, 0.5);
  queue(K, -0.9);
}

// a round table under a cloth, a turning tray in the middle, `n` chairs; a red lantern over it
function roundTable(K, x, z, n) {
  unit(K, x, z, 0, () => {
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
// a tank of fish on its stand, its back to a wall
function fishTank(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.5, 0.8, 0.5, 0x2a1410);
    K.box(0, 0.8, 0, 1.5, 0.7, 0.45, 0x3a9ac4, { glow: 0.8 });
    K.box(0, 1.5, 0, 1.54, 0.08, 0.5, 0x2a1410);
    for (let i = 0; i < 6; i++) K.box(-0.55 + i * 0.22, 0.95 + (i % 3) * 0.17, -0.228, 0.08, 0.04, 0.004, i % 2 ? 0xff8a2a : 0xf4f1ea, { glow: 0.9 });
  });
}
// a round gold-framed panel on the back wall; a gold rail along it
function moonPanel(K, x) { K.group(x, D0, 0, () => { K.cyl(0, 2.0, -0.03, 0.62, 0.03, 0xc9a227, { seg: 20, rx: E, center: true }); K.cyl(0, 2.0, -0.05, 0.54, 0.03, 0x5a1414, { seg: 20, rx: E, center: true }); K.plane(0, 2.0, -0.07, 0.5, 0.06, 'S', 0xc9a227); K.plane(0, 2.0, -0.07, 0.06, 0.5, 'S', 0xc9a227); }); }
const goldRail = (K) => K.group(0, 0, 0, () => K.box(0, 2.85, D0 - 0.03, 6.8, 0.1, 0.04, 0xc9a227), { stretch: true });
// the dark desk where orders are paid for and picked up, bags waiting on it
function takeoutDesk(K, x0, x1, z, tillX, bagsX) {
  serviceCounter(K, { x0, x1, z, tills: [tillX], front: 0x2a1410, slot: 0, top: 0x1a0e0c });
  for (let i = 0; i < 3; i++) K.group(bagsX + i * 0.26, z + 0.3, 0, () => K.box(0, 1.02, 0, 0.2, 0.26, 0.14, 0xc9a06a));
}
function chinese(K, v = 0) {
  K.shell({ skirting: 0x1a0e0c });
  const red = 0xd9281c, dark = { top: 0x3a1c14, frame: 0x2a1410, seat: 'accent' }, scroll = { frame: 0xc9a227, art: [0xf2e6c8, 0x2a1410, 0xb0291f], rnd: K.rand };
  if (v === 1) {
    // a banquette of small tables along the back wall, one big round table in the window; the desk down the left
    // wall past the door, the tank in the back corner
    banquette(K, -0.9, 3.3, 4, dark);
    roundTable(K, 0.4, 2.0, 6);
    twoTop(K, 2.8, 1.7, { ...dark, alongZ: true });
    onLeft(K, 2.8, () => { takeoutDesk(K, -0.8, 0.8, 4.2, 0, -0.6); moonPanel(K, 0); });
    fishTank(K, -2.4, D0 - 0.3);
    goldRail(K);
    for (const x of [0.15, 2.25]) picture(K, x, 1.95, D0, 0.5, 1.0, 'S', scroll);
    for (const [x, z] of [[-0.4, 4.5], [0.7, 4.5], [1.7, 4.5], [2.8, 4.5], [2.8, 1.7], [-1.6, 3.4]]) lantern(K, x, z, 2.35, red, { r: 0.15, tall: 0.85 });
    K.spot(-1.5, 4.15, S, 'stand', { role: 'staff', roam: 0.4 });
    return;
  }
  if (v === 2) {
    // mostly to take away: the counter right across the back, the menu lit over it and the woks behind; the tank by
    // the left wall, one round table and a table for two
    fastLine(K, -2.2, 3.2, { front: 0x2a1410, slot: 0, top: 0x1a0e0c, food: [0xd9862a, 0xb0291f, 0x4a8a3a, 0xe8d8a0], bar: 0xc9a227 });
    for (let i = 0; i < 3; i++) K.group(0.1 + i * 0.26, 4.0, 0, () => K.box(0, 1.02, 0, 0.2, 0.26, 0.14, 0xc9a06a));
    for (const x of [-1.2, 0.2, 1.6]) K.group(x, D0 - 0.34, 0, () => { K.cyl(0, 0.93, 0, 0.22, 0.1, 0x2a2a2c, { seg: 10, r2: 0.3 }); K.cyl(0, 1.02, 0, 0.26, 0.006, 0xd9862a, { seg: 10, glow: 0.4 }); });
    fishTank(K, -H0 + 0.3, 2.7, W);
    roundTable(K, 1.9, 1.75, 5);
    twoTop(K, -0.6, 1.3, dark);
    onRight(K, 2.9, () => moonPanel(K, 0));
    for (const [x, z] of [[-0.6, 1.3], [-1.6, 2.9], [0.2, 3.0], [2.9, 3.2]]) lantern(K, x, z, 2.35, red, { r: 0.15, tall: 0.85 });
    queue(K, -0.7); K.spot(1.3, 3.12, N, 'stand', { prio: 2 });
    return;
  }
  // two round tables; the desk at the back on the left, the tank on the right; a round gold-framed panel between
  roundTable(K, 0.1, 1.9, 5); roundTable(K, 2.2, 3.5, 5);
  for (const [x, z] of [[-1.6, 3.2], [2.6, 1.4], [-0.6, 4.4], [1.0, 3.0]]) lantern(K, x, z, 2.35, red, { r: 0.15, tall: 0.85 });
  takeoutDesk(K, -2.9, -1.0, 4.3, -1.6, -2.6);
  fishTank(K, 1.2, D0 - 0.3);
  moonPanel(K, -0.3);
  goldRail(K);
  for (const z of [2.4, 3.9]) picture(K, -H0, 1.7, z, 0.5, 1.1, 'E', scroll);
  K.spot(-0.9, 3.3, S, 'stand', { role: 'staff', roam: 0.5 });
}

// the sushi counter: pale wood, fish under glass, `n` stools, a board and a cup at each; lanterns over it
const SUSHI = { wood: 0xc9a876, dark: 0x2a2a2c };
function sushiBar(K, x0, x1, z, n) {
  const { wood, dark } = SUSHI;
  counter(K, x0, x1, z, 0.75, 1.02, { front: wood, top: 0xd9be92, kick: dark });
  topCase(K, x0 + 0.2, x1 - 0.2, 1.02, z + 0.45, (x, y) => { for (const dz of [-0.1, 0.08]) K.box(0, y + 0.01, dz, 0.2, 0.035, 0.07, K.pick([0xe8826a, 0xf4a08a, 0xf4f1ea, 0xc0392b, 0xe6a23a]), { ry: 0.3 }); }, { h: 0.26, d: 0.4 });
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.5 + i * (x1 - x0 - 1.0) / (n - 1);
    stool(K, x, z - 0.45, 0.76, { seat: wood, col: dark, spot: { pose: 'bar', h: 0.76, table: true, prio: i === (n >> 1) ? 1 : 3 } });
    K.group(x, z + 0.12, 0, () => { K.box(0, 1.022, 0, 0.3, 0.012, 0.18, 0x1c1c1e); K.cyl(0.24, 1.02, 0, 0.03, 0.06, 0xf4f1ea, { seg: 6 }); });
  }
  for (let i = 0; i < 3; i++) lantern(K, x0 + (x1 - x0) * (0.14 + i * 0.36), z, 2.2, 0xfff0d0, { r: 0.16, tall: 1.5 });
}
// behind it: a low cupboard, shelves of bottles and bowls over it
function sushiBack(K, x0, x1) {
  const { wood } = SUSHI, mid = (x0 + x1) / 2, w = x1 - x0;
  K.group(mid, D0, S, () => shelves(K, w - 0.4, 1.2, 0.22, 3, { frame: wood, y0: 0.05, sides: false, fill: (k, a, b, y, d, lvl) => {
    if (lvl === 1) bottleRow(k, a + 0.05, b - 0.05, y, d - 0.1, { step: 0.16, h: 0.3, palette: [0xf4f1ea, 0x2f5a4a, 0x1c2c4a, 0xc9b48a] });
    else for (let x = a + 0.12; x < b; x += 0.24) k.cyl(x, y, d - 0.1, 0.07, 0.07, k.pick([0x1c1c1e, 0xf4f1ea, 0x2a3a5a]), { seg: 8, r2: 0.09 });
  } }), { y: 1.2, stretch: true });
  K.group(0, 0, 0, () => { K.box(mid, 0, D0 - 0.25, w, 0.9, 0.5, wood); K.box(mid, 0.9, D0 - 0.25, w + 0.06, 0.03, 0.54, 0xd9be92); }, { stretch: true });
}
// the kitchen's doorway in the back wall under a split curtain
function noren(K, x) {
  K.group(x, D0, 0, () => {
    K.plane(0, 1.05, -0.012, 1.0, 2.1, 'S', 0x1a1410);
    K.rod(-0.6, 2.12, -0.06, 0.6, 2.12, -0.06, 0.015, SUSHI.dark);
    for (let i = 0; i < 3; i++) { K.box(-0.36 + i * 0.36, 1.45, -0.06, 0.34, 0.66, 0.01, 0xffffff, { slot: SLOT.accent, faces: 'fb' }); K.cyl(-0.36 + i * 0.36, 1.8, -0.07, 0.08, 0.005, 0xf4f1ea, { seg: 10, rx: E, center: true }); }
  });
}
// a branch in blossom in a vase on a low chest
function blossom(K, x, z, ry = 0) {
  const { wood, dark } = SUSHI;
  K.group(x, z, ry, () => { K.box(0, 0, 0, 0.4, 0.7, 0.9, wood); K.cyl(0, 0.7, 0, 0.08, 0.3, dark, { seg: 8, r2: 0.05 }); K.rod(0, 1.0, 0, 0.12, 1.7, 0.2, 0.012, 0x4a3323); K.rod(0.06, 1.35, 0.1, -0.08, 1.75, -0.12, 0.01, 0x4a3323); for (const [bx, by, bz] of [[0.12, 1.7, 0.2], [-0.08, 1.75, -0.12], [0.03, 1.5, 0.06]]) K.sph(bx, by, bz, 0.06, 0xf4b8c4, { ws: 5, hs: 3 }); });
}
// strips of paper on the back wall, from x0
const paperStrips = (K, x0, n) => { for (let i = 0; i < n; i++) K.group(x0 + i * 0.5, D0 - 0.012, 0, () => K.plane(0, 1.7, 0, 0.16, 0.7, 'S', 0xf2ebdc)); };
function japanese(K, v = 0) {
  K.shell({ skirting: 0x6a5a48 });
  const { wood, dark } = SUSHI, soft = { r: 0.2, tall: 0.9 };
  if (v === 1) {
    // the sushi counter down the right wall, the chef between it and his shelves; a banquette down the left wall, a
    // table in the window; the curtained doorway in the middle of the back wall
    onRight(K, 3.3, () => {
      sushiBar(K, -1.7, 1.7, 3.5, 4);
      sushiBack(K, -1.7, 1.7);
      K.spot(0.3, 4.75, S, 'work', { role: 'staff' }); K.spot(-1.1, 4.75, S, 'counter', { role: 'staff', h: 1.02, roam: 0.4 });
    });
    noren(K, -0.7);
    blossom(K, 0.6, D0 - 0.3, E);
    paperStrips(K, -2.9, 3);
    onLeft(K, 3.4, () => banquette(K, -1.5, 1.4, 3, { top: wood, frame: dark, each: (x, z) => lantern(K, x, z, 2.2, 0xfff0d0, soft) }));
    twoTop(K, -0.3, 1.3, { top: wood, frame: dark }); lantern(K, -0.3, 1.3, 2.2, 0xfff0d0, soft);
    return;
  }
  // the sushi counter along the back, the chef behind; the kitchen's doorway at its left; two tables by the window
  sushiBar(K, -1.2, 3.2, 3.5, 5);
  K.spot(0.2, 4.75, S, 'work', { role: 'staff' }); K.spot(2.0, 4.75, S, 'counter', { role: 'staff', h: 1.02, roam: 0.4 });
  sushiBack(K, -0.8, 3.2);
  noren(K, -2.4);
  twoTop(K, 0.4, 1.35, { top: wood, frame: dark }); twoTop(K, 2.5, 1.35, { top: wood, frame: dark });
  lantern(K, 0.4, 1.35, 2.2, 0xfff0d0, soft); lantern(K, 2.5, 1.35, 2.2, 0xfff0d0, soft);
  blossom(K, -H0 + 0.3, 3.6);
  onLeft(K, 0, () => paperStrips(K, 2.3, 4));
}

// a table with a grill set into it (or `n` of them in a row), a hood down over each; chairs round it, `free` of each
// four left empty, or a bench either side like a booth
function grillTable(K, x, z, { ry = 0, n = 1, benches = false, free = 1 } = {}) {
  const len = 1.2 * n, dark = 0x2a2624, at = (g) => (g - (n - 1) / 2) * 1.2;
  unit(K, x, z, ry, () => {
    K.box(0, 0.7, 0, len, 0.05, 0.8, 0x3a2e26);
    for (let g = 0; g < n; g++) {
      const gx = at(g);
      K.box(gx, 0, 0, 0.5, 0.7, 0.4, dark);
      K.cyl(gx, 0.752, 0, 0.19, 0.012, 0x1a1a1c, { seg: 12 }); K.cyl(gx, 0.762, 0, 0.14, 0.006, 0xff7a2a, { seg: 10, glow: 1 });
      for (const [dx, dz, c] of [[-0.42, 0.2, 0xb0291f], [-0.42, -0.2, 0x4a8a3a], [0.42, 0.2, 0xf4f1ea], [0.42, -0.2, 0xd9862a], [-0.3, 0, 0xe8d8a0], [0.3, 0, 0x7a4a2a]]) { K.cyl(gx + dx, 0.752, dz, 0.055, 0.03, 0xf4f1ea, { seg: 6, r2: 0.065 }); K.cyl(gx + dx, 0.78, dz, 0.05, 0.006, c, { seg: 6 }); }
      K.cyl(gx, 1.75, 0, 0.26, 0.2, 0x9aa0a4, { seg: 10, r2: 0.09 }); K.cyl(gx, 1.95, 0, 0.08, HT - 1.95, 0x9aa0a4, { seg: 8, open: true });
      if (!benches) [[-0.32, -0.62, N], [0.32, -0.62, N], [-0.32, 0.62, S], [0.32, 0.62, S]].forEach(([dx, dz, r], i) => chair(K, gx + dx, dz, r, { frame: dark, spot: i < 4 - free ? sitAt() : null }));
    }
    K.shadow(0, 0, len + (benches ? 0.1 : 0.4), 1.3, 0.6);
    if (benches) for (const [dz, r] of [[-0.74, N], [0.74, S]]) K.group(0, dz, r, () => {
      bench(K, len + 0.02, { slot: SLOT.accent, col: 0xffffff, depth: 0.46, back: 1.15 });
      for (let g = 0; g < n; g++) for (const dx of [-0.28, 0.28]) K.spot(at(g) + dx, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
    });
  });
}
// a fridge of green bottles, its back to a wall
function sojuFridge(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.3, 2.0, 0.62, 0x2a2a2c); K.plane(0, 1.05, -0.315, 1.14, 1.7, 'S', 0xe6f6ea, { glow: 2 });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) K.plane(-0.48 + i * 0.12, 0.4 + r * 0.42, -0.32, 0.07, 0.28, 'S', i % 4 === 3 ? 0xd9c27a : 0x2f7a3a, { glow: 2 });
  });
}
// the menu in strips on the back wall
const menuStrips = (K, x0, n) => { for (let i = 0; i < n; i++) K.group(x0 + i * 0.36, D0 - 0.012, 0, () => { K.plane(0, 2.0, 0, 0.26, 0.9, 'S', 0xf2ebdc); for (let r = 0; r < 5; r++) K.plane(0, 2.34 - r * 0.15, -0.006, 0.05, 0.1, 'S', 0x2a2a2c); }); };
function korean(K, v = 0) {
  K.shell({ skirting: 0x1c1c1e });
  const desk = { front: 0x2a2624, slot: 0, top: 0x3a2e26 };
  if (v === 1) {
    // two grill booths down the right wall, one long table with two grills to share; the counter in the back corner
    // behind the door, the fridge on the left wall
    grillTable(K, 2.8, 1.6, { benches: true }); grillTable(K, 2.8, 3.55, { benches: true });
    grillTable(K, -0.1, 2.8, { ry: E, n: 2, free: 0 });
    serviceCounter(K, { x0: -3.2, x1: -1.5, z: 4.1, tills: [-2.3], ...desk });
    sojuFridge(K, -H0 + 0.33, 2.9, W);
    menuStrips(K, -0.7, 6);
    picture(K, H0, 1.95, 2.55, 0.9, 0.6, 'W', { frame: 0x1c1c1e, rnd: K.rand });
    for (const [x, z] of [[-1.8, 2.0], [1.3, 2.4], [-1.8, 3.6], [1.3, 4.4]]) ceilingPanel(K, x, z, 0.9, 0.4, 0xffe6c0);
    K.spot(1.4, 4.6, W, 'stand', { role: 'staff', roam: 0.4 });
    return;
  }
  // four grill tables; at the back a counter, a fridge of green bottles, the menu in strips on the wall
  for (const [x, z] of [[-0.2, 1.7], [2.4, 1.6], [1.0, 3.3], [-1.6, 3.6]]) grillTable(K, x, z);
  serviceCounter(K, { x0: 1.7, x1: 3.2, z: 4.1, tills: [2.5], ...desk });
  sojuFridge(K, -2.6, D0 - 0.33);
  menuStrips(K, -1.2, 6);
  for (const z of [2.0, 3.4]) picture(K, H0, 1.7, z, 0.9, 0.6, 'W', { frame: 0x1c1c1e, rnd: K.rand });
  for (const [x, z] of [[-1.5, 2.0], [1.5, 2.4], [0, 4.2]]) ceilingPanel(K, x, z, 0.9, 0.4, 0xffe6c0);
  K.spot(-0.6, 2.9, E, 'stand', { role: 'staff', roam: 0.5 });
}

// the noodle counter to eat at: `n` stools, a bowl before each, lanterns over it
const NOODLE = { wood: 0x5a4028, top: 0x8a6a44, dark: 0x1c1410 };
function noodleBar(K, x0, x1, z, n) {
  counter(K, x0, x1, z, 0.55, 1.02, { front: NOODLE.wood, top: NOODLE.top, kick: NOODLE.dark });
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.4 + i * (x1 - x0 - 0.8) / (n - 1);
    stool(K, x, z - 0.4, 0.76, { seat: NOODLE.top, spot: { pose: 'bar', h: 0.76, table: true, prio: (i * 3) % n } });
    K.group(x, z + 0.15, 0, () => { K.cyl(0, 1.022, 0, 0.11, 0.07, i % 2 ? 0x1c1c1e : 0xf4f1ea, { seg: 10, r2: 0.13 }); K.cyl(0, 1.085, 0, 0.115, 0.006, 0xd9a860, { seg: 10 }); });
  }
  const m = Math.round((x1 - x0) / 0.96);
  for (let i = 0; i < m; i++) lantern(K, x0 + 0.6 + i * (x1 - x0 - 1.0) / (m - 1), z - 0.1, 2.25, i % 2 ? 0xff8a3a : 0xd9281c, { r: 0.14, tall: 1.4 });
}
// the open kitchen behind it: the range, big pots of broth on it, the hood over
function noodleKitchen(K, x0, x1) {
  const mid = (x0 + x1) / 2, w = x1 - x0;
  K.group(0, 0, 0, () => {
    K.box(mid, 0, D0 - 0.35, w, 0.88, 0.7, 0x8a9094); K.box(mid, 0.88, D0 - 0.35, w + 0.1, 0.03, 0.74, 0xc8ccd0);
    K.box(mid, 2.0, D0 - 0.4, w - 0.4, 0.4, 0.8, 0x8a9094); K.plane(mid, 1.98, D0 - 0.4, w - 0.8, 0.5, 'D', 0xffc880, { glow: 0.8 });
    K.plane(mid, 1.45, D0 - 0.012, w, 1.0, 'S', 0xcfd4d4);
  }, { stretch: true });
  for (const [f, r, h] of [[0.16, 0.24, 0.42], [0.3, 0.2, 0.34], [0.58, 0.26, 0.46], [0.74, 0.18, 0.2], [0.88, 0.22, 0.38]]) K.group(x0 + f * w, D0 - 0.38, 0, () => { K.cyl(0, 0.91, 0, r, h, 0xb4b8bc, { seg: 12 }); K.cyl(0, 0.91 + h, 0, r * 0.92, 0.006, 0xe6c88a, { seg: 12 }); });
}
// the menu in strips of paper on the back wall, from x0
const paperMenu = (K, x0, n) => { for (let i = 0; i < n; i++) K.group(x0 + i * 0.3, D0 - 0.012, 0, () => { K.plane(0, 1.9, 0, 0.2, 0.7, 'S', i % 3 ? 0xf2ebdc : 0xe8c84a); for (let r = 0; r < 4; r++) K.plane(0, 2.14 - r * 0.15, -0.006, 0.1, 0.05, 'S', 0x2a2a2c); }); };
// a little chest by a wall, the sauces on it
function sauces(K, x, z, ry = 0) { K.group(x, z, ry, () => { K.box(0, 0, 0, 0.4, 0.8, 0.7, NOODLE.wood); for (let i = 0; i < 4; i++) bottle(K, 0, 0.8, -0.24 + i * 0.16, 0.24, [0x2a1a14, 0xb0291f, 0x2a1a14, 0xd9862a][i]); }); }
// the machine that sells the tickets, its back to a wall
function ticketMachine(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 0.7, 1.7, 0.5, 0xb8321e); K.plane(0, 1.25, -0.256, 0.58, 0.62, 'S', 0xfff1cf, { glow: 1 });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) K.plane(-0.2 + i * 0.1, 1.47 - r * 0.14, -0.262, 0.07, 0.09, 'S', [0xd9862a, 0x8a4a2a, 0xf4f1ea, 0x4a8a3a][(i + r) % 4], { glow: 0.9 });
    K.box(0, 0.7, -0.27, 0.4, 0.12, 0.04, C.char);
    K.shadow(0, -0.1, 0.9, 0.5);
  });
}
function noodles(K, v = 0) {
  K.shell({ skirting: NOODLE.dark });
  const small = { top: NOODLE.top, frame: NOODLE.dark };
  if (v === 1) {
    // the counter and the open kitchen down the right wall; one long table with stools down the room; the ticket
    // machine and the menu on the back wall
    onRight(K, 3.25, () => {
      noodleBar(K, -1.65, 1.75, 3.3, 5);
      noodleKitchen(K, -1.75, 1.75);
      K.spot(-0.7, 4.5, S, 'work', { role: 'staff' }); K.spot(0.9, 4.5, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
    });
    longTable(K, -1.3, 3.2, 4, { ry: E, w: 0.7, stools: true, top: NOODLE.top, leg: NOODLE.dark, each: (x, h) => { for (const s of [-1, 1]) { K.cyl(x, h, s * 0.18, 0.1, 0.07, s * x > 0 ? 0x1c1c1e : 0xf4f1ea, { seg: 10, r2: 0.12 }); K.cyl(x, h + 0.063, s * 0.18, 0.105, 0.006, 0xd9a860, { seg: 10 }); } } });
    ticketMachine(K, -2.7, D0 - 0.26);
    paperMenu(K, -1.9, 7);
    sauces(K, 0.6, D0 - 0.25, E);
    twoTop(K, -0.6, 1.1, small);
    pendant(K, -0.6, 1.1, 2.15, { shade: NOODLE.dark }); pendant(K, -1.3, 2.6, 2.15, { shade: NOODLE.dark }); pendant(K, -1.3, 3.8, 2.15, { shade: NOODLE.dark });
    return;
  }
  if (v === 2) {
    // a short counter and the kitchen in the back corner behind the door; two booths down the right wall, a table in
    // the window; the ticket machine at the back
    noodleBar(K, -3.0, 0.2, 3.3, 4);
    noodleKitchen(K, -3.2, 0.3);
    K.spot(-2.2, 4.5, S, 'work', { role: 'staff' }); K.spot(-0.7, 4.5, S, 'counter', { role: 'staff', h: 1.0, roam: 0.4 });
    booth(K, 2.85, 1.55, { top: NOODLE.top, col: NOODLE.wood, slot: 0 }); booth(K, 2.85, 3.45, { top: NOODLE.top, col: NOODLE.wood, slot: 0 });
    twoTop(K, 0.5, 1.4, small);
    ticketMachine(K, 1.1, D0 - 0.26);
    sauces(K, H0 - 0.25, 5.05);
    onRight(K, 4.0, () => paperMenu(K, 0, 7));
    for (const [x, z] of [[2.85, 1.55], [2.85, 3.45], [0.5, 1.4]]) pendant(K, x, z, 2.15, { shade: NOODLE.dark });
    return;
  }
  // a counter to eat at, facing the open kitchen right along the back; little tables by the window
  noodleBar(K, -1.6, 3.2, 3.3, 6);
  noodleKitchen(K, -1.7, 3.3);
  K.spot(-0.5, 4.5, S, 'work', { role: 'staff' }); K.spot(1.6, 4.5, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
  onLeft(K, 0, () => paperMenu(K, 2.1, 7));
  twoTop(K, 0.3, 1.2, small); twoTop(K, 2.5, 1.2, small);
  sauces(K, H0 - 0.25, 2.3);
  pendant(K, 0.3, 1.2, 2.15, { shade: NOODLE.dark }); pendant(K, 2.5, 1.2, 2.15, { shade: NOODLE.dark });
}

// a pierced brass lamp
function brassLamp(K, x, z) {
  K.group(x, z, 0, () => {
    K.box(0, 2.4, 0, 0.01, HT - 2.4, 0.01, C.black, { faces: 'fbrl' });
    K.sph(0, 2.2, 0, 0.2, C.brass, { ws: 8, hs: 6, sy: 1.1 }); K.sph(0, 2.2, 0, 0.15, 0xffc86a, { ws: 8, hs: 6, sy: 1.1, glow: 1 });
    for (let i = 0; i < 6; i++) K.sph(Math.cos(i * 1.05) * 0.2, 2.2, Math.sin(i * 1.05) * 0.2, 0.035, 0xffd98a, { ws: 4, hs: 3, glow: 1 });
    K.cyl(0, 1.95, 0, 0.03, 0.08, C.brass, { seg: 6, r2: 0.01 });
  });
}
// an arch painted on the back wall, a brass plate in it
function arch(K, x) {
  K.group(x, D0, 0, () => {
    K.plane(0, 1.2, -0.012, 1.1, 1.7, 'S', 0x6a1f1c); K.cyl(0, 2.05, -0.012, 0.55, 0.004, 0x6a1f1c, { seg: 14, rx: E, center: true });
    K.plane(0, 1.2, -0.02, 0.96, 1.6, 'S', 0xd9a03a, { k: 0.75 }); K.cyl(0, 2.0, -0.02, 0.48, 0.004, 0xd9a03a, { seg: 14, rx: E, center: true, k: 0.75 });
    K.cyl(0, 1.6, -0.035, 0.24, 0.01, C.brass, { seg: 14, rx: E, center: true }); K.cyl(0, 1.6, -0.045, 0.12, 0.01, 0xd9c27a, { seg: 10, rx: E, center: true });
  });
}
// a carved screen standing in the room
function carvedScreen(K, x, z, ry) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.5, 0.08, 0.1, 0x2a1410); K.box(0, 1.9, 0, 1.5, 0.08, 0.1, 0x2a1410); for (const sx of [-0.72, 0.72]) K.box(sx, 0, 0, 0.07, 1.95, 0.09, 0x2a1410);
    for (let i = 0; i < 8; i++) { K.rod(-0.7 + i * 0.2, 0.08, 0, -0.7 + i * 0.2 + 0.36, 1.9, 0, 0.012, 0x4a2a1c); K.rod(-0.7 + i * 0.2 + 0.36, 0.08, 0, -0.7 + i * 0.2, 1.9, 0, 0.012, 0x4a2a1c); }
    K.shadow(0, 0, 1.7, 0.4);
  });
}
// `n` warm dishes under domes on a side table, its back to a wall
function buffet(K, x, z, ry, n = 4) {
  const len = n * 0.53 + 0.08;
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, len, 0.85, 0.55, 0x2a1410); K.box(0, 0.85, 0, len + 0.1, 0.03, 0.6, 0xe0a030);
    for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 0.53; K.box(dx, 0.88, 0, 0.42, 0.1, 0.34, 0xc8ccd0); K.sph(dx, 0.98, 0, 0.2, 0xd9dcde, { ws: 8, hs: 4, half: true, sy: 0.7, sz: 0.8 }); K.sph(dx, 1.13, 0, 0.025, C.brass, { ws: 4, hs: 3 }); }
    K.shadow(0, 0.1, len + 0.3, 0.6);
  }, n > 4 ? { stretch: true } : {});
}
function indian(K, v = 0) {
  K.shell({ skirting: 0x2a1410 });
  const cloth = 0xe0a030, desk = { front: 0x2a1410, slot: 0, top: 0x4a2a1c };
  if (v === 1) {
    // a long buffet under the arches of the back wall; a banquette down the right wall, a table for four in the room;
    // the till in the back corner behind the door, a carved screen before it
    buffet(K, 0.6, D0 - 0.33, S, 6);
    for (const x of [-0.8, 0.6, 2.0]) arch(K, x);
    serviceCounter(K, { x0: -3.2, x1: -2.0, z: 4.1, tills: [-2.6], ...desk });
    carvedScreen(K, -1.75, 3.6, E);
    onRight(K, 2.8, () => banquette(K, -1.6, 1.6, 3, { cloth, seat: 'accent', centre: 'candle', each: (x, z) => brassLamp(K, x, z) }));
    fourTop(K, -0.3, 2.3, { cloth, seat: 'accent', centre: 'vase' }); brassLamp(K, -0.3, 2.3);
    brassLamp(K, 0.6, 4.4);
    picture(K, -H0, 1.7, 2.6, 0.7, 1.0, 'E', { frame: C.brass, art: [0x1f6a5a, 0xd9a227, 0x7a1f3a], rnd: K.rand });
    K.spot(0.5, 4.1, S, 'stand', { role: 'staff', roam: 0.4 });
    return;
  }
  // tables under brass lamps; arches along the back wall; a carved screen by the door; the buffet on the left wall
  fourTop(K, -0.3, 1.9, { cloth, seat: 'accent', centre: 'vase' }); fourTop(K, 1.4, 3.2, { cloth, seat: 'accent' });
  twoTop(K, 2.5, 1.4, { cloth, alongZ: true, seat: 'accent', centre: 'candle' });
  for (const [x, z] of [[-0.3, 1.9], [1.4, 3.2], [2.5, 1.4], [-1.6, 3.6]]) brassLamp(K, x, z);
  for (let i = 0; i < 4; i++) arch(K, -2.4 + i * 1.6);
  carvedScreen(K, -1.6, 1.9, E);
  buffet(K, -H0 + 0.35, 3.9, E);
  serviceCounter(K, { x0: 2.4, x1: 3.2, z: 4.1, tills: [2.8], ...desk });
  picture(K, H0, 1.7, 2.6, 0.7, 1.0, 'W', { frame: C.brass, art: [0x1f6a5a, 0xd9a227, 0x7a1f3a], rnd: K.rand });
  K.spot(0.6, 4.4, S, 'stand', { role: 'staff', roam: 0.5 });
}

// the grill's counter: blue and white tiles down its front, salads under glass from c0 to c1; behind, the spits
// turning before their heat, a stack of flatbread and the oil
const MED = { white: 0xf2f4f2, blue: 0x1f4f8a };
function medLine(K, x0, x1, till, c0, c1, spits, bread, how = {}) {
  const z = how.z ?? 3.7;
  fastLine(K, x0, x1, { tills: [till], top: MED.white, front: MED.white, slot: 0, hood: false, food: [0xb8793a, 0x4a8a3a, 0xe8d8a0, 0xb6382c], bar: MED.blue, ...how });
  tiles(K, x0, x1, z, 0.26, (i, r) => ((i + r) % 2 ? [0xffffff, { slot: SLOT.accent }] : null));
  topCase(K, c0, c1, 1.02, z + 0.28, (x, y) => K.box(0, y + 0.01, 0, 0.24, 0.07, 0.3, K.pick([0x4a8a3a, 0xb6382c, 0xe8d8a0, 0xf4f1ea, 0x8e44ad, 0xd9862a, 0x7ab02a])), { h: 0.3 });
  spits.forEach((x, i) => K.group(x, D0 - 0.3, 0, () => {
    K.box(0.02, 0.93, 0.12, 0.55, 0.95, 0.12, 0x8a9094); K.plane(0.02, 1.4, 0.055, 0.42, 0.8, 'S', 0xff6a2a, { glow: 1 });
    K.cyl(0, 0.93, -0.08, 0.16, 0.03, 0xc8ccd0, { seg: 10 }); K.cyl(0, 0.93, -0.08, 0.012, 1.0, 0xc8ccd0, { seg: 5 });
    K.cyl(0, 1.02, -0.08, 0.1, 0.72, i ? 0xb8793a : 0x8a4a2a, { seg: 10, r2: 0.16 });
  }));
  K.group(bread, D0 - 0.3, 0, () => { for (let i = 0; i < 4; i++) K.cyl(-0.3 + i * 0.2, 0.93 + i * 0.012, 0, 0.11, 0.012, 0xe8d8a0, { seg: 10 }); bottleRow(K, 0.5, 1.0, 0.93, 0, { step: 0.14, h: 0.3, palette: [0x6a7a2a, 0x8a7a2a] }); });
}
const blueLamp = (K, x, z) => pendant(K, x, z, 2.1, { shade: MED.blue, r: 0.16, cone: false });
// a little round table, a chair either side (along x, or along z)
function cafeTable(K, x, z, alongZ = false) {
  tableRound(K, x, z, 0.36, 0.74, { top: MED.white, leg: MED.white });
  K.group(x, z, 0, () => { K.cyl(0, 0.75, 0, 0.03, 0.13, 0xdfe6e8, { seg: 6 }); K.sph(0, 0.94, 0, 0.06, 0xc8453a, { ws: 5, hs: 3 }); });
  const o = { frame: MED.white, seat: 'accent', spot: sitAt() };
  if (alongZ) { chair(K, x, z - 0.58, N, o); chair(K, x, z + 0.58, S, o); } else { chair(K, x - 0.58, z, E, o); chair(K, x + 0.58, z, W, o); }
  blueLamp(K, x, z);
}
function mediterranean(K, v = 0) {
  K.shell({ skirting: 0x4a5a6a });
  const white = { top: MED.white, frame: MED.white, seat: 'accent', centre: 'vase' }, sea = { frame: MED.white, art: [0x9ac4e0, 0x1f4f8a, 0xf2f4f2], rnd: K.rand };
  if (v === 1) {
    // the counter and the spits down the left wall past the door; a banquette down the right wall, little round
    // tables in the room; the olive tree at the back
    onLeft(K, 3.6, () => {
      medLine(K, -1.6, 1.6, -1.0, -0.4, 1.3, [0.2, 1.1], -1.3, { z: 3.75 });
      K.spot(0.6, 4.65, S, 'work', { role: 'staff' });
      queue(K, -1.0, 1.02, 3.75);
    });
    onRight(K, 3.1, () => banquette(K, -1.8, 1.8, 3, { ...white, each: (x, z) => blueLamp(K, x, z) }));
    cafeTable(K, 0, 1.3); cafeTable(K, 0.35, 2.9, true); cafeTable(K, 0, 4.4);
    plant(K, 1.45, 5.0, 1.7, { pot: MED.white });
    picture(K, -0.7, 1.75, D0, 1.2, 0.8, 'S', sea);
    return;
  }
  // the counter along the back; white tables, blue chairs, an olive tree in a pot, lamps of blue glass
  medLine(K, -1.8, 3.2, 2.4, -1.5, 1.2, [-0.6, 0.5], 1.9, { n: 3, menuAt: 0.47, kitchen: [-2.3, 3.3] });
  for (const [x, z, alongZ] of [[-0.2, 1.5, false], [2.5, 1.3, true], [1.2, 2.7, false]]) { twoTop(K, x, z, { ...white, alongZ }); blueLamp(K, x, z); }
  plant(K, 3.05, 2.6, 1.7, { pot: MED.white });
  picture(K, -H0, 1.75, 3.0, 1.2, 0.8, 'E', sea);
  K.spot(-0.1, 4.6, S, 'work', { role: 'staff' });
  queue(K, 2.4);
}

// a rack of wine against the back wall, `w` wide
function wineRack(K, x, w) {
  K.group(x, D0, S, () => shelves(K, w, 2.4, 0.3, 6, { frame: 0x3d2a1c, back: 0x1a120e, fill: (k, x0, x1, y, d) => {
    for (let bx = x0 + 0.06; bx < x1; bx += 0.105) if (k.rand() > 0.12) { k.cyl(bx, y + 0.045, d - 0.16, 0.04, 0.28, k.pick([0x1f3a1c, 0x2a1414, 0x1c2414, 0x3a2a14]), { seg: 6, rx: E, center: true }); k.cyl(bx, y + 0.045, d - 0.012, 0.018, 0.02, k.pick([0x8a1f24, 0xc9a227, 0x1c1c1e]), { seg: 5, rx: E, center: true }); }
  } }));
}
// an arch in the back wall through to the kitchen
function kitchenArch(K, x) {
  K.group(x, D0, 0, () => {
    K.plane(0, 1.05, -0.012, 1.5, 2.1, 'S', 0xffd9a0, { glow: 0.6 }); K.cyl(0, 2.1, -0.012, 0.75, 0.004, 0xffd9a0, { seg: 16, rx: E, center: true, glow: 0.6 });
    K.plane(0, 0.5, -0.02, 1.5, 1.0, 'S', 0x8a9094, { glow: 0.3 });
    for (const sx of [-0.8, 0.8]) K.box(sx, 0, -0.06, 0.14, 2.15, 0.12, 0x9a8a72);
  });
}
// a sideboard, its back to a wall: oil, a big wheel of cheese
function sideboard(K, x, z, ry) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.7, 0.9, 0.5, 0x3d2a1c); K.box(0, 0.9, 0, 1.76, 0.04, 0.56, 0x6e4c30);
    K.cyl(-0.5, 0.94, 0, 0.2, 0.14, 0xe0b85a, { seg: 12 }); bottleRow(K, 0.0, 0.6, 0.94, 0, { step: 0.13, h: 0.32, palette: [0x6a7a2a, 0x2a1414, 0x1f3a1c] });
    K.shadow(0, 0, 2.0, 0.5);
  });
}
function italian(K, v = 0) {
  K.shell();
  const cloth = 0xf4f1ea, lamp = (x, z, r = 0.18) => pendant(K, x, z, 2.05, { shade: 0x2f3b2a, r });
  if (v === 1) {
    // one long family table down the room, a banquette of small tables down the right wall; the wine along the left
    // wall, the kitchen's arch and the sideboard at the back
    longTable(K, -0.3, 2.9, 3, { ry: E, w: 0.9, cloth, seat: 'accent', each: (x, h) => { for (const s of [-1, 1]) { K.cyl(x, h + 0.012, s * 0.27, 0.115, 0.012, 0xf4f1ea, { seg: 10 }); K.cyl(x + 0.17, h + 0.012, s * 0.2, 0.03, 0.1, 0xcfe0e4, { seg: 6, r2: 0.036 }); } if (!x) bottle(K, 0, h + 0.01, 0, 0.3, 0x1f3a1c); } });
    lamp(-0.3, 2.4, 0.2); lamp(-0.3, 3.4, 0.2);
    onRight(K, 2.8, () => banquette(K, -1.6, 1.6, 3, { cloth, seat: 'accent', centre: 'candle', each: (x, z) => lamp(x, z) }));
    onLeft(K, 3.55, () => wineRack(K, 0, 2.7));
    kitchenArch(K, -1.0);
    sideboard(K, 1.5, D0 - 0.3, S);
    picture(K, 1.5, 1.9, D0, 1.2, 0.8, 'S', { rnd: K.rand });
    picture(K, H0, 1.95, 2.25, 1.2, 0.7, 'W', { rnd: K.rand }); picture(K, H0, 1.95, 3.9, 0.7, 0.8, 'W', { rnd: K.rand });
    hostStand(K, -1.6, 1.1);
    K.spot(0.8, 4.5, S, 'stand', { role: 'staff', roam: 0.4 });
    return;
  }
  // tables under white cloths; racks of wine across the back wall, an arch through to the kitchen between them
  fourTop(K, -0.3, 1.9, { cloth, seat: 'accent' }); fourTop(K, 0.2, 4.0, { cloth, seat: 'accent', centre: 'vase' });
  for (const z of [1.5, 3.0]) { twoTop(K, 2.6, z, { cloth, alongZ: false, seat: 'accent', centre: 'candle' }); lamp(2.6, z); }
  lamp(-0.3, 1.9, 0.2); lamp(0.2, 4.0, 0.2);
  for (const x of [-2.3, 2.3]) wineRack(K, x, 2.2);
  kitchenArch(K, 0);
  // a sideboard; pictures; the host
  sideboard(K, -H0 + 0.3, 3.4, E);
  for (const z of [2.2, 4.6]) picture(K, -H0, 1.8, z, 0.6, 0.8, 'E', { rnd: K.rand });
  picture(K, H0, 1.8, 2.25, 1.2, 0.8, 'W', { rnd: K.rand }); picture(K, H0, 1.8, 4.3, 0.7, 0.9, 'W', { rnd: K.rand });
  hostStand(K, -1.5, 1.2);
  K.spot(1.4, 4.6, S, 'stand', { role: 'staff', roam: 0.5 });
}

// the diner's counter: chrome-edged, `n` chrome stools along it, a pie under a dome, the till; lamps over it
function dinerCounter(K, x0, x1, z, n) {
  const mid = (x0 + x1) / 2, w = x1 - x0;
  counter(K, x0, x1, z, 0.6, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xe8e4da, kick: 0x8a9094 });
  K.group(0, 0, 0, () => { K.box(mid, 0.94, z - 0.01, w, 0.05, 0.02, C.chrome); K.box(mid, 0.3, z - 0.01, w, 0.03, 0.02, C.chrome); }, { stretch: true });
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.4 + i * (w - 0.7) / (n - 1);
    K.group(x, z - 0.42, 0, () => {
      K.cyl(0, 0.7, 0, 0.18, 0.08, 0xffffff, { seg: 12, slot: SLOT.accent }); K.cyl(0, 0.68, 0, 0.185, 0.025, C.chrome, { seg: 12 });
      K.cyl(0, 0, 0, 0.04, 0.68, C.chrome, { seg: 6 }); K.cyl(0, 0, 0, 0.17, 0.03, C.chrome, { seg: 10 });
      K.shadow(0, 0, 0.5, 0.5, 0.7);
      K.spot(0, 0, 0, 'bar', { h: 0.78, table: true, prio: (i * 3) % n });
    });
    if (i % 2) K.group(x, z + 0.2, 0, () => { K.cyl(0, 1.022, 0, 0.11, 0.012, 0xf4f1ea, { seg: 10 }); K.cyl(0.2, 1.022, -0.04, 0.04, 0.08, 0xf4f1ea, { seg: 6 }); });
  }
  K.group(x0 + 0.8, z + 0.35, 0, () => { K.cyl(0, 1.02, 0, 0.2, 0.03, C.chrome, { seg: 12 }); K.cyl(0, 1.05, 0, 0.16, 0.05, 0xc8914e, { seg: 12 }); K.sph(0, 1.05, 0, 0.2, 0xd6e6e8, { ws: 10, hs: 4, half: true, sy: 0.8 }); });
  till(K, x1 - 0.5, 1.02, z + 0.3);
  for (let x = x0 + 1.2; x < x1 - 0.4; x += 1.6) pendant(K, x, z, 2.15, { shade: C.chrome, r: 0.15 });
}
// behind it: the pass to the kitchen with its tickets, the coffee, the shake mixer
function dinerBack(K, x0, x1) {
  const mid = (x0 + x1) / 2, w = x1 - x0, pass = Math.min(3.0, w - 1.8);
  K.group(0, 0, 0, () => {
    K.box(mid, 0, D0 - 0.3, w, 0.9, 0.6, 0xa9aeb2); K.box(mid, 0.9, D0 - 0.3, w + 0.1, 0.03, 0.64, 0xc8ccd0);
    K.plane(mid, 1.5, D0 - 0.012, pass, 0.7, 'S', 0xffd9a0, { glow: 0.7 }); K.box(mid, 1.12, D0 - 0.12, pass + 0.1, 0.05, 0.2, C.chrome);
  }, { stretch: true });
  K.group(mid, D0 - 0.02, 0, () => { for (let i = 0; i < 6; i++) K.plane(-0.8 + i * 0.3, 1.78, 0, 0.1, 0.16, 'S', i % 2 ? 0xf2efe6 : 0xbcd8f0); });
  K.group(x0 + 0.5, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.5, 0.45, 0.35, 0x2a2a2c); for (const x of [-0.12, 0.12]) K.cyl(x, 0.96, -0.24, 0.08, 0.16, 0x4a2c1a, { seg: 8, r2: 0.09 }); });
  K.group(x1 - 0.7, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.2, 0.5, 0.2, 0x7ac4b8); K.cyl(0, 0.96, -0.16, 0.05, 0.2, C.chrome, { seg: 6, r2: 0.06 }); });
}
// a clock ringed in neon on the back wall
function neonClock(K, x) {
  K.group(x, D0 - 0.04, 0, () => { for (let i = 0; i < 12; i++) { const a0 = i / 12 * PI * 2, a1 = (i + 1) / 12 * PI * 2; K.rod(Math.cos(a0) * 0.3, 2.3 + Math.sin(a0) * 0.3, 0, Math.cos(a1) * 0.3, 2.3 + Math.sin(a1) * 0.3, 0, 0.02, 0xffffff, { slot: SLOT.accent, glow: 1.4, seg: 5 }); } K.cyl(0, 2.3, 0.01, 0.27, 0.01, 0xf4f1ea, { seg: 14, rx: E, center: true }); K.rod(0, 2.3, -0.01, 0.1, 2.44, -0.01, 0.01, C.black); K.rod(0, 2.3, -0.01, -0.14, 2.3, -0.01, 0.01, C.black); });
}
// a jukebox, its back to a wall
function jukebox(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 0.8, 1.1, 0.5, 0x5a2a1c); K.cyl(0, 1.1, 0, 0.4, 0.5, 0x5a2a1c, { seg: 12, rx: E, center: true });
    K.plane(0, 1.05, -0.256, 0.56, 0.4, 'S', 0xfff1cf, { glow: 1 });
    for (const s of [-1, 1]) K.box(s * 0.34, 0.1, -0.26, 0.06, 1.0, 0.02, 0xffffff, { slot: SLOT.accent, glow: 1.2 });
    K.plane(0, 0.5, -0.256, 0.5, 0.5, 'S', 0xc9a227);
    K.shadow(0, -0.1, 1.0, 0.5);
  });
}
function diner(K, v = 0) {
  K.shell({ skirting: 0x3a3a3a });
  if (v === 1) {
    // the counter and its stools down the right wall; booths down the left wall past the door, one more in the window
    onRight(K, 3.2, () => {
      dinerCounter(K, -1.8, 1.9, 3.5, 5);
      dinerBack(K, -1.9, 2.0);
      K.spot(-0.6, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.6 }); K.spot(1.2, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
    });
    booth(K, -2.85, 2.6); booth(K, -2.85, 4.5); booth(K, -0.5, 1.6);
    neonClock(K, -0.6);
    for (const [x, z] of [[-1.6, 1.6], [-1.6, 3.4], [0.2, 3.4]]) ceilingPanel(K, x, z, 1.1, 0.5);
    return;
  }
  if (v === 2) {
    // a short counter in the back corner behind the door; booths down the right wall and in the window; a jukebox
    dinerCounter(K, -3.0, 0.6, 3.5, 5);
    dinerBack(K, -3.2, 0.8);
    K.spot(-2.0, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.6 }); K.spot(-0.3, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
    booth(K, 2.85, 1.55); booth(K, 2.85, 3.45); booth(K, 0.6, 1.45);
    jukebox(K, 1.9, D0 - 0.26);
    onRight(K, 2.5, () => neonClock(K, 0));
    for (const [x, z] of [[-1.4, 1.8], [1.7, 1.6], [1.7, 3.4]]) ceilingPanel(K, x, z, 1.1, 0.5);
    return;
  }
  // the long counter along the back, the pass behind it; booths by the window
  dinerCounter(K, -2.0, 3.2, 3.5, 7);
  dinerBack(K, -2.1, 3.3);
  neonClock(K, -2.6);
  booth(K, 2.85, 1.55); booth(K, 0.85, 1.55);
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [0, 2.9]]) ceilingPanel(K, x, z, 1.1, 0.5);
  K.spot(-0.4, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.8 }); K.spot(2.3, 4.45, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
}

// the burger bar's line: the counter, the menu, the kitchen, wrapped burgers waiting on the pass
function burgerLine(K, x0, x1, tills, how = {}) {
  fastLine(K, x0, x1, { tills, food: [0x9a5a2a, 0xc9a227, 0xb6382c, 0x4a8a3a], ...how });
  for (let i = 0; i < Math.round((x1 - x0) / 0.6); i++) K.group(x0 + 0.8 + i * 0.42, D0 - 0.36 + (i % 2) * 0.12, 0, () => K.box(0, 0.93, 0, 0.2, 0.09, 0.2, i % 3 ? 0xe8c84a : 0xf2efe6));
}
// a soda fountain: on a counter, or on a stand of its own (cups beside it) with its back to a wall
function sodaFountain(K, x, z, { ry = 0, stand = false } = {}) {
  K.group(x, z, ry, () => {
    if (stand) {
      K.box(0, 0, 0, 1.3, 1.0, 0.56, 0xffffff, { slot: SLOT.accent }); K.box(0, 1.0, 0, 1.36, 0.03, 0.6, 0xd8d4cc);
      for (const dx of [-0.52, 0.52]) K.cyl(dx, 1.03, -0.08, 0.045, 0.3, 0xf4f1ea, { seg: 6 });
      K.shadow(0, -0.1, 1.5, 0.6);
    }
    K.box(0, 1.02, 0, 0.7, 0.6, 0.5, 0x2a2c30);
    for (let i = 0; i < 5; i++) { K.plane(-0.26 + i * 0.13, 1.47, -0.256, 0.1, 0.16, 'S', BRIGHTS[(i * 3) % BRIGHTS.length], { glow: 0.8 }); K.box(-0.26 + i * 0.13, 1.24, -0.29, 0.03, 0.08, 0.06, C.chrome); }
  });
}
// a burger big on the left wall
function burgerMural(K, z) {
  K.group(-H0 + 0.012, z, 0, () => {
    [[1.95, 0.24, 0xc8914e, 0.62], [1.75, 0.07, 0x4a8a3a, 0.72], [1.66, 0.07, 0xc0392b, 0.66], [1.57, 0.06, 0xf1c40f, 0.72], [1.44, 0.14, 0x5a3220, 0.68], [1.26, 0.16, 0xc8914e, 0.64]].forEach(([y, h, c, w], i) => K.plane(i * 0.002, y, 0, w * 2, h, 'E', c));
  });
}
function burger(K, v = 0) {
  K.shell({ skirting: 0x4a4a48 });
  if (v === 1) {
    // the counter and the kitchen down the right wall; tall tables with stools, a bar at the window; the soda
    // fountain to help yourself at on the back wall
    onRight(K, 3.3, () => {
      burgerLine(K, -1.8, 1.8, [-0.9, 0.7], { z: 3.75 });
      queue(K, -0.9, 1.02, 3.75); K.spot(0.7, 3.15, N, 'stand', { prio: 2 });
    });
    sodaFountain(K, -0.8, D0 - 0.3, { stand: true });
    bin(K, -2.3, D0 - 0.3, S);
    burgerMural(K, 3.4);
    highTop(K, -2.3, 2.7, 2, { top: 0xe6dfcf }); highTop(K, -0.6, 2.9, 3, { top: 0xe6dfcf, a0: 0.5 });
    windowBar(K, -1.3, 1.4, 4);
    for (const [x, z] of [[-1.6, 1.5], [-1.6, 3.0], [0.4, 1.5], [0.4, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
    return;
  }
  // the counter along the back, a soda fountain on its end; booths by the window; a burger big on the wall
  burgerLine(K, -2.2, 3.2, [-0.7, 1.3]);
  sodaFountain(K, 2.75, 4.0);
  burgerMural(K, 3.6);
  booth(K, 2.85, 1.75); booth(K, 0.85, 1.75);
  bin(K, -H0 + 0.3, 2.3, E);
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
  queue(K, -0.7); K.spot(1.3, 3.1, N, 'stand', { prio: 2 });
}

// the long deli case: meats and cheeses, salads, the till on top
function deliCase(K, x0, x1, tillX) {
  const mid = (x0 + x1) / 2, w = x1 - x0;
  K.group(0, 0, 0, () => {
    K.box(mid, 0, 3.95, w, 0.55, 0.72, 0xffffff, { slot: SLOT.accent }); K.box(mid, 0.55, 3.95, w + 0.04, 0.03, 0.76, 0xe6e2d8);
    K.box(mid, 1.25, 3.97, w + 0.04, 0.03, 0.72, 0xe6e2d8); K.plane(mid, 0.95, 4.3, w, 0.7, 'S', 0xf2efe6);
    for (const x of [x0 + 0.02, x0 + w / 3, x1 - w / 3, x1 - 0.02]) K.box(x, 0.58, 3.61, 0.025, 0.67, 0.025, C.chrome, { faces: 'fbrl' });
    K.plane(mid, 1.22, 3.95, w - 0.2, 0.5, 'D', 0xfff3dc, { glow: 0.9 });
  }, { stretch: true });
  const deli = [0xe8a0a0, 0xf1d27a, 0xb85a4a, 0xf4f1ea, 0xd9862a, 0x7ab02a, 0xe8c8a0, 0x8a3a2a];
  for (let i = 0; i < Math.floor((w - 0.2) / 0.4 + 0.01); i++) K.group(x0 + 0.3 + i * 0.4, 3.95, 0, () => {
    K.box(0, 0.58, 0, 0.34, 0.012, 0.5, 0x8a8f94);
    if (i % 3 === 2) K.box(0, 0.6, 0, 0.28, 0.08, 0.4, deli[(i * 3) % 8]);
    else for (const dz of [-0.14, 0.08]) K.cyl(0, 0.68, dz, 0.075, 0.2, deli[(i + (dz > 0 ? 3 : 0)) % 8], { seg: 8, rx: E, center: true });
  });
  till(K, tillX, 1.28, 3.98);
}
// behind it: a slicer and the bread on a long worktop
function breadBar(K, x0, x1) {
  const mid = (x0 + x1) / 2, w = x1 - x0;
  K.group(0, 0, 0, () => { K.box(mid, 0, D0 - 0.3, w, 0.9, 0.6, 0xd9d2c4); K.box(mid, 0.9, D0 - 0.3, w + 0.06, 0.03, 0.64, C.oak); }, { stretch: true });
  K.group(x0 + 0.8, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.45, 0.2, 0.4, 0xb4b8bc); K.cyl(0.05, 1.22, -0.05, 0.17, 0.02, 0xdfe2e4, { seg: 14, rz: E, center: true }); K.box(-0.1, 1.13, 0, 0.2, 0.2, 0.3, 0xb4b8bc); });
  K.group(x0 + 2.3, D0 - 0.3, 0, () => { for (let i = 0; i < Math.min(5, Math.floor((w - 2.4) / 0.26)); i++) K.sph(i * 0.26, 1.0, 0, 0.08, i % 2 ? 0xb8793a : 0xd9a860, { ws: 7, hs: 4, sx: 1.5, sy: 0.85 }); });
}
// crisps on a rack and drinks in a lit cooler, each with its back to a wall
function crispRack(K, x, z, ry) { K.group(x, z, ry, () => shelves(K, 1.0, 1.6, 0.26, 4, { frame: C.char, y0: 0.3, fill: (k, x0, x1, y, d) => { for (let bx = x0 + 0.08; bx < x1; bx += 0.17) k.box(bx, y, d - 0.08, 0.15, 0.22, 0.06, k.pick(BRIGHTS), { rx: -0.12 }); } })); }
function drinksCooler(K, x, z, ry) { K.group(x, z, ry, () => { K.box(0, 0, 0, 0.9, 1.95, 0.62, 0x2a2a2c); K.plane(0, 1.0, 0.315, 0.76, 1.7, 'N', 0xe6f2fa, { glow: 2 }); for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) K.plane(-0.3 + i * 0.12, 0.4 + r * 0.42, 0.32, 0.08, 0.26, 'N', BRIGHTS[(i + r * 5) % 12], { glow: 2 }); }); }
function sandwich(K, v = 0) {
  K.shell();
  const dark = { shade: 0x2a2a2c, r: 0.17 };
  if (v === 1) {
    // the deli case down the left wall past the door; the cooler and the crisps on the back wall; one long table to
    // share, tables for two down the right wall
    onLeft(K, 3.5, () => {
      deliCase(K, -1.6, 1.6, -1.1);
      breadBar(K, -1.7, 1.7);
      chalkboard(K, 0, 2.6, 2.3, 3);
      K.spot(0.5, 4.75, S, 'work', { role: 'staff' }); K.spot(-1.0, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
      K.spot(0.6, 3.1, N, 'lean', { prio: 1 }); K.spot(-1.1, 3.1, N, 'counter', { h: 1.2, prio: 2 });
      for (const x of [-0.9, 0.6]) pendant(K, x, 3.7, 2.15, dark);
    });
    drinksCooler(K, 0.2, D0 - 0.33, S);
    crispRack(K, 1.5, D0, S);
    longTable(K, 0.9, 2.3, 3, { top: C.oak });
    twoTop(K, 2.85, 1.5, { top: C.oak, alongZ: true }); twoTop(K, 2.85, 3.7, { top: C.oak, alongZ: true });
    pendant(K, 0.9, 2.3, 2.15, dark);
    ceilingPanel(K, 1.6, 3.8, 1.2, 0.5);
    return;
  }
  if (v === 2) {
    // a shorter case on the right of the back wall, the cooler and the crisps beside it; a banquette down the left
    // wall, tall tables in the window
    deliCase(K, 0, 3.2, 2.8);
    breadBar(K, -0.1, 3.3);
    chalkboard(K, 1.6, 2.6, 2.3, 3);
    K.spot(0.9, 4.75, S, 'work', { role: 'staff' }); K.spot(2.5, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
    drinksCooler(K, -2.9, D0 - 0.33, S);
    crispRack(K, -1.7, D0, S);
    onLeft(K, 3.1, () => banquette(K, -1.3, 1.3, 2, { top: C.oak, each: (x, z) => pendant(K, x, z, 2.15, dark) }));
    highTop(K, 0.5, 1.4, 3); highTop(K, 2.5, 1.4, 3, { a0: 1 });
    for (const x of [0.8, 2.4]) pendant(K, x, 3.7, 2.15, dark);
    ceilingPanel(K, 1.5, 1.6, 1.2, 0.5);
    K.spot(1.2, 3.05, N, 'lean', { prio: 1 }); K.spot(2.7, 3.05, N, 'counter', { h: 1.2, prio: 2 });
    return;
  }
  // the deli case right along the back; crisps and the cooler on the left wall; stools at the window, a couple of tables
  deliCase(K, -1.9, 3.1, 2.7);
  breadBar(K, -2.0, 3.2);
  chalkboard(K, 0.8, 3.4, 2.3, 4);
  K.spot(-0.3, 4.75, S, 'work', { role: 'staff' }); K.spot(2.4, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
  crispRack(K, -H0, 2.5, E);
  drinksCooler(K, -H0 + 0.33, 3.7, E);
  windowBar(K, 0.3, 3.2, 4);
  twoTop(K, 0.2, 2.2, { top: C.oak }); twoTop(K, 2.4, 2.3, { top: C.oak });
  for (const x of [-0.9, 0.6, 2.1]) pendant(K, x, 3.7, 2.15, dark);
  ceilingPanel(K, 0.8, 1.6, 1.2, 0.5);
  K.spot(0.9, 3.1, N, 'lean', { prio: 1 }); K.spot(2.6, 3.1, N, 'counter', { h: 1.2, prio: 2 });
}

// the chicken shop's line: the counter, the menu, the kitchen; on the counter the warmer (pieces golden under its
// lamps) and tubs stacked
function chickenLine(K, x0, x1, tills, warmerX, tubsX, how = {}) {
  const z = (how.z ?? 3.7) + 0.3;
  fastLine(K, x0, x1, { tills, food: [0xd9a03a, 0xc8914e, 0xb6382c, 0xe8d8a0], bar: 0xd98a12, ...how });
  K.group(warmerX, z, 0, () => {
    K.box(0, 1.02, 0, 1.0, 0.1, 0.5, 0x8a9094); K.box(0, 1.62, 0, 1.0, 0.08, 0.5, 0x8a9094); for (const sx of [-0.48, 0.48]) K.box(sx, 1.12, 0, 0.03, 0.5, 0.5, 0x8a9094);
    K.plane(0, 1.61, 0, 0.9, 0.44, 'D', 0xffb050, { glow: 1 });
    for (let i = 0; i < 12; i++) K.sph(-0.36 + (i % 6) * 0.145, 1.17 + Math.floor(i / 6) * 0.07, -0.08 + (i % 2) * 0.16, 0.065, i % 3 ? 0xc8862a : 0xb06a1c, { ws: 5, hs: 3, sy: 0.8, glow: 0.35 });
  });
  for (let i = 0; i < 5; i++) K.group(tubsX + (i % 3) * 0.26, z, 0, () => { const y = 1.02 + Math.floor(i / 3) * 0.2; K.cyl(0, y, 0, 0.09, 0.2, 0xf4f1ea, { seg: 8, r2: 0.12 }); K.cyl(0, y + 0.07, 0, 0.105, 0.06, 0xffffff, { seg: 8, r2: 0.113, open: true, slot: SLOT.accent }); });
}
function chicken(K, v = 0) {
  K.shell({ skirting: 0x4a4a48 });
  const plain = { top: 0xe6dfcf, frame: C.char, seat: 'accent' };
  if (v === 1) {
    // the counter and the kitchen down the left wall past the door; booths down the right wall, tables in the room
    onLeft(K, 3.6, () => {
      chickenLine(K, -1.6, 1.6, [-0.4, 0.3], 1.05, -1.4, { z: 3.75 });
      queue(K, -0.4, 1.02, 3.75); K.spot(0.3, 3.15, N, 'stand', { prio: 2 });
    });
    booth(K, 2.85, 1.55); booth(K, 2.85, 3.45);
    twoTop(K, 0.5, 1.3, plain); twoTop(K, 0.7, 4.0, plain);
    bin(K, 1.2, D0 - 0.3, S);
    K.group(0, 0, 0, () => K.plane(H0 - 0.012, 1.85, 2.5, 3.6, 0.5, 'W', 0xffffff, { slot: SLOT.accent }), { stretch: true });
    for (const [x, z] of [[-0.6, 1.5], [1.6, 1.5], [-0.6, 3.2], [1.6, 3.2]]) ceilingPanel(K, x, z, 1.2, 0.6);
    return;
  }
  // the counter along the back; a booth and tables; a stripe of the shop's color along the left wall
  chickenLine(K, -2.2, 3.2, [-0.7, 1.3], 2.5, -1.8);
  booth(K, 2.85, 1.75); twoTop(K, 0.9, 1.4, plain); twoTop(K, 0.5, 2.7, plain);
  K.group(0, 0, 0, () => K.plane(-H0 + 0.012, 1.75, 4.0, 2.6, 0.5, 'E', 0xffffff, { slot: SLOT.accent }), { stretch: true });
  bin(K, -H0 + 0.3, 2.3, E);
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
  queue(K, -0.7); K.spot(1.3, 3.1, N, 'stand', { prio: 2 });
}

// a deep booth's table under its cloth, and one of its leather benches
const STEAK = { cloth: 0xefeae0, wood: 0x2a1a12 };
function steakTable(K, x, z) {
  K.group(x, z, 0, () => {
    K.box(0, 0.71, 0, 1.2, 0.04, 0.7, STEAK.cloth); K.box(0, 0.5, 0, 1.2, 0.21, 0.7, STEAK.cloth, { faces: 'fbrl', k: 0.86 }); K.cyl(0, 0, 0, 0.06, 0.7, C.char, { seg: 6 });
    K.cyl(0, 0.75, 0, 0.03, 0.07, 0x8a2a22, { seg: 6 }); K.sph(0, 0.845, 0, 0.022, 0xffd27a, { glow: 1, ws: 5, hs: 3, sy: 1.5 });
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.18, 0.18]) K.cyl(dx, 0.752, dz, 0.11, 0.012, 0xf4f1ea, { seg: 10 });
  });
}
const steakBench = (K, x, z, ry, seats) => unit(K, x, z, ry, () => { bench(K, 1.3, { slot: SLOT.accent, col: 0xffffff, depth: 0.5, back: 1.3 }); for (const dx of seats) K.spot(dx, 0.2, 0, 'sit', sitAt()); });
// a hearth against a wall, the fire in it
function hearth(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.8, 1.5, 0.4, 0x6a625a); K.box(0, 1.5, -0.03, 2.0, 0.1, 0.5, STEAK.wood);
    K.plane(0, 0.55, -0.204, 1.0, 0.8, 'S', 0x0e0806); K.plane(0, 0.4, -0.21, 0.7, 0.4, 'S', 0xff7a2a, { glow: 1.2 }); K.plane(0, 0.32, -0.214, 0.4, 0.2, 'S', 0xffd27a, { glow: 1.4 });
    for (let i = 0; i < 3; i++) K.cyl(-0.25 + i * 0.25, 0.2, -0.24, 0.05, 0.6, STEAK.wood, { seg: 5, rz: E, center: true });
  });
}
// a lit cabinet of bottles on the back wall, `w` wide
function bottleCabinet(K, x, w) {
  const how = w > 2 ? { stretch: true } : {};
  K.group(x, D0, S, () => shelves(K, w, 2.2, 0.26, 4, { frame: STEAK.wood, back: 0xffb866, y0: 0.9, fill: (k, x0, x1, y, d) => bottleRow(k, x0 + 0.05, x1 - 0.05, y, d - 0.1, { step: 0.1, h: 0.3, palette: BOTTLES }) }), how);
  K.group(x, D0 - 0.25, 0, () => { K.box(0, 0, 0, w, 0.9, 0.5, STEAK.wood); }, how);
}
// a picture under its own lamp on the left wall (side -1) or the right
function litPicture(K, z, side, y = 1.75) {
  picture(K, side * H0, y, z, 0.9, 0.7, side < 0 ? 'E' : 'W', { frame: 0xa98a3a, rnd: K.rand });
  K.group(side * (H0 - 0.08), z, 0, () => { K.box(0, y + 0.43, 0, 0.1, 0.03, 0.4, C.brass); K.plane(-side * 0.02, y + 0.42, 0, 0.06, 0.36, 'D', C.bulb, { glow: 1 }); });
}
// a dark bar with a brass rail, `n` stools, a glass before each
function steakBar(K, x0, x1, z, n) {
  counter(K, x0, x1, z, 0.65, 1.08, { front: STEAK.wood, top: 0x4a2a1c, kick: C.black });
  K.group(0, 0, 0, () => K.box((x0 + x1) / 2, 0.18, z - 0.07, x1 - x0 - 0.2, 0.03, 0.03, C.brass), { stretch: true });
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.6 + i * (x1 - x0 - 1.2) / (n - 1);
    stool(K, x, z - 0.45, 0.78, { col: C.brass, seat: 0x5a1c1c, spot: { pose: 'bar', h: 0.78, table: true, prio: i === 1 ? 1 : 4 } });
    K.group(x, z + 0.15, 0, () => K.cyl(0, 1.08, 0, 0.035, 0.1, 0xd9a05a, { seg: 6, r2: 0.045 }));
  }
}
function steakhouse(K, v = 0) {
  K.shell({ skirting: 0x120a08 });
  const cloth = STEAK.cloth, dark = { cloth, frame: STEAK.wood, seat: 'accent' }, lamp = (x, z) => pendant(K, x, z, 1.95, { shade: 0x2a1410, r: 0.16, glow: 0xffb866 });
  const host = { wood: STEAK.wood, top: 0x4a2a1c, lamp: true };
  if (v === 1) {
    // a bar along the back, the bottles lit behind it; the hearth in the left wall, two armchairs by it; a deep booth
    // and a table for four by the window
    hostStand(K, -1.5, 1.2, host);
    steakBar(K, -0.4, 3.2, 3.9, 4);
    bottleCabinet(K, 1.4, 3.2);
    K.spot(1.2, 4.82, S, 'counter', { role: 'staff', h: 1.08, roam: 0.6 });
    hearth(K, -H0 + 0.2, 3.7, W);
    armchair(K, -2.1, 2.8, -PI / 4, { spot: { prio: 4 } }); armchair(K, -2.1, 4.6, -PI * 3 / 4, { spot: { prio: 6 } });
    tableRound(K, -2.4, 3.7, 0.24, 0.5, { top: STEAK.wood, leg: C.brass });
    steakTable(K, 2.75, 1.55); steakBench(K, 2.75, 0.8, N, [-0.3, 0.3]); steakBench(K, 2.75, 2.3, S, [-0.3, 0.3]);
    fourTop(K, 0.3, 1.7, dark);
    for (const [x, z] of [[2.75, 1.55], [0.3, 1.7], [0.6, 3.9], [1.8, 3.9], [3.0, 3.9]]) lamp(x, z);
    litPicture(K, 3.1, 1); litPicture(K, 3.7, -1, 2.2);
    K.spot(-0.9, 3.2, E, 'stand', { role: 'staff', roam: 0.3 });
    return;
  }
  // deep booths down the right wall, tables under cloths in the room
  for (const z of [1.5, 3.1, 4.7]) steakTable(K, 2.75, z);
  steakBench(K, 2.75, 0.75, N, [-0.3]); steakBench(K, 2.75, 2.3, S, [-0.3, 0.3]); steakBench(K, 2.75, 3.9, S, [-0.3, 0.3]); steakBench(K, 2.75, 5.2, S, [0]);
  fourTop(K, -0.3, 2.0, dark); fourTop(K, 0.3, 4.1, dark);
  for (const [x, z] of [[2.75, 1.5], [2.75, 3.1], [-0.3, 2.0], [0.3, 4.1]]) lamp(x, z);
  // a hearth in the back wall, a lit cabinet of bottles, pictures under their own lamps
  hearth(K, -1.5, D0 - 0.2);
  bottleCabinet(K, 1.0, 1.6);
  for (const z of [2.4, 3.8]) litPicture(K, z, -1);
  hostStand(K, -1.5, 1.2, host);
  K.spot(1.3, 2.9, E, 'stand', { role: 'staff', roam: 0.4 });
}

// the raw bar: shellfish on a bed of ice, lemons; `n` stools
function rawBar(K, x0, x1, z, n) {
  const mid = (x0 + x1) / 2, w = x1 - x0 - 0.4, per = Math.round(w / 0.43);
  counter(K, x0, x1, z, 0.7, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xd8dcd8 });
  K.group(0, 0, 0, () => { K.box(mid, 1.02, z + 0.32, w, 0.14, 0.5, 0xe6f2f6, { rx: -0.12 }); K.box(mid, 1.02, z + 0.58, w + 0.1, 0.2, 0.04, C.chrome); }, { stretch: true });
  for (let i = 0; i < per * 2; i++) K.group(x0 + 0.4 + (i % per) * 0.43, z + 0.2 + Math.floor(i / per) * 0.22, 0, () => {
    const y = 1.17 + Math.floor(i / per) * 0.03;
    if (i % 5 === 0) K.sph(0, y + 0.03, 0, 0.045, 0xf1c40f, { ws: 5, hs: 3 });
    else if (i % 5 === 3) { K.box(0, y, 0, 0.22, 0.05, 0.09, 0xc0392b, { ry: 0.5 }); K.box(0.1, y, 0.06, 0.1, 0.04, 0.04, 0xc0392b); }
    else { K.cyl(0, y, 0, 0.06, 0.02, 0x8a8f8c, { seg: 7, sz: 0.75 }); K.cyl(0, y + 0.018, 0, 0.045, 0.006, 0xe8e0d0, { seg: 7, sz: 0.75 }); }
  });
  for (let i = 0; i < n; i++) stool(K, x0 + 0.7 + i * 0.8, z - 0.45, 0.76, { seat: 0xd8dcd8, spot: { pose: 'bar', h: 0.76, table: true, prio: i === 1 ? 1 : 4 } });
}
// a ship's lantern over a table; a round mirror like a porthole on the back wall; a rope looped along it from x0
const shipLamp = (K, x, z) => K.group(x, z, 0, () => { K.box(0, 2.25, 0, 0.01, HT - 2.25, 0.01, C.black, { faces: 'fbrl' }); K.cyl(0, 2.0, 0, 0.1, 0.22, 0xffe6b0, { seg: 8, glow: 1 }); K.cyl(0, 2.22, 0, 0.13, 0.04, C.brass, { seg: 8, r2: 0.05 }); K.cyl(0, 1.97, 0, 0.12, 0.03, C.brass, { seg: 8 }); });
const porthole = (K, x) => K.group(x, D0 - 0.02, 0, () => { K.cyl(0, 1.75, 0, 0.3, 0.04, C.brass, { seg: 16, rx: E, center: true }); K.cyl(0, 1.75, -0.012, 0.24, 0.04, 0xcfe4ea, { seg: 16, rx: E, center: true, glow: 0.4 }); });
function wallRope(K, x0, n) {
  K.group(0, 0, 0, () => { for (let i = 0; i < n; i++) { const a = x0 + i * 0.42, y = (t) => 2.45 - Math.sin(t * PI) * 0.1; K.rod(a, y(0), D0 - 0.04, a + 0.21, y(0.5), D0 - 0.04, 0.02, 0xc9b48a); K.rod(a + 0.21, y(0.5), D0 - 0.04, a + 0.42, y(1), D0 - 0.04, 0.02, 0xc9b48a); } }, { stretch: true });
}
function seafood(K, v = 0) {
  K.shell({ skirting: 0x2a3f4a });
  const white = { cloth: 0xf4f1ea, seat: 'accent' }, sea = { frame: 0xf4f1ea, art: [0x9ac4d8, 0x1c4a6a, 0xf4f1ea], rnd: K.rand };
  onLeft(K, 0, () => wallRope(K, 1.9, 8));
  if (v === 1) {
    // the raw bar down the right wall, the catch chalked up over it; tables for two down the left wall, more in the
    // room; the portholes on the back wall
    onRight(K, 3.2, () => {
      rawBar(K, -1.7, 1.7, 3.8, 4);
      chalkboard(K, 0, 2.6, 2.3, 2);
      K.spot(0, 4.9, S, 'work', { role: 'staff' });
    });
    for (const x of [-1.6, -0.4, 0.8]) porthole(K, x);
    fourTop(K, -0.6, 1.9, { ...white, centre: 'vase' });
    twoTop(K, -2.75, 2.7, { ...white, alongZ: true, centre: 'candle' }); twoTop(K, -2.75, 4.5, { ...white, alongZ: true, centre: 'candle' });
    twoTop(K, -0.4, 4.2, { ...white, centre: 'candle' });
    for (const [x, z] of [[-0.6, 1.9], [-2.75, 2.7], [-2.75, 4.5], [-0.4, 4.2]]) shipLamp(K, x, z);
    picture(K, -H0, 1.6, 3.6, 0.9, 0.6, 'E', sea);
    K.spot(-1.5, 3.3, S, 'stand', { role: 'staff', roam: 0.3 });
    return;
  }
  // the raw bar at the back on the right, the day's catch chalked up behind; tables under cloths; portholes down the
  // right wall
  rawBar(K, -0.6, 3.2, 3.8, 4);
  chalkboard(K, 1.3, 2.6, 2.3, 2);
  K.spot(1.3, 4.9, S, 'work', { role: 'staff' });
  fourTop(K, -0.4, 1.9, { ...white, centre: 'vase' }); twoTop(K, 2.5, 1.4, { ...white, alongZ: true, centre: 'candle' });
  twoTop(K, -2.1, 3.8, { ...white, alongZ: true, centre: 'candle' });
  for (const [x, z] of [[-0.4, 1.9], [2.5, 1.4], [-2.1, 3.8]]) shipLamp(K, x, z);
  onRight(K, 0, () => { for (const z of [2.2, 3.4, 4.6]) porthole(K, -z); });
  picture(K, -H0, 1.6, 2.6, 1.1, 0.7, 'E', sea);
  K.spot(-1.2, 3.0, S, 'stand', { role: 'staff', roam: 0.4 });
}

// a picnic table: planks, a bench either side, a roll of paper and the sauces on it (turned by `ry`)
function picnicTable(K, x, z, ry = 0) {
  unit(K, x, z, ry, () => {
    for (let i = 0; i < 4; i++) K.box(0, 0.72, -0.3 + i * 0.2, 1.7, 0.04, 0.18, i % 2 ? 0xa9824f : 0xb89060);
    for (const sx of [-0.7, 0.7]) { K.rod(sx, 0.03, -0.55, sx, 0.72, 0.2, 0.03, 0x7a5a3c); K.rod(sx, 0.03, 0.55, sx, 0.72, -0.2, 0.03, 0x7a5a3c); K.box(sx, 0.4, 0, 0.05, 0.05, 1.5, 0x7a5a3c); }
    for (const sz of [-0.66, 0.66]) { K.box(0, 0.42, sz, 1.7, 0.04, 0.24, 0xa9824f); }
    K.cyl(-0.55, 0.82, 0, 0.06, 0.24, 0xf4f1ea, { seg: 8, rz: E, center: true });
    bottle(K, 0.5, 0.76, -0.06, 0.2, 0xb0291f); bottle(K, 0.6, 0.76, 0.06, 0.2, 0xd9a227);
    K.box(0, 0.762, 0.05, 0.4, 0.012, 0.3, 0xc9a06a); K.box(0, 0.775, 0.05, 0.2, 0.05, 0.14, 0x5a2a1a);
    K.shadow(0, 0, 2.0, 1.8, 0.62);
    for (const [dx, dz, r] of [[-0.4, -0.66, N], [0.4, -0.66, N], [-0.4, 0.66, S], [0.4, 0.66, S]]) K.spot(dx, dz, r, 'sit', sitAt({ h: 0.45 }));
  });
}
// the smoker's doors, against a wall; a stack of split wood
function smoker(K, x, z, ry = 0) {
  K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.7, 2.3, 0.5, 0x1c1a1a); K.box(0, 2.3, 0.05, 0.3, HT - 2.3, 0.3, 0x1c1a1a);
    for (const y of [0.35, 1.3]) { K.box(0, y, -0.26, 1.4, 0.8, 0.04, 0x2a2826); K.box(0.55, y + 0.36, -0.3, 0.05, 0.1, 0.05, C.chrome); K.plane(0, y - 0.02, -0.285, 1.42, 0.02, 'S', 0xff6a1a, { glow: 1 }); }
    K.cyl(-0.4, 1.7, -0.29, 0.09, 0.02, 0xf4f1ea, { seg: 10, rx: E, center: true });
  });
}
function woodPile(K, x, z) { K.group(x, z, 0, () => { for (let r = 0; r < 5; r++) for (let i = 0; i < 4 - (r > 3 ? 1 : 0); i++) K.cyl(-0.3 + i * 0.2 + (r % 2) * 0.1, 0.09 + r * 0.17, 0, 0.09, 0.5, r % 2 ? 0x8a6a44 : 0x6a4a30, { seg: 6, rx: E, center: true }); }); }
// where you order: a counter under butcher's paper, a tray being made up on it; whoever cuts the meat behind
function smokeCounter(K, x0, x1, z, tillX, trayX) {
  serviceCounter(K, { x0, x1, z, tills: [tillX], front: 0x7a5232, slot: 0, top: 0xc9a06a });
  K.group(trayX, z + 0.3, 0, () => { K.box(0, 1.02, 0, 0.5, 0.012, 0.4, 0xb4b8bc); K.box(0, 1.03, 0, 0.3, 0.07, 0.16, 0x5a2a1a); K.box(0.15, 1.03, 0.1, 0.12, 0.04, 0.1, 0xe8c84a); });
  K.spot(trayX, z + 0.95, S, 'work', { role: 'staff' });
  K.spot(tillX, z - 0.58, N, 'counter', { h: 1.02, prio: 1 });
}
// the menu on three boards on the back wall
const menuPlanks = (K, x) => K.group(x, D0, 0, () => { for (let i = 0; i < 3; i++) { K.plane(-0.9 + i * 0.9, 2.2, -0.02, 0.8, 1.0, 'S', 0x3a2a1c); writing(K, -0.9 + i * 0.9, 2.2, -0.026, 0.7, 0.9, 'S', { rows: 6, col: 0xf6e2b8 }); } });
// a string of bulbs across the room at depth `t` (or down it, at x = t)
function bulbs(K, t, alongZ = false) {
  K.group(0, 0, 0, () => {
    if (alongZ) { K.rod(t, 2.7, 0, t, 2.7, D0, 0.006, 0x1c1c1c); for (let i = 0; i < 9; i++) K.sph(t, 2.64, 0.4 + i * 0.58, 0.045, 0xffd98a, { glow: 1, ws: 5, hs: 3 }); }
    else { K.rod(-H0, 2.7, t, H0, 2.7, t, 0.006, 0x1c1c1c); for (let i = 0; i < 12; i++) K.sph(-3.2 + i * 0.58, 2.64, t, 0.045, 0xffd98a, { glow: 1, ws: 5, hs: 3 }); }
  }, { stretch: true });
}
function barbecue(K, v = 0) {
  K.shell({ skirting: 0x2a1c14 });
  const sign = (z) => K.group(H0 - 0.012, z, 0, () => { K.plane(0, 1.9, 0, 1.2, 0.5, 'W', 0x2a1c14); K.plane(-0.006, 1.9, 0, 1.0, 0.1, 'W', 0xf6e2b8); });
  if (v === 1) {
    // where you order down the left wall past the door, the menu over it; the smoker in the back wall on the right;
    // picnic tables end on to the window, one more across the back
    onLeft(K, 3.6, () => { smokeCounter(K, -1.5, 1.5, 4.1, -0.8, 0.6); menuPlanks(K, 0); });
    smoker(K, 2.3, D0 - 0.25);
    woodPile(K, -0.9, D0 - 0.35);
    picnicTable(K, -0.1, 1.9, E); picnicTable(K, 2.1, 1.9, E); picnicTable(K, 0.6, 3.9);
    bulbs(K, -0.1, true); bulbs(K, 2.1, true);
    sign(3.3);
    return;
  }
  // picnic tables; the smoker's door in the back wall, a stack of split wood beside it; where you order on the right
  picnicTable(K, 0.2, 1.6); picnicTable(K, 2.3, 2.3); picnicTable(K, -0.6, 3.5);
  smoker(K, -1.8, D0 - 0.25);
  woodPile(K, -3.0, D0 - 0.35);
  smokeCounter(K, 0.3, 3.2, 4.1, 2.5, 1.2);
  menuPlanks(K, 1.7);
  bulbs(K, 1.4); bulbs(K, 3.0);
  sign(2.4);
}

// how many layouts each has (shop-kits.js VARIANTS): its function is called with (K, v)
export const VARIANTS_C = { pizza: 3, mexican: 3, chinese: 3, japanese: 2, korean: 2, noodles: 3, indian: 2, mediterranean: 2, italian: 2, diner: 3,
  burger: 2, sandwich: 3, chicken: 2, steakhouse: 2, seafood: 2, barbecue: 2 };
export const KITS_C = { pizza, mexican, chinese, japanese, korean, noodles, indian, mediterranean, italian, diner, burger, sandwich, chicken, steakhouse, seafood, barbecue };
