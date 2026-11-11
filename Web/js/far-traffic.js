// Lamp: far traffic on the main roads. As the freeways' far fleet (traffic.js createHighwayTraffic) fills US-23, I-94
// and M-14 beyond the near traffic's reach, this fills the town's arterials (OpenStreetMap's primary and secondary
// roads: Washtenaw, Stadium, Main, State, Plymouth, Packard, Huron, Fuller and Geddes and the like) with cheap cars
// driving their lanes, seen from the helicopter or across town: the traffic's ~250-triangle stand-ins in three body
// shapes (one instanced draw each, the traffic's own cached material) and, at dusk and night, a white flare at the
// front and a red one at the back of each (one draw).
//
// They don't think: each lane's cars run round it at the street's limit a fixed gap apart (from where they started and
// the clock), sinking under the road over the last metres of a lane's end and coming up at its start, so none appears
// or vanishes on the road. Only the hour's share of them is out (town-clock.js trafficShare, as the near fleet's), a
// car coming or going only where it isn't drawn. None is drawn within the near traffic's radius of the player
// (VEHICLE_RADIUS), and over the HIDE_BAND beyond it they grow from nothing, so the hand-over doesn't pop.
//
// The tier: full and light every arterial, light a little sparser; slow sparser still and nearer; none on a phone or
// the Xbox.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BODY_SPECS, CAR_PARTS, buildCarProxyGeometry, createLoftedCarMaterial, annArborCar } from './cars.js';
import { cityUniforms, createCarFlareMaterial } from './tsl-materials.js';
import { groundHeight } from './terrain.js';
import { TIER } from './device-tier.js';
import { log } from '../lamp-game.js';

const LEVELS = {
  full: { gap: 70, far: 5000 },
  light: { gap: 90, far: 4000 },
  slow: { gap: 180, far: 2400 },
  phone: null
};
const KINDS = ['sedan', 'suv', 'pickup'];
const HIDE_BAND = 60; // metres past the near traffic's reach over which a car grows to full size
const SINK = 14; // metres at a lane's ends over which a car sinks under the road
const BOX_LOD = 700; // past this the stand-in is two boxes (24 triangles), body and glasshouse

// the farthest stand-in: the proxy's bounds as a painted body and a glazed cabin over it
function buildCarBoxGeometry(proxy) {
  proxy.computeBoundingBox();
  const b = proxy.boundingBox, H = b.max.y, W = b.max.x - b.min.x, len = b.max.z - b.min.z;
  const box = (w, h, d, y, z, id) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(0, y, z);
    g.setAttribute('partId', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
    return g;
  };
  return mergeGeometries([
    box(W, H * 0.5, len, 0.15 + H * 0.25, (b.min.z + b.max.z) / 2, CAR_PARTS.BODY),
    box(W * 0.86, H * 0.38, len * 0.5, H * 0.69, (b.min.z + b.max.z) / 2 - len * 0.05, CAR_PARTS.WINDOW)
  ]);
}

// The arterials' lanes: primary and secondary edges (cls 1, 2) that aren't freeway, chained straight on through their
// junctions, each lane of the chain a line of points 12 m apart on the ground
function arterialLanes(network) {
  const edges = (network?.edges || []).filter((e) => (e.cls ?? 4) >= 1 && (e.cls ?? 4) <= 2 && !e.freeway && e.lanes?.length && !e.closed);
  const set = new Set(edges);
  const next = new Map(), hasPrev = new Set();
  for (const e of edges) {
    let best = null, bestDot = 0.82;
    for (const m of e.moves || []) {
      const f = m.to;
      if (!set.has(f) || f === e) continue;
      // (not back the way it came, on a two-way street)
      if (Math.abs(f.sx + f.dx * f.len - e.sx) < 1 && Math.abs(f.sz + f.dz * f.len - e.sz) < 1) continue;
      const dot = e.dx * f.dx + e.dz * f.dz;
      if (dot > bestDot) { bestDot = dot; best = f; }
    }
    if (best && !hasPrev.has(best)) { next.set(e, best); hasPrev.add(best); }
  }
  const used = new Set(), chains = [];
  const follow = (e) => {
    const chain = [];
    for (let f = e; f && !used.has(f); f = next.get(f)) { used.add(f); chain.push(f); }
    if (chain.length) chains.push(chain);
  };
  for (const e of edges) if (!hasPrev.has(e)) follow(e);
  for (const e of edges) follow(e);
  const lanes = [];
  let km = 0;
  for (const chain of chains) {
    let len = 0;
    for (const e of chain) len += e.len;
    if (len < 250) continue;
    const n = Math.min(...chain.map((e) => e.lanes.length));
    const mph = Math.max(25, Math.min(50, ...chain.map((e) => e.mph || 35)));
    for (let i = 0; i < n; i++) {
      const pts = [];
      for (const e of chain) {
        const o = e.lanes[e.lanes.length - n + i] ?? e.lanes[i];
        const k = Math.max(1, Math.ceil(e.len / 12));
        for (let j = 0; j <= k; j++) {
          const s = e.len * j / k, x = e.sx + e.dx * s + e.rx * o, z = e.sz + e.dz * s + e.rz * o;
          const last = pts[pts.length - 1];
          if (last && Math.hypot(last.x - x, last.z - z) < 1) continue;
          pts.push(x, groundHeight(x, z) + 0.05, z);
        }
      }
      if (pts.length < 9) continue;
      lanes.push({ pts, speed: mph * 0.447 * 0.92 });
      km += len / 1000;
    }
  }
  return { lanes, km };
}

