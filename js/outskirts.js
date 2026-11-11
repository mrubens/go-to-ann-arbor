import * as THREE from 'three/webgpu';
import { positionWorld, vec2, vec3, vec4, float, floor, fract, sin, dot, mix, smoothstep, abs, fwidth, min, step, clamp, length, texture, uniform, attribute, uv, cameraPosition } from 'three/tsl';
import { TOWN_BOUNDS, TOWN_EDGE, TOWN_EDGE_PATCHES, BLOCKS, ROADS, WATER_POLYGONS, PARKING_LOTS, inTown, freewayAt } from './city-config.js';
import { GEO } from './city-geodata.js';
import { groundHeight, cityGround, GROUND_ORDER } from './terrain.js';
import { coreTriangles, coreHeightAt, underDrops } from './ground-core.js';
import { cityUniforms } from './tsl-materials.js';
import { seasonDay } from './seasons.js';
import { log, hot } from '../lamp-game.js';
import { TIER, XBOX } from './device-tier.js';

// Washtenaw County around the detailed city: the real hills and the Huron valley (terrain.js) as farm fields, woodlots
// and the suburbs' tree cover, out to the fogged horizon. Nothing here is driven on; the city's edge is a lawn border.

const hash = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

// The town seen from far off or from the air, where its own ground, houses and trees aren't drawn: one picture of it
// from above (`paintTown`, once the buildings and trees are made) laid on the coarse ground under the city: its streets,
// blocks (lawn or paving), parks, lots, the river, roofs and tree crowns in the season's color; and a second, half as
// fine, of what glows at night (the streets, their lamps, the lots, a little of the buildings) whose green is the
// town's own outline. 4096 px over the town (~2 m a pixel) on full and light, 2048 on a phone, the Xbox and the slow
// tier; the paintings are let go once they're on the GPU. Until it's painted the town is the suburbs' canopy below
const TOWN_SIZE = Math.max(TOWN_BOUNDS.maxX - TOWN_BOUNDS.minX, TOWN_BOUNDS.maxZ - TOWN_BOUNDS.minZ) + 40;
const TOWN_X0 = (TOWN_BOUNDS.minX + TOWN_BOUNDS.maxX - TOWN_SIZE) / 2, TOWN_Z0 = (TOWN_BOUNDS.minZ + TOWN_BOUNDS.maxZ - TOWN_SIZE) / 2;
const TOWN_PX = TIER.name === 'full' || TIER.name === 'light' ? 4096 : 2048;
function townTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size; // (blank till it's painted, at its size: the GPU's copy is made once)
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = TIER.antialias ? 8 : 4;
  tex.userData.size = size;
  tex.onUpdate = () => { if (tex.image === canvas) canvas.width = canvas.height = 1; };
  return tex;
}
const townColor = townTexture(TOWN_PX);
townColor.colorSpace = THREE.SRGBColorSpace;
const townGlow = townTexture(TOWN_PX / 2);
townGlow.colorSpace = THREE.NoColorSpace;
// (a new version of this file makes its own: these let go)
hot(import.meta).dispose(() => { townColor.dispose(); townGlow.dispose(); });
// the trees' color from above by the season (painted with the town; the suburbs' canopy takes it too)
const uCanopy = uniform(new THREE.Color(0x3f6a2c));

function canopyColors(day) {
  if (day >= 108 && day < 140) return ['#7c9a4c', '#6f8f45', '#86a557', '#5f7f3a'];
  if (day >= 140 && day < 262) return ['#3f6a2c', '#4a7432', '#355e28', '#557a38'];
  if (day >= 262 && day < 305) return ['#a0612a', '#b57a2c', '#8a3a22', '#6b7a34', '#c09032', '#7d5a2a'];
  return ['#6a5f52', '#5e564c', '#71665a', '#2f4a30'];
}

