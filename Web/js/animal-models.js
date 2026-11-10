import * as THREE from 'three/webgpu';
import { Fn, attribute, texture, uv, uniform, mix, vec3, float, step, normalMap, normalView, normalize } from 'three/tsl';

// Ann Arbor's animals, modelled in code: each species is one skinned body (lofted rings around its bones, weighted to
// them by distance), fur or feather textures made here once, and a light stand-in for far away. A species shares its
// geometry, textures and materials; each animal near the player has its own skeleton, posed every frame (animals.js).
//
// Model space: metres, +z the way it faces, +y up, +x its left. Bones rest unrotated, so a bone's rotation.x tips what
// hangs off it nose-down (a leg pointing down swings back), .z tips it toward +x.

// ============================================================================
// 1. TEXTURES: hair and feathers, painted strand by strand, with a normal map from the same strands
// ============================================================================
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// R: how light the hair is, G: its light tip (the grizzle of a squirrel's coat), B: how deep (gaps are dark)
function paintHair({ size = 256, strands = 2600, len = [12, 24], width = 1.3, tips = 0.55, seed = 7 } = {}) {
  const r = rng(seed), N = size * size;
  const H = new Float32Array(N), L = new Float32Array(N).fill(0.62), T = new Float32Array(N);
  for (let s = 0; s < strands; s++) {
    const x0 = r() * size, y0 = r() * size, n = len[0] + r() * (len[1] - len[0]);
    const slant = (r() - 0.5) * 0.35, lum = 0.72 + r() * 0.5, top = 0.45 + r() * 0.55, tipped = r() < tips;
    for (let k = 0; k < n; k++) {
      const t = k / n, x = x0 + slant * k, y = y0 + k;
      const h = top * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.4)));
      for (let o = -2; o <= 2; o++) {
        const fall = Math.exp(-(o * o) / (width * width));
        const px = ((Math.round(x) + o) % size + size) % size, py = ((Math.round(y) % size) + size) % size, i = py * size + px;
        const v = h * fall;
        if (v > H[i]) {
          H[i] = v;
          L[i] = lum * (0.8 + 0.2 * fall);
          T[i] = tipped && t > 0.68 ? fall : 0;
        }
      }
    }
  }
  return pack(size, H, L, T);
}

// Feathers: overlapping rounded vanes in rows, each with its shaft and barbs, lighter at the edge
function paintFeathers({ size = 256, rows = 8, perRow = 6, seed = 11 } = {}) {
  const r = rng(seed), N = size * size;
  const H = new Float32Array(N), L = new Float32Array(N).fill(0.7), T = new Float32Array(N);
  const cell = size / perRow, rowH = size / rows;
  for (let row = rows + 1; row >= -1; row--) {
    for (let c = 0; c < perRow; c++) {
      const cx = (c + (row % 2) * 0.5 + (r() - 0.5) * 0.2) * cell, cy = row * rowH + (r() - 0.5) * 3;
      const w = cell * 0.62, h = rowH * 1.55, lum = 0.85 + r() * 0.25;
      for (let dy = 0; dy < h; dy++) {
        const t = dy / h, half = w * Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)) * (1 - t * 0.15);
        for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
          const u = Math.abs(dx) / Math.max(1, half);
          if (u > 1) continue;
          const px = ((Math.round(cx + dx) % size) + size) % size, py = ((Math.round(cy + dy) % size) + size) % size, i = py * size + px;
          const barb = 0.5 + 0.5 * Math.sin((dy * 1.6 + Math.abs(dx) * 1.1) * 1.3);
          const shaft = Math.exp(-(dx * dx) / 1.2);
          H[i] = (1 - u * u) * 0.7 + barb * 0.15 + shaft * 0.15;
          L[i] = lum * (0.82 + 0.12 * barb + 0.1 * shaft);
          T[i] = Math.max(0, (u - 0.75) * 4) * 0.8 + Math.max(0, (0.12 - t) * 6);
        }
      }
    }
  }
  return pack(size, H, L, T);
}

