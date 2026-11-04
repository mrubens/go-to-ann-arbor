// js/graffiti-alley.js — Graffiti Alley: the narrow passage off E Liberty beside the Michigan Theater's west wall, back
// to the Liberty Square parking structure, painted over every surface (both walls, the end wall and the pavement) in
// layer on layer of spray paint: bubble letters, tags, drips, hearts and stars.
// The survey draws the passage as a tongue of the parking structure, so the structure is cut back to its own face.
import * as THREE from 'three/webgpu';
import { Fn, smoothstep, mix, float, texture } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';

// the alley, between the shops' east wall (x 483.5) and the theater's west wall (x 490.5–491), Liberty's sidewalk to
// the parking structure's face
const BACK_Z = 1.2;
const WEST = [[483.5, 1.4], [483.5, 14], [486.5, 18]];
const EAST = [[491, 2.5], [490.5, 18.5]];

const COLORS = ['#e8322b', '#f7c51e', '#1fa4e0', '#2fbf5a', '#f06bb4', '#8a4fe0', '#ff8a1f', '#ffffff', '#111111',
  '#13c2b4', '#d9f03a', '#ff4f7b', '#3858e8', '#7a2a1c'];
const WORDS = ['A2', 'GO BLUE', 'LOVE', 'PEACE', 'ART', 'HELLO', 'DREAM', 'YES', '734', 'WOW', 'HURON', 'SPRAY', 'BE KIND',
  'ZAP', 'FUNK', 'JOY', 'SKY', 'HI MOM', 'ARBOR', 'OK'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// layer on layer of paint over old brick (or the pavement)
function paintTexture(w, h, seed, floor) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d'), R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)];
  x.fillStyle = floor ? '#3a3836' : '#6b3a2c';
  x.fillRect(0, 0, w, h);
  if (!floor) {
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < h; y += 18) x.fillRect(0, y, w, 2);
  }
  const blob = () => {
    const cx = R() * w, cy = R() * h, r = 30 + R() * (floor ? 160 : 220);
    const gr = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    const col = pick(COLORS);
    gr.addColorStop(0, col); gr.addColorStop(0.7, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr;
    x.beginPath(); x.ellipse(cx, cy, r, r * (0.5 + R() * 0.6), R() * 3, 0, Math.PI * 2); x.fill();
  };
  const drips = (cx, cy, col) => {
    x.strokeStyle = col; x.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      x.lineWidth = 2 + R() * 4;
      const dx = cx + (R() - 0.5) * 120;
      x.beginPath(); x.moveTo(dx, cy); x.lineTo(dx, cy + 20 + R() * 90); x.stroke();
    }
  };
  const letters = () => {
    const word = pick(WORDS), size = 60 + R() * (floor ? 120 : 180);
    const cx = R() * w, cy = size * 0.6 + R() * (h - size * 0.6);
    x.save();
    x.translate(cx, cy); x.rotate((R() - 0.5) * 0.5);
    x.font = `900 ${Math.round(size)}px Impact, Arial Black, sans-serif`;
    x.textAlign = 'center'; x.lineJoin = 'round';
    const fill = pick(COLORS);
    x.lineWidth = size * 0.22; x.strokeStyle = '#111';
    x.strokeText(word, 0, 0);
    x.lineWidth = size * 0.1; x.strokeStyle = pick(COLORS);
    x.strokeText(word, 0, 0);
    x.fillStyle = fill; x.fillText(word, 0, 0);
    x.restore();
    if (!floor && R() < 0.6) drips(cx, cy + size * 0.1, fill);
  };
  const tag = () => {
    x.strokeStyle = R() < 0.6 ? '#111' : pick(COLORS);
    x.lineWidth = 3 + R() * 5; x.lineCap = 'round';
    let px = R() * w, py = 30 + R() * (h - 60);
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 8; k++) {
      const nx = px + 12 + R() * 40, ny = py + (R() - 0.5) * 60;
      x.quadraticCurveTo(px + (R() - 0.5) * 50, py + (R() - 0.5) * 80, nx, ny);
      px = nx; py = ny;
    }
    x.stroke();
  };
  const shape = () => {
    const cx = R() * w, cy = R() * h, r = 20 + R() * 60;
    x.fillStyle = pick(COLORS); x.strokeStyle = '#111'; x.lineWidth = 5;
    x.beginPath();
    if (R() < 0.5) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r;
        x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
    } else {
      x.moveTo(cx, cy + r * 0.8);
      x.bezierCurveTo(cx - r * 1.4, cy - r * 0.3, cx - r * 0.5, cy - r * 1.2, cx, cy - r * 0.35);
      x.bezierCurveTo(cx + r * 0.5, cy - r * 1.2, cx + r * 1.4, cy - r * 0.3, cx, cy + r * 0.8);
    }
    x.closePath(); x.fill(); x.stroke();
  };
  const area = (w * h) / (2048 * 512);
  for (let k = 0; k < 70 * area; k++) blob();
  for (let k = 0; k < 26 * area; k++) letters();
  for (let k = 0; k < 40 * area; k++) shape();
  for (let k = 0; k < 18 * area; k++) letters();
  for (let k = 0; k < 90 * area; k++) tag();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function paintMaterial(tex) {
  const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide });
  // the street lights at its mouth: a little of the paint still shows at night
  mat.emissiveNode = Fn(() => texture(tex).rgb.mul(mix(float(0.0), float(0.22), smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow))))();
  return mat;
}