// a ring or line in world metres ({x, z} points or a flat [x, z, ...] list) onto the path being made
function trace(ctx, pts, close) {
  const flat = typeof pts[0] === 'number', n = flat ? pts.length >> 1 : pts.length;
  if (n < 2) return;
  const X = flat ? (i) => pts[2 * i] : (i) => pts[i].x, Z = flat ? (i) => pts[2 * i + 1] : (i) => pts[i].z;
  ctx.moveTo(X(0), Z(0));
  for (let i = 1; i < n; i++) ctx.lineTo(X(i), Z(i));
  if (close) ctx.closePath();
}
// A street lamp every `spacing` metres along each street but the freeways: [x, z, ...]
function streetLamps(spacing) {
  const out = [];
  for (const r of ROADS) {
    const pts = r.pts;
    if (!pts || pts.length < 2 || r.highway || /Underpass|Tunnel/.test(r.name)) continue;
    let next = spacing / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      for (; next < len; next += spacing) out.push(a.x + (b.x - a.x) * next / len, a.z + (b.z - a.z) * next / len);
      next -= len;
    }
  }
  return out;
}

// The town's street lamps seen from the air at night: one soft warm dot each, a couple of pixels across however far
// (from ~300 m out, where the lamps' own heads are left off, to the haze), added over the city in one draw that's only
// drawn after dark (`update`). Every other lamp on a phone, the Xbox and the slow tier
function farLampSprites() {
  const lamps = streetLamps(TIER.antialias ? 35 : 70);
  const n = lamps.length / 2, at = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = lamps[i * 2], z = lamps[i * 2 + 1];
    at[i * 3] = x; at[i * 3 + 1] = groundHeight(x, z) + 7; at[i * 3 + 2] = z;
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aLamp', new THREE.InstancedBufferAttribute(at, 3));
  geo.instanceCount = n;
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const center = attribute('aLamp', 'vec3');
  const dist = length(center.sub(cameraPosition));
  mat.positionNode = center;
  // (a little smaller and dimmer into the haze, so the lamps toward the horizon, crowded together there, don't run
  // into one bright band)
  mat.scaleNode = vec2(clamp(dist.pow(0.8).mul(0.012), 1.0, 30.0));
  const r = length(uv().sub(0.5)).mul(2.0);
  const spot = float(1.0).sub(smoothstep(0.0, 1.0, r)).pow(2.0);
  const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
  const shown = smoothstep(250.0, 600.0, dist).mul(float(1.0).sub(smoothstep(3500.0, 6000.0, dist)));
  const haze = float(1.0).div(dist.div(1200.0).add(1.0));
  mat.colorNode = vec4(vec3(1.0, 0.72, 0.42).mul(spot.mul(shown).mul(haze).mul(night).mul(4.0)), 1.0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'FarStreetLamps';
  mesh.frustumCulled = false;
  mesh.renderOrder = GROUND_ORDER + 1;
  mesh.visible = false;
  mesh.userData.terrain = 'set';
  log(`[outskirts] ${n} street lamps for the night seen from afar`);
  return mesh;
}

const firstPoint = (pts) => (typeof pts[0] === 'number' ? [pts[0], pts[1]] : [pts[0].x, pts[0].z]);
const rand = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

// Paints the town from above (blocks: buildings.js allBlocks with their footprints; canopy: street-details.js's
// [x, z, crown radius, ...]), from scratch each time
function paintTown({ blocks = [], canopy = null } = {}) {
  const t0 = performance.now();
  const canvasFor = (tex) => {
    const c = document.createElement('canvas');
    c.width = c.height = tex.userData.size;
    const ctx = c.getContext('2d');
    const k = tex.userData.size / TOWN_SIZE;
    ctx.setTransform(k, 0, 0, k, -TOWN_X0 * k, -TOWN_Z0 * k);
    ctx.lineCap = ctx.lineJoin = 'round';
    return { c, ctx };
  };
  const ring = (ctx, pts) => { ctx.beginPath(); trace(ctx, pts, true); };
  const rings = (ctx, list) => { ctx.beginPath(); for (const r of list) trace(ctx, r, true); };
  const streets = ROADS.filter((r) => r.pts && r.pts.length > 1 && !/Underpass|Tunnel/.test(r.name));

  // the colors
  const { c, ctx } = canvasFor(townColor);
  ctx.fillStyle = '#4b4b4d'; // the roadway left between the blocks
  ring(ctx, TOWN_EDGE); ctx.fill();
  for (const q of TOWN_EDGE_PATCHES) { ring(ctx, q.pts); ctx.fill(); } // (Lamp: the freeways' stretches taken into town)
  ctx.strokeStyle = '#8e8b85';
  ctx.lineWidth = 3;
  for (const b of BLOCKS) {
    if (b.median) continue;
    const park = b.park > 0.6;
    ring(ctx, b.poly);
    ctx.fillStyle = park ? '#557d36' : b.lawn ? '#5f7f3e' : '#8e8b85';
    ctx.fill();
    if (b.lawn || park) ctx.stroke(); // its sidewalk ring
  }
  ctx.fillStyle = '#557d36';
  for (const park of GEO.parks || []) for (const r of park.rings || []) { ring(ctx, r); ctx.fill(); }
  ctx.fillStyle = '#58585a';
  for (const lot of PARKING_LOTS || []) { rings(ctx, lot); ctx.fill('evenodd'); }
  ctx.strokeStyle = '#48484a';
  for (const r of streets) {
    ctx.lineWidth = Math.max(5, r.w || 8);
    ctx.beginPath(); trace(ctx, r.pts, false); ctx.stroke();
  }
  ctx.fillStyle = '#34505a';
  for (const water of WATER_POLYGONS || []) { rings(ctx, water); ctx.fill('evenodd'); }
  // roofs: shingles on the low ones, membrane and gravel on the big ones
  const low = ['#5d5752', '#6b6159', '#4f4c4a', '#776a5c', '#5f646a', '#6e4f45'];
  const high = ['#9a9790', '#80817f', '#aaa69d', '#8b8a86'];
  let roofs = 0;
  for (const blk of blocks) {
    for (const f of blk.footprints || []) {
      if (!f.pts || f.pts.length < 3) continue;
      const [x, z] = firstPoint(f.pts), list = f.h > 14 ? high : low;
      ctx.fillStyle = list[Math.floor(rand(x, z) * list.length)];
      rings(ctx, [f.pts, ...(f.holes || [])]);
      ctx.fill('evenodd');
      roofs++;
    }
  }
  // tree crowns, over the roofs they overhang
  const leaves = canopyColors(seasonDay());
  uCanopy.value.set(leaves[0]);
  if (canopy) {
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < canopy.length; i += 3) {
      ctx.fillStyle = leaves[Math.floor(rand(canopy[i + 1], canopy[i]) * leaves.length)];
      ctx.beginPath(); ctx.arc(canopy[i], canopy[i + 1], canopy[i + 2], 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // what glows at night (red), added over the town's outline (green)
  const g = canvasFor(townGlow), gx = g.ctx;
  gx.fillStyle = 'rgb(0, 255, 0)';
  ring(gx, TOWN_EDGE); gx.fill();
  for (const q of TOWN_EDGE_PATCHES) { ring(gx, q.pts); gx.fill(); }
  gx.globalCompositeOperation = 'lighter';
  gx.fillStyle = 'rgb(60, 0, 0)';
  for (const lot of PARKING_LOTS || []) { rings(gx, lot); gx.fill('evenodd'); }
  for (const r of streets) {
    gx.strokeStyle = r.highway || (r.w || 0) >= 15 ? 'rgb(110, 0, 0)' : 'rgb(50, 0, 0)';
    gx.lineWidth = Math.max(6, (r.w || 8) * 0.8);
    gx.beginPath(); trace(gx, r.pts, false); gx.stroke();
  }
  // the street lamps, every ~35 m along each street
  gx.fillStyle = 'rgb(140, 0, 0)';
  const lamps = streetLamps(35);
  for (let i = 0; i < lamps.length; i += 2) gx.fillRect(lamps[i] - 3, lamps[i + 1] - 3, 6, 6);
  // lit windows: a little of most buildings, more of the big ones
  for (const blk of blocks) {
    for (const f of blk.footprints || []) {
      if (!f.pts || f.pts.length < 3) continue;
      const [x, z] = firstPoint(f.pts), r = rand(z + 7, x);
      if (r < 0.35) continue;
      gx.fillStyle = `rgb(${Math.round((f.h > 14 ? 60 : 30) * r)}, 0, 0)`;
      ring(gx, f.pts); gx.fill();
    }
  }
  gx.globalCompositeOperation = 'source-over';

  for (const [tex, canvas] of [[townColor, c], [townGlow, g.c]]) {
    tex.image = canvas;
    // (the painting let go once it's on the GPU: 64 MB at 4096 px)
    tex.onUpdate = () => { canvas.width = canvas.height = 1; tex.onUpdate = null; };
    tex.needsUpdate = true;
  }
  log(`[outskirts] the town painted from above for the far ground (${TOWN_PX} px): ${roofs} roofs, ${canopy ? canopy.length / 3 : 0} trees, in ${Math.round(performance.now() - t0)} ms`);
}

function createCountryMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const wp = positionWorld;
  // fields ~180 x 240 m in a grid turned a little off true north, like the township section roads
  const p = vec2(wp.x.mul(0.99).add(wp.z.mul(0.08)), wp.z.mul(0.99).sub(wp.x.mul(0.08)));
  const cell = floor(p.div(vec2(180, 240)));
  const h = hash(cell);
  const f = fract(p.div(vec2(180, 240)));
  const edge = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y)));
  const fw = fwidth(p.x).div(180).add(1e-4);
  const hedge = float(1).sub(smoothstep(0.0, fw.mul(2).add(0.02), edge)); // hedgerows between the fields
  const corn = vec3(0.33, 0.36, 0.17);
  const hay = vec3(0.46, 0.43, 0.25);
  const pasture = vec3(0.22, 0.32, 0.13);
  const soil = vec3(0.30, 0.25, 0.18);
  const wood = vec3(0.11, 0.19, 0.08);
  let c = mix(mix(corn, hay, smoothstep(0.3, 0.32, h)), mix(pasture, soil, smoothstep(0.82, 0.84, h)), smoothstep(0.55, 0.57, h));
  c = mix(c, wood, smoothstep(0.9, 0.92, h)); // woodlots
  // rows across each field, faint
  const rows = abs(sin(p.x.mul(0.9).add(h.mul(40)))).mul(0.06).mul(float(1).sub(smoothstep(0.0, 0.6, fwidth(p.x).mul(0.9))));
  c = c.mul(float(0.97).add(rows));
  c = mix(c, wood.mul(1.1), hedge.mul(0.85));
  // the suburbs near the city: more tree cover the closer it is, roofs among it in low-contrast browns and grays
  // (pale squares here read as white static from the air), the trees in the season's color
  const cx = (TOWN_BOUNDS.minX + TOWN_BOUNDS.maxX) / 2, cz = (TOWN_BOUNDS.minZ + TOWN_BOUNDS.maxZ) / 2;
  const dx = abs(wp.x.sub(cx)).sub((TOWN_BOUNDS.maxX - TOWN_BOUNDS.minX) / 2).max(0);
  const dz = abs(wp.z.sub(cz)).sub((TOWN_BOUNDS.maxZ - TOWN_BOUNDS.minZ) / 2).max(0);
  const near = float(1).sub(smoothstep(300, 1800, dx.add(dz)));
  const lot = floor(wp.xz.div(14));
  const canopy = hash(lot).mul(0.5).add(0.5);
  const roof = mix(vec3(0.16, 0.14, 0.12), vec3(0.25, 0.24, 0.23), hash(lot.add(7.3)));
  const trees = mix(vec3(0.12, 0.2, 0.08), uCanopy, 0.6).mul(canopy.mul(0.4).add(0.7));
  c = mix(c, mix(trees, roof, smoothstep(0.85, 0.9, canopy)), near.mul(0.75));
  // the town itself from its picture from above, where that's been painted (the glow's green is the town's outline)
  const tuv = vec2(wp.x.sub(TOWN_X0).div(TOWN_SIZE), wp.z.sub(TOWN_Z0).div(TOWN_SIZE));
  const inside = step(0.0, tuv.x).mul(step(tuv.x, 1.0)).mul(step(0.0, tuv.y)).mul(step(tuv.y, 1.0));
  const glow = texture(townGlow, tuv);
  const town = smoothstep(0.3, 0.7, glow.g).mul(inside);
  mat.colorNode = mix(c, texture(townColor, tuv).rgb, town);
  // at night its streets, lamps, lots and windows glow (as the houses' windows come on: houses.js)
  const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
  mat.emissiveNode = vec3(1.0, 0.62, 0.3).mul(glow.r.mul(glow.r).mul(2.4)).mul(town).mul(night);
  return mat;
}

