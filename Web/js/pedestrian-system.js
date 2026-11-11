import * as THREE from 'three/webgpu';
import { TIER, XBOX } from './device-tier.js';
import { blockAt, districtAt, LANDMARKS } from './city-config.js';
import { GEO } from './city-geodata.js';
import { createPedestrianRoutes } from './pedestrian-routes.js';
import { PersonCrowd, PersonRig, PEDESTRIAN_DIVE_DURATION, PERSON_STYLE } from './pedestrians.js';
import { groundHeight } from './terrain.js';
import { LIFE, patiosOpen, mild } from './street-life.js';
import { createUmbrellas, createDogs } from './crowd-props.js';

// Local pedestrian population: connected walks, curb queues, conversations and player avoidance.
// Traffic supplies crossing permissions and view checks; this system owns the crowd and its animation.
const NUM_PEDS = Math.round(520 * TIER.people); // the pool (fewer on a phone, device-tier.js); how many are out at once follows the place, the hour and the frame rate
// The phone's and the Xbox's few people are kept nearer (within 180 m, placed 50-160 m off) than the Mac's 520 (320 m,
// placed 60-280 m off), so the same small pool stands about three times as thick on the streets the player can see
const LEAN = TIER.name === 'phone';
const PED_RADIUS = LEAN ? 180 : 320;
const NEAR_RADIUS = LEAN ? 200 : 350;
const PLACE_MIN = LEAN ? 50 : 60, PLACE_MAX = LEAN ? 160 : 280;
const PED_SPAWN_DISTANCE = 150;
const PED_AVOID_INTERVAL = 0.12;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// How busy each street's sidewalks are: Main, State, South & North University and the Diag the most; downtown and
// campus side streets less; the neighborhoods hardly at all
const PLACE_CROWD = { downtown: 0.5, state_street: 0.8, central_campus: 0.7, kerrytown: 0.45, medical_campus: 0.3,
  north_campus: 0.3, athletic_campus: 0.16, lower_town: 0.1, old_west_side: 0.09, water_hill: 0.07, burns_park: 0.08, geddes: 0.07 };
const CORE = new Set(['downtown', 'state_street', 'central_campus', 'kerrytown']);
const STREET_CROWD = [
  [/\b(Main|State)\b/, 1],
  [/\b(South|North|East) University\b/, 1],
  [/\b(Liberty|Washington|Maynard|William|Thayer|Fletcher|Church|Forest|Fourth Ave|Detroit)\b/, 0.8],
  [/\b(Fifth|Ashley|Division|Huron|Ann|Catherine|Kingsley)\b/, 0.6]
];
const DIAG = LANDMARKS.find((l) => l.id === 'diag') || { x: 900, z: 200 };
// Lamp: and how that goes by the hour, the weekday and U-M's term (town-clock.js crowdShares, set through setBusy):
// campus, downtown and the homes each by their own share, scaling the place's weight
const CAMPUS = new Set(['state_street', 'central_campus', 'north_campus', 'medical_campus', 'athletic_campus']);
const DOWNTOWN = new Set(['downtown', 'kerrytown']);
const share = { campus: 1, downtown: 1, homes: 1 };
const edgeCrowd = (e) => placeCrowd(e) * share[e.crowdPart];
function placeCrowd(e) {
  if (e.crowd !== undefined) return e.crowd;
  const mx = (e.from.x + e.to.x) * 0.5, mz = (e.from.z + e.to.z) * 0.5;
  const district = districtAt(mx, mz);
  e.crowdPart = CAMPUS.has(district) ? 'campus' : DOWNTOWN.has(district) ? 'downtown' : 'homes';
  let w = PLACE_CROWD[district] ?? 0.05;
  if (CORE.has(district) && e.street) {
    for (const [re, v] of STREET_CROWD) if (re.test(e.street)) { w = Math.max(w, v); break; }
  }
  const diag = Math.hypot(mx - DIAG.x, mz - DIAG.z);
  if (diag < 260) w = Math.max(w, 1 - (diag / 260) * 0.35);
  return (e.crowd = w);
}

// Lamp: the walks through the parks, the woods and the campus lawns (pedestrian-routes.js trailsNear: GEO.trails as
// walk-only tracks). The Diag's and the campus walks are as busy as the streets round them; a park's paths a little
// less, the dirt ones in the woods less again. By the hour (park hours are 6 a.m. to 10 p.m.: a few out before and
// after) and the weather (rain and snow empty the parks before the streets)
const CORE_CAMPUS = new Set(['central_campus', 'state_street']);
const NEAR_CAMPUS = new Set(['north_campus', 'medical_campus', 'athletic_campus']);
const NEIGHBORHOOD = new Set(['old_west_side', 'water_hill', 'burns_park', 'geddes', 'lower_town', 'neighborhood']);
function trailBase(t) {
  if (t.crowd !== undefined) return t.crowd;
  const mx = t.ax + t.ux * t.len * 0.5, mz = t.az + t.uz * t.len * 0.5;
  const diag = Math.hypot(mx - DIAG.x, mz - DIAG.z);
  const b = blockAt(mx, mz), district = districtAt(mx, mz);
  t.park = !b || b.park > 0.6;
  let w = t.park ? 0.4 : Math.max(0.1, (PLACE_CROWD[district] ?? 0.05) * 0.8);
  if (diag < 260) { w = Math.max(w, 1 - (diag / 260) * 0.35); t.park = false; }
  if (t.kind === 1) w *= 0.55;
  return (t.crowd = w);
}
function parkHour(h) {
  if (h < 5.5 || h >= 22.5) return 0.03;
  if (h < 6.5) return 0.4;
  if (h < 9) return 0.9; // the morning runners and dog walkers
  if (h < 16) return 0.65;
  if (h < 20.5) return 1; // after work
  return 0.4;
}
function trailCrowd(t) {
  const w = trailBase(t);
  if (!t.park) return w;
  const weather = LIFE.snow ? 0.4 : LIFE.rain ? 0.45 : LIFE.tempF != null && LIFE.tempF < 25 ? 0.6 : 1;
  return w * parkHour(LIFE.hour) * weather;
}
// (what's laid on the ground there: a curbed block's sidewalk height, else the ground's own)
const floorAt = (x, z) => {
  const b = blockAt(x, z);
  return groundHeight(x, z) + (b && !(b.park > 0.6 && !b.median) ? 0.22 : 0.03);
};

// Lamp: the places to sit (seats.js, from main.js once they're gathered): diners at the patio tables in season, open
// hours and mild dry weather, busiest at lunch and dinner; sitters on the park benches by day when it's dry. Seated
// people are cheap: posed once (PersonRig.perch, as the player sits) and drawn through the crowd's LODs.
let SIT_SPOTS = null;
function setSitSpots(spots) { SIT_SPOTS = spots; }
function mealHour(h) {
  if (h >= 11.5 && h < 14) return 1;
  if (h >= 17 && h < 21.5) return 1;
  if (h >= 7 && h < 11.5) return 0.35; // coffee
  if (h >= 14 && h < 17) return 0.45;
  return 0.25;
}
const SIT_POSE = (hipY) => ({ hip: [0, hipY, -0.04], shoulder: [0, hipY + 0.52, -0.1], hand: [0.16, hipY + 0.13, 0.3],
  foot: [0.13, 0.07, Math.min(0.5, 0.2 + hipY * 0.62)], standing: false });

