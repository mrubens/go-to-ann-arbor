import { GEO } from './city-geodata.js';

// The speed limit of the street under (x, z): its posted limit from OpenStreetMap's maxspeed or the city's
// (build-annarbor.py), else Ann Arbor's usual for its class, as traffic.js drives it and traffic-controls.js posts it.
// The street graph's links are cut into segments in a 40 m grid; the nearest one whose roadway holds the point wins,
// favouring one that runs the way the player is heading (at a corner the street they're on, not the cross street).

const CLASS_MPH = [55, 35, 30, 30, 25, 30, 25];
const CELL = 40;
const grid = new Map();

(function index() {
  const RG = GEO.roadGraph;
  if (!RG) return;
  const at = (i) => [RG.nodes[i * 2], RG.nodes[i * 2 + 1]];
  const byName = new Map();
  for (const [a, b, ni, w, , , inner, cls = 4, , , , mph = 0] of RG.links) {
    const pts = [at(a)];
    for (let k = 0; k < inner.length; k += 2) pts.push([inner[k], inner[k + 1]]);
    pts.push(at(b));
    const limit = mph || CLASS_MPH[cls] || 25;
    const name = RG.names?.[ni];
    if (name && (byName.get(name) || 0) < limit) byName.set(name, limit);
    add(pts, w, limit);
  }
  // the town's main streets (Main, State, Huron, Washtenaw…) are drawn from GEO.roads, which the graph above leaves
  // out where the grid carries them: their limit is the one the graph gives the same street elsewhere, else by its size
  for (const [name, w, , lanes, hw, flat] of GEO.roads || []) {
    const pts = [];
    for (let k = 0; k + 1 < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
    const limit = byName.get(name) || (hw ? 55 : lanes >= 4 ? 35 : lanes >= 3 || w >= 13 ? 30 : 25);
    add(pts, w, limit);
  }
})();

function add(pts, w, limit) {
    const half = (w > 3 ? w : 9.1) / 2 + 3; // the roadway, its gutters and a little more, where the drawn street sits off the centreline
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const seg = { ax, az, bx, bz, half, limit };
      const x0 = Math.floor((Math.min(ax, bx) - half) / CELL), x1 = Math.floor((Math.max(ax, bx) + half) / CELL);
      const z0 = Math.floor((Math.min(az, bz) - half) / CELL), z1 = Math.floor((Math.max(az, bz) + half) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const key = ix * 100000 + iz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(seg);
      }
    }
}

// mph, or 0 off any street
function speedLimitAt(x, z, heading = null) {
  const list = grid.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
  if (!list) return 0;
  const hx = heading === null ? 0 : Math.sin(heading), hz = heading === null ? 0 : Math.cos(heading);
  let best = 0, score = Infinity;
  for (const s of list) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
    if (d > s.half) continue;
    const along = heading === null ? 1 : Math.abs(dx * hx + dz * hz) / Math.sqrt(L2);
    const sc = d + (1 - along) * 6;
    if (sc < score) { score = sc; best = s.limit; }
  }
  return best;
}

export { speedLimitAt };
