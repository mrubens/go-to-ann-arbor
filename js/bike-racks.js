import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { MOTO_SPECS, buildMotoGeometry, createMotoMaterial } from './motorcycles.js';

// Lamp: Ann Arbor's bike racks where OpenStreetMap has them (data/bike-racks.json, Assets/Tools/build-bike-racks.py),
// each a row of galvanized inverted-U stands with bicycles locked to some of them, and the e-bike docks by the Diag: a
// row of dock posts with a fleet of e-bikes and a kiosk under a little solar panel at one end. The stands and docks
// are all drawn; the bikes only within REACH of the camera. On foot, F beside a bike borrows it (`nearest`, `take`:
// controllers.js enterOrExit, main.js getInOrOut), and it's gone from its stand for the rest of the visit.

const REACH = 220;
const SHOWN = 240;
const STAND_GAP = 0.85, DOCK_GAP = 1.0;
const FLEET = 0x3d5a80; // the docks' e-bikes, plain muted blue
const BIKE_PAINTS = MOTO_SPECS.bicycle.paints;

const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };

// one stand: a bent tube, an inverted U across local x, on the ground at the origin
function standGeometry() {
  const parts = [], r = 0.025, w = 0.34, h = 0.84;
  const tube = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.CylinderGeometry(r, r, len, 6, 1, true);
    g.rotateZ(-Math.atan2(x1 - x0, y1 - y0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    parts.push(g);
  };
  tube(-w, 0, -w, h - 0.12);
  tube(w, 0, w, h - 0.12);
  // the bend over the top, in four pieces
  let px = -w, py = h - 0.12;
  for (let k = 1; k <= 4; k++) {
    const a = Math.PI - (k / 4) * Math.PI, x = Math.cos(a) * w, y = h - 0.12 + Math.sin(a) * 0.12;
    tube(px, py, x, y);
    px = x; py = y;
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// one dock post: a dark pillar with a lit band near its top, its face toward local +x where the bike's wheel goes in
function dockGeometry() {
  const post = new THREE.BoxGeometry(0.22, 0.95, 0.3).translate(0, 0.475, 0);
  const cap = new THREE.BoxGeometry(0.26, 0.06, 0.34).translate(0, 0.98, 0);
  const lock = new THREE.BoxGeometry(0.16, 0.14, 0.16).translate(0.17, 0.46, 0);
  return mergeGeometries([post, cap, lock].map((g) => g.toNonIndexed()));
}

function createBikeRacks(group, data) {
  group.name = 'BikeRacks';
  const list = data?.racks || [];
  const racks = [];
  let standCount = 0, dockCount = 0;
  for (let i = 0; i + 4 < list.length; i += 5) {
    const [x, z, yaw, n, kind] = list.slice(i, i + 5);
    const dock = kind === 1;
    racks.push({ x, z, yaw, n, dock, g: groundHeight(x, z) });
    if (dock) dockCount += n; else standCount += n;
  }

  // the stands and dock posts, every one in town (one draw each)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x9ea4a9, metalness: 0.7, roughness: 0.38 });
  const stands = new THREE.InstancedMesh(standGeometry(), steel, Math.max(1, standCount));
  const docks = new THREE.InstancedMesh(dockGeometry(), new THREE.MeshStandardNodeMaterial({ color: 0x2c3238, metalness: 0.3, roughness: 0.55 }), Math.max(1, dockCount));
  stands.castShadow = docks.castShadow = true;
  stands.receiveShadow = docks.receiveShadow = true;
  let si = 0, di = 0;
  // each rack's slots: where a bike would stand, its heading, and whether one's there
  for (const [r, rack] of racks.entries()) {
    const gap = rack.dock ? DOCK_GAP : STAND_GAP;
    const sx = Math.sin(rack.yaw), sz = Math.cos(rack.yaw);
    rack.slots = [];
    for (let k = 0; k < rack.n; k++) {
      const u = (k - (rack.n - 1) / 2) * gap, x = rack.x + sx * u, z = rack.z + sz * u, g = groundHeight(x, z);
      q.setFromAxisAngle(up, rack.yaw);
      m4.compose(pos.set(x, g - 0.02, z), q, one);
      if (rack.dock) {
        docks.setMatrixAt(di++, m4);
        // the e-bike in front of its post, its front wheel in the lock; most docks are full
        if (hash(r * 7.1 + k, 3.3) < 0.8) rack.slots.push({ x: x + sz * 0.95, z: z - sx * 0.95, yaw: rack.yaw - Math.PI / 2, kind: 'ebike', hex: FLEET, lean: 0 });
      } else {
        stands.setMatrixAt(si++, m4);
        // a bicycle locked to either side of the stand, now and then
        for (const side of [-1, 1]) {
          if (hash(r * 3.7 + k * 1.3, side) > 0.32) continue;
          const head = rack.yaw + Math.PI / 2 + (hash(r + k, side * 2.1) < 0.5 ? 0 : Math.PI);
          rack.slots.push({ x: x + sx * side * 0.24, z: z + sz * side * 0.24, yaw: head, kind: 'bicycle',
            hex: BIKE_PAINTS[Math.floor(hash(r * 1.9 + k, side * 5.3) * BIKE_PAINTS.length)], lean: side * 0.06 });
        }
      }
    }
  }
  stands.count = si;
  docks.count = di;
  stands.computeBoundingSphere();
  docks.computeBoundingSphere();
  group.add(stands, docks);

  // the docks' kiosks: a pillar with its screen and a solar panel on a mast, at the row's north or west end
  const kiosks = [];
  for (const rack of racks) {
    if (!rack.dock) continue;
    const sx = Math.sin(rack.yaw), sz = Math.cos(rack.yaw), u = -((rack.n - 1) / 2) * DOCK_GAP - 1.2;
    const x = rack.x + sx * u, z = rack.z + sz * u, g = groundHeight(x, z);
    const parts = [
      new THREE.BoxGeometry(0.55, 1.6, 0.4).translate(0, 0.8, 0),
      new THREE.BoxGeometry(0.06, 1.2, 0.06).translate(0, 2.2, 0),
      new THREE.BoxGeometry(1.1, 0.04, 0.7).rotateX(-0.35).translate(0, 2.82, 0)
    ].map((p) => p.rotateY(rack.yaw + Math.PI / 2).translate(x, g, z).toNonIndexed());
    kiosks.push(...parts);
    const screen = new THREE.BoxGeometry(0.4, 0.45, 0.02).translate(0, 1.2, 0.21).rotateY(rack.yaw + Math.PI / 2).translate(x, g, z);
    const lit = new THREE.Mesh(screen, new THREE.MeshStandardNodeMaterial({ color: 0x0d1a24, emissive: 0x2a6f8f, emissiveIntensity: 0.6, roughness: 0.2 }));
    group.add(lit);
  }
  if (kiosks.length) {
    const kiosk = new THREE.Mesh(mergeGeometries(kiosks), new THREE.MeshStandardNodeMaterial({ color: 0x3d5a80, metalness: 0.3, roughness: 0.5 }));
    kiosk.castShadow = true;
    group.add(kiosk);
  }

  // the bikes near the camera, bicycles and e-bikes, each its own paint
  const bikeMesh = (kind) => {
    const g = buildMotoGeometry(MOTO_SPECS[kind], true);
    g.setAttribute('paintColor', new THREE.InstancedBufferAttribute(new Float32Array(SHOWN * 3), 3));
    g.setAttribute('carState', new THREE.InstancedBufferAttribute(new Float32Array(SHOWN * 4), 4));
    const m = new THREE.InstancedMesh(g, createMotoMaterial(), SHOWN);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const meshes = { bicycle: bikeMesh('bicycle'), ebike: bikeMesh('ebike') };
  const paint = new THREE.Color();
  const taken = new Set();
  let regather = 0;
  const near = []; // racks within reach
  const shownSlots = [];

  function draw() {
    const n = { bicycle: 0, ebike: 0 };
    shownSlots.length = 0;
    for (const rack of near) {
      for (const s of rack.slots) {
        if (taken.has(s)) continue;
        const m = meshes[s.kind], i = n[s.kind];
        if (i >= SHOWN) continue;
        e.set(0, s.yaw, s.lean);
        q.setFromEuler(e);
        m4.compose(pos.set(s.x, groundHeight(s.x, s.z) + 0.02, s.z), q, one);
        m.setMatrixAt(i, m4);
        paint.setHex(s.hex);
        m.geometry.attributes.paintColor.setXYZ(i, paint.r, paint.g, paint.b);
        n[s.kind] = i + 1;
        shownSlots.push(s);
      }
    }
    for (const kind of Object.keys(meshes)) {
      const m = meshes[kind];
      m.count = n[kind];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.paintColor.needsUpdate = true;
    }
  }

  function update(dt, cam) {
    regather -= dt;
    if (regather > 0 || !cam) return;
    regather = 0.5;
    near.length = 0;
    for (const rack of racks) if (Math.abs(rack.x - cam.x) < REACH && Math.abs(rack.z - cam.z) < REACH) near.push(rack);
    near.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    draw();
  }

  // the bike nearest (x, z) within reach, scored by `facing` as the player's other choices are
  function nearest(x, z, reach, facing = () => 1) {
    let best = null, score = Infinity;
    for (const s of shownSlots) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d >= reach) continue;
      const sc = (d / reach) * facing(s.x, s.z);
      if (sc < score) { score = sc; best = s; }
    }
    return best ? { slot: best, x: best.x, z: best.z, yaw: best.yaw, d: Math.hypot(best.x - x, best.z - z) } : null;
  }

  // borrow it: gone from its stand, and its look for the player's ride
  function take(slot) {
    taken.add(slot);
    draw();
    return { kind: slot.kind, hex: slot.hex, style: 0 };
  }

  log(`[bike racks] ${racks.length - kiosks.length / 3} racks of ${si} stands, ${kiosks.length / 3} e-bike docks by the Diag`);
  return { update, nearest, take, count: racks.length };
}

async function buildBikeRacks(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/bike-racks.json')));
  } catch (error) { log(`[bike racks] no rack data: ${error}`); }
  return createBikeRacks(group, data);
}

export { buildBikeRacks };
