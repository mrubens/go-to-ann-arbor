import { Kit, H0, D0, HT, SLOT, anchorX, anchorZ, C, BRIGHTS, MUTED, CLOTHES, BOTTLES, shadeHex, chair, stool, tableRound, tableSquare, pendant, ceilingPanel,
  trackSpots, picture, plant, till, monitor, counter, shelves, books, goods, bottle, bottleRow, bench, armchair, stanchion, rope, bike,
  mannequin, garments, strip, writing } from './shop-kit-core.js';
import { KITS_B, VARIANTS_B } from './shop-kits-b.js';
import { KITS_C, STYLES_C, VARIANTS_C } from './shop-kits-c.js';

// Lamp: the room behind each kind of business's glass, furnished (shop-kit-core.js has what they're built with and
// how a kit fits a room of any size; shop-interiors.js draws them and puts the people in). The door is at the front
// left (x < -1.9, z < 1.6 is kept clear for it); low things stand by the window, tall ones at the back and the sides.
// `spots` are where people are: the staff first, then the customers in the order the room fills up.

const PI = Math.PI, E = PI / 2, W = -PI / 2, S = PI, N = 0; // which way someone faces: N into the room, S the street
const sitAt = (o = {}) => ({ pose: 'sit', table: true, ...o });
// Things that belong together keep together as the room grows: `pin` is how the place (x, z) of the group being made
// moves (give it to a spot, or to a chair's or a stool's `spot`), and all that `fn` makes inside `pinned` moves that
// way: a chair stays at its table, a stool at its bar, and whoever is on it with them
const pin = (K, x, z) => { const e = K.M.elements; return { ax: anchorX(e[0] * x + e[8] * z + e[12]), az: anchorZ(e[2] * x + e[10] * z + e[14]) }; };
function pinned(K, x, z, fn) { const at = pin(K, x, z); K.group(0, 0, 0, () => fn(at), { anchor: [at.ax, at.az] }); }

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
// What several kinds share. A booth: a fixed table between two high-backed benches along x, two to a bench; `lay(y)`
// puts things on the table
function booth(K, x, z, { dz = 0.72, depth = 0.46, back = 1.15, w = 1.2, top = 0xe6dfcf, leg = C.steel, seat = { slot: SLOT.accent, col: 0xffffff }, lay = null } = {}) {
  pinned(K, x, z, (at) => {
    K.group(x, z, 0, () => {
      K.box(0, 0.72, 0, w, 0.04, 0.62, top);
      K.cyl(0, 0, 0, 0.06, 0.72, leg, { seg: 6 });
      if (lay) lay(0.76);
    });
    for (const [s, ry] of [[-1, N], [1, S]]) {
      K.group(x, z + s * dz, ry, () => {
        bench(K, w + 0.02, { ...seat, depth, back });
        K.spot(-0.28, 0.05, 0, 'sit', sitAt({ h: 0.45, ...at }));
        K.spot(0.28, 0.05, 0, 'sit', sitAt({ h: 0.45, ...at }));
      });
    }
  });
}
// a shelf to sit or stand at along the window, from x0 to x1, stools drawn up to it at `seats` (facing the street)
function windowBar(K, x0, x1, seats, { h = 1.02, top = 0xe6dfcf, leg = C.steel, stoolO = {} } = {}) {
  K.group(0, 0, 0, () => {
    K.box((x0 + x1) / 2, h - 0.05, 0.3, x1 - x0, 0.05, 0.4, top);
    for (const x of [x0 + 0.08, (x0 + x1) / 2, x1 - 0.08]) K.box(x, 0, 0.3, 0.05, h - 0.05, 0.05, leg, { faces: 'fbrl' });
  }, { stretch: true });
  for (const x of seats) stool(K, x, 0.74, h - 0.28, { ry: S, ...stoolO, spot: { pose: 'bar', table: true, ...(stoolO.spot || {}) } });
}

// A restaurant. 0: a banquette down one wall, tables for four in the room; 1: the banquette along the back wall and
// the wine on a side wall; 2: booths down one wall and one long table
function restaurant(K, v = 0) {
  K.shell();
  const cloth = 0xefeae0, CH = { frame: C.woodD, seat: 'accent' };
  const lamp = (x, z) => pendant(K, x, z, 2.0, { shade: C.brass });
  // a chair drawn up to the table at (tx, tz) from its (dx, dz) side
  const chairAt = (tx, tz, dx, dz, r, at) => chair(K, tx + dx * r, tz + dz * r, Math.atan2(-dx, -dz), { ...CH, spot: sitAt(at) });
  // a table for two under a lamp, its chairs on `sides`; `seat` [x, z, ry]: who has the banquette's side of it;
  // `alongZ`: they sit north and south
  const two = (x, z, sides, { alongZ = false, seat = null } = {}) => pinned(K, x, z, (at) => {
    tableSquare(K, x, z, alongZ ? 0.72 : 0.7, alongZ ? 0.7 : 0.72, { cloth, places: alongZ ? [[0, 0.2], [0, -0.2]] : [[0.2, 0], [-0.2, 0]] });
    for (const [dx, dz] of sides) chairAt(x, z, dx, dz, 0.62, at);
    if (seat) K.spot(seat[0], seat[1], seat[2], 'sit', sitAt({ h: 0.45, ...at }));
    lamp(x, z);
  });
  const four = (x, z, centre = 'candle') => pinned(K, x, z, (at) => {
    tableSquare(K, x, z, 0.9, 0.9, { cloth, places: [[0.27, 0], [-0.27, 0], [0, 0.27], [0, -0.27]], centre });
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) chairAt(x, z, dx, dz, 0.66, at);
    lamp(x, z);
  });
  // a banquette `w` long, its back to the wall behind it
  const banquette = (x, z, ry, w) => K.group(x, z, ry, () => bench(K, w, { slot: SLOT.accent, col: 0xffffff, depth: 0.55, back: 1.12 }), { stretch: true });
  // the host's stand inside the door
  const host = (x, z) => K.group(x, z, 0, () => {
    K.box(0, 0, 0, 0.5, 1.05, 0.38, C.woodD);
    K.box(0, 1.05, 0.02, 0.56, 0.04, 0.44, C.wood, { rx: 0.25 });
    K.box(0.05, 1.1, 0.02, 0.24, 0.02, 0.32, 0x5a1c20, { rx: 0.25 });
    K.sph(-0.2, 1.2, -0.1, 0.035, C.bulb, { glow: 1, ws: 5, hs: 3 });
    K.shadow(0, 0, 0.8, 0.7);
    K.spot(0, 0.55, S, 'counter', { role: 'staff', h: 1.02, ...pin(K, 0, 0) });
  });
  // on the back wall: the kitchen's door, and the pass with the kitchen's light in it
  const kitchenDoor = (x) => K.group(x, D0, 0, () => {
    K.box(0, 0, -0.03, 1.0, 2.15, 0.06, C.woodD);
    K.plane(0, 1.04, -0.065, 0.84, 2.0, 'S', 0x5a3a26);
    K.cyl(0, 1.5, -0.07, 0.15, 0.01, 0xffdca0, { seg: 10, rx: E, center: true, glow: 0.7 });
  });
  const pass = (x, w) => K.group(x, D0, 0, () => {
    K.box(0, 1.0, -0.14, w, 0.06, 0.28, 0x9aa0a4);
    K.plane(0, 1.5, -0.012, w - 0.2, 0.86, 'S', 0xffd9a0, { glow: 0.75 });
    K.plane(0, 1.3, -0.016, w - 0.2, 0.3, 'S', 0x9a7a52, { glow: 0.5 });
    K.box(0, 1.93, -0.03, w, 0.1, 0.08, C.woodD);
    for (const px of [-(w / 2 - 0.5), 0, w / 2 - 0.5]) {
      K.cyl(px, 1.06, -0.14, 0.13, 0.015, 0xf4f1ea, { seg: 10 });
      K.cyl(px, 1.7, -0.1, 0.07, 0.1, C.steel, { seg: 6, r2: 0.03 });
      K.sph(px, 1.7, -0.1, 0.03, 0xffb060, { glow: 1, ws: 5, hs: 3 });
    }
  }, { stretch: true });
  // a shelf of wine over a sideboard, against a wall (S on the back wall, E on the left)
  const wine = (x, z, ry) => K.group(x, z, ry, () => {
    shelves(K, 1.5, 2.1, 0.24, 4, { frame: C.woodD, back: 0x2a1a14, y0: 0.9,
      fill: (k, x0, x1, y, d) => bottleRow(k, x0 + 0.04, x1 - 0.04, y, d - 0.1, { step: 0.095, h: 0.3 }) });
    K.box(0, 0, 0.25, 1.5, 0.9, 0.5, C.woodD); K.box(0, 0.9, 0.25, 1.56, 0.04, 0.54, C.wood);
  });
  // a lamp on a side wall (s -1 the left wall, 1 the right)
  const sconce = (s, z) => K.group(s * (H0 - 0.07), z, 0, () => { K.box(0, 1.85, 0, 0.1, 0.06, 0.1, C.brass); K.sph(-s * 0.02, 1.98, 0, 0.07, C.bulb, { glow: 1, ws: 6, hs: 4 }); });

  if (v === 0) {
    // a banquette along the right wall, two tables for two at it
    banquette(H0 - 0.34, 2.9, W, 3.7);
    for (const z of [1.75, 3.85]) two(2.5, z, [[-1, 0]], { seat: [3.1, z, W] });
    // two tables for four in the room
    four(-0.35, 1.95); four(-0.15, 4.0, 'vase');
    host(-1.5, 1.2);
    // the back wall: the kitchen's door, a shelf of wine, the pass
    kitchenDoor(-2.6); wine(-1.0, D0, S); pass(1.6, 2.6);
    // pictures and lamps along the left wall
    for (const [z, w, h] of [[2.3, 0.7, 0.9], [3.5, 1.0, 0.7], [4.75, 0.6, 0.8]]) picture(K, -H0, 1.65, z, w, h, 'E', { rnd: K.rand });
    for (const z of [2.9, 4.15]) sconce(-1, z);
    K.spot(-1.3, 4.7, S, 'stand', { role: 'staff', roam: 0.5 });
  } else if (v === 1) {
    // the banquette along the back wall, three tables for two at it
    banquette(1.9, D0 - 0.34, S, 2.8);
    for (const x of [1.0, 1.9, 2.8]) two(x, 4.46, [[0, -1]], { alongZ: true, seat: [x, 5.06, S] });
    // two tables for four towards the window
    four(-0.55, 2.35); four(2.1, 1.75, 'vase');
    host(-1.65, 1.15);
    // the kitchen's door and the pass at the back on the door's side, the wine on the left wall
    kitchenDoor(-2.6); pass(-0.75, 2.0); wine(-H0, 3.7, E);
    picture(K, -H0, 1.65, 2.2, 0.7, 0.9, 'E', { rnd: K.rand });
    for (const [z, w, h] of [[1.3, 0.9, 0.7], [2.7, 0.6, 0.8], [3.9, 1.0, 0.7]]) picture(K, H0, 1.7, z, w, h, 'W', { rnd: K.rand });
    for (const z of [2.0, 3.3]) sconce(1, z);
    K.spot(-0.9, 4.75, S, 'stand', { role: 'staff', roam: 0.5 });
  } else {
    // booths down the right wall
    for (const z of [0.99, 2.73, 4.47]) {
      booth(K, 2.86, z, { dz: 0.66, depth: 0.42, back: 1.25, w: 1.16, top: C.wood, leg: C.char, lay: (y) => {
        for (const [px, pz] of [[-0.28, -0.16], [0.28, -0.16], [-0.28, 0.16], [0.28, 0.16]]) K.cyl(px, y, pz, 0.1, 0.012, 0xf4f1ea, { seg: 8 });
        K.cyl(0, y, 0, 0.035, 0.07, 0x8a2a22, { seg: 6 });
        K.sph(0, y + 0.095, 0, 0.022, 0xffd27a, { glow: 1, ws: 5, hs: 3, sy: 1.5 });
      } });
      lamp(2.86, z);
      picture(K, H0, 1.95, z, 0.6, 0.5, 'W', { rnd: K.rand });
    }
    // one long table in the room, three a side
    pinned(K, -0.4, 2.7, (at) => {
      for (const dz of [-0.8, 0, 0.8]) for (const s of [-1, 1]) chairAt(-0.4, 2.7 + dz, s, 0, 0.68, at);
      lamp(-0.4, 2.1); lamp(-0.4, 3.3);
    });
    K.group(-0.4, 2.7, 0, () => {
      K.box(0, 0.73, 0, 0.89, 0.03, 2.44, cloth);
      K.box(0, 0.51, 0, 0.89, 0.22, 2.44, cloth, { faces: 'fbrl', k: 0.86 });
      for (const s of [-1, 1]) { K.cyl(0, 0.02, s * 0.8, 0.045, 0.69, C.char, { seg: 6, open: true }); K.box(0, 0, s * 0.8, 0.45, 0.03, 0.45, C.char); }
      K.shadow(0, 0, 1.15, 2.65, 0.6);
      for (const dz of [-0.8, 0, 0.8]) for (const s of [-1, 1]) {
        K.cyl(s * 0.24, 0.762, dz, 0.115, 0.012, 0xf4f1ea, { seg: 10 });
        K.cyl(s * 0.2, 0.762, dz + s * 0.2, 0.03, 0.1, 0xcfe0e4, { seg: 6, r2: 0.036 });
      }
      for (const dz of [-0.4, 0.4]) {
        K.cyl(0, 0.762, dz, 0.035, 0.07, 0x8a2a22, { seg: 6 });
        K.sph(0, 0.855, dz, 0.022, 0xffd27a, { glow: 1, ws: 5, hs: 3, sy: 1.5 });
      }
    });
    host(-1.65, 1.15);
    // the back wall: the kitchen's door and the pass; the wine on the left wall
    kitchenDoor(-2.3); pass(0.3, 2.4); wine(-H0, 3.7, E);
    picture(K, -H0, 1.65, 2.2, 0.7, 0.9, 'E', { rnd: K.rand });
    sconce(-1, 4.95);
    K.spot(-0.3, 4.75, S, 'stand', { role: 'staff', roam: 0.5 });
  }
}

