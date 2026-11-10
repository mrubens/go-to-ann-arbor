// The still meshes of a part that share a material, merged into one mesh per square of the city: each draw costs the
// renderer far more here than its triangles do, and a landmark built of a few hundred small pieces is a few hundred
// draws. Only plain meshes are merged (no copies, bones or morphs, one material, nothing under them); what each keeps
// of its own (shadows, draw order, layers, a distance it's hidden beyond) goes into which merge it joins.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const sphere = new THREE.Sphere();
const toRoot = new THREE.Matrix4();

function mergeable(o) {
  return o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh && !o.children.length &&
    o.material && !Array.isArray(o.material) && o.geometry?.attributes.position &&
    !Object.keys(o.geometry.morphAttributes).length && !o.onBeforeRender?.length &&
    !(o.geometry.drawRange.count < Infinity && o.geometry.drawRange.count !== (o.geometry.index ?? o.geometry.attributes.position).count);
}

function signature(geo) {
  return Object.entries(geo.attributes).map(([k, a]) => `${k}${a.itemSize}${a.normalized ? 'n' : ''}${a.array.constructor.name}`)
    .sort().join(',') + (geo.index ? ':i' : ':p');
}

// A mesh of loose triangles spread over the town (several landmarks built as one), cut into one mesh per square of
// `cell` m by where each triangle is, so each can be culled and hidden by its distance on its own
export function splitByCell(mesh, cell = 300) {
  const geo = mesh.geometry;
  if (geo.index) return [mesh];
  const names = Object.keys(geo.attributes), pos = geo.attributes.position.array;
  const buckets = new Map();
  for (let t = 0; t < pos.length / 9; t++) {
    const o = t * 9, x = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, z = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
    const key = Math.floor(x / cell) * 100000 + Math.floor(z / cell);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  if (buckets.size < 2) return [mesh];
  const out = [];
  for (const tris of buckets.values()) {
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const a = geo.attributes[n], k = a.itemSize * 3, arr = new a.array.constructor(tris.length * k);
      tris.forEach((t, i) => arr.set(a.array.subarray(t * k, t * k + k), i * k));
      g.setAttribute(n, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.name = mesh.name; m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow;
    m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
    out.push(m);
  }
  const parent = mesh.parent;
  if (parent) { mesh.removeFromParent(); parent.add(...out); }
  geo.dispose();
  return out;
}

// a plain material's look, for pieces made each with their own copy of the same one (no shader nodes of its own)
const LOOK = ['type', 'transparent', 'opacity', 'depthWrite', 'depthTest', 'side', 'vertexColors', 'flatShading', 'alphaTest',
  'roughness', 'metalness', 'emissiveIntensity', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'fog', 'toneMapped'];
function lookOf(mat) {
  for (const k in mat) if (k.endsWith('Node') && mat[k]) return null;
  const maps = ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap', 'aoMap'].map((k) => mat[k]?.uuid || '');
  return [...LOOK.map((k) => mat[k]), mat.color?.getHexString(), mat.emissive?.getHexString(), ...maps].join('|');
}

// `share`: pieces whose materials look the same take one of them first, so they merge too (the Xbox: device-tier.js)
export function mergeStatic(root, cell = 400, { share = false } = {}) {
  root.updateMatrixWorld(true);
  if (share) {
    const looks = new Map();
    root.traverse((o) => {
      if (!mergeable(o)) return;
      const look = lookOf(o.material);
      if (look === null) return;
      if (!looks.has(look)) looks.set(look, o.material);
      else if (looks.get(look) !== o.material) { o.material.dispose(); o.material = looks.get(look); }
    });
  }
  const rootInverse = root.matrixWorld.clone().invert();
  const buckets = new Map();
  root.traverse((o) => {
    // (a mirrored piece would turn inside out once its mirroring is baked in)
    if (!mergeable(o) || o.matrixWorld.determinant() < 0) return;
    const geo = o.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    sphere.copy(geo.boundingSphere).applyMatrix4(o.matrixWorld);
    const key = [o.material.uuid, signature(geo), o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask, o.frustumCulled,
      o.userData.cullDistance || 0, Math.floor(sphere.center.x / cell), Math.floor(sphere.center.z / cell)].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });
  let before = 0, after = 0;
  for (const list of buckets.values()) {
    before += list.length;
    if (list.length < 2) { after++; continue; }
    const geos = list.map((o) => {
      const g = o.geometry.clone();
      g.applyMatrix4(toRoot.multiplyMatrices(rootInverse, o.matrixWorld));
      g.clearGroups(); // a box's or cylinder's groups mean nothing under one material: the whole geometry is drawn
      return g;
    });
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) { after += list.length; continue; }
    merged.computeBoundingSphere();
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = first.name;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.frustumCulled = first.frustumCulled;
    if (first.userData.cullDistance) mesh.userData.cullDistance = first.userData.cullDistance;
    // (their geometries are let go with them, unless another piece still shares one)
    for (const o of list) o.removeFromParent();
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    after++;
  }
  return { before, after };
}
