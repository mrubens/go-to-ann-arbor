import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';

// Ann Arbor's outdoor sculpture, where OpenStreetMap puts each piece, modeled after how the pieces are known to look:
// di Suvero's red-orange I-beam "Orion" by the Art Museum, Ginnever's zigzag "Daedalus", Carl Milles' fountain
// "Sunday Morning in Deep Waters" before the League with the "Sea Nymph" and "Rampant Unicorn" beside it, the two
// bronze pumas on their pedestals, the bronze book stacks, the "Flame of Wisdom",
// Jens Zorn's stainless physics pieces round the Randall Lab, North Campus's Liberman "Begob", Benton's "Tilted Donut",
// Snelson's tensegrity "Indexer II", Aycock's white swirl, the marble Lorch Column, Maya Lin's "Wave Field", and the
// painted Rock at Hill and Washtenaw. Pieces whose look we couldn't vouch for are left out.
//
// All of it is a handful of meshes, one a material (painted steel, weathering steel, bronze, stainless, stone, marble,
// water, grass), each piece's color in its vertices.

const MATS = {
  painted: { roughness: 0.45, metalness: 0.25 },
  corten: { roughness: 0.85, metalness: 0.2 },
  bronze: { roughness: 0.4, metalness: 0.85 },
  steel: { roughness: 0.22, metalness: 1 },
  stone: { roughness: 0.85, metalness: 0 },
  water: { roughness: 0.04, metalness: 0.2 },
  grass: { roughness: 0.95, metalness: 0 }
};

const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Collects pieces' geometry by material, in the world's frame
class Kit {
  constructor() { this.bins = Object.fromEntries(Object.keys(MATS).map((k) => [k, []])); this.colliders = []; this.names = []; }
  // geometry `geo` in a piece's own frame, colored `color`, placed by `m` (the piece's frame on the ground)
  add(mat, geo, color, m) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv'); g.deleteAttribute('uv1');
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) {
      const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(m);
    this.bins[mat].push(g);
  }
  solid(x, z, hx, hz, y0, y1) { this.colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: y0, maxY: y1 }); }
}

// The frame of a piece standing at x, z turned `yaw` about the upright, its foot at the ground there
function frame(x, z, yaw = 0, sink = 0.05) {
  const g = groundHeight(x, z);
  return { g, m: new THREE.Matrix4().compose(new THREE.Vector3(x, g - sink, z), _q.setFromAxisAngle(UP, yaw).clone(), _s) };
}
const local = (base, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) =>
  base.clone().multiply(_m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s)));

// An I-beam (web `h` deep, flanges `w` wide) from a to b, its web turned `roll` about its length
function iBeam(a, b, h = 0.6, w = 0.35, roll = 0) {
  const t = Math.max(0.025, h * 0.06), f = Math.max(0.03, h * 0.07), r = 0.02;
  const s = new THREE.Shape();
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, -h / 2 + f], [t / 2 + r, -h / 2 + f], [t / 2, -h / 2 + f + r], [t / 2, h / 2 - f - r], [t / 2 + r, h / 2 - f],
    [w / 2, h / 2 - f], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, h / 2 - f], [-t / 2 - r, h / 2 - f], [-t / 2, h / 2 - f - r], [-t / 2, -h / 2 + f + r], [-t / 2 - r, -h / 2 + f], [-w / 2, -h / 2 + f]];
  s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p);
  const len = a.distanceTo(b);
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 1 });
  geo.rotateZ(roll);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, b.clone().sub(a).normalize()));
  geo.translate(a.x, a.y, a.z);
  return geo;
}

// A smooth tube through points
const tube = (pts, r, seg = 64, closed = false, radial = 16) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), seg, r, radial, closed);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A stone or concrete pedestal with a cap and a plinth, `h` tall, `w` square (or round)
function pedestal(kit, m, w, h, color = '#b9b3a8', round = false) {
  if (round) {
    kit.add('stone', new THREE.LatheGeometry([V(0, 0, 0), V(w / 2 + 0.08, 0, 0), V(w / 2 + 0.08, 0.15, 0), V(w / 2, 0.2, 0), V(w / 2, h - 0.15, 0), V(w / 2 + 0.06, h - 0.1, 0), V(w / 2 + 0.06, h, 0), V(0, h, 0)].map((p) => new THREE.Vector2(p.x, p.y)), 48), color, m);
  } else {
    kit.add('stone', new RoundedBoxGeometry(w + 0.16, 0.2, w + 0.16, 2, 0.02).translate(0, 0.1, 0), color, m);
    kit.add('stone', new RoundedBoxGeometry(w, h - 0.32, w, 2, 0.015).translate(0, 0.2 + (h - 0.32) / 2, 0), color, m);
    kit.add('stone', new RoundedBoxGeometry(w + 0.12, 0.12, w + 0.12, 2, 0.02).translate(0, h - 0.06, 0), color, m);
  }
}

