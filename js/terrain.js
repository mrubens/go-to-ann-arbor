// js/terrain.js
// The height of the ground over Ann Arbor, in metres above the street level the rest of the city was drawn at (y = 0),
// from data/elevation.bin.gz and, under the city, the finer data/ground.bin.gz (both made by Assets/Tools/build-ground.py
// from the USGS 3DEP 1 m bare-earth survey, Assets/Tools/fetch-3dep.py). Heights are 0 in the water and ease to 0
// near the shore, so whatever sits at the waterline (seawalls, waterfront highways, piers, bridge landings) stays
// where it was drawn.
//
// The city is built flat and then set on the ground (setOnTerrain): ground layers are cut finer and follow it
// vertex by vertex, and what stands on it (buildings, trees, lamps, benches) is lifted whole to the lowest ground
// under it, so nothing leans or floats. What moves asks groundHeight each frame.

import { gpuOnly } from './gpu-only.js';
import { b2bMissingBridges, b2bCrossings, onB2BBridge } from './b2b-route.js';
import * as THREE from 'three/webgpu';
import { float, texture, uniform, vec2, positionLocal, positionWorld, cameraPosition, normalize, abs, max, min } from 'three/tsl';
import { hot, asset, log, work } from '../lamp-game.js';
import { STADIUM, radiiAt, bowlSurface } from './stadium-shape.js';
import { GEO } from './city-geodata.js';
import { carveCascades, cascadeDepth, cascadeLevel } from './cascades.js';
import { baseHeight, digAt, levelAt, onDeck, BUCKET, bucketKey, drapeLayer, CORE_SOURCE, coreHeight, inCore, splitsOf, CORE_FLOOR } from './ground-core.js';
import { LIFT } from './ground-lifts.js';
import { TIER } from './device-tier.js';

let grid = null; // { x0, z0, step, cols, rows, heights: Float32Array }

// Lamp: kept while main.js runs again for a change (lamp-game.js, "Running the game's code again"), so the heights are
// read once; the parts of the city built on them name what this returns as one of their inputs.
async function loadTerrain(url = './data/elevation.bin.gz') {
  grid = await hot(import.meta).keep('heightsAndRiver', () => readHeights(url),
    { from: [url.replace(/^\.\//, ''), 'js/cascades.js', 'data/river.bin.gz', 'data/ground.bin.gz', 'js/ground-core.js', 'js/device-tier.js'] });
  return grid;
}

// Read through Lamp's runtime (asset()), so a change to the file builds the kept heights, and the city on them, again.
async function unzipped(url) {
  const packed = await asset(url);
  if (!packed) throw new Error('not found');
  // A server that sends .gz as Content-Encoding: gzip hands over bytes the browser has already inflated
  const head = new Uint8Array(packed, 0, 2);
  return head[0] === 0x1f && head[1] === 0x8b
    ? await new Response(new Response(packed).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : packed;
}

async function readHeights(url) {
  try {
    const bytes = await unzipped(url);
    if (new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== 'ELV2') throw new Error('unknown format');
    // lo: the lowest height (under the base, down the river east of town), which they're stored up from
    const [x0, z0, step, cols, rows, lo] = new Float32Array(bytes, 4, 6);
    const centimetres = new Uint16Array(bytes, 28, cols * rows);
    const heights = new Float32Array(cols * rows);
    for (let i = 0; i < heights.length; i++) heights[i] = centimetres[i] / 100 + lo;
    console.log(`[terrain] ${cols} × ${rows} heights at ${step} m`);
    const g = { x0, z0, step, cols, rows, heights };
    digBowl(g);
    g.river = await readRiver(g, './data/river.bin.gz');
    await readCore(g, './data/ground.bin.gz');
    // the bridges' decks once the city's fine ground is in, so each meets the street it carries where it really is
    if (g.river) {
      buildDecks(g, g.river);
      console.log(`[terrain] ${g.river.bridges.length} bridges`);
    }
    return g;
  } catch (error) {
    console.warn('[terrain] no ground heights, the city stays flat:', error);
    return null;
  }
}

// data/ground.bin.gz (GRD1, from build-ground.py): the city's ground on a 4 m grid from the USGS's 1 m survey, its
// streets graded level across, as each sample less the one before it in centimetres. The stadium's bowl and the river's
// bed are dug into it here, then it's made into one mesh of right triangles that strays no more than 10 cm from them
// (25 cm in its smallest triangles, about 11 m across and less, which are cut again only at a bank or a street's edge)
// (ground-core.js), which the ground layers are all cut along, and a coarser one for the ground under the city.
// (on an Xbox, within TIER.ground: device-tier.js)
const CORE_TOLERANCE = TIER.ground || 0.1, UNDER_TOLERANCE = TIER.ground ? 0.8 : 0.5, CORE_SMALLEST = 4, SMALL_STRAY = 2.5;
async function readCore(g, url) {
  try {
    const began = performance.now();
    const bytes = await unzipped(url);
    if (new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== 'GRD1') throw new Error('unknown format');
    const [x0, z0, step, n] = new Float32Array(bytes, 4, 4);
    const size = Math.round(n), delta = new Int16Array(bytes, 20, size * size), heights = new Float32Array(size * size);
    for (let i = 0, run = 0; i < heights.length; i++) { run += delta[i]; heights[i] = run / 100; }
    const fine = { x0, z0, step, cols: size, rows: size, heights };
    digBowl(fine);
    g.stadiumGround = fine.stadiumGround;
    const r = g.river;
    if (r) {
      const c0 = Math.max(0, Math.floor((r.dx0 - x0) / step)), c1 = Math.min(size - 1, Math.ceil((r.dx0 + r.dcols * r.dstep - x0) / step));
      const w0 = Math.max(0, Math.floor((r.dz0 - z0) / step)), w1 = Math.min(size - 1, Math.ceil((r.dz0 + r.drows * r.dstep - z0) / step));
      for (let w = w0; w <= w1; w++) for (let c = c0; c <= c1; c++) {
        const x = x0 + c * step, z = z0 + w * step, f = digAt(r, x, z);
        if (!(f > 0)) continue;
        const i = w * size + c, h = heights[i];
        const bed = cascadeLevel(x, z, levelAt(r, x, z)) - cascadeDepth(x, z, 1.8);
        if (bed < h) heights[i] = h + (bed - h) * f;
      }
    }
    const cm = new Uint16Array(size * size);
    for (let i = 0; i < cm.length; i++) cm[i] = Math.max(0, Math.min(65535, Math.round((heights[i] - CORE_FLOOR) * 100)));
    const core = { x0, z0, step, size, cm, split: null };
    [core.split, g.coreUnder] = splitsOf(core, [CORE_TOLERANCE, UNDER_TOLERANCE], CORE_SMALLEST, SMALL_STRAY);
    g.core = core;
    log(`[terrain] the city's ground ${size} × ${size} at ${step} m, in ${Math.round(performance.now() - began)} ms`);
  } catch (error) {
    console.warn('[terrain] no fine ground, the 10 m heights instead:', error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The Huron River, sunk into its banks, and the bridges over it
// ---------------------------------------------------------------------------------------------------------------------

// data/river.bin.gz (RIV1, from build-annarbor.py): how far each 2 m cell of the water is dug down towards the bed
// (0 at the shore to 1 a few metres out), and the water's level on a 10 m grid, a little under its lowest bank. The
// streets' and railways' bridges (GEO.riverBridges) carry their ground over the water on a deck from bank to bank, high
// enough over the water to pass under; footbridges' decks are drawn on their own (bridges.js).
async function readRiver(g, url) {
  try {
    const bytes = await unzipped(url);
    if (new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) !== 'RIV1') throw new Error('unknown format');
    const [dx0, dz0, dstep, dcols, drows, lx0, lz0, lstep, lcols, lrows] = new Float32Array(bytes, 4, 10);
    const n = dcols * drows;
    const dig = new Uint8Array(bytes, 44, n);
    const cm = new Int16Array(bytes, 44 + n + (n % 2), lcols * lrows); // under the base east of town
    const level = new Float32Array(cm.length);
    for (let i = 0; i < cm.length; i++) level[i] = cm[i] / 100;
    const r = { dx0, dz0, dstep, dcols, drows, dig, lx0, lz0, lstep, lcols, lrows, level, bridges: [], buckets: new Map() };
    carveCascades(r); // the Argo Cascades' channel, unbroken (cascades.js)
    joinUnderFootbridges(r);
    packDig(r);
    console.log(`[terrain] the river's bed ${dcols} × ${drows} at ${dstep} m`);
    return r;
  } catch (error) {
    console.warn('[terrain] no river bed:', error);
    return null;
  }
}

// The river's bridges (GEO.riverBridges), and (Lamp) the Border to Border Trail's own the map's river data left out
// (b2b-route.js: the Broadway Park footbridge, two short ones), as footbridges of their own
let BRIDGES = null;
const riverBridges = () => (BRIDGES ??= [...(GEO.riverBridges || []), ...b2bMissingBridges(GEO.riverBridges)]);

// The map's water stops short of a footbridge on each side (it's drawn as two ponds, not one channel under the bridge),
// so the channel under it is dug through: wherever open water lies within 18 m on both sides of the bridge, the bed
// runs across between them, easing up to the banks at the channel's sides. Each opening's outline goes in `r.gaps`,
// for the water's surface (city-grid.js riverGaps).
function joinUnderFootbridges(r) {
  r.gaps = [];
  const R = 18, OPEN = 170 / 255, EASE = 3;
  for (const b of riverBridges()) {
    if (b[0] !== 2) continue;
    for (let i = 2; i + 3 < b.length; i += 2) {
      const ax = b[i], az = b[i + 1], bx = b[i + 2], bz = b[i + 3], len = Math.hypot(bx - ax, bz - az);
      if (len < 1) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
      // at each metre along it: how far the open water is to either side
      const cut = [];
      for (let u = 0; u <= len; u += 1) {
        const px = ax + tx * u, pz = az + tz * u;
        let lo = null, hi = null;
        for (let v = 0; v <= R && (lo === null || hi === null); v += 1) {
          if (hi === null && digAt(r, px + nx * v, pz + nz * v) >= OPEN) hi = v;
          if (lo === null && digAt(r, px - nx * v, pz - nz * v) >= OPEN) lo = -v;
        }
        cut.push(lo !== null && hi !== null ? [u, lo, hi] : null);
      }
      // each run of them is one channel
      for (let k = 0; k < cut.length;) {
        if (!cut[k]) { k++; continue; }
        let e = k;
        while (e + 1 < cut.length && cut[e + 1]) e++;
        const run = cut.slice(k, e + 1), u0 = run[0][0], u1 = run.at(-1)[0];
        k = e + 1;
        // (only where the water's broken under it: over open water already there's nothing to dig)
        if (u1 - u0 < 2 || !run.some(([, lo, hi]) => hi - lo > 1)) continue;
        const across = (u) => run[Math.max(0, Math.min(run.length - 1, Math.round(u - u0)))];
        // the cells around it, each dug as deep as its place in the channel
        const pad = R + 2;
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - pad - r.dx0) / r.dstep)), c1 = Math.min(r.dcols - 1, Math.ceil((Math.max(ax, bx) + pad - r.dx0) / r.dstep));
        const w0 = Math.max(0, Math.floor((Math.min(az, bz) - pad - r.dz0) / r.dstep)), w1 = Math.min(r.drows - 1, Math.ceil((Math.max(az, bz) + pad - r.dz0) / r.dstep));
        for (let w = w0; w <= w1; w++) for (let c = c0; c <= c1; c++) {
          const x = r.dx0 + c * r.dstep - ax, z = r.dz0 + w * r.dstep - az, u = x * tx + z * tz, v = x * nx + z * nz;
          if (u < u0 - 0.5 || u > u1 + 0.5) continue;
          const [, lo, hi] = across(u);
          if (v < lo - 1 || v > hi + 1) continue;
          const side = Math.min(u - u0, u1 - u) / EASE, f = Math.max(0, Math.min(1, side + 0.34));
          const di = w * r.dcols + c;
          r.dig[di] = Math.max(r.dig[di], Math.round(255 * f * f * (3 - 2 * f)));
        }
        // its water's outline, from bank to bank across the bridge
        const left = [], right = [];
        for (const [u, lo, hi] of run) {
          left.push({ x: ax + tx * u + nx * (lo - 1), z: az + tz * u + nz * (lo - 1) });
          right.push({ x: ax + tx * u + nx * (hi + 1), z: az + tz * u + nz * (hi + 1) });
        }
        r.gaps.push([left.concat(right.reverse())]);
      }
    }
  }
  if (r.gaps.length) console.log(`[terrain] the channel dug through under ${r.gaps.length} footbridges`);
}

// The dug cells kept only in the 64 × 64 blocks that have water (digAt, ground-core.js): the river covers a few
// hundredths of its grid, so this keeps a few megabytes rather than the whole file's tens, which are let go
function packDig(r) {
  const B = 64, bcols = Math.ceil(r.dcols / B), brows = Math.ceil(r.drows / B);
  const blocks = new Array(bcols * brows).fill(null), present = new Uint8Array(bcols * brows);
  for (let bw = 0; bw < brows; bw++) for (let bc = 0; bc < bcols; bc++) {
    let block = null;
    for (let w = bw * B; w < Math.min(r.drows, bw * B + B); w++) {
      const row = w * r.dcols;
      for (let c = bc * B; c < Math.min(r.dcols, bc * B + B); c++) {
        const v = r.dig[row + c];
        if (v) (block ??= new Uint8Array(B * B))[(w - bw * B) * B + c - bc * B] = v;
      }
    }
    blocks[bw * bcols + bc] = block;
    present[bw * bcols + bc] = block ? 1 : 0;
  }
  r.dig = null;
  r.digBlocks = blocks;
  r.digPresent = present;
  r.bcols = bcols;
}

// The water's surface over the channels dug under footbridges, as outlines like the map's water's ({x, z} rings)
function riverGaps() {
  return grid?.river?.gaps || [];
}

// Each bridge's deck, sampled every 4 m along it: a street's (streetDeck), a railway's or a footbridge's (otherDeck).
// Ways the map splits along a bridge are joined first, so the deck runs whole from bank to bank.
function buildDecks(g, r) {
  const list = riverBridges().map((b) => {
    const pts = [];
    for (let i = 2; i + 1 < b.length; i += 2) pts.push([b[i], b[i + 1]]);
    return { kind: b[0], w: b[1], pts };
  }).filter((b) => b.pts.length >= 2);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
  for (let joined = true; joined;) {
    joined = false;
    for (let i = 0; i < list.length && !joined; i++) for (let j = 0; j < list.length && !joined; j++) {
      const a = list[i], b = list[j];
      if (i === j || a.kind !== b.kind) continue;
      const bp = near(a.pts.at(-1), b.pts[0]) ? b.pts : near(a.pts.at(-1), b.pts.at(-1)) ? [...b.pts].reverse() : null;
      if (!bp) continue;
      a.pts = a.pts.concat(bp.slice(1));
      a.w = Math.max(a.w, b.w);
      list.splice(j, 1);
      joined = true;
    }
  }
  // the ground the decks meet: the city's fine mesh where it's read (the streets as they're drawn), else the 10 m heights
  const gh = (x, z) => (g.core && inCore(g.core, x, z) ? coreHeight(g.core, x, z) : baseHeight(g, x, z));
  for (const b of list) {
    let made = b.kind === 0 ? streetDeck(g, r, b, gh) : otherDeck(g, r, b, gh);
    // Lamp: a footbridge whose deck crosses the Border to Border Trail too low to pass under (under 3.2 m) ends at the
    // trail's edge instead, its longer part kept (the span over the water): at Broadway the two footbridges' ramps
    // stood across the trail under the arches, a wall the rider was thrown off against
    const mid = b.pts[Math.floor(b.pts.length / 2)], mid2 = b.pts[Math.max(0, Math.floor(b.pts.length / 2) - 1)];
    if (b.kind === 2 && made && !onB2BBridge((mid[0] + mid2[0]) / 2, (mid[1] + mid2[1]) / 2)) { // (not one of the trail's own)
      const cut = trailCut(b.pts, made.deck, gh);
      if (cut) { b.pts = cut; made = otherDeck(g, r, b, gh); console.log(`[terrain] a footbridge ends at the B2B trail's edge (${cut[0].map(Math.round)} to ${cut.at(-1).map(Math.round)})`); }
    }
    if (!made) continue;
    const { S, deck } = made;
    r.bridges.push(deck);
    // a footbridge's deck isn't the ground (a kayak passes under it), but walkers and bikes go over it (footbridgeTop)
    const into = b.kind === 2 ? (r.footBuckets ??= new Map()) : r.buckets;
    for (let i = 0; i + 1 < S.length; i++) {
      const seg = { deck, a: deck.points[i], b: deck.points[i + 1] };
      // (a street's or railway's also 6 m beside it, for the ground's layers there: ground-core.js deckLayer)
      const pad = deck.half + (b.kind !== 2 ? 6 : 0);
      const x0 = Math.min(S[i][0], S[i + 1][0]) - pad, x1 = Math.max(S[i][0], S[i + 1][0]) + pad;
      const z0 = Math.min(S[i][1], S[i + 1][1]) - pad, z1 = Math.max(S[i][1], S[i + 1][1]) + pad;
      for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
        for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
          const key = bucketKey(bx, bz);
          if (!into.has(key)) into.set(key, []);
          into.get(key).push(seg);
        }
      }
    }
  }
}

// A line of points resampled every 4 m, and the distance along it at each
function sampled(pts) {
  const S = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / 4));
    for (let k = 0; k < n; k++) S.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  S.push(pts.at(-1));
  let s = 0;
  const L = [0];
  for (let i = 1; i < S.length; i++) L.push(s += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]));
  return { S, L, s };
}

