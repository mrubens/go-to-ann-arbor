// Where the sun's shadows aren't drawn (an Xbox, split screen), what keeps the city from looking flat: a soft dark
// blob under each tree, bench, lamp post, bin, hydrant, person and parked car near the view (one instanced mesh for
// the round ones, one for the cars), and a darker band on the ground along the foot of each building. Three draws in
// all, laid out again when the view has moved REFRESH m, the people every frame. The moving cars and the player
// already have their own (traffic.js, controllers.js).
import * as THREE from 'three/webgpu';
import { color, vec4, attribute, mrt, output } from 'three/tsl';
import { groundHeight } from './terrain.js';
import { blockAt } from './city-config.js';
import { createContactShadowMaterial } from './tsl-materials.js';

const REACH = 120, REFRESH = 10; // m: what's laid out, and how far the view moves before it's laid out again
const MAX_ROUND = 1400, MAX_CARS = 260;
const BAND = 1.5; // m out from a building's wall
const MAX_BAND_QUADS = 9000;
const KEPT_BANDS = 4000; // buildings whose bands are kept made, the latest laid out

// a blob's radius by what it's under
const SIZE = { tree: 0, bench: 0.85, lamp: 0.35, trash: 0.45, hydrant: 0.32, sign: 0.25, signal: 0.35, chair: 0.45, table: 0.7 };

function bandMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const shade = attribute('shade', 'float');
  mat.colorNode = color(0x050608);
  mat.opacityNode = shade.mul(shade).mul(0.42);
  mat.mrtNode = mrt({ output, normal: vec4(0, 0, 0, 0), metalRough: vec4(0, 1, 0, shade.mul(0.3)) });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  return mat;
}