// A smooth body from a lathe of radii along its length (for animals' bodies, figures' torsos): `prof` is [t, r] pairs
// with t from 0 to 1 along `len`, laid along x
function body(len, prof, seg = 32) {
  const g = new THREE.LatheGeometry(prof.map(([t, r]) => new THREE.Vector2(r, t * len)), seg);
  g.rotateZ(-Math.PI / 2); g.translate(-len / 2, 0, 0);
  return g;
}

// A standing or reaching human figure in bronze, about `h` tall, from smooth parts
function figure(kit, m, h, color, { arms = 'up', lean = 0 } = {}) {
  const s = h / 1.8, f = local(m, 0, 0, 0, lean, 0, 0, s);
  kit.add('bronze', new THREE.CapsuleGeometry(0.075, 0.75, 8, 16).translate(-0.1, 0.45, 0), color, f);
  kit.add('bronze', new THREE.CapsuleGeometry(0.075, 0.75, 8, 16).translate(0.1, 0.45, 0), color, f);
  kit.add('bronze', new THREE.LatheGeometry([[0, 0], [0.16, 0.02], [0.19, 0.2], [0.15, 0.36], [0.21, 0.52], [0.12, 0.6], [0, 0.62]].map(([r, y]) => new THREE.Vector2(r, y)), 32).translate(0, 0.86, 0), color, f);
  kit.add('bronze', new THREE.SphereGeometry(0.11, 24, 16).scale(1, 1.15, 1).translate(0, 1.6, 0), color, f);
  const arm = (side, ang) => kit.add('bronze', new THREE.CapsuleGeometry(0.055, 0.62, 8, 12).translate(0, 0.33, 0).rotateZ(side * ang).translate(side * 0.2, 1.38, 0), color, f);
  if (arms === 'up') { arm(1, -2.6); arm(-1, -2.6); } else if (arms === 'out') { arm(1, -1.8); arm(-1, -1.8); } else { arm(1, -0.25); arm(-1, -0.25); }
}

// ---- the pieces ----

// Mark di Suvero, "Orion" (1984), outside the Museum of Art: three long red-orange I-beams leaning into a tripod about
// 16 m high, a fourth thrust up and out past where they meet, and a short cross beam
function orion(kit) {
  const x = 656, z = 415, { g, m } = frame(x, z, 0.4);
  const col = '#d3451f', top = V(0.4, 12.2, 0.2);
  const feet = [V(-5.2, 0, -1.6), V(4.4, 0, -3.8), V(1.2, 0, 5.4)];
  feet.forEach((f, i) => kit.add('painted', iBeam(f.clone().setY(-0.3), top.clone().add(V(f.x * -0.12, 1.4, f.z * -0.12)), 0.75, 0.38, i * 1.1), col, m));
  kit.add('painted', iBeam(V(-2.2, 7.5, -1.2), V(4.6, 16.4, 2.6), 0.65, 0.34, 0.5), col, m);
  kit.add('painted', iBeam(V(-3.4, 10.6, 2.6), V(3.8, 11.9, -2.2), 0.5, 0.3, 1.4), col, m);
  for (const f of feet) {
    const p = f.clone().applyMatrix4(m);
    kit.add('stone', new THREE.CylinderGeometry(0.7, 0.75, 0.12, 32).translate(f.x, 0.06, f.z), '#8d8a84', m);
    kit.solid(p.x, p.z, 0.55, 0.55, g - 1, g + 3);
  }
}

