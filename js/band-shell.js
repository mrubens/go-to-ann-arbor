import * as THREE from 'three/webgpu';
import { positionWorld, uv, mix, smoothstep, fract, min, float, vec3, mx_noise_float } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';

// Lamp: the West Park Band Shell, on OpenStreetMap's outline of it (way 193803223), facing north across the lawn to
// the park's curved grandstand. Five concrete arches telescope back from the open front, each a step smaller than the
// one before it, closed at the back by a half-round wall and a low backstage block behind; a raised concrete stage fills
// the outline out to its curved apron, with steps up its middle. The map says it has been closed since 2021 for
// structural problems and fenced in all round, so a ring of temporary chain-link panels on their feet stands around it,
// and that's what's walked and driven into (`colliders`); the survey's plain block there is left out (`replaces`).

// the outline's straight back wall, east end to west end (metres, the game's frame), from the map
const BACK_E = [-730.6, -481.93], BACK_W = [-745.85, -489.9];
const OUTLINE = [[-724.62, -490.36], [-725.04, -489.55], [-726.12, -487.39], [-727.52, -488.05], [-730.6, -481.93],
  [-745.85, -489.9], [-742.79, -495.91], [-743.93, -496.56], [-742.34, -499.72], [-739.03, -498.17], [-735.95, -498.09],
  [-732.6, -497.02], [-729.61, -494.82], [-728.2, -492.3]];
const ARCHES = 5, W0 = 8.0, H0 = 7.4, DW = 0.78, DH = 0.68, DEPTH = 1.45, T = 0.3, FRONT = 9.0;
const STAGE = 1.1, SEG = 40;

