import { Kit, H0, D0, HT, SLOT, C, BRIGHTS, MUTED, CLOTHES, BOTTLES, shadeHex, chair, stool, tableRound, tableSquare, pendant, ceilingPanel,
  trackSpots, picture, plant, till, monitor, counter, shelves, books, goods, bottle, bottleRow, bench, armchair, stanchion, rope, bike,
  mannequin, garments, strip, writing } from './shop-kit-core.js';
import { KITS_B } from './shop-kits-b.js';
import { KITS_C, STYLES_C } from './shop-kits-c.js';

// Lamp: the room behind each kind of business's glass, furnished (shop-kit-core.js has what they're built with and
// how a kit fits a room of any size; shop-interiors.js draws them and puts the people in). The door is at the front
// left (x < -1.9, z < 1.6 is kept clear for it); low things stand by the window, tall ones at the back and the sides.
// `spots` are where people are: the staff first, then the customers in the order the room fills up.

const PI = Math.PI, E = PI / 2, W = -PI / 2, S = PI, N = 0; // which way someone faces: N into the room, S the street
const sitAt = (o = {}) => ({ pose: 'sit', table: true, ...o });

// How each kind's room is finished: the floor (FLOORS) and walls (WALLS) drawn on its shell, and the few colors a
// business picks its own walls, floor and accent from (the first wall and floor are the painted far room's:
// shop-types.js LOOKS). `people` is how full it gets, [staff, customers at its busiest].
export const FLOORS = { wood: 0, checker: 1, tile: 2, carpet: 3, concrete: 4 };
export const WALLS = { plain: 0, brick: 1, wainscot: 2, panel: 3, band: 4 };
export const STYLES = {
  restaurant: { floor: 'wood', wall: 'wainscot', walls: [0x9a5238, 0x8a4038, 0xa86a3c, 0x7d4a3a, 0x93603f], floors: [0x4a3020, 0x5a3d28, 0x3a2a20], accents: [0x6a1f24, 0x1f3a34, 0x2c3350, 0x5a3a1c] },
  fast_food: { floor: 'checker', wall: 'band', walls: [0xd8d2c2, 0xe6dfcf, 0xcfd6d2], floors: [0x9a9286, 0xa69c8c], accents: [0xb6382c, 0xd9862a, 0x2a7a4a, 0x2a5aa6, 0xc9a227] },
  cafe: { floor: 'wood', wall: 'brick', walls: [0x8a6f52, 0xa8805c, 0x9a7a5a, 0x7a6a56], floors: [0x6a4a30, 0x7d5a3a, 0x4a3a2c], accents: [0x2f5a4a, 0x8a3a24, 0x2a3a52, 0xc9a227] },
  bakery: { floor: 'checker', wall: 'panel', walls: [0xe9dfcc, 0xf0d9d6, 0xd6e4dc, 0xf2e6b8], floors: [0xb0a28c, 0xa89a88], accents: [0xd98a9a, 0x7fb4a8, 0xe0b05a, 0x9ab0d8] },
  bar: { floor: 'wood', wall: 'brick', walls: [0x3a2a24, 0x2a2a30, 0x33291f, 0x2f3a36], floors: [0x241a14, 0x2c2018], accents: [0xff5aa0, 0x4ad8ff, 0xffa63a, 0x9a6aff, 0x5aff9a] },
  books: { floor: 'wood', wall: 'plain', walls: [0x5a4632, 0x4a5246, 0x6a5a48, 0x3f4a56], floors: [0x6e5238, 0x5a4632], accents: [0x7a2a2a, 0x2f4a3a, 0x2a3a5a, 0x8a6a2a] },
  apparel: { floor: 'wood', wall: 'plain', walls: [0xe6e2da, 0xd9d4c8, 0xcfd3d6, 0xe8ddd2], floors: [0xb09c80, 0x9a8e7c, 0xc0b49c], accents: [0x1c1c1e, 0x8a6a4a, 0x2c3e50, 0x6a2a34] },
  jewelry_gift: { floor: 'carpet', wall: 'plain', walls: [0x2c3140, 0x34304a, 0x26343f], floors: [0x4a4038, 0x3a3440], accents: [0x1a2238, 0x3a1a2a, 0x12302c, 0x2a2420] },
  grocery: { floor: 'tile', wall: 'band', walls: [0xdde3e2, 0xe6e4d6, 0xd6e2d8], floors: [0xb9b6a8, 0xc4c0b0], accents: [0x2a7a3a, 0xc0392b, 0x2a5aa6, 0xd9862a] },
  salon: { floor: 'wood', wall: 'plain', walls: [0xcfc4c4, 0xd8cfc0, 0xbfcac8, 0xd6c8cc], floors: [0x6a5a50, 0x8a7a66, 0x4a4440], accents: [0x1e1e22, 0x6a2a3a, 0x2a4a4a, 0x7a5a3a] },
  bank: { floor: 'tile', wall: 'wainscot', walls: [0xb9b6aa, 0xc6c2b2, 0xaab4b8], floors: [0x8a8a84, 0x9a968a], accents: [0x1d3f6f, 0x1f5a3a, 0x7a1f24, 0x3a3f4a] },
  medical: { floor: 'tile', wall: 'band', walls: [0xdfe6e4, 0xe4e2d8, 0xd6e2ea], floors: [0xa9b2ae, 0xb4b2a6], accents: [0x3d6f86, 0x4a8a6a, 0x5a6aa0, 0x8a6a8a] },
  bike_sports: { floor: 'concrete', wall: 'plain', walls: [0x9aa39f, 0xb0a898, 0x8a9098, 0xc4c0b4], floors: [0x7a7872, 0x86827a], accents: [0xb04a2a, 0x2a6a9a, 0xd9a227, 0x3a7a3a] },
  dispensary: { floor: 'concrete', wall: 'band', walls: [0xe4e6dd, 0xd8dcd2, 0xe8e4d8], floors: [0x8c8e86, 0x9a988e], accents: [0x4f9a55, 0x3a7a5a, 0x6aa04a] },
  gallery: { floor: 'concrete', wall: 'plain', walls: [0xf0eee8, 0xe9e7e2, 0xf2efe6], floors: [0x9a8a70, 0xa8a6a0, 0x8a7a64], accents: [0x1d1e21, 0xb0392b, 0x2a5aa6, 0xc9a227] },
  theatre: { floor: 'carpet', wall: 'wainscot', walls: [0x5c1f22, 0x4a1f2a, 0x5a2a1c], floors: [0x5a1c20, 0x3a2030], accents: [0xc9a227, 0xb0392b, 0xd9862a] },
  retail: { floor: 'wood', wall: 'plain', walls: [0xbdb5a6, 0xc9c0ac, 0xaab4b0, 0xd6cfc0], floors: [0x7a6a54, 0x8a7a64, 0x6a6258], accents: [0x2f4a5c, 0x7a2e2a, 0x4a5a3a, 0x8a6a3a] },
  service: { floor: 'carpet', wall: 'plain', walls: [0xc4c0b4, 0xb8c0c4, 0xcfc8b8], floors: [0x5c5f66, 0x6a6660, 0x4f5a5a], accents: [0x2a4a7a, 0x3a6a5a, 0x7a3a2a, 0x4a4a52] }
};

