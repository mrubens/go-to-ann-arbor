// The Border to Border Trail as a route (b2b-data.js, OpenStreetMap's relation 38467): what's on it near a point, how
// far each place along it is by the trail, and its lines for the maps. Plain data, no scene: the map, the place label,
// the walkers and b2b-trail.js (its paint, signs and riders) all read it.
import { B2B_WAYS, B2B_PLACES } from './b2b-data.js';

const B2B_NAME = 'Border to Border Trail';
const OWN = 1, BOARDWALK = 2, BRIDGE = 4;
// the trail is ten feet of asphalt; OSM's narrower widths are rough guesses
const TREAD = 3.05;

// Each way: its flags, width and points, with the distance along it at each point
const WAYS = B2B_WAYS.map((w, i) => {
  const pts = [];
  for (let k = 2; k + 1 < w.length; k += 2) pts.push([w[k], w[k + 1]]);
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const flags = w[0];
  return { i, flags, own: (flags & OWN) > 0, bridge: (flags & (BRIDGE | BOARDWALK)) > 0, width: flags & OWN ? Math.max(TREAD, w[1]) : 0, pts, cum, len: cum[cum.length - 1] };
});

// --- Segments by 25 m cell, for what's near a point
const CELL = 25;
const cells = new Map();
const cellKey = (ix, iz) => ix * 100003 + iz;
for (const w of WAYS) {
  for (let k = 0; k + 1 < w.pts.length; k++) {
    const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1];
    const x0 = Math.floor((Math.min(ax, bx) - 4) / CELL), x1 = Math.floor((Math.max(ax, bx) + 4) / CELL);
    const z0 = Math.floor((Math.min(az, bz) - 4) / CELL), z1 = Math.floor((Math.max(az, bz) + 4) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const key = cellKey(ix, iz);
      let c = cells.get(key);
      if (!c) cells.set(key, (c = []));
      c.push(w.i * 65536 + k);
    }
  }
}

/**
 * The trail's nearest point to (x, z) within `reach` metres: { way, k (its segment), f (along it, 0..1), d (off it),
 * x, z, tx, tz (its heading), s (metres along the way) }, else null. `ownOnly`: its own path and bridges, not the
 * streets it follows
 */
function b2bNearest(x, z, reach = 6, ownOnly = false) {
  let best = null, bestD = reach;
  const r = Math.ceil(reach / CELL);
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const c = cells.get(cellKey(cx + i, cz + j));
    if (!c) continue;
    for (const id of c) {
      const w = WAYS[id >>> 16], k = id & 65535;
      if (ownOnly && !w.own) continue;
      const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1];
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const px = ax + ex * f, pz = az + ez * f, d = Math.hypot(x - px, z - pz);
      if (d < bestD) {
        const l = Math.sqrt(l2);
        bestD = d;
        best = { way: w, k, f, d, x: px, z: pz, tx: ex / l, tz: ez / l, s: w.cum[k] + l * f };
      }
    }
  }
  return best;
}

/** On the trail's own path (or one of its bridges) at (x, z): within its half width and a little more */
function onB2B(x, z, margin = 1.2) {
  const n = b2bNearest(x, z, TREAD / 2 + margin + 1, true);
  return Boolean(n && n.d <= (n.way.width || TREAD) / 2 + margin);
}

