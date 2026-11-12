import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight } from './terrain.js';
import { attribute, color, float, floor, mix, step, abs, texture, uniform, uv, vec2 } from 'three/tsl';
import { signalPhase, nearestRoads } from './city-config.js';
import { log } from '../lamp-game.js';
import { corridorsOf } from './safety-corridors.js';
import { SPAN_WIRES } from './span-wire-data.js';

// Lamp: Ann Arbor's traffic lights and stop & yield signs, where the road network put them (road-network.js, from
// OpenStreetMap): at a signalised intersection, a mast arm on the far right corner of every approach with a head over
// each of its lanes, lit by the same clock traffic obeys (the lens material picks red / amber / green by height above
// the ground: 5.78 / 5.42 / 5.06 m); at a sign, a post at the right curb by the stop line, facing the drivers coming
// up to it, with an ALL WAY plaque under the stop signs of an all-way stop; SPEED LIMIT signs where real ones stand.

// The limit a street is posted at: OpenStreetMap's maxspeed or the city's (build-annarbor.py), else Ann Arbor's usual
// for its class, as traffic.js drives it
const CLASS_MPH = [55, 35, 30, 30, 25, 30, 25];
const postedMph = (e) => e.mph || CLASS_MPH[e.cls ?? 4] || 25;

const HEAD_Y = 5.42;
const ARM_Y = 6.05;

const octagon = (ctx, r) => {
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
  }
  ctx.closePath();
};
const triangle = (ctx, r) => {
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
    ctx.lineTo(128 + Math.cos(a) * r, 150 + Math.sin(a) * r);
  }
  ctx.closePath();
};

function stopFace(ctx) {
  octagon(ctx, 126);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  octagon(ctx, 116);
  ctx.fillStyle = '#b8141c';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 76px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('STOP', 128, 132);
}
function yieldFace(ctx) {
  triangle(ctx, 140);
  ctx.fillStyle = '#c3161e';
  ctx.fill();
  triangle(ctx, 88);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#c3161e';
  ctx.font = '800 30px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YIELD', 128, 112);
}
function plaqueFace(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 64, 256, 128);
  ctx.fillStyle = '#b8141c';
  ctx.fillRect(8, 72, 240, 112);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ALL WAY', 128, 130);
}
// ONE WAY (MUTCD R6-1): a white arrow on black with the words in black on its shaft, on a 256 x 86 canvas (36 x 12 in);
// `back` draws it pointing the other way, for the sign's far side seen from behind (so it points the same way there)
function oneWayFace(back) {
  return (ctx) => {
    if (back) { ctx.translate(256, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 86);
    ctx.fillStyle = '#111214';
    ctx.fillRect(5, 5, 246, 76);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(14, 27); ctx.lineTo(196, 27); ctx.lineTo(196, 13); ctx.lineTo(242, 43);
    ctx.lineTo(196, 73); ctx.lineTo(196, 59); ctx.lineTo(14, 59);
    ctx.closePath();
    ctx.fill();
    if (back) { ctx.setTransform(1, 0, 0, 1, 0, 0); }
    ctx.fillStyle = '#111214';
    ctx.font = '800 26px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ONE WAY', back ? 151 : 105, 44);
  };
}
// SPEED LIMIT (MUTCD R2-1): black on white, 24 x 30 in, on a 256 x 320 canvas
function limitFace(mph) {
  return (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = '#111214';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.roundRect(12, 12, 232, 296, 18);
    ctx.stroke();
    ctx.fillStyle = '#111214';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 50px Inter, Arial, sans-serif';
    ctx.fillText('SPEED', 128, 66);
    ctx.fillText('LIMIT', 128, 120);
    ctx.font = '800 136px Inter, Arial, sans-serif';
    ctx.fillText(String(mph), 128, 228);
  };
}