// a painted panel along a wall's path of [x, z] points, standing off it toward (sx, sz)
function wallPanel(path, y0, y1, off, uScale) {
  const pos = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    if (i) u += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]);
    const [ox, oz] = off(i);
    pos.push(x + ox, y0, z + oz, x + ox, y1, z + oz);
    uv.push(u / uScale, 0, u / uScale, 1);
    if (i) { const b = (i - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// the parking structure, cut back to its face where the survey ran it down the alley
function reshapedStructure() {
  const b = REAL_BUILDINGS.find((q) => q.height > 15 && q.minZ < 0 && q.maxZ > 10 && q.polygons.some((p) => polygonContains(p, 487, 10)));
  if (!b) return null;
  const k = b.polygons.findIndex((p) => polygonContains(p, 487, 10)), outer = [];
  for (const p of b.polygons[k].outer) {
    const q = { x: p.x, z: Math.min(p.z, BACK_Z) };
    const prev = outer[outer.length - 1], prev2 = outer[outer.length - 2];
    // a run along the cut keeps only its two ends
    if (prev && prev2 && q.z === BACK_Z && prev.z === BACK_Z && prev2.z === BACK_Z) outer.pop();
    if (prev && Math.abs(prev.x - q.x) < 0.05 && Math.abs(prev.z - q.z) < 0.05) continue;
    outer.push(q);
  }
  let maxZ = -Infinity;
  for (const p of outer) maxZ = Math.max(maxZ, p.z);
  return { from: b, to: { ...b, maxZ, polygons: b.polygons.map((p, i) => (i === k ? { outer, holes: p.holes || [] } : p)) } };
}

function buildGraffitiAlley(group, colliders) {
  const reshape = reshapedStructure();
  const g = Math.min(groundHeight(487, 3), groundHeight(487, 17)) - 0.2;
  const walls = paintMaterial(paintTexture(2048, 512, 41, false));
  const walls2 = paintMaterial(paintTexture(2048, 512, 97, false));
  const floorMat = paintMaterial(paintTexture(512, 1024, 13, true));
  const H = 6.4;
  const parts = [
    // the shops' wall, facing east; the theater's, facing west
    new THREE.Mesh(wallPanel(WEST, g, g + H, () => [0.06, 0], H * 4), walls),
    new THREE.Mesh(wallPanel(EAST, g, g + H + 1.6, () => [-0.06, 0], (H + 1.6) * 4), walls2),
    // the end wall, the structure's face, and its dark doorway through
    new THREE.Mesh(wallPanel([[491, BACK_Z + 0.06], [483.5, BACK_Z + 0.06]], g, g + H + 1.6, () => [0, 0], (H + 1.6) * 4), walls)
  ];
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 17.2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(487.2, groundHeight(487, 10) + LIFT.lawn + 0.03, BACK_Z + 8.6);
  parts.push(floor);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0c, roughness: 1 }));
  door.position.set(487.4, g + 1.5, BACK_Z + 0.09);
  parts.push(door);
  // a painted trash can halfway down: its collider names the structure the alley cuts back
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.95, 14), paintMaterial(paintTexture(256, 128, 5, false)));
  can.position.set(484.25, groundHeight(484.25, 9) + 0.47, 9);
  parts.push(can);
  for (const m of parts) {
    m.receiveShadow = true;
    group.add(m);
    m.updateMatrixWorld(true);
  }
  const collider = { minX: 483.9, maxX: 484.6, minZ: 8.65, maxZ: 9.35, maxY: can.position.y + 0.48, keepsSurvey: true };
  if (reshape) collider.reshapes = reshape;
  colliders.push(collider);
  return true;
}

export { buildGraffitiAlley };
