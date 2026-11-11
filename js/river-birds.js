// The river's birds and the sky's: mallards on the Huron, Argo Pond and Gallup's water, Canada geese grazing Gallup's
// lawns and paddling there, a great blue heron in the shallows below the Cascades, and a red-tailed hawk or two
// circling over the Arb and the river in daylight. Models and poses are animal-birds.js; animals.js runs this.
//
// THE RULE ABOVE EVERYTHING (animals.js): no bird is ever struck, hurt or knocked down. They aren't in the colliders,
// the knock-downs or the ragdolls. Anything coming at one sends it off well before it arrives (ducks and geese fly off
// low, the heron lifts away slowly); if something still reaches one it flaps straight up out of reach and comes down
// a few metres off (Lamp: it used to vanish there and then, before the player's eyes). All of them keep clear of the
// helicopter.
import * as THREE from 'three/webgpu';
import { groundHeight, groundUnderStreets, waterLevel, riverDepth, nearestWater } from './terrain.js';
import { CASCADE_FOOT } from './cascades.js';
import { createBirdKit, BIRD_FOLDED } from './animal-birds.js';
import { TIER } from './device-tier.js';
import { log } from '../lamp-game.js';
import { nearestRoads } from './city-config.js';
import { B2B_ROUTE } from './b2b-route.js';
import { b2bTop } from './b2b-trail.js';

const ALIVE = 280, LET_GO = 360; // a place's birds are about within this far of the view (m), let go beyond this
const NEAR_DIST = 42; // skinned bodies within this far; the rest are baked stand-ins

// Where they live: [x, z] near the water, the flock, and how far round it they swim
const SITES = [
  { name: 'Argo Pond', at: [560, -2060], mallards: 8, geese: 3, r: 40 },
  { name: 'Riverside', at: [1204, -884], mallards: 5, r: 25 },
  { name: 'Island Park', at: [1582, -1185], mallards: 6, r: 30 },
  { name: 'Fuller', at: [1621, -1016], mallards: 4, r: 25 },
  { name: 'Gallup', at: [3980, 359], mallards: 9, geese: 6, lawnGeese: 7, r: 45, lawn: 'Gallup' }
];
// Lamp: and along the Border to Border Trail (b2b-route.js), wherever its own path runs within 30 m of the water and
// 400 m clear of the places above and each other: a few mallards on the water and geese grazing the grass beside the
// path and wandering onto it, as they do all along it (found once the river's water is known: `trailSites`)
function trailSites(fixed) {
  const out = [], taken = fixed.map((s) => s.at);
  const clear = (x, z) => taken.every(([ax, az]) => Math.hypot(ax - x, az - z) > 300);
  let k = 0;
  for (const w of B2B_ROUTE) {
    if (!w.own || w.bridge) continue;
    for (let s = 20; s < w.len - 10; s += 40) {
      let i = 0;
      while (i + 2 < w.pts.length && w.cum[i + 1] < s) i++;
      const f = (s - w.cum[i]) / (w.cum[i + 1] - w.cum[i] || 1);
      const x = w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * f, z = w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * f;
      if (!clear(x, z)) continue;
      const water = nearestWater(x, z, 30);
      if (!water || Math.hypot(water.x - x, water.z - z) > 30) continue;
      taken.push([x, z]);
      out.push({ name: 'B2B', at: [x, z], water: [water.x, water.z], mallards: 3 + (k % 3), geese: k % 2 ? 2 : 0, lawnGeese: 3 + ((k * 2) % 3), r: 22, trail: [x, z] });
      k++;
    }
  }
  return out;
}
const onRoad = (x, z) => nearestRoads(x, z, 30).some((n) => n.dist < (n.road.w || 0) / 2 + 1.5);

const HAWKS = [{ at: [2075, -458], r: 85, alt: 75 }, { at: [2850, -380], r: 70, alt: 65, river: true }];

// How each kind moves and how much it lets come near
const KIND = {
  mallard: { swim: 0.45, walk: 0.5, fly: 11, flap: 5.2, top: 3.2, hop: [40, 90], wary: 14, foot: 5, scale: [0.94, 1.06] },
  goose: { swim: 0.4, walk: 0.55, fly: 10, flap: 3.4, top: 5, hop: [50, 100], wary: 18, foot: 4.5, scale: [0.93, 1.08] },
  heron: { swim: 0, walk: 0.3, fly: 6, flap: 2.1, top: 7, hop: [90, 150], wary: 25, foot: 25, scale: [0.95, 1.05] },
  hawk: { fly: 9, flap: 2.6, scale: [0.95, 1.05] }
};

