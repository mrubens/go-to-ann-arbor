// Lamp: the far city. Every building beyond the detailed buildings' reach drawn as a plain block: its surveyed
// outline (simplified) up to its height, in its wall colour with a flat roof, and every house as its oriented box with
// a gable in its siding and shingle colours (houses.js houseFarLook), merged into one draw per 1.5 km tile (2 km on the slow tier, a
// phone or the Xbox). A faint grid of window rows on the walls, filtered away where it would shimmer, lights up at
// night with the interiors (cityUniforms.uInteriorGlow).
//
// No building is drawn twice and none goes missing: each block belongs to the detailed mesh that draws its building
// (a 1 km chunk of surveyed facades, building-footprints.js `detailChunk`, shown or hidden by scene-culling.js) or to
// the streamed square of houses it stands in (houses.js streamHouses). Each of those is a unit with a value in a small
// texture the blocks read in their vertex shader: 0 while the detailed one is hidden (the block drawn), rising to 1 over
// FADE seconds once it's shown (the block dissolving away by a screen-door dither, so the detail fades in behind it
// rather than popping), and the block folded to a point at 1. When the detail goes (culled far off, or a square let
// go) its blocks are back at once. A tile whose units are all detailed is hidden outright.
//
// What the tier gets (device-tier.js): full and light every building and house; slow the bigger buildings and the
// larger houses; a phone and the Xbox only buildings over a size threshold.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, varying, textureLoad, ivec2, int, float, vec2, vec3, positionLocal, positionWorld, screenCoordinate,
  interleavedGradientNoise, step, smoothstep, fract, floor, sin, dot, fwidth, max, min, mix, abs, normalize, cross,
  dFdx, dFdy, pow
} from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { TIER } from './device-tier.js';
import { houseFarLook } from './houses.js';
import { log } from '../lamp-game.js';

// what each tier draws far off: houses at least this footprint (m², Infinity: none), other buildings at least this
// footprint or this tall, the outline simplified to within this many metres, and the tile size
const LEVELS = {
  full: { house: 0, big: 0, tall: 0, simplify: 0.8, tile: 1500 },
  light: { house: 0, big: 0, tall: 0, simplify: 1.0, tile: 1500 },
  slow: { house: 140, big: 180, tall: 12, simplify: 1.5, tile: 2000 },
  phone: { house: Infinity, big: 500, tall: 16, simplify: 2.0, tile: 2000 }
};
const FADE = 0.8; // seconds a block takes to dissolve once its detailed building is drawn
const MASK_W = 128;

// the facades' looks (buildings.js `facades`, by index): wall colour, roof colour and how dense the window grid is
const FACADE_LOOK = [
  [0xd8cdb8, 0x8d8a84, 0.8], [0xa45a45, 0x6f6a64, 0.8], [0x2a4a62, 0x7a7c80, 1], [0x34312e, 0x6c6c6c, 1],
  [0x5d7a96, 0x8a8e94, 1], [0xe6e0d2, 0x55575a, 0.6], [0xd9c98e, 0x55575a, 0.6], [0x7d8c99, 0x55575a, 0.6],
  [0x8a4632, 0x7c776f, 0.8], [0xcfc6b0, 0x8d8a84, 0.8], [0xb27a52, 0x77736c, 0.8]
];

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return a / 2;
}
function inside(ring, x, z) {
  let inn = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inn = !inn;
  }
  return inn;
}
// Douglas-Peucker on a closed ring: the outline kept within `tol` metres
function simplifyRing(ring, tol) {
  const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].z === ring[ring.length - 1].z ? ring.slice(0, -1) : ring;
  if (pts.length <= 4) return pts;
  // split at the point farthest from the first, and simplify each half as an open line
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].z - pts[0].z) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const line = (i0, i1) => {
    const a = pts[i0], b = pts[i1 % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i % pts.length];
      const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    keep[best % pts.length] = 1;
    line(i0, best);
    line(best, i1);
  };
  line(0, far);
  line(far, pts.length);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

const srgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