function pack(size, H, L, T) {
  const color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      color[o] = Math.min(255, L[i] * 160);
      color[o + 1] = Math.min(255, T[i] * 255);
      color[o + 2] = Math.min(255, H[i] * 255);
      color[o + 3] = 255;
      let nx = (at(x - 1, y) - at(x + 1, y)) * 2.2, ny = (at(x, y - 1) - at(x, y + 1)) * 2.2;
      const l = Math.hypot(nx, ny, 1);
      normal[o] = (nx / l * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny / l * 0.5 + 0.5) * 255;
      normal[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { color: tex(color), normal: tex(normal), bytes: size * size * 8 * 1.34 };
}

// ============================================================================
// 2. BODIES: rings lofted along a path around the bones, skinned to the nearest of them
// ============================================================================
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const WHITE = [1, 1, 1];

class Body {
  constructor(bones) {
    this.bones = bones;
    this.index = new Map(bones.map((b, i) => [b.name, i]));
    for (const b of bones) {
      b.head = new THREE.Vector3(...b.at);
      const child = bones.find((c) => c.parent === b.name);
      b.tail = b.end ? new THREE.Vector3(...b.end) : child ? new THREE.Vector3(...child.at) : b.head.clone().add(new THREE.Vector3(0, 0, 0.01));
    }
    this.pos = []; this.nrm = []; this.uvs = []; this.mat = []; this.idx = []; this.si = []; this.sw = [];
    this.colA = []; this.colB = []; this.colored = false; // a bird's own colours, two plumages (animal-birds.js)
  }

  // The four nearest bones (by distance to each bone's length), the nearest weighed most
  weigh(p, names) {
    const w = [];
    for (const name of names) {
      const b = this.bones[this.index.get(name)];
      const d = distToSegment(p, b.head, b.tail);
      w.push([this.index.get(name), 1 / (d + 0.004) ** 4]);
    }
    w.sort((a, b) => b[1] - a[1]);
    const top = w.slice(0, 4);
    const sum = top.reduce((s, x) => s + x[1], 0);
    while (top.length < 4) top.push([0, 0]);
    this.si.push(...top.map((x) => x[0]));
    this.sw.push(...top.map((x) => x[1] / sum));
  }

  /**
   * One part: `keys` are rings { c: [x, y, z], rx, ry, down? } smoothed into `steps` rings between each pair, each of
   * `segs` points round. `mirror` flips it to the other side (x), with `swap` naming the bones there.
   */
  loft(keys, { segs = 24, steps = 4, upRef = [0, 1, 0], bones, mat, col = null, fluff = 0, fluffFreq = 5, scale = 22, vScale = scale, mirror = false, swap = null }) {
    const names = mirror && swap ? bones.map(swap) : bones;
    const rings = smoothRings(keys, steps);
    const base = this.pos.length / 3;
    // frames carried along the path without twisting
    let t = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3();
    let arc = 0, prev = null;
    const circ = Math.PI * (keys.reduce((m, k) => Math.max(m, k.rx + k.ry), 0));
    const uRep = Math.max(1, Math.round(circ * scale));
    rings.forEach((ring, j) => {
      const a = rings[Math.max(0, j - 1)].c, b = rings[Math.min(rings.length - 1, j + 1)].c;
      const nt = new THREE.Vector3().subVectors(b, a).normalize();
      if (j === 0) {
        t.copy(nt);
        side.crossVectors(new THREE.Vector3(...upRef), t).normalize();
        up.crossVectors(t, side);
      } else {
        _q.setFromUnitVectors(t, nt);
        side.applyQuaternion(_q); up.applyQuaternion(_q); t.copy(nt);
      }
      if (prev) arc += prev.distanceTo(ring.c);
      prev = ring.c;
      for (let i = 0; i <= segs; i++) {
        const ang = (i / segs) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        const ii = i % segs;
        const f = 1 + fluff * (hash2(ii * 0.61 * fluffFreq / 5, j * 1.7) - 0.5) * 2;
        const ry = sa < 0 ? ring.down : ring.ry;
        const p = new THREE.Vector3().copy(ring.c).addScaledVector(side, ca * ring.rx * f).addScaledVector(up, sa * ry * f);
        const outward = new THREE.Vector3().addScaledVector(side, ca / Math.max(1e-4, ring.rx)).addScaledVector(up, sa / Math.max(1e-4, ry)).normalize();
        if (mirror) { p.x = -p.x; outward.x = -outward.x; }
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(0, 0, 0);
        this.uvs.push((i / segs) * uRep, arc * vScale);
        const m = mat(p, outward, ang, j / (rings.length - 1), mirror ? -1 : 1);
        this.mat.push(m[0] || 0, m[1] || 0, m[2] || 0, m[3] || 0);
        const cc = col ? col(p, outward, ang, j / (rings.length - 1), mirror ? -1 : 1) : null;
        if (cc) this.colored = true;
        this.colA.push(...(cc?.[0] ?? WHITE)); this.colB.push(...(cc?.[1] ?? cc?.[0] ?? WHITE));
        this.weigh(p, names);
      }
    });
    const row = segs + 1;
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
        if (mirror) this.idx.push(a, b, c, b, d, c);
        else this.idx.push(a, c, b, b, c, d);
      }
    }
    this.normals(base, rings.length, row);
  }

  // A round part (an eye, a nose): rings of a sphere along z
  ball(c, r, opts) {
    const keys = [];
    const n = opts.rings || 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n, z = -1 + 2 * t, s = Math.sqrt(Math.max(0, 1 - z * z)) || 0.002;
      keys.push({ c: [c[0], c[1], c[2] + z * (r.z ?? r)], rx: s * (r.x ?? r), ry: s * (r.y ?? r) });
    }
    this.loft(keys, { steps: 1, upRef: [0, 1, 0], ...opts });
  }

  normals(base, nRings, row) {
    const P = this.pos, Nn = this.nrm, I = this.idx;
    const start = this.idx.length - (nRings - 1) * (row - 1) * 6;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let k = start; k < I.length; k += 3) {
      const i0 = I[k] * 3, i1 = I[k + 1] * 3, i2 = I[k + 2] * 3;
      a.fromArray(P, i0); b.fromArray(P, i1); c.fromArray(P, i2);
      n.subVectors(c, b).cross(_v.subVectors(a, b));
      for (const i of [i0, i1, i2]) { Nn[i] += n.x; Nn[i + 1] += n.y; Nn[i + 2] += n.z; }
    }
    for (let j = 0; j < nRings; j++) {
      // the seam's two copies of one point share a normal
      const s = (base + j * row) * 3, e = (base + j * row + row - 1) * 3;
      for (let k = 0; k < 3; k++) { const v = Nn[s + k] + Nn[e + k]; Nn[s + k] = Nn[e + k] = v; }
    }
    for (let v = base; v < base + nRings * row; v++) {
      n.fromArray(Nn, v * 3);
      if (n.lengthSq() < 1e-20) n.set(0, 1, 0);
      n.normalize().toArray(Nn, v * 3);
    }
  }

  geometry({ skinned = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    if (this.colored) {
      g.setAttribute('aColA', new THREE.Float32BufferAttribute(this.colA, 3));
      g.setAttribute('aColB', new THREE.Float32BufferAttribute(this.colB, 3));
    }
    if (skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function distToSegment(p, a, b) {
  const ab = _v.subVectors(b, a), l2 = ab.lengthSq();
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t), p.z - (a.z + ab.z * t));
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Catmull-Rom through the key rings: centres and radii
function smoothRings(keys, steps) {
  const K = keys.map((k) => ({ c: new THREE.Vector3(...k.c), rx: k.rx, ry: k.ry ?? k.rx, down: k.down ?? k.ry ?? k.rx }));
  if (steps <= 1) return K;
  const out = [];
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        c: new THREE.Vector3(cr(a.c.x, b.c.x, c.c.x, d.c.x, t), cr(a.c.y, b.c.y, c.c.y, d.c.y, t), cr(a.c.z, b.c.z, c.c.z, d.c.z, t)),
        rx: Math.max(0.0005, cr(a.rx, b.rx, c.rx, d.rx, t)), ry: Math.max(0.0005, cr(a.ry, b.ry, c.ry, d.ry, t)), down: Math.max(0.0005, cr(a.down, b.down, c.down, d.down, t))
      });
    }
  }
  out.push(K[K.length - 1]);
  return out;
}

