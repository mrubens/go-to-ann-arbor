// Draws a building from its attributes (src/attributes.js). Nothing here looks at a photo: every wall, roof and
// opening comes from an attribute value, a size in metres, or a default. That is the point of the exercise, since
// whatever this cannot draw from the attribute list is an attribute still missing.
//
// Plan coordinates: u metres along the street front (left to right), d metres back from the front wall, h metres up.

import * as THREE from 'three';
import { WALL, ROOF, ACCENT } from './palette.js';

// ---------------------------------------------------------------- textures (UVs are in metres)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvasTex(w, h, draw, ru = 1, rv = ru) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(ru, rv);
  return t;
}
const grey = (v) => `rgb(${v},${v},${v})`;
// All wall and roof textures are grey values, tinted by the material's color.
const TEX = {};
function tex(name) {
  if (TEX[name]) return TEX[name];
  const r = rng(name.length * 97 + 5);
  if (name === 'brick') TEX[name] = canvasTex(1024, 1024, (g, W, H) => { // running bond, 2.4 m square
    g.fillStyle = grey(205); g.fillRect(0, 0, W, H);
    const rows = 32, cols = 12, bh = H / rows, bw = W / cols;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const t = r(), v = t < 0.08 ? 95 + r() * 30 : t < 0.2 ? 255 : 185 + r() * 60;
      g.fillStyle = grey(Math.round(v)); g.fillRect(i * bw + (j % 2) * bw / 2 + 1.5, j * bh + 1.5, bw - 3, bh - 3);
    }
  }, 1 / 2.4);
  else if (name === 'lap_siding') TEX[name] = canvasTex(32, 256, (g, W) => { // four laps per 0.46 m
    for (let k = 0; k < 4; k++) {
      const y = k * 64, gr = g.createLinearGradient(0, y, 0, y + 64);
      gr.addColorStop(0, grey(143)); gr.addColorStop(0.09, grey(217)); gr.addColorStop(0.2, grey(255)); gr.addColorStop(1, grey(237));
      g.fillStyle = gr; g.fillRect(0, y, W, 64);
    }
  }, 1, 1 / 0.46);
  else if (name === 'stucco') TEX[name] = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = grey(240); g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5000; i++) { g.fillStyle = grey(215 + Math.floor(r() * 40)); g.fillRect(r() * W, r() * H, 2, 2); }
  }, 1 / 1.5);
  else if (name === 'stone') TEX[name] = canvasTex(512, 512, (g, W, H) => { // coursed rubble, 2 m square
    g.fillStyle = grey(150); g.fillRect(0, 0, W, H);
    for (let j = 0; j < 8; j++) { let x = -r() * 60; while (x < W) { const w = 50 + r() * 90; g.fillStyle = grey(190 + Math.floor(r() * 65)); g.fillRect(x + 2, j * 64 + 2, w - 4, 60); x += w; } }
  }, 1 / 2);
  else if (name === 'shingle') TEX[name] = canvasTex(512, 512, (g, W, H) => { // rows of tabs, 1.2 m square
    for (let j = 0; j < 8; j++) {
      let x = -r() * 120;
      while (x < W) { const w = 100 + r() * 60; g.fillStyle = grey(190 + Math.floor(r() * 65)); g.fillRect(x, j * 64, w - 2, 60); x += w; }
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, j * 64 + 60, W, 4);
    }
  }, 1 / 1.2);
  else if (name === 'louver') TEX[name] = canvasTex(16, 128, (g, W, H) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, y + 5, W, 3); }
  }, 1, 6);
  else if (name === 'glass') {
    TEX[name] = canvasTex(64, 128, (g, W, H) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#9fb3c2'); gr.addColorStop(0.45, '#55687a'); gr.addColorStop(1, '#1e2730');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    });
    TEX[name].wrapS = TEX[name].wrapT = THREE.ClampToEdgeWrapping;
  } else if (name === 'panels') TEX[name] = canvasTex(64, 256, (g, W, H) => { // a sectional garage door
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 64) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, W, 4); }
  }, 1, 1);
  return TEX[name];
}
const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...o });
const MATS = new Map();
function wallMat(material, colorName) {
  const key = material + '/' + colorName;
  if (!MATS.has(key)) MATS.set(key, std({ map: tex(material), color: WALL[colorName] || WALL.white }));
  return MATS.get(key);
}