// Charles Ginnever, "Daedalus" (1975): weathering steel plates folded in a
// rising zigzag, like a flight of wings, about 6 m long and 3.5 m high
function daedalus(kit) {
  const { g, m } = frame(700, 499, -0.3);
  const col = '#7b3f1f';
  let px = -3.2, py = 0;
  for (let i = 0; i < 5; i++) {
    const w = 1.5, h = 1.0 + i * 0.55, ang = i % 2 ? 0.75 : -0.75;
    const plate = new THREE.BoxGeometry(w, h, 0.05, 2, 2, 1).translate(w / 2, h / 2, 0).rotateY(ang);
    kit.add('corten', plate, col, local(m, px, py, 0));
    px += Math.cos(ang) * w; py = Math.max(0, i * 0.15);
  }
  kit.add('corten', new THREE.BoxGeometry(6.6, 0.08, 1.2).translate(0, 0.04, 0), '#5d3218', m);
  kit.solid(700, 499, 3.4, 1.6, g - 1, g + 3.5);
}

// Carl Milles, "Sunday Morning in Deep Waters" (1940), before the Michigan League: a broad round granite basin,
// a ring of water jets and, on a rock in the middle, Triton with a horn among leaping fish and boys riding dolphins
function milles(kit) {
  const x = 834, z = 38, { g, m } = frame(x, z, 0);
  const R = 6.4;
  kit.add('stone', new THREE.LatheGeometry([[0, 0], [R + 0.4, 0], [R + 0.45, 0.5], [R + 0.25, 0.62], [R, 0.58], [R - 0.05, 0.15], [0, 0.15]].map(([r, y]) => new THREE.Vector2(r, y)), 96), '#9c968c', m);
  kit.add('water', new THREE.CircleGeometry(R - 0.03, 96).rotateX(-Math.PI / 2).translate(0, 0.42, 0), '#2f5f6e', m);
  // the rock in the middle
  const rock = new THREE.IcosahedronGeometry(1.4, 4), R2 = rng(7), p = rock.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.82 + R2() * 0.22; p.setXYZ(i, p.getX(i) * k, Math.max(-0.2, p.getY(i)) * k * 1.1, p.getZ(i) * k); }
  rock.computeVertexNormals();
  kit.add('stone', rock.translate(0, 0.4, 0), '#7d776d', m);
  // Triton, kneeling high with his horn up
  figure(kit, local(m, 0, 1.6, 0, 0, 0.4), 2.4, '#3c5a4a', { arms: 'up', lean: -0.15 });
  kit.add('bronze', new THREE.ConeGeometry(0.14, 0.9, 24, 1, true).rotateZ(0.5).translate(0.55, 4.45, 0), '#3c5a4a', m);
  // the fish and the boys on dolphins, leaping round him
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2, r = 2.6 + (i % 2) * 0.9, c = '#46624f';
    const f = local(m, Math.cos(a) * r, 0.35, Math.sin(a) * r, 0, -a + Math.PI / 2, 0);
    kit.add('bronze', tube([V(-0.9, 0.0, 0), V(-0.4, 0.9, 0), V(0.3, 1.1, 0), V(0.9, 0.5, 0), V(1.1, 0.0, 0)], 0.17, 48, false, 14), c, f);
    kit.add('bronze', new THREE.ConeGeometry(0.3, 0.4, 16).rotateZ(Math.PI / 2 + 0.6).translate(-0.98, 0.1, 0), c, f);
    if (i % 2 === 0) figure(kit, local(f, 0.1, 1.05, 0, 0, 0, 0.2), 0.95, c, { arms: 'out' });
  }
  // the jets, in a ring
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    kit.add('water', new THREE.LatheGeometry([[0.06, 0], [0.04, 0.8], [0.015, 1.4], [0, 1.5]].map(([r, y]) => new THREE.Vector2(r, y)), 10).rotateZ(-0.35).rotateY(-a).translate(Math.cos(a) * (R - 0.5), 0.42, Math.sin(a) * (R - 0.5)), '#cfe6ee', m);
  }
  kit.solid(x, z, 1.4, 1.4, g - 1, g + 2);
}