// Lamp: TRAFFIC SAFETY CORRIDOR, the city's plain wording, black on white, 24 x 30 in like the limit signs
function corridorFace(ctx) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = '#111214';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.roundRect(12, 12, 232, 296, 18);
  ctx.stroke();
  ctx.fillStyle = '#111214';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 50px Inter, Arial, sans-serif';
  ctx.fillText('TRAFFIC', 128, 96);
  ctx.fillText('SAFETY', 128, 162);
  ctx.font = '800 44px Inter, Arial, sans-serif';
  ctx.fillText('CORRIDOR', 128, 228);
}

// The lamps of a head, top to bottom, each lit through its part of the cycle traffic obeys (city-config.js's
// signalPhase, for the main road (axisIndex 0) or the cross street), switched by update() every frame. Lamp: every
// head's three lamps are one mesh: each vertex knows its lamp (attribute `lamp`, 0-2) and each head its road
// (instance attribute `road`, 0 main, 1 cross), read against two uniforms of which lamp is lit on each road.
const LAMP_COLORS = { red: 0xff2a1e, amber: 0xffa20e, green: 0x1cff7a };
function lampMaterial() {
  const onMain = uniform(new THREE.Vector3()), onCross = uniform(new THREE.Vector3());
  const k = attribute('lamp', 'float'), road = attribute('road', 'float');
  const amber = step(0.5, k), green = step(1.5, k);
  const lit = mix(mix(color(LAMP_COLORS.red), color(LAMP_COLORS.amber), amber), color(LAMP_COLORS.green), green);
  const ons = mix(onMain, onCross, road);
  const on = mix(mix(ons.x, ons.y, amber), ons.z, green);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = mix(lit.mul(0.08), lit.mul(2.2), on); // a dark, tinted lens when off; bright enough to bloom when on
  mat.userData.on = [onMain, onCross];
  return mat;
}

// Lamp: every sign's face and back drawn from one atlas, a 256 x 320 cell per picture (each stretched to fill it, as
// its face's plane stretches it back), with a gutter round each
const TILE_W = 256, TILE_H = 320, PAD = 8, COLS = 4;