// Fast food. 0: the counter along the back, booths by the window; 1: the counter down a side wall, stools along the
// window, booths on the other wall; 2: a short counter, screens to order at, a high table and a banquette
function fast_food(K, v = 0) {
  K.shell({ skirting: 0x4a4a48 });
  const food = [0x9a5a2a, 0xc9a227, 0xb6382c, 0x4a8a3a, 0xd9862a, 0x7a4a2a];
  // the line, `len` long: the counter with its tills (and who works them), the lit menu overhead, the kitchen along
  // the wall behind, the soda fountain at one end. (x, z) is the middle of the counter's front; ry 0 along the back
  // wall, E down the right one
  const line = (x, z, ry, len, tills) => K.group(x, z, ry, () => {
    const h = len / 2;
    counter(K, -h, h, 0, 0.7, 1.02, { front: 0xffffff, slot: SLOT.accent, top: 0xd8d4cc, kick: 0x3a3a3a });
    for (const tx of tills) {
      till(K, tx, 1.02, 0.28);
      K.group(tx + 0.42, 0.14, 0, () => K.box(0, 1.02, 0, 0.1, 0.12, 0.14, C.char, { rx: -0.5 }));
      K.spot(tx, 0.9, S, 'counter', { role: 'staff', h: 1.02, roam: 0.25 });
    }
    // the menu overhead: lit boards with pictures and prices
    K.box(0, 2.3, 0.35, len + 0.1, 0.78, 0.26, 0x26262a);
    const n = Math.round((len + 0.1) / 1.375), bw = (len + 0.1) / n, f = (bw - 0.1) / 1.27;
    for (let i = 0; i < n; i++) {
      K.group(-h - 0.05 + bw * (i + 0.5), 0.215, 0, () => {
        K.plane(0, 2.69, 0, bw - 0.1, 0.64, 'S', 0xfff1cf, { glow: 1 });
        K.cyl(-0.36 * f, 2.76, -0.008, 0.17, 0.004, food[i % 6], { seg: 10, rx: E, center: true, glow: 0.9 });
        K.cyl(-0.36 * f, 2.76, -0.012, 0.1, 0.004, food[(i + 2) % 6], { seg: 8, rx: E, center: true, glow: 0.9 });
        K.plane(-0.36 * f, 2.48, -0.008, 0.4, 0.07, 'S', 0xb6382c, { glow: 0.9 });
        for (let r = 0; r < 5; r++) {
          K.plane((0.2 + K.rand() * 0.08) * f, 2.9 - r * 0.105, -0.008, (0.5 + K.rand() * 0.16) * f, 0.04, 'S', 0x3a2a20, { glow: 0.5 });
          K.plane(0.55 * f, 2.9 - r * 0.105, -0.008, 0.09, 0.04, 'S', 0xb6382c, { glow: 0.9 });
        }
      });
    }
    // the kitchen along the wall: steel counters, a hood, a pass with wrapped things under a lamp
    K.box(0, 0, 1.5, len + 0.2, 0.9, 0.6, 0xa9aeb2);
    K.box(0, 0.9, 1.5, len + 0.3, 0.03, 0.64, 0xc8ccd0);
    K.box(0, 1.95, 1.48, len - 1.4, 0.34, 0.62, 0x9aa0a4);
    K.plane(0, 1.45, 1.788, len + 0.2, 0.95, 'S', 0xcfd4d4);
    K.plane(0, 1.93, 1.5, len - 1.8, 0.4, 'D', 0xffc880, { glow: 0.8 });
    for (let i = 0; i * 0.42 < len - 1.9; i++) K.box(-h + 0.8 + i * 0.42, 0.93, 1.44 + (i % 2) * 0.12, 0.2, 0.09, 0.2, i % 3 ? 0xe8c84a : 0xf2efe6);
    for (const fx of [-h + 0.2, h - 0.3]) K.group(fx, 1.5, 0, () => { K.box(0, 0.93, 0, 0.5, 0.3, 0.45, 0x55595e); K.box(0, 1.23, 0, 0.42, 0.04, 0.38, 0x2a2a2c); });
    // the soda fountain at the end of the counter, cups beside it
    K.group(h - 0.45, 0.3, 0, () => {
      K.box(0, 1.02, 0, 0.7, 0.6, 0.5, 0x2a2c30);
      for (let i = 0; i < 5; i++) {
        K.plane(-0.26 + i * 0.13, 1.47, -0.256, 0.1, 0.16, 'S', BRIGHTS[(i * 3) % BRIGHTS.length], { glow: 0.8 });
        K.box(-0.26 + i * 0.13, 1.24, -0.29, 0.03, 0.08, 0.06, C.chrome);
      }
      K.box(0, 1.03, -0.31, 0.66, 0.03, 0.14, C.chrome);
      for (const cx of [-0.55, -0.68]) K.cyl(cx, 1.02, 0.05, 0.045, 0.32, 0xf4f1ea, { seg: 6, r2: 0.055 });
    });
  }, { stretch: true });
  // what's on a booth's table: a tray, a cup, a box
  const tray = (y) => {
    K.box(0.2, y, 0.05, 0.36, 0.015, 0.26, 0x8a5a3a);
    K.cyl(-0.3, y, -0.1, 0.04, 0.13, 0xf4f1ea, { seg: 6, r2: 0.05 });
    K.box(0.22, y + 0.015, 0.05, 0.14, 0.06, 0.12, 0xe8c84a);
  };
  // where the trays go (its mouth to +z)
  const bin = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 0, 0, 0.6, 1.1, 0.5, 0x6a5a48);
    K.plane(0, 0.85, 0.252, 0.4, 0.2, 'N', 0x2a2420);
    K.box(0, 1.1, 0, 0.5, 0.03, 0.4, 0x7a4a2a);
    K.shadow(0, 0.1, 0.8, 0.8);
  });
  // a loose table for two, chairs east and west
  const two = (x, z) => pinned(K, x, z, (at) => {
    tableSquare(K, x, z, 0.7, 0.7, { top: 0xe6dfcf, centre: null });
    K.group(x, z, 0, () => { K.box(0.05, 0.75, 0, 0.34, 0.015, 0.24, 0x8a5a3a); K.cyl(0.08, 0.765, 0.02, 0.04, 0.13, 0xf4f1ea, { seg: 6, r2: 0.05 }); });
    chair(K, x - 0.62, z, E, { frame: C.steel, seat: 'accent', spot: sitAt(at) });
    chair(K, x + 0.62, z, W, { frame: C.steel, seat: 'accent', spot: sitAt(at) });
  });
  // a stripe of the business's color along a wall
  const band = (x, z, len, face) => K.group(0, 0, 0, () => K.plane(x, 1.75, z, len, 0.5, face, 0xffffff, { slot: SLOT.accent }), { stretch: true });
  for (const [x, z] of [[-1.6, 1.5], [1.6, 1.5], [-1.6, 3.0], [1.6, 3.0]]) ceilingPanel(K, x, z, 1.2, 0.6);

  if (v === 0) {
    line(0.5, 3.7, 0, 5.4, [-1.2, 0.8]);
    // booths by the window
    booth(K, 2.85, 1.75, { lay: tray }); booth(K, 0.85, 1.75, { lay: tray });
    bin(-H0 + 0.3, 2.7, E);
    band(-H0 + 0.012, 4.0, 2.6, 'E');
    K.spot(-0.7, 3.15, N, 'counter', { h: 1.02, ...pin(K, -0.7, 3.7) });
    K.spot(1.3, 3.1, N, 'stand');
    K.spot(-0.75, 2.4, N, 'stand');
  } else if (v === 1) {
    // the counter and the kitchen down the right wall
    line(1.7, 3.45, E, 3.8, [-0.7, 0.7]);
    // stools at a shelf along the window, loose tables in the room, booths on the left wall
    windowBar(K, -1.5, 1.3, [-1.1, -0.4, 0.3, 1.0], { stoolO: { col: C.steel, seat: 0x3a3a3a } });
    two(-0.5, 2.5); two(-0.5, 4.15);
    booth(K, -2.85, 2.62, { dz: 0.66, depth: 0.42, lay: tray }); booth(K, -2.85, 4.36, { dz: 0.66, depth: 0.42, lay: tray });
    bin(-1.35, D0 - 0.3, S);
    band(-0.6, D0 - 0.012, 3.4, 'S');
    K.spot(1.15, 2.75, E, 'counter', { h: 1.02, ...pin(K, 1.7, 2.75) });
    K.spot(1.1, 4.15, E, 'stand');
    K.spot(0.55, 3.3, E, 'stand');
  } else {
    // a short counter at the back, away from the door
    line(1.55, 3.7, 0, 3.6, [-0.9, 0.5]);
    // two screens to order at, on the left wall
    for (const [z, prio] of [[2.6, 3], [3.5, 7]]) {
      K.group(-H0 + 0.16, z, E, () => {
        K.box(0, 0, 0, 0.5, 0.05, 0.3, 0x3a3a3a);
        K.box(0, 0.05, -0.04, 0.16, 0.9, 0.1, 0x3a3a3a);
        K.box(0, 0.9, 0, 0.54, 0.86, 0.08, 0x26262a);
        K.plane(0, 1.33, 0.042, 0.46, 0.76, 'N', 0xfff1cf, { glow: 0.9 });
        K.plane(0, 1.64, 0.046, 0.4, 0.1, 'N', 0xffffff, { slot: SLOT.accent, glow: 0.7 });
        for (let i = 0; i < 6; i++) K.plane(-0.11 + (i % 2) * 0.22, 1.47 - Math.floor(i / 2) * 0.19, 0.046, 0.17, 0.14, 'N', food[i], { glow: 0.8 });
        K.spot(0, 0.55, S, 'stand', { prio, ...pin(K, 0, 0) });
      });
    }
    // a fridge of drinks and the bin in the back corner
    K.group(-1.15, D0 - 0.3, 0, () => {
      K.box(0, 0, 0, 0.9, 1.95, 0.56, 0x2a2c30, { faces: 'frltu' });
      K.plane(0, 1.0, -0.2, 0.8, 1.7, 'S', 0xeaf4ff, { glow: 0.8 });
      K.box(0, 1.8, -0.24, 0.9, 0.15, 0.08, 0xffffff, { slot: SLOT.accent });
      for (let r = 0; r < 4; r++) {
        K.box(0, 0.18 + r * 0.4, -0.24, 0.84, 0.02, 0.08, 0x9aa0a4);
        for (let i = 0; i < 7; i++) K.cyl(-0.33 + i * 0.11, 0.2 + r * 0.4, -0.25, 0.04, 0.2, BRIGHTS[(i + r * 5) % BRIGHTS.length], { seg: 5, glow: 0.3 });
      }
    });
    bin(-2.3, D0 - 0.3, S);
    // a high table to share, and a banquette along the right wall with little tables
    K.group(-0.55, 1.55, 0, () => {
      K.box(0, 0.97, 0, 2.0, 0.05, 0.6, 0xe6dfcf);
      for (const s of [-1, 1]) { K.box(s * 0.8, 0, 0, 0.06, 0.97, 0.4, C.steel); K.box(s * 0.8, 0, 0, 0.1, 0.03, 0.56, C.steel); }
      K.box(0, 0.3, 0, 1.6, 0.04, 0.05, C.steel);
      for (const [tx, tz] of [[-0.6, 0.1], [0.5, -0.12]]) { K.box(tx, 1.02, tz, 0.34, 0.015, 0.24, 0x8a5a3a); K.cyl(tx + 0.05, 1.035, tz, 0.04, 0.13, 0xf4f1ea, { seg: 6, r2: 0.05 }); }
      K.shadow(0, 0, 2.3, 0.9, 0.62);
    });
    pinned(K, -0.55, 1.55, (at) => {
      for (const x of [-1.25, -0.55, 0.15]) for (const [dz, ry] of [[-0.52, N], [0.52, S]]) stool(K, x, 1.55 + dz, 0.74, { ry, col: C.steel, seat: 0x3a3a3a, spot: { pose: 'bar', table: true, ...at } });
    });
    K.group(H0 - 0.3, 1.65, W, () => bench(K, 2.5, { slot: SLOT.accent, col: 0xffffff, depth: 0.46, back: 1.15 }), { stretch: true });
    for (const z of [0.75, 1.65, 2.55]) {
      pinned(K, 2.55, z, (at) => {
        tableSquare(K, 2.55, z, 0.6, 0.6, { top: 0xe6dfcf, centre: null });
        chair(K, 1.97, z, E, { frame: C.steel, seat: 'accent', spot: sitAt(at) });
        K.spot(3.12, z, W, 'sit', sitAt({ h: 0.45, ...at }));
      });
    }
    band(H0 - 0.012, 1.65, 2.6, 'W');
    K.spot(0.65, 3.15, N, 'counter', { h: 1.02, ...pin(K, 0.65, 3.7) });
    K.spot(2.05, 3.1, N, 'stand');
  }
}

