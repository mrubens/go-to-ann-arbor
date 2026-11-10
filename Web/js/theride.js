import * as THREE from 'three/webgpu';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { nativeFeed, decodeVehiclePositions, toWorld } from './live-feeds.js';

// Lamp: TheRide, Ann Arbor's buses, on their real routes and timetable. data/theride.json.gz (build-theride.py, from
// TheRide's GTFS feed) holds the routes, the stops in the map, each route's path and every trip's times at those stops.
// Here: which trips are on the road at this moment in Ann Arbor (its own clock and calendar), each route's path as a
// run of the traffic's road edges (matched to the path once, as a bus first needs it), where on it the timetable puts
// a bus now, and the stop signs along the curbs. traffic.js drives the buses.

const DETROIT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Ann Arbor's date (YYYYMMDD), weekday (Monday 0) and seconds since midnight at `ms`
function localTime(ms) {
  const p = {};
  for (const { type, value } of DETROIT.formatToParts(new Date(ms))) p[type] = value;
  return { date: `${p.year}${p.month}${p.day}`, weekday: WEEKDAYS.indexOf(p.weekday), sec: +p.hour * 3600 + +p.minute * 60 + +p.second };
}

async function loadTheRide(url = './data/theride.json.gz', name = 'theride') {
  try {
    const packed = await asset(url);
    if (!packed) return null;
    const head = new Uint8Array(packed, 0, 2);
    const bytes = head[0] === 0x1f && head[1] === 0x8b
      ? await new Response(new Response(packed).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      : packed;
    const data = JSON.parse(new TextDecoder().decode(bytes));
    log(`[${name}] ${data.routes.length} routes, ${data.stops.length} stops, ${data.trips.length} trips (feed ${data.feed[0]})`);
    return data;
  } catch (error) {
    console.warn(`[${name}] no timetable:`, error);
    return null;
  }
}

// A trip: [route, shape, headsign, service, block, stop, arrive, depart, stop, arrive, depart, ...]
const tripStart = (t) => t[6];
const tripEnd = (t) => t[t.length - 1];

function createSchedule(data, network) {
  const { edges } = network;
  const drivable = edges.filter((e) => e.moves.length && e.len > 4);
  // the drivable edges by 50 m cell, each in every cell within 10 m of it
  const CELL = 50;
  const grid = new Map();
  const cellKey = (ix, iz) => ix * 100003 + iz;
  for (const e of drivable) {
    const x1 = e.sx + e.dx * e.len, z1 = e.sz + e.dz * e.len;
    for (let ix = Math.floor((Math.min(e.sx, x1) - 10) / CELL); ix <= Math.floor((Math.max(e.sx, x1) + 10) / CELL); ix++) {
      for (let iz = Math.floor((Math.min(e.sz, z1) - 10) / CELL); iz <= Math.floor((Math.max(e.sz, z1) + 10) / CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
    }
  }

  // TheRide's feed takes its weekday service off on the third Thursday of November and runs it on Thanksgiving, the
  // fourth, when the buses don't run: a day taken off on the third Thursday with nothing on the fourth is moved there.
  // Nobody takes an ordinary Thursday off, so this only ever corrects that slip.
  for (const ex of data.exceptions) {
    const [id, d, type] = ex;
    const day = +d.slice(6, 8);
    if (type !== 2 || d.slice(4, 6) !== '11' || day < 15 || day > 21) continue;
    if (new Date(Date.UTC(+d.slice(0, 4), 10, day)).getUTCDay() !== 4) continue;
    const thanksgiving = `${d.slice(0, 6)}${day + 7}`;
    if (data.exceptions.some((o) => o[0] === id && o[1] === thanksgiving)) continue;
    ex[1] = thanksgiving;
  }

  // Which services run on a date: by weekday between their dates, less the days taken off, plus days added
  const servicesCache = new Map();
  function servicesOn(date, weekday) {
    if (servicesCache.has(date)) return servicesCache.get(date);
    const on = new Set();
    for (const [id, days, start, end] of data.calendar) {
      if (days[weekday] === '1' && date >= start && date <= end) on.add(id);
    }
    for (const [id, d, type] of data.exceptions) {
      if (d !== date) continue;
      if (type === 1) on.add(id);
      else on.delete(id);
    }
    servicesCache.set(date, on);
    return on;
  }
  const dayBefore = (date) => {
    const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) - 864e5);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  // A date outside the timetable's dates (before it starts, or once it has run out and the data wasn't built again)
  // moved onto an ordinary day of the same weekday in it, so the buses keep that weekday's usual schedule. Not simply
  // the nearest week: U-M's feed ends in its winter-break week (no Blue Buses on New Year's Day, a Friday), and every
  // day in it has some exception, so "ordinary" is the service set that weekday has most often in the feed.
  const days = (date) => Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8)) / 864e5;
  const dateOf = (n) => {
    const d = new Date(n * 864e5);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  };
  const feedStart = data.calendar.reduce((a, c) => (c[2] < a ? c[2] : a), '99999999');
  const feedEnd = data.calendar.reduce((a, c) => (c[3] > a ? c[3] : a), '00000000');
  const typical = new Map(); // weekday -> { first, last } in-feed dates with that weekday's usual services
  function typicalDays(weekday) {
    if (typical.has(weekday)) return typical.get(weekday);
    const a = days(feedStart), b = days(feedEnd);
    const tally = new Map();
    for (let n = a; n <= b; n++) {
      if ((new Date(n * 864e5).getUTCDay() + 6) % 7 !== weekday) continue;
      const date = dateOf(n);
      const key = [...servicesOn(date, weekday)].sort().join(',');
      const t = tally.get(key) || { count: 0, first: date, last: date };
      t.count++;
      t.last = date;
      tally.set(key, t);
    }
    let best = null;
    for (const t of tally.values()) if (!best || t.count > best.count) best = t;
    typical.set(weekday, best);
    return best;
  }
  function inFeed(date, weekday) {
    const n = days(date), a = days(feedStart), b = days(feedEnd);
    if (n >= a && n <= b) return date;
    const t = typicalDays(weekday);
    if (t) return n < a ? t.first : t.last;
    return dateOf(n < a ? n + Math.ceil((a - n) / 7) * 7 : n - Math.ceil((n - b) / 7) * 7);
  }

  // The trips on the road at `ms`, each with how far into its service day it is (a trip after midnight runs on the
  // day before's timetable, past 24:00)
  function activeTrips(ms) {
    const now = localTime(ms);
    const date = inFeed(now.date, now.weekday);
    const today = servicesOn(date, now.weekday);
    const before = (now.weekday + 6) % 7;
    const yesterday = servicesOn(inFeed(dayBefore(now.date), before), before);
    const out = [];
    for (const t of data.trips) {
      const sec = now.sec - delayOf(t);
      if (today.has(t[3]) && sec >= tripStart(t) - 30 && sec <= tripEnd(t)) out.push({ trip: t, sec });
      else if (yesterday.has(t[3]) && sec + 86400 >= tripStart(t) - 30 && sec + 86400 <= tripEnd(t)) out.push({ trip: t, sec: sec + 86400 });
    }
    return out;
  }
  // How far into the trip's service day it is at `ms`
  function secondsInto(trip, ms) {
    const sec = localTime(ms).sec - delayOf(trip);
    return sec < tripStart(trip) - 6 * 3600 ? sec + 86400 : sec;
  }

  // ---- Where the buses really are (GTFS-realtime vehicle positions) ------------------------------------------------
  // Each live bus becomes how late (or early) its trip runs: where on its route the bus is, read back into the time
  // the timetable has it there, against the time of the report. The trip then runs that much later everywhere above,
  // so the bus is drawn where it really is and goes on from there. A report older than ten minutes is let go.
  const tripById = new Map();
  (data.tripIds || []).forEach((id, i) => tripById.set(id, data.trips[i]));
  const live = new Map(); // trip -> { delay, stamp }
  const delayOf = (trip) => live.get(trip)?.delay ?? 0;
  const liveStamp = (trip) => live.get(trip)?.stamp ?? 0;
  function rawSecondsInto(trip, ms) {
    const sec = localTime(ms).sec;
    return sec < tripStart(trip) - 6 * 3600 ? sec + 86400 : sec;
  }
  function timetableSecAt(trip, x, z) {
    for (const route of routesOf(trip)) {
      let best = 30, d = null;
      for (let k = 0; k < route.edges.length; k++) {
        const e = route.edges[k];
        const qx = x - e.sx, qz = z - e.sz;
        const s = qx * e.dx + qz * e.dz;
        if (s < -6 || s > e.len + 6) continue;
        const off = Math.abs(qx * e.rx + qz * e.rz);
        if (off < best) { best = off; d = route.cum[k] + Math.max(0, Math.min(e.len, s)); }
      }
      if (d === null) continue;
      const st = route.stops;
      if (d <= st[0].d + 4) return st[0].dep;
      for (let j = 1; j < st.length; j++) {
        const a = st[j - 1], b = st[j];
        if (d > b.d + 8) continue;
        if (d >= b.d - 4) return b.arr; // at the stop
        const f = Math.max(0, Math.min(1, (d - a.d - 4) / Math.max(1, b.d - a.d)));
        return a.dep + f * (b.arr - a.dep);
      }
      return st[st.length - 1].arr;
    }
    return null;
  }
  function applyLive(feed, nowMs) {
    let n = 0;
    for (const v of feed.vehicles) {
      const trip = tripById.get(v.trip);
      if (!trip) continue;
      const stamp = (v.time || feed.time) * 1000;
      if (!stamp || nowMs - stamp > 600e3) continue;
      const { x, z } = toWorld(v.lat, v.lon);
      const at = timetableSecAt(trip, x, z);
      if (at === null) continue;
      const delay = Math.max(-900, Math.min(2700, rawSecondsInto(trip, stamp) - at));
      live.set(trip, { delay, stamp });
      n++;
    }
    for (const [trip, l] of live) if (nowMs - l.stamp > 600e3) live.delete(trip);
    return n;
  }

  // ---- Each path as runs of road edges ----------------------------------------------------------------------------
  // The path resampled every 4 m; then, from wherever it first follows a road edge (by the centre line, the right way),
  // on from edge to edge through the intersections, taking at each the move whose road keeps closest to the path,
  // until none keeps within 14 m of it (a lane, a car park or a street the traffic doesn't drive): then on along the
  // path to where it follows a road again. Each run is a piece a bus can drive.
  const STEP = 4;
  const pieceCache = new Map();
  function piecesOf(shapeIx) {
    if (pieceCache.has(shapeIx)) return pieceCache.get(shapeIx);
    const flat = data.shapes[shapeIx];
    const Q = [];
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const x0 = flat[i], z0 = flat[i + 1], x1 = flat[i + 2], z1 = flat[i + 3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0; d < L; d += STEP) Q.push([x0 + (x1 - x0) * d / L, z0 + (z1 - z0) * d / L]);
    }
    if (flat.length >= 2) Q.push([flat[flat.length - 2], flat[flat.length - 1]]);
    const nearest = (x, z, i0, i1) => {
      let best = Infinity, bi = i0;
      for (let i = Math.max(0, i0); i <= Math.min(Q.length - 1, i1); i++) {
        const d = (Q[i][0] - x) ** 2 + (Q[i][1] - z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      return { d: Math.sqrt(best), i: bi };
    };
    const startAt = (i) => {
      const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      let best = null, bd = 9;
      for (const e of grid.get(cellKey(Math.floor(Q[i][0] / CELL), Math.floor(Q[i][1] / CELL))) || []) {
        if (e.dx * tx + e.dz * tz < 0.9) continue;
        const qx = Q[i][0] - e.sx, qz = Q[i][1] - e.sz;
        const s = qx * e.dx + qz * e.dz;
        if (s < 0 || s > e.len) continue;
        const lat = Math.abs(qx * e.rx + qz * e.rz);
        if (lat < bd) { bd = lat; best = e; }
      }
      return best;
    };
    const pieces = [];
    let i = 0;
    while (i < Q.length - 5) {
      const e0 = startAt(i);
      if (!e0) { i += 3; continue; }
      const list = [e0];
      let e = e0, qi = i;
      const seen = new Set([e0]);
      while (list.length < 600) {
        const end = nearest(e.sx + e.dx * e.len, e.sz + e.dz * e.len, qi, qi + Math.ceil((e.len + 40) / STEP));
        // the edge's end must be on the path, further along it: else the road has left the path, or circles back
        if (end.d > 14 || (end.i <= qi && list.length > 1)) break;
        qi = end.i;
        if (qi >= Q.length - 3) break;
        let best = null, bs = 14;
        for (const m of e.moves) {
          const f = m.to;
          const reach = qi + Math.ceil((f.len + 60) / STEP);
          let worst = 0;
          for (const t of [Math.min(6, f.len * 0.3), f.len * 0.5, f.len * 0.92]) {
            worst = Math.max(worst, nearest(f.sx + f.dx * t, f.sz + f.dz * t, qi - 2, reach).d);
            if (worst >= bs) break;
          }
          if (worst < bs) { bs = worst; best = f; }
        }
        if (!best || seen.has(best)) break;
        seen.add(best);
        list.push(best);
        e = best;
      }
      if (list.length >= 2) pieces.push(makePiece(list));
      i = Math.max(qi + 3, i + 3);
    }
    pieceCache.set(shapeIx, pieces);
    return pieces;
  }
  function makePiece(list) {
    const cum = [0];
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1], b = list[k];
      cum.push(cum[k - 1] + a.len + Math.hypot(b.sx - (a.sx + a.dx * a.len), b.sz - (a.sz + a.dz * a.len)));
    }
    return { edges: list, cum, length: cum[cum.length - 1] + list[list.length - 1].len };
  }
  // Where on the piece a point beside the road is: its edge (from k0 on) and how far along it
  function onPiece(piece, x, z, k0) {
    for (let k = k0; k < piece.edges.length; k++) {
      const e = piece.edges[k];
      const qx = x - e.sx, qz = z - e.sz;
      const s = qx * e.dx + qz * e.dz;
      if (s < -2 || s > e.len + 2) continue;
      if (Math.abs(qx * e.rx + qz * e.rz) > e.half + 10) continue;
      return { k, s: Math.max(0, Math.min(e.len, s)) };
    }
    return null;
  }

  // A trip's route: the piece of its path it drives, with its stops on it (edge, place, times). Each trip on that
  // piece shares its stops' places, worked out once.
  const routeCache = new Map();
  function routesOf(trip) {
    if (routeCache.has(trip)) return routeCache.get(trip);
    const out = [];
    for (const piece of piecesOf(trip[1])) {
      const stops = [];
      let k = 0;
      for (let j = 5; j + 2 < trip.length; j += 3) {
        const [, x, z] = data.stops[trip[j]];
        const at = onPiece(piece, x, z, k);
        if (!at) continue;
        k = at.k;
        stops.push({ k: at.k, s: at.s, d: piece.cum[at.k] + at.s, arr: trip[j + 1], dep: trip[j + 2], stop: trip[j] });
      }
      if (stops.length >= 2) out.push({ ...piece, stops });
    }
    routeCache.set(trip, out);
    return out;
  }

  // Where the timetable puts the trip's bus `sec` into its day: on which route piece, on which edge and how far along
  // it (the bus's middle, `half` behind its front), and the next stop it makes. null while it is off the map's roads.
  function placeAt(trip, sec, half, near = null) {
    // first, roughly: between its stops as the crow flies, is it anywhere near?
    if (near) {
      let x = null, z = null;
      for (let j = 5; j + 2 < trip.length; j += 3) {
        if (sec > trip[j + 2]) continue;
        const [, bx, bz] = data.stops[trip[j]];
        if (j === 5 || sec >= trip[j + 1]) { x = bx; z = bz; break; }
        const [, ax, az] = data.stops[trip[j - 3]];
        const f = (sec - trip[j - 1]) / Math.max(1, trip[j + 1] - trip[j - 1]);
        x = ax + (bx - ax) * f;
        z = az + (bz - az) * f;
        break;
      }
      if (x === null || Math.hypot(x - near.x, z - near.z) > near.r) return null;
    }
    for (const route of routesOf(trip)) {
      const st = route.stops;
      if (sec < st[0].arr - 30 || sec > st[st.length - 1].dep) continue;
      let d, next = 0;
      if (sec <= st[0].arr) {
        d = st[0].d - 40 * (st[0].arr - sec) / 30;
      } else {
        for (let j = 0; j < st.length; j++) {
          if (sec <= st[j].dep) {
            next = j;
            if (sec >= st[j].arr) d = st[j].d + 4; // at the stop
            else {
              const a = st[j - 1];
              const f = (sec - a.dep) / Math.max(1, st[j].arr - a.dep);
              d = a.d + 4 + (st[j].d - a.d) * f;
              d = Math.min(d, st[j].d - 1);
            }
            break;
          }
        }
      }
      if (d === undefined) continue;
      d -= half;
      let k = 0;
      while (k + 1 < route.edges.length && route.cum[k + 1] <= d) k++;
      const e = route.edges[k];
      const s = d - route.cum[k];
      if (s < half + 1 || s > e.len - half - 1) return null; // not on a road edge just then (in an intersection)
      return { route, k, s, next };
    }
    return null;
  }

  function label(trip) {
    const [short, name, col] = data.routes[trip[0]];
    let head = data.headsigns[trip[2]];
    if (head.startsWith(short + ' ')) head = head.slice(short.length + 1);
    const to = head.lastIndexOf(' to '); // "Washtenaw Local to Ypsilanti Transit Ctr": the sign shows where it's going
    if (to > 0) head = head.slice(to + 4);
    return { short, name, color: col, headsign: head };
  }

  return { activeTrips, secondsInto, placeAt, label, applyLive, delayOf, liveStamp, stops: data.stops };
}