// ---------------------------------------------------------------------------------------------------------------------
function restaurant(K) {
  K.shell();
  const cloth = 0xefeae0;
  // a banquette along the right wall, two tables for two at it
  K.group(H0 - 0.3, 2.9, W, () => bench(K, 3.7, { slot: SLOT.accent, col: 0xffffff, depth: 0.55, back: 1.12 }), { stretch: true });
  for (const z of [1.75, 3.85]) {
    tableSquare(K, 2.5, z, 0.7, 0.72, { cloth, places: [[0.2, 0], [-0.2, 0]] });
    chair(K, 1.88, z, E, { frame: C.woodD, seat: 'accent', spot: sitAt() });
    K.spot(3.1, z, W, 'sit', sitAt({ h: 0.45 }));
    pendant(K, 2.5, z, 2.0, { shade: C.brass });
  }
  // two tables for four in the room
  for (const [tx, tz] of [[-0.35, 1.95], [-0.15, 4.0]]) {
    tableSquare(K, tx, tz, 0.9, 0.9, { cloth, places: [[0.27, 0], [-0.27, 0], [0, 0.27], [0, -0.27]], centre: tz < 3 ? 'candle' : 'vase' });
    chair(K, tx, tz - 0.66, N, { frame: C.woodD, seat: 'accent', spot: sitAt() });
    chair(K, tx, tz + 0.66, S, { frame: C.woodD, seat: 'accent', spot: sitAt() });
    chair(K, tx - 0.66, tz, E, { frame: C.woodD, seat: 'accent', spot: sitAt() });
    chair(K, tx + 0.66, tz, W, { frame: C.woodD, seat: 'accent', spot: sitAt() });
    pendant(K, tx, tz, 2.0, { shade: C.brass });
  }
  // the host's stand inside the door
  K.group(-1.5, 1.2, 0, () => {
    K.box(0, 0, 0, 0.5, 1.05, 0.38, C.woodD);
    K.box(0, 1.05, 0.02, 0.56, 0.04, 0.44, C.wood, { rx: 0.25 });
    K.box(0.05, 1.1, 0.02, 0.24, 0.02, 0.32, 0x5a1c20, { rx: 0.25 });
    K.sph(-0.2, 1.2, -0.1, 0.035, C.bulb, { glow: 1, ws: 5, hs: 3 });
    K.shadow(0, 0, 0.8, 0.7);
    K.spot(0, 0.55, S, 'counter', { role: 'staff', h: 1.02 });
  });
  // the back wall: the kitchen's door, a shelf of wine, the pass with the kitchen's light in it
  K.group(-2.6, D0, 0, () => {
    K.box(0, 0, -0.03, 1.0, 2.15, 0.06, C.woodD);
    K.plane(0, 1.04, -0.065, 0.84, 2.0, 'S', 0x5a3a26);
    K.cyl(0, 1.5, -0.07, 0.15, 0.01, 0xffdca0, { seg: 10, rx: E, center: true, glow: 0.7 });
  });
  K.group(-1.0, D0, S, () => shelves(K, 1.5, 2.1, 0.24, 4, { frame: C.woodD, back: 0x2a1a14, y0: 0.9,
    fill: (k, x0, x1, y, d) => bottleRow(k, x0 + 0.04, x1 - 0.04, y, d - 0.1, { step: 0.095, h: 0.3 }) }));
  K.group(-1.0, D0 - 0.25, 0, () => { K.box(0, 0, 0, 1.5, 0.9, 0.5, C.woodD); K.box(0, 0.9, 0, 1.56, 0.04, 0.54, C.wood); });
  K.group(1.6, D0, 0, () => {
    K.box(0, 1.0, -0.04, 2.6, 0.06, 0.3, 0x9aa0a4);
    K.plane(0, 1.5, -0.012, 2.4, 0.86, 'S', 0xffd9a0, { glow: 0.75 });
    K.plane(0, 1.3, -0.016, 2.4, 0.3, 'S', 0x9a7a52, { glow: 0.5 });
    K.box(0, 1.93, -0.03, 2.6, 0.1, 0.08, C.woodD);
    for (const x of [-0.8, 0, 0.8]) {
      K.cyl(x, 1.06, -0.12, 0.13, 0.015, 0xf4f1ea, { seg: 10 });
      K.cyl(x, 1.7, -0.1, 0.07, 0.1, C.steel, { seg: 6, r2: 0.03 });
      K.sph(x, 1.7, -0.1, 0.03, 0xffb060, { glow: 1, ws: 5, hs: 3 });
    }
  }, { stretch: true });
  // pictures and lamps along the left wall
  for (const [z, w, h] of [[2.3, 0.7, 0.9], [3.5, 1.0, 0.7], [4.75, 0.6, 0.8]]) picture(K, -H0, 1.65, z, w, h, 'E', { rnd: K.rand });
  for (const z of [2.9, 4.15]) K.group(-H0 + 0.07, z, 0, () => { K.box(0, 1.85, 0, 0.1, 0.06, 0.1, C.brass); K.sph(0.02, 1.98, 0, 0.07, C.bulb, { glow: 1, ws: 6, hs: 4 }); });
  K.spot(-1.3, 4.7, S, 'stand', { role: 'staff', roam: 0.5 });
}

