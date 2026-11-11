import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { groundHeight } from './terrain.js';
import { TIER } from './device-tier.js';
import { SHOP_TYPES, SHOP_CUISINES, signType, signCuisine, signPlace } from './shop-types.js';

// Lamp: a sign over each named shop, restaurant, cafe and bar from OpenStreetMap (GEO.signs, placed by the generator on
// the wall of its building that faces the street, then hung centred over the shopfront bay that is its own:
// shop-types.js): a painted board in the color and lettering of its kind of business (a restaurant's serif on oxblood,
// a bar's black board with a line of neon, a grocer's bold capitals), the name in plain letters, every name in one
// atlas, all the boards in two meshes (faces and their backing boxes).

const CELL_W = 384, CELL_H = 60, COLS = 10, ROWS = 80; // an atlas up to 3840 x 4800: 800 signs
const BOARD_H = 0.62;
const DEPTH = 0.1;
// food, coffee & sweets, bars, shops, services, culture: for a sign of no known kind
const BOARD_COLORS = ['#7d2320', '#5a3824', '#1f4030', '#1f2f52', '#2c3138', '#4c2650'];
const FONTS = ['Georgia, serif', 'Inter, Arial, sans-serif', 'Georgia, serif', 'Inter, Arial, sans-serif',
  'Inter, Arial, sans-serif', 'Georgia, serif'];