/**
 * The far fleet on the arterials, built into `scene` from the traffic's road network: { group, update(dt, camera,
 * entity), setShare(s), stats() }. `hideNear` is the near traffic's radius round the player.
 */
function createFarArterials(scene, network, { hideNear = 360 } = {}) {
  const group = new THREE.Group();
  group.name = 'ArterialTraffic';
  scene.add(group);
  const level = TIER.name in LEVELS ? LEVELS[TIER.name] : LEVELS.light;
  const none = { group, update() {}, setShare() {}, stats: () => ({ cars: 0 }) };
  if (!level) return none;
  const { lanes, km } = arterialLanes(network);
  if (!lanes.length) return none;

  let seed = 7310991;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cars = [];
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const lane of lanes) {
    const P = lane.pts;
    const n = P.length / 3;
    lane.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) lane.cum[i] = lane.cum[i - 1] + Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
    lane.len = lane.cum[n - 1];
    for (let u = rand() * level.gap; u < lane.len - 6; u += level.gap * (0.55 + rand() * 0.9)) {
      const h = rand();
      const kind = h < 0.45 ? 'sedan' : h < 0.85 ? 'suv' : 'pickup';
      const entry = annArborCar(kind, Math.floor(rand() * 1000));
      const col = new THREE.Color(entry.hex);
      cars.push({ lane, kind, u0: u, u: u, seg: 0, rank: rand(), out: true, style: entry.style,
        col: [Math.fround(col.r), Math.fround(col.g), Math.fround(col.b)] });
      counts[kind]++;
    }
  }

  // per body shape: [the traffic's proxy, two boxes], instanced
  const meshes = {};
  const all = [];
  for (const kind of KINDS) {
    const spec = BODY_SPECS[kind];
    const n = Math.max(1, counts[kind]);
    const proxy = buildCarProxyGeometry(spec);
    meshes[kind] = [proxy, buildCarBoxGeometry(proxy)].map((geo, lod) => {
      geo.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
      const mesh = new THREE.InstancedMesh(geo, createLoftedCarMaterial(spec), n);
      mesh.name = lod ? 'ArterialCarBoxes' : 'ArterialCars';
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      all.push(mesh);
      return mesh;
    });
  }
  // the lamps at night: a flare at the front (both headlamps as one) and one at the back
  const flarePos = new Float32Array(cars.length * 2 * 4);
  const flareCol = new Float32Array(cars.length * 2 * 4);
  const flareGeo = new THREE.PlaneGeometry(1, 1);
  flareGeo.setAttribute('flarePos', new THREE.InstancedBufferAttribute(flarePos, 4));
  flareGeo.setAttribute('flareCol', new THREE.InstancedBufferAttribute(flareCol, 4));
  const flares = new THREE.Mesh(flareGeo, createCarFlareMaterial());
  flares.name = 'ArterialLampFlares';
  flares.frustumCulled = false;
  flares.visible = false;
  flares.renderOrder = 2;
  group.add(flares);
  log(`[far traffic] ${cars.length} cars on ${lanes.length} arterial lanes, ${Math.round(km)} km`);

  let share = 1;
  let clock = 0;
  let updates = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ'), fwd = new THREE.Vector3();
  const flag = (attr, n) => { attr.clearUpdateRanges(); attr.addUpdateRange(0, n * attr.itemSize); attr.needsUpdate = true; };
  const dirty = new Set();

  function update(dt, camera, entity) {
    clock += dt;
    const cam = camera.position;
    const nearX = entity ? entity.position.x : cam.x, nearZ = entity ? entity.position.z : cam.z;
    camera.getWorldDirection(fwd);
    for (const mesh of all) mesh.count = 0;
    const flaresOn = cityUniforms.uInteriorGlow.value > 0.65;
    const pxAt1m = (2 * Math.tan(((camera.fov || 55) * Math.PI) / 360)) / Math.max(360, window.innerHeight || 800);
    // (from the helicopter, higher up, out further: twice as far from about 450 m up)
    const far = level.far * (1 + Math.min(1, Math.max(0, cam.y - 60) / 400));
    const far2 = far * far;
    const hide2 = hideNear * hideNear, band2 = (hideNear + HIDE_BAND) ** 2;
    let nf = 0;
    for (const c of cars) {
      const lane = c.lane, cum = lane.cum, P = lane.pts;
      let u = (c.u0 + clock * lane.speed) % lane.len;
      if (u < c.u) { c.seg = 0; c.out = c.rank < share; } // round to the lane's start, under the road
      c.u = u;
      if (!c.out) continue;
      while (c.seg < cum.length - 2 && cum[c.seg + 1] < u) c.seg++;
      const i = c.seg, segLen = cum[i + 1] - cum[i] || 1;
      const t = Math.min(1, Math.max(0, (u - cum[i]) / segLen));
      const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2], bx = P[i * 3 + 3], by = P[i * 3 + 4], bz = P[i * 3 + 5];
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const dx = x - cam.x, dz = z - cam.z;
      const fx = x - nearX, fz = z - nearZ, f2 = fx * fx + fz * fz;
      if (f2 < hide2) { c.out = c.rank < share; continue; }
      const dip = Math.min(u, lane.len - u);
      const y = ay + (by - ay) * t - 2.4 * (1 - Math.min(1, dip / SINK));
      const dy = y - cam.y;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > far2) { c.out = c.rank < share; continue; }
      if (dx * fwd.x + dz * fwd.z < -60 && d2 > 90000) continue; // well behind the camera
      const grow = f2 < band2 ? Math.min(1, (Math.sqrt(f2) - hideNear) / HIDE_BAND) : 1;
      const yaw = Math.atan2(bx - ax, bz - az);
      euler.set(-Math.atan((by - ay) / segLen), yaw, 0);
      q.setFromEuler(euler);
      m4.compose(pos.set(x, y, z), q, scl.set(grow, grow, grow));
      const mesh = meshes[c.kind][d2 < BOX_LOD * BOX_LOD ? 0 : 1];
      const slot = mesh.count++;
      m4.toArray(mesh.instanceMatrix.array, slot * 16);
      const paint = mesh.geometry.attributes.paintColor.array, o3 = slot * 3;
      if (paint[o3] !== c.col[0] || paint[o3 + 1] !== c.col[1] || paint[o3 + 2] !== c.col[2]) { paint.set(c.col, o3); dirty.add(mesh); }
      const state = mesh.geometry.attributes.carState.array, o4 = slot * 4;
      if (state[o4 + 3] !== c.style) { state[o4 + 3] = c.style; dirty.add(mesh); }
      if (!flaresOn || dip < 2 || grow < 1) continue;
      const d = Math.sqrt(d2);
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const facing = -(dx * sy + dz * cy) / d;
      const k = 1 / (1 + (d / 2500) ** 2);
      const size = Math.max(0.9, d * pxAt1m * 3.2);
      const spec = BODY_SPECS[c.kind];
      for (let e = 0; e < 2; e++) {
        const front = e === 0;
        const s = Math.max(0, Math.min(1, ((front ? facing : -facing) + 0.3) / 0.9));
        const w = k * (0.3 + 0.7 * s * s * (3 - 2 * s));
        const lz = front ? spec.zFront + 0.3 : spec.zRear - 0.3;
        const o = nf * 4;
        flarePos[o] = x + lz * sy;
        flarePos[o + 1] = y + (front ? spec.lamps[0] : spec.lamps[1]);
        flarePos[o + 2] = z + lz * cy;
        flarePos[o + 3] = size;
        if (front) { flareCol[o] = 1.9 * w; flareCol[o + 1] = 1.75 * w; flareCol[o + 2] = 1.5 * w; }
        else { flareCol[o] = 2.0 * w; flareCol[o + 1] = 0.1 * w; flareCol[o + 2] = 0.06 * w; }
        nf++;
      }
    }
    const hideEmpty = ++updates > 2;
    for (const mesh of all) {
      const n = mesh.count;
      mesh.visible = n > 0 || !hideEmpty;
      if (!n) continue;
      flag(mesh.instanceMatrix, n);
      if (dirty.has(mesh)) { flag(mesh.geometry.attributes.paintColor, n); flag(mesh.geometry.attributes.carState, n); }
    }
    dirty.clear();
    flares.visible = nf > 0;
    flares.count = nf;
    if (nf) { flag(flareGeo.attributes.flarePos, nf); flag(flareGeo.attributes.flareCol, nf); }
  }
  function setShare(s) { share = Math.max(0, Math.min(1, s)); }
  const stats = () => ({ cars: cars.length, lanes: lanes.length, drawn: all.reduce((a, m) => a + m.count, 0) });
  return { group, update, setShare, stats };
}

export { createFarArterials, arterialLanes };
