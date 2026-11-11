import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { groundHeight, groundUnderStreets, riverbedHeight, deckTop, bridgeDecks } from './terrain.js';
import { localTime } from './theride.js';
import { HORN_PATTERN } from './rail-sounds.js';

// Ann Arbor's railroads (GEO.rail from build-annarbor.py, OpenStreetMap): every piece of track as ballast, ties and two
// steel rails, on the ground's heights smoothed along the line, and level across its bridges; and a train on each
// long line: Amtrak's Wolverine (a Charger at each end and four silver cars) on the Michigan Line along the Huron, coming through
// on Amtrak's timetable (data/wolverine.json, build-wolverine.py from Amtrak's GTFS feed) and stopping at the Depot
// Street station; an Ann Arbor Railroad freight (two engines, boxcars and hoppers) and a short Great Lakes Central one
// each coming up its line on a few runs a day, switching at the far end and going back. Each sounds its horn for every
// grade crossing ahead and the crossings' bells ring while their lamps flash (rail-sounds.js, audio-system.js).

const GAUGE = 1.435, TIE_STEP = 1.2, TOP = 0.42; // top of the rails above the ground

const C = (hex) => new THREE.Color(hex); // already linear: three converts a hex color as it's set
function tinted(geo, hex) {
  const c = C(hex);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// A line of flat x, z pairs resampled every `step` metres, with the height of its rails' base along it: the ground
// averaged over 30 m either way (a railroad doesn't follow every bump; under a street's bridge, the ground under its
// deck: terrain.js groundUnderStreets), and a straight run across a bridge between
// `ends` (the heights of the track meeting it at each end, else the ground there). A bridge over the river runs on the
// deck terrain.js lays there (river.js draws it; groundHeight is its top), so trains ride on the bridge that is drawn.
// The ends of the level railway bridges over roads (terrain.js `level`): the track climbs to them on an embankment at
// most 2.5% (rampUp), so a train never leaps up a bridge's end
let RAMPS = null;
const RAMP_GRADE = 0.025;
function ramps() {
  return RAMPS ??= bridgeDecks().filter((d) => d.level && d.kind === 1).flatMap((d) => [d.points[0], d.points.at(-1)])
    .map((p) => ({ x: p[0], z: p[1], y: p[3] - 0.1 }));
}
function rampUp(xs, zs, y, skip = null) {
  for (const r of ramps()) {
    for (let i = 0; i < y.length; i++) {
      if (skip && skip(i)) continue;
      const lift = r.y - RAMP_GRADE * Math.hypot(xs[i] - r.x, zs[i] - r.z);
      if (lift > y[i]) y[i] = lift;
    }
  }
}

function railPath(flat, bridge, step = 5, ends = null) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const out = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    for (let d = carry; d < L; d += step) out.push([x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L]);
    carry = (carry - L) % step;
    if (carry < 0) carry += step;
  }
  out.push(pts[pts.length - 1]);
  const n = out.length, g = out.map(([x, z]) => groundUnderStreets(x, z));
  const y = new Float32Array(n);
  let river = false;
  if (bridge) {
    const [mx, mz] = out[n >> 1];
    river = groundHeight(mx, mz) - riverbedHeight(mx, mz) > 0.3;
    const y0 = ends?.[0] ?? g[0], y1 = ends?.[1] ?? g[n - 1];
    // (on the deck all the way, over the roads it crosses as well as the water)
    for (let i = 0; i < n; i++) y[i] = river ? deckTop(out[i][0], out[i][1]) - 0.1 : y0 + (y1 - y0) * (n > 1 ? i / (n - 1) : 0);
  } else {
    const R = Math.max(1, Math.round(30 / step));
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += g[j]; c++; }
      // never buried more than a little
      y[i] = Math.max(s / c, g[i] - 0.15);
    }
    rampUp(out.map((p) => p[0]), out.map((p) => p[1]), y);
  }
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) d[i] = d[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  return { x: out.map((p) => p[0]), z: out.map((p) => p[1]), y, d, length: d[n - 1], river, g };
}

// A train's route (one long line over its bridges): on a bridge of its own (one it runs along, not one crossing over
// it) the bridge's height, elsewhere the ground averaged as railPath does, leaving out the ground under its bridges
function routePath(flat, bridges) {
  const p = railPath(flat, false);
  const n = p.x.length;
  const deck = new Float32Array(n).fill(NaN);
  const dir = (q, i) => {
    const a = Math.max(0, i - 1), b = Math.min(q.x.length - 1, i + 1);
    const dx = q.x[b] - q.x[a], dz = q.z[b] - q.z[a], L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };
  for (const b of bridges) {
    for (let i = 0; i < n; i++) {
      if (p.x[i] < b.box[0] || p.x[i] > b.box[1] || p.z[i] < b.box[2] || p.z[i] > b.box[3]) continue;
      let bd = 3, bj = -1;
      for (let j = 0; j < b.x.length; j++) {
        const d = Math.hypot(b.x[j] - p.x[i], b.z[j] - p.z[i]);
        if (d < bd) { bd = d; bj = j; }
      }
      if (bj < 0) continue;
      const [ax, az] = dir(p, i), [cx, cz] = dir(b, bj);
      if (Math.abs(ax * cx + az * cz) > 0.85) deck[i] = b.y[bj];
    }
  }
  const g = p.x.map((x, i) => groundUnderStreets(x, p.z[i]));
  const R = 6;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(deck[i])) { p.y[i] = deck[i]; continue; }
    let s = 0, c = 0;
    for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) if (Number.isNaN(deck[j])) { s += g[j]; c++; }
    p.y[i] = Math.max(s / c, g[i] - 0.15);
  }
  rampUp(p.x, p.z, p.y, (i) => !Number.isNaN(deck[i]));
  return p;
}