function fast_food(K) {
  K.shell({ skirting: 0x4a4a48 });
  counter(K, -2.2, 3.2, 3.7, 0.7, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xd8d4cc, kick: 0x3a3a3a });
  for (const x of [-0.7, 1.3]) {
    till(K, x, 1.02, 3.98);
    K.box(x + 0.42, 1.02, 3.84, 0.1, 0.12, 0.14, C.char, { rx: -0.5 });
    K.spot(x, 4.6, S, 'counter', { role: 'staff', h: 1.02, roam: 0.25 });
  }
  // the menu overhead: lit boards with pictures and prices
  K.group(0, 0, 0, () => K.box(0.5, 2.3, 4.05, 5.5, 0.78, 0.26, 0x26262a), { stretch: true });
  const food = [0x9a5a2a, 0xc9a227, 0xb6382c, 0x4a8a3a, 0xd9862a, 0x7a4a2a];
  for (let i = 0; i < 4; i++) {
    K.group(-1.55 + i * 1.37, 3.915, 0, () => {
      K.plane(0, 2.69, 0, 1.27, 0.64, 'S', 0xfff1cf, { glow: 1 });
      K.cyl(-0.36, 2.76, -0.008, 0.17, 0.004, food[i], { seg: 10, rx: E, center: true, glow: 0.9 });
      K.cyl(-0.36, 2.76, -0.012, 0.1, 0.004, food[(i + 2) % 6], { seg: 8, rx: E, center: true, glow: 0.9 });
      K.plane(-0.36, 2.48, -0.008, 0.4, 0.07, 'S', 0xb6382c, { glow: 0.9 });
      for (let r = 0; r < 5; r++) {
        K.plane(0.2 + (K.rand() * 0.08), 2.9 - r * 0.105, -0.008, 0.5 + K.rand() * 0.16, 0.04, 'S', 0x3a2a20, { glow: 0.5 });
        K.plane(0.55, 2.9 - r * 0.105, -0.008, 0.09, 0.04, 'S', 0xb6382c, { glow: 0.9 });
      }
    });
  }
  // the kitchen along the back wall: steel counters, a hood, a pass with wrapped things under a lamp
  K.group(0, 0, 0, () => {
    K.box(0.5, 0, D0 - 0.3, 5.6, 0.9, 0.6, 0xa9aeb2);
    K.box(0.5, 0.9, D0 - 0.3, 5.7, 0.03, 0.64, 0xc8ccd0);
    K.box(0.5, 1.95, D0 - 0.32, 4.0, 0.34, 0.62, 0x9aa0a4);
    K.plane(0.5, 1.45, D0 - 0.012, 5.6, 0.95, 'S', 0xcfd4d4);
    K.plane(0.5, 1.93, D0 - 0.3, 3.6, 0.4, 'D', 0xffc880, { glow: 0.8 });
  }, { stretch: true });
  for (let i = 0; i < 9; i++) K.box(-1.4 + i * 0.42, 0.93, D0 - 0.36 + (i % 2) * 0.12, 0.2, 0.09, 0.2, i % 3 ? 0xe8c84a : 0xf2efe6);
  for (const x of [-2.0, 2.9]) K.group(x, D0 - 0.3, 0, () => { K.box(0, 0.93, 0, 0.5, 0.3, 0.45, 0x55595e); K.box(0, 1.23, 0, 0.42, 0.04, 0.38, 0x2a2a2c); });
  // the soda fountain at the end of the counter, cups beside it
  K.group(2.75, 4.0, 0, () => {
    K.box(0, 1.02, 0, 0.7, 0.6, 0.5, 0x2a2c30);
    for (let i = 0; i < 5; i++) {
      K.plane(-0.26 + i * 0.13, 1.47, -0.256, 0.1, 0.16, 'S', BRIGHTS[(i * 3) % BRIGHTS.length], { glow: 0.8 });
      K.box(-0.26 + i * 0.13, 1.24, -0.29, 0.03, 0.08, 0.06, C.chrome);
    }
    K.box(0, 1.03, -0.31, 0.66, 0.03, 0.14, C.chrome);
    for (const x of [-0.55, -0.68]) K.cyl(x, 1.02, 0.05, 0.045, 0.32, 0xf4f1ea, { seg: 6, r2: 0.055 });
  });
  // booths by the window: a fixed table between two benches
  for (const bx of [2.85, 0.85]) {
    K.group(bx, 1.75, 0, () => {
      K.box(0, 0.72, 0, 1.2, 0.04, 0.62, 0xe6dfcf);
      K.cyl(0, 0, 0, 0.06, 0.72, C.steel, { seg: 6 });
      K.box(0.2, 0.76, 0.05, 0.36, 0.015, 0.26, 0x8a5a3a);
      K.cyl(-0.3, 0.76, -0.1, 0.04, 0.13, 0xf4f1ea, { seg: 6, r2: 0.05 });
      K.box(0.22, 0.775, 0.05, 0.14, 0.06, 0.12, 0xe8c84a);
    });
    for (const [dz, ry] of [[-0.72, N], [0.72, S]]) {
      K.group(bx, 1.75 + dz, ry, () => {
        bench(K, 1.22, { slot: SLOT.accent, col: 0xffffff, depth: 0.46, back: 1.15 });
        K.spot(-0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
        K.spot(0.28, 0.05, 0, 'sit', sitAt({ h: 0.45 }));
      });
    }
  }
  // where the trays go
  K.group(-H0 + 0.3, 2.7, E, () => {
    K.box(0, 0, 0, 0.6, 1.1, 0.5, 0x6a5a48);
    K.plane(0, 0.85, 0.252, 0.4, 0.2, 'N', 0x2a2420);
    K.box(0, 1.1, 0, 0.5, 0.03, 0.4, 0x7a4a2a);
    K.shadow(0, 0.1, 0.8, 0.8);
  });
  K.group(0, 0, 0, () => K.plane(-H0 + 0.012, 1.75, 4.0, 2.6, 0.5, 'E', 0xffffff, { slot: SLOT.accent }), { stretch: true });
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);
  K.spot(-0.7, 3.15, N, 'counter', { h: 1.02 });
  K.spot(1.3, 3.1, N, 'stand');
  K.spot(-0.75, 2.4, N, 'stand');
}