// ============================================================================
// 3. MATERIAL: one per coat, sharing the textures. aMat = (pale, dark, fringe, warm)
// ============================================================================
function coatMaterial(tex, coat, { normalScale = 0.8 } = {}) {
  const back = uniform(new THREE.Color(coat.back)), belly = uniform(new THREE.Color(coat.belly));
  const warm = uniform(new THREE.Color(coat.warm)), fringe = uniform(new THREE.Color(coat.fringe));
  const tip = uniform(new THREE.Color(coat.tip ?? coat.fringe)), dark = uniform(new THREE.Color(coat.dark ?? 0x0b0907));
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const am = attribute('aMat', 'vec4');
  const isEye = step(0.9, am.y);
  m.colorNode = Fn(() => {
    const f = texture(tex.color, uv());
    let base = mix(back, warm, am.w);
    base = mix(base, belly, am.x);
    const lum = f.r.mul(1.6);
    let col = base.mul(lum).add(tip.mul(f.g).mul(float(0.45).mul(float(1).sub(am.x)))).toVar();
    col.assign(mix(col, fringe.mul(lum.mul(0.5).add(0.6)), am.z.mul(f.g.mul(0.7).add(0.3))));
    // the gaps between hairs a little darker, the eye and nose their own
    col.assign(col.mul(f.b.mul(0.35).add(0.72)));
    return vec3(mix(col, dark, am.y));
  })();
  m.roughnessNode = mix(float(0.88), float(0.12), isEye);
  m.normalNode = normalize(mix(normalMap(texture(tex.normal, uv()), float(normalScale)), normalView, isEye));
  return m;
}