// Where along a path, `s` metres from its start: position and direction
function sample(p, s, out) {
  s = Math.max(0, Math.min(p.length, s));
  let lo = 0, hi = p.d.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p.d[m] <= s) lo = m; else hi = m; }
  const seg = p.d[hi] - p.d[lo] || 1, t = (s - p.d[lo]) / seg;
  out.x = p.x[lo] + (p.x[hi] - p.x[lo]) * t;
  out.y = p.y[lo] + (p.y[hi] - p.y[lo]) * t;
  out.z = p.z[lo] + (p.z[hi] - p.z[lo]) * t;
  return out;
}

// The track along one path: a ballast bed (a trapezoid, on a bridge a steel deck), and two rails
function trackGeometry(p, bridge, quads, railsOnly = false) {
  const n = p.x.length;
  const side = (i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = p.x[b] - p.x[a], dz = p.z[b] - p.z[a], L = Math.hypot(dx, dz) || 1;
    return [-dz / L, dx / L];
  };
  const strip = (off0, off1, h0, h1, hex) => {
    for (let i = 0; i + 1 < n; i++) {
      const [ax, az] = side(i), [bx, bz] = side(i + 1);
      const P = (j, s, o, h) => [p.x[j] + s[0] * o, p.y[j] + h, p.z[j] + s[1] * o];
      quads.push([P(i, [ax, az], off0, h0), P(i + 1, [bx, bz], off0, h0), P(i + 1, [bx, bz], off1, h1), P(i, [ax, az], off1, h1), hex]);
    }
  };
  if (railsOnly) {
    // (rails and ties only)
  } else if (bridge) {
    strip(-2.1, 2.1, 0.12, 0.12, 0x4d4a46);       // the deck
    strip(-2.1, -2.1, -1.3, 0.12, 0x3a3836);      // its girders' sides
    strip(2.1, 2.1, 0.12, -1.3, 0x3a3836);
    strip(-2.1, 2.1, -1.3, -1.3, 0x2f2d2b);
  } else {
    strip(-2.2, -1.45, 0.0, 0.2, 0x8a847c);       // ballast shoulders and top
    strip(-1.45, 1.45, 0.2, 0.2, 0x7a746c);
    strip(1.45, 2.2, 0.2, 0.0, 0x8a847c);
    // where the track is raised up to a bridge, a concrete retaining wall either side from the ballast's edge straight
    // down to the ground (a sloped fill folds over itself on a curve), capped along its top
    if (p.g) {
      for (let i = 0; i + 1 < n; i++) {
        const ha = p.y[i] - p.g[i], hb = p.y[i + 1] - p.g[i + 1];
        if (ha < 0.4 && hb < 0.4) continue;
        const [ax, az] = side(i), [bx, bz] = side(i + 1);
        for (const s of [-1, 1]) {
          const P = (j, sd, o, y) => [p.x[j] + sd[0] * o * s, y, p.z[j] + sd[1] * o * s];
          quads.push([P(i, [ax, az], 2.25, p.y[i] + 0.05), P(i + 1, [bx, bz], 2.25, p.y[i + 1] + 0.05),
            P(i + 1, [bx, bz], 2.25, Math.min(p.y[i + 1], p.g[i + 1]) - 0.3), P(i, [ax, az], 2.25, Math.min(p.y[i], p.g[i]) - 0.3), 0x9b978e]);
          quads.push([P(i, [ax, az], 2.05, p.y[i] + 0.12), P(i + 1, [bx, bz], 2.05, p.y[i + 1] + 0.12),
            P(i + 1, [bx, bz], 2.4, p.y[i + 1] + 0.12), P(i, [ax, az], 2.4, p.y[i] + 0.12), 0xa8a49b]);
        }
      }
    }
  }
  for (const r of [-GAUGE / 2, GAUGE / 2]) {
    strip(r - 0.035, r + 0.035, TOP, TOP, 0xb8b4ae); // the polished top
    strip(r - 0.035, r - 0.035, 0.32, TOP, 0x5a4636); // rusty sides
    strip(r + 0.035, r + 0.035, TOP, 0.32, 0x5a4636);
  }
}

