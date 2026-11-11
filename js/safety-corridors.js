// Ann Arbor's Traffic Safety Corridors: the three stretches the city and AAPD named for extra speed enforcement in
// December 2024. Washtenaw Ave from Geddes Ave to Huron Pkwy, Packard from Fifth Ave to Turnberry Ln (the cruiser
// waits near Platt Rd, where AAPD has run speed operations) and Jackson Ave from Burwood Ave to Gralake Ave. Found on the
// road graph by street name: the junctions where the corridor's street meets each end's cross street, and the
// corridor's own edges between them. traffic-controls.js posts a sign at each end; traffic.js's speedTrap parks a
// cruiser on one.

import { log } from '../lamp-game.js';

const CORRIDORS = [
  { name: 'Washtenaw', street: /\bWashtenaw Ave\b/, from: /\bGeddes Ave\b/, to: /\bHuron Pkwy\b/ },
  // (Turnberry Ln's mouth on Packard, from city-geodata.js's GEO.roads: the road graph leaves the lane itself out)
  { name: 'Packard', street: /\bPackard (Rd|St)\b/, from: /\bFifth Ave\b/, to: /\bTurnberry Ln\b/, toAt: { x: 5020, z: 3812 }, at: /\bPlatt Rd\b/ },
  { name: 'Jackson', street: /\bJackson Ave\b/, from: /\bBurwood Ave\b/, to: /\bGralake Ave\b/ }
];

const cache = new WeakMap();

// [{ name, a: {x, z}, b: {x, z}, edges: [...], spot: {x, z} }] for the corridors the town's roads hold
function corridorsOf(network) {
  if (cache.has(network)) return cache.get(network);
  const names = new Map(); // node -> the streets meeting there
  for (const e of network.edges) {
    if (!e.street) continue;
    for (const n of [e.from, e.to]) {
      if (!names.has(n)) names.set(n, new Set());
      names.get(n).add(e.street);
    }
  }
  const meets = (n, a, b) => {
    const s = names.get(n);
    if (!s) return false;
    let hasA = false, hasB = false;
    for (const x of s) { if (a.test(x)) hasA = true; if (b.test(x)) hasB = true; }
    return hasA && hasB;
  };
  const out = [];
  for (const c of CORRIDORS) {
    // where the corridor's street meets the cross street; or, where the graph doesn't join them (a cross street ending
    // short of it), the corridor street's junction nearest the cross street, within 200 m
    const ends = (re) => {
      const met = [...names.keys()].filter((n) => meets(n, c.street, re));
      if (met.length) return met;
      const on = (n, r) => [...(names.get(n) || [])].some((x) => r.test(x));
      const cross = [...names.keys()].filter((n) => on(n, re)), mine = [...names.keys()].filter((n) => on(n, c.street));
      let best = null, bestD = 200;
      for (const a of mine) for (const b of cross) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < bestD) { bestD = d; best = a; }
      }
      if (!best) log(`[safety corridor] ${c.name}: no ${re.source} near (${cross.length} of its junctions, ${mine.length} of the corridor street's)`);
      return best ? [best] : [];
    };
    const nearestOn = (p) => {
      let best = null, bestD = 400;
      for (const n of names.keys()) {
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bestD && [...names.get(n)].some((x) => c.street.test(x))) { bestD = d; best = n; }
      }
      return best ? [best] : [];
    };
    const as = ends(c.from), bs = c.toAt ? nearestOn(c.toAt) : ends(c.to);
    if (!as.length || !bs.length) { log(`[safety corridor] ${c.name}: ends not found (${as.length}, ${bs.length})`); continue; }
    let best = null;
    for (const a of as) for (const b of bs) {
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 150 && (!best || d < best.d)) best = { a, b, d };
    }
    if (!best) continue;
    const { a, b, d } = best;
    const inside = (x, z) => Math.hypot(x - a.x, z - a.z) + Math.hypot(x - b.x, z - b.z) < d + 120;
    // the street's own way from one end to the other (shortest over its edges, either way along them), and every edge
    // of the street between two of that way's junctions, both directions; else those inside an ellipse round the ends
    const mine = network.edges.filter((e) => e.street && c.street.test(e.street) && e.lanes.length);
    const out2 = new Map();
    for (const e of mine) for (const [p, q] of [[e.from, e.to], [e.to, e.from]]) {
      if (!out2.has(p)) out2.set(p, []);
      out2.get(p).push([q, e.len]);
    }
    const dist = new Map([[a, 0]]), prev = new Map(), open = [a];
    while (open.length) {
      let k = 0;
      for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[k])) k = i;
      const n = open.splice(k, 1)[0];
      if (n === b) break;
      for (const [q, L] of out2.get(n) || []) {
        const nd = dist.get(n) + L;
        if (nd < (dist.get(q) ?? Infinity)) { if (!dist.has(q)) open.push(q); dist.set(q, nd); prev.set(q, n); }
      }
    }
    const way = new Set();
    if (dist.has(b)) for (let n = b; n; n = prev.get(n)) way.add(n);
    const edges = way.size > 1 ? mine.filter((e) => way.has(e.from) && way.has(e.to))
      : mine.filter((e) => inside(e.sx, e.sz) && inside(e.sx + e.dx * e.len, e.sz + e.dz * e.len));
    if (!edges.length) continue;
    let spot = null;
    if (c.at) {
      const at = [...names.keys()].filter((n) => meets(n, c.street, c.at) && inside(n.x, n.z));
      if (at.length) spot = { x: at[0].x, z: at[0].z };
    }
    if (!spot) spot = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    out.push({ name: c.name, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, edges, spot, at: !!c.at, length: d });
  }
  log(`[safety corridor] ${out.map((c) => `${c.name} ${Math.round(c.length)} m, ${c.edges.length} roads`).join('; ') || 'none'}`);
  cache.set(network, out);
  return out;
}

export { corridorsOf };
