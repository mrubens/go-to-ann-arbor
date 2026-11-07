// Draws a drafted building description (src/draft.js) as a three.js group: masses with their roofs, openings on
// their faces, chimneys, plain boxes, and the yard in front (trees, shrubs, hedges, fences, the drive and the walk).
// It draws exactly what the description says and adds nothing of its own, so two models' drafts can be compared fairly.

import * as THREE from 'three';
import { tex, std } from './generator.js';

const MATS = new Map();
const wallMat = (w) => { const k = w.material + w.color; if (!MATS.has(k)) MATS.set(k, std({ map: tex(w.material), color: w.color })); return MATS.get(k); };
const flatMat = (color, o = {}) => { const k = 'flat' + color + JSON.stringify(o); if (!MATS.has(k)) MATS.set(k, std({ color, ...o })); return MATS.get(k); };
const glass = () => { if (!MATS.has('glass')) MATS.set('glass', std({ map: tex('glass'), roughness: 0.15, metalness: 0.1 })); return MATS.get('glass'); };

const NUMBERS = new Map();
/** The numerals of a house number drawn on a transparent canvas, in the font asked for; cached by what they look like. */
function numberTexture(n) {
  const key = [n.text, n.font, n.color].join('|'); if (NUMBERS.has(key)) return NUMBERS.get(key);
  const family = n.font === 'serif' ? 'Georgia, "Times New Roman", serif' : n.font === 'script' ? '"Snell Roundhand", "Brush Script MT", cursive' : 'Helvetica Neue, Arial, sans-serif';
  const size = 128, c = document.createElement('canvas'), ctx = c.getContext('2d'), font = `${n.font === 'script' ? 'italic ' : ''}${n.font === 'sans' ? 600 : 500} ${size}px ${family}`;
  ctx.font = font; const w = Math.ceil(ctx.measureText(n.text).width) + 16, h = Math.round(size * 1.15); c.width = w; c.height = h;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = n.color; ctx.fillText(n.text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const out = { texture: t, aspect: w / h }; NUMBERS.set(key, out); return out;
}

/**
 * @param {object} spec
 * @param {{yard?: boolean}} [o]  yard false leaves out the trees, fences and the rest of the lot: the building alone, as it is graded
 * @returns {THREE.Group} centred on the masses' footprint, front toward +Z, standing on y = 0
 */
export function renderSpec(spec, { yard = true } = {}) {
  const g = new THREE.Group();
  const x0 = Math.min(...spec.masses.map((m) => m.x)), x1 = Math.max(...spec.masses.map((m) => m.x + m.w));
  const z0 = Math.min(...spec.masses.map((m) => m.z)), z1 = Math.max(...spec.masses.map((m) => m.z + m.d));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const P = (x, y, z) => new THREE.Vector3(x - cx, y, cz - z); // z grows away from the street; the street side is +Z
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };

  // A flat polygon from world-space corners, with UVs in metres, facing `out`.
  function polygon(pts3, uvs, mat, out) {
    const tris = THREE.ShapeUtils.triangulateShape(uvs.map((p) => new THREE.Vector2(p[0], p[1])), []);
    if (!tris.length) return;
    const pos = [], uv = [], idx = [];
    pts3.forEach((v, i) => { pos.push(v.x, v.y, v.z); uv.push(uvs[i][0], uvs[i][1]); });
    tris.forEach((t) => idx.push(t[0], t[1], t[2]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const n = geo.attributes.normal;
    if (n.getX(idx[0]) * out.x + n.getY(idx[0]) * out.y + n.getZ(idx[0]) * out.z < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
    return add(geo, mat);
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function box(x, z, w, d, y, h, mat, metres = false) { // a block given like everything else: front-left corner, size, bottom, height
    const geo = new THREE.BoxGeometry(w, h, d);
    if (metres) { const a = geo.attributes.uv; for (let i = 0; i < a.count; i++) { const f = Math.floor(i / 4); a.setXY(i, a.getX(i) * (f < 2 ? d : w), a.getY(i) * (f === 2 || f === 3 ? d : h)); } }
    const m = add(geo, mat); m.position.copy(P(x + w / 2, y + h / 2, z + d / 2)); return m;
  }

  const faceOf = new Map();
  for (const m of spec.masses) {
    const { x, z, w, d, wall_h: H, base_h: B, roof: r } = m;
    // Each face: `at(s, h, o)` is the point s metres along the wall, h up, o out from it.
    const faces = {
      front: { at: (s, h, o) => P(x + s, h, z - o), len: w, rot: 0 },
      back: { at: (s, h, o) => P(x + s, h, z + d + o), len: w, rot: Math.PI },
      left: { at: (s, h, o) => P(x - o, h, z + s), len: d, rot: -Math.PI / 2 },
      right: { at: (s, h, o) => P(x + w + o, h, z + s), len: d, rot: Math.PI / 2 }
    };
    faceOf.set(m.id, faces);
    // The top edge of each wall, as [s, h] points from one end to the other
    const level = (h, len) => [[0, h], [len, h]], tops = { front: level(H, w), back: level(H, w), left: level(H, d), right: level(H, d) };
    const ea = r.eave_a ?? H, eb = r.eave_b ?? H;
    if (r.type === 'gable' && r.ridge === 'z') { tops.front = tops.back = [[0, ea], [r.apex * w, r.ridge_h], [w, eb]]; tops.left = level(ea, d); tops.right = level(eb, d); }
    else if (r.type === 'gable') { tops.left = tops.right = [[0, ea], [r.apex * d, r.ridge_h], [d, eb]]; tops.front = level(ea, w); tops.back = level(eb, w); }
    else if (r.type === 'shed') {
      const hi = r.high_h;
      if (r.low === 'front') { tops.back = level(hi, w); tops.left = tops.right = [[0, H], [d, hi]]; }
      else if (r.low === 'back') { tops.front = level(hi, w); tops.left = tops.right = [[0, hi], [d, H]]; }
      else if (r.low === 'left') { tops.right = level(hi, d); tops.front = tops.back = [[0, H], [w, hi]]; }
      else { tops.left = level(hi, d); tops.front = tops.back = [[0, hi], [w, H]]; }
    } else if (r.type === 'flat') for (const f of Object.keys(tops)) tops[f] = level(H + 0.25, faces[f].len);

    const trim = flatMat(m.trim, { roughness: 0.7 });
    if (m.open) { // posts instead of walls
      for (const [px, pz] of [[x, z], [x + w - 0.12, z], [x, z + d - 0.12], [x + w - 0.12, z + d - 0.12]]) box(px, pz, 0.12, 0.12, B, Math.max(0.3, H - B), trim);
    } else for (const name of Object.keys(faces)) {
      const f = faces[name], top = tops[name], pts = [[0, B], [f.len, B], ...top.slice().reverse()];
      polygon(pts.map(([s, h]) => f.at(s, h, 0)), pts, wallMat(m.faces[name] || m.walls), f.at(0, 0, 1).sub(f.at(0, 0, 0)));
      if (top.length === 3) for (let i = 0; i < 2; i++) { // a gable end: trim boards along its two rakes
        const [a, b] = [top[i], top[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * 0.16, ny = (b[0] - a[0]) / L * 0.16;
        const q = [[a[0], a[1]], [b[0], b[1]], [b[0] - nx, b[1] - Math.abs(ny)], [a[0] - nx, a[1] - Math.abs(ny)]];
        polygon(q.map(([s, h]) => f.at(s, h, 0.04)), q, trim, f.at(0, 0, 1).sub(f.at(0, 0, 0)));
      }
    }

    // ---- roof
    const roofMat = std({ map: tex('shingle'), color: r.color, roughness: 0.95 }), ov = Math.min(0.3, Math.min(w, d) * 0.08);
    const quad = (a, b, c, e) => { const L1 = a.distanceTo(b), L2 = a.distanceTo(e); polygon([a, b, c, e], [[0, 0], [L1, 0], [L1, L2], [0, L2]], roofMat, UP); };
    const tri = (a, b, c) => { const L1 = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5); polygon([a, b, c], [[0, 0], [L1, 0], [L1 / 2, mid.distanceTo(c)]], roofMat, UP); };
    if (r.type === 'gable' && r.ridge === 'z') {
      const xr = x + r.apex * w, sa = (r.ridge_h - ea) / (r.apex * w), sb = (r.ridge_h - eb) / ((1 - r.apex) * w);
      quad(P(x - ov, ea - ov * sa, z - ov), P(x - ov, ea - ov * sa, z + d + ov), P(xr, r.ridge_h, z + d + ov), P(xr, r.ridge_h, z - ov));
      quad(P(x + w + ov, eb - ov * sb, z + d + ov), P(x + w + ov, eb - ov * sb, z - ov), P(xr, r.ridge_h, z - ov), P(xr, r.ridge_h, z + d + ov));
    } else if (r.type === 'gable') {
      const zr = z + r.apex * d, sa = (r.ridge_h - ea) / (r.apex * d), sb = (r.ridge_h - eb) / ((1 - r.apex) * d);
      quad(P(x - ov, ea - ov * sa, z - ov), P(x + w + ov, ea - ov * sa, z - ov), P(x + w + ov, r.ridge_h, zr), P(x - ov, r.ridge_h, zr));
      quad(P(x + w + ov, eb - ov * sb, z + d + ov), P(x - ov, eb - ov * sb, z + d + ov), P(x - ov, r.ridge_h, zr), P(x + w + ov, r.ridge_h, zr));
    } else if (r.type === 'hip') {
      const u0 = x - ov, u1 = x + w + ov, v0 = z - ov, v1 = z + d + ov, half = Math.min(u1 - u0, v1 - v0) / 2, T = r.ridge_h;
      const A = P(u0, H, v0), Bq = P(u1, H, v0), C = P(u1, H, v1), E = P(u0, H, v1);
      if (u1 - u0 >= v1 - v0) { const r1 = P(u0 + half, T, v0 + half), r2 = P(u1 - half, T, v0 + half); quad(A, Bq, r2, r1); quad(C, E, r1, r2); tri(E, A, r1); tri(Bq, C, r2); }
      else { const r1 = P(u0 + half, T, v0 + half), r2 = P(u0 + half, T, v1 - half); tri(A, Bq, r1); tri(C, E, r2); quad(E, A, r1, r2); quad(Bq, C, r2, r1); }
      box(x - ov, z - ov, w + 2 * ov, d + 2 * ov, H - 0.16, 0.14, trim);
    } else if (r.type === 'shed') {
      const hi = r.high_h, at = (px, pz) => { // the slope's height over any point, eaves included
        const t = r.low === 'front' ? (pz - z) / d : r.low === 'back' ? 1 - (pz - z) / d : r.low === 'left' ? (px - x) / w : 1 - (px - x) / w;
        return P(px, H + t * (hi - H), pz);
      };
      quad(at(x - ov, z - ov), at(x + w + ov, z - ov), at(x + w + ov, z + d + ov), at(x - ov, z + d + ov));
    } else box(x - 0.06, z - 0.06, w + 0.12, d + 0.12, H + 0.25, 0.08, trim);
  }

  // ---- openings
  for (const o of spec.openings) {
    const f = faceOf.get(o.mass)[o.face], s0 = o.x, s1 = o.x + o.w, h0 = o.y, h1 = o.y + o.h;
    const slab = (a, b, lo, hi, o0, o1, mat, metres) => { // a block lying on the face
      const geo = new THREE.BoxGeometry(b - a, hi - lo, o1 - o0);
      if (metres) { const u = geo.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i), u.getY(i) * (hi - lo)); }
      const m = add(geo, mat, false); m.position.copy(f.at((a + b) / 2, (lo + hi) / 2, (o0 + o1) / 2)); m.rotation.y = f.rot; return m;
    };
    const frame = flatMat(o.frame, { roughness: 0.7 }), fw = 0.07;
    if (o.kind === 'window') {
      const gl = add(new THREE.PlaneGeometry(o.w, o.h), glass(), false); gl.position.copy(f.at((s0 + s1) / 2, (h0 + h1) / 2, 0.03)); gl.rotation.y = f.rot;
      slab(s0 - fw, s1 + fw, h1, h1 + fw, 0, 0.07, frame); slab(s0 - fw, s1 + fw, h0 - fw * 1.3, h0, 0, 0.09, frame);
      slab(s0 - fw, s0, h0, h1, 0, 0.07, frame); slab(s1, s1 + fw, h0, h1, 0, 0.07, frame);
      for (let c = 1; c < o.cols; c++) { const s = s0 + o.w * c / o.cols; slab(s - 0.014, s + 0.014, h0, h1, 0.03, 0.05, frame); }
      for (let r = 1; r < o.rows; r++) { const h = h0 + o.h * r / o.rows; slab(s0, s1, h - 0.014, h + 0.014, 0.03, 0.05, frame); }
      if (o.shutters) { const sw = Math.min(0.45, o.w * 0.5), sm = std({ map: tex('louver'), color: o.shutters, roughness: 0.75 }); slab(s0 - fw - sw, s0 - fw, h0 - 0.04, h1 + 0.04, 0, 0.045, sm, true); slab(s1 + fw, s1 + fw + sw, h0 - 0.04, h1 + 0.04, 0, 0.045, sm, true); }
    } else {
      slab(s0 - fw, s1 + fw, h0, h1 + fw, 0, 0.05, frame);
      slab(s0, s1, h0, h1, 0.05, 0.075, o.kind === 'garage_door' ? std({ map: tex('panels'), color: o.color, roughness: 0.6 }) : flatMat(o.color, { roughness: 0.4 }));
    }
  }

  for (const c of spec.chimneys) {
    const mat = c.material === 'metal' ? flatMat('#8f949a', { roughness: 0.5, metalness: 0.4 }) : wallMat({ material: c.material === 'stone' ? 'stone' : 'brick', color: c.color });
    box(c.x, c.z, c.w, c.d, c.base_h, c.top_h - c.base_h, mat, true);
    if (c.material !== 'metal') box(c.x - 0.07, c.z - 0.07, c.w + 0.14, c.d + 0.14, c.top_h, 0.1, flatMat('#a9a59c'));
  }
  for (const b of spec.boxes) box(b.x, b.z, b.w, b.d, b.y, b.h, flatMat(b.color));

  // ---- the house number: numerals on the wall, or on a small plate
  const n = spec.number, mb = n && n.on === 'mailbox' ? spec.boxes[n.box] : null;
  // where it is drawn: `at(o)` the numerals' centre o metres out from the surface, `rot` the surface's turn
  const where = mb ? { at: (o) => P(mb.x + mb.w / 2, mb.y + mb.h * 0.7, mb.z - o), rot: 0, h: Math.min(n.h, mb.h * 0.5) } // on the mailbox's street-facing side
    : n && faceOf.get(n.mass) && faceOf.get(n.mass)[n.face] ? { at: (o) => { const f = faceOf.get(n.mass)[n.face]; return f.at(n.x + n.h * numberTexture(n).aspect / 2, n.y + n.h / 2, o); }, rot: faceOf.get(n.mass)[n.face].rot, h: n.h } : null;
  if (where) {
    const { texture, aspect } = numberTexture(n), w = where.h * aspect;
    const plate = add(new THREE.PlaneGeometry(w, where.h), new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.5 }), false);
    plate.position.copy(where.at(n.style === 'plaque' ? 0.035 : 0.02)); plate.rotation.y = where.rot;
    if (n.style === 'plaque') { const back = add(new THREE.BoxGeometry(w + 0.08, where.h + 0.08, 0.025), flatMat(n.plaque || '#2b2b2b', { roughness: 0.6 }), false); back.position.copy(where.at(0.015)); back.rotation.y = where.rot; }
  }

  // ---- the yard: what stands between the building and the street. Simple shapes, lit and shadowed like the house.
  if (yard) for (const y of spec.yard || []) {
    const leaf = (color) => flatMat(color, { roughness: 0.95, flatShading: true });
    if (y.kind === 'tree') {
      const crown = y.h - y.trunk_h, r = Math.min(0.45, Math.max(0.06, y.h * 0.028)), bark = flatMat('#5a4a3c', { roughness: 1 });
      const trunk = add(new THREE.CylinderGeometry(r * 0.75, r, y.trunk_h + crown * 0.35, 7), bark); trunk.position.copy(P(y.x, (y.trunk_h + crown * 0.35) / 2, y.z));
      if (y.leaves === 'bare') { // a bare tree: its main limbs, and the haze of twigs as a wire sphere
        for (let i = 0; i < 6; i++) { // six limbs leaning out from the top of the trunk
          const L = crown * 0.75, a = i * Math.PI / 3 + 0.4, tilt = 0.55, dir = new THREE.Vector3(Math.sin(a) * Math.sin(tilt), Math.cos(tilt), Math.cos(a) * Math.sin(tilt));
          const limb = add(new THREE.CylinderGeometry(r * 0.25, r * 0.5, L, 5), bark);
          limb.position.copy(P(y.x, y.trunk_h, y.z)).addScaledVector(dir, L / 2); limb.quaternion.setFromUnitVectors(UP, dir);
        }
        const twigs = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: y.color, wireframe: true, transparent: true, opacity: 0.2, depthWrite: false }));
        twigs.position.copy(P(y.x, y.trunk_h + crown / 2, y.z)); twigs.scale.set(y.canopy / 2, crown / 2, y.canopy / 2); g.add(twigs);
      } else if (y.shape === 'conical') { const cone = add(new THREE.ConeGeometry(y.canopy / 2, crown, 9), leaf(y.color)); cone.position.copy(P(y.x, y.trunk_h + crown / 2, y.z)); }
      else { const ball = add(new THREE.IcosahedronGeometry(1, 1), leaf(y.color)); ball.position.copy(P(y.x, y.trunk_h + crown / 2, y.z)); ball.scale.set(y.canopy / 2, crown / 2, y.canopy / 2); }
    } else if (y.kind === 'shrub') { const s = add(new THREE.IcosahedronGeometry(1, 1), leaf(y.color)); s.position.copy(P(y.x + y.w / 2, y.h * 0.5, y.z + y.d / 2)); s.scale.set(y.w / 2, y.h * 0.55, y.d / 2); }
    else if (y.kind === 'hedge') box(y.x, y.z, y.w, y.d, 0, y.h, leaf(y.color));
    else if (y.kind === 'fence') { // runs from (x, z) along x or along z; posts, then rails, pickets, mesh or boards by style
      const alongX = y.along !== 'z', seg = (s, o, len, t, bottom, h, mat) => (alongX ? box(y.x + s, y.z + o - t / 2, len, t, bottom, h, mat) : box(y.x + o - t / 2, y.z + s, t, len, bottom, h, mat));
      const mat = flatMat(y.color, { roughness: 0.8 });
      for (let s = 0; s <= y.w + 0.01; s += Math.max(1.2, Math.min(2.6, y.w / Math.max(1, Math.round(y.w / 2.4))))) seg(Math.min(s, y.w - 0.1), 0, 0.1, 0.1, 0, y.h + 0.05, mat);
      if (y.style === 'solid') seg(0, 0, y.w, 0.04, 0, y.h, mat);
      else if (y.style === 'chainlink') { seg(0, 0, y.w, 0.03, y.h - 0.04, 0.04, mat); const mesh = seg(0, 0, y.w, 0.01, 0.05, y.h - 0.1, flatMat(y.color, { transparent: true, opacity: 0.32, roughness: 0.6 })); mesh.castShadow = false; }
      else {
        seg(0, 0, y.w, 0.04, y.h * 0.42, 0.08, mat); seg(0, 0, y.w, 0.04, y.h * 0.86, 0.08, mat);
        if (y.style === 'picket') { // one instanced slat every 16 cm
          const n = Math.max(1, Math.floor(y.w / 0.16)), slats = new THREE.InstancedMesh(new THREE.BoxGeometry(alongX ? 0.075 : 0.02, y.h * 0.92, alongX ? 0.02 : 0.075), mat, n), m4 = new THREE.Matrix4();
          for (let i = 0; i < n; i++) { const s = 0.08 + i * 0.16; m4.setPosition(alongX ? P(y.x + s, y.h * 0.46, y.z + 0.035) : P(y.x + 0.035, y.h * 0.46, y.z + s)); slats.setMatrixAt(i, m4); }
          slats.castShadow = true; slats.receiveShadow = true; g.add(slats);
        }
      }
    } else { // driveway, walk, bed, lawn: a flat patch just above the ground, layered so a walk shows over a lawn
      const lift = { lawn: 0.02, bed: 0.04, driveway: 0.05, walk: 0.06 }[y.kind] || 0.03;
      const patch = add(new THREE.PlaneGeometry(y.w, y.d), flatMat(y.color, { roughness: 1 }), false); patch.rotation.x = -Math.PI / 2; patch.position.copy(P(y.x + y.w / 2, lift, y.z + y.d / 2));
    }
  }

  const top = Math.max(...spec.masses.map((m) => Math.max(m.wall_h, m.roof.ridge_h || 0, m.roof.high_h || 0)), ...spec.chimneys.map((c) => c.top_h), 0);
  g.userData = { width: x1 - x0, depth: z1 - z0, height: top, center: { x: cx, z: cz } };
  return g;
}
