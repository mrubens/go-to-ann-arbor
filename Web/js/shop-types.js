import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { hot } from '../lamp-game.js';

// Lamp: what kind of business each named storefront is, and which shopfront bays are its own.
//
// The kinds (data/shop-types.json, Assets/Tools/build-shop-types.py: OpenStreetMap's amenity / shop / cuisine tags of
// the place each of GEO.signs' signs came from), one per sign. 0 is a shopfront nobody named: the generic shop.
// `variants` marks the ones that show something more: a barber (a pole by the door), a cinema, a supermarket.
//
// The bays: a shop wall is cut into bays about 7.5 m wide (createStorefront, tsl-materials.js), each with a door and a
// display window. As the walls are built (building-footprints.js asks `shopWallRow` for each shop wall) every sign on a
// wall takes the bay it hangs over (the next free one when two share a bay), and the bay beside it when that one is
// nobody's (two beside a supermarket), so a wide restaurant isn't half shelves. A wall with a named bay gets a row
// in a small texture, one texel per bay: r = kind + 32 where its sign hangs + 64 for a variant, g = a number that
// is the business's own (the same in each of its bays). The wall's `kind` attribute carries the row; the shader reads
// the texel at (bay, row). The signs then hang centred over their own bays (`signPlace`, shop-signs.js).

export const SHOP_TYPES = ['unknown', 'restaurant', 'fast_food', 'cafe', 'bakery', 'bar', 'books', 'apparel',
  'jewelry_gift', 'grocery', 'salon', 'bank', 'medical', 'bike_sports', 'dispensary', 'gallery', 'theatre', 'retail', 'service'];
export const SHOP = Object.fromEntries(SHOP_TYPES.map((n, i) => [n, i]));
// the kinds of restaurant (and of fast food place): data/shop-types.json `cuisine`, one per sign, 0 what's neither
export const SHOP_CUISINES = ['generic', 'pizza', 'mexican', 'chinese', 'japanese', 'korean', 'noodles', 'indian', 'mediterranean',
  'italian', 'diner', 'burger', 'sandwich', 'chicken', 'steakhouse', 'seafood', 'barbecue'];
export const BAY_WIDTH = 7.5;
export const SHOP_BAY_COLS = 32, SHOP_BAY_ROWS = 2048;