// ---- The stop signs ---------------------------------------------------------------------------------------------------
// A plain bus-stop sign at each stop in the map: a green plate on a grey pole at the back of the curb, set beside the road
// nearest the stop and facing the traffic that stops there
function buildStopSigns(stops, network) {
  const { edges } = network;
  const placed = [];
  // every road by 50 m cell, each in every cell within its width (and 2 m) of it, to tell whether a spot is on one
  const CELL = 50, grid = new Map(), cellKey = (ix, iz) => ix * 100003 + iz;
  for (const e of edges) {
    const x1 = e.sx + e.dx * e.len, z1 = e.sz + e.dz * e.len, m = (e.half || 0) + 2;
    for (let ix = Math.floor((Math.min(e.sx, x1) - m) / CELL); ix <= Math.floor((Math.max(e.sx, x1) + m) / CELL); ix++) {
      for (let iz = Math.floor((Math.min(e.sz, z1) - m) / CELL); iz <= Math.floor((Math.max(e.sz, z1) + m) / CELL); iz++) {
        const k = cellKey(ix, iz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
    }
  }
  // on a road's pavement, its ends rounded so the corners of a crossing count too
  const onRoad = (px, pz) => {
    for (const e of grid.get(cellKey(Math.floor(px / CELL), Math.floor(pz / CELL))) || []) {
      const qx = px - e.sx, qz = pz - e.sz;
      const t = Math.max(0, Math.min(e.len, qx * e.dx + qz * e.dz));
      if (Math.hypot(qx - e.dx * t, qz - e.dz * t) < (e.half || 0) + 0.4) return true;
    }
    return false;
  };
  const SLIDES = [0];
  for (let d = 2; d <= 30; d += 2) SLIDES.push(-d, d);
  for (const [, x, z] of stops) {
    let best = null, bd = Infinity;
    for (const e of edges) {
      const qx = x - e.sx, qz = z - e.sz;
      const s = qx * e.dx + qz * e.dz;
      if (s < 0 || s > e.len) continue;
      const lat = qx * e.rx + qz * e.rz;
      if (lat < -1 || lat > e.half + 14) continue; // the stop on this edge's right
      if (lat < bd) { bd = lat; best = { e, s }; }
    }
    if (best) {
      // Lamp: beside its own road, slid along the curb (nearest first) until the spot is on no road at all: a stop
      // mapped by a corner would otherwise stand in the cross street. Left out when no spot nearby is clear.
      const { e, s } = best;
      let done = false;
      for (const back of [0.7, 1.6, 2.8]) {
        const off = e.half + back;
        for (const step of SLIDES) {
          const t = s + step;
          if (t < 0 || t > e.len) continue;
          const px = e.sx + e.dx * t + e.rx * off, pz = e.sz + e.dz * t + e.rz * off;
          if (onRoad(px, pz)) continue;
          placed.push({ x: px, z: pz, yaw: Math.atan2(e.dx, e.dz) });
          done = true;
          break;
        }
        if (done) break;
      }
    } else if (!onRoad(x, z)) {
      placed.push({ x, z, yaw: 0 });
    }
  }

  log(`[bus] ${placed.length} of ${stops.length} stop signs placed off the road`);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d');
  // Lamp: a plain city bus-stop plate (no transit agency's logo or colors): green, a bus, "BUS STOP"
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#1f6b45';
  g.fillRect(6, 6, 116, 180);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // a bus seen from the side
  g.fillRect(24, 40, 80, 46);
  g.fillStyle = '#1f6b45';
  for (let i = 0; i < 4; i++) g.fillRect(30 + i * 18, 47, 14, 16);
  g.beginPath();
  g.arc(42, 88, 8, 0, Math.PI * 2);
  g.arc(86, 88, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = '800 24px Inter, Arial, sans-serif';
  g.fillText('BUS', 64, 128);
  g.fillText('STOP', 64, 156);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const plateGeo = new THREE.PlaneGeometry(0.46, 0.69);
  plateGeo.translate(0.27, 2.45, 0);
  const plateMat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.55, side: THREE.DoubleSide });
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.9, 6);
  poleGeo.translate(0, 1.45, 0);
  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.6 });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, placed.length);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, placed.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  placed.forEach((st, i) => {
    // the plate stands out over the sidewalk from the pole, its face to the traffic coming (against the edge's way)
    q.setFromAxisAngle(up, st.yaw + Math.PI);
    p.set(st.x, groundHeight(st.x, st.z), st.z);
    m.compose(p, q, one);
    plates.setMatrixAt(i, m);
    poles.setMatrixAt(i, m);
  });
  plates.castShadow = poles.castShadow = true;
  return { plates, poles, placed };
}

// Asks the app around the page for TheRide's live positions and moves the schedule's trips to them; how many buses
// it placed, or null where there's no live feed (Lamp's preview, or the feed not answering)
const THERIDE_VEHICLES = 'https://rt.theride.org/gtfsrt/vehicles';
async function fetchTheRideLive(sched) {
  const bytes = await nativeFeed(THERIDE_VEHICLES);
  if (!bytes) return null;
  try {
    return sched.applyLive(decodeVehiclePositions(bytes), Date.now());
  } catch (error) {
    console.warn('[theride] live positions unreadable:', error);
    return null;
  }
}

export { loadTheRide, createSchedule, buildStopSigns, localTime, fetchTheRideLive };