// --- The rolling stock, each car a merged mesh in vertex colours, its length along +z
function box(w, h, l, x, y, z, hex) { return tinted(new THREE.BoxGeometry(w, h, l).translate(x, y, z), hex); }
function trucks(len, parts) {
  for (const s of [-1, 1]) {
    parts.push(box(2.6, 0.7, 2.8, 0, 0.55, s * (len / 2 - 2.6), 0x222222));
    for (const w of [-0.9, 0.9]) {
      const wheel = new THREE.CylinderGeometry(0.46, 0.46, 0.14, 12).rotateZ(Math.PI / 2);
      for (const sx of [-0.72, 0.72]) parts.push(tinted(wheel.clone().translate(sx, 0.46, s * (len / 2 - 2.6) + w), 0x1a1a1a));
    }
  }
}
function windows(len, y, h, parts, hex = 0x1c2630, every = 2.2, wide = 1.3) {
  for (let z = -len / 2 + 2; z <= len / 2 - 2; z += every) {
    for (const s of [-1, 1]) parts.push(box(0.04, h, wide, s * 1.56, y, z, hex));
  }
}
const CAR_KINDS = {
  // Amtrak's Charger: dark grey with a blue and silver nose
  charger(parts) {
    const L = 21.5;
    trucks(L, parts);
    parts.push(box(3.1, 3.2, L - 3, 0, 2.75, -1.5, 0x3a3f46));
    parts.push(box(3.1, 1.8, 3, 0, 2.05, L / 2 - 1.5, 0x2b5aa0));
    parts.push(box(3.0, 1.5, 2.4, 0, 3.6, L / 2 - 2.2, 0x9aa2ab));
    parts.push(box(3.02, 0.7, 1.6, 0, 3.75, L / 2 - 1.9, 0x111820));
    parts.push(box(3.14, 0.35, L - 3, 0, 2.0, -1.5, 0x2b5aa0));
    parts.push(box(3.14, 0.12, L - 3, 0, 2.3, -1.5, 0xc8202f));
    return L;
  },
  // Amfleet and Horizon coaches: brushed steel with a band of windows and red, white and blue stripes
  coach(parts) {
    const L = 25.9;
    trucks(L, parts);
    parts.push(box(3.1, 3.0, L, 0, 2.65, 0, 0xb9bec4));
    parts.push(box(2.9, 0.4, L - 0.6, 0, 4.3, 0, 0x9da3a9));
    windows(L, 3.0, 0.75, parts, 0x1c2630, 2.3, 1.4);
    parts.push(box(3.14, 0.14, L, 0, 2.3, 0, 0xc8202f));
    parts.push(box(3.14, 0.14, L, 0, 2.1, 0, 0x1f4f99));
    return L;
  },
  // Freight diesels: the Ann Arbor Railroad's blue with a yellow stripe
  diesel(parts) {
    const L = 19.8;
    trucks(L, parts);
    parts.push(box(3.1, 0.35, L, 0, 1.35, 0, 0x1d1d1d));
    parts.push(box(2.3, 2.6, L - 6, 0, 2.85, -2.2, 0x1f3f78));
    parts.push(box(3.0, 3.1, 3.2, 0, 3.1, L / 2 - 4.3, 0x1f3f78));
    parts.push(box(2.4, 1.2, 2.0, 0, 2.1, L / 2 - 1.3, 0x1f3f78));
    parts.push(box(3.04, 0.6, 3.0, 0, 3.9, L / 2 - 4.3, 0x111820));
    parts.push(box(3.14, 0.22, L - 0.4, 0, 1.6, 0, 0xf2c200));
    parts.push(box(0.6, 0.5, 0.9, 0, 4.4, -2, 0x222222));
    return L;
  },
  boxcar(parts, hex = 0x7a3b28) {
    const L = 17.4;
    trucks(L, parts);
    parts.push(box(3.1, 3.6, L, 0, 3.0, 0, hex));
    parts.push(box(3.16, 2.8, 3.2, 0, 2.8, 0, 0x5e2d1f));
    parts.push(box(3.0, 0.1, L, 0, 4.85, 0, 0x6a6a6a));
    return L;
  },
  hopper(parts, hex = 0x8c8c84) {
    const L = 16;
    trucks(L, parts);
    parts.push(box(3.1, 2.6, L - 1, 0, 3.0, 0, hex));
    for (const z of [-4.5, 0, 4.5]) parts.push(tinted(new THREE.ConeGeometry(1.4, 1.4, 4).rotateY(Math.PI / 4).rotateX(Math.PI).translate(0, 1.2, z), hex));
    return L;
  },
  tank(parts) {
    const L = 17.8;
    trucks(L, parts);
    parts.push(tinted(new THREE.CylinderGeometry(1.45, 1.45, L - 1.2, 16).rotateX(Math.PI / 2).translate(0, 2.75, 0), 0x202224));
    parts.push(box(1.0, 0.5, 1.0, 0, 4.35, 0, 0x2a2a2a));
    return L;
  }
};
// Ann Arbor's station on Depot Street (city-config.js's landmark), and how long before and after its stop a train is
// looked for on the line (time enough to cross the town at line speed)
const STATION = { x: 432, z: -905 };
const RUN_WINDOW = 420;
// The freights' runs (FREIGHT, below): each comes in from `from` end of its line, stops at the far end, switches
// there for `dwell` seconds (its engines running round the cars), and goes back out the way it came. `days` Monday
// first. The city's 2019-20 quiet-zone study counted about one Ann Arbor Railroad round trip a day, often at night;
// here a late-night turn every day and a late-morning one on weekdays.
const TRAINS = {
  // the Wolverine top-and-tail, a Charger at each end (the tail one turned round)
  'Michigan Subdivision': { cars: ['charger', 'coach', 'coach', 'coach', 'coach', 'charger:rev'], speed: 22, wait: 25, horn: true, timetable: true },
  'Ann Arbor Railroad': { cars: ['diesel', 'diesel', 'boxcar', 'hopper', 'hopper', 'boxcar:0x2f5d3a', 'tank', 'tank', 'hopper:0x6b5a3a', 'boxcar', 'hopper', 'boxcar:0x3a4f6b'], speed: 11, horn: true,
    from: 'south', runs: [{ arr: 11 * 3600 + 20 * 60, dwell: 1500, days: '1111100' }, { arr: 23 * 3600 + 40 * 60, dwell: 1800, days: '1111111' }] },
  'Great Lakes Central Railroad': { cars: ['diesel', 'boxcar', 'tank'], speed: 6, horn: true,
    from: 'north', runs: [{ arr: 14 * 3600 + 30 * 60, dwell: 1200, days: '1111100' }] }
};