function cafe(K) {
  K.shell();
  counter(K, -1.4, 3.15, 3.85, 0.65, 1.0, { front: 0x5a4330, top: 0xd8d0c0 });
  K.group(0, 0, 0, () => { for (let i = 0; i < 16; i++) K.box(-1.26 + i * 0.29, 0.12, 3.842, 0.2, 0.82, 0.012, 0x7a5a3c, { faces: 'b' }); }, { stretch: true });
  // the pastry case: glass shelves of things, chrome posts
  K.group(-0.72, 4.17, 0, () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.58, 1.0, sz * 0.27, 0.02, 0.5, 0.02, C.chrome, { faces: 'fbrl' });
    K.box(0, 1.5, 0, 1.2, 0.02, 0.58, 0xcfe0e0);
    K.box(0, 1.24, 0, 1.14, 0.012, 0.5, 0xcfe0e0);
    const sweets = [0xc8914e, 0xe2c08a, 0x7a4a2a, 0xe8a0b0, 0xf2e6c8, 0xa8c87a, 0xb0392b];
    for (const y of [1.0, 1.252]) {
      for (let i = 0; i < 6; i++) {
        const col = sweets[(i + (y > 1.1 ? 3 : 0)) % sweets.length];
        for (const dz of [-0.14, 0.02, 0.17]) {
          if (i % 2) K.cyl(-0.47 + i * 0.19, y, dz, 0.055, 0.05, col, { seg: 6 });
          else K.sph(-0.47 + i * 0.19, y + 0.03, dz, 0.06, col, { ws: 6, hs: 3, sy: 0.6, sx: 1.25 });
        }
      }
    }
  });
  till(K, 0.4, 1.0, 4.12);
  // the espresso machine, cups warming on top, and a grinder
  K.group(1.75, 4.17, 0, () => {
    K.box(0, 1.03, 0, 0.8, 0.36, 0.5, 0xc8ccd0);
    K.box(0, 1.0, 0, 0.84, 0.03, 0.54, 0x2a2a2c);
    K.plane(0, 1.21, -0.252, 0.8, 0.36, 'S', 0xffffff, { slot: SLOT.accent });
    K.plane(0, 1.21, -0.256, 0.5, 0.09, 'S', 0xe8e4da);
    K.box(0, 1.39, 0, 0.84, 0.025, 0.54, 0xdfe2e4);
    for (let i = 0; i < 8; i++) K.cyl(-0.3 + (i % 4) * 0.2, 1.415, -0.12 + Math.floor(i / 4) * 0.2, 0.04, 0.06, 0xf4f1ea, { seg: 6, r2: 0.05 });
    for (const x of [-0.2, 0.2]) { K.cyl(x, 1.1, 0.27, 0.035, 0.1, 0x55595e, { seg: 6 }); K.box(x, 1.07, 0.36, 0.03, 0.03, 0.16, 0x2a2a2c); }
  });
  K.group(2.65, 4.17, 0, () => {
    K.box(0, 1.0, 0, 0.2, 0.3, 0.28, 0x2a2a2c);
    K.cyl(0, 1.3, 0, 0.06, 0.2, 0x8a6a4a, { seg: 6, r2: 0.11 });
  });
  // behind: a chalkboard menu, a shelf of bags and mugs, the back counter
  K.group(0.85, D0, 0, () => {
    K.plane(0, 2.3, -0.02, 3.3, 1.05, 'S', C.woodD);
    K.plane(0, 2.3, -0.026, 3.18, 0.93, 'S', 0x1f2526);
    writing(K, 0, 2.3, -0.03, 3.0, 0.8, 'S', { rows: 6, cols: 3 });
  }, { anchor: [0.3, 1] });
  K.group(0.85, D0, S, () => shelves(K, 3.3, 0.5, 0.2, 1, { frame: C.wood, y0: 0.03, sides: false, fill: (k, x0, x1, y, d) => {
    for (let x = x0 + 0.1; x < x1 - 0.1; x += 0.17) {
      if (k.rand() < 0.45) k.cyl(x, y, d - 0.09, 0.045, 0.09, k.pick([0xf4f1ea, 0xf4f1ea, 0x2f5a4a, 0xd9862a]), { seg: 6 });
      else { const c = k.pick([0x6a4a30, 0x1c1c1e, 0xd9cfb8, 0x8a3a24]); k.box(x, y, d - 0.09, 0.12, 0.2, 0.08, c); k.plane(x, y + 0.11, d - 0.048, 0.08, 0.07, 'N', 0xf2efe6); }
    }
  } }), { y: 1.25, anchor: [0.3, 1] });
  K.group(0, 0, 0, () => { K.box(0.9, 0, D0 - 0.28, 4.4, 0.9, 0.56, 0x4a3828); K.box(0.9, 0.9, D0 - 0.28, 4.46, 0.03, 0.6, 0xd8d0c0); }, { stretch: true });
  bottleRow(K, -0.9, 0.3, 0.93, D0 - 0.3, { step: 0.11, h: 0.26, palette: [0xb8862a, 0x7a3a1a, 0xd9d2c0, 0x8a2a3a] });
  for (let i = 0; i < 4; i++) K.cyl(2.2 + i * 0.12, 0.93, D0 - 0.32, 0.045, 0.3, 0xf4f1ea, { seg: 6, r2: 0.055 });
  // things to buy along the left wall
  K.group(-H0, 3.1, E, () => shelves(K, 1.7, 1.9, 0.26, 4, { frame: C.wood, y0: 0.5, fill: goods([0x6a4a30, 0x1c1c1e, 0xd9cfb8, 0x8a3a24, 0x2f5a4a, 0xf4f1ea], { size: 0.16, tall: 0.24 }) }));
  picture(K, -H0, 1.7, 4.6, 0.7, 0.9, 'E', { rnd: K.rand });
  // little tables by the window
  const cup = (x, z) => { K.cyl(x, 0.74, z, 0.04, 0.07, 0xf4f1ea, { seg: 6, r2: 0.046 }); K.cyl(x, 0.805, z, 0.036, 0.004, 0x4a2c1a, { seg: 6 }); };
  const laptop = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 0.74, 0, 0.3, 0.014, 0.21, 0x9a9da0);
    K.box(0, 0.75, -0.11, 0.3, 0.2, 0.012, 0x9a9da0, { rx: -0.2 });
    K.plane(0, 0.855, -0.1, 0.27, 0.17, 'N', 0xcfe2f4, { glow: 0.6, ry: 0 });
  });
  tableRound(K, -0.45, 1.3, 0.33); cup(-0.57, 1.33); cup(-0.3, 1.22);
  chair(K, -1.02, 1.3, E, { spot: sitAt() }); chair(K, 0.12, 1.3, W, { spot: sitAt() });
  tableRound(K, 1.45, 1.75, 0.33); laptop(1.4, 1.8, N); cup(1.62, 1.6);
  chair(K, 1.45, 1.18, N, { spot: sitAt({ pose: 'type' }) }); chair(K, 1.45, 2.34, S, { spot: sitAt() });
  tableRound(K, 2.75, 1.0, 0.3); cup(2.7, 1.05);
  chair(K, 2.75, 0.44, N, { spot: sitAt() }); chair(K, 2.75, 1.56, S, { spot: sitAt() });
  for (const x of [-0.6, 0.9, 2.4]) pendant(K, x, 4.15, 2.05, { shade: C.brass, r: 0.15 });
  pendant(K, -0.45, 1.3, 2.1, { shade: 0x2a2a2c, r: 0.2 });
  pendant(K, 1.45, 1.75, 2.1, { shade: 0x2a2a2c, r: 0.2 });
  plant(K, 3.1, 2.4, 1.5);
  K.spot(1.75, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.55 });
  K.spot(0.4, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.2 });
  K.spot(0.4, 3.3, N, 'counter', { h: 1.0, prio: 1 });
  K.spot(-0.35, 3.0, N, 'stand', { prio: 6 });
}

