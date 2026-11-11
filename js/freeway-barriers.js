// js/freeway-barriers.js
// The freeways' roadside barriers, as Michigan's are: steel W-beam guardrail on posts where something stands by the
// shoulder or the ground falls away, a high-tension cable barrier down the wide grass medians of US-23 and I-94, and
// a concrete barrier in a narrow median. Open shoulders elsewhere. Placed from the road graph's freeways and ramps
// (GEO.roadGraph, as city-config.js's freewayAt has them), the bridges' decks (terrain.js) and the ground:
//   - W-beam along a carriageway's shoulders 45 m either side of where it passes under a bridge (its piers, bents
//     and abutments), and 40 m on from each end of its own bridge, where the deck's barrier begins;
//   - W-beam where the ground beside the shoulder falls more than 2 m (an embankment), and round the outside of a
//     ramp's curve tighter than 150 m (the cloverleaf loops);
//   - cable barrier down the middle of a grass median over 10 m wide on US-23 and I-94, concrete in one under 6 m;
//   - never across another road (a ramp merging, a street at a junction): a barrier stops where another road's
//     surface begins; a guardrail's ends turned down to the ground over its last 4 m.
// Merged into 300 m tiles per material, culled by distance (scene-culling.js, TIER.farCut). Solid to the player's car
// (thin oriented boxes, as the bridges' parapets: the car scrapes along them); traffic keeps to its lanes. The posts
// carry small amber reflectors, a faint glow at night.

import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { groundHeight, deckTop, streetDeckTop } from './terrain.js';
import { TIER } from './device-tier.js';
import { log } from '../lamp-game.js';

const STEP = 2;             // metres between samples along a carriageway
const OUT = 0.7;            // a barrier's line past the road's edge (GEO's width takes in the shoulders)
const NEAR_BRIDGE = 45;     // guardrail either side of a bridge over the carriageway
const ON_APPROACH = 40;     // and on from the ends of its own bridge
const DROP = 2;             // the fall beside the shoulder that wants a guardrail
const TIGHT = 1 / 150;      // a ramp's curvature (1/radius) that wants one round its outside
const MIN_RUN = 20;         // the shortest run worth a barrier
const CELL = 40;
const TILE = 300;
const LEAN = TIER.name === 'phone';

// The freeways' carriageways (cls 0) and the ramps joined to them (cls 5), as city-config.js's FREEWAY_PIECES:
// [{ name, w, dir, cls, pts: [[x, z]...] }]
function freewayLinks() {
  const RG = GEO.roadGraph;
  if (!RG) return [];
  const N = RG.nodes, freeway = RG.links.map((l) => l[7] === 0), at = new Map();
  RG.links.forEach((l, i) => { for (const n of [l[0], l[1]]) { if (!at.has(n)) at.set(n, []); at.get(n).push(i); } });
  const queue = RG.links.map((_, i) => i).filter((i) => freeway[i]);
  while (queue.length) {
    const l = RG.links[queue.pop()];
    for (const n of [l[0], l[1]]) for (const j of at.get(n)) if (!freeway[j] && RG.links[j][7] === 5) { freeway[j] = true; queue.push(j); }
  }
  const out = [];
  RG.links.forEach(([a, b, ni, w, , dir, inner, cls], i) => {
    if (!freeway[i]) return;
    const pts = [[N[a * 2], N[a * 2 + 1]]];
    for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
    pts.push([N[b * 2], N[b * 2 + 1]]);
    out.push({ id: i, name: RG.names[ni] || '', w, dir, cls, pts });
  });
  return out;
}

// Every drivable road's surface in 40 m cells, [ax, az, bx, bz, half width, link index], so a barrier stops where
// another road begins
function roadCells() {
  const RG = GEO.roadGraph, N = RG.nodes, cells = new Map();
  RG.links.forEach(([a, b, , w, , , inner], i) => {
    const pts = [N[a * 2], N[a * 2 + 1], ...inner, N[b * 2], N[b * 2 + 1]];
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const seg = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3], w / 2, i], r = w / 2 + 2;
      for (let cx = Math.floor((Math.min(seg[0], seg[2]) - r) / CELL); cx <= Math.floor((Math.max(seg[0], seg[2]) + r) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(seg[1], seg[3]) - r) / CELL); cz <= Math.floor((Math.max(seg[1], seg[3]) + r) / CELL); cz++) {
          const key = cx * 65536 + cz;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(seg);
        }
      }
    }
  });
  return cells;
}
const segDist = (x, z, [ax, az, bx, bz]) => {
  const ex = bx - ax, ez = bz - az, u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(ax + ex * u - x, az + ez * u - z);
};
// whether (x, z) lies on a road other than link `own` (within its half width and `pad`)
const onOtherRoad = (cells, x, z, own, pad = 0.4) => (cells.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || [])
  .some((s) => s[5] !== own && segDist(x, z, s) < s[4] + pad);

