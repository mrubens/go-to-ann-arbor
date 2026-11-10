import * as THREE from 'three/webgpu';
import { log } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { GEO } from './city-geodata.js';
import { LIFT } from './ground-lifts.js';

// Lamp: what the city's Non-Motorized Routes (build-annarbor.py) put beside the paint (road-paint.js): white flex posts
// along a protected bike lane's buffer (one instanced mesh: thin, so a bike brushes past them and cars keep to their
// lanes), a low concrete curb where the lane is curb-separated, the wooden boardwalks a little over the ground (GEO.trails
// kind 3) and steps (kind 4) that are walked and ridden over (`top`, controllers.js rampTop), and small green BIKE ROUTE
// signs along the signed routes (GEO.bikeSigns).

const POST_EVERY = 6, LANE = 1.7, LANE2 = 3;
const DECK = 0.32, SURF = LIFT.lawn + 0.01; // a boardwalk's deck over the lawn; the lawn over the ground

// a line [x, z, x, z…] as a walk: the point and heading at a distance along it
function walker(flat) {
  const P = [];
  for (let i = 0; i + 1 < flat.length; i += 2) P.push([flat[i], flat[i + 1]]);
  const S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const len = S[S.length - 1];
  let i = 0;
  const at = (s) => {
    s = Math.max(0, Math.min(len, s));
    if (S[i] > s) i = 0;
    while (i + 2 < P.length && S[i + 1] < s) i++;
    const l = S[i + 1] - S[i] || 1, f = (s - S[i]) / l;
    const tx = (P[i + 1][0] - P[i][0]) / l, tz = (P[i + 1][1] - P[i][1]) / l;
    return { x: P[i][0] + (P[i + 1][0] - P[i][0]) * f, z: P[i][1] + (P[i + 1][1] - P[i][1]) * f, tx, tz };
  };
  return { len, at };
}

