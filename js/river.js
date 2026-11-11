import * as THREE from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, attribute, color, float, mix, smoothstep, positionWorld, vertexColor, mx_noise_float, mx_worley_noise_float } from 'three/tsl';
import { nearDrop } from './cascades.js';
import { riverbedHeight, riverDepth, waterLevel, bridgeDecks } from './terrain.js';
import { overpassBuries } from './ground-core.js';

// The Huron River and its ponds sunk into their banks (terrain.js digs the bed from data/river.bin.gz): grassy banks
// sloping down through mud to the silt of the bed, the water lying flat at the river's level over it, and the bridges
// that cross it: the streets' concrete decks with sidewalks, parapets and piers, the railways' steel girders, and
// footbridges with railings, all with open water under them to paddle through.

// Every triangle split at its longest edge until `tooBig(a, b, c)` says it's small enough; positions only
function subdivide(geometry, tooBig) {
  const src = (geometry.index ? geometry.toNonIndexed() : geometry).attributes.position.array;
  const out = [];
  const split = (a, b, c, depth) => {
    if (depth > 22 || !tooBig(a, b, c)) { out.push(...a, ...b, ...c); return; }
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2;
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), m = Math.max(ab, bc, ca);
    const mid = (p, q) => [(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2];
    if (m === ab) { const k = mid(a, b); split(a, k, c, depth + 1); split(k, b, c, depth + 1); }
    else if (m === bc) { const k = mid(b, c); split(a, b, k, depth + 1); split(a, k, c, depth + 1); }
    else { const k = mid(c, a); split(a, b, k, depth + 1); split(k, b, c, depth + 1); }
  };
  for (let i = 0; i < src.length; i += 9) {
    split([src[i], 0, src[i + 2]], [src[i + 3], 0, src[i + 5]], [src[i + 6], 0, src[i + 8]], 0);
  }
  return out;
}

const longest = (a, b, c) => Math.max((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2, (b[0] - c[0]) ** 2 + (b[2] - c[2]) ** 2,
  (c[0] - a[0]) ** 2 + (c[2] - a[2]) ** 2);

function meshOf(pos, material, name, colors = null, wet = null, smooth = false) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (wet) g.setAttribute('wet', new THREE.Float32BufferAttribute(wet, 1));
  // (the banks shaded smooth across their triangles, not each one a flat facet: their corners joined first)
  if (smooth) g = mergeVertices(g, 0.01);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.name = name;
  m.receiveShadow = true;
  m.userData.cullDistance = 1500;
  return m;
}

// The banks' colors, and under the water a river bottom of dirt: dark brown silt, mottled with lighter and darker
// mud a few meters across, faint ripples the current leaves in it, and now and then a small stone sunk in it
function riverbedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.98 });
  // pushed back a hair in depth, so along the flat shallows, where the bank lies within centimetres of the water's
  // surface, the water wins cleanly instead of the two flickering through each other
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 2;
  mat.polygonOffsetUnits = 4;
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const wet = attribute('wet', 'float');
    const broad = mx_noise_float(p.mul(0.07)).mul(0.5).add(0.5);
    const mottle = mx_noise_float(p.mul(0.45).add(5.7)).mul(0.5).add(0.5);
    const grain = mx_noise_float(p.mul(3.1).add(11.2)).mul(0.5).add(0.5);
    // ripples: soft ridges a hand apart, bent by the noise so they never run ruler-straight
    const ripple = p.x.mul(0.9).add(p.y.mul(1.7)).add(mx_noise_float(p.mul(0.3)).mul(3.0)).sin().mul(0.5).add(0.5);
    const silt = mix(color(0x2e251a), color(0x4a3a27), broad);
    const dirt = mix(silt, mix(color(0x3a2e1f), color(0x5b4830), grain), smoothstep(0.35, 0.75, mottle).mul(0.55));
    const ridged = dirt.mul(ripple.mul(0.16).add(0.9));
    // a few pebbles: only the brightest of small cells, half buried
    const cells = mx_worley_noise_float(p.mul(1.9));
    const pick = mx_noise_float(p.mul(1.9).floor().add(3.1)).mul(0.5).add(0.5);
    const pebble = smoothstep(0.82, 0.9, pick).mul(float(1).sub(smoothstep(0.18, 0.3, cells)));
    const bed = mix(ridged, color(0x5e5648), pebble.mul(0.8));
    return mix(vertexColor(), bed, wet);
  })();
  return mat;
}