// kept while the game's code runs again for a change: the materials made with it are (lamp-game.js)
export const shopBayMap = hot(import.meta).keep('shopBayMap4', () => {
  const tex = new THREE.DataTexture(new Uint8Array(SHOP_BAY_COLS * SHOP_BAY_ROWS * 4), SHOP_BAY_COLS, SHOP_BAY_ROWS,
    THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'ShopBays';
  tex.needsUpdate = true;
  return tex;
});

const state = hot(import.meta).keep('shopTypeState', () => ({ types: null, variants: null, placed: new Map(), nextRow: 1, grid: null }));
// every named bay as the walls were built, for the rooms behind the glass (shop-interiors.js): where it is, whose, and
// the building it's in; `hour` is the town's hour as the shopfronts last heard it (setShopHour, tsl-materials.js)
state.bays ??= [];
state.hour ??= 12;
export const shopBays = () => state.bays;
// every building's outline as it stands (buildings.js's colliders with a `polygon`), so a room is never set where a
// neighbouring building's walls run through it (shop-interiors.js)
state.outlines ??= [];
export const setShopOutlines = (list) => { state.outlines = list.filter((c) => c.polygon); };
export const shopOutlines = () => state.outlines;
export const shopHour = () => state.hour;
export const noteShopHour = (h) => { state.hour = h; };
// a business's own number (the bay texture's g), and the side its door is on in bay `col` (as createStorefront has it)
export const bizNumber = (i) => (i * 97 + 31) % 251 + 2;
export const bayDoorLeft = (biz, col) => (biz + col) % 2 === 1;
// a bay with a room behind its glass (shop-interiors.js): the 128s bit of its texel, which the shopfront's shader
// reads to leave its glass out near the camera
export function markBayRoom(bay, on = true) {
  const at = (bay.row * SHOP_BAY_COLS + bay.col) * 4;
  const d = shopBayMap.image.data;
  const v = on ? d[at] | 128 : d[at] & 127;
  if (v !== d[at]) { d[at] = v; shopBayMap.needsUpdate = true; }
}

const CELL = 40;
const signCount = () => ((GEO.signs && GEO.signs.list.length) || 0) / 7;

export function setShopTypes(data) {
  const n = signCount();
  state.types = new Uint8Array(n);
  state.variants = new Uint8Array(n);
  state.cuisines = new Uint8Array(n);
  if (data && data.list) {
    const kinds = (data.cuisines || []).map((name) => Math.max(0, SHOP_CUISINES.indexOf(name)));
    for (let i = 0; i < n && data.cuisine && i < data.cuisine.length; i++) state.cuisines[i] = kinds[data.cuisine[i]] || 0;
    // by name, should the file's order of kinds ever differ from this file's
    const remap = (data.types || SHOP_TYPES).map((name) => SHOP[name] ?? SHOP.retail);
    for (let i = 0; i < n && i < data.list.length; i++) {
      state.types[i] = remap[data.list[i]] ?? 0;
      state.variants[i] = (data.variants && data.variants[i]) || 0;
    }
  }
  state.grid = new Map();
  const list = (GEO.signs && GEO.signs.list) || [];
  for (let i = 0; i < n; i++) {
    const k = Math.floor(list[i * 7] / CELL) + ',' + Math.floor(list[i * 7 + 1] / CELL);
    if (!state.grid.has(k)) state.grid.set(k, []);
    state.grid.get(k).push(i);
  }
}

// is a named business's sign on the front through (x, z) with the outward normal (nx, nz), within `half` metres along
// it? (building-details.js: no scaffold shed goes up over a named shopfront)
export function namedFront(x, z, nx, nz, half) {
  if (!state.grid || !state.types) return false;
  const list = GEO.signs.list;
  for (let cx = Math.floor((x - half - 2) / CELL); cx <= Math.floor((x + half + 2) / CELL); cx++) {
    for (let cz = Math.floor((z - half - 2) / CELL); cz <= Math.floor((z + half + 2) / CELL); cz++) {
      for (const i of state.grid.get(cx + ',' + cz) || []) {
        if (!state.types[i]) continue;
        const rx = list[i * 7] - x, rz = list[i * 7 + 1] - z, deg = (list[i * 7 + 2] * Math.PI) / 180;
        if (Math.abs(rx * -nz + rz * nx) < half && Math.abs(rx * nx + rz * nz - 0.18) < 1.2 && Math.sin(deg) * nx + Math.cos(deg) * nz > 0.8) return true;
      }
    }
  }
  return false;
}
// the canvas awnings as they were hung (building-details.js, lifted onto their ground by buildings.js): a business
// under one has its name on the awning's valance, not on a board behind it (shop-signs.js)
state.awnings ??= [];
export const setShopAwnings = (list) => { state.awnings = list; };
export function awningOver(x, z, nx, nz) {
  let best = null, bestD = 9;
  for (const a of state.awnings) {
    if (Math.abs(a.x - x) > 9 || Math.abs(a.z - z) > 9) continue;
    const ax = Math.cos(a.ry), az = -Math.sin(a.ry); // the way it faces
    if (ax * nx + az * nz < 0.9) continue;
    const rx = x - (a.x - ax * 0.75), rz = z - (a.z - az * 0.75); // from where it meets the wall
    const along = Math.abs(rx * -az + rz * ax), out = Math.abs(rx * ax + rz * az);
    if (out < 1.2 && along < Math.min(bestD, a.d / 2 + 0.35)) { best = a; bestD = along; }
  }
  return best;
}

export const signType = (i) => (state.types ? state.types[i] : 0);
export const signVariant = (i) => (state.variants ? state.variants[i] : 0);
export const signCuisine = (i) => (state.cuisines ? state.cuisines[i] : 0);
// where a sign hangs once the walls are built: { x, z, w } centred over its own bay, or undefined (as placed)
export const signPlace = (i) => state.placed.get(i);

// before the city's walls are built (again)
export function beginShopBays() {
  state.placed.clear();
  state.nextRow = 1;
  state.bays = [];
  shopBayMap.image.data.fill(0);
  shopBayMap.needsUpdate = true;
}

// The row of the bay texture for the shop wall from a to b ({x, y: z}, the building on the left: its outward normal is
// (-dz, dx)), or 0 when no named business is on it
export function shopWallRow(a, b, record = null, polygon = null) {
  if (!state.grid || !state.types) return 0;
  const dx = b.x - a.x, dz = b.y - a.y, W = Math.hypot(dx, dz);
  // the bays, as createStorefront cuts them
  const bays = Math.max(Math.floor(W / BAY_WIDTH + 0.5), 1), width = W / bays;
  if (width < 2.4) return 0;
  const ux = dx / W, uz = dz / W, nx = -uz, nz = ux;
  const list = GEO.signs.list;
  const found = [];
  const x0 = Math.floor((Math.min(a.x, b.x) - 1) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + 1) / CELL);
  const z0 = Math.floor((Math.min(a.y, b.y) - 1) / CELL), z1 = Math.floor((Math.max(a.y, b.y) + 1) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      for (const i of state.grid.get(cx + ',' + cz) || []) {
        if (state.placed.has(i) || !state.types[i]) continue;
        const rx = list[i * 7] - a.x, rz = list[i * 7 + 1] - a.y;
        const s = rx * ux + rz * uz, d = rx * nx + rz * nz;
        const deg = (list[i * 7 + 2] * Math.PI) / 180;
        // a sign stands 0.18 m off its wall, facing the way the wall does
        if (s < 0 || s > W || Math.abs(d - 0.18) > 0.7 || Math.sin(deg) * nx + Math.cos(deg) * nz < 0.9) continue;
        found.push({ i, s });
      }
    }
  }
  if (!found.length) return 0;
  if (state.nextRow >= SHOP_BAY_ROWS) return 0;
  found.sort((p, q) => p.s - q.s);
  const cols = Math.min(bays, SHOP_BAY_COLS);
  const owner = new Array(cols).fill(-1);
  for (const f of found) {
    const want = Math.min(Math.floor(f.s / width), cols - 1);
    // its own bay, or the nearest free one beside it
    let bay = -1;
    for (const c of [want, f.s / width - want < 0.5 ? want - 1 : want + 1, f.s / width - want < 0.5 ? want + 1 : want - 1]) {
      if (c >= 0 && c < cols && owner[c] < 0) { bay = c; break; }
    }
    if (bay < 0) continue;
    owner[bay] = f.i;
    const c = (bay + 0.5) * width;
    state.placed.set(f.i, { x: a.x + ux * c + nx * 0.18, z: a.y + uz * c + nz * 0.18, w: Math.min(list[f.i * 7 + 3], Math.max(width - 0.7, 2)),
      ground: record ? record.ground : undefined }); // (the ground its building, and so its shopfront, stands on)
  }
  const row = state.nextRow++;
  const data = shopBayMap.image.data;
  for (let c = 0; c < cols; c++) {
    let i = owner[c], own = 32;
    if (i < 0) {
      own = 0;
      // nobody's: the business a bay away (a supermarket's reaches two)
      for (let r = 1; r <= 2 && i < 0; r++) {
        for (const o of [c - r, c + r]) {
          const j = o >= 0 && o < cols ? owner[o] : -1;
          if (j >= 0 && (r === 1 || (state.types[j] === SHOP.grocery && state.variants[j]))) { i = j; break; }
        }
      }
    }
    if (i < 0) continue;
    const at = (row * SHOP_BAY_COLS + c) * 4;
    data[at] = state.types[i] + own + (state.variants[i] ? 64 : 0);
    data[at + 1] = bizNumber(i);
    data[at + 2] = state.cuisines ? state.cuisines[i] : 0;
    if (record) {
      state.bays.push({ row, col: c, sign: i, type: state.types[i], own: own > 0, variant: state.variants[i] ? 1 : 0, biz: bizNumber(i), cuisine: state.cuisines ? state.cuisines[i] : 0,
        x: a.x + ux * (c + 0.5) * width, z: a.y + uz * (c + 0.5) * width, ux, uz, width, record, polygon });
    }
  }
  shopBayMap.needsUpdate = true;
  return row;
}

