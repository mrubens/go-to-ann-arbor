import { groundUnderStreets, footbridgeTop } from './terrain.js';
import { LIFE } from './street-life.js';
import { TIER, XBOX } from './device-tier.js';
import { B2B_ROUTE } from './b2b-route.js';
import { b2bTop } from './b2b-trail.js';

// Lamp: the cyclists out on the Border to Border Trail (b2b-route.js) are the town's own traffic bikes (traffic.js),
// bicycles and e-bikes with their riders, run into, thrown, remounting and taken (F) as any other; only where they go is
// this file's: along the trail's own path rather than a street, keeping right at 10-15 mph, moving left to pass the
// player and slowing behind them when they can't, on along the straightest way at a junction, round and back at its
// ends; brought in 90-320 m off and out of the camera's eye and let go past 360 m. How many by the hour, weekend,
// weather and cold (`wanted`): most on mild evenings and weekend mornings, hardly any after dark or in snow, fewer
// below freezing. None on a phone or the Xbox.

const TRAIL_BIKES = XBOX || TIER.name === 'phone' ? 0 : TIER.name === 'full' ? 9 : TIER.name === 'light' ? 7 : 3;
const NEAR = 320, SPAWN_MIN = 90, KEEP = 360;

// how many are out now: by the hour (the park's), the weather and the season
function wanted() {
  const h = LIFE.hour;
  let k = h < 5.5 || h >= 21.5 ? 0.04 : h < 7 ? 0.35 : h < 10 ? 0.85 : h < 16 ? 0.6 : h < 20 ? 1 : 0.3;
  if (LIFE.weekday === 0 || LIFE.weekday === 6) k = Math.min(1, k * (h >= 8 && h < 13 ? 1.4 : 1.1));
  if (LIFE.snow) k *= 0.05;
  else if (LIFE.rain) k *= 0.2;
  const t = LIFE.tempF;
  // (Michigan riders: a raw 39°F morning still has them out; it takes a hard freeze to clear the trail)
  if (t != null) k *= t < 20 ? 0.25 : t < 32 ? 0.5 : t < 45 ? 0.8 : t < 58 ? 0.9 : t > 92 ? 0.6 : 1;
  return Math.round(TRAIL_BIKES * k);
}

// the trail's own path (not the streets it follows): each way, and what follows on from each of its ends
const PATHS = B2B_ROUTE.filter((w) => w.own && w.len > 8);
const ENDS = new Map();
for (const w of PATHS) {
  for (const [end, n] of [[0, w.nodes[0]], [1, w.nodes[w.nodes.length - 1]]]) {
    if (!ENDS.has(n)) ENDS.set(n, []);
    ENDS.get(n).push([w, end]);
  }
}
function along(w, s, out) {
  s = Math.max(0, Math.min(w.len, s));
  let k = out.k ?? 0;
  if (k >= w.pts.length - 1 || w.cum[k] > s) k = 0;
  while (k + 2 < w.pts.length && w.cum[k + 1] < s) k++;
  out.k = k;
  const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1], l = w.cum[k + 1] - w.cum[k] || 1, f = (s - w.cum[k]) / l;
  out.x = ax + (bx - ax) * f; out.z = az + (bz - az) * f;
  out.tx = (bx - ax) / l; out.tz = (bz - az) / l;
  return out;
}

// on the trail's surface where it's laid (b2b-trail.js), else the ground, or a footbridge's deck
const trailTop = (x, z) => Math.max(b2bTop(x, z), groundUnderStreets(x, z) + 0.02, footbridgeTop(x, z));

/**
 * The trail's riders for traffic.js: `count` bikes it makes for the trail, `want(cam)` how many should be out now (0
 * when the trail is out of reach), `spawn(v, cam, visible)` puts one on it out of sight (true if placed), `step(v, dt,
 * cam, player)` rides one on (false once it's past keeping), `top(x, z)` the height it rides at
 */