function buildTrafficControls(group, network) {
  group.name = 'TrafficControls';
  const dummy = new THREE.Object3D();
  const lists = new Map(); // name -> matrices
  const extra = new Map(); // name -> each copy's own numbers (a head's road; a sign's face and back pictures)
  let standing = null; // the pole or post being put up: each piece of it noted, so it can be knocked over as one
  // Lamp: poles, arms and posts are one mesh of one metal (the arm's turn on its side in its matrix), every sign's face
  // and back another; `data` is what that copy's instance attribute holds
  const ARM_TURN = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const put = (name, data = null) => {
    dummy.updateMatrix();
    const m = dummy.matrix.clone();
    if (name === 'arm') m.multiply(ARM_TURN);
    if (name === 'pole' || name === 'arm' || name === 'post') name = 'metal';
    if (!lists.has(name)) { lists.set(name, []); extra.set(name, []); }
    standing?.parts.push(name, lists.get(name).length);
    lists.get(name).push(m);
    if (data !== null) extra.get(name).push(...[data].flat());
  };
  const tiles = new Map(); // picture -> its cell in the atlas
  const tileOf = (name) => { if (!tiles.has(name)) tiles.set(name, tiles.size); return tiles.get(name); };
  const sign = (face, back) => put('sign', [tileOf(face), tileOf(back)]);
  const onRoad = (x, z) => network.isRoadClear && network.isRoadClear(x, z, 0.2);
  // on any street's pavement, curb to curb, by the real streets' centrelines and widths
  const onPavement = (x, z) => nearestRoads(x, z, 15).some((n) => n.dist < (n.road.w || 8) / 2 + 0.4);
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  // out from the road along e's right until clear of it (null if it never is)
  // the lights hung from span wires, in 50 m cells
  const spanCells = new Map();
  for (let i = 0; i + 1 < SPAN_WIRES.length; i += 2) {
    const k = Math.floor(SPAN_WIRES[i] / 50) + ',' + Math.floor(SPAN_WIRES[i + 1] / 50);
    if (!spanCells.has(k)) spanCells.set(k, []);
    spanCells.get(k).push(SPAN_WIRES[i], SPAN_WIRES[i + 1]);
  }
  const spanAt = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = spanCells.get((Math.floor(x / 50) + a) + ',' + (Math.floor(z / 50) + b));
      if (l) for (let i = 0; i < l.length; i += 2) if (Math.hypot(l[i] - x, l[i + 1] - z) < 25) return true;
    }
    return false;
  };
  let spans = 0;
  const curbside = (e, s, o, tries = 10) => {
    for (let k = 0; k < tries; k++, o += 0.6) {
      const [x, z] = at(e, s, o);
      if (!onRoad(x, z)) return [x, z, o];
    }
    return null;
  };

  let lights = 0, noSpot = 0;
  let signs = 0;
  const obstacles = []; // signal poles and sign posts, solid to the player: { x, z, r }
  const faceYaw = (e) => Math.atan2(-e.dx, -e.dz); // a face turned towards the drivers coming along e
  // ONE WAY signs where a one-way street leaves an intersection: a post at each corner (near right, far left), the
  // sign along the street with its arrow pointing the way traffic goes, for the cross street's drivers to read
  const nextOf = new Map(); // node -> the nodes an edge runs to from it
  const degree = new Map(); // node -> the nodes it's joined to either way
  for (const e of network.edges) {
    if (!nextOf.has(e.from)) nextOf.set(e.from, new Set());
    nextOf.get(e.from).add(e.to);
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!degree.has(a)) degree.set(a, new Set());
      degree.get(a).add(b);
    }
  }
  let oneWaySigns = 0;
  const oneWayPost = (e, s, o) => {
    const [px, pz] = at(e, s, o);
    if (onRoad(px, pz)) return;
    const g = groundHeight(px, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(px, g + 1.25, pz);
    dummy.scale.set(0.05, 2.5, 0.05);
    obstacles.push(standing = { x: px, z: pz, r: 0.1, kind: 'sign', height: 2.5, parts: [] });
    put('post');
    dummy.rotation.set(0, Math.atan2(-e.dz, e.dx), 0);
    dummy.position.set(px, g + 2.3, pz);
    dummy.scale.set(0.92, 0.31, 1);
    sign('oneWay', 'oneWayBack');
    oneWaySigns++;
  };
  for (const e of network.edges) {
    const n = e.from;
    if (n.shape || e.divided || !e.lanes.length || e.len < 25 || (e.cls ?? 4) < 2) continue;
    if (nextOf.get(e.to)?.has(e.from) || (degree.get(n)?.size || 0) < 3) continue;
    // set back from the corner past the cross street's pavement, out past the curb on each side: the first spot
    // along the street that's off every street's pavement (the cross street's included)
    for (const side of [1, -1]) {
      let placed = false;
      for (let s = 3; s <= Math.min(18, e.len - 4) && !placed; s += 1) {
        for (let out = 0.7; out <= 3.2 && !placed; out += 0.5) {
          const o = side * (e.half + out);
          const [x, z] = at(e, s, o);
          if (onRoad(x, z) || onPavement(x, z)) continue;
          oneWayPost(e, s, o);
          placed = true;
        }
      }
    }
  }

  // SPEED LIMIT signs, about where Ann Arbor puts them: on the right just past an intersection where the limit
  // changes or a street begins (every main road; about half the side streets turned into off a bigger road), and
  // again along the way, about every half mile on main roads and every third of a mile on collectors. Each edge runs
  // one way, so each direction gets its own; a sign is left out where one for that limit and direction stands near.
  const limits = new Map(); // mph -> how many
  const placed = new Map(); // 300 m cell -> [{ x, z, dx, dz, mph }]
  const cellKey = (x, z) => `${Math.floor(x / 300)},${Math.floor(z / 300)}`;
  const near = (x, z, dx, dz, mph, gap) => {
    const cx = Math.floor(x / 300), cz = Math.floor(z / 300), reach = Math.ceil(gap / 300);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      for (const p of placed.get(`${cx + i},${cz + j}`) || []) {
        if (p.mph === mph && p.dx * dx + p.dz * dz > 0.6 && (p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap) return true;
      }
    }
    return false;
  };
  const chance = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
  const limitPost = (e, s, mph, gap) => {
    const spot = curbside(e, s, e.half + 0.7);
    if (!spot) return false;
    const [px, pz] = spot;
    if (near(px, pz, e.dx, e.dz, mph, gap)) return false;
    const key = cellKey(px, pz);
    if (!placed.has(key)) placed.set(key, []);
    placed.get(key).push({ x: px, z: pz, dx: e.dx, dz: e.dz, mph });
    const g = groundHeight(px, pz);
    dummy.rotation.set(0, faceYaw(e), 0);
    dummy.position.set(px, g + 1.2, pz);
    dummy.scale.set(0.05, 2.4, 0.05);
    obstacles.push(standing = { x: px, z: pz, r: 0.1, kind: 'sign', height: 2.4, parts: [] });
    put('post');
    dummy.position.set(px, g + 2.0, pz);
    dummy.scale.set(0.61, 0.76, 1);
    sign('limit' + mph, 'limitBack');
    limits.set(mph, (limits.get(mph) || 0) + 1);
    return true;
  };
  // where the limit changes or the street begins
  for (const e of network.edges) {
    if (!e.general || !e.lanes.length || (e.cls ?? 4) > 4 || e.len < 24) continue;
    const mph = postedMph(e);
    const ahead = (e.from.in || []).filter((p) => p.general && p.dx * e.dx + p.dz * e.dz > 0.7);
    if (ahead.some((p) => postedMph(p) === mph)) continue;
    const begins = !ahead.length;
    const cls = e.cls ?? 4;
    if (cls >= 4 && begins) {
      const offBigger = (e.from.in || []).some((p) => (p.cls ?? 4) < cls);
      if (!offBigger || chance(e.sx, e.sz) > 0.5) continue;
    }
    limitPost(e, Math.min(30, e.len * 0.5), mph, 150);
  }
  // and repeated along the way
  for (const e of network.edges) {
    const cls = e.cls ?? 4;
    if (!e.general || !e.lanes.length || cls >= 4 || e.len < 40) continue;
    const gap = cls <= 2 ? 800 : 550;
    for (let s = 20; s < e.len - 15; s += 60) limitPost(e, s, postedMph(e), gap);
  }
  // Lamp: a TRAFFIC SAFETY CORRIDOR sign on the right where each of the three corridors begins, both ways in
  // (safety-corridors.js)
  let corridorSigns = 0;
  for (const c of corridorsOf(network)) {
    for (const end of [c.a, c.b]) {
      const other = end === c.a ? c.b : c.a;
      // the corridor's first road in from this end (heading toward the other end), and a spot at its curb
      let e = null, best = 250;
      for (const f of c.edges) {
        const d = Math.hypot(f.sx - end.x, f.sz - end.z);
        if (d < best && f.dx * (other.x - end.x) + f.dz * (other.z - end.z) > 0) { best = d; e = f; }
      }
      let spot = null;
      for (let s = Math.min(30, e ? e.len * 0.5 : 0); e && !spot && s < e.len; s += 15) spot = curbside(e, s, e.half + 0.7);
      // (out where nothing marks the road's edge, no curb nor block, just past the roadway's own edge)
      if (!spot && e) spot = at(e, Math.min(30, e.len * 0.5), e.half + 1.4);
      if (!spot) { log(`[safety corridor] no sign at ${c.name}'s end (${Math.round(end.x)}, ${Math.round(end.z)}): ${e ? `${e.street} ${Math.round(e.len)} m, no curb` : `no road in (nearest ${Math.round(Math.min(...c.edges.map((f) => Math.hypot(f.sx - end.x, f.sz - end.z))))} m)`}`); continue; }
      const [px, pz] = spot;
      const g = groundHeight(px, pz);
      dummy.rotation.set(0, faceYaw(e), 0);
      dummy.position.set(px, g + 1.2, pz);
      dummy.scale.set(0.05, 2.4, 0.05);
      obstacles.push(standing = { x: px, z: pz, r: 0.1, kind: 'sign', height: 2.4, parts: [] });
      put('post');
      dummy.position.set(px, g + 2.0, pz);
      dummy.scale.set(0.61, 0.76, 1);
      sign('corridor', 'limitBack');
      corridorSigns++;
    }
  }
  standing = null;

  for (const e of network.edges) {
    const n = e.to;
    if (n.shape || !e.lanes.length) continue;
    if (n.signal) {
      // the far side: across the intersection from the stop line
      const k = (n.x - (e.sx + e.dx * e.len)) * e.dx + (n.z - (e.sz + e.dz * e.len)) * e.dz;
      // Lamp: at a wide junction (a flared corner, a turn lane, a slip road) the curb can lie further out or further
      // on than 6 m past the roadway's edge: look up to 12 m out and 12 m on before giving the approach up (Plymouth at
      // Huron Pkwy, Platt at Ellsworth, Liberty at Stadium had their lights in the data and no poles)
      let s = e.len + Math.max(4, 2 * k + 1.5), spot = null;
      for (const on of [0, 3, 6, 9, 12]) if ((spot = curbside(e, s + on, e.half + 0.9, 20))) { s += on; break; }
      // else on the near side, at the corner before the stop line, as some of the town's are
      for (const back of [2, 5, 8]) if (!spot && (spot = curbside(e, e.len - back, e.half + 0.9, 20))) s = e.len - back;
      // and where nothing past the roadway's edge counts as a curb (the open land by the outer arterials' junctions,
      // which is no town block), 1.5 m off the far edge where that's off every street
      if (!spot) {
        const o = e.half + 1.5, [x, z] = at(e, s, o);
        if (!nearestRoads(x, z, 30).some((r) => r.dist < (r.road.w || 0) / 2 + 0.6)) spot = [x, z, o];
      }
      if (!spot) { if (noSpot++ < 12) log(`[traffic controls] no pole for the light at (${Math.round(n.x)}, ${Math.round(n.z)}) coming ${e.street || ''} ${Math.round(e.dx * 100) / 100},${Math.round(e.dz * 100) / 100}, half ${e.half}`); continue; }
      const [px, pz, po] = spot;
      const g = groundHeight(px, pz);
      // Lamp: on the state's routes outside downtown (span-wire-data.js) the lights hang from a wire strung across the
      // far side between a steel pole on each corner, a box of wires over the junction, as MDOT hangs them
      if (spanAt(n.x, n.z)) {
        let left = null;
        for (let o = -(e.half + 0.9), k = 0; k < 20 && !left; k++, o -= 0.6) {
          const [x, z] = at(e, s, o);
          if (!onRoad(x, z)) left = [x, z, o];
        }
        if (!left) { const o = -(e.half + 1.5), [x, z] = at(e, s, o); left = [x, z, o]; }
        const WIRE_Y = ARM_Y + 0.9, SAG = 0.55;
        for (const [x, z] of [[px, pz], [left[0], left[1]]]) {
          const gg = groundHeight(x, z);
          dummy.rotation.set(0, 0, 0);
          dummy.position.set(x, gg + WIRE_Y / 2 + 0.1, z);
          dummy.scale.set(0.2, WIRE_Y + 0.3, 0.2);
          obstacles.push(standing = { x, z, r: 0.2, kind: 'signal', height: WIRE_Y, parts: [] });
          put('pole');
        }
        // the wire, sagging to its middle in two straight runs
        const mid = (po + left[2]) / 2, [mx, mz] = at(e, s, mid), gm = groundHeight(mx, mz);
        for (const [o0, y0] of [[po, groundHeight(px, pz)], [left[2], groundHeight(left[0], left[1])]]) {
          const [x0, z0] = at(e, s, o0), ya = y0 + WIRE_Y, yb = gm + WIRE_Y - SAG, len = Math.hypot(Math.abs(o0 - mid), ya - yb);
          dummy.position.set((x0 + mx) / 2, (ya + yb) / 2, (z0 + mz) / 2);
          dummy.scale.set(0.035, 0.035, len);
          dummy.rotation.set(0, Math.atan2(e.rx, e.rz), 0);
          dummy.rotateX(Math.atan2(ya - yb, Math.abs(o0 - mid)) * (o0 > mid ? -1 : 1));
          put('arm');
        }
        standing.arm = { x: mx, z: mz, y: WIRE_Y - SAG + 0.04 };
        for (const o of e.lanes.slice().sort((a, b) => a - b).slice(-4)) {
          const [hx, hz] = at(e, s, o);
          dummy.rotation.set(0, faceYaw(e), 0); // (Lamp: its lamps toward the drivers coming along e, not away from them)
          dummy.position.set(hx, groundHeight(hx, hz) + HEAD_Y + 0.35, hz);
          dummy.scale.set(1, 1, 1);
          put('head');
          put('lamps', e.axisIndex === 0 ? 0 : 1);
          lights++;
        }
        spans++;
        continue;
      }
      dummy.rotation.set(0, Math.atan2(e.dx, e.dz), 0);
      dummy.position.set(px, g + ARM_Y / 2 + 0.1, pz);
      dummy.scale.set(0.15, ARM_Y + 0.3, 0.15);
      obstacles.push(standing = { x: px, z: pz, r: 0.16, kind: 'signal', height: ARM_Y, parts: [] });
      put('pole');
      // the arm out over the lanes coming up to it
      const reach = Math.min(16, Math.max(3, po - Math.min(...e.lanes) + 1.2));
      const [ax, az] = at(e, s, po - reach / 2);
      dummy.position.set(ax, g + ARM_Y, az);
      dummy.scale.set(0.12, 0.12, reach);
      dummy.rotation.set(0, Math.atan2(e.rx, e.rz), 0);
      put('arm');
      // its arm's far end and its top over the ground, what birds perch along (city-birds.js)
      const [ex, ez] = at(e, s, po - reach);
      standing.arm = { x: ex, z: ez, y: ARM_Y + 0.06 };
      const lanes = e.lanes.slice().sort((a, b) => a - b).slice(-4);
      for (const o of lanes) {
        if (po - o > reach) continue;
        const [hx, hz] = at(e, s, o);
        dummy.rotation.set(0, faceYaw(e), 0); // (Lamp: its lamps toward the drivers coming along e, not away from them)
        dummy.position.set(hx, groundHeight(hx, hz) + HEAD_Y, hz);
        dummy.scale.set(1, 1, 1);
        put('head');
        put('lamps', e.axisIndex === 0 ? 0 : 1);
        lights++;
      }
    } else if (e.control) {
      const spot = curbside(e, e.len - 0.4, e.half + 0.7);
      if (!spot) continue;
      const [px, pz] = spot;
      const g = groundHeight(px, pz);
      dummy.rotation.set(0, faceYaw(e), 0);
      dummy.position.set(px, g + 1.15, pz);
      dummy.scale.set(0.05, 2.3, 0.05);
      obstacles.push(standing = { x: px, z: pz, r: 0.1, kind: 'sign', height: 2.3, parts: [] });
      put('post');
      dummy.position.set(px, g + 2.1, pz);
      dummy.scale.set(0.76, 0.76, 1);
      const yieldSign = e.control === 'yield';
      sign(yieldSign ? 'yield' : 'stop', yieldSign ? 'yieldBack' : 'stopBack');
      if (!yieldSign && n.allStop) {
        dummy.position.set(px, g + 1.6, pz);
        dummy.scale.set(0.46, 0.46, 1);
        sign('plaque', 'plaqueBack');
      }
      signs++;
    }
  }

  // Meshes
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.7 });
  // Ann Arbor's signal heads are traffic yellow, their visors too, on a black backplate (vertex colours)
  const housing = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide });
  const tinted = (g, hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  const YELLOW = 0xd9a91f, BLACKPLATE = 0x1b1d1f;
  const W = 0.4, H = 1.12, D = 0.28, R = 0.145, LY = [0.36, 0, -0.36];
  const headGeo = mergeGeometries([
    tinted(new THREE.BoxGeometry(W, H, D), YELLOW),
    tinted(new THREE.BoxGeometry(0.07, ARM_Y - HEAD_Y - H / 2, 0.07).translate(0, (ARM_Y - HEAD_Y + H / 2) / 2, 0), YELLOW),
    tinted(new THREE.BoxGeometry(W + 0.24, H + 0.2, 0.02).translate(0, 0, -D / 2 - 0.01), BLACKPLATE), // backplate
    ...LY.map((ly) => tinted(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2).translate(0, ly, D / 2 + 0.12), YELLOW))
  ]);
  // one lamp each: red on top, amber, green at the bottom, facing the drivers coming up to the head
  const lampGeo = mergeGeometries(LY.map((ly, i) => {
    const g = new THREE.CircleGeometry(R, 20).translate(0, ly, D / 2 + 0.004);
    g.setAttribute('lamp', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(i), 1));
    return g;
  }));
  // a sign's face stands just in front of its post (5 cm round), bolted to it from behind, so the post shows only
  // behind the sign and above and below it; its back (attribute `side` 1) just behind the face
  const sided = (g, side) => g.setAttribute('side', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(side), 1));
  const signGeo = mergeGeometries([
    sided(new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.07), 0),
    sided(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).translate(0, 0, 0.06), 1)
  ]);
  // the pictures: each face, and the backs (bare grey metal cut to the sign's shape; the ONE WAY sign's back is printed)
  const BACK = '#9a9ea2';
  const fill = (shape) => (ctx) => { shape(ctx); ctx.fillStyle = BACK; ctx.fill(); };
  const plaqueShape = (ctx) => { ctx.beginPath(); ctx.rect(0, 64, 256, 128); };
  const pictures = {
    stop: [stopFace, 256], yield: [yieldFace, 256], plaque: [plaqueFace, 256],
    stopBack: [fill((ctx) => octagon(ctx, 126)), 256], yieldBack: [fill((ctx) => triangle(ctx, 140)), 256],
    plaqueBack: [fill(plaqueShape), 256],
    oneWay: [oneWayFace(false), 86, true], oneWayBack: [oneWayFace(true), 86, true],
    limitBack: [(ctx) => { ctx.fillStyle = BACK; ctx.fillRect(0, 0, 256, 320); }, 320, true],
    corridor: [corridorFace, 320, true],
    ...Object.fromEntries([...limits.keys()].map((mph) => ['limit' + mph, [limitFace(mph), 320, true]]))
  };
  const rows = Math.max(1, Math.ceil(tiles.size / COLS));
  const atlasW = COLS * (TILE_W + 2 * PAD), atlasH = rows * (TILE_H + 2 * PAD);
  const atlas = document.createElement('canvas');
  atlas.width = atlasW;
  atlas.height = atlasH;
  const actx = atlas.getContext('2d');
  for (const [name, t] of tiles) {
    const [draw, h, opaque] = pictures[name];
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = h;
    draw(c.getContext('2d'));
    const x = (t % COLS) * (TILE_W + 2 * PAD), y = Math.floor(t / COLS) * (TILE_H + 2 * PAD);
    // (an edge-to-edge picture carried out into its gutter, so its edges stay put as the far mip levels blur)
    if (opaque) actx.drawImage(c, x, y, TILE_W + 2 * PAD, TILE_H + 2 * PAD);
    actx.drawImage(c, x + PAD, y + PAD, TILE_W, TILE_H);
  }
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  const signMat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.5 });
  {
    const side = attribute('side', 'float'), pics = attribute('tile', 'vec2');
    const t = mix(pics.x, pics.y, side);
    const row = floor(t.add(0.5).div(COLS)), col = t.sub(row.mul(COLS));
    const p = uv();
    const u = col.mul(TILE_W + 2 * PAD).add(PAD).add(p.x.mul(TILE_W)).div(atlasW);
    const v = float(1).sub(row.mul(TILE_H + 2 * PAD).add(PAD).add(float(1).sub(p.y).mul(TILE_H)).div(atlasH));
    signMat.colorNode = texture(atlasTex, vec2(u, v));
    // the grey backs are bare metal; the faces (and the printed ONE WAY back) aren't
    const printed = tiles.has('oneWayBack') ? step(abs(t.sub(tiles.get('oneWayBack'))), 0.25) : float(0);
    signMat.metalnessNode = side.mul(float(1).sub(printed)).mul(0.5);
    signMat.roughnessNode = mix(float(0.5), float(0.6), side);
  }
  const kinds = {
    metal: [new THREE.CylinderGeometry(1, 1, 1, 8), metal, true],
    head: [headGeo, housing, false],
    lamps: [lampGeo, lampMaterial(), false, 'road', 1],
    // (no shadows from the plates: the shadow pass doesn't read the atlas's cut-outs)
    sign: [signGeo, signMat, false, 'tile', 2]
  };
  const meshOf = new Map();
  for (const [name, matrices] of lists) {
    const [geo0, mat, shadow, attr, size] = kinds[name];
    const geo = attr ? geo0.clone() : geo0;
    if (attr) geo.setAttribute(attr, new THREE.InstancedBufferAttribute(new Float32Array(extra.get(name)), size));
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    meshOf.set(name, inst);
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadow;
    inst.userData.cullDistance = name === 'sign' ? 320 : 550;
    inst.name = 'TrafficControls_' + name;
    group.add(inst);
  }
  // each pole's and post's pieces as [mesh, instance, ...] (knockdowns.js)
  for (const o of obstacles) {
    const parts = [];
    for (let k = 0; k < o.parts.length; k += 2) parts.push(meshOf.get(o.parts[k]), o.parts[k + 1]);
    o.parts = parts;
  }
  group.userData.terrain = 'set'; // each was stood on the ground as it was placed
  log(`[traffic controls] ${lights} signal heads (${spans} approaches on span wires, ${noSpot} signalised approaches with no curb for a pole), ${signs} stop & yield signs, ${oneWaySigns} one-way signs, `
    + `${[...limits.values()].reduce((a, b) => a + b, 0)} speed limit signs, ${corridorSigns} safety corridor signs (${[...limits].sort((a, b) => a[0] - b[0]).map(([m, n]) => `${n} at ${m}`).join(', ')})`);
  const [onMain, onCross] = kinds.lamps[1].userData.on;
  const lit = (u, phase) => u.value.set(phase === 'red' ? 1 : 0, phase === 'amber' ? 1 : 0, phase === 'green' ? 1 : 0);
  const update = (time) => {
    lit(onMain, signalPhase(time, true));
    lit(onCross, signalPhase(time, false));
  };
  return { lights, signs, update, obstacles };
}

export { buildTrafficControls };
