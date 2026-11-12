import { GEO } from './city-geodata.js';

// Lamp: the parking lanes along a street's curbs, as the map has them (OpenStreetMap's parking:both / :left / :right;
// untagged, only the metered streets downtown: tools' park_spec), each 2.4 m wide inside the curb. One answer for the
// lanes traffic drives in (road-network.js keeps them clear), the paint (road-paint.js draws each lane's edge line and
// its stalls' marks) and the parked cars (parked-cars.js stands them in the stalls), so a parked car never sits in a
// traffic lane and always sits between its marks.

const PARK_W = 2.4;
const STALL = 6.5; // a parallel-parking stall's length
const CORNER = 12; // no stalls this close to a street's ends (the corners and their crosswalks)

// (Lamp: the middle of town, x east and z south of Main & Liberty, m: build-annarbor.py PARK_TOWN)
const PARK_TOWN = [-480, 1500, -760, 820];
const TOWN_METERED = /^S Ashley St$|^([NSEW] )?(Fourth Ave|Fifth Ave|Division St|First St|Thayer St|Ann St|Kingsley St|Detroit St|Catherine St|Ingalls St|Madison St|Lawrence St|William St|Thompson St|University Ave)$/;
const inTown = (m) => m[0] > PARK_TOWN[0] && m[0] < PARK_TOWN[1] && m[1] > PARK_TOWN[2] && m[1] < PARK_TOWN[3];
// a number 0..1 for the place, the same all along a street's 40 m cells
const byPlace = (m) => { const v = Math.sin(Math.round(m[0] / 40) * 12.9898 + Math.round(m[1] / 40) * 78.233) * 43758.5453; return v - Math.floor(v); };
// a bike lane's room along the curb on side 1 (right) or 2 (left), as road-network.js lanesOf gives it
const bikeRoom = (bike, side) => !(bike & side) || bike & 128 ? 0 : (bike & 512 ? 3 : 1.7) + (bike & 48 ? 0.9 : bike & 64 ? 0.6 : 0);

// The parking lane's width on the street's right and left as drawn, from the link's bits (1 right, 2 left). A side whose
// bike lane is separated from traffic (flex posts 32, a curb 64; its bike bits 1 right, 2 left) has no parking: cars
// would have to cross the lane and its posts to park there
function curbParking(bits, bike = 0, link = null) {
  // Lamp: Ann Arbor's residential streets the map says nothing of are parked along anyway, unmarked: both curbs where
  // the street is 10 m or more across, one (the same all along it, by place) where it's 8.5 m or more, none on a
  // narrower one or a one-way; no line, no stall marks (`marked` false), and fewer cars than a metered block's
  let marked = true;
  // Lamp: and in the middle of town (downtown, Kerrytown and the campus, build-annarbor.py PARK_TOWN) the bigger
  // streets the map says nothing of are metered along every curb their width leaves room for once their travel lanes
  // (3.2 m each) and bike lanes are in: Fourth, Fifth, Division, S Ashley, William, Thompson... (TOWN_METERED), marked as
  // downtown's are; where there's room for one side only, the one away from a bike lane, or else the same all along it
  if (!bits && link && TOWN_METERED.test(link.name || '') && inTown(link.mid) && link.cls >= 2 && link.cls <= 4) {
    const travel = 3.2 * Math.max(link.dir ? 1 : 2, link.lanes || 0);
    const spare = link.w - bikeRoom(bike, 1) - bikeRoom(bike, 2) - travel;
    if (spare >= 2 * PARK_W) bits = 3;
    else if (spare >= PARK_W) bits = bike & 1 ? 2 : bike & 2 ? 1 : byPlace(link.mid) < 0.5 ? 1 : 2;
    if (bike & 96) bits &= ~(bike & 3);
    if (bits) return { right: bits & 1 ? PARK_W : 0, left: bits & 2 ? PARK_W : 0, marked: true };
  }
  if (!bits && link && link.cls === 4 && !link.dir && (link.lanes || 2) <= 2 && link.w >= 8.5) {
    marked = false;
    if (link.w >= 10) bits = 3;
    else bits = byPlace(link.mid) < 0.5 ? 1 : 2;
    bits &= ~(bike & 3); // not where a bike lane runs along that curb
  }
  if (bike & 96) bits &= ~(bike & 3);
  return { right: bits & 1 ? PARK_W : 0, left: bits & 2 ? PARK_W : 0, marked };
}
// the link-like that curbParking reads, from a road-graph link's fields and points
const linkOf = (w, lanes, dir, cls, pts, name = '') => ({ w, lanes, dir, cls, mid: pts[pts.length >> 1], name });

// Every stall along every parking lane: its middle at the lane's middle (x, z), the way along the street (tx, tz),
// toward its curb (nx, nz), and its length and the lane's width
let stalls = null;
function curbStalls() {
  if (stalls) return stalls;
  stalls = [];
  const G = GEO.roadGraph;
  const N = G.nodes;
  for (const [a, b, ni, w, lanes, dir, flat, cls = 4, bike = 0, , , , bits = 0] of G.links) {
    const pts = [[N[a * 2], N[a * 2 + 1]]];
    for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    pts.push([N[b * 2], N[b * 2 + 1]]);
    const park = curbParking(bits, bike, linkOf(w, lanes, dir, cls, pts, G.names[ni]));
    if (!park.right && !park.left) continue;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const count = Math.floor((total - 2 * CORNER) / STALL);
    if (count < 1) continue;
    // whole stalls, centred between the corners
    const first = (total - count * STALL) / 2 + STALL / 2;
    let run = 0, k = 0;
    for (let i = 1; i < pts.length && k < count; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.01) continue;
      const tx = (x1 - x0) / L, tz = (z1 - z0) / L;
      while (k < count && first + k * STALL <= run + L) {
        const s = first + k * STALL - run;
        k++;
        // the right-hand curb going this way is (-tz, tx) (x east, z south)
        for (const side of [1, -1]) {
          const lane = side > 0 ? park.right : park.left;
          if (!lane) continue;
          const nx = -tz * side, nz = tx * side, off = w / 2 - lane / 2;
          stalls.push({ x: x0 + tx * s + nx * off, z: z0 + tz * s + nz * off, tx, tz, nx, nz, side, length: STALL, lane, marked: park.marked });
        }
      }
      run += L;
    }
  }
  return stalls;
}

export { curbParking, curbStalls, linkOf, PARK_W };
