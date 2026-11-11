import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { positionWorld, floor, fract, sin, dot, vec2, mix, color } from 'three/tsl';
import { drawOver, groundHeight } from './terrain.js';

// Ann Arbor's park playgrounds, where OpenStreetMap has them (GEO.playgrounds from build-annarbor.py): wood-chip
// ground on the real outline, a play tower with a wide wave slide in the middle, and a swing set beside it where
// there's room. Each kind of equipment is one instanced mesh in vertex colours. The slide is broad and gentle enough
// to drive up like a ramp onto the deck (and off its far side): `top(x, z)` is its height, read by controllers.js.

const GREEN = 0x2e6e45, RED = 0xc23b2c, BLUE = 0x2c5fae, YELLOW = 0xf2b705, DECK = 0x6b4a32, SEAT = 0x232323, CHAIN_COLOR = 0x8a8a8a;

function tinted(geo, hex) {
  const c = new THREE.Color(hex); // already linear: three converts a hex color as it's set
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

// A post from (x0, y0, z0) to (x1, y1, z1)
function post(r, x0, y0, z0, x1, y1, z1, hex) {
  const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return tinted(g, hex);
}

const boxAt = (w, h, d, x, y, z, hex) => tinted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

// The play tower: a 1.25 m deck on four posts under a red roof, panels on two sides, a ladder up and a wide wave
// slide down (along +x, about 7 m from ladder to the slide's foot; centred)
const DECK_TOP = 1.3, SLIDE_LEN = 3.8, SLIDE_HALF = 1.15;
// the slide's surface along it, from the deck's edge (0) to its foot (SLIDE_LEN): a gentle S, flat at both ends
const slideY = (u) => { const t = Math.min(1, Math.max(0, u / SLIDE_LEN)); return DECK_TOP * (1 - t * t * (3 - 2 * t)) * 0.92 + DECK_TOP * 0.08 * (1 - t); };
function towerGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(post(0.065, sx, 0, sz, sx, 3.1, sz, GREEN));
  parts.push(boxAt(2.3, 0.1, 2.3, 0, 1.25, 0, DECK));
  parts.push(tinted(new THREE.ConeGeometry(1.75, 0.9, 4).rotateY(Math.PI / 4).translate(0, 3.55, 0), RED));
  for (const sz of [-1, 1]) {
    parts.push(boxAt(2.0, 0.75, 0.05, 0, 1.75, sz * 1.0, BLUE));
    parts.push(boxAt(2.0, 0.06, 0.08, 0, 2.15, sz * 1.0, YELLOW));
  }
  // the wave slide: a broad yellow bed from the deck's edge to the ground 3.8 m out, low lips along its sides
  const N = 16, bed = [], lip = [];
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * SLIDE_LEN, y = slideY(u), x = 1.15 + u;
    bed.push(x, y, -SLIDE_HALF, x, y, SLIDE_HALF, x, y - 0.06, -SLIDE_HALF, x, y - 0.06, SLIDE_HALF);
  }
  const bedGeo = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < N; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // top
    idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // underside
  }
  bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bed, 3));
  bedGeo.setIndex(idx);
  bedGeo.computeVertexNormals();
  parts.push(tinted(bedGeo, YELLOW));
  for (const sz of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const u0 = (i / N) * SLIDE_LEN, u1 = ((i + 1) / N) * SLIDE_LEN, y0 = slideY(u0), y1 = slideY(u1);
      const len = Math.hypot(u1 - u0, y1 - y0), tilt = Math.atan2(y1 - y0, u1 - u0);
      lip.push(tinted(new THREE.BoxGeometry(len + 0.02, 0.14, 0.07).rotateZ(tilt)
        .translate(1.15 + (u0 + u1) / 2, (y0 + y1) / 2 + 0.05, sz * (SLIDE_HALF + 0.03)), BLUE));
    }
  }
  parts.push(...lip);
  // the ladder
  for (const sz of [-1, 1]) parts.push(post(0.04, -1.55, 0, sz * 0.32, -1.15, 1.9, sz * 0.32, GREEN));
  for (let k = 1; k <= 4; k++) {
    const y = k * 0.27, x = -1.55 + 0.4 * (y / 1.9);
    parts.push(boxAt(0.06, 0.05, 0.64, x, y, 0, DECK));
  }
  const g = mergeGeometries(parts, false);
  g.translate(-1.1, 0, 0);
  return g;
}