const SERIF = 'Georgia, "Times New Roman", serif', SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const SCRIPT = '"Snell Roundhand", "Brush Script MT", "Segoe Script", Georgia, cursive';
const SLAB = 'Rockwell, "Courier New", Georgia, serif';
const CREAM = '#f3e7c9';
// By kind (shop-types.js SHOP_TYPES): boards (one picked by the business's name), ink, font, weight, and: italic,
// caps (capital letters, spaced), line (the border: 'cream' a painted line, 'none', or a color for a tube of neon),
// script (every third one's name in a script hand)
const STYLES = {
  restaurant: { boards: ['#6e1f1c', '#3a2a22', '#2f3b2a', '#4a1f2e'], font: SERIF, script: true },
  fast_food: { boards: ['#c2261c', '#d98a12', '#1c6a3a', '#b8321e'], ink: '#fff8e8', font: SANS, weight: 800, caps: true, line: 'none' },
  cafe: { boards: ['#3e2a1c', '#28362e', '#4a3526'], font: SERIF, italic: true },
  bakery: { boards: ['#d9c8ae', '#dcc6be', '#cdd5c0'], ink: '#4a2a1e', font: SERIF, italic: true, line: '#4a2a1e55' },
  bar: { boards: ['#141414', '#1a1420', '#101a18'], ink: '#ffe9c4', font: SLAB, neon: ['#ff4f9a', '#3ad8ff', '#ffb02e', '#57f287'] },
  books: { boards: ['#243a2c', '#3a2c1c', '#1f2f45'], ink: '#e9d7a4', font: SERIF },
  apparel: { boards: ['#111111', '#d8d4cc', '#2a2a2e', '#d2ccbf'], font: SANS, weight: 500, caps: true, line: 'none' },
  jewelry_gift: { boards: ['#1c2436', '#2e1f33', '#20302e'], ink: '#e2c98a', font: SERIF, caps: true },
  grocery: { boards: ['#1d6b34', '#c2261c', '#1b4f8f', '#d2701a'], ink: '#ffffff', font: SANS, weight: 800, caps: true, line: 'none' },
  salon: { boards: ['#2a2a2e', '#4a2a3e', '#d4ccc5'], font: SANS, weight: 400, caps: true },
  bank: { boards: ['#1c3557', '#20402e', '#3a3f45'], ink: '#f2f0e8', font: SERIF, caps: true, line: 'none' },
  medical: { boards: ['#d6dad6', '#cbd6d9'], ink: '#1d4f7a', font: SANS, weight: 600, line: '#1d4f7a66' },
  bike_sports: { boards: ['#1f2c3a', '#b8401e', '#22422e'], font: SANS, weight: 800, italic: true, caps: true, line: 'none' },
  dispensary: { boards: ['#1c2a20', '#22302a', '#d5d8cf'], ink: '#a9dcae', font: SANS, weight: 500, caps: true, line: '#2f7a3c88' },
  gallery: { boards: ['#d9d6ce', '#1b1b1d'], font: SANS, weight: 300, caps: true, line: 'none' },
  theatre: { boards: ['#5c1418', '#1a1a2a'], ink: '#ffe6a8', font: SERIF, caps: true, neon: ['#ffcf5a'] },
  retail: { boards: ['#1f2f52', '#2c4a44', '#4a2f52', '#3a3a3a'], font: SANS },
  service: { boards: ['#2c3138', '#3a342c', '#28384a'], font: SANS, weight: 600 }
};
// A restaurant's or a fast food place's board by its kind of cooking (shop-types.js SHOP_CUISINES), over its kind's:
// colors and lettering only, the name as it is
const CUISINE_STYLES = {
  pizza: { boards: ['#a3201a', '#1f5a34', '#7a1a16'], ink: '#fff4d8', font: SLAB, weight: 700, neon: ['#ff5a3a', '#57f287'] },
  mexican: { boards: ['#c2491c', '#1c7a6a', '#d39a12', '#a8243a'], ink: '#fff8e8', font: SLAB, weight: 700, caps: true },
  chinese: { boards: ['#a01c1c', '#7a1418', '#1c1c1c'], ink: '#f2cf6a', font: SERIF, weight: 700, caps: true, line: '#f2cf6a88' },
  japanese: { boards: ['#1c1c1e', '#e6dcc6', '#2a2f3a'], ink: '#f2ebdc', font: SANS, weight: 300, caps: true, line: 'none' },
  korean: { boards: ['#1f2a44', '#2a2a2c', '#7a1f24'], ink: '#f4f1ea', font: SANS, weight: 700 },
  noodles: { boards: ['#2a3a2a', '#3a2a1c', '#b8401e'], ink: '#f6e7b8', font: SANS, weight: 600 },
  indian: { boards: ['#8a2a1c', '#a8651a', '#5a1f3a'], ink: '#f6d98a', font: SERIF, italic: true, line: '#f6d98a88' },
  mediterranean: { boards: ['#1f4f8a', '#e9e6dc', '#1c5a66'], ink: '#ffffff', font: SERIF, weight: 700 },
  italian: { boards: ['#2f3b2a', '#5a1f1c', '#3a2a22'], font: SERIF, script: true },
  diner: { boards: ['#c2261c', '#1f5a7a', '#e6e2d6'], ink: '#fff8e8', font: SLAB, weight: 700, caps: true, neon: ['#ff4f6a', '#3ad8ff'] },
  burger: { boards: ['#c2261c', '#d98a12', '#1c1c1e'], ink: '#fff8e8', font: SANS, weight: 800, caps: true, line: 'none' },
  sandwich: { boards: ['#2c5a34', '#d9c8a2', '#3a2a1c'], ink: '#fdf6e0', font: SLAB, weight: 700 },
  chicken: { boards: ['#b8321e', '#d98a12', '#e6dcc0'], ink: '#fff8e8', font: SANS, weight: 800, caps: true, line: 'none' },
  steakhouse: { boards: ['#2a1a16', '#1c1c1e', '#3a1f1c'], ink: '#e2c98a', font: SERIF, caps: true },
  seafood: { boards: ['#1c4a6a', '#dfe6e2', '#1f5a5a'], ink: '#ffffff', font: SERIF, italic: true },
  barbecue: { boards: ['#4a2a1a', '#2a1c14', '#7a2a1a'], ink: '#f6e2b8', font: SLAB, weight: 700, caps: true }
};
// is a board light enough to want dark letters?
const pale = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) > 480;