// The banks and bed, and the water over them. `geos` are the water's polygons, flat at y = 0
function buildRiver(group, geos, waterMat) {
  const river = new THREE.Group();
  river.name = 'HuronRiver';
  river.userData.terrain = 'set';
  // The banks: cut fine (3 m) where the ground slopes down to the bed, coarse (40 m) over the bed itself
  const bankPos = [], bankCol = [], bankWet = [];
  // the lawn's own green on the top, a deeper, shaggier green down the bank, a narrow strip of mud at the water
  // (already linear: three converts a hex color as it's set)
  const lawn = new THREE.Color(0x4f8a2e), grass = new THREE.Color(0x3f6b27);
  const mud = new THREE.Color(0x5a4c35);
  const silt = new THREE.Color(0x3a2e20), c = new THREE.Color();
  const sloped = (p) => { const d = riverDepth(p[0], p[2]); return d > 0.001 && d < 0.999; };
  // around the Argo Cascades (cascades.js), where the channel's levels step down beside land the map calls water
  const byCascades = (a, b, k) => Math.max(a[0], b[0], k[0]) > 140 && Math.min(a[0], b[0], k[0]) < 660
    && Math.max(a[2], b[2], k[2]) > -1300 && Math.min(a[2], b[2], k[2]) < -1030;
  const dry = (x, z) => { const lv = waterLevel(x, z); return lv === null || riverbedHeight(x, z) > lv + 0.1; };
  const waterPos = [];
  for (const geo of geos) {
    const bank = subdivide(geo, (a, b, k) => {
      const l = longest(a, b, k);
      if (l > 1600) return true;
      if (l > 9 && byCascades(a, b, k)) return true; // following the ground there, every 3 m
      if (l <= 144) return false;
      const m = [(a[0] + b[0] + k[0]) / 3, 0, (a[2] + b[2] + k[2]) / 3];
      return sloped(a) || sloped(b) || sloped(k) || sloped(m);
    });
    for (let i = 0; i < bank.length; i += 3) {
      const x = bank[i], z = bank[i + 2], y = riverbedHeight(x, z), lv = waterLevel(x, z) ?? y;
      // none on the land beside the cascades, which the ground there draws itself
      if (i % 9 === 0) {
        const a = [x, 0, z], b = [bank[i + 3], 0, bank[i + 5]], k = [bank[i + 6], 0, bank[i + 8]], high = (p) => {
          const g = riverbedHeight(p[0], p[2]), l = waterLevel(p[0], p[2]); return l === null || g > l + 0.6;
        };
        if (byCascades(a, b, k) && high(a) && high(b) && high(k)) { i += 6; continue; }
      }
      bankPos.push(x, y, z);
      const above = y - lv;
      if (above > 1.0) c.copy(grass).lerp(lawn, Math.min(1, (above - 1.0) / 0.4));
      else if (above > 0.25) c.copy(grass);
      else if (above > -0.3) c.copy(mud).lerp(grass, (above + 0.3) / 0.55);
      else c.copy(silt).lerp(mud, Math.max(0, (above + 1.2) / 0.9));
      bankCol.push(c.r, c.g, c.b);
      // how far under the water this point is, for the bed's dirt (riverbedMaterial)
      bankWet.push(Math.max(0, Math.min(1, (0.05 - above) / 0.35)));
    }
    // The water: flat at the river's level, cut every 20 m so it follows the level down the river
    // and every 60 cm over the Argo Cascades' drops, so each step shows (cascades.js)
    const water = subdivide(geo, (a, b, k) => {
      const l = longest(a, b, k);
      if (l > 400) return true;
      if (l <= 0.36) return false;
      const reach = Math.sqrt(l);
      // and every 3 m down the rest of the channel, so its pools lie at their own levels
      // (any piece reaching over it, not only those with a corner in it, so none lies across a step)
      if (l > 9 && byCascades(a, b, k)) return true;
      return [a, b, k, [(a[0] + b[0] + k[0]) / 3, 0, (a[2] + b[2] + k[2]) / 3]].some((p) => nearDrop(p[0], p[2], reach));
    });
    for (let i = 0; i < water.length; i += 9) {
      const a = [water[i], 0, water[i + 2]], b = [water[i + 3], 0, water[i + 5]], k = [water[i + 6], 0, water[i + 8]];
      // none over the land beside the cascades, where the water would show through the ground
      if (byCascades(a, b, k) && dry(a[0], a[2]) && dry(b[0], b[2]) && dry(k[0], k[2])) continue;
      for (const [x, , z] of [a, b, k]) waterPos.push(x, waterLevel(x, z) ?? riverbedHeight(x, z) + 0.05, z);
    }
  }
  if (bankPos.length) {
    // in tiles, so only what's in view is drawn
    const bankMat = riverbedMaterial();
    const TILE = 700, tiles = new Map();
    for (let i = 0; i < bankPos.length; i += 9) {
      const key = Math.floor((bankPos[i] + bankPos[i + 3] + bankPos[i + 6]) / 3 / TILE) * 1000
        + Math.floor((bankPos[i + 2] + bankPos[i + 5] + bankPos[i + 8]) / 3 / TILE);
      if (!tiles.has(key)) tiles.set(key, [[], [], []]);
      const [tp, tc, tw] = tiles.get(key);
      for (let k = 0; k < 9; k++) { tp.push(bankPos[i + k]); tc.push(bankCol[i + k]); }
      for (let k = 0; k < 3; k++) tw.push(bankWet[i / 3 + k]);
    }
    for (const [tp, tc, tw] of tiles.values()) river.add(meshOf(tp, bankMat, 'RiverBanks', tc, tw, true));
  }
  if (waterPos.length) {
    // in tiles, so only what's in view is drawn
    const TILE = 700, tiles = new Map();
    for (let i = 0; i < waterPos.length; i += 9) {
      const key = Math.floor((waterPos[i] + waterPos[i + 3] + waterPos[i + 6]) / 3 / TILE) * 1000
        + Math.floor((waterPos[i + 2] + waterPos[i + 5] + waterPos[i + 8]) / 3 / TILE);
      if (!tiles.has(key)) tiles.set(key, []);
      const t = tiles.get(key);
      for (let k = 0; k < 9; k++) t.push(waterPos[i + k]);
    }
    for (const t of tiles.values()) {
      const m = meshOf(t, waterMat, 'RiverWater');
      const n = m.geometry.attributes.normal;
      // flat, but for the cascades' drops, which keep their slope (the water's shading tilts with it)
      const ps = m.geometry.attributes.position;
      for (let i = 0; i < n.count; i++) if (!nearDrop(ps.getX(i), ps.getZ(i), 0)) n.setXYZ(i, 0, 1, 0);
      river.add(m);
    }
  }
  group.add(river);
  // (the bridges' parapets and railings, as colliders for the city's list: city-grid.js)
  return buildBridges(river);
}

// ---------------------------------------------------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------------------------------------------------

// The piers and abutments standing in the water, as footprints a boat is kept out of (pierPush): boxes turned along
// their bridge { x, z, ux, uz (along the bridge), across, along (half sizes) } and round columns { x, z, r }, in 32 m cells
const PIER_CELL = 32;
let piers = new Map();
function addPier(f) {
  const reach = f.r ?? Math.hypot(f.across, f.along);
  for (let i = Math.floor((f.x - reach) / PIER_CELL); i <= Math.floor((f.x + reach) / PIER_CELL); i++) {
    for (let j = Math.floor((f.z - reach) / PIER_CELL); j <= Math.floor((f.z + reach) / PIER_CELL); j++) {
      const k = i * 100003 + j;
      if (!piers.has(k)) piers.set(k, []);
      piers.get(k).push(f);
    }
  }
}

// How far to move something round, `radius` across, at (x, z) on the water to be clear of every bridge's pier: into
// `out` as { x, z }, answering whether it was in one
function pierPush(x, z, radius, out) {
  const list = piers.get(Math.floor(x / PIER_CELL) * 100003 + Math.floor(z / PIER_CELL));
  if (!list) return false;
  let hit = false;
  out.x = 0; out.z = 0;
  for (const f of list) {
    const dx = x + out.x - f.x, dz = z + out.z - f.z;
    if (f.r !== undefined) {
      const d = Math.hypot(dx, dz), need = f.r + radius;
      if (d >= need) continue;
      const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
      out.x += nx * (need - d); out.z += nz * (need - d);
      hit = true;
      continue;
    }
    // in the box's own frame: s along the bridge, o across it
    const s = dx * f.ux + dz * f.uz, o = dz * f.ux - dx * f.uz;
    const cs = Math.max(-f.along, Math.min(f.along, s)), co = Math.max(-f.across, Math.min(f.across, o));
    let ps = s - cs, po = o - co, d = Math.hypot(ps, po);
    if (d >= radius) continue;
    let push;
    if (d > 1e-6) push = radius - d;
    else {
      // the middle inside the box: out by its thin side, along the bridge, into the gap beside the pier
      ps = s >= 0 ? 1 : -1; po = 0; d = 1;
      push = f.along - Math.abs(s) + radius;
    }
    ps /= d; po /= d;
    out.x += (ps * f.ux - po * f.uz) * push;
    out.z += (ps * f.uz + po * f.ux) * push;
    hit = true;
  }
  return hit;
}

