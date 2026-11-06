import * as THREE from 'three/webgpu';
import { attribute, positionWorld, fract, smoothstep, mix, float, vec3, color, mx_noise_float } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';
import { cityUniforms } from './tsl-materials.js';

// Lamp: the town's public restrooms (data/restrooms.json, Assets/Tools/build-restrooms.py, from OpenStreetMap's
// amenity=toilets), each where the map has it. A restroom building stands on its mapped outline's smallest box in place
// of the survey's plain block there (`replaces`): split-face block walls on a darker plinth, a louvred vent band under
// the eaves, a shingled hip roof, a steel door in the middle of each long side (the men's one side, the women's the
// other) with its sign over it and a light that comes on at dusk; one the map calls a shelter too has a deep roof on
// posts over its sides. A restroom mapped as a point is a small one of the same kind where it isn't inside a building
// (one inside a building is that building's), or a portable toilet where its toilets are chemical. `colliders` are
// their walls; `footprints` keep traffic and walkers off them.

const WALL = 2.9, PLINTH = 0.5, VENT = 0.32;
const PAINT = { block: 0xc9b496, plinth: 0x8f7d68, vent: 0x4e4a44, roof: 0x5a4d44, fascia: 0x6e5c4c, door: 0x3d5a4a,
  frame: 0x8a8f8c, sign: 0x2d5fa0, white: 0xf2f2ee, post: 0x6e5c4c, slab: 0xa8a39a,
  potty: [0x2f6b45, 0x2f5f9e, 0x3a6e70], pottyRoof: 0xe8e6de, pottyDoor: 0x2a2a28 };