// A cafe. 0: the counter along the back, little tables by the window; 1: the counter down a side wall, one big table
// to share and armchairs in the window; 2: the counter in an L in the back corner, a banquette down the other wall
function cafe(K, v = 0) {
  K.shell();
  const CS = { front: 0x5a4330, top: 0xd8d0c0 };
  const cup = (x, z, y = 0.74) => { K.cyl(x, y, z, 0.04, 0.07, 0xf4f1ea, { seg: 6, r2: 0.046 }); K.cyl(x, y + 0.065, z, 0.036, 0.004, 0x4a2c1a, { seg: 6 }); };
  const laptop = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 0.74, 0, 0.3, 0.014, 0.21, 0x9a9da0);
    K.box(0, 0.75, -0.11, 0.3, 0.2, 0.012, 0x9a9da0, { rx: -0.2 });
    K.plane(0, 0.855, -0.1, 0.27, 0.17, 'N', 0xcfe2f4, { glow: 0.6, ry: 0 });
  });
  // The counter's fittings, each facing the customers at -z as placed (ry 0 for a counter along the back wall, E for
  // one down the right wall). The slats on a counter's front, `w` long:
  const slats = (x, z, ry, w) => K.group(x, z, ry, () => { for (let i = 0; i * 0.29 < w - 0.19; i++) K.box(-w / 2 + 0.14 + i * 0.29, 0.12, -0.008, 0.2, 0.82, 0.012, 0x7a5a3c, { faces: 'b' }); }, { stretch: true });
  // the pastry case: glass shelves of things, chrome posts
  const pastry = (x, z, ry) => K.group(x, z, ry, () => {
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
  // the espresso machine, cups warming on top, and a grinder
  const espresso = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 1.03, 0, 0.8, 0.36, 0.5, 0xc8ccd0);
    K.box(0, 1.0, 0, 0.84, 0.03, 0.54, 0x2a2a2c);
    K.plane(0, 1.21, -0.252, 0.8, 0.36, 'S', 0xffffff, { slot: SLOT.accent });
    K.plane(0, 1.21, -0.256, 0.5, 0.09, 'S', 0xe8e4da);
    K.box(0, 1.39, 0, 0.84, 0.025, 0.54, 0xdfe2e4);
    for (let i = 0; i < 8; i++) K.cyl(-0.3 + (i % 4) * 0.2, 1.415, -0.12 + Math.floor(i / 4) * 0.2, 0.04, 0.06, 0xf4f1ea, { seg: 6, r2: 0.05 });
    for (const px of [-0.2, 0.2]) { K.cyl(px, 1.1, 0.27, 0.035, 0.1, 0x55595e, { seg: 6 }); K.box(px, 1.07, 0.36, 0.03, 0.03, 0.16, 0x2a2a2c); }
  });
  const grinder = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 1.0, 0, 0.2, 0.3, 0.28, 0x2a2a2c);
    K.cyl(0, 1.3, 0, 0.06, 0.2, 0x8a6a4a, { seg: 6, r2: 0.11 });
  });
  // on the wall behind: a chalkboard menu `w` wide, and under it a shelf of bags and mugs
  const chalk = (x, z, ry, w) => {
    K.group(x, z, ry, () => {
      K.plane(0, 2.3, -0.02, w, 1.05, 'S', C.woodD);
      K.plane(0, 2.3, -0.026, w - 0.12, 0.93, 'S', 0x1f2526);
      writing(K, 0, 2.3, -0.03, w - 0.3, 0.8, 'S', { rows: 6, cols: Math.max(2, Math.round(w / 1.1)) });
    });
    K.group(x, z, ry + S, () => shelves(K, w, 0.5, 0.2, 1, { frame: C.wood, y0: 0.03, sides: false, fill: (k, x0, x1, y, d) => {
      for (let sx = x0 + 0.1; sx < x1 - 0.1; sx += 0.17) {
        if (k.rand() < 0.45) k.cyl(sx, y, d - 0.09, 0.045, 0.09, k.pick([0xf4f1ea, 0xf4f1ea, 0x2f5a4a, 0xd9862a]), { seg: 6 });
        else { const c = k.pick([0x6a4a30, 0x1c1c1e, 0xd9cfb8, 0x8a3a24]); k.box(sx, y, d - 0.09, 0.12, 0.2, 0.08, c); k.plane(sx, y + 0.11, d - 0.048, 0.08, 0.07, 'N', 0xf2efe6); }
      }
    } }), { y: 1.25 });
  };
  // the back counter under them, from x0 to x1 against the wall at z: syrups at one end, a stack of cups at the other
  const backCounter = (x0, x1, z, s = 1) => {
    const mid = (x0 + x1) / 2, w = x1 - x0, a = mid - s * (w / 2 - 0.45), b = a + s * Math.min(1.2, w - 1.7), c = mid + s * (w / 2 - 0.9);
    K.group(0, 0, 0, () => { K.box(mid, 0, z - 0.28, w, 0.9, 0.56, 0x4a3828); K.box(mid, 0.9, z - 0.28, w + 0.06, 0.03, 0.6, 0xd8d0c0); }, { stretch: true });
    bottleRow(K, Math.min(a, b), Math.max(a, b), 0.93, z - 0.3, { step: 0.11, h: 0.26, palette: [0xb8862a, 0x7a3a1a, 0xd9d2c0, 0x8a2a3a] });
    for (let i = 0; i < 4; i++) K.cyl(c + s * i * 0.12, 0.93, z - 0.32, 0.045, 0.3, 0xf4f1ea, { seg: 6, r2: 0.055 });
  };
  const lampC = (x, z) => pendant(K, x, z, 2.05, { shade: C.brass, r: 0.15 });
  const lampT = (x, z) => pendant(K, x, z, 2.1, { shade: 0x2a2a2c, r: 0.2 });
  // the whole counter in a straight line `len` long, (x, z) the middle of its front: the pastry case at one end
  // (s 1: the -x end as placed), the till, the machine; the wall 1.65 m behind it; who works it and who's being served
  const line = (x, z, ry, len, s = 1) => K.group(x, z, ry, () => {
    const h = len / 2, cw = Math.min(3.3, len - 0.9);
    counter(K, -h, h, 0, 0.65, 1.0, CS);
    slats(0, 0, 0, len);
    pastry(s * (-h + 0.68), 0.32, 0);
    till(K, s * (-h + 1.8), 1.0, 0.27);
    espresso(s * (h - 1.4), 0.32, 0);
    grinder(s * (h - 0.5), 0.32, 0);
    chalk(s * -0.025, 1.65, 0, cw);
    backCounter(-h + 0.1, h - 0.05, 1.65, s);
    for (const lx of [-h + 0.8, 0.025, h - 0.75]) lampC(s * lx, 0.3);
    K.spot(s * (h - 1.4), 0.9, S, 'counter', { role: 'staff', h: 1.0, roam: 0.55 });
    K.spot(s * (-h + 1.8), 0.9, S, 'counter', { role: 'staff', h: 1.0, roam: 0.2 });
    K.spot(s * (-h + 1.8), -0.55, N, 'counter', { h: 1.0, prio: 1, ...pin(K, s * (-h + 1.8), 0) });
    K.spot(s * (-h + 1.05), -0.85, N, 'stand', { prio: 6 });
  }, { stretch: true });
  // things to buy on a wall's shelves
  const rack = (x, z, ry) => K.group(x, z, ry, () => shelves(K, 1.7, 1.9, 0.26, 4, { frame: C.wood, y0: 0.5, fill: goods([0x6a4a30, 0x1c1c1e, 0xd9cfb8, 0x8a3a24, 0x2f5a4a, 0xf4f1ea], { size: 0.16, tall: 0.24 }) }));
  // two armchairs across a low table
  const armchairs = (x, z) => pinned(K, x, z, (at) => {
    armchair(K, x - 0.72, z, 1.25, { spot: { pose: 'sit', ...at } });
    armchair(K, x + 0.72, z, -1.25, { spot: { pose: 'read', ...at } });
    tableRound(K, x, z + 0.05, 0.3, 0.46, { top: C.woodL });
    cup(x - 0.1, z + 0.1, 0.46); cup(x + 0.12, z - 0.02, 0.46);
    lampT(x, z);
  });
  // a little round table and who sits at it: `seats` [dx, dz, pose] each; `lay` puts things on it
  const roundSet = (x, z, r, seats, lay) => pinned(K, x, z, (at) => {
    tableRound(K, x, z, r);
    if (lay) lay(at);
    for (const [dx, dz, pose = 'sit'] of seats) chair(K, x + dx, z + dz, Math.atan2(-dx, -dz), { spot: sitAt({ pose, ...at }) });
  });

  if (v === 0) {
    line(0.875, 3.85, 0, 4.55);
    rack(-H0, 3.1, E);
    picture(K, -H0, 1.7, 4.6, 0.7, 0.9, 'E', { rnd: K.rand });
    // little tables by the window
    roundSet(-0.45, 1.3, 0.33, [[-0.57, 0], [0.57, 0]], () => { cup(-0.57, 1.33); cup(-0.3, 1.22); lampT(-0.45, 1.3); });
    roundSet(1.45, 1.75, 0.33, [[0, -0.57, 'type'], [0, 0.59]], () => { laptop(1.4, 1.8, N); cup(1.62, 1.6); lampT(1.45, 1.75); });
    roundSet(2.75, 1.0, 0.3, [[0, -0.56], [0, 0.56]], () => cup(2.7, 1.05));
    plant(K, 3.1, 2.4, 1.5);
  } else if (v === 1) {
    // the counter down the right wall, the pastry case at its window end
    line(1.85, 3.4, E, 4.0, -1);
    // one big table to share
    K.group(-1.0, 3.5, 0, () => {
      K.box(0, 0.69, 0, 0.85, 0.05, 2.2, C.oak);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.34, 0, sz * 1.0, 0.07, 0.69, 0.07, C.woodD, { faces: 'fbrl' });
      K.box(0, 0.25, 0, 0.05, 0.05, 2.0, C.woodD);
      K.shadow(0, 0, 1.15, 2.5, 0.62);
      K.cyl(0, 0.74, 0, 0.07, 0.16, 0xdfe6e8, { seg: 6, r2: 0.05 });
      for (const [fx, fz, c] of [[-0.05, 0.14, 0xc8453a], [0.06, 0.2, 0xe2c08a], [0.02, 0.12, 0xe8a0b0]]) K.sph(fx, 0.95 + fz * 0.3, fz - 0.15, 0.05, c, { ws: 5, hs: 3 });
    });
    pinned(K, -1.0, 3.5, (at) => {
      laptop(-1.2, 2.8, E); cup(-0.78, 2.72); cup(-1.22, 3.52); cup(-0.8, 3.45); laptop(-0.8, 4.2, W); cup(-1.2, 4.3);
      for (const [z, a, b] of [[2.8, 'type', 'sit'], [3.5, 'sit', 'sit'], [4.2, 'sit', 'type']]) {
        chair(K, -1.64, z, E, { spot: sitAt({ pose: a, ...at }) });
        chair(K, -0.36, z, W, { spot: sitAt({ pose: b, ...at }) });
      }
      lampT(-1.0, 2.95); lampT(-1.0, 4.05);
    });
    // armchairs in the window
    armchairs(0.0, 0.95);
    rack(-1.9, D0, S);
    for (const [z, w, h] of [[2.9, 0.7, 0.9], [4.1, 1.0, 0.7]]) picture(K, -H0, 1.7, z, w, h, 'E', { rnd: K.rand });
    plant(K, -3.1, 2.0, 1.5);
  } else {
    // the counter in an L in the back right corner: the till and the machine facing the window, the pastry case on
    // the arm that runs to the back wall
    counter(K, 0.2, 3.2, 3.3, 0.65, 1.0, CS); slats(1.7, 3.3, 0, 3.0);
    counter(K, 3.95, 5.45, 0.2, 0.65, 1.0, { ...CS, alongZ: true }); slats(0.2, 4.7, E, 1.5);
    pastry(0.525, 4.68, E);
    till(K, 1.15, 1.0, 3.57);
    espresso(2.3, 3.62, 0); grinder(2.98, 3.62, 0);
    chalk(2.2, D0, 0, 2.5); backCounter(0.95, 3.45, D0);
    lampC(1.2, 3.6); lampC(2.6, 3.6); lampC(0.5, 4.7);
    K.spot(2.3, 4.32, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
    K.spot(1.25, 4.5, W, 'counter', { role: 'staff', h: 1.0, roam: 0.2 });
    K.spot(1.15, 2.75, N, 'counter', { h: 1.0, prio: 1, ...pin(K, 1.15, 3.3) });
    K.spot(-0.4, 4.6, E, 'stand', { prio: 6, ...pin(K, 0.2, 4.6) });
    rack(-H0, 4.3, E);
    picture(K, -H0, 1.7, 2.6, 0.7, 0.9, 'E', { rnd: K.rand });
    // a banquette down the right wall with little tables, armchairs in the window, a table by the door's wall
    K.group(H0 - 0.3, 1.5, W, () => bench(K, 2.3, { slot: SLOT.accent, col: 0xffffff, depth: 0.46, back: 1.0 }), { stretch: true });
    [0.8, 1.5, 2.2].forEach((z, i) => roundSet(2.6, z, 0.26, [[-0.58, 0]], (at) => {
      cup(2.55, z + 0.08);
      if (i === 1) laptop(2.62, z - 0.02, E);
      K.spot(3.12, z, W, 'sit', sitAt({ h: 0.45, pose: i === 1 ? 'type' : 'sit', ...at }));
    }));
    for (const [z, w, h] of [[0.9, 0.6, 0.8], [2.0, 0.9, 0.6]]) picture(K, H0, 1.8, z, w, h, 'W', { rnd: K.rand });
    armchairs(-0.2, 0.95);
    roundSet(-2.45, 2.6, 0.3, [[-0.55, 0], [0.55, 0]], () => cup(-2.5, 2.68));
    lampT(2.3, 1.5);
  }
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

// A bar. 0: the bar down a side wall, high tables; 1: a long bar along the back, booths on a side wall, a rail of
// stools at the window; 2: the bar out into the room from the back wall, stools on three sides, a pool table
function bar(K, v = 0) {
  K.shell({ skirting: 0x1a1412 });
  const CS = { front: 0x3a2416, top: 0x6a4424, kick: 0x120e0c };
  // a stool and who's on it, facing `ry`; `at`: what it's drawn up to (pin)
  const stoolAt = (x, z, ry, at) => stool(K, x, z, 0.78, { ry, seat: 0x5a2a1c, spot: { pose: 'bar', h: 0.78, table: true, ...at } });
  const glass = (x, z, y = 1.08) => K.cyl(x, y, z, 0.035, 0.13, 0xd9c27a, { seg: 6, r2: 0.042 });
  const lamp = (x, z) => pendant(K, x, z, 2.15, { shade: 0x3a2416, r: 0.14, glow: 0xffc27a });
  // The bar's fittings, each facing the drinkers at -z as placed (ry 0 on the back wall, E on the right wall, W on
  // the left). The back-bar, `w` long, (x, z) on its wall: a cabinet, a wall of light, three shelves of bottles
  const backBar = (x, z, ry, w) => K.group(x, z, ry, () => {
    K.box(0, 0, -0.28, w, 1.0, 0.56, 0x2c1c12);
    K.box(0, 1.0, -0.28, w + 0.04, 0.04, 0.6, 0x6a4424);
    K.plane(0, 1.72, -0.015, w, 1.3, 'S', 0xffffff, { slot: SLOT.accent, glow: 0.55 });
    for (const y of [1.3, 1.7, 2.1]) K.box(0, y, -0.14, w, 0.025, 0.24, 0x1a1210);
    K.box(0, 2.42, -0.2, w + 0.1, 0.1, 0.4, 0x2c1c12);
    for (const y of [1.04, 1.325, 1.725, 2.125]) {
      for (let bx = -w / 2 + 0.08; bx < w / 2 - 0.05; bx += 0.105 * (0.9 + K.rand() * 0.3)) {
        if (K.rand() < 0.08) continue;
        bottle(K, bx, y, -0.14, 0.27 + K.rand() * 0.09, K.pick(BOTTLES));
      }
    }
  }, { stretch: true });
  const taps = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 1.08, 0, 0.55, 0.34, 0.09, C.chrome);
    K.box(0, 1.08, -0.12, 0.6, 0.02, 0.18, 0x55595e);
    [0xc9a227, 0x2a5aa6, 0xb0392b, 0x2a7a4a].forEach((c, i) => { K.box(-0.2 + i * 0.133, 1.36, -0.07, 0.04, 0.2, 0.03, c, { rx: -0.25 }); K.box(-0.2 + i * 0.133, 1.3, -0.06, 0.03, 0.03, 0.04, C.chrome); });
  });
  // the game on, on a wall
  const tv = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 1.75, -0.04, 1.6, 0.92, 0.07, 0x101012);
    K.plane(0, 2.21, -0.08, 1.5, 0.82, 'S', 0x3f8f4a, { glow: 0.8 });
    K.plane(0, 2.21, -0.084, 0.02, 0.82, 'S', 0xe8f0e8, { glow: 0.8 });
    K.plane(0, 2.21, -0.084, 0.3, 0.3, 'S', 0x5aa862, { glow: 0.8 });
    K.plane(0, 2.56, -0.084, 0.5, 0.07, 'S', 0x1c1c22, { glow: 0.5 });
  });
  // a neon sign just off a wall: a cocktail glass in tubes, a ring round it
  const neon = (x, z, ry) => K.group(x, z, ry, () => {
    const o = { slot: SLOT.accent, glow: 1.5, seg: 5 }, r = 0.022;
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
  // a dartboard on a side wall (ry 0 the left wall, S the right)
  const darts = (x, z, ry) => K.group(x, z, ry, () => {
    K.cyl(0, 1.7, 0, 0.25, 0.03, 0x1a1a1c, { seg: 14, rz: E, center: true });
    K.cyl(0.012, 1.7, 0, 0.19, 0.03, 0xd9cfb8, { seg: 14, rz: E, center: true });
    K.cyl(0.02, 1.7, 0, 0.12, 0.03, 0x1a1a1c, { seg: 12, rz: E, center: true });
    K.cyl(0.028, 1.7, 0, 0.035, 0.03, 0xb0392b, { seg: 8, rz: E, center: true });
  });
  // a high table, glasses on it, a lamp over it; `who(at)` makes the stools and the people round it
  const highTable = (x, z, who) => pinned(K, x, z, (at) => {
    tableRound(K, x, z, 0.3, 1.06, { top: 0x4a3020 });
    glass(x - 0.1, z + 0.05, 1.06); glass(x + 0.1, z - 0.1, 1.06);
    lamp(x, z);
    who(at);
  });
  // the whole bar in a straight line `len` long, (x, z) the middle of its front: a brass rail at its foot, stools,
  // the taps, the back-bar on the wall 1.55 m behind, and who tends it
  const barLine = (x, z, ry, len, { tapsAt = 0.425, staffAt = 0.325 } = {}) => K.group(x, z, ry, () => {
    const h = len / 2, n = Math.floor(len / 0.8);
    counter(K, -h, h, 0, 0.6, 1.08, CS);
    K.rod(-h + 0.05, 0.18, -0.09, h - 0.05, 0.18, -0.09, 0.022, C.brass, { seg: 5 });
    backBar(0, 1.55, 0, len + 0.05);
    taps(tapsAt, 0.3, 0);
    for (let gx = -h + 0.4, i = 0; gx < h - 0.2; gx += 0.6, i++) if (Math.abs(gx - tapsAt) > 0.45) glass(gx, 0.15 + (i % 3) * 0.09);
    for (let i = 0; i < n; i++) { const sx = -h + len * (i + 0.5) / n; pinned(K, sx, 0, (at) => stoolAt(sx, -0.45, N, at)); }
    for (const lx of [-h * 0.69, 0, h * 0.69]) lamp(lx, 0.3);
    K.spot(staffAt, 0.93, S, 'counter', { role: 'staff', h: 1.08, roam: 0.9 });
  }, { stretch: true });

  if (v === 0) {
    // the bar along the right wall
    barLine(1.95, 2.925, E, 4.05);
    highTable(-1.0, 1.7, (at) => { stoolAt(-1.55, 1.7, E, at); stoolAt(-0.45, 1.7, W, at); });
    highTable(-0.9, 3.75, (at) => { K.spot(-0.9, 3.15, N, 'drink', at); K.spot(-0.35, 3.85, W, 'drink', at); });
    tv(-1.2, D0, 0); neon(1.0, D0 - 0.05, 0);
    // a dartboard and pictures on the left wall
    darts(-H0 + 0.03, 3.6, 0);
    picture(K, -H0, 1.7, 2.4, 0.8, 0.6, 'E', { rnd: K.rand });
    picture(K, -H0, 1.7, 4.7, 0.6, 0.8, 'E', { rnd: K.rand });
  } else if (v === 1) {
    // a long bar along the back wall
    barLine(0.9, 3.95, 0, 5.0, { tapsAt: 0.3, staffAt: -0.3 });
    // booths on the left wall, the neon over them
    for (const z of [2.62, 4.36]) {
      booth(K, -2.86, z, { dz: 0.66, depth: 0.42, back: 1.3, w: 1.16, top: 0x4a3020, leg: C.char, seat: { col: 0x5a2a1c }, lay: (y) => { glass(-0.25, -0.1, y); glass(0.2, 0.12, y); glass(0.32, -0.14, y); } });
      lamp(-2.86, z);
    }
    neon(-H0 + 0.05, 3.5, W);
    // a rail to drink at along the window, high tables between it and the bar
    windowBar(K, -1.3, 3.2, [-0.9, 0.0, 0.9, 1.8, 2.7], { h: 1.06, top: 0x4a3020, leg: C.char, stoolO: { seat: 0x5a2a1c } });
    for (const x of [-0.6, 1.3, 2.4]) glass(x, 0.3, 1.06);
    highTable(0.5, 2.05, (at) => { K.spot(-0.1, 2.05, E, 'drink', at); K.spot(1.1, 2.1, W, 'drink', at); });
    highTable(2.6, 2.05, (at) => { stoolAt(2.05, 2.05, E, at); stoolAt(3.15, 2.05, W, at); });
    tv(H0, 1.3, E);
    darts(H0 - 0.03, 3.1, S);
  } else {
    // the bar out into the room from the back wall: a front and two arms, the back-bar between them, stools round it
    counter(K, -1.3, 1.9, 3.2, 0.6, 1.08, CS);
    counter(K, 3.8, 5.45, -1.3, 0.6, 1.08, { ...CS, alongZ: true });
    counter(K, 3.8, 5.45, 1.9, 0.6, 1.08, { ...CS, alongZ: true, flip: -1 });
    K.group(0, 0, 0, () => {
      K.rod(-1.3, 0.18, 3.11, 1.9, 0.18, 3.11, 0.022, C.brass, { seg: 5 });
      K.rod(-1.39, 0.18, 3.2, -1.39, 0.18, 5.4, 0.022, C.brass, { seg: 5 });
      K.rod(1.99, 0.18, 3.2, 1.99, 0.18, 5.4, 0.022, C.brass, { seg: 5 });
    }, { stretch: true });
    backBar(0.3, D0, 0, 1.9);
    taps(0.3, 3.5, 0);
    glass(-0.9, 3.4); glass(1.45, 3.45); glass(-1.0, 4.5); glass(1.6, 4.85); glass(1.05, 3.38);
    for (const x of [-0.9, -0.1, 0.7, 1.5]) pinned(K, x, 3.2, (at) => stoolAt(x, 2.75, N, at));
    for (const z of [4.15, 4.95]) { pinned(K, -1.3, z, (at) => stoolAt(-1.75, z, E, at)); pinned(K, 1.9, z, (at) => stoolAt(2.35, z, W, at)); }
    lamp(-0.7, 3.5); lamp(1.3, 3.5); lamp(-1.0, 4.7); lamp(1.6, 4.7);
    K.spot(0.3, 4.35, S, 'counter', { role: 'staff', h: 1.08, roam: 0.6 });
    // a pool table by the window, a long lamp over it
    K.group(1.55, 1.3, 0, () => {
      K.box(0, 0.6, 0, 2.1, 0.22, 1.15, 0x3a2416);
      K.box(0, 0.82, 0, 1.86, 0.012, 0.91, 0x2a7a4a);
      for (const s of [-1, 1]) { K.box(0, 0.82, s * 0.515, 2.1, 0.04, 0.12, 0x4a3020); K.box(s * 0.99, 0.82, 0, 0.12, 0.04, 0.91, 0x4a3020); }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.9, 0, sz * 0.43, 0.13, 0.6, 0.13, 0x2c1c12, { faces: 'fbrl' });
      [[-0.5, 0.1, 0xf4f1ea], [0.35, -0.05, 0xc9a227], [0.42, 0.04, 0xb0392b], [0.5, -0.12, 0x2a5aa6], [0.52, 0.12, 0x161618], [0.6, 0.0, 0x8e44ad], [0.1, 0.3, 0xd35400]].forEach(([bx, bz, c]) => K.sph(bx, 0.86, bz, 0.03, c, { ws: 6, hs: 4 }));
      K.rod(-0.85, 0.87, -0.3, 0.2, 0.87, -0.38, 0.012, C.oak, { seg: 4 });
      K.shadow(0, 0, 2.4, 1.45, 0.6);
      K.box(0, 1.95, 0, 1.3, 0.14, 0.32, 0x1f5a3a);
      K.plane(0, 1.945, 0, 1.2, 0.26, 'D', 0xffe6b8, { glow: 1 });
      for (const s of [-1, 1]) K.box(s * 0.5, 2.09, 0, 0.012, HT - 2.09, 0.012, C.black, { faces: 'fbrl' });
    });
    K.spot(0.15, 1.3, E, 'lean', pin(K, 1.55, 1.3));
    K.spot(3.0, 1.25, W, 'drink', pin(K, 1.55, 1.3));
    // a high table inside the door
    highTable(-1.1, 1.75, (at) => { stoolAt(-1.65, 1.75, E, at); K.spot(-1.05, 2.3, S, 'drink', at); });
    neon(-H0 + 0.05, 3.9, W);
    darts(-H0 + 0.03, 2.4, 0);
    tv(H0, 3.5, E);
    picture(K, H0, 1.7, 1.3, 0.8, 0.6, 'W', { rnd: K.rand });
  }
}

