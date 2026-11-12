import * as THREE from 'three/webgpu';
import { log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { ROUNDABOUTS } from './roundabout-data.js';

// Lamp: Ann Arbor's roundabouts (roundabout-data.js, from OpenStreetMap's rings: Earhart Rd's three, Geddes Rd's,
// N Maple's, Nixon's...). Each gets its central island: a raised, curbed disc of lawn inside a truck apron of red
// pavers a few centimetres over the road, which a bus or a truck may run its back wheels over, the island itself solid.
// road-network.js sends the traffic round it (counterclockwise, keeping right). Two draws for all of them.

// the island's outer edge (the apron's) from the ring's nearest centre-line radius, and its curb's
const islandOf = (r) => {
  const apron = Math.max(2.2, r - 2.6);
  return { apron, curb: Math.max(1.2, apron - 1.6) };
};

function buildRoundabouts(group) {
  const pos = [], col = [], idx = [], colliders = [];
  const SEG = 32;
  // (linear colours: the sRGB pavers', granite's and lawn's)
  const lin = (c) => c.map((v) => v ** 2.2);
  const APRON = lin([0.5, 0.3, 0.24]), CURB = lin([0.7, 0.69, 0.66]), GRASS = lin([0.33, 0.45, 0.2]), GRASS_TOP = lin([0.36, 0.5, 0.22]);
  // a ring from radius a to b at height y over the ground under each point (a = 0: a disc), and an upright band at
  // radius r from y0 to y1 over it, so an island on a slope follows the road round it
  const gy = (x, z) => groundHeight(x, z);
  const ring = (cx, cz, a, b, y, c) => {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2, s = Math.sin(t), k = Math.cos(t);
      const xa = cx + k * a, za = cz + s * a, xb = cx + k * b, zb = cz + s * b;
      pos.push(xa, gy(xa, za) + y, za, xb, gy(xb, zb) + y, zb);
      col.push(...c, ...c);
    }
    for (let i = 0; i < SEG; i++) { const p = base + i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  };
  const band = (cx, cz, r, y0, y1, c) => {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = (i / SEG) * Math.PI * 2, s = Math.sin(t), k = Math.cos(t);
      const x = cx + k * r, z = cz + s * r, g = gy(x, z);
      pos.push(x, g + y0, z, x, g + y1, z);
      col.push(...c, ...c);
    }
    for (let i = 0; i < SEG; i++) { const p = base + i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  };
  let n = 0;
  for (let i = 0; i < ROUNDABOUTS.length; i += 3) {
    const cx = ROUNDABOUTS[i], cz = ROUNDABOUTS[i + 1], r = ROUNDABOUTS[i + 2];
    const { apron, curb } = islandOf(r);
    // the apron: pavers 10 cm over the road, a low edge round it; the curb 24 cm; the lawn mounded a little to the middle
    band(cx, cz, apron, -0.3, 0.1, APRON);
    ring(cx, cz, curb, apron, 0.1, APRON);
    band(cx, cz, curb, -0.3, 0.24, CURB);
    ring(cx, cz, curb - 0.18, curb, 0.24, CURB);
    ring(cx, cz, curb * 0.45, curb - 0.18, 0.24, GRASS);
    ring(cx, cz, 0, curb * 0.45, 0.4, GRASS_TOP);
    band(cx, cz, curb * 0.45, 0.24, 0.4, GRASS);
    let g = Infinity;
    for (let k = 0; k < 8; k++) { const t = (k / 8) * Math.PI * 2; g = Math.min(g, groundHeight(cx + Math.cos(t) * curb, cz + Math.sin(t) * curb)); }
    // solid: the curbed island (the apron is drivable)
    const outer = [];
    for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2; outer.push({ x: cx + Math.cos(t) * curb, z: cz + Math.sin(t) * curb }); }
    colliders.push({ minX: cx - curb, maxX: cx + curb, minZ: cz - curb, maxZ: cz + curb, minY: g - 1, maxY: g + 0.9, polygon: { outer, holes: [] } });
    n++;
  }
  if (n) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.name = 'Roundabout islands';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  log(`[roundabouts] ${n} central islands`);
  return { colliders, count: n };
}

export { buildRoundabouts, islandOf };