// ---------------------------------------------------------------- geometry kit
function clip(pts, axis, lo, hi) { // keep the part of a polygon with lo <= p[axis] <= hi
  const cut = (poly, sign, v) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = sign * (a[axis] - v) >= -1e-9, ib = sign * (b[axis] - v) >= -1e-9;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (v - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  let p = cut(pts, 1, lo);
  if (p.length >= 3) p = cut(p, -1, hi);
  p = p.filter((q, i) => { const n = p[(i + 1) % p.length]; return Math.hypot(q[0] - n[0], q[1] - n[1]) > 1e-6; });
  if (p.length < 3) return null;
  let area = 0;
  p.forEach((q, i) => { const n = p[(i + 1) % p.length]; area += q[0] * n[1] - n[0] * q[1]; });
  return Math.abs(area) > 1e-4 ? p : null;
}

function kit(cu, cz) {
  const g = new THREE.Group();
  const W = (u, h, d) => new THREE.Vector3(u - cu, h, cz - d);
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };
  function finish(pos, uv, idx, want, mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const n = geo.attributes.normal, i0 = idx[0];
    if (n.getX(i0) * want.x + n.getY(i0) * want.y + n.getZ(i0) * want.z < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      geo.setIndex(idx); geo.computeVertexNormals();
    }
    return add(geo, mat);
  }
  function poly(pts, map3, mat, want) { // a flat polygon in its own plane's metres
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
    if (!tris.length) return null;
    const pos = [], uv = [], idx = [];
    pts.forEach((p) => { const v = map3(p[0], p[1]); pos.push(v.x, v.y, v.z); uv.push(p[0], p[1]); });
    tris.forEach((t) => idx.push(t[0], t[1], t[2]));
    return finish(pos, uv, idx, want, mat);
  }
  const Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0);
  const front = (pts, d, mat) => poly(pts, (u, h) => W(u, h, d), mat, Z);
  const back = (pts, d, mat) => poly(pts, (u, h) => W(u, h, d), mat, NZ);
  const side = (pts, u, mat, dir) => poly(pts, (d, h) => W(u, h, d), mat, new THREE.Vector3(dir, 0, 0)); // pts in (d, h)
  function face(verts, uvs, mat, want = UP) { // a convex face from world-space corners
    const pos = [], uv = [], idx = [];
    verts.forEach((v, i) => { pos.push(v.x, v.y, v.z); uv.push(uvs[i][0], uvs[i][1]); });
    for (let i = 1; i < verts.length - 1; i++) idx.push(0, i, i + 1);
    return finish(pos, uv, idx, want, mat);
  }
  // A roof slope between two edges that run front to back (roof) or left to right (roofU).
  function roof(uA, hA, uB, hB, d0, d1, mat) {
    const L = Math.hypot(uB - uA, hB - hA);
    return face([W(uA, hA, d0), W(uA, hA, d1), W(uB, hB, d1), W(uB, hB, d0)], [[d0, 0], [d1, 0], [d1, L], [d0, L]], mat);
  }
  function roofU(dA, hA, dB, hB, u0, u1, mat) {
    const L = Math.hypot(dB - dA, hB - hA);
    return face([W(u0, hA, dA), W(u1, hA, dA), W(u1, hB, dB), W(u0, hB, dB)], [[u0, 0], [u1, 0], [u1, L], [u0, L]], mat);
  }
  function box(u0, u1, h0, h1, d0, d1, mat, metres = false) {
    const w = u1 - u0, h = h1 - h0, d = d1 - d0, geo = new THREE.BoxGeometry(w, h, d);
    if (metres) {
      const a = geo.attributes.uv;
      for (let i = 0; i < a.count; i++) { const f = Math.floor(i / 4); a.setXY(i, a.getX(i) * (f < 2 ? d : w), a.getY(i) * (f === 2 || f === 3 ? d : h)); }
    }
    const m = add(geo, mat); m.position.copy(W((u0 + u1) / 2, (h0 + h1) / 2, (d0 + d1) / 2)); return m;
  }
  function board(uA, hA, uB, hB, d, mat, th = 0.16) { // a trim board along a sloping roof edge
    const L = Math.hypot(uB - uA, hB - hA), m = add(new THREE.BoxGeometry(L + 0.04, th, 0.07), mat);
    m.position.copy(W((uA + uB) / 2, (hA + hB) / 2 - th * 0.35, d)); m.rotation.z = Math.atan2(hB - hA, uB - uA); return m;
  }
  return { g, W, add, front, back, side, face, roof, roofU, box, board };
}

// ---------------------------------------------------------------- the building
/**
 * @param {object} a     attributes, complete (src/resolve.js fills defaults)
 * @param {object} [o]
 * @param {{front_m?: number, depth_m?: number}} [o.size]  real sizes in metres, when known
 * @param {object} [o.boxes]  where the door and chimney sit across the front, as fractions (src/pipeline.js)
 * @returns {THREE.Group} the building, centred on its footprint, standing on y = 0
 */
