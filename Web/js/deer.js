// White-tailed deer in the Nichols Arboretum, at dawn and dusk only (the golden and twilight looks): a few does and
// a buck grazing the Arb's meadows, walking on to another patch now and then, heads up and still at anyone who comes
// near, and off at a bound, white tails up, when they come too close. Someone who stands still a while is let be,
// and the deer go back to grazing. Out of those hours (or once fled) they're gone, back the next time it's dawn or
// dusk. animals.js runs this, with its threats.
//
// THE RULE ABOVE EVERYTHING (animals.js): no deer is ever struck, hurt or knocked down by anything. They aren't in the
// colliders, the knock-downs or the ragdolls, and never make a thud: anything coming at one sends it off well before
// it arrives, and one something still reaches bounds off; one leaves only out of sight.
//
// The model is lofted rings round its bones, skinned (animal-models.js' Body), its winter coat gray-brown with the white
// throat patch, muzzle band, eye ring, belly and the tail's underside; the buck carries his antlers.
import * as THREE from 'three/webgpu';
import { groundHeight, riverDepth } from './terrain.js';
import { GEO } from './city-geodata.js';
import { log } from '../lamp-game.js';
import { Body, coatMaterial, paintHair } from './animal-models.js';

const ALIVE = 420, LET_GO = 520; // the herds are about within this far of the view (m)
const NEAR_DIST = 110; // skinned bodies within this far; the rest are stand-ins
const HIDE = 160; // a deer leaving or fled is let go only out of the view or beyond this far from it (m)
const STILL_LET_BE = 4; // someone on foot standing still this long (s) is let be: the deer graze, an eye on them
const HOURS = new Set(['golden', 'twilight']);

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

// ============================================================================
// THE MODEL: a doe about 0.95 m at the shoulder and 1.6 m long; the buck a little larger (scaled), with antlers
// ============================================================================
const DEER_BONES = [
  { name: 'root', parent: null, at: [0, 0, 0] },
  { name: 'hips', parent: 'root', at: [0, 0.88, -0.42] },
  { name: 'spine', parent: 'hips', at: [0, 0.89, 0.0] },
  { name: 'chest', parent: 'spine', at: [0, 0.9, 0.38] },
  { name: 'neck', parent: 'chest', at: [0, 0.96, 0.54] },
  { name: 'neck2', parent: 'neck', at: [0, 1.16, 0.66] },
  { name: 'head', parent: 'neck2', at: [0, 1.36, 0.76], end: [0, 1.24, 1.02] },
  { name: 'tail', parent: 'hips', at: [0, 0.9, -0.6], end: [0, 0.68, -0.72] },
  { name: 'shoulderL', parent: 'chest', at: [0.12, 0.84, 0.42] },
  { name: 'elbowL', parent: 'shoulderL', at: [0.12, 0.56, 0.39] },
  { name: 'kneeL', parent: 'elbowL', at: [0.11, 0.3, 0.42] },
  { name: 'fetlockL', parent: 'kneeL', at: [0.11, 0.08, 0.43], end: [0.11, 0, 0.47] },
  { name: 'shoulderR', parent: 'chest', at: [-0.12, 0.84, 0.42] },
  { name: 'elbowR', parent: 'shoulderR', at: [-0.12, 0.56, 0.39] },
  { name: 'kneeR', parent: 'elbowR', at: [-0.11, 0.3, 0.42] },
  { name: 'fetlockR', parent: 'kneeR', at: [-0.11, 0.08, 0.43], end: [-0.11, 0, 0.47] },
  { name: 'thighL', parent: 'hips', at: [0.13, 0.84, -0.45] },
  { name: 'stifleL', parent: 'thighL', at: [0.14, 0.55, -0.33] },
  { name: 'hockL', parent: 'stifleL', at: [0.13, 0.4, -0.56] },
  { name: 'hfetL', parent: 'hockL', at: [0.12, 0.08, -0.5], end: [0.12, 0, -0.46] },
  { name: 'thighR', parent: 'hips', at: [-0.13, 0.84, -0.45] },
  { name: 'stifleR', parent: 'thighR', at: [-0.14, 0.55, -0.33] },
  { name: 'hockR', parent: 'stifleR', at: [-0.13, 0.4, -0.56] },
  { name: 'hfetR', parent: 'hockR', at: [-0.12, 0.08, -0.5], end: [-0.12, 0, -0.46] }
];
const DB = Object.fromEntries(DEER_BONES.map((b, i) => [b.name, i]));
const toR = (n) => n.replace(/L$/, 'R');

// November's coat: gray-brown over the back, warmer on the flanks and legs, white below
const COAT = { back: 0x6f6152, warm: 0x8c6c4c, belly: 0xece7de, fringe: 0x3d3128, tip: 0xb9ab98, dark: 0x0d0a08 };