// Whether each point's water is under the deck: in the river, or in it to either side within its reach
function wetAlong(r, S, reach) {
  return S.map(([x, z], i) => {
    const j = Math.min(i + 1, S.length - 1), k = Math.max(i - 1, 0);
    let tx = S[j][0] - S[k][0], tz = S[j][1] - S[k][1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    return digAt(r, x, z) > 0.02 || [0, 1, -1, 2, -2].some((m) => digAt(r, x - tz * (reach + Math.abs(m) * 2) * Math.sign(m || 1), z + tx * (reach + Math.abs(m) * 2) * Math.sign(m || 1)) > 0.02
      || digAt(r, x + tz * (reach + Math.abs(m) * 2), z - tx * (reach + Math.abs(m) * 2)) > 0.02);
  });
}

// The street a bridge carries (GEO.roads), by the name of the road whose line runs along its middle
function streetOf(pts) {
  const m = Math.floor((pts.length - 1) / 2), [ax, az] = pts[m], [bx, bz] = pts[m + 1];
  const x = (ax + bx) / 2, z = (az + bz) / 2, tl = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / tl, tz = (bz - az) / tl;
  let best = null, bd = 6;
  for (const road of GEO.roads || []) {
    const p = road[road.length - 1];
    if (!Array.isArray(p) || typeof road[0] !== 'string') continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i], ez = p[i + 3] - p[i + 1], l2 = ex * ex + ez * ez || 1;
      if (Math.abs(ex * tx + ez * tz) / Math.sqrt(l2) < 0.8) continue;
      const u = Math.max(0, Math.min(1, ((x - p[i]) * ex + (z - p[i + 1]) * ez) / l2));
      const d = Math.hypot(x - p[i] - ex * u, z - p[i + 1] - ez * u);
      if (d < bd) { bd = d; best = road[0]; }
    }
  }
  return best;
}

// The line of a street carried on from a bridge's end `end` (heading away along `dir`) for `meters`, along the same
// street's ways in GEO.roads: the points past the end, in order outward
function streetOnward(name, end, dir, meters) {
  const out = [];
  let at = end, d = dir, left = meters;
  for (let hop = 0; hop < 12 && left > 0.5; hop++) {
    let next = null;
    for (const road of GEO.roads || []) {
      if (road[0] !== name) continue;
      const p = road[road.length - 1];
      if (!Array.isArray(p) || p.length < 4) continue;
      const n = p.length / 2;
      // (from its end, or from part way along one of its pieces where the line was cut short before)
      for (let k = 0; k + 1 < n && !next; k++) {
        const ax = p[k * 2], az = p[k * 2 + 1], ex = p[k * 2 + 2] - ax, ez = p[k * 2 + 3] - az, l = Math.hypot(ex, ez) || 1;
        const u = Math.max(0, Math.min(1, ((at[0] - ax) * ex + (at[1] - az) * ez) / (l * l)));
        if (Math.hypot(at[0] - ax - ex * u, at[1] - az - ez * u) > 1.5) continue;
        const along = (ex * d[0] + ez * d[1]) / l;
        if (Math.abs(along) < 0.7) continue;
        const line = [];
        if (along > 0) { for (let q = k + 1; q < n; q++) line.push([p[q * 2], p[q * 2 + 1]]); }
        else { for (let q = k; q >= 0; q--) line.push([p[q * 2], p[q * 2 + 1]]); }
        if (line.length && Math.hypot(line.at(-1)[0] - at[0], line.at(-1)[1] - at[1]) > 1) next = line;
      }
      if (next) break;
    }
    if (!next) break;
    for (const q of next) {
      const l = Math.hypot(q[0] - at[0], q[1] - at[1]);
      if (l < 0.01) continue;
      d = [(q[0] - at[0]) / l, (q[1] - at[1]) / l];
      if (l >= left) { out.push([at[0] + d[0] * left, at[1] + d[1] * left]); left = 0; break; }
      out.push(q);
      at = q;
      left -= l;
    }
  }
  return out;
}

// For each point along a street's bridge, whether a railway runs under it there (GEO.rail's tracks crossing its line,
// within 5 m of the track)
function railsUnder(S) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of S) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const segs = [];
  for (const t of GEO.rail?.tracks || []) {
    const p = t[0];
    if (!Array.isArray(p)) continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      if (Math.max(ax, bx) < x0 - 8 || Math.min(ax, bx) > x1 + 8 || Math.max(az, bz) < z0 - 8 || Math.min(az, bz) > z1 + 8) continue;
      segs.push([ax, az, bx, bz]);
    }
  }
  return S.map(([x, z]) => segs.some(([ax, az, bx, bz]) => {
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    return Math.hypot(x - ax - ex * u, z - az - ez * u) < 5;
  }));
}

// A street's bridge (Lamp): its deck held at the clearance a real one gives, with the climb to it never steeper than 6%,
// and carried on along its street past the bank (an approach on fill) where it can't come down to the ground sooner.
// Over the river its top stands 4.4 m over the water (3.5 m to paddle under its girders); over a road it crosses 5.6 m
// over the road; over a railway 7.2 m over the track. Each point the least of those it must clear and the ground, then
// lifted by the 6% slope from every other (a tent over them), its crest eased round; its ends then cut back to where it
// meets the ground again. Broadway's bridge over the river and the railway by the depot is carried down the street to
// both of its ends, as the real one (rebuilt in 2003) is, and stands high over the river on its arches (8 m to its top).
const STREET_CLEAR = 4.4, BROADWAY_CLEAR = 8, ROAD_CLEAR = 5.6, RAIL_CLEAR = 7.2, GRADE = 0.06;
function streetDeck(g, r, b, gh) {
  const name = streetOf(b.pts);
  let pts = b.pts.map((p) => p.slice());
  const reach = b.w / 2 + 2.5, clearWater = name === 'Broadway St' ? BROADWAY_CLEAR : STREET_CLEAR;
  const shape = (line) => {
    const { S, L, s } = sampled(line);
    const wet = wetAlong(r, S, reach);
    const overRoad = roadsUnder(S, line), overRail = railsUnder(S);
    const G = S.map(([x, z]) => gh(x, z));
    const need = S.map(([x, z], i) => {
      let h = G[i];
      // over the river's open water at its middle the full clearance; where only its edge is beside it, the bank's
      if (digAt(r, x, z) > 0.02) h = Math.max(h, levelAt(r, x, z) + clearWater);
      else if (wet[i]) h = Math.max(h, levelAt(r, x, z) + 1.6);
      if (overRoad[i]) h = Math.max(h, G[i] + ROAD_CLEAR);
      if (overRail[i]) h = Math.max(h, G[i] + RAIL_CLEAR);
      return h;
    });
    // the tent: each point at least every other's need less the 6% fall between them
    const H = need.map((h, i) => {
      let top = h;
      for (let j = 0; j < need.length; j++) top = Math.max(top, need[j] - GRADE * Math.abs(L[i] - L[j]));
      return top;
    });
    // its crest rounded (raised only, so nothing it clears comes nearer)
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i + 1 < H.length; i++) H[i] = Math.max(H[i], (H[i - 1] + H[i] + H[i + 1]) / 3);
    }
    return { S, L, s, wet, overRoad, overRail, G, H };
  };
  // Broadway's bridge carries the street over the railway by the depot as well as the river: the map has only its
  // river span, so it's carried on from there south down Broadway past the tracks (the tent then raises it over them)
  if (name === 'Broadway St') {
    const [e, f] = [pts[0], pts[1]], l = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1;
    const south = streetOnward(name, e, [(e[0] - f[0]) / l, (e[1] - f[1]) / l], 200);
    if (railsUnder(sampled([...south].reverse().concat(pts)).S).some(Boolean)) pts = south.reverse().concat(pts);
  }
  let m = shape(pts);
  // carried on along its street where an end stands well over the ground (more than the half metre the cars' easing
  // onto it takes up: onDeck), then cut back to where the deck comes down to it
  const longest = name === 'Broadway St' ? 240 : 140;
  for (let tries = 0; tries < 3 && name; tries++) {
    const lift0 = m.H[0] - m.G[0], lift1 = m.H.at(-1) - m.G.at(-1);
    if (lift0 <= 0.5 && lift1 <= 0.5) break;
    let grew = false;
    for (const [lift, atStart] of [[lift0, true], [lift1, false]]) {
      if (lift <= 0.5) continue;
      const e = atStart ? pts[0] : pts.at(-1), f = atStart ? pts[1] : pts.at(-2), l = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1;
      const more = streetOnward(name, e, [(e[0] - f[0]) / l, (e[1] - f[1]) / l], Math.min(longest, lift / GRADE + 24));
      if (!more.length) continue;
      pts = atStart ? more.reverse().concat(pts) : pts.concat(more);
      grew = true;
    }
    if (!grew) break;
    m = shape(pts);
  }
  // an end that still stands over the ground (its street goes no further: Broadway at Beakes and Division, over Depot
  // St) is brought down to it, the deck coming down to it at 6% whatever it was to clear there, but never lower over the
  // water than 2.6 m over it (1.7 m under its girders)
  for (const k of [0, m.S.length - 1]) {
    if (m.H[k] - m.G[k] <= 0.5) continue;
    m.H = m.H.map((h, i) => {
      const cap = m.G[k] + 0.5 + GRADE * Math.abs(m.L[i] - m.L[k]);
      if (h <= cap) return h;
      const [x, zz] = m.S[i], least = digAt(r, x, zz) > 0.02 ? levelAt(r, x, zz) + 2.6 : m.G[i];
      return Math.max(cap, least);
    });
  }
  // the ends cut back to the last point still standing over the ground
  let a = 0, z = m.S.length - 1;
  while (a + 2 < z && m.H[a + 1] - m.G[a + 1] < 0.15) a++;
  while (z - 2 > a && m.H[z - 1] - m.G[z - 1] < 0.15) z--;
  const cut = (list) => list.slice(a, z + 1);
  const S = cut(m.S), wet = cut(m.wet), overRoad = cut(m.overRoad), overRail = cut(m.overRail), G = cut(m.G), H = cut(m.H);
  const L = cut(m.L).map((l) => l - m.L[a]), s = L.at(-1);
  // its very ends on the ground they meet
  H[0] = Math.min(H[0], G[0] + 0.5);
  H[H.length - 1] = Math.min(H.at(-1), G.at(-1) + 0.5);
  if (s < 3) return null;
  const deck = { kind: 0, w: b.w, name, level: false, half: b.w / 2 + 1.5, length: s,
    // [x, z, along, top, over the water, not the ground (a road crosses under: onDeck), a railway under it, the ground]
    points: S.map((p, i) => [p[0], p[1], L[i], H[i], wet[i], overRoad[i], overRail[i], G[i]]) };
  return { S, deck };
}