export function buildBuilding(a, { size = {}, boxes = {}, parts = null, layout = null } = {}) {
  const lv = +a['building:levels'] || 1, rl = +a['roof:levels'] || 0;
  const garage = a['of:garage'];
  // The main block is the outline's biggest rectangle when the outline is known (src/footprint.js `decompose`);
  // everything is drawn in its coordinates, and the other parts hang off it
  const mainR = parts && parts[0], extras = parts ? parts.slice(1).map((r) => ({ ...r, u0: r.u0 - mainR.u0, u1: r.u1 - mainR.u0, d0: r.d0 - mainR.d0, d1: r.d1 - mainR.d0 })) : [];
  const Wd = mainR ? mainR.u1 - mainR.u0 : size.front_m || (lv >= 2 ? 9 : 10.5) + (garage === 'attached_front' ? 2.5 : 0);
  const D = mainR ? mainR.d1 - mainR.d0 : size.depth_m || (lv >= 2 ? 8.5 : 9.5);
  const fit = mainR && mainR.fit; // what LiDAR measured over the main block: eave and ridge heights
  const OV = 0.3, wallH = fit ? Math.min(14, Math.max(2.3, fit.eave)) : lv * 2.75 + (rl ? 0.45 : 0);
  const SH = fit && lv >= 2 ? Math.max(2.4, wallH / lv) : 2.75;
  const shape = a['roof:shape'] === 'gambrel' ? 'gabled' : a['roof:shape']; // a gambrel is drawn as a gable for now
  const gableFront = shape === 'gabled' && a['of:roof:facing'] === 'gable';
  let pitch = { low: 20, medium: 33, steep: 46 }[a['of:roof:pitch']] || 33;
  if (rl && pitch < 30) pitch = 30; // rooms in the roof need the height
  const ovh = lv >= 2 ? a['of:upper_overhang'] : 'none', P = ovh !== 'none' ? 0.8 : 0;
  const span = gableFront ? Wd / 2 : shape === 'gabled' ? (D + P) / 2 : Math.min(D + P + 2 * OV, Wd + 2 * OV) / 2;
  // The slope: measured when LiDAR has the ridge. Otherwise the asked pitch, flattened where a deep or wide outline
  // would carry its ridge absurdly high (real houses that size break the roof up instead)
  const tan = fit && fit.ridge > wallH + 0.3 ? (fit.ridge - wallH) / span : Math.min(Math.tan(pitch * Math.PI / 180), (pitch >= 40 ? 4.4 : 3.5) / span);
  const oR = gableFront && P ? [0, Wd] : ovh === 'full' ? [0, Wd] : ovh === 'left' ? [0, Wd * 0.62] : ovh === 'right' ? [Wd * 0.38, Wd] : null;

  const k = mainR ? kit(size.front_m / 2 - mainR.u0, size.depth_m / 2 - mainR.d0) : kit(Wd / 2, D / 2);
  const main = wallMat(a['building:material'], a['building:colour']);
  const wall2 = a['of:wall2:material'] !== 'none' ? wallMat(a['of:wall2:material'], a['of:wall2:colour']) : null;
  const where = a['of:wall2:where'];
  const trim = std({ color: ACCENT[a['of:trim:colour']] || ACCENT.white, roughness: 0.7 });
  const roofMat = std({ map: tex('shingle'), color: ROOF[a['roof:colour']] || ROOF.charcoal, roughness: 0.95 });
  const glass = std({ map: tex('glass'), roughness: 0.15, metalness: 0.1 });
  const concrete = std({ color: 0xaaa69d });
  const siding = ['lap_siding', 'shingle'].includes(a['building:material']);

  // Which material a wall surface wears at each height, given where the second material goes.
  function bands(surface) {
    if (!wall2) return [[0, 99, main]];
    if (where === 'sides') return [[0, 99, surface === 'front' ? main : wall2]];
    if (where === 'upper_storey') return lv >= 2 ? [[0, SH, main], [SH, 99, wall2]] : [[0, 99, main]];
    if (where === 'lower_band') return [[0, 0.95, wall2], [0.95, 99, main]];
    return [[0, wallH, main], [wallH, 99, surface === 'front' ? wall2 : main]]; // front_gable: the gable's triangle
  }
  function surface(pts, place, name) {
    if (!pts) return;
    for (const [h0, h1, m] of bands(name)) { const c = clip(pts, 1, h0, h1); if (c) place(c, m); }
  }

  // ---- roof heights
  const flat = shape === 'flat', top = wallH + (flat ? 0.35 : 0);
  const d0 = -P - OV, d1 = D + OV, dR = (D - P) / 2;
  let hR; // ridge height
  if (gableFront) hR = wallH + (Wd / 2) * tan;
  else if (shape === 'gabled') hR = wallH + ((D + P) / 2) * tan;
  else if (shape === 'hipped') hR = wallH + 0.04 + Math.min((d1 - d0) / 2, (Wd + 2 * OV) / 2) * tan;
  else hR = top;
  const roofAt = (d) => gableFront || flat ? hR : Math.min(hR, wallH + (d + P) * tan); // the front slope's height

  // ---- walls
  const frontPts = gableFront ? [[0, 0], [Wd, 0], [Wd, wallH], [Wd / 2, hR], [0, wallH]] : [[0, 0], [Wd, 0], [Wd, top], [0, top]];
  if (!oR) surface(frontPts, (c, m) => k.front(c, 0, m), 'front');
  else {
    surface(clip(frontPts, 1, 0, SH), (c, m) => k.front(c, 0, m), 'front');
    const upper = clip(frontPts, 1, SH, 99);
    surface(clip(upper, 0, oR[0], oR[1]), (c, m) => k.front(c, -P, m), 'front');
    if (oR[0] > 0) { surface(clip(upper, 0, 0, oR[0]), (c, m) => k.front(c, 0, m), 'front'); k.side([[-P, SH], [0, SH], [0, top], [-P, top]], oR[0], bands('front').at(-1)[2], -1); }
    if (oR[1] < Wd) { surface(clip(upper, 0, oR[1], Wd), (c, m) => k.front(c, 0, m), 'front'); k.side([[-P, SH], [0, SH], [0, top], [-P, top]], oR[1], bands('front').at(-1)[2], 1); }
    k.box(oR[0], oR[1], SH - 0.06, SH, -P, 0, trim); k.box(oR[0] - 0.02, oR[1] + 0.02, SH - 0.1, SH + 0.04, -P - 0.03, -P, trim);
  }
  const sidePts = (over) => {
    const apex = shape === 'gabled' && !gableFront;
    const p = [[0, 0], [D, 0], [D, top]];
    if (apex) p.push([dR, hR]);
    if (over) p.push([-P, top], [-P, SH], [0, SH]);
    else p.push([0, apex ? top + P * tan : top]);
    return p;
  };
  surface(sidePts(oR && oR[0] === 0), (c, m) => k.side(c, 0, m, -1), 'side');
  surface(sidePts(oR && oR[1] === Wd), (c, m) => k.side(c, Wd, m, 1), 'side');
  surface(gableFront ? frontPts : [[0, 0], [Wd, 0], [Wd, top], [0, top]], (c, m) => k.back(c, D, m), 'back');
  if (siding) { k.box(-0.02, 0.08, 0, Math.min(SH, wallH), -0.03, 0, trim); k.box(Wd - 0.08, Wd + 0.02, 0, Math.min(SH, wallH), -0.03, 0, trim); }

  // ---- roof
  if (gableFront) {
    const e = wallH - OV * tan;
    k.roof(-OV, e, Wd / 2, hR, d0, d1, roofMat); k.roof(Wd / 2, hR, Wd + OV, e, d0, d1, roofMat);
    k.board(-OV, e, Wd / 2, hR, -P - 0.06, trim); k.board(Wd / 2, hR, Wd + OV, e, -P - 0.06, trim);
  } else if (shape === 'gabled') {
    const e = wallH - OV * tan;
    k.roofU(d0, e, dR, hR, -OV, Wd + OV, roofMat); k.roofU(dR, hR, d1, e, -OV, Wd + OV, roofMat);
    k.box(-OV, Wd + OV, e - 0.16, e + 0.02, d0 - 0.03, d0, trim);
  } else if (shape === 'hipped') {
    const u0 = -OV, u1 = Wd + OV, hE = wallH + 0.04, hd = (d1 - d0) / 2, hu = (u1 - u0) / 2, half = Math.min(hd, hu), sl = Math.hypot(half, half * tan);
    const A = k.W(u0, hE, d0), B = k.W(u1, hE, d0), C = k.W(u1, hE, d1), E = k.W(u0, hE, d1);
    const r1 = hd <= hu ? k.W(u0 + half, hR, d0 + half) : k.W(u0 + half, hR, d0 + half), r2 = hd <= hu ? k.W(u1 - half, hR, d0 + half) : k.W(u0 + half, hR, d1 - half);
    if (hd <= hu) { // ridge runs left to right
      k.face([A, B, r2, r1], [[u0, 0], [u1, 0], [u1 - half, sl], [u0 + half, sl]], roofMat);
      k.face([C, E, r1, r2], [[u1, 0], [u0, 0], [u0 + half, sl], [u1 - half, sl]], roofMat);
      k.face([E, A, r1], [[d1, 0], [d0, 0], [d0 + half, sl]], roofMat); k.face([B, C, r2], [[d0, 0], [d1, 0], [d0 + half, sl]], roofMat);
    } else { // ridge runs front to back
      k.face([A, B, r1], [[u0, 0], [u1, 0], [u0 + half, sl]], roofMat); k.face([C, E, r2], [[u1, 0], [u0, 0], [u0 + half, sl]], roofMat);
      k.face([E, A, r1, r2], [[d1, 0], [d0, 0], [d0 + half, sl], [d1 - half, sl]], roofMat);
      k.face([B, C, r2, r1], [[d0, 0], [d1, 0], [d1 - half, sl], [d0 + half, sl]], roofMat);
    }
    k.box(u0, u1, hE - 0.2, hE + 0.02, d0 - 0.04, d0, trim); k.box(u0, u1, hE - 0.2, hE + 0.02, d1, d1 + 0.04, trim);
    k.box(u0 - 0.04, u0, hE - 0.2, hE + 0.02, d0, d1, trim); k.box(u1, u1 + 0.04, hE - 0.2, hE + 0.02, d0, d1, trim);
    k.box(u0, u1, hE - 0.07, hE - 0.03, d0, d1, trim);
  } else {
    k.box(-0.06, Wd + 0.06, top, top + 0.08, -P - 0.06, D + 0.06, trim); k.box(0.15, Wd - 0.15, top - 0.3, top - 0.25, -P + 0.15, D - 0.15, roofMat);
  }

  // ---- what takes up room on the front, floor by floor
  const lowerBusy = [], upperBusy = [];
  const free = (list, u0, u1) => !list.some(([b0, b1]) => u0 < b1 && u1 > b0);

  const shut = a['of:shutters'] === 'yes' ? std({ map: tex('louver'), color: ACCENT[a['of:shutters:colour']] || ACCENT.black, roughness: 0.75 }) : null;
  // ---- the parts of the outline that stick out of the main block
  // A block with a lean-to roof against the main one: a side wing, a rear addition, a shallow front projection.
  function leanTo(r, garageDoor = false) {
    const w = r.side === 'left' || r.side === 'right' ? r.u1 - r.u0 : r.d1 - r.d0; // how far it reaches from the main block
    const wh = Math.max(2.1, r.fit ? Math.min(r.fit.eave, wallH + 0.4) : Math.min(2.5, wallH - 0.4));
    const hi = Math.max(wh + 0.25, Math.min(r.fit ? r.fit.ridge : wh + w * 0.34, wallH + 1.2));
    const m = wall2 && where === 'sides' && r.side !== 'front' ? wall2 : main, c = (r.u0 + r.u1) / 2;
    if (r.side === 'left' || r.side === 'right') {
      const L = r.side === 'left', uo = L ? r.u0 : r.u1, ui = L ? r.u1 : r.u0;
      const pts = L ? [[uo, 0], [ui, 0], [ui, hi], [uo, wh]] : [[ui, 0], [uo, 0], [uo, wh], [ui, hi]];
      k.front(pts, r.d0, m); k.back(pts, r.d1, m); k.side([[r.d0, 0], [r.d1, 0], [r.d1, wh], [r.d0, wh]], uo, m, L ? -1 : 1);
      if (L) k.roof(uo - 0.25, wh - 0.09, ui, hi, r.d0 - 0.2, r.d1 + 0.2, roofMat); else k.roof(ui, hi, uo + 0.25, wh - 0.09, r.d0 - 0.2, r.d1 + 0.2, roofMat);
      k.board(L ? uo - 0.25 : ui, L ? wh - 0.09 : hi, L ? ui : uo + 0.25, L ? hi : wh - 0.09, r.d0 - 0.06, trim);
      if (garageDoor && r.u1 - r.u0 >= 3) { k.box(c - 1.45, c + 1.45, 0, 2.2, r.d0 - 0.05, r.d0, trim); k.box(c - 1.35, c + 1.35, 0.02, 2.12, r.d0 - 0.07, r.d0 - 0.05, std({ map: tex('panels'), color: trim.color, roughness: 0.6 })); }
      else if (r.u1 - r.u0 >= 2.2) win(c - Math.min(0.75, (r.u1 - r.u0) / 2 - 0.5), 0.9, c + Math.min(0.75, (r.u1 - r.u0) / 2 - 0.5), Math.min(2.2, wh - 0.25), r.d0, 2, 1);
    } else {
      const F = r.side === 'front', dout = F ? r.d0 : r.d1, din = F ? r.d1 : r.d0;
      const flank = F ? [[dout, 0], [din, 0], [din, hi], [dout, wh]] : [[din, 0], [dout, 0], [dout, wh], [din, hi]];
      (F ? k.front : k.back)([[r.u0, 0], [r.u1, 0], [r.u1, wh], [r.u0, wh]], dout, m);
      k.side(flank, r.u0, m, -1); k.side(flank, r.u1, m, 1);
      if (F) k.roofU(dout - 0.25, wh - 0.09, din, hi, r.u0 - 0.2, r.u1 + 0.2, roofMat); else k.roofU(din, hi, dout + 0.25, wh - 0.09, r.u0 - 0.2, r.u1 + 0.2, roofMat);
      if (F) k.box(r.u0 - 0.2, r.u1 + 0.2, wh - 0.24, wh - 0.07, dout - 0.28, dout - 0.25, trim);
    }
  }
  // A front gable bay: a smaller gable standing out from the main roof. Its peak may stand above the main ridge.
  let bay = null;
  function gableBay(c, bw, pb, hbAsked) {
    const tb = Math.tan(Math.max(pitch, 38) * Math.PI / 180);
    const rise = hbAsked ? Math.max(0.6, hbAsked - wallH) : Math.min((bw / 2) * tb, hR - wallH - 0.25), hb = wallH + rise;
    // How far back its ridge runs. Against an eave-facing roof, until that roof's slope takes over. Against a main
    // gable that also faces the street, to the main wall, or a little past it when the bay's peak stands higher
    const mainAt = gableFront ? wallH + (Wd / 2 - Math.abs(c - Wd / 2)) * tan : hR;
    const dS = gableFront ? (hb <= mainAt + 0.05 ? 0 : 1.5) : Math.min(rise, Math.max(0.3, hR - wallH)) / tan;
    const pts = [[c - bw / 2, 0], [c + bw / 2, 0], [c + bw / 2, wallH], [c, hb], [c - bw / 2, wallH]];
    const bayMat = wall2 && where === 'front_gable' ? wall2 : null;
    if (bayMat) k.front(pts, -pb, bayMat); else surface(pts, (q, m) => k.front(q, -pb, m), 'front');
    const cheek = bayMat || main;
    k.side([[-pb, 0], [0, 0], [0, wallH], [-pb, wallH]], c - bw / 2, cheek, -1); k.side([[-pb, 0], [0, 0], [0, wallH], [-pb, wallH]], c + bw / 2, cheek, 1);
    const e = 0.15, he = wallH - e * (rise / (bw / 2)), dF = -pb - OV, L = Math.hypot(bw / 2 + e, hb - he);
    k.face([k.W(c - bw / 2 - e, he, dF), k.W(c, hb, dF), k.W(c, hb, dS), k.W(c - bw / 2 - e, he, 0)], [[dF, 0], [dF, L], [dS, L], [0, 0]], roofMat);
    k.face([k.W(c + bw / 2 + e, he, dF), k.W(c + bw / 2 + e, he, 0), k.W(c, hb, dS), k.W(c, hb, dF)], [[dF, 0], [0, 0], [dS, L], [dF, L]], roofMat);
    if (hb > mainAt + 0.05) { const x = (hb - mainAt) * (bw / 2) / rise; k.back([[c - x, mainAt], [c + x, mainAt], [c, hb]], dS, cheek); } // the peak's back, above the main roof
    k.board(c - bw / 2 - e, he, c, hb, -pb - 0.06, trim); k.board(c, hb, c + bw / 2 + e, he, -pb - 0.06, trim);
    bay = { c, bw, pb, hb };
    lowerBusy.push([c - bw / 2 - 0.2, c + bw / 2 + 0.2]); upperBusy.push([c - bw / 2 - 0.2, c + bw / 2 + 0.2]);
  }
  const fronts = extras.filter((r) => r.side === 'front').sort((p, q) => (q.u1 - q.u0) * (q.d1 - q.d0) - (p.u1 - p.u0) * (p.d1 - p.d0));
  const sides = extras.filter((r) => r.side === 'left' || r.side === 'right');
  // A shallow front part on a house with a roofed porch is that porch, not a room
  const porchPart = ['partial', 'full'].includes(a['of:porch']) && fronts.find((r) => r.d1 - r.d0 <= 3.2) || null;
  for (const r of fronts) {
    if (r === porchPart) continue;
    const w = r.u1 - r.u0, gabled = r.fit ? r.fit.form === 'ridge_d' || r.fit.form === 'hip' : a['of:front_gable'] !== 'none' || w >= 3;
    if (!bay && gabled && w >= 2.6 && !flat && !oR) gableBay((r.u0 + r.u1) / 2, w, -r.d0, r.fit ? r.fit.ridge : null);
    else leanTo(r);
  }
  const garageSide = garage === 'attached_side' && sides.slice().sort((p, q) => (q.u1 - q.u0) - (p.u1 - p.u0))[0];
  for (const r of extras) if (r.side !== 'front') leanTo(r, r === garageSide);
  // With no outline to go by, a front gable the photo showed is drawn where the photo put it
  if (!fronts.length && a['of:front_gable'] !== 'none' && !gableFront && !flat && !oR) gableBay(Wd * { left: 0.27, center: 0.5, right: 0.73 }[a['of:front_gable']], Math.min(Wd * 0.42, 5), 0.5, null);

  // Door and garage door
  const doorPos = a['of:door:position'];
  let doorU = doorPos === 'none' ? null : Wd * (boxes.door ? (boxes.door.left + boxes.door.right) / 2 : { left: 0.22, center: 0.5, right: 0.78 }[doorPos]);
  if (garage === 'attached_front') {
    const gw = Wd >= 12 ? 4.9 : 2.7, left = doorU !== null && doorU > Wd / 2, g0 = left ? 0.5 : Wd - 0.5 - gw;
    k.box(g0 - 0.08, g0 + gw + 0.08, 0, 2.2, -0.05, 0, trim); k.box(g0, g0 + gw, 0.02, 2.12, -0.07, -0.05, std({ map: tex('panels'), color: trim.color, roughness: 0.6 }), false);
    lowerBusy.push([g0 - 0.3, g0 + gw + 0.3]);
    if (doorU !== null && doorU > g0 - 0.9 && doorU < g0 + gw + 0.9) doorU = left ? g0 + gw + 1.1 : g0 - 1.1;
  }
  if (doorU !== null && bay && Math.abs(doorU - bay.c) < bay.bw / 2 + 0.7) doorU = bay.c < Wd / 2 ? bay.c + bay.bw / 2 + 1.0 : bay.c - bay.bw / 2 - 1.0;
  if (doorU !== null) {
    doorU = Math.min(Wd - 0.8, Math.max(0.8, doorU));
    k.box(doorU - 0.56, doorU + 0.56, 0.18, 2.3, -0.05, 0, trim);
    k.box(doorU - 0.46, doorU + 0.46, 0.2, 2.2, -0.075, -0.05, std({ color: ACCENT[a['of:door:colour']] || ACCENT.white, roughness: 0.4 }));
    lowerBusy.push([doorU - 0.95, doorU + 0.95]);
    if (a['of:porch'] === 'stoop') { k.box(doorU - 0.8, doorU + 0.8, 0, 0.18, -1.0, 0, concrete); k.box(doorU - 0.8, doorU + 0.8, 0, 0.09, -1.3, -1.0, concrete); }
  }
  const porch = a['of:porch'];
  if ((porch === 'partial' || porch === 'full') && (doorU !== null || porchPart)) {
    const mid = doorU !== null ? doorU : (porchPart.u0 + porchPart.u1) / 2;
    const p0 = porchPart ? porchPart.u0 : porch === 'full' ? 0 : Math.max(0, mid - 1.6), p1 = porchPart ? porchPart.u1 : porch === 'full' ? Wd : Math.min(Wd, mid + 1.6);
    const dp = porchPart ? -porchPart.d0 : porch === 'full' ? 2.0 : 1.6, step = Math.min(p1 - 0.7, Math.max(p0 + 0.7, mid));
    k.box(p0, p1, 0, 0.18, -dp, 0, concrete); k.box(step - 0.7, step + 0.7, 0, 0.09, -dp - 0.3, -dp, concrete);
    if (!oR) {
      const n = Math.max(2, Math.round((p1 - p0) / 2.6) + 1);
      for (let i = 0; i < n; i++) { const u = p0 + 0.1 + (p1 - p0 - 0.2) * i / (n - 1); k.box(u - 0.07, u + 0.07, 0.18, 2.38, -dp + 0.05, -dp + 0.19, trim); }
      k.roofU(-dp - 0.2, 2.42, 0, 2.42 + (dp + 0.2) * 0.26, p0 - 0.15, p1 + 0.15, roofMat);
      k.box(p0 - 0.15, p1 + 0.15, 2.3, 2.44, -dp - 0.2, -dp - 0.14, trim);
    }
  }

  // Chimney
  const chim = a['of:chimney'];
  if (chim !== 'none') {
    const cm = a['of:chimney:material'];
    const mat = cm === 'stone' ? std({ map: tex('stone'), color: 0xa39a8c }) : cm === 'metal' ? std({ color: 0x8f949a, roughness: 0.5, metalness: 0.4 })
      : wallMat('brick', a['building:material'] === 'brick' ? a['building:colour'] : 'orange_red');
    if (chim === 'front') {
      // A front chimney goes through the peak of a street-facing gable when there is one (the main roof's, or a
      // front gable bay's): there it sits nearly flush with the wall and windows may sit in it. Otherwise it is a
      // stack standing proud of the wall, and windows keep clear.
      const peak = gableFront ? { c: Wd / 2, h: hR, d: -P, w: Math.min(1.9, Wd * 0.3) } : bay && !boxes.chimney ? { c: bay.c, h: bay.hb, d: -bay.pb, w: Math.min(1.9, bay.bw * 0.4) } : null;
      const cw = peak ? peak.w : 1.3, cu = peak ? peak.c : boxes.chimney ? Wd * (boxes.chimney.left + boxes.chimney.right) / 2 : (doorU !== null && doorU < Wd / 2 ? Wd * 0.72 : Wd * 0.28);
      const dep = peak ? 0.012 : 0.45, df = peak ? peak.d : -P, cTop = (peak ? peak.h : hR) + 0.8;
      k.box(cu - cw / 2, cu + cw / 2, 0, cTop, df - dep, df + 0.6, mat, true); k.box(cu - cw / 2 - 0.08, cu + cw / 2 + 0.08, cTop, cTop + 0.1, df - dep - 0.07, df + 0.67, concrete);
      if (!peak) { lowerBusy.push([cu - cw / 2 - 0.3, cu + cw / 2 + 0.3]); upperBusy.push([cu - cw / 2 - 0.3, cu + cw / 2 + 0.3]); }
    } else if (chim === 'side') {
      const cTop = Math.max(hR, wallH + 1.2) + 0.5;
      k.box(Wd, Wd + 0.5, 0, cTop, D * 0.42, D * 0.42 + 1.1, mat, true); k.box(Wd - 0.07, Wd + 0.57, cTop, cTop + 0.1, D * 0.42 - 0.07, D * 0.42 + 1.17, concrete);
    } else {
      const u = Wd * 0.64, d = gableFront ? D * 0.45 : dR;
      k.box(u - 0.4, u + 0.4, hR - 0.9, hR + 0.8, d - 0.4, d + 0.4, mat, true); k.box(u - 0.47, u + 0.47, hR + 0.8, hR + 0.9, d - 0.47, d + 0.47, concrete);
    }
  }

  // Windows, with shutters where the house has them
  function win(u0, h0, u1, h1, d, cols, rows) {
    const fw = 0.07, b = 0.014;
    const gl = k.add(new THREE.PlaneGeometry(u1 - u0, h1 - h0), glass, false); gl.position.copy(k.W((u0 + u1) / 2, (h0 + h1) / 2, d - 0.02));
    k.box(u0 - fw, u1 + fw, h1, h1 + fw, d - 0.07, d, trim); k.box(u0 - fw, u1 + fw, h0 - fw * 1.3, h0, d - 0.09, d, trim);
    k.box(u0 - fw, u0, h0, h1, d - 0.07, d, trim); k.box(u1, u1 + fw, h0, h1, d - 0.07, d, trim);
    for (let c = 1; c < cols; c++) { const x = u0 + (u1 - u0) * c / cols; k.box(x - b, x + b, h0, h1, d - 0.045, d - 0.02, trim); }
    for (let r = 1; r < rows; r++) { const y = h0 + (h1 - h0) * r / rows; k.box(u0, u1, y - b, y + b, d - 0.045, d - 0.02, trim); }
    if (shut) { const sw = Math.min(0.42, (u1 - u0) * 0.45); k.box(u0 - fw - sw, u0 - fw, h0 - 0.04, h1 + 0.04, d - 0.045, d, shut, true); k.box(u1 + fw, u1 + fw + sw, h0 - 0.04, h1 + 0.04, d - 0.045, d, shut, true); }
  }
  const nL = +a['of:windows:lower'] || 0, nU = +a['of:windows:upper'] || 0;
  const cellsL = nL + (doorU !== null ? 1 : 0);
  let doorCell = -1;
  if (doorU !== null && cellsL) doorCell = Math.min(cellsL - 1, Math.max(0, Math.floor(doorU / Wd * cellsL)));
  for (let i = 0; i < cellsL; i++) {
    if (i === doorCell) continue;
    const c = (i + 0.5) / cellsL * Wd, w = nL === 1 ? Math.min(1.8, Wd * 0.22) : Math.min(1.15, Wd / cellsL * 0.48);
    if (free(lowerBusy, c - w / 2 - 0.1, c + w / 2 + 0.1)) win(c - w / 2, 0.9, c + w / 2, 2.25, 0, nL === 1 ? 2 : 2, nL === 1 ? 1 : 2);
  }
  if (bay) { win(bay.c - 0.6, 0.9, bay.c + 0.6, 2.25, -bay.pb, 2, 2); if (lv >= 2 || rl) win(bay.c - 0.5, (lv >= 2 ? SH : wallH - 0.45) + 0.85, bay.c + 0.5, (lv >= 2 ? SH : wallH - 0.45) + 2.05, -bay.pb, 2, 2); }
  if (lv >= 2 && SH + 2.1 <= wallH + 0.25) {
    for (let i = 0; i < nU; i++) {
      const c = (i + 0.5) / nU * Wd, w = Math.min(1.0, Wd / nU * 0.45);
      if (free(upperBusy, c - w / 2 - 0.1, c + w / 2 + 0.1)) win(c - w / 2, SH + 0.85, c + w / 2, SH + 2.1, oR && c >= oR[0] && c <= oR[1] ? -P : 0, 2, 2);
    }
  } else if (gableFront && nU) { // a storey and a half: the upper windows sit in the gable
    const h0 = SH + 0.5, h1 = Math.min(h0 + 1.6, hR - 0.9), reach = (hR - h1) / tan - 0.25, n = Math.min(nU, reach > 1.5 ? 2 : 1), w = Math.min(0.95, reach * (n === 1 ? 1.4 : 0.7));
    if (h1 - h0 > 0.6 && w > 0.4) for (let i = 0; i < n; i++) { const c = Wd / 2 + (n === 1 ? 0 : (i ? 1 : -1) * Math.min(reach - w / 2, 1.1)); win(c - w / 2, h0, c + w / 2, h1, -P, n === 1 ? 4 : 2, n === 1 ? 6 : 3); }
  }

  // Dormers on the street-facing slope
  const nD = +a['of:dormers'] || 0;
  if (nD && !gableFront && !flat) {
    const dw = 1.5, df = 1.0, wallUp = 1.2, peak = 0.45;
    for (let i = 0; i < nD; i++) {
      const c = (i + 0.5) / nD * Wd;
      if (bay && Math.abs(c - bay.c) < bay.bw / 2 + dw / 2) continue;
      const h0 = roofAt(df), h1 = h0 + wallUp, db = df + wallUp / tan, dr = df + (wallUp + peak) / tan;
      if (h1 + peak > hR - 0.1) continue;
      k.front([[c - dw / 2, h0], [c + dw / 2, h0], [c + dw / 2, h1], [c, h1 + peak], [c - dw / 2, h1]], df, main);
      k.side([[df, h0], [db, h1], [df, h1]], c - dw / 2, main, -1); k.side([[df, h0], [db, h1], [df, h1]], c + dw / 2, main, 1);
      const L = Math.hypot(dw / 2 + 0.1, peak), e = h1 - 0.1 * peak / (dw / 2);
      k.face([k.W(c - dw / 2 - 0.1, e, df - 0.15), k.W(c, h1 + peak, df - 0.15), k.W(c, h1 + peak, dr), k.W(c - dw / 2 - 0.1, e, db)], [[0, 0], [0, L], [dr, L], [db, 0]], roofMat);
      k.face([k.W(c + dw / 2 + 0.1, e, df - 0.15), k.W(c + dw / 2 + 0.1, e, db), k.W(c, h1 + peak, dr), k.W(c, h1 + peak, df - 0.15)], [[0, 0], [db, 0], [dr, L], [0, L]], roofMat);
      win(c - 0.42, h0 + 0.22, c + 0.42, h1 - 0.08, df, 2, 2);
    }
  }

  // A lower wing on one side (the garage, when it is attached at the side)
  const wingSide = sides.length ? null : a['of:wing'] !== 'none' ? a['of:wing'] : garage === 'attached_side' ? (doorU !== null && doorU > Wd / 2 ? 'left' : 'right') : null;
  if (wingSide) {
    const ww = garage === 'attached_side' ? 3.9 : 3.2, wf = lv >= 2 ? 1.0 : 0.6, wd = D * 0.62, wh = 2.5, up = ww * 0.36;
    const wm = wall2 && where === 'sides' ? wall2 : main, L = wingSide === 'left';
    const uo = L ? -ww : Wd + ww, ui = L ? 0 : Wd; // outer and inner edges
    const pts = L ? [[uo, 0], [ui, 0], [ui, wh + up], [uo, wh]] : [[ui, 0], [uo, 0], [uo, wh], [ui, wh + up]];
    k.front(pts, wf, wm); k.back(pts, wf + wd, wm);
    k.side([[wf, 0], [wf + wd, 0], [wf + wd, wh], [wf, wh]], uo, wm, L ? -1 : 1);
    if (L) k.roof(uo - 0.25, wh - 0.09, ui, wh + up, wf - 0.2, wf + wd + 0.2, roofMat); else k.roof(ui, wh + up, uo + 0.25, wh - 0.09, wf - 0.2, wf + wd + 0.2, roofMat);
    k.board(L ? uo - 0.25 : ui, L ? wh - 0.09 : wh + up, L ? ui : uo + 0.25, L ? wh + up : wh - 0.09, wf - 0.06, trim);
    const c = (uo + ui) / 2;
    if (garage === 'attached_side') { k.box(c - 1.45, c + 1.45, 0, 2.2, wf - 0.05, wf, trim); k.box(c - 1.35, c + 1.35, 0.02, 2.12, wf - 0.07, wf - 0.05, std({ map: tex('panels'), color: trim.color, roughness: 0.6 })); }
    else win(c - 0.75, 0.9, c + 0.75, 2.2, wf, 2, 1);
  }

  k.g.userData = { width: Wd, depth: D, height: Math.max(hR, top) };
  return k.g;
}

export { tex, std };