function deerBody(detail, buck) {
  const b = new Body(DEER_BONES.map((x) => ({ ...x })));
  const hi = detail > 0;
  const segs = hi ? 30 : 9, steps = hi ? 4 : 1, limbSegs = hi ? 16 : 5;
  const belly = (n) => Math.min(1, Math.max(0, (-n.y - 0.25) / 0.4));
  const flank = (n) => Math.max(0, 0.6 - Math.abs(n.y)) * 0.8;

  // the barrel: rump to withers, deep in the chest, tucked up at the flank
  b.loft([
    { c: [0, 0.86, -0.665], rx: 0.02 },
    { c: [0, 0.85, -0.63], rx: 0.11, ry: 0.07, down: 0.12 },
    { c: [0, 0.83, -0.52], rx: 0.165, ry: 0.1, down: 0.2 },
    { c: [0, 0.81, -0.32], rx: 0.18, ry: 0.11, down: 0.22 },
    { c: [0, 0.79, -0.08], rx: 0.19, ry: 0.13, down: 0.23 },
    { c: [0, 0.78, 0.16], rx: 0.19, ry: 0.14, down: 0.27 },
    { c: [0, 0.8, 0.36], rx: 0.165, ry: 0.15, down: 0.27 },
    { c: [0, 0.85, 0.5], rx: 0.13, ry: 0.13, down: 0.22 },
    { c: [0, 0.92, 0.6], rx: 0.09, ry: 0.09, down: 0.14 },
    { c: [0, 0.97, 0.64], rx: 0.03 }
  ], { segs, steps, bones: ['hips', 'spine', 'chest', 'neck', 'thighL', 'thighR', 'shoulderL', 'shoulderR'], fluff: 0.012, scale: 9,
    mat: (p, n) => [Math.max(belly(n), p.z < -0.58 && n.y < 0.3 && Math.abs(p.x) < 0.08 ? 0.9 : 0), 0, 0, flank(n)] });

  // the neck: thick at the shoulders, the white throat patch high under the jaw
  const throat = (p, n) => (n.z > 0.2 && p.y > 1.12 && p.y < 1.3 ? Math.min(1, (n.z - 0.2) * 2.5) : 0);
  b.loft([
    { c: [0, 0.86, 0.46], rx: 0.12, ry: 0.15 },
    { c: [0, 0.98, 0.58], rx: 0.1, ry: 0.13 },
    { c: [0, 1.12, 0.65], rx: 0.08, ry: 0.1 },
    { c: [0, 1.26, 0.71], rx: 0.07, ry: 0.085 },
    { c: [0, 1.36, 0.76], rx: 0.065, ry: 0.075 }
  ], { segs, steps, upRef: [0, 0, 1], bones: ['chest', 'neck', 'neck2', 'head'], fluff: buck ? 0.04 : 0.015, scale: 9,
    mat: (p, n) => [throat(p, n), 0, 0, 0.3] });

  // the head: the brow, the long tapering face, the pale ring round each eye and the band behind the black nose
  const eyeAt = [0.058, 1.375, 0.85];
  const ring = (p) => Math.max(0, 1 - Math.hypot(Math.abs(p.x) - eyeAt[0], p.y - eyeAt[1], p.z - eyeAt[2]) / 0.032);
  const muzzle = (p) => (p.z > 0.965 && p.z < 1.0 ? 0.85 : 0);
  b.loft([
    { c: [0, 1.39, 0.72], rx: 0.02 },
    { c: [0, 1.39, 0.745], rx: 0.065, ry: 0.06, down: 0.06 },
    { c: [0, 1.38, 0.8], rx: 0.075, ry: 0.07, down: 0.075 },
    { c: [0, 1.35, 0.87], rx: 0.062, ry: 0.06, down: 0.065 },
    { c: [0, 1.3, 0.94], rx: 0.045, ry: 0.045, down: 0.05 },
    { c: [0, 1.265, 0.99], rx: 0.035, ry: 0.035, down: 0.04 },
    { c: [0, 1.245, 1.02], rx: 0.028, ry: 0.026, down: 0.032 },
    { c: [0, 1.24, 1.033], rx: 0.006 }
  ], { segs, steps, bones: ['head', 'neck2'], scale: 14,
    mat: (p, n) => [Math.max(belly(n) * 0.5, ring(p) * 0.8, muzzle(p)), p.z > 1.012 ? 0.85 : 0, 0, 0.25] });
  for (const s of [1, -1]) b.ball([eyeAt[0] * s, eyeAt[1], eyeAt[2]], { x: 0.012, y: 0.017, z: 0.019 }, { segs: hi ? 16 : 6, rings: hi ? 8 : 3, bones: ['head'], mat: () => [0, 1, 0, 0] });
  b.ball([0, 1.252, 1.03], { x: 0.026, y: 0.018, z: 0.012 }, { segs: hi ? 14 : 5, rings: hi ? 6 : 2, bones: ['head'], mat: () => [0, 0.92, 0, 0] });

  // the big ears, out to the sides, pale inside and dark at the rim
  const ear = { segs: hi ? 14 : 5, steps: hi ? 3 : 1, upRef: [0, 0, 1], bones: ['head'], scale: 20 };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.04, 1.43, 0.75], rx: 0.03, ry: 0.012 },
      { c: [0.075, 1.48, 0.745], rx: 0.048, ry: 0.012 },
      { c: [0.12, 1.53, 0.74], rx: 0.045, ry: 0.01 },
      { c: [0.155, 1.565, 0.735], rx: 0.026, ry: 0.007 },
      { c: [0.17, 1.58, 0.733], rx: 0.003, ry: 0.002 }
    ], { ...ear, mirror, mat: (p, n, a) => [n.z > 0.3 ? 0.75 : 0, 0, Math.abs(Math.cos(a)) > 0.85 ? 0.7 : 0, 0.4] });
  }

  // the forelegs: the shoulder's muscle, the slim forearm, the knee, the cannon, the fetlock and the black hoof
  const fore = { segs: limbSegs, steps, upRef: [0, 0, 1], bones: ['chest', 'shoulderL', 'elbowL', 'kneeL', 'fetlockL'], swap: toR, scale: 16 };
  const hoof = (p) => (p.y < 0.055 ? 0.9 : 0);
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.11, 0.9, 0.43], rx: 0.06, ry: 0.09 },
      { c: [0.125, 0.72, 0.415], rx: 0.065, ry: 0.085 },
      { c: [0.125, 0.56, 0.39], rx: 0.05, ry: 0.06 },
      { c: [0.118, 0.44, 0.41], rx: 0.032, ry: 0.038 },
      { c: [0.112, 0.31, 0.42], rx: 0.03, ry: 0.034 },
      { c: [0.11, 0.2, 0.425], rx: 0.019, ry: 0.024 },
      { c: [0.11, 0.09, 0.432], rx: 0.023, ry: 0.026 },
      { c: [0.11, 0.05, 0.442], rx: 0.026, ry: 0.03 },
      { c: [0.11, 0.012, 0.462], rx: 0.019, ry: 0.016 },
      { c: [0.11, 0.004, 0.472], rx: 0.004 }
    ], { ...fore, mirror, mat: (p, n) => [Math.max(0, -n.z) * 0.6 * (p.y > 0.3 ? 1 : 0), hoof(p), 0, 0.7] });
  }

  // the hind legs: the big ham, the gaskin back to the hock, the long cannon, the hoof
  const hind = { segs: limbSegs + 2, steps, upRef: [0, 0, 1], bones: ['hips', 'thighL', 'stifleL', 'hockL', 'hfetL'], swap: toR, scale: 16 };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.1, 0.92, -0.48], rx: 0.07, ry: 0.13 },
      { c: [0.13, 0.76, -0.44], rx: 0.085, ry: 0.13 },
      { c: [0.14, 0.62, -0.38], rx: 0.07, ry: 0.1 },
      { c: [0.138, 0.52, -0.42], rx: 0.048, ry: 0.07 },
      { c: [0.132, 0.44, -0.51], rx: 0.034, ry: 0.044 },
      { c: [0.13, 0.39, -0.56], rx: 0.03, ry: 0.036 },
      { c: [0.125, 0.24, -0.53], rx: 0.02, ry: 0.026 },
      { c: [0.12, 0.09, -0.502], rx: 0.023, ry: 0.026 },
      { c: [0.12, 0.05, -0.49], rx: 0.026, ry: 0.03 },
      { c: [0.12, 0.012, -0.47], rx: 0.019, ry: 0.016 },
      { c: [0.12, 0.004, -0.46], rx: 0.004 }
    ], { ...hind, mirror, mat: (p, n) => [Math.max(0, n.x * (mirror ? 1 : -1)) * 0.5 * (p.y > 0.5 ? 1 : 0), hoof(p), 0, 0.6] });
  }

  // the tail: brown above, white beneath, hung down at rest and flagged up when it runs
  b.loft([
    { c: [0, 0.9, -0.6], rx: 0.035, ry: 0.03 },
    { c: [0, 0.86, -0.665], rx: 0.07, ry: 0.035 },
    { c: [0, 0.79, -0.705], rx: 0.075, ry: 0.035 },
    { c: [0, 0.72, -0.725], rx: 0.055, ry: 0.028 },
    { c: [0, 0.68, -0.73], rx: 0.008 }
  ], { segs: hi ? 18 : 6, steps, upRef: [0, 0, 1], bones: ['tail', 'hips'], fluff: hi ? 0.08 : 0.02, fluffFreq: 9, scale: 16,
    mat: (p, n, a) => [n.z > -0.1 || Math.abs(Math.cos(a)) > 0.8 ? 1 : 0, 0, 0, 0.2] });

  // his antlers: a main beam each side curving out and forward, three tines up off it
  if (buck) {
    const tan = () => [0.5, 0.42, 0, 0.6];
    const beam = { segs: hi ? 10 : 4, steps: hi ? 3 : 1, upRef: [0, 0, 1], bones: ['head'], scale: 30, mat: tan };
    for (const mirror of [false, true]) {
      const pts = [[0.045, 1.45, 0.775], [0.08, 1.53, 0.75], [0.15, 1.6, 0.76], [0.2, 1.63, 0.84], [0.19, 1.64, 0.93], [0.14, 1.63, 1.0], [0.1, 1.61, 1.04]];
      const r = [0.022, 0.019, 0.017, 0.015, 0.012, 0.009, 0.003];
      b.loft(pts.map((c, i) => ({ c, rx: r[i] })), { ...beam, mirror });
      for (const [k, h] of [[2, 0.16], [3, 0.19], [4, 0.13]]) {
        const [x, y, z] = pts[k];
        b.loft([{ c: [x, y, z], rx: 0.012 }, { c: [x - 0.01, y + h * 0.55, z + 0.01], rx: 0.009 }, { c: [x - 0.025, y + h, z + 0.025], rx: 0.002 }], { ...beam, upRef: [1, 0, 0], mirror });
      }
    }
  }
  return b;
}

