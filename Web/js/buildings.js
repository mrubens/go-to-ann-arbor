import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addBuildingDetails } from './building-details.js';
import {
  Fn,
  vec2,
  color,
  uv,
  normalWorldGeometry,
  abs,
  fract,
  step,
  smoothstep,
  fwidth,
  max,
  min,
  mix,
  length
} from 'three/tsl';
import {
  ALL_AVENUES,
  BIG_PARK_BOUNDS,
  TOWN_BOUNDS,
  LANDMARK_SITES,
  streetZ,
  avenueX
} from './city-config.js';
import {
  createPreWarBuildingMaterial,
  createCurtainWallMaterial,
  createBillboardMaterial,
  filteredPulse
} from './tsl-materials.js';
import { GEO } from './city-geodata.js';
import { REAL_BUILDINGS } from './building-geodata.js';

// Lamp: the University's old collegiate core, 600 m round the Diag (State St to Washtenaw, the Law Quad to the Union
// and Angell), where its own buildings are red-brown collegiate brick and limestone. Its other buildings (North
// Campus, the medical campus, athletics, Wall St, south campus) are mostly from the 1950s on: tan-orange brick with
// wide windows, gray metal panel, red brick on some, and curtain-wall glass on the taller ones (a low one is glass
// only where its photo says: one at random put a blue glass front on a block service building on Hill St)
const collegiateCore = (x, z) => Math.hypot(x - 848, z - 317) < 600;
import { createBuildingFootprints } from './building-footprints.js';
import { beginShopBays, shopBayStats, setShopOutlines, setShopAwnings } from './shop-types.js';
import { buildHouses, streamHouses, shopLook } from './houses.js';
import { TIER } from './device-tier.js';
import { groundStreamCenter } from './terrain.js';
import { buildChurches, churchPlan, churchLayout } from './churches.js';
import { log } from '../lamp-game.js';
import { buildGasStations, canopyFootprints, insideCanopy } from './gas-stations.js';
import { landUseAt, historicDistrictAt, LAND_USE } from './districts.js';
// Lamp: the downtown core and central campus (x east and z south of Main & Liberty, m: as utility-poles.js UNDERGROUND)
const CORE = [[-300, 700, -170, 300], [700, 1450, -250, 820], [-120, 420, 1250, 1900]];
const inCore = (x, z) => CORE.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
import { groundHeight } from './terrain.js';
import { polygonContains, polygonBoxOverlaps } from './building-collision.js';
import { pavedPlazaRects, parkTreeSites, sidewalkBlocks } from './city-grid.js';
import { GRANDSTANDS } from './football-fields.js';
// the lawns sit this far over the ground (city-grid.js): a house or church floor stands on them
const LAWN_Y = LIFT.lawn;
import { LIFT } from './ground-lifts.js';

// Surveyed footprints define buildings and collisions; architectural details stream around the player.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spatial 2D quadtree for range queries around the active player/camera position.
 */
