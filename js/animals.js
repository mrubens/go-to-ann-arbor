// Ann Arbor's animals, near the player only: squirrels on the Diag, the campus lawns, the parks and the
// neighborhoods' street and yard trees; the river's birds (river-birds.js), the town's pigeons, sparrows, robins and
// crows (city-birds.js) and the Arb's deer at dawn and dusk (deer.js).
//
// THE RULE ABOVE EVERYTHING: animals are never struck, hurt or knocked down by anything (a car, a bike, the
// helicopter, the kayak, the player falling). They are no one's obstacle: never in the colliders, the knock-downs or
// the ragdolls, and they never make a thud. Anything coming at one sends it off well before it arrives; if something
// still reaches one, it leaps clear or quietly vanishes, untouched.
//
// Each squirrel lives on a tree (a tree's trunk from the city's colliders, the ones the knock-downs use): which trees
// have one is fixed by where the tree stands, so the same squirrels are there each time the player comes back. Only
// those within POPULATE of the view are alive; the nearest NEAR of them are skinned bodies (animal-models.js), the rest
// one instanced stand-in per coat.
import * as THREE from 'three/webgpu';
import { groundHeight } from './terrain.js';
import { GEO } from './city-geodata.js';
import { TIER } from './device-tier.js';
import { log } from '../lamp-game.js';
import { createSquirrelKit, poseSquirrel } from './animal-models.js';
import { createRiverBirds } from './river-birds.js';
import { createDeer } from './deer.js';
import { createCityBirds } from './city-birds.js';

const POPULATE = 62, RELEASE = 85; // alive within this far of the view (m); let go beyond this
const MAX = TIER.stream ? 10 : 16; // alive at once
const NEAR = TIER.stream ? 5 : 8, NEAR_DIST = 24; // skinned bodies, within this far
const CELL = 16;