function createDeerKit() {
  const tex = paintHair({ size: 256, strands: 3400, len: [8, 16], width: 1.1, tips: 0.35, seed: 41 });
  const mat = coatMaterial(tex, COAT, { normalScale: 0.6 });
  const geos = { doe: deerBody(1, false).geometry(), buck: deerBody(1, true).geometry() };
  const farGeo = { doe: deerBody(0, false).geometry({ skinned: false }), buck: deerBody(0, true).geometry({ skinned: false }) };
  const inverses = DEER_BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0.1), 1.3);
  const far = {};
  for (const k of ['doe', 'buck']) {
    const inst = new THREE.InstancedMesh(farGeo[k], mat, 12);
    inst.count = 0;
    inst.visible = false; // only while it has some to draw (else it's in the render and shadow lists for nothing)
    inst.frustumCulled = false;
    inst.castShadow = true;
    inst.name = `deer far (${k})`;
    far[k] = inst;
  }
  function make(kind) {
    const bones = DEER_BONES.map((d) => { const bone = new THREE.Bone(); bone.name = d.name; return bone; });
    DEER_BONES.forEach((d, i) => {
      const parent = d.parent ? DEER_BONES[DB[d.parent]] : null;
      bones[i].position.set(d.at[0] - (parent?.at[0] || 0), d.at[1] - (parent?.at[1] || 0), d.at[2] - (parent?.at[2] || 0));
      if (parent) bones[DB[d.parent]].add(bones[i]);
    });
    const mesh = new THREE.SkinnedMesh(geos[kind], mat);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    mesh.boundingSphere = sphere;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = kind;
    return { mesh, bones, kind };
  }
  // a doe and a buck and their stand-ins, in no scene, on their own copies of the shapes: their shaders made ahead
  // (main.js' compileLater) rather than on the frame the herd first comes near
  function* toPrepare() {
    for (const k of ['doe', 'buck']) {
      const { mesh } = make(k);
      mesh.geometry = geos[k].clone();
      mesh.updateMatrixWorld(true);
      yield mesh;
      const inst = new THREE.InstancedMesh(farGeo[k].clone(), mat, 1);
      inst.castShadow = true;
      inst.updateMatrixWorld(true);
      yield inst;
    }
  }
  const bytes = (g) => Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength || 0);
  return {
    make, far, toPrepare,
    stats: { triangles: geos.buck.index.count / 3, farTriangles: farGeo.buck.index.count / 3,
      bytes: [...Object.values(geos), ...Object.values(farGeo)].reduce((s, g) => s + bytes(g), 0), textureBytes: tex.bytes },
    dispose() { for (const g of [...Object.values(geos), ...Object.values(farGeo)]) g.dispose(); tex.color.dispose(); tex.normal.dispose(); mat.dispose(); }
  };
}

