// The town's birds, near the view only: rock pigeons in flocks on the sidewalks downtown and around campus, house
// sparrows hopping in little groups by the shops and in the neighborhoods, American robins running and stopping on the
// lawns, and American crows walking the grass in twos and threes. Models are animal-birds.js; animals.js runs this.
//
// Each lives the way it does in Ann Arbor: pigeons walk with their heads bobbing, peck, coo, drift over to someone
// standing still, shuffle away from someone walking at them and only go up close, the whole flock at once, round in a
// wide circle and down again nearby; sparrows hop on both feet, peck in quick runs, chirp, and dart up into the nearest
// tree, coming back down when it's quiet; robins run a few steps, stop upright with the head cocked, now and then tug
// at the grass, and fly off low; crows walk with a long stride, caw in runs, and are the wariest, leaving early and
// flying well off to other grass. None of them is out at night.
//
// Up off the ground they sit in rows on the streetlights' arms and the signals' mast arms (pigeons downtown, crows
// and sparrows elsewhere), along houses' ridges, and on the tops of trees (crows, sparrows, robins), looking about,
// preening and calling now and then. Walkers and traffic far below don't bother them; the helicopter, or someone up
// level with them, sends them off, down to the ground or away, and a pole knocked over takes its birds with it.
//
// THE RULE ABOVE EVERYTHING (animals.js): no bird is ever struck, hurt or knocked down. They aren't in the colliders,
// the knock-downs or the ragdolls. Anything coming at one sends it off well before it arrives; if something still
// reaches one it quietly vanishes.
import * as THREE from 'three/webgpu';
import { groundHeight, riverDepth } from './terrain.js';
import { blockAt } from './city-config.js';
import { LIFT } from './ground-lifts.js';
import { createBirdKit, BIRD_FOLDED } from './animal-birds.js';
import { TIER, XBOX } from './device-tier.js';
import { log } from '../lamp-game.js';

const CELL = 48; // the town in cells; which have birds is fixed by where the cell is
const POPULATE = TIER.stream ? 85 : 110, RELEASE = POPULATE + 35; // alive within this far of the view (m)
const MAX = TIER.name === 'phone' ? 56 : TIER.stream ? 84 : 120; // alive at once
// on the Xbox, where the processor is short, the birds not flying think, move and are posed every other frame, half
// of them each frame (their time kept up), the ones in the air every frame
const HALVED = XBOX;
const NEAR_DIST = 30; // skinned bodies within this far; the rest are baked stand-ins

