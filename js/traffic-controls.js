import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight } from './terrain.js';
import { color, mix, uniform } from 'three/tsl';
import { signalPhase } from './city-config.js';
import { log } from '../lamp-game.js';

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

function signTexture(draw, h = 256) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

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
const silhouette = (shape) => (ctx) => {
  shape(ctx);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
};

// The lamps of a head, top to bottom, each lit through its part of the cycle traffic obeys (city-config.js's
// signalPhase, for the main road (axisIndex 0) or the cross street), switched by update() every frame
const LAMPS = ['red', 'amber', 'green'];
const LAMP_COLORS = { red: 0xff2a1e, amber: 0xffa20e, green: 0x1cff7a };
function lampMaterial(lamp) {
  const lit = color(LAMP_COLORS[lamp]);
  const on = uniform(0);
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = mix(lit.mul(0.08), lit.mul(2.2), on); // a dark, tinted lens when off; bright enough to bloom when on
  mat.userData.on = on;
  return mat;
}

function buildTrafficControls(group, network) {
  group.name = 'TrafficControls';
  const dummy = new THREE.Object3D();
  const lists = new Map(); // name -> matrices
  let standing = null; // the pole or post being put up: each piece of it noted, so it can be knocked over as one
  const put = (name) => {
    dummy.updateMatrix();
    if (!lists.has(name)) lists.set(name, []);
    standing?.parts.push(name, lists.get(name).length);
    lists.get(name).push(dummy.matrix.clone());
  };
  const onRoad = (x, z) => network.isRoadClear && network.isRoadClear(x, z, 0.2);
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  // out from the road along e's right until clear of it (null if it never is)
  const curbside = (e, s, o) => {
    for (let k = 0; k < 10; k++, o += 0.6) {
      const [x, z] = at(e, s, o);
      if (!onRoad(x, z)) return [x, z, o];
    }
    return null;
  };

  let lights = 0;
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
    put('oneWay');
    put('oneWayBack');
    oneWaySigns++;
  };
  for (const e of network.edges) {
    const n = e.from;
    if (n.shape || e.divided || !e.lanes.length || e.len < 25 || (e.cls ?? 4) < 2) continue;
    if (nextOf.get(e.to)?.has(e.from) || (degree.get(n)?.size || 0) < 3) continue;
    // set back from the corner, out past the curb on each side
    const r = curbside(e, 3, e.half + 0.7);
    if (r) oneWayPost(e, 3, r[2]);
    for (let o = -e.half - 0.7, k = 0; k < 10; k++, o -= 0.6) {
      const [x, z] = at(e, 3, o);
      if (!onRoad(x, z)) { oneWayPost(e, 3, o); break; }
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
    put('limit' + mph);
    put('limitBack');
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
  standing = null;

  for (const e of network.edges) {
    const n = e.to;
    if (n.shape || !e.lanes.length) continue;
    if (n.signal) {
      // the far side: across the intersection from the stop line
      const k = (n.x - (e.sx + e.dx * e.len)) * e.dx + (n.z - (e.sz + e.dz * e.len)) * e.dz;
      const s = e.len + Math.max(4, 2 * k + 1.5);
      const spot = curbside(e, s, e.half + 0.9);
      if (!spot) continue;
      const [px, pz, po] = spot;
      const g = groundHeight(px, pz);
      dummy.rotation.set(0, Math.atan2(e.dx, e.dz), 0);
      dummy.position.set(px, g + ARM_Y / 2 + 0.1, pz);
      dummy.scale.set(0.15, ARM_Y + 0.3, 0.15);
      obstacles.push(standing = { x: px, z: pz, r: 0.16, kind: 'signal', height: ARM_Y, parts: [] });
      put('pole');
      // the arm out over the lanes coming up to it
      const reach = Math.min(13, Math.max(3, po - Math.min(...e.lanes) + 1.2));
      const [ax, az] = at(e, s, po - reach / 2);
      dummy.position.set(ax, g + ARM_Y, az);
      dummy.scale.set(0.12, 0.12, reach);
      dummy.rotation.set(0, Math.atan2(e.rx, e.rz), 0);
      put('arm');
      const lanes = e.lanes.slice().sort((a, b) => a - b).slice(-4);
      for (const o of lanes) {
        if (po - o > reach) continue;
        const [hx, hz] = at(e, s, o);
        dummy.rotation.set(0, Math.atan2(e.dx, e.dz), 0);
        dummy.position.set(hx, groundHeight(hx, hz) + HEAD_Y, hz);
        dummy.scale.set(1, 1, 1);
        put('head');
        for (const lamp of LAMPS) put(lamp + (e.axisIndex === 0 ? 'A' : 'B'));
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
      put(yieldSign ? 'yield' : 'stop');
      put(yieldSign ? 'yieldBack' : 'stopBack');
      if (!yieldSign && n.allStop) {
        dummy.position.set(px, g + 1.6, pz);
        dummy.scale.set(0.46, 0.46, 1);
        put('plaque');
        put('plaqueBack');
      }
      signs++;
    }
  }

  // Meshes
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.7 });
  const housing = new THREE.MeshStandardNodeMaterial({ color: 0x26292c, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
  const W = 0.4, H = 1.12, D = 0.28, R = 0.145, LY = [0.36, 0, -0.36];
  const headGeo = mergeGeometries([
    new THREE.BoxGeometry(W, H, D),
    new THREE.BoxGeometry(0.07, ARM_Y - HEAD_Y - H / 2, 0.07).translate(0, (ARM_Y - HEAD_Y + H / 2) / 2, 0),
    new THREE.BoxGeometry(W + 0.24, H + 0.2, 0.02).translate(0, 0, -D / 2 - 0.01), // backplate
    ...LY.map((ly) => new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.24, 14, 1, true, Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2).translate(0, ly, D / 2 + 0.12))
  ]);
  // one lamp each: red on top, amber, green at the bottom, facing the drivers coming up to the head
  const lampGeo = LY.map((ly) => new THREE.CircleGeometry(R, 20).translate(0, ly, D / 2 + 0.004));
  const plane = new THREE.PlaneGeometry(1, 1);
  const back = plane.clone().rotateY(Math.PI).translate(0, 0, -0.01);
  const face = (draw) => new THREE.MeshStandardNodeMaterial({ map: signTexture(draw), alphaTest: 0.5, roughness: 0.5 });
  const backOf = (shape) => new THREE.MeshStandardNodeMaterial({
    color: 0x9a9ea2, alphaMap: signTexture(silhouette(shape)), alphaTest: 0.5, roughness: 0.6, metalness: 0.5
  });
  const plaqueShape = (ctx) => { ctx.beginPath(); ctx.rect(0, 64, 256, 128); };
  const kinds = {
    pole: [new THREE.CylinderGeometry(1, 1, 1, 10), metal, true],
    arm: [new THREE.CylinderGeometry(1, 1, 1, 8).rotateX(Math.PI / 2), metal, false],
    head: [headGeo, housing, false],
    ...Object.fromEntries(LAMPS.flatMap((lamp, i) => [
      [lamp + 'A', [lampGeo[i], lampMaterial(lamp), false]],
      [lamp + 'B', [lampGeo[i], lampMaterial(lamp), false]]
    ])),
    post: [new THREE.CylinderGeometry(1, 1, 1, 6), metal, false],
    stop: [plane, face(stopFace), false],
    stopBack: [back, backOf((ctx) => octagon(ctx, 126)), false],
    yield: [plane, face(yieldFace), false],
    yieldBack: [back, backOf((ctx) => triangle(ctx, 140)), false],
    plaque: [plane, face(plaqueFace), false],
    plaqueBack: [back, backOf(plaqueShape), false],
    oneWay: [plane, new THREE.MeshStandardNodeMaterial({ map: signTexture(oneWayFace(false), 86), roughness: 0.5 }), true],
    oneWayBack: [back, new THREE.MeshStandardNodeMaterial({ map: signTexture(oneWayFace(true), 86), roughness: 0.5 }), false],
    limitBack: [back, new THREE.MeshStandardNodeMaterial({ color: 0x9a9ea2, roughness: 0.6, metalness: 0.5 }), false],
    ...Object.fromEntries([...limits.keys()].map((mph) => ['limit' + mph,
      [plane, new THREE.MeshStandardNodeMaterial({ map: signTexture(limitFace(mph), 320), roughness: 0.5 }), true]]))
  };
  const meshOf = new Map();
  for (const [name, matrices] of lists) {
    const [geo, mat, shadow] = kinds[name];
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    meshOf.set(name, inst);
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadow;
    inst.userData.cullDistance = name === 'pole' || name === 'arm' || name === 'head' || name.endsWith('A') || name.endsWith('B') ? 550 : 320;
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
  log(`[traffic controls] ${lights} signal heads, ${signs} stop & yield signs, ${oneWaySigns} one-way signs, `
    + `${[...limits.values()].reduce((a, b) => a + b, 0)} speed limit signs (${[...limits].sort((a, b) => a[0] - b[0]).map(([m, n]) => `${n} at ${m}`).join(', ')})`);
  const lamps = LAMPS.flatMap((lamp) => [[lamp, true, kinds[lamp + 'A'][1]], [lamp, false, kinds[lamp + 'B'][1]]]);
  const update = (time) => {
    for (const [lamp, mainRoad, mat] of lamps) mat.userData.on.value = signalPhase(time, mainRoad) === lamp ? 1 : 0;
  };
  return { lights, signs, update, obstacles };
}

export { buildTrafficControls };
