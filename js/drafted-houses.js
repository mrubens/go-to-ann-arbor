import { asset, log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { TIER } from './device-tier.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';
import { renderSpec } from './drafted/spec-render.js';
import { buildDraftedYard, hedgeDriveways } from './drafted-yards.js';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Houses drafted from street photos by Open Facades (data/drafted-houses.json, saved from its map with "Save for
// Go To Ann Arbor"): each is a description of one real building (its masses, roofs, openings, chimneys) drawn by
// that project's own renderer (drafted/spec-render.js) where the building really stands, turned the way it really
// faces, in place of the survey's block there (`replaces`, as the landmarks do). `colliders` are their boxes.
//
// Each house also comes with its yard as attributes in the game's frame (`yard`: trees with their trunk position,
// height, crown width and leaves; fences from one end to the other with a style; shrubs, hedges, beds, walks,
// driveways and lawns as turned rectangles). The renderer is not asked to draw those: drafted-yards.js draws the
// fences and beds here, street-details.js the shrubs and hedges with the trees' leaves, and the trees are returned as `yard` for street-details.js to plant with the
// city's own (trees.js), so they look like the rest of the city.

// A drafted house is used only where it is good enough to be an improvement: Jev graded it at least MIN_GRADE against
// the photos (0 to 100), and its footprint covers much the same ground as the survey's block (so a house-sized draft
// never stands in for a school, and one turned the wrong way is left out). Elsewhere the game's own house stays.
const MIN_GRADE = 60, MIN_OVERLAP = 0.5;

// How a draft's own axes (x along its front, z back from it) sit in the game's frame: the drawn model's origin is the
// draft's middle (`center`, saved with it), turned by `rot` and put at (x, z)
function placing(h) {
  const all = h.spec.masses, c = Math.cos(h.rot), s = Math.sin(h.rot);
  const mid = h.center || { x: (Math.min(...all.map((m) => m.x)) + Math.max(...all.map((m) => m.x + m.w))) / 2, z: (Math.min(...all.map((m) => m.z)) + Math.max(...all.map((m) => m.z + m.d))) / 2 };
  return {
    toDraft: (wx, wz) => { const dx = wx - h.x, dz = wz - h.z; return [dx * c - dz * s + mid.x, mid.z - (dx * s + dz * c)]; },
    toGame: (sx, sz) => { const X = sx - mid.x, Z = mid.z - sz; return [h.x + X * c + Z * s, h.z - X * s + Z * c]; }
  };
}

// How much the draft's footprint and the survey's block share: the area in both over the area in either
function overlap(h, b) {
  const solid = h.spec.masses.filter((m) => !m.open), { toDraft } = placing(h);
  const inDraft = (wx, wz) => { const [sx, sz] = toDraft(wx, wz); return solid.some((m) => sx >= m.x && sx <= m.x + m.w && sz >= m.z && sz <= m.z + m.d); };
  const xs = h.ring.map((p) => p[0]), zs = h.ring.map((p) => p[1]);
  let both = 0, either = 0;
  for (let x = Math.min(b.minX, ...xs) - 2; x <= Math.max(b.maxX, ...xs) + 2; x += 0.5) for (let z = Math.min(b.minZ, ...zs) - 2; z <= Math.max(b.maxZ, ...zs) + 2; z += 0.5) {
    const a = inDraft(x, z), v = b.polygons.some((p) => p.outer?.length && polygonContains(p, x, z));
    if (a && v) both++; if (a || v) either++;
  }
  return either ? both / either : 0;
}

// The renderer makes each house of a hundred or so pieces, one draw each: drawn so, a street of them costs thousands of
// draws. Here every piece is baked where it stands and pieces that look alike (same material, same shadow) are joined
// into one mesh per block of the city, so a street of drafted houses costs a few dozen draws and blocks out of view
// are still skipped.
const CELL = 160;
function merger(group) {
  const buckets = new Map(), mats = new Map();
  // pieces of every color share a draw: the color goes into the vertices, the material keeps the rest
  const r2 = (v) => Math.round((v ?? 0) * 20) / 20;
  const keyOf = (m) => [m.map?.uuid || '', r2(m.roughness), r2(m.metalness), m.transparent ? m.opacity : 1, m.side, m.flatShading ? 1 : 0, m.emissive?.getHexString?.() || ''].join('|');
  const shared = (m, k) => {
    if (!mats.has(k)) { const c = m.clone(); c.color?.set(0xffffff); c.vertexColors = true; c.roughness = r2(m.roughness); c.metalness = r2(m.metalness); mats.set(k, c); }
    return mats.get(k);
  };
  function gather(model) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      const c = o.material.color || new THREE.Color(1, 1, 1), rgb = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
      g.applyMatrix4(o.matrixWorld);
      const mk = keyOf(o.material), mat = shared(o.material, mk);
      const e = o.matrixWorld.elements, cell = `${Math.floor(e[12] / CELL)},${Math.floor(e[14] / CELL)}`;
      const k = `${mk}#${o.castShadow ? 1 : 0}#${cell}`;
      if (!buckets.has(k)) buckets.set(k, { mat, cast: o.castShadow, geos: [] });
      buckets.get(k).geos.push(g);
    });
  }
  function finish() {
    let draws = 0;
    for (const { mat, cast, geos } of buckets.values()) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast; mesh.receiveShadow = true; mesh.name = 'DraftedHouses';
      mesh.matrixAutoUpdate = false;
      group.add(mesh); draws++;
      if (geos.length > 1) geos.forEach((g) => g.dispose());
    }
    buckets.clear();
    return draws;
  }
  return { gather, finish };
}

