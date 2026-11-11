// What's under the player's wheels, for how they drive and sound and what the hands feel:
// - the road's weather: under the "Now" sky (main.js setRoadWeather), rain or a storm wets the roads and falling snow
//   (or snow lying on the town, snow-cover.js's uSnow, which leaves slush on the plowed streets) makes them slippery.
//   Most of it is taken from braking and the pull off the line; cornering grip loses only a little, so turning stays
//   sharp. Under any other sky the roads are dry.
// - the surface: brick and pavers where OpenStreetMap tags a street so (Detroit St by Kerrytown, N Fourth Ave by the
//   Farmers Market, N Fifth Ave, Depot St; data/road-surfaces.json from Assets/Tools/build-road-surfaces.py), gravel
//   and dirt lanes and lots, the parks' dirt and gravel trails and the boardwalks (GEO.trails kinds 1 and 3), and the
//   mountain bike trails (data/mtb-trails.json). Everything else is plain pavement.
import { GEO } from './city-geodata.js';
import { cityUniforms } from './tsl-materials.js';
import { asset, log } from '../lamp-game.js';

// the sky now, from weather.js (null: not the "Now" sky, so dry)
let weather = null;
export function setRoadWeather(w) { weather = w || null; }

// How wet and how snowy the roads are now, each 0 to 1, and what that leaves of the tires' grip: `brake` scales the
// brakes, `pull` the pull off the line (traction control holds it back), `grip` cornering (a little)
const cond = { wet: 0, snow: 0, brake: 1, pull: 1, grip: 1 };
export function roadCondition() {
  const w = weather;
  const raining = w && (w.kind === 'rain' || w.kind === 'storm') ? 1 : 0;
  const falling = w && w.kind === 'snow' ? 1 : 0;
  // snow lying on the town leaves the plowed streets slushy: a third of falling snow's slip at full cover
  const lying = w ? 0.35 * Math.max(0, Math.min(1, cityUniforms.uSnow?.value || 0)) : 0;
  cond.wet = Math.max(raining, falling * 0.6, lying);
  cond.snow = Math.max(falling, lying);
  cond.brake = 1 - 0.2 * Math.max(0, cond.wet - cond.snow) - 0.4 * cond.snow;
  cond.pull = 1 - 0.1 * cond.wet - 0.3 * cond.snow;
  cond.grip = 1 - 0.04 * cond.wet - 0.1 * cond.snow;
  return cond;
}

// Surfaces as segments in a grid of CELL m squares: [kind, half width] per segment, kinds below
export const SURFACE = { none: 0, brick: 1, gravel: 2, dirt: 3, boards: 4 };
const NAMES = ['', 'brick', 'gravel', 'dirt', 'boards'];
const CELL = 16;
const cells = new Map();
const key = (cx, cz) => cx * 100003 + cz;
let ready = false, loading = false;

function addLine(kind, half, pts, from) {
  for (let i = from; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const seg = [kind, half, ax, az, bx, bz];
    const x0 = Math.floor((Math.min(ax, bx) - half) / CELL), x1 = Math.floor((Math.max(ax, bx) + half) / CELL);
    const z0 = Math.floor((Math.min(az, bz) - half) / CELL), z1 = Math.floor((Math.max(az, bz) + half) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = key(cx, cz);
      let list = cells.get(k);
      if (!list) cells.set(k, list = []);
      list.push(seg);
    }
  }
}

async function load() {
  loading = true;
  // the parks' dirt and gravel trails and the boardwalks
  let n = 0;
  for (const t of GEO.trails || []) {
    if (t.length < 6 || (t[0] !== 1 && t[0] !== 3)) continue;
    addLine(t[0] === 3 ? SURFACE.boards : SURFACE.dirt, t[1] / 2 + 0.2, t, 2);
    n++;
  }
  const json = async (path) => {
    try { const b = await asset(path); return b ? JSON.parse(new TextDecoder().decode(b)) : null; } catch { return null; }
  };
  const [streets, mtb] = await Promise.all([json('data/road-surfaces.json'), json('data/mtb-trails.json')]);
  let bricks = 0, loose = 0;
  // a street's surface across its whole width: a two-lane street is about 9 m curb to curb
  for (const s of streets?.streets || []) {
    addLine(s[0] === 1 ? SURFACE.brick : SURFACE.gravel, s[0] === 1 ? 5 : 3.5, s, 1);
    if (s[0] === 1) bricks++; else loose++;
  }
  for (const t of mtb?.trails || []) addLine(SURFACE.dirt, 0.9, t, 1);
  ready = true;
  log(`[road feel] ${bricks} brick streets, ${loose} gravel or dirt ones, ${n} park trails and boardwalks, ${mtb?.trails?.length || 0} mountain bike trails`);
}

// The surface at (x, z): a SURFACE kind (0, plain pavement, until the data has come)
export function surfaceAt(x, z) {
  if (!ready) { if (!loading) load(); return 0; }
  const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return 0;
  let best = 0, bestD = Infinity;
  for (const [kind, half, ax, az, bx, bz] of list) {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    // the one it's furthest inside wins
    if (d <= half && d - half < bestD) { best = kind; bestD = d - half; }
  }
  return best;
}
export const surfaceName = (kind) => NAMES[kind] || 'pavement';
