// Every place the player can sit down (controllers.js sitDown): the park benches along the streets and in the parks
// (street-details.js, three places along each), the cafe chairs and picnic benches (outdoor-seating.js) and the
// bleachers by the fields (bleachers.js). Each is { x, z, y, yaw, kind, box }: where the hips go, the seat's height
// (null for a park bench, whose height is the ground's under the feet plus its own), facing (sin yaw, cos yaw), and
// the collider it belongs to, whose `knock.down` (knockdowns.js) says it's been knocked over and can't be sat on.
const CELL = 8;

export function createSeats({ benches = [], seats = [], bleachers = [], boxOf = () => null }) {
  const list = [];
  for (const b of benches) {
    const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw), box = boxOf(b);
    for (const u of [-0.55, 0, 0.55]) list.push({ x: b.x + ax * u, z: b.z + az * u, y: null, yaw: b.yaw, kind: 'bench', box });
  }
  for (const s of seats) list.push({ x: s.x, z: s.z, y: s.y, yaw: s.yaw, kind: s.kind, box: boxOf(s) });
  for (const s of bleachers) list.push({ x: s.x, z: s.z, y: s.y, yaw: s.yaw, kind: 'bleacher', box: null });

  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (const s of list) {
    const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(s);
  }

  // the free seat nearest (x, z) within `reach` (y, when given, within a step of the seat's), or null; `score` weighs
  // one ahead of the player as nearer
  function nearest(x, z, reach, y = null, score = () => 1) {
    let best = null, bestS = Infinity;
    const c0x = Math.floor((x - reach) / CELL), c1x = Math.floor((x + reach) / CELL);
    const c0z = Math.floor((z - reach) / CELL), c1z = Math.floor((z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const c = cells.get(key(cx, cz));
      if (!c) continue;
      for (const s of c) {
        if (s.box?.knock?.down) continue;
        if (y != null && s.y != null && Math.abs(s.y - 0.47 - y) > 1.1) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d >= reach) continue;
        const sc = d * score(s.x, s.z);
        if (sc < bestS) { bestS = sc; best = { seat: s, d }; }
      }
    }
    return best;
  }

  return { nearest, count: list.length };
}
