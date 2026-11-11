import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Lamp: what the town's walkers carry and walk (pedestrian-system.js): umbrellas held up in the rain and dogs on a
// leash. Each is one instanced draw (the dogs two, and their leashes one line draw), filled each frame for the people
// near the camera only, and hidden when there are none.

const tint = (g, r, gr, b) => {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
};

function instanced(geo, mat, max, name) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.name = name;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color(1, 1, 1)); // (the color buffer made before the first draw compiles its pipeline)
  m.count = 0;
  m.visible = false;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _one = new THREE.Vector3(1, 1, 1);
const _q2 = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0);
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _c = new THREE.Color();

// Umbrellas: a canopy of eight panels on a shaft, its handle at the origin (in the hand), the canopy's crown 0.95 m up
const UMBRELLA_COLORS = [0x18181a, 0x18181a, 0x1c2a44, 0x00274c, 0xffcb05, 0x6a1f2a, 0x2f4a3a, 0x8a8f96, 0x18181a, 0x3a3054];
function createUmbrellas(max) {
  const R = 0.56, crown = 0.95, rim = 0.74;
  const canopy = new THREE.ConeGeometry(R, crown - rim, 8, 1, true).translate(0, (crown + rim) / 2, 0);
  const shaft = new THREE.CylinderGeometry(0.008, 0.008, crown + 0.04, 5).translate(0, (crown + 0.04) / 2, 0);
  const handle = new THREE.CylinderGeometry(0.014, 0.014, 0.13, 5).translate(0, -0.03, 0);
  const geo = mergeGeometries([tint(canopy, 1, 1, 1), tint(shaft, 0.12, 0.12, 0.12), tint(handle, 0.08, 0.06, 0.05)]);
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const mesh = instanced(geo, mat, max, 'Umbrellas');
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    // held at `hand`, leaning a little toward the head at (cx, cz); `pick` 0..1 chooses its color
    add(hand, cx, cz, pick) {
      if (n >= max) return;
      _d.set((cx - hand.x) * 0.3, crown, (cz - hand.z) * 0.3).normalize(); // (held near upright, a little back over the head)
      _q.setFromUnitVectors(_up, _d);
      _m.compose(_p.copy(hand), _q, _one);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c.setHex(UMBRELLA_COLORS[Math.floor(pick * UMBRELLA_COLORS.length) % UMBRELLA_COLORS.length]));
      n++;
    },
    end() {
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) return;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  };
}