// `near(x, z, r)`, when given, lists the colliders around a point from a grid (controllers.js nearColliders: its list
// is reused by the next call), rather than every collider in town being looked at each REFRESH m
function createGroundShade(group, { colliders, peds, near = null }) {
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const roundMat = createContactShadowMaterial({ round: true });
  roundMat.polygonOffset = true; roundMat.polygonOffsetFactor = -2; roundMat.polygonOffsetUnits = -4;
  const round = new THREE.InstancedMesh(plane, roundMat, MAX_ROUND);
  const cars = new THREE.InstancedMesh(plane, createContactShadowMaterial(), MAX_CARS);
  for (const m of [round, cars]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 997; m.name = 'GroundShade'; }

  const bandGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_BAND_QUADS * 4 * 3), shade = new Float32Array(MAX_BAND_QUADS * 4);
  const index = new Uint32Array(MAX_BAND_QUADS * 6);
  for (let q = 0; q < MAX_BAND_QUADS; q++) {
    const v = q * 4, i = q * 6;
    index[i] = v; index[i + 1] = v + 2; index[i + 2] = v + 1; index[i + 3] = v + 1; index[i + 4] = v + 2; index[i + 5] = v + 3;
  }
  // Static usage on purpose: three.js re-uploads a DynamicDrawUsage attribute in every render pass of every frame
  // (~0.6 MB here). layOut() uploads the quads in use when it lays them out, and only then
  bandGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bandGeo.setAttribute('shade', new THREE.BufferAttribute(shade, 1));
  bandGeo.setIndex(new THREE.BufferAttribute(index, 1));
  bandGeo.setDrawRange(0, 0);
  const band = new THREE.Mesh(bandGeo, bandMaterial());
  band.frustumCulled = false; band.renderOrder = 996; band.name = 'GroundShade';
  group.add(band, round, cars);

  // a point's height on what's there: a block's sidewalk or lawn, else the street
  const lift = (x, z) => groundHeight(x, z) + (blockAt(x, z) ? 0.185 : 0.02);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let still = 0, cx = Infinity, cz = Infinity, c2x = Infinity, c2z = Infinity, seenLength = -1, laid = false;
  // a building's band quads (12 floats of corners each), made once: the walls and the ground by them don't move
  const bands = new Map();
  function bandOf(col) {
    let made = bands.get(col);
    if (made) return made;
    const pts = col.polygon.outer, len = pts.length;
    let area = 0;
    for (let i = 0, j = len - 1; i < len; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    // (x, z) counterclockwise (area > 0): the right of each wall, (ez, -ex), is outside
    const out = area > 0 ? 1 : -1;
    const quads = [];
    for (let i = 0, j = len - 1; i < len; j = i++) {
      const a = pts[j], b = pts[i], ex = b.x - a.x, ez = b.z - a.z, l = Math.hypot(ex, ez);
      if (l < 0.3) continue;
      const nx = (ez / l) * out * BAND, nz = (-ex / l) * out * BAND;
      const ya = lift(a.x + nx * 0.1, a.z + nz * 0.1), yb = lift(b.x + nx * 0.1, b.z + nz * 0.1);
      quads.push(a.x, ya, a.z, b.x, yb, b.z, a.x + nx, ya, a.z + nz, b.x + nx, yb, b.z + nz);
    }
    made = Float32Array.from(quads);
    if (bands.size >= KEPT_BANDS) bands.delete(bands.keys().next().value);
    bands.set(col, made);
    return made;
  }

  function blob(mesh, i, x, y, z, w, l, yaw) {
    p.set(x, y, z); s.set(w, 1, l); q.setFromAxisAngle(up, yaw);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }

  // the still things and the buildings, near (x, z) and, in split screen, near the second view's (x2, z2)
  function layOut(x, z, x2, z2) {
    cx = x; cz = z; c2x = x2; c2z = z2; seenLength = colliders.length;
    let n = 0, c = 0, quads = 0;
    const r2 = REACH * REACH;
    const visit = (col) => {
      const k = col.knock;
      if (k && !k.down) {
        let rad = SIZE[k.kind];
        if (k.kind === 'tree') rad = Math.min(3.4, Math.max(1.2, (k.height || 8) * 0.24));
        if (rad == null) rad = Math.min(0.9, Math.max(0.3, k.r || 0.4));
        if (n < MAX_ROUND) blob(round, n++, k.x, lift(k.x, k.z), k.z, rad * 2, (k.kind === 'bench' ? rad * 1.1 : rad * 2), k.yaw || 0);
      } else if (col.parked && col.obb) {
        const o = col.obb;
        if (c < MAX_CARS) blob(cars, c++, o.cx, groundHeight(o.cx, o.cz) + 0.03, o.cz, o.hx * 2 + 0.3, o.hz * 2 + 0.3, Math.atan2(o.sn, o.cs));
      } else if (col.polygon?.outer && col.maxX - col.minX < 300 && col.maxZ - col.minZ < 300 && quads < MAX_BAND_QUADS) {
        // along the foot of the walls, outward
        const made = bandOf(col);
        const fit = Math.min(made.length / 12, MAX_BAND_QUADS - quads);
        pos.set(made.subarray(0, fit * 12), quads * 12);
        for (let v = quads * 4; v < (quads + fit) * 4; v += 4) { shade[v] = 1; shade[v + 1] = 1; shade[v + 2] = 0; shade[v + 3] = 0; }
        quads += fit;
      }
    };
    const within = (col, px, pz) => {
      const mx = (col.minX + col.maxX) / 2, mz = (col.minZ + col.maxZ) / 2;
      return (mx - px) ** 2 + (mz - pz) ** 2 <= r2;
    };
    if (near) {
      for (const col of near(x, z, REACH)) if (within(col, x, z)) visit(col);
      if (Number.isFinite(x2)) for (const col of near(x2, z2, REACH)) if (within(col, x2, z2) && !within(col, x, z)) visit(col);
    } else {
      for (const col of colliders) if (within(col, x, z) || within(col, x2, z2)) visit(col);
    }
    still = n;
    laid = true;
    cars.count = c;
    if (c) {
      cars.instanceMatrix.clearUpdateRanges();
      cars.instanceMatrix.addUpdateRange(0, c * 16);
      cars.instanceMatrix.needsUpdate = true;
    }
    if (quads) {
      for (const attr of [bandGeo.attributes.position, bandGeo.attributes.shade]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, quads * 4 * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    bandGeo.setDrawRange(0, quads * 6);
    // which way round a band faces doesn't matter: drawn from both sides
    band.material.side = THREE.DoubleSide;
  }

  function update(camera, on, camera2 = null) {
    group.visible = on;
    if (!on) { cx = Infinity; return; }
    const { x, z } = camera.position;
    const x2 = camera2 ? camera2.position.x : Infinity, z2 = camera2 ? camera2.position.z : Infinity;
    const moved = (x - cx) ** 2 + (z - cz) ** 2 > REFRESH * REFRESH
      || (camera2 ? !((x2 - c2x) ** 2 + (z2 - c2z) ** 2 <= REFRESH * REFRESH) : c2x !== Infinity);
    if (moved || Math.abs(colliders.length - seenLength) > 20) layOut(x, z, x2, z2);
    // the people, where they are now
    let n = still;
    if (peds) for (const pd of peds) {
      if (!pd.placed || n >= MAX_ROUND) continue;
      if ((pd.x - x) ** 2 + (pd.z - z) ** 2 > 70 * 70 && !((pd.x - x2) ** 2 + (pd.z - z2) ** 2 <= 70 * 70)) continue;
      blob(round, n++, pd.x, lift(pd.x, pd.z), pd.z, 0.9, 0.9, 0);
    }
    round.count = n;
    // uploaded: everything after a lay-out, else just the people (the still ones haven't moved)
    const from = laid ? 0 : still;
    if (n > from) {
      round.instanceMatrix.clearUpdateRanges();
      round.instanceMatrix.addUpdateRange(from * 16, (n - from) * 16);
      round.instanceMatrix.needsUpdate = true;
    }
    laid = false;
  }

  return { group, update, dispose() { plane.dispose(); bandGeo.dispose(); round.material.dispose(); cars.material.dispose(); band.material.dispose(); } };
}

export { createGroundShade };