// A railway's bridge or a footbridge: from the ground at one end to the ground at the other, raised where it's over the
// water to clear it (3.5 m under a railway's girders, 1.3 m under a footbridge's)
function otherDeck(g, r, b, gh) {
  {
    const { S, L, s } = sampled(b.pts);
    if (s < 3) return null;
    // (Lamp: a footbridge's ends on the ground as it's drawn, the paths leading onto it: on the 10 m heights they stood
    // up to a metre over or under the path, a step or a wall to ride into)
    const foot = b.kind === 2;
    const ha = foot ? gh(...S[0]) : baseHeight(g, ...S[0]), hb = foot ? gh(...S.at(-1)) : baseHeight(g, ...S.at(-1));
    const clear = b.kind === 2 ? 2.6 : 4.6, reach = b.kind === 2 ? 0 : b.w / 2 + 2.5;
    const wet = S.map(([x, z], i) => {
      const j = Math.min(i + 1, S.length - 1), k = Math.max(i - 1, 0);
      let tx = S[j][0] - S[k][0], tz = S[j][1] - S[k][1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      return digAt(r, x, z) > 0.02 || [0, 1, -1, 2, -2].some((m) => digAt(r, x - tz * (reach + Math.abs(m) * 2) * Math.sign(m || 1), z + tx * (reach + Math.abs(m) * 2) * Math.sign(m || 1)) > 0.02
        || digAt(r, x + tz * (reach + Math.abs(m) * 2), z - tx * (reach + Math.abs(m) * 2)) > 0.02);
    });
    // Lamp: and a street or railway bridge clears the streets it crosses (the railway over N Main by Wildt St): a point
    // over another road (one crossing it, not the bridge's own street along it) stands 5.6 m over that road's level,
    // so its underside leaves 4.5 m of headroom, and isn't the ground there (onDeck: the road runs on under it)
    const overRoad = b.kind === 2 ? S.map(() => false) : roadsUnder(S);
    const need = S.map(() => -Infinity); // the height over the water each point must keep
    let H = S.map(([x, z], i) => {
      let h = ha + (hb - ha) * (L[i] / s);
      if (overRoad[i]) h = Math.max(h, baseHeight(g, x, z) + 5.6);
      // a footbridge clears the water as drawn: over the Argo Cascades' channel that's the channel's own pool, well above
      // the river's level there (the railway beside it already clears both, so its deck is left as it was)
      const lv = b.kind === 2 ? cascadeLevel(x, z, levelAt(r, x, z)) : levelAt(r, x, z);
      if (wet[i]) need[i] = lv + clear;
      return wet[i] ? Math.max(h, lv + clear) : h;
    });
    // eased into a gentle arch, its ends kept on the ground
    for (let pass = 0; pass < 6; pass++) {
      H = H.map((h, i) => (i === 0 || i === H.length - 1 ? h : Math.max(h, (H[i - 1] + h + H[i + 1]) / 3)));
    }
    // Lamp: and a footbridge climbs off its ends no steeper than a ramp (12%), as the Border to Border Trail's do, so a
    // bike rolls on and off it: its rise over the water was eased over a few samples only, a hump or a wall at an end
    // (but never down into the water: over it the deck stays at least 0.4 m clear of it, keeping its full clearance
    // where the ramp off its banks reaches that high: a short span over a channel between low banks is a low bridge,
    // as they are, rather than a hump too steep to ride onto, which the bike passed under)
    if (foot) {
      const ramp = (i) => Math.min(ha + 0.12 * L[i], hb + 0.12 * (s - L[i]));
      H = H.map((h, i) => Math.max(Number.isFinite(need[i]) ? need[i] - clear + 0.4 : -Infinity, Math.min(h, ramp(i))));
      for (let pass = 0; pass < 6; pass++) {
        H = H.map((h, i) => (i === 0 || i === H.length - 1 ? h : Math.max(h, (H[i - 1] + h + H[i + 1]) / 3)));
      }
    }
    // over a road a bridge can't climb from the ground to clear it in a few metres: a railway's deck runs level end to
    // end at the height the road needs, on abutments (river.js), the track rising to it on embankments (railways.js); a
    // street's eases up and down at most 6% from its ends. (Lamp) And so does a railway's over the river: level at the
    // height the water needs, never a hump a train leaps
    const level = overRoad.some(Boolean) || (b.kind === 1 && wet.some(Boolean));
    if (level && b.kind === 1) {
      const top = Math.max(...H);
      H = H.map(() => top);
    } else if (level) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < H.length; i++) H[i] = Math.max(H[i], H[i - 1] - 0.06 * (L[i] - L[i - 1]));
        for (let i = H.length - 2; i >= 0; i--) H[i] = Math.max(H[i], H[i + 1] - 0.06 * (L[i + 1] - L[i]));
      }
    }
    const deck = { kind: b.kind, w: b.w, level, half: b.kind === 2 ? b.w / 2 : b.w / 2 + 1.5, length: s, points: S.map((p, i) => [p[0], p[1], L[i], H[i], wet[i],
      // (nor is it the ground where it stands well over dry land: the lawns and paths there stay on the ground)
      overRoad[i] || (level && !wet[i] && H[i] - baseHeight(g, p[0], p[1]) > 1.2)]) };
    return { S, deck };
  }
}

// The footbridge's points `pts` cut back to the trail's edge where its deck crosses the trail with too little headroom,
// the longer side kept; null where it doesn't (b2b-route.js b2bCrossings)
function trailCut(pts, deck, gh) {
  const D = deck.points, cuts = [];
  for (const s of b2bCrossings(pts)) {
    let i = 0;
    while (i + 2 < D.length && D[i + 1][2] < s) i++;
    const f = Math.max(0, Math.min(1, (s - D[i][2]) / ((D[i + 1][2] - D[i][2]) || 1)));
    const x = D[i][0] + (D[i + 1][0] - D[i][0]) * f, z = D[i][1] + (D[i + 1][1] - D[i][1]) * f, h = D[i][3] + (D[i + 1][3] - D[i][3]) * f;
    if (h - gh(x, z) < 3.2) cuts.push(s);
  }
  if (!cuts.length) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum.at(-1), at = (s) => {
    let i = 0;
    while (i + 2 < pts.length && cum[i + 1] < s) i++;
    const f = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
  };
  // the stretch between crossings (and the ends) that's longest, each end stopping 4.5 m short of the trail's middle (its
  // railings clear of the trail where it meets it at a slant)
  const marks = [0, ...cuts.sort((a, b) => a - b), len];
  let best = null;
  for (let k = 0; k + 1 < marks.length; k++) {
    const s0 = marks[k] + (k > 0 ? 4.5 : 0), s1 = marks[k + 1] - (k + 1 < marks.length - 1 ? 4.5 : 0);
    if (s1 - s0 > (best ? best[1] - best[0] : 3)) best = [s0, s1];
  }
  if (!best) return null;
  const out = [at(best[0])];
  for (let i = 1; i + 1 < pts.length; i++) if (cum[i] > best[0] && cum[i] < best[1]) out.push(pts[i]);
  out.push(at(best[1]));
  return out;
}

// For each point along a bridge, whether a road crosses under it there: within the road's half width (and 2 m) of one of
// GEO.roads' segments that runs across the bridge (more than 35° off its line, so the bridge's own street isn't one).
// With the street's own `line` (Lamp): only a road that passes under it, not one meeting it at grade (a road whose way
// has a node on the street's line, a junction, is the street's own crossing at its level)
function roadsUnder(S, line = null) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of S) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const onLine = (px, pz) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, az] = line[i], ex = line[i + 1][0] - ax, ez = line[i + 1][1] - az, l2 = ex * ex + ez * ez || 1;
      const u = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2));
      if (Math.hypot(px - ax - ex * u, pz - az - ez * u) < 2) return true;
    }
    return false;
  };
  const segs = [];
  for (const road of GEO.roads || []) {
    const w = road[1] || 8, pts = road[road.length - 1];
    if (!Array.isArray(pts)) continue;
    if (line) {
      // (and one that only comes up to it, a T junction, doesn't cross it: its way must pass right across the line)
      let joins = false, crosses = false;
      for (let i = 0; i + 1 < pts.length && !joins; i += 2) {
        if (pts[i] < x0 - 20 || pts[i] > x1 + 20 || pts[i + 1] < z0 - 20 || pts[i + 1] > z1 + 20) continue;
        joins = onLine(pts[i], pts[i + 1]);
      }
      if (joins) continue;
      const side = (px, pz, [ax, az], [bx, bz]) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
      for (let i = 0; i + 3 < pts.length && !crosses; i += 2) {
        for (let k = 0; k + 1 < line.length && !crosses; k++) {
          const p = [pts[i], pts[i + 1]], q = [pts[i + 2], pts[i + 3]];
          crosses = side(...p, line[k], line[k + 1]) * side(...q, line[k], line[k + 1]) < 0
            && side(...line[k], p, q) * side(...line[k + 1], p, q) < 0;
        }
      }
      if (!crosses) continue;
    }
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const pad = w / 2 + 2;
      if (Math.max(ax, bx) < x0 - pad || Math.min(ax, bx) > x1 + pad || Math.max(az, bz) < z0 - pad || Math.min(az, bz) > z1 + pad) continue;
      segs.push([ax, az, bx, bz, pad]);
    }
  }
  if (!segs.length) return S.map(() => false);
  return S.map(([x, z], i) => {
    const j = Math.min(i + 1, S.length - 1), k = Math.max(i - 1, 0);
    let tx = S[j][0] - S[k][0], tz = S[j][1] - S[k][1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    return segs.some(([ax, az, bx, bz, pad]) => {
      const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez) || 1;
      if (Math.abs((ex * tx + ez * tz) / l) > 0.82) return false; // along the bridge: its own street
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (l * l)));
      return Math.hypot(x - ax - ex * u, z - az - ez * u) < pad;
    });
  });
}

// The town's swimming pools (pools.js), whose water answers here as the river's does
let pools = null;
function setPools(p) { pools = p; }