// rows of books on a shelf, their spines to +z (as the core's `books`, in fewer triangles: wider books, and no side
// drawn where a taller neighbour hides it)
function tomes(K, x0, x1, y, depth, level, room) {
  const row = [];
  let x = x0;
  while (x < x1 - 0.04) {
    const r = K.rand();
    if (r < 0.06) { x += 0.08 + K.rand() * 0.14; row.push(null); continue; }
    if (r < 0.1 && x < x1 - 0.3) {
      // a pile lying flat
      const n = 2 + Math.floor(K.rand() * 3);
      for (let j = 0; j < n; j++) K.box(x + 0.12, y + j * 0.035, depth - 0.1, 0.22, 0.032, 0.15, K.pick(MUTED.concat(BRIGHTS)), { faces: 'ftrl' });
      x += 0.27; row.push(null);
      continue;
    }
    const w = 0.034 + K.rand() * 0.05;
    row.push({ x, w, h: Math.min(room, room * (0.62 + K.rand() * 0.36)), col: K.rand() < 0.8 ? K.pick(MUTED) : K.pick(BRIGHTS), z: depth - 0.03 - K.rand() * 0.03, k: 0.75 + K.rand() * 0.3 });
    x += w;
  }
  row.forEach((b, i) => {
    if (!b) return;
    const p = row[i - 1], n = row[i + 1];
    K.box(b.x + b.w / 2, y, b.z, b.w - 0.004, b.h, 0.16, b.col, { faces: 'ft' + (p && p.h >= b.h ? '' : 'l') + (n && n.h > b.h ? '' : 'r'), k: b.k });
  });
}