// Milles' smaller bronzes on the League's garden walls: the Sea Nymph riding a dolphin and the Rampant Unicorn
function seaNymph(kit) {
  const { g, m } = frame(913, 35, Math.PI);
  pedestal(kit, m, 0.9, 1.1, '#aaa397');
  const t = local(m, 0, 1.1, 0);
  kit.add('bronze', tube([V(-0.7, 0.1, 0), V(-0.3, 0.6, 0), V(0.3, 0.55, 0), V(0.7, 0.15, 0)], 0.16, 40, false, 14), '#3f5c4c', t);
  figure(kit, local(t, -0.05, 0.62, 0, 0, 0, -0.25), 1.1, '#3f5c4c', { arms: 'out' });
  kit.solid(913, 35, 0.5, 0.5, g - 1, g + 2.3);
}
function unicorn(kit) {
  const { g, m } = frame(912, 22, Math.PI);
  pedestal(kit, m, 0.9, 1.1, '#aaa397');
  const t = local(m, 0, 1.1, 0, 0, 0, 0.75), c = '#3f5c4c';
  kit.add('bronze', body(1.2, [[0, 0.05], [0.12, 0.2], [0.5, 0.25], [0.85, 0.2], [1, 0.05]]).translate(0, 0.4, 0), c, t);
  kit.add('bronze', tube([V(0.5, 0.5, 0), V(0.75, 0.85, 0), V(0.85, 1.05, 0)], 0.1, 20, false, 12), c, t);
  kit.add('bronze', body(0.4, [[0, 0.04], [0.3, 0.11], [1, 0.06]]).rotateZ(-0.6).translate(0.98, 1.05, 0), c, t);
  kit.add('bronze', new THREE.ConeGeometry(0.03, 0.42, 12).rotateZ(-0.3).translate(1.0, 1.42, 0), '#c9a85a', t);
  for (const [lx, lz, a] of [[-0.45, 0.1, 0.1], [-0.45, -0.1, -0.1], [0.45, 0.12, -1.0], [0.45, -0.12, -0.7]]) kit.add('bronze', new THREE.CapsuleGeometry(0.04, 0.5, 6, 10).translate(0, -0.28, 0).rotateZ(a).translate(lx, 0.32, lz), c, t);
  kit.solid(912, 22, 0.5, 0.5, g - 1, g + 2.5);
}

// The pair of bronze pumas crouched on granite pedestals at the gate
function puma(kit, x, z, yaw) {
  const { g, m } = frame(x, z, yaw);
  pedestal(kit, m, 1.1, 1.3, '#8f8a83');
  const t = local(m, 0, 1.3, 0), c = '#5a4a32';
  kit.add('bronze', body(1.5, [[0, 0.08], [0.08, 0.26], [0.35, 0.3], [0.7, 0.27], [0.9, 0.24], [1, 0.08]]).translate(0, 0.52, 0), c, t);
  kit.add('bronze', new THREE.SphereGeometry(0.2, 32, 20).scale(1.2, 1, 1).translate(0.88, 0.72, 0), c, t);
  kit.add('bronze', new THREE.SphereGeometry(0.1, 16, 12).translate(1.08, 0.66, 0), c, t);
  for (const s of [-1, 1]) kit.add('bronze', new THREE.ConeGeometry(0.06, 0.12, 12).translate(0.84, 0.92, s * 0.1), c, t);
  for (const [lx, s] of [[0.5, 1], [0.5, -1], [-0.5, 1], [-0.5, -1]]) kit.add('bronze', new THREE.CapsuleGeometry(0.07, 0.36, 6, 12).translate(lx, 0.25, s * 0.17), c, t);
  kit.add('bronze', tube([V(-0.72, 0.5, 0), V(-1.05, 0.25, 0.1), V(-1.0, 0.06, 0.32), V(-0.7, 0.04, 0.42)], 0.045, 32, false, 10), c, t);
  kit.solid(x, z, 0.65, 0.65, g - 1, g + 2.4);
}

// Bronze books stacked on a plinth
function bookStack(kit, x, z, n = 6) {
  const { g, m } = frame(x, z, 0.2);
  pedestal(kit, m, 0.9, 0.5, '#9a958c');
  const R = rng(x * 3 + z), cols = ['#6c5634', '#7b6236', '#5e4a2c'];
  let y = 0.5;
  for (let i = 0; i < n; i++) {
    const w = 0.55 + R() * 0.25, d = 0.4 + R() * 0.2, h = 0.08 + R() * 0.07;
    kit.add('bronze', new RoundedBoxGeometry(w, h, d, 2, 0.015).translate(0, y + h / 2, 0).rotateY((R() - 0.5) * 0.6), cols[i % 3], m);
    y += h;
  }
  kit.solid(x, z, 0.5, 0.5, g - 1, g + y);
}

