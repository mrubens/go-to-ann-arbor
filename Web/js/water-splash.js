import * as THREE from 'three/webgpu';
import { riverDepth, waterLevel } from './terrain.js';
import { random } from '../lamp-game.js';
import { float, vec3, uv, time, sin, positionLocal, normalView, positionViewDirection, dot, abs, smoothstep, clamp, attribute, uniform, mx_noise_float } from 'three/tsl';

// The player's car, sport bike or bicycle meeting the river (main.js): going in, a crown of water thrown up and out
// ahead of it, a curtain of drops breaking off its rim and raining back, a haze of spray and foam rings spreading
// over the surface; driving through, a bow wave peeling off each side and a wake of foam; coming out, the water
// pouring off the body and streaming back down. All of it scaled by how fast and how big the thing is.

const MAX_DROPS = 3200, MAX_MIST = 220, MAX_RINGS = 48, MAX_CROWNS = 3;

function createWaterSplash(scene) {
  for (const old of scene.children.filter((c) => c.name === 'WaterSplash')) scene.remove(old);
  const group = new THREE.Group();
  group.name = 'WaterSplash';
  scene.add(group);

  // drops: as the hydrant's (hydrant-spray.js), hair-fine streaks, glassy, clear through the middle and catching the
  // light only at their edges, so a curtain of them reads as water thrown up rather than beads
  const dropMat = new THREE.MeshStandardNodeMaterial({ color: 0xe8f2fa, roughness: 0.1, metalness: 0, transparent: true,
    depthWrite: false });
  dropMat.opacityNode = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(1.5).mul(0.4).add(0.14);
  dropMat.emissive = new THREE.Color(0x161b1f);
  const drops = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5, 1), dropMat, MAX_DROPS);
  drops.frustumCulled = false;
  drops.count = 0;

  // spray: soft puffs facing the camera
  const mistMat = new THREE.MeshStandardNodeMaterial({ color: 0xf0f5f8, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  {
    const d = uv().sub(0.5).length().mul(2);
    mistMat.opacityNode = smoothstep(1, 0, d).pow(2).mul(attribute('fade', 'float')).mul(0.3);
    mistMat.emissive = new THREE.Color(0x181c1f);
  }
  const mistGeo = new THREE.PlaneGeometry(1, 1);
  const mistFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MIST), 1);
  mistFade.setUsage(THREE.DynamicDrawUsage);
  mistGeo.setAttribute('fade', mistFade);
  const mist = new THREE.InstancedMesh(mistGeo, mistMat, MAX_MIST);
  mist.frustumCulled = false;
  mist.count = 0;

  // foam: a broken white ring lying on the water, spreading and thinning as it goes
  const ringMat = new THREE.MeshStandardNodeMaterial({ color: 0xf4f7f8, roughness: 0.9, metalness: 0, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const c = uv().sub(0.5).mul(2), r = c.length(), fadeA = attribute('fade', 'float');
    const band = smoothstep(0.55, 0.85, r).mul(smoothstep(1.0, 0.88, r));
    const inner = smoothstep(0.85, 0.2, r).mul(0.22); // the churned water inside it
    const lace = mx_noise_float(vec3(c.x.mul(7), c.y.mul(7), fadeA.mul(3))).mul(0.5).add(0.5);
    ringMat.opacityNode = clamp(band.add(inner).mul(smoothstep(0.35, 0.7, lace)).mul(fadeA).mul(0.85), 0, 0.85);
    ringMat.emissive = new THREE.Color(0x202426);
  }
  const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS), 1);
  ringFade.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('fade', ringFade);
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
  rings.frustumCulled = false;
  rings.count = 0;
  rings.renderOrder = 2;
  group.add(drops, mist, rings);

  // the crown: a glassy sheet of water thrown up in a ring around where it went in, flaring out as it rises and
  // tearing into drops at its rim; a few at once, each with its own fade
  const crownGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 10, true).translate(0, 0.5, 0);
  const crowns = Array.from({ length: MAX_CROWNS }, () => {
    const fadeU = uniform(0), seedU = uniform(0);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xdce8ef, roughness: 0.04, metalness: 0, transparent: true,
      depthWrite: false, side: THREE.DoubleSide });
    const y = uv().y, ang = uv().x.mul(Math.PI * 2);
    const flare = float(1).add(y.mul(y).mul(0.9));
    mat.positionNode = vec3(positionLocal.x.mul(flare), positionLocal.y, positionLocal.z.mul(flare));
    const tear = mx_noise_float(vec3(sin(ang).mul(3), y.mul(4), seedU.add(time.mul(0.6)))).mul(0.5).add(0.5);
    const streak = sin(ang.mul(23).add(seedU.mul(9))).mul(0.5).add(0.5);
    const edge = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(1.4);
    const rim = smoothstep(0.55 + 0.0, 1.0, y).mul(tear.mul(1.6)); // the top breaks up
    mat.opacityNode = clamp(edge.mul(0.6).add(0.14).add(streak.mul(0.12)).mul(smoothstep(1, 0.0, rim.add(y.mul(0.35))))
      .mul(fadeU).mul(0.75), 0, 0.6);
    mat.emissiveNode = vec3(0.08, 0.095, 0.105).mul(streak.mul(0.4).add(0.6));
    const mesh = new THREE.Mesh(crownGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
    return { mesh, fadeU, seedU, age: 0, life: 0, x: 0, y: 0, z: 0, r: 1, h: 1, grow: 1 };
  });
  let crownCursor = 0;

  const D = Array.from({ length: MAX_DROPS }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, age: 0, floor: 0 }));
  const M = Array.from({ length: MAX_MIST }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, age: 0 }));
  const R = Array.from({ length: MAX_RINGS }, () => ({ life: 0, x: 0, y: 0, z: 0, r: 0, grow: 0, age: 0, a: 0 }));
  let dropCursor = 0, mistCursor = 0, ringCursor = 0, live = false; // live: something is in the air, so update runs
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), flat = new THREE.Quaternion();
  const drop = () => { live = true; const d = D[dropCursor]; dropCursor = (dropCursor + 1) % MAX_DROPS; return d; };
  const puff = (x, y, z, r, life, vx = 0, vy = 0.3, vz = 0) => {
    live = true;
    const s = M[mistCursor]; mistCursor = (mistCursor + 1) % MAX_MIST;
    Object.assign(s, { x, y, z, vx, vy, vz, r, life, age: 0 });
  };
  const ring = (x, y, z, r, grow, life, a = 1) => {
    live = true;
    const g = R[ringCursor]; ringCursor = (ringCursor + 1) % MAX_RINGS;
    Object.assign(g, { x, y: y + 0.03, z, r, grow, life, age: 0, a });
  };

  // going in: v the vehicle's velocity, size its half width (bike about 0.4, car about 1)
  function plunge(x, level, z, vx, vy, vz, size) {
    const sp = Math.hypot(vx, vz), fall = Math.max(0, -vy);
    const s = Math.min(1.5, (sp + fall * 1.5) / 14 + 0.15) * (0.5 + size * 0.5);
    const ux = sp > 0.1 ? vx / sp : 0, uz = sp > 0.1 ? vz / sp : 0;
    // a crown around the nose, pushed ahead of it
    const c = crowns[crownCursor]; crownCursor = (crownCursor + 1) % MAX_CROWNS;
    Object.assign(c, { x: x + ux * size * 1.6, y: level - 0.1, z: z + uz * size * 1.6, age: 0, life: 0.9 + s * 0.5,
      r: size * 1.1, grow: 2.5 + s * 4, h: 1.2 + s * 3.2 });
    c.seedU.value = random() * 10;
    c.mesh.visible = true;
    // the curtain of drops: thrown up and out, most of them forward and to the sides
    const n = Math.round(500 + 1300 * s * size);
    for (let i = 0; i < n; i++) {
      const d = drop();
      const a = random() * Math.PI * 2, out = 1.5 + random() * 5 * s;
      const rr = size * (0.8 + random() * 0.9);
      d.x = c.x + Math.cos(a) * rr; d.z = c.z + Math.sin(a) * rr; d.y = level + random() * 0.3;
      const ahead = Math.max(0, Math.cos(a) * ux + Math.sin(a) * uz);
      d.vx = Math.cos(a) * out + vx * (0.35 + 0.4 * ahead); d.vz = Math.sin(a) * out + vz * (0.35 + 0.4 * ahead);
      d.vy = (2.5 + random() * 6.5) * (0.5 + s * 0.7) * (random() < 0.15 ? 1.5 : 1);
      d.r = 0.005 + random() * 0.011 * (0.6 + s * 0.5); d.age = 0; d.life = 3.5; d.floor = level;
    }
    for (let i = 0; i < 22 + 40 * s; i++) {
      const a = random() * Math.PI * 2, rr = size * (0.5 + random() * 1.8);
      puff(c.x + Math.cos(a) * rr, level + 0.3 + random() * 1.5 * s, c.z + Math.sin(a) * rr, (0.8 + random()) * (0.6 + s * 0.8),
        1.8 + random() * 1.8, vx * 0.25 + Math.cos(a) * 0.8, 0.2 + random() * 0.6, vz * 0.25 + Math.sin(a) * 0.8);
    }
    ring(c.x, level, c.z, size * 1.3, 2 + s * 3.5, 3.2, 1);
    ring(c.x, level, c.z, size * 0.8, 1 + s * 2, 4.5, 0.8);
    ring(c.x - ux * size, level, c.z - uz * size, size, 0.8 + s, 5, 0.7);
  }

  // coming out: water pours off the body and streams back down, a lighter wash where it leaves the surface
  function emerge(x, level, z, vx, vz, size, length) {
    const sp = Math.hypot(vx, vz), s = Math.min(1.2, sp / 14 + 0.25);
    const ux = sp > 0.1 ? vx / sp : 1, uz = sp > 0.1 ? vz / sp : 0;
    const n = Math.round(300 + 600 * size * s);
    for (let i = 0; i < n; i++) {
      const d = drop();
      const along = (random() - 0.5) * 2 * length, across = (random() - 0.5) * 2 * size;
      d.x = x + ux * along - uz * across; d.z = z + uz * along + ux * across;
      d.y = level + 0.2 + random() * (0.4 + size * 0.8);
      const side = across >= 0 ? 1 : -1;
      d.vx = vx * (0.55 + random() * 0.3) - uz * side * random() * 1.2; d.vz = vz * (0.55 + random() * 0.3) + ux * side * random() * 1.2;
      d.vy = random() * 1.4 - 0.4;
      d.r = 0.004 + random() * 0.009; d.age = 0; d.life = 2.5; d.floor = level;
    }
    // the wheels' wash flung up behind
    for (let i = 0; i < 160 * s * size; i++) {
      const d = drop(), a = random() - 0.5;
      d.x = x - ux * length + (random() - 0.5) * size; d.z = z - uz * length + (random() - 0.5) * size; d.y = level + 0.1;
      d.vx = -ux * (0.5 + random()) * sp * 0.15 - uz * a * 3 + vx * 0.4; d.vz = -uz * (0.5 + random()) * sp * 0.15 + ux * a * 3 + vz * 0.4;
      d.vy = 2 + random() * 3.5 * s;
      d.r = 0.005 + random() * 0.01; d.age = 0; d.life = 2.5; d.floor = level;
    }
    for (let i = 0; i < 8 + 10 * s; i++) puff(x - ux * length * random(), level + 0.4 + random() * 0.8, z - uz * length * random(),
      0.7 + random() * 0.8, 1 + random(), vx * 0.2, 0.3, vz * 0.2);
    ring(x - ux * length, level, z - uz * length, size * 1.2, 1.5 + s * 2, 3.5, 0.9);
  }

  // driving through: a bow wave peeling off both sides and churned foam behind, as often as it moves
  let wakeCarry = 0, ringCarry = 0;
  function wade(x, level, z, vx, vz, size, length, depth, dt) {
    const sp = Math.hypot(vx, vz);
    if (sp < 1.2) return;
    const ux = vx / sp, uz = vz / sp, s = Math.min(1.4, sp / 12) * Math.min(1, depth / 0.5);
    wakeCarry += dt * (60 + 520 * s) * (0.5 + size * 0.5);
    while (wakeCarry >= 1) {
      wakeCarry--;
      const d = drop(), side = random() < 0.5 ? -1 : 1;
      d.x = x + ux * length * 0.9 - uz * side * size * (0.7 + random() * 0.4);
      d.z = z + uz * length * 0.9 + ux * side * size * (0.7 + random() * 0.4);
      d.y = level + 0.05;
      const out = (1.2 + random() * 2.5) * (0.4 + s);
      d.vx = vx * (0.55 + random() * 0.25) - uz * side * out; d.vz = vz * (0.55 + random() * 0.25) + ux * side * out;
      d.vy = (1.5 + random() * 3.2) * (0.4 + s * 0.8);
      d.r = 0.004 + random() * 0.009; d.age = 0; d.life = 2.5; d.floor = level;
    }
    ringCarry += dt * (2 + sp * 0.35);
    while (ringCarry >= 1) {
      ringCarry--;
      ring(x - ux * length * 0.6, level, z - uz * length * 0.6, size * 0.9, 0.8 + s, 2.6, 0.6);
    }
    if (random() < dt * 6 * s) puff(x + ux * length, level + 0.4, z + uz * length, 0.6 + random() * 0.6, 1 + random() * 0.8, vx * 0.4, 0.3, vz * 0.4);
  }

  // white water thrown up off a kayak's bow in the Argo Cascades (controllers.js kayakSpray): a fan of drops up and
  // over the bow, a puff or two of spray and a ring of foam. v the kayak's velocity over the bed, s 0-1.5
  function spray(x, level, z, vx, vz, s) {
    const sp = Math.hypot(vx, vz), ux = sp > 0.1 ? vx / sp : 0, uz = sp > 0.1 ? vz / sp : 0;
    for (let i = 0; i < 60 + 260 * s; i++) {
      const d = drop(), a = (random() - 0.5) * 2.6, out = 0.6 + random() * 1.8 * s;
      d.x = x + (random() - 0.5) * 0.8; d.z = z + (random() - 0.5) * 0.8; d.y = level + 0.05 + random() * 0.15;
      d.vx = vx * (0.4 + random() * 0.4) + (Math.sin(a) * ux + Math.cos(a) * -uz) * out;
      d.vz = vz * (0.4 + random() * 0.4) + (Math.sin(a) * uz + Math.cos(a) * ux) * out;
      d.vy = (1.2 + random() * 2.6) * (0.5 + s * 0.6);
      d.r = 0.004 + random() * 0.009; d.age = 0; d.life = 2; d.floor = level;
    }
    for (let i = 0; i < 2 + 5 * s; i++) puff(x + (random() - 0.5), level + 0.3 + random() * 0.5 * s, z + (random() - 0.5),
      0.4 + random() * 0.5 * s, 0.8 + random() * 0.8, vx * 0.5, 0.25, vz * 0.5);
    ring(x, level, z, 0.5, 0.8 + s, 2.2, 0.5 + 0.3 * Math.min(1, s));
  }

  // Watching the player: who is in the water, and when they cross its surface. ent the active vehicle or null.
  let was = null, px = 0, py = 0, pz = 0, cool = 0;
  function track(ent, kind, dt) {
    cool = Math.max(0, cool - dt);
    if (!ent) { was = null; return; }
    const p = ent.position;
    const level = waterLevel(p.x, p.z);
    const jump = Math.hypot(p.x - px, p.z - pz);
    const vx = (p.x - px) / dt, vy = (p.y - py) / dt, vz = (p.z - pz) / dt;
    px = p.x; py = p.y; pz = p.z;
    const size = kind === 'car' ? 0.95 : kind === 'bike' ? 0.45 : kind === 'person' ? 0.3 : 0.4;
    const length = kind === 'car' ? 2.1 : kind === 'person' ? 0.6 : 1.0;
    // the river's level runs on over the land beside it, so only where the river really is (riverDepth, as the
    // camera has it) is the surface there to cross
    const wet = level != null && riverDepth(p.x, p.z) > 0.08;
    const depth = wet ? level - p.y : -1;
    const inside = depth > (was?.inside ? 0.12 : 0.25);
    // a teleport or a change of vehicle isn't a splash
    if (was === null || jump > 8 || was.kind !== kind) { was = { inside, kind }; return; }
    let event = null;
    // someone walking in or climbing out makes no splash of their own: only a jump or a fall in does
    const quiet = kind === 'person' && (inside ? vy > -4 : true);
    if (inside !== was.inside && cool <= 0 && !quiet) {
      const sp = Math.hypot(vx, vz);
      if (inside) { plunge(p.x, level, p.z, vx, vy, vz, size); event = { in: true, x: p.x, y: level, z: p.z, strength: Math.min(1, (sp + Math.max(0, -vy)) / 16 + 0.3) }; }
      else if (level != null) { emerge(p.x, level, p.z, vx, vz, size, length); event = { in: false, x: p.x, y: level, z: p.z, strength: Math.min(1, sp / 16 + 0.25) }; }
      cool = 0.6;
    }
    was.inside = inside;
    // the body breaks the surface: spray off the bow and a wake
    if (inside && depth < (kind === 'car' ? 1.5 : kind === 'person' ? 1.4 : 1.1)) wade(p.x, level, p.z, vx, vz, size, length, depth, dt);
    return event;
  }


  function update(dt, camera) {
    dt = Math.min(dt, 0.05);
    if (!live) return;
    live = false;
    for (const c of crowns) {
      if (!c.mesh.visible) continue;
      c.age += dt;
      const k = c.age / c.life;
      if (k >= 1) { c.mesh.visible = false; continue; }
      live = true;
      // shoots up fast, hangs, then slumps back into the river as it spreads
      const rise = Math.sin(Math.PI * Math.min(1, k * 1.15)) * (1 - k * 0.3);
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.scale.set(c.r + c.grow * Math.sqrt(k), Math.max(0.01, c.h * rise), c.r + c.grow * Math.sqrt(k));
      c.fadeU.value = Math.min(1, (1 - k) * 2.2) * Math.min(1, c.age * 12);
    }

    let n = 0;
    const drag = Math.exp(-0.5 * dt);
    for (const d of D) {
      if (d.life <= 0) continue;
      d.age += dt;
      d.vy -= 9.8 * dt;
      d.vx *= drag; d.vz *= drag;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.age > d.life || (d.y < d.floor && d.vy < 0)) {
        d.life = 0;
        // a big drop landing makes a little ring of its own, now and then
        if (d.r > 0.012 && random() < 0.04) ring(d.x, d.floor, d.z, 0.15, 0.5, 1.2, 0.5);
        continue;
      }
      live = true;
      const v = Math.hypot(d.vx, d.vy, d.vz);
      dir.set(d.vx, d.vy, d.vz).multiplyScalar(1 / (v || 1));
      q.setFromUnitVectors(up, dir);
      sc.set(d.r, d.r * 2 + v * 0.04, d.r);
      drops.setMatrixAt(n++, m.compose(p.set(d.x, d.y, d.z), q, sc));
    }
    drops.count = n;
    drops.instanceMatrix.needsUpdate = true;

    n = 0;
    if (camera) q.copy(camera.quaternion); else q.identity();
    const mdrag = Math.exp(-1.2 * dt);
    for (const s of M) {
      if (s.life <= 0) continue;
      s.age += dt;
      if (s.age > s.life) { s.life = 0; continue; }
      live = true;
      s.vx *= mdrag; s.vz *= mdrag; s.vy = s.vy * mdrag - 0.3 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const k = s.age / s.life, r = s.r * (0.6 + k * 1.4);
      mistFade.array[n] = Math.sin(Math.PI * Math.min(1, k * 1.1 + 0.05));
      mist.setMatrixAt(n++, m.compose(p.set(s.x, s.y, s.z), q, sc.set(r, r, r)));
    }
    mist.count = n;
    mist.instanceMatrix.needsUpdate = true;
    mistFade.needsUpdate = true;

    n = 0;
    for (const g of R) {
      if (g.life <= 0) continue;
      g.age += dt;
      const k = g.age / g.life;
      if (k >= 1) { g.life = 0; continue; }
      live = true;
      const r = g.r + g.grow * Math.sqrt(g.age) * 1.4;
      ringFade.array[n] = g.a * (1 - k) * (1 - k) * Math.min(1, g.age * 8);
      rings.setMatrixAt(n++, m.compose(p.set(g.x, g.y, g.z), flat, sc.set(r * 2, 1, r * 2)));
    }
    rings.count = n;
    rings.instanceMatrix.needsUpdate = true;
    ringFade.needsUpdate = true;
  }

  return { group, update, track, spray };
}

export { createWaterSplash };