// The river's water level at (x, z) (or a pool's), or null where there's no river
function waterLevel(x, z) {
  const pool = pools?.wet ? pools.wet(x, z) : pools?.at(x, z);
  if (pool) return pool.level;
  const r = grid?.river;
  return r ? cascadeLevel(x, z, levelAt(r, x, z)) : null; // stepping down the Argo Cascades (cascades.js)
}

// The top of a footbridge's deck at (x, z), or -Infinity off every footbridge
function footbridgeTop(x, z) {
  const list = grid?.river?.footBuckets?.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!list) return -Infinity;
  let top = -Infinity;
  for (const { deck, a, b } of list) {
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
    const u = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
    if (Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u) > deck.half + 0.2) continue;
    top = Math.max(top, a[3] + (b[3] - a[3]) * u);
  }
  return top;
}

// The bridges' decks: { kind (0 street, 1 railway, 2 footbridge), w, half (half the deck's width), length,
// points: [x, z, distance along, deck height, over the water] }
function bridgeDecks() {
  return grid?.river?.bridges || [];
}

// Michigan Stadium sits in a bowl dug into the ground: the ground around its outer wall (the lowest of it) is where the
// stadium is measured from (stadiumGround), and inside the wall the ground is dug out to 1.5 m under its stands and
// field (stadium-shape.js), so they show and nothing of the hill pokes through them.
function digBowl(g) {
  const at = (x, z) => {
    const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
    const c = Math.floor(fx), r = Math.floor(fz), ax = fx - c, az = fz - r, h = g.heights, i = r * g.cols + c;
    return (h[i] * (1 - ax) + h[i + 1] * ax) * (1 - az) + (h[i + g.cols] * (1 - ax) + h[i + g.cols + 1] * ax) * az;
  };
  let low = Infinity, reach = 0;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2, rOut = radiiAt(a)[1];
    low = Math.min(low, at(STADIUM.cx + Math.cos(a) * (rOut + 4), STADIUM.cz + Math.sin(a) * (rOut + 4)));
    reach = Math.max(reach, rOut);
  }
  g.stadiumGround = low;
  const c0 = Math.floor((STADIUM.cx - reach - g.x0) / g.step), c1 = Math.ceil((STADIUM.cx + reach - g.x0) / g.step);
  const r0 = Math.floor((STADIUM.cz - reach - g.z0) / g.step), r1 = Math.ceil((STADIUM.cz + reach - g.z0) / g.step);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    // the lowest of the surface around the sample, so the ground between samples stays under it too
    let s = Infinity;
    for (const [u, v] of [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
      const b = bowlSurface(g.x0 + (c + u) * g.step, g.z0 + (r + v) * g.step);
      if (b !== null) s = Math.min(s, b);
    }
    if (s === Infinity) continue;
    const i = r * g.cols + c;
    g.heights[i] = Math.min(g.heights[i], low + s - 1.5);
  }
}

// The city's mesh of triangles (readCore) and the bits of its coarser cut, or null without it
function cityGround() {
  return grid?.core ? { core: grid.core, under: grid.coreUnder } : null;
}

// The ground around Michigan Stadium, which its rim and field are measured from
function stadiumGround() {
  return grid?.stadiumGround ?? 0;
}

// The ground's height at (x, z), bilinear between samples; 0 off the map.
// In the river it's dug down from the banks to its bed, 1.8 m under the water; on a bridge it's the deck.
function groundHeight(x, z) {
  if (!grid) return 0;
  const r = grid.river;
  if (grid.core && inCore(grid.core, x, z)) {
    const h = coreHeight(grid.core, x, z);
    return r ? onDeck(r, x, z, h) : h;
  }
  return r ? onDeck(r, x, z, riverbedHeight(x, z)) : baseHeight(grid, x, z);
}

// The top of a street's or railway's bridge deck at (x, z), over the roads it crosses too (where groundHeight gives the
// road under it): for the tracks laid on it (railways.js)
function deckTop(x, z) {
  const h = groundHeight(x, z);
  return grid?.river ? onDeck(grid.river, x, z, h, true) : h;
}

// The ground at (x, z) with no street's bridge on it (Lamp): under a street's deck standing well over it (Broadway's over
// the railway by the depot), the ground under the deck; elsewhere groundHeight. For the railways laid on the ground
// (railways.js), which a street bridges over
function groundUnderStreets(x, z) {
  const h = groundHeight(x, z), r = grid?.river;
  if (!r) return h;
  const under = riverbedHeight(x, z);
  if (h - under < 1.5) return h;
  const list = r.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  for (const { deck, a, b } of list || []) {
    if (deck.kind !== 0) continue;
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
    const u = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
    if (Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u) <= deck.half + 0.5) return under;
  }
  return h;
}

// The ground at (x, z) under any bridge: the river's banks and bed where it's dug out
function riverbedHeight(x, z) {
  if (!grid) return 0;
  if (grid.core && inCore(grid.core, x, z)) return coreHeight(grid.core, x, z);
  let h = baseHeight(grid, x, z);
  const r = grid.river;
  const f = r ? digAt(r, x, z) : 0;
  if (f > 0) {
    const bed = cascadeLevel(x, z, levelAt(r, x, z)) - cascadeDepth(x, z, 1.8);
    if (bed < h) h += (bed - h) * f;
  }
  return h;
}

// How far (0-1) (x, z) is out in the river from its shore: 0 on land, 1 in open water
function riverDepth(x, z) {
  if (pools?.wet ? pools.wet(x, z) : pools?.at(x, z)) return 1;
  const r = grid?.river;
  return r ? digAt(r, x, z) : 0;
}