// ============================================================================
// 4. THE SQUIRREL: an eastern gray (or fox, or black) squirrel, about 25 cm and its tail as long again
// ============================================================================
const SQUIRREL_BONES = [
  { name: 'root', parent: null, at: [0, 0, 0] },
  { name: 'hips', parent: 'root', at: [0, 0.088, -0.06] },
  { name: 'spine', parent: 'hips', at: [0, 0.095, 0.0] },
  { name: 'chest', parent: 'spine', at: [0, 0.092, 0.06] },
  { name: 'neck', parent: 'chest', at: [0, 0.102, 0.098] },
  { name: 'head', parent: 'neck', at: [0, 0.118, 0.122], end: [0, 0.106, 0.186] },
  { name: 'shoulderL', parent: 'chest', at: [0.027, 0.078, 0.074] },
  { name: 'elbowL', parent: 'shoulderL', at: [0.030, 0.040, 0.085] },
  { name: 'handL', parent: 'elbowL', at: [0.030, 0.008, 0.096], end: [0.030, 0.003, 0.116] },
  { name: 'shoulderR', parent: 'chest', at: [-0.027, 0.078, 0.074] },
  { name: 'elbowR', parent: 'shoulderR', at: [-0.030, 0.040, 0.085] },
  { name: 'handR', parent: 'elbowR', at: [-0.030, 0.008, 0.096], end: [-0.030, 0.003, 0.116] },
  { name: 'thighL', parent: 'hips', at: [0.034, 0.080, -0.056] },
  { name: 'kneeL', parent: 'thighL', at: [0.044, 0.048, -0.031] },
  { name: 'ankleL', parent: 'kneeL', at: [0.040, 0.016, -0.064] },
  { name: 'toeL', parent: 'ankleL', at: [0.041, 0.005, -0.030], end: [0.041, 0.004, -0.010] },
  { name: 'thighR', parent: 'hips', at: [-0.034, 0.080, -0.056] },
  { name: 'kneeR', parent: 'thighR', at: [-0.044, 0.048, -0.031] },
  { name: 'ankleR', parent: 'kneeR', at: [-0.040, 0.016, -0.064] },
  { name: 'toeR', parent: 'ankleR', at: [-0.041, 0.005, -0.030], end: [-0.041, 0.004, -0.010] },
  { name: 'tail0', parent: 'hips', at: [0, 0.090, -0.100] },
  { name: 'tail1', parent: 'tail0', at: [0, 0.108, -0.135] },
  { name: 'tail2', parent: 'tail1', at: [0, 0.140, -0.165] },
  { name: 'tail3', parent: 'tail2', at: [0, 0.185, -0.175] },
  { name: 'tail4', parent: 'tail3', at: [0, 0.230, -0.165], end: [0, 0.278, -0.130] }
];
const SB = Object.fromEntries(SQUIRREL_BONES.map((b, i) => [b.name, i]));
const toR = (n) => n.replace(/L$/, 'R');

