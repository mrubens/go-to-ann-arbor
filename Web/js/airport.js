import * as THREE from 'three/webgpu';
import { TIER } from './device-tier.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log, save, load } from '../lamp-game.js';
import { groundHeight, drapeGeometry, drawOver } from './terrain.js';
import { AIRPORT } from './airport-data.js';
import {
  buildHelicopterBodyGeometry, buildHelicopterMainRotorGeometry, buildHelicopterTailRotorGeometry, createLoftedHelicopterMaterial
} from './helicopter.js';

// Lamp: Ann Arbor Municipal Airport (ARB), south of town off State Street, where OpenStreetMap has it (airport-data.js,
// Assets/Tools/build-airport.py): the paved runway 6/24 with its threshold bars, numbers' blocks and centerline, the
// mown grass strip 12/30, the taxiways with their yellow lines, the aprons, the T-hangars and the FBO, windsocks, and
// three helicopters parked in a row on the apron by the FBO, seven high-wing planes tied down on two aprons, rolling
// airstairs to run up and jump off (`stairTop`, controllers.js rampTop), fuel trucks, baggage tugs and cones. Inside
// its fence the player may walk and drive (`onAirfield`, controllers.js), and on foot beside a parked helicopter or
// plane, F takes it (`nearest`, `take`: its spot stands empty while it's the player's; `dress` makes the player's
// flying machine that kind, and controllers.js updatePlane flies a plane).

// Every part merged the same way: non-indexed, with only position, normal and uv; null when nothing merges, so a
// failed merge is never drawn
function merged(geos) {
  const flat = geos.filter(Boolean).map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    n.morphAttributes = {};
    return n;
  });
  if (!flat.length) return null;
  const g = mergeGeometries(flat);
  if (!g) log('[airport] a set of parts did not merge and is left out');
  return g;
}

const pts = (f) => { const out = []; for (let i = 0; i < f.length; i += 2) out.push({ x: f[i], z: f[i + 1] }); return out; };
const FENCE = pts(AIRPORT.bounds);
const BOX = FENCE.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z) }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

function inRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
// inside the airport's fence (and a few metres in from it)
function onAirfield(x, z) {
  return x > BOX.minX && x < BOX.maxX && z > BOX.minZ && z < BOX.maxZ && inRing(FENCE, x, z);
}
const AIRFIELD_CENTRE = { x: 160, z: 6110 };
// the airport's buildings' outlines, and whether a footprint (points [across, along] from (x, z), turned by heading)
// stands clear of them all
const RINGS = AIRPORT.buildings.map((b) => pts(b.ring));
function clearOfBuildings(x, z, heading, foot) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return foot.every(([u, v]) => !RINGS.some((r) => inRing(r, x + u * c + v * s, z - u * s + v * c)));
}
// a parked plane's: its nose, tail and wingtips, a little out (heading +z is its nose)
const PLANE_FOOT = [[0, 0], [-5.8, 1], [5.8, 1], [-3, 1], [3, 1], [0, 3.6], [0, -4.8], [0, -2.4], [-1.9, -3.8], [1.9, -3.8]];
// an airstair truck's: its cab, flight and back corners (heading +z is its front)
const STAIR_FOOT = [[0, 0], [-1.2, -5], [1.2, -5], [-1.2, 5.6], [1.2, 5.6], [-1.2, 0], [1.2, 0]];

// a flat polygon in world x/z at height 0 (draped on the ground later)
function flatShape(ring) {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g.toNonIndexed();
}
// a rectangle centred on (x, z), `len` along the direction (dx, dz) and `w` across
function rect(x, z, dx, dz, len, w) {
  const hx = len / 2, hw = w / 2;
  return [[-hx, -hw], [hx, -hw], [hx, hw], [-hx, hw]].map(([a, b]) => ({ x: x + dx * a - dz * b, z: z + dz * a + dx * b }));
}
// a strip `w` wide along a polyline: one rectangle a segment, with a square at each bend
function along(line, w, out) {
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2], az = line[i - 1], bx = line[i], bz = line[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (l < 0.5) continue;
    out.push(flatShape(rect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / l, (bz - az) / l, l + w * 0.5, w)));
  }
}

// how far the airport's pavement stands over the ground (layer), so what's parked on it stands on it
const PAVE = 0.22;
function layer(group, geos, color, lift, name, rough = 0.9) {
  if (!geos.length) return;
  // over the town's lawns (LIFT.lawn, 18 cm), which the airport's fence is now one of
  const flat = merged(geos);
  if (!flat) return;
  const g = drapeGeometry(flat, 0.05);
  g.translate(0, PAVE + lift, 0);
  const mat = drawOver(new THREE.MeshStandardNodeMaterial({ color, roughness: rough, metalness: 0 }), 0.05 + lift);
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.receiveShadow = true;
  m.userData.terrain = 'set';
  group.add(m);
}