// A link's line sampled every STEP m: { x, z, tx, tz (its way), s, k (curvature, + turning left) }
function sample(pts) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L / STEP));
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n, tx: (bx - ax) / L, tz: (bz - az) / L, s: s + L * k / n });
    s += L;
  }
  const last = pts.at(-1);
  if (out.length) out.push({ x: last[0], z: last[1], tx: out.at(-1).tx, tz: out.at(-1).tz, s });
  // curvature over ~20 m either way
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 10)], b = out[Math.min(out.length - 1, i + 10)];
    const da = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx), turn = Math.atan2(Math.sin(da), Math.cos(da));
    out[i].k = b.s - a.s > 4 ? -turn / (b.s - a.s) : 0; // (z is south: a turn to the left is negative in atan2's sense)
  }
  return out;
}

// The opposite carriageway across a median from a one-way link's sample, to its left: { d (centre to centre), w }
function acrossMedian(links, cellsOf, L, p) {
  const lx = p.tz, lz = -p.tx; // (left of its way, z being south: (tz, -tx))
  let best = null;
  for (const o of cellsOf(p.x + lx * 30, p.z + lz * 30)) {
    if (o.link === L || o.link.cls !== 0 || o.link.dir === 0) continue;
    const ex = o.bx - o.ax, ez = o.bz - o.az, el = Math.hypot(ex, ez) || 1;
    if ((ex * p.tx + ez * p.tz) / el > -0.9) continue; // (running the other way)
    const u = Math.max(0, Math.min(1, ((p.x - o.ax) * ex + (p.z - o.az) * ez) / (el * el)));
    const qx = o.ax + ex * u, qz = o.az + ez * u, side = (qx - p.x) * lx + (qz - p.z) * lz, d = Math.hypot(qx - p.x, qz - p.z);
    if (side < d * 0.9 || d > 70) continue;
    if (!best || d < best.d) best = { d, w: o.link.w, link: o.link };
  }
  return best;
}