const SQUIRREL_COATS = {
  gray: { back: 0x7d7a77, warm: 0x8a6748, belly: 0xebe6dc, fringe: 0xe2dfda, tip: 0xd9d4cc },
  fox: { back: 0x86684c, warm: 0xb4632f, belly: 0xd9864a, fringe: 0xd08848, tip: 0xc89a6a },
  black: { back: 0x1d1b1a, warm: 0x2b2420, belly: 0x2a2522, fringe: 0x4a4440, tip: 0x5a524c }
};

function squirrelBody(detail) {
  const b = new Body(SQUIRREL_BONES.map((x) => ({ ...x })));
  const hi = detail > 0;
  const segs = hi ? 28 : 9, steps = hi ? 4 : 1, limbSegs = hi ? 14 : 5;
  const belly = (n) => Math.min(1, Math.max(0, (-n.y - 0.1) / 0.45));
  const flank = (n) => Math.max(0, 0.55 - Math.abs(n.y)) * 0.9;

  // torso: rump to neck
  b.loft([
    { c: [0, 0.088, -0.114], rx: 0.010 },
    { c: [0, 0.090, -0.102], rx: 0.030, ry: 0.032, down: 0.028 },
    { c: [0, 0.093, -0.076], rx: 0.044, ry: 0.044, down: 0.040 },
    { c: [0, 0.095, -0.040], rx: 0.046, ry: 0.046, down: 0.042 },
    { c: [0, 0.095, -0.004], rx: 0.042, ry: 0.044, down: 0.040 },
    { c: [0, 0.093, 0.035], rx: 0.036, ry: 0.040, down: 0.036 },
    { c: [0, 0.094, 0.070], rx: 0.031, ry: 0.034, down: 0.033 },
    { c: [0, 0.102, 0.098], rx: 0.025, ry: 0.028, down: 0.027 },
    { c: [0, 0.112, 0.118], rx: 0.021, ry: 0.023 }
  ], { segs, steps, bones: ['hips', 'spine', 'chest', 'neck', 'tail0'], fluff: 0.025, mat: (p, n) => [belly(n), 0, 0, flank(n)] });

  // head: back of the skull to the nose, cheeks broad, with a pale ring round each eye
  const eyeAt = [0.0215, 0.1275, 0.146];
  const ring = (p) => Math.max(0, 1 - Math.hypot(Math.abs(p.x) - eyeAt[0], p.y - eyeAt[1], p.z - eyeAt[2]) / 0.0125);
  b.loft([
    { c: [0, 0.118, 0.100], rx: 0.010 },
    { c: [0, 0.120, 0.108], rx: 0.022, ry: 0.024, down: 0.022 },
    { c: [0, 0.122, 0.123], rx: 0.029, ry: 0.028, down: 0.025 },
    { c: [0, 0.121, 0.140], rx: 0.028, ry: 0.026, down: 0.022 },
    { c: [0, 0.116, 0.157], rx: 0.022, ry: 0.020, down: 0.017 },
    { c: [0, 0.110, 0.171], rx: 0.015, ry: 0.014, down: 0.012 },
    { c: [0, 0.106, 0.182], rx: 0.009, ry: 0.0085, down: 0.008 },
    { c: [0, 0.104, 0.1885], rx: 0.003 }
  ], { segs, steps, bones: ['head', 'neck'], scale: 30, mat: (p, n) => [Math.max(belly(n) * 0.9, ring(p) * 0.85), 0, 0, 0.5 * (1 - belly(n))] });
  for (const s of [1, -1]) {
    b.ball([eyeAt[0] * s, eyeAt[1], eyeAt[2]], { x: 0.0062, y: 0.0072, z: 0.0072 }, { segs: hi ? 16 : 6, rings: hi ? 8 : 3, bones: ['head'], mat: () => [0, 1, 0, 0] });
  }
  b.ball([0, 0.1045, 0.1868], { x: 0.0048, y: 0.0035, z: 0.0035 }, { segs: hi ? 10 : 5, rings: hi ? 5 : 2, bones: ['head'], mat: () => [0, 0.75, 0, 0] });
  // ears: small and round-tipped, a little pale at the back
  const ear = { segs: hi ? 10 : 4, steps: hi ? 3 : 1, upRef: [0, 0, 1], bones: ['head'], scale: 34, mat: (p) => [0.15, 0, 0.3, 0.6] };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.013, 0.136, 0.122], rx: 0.011, ry: 0.006 },
      { c: [0.016, 0.148, 0.119], rx: 0.0095, ry: 0.0045 },
      { c: [0.019, 0.159, 0.116], rx: 0.0065, ry: 0.003 },
      { c: [0.0205, 0.166, 0.1145], rx: 0.0015, ry: 0.001 }
    ], { ...ear, mirror });
  }

  // forelegs and paws, a dark claw at the end of each
  const fore = { segs: limbSegs, steps, upRef: [0, 0, 1], bones: ['chest', 'shoulderL', 'elbowL', 'handL'], swap: toR, scale: 34 };
  const paw = { segs: limbSegs, steps, upRef: [0, 1, 0], bones: ['elbowL', 'handL'], swap: toR, scale: 40 };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.024, 0.084, 0.072], rx: 0.016 },
      { c: [0.029, 0.058, 0.081], rx: 0.0115, ry: 0.012 },
      { c: [0.030, 0.037, 0.087], rx: 0.0085 },
      { c: [0.030, 0.019, 0.092], rx: 0.0065 },
      { c: [0.030, 0.008, 0.095], rx: 0.0058 }
    ], { ...fore, mirror, mat: (p, n, a, t) => [Math.max(0, -n.z) * 0.5, 0, 0, 0.55 + t * 0.35] });
    b.loft([
      { c: [0.030, 0.006, 0.090], rx: 0.004, ry: 0.003 },
      { c: [0.030, 0.0045, 0.098], rx: 0.0075, ry: 0.0042 },
      { c: [0.030, 0.0035, 0.108], rx: 0.0065, ry: 0.0032 },
      { c: [0.030, 0.003, 0.115], rx: 0.0035, ry: 0.002 },
      { c: [0.030, 0.0028, 0.118], rx: 0.0008 }
    ], { ...paw, mirror, mat: (p) => [0, p.z > 0.112 ? 0.7 : 0, 0, 0.85] });
  }

  // hind legs: the big haunch, the shin back to the hock, the long foot forward
  const hind = { segs: hi ? 18 : 6, steps, upRef: [0, 0, 1], bones: ['hips', 'thighL', 'kneeL', 'ankleL'], swap: toR, scale: 30 };
  const foot = { segs: limbSegs, steps, upRef: [0, 1, 0], bones: ['ankleL', 'toeL'], swap: toR, scale: 40 };
  for (const mirror of [false, true]) {
    b.loft([
      { c: [0.026, 0.094, -0.064], rx: 0.020 },
      { c: [0.036, 0.077, -0.052], rx: 0.020, ry: 0.026 },
      { c: [0.043, 0.054, -0.036], rx: 0.016, ry: 0.020 },
      { c: [0.043, 0.036, -0.046], rx: 0.0105 },
      { c: [0.040, 0.019, -0.062], rx: 0.0072 },
      { c: [0.040, 0.013, -0.068], rx: 0.002 }
    ], { ...hind, mirror, mat: (p, n) => [belly(n) * 0.7, 0, 0, 0.35 + flank(n) * 0.5] });
    b.loft([
      { c: [0.040, 0.012, -0.073], rx: 0.003, ry: 0.003 },
      { c: [0.040, 0.010, -0.066], rx: 0.0078, ry: 0.0062 },
      { c: [0.040, 0.0062, -0.046], rx: 0.0088, ry: 0.0042 },
      { c: [0.041, 0.0048, -0.023], rx: 0.0078, ry: 0.0034 },
      { c: [0.041, 0.0042, -0.012], rx: 0.004, ry: 0.002 },
      { c: [0.041, 0.004, -0.009], rx: 0.0008 }
    ], { ...foot, mirror, mat: (p) => [0, p.z > -0.016 ? 0.7 : 0, 0, 0.8] });
  }

  // the tail: bushy, flat side to side, frosted at its edges
  b.loft([
    { c: [0, 0.090, -0.098], rx: 0.012 },
    { c: [0, 0.099, -0.122], rx: 0.026, ry: 0.020 },
    { c: [0, 0.124, -0.154], rx: 0.040, ry: 0.029 },
    { c: [0, 0.164, -0.174], rx: 0.046, ry: 0.032 },
    { c: [0, 0.206, -0.174], rx: 0.045, ry: 0.031 },
    { c: [0, 0.246, -0.159], rx: 0.040, ry: 0.028 },
    { c: [0, 0.272, -0.139], rx: 0.029, ry: 0.021 },
    { c: [0, 0.284, -0.121], rx: 0.012, ry: 0.009 },
    { c: [0, 0.286, -0.113], rx: 0.002 }
  ], {
    segs: hi ? 32 : 8, steps: hi ? 4 : 1, upRef: [0, 1, 0], bones: ['hips', 'tail0', 'tail1', 'tail2', 'tail3', 'tail4'],
    fluff: hi ? 0.16 : 0.05, fluffFreq: 9, scale: 14, vScale: 9,
    mat: (p, n, a, t) => [0, 0, Math.min(1, Math.abs(Math.cos(a)) ** 1.5 * 1.1 + t * 0.2), 0.3 * (1 - Math.abs(Math.cos(a)))]
  });
  return b;
}