function buildRailways(group, crossings = [], wolverine = null) {
  const rail = GEO.rail;
  const result = { group, trains: [], update() {}, trackTop: () => -Infinity };
  if (!rail) return result;
  const bridges = [];

  // The track: one merged mesh of ballast, decks and rails, and the ties as one instanced mesh
  const quads = [];
  const ties = [];
  const cells = new Map(), CELL = 20, cellKey = (ix, iz) => ix * 100003 + iz;
  // the ground's pieces first, so each bridge can run level with the track at its two ends
  const groundPaths = new Map(), ends = [];
  for (const [flat, bridge] of rail.tracks) {
    if (bridge || flat.length < 4) continue;
    const p = railPath(flat, false);
    groundPaths.set(flat, p);
    const n = p.x.length - 1;
    ends.push([p.x[0], p.z[0], p.y[0]], [p.x[n], p.z[n], p.y[n]]);
  }
  const endAt = (x, z) => {
    let best = null, bd = 4;
    for (const [ex, ez, ey] of ends) {
      const d = Math.hypot(ex - x, ez - z);
      if (d < bd) { bd = d; best = ey; }
    }
    return best;
  };
  for (const [flat, bridge] of rail.tracks) {
    if (flat.length < 4) continue;
    const p = groundPaths.get(flat)
      || railPath(flat, true, 5, [endAt(flat[0], flat[1]), endAt(flat[flat.length - 2], flat[flat.length - 1])]);
    if (bridge) {
      p.box = [Math.min(...p.x) - 4, Math.max(...p.x) + 4, Math.min(...p.z) - 4, Math.max(...p.z) + 4];
      bridges.push(p);
    }
    // (over the river, river.js draws the deck and its piers: just the ties and rails on it here)
    trackGeometry(p, bridge && !p.river, quads, bridge && p.river);
    // its stretches on the ground, indexed for trackTop
    if (!bridge) {
      for (let i = 0; i + 1 < p.x.length; i++) {
        const seg = [p.x[i], p.z[i], p.x[i + 1], p.z[i + 1], p.y[i], p.y[i + 1]];
        const ix0 = Math.floor((Math.min(seg[0], seg[2]) - 3) / CELL), ix1 = Math.floor((Math.max(seg[0], seg[2]) + 3) / CELL);
        const iz0 = Math.floor((Math.min(seg[1], seg[3]) - 3) / CELL), iz1 = Math.floor((Math.max(seg[1], seg[3]) + 3) / CELL);
        for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
          const k = cellKey(ix, iz);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(seg);
        }
      }
    }
    const at = {};
    for (let s = 0.3; s < p.length; s += TIE_STEP) {
      sample(p, s, at);
      const b = {};
      sample(p, Math.min(p.length, s + 0.5), b);
      ties.push(at.x, at.y + (bridge ? 0.12 : 0.2), at.z, Math.atan2(b.x - at.x, b.z - at.z));
    }
    // piers under a bridge, every 18 m, down to the ground
    if (bridge) {
      for (let s = 9; s < p.length - 4; s += 18) {
        sample(p, s, at);
        const g = groundUnderStreets(at.x, at.z), h = at.y - 1.3 - g;
        // (none in a road the bridge crosses: there the deck stands over the road, deckTop above groundHeight)
        if (h < 0.8 || deckTop(at.x, at.z) - g > 3) continue;
        const b = {};
        sample(p, s + 0.5, b);
        const yaw = Math.atan2(b.x - at.x, b.z - at.z);
        quads.push(...pierQuads(at.x, g - 0.5, at.z, h + 0.5, yaw));
      }
    }
  }
  // How high something driving or walking over the track rides at (x, z): up on its ties and rails between the
  // ballast's shoulders, sloping down off them to the ground, or -Infinity away from it (controllers.js)
  // whether (x, z) is within r m of a track's middle (parked-cars.js keeps its cars off them)
  result.nearTrack = (x, z, r) => {
    const list = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const [x0, z0, x1, z1] of list) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
      if (Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < r) return true;
    }
    return false;
  };
  result.trackTop = (x, z) => {
    const list = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return -Infinity;
    let top = -Infinity;
    for (const [x0, z0, x1, z1, y0, y1] of list) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
      const o = Math.hypot(x - x0 - dx * t, z - z0 - dz * t);
      if (o >= 2.2) continue;
      const h = o <= 1.3 ? 0.36 : 0.36 * (2.2 - o) / 0.9;
      top = Math.max(top, y0 + (y1 - y0) * t + h);
    }
    return top;
  };
  const trackMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const TRACK_CELL = 600, trackCells = new Map();
  for (const [a, b, c, d, hex] of quads) {
    const key = Math.floor(a[0] / TRACK_CELL) * 10000 + Math.floor(a[2] / TRACK_CELL);
    let cell = trackCells.get(key);
    if (!cell) trackCells.set(key, (cell = { pos: [], col: [] }));
    const k = C(hex);
    cell.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) cell.col.push(k.r, k.g, k.b);
  }
  let firstTrack = null;
  for (const { pos, col } of trackCells.values()) {
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    trackGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    trackGeo.computeVertexNormals();
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.name = 'RailTrack';
    track.receiveShadow = true;
    track.userData.cullDistance = 900;
    if (firstTrack) track.userData.sharesPipelineWith = firstTrack;
    else firstTrack = track;
    group.add(track);
  }
  const tieGeo = new THREE.BoxGeometry(2.6, 0.16, 0.24).translate(0, 0.1, 0);
  const tieMesh = new THREE.InstancedMesh(tieGeo, new THREE.MeshStandardNodeMaterial({ color: 0x4a3b2e, roughness: 0.95 }), ties.length / 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (let i = 0; i < ties.length / 4; i++) {
    q.setFromAxisAngle(up, ties[i * 4 + 3]);
    tieMesh.setMatrixAt(i, m.compose(v.set(ties[i * 4], ties[i * 4 + 1], ties[i * 4 + 2]), q, one));
  }
  tieMesh.name = 'RailTies';
  tieMesh.receiveShadow = true;
  tieMesh.userData.cullDistance = 350;
  group.add(tieMesh);

  // The trains, one on each long line
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  const made = {};
  const carGeometry = (spec) => {
    if (made[spec]) return made[spec];
    const [kind, hex] = spec.split(':');
    const parts = [];
    // ':rev' a car turned round (the Wolverine's tail locomotive); else ':0x…' its colour
    const rev = hex === 'rev';
    const L = hex && !rev ? CAR_KINDS[kind](parts, Number(hex)) : CAR_KINDS[kind](parts);
    const geo = mergeGeometries(parts.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }), false);
    if (rev) geo.rotateY(Math.PI);
    return (made[spec] = { geo, L });
  };
  const trainsGroup = new THREE.Group();
  trainsGroup.name = 'Trains';
  group.add(trainsGroup);
  for (const [name, flat] of rail.routes || []) {
    const spec = TRAINS[name];
    if (!spec) continue;
    // a bridge on the route keeps its level deck, so the train doesn't dip under it
    const path = routePath(flat, bridges);
    const cars = spec.cars.map((c) => {
      const { geo, L } = carGeometry(c);
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = true;
      trainsGroup.add(mesh);
      return { mesh, L };
    });
    const length = cars.reduce((s, c) => s + c.L + 1, 0);
    const train = { name, path, cars, length, speed: spec.speed, wait: spec.wait, horn: spec.horn,
      s: Math.min(path.length - 1, length + (path.length - length) * 0.3), dir: 1, v: 0, waiting: 0, sinceHorn: 999 };
    // (a train on a timetable or runs starts off the line, out of sight, until its first update places it)
    if ((spec.timetable && wolverine?.trips?.length) || spec.runs) { train.s = -1e9; train.hidden = true; }
    if (spec.timetable && wolverine?.trips?.length) {
      // its platform: the point of the line nearest the Depot Street station, and which way along it is west
      let best = Infinity;
      const o = {};
      for (let s = 0; s < path.length; s += 2) {
        sample(path, s, o);
        const d = (o.x - STATION.x) ** 2 + (o.z - STATION.z) ** 2;
        if (d < best) { best = d; train.platform = s; }
      }
      const a = {}, b = {};
      sample(path, Math.max(0, train.platform - 50), a);
      sample(path, Math.min(path.length, train.platform + 50), b);
      train.west = b.x < a.x ? 1 : -1;
      train.timetable = wolverine.trips;
      train.moving = false;
    }
    if (spec.runs) {
      // a freight on its runs: which end of the line it comes in at (north is -z)
      const z0 = path.z[0], z1 = path.z[path.z.length - 1];
      train.inDir = (spec.from === 'south') === (z0 > z1) ? 1 : -1;
      train.runs = spec.runs;
    }
    train.hornAt = { x: 0, y: 0, z: 0, seed: 0.7 }; // where its horn is: the lead locomotive's cab
    train.blown = new Set(); // the crossings ahead it has sounded its horn for
    train.hornEnd = -Infinity;
    result.trains.push(train);
  }
  const at = {}, front = {}, back = {};
  const place = (train) => {
    // the train's head is at s, its cars behind it the other way from where it's going
    let s = train.s;
    for (const car of train.cars) {
      const mid = s - train.dir * car.L / 2;
      s -= train.dir * (car.L + 1);
      // a car past either end of the line isn't there yet (or any more): hidden one by one as each passes the end,
      // rather than heaped on its last point
      car.mesh.visible = mid >= 0 && mid <= train.path.length;
      if (!car.mesh.visible) continue;
      sample(train.path, mid + car.L * 0.35, front);
      sample(train.path, mid - car.L * 0.35, back);
      const fy = front.y, by = back.y; // (the route's own profile, its bridges' decks in it)
      const dx = front.x - back.x, dz = front.z - back.z, h = Math.hypot(dx, dz) || 1;
      car.mesh.position.set((front.x + back.x) / 2, (fy + by) / 2 + TOP - 0.02, (front.z + back.z) / 2);
      car.mesh.rotation.set(-Math.atan2(fy - by, h), Math.atan2(dx, dz), 0, 'YXZ'); // facing the way it was built
    }
  };
  // Braking into a stop and pulling away from it: how far from the stop the head is `tau` seconds before (ahead) or
  // after (gone), for a train whose line speed is V
  const BRAKE = 0.55, PULL = 0.4;
  const ahead = (V, tau) => tau < V / BRAKE ? 0.5 * BRAKE * tau * tau : V * V / (2 * BRAKE) + V * (tau - V / BRAKE);
  const gone = (V, tau) => tau < V / PULL ? 0.5 * PULL * tau * tau : V * V / (2 * PULL) + V * (tau - V / PULL);
  const hide = (t) => {
    t.s = -1e9; // gates stay up
    t.v = 0;
    t.hidden = true;
    for (const car of t.cars) car.mesh.visible = false;
    t.moving = false;
  };
  // Where the clock puts it (s, going v along dir), eased there: between the clock's whole seconds the train carries
  // on at its speed, so it never moves in steps. Hidden once wholly off the line. `pushPull`: a change of direction
  // reverses the cars (the last car leads); else the engines have run round the train and lead again.
  const settle = (t, dt, s, v, dir, key, sec, pushPull, onHorn) => {
    if (dir !== t.dir) { t.dir = dir; if (pushPull) t.cars.reverse(); }
    if (t.stopKey === key && Math.abs(s - t.s) < 40) t.s += Math.max(-4, Math.min(4, s + dir * v * (t.frac = (t.frac || 0) + dt) - t.s)) * Math.min(1, dt * 8);
    else t.s = s;
    if (t.lastSec !== sec) { t.lastSec = sec; t.frac = 0; }
    t.stopKey = key;
    const inside = t.s - dir * t.length > -50 && t.s - dir * t.length < t.path.length + 50 && t.s > -50 && t.s < t.path.length + 50;
    if (!inside) { hide(t); return; }
    t.hidden = false;
    t.v = v;
    t.waiting = v === 0 ? 1 : 0;
    // two short blasts as it sets off from a stop (on the line, not coming in at its end)
    if (t.horn && onHorn && v > 0 && t.moving === false && t.wasStopped) { sample(t.path, t.s, t.hornAt); t.hornAt.y += 4; onHorn(t.hornAt, 0, 'start'); }
    t.wasStopped = v === 0;
    t.moving = v > 0;
    place(t);
  };
  // A train on Amtrak's timetable: the stop at Ann Arbor in service today nearest the time now puts
  // it braking down the line toward the platform, standing there between its arrival and departure, or pulling away;
  // with no train due it is off the end of the line, out of sight
  const runTimetable = (t, dt, onHorn) => {
    const now = localTime(Date.now());
    let stop = null, into = Infinity;
    for (const trip of t.timetable) {
      const [, , , arr, dep, days, from, to] = trip;
      if (now.date < from || now.date > to || days[now.weekday] !== '1') continue;
      // seconds after its arrival (negative before it), looked at within the time it takes to cross the line
      const since = now.sec - arr;
      if (since < -RUN_WINDOW || now.sec - dep > RUN_WINDOW) continue;
      if (Math.abs(since) < Math.abs(into)) { into = since; stop = trip; }
    }
    if (!stop) { hide(t); return; }
    const [, way, , arr, dep] = stop;
    const dir = way === 'west' ? t.west : -t.west;
    // the head stops with the train along the platform
    const stopAt = t.platform + dir * t.length * 0.5;
    const V = t.speed;
    let s, v;
    if (now.sec < arr) { const tau = arr - now.sec; s = stopAt - dir * ahead(V, tau); v = Math.min(V, BRAKE * tau); }
    else if (now.sec < dep) { s = stopAt; v = 0; }
    else { const tau = now.sec - dep; s = stopAt + dir * gone(V, tau); v = Math.min(V, PULL * tau); }
    settle(t, dt, s, v, dir, stop, now.sec, true, onHorn);
  };
  // A freight on its runs (TRAINS `runs`): in from its end of the line at line speed, braking to a stop near the far
  // end, switching there, and out again with its engines leading, off the end; out of sight between runs
  const runFreight = (t, dt, onHorn) => {
    const now = localTime(Date.now());
    const V = t.speed, P = t.path.length, dirIn = t.inDir;
    const stopAt = dirIn > 0 ? P - 15 : 15;
    const tIn = (P + 100) / V + V / BRAKE, tOut = (P + t.length + 100) / V + V / PULL;
    let run = null, sec = 0;
    for (const r of t.runs) {
      // today's run, or yesterday's still going after midnight
      for (const [day, offset] of [[now.weekday, 0], [(now.weekday + 6) % 7, 86400]]) {
        const x = now.sec + offset;
        if (r.days[day] === '1' && x > r.arr - tIn && x < r.arr + r.dwell + tOut) { run = r; sec = x; }
      }
    }
    if (!run) { hide(t); return; }
    const dep = run.arr + run.dwell;
    let s, v, dir;
    if (sec < run.arr) { const tau = run.arr - sec; s = stopAt - dirIn * ahead(V, tau); v = Math.min(V, BRAKE * tau); dir = dirIn; }
    else if (sec < dep) { s = stopAt; v = 0; dir = dirIn; }
    // run round: the engines at what was the back, heading out
    else { const tau = sec - dep; dir = -dirIn; s = stopAt - dirIn * t.length + dir * gone(V, tau); v = Math.min(V, PULL * tau); }
    settle(t, dt, s, v, dir, run, now.sec, false, onHorn);
  };
  for (const t of result.trains) place(t);
  const gates = buildCrossingGates(group, crossings, rail, result.trains);
  result.crossings = gates.list || [];

  // The horn for the crossings ahead (49 CFR 222.21; Ann Arbor has no quiet zone): 15 to 20 s before the lead engine
  // reaches each public crossing, long, long, short, long, the last held until it's there. Crossings close together
  // (each reached within 8 s of the one before) share one call, its last blast held through them all, as an engineer
  // does downtown; a crossing it will reach while the horn's still blowing is covered by it; one too near for the whole
  // call when the horn falls quiet gets one long blast.
  let clock = 0;
  const LEAD_TIME = 17, CHAIN = 8, HOLD_MAX = 30;
  const coming = [];
  const hornAhead = (t, k, onHorn) => {
    if (!t.horn || !onHorn || t.hidden) return;
    if (t.v < 0.5) { t.blown.clear(); return; }
    coming.length = 0;
    for (const c of result.crossings) {
      const s = c.at[k];
      if (s === null) continue;
      const d = (s - t.s) * t.dir;
      if (d <= 0) { t.blown.delete(c); continue; }
      if (t.blown.has(c)) continue;
      const eta = d / Math.max(t.v, 2);
      if (clock + eta <= t.hornEnd + 1.5) { t.blown.add(c); continue; }
      if (eta < LEAD_TIME + HOLD_MAX) coming.push({ c, eta });
    }
    if (clock < t.hornEnd || !coming.length) return;
    coming.sort((a, b) => a.eta - b.eta);
    if (coming[0].eta > LEAD_TIME) return;
    let n = 1;
    while (n < coming.length && coming[n].eta - coming[n - 1].eta < CHAIN && coming[n].eta < HOLD_MAX) n++;
    const hold = coming[n - 1].eta, first = coming[0].c;
    const kind = coming[0].eta > HORN_PATTERN + 1.5 ? 'crossing' : 'long';
    sample(t.path, t.s, t.hornAt); t.hornAt.y += 4;
    onHorn(t.hornAt, hold, kind);
    t.hornEnd = clock + hold;
    for (let i = 0; i < n; i++) t.blown.add(coming[i].c);
    console.log(`[rail] horn: ${t.name} ${kind === 'crossing' ? 'long-long-short-long' : 'long'} for the crossing at (${first.x.toFixed(0)}, ${first.z.toFixed(0)}), ${coming[0].eta.toFixed(1)} s ahead at ${(t.v * 2.237).toFixed(0)} mph${n > 1 ? `, held ${hold.toFixed(1)} s through ${n} crossings` : ''}`);
  };

  // Each frame: every train where its timetable or runs put it (a train with no timetable runs back and forth: it
  // accelerates toward the line speed, slows to a stop at the end of the line, waits, and goes back); its horn for the
  // crossings ahead; the gates; and the crossing bells (`onBells` gets the crossings, each `on` while its lamps flash)
  result.update = (dt, onHorn, onBells) => {
    clock += dt;
    result.trains.forEach((t, k) => {
      if (t.timetable) runTimetable(t, dt, onHorn);
      else if (t.runs) runFreight(t, dt, onHorn);
      else if (t.waiting > 0) {
        t.waiting -= dt;
        if (t.waiting <= 0) {
          // back the way it came: the last car leads now (Amtrak runs push-pull), the cars where they stood
          t.s -= t.dir * t.length;
          t.dir = -t.dir;
          t.cars.reverse();
          if (t.horn && onHorn) { sample(t.path, t.s, t.hornAt); t.hornAt.y += 4; onHorn(t.hornAt, 0, 'start'); }
        }
      } else {
        const left = t.dir > 0 ? t.path.length - t.s : t.s;
        const target = Math.min(t.speed, Math.sqrt(Math.max(0, left - 2) * 2 * 0.35));
        t.v += Math.max(-1.2 * dt, Math.min(0.35 * dt, target - t.v));
        t.s += t.dir * t.v * dt;
        if (left < 2.5 && t.v < 0.3) { t.v = 0; t.waiting = t.wait; t.s = t.dir > 0 ? t.path.length : 0; }
        place(t);
      }
      if (!t.hidden) { sample(t.path, t.s, t.hornAt); t.hornAt.y += 4; }
      hornAhead(t, k, onHorn);
    });
    gates.update(dt);
    if (onBells && result.crossings.length) onBells(result.crossings);
  };
  return result;
}