function createFarCityMaterial(mask) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
  mat.name = 'FarCity';
  const info = attribute('farInfo', 'vec3'); // unit, ground, top
  const unit = info.x;
  const fade = textureLoad(mask, ivec2(int(unit.mod(MASK_W)), int(floor(unit.div(MASK_W))))).x;
  const fadeV = varying(fade, 'vFarFade');
  // a block whose building is drawn in detail folds to a point (none of it rasterised)
  mat.positionNode = positionLocal.mul(float(1).sub(step(0.995, fade)));
  // the dissolve: a screen-door dither, no blending or sorting
  mat.maskNode = interleavedGradientNoise(screenCoordinate.xy).greaterThanEqual(fadeV);
  const wallC = attribute('farWall', 'vec4');
  const roofC = attribute('farRoof', 'vec4');
  const groundV = varying(info.y, 'vFarGround');
  const topV = varying(info.z, 'vFarTop');
  const unitV = varying(unit, 'vFarUnit');
  // the windows: a grid along the wall (its horizontal direction from the face's own normal) and up from the ground,
  // faded to its average where a cell gets near a pixel; [day mix, night glow]
  const windows = Fn(() => {
    const n = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
    const isWall = float(1).sub(smoothstep(0.35, 0.6, abs(n.y)));
    const t = normalize(vec2(n.z.negate(), n.x).add(vec2(1e-5, 0)));
    const u = dot(positionWorld.xz, t).div(3.1);
    const v = positionWorld.y.sub(groundV).div(3.4);
    const cu = fract(u), cv = fract(v);
    const grid = step(0.28, cu).mul(step(cu, 0.74)).mul(step(0.32, cv)).mul(step(cv, 0.78));
    const sharp = float(1).sub(smoothstep(0.3, 0.75, max(fwidth(u), fwidth(v))));
    const rows = step(1.1, positionWorld.y.sub(groundV)).mul(step(positionWorld.y, topV.sub(0.7)));
    const win = mix(float(0.21), grid, sharp).mul(rows).mul(isWall).mul(wallC.w);
    const h = fract(sin(dot(vec3(floor(u), floor(v), unitV), vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const lit = mix(float(0.42), step(h, 0.42), sharp);
    return vec3(isWall, win, win.mul(lit));
  })();
  const lin = (c) => pow(c.rgb, vec3(2.2));
  mat.colorNode = Fn(() => {
    const wall = lin(wallC);
    const glass = vec3(0.035, 0.045, 0.055);
    const body = mix(wall, glass, windows.y.mul(0.65));
    return mix(lin(roofC), body, windows.x);
  })();
  const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
  mat.emissiveNode = vec3(1.0, 0.72, 0.42).mul(windows.z).mul(night).mul(1.6);
  return mat;
}

/**
 * Builds the far city into `scene` from the records buildings.js keeps for it (`farRecords`) and the streamed houses'
 * state (`houseStream`, houses.js), and answers { group, update(dt, cameraPosition) }.
 */
function buildFarCity(scene, farRecords, houseStream) {
  const group = new THREE.Group();
  group.name = 'FarCity';
  scene.add(group);
  const L = LEVELS[TIER.name] || LEVELS.light;
  if (!farRecords) return { group, update() {} };

  // the units: a detailed chunk of facades, or a square of houses
  const units = []; // { chunk } | { key }
  const unitOf = new Map();
  const unitFor = (thing, make) => {
    let u = unitOf.get(thing);
    if (u === undefined) { u = units.length; units.push(make()); unitOf.set(thing, u); }
    return u;
  };
  const tiles = new Map();
  const tileOf = (x, z) => {
    const key = Math.floor(x / L.tile) + ',' + Math.floor(z / L.tile);
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { pos: [], wall: [], roof: [], info: [], idx: [], units: new Set() }));
    return t;
  };
  let nBig = 0, nHouses = 0, nTris = 0;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
  // a triangle wound so its face looks along (hx, hy, hz)
  const tri = (t, i, j, k, hx, hy, hz) => {
    const P = t.pos;
    _a.set(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]);
    _b.set(P[k * 3] - P[i * 3], P[k * 3 + 1] - P[i * 3 + 1], P[k * 3 + 2] - P[i * 3 + 2]);
    _n.crossVectors(_a, _b);
    if (_n.x * hx + _n.y * hy + _n.z * hz < 0) t.idx.push(i, k, j);
    else t.idx.push(i, j, k);
    nTris++;
  };
  const vert = (t, x, y, z, wall, roof, unit, ground, top) => {
    t.pos.push(x, y, z);
    t.wall.push(...wall);
    t.roof.push(...roof);
    t.info.push(unit, ground, top);
    return t.pos.length / 3 - 1;
  };

  // 1. the surveyed buildings (not houses), each under its detailed chunk
  for (const r of farRecords.surveyed || []) {
    const chunk = r.detailChunk;
    if (!chunk || !(r.height > 0)) continue;
    let area = 0;
    for (const p of r.polygons) area += Math.abs(ringArea(p.outer));
    if (area < L.big && r.height < L.tall) continue;
    const look = FACADE_LOOK[r.facade ?? 1] || FACADE_LOOK[1];
    const wall = [...srgb(look[0]), Math.round(look[2] * 255)];
    const roof = [...srgb(look[1]), 255];
    const unit = unitFor(chunk, () => ({ chunk }));
    const g = r.ground ?? 0, base = Math.min(r.minGround ?? g, g) - 0.4, top = g + r.height + 0.22;
    const t = tileOf(r.cx, r.cz);
    t.units.add(unit);
    for (const polygon of r.polygons) {
      const ring = simplifyRing(polygon.outer, L.simplify);
      if (ring.length < 3 || Math.abs(ringArea(ring)) < 4) continue;
      const i0 = t.pos.length / 3;
      for (const p of ring) {
        vert(t, p.x, base, p.z, wall, roof, unit, g, top);
        vert(t, p.x, top, p.z, wall, roof, unit, g, top);
      }
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        // outward: the side of the wall the outline isn't on
        let nx = dz / len, nz = -dx / len;
        if (inside(ring, (a.x + b.x) / 2 + nx * 0.05, (a.z + b.z) / 2 + nz * 0.05)) { nx = -nx; nz = -nz; }
        const a0 = i0 + i * 2, b0 = i0 + ((i + 1) % n) * 2;
        tri(t, a0, b0, a0 + 1, nx, 0, nz);
        tri(t, a0 + 1, b0, b0 + 1, nx, 0, nz);
      }
      const pts = ring.map((p) => new THREE.Vector2(p.x, p.z));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) tri(t, i0 + a * 2 + 1, i0 + b * 2 + 1, i0 + c * 2 + 1, 0, 1, 0);
    }
    nBig++;
  }

  // 2. the houses, each under its streamed square, as their box and gable
  const built = houseStream?.built;
  if (built && L.house < Infinity) {
    for (const r of farRecords.houses || []) {
      const f = houseFarLook(r);
      if (!f || f.area < Math.max(25, L.house)) continue;
      const unit = unitFor(f.key, () => ({ key: f.key }));
      const fb = f.box;
      const ground = r.ground ?? 0, minG = r.minGround ?? ground;
      const g = Math.max((ground + minG) / 2, ground - 0.7);
      const base = minG - 0.3, eave = g + f.eave, ridge = eave + f.rise;
      const wall = [...srgb(f.wall), f.garage ? 0 : 150];
      const roof = [...srgb(f.roof), 255];
      const t = tileOf(r.cx, r.cz);
      t.units.add(unit);
      const ux = fb.ax, uz = fb.az, vx = -fb.az, vz = fb.ax, hl = fb.L / 2, hw = fb.W / 2;
      const P = (u, v, y) => vert(t, fb.cx + ux * u + vx * v, y, fb.cz + uz * u + vz * v, wall, roof, unit, g, ridge);
      const c = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
      const lo = c.map(([u, v]) => P(u, v, base)), hi = c.map(([u, v]) => P(u, v, eave));
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const mu = (c[i][0] + c[j][0]) / 2, mv = (c[i][1] + c[j][1]) / 2;
        const hx = ux * mu + vx * mv, hz = uz * mu + vz * mv;
        tri(t, lo[i], lo[j], hi[i], hx, 0, hz);
        tri(t, hi[i], lo[j], hi[j], hx, 0, hz);
      }
      if (f.rise > 0.05) {
        // the ridge along the house's length, gable ends at its short sides
        const r0 = P(-hl, 0, ridge), r1 = P(hl, 0, ridge);
        tri(t, hi[0], hi[3], r0, -ux, 0, -uz);
        tri(t, hi[1], hi[2], r1, ux, 0, uz);
        tri(t, hi[0], hi[1], r0, -vx, 1, -vz);
        tri(t, r0, hi[1], r1, -vx, 1, -vz);
        tri(t, hi[3], hi[2], r0, vx, 1, vz);
        tri(t, r0, hi[2], r1, vx, 1, vz);
      } else {
        tri(t, hi[0], hi[1], hi[2], 0, 1, 0);
        tri(t, hi[0], hi[2], hi[3], 0, 1, 0);
      }
      nHouses++;
    }
  }

  // the units' values, read by the blocks' vertex shader
  const rows = Math.max(1, Math.ceil(units.length / MASK_W));
  const maskData = new Uint8Array(MASK_W * rows * 4);
  const mask = new THREE.DataTexture(maskData, MASK_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  mask.magFilter = mask.minFilter = THREE.NearestFilter;
  mask.generateMipmaps = false;
  mask.needsUpdate = true;
  const material = createFarCityMaterial(mask);
  const meshes = [];
  for (const t of tiles.values()) {
    if (!t.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    geo.setAttribute('farWall', new THREE.BufferAttribute(new Uint8Array(t.wall), 4, true));
    geo.setAttribute('farRoof', new THREE.BufferAttribute(new Uint8Array(t.roof), 4, true));
    geo.setAttribute('farInfo', new THREE.Float32BufferAttribute(t.info, 3));
    geo.setIndex(t.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'FarCityTile';
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.userData.units = [...t.units];
    if (meshes.length) mesh.userData.sharesPipelineWith = meshes[0];
    group.add(mesh);
    meshes.push(mesh);
  }
  log(`[far city] ${nBig} buildings and ${nHouses} houses as blocks: ${meshes.length} tiles, ${Math.round(nTris / 1000)}k triangles, ${units.length} units`);

  // Per frame: each unit's detailed building shown or not, its value eased toward it, the texture sent when it changed
  const fadeOf = new Float32Array(units.length);
  const _s = new THREE.Vector3();
  const chunkShown = (m, cam) => {
    if (m.parent) {
      for (let o = m; o; o = o.parent) if (!o.visible) return false;
      return true;
    }
    // (merged away into a bundle on the Xbox, scene-culling.js: its own distance, as the culling would judge it)
    const s = m.geometry.boundingSphere;
    if (!s) return false;
    _s.copy(s.center);
    const d = (m.userData.cullDistance || 1600) * TIER.farCut + s.radius;
    return _s.distanceToSquared(cam) < d * d;
  };
  function update(dt, cam) {
    let changed = false;
    const step = Math.min(1, Math.max(0, dt) / FADE);
    for (let u = 0; u < units.length; u++) {
      const unit = units[u];
      const shown = unit.chunk ? chunkShown(unit.chunk, cam) : built.has(unit.key);
      const was = fadeOf[u];
      const now = shown ? Math.min(1, was + step) : 0;
      if (now === was) continue;
      fadeOf[u] = now;
      const byte = Math.round(now * 255);
      if (maskData[u * 4] !== byte) { maskData[u * 4] = byte; changed = true; }
    }
    if (changed) mask.needsUpdate = true;
    for (const mesh of meshes) {
      let any = false;
      for (const u of mesh.userData.units) if (fadeOf[u] < 1) { any = true; break; }
      mesh.visible = any;
    }
  }
  return { group, update, meshes, stats: () => ({ tiles: meshes.length, drawn: meshes.filter((m) => m.visible).length }) };
}

export { buildFarCity };
