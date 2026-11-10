import { GEO } from './city-geodata.js';
import {
  ROADS,
  BLOCKS,
  LANDMARKS,
  LANDMARK_SITES,
  TOWN_BOUNDS,
  CITY_LIMITS,
  inTown,
  getTownBoundsAtZ,
  TOWN_EDGE,
  getLocationLabel,
  isTypingInField,
  WATER_POLYGONS
} from './city-config.js';
import { groundHeight } from './terrain.js';
import { layOutHoles } from './golf.js';
import { AIRPORT } from './airport-data.js';
import { onAirfield } from './airport.js';
import { TIER } from './device-tier.js';
import { hot, BUTTON, STICK, TRIGGER, glyph, onInput, asset, log } from '../lamp-game.js';

// The city's street addresses (build-address-search.py), loaded the first time a search starts with a house number
let addressBook = null;
function loadAddressBook() {
  addressBook ??= (async () => {
    try {
      const packed = await asset('data/address-search.json.gz');
      const head = new Uint8Array(packed, 0, 2);
      const bytes = head[0] === 0x1f && head[1] === 0x8b
        ? await new Response(new Response(packed).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
        : packed;
      const data = JSON.parse(new TextDecoder().decode(bytes));
      data.lower = data.streets.map((n) => n.toLowerCase());
      log(`[map] ${data.a.length / 4} addresses for search`);
      return data;
    } catch (error) {
      console.warn('[map] no addresses:', error);
      return null;
    }
  })();
  return addressBook;
}
// "918 hutchins" → the house, or null: the number exactly, the street by its words ("n main", "hutchins ave")
function findAddress(book, q) {
  const m = /^(\d+)\s+(.+)$/.exec(q);
  if (!book || !m) return null;
  const num = +m[1];
  const words = m[2].replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  let best = null, bestScore = -1;
  for (let i = 0; i < book.a.length; i += 4) {
    if (book.a[i + 2] !== num) continue;
    const name = book.lower[book.a[i + 3]], parts = name.split(' ');
    // every word typed starts a word of the street's name; a name that starts with the first one scores higher
    if (!words.every((w) => parts.some((p) => p.startsWith(w)))) continue;
    const score = (parts.some((p) => p === words[0]) ? 2 : 0) + (parts.length <= words.length + 1 ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best === null) return null;
  return { x: book.a[best], z: book.a[best + 1], name: `${num} ${book.streets[book.a[best + 3]]}` };
}

// Lamp: the map systems made, kept through a change of this file (lamp-game.js, "Changes while it's played"), so a
// change to how the map is drawn shows at once rather than after the player moves (the end of this file).
const live = hot(import.meta);
const systems = (live.data.systems ??= new Set());
// Lamp: the layers this version drew from the city it was given; the next version makes its own.
live.dispose(() => { LAYERS = null; FOOTPRINTS = null; });

// Minimap and full-screen map drawn from the same geography and building footprints as the 3D city.
// World frame: 1 unit = 1 m, x = east, z = south. Both maps face true north.

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MIN_ZOOM = 0.015; // full map, pixels per metre: the whole town and the country around it
const MAX_ZOOM = 3.0; // single lots
const RADAR_SCALE = 0.32; // radar pixels per metre on the ground (zooms out with altitude)
const GRID_BEARING = GEO.frame?.bearingDeg ?? 0; // the map's north, degrees east of true north (0: true north)

// Map palette, shared by the radar & the atlas (in step with css/style.css): graphite ground with the streets a shade
// lighter than the blocks they run between, muted parks & water; a golden GPS route, white landmarks & player,
// cyan search hits and amber highways
const MAP = {
  water: '#0a1118',
  streets: '#363f4b', // the town inside its edge: the roadway left between the blocks
  shore: '#4f5b6b',
  park: '#19301f',
  fairway: '#21402a', // golf: fairways a shade brighter than the park, greens brighter still, bunkers sand
  green: '#2f5c3a',
  bunker: '#5d5640',
  airfield: '#3a414b', // Ann Arbor Municipal's runways, taxiways and aprons, like the streets
  parkEdge: '#24432f',
  block: '#1c2128',
  blockEdge: '#272e37',
  buildings: ['#242a32', '#2b323c', '#343c48'],
  buildingEdge: '#171b21',
  landmarkFill: 'rgba(255, 255, 255, 0.06)',
  landmarkEdge: 'rgba(255, 255, 255, 0.38)',
  mainRoads: '#3a434f',
  highway: '#b27a35',
  route: '#ffc21a',
  bike: '#43d17f', // bike lanes, shown while cycling
  bikeStrong: '#0fa04f', // protected and buffered bike lanes
  bikePath: '#2fa565',
  search: '#5fd0ff',
  halo: 'rgba(8, 11, 15, 0.9)',
  limits: 'rgba(255, 214, 150, 0.6)' // the City of Ann Arbor's official limits, dashed
};

// Landmarks modelled by landmarks.js on their real OpenStreetMap lots (outlined in amber)
const MODELLED_LANDMARKS = ['Michigan Stadium'];
// the murals' and sculptures' pins (art-places.js), smaller than the big landmarks' white ones
// and the champion trees' (champion-trees.js) in leaf green
const ART_PIN = { mural: '#ff8fc7', sculpture: '#ffcb05', tree: '#6fdc6a' };

// Town (0), waterway (1) & neighborhood (2) names at their real places (world metres)
const AREA_LABELS = [
  ['ANN ARBOR', 600, -300, 0],
  ['HURON RIVER', 420, -1556, 1], ['HURON RIVER', 2979, -138, 1], ['HURON RIVER', -347, -2830, 1],
  ['DOWNTOWN', 0, -60, 2], ['KERRYTOWN', 220, -620, 2], ['STATE STREET', 540, 160, 2], ['CENTRAL CAMPUS', 950, 280, 2],
  ['MEDICAL CAMPUS', 1300, -700, 2], ['NORTH CAMPUS', 2900, -2200, 2], ['SOUTH CAMPUS', 300, 1300, 2],
  ['BURNS PARK', 1700, 1350, 2], ['OLD WEST SIDE', -800, 300, 2], ['WATER HILL', -700, -850, 2], ['LOWER TOWN', 900, -1150, 2],
  ['NICHOLS ARBORETUM', 2300, 50, 2], ['THE BIG HOUSE', -26, 1780, 2]
];

// Shorter map names for a few real street names
const LABEL_ALIAS = {};

// ---------------------------------------------------------------------------------------------------------------------
// World-space vector layers: built once into Path2D objects (world metres) and drawn through a canvas transform
// ---------------------------------------------------------------------------------------------------------------------

// Point accessors for rings / polylines given as [{x, z}, ...] or flat [x0, z0, x1, z1, ...]
function accessor(pts) {
  const flat = typeof pts[0] === 'number';
  return {
    n: flat ? pts.length >> 1 : pts.length,
    X: flat ? (i) => pts[2 * i] : (i) => pts[i].x,
    Z: flat ? (i) => pts[2 * i + 1] : (i) => pts[i].z
  };
}

function boundsOf(pts) {
  const { n, X, Z } = accessor(pts);
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = X(i);
    const z = Z(i);
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

// Match Path2D.rect winding so overlapping outlines unite; reverse courtyard holes.
function addRing(path, pts, hole = false) {
  if (!pts || pts.length < 3) return;
  const { n, X, Z } = accessor(pts);
  if (n < 3) return;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += X(j) * Z(i) - X(i) * Z(j);
  if ((a >= 0) !== hole) {
    path.moveTo(X(0), Z(0));
    for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
  } else {
    path.moveTo(X(n - 1), Z(n - 1));
    for (let i = n - 2; i >= 0; i--) path.lineTo(X(i), Z(i));
  }
  path.closePath();
}

function addLine(path, pts) {
  if (!pts || pts.length < 2) return;
  const { n, X, Z } = accessor(pts);
  path.moveTo(X(0), Z(0));
  for (let i = 1; i < n; i++) path.lineTo(X(i), Z(i));
}

/**
 * A vector layer split into square tiles of Path2D, so a view only rasterizes the tiles it overlaps. Every item goes
 * to the tile holding its centre; a tile's bounds grow to cover its items.
 */
class TiledLayer {
  constructor(size = 500) {
    this.size = size;
    this.tiles = new Map();
  }

  pathFor(b) {
    const ix = Math.floor((b.minX + b.maxX) * 0.5 / this.size);
    const iz = Math.floor((b.minZ + b.maxZ) * 0.5 / this.size);
    const key = `${ix},${iz}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = { path: new Path2D(), minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
      this.tiles.set(key, t);
    } else {
      t.minX = Math.min(t.minX, b.minX);
      t.maxX = Math.max(t.maxX, b.maxX);
      t.minZ = Math.min(t.minZ, b.minZ);
      t.maxZ = Math.max(t.maxZ, b.maxZ);
    }
    return t.path;
  }

  ring(pts, holes = []) {
    if (!pts || pts.length < 3) return;
    const path = this.pathFor(boundsOf(pts));
    addRing(path, pts);
    for (const hole of holes) addRing(path, hole, true);
  }

  line(pts) {
    if (pts && pts.length > 1) addLine(this.pathFor(boundsOf(pts)), pts);
  }

  /** Calls fn(path) for every tile overlapping the view */
  each(v, fn) {
    for (const t of this.tiles.values()) {
      if (t.maxX < v.minX || t.minX > v.maxX || t.maxZ < v.minZ || t.minZ > v.maxZ) continue;
      fn(t.path);
    }
  }
}

let LAYERS = null;
function mapLayers() {
  if (LAYERS) return LAYERS;
  const L = {};
  const rings = (list) => list.filter((p) => p && p.length > 2);

  // The detailed town inside its edge
  L.town = new Path2D();
  addRing(L.town, TOWN_EDGE);
  // The city's official limits (and each township island inside them)
  L.limits = new Path2D();
  for (const ring of CITY_LIMITS) addRing(L.limits, ring);

  // Parkland (OpenStreetMap's parks), the curb islands (blocks: raised sidewalks & lots) and the park blocks, exactly
  // as city-grid.js / buildings.js treat them
  L.parkLand = new TiledLayer();
  for (const park of GEO.parks || []) for (const ring of park.rings || []) L.parkLand.ring(ring);
  // Golf: fairways, greens (with the holes golf.js lays out where a course has none mapped) and bunkers
  const golf = GEO.golf ? layOutHoles(GEO.golf) : null;
  L.fairways = new TiledLayer();
  L.greens = new TiledLayer();
  L.bunkers = new TiledLayer();
  for (const [layer, list] of [[L.fairways, golf?.fairways], [L.greens, [...(golf?.greens || []), ...(golf?.tees || [])]], [L.bunkers, golf?.bunkers]]) {
    for (const rings of list || []) layer.ring(rings[0], rings.slice(1));
  }
  // Ann Arbor Municipal Airport: its aprons, runways (the grass one as park) and taxiways
  L.field = new Path2D(); // inside its fence, south of the city's edge: land like the town's
  addRing(L.field, AIRPORT.bounds);
  L.airBuildings = new Path2D();
  for (const b of AIRPORT.buildings) addRing(L.airBuildings, b.ring);
  L.airport = new Path2D();
  L.taxiways = new Path2D();
  L.grassRunway = new Path2D();
  for (const a of AIRPORT.aprons) addRing(L.airport, a);
  for (const r of AIRPORT.runways) {
    const [ax, az] = r.a, [bx, bz] = r.b, l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * r.width / 2, nz = (bx - ax) / l * r.width / 2;
    addRing(r.grass ? L.grassRunway : L.airport, [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
  }
  for (const t of AIRPORT.taxiways) addLine(L.taxiways, t.line);
  L.runwayLines = new Path2D();
  for (const r of AIRPORT.runways) if (!r.grass) addLine(L.runwayLines, [...r.a, ...r.b]);
  L.blocks = new TiledLayer();
  L.parkBlocks = new TiledLayer();
  for (const b of BLOCKS) (b.park > 0.6 && !b.median ? L.parkBlocks : L.blocks).ring(b.poly);

  // Street network at low zoom (the wide streets, once the gaps between blocks are under a pixel) and the freeways
  // (I-94, US-23, M-14)
  L.mainRoads = new TiledLayer(1000);
  L.highways = new Path2D();
  for (const r of ROADS) {
    if (r.highway) {
      if (!/Underpass|Tunnel/.test(r.name)) addLine(L.highways, r.pts);
    } else if (r.w >= 15) L.mainRoads.line(r.pts);
  }

  // Bike routes by kind (the city's Non-Motorized Routes over OpenStreetMap's cycleway*: GEO.roadGraph links' bike
  // bits): protected and buffered lanes (16, 32, 64) solid in a stronger green, other lanes (1, 2) solid, shared-lane
  // arrows (4, 8) and signed bike routes (256) dashed, and the paved paths, boardwalks and trails a bike can ride
  // (GEO.trails, not the dirt ones) thin, shown while cycling
  L.bikeStrong = new TiledLayer(1000);
  L.bikeLanes = new TiledLayer(1000);
  L.bikeShared = new TiledLayer(1000);
  L.bikePaths = new TiledLayer(1000);
  const RG = GEO.roadGraph;
  if (RG) {
    const at = (i) => ({ x: RG.nodes[i * 2], z: RG.nodes[i * 2 + 1] });
    for (const [a, b, , , , , inner, , bike = 0] of RG.links) {
      if (!(bike & (15 | 128 | 256))) continue;
      const pts = [at(a)];
      for (let k = 0; k < inner.length; k += 2) pts.push({ x: inner[k], z: inner[k + 1] });
      pts.push(at(b));
      (bike & 3 ? (bike & 112 ? L.bikeStrong : L.bikeLanes) : L.bikeShared).line(pts);
    }
  }
  for (const t of GEO.trails || []) {
    if (t[0] === 1 || t[0] === 4 || (t[0] === 0 && t[1] < 2.4)) continue; // dirt, steps, or a footpath
    const pts = [];
    for (let k = 2; k + 1 < t.length; k += 2) pts.push({ x: t[k], z: t[k + 1] });
    L.bikePaths.line(pts);
  }

  // The Huron River and its ponds, over the land
  L.river = new Path2D();
  for (const rings of WATER_POLYGONS || []) rings.forEach((r, i) => addRing(L.river, r, i > 0));

  // Landmark lots
  L.landmarks = new Path2D();
  for (const name of MODELLED_LANDMARKS) {
    const s = LANDMARK_SITES[name];
    if (s && s.ring) addRing(L.landmarks, s.ring);
  }

  LAYERS = L;
  return L;
}

// Building footprints as generated by buildings.js, by height: up to 45 m, 95 m, taller
let FOOTPRINTS = null;
function footprintLayers(all) {
  if (!all || !all.length) return null;
  if (FOOTPRINTS && FOOTPRINTS.src === all && FOOTPRINTS.n === all.length) return FOOTPRINTS;
  const tones = [new TiledLayer(), new TiledLayer(), new TiledLayer()];
  for (const blk of all) {
    for (const f of blk.footprints || []) {
      const layer = tones[f.h > 95 ? 2 : f.h > 45 ? 1 : 0];
      layer.ring(f.pts, f.holes);
    }
  }
  FOOTPRINTS = { src: all, n: all.length, tones, version: FOOTPRINTS ? FOOTPRINTS.version + 1 : 1 };
  return FOOTPRINTS;
}

// Street name labels: anchors every ~260 m along each straight run of a real centreline (fixed in the world, so labels
// never slide while the map pans), with the direction of the street there (never upside down: vertical names read
// upwards)
const ROAD_LABELS = [];
for (const r of ROADS) {
  const text = LABEL_ALIAS[r.name] || r.name;
  if (!text || /^Unnamed/.test(text)) continue;
  const anchors = [];
  const pts = r.pts;
  for (let i = 0; i + 1 < pts.length;) {
    // the straight run from pts[i]: consecutive segments within ~5° of its first one (the CSCL has a vertex at every
    // intersection, so an avenue is a chain of 80 m blocks)
    const a = pts[i];
    const dir = Math.atan2(pts[i + 1].z - a.z, pts[i + 1].x - a.x);
    let j = i + 1;
    while (j + 1 < pts.length) {
      const d = Math.atan2(pts[j + 1].z - pts[j].z, pts[j + 1].x - pts[j].x);
      let turn = Math.abs(d - dir);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.09) break;
      j++;
    }
    const c = pts[j];
    i = j;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 20) continue;
    let ang = Math.atan2(c.z - a.z, c.x - a.x);
    if (ang >= Math.PI * 0.5 - 0.01) ang -= Math.PI;
    else if (ang < -Math.PI * 0.5 - 0.01) ang += Math.PI;
    const k = Math.max(1, Math.round(len / 260));
    for (let m = 0; m < k; m++) {
      const t = (m + 0.5) / k;
      anchors.push({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, ang, len: len / k });
    }
  }
  if (!anchors.length) continue;
  ROAD_LABELS.push({
    text,
    lower: text.toLowerCase(),
    raw: (r.raw ?? r.name).toLowerCase(),
    road: r,
    major: r.highway || r.w >= 15,
    highway: r.highway,
    anchors,
    ...boundsOf(r.pts)
  });
}
const ROAD_NAME_COUNT = new Set(ROAD_LABELS.map((l) => l.text)).size;

/** A map viewport: centre (cx, cz) in world metres, s pixels per metre, w x h CSS pixels on a canvas of pixel ratio dpr */
class MapView {
  constructor(cx, cz, s, w, h, dpr = 1) {
    this.cx = cx;
    this.cz = cz;
    this.s = s;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.minX = cx - w / (2 * s);
    this.maxX = cx + w / (2 * s);
    this.minZ = cz - h / (2 * s);
    this.maxZ = cz + h / (2 * s);
  }

  /** Canvas transform for world metres */
  world(ctx) {
    const { s, dpr } = this;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, dpr * (this.w * 0.5 - this.cx * s), dpr * (this.h * 0.5 - this.cz * s));
  }

  /** Canvas transform for CSS pixels from the canvas centre (what toX / toY return) */
  screen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.w * 0.5, this.dpr * this.h * 0.5);
  }

  toX(x) {
    return (x - this.cx) * this.s;
  }

  toY(z) {
    return (z - this.cz) * this.s;
  }

  sees(b) {
    return b && b.maxX >= this.minX && b.minX <= this.maxX && b.maxZ >= this.minZ && b.minZ <= this.maxZ;
  }
}

// Player heading arrow at the (already rotated) origin: white, on a dark halo
// a road work sign: a small orange diamond with a dark rim and a dark bar across it, like the "ROAD WORK" diamonds

// Lamp: how big the big map's markers are drawn at a zoom (s pixels a metre): full size zoomed in to the streets,
// down to a little over half zoomed out over the town, so they don't crowd it
const iconScale = (s) => Math.max(0.55, Math.min(1, 0.5 + s * 0.8));
// zoomed out over the whole town (under this many pixels a metre) every marker is only a small dot in its color
const DOTS_UNDER = 0.22;
function drawDot(ctx, x, y, color, r = 2.6) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawWorkSign(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r - 1.5); ctx.lineTo(x + r + 1.5, y); ctx.lineTo(x, y + r + 1.5); ctx.lineTo(x - r - 1.5, y); ctx.closePath();
  ctx.fillStyle = MAP.halo;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  ctx.fillStyle = '#ff8a1f';
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.strokeStyle = '#1b1b1c';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.82); ctx.lineTo(x + r * 0.82, y); ctx.lineTo(x, y + r * 0.82); ctx.lineTo(x - r * 0.82, y); ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#1b1b1c';
  ctx.fillRect(x - r * 0.38, y - r * 0.12, r * 0.76, r * 0.24);
}

// a champion tree: a leafy tree, a round crown of three puffs over a trunk, dark-rimmed so it reads on any ground
function drawTreeSign(ctx, x, y, r) {
  const puffs = [[-0.42, -0.1, 0.5], [0.42, -0.1, 0.5], [0, -0.48, 0.58], [0, 0.02, 0.5]];
  const trunk = () => { ctx.beginPath(); ctx.rect(x - r * 0.16, y + r * 0.2, r * 0.32, r * 0.85); };
  const crown = (grow) => {
    ctx.beginPath();
    for (const [dx, dy, s] of puffs) { ctx.moveTo(x + dx * r + s * r + grow, y + dy * r); ctx.arc(x + dx * r, y + dy * r, s * r + grow, 0, Math.PI * 2); }
  };
  ctx.fillStyle = MAP.halo;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = MAP.halo;
  trunk(); ctx.fill(); ctx.stroke();
  crown(1.5); ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  trunk(); ctx.fill();
  ctx.fillStyle = '#3fae4a';
  crown(0); ctx.fill();
  // a lighter puff top left, as sun on the leaves
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.62, r * 0.26, 0, Math.PI * 2); ctx.fill();
}

// a golf course's first tee: a green disc with a white flagstick and a yellow flag, dark-rimmed like the other signs
function drawGolfSign(ctx, x, y, r) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f9e44';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - r * 0.28, y - r * 0.62, Math.max(1, r * 0.14), r * 1.2);
  ctx.beginPath(); ctx.ellipse(x - r * 0.21, y + r * 0.6, r * 0.42, r * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffcb05';
  ctx.beginPath(); ctx.moveTo(x - r * 0.14, y - r * 0.62); ctx.lineTo(x + r * 0.6, y - r * 0.38); ctx.lineTo(x - r * 0.14, y - r * 0.12); ctx.closePath(); ctx.fill();
}

function drawPlayerArrow(ctx, tipY, halfWidth, tailY) {
  ctx.beginPath();
  ctx.moveTo(0, tipY);
  ctx.lineTo(halfWidth, tailY);
  ctx.lineTo(0, tailY * 0.45);
  ctx.lineTo(-halfWidth, tailY);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// The GPS route along the streets (GEO.roadGraph): the shortest way by length from the junction nearest the player to
// the one nearest the waypoint, one-way streets only their way (any way if that finds none), as world points from
// `from` to `to`; a straight line where the streets don't join them
let ROUTE_GRAPH = null;
function routeGraph() {
  if (ROUTE_GRAPH) return ROUTE_GRAPH;
  const RG = GEO.roadGraph;
  const n = RG ? RG.nodes.length / 2 : 0;
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b, , , , dir, inner = []] of RG ? RG.links : []) {
    let len = 0, x = RG.nodes[a * 2], z = RG.nodes[a * 2 + 1];
    for (let k = 0; k <= inner.length; k += 2) {
      const nx = k < inner.length ? inner[k] : RG.nodes[b * 2], nz = k < inner.length ? inner[k + 1] : RG.nodes[b * 2 + 1];
      len += Math.hypot(nx - x, nz - z);
      x = nx; z = nz;
    }
    adj[a].push({ to: b, len, inner, back: false, oneWay: false });
    adj[b].push({ to: a, len, inner, back: true, oneWay: Boolean(dir) });
  }
  return (ROUTE_GRAPH = { n, adj, nodes: RG ? RG.nodes : [] });
}
function nearestJunction(G, x, z) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < G.n; i++) {
    if (!G.adj[i].length) continue;
    const d = (G.nodes[i * 2] - x) ** 2 + (G.nodes[i * 2 + 1] - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
function shortestPath(G, from, to, oneWays) {
  const dist = new Float64Array(G.n).fill(Infinity), via = new Array(G.n);
  const heap = [[0, from]];
  dist[from] = 0;
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, i] = pop();
    if (i === to) break;
    if (d > dist[i]) continue;
    for (const e of G.adj[i]) {
      if (oneWays && e.oneWay) continue;
      const nd = d + e.len;
      if (nd < dist[e.to]) { dist[e.to] = nd; via[e.to] = { from: i, e }; push([nd, e.to]); }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const pts = [];
  for (let i = to; i !== from;) {
    const { from: j, e } = via[i];
    pts.push({ x: G.nodes[i * 2], z: G.nodes[i * 2 + 1] });
    // the link's bends, walked back from i to j
    const k0 = e.back ? 0 : e.inner.length - 2, step = e.back ? 2 : -2;
    for (let k = k0; k >= 0 && k < e.inner.length; k += step) pts.push({ x: e.inner[k], z: e.inner[k + 1] });
    i = j;
  }
  pts.push({ x: G.nodes[from * 2], z: G.nodes[from * 2 + 1] });
  return pts.reverse();
}
function findRoute(fx, fz, tx, tz) {
  const G = routeGraph();
  const a = nearestJunction(G, fx, fz), b = nearestJunction(G, tx, tz);
  const mid = a >= 0 && b >= 0 ? (a === b ? [] : shortestPath(G, a, b, true) || shortestPath(G, a, b, false)) : null;
  return [{ x: fx, z: fz }, ...(mid || []), { x: tx, z: tz }];
}

// GPS route from the player to the waypoint (world points, `findRoute`): taxi yellow on a dark casing
function drawRoute(ctx, pts, toX, toY, width) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z))));
  ctx.strokeStyle = MAP.halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = MAP.route;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Waypoint: a taxi-yellow target
function drawWaypoint(ctx, x, y, r) {
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.route;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MAP.halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
  ctx.fill();
}

const overlaps = (boxes, b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

class CityMapSystem {
  // Lamp: the game's code ran again and this map goes with that run (main.js).
  release() { systems.delete(this); }

  constructor({ controllerManager, cameraSystem, trafficSystem, allBlocks = [], onTeleport, onToggle }) {
    systems.add(this);
    this.controllerManager = controllerManager;
    this.cameraSystem = cameraSystem;
    this.trafficSystem = trafficSystem;
    this.allBlocks = allBlocks;
    this.onTeleport = onTeleport;
    this.onToggle = onToggle;

    this.miniCanvas = document.getElementById('minimap-canvas');
    this.miniCtx = this.miniCanvas ? this.miniCanvas.getContext('2d') : null;
    this.elMiniStreet = document.getElementById('minimap-street-label');
    this.miniStreetText = '';
    this.miniScale = RADAR_SCALE;
    this.miniCache = null; // { canvas, cx, cz, s, version }: the radar's ground layers, twice the radar's size
    const elCounts = document.getElementById('fullmap-counts');
    if (elCounts) elCounts.textContent = `${ROAD_NAME_COUNT} streets · ${BLOCKS.length.toLocaleString('en-US')} blocks`;

    // The map is drawn grid north up; the compass needle points to true north, 29° to its left
    const needle = document.getElementById('map-compass-needle');
    if (needle) needle.setAttribute('transform', `rotate(${-GRID_BEARING} 22 22)`);

    this.modal = document.getElementById('fullmap-modal');
    this.fullCanvas = document.getElementById('fullmap-canvas');
    this.fullCanvasWrap = document.getElementById('fullmap-canvas-wrap');
    this.fullCtx = this.fullCanvas ? this.fullCanvas.getContext('2d') : null;
    this.fullDpr = 1;
    this.fullStatic = null; // the full map's ground layers & labels for the current view
    this.fullStaticKey = '';
    this.elHoverInfo = document.getElementById('fullmap-hover-info');
    this.hoverDefault = this.elHoverInfo ? this.elHoverInfo.textContent : '';
    // the phone, slow and Xbox tiers (the Xbox's is 'phone'): the HUD's glass is a solid fill, not a blur of the live
    // city behind it every frame (style.css)
    document.documentElement.classList.toggle('flat-glass', TIER.name === 'phone' || TIER.name === 'slow');
    this.elPlayerInfo = document.getElementById('fullmap-player-info');
    this.elSearchInput = document.getElementById('fullmap-search');
    if (this.elSearchInput) this.elSearchInput.placeholder = `Search ${ROAD_NAME_COUNT} streets & landmarks…`;

    this.isFullMapOpen = false;
    // Full map viewport state (world metres; zoom in CSS pixels per metre)
    this.viewCenterX = 0;
    this.viewCenterZ = 0;
    this.viewZoom = 0.22;
    this.isPanning = false;
    this.panPointerId = null;
    this.panStart = { x: 0, y: 0, cx: 0, cz: 0 };
    this.dragMoved = false;
    // A controller's cursor on the full map (CSS pixels in the canvas), shown once a stick moves it
    this.cursor = { x: 0, y: 0, on: false };
    this.elCursor = null;

    this.searchHighlight = '';
    this.searchPath = null;
    this.textWidths = new Map();
    // No GPS route until a teleport sets one; Clear route on the full map takes it away
    this.waypoint = null;

    // Street names measured before the web font arrived would be spaced for the fallback font: measure & draw again
    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.textWidths.clear();
        this.miniCache = null;
        this.fullStaticKey = '';
      });
    }

    this.initEvents();
  }

  initEvents() {
    const closeBtn = document.getElementById('close-fullmap-btn');
    const miniCard = document.getElementById('minimap-card');
    const zoomInBtn = document.getElementById('map-zoom-in');
    const zoomOutBtn = document.getElementById('map-zoom-out');
    const centerPlayerBtn = document.getElementById('map-center-player');
    const fullIslandBtn = document.getElementById('map-view-all');
    this.clearRouteBtn = document.getElementById('map-clear-route');
    this.clearRouteBtn?.addEventListener('click', () => {
      this.waypoint = null;
      this.renderFullMap();
    });

    if (miniCard) {
      miniCard.addEventListener('click', () => this.toggleFullMap(true));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleFullMap(false));
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        this.viewZoom = Math.min(MAX_ZOOM, this.viewZoom * 1.45);
        this.renderFullMap();
      });
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        this.viewZoom = Math.max(MIN_ZOOM, this.viewZoom / 1.45);
        this.renderFullMap();
      });
    }
    if (centerPlayerBtn) {
      centerPlayerBtn.addEventListener('click', () => {
        const ent = this.controllerManager.getActiveEntity();
        this.viewCenterX = ent.position.x;
        this.viewCenterZ = ent.position.z;
        this.viewZoom = 0.9; // Street-by-street detail zoom
        this.renderFullMap();
      });
    }
    if (fullIslandBtn) {
      fullIslandBtn.addEventListener('click', () => {
        // Fits all of the city, and the airport south of it
        const b = { ...TOWN_BOUNDS, maxZ: Math.max(TOWN_BOUNDS.maxZ, 7230) };
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(w / ((b.maxX - b.minX) * 1.15), h / ((b.maxZ - b.minZ) * 1.06)));
        this.renderFullMap();
      });
    }

    if (this.elSearchInput) {
      this.elSearchInput.addEventListener('input', () => this.search(this.elSearchInput.value));
      // the game's keyboard stops Space and the arrows from doing anything on the page; keep them in the field, so
      // "main st" types its space and the arrows move the caret instead of the player
      this.elSearchInput.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.stopPropagation();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isFullMapOpen) {
        this.toggleFullMap(false);
      } else if (e.code === 'KeyM' && !isTypingInField(e) && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.toggleFullMap(!this.isFullMapOpen);
      }
    });

    if (this.fullCanvas) {
      this.fullCanvas.style.touchAction = 'none';
      this.fullCanvas.addEventListener('pointerdown', (e) => {
        // a Control-click is a right-click on a Mac: it sets a route (contextmenu below), never a teleport
        if (e.button !== 0 || e.ctrlKey || !this.isFullMapOpen || this.panPointerId !== null) return;
        this.routeClick = false;
        e.preventDefault();
        // a click in the whole-city overview moves the map there
        const r0 = this.fullCanvas.getBoundingClientRect();
        const there = this.overviewHit(e.clientX - r0.left, e.clientY - r0.top);
        if (there) {
          this.viewCenterX = there.x;
          this.viewCenterZ = there.z;
          this.renderFullMap();
          return;
        }
        this.panPointerId = e.pointerId;
        this.fullCanvas.setPointerCapture(e.pointerId);
        this.isPanning = true;
        this.dragMoved = false;
        this.panStart.x = e.clientX;
        this.panStart.y = e.clientY;
        this.panStart.cx = this.viewCenterX;
        this.panStart.cz = this.viewCenterZ;
        if (this.fullCanvasWrap) this.fullCanvasWrap.classList.add('is-panning');
      });

      this.fullCanvas.addEventListener('pointermove', (e) => {
        if (!this.isFullMapOpen || !this.fullCanvas) return;
        if (this.isPanning ? e.pointerId !== this.panPointerId : e.pointerType !== 'mouse') return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (this.isPanning) {
          e.preventDefault();
          const dx = e.clientX - this.panStart.x;
          const dy = e.clientY - this.panStart.y;
          if (Math.hypot(dx, dy) > 5) this.dragMoved = true;
          this.viewCenterX = this.panStart.cx - dx / this.viewZoom;
          this.viewCenterZ = this.panStart.cz - dy / this.viewZoom;
          this.queueFullMap();
          return;
        }

        if (this.cursor.on) this.showCursor(false);
        if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) {
          const wPos = this.screenToWorld(mx, my, rect.width, rect.height);
          if (this.elHoverInfo) {
            this.elHoverInfo.textContent = `${getLocationLabel(wPos.x, wPos.z)} · Click to teleport here · Right-click to set a route`;
            delete this.elHoverInfo.dataset.place;
          }
        }
      });

      this.fullCanvas.addEventListener('pointerup', (e) => {
        if (e.pointerId !== this.panPointerId) return;
        const clicked = e.button === 0 && !e.ctrlKey && !this.routeClick && !this.dragMoved && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) <= 5;
        this.cancelPan();
        if (clicked && this.isFullMapOpen && this.fullCanvas) {
          const rect = this.fullCanvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          if (mx >= 0 && mx <= rect.width && my >= 0 && my <= rect.height) this.teleportAt(mx, my, rect.width, rect.height);
        }
      });
      for (const type of ['pointercancel', 'lostpointercapture']) {
        this.fullCanvas.addEventListener(type, (e) => {
          if (e.pointerId === this.panPointerId) this.cancelPan();
        });
      }
      window.addEventListener('blur', () => this.cancelPan());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancelPan();
      });

      // A right-click sets the GPS route there without moving the player
      this.fullCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.routeClick = true;
        if (!this.isFullMapOpen) return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        if (this.overviewHit(mx, my)) return;
        const wPos = this.clampToTown(this.screenToWorld(mx, my, rect.width, rect.height));
        this.waypoint = { x: wPos.x, z: wPos.z, name: getLocationLabel(wPos.x, wPos.z) };
        this.renderFullMap();
      });

      // Wheel zoom about the cursor (the place under it stays put), by how far the wheel turned: a trackpad sends many
      // small steps and its glide after, a mouse one big step a notch (about 1.18x, as it always was). A sideways
      // swipe doesn't zoom
      this.fullCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const rect = this.fullCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = this.screenToWorld(mx, my, rect.width, rect.height);
        const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
        const factor = Math.exp(-Math.max(-110, Math.min(110, px)) * 0.0015);
        this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * factor));
        this.viewCenterX = before.x - (mx - rect.width * 0.5) / this.viewZoom;
        this.viewCenterZ = before.z - (my - rect.height * 0.5) / this.viewZoom;
        this.queueFullMap();
      }, { passive: false });
    }
  }

  /**
   * Street / landmark search: highlights every stretch of the matching streets and frames them (or flies to the
   * matching landmark)
   */
  search(text) {
    const q = String(text || '').trim().toLowerCase();
    this.searchHighlight = q;
    this.searchPath = null;
    // a house number and a street: fly to that house and route there, once the addresses are in
    if (/^\d+\s+\S/.test(q)) {
      loadAddressBook().then((book) => {
        if (String(this.elSearchInput?.value || '').trim().toLowerCase() !== q) return; // typed on since
        const hit = findAddress(book, q);
        if (!hit) {
          this.search(q.replace(/^\d+\s+/, '')); // no such house: show the street
          return;
        }
        this.searchHighlight = q.replace(/^\d+\s+/, '');
        this.searchPath = null;
        this.waypoint = { x: hit.x, z: hit.z, name: hit.name };
        this.viewCenterX = hit.x;
        this.viewCenterZ = hit.z;
        this.viewZoom = Math.max(this.viewZoom, 1.6);
        this.renderFullMap();
      });
      return;
    }
    if (q.length > 0) {
      // the best landmark: named exactly (its short name without 'the' too), then a word of its short name or its name
      // starting so, then the text anywhere in it (a champion tree after any other at the same rank). Streets with a
      // word starting so win over all but an exact name: 'maple' is Maple Rd, 'huron' Huron St, 'arb' still the Arb
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordStart = new RegExp(`(^|[^a-z0-9])${esc}`);
      let lmMatch = null, lmRank = Infinity;
      for (const l of LANDMARKS) {
        const name = l.name.toLowerCase(), short = l.short.toLowerCase();
        const rank = (name === q || short === q || short.replace(/^the /, '') === q ? 0 : wordStart.test(short) ? 1 : wordStart.test(name) ? 2
          : name.includes(q) || short.includes(q) ? 3 : Infinity) + (l.art === 'tree' ? 0.5 : 0);
        if (rank < lmRank) { lmRank = rank; lmMatch = l; }
      }
      const roads = ROAD_LABELS.filter((l) => l.lower.includes(q) || l.raw.includes(q));
      if (lmMatch && lmRank > 0 && roads.some((l) => wordStart.test(l.lower))) lmMatch = null;
      if (roads.length) {
        this.searchPath = new Path2D();
        const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (const l of roads) {
          addLine(this.searchPath, l.road.pts);
          b.minX = Math.min(b.minX, l.minX);
          b.maxX = Math.max(b.maxX, l.maxX);
          b.minZ = Math.min(b.minZ, l.minZ);
          b.maxZ = Math.max(b.maxZ, l.maxZ);
        }
        this.searchBounds = b;
      }
      if (lmMatch) {
        this.viewCenterX = lmMatch.x;
        this.viewCenterZ = lmMatch.z;
        this.viewZoom = Math.max(this.viewZoom, lmMatch.art ? 1.2 : 0.9);
      } else if (roads.length) {
        const b = this.searchBounds;
        const { w, h } = this.fullSize();
        this.viewCenterX = (b.minX + b.maxX) * 0.5;
        this.viewCenterZ = (b.minZ + b.maxZ) * 0.5;
        const fit = Math.min(w / ((b.maxX - b.minX) * 1.3 + 1), h / ((b.maxZ - b.minZ) * 1.3 + 1));
        this.viewZoom = Math.max(0.05, Math.min(1.2, fit));
      }
    }
    this.renderFullMap();
  }

  // Teleports to a point on the full map, clearing any GPS route (you're there)
  teleportAt(mx, my, w, h) {
    const wPos = this.clampToTown(this.screenToWorld(mx, my, w, h));
    this.waypoint = null;
    if (this.onTeleport) this.onTeleport(wPos.x, wPos.z);
    this.renderFullMap();
  }

  // The controller on the full map: the left stick moves a cursor (pushing the map along at its edges), the right
  // stick pans, the triggers or the pad's up and down zoom about the cursor, A teleports there, X sets the GPS route
  // there and Y clears it; View goes to the search field (B there comes back to the cursor)
  gamepad({ move, pan, zoom, go, mark, clear, search }, dt) {
    if (!this.isFullMapOpen || !this.fullCanvas) return;
    if (search && this.elSearchInput) {
      this.elSearchInput.focus();
      this.elSearchInput.select?.();
      return;
    }
    dt = Math.max(0, Math.min(0.1, dt || 0));
    const { w, h } = this.fullSize();
    const c = this.cursor;
    if (!c.on) {
      if (!(Math.hypot(move.x, move.y) > 0.05 || Math.hypot(pan.x, pan.y) > 0.05 || Math.abs(zoom) > 0.05 || go || mark || clear)) return;
      c.x = w * 0.5;
      c.y = h * 0.5;
      this.showCursor(true);
    }
    let changed = false;
    const speed = 760 * dt;
    // a gentle curve, so a light push places it to the pixel and a full one crosses the screen in a second
    const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
    if (move.x || move.y) {
      c.x += curve(move.x) * speed;
      c.y += curve(move.y) * speed; // the standard pad's sticks read down as positive
      const m = 40;
      const ox = Math.min(0, c.x - m) + Math.max(0, c.x - (w - m));
      const oy = Math.min(0, c.y - m) + Math.max(0, c.y - (h - m));
      if (ox || oy) {
        this.viewCenterX += ox / this.viewZoom;
        this.viewCenterZ += oy / this.viewZoom;
        changed = true;
      }
      c.x = Math.max(m, Math.min(w - m, c.x));
      c.y = Math.max(m, Math.min(h - m, c.y));
    }
    if (pan.x || pan.y) {
      this.viewCenterX += curve(pan.x) * speed * 1.4 / this.viewZoom;
      this.viewCenterZ += curve(pan.y) * speed * 1.4 / this.viewZoom;
      changed = true;
    }
    if (Math.abs(zoom) > 0.05) {
      const before = this.screenToWorld(c.x, c.y, w, h);
      this.viewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewZoom * Math.exp(zoom * 2.2 * dt)));
      this.viewCenterX = before.x - (c.x - w * 0.5) / this.viewZoom;
      this.viewCenterZ = before.z - (c.y - h * 0.5) / this.viewZoom;
      changed = true;
    }
    if (this.elCursor) this.elCursor.style.transform = `translate(${c.x}px, ${c.y}px)`;
    if (mark && !this.overviewHit(c.x, c.y)) {
      const wPos = this.clampToTown(this.screenToWorld(c.x, c.y, w, h));
      this.waypoint = { x: wPos.x, z: wPos.z, name: getLocationLabel(wPos.x, wPos.z) };
      changed = true;
    } else if (clear && this.waypoint) {
      this.waypoint = null;
      changed = true;
    }
    if (go) {
      const there = this.overviewHit(c.x, c.y);
      if (there) {
        this.viewCenterX = there.x;
        this.viewCenterZ = there.z;
        changed = true;
      } else {
        this.teleportAt(c.x, c.y, w, h);
        return;
      }
    }
    if (changed) this.queueFullMap();
    const at = this.screenToWorld(c.x, c.y, w, h);
    this.cursorPlace = getLocationLabel(at.x, at.z);
    this.drawCursorHint();
  }

  showCursor(on) {
    this.cursor.on = on;
    if (on && !this.elCursor && this.fullCanvasWrap) {
      this.elCursor = document.createElement('div');
      this.elCursor.className = 'fullmap-pad-cursor';
      this.fullCanvasWrap.append(this.elCursor);
    }
    if (this.elCursor) this.elCursor.hidden = !on;
    if (on && !this.stopHint) this.stopHint = onInput(() => this.drawCursorHint(true));
    if (!on && this.stopHint) {
      this.stopHint();
      this.stopHint = null;
    }
  }

  // The prompt under the map for the controller's cursor: the place, then how to teleport, move and zoom
  drawCursorHint(force = false) {
    const el = this.elHoverInfo;
    if (!el || !this.cursor.on) return;
    const place = this.cursorPlace || '';
    // (written again when the route is set or cleared, as Y's part comes and goes with it)
    const key = `${place}|${this.waypoint ? 1 : 0}`;
    if (!force && el.dataset.place === key) return;
    el.dataset.place = key;
    el.replaceChildren(place);
    const part = (what, text) => {
      const g = glyph(what);
      if (!g) return;
      el.append(' · ', g, ` ${text}`);
    };
    part(BUTTON.A, 'teleport here');
    part(BUTTON.X, 'set route');
    if (this.waypoint) part(BUTTON.Y, 'clear route');
    part(STICK.RIGHT, 'pan');
    const zoomIn = glyph(TRIGGER.RT), zoomOut = glyph(TRIGGER.LT);
    if (zoomIn && zoomOut) el.append(' · ', zoomOut, ' ', zoomIn, ' zoom');
    part(BUTTON.VIEW, 'search');
  }

  cancelPan() {
    const id = this.panPointerId;
    this.panPointerId = null;
    this.isPanning = false;
    if (this.fullCanvasWrap) this.fullCanvasWrap.classList.remove('is-panning');
    if (id !== null && this.fullCanvas && this.fullCanvas.hasPointerCapture(id)) this.fullCanvas.releasePointerCapture(id);
  }

  toggleFullMap(open) {
    this.isFullMapOpen = Boolean(open);
    if (!this.isFullMapOpen) {
      this.cancelPan();
      // the search field gives the keys and the controller back to the game (an engine may keep a hidden field focused)
      this.elSearchInput?.blur();
      // and its two full-screen canvases give their memory back (made again on opening)
      for (const c of [this.fullCanvas, this.fullStatic]) if (c) { c.width = 0; c.height = 0; }
      this.fullStaticKey = '';
      this.fullStaticView = null;
    }
    this.showCursor(false);
    if (this.onToggle) this.onToggle(this.isFullMapOpen);
    if (!this.modal) return;
    this.modal.classList.toggle('hidden', !this.isFullMapOpen);
    if (this.isFullMapOpen) {
      // the HUD's popovers live in the top layer, above the map
      for (const pop of document.querySelectorAll('.popover[popover]')) {
        if (typeof pop.hidePopover === 'function' && pop.matches(':popover-open')) pop.hidePopover();
      }
      const ent = this.controllerManager.getActiveEntity();
      this.viewCenterX = ent.position.x;
      this.viewCenterZ = ent.position.z;
      this.resizeFullCanvas();
      // with a controller the cursor's there from the start, in the middle, with its prompt; with the mouse, the
      // mouse's prompt
      if (document.body.dataset.input === 'controller' && this.fullCanvas) {
        const { w, h } = this.fullSize();
        this.cursor.x = w * 0.5;
        this.cursor.y = h * 0.5;
        this.showCursor(true);
        if (this.elCursor) this.elCursor.style.transform = `translate(${this.cursor.x}px, ${this.cursor.y}px)`;
        this.cursorPlace = getLocationLabel(this.viewCenterX, this.viewCenterZ);
        this.drawCursorHint(true);
      } else if (this.elHoverInfo) {
        this.elHoverInfo.textContent = this.hoverDefault;
        delete this.elHoverInfo.dataset.place;
      }
      this.renderFullMap();
    }
  }

  resizeFullCanvas() {
    if (!this.fullCanvas) return;
    // Layout size (the opening animation's transforms don't change it), at most ~6 megapixels however large the screen
    const w = this.fullCanvas.clientWidth || window.innerWidth;
    const h = this.fullCanvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6e6 / Math.max(1, w * h)));
    this.fullDpr = dpr;
    this.fullCanvas.width = Math.max(1, Math.floor(w * dpr));
    this.fullCanvas.height = Math.max(1, Math.floor(h * dpr));
  }

  // Full map size in CSS pixels
  fullSize() {
    const dpr = this.fullDpr || 1;
    if (!this.fullCanvas) return { w: 1200, h: 800 };
    return { w: this.fullCanvas.width / dpr, h: this.fullCanvas.height / dpr };
  }

  screenToWorld(sx, sy, width, height) {
    return {
      x: this.viewCenterX + (sx - width * 0.5) / this.viewZoom,
      z: this.viewCenterZ + (sy - height * 0.5) / this.viewZoom
    };
  }

  // Teleports land in town: inside its edge at that latitude
  clampToTown(p) {
    if (onAirfield(p.x, p.z)) return p; // inside the airport's fence, south of the city's edge
    const z = Math.max(TOWN_BOUNDS.minZ + 25, Math.min(TOWN_BOUNDS.maxZ - 25, p.z));
    const shore = getTownBoundsAtZ(z);
    const q = { x: Math.max(shore.westX + 12, Math.min(shore.eastX - 12, p.x)), z };
    if (inTown(q.x, q.z)) return q;
    // beyond the city's edge: the nearest place inside it, on a ring search
    for (let r = 25; r < 3000; r += 25) {
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12, x = q.x + Math.cos(a) * r, zz = q.z + Math.sin(a) * r;
        if (inTown(x, zz)) return { x, z: zz };
      }
    }
    return q;
  }

  textWidth(ctx, text) {
    const key = `${ctx.font}|${ctx.letterSpacing || ''}|${text}`;
    let w = this.textWidths.get(key);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      this.textWidths.set(key, w);
    }
    return w;
  }

  /**
   * The ground: the town inside its edge, parkland, the river, blocks, building footprints, landmark lots, the main
   * streets at low zoom, the freeways and the search highlight (world transform of view v)
   */
  drawWorld(ctx, v, isMinimap) {
    const L = mapLayers();
    const s = v.s;
    const px = (n) => n / s; // screen pixels -> metres (line widths)
    v.world(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 1 & 2. The town inside its edge (roadway colour: the streets are the gaps between the blocks), and the airport's
    // ground inside its fence, joined to it
    ctx.fillStyle = MAP.streets;
    ctx.fill(L.field);
    ctx.strokeStyle = MAP.shore;
    ctx.lineWidth = px(isMinimap ? 1.6 : 2.0);
    ctx.stroke(L.field);
    ctx.fill(L.town);
    ctx.strokeStyle = MAP.shore;
    ctx.lineWidth = px(isMinimap ? 1.6 : 2.0);
    ctx.stroke(L.town);

    // 3. Parkland, the river, blocks (curb islands) and park blocks
    ctx.fillStyle = MAP.park;
    L.parkLand.each(v, (p) => ctx.fill(p));
    if (s >= 0.08) {
      ctx.fillStyle = MAP.fairway;
      L.fairways.each(v, (p) => ctx.fill(p));
      ctx.fillStyle = MAP.green;
      L.greens.each(v, (p) => ctx.fill(p));
      ctx.fillStyle = MAP.bunker;
      L.bunkers.each(v, (p) => ctx.fill(p));
    }
    ctx.fillStyle = MAP.water;
    ctx.fill(L.river);
    ctx.fillStyle = MAP.block;
    L.blocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.22) {
      ctx.strokeStyle = MAP.blockEdge;
      ctx.lineWidth = px(Math.min(1.2, 0.5 + s));
      L.blocks.each(v, (p) => ctx.stroke(p));
    }
    ctx.fillStyle = MAP.park;
    L.parkBlocks.each(v, (p) => ctx.fill(p));
    if (s >= 0.1) {
      ctx.strokeStyle = MAP.parkEdge;
      ctx.lineWidth = px(1);
      L.parkBlocks.each(v, (p) => ctx.stroke(p));
    }

    // 4. The airport's runways, taxiways and aprons, over the park its fence makes, and the runways' centerlines
    ctx.fillStyle = MAP.fairway;
    ctx.fill(L.grassRunway);
    ctx.fillStyle = MAP.airfield;
    ctx.fill(L.airport);
    ctx.strokeStyle = MAP.airfield;
    ctx.lineWidth = Math.max(11, px(1.2));
    ctx.stroke(L.taxiways);
    ctx.strokeStyle = '#d9d6cc';
    ctx.lineWidth = Math.max(1, px(isMinimap ? 1.2 : 1.6));
    ctx.setLineDash([px(14), px(10)]);
    ctx.stroke(L.runwayLines);
    ctx.setLineDash([]);

    // 5. Building footprints, lowest first (the airport's hangars with them): from 0.3 px/m, where a house is more than a
    // speck (the full map opens at 0.22 px/m, most of the town, and drawing all its buildings each time it settled was
    // most of the map's cost)
    if (s >= 0.3) {
      ctx.fillStyle = MAP.buildings[1];
      ctx.fill(L.airBuildings);
      const fp = footprintLayers(this.allBlocks);
      if (fp) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = MAP.buildings[i];
          fp.tones[i].each(v, (p) => ctx.fill(p));
        }
        if (s >= 0.6) {
          ctx.strokeStyle = MAP.buildingEdge;
          ctx.lineWidth = px(0.8);
          for (let i = 0; i < 3; i++) fp.tones[i].each(v, (p) => ctx.stroke(p));
        }
      }
    }

    // 6. Landmark lots (real OpenStreetMap outlines)
    if (s >= 0.05) {
      ctx.fillStyle = MAP.block;
      ctx.fill(L.landmarks);
      ctx.fillStyle = MAP.landmarkFill;
      ctx.fill(L.landmarks);
      ctx.strokeStyle = MAP.landmarkEdge;
      ctx.lineWidth = px(Math.max(0.9, Math.min(1.6, 1.4 * s)));
      ctx.stroke(L.landmarks);
    }

    // 7. Main streets as lines at low zoom
    if (s < 0.16) {
      ctx.strokeStyle = MAP.mainRoads;
      ctx.lineWidth = px(s < 0.05 ? 0.7 : 1.1);
      L.mainRoads.each(v, (p) => ctx.stroke(p));
    }

    // 7b. On the big map always, on the radar while on the bike: the protected and buffered lanes (solid, stronger),
    // bike lanes (solid), shared lanes and signed routes (dashed) and the paved paths (thin)
    if (!isMinimap || this.controllerManager?.activeMode === 'cyclist') {
      ctx.strokeStyle = MAP.bikePath;
      ctx.lineWidth = Math.max(px(1.4), 2.5);
      L.bikePaths.each(v, (p) => ctx.stroke(p));
      ctx.strokeStyle = MAP.bike;
      ctx.setLineDash([Math.max(px(4), 9), Math.max(px(4), 9)]);
      ctx.lineWidth = Math.max(px(1.8), 3);
      L.bikeShared.each(v, (p) => ctx.stroke(p));
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(px(2.6), 4.5);
      L.bikeLanes.each(v, (p) => ctx.stroke(p));
      ctx.strokeStyle = MAP.bikeStrong;
      ctx.lineWidth = Math.max(px(3.2), 5.5);
      L.bikeStrong.each(v, (p) => ctx.stroke(p));
    }

    // 8. Freeways
    ctx.strokeStyle = MAP.highway;
    ctx.lineWidth = Math.max(px(isMinimap ? 2.4 : 1.6), 14);
    ctx.stroke(L.highways);

    // 9. The city limits, dashed
    ctx.strokeStyle = MAP.limits;
    ctx.lineWidth = Math.max(px(isMinimap ? 1.4 : 1.8), 3);
    ctx.setLineDash([Math.max(px(8), 14), Math.max(px(6), 10)]);
    ctx.stroke(L.limits);
    ctx.setLineDash([]);

    // 10. Search highlight: every stretch of the matching streets
    if (this.searchPath && !isMinimap) {
      ctx.strokeStyle = MAP.search;
      ctx.lineWidth = Math.max(px(3), 9);
      ctx.stroke(this.searchPath);
    }
  }

  /**
   * Street names along the streets (screen transform of view v): the best anchor of each street that fits its name,
   * one label per street per `sameNameGap` pixels, none overlapping another (or the boxes already in `placed`)
   */
  drawRoadLabels(ctx, v, { fontPx = 10, maxLabels = 400, sameNameGap = 260, placed = [], majorOnly = false } = {}) {
    const s = v.s;
    const q = this.searchHighlight;
    ctx.font = `600 ${fontPx}px ${FONT}`;
    const inset = (fontPx * 2.5) / s;
    const minX = v.minX + inset;
    const maxX = v.maxX - inset;
    const minZ = v.minZ + inset;
    const maxZ = v.maxZ - inset;
    const cands = [];
    for (const l of ROAD_LABELS) {
      if (l.maxX < minX || l.minX > maxX || l.maxZ < minZ || l.minZ > maxZ) continue;
      const hit = q.length > 0 && (l.lower.includes(q) || l.raw.includes(q));
      if (majorOnly && !l.major && !hit) continue;
      const width = this.textWidth(ctx, l.text);
      const need = (width + 14) / s;
      for (const a of l.anchors) {
        if (a.len < need || a.x < minX || a.x > maxX || a.z < minZ || a.z > maxZ) continue;
        const d = Math.hypot(a.x - v.cx, a.z - v.cz) * s;
        cands.push({ l, a, width, hit, score: (hit ? 1e6 : 0) + (l.highway ? 3000 : 0) + (l.major ? 2000 : 0) + Math.min(a.len * s, 400) - d * 0.5 });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    const byName = new Map();
    let n = 0;
    for (const c of cands) {
      if (n >= maxLabels) break;
      const X = v.toX(c.a.x);
      const Y = v.toY(c.a.z);
      const same = byName.get(c.l.text);
      if (same && same.some(([x, y]) => Math.hypot(x - X, y - Y) < sameNameGap)) continue;
      const hw = c.width * 0.5 + 3;
      const hh = fontPx * 0.5 + 2;
      const ca = Math.abs(Math.cos(c.a.ang));
      const sa = Math.abs(Math.sin(c.a.ang));
      const bx = hw * ca + hh * sa;
      const by = hw * sa + hh * ca;
      const box = [X - bx, Y - by, X + bx, Y + by];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      if (same) same.push([X, Y]);
      else byName.set(c.l.text, [[X, Y]]);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(c.a.ang);
      ctx.fillStyle = c.hit ? MAP.search : c.l.highway ? '#e3a857' : c.l.major ? '#e8ebf0' : '#9ba5b3';
      ctx.strokeText(c.l.text, 0, 0);
      ctx.fillText(c.l.text, 0, 0);
      ctx.restore();
      n++;
    }
    ctx.textBaseline = 'alphabetic';
  }

  update() {
    // Arrived: the GPS route goes once the player is within 25 m of its end
    if (this.waypoint && !this.isFullMapOpen) {
      const p = this.controllerManager.getActiveEntity().position;
      if (Math.hypot(p.x - this.waypoint.x, p.z - this.waypoint.z) < 25) this.waypoint = null;
    }
    // The full map covers the whole screen, radar included
    if (this.isFullMapOpen) {
      this.renderFullMap();
    } else {
      this.renderMinimap();
      for (const r of this.radars || []) this.renderMinimap(r);
    }
  }

  // The GPS route along the streets for a player at (x, z) (`r`: this map, or another player's radar): found again
  // when the waypoint changes or the player has gone 15 m from where it was last found, from the player otherwise
  routeFor(r, x, z) {
    const c = r.route;
    if (c && c.waypoint === this.waypoint && Math.hypot(x - c.x, z - c.z) < 15) {
      c.pts[0].x = x;
      c.pts[0].z = z;
      return c.pts;
    }
    r.route = { waypoint: this.waypoint, x, z, pts: findRoute(x, z, this.waypoint.x, this.waypoint.z) };
    return r.route.pts;
  }

  // Lamp: another player's radar (split screen, split-screen.js): its own canvas and street label, centred on their
  // player and turned with their camera. Answers a function that takes it away.
  addRadar(canvas, streetEl, controllerManager, cameraSystem) {
    const r = { miniCanvas: canvas, miniCtx: canvas.getContext('2d'), elMiniStreet: streetEl, miniStreetText: '',
      miniScale: RADAR_SCALE, miniCache: null, controllerManager, cameraSystem };
    (this.radars ||= []).push(r);
    return () => { this.radars = this.radars.filter((x) => x !== r); };
  }

  // =========================================================================
  // 1. LIVE MINIMAP (BOTTOM-LEFT HUD)
  // =========================================================================
  // `r` is the radar: this map's own, or another player's (addRadar)
  renderMinimap(r = this) {
    if (!r.miniCtx || !r.miniCanvas) return;
    // Nothing to draw while the radar is hidden (narrow screens, clean view)
    // (its size kept by a ResizeObserver where there is one, rather than read from the layout each frame, which made
    // the page lay itself out again mid-frame; a hidden radar is 0 by 0)
    if (!r.miniSize) {
      r.miniSize = { w: r.miniCanvas.clientWidth, h: r.miniCanvas.clientHeight, watched: typeof ResizeObserver === 'function' };
      if (r.miniSize.watched) {
        new ResizeObserver(() => {
          r.miniSize.w = r.miniCanvas.clientWidth;
          r.miniSize.h = r.miniCanvas.clientHeight;
        }).observe(r.miniCanvas);
      }
    }
    if (!r.miniSize.watched) {
      r.miniSize.w = r.miniCanvas.offsetParent ? r.miniCanvas.clientWidth : 0;
      r.miniSize.h = r.miniCanvas.clientHeight;
    }
    if (!r.miniSize.w || !r.miniSize.h || document.body.classList.contains('hud-minimized')) return;
    const ctx = r.miniCtx;
    // Radar size in CSS pixels, backed at the device pixel ratio (crisp street names on HiDPI screens)
    const w = r.miniSize.w;
    const h = r.miniSize.h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (r.miniCanvas.width !== bw || r.miniCanvas.height !== bh) {
      r.miniCanvas.width = bw;
      r.miniCanvas.height = bh;
      r.miniCache = null;
    }

    const ent = r.controllerManager.getActiveEntity();
    const px = ent.position.x;
    const pz = ent.position.z;
    // Ground-level radar shows ~800 m of the city; it zooms out as the camera climbs (helicopter)
    const target = Math.max(0.05, RADAR_SCALE / (1 + Math.max(0, ent.position.y - groundHeight(ent.position.x, ent.position.z) - 25) / 180));
    r.miniScale += (target - r.miniScale) * 0.08;
    const scale = r.miniScale;

    // the street under the player, looked up four times a second
    const now = performance.now();
    if (r.elMiniStreet && !(now < r.miniLabelAt)) {
      r.miniLabelAt = now + 250;
      const label = getLocationLabel(px, pz);
      if (label !== r.miniStreetText) {
        r.miniStreetText = label;
        r.elMiniStreet.textContent = label;
      }
    }

    // Ground layers & street names come from a cached render twice the radar's size, redrawn when the player nears its
    // edge or the zoom drifts (or the buildings arrive)
    const fp = footprintLayers(this.allBlocks);
    const version = fp ? fp.version : 0;
    const bikeView = r.controllerManager.activeMode === 'cyclist';
    let c = r.miniCache;
    if (!c || c.version !== version || c.bike !== bikeView || Math.abs(scale / c.s - 1) > 0.12 ||
      Math.abs(px - c.cx) > w / c.s - w / (2 * scale) - 8 / scale ||
      Math.abs(pz - c.cz) > h / c.s - h / (2 * scale) - 8 / scale) {
      if (!c) {
        c = r.miniCache = { canvas: document.createElement('canvas') };
        c.canvas.width = bw * 2;
        c.canvas.height = bh * 2;
        c.ctx = c.canvas.getContext('2d');
      }
      c.cx = px;
      c.cz = pz;
      c.s = scale;
      c.version = version;
      c.bike = bikeView;
      c.ctx.setTransform(1, 0, 0, 1, 0, 0);
      c.ctx.fillStyle = MAP.water;
      c.ctx.fillRect(0, 0, bw * 2, bh * 2);
      const cv = new MapView(px, pz, scale, w * 2, h * 2, dpr);
      this.drawWorld(c.ctx, cv, true);
      cv.screen(c.ctx);
      this.drawRoadLabels(c.ctx, cv, { fontPx: 9.5, maxLabels: 28, sameNameGap: 180 });
    }

    const v = new MapView(px, pz, scale, w, h, dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, bw, bh);
    const k = scale / c.s;
    ctx.drawImage(c.canvas, dpr * ((c.cx - w / c.s - px) * scale + w * 0.5), dpr * ((c.cz - h / c.s - pz) * scale + h * 0.5),
      dpr * w * 2 * k, dpr * h * 2 * k);

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // Live moving traffic blips on radar
    if (this.trafficSystem && this.trafficSystem.cars) {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.34)';
      for (let i = 0; i < this.trafficSystem.cars.length; i += 2) {
        const car = this.trafficSystem.cars[i];
        const cx = toX(car.x);
        const cy = toY(car.z);
        if (Math.abs(cx) < w * 0.5 && Math.abs(cy) < h * 0.5) {
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // GPS route to the active waypoint
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      drawRoute(ctx, this.routeFor(r, px, pz), toX, toY, 3);
      drawWaypoint(ctx, wx, wy, 4.5);
    }

    // Landmark blips
    for (const lm of LANDMARKS) {
      const lx = toX(lm.x);
      const ly = toY(lm.z);
      if (Math.abs(lx) < w * 0.48 && Math.abs(ly) < h * 0.48) {
        if (lm.art === 'tree') { drawTreeSign(ctx, lx, ly, 5); continue; }
        if (lm.art === 'golf') { drawGolfSign(ctx, lx, ly, 6); continue; }
        const r = lm.art ? 0.7 : 1;
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 4.5 * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ART_PIN[lm.art] || '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.8 * r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Road work: an orange diamond at each closed block (road-work.js; set by main.js)
    for (const site of this.workSites || []) {
      const sx = toX(site.x), sy = toY(site.z);
      if (Math.abs(sx) < w * 0.48 && Math.abs(sy) < h * 0.48) drawWorkSign(ctx, sx, sy, 5);
    }


    // Camera FOV Cone & Player Arrow at center (0, 0)
    const look = r.cameraSystem.currentLookAt, from = r.cameraSystem.currentPos;
    const camAngle = Math.atan2(look.x - from.x, look.z - from.z);

    ctx.save();
    ctx.rotate(-camAngle + Math.PI);
    if (!r.miniGrad) {
      r.miniGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
      r.miniGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      r.miniGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    }
    ctx.fillStyle = r.miniGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -9, 6.5, 7);
    ctx.restore();

    ctx.restore();
  }

  // =========================================================================
  // 2. FULL NEW YORK CITY INTERACTIVE STREET MAP MODAL ([M])
  // =========================================================================
  // A change to the view from input: drawn by the next frame (update), which draws the map anyway, rather than once
  // more for each event (several can land in one frame); drawn here if no frame comes
  queueFullMap() {
    if (this.fullQueued) return;
    this.fullQueued = setTimeout(() => this.renderFullMap(), 100);
  }

  renderFullMap() {
    if (this.fullQueued) { clearTimeout(this.fullQueued); this.fullQueued = 0; }
    this.clearRouteBtn?.classList.toggle('hidden', !this.waypoint);
    if (!this.fullCtx || !this.fullCanvas || !this.isFullMapOpen) return;
    const ctx = this.fullCtx;
    const dpr = this.fullDpr || 1;
    const { w, h } = this.fullSize();
    const v = new MapView(this.viewCenterX, this.viewCenterZ, this.viewZoom, w, h, dpr);

    const ent = this.controllerManager.getActiveEntity();
    if (this.elPlayerInfo) {
      const text = `You are at ${getLocationLabel(ent.position.x, ent.position.z)}`;
      if (text !== this.playerInfoText) {
        this.playerInfoText = text;
        this.elPlayerInfo.textContent = text;
      }
    }

    // Ground layers, names & landmark pins: re-rendered only when the view, the search or the buildings change
    const fp = footprintLayers(this.allBlocks);
    const rest = `${this.fullCanvas.width}|${this.fullCanvas.height}|${this.searchHighlight}|${fp ? fp.version : 0}`;
    const key = `${v.cx}|${v.cz}|${v.s}|${rest}`;
    if (!this.fullStatic) this.fullStatic = document.createElement('canvas');
    // While the view is being panned or zoomed, the layers already drawn are moved and scaled to it (they're a
    // picture), and drawn afresh once it rests: drawing every footprint, block and path again for each step held the
    // map to a few frames a second
    const now = performance.now();
    if (key !== this.fullViewKey) {
      this.fullViewKey = key;
      this.fullMovedAt = now;
    }
    const was = this.fullStaticView;
    const k = was ? v.s / was.s : 1;
    const shiftX = was ? (was.cx - v.cx) * v.s * dpr : 0, shiftY = was ? (was.cz - v.cz) * v.s * dpr : 0;
    const glide = key !== this.fullStaticKey && was && was.rest === rest && now - this.fullMovedAt < 120 &&
      k > 0.5 && k < 2 && Math.abs(shiftX) < this.fullCanvas.width * 0.5 && Math.abs(shiftY) < this.fullCanvas.height * 0.5;
    if (key !== this.fullStaticKey && !glide) {
      this.fullStaticKey = key;
      this.fullStaticView = { cx: v.cx, cz: v.cz, s: v.s, rest };
      const sc = this.fullStatic;
      if (sc.width !== this.fullCanvas.width || sc.height !== this.fullCanvas.height) {
        sc.width = this.fullCanvas.width;
        sc.height = this.fullCanvas.height;
      }
      this.renderFullMapStatic(sc.getContext('2d'), v);
    }
    if (glide) {
      // drawn afresh shortly after the last step, even where no frame comes to do it
      clearTimeout(this.fullSettle);
      this.fullSettle = setTimeout(() => this.renderFullMap(), 150);
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (glide) {
      const W = this.fullCanvas.width, H = this.fullCanvas.height;
      ctx.fillStyle = MAP.water;
      ctx.fillRect(0, 0, W, H);
      ctx.setTransform(k, 0, 0, k, W * 0.5 * (1 - k) + shiftX, H * 0.5 * (1 - k) + shiftY);
    }
    ctx.drawImage(this.fullStatic, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // GPS route on the full map
    if (this.waypoint) {
      const wx = toX(this.waypoint.x);
      const wy = toY(this.waypoint.z);
      drawRoute(ctx, this.routeFor(this, ent.position.x, ent.position.z), toX, toY, 4);
      drawWaypoint(ctx, wx, wy, 7);
    }


    // Road work: an orange diamond at each closed block
    for (const site of this.workSites || []) {
      const sx = toX(site.x), sy = toY(site.z);
      if (Math.abs(sx) < v.w * 0.5 && Math.abs(sy) < v.h * 0.5) (v.s < DOTS_UNDER ? drawDot(ctx, sx, sy, '#ff8a1f', 2.2) : drawWorkSign(ctx, sx, sy, 7 * iconScale(v.s)));
    }


    // Live Player Blip & Heading Arrow, with a slow pulse to find it at a glance
    const px = toX(ent.position.x);
    const py = toY(ent.position.z);

    ctx.save();
    ctx.translate(px, py);
    const pulse = (performance.now() % 1800) / 1800;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.24 * (1 - pulse)})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + pulse * 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(-ent.heading + Math.PI);
    drawPlayerArrow(ctx, -11, 7.5, 8);
    ctx.restore();

    ctx.restore();
    this.drawOverview(ctx, v, ent);
  }

  // Lamp: the whole city small in the bottom left, with the part on screen boxed, whenever the view shows less than all
  // of it; a click in it moves the map there (`overviewHit`)
  overviewBox(v) {
    const b = this.limitsBounds || (this.limitsBounds = (() => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const ring of CITY_LIMITS) for (const p of ring) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const f = AIRPORT.bounds; // and the airport, south of the line
      for (let i = 0; i < f.length; i += 2) {
        minX = Math.min(minX, f[i]); maxX = Math.max(maxX, f[i]); minZ = Math.min(minZ, f[i + 1]); maxZ = Math.max(maxZ, f[i + 1]);
      }
      return { minX, maxX, minZ, maxZ };
    })());
    if (!Number.isFinite(b.minX)) return null;
    if (v.minX <= b.minX && v.maxX >= b.maxX && v.minZ <= b.minZ && v.maxZ >= b.maxZ) return null;
    const pad = 10, side = Math.min(190, v.w * 0.24, v.h * 0.3);
    const s = side / Math.max(b.maxX - b.minX, b.maxZ - b.minZ) ;
    const w = (b.maxX - b.minX) * s + pad * 2, h = (b.maxZ - b.minZ) * s + pad * 2;
    const left = 20, bottom = v.w < 1080 ? 150 : 20;
    return { b, s, pad, w, h, x: left, y: v.h - bottom - h };
  }

  drawOverview(ctx, v, ent) {
    const o = this.overviewBox(v);
    this.overview = o;
    if (!o) return;
    const dpr = v.dpr;
    // the panel and its city never change: drawn once into a picture of its own (again when its size does)
    const key = `${o.w}|${o.h}|${dpr}`;
    if (this.overviewKey !== key) {
      this.overviewKey = key;
      const pic = this.overviewPic || (this.overviewPic = document.createElement('canvas'));
      pic.width = Math.ceil(o.w * dpr) + 2;
      pic.height = Math.ceil(o.h * dpr) + 2;
      const c = pic.getContext('2d'), L = mapLayers();
      c.setTransform(dpr, 0, 0, dpr, dpr * 0.5 + 0.5, dpr * 0.5 + 0.5);
      c.fillStyle = 'rgba(10, 13, 18, 0.82)';
      c.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(0, 0, o.w, o.h, 12);
      c.fill();
      c.stroke();
      c.clip();
      // the city in world metres, inside the panel
      const k = o.s * dpr;
      c.setTransform(k, 0, 0, k, dpr * (o.pad - o.b.minX * o.s) + dpr * 0.5 + 0.5, dpr * (o.pad - o.b.minZ * o.s) + dpr * 0.5 + 0.5);
      c.fillStyle = MAP.streets;
      c.fill(L.limits, 'evenodd');
      c.fill(L.field);
      c.fillStyle = MAP.water;
      c.fill(L.river, 'evenodd');
      c.fillStyle = '#4a525e';
      c.fill(L.airport);
      c.strokeStyle = MAP.highway;
      c.lineWidth = 1.4 / o.s;
      c.stroke(L.highways);
      c.strokeStyle = MAP.limits;
      c.lineWidth = 1 / o.s;
      c.stroke(L.limits);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overviewPic, Math.round(dpr * o.x - dpr * 0.5 - 0.5), Math.round(dpr * o.y - dpr * 0.5 - 0.5));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, o.w, o.h, 12);
    ctx.clip();
    const X = (x) => o.x + o.pad + (x - o.b.minX) * o.s, Y = (z) => o.y + o.pad + (z - o.b.minZ) * o.s;
    // what's on screen now
    const x0 = X(v.minX), y0 = Y(v.minZ), x1 = X(v.maxX), y1 = Y(v.maxZ);
    ctx.fillStyle = 'rgba(255, 194, 26, 0.12)';
    ctx.strokeStyle = MAP.route;
    ctx.lineWidth = 1.5;
    const bw = Math.max(4, x1 - x0), bh = Math.max(4, y1 - y0);
    ctx.fillRect((x0 + x1 - bw) / 2, (y0 + y1 - bh) / 2, bw, bh);
    ctx.strokeRect((x0 + x1 - bw) / 2, (y0 + y1 - bh) / 2, bw, bh);
    // you
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(ent.position.x), Y(ent.position.z), 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // the world point under (mx, my) in the overview, or null outside it
  overviewHit(mx, my) {
    const o = this.overview;
    if (!o || mx < o.x || mx > o.x + o.w || my < o.y || my > o.y + o.h) return null;
    return { x: o.b.minX + (mx - o.x - o.pad) / o.s, z: o.b.minZ + (my - o.y - o.pad) / o.s };
  }

  renderFullMapStatic(ctx, v) {
    const { w, h, s } = v;
    ctx.save();
    // 1. Harbor & River Water Base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP.water;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // 2. The ground: the town's blocks, parks, the river, footprints and freeways
    this.drawWorld(ctx, v, false);

    v.screen(ctx);
    const toX = (wx) => v.toX(wx);
    const toY = (wz) => v.toY(wz);

    // 3. Iconic Landmark Pins & Collision-Free Labels (placed first: their boxes keep the other names clear)
    ctx.font = `700 11px ${FONT}`;
    const placed = [];
    const pins = [];
    // the big landmarks first, then the murals and sculptures, whose names show only once zoomed in
    // (the champion trees' badges show at every zoom, their names only zoomed in)
    const ordered = [...LANDMARKS.filter((l) => !l.art), ...LANDMARKS.filter((l) => l.art && (s >= 0.6 || l.art === 'tree' || l.art === 'golf'))];
    for (const lm of ordered) {
      const lx = toX(lm.x);
      const ly = toY(lm.z);
      if (Math.abs(lx) > w * 0.48 || Math.abs(ly) > h * 0.48) continue;
      const labelW = this.textWidth(ctx, lm.short) + 6;
      const box = [lx + 6, ly - 8, lx + 8 + labelW, ly + 7];
      const showLabel = (s >= 0.6 || !lm.art || lm.art === 'golf') && !overlaps(placed, box);
      placed.push([lx - 6, ly - 6, lx + 6, ly + 6]);
      if (showLabel) placed.push(box);
      pins.push({ lm, lx, ly, showLabel });
    }

    // 4. Borough, waterway & neighbourhood watermark titles (wherever they fit), letter-spaced like a printed atlas
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tracking = 'letterSpacing' in ctx;
    for (const [label, x, z, kind] of AREA_LABELS) {
      if (kind === 0 && s > 0.07) continue;
      if (kind === 2 && (s < 0.035 || s > 1.2)) continue;
      const dx = toX(x);
      const dy = toY(z);
      if (Math.abs(dx) > w * 0.47 || Math.abs(dy) > h * 0.47) continue;
      if (kind === 0) {
        ctx.font = `700 15px ${FONT}`;
        ctx.fillStyle = 'rgba(168, 178, 192, 0.5)';
        if (tracking) ctx.letterSpacing = '3px';
      } else if (kind === 1) {
        ctx.font = `italic 500 12px ${FONT}`;
        ctx.fillStyle = 'rgba(112, 168, 214, 0.55)';
        if (tracking) ctx.letterSpacing = '1.5px';
      } else {
        ctx.font = `700 10.5px ${FONT}`;
        ctx.fillStyle = 'rgba(168, 178, 192, 0.46)';
        if (tracking) ctx.letterSpacing = '1.8px';
      }
      const half = this.textWidth(ctx, label) * 0.5 + 4;
      const box = [dx - half, dy - 8, dx + half, dy + 8];
      if (overlaps(placed, box)) continue;
      placed.push(box);
      ctx.fillText(label, dx, dy);
    }
    if (tracking) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'alphabetic';

    // 5. Street & Avenue names along their real course (collision-free at all zoom levels)
    const fontPx = Math.max(9, Math.min(12, Math.round(9.5 * Math.sqrt(Math.max(s, 0.4)))));
    this.drawRoadLabels(ctx, v, { fontPx, maxLabels: 420, sameNameGap: 300, placed, majorOnly: s < 0.3 });

    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    const ik = iconScale(s);
    for (const { lm, lx, ly, showLabel } of pins) {
      const r = (lm.art ? 0.7 : 1) * ik;
      if (lm.art === 'golf') drawGolfSign(ctx, lx, ly, 8 * ik); // at every zoom
      else if (s < DOTS_UNDER) drawDot(ctx, lx, ly, lm.art === 'tree' ? '#43d17f' : ART_PIN[lm.art] || '#ffffff', lm.art ? 2.2 : 3);
      else if (lm.art === 'tree') drawTreeSign(ctx, lx, ly, 7 * ik);
      else {
        ctx.fillStyle = MAP.halo;
        ctx.beginPath();
        ctx.arc(lx, ly, 6.5 * r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ART_PIN[lm.art] || '#ffffff';
        ctx.beginPath();
        ctx.arc(lx, ly, 4.2 * r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (showLabel) {
        const tx = lx + 3 + 6 * ik;
        ctx.lineWidth = 3;
        ctx.strokeStyle = MAP.halo;
        ctx.strokeText(lm.short, tx, ly + 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(lm.short, tx, ly + 4);
      }
    }

    // 6. Scale bar (true metres); the true-north compass sits with the map controls (index.html)
    this.drawScaleBar(ctx, v);
    ctx.restore();
  }

  drawScaleBar(ctx, v) {
    const target = 120 / v.s; // metres in ~120 px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const step = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow;
    const len = step * v.s;
    // beside the whole-city inset where that sits in the bottom left corner (wide windows), not under it
    const o = this.overviewBox(v);
    const x0 = -v.w * 0.5 + (o && o.y + o.h > v.h - 40 ? o.x + o.w + 16 : 24);
    const y0 = v.h * 0.5 - 26;
    const label = step >= 1000 ? `${step / 1000} km` : `${step} m`;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 6);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.lineTo(x0 + len, y0 - 6);
    ctx.strokeStyle = MAP.halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236, 239, 244, 0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `650 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = MAP.halo;
    ctx.strokeText(label, x0 + len + 8, y0 + 3);
    ctx.fillStyle = 'rgba(236, 239, 244, 0.95)';
    ctx.fillText(label, x0 + len + 8, y0 + 3);
  }
}

// Lamp: a change to how the minimap and the full map are drawn goes into the running city; one to the buttons, keys
// and dragging the constructor set up opens the page again.
live.accept((next, { changed }) => {
  if (changed.some((name) => /\.initEvents$/.test(name))) return false;
  // What's drawn is kept between frames until the player moves: drawn again with the new code.
  for (const system of systems) {
    system.miniCache = null;
    system.fullStaticKey = '';
    system.overviewKey = '';
    if (system.isFullMapOpen) system.renderFullMap();
  }
});

export { CityMapSystem };
