// The Gallup Park canoe livery, on the Huron's north bank by Fuller Road: its boardwalk along the shore and the finger
// docks off it (laid where OpenStreetMap has them), racks of canoes and kayaks beside the boathouse, a row of rental
// kayaks pulled up on the bank and pedal boats tied along the docks. Walk up to a kayak or a pedal boat and get in (the
// same key as a car): the player's boat becomes that one, there, and its spot stands empty until another is taken.
// Out on the water, a few people pedal and paddle about the pond.
//
// Everything is drawn smooth: planks laid one by one, round pilings, hulls of curved surfaces, a rub rail round each
// pedal boat. The docked and the moving boats are instanced, one draw for each part.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { groundHeight, riverDepth, riverbedHeight, nearestWater, waterLevel } from './terrain.js';
import { kayakGeometry, paddleGeometry } from './river-people.js';
import { pierPush } from './river.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';

// the boathouse (OSM way 292066180) and its docks (ways 458993137-458993144), in metres east and south of Main & Liberty
const LIVERY = { x: 3986, z: 306 };
const BOARDWALK = [[4002.5, 321.8], [4003.8, 327.3], [4001.1, 327.8], [3982.8, 331.6], [3971.7, 326.4], [3959.2, 312.7],
  [3954.6, 307.8], [3951.2, 304.1], [3947.6, 300.1], [3946.2, 298.6], [3952.3, 292.4]];
const FINGERS = [[[3953.7, 315.5], [3950.6, 318.3], [3948.5, 320.2]], [[3950.6, 318.3], [3947.4, 314.6]],
  [[3954.6, 307.8], [3947.4, 314.6], [3946.4, 315.6]], [[3951.2, 304.1], [3942.6, 311.6]], [[3947.6, 300.1], [3939.1, 307.5]],
  [[4001.1, 327.8], [4002.7, 336.0], [4003.4, 339.5]], [[4002.7, 336.0], [3995.6, 337.3]]];
const NPC_PEDAL = 4, NPC_KAYAK = 3, RANGE = 260; // out on the water, kept within this of the livery
const HULLS = [0xf4f1ea, 0x2f7fd0, 0xf2c230, 0x3fae5a, 0xe0533a, 0xf4f1ea, 0x1fa3a0, 0xee7a2a];
const KAYAK_COLORS = [0xd9342b, 0xf2b705, 0x1f6fb2, 0x2f9e55, 0xee6a1f, 0x16a6a6];

// A point of a unit sphere pushed out towards the box round it (a superellipsoid): rounded, flat-sided, like a moulded hull
const squircle = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// A pedal boat, moulded in one piece: a broad rounded hull with a little bow, a gunwale with a rub rail round it, a seat
// well with two bucket seats, the pedals and the steering lever between them, and the paddle wheel's cover at the stern.
// Its waterline is y = 0, +z forward. Every part indexed, with positions and normals only.
function pedalBoatGeometry() {
  const W = 0.8, Lh = 1.35;
  const plan = (x, z) => [x * (1 - 0.22 * Math.max(0, z) ** 2), z]; // narrowing towards the bow
  const shell = (top, height, y0) => {
    const g = new THREE.SphereGeometry(1, 48, 10, 0, Math.PI * 2, top ? 0 : Math.PI / 2, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = squircle(p.getX(i), 0.45), z = squircle(p.getZ(i), 0.55), y = squircle(p.getY(i), top ? 0.6 : 0.75);
      const [px, pz] = plan(x * W, z);
      p.setXYZ(i, px, y * height + y0 + 0.05 * Math.max(0, z) ** 3, pz * Lh);
    }
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  };
  const hull = shell(false, 0.3, 0.1);
  const deck = shell(true, 0.12, 0.1);
  // the rub rail, a round tube round the gunwale
  const ring = [];
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    const [px, pz] = plan(squircle(Math.sin(a), 0.45) * W, squircle(Math.cos(a), 0.55));
    ring.push(new THREE.Vector3(px * 1.01, 0.11, pz * Lh * 1.01));
  }
  const rail = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 120, 0.035, 8, true);
  // the seat well and seats
  const box = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 4, r);
  const seats = [box(1.22, 0.16, 1.05, 0.07).translate(0, 0.17, -0.1)];
  for (const s of [-1, 1]) {
    seats.push(box(0.5, 0.12, 0.46, 0.05).translate(s * 0.32, 0.3, -0.28));
    seats.push(box(0.5, 0.52, 0.1, 0.05).rotateX(-0.22).translate(s * 0.32, 0.6, -0.52));
    // the pedals' housing, out ahead of each seat
    seats.push(box(0.26, 0.2, 0.3, 0.06).translate(s * 0.32, 0.3, 0.55));
  }
  // the paddle wheel's cover: half a drum across the stern, with an end plate to each side
  const cover = new THREE.CylinderGeometry(0.38, 0.38, 0.9, 32, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0.14, -1.0);
  const trim = [rail, cover];
  for (const s of [-1, 1]) trim.push(new THREE.CircleGeometry(0.38, 32, 0, Math.PI).rotateY(s * Math.PI / 2).rotateX(0).translate(s * 0.45, 0.14, -1.0));
  // the steering lever, a slim rod with a ball on top, between the seats
  trim.push(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 12).rotateX(0.25).translate(0, 0.42, 0.18));
  trim.push(new THREE.SphereGeometry(0.045, 14, 10).translate(0, 0.63, 0.23));
  const clean = (list) => mergeGeometries(list.map((g) => {
    if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  }));
  return { hull: clean([hull, deck]), seats: clean(seats), trim: clean(trim), wheel: paddleWheelGeometry() };
}
// the paddle wheel under its cover, turning about its axle (+X)
function paddleWheelGeometry() {
  const parts = [new THREE.CylinderGeometry(0.05, 0.05, 0.8, 16).rotateZ(Math.PI / 2)];
  for (let k = 0; k < 8; k++) parts.push(new RoundedBoxGeometry(0.74, 0.3, 0.025, 2, 0.01).translate(0, 0.2, 0).rotateX((k / 8) * Math.PI * 2));
  // the rounded paddles come unindexed and the axle indexed: give every part an index, as a merge needs
  return mergeGeometries(parts.map((g) => {
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  }));
}