function buildBridges(group) {
  piers = new Map();
  const decks = bridgeDecks(), colliders = [];
  if (!decks.length) return colliders;
  const concrete = [], steel = [], wood = [], rail = [];
  const fb = { planks: [], beams: [], rails: [], concrete: [] }; // the footbridges' smooth parts (footbridge())
  // the streets' bridges' parts (streetBridge): concrete, the road's asphalt, steel railings and lamp posts, lamps' glass
  const street = { concrete, asphalt: [], steel, glass: [] };
  const overpasses = { n: 0, tris: 0 }; // (Lamp: the freeways' grade separations among them, for the log)

  for (const d of decks) {
    const P = d.points;
    // each point's way along the bridge and across it (to the left)
    const T = P.map((p, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      return [tx / l, tz / l];
    });
    const at = (i, o, y) => [P[i][0] - T[i][1] * o, P[i][3] + y, P[i][1] + T[i][0] * o];
    // a strip along the bridge between offset o0 at height y0 and offset o1 at y1 (both sides with `both`)
    const along = (out, o0, y0, o1, y1, both = true) => {
      for (const s of both ? [1, -1] : [1]) {
        for (let i = 0; i + 1 < P.length; i++) {
          const a = at(i, o0 * s, y0), b = at(i, o1 * s, y1), c2 = at(i + 1, o1 * s, y1), d2 = at(i + 1, o0 * s, y0);
          out.push(...a, ...b, ...c2, ...a, ...c2, ...d2);
        }
      }
    };
    // a box standing across the bridge at point i: `across` wide, `thick` along it, from y0 up to y1 (world heights)
    const pier = (out, i, across, thick, y0, y1) => {
      const g = new THREE.BoxGeometry(across, y1 - y0, thick).toNonIndexed();
      g.rotateY(Math.atan2(T[i][0], T[i][1]));
      g.translate(P[i][0], (y0 + y1) / 2, P[i][1]);
      out.push(...g.attributes.position.array);
    };
    const hw = d.half;
    const under = d.kind === 2 ? -0.45 : -1.1; // the deck's underside, under its top
    if (d.kind === 0) {
      // (a street's bridge is drawn whole by streetBridge, below)
    } else if (d.kind === 1) {
      along(concrete, -hw, -0.15, hw, -0.15, false);      // the deck under the ballast
      along(steel, hw, -0.15, hw, under);
      along(concrete, -hw, under, hw, under, false);
      // plate girders along both sides, standing above the deck
      along(steel, hw - 0.1, -0.15, hw - 0.1, 1.5);
      along(steel, hw - 0.1, 1.5, hw + 0.25, 1.5);
      along(steel, hw + 0.25, 1.5, hw + 0.25, under);
      // (Lamp) the girders' stiffeners every 2 m down their outer faces, and a flange along their foot, so they read
      // as riveted plate girders, not one dark slab
      along(steel, hw + 0.25, under, hw + 0.45, under);
      along(steel, hw + 0.25, 1.5, hw + 0.4, 1.5);
      for (let s = 1; s < d.length - 0.5; s += 2) {
        let i = 0;
        while (i + 2 < P.length && P[i + 1][2] < s) i++;
        const f = Math.max(0, Math.min(1, (s - P[i][2]) / ((P[i + 1][2] - P[i][2]) || 1)));
        const x = P[i][0] + (P[i + 1][0] - P[i][0]) * f, z = P[i][1] + (P[i + 1][1] - P[i][1]) * f, y = P[i][3] + (P[i + 1][3] - P[i][3]) * f;
        for (const sd of [1, -1]) {
          const g = new THREE.BoxGeometry(0.16, 1.5 - under, 0.1).toNonIndexed();
          g.translate(sd * (hw + 0.33), y + (1.5 + under) / 2, 0);
          g.rotateY(Math.atan2(T[i][0], T[i][1]));
          g.translate(x, 0, z);
          steel.push(...g.attributes.position.array);
        }
      }
    } else {
      footbridge(d, fb);
    }
    // The parapets, girders and railings along both edges are solid: thin boxes from the deck up about 1.1 m over it (a
    // car that leaves the deck can still clear them), in straight runs of up to 20 m
    const edge = d.kind === 0 ? [hw - 0.15, 0.15] : d.kind === 1 ? [hw + 0.075, 0.175] : [hw - 0.05, 0.08];
    for (let i = 0; i + 1 < P.length;) {
      let j = i + 1;
      while (j + 1 < P.length && P[j + 1][2] - P[i][2] < 20 && T[j + 1][0] * T[i][0] + T[j + 1][1] * T[i][1] > 0.999) j++;
      const ax = P[i][0], az = P[i][1], bx = P[j][0], bz = P[j][1], len = Math.hypot(bx - ax, bz - az);
      if (len > 0.1) {
        const ux = (bx - ax) / len, uz = (bz - az) / len, hx = len / 2, hz = edge[1];
        const low = Math.min(P[i][3], P[j][3]), high = Math.max(P[i][3], P[j][3]);
        for (const sd of [-1, 1]) {
          const cx = (ax + bx) / 2 - uz * edge[0] * sd, cz = (az + bz) / 2 + ux * edge[0] * sd;
          const ex = Math.abs(ux) * hx + Math.abs(uz) * hz, ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
          colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: low - 0.05, maxY: high + 1.1,
            obb: { cx, cz, hx, hz, cs: ux, sn: -uz }, thin: true });
        }
      }
      i = j;
    }
    if (d.kind === 0) {
      const before = concrete.length + street.asphalt.length + steel.length;
      streetBridge(d, P, T, street);
      if (d.overpass) { overpasses.n++; overpasses.tris += (concrete.length + street.asphalt.length + steel.length - before) / 9; }
      continue;
    }
    // a level deck over a road (terrain.js): a concrete abutment at each end, from the ground up to the deck
    if (d.level && d.kind === 1) {
      for (const i of [0, P.length - 1]) {
        const gnd = riverbedHeight(P[i][0], P[i][1]);
        if (P[i][3] + under - gnd > 0.6) pier(concrete, i, hw * 2 + 0.6, 2.4, gnd - 0.6, P[i][3] + 0.05);
      }
    }
    // Piers in the water every 25 m or so, and an abutment where each end meets the bank
    const wet = P.map((p) => riverDepth(p[0], p[1]) > 0.05);
    const first = wet.indexOf(true), last = wet.lastIndexOf(true);
    if (first < 0) continue;
    const span = P[last][2] - P[first][2];
    const piers = span > 34 ? Math.floor(span / 25) : 0;
    for (let k = 1; k <= piers; k++) {
      const s = P[first][2] + (span * k) / (piers + 1);
      let i = first;
      while (i < last && P[i][2] < s) i++;
      const top = P[i][3] + under, bed = riverbedHeight(P[i][0], P[i][1]) - 0.4;
      if (top - bed > 1 && !P[i][5]) {
        if (d.kind === 2) {
          footPier(fb, P[i], T[i], hw, bed, P[i][3] - 0.62);
          for (const s of [-1, 1]) addPier({ x: P[i][0] - T[i][1] * s * (hw - 0.4), z: P[i][1] + T[i][0] * s * (hw - 0.4), r: 0.26 });
        } else {
          pier(concrete, i, hw * 2 - 1.2, 1.3, bed, top);
          addPier({ x: P[i][0], z: P[i][1], ux: T[i][0], uz: T[i][1], across: hw - 0.6, along: 0.65 });
        }
      }
    }
    // (an abutment never stands in a road the bridge crosses: it moves out past the road, terrain.js roadsUnder)
    const clearOfRoad = (i, way) => { while (P[i]?.[5] && i + way >= 0 && i + way < P.length) i += way; return P[i]?.[5] ? -1 : i; };
    for (const i of [clearOfRoad(Math.max(0, first - 1), -1), clearOfRoad(Math.min(P.length - 1, last + 1), 1)]) {
      if (i < 0) continue;
      const top = P[i][3] + under, bed = riverbedHeight(P[i][0], P[i][1]) - 0.5;
      if (d.kind === 2) {
        if (P[i][3] - 0.62 - bed > 0.3) {
          footAbutment(fb, P[i], T[i], hw, bed, P[i][3] - 0.62);
          addPier({ x: P[i][0], z: P[i][1], ux: T[i][0], uz: T[i][1], across: hw + 0.45, along: 0.45 });
        }
      } else if (top - bed > 0.3) {
        pier(concrete, i, hw * 2 + 0.2, 1.6, bed, top + 0.05);
        addPier({ x: P[i][0], z: P[i][1], ux: T[i][0], uz: T[i][1], across: hw + 0.1, along: 0.8 });
      }
    }
  }

  if (overpasses.n) console.log(`[river] ${overpasses.n} freeway overpasses: ${Math.round(overpasses.tris / 1000)}k triangles in the bridges' merged meshes`);
  const mat = (color, rough, metal = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  // the lamps' glass lit softly (their light is the streetlights' own, lighting.js; this is only the glow of the globe)
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.3 });
  for (const [pos, m, name] of [[concrete, mat(0xb3ada3, 0.9), 'BridgeConcrete'], [steel, mat(0x4d5a5e, 0.6, 0.3), 'BridgeSteel'],
    [wood, mat(0x8a7356, 0.9), 'BridgeDecks'], [rail, mat(0x2f3436, 0.5, 0.4), 'BridgeRailings'],
    [street.asphalt, mat(0x3b3c3e, 0.92), 'BridgeRoad'], [street.glass, glass, 'BridgeLamps']]) {
    if (!pos.length) continue;
    // in 700 m squares as the banks are, so a square out of view or far off (meshOf's cullDistance) isn't drawn
    const tiles = new Map();
    for (let i = 0; i < pos.length; i += 9) {
      const key = Math.floor((pos[i] + pos[i + 3] + pos[i + 6]) / 3 / 700) * 1000 + Math.floor((pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3 / 700);
      if (!tiles.has(key)) tiles.set(key, []);
      const t = tiles.get(key);
      for (let k = 0; k < 9; k++) t.push(pos[i + k]);
    }
    for (const t of tiles.values()) {
      const mesh = meshOf(t, m, name);
      // (Lamp: a street bridge's road doesn't cast its own shadow, which banded it: the deck under it casts the bridge's)
      mesh.castShadow = name !== 'BridgeRoad';
      group.add(mesh);
    }
  }
  // merged in 250 m squares, so the fine parts (the railings above all) of the footbridges further off are hidden
  for (const [list, m, name, cull] of [[fb.planks, mat(0x94785a, 0.85), 'FootbridgePlanks', 1100], [fb.beams, mat(0x6e5640, 0.8), 'FootbridgeBeams', 600],
    [fb.rails, mat(0x33393c, 0.45, 0.6), 'FootbridgeRailings', 380], [fb.concrete, mat(0xa9a49b, 0.9), 'FootbridgeConcrete', 1500]]) {
    const cells = new Map();
    for (const g of list) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      const c = g.boundingSphere.center, key = Math.floor(c.x / 250) + ',' + Math.floor(c.z / 250);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(clean(g));
    }
    for (const parts of cells.values()) {
      const geo = mergeGeometries(parts);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, m);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.cullDistance = cull;
      group.add(mesh);
    }
  }
  return colliders;
}