function buildShopSigns(group) {
  group.name = 'ShopSigns';
  const { names = [], list = [] } = GEO.signs || {};
  const count = Math.min(list.length / 7, COLS * ROWS);
  if (!count) return { count: 0 };

  // painted at half the size where memory is short (every tier but 'full': a phone, a Mac with less memory: device-tier.js)
  const K = TIER.name === 'full' ? 1 : 0.5;
  const W = CELL_W * COLS, H = CELL_H * Math.ceil(count / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = W * K;
  canvas.height = H * K;
  const ctx = canvas.getContext('2d');
  ctx.scale(K, K);

  const face = { pos: [], uv: [], nrm: [] };
  const back = { pos: [], nrm: [] };
  const quad = (out, corners, n, uvs) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      out.pos.push(...corners[k]);
      out.nrm.push(...n);
      if (uvs) out.uv.push(...uvs[k]);
    }
  };

  for (let i = 0; i < count; i++) {
    let [x, z, deg, w, y, ni, cat] = list.slice(i * 7, i * 7 + 7);
    // Nickels Arcade's State St entrance is an open arch (more-landmarks.js): a sign set across it goes on the shop
    // bay south of it instead
    if (Math.hypot(x - 616.25, z - 139.75) < 3) { z = 146.15; w = Math.min(w, 4.6); }
    // over its own bay, where the walls gave it one (shop-types.js)
    const place = signPlace(i);
    // (on a low building the generator hung it low, over what was blank wall: now up over the shopfront's glass)
    if (place) { x = place.x; z = place.z; w = place.w; y = Math.min(3.4, y + 0.5); }
    const name = names[ni];
    const style = CUISINE_STYLES[SHOP_CUISINES[signCuisine(i)]] || STYLES[SHOP_TYPES[signType(i)]];
    let pick = 0;
    for (let k = 0; k < name.length; k++) pick = (pick * 31 + name.charCodeAt(k)) >>> 0;
    // the board, painted into its cell, its letters squeezed so they read right once stretched over the board
    const cx = (i % COLS) * CELL_W, cy = Math.floor(i / COLS) * CELL_H;
    const board = style ? style.boards[pick % style.boards.length] : BOARD_COLORS[cat] || BOARD_COLORS[3];
    const neon = style && style.neon ? style.neon[(pick >>> 3) % style.neon.length] : null;
    // its kind's ink where that shows on the board picked: dark letters on a pale board, light ones on a dark
    const wanted = style && style.ink;
    const ink = pale(board) ? (wanted && !pale(wanted) ? wanted : '#1c1c1e') : (wanted && pale(wanted) ? wanted : CREAM);
    ctx.fillStyle = board;
    ctx.fillRect(cx, cy, CELL_W, CELL_H);
    const squeeze = (CELL_W / CELL_H) / (w / BOARD_H);
    const line = neon || (style && style.line) || 'cream';
    if (line !== 'none') {
      // (the border's sides are squeezed with the letters, so the line is as thick up the sides as along the top)
      const t = neon ? 4 : 3, tx = Math.max(1.5, t * squeeze);
      ctx.fillStyle = neon || (line === 'cream' ? (pale(board) ? 'rgba(40, 36, 30, 0.5)' : 'rgba(243, 231, 201, 0.55)') : line);
      if (neon) { ctx.shadowColor = neon; ctx.shadowBlur = 7; }
      ctx.fillRect(cx + 5, cy + 5, CELL_W - 10, t);
      ctx.fillRect(cx + 5, cy + CELL_H - 5 - t, CELL_W - 10, t);
      ctx.fillRect(cx + 5, cy + 5, tx, CELL_H - 10);
      ctx.fillRect(cx + CELL_W - 5 - tx, cy + 5, tx, CELL_H - 10);
      ctx.shadowBlur = 0;
    }
    ctx.save();
    ctx.translate(cx + CELL_W / 2, cy + CELL_H / 2 + 2);
    ctx.scale(squeeze, 1);
    const script = style && style.script && pick % 3 === 0 && name.length <= 22 && !/[0-9&]/.test(name);
    const text = style && style.caps && !script ? name.toUpperCase() : name;
    const family = script ? SCRIPT : style ? style.font : FONTS[cat] || FONTS[1];
    const weight = script ? 700 : (style && style.weight) || 700;
    const slant = style && style.italic && !script ? 'italic ' : '';
    try { ctx.letterSpacing = style && style.caps && !script ? '2px' : '0px'; } catch { /* an older browser: unspaced */ }
    let size = script ? 42 : style && style.caps ? 31 : 36;
    ctx.font = `${slant}${weight} ${size}px ${family}`;
    const room = (CELL_W - 34) / squeeze;
    const tw = ctx.measureText(text).width;
    if (tw > room) {
      size = Math.max(16, Math.floor(size * room / tw));
      ctx.font = `${slant}${weight} ${size}px ${family}`;
    }
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();

    // the board on the wall: its face out along the wall's normal, centred on (x, z)
    const a = (deg * Math.PI) / 180;
    const nx = Math.sin(a), nz = Math.cos(a); // outward
    const ux = nz, uz = -nx; // along the wall, left to right as seen from the street
    const g = groundHeight(x, z);
    const y0 = g + y - BOARD_H / 2, y1 = g + y + BOARD_H / 2;
    const hw = w / 2;
    const fx = x + nx * DEPTH, fz = z + nz * DEPTH;
    const P = (px, pz, s, py) => [px + ux * s, py, pz + uz * s];
    const u0 = cx / W, u1 = (cx + CELL_W) / W;
    const v0 = 1 - (cy + CELL_H) / H, v1 = 1 - cy / H;
    quad(face, [P(fx, fz, -hw, y0), P(fx, fz, hw, y0), P(fx, fz, hw, y1), P(fx, fz, -hw, y1)], [nx, 0, nz],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    // its edges: a shallow box back to the wall
    const e = 0.03;
    const top = [P(x, z, -hw - e, y1 + e), P(x, z, hw + e, y1 + e), P(fx, fz, hw + e, y1 + e), P(fx, fz, -hw - e, y1 + e)];
    quad(back, top, [0, 1, 0]);
    const bot = [P(fx, fz, -hw - e, y0 - e), P(fx, fz, hw + e, y0 - e), P(x, z, hw + e, y0 - e), P(x, z, -hw - e, y0 - e)];
    quad(back, bot, [0, -1, 0]);
    for (const s of [-1, 1]) {
      const sx = s * (hw + e);
      const side = s > 0
        ? [P(fx, fz, sx, y0 - e), P(x, z, sx, y0 - e), P(x, z, sx, y1 + e), P(fx, fz, sx, y1 + e)]
        : [P(x, z, sx, y0 - e), P(fx, fz, sx, y0 - e), P(fx, fz, sx, y1 + e), P(x, z, sx, y1 + e)];
      quad(back, side, [ux * s, 0, uz * s]);
    }
    // a frame around the face
    const fr = [P(fx + nx * -0.005, fz + nz * -0.005, -hw - e, y0 - e), P(fx, fz, hw + e, y0 - e),
      P(fx, fz, hw + e, y1 + e), P(fx, fz, -hw - e, y1 + e)];
    quad(back, fr.map((p) => [p[0] - nx * 0.004, p[1], p[2] - nz * 0.004]), [nx, 0, nz]);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(face.pos, 3));
  faceGeo.setAttribute('normal', new THREE.Float32BufferAttribute(face.nrm, 3));
  faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(face.uv, 2));
  faceGeo.computeBoundingSphere();
  const faceMat = new THREE.MeshStandardNodeMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.18, roughness: 0.6 });
  const faces = new THREE.Mesh(faceGeo, faceMat);
  faces.name = 'ShopSignFaces';
  faces.receiveShadow = true;

  const backGeo = new THREE.BufferGeometry();
  backGeo.setAttribute('position', new THREE.Float32BufferAttribute(back.pos, 3));
  backGeo.setAttribute('normal', new THREE.Float32BufferAttribute(back.nrm, 3));
  backGeo.computeBoundingSphere();
  const backs = new THREE.Mesh(backGeo, new THREE.MeshStandardNodeMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.4 }));
  backs.name = 'ShopSignBoards';
  backs.castShadow = true;
  backs.receiveShadow = true;

  group.add(backs, faces);
  group.userData.terrain = 'set'; // stood on the ground as they were placed
  console.info(`[shop signs] ${count} storefront signs`);
  return { count };
}

export { buildShopSigns };