// An open bronze book on a stand
function openBook(kit, x, z) {
  const { g, m } = frame(x, z, 0);
  pedestal(kit, m, 0.7, 0.9, '#a39d93', true);
  const t = local(m, 0, 0.95, 0, -0.35, 0, 0), c = '#6c5634';
  for (const s of [-1, 1]) {
    const pg = new THREE.PlaneGeometry(0.42, 0.6, 16, 2), p = pg.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = (p.getX(i) + 0.21) / 0.42; p.setXYZ(i, s * (0.02 + u * 0.4), Math.sin(u * Math.PI * 0.9) * 0.07 + 0.02, p.getY(i)); }
    pg.computeVertexNormals();
    kit.add('bronze', pg, c, t);
    kit.add('bronze', new THREE.BoxGeometry(0.44, 0.03, 0.62).translate(s * 0.22, -0.005, 0), c, t);
  }
  kit.solid(x, z, 0.4, 0.4, g - 1, g + 1.2);
}

// A tall bronze flame twisting up off a pedestal
function flame(kit) {
  const x = 1072, z = -272, { g, m } = frame(x, z, 0);
  pedestal(kit, m, 0.8, 1.2, '#a6a094', true);
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, a = t * 3 + k * 2.1; pts.push(V(Math.cos(a) * 0.18 * (1 - t), 1.2 + t * (1.9 - k * 0.3), Math.sin(a) * 0.18 * (1 - t))); }
    const tb = tube(pts, 0.14, 48, false, 16), p = tb.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = Math.min(1, (p.getY(i) - 1.2) / 1.9), cx = 0; p.setX(i, cx + (p.getX(i) - cx) * (1 - t * 0.7)); p.setZ(i, p.getZ(i) * (1 - t * 0.7)); }
    tb.computeVertexNormals();
    kit.add('bronze', tb, '#7a5a2c', m);
  }
  kit.solid(x, z, 0.45, 0.45, g - 1, g + 3);
}

// Jens Zorn's polished stainless pieces round the physics buildings, each a diagram in steel
function gMinusTwo(kit) { // the muon's spin precessing in its ring: a ring with a helix wound round it
  const { g, m } = frame(987, 345, 0);
  const t = local(m, 0, 1.75, 0, Math.PI / 2 - 0.25);
  kit.add('steel', new THREE.TorusGeometry(1.2, 0.05, 16, 128), '#d9dde0', t);
  const pts = []; for (let i = 0; i <= 240; i++) { const a = i / 240 * Math.PI * 2, b = a * 12; pts.push(V(Math.cos(a) * (1.2 + Math.cos(b) * 0.2), Math.sin(a) * (1.2 + Math.cos(b) * 0.2), Math.sin(b) * 0.2)); }
  kit.add('steel', tube(pts, 0.022, 480, true, 8), '#e8ebee', t);
  kit.add('steel', new THREE.CylinderGeometry(0.06, 0.08, 0.6, 24).translate(0, 0.3, 0), '#cfd3d6', m);
  kit.add('stone', new THREE.CylinderGeometry(0.45, 0.5, 0.15, 32).translate(0, 0.07, 0), '#8f8b85', m);
  kit.solid(987, 345, 0.4, 0.4, g - 1, g + 3);
}
function positronium(kit, x, z) { // an electron and a positron circling each other: two spheres on crossed rings
  const { g, m } = frame(x, z, 0.6);
  kit.add('stone', new THREE.CylinderGeometry(0.45, 0.5, 0.15, 32).translate(0, 0.07, 0), '#8f8b85', m);
  kit.add('steel', new THREE.CylinderGeometry(0.05, 0.07, 1.1, 24).translate(0, 0.55, 0), '#cfd3d6', m);
  const t = local(m, 0, 1.9, 0);
  kit.add('steel', new THREE.TorusGeometry(0.7, 0.03, 12, 96).rotateX(0.5), '#e2e5e8', t);
  kit.add('steel', new THREE.TorusGeometry(0.7, 0.03, 12, 96).rotateX(-0.5).rotateY(1.2), '#e2e5e8', t);
  for (const s of [-1, 1]) kit.add('steel', new THREE.SphereGeometry(0.2, 32, 20).translate(s * 0.7, 0, 0), '#f0f2f4', t);
  kit.solid(x, z, 0.4, 0.4, g - 1, g + 2.7);
}
function feynman(kit) { // Veltman's diagram: particle lines meeting at vertices, a loop between
  const { g, m } = frame(975, 337, -0.2);
  kit.add('stone', new RoundedBoxGeometry(2.2, 0.15, 0.6, 2, 0.02).translate(0, 0.07, 0), '#8f8b85', m);
  const lines = [[V(-1, 0.1, 0), V(-0.5, 1.2, 0)], [V(1, 0.1, 0), V(0.5, 1.2, 0)], [V(-0.5, 1.2, 0), V(-1, 2.3, 0)], [V(0.5, 1.2, 0), V(1, 2.3, 0)]];
  for (const [a, b] of lines) kit.add('steel', tube([a, a.clone().lerp(b, 0.5), b], 0.045, 8, false, 12), '#dfe2e5', m);
  const wave = []; for (let i = 0; i <= 40; i++) { const t = i / 40; wave.push(V(-0.5 + t, 1.2 + Math.sin(t * Math.PI * 6) * 0.08, 0)); }
  kit.add('steel', tube(wave, 0.03, 120, false, 10), '#eef0f2', m);
  kit.add('steel', new THREE.TorusGeometry(0.22, 0.035, 12, 64).translate(0, 1.2, 0), '#eef0f2', m);
  kit.solid(975, 337, 1.1, 0.4, g - 1, g + 2.4);
}