// Dogs: a low-poly body (barrel chest, neck, head and muzzle, ears, tail) facing +z, its shoulder 0.5 m up, and one
// leg shape hung from its hip; four leg instances per dog, swung in a trot (diagonal pairs together). Sizes and coats
// of the dogs one sees about town: a small terrier, a beagle, a lab or golden, a shepherd, a husky's grey.
const BREEDS = [
  { scale: 0.55, coat: 0xe9e4da, long: 1.0 }, // a little white terrier
  { scale: 0.62, coat: 0x2a2420, long: 1.1 }, // a dachshund-ish dark one, long and low
  { scale: 0.72, coat: 0x9a6a3c, long: 1.0 }, // a beagle-brown
  { scale: 0.95, coat: 0xd9a75e, long: 1.0 }, // a golden
  { scale: 0.95, coat: 0x1d1b1a, long: 1.0 }, // a black lab
  { scale: 1.0, coat: 0x6e5236, long: 1.05 }, // a shepherd
  { scale: 0.9, coat: 0x8b8a88, long: 1.0 }, // a husky's grey
  { scale: 0.85, coat: 0xc8b89a, long: 1.0 } // a yellow mutt
];
const HIP = [[0.085, 0.44, 0.2], [-0.085, 0.44, 0.2], [0.08, 0.44, -0.2], [-0.08, 0.44, -0.2]]; // front L/R, back L/R
const TROT = [0, Math.PI, Math.PI, 0]; // diagonal pairs in step
function dogBody() {
  const parts = [
    new THREE.BoxGeometry(0.2, 0.2, 0.56).translate(0, 0.5, 0),
    new THREE.BoxGeometry(0.17, 0.16, 0.2).rotateX(-0.6).translate(0, 0.62, 0.3),
    new THREE.BoxGeometry(0.16, 0.15, 0.18).translate(0, 0.72, 0.4),
    new THREE.BoxGeometry(0.09, 0.08, 0.12).translate(0, 0.69, 0.53),
    new THREE.BoxGeometry(0.04, 0.08, 0.05).rotateZ(0.3).translate(0.06, 0.81, 0.37),
    new THREE.BoxGeometry(0.04, 0.08, 0.05).rotateZ(-0.3).translate(-0.06, 0.81, 0.37),
    new THREE.BoxGeometry(0.04, 0.04, 0.24).rotateX(-0.7).translate(0, 0.62, -0.36)
  ];
  const nose = tint(new THREE.BoxGeometry(0.05, 0.04, 0.03).translate(0, 0.71, 0.6), 0.12, 0.12, 0.12);
  const collar = tint(new THREE.BoxGeometry(0.19, 0.04, 0.06).rotateX(-0.6).translate(0, 0.66, 0.34), 0.55, 0.12, 0.12);
  return mergeGeometries([...parts.map((g) => tint(g, 1, 1, 1)), nose, collar]);
}
function createDogs(max) {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
  const body = instanced(dogBody(), mat, max, 'DogBodies');
  const legs = instanced(tint(new THREE.BoxGeometry(0.055, 0.44, 0.06).translate(0, -0.22, 0), 1, 1, 1), mat, max * 4, 'DogLegs');
  // leashes: three segments each, sagging between the hand and the collar
  const linePos = new Float32Array(max * 6 * 3);
  const lineGeo = new THREE.BufferGeometry();
  const lineAttr = new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute('position', lineAttr);
  lineGeo.setDrawRange(0, 0);
  const leash = new THREE.LineSegments(lineGeo, new THREE.LineBasicNodeMaterial({ color: 0x2a1a14 }));
  leash.name = 'DogLeashes';
  leash.frustumCulled = false;
  leash.visible = false;
  const free = [];
  for (let i = max - 1; i >= 0; i--) free.push({ id: i, x: 0, z: 0, y: 0, vx: 0, vz: 0, yaw: 0, phase: 0, breed: BREEDS[0], placed: false });
  let nb = 0, nl = 0, nLeash = 0;
  const collar = new THREE.Vector3();
  return {
    meshes: [body, legs, leash],
    get available() { return free.length; },
    take(pick) {
      const d = free.pop();
      if (!d) return null;
      d.breed = BREEDS[Math.floor(pick * BREEDS.length) % BREEDS.length];
      d.placed = false;
      return d;
    },
    release(d) { if (d) free.push(d); },
    begin() { nb = nl = nLeash = 0; },
    // `d` trots at heel on the owner's left, half a metre out and a little ahead, on the ground `y` there gives;
    // drawn (with its leash from `hand`) when `draw`
    step(d, dt, ox, oz, fx, fz, ground, draw, hand) {
      const s = d.breed.scale;
      const tx = ox + fz * 0.62 * Math.max(0.8, s) + fx * 0.45, tz = oz - fx * 0.62 * Math.max(0.8, s) + fz * 0.45;
      if (!d.placed || (d.x - tx) ** 2 + (d.z - tz) ** 2 > 36) {
        d.x = tx; d.z = tz; d.vx = d.vz = 0; d.yaw = Math.atan2(fx, fz); d.placed = true;
      }
      // a critically damped follow: catches up when the owner speeds up, settles when they stop
      const k = 14, c = 2 * Math.sqrt(k);
      d.vx += ((tx - d.x) * k - d.vx * c) * dt;
      d.vz += ((tz - d.z) * k - d.vz * c) * dt;
      d.x += d.vx * dt; d.z += d.vz * dt;
      const speed = Math.hypot(d.vx, d.vz);
      if (speed > 0.15) {
        const want = Math.atan2(d.vx, d.vz);
        let dy = want - d.yaw;
        dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        d.yaw += dy * Math.min(1, dt * 8);
      }
      d.phase += (speed / (0.55 * s)) * Math.PI * 2 * dt * 0.5;
      if (!draw || nb >= max) return;
      d.y = ground(d.x, d.z);
      const amp = Math.min(1, speed / 1.2) * 0.55, bob = Math.abs(Math.sin(d.phase)) * 0.015 * Math.min(1, speed);
      const L = d.breed.long;
      _q.setFromAxisAngle(_up, d.yaw);
      _s.set(s, s, s * L);
      _m.compose(_p.set(d.x, d.y + bob, d.z), _q, _s);
      body.setMatrixAt(nb, _m);
      body.setColorAt(nb, _c.setHex(d.breed.coat));
      nb++;
      const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
      for (let i = 0; i < 4; i++) {
        const [hx, hy, hz] = HIP[i];
        const lx = hx * s, lz = hz * s * L;
        _q.setFromAxisAngle(_up, d.yaw).multiply(_q2.setFromAxisAngle(_x, Math.sin(d.phase + TROT[i]) * amp));
        _s.set(s, s, s);
        _m.compose(_p.set(d.x + cy * lx + sy * lz, d.y + hy * s + bob, d.z - sy * lx + cy * lz), _q, _s);
        legs.setMatrixAt(nl, _m);
        legs.setColorAt(nl, _c.setHex(d.breed.coat));
        nl++;
      }
      if (!hand) return;
      collar.set(d.x + sy * 0.34 * s * L, d.y + 0.66 * s, d.z + cy * 0.34 * s * L);
      const o = nLeash * 18;
      const span = Math.hypot(collar.x - hand.x, collar.z - hand.z), sag = Math.max(0, 1.5 - Math.hypot(span, hand.y - collar.y)) * 0.35;
      let px = hand.x, py = hand.y, pz = hand.z;
      for (let k2 = 1; k2 <= 3; k2++) {
        const t = k2 / 3;
        const x = hand.x + (collar.x - hand.x) * t, z = hand.z + (collar.z - hand.z) * t;
        const y = hand.y + (collar.y - hand.y) * t - Math.sin(t * Math.PI) * sag;
        const j = o + (k2 - 1) * 6;
        linePos[j] = px; linePos[j + 1] = py; linePos[j + 2] = pz;
        linePos[j + 3] = x; linePos[j + 4] = y; linePos[j + 5] = z;
        px = x; py = y; pz = z;
      }
      nLeash++;
    },
    end() {
      body.count = nb; body.visible = nb > 0;
      legs.count = nl; legs.visible = nl > 0;
      leash.visible = nLeash > 0;
      lineGeo.setDrawRange(0, nLeash * 6);
      if (nb) {
        for (const m of [body, legs]) {
          m.instanceMatrix.needsUpdate = true;
          m.instanceColor.needsUpdate = true;
        }
      }
      if (nLeash) {
        lineAttr.clearUpdateRanges();
        lineAttr.addUpdateRange(0, nLeash * 18);
        lineAttr.needsUpdate = true;
      }
    }
  };
}

export { createUmbrellas, createDogs };