function buildOutskirts(scene) {
  const group = new THREE.Group();
  group.name = 'Outskirts';
  const B = TOWN_BOUNDS;
  // a 50 m grid of the real heights out to 6 km beyond the city, with a hole where the city is
  const STEP = 50, MARGIN = 6000;
  const x0 = Math.floor((B.minX - MARGIN) / STEP) * STEP, x1 = Math.ceil((B.maxX + MARGIN) / STEP) * STEP;
  const z0 = Math.floor((B.minZ - MARGIN) / STEP) * STEP, z1 = Math.ceil((B.maxZ + MARGIN) / STEP) * STEP;
  const nx = (x1 - x0) / STEP + 1, nz = (z1 - z0) / STEP + 1;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP, k = (j * nx + i) * 3;
      pos[k] = x; pos[k + 1] = groundHeight(x, z) - 0.15; pos[k + 2] = z;
    }
  }
  // in PIECES x PIECES pieces of the grid, so those behind the camera or out to the side aren't drawn (one piece on the
  // Xbox, where a draw costs more than the triangles it saves)
  const PIECES = XBOX ? 1 : 3;
  const pieceIdx = Array.from({ length: PIECES * PIECES }, () => []);
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const cx0 = x0 + i * STEP, cz0 = z0 + j * STEP;
      const idx = pieceIdx[Math.min(PIECES - 1, Math.floor(j * PIECES / (nz - 1))) * PIECES + Math.min(PIECES - 1, Math.floor(i * PIECES / (nx - 1)))];
      // leave out the cells under the city (its streets & lawns cover the ground there)
      // (a cell is left out only where the town covers it all, with 25 m to spare: the town's edge follows the city limits)
      if (inTown(cx0 - 25, cz0 - 25) && inTown(cx0 + STEP + 25, cz0 - 25) && inTown(cx0 - 25, cz0 + STEP + 25) && inTown(cx0 + STEP + 25, cz0 + STEP + 25)) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
      // a cell reaching into the town: its corners in the town go down to under the lowest ground across the cell, so
      // the country between them stays under the town's own ground (lawns, road ends) where the two overlap; corners
      // out in the country keep their height, so nothing changes where only the country is drawn
      let touches = false;
      for (let u = 0; u <= STEP && !touches; u += STEP / 2) for (let v = 0; v <= STEP && !touches; v += STEP / 2) touches = inTown(cx0 + u, cz0 + v);
      if (!touches) continue;
      let low = Infinity;
      for (let u = 0; u <= STEP; u += 10) for (let v = 0; v <= STEP; v += 10) low = Math.min(low, groundHeight(cx0 + u, cz0 + v));
      // (Lamp: and where a freeway runs by the town's edge, the whole cell, so the country's coarse slope between an
      // embankment and a cutting never stands over the lanes: by US-23 at Geddes Rd it stood up over the northbound
      // carriageway as a pale slab)
      let byFreeway = false;
      for (let u = 0; u <= STEP && !byFreeway; u += STEP / 4) for (let v = 0; v <= STEP && !byFreeway; v += STEP / 4) byFreeway = freewayAt(cx0 + u, cz0 + v, 8);
      for (const [k, x, z] of [[a, cx0, cz0], [b, cx0 + STEP, cz0], [c, cx0, cz0 + STEP], [d, cx0 + STEP, cz0 + STEP]]) {
        if (byFreeway || inTown(x, z)) pos[k * 3 + 1] = Math.min(pos[k * 3 + 1], low - 0.3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(pieceIdx.flat());
  geo.computeVertexNormals();
  const mat = createCountryMaterial();
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (const idx of pieceIdx) {
    if (!idx.length) continue;
    // each piece its own triangles of the one grid (its positions and normals shared), bounded by its own corners
    const piece = new THREE.BufferGeometry();
    piece.setAttribute('position', geo.attributes.position);
    piece.setAttribute('normal', geo.attributes.normal);
    piece.setIndex(nx * nz > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
    box.makeEmpty();
    for (const k of idx) box.expandByPoint(v.fromArray(pos, k * 3));
    piece.boundingBox = box.clone();
    piece.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const land = new THREE.Mesh(piece, mat);
    land.name = 'CountryLand';
    land.receiveShadow = true;
    land.renderOrder = GROUND_ORDER; // drawn with the town's ground, after everything on it (terrain.js)
    land.userData.terrain = 'set'; // already on the ground
    group.add(land);
  }

  // under the city, a finer copy just below its streets and lawns: what shows where the city's own ground is too far
  // away to be drawn, so the hills read as hills from across town. On the city's mesh (terrain.js) it's that mesh's
  // coarser cut, under the fine one by more than the most the two can stray apart, so it never shows through.
  const city = cityGround();
  if (city) {
    group.add(undergroundOf(city, B, mat));
    return finishOutskirts(scene, group, pos, nx, nz, x0, x1, z0, z1, mat);
  }
  const FS = 20;
  const fx0 = Math.floor(B.minX / FS) * FS, fz0 = Math.floor(B.minZ / FS) * FS;
  const fnx = Math.ceil((B.maxX - fx0) / FS) + 1, fnz = Math.ceil((B.maxZ - fz0) / FS) + 1;
  const fpos = new Float32Array(fnx * fnz * 3);
  for (let j = 0; j < fnz; j++) {
    for (let i = 0; i < fnx; i++) {
      const x = fx0 + i * FS, z = fz0 + j * FS, k = (j * fnx + i) * 3;
      // by the Argo Cascades, the lowest ground around, so it stays under their narrow, deep channel between points
      let y = groundHeight(x, z);
      if (x > 100 && x < 700 && z > -1320 && z < -1000) {
        for (let u = -FS; u <= FS; u += FS / 2) for (let v = -FS; v <= FS; v += FS / 2) y = Math.min(y, groundHeight(x + u, z + v));
      }
      fpos[k] = x; fpos[k + 1] = y - 0.9; fpos[k + 2] = z;
    }
  }
  const fidx = new Uint32Array((fnx - 1) * (fnz - 1) * 6);
  let q = 0;
  for (let j = 0; j + 1 < fnz; j++) {
    for (let i = 0; i + 1 < fnx; i++) {
      const a = j * fnx + i, b = a + 1, c = a + fnx, d = c + 1;
      fidx[q++] = a; fidx[q++] = c; fidx[q++] = b; fidx[q++] = b; fidx[q++] = c; fidx[q++] = d;
    }
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setIndex(new THREE.BufferAttribute(fidx, 1));
  fgeo.computeVertexNormals();
  fgeo.computeBoundingSphere();
  const under = new THREE.Mesh(fgeo, mat);
  under.name = 'CityUnderground';
  under.receiveShadow = true;
  under.renderOrder = GROUND_ORDER;
  under.userData.terrain = 'set';
  group.add(under);

  return finishOutskirts(scene, group, pos, nx, nz, x0, x1, z0, z1, mat);
}

function finishOutskirts(scene, group, pos, nx, nz, x0, x1, z0, z1, mat) {
  // the horizon beyond: level farmland at the heights' edge
  let edge = 0, n = 0;
  for (let i = 0; i < nx; i++) { edge += pos[i * 3 + 1] + pos[((nz - 1) * nx + i) * 3 + 1]; n += 2; }
  const far = new THREE.Mesh(new THREE.RingGeometry(Math.max(x1 - x0, z1 - z0) * 0.5 - 200, 60000, 48, 1).rotateX(-Math.PI / 2), mat);
  far.position.set((x0 + x1) / 2, edge / n - 2, (z0 + z1) / 2);
  far.name = 'CountryHorizon';
  far.renderOrder = GROUND_ORDER;
  far.userData.terrain = 'set';
  group.add(far);
  const lamps = farLampSprites();
  group.add(lamps);

  scene.add(group);
  // (the lamps drawn only once the houses' windows come on: houses.js; no draw by day)
  return { group, colliders: [], update() { lamps.visible = cityUniforms.uInteriorGlow.value > 0.72; } };
}

// The city's mesh, coarsely cut, 0.9 m under it, over the city's bounds
// how far the coarse ground is kept under the fine at least: on an Xbox the fine ground strays further (TIER.ground,
// terrain.js); and where a coarse triangle rises over the fine ground (a dip or a bank it spans), its corners go down
// by that much and a margin more, so it never shows through a street or a lawn
const UNDER_DROP = TIER.ground ? 3 : 0.9, UNDER_MARGIN = 0.5;
function undergroundOf({ core, under }, B, mat) {
  const tri = coreTriangles(core, under), size = core.size, drops = underDrops(core, under);
  const index = new Map(), pos = [], idx = [];
  const vertex = (cx, cz) => {
    const k = cz * size + cx;
    let i = index.get(k);
    if (i === undefined) {
      index.set(k, (i = pos.length / 3));
      const drop = Math.max(UNDER_DROP, (drops.get(k) || 0) + UNDER_MARGIN);
      pos.push(core.x0 + cx * core.step, coreHeightAt(core, k) - drop, core.z0 + cz * core.step);
    }
    return i;
  };
  const inX = (v) => core.x0 + v * core.step;
  const inZ = (v) => core.z0 + v * core.step;
  for (let t = 0; t < tri.length; t += 6) {
    const [ax, az, bx, bz, cx, cz] = tri.slice(t, t + 6);
    if (Math.max(inX(ax), inX(bx), inX(cx)) < B.minX - 50 || Math.min(inX(ax), inX(bx), inX(cx)) > B.maxX + 50) continue;
    if (Math.max(inZ(az), inZ(bz), inZ(cz)) < B.minZ - 50 || Math.min(inZ(az), inZ(bz), inZ(cz)) > B.maxZ + 50) continue;
    // facing up (the mesh's triangles all go round the same way, anticlockwise seen from above)
    idx.push(vertex(ax, az), vertex(bx, bz), vertex(cx, cz));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'CityUnderground';
  mesh.receiveShadow = true;
  mesh.renderOrder = GROUND_ORDER;
  mesh.userData.terrain = 'set';
  log(`[outskirts] the ground under the city: ${idx.length / 3} triangles`);
  return mesh;
}

export { buildOutskirts, paintTown };