function bakery(K) {
  K.shell({ skirting: 0x8a7a6a });
  // the long glass case
  K.group(0, 0, 0, () => {
    K.box(1.1, 0, 3.95, 4.1, 0.5, 0.72, 0xffffff, { slot: SLOT.accent });
    K.box(1.1, 0.5, 3.95, 4.14, 0.03, 0.76, 0xe6e2d8);
    K.box(1.1, 0.82, 4.0, 4.0, 0.012, 0.56, 0xcfe0e0);
    K.box(1.1, 1.3, 3.97, 4.14, 0.03, 0.72, 0xe6e2d8);
    K.plane(1.1, 0.9, 4.3, 4.1, 0.8, 'S', 0xf2efe6);
    for (const x of [-0.94, 0.42, 1.78, 3.14]) K.box(x, 0.53, 3.61, 0.025, 0.77, 0.025, C.chrome, { faces: 'fbrl' });
    K.plane(1.1, 1.27, 3.95, 3.9, 0.5, 'D', 0xfff3dc, { glow: 0.9 });
  }, { stretch: true });
  const kinds = [[0xc8914e, 0], [0xe8a0b0, 1], [0x7a4a2a, 1], [0xf2e6c8, 0], [0xa8c87a, 1], [0xb0392b, 1], [0xe2c08a, 0], [0xd9a05a, 1]];
  for (const y of [0.53, 0.832]) {
    for (let i = 0; i < 8; i++) {
      K.group(-0.65 + i * 0.5, 3.95, 0, () => {
        K.box(0, y, 0, 0.42, 0.012, 0.5, 0x8a8f94);
        const [col, round] = kinds[(i + (y > 0.6 ? 3 : 0)) % kinds.length];
        for (const dx of [-0.13, 0, 0.13]) for (const dz of [-0.16, 0, 0.16]) {
          if (round) { K.cyl(dx, y + 0.012, dz, 0.05, 0.05, col, { seg: 6 }); if (i % 3 === 0) K.cyl(dx, y + 0.062, dz, 0.035, 0.015, 0xf4f1ea, { seg: 6 }); }
          else K.sph(dx, y + 0.045, dz, 0.058, col, { ws: 6, hs: 3, sy: 0.65, sx: 1.2 });
        }
      });
    }
  }
  till(K, 2.75, 1.33, 3.98);
  K.group(-0.45, 3.95, 0, () => {
    K.cyl(0, 1.33, 0, 0.1, 0.012, 0xdfe2e4, { seg: 8 }); K.cyl(0, 1.34, 0, 0.02, 0.12, 0xdfe2e4, { seg: 5 }); K.cyl(0, 1.46, 0, 0.19, 0.012, 0xdfe2e4, { seg: 10 });
    K.cyl(0, 1.472, 0, 0.14, 0.11, 0xf6efe2, { seg: 10 }); K.cyl(0, 1.582, 0, 0.14, 0.012, 0xd98a9a, { seg: 10 });
    K.sph(0, 1.61, 0, 0.03, 0xb0392b, { ws: 5, hs: 3 });
  });
  // loaves on the shelves behind, baguettes in a basket
  K.group(1.15, D0, S, () => shelves(K, 4.2, 1.5, 0.3, 3, { frame: C.oak, y0: 0.05, sides: false, fill: (k, x0, x1, y, d, lvl) => {
    for (let x = x0 + 0.16; x < x1 - 0.1; x += 0.3 + k.rand() * 0.08) {
      if (k.rand() < 0.12) continue;
      const col = k.pick([0xb8793a, 0xc8914e, 0x9a6230, 0xd9a860, 0x8a5a2c]);
      if (lvl === 2 && k.rand() < 0.5) k.sph(x, y + 0.085, d - 0.15, 0.1, col, { ws: 7, hs: 4, sy: 0.85 });
      else k.sph(x, y + 0.07, d - 0.15, 0.085, col, { ws: 7, hs: 4, sx: 1.55, sy: 0.85 });
    }
  } }), { y: 1.05, stretch: true });
  K.group(0, 0, 0, () => { K.box(1.15, 0, D0 - 0.3, 4.3, 0.9, 0.6, 0xd9d2c4); K.box(1.15, 0.9, D0 - 0.3, 4.36, 0.03, 0.64, C.oak); }, { stretch: true });
  K.group(-0.6, D0 - 0.3, 0, () => {
    K.cyl(0, 0.93, 0, 0.14, 0.34, 0xb08a5a, { seg: 8, r2: 0.18, open: true });
    for (let i = 0; i < 6; i++) K.cyl(Math.cos(i * 1.05) * 0.07, 0.95, Math.sin(i * 1.05) * 0.07, 0.03, 0.62, 0xd9a860, { seg: 5, rz: Math.cos(i) * 0.1, rx: Math.sin(i) * 0.1 });
  });
  K.group(1.1, D0, 0, () => { K.plane(0, 2.82, -0.02, 2.6, 0.5, 'S', 0x2a2623); writing(K, 0, 2.82, -0.026, 2.4, 0.4, 'S', { rows: 3, cols: 3 }); }, { anchor: [0.4, 1] });
  // a baker's rack of trays at the back, on the door's side
  K.group(-2.5, 4.95, 0, () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.33, 0, sz * 0.24, 0.025, 1.8, 0.025, C.chrome, { faces: 'fbrl' });
    for (let i = 0; i < 6; i++) {
      K.box(0, 0.25 + i * 0.28, 0, 0.66, 0.015, 0.5, 0x8a8f94);
      if (i % 2 === 0 || i === 5) for (const dx of [-0.2, 0, 0.2]) K.sph(dx, 0.31 + i * 0.28, 0, 0.07, i % 4 ? 0xc8914e : 0xe2c08a, { ws: 6, hs: 3, sx: 1.2, sy: 0.7 });
    }
    K.shadow(0, 0, 0.9, 0.7);
  });
  // a table of things in the window: baskets of rolls, boxed cakes
  K.group(0.35, 1.3, 0, () => {
    K.box(0, 0.7, 0, 1.4, 0.05, 0.75, C.oak);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.62, 0, sz * 0.3, 0.05, 0.7, 0.05, C.oak, { faces: 'fbrl' });
    K.shadow(0, 0, 1.7, 1.0);
    for (const bx of [-0.45, 0.05]) {
      K.cyl(bx, 0.75, 0.1, 0.17, 0.12, 0xb08a5a, { seg: 8, r2: 0.21, open: true });
      for (let i = 0; i < 5; i++) K.sph(bx + Math.cos(i * 1.26) * 0.09, 0.86, 0.1 + Math.sin(i * 1.26) * 0.09, 0.065, i % 2 ? 0xc8914e : 0xd9a860, { ws: 6, hs: 3 });
    }
    for (const [bx, bz, col] of [[0.48, 0.12, 0xf0d9d6], [0.5, -0.17, 0xffffff], [-0.2, -0.2, 0xf2e6b8]]) {
      K.box(bx, 0.75, bz, 0.26, 0.12, 0.26, col); K.box(bx, 0.752, bz, 0.03, 0.125, 0.27, 0xd98a9a); K.box(bx, 0.752, bz, 0.27, 0.125, 0.03, 0xd98a9a);
    }
  });
  K.group(H0 - 0.27, 1.75, W, () => { bench(K, 1.5, { col: C.oak, depth: 0.42, back: 0.9 }); K.spot(-0.3, 0.05, 0, 'sit', { h: 0.45 }); K.spot(0.4, 0.05, 0, 'sit', { h: 0.45 }); });
  tableRound(K, 2.5, 1.75, 0.27, 0.7, { top: 0xe6e2d8 });
  for (const x of [-0.3, 1.1, 2.5]) pendant(K, x, 3.75, 2.1, { shade: 0xe9e6de, r: 0.2 });
  ceilingPanel(K, 0.3, 1.5, 1.2, 0.6);
  K.spot(1.0, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.6 });
  K.spot(2.6, 4.75, S, 'counter', { role: 'staff', h: 1.0, roam: 0.15 });
  K.spot(0.3, 3.1, N, 'lean', { prio: 1 });
  K.spot(1.9, 3.1, N, 'lean', { prio: 2 });
}