// a surface over (i, j) in [0, 1]², `f(i, j)` its point, its normals its own
function sheet(f, ni, nj) {
  const pos = [], idx = [];
  for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) pos.push(...f(i / ni, j / nj));
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const a = j * (ni + 1) + i, b = a + 1, c = a + ni + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
function tint(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function buildBandShell(group) {
  group.name = 'BandShell';
  // its frame: x across the stage (west to east as seen from the lawn), z out from the back wall toward the lawn
  const dx = BACK_W[0] - BACK_E[0], dz = BACK_W[1] - BACK_E[1], L = Math.hypot(dx, dz);
  const ax = dx / L, az = dz / L, nx = -az, nz = ax; // out of the shell, toward the lawn
  const ox = (BACK_E[0] + BACK_W[0]) / 2, oz = (BACK_E[1] + BACK_W[1]) / 2;
  const W = (x, z) => [ox + ax * x + nx * z, oz + az * x + nz * z];
  const local = (x, z) => [(x - ox) * ax + (z - oz) * az, (x - ox) * nx + (z - oz) * nz];
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(ax, 0, az), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(ox, 0, oz);
  let g = -Infinity, gLow = Infinity;
  for (const [x, z] of OUTLINE) { const h = groundHeight(x, z); g = Math.max(g, h); gLow = Math.min(gLow, h); }
  const base = gLow - 0.4;

  const shell = [], stage = [], fence = [], mesh = [];
  const arch = (w, h, z) => (t) => [Math.cos(Math.PI * t) * w, g + Math.sin(Math.PI * t) * h, z];
  // the arches, the biggest at the front, each a thick band with a face at its front reaching out to the one before
  for (let k = 0; k < ARCHES; k++) {
    const w = W0 - k * DW, h = H0 - k * DH, z1 = FRONT - k * DEPTH, z0 = z1 - DEPTH;
    const prevW = k ? W0 - (k - 1) * DW + T : w + T, prevH = k ? H0 - (k - 1) * DH + T : h + T;
    const shade = [0xf1ede3, 0xeae5da, 0xf1ede3, 0xe6e0d4, 0xeee9de][k];
    shell.push(tint(sheet((i, j) => { const p = arch(w, h, z0 + (z1 - z0) * j)(i); return p; }, SEG, 3), shade));
    shell.push(tint(sheet((i, j) => arch(w + T, h + T, z0 + (z1 - z0) * j)(i), SEG, 3), 0xe2ddd2));
    shell.push(tint(sheet((i, j) => { const a = arch(w, h, z1)(i), b = arch(prevW, prevH, z1)(i); return [a[0] + (b[0] - a[0]) * j, a[1] + (b[1] - a[1]) * j, z1]; }, SEG, 1), 0xf6f3ec));
    // the arch's feet, down to below the ground
    for (const s of [-1, 1]) shell.push(tint(flat(new THREE.BoxGeometry(T + 0.06, g - base, DEPTH).translate(s * (w + T / 2), (g + base) / 2, (z0 + z1) / 2)), 0xd8d2c5));
  }
  // the half-round wall closing the back, and the backstage block behind it
  const wb = W0 - (ARCHES - 1) * DW, hb = H0 - (ARCHES - 1) * DH, zb = FRONT - ARCHES * DEPTH;
  shell.push(tint(sheet((i, j) => { const p = arch(wb + T, hb + T, zb)(i); return [p[0] * j, g + (p[1] - g) * j, zb]; }, SEG, 4), 0xe9e4d8));
  shell.push(tint(flat(new THREE.BoxGeometry(2 * (wb + T) + 1.2, 4.4 - (base - g), zb + 0.2).translate(0, (base + g + 4.4) / 2, (zb + 0.2) / 2 - 0.2)), 0xcfc8ba));
  shell.push(tint(flat(new THREE.BoxGeometry(2 * (wb + T) + 1.5, 0.18, zb + 0.5).translate(0, g + 4.49, (zb + 0.2) / 2 - 0.3)), 0xb9b2a5));
  // a door in each end of the backstage block
  for (const s of [-1, 1]) shell.push(tint(flat(new THREE.BoxGeometry(0.05, 2.1, 0.95).translate(s * ((wb + T) + 0.62), g + 1.05, zb * 0.45)), 0x4f5a5e));

  // the stage: the outline raised, its edge capped, and steps up the middle of the apron
  const shape = new THREE.Shape();
  OUTLINE.forEach(([x, z], i) => { const [u, v] = local(x, z); (i ? shape.lineTo(u, -v) : shape.moveTo(u, -v)); });
  shape.closePath();
  const deck = new THREE.ExtrudeGeometry(shape, { depth: g + STAGE - base, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, base, 0);
  stage.push(tint(flat(deck), 0xb3ada2));
  let apron = 0;
  for (const [x, z] of OUTLINE) { const [u, v] = local(x, z); if (Math.abs(u) < 2) apron = Math.max(apron, v); }
  const steps = 4, rise = STAGE / steps;
  for (let k = 0; k < steps; k++) stage.push(tint(flat(new THREE.BoxGeometry(3.2, g + rise * (k + 1) - base, 0.34).translate(0, (base + g + rise * (k + 1)) / 2, apron + 0.34 * (steps - k) - 0.17)), 0xaaa498));
  for (const s of [-1, 1]) stage.push(tint(flat(new THREE.BoxGeometry(0.28, g + STAGE + 0.25 - base, 0.34 * steps + 0.1).translate(s * 1.74, (base + g + STAGE + 0.25) / 2, apron + 0.17 * steps)), 0xbdb7ac));

  // the fence: temporary chain-link panels on concrete feet, a box round the outline a few metres out
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of OUTLINE) { const [u, v] = local(x, z); x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v); }
  x0 = Math.min(x0, -W0 - T) - 3; x1 = Math.max(x1, W0 + T) + 3; z0 -= 3; z1 += 0.34 * steps + 3.5;
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], PANEL = 3.5, FH = 1.85;
  const colliders = [];
  for (let e = 0; e < 4; e++) {
    const [pa, pb] = [corners[e], corners[(e + 1) % 4]], len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const n = Math.max(1, Math.round(len / PANEL)), tx = (pb[0] - pa[0]) / len, tz = (pb[1] - pa[1]) / len, yaw = Math.atan2(-tz, tx);
    for (let k = 0; k < n; k++) {
      const s0 = (k / n) * len, s1 = ((k + 1) / n) * len, sm = (s0 + s1) / 2, pw = s1 - s0;
      const cx = pa[0] + tx * sm, cz = pa[1] + tz * sm;
      const [wx, wz] = W(cx, cz), gy = groundHeight(wx, wz);
      // the mesh, its frame of tubes, and a foot under each end
      mesh.push(new THREE.PlaneGeometry(pw - 0.1, FH - 0.12).rotateY(yaw).translate(cx, gy + 0.12 + FH / 2, cz));
      for (const s of [-1, 1]) {
        const px = cx + tx * s * (pw / 2 - 0.04), pz = cz + tz * s * (pw / 2 - 0.04);
        fence.push(tint(flat(new THREE.CylinderGeometry(0.022, 0.022, FH, 6).translate(px, gy + 0.12 + FH / 2, pz)), 0x9aa0a4));
        fence.push(tint(flat(new THREE.BoxGeometry(0.6, 0.12, 0.22).rotateY(yaw + Math.PI / 2).translate(px, gy + 0.06, pz)), 0x8a8a86));
      }
      for (const y of [0.15, FH + 0.09]) fence.push(tint(flat(new THREE.CylinderGeometry(0.018, 0.018, pw - 0.08, 6).rotateZ(Math.PI / 2).rotateY(yaw).translate(cx, gy + y, cz)), 0x9aa0a4));
    }
    // its collider, along the side in the world
    const [wa, wza] = W(...pa), [wb2, wzb] = W(...pb), mx = (wa + wb2) / 2, mz = (wza + wzb) / 2;
    const ux = (wb2 - wa) / len, uz = (wzb - wza) / len, hx = len / 2, hz = 0.15;
    const ex = Math.abs(ux) * hx + Math.abs(uz) * hz, ez = Math.abs(uz) * hx + Math.abs(ux) * hz;
    colliders.push({ minX: mx - ex, maxX: mx + ex, minZ: mz - ez, maxZ: mz + ez, minY: base, maxY: g + FH + 0.3,
      obb: { cx: mx, cz: mz, hx, hz, cs: ux, sn: -uz }, thin: true, keepsSurvey: true });
  }
  // the shell itself, for anything that comes over the fence
  {
    const zc = (FRONT + 0) / 2, [cx, cz] = W(0, zc), hx = W0 + T + 0.2, hz = FRONT / 2;
    const ex = Math.abs(ax) * hx + Math.abs(nx) * hz, ez = Math.abs(az) * hx + Math.abs(nz) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: base, maxY: g + H0 + T,
      obb: { cx, cz, hx, hz, cs: ax, sn: -az }, keepsSurvey: true });
  }
  // the survey's block it stands in
  const ring = { outer: OUTLINE.map(([x, z]) => ({ x, z })), holes: [] };
  const replaced = REAL_BUILDINGS.find((b) => {
    const r = b.polygons[0]?.outer;
    if (!r?.length || b.maxX < -747 || b.minX > -723 || b.maxZ < -501 || b.minZ > -480) return false;
    let x = 0, z = 0;
    for (const p of r) { x += p.x; z += p.z; }
    return polygonContains(ring, x / r.length, z / r.length);
  });
  if (replaced) colliders[colliders.length - 1].replaces = replaced;

  // painted concrete, weathered: streaks down the shell, grime low down and in the steps between the arches
  const concrete = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide });
  const grain = mx_noise_float(positionWorld.mul(vec3(1.6, 0.35, 1.6))).mul(0.5).add(0.5);
  const blot = mx_noise_float(positionWorld.mul(0.45)).mul(0.5).add(0.5);
  const low = smoothstep(float(g + 1.6), float(g), positionWorld.y);
  concrete.colorNode = vec3(1).mul(mix(1.0, 0.82, grain.mul(0.35).add(blot.mul(0.3)))).mul(mix(1.0, 0.78, low));
  const shellMesh = new THREE.Mesh(mergeGeometries([...shell, ...stage]), concrete);
  shellMesh.applyMatrix4(frame);
  shellMesh.name = 'West Park Band Shell';
  shellMesh.castShadow = shellMesh.receiveShadow = true;
  group.add(shellMesh);
  const steel = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 });
  const frameMesh = new THREE.Mesh(mergeGeometries(fence), steel);
  frameMesh.applyMatrix4(frame);
  frameMesh.castShadow = true;
  frameMesh.userData.cullDistance = 260;
  group.add(frameMesh);
  // the chain link: a diamond mesh of wire, the gaps cut away
  const link = new THREE.MeshStandardNodeMaterial({ color: 0xa3a9ad, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide, alphaTest: 0.5 });
  // (each panel's uv across its 3.5 m and up its 1.7 m, a diamond about 6 cm)
  const a = fract(uv().x.mul(58).add(uv().y.mul(29))), b = fract(uv().x.mul(58).sub(uv().y.mul(29)));
  link.opacityNode = smoothstep(0.16, 0.09, min(min(a, a.oneMinus()), min(b, b.oneMinus())));
  const meshGeo = mergeGeometries(mesh.map((m) => m.toNonIndexed()));
  const linkMesh = new THREE.Mesh(meshGeo, link);
  linkMesh.applyMatrix4(frame);
  linkMesh.userData.cullDistance = 200;
  group.add(linkMesh);

  log(`[band shell] West Park Band Shell, ${ARCHES} arches, fenced in${replaced ? ', in place of the survey block' : ''}`);
  return { colliders, footprint: { minX: Math.min(...colliders.map((c) => c.minX)), maxX: Math.max(...colliders.map((c) => c.maxX)),
    minZ: Math.min(...colliders.map((c) => c.minZ)), maxZ: Math.max(...colliders.map((c) => c.maxZ)), pedestrianOnly: true } };
}

export { buildBandShell };