// Which way the river runs: the distance along the water (on a 6 m grid of its open water) from the lowest point of its
// largest stretch, measured once when it's first asked for. Downstream is where that distance falls.
// The water is a few hundredths of the grid, so only its cells are kept: numbered in turn, found through 64 x 64 blocks
// of the grid (null where a block has none), each cell's distance in one short array
const FLOW_STEP = 6, FLOW_BLOCK = 64;
function flowField() {
  const r = grid?.river;
  if (!r) return null;
  if (r.flow !== undefined) return r.flow;
  const cols = Math.floor((r.dcols - 1) * r.dstep / FLOW_STEP), rows = Math.floor((r.drows - 1) * r.dstep / FLOW_STEP);
  const x0 = r.dx0 + FLOW_STEP / 2, z0 = r.dz0 + FLOW_STEP / 2, B = FLOW_BLOCK;
  const bcols = Math.ceil(cols / B), brows = Math.ceil(rows / B), blocks = new Array(bcols * brows).fill(null);
  const cellC = [], cellW = [];
  for (let w = 0; w < rows; w++) for (let c = 0; c < cols; c++) {
    if (!(digAt(r, x0 + c * FLOW_STEP, z0 + w * FLOW_STEP) > 0.35)) continue;
    const b = (w >> 6) * bcols + (c >> 6);
    (blocks[b] ??= new Int32Array(B * B).fill(-1))[(w & 63) * B + (c & 63)] = cellC.length;
    cellC.push(c); cellW.push(w);
  }
  const n = cellC.length;
  const id = (c, w) => {
    if (c < 0 || w < 0 || c >= cols || w >= rows) return -1;
    const blk = blocks[(w >> 6) * bcols + (c >> 6)];
    return blk ? blk[(w & 63) * B + (c & 63)] : -1;
  };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  // the stretches of water that join up, and the biggest of them
  const part = new Int32Array(n).fill(-1);
  const queue = new Int32Array(Math.max(1, n));
  let best = -1, bestSize = 0;
  for (let i = 0; i < n; i++) {
    if (part[i] >= 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = i; part[i] = i;
    while (head < tail) {
      const k = queue[head++], c = cellC[k], w = cellW[k];
      for (const [dc, dw] of NB) {
        const j = id(c + dc, w + dw);
        if (j >= 0 && part[j] < 0) { part[j] = i; queue[tail++] = j; }
      }
    }
    if (tail > bestSize) { bestSize = tail; best = i; }
  }
  if (best < 0) return (r.flow = null);
  // each stretch runs to its own lowest point (a pond above a dam to the dam, the river on to Gallup)
  const lows = new Map();
  for (let i = 0; i < n; i++) {
    const lv = levelAt(r, x0 + cellC[i] * FLOW_STEP, z0 + cellW[i] * FLOW_STEP);
    const was = lows.get(part[i]);
    if (!was || lv < was.level) lows.set(part[i], { level: lv, at: i });
  }
  // the distance along the water from there, relaxed until it settles
  const dist = new Float32Array(n).fill(Infinity);
  const inQueue = new Uint8Array(n);
  let head = 0, size = 0;
  for (const { at } of lows.values()) { dist[at] = 0; queue[size++] = at; inQueue[at] = 1; }
  while (size > 0) {
    const k = queue[head]; head = (head + 1) % n; size--; inQueue[k] = 0;
    const c = cellC[k], w = cellW[k], d = dist[k];
    for (const [dc, dw, cost] of NB) {
      const j = id(c + dc, w + dw);
      if (j < 0 || part[j] !== part[k] || dist[j] <= d + cost) continue;
      dist[j] = d + cost;
      if (!inQueue[j]) { inQueue[j] = 1; queue[(head + size) % n] = j; size++; }
    }
  }
  let far = 0;
  for (let i = 0; i < n; i++) if (part[i] === best && dist[i] > far) far = dist[i];
  console.log(`[terrain] the river runs ${Math.round(far * FLOW_STEP / 1000 * 10) / 10} km to its lowest point here, in ${lows.size} stretches (${n} wet cells kept)`);
  // the distance at grid cell (c, w): Infinity off the water
  const distAt = (c, w) => { const j = id(c, w); return j < 0 ? Infinity : dist[j]; };
  return (r.flow = { cols, rows, x0, z0, distAt });
}

// The way the river runs at (x, z), into `out` as a unit { x, z } downstream; false where there's no current there
function riverFlow(x, z, out) {
  const f = flowField();
  if (!f) return false;
  const fx = (x - f.x0) / FLOW_STEP, fz = (z - f.z0) / FLOW_STEP;
  const c0 = Math.floor(fx), w0 = Math.floor(fz);
  if (c0 < 1 || w0 < 1 || c0 >= f.cols - 2 || w0 >= f.rows - 2) return false;
  const { distAt } = f;
  let gx = 0, gz = 0;
  for (let dw = 0; dw <= 1; dw++) for (let dc = 0; dc <= 1; dc++) {
    const c = c0 + dc, w = w0 + dw, d = distAt(c, w);
    if (!Number.isFinite(d)) continue;
    const wgt = (dc ? fx - c0 : 1 - (fx - c0)) * (dw ? fz - w0 : 1 - (fz - w0));
    const e = distAt(c + 1, w), we = distAt(c - 1, w), s = distAt(c, w + 1), nn = distAt(c, w - 1);
    gx += wgt * ((Number.isFinite(e) ? e : d) - (Number.isFinite(we) ? we : d));
    gz += wgt * ((Number.isFinite(s) ? s : d) - (Number.isFinite(nn) ? nn : d));
  }
  const l = Math.hypot(gx, gz);
  if (l < 1e-4) return false;
  out.x = -gx / l;
  out.z = -gz / l;
  return true;
}

// The nearest open water to (x, z) within `reach` metres, as { x, z }, or null
function nearestWater(x, z, reach = 600) {
  const f = flowField();
  if (!f) return null;
  const fc = Math.round((x - f.x0) / FLOW_STEP), fw = Math.round((z - f.z0) / FLOW_STEP);
  const span = Math.ceil(reach / FLOW_STEP);
  let best = null, bestD = Infinity;
  for (let w = Math.max(0, fw - span); w <= Math.min(f.rows - 1, fw + span); w++) {
    for (let c = Math.max(0, fc - span); c <= Math.min(f.cols - 1, fc + span); c++) {
      if (!Number.isFinite(f.distAt(c, w))) continue;
      const px = f.x0 + c * FLOW_STEP, pz = f.z0 + w * FLOW_STEP;
      if (riverDepth(px, pz) < 0.9) continue;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
  }
  return best;
}

// The lowest ground under a footprint: its middle and corners, so a building is never left floating on its low side.
function groundUnder(x, z, halfW = 0, halfD = 0, rotY = 0) {
  if (!grid) return 0;
  if (halfW <= 0 && halfD <= 0) return groundHeight(x, z);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  let low = groundHeight(x, z);
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const dx = u * halfW, dz = v * halfD;
    low = Math.min(low, groundHeight(x + dx * c + dz * s, z - dx * s + dz * c));
  }
  return low;
}

// The ground's slope at (x, z) as rise over run along x and along z.
function groundSlope(x, z, d = 2) {
  return [(groundHeight(x + d, z) - groundHeight(x - d, z)) / (2 * d), (groundHeight(x, z + d) - groundHeight(x, z - d)) / (2 * d)];
}

// The pitch (nose up, radians) and roll (right side up) of something of the given length and width standing at (x, z)
// facing yaw, from the ground under its ends and sides.
function groundTilt(x, z, yaw, length = 4, width = 1.8) {
  if (!grid) return [0, 0];
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const front = groundHeight(x + fx * length * 0.5, z + fz * length * 0.5);
  const back = groundHeight(x - fx * length * 0.5, z - fz * length * 0.5);
  const right = groundHeight(x - fz * width * 0.5, z + fx * width * 0.5);
  const left = groundHeight(x + fz * width * 0.5, z - fx * width * 0.5);
  return [Math.atan2(front - back, length), Math.atan2(right - left, width)];
}

// The heights as a texture, for shaders that measure from the ground (a canyon's shade, a signal's lamps, grime).
let groundTexture = null;
const terrainOrigin = uniform(new THREE.Vector2());
const terrainSize = uniform(new THREE.Vector2(1, 1));
function terrainTexture() {
  if (groundTexture) return groundTexture;
  const data = grid ? grid.heights : new Float32Array(1);
  groundTexture = new THREE.DataTexture(data, grid ? grid.cols : 1, grid ? grid.rows : 1, THREE.RedFormat, THREE.FloatType);
  groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.minFilter = THREE.LinearFilter;
  groundTexture.wrapS = groundTexture.wrapT = THREE.ClampToEdgeWrapping;
  groundTexture.needsUpdate = true;
  if (grid) {
    terrainOrigin.value.set(grid.x0, grid.z0);
    terrainSize.value.set(grid.step * (grid.cols - 1), grid.step * (grid.rows - 1));
  }
  return groundTexture;
}

// The ground's height under a world position, in a shader.
function groundHeightNode(worldXZ) {
  if (!grid) return float(0);
  const uv = worldXZ.sub(terrainOrigin).div(terrainSize);
  const half = vec2(0.5 / grid.cols, 0.5 / grid.rows);
  return texture(terrainTexture(), uv.mul(vec2(1).sub(half.mul(2))).add(half)).r;
}

// ---------------------------------------------------------------------------------------------------------------------
// Setting what was built flat on the ground
// ---------------------------------------------------------------------------------------------------------------------

// A triangle mesh cut finer where the ground bends away from its triangles, so a polygon drawn as a few long slivers
// can follow it: a triangle is split (at the middle of its longest edge) while the ground under its edges' middles,
// quarters and centre strays more than `tolerance` metres from the plane through its corners, down to edges of
// `minEdge`. Flat ground (the water's edge, level streets) isn't cut at all. Every attribute is interpolated.
function tessellate(geometry, tolerance = 0.12, minEdge = 5) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const names = Object.keys(g.attributes).filter((n) => !g.attributes[n].isInterleavedBufferAttribute);
  const sources = names.map((n) => g.attributes[n]);
  const sizes = sources.map((a) => a.itemSize);
  const offsets = [];
  let stride = 0;
  for (const size of sizes) { offsets.push(stride); stride += size; }
  const P = offsets[names.indexOf('position')];
  const min2 = minEdge * minEdge;
  const count = g.attributes.position.count;

  // How far the ground strays from the triangle's plane (by its corners' ground heights) along it.
  const strays = (a, b, c) => {
    const ax = a[P], az = a[P + 2], bx = b[P], bz = b[P + 2], cx = c[P], cz = c[P + 2];
    const ab = (ax - bx) ** 2 + (az - bz) ** 2, bc = (bx - cx) ** 2 + (bz - cz) ** 2, ca = (cx - ax) ** 2 + (cz - az) ** 2;
    if (Math.max(ab, bc, ca) <= min2) return false;
    const ha = groundHeight(ax, az), hb = groundHeight(bx, bz), hc = groundHeight(cx, cz);
    for (const [u, v] of [[0.5, 0.5], [0.25, 0.75], [0.75, 0.25]]) {
      if (Math.abs(groundHeight(ax * u + bx * v, az * u + bz * v) - (ha * u + hb * v)) > tolerance) return true;
      if (Math.abs(groundHeight(bx * u + cx * v, bz * u + cz * v) - (hb * u + hc * v)) > tolerance) return true;
      if (Math.abs(groundHeight(cx * u + ax * v, cz * u + az * v) - (hc * u + ha * v)) > tolerance) return true;
    }
    return Math.abs(groundHeight((ax + bx + cx) / 3, (az + bz + cz) / 3) - (ha + hb + hc) / 3) > tolerance;
  };

  let out = new Float32Array(count * stride + stride * 3);
  let used = 0;
  const write = (v) => {
    if (used + stride > out.length) { const grown = new Float32Array(out.length * 2); grown.set(out); out = grown; }
    out.set(v, used);
    used += stride;
  };
  const vertex = (i) => {
    const v = new Float32Array(stride);
    sources.forEach((a, n) => { for (let k = 0; k < sizes[n]; k++) v[offsets[n] + k] = a.array[i * sizes[n] + k]; });
    return v;
  };
  const d2 = (a, b) => (a[P] - b[P]) ** 2 + (a[P + 2] - b[P + 2]) ** 2;
  const mid = (a, b) => { const m = new Float32Array(stride); for (let k = 0; k < stride; k++) m[k] = (a[k] + b[k]) / 2; return m; };
  const split = (a, b, c, depth) => {
    if (depth > 24 || !strays(a, b, c)) { write(a); write(b); write(c); return; }
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), longest = Math.max(ab, bc, ca);
    // The longest edge split at its middle, keeping the winding.
    if (longest === ab) { const m = mid(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
    else if (longest === bc) { const m = mid(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
    else { const m = mid(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
  };
  // Most triangles are small: those are copied straight across without being looked at further.
  const pos = sources[names.indexOf('position')].array;
  const small = (i) => {
    const ax = pos[i * 3], az = pos[i * 3 + 2], bx = pos[i * 3 + 3], bz = pos[i * 3 + 5], cx = pos[i * 3 + 6], cz = pos[i * 3 + 8];
    return (ax - bx) ** 2 + (az - bz) ** 2 <= min2 && (bx - cx) ** 2 + (bz - cz) ** 2 <= min2 && (cx - ax) ** 2 + (cz - az) ** 2 <= min2;
  };
  const copy = (i) => {
    if (used + stride * 3 > out.length) { const grown = new Float32Array(out.length * 2); grown.set(out); out = grown; }
    for (let v = i; v < i + 3; v++) {
      for (let n = 0; n < sources.length; n++) {
        const a = sources[n].array, size = sizes[n], o = used + offsets[n];
        for (let k = 0; k < size; k++) out[o + k] = a[v * size + k];
      }
      used += stride;
    }
  };
  for (let i = 0; i < count; i += 3) {
    if (small(i)) copy(i);
    else split(vertex(i), vertex(i + 1), vertex(i + 2), 0);
  }
  const vertices = used / stride;
  if (vertices === count) return g;
  const result = new THREE.BufferGeometry();
  names.forEach((n, k) => {
    // In the attribute's own number type: a colour kept as bytes stays bytes (0-255, read as 0-1), never 255 as a float
    const Kind = sources[k].array.constructor;
    const whole = Kind !== Float32Array && Kind !== Float64Array;
    const data = new Kind(vertices * sizes[k]);
    for (let v = 0; v < vertices; v++) for (let j = 0; j < sizes[k]; j++) {
      const value = out[v * stride + offsets[k] + j];
      data[v * sizes[k] + j] = whole ? Math.round(value) : value;
    }
    result.setAttribute(n, new THREE.BufferAttribute(data, sizes[k], sources[k].normalized));
  });
  return result;
}

// Every vertex of a world-space geometry raised by the ground under it, cut finer first (tessellate) unless
// `tolerance` is 0 (lines and points, which can't be cut).
function drapeGeometry(geometry, tolerance = 0.12) {
  if (!grid) return geometry;
  const g = tolerance ? tessellate(geometry, tolerance) : geometry;
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + groundHeight(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// A world-space geometry lifted whole by the lowest ground under it.
function liftGeometry(geometry) {
  if (!grid) return 0;
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  const lift = groundUnder((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2);
  if (lift) {
    geometry.translate(0, lift, 0);
    geometry.computeBoundingSphere();
  }
  return lift;
}

// Each instance of an InstancedMesh raised by the ground at its own position. Big flat instances (a sidewalk slab)
// aren't for this: they need draping.
function liftInstances(mesh) {
  if (!grid) return;
  const m = new THREE.Matrix4(), e = m.elements;
  mesh.updateMatrixWorld();
  const world = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    world.set(e[12], e[13], e[14]).applyMatrix4(mesh.matrixWorld);
    e[13] += groundHeight(world.x, world.z);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox?.();
  mesh.computeBoundingSphere?.();
}

// A world-space geometry split into square tiles by where each triangle's middle falls, so a ground layer that spans
// the island is drawn (and shadowed) only where the camera sees it, rather than whole on every pass.
const TILE = 800; // larger tiles: each ground layer is a few dozen pieces, not hundreds
function splitIntoTiles(geometry) {
  const names = Object.keys(geometry.attributes);
  const layer = { count: geometry.attributes.position.count, attrs: names.map((n) => {
    const a = geometry.attributes[n];
    return { name: n, array: a.array, itemSize: a.itemSize, normalized: a.normalized };
  }) };
  const tiles = tilesOfLayer(layer);
  if (tiles.length < 2) return [geometry];
  return tiles.map(geometryOfLayer);
}

// A mesh in world space laid on the ground (`draped`, its geometry cut and raised), as one mesh or (when it's big) a
// group of tiles to put in its place
function meshOnGround(mesh, draped) {
  draped.computeBoundingBox();
  draped.computeBoundingSphere();
  // (a mesh already in chunks hidden far off, road-paint.js's, is kept whole, so it keeps its cullDistance)
  const big = draped.attributes.position.count > 30000 && !draped.index && !mesh.userData.cullDistance;
  if (!big) {
    mesh.geometry = draped;
    return null;
  }
  const group = new THREE.Group();
  group.name = mesh.name;
  for (const g of splitIntoTiles(draped)) {
    const tile = new THREE.Mesh(g, mesh.material);
    tile.castShadow = mesh.castShadow;
    tile.receiveShadow = mesh.receiveShadow;
    tile.renderOrder = mesh.renderOrder;
    tile.frustumCulled = mesh.frustumCulled;
    tile.layers.mask = mesh.layers.mask;
    tile.name = mesh.name;
    group.add(tile);
  }
  return group;
}

// ---- Ground layers as plain data, cut on other cores and saved for the next start ----------------------------------

// What a layer is made from, as the arrays its key is the fingerprint of: a geometry's attributes and index, and an
// instanced mesh's matrices as well, so a saved layer is found without making the layer first
function geometryInputs(geometry) {
  const names = Object.keys(geometry.attributes).filter((n) => !geometry.attributes[n].isInterleavedBufferAttribute).sort();
  return [textBytes(names.join(',')), ...names.map((n) => geometry.attributes[n].array), ...(geometry.index ? [geometry.index.array] : [])];
}
function instanceInputs(mesh) {
  mesh.updateMatrixWorld();
  return [...geometryInputs(mesh.geometry), mesh.instanceMatrix.array.subarray(0, mesh.count * 16), new Float32Array(mesh.matrixWorld.elements)];
}

// A mesh's geometry as a layer (ground-core.js): its triangles, every attribute but interleaved ones, in copies of its
// own arrays (they go to a worker)
function layerOfGeometry(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const attrs = Object.keys(g.attributes).filter((n) => !g.attributes[n].isInterleavedBufferAttribute).map((n) => {
    const a = g.attributes[n];
    return { name: n, array: a.array.slice(0, a.count * a.itemSize), itemSize: a.itemSize, normalized: a.normalized };
  });
  return { count: g.attributes.position.count, attrs };
}

// Big flat instances (a block's sidewalk slab) as one layer in world space: position, normal and uv of every instance
function layerOfInstances(mesh) {
  mesh.updateMatrixWorld();
  const base = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const names = ['position', 'normal', 'uv'].filter((n) => base.attributes[n]);
  const n = base.attributes.position.count, count = n * mesh.count;
  const arrays = names.map((name) => new Float32Array(count * base.attributes[name].itemSize));
  const m = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), v = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    normalMatrix.getNormalMatrix(m);
    names.forEach((name, k) => {
      const src = base.attributes[name], out = arrays[k], o = i * n * src.itemSize;
      for (let j = 0; j < n; j++) {
        if (name === 'uv') { out[o + j * 2] = src.getX(j); out[o + j * 2 + 1] = src.getY(j); continue; }
        v.fromBufferAttribute(src, j);
        if (name === 'position') v.applyMatrix4(m); else v.applyMatrix3(normalMatrix).normalize();
        out[o + j * 3] = v.x; out[o + j * 3 + 1] = v.y; out[o + j * 3 + 2] = v.z;
      }
    });
  }
  return { count, attrs: names.map((name, k) => ({ name, array: arrays[k], itemSize: base.attributes[name].itemSize, normalized: false })) };
}

// A cut layer as a mesh, packed for the GPU: its normals and colours a byte each (three.js widens them to four), and
// its index 16-bit where it has few enough vertices. Cut along the city's mesh, the ground's layers have many more
// vertices than they had, and this keeps them about the size they were.
function geometryOfLayer(layer) {
  const g = new THREE.BufferGeometry();
  for (const a of layer.attrs) g.setAttribute(a.name, packedAttribute(a));
  if (layer.index) {
    const n = layer.attrs[0].array.length / layer.attrs[0].itemSize;
    g.setIndex(new THREE.BufferAttribute(n < 65536 && layer.index instanceof Uint32Array ? Uint16Array.from(layer.index) : layer.index, 1));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
function packedAttribute(a) {
  const { name, array, itemSize } = a;
  // plain loops: TypedArray.from with a callback is many times slower, on the main thread for every tile
  if (array instanceof Float32Array && (name === 'normal' || name === 'color')) {
    const n = array.length;
    if (name === 'normal') {
      const out = new Int8Array(n);
      for (let i = 0; i < n; i++) { const v = array[i]; out[i] = Math.round((v < -1 ? -1 : v > 1 ? 1 : v) * 127); }
      return new THREE.BufferAttribute(out, itemSize, true);
    }
    let unit = true;
    for (let i = 0; i < n && unit; i++) { const v = array[i]; unit = v >= 0 && v <= 1; }
    if (unit) {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.round(array[i] * 255);
      return new THREE.BufferAttribute(out, itemSize, true);
    }
  }
  return new THREE.BufferAttribute(array, itemSize, a.normalized);
}

// Triangles longer than this are halved (at their longest edge's middle, as the cut itself does) before the layer is
// shared out, so one polygon over the whole town (the road surface) is cut on every core rather than one
const SHARE_EDGE = 200;
function splitLong(layer) {
  const { attrs, count } = layer;
  const pos = attrs.find((a) => a.name === 'position').array, max2 = SHARE_EDGE * SHARE_EDGE;
  const long = (i) => (pos[i * 3] - pos[i * 3 + 3]) ** 2 + (pos[i * 3 + 2] - pos[i * 3 + 5]) ** 2 > max2
    || (pos[i * 3 + 3] - pos[i * 3 + 6]) ** 2 + (pos[i * 3 + 5] - pos[i * 3 + 8]) ** 2 > max2
    || (pos[i * 3 + 6] - pos[i * 3]) ** 2 + (pos[i * 3 + 8] - pos[i * 3 + 2]) ** 2 > max2;
  let any = false;
  for (let i = 0; i < count && !any; i += 3) any = long(i);
  if (!any) return layer;
  // Each long triangle as a list of smaller ones, in vertices of every attribute side by side (`stride` numbers)
  const sizes = attrs.map((a) => a.itemSize), stride = sizes.reduce((n, k) => n + k, 0);
  const P = sizes.slice(0, attrs.findIndex((a) => a.name === 'position')).reduce((n, k) => n + k, 0);
  const extra = [];
  const vertex = (i) => { const v = []; attrs.forEach((a, n) => { for (let k = 0; k < sizes[n]; k++) v.push(a.array[i * sizes[n] + k]); }); return v; };
  const d2 = (p, q) => (p[P] - q[P]) ** 2 + (p[P + 2] - q[P + 2]) ** 2;
  const mid = (p, q) => p.map((x, k) => (x + q[k]) / 2);
  const split = (a, b, c, into) => {
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), longest = Math.max(ab, bc, ca);
    if (longest <= max2) { into.push(a, b, c); return; }
    if (longest === ab) { const m = mid(a, b); split(a, m, c, into); split(m, b, c, into); }
    else if (longest === bc) { const m = mid(b, c); split(a, b, m, into); split(a, m, c, into); }
    else { const m = mid(c, a); split(a, b, m, into); split(m, b, c, into); }
  };
  let total = 0;
  const plan = [];
  for (let i = 0; i < count; i += 3) {
    if (!long(i)) { plan.push(i); total += 3; continue; }
    const into = [];
    split(vertex(i), vertex(i + 1), vertex(i + 2), into);
    plan.push(into); total += into.length;
  }
  const out = attrs.map((a) => new a.array.constructor(total * a.itemSize));
  let at = 0;
  for (const item of plan) {
    if (typeof item === 'number') {
      attrs.forEach((a, n) => out[n].set(a.array.subarray(item * sizes[n], (item + 3) * sizes[n]), at * sizes[n]));
      at += 3;
    } else {
      for (const v of item) {
        let o = 0;
        attrs.forEach((a, n) => { for (let k = 0; k < sizes[n]; k++) out[n][at * sizes[n] + k] = v[o++]; });
        at++;
      }
    }
  }
  return { count: total, attrs: attrs.map((a, n) => ({ ...a, array: out[n] })) };
}

// A layer in square tiles by where each triangle's middle falls (as splitIntoTiles), as layers (`keyed`: a Map of them
// by each tile's key, x * 100000 + z in tiles, every one kept however few there are)
function tilesOfLayer(layer, size = TILE, keyed = false) {
  const pos = layer.attrs.find((a) => a.name === 'position').array, triangles = layer.count / 3;
  const tileOf = new Int32Array(triangles), counts = new Map();
  for (let t = 0; t < triangles; t++) {
    const o = t * 9;
    const key = Math.floor((pos[o] + pos[o + 3] + pos[o + 6]) / 3 / size) * 100000
      + Math.floor((pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3 / size);
    tileOf[t] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size < 2 && !keyed) return [layer];
  const tiles = new Map();
  for (const [key, n] of counts) tiles.set(key, { count: n * 3, used: 0, attrs: layer.attrs.map((a) => ({ ...a, array: new a.array.constructor(n * 3 * a.itemSize) })) });
  for (let t = 0; t < triangles; t++) {
    const tile = tiles.get(tileOf[t]);
    for (let n = 0; n < layer.attrs.length; n++) {
      const src = layer.attrs[n].array, dst = tile.attrs[n].array, size = layer.attrs[n].itemSize * 3;
      const from = t * size, to = tile.used * size;
      for (let k = 0; k < size; k++) dst[to + k] = src[from + k];
    }
    tile.used++;
  }
  if (keyed) return new Map([...tiles].map(([key, { count, attrs }]) => [key, { count, attrs }]));
  return [...tiles.values()].map(({ count, attrs }) => ({ count, attrs }));
}

// A quick fingerprint of numbers, for the saved layers' keys: two 32-bit lanes over the bytes, 4 at a time
function fingerprint(arrays, seed = 0) {
  let h1 = 0x9e3779b9 ^ seed, h2 = 0x85ebca6b ^ seed;
  for (const a of arrays) {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      h1 = Math.imul(h1 ^ w, 0x01000193);
      h2 = Math.imul(h2 + w, 0x5bd1e995) ^ (h2 >>> 15);
    }
    for (let i = words.length * 4; i < bytes.length; i++) h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h1 = Math.imul(h1 ^ a.length, 0x01000193);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
const textBytes = (text) => new TextEncoder().encode(text);

// The heights' data a worker needs (ground-core.js) and its fingerprint, with the cutting's own code in it, so a change
// to the ground or to how it's cut makes every saved layer again
const groundData = new WeakMap();
// (without the heights, the city stays flat: nothing is cut, and its tiles are kept under a key of their own)
const FLAT_GROUND = { ground: null, key: 'flat' };
function groundOfGrid(g) {
  if (!g) return FLAT_GROUND;
  if (!groundData.has(g)) {
    const r = g.river;
    const c = g.core;
    // on the city's mesh a worker needs only it and the bridges' decks
    // (and where the river's dug, so the layers under a street's bridge go down out of sight there: deckLayer)
    const ground = c ? { core: c, river: r && { buckets: r.buckets, dx0: r.dx0, dz0: r.dz0, dstep: r.dstep, dcols: r.dcols, drows: r.drows,
      digBlocks: r.digBlocks, bcols: r.bcols } } : { x0: g.x0, z0: g.z0, step: g.step, cols: g.cols, rows: g.rows, heights: g.heights, river: r && {
      dx0: r.dx0, dz0: r.dz0, dstep: r.dstep, dcols: r.dcols, drows: r.drows, digBlocks: r.digBlocks, bcols: r.bcols,
      lx0: r.lx0, lz0: r.lz0, lstep: r.lstep, lcols: r.lcols, lrows: r.lrows, level: r.level, buckets: r.buckets
    } };
    const decks = r ? JSON.stringify(r.bridges) : '';
    const key = fingerprint([g.heights, ...(c ? [c.cm, c.split] : []), ...(r ? [r.digPresent, ...r.digBlocks.filter(Boolean), r.level] : []),
      textBytes(`${g.x0} ${g.z0} ${g.step} ${g.cols} ${g.rows} ${r ? [r.dx0, r.dz0, r.dstep, r.dcols, r.lx0, r.lz0, r.lstep, r.lcols].join(' ') : ''}`),
      textBytes(decks), textBytes(CORE_SOURCE)]);
    groundData.set(g, { ground, key });
  }
  return groundData.get(g);
}

// The saved layers, in the page's own database (IndexedDB), one for each part of the city, so saving one part's layers
// doesn't hold up reading the next part's: each layer by its key, and the keys the part used last, so the ones a change
// left behind are let go. Without a database every start cuts them again.
const opening = new Map();
try { indexedDB.deleteDatabase('ground-layers'); } catch {} // the one database all parts shared at first
function savedLayers(part) {
  if (!opening.has(part)) opening.set(part, new Promise((done) => {
    try {
      const request = indexedDB.open(`ground-layers-${part}`, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('layers'); request.result.createObjectStore('parts'); };
      request.onsuccess = () => done(request.result);
      request.onerror = request.onblocked = () => done(null);
    } catch { done(null); }
  }));
  return opening.get(part);
}
const asked = (request) => new Promise((done) => { request.onsuccess = () => done(request.result); request.onerror = () => done(undefined); });
async function readSaved(part, keys) {
  const db = await savedLayers(part);
  if (!db) return keys.map(() => undefined);
  try {
    const store = db.transaction('layers').objectStore('layers');
    return await Promise.all(keys.map((k) => asked(store.get(k))));
  } catch { return keys.map(() => undefined); }
}
async function writeSaved(part, keys, made) {
  const db = await savedLayers(part);
  if (!db) return;
  try {
    const t = db.transaction(['layers', 'parts'], 'readwrite');
    const layers = t.objectStore('layers'), parts = t.objectStore('parts');
    const before = (await asked(parts.get(part))) || [];
    for (const [k, layer] of made) layers.put(layer, k);
    for (const k of before) if (!keys.includes(k)) layers.delete(k);
    parts.put(keys, part);
  } catch (error) { log(`[drape] not saved: ${error?.message || error}`); }
}

// Cuts the layers (`jobs`: { layer, tolerance }) on several cores: each long triangle halved first (splitLong), then the
// triangles shared out in many small pieces by how much ground they cover, round and round the workers, so the hills
// fall to all of them. Answers each job's draped layer, in order.
async function cutOnCores(ground, jobs, most = 8) {
  // (each worker gets its own copy of the ground's mesh: a few streamed tiles are cut on fewer)
  const cores = Math.max(2, Math.min(most, (navigator.hardwareConcurrency || 4) - 1));
  const pieces = [];
  let total = 0;
  const weights = jobs.map((job) => {
    const pos = job.layer.attrs.find((a) => a.name === 'position').array, w = new Float32Array(job.layer.count / 3);
    for (let t = 0; t < w.length; t++) {
      const o = t * 9;
      const area = Math.abs((pos[o + 3] - pos[o]) * (pos[o + 8] - pos[o + 2]) - (pos[o + 6] - pos[o]) * (pos[o + 5] - pos[o + 2])) / 2;
      w[t] = 1 + area / 50;
      total += w[t];
    }
    return w;
  });
  const share = total / (cores * 12);
  jobs.forEach((job, j) => {
    const w = weights[j];
    let from = 0, sum = 0;
    for (let t = 0; t < w.length; t++) {
      sum += w[t];
      if (sum >= share || t === w.length - 1) {
        const a = from * 3, b = (t + 1) * 3;
        pieces.push({ job: j, tolerance: job.tolerance, count: b - a, from: a,
          attrs: job.layer.attrs.map((x) => ({ ...x, array: x.array.slice(a * x.itemSize, b * x.itemSize) })) });
        from = t + 1; sum = 0;
      }
    }
  });
  const batches = Array.from({ length: Math.min(cores, pieces.length) }, () => []);
  pieces.forEach((p, i) => batches[i % batches.length].push(p));
  // A worker that fails (it couldn't start, or ran out of memory) has its share cut here instead, from fresh copies of
  // the pieces (their own arrays went to the worker), so the start goes on rather than stopping or waiting for it
  const answers = await Promise.all(batches.map((batch) => work('js/drape-worker.js', { ground, pieces: batch },
    batch.flatMap((p) => p.attrs.map((a) => a.array.buffer))).catch((error) => {
    log(`[drape] a worker failed, its share cut here: ${error?.message || error}`);
    return { results: batch.map((p) => {
      const layer = jobs[p.job].layer;
      const piece = { count: p.count, attrs: layer.attrs.map((x) => ({ ...x, array: x.array.slice(p.from * x.itemSize, (p.from + p.count) * x.itemSize) })) };
      return drapeLayer(ground, piece, p.tolerance);
    }) };
  })));
  // Each job's pieces, back in their order
  const parts = jobs.map(() => []);
  batches.forEach((batch, b) => batch.forEach((p, i) => parts[p.job].push([pieces.indexOf(p), answers[b].results[i]])));
  return parts.map((list, j) => {
    list.sort((x, y) => x[0] - y[0]);
    const count = list.reduce((n, [, r]) => n + r.count, 0);
    let index;
    // (on the city's mesh the pieces come back indexed: their indexes put one after another, each past those before)
    if (list.length && list[0][1].index) {
      index = new Uint32Array(list.reduce((n, [, r]) => n + r.index.length, 0));
      let at = 0, base = 0;
      for (const [, r] of list) {
        for (let i = 0; i < r.index.length; i++) index[at + i] = r.index[i] + base;
        at += r.index.length; base += r.count;
      }
    }
    return { count, index, attrs: jobs[j].layer.attrs.map((a, k) => {
      const array = new a.array.constructor(count * a.itemSize);
      let at = 0;
      for (const [, r] of list) { array.set(r.attrs[k].array, at); at += r.attrs[k].array.length; }
      return { name: a.name, array, itemSize: a.itemSize, normalized: a.normalized };
    }) };
  });
}

// The layers draped, each as its tiles (tilesOfLayer; one for a small mesh): those saved by an earlier start with the
// same ground, code and layer read back, the rest cut on several cores and saved
async function drapeLayers(part, jobs) {
  const { ground, key: groundKey } = groundOfGrid(grid);
  for (const job of jobs) job.key = `${groundKey}.${job.instances ? 'i' : 'm'}${job.tolerance}.${fingerprint(job.inputs)}`;
  const saved = await readSaved(part, jobs.map((j) => j.key));
  const missing = jobs.filter((j, i) => !(j.tiles = saved[i]));
  if (missing.length) {
    for (const job of missing) job.layer = splitLong(job.make());
    if (grid.core) {
      // on the city's mesh the cut comes back indexed: a big layer is put in its tiles first and each tile cut
      const parts = missing.map((j) => (j.instances || j.layer.count > 30000 ? tilesOfLayer(j.layer) : [j.layer]));
      const cut = await cutOnCores(ground, parts.flatMap((list, i) => list.map((layer) => ({ layer, tolerance: missing[i].tolerance }))));
      let at = 0;
      missing.forEach((j, i) => { j.tiles = cut.slice(at, (at += parts[i].length)); j.layer = null; });
    } else {
      const cut = await cutOnCores(ground, missing);
      missing.forEach((j, i) => {
        j.tiles = j.instances || cut[i].count > 30000 ? tilesOfLayer(cut[i]) : [cut[i]];
        j.layer = null;
      });
    }
    writeSaved(part, jobs.map((j) => j.key), missing.map((j) => [j.key, j.tiles]));
  }
  return missing.length;
}


// ---- Ground streamed around the player (a phone, or a Mac without much memory: device-tier.js) ----------------------
// The whole city's ground cut to follow the hills is far more than a phone's browser holds. Streamed, each big layer is
// kept flat (a tenth of its cut size) in STREAM_TILE squares, and only the squares within `radius` of the player are
// cut and drawn, read back from the page's database when an earlier play cut them; those left far behind are let go.
const STREAM_TILE = 500;
const stream = hot(import.meta).keep('groundStream', () => ({ radius: 0, x: 0, z: 0, layers: [], busy: false, cut: 0 }));
// Streams the big ground layers set on the ground from here on, around (x, z) to begin with
function streamGround(radius, x = 0, z = 0) {
  Object.assign(stream, { radius, x, z });
}
const tileKeyOf = (x, z) => Math.floor(x / STREAM_TILE) * 100000 + Math.floor(z / STREAM_TILE);
// How far (x, z) is from a tile's square
function tileDistance(key, x, z) {
  const tx = Math.round(key / 100000), tz = key - tx * 100000;
  const dx = Math.max(tx * STREAM_TILE - x, 0, x - (tx + 1) * STREAM_TILE);
  const dz = Math.max(tz * STREAM_TILE - z, 0, z - (tz + 1) * STREAM_TILE);
  return Math.hypot(dx, dz);
}

// The page's database of cut tiles, one record per layer's tile; the layers each part last streamed, so the tiles of
// one a change left behind are let go
let tileBase = null;
function tileDatabase() {
  return tileBase ??= new Promise((done) => {
    try {
      const request = indexedDB.open('ground-tiles', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('tiles'); request.result.createObjectStore('parts'); };
      request.onsuccess = () => done(request.result);
      request.onerror = request.onblocked = () => done(null);
    } catch { done(null); }
  });
}
async function forgetOldTiles(part, keys) {
  const db = await tileDatabase();
  if (!db) return;
  try {
    const t = db.transaction(['tiles', 'parts'], 'readwrite');
    const tiles = t.objectStore('tiles'), parts = t.objectStore('parts');
    const before = (await asked(parts.get(part))) || [];
    for (const k of before) if (!keys.includes(k)) tiles.delete(IDBKeyRange.bound(`${k}/`, `${k}/￿`));
    parts.put(keys, part);
  } catch {}
}
async function readTiles(names) {
  const db = await tileDatabase();
  if (!db) return names.map(() => undefined);
  try {
    const store = db.transaction('tiles').objectStore('tiles');
    return await Promise.all(names.map((k) => asked(store.get(k))));
  } catch { return names.map(() => undefined); }
}
// (answers whether they're safely in the database)
async function writeTiles(made) {
  const db = await tileDatabase();
  if (!db) return false;
  try {
    const t = db.transaction('tiles', 'readwrite'), store = t.objectStore('tiles');
    for (const [k, layer] of made) store.put(layer, k);
    return await new Promise((done) => { t.oncomplete = () => done(true); t.onerror = t.onabort = () => done(false); });
  } catch (error) { log(`[stream] not saved: ${error?.message || error}`); return false; }
}

// A whole layer's tile kept flat is let go once its cut is in the database (it's read back from there whenever it's
// wanted again): about a hundred megabytes for the whole town. This marks it.
const SAVED = 'saved';
// The tiles of a layer an earlier play already cut and saved, let go of flat at once
async function forgetSavedFlats(layer) {
  const db = await tileDatabase();
  if (!db) return;
  try {
    const store = db.transaction('tiles').objectStore('tiles');
    const names = await asked(store.getAllKeys(IDBKeyRange.bound(`${layer.key}/`, `${layer.key}/\uffff`)));
    for (const name of names || []) {
      const k = Number(String(name).slice(layer.key.length + 1));
      if (layer.flat.get(k)) layer.flat.set(k, SAVED);
    }
  } catch {}
}

// Takes a ground layer's job (setOnTerrain) to stream: a group in the mesh's place, filled with its tiles near (x, z)
function streamLayer(part, job, groundKey) {
  const obj = job.obj;
  const key = `${groundKey}.${job.instances ? 'i' : 'm'}${job.tolerance}.${fingerprint(job.inputs)}`;
  const flat = tilesOfLayer(splitLong(job.make()), STREAM_TILE, true);
  const group = new THREE.Group();
  group.name = obj.name;
  const look = { material: obj.material, castShadow: obj.castShadow, receiveShadow: obj.receiveShadow, renderOrder: obj.renderOrder,
    frustumCulled: job.instances ? true : obj.frustumCulled, mask: job.instances ? 1 : obj.layers.mask };
  const layer = { part, key, tolerance: job.tolerance, group, look, flat, built: new Map(), away: 0 };
  stream.layers.push(layer);
  forgetSavedFlats(layer);
  return layer;
}

// A ground layer made square by square from files (yards.js) rather than kept flat for the whole city: `squares` its
// tiles' keys, `make(k)` a promise of the flat geometry there (or none), made only when a tile is wanted and not saved
// from an earlier play, and let go once cut. `key` names what it's made from, for the saved tiles.
function streamFromSquares(part, { name, key, squares, make, look, tolerance = 0.16 }) {
  const { key: groundKey } = groundOfGrid(grid);
  const group = new THREE.Group();
  group.name = name;
  group.userData.terrain = 'set';
  const layer = { part, key: `${groundKey}.s${tolerance}.${key}`, tolerance, group, make, flat: new Map(squares.map((k) => [k, null])), built: new Map(), away: 0,
    look: { castShadow: false, receiveShadow: true, renderOrder: 0, frustumCulled: true, mask: 1, ...look } };
  if (opaque(layer.look.material)) layer.look.renderOrder += GROUND_ORDER; // (the ground drawn last: groundOrder)
  stream.layers.push(layer);
  return layer;
}
// Draws a part's streamed layers near the player now, before the part is shown
function streamNear(layers) {
  if (layers.length) forgetOldTiles(layers[0].part, layers.map((layer) => layer.key));
  return buildTiles(wantedTiles(stream.x, stream.z, layers), true);
}

// The tiles wanted near (x, z) and not drawn, nearest first, as [layer, tile key]
function wantedTiles(x, z, layers = stream.layers) {
  const want = [], R = stream.radius;
  // only the squares that can be within the radius are asked about, not every square of every layer
  const tx0 = Math.floor((x - R) / STREAM_TILE), tx1 = Math.floor((x + R) / STREAM_TILE);
  const tz0 = Math.floor((z - R) / STREAM_TILE), tz1 = Math.floor((z + R) / STREAM_TILE);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let tz = tz0; tz <= tz1; tz++) {
      const k = tx * 100000 + tz, d = tileDistance(k, x, z);
      if (d >= R) continue;
      for (const layer of layers) if (layer.flat.has(k) && !layer.built.has(k)) want.push([d, layer, k]);
    }
  }
  return want.sort((a, b) => a[0] - b[0]).map(([, layer, k]) => [layer, k]);
}

// Draws these tiles: read back or cut on several cores, then saved. At the start (`now`) they go straight in, so the
// ground near the player is in the scene, uploaded and compiled behind the loading screen; while playing on a device
// that spreads its loads they're put in one a frame (putStreamedGround).
async function buildTiles(list, now = false) {
  const { ground } = groundOfGrid(grid);
  const names = list.map(([layer, k]) => `${layer.key}/${k}`);
  const saved = await readTiles(names);
  let missing = list.map((item, i) => [item, i]).filter(([, i]) => !saved[i]);
  // a layer made square by square makes its tile now: flat, in its tiles as a whole layer's are, this one kept
  // (a tile with nothing of it is saved empty, so it isn't made again; one whose file couldn't be read is left out,
  // neither saved nor drawn, and asked for again a little later: updateGroundStreaming)
  const FAILED = 0;
  const flats = await Promise.all(missing.map(async ([[layer, k]]) => {
    if (!layer.make) {
      const flat = layer.flat.get(k);
      if (flat !== SAVED) return flat;
      // let go as saved, but not found there now: asked again a little later
      log(`[stream] ${layer.group.name} ${k}: its saved tile is missing`);
      stream.retryAt = performance.now() + 4000;
      return FAILED;
    }
    try {
      const geo = await layer.make(k);
      if (!geo?.attributes.position?.count) return null;
      return tilesOfLayer(splitLong(layerOfGeometry(geo)), STREAM_TILE, true).get(k) || null;
    } catch (error) {
      log(`[stream] ${layer.group.name} ${k}: ${error?.message || error}`);
      stream.retryAt = performance.now() + 4000;
      return FAILED;
    }
  }));
  missing.forEach(([, i], n) => { if (flats[n] === null || flats[n] === undefined) saved[i] = { count: 0, attrs: [] }; });
  const empty = missing.filter((_, n) => flats[n] === null || flats[n] === undefined);
  if (empty.length) writeTiles(empty.map(([, i]) => [names[i], saved[i]]));
  const toCut = flats.filter(Boolean);
  missing = missing.filter((_, n) => flats[n]);
  if (missing.length) {
    // (flat, without the heights: drawn as made)
    const cut = ground ? await cutOnCores(ground, toCut.map((flat, n) => ({ layer: flat, tolerance: missing[n][0][0].tolerance })), 3) : toCut;
    missing.forEach(([, i], n) => { saved[i] = cut[n]; });
    const kept = missing.map(([[layer, k]]) => [layer, k]);
    writeTiles(missing.map(([, i]) => [names[i], saved[i]])).then((done) => {
      if (done) for (const [layer, k] of kept) if (!layer.make && layer.flat.get(k)) layer.flat.set(k, SAVED);
    });
    stream.cut += missing.length;
  }
  list.forEach(([layer, k], i) => {
    if (layer.built.has(k) || !saved[i]) return;
    if (!saved[i].count) { layer.built.set(k, null); return; }
    const { look } = layer;
    const mesh = new THREE.Mesh(geometryOfLayer(saved[i]), look.material);
    mesh.castShadow = look.castShadow;
    mesh.receiveShadow = look.receiveShadow;
    mesh.renderOrder = look.renderOrder;
    mesh.frustumCulled = look.frustumCulled;
    mesh.layers.mask = look.mask;
    mesh.name = layer.group.name;
    mesh.userData.streamed = true;
    gpuOnly(mesh);
    layer.built.set(k, mesh);
    const put = () => {
      if (layer.built.get(k) !== mesh) return; // let go before it was put in
      layer.group.add(mesh);
      mesh.updateMatrixWorld(true);
    };
    // Lamp: on the Xbox one a frame (putStreamedGround), so a batch's uploads don't all land on one frame
    if (TIER.spreadLoads && !now) (stream.pending ||= []).push(put); else put();
  });
  return missing.length;
}

// Puts the next streamed tile waiting into the scene: called every frame, apart from the scan for what to build
// (updateGroundStreaming), which a device short of processor runs less often. Answers whether one went in.
function putStreamedGround() {
  if (!stream.pending?.length) return false;
  stream.pending.shift()();
  return true;
}

// Every frame: the tiles the player has come near are drawn (a few at a time, one batch in hand), and those left more
// than 400 m beyond the radius let go. Answers whether any were drawn or let go.
const AWAY = TIER.keepBeyond ?? 300, BATCH = 6; // (a phone lets go sooner: device-tier.js)
// (a second player's place, in split screen, keeps and fills the tiles around them too)
function updateGroundStreaming(x, z, x2 = NaN, z2 = NaN) {
  if (!stream.radius || !stream.layers.length) return false;
  const two = Number.isFinite(x2) && Number.isFinite(z2);
  stream.x = x; stream.z = z;
  let changed = false;
  for (const layer of stream.layers) {
    // a part a change built again leaves its old layers out of the scene
    let top = layer.group;
    while (top.parent) top = top.parent;
    // (counted only once it's been in the scene: a part still being set on the ground hasn't put it there yet)
    if (top.isScene) { layer.placed = true; layer.away = 0; } else if (layer.placed) layer.away++;
    for (const [k, mesh] of layer.built) {
      if (tileDistance(k, x, z) < stream.radius + AWAY || (two && tileDistance(k, x2, z2) < stream.radius + AWAY)) continue;
      mesh?.removeFromParent();
      mesh?.geometry.dispose();
      layer.built.delete(k);
      changed = true;
    }
  }
  const before = stream.layers.length;
  stream.layers = stream.layers.filter((layer) => layer.away < 600);
  if (stream.layers.length < before) log(`[stream] let go of ${before - stream.layers.length} layers no longer drawn`);
  if (putStreamedGround()) changed = true;
  // (after a tile that couldn't be made or cut, a few seconds' wait before asking again, not a try every frame)
  if (!stream.busy && !(stream.pending?.length > BATCH) && !(performance.now() < (stream.retryAt || 0))) {
    const layers = stream.layers.filter((layer) => !layer.away);
    let want = wantedTiles(x, z, layers).slice(0, BATCH);
    if (two && want.length < BATCH) want = want.concat(wantedTiles(x2, z2, layers).filter(([l, k]) => !want.some(([l2, k2]) => l2 === l && k2 === k)).slice(0, BATCH - want.length));
    if (want.length) {
      stream.busy = true;
      buildTiles(want).catch((error) => {
        log(`[stream] ${error?.message || error}`);
        stream.retryAt = performance.now() + 4000;
      }).finally(() => { stream.busy = false; });
    }
  }
  return changed;
}

// What the streamed layers keep flat in the script for the tiles not drawn yet, in bytes
function groundStreamBytes(byLayer = null) {
  let bytes = 0;
  for (const layer of stream.layers) {
    if (layer.away) continue;
    let b = 0;
    let names = '';
    for (const t of layer.flat.values()) if (t?.attrs) { for (const a of t.attrs) b += a.array.byteLength; names ||= t.attrs.map((a) => a.name).join('/'); }
    bytes += b;
    if (byLayer && b) byLayer.push([`${layer.group.name}(${names})`, b]);
  }
  return bytes;
}

// Where the streaming is centred now: the player's last place, or where they start
function groundStreamCenter() {
  return { x: stream.x, z: stream.z };
}

// What's streamed now: tiles drawn, and their vertices
function groundStreamStats() {
  let tiles = 0, layers = 0;
  for (const layer of stream.layers) { for (const m of layer.built.values()) if (m) tiles++; layers++; }
  return { layers, tiles, radius: stream.radius };
}

// The ground is drawn after everything else that isn't see-through: what's laid on it here (its opaque layers, given
// renderOrder GROUND_ORDER more than their own) and the outskirts' land. So a pool's opening (pools.js), drawn between
// the two, hides only the ground over the pool, not a swimmer, a car or a ladder under its water, which drew before it.
const GROUND_ORDER = 10;
const opaque = (m) => (Array.isArray(m) ? !m.some((x) => x.transparent) : !m?.transparent);
function groundOrder(obj) {
  if (obj.userData.groundOrdered || !opaque(obj.material)) return;
  obj.renderOrder += GROUND_ORDER;
  obj.userData.groundOrdered = true;
}
const IDENTITY = new THREE.Matrix4();
const isIdentity = (m) => m.elements.every((v, i) => Math.abs(v - IDENTITY.elements[i]) < 1e-6);

// Sets a part of the city built flat on the ground. What's drawn in world space (merged batches, a single polygon of
// the whole island) follows the ground vertex by vertex, cut finer where it bends (ground-core.js); an object placed by
// its own transform is lifted whole by the ground at its position; instances are lifted each by its own, and those
// marked userData.terrain = 'drape' (big flat slabs) are made into one geometry that follows the ground. Anything
// marked userData.terrain = 'set' was put on the ground where it was built and is left alone, children included.
// The cutting is the slow part of a start: it's done on several cores and saved, so a later start with the same city
// reads it back (drapeLayers). Answers a promise when there's cutting to wait for, else nothing.
function setOnTerrain(root, tolerance = 0.16) {
  if (!grid || !root) return null;
  root.updateMatrixWorld(true);
  const replace = [], jobs = [];
  const visit = (obj) => {
    if (obj.userData.terrain === 'set') return;
    if (obj.isInstancedMesh) {
      if (obj.userData.terrain === 'drape') groundOrder(obj);
      if (obj.userData.terrain === 'drape') jobs.push({ obj, instances: true, inputs: instanceInputs(obj), make: () => layerOfInstances(obj), tolerance });
      else liftInstances(obj);
    } else if ((obj.isMesh || obj.isLine || obj.isPoints) && obj.geometry?.attributes.position) {
      if (isIdentity(obj.matrixWorld)) {
        // Road markings carry each vertex's offset to its strip's edge (`side`), which a cut would average away:
        // they're built in short lengths instead and only laid on the ground; lines and points can't be cut
        // (on the city's mesh every mesh is cut along its triangles, the markings too: an edge's cut interpolates them)
        const cut = obj.isMesh && !obj.geometry.attributes.side ? obj.userData.terrainTolerance ?? tolerance : 0;
        if (obj.isMesh) groundOrder(obj);
        if (cut || (grid.core && obj.isMesh)) jobs.push({ obj, inputs: geometryInputs(obj.geometry), make: () => layerOfGeometry(obj.geometry), tolerance: cut });
        else if (obj.isMesh) {
          const tiles = meshOnGround(obj, drapeGeometry(obj.geometry, 0));
          if (tiles) replace.push([obj, tiles]);
        } else obj.geometry = drapeGeometry(obj.geometry, 0);
      } else {
        const at = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
        const lift = groundHeight(at.x, at.z);
        if (lift && obj.parent) {
          const world = at.clone().setY(at.y + lift);
          obj.position.copy(obj.parent.worldToLocal(world));
          obj.updateMatrixWorld(true);
        }
      }
      return; // a mesh's children (rare) move with it
    }
    for (const child of [...obj.children]) visit(child);
  };
  visit(root);
  const finish = () => {
    for (const job of jobs) {
      const obj = job.obj, geometries = job.tiles.map(geometryOfLayer);
      job.tiles = null;
      if (!job.instances && geometries.length === 1) {
        obj.geometry.dispose();
        obj.geometry = geometries[0];
        continue;
      }
      const group = new THREE.Group();
      group.name = obj.name;
      for (const g of geometries) {
        const tile = new THREE.Mesh(g, obj.material);
        tile.castShadow = obj.castShadow;
        tile.receiveShadow = obj.receiveShadow;
        tile.renderOrder = obj.renderOrder;
        if (!job.instances) {
          tile.frustumCulled = obj.frustumCulled;
          tile.layers.mask = obj.layers.mask;
        }
        // (a chunk hidden far off stays so in its tiles: road-paint.js)
        if (obj.userData.cullDistance) tile.userData.cullDistance = obj.userData.cullDistance;
        if (obj.userData.sharesPipelineWith) tile.userData.sharesPipelineWith = obj.userData.sharesPipelineWith;
        tile.name = obj.name;
        group.add(tile);
      }
      replace.push([obj, group]);
    }
    for (const [old, draped] of replace) {
      old.parent.add(draped);
      old.removeFromParent();
    }
  };
  if (!jobs.length) { finish(); return null; }
  const began = performance.now();
  // Streamed, the big layers are drawn only near the player (streamGround): the tiles near them now are waited for
  if (stream.radius) {
    const { key: groundKey } = groundOfGrid(grid);
    // (a layer of a few big triangles, a lawn, comes to millions of vertices once cut: only what's small on the map, or
    // has few vertices over a small area, is drawn whole)
    const big = jobs.filter((job) => {
      if (job.instances) return true;
      if (job.obj.userData.cullDistance) return false; // already in chunks, hidden far off (road-paint.js)
      const geo = job.obj.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      return Math.max(max.x - min.x, max.z - min.z) > STREAM_TILE || geo.attributes.position.count > 2000;
    });
    const layers = big.map((job) => {
      const layer = streamLayer(root.name, job, groundKey);
      replace.push([job.obj, layer.group]);
      return layer;
    });
    forgetOldTiles(root.name, layers.map((layer) => layer.key));
    const rest = jobs.filter((job) => !big.includes(job));
    jobs.length = 0;
    jobs.push(...rest);
    const near = wantedTiles(stream.x, stream.z, layers);
    return Promise.all([rest.length ? drapeLayers(root.name, rest) : 0, buildTiles(near, true)]).then(([cut, cutTiles]) => {
      finish();
      log(`[drape] ${root.name}: ${rest.length} layers (${cut} cut), ${layers.length} streamed: ${near.length} tiles within ${stream.radius} m (${cutTiles} cut), in ${Math.round(performance.now() - began)} ms`);
    });
  }
  return drapeLayers(root.name, jobs).then((cut) => {
    finish();
    log(`[drape] ${root.name}: ${jobs.length} layers, ${jobs.length - cut} read back, ${cut} cut, in ${Math.round(performance.now() - began)} ms`);
  });
}

// A flat layer laid on another (a driveway on the lawn, a fairway on the grass) drawn in front of it as if `lift`
// metres higher: each vertex is moved along its own line of sight toward the camera, so it covers the same pixels and
// only its depth changes, by what a lift of `lift` comes to at the angle it's seen from (capped far off at a glance).
// On the city's mesh both are cut along the same triangles, so this only keeps two layers at nearly one height from
// flickering into each other far off, where the depth buffer can't tell a few millimetres apart.
function drawOver(mat, lift = LIFT.over) {
  const toCamera = cameraPosition.sub(positionWorld);
  const dir = normalize(toCamera);
  const pull = min(float(lift).div(max(abs(dir.y), 0.02)), toCamera.length().mul(0.5));
  mat.positionNode = positionLocal.add(dir.mul(pull));
  mat.polygonOffset = false;
  return mat;
}

export {
  drawOver, cityGround,
  GROUND_ORDER, loadTerrain, riverBridges, setPools, groundHeight, deckTop, groundUnderStreets, riverbedHeight, riverDepth, riverFlow, nearestWater, waterLevel, bridgeDecks, footbridgeTop, riverGaps, groundUnder, stadiumGround, groundSlope, groundTilt, groundHeightNode,
  tessellate, drapeGeometry, liftGeometry, liftInstances, setOnTerrain,
  streamGround, updateGroundStreaming, putStreamedGround, groundStreamStats, groundStreamCenter, groundStreamBytes, streamFromSquares, streamNear
};