function bar(K) {
  K.shell({ skirting: 0x1a1412 });
  // the bar along the right wall, a brass rail at its foot
  counter(K, 0.9, 4.95, 1.95, 0.6, 1.08, { alongZ: true, front: 0x3a2416, top: 0x6a4424, kick: 0x120e0c });
  K.group(0, 0, 0, () => {
    K.rod(1.86, 0.18, 0.95, 1.86, 0.18, 4.9, 0.022, C.brass, { seg: 5 });
    // the back-bar: a cabinet, a wall of light, three shelves of bottles
    K.box(3.22, 0, 2.92, 0.56, 1.0, 4.1, 0x2c1c12);
    K.box(3.22, 1.0, 2.92, 0.6, 0.04, 4.14, 0x6a4424);
    K.plane(H0 - 0.015, 1.72, 2.92, 4.1, 1.3, 'W', 0xffffff, { slot: SLOT.accent, glow: 0.55 });
    for (const y of [1.3, 1.7, 2.1]) K.box(3.36, y, 2.92, 0.24, 0.025, 4.1, 0x1a1210);
    K.box(3.3, 2.42, 2.92, 0.4, 0.1, 4.2, 0x2c1c12);
    for (const y of [1.04, 1.325, 1.725, 2.125]) {
      for (let z = 1.0; z < 4.85; z += 0.105 * (0.9 + K.rand() * 0.3)) {
        if (K.rand() < 0.08) continue;
        bottle(K, 3.36, y, z, 0.27 + K.rand() * 0.09, K.pick(BOTTLES));
      }
    }
  }, { stretch: true });
  // the taps, and glasses along the bar
  K.group(2.25, 2.5, 0, () => {
    K.box(0, 1.08, 0, 0.09, 0.34, 0.55, C.chrome);
    K.box(-0.12, 1.08, 0, 0.18, 0.02, 0.6, 0x55595e);
    [0xc9a227, 0x2a5aa6, 0xb0392b, 0x2a7a4a].forEach((c, i) => { K.box(-0.07, 1.36, -0.2 + i * 0.133, 0.03, 0.2, 0.04, c, { rz: 0.25 }); K.box(-0.06, 1.3, -0.2 + i * 0.133, 0.04, 0.03, 0.03, C.chrome); });
  });
  for (const z of [1.3, 1.9, 3.3, 3.9, 4.5]) K.cyl(2.1 + (z % 0.3), 1.08, z, 0.035, 0.13, 0xd9c27a, { seg: 6, r2: 0.042 });
  for (const z of [1.4, 2.15, 3.0, 3.75, 4.5]) stool(K, 1.5, z, 0.78, { ry: E, seat: 0x5a2a1c, spot: { pose: 'bar', h: 0.78, table: true } });
  for (const z of [1.5, 2.9, 4.3]) pendant(K, 2.25, z, 2.15, { shade: 0x3a2416, r: 0.14, glow: 0xffc27a });
  // high tables
  tableRound(K, -1.0, 1.7, 0.3, 1.06, { top: 0x4a3020 });
  stool(K, -1.55, 1.7, 0.78, { ry: E, seat: 0x5a2a1c, spot: { pose: 'bar', h: 0.78, table: true } });
  stool(K, -0.45, 1.7, 0.78, { ry: W, seat: 0x5a2a1c, spot: { pose: 'bar', h: 0.78, table: true } });
  tableRound(K, -0.9, 3.75, 0.3, 1.06, { top: 0x4a3020 });
  for (const [x, z] of [[-1.1, 1.75], [-0.9, 1.6], [-0.95, 3.8], [-0.8, 3.65]]) K.cyl(x, 1.06, z, 0.035, 0.13, 0xd9c27a, { seg: 6, r2: 0.042 });
  pendant(K, -1.0, 1.7, 2.15, { shade: 0x3a2416, r: 0.14, glow: 0xffc27a });
  pendant(K, -0.9, 3.75, 2.15, { shade: 0x3a2416, r: 0.14, glow: 0xffc27a });
  // the game on, and a neon sign
  K.group(-1.2, D0, 0, () => {
    K.box(0, 1.75, -0.04, 1.6, 0.92, 0.07, 0x101012);
    K.plane(0, 2.21, -0.08, 1.5, 0.82, 'S', 0x3f8f4a, { glow: 0.8 });
    K.plane(0, 2.21, -0.084, 0.02, 0.82, 'S', 0xe8f0e8, { glow: 0.8 });
    K.plane(0, 2.21, -0.084, 0.3, 0.3, 'S', 0x5aa862, { glow: 0.8 });
    K.plane(0, 2.56, -0.084, 0.5, 0.07, 'S', 0x1c1c22, { glow: 0.5 });
  });
  K.group(1.0, D0 - 0.05, 0, () => {
    const o = { slot: SLOT.accent, glow: 1.5, seg: 5 }, r = 0.022;
    // a cocktail glass in tubes, a ring round it
    K.rod(-0.32, 2.3, 0, 0.32, 2.3, 0, r, 0xffffff, o); K.rod(-0.32, 2.3, 0, 0, 1.95, 0, r, 0xffffff, o); K.rod(0.32, 2.3, 0, 0, 1.95, 0, r, 0xffffff, o);
    K.rod(0, 1.95, 0, 0, 1.6, 0, r, 0xffffff, o); K.rod(-0.2, 1.6, 0, 0.2, 1.6, 0, r, 0xffffff, o);
    K.rod(0.1, 2.36, 0, 0.3, 2.56, 0, r, 0xfff2a0, { glow: 1.5, seg: 5 });
    K.sph(0.1, 2.2, 0, 0.05, 0xff5a4a, { glow: 1.5, ws: 6, hs: 4 });
    for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * PI * 2, a1 = (i + 1) / 12 * PI * 2;
      K.rod(Math.cos(a0) * 0.62, 2.08 + Math.sin(a0) * 0.62, 0.01, Math.cos(a1) * 0.62, 2.08 + Math.sin(a1) * 0.62, 0.01, r, 0x6ad8ff, { glow: 1.3, seg: 5 });
    }
    K.plane(0, 2.08, 0.03, 1.7, 1.6, 'S', 0xffffff, { slot: SLOT.accent, glow: 0.12 });
  });
  // a dartboard and pictures on the left wall
  K.group(-H0 + 0.03, 3.6, 0, () => {
    K.cyl(0, 1.7, 0, 0.25, 0.03, 0x1a1a1c, { seg: 14, rz: E, center: true });
    K.cyl(0.012, 1.7, 0, 0.19, 0.03, 0xd9cfb8, { seg: 14, rz: E, center: true });
    K.cyl(0.02, 1.7, 0, 0.12, 0.03, 0x1a1a1c, { seg: 12, rz: E, center: true });
    K.cyl(0.028, 1.7, 0, 0.035, 0.03, 0xb0392b, { seg: 8, rz: E, center: true });
  });
  picture(K, -H0, 1.7, 2.4, 0.8, 0.6, 'E', { rnd: K.rand });
  picture(K, -H0, 1.7, 4.7, 0.6, 0.8, 'E', { rnd: K.rand });
  K.spot(2.88, 2.6, W, 'counter', { role: 'staff', h: 1.08, roam: 0.9 });
  K.spot(-0.9, 3.15, N, 'drink');
  K.spot(-0.35, 3.85, W, 'drink');
}