// ============================================================================
// POSES: walking (four beats), bounding (the hinds push off together, the fores land together), grazing, alert
// ============================================================================
/**
 * p: { walk (0–1), bound (0–1), phase (0–1 through a stride), graze (head down), alert (head up, still), flag (the
 * tail up), look (the head turned, radians), flick (an ear-and-tail twitch, 0–1), time }. Returns how high the body
 * rides above the ground (a bound's leap).
 */
function poseDeer(bones, p) {
  const r = (n) => bones[DB[n]].rotation;
  const w = p.walk * (1 - p.bound), bd = p.bound, T = Math.PI * 2;
  // the stride: each leg's place in it, (walk) left hind, left fore, right hind, right fore; (bound) the hinds
  // together, the fores half a stride later, a little apart
  const legPhase = (fore, side) => {
    const walkP = fore ? (side > 0 ? 0.25 : 0.75) : (side > 0 ? 0 : 0.5);
    const boundP = fore ? 0.5 + (side > 0 ? 0 : 0.06) : (side > 0 ? 0 : 0.04);
    return p.phase + walkP * (1 - bd) + boundP * bd;
  };
  const aW = 0.3, aB = 0.85;
  for (const [side, s] of [[1, 'L'], [-1, 'R']]) {
    // forelegs: reach forward (negative x), the knee folding back as the foot comes through
    let ph = legPhase(true, side) * T;
    let swing = Math.sin(ph), fold = Math.max(0, Math.cos(ph));
    r('shoulder' + s).x = -(aW * w + aB * bd) * swing - 0.04 * p.graze;
    r('elbow' + s).x = 0.15 * fold * (w + bd) - 0.06 * p.graze;
    r('knee' + s).x = (0.9 * w + 1.6 * bd) * fold;
    r('fetlock' + s).x = (0.5 * w + 0.7 * bd) * fold - 0.1 * (w + bd) * Math.max(0, -Math.cos(ph));
    // hind legs: swing from the hip, the hock folding as the foot comes through
    ph = legPhase(false, side) * T;
    swing = Math.sin(ph); fold = Math.max(0, Math.cos(ph));
    r('thigh' + s).x = -(aW * w + aB * 0.95 * bd) * swing + 0.05 * p.graze;
    r('stifle' + s).x = (0.35 * w + 0.6 * bd) * fold;
    r('hock' + s).x = -(0.65 * w + 1.1 * bd) * fold;
    r('hfet' + s).x = (0.45 * w + 0.6 * bd) * fold;
  }
  // the back: still at a walk, rocking through a bound; the head bobbing with a walk's stride
  const rock = Math.sin(p.phase * T);
  r('hips').x = 0.12 * bd * rock;
  r('spine').x = -0.05 * bd * rock;
  r('chest').x = -0.08 * bd * rock + 0.06 * p.graze;
  // the neck: down to the grass to graze, up straight when alert, stretched out ahead in a bound
  const bob = 0.05 * w * Math.sin(p.phase * T * 2);
  r('neck').x = 1.55 * p.graze - 0.12 * p.alert + 0.55 * bd + bob;
  r('neck2').x = 0.5 * p.graze - 0.1 * p.alert + 0.15 * bd;
  r('head').x = -0.8 * p.graze - 0.35 * bd + 0.04 * Math.sin(p.time * 1.7) * p.graze;
  r('neck2').y = p.look * 0.45;
  r('head').y = p.look * 0.55;
  r('head').z = 0.05 * p.flick * Math.sin(p.time * 22);
  // the tail: hanging and twitching, or flagged straight up and over
  r('tail').x = 2.3 * p.flag + 0.12 * p.flick * Math.sin(p.time * 17);
  r('tail').z = 0.25 * p.flick * Math.sin(p.time * 13) * (1 - p.flag);
  return 0.38 * bd * Math.max(0, Math.sin((p.phase + 0.1) * T)) + 0.02 * w * Math.abs(Math.sin(p.phase * T * 2));
}