// A high-wing four-seater (about 8.3 m long, 11 m span), nose to +z, wheels on y -0.25 so it stands where a
// helicopter's skids would: one geometry for each paint, so the parked ones share them and the player's gets its own.
// The fuselage is lofted through rounded sections, the wings and tail are true airfoils, the wheels sit in fairings,
// and the cabin glass, the cheat line and the wingtip lights are bands of the same surfaces. The propeller is a group
// of its own (userData.prop) to spin.
function rod(a, b, r, sides = 8) {
  const d = new THREE.Vector3().subVectors(b, a), l = d.length();
  const g = new THREE.CylinderGeometry(r, r, l, sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// the fuselage's sections, nose to tail: z, half width, half height, centre height
const HULL = [
  [3.32, 0.16, 0.16, 1.38], [3.22, 0.36, 0.34, 1.37], [3.0, 0.5, 0.47, 1.37], [2.6, 0.57, 0.56, 1.39], [2.2, 0.6, 0.63, 1.45],
  [1.7, 0.61, 0.7, 1.55], [1.1, 0.61, 0.73, 1.6], [0.2, 0.6, 0.72, 1.6], [-0.6, 0.53, 0.64, 1.63], [-1.6, 0.42, 0.52, 1.7],
  [-2.8, 0.29, 0.38, 1.8], [-3.9, 0.18, 0.26, 1.9], [-4.7, 0.08, 0.14, 1.97]
];
function hullAt(z) {
  for (let i = 1; i < HULL.length; i++) {
    const a = HULL[i - 1], b = HULL[i];
    if (z <= a[0] && z >= b[0]) { const t = (a[0] - z) / (a[0] - b[0]); return a.map((v, k) => v + (b[k] - v) * t); }
  }
  return z > HULL[0][0] ? HULL[0] : HULL[HULL.length - 1];
}
// a patch of the rounded hull from z0 down to z1, between angles a0 and a1 (0 is the right side, pi/2 the top), `grow`
// metres proud of it; the whole of it by default, closed at the tail
function hull(z0 = HULL[0][0], z1 = HULL[HULL.length - 1][0], a0 = 0, a1 = Math.PI * 2, grow = 0, rings = 26, around = 28) {
  const pos = [], uv = [], idx = [];
  const sq = (c, e) => Math.sign(c) * Math.abs(c) ** e;
  for (let i = 0; i <= rings; i++) {
    const z = z0 + (z1 - z0) * (i / rings), [, hw, hh, cy] = hullAt(z);
    for (let j = 0; j <= around; j++) {
      const a = a0 + (a1 - a0) * (j / around), c = Math.cos(a), s = Math.sin(a);
      pos.push(sq(c, 0.8) * (hw + grow), cy + sq(s, 0.8) * (hh + grow), z);
      uv.push(j / around, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < around; j++) {
    const p = i * (around + 1) + j, q = p + around + 1;
    idx.push(p, q, p + 1, p + 1, q, q + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// an airfoil (12% thick, a little camber) of `chord`, its leading edge at z = lead, spanning x0..x1 at height y
function airfoil(chord, thick, x0, x1, y, lead, steps = 14) {
  const top = [], bottom = [];
  for (let i = 0; i <= steps; i++) {
    const u = (1 - Math.cos((i / steps) * Math.PI)) / 2;
    const t = 5 * thick * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
    const camber = 0.03 * thick * 4 * u * (1 - u);
    top.push(new THREE.Vector2(u * chord, (camber + t) * chord));
    bottom.push(new THREE.Vector2(u * chord, (camber - t) * chord));
  }
  const shape = new THREE.Shape([...top, ...bottom.reverse().slice(1, -1)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 4 });
  return g.rotateY(Math.PI / 2).translate(x0, y, lead);
}
// a flat side profile (z, y pairs) `w` thick, centred on x = 0
function profile(zy, w) {
  const shape = new THREE.Shape(zy.map(([z, y]) => new THREE.Vector2(-z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: w * 0.3, bevelSize: w * 0.3, bevelSegments: 2 })
    .rotateY(Math.PI / 2).translate(-w / 2, 0, 0);
}
function planeGeometries() {
  const white = [], glass = [], dark = [], stripe = [], red = [], green = [];
  const H = Math.PI / 2;
  white.push(hull());
  // the cabin glass: the windscreen sweeping up to the wing, and the side windows, each side
  glass.push(hull(2.16, 1.62, H - 0.95, H + 0.95, 0.012, 8, 16));
  for (const [lo, hi] of [[0.28, 1.02], [Math.PI - 1.02, Math.PI - 0.28]]) {
    glass.push(hull(1.5, 0.45, lo, hi, 0.012, 6, 8));
    glass.push(hull(0.3, -0.5, lo + 0.02, hi - 0.07, 0.012, 6, 8));
  }
  // the cheat line along each side, and the cowling's dark air inlets
  for (const [lo, hi] of [[-0.3, -0.06], [Math.PI + 0.06, Math.PI + 0.3]]) stripe.push(hull(3.0, -4.5, lo, hi, 0.008, 22, 4));
  dark.push(hull(3.27, 3.18, -H - 0.9, -H + 0.9, 0.01, 1, 10));
  // the high wing on the cabin roof, its tips, the struts down to the belly
  const wingY = 2.24;
  white.push(airfoil(1.6, 0.12, -5.5, 5.5, wingY, 1.75));
  for (const s of [-1, 1]) {
    white.push(new THREE.SphereGeometry(0.1, 10, 6).scale(1, 1, 8).translate(s * 5.5, wingY + 0.04, 0.95));
    (s > 0 ? red : green).push(new THREE.SphereGeometry(0.06, 8, 6).translate(s * 5.56, wingY + 0.04, 1.55));
    white.push(rod(V(s * 0.55, 1.0, 0.85), V(s * 2.8, wingY, 1.0), 0.045));
    white.push(rod(V(s * 0.55, 1.0, 0.55), V(s * 2.8, wingY, 0.4), 0.035));
  }
  // the tailplane and the swept fin with its dorsal fillet
  white.push(airfoil(1.0, 0.09, -1.85, 1.85, 1.9, -3.75));
  white.push(profile([[-2.6, 2.0], [-3.75, 2.55], [-4.3, 3.25], [-4.72, 3.25], [-4.75, 1.95]], 0.1));
  stripe.push(profile([[-4.0, 2.75], [-4.36, 3.0], [-4.72, 3.0], [-4.73, 2.75]], 0.13));
  // the gear: two mains on spring-steel legs, the nose wheel on its oleo, each in a fairing
  for (const s of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.08, 1.15, 0.16);
    leg.rotateZ(s * 0.95).translate(s * 0.88, 0.5, 0.5);
    white.push(leg);
    dark.push(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 16).rotateZ(H).translate(s * 1.32, 0.05, 0.5));
    white.push(new THREE.SphereGeometry(0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.6, 0.9, 1.75).translate(s * 1.32, 0.12, 0.45));
  }
  white.push(rod(V(0, 0.9, 2.75), V(0, 0.05, 2.85), 0.05));
  dark.push(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 16).rotateZ(H).translate(0, 0.0, 2.85));
  white.push(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(0.5, 0.85, 1.6).translate(0, 0.07, 2.82));
  // the exhaust, the antenna on the roof, the step and the beacon on the fin
  dark.push(rod(V(0.25, 0.92, 2.5), V(0.28, 0.82, 2.0), 0.045));
  dark.push(rod(V(0, 2.3, -0.4), V(0, 2.65, -0.8), 0.012, 4));
  red.push(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 3.3, -4.55));
  // the propeller: a rounded spinner and two tapered blades, turning about z
  const blade = (s) => {
    const b = new THREE.CylinderGeometry(0.035, 0.085, 0.92, 8).scale(1, 1, 0.25).translate(0, 0.52, 0).rotateY(0.35);
    return s < 0 ? b.rotateZ(Math.PI) : b;
  };
  const prop = [new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(H).scale(1, 1, 1.6).translate(0, 0, -0.12), blade(1), blade(-1)];
  const m = merged;
  return { white: m(white), glass: m(glass), dark: m(dark), stripe: m(stripe), red: m(red), green: m(green), prop: m(prop) };
}
const PLANE_VERSION = 2; // raised when the plane's model changes, so the player's own is made again
const PAINTS = [0xb3262d, 0x1f3f7a, 0x2c6e49, 0xd99a1e];
function planeMaterials(paint) {
  const std = (color, roughness = 0.5, metalness = 0.1) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
  const lamp = (color) => { const m = std(color, 0.4); m.emissive = new THREE.Color(color); m.emissiveIntensity = 0.8; return m; };
  return { white: std(0xf1f1ee, 0.35, 0.15), glass: std(0x1c2630, 0.08, 0.6), dark: std(0x1d1d1f, 0.85), stripe: std(paint, 0.4), red: lamp(0xe0241b), green: lamp(0x22c25a), prop: std(0x2a2a2c, 0.5, 0.4) };
}
function makePlane(geos, mats) {
  const g = new THREE.Group();
  for (const k of ['white', 'glass', 'dark', 'stripe', 'red', 'green']) {
    const m = new THREE.Mesh(geos[k], mats[k]);
    // the glass and the little lamps cast no shadow worth its draws
    m.castShadow = k === 'white' || k === 'dark' || k === 'stripe';
    m.receiveShadow = k === 'white';
    g.add(m);
  }
  const prop = new THREE.Group();
  prop.position.set(0, 1.38, 3.42);
  const blade = new THREE.Mesh(geos.prop, mats.prop);
  blade.castShadow = false;
  prop.add(blade);
  g.add(prop);
  g.userData.prop = prop;
  return g;
}

// Rolling airstairs on a truck: a flight of 18 treads 2.2 m wide from 0.35 m at the back up to a landing at 4.95 m
// over the cab, climbing toward its heading (+z). `stairTop` is what the player rides up, so a car or bike run at them
// from behind takes off the landing (controllers.js rampTop); and it's driven as a road work machine is (controllers.js
// createMachineEntity, kind 'stairtruck'), the same model, made here in its own frame on the ground.
const STAIR = { back: -5, top: 4.5, end: 5.6, half: 1.15, low: 0.35, high: 4.95 };
function roundBox(w, h, d, r) {
  const x = w / 2 - r, y = h / 2 - r, shape = new THREE.Shape();
  shape.moveTo(-x, -h / 2); shape.lineTo(x, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  shape.lineTo(w / 2, y); shape.quadraticCurveTo(w / 2, h / 2, x, h / 2); shape.lineTo(-x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); shape.lineTo(-w / 2, -y); shape.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const b = Math.min(r * 0.5, d * 0.2);
  return new THREE.ExtrudeGeometry(shape, { depth: d - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 4 })
    .translate(0, 0, -d / 2 + b);
}
function stairTruckGeometries() {
  const P = { yellow: [], steel: [], dark: [], rubber: [], glass: [], white: [], amber: [], red: [] };
  const run = STAIR.top - STAIR.back, rise = STAIR.high - STAIR.low, at = (t) => STAIR.low + (t / run) * rise;
  const H = Math.PI / 2;
  // the chassis rails, the body over the axles, and the cab under the landing
  for (const x of [-0.55, 0.55]) P.dark.push(new THREE.BoxGeometry(0.16, 0.28, 10).translate(x, 0.7, 0.2));
  P.yellow.push(roundBox(2.3, 0.62, 5.7, 0.12).translate(0, 0.98, 0.45));
  P.yellow.push(roundBox(2.3, 2.05, 2.2, 0.22).translate(0, 1.62, 4.42));
  P.dark.push(new THREE.BoxGeometry(2.34, 0.06, 5.7).translate(0, 0.7, 0.45));
  // the cab's glass all round, door seams, grille, lamps, bumper, mirrors and the beacon on its roof
  P.glass.push(new THREE.BoxGeometry(1.95, 0.85, 0.04).rotateX(-0.08).translate(0, 2.08, 5.53));
  for (const s of [-1, 1]) {
    P.glass.push(new THREE.BoxGeometry(0.04, 0.75, 1.25).translate(s * 1.16, 2.1, 4.55));
    for (const z of [3.85, 5.15]) P.dark.push(new THREE.BoxGeometry(0.03, 1.55, 0.03).translate(s * 1.165, 1.55, z));
    P.dark.push(new THREE.BoxGeometry(0.03, 0.04, 0.22).translate(s * 1.17, 1.6, 4.0));
    P.white.push(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14).rotateX(H).translate(s * 0.82, 1.12, 5.53));
    P.amber.push(new THREE.BoxGeometry(0.2, 0.1, 0.04).translate(s * 1.0, 0.92, 5.53));
    P.dark.push(rod(V(s * 1.15, 2.45, 5.3), V(s * 1.42, 2.45, 5.4), 0.025));
    P.dark.push(roundBox(0.1, 0.36, 0.2, 0.03).translate(s * 1.46, 2.3, 5.4));
    P.red.push(new THREE.BoxGeometry(0.22, 0.14, 0.04).translate(s * 0.9, 1.0, -2.36));
  }
  P.dark.push(new THREE.BoxGeometry(1.3, 0.36, 0.04).translate(0, 1.12, 5.53));
  P.dark.push(roundBox(2.45, 0.24, 0.26, 0.06).translate(0, 0.6, 5.64));
  P.dark.push(roundBox(2.4, 0.2, 0.2, 0.05).translate(0, 0.66, -2.42));
  P.amber.push(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 12).translate(0.75, 2.76, 3.7));
  // the wheels, their hubs and the fenders over them
  for (const s of [-1, 1]) for (const z of [-3.0, 3.6]) {
    P.rubber.push(new THREE.CylinderGeometry(0.46, 0.46, 0.34, 20).rotateZ(H).translate(s * 1.0, 0.46, z));
    P.rubber.push(new THREE.TorusGeometry(0.4, 0.08, 6, 20).rotateY(H).translate(s * 1.0, 0.46, z));
    P.steel.push(new THREE.CylinderGeometry(0.25, 0.25, 0.36, 12).rotateZ(H).translate(s * 1.0, 0.46, z));
    P.dark.push(new THREE.CylinderGeometry(0.08, 0.08, 0.38, 8).rotateZ(H).translate(s * 1.0, 0.46, z));
    if (z < 0) P.yellow.push(new THREE.CylinderGeometry(0.56, 0.56, 0.4, 16, 1, true, 0, Math.PI).rotateZ(H).translate(s * 1.0, 0.46, z));
  }
  // the rear frame the bottom of the flight rests on
  for (const x of [-0.9, 0.9]) P.steel.push(rod(V(x, 0.62, -2.3), V(x, 0.2, -4.9), 0.07));
  P.steel.push(new THREE.BoxGeometry(2.0, 0.12, 0.3).translate(0, 0.18, -4.85));
  // the flight: stringers, eighteen treads with yellow safety nosing and a riser under each
  const len = Math.hypot(run, rise), slope = Math.atan2(rise, run);
  for (const s of [-1, 1]) P.yellow.push(new THREE.BoxGeometry(0.1, 0.34, len).rotateX(-slope).translate(s * (STAIR.half - 0.05), (STAIR.low + STAIR.high) / 2 - 0.12, (STAIR.back + STAIR.top) / 2));
  const n = 18, step = run / n;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) * step, y = at(t + step / 2) - 0.03, z = STAIR.back + t;
    P.steel.push(new THREE.BoxGeometry(STAIR.half * 2 - 0.2, 0.05, step).translate(0, y, z));
    P.yellow.push(new THREE.BoxGeometry(STAIR.half * 2 - 0.2, 0.055, 0.06).translate(0, y + 0.005, z + step / 2 - 0.03));
    P.dark.push(new THREE.BoxGeometry(STAIR.half * 2 - 0.2, rise / n, 0.02).translate(0, y - rise / n / 2, z - step / 2));
  }
  // the landing, its kick plates and the posts down to the cab
  P.steel.push(new THREE.BoxGeometry(STAIR.half * 2, 0.12, STAIR.end - STAIR.top).translate(0, STAIR.high - 0.06, (STAIR.top + STAIR.end) / 2));
  P.dark.push(new THREE.BoxGeometry(STAIR.half * 2, 0.2, STAIR.end - STAIR.top).translate(0, STAIR.high - 0.22, (STAIR.top + STAIR.end) / 2));
  for (const x of [-0.85, 0.85]) P.steel.push(new THREE.BoxGeometry(0.14, STAIR.high - 2.7, 0.14).translate(x, (STAIR.high + 2.6) / 2 - 0.1, 4.9));
  // the lifting rams from the chassis to under the flight, with their chrome rods and a brace between
  for (const x of [-0.6, 0.6]) {
    P.steel.push(rod(V(x, 1.25, -0.6), V(x, 2.55, 1.6), 0.1, 10));
    P.white.push(rod(V(x, 2.5, 1.5), V(x, at(7.6) - 0.25, 2.6), 0.05, 8));
    P.steel.push(rod(V(x, 1.25, 2.2), V(x, at(8.6) - 0.25, 3.6), 0.07, 8));
  }
  P.steel.push(rod(V(-0.6, 2.0, 0.6), V(0.6, 2.0, 0.6), 0.05));
  // the handrails: a top rail and a mid rail each side, posts, and round the landing's sides
  for (const s of [-1, 1]) {
    const x = s * (STAIR.half - 0.04);
    for (const up of [1.0, 0.5]) {
      P.yellow.push(rod(V(x, at(0.2) + up, STAIR.back + 0.2), V(x, STAIR.high + up, STAIR.top), up === 1 ? 0.04 : 0.025));
      P.yellow.push(rod(V(x, STAIR.high + up, STAIR.top), V(x, STAIR.high + up, STAIR.end - 0.05), up === 1 ? 0.04 : 0.025));
    }
    for (let t = 0.2; t < run; t += 1.55) P.yellow.push(rod(V(x, at(t), STAIR.back + t), V(x, at(t) + 1.0, STAIR.back + t), 0.03));
    for (const z of [STAIR.top, STAIR.end - 0.05]) P.yellow.push(rod(V(x, STAIR.high, z), V(x, STAIR.high + 1.0, z), 0.035));
    P.yellow.push(rod(V(x, at(0.2) + 1.0, STAIR.back + 0.2), V(x, at(0.2) + 0.2, STAIR.back - 0.05), 0.04));
  }
  const out = {};
  for (const k in P) out[k] = merged(P[k]);
  return out;
}
const STAIR_MATERIALS = {};
function stairMaterial(k) {
  if (STAIR_MATERIALS[k]) return STAIR_MATERIALS[k];
  const std = (color, roughness, metalness, extra = {}) => Object.assign(new THREE.MeshStandardNodeMaterial({ color, roughness, metalness }), extra);
  const glowing = (color, i) => std(color, 0.3, 0, { emissive: new THREE.Color(color), emissiveIntensity: i });
  const all = {
    yellow: std(0xe8b923, 0.45, 0.15, { side: THREE.DoubleSide }), steel: std(0xc4c7c9, 0.35, 0.7), dark: std(0x26282b, 0.7, 0.2),
    rubber: std(0x18181a, 0.9, 0), glass: std(0x1c2630, 0.08, 0.6), white: std(0xe9ecee, 0.15, 0.9),
    amber: glowing(0xff9a1a, 0.9), red: glowing(0xd0201a, 0.7)
  };
  Object.assign(STAIR_MATERIALS, all);
  return STAIR_MATERIALS[k];
}
// the stair truck as a group of meshes in its own frame (shared geometry when given)
function buildStairTruck(geos = stairTruckGeometries()) {
  const g = new THREE.Group();
  g.name = 'StairTruck';
  for (const k in geos) {
    if (!geos[k]) continue;
    const m = new THREE.Mesh(geos[k], stairMaterial(k));
    m.castShadow = k !== 'glass' && k !== 'amber' && k !== 'red';
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// Ground service trucks: a fuel truck and a baggage tug with its carts, parked on the aprons (boxes, with colliders)
function truckGeometries(t, g, out) {
  const put = (geo) => geo.rotateY(t.heading).translate(t.x, g, t.z).toNonIndexed();
  const wheels = (xs, zs, r) => { for (const x of xs) for (const z of zs) out.black.push(put(new THREE.CylinderGeometry(r, r, 0.3, 12).rotateZ(Math.PI / 2).translate(x, r, z))); };
  if (t.kind === 'fuel') {
    out.red.push(put(new THREE.BoxGeometry(2.4, 2.2, 2.2).translate(0, 1.6, 3.0)));
    out.steel.push(put(new THREE.CylinderGeometry(1.1, 1.1, 5.2, 16).rotateX(Math.PI / 2).translate(0, 1.85, -1.1)));
    out.red.push(put(new THREE.BoxGeometry(2.4, 0.5, 7.6).translate(0, 0.75, 0.6)));
    out.black.push(put(new THREE.BoxGeometry(2.0, 0.7, 0.05).translate(0, 2.15, 4.11)));
    wheels([-1.1, 1.1], [-2.4, -0.9, 3.0], 0.5);
    return { half: [1.3, 4.4], h: 3 };
  }
  // the tug, and three open baggage carts behind it
  out.yellow.push(put(new THREE.BoxGeometry(1.5, 0.8, 2.4).translate(0, 0.65, 0)));
  out.black.push(put(new THREE.BoxGeometry(1.3, 0.5, 0.6).translate(0, 1.3, -0.5)));
  wheels([-0.7, 0.7], [-0.8, 0.8], 0.3);
  for (let k = 0; k < 3; k++) {
    const z = -3.2 - k * 2.9;
    out.steel.push(put(new THREE.BoxGeometry(1.5, 0.15, 2.3).translate(0, 0.55, z)));
    for (const x of [-0.72, 0.72]) out.steel.push(put(new THREE.BoxGeometry(0.06, 0.8, 2.3).translate(x, 1.0, z)));
    out.blue.push(put(new THREE.BoxGeometry(1.2, 0.6, 1.0).translate(0, 0.93, z + 0.4 - (k % 2) * 0.8)));
    wheels([-0.6, 0.6], [z - 0.8, z + 0.8], 0.2);
  }
  return { half: [0.9, 1.4 + 3 * 2.9 + 1.2], h: 1.6, back: true };
}
const TRUCKS = [
  { kind: 'tug', x: 255, z: 6080, heading: 0 },
  { kind: 'tug', x: 225, z: 6089, heading: Math.PI }
];

function createAirport(group) {
  group.name = 'Airport';
  group.userData.terrain = 'set';
  const grass = [], asphalt = [], concrete = [], white = [], yellow = [];

  // the runways: 6/24 paved, with its markings; 12/30 a mown strip in the grass
  for (const r of AIRPORT.runways) {
    const [ax, az] = r.a, [bx, bz] = r.b, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    if (r.grass) { grass.push(flatShape(rect(cx, cz, dx, dz, len, r.width))); continue; }
    asphalt.push(flatShape(rect(cx, cz, dx, dz, len + 6, r.width + 1)));
    // centerline: 36 m dashes, 24 m gaps, between the two threshold zones
    for (let t = 90; t < len - 90; t += 60) white.push(flatShape(rect(ax + dx * (t + 18), az + dz * (t + 18), dx, dz, 36, 0.9)));
    // at each end: the threshold bars, four either side of the centre, and a block for its number further in
    for (const [ex, ez, s] of [[ax, az, 1], [bx, bz, -1]]) {
      for (const k of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const off = (k - Math.sign(k) * 0.5) * 2.4;
        white.push(flatShape(rect(ex + dx * s * 25 - dz * off, ez + dz * s * 25 + dx * off, dx, dz, 30, 1.6)));
      }
      white.push(flatShape(rect(ex + dx * s * 58, ez + dz * s * 58, dx, dz, 12, 1.2)));
      // the aiming point: two broad bars 300 m in
      for (const off of [-5.5, 5.5]) {
        white.push(flatShape(rect(ex + dx * s * 300 - dz * off, ez + dz * s * 300 + dx * off, dx, dz, 45, 3)));
      }
    }
    // edge lines
    for (const off of [-r.width / 2 + 0.6, r.width / 2 - 0.6]) {
      white.push(flatShape(rect(cx - dz * off, cz + dx * off, dx, dz, len - 4, 0.45)));
    }
  }
  for (const t of AIRPORT.taxiways) {
    along(t.line, 11, asphalt);
    along(t.line, 0.32, yellow);
  }
  for (const a of AIRPORT.aprons) concrete.push(flatShape(pts(a)));
  // a parking pad under each parked helicopter: a yellow square on the apron with a white H in it, turned with the
  // helicopter (its nose along (sin h, cos h))
  for (let i = 0; i < AIRPORT.helis.length; i += 3) {
    const hx = AIRPORT.helis[i], hz = AIRPORT.helis[i + 1], h = AIRPORT.helis[i + 2];
    const fx = Math.sin(h), fz = Math.cos(h); // along the nose; across is (fz, -fx)
    const at = (a, c) => [hx + fx * a + fz * c, hz + fz * a - fx * c];
    const S = 15, L = 0.4;
    for (const [a, c, len, w, along] of [[S / 2, 0, S, L, false], [-S / 2, 0, S, L, false], [0, S / 2, S, L, true], [0, -S / 2, S, L, true]]) {
      const [x, z] = at(a, c);
      yellow.push(flatShape(along ? rect(x, z, fx, fz, len + L, w) : rect(x, z, fz, -fx, len + L, w)));
    }
    // the H: its two legs along the nose, the bar across
    for (const c of [-1.6, 1.6]) { const [x, z] = at(0, c); white.push(flatShape(rect(x, z, fx, fz, 5, 0.6))); }
    { const [x, z] = at(0, 0); white.push(flatShape(rect(x, z, fz, -fx, 3.2, 0.6))); }
  }
  layer(group, grass, 0x5d7b38, 0, 'AirportGrassStrip', 1);
  layer(group, concrete, 0x9a968e, 0.02, 'AirportAprons');
  layer(group, asphalt, 0x3b3c3e, 0.04, 'AirportRunwaysTaxiways');
  layer(group, white, 0xe8e8e4, 0.07, 'AirportRunwayMarkings', 0.7);
  layer(group, yellow, 0xe0b11c, 0.07, 'AirportTaxiLines', 0.7);

  // the buildings: corrugated-steel hangars under low gabled roofs, their doors in bays with a track over them and a
  // lamp over each, and the FBO and offices with a ribbon of windows, a parapet, units on the roof and a canopy over
  // the door; each on the lowest ground under it
  const colliders = [];
  let far = false; // the camera far off (update)
  const BP = { steel: [], roof: [], tan: [], doors: [], glass: [], dark: [], lamps: [], canopy: [] };
  const flatArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].z - r[i].z); return Math.abs(a) / 2; };
  const prism = (ring, y0, y1) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z))), { depth: y1 - y0, bevelEnabled: false });
    return g.rotateX(-Math.PI / 2).translate(0, y0, 0);
  };
  const grow = (ring, d) => {
    const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length, cz = ring.reduce((a, p) => a + p.z, 0) / ring.length;
    return ring.map((p) => { const l = Math.hypot(p.x - cx, p.z - cz) || 1; return { x: p.x + ((p.x - cx) / l) * d, z: p.z + ((p.z - cz) / l) * d }; });
  };
  // triangles from (x, y, z) corners with their uvs, as one geometry
  const tris = (list) => {
    const pos = [], uv = [];
    for (const [x, y, z, u, v] of list) { pos.push(x, y, z); uv.push(u, v); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  let office = null;
  for (const b of AIRPORT.buildings) {
    const ring = pts(b.ring);
    let low = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) {
      low = Math.min(low, groundHeight(p.x, p.z));
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // the longest side, and the footprint along it (s) and across it (t)
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], l = Math.hypot(q.x - p.x, q.z - p.z);
      if (!best || l > best.l) best = { p, q, l };
    }
    const ux = (best.q.x - best.p.x) / best.l, uz = (best.q.z - best.p.z) / best.l, nx = -uz, nz = ux;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of ring) {
      const sv = (p.x - best.p.x) * ux + (p.z - best.p.z) * uz, tv = (p.x - best.p.x) * nx + (p.z - best.p.z) * nz;
      s0 = Math.min(s0, sv); s1 = Math.max(s1, sv); t0 = Math.min(t0, tv); t1 = Math.max(t1, tv);
    }
    const area = flatArea(ring), boxy = area / ((s1 - s0) * (t1 - t0)) > 0.85;
    const W = (sv, tv, y) => [best.p.x + ux * sv + nx * tv, y, best.p.z + uz * sv + nz * tv];
    const span = Math.min(maxX - minX, maxZ - minZ);
    const h = b.hangar ? Math.min(9, 4.2 + span * 0.12) : 4.6, top = low + h;
    if (b.hangar) {
      BP.steel.push(prism(ring, low - 0.6, top));
      if (boxy) {
        // the gabled roof, ridge along the long side, eaves a little out over the walls
        const o = 0.4, rise = Math.min(2.2, (t1 - t0) * 0.1), tm = (t0 + t1) / 2, a0 = s0 - o, a1 = s1 + o, b0 = t0 - o, b1 = t1 + o;
        const e = (sv, tv) => [...W(sv, tv, top - (o / ((t1 - t0) / 2)) * rise * 0.15), sv, tv];
        const r = (sv) => [...W(sv, tm, top + rise), sv, tm];
        BP.roof.push(tris([e(a0, b0), r(a0), e(a1, b0), e(a1, b0), r(a0), r(a1), e(a0, b1), e(a1, b1), r(a0), r(a0), e(a1, b1), r(a1)]));
        BP.roof.push(tris([e(a0, b0 + 0.2), e(a1, b0 + 0.2), r(a0), r(a0), e(a1, b0 + 0.2), r(a1)].map((v) => [v[0], v[1] - 0.12, v[2], v[3], v[4]]).reverse()));
        BP.roof.push(tris([e(a0, b1 - 0.2), r(a0), e(a1, b1 - 0.2), e(a1, b1 - 0.2), r(a0), r(a1)].map((v) => [v[0], v[1] - 0.12, v[2], v[3], v[4]]).reverse()));
        // the gable ends, and a cap along the ridge
        for (const sv of [s0, s1]) {
          const tri = [[...W(sv, t0, top), t0, 0], [...W(sv, tm, top + rise), tm, rise], [...W(sv, t1, top), t1, 0]];
          BP.steel.push(tris(tri), tris([...tri].reverse()));
        }
        const ridge = new THREE.BoxGeometry(s1 - s0 + o * 2, 0.12, 0.35).rotateY(-Math.atan2(uz, ux));
        const [rx, ry, rz] = W((s0 + s1) / 2, tm, top + rise + 0.02);
        BP.dark.push(ridge.translate(rx, ry, rz));
      } else {
        BP.roof.push(prism(grow(ring, 0.3), top, top + 0.25));
      }
      // the doors along the long side facing out of the building: a bay every 14 m or so
      const mx = (best.p.x + best.q.x) / 2, mz = (best.p.z + best.q.z) / 2;
      const out = inRing(ring, mx - uz * 1, mz + ux * 1) ? -1 : 1;
      const bays = Math.max(1, Math.round(best.l / 14)), bay = best.l / bays, dh = h * 0.78, yaw = -Math.atan2(uz, ux);
      for (let k = 0; k < bays; k++) {
        const c = (k + 0.5) * bay, x = best.p.x + ux * c - uz * out * 0.1, z = best.p.z + uz * c + ux * out * 0.1;
        BP.doors.push(new THREE.BoxGeometry(bay * 0.86, dh, 0.14).translate(0, dh / 2, 0).rotateY(yaw).translate(x, low, z));
        BP.dark.push(new THREE.BoxGeometry(bay * 0.94, 0.28, 0.3).translate(0, dh + 0.18, 0).rotateY(yaw).translate(x, low, z));
        BP.lamps.push(new THREE.BoxGeometry(0.35, 0.12, 0.3).translate(0, dh + 0.55, 0.12 * out).rotateY(yaw).translate(x, low, z));
      }
    } else {
      // an office: walls, a ribbon of windows, a parapet, units on the roof and a canopy over its door
      BP.tan.push(prism(ring, low - 0.6, top));
      BP.glass.push(prism(grow(ring, 0.05), low + 1.0, low + 2.5));
      BP.dark.push(prism(grow(ring, 0.08), top, top + 0.35));
      if (area > 150) {
        const [cx, , cz] = W((s0 + s1) / 2, (t0 + t1) / 2, 0);
        BP.canopy.push(new THREE.BoxGeometry(2.2, 1.1, 1.6).translate(cx + ux * 2, top + 0.55, cz + uz * 2));
        BP.canopy.push(new THREE.BoxGeometry(1.4, 0.8, 1.4).translate(cx - ux * 3, top + 0.4, cz - uz * 3));
      }
      const mx = (best.p.x + best.q.x) / 2, mz = (best.p.z + best.q.z) / 2;
      const out = inRing(ring, mx - uz * 1, mz + ux * 1) ? -1 : 1, yaw = -Math.atan2(uz, ux);
      if (best.l > 8) {
        BP.dark.push(new THREE.BoxGeometry(5, 0.22, 2.6).translate(0, 3.1, 1.3 * out).rotateY(yaw).translate(mx, low, mz));
        for (const sx of [-2.3, 2.3]) BP.canopy.push(new THREE.BoxGeometry(0.14, 3.0, 0.14).translate(sx, 1.5, 2.45 * out).rotateY(yaw).translate(mx, low, mz));
        BP.glass.push(new THREE.BoxGeometry(1.8, 2.2, 0.08).translate(0, 1.1, 0.06 * out).rotateY(yaw).translate(mx, low, mz));
        if (!office || area > office.area) office = { area, mx, mz, low, yaw, out, top };
      }
    }
    colliders.push({ minX, maxX, minZ, maxZ, minY: low - 1, maxY: low + h, polygon: { outer: ring, holes: [] } });
  }
  const addSolid = (geos, color, name, metal = 0.2, extra = {}) => {
    if (!geos.length) return;
    const geo = merged(geos);
    if (!geo) return;
    const m = new THREE.Mesh(geo, Object.assign(new THREE.MeshStandardNodeMaterial({ color, roughness: 0.6, metalness: metal }), extra));
    m.name = name;
    m.castShadow = !/Lamps|Windows/.test(name);
    m.receiveShadow = true;
    group.add(m);
  };
  // the corrugated steel's ribs, about four to the metre, and the doors' panels
  const stripes = (w, hgt, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const ribs = stripes(64, 4, (c) => {
    const g = c.createLinearGradient(0, 0, 16, 0);
    g.addColorStop(0, '#9a9fa3'); g.addColorStop(0.35, '#ffffff'); g.addColorStop(0.65, '#d4d8db'); g.addColorStop(1, '#8d9296');
    c.fillStyle = g;
    for (let i = 0; i < 4; i++) { c.save(); c.translate(i * 16, 0); c.fillRect(0, 0, 16, 4); c.restore(); }
  });
  const panels = stripes(8, 128, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 8, 128);
    c.fillStyle = '#7d858b';
    for (let i = 0; i < 8; i++) c.fillRect(0, i * 16, 8, 2);
  });
  addSolid(BP.steel, 0xc4c9cc, 'AirportHangars', 0.5, { map: ribs, roughness: 0.45 });
  addSolid(BP.roof, 0x8c9296, 'AirportHangarRoofs', 0.5, { map: ribs, roughness: 0.5, side: THREE.DoubleSide });
  addSolid(BP.doors, 0x9aa5ad, 'AirportHangarDoors', 0.5, { map: panels });
  addSolid(BP.tan, 0xcdbd9f, 'AirportOffices', 0, { roughness: 0.85 });
  addSolid(BP.glass, 0x22303b, 'AirportWindows', 0.6, { roughness: 0.08 });
  addSolid(BP.dark, 0x3a3e42, 'AirportTrim', 0.3);
  addSolid(BP.canopy, 0xa9adb0, 'AirportRoofUnits', 0.5);
  addSolid(BP.lamps, 0xfff1cc, 'AirportHangarLamps', 0, { emissive: new THREE.Color(0xfff1cc), emissiveIntensity: 1.2 });
  // a sign over the biggest office's door
  if (office) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 128;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#1f3f7a'; x2.fillRect(0, 0, 1024, 128);
    x2.fillStyle = '#ffffff'; x2.font = 'bold 72px Helvetica, Arial, sans-serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle';
    x2.fillText('ANN ARBOR AIRPORT', 512, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.8), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.5 }));
    sign.name = 'AirportSign';
    sign.position.set(office.mx, office.low + 3.75, office.mz);
    sign.rotation.y = office.yaw + (office.out > 0 ? 0 : Math.PI);
    sign.translateZ(2.62);
    group.add(sign);
  }

  // the windsocks: a pole and an orange sock blowing with the flags' wind
  const W = AIRPORT.windsocks, poles = [], socks = [];
  for (let i = 0; i < W.length; i += 2) {
    const x = W[i], z = W[i + 1], g = groundHeight(x, z);
    poles.push(new THREE.CylinderGeometry(0.07, 0.09, 6, 6).translate(x, g + 3, z).toNonIndexed());
    const sock = new THREE.CylinderGeometry(0.45, 0.22, 3.2, 10, 1, true).rotateZ(Math.PI / 2).translate(1.7, 0, 0);
    sock.rotateY(0.6).translate(x, g + 5.7, z);
    socks.push(sock.toNonIndexed());
  }
  addSolid(poles, 0xd8d8d4, 'AirportWindsockPoles', 0.3);
  if (socks.length) {
    const m = new THREE.Mesh(merged(socks), new THREE.MeshStandardNodeMaterial({ color: 0xff6a1a, roughness: 0.8, side: THREE.DoubleSide }));
    m.name = 'AirportWindsocks';
    group.add(m);
  }

  // the airstairs, each its own truck to drive away (where they were left is kept with the game's saves)
  const S = AIRPORT.stairs || [], stairs = [], stairGeos = stairTruckGeometries();
  let moved = null, heldStairs = -1;
  try { moved = load('airportStairs'); heldStairs = load('airportStairsHeld') ?? -1; } catch { moved = null; }
  for (let i = 0; i < S.length; i += 3) {
    const s = { x: S[i], z: S[i + 1], heading: S[i + 2], root: buildStairTruck(stairGeos) };
    const m = moved?.[i / 3];
    if (m && m.every(Number.isFinite)) [s.x, s.z, s.heading] = m;
    // a mapped spot that would put the truck into a hangar's wall is left empty (kept in the list for the saves)
    else if (!clearOfBuildings(s.x, s.z, s.heading, STAIR_FOOT)) s.blocked = true;
    s.root.name = `AirStairs${i / 3 + 1}`;
    group.add(s.root);
    stairs.push(s);
    setStairs(s);
  }
  function setStairs(s) {
    s.g = groundHeight(s.x, s.z) + (onAirfield(s.x, s.z) ? PAVE : 0);
    s.sn = Math.sin(s.heading); s.cs = Math.cos(s.heading);
    s.root.position.set(s.x, s.g, s.z);
    s.root.rotation.y = s.heading;
    s.root.visible = !far && !s.blocked && stairs.indexOf(s) !== heldStairs;
    s.root.updateMatrixWorld(true); // the scene's world matrices are made once (main.js): a moved truck makes its own
  }
  const saveStairs = () => { save('airportStairs', stairs.map((s) => [s.x, s.z, s.heading])); save('airportStairsHeld', heldStairs); };
  // the stair truck nearest (x, z), from beside its cab or its flight
  function nearestStairs(x, z, reach) {
    let best = null;
    for (const [i, s] of stairs.entries()) {
      if (i === heldStairs || s.blocked) continue;
      const dx = x - s.x, dz = z - s.z, t = dx * s.sn + dz * s.cs, w = dx * s.cs - dz * s.sn;
      const d = Math.hypot(Math.max(0, Math.abs(w) - 1.2), Math.max(0, t - 5.6, -5.0 - t));
      if (d < reach && (!best || d < best.d)) best = { i, d, x: s.x, z: s.z, yaw: s.heading };
    }
    return best;
  }
  // drive stair truck i away: its spot stands empty; the one driven before stays where it was left
  function takeStairs(i) {
    if (heldStairs >= 0 && heldStairs !== i && stairs[heldStairs]) { const s = stairs[heldStairs]; heldStairs = -1; setStairs(s); }
    heldStairs = i;
    setStairs(stairs[i]);
    saveStairs();
    return { kind: 'stairtruck', hex: 0, style: 0 };
  }
  // the player leaves the one they drove at (x, z): it stands there to climb and jump off again
  function leaveStairs(x, z, heading) {
    const s = stairs[heldStairs];
    if (!s) return;
    heldStairs = -1;
    Object.assign(s, { x, z, heading, blocked: false });
    setStairs(s);
    saveStairs();
  }
  // a reloaded game whose player was driving one: that one is theirs
  // (the one nearest where its truck is, when that's known), and one got back into after a reload is too
  function claimStairs(x, z) {
    const open = stairs.filter((s) => !s.blocked);
    if (heldStairs >= 0 || !open.length) return;
    let pick = open[0];
    if (Number.isFinite(x)) for (const s of open) if (Math.hypot(s.x - x, s.z - z) < Math.hypot(pick.x - x, pick.z - z)) pick = s;
    const i = stairs.indexOf(pick);
    heldStairs = i;
    setStairs(stairs[i]);
    saveStairs();
  }
  // the ground trucks
  const truckParts = { red: [], steel: [], black: [], yellow: [], blue: [] };
  for (const t of TRUCKS) {
    const g = groundHeight(t.x, t.z) + PAVE, { half, h, back } = truckGeometries(t, g, truckParts);
    const sn = Math.sin(t.heading), cs = Math.cos(t.heading);
    // the box it fills, along its heading (a tug's carts trail behind it)
    const z0 = back ? -half[1] + 1.4 : -half[1], z1 = back ? 1.4 : half[1];
    const ring = [[-half[0], z0], [half[0], z0], [half[0], z1], [-half[0], z1]].map(([a, b]) => ({ x: t.x + a * cs + b * sn, z: t.z - a * sn + b * cs }));
    colliders.push({ minX: Math.min(...ring.map((p) => p.x)), maxX: Math.max(...ring.map((p) => p.x)), minZ: Math.min(...ring.map((p) => p.z)), maxZ: Math.max(...ring.map((p) => p.z)),
      minY: g - 1, maxY: g + h, polygon: { outer: ring, holes: [] } });
  }
  // orange cones off each parked plane's wingtips and round the stairs
  const cones = [];
  const cone = (x, z) => cones.push(new THREE.ConeGeometry(0.18, 0.7, 8).translate(x, groundHeight(x, z) + PAVE + 0.35, z).toNonIndexed());
  const P = AIRPORT.planes || [];
  for (let i = 0; i < P.length; i += 3) {
    if (!clearOfBuildings(P[i], P[i + 1], P[i + 2], PLANE_FOOT)) continue;
    const c = Math.cos(P[i + 2]), s = Math.sin(P[i + 2]);
    for (const w of [-6.2, 6.2]) cone(P[i] + w * c, P[i + 1] - w * s);
  }
  for (const s of stairs) for (const w of [-2, 2]) cone(s.x + s.sn * 7 + w * s.cs, s.z + s.cs * 7 - w * s.sn);
  addSolid(truckParts.yellow, 0xe8b923, 'AirportGroundYellow', 0.2);
  addSolid(truckParts.black, 0x1e1e20, 'AirportTyres', 0);
  addSolid(truckParts.red, 0xb52a24, 'AirportFuelTrucks', 0.2);
  addSolid(truckParts.steel, 0xb9bdbf, 'AirportTruckSteel', 0.6);
  addSolid(truckParts.blue, 0x2d4a73, 'AirportBags', 0);
  addSolid(cones, 0xff6a1a, 'AirportCones', 0);

  // the top of the airstairs at (x, z), or -Infinity off them
  function stairTop(x, z) {
    for (const [i, s] of stairs.entries()) {
      if (i === heldStairs || s.blocked) continue;
      const dx = x - s.x, dz = z - s.z;
      if (dx * dx + dz * dz > 49) continue;
      const t = dx * s.sn + dz * s.cs, w = dx * s.cs - dz * s.sn;
      if (Math.abs(w) > STAIR.half || t < STAIR.back || t > STAIR.end) continue;
      return s.g + (t >= STAIR.top ? STAIR.high : STAIR.low + ((t - STAIR.back) / (STAIR.top - STAIR.back)) * (STAIR.high - STAIR.low));
    }
    return -Infinity;
  }

  // the parked aircraft: helicopters (the player's own model, rotors still) in a row by the FBO, and planes tied down
  // on the aprons; each spot has a kind, since taking one leaves the player's own (helicopter or plane) in its place
  const body = buildHelicopterBodyGeometry(), rotor = buildHelicopterMainRotorGeometry(), tail = buildHelicopterTailRotorGeometry();
  const mat = createLoftedHelicopterMaterial();
  const planeGeos = planeGeometries(), paints = PAINTS.map(planeMaterials);
  const H = AIRPORT.helis, craft = [];
  for (let i = 0; i < H.length; i += 3) craft.push({ kind: 'helicopter', x: H[i], z: H[i + 1], heading: H[i + 2] });
  for (let i = 0; i < P.length; i += 3) craft.push({ kind: 'plane', x: P[i], z: P[i + 1], heading: P[i + 2] });
  // a mapped spot whose plane would stand in a hangar or put a wing through its wall is left empty (kept in the list,
  // so the saved `taken` still names the same aircraft)
  for (const c of craft) if (c.kind === 'plane' && !clearOfBuildings(c.x, c.z, c.heading, PLANE_FOOT)) c.blocked = true;
  // the one the player took last is theirs, so its spot stands empty (kept with the game's saves)
  let taken = -1;
  try { taken = load('airportTaken') ?? -1; } catch { taken = -1; }

  // more planes tied down in rows wherever an apron has room, clear of the hangars, the taxiways and what's parked
  // already, spread well apart
  const segDist = (x, z, ax, az, bx, bz) => {
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1, t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / l2));
    return Math.hypot(x - ax - ux * t, z - az - uz * t);
  };
  const nearTaxiway = (x, z, r) => AIRPORT.taxiways.some(({ line: l }) => {
    for (let i = 2; i < l.length; i += 2) if (segDist(x, z, l[i - 2], l[i - 1], l[i], l[i + 1]) < r) return true;
    return false;
  });
  const taken2 = [...craft.map((c) => [c.x, c.z]), ...stairs.map((t) => [t.x, t.z]), ...TRUCKS.map((t) => [t.x, t.z])];
  const rows = [];
  for (const a of AIRPORT.aprons) {
    const ring = pts(a);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const q of ring) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z); }
    for (let z = minZ + 12, row = 0; z < maxZ - 8; z += 30, row++) {
      for (let x = minX + 12; x < maxX - 8; x += 30) {
        const foot = [[0, 0], [-6, 0], [6, 0], [0, -4.8], [0, 3.6], [-6, 1], [6, 1]];
        if (!foot.every(([u, v]) => inRing(ring, x + u, z + v) && !RINGS.some((r) => inRing(r, x + u, z + v)))) continue;
        if (RINGS.some((r) => r.some((q) => Math.abs(q.x - x) < 9 && Math.abs(q.z - z) < 8))) continue;
        if (nearTaxiway(x, z, 13) || taken2.some(([px, pz]) => Math.hypot(px - x, pz - z) < 30)) continue;
        rows.push({ x, z, heading: row % 2 ? 0 : Math.PI });
      }
    }
  }
  const tied = rows.filter((_, i) => i % 2 === 0).slice(0, 9);
  // each one a parked plane like the others, so F takes it too
  for (const t of tied) craft.push({ kind: 'plane', x: t.x, z: t.z, heading: t.heading, tied: true });

  // The whole parked fleet is drawn as instances: one draw per part for every plane (each one's stripe its own paint)
  // and one per part for the helicopters, rather than a handful of draws for each aircraft. A spot standing empty (the
  // craft taken, or left out) is its instance shrunk to nothing.
  const fleet = [];
  const instanced = (geo, material, n, name, cast, receive) => {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, n));
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = receive;
    group.add(m);
    fleet.push(m);
    return m;
  };
  const nPlanes = craft.filter((c) => c.kind === 'plane').length, nHelis = craft.length - nPlanes;
  const fleetMats = planeMaterials(0xffffff); // the stripe white, tinted by each plane's paint (instanceColor)
  const planeParts = ['white', 'glass', 'dark', 'stripe', 'red', 'green'].map((k) => ({ local: new THREE.Matrix4(),
    mesh: instanced(planeGeos[k], fleetMats[k], nPlanes, `ParkedPlanes_${k}`, k === 'white' || k === 'dark' || k === 'stripe', k === 'white') }));
  const propMesh = instanced(planeGeos.prop, fleetMats.prop, nPlanes, 'ParkedPlanes_prop', false, false);
  const heliParts = [
    { mesh: instanced(body, mat, nHelis, 'ParkedHelicopters_body', true, false), at: [0, 0, 0] },
    { mesh: instanced(rotor, mat, nHelis, 'ParkedHelicopters_rotor', true, false), at: [0, 2.66, -0.35] },
    { mesh: instanced(tail, mat, nHelis, 'ParkedHelicopters_tail', false, false), at: [0.18, 2.02, -5.62] }
  ];
  let nP = 0, nH = 0;
  for (const [i, c] of craft.entries()) {
    if (c.kind === 'plane') {
      c.slot = nP++;
      // (the mapped ones' paints in turn, the tied-down rows' in another order)
      const paint = PAINTS[(c.tied ? i * 3 + 1 : i) % PAINTS.length];
      planeParts.find((p) => p.mesh.name === 'ParkedPlanes_stripe').mesh.setColorAt(c.slot, new THREE.Color(paint));
      // the propeller left where it stopped
      c.parts = [...planeParts.map((p) => ({ mesh: p.mesh, local: p.local })),
        { mesh: propMesh, local: new THREE.Matrix4().makeRotationZ(i * (c.tied ? 1.1 : 0.7)).setPosition(0, 1.38, 3.42) }];
    } else {
      c.slot = nH++;
      c.parts = heliParts.map((p, k) => ({ mesh: p.mesh,
        // blades left where they stopped
        local: (k === 1 ? new THREE.Matrix4().makeRotationY(0.4 + i * 0.9) : new THREE.Matrix4()).setPosition(...p.at) }));
    }
  }
  const _root = new THREE.Matrix4(), _part = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
  for (const c of craft) place(c);
  for (const m of fleet) {
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }
  function place(c) {
    const shown = !c.blocked && craft.indexOf(c) !== taken;
    // a helicopter's skids and a plane's wheels on the apron (the plane's model stands 0.25 m over its wheels' feet; a
    // helicopter's model as the player's rests, 0.25 + HELI_REST in controllers.js, its skids' undersides 2 cm up in it)
    const y = groundHeight(c.x, c.z) + PAVE + (c.kind === 'plane' ? 0.25 : -0.02);
    _root.compose(V(c.x, y, c.z), _q.setFromAxisAngle(_up, c.heading), shown ? V(1, 1, 1) : V(0, 0, 0));
    for (const p of c.parts) {
      p.mesh.setMatrixAt(c.slot, _part.multiplyMatrices(_root, p.local));
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  const showFleet = () => { for (const m of fleet) m.visible = !far; };
  showFleet();

  // the runway's edge lights every 60 m, a green bar of them across each threshold, and the taxiways' blue ones
  const posts = [], whiteLamps = [], greenLamps = [], blueLamps = [];
  const lamp = (x, z, out) => {
    const g = groundHeight(x, z) + PAVE * 0.5;
    posts.push(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 6).translate(x, g + 0.21, z).toNonIndexed());
    out.push(new THREE.CylinderGeometry(0.11, 0.09, 0.14, 8).translate(x, g + 0.48, z).toNonIndexed());
  };
  for (const r of AIRPORT.runways) {
    if (r.grass) continue;
    const [ax, az] = r.a, [bx, bz] = r.b, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    for (const side of [-1, 1]) {
      const off = side * (r.width / 2 + 1.6);
      for (let t = 0; t <= len + 0.1; t += len / Math.round(len / 60)) lamp(ax + dx * t - dz * off, az + dz * t + dx * off, whiteLamps);
    }
    for (const [ex, ez, sg] of [[ax, az, -1], [bx, bz, 1]]) {
      for (let k = -4; k <= 4; k++) {
        const off = k * (r.width / 8) * 1.1;
        lamp(ex + dx * sg * 3 - dz * off, ez + dz * sg * 3 + dx * off, greenLamps);
      }
    }
  }
  for (const { line: l } of AIRPORT.taxiways) {
    for (let i = 2; i < l.length; i += 2) {
      const ax = l[i - 2], az = l[i - 1], bx = l[i], bz = l[i + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < 20) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let t = 10; t < len - 9; t += 30) for (const off of [-7, 7]) {
        const x = ax + dx * t - dz * off, z = az + dz * t + dx * off;
        if (!nearTaxiway(x, z, 6.2)) lamp(x, z, blueLamps);
      }
    }
  }
  addSolid(posts, 0xd9c24a, 'AirportLightPosts', 0.2);
  const glow = (geos, color, name, strength) => {
    if (!geos.length) return;
    const m = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.3 });
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = strength;
    const geo = merged(geos);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    group.add(mesh);
  };
  glow(whiteLamps, 0xfff4d6, 'AirportRunwayLights', 1.2);
  glow(greenLamps, 0x2bd96b, 'AirportThresholdLights', 1.4);
  glow(blueLamps, 0x3a6dff, 'AirportTaxiLights', 1.4);

  // the airport beacon: a steel lattice tower with its green-and-white lamp turning on top (update)
  const BEACON = { x: 380, z: 6060, h: 20 };
  const bg = groundHeight(BEACON.x, BEACON.z), tower = [];
  const leg = (sx, sz, t) => V(BEACON.x + sx * (1.6 - t * 1.0), bg + t * BEACON.h, BEACON.z + sz * (1.6 - t * 1.0));
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let c = 0; c < 4; c++) {
    const [sx, sz] = corners[c], [nx, nz] = corners[(c + 1) % 4];
    tower.push(rod(leg(sx, sz, 0), leg(sx, sz, 1), 0.08, 6));
    for (let k = 0; k < 5; k++) {
      const t0 = k / 5, t1 = (k + 1) / 5;
      tower.push(rod(leg(sx, sz, t0), leg(nx, nz, t1), 0.035, 4), rod(leg(sx, sz, t1), leg(nx, nz, t1), 0.04, 4));
    }
  }
  tower.push(new THREE.BoxGeometry(1.8, 0.15, 1.8).translate(BEACON.x, bg + BEACON.h + 0.05, BEACON.z).toNonIndexed());
  tower.push(new THREE.CylinderGeometry(0.22, 0.22, 0.9, 10).translate(BEACON.x, bg + BEACON.h + 0.55, BEACON.z).toNonIndexed());
  addSolid(tower, 0xb9bec2, 'AirportBeaconTower', 0.6);
  colliders.push({ minX: BEACON.x - 1.7, maxX: BEACON.x + 1.7, minZ: BEACON.z - 1.7, maxZ: BEACON.z + 1.7, minY: bg - 1, maxY: bg + BEACON.h + 1,
    polygon: { outer: [{ x: BEACON.x - 1.7, z: BEACON.z - 1.7 }, { x: BEACON.x + 1.7, z: BEACON.z - 1.7 }, { x: BEACON.x + 1.7, z: BEACON.z + 1.7 }, { x: BEACON.x - 1.7, z: BEACON.z + 1.7 }], holes: [] } });
  const beacon = new THREE.Group();
  beacon.name = 'AirportBeacon';
  beacon.position.set(BEACON.x, bg + BEACON.h + 1.25, BEACON.z);
  for (const [color, side] of [[0x2bd96b, 1], [0xfff4d6, -1]]) {
    const m = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.2 });
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = 3;
    beacon.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12).rotateX(Math.PI / 2).translate(0, 0, side * 0.3), m));
  }
  beacon.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.45), new THREE.MeshStandardNodeMaterial({ color: 0x3c4146, roughness: 0.5, metalness: 0.5 })));
  group.add(beacon);

  // the red signs where a taxiway meets the paved runway: "6-24" in white
  const rw = AIRPORT.runways.find((r) => !r.grass);
  if (rw) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 96;
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#c3221c'; c2.fillRect(0, 0, 256, 96);
    c2.strokeStyle = '#ffffff'; c2.lineWidth = 5; c2.strokeRect(8, 8, 240, 80);
    c2.fillStyle = '#ffffff'; c2.font = 'bold 64px Helvetica, Arial, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
    c2.fillText('6-24', 128, 52);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const faces = [], frames = [];
    const [ax, az] = rw.a, [bx, bz] = rw.b, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    for (const { line: l } of AIRPORT.taxiways) {
      for (const end of [0, l.length - 2]) {
        const ex = l[end], ez = l[end + 1], across = (ex - ax) * -dz + (ez - az) * dx;
        if (Math.abs(across) > 30) continue;
        // back along the taxiway from the runway, and to its left
        const nx = end ? l[end - 2] : l[2], nz = end ? l[end - 1] : l[3], tl = Math.hypot(nx - ex, nz - ez) || 1;
        const ux = (nx - ex) / tl, uz = (nz - ez) / tl, back = Math.min(tl, Math.abs(across) < 4 ? 40 : 28);
        const x = ex + ux * back + uz * 9, z = ez + uz * back - ux * 9, g = groundHeight(x, z), yaw = Math.atan2(ux, uz);
        const put = (geo) => geo.rotateY(yaw).translate(x, g, z).toNonIndexed();
        faces.push(put(new THREE.PlaneGeometry(2.4, 0.9).translate(0, 1.05, 0.13)));
        faces.push(put(new THREE.PlaneGeometry(2.4, 0.9).rotateY(Math.PI).translate(0, 1.05, -0.13)));
        frames.push(put(new THREE.BoxGeometry(2.5, 1.0, 0.24).translate(0, 1.05, 0)));
        for (const sx of [-0.9, 0.9]) frames.push(put(new THREE.BoxGeometry(0.08, 0.6, 0.08).translate(sx, 0.3, 0)));
      }
    }
    addSolid(frames, 0x2b2d30, 'AirportSignFrames', 0.3);
    if (faces.length) {
      const m = new THREE.Mesh(merged(faces), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.6 }));
      m.name = 'AirportRunwaySigns';
      group.add(m);
    }
  }

  // a plane flying touch-and-goes round the paved runway's circuit, on the side away from town (update)
  let circuit = null;
  if (rw) {
    const [ax, az] = rw.a, [bx, bz] = rw.b, len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, g0 = groundHeight(cx, cz) + PAVE + 0.25, L = len / 2;
    const side = -dx >= 0 ? 1 : -1, nx = dz * side, nz = -dx * side;
    const at = ([t, w, y]) => V(cx + dx * t + nx * w, g0 + y, cz + dz * t + nz * w);
    const curve = new THREE.CatmullRomCurve3([
      [-L + 70, 0, 0], [-L + 330, 0, 0], [-L + 620, 0, 12], [L + 80, 0, 85], [L + 420, 300, 190], [L + 160, 680, 270],
      [-L - 160, 680, 270], [-L - 440, 320, 190], [-L - 330, 0, 70], [-L - 90, 0, 14]
    ].map(at), true, 'centripetal');
    const plane = makePlane(planeGeos, paints[2]);
    plane.name = 'AirportCircuitPlane';
    group.add(plane);
    circuit = { curve, plane, length: curve.getLength(), u: 0, heading: 0, roll: 0, p: V(0, 0, 0), t: V(0, 0, 0) };
  }
  // far from the airport (over 1.8 km off) its aircraft and airstairs, a few draws each and specks at that distance,
  // aren't drawn (`far`, set here)
  // Lamp: on the Xbox the whole field isn't drawn from over a kilometre beyond its edge (device-tier.js), but for
  // airstairs the player left standing somewhere else
  let gone = false;
  // `cam2`: the second player's camera in split screen, whose half shows the field when they're near it
  function update(dt, cam, cam2 = null) {
    const offOf = (c) => Math.hypot(c.x - AIRFIELD_CENTRE.x, c.z - AIRFIELD_CENTRE.z);
    const off = cam ? Math.min(offOf(cam), cam2 ? offOf(cam2) : Infinity) : 0;
    const away = off > 1800;
    if (TIER.landmarkReach && (off > TIER.landmarkReach + 900) !== gone) {
      gone = !gone;
      for (const o of group.children) {
        if (stairs.some((s) => s.root === o)) continue;
        if (gone) { o.userData.shownNear = o.visible; o.visible = false; } else o.visible = o.userData.shownNear ?? true;
      }
      if (!gone) { showFleet(); if (circuit) circuit.plane.visible = !far; }
    }
    if (away !== far) {
      far = away;
      showFleet();
      for (const s of stairs) s.root.visible = !far && !s.blocked && stairs.indexOf(s) !== heldStairs;
      if (circuit) circuit.plane.visible = !far;
    }
    if (far) return;
    beacon.rotation.y += dt * 2.1;
    beacon.updateMatrixWorld(true);
    if (!circuit) return;
    const c = circuit, low = c.p.y - groundHeight(c.p.x, c.p.z);
    // slower on the ground, cruising in the air
    const speed = low < 3 ? 34 : 46;
    c.u = (c.u + (dt * speed) / c.length) % 1;
    c.curve.getPointAt(c.u, c.p);
    c.curve.getTangentAt(c.u, c.t);
    const floor = groundHeight(c.p.x, c.p.z) + PAVE + 0.25;
    const heading = Math.atan2(c.t.x, c.t.z);
    let turn = heading - c.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    c.heading = heading;
    c.roll += (Math.max(-0.6, Math.min(0.6, -(turn / Math.max(dt, 1e-3)) * 2.2)) - c.roll) * Math.min(1, dt * 2);
    c.plane.position.set(c.p.x, Math.max(floor, c.p.y), c.p.z);
    c.plane.rotation.set(-Math.atan2(c.t.y, Math.hypot(c.t.x, c.t.z)) * (c.p.y > floor + 0.5 ? 1 : 0), heading, c.roll, 'YXZ');
    c.plane.userData.prop.rotation.z += dt * 60;
    c.plane.updateMatrixWorld(true);
  }

  // the parked aircraft nearest (x, z) within reach, scored by `facing` as the player's other choices are
  function nearest(x, z, reach, facing = () => 1) {
    let best = null, score = Infinity;
    for (const [i, c] of craft.entries()) {
      if (i === taken || c.blocked) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d >= reach) continue;
      const s = (d / reach) * facing(c.x, c.z);
      if (s < score) { score = s; best = { i, x: c.x, z: c.z, heading: c.heading, kind: c.kind, d }; }
    }
    return best;
  }
  // take aircraft i: it becomes the player's and its spot stands empty; the one taken before is back in its own spot
  function take(i) {
    if (!craft[i] || craft[i].blocked) return null;
    const before = craft[taken];
    taken = i;
    if (before) place(before);
    place(craft[i]);
    for (const m of fleet) m.computeBoundingSphere();
    save('airportTaken', taken);
    save('playerCraft', craft[i].kind);
    const { x, z, heading, kind } = craft[i];
    return { x, z, heading, kind };
  }
  // the player's flying machine as a helicopter or a plane (controllers.js updateHelicopter flies either): a plane of
  // its own (its own geometry, so it outlives this part being made again) in the helicopter's tilt pivot, the
  // helicopter's own parts hidden while it's a plane
  function dress(h, kind) {
    if (!kind) { try { kind = h.craft ?? load('playerCraft'); } catch { kind = h.craft; } }
    kind = kind === 'plane' ? 'plane' : 'helicopter';
    h.craft = kind;
    if (h.planeModel && h.planeModel.userData.version !== PLANE_VERSION) { h.planeModel.removeFromParent(); h.planeModel = null; }
    if (kind === 'plane' && !h.planeModel) {
      h.planeModel = makePlane(planeGeometries(), planeMaterials(PAINTS[0]));
      h.planeModel.name = 'PlayerPlane';
      h.planeModel.userData.version = PLANE_VERSION;
      h.tiltPivot.add(h.planeModel);
    }
    // its wheels' feet where the helicopter's skids are (controllers.js HELI_REST: the skids 0.27 m over the tilt
    // pivot; the plane's model stands 0.25 m over its wheels' feet), so it rolls on the pavement rather than through it
    if (h.planeModel) h.planeModel.position.y = 0.27;
    for (const part of h.tiltPivot.children) part.visible = (part === h.planeModel) === (kind === 'plane');
    h.label = kind === 'plane' ? 'Airplane' : 'Helicopter';
    h.chaseDistance = kind === 'plane' ? 16 : 11.4;
    h.chaseHeight = kind === 'plane' ? 4.4 : 3.3;
    if (kind !== 'plane') h.tiltPivot.rotation.set(h.pitchAngle || 0, 0, h.rollAngle || 0);
  }

  const planes = craft.filter((c) => c.kind === 'plane').length;
  log(`[airport] Ann Arbor Municipal: ${AIRPORT.runways.length} runways, ${AIRPORT.taxiways.length} taxiways, ${AIRPORT.buildings.length} buildings, ${craft.length - planes} helicopters, ${planes} planes, ${stairs.length} airstairs, ${tied.length} planes tied down`);
  return { nearest, take, dress, stairTop, nearestStairs, takeStairs, leaveStairs, claimStairs, get stairsHeld() { return heldStairs >= 0; }, update, colliders, count: craft.length };
}

export { createAirport, onAirfield, AIRFIELD_CENTRE, buildStairTruck, STAIR, PAVE };