function bookshop(K) {
  K.shell();
  const dark = 0x2a1e16, wood = 0x4a3323;
  const uprights = (w, h, d, n) => { for (let i = 1; i < n; i++) K.box(-w / 2 + (w * i) / n, 0, d / 2, 0.03, h, d, wood); };
  K.group(H0, 2.75, W, () => { shelves(K, 4.9, 2.5, 0.3, 6, { frame: wood, back: dark, fill: books }); uprights(4.9, 2.5, 0.3, 5); }, { stretch: true });
  K.group(-H0, 3.55, E, () => { shelves(K, 3.3, 2.5, 0.3, 6, { frame: wood, back: dark, fill: books }); uprights(3.3, 2.5, 0.3, 3); }, { stretch: true });
  K.group(0, D0, S, () => { shelves(K, 6.3, 2.5, 0.3, 6, { frame: wood, back: dark, fill: books }); uprights(6.3, 2.5, 0.3, 6); }, { stretch: true });
  K.group(0, 0, 0, () => K.box(0, 2.5, D0 - 0.15, 6.4, 0.08, 0.34, wood), { stretch: true });
  // a low case across the room, books both sides, a few face out along its top
  for (const ry of [S, N]) K.group(0.7, 3.3, ry, () => shelves(K, 2.7, 1.4, 0.26, 3, { frame: wood, back: dark, fill: books }));
  K.group(0.7, 3.3, 0, () => {
    for (let i = 0; i < 6; i++) {
      const c = K.pick(BRIGHTS);
      K.box(-1.1 + i * 0.44, 1.41, 0, 0.2, 0.28, 0.03, c, { rx: i % 2 ? 0.2 : -0.2 });
    }
    K.shadow(0, 0, 3.0, 1.0);
  });
  // the front table, piled
  K.group(0.45, 1.3, 0, () => {
    K.box(0, 0.66, 0, 1.55, 0.06, 0.85, wood);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.68, 0, sz * 0.34, 0.07, 0.66, 0.07, wood, { faces: 'fbrl' });
    K.shadow(0, 0, 1.9, 1.15);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const n = 2 + Math.floor(K.rand() * 4), tw = K.rand() * 0.5;
      for (let k = 0; k < n; k++) K.box(-0.6 + i * 0.3, 0.72 + k * 0.04, -0.2 + j * 0.4, 0.2, 0.038, 0.27, K.pick(K.rand() < 0.5 ? BRIGHTS : MUTED), { ry: tw + (K.rand() - 0.5) * 0.3 });
    }
    for (const x of [-0.45, 0.15, 0.6]) K.box(x, 0.74, 0, 0.19, 0.27, 0.025, K.pick(BRIGHTS), { rx: 0.25 });
  });
  // a chair to read in, a lamp, a rug
  K.group(2.45, 1.25, 0, () => K.plane(0, 0.008, 0, 1.9, 1.7, 'U', 0xffffff, { slot: SLOT.accent, k: 0.8 }));
  armchair(K, 2.55, 1.2, -2.2, { spot: { pose: 'read' } });
  K.group(3.1, 0.55, 0, () => {
    K.cyl(0, 0, 0, 0.15, 0.025, C.brass, { seg: 8 }); K.cyl(0, 0.02, 0, 0.015, 1.45, C.brass, { seg: 5, open: true });
    K.cyl(0, 1.42, 0, 0.2, 0.26, 0xf2dcae, { seg: 10, r2: 0.13, open: true, glow: 0.9 });
  });
  // a ladder on the back shelves
  K.group(-1.6, 4.72, 0, () => {
    for (const x of [-0.24, 0.24]) K.rod(x, 0, 0, x, 2.5, 0.45, 0.025, C.oak);
    for (let i = 1; i < 8; i++) K.rod(-0.24, i * 0.3, i * 0.054, 0.24, i * 0.3, i * 0.054, 0.018, C.oak);
  });
  // the desk
  K.group(-2.35, 4.35, 0, () => {
    K.box(0, 0, 0, 1.3, 0.98, 0.5, wood); K.box(0, 0.98, 0, 1.38, 0.04, 0.58, C.oak);
    for (let k = 0; k < 4; k++) K.box(0.4, 1.02 + k * 0.04, 0, 0.2, 0.038, 0.27, K.pick(MUTED), { ry: k * 0.2 });
    K.shadow(0, 0, 1.6, 0.9);
  });
  till(K, -2.6, 1.02, 4.4);
  for (const [x, z] of [[0.45, 1.3], [-1.2, 2.6]]) pendant(K, x, z, 2.15, { shade: 0x2f5a3a, r: 0.2 });
  ceilingPanel(K, 1.6, 4.2, 1.2, 0.5); ceilingPanel(K, -1.4, 4.2, 1.2, 0.5); ceilingPanel(K, 2.0, 2.2, 1.2, 0.5);
  K.spot(-2.3, 4.95, S, 'counter', { role: 'staff', h: 1.0, roam: 0.2 });
  K.spot(2.82, 3.3, E, 'browse');
  K.spot(-0.5, 1.3, E, 'lean');
  K.spot(0.3, 2.62, N, 'browse');
  K.spot(1.7, 4.82, N, 'browse');
  K.spot(-2.85, 3.0, W, 'browse');
}