export function shopBayStats() {
  let own = 0, all = 0;
  const data = shopBayMap.image.data;
  for (let i = 0; i < data.length; i += 4) { if (data[i] & 31) all++; if (data[i] & 32) own++; }
  return { rows: state.nextRow - 1, bays: all, signs: own };
}

// ---------------------------------------------------------------------------------------------------------------------
// Opening hours: the share of each kind that is open at an hour of the day (0-24), [opens, closes, how many hours the
// doors open and close over]. A bay is open while its business's own number is under the share.
const HOURS = {
  unknown: [9, 21, 2], restaurant: [11, 22.5, 1.5], fast_food: [10, 25.5, 2.5], cafe: [6.5, 19.5, 2], bakery: [6.5, 19, 2],
  bar: [15, 26.2, 1], books: [10, 20.5, 1.5], apparel: [10, 20, 1.5], jewelry_gift: [10, 18.5, 1.5], grocery: [7, 23.5, 2.5],
  salon: [9, 19.5, 1.5], bank: [9, 17.2, 0.6], medical: [8, 19, 2.5], bike_sports: [10, 19.5, 1.5], dispensary: [9, 21.2, 1],
  gallery: [10.5, 18, 1.5], theatre: [12, 24.3, 1], retail: [10, 20, 2], service: [8.5, 18, 1.5]
};
export function shopOpenShares(hour) {
  return SHOP_TYPES.map((name) => {
    const [open, close, over] = HOURS[name];
    let best = 0;
    for (const h of [hour, hour + 24]) best = Math.max(best, Math.min(1, (h - open) / over + 0.5, (close - h) / over + 0.5));
    return Math.max(0, best);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// How each kind's shopfront looks, for createStorefront (tsl-materials.js): the room seen through the glass (walls,
// floor, light, what lines the back wall, what stands in the middle of the room, what hangs from the ceiling) and what
// is on the glass and the frame. Lengths in metres; colors as hex.
//   wall, floor, light  colors; day: how bright the room is by day; night: how bright its windows are after dark
//   ceil  [period along the wall (0: one long strip), share lit, period into the room, share lit] ceiling lights
//   back  [cell width, cell height, from, to (heights)] things in rows on the back wall, and
//         fill (share of a cell's width), low (the shortest thing, as a share of the cell's height), hue (how
//         many-colored, 0-1), glow (how much they light up), a / b (their two colors), some (share of cells filled),
//         shelf (a board under each row), lines (rows of writing on them), bandGlow (the wall behind them lit)
//   mid   what stands in the room, 1.5 m in: ['counter', from, to, glass case height, stools 0/1],
//         ['tables', period, cloth 0/1], ['racks', period], ['bikes', period],
//         ['blocks', period, from, to, table 0/1] (aisles of goods, a table of books), ['chairs', period, size]
//   midColor, top [period, width, height, shade] boxes standing on a counter (a till, an espresso machine, tellers' glass)
//   pendant: period of the lamps hanging over the room (0 none); neon: a neon tube on the back wall
//   open: a neon OPEN in the window; windows: 1 large, 2 small where the building's photo says nothing
//   frost: the glass frosted below this height; blinds: slats above this height; frame: the shopfront's paint
const D = {
  wall: 0x716557, floor: 0x33302b, light: 0xffd49a, day: 1, night: 0.55, ceil: [0, 1, 0, 0],
  back: [0.28, 0.55, 0.5, 2.3], fill: 0.76, low: 0.5, hue: 0, glow: 0, a: 0x88654a, b: 0x617b80, some: 0.7, shelf: 1, lines: 0, bandGlow: 0,
  mid: ['counter', 0.65, 1.1, 0, 0], midColor: 0x453a2d, top: [0, 0, 0, 0],
  pendant: 0, neon: 0, open: 0, windows: 0, frost: 0, blinds: 9, frame: null
};
const LOOKS = {
  unknown: {},
  restaurant: { wall: 0x9a5238, floor: 0x4a3020, light: 0xffc27a, day: 0.8, night: 0.9, ceil: [0, 0, 0, 0],
    back: [1.15, 0.95, 1.2, 2.15], fill: 0.58, low: 0.7, hue: 0.25, a: 0x9c8a66, b: 0x4c5a52, some: 0.6, shelf: 0,
    mid: ['tables', 1.9, 1], midColor: 0x1c110b, pendant: 1.9, open: 1, windows: 1 },
  fast_food: { wall: 0xd8d2c2, floor: 0x8c8478, light: 0xfff2dc, day: 1.15, night: 0.9, ceil: [0, 1, 1.2, 0.2],
    back: [1.25, 0.62, 1.85, 2.47], fill: 0.93, low: 0.95, hue: 0.12, glow: 0.5, a: 0xffe9b0, b: 0xffd27a, some: 1, shelf: 0, lines: 1,
    mid: ['counter', 0, 1.05, 0, 0], midColor: 0xb6382c, top: [1.7, 0.36, 0.3, 0.2], open: 1, windows: 1, frame: 0x8a8d88 },
  cafe: { wall: 0x8a6f52, floor: 0x6a4a30, light: 0xffcf96, day: 0.95, night: 1.0, ceil: [0, 0, 0, 0],
    back: [1.7, 0.85, 1.55, 2.4], fill: 0.9, low: 0.95, hue: 0, a: 0x232a2a, b: 0x2a2d28, some: 1, shelf: 0, lines: 1,
    mid: ['counter', 0, 1.02, 0.4, 0], midColor: 0x5a4330, top: [9, 0.8, 0.46, 0.75], pendant: 1.5, open: 1 },
  bakery: { wall: 0xe9dfcc, floor: 0x9a8c78, light: 0xfff0d8, day: 1.1, night: 0.8, ceil: [0, 1, 1.4, 0.2],
    back: [0.34, 0.42, 1.25, 2.3], fill: 0.8, low: 0.45, hue: 0.1, a: 0xc8914e, b: 0xe2c08a, some: 0.85, shelf: 1,
    mid: ['counter', 0, 1.2, 0.72, 0], midColor: 0xd9d2c4, top: [9, 0.4, 0.3, 0.3], open: 1 },
  bar: { wall: 0x241a16, floor: 0x18120e, light: 0xffa860, day: 0.5, night: 0.6, ceil: [0, 0, 0, 0],
    back: [0.105, 0.36, 1.08, 2.16], fill: 0.5, low: 0.5, hue: 0.4, a: 0x5a3414, b: 0x2c4a26, some: 0.92, shelf: 1, bandGlow: 0.4,
    mid: ['counter', 0, 1.08, 0, 1], midColor: 0x2e1c12, pendant: 2.4, neon: 1, open: 1, windows: 2, frame: 0x1d1e21 },
  books: { wall: 0x4a3626, floor: 0x5a4632, light: 0xffdcae, day: 0.95, night: 0.9, ceil: [0, 1, 1.6, 0.16],
    back: [0.058, 0.37, 0.12, 2.71], fill: 0.9, low: 0.72, hue: 0.8, a: 0x8a5a3a, b: 0x3a5a6a, some: 0.97, shelf: 1,
    mid: ['blocks', 2.6, 0.78, 1.02, 1], midColor: 0x3a2a1c },
  apparel: { wall: 0xe6e2da, floor: 0xa89c88, light: 0xfff6ea, day: 1.15, night: 0.8, ceil: [0.9, 0.16, 1.2, 0.14],
    back: [0.34, 0.26, 1.95, 2.73], fill: 0.86, low: 0.6, hue: 0.45, a: 0x8a93a0, b: 0xc9b89a, some: 0.85, shelf: 1,
    mid: ['racks', 2.5], midColor: 0x8a8d90, windows: 1 },
  jewelry_gift: { wall: 0x2c3140, floor: 0x3a342e, light: 0xfff1d6, day: 0.9, night: 0.9, ceil: [0.9, 0.14, 1.2, 0.12],
    back: [0.95, 0.72, 1.15, 2.23], fill: 0.7, low: 0.85, hue: 0.2, glow: 0.35, a: 0xe8dcc0, b: 0xcfd6dc, some: 0.8, shelf: 0,
    mid: ['counter', 0, 0.98, 0.5, 0], midColor: 0x2a2622 },
  grocery: { wall: 0xdde3e2, floor: 0xb9b6a8, light: 0xeaf6ff, day: 1.2, night: 1.0, ceil: [0, 1, 1.1, 0.24],
    back: [0.78, 1.95, 0.12, 2.07], fill: 0.9, low: 1, hue: 0.1, glow: 0.4, a: 0xcfe6ee, b: 0xbfdcea, some: 1, shelf: 0, lines: 1,
    mid: ['blocks', 2.4, 0.08, 1.56, 0], midColor: 0x8a8d8a, open: 1, frame: 0x8a8d88 },
  salon: { wall: 0xcfc4c4, floor: 0x5a5350, light: 0xfff4e6, day: 1.05, night: 0.8, ceil: [0.9, 0.16, 1.2, 0.14],
    back: [1.5, 1.5, 0.78, 2.28], fill: 0.6, low: 1, hue: 0, glow: 0.35, a: 0xdcecf0, b: 0xcfe2ea, some: 1, shelf: 0,
    mid: ['chairs', 1.5, 1.25], midColor: 0x1e1e22 },
  bank: { wall: 0xb9b6aa, floor: 0x8a8a84, light: 0xeef4f6, day: 0.95, night: 0.7, ceil: [0, 1, 1.3, 0.2],
    back: [1.6, 0.95, 1.1, 2.05], fill: 0.78, low: 0.95, hue: 0, a: 0x39454c, b: 0x45505a, some: 0.55, shelf: 0,
    mid: ['counter', 0, 1.1, 0, 0], midColor: 0x4a3a2c, top: [1.5, 0.07, 0.85, 0.35], frame: 0xb9b3a2 },
  medical: { wall: 0xdfe6e4, floor: 0x8f9a98, light: 0xf2faff, day: 1.05, night: 0.7, ceil: [0, 1, 1.3, 0.2],
    back: [1.1, 0.75, 1.25, 2.0], fill: 0.62, low: 0.9, hue: 0.2, a: 0x8fb4c2, b: 0xc9d6cf, some: 0.45, shelf: 0, lines: 1,
    mid: ['chairs', 0.66, 1], midColor: 0x3d6f86, blinds: 2.05, frame: 0xe9e4d6 },
  bike_sports: { wall: 0x9aa39f, floor: 0x7a7872, light: 0xfff6e6, day: 1.1, night: 0.8, ceil: [0, 1, 1.3, 0.2],
    back: [0.36, 0.46, 1.35, 2.73], fill: 0.72, low: 0.55, hue: 0.6, a: 0x3a4a5a, b: 0xb04a2a, some: 0.8, shelf: 0,
    mid: ['bikes', 1.95], midColor: 0x202326, windows: 1 },
  dispensary: { wall: 0xe4e6dd, floor: 0x7a7c74, light: 0xf2ffe9, day: 1, night: 0.7, ceil: [0.9, 0.16, 1.2, 0.14],
    back: [40, 0.16, 2.0, 2.16], fill: 1, low: 1, hue: 0, glow: 0.5, a: 0x4f9a55, b: 0x4f9a55, some: 1, shelf: 0,
    mid: ['counter', 0, 1.0, 0, 0], midColor: 0xd9dad2, frost: 1.9, frame: 0x263831 },
  gallery: { wall: 0xf0eee8, floor: 0x8a7a64, light: 0xfffaf0, day: 1.15, night: 0.75, ceil: [0.9, 0.14, 1.2, 0.12],
    back: [1.55, 1.6, 0.8, 2.4], fill: 0.6, low: 0.5, hue: 0.55, a: 0x6a5a4a, b: 0x3f556a, some: 0.9, shelf: 0,
    mid: ['counter', 0, 0, 0, 0], midColor: 0xe6e3da, top: [2.7, 0.5, 1.05, 0.82], windows: 1, frame: 0x1d1e21 },
  theatre: { wall: 0x5c1f22, floor: 0x5a1c20, light: 0xffd08a, day: 0.9, night: 1.0, ceil: [0.6, 0.3, 0.6, 0.3],
    back: [1.15, 1.6, 0.55, 2.15], fill: 0.72, low: 0.95, hue: 0.7, glow: 0.4, a: 0x9a6a3a, b: 0x3a4a7a, some: 0.9, shelf: 0, lines: 1,
    mid: ['counter', 0, 1.05, 0.35, 0], midColor: 0x3a2020, frame: 0x7a2a24 },
  retail: { wall: 0xbdb5a6, floor: 0x7a6a54, light: 0xfff0dc, day: 1.05, night: 0.8, ceil: [0, 1, 1.4, 0.18],
    back: [0.26, 0.5, 0.5, 2.5], fill: 0.8, low: 0.45, hue: 0.5, a: 0x88654a, b: 0x617b80, some: 0.85, shelf: 1,
    mid: ['blocks', 2.8, 0.05, 1.2, 0], midColor: 0x6a655c },
  service: { wall: 0xc4c0b4, floor: 0x5c5f66, light: 0xf4f6f2, day: 0.95, night: 0.7, ceil: [0, 1, 1.4, 0.18],
    back: [1.3, 0.8, 1.3, 2.1], fill: 0.6, low: 0.8, hue: 0.15, a: 0x6a7a86, b: 0x9a8a6a, some: 0.5, shelf: 0, lines: 1,
    mid: ['counter', 0, 0.78, 0, 0], midColor: 0x5a4a3a, top: [2.3, 0.5, 0.36, 0.15], blinds: 2.35 }
};
// a kind's look, whole (the rooms behind the glass take their walls, floor and light from it: shop-kits.js)
export const shopLookOf = (name) => ({ ...D, ...LOOKS[name] });
// The far, painted room of each kind of restaurant (the near, real ones are shop-kits-c.js): its walls and floor, and
// what stands in it (as `mid` above), over the restaurant's or the fast food place's own
const CUISINE_LOOKS = {
  generic: null,
  pizza: { wall: 0xb8a58a, floor: 0x7a3a2c, mid: ['counter', 0, 1.05, 0.4, 0], midColor: 0x8a2a20 },
  mexican: { wall: 0xd9a03a, floor: 0x9a5a3a, mid: ['counter', 0, 1.05, 0, 0], midColor: 0x1c7a6a },
  chinese: { wall: 0x8a1f1c, floor: 0x3a2a22, mid: ['tables', 2.2, 1], midColor: 0x2a1410 },
  japanese: { wall: 0xcbb994, floor: 0x6a5a48, mid: ['counter', 0, 1.02, 0.3, 1], midColor: 0xb89a6a },
  korean: { wall: 0x4a4a4c, floor: 0x3a3632, mid: ['tables', 2.0, 0], midColor: 0x2a2624 },
  noodles: { wall: 0x5a4a3a, floor: 0x3a322c, mid: ['counter', 0, 1.02, 0, 1], midColor: 0x7a5a3a },
  indian: { wall: 0xa8551c, floor: 0x4a2a20, mid: ['tables', 1.9, 1], midColor: 0x3a1c14 },
  mediterranean: { wall: 0xdfe6ea, floor: 0x8a8f94, mid: ['counter', 0, 1.05, 0.3, 0], midColor: 0x1f4f8a },
  italian: { wall: 0xcbb38a, floor: 0x4a3020, mid: ['tables', 1.9, 1], midColor: 0x2a1a12 },
  diner: { wall: 0xcfd9d6, floor: 0x8a8a86, mid: ['counter', 0, 1.02, 0, 1], midColor: 0xa62a24 },
  burger: { wall: 0xd8d2c2, floor: 0x8c8478, mid: ['counter', 0, 1.05, 0, 0], midColor: 0xc2261c },
  sandwich: { wall: 0xcfc6a8, floor: 0x7a6a54, mid: ['counter', 0, 1.2, 0.6, 0], midColor: 0x2c5a34 },
  chicken: { wall: 0xe2d6b8, floor: 0x8c8478, mid: ['counter', 0, 1.05, 0, 0], midColor: 0xd98a12 },
  steakhouse: { wall: 0x3a2018, floor: 0x241812, mid: ['tables', 2.1, 1], midColor: 0x1a100c },
  seafood: { wall: 0x9ab8c4, floor: 0x5a6a70, mid: ['tables', 2.0, 1], midColor: 0x1c3a4a },
  barbecue: { wall: 0x7a5232, floor: 0x3a2a1c, mid: ['tables', 2.6, 0], midColor: 0x5a3a20 }
};
export const cuisineLookOf = (name) => CUISINE_LOOKS[name];
const MID_MODES = { counter: 1, tables: 2, racks: 3, bikes: 4, blocks: 5, chairs: 6 };
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // (linear, as the shader's color())

// The looks as rows of four numbers, one table per row of the list above, a row per kind: SHOP_LOOK_TABLES[name][kind]
export const SHOP_LOOK_TABLES = (() => {
  const t = { wall: [], floor: [], light: [], back: [], back2: [], a: [], b: [], mid: [], midColor: [], top: [], flags: [], flags2: [], frame: [] };
  for (const name of SHOP_TYPES) {
    const k = { ...D, ...LOOKS[name] };
    t.wall.push([...rgb(k.wall), k.day]);
    t.floor.push([...rgb(k.floor), k.night]);
    t.light.push([...rgb(k.light), k.neon]);
    t.back.push(k.back);
    t.back2.push([k.fill, k.low, k.hue, k.glow]);
    t.a.push([...rgb(k.a), k.some]);
    t.b.push([...rgb(k.b), k.shelf + 2 * k.lines]);
    const m = k.mid;
    t.mid.push([MID_MODES[m[0]] || 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0]);
    t.midColor.push([...rgb(k.midColor), m[4] ?? 0]);
    t.top.push(k.top);
    t.flags.push([k.open, k.pendant, k.windows, k.frost]);
    t.flags2.push([k.blinds, k.bandGlow, 0, 0]);
    t.frame.push([...rgb(k.frame ?? 0), k.frame == null ? 0 : 1]);
    t.ceil ??= [];
    t.ceil.push(k.ceil);
  }
  // (and by kind of restaurant, a row per cuisine)
  const c = { wall: [], floor: [], mid: [], midColor: [] };
  for (const name of SHOP_CUISINES) {
    const k = CUISINE_LOOKS[name];
    c.wall.push(k ? [...rgb(k.wall), 1] : [0, 0, 0, 0]);
    c.floor.push(k ? [...rgb(k.floor), 0] : [0, 0, 0, 0]);
    const m = k ? k.mid : ['counter'];
    c.mid.push([MID_MODES[m[0]] || 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0]);
    c.midColor.push(k ? [...rgb(k.midColor), m[4] ?? 0] : [0, 0, 0, 0]);
  }
  t.cuisine = c;
  return t;
})();