// A canoe, upside down on a rack: a long open hull, its sheer rising to the bow and stern
function canoeGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.abs(p.getZ(i));
    p.setXYZ(i, p.getX(i) * 0.44 * (1 - 0.75 * t ** 2.2), p.getY(i) * 0.36 * (1 - 0.3 * t * t) + 0.36 + 0.16 * t ** 4, p.getZ(i) * 2.4);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g.rotateZ(Math.PI).translate(0, 0.36, 0); // keel up, gunwales on the bar
}

// The docks: each a run of planks on two stringers, carried on round pilings
function dockLines() {
  const lines = [{ pts: BOARDWALK, half: 1.2 }];
  for (const f of FINGERS) lines.push({ pts: f, half: 0.75 });
  return lines;
}

function buildLivery(group) {
  group.name = 'GallupLivery';
  const water = nearestWater(3970, 335, 200) || { x: 3970, z: 335 };
  const level = waterLevel(water.x, water.z) ?? groundHeight(water.x, water.z);
  const deckY = level + 0.5;
  const segs = []; // each dock's straight runs, for walking on them (dockTop)
  const planks = [], stringers = [], pilings = [];
  const M = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const plank = new THREE.BoxGeometry(1, 0.045, 0.14);
  plank.deleteAttribute('uv');
  let seed = 4411;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const line of dockLines()) {
    const P = line.pts, hw = line.half;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      // the deck: level over the water, a step above the bank where it's higher
      const ya = Math.max(deckY, groundHeight(ax, az) + 0.12), yb = Math.max(deckY, groundHeight(bx, bz) + 0.12);
      segs.push({ ax, az, tx, tz, len, hw, ya, yb });
      Z.set(tx, (yb - ya) / len, tz).normalize();
      X.set(tz, 0, -tx);
      Y.crossVectors(Z, X).normalize();
      // planks across, overlapping a little at the corners
      for (let s = 0.07; s < len + 0.1; s += 0.155) {
        const y = ya + (yb - ya) * (s / len) - 0.023 + (rand() - 0.5) * 0.006;
        const g = plank.clone().scale(hw * 2 + (rand() - 0.5) * 0.04, 1, 1).rotateY((rand() - 0.5) * 0.02);
        M.makeBasis(X, Y, Z).setPosition(ax + tx * s, y, az + tz * s);
        planks.push(g.applyMatrix4(M));
      }
      // stringers under the planks, along each edge
      for (const o of [-1, 1]) {
        const g = new RoundedBoxGeometry(0.12, 0.24, len + 0.1, 2, 0.02);
        g.deleteAttribute('uv');
        M.makeBasis(X, Y, Z).setPosition(ax + tx * len / 2 + X.x * o * (hw - 0.1), (ya + yb) / 2 - 0.17, az + tz * len / 2 + X.z * o * (hw - 0.1));
        stringers.push(g.applyMatrix4(M));
      }
      // pilings every 2.4 m to each side, standing a little above the deck, down into the bed
      const n = Math.max(1, Math.round(len / 2.4));
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
        const s = (k / n) * len;
        for (const o of [-1, 1]) {
          const x = ax + tx * s + X.x * o * (hw + 0.06), z = az + tz * s + X.z * o * (hw + 0.06);
          const top = ya + (yb - ya) * (s / len) + 0.28;
          const bed = Math.min(groundHeight(x, z), riverDepth(x, z) > 0 ? riverbedHeight(x, z) : Infinity) - 0.4;
          const h = top - bed;
          if (h < 0.3) continue;
          const g = new THREE.CylinderGeometry(0.1, 0.11, h, 20, 1).translate(x, bed + h / 2, z);
          const cap = new THREE.SphereGeometry(0.1, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(x, top, z);
          for (const p of [g, cap]) { p.deleteAttribute('uv'); pilings.push(p); }
        }
      }
    }
  }

  // Beside the boathouse, on the bank: two racks of canoes and kayaks, and the rental kayaks pulled up in a row
  const toLand = (x, z) => {
    // a step up the bank from (x, z), away from the water, to dry ground
    for (let k = 0; k < 12 && riverDepth(x, z) > 0; k++) { x += (LIVERY.x - x) * 0.15; z += (LIVERY.z - z) * 0.15; }
    return [x, z];
  };
  const steel = [];
  const racked = []; // [geometry kind, matrix, colour]
  const rackAt = (cx, cz, yaw) => {
    const y = groundHeight(cx, cz);
    const rot = new THREE.Matrix4().makeRotationY(yaw), at = new THREE.Matrix4().makeTranslation(cx, y, cz);
    const place = (g) => { g.deleteAttribute('uv'); steel.push(g.applyMatrix4(rot).applyMatrix4(at)); };
    // two frames, 3 m apart, each two posts with arms out to both sides at three heights
    for (const fz of [-1.5, 1.5]) {
      for (const fx of [-0.15, 0.15]) place(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 14).translate(fx, 1.0, fz));
      for (const h of [0.45, 1.05, 1.65]) {
        place(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 14).rotateZ(Math.PI / 2).translate(0, h, fz));
        for (const ex of [-1.05, 1.05]) place(new THREE.SphereGeometry(0.045, 12, 8).translate(ex, h, fz));
      }
      place(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 10).rotateZ(Math.PI / 2).translate(0, 0.02, fz));
    }
    // the boats on it, along the arms: canoes up top, kayaks below
    for (const h of [0.45, 1.05, 1.65]) {
      for (const side of [-0.6, 0.6]) {
        const canoe = h > 1.5;
        const m = new THREE.Matrix4().makeTranslation(side, h + 0.03, 0);
        if (!canoe) m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(0, -0.32, 0));
        racked.push([canoe ? 'canoe' : 'kayak', m.premultiply(rot).premultiply(at), canoe ? [0x2f6b3a, 0xa6abad][racked.length % 2] : KAYAK_COLORS[racked.length % KAYAK_COLORS.length]]);
      }
    }
  };
  {
    const [x1, z1] = toLand(3976, 322), [x2, z2] = toLand(3968, 316);
    rackAt(x1, z1, Math.atan2(0.905, 0.424));
    rackAt(x2, z2, Math.atan2(0.674, 0.739));
  }
  // the rental kayaks, pulled up along the bank by the boardwalk's west end, bows to the water
  const rentals = [];
  {
    const ax = 3959.2, az = 312.7, bx = 3971.7, bz = 326.4, l = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / l, tz = (bz - az) / l;
    for (let k = 0; k < 6; k++) {
      const s = 2 + k * 1.1;
      let [x, z] = [ax + tx * s + tz * 2.6, az + tz * s - tx * 2.6];
      [x, z] = toLand(x, z);
      rentals.push({ kind: 'kayak', x, z, y: groundHeight(x, z) + 0.02, yaw: Math.atan2(-tz, tx), color: KAYAK_COLORS[k % KAYAK_COLORS.length] });
    }
  }
  // the pedal boats, tied alongside the finger docks, bows out
  {
    let n = 0;
    for (const f of FINGERS) {
      const [ax, az] = f[0], [bx, bz] = f.at(-1), l = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / l, tz = (bz - az) / l;
      for (let s = 2.2; s < l - 0.6 && n < 10; s += 2.8) {
        for (const o of [-1, 1]) {
          const x = ax + tx * s + tz * o * 1.75, z = az + tz * s - tx * o * 1.75;
          if (riverDepth(x, z) < 0.5 || rentals.some((r) => Math.hypot(r.x - x, r.z - z) < 2.4)) continue;
          rentals.push({ kind: 'pedal', x, z, y: waterLevel(x, z) ?? level, yaw: Math.atan2(tx, tz), color: HULLS[n++ % HULLS.length] });
          if (n >= 10) break;
        }
      }
    }
  }

  const add = (geo, color, name, rough = 0.85, metal = 0) => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal }));
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const indexed = (list) => mergeGeometries(list.map((g) => {
    if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  }));
  add(indexed(planks), 0x9c8466, 'LiveryDeck');
  add(indexed(stringers), 0x5e4a38, 'LiveryStringers');
  add(indexed(pilings), 0x6b5a48, 'LiveryPilings', 0.95);
  add(indexed(steel), 0x8e969a, 'LiveryRacks', 0.4, 0.7);

  // the boats: kayaks and canoes on the racks, the rental kayaks and pedal boats, and the ones out on the water
  const kayak = kayakGeometry();
  const pedal = pedalBoatGeometry();
  const canoe = canoeGeometry();
  const inst = (geo, mat, count, name) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = count;
    group.add(m);
    return m;
  };
  const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.35 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.75 });
  const nKayaks = racked.filter((r) => r[0] === 'kayak').length + rentals.filter((r) => r.kind === 'kayak').length + NPC_KAYAK;
  const nPedals = rentals.filter((r) => r.kind === 'pedal').length + NPC_PEDAL;
  const kHull = inst(kayak.hull, paint, nKayaks, 'LiveryKayaks'), kCockpit = inst(kayak.cockpit, dark, nKayaks, 'LiveryCockpits');
  const pHull = inst(pedal.hull, paint.clone(), nPedals, 'PedalBoats');
  const pSeats = inst(pedal.seats, new THREE.MeshStandardNodeMaterial({ color: 0xdcdcd6, roughness: 0.5 }), nPedals, 'PedalBoatSeats');
  const pTrim = inst(pedal.trim, new THREE.MeshStandardNodeMaterial({ color: 0x3a3f44, roughness: 0.5 }), nPedals, 'PedalBoatTrim');
  const canoes = inst(canoe, new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide }), racked.filter((r) => r[0] === 'canoe').length, 'RackedCanoes');
  const paddles = inst(paddleGeometry(), new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.45 }), NPC_KAYAK, 'LiveryPaddles');
  const color = new THREE.Color();
  let ki = 0, pi = 0, ci = 0;
  for (const [kind, m, c] of racked) {
    if (kind === 'canoe') { canoes.setMatrixAt(ci, m); canoes.setColorAt(ci++, color.setHex(c)); }
    else { kHull.setMatrixAt(ki, m); kCockpit.setMatrixAt(ki, m); kHull.setColorAt(ki++, color.setHex(c)); }
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const none = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const r of rentals) {
    r.slot = r.kind === 'kayak' ? ki++ : pi++;
    (r.kind === 'kayak' ? kHull : pHull).setColorAt(r.slot, color.setHex(r.color));
  }
  const setBoat = (kind, slot, matrix) => {
    if (kind === 'kayak') { kHull.setMatrixAt(slot, matrix); kCockpit.setMatrixAt(slot, matrix); }
    else { pHull.setMatrixAt(slot, matrix); pSeats.setMatrixAt(slot, matrix); pTrim.setMatrixAt(slot, matrix); }
  };
  let taken = -1, time = 0;
  const placeRental = (i, bob = 0) => {
    const r = rentals[i];
    if (i === taken) { setBoat(r.kind, r.slot, none); return; }
    e.set(r.kind === 'pedal' ? Math.sin(time * 1.1 + i) * 0.015 : 0, r.yaw, r.kind === 'pedal' ? Math.sin(time * 0.9 + i * 2) * 0.02 : 0, 'YXZ');
    m.compose(v.set(r.x, r.y + bob, r.z), q.setFromEuler(e), one);
    setBoat(r.kind, r.slot, m);
  };
  rentals.forEach((_, i) => placeRental(i));
  // somewhere out on the open water about the livery, clear of its docks and of the boats already out (riverDepth is
  // how far into the water a point is, 0 to 1: well in, and open water 6 m to either side)
  const spawnSpot = () => {
    for (let t = 0; t < 60; t++) {
      const a = rand() * Math.PI * 2, d = 25 + rand() * 160, px = water.x + Math.sin(a) * d, pz = water.z + Math.cos(a) * d;
      if (!(riverDepth(px, pz) > 0.95 && riverDepth(px + 6, pz) > 0.8 && riverDepth(px - 6, pz) > 0.8)) continue;
      if (npcs.some((n) => Math.hypot(n.x - px, n.z - pz) < 8)) continue;
      return [px, pz];
    }
    return [water.x, water.z];
  };

  // the people out on the water: pedal boats and kayaks, wandering the open water about the livery
  const npcs = [];
  for (let i = 0; i < NPC_PEDAL + NPC_KAYAK; i++) {
    const isPedal = i < NPC_PEDAL;
    const [x, z] = spawnSpot();
    const slot = isPedal ? pi++ : ki++;
    (isPedal ? pHull : kHull).setColorAt(slot, color.setHex(isPedal ? HULLS[(i * 3 + 1) % HULLS.length] : KAYAK_COLORS[(i * 2 + 1) % KAYAK_COLORS.length]));
    const riders = isPedal ? (i % 2 ? 2 : 1) : 1;
    npcs.push({
      pedal: isPedal, slot, x, z, heading: rand() * Math.PI * 2, speed: 0, cruise: isPedal ? 0.9 + rand() * 0.4 : 1.4 + rand() * 0.5,
      phase: rand() * 100, stroke: rand() * 6, root: new THREE.Object3D(),
      rigs: Array.from({ length: riders }, (_, k) => new PersonRig({ seed: 300 + i * 11.7 + k * 3.1, scale: 0.9 + rand() * 0.16, female: rand() < 0.5, girth: 0.9 + rand() * 0.25, hair: rand() * 0.6 })),
      hands: [[new THREE.Vector3(), new THREE.Vector3()], [new THREE.Vector3(), new THREE.Vector3()]]
    });
  }
  const wheels = inst(pedal.wheel, new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f0, roughness: 0.5 }), NPC_PEDAL, 'PedalBoatWheels');
  for (const mesh of [kHull, pHull]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (canoes.instanceColor) canoes.instanceColor.needsUpdate = true;
  const crowd = new PersonCrowd(NPC_PEDAL * 2 + NPC_KAYAK);
  crowd.meshes.forEach((c) => group.add(c));
  const boats = [kHull, kCockpit, pHull, pSeats, pTrim, canoes, paddles, wheels];
  for (const b of boats) b.instanceMatrix.needsUpdate = true;
  for (const b of npcs) setBoat(b.pedal ? 'pedal' : 'kayak', b.slot, none);
  // a boat taken from its people: it, its wheel or paddle, and they go (they're drawn only with their boat)
  const hideNpc = (b) => {
    setBoat(b.pedal ? 'pedal' : 'kayak', b.slot, none);
    if (b.pedal) wheels.setMatrixAt(b.slot - (nPedals - NPC_PEDAL), none);
    else paddles.setMatrixAt(b.slot - (nKayaks - NPC_KAYAK), none);
  };
  // The people whose boat the player took: over the side, they swim for the nearest bank, wade out and walk a little
  // way up it, then stand about until they're out of sight
  const swimmers = [];
  const ashore = (x, z) => riverDepth(x, z) <= 0.02;
  const findShore = (x, z) => {
    for (let d = 2; d <= 90; d += 2) {
      let best = null, bd = Infinity;
      for (let a = 0; a < 24; a++) {
        const h = a / 24 * Math.PI * 2, px = x + Math.sin(h) * d, pz = z + Math.cos(h) * d;
        if (!ashore(px, pz)) continue;
        const dd = (px - x) ** 2 + (pz - z) ** 2;
        if (dd < bd) { bd = dd; best = [px, pz, h]; }
      }
      if (best) return best;
    }
    return [water.x, water.z, 0];
  };
  const footing = (o, x, z) => (riverDepth(x, z) > 0 ? riverbedHeight(x, z) : groundHeight(x, z));
  const overboard = (b) => {
    b.rigs.forEach((rig, k) => {
      // from beside their seat, off the side they sat on
      const side = b.pedal ? (k === 0 ? 1 : -1) : 1, c = Math.cos(b.heading), s = Math.sin(b.heading);
      const x = b.x + c * side * 1.1, z = b.z - s * side * 1.1;
      const [sx, sz, h] = findShore(x, z);
      // up the bank a few meters past the water's edge
      const tx = sx + Math.sin(h) * (4 + k * 1.5) + Math.cos(h) * k * 1.2, tz = sz + Math.cos(h) * (4 + k * 1.5) - Math.sin(h) * k * 1.2;
      rig.perched = false;
      swimmers.push({ b, rig, x, z, heading: Math.atan2(tx - x, tz - z), tx, tz, walking: false, still: 0, delay: k * 0.6 });
    });
  };
  const stepSwimmers = (dt, cam) => {
    for (let i = swimmers.length - 1; i >= 0; i--) {
      const p = swimmers[i];
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      if (p.delay > 0) p.delay -= dt;
      if (!p.walking) {
        // breaststroke for the bank, until their feet find the bottom
        const go = p.delay > 0 ? 0 : 1;
        let want = Math.atan2(dx, dz) - p.heading;
        want = Math.atan2(Math.sin(want), Math.cos(want));
        p.heading += Math.max(-1, Math.min(1, want)) * Math.min(1, dt * 1.5);
        const nx = p.x + Math.sin(p.heading) * 0.85 * go * dt, nz = p.z + Math.cos(p.heading) * 0.85 * go * dt;
        p.x = nx; p.z = nz;
        if (riverDepth(p.x, p.z) < 0.95) { p.walking = true; p.rig.reset(p.x, p.z, p.heading, footing); }
      } else if (d > 0.4) {
        // wading out and on up the bank
        const sp = (riverDepth(p.x, p.z) > 0.2 ? 0.7 : 1.25) * dt;
        p.heading = Math.atan2(dx, dz);
        p.x += dx / d * Math.min(d, sp); p.z += dz / d * Math.min(d, sp);
      } else p.still += dt;
      const far = Math.hypot(p.x - cam.x, p.z - cam.z);
      // gone once they've stood a while out of sight, or the boat's theirs again
      if ((p.still > 8 && far > 90) || !p.b.taken) { swimmers.splice(i, 1); continue; }
      if (far > 160) continue;
      if (p.walking) p.rig.update(dt, p.x, p.z, p.heading, footing);
      else p.rig.swim(dt, p.x, waterLevel(p.x, p.z) ?? level, p.z, p.heading, p.delay > 0 ? 0 : 1);
      crowd.add(p.rig, 0);
    }
  };
  // and given back: a rental to its spot, a boat to people out on the water again, somewhere else
  const putBack = (i) => {
    if (i < 0) return;
    taken = -1;
    if (i < rentals.length) placeRental(i);
    else {
      const b = npcs[i - rentals.length];
      b.taken = false;
      for (let s = swimmers.length - 1; s >= 0; s--) if (swimmers[s].b === b) swimmers.splice(s, 1);
      [b.x, b.z] = spawnSpot();
      b.speed = 0;
    }
    for (const bm of boats) bm.instanceMatrix.needsUpdate = true;
  };

  const SEATS = [new THREE.Vector3(0.32, 0.26, -0.22), new THREE.Vector3(-0.32, 0.26, -0.22)];
  const KAYAK_SEAT = new THREE.Vector3(0, 0.02, -0.14), PADDLE_AT = new THREE.Vector3(0, 0.58, 0.16);
  const local = new THREE.Matrix4(), held = new THREE.Matrix4(), spin = new THREE.Matrix4();
  // (a bridge's pier standing in the water is no way through: river.js pierPush)
  const pierOut = { x: 0, z: 0 };
  const open = (x, z) => (pierPush(x, z, 1.2, pierOut) ? 0 : riverDepth(x, z));
  let shown = true;

  // Bumping: each boat is two circles along its keel (a pedal boat's broad, a kayak's narrow), each dock run a capsule
  // as wide as its deck; `push` says how far circle (x, z, r) must move to clear what it overlaps.
  const HULL = { pedal: [1.0, 0.82], kayak: [1.15, 0.38] };
  const circles = (x, z, heading, kind, out) => {
    const [o, r] = HULL[kind], s = Math.sin(heading) * o, c = Math.cos(heading) * o;
    out[0] = x + s; out[1] = z + c; out[2] = x - s; out[3] = z - c; out[4] = r;
    return out;
  };
  const push = { x: 0, z: 0 };
  const clearDocks = (x, z, r) => {
    for (const s of segs) {
      const dx = x - s.ax, dz = z - s.az, along = Math.max(0, Math.min(s.len, dx * s.tx + dz * s.tz));
      const ex = dx - s.tx * along, ez = dz - s.tz * along, d = Math.hypot(ex, ez), min = r + s.hw;
      if (d < min && d > 1e-4) { push.x += ex / d * (min - d); push.z += ez / d * (min - d); }
    }
  };
  const clearCircle = (x, z, r, cx, cz, cr) => {
    const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), min = r + cr;
    if (d >= min) return 0;
    if (d < 1e-4) { push.x += min; return min; }
    push.x += dx / d * (min - d); push.z += dz / d * (min - d);
    return min - d;
  };
  const ca = new Float32Array(5), cb = new Float32Array(5);
  // how far boat a overlaps boat b (both as circle pairs), adding a's way out to push
  const clearBoat = (a, bx, bz, bh, bkind) => {
    circles(bx, bz, bh, bkind, cb);
    return Math.max(clearCircle(a[0], a[1], a[4], cb[0], cb[1], cb[4]), clearCircle(a[0], a[1], a[4], cb[2], cb[3], cb[4]),
      clearCircle(a[2], a[3], a[4], cb[0], cb[1], cb[4]), clearCircle(a[2], a[3], a[4], cb[2], cb[3], cb[4]));
  };
  const npcKind = (b) => (b.pedal ? 'pedal' : 'kayak');
  // the player's boat, as it last bumped about: the boats out on the water give it room
  const player = { x: 0, z: 0, heading: 0, kind: 'kayak', at: -1 };

  function steer(b, dt) {
    const look = 8, ahead = (h) => open(b.x + Math.sin(h) * look, b.z + Math.cos(h) * look);
    let want = b.heading + Math.sin(time * 0.09 + b.phase) * 0.35;
    const hx = water.x - b.x, hz = water.z - b.z;
    if (hx * hx + hz * hz > RANGE * RANGE) want = Math.atan2(hx, hz);
    let slow = 1;
    // easing off and turning away from the player's boat ahead of it
    if (time - player.at < 1) {
      const dx = player.x - b.x, dz = player.z - b.z, d2 = dx * dx + dz * dz;
      if (d2 < 49 && dx * Math.sin(b.heading) + dz * Math.cos(b.heading) > 0) {
        const side = dx * Math.cos(b.heading) - dz * Math.sin(b.heading);
        want = b.heading + (side > 0 ? -1.1 : 1.1);
        slow = d2 < 16 ? 0 : 0.3;
      }
    }
    // the one nearest someone standing at the end of a dock comes alongside and waits there, to be taken
    if (b === calling) {
      const dx = foot.x - b.x, dz = foot.z - b.z, d = Math.hypot(dx, dz);
      want = Math.atan2(dx, dz);
      slow = d < 3.6 ? 0 : Math.min(0.6, (d - 3.6) / 4);
    }
    if (ahead(b.heading) < 1.0) {
      const l = ahead(b.heading + 0.7), r = ahead(b.heading - 0.7);
      want = b.heading + (l >= r ? 1.3 : -1.3);
      slow = 0.35;
    }
    // and clear of each other
    for (const o of npcs) {
      if (o === b || o.taken) continue;
      const dx = o.x - b.x, dz = o.z - b.z, d2 = dx * dx + dz * dz;
      if (d2 < 64 && dx * Math.sin(b.heading) + dz * Math.cos(b.heading) > 0) { want = b.heading + 0.9; slow = Math.min(slow, 0.5); }
    }
    let d = want - b.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    b.heading += Math.max(-1, Math.min(1, d)) * Math.min(1, dt * 0.6);
    b.speed += (b.cruise * slow - b.speed) * Math.min(1, dt * 0.8);
    const nx = b.x + Math.sin(b.heading) * b.speed * dt, nz = b.z + Math.cos(b.heading) * b.speed * dt;
    if (open(nx, nz) > 0.6) { b.x = nx; b.z = nz; } else b.speed *= 0.5;
    // and never through a dock, a tied-up boat, another boat or the player's
    push.x = push.z = 0;
    const a = circles(b.x, b.z, b.heading, npcKind(b), ca);
    if (Math.abs(b.x - LIVERY.x) < 90 && Math.abs(b.z - LIVERY.z) < 90) {
      clearDocks(a[0], a[1], a[4]); clearDocks(a[2], a[3], a[4]);
      for (const r of rentals) if (r.kind === 'pedal' && r !== rentals[taken]) clearBoat(a, r.x, r.z, r.yaw, 'pedal');
    }
    for (const o of npcs) {
      if (o === b || o.taken || Math.abs(o.x - b.x) > 5 || Math.abs(o.z - b.z) > 5) continue;
      clearBoat(a, o.x, o.z, o.heading, npcKind(o));
    }
    if (time - player.at < 1) clearBoat(a, player.x, player.z, player.heading, player.kind);
    if (push.x || push.z) {
      const l = Math.hypot(push.x, push.z), m = Math.min(l, 0.5) / l * 0.5;
      if (open(b.x + push.x * m, b.z + push.z * m) > 0.4) { b.x += push.x * m; b.z += push.z * m; }
      b.speed *= 1 - Math.min(1, dt * 4);
    }
  }

  const foot = { x: 0, z: 0 };
  let calling = null;
  function update(dt, elapsed, cam, person) {
    time = elapsed;
    // someone on foot out on a dock calls over the nearest boat on the water
    calling = null;
    if (person && Math.abs(person.x - LIVERY.x) < 80 && Math.abs(person.z - LIVERY.z) < 80) {
      let bd = 40 * 40;
      for (const s of segs) {
        const dx = person.x - s.ax, dz = person.z - s.az, along = dx * s.tx + dz * s.tz;
        if (along < -0.3 || along > s.len + 0.3 || Math.abs(dx * s.tz - dz * s.tx) > s.hw + 0.05) continue;
        foot.x = person.x; foot.z = person.z;
        for (const b of npcs) {
          if (b.taken) continue;
          const d2 = (b.x - foot.x) ** 2 + (b.z - foot.z) ** 2;
          if (d2 < bd) { bd = d2; calling = b; }
        }
        break;
      }
    }
    const far = Math.hypot(cam.x - LIVERY.x, cam.z - LIVERY.z);
    const show = far < 1600;
    if (show !== shown) {
      shown = show;
      for (const c of group.children) c.visible = show;
    }
    if (!show || dt <= 0) return;
    const near = far < 500;
    if (far < 200) {
      // the tied-up pedal boats rocking a little on the water
      rentals.forEach((r, i) => { if (r.kind === 'pedal') placeRental(i, Math.sin(time * 1.4 + i * 1.7) * 0.02); });
    }
    crowd.begin();
    for (const b of npcs) {
      if (b.taken) continue;
      if (near) steer(b, dt);
      const y = (waterLevel(b.x, b.z) ?? level) + Math.sin(time * 1.6 + b.phase) * 0.02;
      e.set(Math.sin(time * 1.1 + b.phase) * 0.015, b.heading, Math.sin(time * 1.3 + b.phase * 2) * 0.025, 'YXZ');
      q.setFromEuler(e);
      b.root.position.set(b.x, y, b.z);
      b.root.quaternion.copy(q);
      m.compose(b.root.position, q, one);
      setBoat(b.pedal ? 'pedal' : 'kayak', b.slot, m);
      const posed = Math.hypot(b.x - cam.x, b.z - cam.z) < 160;
      if (posed) b.root.updateMatrix();
      if (b.pedal) {
        b.stroke += dt * b.speed * 2.2;
        local.makeTranslation(0, 0.14, -1.0).multiply(spin.makeRotationX(b.stroke));
        wheels.setMatrixAt(b.slot - (nPedals - NPC_PEDAL), held.multiplyMatrices(m, local));
        if (posed) b.rigs.forEach((rig, k) => {
          const s = SEATS[k], h = b.hands[k];
          // the one in the left seat steers, a hand on the lever; a passenger's rest in their lap
          if (k === 0) { h[0].set(0.62, 0.42, -0.08); h[1].set(0.02, 0.62, 0.24); }
          else { h[0].set(-0.18, 0.4, 0.02); h[1].set(-0.46, 0.4, 0.02); }
          rig.paddle(b.root, s, h, 0.05 * Math.sin(time * 0.5 + b.phase + k));
          crowd.add(rig, 0);
        });
      } else {
        b.stroke += dt * Math.PI * 2 * 0.6;
        const s = Math.sin(b.stroke), as = Math.abs(s);
        const deep = as < 0.7 ? (as / 0.7) ** 2 * (3 - 2 * as / 0.7) : 1;
        const pr = 0.84 * Math.sign(s) * deep, py = 0.55 * Math.cos(b.stroke);
        local.compose(PADDLE_AT, q.setFromEuler(e.set(0, py, pr, 'YZX')), one);
        paddles.setMatrixAt(b.slot - (nKayaks - NPC_KAYAK), held.multiplyMatrices(m, local));
        if (posed) {
          const dx = Math.cos(pr) * Math.cos(py), dy = Math.sin(pr), dz = -Math.cos(pr) * Math.sin(py), h = b.hands[0];
          h[0].set(PADDLE_AT.x + dx * 0.34, PADDLE_AT.y + dy * 0.34, PADDLE_AT.z + dz * 0.34);
          h[1].set(PADDLE_AT.x - dx * 0.34, PADDLE_AT.y - dy * 0.34, PADDLE_AT.z - dz * 0.34);
          b.rigs[0].paddle(b.root, KAYAK_SEAT, h, -py * 0.6);
          crowd.add(b.rigs[0], 0);
        }
      }
    }
    stepSwimmers(dt, cam);
    crowd.end();
    for (const bm of boats) bm.instanceMatrix.needsUpdate = true;
  }

  console.log(`[livery] ${segs.length} dock runs, ${rentals.length} boats to rent, ${npcs.length} out on the water`);
  return {
    update,
    count: rentals.length,
    // standing on a dock: its deck's height at (x, z), else -Infinity
    dockTop(x, z) {
      if (Math.abs(x - LIVERY.x) > 80 || Math.abs(z - LIVERY.z) > 80) return -Infinity;
      let top = -Infinity;
      for (const s of segs) {
        const dx = x - s.ax, dz = z - s.az, along = dx * s.tx + dz * s.tz;
        if (along < -0.3 || along > s.len + 0.3) continue;
        if (Math.abs(dx * s.tz - dz * s.tx) > s.hw + 0.05) continue;
        top = Math.max(top, s.ya + (s.yb - s.ya) * Math.max(0, Math.min(1, along / s.len)));
      }
      return top;
    },
    // the player's boat at (x, z) bumping the docks, the tied-up boats and the boats out on the water: how far to
    // move it to clear them (or null), shoving any boat it struck aside
    collide(x, z, heading, kind, speed = 0) {
      player.x = x; player.z = z; player.heading = heading; player.kind = kind === 'paddleboat' ? 'pedal' : 'kayak'; player.at = time;
      if (Math.abs(x - LIVERY.x) > 260 || Math.abs(z - LIVERY.z) > 260) return null;
      push.x = push.z = 0;
      const a = circles(x, z, heading, player.kind, ca);
      if (Math.abs(x - LIVERY.x) < 90 && Math.abs(z - LIVERY.z) < 90) {
        clearDocks(a[0], a[1], a[4]); clearDocks(a[2], a[3], a[4]);
        for (const r of rentals) if (r.kind === 'pedal' && r !== rentals[taken]) clearBoat(a, r.x, r.z, r.yaw, 'pedal');
      }
      let struck = 0;
      for (const b of npcs) {
        if (b.taken || Math.abs(b.x - x) > 5 || Math.abs(b.z - z) > 5) continue;
        const px = push.x, pz = push.z, o = clearBoat(a, b.x, b.z, b.heading, npcKind(b));
        if (o <= 0) continue;
        // the struck boat takes half of it, and drifts off
        const sx = push.x - px, sz = push.z - pz;
        push.x = px + sx * 0.5; push.z = pz + sz * 0.5;
        if (open(b.x - sx * 0.5, b.z - sz * 0.5) > 0.4) { b.x -= sx * 0.5; b.z -= sz * 0.5; }
        b.speed *= 0.5;
        struck = Math.max(struck, Math.abs(speed));
      }
      if (!push.x && !push.z) return null;
      return { x: push.x, z: push.z, struck };
    },
    // the rental boat, or a boat out on the water, within `reach` of (x, z), or null
    nearest(x, z, reach) {
      if (Math.abs(x - LIVERY.x) > 120 || Math.abs(z - LIVERY.z) > 120) return null;
      let best = null, bd = reach * reach;
      rentals.forEach((r, i) => {
        if (i === taken) return;
        const d = (r.x - x) ** 2 + (r.z - z) ** 2;
        if (d < bd) { bd = d; best = { i, kind: r.kind, x: r.x, z: r.z, d: Math.sqrt(d) }; }
      });
      // a boat out on the water is reached from a dock beside it, so a little further
      // (its distance given as if within the rentals' reach, so the two compare)
      const scale = reach / (reach + 0.9);
      npcs.forEach((b, n) => {
        if (b.taken) return;
        const d = Math.hypot(b.x - x, b.z - z) * scale;
        if (d * d < bd) { bd = d * d; best = { i: rentals.length + n, kind: npcKind(b), x: b.x, z: b.z, d }; }
      });
      return best;
    },
    // takes it from its spot, or from the people out in it (and puts back the one taken before), saying where the
    // player's boat goes and how it faces
    // (`quiet`: as the game opens again with it taken, its people long since ashore)
    take(i, quiet = false) {
      if (i < 0 || i >= rentals.length + npcs.length) return null;
      putBack(taken);
      taken = i;
      if (i >= rentals.length) {
        const b = npcs[i - rentals.length];
        b.taken = true;
        hideNpc(b);
        if (!quiet) overboard(b);
        for (const bm of boats) bm.instanceMatrix.needsUpdate = true;
        return { kind: b.pedal ? 'paddleboat' : 'kayak', x: b.x, z: b.z, y: waterLevel(b.x, b.z) ?? level, heading: b.heading };
      }
      placeRental(i);
      for (const b of boats) b.instanceMatrix.needsUpdate = true;
      const r = rentals[i];
      if (r.kind === 'pedal') return { kind: 'paddleboat', x: r.x, z: r.z, y: r.y, heading: r.yaw };
      // a kayak off the bank goes in the water beside it
      const w = nearestWater(r.x, r.z, 60) || water;
      return { kind: 'kayak', x: w.x, z: w.z, y: waterLevel(w.x, w.z) ?? level, heading: null };
    },
    // the boat taken goes back to its spot, or out on the water with its people again
    release() { putBack(taken); },
    get taken() { return taken; }
  };
}

export { buildLivery, pedalBoatGeometry };