// How each kind moves and how much it lets come near (m): `foot` someone walking up, `miss` how close something
// passing may come, `walk` its pace, `fly` its speed in the air, `flap` its wingbeats a second
const KIND = {
  pigeon: { walk: 0.32, fly: 9, flap: 6, foot: 2.6, miss: 1.6, scale: [0.94, 1.06], near: [6, 3] },
  sparrow: { walk: 0.38, fly: 7, flap: 9, foot: 3.2, miss: 2.2, scale: [0.93, 1.07], near: [5, 2] },
  robin: { walk: 1.25, fly: 8, flap: 8, foot: 6, miss: 3.5, scale: [0.95, 1.05], near: [3, 2] },
  crow: { walk: 0.5, fly: 9.5, flap: 3.6, foot: 15, miss: 7, scale: [0.93, 1.07], near: [3, 2] }
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
const downtown = (x, z) => Math.abs(x - 40) < 330 && Math.abs(z + 20) < 420;
const campus = (x, z) => x > 560 && x < 1400 && z > -160 && z < 720;

function createCityBirds(group, { parkAt, treesNear }) {
  const kits = {
    pigeon: createBirdKit('pigeon', { farCount: 70 }),
    sparrow: createBirdKit('sparrow', { farCount: 56 }),
    robin: createBirdKit('robin', { farCount: 24 }),
    crow: createBirdKit('crow', { farCount: 36 })
  };
  const NEAR = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, TIER.stream ? v.near[1] : v.near[0]]));
  for (const k of Object.values(kits)) for (const m of Object.values(k.far)) group.add(m);
  const pools = {};
  const inUse = { pigeon: 0, sparrow: 0, robin: 0, crow: 0 };
  let cue = null, look = 'midday';
  const night = () => look === 'midnight';
  const sound = (kind, b, k = 1) => { if (!night()) cue?.(kind, { x: b.x, y: b.y + 0.2, z: b.z }, k); };

  // --- where they can stand: clear of buildings, benches and poles (their colliders' boxes) --------------------------
  let solids = new Map(), solidsLength = -1, solidsAt = -10;
  function gatherSolids(now, list) {
    if (!list || (solidsLength >= 0 && (list.length === solidsLength || now - solidsAt < 3))) return;
    solidsAt = now; solidsLength = list.length;
    solids = new Map();
    perches = new Map();
    for (const c of list) {
      // what they perch on: a streetlight's or a signal's arm, a house's ridge
      const k = c.knock;
      if (k?.arm && !k.down) {
        const dx = k.arm.x - k.x, dz = k.arm.z - k.z, l = Math.hypot(dx, dz) || 1;
        addPerch({ kind: 'arm', ax: k.x + dx / l * 0.25, az: k.z + dz / l * 0.25, bx: k.arm.x, bz: k.arm.z, y: k.g + k.arm.y, of: k });
      }
      if (c.roofs) for (const R of c.roofs) {
        if (R.type !== 'gable' && R.type !== 'hip') continue;
        const half = (R.type === 'hip' ? R.ha - R.hb : R.ha) - 0.3;
        if (half < 0.8) continue;
        addPerch({ kind: 'ridge', ax: R.cx - R.ax * half, az: R.cz - R.az * half, bx: R.cx + R.ax * half, bz: R.cz + R.az * half, y: R.top + R.rh + 0.04 });
      }
      if (c.knock?.kind === 'tree' || c.stand || !Number.isFinite(c.minX) || c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400) continue;
      for (let i = Math.floor(c.minX / 16); i <= Math.floor(c.maxX / 16); i++) {
        for (let j = Math.floor(c.minZ / 16); j <= Math.floor(c.maxZ / 16); j++) {
          const key = i * 100000 + j;
          let cell = solids.get(key);
          if (!cell) solids.set(key, (cell = []));
          cell.push(c);
        }
      }
    }
  }
  let perches = new Map();
  function addPerch(p) {
    const key = Math.floor((p.ax + p.bx) / 2 / CELL) + ',' + Math.floor((p.az + p.bz) / 2 / CELL);
    let list = perches.get(key);
    if (!list) perches.set(key, (list = []));
    list.push(p);
  }
  // a row of n spots along a perch (or round a treetop): [{ x, y, z, heading }]
  function perchSpots(p, n, gap, r) {
    const out = [];
    if (p.kind === 'tree') {
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = 0.3 + r() * p.r;
        out.push({ x: p.x + Math.sin(a) * d, y: p.y - (d / p.r) * 0.9 - r() * 0.3, z: p.z + Math.cos(a) * d, heading: a + (r() - 0.5) * 1.5 });
      }
      return out;
    }
    const dx = p.bx - p.ax, dz = p.bz - p.az, L = Math.hypot(dx, dz);
    n = Math.max(1, Math.min(n, Math.floor(L / gap)));
    const face = Math.atan2(-dz, dx) + (r() < 0.5 ? 0 : Math.PI);
    let t = r() * Math.max(0, L - n * gap);
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, t / L);
      out.push({ x: p.ax + dx * f, y: p.y, z: p.az + dz * f, heading: face + (r() < 0.2 ? Math.PI : 0) + (r() - 0.5) * 0.5 });
      t += gap * (1 + r() * 1.4);
      if (t > L) break;
    }
    return out;
  }
  function clear(x, z, pad = 0.5) {
    const cell = solids.get(Math.floor(x / 16) * 100000 + Math.floor(z / 16));
    if (cell) for (const c of cell) if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return false;
    return !(riverDepth(x, z) > 0);
  }
  // a spot on the sidewalk within `rad` of (x, z): along a block's curb, `inset` in from it; { x, z, y } or null
  function sidewalkNear(r, x, z, rad, tries = 8) {
    for (let i = 0; i < tries; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      const b = blockAt(px, pz);
      if (!b) continue;
      // the nearest stretch of curb, and a point a little in from it
      let best = null, bd = Infinity;
      for (let k = 0, j = b.poly.length - 1; k < b.poly.length; j = k++) {
        const p = b.poly[j], q = b.poly[k], ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((px - p.x) * ex + (pz - p.z) * ez) / l2));
        const cx = p.x + ex * t, cz = p.z + ez * t, dd = (px - cx) ** 2 + (pz - cz) ** 2;
        if (dd < bd) { bd = dd; best = { cx, cz, ex, ez, l: Math.sqrt(l2) }; }
      }
      if (!best) continue;
      const inset = 0.9 + r() * 2.2;
      for (const s of [1, -1]) {
        const nx = -best.ez / best.l * s, nz = best.ex / best.l * s;
        const sx = best.cx + nx * inset, sz = best.cz + nz * inset;
        if (blockAt(sx, sz) !== b || !clear(sx, sz)) continue;
        return { x: sx, z: sz, y: groundHeight(sx, sz) + LIFT.slab };
      }
    }
    return null;
  }
  // a spot on the grass within `rad` of (x, z): a park's or a lawn block's, well in from the sidewalk
  function lawnNear(r, x, z, rad, tries = 8) {
    for (let i = 0; i < tries; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      const b = blockAt(px, pz);
      const park = parkAt(px, pz);
      if (!b && !park) continue;
      if (b && !b.lawn && !(b.park > 0.3) && !park) continue;
      if (b && !park) {
        // in from the sidewalk ring
        let near = Infinity;
        for (let k = 0, j = b.poly.length - 1; k < b.poly.length; j = k++) {
          const p = b.poly[j], q = b.poly[k], ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1;
          const t = Math.max(0, Math.min(1, ((px - p.x) * ex + (pz - p.z) * ez) / l2));
          near = Math.min(near, Math.hypot(px - p.x - ex * t, pz - p.z - ez * t));
        }
        if (near < 5.5) continue;
      }
      if (!clear(px, pz, 1.2)) continue;
      return { x: px, z: pz, y: groundHeight(px, pz) + (b ? LIFT.lawn : 0) };
    }
    return null;
  }
  const spotNear = (b, r, x, z, rad, tries) => (b.ground === 'lawn' ? lawnNear(r, x, z, rad, tries) : sidewalkNear(r, x, z, rad, tries));

  // --- the birds ---------------------------------------------------------------------------------------------------
  const cells = new Map(); // cell key → its birds
  const birds = [];
  function bird(kind, at, r, plumage, flock) {
    const K = KIND[kind];
    const b = {
      kind, K, spec: kits[kind].spec, plumage, r, x: at.x, y: at.y, z: at.z, gy: at.y, heading: r() * Math.PI * 2, speed: 0,
      mode: 'ground', state: 'idle', timer: r() * 3, tx: at.x, tz: at.z, flock, ground: flock.ground,
      scale: K.scale[0] + r() * (K.scale[1] - K.scale[0]), seed: r() * 10,
      p: { ...BIRD_FOLDED, seed: 0 }, want: { graze: 0, alert: 0, tuck: 0, beat: 0, glide: 0, fold: 1, legsUp: 0 },
      flight: null, body: null, q: new THREE.Quaternion(), fresh: true, roll: 0, pitch: 0, hop: 0, calledAt: -99, peck: 0
    };
    b.p.seed = b.seed;
    birds.push(b);
    return b;
  }

  // Who lives in a cell, by what's there: { kind, n, ground } for each group
  function residents(cx, cz, r) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL, out = [];
    const park = parkAt(x, z), dt = downtown(x, z), cm = campus(x, z);
    const b = blockAt(x, z), green = park || b?.lawn || b?.park > 0.3;
    if (dt || cm || park?.quad) {
      if (r() < (dt ? 0.42 : park?.quad ? 0.6 : 0.22)) out.push({ kind: 'pigeon', n: 5 + Math.floor(r() * (dt ? 11 : 7)), ground: 'sidewalk' });
      if (r() < (dt ? 0.38 : 0.2)) out.push({ kind: 'sparrow', n: 3 + Math.floor(r() * 5), ground: 'sidewalk' });
    } else {
      if (r() < (park ? 0.12 : 0.24)) out.push({ kind: 'sparrow', n: 2 + Math.floor(r() * 4), ground: 'sidewalk' });
      if (r() < 0.05) out.push({ kind: 'pigeon', n: 3 + Math.floor(r() * 4), ground: 'sidewalk' });
    }
    if (green || cm || !dt) {
      if (r() < (park ? 0.55 : cm ? 0.4 : 0.35)) out.push({ kind: 'robin', n: 1 + (r() < 0.35 ? 1 : 0), ground: 'lawn' });
      if (r() < (park ? 0.22 : cm ? 0.2 : 0.1)) out.push({ kind: 'crow', n: 2 + Math.floor(r() * 3), ground: 'lawn' });
    }
    return out;
  }
  // Who sits up on the arms, the ridges and the treetops of a cell. The arms and ridges come in as their streets and
  // houses do, so a cell already peopled gets its perched birds once its perches turn up.
  function perchers(cx, cz, r, trees) {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL, out = [];
    const dt = downtown(x, z), cm = campus(x, z);
    const here = perches.get(cx + ',' + cz) || [];
    const arms = here.filter((p) => p.kind === 'arm'), ridges = here.filter((p) => p.kind === 'ridge');
    const pick = (list) => list[Math.floor(r() * list.length)];
    for (let i = 0; i < Math.min(3, arms.length); i++) {
      if (r() > (dt ? 0.75 : 0.5)) continue;
      const k = dt || cm ? (r() < 0.75 ? 'pigeon' : 'sparrow') : (r() < 0.45 ? 'crow' : r() < 0.6 ? 'pigeon' : 'sparrow');
      out.push({ kind: k, n: k === 'crow' ? 1 + Math.floor(r() * 3) : 2 + Math.floor(r() * 5), ground: 'perch', perch: pick(arms) });
    }
    for (let i = 0; i < Math.min(3, ridges.length); i++) {
      if (r() > (dt ? 0.4 : 0.32)) continue;
      const c = r(), k = dt ? (c < 0.8 ? 'pigeon' : 'crow') : (c < 0.4 ? 'sparrow' : c < 0.65 ? 'crow' : c < 0.85 ? 'pigeon' : 'robin');
      out.push({ kind: k, n: k === 'robin' ? 1 : k === 'crow' ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 4), ground: 'perch', perch: pick(ridges) });
    }
    if (trees && treesNear && r() < (dt ? 0.35 : 0.75)) {
      const trees = treesNear(x, z, CELL * 0.6, scratch).filter((t) => (t.height || 0) > 6);
      for (let i = 0; i < 2 && trees.length; i++) {
        if (i && r() > 0.5) break;
        const t = pick(trees), g = t.g ?? groundHeight(t.x, t.z), h = t.height;
        const c = r(), k = c < 0.4 ? 'crow' : c < 0.8 ? 'sparrow' : 'robin';
        out.push({ kind: k, n: k === 'robin' ? 1 + (r() < 0.4 ? 1 : 0) : k === 'crow' ? 1 + Math.floor(r() * 3) : 2 + Math.floor(r() * 4), ground: 'perch',
          perch: { kind: 'tree', x: t.x, z: t.z, y: g + h * 0.97, r: Math.max(0.8, h * 0.12) } });
      }
    }
    return out;
  }
  function perchCell(cx, cz, list, first) {
    const here = perches.get(cx + ',' + cz);
    list.perched = here?.length || 0;
    const r = stream(hash(cx * 41.3, cz * 29.9, 131 + list.perched));
    for (const g of perchers(cx, cz, r, first)) {
      if (birds.length + g.n > MAX) break;
      const p = g.perch, spots = perchSpots(p, g.n, g.kind === 'crow' ? 0.7 : g.kind === 'pigeon' ? 0.32 : 0.22, r);
      const mx = p.kind === 'tree' ? p.x : (p.ax + p.bx) / 2, mz = p.kind === 'tree' ? p.z : (p.az + p.bz) / 2;
      const flock = { x: mx, z: mz, ground: g.kind === 'robin' || g.kind === 'crow' ? 'lawn' : 'sidewalk', kind: g.kind, members: [], r: 6, perch: p };
      for (const at of spots) {
        const plumage = g.kind === 'crow' ? 'A' : g.kind === 'pigeon' ? (r() < 0.3 ? 'B' : 'A') : (r() < 0.5 ? 'A' : 'B');
        const b = bird(g.kind, at, stream(r()), plumage, flock);
        b.ground = 'perch'; b.perch = p; b.heading = at.heading;
        flock.members.push(b);
        list.push(b);
      }
    }
  }
  function populateCell(cx, cz) {
    const r = stream(hash(cx * 37.1, cz * 53.7, 77));
    const list = [];
    for (const g of residents(cx, cz, r)) {
      if (birds.length + g.n > MAX) break;
      const x = (cx + 0.2 + r() * 0.6) * CELL, z = (cz + 0.2 + r() * 0.6) * CELL;
      const flock = { x, z, ground: g.ground, kind: g.kind, members: [], r: g.kind === 'pigeon' ? 4 : g.kind === 'sparrow' ? 2.5 : g.kind === 'crow' ? 10 : 7 };
      const home = g.ground === 'lawn' ? lawnNear(r, x, z, 20, 14) : sidewalkNear(r, x, z, 22, 14);
      if (!home) continue;
      flock.x = home.x; flock.z = home.z;
      for (let i = 0; i < g.n; i++) {
        const at = (g.ground === 'lawn' ? lawnNear(r, home.x, home.z, flock.r, 6) : sidewalkNear(r, home.x, home.z, flock.r, 6)) || home;
        const plumage = g.kind === 'crow' ? 'A' : g.kind === 'pigeon' ? (r() < 0.3 ? 'B' : 'A') : (r() < 0.5 ? 'A' : 'B');
        const b = bird(g.kind, at, stream(r()), plumage, flock);
        flock.members.push(b);
        list.push(b);
      }
    }
    perchCell(cx, cz, list, true);
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
  // How much what's about threatens a bird (0 none), the worst in `hit`
  const hit = { t: null, d: 0, closing: 0, walkUp: false };
  function danger(b, threats) {
    let worst = 0;
    hit.t = null; hit.walkUp = false;
    const K = b.K;
    for (const t of threats) {
      const dx = b.x - t.x, dz = b.z - t.z, dist = Math.hypot(dx, dz), d = Math.max(0, dist - t.r);
      if (t.air) {
        // the helicopter low and near sends everything up
        if (t.y - b.y < 45 && d < 45) { const k = 2 + 20 / Math.max(5, d); if (k > worst) { worst = k; hit.t = t; hit.d = d; hit.closing = 0; } }
        continue;
      }
      if (Math.abs(t.y - b.y) > 4 || d > 60) continue;
      let k = 0;
      const closing = dist > 0.01 ? (t.vx * dx + t.vz * dz) / dist : t.speed;
      if (t.foot) {
        // someone on foot: walked right up to, or too close even standing
        if (closing > 0.3 && d < K.foot + closing * 1.2) { k = 1 + closing / Math.max(0.4, d); hit.walkUp = d > K.foot * 0.55; }
        else if (d < K.foot * 0.45) k = 0.8;
      } else if (t.speed > 0.5) {
        // a wheel: where it will pass, and how soon; a car going by in the street is let be
        const v2 = t.vx * t.vx + t.vz * t.vz, tca = (dx * t.vx + dz * t.vz) / v2;
        if (tca > 0 && tca < 2.6) {
          const miss = Math.hypot(dx - t.vx * tca, dz - t.vz * tca) - t.r;
          if (miss < K.miss + (t.player ? 1 : 0)) k = 1.5 + 2 / Math.max(0.3, tca);
        }
        if (!k && d < K.miss * 0.8) k = 1;
        // crows don't let a car stop near them, and wheels on the grass scatter what's on it
        if (!k && b.kind === 'crow' && d < 9) k = 0.7;
        if (!k && t.lawn && b.ground === 'lawn' && d < 30) k = 0.7;
      } else if (d < K.miss * 0.5 || (b.kind === 'crow' && d < 6)) k = 0.8;
      if (k > worst) { worst = k; hit.t = t; hit.d = d; hit.closing = closing; }
    }
    return worst;
  }
  function tooClose(b, threats) {
    for (const t of threats) {
      if (Math.abs(t.y - b.y) > (t.air ? 6 : 2.2)) continue;
      if (Math.hypot(b.x - t.x, b.z - t.z) < t.r + 0.35) return true;
    }
    return false;
  }

  // --- flying: a smooth path through a few points ---------------------------------------------------------------
  const P = (x, y, z) => ({ x, y, z });
  function fly(b, pts, onto, speed) {
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); lens.push(l); total += l; }
    b.flight = { pts, lens, total, s: 0, speed, onto };
    b.mode = 'air'; b.state = 'fly';
    if (onto?.spot) { b.gy = onto.spot.y; }
  }
  // a point along a Catmull-Rom curve through the flight's points, s metres along
  function along(f, s, out) {
    let i = 0;
    while (i < f.lens.length - 1 && s > f.lens[i]) { s -= f.lens[i]; i++; }
    const t = Math.max(0, Math.min(1, s / Math.max(0.01, f.lens[i])));
    const p0 = f.pts[Math.max(0, i - 1)], p1 = f.pts[i], p2 = f.pts[i + 1], p3 = f.pts[Math.min(f.pts.length - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    for (const k of ['x', 'y', 'z']) {
      out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    return out;
  }

  // Away from what's coming: each kind its own way
  function flush(b, from, now) {
    const r = b.r, K = b.K;
    if (b.ground === 'perch') { b.ground = b.flock.ground; b.perch = null; }
    let ax = Math.sin(b.heading), az = Math.cos(b.heading);
    if (from) { ax = b.x - from.x; az = b.z - from.z; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    const side = r() < 0.5 ? 1 : -1;
    if (b.kind === 'pigeon') {
      // the whole flock up together, round in a wide circle and down again near where they were
      const f = b.flock;
      if (f.flight && now - f.flight.at < 1.5) return follow(b, f.flight);
      const R = 16 + r() * 12, alt = 7 + r() * 8, cx = f.x + ax * (R * 0.7), cz = f.z + az * (R * 0.7);
      const land = sidewalkNear(r, f.x + ax * 14 + (r() - 0.5) * 20, f.z + az * 14 + (r() - 0.5) * 20, 18, 14)
        || sidewalkNear(r, f.x, f.z, 30, 14);
      f.flight = { at: now, R, alt, cx, cz, dir: side, land, gy: groundHeight(cx, cz) };
      if (land) { f.x = land.x; f.z = land.z; }
      sound('wingbeat', b, 1.2);
      return follow(b, f.flight);
    }
    if (b.kind === 'sparrow' && treesNear) {
      // up into the nearest tree that isn't toward what's coming, quiet there till it's gone
      const trees = treesNear(b.x, b.z, 22, scratch);
      let best = null, bs = Infinity;
      for (const t of trees) {
        const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz) + 0.1;
        if (from && (dx * (from.x - b.x) + dz * (from.z - b.z)) / d > Math.hypot(from.x - b.x, from.z - b.z) * 0.6) continue;
        if (d < bs) { bs = d; best = t; }
      }
      if (best) {
        const top = (best.g ?? groundHeight(best.x, best.z)) + Math.max(2.5, (best.height || 6) * (0.55 + r() * 0.2));
        const a = r() * Math.PI * 2, ox = Math.sin(a) * 0.8, oz = Math.cos(a) * 0.8;
        fly(b, [P(b.x, b.y, b.z), P(b.x + ax * 1.2, b.y + 0.9, b.z + az * 1.2), P(best.x + ox * 1.6, top - 0.6, best.z + oz * 1.6), P(best.x + ox, top, best.z + oz)], { tree: true }, K.fly);
        if (r() < 0.6) sound('chirp', b, 1);
        return;
      }
    }
    // a flight off to other ground: robins low and short, crows higher and well away, cawing
    const far = b.kind === 'crow' ? 35 + r() * 45 : b.kind === 'robin' ? 12 + r() * 14 : 8 + r() * 10;
    let spot = null;
    for (let i = 0; i < 5 && !spot; i++) {
      const a = Math.atan2(ax, az) + (r() - 0.5) * (1 + i * 0.4);
      spot = spotNear(b, r, b.x + Math.sin(a) * far, b.z + Math.cos(a) * far, 10, 5);
    }
    if (!spot) { b.mode = 'gone'; return; }
    const top = b.kind === 'crow' ? 6 + r() * 6 : b.kind === 'robin' ? 1.2 + r() * 1 : 1 + r() * 1.5;
    const mx = (b.x + spot.x) / 2 + az * side * far * 0.15, mz = (b.z + spot.z) / 2 - ax * side * far * 0.15;
    fly(b, [P(b.x, b.y, b.z), P(b.x + ax * 1.5, b.y + Math.min(1.2, top * 0.5), b.z + az * 1.5), P(mx, Math.max(b.y, spot.y) + top, mz),
      P(spot.x - (spot.x - mx) * 0.15, spot.y + 0.4, spot.z - (spot.z - mz) * 0.15), P(spot.x, spot.y, spot.z)], { spot }, K.fly);
    b.flock.x += (spot.x - b.flock.x) * 0.5; b.flock.z += (spot.z - b.flock.z) * 0.5;
    if (b.kind === 'crow') sound('caw', b, 1);
    else if (b.kind === 'robin') sound('chirp', b, 0.5);
    else sound('chirp', b, 1);
    sound('wingbeat', b, b.kind === 'crow' ? 0.8 : 0.35);
  }
  // a pigeon's place in its flock's circle
  function follow(b, F) {
    const r = b.r, spread = 2.5;
    const jx = (r() - 0.5) * spread, jz = (r() - 0.5) * spread, jy = (r() - 0.5) * 2;
    const pts = [P(b.x, b.y, b.z)];
    const a0 = Math.atan2(b.x - F.cx, b.z - F.cz);
    pts.push(P(b.x + (b.x - F.cx) * 0.05, b.y + 2, b.z + (b.z - F.cz) * 0.05));
    const turns = 1 + Math.floor(r() * 2) * 0.5;
    for (let i = 1; i <= 8 * turns; i++) {
      const a = a0 + F.dir * i * Math.PI / 4;
      pts.push(P(F.cx + Math.sin(a) * F.R + jx, F.gy + F.alt + jy + Math.sin(i * 0.9) * 1.5, F.cz + Math.cos(a) * F.R + jz));
    }
    if (F.land) {
      const s = sidewalkNear(r, F.land.x, F.land.z, 3.5, 6) || F.land;
      pts.push(P(s.x + (r() - 0.5) * 4, s.y + 3, s.z + (r() - 0.5) * 4), P(s.x, s.y + 0.4, s.z), P(s.x, s.y, s.z));
      fly(b, pts, { spot: s }, b.K.fly * (0.92 + r() * 0.16));
    } else fly(b, pts, { away: true }, b.K.fly);
  }
  // at nightfall, or nowhere left to land: up and away out of sight
  function leave(b) {
    const r = b.r, a = r() * Math.PI * 2;
    fly(b, [P(b.x, b.y, b.z), P(b.x + Math.sin(a) * 3, b.y + 3, b.z + Math.cos(a) * 3), P(b.x + Math.sin(a) * 40, b.y + 25, b.z + Math.cos(a) * 40), P(b.x + Math.sin(a) * 90, b.y + 45, b.z + Math.cos(a) * 90)], { away: true }, b.K.fly);
  }

  // --- each bird's mind -----------------------------------------------------------------------------------------
  function think(b, dt, now, threats, still) {
    if (b.mode === 'gone') return;
    if (b.mode === 'air') return;
    if (tooClose(b, threats)) { b.mode = 'gone'; return; }
    const K = b.K, r = b.r, w = b.want;
    b.timer -= dt;

    if (b.mode === 'tree') {
      // hidden in the leaves; back down once it's quiet for a while
      if (danger(b, threats) > 0) b.timer = Math.max(b.timer, 4);
      if (b.timer <= 0 && !night()) {
        const spot = spotNear(b, r, b.flock.x, b.flock.z, b.flock.r + 2, 6);
        if (spot) {
          b.visible = true;
          fly(b, [P(b.x, b.y, b.z), P((b.x + spot.x) / 2, Math.max(spot.y + 1, b.y - 1), (b.z + spot.z) / 2), P(spot.x, spot.y + 0.3, spot.z), P(spot.x, spot.y, spot.z)], { spot }, K.fly * 0.8);
          if (r() < 0.5) sound('chirp', b, 1);
        } else b.timer = 5;
      }
      return;
    }
    if (night()) { if (!b.leaving) { b.leaving = true; b.timer = r() * 6; } if (b.timer <= 0) leave(b); return; }

    const threat = danger(b, threats);
    const t = hit.t;
    if (threat > 0 && t) {
      // pigeons and crows walk off from someone strolling up and only go when they come on; the rest are up and gone
      if (hit.walkUp && (b.kind === 'pigeon' || b.kind === 'crow') && hit.closing < 1.6) {
        b.state = 'shuffle'; b.timer = 1.2;
        b.heading += wrap(Math.atan2(b.x - t.x, b.z - t.z) + (b.seed > 5 ? 0.5 : -0.5) - b.heading) * Math.min(1, dt * 5);
      } else { flush(b, t, now); return; }
    }

    if (b.ground === 'perch') {
      // sitting up there: looking about, preening, a call now and then; a pole knocked over sends them off
      if (b.perch?.of?.down) { flush(b, null, now); return; }
      b.speed = 0; w.graze = 0;
      if (b.timer <= 0) {
        const c = r();
        if (c < 0.5) { b.state = 'look'; b.timer = 1.5 + r() * 4; }
        else if (c < 0.78) { b.state = 'preen'; b.timer = 2 + r() * 5; }
        else if (c < 0.9) {
          b.state = 'look'; b.timer = 1.5 + r() * 2;
          if (now - b.calledAt > 6) { b.calledAt = now; sound(b.kind === 'crow' ? 'caw' : b.kind === 'pigeon' ? 'coo' : 'chirp', b, 0.8); }
        } else { b.state = 'look'; b.timer = 1 + r() * 2; b.heading = wrap(b.heading + (r() - 0.5) * 1.2); }
      }
      w.alert = b.state === 'look' ? 1 : 0;
      w.tuck = b.state === 'preen' ? 1 : 0;
      return;
    }
    if (b.state === 'shuffle') {
      w.alert = 0.6; w.graze = 0;
      b.speed = K.walk * (b.kind === 'crow' ? 2.4 : 2.2);
      if (b.timer <= 0) { b.state = 'look'; b.timer = 1; }
      return;
    }

    if (b.timer <= 0) {
      const c = r();
      if (b.kind === 'pigeon') {
        // a still person draws them over, hoping for crumbs
        if (still && still.d < 14 && still.d > 1.6 && c < 0.55) { b.state = 'walk'; b.timer = 2 + r() * 2; b.tx = still.x + (r() - 0.5) * 2; b.tz = still.z + (r() - 0.5) * 2; }
        else if (c < 0.5) { b.state = 'peck'; b.timer = 1.5 + r() * 3; }
        else if (c < 0.62) { b.state = 'coo'; b.timer = 1.6 + r(); if (now - b.calledAt > 5) { b.calledAt = now; sound('coo', b, 1); } }
        else if (c < 0.75) { b.state = 'look'; b.timer = 1 + r() * 2; }
        else { b.state = 'walk'; b.timer = 2 + r() * 4; pickTarget(b); }
      } else if (b.kind === 'sparrow') {
        if (c < 0.5) { b.state = 'peck'; b.timer = 0.8 + r() * 1.8; }
        else if (c < 0.62) { b.state = 'look'; b.timer = 0.5 + r() * 1.2; if (r() < 0.5 && now - b.calledAt > 2) { b.calledAt = now; sound('chirp', b, 1); } }
        else { b.state = 'walk'; b.timer = 0.6 + r() * 1.4; pickTarget(b); }
      } else if (b.kind === 'robin') {
        // run, stop, stand up and cock the head; now and then a tug at the grass
        if (b.state === 'walk') { b.state = 'stop'; b.timer = 1 + r() * 2.2; b.cock = r() < 0.5 ? 1 : -1; }
        else if (b.state === 'stop' && c < 0.35) { b.state = 'peck'; b.timer = 0.7 + r() * 0.8; }
        else { b.state = 'walk'; b.timer = 0.4 + r() * 0.9; pickTarget(b, 3); if (r() < 0.08) sound('chirp', b, 0.5); }
      } else {
        if (c < 0.42) { b.state = 'peck'; b.timer = 1.5 + r() * 3; }
        else if (c < 0.6) { b.state = 'look'; b.timer = 1.5 + r() * 2.5; if (r() < 0.35 && now - b.calledAt > 8) { b.calledAt = now; sound('caw', b, 1); } }
        else { b.state = 'walk'; b.timer = 2 + r() * 3; pickTarget(b); }
      }
    }

    w.alert = b.state === 'look' || b.state === 'stop' || b.state === 'coo' ? 1 : 0;
    w.tuck = 0;
    // pecking: the head down and up in quick dips (a robin's slower, a long tug)
    if (b.state === 'peck') {
      const rate = b.kind === 'sparrow' ? 4.5 : b.kind === 'pigeon' ? 2.6 : b.kind === 'robin' ? 1.2 : 1.6;
      w.graze = Math.sin(now * rate * Math.PI * 2 + b.seed) > -0.2 ? 1 : 0.25;
    } else w.graze = 0;
    if (b.state === 'walk') {
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);
      b.heading += wrap(Math.atan2(dx, dz) - b.heading) * Math.min(1, dt * (b.kind === 'sparrow' ? 10 : 4));
      b.speed = d > 0.3 ? K.walk : 0;
      if (d <= 0.3 && b.kind !== 'robin') { b.state = 'look'; b.timer = 0.5 + r(); }
    } else if (b.state === 'peck' && b.kind === 'pigeon') b.speed = K.walk * 0.35 * (Math.sin(now * 0.9 + b.seed) > 0.3 ? 1 : 0);
    else b.speed = 0;
  }
  function pickTarget(b, rad) {
    const r = b.r, f = b.flock, R = rad ?? f.r;
    // stay with the flock: round its middle, or a short way on from where it is
    const cx = Math.hypot(b.x - f.x, b.z - f.z) > f.r ? f.x : b.x, cz = Math.hypot(b.x - f.x, b.z - f.z) > f.r ? f.z : b.z;
    const a = r() * Math.PI * 2, d = 0.5 + r() * R;
    b.tx = cx + Math.sin(a) * d; b.tz = cz + Math.cos(a) * d;
  }

  // --- moving -----------------------------------------------------------------------------------------------------
  const _m = new THREE.Matrix4(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _x = new THREE.Vector3();
  const _tq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _a = { x: 0, y: 0, z: 0 }, scratch = [];
  function move(b, dt, now) {
    if (b.mode === 'gone' || b.mode === 'tree') return;
    const w = b.want, p = b.p;
    const ease = (v, to, k) => v + (to - v) * Math.min(1, dt * k);
    if (b.mode === 'air') {
      const f = b.flight;
      const left = f.total - f.s;
      // slower to land, beating hard to get up
      const sp = f.speed * (f.onto.away ? 1 : Math.max(0.35, Math.min(1, left / 5))) * Math.min(1, 0.45 + f.s / 3);
      f.s = Math.min(f.total, f.s + sp * dt);
      const px = b.x, py = b.y, pz = b.z;
      along(f, f.s, _a);
      b.x = _a.x; b.y = _a.y; b.z = _a.z;
      const hs = Math.hypot(b.x - px, b.z - pz);
      if (hs > 1e-4) {
        const h = Math.atan2(b.x - px, b.z - pz), turn = wrap(h - b.heading);
        b.heading = h;
        b.roll = ease(b.roll, Math.max(-0.7, Math.min(0.7, -turn / Math.max(dt, 1e-3) * 0.25)), 4);
      }
      b.pitch = Math.atan2(b.y - py, Math.max(hs, 1e-3)) * 0.5;
      const landing = !f.onto.away && left < 3;
      w.fold = 0; w.alert = 0; w.graze = 0; w.tuck = 0;
      // pigeons glide on held-up wings in the turns; small birds flap in bursts and close their wings between
      const burst = b.kind === 'sparrow' || b.kind === 'robin' ? (Math.sin(now * 5 + b.seed) > -0.4 ? 1 : 0) : 1;
      const gliding = b.kind === 'pigeon' && f.s > 6 && Math.sin(now * 0.9 + b.seed) > 0.55;
      w.beat = landing ? 0.6 : gliding ? 0 : f.s < 4 ? 1 : 0.8 * burst;
      w.glide = landing || gliding ? 1 : 0;
      w.fold = burst || landing || f.s < 4 ? 0 : 0.6;
      w.legsUp = landing ? 0 : 1;
      if (f.s >= f.total) {
        b.flight = null; b.pitch = 0; b.roll = 0;
        if (f.onto.away) { b.mode = 'gone'; return; }
        if (f.onto.tree) { b.mode = 'tree'; b.timer = 8 + b.r() * 14; return; }
        b.mode = 'ground'; b.state = 'look'; b.timer = 0.8 + b.r() * 2;
        b.gy = f.onto.spot.y; b.y = b.gy;
        w.fold = 1; w.beat = 0; w.glide = 0; w.legsUp = 0;
      }
    } else {
      w.fold = 1; w.beat = 0; w.glide = 0; w.legsUp = 0;
      b.hop = 0;
      if (b.speed > 0) {
        // sparrows (and robins at a run) go in hops; the rest walk
        let sp = b.speed;
        if (b.kind === 'sparrow') { const ph = (now * 3.2 + b.seed) % 1; sp *= ph < 0.45 ? 2.2 : 0; b.hop = ph < 0.45 ? Math.sin(ph / 0.45 * Math.PI) * 0.025 : 0; }
        const nx = b.x + Math.sin(b.heading) * sp * dt, nz = b.z + Math.cos(b.heading) * sp * dt;
        // keep to their ground: turn back where the next step leaves it
        const ok = clear(nx, nz, 0.3) && (b.ground === 'lawn' || blockAt(nx, nz)) && Math.abs(groundHeight(nx, nz) - groundHeight(b.x, b.z)) < 0.12;
        if (ok) { b.x = nx; b.z = nz; } else { b.heading = wrap(b.heading + Math.PI * (0.6 + b.r() * 0.6)); b.tx = b.flock.x; b.tz = b.flock.z; b.speed = 0; }
        b.gy = groundHeight(b.x, b.z) + (b.ground === 'lawn' ? (blockAt(b.x, b.z) ? LIFT.lawn : 0) : LIFT.slab);
      }
      b.y = b.gy + b.hop;
      b.pitch = 0; b.roll = 0;
    }
    // the pose
    for (const k of ['graze', 'alert', 'tuck', 'legsUp']) p[k] = ease(p[k], w[k], k === 'graze' ? (b.kind === 'sparrow' ? 16 : 9) : 6);
    p.fold = ease(p.fold, w.fold, b.mode === 'air' ? 10 : 4);
    p.beat = ease(p.beat, w.beat, 8); p.glide = ease(p.glide, w.glide, 4);
    p.flap = (p.flap + dt * b.K.flap * (p.beat > 0.02 ? 1 : 0)) % 1;
    const walking = b.mode === 'ground' && b.kind !== 'sparrow' ? Math.min(1, b.speed / Math.max(0.1, b.K.walk)) : 0;
    p.walk = ease(p.walk, walking, 8);
    // a pigeon's nodding walk is quick short steps; a robin's run quicker still
    p.step = (p.step + dt * b.speed * (b.kind === 'pigeon' ? 7 : b.kind === 'robin' ? 9 : 4.5)) % 1;
    p.time = now;
    p.yaw = ease(p.yaw, b.state === 'stop' ? 0.9 * (b.cock || 1) : b.state === 'look' || b.state === 'coo' ? Math.sin(now * (b.kind === 'sparrow' ? 3 : 0.9) + b.seed) * 0.8 : 0, b.kind === 'sparrow' ? 12 : 5);

    _f.set(Math.sin(b.heading) * Math.cos(b.pitch), Math.sin(b.pitch), Math.cos(b.heading) * Math.cos(b.pitch));
    _u.set(0, 1, 0);
    _x.crossVectors(_u, _f).normalize();
    _u.crossVectors(_f, _x);
    _m.makeBasis(_x, _u, _f);
    _tq.setFromRotationMatrix(_m);
    if (b.roll) _tq.multiply(_rq.setFromAxisAngle(_s.set(0, 0, 1), b.roll));
    if (b.fresh) { b.q.copy(_tq); b.fresh = false; } else b.q.slerp(_tq, Math.min(1, dt * (b.mode === 'air' ? 10 : 8)));
  }

  // --- drawing ----------------------------------------------------------------------------------------------------
  function draw(b, near) {
    const kit = kits[b.kind];
    if (near) {
      const had = !!b.body;
      takeBody(b);
      if (!b.skip || !had) kit.pose(b.body, b.p);
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

  const order = [], given = { pigeon: 0, sparrow: 0, robin: 0, crow: 0 };
  const still = { x: 0, z: 0, d: 0 };
  let checkedAt = -10, lastLog = 0, reported = false, tick = 0;
  function update(dt, now, ctx, threats, player) {
    tick++;
    cue = ctx.cue || null;
    look = ctx.look || 'midday';
    gatherSolids(now, ctx.colliders);
    const cp = ctx.camera.position;
    if (now - checkedAt > 1.3 && solidsLength >= 0) {
      checkedAt = now;
      for (const [key, list] of cells) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.hypot((cx + 0.5) * CELL - cp.x, (cz + 0.5) * CELL - cp.z) > RELEASE) { dropAll(list); cells.delete(key); }
        else if (!night() && (perches.get(key)?.length || 0) > list.perched) perchCell(cx, cz, list, false);
      }
      // none come out at night; by day the cells in reach have their birds
      if (!night()) {
        const c0 = Math.floor((cp.x - POPULATE) / CELL), c1 = Math.floor((cp.x + POPULATE) / CELL);
        const d0 = Math.floor((cp.z - POPULATE) / CELL), d1 = Math.floor((cp.z + POPULATE) / CELL);
        for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
          const key = `${i},${j}`;
          if (cells.has(key) || Math.hypot((i + 0.5) * CELL - cp.x, (j + 0.5) * CELL - cp.z) > POPULATE) continue;
          // never come into being right under the view
          if (Math.hypot((i + 0.5) * CELL - cp.x, (j + 0.5) * CELL - cp.z) < CELL * 0.5 && now > 5) continue;
          cells.set(key, populateCell(i, j));
        }
      }
    }
    // someone standing still on foot
    const pl = player?.has && player.still > 3 ? player : null;
    order.length = 0;
    for (const b of birds) {
      let s = null;
      if (pl && b.kind === 'pigeon') { still.x = pl.x; still.z = pl.z; still.d = Math.hypot(pl.x - b.x, pl.z - b.z); s = still; }
      b.lag = (b.lag || 0) + dt;
      b.skip = HALVED && b.mode !== 'air' && !b.fresh && ((tick + Math.floor(b.seed * 10)) & 1) === 1;
      if (!b.skip) {
        think(b, b.lag, now, threats, s);
        move(b, b.lag, now);
        b.lag = 0;
      }
      if (b.mode === 'gone' || b.mode === 'tree') { dropBody(b); continue; }
      b.d2 = ((b.x - cp.x) ** 2 + (b.y - cp.y) ** 2 + (b.z - cp.z) ** 2) * (b.mode === 'air' ? 0.5 : 1);
      order.push(b);
    }
    for (const k of Object.values(kits)) for (const m of Object.values(k.far)) m.count = 0;
    order.sort((a, b) => a.d2 - b.d2);
    for (const k in given) given[k] = 0;
    for (const b of order) {
      b.near = b.d2 < NEAR_DIST * NEAR_DIST && given[b.kind] < NEAR[b.kind];
      if (b.near) given[b.kind]++;
      else dropBody(b);
    }
    for (const b of order) draw(b, b.near);
    for (const k of Object.values(kits)) for (const m of Object.values(k.far)) m.instanceMatrix.needsUpdate = m.count > 0;

    if (!reported) {
      reported = true;
      const t = Object.entries(kits).map(([k, v]) => `${k} ${v.stats.triangles}/${v.stats.farTriangles}`).join(', ');
      log(`[animals] town birds: ${t} triangles near/far`);
    }
    if (now - lastLog > 30 && birds.length) {
      lastLog = now;
      const n = (k) => birds.filter((b) => b.kind === k && b.mode !== 'gone').length;
      log(`[animals] ${n('pigeon')} pigeons, ${n('sparrow')} sparrows, ${n('robin')} robins, ${n('crow')} crows about (${birds.filter((b) => b.mode === 'air').length} flying, ${Object.values(inUse).reduce((a, b) => a + b, 0)} close up)`);
    }
    // the gone are let go
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i];
      if (b.mode !== 'gone') continue;
      dropBody(b);
      birds.splice(i, 1);
      const m = b.flock.members, k = m.indexOf(b);
      if (k >= 0) m.splice(k, 1);
    }
  }

  return {
    update,
    birds,
    get count() { return birds.length; },
    dispose() { for (const k of Object.values(kits)) k.dispose(); }
  };
}

export { createCityBirds };
