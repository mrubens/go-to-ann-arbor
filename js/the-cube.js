import * as THREE from 'three/webgpu';
import { positionLocal, positionWorld, abs, max, min, smoothstep, mix, float, vec3, mx_noise_float, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log, random } from '../lamp-game.js';
import { groundHeight } from './terrain.js';

// Lamp: the Cube, Tony Rosenthal's "Endover" (1968), on Regents Plaza between the Michigan Union and the Fleming
// Administration Building, where OpenStreetMap has it (node 1458141546). A black steel cube 8 ft on a side standing on
// one corner on a short pivot post, each face cut into four quadrant plates, some sunk a little, some with a shallow
// round recess or a raised panel. Painted satin black, worn bright on the edges and corners at the height people push
// it, and a little dirty low down.
//
// It turns on its pivot about the upright and nothing else: walked into and pushed (forward held against a face) it
// builds slowly, keeps going after the player lets go and slows over a few turns; a jump beside it is a hard shove;
// passersby give it a push now and then while the player's away, so it's often turning when they arrive. Its collider
// is the cube's section at about chest height (a triangle, turned with it), so cars and bikes bounce off it as off a
// wall (controllers.js), and a hit sets it spinning, the harder and the further off its middle the faster, with a
// deep clang in place of a crash. It never tips, moves or comes off its pivot.

export const CUBE_AT = { x: 535.3, z: 416.2 };
const SIDE = 2.44; // 8 ft
const HALF = SIDE / 2;
const DIAG = SIDE * Math.sqrt(3);
const PIVOT = 0.36; // the post from the paving to the bottom corner
const SECTION = 1.2; // the collider's section, this far above the bottom corner (about 1.55 m above the paving)
const INERTIA = 1150; // kg m², a steel shell of about 700 kg about its diagonal
const PUSH = 260; // N, someone leaning into it
const SPIN_MAX = 3.2; // rad/s
// the walkers' obstacle (pedestrian-system.js routes around it): the cube's outline from above
export const CUBE_FOOTPRINT = { minX: CUBE_AT.x - 2, maxX: CUBE_AT.x + 2, minZ: CUBE_AT.z - 2, maxZ: CUBE_AT.z + 2, pedestrianOnly: true };

const TILT = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0));