// A street's bridge (Lamp), as terrain.js shapes its deck (streetDeck): a concrete deck a metre deep with its road, curbs,
// sidewalks, parapets and a steel rail along them, standing over open air wherever there's room under it (the water, a
// road or railway it crosses, and the bank down to the water), on piers in the water and bents of columns on land; and
// on fill where it's lower over the ground, the fill held between the deck's faces carried down to the ground as
// retaining walls, each end of the open span seated on a concrete abutment across the deck (a bank seat set into the
// bank, the river's banks sloping under the span in front of it). The town's ground layers stay on the ground under it
// (ground-core.js deckLayerLift), so nothing but the bridge stands over the water. Broadway's bridge (rebuilt in 2003)
// spans on arches, its faces arched between the piers, with lamp posts along its parapets.
const DECK_DEPTH = 0.95; // the deck's underside under its top
const OPEN_AIR = 2.2;    // under a deck this far over the ground or more it's open, lower it's on fill
function streetBridge(d, P, T, out) {
  const hw = d.half, curb = d.w / 2, n = P.length, arched = d.name === 'Broadway St';
  // its top as it's driven (ground-core.js onDeck): over its first and last 8 m coming down to meet the ground at its ends
  P = P.map((p) => {
    const w = Math.min(1, Math.min(p[2], d.length - p[2]) / 8), end = p[2] < d.length - p[2] ? d.points[0] : d.points.at(-1);
    const q = p.slice();
    q[3] = p[3] - (1 - w) * Math.max(0, end[3] - end[7]);
    return q;
  });
  // world points: across the deck by `o` (to the left), `y` over its top or at the world height `wy`
  const at = (i, o, y) => [P[i][0] - T[i][1] * o, P[i][3] + y, P[i][1] + T[i][0] * o];
  const atW = (i, o, wy) => [P[i][0] - T[i][1] * o, wy, P[i][1] + T[i][0] * o];
  const quad = (list, a, b, c, e) => list.push(...a, ...b, ...c, ...a, ...c, ...e);
  // a strip along the deck from point i0 to i1, between offset o0 at height y0 and o1 at y1 (over its top), both sides
  const along = (list, o0, y0, o1, y1, both = true, i0 = 0, i1 = n - 1) => {
    for (const s of both ? [1, -1] : [1]) {
      for (let i = i0; i < i1; i++) quad(list, at(i, o0 * s, y0), at(i, o1 * s, y1), at(i + 1, o1 * s, y1), at(i + 1, o0 * s, y0));
    }
  };
  // a box standing across the deck at point i: `across` wide, `thick` along it, from world y0 up to y1
  const box = (list, i, across, thick, y0, y1, shift = 0) => {
    if (y1 - y0 < 0.05) return;
    const g = new THREE.BoxGeometry(across, y1 - y0, thick).toNonIndexed();
    g.translate(shift, 0, 0);
    g.rotateY(Math.atan2(T[i][0], T[i][1]));
    g.translate(P[i][0], (y0 + y1) / 2, P[i][1]);
    list.push(...g.attributes.position.array);
  };
  // a round column at point i, `o` across the deck, from world y0 to y1
  const column = (list, i, o, r, y0, y1) => {
    if (y1 - y0 < 0.05) return;
    const g = new THREE.CylinderGeometry(r, r * 1.08, y1 - y0, 14).toNonIndexed();
    const [x, , z] = atW(i, o, 0);
    g.translate(x, (y0 + y1) / 2, z);
    list.push(...g.attributes.position.array);
  };

  const G = P.map((p) => p[7]);
  const bottom = P.map((p) => p[3] - DECK_DEPTH);
  const water = P.map((p) => riverDepth(p[0], p[1]) > 0.05);
  const lift = P.map((p, i) => p[3] - G[i]);
  // open under it (the water, a road or railway it crosses, or room enough), on fill, or on the ground (its ends)
  const open = P.map((p, i) => water[i] || p[5] || p[6] || bottom[i] - G[i] > OPEN_AIR);
  const fill = P.map((p, i) => !open[i] && lift[i] > 0.15);

  // (Lamp) a side with no sidewalk (a freeway's, or where the map has none: d.sw, 2 its left, 1 its right) has its road
  // run out to the parapet, a barrier standing on it
  const walk = { 1: !!((d.sw ?? 3) & 2), [-1]: !!((d.sw ?? 3) & 1) };
  const edgeOf = (s) => (walk[s] ? curb : hw - 0.35);
  // the road's surface where it stands over the ground (where it lies on it, the street's own layer is the road)
  for (let i = 0; i + 1 < n; i++) {
    if (Math.max(lift[i], lift[i + 1]) <= 0.1) continue;
    quad(out.asphalt, at(i, edgeOf(1), 0), at(i, -edgeOf(-1), 0), at(i + 1, -edgeOf(-1), 0), at(i + 1, edgeOf(1), 0));
  }
  for (const s of [1, -1]) {
    const one = (o0, y0, o1, y1) => {
      for (let i = 0; i < n - 1; i++) quad(out.concrete, at(i, o0 * s, y0), at(i, o1 * s, y1), at(i + 1, o1 * s, y1), at(i + 1, o0 * s, y0));
    };
    if (walk[s]) {
      one(curb, 0.0, curb, 0.2);                 // the curb
      one(curb, 0.2, hw - 0.35, 0.2);            // the sidewalk
      one(hw - 0.35, 0.2, hw - 0.35, 0.9);       // the parapet, inside
    } else {
      // a barrier's sloped face off the road (a New Jersey shape), up to its top
      one(hw - 0.35, 0.0, hw - 0.3, 0.08);
      one(hw - 0.3, 0.08, hw - 0.2, 0.33);
      one(hw - 0.2, 0.33, hw - 0.12, 0.9);
    }
  }
  along(out.concrete, hw - 0.35, 0.9, hw, 0.9);              // the coping
  // the deck's faces from the parapets' tops down to its underside, and the underside, where it stands clear of the
  // ground (a fascia over open air; on fill the retaining walls carry the faces on down)
  for (let i = 0; i + 1 < n; i++) {
    if (Math.max(lift[i], lift[i + 1]) <= 0.15) continue;
    for (const s of [1, -1]) quad(out.concrete, at(i, hw * s, 0.9), at(i, hw * s, -DECK_DEPTH), at(i + 1, hw * s, -DECK_DEPTH), at(i + 1, hw * s, 0.9));
    quad(out.concrete, at(i, -hw, -DECK_DEPTH), at(i, hw, -DECK_DEPTH), at(i + 1, hw, -DECK_DEPTH), at(i + 1, -hw, -DECK_DEPTH));
    // a drip groove's shadow line along each face, a hand under the coping
    for (const s of [1, -1]) quad(out.concrete, at(i, (hw + 0.04) * s, 0.72), at(i, (hw + 0.04) * s, 0.62), at(i + 1, (hw + 0.04) * s, 0.62), at(i + 1, (hw + 0.04) * s, 0.72));
  }
  // a steel railing on the parapets: a top rail, and posts every 2.5 m
  along(out.steel, hw - 0.18, 1.12, hw - 0.18, 1.18);
  along(out.steel, hw - 0.18, 1.12, hw - 0.12, 1.12);
  for (let k = 0; k <= d.length / 2.5; k++) {
    const s = k * 2.5;
    let i = 0;
    while (i + 2 < n && P[i + 1][2] < s) i++;
    const f = Math.max(0, Math.min(1, (s - P[i][2]) / ((P[i + 1][2] - P[i][2]) || 1)));
    for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(0.06, 0.28, 0.06).toNonIndexed();
      const x = P[i][0] + (P[i + 1][0] - P[i][0]) * f - T[i][1] * (hw - 0.15) * side, z = P[i][1] + (P[i + 1][1] - P[i][1]) * f + T[i][0] * (hw - 0.15) * side;
      g.translate(x, P[i][3] + (P[i + 1][3] - P[i][3]) * f + 1.04, z);
      out.steel.push(...g.attributes.position.array);
    }
  }

  // the fill's retaining walls: the faces carried down to the ground, and a footing's lip along their foot
  for (let i = 0; i + 1 < n; i++) {
    if (!(fill[i] || fill[i + 1]) || open[i] && open[i + 1]) continue;
    for (const s of [1, -1]) {
      quad(out.concrete, at(i, hw * s, -DECK_DEPTH), atW(i, hw * s, G[i] - 0.4), atW(i + 1, hw * s, G[i + 1] - 0.4), at(i + 1, hw * s, -DECK_DEPTH));
    }
  }

  // Where it's open: a bank seat at each end of each open run, and between them piers in the water and bents on land
  const supports = []; // { i, kind: 'seat' | 'pier' | 'bent' }
  const kept = (i) => !P[i][5] && !P[i][6];
  for (let i0 = 0; i0 < n;) {
    if (!open[i0]) { i0++; continue; }
    let i1 = i0;
    while (i1 + 1 < n && open[i1 + 1]) i1++;
    const a = Math.max(0, i0 - 1), b = Math.min(n - 1, i1 + 1);
    supports.push({ i: a, kind: 'seat', way: 1 });
    const span = P[b][2] - P[a][2], wet = water.slice(i0, i1 + 1).some(Boolean);
    const each = wet ? 27 : 20, count = span > (wet ? 36 : 26) ? Math.round(span / each) : 1;
    for (let k = 1; k < count; k++) {
      const s = P[a][2] + (span * k) / count;
      let i = a;
      while (i < b && P[i][2] < s) i++;
      // never in a road or on a railway it crosses: the nearest point either way that isn't
      let best = -1;
      for (let m = 0; m <= 3 && best < 0; m++) for (const c of [i - m, i + m]) if (best < 0 && c > a && c < b && kept(c)) best = c;
      if (best >= 0 && !supports.some((q) => q.i === best)) supports.push({ i: best, kind: water[best] ? 'pier' : 'bent' });
    }
    supports.push({ i: b, kind: 'seat', way: -1 });
    i0 = i1 + 1;
  }
  supports.sort((p, q) => p.i - q.i);
  for (const sp of supports) {
    const i = sp.i, top = bottom[i];
    // the lowest ground about it (a seat stands on the foot of the bank before it, a pier on the bed)
    let foot = G[i];
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < n) foot = Math.min(foot, G[j]);
    if (sp.kind === 'seat') {
      if (top - foot < 0.3) continue;
      // the seat across the deck, with a bearing shelf, and short wing walls back into the bank
      box(out.concrete, i, hw * 2 + 0.5, 1.3, foot - 0.6, top);
      box(out.concrete, i, hw * 2 + 0.5, 1.7, top - 0.35, top);
      if (water[i] || riverDepth(P[i][0], P[i][1]) > 0.02 || foot < (waterLevel(P[i][0], P[i][1]) ?? -Infinity) + 0.6) {
        addPier({ x: P[i][0], z: P[i][1], ux: T[i][0], uz: T[i][1], across: hw + 0.25, along: 0.85 });
      }
    } else if (sp.kind === 'pier' || arched) {
      // a wall pier with rounded noses on a footing in the bed, under a cap beam
      const bed = sp.kind === 'pier' ? riverbedHeight(P[i][0], P[i][1]) - 0.5 : G[i] - 0.4;
      const across = Math.max(2, hw * 2 - 3.2), thick = 1.1;
      box(out.concrete, i, across, thick, bed, top - 0.55);
      for (const s of [1, -1]) column(out.concrete, i, s * across / 2, thick / 2, bed, top - 0.55);
      box(out.concrete, i, hw * 2 - 0.6, 1.5, top - 0.6, top);
      if (sp.kind === 'pier') addPier({ x: P[i][0], z: P[i][1], ux: T[i][0], uz: T[i][1], across: across / 2 + thick / 2, along: thick / 2 });
    } else {
      // a bent: round columns under a cap beam
      const cols = Math.max(2, Math.round((hw * 2) / 6.5)), reach = hw - 1.6;
      for (let k = 0; k < cols; k++) column(out.concrete, i, -reach + (2 * reach * k) / (cols - 1), 0.42, G[i] - 0.4, top - 0.6);
      box(out.concrete, i, hw * 2 - 0.8, 1.1, top - 0.65, top);
    }
  }

  // (Lamp) under an overpass's open span, off the road passing under it, the town's ground layers go down out of sight
  // (ground-core.js overpassBuries): concrete slope paving follows the ground there instead, from the road's edge up the
  // banks to the abutments, in cells about 2 m square
  if (d.overpass) {
    for (let i = 0; i + 1 < n; i++) {
      const A = d.points[i], B = d.points[i + 1];
      if (!(A[5] || B[5] || A[8] || B[8])) continue;
      const along = Math.max(1, Math.ceil((B[2] - A[2]) / 2)), across = Math.max(2, Math.ceil((hw * 2) / 2));
      const pt = (f, g) => {
        const x = A[0] + (B[0] - A[0]) * f - (T[i][1] + (T[i + 1][1] - T[i][1]) * f) * (-hw + 2 * hw * g);
        const z = A[1] + (B[1] - A[1]) * f + (T[i][0] + (T[i + 1][0] - T[i][0]) * f) * (-hw + 2 * hw * g);
        // (over the layers where they go down, under them where they stay: the road under it keeps its edge)
        const gy = riverbedHeight(x, z);
        return [x, gy + (overpassBuries(d, A, B, x, z, gy) ? 0.05 : -0.08), z];
      };
      for (let u = 0; u < along; u++) {
        for (let v = 0; v < across; v++) {
          // (any of the cell the layers go down under: its middle or a corner)
          const corners = [pt((u + 0.5) / along, (v + 0.5) / across), pt(u / along, v / across), pt((u + 1) / along, v / across),
            pt(u / along, (v + 1) / across), pt((u + 1) / along, (v + 1) / across)];
          if (!corners.some((c) => c[1] > riverbedHeight(c[0], c[2]))) continue;
          quad(out.concrete, pt(u / along, v / across), pt(u / along, (v + 1) / across), pt((u + 1) / along, (v + 1) / across), pt((u + 1) / along, v / across));
        }
      }
    }
  }

  // Broadway's arches: each span between its supports arched, the faces coming down to the arch's ring from the deck,
  // and the arch's soffit across under it; open to the water, the road and the railway under it
  if (arched) {
    // a point `s` metres along: its place, top and frame, between the deck's points
    const pos = (s) => {
      let i = 0;
      while (i + 2 < n && P[i + 1][2] < s) i++;
      const f = Math.max(0, Math.min(1, (s - P[i][2]) / ((P[i + 1][2] - P[i][2]) || 1)));
      return { x: P[i][0] + (P[i + 1][0] - P[i][0]) * f, z: P[i][1] + (P[i + 1][1] - P[i][1]) * f, y: P[i][3] + (P[i + 1][3] - P[i][3]) * f - DECK_DEPTH,
        g: G[i] + (G[i + 1] - G[i]) * f, tx: T[i][0], tz: T[i][1] };
    };
    const side = (q, o, y) => [q.x - q.tz * o, y, q.z + q.tx * o];
    for (let k = 0; k + 1 < supports.length; k++) {
      const a = supports[k], b = supports[k + 1];
      if (!open.slice(a.i + 1, b.i).some(Boolean)) continue;
      const sa = P[a.i][2] + 0.75, sb = P[b.i][2] - 0.75, span = sb - sa;
      if (span < 6) continue;
      const mid = pos((sa + sb) / 2);
      const floor = Math.max(mid.g, waterLevel(mid.x, mid.z) ?? -Infinity);
      const rise = Math.min(span * 0.32, Math.max(0, (mid.y - floor) * 0.6));
      if (rise < 0.8) continue;
      const steps = Math.max(8, Math.ceil(span / 1.5));
      const ring = (u) => { const q = pos(sa + span * u), t = 2 * u - 1; return { q, y: q.y - 0.35 - rise * t * t }; };
      for (let m = 0; m < steps; m++) {
        const A = ring(m / steps), B = ring((m + 1) / steps);
        for (const s of [1, -1]) {
          // the spandrel's face, from the ring up to the deck's underside, a little proud of the fascia
          quad(out.concrete, side(A.q, (hw + 0.02) * s, A.q.y), side(A.q, (hw + 0.02) * s, A.y), side(B.q, (hw + 0.02) * s, B.y), side(B.q, (hw + 0.02) * s, B.q.y));
          // the arch's ring, standing out from the face
          quad(out.concrete, side(A.q, (hw + 0.14) * s, A.y + 0.55), side(A.q, (hw + 0.14) * s, A.y), side(B.q, (hw + 0.14) * s, B.y), side(B.q, (hw + 0.14) * s, B.y + 0.55));
          quad(out.concrete, side(A.q, (hw + 0.02) * s, A.y), side(A.q, (hw + 0.14) * s, A.y), side(B.q, (hw + 0.14) * s, B.y), side(B.q, (hw + 0.02) * s, B.y));
        }
        // the soffit across under it
        quad(out.concrete, side(A.q, -hw, A.y), side(A.q, hw, A.y), side(B.q, hw, B.y), side(B.q, -hw, B.y));
      }
    }
    // lamp posts along the parapets, 24 m apart on each side and staggered: a pole on a base, a globe under a cap
    for (let s = 6; s < d.length - 4; s += 12) {
      const q = pos(s), o = ((Math.round(s / 12) % 2) ? 1 : -1) * (hw - 0.18), top = q.y + DECK_DEPTH;
      if (top - q.g < 0.5) continue;
      const [x, , z] = side(q, o, 0);
      const pole = new THREE.CylinderGeometry(0.07, 0.11, 5.2, 10).toNonIndexed().translate(x, top + 0.9 + 2.6, z);
      out.steel.push(...pole.attributes.position.array);
      const cap = new THREE.CylinderGeometry(0.28, 0.16, 0.25, 10).toNonIndexed().translate(x, top + 6.45, z);
      out.steel.push(...cap.attributes.position.array);
      const globe = new THREE.CylinderGeometry(0.2, 0.14, 0.5, 10).toNonIndexed().translate(x, top + 6.1, z);
      out.glass.push(...globe.attributes.position.array);
      const base = new THREE.CylinderGeometry(0.2, 0.24, 0.6, 10).toNonIndexed().translate(x, top + 0.9 + 0.3, z);
      out.steel.push(...base.attributes.position.array);
    }
  }
}