/**
 * Everything the squirrels share: the near body (skinned), the far one, three coats' materials and the textures.
 * `make(coat)` gives one squirrel near the player its own skeleton; `far[coat]` is an instanced stand-in per coat.
 */
function createSquirrelKit({ farCount = 16 } = {}) {
  const tex = paintHair({ seed: 21 });
  const nearBody = squirrelBody(1), farBody = squirrelBody(0);
  const nearGeo = nearBody.geometry(), farGeo = farBody.geometry({ skinned: false });
  const mats = Object.fromEntries(Object.entries(SQUIRREL_COATS).map(([k, c]) => [k, coatMaterial(tex, c)]));
  const inverses = SQUIRREL_BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.12, 0), 0.3);
  const far = {};
  for (const [k, m] of Object.entries(mats)) {
    const inst = new THREE.InstancedMesh(farGeo, m, farCount);
    inst.count = 0;
    inst.frustumCulled = false;
    inst.name = `squirrels far (${k})`;
    far[k] = inst;
  }
  function make(coat) {
    const bones = SQUIRREL_BONES.map((d) => {
      const bone = new THREE.Bone();
      bone.name = d.name;
      return bone;
    });
    SQUIRREL_BONES.forEach((d, i) => {
      const parent = d.parent ? SQUIRREL_BONES[SB[d.parent]] : null;
      bones[i].position.set(d.at[0] - (parent?.at[0] || 0), d.at[1] - (parent?.at[1] || 0), d.at[2] - (parent?.at[2] || 0));
      if (parent) bones[SB[d.parent]].add(bones[i]);
    });
    const mesh = new THREE.SkinnedMesh(nearGeo, mats[coat]);
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
    mesh.boundingSphere = sphere;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'squirrel';
    return { mesh, bones, coat };
  }
  const bytes = (g) => Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength || 0);
  // one skinned body per coat and one stand-in each, in no scene and on their own copies of the shapes, for main.js'
  // compileLater to make their shaders a few seconds into play (else the first squirrel near stalls the frame)
  function* toPrepare() {
    for (const coat of Object.keys(mats)) {
      const { mesh } = make(coat);
      mesh.geometry = nearGeo.clone();
      mesh.updateMatrixWorld(true);
      yield mesh;
    }
    for (const m of Object.values(mats)) {
      const inst = new THREE.InstancedMesh(farGeo.clone(), m, 1);
      inst.updateMatrixWorld(true);
      yield inst;
    }
  }
  return {
    make, far, materials: mats, toPrepare,
    stats: { triangles: nearGeo.index.count / 3, farTriangles: farGeo.index.count / 3, bytes: bytes(nearGeo) + bytes(farGeo), textureBytes: tex.bytes },
    dispose() { nearGeo.dispose(); farGeo.dispose(); tex.color.dispose(); tex.normal.dispose(); for (const m of Object.values(mats)) m.dispose(); }
  };
}