const hash = (x, z, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
const flat = (g) => { if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
// a piece's colour, and which surface pattern it takes (0 none, 1 block courses, 2 shingle courses, 3 plastic ribs)
function painted(g, hex, pat = 0) {
  g = flat(g);
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3), p = new Float32Array(n).fill(pat);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.setAttribute('pat', new THREE.BufferAttribute(p, 1));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// a hip roof over a box L by W (x along L), its eaves at 0, rising `rise` to a ridge along x
function hipRoof(L, W, rise) {
  const hl = L / 2, hw = W / 2, r = Math.max(0, hl - hw);
  const e = [[-hl, 0, -hw], [hl, 0, -hw], [hl, 0, hw], [-hl, 0, hw]], ra = [-r, rise, 0], rb = [r, rise, 0];
  const tri = [];
  const push = (...ps) => { for (const p of ps) tri.push(...p); };
  push(e[0], ra, e[1], e[1], ra, rb); // the -z side
  push(e[2], rb, e[3], e[3], rb, ra); // the +z side
  push(e[1], rb, e[2]); push(e[3], ra, e[0]); // the hips' ends
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  return g;
}

// the men's or the women's figure on a sign, in the sign's plane (x across, y up), facing +z
function figure(woman) {
  const parts = [new THREE.CircleGeometry(0.045, 14).translate(0, 0.13, 0)];
  if (woman) parts.push(new THREE.CircleGeometry(0.1, 3, Math.PI / 2).scale(0.9, 1.05, 1).translate(0, -0.01, 0));
  else parts.push(new THREE.PlaneGeometry(0.1, 0.15).translate(0, 0.0, 0));
  for (const s of [-0.025, 0.025]) parts.push(new THREE.PlaneGeometry(0.035, 0.1).translate(s, woman ? -0.14 : -0.12, 0));
  return mergeGeometries(parts.map(flat));
}

// a restroom building, L by W, in its own frame (x along L, the doors on the ±z sides), its floor at y 0
function restroom(L, W, shelter, base) {
  const parts = [], lights = [];
  parts.push(painted(box(L + 0.12, PLINTH - base, W + 0.12, 0, (PLINTH + base) / 2, 0), PAINT.plinth));
  parts.push(painted(box(L, WALL - VENT - PLINTH, W, 0, (WALL - VENT + PLINTH) / 2, 0), PAINT.block, 1));
  parts.push(painted(box(L - 0.06, VENT, W - 0.06, 0, WALL - VENT / 2, 0), PAINT.vent));
  // louvres along the vent band
  for (let y = WALL - VENT + 0.05; y < WALL - 0.02; y += 0.07) parts.push(painted(box(L + 0.02, 0.018, W + 0.02, 0, y, 0), PAINT.frame));
  // the roof: a fascia round the eaves and shingles up to the ridge
  const over = shelter ? 1.9 : 0.5, RL = L + 0.9, RW = W + over * 2;
  parts.push(painted(box(RL, 0.22, RW, 0, WALL + 0.11, 0), PAINT.fascia));
  parts.push(painted(hipRoof(RL + 0.04, RW + 0.04, Math.min(1.6, RW * 0.28)).translate(0, WALL + 0.22, 0), PAINT.roof, 2));
  if (shelter) {
    for (const s of [-1, 1]) for (let x = -L / 2; x <= L / 2 + 0.01; x += L / Math.max(1, Math.round(L / 3.5))) {
      parts.push(painted(box(0.2, WALL, 0.2, x, WALL / 2, s * (W / 2 + over - 0.25)), PAINT.post));
    }
    // a concrete slab under the roof
    parts.push(painted(box(RL, 0.12 - base, RW, 0, (0.12 + base) / 2, 0), PAINT.slab));
  }
  // a door in the middle of each long side, its frame, a sign over it and a light beside the sign
  for (const s of [-1, 1]) {
    const z = s * (W / 2);
    parts.push(painted(box(1.16, 2.24, 0.06, 0, 1.12 + 0.04, z + s * 0.01), PAINT.frame));
    parts.push(painted(box(0.98, 2.12, 0.06, 0, 1.06 + 0.04, z + s * 0.03), PAINT.door));
    parts.push(painted(box(0.05, 0.03, 0.08, 0.36, 1.06, z + s * 0.08), PAINT.frame));
    // a kick plate
    parts.push(painted(box(0.92, 0.25, 0.012, 0, 0.2, z + s * 0.065), PAINT.frame));
    parts.push(painted(box(0.36, 0.42, 0.03, 0, 2.48, z + s * 0.02), PAINT.sign));
    const fig = figure(s > 0).translate(0, 2.48, 0);
    if (s < 0) fig.rotateY(Math.PI);
    parts.push(painted(fig.translate(0, 0, z + s * 0.037), PAINT.white));
    lights.push(painted(box(0.22, 0.14, 0.12, 0.62, 2.45, z + s * 0.06), PAINT.white));
  }
  return { parts, lights };
}

// a portable toilet in its own frame, its door toward +z, on its skids at y 0
function portable(hex, base) {
  const parts = [];
  const w = 1.12, h = 2.18;
  parts.push(painted(box(w + 0.06, 0.1 - base, w + 0.06, 0, (0.1 + base) / 2, 0), PAINT.pottyDoor));
  parts.push(painted(box(w, h - 0.1, w, 0, 0.1 + (h - 0.1) / 2, 0), hex, 3));
  // a corner post down each edge
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(painted(box(0.07, h - 0.1, 0.07, a * w / 2, 0.1 + (h - 0.1) / 2, b * w / 2), hex));
  // its pale roof, domed a little, and the vent pipe out the back
  parts.push(painted(new THREE.SphereGeometry(0.75, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1).translate(0, h, 0), PAINT.pottyRoof));
  parts.push(painted(box(w + 0.08, 0.08, w + 0.08, 0, h, 0), PAINT.pottyRoof));
  parts.push(painted(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 10).translate(0.3, h - 0.05, -w / 2 - 0.06), PAINT.pottyRoof));
  // the door, a handle and the vacancy latch
  parts.push(painted(box(0.86, 1.92, 0.03, 0, 0.12 + 0.96, w / 2 + 0.015), hex, 3));
  parts.push(painted(box(0.04, 0.2, 0.05, 0.33, 1.05, w / 2 + 0.04), PAINT.pottyDoor));
  parts.push(painted(box(0.12, 0.05, 0.02, 0.3, 1.32, w / 2 + 0.035), 0x3c9a4a));
  return parts;
}

function createRestrooms(group, data) {
  group.name = 'Restrooms';
  const Bd = data?.buildings || [], P = data?.points || [];
  const all = [], glow = [], colliders = [], footprints = [];
  let kept = 0, huts = 0, potties = 0;
  const m4 = new THREE.Matrix4();
  const place = (geos, x, z, ux, uz, list) => {
    // x along (ux, uz), z across it, (-uz, ux)
    m4.makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux))
      .setPosition(x, 0, z);
    for (const g of geos) list.push(g.applyMatrix4(m4));
  };
  const obb = (x, z, ux, uz, hx, hz, minY, maxY) => {
    const ex = Math.abs(ux) * hx + Math.abs(uz) * hz, ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
    return { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY, maxY, obb: { cx: x, cz: z, hx, hz, cs: ux, sn: -uz }, keepsSurvey: true };
  };
  // the height it stands at, and how far its plinth runs down to the lowest ground under it
  const groundUnder = (x, z, ux, uz, hx, hz) => {
    let hi = -Infinity, lo = Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const h = groundHeight(x + ux * a * hx - uz * b * hz, z + uz * a * hx + ux * b * hz);
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
    return [hi + 0.05, lo - hi - 0.35];
  };
  const inBuilding = (x, z) => REAL_BUILDINGS.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ
    && b.polygons.some((p) => p.outer?.length && polygonContains(p, x, z)));

  for (let i = 0; i + 6 < Bd.length; i += 7) {
    const [x, z, ux, uz, L0, W0, shelter] = Bd.slice(i, i + 7);
    const L = Math.max(3, Math.min(16, L0)), W = Math.max(2.4, Math.min(9, W0));
    const [y, base] = groundUnder(x, z, ux, uz, L / 2, W / 2);
    const { parts, lights } = restroom(L, W, !!shelter, base);
    for (const g of [...parts, ...lights]) g.translate(0, y, 0);
    place(parts, x, z, ux, uz, all);
    place(lights, x, z, ux, uz, glow);
    const c = obb(x, z, ux, uz, L / 2 + 0.06, W / 2 + 0.06, y + base, y + WALL + 1.6);
    // the survey's block it stands in: one whose middle is inside its box
    const b = REAL_BUILDINGS.find((b) => {
      const r = b.polygons[0]?.outer;
      if (!r?.length || b.maxX < x - L || b.minX > x + L || b.maxZ < z - L || b.minZ > z + L) return false;
      let cx = 0, cz = 0;
      for (const p of r) { cx += p.x; cz += p.z; }
      cx = cx / r.length - x; cz = cz / r.length - z;
      return Math.abs(cx * ux + cz * uz) < L / 2 + 0.6 && Math.abs(-cx * uz + cz * ux) < W / 2 + 0.6;
    });
    if (b) c.replaces = b;
    colliders.push(c);
    footprints.push({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, pedestrianOnly: true });
    kept++;
  }
  for (let i = 0; i + 2 < P.length; i += 3) {
    const [x, z, chem] = P.slice(i, i + 3);
    if (inBuilding(x, z)) continue;
    const yaw = hash(x, z) * Math.PI * 2, ux = Math.cos(yaw), uz = Math.sin(yaw);
    if (chem) {
      const [y, base] = groundUnder(x, z, ux, uz, 0.6, 0.6);
      const parts = portable(PAINT.potty[Math.floor(hash(z, x) * PAINT.potty.length)], base);
      for (const g of parts) g.translate(0, y, 0);
      place(parts, x, z, ux, uz, all);
      const c = obb(x, z, ux, uz, 0.6, 0.6, y + base, y + 2.4);
      colliders.push(c);
      footprints.push({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, pedestrianOnly: true });
      potties++;
    } else {
      const L = 4.4, W = 3.2, [y, base] = groundUnder(x, z, ux, uz, L / 2, W / 2);
      const { parts, lights } = restroom(L, W, false, base);
      for (const g of [...parts, ...lights]) g.translate(0, y, 0);
      place(parts, x, z, ux, uz, all);
      place(lights, x, z, ux, uz, glow);
      const c = obb(x, z, ux, uz, L / 2 + 0.06, W / 2 + 0.06, y + base, y + WALL + 1.6);
      colliders.push(c);
      footprints.push({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, pedestrianOnly: true });
      huts++;
    }
  }

  if (all.length) {
    // block courses on the walls, shingle courses on the roofs, moulded ribs on the portable toilets, all a little
    // weathered
    const pat = attribute('pat', 'float'), p = positionWorld;
    const course = smoothstep(0.0, 0.025, fract(p.y.div(0.2))).mul(smoothstep(1.0, 0.975, fract(p.y.div(0.2))));
    const shingle = smoothstep(0.0, 0.08, fract(p.y.div(0.11)));
    const rib = smoothstep(0.3, 0.5, fract(p.x.add(p.z).mul(5.5))).mul(0.12).add(0.88);
    const grime = mx_noise_float(p.mul(1.7)).mul(0.08).add(0.96);
    const f = pat.equal(1).select(mix(0.62, 1.0, course), pat.equal(2).select(mix(0.7, 1.0, shingle), pat.equal(3).select(rib, float(1))));
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    mat.colorNode = vec3(f.mul(grime));
    const mesh = new THREE.Mesh(mergeGeometries(all), mat);
    mesh.name = 'Restrooms';
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (glow.length) {
    const lit = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5 });
    lit.emissiveNode = color(0xfff0d0).mul(smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow).mul(2.4).add(0.03));
    const mesh = new THREE.Mesh(mergeGeometries(glow), lit);
    mesh.name = 'Restroom lights';
    mesh.userData.cullDistance = 300;
    group.add(mesh);
  }
  log(`[restrooms] ${kept} restroom buildings, ${huts} small restrooms, ${potties} portable toilets`);
  return { colliders, footprints };
}

async function buildRestrooms(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/restrooms.json')));
  } catch (error) { log(`[restrooms] no restroom data: ${error}`); }
  return createRestrooms(group, data);
}

export { buildRestrooms };