// A swing set: a 4.2 m beam on A-frame legs; its two seats on chains are their own instances (seatGeometry), each
// hung from the beam 0.85 m either side of the middle, so a seat can swing
const PIVOT_Y = 2.4, SEAT_X = 0.85, CHAIN = 1.9, CHAIN_X = 0.22;
function swingGeometry() {
  const parts = [post(0.06, -2.1, PIVOT_Y, 0, 2.1, PIVOT_Y, 0, GREEN)];
  for (const x of [-2.0, 2.0]) for (const sz of [-1, 1]) parts.push(post(0.055, x, PIVOT_Y, 0, x, 0, sz * 0.95, GREEN));
  return mergeGeometries(parts, false);
}
// one seat and its two chains, hung from the pivot at the origin (the seat's top 1.9 m below it)
function seatGeometry() {
  const parts = [boxAt(0.5, 0.04, 0.22, 0, -CHAIN - 0.02, 0, SEAT)];
  for (const dx of [-CHAIN_X, CHAIN_X]) parts.push(boxAt(0.02, CHAIN - 0.02, 0.02, dx, -CHAIN / 2, 0, CHAIN_COLOR));
  return mergeGeometries(parts, false);
}

function instanced(geo, mat, matrices) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((x, i) => m.setMatrixAt(i, x));
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

// `flatGeo(rings, y)` makes the chips' ground; adds everything to `group`
function buildPlaygrounds(group, list, flatGeo, toRing, y) {
  if (!list || !list.length) return { count: 0, top: () => -Infinity, colliders: [], swings: null };
  const chips = [], towers = [], swings = [], seats = [], sites = [], colliders = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const place = (cx, cz, angle, along, across) => {
    const ax = Math.cos(angle), az = Math.sin(angle);
    const p = new THREE.Vector3(cx + ax * along - az * across, y, cz + az * along + ax * across);
    return new THREE.Matrix4().compose(p, q.setFromAxisAngle(up, -angle), one);
  };
  for (const [ring, cx, cz, angle, L, W] of list) {
    chips.push(flatGeo([toRing(ring)], y));
    if (L < 6.5 || W < 4.5) continue;
    const along = L >= 14 && W >= 6.5 ? -L * 0.22 : 0;
    towers.push(place(cx, cz, angle, along, 0));
    if (along) {
      const frame = place(cx, cz, angle, L * 0.27, 0);
      swings.push(frame);
      // the swing set's frame is solid: a box round each A-frame's legs, and one round the beam overhead; the seats
      // swing through the open middle
      const sx = cx + Math.cos(angle) * L * 0.27, sz = cz + Math.sin(angle) * L * 0.27, g = groundHeight(sx, sz);
      const c = Math.cos(angle), s = Math.sin(angle);
      const box = (ox, hx, hz, minY, maxY) => {
        const bx = sx + c * ox, bz = sz + s * ox;
        const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
        colliders.push({ minX: bx - ex, maxX: bx + ex, minZ: bz - ez, maxZ: bz + ez, minY: g + minY, maxY: g + maxY,
          obb: { cx: bx, cz: bz, hx, hz, cs: c, sn: -s } });
      };
      for (const ox of [-2.0, 2.0]) box(ox, 0.12, 1.0, -0.2, 2.5);
      box(0, 2.15, 0.1, 2.3, 2.5);
      // its two seats, each hung from the beam (in the frame's turn: the beam along its x, the seat swinging along z)
      for (const ox of [-SEAT_X, SEAT_X]) {
        const m = frame.clone().multiply(new THREE.Matrix4().makeTranslation(ox, PIVOT_Y, 0));
        seats.push({ i: seats.length, rest: m, base: null, x: sx + c * ox, z: sz + s * ox,
          theta: 0, omega: 0, pump: 0, rider: null, phase: (sx * 0.37 + sz * 0.61 + ox) % 6.283 });
      }
    }
    sites.push({ x: cx + Math.cos(angle) * along, z: cz + Math.sin(angle) * along, c: Math.cos(angle), s: Math.sin(angle) });
  }
  const chipGeo = mergeGeometries(chips, false);
  // drawn in front of the lawn it sits on (drawOver, terrain.js): only a centimetre above it, the grass cut to the
  // slopes its own way came up through the chips in spikes. Mottled in two sizes of patch so it reads as mulch.
  const chipMat = drawOver(new THREE.MeshStandardNodeMaterial({ roughness: 1 }));
  const cell = (s) => { const p = floor(positionWorld.xz.mul(s)); return fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453)); };
  const mottle = cell(2.5).mul(0.6).add(cell(9).mul(0.4));
  chipMat.colorNode = mix(color(0x6e4f33), color(0x9a7650), mottle);
  const chipMesh = new THREE.Mesh(chipGeo, chipMat);
  chipMesh.receiveShadow = true;
  group.add(chipMesh);
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  if (towers.length) group.add(instanced(towerGeometry(), mat, towers));
  if (swings.length) group.add(instanced(swingGeometry(), mat, swings));
  const seatMesh = seats.length ? instanced(seatGeometry(), mat, seats.map((t) => t.rest)) : null;
  if (seatMesh) { seatMesh.name = 'SwingSeats'; group.add(seatMesh); }
  // The deck's and the slide's height above the ground at (x, z), or -Infinity off them (in the tower's frame: the
  // geometry's +x is `angle` in the world, the deck from x -2.25 to 0.05, the slide on from there)
  const top = (x, z) => {
    for (const p of sites) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz > 25) continue;
      const lx = dx * p.c + dz * p.s, lz = -dx * p.s + dz * p.c;
      if (lx > -2.25 && lx < 0.05 && Math.abs(lz) < 1.15) return DECK_TOP;
      if (lx >= 0.05 && lx < 0.05 + SLIDE_LEN && Math.abs(lz) < SLIDE_HALF) return slideY(lx - 0.05);
    }
    return -Infinity;
  };
  return { count: towers.length, top, colliders, swings: seatMesh ? swingSeats(seatMesh, seats) : null };
}