function buildFreewayBarriers(group) {
  const began = performance.now();
  const links = freewayLinks();
  const roads = roadCells();
  // the freeway links' segments in 60 m cells, for the median's other side
  const fcells = new Map();
  for (const L of links) {
    for (let i = 0; i + 1 < L.pts.length; i++) {
      const [ax, az] = L.pts[i], [bx, bz] = L.pts[i + 1], seg = { link: L, ax, az, bx, bz };
      for (let cx = Math.floor((Math.min(ax, bx) - 70) / 60); cx <= Math.floor((Math.max(ax, bx) + 70) / 60); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - 70) / 60); cz <= Math.floor((Math.max(az, bz) + 70) / 60); cz++) {
          const key = cx * 65536 + cz;
          if (!fcells.has(key)) fcells.set(key, []);
          fcells.get(key).push(seg);
        }
      }
    }
  }
  const cellsOf = (x, z) => fcells.get(Math.floor(x / 60) * 65536 + Math.floor(z / 60)) || [];

  const runs = { guard: [], cable: [], concrete: [] }; // [[{x, y, z}...]]
  const pushRuns = (list, flags, pts) => {
    // runs of flagged samples (gaps of a sample closed), at least MIN_RUN long
    let cur = [];
    const flush = () => {
      if (cur.length >= 2) {
        let len = 0;
        for (let i = 1; i < cur.length; i++) len += Math.hypot(cur[i].x - cur[i - 1].x, cur[i].z - cur[i - 1].z);
        if (len >= MIN_RUN) list.push(cur);
      }
      cur = [];
    };
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] || (flags[i - 1] && flags[i + 1] && pts[i])) { if (pts[i]) cur.push(pts[i]); else flush(); } else flush();
    }
    flush();
  };

  for (const L of links) {
    const S = sample(L.pts);
    if (S.length < 3) continue;
    const half = L.w / 2;
    // the road's height along it (on its own bridge, the deck's), and where it's under a bridge or on its own
    const roadY = [], under = [], ownDeck = [];
    for (const p of S) {
      const top = streetDeckTop(p.x, p.z, L.name);
      const g = groundHeight(p.x, p.z);
      ownDeck.push(top !== null && top - g > 0.5);
      roadY.push(top ?? g);
      under.push(top === null && deckTop(p.x, p.z) - g > 3);
    }
    // every sample within `reach` m along of a flagged one
    const nearAlong = (flags, reach) => {
      const out = S.map(() => false);
      for (let j = 0; j < S.length; j++) {
        if (!flags[j]) continue;
        for (let i = j; i >= 0 && S[j].s - S[i].s <= reach; i--) out[i] = true;
        for (let i = j; i < S.length && S[i].s - S[j].s <= reach; i++) out[i] = true;
      }
      return out;
    };
    const nearBridge = nearAlong(under, NEAR_BRIDGE);
    const nearOwn = nearAlong(ownDeck, ON_APPROACH);
    // the median to its left (a one-way carriageway)
    const median = S.map((p) => (L.dir !== 0 && L.cls === 0 ? acrossMedian(links, cellsOf, L, p) : null));
    for (const side of [1, -1]) { // 1 its left, -1 its right
      const flags = [], pts = [];
      for (let i = 0; i < S.length; i++) {
        const p = S[i], lx = p.tz * side, lz = -p.tx * side, o = half + OUT;
        const x = p.x + lx * o, z = p.z + lz * o;
        const m = side === 1 ? median[i] : null;
        // (on its own bridge the deck's own barrier; across another road, none)
        if (ownDeck[i] || onOtherRoad(roads, x, z, L.id)) { flags.push(false); pts.push(null); continue; }
        const y = roadY[i]; // (on the shoulder's edge, at the road's height)
        let want = nearBridge[i] || (nearOwn[i] && !ownDeck[i]);
        // a fall beside the shoulder (not into a median, where the far carriageway is)
        if (!m) {
          const g4 = groundHeight(x + lx * 4, z + lz * 4), g8 = groundHeight(x + lx * 8, z + lz * 8);
          if (roadY[i] - Math.min(g4, g8) > DROP) want = true;
        }
        // round the outside of a tight ramp curve (curving away from this side)
        if (L.cls === 5 && Math.abs(p.k) > TIGHT && Math.sign(p.k) === -side) want = true;
        // in a median the cable or concrete barrier stands instead, but a pier there still wants its guardrail
        if (m && !(nearBridge[i] && m.d - (half + m.w / 2) > 6)) want = false;
        flags.push(want);
        pts.push({ x, y, z, nx: lx, nz: lz });
      }
      pushRuns(runs.guard, flags, pts);
    }
    // the median's own barrier, laid once (from the link of the two with the lower id), down its middle
    if (L.dir !== 0 && L.cls === 0) {
      for (const kind of ['cable', 'concrete']) {
        const flags = [], pts = [];
        for (let i = 0; i < S.length; i++) {
          const m = median[i], p = S[i];
          if (!m || m.link.id < L.id || ownDeck[i]) { flags.push(false); pts.push(null); continue; }
          const width = m.d - (half + m.w / 2);
          const want = kind === 'concrete' ? width < 6 && width > 0.8 : width > 10 && /US 23|I 94/.test(L.name);
          const mx = p.x + p.tz * (half + width / 2), mz = p.z - p.tx * (half + width / 2);
          if (!want || onOtherRoad(roads, mx, mz, L.id, 0.2)) { flags.push(false); pts.push(null); continue; }
          flags.push(true);
          pts.push({ x: mx, y: groundHeight(mx, mz), z: mz, nx: p.tz, nz: -p.tx });
        }
        pushRuns(runs[kind], flags, pts);
      }
    }
  }

  // each run once (a carriageway the map has twice laid its median's barrier twice), and thinned where it runs straight
  // and even: a point kept where the line turns more than half a degree, or the ground under a straight line between
  // kept points would stray 4 cm, or every 16 m
  for (const kind of Object.keys(runs)) {
    const seen = new Set();
    runs[kind] = runs[kind].filter((run) => {
      const key = [run[0], run.at(-1)].map((p) => `${Math.round(p.x / 5)},${Math.round(p.z / 5)}`).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((run) => {
      const out = [run[0]];
      let from = 0;
      for (let i = 2; i < run.length; i++) {
        const a = run[from], b = run[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        let keep = len > 16;
        for (let k = from + 1; k < i && !keep; k++) {
          const p = run[k], f = Math.hypot(p.x - a.x, p.z - a.z) / (len || 1);
          const off = Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / (len || 1);
          if (off > len * 0.0087 + 0.02 || Math.abs(a.y + (b.y - a.y) * f - p.y) > 0.04) keep = true;
        }
        if (keep) { out.push(run[i - 1]); from = i - 1; }
      }
      out.push(run.at(-1));
      return out;
    });
  }

  // ---- geometry, merged into 300 m tiles per material ----------------------------------------------------------------
  const tiles = new Map(); // `${kind}|${tile}` -> positions
  const put = (kind, x, z, ...tri) => {
    const key = `${kind}|${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(...tri);
  };
  const quad = (kind, a, b, c, d) => put(kind, a[0], a[2], ...a, ...b, ...c, ...a, ...c, ...d);
  const box = (kind, x, y, z, ux, uz, along, across, h) => {
    // a post standing at (x, y, z): `along` its run's way (ux, uz), `across` it, `h` tall (four sides and its top)
    const ax = ux * along / 2, az = uz * along / 2, cx = -uz * across / 2, cz = ux * across / 2;
    const c = [[x - ax - cx, z - az - cz], [x + ax - cx, z + az - cz], [x + ax + cx, z + az + cz], [x - ax + cx, z - az + cz]];
    for (let k = 0; k < 4; k++) {
      const p = c[k], q = c[(k + 1) % 4];
      quad(kind, [p[0], y, p[1]], [q[0], y, q[1]], [q[0], y + h, q[1]], [p[0], y + h, p[1]]);
    }
    quad(kind, [c[0][0], y + h, c[0][1]], [c[1][0], y + h, c[1][1]], [c[2][0], y + h, c[2][1]], [c[3][0], y + h, c[3][1]]);
  };
  const colliders = [];
  const solid = (a, b, across, h) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.2) return;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len, hx = len / 2, hz = across / 2;
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2, ex = Math.abs(ux) * hx + Math.abs(uz) * hz, ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: Math.min(a.y, b.y) - 0.3, maxY: Math.max(a.y, b.y) + h,
      obb: { cx, cz, hx, hz, cs: ux, sn: -uz }, thin: true });
  };
  // a run's colliders in straight pieces of up to 20 m
  const solids = (run, across, h) => {
    for (let i = 0; i + 1 < run.length;) {
      let j = i + 1;
      while (j + 1 < run.length && Math.hypot(run[j + 1].x - run[i].x, run[j + 1].z - run[i].z) < 20) j++;
      solid(run[i], run[j], across, h);
      i = j;
    }
  };
  const lengthOf = (run) => run.reduce((s, p, i) => s + (i ? Math.hypot(p.x - run[i - 1].x, p.z - run[i - 1].z) : 0), 0);
  let guardLen = 0, cableLen = 0, concreteLen = 0;

  // W-beam: its face a shallow W (three facets) 0.53 to 0.81 m up, the posts behind it every 1.9 m, ends turned down
  for (const run of runs.guard) {
    const total = lengthOf(run);
    guardLen += total;
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
    // its height at a point: down to the ground over the last 4 m of each end
    const drop = (s) => Math.min(1, Math.min(s, total - s) / 4);
    const face = [[0, 0.53], [0.05, 0.6], [-0.0, 0.67], [0.05, 0.74], [0, 0.81]];
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i], b = run[i + 1], fa = drop(cum[i]), fb = drop(cum[i + 1]);
      for (let k = 0; k + 1 < face.length; k++) {
        const [oa, ha] = face[k], [ob, hb] = face[k + 1];
        const P = (p, f, o, h) => [p.x - p.nx * o, p.y + (h - 0.81) + 0.81 * f - (1 - f) * 0.1, p.z - p.nz * o];
        quad('beam', P(a, fa, oa, ha), P(b, fb, oa, ha), P(b, fb, ob, hb), P(a, fa, ob, hb));
      }
    }
    // posts (fewer on a phone or the Xbox), each third with a reflector facing the road
    const every = LEAN ? 3.8 : 1.9;
    for (let s = 1, n = 0; s < total - 1; s += every, n++) {
      let i = 0;
      while (i + 2 < run.length && cum[i + 1] < s) i++;
      const f = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1), a = run[i], b = run[i + 1];
      const x = a.x + (b.x - a.x) * f + a.nx * 0.18, z = a.z + (b.z - a.z) * f + a.nz * 0.18, y = a.y + (b.y - a.y) * f;
      const ux = (b.x - a.x) / ((cum[i + 1] - cum[i]) || 1), uz = (b.z - a.z) / ((cum[i + 1] - cum[i]) || 1);
      box('post', x, y - 0.1, z, ux, uz, 0.15, 0.15, 0.82 * drop(s) + 0.05);
      if (!LEAN && n % 3 === 0 && drop(s) >= 1) {
        const rx = x - a.nx * 0.27, rz = z - a.nz * 0.27, h = y + 0.86, r = 0.05;
        quad('reflector', [rx - ux * r, h - r, rz - uz * r], [rx + ux * r, h - r, rz + uz * r], [rx + ux * r, h + r, rz + uz * r], [rx - ux * r, h + r, rz - uz * r]);
      }
    }
    solids(run, 0.3, 0.85);
  }
  // cable barrier: posts every 6 m, three cables at 0.5, 0.65 and 0.8 m
  for (const run of runs.cable) {
    cableLen += lengthOf(run);
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i], b = run[i + 1];
      for (const h of [0.5, 0.65, 0.8]) {
        quad('cable', [a.x, a.y + h, a.z], [b.x, b.y + h, b.z], [b.x, b.y + h + 0.025, b.z], [a.x, a.y + h + 0.025, a.z]);
      }
    }
    if (!LEAN) {
      for (let i = 0; i < run.length; i += 3) {
        const a = run[i], b = run[Math.min(run.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        box('cablePost', a.x, a.y - 0.05, a.z, (b.x - a.x) / l, (b.z - a.z) / l, 0.07, 0.07, 0.9);
      }
    }
    solids(run, 0.2, 0.9);
  }
  // concrete: the Jersey profile (city-grid.js's) both sides, its top, and its ends
  const JERSEY = [[0.3, 0], [0.3, 0.08], [0.19, 0.33], [0.08, 0.82]];
  for (const run of runs.concrete) {
    concreteLen += lengthOf(run);
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i], b = run[i + 1];
      const P = (p, o, h) => [p.x + p.nx * o, p.y + h, p.z + p.nz * o];
      for (const sd of [1, -1]) {
        for (let k = 0; k + 1 < JERSEY.length; k++) {
          const [w0, h0] = JERSEY[k], [w1, h1] = JERSEY[k + 1];
          quad('concrete', P(a, sd * w0, h0), P(b, sd * w0, h0), P(b, sd * w1, h1), P(a, sd * w1, h1));
        }
      }
      quad('concrete', P(a, -0.08, 0.82), P(b, -0.08, 0.82), P(b, 0.08, 0.82), P(a, 0.08, 0.82));
    }
    for (const p of [run[0], run.at(-1)]) {
      const P = (o, h) => [p.x + p.nx * o, p.y + h, p.z + p.nz * o];
      for (let k = 0; k + 1 < JERSEY.length; k++) {
        const [w0, h0] = JERSEY[k], [w1, h1] = JERSEY[k + 1];
        quad('concrete', P(-w0, h0), P(w0, h0), P(w1, h1), P(-w1, h1));
      }
    }
    solids(run, 0.6, 0.82);
  }

  const mats = {
    beam: [new THREE.MeshStandardNodeMaterial({ color: 0xa4abaf, metalness: 0.65, roughness: 0.42, side: THREE.DoubleSide }), 900],
    post: [new THREE.MeshStandardNodeMaterial({ color: 0x8c9396, metalness: 0.55, roughness: 0.5 }), 380],
    reflector: [new THREE.MeshStandardNodeMaterial({ color: 0xffb02e, emissive: 0xffa21a, emissiveIntensity: 0.35, roughness: 0.3, side: THREE.DoubleSide }), 380],
    cable: [new THREE.MeshStandardNodeMaterial({ color: 0x8a8f92, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide }), 320],
    cablePost: [new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a3, metalness: 0.5, roughness: 0.5 }), 320],
    concrete: [new THREE.MeshStandardNodeMaterial({ color: 0xb8b3aa, roughness: 0.92 }), 1100]
  };
  let tris = 0;
  for (const [key, pos] of tiles) {
    const [kind] = key.split('|'), [mat, cull] = mats[kind];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'FreewayBarrier-' + kind;
    mesh.castShadow = kind === 'beam' || kind === 'concrete';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = cull;
    mesh.userData.terrain = 'set'; // (laid at the ground's heights already)
    group.add(mesh);
    tris += pos.length / 9;
  }
  log(`[barriers] guardrail ${(guardLen / 1000).toFixed(1)} km in ${runs.guard.length} runs, cable ${(cableLen / 1000).toFixed(1)} km, concrete ${(concreteLen / 1000).toFixed(1)} km: ${group.children.length} meshes, ${Math.round(tris / 1000)}k triangles, ${colliders.length} colliders, in ${Math.round(performance.now() - began)} ms`);
  return { colliders };
}

export { buildFreewayBarriers };