// A bookshop. 0: cases round the walls, a low case across the room, the desk at the back; 1: tall stacks out from
// the back wall with aisles between, the desk on a side wall; 2: a reading table down the room, the desk by the window
function bookshop(K, v = 0) {
  K.shell();
  const dark = 0x2a1e16, wood = 0x4a3323;
  // a case against a wall, `w` long in `bays`
  const wallCase = (x, z, ry, w, bays, levels = 6, h = 2.5) => K.group(x, z, ry, () => {
    shelves(K, w, h, 0.3, levels, { frame: wood, back: dark, fill: tomes });
    for (let i = 1; i < bays; i++) K.box(-w / 2 + (w * i) / bays, 0, 0.15, 0.03, h, 0.3, wood);
  }, { stretch: true });
  // a case standing in the room, books both sides; a low one has a few face out along its top
  const island = (x, z, ry, w, h = 1.4, levels = 3) => {
    for (const r of [S, N]) K.group(x, z, ry + r, () => shelves(K, w, h, 0.26, levels, { frame: wood, back: dark, fill: tomes }));
    K.group(x, z, ry, () => {
      if (h < 1.6) for (let i = 0; i < 6; i++) K.box(-1.1 + i * 0.44, h + 0.01, 0, 0.2, 0.28, 0.03, K.pick(BRIGHTS), { rx: i % 2 ? 0.2 : -0.2 });
      K.shadow(0, 0, w + 0.3, 1.0);
    });
  };
  // a table of new books, piled
  const frontTable = (x, z) => K.group(x, z, 0, () => {
    K.box(0, 0.66, 0, 1.55, 0.06, 0.85, wood);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 0.68, 0, sz * 0.34, 0.07, 0.66, 0.07, wood, { faces: 'fbrl' });
    K.shadow(0, 0, 1.9, 1.15);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
      const n = 2 + Math.floor(K.rand() * 4), tw = K.rand() * 0.5;
      for (let k = 0; k < n; k++) K.box(-0.6 + i * 0.3, 0.72 + k * 0.04, -0.2 + j * 0.4, 0.2, 0.038, 0.27, K.pick(K.rand() < 0.5 ? BRIGHTS : MUTED), { ry: tw + (K.rand() - 0.5) * 0.3 });
    }
    for (const bx of [-0.45, 0.15, 0.6]) K.box(bx, 0.74, 0, 0.19, 0.27, 0.025, K.pick(BRIGHTS), { rx: 0.25 });
  });
  const rug = (x, z, w, d) => K.group(x, z, 0, () => K.plane(0, 0.008, 0, w, d, 'U', 0xffffff, { slot: SLOT.accent, k: 0.8 }));
  const floorLamp = (x, z) => K.group(x, z, 0, () => {
    K.cyl(0, 0, 0, 0.15, 0.025, C.brass, { seg: 8 }); K.cyl(0, 0.02, 0, 0.015, 1.45, C.brass, { seg: 5, open: true });
    K.cyl(0, 1.42, 0, 0.2, 0.26, 0xf2dcae, { seg: 10, r2: 0.13, open: true, glow: 0.9 });
  });
  // a ladder on the back wall's shelves
  const ladder = (x) => K.group(x, 4.72, 0, () => {
    for (const lx of [-0.24, 0.24]) K.rod(lx, 0, 0, lx, 2.5, 0.45, 0.025, C.oak);
    for (let i = 1; i < 8; i++) K.rod(-0.24, i * 0.3, i * 0.054, 0.24, i * 0.3, i * 0.054, 0.018, C.oak);
  });
  // the desk, the till on it, and who keeps the shop behind it (at +z as placed: ry 0 with their back to the back
  // wall, W to the left wall, E to the right)
  const desk = (x, z, ry) => K.group(x, z, ry, () => {
    K.box(0, 0, 0, 1.3, 0.98, 0.5, wood); K.box(0, 0.98, 0, 1.38, 0.04, 0.58, C.oak);
    for (let k = 0; k < 4; k++) K.box(0.4, 1.02 + k * 0.04, 0, 0.2, 0.038, 0.27, K.pick(MUTED), { ry: k * 0.2 });
    K.shadow(0, 0, 1.6, 0.9);
    till(K, -0.25, 1.02, 0.05);
    K.spot(0.05, 0.6, S, 'counter', { role: 'staff', h: 1.0, roam: 0.2, ...pin(K, 0, 0) });
  });
  const lamp = (x, z) => pendant(K, x, z, 2.15, { shade: 0x2f5a3a, r: 0.2 });

  if (v === 0) {
    wallCase(H0, 2.75, W, 4.9, 5); wallCase(-H0, 3.55, E, 3.3, 3); wallCase(0, D0, S, 6.3, 6);
    K.group(0, 0, 0, () => K.box(0, 2.5, D0 - 0.15, 6.4, 0.08, 0.34, wood), { stretch: true });
    island(0.7, 3.3, 0, 2.7);
    frontTable(0.45, 1.3);
    // a chair to read in, a lamp, a rug
    rug(2.45, 1.25, 1.9, 1.7);
    armchair(K, 2.55, 1.2, -2.2, { spot: { pose: 'read' } });
    floorLamp(3.1, 0.55);
    ladder(-1.6);
    desk(-2.35, 4.35, 0);
    lamp(0.45, 1.3); lamp(-1.2, 2.6);
    ceilingPanel(K, 1.6, 4.2, 1.2, 0.5); ceilingPanel(K, -1.4, 4.2, 1.2, 0.5); ceilingPanel(K, 2.0, 2.2, 1.2, 0.5);
    K.spot(2.82, 3.3, E, 'browse');
    K.spot(-0.5, 1.3, E, 'lean', pin(K, 0.45, 1.3));
    K.spot(0.3, 2.62, N, 'browse', pin(K, 0.7, 3.3));
    K.spot(1.7, 4.82, N, 'browse');
    K.spot(-2.85, 3.0, W, 'browse');
  } else if (v === 1) {
    // two tall stacks out from the back wall, aisles between them; cases on the right wall and at the back left
    wallCase(H0, 2.75, W, 4.4, 4, 5);
    wallCase(-2.0, D0, S, 2.6, 2, 5);
    island(0.1, 4.1, E, 2.5, 1.8, 4); island(1.75, 4.1, E, 2.5, 1.8, 4);
    ladder(-1.4);
    // the desk on the left wall, a board of notices behind it
    desk(-2.55, 3.0, W);
    picture(K, -H0, 1.8, 3.0, 1.1, 0.75, 'E', { rnd: K.rand });
    frontTable(-0.5, 1.35);
    // two chairs to read in by the window
    rug(2.1, 1.2, 2.1, 1.7);
    armchair(K, 1.5, 1.2, 1.25, { spot: { pose: 'read' } });
    armchair(K, 2.7, 1.15, -1.25, { spot: { pose: 'read', prio: 7 } });
    floorLamp(2.1, 0.5);
    lamp(-0.5, 1.35); lamp(-1.6, 3.0);
    ceilingPanel(K, 0.92, 4.2, 0.6, 1.4); ceilingPanel(K, 2.6, 4.0, 0.6, 1.4); ceilingPanel(K, -1.5, 4.3, 1.2, 0.5);
    K.spot(-1.7, 3.05, W, 'counter', { h: 1.0, prio: 4, ...pin(K, -2.55, 3.0) });
    K.spot(1.1, 3.9, E, 'browse', pin(K, 1.75, 4.1));
    K.spot(2.8, 3.6, E, 'browse');
    K.spot(-0.5, 2.05, S, 'lean', pin(K, -0.5, 1.35));
    K.spot(-0.55, 4.3, E, 'browse', pin(K, 0.1, 4.1));
    K.spot(-2.3, 4.85, N, 'browse');
  } else {
    // cases round the back of the room, a long table to read at down the middle
    wallCase(-H0, 3.55, E, 3.3, 3, 5, 2.3); wallCase(0, D0, S, 6.3, 6, 5, 2.3); wallCase(H0, 4.05, W, 2.3, 2, 5, 2.3);
    K.group(0, 0, 0, () => K.box(0, 2.3, D0 - 0.15, 6.4, 0.08, 0.34, wood), { stretch: true });
    ladder(1.9);
    K.group(0.2, 3.3, 0, () => {
      K.box(0, 0.69, 0, 2.6, 0.05, 0.9, C.oak);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * 1.2, 0, sz * 0.36, 0.08, 0.69, 0.08, wood, { faces: 'fbrl' });
      K.box(0, 0.28, 0, 2.4, 0.05, 0.06, wood);
      K.shadow(0, 0, 2.9, 1.2, 0.62);
      // green-shaded lamps, a book open at each place
      for (const lx of [-0.4, 0.4]) {
        K.cyl(lx, 0.74, 0, 0.07, 0.02, C.brass, { seg: 6 }); K.cyl(lx, 0.76, 0, 0.012, 0.26, C.brass, { seg: 4, open: true });
        K.box(lx, 1.02, 0, 0.3, 0.07, 0.13, 0x1f6a3f, { glow: 0.5 });
        K.plane(lx, 1.018, 0, 0.26, 0.1, 'D', 0xffe6b8, { glow: 1 });
      }
      for (const bx of [-0.8, 0, 0.8]) for (const s of [-1, 1]) {
        for (const p of [-1, 1]) K.box(bx + p * 0.085, 0.74, s * 0.25, 0.16, 0.012, 0.22, C.paper, { rz: p * 0.08 });
      }
      for (let k = 0; k < 3; k++) K.box(1.1, 0.74 + k * 0.04, 0.05, 0.2, 0.038, 0.27, K.pick(MUTED), { ry: k * 0.25 });
    });
    pinned(K, 0.2, 3.3, (at) => {
      for (const bx of [-0.8, 0, 0.8]) {
        chair(K, 0.2 + bx, 2.62, N, { frame: wood, spot: sitAt({ pose: 'read', ...at }) });
        chair(K, 0.2 + bx, 3.98, S, { frame: wood, spot: sitAt({ pose: 'read', ...at }) });
      }
    });
    // the desk by the window on the right, pictures on the wall behind it
    desk(2.55, 1.45, E);
    for (const [z, w, h] of [[0.95, 0.6, 0.8], [1.9, 0.9, 0.65]]) picture(K, H0, 1.85, z, w, h, 'W', { rnd: K.rand });
    frontTable(-0.4, 1.2);
    lamp(-0.4, 1.2);
    ceilingPanel(K, -0.6, 3.3, 1.0, 0.5); ceilingPanel(K, 1.0, 3.3, 1.0, 0.5); ceilingPanel(K, 0.2, 4.7, 1.6, 0.4);
    K.spot(1.75, 1.5, E, 'counter', { h: 1.0, prio: 4, ...pin(K, 2.55, 1.45) });
    K.spot(-2.85, 3.3, W, 'browse', { prio: 2 });
    K.spot(-1.6, 4.85, N, 'browse', { prio: 3 });
    K.spot(2.85, 4.4, E, 'browse', { prio: 6 });
    K.spot(-0.4, 1.85, S, 'lean', { prio: 6, ...pin(K, -0.4, 1.2) });
  }
}

