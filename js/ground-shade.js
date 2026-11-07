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

function createGroundShade(group, { colliders, peds }) {
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
  bandGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  bandGeo.setAttribute('shade', new THREE.BufferAttribute(shade, 1).setUsage(THREE.DynamicDrawUsage));
  bandGeo.setIndex(new THREE.BufferAttribute(index, 1));
  bandGeo.setDrawRange(0, 0);
  const band = new THREE.Mesh(bandGeo, bandMaterial());
  band.frustumCulled = false; band.renderOrder = 996; band.name = 'GroundShade';
  group.add(band, round, cars);

  // a point's height on what's there: a block's sidewalk or lawn, else the street
  const lift = (x, z) => groundHeight(x, z) + (blockAt(x, z) ? 0.185 : 0.02);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let still = 0, cx = Infinity, cz = Infinity, c2x = Infinity, c2z = Infinity, seenLength = -1;

  function blob(mesh, i, x, y, z, w, l, yaw) {
    p.set(x, y, z); s.set(w, 1, l); q.setFromAxisAngle(up, yaw);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }

  // the still things and the buildings, near (x, z) and, in split screen, near the second view's (x2, z2)
  function layOut(x, z, x2, z2) {
    cx = x; cz = z; c2x = x2; c2z = z2; seenLength = colliders.length;
    let n = 0, c = 0, quads = 0;
    const r2 = REACH * REACH;
    for (const col of colliders) {
      const mx = (col.minX + col.maxX) / 2, mz = (col.minZ + col.maxZ) / 2;
      if ((mx - x) ** 2 + (mz - z) ** 2 > r2 && !((mx - x2) ** 2 + (mz - z2) ** 2 <= r2)) continue;
      const k = col.knock;
      if (k && !k.down) {
        let rad = SIZE[k.kind];
        if (k.kind === 'tree') rad = Math.min(3.4, Math.max(1.2, (k.height || 8) * 0.24));
        if (rad == null) rad = Math.min(0.9, Math.max(0.3, k.r || 0.4));
        if (n < MAX_ROUND) blob(round, n++, k.x, lift(k.x, k.z), k.z, rad * 2, (k.kind === 'bench' ? rad * 1.1 : rad * 2), k.yaw || 0);
      } else if (col.parked && col.obb) {
        const o = col.obb;
        if (c < MAX_CARS) blob(cars, c++, o.cx, groundHeight(o.cx, o.cz) + 0.03, o.cz, o.hx * 2 + 0.3, o.hz * 2 + 0.3, Math.atan2(o.sn, o.cs));
      } else if (col.polygon?.outer && col.maxX - col.minX < 300 && col.maxZ - col.minZ < 300) {
        // along the foot of the walls, outward
        const pts = col.polygon.outer, len = pts.length;
        let area = 0;
        for (let i = 0, j = len - 1; i < len; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
        const out = area > 0 ? -1 : 1;
        for (let i = 0, j = len - 1; i < len && quads < MAX_BAND_QUADS; j = i++) {
          const a = pts[j], b = pts[i], ex = b.x - a.x, ez = b.z - a.z, l = Math.hypot(ex, ez);
          if (l < 0.3) continue;
          const nx = (ez / l) * out * BAND, nz = (-ex / l) * out * BAND;
          const v = quads * 4, o = v * 3;
          const ya = lift(a.x + nx * 0.1, a.z + nz * 0.1), yb = lift(b.x + nx * 0.1, b.z + nz * 0.1);
          pos[o] = a.x; pos[o + 1] = ya; pos[o + 2] = a.z;
          pos[o + 3] = b.x; pos[o + 4] = yb; pos[o + 5] = b.z;
          pos[o + 6] = a.x + nx; pos[o + 7] = ya; pos[o + 8] = a.z + nz;
          pos[o + 9] = b.x + nx; pos[o + 10] = yb; pos[o + 11] = b.z + nz;
          shade[v] = 1; shade[v + 1] = 1; shade[v + 2] = 0; shade[v + 3] = 0;
          quads++;
        }
      }
    }
    still = n;
    cars.count = c;
    cars.instanceMatrix.needsUpdate = true;
    bandGeo.attributes.position.needsUpdate = true;
    bandGeo.attributes.shade.needsUpdate = true;
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
    round.instanceMatrix.needsUpdate = true;
  }

  return { group, update, dispose() { plane.dispose(); bandGeo.dispose(); round.material.dispose(); cars.material.dispose(); band.material.dispose(); } };
}

export { createGroundShade };