function createPedestrianSystem(network, { player, player2 = null, nearEdges, nearSignals, mayCross, walkOn, visible, nearView }) {
  let clock = 0;
  let focusX = 0, focusZ = 140;
  let hasView = false;
  let pedRange = 0;
  let strikes2 = false; // player 2 (split screen) in their car or on the bike, on the ground: knocks people down too
  let pedCursor = 0;
  // How many are out: the share of busy sidewalks around (crowdShare), the hour and weather (busy, from the sky
  // the player picked) and what the frame rate allows (perf), checked every couple of seconds
  let busy = 0.9;
  let crowdShare = 0.5, crowdPeak = 1, crowdCheck = -Infinity;
  let perf = 1, frameAvg = 1 / 60;
  let placedCount = 0;

  for (const n of network.nodes) {
    n.walkers = []; // pedestrians on its crosswalks
    n.curb = []; // pedestrians at or approaching its curbs
  }

  // One instanced draw per level of detail; every pedestrian has a PersonRig that plants its footsteps on the
  // sidewalk (no sliding), with their own build, height, sex, hair, clothes and gait
  const pedCrowd = new PersonCrowd(NUM_PEDS);
  // Lamp: umbrellas in the rain (near people only) and dogs on the leash (none on the Xbox, where animals are left out)
  const UMBRELLA_RANGE = 70, DOG_RANGE = 90;
  const umbrellas = createUmbrellas(Math.max(8, Math.min(160, Math.round(NUM_PEDS * 0.4))));
  const MAX_DOGS = XBOX ? 0 : LEAN ? 4 : 12;
  const dogs = MAX_DOGS ? createDogs(MAX_DOGS) : null;
  const SIT_CAP = Math.min(LEAN ? 40 : 90, Math.round(NUM_PEDS * 0.3));
  const handPos = new THREE.Vector3(), leashHand = new THREE.Vector3();
  const sitRoot = new THREE.Object3D();
  const hash = (i, salt) => {
    const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const peds = [];
  for (let i = 0; i < NUM_PEDS; i++) {
    const female = hash(i, 1) < 0.48;
    const hairRoll = hash(i, 2);
    peds.push({
      placed: false,
      crossesStreets: i % 6 === 0, // some start near crossings; everyone can use them along their route
      x: 0,
      z: 0,
      ax: 0, // track: start, direction, length; position along it and walking direction
      az: 0,
      ux: 0,
      uz: 1,
      len: 1,
      t: 0,
      dir: 1,
      node: null, // the intersection of its crosswalk, which side of it, where along it
      side: 0,
      coord: 0,
      line: 0, // its line over the crosswalk, off the centre line
      waiting: false,
      walkDelay: 0.2 + hash(i, 8) * 1.3,
      walkAt: -1,
      // preferred walking speed; one in fourteen is out for a run (on the park paths more: spawnPed)
      speed: i % 14 === 5 ? 2.9 + hash(i, 3) * 0.6 : 1.22 + (i % 5) * 0.1 + hash(i, 3) * 0.08,
      baseSpeed: 0,
      trail: false, // on a park path (pedestrian-routes.js trailsNear)
      seat: null, // sitting there (seats.js), until sitUntil
      sitUntil: 0,
      posed: false,
      homeless: false, // sat at a seat with no walk near (seatTrack)
      dog: null, // the dog on their leash (crowd-props.js)
      umbrella: hash(i, 13) < 0.7, // puts one up in the rain
      hold: 0,
      v: 0, // current speed, easing up to it and down to stops
      pause: 0,
      route: null,
      nextRoute: null,
      nextLeg: 0,
      goalX: 0,
      goalZ: 0,
      goalTime: 0,
      restTime: 0,
      socialTime: 0,
      conversation: null,
      avoidUntil: 0,
      avoidCheck: 0,
      avoidSpeed: 0,
      avoidT: 0,
      resumeDir: 0,
      dodge: 0,
      dodgeTarget: 0,
      returning: false, // back on their feet after a knock-down, stepping back to their line
      diveStart: -Infinity,
      ragdoll: false, // flung limp by the player's car or bike (PersonRig.startRagdoll), until they get up
      hitAt: -Infinity,
      diveHeading: 0,
      diveT: 0,
      reactCheck: 0,
      shout: -1,
      rig: new PersonRig({
        seed: i * 1.6180339 + 0.13,
        female,
        scale: (female ? 0.91 : 0.97) + hash(i, 4) * 0.1,
        girth: 0.9 + hash(i, 5) * 0.24,
        hair: female ? (hairRoll < 0.68 ? 1 : 0.3 + hairRoll * 0.25) : hairRoll < 0.08 ? 1 : hairRoll * 0.35,
        armSwing: 0.75 + hash(i, 6) * 0.5,
        stride: 0.94 + hash(i, 7) * 0.12
      })
    });
  }

  const KERB = 1.6; // how far along a crosswalk track pedestrians wait to cross (the curb is 2 m along)
  for (const p of peds) p.baseSpeed = p.speed;
  const pedRoutes = createPedestrianRoutes(network, blockAt, GEO.trails);
  const nearTrails = [];
  let trailSum = 0, edgeSum = 0;
  const nearSeats = [], seatScratch = [];
  let sitWanted = 0, sitting = 0, sitCheck = 0;
  const track = { ax: 0, az: 0, ux: 0, uz: 1, len: 1, node: null, side: 0, line: 0, route: null };

  function sidewalkTrack(e) {
    const choices = pedRoutes.along(e);
    if (!choices.length) return false;
    const route = choices[Math.floor(Math.random() * choices.length)];
    Object.assign(track, route, { route });
    return true;
  }

  function trailTrack() {
    if (!nearTrails.length) return false;
    const route = nearTrails[Math.floor(Math.random() * nearTrails.length)];
    if (Math.random() > (trailCrowd(route) / crowdPeak) ** 2) return false;
    Object.assign(track, route, { route });
    return true;
  }

  function crosswalkTrack(n) {
    const choices = pedRoutes.across(n);
    if (!choices.length) return false;
    const route = choices[Math.floor(Math.random() * choices.length)];
    Object.assign(track, route, { route });
    return true;
  }

  // Who is at (or just past) the curbs of each intersection's crosswalks, for whoever comes up behind to queue
  const QUEUE_GAP = 0.62; // m from one person standing in a queue to the next
  const curbNodes = [];
  const curbProgress = (p) => (p.dir > 0 ? p.t : p.len - p.t); // m along its way over (the curb it waits at is KERB)
  function nextCrossingLeg(p) {
    const route = p.nextRoute;
    if (!route) return null;
    for (let i = p.nextLeg; i < route.length; i++) {
      if (route[i].track.node) return route[i];
    }
    return null;
  }
  function atCurb(p) {
    const crossing = p.node ? null : nextCrossingLeg(p);
    const n = p.node || crossing?.track.node;
    if (!n || (p.node && curbProgress(p) > KERB + 0.5) || p._curbNode === n) return;
    if (!n.curb.length) curbNodes.push(n);
    n.curb.push(p);
    p._curbNode = n;
  }
  function gatherCurbs() {
    for (const n of curbNodes) {
      for (let i = 0; i < n.curb.length; i++) n.curb[i]._curbNode = null;
      n.curb.length = 0;
    }
    curbNodes.length = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.placed) atCurb(p);
    }
  }

  // Lamp: dressed for where they are (maize and blue: about three in ten on campus, more on a fall Saturday; casual
  // clothes on campus and in the neighbourhoods, more tailored jackets downtown), paced for it (on a park path one in
  // three running at dawn and after work), and now and then out with the dog (in the neighbourhoods and the parks,
  // mornings and evenings most)
  function dressFor(p, x, z) {
    const district = districtAt(x, z);
    const campus = CORE_CAMPUS.has(district) || Math.hypot(x - DIAG.x, z - DIAG.z) < 400;
    const nearCampus = !campus && NEAR_CAMPUS.has(district), home = NEIGHBORHOOD.has(district);
    const football = LIFE.weekday === 6 && LIFE.month >= 9 && LIFE.month <= 11;
    const mb = (campus ? 0.3 : nearCampus ? 0.2 : 0.1) * (football ? 1.8 : 1);
    const casual = campus ? 0.75 : nearCampus || home || p.trail ? 0.6 : 0.1;
    p.rig.setStyle((Math.random() < mb ? PERSON_STYLE.MAIZE_BLUE : 0) + (Math.random() < casual ? PERSON_STYLE.CASUAL : 0));
    p.speed = p.baseSpeed;
    const h = LIFE.hour;
    if (p.trail && !p.seat && Math.random() < ((h >= 6 && h < 9) || (h >= 16 && h < 19.5) ? 0.35 : 0.15)) p.speed = 2.6 + Math.random() * 0.8;
    if (dogs && !p.seat && p.speed < 2 && dogs.available) {
      const dogHour = (h >= 6.5 && h < 9.5) || (h >= 16.5 && h < 20.5) ? 1 : h >= 9.5 && h < 16.5 ? 0.4 : 0.1;
      const where = p.trail ? (p.route?.chain && trailBase(p.route) && p.route.park ? 0.2 : 0.06) : home ? 0.16 : 0.03;
      if (Math.random() < where * dogHour * (LIFE.rain || LIFE.snow ? 0.5 : 1)) {
        p.dog = dogs.take(Math.random());
        if (p.dog) p.speed = Math.min(p.speed, 1.12 + Math.random() * 0.18);
      }
    }
  }

  // Lamp: sitting down (setSitSpots). Each seat's way back to a walk (the nearest sidewalk or park path within 12 m,
  // its own line along it and how far off it the seat is) is found once: the sitter is placed on it as one stepped
  // aside (dodge), so getting up (standUp, or a knock) is the same step back to their line as after a fall
  const seatScratch2 = [];
  const seatFree = (s) => !s.taken && !s.box?.knock?.down;
  function homeFor(seat) {
    if (seat.home !== undefined) return seat.home;
    let best = null, bestD = 12;
    const consider = (tr) => {
      if (tr.node) return;
      const qx = seat.x - tr.ax, qz = seat.z - tr.az, t = qx * tr.ux + qz * tr.uz;
      if (t < 0.5 || t > tr.len - 0.5) return;
      const off = qx * tr.uz - qz * tr.ux;
      if (Math.abs(off) < bestD) { bestD = Math.abs(off); best = { track: tr, t, off }; }
    };
    for (const e of nearEdges) {
      const mx = e.sx + e.dx * e.len * 0.5, mz = e.sz + e.dz * e.len * 0.5;
      if (Math.hypot(mx - seat.x, mz - seat.z) > e.len * 0.5 + 16) continue;
      for (const tr of pedRoutes.along(e)) consider(tr);
    }
    for (const tr of pedRoutes.trailsNear(seat.x, seat.z, 14, seatScratch2)) if (tr.chain) consider(tr);
    if (!best && !nearEdges.length) return null; // (not known yet: asked again later)
    return (seat.home = best || false); // (false: none, for good)
  }
  // A seat with no walk near enough (a patio out back, a sidewalk its tables leave no walking line along) still seats
  // someone: they stay until no one's looking and then go, and stand where they are if knocked off it
  function seatTrack(seat) {
    return { ax: seat.x, az: seat.z, ux: Math.sin(seat.yaw), uz: Math.cos(seat.yaw), len: 1, node: null, side: 0, line: 0,
      trail: false, edge: null, block: null, before: null, after: null, chain: null };
  }
  function releaseSeat(p) {
    if (p.seat && p.seat.taken === p) p.seat.taken = null;
    p.seat = null;
  }
  function sitDown(p, rMinSq, rMaxSq, protectView) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const seat = nearSeats[Math.floor(Math.random() * nearSeats.length)];
      if (!seatFree(seat)) continue;
      const dx = seat.x - focusX, dz = seat.z - focusZ, d2 = dx * dx + dz * dz;
      if (d2 < rMinSq || d2 > rMaxSq || (protectView && nearView(seat.x, seat.z, 2, PED_SPAWN_DISTANCE))) continue;
      if (player.active && (seat.x - player.x) ** 2 + (seat.z - player.z) ** 2 < 100) continue;
      // company: a chair at a table someone's already at is likelier taken than one at an empty table
      if (seat.y != null && Math.random() < 0.5 && !SIT_SPOTS.within(seat.x, seat.z, 1.6, seatScratch2).some((s) => s !== seat && s.taken)) continue;
      const home = homeFor(seat);
      if (home === null) continue;
      if (p.conversation) endConversation(p.conversation);
      const track = home ? home.track : seatTrack(seat);
      Object.assign(p, track);
      p.route = track;
      p.homeless = !home;
      p.t = home ? home.t : 0;
      p.dir = Math.random() < 0.5 ? 1 : -1;
      p.dodge = p.dodgeTarget = home ? home.off : 0;
      p.x = seat.x; p.z = seat.z;
      p.v = 0; p.pause = 0; p.waiting = false; p.walkAt = -1; p.avoidUntil = 0; p.resumeDir = 0;
      p.returning = false; p.diveStart = -Infinity; p.ragdoll = false; p.rig.ragdolling = false;
      p.nextRoute = null; p.nextLeg = 0; p.goalTime = 0; p._curbNode = null;
      p.restTime = clock + 25 + Math.random() * 45;
      p.socialTime = clock + 5 + Math.random() * 15;
      p.seat = seat; seat.taken = p;
      sitting++; // (counted afresh each frame; this keeps a burst of placing, after a jump, to sitWanted)
      p.sitUntil = clock + 90 + Math.random() * 300;
      p.posed = false;
      p.rig.placed = false;
      p.placed = true;
      dressFor(p, seat.x, seat.z);
      if (p.homeless) p.speed = 0;
      return true;
    }
    return false;
  }
  // gone home (out of range, or too many out): their seat and their dog are free at once, for whoever's placed next
  function goHome(p) {
    if (p.seat) { releaseSeat(p); sitting--; }
    if (p.dog) { dogs.release(p.dog); p.dog = null; }
  }
  function standUp(p) {
    releaseSeat(p);
    p.rig.placed = false;
    p.dodgeTarget = 0;
    p.returning = true;
    p.pause = 0.8;
    p.v = 0;
    p.restTime = Math.max(p.restTime, clock + 20);
  }

  // Try crosswalks first for crossing pedestrians, then fall back to sidewalks if no suitable crossing fits.
  function spawnPed(p, rMin, rMax, protectView) {
    const rMinSq = rMin * rMin, rMaxSq = rMax * rMax, gapSq = QUEUE_GAP * QUEUE_GAP;
    if (p.seat) releaseSeat(p);
    if (p.dog) { dogs.release(p.dog); p.dog = null; }
    if (sitting < sitWanted && nearSeats.length && Math.random() < 0.6 && sitDown(p, rMinSq, rMaxSq, protectView)) return true;
    const trailShare = trailSum / (trailSum + edgeSum || 1);
    for (let attempt = 0; attempt < 10; attempt++) {
      const onTrail = Math.random() < trailShare;
      const crosswalk = !onTrail && p.crossesStreets && nearSignals.length > 0 && attempt < 5;
      const edge = !onTrail && !crosswalk && nearEdges.length > 0 ? nearEdges[Math.floor(Math.random() * nearEdges.length)] : null;
      // busier sidewalks take more of the people out walking (a quiet street still gets the odd one)
      if (edge && Math.random() > (edgeCrowd(edge) / crowdPeak) ** 2) continue;
      const ok = onTrail ? trailTrack() : crosswalk
        ? crosswalkTrack(nearSignals[Math.floor(Math.random() * nearSignals.length)])
        : !!edge && sidewalkTrack(edge);
      if (!ok) continue;
      const along = (focusX - track.ax) * track.ux + (focusZ - track.az) * track.uz;
      const minT = Math.max(0, along - rMax), maxT = Math.min(track.len, along + rMax);
      if (minT > maxT) continue;
      const t = crosswalk ? (Math.random() < 0.5 ? Math.random() * KERB : track.len - Math.random() * KERB) : minT + Math.random() * (maxT - minT);
      const x = track.ax + track.ux * t;
      const z = track.az + track.uz * t;
      const dx = x - focusX, dz = z - focusZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < rMinSq || d2 > rMaxSq || (protectView && nearView(x, z, 2, PED_SPAWN_DISTANCE))) continue;
      if (player.active && (x - player.x) * (x - player.x) + (z - player.z) * (z - player.z) < 100) continue;
      if (crosswalk) {
        let crowded = false;
        const curb = track.node.curb;
        for (let i = 0; i < curb.length; i++) {
          const q = curb[i];
          if ((q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < gapSq) { crowded = true; break; }
        }
        if (crowded) continue;
      }
      if (p.conversation) endConversation(p.conversation);
      Object.assign(p, track);
      p.t = t;
      p.dir = t < track.len * 0.5 ? 1 : -1;
      p.x = x;
      p.z = z;
      p.v = crosswalk ? 0 : p.speed;
      p.pause = 0;
      p.waiting = false;
      p.walkAt = -1;
      p.avoidUntil = 0;
      p.resumeDir = 0;
      p.dodge = p.dodgeTarget = 0;
      p.returning = false;
      p.diveStart = -Infinity;
      p.ragdoll = false;
      p.rig.ragdolling = false;
      p.avoidCheck = clock + Math.random() * PED_AVOID_INTERVAL;
      p.nextRoute = null;
      p.nextLeg = 0;
      p.goalTime = 0;
      p.restTime = clock + 25 + Math.random() * 45;
      p.socialTime = clock + 5 + Math.random() * 15;
      p._curbNode = null;
      p.rig.placed = false; // stands afresh where it now is
      p.placed = true;
      if (crosswalk) atCurb(p);
      p.homeless = false;
      dressFor(p, x, z);
      return true;
    }
    return false;
  }

  // Continue through validated sidewalk corners. Crossing tracks retain their curb queues and right of way;
  // only a dead end needs a turnaround. Goals guide local choices without a city-wide path search.
  const PED_ACCEL = 1.3; // m/s^2 setting off
  const PED_BRAKE = 1.6; // m/s^2 easing to a stop
  const TURN_TIME = 0.85; // s turning round at the end of the track
  const PED_ESCAPE_SPEED = 5;
  const PED_ESCAPE_ACCEL = 9;
  const PED_ESCAPE_BRAKE = 6;
  const PED_LOOKAHEAD = 1.5;
  const PED_DIVE_DISTANCE = 1.9;
  const PED_DODGE_SPEED = PED_DIVE_DISTANCE / 0.5;

  // Limit an escape to the current validated track, respecting curbs and people in either direction.
  // Only threatened pedestrians do this local scan, at most once every 120 ms.
  function escapeRoom(p, dir) {
    let room = dir > 0 ? p.len - p.t : p.t;
    const s = dir > 0 ? p.t : p.len - p.t;
    if (p.node && s <= KERB + 1e-6 && !mayCross(p)) room = Math.min(room, Math.max(0, KERB - s));
    for (const q of peds) {
      if (q === p || !q.placed) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const forward = (dx * p.ux + dz * p.uz) * dir;
      if (forward <= 0 || forward > Math.min(room + QUEUE_GAP, 6)) continue;
      const side = dx * p.uz - dz * p.ux;
      if (Math.abs(side) < QUEUE_GAP) room = Math.min(room, Math.max(0, forward - Math.sqrt(QUEUE_GAP * QUEUE_GAP - side * side)));
    }
    return room;
  }

  // Sweep the pedestrian against the player's oriented footprint. Short linear segments account for braking,
  // acceleration and track ends without missing fast vehicles between samples or allocating temporary vectors.
  function playerContactTime(p, speed, room, emergency = true, dodgeTarget = p.dodgeTarget, diving = false) {
    const dir = speed < 0 ? -1 : speed > 0 ? 1 : p.dir;
    let v = diving ? speed : dir === p.dir ? p.v * p.dir : 0;
    let moved = 0;
    let side = p.dodge;
    const dx = p.x - player.x, dz = p.z - player.z;
    let x = dx * player.fz - dz * player.fx, z = dx * player.fx + dz * player.fz;
    const ux = p.ux * player.fz - p.uz * player.fx, uz = p.ux * player.fx + p.uz * player.fz;
    const vx = player.vx * player.fz - player.vz * player.fx, vz = player.vx * player.fx + player.vz * player.fz;
    const sideways = dodgeTarget !== p.dodge;
    const diveX = Math.abs(sideways ? uz : ux), diveZ = Math.abs(sideways ? ux : uz);
    // A prone pedestrian is longer than a standing one; project that body into the car's frame too.
    const halfW = player.halfW + (diving ? diveX + 0.4 * diveZ : 0.45);
    const halfL = player.halfL + (diving ? diveZ + 0.4 * diveX : 0.45);
    const acceleration = emergency ? PED_ESCAPE_ACCEL : PED_ACCEL;
    const braking = emergency ? PED_ESCAPE_BRAKE : 2 * PED_BRAKE;
    const step = 0.25;
    for (let time = 0; time < PED_LOOKAHEAD; time += step) {
      const rate = Math.abs(speed) > Math.abs(v) ? acceleration : braking;
      const nextV = diving ? speed : v + clamp(speed - v, -rate * step, rate * step);
      const distance = Math.min(room - moved, Math.abs((v + nextV) * 0.5 * step));
      moved += distance;
      const sideStep = clamp(dodgeTarget - side, -(diving || dodgeTarget ? PED_DODGE_SPEED : 1.8) * step, (diving || dodgeTarget ? PED_DODGE_SPEED : 1.8) * step);
      side += sideStep;
      const sx = ux * dir * distance + uz * sideStep - vx * step;
      const sz = uz * dir * distance - ux * sideStep - vz * step;
      let enter = 0, exit = 1;
      for (let axis = 0; axis < 2; axis++) {
        const pos = axis ? z : x, delta = axis ? sz : sx;
        const extent = axis ? halfL : halfW;
        if (Math.abs(delta) < 1e-6) {
          if (Math.abs(pos) > extent) { exit = -1; break; }
        } else {
          const a = (-extent - pos) / delta, b = (extent - pos) / delta;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
      }
      if (enter <= exit) return time + enter * step;
      x += sx; z += sz; v = nextV;
    }
    return Infinity;
  }

  function turnPed(p, dir) {
    p.walkAt = -1;
    p.dir = dir;
    p.v = 0;
    p.nextRoute = null;
    p.nextLeg = 0;
    p.waiting = false;
  }

  function dodgeClear(p, offset, diving = false) {
    // Reserve space for the outstretched body as well as its centre when landing.
    const end = offset + (diving ? Math.sign(offset - p.dodge) * 0.9 : 0);
    if (!pedRoutes.canDodge(p, end)) return false;
    const dx = p.uz * (end - p.dodge), dz = -p.ux * (end - p.dodge);
    const lengthSq = dx * dx + dz * dz;
    for (const q of peds) {
      if (q === p || !q.placed) continue;
      const t = clamp(((q.x - p.x) * dx + (q.z - p.z) * dz) / lengthSq, 0, 1);
      if ((p.x + dx * t - q.x) ** 2 + (p.z + dz * t - q.z) ** 2 < QUEUE_GAP ** 2) return false;
    }
    return true;
  }

  function avoidPlayer(p) {
    // Commit to the landing and get-up; steering or walking during this pose would slide across the ground.
    if (clock - p.diveStart < PEDESTRIAN_DIVE_DURATION) return;
    // Stay off the walking line until the approaching vehicle has passed; returning is swept too. Someone back on their
    // feet after a knock-down walks back to their line whatever lies between (they may have been thrown into the road
    // or across it, where no step aside would be allowed), once no car is coming at them.
    if (p.dodgeTarget && clock >= p.avoidUntil) {
      const safe = !pedRange || playerContactTime(p, 0, 0, true, 0) === Infinity;
      if ((p.returning || !p.dodge || dodgeClear(p, 0)) && safe) p.dodgeTarget = 0;
      else p.avoidUntil = clock + 0.6;
    }
    if (p.returning && !p.dodgeTarget && Math.abs(p.dodge) < 0.01) p.returning = false;
    // A retreat is temporary: once clear, turn back toward the original destination instead of walking into
    // the people behind. Corner transitions below discard this old direction along with the escape boundary.
    if (p.resumeDir && (clock >= p.avoidUntil || !pedRange)) {
      if (p.dir !== p.resumeDir) {
        turnPed(p, p.resumeDir);
        p.pause = TURN_TIME;
      }
      p.resumeDir = 0;
      p.avoidCheck = 0;
    }
    if (!pedRange) { if (!p.dodgeTarget) p.avoidUntil = 0; return; }
    const dx = p.x - player.x, dz = p.z - player.z;
    if (dx * dx + dz * dz > pedRange * pedRange || clock < p.avoidCheck) return;
    p.avoidCheck = clock + PED_AVOID_INTERVAL;
    const ahead = p.dir > 0 ? p.len - p.t : p.t;
    const dodging = p.dodge !== 0 || p.dodgeTarget !== 0;
    const normalSpeed = dodging || p.pause > 0 || p.conversation || p.waiting ? 0 : p.speed;
    const normalRoom = p.node && curbProgress(p) <= KERB + 1e-6 && !mayCross(p) ? Math.max(0, KERB - curbProgress(p)) : ahead;
    const avoiding = clock < p.avoidUntil;
    const escapeAhead = Math.max(0, Math.min(ahead, (p.avoidT - p.t) * p.dir));
    const contact = playerContactTime(p, p.dir * normalSpeed, normalRoom, false);
    if (contact === Infinity
      && (!avoiding || playerContactTime(p, p.dir * p.avoidSpeed, escapeAhead) === Infinity)) return;

    const forward = escapeRoom(p, p.dir);
    const stop = playerContactTime(p, 0, forward);
    const inRoad = p.node && p.t > 2 && p.t < p.len - 2;
    let dir = p.dir, speed = 0, room = forward, best = stop, dodgeTarget = p.dodgeTarget;
    if (!dodging && ((inRoad && player.vx * player.vx + player.vz * player.vz > 1) || stop !== Infinity)) {
      speed = PED_ESCAPE_SPEED;
      best = playerContactTime(p, dir * speed, forward);
      // Corner connectors need their pending route; only full sidewalk/crosswalk tracks can turn around.
      if (p.node || p.route?.edge || p.route?.chain) {
        const back = escapeRoom(p, -dir);
        const retreat = playerContactTime(p, -dir * speed, back);
        if (retreat > best + (avoiding ? 0.2 : 0)
          || (!avoiding && retreat === Infinity && inRoad && ahead > p.len * 0.5)) {
          dir = -dir; room = back; best = retreat;
        }
      }
      if (stop > best) { dir = p.dir; speed = 0; room = forward; best = stop; }
    }
    if (!inRoad && player.vx * player.vx + player.vz * player.vz > 4 && best !== Infinity) {
      for (const offset of [p.dodge - PED_DIVE_DISTANCE, p.dodge + PED_DIVE_DISTANCE]) {
        if (!dodgeClear(p, offset, true)) continue;
        const escape = playerContactTime(p, 0, 0, true, offset, true);
        if (escape > best + 0.1) {
          best = escape; dodgeTarget = offset; dir = p.dir; speed = 0; room = 0;
        }
      }
    }
    const sideDive = Math.abs(dodgeTarget - p.dodgeTarget) > 0.5;
    const diveT = p.t + dir * PED_DIVE_DISTANCE;
    const flatLanding = !p.node || (Math.abs(diveT - 2) > 1 && Math.abs(diveT - (p.len - 2)) > 1);
    // In a crosswalk, dive along the checked escape route when the car is close. Include the prone body in
    // the room check and predict the stop at the landing, rather than assuming they keep running afterwards.
    const forwardDive = !dodging && !sideDive && contact < 1 && speed > 0 && room >= PED_DIVE_DISTANCE + 0.9 && flatLanding
      && player.vx * player.vx + player.vz * player.vz > 4
      && playerContactTime(p, dir * PED_DODGE_SPEED, PED_DIVE_DISTANCE, true, dodgeTarget, true) === Infinity;
    if (sideDive || forwardDive) {
      p.diveStart = clock;
      if (hash(p.rig.seed, 9) < 0.75) p.shout = clock; // a shout as they jump clear
      p.diveT = forwardDive ? diveT : p.t;
      const side = Math.sign(dodgeTarget - p.dodge);
      p.diveHeading = forwardDive ? Math.atan2(p.ux * dir, p.uz * dir) : Math.atan2(p.uz * side, -p.ux * side);
      speed = 0;
    }
    p.dodgeTarget = dodgeTarget;
    if (p.conversation) endConversation(p.conversation);
    if (!p.resumeDir) p.resumeDir = p.dir;
    if (dir !== p.dir) turnPed(p, dir);
    p.pause = 0;
    p.avoidSpeed = speed;
    p.avoidT = p.t + dir * room;
    p.avoidUntil = Math.max(clock + 0.6, p.diveStart + PEDESTRIAN_DIVE_DURATION);
    p.restTime = Math.max(p.restTime, clock + 5);
    p.socialTime = Math.max(p.socialTime, clock + 5);
  }

  // Seeing the player's car: a car up on their sidewalk sends everyone near running and shouting the other way; one
  // passing fast close to the curb makes those nearest it step back toward the buildings
  const PANIC_RANGE = 18;
  function react(p) {
    if (!pedRange || p.node || clock < p.reactCheck || clock - p.diveStart < PEDESTRIAN_DIVE_DURATION) return;
    p.reactCheck = clock + 0.2;
    const dx = p.x - player.x, dz = p.z - player.z;
    const speed2 = player.vx * player.vx + player.vz * player.vz;
    if (speed2 < 4 || dx * dx + dz * dz > PANIC_RANGE * PANIC_RANGE) return;
    const speed = Math.sqrt(speed2);
    const ahead = (dx * player.vx + dz * player.vz) / speed; // how far ahead of the car, along its way
    const across = Math.abs(dx * player.vz - dz * player.vx) / speed;
    if (ahead < -4) return; // it's gone past
    // where the car is across this sidewalk, from the person's walking line
    const side = (player.x - p.x) * p.uz - (player.z - p.z) * p.ux;
    const onSidewalk = Math.abs(side) < 4 && pedRoutes.canDodge(p, p.dodge + side);
    if (onSidewalk && ahead > 0 && across < 7) {
      if (clock < p.avoidUntil && p.avoidSpeed >= PED_ESCAPE_SPEED) return; // already running
      let away = (dx * p.ux + dz * p.uz) >= 0 ? 1 : -1, run = PED_ESCAPE_SPEED;
      // on a corner's connector there's no turning back (its pending route goes on ahead, and turning drops it): they
      // run on along it if that's away from the car, else stop where they are
      if (!(p.route?.edge || p.route?.chain) && away !== p.dir) { away = p.dir; run = 0; }
      if (p.conversation) endConversation(p.conversation);
      if (!p.resumeDir) p.resumeDir = p.dir;
      if (away !== p.dir) turnPed(p, away);
      p.pause = 0;
      p.avoidSpeed = run;
      p.avoidT = p.t + away * (run ? escapeRoom(p, away) : 0);
      p.avoidUntil = clock + 2.5 + hash(p.rig.seed, 10);
      p.restTime = Math.max(p.restTime, clock + 8);
      p.socialTime = Math.max(p.socialTime, clock + 8);
      if (hash(p.rig.seed, 11) < 0.5 && clock - p.shout > 4) p.shout = clock;
    } else if (!onSidewalk && speed > 7 && Math.abs(side) < 4.5 && ahead > -2 && ahead < 14 && !p.dodgeTarget) {
      const back = -Math.sign(side) * 0.75;
      if (!dodgeClear(p, p.dodge + back)) return;
      p.dodgeTarget = p.dodge + back;
      p.avoidUntil = Math.max(p.avoidUntil, clock + 1.4);
    }
  }

  // Lamp: level crossings (railways.js, handed on by traffic.js). A sidewalk alongside a street over the tracks passes
  // each crossing at `t` along it; while its lamps flash, walkers wait at its gate (c.D short of the tracks) and anyone
  // already past the gate walks on over. Worked out once per track, the first time someone walks it.
  let rails = [];
  function railsOf(track) {
    if (track.rails !== undefined) return track.rails;
    let out = null;
    for (const c of rails) {
      const qx = c.x - track.ax, qz = c.z - track.az;
      const t = qx * track.ux + qz * track.uz;
      if (t < -c.D || t > track.len + c.D || Math.abs(qx * track.uz - qz * track.ux) > 13) continue;
      if (Math.abs(track.ux * c.dx + track.uz * c.dz) < 0.7) continue; // (along the tracks, not over them)
      (out || (out = [])).push({ c, t });
    }
    return (track.rails = out);
  }
  function railRoom(p) {
    const list = p.route ? railsOf(p.route) : null;
    if (!list) return Infinity;
    let room = Infinity;
    for (const r of list) {
      if (!r.c.on) continue;
      const d = (r.t - p.t) * p.dir - r.c.D; // to the gate, on this side of the tracks
      if (d > -0.5) room = Math.min(room, Math.max(0, d));
    }
    return room;
  }

  const walkedNodes = [];
  function walk(p, dt) {
    const avoiding = clock < p.avoidUntil;
    const diving = clock - p.diveStart < PEDESTRIAN_DIVE_DURATION;
    const dodging = p.dodge !== 0 || p.dodgeTarget !== 0;
    const brake = avoiding ? PED_ESCAPE_BRAKE : PED_BRAKE;
    if (p.pause > 0) p.pause = Math.max(0, p.pause - dt);
    const ahead = p.dir > 0 ? p.len - p.t : p.t;
    const gdx = p.x - p.goalX, gdz = p.z - p.goalZ;
    if (clock >= p.goalTime || gdx * gdx + gdz * gdz < 625) {
      const destination = nearEdges[Math.floor(Math.random() * nearEdges.length)];
      p.goalX = destination ? destination.sx + destination.dx * destination.len * 0.5 : p.x;
      p.goalZ = destination ? destination.sz + destination.dz * destination.len * 0.5 : p.z;
      p.goalTime = clock + 120 + Math.random() * 180;
    }
    if (!p.nextRoute && p.route && ahead < 4) {
      p.nextRoute = pedRoutes.next(p.route, p.dir, p.goalX, p.goalZ);
      p.nextLeg = 0;
      if (!p.node && p.nextRoute) atCurb(p);
    }
    if (!p.node && (p.route?.edge || p.route?.chain) && p.t > 6 && p.t < p.len - 6 && clock >= p.restTime) {
      p.pause = 1.5 + Math.random() * 3;
      p.restTime = clock + 35 + Math.random() * 55;
    }
    let vMax = avoiding ? p.avoidSpeed : p.pause > 0 || p.conversation ? 0 : p.speed;
    if (dodging || diving) p.v = vMax = 0;
    if (!p.nextRoute) vMax = Math.min(vMax, Math.sqrt(2 * brake * ahead));
    let room = Infinity;
    if (!p.node && p.nextRoute) {
      // A queue can reach back onto the sidewalk. Keep clear before entering its track, including short corner
      // segments; actual separation matters where the approach meets the crossing at an angle.
      const crossing = nextCrossingLeg(p);
      if (crossing) {
        const entranceX = crossing.track.ax + (crossing.dir < 0 ? crossing.track.ux * crossing.track.len : 0);
        const entranceZ = crossing.track.az + (crossing.dir < 0 ? crossing.track.uz * crossing.track.len : 0);
        let leader = null, nearestSq = Infinity;
        for (const q of crossing.track.node.curb) {
          const next = q.node ? null : nextCrossingLeg(q);
          const queued = q.node ? q : next?.track;
          if (!queued || queued.node !== crossing.track.node || queued.side !== crossing.track.side || (q.node ? q.dir : next.dir) !== crossing.dir || Math.abs(queued.line - crossing.track.line) > 0.55) continue;
          const edx = q.x - entranceX, edz = q.z - entranceZ;
          const distSq = edx * edx + edz * edz;
          if (!q.node && distSq < nearestSq) { leader = q; nearestSq = distSq; }
          if (q === p) continue;
          const dx = q.x - p.x, dz = q.z - p.z;
          const forward = (dx * p.ux + dz * p.uz) * p.dir;
          const lateral2 = Math.max(0, dx * dx + dz * dz - forward * forward);
          if (forward >= 0 && lateral2 < QUEUE_GAP * QUEUE_GAP) {
            room = Math.min(room, Math.max(0, forward - Math.sqrt(QUEUE_GAP * QUEUE_GAP - lateral2)));
          }
        }
        if (leader && leader !== p) {
          // The closest arrival merges first. Keep other approaches outside its remaining walking lines,
          // so perpendicular queues cannot trap each other at the entrance after WALK turns green.
          const yieldToLine = (line) => {
            const side = (p.x - line.ax) * line.uz - (p.z - line.az) * line.ux;
            const toward = (p.ux * line.uz - p.uz * line.ux) * p.dir;
            if (side * toward < 0) room = Math.min(room, Math.max(0, (Math.abs(side) - QUEUE_GAP - 0.01) / Math.abs(toward)));
          };
          yieldToLine(leader);
          for (let i = leader.nextLeg; i < leader.nextRoute.length; i++) {
            yieldToLine(leader.nextRoute[i].track);
            if (leader.nextRoute[i].track.node) break;
          }
        }
      }
    }
    let canCross = true;
    if (p.node) {
      // room to walk before standing: up to the curb unless p may cross, and up to the back of whoever is ahead
      const s = curbProgress(p);
      if (s <= KERB + 1e-6) {
        const walk = walkOn(p);
        if (!walk) p.walkAt = -1;
        else if (p.walkAt < 0) p.walkAt = clock + p.walkDelay;
        // React to WALK independently of the queue or vehicles still clearing the crossing.
        canCross = walk && (avoiding || clock >= p.walkAt) && mayCross(p);
      }
      room = s <= KERB + 1e-6 && !canCross ? Math.max(0, KERB - s) : Infinity;
      for (const q of p.node.curb) {
        if (q === p || q.node !== p.node || q.side !== p.side || q.dir !== p.dir || Math.abs(q.line - p.line) > 0.55) continue;
        const gap = curbProgress(q) - s;
        if (gap > 0) room = Math.min(room, Math.max(0, gap - QUEUE_GAP));
      }
    }
    if (!p.node && rails.length) room = Math.min(room, railRoom(p));
    if (avoiding) room = Math.min(room, Math.max(0, (p.avoidT - p.t) * p.dir));
    vMax = Math.min(vMax, Math.sqrt(2 * brake * room));
    p.v += clamp(vMax - p.v, -(avoiding ? brake : 2 * brake) * dt, (avoiding ? PED_ESCAPE_ACCEL : PED_ACCEL) * dt);
    const movement = diving ? Math.min(Math.abs(p.diveT - p.t), PED_DODGE_SPEED * dt) : Math.min(p.v * dt, room);
    if (p.v * dt > room) p.v = 0;
    let t = p.t + p.dir * movement;
    const reachesCurb = !!p.node && curbProgress(p) <= KERB + 1e-6 && (p.dir > 0 ? t : p.len - t) >= KERB - 1e-6;
    p.waiting = !diving && reachesCurb && !canCross;
    if (p.waiting) {
      t = p.dir > 0 ? Math.min(t, KERB) : Math.max(t, p.len - KERB);
      p.v = 0;
    }
    if (!dodging && !diving && (p.dir > 0 ? t >= p.len : t <= 0)) {
      t = p.dir > 0 ? p.len : 0;
      if (p.nextRoute) {
        p.avoidUntil = 0;
        p.resumeDir = 0;
        p.avoidCheck = 0;
        const leg = p.nextRoute[p.nextLeg++];
        Object.assign(p, leg.track);
        p.route = leg.track;
        p.walkAt = -1;
        p.dir = leg.dir;
        t = p.dir > 0 ? 0 : p.len;
        p.t = t;
        if (p.node) atCurb(p); // later arrivals this frame must see the newly occupied entrance
        if (p.nextLeg === p.nextRoute.length) p.nextRoute = null;
      } else if (!avoiding) {
        p.dir = -p.dir;
        p.walkAt = -1;
        p.v = 0;
        p.pause = TURN_TIME;
      }
    }
    p.t = t;
    const dodgeStep = (diving || p.dodgeTarget ? PED_DODGE_SPEED : 1.8) * dt;
    p.dodge += clamp(p.dodgeTarget - p.dodge, -dodgeStep, dodgeStep);
    p.x = p.ax + p.ux * t + p.uz * p.dodge;
    p.z = p.az + p.uz * t - p.ux * p.dodge;
    if (p.node && ((t > KERB && t < p.len - KERB) || (p.waiting && walkOn(p)))) {
      p.coord = p.x * p.clx + p.z * p.clz; // along the crossing, as traffic.js measures its lanes there
      if (!p.node.walkers.length) walkedNodes.push(p.node);
      p.node.walkers.push(p);
    }
  }

  function endConversation(conversation) {
    conversation.a.conversation = null;
    conversation.a.socialTime = clock + 30 + Math.random() * 60;
    conversation.b.conversation = null;
    conversation.b.socialTime = clock + 30 + Math.random() * 60;
    conversation.remaining = 0;
  }

  const meetingCells = new Map();
  const usedMeetingCells = [];
  const meetingCellPool = [];
  const meetingKey = (ix, iz) => ((ix + 16384) << 15) | ((iz + 16384) & 0x7fff);
  let nextMeeting = 0;
  function meet(dt) {
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const conversation = p.conversation;
      if (!conversation || conversation.a !== p) continue;
      conversation.remaining -= dt;
      if (conversation.remaining <= 0) endConversation(conversation);
    }
    if (clock < nextMeeting) return;
    nextMeeting = clock + 1;
    for (let i = 0; i < usedMeetingCells.length; i++) {
      const list = usedMeetingCells[i];
      list.length = 0;
      meetingCellPool.push(list);
    }
    usedMeetingCells.length = 0;
    meetingCells.clear();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.placed || p.node || p.seat || !(p.route?.edge || p.route?.chain) || p.conversation || clock < p.socialTime || p.t < 6 || p.t > p.len - 6) continue;
      const ix = Math.floor(p.x * 0.5), iz = Math.floor(p.z * 0.5);
      let partner = null;
      for (let dx = -1; dx <= 1 && !partner; dx++) {
        for (let dz = -1; dz <= 1 && !partner; dz++) {
          const list = meetingCells.get(meetingKey(ix + dx, iz + dz));
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const q = list[k];
            if (q.conversation || p.route.block !== q.route.block) continue;
            const mdx = p.x - q.x, mdz = p.z - q.z;
            const distSq = mdx * mdx + mdz * mdz;
            if (distSq < 0.5625 || distSq > 4 || Math.random() > 0.15) continue;
            partner = q;
            break;
          }
        }
      }
      if (partner) {
        p.conversation = partner.conversation = { a: p, b: partner, remaining: 6 + Math.random() * 6 };
        p.v = partner.v = 0;
      } else {
        const key = meetingKey(ix, iz);
        let list = meetingCells.get(key);
        if (!list) {
          list = meetingCellPool.pop() || [];
          meetingCells.set(key, list);
          usedMeetingCells.push(list);
        }
        list.push(p);
      }
    }
  }

  // Walking surface around a pedestrian: sidewalks are 0.22 m above the road, and crosswalk tracks start and end
  // with 2 m of sidewalk (the rig steps down and up the curbs)
  const SIDEWALK_Y = 0.22;
  const CROSSWALK_Y = 0.012;
  function pedGround(p, x, z) {
    if (p.trail) return floorAt(x, z); // (a park path: on the ground there, or a block's sidewalk where it crosses one)
    const ground = groundHeight(x, z); // Lamp: on the ground there (terrain.js)
    if (!p.node) return ground + SIDEWALK_Y;
    const t = (x - p.ax) * p.ux + (z - p.az) * p.uz;
    return ground + (t > 2 && t < p.len - 2 ? CROSSWALK_Y : SIDEWALK_Y);
  }

  // Struck by the player: anyone inside the car's or bike's outline while it moves faster than a walk goes limp,
  // flung along with it, up and a little aside, spinning; a body already down is knocked on again. Player 2's car or
  // bike in split screen too (`player` is then player2)
  const HIT_SPEED = 2.5;
  let onHit = null;
  function strike(p, player) {
    if (clock - p.hitAt < 0.35) return;
    const speed2 = player.vx * player.vx + player.vz * player.vz;
    if (speed2 < HIT_SPEED * HIT_SPEED) return;
    const dx = p.x - player.x, dz = p.z - player.z;
    const across = dx * player.fz - dz * player.fx, along = dx * player.fx + dz * player.fz;
    if (Math.abs(across) > player.halfW + 0.25 || Math.abs(along) > player.halfL + 0.25) return;
    const speed = Math.sqrt(speed2);
    const side = Math.sign(across) || 1, push = Math.min(3, speed * 0.2);
    const vx = player.vx * 1.1 + player.fz * side * push, vz = player.vz * 1.1 - player.fx * side * push;
    const vy = Math.min(6.5, 1.2 + speed * 0.28);
    p.hitAt = clock;
    if (p.seat) releaseSeat(p); // (thrown from the seat as posed there)
    if (p.ragdoll && p.rig.rag) p.rig.kickRagdoll(vx * 0.6, vy * 0.5, vz * 0.6);
    else {
      if (p.conversation) endConversation(p.conversation);
      p.rig.startRagdoll(vx, vy, vz, side * Math.min(6, speed * 0.35));
      p.ragdoll = true;
      p.shout = -1;
    }
    onHit?.(p.x, p.z, speed, player.who || 0);
  }

  // Hit by something the player's car sent flying (a curb cart, a trash can...: knockdowns.js) at (x, y, z) going
  // (vx, vz): anyone it reaches within r goes limp, thrown the way it was going
  function knockBy(x, y, z, r, vx, vz) {
    const speed = Math.hypot(vx, vz);
    let hit = false;
    for (let i = 0; i < NUM_PEDS; i++) {
      const p = peds[i];
      if (!p.placed || clock - p.hitAt < 0.5) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > r * r || y - groundHeight(p.x, p.z) > 1.9) continue;
      p.hitAt = clock;
      if (p.seat) releaseSeat(p);
      const s = Math.min(1, speed / 12);
      if (p.ragdoll && p.rig.rag) p.rig.kickRagdoll(vx * 0.3, 1, vz * 0.3);
      else {
        if (p.conversation) endConversation(p.conversation);
        p.rig.startRagdoll(vx * 0.45, 1.2 + s * 2.5, vz * 0.45, (dx * vz - dz * vx > 0 ? 1 : -1) * (1.5 + s * 3));
        p.ragdoll = true;
        p.shout = -1;
      }
      onHit?.(p.x, p.z, speed * 0.5);
      hit = true;
    }
    return hit;
  }

  // The ground under a limp body: the sidewalk near the person's walking line, and beyond it whatever's there, the
  // raised block (storefronts' sidewalk, a front lawn: as controllers.js isPointOnSidewalk, parks at the ground's
  // level) or the road
  function ragGround(p, x, z) {
    if (p.node || p.trail) return pedGround(p, x, z);
    const off = Math.abs((x - p.ax) * p.uz - (z - p.az) * p.ux);
    if (off < 1.8) return groundHeight(x, z) + SIDEWALK_Y;
    const b = blockAt(x, z);
    return groundHeight(x, z) + (b && !(b.park > 0.6 && !b.median) ? SIDEWALK_Y : CROSSWALK_Y);
  }

  // A limp body tumbles until it lies still, then a few seconds on the person gets up from where they fell (through
  // the dive's push-up) and steps back to their way; one thrown far off it out of sight just goes home
  function renderRagdoll(p, dt) {
    const draw = !hasView || visible(p.x, p.z, 7);
    const rig = p.rig;
    // (once at rest the body's own clock stops, so the time it has lain there is counted here)
    if (!rig.rag.done) rig.rag.done = rig.stepRagdoll(dt, ragGround, p, draw);
    else rig.rag.time += dt;
    p.x = rig.x;
    p.z = rig.z;
    if (rig.rag.done) {
      const t = (p.x - p.ax) * p.ux + (p.z - p.az) * p.uz;
      const off = (p.x - p.ax) * p.uz - (p.z - p.az) * p.ux;
      const near = t > 0 && t < p.len && Math.abs(off) < 4.5;
      // nobody stays down: one in sight gets up after a few seconds wherever they fell, and walks back to their way
      if (rig.rag.time > 4 && (near || draw)) {
        p.ragdoll = false;
        rig.ragdolling = false;
        rig.rag.done = false;
        p.t = Math.min(p.len, Math.max(0, t));
        p.diveT = p.t; // the push-up is on the spot, not a glide to where an earlier dive was headed
        p.dodge = p.dodgeTarget = off;
        p.returning = true;
        p.diveStart = clock - 1.15;
        p.diveHeading = rig.yaw = rig.ragdollHeading();
        p.v = 0;
        p.pause = 1;
        p.avoidUntil = clock + PEDESTRIAN_DIVE_DURATION;
        p.restTime = Math.max(p.restTime, clock + 10);
      } else if (!draw && (rig.rag.time > 4 || !near)) {
        p.ragdoll = false;
        rig.ragdolling = false;
        rig.rag.done = false;
        p.placed = false;
        return;
      }
    }
    const dx = p.x - focusX, dz = p.z - focusZ, distSq = dx * dx + dz * dz;
    if (p.dog) { dogOwner = p; dogs.step(p.dog, dt, p.x, p.z, p.ux, p.uz, dogGround, draw && distSq < DOG_RANGE * DOG_RANGE, null); }
    if (!draw) return;
    pedCrowd.add(rig, Math.sqrt(distSq));
  }

  // Lamp: seated, posed once when first seen (perch), drawn as it was posed after that
  function renderSitter(p) {
    const draw = !hasView || visible(p.x, p.z, 7);
    if (!draw) return;
    const seat = p.seat;
    if (!p.posed) {
      const footY = seat.y == null ? floorAt(seat.x, seat.z) : seat.y - 0.44;
      sitRoot.position.set(seat.x, footY, seat.z);
      sitRoot.rotation.set(0, seat.yaw, 0);
      p.rig.perch(sitRoot, SIT_POSE(seat.y == null ? 0.47 : seat.y - footY));
      p.posed = true;
    }
    const dx = p.x - focusX, dz = p.z - focusZ;
    pedCrowd.add(p.rig, Math.sqrt(dx * dx + dz * dz));
  }
  let dogOwner = null;
  const dogGround = (x, z) => pedGround(dogOwner, x, z);

  // Visible people (and hidden ones within footstep/turn range) advance their gait; only those the camera may see
  // solve their bone transforms and are drawn, the far ones with the light LOD. Walkers also begin turning towards
  // the next leg of their route over its last metre so the body rounds corners instead of swinging about on the spot.
  function renderPed(p, dt) {
    const draw = !hasView || visible(p.x, p.z, 7);
    const diveTime = clock - p.diveStart;
    const diving = diveTime < PEDESTRIAN_DIVE_DURATION;
    const dx = p.x - focusX, dz = p.z - focusZ;
    const distSq = dx * dx + dz * dz;
    if (!draw && !diving && distSq > 2500) {
      p.rig.placed = false;
      return;
    }
    const partner = p.conversation && (p.conversation.a === p ? p.conversation.b : p.conversation.a);
    const sideStep = p.dodgeTarget - p.dodge;
    let fx = p.ux * p.dir, fz = p.uz * p.dir;
    const ahead = p.dir > 0 ? p.len - p.t : p.t, leg = p.nextRoute?.[p.nextLeg];
    if (leg && ahead < 1 && p.v >= 0.3) {
      const nx = leg.track.ux * leg.dir, nz = leg.track.uz * leg.dir;
      if (fx * nx + fz * nz >= -0.9) {
        const w = 0.5 * (1 - ahead);
        fx += (nx - fx) * w;
        fz += (nz - fz) * w;
      }
    }
    const heading = diving ? p.diveHeading : partner ? Math.atan2(partner.x - p.x, partner.z - p.z)
      : Math.abs(sideStep) > 0.01 ? Math.atan2(p.uz * Math.sign(sideStep), -p.ux * Math.sign(sideStep))
      : Math.atan2(fx, fz);
    // Lamp: an umbrella up in the rain (not running), near the camera only
    const hold = LIFE.rain && p.umbrella && p.speed < 2.4 && !diving && distSq < UMBRELLA_RANGE * UMBRELLA_RANGE ? 1 : 0;
    p.hold = clamp(p.hold + clamp(hold - p.hold, -dt * 2, dt * 2), 0, 1);
    p.rig.hold = p.hold;
    p.rig.update(dt, p.x, p.z, heading, pedGround, p, 0, draw, diving ? diveTime : -1);
    if (p.dog) {
      dogOwner = p;
      const near = draw && distSq < DOG_RANGE * DOG_RANGE;
      dogs.step(p.dog, dt, p.x, p.z, p.ux * p.dir, p.uz * p.dir, dogGround, near, near ? p.rig.handAt(0, leashHand) : null);
    }
    if (!draw) return;
    if (p.hold > 0.6) umbrellas.add(p.rig.handAt(1, handPos), p.x, p.z, hash(p.rig.seed, 14));
    pedCrowd.add(p.rig, Math.sqrt(distSq));
  }

  function update(dt, elapsed, x, z, jump, view, activeMode) {
    clock = elapsed;
    focusX = x;
    focusZ = z;
    hasView = view;
    pedRange = player.active && (activeMode === 'car' || activeMode === 'cyclist') && player.entity.position.y > -1
      ? Math.sqrt(player.vx * player.vx + player.vz * player.vz) * PED_LOOKAHEAD + player.halfL + 6 : 0;
    strikes2 = Boolean(player2?.active && (player2.mode === 'car' || player2.mode === 'cyclist') && player2.entity.position.y > -1);

    for (const n of walkedNodes) n.walkers.length = 0;
    walkedNodes.length = 0;
    // Frames slower than ~45 a second thin the crowd a little at a time; quick frames let it fill back up
    frameAvg += (Math.min(dt, 0.1) - frameAvg) * Math.min(1, dt * 0.5);
    perf = clamp(perf + (frameAvg > 1 / 42 ? -0.03 : frameAvg < 1 / 52 ? 0.02 : 0) * dt * 10, 0.35, 1);
    if (jump || clock >= crowdCheck) {
      crowdCheck = clock + 2;
      let sum = 0, length = 0, peak = 0.05;
      for (const e of nearEdges) {
        const w = edgeCrowd(e), L = e.span || 1;
        sum += w * L; length += L; peak = Math.max(peak, w);
      }
      // Lamp: and the park and campus paths round about (their share of the walkers: spawnPed)
      edgeSum = sum;
      trailSum = 0;
      pedRoutes.trailsNear(focusX, focusZ, PED_RADIUS * 0.8, nearTrails);
      for (const t of nearTrails) {
        const w = trailCrowd(t);
        trailSum += w * t.len; length += t.len; peak = Math.max(peak, w);
      }
      sum += trailSum;
      crowdShare = length ? sum / length : 0;
      crowdPeak = peak;
      // Lamp: the seats round about that someone might be sitting in now
      nearSeats.length = 0;
      sitWanted = 0;
      if (SIT_SPOTS?.within) {
        const open = patiosOpen() && !LIFE.rain && !LIFE.snow && mild();
        const benches = !LIFE.rain && !LIFE.snow && LIFE.hour >= 8 && LIFE.hour < 20.5
          ? (LIFE.tempF != null && LIFE.tempF < 40 ? 0.04 : LIFE.month >= 5 && LIFE.month <= 9 ? 0.2 : 0.1) : 0;
        let patio = 0, bench = 0;
        for (const st of SIT_SPOTS.within(focusX, focusZ, PLACE_MAX, seatScratch)) {
          if (st.kind === 'bleacher' || st.box?.knock?.down) continue;
          const isPatio = st.y != null; // (a park bench's height is the ground's under it: y null)
          if (isPatio ? !open : !benches) continue;
          nearSeats.push(st);
          if (isPatio) patio++; else bench++;
        }
        sitWanted = Math.min(SIT_CAP, Math.round((patio * 0.35 * mealHour(LIFE.hour) + bench * benches) * busy));
      }
    }
    const wanted = Math.round(NUM_PEDS * clamp(crowdShare * 1.5, 0.05, 1) * busy * perf);
    placedCount = 0;
    sitting = 0;
    for (const p of peds) {
      if (p.placed) { placedCount++; if (p.seat) sitting++; continue; }
      // gone home: their seat and their dog freed
      if (p.seat) releaseSeat(p);
      if (p.dog) { dogs.release(p.dog); p.dog = null; }
    }
    let pedBudget = jump ? NUM_PEDS : 6;
    const keepRadius = jump ? NEAR_RADIUS : PED_RADIUS;
    const keepRadiusSq = keepRadius * keepRadius;
    for (let scanned = 0; scanned < NUM_PEDS && pedBudget > 0; scanned++) {
      const p = peds[pedCursor];
      pedCursor = (pedCursor + 1) % NUM_PEDS;
      // too many out for the place and hour: one out of sight goes home
      if (p.placed && placedCount > wanted && (jump || !nearView(p.x, p.z, 2, PED_SPAWN_DISTANCE))) {
        if (p.conversation) endConversation(p.conversation);
        goHome(p);
        p.placed = false; placedCount--; pedBudget--;
        continue;
      }
      if (p.placed) {
        const dx = p.x - focusX, dz = p.z - focusZ;
        if (dx * dx + dz * dz <= keepRadiusSq) continue;
      }
      pedBudget--;
      if (p.placed) { if (p.conversation) endConversation(p.conversation); goHome(p); p.placed = false; placedCount--; }
      if (placedCount >= wanted) continue;
      if (spawnPed(p, jump ? 0 : PLACE_MIN, jump ? NEAR_RADIUS : PLACE_MAX, !jump)) placedCount++;
    }
    // Lamp: short of sitters for the hour (the crowd full, nobody leaving to make room): a walker or two out of sight
    // goes to sit down somewhere else out of sight, a couple of times a second
    if (sitting < sitWanted && nearSeats.length && clock >= sitCheck) {
      sitCheck = clock + 0.5;
      for (let k = 0; k < 2; k++) {
        const p = peds[Math.floor(Math.random() * NUM_PEDS)];
        if (!p.placed || p.seat || p.ragdoll || p.node || clock - p.diveStart < PEDESTRIAN_DIVE_DURATION || nearView(p.x, p.z, 2, PED_SPAWN_DISTANCE)) continue;
        if (!sitDown(p, PLACE_MIN * PLACE_MIN, PLACE_MAX * PLACE_MAX, true)) continue;
        if (p.dog) { dogs.release(p.dog); p.dog = null; }
      }
    }
    for (let i = 0; i < NUM_PEDS; i++) {
      const p = peds[i];
      if (!p.placed) continue;
      if (pedRange) strike(p, player);
      if (strikes2) strike(p, player2);
      if (!p.ragdoll && !p.seat) { react(p); avoidPlayer(p); }
    }
    meet(dt);
    gatherCurbs();
    pedCrowd.begin();
    umbrellas.begin();
    dogs?.begin();
    for (let i = 0; i < NUM_PEDS; i++) {
      const p = peds[i];
      if (!p.placed) continue;
      if (p.ragdoll) { renderRagdoll(p, dt); continue; }
      if (p.seat) {
        // up again when they've sat long enough, or when the chair's knocked over or put away
        const kept = !p.seat.box?.knock?.down;
        if (kept && clock < p.sitUntil) { renderSitter(p); continue; }
        if (p.homeless && kept) {
          // (no walk to step back to: they sit on while they're seen, and are gone when they aren't)
          if (hasView && !visible(p.x, p.z, 7)) { releaseSeat(p); p.placed = false; continue; }
          p.sitUntil = clock + 15;
          renderSitter(p);
          continue;
        }
        standUp(p);
      } else if (p.homeless && hasView && !visible(p.x, p.z, 7) && !p.ragdoll) { p.placed = false; continue; }
      walk(p, dt);
      renderPed(p, dt);
    }
    pedCrowd.end();
    umbrellas.end();
    dogs?.end();
  }

  // 0 (empty streets) to 1 (a warm evening downtown), from the hour and the weather
  // (shares: town-clock.js crowdShares; without them value is the whole town's hour as well)
  function setBusy(value, shares = null) {
    busy = clamp(value, 0.05, 1);
    for (const k of ['campus', 'downtown', 'homes']) share[k] = shares ? clamp(shares[k], 0.02, 1.5) : 1;
    crowdCheck = -Infinity;
  }
  const stats = () => {
    let onTrails = 0, withDogs = 0, umbrellasUp = 0;
    for (const p of peds) if (p.placed) { if (p.trail) onTrails++; if (p.dog) withDogs++; if (p.hold > 0.6) umbrellasUp++; }
    return { out: placedCount, sitting, sitWanted, onTrails, withDogs, umbrellasUp, perf: +perf.toFixed(2), share: +crowdShare.toFixed(2), busy,
      campus: +share.campus.toFixed(2), downtown: +share.downtown.toFixed(2), homes: +share.homes.toFixed(2) };
  };

  function setRailCrossings(list) { rails = list || []; }

  return { peds, meshes: [...pedCrowd.meshes, umbrellas.mesh, ...(dogs ? dogs.meshes : [])], update, setBusy, stats, setRailCrossings, setHitListener(fn) { onHit = fn; }, knockBy, onRiderHit: (x, z, speed) => onHit?.(x, z, speed) };
}

export { createPedestrianSystem, setSitSpots };