// Every part merged alike: indexed, with positions and normals only
function clean(g) {
  if (!g.index) g = mergeVerts(g);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.morphAttributes = {};
  return g;
}
function mergeVerts(g) {
  const n = g.attributes.position.count, idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

// A footbridge, drawn smooth: its path through the deck's points as a curve sampled every half metre, a deck of
// planks laid across it on two glulam beams with fascia boards, and railings of rounded posts, a rounded top rail, a
// round handrail and a bottom rail with slender balusters between
function footbridge(d, out) {
  const P = d.points, hw = d.half;
  const curve = new THREE.CatmullRomCurve3(P.map((p) => new THREE.Vector3(p[0], p[3], p[1])), false, 'centripetal');
  const len = curve.getLength(), n = Math.max(4, Math.ceil(len / 0.5));
  const Q = curve.getSpacedPoints(n);
  // each sample's frame: forward along the deck (with its slope), left across it (level), up off it
  const F = Q.map((q, i) => new THREE.Vector3().subVectors(Q[Math.min(n, i + 1)], Q[Math.max(0, i - 1)]).normalize());
  const Lf = F.map((f) => new THREE.Vector3(-f.z, 0, f.x).normalize());
  const U = F.map((f, i) => new THREE.Vector3().crossVectors(Lf[i], f).normalize());
  const at = (i, o, y) => Q[i].clone().addScaledVector(Lf[i], o).addScaledVector(U[i], y);
  // a cross-section (points [o, y], closed) swept along samples i0..i1 with smooth normals, its ends capped
  const sweep = (prof, i0 = 0, i1 = n) => {
    const pos = [], idx = [], m = prof.length;
    for (let i = i0; i <= i1; i++) for (const [o, y] of prof) pos.push(...at(i, o, y).toArray());
    for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < m; j++) {
      const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, e = b + m;
      idx.push(a, c, b, b, c, e);
    }
    // caps, fanned from the first point of the section
    const last = (i1 - i0) * m;
    for (let j = 1; j + 1 < m; j++) { idx.push(0, j, j + 1); idx.push(last, last + j + 1, last + j); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  // a rounded rectangle's section, w wide and h tall, centered at (o, y), r its corners' radius
  const rrect = (o, y, w, h, r, seg = 4) => {
    const pts = [];
    for (const [cx, cy, a0] of [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 0.5], [-w / 2 + r, -h / 2 + r, 1], [w / 2 - r, -h / 2 + r, 1.5]]) {
      for (let k = 0; k <= seg; k++) {
        const a = (a0 + (k / seg) * 0.5) * Math.PI;
        pts.push([o + cx + Math.cos(a) * r, y + cy + Math.sin(a) * r]);
      }
    }
    return pts;
  };
  const circle = (o, y, r, seg = 12) => Array.from({ length: seg }, (_, k) => [o + Math.cos((k / seg) * Math.PI * 2) * r, y + Math.sin((k / seg) * Math.PI * 2) * r]);
  // a part placed in sample i's frame at (o, y, along) with the deck's slope
  const M = new THREE.Matrix4();
  const put = (g, i, o, y, along = 0) => {
    const f = F[i], l = Lf[i], u = U[i], p = at(i, o, y).addScaledVector(f, along);
    // the part's x across the deck (to the right), y up off it, z along it
    M.makeBasis(l.clone().negate(), u, f).setPosition(p);
    return g.applyMatrix4(M);
  };
  const vertical = (g, i, o, y) => { const p = at(i, o, y); return g.rotateY(Math.atan2(F[i].x, F[i].z)).translate(p.x, p.y, p.z); };

  // the planks: 14 cm boards with 1.5 cm gaps, each a hair off square and its own height, end to end along the curve
  const step = 0.155, count = Math.floor(len / step);
  const plank = new THREE.BoxGeometry(hw * 2 - 0.04, 0.05, 0.14, 1, 1, 1);
  for (let k = 0; k < count; k++) {
    const s = (k + 0.5) * step, i = Math.min(n - 1, Math.floor((s / len) * n)), along = s - (i / n) * len;
    const g = plank.clone().translate(0, -0.025 + ((k * 7919) % 5) * 0.002, 0).rotateY((((k * 104729) % 7) - 3) * 0.0015);
    out.planks.push(put(g, i, 0, 0, along));
  }
  // the beams under the deck, and the fascia boards along its edges
  for (const sgn of [1, -1]) {
    out.beams.push(sweep(rrect(sgn * (hw - 0.4), -0.38, 0.22, 0.62, 0.04)));
    out.beams.push(sweep(rrect(sgn * (hw + 0.02), -0.2, 0.06, 0.36, 0.015, 2)));
  }
  // cross beams under the planks every 2 m
  for (let k = 1; k < len / 2; k++) {
    const i = Math.round(((k * 2) / len) * n);
    if (i <= 0 || i >= n) continue;
    out.beams.push(put(new THREE.BoxGeometry(hw * 2 - 0.3, 0.12, 0.1), i, 0, -0.12));
  }
  // the railings
  const H = 1.07;
  for (const sgn of [1, -1]) {
    const o = sgn * (hw - 0.05);
    out.rails.push(sweep(rrect(o, H, 0.12, 0.05, 0.02)));                 // the top rail
    out.rails.push(sweep(circle(o - sgn * 0.09, 0.92, 0.022)));           // the handrail, held inward
    out.rails.push(sweep(rrect(o, 0.14, 0.05, 0.05, 0.015, 2)));          // the bottom rail
    // the posts every 2 m, rounded, with a bracket out to the handrail
    for (let k = 0; k <= Math.round(len / 2); k++) {
      const i = Math.round((k / Math.round(len / 2)) * n);
      const post = new THREE.CylinderGeometry(0.045, 0.05, H + 0.25, 10).translate(0, (H + 0.25) / 2 - 0.25, 0);
      out.rails.push(vertical(post, i, o + sgn * 0.02, 0));
      out.rails.push(vertical(new THREE.SphereGeometry(0.06, 10, 6), i, o + sgn * 0.02, H + 0.03));
      out.rails.push(put(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6).rotateZ(Math.PI / 2), i, o - sgn * 0.05, 0.92));
    }
    // the balusters, every 11 cm
    const bstep = 0.11, bcount = Math.floor(len / bstep);
    const baluster = new THREE.CylinderGeometry(0.009, 0.009, H - 0.17, 6, 1, true).translate(0, (H - 0.17) / 2 + 0.165, 0);
    for (let k = 1; k < bcount; k++) {
      const s = k * bstep, i = Math.min(n - 1, Math.floor((s / len) * n)), along = s - (i / n) * len;
      const p = at(i, o, 0).addScaledVector(F[i], along);
      out.rails.push(baluster.clone().translate(p.x, p.y, p.z));
    }
  }
}