// a BIKE ROUTE sign's face: white on green with a bicycle over the words
function signTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#1d6b3a'; g.fillRect(0, 0, 128, 96);
  g.strokeStyle = '#f2f2ee'; g.lineWidth = 4; g.strokeRect(4, 4, 120, 88);
  g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.arc(46, 42, 11, 0, Math.PI * 2); g.arc(82, 42, 11, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(46, 42); g.lineTo(58, 26); g.lineTo(76, 26); g.lineTo(82, 42); g.moveTo(58, 26); g.lineTo(64, 42); g.lineTo(76, 26); g.stroke();
  g.fillStyle = '#f2f2ee'; g.font = 'bold 22px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('BIKE ROUTE', 64, 82);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// a boardwalk's planks: across it every 15 cm, a dark gap between
function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  for (let k = 0; k < 4; k++) {
    const shade = 130 + ((k * 37) % 4) * 9;
    g.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.76)}, ${Math.round(shade * 0.55)})`;
    g.fillRect(0, k * 16, 64, 15);
    g.fillStyle = '#3a2c1f'; g.fillRect(0, k * 16 + 15, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The curbs and boardwalks as one mesh per CHUNK square (each triangle by its first corner), all of a kind sharing one
// material, each hidden beyond `cull` metres by the scene's culling (`cullDistance`) and by the frustum, rather than one
// town-wide mesh drawn from anywhere. The normals are worked out over the whole first, so no seam shows between squares.
const CHUNK = 300;
function chunked(group, name, { pos, idx, uv = null }, mat, cull, setup) {
  const whole = new THREE.BufferGeometry();
  whole.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  whole.setIndex(idx);
  whole.computeVertexNormals();
  const nor = whole.attributes.normal.array;
  const cells = new Map();
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const f = idx[t];
    const key = Math.floor(pos[f * 3] / CHUNK) * 100003 + Math.floor(pos[f * 3 + 2] / CHUNK);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { at: new Map(), pos: [], nor: [], uv: [], idx: [] }));
    for (let j = 0; j < 3; j++) {
      const v = idx[t + j];
      let n = c.at.get(v);
      if (n === undefined) {
        n = c.pos.length / 3;
        c.at.set(v, n);
        c.pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        c.nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        if (uv) c.uv.push(uv[v * 2], uv[v * 2 + 1]);
      }
      c.idx.push(n);
    }
  }
  for (const c of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
    g.setIndex(c.idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.userData.cullDistance = cull;
    setup(mesh);
    group.add(mesh);
  }
  whole.dispose();
}

function buildBikeRoutes(group, network) {
  group.name = 'BikeRoutes';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);

  // --- Flex posts and curbs along the protected lanes' buffers, from the road network's streets as the paint has them
  const posts = [];
  // what a car does to them, as in life: a flex post folds flat under the bumper with a slap and springs back up a
  // moment later; a concrete curb jolts the wheel that rides up onto it and scrubs off speed
  const HIT_CELL = 8, hitKey = (x, z) => Math.floor(x / HIT_CELL) * 100003 + Math.floor(z / HIT_CELL);
  const postCells = new Map(), curbCells = new Map(), bent = new Set();
  let postMesh = null, bend = null, bendX = null, bendZ = null, bendHeld = null;
  const wheelOn = [false, false, false, false];
  const curb = { pos: [], idx: [] };
  const curbStrip = (e, o, s0, s1) => { // a low curb 0.3 m wide and 15 cm high, in 6 m pieces so it follows the ground
    const n = Math.max(1, Math.ceil((s1 - s0) / 6));
    const first = curb.pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n;
      for (const [d, h] of [[-0.15, 0], [-0.12, 0.15], [0.12, 0.15], [0.15, 0]]) {
        const x = e.sx + e.dx * s + e.rx * (o + d), z = e.sz + e.dz * s + e.rz * (o + d);
        curb.pos.push(x, groundHeight(x, z) + h, z);
      }
    }
    for (let k = 0; k < n; k++) {
      const a = first + k * 4, b = a + 4;
      for (let j = 0; j < 3; j++) curb.idx.push(a + j, a + j + 1, b + j + 1, a + j, b + j + 1, b + j);
    }
  };
  const roads = new Map();
  for (const e of network?.paintEdges || []) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e); else roads.set(key, [e]);
  }
  const buffer = (e, curbO, width, bk) => {
    const sgn = Math.sign(curbO), lane = bk & 512 ? LANE2 : LANE;
    if (width < lane + 0.4 || e.len < 10) return;
    const o = curbO - sgn * (lane + (width - lane) / 2);
    if (bk & 64) curbStrip(e, o, 3, e.len - 3);
    else if (bk & 32) {
      const n = Math.floor((e.len - 6) / POST_EVERY);
      for (let k = 0; k <= n; k++) {
        const s = 3 + (e.len - 6) * (n ? k / n : 0.5);
        const x = e.sx + e.dx * s + e.rx * o, z = e.sz + e.dz * s + e.rz * o;
        posts.push(x, groundHeight(x, z) + LIFT.paint, z);
      }
    }
  };
  for (const [e, back] of roads.values()) {
    if (e.divided) continue;
    const pR = e.parkR || 0, pL = e.parkL || 0;
    if (e.bikeR && e.bk & 96) buffer(e, e.half - pR, e.bikeR, e.bk);
    if (!back && e.bikeL && e.bk & 96) buffer(e, -e.half + pL, e.bikeL, e.bk);
    if (back && back.bikeR && back.bk & 96) buffer(e, -e.half + pL, back.bikeR, back.bk);
  }
  if (posts.length) {
    // white, with a reflective band near the top: an open six-sided tube, 12 triangles
    const geo = new THREE.CylinderGeometry(0.04, 0.045, 0.95, 6, 1, true).translate(0, 0.475, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardNodeMaterial({ color: 0xf1f0ea, roughness: 0.55 }), posts.length / 3);
    for (let k = 0; k < posts.length / 3; k++) {
      v.set(posts[k * 3], posts[k * 3 + 1], posts[k * 3 + 2]);
      mesh.setMatrixAt(k, m4.compose(v, q.identity(), sc));
    }
    mesh.name = 'BikeLanePosts';
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.cullDistance = 260;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    postMesh = mesh;
    for (let k = 0; k < posts.length / 3; k++) {
      const key = hitKey(posts[k * 3], posts[k * 3 + 2]);
      if (postCells.has(key)) postCells.get(key).push(k); else postCells.set(key, [k]);
    }
    bend = new Float32Array(posts.length / 3); bendX = new Float32Array(posts.length / 3); bendZ = new Float32Array(posts.length / 3);
    bendHeld = new Float32Array(posts.length / 3);
  }
  // the curbs' pieces, for a wheel that rides up onto one
  for (let k = 0; k + 4 < curb.pos.length / 3; k += 4) {
    const ax = (curb.pos[k * 3] + curb.pos[k * 3 + 9]) / 2, az = (curb.pos[k * 3 + 2] + curb.pos[k * 3 + 11]) / 2;
    const bx = (curb.pos[k * 3 + 12] + curb.pos[k * 3 + 21]) / 2, bz = (curb.pos[k * 3 + 14] + curb.pos[k * 3 + 23]) / 2;
    if (Math.hypot(bx - ax, bz - az) > 6.5) continue; // the gap between one strip and the next
    const seg = { ax, az, bx, bz };
    for (const key of new Set([hitKey(ax, az), hitKey(bx, bz), hitKey((ax + bx) / 2, (az + bz) / 2)])) {
      if (curbCells.has(key)) curbCells.get(key).push(seg); else curbCells.set(key, [seg]);
    }
  }
  if (curb.idx.length) {
    chunked(group, 'BikeLaneCurbs', curb, new THREE.MeshStandardNodeMaterial({ color: 0xb9b5ac, roughness: 0.9, side: THREE.DoubleSide }),
      350, (mesh) => { mesh.receiveShadow = true; });
  }

  // --- Boardwalks and steps along the trails
  const deck = { pos: [], uv: [], idx: [] }, side = { pos: [], idx: [] };
  const steps = [];
  const buckets = new Map(), bkey = (x, z) => Math.floor(x / 16) * 100003 + Math.floor(z / 16);
  const walks = [];
  for (const t of GEO.trails || []) {
    if ((t[0] !== 3 && t[0] !== 4) || t.length < 6) continue;
    const w = walker(t.slice(2)), half = t[1] / 2;
    if (w.len < 2) continue;
    if (t[0] === 4) { // steps: a concrete tread every 35 cm, each up to the ground at its front edge
      for (let s = 0.2; s < w.len - 0.1; s += 0.35) {
        const p = w.at(s);
        steps.push({ x: p.x, z: p.z, y: groundHeight(p.x, p.z) + SURF, h: Math.atan2(p.tx, p.tz), w: t[1] });
      }
      continue;
    }
    // the deck, up DECK over the lawn with a ramp of 2 m at each end
    const n = Math.max(1, Math.ceil(w.len / 2));
    const first = deck.pos.length / 3, sfirst = side.pos.length / 3;
    const walk = { pts: [], half };
    for (let k = 0; k <= n; k++) {
      const s = w.len * k / n, p = w.at(s);
      const lift = SURF + DECK * Math.min(1, s / 2, (w.len - s) / 2);
      for (const sg of [-1, 1]) {
        const x = p.x - p.tz * half * sg, z = p.z + p.tx * half * sg;
        const y = groundHeight(x, z) + lift;
        deck.pos.push(x, y, z);
        deck.uv.push(sg * half / 0.6, s / 0.6);
        side.pos.push(x, y, z, x, groundHeight(x, z), z);
      }
      walk.pts.push({ x: p.x, z: p.z, lift, tx: p.tx, tz: p.tz });
    }
    for (let k = 0; k < n; k++) {
      const a = first + k * 2, b = a + 2;
      deck.idx.push(a, b, a + 1, a + 1, b, b + 1);
      const sa = sfirst + k * 4, sb = sa + 4;
      side.idx.push(sa, sb, sa + 1, sa + 1, sb, sb + 1); // the left face
      side.idx.push(sa + 2, sa + 3, sb + 2, sa + 3, sb + 3, sb + 2); // the right face
    }
    walks.push(walk);
    for (let k = 0; k + 1 < walk.pts.length; k++) {
      const a = walk.pts[k], b = walk.pts[k + 1];
      const seg = { a, b, half };
      for (const p of [a, b]) for (const dx of [-2.5, 2.5]) for (const dz of [-2.5, 2.5]) {
        const key = bkey(p.x + dx, p.z + dz);
        if (!buckets.has(key)) buckets.set(key, new Set());
        buckets.get(key).add(seg);
      }
    }
  }
  if (deck.idx.length) {
    chunked(group, 'Boardwalks', deck, new THREE.MeshStandardNodeMaterial({ map: plankTexture(), roughness: 0.9, side: THREE.DoubleSide }),
      400, (mesh) => { mesh.receiveShadow = mesh.castShadow = true; });
    chunked(group, 'BoardwalkSides', side, new THREE.MeshStandardNodeMaterial({ color: 0x5e4630, roughness: 0.95, side: THREE.DoubleSide }),
      400, (mesh) => { mesh.receiveShadow = true; });
  }
  if (steps.length) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 0.36).translate(0, 0.02, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0xb3afa6, roughness: 0.9 }), steps.length);
    steps.forEach((st, k) => {
      v.set(st.x, st.y, st.z); q.setFromAxisAngle(up, st.h); sc.set(st.w, 1, 1);
      mesh.setMatrixAt(k, m4.compose(v, q, sc));
    });
    sc.set(1, 1, 1);
    mesh.name = 'TrailSteps';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 200;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // --- BIKE ROUTE signs: a green plate on a thin gray post at the curb, facing the riders coming
  const S = GEO.bikeSigns || [];
  const count = Math.floor(S.length / 3);
  if (count) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6, 1, true).translate(0, 1.25, 0),
      new THREE.MeshStandardNodeMaterial({ color: 0x8d9094, roughness: 0.5, metalness: 0.6 }), count);
    const plate = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 0.45).translate(0, 2.2, 0.04),
      new THREE.MeshStandardNodeMaterial({ map: signTexture(), roughness: 0.6, side: THREE.DoubleSide }), count);
    for (let k = 0; k < count; k++) {
      const x = S[k * 3], z = S[k * 3 + 1];
      v.set(x, groundHeight(x, z) + LIFT.slab, z);
      q.setFromAxisAngle(up, S[k * 3 + 2]);
      m4.compose(v, q, sc);
      pole.setMatrixAt(k, m4);
      plate.setMatrixAt(k, m4);
    }
    for (const [m, name] of [[pole, 'BikeRoutePoles'], [plate, 'BikeRouteSigns']]) {
      m.name = name;
      m.castShadow = false; m.receiveShadow = true;
      m.userData.cullDistance = 220;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      group.add(m);
    }
  }

  const vertices = posts.length / 3 * 12 + curb.pos.length / 3 + deck.pos.length / 3 + side.pos.length / 3 + steps.length * 24 + count * 16;
  log(`[bike routes] ${posts.length / 3} flex posts, ${(curb.pos.length / 12) | 0} curb stations, ${walks.length} boardwalks, ${steps.length} steps, ${count} bike route signs; about ${vertices} vertices`);
  const axis = new THREE.Vector3();
  const near = (x, z, cells, each) => {
    const cx = Math.floor(x / HIT_CELL), cz = Math.floor(z / HIT_CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = cells.get((cx + i) * 100003 + cz + j);
      if (list) for (const it of list) each(it);
    }
  };
  // a car (half its width and length) over the posts and curbs this frame; `feel(kind, x, z, strength)` sounds and
  // shakes it. Folded posts spring back whatever drives
  function update(dt, car, feel) {
    if (car && postMesh) {
      const sh = Math.sin(car.heading), ch = Math.cos(car.heading), x = car.position.x, z = car.position.z;
      const hw = car.bike ? 0.35 : 0.95, hl = car.bike ? 1.0 : 2.3, sp = car.speed || 0;
      if (Math.abs(sp) > 0.6) {
        near(x, z, postCells, (k) => {
          const dx = posts[k * 3] - x, dz = posts[k * 3 + 2] - z;
          const along = dx * sh + dz * ch, across = dx * ch - dz * sh;
          if (Math.abs(along) > hl || Math.abs(across) > hw + 0.05) return;
          bendHeld[k] = 0.5;
          if (bend[k] > 0.5) return;
          // folded the way the car is going
          const dir = Math.sign(sp);
          bendX[k] = sh * dir; bendZ[k] = ch * dir;
          bend[k] = 1;
          bent.add(k);
          car.speed *= car.bike ? 0.9 : 0.985;
          feel('post', posts[k * 3], posts[k * 3 + 2], Math.min(1, 0.25 + Math.abs(sp) / 25));
        });
      }
      // each wheel that rides up onto a curb, once as it crosses
      for (let w = 0; w < 4; w++) {
        if (car.bike && (w & 1)) { wheelOn[w] = false; continue; }
        const side = car.bike ? 0 : (w & 1 ? 0.8 : -0.8), end = w & 2 ? -hl * 0.6 : hl * 0.6;
        const wx = x + sh * end + ch * side, wz = z + ch * end - sh * side;
        let on = false;
        near(wx, wz, curbCells, (c) => {
          if (on) return;
          const ex = c.bx - c.ax, ez = c.bz - c.az, l2 = ex * ex + ez * ez || 1;
          const f = Math.max(0, Math.min(1, ((wx - c.ax) * ex + (wz - c.az) * ez) / l2));
          if (Math.hypot(wx - c.ax - ex * f, wz - c.az - ez * f) < 0.2) on = true;
        });
        if (on && !wheelOn[w] && Math.abs(sp) > 0.8) {
          const hard = Math.min(1, Math.abs(car.speed) / 18);
          car.speed *= car.bike ? 0.8 : 0.95 - hard * 0.08;
          car.heaveVel = (car.heaveVel || 0) + 0.5 + hard * 1.2;
          car.pitchVel = (car.pitchVel || 0) + (w & 2 ? -1 : 1) * (0.4 + hard);
          feel('curb', wx, wz, 0.35 + hard * 0.65);
        }
        wheelOn[w] = on;
      }
    } else wheelOn.fill(false);
    if (!bent.size) return;
    for (const k of bent) {
      if (bendHeld[k] > 0) bendHeld[k] -= dt; // kept down while the car's still over it
      else bend[k] = Math.max(0, bend[k] - dt * 1.6);
      const t = bend[k];
      // folded flat, then up again with a little wobble at the end
      const ang = t > 0 ? 1.45 * Math.min(1, t * 1.15) : 0;
      const wob = t > 0 && t < 0.25 ? Math.sin(t * 50) * 0.08 * (t / 0.25) : 0;
      axis.set(bendZ[k], 0, -bendX[k]);
      if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
      q.setFromAxisAngle(axis.normalize(), ang - wob);
      v.set(posts[k * 3], posts[k * 3 + 1], posts[k * 3 + 2]);
      place(postMesh, k, m4.compose(v, q, sc));
      if (!t) bent.delete(k);
    }
    q.identity();
  }
  // Sets post i where it's drawn: the scene's culling moves a big instanced mesh's copies into chunks of their own
  // (scene-culling.js `movedTo`), and its shadow's stand-in (`shadowCopy`), as knockdowns.js does for a felled pole
  function place(mesh, i, matrix) {
    const moved = mesh.userData.movedTo?.[i];
    if (moved) place(moved[0], moved[1], matrix);
    else {
      mesh.setMatrixAt(i, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    const shadow = mesh.userData.shadowCopy?.[i];
    const proxy = shadow?.[0].mesh;
    if (proxy) {
      proxy.setMatrixAt(shadow[1], matrix);
      proxy.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    update,
    // on a boardwalk's deck at (x, z): its top, else -Infinity
    top(x, z) {
      const set = buckets.get(bkey(x, z));
      if (!set) return -Infinity;
      let top = -Infinity;
      for (const { a, b, half } of set) {
        const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
        const f = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const px = a.x + ex * f, pz = a.z + ez * f;
        if ((x - px) ** 2 + (z - pz) ** 2 > half * half) continue;
        top = Math.max(top, groundHeight(x, z) + a.lift + (b.lift - a.lift) * f);
      }
      return top;
    }
  };
}

export { buildBikeRoutes };