function createTrailRides() {
  const near = [];
  let nearAt = null;
  function refresh(cam) {
    if (nearAt && Math.hypot(cam.x - nearAt.x, cam.z - nearAt.z) < 60) return;
    nearAt = { x: cam.x, z: cam.z };
    near.length = 0;
    for (const w of PATHS) for (let s = 0; s < w.len; s += 20) {
      const p = along(w, s, {});
      if (Math.abs(p.x - cam.x) < NEAR && Math.abs(p.z - cam.z) < NEAR) near.push([w, s]);
    }
  }
  function want(cam) {
    refresh(cam);
    return near.length ? wanted() : 0;
  }
  // where it is on the trail: its lane to the right of the way it's going; its heading along it returned
  function place(v) {
    const r = v.ride, p = along(r.way, r.s, r.at), hx = p.tx * r.dir, hz = p.tz * r.dir;
    v.x = p.x - hz * r.lane; v.z = p.z + hx * r.lane;
    v.tx = hx; v.tz = hz;
    return Math.atan2(hx, hz);
  }
  function spawn(v, cam, visible) {
    refresh(cam);
    for (let tries = 0; tries < 12 && near.length; tries++) {
      const [w, s] = near[Math.floor(Math.random() * near.length)];
      const p = along(w, s, {});
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d < SPAWN_MIN || d > NEAR || visible(p.x, p.z, 4)) continue;
      v.ride = { way: w, s, dir: Math.random() < 0.5 ? 1 : -1, at: {}, lane: 0.75, cruise: 4.4 + Math.random() * 2.4 };
      v.speed = v.ride.cruise;
      v.yaw = place(v);
      v.prevX = v.x; v.prevZ = v.z;
      return true;
    }
    return false;
  }
  // on to the next way at a junction (the straightest on), else back the way it came
  function carryOn(r) {
    const endNode = r.dir > 0 ? r.way.nodes[r.way.nodes.length - 1] : r.way.nodes[0];
    const here = along(r.way, r.dir > 0 ? r.way.len : 0, {});
    const hx = here.tx * r.dir, hz = here.tz * r.dir;
    let best = null, bestDot = -0.2;
    for (const [w, end] of ENDS.get(endNode) || []) {
      if (w === r.way) continue;
      const p = along(w, end ? w.len : 0, {}), d = end ? -1 : 1;
      const dot = p.tx * d * hx + p.tz * d * hz;
      if (dot > bestDot) { bestDot = dot; best = [w, end]; }
    }
    if (best) {
      const [w, end] = best;
      r.way = w; r.dir = end ? -1 : 1; r.s = end ? w.len : 0; r.at = {};
    } else {
      r.dir = -r.dir;
      r.s = Math.max(0, Math.min(r.way.len, r.s));
    }
  }
  // The trail's etiquette, as on the real one: keep right (0.75 m right of its middle, a quarter of its width); come up
  // on someone slower going the same way (a rider, a runner, a walker, the player) and pass them on the left, ringing
  // once first, only when nobody's coming the other way within 35 m, and back right once they're 4 m behind; otherwise
  // follow them at their pace, 4 m back. Slower (8 mph) by people on foot, giving them a wider berth. Never into
  // anyone. `users`: everyone on the trail round about, { key, x, z, vx, vz, foot }, refreshed every few frames by
  // traffic.js; `bell(x, z)` rings this rider's bell
  function step(v, dt, cam, users, bell) {
    const r = v.ride;
    if (!r || Math.hypot(v.x - cam.x, v.z - cam.z) > KEEP) return false;
    let want = v.riderOff ? 0 : r.cruise, lane = 0.75;
    const hx = Math.sin(v.yaw), hz = Math.cos(v.yaw);
    let lead = null, leadAhead = Infinity, leadSpeed = 0, oncoming = Infinity, foot = false, passed = null, block = Infinity;
    for (const u of users) {
      if (u.key === v) continue;
      const dx = u.x - v.x, dz = u.z - v.z;
      if (dx > 45 || dx < -45 || dz > 45 || dz < -45) continue;
      const ahead = dx * hx + dz * hz, side = dx * hz - dz * hx; // (side: to the left of the rider's line)
      if (ahead < -6 || ahead > 45 || Math.abs(side) > 3.2) continue;
      if (u.key === r.passing) passed = { ahead };
      const along = u.vx * hx + u.vz * hz;
      if (u.foot && ahead > -2 && ahead < 10) foot = true;
      // right in its path, close: brakes, whatever else (never into anyone)
      if (ahead > 0 && Math.abs(side) < 0.9 && ahead < block) block = ahead;
      if (along < -0.3) { if (ahead > 0) oncoming = Math.min(oncoming, ahead); continue; }
      // going the same way (or standing): in the rider's way if it's ahead and within a metre of the rider's line
      if (ahead > 0 && Math.abs(side) < 1.1 && ahead < leadAhead && along < v.speed + 0.2) { lead = u; leadAhead = ahead; leadSpeed = Math.max(0, along); lead.lane = r.lane - side; }
      if (u.key === r.passing) r.passLane = Math.min(r.passLane ?? 0, r.lane - side - (u.foot ? 1.2 : 1.1));
    }
    if (foot) want = Math.min(want, 3.6);
    if (r.passing) {
      // out on the left until the one passed is 4 m behind; back in at once if someone comes the other way close
      if (!passed || passed.ahead < -4 || oncoming < 18) r.passing = null;
      else lane = Math.max(-1.65, Math.min(-0.75, r.passLane ?? -0.75));
    }
    if (!r.passing && lead && leadAhead < 14) {
      // (past them on their left, 1.2 m to spare from someone on foot, 1.1 from a rider: only if that stays on the trail)
      const passLane = Math.min(-0.75, lead.lane - (lead.foot ? 1.2 : 1.1));
      if (oncoming > 35 && !v.riderOff && passLane > -1.65) {
        r.passing = lead.key;
        r.passLane = passLane;
        lane = passLane;
        if ((r.sinceBell ?? 99) > 6) { r.sinceBell = 0; bell(v.x, v.z); }
      } else want = Math.min(want, leadAhead < 4 ? leadSpeed * Math.max(0, (leadAhead - 1.5) / 2.5) : leadSpeed + (leadAhead - 4) * 0.4);
    }
    r.sinceBell = (r.sinceBell ?? 99) + dt;
    const stopping = block < 2.5 + v.speed * 0.7;
    if (stopping) want = 0;
    r.lane += (lane - r.lane) * Math.min(1, dt * 1.2);
    v.acc = Math.max(v.riderOff || stopping ? -6 : -4, Math.min(1.5, (want - v.speed) * (stopping ? 3 : 0.8)));
    v.speed = Math.max(0, v.speed + v.acc * dt);
    r.s += v.speed * dt * r.dir;
    if (r.s > r.way.len || r.s < 0) carryOn(r);
    const yaw = place(v);
    let dy = yaw - v.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turn = dy * Math.min(1, dt * 4);
    v.yaw += turn;
    v.yawRate = dt > 0 ? turn / dt : 0;
    return true;
  }
  // a crash's push (traffic.js shove): along the trail and across it, the lane taking the sideways part
  function shove(v, dx, dz) {
    const r = v.ride;
    if (!r) return;
    const along2 = dx * v.tx + dz * v.tz;
    r.s = Math.max(0, Math.min(r.way.len, r.s + along2 * r.dir));
    r.lane = Math.max(-2.5, Math.min(2.5, r.lane + dx * -v.tz + dz * v.tx));
    place(v);
  }
  return { count: TRAIL_BIKES, want, spawn, step, shove, top: trailTop };
}

export { createTrailRides };
