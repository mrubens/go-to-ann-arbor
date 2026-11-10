import * as THREE from 'three/webgpu';
import { uv, positionWorld, cameraPosition, fract, abs, min, float, smoothstep, mix, step, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, log } from '../lamp-game.js';
import { setOnTerrain, groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';

// Lamp: the town's baseball and softball diamonds (data/ball-diamonds.json, Assets/Tools/build-ball-diamonds.py, from
// OpenStreetMap's pitches): each laid out from its home plate toward second base. A full-size field (90 ft bases) has
// its grass infield inside the base paths and a skinned arc round the mound; a Little League or softball field (60 ft)
// is skinned all over; both have a dirt circle at home and on the mound, chalk foul lines and batter's boxes, white
// bases and a rubber, the outfield mowed in stripes, a tall chain-link backstop behind home, low fences down both
// lines with a team bench behind each, and an outfield fence where the field's deep enough (no light towers: the map's
// lit tags aren't reliable enough). The ground is one mesh laid on the ground's slope; the bases, benches and fences
// are instanced.
// `seats` lists the benches' places, for sitting later.

const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const flat = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };

// a chain-link panel, `w` long (local x, from its middle) and `h` tall, uv in metres
function panelGeometry(w, h) {
  const g = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * w, a.getY(i) * h);
  return g;
}
// its frame: the post at one end and the top rail
function frameGeometry(w, h) {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.032, 0.032, h + 0.05, 8).translate(-w / 2, (h + 0.05) / 2, 0),
    new THREE.CylinderGeometry(0.022, 0.022, w, 6).rotateZ(Math.PI / 2).translate(0, h, 0)
  ].map(flat));
}
// a team bench, 4.5 m long along local x: aluminium planks on steel legs, facing +z
function benchGeometry() {
  const p = [];
  for (let k = 0; k < 2; k++) p.push(new THREE.BoxGeometry(4.5, 0.035, 0.13).translate(0, 0.45, -0.07 + k * 0.15));
  for (let k = 0; k < 2; k++) p.push(new THREE.BoxGeometry(4.5, 0.12, 0.03).translate(0, 0.66 + k * 0.16, -0.2));
  for (const x of [-1.9, 0, 1.9]) {
    p.push(new THREE.BoxGeometry(0.05, 0.45, 0.05).translate(x, 0.225, 0.06));
    p.push(new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(x, 0.45, -0.22));
    p.push(new THREE.BoxGeometry(0.05, 0.04, 0.4).translate(x, 0.42, -0.06));
  }
  return mergeGeometries(p.map(flat));
}
function createBallDiamonds(group, data) {
  group.name = 'BallDiamonds';
  const D = data?.diamonds || [];
  const pos = [], col = [];
  const tmp = new THREE.Color();
  let hx = 0, hz = 0, fx = 0, fz = 1, rx = -1, rz = 0;
  // (a, b): a out toward second base, b toward first base's side
  const W = (a, b) => [hx + fx * a + rx * b, hz + fz * a + rz * b];
  const tri = (p0, p1, p2, y, hex) => {
    tmp.setHex(hex);
    // wound to face up, whichever way the frame turns
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const pts = cross < 0 ? [p0, p1, p2] : [p0, p2, p1];
    for (const p of pts) { pos.push(p[0], y, p[1]); col.push(tmp.r, tmp.g, tmp.b); }
  };
  // a polygon in the field's frame, as a fan (convex) or through the shape triangulator
  const poly = (ab, y, hex) => {
    const pts = ab.map(([a, b]) => new THREE.Vector2(a, b));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) tri(W(...ab[i]), W(...ab[j]), W(...ab[k]), y, hex);
  };
  const circle = (ca, cb, r, y, hex, n = 28) => {
    const ab = [];
    for (let k = 0; k < n; k++) ab.push([ca + Math.cos((k / n) * Math.PI * 2) * r, cb + Math.sin((k / n) * Math.PI * 2) * r]);
    poly(ab, y, hex);
  };
  const line = (a0, b0, a1, b1, y, w = 0.1, hex = 0xf4f3ee) => {
    const da = a1 - a0, db = b1 - b0, len = Math.hypot(da, db) || 1, na = (-db / len) * w / 2, nb = (da / len) * w / 2;
    const p = [W(a0 - na, b0 - nb), W(a1 - na, b1 - nb), W(a1 + na, b1 + nb), W(a0 + na, b0 + nb)];
    tri(p[0], p[1], p[2], y, hex); tri(p[0], p[2], p[3], y, hex);
  };
  const rect = (a0, a1, b0, b1, y) => { line(a0, b0, a1, b0, y, 0.08); line(a1, b0, a1, b1, y, 0.08); line(a1, b1, a0, b1, y, 0.08); line(a0, b1, a0, b0, y, 0.08); };

  const Y = LIFT.lawn;
  const C45 = Math.SQRT1_2;
  const placed = { bases: [], plates: [], rubbers: [], tall: [], low: [], benches: [] };
  const seats = [];
  for (let i = 0; i + 5 < D.length; i += 6) {
    const [x, z, h, depth, base] = D.slice(i, i + 6);
    hx = x; hz = z; fx = Math.sin(h); fz = Math.cos(h); rx = -Math.cos(h); rz = Math.sin(h);
    const s = base / 27.43, full = base > 20;
    const mound = full ? 18.44 : 14.02, arcR = full ? 29 : 15.5;
    // the outfield, mowed in stripes across it
    const ring = 4, seg = 18;
    for (let r = 0; r < depth; r += ring) {
      const r1 = Math.min(depth, r + ring);
      for (let k = 0; k < seg; k++) {
        const t0 = -Math.PI / 4 + (k / seg) * Math.PI / 2, t1 = -Math.PI / 4 + ((k + 1) / seg) * Math.PI / 2;
        const P = (rr, t) => [Math.cos(t) * rr, Math.sin(t) * rr];
        const m = P((r + r1) / 2, (t0 + t1) / 2), stripe = Math.floor((m[0] * C45 + m[1] * C45 + 400) / 4.5) & 1;
        const hex = stripe ? 0x5d9440 : 0x4f8436;
        const A = P(r, t0), B = P(r, t1), Cc = P(r1, t1), Dd = P(r1, t0);
        if (r > 0) tri(W(...A), W(...B), W(...Cc), Y + 0.006, hex);
        tri(W(...A), W(...Cc), W(...Dd), Y + 0.006, hex);
      }
    }
    // the skinned infield: from home out both lines to the arc round the mound, and the arc between them
    const cross = mound * C45 + Math.sqrt(Math.max(0, mound * mound * 0.5 - mound * mound + arcR * arcR));
    const ab = [[-0.6, 0], [cross * C45 - 0.6, cross * C45 + 0.6]];
    const e0 = Math.atan2(cross * C45 + 0.6, cross * C45 - 0.6 - mound);
    for (let k = 1; k < 24; k++) {
      const t = e0 - (k / 24) * e0 * 2;
      ab.push([mound + Math.cos(t) * arcR, Math.sin(t) * arcR]);
    }
    ab.push([cross * C45 - 0.6, -cross * C45 - 0.6]);
    const dirt = full ? 0xa8754a : 0xb07c50;
    poly(ab, Y + 0.011, dirt);
    if (full) {
      // the grass inside the base paths, a step in from them
      const g = base - 3.4, o = 1.7 * Math.SQRT2;
      poly([[o, 0], [o + g * C45, g * C45], [o + g * Math.SQRT2, 0], [o + g * C45, -g * C45]], Y + 0.015, 0x4f8a38);
      circle(mound, 0, 2.74, Y + 0.019, dirt, 24);
    } else {
      circle(mound, 0, 2.4, Y + 0.015, 0x9f6c44, 22);
    }
    circle(0, 0, 3.96 * Math.max(0.8, s), Y + 0.019, dirt, 30);
    // the chalk: foul lines out to the fence, the batter's boxes, the catcher's box
    const L = depth - 0.3;
    line(0.25, 0.25, L * C45, L * C45, Y + 0.023);
    line(0.25, -0.25, L * C45, -L * C45, Y + 0.023);
    const bw = 1.22, bl = 1.83 * Math.max(0.85, s);
    rect(-bl / 2, bl / 2, 0.45, 0.45 + bw, Y + 0.023);
    rect(-bl / 2, bl / 2, -0.45 - bw, -0.45, Y + 0.023);
    rect(-bl / 2 - 2.4, -bl / 2, -0.55, 0.55, Y + 0.023);
    // bases, home plate and the rubber
    for (const [a, b] of [[base * C45, base * C45], [base * Math.SQRT2, 0], [base * C45, -base * C45]]) {
      const [bx, bz] = W(a, b);
      placed.bases.push([bx, bz, h + Math.PI / 4]);
    }
    placed.plates.push([hx, hz, h]);
    const [mx, mz] = W(mound, 0);
    placed.rubbers.push([mx, mz, h]);

    // the backstop: a tall arc of chain link behind home
    const back = Math.max(5.5, 7.5 * s), span = 1.25, n = Math.ceil((back * span * 2) / 2.4);
    for (let k = 0; k < n; k++) {
      const t = Math.PI - span + ((k + 0.5) / n) * span * 2;
      const a = Math.cos(t) * back, b = Math.sin(t) * back, [px, pz] = W(a, b);
      // along the arc: the tangent in the frame (-sin t, cos t)
      const ta = -Math.sin(t), tb = Math.cos(t), tx = fx * ta + rx * tb, tz = fz * ta + rz * tb;
      placed.tall.push([px, pz, Math.atan2(-tz, tx)]);
    }
    const endL = [Math.cos(Math.PI - span) * back, Math.sin(Math.PI - span) * back];
    const endR = [Math.cos(Math.PI + span) * back, Math.sin(Math.PI + span) * back];
    // the low fences out from it down each line, parallel to the foul line, a team bench behind each
    for (const side of [1, -1]) {
      const [oa, ob] = side > 0 ? endL : endR;
      const da = C45, db = side * C45, na = -C45, nb = side * C45; // along the line, and out into foul ground
      const cnt = Math.ceil((base * 1.25 - (oa * da + ob * db)) / 2.4);
      const tx = fx * da + rx * db, tz = fz * da + rz * db, along = Math.atan2(-tz, tx);
      for (let k = 0; k < cnt; k++) {
        const u = (k + 0.5) * 2.4, [px, pz] = W(oa + da * u, ob + db * u);
        placed.low.push([px, pz, along]);
      }
      // the bench a couple of metres behind the fence, halfway down it, facing the field
      const u = cnt * 2.4 * 0.45, [bx, bz] = W(oa + da * u + na * 2.2, ob + db * u + nb * 2.2);
      const by = Math.atan2(-(fx * na + rx * nb), -(fz * na + rz * nb));
      placed.benches.push([bx, bz, by]);
      for (const sx of [-1.6, -0.55, 0.55, 1.6]) seats.push({ x: bx + Math.cos(by) * sx, z: bz - Math.sin(by) * sx, y: Y + 0.45, yaw: by, kind: 'bench', ground: true });
    }
    // the outfield fence, on a field deep enough to have one
    if (depth >= 55) {
      const m = Math.ceil((depth * Math.PI / 2) / 2.4);
      for (let k = 0; k < m; k++) {
        const t = -Math.PI / 4 + ((k + 0.5) / m) * Math.PI / 2;
        const [px, pz] = W(Math.cos(t) * depth, Math.sin(t) * depth);
        const ta = -Math.sin(t), tb = Math.cos(t), tx = fx * ta + rx * tb, tz = fz * ta + rz * tb;
        placed.low.push([px, pz, Math.atan2(-tz, tx)]);
      }
    }
  }

  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
    const field = new THREE.Mesh(g, mat);
    field.name = 'DiamondFields';
    field.receiveShadow = true;
    group.add(field);
  }

  // chain link: a diamond weave up close, fading to a grey haze far off as a fence does
  const linkMat = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a4, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  {
    const p = uv().mul(1 / 0.055);
    const ua = p.x.add(p.y), ub = p.x.sub(p.y);
    const wa = min(fract(ua), float(1).sub(fract(ua))), wb = min(fract(ub), float(1).sub(fract(ub)));
    const wire = float(1).sub(step(0.16, min(wa, wb)));
    const far = smoothstep(6, 30, positionWorld.distance(cameraPosition));
    linkMat.opacityNode = mix(wire.mul(0.9), float(0.32), far);
    linkMat.colorNode = vec3(0.62, 0.64, 0.66);
  }
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x8c9196, metalness: 0.7, roughness: 0.4 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f1ec, roughness: 0.7 });
  const alum = new THREE.MeshStandardNodeMaterial({ color: 0xb9bec2, metalness: 0.75, roughness: 0.35 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const inst = (geo, mat, list, y, cull, shadow = true) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, z, yaw], k) => { q.setFromAxisAngle(up, yaw); m.setMatrixAt(k, m4.compose(v.set(x, y, z), q, one)); });
    m.castShadow = shadow; m.receiveShadow = true;
    m.userData.cullDistance = cull;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  };
  const plate = new THREE.ExtrudeGeometry(new THREE.Shape([
    new THREE.Vector2(-0.216, 0), new THREE.Vector2(0.216, 0), new THREE.Vector2(0.216, 0.216), new THREE.Vector2(0, 0.432), new THREE.Vector2(-0.216, 0.216)
  ]), { depth: 0.03, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.03, 0.216);
  inst(new THREE.BoxGeometry(0.38, 0.09, 0.38).translate(0, 0.045, 0), white, placed.bases, Y + 0.01, 200);
  inst(plate, white, placed.plates, Y + 0.01, 160, false);
  inst(new THREE.BoxGeometry(0.61, 0.04, 0.15).translate(0, 0.02, 0), white, placed.rubbers, Y + 0.02, 160, false);
  inst(panelGeometry(2.4, 3.6), linkMat, placed.tall, Y, 260, false);
  inst(frameGeometry(2.4, 3.6), steel, placed.tall, Y, 260);
  inst(panelGeometry(2.4, 1.2), linkMat, placed.low, Y, 200, false);
  inst(frameGeometry(2.4, 1.2), steel, placed.low, Y, 200);
  inst(benchGeometry(), alum, placed.benches, Y, 200);

  // the chain link, its frames and the benches are solid: a thin turned box for each fence panel (the helicopter
  // passes over them), and one round each bench
  const colliders = [];
  const solid = (list, hx, hz, h, thin) => {
    for (const [x, z, yaw] of list) {
      const c = Math.cos(yaw), s = Math.sin(yaw), g = groundHeight(x, z);
      const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
      colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: g - 0.2, maxY: g + h,
        obb: { cx: x, cz: z, hx, hz, cs: c, sn: s }, ...(thin ? { thin: true } : {}) });
    }
  };
  solid(placed.tall, 1.2, 0.08, 3.6, true);
  solid(placed.low, 1.2, 0.08, 1.2, true);
  solid(placed.benches, 2.25, 0.3, 0.9, false);

  const lifted = setOnTerrain(group);
  log(`[ball diamonds] ${D.length / 6} diamonds, ${placed.tall.length + placed.low.length} fence panels, ${placed.benches.length} benches, ${pos.length / 9} ground triangles`);
  return Promise.resolve(lifted).then(() => ({ seats, colliders, count: D.length / 6 }));
}

async function buildBallDiamonds(group) {
  let data = null;
  try {
    data = JSON.parse(new TextDecoder().decode(await asset('data/ball-diamonds.json')));
  } catch (error) { log(`[ball diamonds] no diamond data: ${error}`); }
  return createBallDiamonds(group, data);
}

export { buildBallDiamonds };