// A plain shop. 0: shelves round the walls, tables of things, a counter at the back; 1: the counter on the door's
// wall, two runs of shelves standing in the room, plinths in the window; 2: one long counter across the back with
// the shelves behind it, round stands in the room
function retail(K, v = 0) {
  K.shell();
  const stock = goods(BRIGHTS.concat(MUTED), { size: 0.2, tall: 0.28 });
  const FR = { frame: 0x8a8376, back: 0xa9a294, fill: stock };
  const wallShelf = (x, z, ry, w, h = 2.1, levels = 5) => K.group(x, z, ry, () => shelves(K, w, h, 0.32, levels, FR), { stretch: true });
  // a table of things, `w` long
  const table = (x, z, w) => K.group(x, z, 0, () => {
    K.box(0, 0, 0, w - 0.2, 0.4, 0.6, 0x6a655c);
    K.box(0, 0.74, 0, w, 0.05, 0.8, C.oak);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(sx * (w / 2 - 0.06), 0, sz * 0.33, 0.05, 0.74, 0.05, C.oak, { faces: 'fbrl' });
    K.shadow(0, 0, w + 0.3, 1.1);
    stock(K, -w / 2 + 0.08, w / 2 - 0.08, 0.79, 0.3, 0, 0.3);
    K.group(0, 0, S, () => stock(K, -w / 2 + 0.08, w / 2 - 0.08, 0.79, 0.3, 0, 0.3));
  });
  for (const [x, z] of [[-1.5, 1.8], [1.5, 1.8], [-1.5, 3.8], [1.5, 3.8]]) ceilingPanel(K, x, z, 1.2, 0.5);

  if (v === 0) {
    wallShelf(H0, 2.75, W, 4.8); wallShelf(-H0, 3.7, E, 3.0); wallShelf(-1.2, D0, S, 3.6);
    table(0.5, 1.35, 1.5); table(-0.3, 3.1, 1.3);
    counter(K, 1.3, 3.1, 4.3, 0.6, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak });
    till(K, 2.5, 1.0, 4.6);
    K.spot(2.3, 5.05, S, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
    K.spot(2.8, 2.6, E, 'browse');
    K.spot(0.5, 2.0, S, 'lean', pin(K, 0.5, 1.35));
    K.spot(-2.8, 3.4, W, 'browse');
    K.spot(1.9, 3.75, N, 'counter', { h: 1.0, ...pin(K, 1.9, 4.3) });
  } else if (v === 1) {
    // the counter on the left wall inside the door, a sign on the wall behind it
    counter(K, 2.0, 3.8, -2.3, 0.6, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak, alongZ: true, flip: -1 });
    till(K, -2.6, 1.0, 2.5, W);
    K.group(-H0 + 0.014, 2.9, 0, () => {
      K.plane(0, 2.0, 0, 1.7, 0.55, 'E', 0xffffff, { slot: SLOT.accent });
      K.plane(0.006, 2.0, 0, 1.2, 0.16, 'E', 0xf2efe6);
    });
    // shelves along the back and the right wall, and two runs standing in the room
    wallShelf(0, D0, S, 6.2); wallShelf(H0, 2.85, W, 4.6);
    for (const x of [-0.3, 1.45]) {
      for (const r of [E, W]) K.group(x, 3.3, r, () => shelves(K, 2.2, 1.4, 0.3, 3, FR));
      K.group(x, 3.3, 0, () => K.shadow(0, 0, 0.9, 2.5));
    }
    table(-0.6, 1.25, 1.4); table(-1.9, 4.35, 1.2);
    // white plinths in the window, a thing on each
    for (const [x, z, h, c] of [[1.0, 0.85, 0.45, 0], [1.75, 1.05, 0.8, 4], [2.5, 0.8, 0.6, 7]]) {
      K.group(x, z, 0, () => {
        K.box(0, 0, 0, 0.5, h, 0.5, 0xeeeae2);
        if (c % 2) { K.cyl(0, h, 0, 0.11, 0.3, BRIGHTS[c], { seg: 8, r2: 0.06 }); K.sph(0, h + 0.36, 0, 0.09, BRIGHTS[c + 1], { ws: 6, hs: 4 }); }
        else { K.box(0, h, 0, 0.3, 0.22, 0.24, BRIGHTS[c]); K.box(0.02, h + 0.22, 0, 0.2, 0.14, 0.18, BRIGHTS[c + 2], { ry: 0.4 }); }
        K.shadow(0, 0, 0.75, 0.75, 0.66);
      });
    }
    K.spot(-3.2, 2.9, E, 'counter', { role: 'staff', h: 1.0, roam: 0.3 });
    K.spot(-1.75, 2.9, W, 'counter', { h: 1.0, prio: 3, ...pin(K, -2.3, 2.9) });
    K.spot(0.5, 3.3, W, 'browse', pin(K, -0.3, 3.3));
    K.spot(2.75, 3.4, E, 'browse');
    K.spot(-1.55, 1.25, E, 'lean', pin(K, -0.6, 1.25));
    K.spot(-0.8, 4.85, N, 'browse');
    K.spot(1.9, 1.75, S, 'browse', { prio: 6 });
  } else {
    // one long counter across the back, a glass case let into it, the shelves on the wall behind it
    wallShelf(0.45, D0, S, 5.5, 2.4, 6);
    counter(K, -2.3, 3.2, 3.95, 0.6, 1.0, { front: 0xffffff, slot: SLOT.accent, top: C.oak });
    till(K, 0.3, 1.0, 4.25);
    K.group(2.1, 4.25, 0, () => {
      K.box(0, 1.0, 0, 1.5, 0.3, 0.5, 0xcfe0e0, { faces: 'fbrl' });
      K.box(0, 1.3, 0, 1.54, 0.02, 0.54, 0xdfe6e8);
      for (let i = 0; i < 6; i++) K.box(-0.6 + i * 0.24, 1.0, 0, 0.14, 0.08 + (i % 3) * 0.05, 0.2, K.pick(BRIGHTS));
    });
    for (const [x, c] of [[-1.7, 0xc9a227], [-1.4, 0xb0392b], [-1.1, 0x2a7a4a]]) { K.cyl(x, 1.0, 4.25, 0.1, 0.24, 0xcfe0e4, { seg: 8, open: true }); K.cyl(x, 1.0, 4.25, 0.085, 0.17, c, { seg: 6 }); K.cyl(x, 1.24, 4.25, 0.105, 0.03, C.chrome, { seg: 8 }); }
    // low shelves under pictures on the right wall, a tall case on the left
    K.group(H0, 2.0, W, () => shelves(K, 2.8, 1.2, 0.32, 3, FR), { stretch: true });
    for (const [z, w, h] of [[1.3, 0.9, 0.7], [2.6, 0.7, 0.9]]) picture(K, H0, 1.95, z, w, h, 'W', { rnd: K.rand });
    wallShelf(-H0, 2.85, E, 1.4);
    // round stands of things in the room
    for (const [x, z] of [[-0.5, 2.3], [1.3, 1.35]]) {
      K.group(x, z, 0, () => {
        K.cyl(0, 0, 0, 0.3, 0.7, 0x6a655c, { seg: 10 });
        K.cyl(0, 0.7, 0, 0.6, 0.05, C.oak, { seg: 14 });
        K.cyl(0, 0.75, 0, 0.27, 0.26, C.oak, { seg: 12 });
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * PI * 2, hgt = 0.12 + K.rand() * 0.14;
          K.box(Math.cos(a) * 0.44, 0.75, Math.sin(a) * 0.44, 0.17, hgt, 0.14, K.pick(BRIGHTS), { ry: -a + E });
        }
        for (let i = 0; i < 4; i++) K.cyl(Math.cos(i * 1.57 + 0.4) * 0.14, 1.01, Math.sin(i * 1.57 + 0.4) * 0.14, 0.06, 0.2 + (i % 2) * 0.07, K.pick(MUTED), { seg: 6 });
        K.shadow(0, 0, 1.45, 1.45, 0.62);
      });
    }
    K.spot(0.3, 4.85, S, 'counter', { role: 'staff', h: 1.0, roam: 0.5 });
    K.spot(0.3, 3.4, N, 'counter', { h: 1.0, prio: 2, ...pin(K, 0.3, 3.95) });
    K.spot(2.75, 2.0, E, 'browse');
    K.spot(0.4, 2.3, W, 'browse', pin(K, -0.5, 2.3));
    K.spot(-2.75, 2.85, W, 'browse');
    K.spot(1.9, 3.38, N, 'lean', { prio: 6, ...pin(K, 1.9, 3.95) });
  }
}