// ============================================================================
// 5. POSES: everything a squirrel does, as a few amounts blended on its bones
// ============================================================================
/**
 * p: { gait (0 still – 1 bounding), phase (0–1 through a bound), sit (sitting up), climb (on a trunk, legs out),
 * headDown (facing down a trunk), dig (nose in the grass), flick (a tail flick's strength), time, yaw, pitch (the
 * head turning), alert (frozen, head up) }. Returns how high the body rides above its feet (the bound's leap).
 */
function poseSquirrel(bones, p) {
  const r = (n) => bones[SB[n]].rotation;
  for (const b of bones) b.rotation.set(0, 0, 0);
  const g = p.gait, s = Math.sin(p.phase * Math.PI * 2), c = Math.cos(p.phase * Math.PI * 2);
  const gather = Math.max(0, -s) * g, stretch = Math.max(0, s) * g;
  const sit = p.sit * (1 - p.climb), climb = p.climb;
  const t = p.time;

  // spine: arched as the hind feet land past the fore, long in the leap; upright to sit
  r('hips').x = 0.32 * gather - 0.12 * stretch - 1.12 * sit;
  r('spine').x = 0.12 * gather - 0.05 * stretch + 0.12 * sit;
  r('chest').x = -0.22 * gather + 0.06 * stretch + 0.16 * sit + 0.18 * p.dig;
  r('neck').x = -0.12 * gather + 0.3 * sit + 0.45 * p.dig - 0.35 * p.alert - 0.55 * p.headDown + p.pitch * 0.5;
  r('head').x = -0.05 * g + 0.42 * sit + 0.3 * p.dig - 0.15 * p.alert + p.pitch * 0.5;
  r('neck').y = p.yaw * 0.45;
  r('head').y = p.yaw * 0.55;
  r('head').z = p.tilt || 0;

  // forelegs reach together, then fold back under the chest; to sit, the paws come up to the chin
  const scratch = p.dig * Math.sin(t * 22) * 0.35;
  for (const [side, k] of [['L', 1], ['R', -1]]) {
    const off = k > 0 ? 0 : 0.06; // the half-bound: one foot a moment behind the other
    const sk = Math.sin((p.phase + off) * Math.PI * 2), ck = Math.cos((p.phase + off) * Math.PI * 2);
    r('shoulder' + side).x = -0.85 * sk * g - 1.05 * sit + (k > 0 ? scratch : -scratch) - 0.2 * p.dig;
    r('elbow' + side).x = 0.55 * Math.max(0, ck) * g - 1.55 * sit + 0.25 * p.dig;
    r('hand' + side).x = -0.6 * Math.max(0, -sk) * g + 0.5 * sit;
    r('shoulder' + side).z = k * 0.75 * climb;
    r('thigh' + side).x = 0.95 * sk * g + 0.85 * sit;
    r('knee' + side).x = -0.6 * Math.max(0, -ck) * g + 0.55 * sit;
    r('ankle' + side).x = 0.7 * sk * g - 0.25 * sit;
    r('toe' + side).x = 0.4 * stretch;
    r('thigh' + side).z = k * 0.85 * climb;
    r('ankle' + side).z = -k * 0.3 * climb;
  }

  // the tail: curled up over the back at rest, streaming out behind at a run, laid along the ground to sit;
  // a flick ripples from its root to its tip
  const wave = (i) => p.flick * Math.sin(t * 26 - i * 1.15);
  r('tail0').x = 0.25 * g + 0.95 * sit + 0.3 * climb + wave(0) * 0.25;
  r('tail1').x = -0.1 * g + 0.15 * sit + wave(1) * 0.35;
  r('tail2').x = -0.55 * g - 0.1 * sit - 0.25 * climb + wave(2) * 0.45 + 0.12 * Math.sin(p.phase * Math.PI * 2 - 1) * g;
  r('tail3').x = -0.45 * g + wave(3) * 0.5 + 0.12 * Math.sin(p.phase * Math.PI * 2 - 2) * g;
  r('tail4').x = -0.25 * g + 0.15 * sit + wave(4) * 0.55;
  r('tail2').z = 0.06 * Math.sin(t * 1.3 + p.seed) * (1 - g);

  return (0.03 + 0.03 * g) * Math.pow(stretch, 0.8) - 0.022 * sit;
}

export { createSquirrelKit, poseSquirrel, SQUIRREL_COATS, Body, coatMaterial, paintHair, paintFeathers };