// A footbridge's pier in the water: two round columns under a cap beam, on a footing in the riverbed
function footPier(out, p, t, hw, bed, top) {
  const yaw = Math.atan2(t[0], t[1]), h = top - bed;
  for (const s of [-1, 1]) {
    const c = new THREE.CylinderGeometry(0.22, 0.26, h, 24).translate(s * (hw - 0.4), bed + h / 2, 0);
    out.concrete.push(c.rotateY(yaw).translate(p[0], 0, p[1]));
  }
  out.concrete.push(new THREE.BoxGeometry(hw * 2 - 0.2, 0.3, 0.55).translate(0, top - 0.15, 0).rotateY(yaw).translate(p[0], 0, p[1]));
}
// Where a footbridge meets the bank: a low concrete seat under its beams with wing walls back into the bank
function footAbutment(out, p, t, hw, bed, top) {
  const yaw = Math.atan2(t[0], t[1]), h = top - bed;
  out.concrete.push(new THREE.BoxGeometry(hw * 2 + 0.3, h, 0.9).translate(0, bed + h / 2, 0).rotateY(yaw).translate(p[0], 0, p[1]));
  for (const s of [-1, 1]) {
    out.concrete.push(new THREE.BoxGeometry(0.3, h, 2.4).translate(s * (hw + 0.3), bed + h / 2, 0).rotateY(yaw).translate(p[0], 0, p[1]));
  }
}

export { buildRiver, pierPush };