class Quadtree {
  constructor(bounds, capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x, z) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx, cz, radius) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new Quadtree({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new Quadtree({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new Quadtree({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new Quadtree({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item) {
    if (this.nw.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item) {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx, cz, radius, found = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw.queryRange(cx, cz, radius, found);
    this.ne.queryRange(cx, cz, radius, found);
    this.sw.queryRange(cx, cz, radius, found);
    this.se.queryRange(cx, cz, radius, found);
    return found;
  }
}

function buildCityBlocks(scene, landmarkColliders = [], addresses = null, gasStations = null) {
  const group = new THREE.Group();
  group.name = 'CityBlocks';
  const colliders = [];

  // Stream nearby architectural details.
  const quadtree = new Quadtree({
    minX: TOWN_BOUNDS.minX - 50,
    maxX: TOWN_BOUNDS.maxX + 50,
    minZ: TOWN_BOUNDS.minZ - 50,
    maxZ: TOWN_BOUNDS.maxZ + 50
  }, 6, 9);
  const allBlocks = [];

  const facades = [
    // 0: Pre-War Limestone & Buff Brick (5th Ave / Madison Ave / Upper East Side style)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xd8cdb8,
      trimColor: 0x9e937f,
      windowGlassColor: 0x1a2836,
      windowWidth: 2.0,
      lotFronts: true,
      floorHeight: 4.0,
      windowRatioX: 0.46,
      windowRatioY: 0.64,
      litProbability: 0.54,
      warmth: 0.80,
      seed: 12.4
    }],
    // 1: Historic Warm Red/Terracotta Brick (Garment District / Chelsea / SoHo / Upper West Side)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xa45a45,
      trimColor: 0xcab9a0,
      windowGlassColor: 0x16222e,
      windowWidth: 2.0,
      lotFronts: true,
      floorHeight: 4.0,
      windowRatioX: 0.46,
      windowRatioY: 0.64,
      litProbability: 0.56,
      warmth: 0.86,
      seed: 27.8
    }],
    // 2: Blue-Teal Curtain-Wall Glass (Park Ave / 6th Ave / Financial District modernism)
    [createCurtainWallMaterial, {
      glassTint: 0x1a3a52,
      frameTint: 0x3b4c5b,
      windowWidth: 2.7,
      floorHeight: 3.9,
      litProbability: 0.60,
      warmth: 0.52,
      reflectivity: 0.92,
      seed: 63.5
    }],
    // 3: Dark Bronze / Charcoal Miesian Glass (Avenue of the Americas / Midtown West)
    [createCurtainWallMaterial, {
      glassTint: 0x242220,
      frameTint: 0x3c3631,
      windowWidth: 2.5,
      floorHeight: 3.8,
      litProbability: 0.64,
      warmth: 0.72,
      reflectivity: 0.88,
      seed: 81.9
    }],
    // 4: Silver / Ice-Blue Contemporary Supertall Glass (Billionaires' Row / Hudson Yards / WTC)
    [createCurtainWallMaterial, {
      glassTint: 0x264664,
      frameTint: 0xb0bcc8,
      windowWidth: 2.9,
      floorHeight: 4.1,
      litProbability: 0.58,
      warmth: 0.48,
      reflectivity: 0.95,
      seed: 94.3
    }]
  ];
  // Ann Arbor's houses: painted clapboard & siding in the old neighbourhoods' colours, two storeys
  facades.push(
    // 5: White & cream clapboard
    [createPreWarBuildingMaterial, {
      stoneColor: 0xe6e0d2, trimColor: 0xf6f3ea, windowGlassColor: 0x1c2630,
      windowWidth: 3.4, floorHeight: 3.0, litProbability: 0.42, warmth: 0.9, seed: 5.3
    }],
    // 6: Pale yellow & sage siding
    [createPreWarBuildingMaterial, {
      stoneColor: 0xd9c98e, trimColor: 0xf2eee0, windowGlassColor: 0x1c2630,
      windowWidth: 3.2, floorHeight: 3.0, litProbability: 0.42, warmth: 0.9, seed: 41.7
    }],
    // 7: Slate blue & grey siding
    [createPreWarBuildingMaterial, {
      stoneColor: 0x7d8c99, trimColor: 0xe9e6dc, windowGlassColor: 0x1a242e,
      windowWidth: 3.3, floorHeight: 3.0, litProbability: 0.42, warmth: 0.9, seed: 73.1
    }],
    // 8: The University's collegiate brick: deep red-brown with limestone trim, tall windows (Angell, the Union, the Law Quad's neighbours)
    [createPreWarBuildingMaterial, {
      stoneColor: 0x8a4632, trimColor: 0xd9ccb0, windowGlassColor: 0x141e28,
      windowWidth: 2.2, floorHeight: 4.2, litProbability: 0.62, warmth: 0.78, seed: 88.2
    }],
    // 9: Campus & civic limestone: pale stone with darker sills (Rackham, the Federal Building, City Hall's older neighbours)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xcfc6b0, trimColor: 0x8f8670, windowGlassColor: 0x18242e,
      windowWidth: 2.3, floorHeight: 4.4, litProbability: 0.5, warmth: 0.7, seed: 101.6
    }],
    // 10: Civic brick: the city's and schools' tan-orange brick with concrete bands
    [createPreWarBuildingMaterial, {
      stoneColor: 0xb27a52, trimColor: 0xbdb7a8, windowGlassColor: 0x16222c,
      windowWidth: 3.0, floorHeight: 3.8, litProbability: 0.48, warmth: 0.75, seed: 117.3
    }],
    // 11: Tan and cream common brick: downtown's 1900s commercial blocks and the 1960s-80s apartment slabs
    [createPreWarBuildingMaterial, {
      stoneColor: 0xc0a27a, trimColor: 0xe0d6c0, windowGlassColor: 0x18242e,
      lotFronts: true, windowWidth: 2.5, floorHeight: 3.6, litProbability: 0.5, warmth: 0.82, seed: 131.9
    }],
    // 12: Painted brick, white and pale gray, with dark trim: Main Street's Italianate fronts
    [createPreWarBuildingMaterial, {
      stoneColor: 0xe2ded4, trimColor: 0x45484b, windowGlassColor: 0x18222c,
      lotFronts: true, windowWidth: 1.9, floorHeight: 4.2, windowRatioX: 0.46, windowRatioY: 0.66, litProbability: 0.5, warmth: 0.85, seed: 149.2
    }],
    // 13: Dark brown and plum brick: the 1910s-20s blocks and newer infill
    [createPreWarBuildingMaterial, {
      stoneColor: 0x6b4536, trimColor: 0xcfc4ac, windowGlassColor: 0x141e28,
      lotFronts: true, windowWidth: 2.0, floorHeight: 3.9, windowRatioX: 0.46, windowRatioY: 0.62, litProbability: 0.52, warmth: 0.8, seed: 163.4
    }],
    // 14: Gray metal and fibre-cement panel with wide windows: the 2000s-20s towers downtown and by campus
    [createPreWarBuildingMaterial, {
      stoneColor: 0x6a6e71, trimColor: 0x9ca2a6, windowGlassColor: 0x1a2630,
      windowWidth: 3.4, floorHeight: 3.3, windowRatioX: 0.62, litProbability: 0.6, warmth: 0.7, seed: 177.7
    }],
    // 15: The shopping centres' and big boxes' pale split-face block and painted panel: blank walls, their glass at the
    // shopfronts and none above (Maple Village, Arborland, Westgate, the Plymouth and Packard strips)
    [createPreWarBuildingMaterial, {
      stoneColor: 0xcfc8b8, trimColor: 0x8a8478, windowGlassColor: 0x1a2630,
      windowWidth: 4.0, floorHeight: 5.0, windowRatioX: 0.0, windowRatioY: 0.0, litProbability: 0.3, warmth: 0.75, seed: 191.3
    }],
    // 16: The 1990s-2020s blocks downtown and by campus: red-brown face brick with wide modern windows, no 1900s lots
    // (W Madison's and N Ashley's apartments and hotels)
    [createPreWarBuildingMaterial, {
      stoneColor: 0x8c4c38, trimColor: 0xc9c4ba, windowGlassColor: 0x1a2630,
      windowWidth: 3.2, floorHeight: 3.3, windowRatioX: 0.6, windowRatioY: 0.62, litProbability: 0.55, warmth: 0.78, seed: 205.9
    }]
  );
  const materials = facades.map(([create, opts]) => create({ ...opts, footprintLocal: true }));
  const storeys = facades.map(([, opts]) => opts.floorHeight);

  const broadwayBillboards = [];

  // Times Square's billboard-facing walls look onto Broadway and 7th Avenue between 42nd and 47th St.
  const TS = (() => {
    const def = null; // Lamp: no Times Square in Ann Arbor
    const ave7 = ALL_AVENUES.find((a) => a.id === '7');
    if (!def || !ave7) return null;
    const [ax, az] = def.a;
    const [bx, bz] = def.b;
    return {
      zN: streetZ(47) - 6,
      zS: streetZ(42) + 6,
      x7: ave7.x,
      half7: ave7.width * 0.5 + 1,
      halfB: def.w * 0.5 + 1,
      xAt: (z) => ax + ((z - az) / (bz - az)) * (bx - ax)
    };
  })();
  const inBowtie = (x, z) => !!TS && z > TS.zN && z < TS.zS && (Math.abs(x - TS.xAt(z)) < TS.halfB || Math.abs(x - TS.x7) < TS.half7);

  // Keep authored landmarks clear of surveyed buildings and architectural details.
  // (Ann Arbor's landmarks are the city's own surveyed buildings, so none are reserved: the bowl of the Big House is
  // built by landmarks.js in its open field)
  const LANDMARK_RESERVE = [].map(([name, o]) => {
    const t = LANDMARK_SITES[name];
    if (!t) return null;
    return { height: Infinity, x: t.x, z: t.z, x0: t.x - t.w / 2 - 3, x1: t.x + t.w / 2 + 3, z0: t.z - t.d / 2 - 3, z1: t.z + t.d / 2 + 3, ...(o || {}) };
  }).filter(Boolean);
  // Keep the authored landmark models; the survey supplies the surrounding buildings.
  // (a landmark on the survey's own outline names the block it replaces, and its colliders keep off the rest)
  // (`replaces` is one block, or a list where one collider stands for several, as the stadium's wall)
  const replaced = new Set(landmarkColliders.flatMap((c) => c.replaces ?? []));
  // (and one it runs into, as the parking structure down Graffiti Alley, gives the block cut back to its own face; a
  // block that's replaced is left out before it's reshaped)
  const reshaped = new Map(landmarkColliders.filter((c) => c.reshapes).map((c) => [c.reshapes.from, c.reshapes.to]));
  // (only the few landmark colliders without keepsSurvey clear the blocks under them: tested alone, not all thousands)
  const clearers = landmarkColliders.filter((c) => !c.keepsSurvey);
  const surveyedBuildings = REAL_BUILDINGS.filter((b) => !replaced.has(b)
    && !GRANDSTANDS.some(([x, z]) => b.polygons.some((p) => polygonContains({ outer: p.outer, holes: [] }, x, z)))).map((b) => reshaped.get(b) || b).filter((b) => !LANDMARK_RESERVE.some((h) =>
    b.polygons.some((p) => polygonContains({ outer: p.outer, holes: [] }, h.x, h.z)))
    && !clearers.some((c) => b.minX < c.maxX && b.maxX > c.minX && b.minZ < c.maxZ && b.maxZ > c.minZ
      && b.polygons.some((p) => polygonBoxOverlaps(p, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2,
        (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2))));
  const landmarkReserves = [...LANDMARK_RESERVE, ...landmarkColliders.map((c) =>
    ({ x0: c.minX, x1: c.maxX, z0: c.minZ, z1: c.maxZ, height: c.maxY ?? Infinity }))];
  const hitR = (a, x0, x1, z0, z1) => a.x0 < x1 && a.x1 > x0 && a.z0 < z1 && a.z1 > z0;
  const buildingReserves = [];
  const reserveCells = new Map();
  function addReserve(r) {
    const index = buildingReserves.length;
    buildingReserves.push(r);
    for (let ix = Math.floor(r.x0 / 128); ix <= Math.floor(r.x1 / 128); ix++) {
      for (let iz = Math.floor(r.z0 / 128); iz <= Math.floor(r.z1 / 128); iz++) {
        const key = ix + ',' + iz;
        if (!reserveCells.has(key)) reserveCells.set(key, []);
        reserveCells.get(key).push(index);
      }
    }
  }
  for (const b of surveyedBuildings) addReserve({
    x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ, height: b.height + 0.22, polygons: b.polygons
  });
  function nearbyReserves(b, padding = 0) {
    const minX = b.minX - padding, maxX = b.maxX + padding;
    const minZ = b.minZ - padding, maxZ = b.maxZ + padding;
    const found = new Set();
    for (let ix = Math.floor(minX / 128); ix <= Math.floor(maxX / 128); ix++) {
      for (let iz = Math.floor(minZ / 128); iz <= Math.floor(maxZ / 128); iz++) {
        for (const index of reserveCells.get(ix + ',' + iz) || []) {
          if (hitR(buildingReserves[index], minX, maxX, minZ, maxZ)) found.add(index);
        }
      }
    }
    return Array.from(found, (index) => buildingReserves[index]);
  }
  function overlapsParkOrLandmark(minX, maxX, minZ, maxZ) {
    const cp = BIG_PARK_BOUNDS;
    if (maxX > cp.minX && minX < cp.maxX && maxZ > cp.minZ && minZ < cp.maxZ) return true;
    return LANDMARK_RESERVE.some((h) => hitR(h, minX, maxX, minZ, maxZ));
  }

  for (const r of landmarkReserves) {
    addReserve({ ...r, polygons: [{ outer: [
      { x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }
    ], holes: [] }] });
  }

  const surveyedBuckets = materials.map(() => []);
  const detailsToPlace = [];
  const houseRecords = [];
  const churches = [];
  // Lamp: a gas station's canopy the survey drew as a building is drawn as a canopy (gas-stations.js) instead
  const canopies = canopyFootprints(gasStations);
  for (const b of surveyedBuildings) {
    if (b.height < 10 && insideCanopy(canopies, b.cx, b.cz)) continue;
    const rand = mulberry32(Math.round(b.cx * 31 + b.cz * 17));
    const tone = rand();
    // Lamp: houses, garages and sheds are drawn as houses (houses.js): siding, windows, a door, a pitched roof.
    // Use actual polygon footprint area (not axis-aligned bounding box, which inflates rotated buildings by up to 2x).
    const span = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    let polyArea = 0;
    let minGround = groundHeight(b.cx, b.cz), maxGround = minGround;
    for (const polygon of b.polygons) {
      const ring = polygon.outer;
      let a = 0;
      for (let i = 0, n = ring.length; i < n; i++) {
        const p = ring[i], q = ring[(i + 1) % n];
        a += p.x * q.z - q.x * p.z;
        const hp = groundHeight(p.x, p.z), hm = groundHeight((p.x + q.x) * 0.5, (p.z + q.z) * 0.5);
        if (hp < minGround) minGround = hp;
        if (hp > maxGround) maxGround = hp;
        if (hm < minGround) minGround = hm;
        if (hm > maxGround) maxGround = hm;
      }
      polyArea += Math.abs(a) * 0.5;
    }
    if (!polyArea) polyArea = span;
    // Lamp: a sizeable building on a religious parcel is drawn as a church (churches.js): gable, bell tower, spire
    const plan = (b.kind || 1) !== 5 && polyArea > 150 && b.height >= 7 && b.height < 40
      && landUseAt(b.cx, b.cz) === LAND_USE.RELIGIOUS ? churchPlan(b) : null;
    if (plan) {
      const ground = maxGround + LAWN_Y;
      b.ground = ground;
      b.minGround = minGround;
      const church = { ...b, tone, ground, minGround, plan, facade: shopLook(b) & 7 };
      churches.push(church);
      const detail = { cx: b.cx, cz: b.cz, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, cornices: [],
        waterTowers: [], hvacUnits: [], fireEscapes: [], awnings: [], scaffoldSheds: [], footprints: [] };
      // its colliders as it's drawn (churches.js churchLayout): a gabled box is its oriented box, the slopes its
      // roof; an outline is itself; and the tower, up to the spire's point, a box of its own
      const lay = churchLayout(church);
      const { ax, az } = plan;
      const box = (cx, cz, hx, hz, minY, maxY, roofs) => {
        const ex = Math.abs(ax) * hx + Math.abs(az) * hz, ez = Math.abs(az) * hx + Math.abs(ax) * hz;
        colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY, maxY,
          obb: { cx, cz, hx, hz, cs: ax, sn: -az }, roofs });
      };
      if (lay.rect) {
        box(plan.cx, plan.cz, lay.hl, lay.hw, minGround, lay.ridge, [{ cx: plan.cx, cz: plan.cz, ax, az, bx: -az, bz: ax,
          ha: lay.hl, hb: lay.hw, top: lay.eave, rh: lay.ridge - lay.eave, type: 'gable' }]);
      }
      for (const polygon of b.polygons) {
        const xs = polygon.outer.map((p) => p.x), zs = polygon.outer.map((p) => p.z);
        if (!lay.rect) {
          colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
            minY: minGround, maxY: ground + b.height + 0.22, polygon });
        }
        detail.footprints.push({ h: b.height + 0.22, pts: polygon.outer, holes: polygon.holes });
      }
      if (lay.hasTower) {
        const h2 = lay.tw / 2, tx = plan.cx + ax * lay.towerU, tz = plan.cz + az * lay.towerU;
        // (the spire's slopes a pyramid over the shaft's top)
        box(tx, tz, h2, h2, minGround, lay.towerTop + 0.35 + lay.spireH, [{ cx: tx, cz: tz, ax, az, bx: -az, bz: ax,
          ha: h2, hb: h2, top: lay.towerTop + 0.35, rh: lay.spireH, type: 'hip' }]);
      }
      quadtree.insert(detail);
      allBlocks.push(detail);
      continue;
    }
    const smallShed = polyArea < 70 && b.height < 6;
    // (Lamp: and out past the town that stood by 1950, a low residential building up to 3,000 m² is a townhouse row or
    // garden apartments, drawn as houses are, with their pitched roofs, siding and garages, not a downtown block)
    const gardenApts = (b.kind || 1) === 1 && b.height < 14 && polyArea < 3000 && Math.hypot(b.cx, b.cz) > 2300;
    // (and a small shop or office building on a house lot out of the downtown core and central campus is a house
    // turned to business, a dentist's or an insurance office: drawn as one, not as a little downtown block)
    const convertedHouse = ![1, 5].includes(b.kind || 1) && polyArea >= 60 && polyArea < 250 && b.height < 10
      && !inCore(b.cx, b.cz) && [LAND_USE.SINGLE_FAMILY, LAND_USE.TWO_FAMILY, LAND_USE.APARTMENTS].includes(landUseAt(b.cx, b.cz));
    if (((b.kind || 1) === 1 && b.height < 14 && polyArea < 900) || gardenApts || smallShed || convertedHouse) {
      const ground = maxGround + LAWN_Y;
      b.ground = ground;
      b.minGround = minGround;
      const record = { ...b, tone, ground, minGround, garage: smallShed && (b.kind || 1) !== 1 };
      houseRecords.push(record);
      for (const polygon of b.polygons) {
        const xs = polygon.outer.map((p) => p.x), zs = polygon.outer.map((p) => p.z);
        const collider = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
          minY: minGround, maxY: ground + b.height + 0.22, polygon };
        record.collider ||= collider; // houses.js gives it its roofs' shapes, for the helicopter to land on
        colliders.push(collider);
      }
      allBlocks.push({ cx: b.cx, cz: b.cz, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, cornices: [],
        waterTowers: [], hvacUnits: [], fireEscapes: [], awnings: [], scaffoldSheds: [],
        footprints: b.polygons.map((p) => ({ h: b.height + 0.22, pts: p.outer, holes: p.holes })) });
      continue;
    }
    // Lamp: Ann Arbor's survey says what each building is (1 house or apartments, 2 shops, 3 offices, 4 public) and
    // who owns it (5 the University, 6 the city, county, schools or federal government), not when it was built
    const kind = b.kind || 1;
    // (Ann Arbor's walls are red brick far less than half the time: tan, cream and painted brick, dark brick, and the
    // gray panel of the newer towers share them)
    const brickOf = (t) => (t < 0.36 ? 1 : t < 0.54 ? 0 : t < 0.7 ? 11 : t < 0.84 ? 12 : 13);
    let mat = kind === 1 ? (b.height < 13 ? (tone < 0.18 ? 1 : 5 + Math.floor(rand() * 3))
      : b.height > 28 ? (tone < 0.45 ? 14 : tone < 0.7 ? 11 : 13) : (tone < 0.3 ? 1 : tone < 0.5 ? 11 : tone < 0.7 ? 13 : tone < 0.85 ? 14 : 0))
      // (Lamp: a taller shop or office block is glass now and then, more often brick, limestone or panel: N Ashley's
      // and Liberty's mid-rises are brick over a limestone base, and the town's blue curtain-wall towers are few)
      : kind === 2 ? (b.height < 16 ? brickOf(tone) : (tone < 0.3 ? 14 : tone < 0.55 ? brickOf(tone * 0.84) : tone < 0.8 ? 0 : 3))
        : kind === 3 ? (b.height < 14 ? (tone < 0.5 ? 1 : 3) : (tone < 0.25 ? 2 : tone < 0.45 ? 14 : tone < 0.6 ? 3 : tone < 0.8 ? 1 : 0))
          : kind === 5 ? (collegiateCore(b.cx, b.cz) ? (b.height > 30 && tone < 0.45 ? 2 : tone < 0.62 ? 8 : 9)
            : b.height > 25 ? (tone < 0.35 ? 2 : tone < 0.6 ? 14 : 10)
              : (tone < 0.55 ? 10 : tone < 0.8 ? 14 : 8))
            : kind === 6 ? (tone < 0.6 ? 10 : 9)
              : (b.height < 40 ? (tone < 0.55 ? 1 : 0) : (tone < 0.5 ? 0 : 3));
    // Lamp: the city's land use and historic districts: old brick and stone in a historic district (the University's
    // own buildings keep theirs), stone or brick for churches, plain tan brick for industry and research
    const use = landUseAt(b.cx, b.cz);
    if (kind !== 5 && historicDistrictAt(b.cx, b.cz) && b.height < 30) mat = brickOf(tone);
    else if (use === LAND_USE.RELIGIOUS && kind !== 5) mat = tone < 0.5 ? 0 : 1;
    else if (use === LAND_USE.INDUSTRY && kind !== 5 && b.height < 20) mat = tone < 0.7 ? 10 : 3;
    // Lamp: a smaller shop or office building out past the town that stood by 1950 (Packard, Plymouth, Stadium,
    // Washtenaw, the office parks) is a postwar one: tan-orange brick with wide windows or gray panel,
    // not downtown's narrow 1900s lot fronts (materials 0, 1, 11-13)
    else if ((kind === 2 || kind === 3) && b.height < 14 && !inCore(b.cx, b.cz) && Math.hypot(b.cx, b.cz) > 2000
      && [0, 1, 11, 12, 13].includes(mat)) mat = tone < 0.72 ? 10 : 14;
    // Lamp: a big low shop building out past downtown and the campus is a shopping centre's or a big box's, not a
    // downtown block: one tall storey of pale block with its glass at the shopfronts (15)
    if ((kind === 2 || use === LAND_USE.SHOPS) && polyArea > 1500 && b.height < 17 && !inCore(b.cx, b.cz)) mat = 15;
    // Lamp: the building's first-floor doors and windows sit above the uphill grade (`maxGround`), while its foundation
    // base extends below `minGround` so hillside walls never sink doors underground or float in mid-air
    const ground = maxGround + 0.08;
    b.ground = ground;
    b.minGround = minGround;
    // Lamp: storefronts (tsl-materials.js) where the survey or the city says shops: a shop building, or a shop or
    // mixed-use parcel, not the University's own or a house-style one
    const storefronts = b.height >= 6 && kind !== 5 && (mat < 5 || mat > 7)
      && (kind === 2 || use === LAND_USE.SHOPS || use === LAND_USE.MIXED_USE);
    // Lamp: a shop building's facade, display windows and shopfront color as its street photo shows them
    // (data/building-looks.json): red brick, buff brick and stone, painted (kept), glass and metal. The facade is any
    // photographed building's, shops or not (E Huron's glass and metal by Fifth was tan brick), the
    // University's in their own materials; the display windows and colors are only a storefront's
    const look = shopLook(b);
    // (the University's own as their photos show them too, in its own materials: collegiate red-brown brick, the civic
    // tan brick, limestone, or curtain-wall glass; data/building-looks.json has 62 of them)
    if (look & 7) mat = kind === 5 ? [mat, 8, 10, 9, mat, 2][look & 7] : [mat, 1, 0, 0, mat, 3][look & 7];
    // (Lamp: and where no photo says, the assessor's year: a building from 1950 on is no 1900s front of narrow lots,
    // outside the historic districts: 1950 to 1989 the postwar tan-orange brick with wide windows, from 1990 red-brown
    // face brick with wide windows (16) or gray panel; W Madison's 2010s apartments were downtown's old brick lots)
    const builtIn = (look >> 11 & 127) ? (look >> 11 & 127) * 2 + 1800 : 0;
    if (!(look & 7) && builtIn >= 1950 && [0, 1, 11, 12, 13].includes(mat) && !historicDistrictAt(b.cx, b.cz)) {
      mat = builtIn < 1990 ? 10 : tone < 0.7 ? 16 : 14;
    }
    const record = { ...b, tone, ground, minGround, storefronts, shopLook: storefronts ? look : 0 };
    surveyedBuckets[mat].push(record);
    const detail = {
      cx: b.cx, cz: b.cz, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
      cornices: [], waterTowers: [], hvacUnits: [], fireEscapes: [], awnings: [], scaffoldSheds: [], footprints: []
    };
    const top = b.height + 0.22;
    for (const polygon of b.polygons) {
      const xs = polygon.outer.map((p) => p.x), zs = polygon.outer.map((p) => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      colliders.push({ minX, maxX, minZ, maxZ, minY: minGround, maxY: ground + top, polygon });
      detail.footprints.push({ h: top, pts: polygon.outer, holes: polygon.holes });
    }
    // (no fire escapes: the survey gives no building's year to tell a pre-war walk-up by, so none was ever placed)
    if (mat < 5 || mat > 7) detailsToPlace.push({ b: record, detail, masonry: mat < 2 || mat > 7, rand });
    else quadtree.insert(detail); // houses: no storefront awnings or rooftop plant
    allBlocks.push(detail);
  }
  // Reserve every fire escape before placing storefronts on neighbouring buildings.
  for (const { b, detail, masonry, rand } of detailsToPlace) {
    const neighbours = nearbyReserves(b, 6);
    for (const reserve of addBuildingDetails(b, detail, { masonry, rand, neighbours })) addReserve(reserve);
    // Lamp: details were placed from street level (y = 0); lift them onto the building's ground, sheds onto the
    // sidewalk's where they stand
    for (const list of [detail.cornices, detail.waterTowers, detail.hvacUnits, detail.fireEscapes, detail.awnings]) {
      for (const item of list) item.y += b.ground;
    }
    for (const s of detail.scaffoldSheds) s.y += groundHeight(s.x, s.z);
    quadtree.insert(detail);
  }
  // (the house-colored blocks left here, materials 5..7, are the big low apartment buildings over 900 m²: houses.js
  // draws every smaller one with its pitched roof, so these keep flat roofs at the survey's height)
  // Lamp: on a phone, or a Mac without much memory (device-tier.js), only the houses near the player are built
  if (houseRecords.length) {
    group.add(TIER.stream
      ? streamHouses(houseRecords, addresses, { radius: TIER.stream * (TIER.farCut < 1 ? 0.8 : 1), ...groundStreamCenter(), farCut: TIER.farCut })
      : buildHouses(houseRecords, addresses));
  }
  if (churches.length) { group.add(buildChurches(churches)); log(`[churches] ${churches.length}`); }
  if (canopies.length || (gasStations && gasStations.canopies)) {
    const gas = buildGasStations(gasStations);
    group.add(gas.group);
    colliders.push(...gas.colliders);
  }
  // Lamp: as the shop walls are built, each named business takes its bays (shop-types.js)
  // A building that isn't one of shopfronts (a one-storey shop or strip mall, an office block) still gets one on a
  // wall a named business's sign hangs on (`signFronts`): not the University's or the city's, nor a house-colored block
  beginShopBays();
  setShopOutlines(colliders);
  setShopAwnings(allBlocks.flatMap((d) => d.awnings.filter((a) => a.canopy)));
  surveyedBuckets.forEach((items, i) => {
    if (!items.length) return;
    for (const r of items) r.signFronts = !r.storefronts && r.kind !== 5 && r.kind !== 6 && (i < 5 || i > 7) && r.height >= 3.1;
    for (const r of items) r.facade = i; // (its look, for the far city's block: far-city.js)
    group.add(createBuildingFootprints(materials[i], items, i < 2 || i >= 5 ? b => nearbyReserves(b, 2) : undefined));
  });
  {
    const s = shopBayStats();
    log(`[shop bays] ${s.signs} named businesses over their own bays, ${s.bays} bays theirs on ${s.rows} walls`);
  }

  // Narrow empty lots become sitting areas with trees.
  {
    const plazas = pavedPlazaRects || [];
    const sites = parkTreeSites;
    const hit = (r, x0, x1, z0, z1) => r.minX < x1 && r.maxX > x0 && r.minZ < z1 && r.maxZ > z0;
    for (const s of (sites && sidewalkBlocks) || []) {
      const x0 = s.cx - s.w / 2;
      const x1 = s.cx + s.w / 2;
      const z0 = s.cz - s.d / 2;
      const z1 = s.cz + s.d / 2;
      if (s.cover || (s.block && (s.block.median || s.block.park > 0.6))) continue;
      const narrow = Math.min(s.w, s.d);
      if (narrow < 8 || narrow > 26 || Math.max(s.w, s.d) < 20) continue;
      if (allBlocks.some((b) => hit(b, x0 + 2, x1 - 2, z0 + 2, z1 - 2)) || plazas.some((r) => hit(r, x0, x1, z0, z1))) continue;
      if (overlapsParkOrLandmark(x0, x1, z0, z1)) continue;
      const alongX = s.w > s.d;
      const len = alongX ? s.w : s.d;
      const n = Math.max(1, Math.floor((len - 6) / 8));
      const lanes = narrow >= 15 ? [-narrow / 4, narrow / 4] : [0];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n - 0.5;
        for (const [j, o] of lanes.entries()) {
          const u = (len - 6) * t + (j % 2) * 2;
          const x = alongX ? s.cx + u : s.cx + o;
          const z = alongX ? s.cz + o : s.cz + u;
          const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
          sites.push({ x, y: 0.22, z, scale: 0.8 + h * 0.3, species: h < 0.55 ? 1 : 0, tier: 1 });
        }
      }
    }
  }

  // Times Square: tiers of billboards up every street wall that looks onto the bowtie (podiums and the tower
  //     shafts set back above them alike), from above the storefront marquees to ~62 m, split into screens up to
  //     ~26 m wide (the odd screen left out)
  if (TS) {
    const hash = (a, b) => Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;
    function addBillboards(cx, cz, nx, nz, length, base, top) {
      if (length < 8 || top - base < 8) return;
      const ax = -nz, az = nx;
      const seen = [0.2, 0.5, 0.8].some((t) => [6, 12, 20, 30].some((d) => {
        const u = (t - 0.5) * length;
        return inBowtie(cx + nx * d + ax * u, cz + nz * d + az * u);
      }));
      if (!seen) return;
      const n = Math.max(1, Math.ceil((length - 2) / 26));
      const pw = (length - 2 - (n - 1) * 1.2) / n;
      for (let i = 0; i < n; i++) {
        const u = -length * 0.5 + 1 + i * (pw + 1.2) + pw * 0.5;
        let y = base;
        for (let tier = 0; y < top - 6; tier++) {
          const h = Math.min(top - y, 8 + 8 * hash(u + tier, cx));
          if (h < 6) break;
          if (hash(cz + tier, u) > 0.12) {
            broadwayBillboards.push({
              x: cx + nx * 0.35 + ax * u,
              y: y + h * 0.5,
              z: cz + nz * 0.35 + az * u,
              w: pw,
              h,
              rotY: Math.atan2(nx, nz),
              variant: Math.floor(hash(cx + i, cz + tier) * 6)
            });
          }
          y += h + 1.2;
        }
      }
    }
    for (const b of surveyedBuildings) {
      if (b.maxZ < TS.zN - 40 || b.minZ > TS.zS + 40 || Math.abs(b.cx - TS.x7) > 280) continue;
      for (const { outer } of b.polygons) {
        for (let i = 0; i < outer.length; i++) {
          const a = outer[i], c = outer[(i + 1) % outer.length];
          const dx = c.x - a.x, dz = c.z - a.z, length = Math.hypot(dx, dz);
          if (length < 8) continue;
          addBillboards((a.x + c.x) / 2, (a.z + c.z) / 2, dz / length, -dx / length,
            length, b.ground + 7.5, b.ground + Math.min(b.height + 0.22 - 2, 62)); // Lamp: from the building's ground
        }
      }
    }
  }

  // ============================================================================
  // STATIC BILLBOARDS
  // ============================================================================
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();

  // Billboards: one merged mesh per poster theme
  {
    const byVariant = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const bb of broadwayBillboards) {
      const g = new THREE.PlaneGeometry(bb.w, bb.h);
      g.applyMatrix4(m.compose(new THREE.Vector3(bb.x, bb.y, bb.z), q.setFromAxisAngle(up, bb.rotY), new THREE.Vector3(1, 1, 1)));
      if (!byVariant.has(bb.variant)) byVariant.set(bb.variant, []);
      byVariant.get(bb.variant).push(g);
    }
    for (const [variant, geos] of byVariant) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), createBillboardMaterial(variant));
      mesh.name = `TimesSquareBillboards_${variant}`;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }

  // ============================================================================
  // STREAMED ARCHITECTURAL DETAILS
  // ============================================================================
  const MAX_CORNICES = 7000;
  const MAX_WATER_TOWERS = 1400;
  const MAX_HVAC = 1600;
  const MAX_AWNINGS = 1800;
  const MAX_SHEDS = 300;

  // 1. Projecting horizontal stone cornices & parapet ledges
  const corniceMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8bca6, roughness: 0.78, metalness: 0.08 });
  const corniceInst = new THREE.InstancedMesh(unitBox, corniceMat, MAX_CORNICES);
  corniceInst.castShadow = true;
  corniceInst.receiveShadow = true;
  corniceInst.frustumCulled = false;
  group.add(corniceInst);

  // 2. 3-part rooftop cedar water towers with steel hoop bands & open 4-leg steel trestle
  const woodMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.78 });
  woodMat.colorNode = Fn(() => {
    const u = uv();
    // Preserve the average width of seams and hoops when they become smaller than a pixel.
    const staveCoord = u.x.mul(28.0);
    const staveSeam = filteredPulse(fract(staveCoord), 0.46, 0.54, fwidth(staveCoord));
    const staveTone = mix(color(0x8e6343), color(0x5c3e26), staveSeam.mul(0.55));
    const bandCoord = u.y.mul(5.0);
    const isHoop = filteredPulse(fract(bandCoord), 0.42, 0.58, fwidth(bandCoord));
    return mix(staveTone, color(0x1f2328), isHoop);
  })();
  const roofCapMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b4045, roughness: 0.65, metalness: 0.3 });
  const legMat = new THREE.MeshStandardNodeMaterial({ color: 0x262b30, roughness: 0.45, metalness: 0.68 });
  const barrelGeo = new THREE.CylinderGeometry(1.65, 1.75, 3.6, 12);
  const coneGeo = new THREE.ConeGeometry(1.9, 1.5, 12);

  // Open 4-leg structural steel trestle with cross-bracing and top chime deck
  const trestleParts = [];
  const legPostGeo = new THREE.BoxGeometry(0.24, 2.75, 0.24);
  const legPositions = [
    [-1.05, 0, -1.05],
    [1.05, 0, -1.05],
    [-1.05, 0, 1.05],
    [1.05, 0, 1.05],
  ];
  for (const [lx, ly, lz] of legPositions) {
    const g = legPostGeo.clone();
    g.rotateZ(lx > 0 ? 0.08 : -0.08);
    g.rotateX(lz > 0 ? -0.08 : 0.08);
    g.translate(lx, ly, lz);
    trestleParts.push(g);
  }
  const deckRingGeo = new THREE.CylinderGeometry(1.88, 1.88, 0.22, 12);
  deckRingGeo.translate(0, 1.22, 0);
  trestleParts.push(deckRingGeo);
  const braceX1 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX1.translate(0, 0.2, -1.02);
  trestleParts.push(braceX1);
  const braceX2 = new THREE.BoxGeometry(2.15, 0.14, 0.14);
  braceX2.translate(0, 0.2, 1.02);
  trestleParts.push(braceX2);
  const braceZ1 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ1.translate(-1.02, -0.45, 0);
  trestleParts.push(braceZ1);
  const braceZ2 = new THREE.BoxGeometry(0.14, 0.14, 2.15);
  braceZ2.translate(1.02, -0.45, 0);
  trestleParts.push(braceZ2);
  const riserPipe = new THREE.CylinderGeometry(0.24, 0.24, 2.6, 8);
  trestleParts.push(riserPipe);
  const legsGeo = mergeGeometries(trestleParts, false);

  const barrelInst = new THREE.InstancedMesh(barrelGeo, woodMat, MAX_WATER_TOWERS);
  const coneInst = new THREE.InstancedMesh(coneGeo, roofCapMat, MAX_WATER_TOWERS);
  const legsInst = new THREE.InstancedMesh(legsGeo, legMat, MAX_WATER_TOWERS);
  barrelInst.castShadow = barrelInst.receiveShadow = true;
  coneInst.castShadow = coneInst.receiveShadow = true;
  legsInst.castShadow = legsInst.receiveShadow = true;
  barrelInst.frustumCulled = coneInst.frustumCulled = legsInst.frustumCulled = false;
  group.add(legsInst, barrelInst, coneInst);

  // 3. Rooftop mechanical penthouses & HVAC chillers with top exhaust fans & side louvers
  const hvacMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.52, metalness: 0.45 });
  hvacMat.colorNode = Fn(() => {
    const u = uv();
    const isTop = step(0.7, normalWorldGeometry.y);
    const fan1 = length(u.sub(vec2(0.3, 0.5)));
    const fan2 = length(u.sub(vec2(0.7, 0.5)));
    const fanDist = min(fan1, fan2);
    const inFanWell = smoothstep(0.19, 0.17, fanDist);
    // Average subpixel slats and fan rings instead of letting them shimmer at a distance.
    const fanCoord = fanDist.mul(16.0);
    const fanRing = filteredPulse(fract(fanCoord), 0.4835, 0.5165, fwidth(fanCoord)).mul(inFanWell);
    const topCol = mix(color(0x889098), color(0x1b2026), inFanWell.mul(0.82).sub(fanRing.mul(0.45)));

    const inLouverBox = step(0.12, u.x).mul(step(u.x, 0.88)).mul(step(0.18, u.y)).mul(step(u.y, 0.82));
    const slatCoord = u.y.mul(14.0);
    const louverSlat = filteredPulse(fract(slatCoord), 0.45, 1.0, fwidth(slatCoord)).mul(inLouverBox);
    const panelSeam = smoothstep(0.03, 0.0, abs(fract(u.x.mul(3.0)).sub(0.5)));
    const sideCol = mix(color(0x7c848c), color(0x282e36), max(louverSlat.mul(0.72), panelSeam.mul(0.35)));
    return mix(sideCol, topCol, isTop);
  })();
  const hvacInst = new THREE.InstancedMesh(unitBox, hvacMat, MAX_HVAC);
  hvacInst.castShadow = hvacInst.receiveShadow = true;
  hvacInst.frustumCulled = false;
  group.add(hvacInst);

  // 5. Ground-floor retail canvas awnings & illuminated storefront fascia signs
  const awningMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.65 });
  const awningPalette = [
    new THREE.Color(0x9e222e),
    new THREE.Color(0x1f593b),
    new THREE.Color(0x213d68),
    new THREE.Color(0xd9912b),
    new THREE.Color(0x2d2d32)
  ];
  const awningInst = new THREE.InstancedMesh(unitBox, awningMat, MAX_AWNINGS);
  awningInst.castShadow = awningInst.receiveShadow = true;
  awningInst.frustumCulled = false;
  // Pre-initialize instanceColor buffer so dynamic updates work cleanly
  for (let i = 0; i < MAX_AWNINGS; i++) {
    awningInst.setColorAt(i, awningPalette[i % awningPalette.length]);
  }
  group.add(awningInst);

  // 6. Sidewalk construction scaffolding sheds
  const shedMat = new THREE.MeshStandardNodeMaterial({ color: 0x214f37, roughness: 0.6, metalness: 0.25 });
  const shedInst = new THREE.InstancedMesh(unitBox, shedMat, MAX_SHEDS);
  shedInst.castShadow = shedInst.receiveShadow = true;
  shedInst.frustumCulled = false;
  group.add(shedInst);
  // its posts, one at each corner, down to the sidewalk (the deck isn't left hanging in the air)
  const shedPostInst = new THREE.InstancedMesh(unitBox, shedMat, MAX_SHEDS * 4);
  shedPostInst.castShadow = shedPostInst.receiveShadow = true;
  shedPostInst.frustumCulled = false;
  group.add(shedPostInst);

  // 7. (no storefront spotlights: Ann Arbor's awnings come from photos and get none; the empty group stays for main.js,
  //    which updates its matrices with the other moving parts)
  const storeLightGroup = new THREE.Group();
  storeLightGroup.name = 'StoreClusteredLights';
  scene.add(storeLightGroup);

  // ============================================================================
  // STREAMING AROUND THE PLAYER / CAMERA
  // ============================================================================
  let lastStreamX = Infinity;
  let lastStreamZ = Infinity;
  const STREAM_RADIUS = 560; // High-detail architectural radius around player in meters

  // Streaming rewrites only the active prefix; unused pool capacity need not cross the GPU queue.
  function flagRange(attribute, count) {
    if (count === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  // (focus2X, focus2Z: the second player's, in split screen, whose half shows the details round them too)
  let lastStream2X = NaN;
  let lastStream2Z = NaN;
  function update(focusX, focusZ, force = false, focus2X = NaN, focus2Z = NaN) {
    const two = Number.isFinite(focus2X) && Number.isFinite(focus2Z);
    const dx = focusX - lastStreamX;
    const dz = focusZ - lastStreamZ;
    const moved2 = two ? !((focus2X - lastStream2X) ** 2 + (focus2Z - lastStream2Z) ** 2 < 324) : Number.isFinite(lastStream2X);
    if (!force && (dx * dx + dz * dz) < 324 && !moved2) {
      // Player moved less than 18m since last Quadtree stream update
      return;
    }
    lastStreamX = focusX;
    lastStreamZ = focusZ;
    lastStream2X = two ? focus2X : NaN;
    lastStream2Z = two ? focus2Z : NaN;

    const nearbyBlocks = quadtree.queryRange(focusX, focusZ, STREAM_RADIUS);
    if (two) {
      const seen = new Set(nearbyBlocks);
      for (const blk of quadtree.queryRange(focus2X, focus2Z, STREAM_RADIUS)) if (!seen.has(blk)) nearbyBlocks.push(blk);
    }
    // Sort closest blocks first so if any pool hits capacity, closest blocks around the player (either player) always win
    const away = (blk) => {
      const d = (blk.cx - focusX) * (blk.cx - focusX) + (blk.cz - focusZ) * (blk.cz - focusZ);
      return two ? Math.min(d, (blk.cx - focus2X) * (blk.cx - focus2X) + (blk.cz - focus2Z) * (blk.cz - focus2Z)) : d;
    };
    nearbyBlocks.sort((a, b) => away(a) - away(b));

    let corniceCount = 0;
    let wtCount = 0;
    let hvacCount = 0;
    let awningCount = 0;
    let shedCount = 0;

    for (const blk of nearbyBlocks) {
      // 1. Stone cornices & setback ledges, hung just below their roof line (top 0.1h under it, so no two ledges or
      //    roofs share a plane) so roofs & terraces keep their own roofing instead of a stone lid
      for (let i = 0; i < blk.cornices.length && corniceCount < MAX_CORNICES; i++) {
        const c = blk.cornices[i];
        dummy.rotation.set(0, c.ry || 0, 0);
        dummy.position.set(c.x, c.y - c.h * 0.6, c.z);
        dummy.scale.set(c.w, c.h, c.d);
        dummy.updateMatrix();
        corniceInst.setMatrixAt(corniceCount++, dummy.matrix);
      }

      // 2. Rooftop cedar water towers
      for (let i = 0; i < blk.waterTowers.length && wtCount < MAX_WATER_TOWERS; i++) {
        const wt = blk.waterTowers[i];
        dummy.rotation.set(0, wt.ry || 0, 0);
        dummy.scale.set(1, 1, 1);

        dummy.position.set(wt.x, wt.y + 1.3, wt.z);
        dummy.updateMatrix();
        legsInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 4.2, wt.z);
        dummy.updateMatrix();
        barrelInst.setMatrixAt(wtCount, dummy.matrix);

        dummy.position.set(wt.x, wt.y + 6.7, wt.z);
        dummy.updateMatrix();
        coneInst.setMatrixAt(wtCount, dummy.matrix);
        wtCount++;
      }

      // 3. Rooftop HVAC & mechanical bulkheads
      for (let i = 0; i < blk.hvacUnits.length && hvacCount < MAX_HVAC; i++) {
        const u = blk.hvacUnits[i];
        dummy.rotation.set(0, u.ry || 0, 0);
        dummy.position.set(u.x, u.y + u.h * 0.5, u.z);
        dummy.scale.set(u.w, u.h, u.d);
        dummy.updateMatrix();
        hvacInst.setMatrixAt(hvacCount++, dummy.matrix);
      }

      // 5. Retail awnings & illuminated storefront fascia signs
      for (let i = 0; i < blk.awnings.length && awningCount < MAX_AWNINGS; i++) {
        const a = blk.awnings[i];
        dummy.rotation.set(0, a.ry || 0, a.tilt || 0);
        dummy.position.set(a.x, a.y, a.z);
        dummy.scale.set(a.w, a.h || 0.75, a.d);
        dummy.updateMatrix();
        dummy.rotation.z = 0;
        awningInst.setMatrixAt(awningCount, dummy.matrix);
        awningInst.setColorAt(awningCount, awningPalette[a.colorIdx % awningPalette.length]);

        // (a photo's awning, building-details.js: no made-up sign or spotlight, the shop's own sign is shop-signs.js's)
        awningCount++;
      }

      // 6. Sidewalk construction sheds
      for (let i = 0; i < blk.scaffoldSheds.length && shedCount < MAX_SHEDS; i++) {
        const s = blk.scaffoldSheds[i];
        dummy.rotation.set(0, s.ry || 0, 0);
        dummy.position.set(s.x, s.y + 3.6, s.z);
        dummy.scale.set(s.w, 0.85, s.d);
        dummy.updateMatrix();
        shedInst.setMatrixAt(shedCount, dummy.matrix);
        // the deck's underside is at s.y + 3.175: a 0.12 m post at each corner, set in from its edges
        const cs = Math.cos(s.ry || 0), sn = Math.sin(s.ry || 0);
        for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const ox = lx * (s.w / 2 - 0.12), oz = lz * (s.d / 2 - 0.12);
          dummy.position.set(s.x + ox * cs + oz * sn, s.y + 3.175 / 2, s.z - ox * sn + oz * cs);
          dummy.scale.set(0.12, 3.175, 0.12);
          dummy.updateMatrix();
          shedPostInst.setMatrixAt(shedCount * 4 + (lx < 0 ? (lz < 0 ? 0 : 3) : (lz < 0 ? 1 : 2)), dummy.matrix);
        }
        shedCount++;
      }
    }
    dummy.rotation.set(0, 0, 0);

    corniceInst.count = corniceCount;
    flagRange(corniceInst.instanceMatrix, corniceCount);

    legsInst.count = wtCount;
    barrelInst.count = wtCount;
    coneInst.count = wtCount;
    flagRange(legsInst.instanceMatrix, wtCount);
    flagRange(barrelInst.instanceMatrix, wtCount);
    flagRange(coneInst.instanceMatrix, wtCount);

    hvacInst.count = hvacCount;
    flagRange(hvacInst.instanceMatrix, hvacCount);

    awningInst.count = awningCount;
    flagRange(awningInst.instanceMatrix, awningCount);
    if (awningInst.instanceColor) flagRange(awningInst.instanceColor, awningCount);

    shedInst.count = shedCount;
    flagRange(shedInst.instanceMatrix, shedCount);
    shedPostInst.count = shedCount * 4;
    flagRange(shedPostInst.instanceMatrix, shedCount * 4);

    // (a pool with nothing in it this time is left out of the renderer's set-up altogether)
    for (const [inst, n] of [[corniceInst, corniceCount], [legsInst, wtCount], [barrelInst, wtCount], [coneInst, wtCount],
      [hvacInst, hvacCount], [awningInst, awningCount], [shedInst, shedCount], [shedPostInst, shedCount]]) inst.visible = n > 0;
  }

  // Initial Quadtree stream centered at Midtown 5th Ave & 42nd St
  update(0, 62, true);

  scene.add(group);
  return {
    group,
    colliders,
    allBlocks,
    update,
    // Lamp: what the far city (far-city.js) draws as plain blocks beyond the detailed buildings' reach
    farRecords: { surveyed: surveyedBuckets.flat(), houses: houseRecords, churches }
  };
}

export { buildCityBlocks };