// --- The trail as a graph (its points, joined where ways share one or end within 4 m of another), and from each place
// along it the distance by the trail to every point, so a sign knows how far each place is and which way
const nodeOf = new Map(); // "x,z" -> node
const NX = [], NZ = [], ADJ = [];
const node = (x, z) => {
  const key = `${x},${z}`;
  let n = nodeOf.get(key);
  if (n === undefined) { n = NX.length; nodeOf.set(key, n); NX.push(x); NZ.push(z); ADJ.push([]); }
  return n;
};
const link = (a, b, d) => { if (a !== b) { ADJ[a].push(b, d); ADJ[b].push(a, d); } };
for (const w of WAYS) {
  w.nodes = w.pts.map(([x, z]) => node(x, z));
  for (let k = 0; k + 1 < w.nodes.length; k++) link(w.nodes[k], w.nodes[k + 1], w.cum[k + 1] - w.cum[k]);
}
// an end that meets nothing: joined to the nearest point of another way within 4 m
for (const w of WAYS) {
  for (const end of [0, w.nodes.length - 1]) {
    const n = w.nodes[end];
    if (ADJ[n].length > 2) continue;
    let best = -1, bestD = 4;
    for (let m = 0; m < NX.length; m++) {
      if (m === n || w.nodes.includes(m)) continue;
      const d = Math.hypot(NX[m] - NX[n], NZ[m] - NZ[n]);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best >= 0) link(n, best, bestD);
  }
}
const nearestNode = (x, z) => {
  let best = 0, bestD = Infinity;
  for (let m = 0; m < NX.length; m++) {
    const d = (NX[m] - x) ** 2 + (NZ[m] - z) ** 2;
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
};
// Dijkstra from a node, with a small binary heap
function distancesFrom(start) {
  const dist = new Float64Array(NX.length).fill(Infinity);
  const heap = [[0, start]];
  dist[start] = 0;
  while (heap.length) {
    const [d, n] = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    if (d > dist[n]) continue;
    const adj = ADJ[n];
    for (let j = 0; j < adj.length; j += 2) {
      const v = adj[j], nd = d + adj[j + 1];
      if (nd < dist[v]) {
        dist[v] = nd;
        heap.push([nd, v]);
        for (let i = heap.length - 1; i > 0;) {
          const p = (i - 1) >> 1;
          if (heap[p][0] <= heap[i][0]) break;
          [heap[i], heap[p]] = [heap[p], heap[i]];
          i = p;
        }
      }
    }
  }
  return dist;
}
let PLACES = null;
/** The places along it ({ name, x, z, dist: by the trail to each graph node }), worked out on first use */
function b2bPlaces() {
  if (!PLACES) PLACES = B2B_PLACES.map(([name, x, z]) => ({ name, x, z, node: nearestNode(x, z), dist: distancesFrom(nearestNode(x, z)) }));
  return PLACES;
}

/**
 * From way `w`'s point `k`, each place ahead of it (the way's own direction, `dir` 1, or back along it, -1) and how
 * far by the trail, nearest first: [{ name, metres }]. A place under 120 m off is `here`, not ahead or behind
 */
function placesFrom(w, k, dir) {
  const out = [], here = [];
  const n = w.nodes[k];
  const ahead = w.nodes[Math.max(0, Math.min(w.nodes.length - 1, k + dir))];
  const behind = w.nodes[Math.max(0, Math.min(w.nodes.length - 1, k - dir))];
  for (const p of b2bPlaces()) {
    const d = p.dist[n];
    if (!Number.isFinite(d)) continue;
    if (d < 120) { here.push(p.name); continue; }
    // the way to it starts ahead: the next point on is nearer it than this one, the one behind farther
    if (ahead !== n ? p.dist[ahead] < d : p.dist[behind] > d) out.push({ name: p.name, metres: d });
  }
  out.sort((a, b) => a.metres - b.metres);
  return { ahead: out, here };
}

// The miles on its mile markers (b2b-trail.js): metres by the trail, for each graph node, from its far end in town
// upriver: of the points its run through town reaches from Gallup Park (B2B_BOUNDS' box), the one farthest by the trail
let MILES = null;
function b2bMiles() {
  if (!MILES) {
    const gallup = b2bPlaces().find((p) => p.name === 'Gallup Park');
    let start = -1, far = -1;
    for (let n = 0; gallup && n < NX.length; n++) {
      const d = gallup.dist[n];
      if (Number.isFinite(d) && d > far && NX[n] > -1500 && NZ[n] > -3200 && NX[n] < 3900) { far = d; start = n; }
    }
    MILES = start >= 0 ? distancesFrom(start) : new Float64Array(NX.length).fill(Infinity);
  }
  return MILES;
}

/**
 * The trail's own bridges that `bridges` (GEO.riverBridges: [kind, width, x, z, ...]) has no footbridge along, as
 * footbridges of their own ([2, width, x, z, ...]): the Broadway Park footbridge over the Huron among them, which the
 * river's data left out, so the trail ran into the water there (terrain.js decks and the channel under them, river.js)
 */
function b2bMissingBridges(bridges) {
  const foot = (bridges || []).filter((b) => b[0] === 2);
  const onOne = (x, z) => foot.some((b) => {
    for (let i = 2; i + 3 < b.length; i += 2) {
      const ax = b[i], az = b[i + 1], ex = b[i + 2] - ax, ez = b[i + 3] - az, l2 = ex * ex + ez * ez || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      if (Math.hypot(x - ax - ex * f, z - az - ez * f) < 4) return true;
    }
    return false;
  });
  const out = [];
  for (const w of WAYS) {
    if (!w.own || !(w.flags & BRIDGE) || w.len < 4) continue;
    const s = w.len / 2;
    let k = 0;
    while (k + 2 < w.pts.length && w.cum[k + 1] < s) k++;
    const f = (s - w.cum[k]) / (w.cum[k + 1] - w.cum[k] || 1);
    const mx = w.pts[k][0] + (w.pts[k + 1][0] - w.pts[k][0]) * f, mz = w.pts[k][1] + (w.pts[k + 1][1] - w.pts[k][1]) * f;
    if (onOne(mx, mz)) continue;
    // a short one is drawn longer, 7 m on at each end along it: the river as the game has it is wider there than the
    // span OSM gives (by the Argo Cascades' outlet the trail ran into the water either side of a 9 m bridge)
    const P = w.pts.map((p) => [...p]);
    if (w.len < 30) {
      for (const [a, b] of [[0, 1], [P.length - 1, P.length - 2]]) {
        const dx = P[a][0] - P[b][0], dz = P[a][1] - P[b][1], l = Math.hypot(dx, dz) || 1;
        P[a] = [P[a][0] + dx / l * 7, P[a][1] + dz / l * 7];
      }
    }
    out.push([2, w.width, ...P.flat()]);
  }
  return out;
}

/** Whether (x, z) is on one of the trail's own bridges (within 4 m of its line) */
function onB2BBridge(x, z) {
  const n = b2bNearest(x, z, 4, true);
  return Boolean(n && n.way.bridge);
}

/** Where the trail's own path (not its bridges) crosses a line of points [[x, z], ...]: metres along that line, each */
function b2bCrossings(P) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const out = [];
  for (const w of WAYS) {
    if (!w.own || w.bridge) continue;
    for (let k = 0; k + 1 < w.pts.length; k++) {
      const [cx, cz] = w.pts[k], sx = w.pts[k + 1][0] - cx, sz = w.pts[k + 1][1] - cz;
      for (let i = 0; i + 1 < P.length; i++) {
        const [ax, az] = P[i], rx = P[i + 1][0] - ax, rz = P[i + 1][1] - az, den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(cum[i] + t * (cum[i + 1] - cum[i]));
      }
    }
  }
  return out;
}

/** The trail's lines for the maps: [{ own, pts: [{ x, z }] }] */
const B2B_LINES = WAYS.map((w) => ({ own: w.own, pts: w.pts.map(([x, z]) => ({ x, z })) }));
/** The bounds of its run through town: its own path from Bandemer Park to Parker Mill (not Delhi's, out west) */
const B2B_BOUNDS = (() => {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const w of WAYS) if (w.own) for (const [x, z] of w.pts) {
    if (x < -1500 || z < -3200) continue;
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
})();

export { B2B_NAME, WAYS as B2B_ROUTE, B2B_LINES, B2B_BOUNDS, TREAD as B2B_TREAD, b2bNearest, onB2B, b2bPlaces, b2bMiles, b2bMissingBridges, b2bCrossings, onB2BBridge, placesFrom };