// the foundation under a house on a slope: plain gray stone, as the city's own houses' (one shared material)
const FOUNDATION = new THREE.MeshStandardNodeMaterial({ color: 0x8b867d, roughness: 0.92 });

// A mass's roof in the shape houses.js gives its own (controllers.js roofHeightAt): `a` along the ridge, `b` across
// it, the eaves at `top` and the ridge `rh` over them. (ux, uz) is the draft's x in the game's frame, its z (uz, -ux).
function roofOf(m, y, toGame, ux, uz) {
  const r = m.roof, H = m.wall_h;
  if (!r) return null;
  const X = [ux, uz], Z = [uz, -ux];
  const make = (sx, sz, a, ha, hb, top, rh, type, high = 0) => {
    const [cx, cz] = toGame(sx, sz), b = a === X ? Z : X;
    return { cx, cz, ax: a[0], az: a[1], bx: b[0], bz: b[1], ha, hb, top: y + top, rh: Math.max(0, rh), type, high };
  };
  const ea = r.eave_a ?? H, eb = r.eave_b ?? H, eave = (ea + eb) / 2, apex = r.apex ?? 0.5;
  if (r.type === 'gable' && r.ridge === 'z') {
    return make(m.x + apex * m.w, m.z + m.d / 2, Z, m.d / 2, Math.max(apex, 1 - apex) * m.w, eave, r.ridge_h - eave, 'gable');
  }
  if (r.type === 'gable') {
    return make(m.x + m.w / 2, m.z + apex * m.d, X, m.w / 2, Math.max(apex, 1 - apex) * m.d, eave, r.ridge_h - eave, 'gable');
  }
  const midX = m.x + m.w / 2, midZ = m.z + m.d / 2;
  if (r.type === 'hip') {
    return m.w >= m.d ? make(midX, midZ, X, m.w / 2, m.d / 2, H, r.ridge_h - H, 'hip') : make(midX, midZ, Z, m.d / 2, m.w / 2, H, r.ridge_h - H, 'hip');
  }
  if (r.type === 'shed') {
    // `high` is +1 where the high side is toward +b: across the draft's z for a front or back low side, its x else
    const acrossZ = r.low === 'front' || r.low === 'back';
    const high = r.low === 'front' || r.low === 'left' ? 1 : -1;
    return acrossZ ? make(midX, midZ, X, m.w / 2, m.d / 2, H, (r.high_h ?? H) - H, 'shed', high)
      : make(midX, midZ, Z, m.d / 2, m.w / 2, H, (r.high_h ?? H) - H, 'shed', high);
  }
  if (r.type === 'flat') return make(midX, midZ, X, m.w / 2, m.d / 2, H, 0, 'flat');
  return null;
}

