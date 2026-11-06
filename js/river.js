import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fn, attribute, color, float, mix, smoothstep, positionWorld, vertexColor, mx_noise_float, mx_worley_noise_float } from 'three/tsl';
import { nearDrop } from './cascades.js';
import { riverbedHeight, riverDepth, waterLevel, bridgeDecks } from './terrain.js';

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

function meshOf(pos, material, name, colors = null, wet = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (wet) g.setAttribute('wet', new THREE.Float32BufferAttribute(wet, 1));
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
  const lawn = new THREE.Color(0x4f8a2e).convertSRGBToLinear(), grass = new THREE.Color(0x3f6b27).convertSRGBToLinear();
  const mud = new THREE.Color(0x5a4c35).convertSRGBToLinear();
  const silt = new THREE.Color(0x3a2e20).convertSRGBToLinear(), c = new THREE.Color();
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
    for (const [tp, tc, tw] of tiles.values()) river.add(meshOf(tp, bankMat, 'RiverBanks', tc, tw));
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
  buildBridges(river);
}

// ---------------------------------------------------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------------------------------------------------

function buildBridges(group) {
  const decks = bridgeDecks();
  if (!decks.length) return;
  const concrete = [], steel = [], wood = [], rail = [];
  const fb = { planks: [], beams: [], rails: [], concrete: [] }; // the footbridges' smooth parts (footbridge())

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
      const curb = d.w / 2;
      along(concrete, curb, 0.0, curb, 0.2);              // the curbs
      along(concrete, curb, 0.2, hw - 0.3, 0.2);          // the sidewalks
      along(concrete, hw - 0.3, 0.2, hw - 0.3, 1.05);     // the parapets
      along(concrete, hw - 0.3, 1.05, hw, 1.05);
      along(concrete, hw, 1.05, hw, under);               // and the deck's face below them
      along(concrete, -hw, under, hw, under, false);      // its underside
      along(concrete, -curb, -0.06, curb, -0.06, false);  // the deck under the road
      // a steel railing on the parapets
      along(steel, hw - 0.2, 1.05, hw - 0.2, 1.12);
    } else if (d.kind === 1) {
      along(concrete, -hw, -0.15, hw, -0.15, false);      // the deck under the ballast
      along(steel, hw, -0.15, hw, under);
      along(concrete, -hw, under, hw, under, false);
      // plate girders along both sides, standing above the deck
      along(steel, hw - 0.1, -0.15, hw - 0.1, 1.5);
      along(steel, hw - 0.1, 1.5, hw + 0.25, 1.5);
      along(steel, hw + 0.25, 1.5, hw + 0.25, under);
    } else {
      footbridge(d, fb);
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
      if (top - bed > 1) {
        if (d.kind === 2) footPier(fb, P[i], T[i], hw, bed, P[i][3] - 0.62);
        else pier(concrete, i, hw * 2 - 1.2, 1.3, bed, top);
      }
    }
    for (const i of [Math.max(0, first - 1), Math.min(P.length - 1, last + 1)]) {
      const top = P[i][3] + under, bed = riverbedHeight(P[i][0], P[i][1]) - 0.5;
      if (d.kind === 2) { if (P[i][3] - 0.62 - bed > 0.3) footAbutment(fb, P[i], T[i], hw, bed, P[i][3] - 0.62); }
      else if (top - bed > 0.3) pier(concrete, i, hw * 2 + 0.2, 1.6, bed, top + 0.05);
    }
  }

  const mat = (color, rough, metal = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  for (const [pos, m, name] of [[concrete, mat(0xb3ada3, 0.9), 'BridgeConcrete'], [steel, mat(0x4d5a5e, 0.6, 0.3), 'BridgeSteel'],
    [wood, mat(0x8a7356, 0.9), 'BridgeDecks'], [rail, mat(0x2f3436, 0.5, 0.4), 'BridgeRailings']]) {
    if (!pos.length) continue;
    const mesh = meshOf(pos, m, name);
    mesh.castShadow = true;
    group.add(mesh);
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

export { buildRiver };