// Liberman, "Begob" (1968, North Campus): big red-painted steel cylinders cut on the slant and stacked at angles
function begob(kit) {
  const { g, m } = frame(2922, -1338, 0.3);
  const c = '#c4231e';
  kit.add('painted', new THREE.CylinderGeometry(1.1, 1.1, 2.4, 64, 1, true).rotateZ(0.25).translate(0, 1.15, 0), c, m);
  kit.add('painted', new THREE.CylinderGeometry(0.75, 0.75, 3.2, 64, 1, true).rotateX(0.9).translate(0.3, 2.6, 0.9), c, m);
  kit.add('painted', new THREE.CylinderGeometry(0.5, 0.5, 2.6, 48, 1, true).rotateZ(-1.0).translate(-0.9, 3.3, -0.4), c, m);
  kit.add('painted', new THREE.CylinderGeometry(1.08, 1.08, 2.36, 64, 1, true).rotateZ(0.25).translate(0, 1.15, 0).scale(0.97, 1, 0.97), '#8f1814', m);
  kit.solid(2922, -1338, 1.3, 1.3, g - 1, g + 4.2);
}

// Fletcher Benton, "Tilted Donut Wheel with S" (weathering steel): a thick ring tilted on its edge with an S across it
function donut(kit) {
  const { g, m } = frame(2891, -1006, 0.8);
  const t = local(m, 0, 1.55, 0, 0, 0, 0.18);
  kit.add('corten', new THREE.TorusGeometry(1.3, 0.28, 32, 128), '#6e3a1c', t);
  const s = []; for (let i = 0; i <= 40; i++) { const u = i / 40, a = (u * 2 - 1) * Math.PI; s.push(V(Math.sin(a) * 0.55 * (u < 0.5 ? 1 : -1) * Math.abs(Math.sin(a)), (0.5 - u) * 2.2, 0)); }
  kit.add('corten', tube(s, 0.12, 80, false, 16), '#6e3a1c', t);
  kit.add('corten', new THREE.BoxGeometry(1.0, 0.08, 0.7).translate(0, 0.04, 0), '#5a2f17', m);
  kit.solid(2891, -1006, 1.0, 0.6, g - 1, g + 3);
}