// One face's plates, in the face's own frame (the face at +z, its plates' tops out to z = HALF): four quadrants with a
// seam between them, `deep` sunk ones, round recesses through some (the cube's shell showing at their bottom), raised
// panels on others
function faceGeometry(f) {
  const parts = [];
  const seam = 0.013, edge = 0.005, bevel = 0.006, thick = 0.05;
  const x0 = seam + bevel, x1 = HALF - edge - bevel, mid = (x0 + x1) / 2;
  for (let q = 0; q < 4; q++) {
    // each quadrant made in the face's top right and turned to its place
    const shape = new THREE.Shape();
    shape.moveTo(x0, x0); shape.lineTo(x1, x0); shape.lineTo(x1, x1); shape.lineTo(x0, x1); shape.closePath();
    const deep = (q + f) % 3 === 1 ? 0.022 : 0;
    const recess = q === f % 4 ? 0.34 : f % 2 === 0 && q === (f + 2) % 4 ? 0.2 : 0;
    if (recess) {
      const hole = new THREE.Path();
      hole.absarc(mid + (f % 3 - 1) * 0.06, mid, recess, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const plate = new THREE.ExtrudeGeometry(shape, { depth: thick - deep - bevel * 2, bevelEnabled: true, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: 2, curveSegments: 40 });
    plate.translate(0, 0, HALF - thick + bevel);
    const quadrant = [flat(plate)];
    // a raised panel on one quadrant of the odd faces
    if (f % 2 === 1 && q === (f + 1) % 4) {
      const w = (x1 - x0) * 0.62, h = (x1 - x0) * 0.34;
      quadrant.push(flat(new THREE.BoxGeometry(w, h, 0.016).translate(mid, x0 + (x1 - x0) * 0.3, HALF - deep + 0.008)));
    }
    for (const g of quadrant) parts.push(g.rotateZ(q * Math.PI / 2));
  }
  return mergeGeometries(parts);
}

const flat = (g) => g.index ? g.toNonIndexed() : g;

// the whole cube in its own frame (its middle at the origin, faces along the axes)
function cubeGeometry() {
  const parts = [flat(new THREE.BoxGeometry(SIDE - 0.1, SIDE - 0.1, SIDE - 0.1, 4, 4, 4))];
  const turns = [[0, 0, 0], [0, Math.PI, 0], [0, Math.PI / 2, 0], [0, -Math.PI / 2, 0], [-Math.PI / 2, 0, 0], [Math.PI / 2, 0, 0]];
  turns.forEach(([rx, ry, rz], f) => {
    const g = faceGeometry(f);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    parts.push(g);
  });
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
  g.computeBoundingSphere();
  return g;
}

// satin black paint, scuffed through to bright steel on the edges and corners where hands go, dusty low down
function cubeMaterial(ground) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal, q = abs(p).div(HALF);
  const m1 = max(max(q.x, q.y), q.z), m3 = min(min(q.x, q.y), q.z), m2 = q.x.add(q.y).add(q.z).sub(m1).sub(m3);
  const n1 = mx_noise_float(p.mul(7)).mul(0.5).add(0.5);
  const n2 = mx_noise_float(p.mul(31)).mul(0.5).add(0.5);
  const h = positionWorld.y.sub(ground);
  const hands = smoothstep(0.6, 1.1, h).mul(float(1).sub(smoothstep(1.9, 2.6, h)));
  const edgeWear = smoothstep(0.93, 0.995, m2).mul(float(0.3).add(hands.mul(0.7)));
  const cornerWear = smoothstep(0.86, 0.97, m3).mul(0.8);
  const scuff = max(edgeWear, cornerWear).mul(smoothstep(0.3, 0.75, n1.mul(0.6).add(n2.mul(0.4)))).clamp(0, 1);
  const dirt = float(1).sub(smoothstep(0.15, 1.0, h)).mul(n1.mul(0.6).add(0.4)).mul(float(1).sub(scuff));
  const paint = vec3(0.028, 0.028, 0.03).mul(n2.mul(0.35).add(0.82));
  const steel = vec3(0.5, 0.49, 0.47).mul(n2.mul(0.3).add(0.75));
  m.colorNode = mix(mix(paint, steel, scuff), vec3(0.16, 0.14, 0.11), dirt.mul(0.75));
  m.roughnessNode = mix(mix(float(0.5).add(n1.mul(0.14)), float(0.3), scuff), float(0.92), dirt.mul(0.8));
  m.metalnessNode = mix(mix(float(0.2), float(0.85), scuff), float(0.0), dirt);
  return m;
}

export function buildCube(group) {
  group.name = 'TheCube';
  const { x, z } = CUBE_AT;
  const g = groundHeight(x, z);
  const ground = uniform(g);

  // the post and its plate, set in the paving
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.45, metalness: 0.8 });
  const post = new THREE.Mesh(mergeGeometries([
    new THREE.CylinderGeometry(0.46, 0.48, 0.03, 40).translate(0, 0.015, 0),
    new THREE.CylinderGeometry(0.11, 0.12, PIVOT, 24).translate(0, PIVOT / 2, 0),
    new THREE.CylinderGeometry(0.17, 0.15, 0.07, 24).translate(0, PIVOT - 0.02, 0)
  ].map((p) => { p.deleteAttribute('uv'); return flat(p); })), postMat);
  post.position.set(x, g, z);
  post.castShadow = post.receiveShadow = true;
  group.add(post);

  const spin = new THREE.Group();
  spin.position.set(x, g + PIVOT + DIAG / 2, z);
  const body = new THREE.Mesh(cubeGeometry(), cubeMaterial(ground));
  body.name = 'The Cube';
  body.quaternion.copy(TILT);
  body.castShadow = body.receiveShadow = true;
  spin.add(body);
  group.add(spin);

  // the collider: the section at SECTION above the bottom corner, a triangle along the three lower edges, turned with it
  const base = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([ex, ey, ez]) => {
    const e = new THREE.Vector3(ex, ey, ez).applyQuaternion(TILT);
    const t = SECTION / e.y;
    return { x: e.x * t, z: e.z * t };
  });
  const outer = base.map(() => ({ x, z }));
  const R = SIDE * Math.sqrt(2 / 3) + 0.05; // the outline from above
  const touch = { live: false, mode: '', x: 0, z: 0, nx: 0, nz: 0, vx: 0, vz: 0, mass: 0 };
  const collider = {
    minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R, minY: g - 1, maxY: g + PIVOT + DIAG,
    polygon: { outer, holes: [] }, solid: true, quiet: true,
    // controllers.js, each frame something touches it: who, and how fast it was going
    onHit(entity, mode, pos, nx, nz) {
      touch.live = true; touch.mode = entity ? entity.type || mode : 'person';
      touch.x = pos.x; touch.z = pos.z; touch.nx = nx; touch.nz = nz;
      if (entity && touch.mode !== 'person') {
        const s = Math.sin(entity.heading), c = Math.cos(entity.heading);
        touch.vx = s * entity.speed + (entity.vx || 0); touch.vz = c * entity.speed + (entity.vz || 0);
        touch.mass = entity.drive?.mass || (touch.mode === 'cyclist' ? 95 : 1500);
      } else { touch.vx = touch.vz = 0; touch.mass = 80; }
    }
  };

  const state = { angle: 0.7, w: 0.35 + random() * 0.4, nextNudge: 8 + random() * 20, lastClang: -9, lastShove: -9, wasUp: false, time: 0, grinding: false };
  const place = () => {
    spin.rotation.y = state.angle;
    const c = Math.cos(state.angle), s = Math.sin(state.angle);
    for (let i = 0; i < 3; i++) { outer[i].x = x + base[i].x * c + base[i].z * s; outer[i].z = z - base[i].x * s + base[i].z * c; }
  };
  place();
  const at = { x, y: g + 0.4, z };

  // ctx: { keys, player: {x, z}, heading, cue(kind, at, intensity), grind(spin, at) }
  function update(dt, ctx) {
    state.time += dt;
    const t = touch;
    if (t.live) {
      // the point touched, a little inside the player's side of the surface, from the cube's upright axis
      const rx = t.x - t.nx * 0.5 - x, rz = t.z - t.nz * 0.5 - z;
      if (t.mode === 'person') {
        const fx = Math.sin(ctx.heading), fz = Math.cos(ctx.heading);
        const facing = -(fx * t.nx + fz * t.nz);
        if (facing > 0.4) {
          // the lever of a push straight ahead; one at the middle of a face still turns it a little, the way it went
          let lever = rz * fx - rx * fz;
          if (Math.abs(lever) < 0.45) lever = 0.45 * (Math.sign(lever || state.w) || 1);
          // pushing: it builds slowly, never faster than a walk at the hand
          if (ctx.keys.forward && state.w * lever < 1.25) state.w += PUSH * lever / INERTIA * dt * facing;
          // a jump beside it: a hard shove
          const up = !!ctx.keys.up;
          if (up && !state.wasUp && state.time - state.lastShove > 0.6) {
            state.w += Math.sign(lever) * 0.5 * Math.min(1, Math.abs(lever) + 0.3);
            state.lastShove = state.time;
            ctx.cue?.('clang', at, 0.18);
            log(`[cube] shoved, turning at ${state.w.toFixed(2)} rad/s`);
          }
        }
      } else if (t.mode !== 'helicopter') {
        // a car or bike: the angular impulse of its momentum about the axis, shared with the heavy cube
        const closing = -(t.vx * t.nx + t.vz * t.nz);
        const r2 = rx * rx + rz * rz;
        const cross = rz * t.vx - rx * t.vz;
        if (closing > 0.8 && state.time - state.lastClang > 0.35) {
          state.w += cross * t.mass / (INERTIA + t.mass * r2) * 0.45;
          state.lastClang = state.time;
          ctx.cue?.('clang', { x: t.x - t.nx, y: at.y + 0.6, z: t.z - t.nz }, Math.min(1, 0.15 + closing / 14));
          log(`[cube] hit at ${Math.round(closing * 3.6)} km/h, turning at ${state.w.toFixed(2)} rad/s`);
        } else if (r2 > 0.01) {
          // scraping along it: friction drags it toward the vehicle's speed at the touch
          const target = cross / r2;
          state.w += (target - state.w) * Math.min(1, dt * 0.6 * t.mass / 1500);
        }
      }
      t.live = false;
    }
    state.wasUp = !!ctx.keys.up;

    // passersby, while the player's not close: a push now and then
    const away = Math.hypot(ctx.player.x - x, ctx.player.z - z);
    state.nextNudge -= dt;
    if (state.nextNudge <= 0) {
      state.nextNudge = 15 + random() * 40;
      if (away > 30 && Math.abs(state.w) < 0.4) state.w += (random() < 0.5 ? -1 : 1) * (0.4 + random() * 0.5);
    }

    // the pivot's drag: it slows over a few turns
    const drag = (0.025 + 0.02 * Math.abs(state.w)) * dt;
    state.w = Math.abs(state.w) <= drag ? 0 : state.w - Math.sign(state.w) * drag;
    state.w = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, state.w));
    if (state.w) { state.angle = (state.angle + state.w * dt) % (Math.PI * 2); place(); }

    const hear = away < 130;
    if (hear || state.grinding) { ctx.grind?.(hear ? state.w : 0, at); state.grinding = hear; }
  }

  log(`[cube] on Regents Plaza at ${x.toFixed(1)}, ${z.toFixed(1)}, ground ${g.toFixed(2)} m`);
  return { collider, update, state, footprint: CUBE_FOOTPRINT };
}
