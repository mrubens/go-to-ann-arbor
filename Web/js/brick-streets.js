// Lamp: Ann Arbor's brick streets (Detroit St and N Fourth and Fifth Aves by Kerrytown, Kingsley, First, Carey and
// the few others OpenStreetMap tags paving_stones, sett or bricks: brick-streets-data.js), their roadways paved in
// worn red street brick over the asphalt the city's road layer lays there, curb to curb at the game's own width of
// each (GEO.roads), and laid on the ground as the B2B trail's tread is (terrain.js tessellate, drawOver).
import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { BRICK_STREETS } from './brick-streets-data.js';
import { tessellate, groundUnderStreets, drawOver } from './terrain.js';

const TILE = 1.2; // metres a texture tile covers: six bricks across, twelve courses
const REACH = 420; // drawn out to this far (scene-culling.js)

// Running-bond street brick, the bricks laid across the street: red to brown, worn rounded edges, sandy joints, the
// odd darker or patched brick
function brickTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#7b6f62';
  g.fillRect(0, 0, S, S);
  const bw = S / 6, bh = S / 12;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < 12; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let k = -1; k < 7; k++) {
      const x = k * bw + off, y = row * bh;
      const r = rnd();
      const base = r < 0.08 ? [92, 54, 42] : r < 0.16 ? [148, 92, 70] : [120 + rnd() * 22, 62 + rnd() * 14, 46 + rnd() * 10];
      g.fillStyle = `rgb(${base.map((v) => Math.round(v)).join(',')})`;
      g.beginPath();
      g.roundRect(x + 2.5, y + 2.5, bw - 5, bh - 5, 5);
      g.fill();
      // a worn, lighter face
      g.fillStyle = `rgba(200,170,140,${0.06 + rnd() * 0.1})`;
      g.fillRect(x + 6, y + 5, bw - 14, bh * 0.35);
    }
  }
  // grime and tyre wear: soft dark blotches
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(30,25,20,${0.04 + rnd() * 0.06})`;
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 8 + rnd() * 40, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// the game's width of the street nearest a point (GEO.roads: [name, width, ..., [x, z, ...]])
function widthAt(x, z, name) {
  let best = null;
  for (const r of GEO.roads || []) {
    const p = r[5];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz) - (r[0] === name ? 2 : 0);
      if (!best || d < best.d) best = { d, w: r[1] };
    }
  }
  return best && best.d < 10 ? best.w : 9;
}

function buildBrickStreets(group) {
  group.name = 'BrickStreets';
  const pos = [], uv = [], index = [];
  for (const [name, ...flat] of BRICK_STREETS) {
    const n = flat.length / 2;
    if (n < 2) continue;
    const mid = Math.floor(n / 2) * 2;
    const half = widthAt(flat[mid], flat[mid + 1], name) / 2;
    let along = 0;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = flat[i * 2], z = flat[i * 2 + 1];
      // the mitred normal at the joint
      const px = flat[Math.max(0, i - 1) * 2], pz = flat[Math.max(0, i - 1) * 2 + 1];
      const qx = flat[Math.min(n - 1, i + 1) * 2], qz = flat[Math.min(n - 1, i + 1) * 2 + 1];
      let tx = qx - px, tz = qz - pz;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      if (i > 0) along += Math.hypot(x - px, z - pz);
      for (const side of [-1, 1]) {
        pos.push(x - tz * half * side, 0, z + tx * half * side);
        uv.push((side * half) / TILE, along / TILE);
      }
      if (i > 0) {
        const a = base + (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
        index.push(a, b, c, b, d, c); // (facing up)
      }
    }
  }
  if (!pos.length) return group;
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo = geo.toNonIndexed();
  // laid on the ground where it bends, on the ground under a street's bridge where one passes over
  geo = tessellate(geo, 0.04);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundUnderStreets(p.getX(i), p.getZ(i)));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.computeBoundingSphere();
  // drawn in front of the asphalt it covers, as if 12 cm over it: the road layer follows the city's coarser cut of
  // the ground (terrain.js, within ~10 cm of the survey), this the survey itself (the few crosswalks on brick go under)
  const mat = drawOver(new THREE.MeshStandardNodeMaterial({ map: brickTexture(), roughness: 0.86 }), 0.12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'BrickStreetPaving';
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = REACH;
  mesh.userData.terrain = 'set';
  group.add(mesh);
  group.userData.terrain = 'set';
  return group;
}

export { buildBrickStreets };