const KITS = { restaurant, fast_food, cafe, bakery, bar, books: bookshop, retail, ...KITS_B };
// (and the kinds of restaurant, shop-kits-c.js: 'c_pizza' and the rest)
for (const name in KITS_C) { KITS['c_' + name] = KITS_C[name]; STYLES['c_' + name] = STYLES_C[name]; }
// How many different layouts a kind has: its function is called with (K, v), v from 0 to one less than this, and
// lays the room out differently for each (the counter on another side, booths for tables, other shelving runs,
// the staff elsewhere), still plainly its kind. shop-interiors.js picks one per business, so two neighbours of a kind
// differ. A kind not listed has the one.
const VARIANTS = { restaurant: 3, fast_food: 3, cafe: 3, bar: 3, books: 3, retail: 3 };
for (const [name, n] of Object.entries({ ...VARIANTS_B })) VARIANTS[name] = n;
for (const [name, n] of Object.entries({ ...VARIANTS_C })) VARIANTS['c_' + name] = n;
export const KIT_NAMES = Object.keys(KITS);
export const kitVariants = (name) => VARIANTS[name] || 1;
const built = new Map();
// a kind's kit: { geometry, spots, triangles }, built the first time it's wanted; `name` is the kind, or the kind,
// '~' and which of its layouts ('cafe~1')
export function shopKit(name) {
  let k = built.get(name);
  if (!k) {
    const [base, v = '0'] = name.split('~');
    const K = new Kit(name.length * 977 + name.charCodeAt(0) * 31 + name.charCodeAt(name.length - 1));
    (KITS[base] || KITS.retail)(K, Math.min(+v, kitVariants(base) - 1));
    k = K.build();
    built.set(name, k);
  }
  return k;
}
export { HT, D0, H0 };