function hash(x, z, k = 0) {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663) ^ Math.imul(k + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// a small seeded random per squirrel, never Math.random
function stream(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// WHERE THEY LIVE: how many squirrels a tree has, by what's around it
// ============================================================================
function makeHabitat() {
  const polys = (GEO.parks || []).filter((p) => p.cat !== 'golf' || true).map((p) => {
    const ring = p.rings[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    const quad = /Diag|Ingalls Mall|Law Quad|Liberty Plaza|Hanover Square/.test(p.name);
    return { name: p.name, cat: p.cat, ring, x0, x1, z0, z1, quad };
  });
  const inside = (ring, x, z) => {
    let c = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const parkAt = (x, z) => {
    for (const p of polys) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && inside(p.ring, x, z)) return p;
    return null;
  };
  // central campus, its lawns between the buildings
  const campus = (x, z) => x > 560 && x < 1400 && z > -160 && z < 720;
  const downtown = (x, z) => Math.abs(x - 40) < 330 && Math.abs(z + 20) < 420;
  return {
    parkAt,
    // { per: squirrels per tree (0 to 2, by chance), roam: how far from its tree it forages (m), lawn }
    of(x, z) {
      const park = parkAt(x, z);
      if (park?.quad) return { per: 1.5, roam: 8, lawn: true, where: park.name };
      if (campus(x, z)) return { per: 0.55, roam: 7, lawn: true, where: 'campus' };
      if (park) return { per: park.cat === 'cemetery' ? 0.4 : 0.32, roam: 7, lawn: true, where: park.name };
      if (downtown(x, z)) return { per: 0.06, roam: 1.4, lawn: false, where: 'downtown' };
      return { per: 0.3, roam: 3.6, lawn: true, where: 'neighborhood' };
    },
    lawnAt(x, z) { return campus(x, z) || !!parkAt(x, z); }
  };
}

// ============================================================================
// THE PART
// ============================================================================
function buildAnimals(group) {
  group.name = 'Animals';
  const kit = createSquirrelKit({ farCount: MAX });
  for (const m of Object.values(kit.far)) group.add(m);
  const habitat = makeHabitat();
  const riverBirds = createRiverBirds(group, { parkAt: habitat.parkAt });
  const deer = createDeer(group, { parkAt: habitat.parkAt });
  const cityBirds = createCityBirds(group, { parkAt: habitat.parkAt, treesNear: (x, z, r, out) => treesNear(x, z, r, out) });

  // --- trees, in cells -------------------------------------------------------------------------------------------
  let cells = new Map(), treeCount = 0, seenLength = -1, treesAt = -10;
  const infoOf = new WeakMap();
  function gatherTrees(now, list) {
    if (!list || (seenLength > 0 && (list.length === seenLength || now - treesAt < 3))) return;
    treesAt = now; seenLength = list.length;
    cells = new Map(); treeCount = 0;
    for (const c of list) {
      const k = c.knock;
      if (!k || k.kind !== 'tree') continue;
      const key = `${Math.floor(k.x / CELL)},${Math.floor(k.z / CELL)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = []));
      cell.push(k);
      treeCount++;
    }
  }
  function treesNear(x, z, r, out) {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const cell = cells.get(`${i},${j}`);
      if (cell) for (const t of cell) if (!t.down && (t.x - x) ** 2 + (t.z - z) ** 2 < r * r) out.push(t);
    }
    return out;
  }
  const info = (t) => {
    let v = infoOf.get(t);
    if (!v) infoOf.set(t, (v = habitat.of(t.x, t.z)));
    return v;
  };
  // how far out the bark is at a height up the trunk: flared at the foot, tapering up
  const barkR = (t, h) => (t.trunk || 0.2) * (1 + 0.75 * Math.exp(-h / 0.28)) * Math.max(0.35, 1 - 0.65 * h / Math.max(2, t.height || 6)) + 0.006;
  const climbable = (t) => Math.max(1.2, Math.min(5, (t.height || 6) * 0.42));

  // --- the squirrels -------------------------------------------------------------------------------------------
  const alive = new Map();
  const near = { gray: [], fox: [], black: [] }; // skinned bodies not in use, by coat
  let nearInUse = 0;

  function spawn(id, tree, k) {
    const r = stream(hash(tree.x, tree.z, k + 17));
    const where = info(tree);
    const c = r();
    const coat = c < 0.12 ? 'black' : c < 0.34 ? 'fox' : 'gray';
    const s = {
      id, tree, where, coat, r,
      scale: (coat === 'fox' ? 1.1 : 0.94) + r() * 0.1,
      x: tree.x, y: 0, z: tree.z, heading: r() * Math.PI * 2,
      mode: 'ground', state: 'forage', timer: r() * 2, speed: 0, tx: 0, tz: 0,
      gait: 0, phase: r(), sit: 0, dig: 0, alert: 0, headDown: 0, climb: 0, flick: 0, yaw: 0, pitch: 0, tilt: 0,
      want: { sit: 0, dig: 0, alert: 0 },
      theta: r() * Math.PI * 2, h: 0, hTo: 0, down: false, omega: 0,
      quiet: 0, scare: null, partner: null, leader: false, nextChase: 6 + r() * 20, chatterAt: 0,
      air: null, goneFor: 0, body: null, q: new THREE.Quaternion(), seed: r() * 10, fresh: true
    };
    // up its tree or out on the grass round it
    if (!where.lawn || r() < 0.3) {
      s.mode = 'trunk'; s.state = 'perch'; s.h = 1 + r() * (climbable(tree) - 1); s.timer = 3 + r() * 10; s.down = r() < 0.5;
    } else {
      const a = r() * Math.PI * 2, d = 0.8 + r() * where.roam * 0.8;
      s.x = tree.x + Math.cos(a) * d; s.z = tree.z + Math.sin(a) * d;
    }
    alive.set(id, s);
    return s;
  }

  function release(s) {
    dropBody(s);
    alive.delete(s.id);
    if (s.partner) s.partner.partner = null;
  }

  function takeBody(s) {
    if (s.body) return;
    const pool = near[s.coat];
    s.body = pool.pop() || kit.make(s.coat);
    group.add(s.body.mesh);
    s.body.mesh.visible = true;
    nearInUse++;
  }
  function dropBody(s) {
    if (!s.body) return;
    s.body.mesh.removeFromParent();
    near[s.coat].push(s.body);
    s.body = null;
    nearInUse--;
  }

  // --- who's around: refreshed now and then from the trees near the view ----------------------------------------
  const scratch = [], wanted = [];
  let populatedAt = -10;
  function populate(cx, cz, now, look) {
    populatedAt = now;
    if (look === 'midnight') return; // asleep in their nests
    const share = look === 'twilight' ? 0.45 : 1;
    treesNear(cx, cz, POPULATE, scratch);
    wanted.length = 0;
    for (const t of scratch) {
      const w = info(t), d2 = (t.x - cx) ** 2 + (t.z - cz) ** 2;
      for (let k = 0; k < 2; k++) {
        if (hash(t.x, t.z, k) < (w.per - k) * share) wanted.push({ t, k, d2 });
      }
    }
    wanted.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < wanted.length; i++) {
      const { t, k } = wanted[i];
      const id = `${t.x.toFixed(1)},${t.z.toFixed(1)}:${k}`;
      if (alive.has(id)) continue;
      // full: one left behind beyond reach makes room for this nearer one
      if (alive.size >= MAX) {
        let far = null, farD = POPULATE * POPULATE;
        for (const s of alive.values()) { const d = (s.x - cx) ** 2 + (s.z - cz) ** 2; if (d > farD) { farD = d; far = s; } }
        if (!far) break;
        release(far);
      }
      spawn(id, t, k);
    }
  }

  // --- what's coming: the player's vehicle or feet, and the traffic near -------------------------------------
  const RADIUS = { person: 0.45, cyclist: 1.0, car: 2.5, helicopter: 7, kayak: 1.6 };
  const threats = [];
  const player = { x: 0, y: 0, z: 0, vx: 0, vz: 0, has: false, still: 0 };
  function gatherThreats(ctx, dt) {
    threats.length = 0;
    const ent = ctx.player, mode = ctx.mode;
    if (ent?.position) {
      const p = ent.position;
      if (player.has && dt > 0) {
        const k = Math.min(1, dt * 8);
        const vx = (p.x - player.x) / dt, vz = (p.z - player.z) / dt;
        // a jump in place (a teleport) isn't a speed
        if (Math.hypot(vx, vz) < 120) { player.vx += (vx - player.vx) * k; player.vz += (vz - player.vz) * k; }
      }
      player.x = p.x; player.y = p.y; player.z = p.z; player.has = true;
      const speed = Math.hypot(player.vx, player.vz);
      player.still = mode === 'person' && speed < 0.35 ? player.still + dt : 0;
      const r = mode === 'car' && ent.bike ? 1.1 : RADIUS[mode] ?? 1;
      const vehicle = mode === 'car' || mode === 'cyclist';
      threats.push({ x: p.x, y: p.y, z: p.z, vx: player.vx, vz: player.vz, speed, r, loud: vehicle && speed > 2, air: mode === 'helicopter', player: true, foot: mode === 'person',
        lawn: vehicle && speed > 2 && habitat.lawnAt(p.x, p.z) });
    }
    const cx = ctx.camera.position.x, cz = ctx.camera.position.z;
    for (const list of [ctx.cars, ctx.buses]) {
      if (!list) continue;
      for (const c of list) {
        if (!c.edge && !c.x) continue;
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 > 110 * 110) continue;
        const sp = Math.abs(c.speed || 0);
        threats.push({ x: c.x, y: c.y ?? groundHeight(c.x, c.z), z: c.z, vx: (c.tx || 0) * sp + (c.vx || 0), vz: (c.tz || 0) * sp + (c.vz || 0), speed: sp, r: c.bus ? 6.5 : 2.5, loud: sp > 2, air: false });
      }
    }
    // the kayaks and tubes on the river
    for (const q of ctx.paddlers || []) {
      if ((q.x - cx) ** 2 + (q.z - cz) ** 2 > 200 * 200 || q.heading == null) continue;
      const sp = q.speed || 1;
      threats.push({ x: q.x, y: q.y, z: q.z, vx: Math.sin(q.heading) * sp, vz: Math.cos(q.heading) * sp, speed: sp, r: 1.6, loud: false, air: false });
    }
  }

  // How much does anything threaten a squirrel at (x, z): the worst of { t, d (to its edge), closing } or null
  function danger(s, reach = 1) {
    let worst = null, score = 0;
    for (const t of threats) {
      if (t.air && t.y - s.y > 22) continue; // the helicopter high overhead
      const dx = s.x - t.x, dz = s.z - t.z, d = Math.max(0, Math.hypot(dx, dz) - t.r);
      if (d > 48) continue;
      const closing = d > 0.01 ? (t.vx * dx + t.vz * dz) / Math.hypot(dx, dz) : t.speed;
      let k = 0;
      if (closing > 0.6 && d < (3 + closing * 1.7) * reach) k = 1 + closing / Math.max(0.5, d);
      else if (d < 2.4 * reach && t.speed > 0.45) k = 0.8; // walking right up to it
      else if (t.loud && d < 11 * reach) k = 0.6; // an engine, a bike rushing by
      else if (t.air && d < 30) k = 0.9; // the helicopter low
      else if (t.lawn && d < 45) k = 0.7; // driving across the grass scatters them all
      if (k > score) { score = k; worst = t; }
    }
    return worst ? { t: worst, score } : null;
  }

  // the nearest standing tree that isn't toward what's coming
  function refuge(s, from) {
    treesNear(s.x, s.z, 26, scratch);
    let best = null, bestScore = Infinity;
    for (const t of scratch) {
      const dx = t.x - s.x, dz = t.z - s.z, d = Math.hypot(dx, dz) + 0.01;
      let toward = 0;
      if (from) {
        const fx = from.x - s.x, fz = from.z - s.z, fd = Math.hypot(fx, fz) + 0.01;
        toward = Math.max(0, (dx * fx + dz * fz) / (d * fd));
        if (fd < d && toward > 0.6) continue; // past what's coming
      }
      const score = d * (1 + 1.6 * toward) - (t === s.tree ? 2 : 0);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  // --- what each one does ------------------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let cue = null;
  function sound(kind, s, k) { cue?.(kind, { x: s.x, y: s.y, z: s.z }, k); }

  function flee(s, th, now) {
    s.scare = th;
    s.quiet = 0;
    s.want.sit = 0; s.want.dig = 0;
    if (s.partner) { s.partner.partner = null; s.partner = null; }
    if (s.mode === 'trunk') {
      s.state = 'climb'; s.hTo = Math.min(climbable(s.tree), Math.max(s.h + 1.6, 2.6)); s.down = false; s.urgent = true;
      return;
    }
    const t = refuge(s, th);
    if (t) { s.tree = t; s.state = 'bolt'; s.speed = 0; }
    else { s.state = 'away'; s.timer = 3.2; }
    s.urgent = true;
    s.flick = 1;
    if (now - s.chatterAt > 2) { s.chatterAt = now; sound('chatter', s, 0.9); }
  }

  function leap(s, th) {
    // straight out of the way: across what's coming, away from its line
    let ax = -th.vz, az = th.vx;
    const l = Math.hypot(ax, az) || 1;
    ax /= l; az /= l;
    if ((s.x - th.x) * ax + (s.z - th.z) * az < 0) { ax = -ax; az = -az; }
    const reach = 2.4 + s.r() * 0.8;
    s.mode = 'air';
    s.state = 'leap';
    s.air = { x0: s.x, z0: s.z, y0: s.y, x1: s.x + ax * reach, z1: s.z + az * reach, t: 0, dur: 0.42, top: 0.7 };
    s.heading = Math.atan2(ax, az);
  }

  function vanish(s) {
    s.mode = 'gone'; s.state = 'gone'; s.goneFor = 0;
    if (s.partner) { s.partner.partner = null; s.partner = null; }
    dropBody(s);
  }

  function groundStep(s, dt, tx, tz, speed, stopAt = 0.15) {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    if (d < stopAt) { s.speed += (0 - s.speed) * Math.min(1, dt * 12); return true; }
    const want = Math.atan2(dx, dz);
    s.heading += wrap(want - s.heading) * Math.min(1, dt * (speed > 3 ? 14 : 8));
    s.speed += (Math.min(speed, d * 3) - s.speed) * Math.min(1, dt * 7);
    s.x += Math.sin(s.heading) * s.speed * dt;
    s.z += Math.cos(s.heading) * s.speed * dt;
    return false;
  }

  function onTrunkAt(s) {
    const R = barkR(s.tree, s.h);
    s.x = s.tree.x + Math.cos(s.theta) * R;
    s.z = s.tree.z + Math.sin(s.theta) * R;
    s.y = s.tree.g + s.h;
  }

  function toTrunk(s) {
    s.mode = 'trunk';
    s.theta = Math.atan2(s.z - s.tree.z, s.x - s.tree.x);
    s.h = 0.02;
    s.down = false;
  }

  function think(s, dt, now, ctx) {
    const R = s.r;
    if (s.mode === 'gone') {
      s.goneFor += dt;
      // back later, up its tree, out of sight
      if (s.goneFor > 25 && ctx.look !== 'midnight') {
        const cp = ctx.camera.position;
        if ((s.tree.x - cp.x) ** 2 + (s.tree.z - cp.z) ** 2 > 30 * 30 && !s.tree.down) {
          s.mode = 'trunk'; s.state = 'perch'; s.h = climbable(s.tree); s.timer = 6; s.down = R() < 0.5; s.fresh = true;
        }
      }
      return;
    }
    if (s.tree.down) {
      // its tree went over: off it and away
      if (s.mode === 'trunk') { s.mode = 'ground'; s.h = 0; }
      const t = refuge(s, null);
      if (t) { s.tree = t; s.state = 'bolt'; } else { vanish(s); return; }
    }

    // --- the one thing that matters most: nothing ever touches it ---
    const th = danger(s);
    if (th && s.mode !== 'air') {
      const t = th.t, d = Math.max(0, Math.hypot(s.x - t.x, s.z - t.z) - t.r);
      const low = s.mode === 'ground' || (s.mode === 'trunk' && s.h < 0.9);
      const tooClose = d < 0.25 + t.speed * 0.06;
      if (low && tooClose && t.speed > 0.3) { if (d < 0.12 || s.mode === 'trunk') { vanish(s); return; } leap(s, t); }
      else if (t.air && s.mode === 'trunk' && d < 1.5) { vanish(s); return; }
      else if (!['bolt', 'away', 'climb'].includes(s.state) || (s.state === 'climb' && !s.urgent)) {
        if (s.mode === 'ground' || (s.mode === 'trunk' && (s.h < 1.8 || th.score > 1.2 || t.air))) flee(s, t, now);
      }
      s.quiet = 0;
    } else s.quiet += dt;

    // asleep after dark: home and up into the leaves
    if (ctx.look === 'midnight' && s.state !== 'bed') {
      if (s.mode === 'ground') { s.tree = refuge(s, null) || s.tree; s.state = 'bolt'; s.urgent = false; }
      else if (s.mode === 'trunk') { s.state = 'bed'; s.hTo = climbable(s.tree); }
    }

    s.timer -= dt;
    switch (s.state) {
      case 'forage': {
        s.speed += (0 - s.speed) * Math.min(1, dt * 10);
        if (s.timer > 0) break;
        s.want.sit = 0; s.want.dig = 0; s.want.alert = 0;
        // someone standing still on foot: worth a look, and a few steps closer
        if (player.still > 2 && Math.hypot(player.x - s.x, player.z - s.z) < 13 && R() < 0.55) { s.state = 'approach'; break; }
        const pick = R();
        if (s.nextChase < now && s.partner === null && pick < 0.12) {
          const other = [...alive.values()].find((o) => o !== s && o.state === 'forage' && !o.partner && o.mode === 'ground' && Math.hypot(o.x - s.x, o.z - s.z) < 9);
          if (other) { startChase(s, other, now); break; }
        }
        if (pick < 0.5) {
          const a = R() * TAU, d = 0.8 + R() * 2.5;
          let tx = s.x + Math.cos(a) * d, tz = s.z + Math.sin(a) * d;
          // never strays far from its tree
          const hx = tx - s.tree.x, hz = tz - s.tree.z, hd = Math.hypot(hx, hz);
          if (hd > s.where.roam) { tx = s.tree.x + hx / hd * s.where.roam * 0.6; tz = s.tree.z + hz / hd * s.where.roam * 0.6; }
          if (hd < 0.7) { tx = s.tree.x + hx / (hd || 1) * 0.9; tz = s.tree.z + hz / (hd || 1) * 0.9; }
          s.tx = tx; s.tz = tz; s.state = 'hop'; s.hopSpeed = 1.5 + R() * 1.1;
        } else if (pick < 0.68) { s.want.sit = 1; s.timer = 1.5 + R() * 3; if (R() < 0.6) s.flick = 0.8; }
        else if (pick < 0.88) { s.want.dig = 1; s.timer = 1.4 + R() * 3.5; }
        else if (pick < 0.95) { s.want.alert = 1; s.timer = 0.8 + R() * 1.5; s.yawTo = (R() - 0.5) * 1.8; }
        else { s.state = 'home'; }
        break;
      }
      case 'hop':
        if (groundStep(s, dt, s.tx, s.tz, s.hopSpeed, 0.2)) { s.state = 'forage'; s.timer = 0.3 + R() * 1.4; }
        break;
      case 'approach': {
        const dx = player.x - s.x, dz = player.z - s.z, d = Math.hypot(dx, dz);
        if (player.still <= 0 || d > 16) { s.state = 'forage'; s.timer = 0.5; break; }
        if (d > 1.7) {
          // in bursts: a few bounds, a stop to check
          if (s.timer <= 0) { s.burst = !s.burst; s.timer = s.burst ? 0.6 + R() * 0.6 : 0.5 + R() * 1.2; }
          if (s.burst) groundStep(s, dt, player.x - dx / d * 1.5, player.z - dz / d * 1.5, 1.7, 0.1);
          else { s.speed += (0 - s.speed) * Math.min(1, dt * 10); s.want.alert = 1; }
          s.want.sit = 0;
        } else {
          s.speed += (0 - s.speed) * Math.min(1, dt * 10);
          s.heading += wrap(Math.atan2(dx, dz) - s.heading) * Math.min(1, dt * 4);
          s.want.sit = 1; s.want.alert = 0;
          if (R() < dt * 0.4) s.flick = 0.7;
        }
        break;
      }
      case 'home':
      case 'bolt': {
        const t = s.tree, R0 = barkR(t, 0) + 0.02;
        const urgent = s.state === 'bolt' && s.urgent !== false;
        const arrived = groundStep(s, dt, t.x, t.z, urgent ? 5.8 : 2.6, R0 + 0.08);
        s.want.sit = 0; s.want.dig = 0; s.want.alert = 0;
        if (arrived || Math.hypot(t.x - s.x, t.z - s.z) < R0 + 0.12) {
          toTrunk(s);
          s.state = ctx.look === 'midnight' ? 'bed' : 'climb';
          s.hTo = urgent ? climbable(t) * (0.7 + R() * 0.3) : 1.2 + R() * (climbable(t) - 1.2);
          s.omega = (R() < 0.5 ? -1 : 1) * (urgent ? 1.6 : 0.5);
          // round to the far side from what scared it
          if (s.scare) s.thetaTo = Math.atan2(t.z - s.scare.z, t.x - s.scare.x);
          else s.thetaTo = null;
        }
        break;
      }
      case 'away': {
        // nowhere to climb: straight away, and gone
        const th0 = s.scare;
        if (th0) {
          const dx = s.x - th0.x, dz = s.z - th0.z, d = Math.hypot(dx, dz) || 1;
          groundStep(s, dt, s.x + dx / d * 5, s.z + dz / d * 5, 5.8, 0);
        }
        if (s.timer <= 0) vanish(s);
        break;
      }
      case 'climb':
      case 'bed': {
        const up = s.state === 'bed' ? 1.4 : s.urgent ? 3.2 : 1.6;
        s.down = false;
        s.h = Math.min(s.hTo, s.h + up * dt);
        if (s.thetaTo != null) s.theta += wrap(s.thetaTo - s.theta) * Math.min(1, dt * 2.5);
        else s.theta += s.omega * dt * 0.4;
        if (s.h >= s.hTo - 0.01) {
          if (s.state === 'bed') { vanish(s); break; }
          s.state = 'perch'; s.timer = s.urgent ? 4 + R() * 5 : 3 + R() * 9; s.urgent = false; s.turnAt = R() * 2;
        }
        break;
      }
      case 'perch': {
        // head down the trunk to watch, tail flicking, scolding while something's near
        if (s.turnAt != null && s.timer < s.turnAt + 2 && !s.down && R() < dt * 0.6) s.down = true;
        if (s.quiet < 3 && now - s.chatterAt > 1.4 + R() * 3) { s.chatterAt = now; s.flick = 1; sound('chatter', s, 0.7); }
        else if (R() < dt * 0.25) s.flick = 0.7;
        if (s.timer <= 0 && s.quiet > 5) { s.state = 'descend'; s.down = true; }
        break;
      }
      case 'descend': {
        s.down = true;
        s.h -= 1.5 * dt;
        if (s.h <= 0.03) {
          s.h = 0; s.mode = 'ground';
          const R0 = barkR(s.tree, 0) + 0.12;
          s.x = s.tree.x + Math.cos(s.theta) * R0; s.z = s.tree.z + Math.sin(s.theta) * R0;
          s.heading = Math.atan2(Math.cos(s.theta), Math.sin(s.theta));
          s.state = s.where.lawn ? 'forage' : 'perchSoon';
          s.timer = 0.4 + R();
          s.scare = null;
        }
        break;
      }
      case 'perchSoon':
        // a downtown squirrel: down for a sniff round its tree, and back up
        if (s.timer <= 0) { s.state = 'home'; }
        break;
      case 'chase': {
        // the leader dashes for its tree with the other on its tail; round and round the trunk they go
        const L = s.leader ? s : s.partner;
        if (!L || !s.partner) { s.state = 'forage'; s.timer = 0.5; break; }
        if (s.leader) {
          if (groundStep(s, dt, s.tree.x, s.tree.z, 4.6, barkR(s.tree, 0) + 0.1)) { toTrunk(s); s.state = 'spiral'; s.timer = 5 + R() * 5; s.omega = (R() < 0.5 ? -1 : 1) * 2.4; }
        } else {
          groundStep(s, dt, L.x, L.z, 4.9, 0.25);
          if (L.mode === 'trunk' && Math.hypot(s.tree.x - s.x, s.tree.z - s.z) < barkR(s.tree, 0) + 0.25) { toTrunk(s); s.state = 'spiral'; s.timer = L.timer; }
        }
        if (s.timer < -12) endChase(s, now);
        break;
      }
      case 'spiral': {
        const L = s.leader ? s : s.partner;
        if (!L) { s.state = 'perch'; s.timer = 3; break; }
        if (s.leader) {
          s.theta += s.omega * dt;
          if (s.r() < dt * 0.5) s.omega = -s.omega; // doubles back round the trunk
          s.hTo = s.hTo && Math.abs(s.hTo - s.h) > 0.1 ? s.hTo : 0.4 + s.r() * (climbable(s.tree) - 0.6);
          s.h += Math.sign(s.hTo - s.h) * Math.min(Math.abs(s.hTo - s.h), 2.2 * dt);
          s.down = s.hTo < s.h - 0.1;
        } else {
          s.theta += wrap(L.theta - Math.sign(L.omega || 1) * 1.3 - s.theta) * Math.min(1, dt * 6);
          s.h += (L.h - 0.15 - s.h) * Math.min(1, dt * 5);
          s.h = Math.max(0.02, s.h);
          s.down = L.down;
        }
        if (now - s.chatterAt > 0.8 + s.r() * 1.5) { s.chatterAt = now; sound('chatter', s, 0.6); }
        if (s.leader && s.timer <= 0) endChase(s, now);
        break;
      }
      case 'leap':
        break;
    }
    // ground squirrels a tree's reach off their own (a long chase): head home
    if (s.mode === 'ground' && s.state === 'forage' && Math.hypot(s.x - s.tree.x, s.z - s.tree.z) > s.where.roam * 1.6) { s.state = 'home'; }
  }

  function startChase(a, b, now) {
    a.partner = b; b.partner = a; a.leader = true; b.leader = false;
    b.tree = a.tree;
    a.state = b.state = 'chase';
    a.timer = b.timer = 0;
    a.nextChase = b.nextChase = now + 25 + a.r() * 30;
    a.flick = b.flick = 1;
    sound('chatter', a, 0.8);
  }
  function endChase(s, now) {
    const o = s.partner;
    for (const q of [s, o]) {
      if (!q) continue;
      q.partner = null;
      if (q.mode === 'trunk') { q.state = 'perch'; q.timer = 2 + q.r() * 4; q.down = q === o; q.quiet = 6; }
      else { q.state = 'forage'; q.timer = 0.5; }
    }
  }

  // --- moving and drawing ----------------------------------------------------------------------------------------
  const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _x = new THREE.Vector3();
  const _tq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const pose = { gait: 0, phase: 0, sit: 0, climb: 0, headDown: 0, dig: 0, flick: 0, time: 0, yaw: 0, pitch: 0, alert: 0, tilt: 0, seed: 0 };

  function move(s, dt, now, cam) {
    if (s.mode === 'gone') return;
    const approach = (v, to, k) => v + (to - v) * Math.min(1, dt * k);
    s.sit = approach(s.sit, s.want.sit, 7);
    s.dig = approach(s.dig, s.want.dig, 6);
    s.alert = approach(s.alert, s.want.alert, 8);
    s.flick = Math.max(0, s.flick - dt * 1.4);
    let speed = 0;
    if (s.mode === 'air') {
      const a = s.air;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      s.x = a.x0 + (a.x1 - a.x0) * k; s.z = a.z0 + (a.z1 - a.z0) * k;
      s.y = groundHeight(s.x, s.z) + Math.sin(Math.PI * k) * a.top;
      speed = 5;
      if (k >= 1) {
        s.mode = 'ground'; s.air = null;
        const t = refuge(s, s.scare);
        if (t) { s.tree = t; s.state = 'bolt'; s.urgent = true; } else { s.state = 'away'; s.timer = 2.5; }
      }
    } else if (s.mode === 'ground') {
      s.y = groundHeight(s.x, s.z);
      speed = s.speed;
    } else {
      onTrunkAt(s);
      speed = ['climb', 'bed', 'descend'].includes(s.state) ? (s.state === 'descend' ? 1.5 : s.urgent ? 3.2 : 1.6) : s.state === 'spiral' ? 2.2 : 0;
    }
    s.gait = approach(s.gait, speed > 0.2 ? Math.min(1, 0.55 + speed * 0.12) : 0, 10);
    s.phase = (s.phase + dt * (speed > 0.2 ? 2.4 + speed * 0.75 : 1.2) * (s.gait > 0.05 ? 1 : 0)) % 1;
    s.climb = approach(s.climb, s.mode === 'trunk' ? 1 : 0, 12);
    s.headDown = approach(s.headDown, s.mode === 'trunk' && s.down && s.state === 'perch' ? 1 : 0, 4);

    // the head: toward whoever stands near, or looking round
    const dx = player.x - s.x, dz = player.z - s.z, pd = Math.hypot(dx, dz);
    let yawTo = 0;
    if (pd < 9 && s.mode === 'ground' && s.gait < 0.3) yawTo = Math.max(-1.1, Math.min(1.1, wrap(Math.atan2(dx, dz) - s.heading)));
    else if (s.want.alert) yawTo = s.yawTo || 0;
    else yawTo = Math.sin(now * 0.7 + s.seed) * 0.5 * (1 - s.gait);
    s.yaw = approach(s.yaw, yawTo, 5);
    s.tilt = approach(s.tilt, s.sit > 0.5 ? Math.sin(now * 0.9 + s.seed) * 0.25 : 0, 3);

    // its frame in the world: on the ground facing its way; on a trunk belly to the bark, up, down or round it
    if (s.mode === 'trunk') {
      _u.set(Math.cos(s.theta), 0, Math.sin(s.theta));
      const tang = _x.set(-Math.sin(s.theta), 0, Math.cos(s.theta));
      const round = s.state === 'spiral' ? (s.leader ? s.omega : (s.partner?.omega || 0)) * barkR(s.tree, s.h) : 0;
      const vert = s.down ? -1 : 1;
      _f.set(0, vert * (s.state === 'spiral' ? 1.2 : 1), 0).addScaledVector(tang, round * 0.6).normalize();
    } else {
      _u.set(0, 1, 0);
      _f.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    }
    _x.crossVectors(_u, _f).normalize();
    _u.crossVectors(_f, _x);
    _m.makeBasis(_x, _u, _f);
    _tq.setFromRotationMatrix(_m);
    if (s.fresh) { s.q.copy(_tq); s.fresh = false; } else s.q.slerp(_tq, Math.min(1, dt * 14));
  }

  function draw(s, now, d2, useNear) {
    if (s.mode === 'gone') { dropBody(s); return; }
    pose.gait = s.gait; pose.phase = s.phase; pose.sit = s.sit; pose.climb = s.climb; pose.headDown = s.headDown;
    pose.dig = s.dig; pose.flick = s.flick; pose.time = now; pose.yaw = s.yaw; pose.pitch = 0; pose.alert = s.alert; pose.tilt = s.tilt; pose.seed = s.seed;
    if (useNear) {
      takeBody(s);
      const lift = poseSquirrel(s.body.bones, pose);
      const m = s.body.mesh;
      m.quaternion.copy(s.q);
      _u.set(0, 1, 0).applyQuaternion(s.q);
      m.position.set(s.x, s.y, s.z).addScaledVector(_u, lift * s.scale);
      m.scale.setScalar(s.scale);
    } else {
      dropBody(s);
      const far = kit.far[s.coat];
      if (far.count >= far.instanceMatrix.count) return;
      // the stand-in hops too
      const lift = s.gait * 0.05 * Math.max(0, Math.sin(s.phase * Math.PI * 2));
      _u.set(0, 1, 0).applyQuaternion(s.q);
      _p.set(s.x, s.y, s.z).addScaledVector(_u, lift * s.scale);
      _s.setScalar(s.scale);
      _m.compose(_p, s.q, _s);
      far.setMatrixAt(far.count++, _m);
    }
  }

  const order = [];
  let reported = false, lastLog = 0;
  function update(dt, elapsed, ctx) {
    dt = Math.min(dt, 0.1);
    cue = ctx.cue || null;
    gatherTrees(elapsed, ctx.colliders);
    const cp = ctx.camera.position;
    if (elapsed - populatedAt > 1.2) {
      for (const s of [...alive.values()]) if ((s.x - cp.x) ** 2 + (s.z - cp.z) ** 2 > RELEASE * RELEASE) release(s);
      populate(cp.x, cp.z, elapsed, ctx.look);
    }
    gatherThreats(ctx, dt);
    order.length = 0;
    for (const s of alive.values()) {
      think(s, dt, elapsed, ctx);
      move(s, dt, elapsed, ctx.camera);
      if (s.mode !== 'gone') order.push(s);
      else dropBody(s);
    }
    for (const m of Object.values(kit.far)) m.count = 0;
    for (const s of order) s.d2 = (s.x - cp.x) ** 2 + (s.y - cp.y) ** 2 + (s.z - cp.z) ** 2;
    order.sort((a, b) => a.d2 - b.d2);
    // the skinned bodies go to the nearest; anyone further gives theirs back first
    for (let i = 0; i < order.length; i++) if (!(i < NEAR && order[i].d2 < NEAR_DIST * NEAR_DIST)) dropBody(order[i]);
    for (let i = 0; i < order.length; i++) draw(order[i], elapsed, order[i].d2, i < NEAR && order[i].d2 < NEAR_DIST * NEAR_DIST);
    for (const m of Object.values(kit.far)) m.instanceMatrix.needsUpdate = m.count > 0;
    riverBirds.update(dt, elapsed, ctx, threats);
    deer.update(dt, elapsed, ctx, threats);
    cityBirds.update(dt, elapsed, ctx, threats, player);

    if (!reported && treeCount > 0) {
      reported = true;
      const st = kit.stats;
      log(`[animals] squirrels: ${st.triangles} triangles near, ${st.farTriangles} far; ${(st.bytes / 1024).toFixed(0)} KB of shape, ${(st.textureBytes / 1024).toFixed(0)} KB of fur; ${treeCount} trees to live on`);
    }
    if (elapsed - lastLog > 30) {
      lastLog = elapsed;
      let up = 0, ground = 0;
      for (const s of alive.values()) { if (s.mode === 'trunk') up++; else if (s.mode !== 'gone') ground++; }
      if (alive.size) log(`[animals] ${alive.size} squirrels about (${ground} on the ground, ${up} up trees, ${nearInUse} close up)`);
    }
  }

  return {
    update,
    stats: kit.stats,
    get count() { return alive.size; },
    riverBirds,
    deer,
    cityBirds,
    dispose() { kit.dispose(); riverBirds.dispose(); deer.dispose(); cityBirds.dispose(); }
  };
}

export { buildAnimals };