function hash(a, b, k = 0) {
  let h = Math.imul(Math.round(a * 10) | 0, 73856093) ^ Math.imul(Math.round(b * 10) | 0, 19349663) ^ Math.imul(k + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
function stream(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// on the grass, or up on the Border to Border Trail's surface where a goose wanders onto it (b2b-trail.js)
const landY = (x, z) => Math.max(groundUnderStreets(x, z), b2bTop(x, z));
const deep = (x, z, d = 0.6) => riverDepth(x, z) > d && waterLevel(x, z) != null;

function createRiverBirds(group, { parkAt, waterfowlOnly = false }) {
  // (waterfowlOnly: the ducks and geese, not the heron or the hawks: animals.js)
  let sites = null;
  const kits = {
    mallard: createBirdKit('mallard', { farCount: 60 }),
    goose: createBirdKit('goose', { farCount: 40 }),
    ...(waterfowlOnly ? {} : {
      heron: createBirdKit('heron', { farCount: 2 }),
      hawk: createBirdKit('hawk', { farCount: 2, farPose: { fold: 0, glide: 1, legsUp: 1 } })
    })
  };
  const NEAR = { mallard: TIER.stream ? 4 : 7, goose: TIER.stream ? 3 : 6, heron: 1, hawk: 2 };
  for (const k of Object.values(kits)) for (const m of Object.values(k.far)) group.add(m);
  const pools = {}; // skinned bodies not in use, by kind and plumage
  const inUse = { mallard: 0, goose: 0, heron: 0, hawk: 0 };

  let cue = null;
  const sound = (kind, b, k = 1) => cue?.(kind, { x: b.x, y: b.y + 0.3, z: b.z }, k);

  // --- the birds -------------------------------------------------------------------------------------------------
  const birds = [];
  const sitesAlive = new Map(); // site → its birds
  let heronAlive = null, hawksAlive = null;

  function bird(kind, x, z, r, plumage, home) {
    const K = KIND[kind];
    const b = {
      kind, K, spec: kits[kind].spec, plumage, r, x, y: 0, z, heading: r() * Math.PI * 2, speed: 0,
      mode: 'water', state: 'idle', timer: r() * 3, tx: x, tz: z, home,
      scale: K.scale[0] + r() * (K.scale[1] - K.scale[0]), seed: r() * 10,
      p: { ...BIRD_FOLDED, seed: 0 }, flapRate: 0, want: { graze: 0, dabble: 0, alert: 0, hiss: 0, tuck: 0, beat: 0, glide: 0, fold: 1, legsUp: 0, trail: 0, retract: 0 },
      flight: null, body: null, q: new THREE.Quaternion(), fresh: true, roll: 0, pitch: 0, from: null, calledAt: -99
    };
    b.p.seed = b.seed;
    if (kind === 'heron') b.want.retract = 0.4;
    birds.push(b);
    return b;
  }

  // a spot on the water within `rad` of (x, z), or null
  function waterNear(r, x, z, rad, tries = 6) {
    for (let i = 0; i < tries; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (deep(px, pz)) return [px, pz];
    }
    return null;
  }
  // a spot of dry lawn in the named park within `rad` of (x, z), or null
  function lawnNear(r, x, z, rad, park, tries = 10, near = 6) {
    for (let i = 0; i < tries; i++) {
      const a = r() * Math.PI * 2, d = near + r() * rad, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (riverDepth(px, pz) > 0 || waterLevel(px, pz) != null && waterLevel(px, pz) > groundHeight(px, pz) - 0.05) continue;
      if (park && !parkAt(px, pz)?.name.includes(park)) continue;
      if (!park && onRoad(px, pz)) continue;
      return [px, pz];
    }
    return null;
  }
  // the shallows: where a heron stands in the water to its knees
  function shallowNear(r, x, z, rad, tries = 14) {
    for (let i = 0; i < tries; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      const dd = riverDepth(px, pz);
      if (dd > 0.08 && dd < 0.45 && waterLevel(px, pz) != null) return [px, pz];
    }
    return null;
  }

  function populateSite(site) {
    if (!site.water) {
      const w = nearestWater(site.at[0], site.at[1], 200);
      if (!w) return null;
      site.water = [w.x, w.z];
    }
    const [wx, wz] = site.water, list = [];
    const r = stream(hash(wx, wz, 3));
    const flock = (kind, n, plumage) => {
      for (let i = 0; i < n; i++) {
        const at = waterNear(r, wx, wz, site.r, 10);
        if (!at) continue;
        const b = bird(kind, at[0], at[1], stream(r()), plumage(i), { x: wx, z: wz, r: site.r });
        b.state = 'swim';
        list.push(b);
      }
    };
    flock('mallard', site.mallards || 0, (i) => (i % 2 ? 'B' : 'A'));
    flock('goose', site.geese || 0, () => 'A');
    for (let i = 0; i < (site.lawnGeese || 0); i++) {
      // (by the trail: on the grass either side of it, now and then on the path itself)
      const at = site.trail ? lawnNear(r, site.trail[0], site.trail[1], 9, null, 14, 1) : lawnNear(r, wx, wz, 40, site.lawn);
      if (!at) continue;
      const b = bird('goose', at[0], at[1], stream(r()), 'A', { x: wx, z: wz, r: site.r, lawn: { x: at[0], z: at[1] } });
      b.mode = 'land'; b.state = 'graze';
      list.push(b);
    }
    return list;
  }

  function populateHeron() {
    const r = stream(hash(CASCADE_FOOT.x, CASCADE_FOOT.z, 9));
    const at = shallowNear(r, CASCADE_FOOT.x + CASCADE_FOOT.tx * 6, CASCADE_FOOT.z + CASCADE_FOOT.tz * 6, 22, 40) || shallowNear(r, CASCADE_FOOT.x, CASCADE_FOOT.z, 45, 60);
    if (!at) return null;
    const b = bird('heron', at[0], at[1], r, 'A', { x: at[0], z: at[1], r: 6 });
    b.mode = 'wade'; b.state = 'stand'; b.timer = 4 + r() * 6;
    return [b];
  }

  function populateHawks() {
    const list = [];
    HAWKS.forEach((h, i) => {
      let [x, z] = h.at;
      if (h.river) { const w = nearestWater(x, z, 400); if (!w) return; x = w.x; z = w.z; }
      const r = stream(hash(x, z, 21 + i));
      const b = bird('hawk', x, z, r, 'A', { x, z, r: h.r, alt: h.alt });
      b.mode = 'soar'; b.theta = r() * Math.PI * 2; b.dir = r() < 0.5 ? 1 : -1;
      b.cx = x; b.cz = z; b.cryAt = 6 + r() * 20;
      b.want.fold = 0; b.want.glide = 1; b.want.legsUp = 1;
      list.push(b);
    });
    return list;
  }

  function dropAll(list) {
    for (const b of list) { dropBody(b); const i = birds.indexOf(b); if (i >= 0) birds.splice(i, 1); }
  }

  function takeBody(b) {
    if (b.body) return;
    const key = b.kind + b.plumage, pool = pools[key] || (pools[key] = []);
    b.body = pool.pop() || kits[b.kind].make(b.plumage);
    group.add(b.body.mesh);
    inUse[b.kind]++;
  }
  function dropBody(b) {
    if (!b.body) return;
    b.body.mesh.removeFromParent();
    pools[b.kind + b.plumage].push(b.body);
    b.body = null;
    inUse[b.kind]--;
  }

  // --- what's coming --------------------------------------------------------------------------------------------
  // The worst of what's coming at a bird: { t, d (to its edge), closing, foot } in `hit`, or null
  const hit = { t: null, d: 0, closing: 0 };
  function danger(b, threats) {
    let worst = 0;
    hit.t = null;
    const K = b.K;
    for (const t of threats) {
      const dx = b.x - t.x, dz = b.z - t.z, dist = Math.hypot(dx, dz), d = Math.max(0, dist - t.r);
      if (t.air) {
        // the helicopter: anything near it and not far above the water sends them off
        if (t.y - b.y < 70 && d < 75) { const k = 2 + 30 / Math.max(5, d); if (k > worst) { worst = k; hit.t = t; hit.d = d; hit.closing = 0; } }
        continue;
      }
      if (Math.abs(t.y - b.y) > 6 || d > 60) continue; // a car up on a bridge
      const closing = dist > 0.01 ? (t.vx * dx + t.vz * dz) / dist : t.speed;
      let k = 0;
      // a person on foot walking up: the heron goes early, ducks let them come closer, geese stand their ground first
      const reach = t.foot || t.bike ? K.foot : K.wary;
      if (closing > 0.5 && d < reach + closing * 1.8) k = 1 + closing / Math.max(0.5, d);
      else if (d < reach * (t.foot ? 0.6 : 0.45)) k = 0.8; // too close, even standing
      else if (t.loud && d < reach * 0.8) k = 0.6;
      if (k > worst) { worst = k; hit.t = t; hit.d = d; hit.closing = closing; }
    }
    return worst > 0 ? worst : 0;
  }
  // something reached it after all: it quietly isn't there any more
  function tooClose(b, threats) {
    for (const t of threats) {
      if (Math.abs(t.y - b.y) > (t.air ? 6 : 2.5)) continue;
      if (Math.hypot(b.x - t.x, b.z - t.z) < t.r + 0.5) return t;
    }
    return null;
  }
  // up off the water or the grass at once, away from what reached it, coming down 6-10 m off where it can (the water
  // for a duck, the grass for a goose there; else back where it was, once it's gone by), flapping hard and high enough
  // to clear a car
  function hopUp(b, from, now) {
    let ax = b.x - from.x, az = b.z - from.z;
    const l = Math.hypot(ax, az) || 1;
    ax /= l; az /= l;
    let dest = null;
    for (let i = 0; i < 6 && !dest; i++) {
      const a = Math.atan2(ax, az) + (b.r() - 0.5) * (0.8 + i * 0.5), d = 6 + b.r() * 4;
      const px = b.x + Math.sin(a) * d, pz = b.z + Math.cos(a) * d;
      if (b.mode === 'land' ? !(riverDepth(px, pz) > 0.05) : deep(px, pz, 0.3)) dest = [px, pz];
    }
    dest ??= [b.x, b.z];
    const len = Math.max(1, Math.hypot(dest[0] - b.x, dest[1] - b.z));
    b.flight = { x0: b.x, z0: b.z, y0: b.y, x1: dest[0], z1: dest[1], t: 0, dur: Math.max(1.6, len / (b.K.fly * 0.6)), top: 3.2,
      onto: b.mode === 'wade' ? 'wade' : b.mode === 'land' ? 'land' : 'water' };
    b.mode = 'air'; b.state = 'fly'; b.from = from;
    b.heading = Math.atan2(dest[0] - b.x, dest[1] - b.z);
    b.flapRate = b.K.flap * 1.3;
    if (look !== 'midnight') {
      sound('wingbeat', b, 1);
      if (b.kind === 'mallard') sound('quack', b, 1);
      if (b.kind === 'goose') sound('honk', b, 1);
    }
  }

  // --- getting away: a low flight to other water, away from what's coming ---------------------------------------
  function takeOff(b, from, now, land) {
    const K = b.K, r = b.r;
    let ax = 0, az = 0;
    if (from) { ax = b.x - from.x; az = b.z - from.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    else { ax = Math.sin(b.heading); az = Math.cos(b.heading); }
    const base = Math.atan2(ax, az);
    let dest = null;
    // (away from what's coming first, then wider round, up and down a narrow river, nearer: anywhere but toward it)
    for (let i = 0; i < 16 && !dest; i++) {
      const a = base + (r() - 0.5) * Math.min(4.2, 1.2 + i * 0.3), dist = (K.hop[0] + r() * (K.hop[1] - K.hop[0])) * (i < 8 ? 1 : 0.6);
      const px = b.x + Math.sin(a) * dist, pz = b.z + Math.cos(a) * dist;
      if (b.kind === 'heron') dest = shallowNear(r, px, pz, 25, 12);
      else if (land === 'land') dest = lawnNear(r, px, pz, 20, null, 4);
      else if (deep(px, pz)) dest = [px, pz];
      else { const w = nearestWater(px, pz, 30); if (w && Math.hypot(w.x - b.x, w.z - b.z) > 15) dest = [w.x, w.z]; }
    }
    // Lamp: still nowhere to fly to: it paddles or waddles off instead (it used to vanish there and then, before the
    // player's eyes)
    if (!dest) {
      b.state = b.mode === 'land' ? 'waddle' : 'paddleOff';
      b.timer = 4;
      b.heading = base;
      return;
    }
    const len = Math.hypot(dest[0] - b.x, dest[1] - b.z);
    b.flight = {
      x0: b.x, z0: b.z, y0: b.y, x1: dest[0], z1: dest[1], t: 0, dur: len / K.fly, top: K.top * (0.8 + r() * 0.5) + (from?.air ? 5 : 0),
      onto: b.kind === 'heron' ? 'wade' : land === 'land' ? 'land' : 'water'
    };
    b.mode = 'air'; b.state = 'fly'; b.from = from;
    b.heading = Math.atan2(dest[0] - b.x, dest[1] - b.z);
    b.flapRate = K.flap * (b.kind === 'heron' ? 1 : 1.25);
    b.home = { x: dest[0], z: dest[1], r: b.kind === 'heron' ? 6 : Math.min(30, b.home?.r || 25) };
    if (b.mode === 'air' && look !== 'midnight') {
      sound('wingbeat', b, b.kind === 'heron' ? 0.6 : 1);
      if (b.kind === 'mallard' && b.plumage === 'B') sound('quack', b, 1);
      if (b.kind === 'goose' && r() < 0.8) sound('honk', b, 1);
    }
  }

  // --- each bird's mind -----------------------------------------------------------------------------------------
  let look = 'midday';
  const sleeping = () => look === 'midnight';

  function think(b, dt, now, threats) {
    if (b.mode === 'gone') return;
    if (b.mode === 'soar') return soar(b, dt, now, threats);
    const K = b.K, r = b.r, w = b.want;
    b.timer -= dt;
    if (b.mode === 'air') {
      // keep clear of the helicopter on the way
      for (const t of threats) if (t.air && Math.hypot(t.x - b.x, t.z - b.z) < 35 && Math.abs(t.y - b.y) < 20 && b.flight.t > 0.5) { b.flight.top += dt * 6; }
      return;
    }
    // reached after all: straight up out of reach, a short hop away from it (never struck, never vanishing)
    const reached = tooClose(b, threats);
    if (reached) { hopUp(b, reached, now); return; }
    const threat = danger(b, threats);
    const t = hit.t;

    // Lamp: geese on the grass by the trail, a bike coming: they step off its line, out the side they're on, with a
    // honk now and then (only one right on them goes up)
    if (b.kind === 'goose' && b.mode === 'land' && t?.bike && threat > 0 && b.state !== 'waddle') {
      const l = Math.hypot(t.vx, t.vz) || 1, ux = t.vx / l, uz = t.vz / l;
      const side = Math.sign((b.x - t.x) * uz - (b.z - t.z) * ux) || 1;
      b.state = 'waddle'; b.timer = 2.5 + r() * 2; w.hiss = 0;
      b.heading = Math.atan2(uz * side, -ux * side) + (r() - 0.5) * 0.4;
      if (!sleeping() && r() < 0.35) sound('honk', b, 0.6);
      return;
    }
    // geese on the lawn, walked right up to by someone on foot: neck down, hiss and honk, then waddle off
    if (b.kind === 'goose' && b.mode === 'land' && t?.foot && !t.air && hit.d > 1.6 && b.state !== 'flee' && threat > 0) {
      if (b.state !== 'hiss' && b.state !== 'waddle') {
        b.state = 'hiss'; b.timer = 1.4 + r() * 0.6; b.heading = Math.atan2(t.x - b.x, t.z - b.z);
        if (!sleeping()) { sound('hiss', b, 1); if (r() < 0.7) sound('honk', b, 0.8); }
      }
    } else if (threat > 0 && t && b.state !== 'waddle') {
      // ducks a way off from a slow boat swim away; anything else, or anything closer, and they're up and gone
      if (b.mode === 'water' && !t.air && hit.d > K.wary * 0.7 && hit.closing < 2.5 && b.kind !== 'heron') {
        if (b.state !== 'paddleOff') { b.state = 'paddleOff'; b.timer = 3; }
        b.heading = Math.atan2(b.x - t.x, b.z - t.z);
      } else {
        takeOff(b, t, now, b.kind === 'goose' && b.mode === 'land' && t.foot ? 'land' : 'water');
        return;
      }
    }
    // the goose's warning goes on to a waddle away, or flight if they keep coming
    if (b.state === 'hiss') {
      w.hiss = 1; w.alert = 1; w.graze = 0;
      if (t) b.heading += wrap(Math.atan2(t.x - b.x, t.z - b.z) - b.heading) * Math.min(1, dt * 4);
      if (t && hit.d < 1.8) { takeOff(b, t, now, 'land'); return; }
      if (b.timer <= 0) {
        b.state = 'waddle'; b.timer = 4 + r() * 3; w.hiss = 0;
        if (t) b.heading = Math.atan2(b.x - t.x, b.z - t.z) + (r() - 0.5) * 0.6;
        if (!sleeping() && r() < 0.6) sound('honk', b, 0.7);
      }
    }
    if (b.state === 'waddle') {
      w.alert = 0.7; w.graze = 0; w.hiss = 0;
      b.speed = K.walk * 1.9;
      if ((t?.foot || t?.bike) && hit.d < (t.bike ? 1.2 : 1.8)) { takeOff(b, t, now, 'land'); return; }
      if (b.timer <= 0) { b.state = 'graze'; b.timer = 3; }
      return;
    }
    if (b.state === 'paddleOff') {
      b.speed = K.swim * 2.2; w.dabble = 0; w.alert = 1;
      if (b.timer <= 0 && threat === 0) { b.state = 'swim'; b.timer = 2; }
      return;
    }

    // at rest: roosting at night, heads tucked, still and silent
    w.tuck = sleeping() ? 1 : 0;
    if (sleeping()) { b.speed = 0; w.graze = 0; w.dabble = 0; w.alert = 0; return; }

    if (b.mode === 'water') {
      if (b.timer <= 0) {
        const c = r();
        if (c < 0.3) { b.state = 'dabble'; b.timer = 1.5 + r() * 2.5; }
        else if (c < 0.45) { b.state = 'look'; b.timer = 1.5 + r() * 2; }
        else {
          b.state = 'swim'; b.timer = 3 + r() * 6;
          const at = waterNear(r, b.home.x, b.home.z, b.home.r);
          if (at) { b.tx = at[0]; b.tz = at[1]; }
        }
        // the flock's chatter
        if (b.kind === 'mallard' && r() < 0.18 && now - b.calledAt > 6) { b.calledAt = now; sound('quack', b, 0.7); }
        if (b.kind === 'goose' && r() < 0.08) sound('honk', b, 0.5);
      }
      w.dabble = b.state === 'dabble' ? 1 : 0; w.alert = b.state === 'look' ? 1 : 0; w.graze = 0;
      if (b.state === 'swim') {
        const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
        b.heading += wrap(Math.atan2(dx, dz) - b.heading) * Math.min(1, dt * 1.5);
        b.speed = d > 0.6 ? K.swim * (0.7 + 0.3 * Math.min(1, d / 4)) : 0;
      } else b.speed *= Math.max(0, 1 - dt * 1.5);
    } else if (b.mode === 'land') {
      if (b.timer <= 0) {
        const c = r();
        if (c < 0.55) { b.state = 'graze'; b.timer = 3 + r() * 6; }
        else if (c < 0.75) { b.state = 'look'; b.timer = 1.5 + r() * 2.5; }
        else {
          b.state = 'walk'; b.timer = 2 + r() * 3;
          b.heading += (r() - 0.5) * 2;
          // they keep near their lawn
          const l = b.home.lawn || b.home;
          if (Math.hypot(b.x - l.x, b.z - l.z) > 14) b.heading = Math.atan2(l.x - b.x, l.z - b.z);
        }
        if (r() < 0.06) sound('honk', b, 0.45);
      }
      w.graze = b.state === 'graze' ? 1 : 0; w.alert = b.state === 'look' ? 1 : 0; w.dabble = 0;
      b.speed = b.state === 'walk' ? K.walk : b.state === 'graze' ? K.walk * 0.25 * (Math.sin(now * 0.8 + b.seed) > 0.5 ? 1 : 0) : 0;
    } else if (b.mode === 'wade') {
      // the heron: stands, neck in or out, takes a slow step now and then
      if (b.timer <= 0) {
        const c = r();
        if (c < 0.45) { b.state = 'stand'; b.timer = 5 + r() * 9; w.retract = r() < 0.5 ? 0.9 : 0.2; }
        else if (c < 0.75) { b.state = 'stalk'; b.timer = 2 + r() * 2; w.retract = 0; w.graze = 0.3; }
        else {
          b.state = 'step'; b.timer = 1.5 + r() * 2;
          const at = shallowNear(r, b.home.x, b.home.z, b.home.r, 6);
          if (at) b.heading = Math.atan2(at[0] - b.x, at[1] - b.z);
        }
      }
      if (b.state !== 'stalk') w.graze = 0;
      b.speed = b.state === 'step' ? K.walk : 0;
    }
  }

  // the hawk: wide slow circles, a few wingbeats now and then, its cry; drifting off from the helicopter
  function soar(b, dt, now, threats) {
    const K = b.K, h = b.home;
    for (const t of threats) {
      if (!t.air) continue;
      const dx = b.cx - t.x, dz = b.cz - t.z, d = Math.hypot(dx, dz);
      if (d < 160) { b.cx += (dx / (d || 1)) * dt * 6; b.cz += (dz / (d || 1)) * dt * 6; }
    }
    // back over its own ground slowly
    b.cx += (h.x - b.cx) * dt * 0.01; b.cz += (h.z - b.cz) * dt * 0.01;
    const r = h.r * (0.9 + 0.15 * Math.sin(now * 0.05 + b.seed));
    b.theta += b.dir * (K.fly / r) * dt;
    const x = b.cx + Math.cos(b.theta) * r, z = b.cz + Math.sin(b.theta) * r;
    const y = groundHeight(b.cx, b.cz) + h.alt + 6 * Math.sin(now * 0.11 + b.seed);
    b.heading = Math.atan2(x - b.x, z - b.z) || b.heading;
    b.x = x; b.z = z; b.y = y;
    b.roll = -b.dir * 0.32; b.pitch = 0;
    // now and then a few slow beats to hold the height
    const beating = Math.sin(now * 0.21 + b.seed * 3) > 0.86;
    b.want.beat = beating ? 0.55 : 0; b.want.glide = beating ? 0.3 : 1;
    b.flapRate = K.flap;
    b.cryAt -= dt;
    if (b.cryAt <= 0) { b.cryAt = 20 + b.r() * 20; sound('hawk', b, 1); }
  }

  // --- moving -----------------------------------------------------------------------------------------------------
  const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _x = new THREE.Vector3();
  const _tq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function move(b, dt, now) {
    if (b.mode === 'gone') return;
    const S = b.spec, w = b.want, p = b.p;
    const ease = (v, to, k) => v + (to - v) * Math.min(1, dt * k);
    let vy = 0;
    if (b.mode === 'air') {
      const f = b.flight;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const px = b.x, py = b.y, pz = b.z;
      b.x = f.x0 + (f.x1 - f.x0) * k; b.z = f.z0 + (f.z1 - f.z0) * k;
      const endY = f.onto === 'water' ? (waterLevel(f.x1, f.z1) ?? groundHeight(f.x1, f.z1)) - S.float * b.scale
        : f.onto === 'wade' ? wadeY(f.x1, f.z1) : landY(f.x1, f.z1);
      // up quickly off the water, a low run, then down
      const arc = Math.sin(Math.PI * Math.min(1, Math.pow(k, 0.6)));
      b.y = f.y0 + (endY - f.y0) * k + arc * f.top;
      vy = dt > 0 ? (b.y - py) / dt : 0;
      const hs = dt > 0 ? Math.hypot(b.x - px, b.z - pz) / dt : 0;
      b.pitch = Math.atan2(vy, Math.max(1, hs)) * 0.6;
      // spread, beating; a glide at the top; legs tucked (the heron's trailing, its neck drawn in); feet down to land
      const landing = k > 0.82;
      w.fold = 0; w.alert = 0; w.graze = 0; w.dabble = 0; w.hiss = 0; w.tuck = 0;
      w.beat = landing ? 0.45 : k < 0.3 ? 1 : 0.8 + 0.2 * Math.sin(now * 0.7);
      w.glide = landing ? 0.8 : 0;
      w.legsUp = b.kind === 'heron' || landing ? 0 : 1;
      w.trail = b.kind === 'heron' && !landing ? 1 : 0;
      w.retract = b.kind === 'heron' ? 1 : 0;
      b.flapRate = b.K.flap * (k < 0.25 ? 1.25 : landing ? 0.8 : 1);
      if (k >= 1) {
        b.mode = f.onto; b.flight = null; b.pitch = 0;
        b.state = f.onto === 'wade' ? 'stand' : f.onto === 'land' ? 'look' : 'look';
        b.timer = 2 + b.r() * 3;
        w.fold = 1; w.beat = 0; w.glide = 0; w.legsUp = 0; w.trail = 0; w.retract = b.kind === 'heron' ? 0.9 : 0;
      }
    } else if (b.mode === 'soar') {
      // set by soar()
    } else {
      w.fold = 1; w.beat = 0; w.glide = 0; w.legsUp = 0; w.trail = 0;
      if (b.speed > 0) {
        const nx = b.x + Math.sin(b.heading) * b.speed * dt, nz = b.z + Math.cos(b.heading) * b.speed * dt;
        // keep to the water, or the lawn, or the shallows: turn back when the next step leaves it
        const ok = b.mode === 'water' ? deep(nx, nz, 0.5) : b.mode === 'land' ? !(riverDepth(nx, nz) > 0.05) : riverDepth(nx, nz) > 0.05 && riverDepth(nx, nz) < 0.55;
        if (ok) { b.x = nx; b.z = nz; } else { b.heading = wrap(b.heading + Math.PI * (0.6 + b.r() * 0.6)); b.speed *= 0.3; }
      }
      if (b.mode === 'water') b.y = (waterLevel(b.x, b.z) ?? groundHeight(b.x, b.z)) - S.float * b.scale + 0.004 * Math.sin(now * 2 + b.seed);
      else if (b.mode === 'wade') b.y = wadeY(b.x, b.z);
      else b.y = landY(b.x, b.z);
      b.pitch = 0;
    }
    // the pose
    for (const k of ['graze', 'dabble', 'alert', 'hiss', 'tuck', 'retract', 'legsUp', 'trail']) p[k] = ease(p[k], w[k], k === 'dabble' ? 4 : 5);
    p.fold = ease(p.fold, w.fold, b.mode === 'air' || b.mode === 'soar' ? 9 : 3);
    p.beat = ease(p.beat, w.beat, 6); p.glide = ease(p.glide, w.glide, 3);
    p.flap = (p.flap + dt * b.flapRate * (p.beat > 0.02 ? 1 : 0)) % 1;
    const walking = b.mode === 'land' || b.mode === 'wade' ? Math.min(1, b.speed / Math.max(0.1, b.K.walk)) : 0;
    p.walk = ease(p.walk, walking, 6);
    p.step = (p.step + dt * b.speed * (b.kind === 'heron' ? 1.1 : 2.6) / Math.max(0.3, b.scale)) % 1;
    p.paddle = ease(p.paddle, b.mode === 'water' ? Math.min(1, b.speed / 0.4) : 0, 4);
    p.time = now;
    p.yaw = ease(p.yaw, b.state === 'look' || b.state === 'stand' ? Math.sin(now * 0.6 + b.seed) * 0.7 : 0, 3);

    // its frame in the world
    _f.set(Math.sin(b.heading) * Math.cos(b.pitch), Math.sin(b.pitch), Math.cos(b.heading) * Math.cos(b.pitch));
    _u.set(0, 1, 0);
    _x.crossVectors(_u, _f).normalize();
    _u.crossVectors(_f, _x);
    _m.makeBasis(_x, _u, _f);
    _tq.setFromRotationMatrix(_m);
    if (b.roll) _tq.multiply(_rq.setFromAxisAngle(_s.set(0, 0, 1), b.roll));
    if (b.fresh) { b.q.copy(_tq); b.fresh = false; } else b.q.slerp(_tq, Math.min(1, dt * (b.mode === 'air' ? 6 : 4)));
  }
  // a heron's height: on the riverbed, its legs in the water
  function wadeY(x, z) {
    const g = groundHeight(x, z), wl = waterLevel(x, z);
    return wl == null ? g : Math.max(g, wl - 0.4);
  }

  // --- drawing ----------------------------------------------------------------------------------------------------
  function draw(b, near) {
    const kit = kits[b.kind];
    if (near) {
      takeBody(b);
      kit.pose(b.body, b.p);
      const m = b.body.mesh;
      m.quaternion.copy(b.q);
      m.position.set(b.x, b.y, b.z);
      m.scale.setScalar(b.scale);
    } else {
      dropBody(b);
      const far = kit.far[b.plumage];
      if (far.count >= far.instanceMatrix.count) return;
      _p.set(b.x, b.y, b.z);
      _s.setScalar(b.scale);
      _m.compose(_p, b.q, _s);
      far.setMatrixAt(far.count++, _m);
    }
  }

  const order = [], given = { mallard: 0, goose: 0, heron: 0, hawk: 0 };
  let lastLog = 0, reported = false, checkedAt = -10;
  function update(dt, now, ctx, threats) {
    cue = ctx.cue || null;
    look = ctx.look || 'midday';
    const cp = ctx.camera.position;
    if (now - checkedAt > 1.5) {
      checkedAt = now;
      if (!sites && nearestWater(1204, -884, 200)) {
        sites = [...SITES, ...trailSites(SITES)];
        log(`[animals] ducks and geese at ${sites.length} places on the river, ${sites.length - SITES.length} of them along the Border to Border Trail`);
      }
      for (const site of sites || []) {
        const [sx, sz] = site.water || site.at, d = Math.hypot(sx - cp.x, sz - cp.z);
        if (!sitesAlive.has(site) && d < ALIVE) { const list = populateSite(site); if (list) sitesAlive.set(site, list); }
        else if (sitesAlive.has(site) && d > LET_GO) { dropAll(sitesAlive.get(site)); sitesAlive.delete(site); }
      }
      const fd = Math.hypot(CASCADE_FOOT.x - cp.x, CASCADE_FOOT.z - cp.z);
      if (!heronAlive && fd < ALIVE && !waterfowlOnly) heronAlive = populateHeron();
      else if (heronAlive && fd > LET_GO) { dropAll(heronAlive); heronAlive = null; }
      // hawks in daylight only, within sight of their ground
      const day = look === 'midday' || look === 'golden';
      const hd = Math.min(...HAWKS.map((h) => Math.hypot(h.at[0] - cp.x, h.at[1] - cp.z)));
      if (!hawksAlive && day && hd < 900 && !waterfowlOnly) hawksAlive = populateHawks();
      else if (hawksAlive && (!day || hd > 1100)) { dropAll(hawksAlive); hawksAlive = null; }
    }
    order.length = 0;
    for (const b of birds) {
      think(b, dt, now, threats);
      move(b, dt, now);
      if (b.mode === 'gone') { dropBody(b); continue; }
      // a bird in the air is worth a close body further off
      b.d2 = ((b.x - cp.x) ** 2 + (b.y - cp.y) ** 2 + (b.z - cp.z) ** 2) * (b.mode === 'air' ? 0.35 : 1);
      order.push(b);
    }
    for (const k of Object.values(kits)) for (const m of Object.values(k.far)) m.count = 0;
    order.sort((a, b) => a.d2 - b.d2);
    for (const k in given) given[k] = 0;
    for (const b of order) {
      b.near = b.d2 < NEAR_DIST * NEAR_DIST * (b.kind === 'hawk' || b.kind === 'heron' ? 4 : 1) && given[b.kind] < NEAR[b.kind];
      if (b.near) given[b.kind]++;
      else dropBody(b); // give bodies back before handing them on
    }
    for (const b of order) draw(b, b.near);
    for (const k of Object.values(kits)) for (const m of Object.values(k.far)) m.instanceMatrix.needsUpdate = m.count > 0;

    if (!reported) {
      reported = true;
      const t = Object.entries(kits).map(([k, v]) => `${k} ${v.stats.triangles}/${v.stats.farTriangles}`).join(', ');
      const kb = Object.values(kits).reduce((s, v) => s + v.stats.bytes + v.stats.textureBytes, 0) / 1024;
      log(`[animals] birds: ${t} triangles near/far; ${kb.toFixed(0)} KB in all`);
    }
    if (now - lastLog > 30 && birds.length) {
      lastLog = now;
      const n = (m) => birds.filter((b) => b.mode === m).length;
      log(`[animals] ${birds.length} birds about (${n('water')} on the water, ${n('land')} on the grass, ${n('wade')} wading, ${n('air') + n('soar')} flying, ${Object.values(inUse).reduce((a, b) => a + b, 0)} close up)`);
    }
  }

  return {
    update,
    birds,
    get count() { return birds.length; },
    dispose() { for (const k of Object.values(kits)) k.dispose(); }
  };
}

export { createRiverBirds };
