// Lamp: Ann Arbor's brick streets (Detroit St and N Fourth and Fifth Aves by Kerrytown, Kingsley, First, Carey and
// the few others OpenStreetMap tags paving_stones, sett or bricks) and its concrete ones (stretches of State, Ann
// Arbor-Saline, Jackson, Maple, Ellsworth, Huron Pkwy and more, OSM surface=concrete; brick-streets-data.js): their
// roadways paved over the asphalt the city's road layer lays there, curb to curb at the game's own width of each
// (GEO.roads), 3 mm over it and cut along the same triangles of the ground (main.js setOnTerrain), so the road's
// paint, 5 mm up, still lies on top.
import * as THREE from 'three/webgpu';
import { GEO } from './city-geodata.js';
import { BRICK_STREETS, CONCRETE_STREETS } from './brick-streets-data.js';

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

// Concrete roadway in slabs a lane wide and 4.5 m long: pale, weathered gray, a sawn and sealed joint at each slab's
// edges, a few hairline cracks and darker tyre tracks
function concreteTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#a3a19b';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = 140 + rnd() * 40;
    g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.25)`;
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(60,58,54,${0.03 + rnd() * 0.05})`;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, 10 + rnd() * 60, 0, Math.PI * 2); g.fill();
  }
  // tyre tracks down each slab, a third and two thirds across
  for (const u of [0.3, 0.7]) {
    const grd = g.createLinearGradient(S * (u - 0.08), 0, S * (u + 0.08), 0);
    grd.addColorStop(0, 'rgba(70,68,64,0)'); grd.addColorStop(0.5, 'rgba(70,68,64,0.12)'); grd.addColorStop(1, 'rgba(70,68,64,0)');
    g.fillStyle = grd; g.fillRect(S * (u - 0.08), 0, S * 0.16, S);
  }
  // the joints, sealed dark, at the slab's edges
  g.fillStyle = 'rgba(45,44,42,0.85)';
  g.fillRect(0, 0, S, 4); g.fillRect(0, 0, 3, S);
  // a hairline crack or two
  g.strokeStyle = 'rgba(55,54,50,0.6)'; g.lineWidth = 1.5;
  for (let k = 0; k < 2; k++) {
    g.beginPath(); let x = rnd() * S, y = rnd() * S; g.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (rnd() - 0.5) * 60; y += 20 + rnd() * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const LIFT_UP = 0.003; // over the road layer, under its paint (ground-lifts.js: paint 5 mm)

// one flat mesh of ribbons along the given ways, a texture tile tileU across and tileV along
function paving(ways, tex, tileU, tileV, name) {
  const pos = [], uv = [], index = [];
  for (const [street, ...flat] of ways) {
    const n = flat.length / 2;
    if (n < 2) continue;
    const mid = Math.floor(n / 2) * 2;
    const half = widthAt(flat[mid], flat[mid + 1], street) / 2;
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
        pos.push(x - tz * half * side, LIFT_UP, z + tx * half * side);
        uv.push((side * half) / tileU, along / tileV);
      }
      if (i > 0) {
        const a = base + (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
        index.push(a, b, c, b, d, c); // (facing up)
      }
    }
  }
  if (!pos.length) return null;
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo = geo.toNonIndexed();
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.computeBoundingSphere();
  // (pulled a little forward of the road it lies on; the paint is pulled further, so it stays on top)
  const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = REACH;
  return mesh;
}

// The paving's meshes, flat at street level: main.js cuts them onto the ground (setOnTerrain) as the road is cut
function buildBrickStreets(group) {
  group.name = 'BrickStreets';
  const brick = paving(BRICK_STREETS, brickTexture(), 1.2, 1.2, 'BrickStreetPaving');
  const concrete = paving(CONCRETE_STREETS, concreteTexture(), 3.6, 4.5, 'ConcreteStreetPaving');
  for (const m of [brick, concrete]) if (m) group.add(m);
  return { brick: BRICK_STREETS.length, concrete: CONCRETE_STREETS.length };
}

export { buildBrickStreets };
