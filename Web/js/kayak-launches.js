// Kayaks pulled up on the Huron's banks at the parks where people put in (Argo, Bandemer, Island Park, Gallup, the
// Arb...): two or three to a spot, on the grass a step from the water, in a row along the shore. Walk up to one and get
// in (the same key as a car) and the player's kayak is put in the water there, facing downstream; the one taken leaves
// the bank until another is taken (or another boat is), and stays off it after a reload.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundHeight, groundTilt, nearestWater, riverDepth, waterLevel } from './terrain.js';
import { GEO } from './city-geodata.js';

// the parks the river runs through, each a put-in near its middle (snapped to the nearest open water)
const PUT_INS = ['Argo Park & Nature Area', 'Bandemer Park', 'Broadway Park West', 'Riverside Park', 'Island Park',
  'Fuller Park', 'Nichols Arboretum', 'Gallup Park', 'Furstenberg Nature Area', 'Barton Nature Area', 'Kuebler Langford Nature Area'];
const COLORS = [0xd9342b, 0xf2b705, 0x1f6fb2, 0x2f9e55, 0xee6a1f, 0x7a3fb0, 0x16a6a6];
const L = 1.85, B = 0.36;

function hullGeometry() {
  const shape = (geo, height) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.abs(pos.getZ(i)));
      pos.setXYZ(i, pos.getX(i) * B * (1 - 0.55 * t * t), pos.getY(i) * height * (1 - 0.25 * t * t) + 0.1 + 0.09 * t ** 3, pos.getZ(i) * L);
    }
    return geo;
  };
  const hull = shape(new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0.2);
  const deck = shape(new THREE.SphereGeometry(1, 20, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0.12);
  const g = mergeGeometries([hull, deck]);
  g.computeVertexNormals();
  return g;
}

// the bank beside open water at (wx, wz): the nearest dry ground, and the way from the water to it
function bankBeside(wx, wz) {
  for (let r = 2; r <= 60; r += 1) {
    let best = null;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, x = wx + Math.sin(a) * r, z = wz + Math.cos(a) * r;
      if (riverDepth(x, z) > 0) continue;
      // dry a little further on too, so it isn't an island of a sample
      if (riverDepth(x + Math.sin(a) * 2, z + Math.cos(a) * 2) > 0) continue;
      best = { x, z, ax: Math.sin(a), az: Math.cos(a) };
      break;
    }
    if (best) return best;
  }
  return null;
}

function buildKayakLaunches(group) {
  group.name = 'KayakLaunches';
  const sites = [];
  for (const name of PUT_INS) {
    const park = GEO.parks.find((p) => p.name === name);
    if (!park) continue;
    const ring = park.rings[0];
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
    cx /= ring.length / 2; cz /= ring.length / 2;
    const water = nearestWater(cx, cz, 700);
    if (!water || Math.hypot(water.x - cx, water.z - cz) > 650) continue;
    const bank = bankBeside(water.x, water.z);
    if (!bank) continue;
    if (sites.some((s) => Math.hypot(s.water.x - water.x, s.water.z - water.z) < 150)) continue;
    const n = 2 + (sites.length % 2);
    // in a row along the shore, a step up the bank, bows the same way
    const along = { x: -bank.az, z: bank.ax };
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 1.05;
      const x = bank.x + bank.ax * 1.6 + along.x * off, z = bank.z + bank.az * 1.6 + along.z * off;
      sites.push({ x, z, yaw: Math.atan2(along.x, along.z) + (k % 2 ? 0.08 : -0.06), water, color: COLORS[(sites.length + k * 3) % COLORS.length], name });
    }
  }

  // each put-in's kayaks their own pair of instanced meshes, hidden with it far off (scene-culling.js cullDistance)
  // rather than one pair across the whole river drawn from anywhere in town
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.0 });
  const cockpitMat = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.75 });
  const hullGeo = hullGeometry();
  const cockpitGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2).scale(0.23, 1, 0.37).translate(0, 0.226, -0.12);
  const bySite = new Map();
  for (const s of sites) {
    if (!bySite.has(s.name)) bySite.set(s.name, []);
    bySite.get(s.name).push(s);
  }
  const meshes = [];
  for (const list of bySite.values()) {
    const body = new THREE.InstancedMesh(hullGeo, mat, list.length);
    body.name = 'BeachedKayaks';
    const cockpit = new THREE.InstancedMesh(cockpitGeo, cockpitMat, list.length);
    for (const m of [body, cockpit]) m.userData.cullDistance = 450;
    list.forEach((s, j) => { s.body = body; s.cockpit = cockpit; s.slot = j; });
    meshes.push(body, cockpit);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Vector3(0, 0, 0), p = new THREE.Vector3(), color = new THREE.Color();
  const place = (i, shown) => {
    const s = sites[i];
    // lying with the bank's slope under it (front-higher pitch and right-higher roll, as three.js turns them)
    const [pitch, roll] = groundTilt(s.x, s.z, s.yaw, 3.4, 0.6);
    e.set(-pitch, s.yaw, -roll, 'YXZ');
    q.setFromEuler(e);
    p.set(s.x, groundHeight(s.x, s.z) - 0.04, s.z);
    m.compose(p, q, shown ? one : zero);
    s.body.setMatrixAt(s.slot, m);
    s.cockpit.setMatrixAt(s.slot, m);
    s.body.instanceMatrix.needsUpdate = s.cockpit.instanceMatrix.needsUpdate = true;
  };
  sites.forEach((s, i) => {
    place(i, true);
    s.body.setColorAt(s.slot, color.setHex(s.color));
  });
  for (const mesh of meshes) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  let taken = -1;
  return {
    count: sites.length,
    // the beached kayak within `reach` of (x, z), or null
    nearest(x, z, reach) {
      let best = null, bd = reach * reach;
      sites.forEach((s, i) => {
        if (i === taken) return;
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bd) { bd = d; best = { i, x: s.x, z: s.z, water: s.water, d: Math.sqrt(d), name: s.name }; }
      });
      return best;
    },
    // the one the player has (kept with the game's saves, so a reload leaves its spot empty), or -1
    get taken() { return taken; },
    // takes it off the bank (and puts back the one taken before), saying where to put the player's kayak in
    take(i) {
      const s = sites[i];
      if (!s) return null;
      if (taken >= 0) place(taken, true);
      taken = i;
      place(i, false);
      return { x: s.water.x, z: s.water.z, y: waterLevel(s.water.x, s.water.z) };
    },
    // another boat taken (or the game started over): the one taken goes back on its bank
    release() {
      if (taken < 0) return;
      place(taken, true);
      taken = -1;
    }
  };
}

export { buildKayakLaunches };