// a plain shop: shelves round the walls, tables of things, a counter
function retail(K) {
  K.shell();
  const stock = goods(BRIGHTS.concat(MUTED), { size: 0.2, tall: 0.28 });
  K.group(H0, 2.75, W, () => shelves(K, 4.8, 2.1, 0.32, 5, { frame: 0x8a8376, back: 0xa9a294, fill: stock }), { stretch: true });
  K.group(-H0, 3.7, E, () => shelves(K, 3.0, 2.1, 0.32, 5, { frame: 0x8a8376, back: 0xa9a294, fill: stock }), { stretch: true });
  K.group(-1.2, D0, S, () => shelves(K, 3.6, 2.1, 0.32, 5, { frame: 0x8a8376, back: 0xa9a294, fill: stock }), { stretch: true });
  for (const [x, z, w] of [[0.5, 1.35, 1.5], [-0.3, 3.1, 1.3]]) {
    K.group(x, z, 0, () => {
      K.box(0, 0, 0, w - 0.2, 0.4, 0.6, 0x6a655c);
      K.box(0, 0.74, 0, w, 0.05, 0.8, C.oak);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * (w / 2 - 0.06), 0, sz * 0.33, 0.05, 0.74, 0.05, C.oak, { faces: 'fbrl' });
      K.shadow(0, 0, w + 0.3, 1.1);
      stock(K, -w / 2 + 0.08, w / 2 - 0.08, 0.79, 0.3, 0, 0.3);
      K.group(0, 0, S, () => stock(K, -w / 2 + 0.08, w / 2 - 0.08, 0.79, 0.3, 0, 0.3));
    });
  }
  counter(K, 1.3, 3.1, 4.3, 0.6, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak });
  till(K, 2.5, 1.0, 4.6);
  for (const [x, z] of [[-1.5, 1.8], [1.5, 1.8], [-1.5, 3.8], [1.5, 3.8]]) ceilingPanel(K, x, z, 1.2, 0.5);
  K.spot(2.3, 5.05, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
  K.spot(2.8, 2.6, E, 'browse');
  K.spot(0.5, 2.0, S, 'lean');
  K.spot(-2.8, 3.4, W, 'browse');
  K.spot(1.9, 3.75, N, 'counter', { h: 1.0 });
}

const KITS = { restaurant, fast_food, cafe, bakery, bar, books: bookshop, retail, ...KITS_B };
// (and the kinds of restaurant, shop-kits-c.js: 'c_pizza' and the rest)
for (const name in KITS_C) { KITS['c_' + name] = KITS_C[name]; STYLES['c_' + name] = STYLES_C[name]; }
const built = new Map();
// a kind's kit: { geometry, spots, triangles }, built the first time it's wanted
export function shopKit(name) {
  let k = built.get(name);
  if (!k) {
    const K = new Kit(name.length * 977 + name.charCodeAt(0) * 31 + name.charCodeAt(name.length - 1));
    (KITS[name] || KITS.retail)(K);
    k = K.build();
    built.set(name, k);
  }
  return k;
}
export { HT, D0, H0 };