export async function buildDraftedHouses(group) {
  const colliders = [], yard = [], bytes = await asset('data/drafted-houses.json');
  const data = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
  if (!data || !Array.isArray(data.buildings)) return { colliders, yard };
  let drawn = 0, weak = 0, misfit = 0;
  const { gather, finish } = merger(group);
  for (const h of data.buildings) {
    if (!h.spec || !Array.isArray(h.ring) || h.ring.length < 3) continue;
    if (!(h.grade >= MIN_GRADE)) { weak++; continue; }
    const xs = h.ring.map((p) => p[0]), zs = h.ring.map((p) => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    // the survey's block it would stand in: the one with the outline's middle inside it
    const b = REAL_BUILDINGS.find((b) => cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ && b.polygons.some((p) => p.outer?.length && polygonContains(p, cx, cz)));
    if (!b || overlap(h, b) < MIN_OVERLAP) { misfit++; continue; }
    let model;
    try { model = renderSpec(h.spec, { yard: false }); } catch (e) { log?.(`drafted house ${h.address || h.id} could not be drawn: ${e.message}`); continue; }
    // the yard is the game's to draw; a hedge takes its house's outline along, to be kept out of it (drafted-yards.js)
    for (const item of h.yard || []) yard.push({ ...item, house: h.id, ...(item.kind === 'hedge' && h.ring ? { ring: h.ring } : {}) });
    // houses stand on the highest ground under them, as the game's own do, on a foundation down to the lowest (below)
    const grounds = [groundHeight(cx, cz), ...h.ring.map(([x, z]) => groundHeight(x, z))];
    const y = Math.max(...grounds), minG = Math.min(...grounds);
    model.position.set(h.x, y, h.z); model.rotation.y = h.rot;
    // on a sloping lot the walls would stand clear of the ground at the low side: a stone foundation under each
    // ground-floor part, from just below the lowest ground up to the floor (in the renderer's frame: x - cx, cz - z)
    if (y - minG > 0.05) {
      const mid = model.userData.center;
      for (const m of h.spec.masses) {
        if (m.open || (m.base_h || 0) > 0.05 || !mid) continue;
        const depth = y - minG + 0.3;
        const f = new THREE.Mesh(new THREE.BoxGeometry(m.w, depth, m.d), FOUNDATION);
        f.position.set(m.x + m.w / 2 - mid.x, -depth / 2, mid.z - (m.z + m.d / 2));
        f.receiveShadow = true;
        model.add(f);
      }
    }
    gather(model); drawn++;
    // what the car runs into is what is drawn: a turned box around each of the house's solid parts (not the mapped
    // outline), down to the lowest ground, with the shape of its roof for the helicopter to set down on (controllers.js)
    const { toGame } = placing(h);
    const ux = Math.cos(h.rot), uz = -Math.sin(h.rot); // the draft's x (along its front) in the game's frame; its z is (uz, -ux)
    h.spec.masses.filter((m) => !m.open).forEach((m, i) => {
      const corners = [[m.x, m.z], [m.x + m.w, m.z], [m.x + m.w, m.z + m.d], [m.x, m.z + m.d]].map(([sx, sz]) => toGame(sx, sz));
      const [mx, mz] = toGame(m.x + m.w / 2, m.z + m.d / 2);
      const c = { minX: Math.min(...corners.map((p) => p[0])), maxX: Math.max(...corners.map((p) => p[0])), minZ: Math.min(...corners.map((p) => p[1])), maxZ: Math.max(...corners.map((p) => p[1])),
        minY: (m.base_h || 0) > 0.05 ? y + m.base_h : minG, maxY: y + Math.max(m.wall_h, m.roof.ridge_h || 0, m.roof.high_h || 0), keepsSurvey: true,
        obb: { cx: mx, cz: mz, hx: m.w / 2, hz: m.d / 2, cs: Math.cos(h.rot), sn: Math.sin(h.rot) } };
      const roof = roofOf(m, y, toGame, ux, uz);
      if (roof) c.roofs = [roof];
      if (i === 0) c.replaces = b;
      colliders.push(c);
    });
  }
  const draws = finish();
  // hidden where the survey's houses around them are let go (buildings.js streams them within TIER.stream), so they
  // never stand alone on the horizon: the scene's culling scales this by farCut, hence the division
  const reach = (TIER.stream || 1500) * (TIER.farCut < 1 ? 0.8 : 1);
  for (const o of group.children) if (o.name === 'DraftedHouses') o.userData.cullDistance = reach / (TIER.farCut || 1);
  await hedgeDriveways(yard);
  const yardMade = buildDraftedYard(group, yard);
  group.userData.terrain = 'set';
  const trees = yard.filter((y) => y.kind === 'tree').length;
  log?.(`drafted houses: ${drawn} used in ${draws} draws; ${weak} graded under ${MIN_GRADE} and ${misfit} that did not fit their block were left as the game draws them; yards: ${trees} trees handed to the tree field, ${yardMade.boxes} fence pieces`);
  group.userData.yard = yard;
  return { colliders, yard };
}