// --- Crossing gates where a street crosses the tracks at grade (rail-crossings.json, OpenStreetMap's level crossings):
// on each side of the tracks, at the curb on the right of the traffic coming up to them, a mast with a crossbuck, two
// red lamps and a red and white striped arm across the lanes. When a train comes within about 160 m, the lamps flash
// in turn and the arms come down; once it has passed they go up again.
const ARM_UP = 1.45, ARM_DOWN = 0.03, LEAD = 160;
function buildCrossingGates(group, crossings, rail, trains) {
  const none = { update() {} };
  const G = GEO.roadGraph;
  if (!crossings.length || !G) return none;
  // the streets' and the main tracks' straight pieces near each crossing
  const N = G.nodes;
  const near = (x, z, x0, z0, x1, z1) => {
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
    return Math.hypot(x0 + dx * t - x, z0 + dz * t - z);
  };
  const closest = (x, z, lines, max) => {
    let best = null, bd = max;
    for (const { pts, data } of lines) {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        if (Math.abs(pts[i] - x) > max + 200 && Math.abs(pts[i + 2] - x) > max + 200) continue;
        const d = near(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
        if (d < bd) {
          const dx = pts[i + 2] - pts[i], dz = pts[i + 3] - pts[i + 1], L = Math.hypot(dx, dz) || 1;
          bd = d; best = { dx: dx / L, dz: dz / L, data };
        }
      }
    }
    return best;
  };
  const streets = [];
  for (const [a, b, , w, , , flat, cls] of G.links) {
    if (cls === 0) continue;
    streets.push({ pts: [N[a * 2], N[a * 2 + 1], ...flat, N[b * 2], N[b * 2 + 1]], data: w });
  }
  const tracks = rail.tracks.filter(([flat, bridge]) => !bridge && flat.length >= 4).map(([flat]) => ({ pts: flat, data: 0 }));

  const posts = [], list = [];
  for (let i = 0; i + 2 < crossings.length; i += 3) {
    const x = crossings[i], z = crossings[i + 1], gated = crossings[i + 2];
    const road = closest(x, z, streets, 14), track = closest(x, z, tracks, 10);
    if (!road || !track) continue;
    if (list.some((c) => Math.hypot(c.x - x, c.z - z) < 18)) continue; // two tracks side by side: one pair of gates
    const sin = Math.abs(road.dx * track.dz - road.dz * track.dx);
    if (sin < 0.25) continue;
    const half = Math.min(9, Math.max(3.5, road.data / 2));
    const D = Math.min(16, 4.2 / sin + 1.5);
    const rx = -road.dz, rz = road.dx; // the right of travel along the street's direction
    // (D: how far either side of the crossing along the street its gates stand, where traffic.js holds cars and walkers)
    const c = { x, y: groundHeight(x, z), z, gated, on: false, t: 0, arm: ARM_UP, at: trains.map(() => null), first: posts.length, D, dx: road.dx, dz: road.dz };
    for (const side of [1, -1]) {
      // traffic heading `side` along the street meets this gate before the tracks
      const px = x - side * road.dx * D + side * rx * (half + 0.7), pz = z - side * road.dz * D + side * rz * (half + 0.7);
      const ax = -side * rx, az = -side * rz; // the arm reaches back over the lanes
      posts.push({ x: px, y: groundHeight(px, pz), z: pz, yaw: Math.atan2(-az, ax), len: Math.min(half + 0.2, 8.5) });
    }
    // where on each train's line this crossing is
    trains.forEach((t, k) => {
      const p = t.path;
      let bd = 12, bs = null;
      for (let j = 0; j < p.x.length; j++) {
        const d = Math.hypot(p.x[j] - x, p.z[j] - z);
        if (d < bd) { bd = d; bs = p.d[j]; }
      }
      c.at[k] = bs;
    });
    list.push(c);
  }
  if (!list.length) return none;

  // the masts: a pole, a crossbuck, a crossbar with two lamps' hoods, and the arm's counterweight box
  const parts = [
    box(0.16, 4.0, 0.16, 0, 2.0, 0, 0xd9d9d6),
    box(0.5, 0.5, 0.4, 0.15, 1.05, 0, 0x3a3a3a),
    box(1.1, 0.12, 0.08, 0, 2.45, -0.1, 0x1c1c1c),
    box(0.34, 0.34, 0.06, -0.38, 2.45, -0.15, 0x111111),
    box(0.34, 0.34, 0.06, 0.38, 2.45, -0.15, 0x111111),
    box(0.4, 0.35, 0.1, 0, 3.05, -0.1, 0x111111),
    tinted(new THREE.BoxGeometry(1.5, 0.22, 0.03).rotateZ(Math.PI / 4).translate(0, 3.6, -0.12), 0xf4f4f0),
    tinted(new THREE.BoxGeometry(1.5, 0.22, 0.03).rotateZ(-Math.PI / 4).translate(0, 3.6, -0.13), 0xf4f4f0)
  ];
  const strip = (g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
  const postGeo = mergeGeometries(parts.map(strip), false);
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6 });
  const postMesh = new THREE.InstancedMesh(postGeo, mat, posts.length);
  // the arm: 1 m long from its pivot along +x, in red and white stripes, stretched to each street's width
  const armParts = [];
  for (let k = 0; k < 8; k++) armParts.push(box(0.125, 0.09, 0.07, (k + 0.5) / 8, 0, 0, k % 2 ? 0xf4f4f0 : 0xc81e1e));
  const armMesh = new THREE.InstancedMesh(mergeGeometries(armParts.map(strip), false), mat, posts.length);
  // the lamps, lit by their own colour
  const lampMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.15, 12), new THREE.MeshBasicNodeMaterial(), posts.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1), sc = new THREE.Vector3();
  const OFF = new THREE.Color(0x2a0606), ON = new THREE.Color(0xff3020).multiplyScalar(8);
  posts.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    postMesh.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q, one));
    for (const s of [0, 1]) {
      const lx = s ? 0.38 : -0.38;
      v.set(lx, 2.45, -0.19).applyQuaternion(q).add(new THREE.Vector3(p.x, p.y, p.z));
      q2.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI));
      lampMesh.setMatrixAt(i * 2 + s, m.compose(v, q2, one));
      lampMesh.setColorAt(i * 2 + s, OFF);
    }
  });
  const placeArm = (i, angle) => {
    const p = posts[i];
    q.setFromAxisAngle(up, p.yaw).multiply(q2.setFromAxisAngle(zAxis, angle));
    v.set(0.35, 1.05, 0).applyAxisAngle(up, p.yaw);
    armMesh.setMatrixAt(i, m.compose(v.set(p.x + v.x, p.y + 1.05, p.z + v.z), q, sc.set(p.len, 1, 1)));
  };
  posts.forEach((p, i) => placeArm(i, ARM_UP));
  for (const mesh of [postMesh, armMesh, lampMesh]) { mesh.castShadow = mesh !== lampMesh; mesh.receiveShadow = true; group.add(mesh); }
  postMesh.name = 'CrossingGates';
  armMesh.name = 'CrossingArms';
  lampMesh.name = 'CrossingLamps';

  let clock = 0;
  return {
    list,
    update(dt) {
      clock += dt;
      let armsMoved = false, lampsChanged = false;
      for (const c of list) {
        // a train on the crossing, or coming up to it
        let on = false;
        trains.forEach((t, k) => {
          const s = c.at[k];
          if (s === null || on) return;
          const tail = t.s - t.dir * t.length;
          let lo = Math.min(t.s, tail) - 10, hi = Math.max(t.s, tail) + 10;
          if (t.waiting <= 0) { if (t.dir > 0) hi += LEAD; else lo -= LEAD; }
          on = s >= lo && s <= hi;
        });
        if (on || c.on) {
          // lamps flash in turn while it's down, and for a moment after
          c.t = on ? 3 : c.t - dt;
          const lit = c.t > 0;
          const phase = Math.floor(clock * 2) % 2;
          for (const i of [c.first, c.first + 1]) {
            lampMesh.setColorAt(i * 2, lit && phase === 0 ? ON : OFF);
            lampMesh.setColorAt(i * 2 + 1, lit && phase === 1 ? ON : OFF);
          }
          lampsChanged = true;
          if (lit !== c.on) console.log(`[rail] crossing (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) ${lit ? "lamps flash, bell rings" : "clear"}`);
          c.on = lit;
        }
        const want = on && c.gated ? ARM_DOWN : ARM_UP;
        if (c.arm !== want) {
          const speed = 0.6 * dt; // about 2.5 s to swing
          c.arm = want < c.arm ? Math.max(want, c.arm - speed) : Math.min(want, c.arm + speed);
          placeArm(c.first, c.arm);
          placeArm(c.first + 1, c.arm);
          armsMoved = true;
        }
      }
      if (armsMoved) armMesh.instanceMatrix.needsUpdate = true;
      if (lampsChanged && lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
    }
  };
}

function pierQuads(x, y, z, h, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (a, b, yy) => [x + a * c + b * s, y + yy, z - a * s + b * c];
  const w = 2.4, d = 0.7, hex = 0x8d877c;
  const out = [];
  const corners = [[-w, -d], [w, -d], [w, d], [-w, d]];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = corners[i], [a1, b1] = corners[(i + 1) % 4];
    out.push([P(a0, b0, 0), P(a1, b1, 0), P(a1, b1, h), P(a0, b0, h), hex]);
  }
  return out;
}

export { buildRailways };