// ============================================================================
// THE HERDS
// ============================================================================
function createDeer(group, { parkAt, treesNear }) {
  const arb = (GEO.parks || []).find((p) => p.name === 'Nichols Arboretum');
  if (!arb) return { update() {}, deer: [], get count() { return 0; }, *toPrepare() {}, dispose() {} };
  const kit = createDeerKit();
  for (const m of Object.values(kit.far)) group.add(m);
  const inArb = (x, z) => parkAt(x, z)?.name === 'Nichols Arboretum';
  const open = (x, z) => inArb(x, z) && riverDepth(x, z) < 0.02 && riverDepth(x + 6, z) < 0.02 && riverDepth(x - 6, z) < 0.02 && riverDepth(x, z + 6) < 0.02 && riverDepth(x, z - 6) < 0.02;

  // their meadows: the Arb's open ground away from the river, two of them fixed by the map so they're always there
  const ring = arb.rings[0];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const meadows = [];
  const R = stream(hash(x0, z0, 5));
  for (let tries = 0; tries < 400 && meadows.length < 2; tries++) {
    const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
    if (!open(x, z) || ![[14, 0], [-14, 0], [0, 14], [0, -14]].every(([dx, dz]) => open(x + dx, z + dz))) continue;
    if (meadows.some((m) => Math.hypot(m.x - x, m.z - z) < 160)) continue;
    meadows.push({ x, z, size: meadows.length === 0 ? 4 : 3, buck: meadows.length === 0 });
  }

  const deer = [];
  const bodies = { doe: [], buck: [] };
  let everOut = false, herdsOut = false, checkedAt = -10, goneAt = -1e9, reported = false, lastLog = 0, hours = false;

  function takeBody(d) {
    if (d.body) return;
    d.body = bodies[d.kind].pop() || kit.make(d.kind);
    group.add(d.body.mesh);
    d.body.mesh.visible = true;
  }
  function dropBody(d) {
    if (!d.body) return;
    d.body.mesh.visible = false;
    group.remove(d.body.mesh);
    bodies[d.kind].push(d.body);
    d.body = null;
  }

  function populate() {
    for (const m of meadows) {
      const r = stream(hash(m.x, m.z, Math.floor(checkedAt / 600)));
      for (let k = 0; k < m.size; k++) {
        const a = r() * Math.PI * 2, rr = 2 + r() * 9;
        let x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
        if (!open(x, z)) { x = m.x; z = m.z; }
        const kind = m.buck && k === 0 ? 'buck' : 'doe';
        deer.push({
          kind, meadow: m, x, z, y: groundHeight(x, z), yaw: r() * Math.PI * 2, scale: kind === 'buck' ? 1.1 : 0.92 + r() * 0.1,
          mode: 'graze', timer: 2 + r() * 8, speed: 0, tx: x, tz: z, r,
          pose: { walk: 0, bound: 0, phase: r(), graze: 1, alert: 0, flag: 0, look: 0, flick: 0, time: 0 },
          want: { graze: 1, alert: 0, look: 0 }, wary: 0, body: null, q: new THREE.Quaternion()
        });
      }
    }
    herdsOut = true;
    log(`[deer] ${deer.length} deer out in the Arb`);
  }
  function clear() {
    for (const d of deer) dropBody(d);
    for (const m of Object.values(kit.far)) { m.count = 0; m.visible = false; }
    deer.length = 0;
    herdsOut = false;
  }

  const ease = (v, to, k) => v + (to - v) * k;
  function think(d, dt, now, threats) {
    // what's near: the nearest threat, by how much it matters (a vehicle counts as nearer, a still person farther)
    let near = null, nd = Infinity;
    for (const t of threats) {
      if (t.air && t.y - d.y > 25) continue;
      const dd = Math.hypot(t.x - d.x, t.z - d.z);
      const weigh = t.foot ? (t.player && t.speed < 0.35 ? 1.6 : 1) : t.loud ? 0.55 : 0.8;
      if (dd * weigh < nd) { nd = dd * weigh; near = t; }
    }
    // (Lamp: anything that reaches one sends it off at a bound, as anything coming close does (below); it used to vanish
    // there and then, before the player's eyes. Nothing disappears in view)
    // fled or leaving, it's let go only where no one sees it go: out of the view or far off
    if (d.mode === 'flee') {
      d.timer -= dt;
      if (d.timer <= 0 && hidden(d)) d.mode = 'gone';
      return;
    }
    if (d.mode === 'leave') {
      d.timer -= dt;
      if (hidden(d)) d.mode = 'gone';
      return;
    }
    if (nd < 17) {
      // too close: off at a bound, tail up, away from it and a little to one side
      const a = Math.atan2(d.x - near.x, d.z - near.z) + (d.r() - 0.5) * 0.7;
      d.mode = 'flee'; d.yawTo = a; d.timer = 6 + d.r() * 2;
      if (!d.fledCue) { d.fledCue = true; cue?.('snort', { x: d.x, y: d.y + 0.8, z: d.z }, 0.7); }
      // the herd goes with it
      for (const o of deer) if (o !== d && o.mode !== 'gone' && o.mode !== 'flee' && Math.hypot(o.x - d.x, o.z - d.z) < 40) {
        o.mode = 'flee'; o.yawTo = a + (o.r() - 0.5) * 0.5; o.timer = 6 + o.r() * 2.5;
      }
      return;
    }
    if (nd < 38) {
      // watched: head up, still, facing it, the tail twitching
      d.wary = Math.min(1, d.wary + dt * 2);
      d.mode = 'alert';
      d.want.graze = 0; d.want.alert = 1;
      const toward = Math.atan2(near.x - d.x, near.z - d.z);
      let rel = ((toward - d.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(rel) > 1.1) { d.yaw += Math.sign(rel) * Math.min(Math.abs(rel) - 1.1, dt * 0.8); rel = Math.sign(rel) * 1.1; }
      d.want.look = rel;
      // someone standing still a while is let be: back to grazing, an eye kept on them
      if (near.player && near.foot && near.speed < 0.35 && (near.still || 0) > STILL_LET_BE) {
        d.mode = 'graze'; d.want.graze = 1; d.want.alert = 0; d.timer = Math.max(d.timer, 3);
        return;
      }
      if (near.player && near.foot && near.speed < 0.35 && nd > 26) d.want.alert = 0.4;
      return;
    }
    d.wary = Math.max(0, d.wary - dt * 0.25);
    if (d.mode === 'alert' && d.wary > 0.2) { d.want.look *= 0.98; return; }
    d.want.look = Math.sin(now * 0.3 + d.x) * 0.25;
    d.timer -= dt;
    if (d.mode === 'alert') { d.mode = 'graze'; d.timer = 3 + d.r() * 6; }
    if (d.mode === 'graze') {
      d.want.graze = 1; d.want.alert = 0;
      if (d.timer <= 0) {
        // on a few steps to fresh grass, near the herd's meadow
        const m = d.meadow;
        for (let k = 0; k < 6; k++) {
          const a = d.r() * Math.PI * 2, rr = 2 + d.r() * 12;
          const x = m.x + Math.cos(a) * rr, z = m.z + Math.sin(a) * rr;
          if (open(x, z)) { d.tx = x; d.tz = z; break; }
        }
        d.mode = 'walk'; d.timer = 14;
        if (d.r() < 0.3) d.pose.flick = 1;
      }
    } else if (d.mode === 'walk') {
      d.want.graze = 0; d.want.alert = 0.2;
      if (Math.hypot(d.tx - d.x, d.tz - d.z) < 0.6 || d.timer <= 0) { d.mode = 'graze'; d.timer = 6 + d.r() * 14; }
    }
  }

  function move(d, dt, now) {
    const p = d.pose;
    let speed = 0;
    if (d.mode === 'walk' || d.mode === 'leave') {
      const a = Math.atan2(d.tx - d.x, d.tz - d.z);
      const rel = ((a - d.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      d.yaw += Math.sign(rel) * Math.min(Math.abs(rel), dt * 1.4);
      speed = Math.abs(rel) < 1 ? 1.1 : 0.3;
    } else if (d.mode === 'flee') {
      const rel = ((d.yawTo - d.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      d.yaw += Math.sign(rel) * Math.min(Math.abs(rel), dt * 3.2);
      speed = 12;
    }
    d.speed = ease(d.speed, speed, Math.min(1, dt * (d.mode === 'flee' ? 3 : 2)));
    d.x += Math.sin(d.yaw) * d.speed * dt;
    d.z += Math.cos(d.yaw) * d.speed * dt;
    // fleeing, it keeps to land: water ahead turns it along the bank
    if (d.mode === 'flee' && riverDepth(d.x + Math.sin(d.yaw) * 4, d.z + Math.cos(d.yaw) * 4) > 0.05) d.yawTo += dt * 2.5;
    d.y = groundHeight(d.x, d.z);
    // the stride: a walk's 1.6 m, a bound's 4.5 m
    const bounding = d.speed > 3.2;
    p.bound = ease(p.bound, bounding ? 1 : 0, Math.min(1, dt * 4));
    p.walk = ease(p.walk, Math.min(1, d.speed / 0.9), Math.min(1, dt * 4));
    p.phase = (p.phase + dt * (bounding ? d.speed / 4.5 : Math.max(0.05, d.speed) / 1.6)) % 1;
    const k = Math.min(1, dt * 2.5);
    p.graze = ease(p.graze, d.mode === 'graze' ? d.want.graze : 0, k);
    p.alert = ease(p.alert, d.mode === 'alert' ? d.want.alert : d.mode === 'walk' ? 0.2 : 0, k);
    p.look = ease(p.look, d.mode === 'flee' ? 0 : d.want.look, k);
    p.flag = ease(p.flag, d.mode === 'flee' ? 1 : 0, Math.min(1, dt * 5));
    p.flick = Math.max(d.mode === 'alert' ? 0.5 : 0, p.flick - dt * 0.6);
    p.time = now;
    // a grazing deer takes a slow step now and then without lifting its head
    if (d.mode === 'graze') p.walk = Math.max(p.walk, 0.12 * Math.max(0, Math.sin(now * 0.35 + d.x)) ** 8);
  }

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function draw(d, near) {
    d.q.setFromAxisAngle(_up, d.yaw);
    if (near) {
      takeBody(d);
      const lift = poseDeer(d.body.bones, d.pose);
      const m = d.body.mesh;
      m.quaternion.copy(d.q);
      m.position.set(d.x, d.y + lift * d.scale, d.z);
      m.scale.setScalar(d.scale);
    } else {
      dropBody(d);
      const far = kit.far[d.kind];
      if (far.count >= far.instanceMatrix.count) return;
      const lift = d.pose.bound * 0.3 * Math.max(0, Math.sin(d.pose.phase * Math.PI * 2));
      _m.compose(_p.set(d.x, d.y + lift * d.scale, d.z), d.q, _s.setScalar(d.scale));
      far.setMatrixAt(far.count++, _m);
    }
  }

  // out of sight: beyond HIDE or outside the view
  const frustum = new THREE.Frustum(), _vp = new THREE.Matrix4(), _sph = new THREE.Sphere(new THREE.Vector3(), 1.6);
  let camAt = null;
  function hidden(d) {
    if (!camAt || (d.x - camAt.x) ** 2 + (d.z - camAt.z) ** 2 > HIDE * HIDE) return true;
    _sph.center.set(d.x, d.y + 0.8, d.z);
    return !frustum.intersectsSphere(_sph);
  }
  // where a deer leaving at the end of dawn or dusk walks to: a few metres in past the nearest tree that isn't toward
  // the camera, or else the nearest edge of its open ground (the woods, the river bank, the Arb's end)
  const nearTrees = [];
  function cover(d, cp) {
    let best = null, bestScore = Infinity;
    for (const t of treesNear ? treesNear(d.x, d.z, 70, nearTrees) : []) {
      const dd = Math.hypot(t.x - d.x, t.z - d.z);
      if (dd < 4) continue;
      const toward = Math.hypot(t.x - cp.x, t.z - cp.z) < Math.hypot(d.x - cp.x, d.z - cp.z);
      const score = dd + (toward ? 40 : 0);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) {
      const dd = Math.hypot(best.x - d.x, best.z - d.z);
      d.tx = best.x + (best.x - d.x) / dd * 5; d.tz = best.z + (best.z - d.z) / dd * 5;
      return;
    }
    let edge = null;
    for (let r = 6; r <= 90 && !edge; r += 6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, x = d.x + Math.sin(a) * r, z = d.z + Math.cos(a) * r;
        if (!open(x, z) && (!edge || Math.hypot(x - cp.x, z - cp.z) > Math.hypot(edge[0] - cp.x, edge[1] - cp.z))) edge = [x, z];
      }
    }
    if (edge) { d.tx = edge[0]; d.tz = edge[1]; return; }
    const a = Math.atan2(d.x - cp.x, d.z - cp.z);
    d.tx = d.x + Math.sin(a) * 40; d.tz = d.z + Math.cos(a) * 40;
  }

  let cue = null;
  const order = [];
  function update(dt, now, ctx, threats) {
    cue = ctx.cue || null;
    const cp = ctx.camera.position;
    if (now - checkedAt > 2) {
      checkedAt = now;
      hours = HOURS.has(ctx.look);
      const d = Math.min(...meadows.map((m) => Math.hypot(m.x - cp.x, m.z - cp.z)), Infinity);
      // out at dawn and dusk when someone's near and they haven't just fled, never coming into being in plain sight (but
      // where the game opens); off into the trees when it gets light or dark
      if (!herdsOut && hours && d < ALIVE && now - goneAt > 90 && (d > 140 || !everOut)) { everOut = true; populate(); }
      else if (herdsOut && d > LET_GO) clear();
      else if (herdsOut && !hours) for (const o of deer) if (o.mode !== 'gone' && o.mode !== 'flee' && o.mode !== 'leave') {
        o.mode = 'leave'; o.timer = 60; cover(o, cp);
      }
    }
    if (!herdsOut) return;
    const cam = ctx.camera;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(_vp, cam.coordinateSystem);
    camAt = cp;
    order.length = 0;
    for (const d of deer) {
      if (d.mode !== 'gone') think(d, dt, now, threats);
      if (d.mode === 'gone') { dropBody(d); continue; }
      move(d, dt, now);
      d.d2 = (d.x - cp.x) ** 2 + (d.y - cp.y) ** 2 + (d.z - cp.z) ** 2;
      order.push(d);
    }
    for (const m of Object.values(kit.far)) m.count = 0;
    for (const d of order) draw(d, d.d2 < NEAR_DIST * NEAR_DIST);
    for (const m of Object.values(kit.far)) { m.instanceMatrix.needsUpdate = m.count > 0; m.visible = m.count > 0; }
    // all gone (fled or wandered off): back another time
    if (!order.length) { clear(); goneAt = now; log('[deer] the deer have gone into the trees'); }
    if (!reported) {
      reported = true;
      log(`[deer] ${kit.stats.triangles} triangles near, ${kit.stats.farTriangles} far; ${((kit.stats.bytes + kit.stats.textureBytes) / 1024).toFixed(0)} KB; meadows at ${meadows.map((m) => `${m.x.toFixed(0)},${m.z.toFixed(0)}`).join(' and ')}`);
    }
    if (now - lastLog > 30) {
      lastLog = now;
      const n = (m) => order.filter((d) => d.mode === m).length;
      log(`[deer] ${order.length} about (${n('graze')} grazing, ${n('walk')} walking, ${n('alert')} watching, ${n('flee')} running)`);
    }
  }

  return {
    update, deer, toPrepare: kit.toPrepare,
    get count() { return deer.length; },
    dispose() { clear(); kit.dispose(); }
  };
}

export { createDeer, poseDeer };