// The swing seats as a pendulum each: `theta` from hanging straight down, positive toward the frame's +z, `omega` its
// rate. Each frame (update) the seats someone rides, and those still swinging, step on; the empty ones near a player
// sway a little in the wind. A rider pumps (`pump`, -1 to 1, along the frame's +z): in time with the swing it builds,
// against it it slows; the arc is held to 70 degrees from straight down.
const GRAVITY = 9.8, PEND = 1.75; // the rider's and seat's weight hangs a little above the seat
const W2 = GRAVITY / PEND, MAX_SWING = 70 * Math.PI / 180, MAX_E = W2 * (1 - Math.cos(MAX_SWING));
const PUMP = 0.65, DAMP_RIDDEN = 0.12, DAMP_EMPTY = 0.3, WIND_NEAR = 60;
function swingSeats(mesh, seats) {
  const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  // instance i where it's drawn (scene-culling.js moves instances into chunks, as knockdowns.js place follows)
  const where = (i) => {
    let m = mesh, j = i;
    for (let k = 0; k < 4 && m.userData.movedTo?.[j]; k++) [m, j] = m.userData.movedTo[j];
    return [m, j];
  };
  // the hanging matrix as the ground's lift left it (setOnTerrain), read the first time it's needed
  const base = (seat) => {
    if (seat.base) return seat.base;
    const [m, j] = where(seat.i);
    seat.base = new THREE.Matrix4();
    m.getMatrixAt(j, seat.base);
    return seat.base;
  };
  const write = (seat) => {
    _m.copy(base(seat)).multiply(_r.makeRotationX(-seat.theta));
    const [m, j] = where(seat.i);
    m.setMatrixAt(j, _m);
    m.instanceMatrix.needsUpdate = true;
    const shadow = mesh.userData.shadowCopy?.[seat.i], proxy = shadow?.[0].mesh;
    if (proxy) { proxy.setMatrixAt(shadow[1], _m); proxy.instanceMatrix.needsUpdate = true; }
  };
  let time = 0;
  const step = (seat, dt, wind) => {
    const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, damp = seat.rider ? DAMP_RIDDEN : DAMP_EMPTY;
    for (let k = 0; k < n; k++) {
      let a = -W2 * Math.sin(seat.theta) - damp * seat.omega + PUMP * seat.pump * Math.cos(seat.theta);
      if (wind) {
        const t = time + k * h;
        a += 0.12 * Math.sin(t * 1.3 + seat.phase) * (0.55 + 0.45 * Math.sin(t * 0.23 + seat.phase * 2));
      }
      seat.omega += a * h;
      seat.theta += seat.omega * h;
      // held to its highest arc: the energy past it taken off the speed
      const e = 0.5 * seat.omega * seat.omega + W2 * (1 - Math.cos(seat.theta));
      if (e > MAX_E) {
        if (Math.abs(seat.theta) >= MAX_SWING) { seat.theta = Math.sign(seat.theta) * MAX_SWING; seat.omega = 0; }
        else seat.omega = Math.sign(seat.omega) * Math.sqrt(Math.max(0, 2 * (MAX_E - W2 * (1 - Math.cos(seat.theta)))));
      }
    }
  };
  return {
    seats,
    // the nearest free seat within `reach` of (x, z), `facing` (controllers.js) counting what's ahead as nearer
    nearest(x, z, reach, facing = null) {
      let best = null, score = Infinity;
      for (const seat of seats) {
        const dx = seat.x - x, dz = seat.z - z;
        if (seat.rider || dx * dx + dz * dz > reach * reach) continue;
        const d = Math.sqrt(dx * dx + dz * dz), sc = d * (facing ? facing(seat.x, seat.z) : 1);
        if (sc < score) { score = sc; best = { seat, d, x: seat.x, z: seat.z }; }
      }
      return best;
    },
    take(seat, rider) { seat.rider = rider; seat.pump = 0; },
    release(seat) { if (seat) { seat.rider = null; seat.pump = 0; } },
    // where the seat is now: `pivot` on the beam, `along` the frame's +z in the world (level), `point` the seat's top,
    // `vel` its velocity
    state(seat, out) {
      base(seat).decompose(_p, _q, _s);
      out.pivot.copy(_p);
      out.along.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
      const st = Math.sin(seat.theta), ct = Math.cos(seat.theta);
      out.point.copy(out.along).multiplyScalar(CHAIN * st).add(_p);
      out.point.y -= CHAIN * ct;
      out.vel.copy(out.along).multiplyScalar(CHAIN * ct * seat.omega);
      out.vel.y = CHAIN * st * seat.omega;
      return out;
    },
    // `foci`: where the players are, for the wind's sway of the empty seats near them; `creak(at, loudness)`: a seat
    // turning at the end of its arc, its chain creaking on the hook at the beam (louder the higher it swung; an empty
    // one swaying in the wind only now and then, and faintly)
    update(dt, foci, creak = null) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      for (const seat of seats) {
        let near = false;
        for (const f of foci) {
          if (!f) continue;
          const dx = f.x - seat.x, dz = f.z - seat.z;
          if (dx * dx + dz * dz < WIND_NEAR * WIND_NEAR) { near = true; break; }
        }
        const moving = Math.abs(seat.theta) > 0.002 || Math.abs(seat.omega) > 0.002;
        if (!seat.rider && !near && !moving) continue;
        const was = seat.omega;
        step(seat, dt, near && !seat.rider);
        if (creak && near && was * seat.omega < 0) {
          const swung = Math.abs(seat.theta);
          const loud = swung > 0.12 ? Math.min(1, (swung - 0.12) / 0.9) : swung > 0.01 && Math.random() < 0.04 ? 0.06 : 0;
          if (loud > 0) { base(seat).decompose(_p, _q, _s); creak(_p, loud); }
        }
        // far off and all but still: hung straight again, then left alone
        if (!seat.rider && !near && Math.abs(seat.theta) < 0.01 && Math.abs(seat.omega) < 0.01) seat.theta = seat.omega = 0;
        write(seat);
      }
      time += dt;
    }
  };
}

export { buildPlaygrounds };