// Kenneth Snelson, "Indexer II": stainless tubes held apart in the air by taut cables, none touching another
function indexer(kit) {
  const { g, m } = frame(2803, -1203, 0);
  const R = rng(91), struts = [], H = 5.2;
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + k * 0.7, b = a + 2.4, y0 = k * 1.6, y1 = y0 + 2.8;
      struts.push([V(Math.cos(a) * 1.2, y0 + 0.05, Math.sin(a) * 1.2), V(Math.cos(b) * 1.2, Math.min(H, y1), Math.sin(b) * 1.2)]);
    }
  }
  for (const [a, b] of struts) kit.add('steel', new THREE.CylinderGeometry(0.06, 0.06, a.distanceTo(b), 20).translate(0, a.distanceTo(b) / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize())).translate(a.x, a.y, a.z), '#dfe3e6', m);
  for (let i = 0; i < struts.length; i++) {
    for (const j of [(i + 1) % struts.length, (i + 4) % struts.length]) {
      const a = struts[i][1], b = struts[j][0];
      if (a.distanceTo(b) < 0.2) continue;
      kit.add('steel', new THREE.CylinderGeometry(0.008, 0.008, a.distanceTo(b), 6).translate(0, a.distanceTo(b) / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize())).translate(a.x, a.y, a.z), '#9da3a8', m);
    }
  }
  void R;
  kit.solid(2803, -1203, 1.3, 1.3, g - 1, g + 2);
}

// Alice Aycock, "Summaries of Arithmetic up to the Year 2000": a white aluminum swirl of ribbons spun round a center
function aycock(kit) {
  const { g, m } = frame(2715, -1431, 0);
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * Math.PI * 3 + k * Math.PI / 2, r = 0.4 + Math.sin(t * Math.PI) * 1.4; pts.push(V(Math.cos(a) * r, 0.3 + t * 4.4, Math.sin(a) * r)); }
    kit.add('painted', tube(pts, 0.06, 160, false, 10), '#f2f2ee', m);
  }
  kit.add('painted', new THREE.CylinderGeometry(0.08, 0.1, 4.8, 24).translate(0, 2.4, 0), '#e9e9e4', m);
  kit.solid(2715, -1431, 0.3, 0.3, g - 1, g + 5);
}

// Three polished stainless cubes balanced corner to face up a slanting axis
function threeCubes(kit) {
  const { g, m } = frame(2766, -1570, 0.3);
  let y = 0;
  [1.3, 1.0, 0.75].forEach((s, i) => {
    const t = local(m, i * 0.25, y + s * 0.62, 0, 0.6 + i * 0.4, i * 0.5, 0.62);
    kit.add('steel', new RoundedBoxGeometry(s, s, s, 3, 0.03), '#e3e6e9', t);
    y += s * 1.15;
  });
  kit.solid(2766, -1570, 0.9, 0.9, g - 1, g + y);
}

// The Lorch Column: a single fluted Doric column of white marble, saved from the old Lorch Hall
function lorch(kit) {
  const { g, m } = frame(2543, -1162, 0);
  kit.add('stone', new RoundedBoxGeometry(1.5, 0.35, 1.5, 2, 0.02).translate(0, 0.17, 0), '#d8d4ca', m);
  const col = new THREE.CylinderGeometry(0.42, 0.5, 5.6, 80, 20), p = col.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z); if (r < 0.01) continue; const k = 1 - 0.035 * Math.max(0, Math.cos(a * 20)) ** 4; p.setX(i, x * k); p.setZ(i, z * k); }
  col.computeVertexNormals();
  kit.add('stone', col.translate(0, 0.35 + 2.8, 0), '#ebe7de', m);
  kit.add('stone', new THREE.CylinderGeometry(0.6, 0.44, 0.3, 48).translate(0, 6.1, 0), '#ebe7de', m);
  kit.add('stone', new RoundedBoxGeometry(1.35, 0.3, 1.35, 2, 0.02).translate(0, 6.4, 0), '#ebe7de', m);
  kit.solid(2543, -1162, 0.75, 0.75, g - 1, g + 6.6);
}

// Maya Lin, "The Wave Field" (1995): about fifty rows of grassed earth swells, standing waves up to a metre and a
// half high, in a square about 27 m on a side
function waveField(kit) {
  const x = 3018, z = -1485, { m } = frame(x, z, 0, 0.12);
  const S = 27, N = 108, geo = new THREE.PlaneGeometry(S, S, N, N).rotateX(-Math.PI / 2), p = geo.attributes.position, c = new Float32Array(p.count * 3);
  const lo = new THREE.Color('#5f8a3c'), hi = new THREE.Color('#87ad55'), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getZ(i), edge = Math.min(1, (S / 2 - Math.max(Math.abs(u), Math.abs(v))) / 2);
    const h = (0.55 + 0.45 * Math.sin(v * 0.6 + u * 0.12)) * Math.max(0, Math.sin(u * 0.45 + Math.sin(v * 0.18) * 1.6)) ** 1.5 * 1.5 * edge;
    p.setY(i, groundHeight(x + u, z + v) - groundHeight(x, z) + 0.12 + h);
    col.copy(lo).lerp(hi, Math.min(1, h / 1.2)); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  kit.add('grass', geo, null, m);
}

// The Rock at Hill and Washtenaw, painted over and over by students: a big boulder thick in bright paint
function theRock(kit) {
  const x = 1638, z = 783, { g, m } = frame(x, z, 0.5, 0.3);
  const rock = new THREE.IcosahedronGeometry(1.3, 5), p = rock.attributes.position, R = rng(1638);
  const bumps = Array.from({ length: 9 }, () => [V(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), 0.1 + R() * 0.15]);
  const paints = ['#ffcb05', '#00274c', '#ffffff', '#d7263d', '#2fa05a', '#7a5cff', '#ff7a3d'].map((h) => new THREE.Color(h));
  const c = new Float32Array(p.count * 3), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let r = 1; for (const [d, k] of bumps) r += k * Math.max(0, n.dot(d)) ** 3;
    p.setXYZ(i, n.x * r * 1.25, Math.max(-0.1, n.y * r * 0.85), n.z * r * 1.05);
    // bands of paint, the newest coat in Michigan maize and blue with slogans' colors over it
    const band = Math.floor((n.y * 2.2 + Math.sin(n.x * 5 + n.z * 3) * 0.5 + 3)) % paints.length;
    const pc = paints[(band + (n.x > 0.3 ? 2 : 0)) % paints.length];
    c[i * 3] = pc.r; c[i * 3 + 1] = pc.g; c[i * 3 + 2] = pc.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(c, 3));
  rock.computeVertexNormals();
  kit.add('painted', rock.translate(0, 0.8, 0), null, m);
  kit.solid(x, z, 1.5, 1.4, g - 1, g + 1.7);
}

export function buildPublicArt(group) {
  const kit = new Kit();
  const pieces = [
    ['Orion', orion], ['Daedalus', daedalus], ['Sunday Morning in Deep Waters', milles], ['Sea Nymph', seaNymph], ['Rampant Unicorn', unicorn],
    ['Pumas', (k) => { puma(k, 1178, 99, -Math.PI / 2 + 0.2); puma(k, 1162, 103, -Math.PI / 2 - 0.2); }],
    ['Beal books', (k) => bookStack(k, 852, 499)], ['Book of Knowledge', (k) => openBook(k, 316, 531)], ['Flame of Wisdom', flame],
    ['g Minus Two', gMinusTwo], ['Positronium', (k) => positronium(k, 987, 337)], ["Veltman's Diagram", feynman],
    ['Begob', begob], ['Tilted Donut with S', donut], ['Indexer II', indexer], ['Summaries of Arithmetic', aycock], ['Three Cubes', threeCubes],
    ['Lorch Column', lorch], ['The Wave Field', waveField], ['The Rock', theRock]
  ];
  for (const [name, make] of pieces) { make(kit); kit.names.push(name); }
  let tris = 0, draws = 0;
  for (const [k, list] of Object.entries(kit.bins)) {
    if (!list.length) continue;
    const geo = mergeGeometries(list);
    for (const g of list) g.dispose();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, ...MATS[k] });
    if (k === 'water') { mat.transparent = true; mat.opacity = 0.82; }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'PublicArt-' + k; mesh.castShadow = k !== 'water' && k !== 'grass'; mesh.receiveShadow = true;
    group.add(mesh);
    tris += geo.attributes.position.count / 3; draws++;
  }
  log(`[public art] ${kit.names.length} pieces in ${draws} draws, ${(tris / 1000).toFixed(0)}k triangles`);
  return { colliders: kit.colliders, count: kit.names.length };
}
