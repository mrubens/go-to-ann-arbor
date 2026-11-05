import * as THREE from 'three/webgpu';
import {
  TOWN_BOUNDS,
  BIG_PARK_BOUNDS,
  getTownBoundsAtZ,
  inTown,
  isTypingInField,
  blockAt,
  streetZ
} from './city-config.js';
import { cityUniforms, createCarPaintMaterial, createContactShadowMaterial } from './tsl-materials.js';
import {
  BODY_SPECS,
  buildCarGeometry,
  buildCarSidePatch,
  buildSteerableWheelGeo,
  carTipZ,
  createCarWheelMaterial,
  createLoftedCarMaterial
} from './cars.js';
import {
  buildHelicopterBodyGeometry,
  buildHelicopterMainRotorGeometry,
  buildHelicopterTailRotorGeometry,
  createLoftedHelicopterMaterial
} from './helicopter.js';
import { PersonCrowd, PersonRig, PEDESTRIAN_DIVE_DURATION } from './pedestrians.js';
import { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight } from './vehicle-lights.js';
import { bryantParkLawn } from './landmarks.js';
import { groundHeight, groundTilt, nearestWater, riverDepth, riverFlow, stadiumGround, waterLevel, footbridgeTop } from './terrain.js';
import { WATER_RIPPLES, waterDisturb } from './tsl-materials.js';
import { cascadeCurrent, cascadeDepth, inCascades, onWeirRocks, pondDraw } from './cascades.js';
import { polygonContact, polygonContains } from './building-collision.js';
import { onAirfield, buildStairTruck, PAVE } from './airport.js';
import { pedalBoatGeometry } from './gallup-livery.js';
import { vehicleContact, resolveVehicleContact } from './vehicle-physics.js';
import { STADIUM, bowlSurface, carSurface, radiiAt } from './stadium-shape.js';
import { hot, log, rumble } from '../lamp-game.js';
import { dumpTruckGeo, excavatorGeo, truckWheelGeo, TRUCK_WHEELS } from './road-work.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MOTO_SPECS, HELMET_OF, buildMotoGeometry, buildMotoWheel, buildHelmetGeometry, createMotoMaterial, motoRiderPose } from './motorcycles.js';

// Player models, animation and movement for walking, driving, cycling and flying.

// Spawn on Main St in downtown Ann Arbor, between William and Liberty, facing north up Main
const SPAWN_Z = 100;
// The kayak sets out on Argo Pond, by the canoe livery, and the river carries it on down towards Gallup Park
const KAYAK_LAUNCH = { x: 210, z: -1150 };
const KAYAK_CURRENT = 1.5; // m/s, out in the middle at an ordinary flow (riverScale)
// The player's own car: a maize sports car with GO BLU plates
const OWN_CAR = { kind: 'sports', hex: 0xffcb05, style: 0 };
const isOwnCar = (look) => look.kind === OWN_CAR.kind && look.hex === OWN_CAR.hex;
const groundCollider = { type: 'ground' };
// The skids' ends and middle, [across, along] in metres from the helicopter's middle
const HELI_SKIDS = [[0, 0], [-1.1, -1.8], [1.1, -1.8], [-1.1, 1.8], [1.1, 1.8]];

const CAR_DRIVE = {
  speed: 36, reverseSpeed: 10.5, acceleration: 4.5,
  powerSpeed: 14.5, // Above 52 km/h, engine power limits acceleration.
  rolling: 0.18, drag: 0.0012, coast: 0.6, brake: 9,
  wheelbase: 2.76, grip: 9.5, cornering: 10.5 // Wheelbase (m), tire and steering acceleration limits (m/s²).
};
// How each kind of car drives, over CAR_DRIVE: top speed (the real vehicle's, in m/s), pull, braking, tire grip, how tight it turns (cornering and
// wheelbase), how quick the steering is (steer) and how far the body leans in a bend (roll) and pitches (pitch)
const CAR_HANDLING = {
  sedan: { speed: 53.6, acceleration: 5 }, // 120 mph, a Camry or Civic
  taxi: { speed: 53.6, acceleration: 5 },
  forester: { mass: 1600, speed: 53.6, acceleration: 4.6, grip: 10, cornering: 10.2, wheelbase: 2.67, roll: 0.014 }, // all-wheel drive; 120 mph, a Subaru Forester
  suv: { mass: 2000, speed: 50.1, acceleration: 4.2, brake: 8.5, grip: 8.6, cornering: 9, wheelbase: 2.8, steer: 8, roll: 0.016 }, // 112 mph, an Outback, RAV4 or CR-V
  minivan: { mass: 2000, speed: 50.1, acceleration: 3.8, brake: 8.5, grip: 8.4, cornering: 8.5, wheelbase: 3.03, steer: 7.5, roll: 0.015 }, // 112 mph, a Sienna or Odyssey
  pickup: { mass: 2400, speed: 47.8, acceleration: 4.8, powerSpeed: 11, brake: 8, grip: 7.8, cornering: 7.6, wheelbase: 3.7, steer: 7, roll: 0.017, pitch: 0.034 }, // 107 mph, an F-150
  // the electric cars: heavy, with all their pull from a standstill
  // the electric performance sedan: a tri-motor's shove off the line (60 mph in about two seconds) and 200 mph flat out
  tesla: { mass: 2070, speed: 89.4, acceleration: 13, powerSpeed: 30, brake: 12, drag: 0.0005, grip: 14, cornering: 14, wheelbase: 2.96, steer: 12, roll: 0.008, pitch: 0.018 },
  ioniq: { mass: 2100, speed: 51.4, acceleration: 6.5, powerSpeed: 20, grip: 9.6, cornering: 9.6, wheelbase: 3.0, steer: 8.5, roll: 0.013 }, // 115 mph, an Ioniq 5
  r1s: { mass: 2700, speed: 49.2, acceleration: 7, powerSpeed: 22, brake: 8.5, grip: 9, cornering: 9, wheelbase: 3.08, steer: 8, roll: 0.013 }, // 110 mph, a Rivian R1S
  r1t: { mass: 3000, speed: 49.2, acceleration: 7, powerSpeed: 22, brake: 8.5, grip: 8.6, cornering: 8.2, wheelbase: 3.45, steer: 7.5, roll: 0.013, pitch: 0.028 }, // 110 mph, a Rivian R1T
  cybertruck: { mass: 3100, speed: 58.1, acceleration: 7, powerSpeed: 22, brake: 8.5, grip: 8.4, cornering: 7.8, wheelbase: 3.81, steer: 8, roll: 0.012, pitch: 0.026 }, // 130 mph, the Cybertruck Cyberbeast
  van: { mass: 2700, speed: 40.2, acceleration: 3.2, powerSpeed: 11, brake: 7.5, grip: 7.2, cornering: 7, wheelbase: 3.6, steer: 6.5, roll: 0.02, pitch: 0.036 }, // 90 mph, a high-roof Sprinter or Transit
  // motorcycles (motorcycles.js): light, quick off the line, leaning into bends
  // the sport bike turns on a dime: sticky tires, a quick wheel and a wide lock
  sportbike: { mass: 290, speed: 71.5, acceleration: 10, powerSpeed: 26, brake: 13, grip: 24, cornering: 30, wheelbase: 1.4, steer: 30, lock: 0.9, yaw: 22, roll: 0, pitch: 0.03 }, // 160 mph, a 600 cc supersport
  cruiser: { mass: 380, speed: 49.2, acceleration: 6.5, powerSpeed: 16, brake: 9, grip: 10, cornering: 11, wheelbase: 1.65, steer: 10, roll: 0, pitch: 0.025 }, // 110 mph, a big V-twin cruiser
  scooter: { mass: 190, speed: 26.8, acceleration: 4.5, powerSpeed: 9, brake: 8, grip: 10, cornering: 12, wheelbase: 1.3, steer: 14, roll: 0, pitch: 0.025 }, // 60 mph, a 150 cc Vespa
  touring: { mass: 470, speed: 51.4, acceleration: 6, powerSpeed: 18, brake: 9, grip: 10, cornering: 10, wheelbase: 1.62, steer: 9, roll: 0, pitch: 0.022 }, // 115 mph, a V-twin bagger
  adventure: { mass: 320, speed: 55.4, acceleration: 7.5, powerSpeed: 18, brake: 9.5, grip: 11, cornering: 12, wheelbase: 1.55, steer: 12, roll: 0, pitch: 0.03 }, // 124 mph, a BMW R 1250 GS
  // and what's borrowed from the bike lane: a bicycle, an e-scooter and a hoverboard, at their own gentle pace
  bicycle: { mass: 95, speed: 12.1, acceleration: 2.8, powerSpeed: 5, brake: 6, grip: 9, cornering: 10, wheelbase: 1.04, steer: 14, roll: 0, pitch: 0.02 },
  // pedal-assisted to 28 mph, as a Class 3 e-bike is
  ebike: { mass: 115, speed: 12.5, acceleration: 4.2, powerSpeed: 9, brake: 6.5, grip: 9.5, cornering: 10, wheelbase: 1.12, steer: 14, roll: 0, pitch: 0.02 },
  escooter: { mass: 92, speed: 6.7, acceleration: 3, powerSpeed: 5, brake: 5.5, grip: 8.5, cornering: 10, wheelbase: 0.84, steer: 16, roll: 0, pitch: 0.02 }, // 15 mph, a rental e-scooter, governed
  hoverboard: { mass: 85, speed: 4.5, acceleration: 2.6, powerSpeed: 3, brake: 5, grip: 9, cornering: 13, wheelbase: 0.5, steer: 22, roll: 0, pitch: 0.015 }, // 10 mph, a hoverboard
  // the road work's machines (road-work.js): a loaded tandem dump truck, slow to get going and wide in a turn, and a
  // tracked excavator that crawls along and turns nearly on the spot
  dumptruck: { mass: 16000, speed: 29.1, acceleration: 2.4, powerSpeed: 8, brake: 6, grip: 6.5, cornering: 6.2, wheelbase: 5.3, steer: 5, roll: 0.022, pitch: 0.03 }, // 65 mph, a governed tandem dump truck
  // the airport's rolling airstairs: a light truck under a tall flight of steps, slow and wide in a turn
  stairtruck: { mass: 5200, speed: 16, acceleration: 2.8, powerSpeed: 7, brake: 6.5, grip: 7, cornering: 7, wheelbase: 6.6, steer: 6, roll: 0.02, pitch: 0.025 },
  excavator: { mass: 21000, speed: 1.5, acceleration: 1.6, brake: 6, grip: 7, cornering: 16, wheelbase: 0.9, steer: 6, roll: 0.004, pitch: 0.012 }, // 3.4 mph, a 20-tonne excavator in high travel
  sports: { mass: 1500, speed: 85.4, acceleration: 10, powerSpeed: 34, brake: 12, drag: 0.0006, grip: 15, cornering: 17, wheelbase: 2.72, steer: 16, roll: 0.007, pitch: 0.016 } // 191 mph, a 911 Carrera S
};
// Lamp: a game's cars turn in sharper than the real ones' figures above: more grip in a bend, a quicker wheel
// what the player's car is now, for its size against walls and other cars: [half width, half length]
const MACHINE_BOX = { dumptruck: [1.3, 4.6], excavator: [1.45, 2.4], stairtruck: [1.25, 5.3] };
const playerBox = [0.86, 2.18];
const MACHINES = { dumptruck: 'Dump Truck', excavator: 'Excavator', stairtruck: 'Airstairs' };
const carDrive = (kind) => {
  const d = { mass: 1500, steer: 10, roll: 0.012, pitch: 0.026, ...CAR_DRIVE, ...CAR_HANDLING[kind] };
  d.grip *= 1.3; d.cornering *= 1.45; d.steer *= 1.6;
  // the air's drag never holds it short of its top speed: at most what leaves a fifth of its pull there
  const pull = d.acceleration * (d.powerSpeed ? d.powerSpeed / Math.max(d.powerSpeed, d.speed) : 1) - d.rolling;
  d.drag = Math.min(d.drag, (0.8 * pull) / (d.speed * d.speed));
  return d;
};
// Faster than this (m/s, about 14 km/h) and getting out of the car is a tumble out of its door
const EXIT_SPEED = 4;
// Higher than this (m) over the ground and out of the helicopter is a parachute jump
const CHUTE_HEIGHT = 7;
// The helicopter's ceiling: high enough for a long skydive (about half a minute of free fall); audio-sources.js has it too
const HELI_CEILING = 1500;
// The player as they look on foot, on the bike and in the kayak alike (pedestrians.js: the seed dresses them)
const PLAYER_LOOK = { seed: 4.2, scale: 1.0, girth: 1.02, hair: 0.18 };

// White wireless earbuds in the player's ears while their music plays (radio.js): in the head bone's space (+Y up the
// head, +Z the face, PersonRig.headPosition), a glossy bud in each ear with its short stem hanging down toward the jaw
const EARBUD_MAT = new THREE.MeshStandardNodeMaterial({ color: 0xf6f6f4, roughness: 0.22, metalness: 0.0 });
const EARBUD_GEO = (() => {
  const parts = [];
  for (const side of [-1, 1]) {
    const bud = new THREE.SphereGeometry(0.0105, 12, 8);
    bud.scale(0.8, 1, 1.05);
    bud.translate(side * 0.0925, 0.083, -0.004);
    const stem = new THREE.CapsuleGeometry(0.0036, 0.026, 3, 8);
    stem.rotateX(-0.28);
    stem.rotateZ(side * 0.1);
    stem.translate(side * 0.0935, 0.064, 0.002);
    parts.push(bud, stem);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
})();
function makeEarbuds(scene, who) {
  // the scene outlives a change to the code: take away the pair a previous run left in it
  for (const old of scene.children.filter((c) => c.name === `PlayerEarbuds-${who}`)) scene.remove(old);
  const m = new THREE.Mesh(EARBUD_GEO, EARBUD_MAT);
  m.name = `PlayerEarbuds-${who}`;
  m.visible = false;
  m.castShadow = false;
  scene.add(m);
  return m;
}
// set the earbuds on a rig's head as it's posed now, or hide them
function placeEarbuds(buds, rig, on) {
  buds.visible = Boolean(on && rig.headPosition);
  if (!buds.visible) return;
  buds.position.copy(rig.headPosition);
  buds.quaternion.copy(rig.headQuaternion);
  buds.scale.setScalar(rig.s);
}
// The walking camera, which the fall and the bus change for a while and give back
const WALK_CAMERA = { d: 4.8, h: 2.4, y: -0.35 };

const BICYCLE_DRIVE = {
  speed: 12.5, reverseSpeed: 4.5, acceleration: 9, // about 28 mph flat out on a road bike
  rolling: 0.08, drag: 0.004, coast: 0.2, brake: 7.5 // Backward input is scaled to 0.6, giving 4.5 m/s² braking.
};

function driveSpeed(speed, throttle, dt, drive) {
  // Turning can project tiny sideways motion back into speed after braking to zero.
  // Treat a crawl as stopped when changing direction, so this cannot hold the brakes forever.
  if (speed * throttle < 0 && Math.abs(speed) < 0.05) speed = 0;
  const braking = speed * throttle < 0;
  const magnitude = Math.abs(speed);
  // Extra resistance on release gives a stronger slowdown while coasting.
  const deceleration = drive.rolling + (!throttle ? drive.coast : braking ? Math.abs(throttle) * drive.brake : 0);
  // Constant rolling resistance and quadratic air drag, without crossing zero or large-dt instability.
  const coasting = Math.max(0, magnitude - deceleration * dt) / (1 + drive.drag * magnitude * dt);
  if (!throttle || braking) return Math.sign(speed) * coasting;

  const limit = throttle < 0 ? drive.reverseSpeed : drive.speed;
  let acceleration = drive.acceleration;
  if (drive.powerSpeed) acceleration *= drive.powerSpeed / Math.max(drive.powerSpeed, magnitude);
  // Collision momentum above the powered limit decays naturally instead of being clamped.
  return Math.sign(throttle) * Math.min(Math.max(limit, coasting), coasting + Math.abs(throttle) * acceleration * dt);
}

// Walking surface for the player's pedestrian (its rig samples it around its feet)
const personGround = (controllers, x, z) => controllers.getGroundHeight(x, z, 'person');
const RIDER_THROW_SPEED = 5.5;
// a motorbike that hits a wall or a car this hard (m/s closing, about 16 mph) throws its rider off
const MOTO_THROW_SPEED = 7;
const DIVE_GET_UP = 1.15; // where a dive's prone pause begins: a fallen body gets up from there
const hash01 = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function collisionBody(mode, radius, heading, margin = 0) {
  const car = mode === 'car';
  const sin = Math.sin(heading), cos = Math.cos(heading);
  const hx = playerBox[0] + margin, hz = playerBox[1] + margin;
  return {
    car, sin, cos, hx, hz, radius: radius + margin,
    extX: car ? Math.abs(cos) * hx + Math.abs(sin) * hz : radius + margin,
    extZ: car ? Math.abs(sin) * hx + Math.abs(cos) * hz : radius + margin,
    bottom: mode === 'helicopter' ? -0.25 : 0,
    top: mode === 'helicopter' ? 3.2 : car ? 1.8 : 1.9
  };
}

// The height of a building's roof at (x, z), or -Infinity outside it: a house's own pitched roofs (houses.js gives its
// collider their shapes), else the top of its outline
function roofHeightAt(c, x, z) {
  if (x < c.minX - 0.5 || x > c.maxX + 0.5 || z < c.minZ - 0.5 || z > c.maxZ + 0.5) return -Infinity;
  if (c.roofs) {
    let y = -Infinity;
    for (const R of c.roofs) {
      const dx = x - R.cx, dz = z - R.cz;
      const a = Math.abs(dx * R.ax + dz * R.az), b = dx * R.bx + dz * R.bz, ab = Math.abs(b);
      if (!(R.hb > 0.05) || a > R.ha + 0.3 || ab > R.hb + 0.45) continue;
      const k = Math.max(0, 1 - ab / R.hb);
      const h = R.type === 'flat' ? R.top + 0.35
        : R.type === 'hip' ? R.top + R.rh * Math.max(0, Math.min(k, (R.ha - a) / R.hb))
          : R.type === 'shed' ? R.top + R.rh * Math.max(0, Math.min(1, (R.high * b / R.hb + 1) / 2))
            : R.top + R.rh * k;
      y = Math.max(y, h);
    }
    return y;
  }
  if (c.polygon) return polygonContains(c.polygon, x, z) ? c.maxY : -Infinity;
  const o = c.obb;
  if (o) {
    const dx = x - o.cx, dz = z - o.cz;
    return Math.abs(dx * o.cs - dz * o.sn) <= o.hx && Math.abs(dx * o.sn + dz * o.cs) <= o.hz ? c.maxY : -Infinity;
  }
  return c.maxY;
}

// Where the car's wheels touch, [across, along] in metres from its middle
const CAR_CORNERS = [[0, 0], [-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]];

// Michigan Stadium's collider (landmarks.js), which keeps cars and people outside its wall but not the helicopter
const isStadium = (c) => !c.solid && (c.stadium || (c._bowl ??= !c.polygon && !c.obb
  && bowlSurface((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) !== null));

// Movement and teleports share exact footprint checks after rejecting distant bounds.
// Walking/cycling/flying use circles; cars use oriented rectangles.
function buildingContact(c, x, y, z, body, contact) {
  if (y + body.bottom >= c.maxY || y + body.top <= (c.minY ?? 0)) return false;
  if (x + body.extX <= c.minX || x - body.extX >= c.maxX || z + body.extZ <= c.minZ || z - body.extZ >= c.maxZ) return false;
  if (c.polygon) return polygonContact(c.polygon, x, z, body, contact);
  const o = c.obb;
  const cs = o ? o.cs : 1, sn = o ? o.sn : 0;
  const hx = o ? o.hx : (c.maxX - c.minX) * 0.5;
  const hz = o ? o.hz : (c.maxZ - c.minZ) * 0.5;
  const dx = x - (o ? o.cx : (c.minX + c.maxX) * 0.5);
  const dz = z - (o ? o.cz : (c.minZ + c.maxZ) * 0.5);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  let nx = 0, nz = 0, depth = Infinity;
  if (body.car) {
    const ls = body.sin * cs - body.cos * sn, lc = body.sin * sn + body.cos * cs;
    for (let axis = 0; axis < 4; axis++) {
      const ax = axis === 0 ? 1 : axis === 1 ? 0 : axis === 2 ? lc : ls;
      const az = axis === 0 ? 0 : axis === 1 ? 1 : axis === 2 ? -ls : lc;
      const distance = lx * ax + lz * az;
      const overlap = hx * Math.abs(ax) + hz * Math.abs(az)
        + body.hx * Math.abs(ax * lc - az * ls) + body.hz * Math.abs(ax * ls + az * lc) - Math.abs(distance);
      if (overlap <= 0) return false;
      if (overlap < depth) {
        depth = overlap;
        const sign = distance <= 0 ? -1 : 1;
        nx = ax * sign; nz = az * sign;
      }
    }
  } else {
    const qx = lx - Math.max(-hx, Math.min(hx, lx));
    const qz = lz - Math.max(-hz, Math.min(hz, lz));
    const distance = Math.hypot(qx, qz);
    if (distance >= body.radius) return false;
    if (distance > 0) {
      nx = qx / distance; nz = qz / distance;
      depth = body.radius - distance;
    } else if (hx - Math.abs(lx) <= hz - Math.abs(lz)) {
      nx = lx <= 0 ? -1 : 1;
      depth = hx - Math.abs(lx) + body.radius;
    } else {
      nz = lz <= 0 ? -1 : 1;
      depth = hz - Math.abs(lz) + body.radius;
    }
  }
  if (contact) {
    contact.nx = nx * cs + nz * sn;
    contact.nz = -nx * sn + nz * cs;
    contact.depth = depth;
  }
  return true;
}

// The player's car meeting something that doesn't move (a wall, a fence, a pole that stays up) as a rigid body: the
// impulse at the corner or face that touched, from its weight and its spin's lever arm, with a little bounce and the
// panels' sliding friction, so a glancing hit turns it along the wall and a hit at one corner spins it. Says the
// closing speed and the change of velocity it gave.
const wallHit = { closing: 0, dv: 0, x: 0, z: 0 };
function carWallImpulse(car, sin, cos, x, z, nx, nz, mass, hw = 0.86, hl = 2.18) {
  // the point of contact: the car's corners deepest into the wall, averaged (a flat face meets it along its middle)
  let min = Infinity, sx = 0, sz = 0, n = 0;
  for (let k = 0; k < 4; k++) {
    const a = (k & 1 ? 1 : -1) * hw, b = (k & 2 ? 1 : -1) * hl;
    const ox = cos * a + sin * b, oz = -sin * a + cos * b;
    const d = ox * nx + oz * nz;
    if (d < min - 0.12) { min = d; sx = ox; sz = oz; n = 1; }
    else if (d < min + 0.12) { if (d < min) min = d; sx += ox; sz += oz; n++; }
  }
  const ax = sx / n, az = sz / n;
  wallHit.x = x + ax; wallHit.z = z + az;
  let vx = sin * car.speed + (car.vx || 0), vz = cos * car.speed + (car.vz || 0), w = car.angularVel || 0;
  const closing = -((vx + w * az) * nx + (vz - w * ax) * nz);
  wallHit.closing = closing; wallHit.dv = 0;
  if (closing <= 0) return wallHit;
  const invM = 1 / mass, invI = 3 * invM / (hw * hw + hl * hl);
  const rn = az * nx - ax * nz;
  const j = (1 + (closing > 1.5 ? 0.18 : 0)) * closing / (invM + rn * rn * invI);
  vx += nx * j * invM; vz += nz * j * invM; w += rn * j * invI;
  const tx = nz, tz = -nx, rt = az * tx - ax * tz;
  const slide = (vx + w * az) * tx + (vz - w * ax) * tz;
  const jt = Math.max(-j * 0.45, Math.min(j * 0.45, -slide / (invM + rt * rt * invI)));
  vx += tx * jt * invM; vz += tz * jt * invM; w += rt * jt * invI;
  car.speed = vx * sin + vz * cos;
  car.vx = vx - sin * car.speed;
  car.vz = vz - cos * car.speed;
  car.angularVel = Math.max(-6, Math.min(6, w));
  wallHit.dv = j * invM;
  return wallHit;
}

function createGoBluePlateTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#17325f';
  ctx.textAlign = 'center';
  ctx.font = '800 18px Inter, Arial, sans-serif';
  ctx.fillText('MICHIGAN', 128, 26);
  ctx.font = '900 50px JetBrains Mono, monospace';
  ctx.fillText('GO BLU', 128, 84);
  ctx.font = '700 13px Inter, Arial, sans-serif';
  ctx.fillText('PURE MICHIGAN', 128, 114);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

class ThirdPersonControllerManager {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;
    this._colliderCells = null; // built on first use, see nearColliders()
    this.riverScale = 1; // how fast the Huron runs against its usual flow, from the USGS gauge (river-gauge.js)
    this.activeMode = 'car'; // 'person' | 'car' | 'cyclist' | 'helicopter'

    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false
    };

    this.entities = {
      person: this.createPersonEntity(),
      car: this.createCarEntity(),
      cyclist: this.createCyclistEntity(),
      helicopter: this.createHelicopterEntity(),
      kayak: this.createKayakEntity()
    };
    this.carLook = { ...OWN_CAR };

    Object.values(this.entities).forEach((ent) => {
      if (ent.mesh) {
        ent.mesh.traverse((child) => {
          if (
            child.isMesh &&
            !child.material?.isMeshBasicNodeMaterial &&
            child.material?.type !== 'MeshBasicNodeMaterial' &&
            !child.material?.transparent
          ) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    });

    // Lamp: whatever stands on the ground starts on it (terrain.js), not only the vehicle in use, which updates its own
    for (const key of ['person', 'car', 'cyclist']) {
      const e = this.entities[key];
      e.position.y = this.getGroundHeight(e.position.x, e.position.z, key);
      e.mesh.position.copy(e.position);
    }

    this.bindKeyboard();
  }

  setCollisionListener(listener) {
    this._collisionListener = typeof listener === 'function' ? listener : null;
    this._collisionEvent ??= { a: null, b: null, kind: '', x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, speed: 0 };
  }

  // Reuse one synchronous event; consumers must copy retained fields. Normal points from b toward a.
  reportCollision(a, b, kind, x, y, z, nx, ny, nz, speed) {
    if (!this._collisionListener || speed <= 0.5) return;
    const event = this._collisionEvent;
    event.a = a; event.b = b; event.kind = kind;
    event.x = x; event.y = y; event.z = z;
    event.nx = nx; event.ny = ny; event.nz = nz; event.speed = speed;
    this._collisionListener(event);
  }

  bindKeyboard() {
    const bindings = {
      forward: ['KeyW', 'ArrowUp'],
      backward: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      up: ['Space', 'KeyE'],
      down: ['KeyQ', 'KeyC']
    };
    const actionsByCode = new Map(Object.entries(bindings).flatMap(([action, codes]) => codes.map((code) => [code, action])));
    this._pressedCodes = new Set();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};

    const onKey = (e, isDown) => {
      const action = actionsByCode.get(e.code);
      if (!action || (isDown && isTypingInField(e))) return;
      if (isDown) this._pressedCodes.add(e.code);
      else this._pressedCodes.delete(e.code);
      // Releasing one binding must not cancel another key held for the same action.
      this._keyboardKeys[action] = bindings[action].some((code) => this._pressedCodes.has(code));
      this._blendInput(action);
    };

    window.addEventListener('keydown', (e) => onKey(e, true));
    window.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput();
    });
  }

  _blendInput(action) {
    const keyboard = this._keyboardKeys[action] || false;
    const touch = this._touchKeys[action] || false;
    const gamepad = this._gamepadKeys[action] || false;
    const strength = Math.max(keyboard, touch, gamepad);
    // Preserve digital button values while allowing either analog source to be strongest.
    this.keys[action] = keyboard === true || touch === true || gamepad === true ? true : strength || false;
  }

  _setAnalogInput(source, action, value) {
    if (!Object.hasOwn(this.keys, action)) return;
    const strength = Number(value);
    source[action] = typeof value === 'boolean' ? value : Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this._blendInput(action);
  }

  setTouchInput(action, value) {
    this._setAnalogInput(this._touchKeys, action, value);
  }

  setGamepadInput(action, value) {
    this._setAnalogInput(this._gamepadKeys, action, value);
  }

  clearTouchInput() {
    this._touchKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  clearGamepadInput() {
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this._blendInput(action);
  }

  resetInput() {
    this._pressedCodes.clear();
    this._keyboardKeys = {};
    this._touchKeys = {};
    this._gamepadKeys = {};
    for (const action of Object.keys(this.keys)) this.keys[action] = false;
  }

  setMode(mode) {
    if (!this.entities[mode]) return;
    const person = this.entities.person;
    if (person.onBus && mode !== 'person') this.getOffBus(this.traffic?.leaveBus());
    // On foot from inside something: out beside it
    const ridden = mode === 'person' && person.riding ? this.entities[person.riding] : null;
    person.riding = mode === 'person' ? null : person.riding;
    if (mode !== 'person' && person.chute) this.dropChute();
    this.activeMode = mode;
    if (ridden) {
      ridden.leftEmpty = true;
      this.placePersonBeside(ridden);
    }
    const active = this.entities[mode];
    if (active.mesh) active.mesh.visible = true;
    if (active.helmet) active.helmet.visible = true;
    if (mode === 'person') active._charHidden = false;
    else if (mode === 'cyclist') {
      active._riderHidden = false;
      active._posedX = NaN;
    } else if (mode === 'kayak') active._paddlerHidden = false;
    if (mode !== 'kayak' && this.entities.kayak) {
      for (const r of this.entities.kayak.ripples) r.age = 99;
      waterDisturb.wake.value.x = 0;
      this.updateRipples(this.entities.kayak, 0);
    }
    const car = this.entities.car;
    // a car left with a bike's ways by an earlier swap loses them
    if (car?.bike && this.carLook && !MOTO_SPECS[this.carLook.kind]) { car.riderMesh?.removeFromParent(); delete car.bike; delete car.quiet; delete car.riderMesh; delete car.riderPose; }
    if (mode !== 'car' && car?.carState) car.carState.value.x = car.carState.value.w = 0;
    if (car?.riderMesh) car.riderMesh.visible = mode === 'car';
  }

  getActiveEntity() {
    return this.entities[this.activeMode];
  }

  teleportActiveTo(x, z, heading = Math.PI, savedAltitude = null) {
    if (this.entities.person.onBus) { this.traffic?.leaveBus(); this.getOffBus(null); }
    const ent = this.getActiveEntity();
    this.resetInput();
    if (!Number.isFinite(heading)) heading = ent.heading;
    if (this.activeMode === 'kayak') {
      // in the Argo Cascades' channel, shallower than the river, it stays where it was put and faces as it was asked
      const inChannel = Number.isFinite(x) && Number.isFinite(z) && inCascades(x, z);
      const water = inChannel ? null : Number.isFinite(x) && Number.isFinite(z) ? nearestWater(x, z, 2500) : null;
      if (inChannel) {
        ent.position.set(x, waterLevel(x, z) ?? ent.position.y, z);
        ent.heading = heading;
      } else if (water) {
        ent.position.set(water.x, waterLevel(water.x, water.z) ?? ent.position.y, water.z);
        ent.heading = this.downstreamHeading(water.x, water.z, heading);
      }
      ent.speed = ent.driftX = ent.driftZ = ent.turnVel = 0;
      ent._paddlerHidden = false;
      ent.mesh.position.copy(ent.position);
      ent.mesh.rotation.y = ent.heading;
      return { x: ent.position.x, z: ent.position.z };
    }
    const heli = this.activeMode === 'helicopter';
    const altitude = heli ? Math.max(groundHeight(x, z) + 0.25, Math.min(HELI_CEILING, savedAltitude ?? Math.max(92, ent.position.y))) : 0;
    const destination = this.findTeleportPosition(x, z, heading, altitude);
    if (destination) {
      ent.position.x = destination.x;
      ent.position.z = destination.z;
      ent.heading = heading;
      ent.position.y = heli ? altitude : this.getGroundHeight(destination.x, destination.z, this.activeMode);
    }
    ent.speed = 0;
    ent.airborne = false; ent.vy = 0;
    if (this.activeMode === 'person') {
      ent.verticalVel = 0;
      ent._charHidden = false;
      if (ent.mesh) ent.mesh.visible = true;
      ent.fallen = null;
      if (ent.chute) this.dropChute();
      ent.rig.ragdolling = false;
      ent.rig.reset(ent.position.x, ent.position.z, ent.heading, personGround, this);
      ent.crowd.begin();
      ent.crowd.add(ent.rig, 0);
      ent.crowd.end();
    } else if (this.activeMode === 'car') {
      ent.prevX = ent.position.x;
      ent.prevZ = ent.position.z;
      ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
      ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
      ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
      ent.chassisPivot.position.y = 0;
      ent.lastCollisionSpark = null;
      for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
      if (ent.carState) ent.carState.value.x = ent.carState.value.w = 0;
    } else if (this.activeMode === 'cyclist') {
      ent.leanAngle = ent.leanPivot.rotation.z = 0;
      ent._riderHidden = false;
      ent._posedX = NaN;
      if (ent.helmet) ent.helmet.visible = true;
    } else if (heli) {
      ent.verticalSpeed = ent.pitchAngle = ent.rollAngle = 0;
      ent.tiltPivot.rotation.x = ent.tiltPivot.rotation.z = 0;
      ent.tiltPivot.position.y = 0;
    }
    ent.mesh.position.copy(ent.position);
    ent.mesh.rotation.y = ent.heading;
    return { x: ent.position.x, z: ent.position.z };
  }

  // Find a fully clear arrival before moving the player. Sequential collision pushes can leave a player trapped
  // between overlapping buildings, so test whole candidate footprints instead; retain the old position if none fits.
  findTeleportPosition(x, z, heading, altitude) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const heli = this.activeMode === 'helicopter';
    const radius = heli ? 4.5 : this.activeMode === 'person' ? 0.48 : 0.65;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const shape = collisionBody(this.activeMode, radius, heading, 0.1);
    const reach = Math.max(shape.extX, shape.extZ);
    const margin = heli ? 6000 : 0;
    const entity = this.getActiveEntity();
    // Conservative body cylinders, including the taxi's corners, bicycle wheels and helicopter tail/rotor.
    const body = { person: [0.48, 1.9], car: [2.4, 1.9], cyclist: [1.0, 1.9], helicopter: [6.2, 3.2], kayak: [1.9, 1.2] };
    const others = Object.values(this.entities).filter(e => e !== entity).map(e => ({
      x: e.position.x, z: e.position.z, radius: body[e.type][0],
      bottom: e.position.y - (e.type === 'helicopter' ? 0.7 : 0), top: e.position.y + body[e.type][1]
    }));
    const cameraBack = Math.cos(0.09) * entity.chaseDistance;
    const cameraUp = entity.chaseHeight + Math.sin(0.09) * entity.chaseDistance * 0.85;
    const clampPoint = (px, pz) => {
      pz = Math.max(TOWN_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(TOWN_BOUNDS.maxZ + (heli ? margin : 800), pz)); // (the airport's south of the edge)
      px = Math.max(TOWN_BOUNDS.minX - margin, Math.min(TOWN_BOUNDS.maxX + margin, px));
      if (!heli && onAirfield(px, pz)) return { x: px, z: pz }; // inside Ann Arbor Municipal's fence (airport.js)
      if (!heli && getTownBoundsAtZ) {
        const shore = getTownBoundsAtZ(pz);
        const west = shore.westX + 8, east = shore.eastX - 8;
        if (west > east) return null;
        px = Math.max(west, Math.min(east, px));
        if (!inTown(px, pz)) return null; // outside the city's limits: the plain land round it
      }
      return { x: px, z: pz };
    };
    const clear = (p) => {
      if (!p) return false;
      const baseY = heli ? altitude : this.getGroundHeight(p.x, p.z, this.activeMode);
      // Keep other player models out of both the arrival and its default chase view. A corridor also prevents a
      // parked car between camera and character from hiding the character even when the camera itself is outside it.
      const viewTop = baseY + Math.max(body[entity.type][1], cameraUp);
      for (const other of others) {
        if (other.bottom > viewTop + 0.3 || other.top < baseY - (heli ? 0.7 : 0) - 0.3) continue;
        const dx = other.x - p.x, dz = other.z - p.z;
        const back = Math.max(0, Math.min(cameraBack, -dx * sinH - dz * cosH));
        if (Math.hypot(dx + sinH * back, dz + cosH * back) < other.radius + Math.max(body[entity.type][0], 0.5) + 0.1) return false;
      }
      for (const c of this.nearColliders(p.x, p.z, reach)) {
        if (buildingContact(c, p.x, baseY, p.z, shape)) return false;
      }
      return true;
    };
    const origin = clampPoint(x, z);
    if (clear(origin)) return origin;
    // Four-metre rings cover nearby streets and courtyards, with bounded work even for a click inside a large block.
    const cx = origin ? origin.x : Math.max(TOWN_BOUNDS.minX, Math.min(TOWN_BOUNDS.maxX, x));
    const cz = origin ? origin.z : Math.max(TOWN_BOUNDS.minZ + 30, Math.min(TOWN_BOUNDS.maxZ, z));
    for (let distance = 4; distance <= 256; distance += 4) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const p = clampPoint(cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance);
        if (clear(p)) return p;
      }
    }
    return null;
  }

  // =========================================================================
  // 1. PERSON (SKINNED PEDESTRIAN WITH PLANTED-FOOTSTEP IK GAIT, see pedestrians.js)
  // =========================================================================
  createPersonEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerPerson';

    // One skinned person, posed in world space every frame by its rig (walk, run, turn, jump)
    const crowd = new PersonCrowd(1, { farDistance: Infinity });
    crowd.meshes.forEach((m) => this.scene.add(m));
    const rig = new PersonRig({ ...PLAYER_LOOK, armSwing: 1.0 });

    // Soft Under-Foot Contact Shadow (AO)
    const shadowGeo = new THREE.PlaneGeometry(0.85, 0.85);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const pedShadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial({ round: true }));
    pedShadow.position.y = 0.02;
    pedShadow.renderOrder = 998;
    root.add(pedShadow);

    this.scene.add(root);

    return {
      type: 'person',
      label: 'Pedestrian',
      mesh: root,
      crowd,
      rig,
      earbuds: makeEarbuds(this.scene, 'person'),
      position: new THREE.Vector3(-30.2, TOWN_BOUNDS.sidewalkHeight, SPAWN_Z + 12),
      heading: Math.PI,
      speed: 0,
      verticalVel: 0,
      cameraTargetOffset: new THREE.Vector3(0, WALK_CAMERA.y, 0),
      chaseDistance: WALK_CAMERA.d,
      chaseHeight: WALK_CAMERA.h
    };
  }

  // =========================================================================
  // 2. CAR (3D LOFTED BLACK COMPACT SUV, A SUBARU FORESTER'S LINES: ROOF RAILS, BLACK CLADDING)
  // =========================================================================
  createCarEntity(look = OWN_CAR, root = new THREE.Group(), reuseLights = null) {
    playerBox[0] = MACHINE_BOX[look.kind]?.[0] ?? 0.86; playerBox[1] = MACHINE_BOX[look.kind]?.[1] ?? 2.18;
    if (MOTO_SPECS[look.kind]) return this.createBikeEntity(look, root, reuseLights);
    if (MACHINES[look.kind]) return this.createMachineEntity(look, root, reuseLights);
    root.name = 'PlayerCar';
    const own = isOwnCar(look);

    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);

    const spec = BODY_SPECS[look.kind] || BODY_SPECS.forester;
    const taxiLoftMat = createLoftedCarMaterial(spec, look.hex);

    // 1. 3D Lofted SUV Body + Curved Windscreens + Crowned Roof + Side Mirrors + Roof Rails
    const carBodyGeo = buildCarGeometry(spec, false);
    const carBodyMesh = new THREE.Mesh(carBodyGeo, taxiLoftMat);
    carBodyMesh.castShadow = true;
    carBodyMesh.receiveShadow = true;
    chassisPivot.add(carBodyMesh);

    // 3. Michigan license plates on the raked bumpers, tilted to follow the fascias
    const nyPlateTex = own ? (this._goBluPlate ??= createGoBluePlateTexture()) : null;
    const nyPlateMat = own ? new THREE.MeshStandardNodeMaterial({ map: nyPlateTex, roughness: 0.28 }) : null;
    for (const front of own ? [true, false] : []) {
      const y = spec.plates[front ? 0 : 1];
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.008), nyPlateMat);
      plate.position.set(0, y, carTipZ(spec, y, front) + (front ? 0.003 : -0.003));
      plate.rotation.x = Math.atan((carTipZ(spec, y + 0.07, front) - carTipZ(spec, y - 0.07, front)) / 0.14);
      chassisPivot.add(plate);
    }

    // 3b. Brake, reverse & turn lights are lit by the taxi material from its carState uniform (see updateCar)
    const carState = taxiLoftMat.userData.carState;

    // 4. Steerable & Spinning 3D LatheGeometry Tyres + Recessed 5-Spoke Alloy Wheels
    const leftWheelGeo = buildSteerableWheelGeo(spec, -1);
    const rightWheelGeo = buildSteerableWheelGeo(spec, 1);
    const taxiWheelMat = createCarWheelMaterial({ wheelRadius: spec.wheelRadius });

    const wheels = [];
    const wheelCoords = [
      { side: -1, z: spec.wheelZ, isFront: true },
      { side: 1, z: spec.wheelZ, isFront: true },
      { side: -1, z: -spec.wheelZ, isFront: false },
      { side: 1, z: -spec.wheelZ, isFront: false }
    ];
    for (const wc of wheelCoords) {
      const steerPivot = new THREE.Group();
      steerPivot.position.set(wc.side * spec.wheelX, spec.wheelRadius, wc.z);
      const tire = new THREE.Mesh(wc.side < 0 ? leftWheelGeo : rightWheelGeo, taxiWheelMat);
      tire.castShadow = true;
      tire.receiveShadow = true;
      steerPivot.add(tire);
      root.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: wc.isFront });
    }

    // 5. Ground contact shadow and paired headlight spotlights
    const carShadowGeo = new THREE.PlaneGeometry(2.22, 5.05);
    carShadowGeo.rotateX(-Math.PI * 0.5);
    const carShadow = new THREE.Mesh(carShadowGeo, createContactShadowMaterial());
    carShadow.position.set(0, 0.02, 0.0);
    carShadow.renderOrder = 998;
    root.add(carShadow);

    // a car taken from a parking spot keeps the lights the player's car had (so no light is added to the scene)
    const headLights = [];
    for (const side of [-1, 1]) {
      const old = reuseLights?.[side < 0 ? 0 : 1];
      const spot = old || createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      if (!old || old.parent) chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }

    if (!root.parent) this.scene.add(root);

    const kindName = { sedan: 'Sedan', suv: 'SUV', minivan: 'Minivan', pickup: 'Pickup', van: 'Van', forester: 'Wagon', sports: 'Sports Car', tesla: 'EV Sport Sedan', ioniq: 'EV Hatch', cybertruck: 'Wedge Truck', r1s: 'EV SUV', r1t: 'EV Pickup' };
    return {
      type: 'car',
      label: own ? 'Your Car' : kindName[look.kind] || 'Car',
      mesh: root,
      chassisPivot,
      carState,
      headLights,
      wheels,
      position: new THREE.Vector3(-19.2, 0.0, SPAWN_Z + 12),
      prevX: -19.2,
      prevZ: SPAWN_Z + 12,
      heading: Math.PI,
      speed: 0,
      vx: 0,
      vz: 0,
      angularVel: 0,
      pitchVel: 0,
      rollVel: 0,
      heaveY: 0,
      heaveVel: 0,
      lastCollisionSpark: null,
      steerAngle: 0,
      wheelSpin: 0,
      cameraTargetOffset: new THREE.Vector3(0, 0.96, 0),
      chaseDistance: 6.9,
      chaseHeight: 2.12,
      drive: carDrive(look.kind)
    };
  }

  // A motorcycle taken from traffic or a parking spot rides as the car does (the same entity, mode and keys); its body
  // and rider lean in the chassis pivot, the front wheel steers and both spin (motorcycles.js)
  createBikeEntity(look, root, reuseLights = null) {
    root.name = 'PlayerCar';
    const spec = MOTO_SPECS[look.kind];
    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);
    const mat = createMotoMaterial(look.hex);
    const body = new THREE.Mesh(buildMotoGeometry(spec, true, false), mat);
    body.castShadow = body.receiveShadow = true;
    chassisPivot.add(body);
    // the player rides it themselves (their person posed on it, poseCharacters), in a helmet the bike's colour; it
    // shows only while they're on it
    const helmet = HELMET_OF[look.kind];
    const riderMesh = helmet ? new THREE.Mesh(buildHelmetGeometry(helmet), mat) : new THREE.Group();
    riderMesh.castShadow = true;
    riderMesh.visible = false;
    this.scene.add(riderMesh);
    const wheels = [];
    for (const front of [true, false]) {
      const steerPivot = new THREE.Group();
      // (a hoverboard's two wheels are side by side, neither steering)
      steerPivot.position.set(spec.side ? (front ? 1 : -1) * spec.side : 0, front ? spec.rf : spec.rr, (front ? 1 : -1) * spec.wb / 2);
      const tire = new THREE.Mesh(buildMotoWheel(spec, front), mat);
      tire.castShadow = tire.receiveShadow = true;
      steerPivot.add(tire);
      chassisPivot.add(steerPivot);
      wheels.push({ steerPivot, tire, isFront: front && !spec.side });
    }
    const shadowGeo = new THREE.PlaneGeometry(0.8, spec.wb + 0.9);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    shadow.position.set(0, 0.02, 0);
    shadow.renderOrder = 998;
    root.add(shadow);
    // one lamp; the second of the pair the car had stays dark beside it
    const headLights = [];
    for (const side of [-1, 1]) {
      const old = reuseLights?.[side < 0 ? 0 : 1];
      const spot = old || createVehicleHeadlight();
      placeVehicleHeadlight(spot, spec, side);
      if (side > 0) spot.intensity = 0;
      if (!old || old.parent) chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }
    if (!root.parent) this.scene.add(root);
    const names = { sportbike: 'Sport Bike', cruiser: 'Cruiser', scooter: 'Scooter', touring: 'Touring Bike', adventure: 'Adventure Bike',
      bicycle: 'Bicycle', ebike: 'E-Bike', escooter: 'E-Scooter', hoverboard: 'Hoverboard' };
    return {
      type: 'car',
      bike: true,
      // pedals, a battery and a motor in a wheel hub: no gearbox and no revs to read
      gears: !['bicycle', 'ebike', 'escooter', 'hoverboard'].includes(look.kind),
      quiet: !!spec.quiet,
      label: names[look.kind],
      mesh: root, chassisPivot, riderMesh, riderPose: motoRiderPose(look.kind), carState: mat.userData.carState, headLights, wheels,
      position: new THREE.Vector3(-19.2, 0.0, SPAWN_Z + 12), prevX: -19.2, prevZ: SPAWN_Z + 12,
      heading: Math.PI, speed: 0, vx: 0, vz: 0, angularVel: 0, pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0,
      lastCollisionSpark: null, steerAngle: 0, wheelSpin: 0,
      cameraTargetOffset: new THREE.Vector3(0, 0.9, 0),
      chaseDistance: 4.8,
      chaseHeight: 1.7,
      drive: carDrive(look.kind)
    };
  }

  // A dump truck or an excavator from the road work, driven as the car is: the same model as the ones at the digs, in
  // their worn, muddy material; the truck's wheels turn and its front pair steers, the excavator crawls on its tracks
  createMachineEntity(look, root, reuseLights = null) {
    root.name = 'PlayerCar';
    const truck = look.kind === 'dumptruck';
    const mat = this.roadWork?.material || new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 });
    const chassisPivot = new THREE.Group();
    root.add(chassisPivot);
    const stairs = look.kind === 'stairtruck';
    if (stairs) chassisPivot.add(buildStairTruck());
    else {
      const body = new THREE.Mesh(truck ? (this._truckGeo ??= dumpTruckGeo(false)) : (this._excavatorGeo ??= excavatorGeo()), mat);
      body.castShadow = body.receiveShadow = true;
      chassisPivot.add(body);
    }
    const wheels = [];
    if (truck) {
      for (const w of TRUCK_WHEELS) {
        const side = Math.sign(w.x);
        const steerPivot = new THREE.Group();
        steerPivot.position.set(w.x, 0.54, w.z);
        const key = `_truckWheel${w.front ? 'F' : 'R'}${side}`;
        const tire = new THREE.Mesh(this[key] ??= truckWheelGeo(!!w.front, side), mat);
        tire.castShadow = tire.receiveShadow = true;
        steerPivot.add(tire);
        root.add(steerPivot);
        wheels.push({ steerPivot, tire, isFront: !!w.front });
      }
    }
    const [hw, hl] = MACHINE_BOX[look.kind];
    const shadowGeo = new THREE.PlaneGeometry(hw * 2 + 0.3, hl * 2 + 0.4);
    shadowGeo.rotateX(-Math.PI * 0.5);
    const shadow = new THREE.Mesh(shadowGeo, createContactShadowMaterial());
    shadow.position.set(0, 0.02, truck ? -0.1 : stairs ? 0.3 : 0);
    shadow.renderOrder = 998;
    root.add(shadow);
    // the truck's headlamps in its fenders; the excavator's work lamps on its house
    const lamp = truck ? { headlight: [0.98, 1.42], zFront: 4.36 } : stairs ? { headlight: [0.82, 1.12], zFront: 5.56 } : { headlight: [0.7, 2.2], zFront: 0.75 };
    const headLights = [];
    for (const side of [-1, 1]) {
      const old = reuseLights?.[side < 0 ? 0 : 1];
      const spot = old || createVehicleHeadlight();
      placeVehicleHeadlight(spot, lamp, side);
      if (!old || old.parent) chassisPivot.add(spot, spot.target);
      headLights.push(spot);
    }
    if (!root.parent) this.scene.add(root);
    return {
      type: 'car',
      machine: look.kind,
      boxW: hw, boxL: hl,
      label: MACHINES[look.kind],
      gears: look.kind !== 'excavator', // it crawls on tracks
      mesh: root, chassisPivot, carState: null, headLights, wheels,
      position: new THREE.Vector3(-19.2, 0.0, SPAWN_Z + 12), prevX: -19.2, prevZ: SPAWN_Z + 12,
      heading: Math.PI, speed: 0, vx: 0, vz: 0, angularVel: 0, pitchVel: 0, rollVel: 0, heaveY: 0, heaveVel: 0,
      lastCollisionSpark: null, steerAngle: 0, wheelSpin: 0,
      cameraTargetOffset: new THREE.Vector3(0, truck ? 2.4 : stairs ? 3.2 : 2.6, 0),
      chaseDistance: truck ? 14 : stairs ? 15 : 12,
      chaseHeight: truck ? 4.6 : stairs ? 5.4 : 5,
      drive: carDrive(look.kind)
    };
  }

  // =========================================================================
  // 3. CYCLIST (3D LOFTED RIDER + ROAD/CITI BICYCLE)
  // =========================================================================
  createCyclistEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerCyclist';

    const leanPivot = new THREE.Group();
    root.add(leanPivot);

    const frameMat = createCarPaintMaterial(0x0078e8);
    const tireMat = new THREE.MeshStandardNodeMaterial({
      color: 0x181a1e,
      roughness: 0.60
    });
    const chromeMat = new THREE.MeshStandardNodeMaterial({
      color: 0xe0e8f0,
      roughness: 0.16,
      metalness: 0.78
    });
    const shortsMat = new THREE.MeshStandardNodeMaterial({
      color: 0x1c2028,
      roughness: 0.55
    });
    const helmetMat = new THREE.MeshStandardNodeMaterial({
      color: 0xf4f7fb,
      emissive: 0x181c22,
      roughness: 0.22,
      metalness: 0.25
    });

    const wheelTorusGeo = new THREE.TorusGeometry(0.35, 0.038, 12, 24);
    wheelTorusGeo.rotateY(Math.PI * 0.5);
    const rimTorusGeo = new THREE.TorusGeometry(0.31, 0.018, 8, 24);
    rimTorusGeo.rotateY(Math.PI * 0.5);

    const frontWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    frontWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    frontWheel.position.set(0, 0.38, 0.58);
    leanPivot.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelTorusGeo, tireMat);
    rearWheel.add(new THREE.Mesh(rimTorusGeo, chromeMat));
    rearWheel.position.set(0, 0.38, -0.58);
    leanPivot.add(rearWheel);

    // Rear red LED safety strobe on seatpost
    const tailLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff1e26 })
    );
    tailLed.position.set(0, 0.86, -0.32);
    leanPivot.add(tailLed);

    const topTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10), frameMat);
    topTube.rotation.x = Math.PI * 0.46;
    topTube.position.set(0, 0.78, 0.04);
    leanPivot.add(topTube);

    const downTube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.78, 10), frameMat);
    downTube.rotation.x = Math.PI * 0.28;
    downTube.position.set(0, 0.58, 0.16);
    leanPivot.add(downTube);

    const seatTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 10), frameMat);
    seatTube.rotation.x = -0.22;
    seatTube.position.set(0, 0.66, -0.22);
    leanPivot.add(seatTube);

    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 8, 10), shortsMat);
    saddle.rotation.x = Math.PI * 0.5;
    saddle.scale.set(1.15, 1.0, 0.55);
    saddle.position.set(0, 0.96, -0.28);
    leanPivot.add(saddle);

    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.68, 10), chromeMat);
    fork.rotation.x = -0.24;
    fork.position.set(0, 0.68, 0.48);
    leanPivot.add(fork);

    const handlebar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.48, 10), chromeMat);
    handlebar.rotation.z = Math.PI * 0.5;
    handlebar.position.set(0, 0.98, 0.40);
    leanPivot.add(handlebar);

    // Pedal cranks at the bottom bracket (they turn with the pedal phase, the pedals stay level)
    const bikeFrame = {
      seat: new THREE.Vector3(0, 0.98, -0.28),
      bars: new THREE.Vector3(0, 0.98, 0.4),
      gripHalf: 0.22,
      bracket: new THREE.Vector3(0, 0.34, -0.145),
      crankLength: 0.17
    };
    const crankPivot = new THREE.Group();
    crankPivot.position.copy(bikeFrame.bracket);
    const crankGeo = new THREE.BoxGeometry(0.016, bikeFrame.crankLength, 0.03).translate(0, -bikeFrame.crankLength / 2, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.018, 0.07);
    const pedals = [];
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.rotation.x = side > 0 ? 0 : Math.PI;
      const crank = new THREE.Mesh(crankGeo, chromeMat);
      crank.position.x = side * 0.065;
      const pedal = new THREE.Mesh(pedalGeo, tireMat);
      pedal.position.set(side * 0.1, -bikeFrame.crankLength, 0);
      arm.add(crank, pedal);
      crankPivot.add(arm);
      pedals.push(pedal);
    }
    leanPivot.add(crankPivot);

    // Skinned rider (see pedestrians.js), posed every frame with its hands on the grips and feet on the pedals; the
    // helmet rides on its head
    const riderCrowd = new PersonCrowd(1, { farDistance: Infinity });
    riderCrowd.meshes.forEach((m) => this.scene.add(m));
    const riderRig = new PersonRig(PLAYER_LOOK); // the player themselves, as dressed on foot
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), helmetMat);
    helmet.scale.set(0.95, 0.68, 1.28);
    this.scene.add(helmet);

    const bikeShadowGeo = new THREE.PlaneGeometry(0.85, 2.25);
    bikeShadowGeo.rotateX(-Math.PI * 0.5);
    const bikeShadow = new THREE.Mesh(bikeShadowGeo, createContactShadowMaterial());
    bikeShadow.position.set(0, 0.02, 0.0);
    bikeShadow.renderOrder = 998;
    root.add(bikeShadow);

    const headLight = new THREE.SpotLight(0xf2f7ff, 0, 20, 0.34, 0.76, 1.25);
    headLight.position.set(0, 1.32, 0.62);
    headLight.target.position.set(0, 0.0, 7.6);
    leanPivot.add(headLight, headLight.target);

    this.scene.add(root);

    return {
      type: 'cyclist',
      label: 'Cyclist',
      mesh: root,
      leanPivot,
      frontWheel,
      rearWheel,
      crankPivot,
      pedals,
      bikeFrame,
      riderCrowd,
      riderRig,
      helmet,
      earbuds: makeEarbuds(this.scene, 'cyclist'),
      headLight,
      position: new THREE.Vector3(-18.2, 0.0, SPAWN_Z - 8),
      heading: Math.PI,
      speed: 0,
      leanAngle: 0,
      pedalPhase: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.35, 0),
      chaseDistance: 4.8,
      chaseHeight: 2.05
    };
  }

  // =========================================================================
  // 4. HELICOPTER (3D LOFTED SIGHTSEEING TWIN-TURBINE CHOPPER)
  // =========================================================================
  createHelicopterEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerHelicopter';

    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const heliLoftMat = createLoftedHelicopterMaterial();
    const blurDiscMat = new THREE.MeshBasicNodeMaterial({
      color: 0xc8d8e8,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    // 1. 3D Lofted Monocoque Fuselage + Tailboom + Twin-Turbine Cowling + Swept Fin + Stabilizers + Tubular Skids
    const heliBodyGeo = buildHelicopterBodyGeometry();
    const heliBodyMesh = new THREE.Mesh(heliBodyGeo, heliLoftMat);
    heliBodyMesh.castShadow = true;
    heliBodyMesh.receiveShadow = true;
    tiltPivot.add(heliBodyMesh);

    // 2. 4-Blade Main Rotor Assembly with Swashplate, Hub Dome & Yellow Safety Blade Tips
    const mainRotorPivot = new THREE.Group();
    mainRotorPivot.position.set(0, 2.66, -0.35);
    const mainRotorGeo = buildHelicopterMainRotorGeometry();
    const mainRotorMesh = new THREE.Mesh(mainRotorGeo, heliLoftMat);
    mainRotorMesh.castShadow = true;
    mainRotorPivot.add(mainRotorMesh);

    const blurDisc = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.85, 0.015, 32), blurDiscMat);
    mainRotorPivot.add(blurDisc);
    tiltPivot.add(mainRotorPivot);

    // 3. 4-Blade Tail Rotor Assembly on Swept Vertical Fin
    const tailRotorPivot = new THREE.Group();
    tailRotorPivot.position.set(0.18, 2.02, -5.62);
    const tailRotorGeo = buildHelicopterTailRotorGeometry();
    const tailRotorMesh = new THREE.Mesh(tailRotorGeo, heliLoftMat);
    tailRotorPivot.add(tailRotorMesh);
    tiltPivot.add(tailRotorPivot);

    // 4. FAA Port (Red), Starboard (Green) & Anti-Collision Fin Beacon (Red) Navigation Strobes
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff2b2b })
    );
    navRed.position.set(-1.09, 1.54, -4.35);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0x22ff66 })
    );
    navGreen.position.set(1.09, 1.54, -4.35);
    const navTail = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 8, 8),
      new THREE.MeshBasicNodeMaterial({ color: 0xff3b2b })
    );
    navTail.position.set(0, 2.84, -6.04);
    tiltPivot.add(navRed, navGreen, navTail);

    this.scene.add(root);

    return {
      type: 'helicopter',
      label: 'Helicopter',
      mesh: root,
      tiltPivot,
      mainRotorPivot,
      tailRotorPivot,
      position: new THREE.Vector3(-140, 96, SPAWN_Z + 80),
      heading: 2.6,
      speed: 0,
      verticalSpeed: 0,
      pitchAngle: 0,
      rollAngle: 0,
      cameraTargetOffset: new THREE.Vector3(0, 1.55, 0),
      chaseDistance: 11.4,
      chaseHeight: 3.3
    };
  }

  // The player's car becomes another (a parked car they got into): its body, paint and lights made again on the same root
  restyleCar(look) {
    const car = this.entities.car;
    if (!look || !(BODY_SPECS[look.kind] || MOTO_SPECS[look.kind] || MACHINES[look.kind])) return;
    const root = car.mesh;
    const lights = car.headLights;
    for (const spot of lights || []) { spot.removeFromParent(); spot.target.removeFromParent(); }
    for (const child of [...root.children]) root.remove(child);
    const fresh = this.createCarEntity(look, root, lights);
    const { position, heading } = car;
    // what only a bike has goes with it, so a car after a bike neither leans like one nor throws its driver
    car.riderMesh?.removeFromParent();
    delete car.bike; delete car.quiet; delete car.riderMesh; delete car.riderPose; delete car.machine; delete car.boxW; delete car.boxL;
    this._motoThrow = 0;
    Object.assign(car, fresh, { position, heading, prevX: position.x, prevZ: position.z });
    root.traverse((child) => {
      if (child.isMesh && !child.material?.transparent && !child.material?.isMeshBasicNodeMaterial) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    this.carLook = { kind: look.kind, hex: look.hex, style: look.style ?? 0 };
    root.position.copy(position);
    root.rotation.y = heading;
    root.updateMatrixWorld(true);
  }

  // The car where it is now, standing still
  stopCar(ent = this.entities.car) {
    ent.prevX = ent.position.x;
    ent.prevZ = ent.position.z;
    ent.speed = ent.vx = ent.vz = ent.angularVel = ent.steerAngle = 0;
    ent.pitchVel = ent.rollVel = ent.heaveY = ent.heaveVel = 0;
    ent.chassisPivot.rotation.x = ent.chassisPivot.rotation.z = 0;
    ent.chassisPivot.position.y = 0;
    ent.lastCollisionSpark = null;
    for (const wheel of ent.wheels) if (wheel.isFront) wheel.steerPivot.rotation.y = 0;
    if (ent.carState) ent.carState.value.x = ent.carState.value.w = 0;
  }

  // =========================================================================
  // 5. KAYAK (A RED SIT-IN TOURING KAYAK, ITS PADDLER AND A TWO-BLADED PADDLE)
  // =========================================================================
  createKayakEntity() {
    const root = new THREE.Group();
    root.name = 'PlayerKayak';
    const tiltPivot = new THREE.Group();
    root.add(tiltPivot);

    const hullMat = createCarPaintMaterial(0xc8372a);
    const deckMat = createCarPaintMaterial(0xe0533a);
    const darkMat = new THREE.MeshStandardNodeMaterial({ color: 0x15171a, roughness: 0.75 });
    const shaftMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.5 });
    const bladeMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2c230, roughness: 0.45 });

    // The hull and deck: halves of a long ellipsoid, narrowed to points at the bow and stern and rising a little there
    const L = 1.85, B = 0.36;
    const shape = (geo, height) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, Math.abs(pos.getZ(i)));
        pos.setXYZ(i, pos.getX(i) * B * (1 - 0.55 * t * t), pos.getY(i) * height * (1 - 0.25 * t * t) + 0.1 + 0.09 * t ** 3, pos.getZ(i) * L);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const hull = new THREE.Mesh(shape(new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0.2), hullMat);
    const deck = new THREE.Mesh(shape(new THREE.SphereGeometry(1, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.12), deckMat);
    const cockpit = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2).scale(0.23, 1, 0.37), darkMat);
    cockpit.position.set(0, 0.232, -0.12);
    const coaming = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 28).rotateX(Math.PI / 2).scale(0.24, 0.3, 0.38), darkMat);
    coaming.position.set(0, 0.236, -0.12);
    tiltPivot.add(hull, deck, cockpit, coaming);

    // The paddle: a shaft across the paddler's lap with a blade at each end, turned about by the stroke (see updateKayak)
    const paddle = new THREE.Group();
    paddle.position.set(0, 0.58, 0.16);
    paddle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.1, 8).rotateZ(Math.PI / 2), shaftMat));
    // each blade a touring paddle's: narrow at the throat on the shaft, flaring to a broad rounded tip, a little
    // asymmetric (the top edge longer), with softened edges
    const outline = new THREE.Shape();
    outline.moveTo(0, -0.022);
    outline.bezierCurveTo(0.12, -0.03, 0.2, -0.078, 0.3, -0.082);
    outline.bezierCurveTo(0.42, -0.086, 0.47, -0.05, 0.47, 0.0);
    outline.bezierCurveTo(0.47, 0.06, 0.41, 0.092, 0.3, 0.09);
    outline.bezierCurveTo(0.18, 0.088, 0.1, 0.03, 0, 0.022);
    outline.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 })
      .translate(0, 0, -0.003);
    for (const end of [1, -1]) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.x = end * 0.8;
      if (end < 0) blade.rotation.y = Math.PI;
      paddle.add(blade);
    }
    tiltPivot.add(paddle);

    // A pedal boat from the Gallup Park livery (gallup-livery.js), worn instead of the kayak when one's taken there
    const pedal = pedalBoatGeometry();
    const pedalBoat = new THREE.Group();
    pedalBoat.name = 'PlayerPedalBoat';
    pedalBoat.add(new THREE.Mesh(pedal.hull, createCarPaintMaterial(0x2f7fd0)),
      new THREE.Mesh(pedal.seats, new THREE.MeshStandardNodeMaterial({ color: 0xdcdcd6, roughness: 0.5 })),
      new THREE.Mesh(pedal.trim, new THREE.MeshStandardNodeMaterial({ color: 0x3a3f44, roughness: 0.5 })));
    const pedalWheel = new THREE.Mesh(pedal.wheel, new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f0, roughness: 0.5 }));
    pedalWheel.position.set(0, 0.14, -1.0);
    pedalBoat.add(pedalWheel);
    pedalBoat.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    pedalBoat.visible = false;
    tiltPivot.add(pedalBoat);

    // The paddler (see pedestrians.js), sitting in the cockpit with their hands on the shaft
    const paddlerCrowd = new PersonCrowd(1, { farDistance: Infinity });
    paddlerCrowd.meshes.forEach((m) => this.scene.add(m));
    const paddlerRig = new PersonRig(PLAYER_LOOK);

    const kayakShadowGeo = new THREE.PlaneGeometry(0.9, 3.9);
    kayakShadowGeo.rotateX(-Math.PI * 0.5);
    const kayakShadow = new THREE.Mesh(kayakShadowGeo, createContactShadowMaterial());
    kayakShadow.position.set(0, 0.015, 0);
    kayakShadow.renderOrder = 998;
    root.add(kayakShadow);


    this.scene.add(root);

    // Where a blade goes in and comes out, the water ripples in rings, spreading and fading as the current carries
    // them off (updateRipples sets them on the water's own surface, tsl-materials.js)
    const ripples = Array.from({ length: WATER_RIPPLES }, () => ({ x: 0, z: 0, age: 99, strength: 0 }));

    const launch = nearestWater(KAYAK_LAUNCH.x, KAYAK_LAUNCH.z, 400) || KAYAK_LAUNCH;
    const y = waterLevel(launch.x, launch.z) ?? groundHeight(launch.x, launch.z);
    return {
      type: 'kayak',
      label: 'Kayak',
      mesh: root,
      tiltPivot,
      paddle,
      kayakParts: [hull, deck, cockpit, coaming, paddle],
      pedalBoat,
      pedalWheel,
      boat: 'kayak',
      ripples,
      paddlerCrowd,
      paddlerRig,
      earbuds: makeEarbuds(this.scene, 'kayak'),
      seat: new THREE.Vector3(0, 0.02, -0.14),
      hands: [new THREE.Vector3(), new THREE.Vector3()],
      twist: 0,
      position: new THREE.Vector3(launch.x, y, launch.z),
      heading: this.downstreamHeading(launch.x, launch.z, Math.PI / 2),
      speed: 0,
      driftX: 0,
      driftZ: 0,
      turnVel: 0,
      leftEmpty: true, // it waits at the livery until someone gets in
      stroke: 0,
      strokeAmp: 0,
      strokes: 0,
      cameraTargetOffset: new THREE.Vector3(0, 0.85, 0),
      chaseDistance: 7.6,
      chaseHeight: 2.3
    };
  }

  // The player's boat as a kayak or as a pedal boat from the Gallup Park livery: its hull, and where the paddler sits
  dressBoat(kind) {
    const k = this.entities.kayak;
    k.boat = kind === 'paddleboat' ? 'paddleboat' : 'kayak';
    const pedal = k.boat === 'paddleboat';
    for (const o of k.kayakParts) o.visible = !pedal;
    k.pedalBoat.visible = pedal;
    k.seat.set(pedal ? 0.32 : 0, pedal ? 0.26 : 0.02, pedal ? -0.22 : -0.14);
    k.label = pedal ? 'Pedal boat' : 'Kayak';
  }

  // The way downstream at (x, z) as a heading, or `fallback` where the water doesn't run
  downstreamHeading(x, z, fallback = 0) {
    const flow = this._flow ??= { x: 0, z: 0 };
    return riverFlow(x, z, flow) ? Math.atan2(flow.x, flow.z) : fallback;
  }

  // On foot beside what the player was in: the car's driver's side (or the other, or behind or in front of it), the
  // bike's or the helicopter's side; out of a boat onto a dock or bank within a step, else into the water beside it
  placePersonBeside(v) {
    const p = this.entities.person;
    const shape = collisionBody('person', 0.48, 0, 0.05);
    // (up a parking structure, beside it on the same deck)
    p.position.y = v.position.y;
    const decked = this.parking?.inside(v.position.x, v.position.z) && v.position.y > groundHeight(v.position.x, v.position.z) + 2;
    const free = (x, z) => {
      if (riverDepth(x, z) > 0.02 && !(this.livery?.dockTop(x, z) > -Infinity) && !(this.docks?.dockTop(x, z) > -Infinity)) return false;
      const y = this.getGroundHeight(x, z, 'person');
      if (decked && Math.abs(y - v.position.y) > 1.2) return false;
      const inBowl = carSurface(x, z) !== null;
      for (const c of this.nearColliders(x, z, 3)) if (!(inBowl && isStadium(c)) && buildingContact(c, x, y, z, shape)) return false;
      return true;
    };
    const sn = Math.sin(v.heading), cs = Math.cos(v.heading);
    let spot = null;
    if (v.type === 'kayak') {
      // a dock or the bank within a step of the boat is climbed out onto
      for (let r = 1.2; r <= 3 && !spot; r += 0.6) {
        for (let i = 0; i < 24; i++) {
          const a = v.heading + Math.PI / 2 + i * Math.PI / 12;
          const x = v.position.x + Math.sin(a) * r, z = v.position.z + Math.cos(a) * r;
          if (free(x, z)) { spot = { x, z }; break; }
        }
      }
      // out in open water: over the side and into it, beside the boat, swimming (or standing, where it's shallow)
      if (!spot) {
        const wide = v.boat === 'paddleboat' ? 1.6 : 1.1;
        for (const s of [wide, -wide, wide + 0.8, -(wide + 0.8)]) {
          const x = v.position.x + cs * s, z = v.position.z - sn * s;
          if (riverDepth(x, z) > 0.08 && !(this.livery?.dockTop(x, z) > -Infinity) && !(this.docks?.dockTop(x, z) > -Infinity)) { spot = { x, z, wet: true }; break; }
        }
      }
    } else {
      const side = v.type === 'car' ? 1.75 : v.type === 'helicopter' ? 2.4 : 0.8;
      const end = v.type === 'car' ? 3.4 : v.type === 'helicopter' ? 7.5 : 1.6;
      for (const [s, f] of [[side, 0.4], [-side, 0.4], [0, -end], [0, end]]) {
        const x = v.position.x + cs * s + sn * f, z = v.position.z - sn * s + cs * f;
        if (free(x, z)) { spot = { x, z }; break; }
      }
    }
    const heading = v.type === 'kayak' && spot && !spot.wet ? Math.atan2(spot.x - v.position.x, spot.z - v.position.z) : v.heading;
    if (!spot) {
      this.teleportActiveTo(v.position.x, v.position.z, heading);
      return;
    }
    p.position.set(spot.x, this.getGroundHeight(spot.x, spot.z, 'person'), spot.z);
    p.heading = heading;
    p.speed = 0;
    p.verticalVel = 0;
    if (spot.wet) {
      // in over their head they go under a little and bob up swimming (updatePerson's swim)
      const level = waterLevel(spot.x, spot.z);
      if (level != null && level - p.position.y > 1.3) {
        p.position.y = Math.max(p.position.y, level - 1.3);
        p.swimming = true;
        p.grounded = false;
        log('[swim] over the side of the boat');
      }
    }
    p._charHidden = false;
    if (p.mesh) p.mesh.visible = true;
    p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
    p.crowd.begin();
    p.crowd.add(p.rig, 0);
    p.crowd.end();
    p.mesh.position.copy(p.position);
    p.mesh.rotation.y = p.heading;
  }

  // F: out of whatever the player is in, or into the nearest thing to get into (their car, the bike, the kayak, the
  // helicopter, a parked car (`parked` finds one) or one going by in `traffic`). Says which mode to switch to, and the parked car to take; null
  // when there's nothing near to get into (or the helicopter is still in the air).
  // How getting out would go now: 'chute' or 'drop' out of the helicopter in the air, 'thrown' out of a car on the
  // move, null for stepping out
  exitJump() {
    const mode = this.activeMode, v = this.getActiveEntity();
    if (mode === 'helicopter') {
      const up = v.position.y - this.helicopterFloor(v, v.position.y);
      if (up > 0.8) return up > CHUTE_HEIGHT ? 'chute' : 'drop';
    }
    if (mode === 'car' && Math.hypot(v.speed, v.vx || 0, v.vz || 0) > EXIT_SPEED) return 'thrown';
    return null;
  }

  enterOrExit(parked = null, traffic = null) {
    const mode = this.activeMode;
    const p = this.entities.person;
    if ((p.fallen || p.chute) && mode === 'person') return null;
    if (mode !== 'person') {
      const v = this.getActiveEntity();
      // out of the helicopter in the air: a jump, under a parachute from high up; out of a car on the move: thrown
      // out the door at its speed, and it rolls on without anyone (bailOut)
      const jump = this.exitJump();
      if (jump) { p.riding = mode; return { mode: 'person', jump }; }
      v.speed = 0;
      if (mode === 'car') this.stopCar(v);
      if (mode === 'helicopter') v.verticalSpeed = 0;
      if (mode === 'kayak') v.driftX = v.driftZ = v.turnVel = 0;
      p.riding = mode;
      return { mode: 'person' };
    }
    let best = null, score = Infinity;
    // what the player faces counts as nearer, what's behind them farther: of two cars in reach, the one ahead is taken
    const fs = Math.sin(p.heading), fc = Math.cos(p.heading);
    const facing = (x, z) => {
      const dx = x - p.position.x, dz = z - p.position.z, d = Math.hypot(dx, dz);
      return d < 0.3 ? 1 : 1 - 0.45 * ((dx * fs + dz * fc) / d);
    };
    const consider = (m, x, z, reach, car = null) => {
      const d = Math.hypot(x - p.position.x, z - p.position.z) / reach;
      if (d >= 1) return;
      const s = d * facing(x, z);
      if (s < score) { score = s; best = { mode: m, parked: car }; }
    };
    for (const [m, reach] of [['car', 4.2], ['cyclist', 2.4], ['kayak', 7], ['helicopter', 7.5]]) {
      const e = this.entities[m];
      // airstairs left standing are taken back as the airport's (nearestStairs below)
      if (m === 'car' && e.machine === 'stairtruck' && !this.airport?.stairsHeld && this.airport?.nearestStairs?.(e.position.x, e.position.z, 1)) continue;
      if (m === 'helicopter' && e.position.y - this.helicopterFloor(e, e.position.y) > 0.8) continue;
      consider(m, e.position.x, e.position.z, reach);
    }
    // a kayak pulled up on the bank at a put-in (kayak-launches.js)
    const beach = this.kayakLaunches?.nearest(p.position.x, p.position.z, 3);
    if (beach && beach.d / 3 * facing(beach.x, beach.z) < score) { score = beach.d / 3 * facing(beach.x, beach.z); best = { mode: 'kayak', beach }; }
    // a rental kayak or pedal boat at the Gallup Park livery (gallup-livery.js)
    const boat = this.livery?.nearest(p.position.x, p.position.z, 3.2);
    if (boat && boat.d / 3.2 * facing(boat.x, boat.z) < score) { score = boat.d / 3.2 * facing(boat.x, boat.z); best = { mode: 'kayak', boat }; }
    // a canoe, kayak or rowboat tied up at a dock (boat-docks.js)
    const tied = this.docks?.nearest(p.position.x, p.position.z, 3.2);
    if (tied && tied.d / 3.2 * facing(tied.x, tied.z) < score) { score = tied.d / 3.2 * facing(tied.x, tied.z); best = { mode: 'kayak', tied }; }
    // a bike on a rack or an e-bike at a dock by the Diag (bike-racks.js)
    const rack = this.bikeRacks?.nearest(p.position.x, p.position.z, 1.8, facing);
    if (rack && rack.d / 1.8 * facing(rack.x, rack.z) < score) { score = rack.d / 1.8 * facing(rack.x, rack.z); best = { mode: 'car', rack }; }
    // a rental e-scooter standing on its kickstand (scooters.js), ridden off the same way
    const scoot = this.scooters?.nearest(p.position.x, p.position.z, 1.8, facing);
    if (scoot && scoot.d / 1.8 * facing(scoot.x, scoot.z) < score) { score = scoot.d / 1.8 * facing(scoot.x, scoot.z); best = { mode: 'car', rack: scoot }; }
    // a helicopter parked at the airport (airport.js)
    const pad = this.airport?.nearest(p.position.x, p.position.z, 7.5, facing);
    if (pad && pad.d / 7.5 * facing(pad.x, pad.z) < score) { score = pad.d / 7.5 * facing(pad.x, pad.z); best = { mode: 'helicopter', pad }; }
    const near = parked?.nearest(p.position.x, p.position.z, 4.2, (c) => facing(c.x, c.z));
    if (near) consider('car', near.x, near.z, 4.2, near);
    // a dump truck or excavator at the road work, from beside its cab or tracks
    const mach = this.roadWork?.nearestMachine(p.position.x, p.position.z, 2.5);
    if (mach && mach.d / 2.5 * facing(mach.x, mach.z) < score) { score = mach.d / 2.5 * facing(mach.x, mach.z); best = { mode: 'car', machine: mach }; }
    // the airport's rolling airstairs, from beside the truck (airport.js)
    const st = this.airport?.nearestStairs?.(p.position.x, p.position.z, 2.5);
    if (st && st.d / 2.5 * facing(st.x, st.z) < score) { score = st.d / 2.5 * facing(st.x, st.z); best = { mode: 'car', stairs: st }; }
    // a car going by in traffic (traffic.js), within reach
    const passing = traffic?.nearestCar(p.position.x, p.position.z, 5);
    if (passing != null && passing / 5 < Math.min(1, score)) { score = passing / 5; best = { mode: 'car', moving: true }; }
    if (best) {
      p.riding = best.mode;
      this.entities[best.mode].leftEmpty = false;
    }
    return best;
  }

  // On a raised curb island (city-config.js BLOCKS: the real blocks, malls & plazas), not in a park
  isPointOnSidewalk(x, z) {
    const b = blockAt(x, z);
    return !!b && !(b.park > 0.6 && !b.median);
  }

  // Up on something driven like a ramp at (x, z), or -Infinity: a road work's dirt pile (road-work.js pileTop) or a
  // playground's wave slide and deck (playgrounds.js, on the lawn's lift)
  rampTop(x, z) {
    // and the airport's rolling airstairs (airport.js stairTop), run up and jumped off the landing
    // and the river's footbridges (terrain.js footbridgeTop), walked and ridden over
    // and the Gallup Park livery's docks (gallup-livery.js dockTop), and the river's other docks (boat-docks.js)
    // and the skate park's bowl, quarter pipes, funbox and blocks (skate-park.js), and the mountain bike trails' berms,
    // logs and tabletops (mtb-trails.js)
    const pile = Math.max(this.roadWork?.pileTop(x, z) ?? -Infinity, this.airport?.stairTop?.(x, z) ?? -Infinity, footbridgeTop(x, z),
      this.livery?.dockTop(x, z) ?? -Infinity, this.docks?.dockTop(x, z) ?? -Infinity, this.skatePark?.top(x, z) ?? -Infinity,
      this.mtbTrails?.top(x, z) ?? -Infinity);
    const play = this.playTop ? this.playTop(x, z) : -Infinity;
    return play > -Infinity ? Math.max(pile, groundHeight(x, z) + 0.19 + play) : pile;
  }

  getGroundHeight(x, z, mode = 'person', y) {
    // Lamp: the ground's own height there (terrain.js), with what's laid on it, and up on a road work's dirt pile
    // (road-work.js pileTop), which is driven and walked over like a ramp
    // and on the airport's pavement, laid over the town's lawn (airport.js PAVE)
    // in a swimming pool: its floor (pools.js), under its water
    const pool = mode !== 'kayak' && this.pools?.at(x, z);
    if (pool) return pool.floor(x, z);
    const base = groundHeight(x, z) + (mode !== 'kayak' && onAirfield(x, z) ? PAVE + 0.04 : 0);
    let ground = Math.max(base, mode === 'kayak' ? -Infinity : this.rampTop(x, z));
    // up a parking structure: the deck or ramp under them, the highest within a step of where they are now (their
    // own height, else that mode's player's; -Infinity for the ground itself) (parking-structures.js)
    if (this.parking && mode !== 'kayak') ground = Math.max(ground, this.parking.top(x, z, y ?? this.entities?.[mode]?.position.y));
    // Inside a big park drawn on its own (none in Ann Arbor: city-config.js BIG_PARK_BOUNDS is far away)
    const cp = BIG_PARK_BOUNDS;
    if (x > cp.minX && x < cp.maxX && z > cp.minZ && z < cp.maxZ) {
      return ground + 1.24;
    }
    // Inside Bryant Park's Great Lawn (west of the New York Public Library, 40th-42nd St), which stands level
    const lawn = bryantParkLawn;
    if (lawn && x > lawn.minX && x < lawn.maxX && z > lawn.minZ && z < lawn.maxZ) {
      return lawn.top;
    }
    // on foot inside Michigan Stadium's wall: on its field, its rows (as one slope) and its parapet, as a car is
    if (mode === 'person') {
      const st = carSurface(x, z);
      if (st !== null) return stadiumGround() + st;
      return Math.max(ground + (this.isPointOnSidewalk(x, z) ? TOWN_BOUNDS.sidewalkHeight : 0.0), this.railways?.trackTop(x, z) ?? -Infinity);
    }
    if (mode === 'kayak') return waterLevel(x, z) ?? ground;
    // over a railroad track: up on its ballast and ties, not sunk into them (railways.js)
    const track = this.railways ? this.railways.trackTop(x, z) : -Infinity;
    // a car inside Michigan Stadium's wall is on its field, stands or parapet
    if (mode === 'car') {
      const s = carSurface(x, z);
      if (s !== null) return stadiumGround() + s;
    }
    return Math.max(ground, track);
  }

  // Static colliders within `r` of (x, z), kept in their original order and indexed once into 48 m cells.
  nearColliders(x, z, r) {
    const CELL = 48;
    const key = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
    if (!this._colliderCells) {
      this._colliderCells = new Map();
      this.colliders.forEach((c, i) => {
        c._order = i;
        for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
          for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
            const k = key(ix, iz);
            let list = this._colliderCells.get(k);
            if (!list) this._colliderCells.set(k, (list = []));
            list.push(c);
          }
        }
      });
      this._nearList = [];
      this._nearStamp = 0;
    }
    const out = this._nearList;
    out.length = 0;
    const stamp = ++this._nearStamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this._colliderCells.get(key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c._seen === stamp) continue;
          c._seen = stamp;
          out.push(c);
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a._order - b._order);
    return out;
  }

  resolveHorizontalCollision(pos, radius, carEntity = null, entity = carEntity) {
    // The detailed town (the helicopter may roam out over the countryside around it)
    const heli = this.activeMode === 'helicopter';
    const m = heli ? 6000 : 0;
    pos.x = Math.max(TOWN_BOUNDS.minX - m, Math.min(TOWN_BOUNDS.maxX + m, pos.x));
    pos.z = Math.max(TOWN_BOUNDS.minZ + (heli ? -6000 : 30), Math.min(TOWN_BOUNDS.maxZ + (heli ? m : 800), pos.z)); // (the airport's south of the edge)
    // inside Ann Arbor Municipal's fence (airport.js), past the town's edge: that's walked and driven on too
    const field = this.activeMode !== 'helicopter' && onAirfield(pos.x, pos.z);
    if (field) { const kept = (this._lastInTown ??= new Map()), key = entity || this.activeMode, last = kept.get(key); if (last) { last.x = pos.x; last.z = pos.z; } else kept.set(key, { x: pos.x, z: pos.z }); }
    if (this.activeMode !== 'helicopter' && getTownBoundsAtZ && !field) {
      const shore = getTownBoundsAtZ(pos.z);
      const minShoreX = shore.westX + 8.0;
      const maxShoreX = shore.eastX - 8.0;
      if (pos.x < minShoreX) {
        pos.x = minShoreX;
        if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      } else if (pos.x > maxShoreX) {
        pos.x = maxShoreX;
        if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      }
      // the city's limits (and 120 m round them) are the edge: beyond is plain land, so slide along it
      const kept = (this._lastInTown ??= new Map());
      const key = entity || this.activeMode, last = kept.get(key);
      if (!inTown(pos.x, pos.z) && last) {
        if (onAirfield(last.x, last.z)) { pos.x = last.x; pos.z = last.z; } // at the airport's fence
        else if (inTown(pos.x, last.z)) pos.z = last.z;
        else if (inTown(last.x, pos.z)) pos.x = last.x;
        else { pos.x = last.x; pos.z = last.z; }
        if (carEntity && carEntity.speed) carEntity.speed *= 0.4;
      }
      if (inTown(pos.x, pos.z)) { if (last) { last.x = pos.x; last.z = pos.z; } else kept.set(key, { x: pos.x, z: pos.z }); }
    }

    const body = collisionBody(this.activeMode, radius, carEntity ? carEntity.heading : 0);
    const { sin: sinH, cos: cosH, extX, extZ } = body;
    const contact = this._buildingContact ??= { nx: 0, nz: 0, depth: 0 };

    const reach = Math.max(extX, extZ) + 6;
    let gx = pos.x;
    let gz = pos.z;
    let near = this.nearColliders(gx, gz, reach);
    const standing = heli ? this._heliStanding : null;
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      // the helicopter flies down into the stadium's bowl, and sits on the roof under its skids
      if (heli && (isStadium(c) || c.thin || standing?.has(c))) continue;
      // a car drives in over the stadium's wall and down its stands: its steps and walls are the ground (updateCar)
      if (carEntity && isStadium(c)) continue;
      // and on foot inside it (got out there), its wall keeps the player in until they drive or fly out
      if (!heli && isStadium(c) && carSurface(pos.x, pos.z) !== null) continue;
      // a roof the car came down on is its ground (carRoof), not a wall
      if (carEntity && this._carStanding?.has(c)) continue;
      // a parked car is a body of its own: the two trade momentum, and it's shoved along and spun (parked-cars.js)
      if (carEntity && c.parked && this.parkedCars) {
        if (c.maxY > pos.y && c.minY < pos.y + body.top) this.shoveParked(c.parked, pos, carEntity, entity, sinH, cosH);
        continue;
      }
      if (buildingContact(c, pos.x, pos.y, pos.z, body, contact)) {
        const { nx, nz, depth } = contact;
        // something that turns when it's pushed or hit (the Cube, the-cube.js) hears of the touch first, the speed
        // still the one that hit it; it makes its own sound in place of a crash
        if (c.onHit) c.onHit(entity, this.activeMode, pos, nx, nz);
        // a tree, pole or sign post the car hits hard enough goes over (knockdowns.js) instead of stopping it
        if (carEntity && c.knock && this.knockdowns) {
          const vx = sinH * carEntity.speed + (carEntity.vx || 0), vz = cosH * carEntity.speed + (carEntity.vz || 0);
          const felled = this.knockdowns.hit(c, -(vx * nx + vz * nz), carEntity.drive?.mass || 1500, vx, vz);
          if (felled) {
            this.reportCollision(entity, c, 'building', pos.x - nx * 1.2, pos.y + 0.56, pos.z - nz * 1.2, nx, 0, nz, -(vx * nx + vz * nz));
            carEntity.speed *= felled.keep;
            carEntity.vx = (carEntity.vx || 0) * felled.keep;
            carEntity.vz = (carEntity.vz || 0) * felled.keep;
            carEntity.pitchVel = (carEntity.pitchVel || 0) + 1.2;
            carEntity.heaveVel = (carEntity.heaveVel || 0) + 0.6;
            continue;
          }
        }
        pos.x += nx * depth;
        pos.z += nz * depth;

        // a bike into a wall, a tree or a pole faster than a jog throws its rider
        if (entity?.type === 'cyclist'
          && -(Math.sin(entity.heading) * entity.speed * nx + Math.cos(entity.heading) * entity.speed * nz) > RIDER_THROW_SPEED) {
          this._riderThrow = Math.max(this._riderThrow || 0, Math.abs(entity.speed));
        }
        if (this._collisionListener && entity && entity.type !== 'person' && !c.quiet) {
          const sin = carEntity ? sinH : Math.sin(entity.heading);
          const cos = carEntity ? cosH : Math.cos(entity.heading);
          const approachSpeed = -((sin * entity.speed + (entity.vx || 0)) * nx + (cos * entity.speed + (entity.vz || 0)) * nz);
          const support = carEntity ? Math.abs(nx * cos - nz * sin) * 0.86 + Math.abs(nx * sin + nz * cos) * 2.18 : radius;
          this.reportCollision(entity, c, 'building', pos.x - nx * support, pos.y + (heli ? 1.1 : 0.56), pos.z - nz * support,
            nx, 0, nz, approachSpeed);
        }

        if (carEntity) {
          const hit = carWallImpulse(carEntity, sinH, cosH, pos.x, pos.z, nx, nz, carEntity.drive?.mass || 1500);
          if (carEntity.bike && hit.closing > MOTO_THROW_SPEED) this._motoThrow = Math.max(this._motoThrow || 0, hit.closing);
          if (hit.closing > 0.5) {
            this.carImpactKick(carEntity, sinH, cosH, nx, nz, hit.dv);
            if (hit.closing > 2.2) {
              carEntity.lastCollisionSpark = { x: hit.x, y: 0.56, z: hit.z, nx, nz, speed: hit.closing };
            }
          }
        }

        // A push that carried it far from where the candidates were gathered (dropped inside a building): gather
        // them again around where it is now, carrying on in the same order
        if (Math.abs(pos.x - gx) > 5 || Math.abs(pos.z - gz) > 5) {
          gx = pos.x;
          gz = pos.z;
          const order = c._order;
          near = this.nearColliders(gx, gz, reach);
          i = -1;
          while (i + 1 < near.length && near[i + 1]._order <= order) i++;
        }
      }
    }
  }

  // The car's suspension and body thrown by an impact of `dv` m/s along the normal (nx, nz)
  carImpactKick(car, sin, cos, nx, nz, dv) {
    const kick = Math.min(12, dv);
    car.pitchVel = (car.pitchVel || 0) + (sin * nx + cos * nz) * kick * 0.18;
    car.rollVel = (car.rollVel || 0) - (cos * nx - sin * nz) * kick * 0.24;
    car.heaveVel = (car.heaveVel || 0) + Math.min(1.4, kick * 0.1);
  }

  // The player's car against a train's cars (railways.js): each is a long box nothing the car does can move, going
  // along the line at the train's speed, so the car glances off it or is shoved along by it
  collideTrains(car) {
    const a = this._trainA ??= {}, b = this._trainB ??= {}, hit = this._trainHit ??= {};
    const pos = car.position, sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    for (const t of this.railways.trains) {
      for (const tc of t.cars) {
        const m = tc.mesh;
        if (!m.visible) continue;
        const dx = pos.x - m.position.x, dz = pos.z - m.position.z, reach = tc.L / 2 + 4;
        if (dx * dx + dz * dz > reach * reach || Math.abs(pos.y - m.position.y) > 4) continue;
        const yaw = m.rotation.y, ts = Math.sin(yaw), tcs = Math.cos(yaw), v = (t.v || 0) * (t.dir || 1);
        Object.assign(a, { x: pos.x, z: pos.z, sin, cos, halfW: playerBox[0], halfL: playerBox[1], mass: car.drive?.mass || 1500,
          vx: sin * car.speed + (car.vx || 0), vz: cos * car.speed + (car.vz || 0), angularVel: car.angularVel || 0 });
        Object.assign(b, { x: m.position.x, z: m.position.z, sin: ts, cos: tcs, halfW: 1.55, halfL: tc.L / 2, mass: 0,
          vx: ts * v, vz: tcs * v, angularVel: 0 });
        if (!vehicleContact(a, b, hit)) continue;
        pos.x += hit.nx * hit.depth; pos.z += hit.nz * hit.depth;
        const closing = resolveVehicleContact(a, b, hit);
        if (closing <= 0) continue;
        car.speed = a.vx * sin + a.vz * cos;
        car.vx = a.vx - sin * car.speed;
        car.vz = a.vz - cos * car.speed;
        car.angularVel = a.angularVel;
        if (closing > 0.5) {
          this.carImpactKick(car, sin, cos, hit.nx, hit.nz, closing);
          this.reportCollision(car, null, 'building', hit.x, pos.y + 0.56, hit.z, hit.nx, 0, hit.nz, closing);
          if (closing > 2.2) car.lastCollisionSpark = { x: hit.x, y: 0.56, z: hit.z, nx: hit.nx, nz: hit.nz, speed: closing };
        }
      }
    }
  }

  // The player's car into a parked one: pushed apart by their weights, then the impulse at the touching faces shared
  // between them, so a heavy hit shunts it down the row and a corner clip spins both
  shoveParked(p, pos, car, entity, sin, cos) {
    const a = this._shoveA ??= {}, b = this._shoveB ??= {}, hit = this._shoveHit ??= {};
    const mass = car.drive?.mass || 1500;
    Object.assign(a, { x: pos.x, z: pos.z, sin, cos, halfW: playerBox[0], halfL: playerBox[1], mass,
      vx: sin * car.speed + (car.vx || 0), vz: cos * car.speed + (car.vz || 0), angularVel: car.angularVel || 0 });
    const o = p.collider.obb;
    Object.assign(b, { x: o.cx, z: o.cz, sin: o.sn, cos: o.cs, halfW: p.halfW, halfL: p.halfL, mass: p.mass,
      vx: p.vx, vz: p.vz, angularVel: p.w });
    if (!vehicleContact(a, b, hit)) return;
    const share = p.mass / (mass + p.mass);
    pos.x += hit.nx * hit.depth * share;
    pos.z += hit.nz * hit.depth * share;
    const closing = resolveVehicleContact(a, b, hit);
    p.vx = b.vx; p.vz = b.vz; p.w = b.angularVel;
    // its share of the push out comes as a nudge it slides off with
    p.vx -= hit.nx * hit.depth * (1 - share) * 20;
    p.vz -= hit.nz * hit.depth * (1 - share) * 20;
    this.parkedCars.wake(p);
    if (closing <= 0) return;
    car.speed = a.vx * sin + a.vz * cos;
    car.vx = a.vx - sin * car.speed;
    car.vz = a.vz - cos * car.speed;
    car.angularVel = a.angularVel;
    if (closing > 0.5) {
      this.carImpactKick(car, sin, cos, hit.nx, hit.nz, hit.impulse / mass);
      this.reportCollision(entity, p, 'vehicle', hit.x, pos.y + 0.56, hit.z, hit.nx, 0, hit.nz, closing);
      if (closing > 2.2) car.lastCollisionSpark = { x: hit.x, y: 0.56, z: hit.z, nx: hit.nx, nz: hit.nz, speed: closing };
    }
  }

  // A shoved parked car kept out of the buildings, walls and posts around it, losing the speed it had into them
  settleParked(p) {
    const o = p.collider.obb;
    const body = collisionBody('car', 0, p.yaw);
    body.hx = p.halfW; body.hz = p.halfL;
    const contact = this._settleContact ??= { nx: 0, nz: 0, depth: 0 };
    const y = p.collider.minY + 0.05;
    for (const c of this.nearColliders(o.cx, o.cz, p.halfL + 6)) {
      if (c === p.collider || c.parked || c.knock?.down) continue;
      if (!buildingContact(c, o.cx, y, o.cz, body, contact)) continue;
      const { nx, nz, depth } = contact;
      o.cx += nx * depth; o.cz += nz * depth;
      const vn = p.vx * nx + p.vz * nz;
      if (vn < 0) {
        p.vx -= nx * vn * 1.15; p.vz -= nz * vn * 1.15;
        p.w *= 0.6;
      }
    }
  }

  // A box that moved (a parked car shoved along) is found from the cells it's in now as well
  refreshCollider(c) {
    if (!this._colliderCells) return;
    const CELL = 48;
    for (let ix = Math.floor(c.minX / CELL); ix <= Math.floor(c.maxX / CELL); ix++) {
      for (let iz = Math.floor(c.minZ / CELL); iz <= Math.floor(c.maxZ / CELL); iz++) {
        const k = (ix + 4096) * 8192 + (iz + 4096);
        let list = this._colliderCells.get(k);
        if (!list) this._colliderCells.set(k, (list = []));
        if (!list.includes(c)) list.push(c);
      }
    }
  }

  // Pose the skinned characters once every entity has moved: the pedestrian's rig walks (or runs, turns, jumps) it to
  // where it now is, planting its feet on the ground; the cyclist sits on the bike, hands on the grips, feet on the
  // pedals, helmet on its head
  poseCharacters(dt, focusPos = null) {
    const focus = focusPos || this.getActiveEntity()?.position;
    const maxDistSq = 320 * 320;

    const p = this.entities.person;
    if (p) {
      const dx = focus ? p.position.x - focus.x : 0;
      const dz = focus ? p.position.z - focus.z : 0;
      const c = this.entities.car;
      if (this.activeMode === 'car' && c?.riderPose && (!p.riding || p.riding === 'car')) {
        // on a motorbike or a scooter: sat on it (or standing on its deck), helmet on
        p._charHidden = false;
        p.rig.perch(c.chassisPivot, c.riderPose);
        p.crowd.begin();
        p.crowd.add(p.rig, 0);
        p.crowd.end();
        const h = c.riderMesh;
        h.visible = true;
        h.position.copy(p.rig.headPosition);
        h.quaternion.copy(p.rig.headQuaternion);
        h.scale.setScalar(p.rig.s);
        h.updateMatrixWorld(true);
        placeEarbuds(p.earbuds, p.rig, this.earbuds && !h.isMesh); // not under a helmet
      } else if (!p.riding && !p.onBus && (this.activeMode === 'person' || dx * dx + dz * dz <= maxDistSq)) {
        p._charHidden = false;
        if (p.mesh) p.mesh.visible = true;
        const air = p.position.y - this.getGroundHeight(p.position.x, p.position.z, 'person');
        if (p.chute) p.rig.skydive(dt, p.position.x, p.position.y + 0.5 + 0.45 * p.chute.open, p.position.z, p.heading, p.chute.flat || 0, p.chute.bank || 0, p.chute.track || 0, p.chute.open);
        else if (p.fallen?.getUp >= 0) p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, 0, true, DIVE_GET_UP + p.fallen.getUp);
        else if (p.swimming) p.rig.swim(dt, p.position.x, (waterLevel(p.position.x, p.position.z) ?? p.position.y + 1) + Math.min(0, p.position.y + 1 - (waterLevel(p.position.x, p.position.z) ?? p.position.y + 1)), p.position.z, p.heading, Math.min(1, Math.abs(p.speed) / 1.8));
        else if (!p.fallen) p.rig.update(dt, p.position.x, p.position.z, p.heading, personGround, this, air > 0.02 ? air : 0);
        p.crowd.begin();
        p.crowd.add(p.rig, 0);
        p.crowd.end();
        placeEarbuds(p.earbuds, p.rig, this.earbuds && this.activeMode === 'person');
      } else if (!p._charHidden) {
        p.earbuds.visible = false;
        p.rig.placed = false;
        p.crowd.begin();
        p.crowd.end();
        if (p.crowd.updates > 2) {
          if (p.mesh) p.mesh.visible = false;
          p._charHidden = true;
        }
      }
    }

    const b = this.entities.cyclist;
    if (b) {
      const dx = focus ? b.position.x - focus.x : 0;
      const dz = focus ? b.position.z - focus.z : 0;
      if (this.activeMode === 'cyclist' || (!b.leftEmpty && dx * dx + dz * dz <= maxDistSq)) {
        if (b.helmet) b.helmet.visible = true;
        const moved =
          this.activeMode === 'cyclist' ||
          b._riderHidden ||
          b._posedX !== b.position.x ||
          b._posedY !== b.position.y ||
          b._posedZ !== b.position.z ||
          b._posedH !== b.heading ||
          b._posedLean !== b.leanAngle ||
          b._posedPedal !== b.pedalPhase;
        b._riderHidden = false;
        if (moved) {
          b.riderRig.ride(b.leanPivot, b.pedalPhase, b.bikeFrame);
          b.riderCrowd.begin();
          b.riderCrowd.add(b.riderRig, 0);
          b.riderCrowd.end();
          b.helmet.quaternion.copy(b.riderRig.headQuaternion);
          b.helmet.position.set(0, 0.175, -0.012).applyQuaternion(b.helmet.quaternion).add(b.riderRig.headPosition);
          placeEarbuds(b.earbuds, b.riderRig, this.earbuds && this.activeMode === 'cyclist');
          b._posedX = b.position.x;
          b._posedY = b.position.y;
          b._posedZ = b.position.z;
          b._posedH = b.heading;
          b._posedLean = b.leanAngle;
          b._posedPedal = b.pedalPhase;
        }
      } else if (!b._riderHidden) {
        b.riderCrowd.begin();
        b.riderCrowd.end();
        if (b.riderCrowd.updates > 2) {
          if (b.helmet) b.helmet.visible = false;
          b.earbuds.visible = false;
          b._riderHidden = true;
          b._posedX = NaN;
        }
      }
    }

    const k = this.entities.kayak;
    if (k) {
      const dx = focus ? k.position.x - focus.x : 0;
      const dz = focus ? k.position.z - focus.z : 0;
      // the paddler is in it only while the player paddles it, or has left it with someone still in it
      const manned = this.activeMode === 'kayak' || !k.leftEmpty;
      if (manned && (this.activeMode === 'kayak' || dx * dx + dz * dz <= maxDistSq)) {
        k._paddlerHidden = false;
        k.paddlerRig.paddle(k.tiltPivot, k.seat, k.hands, k.twist);
        k.paddlerCrowd.begin();
        k.paddlerCrowd.add(k.paddlerRig, 0);
        k.paddlerCrowd.end();
        placeEarbuds(k.earbuds, k.paddlerRig, this.earbuds && this.activeMode === 'kayak');
      } else if (!k._paddlerHidden) {
        k.paddlerCrowd.begin();
        k.paddlerCrowd.end();
        k.earbuds.visible = false;
        if (k.paddlerCrowd.updates > 2) k._paddlerHidden = true;
      }
    }
  }

  update(dt, elapsed, focusPos = null) {
    const heli = this.entities.helicopter;
    heli.mainRotorPivot.rotation.y += dt * 24.0;
    heli.tailRotorPivot.rotation.x += dt * 32.0;

    if (this.activeMode === 'person') {
      this.updatePerson(dt, elapsed);
    } else if (this.entities.person.riding) {
      // In something: carried along with it, out of sight
      const p = this.entities.person;
      p.position.copy(this.entities[p.riding].position);
      p.speed = 0;
    } else {
      // Keep the sidewalk pedestrian walking naturally when not actively controlled
      const p = this.entities.person;
      const walkSpeed = 1.48;
      p.speed = walkSpeed;
      p.position.x += Math.sin(p.heading) * walkSpeed * dt;
      p.position.z += Math.cos(p.heading) * walkSpeed * dt;
      if (p.position.z < -340) p.heading = 0;
      else if (p.position.z > 340) p.heading = Math.PI;
      p.position.y = this.getGroundHeight(p.position.x, p.position.z, 'person');
    }

    if (this.activeMode === 'car') {
      this._motoThrow = 0;
      const c = this.entities.car, px = c.position.x, pz = c.position.z, py = c.position.y;
      this.updateCar(dt, elapsed);
      this.pools?.trap(c, px, py, pz, dt);
      if (this._motoThrow) this.throwMotoRider(this._motoThrow);
    } else if (this.activeMode === 'cyclist') {
      this._riderThrow = 0;
      const b = this.entities.cyclist, px = b.position.x, pz = b.position.z, py = b.position.y;
      this.updateCyclist(dt, elapsed);
      this.pools?.trap(b, px, py, pz, dt);
      if (this._riderThrow) this.throwRider(this._riderThrow);
    } else if (this.activeMode === 'helicopter') {
      this.updateHelicopter(dt, elapsed);
    } else if (this.activeMode === 'kayak') {
      this.updateKayak(dt, elapsed);
    }
    this.coastEmpty(dt);

    for (const key of Object.keys(this.entities)) {
      const e = this.entities[key];
      e.mesh.position.copy(e.position);
      // Lamp: a car or bike tilts with the slope under its wheels (terrain.js); yaw first, then pitch and roll
      if (e.type === 'car' || e.type === 'cyclist') {
        let [pitch, roll] = groundTilt(e.position.x, e.position.z, e.heading, e.type === 'car' ? 4.2 : 1.6, e.type === 'car' ? 1.8 : 0.4);
        if (e.type === 'car') {
          // in the air it holds the attitude it left with, the nose following its path; on the stadium's stands the
          // slope is the stands' own (carSurface), not the dug ground's under them
          if (e.airborne) {
            e.airRoll *= Math.exp(-dt * 1.5);
            pitch = e.airPitch; roll = e.airRoll;
          } else if (carSurface(e.position.x, e.position.z) !== null || this.rampTop(e.position.x, e.position.z) > -Infinity
            || this.parking?.inside(e.position.x, e.position.z)
            || this.rampTop(e.position.x + Math.sin(e.heading) * 2.1, e.position.z + Math.cos(e.heading) * 2.1) > -Infinity
            || this.rampTop(e.position.x - Math.sin(e.heading) * 2.1, e.position.z - Math.cos(e.heading) * 2.1) > -Infinity) {
            const s = Math.sin(e.heading), co = Math.cos(e.heading), g = (dx, dz) => this.getGroundHeight(e.position.x + dx, e.position.z + dz, 'car');
            pitch = Math.atan2(g(s * 2.1, co * 2.1) - g(-s * 2.1, -co * 2.1), 4.2);
            roll = Math.atan2(g(-co * 0.9, s * 0.9) - g(co * 0.9, -s * 0.9), 1.8);
          }
          e.groundPitch = e.airborne ? e.groundPitch : pitch;
          e.groundRoll = e.airborne ? e.groundRoll : roll;
        }
        e.mesh.rotation.set(-pitch, e.heading, e.type === 'car' ? -roll : 0, 'YXZ');
      } else {
        e.mesh.rotation.y = e.heading;
      }
    }

    // Modulate clustered vehicle & bike lights by time of day (off during Midday & Golden Hour; fade in at Dusk & Night)
    const glow = cityUniforms && cityUniforms.uInteriorGlow ? cityUniforms.uInteriorGlow.value : 0.48;
    const beamScale = Math.min(1.28, Math.max(0.0, (glow - 0.60) * 1.45));
    const car = this.entities.car;
    if (car.headLights) {
      for (const spot of car.headLights) {
        // Accelerating does not change the headlamp output or range.
        spot.intensity = HEADLIGHTS.intensity * beamScale;
      }
    }
    const bike = this.entities.cyclist;
    if (bike.headLight) {
      const bikeActive = this.activeMode === 'cyclist';
      bike.headLight.intensity = bikeActive ? 115 * beamScale : 0;
    }

    this.poseCharacters(dt, focusPos);
  }

  // Knocked off the bike or down by a car: the player's body goes limp, flung by (vx, vy, vz), and gets up where it
  // came to rest (through the push-up of a dive); the controls do nothing meanwhile
  knockDown(vx, vy, vz, spin = 0, tip = 0) {
    const p = this.entities.person;
    if (p.fallen && p.rig.ragdolling) {
      // a car still pushing the body knocks it on once, not every frame it touches
      if (p.rig.rag.time - (p.fallen.kick ?? -1) > 0.5) p.rig.kickRagdoll(vx * 0.6, vy * 0.5, vz * 0.6);
      p.fallen.kick = p.rig.rag.time;
      return;
    }
    if (!p.rig.placed) p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
    p.rig.startRagdoll(vx, vy, vz, spin, tip);
    // how it was flung, for the jump camera to cut to the side of a big one
    p.fallen = { getUp: -1, launch: { vx, vy, vz, looked: false } };
    p.speed = p.verticalVel = 0;
    p._charHidden = false;
    if (p.mesh) p.mesh.visible = true;
  }

  // Thrown over the handlebars of a bike that hit something hard at `speed` (or off it the way (hx, hz) a car hit
  // it): the bike stays where it stopped and the player lands on foot
  throwRider(speed, hx = 0, hz = 0) {
    const b = this.entities.cyclist, p = this.entities.person;
    const sn = Math.sin(b.heading), cs = Math.cos(b.heading);
    p.riding = null;
    b.leftEmpty = true;
    p.position.set(b.position.x + sn * 0.2, b.position.y, b.position.z + cs * 0.2);
    p.heading = b.heading;
    p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
    this.setMode('person');
    b.speed = 0;
    const v = speed * 0.85;
    if (hx || hz) this.knockDown(sn * v * 0.5 + hx, 2 + speed * 0.15, cs * v * 0.5 + hz, (hash01(speed) - 0.5) * 4, 0.8);
    else this.knockDown(sn * v, 1.8 + speed * 0.12, cs * v, (hash01(speed) - 0.5) * 2, 1.6 + speed * 0.25);
  }

  // Off a motorbike that crashed hard at `speed`: over the bars into a wall, or the way (hx, hz) a car knocked them;
  // the bike stays where it stopped, empty, to get back on
  throwMotoRider(speed, hx = 0, hz = 0) {
    const c = this.entities.car, p = this.entities.person;
    if (!c?.bike || this.activeMode !== 'car') return;
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    p.riding = null;
    c.leftEmpty = true;
    p.position.set(c.position.x + sn * 0.3, c.position.y + 0.4, c.position.z + cs * 0.3);
    p.heading = c.heading;
    p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
    this.stopCar(c);
    this.setMode('person');
    const v = speed * 0.9;
    if (hx || hz) this.knockDown(sn * v * 0.4 + hx, 2.4 + speed * 0.15, cs * v * 0.4 + hz, (hash01(speed) - 0.5) * 4, 0.9);
    else this.knockDown(sn * v, 2.6 + speed * 0.14, cs * v, (hash01(speed) - 0.5) * 2, 2 + speed * 0.2);
    log(`[moto] thrown off at ${Math.round(speed * 2.237)} mph`);
  }

  // Out of something still moving (enterOrExit's `jump`), once on foot: out of the helicopter's door falling, under a
  // parachute that opens a moment later from high up ('chute') or straight down from low ('drop'); out of a moving car
  // thrown as it carried them ('thrown'), tumbling limp to a stop. What they left goes on without them (coastEmpty).
  bailOut(kind) {
    const p = this.entities.person;
    if (kind === 'thrown') {
      const c = this.entities.car;
      if (c.bike) { this.throwMotoRider(Math.abs(c.speed)); return; }
      const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
      const vx = sn * c.speed + (c.vx || 0), vz = cs * c.speed + (c.vz || 0), v = Math.hypot(vx, vz);
      // out of the driver's door, on the car's left, pushed a little away from it
      p.position.set(c.position.x + cs * 1.1, c.position.y + 0.5, c.position.z - sn * 1.1);
      p.heading = c.heading;
      p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
      c.leftEmpty = true;
      c.coasting = true;
      this.knockDown(vx * 0.92 + cs * 2.2, 1.4 + v * 0.06, vz * 0.92 - sn * 2.2, (hash01(v) - 0.5) * 5, 0.6 + v * 0.05);
      log(`[car] jumped out at ${Math.round(v * 2.237)} mph`);
      return;
    }
    const h = this.entities.helicopter;
    const sn = Math.sin(h.heading), cs = Math.cos(h.heading);
    p.position.set(h.position.x + cs * 1.6, h.position.y + 0.4, h.position.z - sn * 1.6);
    p.heading = h.heading;
    p.speed = h.speed * 0.9;
    p.verticalVel = Math.min(0, h.verticalSpeed);
    p.grounded = false;
    // the canopy opens when the player pulls it (the jump button, pressed afresh: one held to climb doesn't count)
    p.chute = kind === 'chute' ? { t: 0, open: 0, pulled: false, held: !!this.keys.up, vx: sn * h.speed, vz: cs * h.speed, sway: 0 } : null;
    if (p.chute) {
      // the camera falls back and looks up past the player to take in the canopy (eased in updateChute, back on landing)
      p.walkCamera = true;
    }
    p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
    h.coasting = true;
    log(kind === 'chute' ? `[helicopter] jumped out ${Math.round(h.position.y - this.helicopterFloor(h, h.position.y))} m up with a parachute` : '[helicopter] jumped down');
  }

  // A round canopy in maize and blue panels on its shroud lines, made the first time it's needed
  parachute() {
    if (this._chuteMesh) return this._chuteMesh;
    const root = new THREE.Group();
    const geo = new THREE.SphereGeometry(3.4, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed();
    geo.scale(1, 0.62, 1);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    const a = new THREE.Color(0xffcb05).convertSRGBToLinear(), b = new THREE.Color(0x00274c).convertSRGBToLinear();
    for (let i = 0; i < n; i += 3) {
      const x = (geo.attributes.position.getX(i) + geo.attributes.position.getX(i + 1) + geo.attributes.position.getX(i + 2)) / 3;
      const z = (geo.attributes.position.getZ(i) + geo.attributes.position.getZ(i + 1) + geo.attributes.position.getZ(i + 2)) / 3;
      const k = Math.floor(((Math.atan2(z, x) / (Math.PI * 2)) + 1) * 16) % 2 ? b : a;
      for (let j = 0; j < 3; j++) col.set([k.r, k.g, k.b], (i + j) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const canopy = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
    canopy.castShadow = true;
    canopy.position.y = 4.6;
    root.add(canopy);
    // the shroud lines, from the canopy's edge down to the harness at the shoulders
    const pts = [], rim = 3.4 * Math.sin(Math.PI * 0.42), rimY = 4.6 + 3.4 * 0.62 * Math.cos(Math.PI * 0.42);
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      pts.push(Math.cos(t) * rim, rimY, Math.sin(t) * rim, (i % 2 ? 0.18 : -0.18), 1.45, 0);
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicNodeMaterial({ color: 0xdddddd }));
    root.add(lines);
    root.visible = false;
    this.scene.add(root);
    this._chuteMesh = root;
    return root;
  }

  // Under the parachute: falling free for a moment, then the canopy opens and slows the fall to a glide. Forward
  // speeds it up, back slows it, and left and right turn it; on the ground the player is on foot again.
  updateChute(dt) {
    const p = this.entities.person, ch = p.chute, mesh = this.parachute();
    ch.t += dt;
    if (!this.keys.up) ch.held = false;
    if (!ch.pulled && this.keys.up && !ch.held && ch.t > 0.3) { ch.pulled = true; log('[parachute] opened'); }
    if (ch.pulled) ch.open = Math.min(1, ch.open + dt * 1.6);
    // the camera: above and behind in free fall, looking down at the body; under the canopy, back and level with
    // the harness, looking up between the body and the canopy so both stay in frame
    const w = p.walkCamera, e = Math.min(1, dt * 3);
    if (w) {
      p.chaseDistance += (6 + 7 * ch.open - p.chaseDistance) * e;
      p.chaseHeight += (3.2 - 2.4 * ch.open - p.chaseHeight) * e;
      p.cameraTargetOffset.y += (-1.4 + 3.6 * ch.open - p.cameraTargetOffset.y) * e;
    }
    // steering: in free fall the body turns quickly and tracks forward (lean in, glide up to about 30 m/s, or back
    // off to drift backwards); under the canopy it turns slowly and glides on its own
    const turn = (this.keys.left || 0) - (this.keys.right || 0);
    const fwd = (this.keys.forward || 0) - (this.keys.backward || 0);
    const free = 1 - ch.open;
    p.heading += turn * (2.6 * free + 0.9 * ch.open) * dt;
    ch.sway += (turn * 0.35 - ch.sway) * Math.min(1, dt * 2);
    ch.bank = (ch.bank || 0) + (turn * 0.45 - (ch.bank || 0)) * Math.min(1, dt * 4);
    ch.flat = Math.max(0, Math.min(1, (ch.flat || 0) + dt * (ch.pulled ? -2.5 : 2.4)));
    // tracking (forward in free fall): arms swept back, the body dives head-down and trades fall for speed ahead
    ch.track = (ch.track || 0) + (Math.max(0, fwd) * (ch.pulled ? 0 : 1) - (ch.track || 0)) * Math.min(1, dt * 3);
    const glide = free * (fwd < 0 ? 3 + 6 * fwd : 3 + 27 * fwd) + ch.open * (6 + 4 * fwd);
    const k = Math.min(1, dt * (2.6 * free + ch.open * 1.5));
    ch.vx += (Math.sin(p.heading) * glide - ch.vx) * k;
    ch.vz += (Math.cos(p.heading) * glide - ch.vz) * k;
    p.position.x += ch.vx * dt;
    p.position.z += ch.vz * dt;
    this.resolveHorizontalCollision(p.position, 0.48);
    // free fall, then the canopy's drag down to about 5 m/s
    p.verticalVel = Math.max(-50 + 16 * ch.track, p.verticalVel - 14.5 * dt);
    if (p.verticalVel < -50 + 16 * ch.track) p.verticalVel += (-50 + 16 * ch.track - p.verticalVel) * Math.min(1, dt * 2);
    if (ch.open > 0) p.verticalVel += (-4.8 - p.verticalVel) * Math.min(1, dt * 4 * ch.open);
    p.position.y += p.verticalVel * dt;
    // the speed ahead, which also swings the camera back behind the way the body faces, so forward is away from it
    p.speed = Math.hypot(ch.vx, ch.vz);
    mesh.visible = ch.open > 0;
    mesh.position.copy(p.position);
    mesh.rotation.set(0, p.heading, 0);
    mesh.rotateZ(-ch.sway);
    mesh.scale.set(0.2 + 0.8 * ch.open, 0.35 + 0.65 * ch.open, 0.2 + 0.8 * ch.open);
    // the scene's matrices update only for the moving things main.js lists, so this one places itself
    mesh.updateMatrixWorld(true);
    this.groundShadow(p, this.getGroundHeight(p.position.x, p.position.z, 'person'));
    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person');
    if (p.position.y <= groundY) {
      this.groundShadow(p, groundY);
      const fall = -p.verticalVel;
      p.position.y = groundY;
      p.speed = 0;
      this.dropChute();
      p.grounded = true;
      if (fall > 9) {
        // never pulled (or too late): a splat, flat out for a few seconds before getting up
        log(`[parachute] ${ch.pulled ? 'came down hard' : 'splat'} at ${Math.round(fall)} m/s`);
        this.knockDown(ch.vx * 0.3, 0.6, ch.vz * 0.3, 0, 1.4);
        p.fallen.wait = Math.min(4, 1 + fall * 0.08);
      } else {
        log('[parachute] landed');
        p.verticalVel = 0;
      }
    }
  }

  // The soft shadow under the player's feet stays on the ground under them, fading as they rise above it (a jump, a
  // fall from the helicopter) instead of riding along at their feet in the air
  groundShadow(p, groundY) {
    const sh = p._footShadow ??= p.mesh.children.find((c) => c.renderOrder === 998);
    if (!sh) return;
    const up = Math.max(0, p.position.y - groundY);
    sh.position.y = 0.02 - up;
    sh.visible = up < 6;
    sh.scale.setScalar(1 + up * 0.15);
    sh.material.opacity = 1;
    sh.updateMatrixWorld(true);
  }

  // Back to the walking camera's own framing (not a copy taken as the fall began, which a fall cut short by a change
  // of the game's code could leave set to the canopy's: the player low in the frame, looking up past them)
  walkCamera(p) {
    p.chaseDistance = WALK_CAMERA.d;
    p.chaseHeight = WALK_CAMERA.h;
    p.cameraTargetOffset.y = WALK_CAMERA.y;
    p.walkCamera = null;
  }

  dropChute() {
    const p = this.entities.person;
    p.chute = null;
    if (this._chuteMesh) this._chuteMesh.visible = false;
    p.walkCamera = null; // updatePerson eases the camera back to walking
  }

  // What the player got out of while it was moving: the car rolls on, slowing, until it stops or hits something; the
  // helicopter, its rotor still turning, sinks to the ground
  coastEmpty(dt) {
    const c = this.entities.car;
    if (c?.coasting && this.activeMode !== 'car') {
      const sp = Math.sign(c.speed) * Math.max(0, Math.abs(c.speed) - 2.2 * dt);
      c.speed = sp;
      c.vx = (c.vx || 0) * Math.max(0, 1 - dt * 3);
      c.vz = (c.vz || 0) * Math.max(0, 1 - dt * 3);
      c.heading += (c.angularVel || 0) * dt;
      c.angularVel = (c.angularVel || 0) * Math.max(0, 1 - dt * 2);
      const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
      c.position.x += (sn * sp + c.vx) * dt;
      c.position.z += (cs * sp + c.vz) * dt;
      c.position.y = this.getGroundHeight(c.position.x, c.position.z, 'car');
      const body = collisionBody('car', 1.2, c.heading), hit = this._coastContact ??= { nx: 0, nz: 0, depth: 0 };
      for (const k of this.nearColliders(c.position.x, c.position.z, 8)) {
        if (isStadium(k) || k.parked || k.thin) continue;
        if (buildingContact(k, c.position.x, c.position.y, c.position.z, body, hit)) {
          c.position.x += hit.nx * hit.depth;
          c.position.z += hit.nz * hit.depth;
          c.speed *= -0.15;
          c.vx = c.vz = 0;
        }
      }
      if (Math.abs(c.speed) < 0.05 && Math.hypot(c.vx, c.vz) < 0.05) { c.coasting = false; this.stopCar(c); }
    }
    const h = this.entities.helicopter;
    if (h?.coasting && this.activeMode !== 'helicopter') {
      h.speed *= Math.max(0, 1 - dt * 0.6);
      h.verticalSpeed += (-7 - h.verticalSpeed) * Math.min(1, dt * 1.5);
      h.position.x += Math.sin(h.heading) * h.speed * dt;
      h.position.z += Math.cos(h.heading) * h.speed * dt;
      const lastY = h.position.y;
      h.position.y += h.verticalSpeed * dt;
      const floor = this.helicopterFloor(h, lastY);
      h.pitchAngle *= Math.max(0, 1 - dt * 2);
      h.rollAngle *= Math.max(0, 1 - dt * 2);
      h.tiltPivot.rotation.x = h.pitchAngle;
      h.tiltPivot.rotation.z = h.rollAngle;
      if (h.position.y <= floor) {
        h.position.y = floor;
        h.speed = h.verticalSpeed = 0;
        h.coasting = false;
        log('[helicopter] came down on its own');
      }
    }
  }

  // On a bus (main.js getInOrOut): carried in it, out of sight, the camera pulled back to see the bus; off at its
  // door, on the curb
  getOnBus(ride) {
    const p = this.entities.person;
    p.onBus = true;
    p.walkCamera = true;
    p.chaseDistance = 17;
    p.chaseHeight = 4.2;
    p.speed = p.verticalVel = 0;
    this.rideAlong(ride);
  }
  rideAlong(ride) {
    const p = this.entities.person;
    p.position.set(ride.x, this.getGroundHeight(ride.x, ride.z, 'car') + 0.95, ride.z);
    p.heading = ride.yaw;
  }
  getOffBus(ride) {
    const p = this.entities.person;
    if (!p.onBus) return;
    p.onBus = false;
    this.walkCamera(p);
    if (ride) {
      p.position.set(ride.doorX, this.getGroundHeight(ride.doorX, ride.doorZ, 'person'), ride.doorZ);
      p.heading = ride.yaw + Math.PI / 2;
    }
    p.speed = p.verticalVel = 0;
    p._charHidden = false;
    if (p.mesh) p.mesh.visible = true;
    p.rig.reset(p.position.x, p.position.z, p.heading, personGround, this);
  }

  updatePerson(dt) {
    const p = this.entities.person;
    if (p.onBus) {
      const ride = this.traffic?.busRide();
      if (ride && !ride.gone) { this.rideAlong(ride); p.speed = 0; return; }
      this.getOffBus(ride);
    }
    if (p.chute) { this.updateChute(dt); return; }
    // the walking camera, eased back from the fall's framing; with the player down on the ground (a splat, knocked
    // flat) it rises and looks down at them instead of ahead over their head
    if (!p.onBus) {
      const down = !!p.fallen, e = Math.min(1, dt * 4);
      p.chaseDistance += ((down ? 5.2 : WALK_CAMERA.d) - p.chaseDistance) * e;
      p.chaseHeight += ((down ? 3 : WALK_CAMERA.h) - p.chaseHeight) * e;
      p.cameraTargetOffset.y += ((down ? -1.3 : WALK_CAMERA.y) - p.cameraTargetOffset.y) * e;
    }
    if (p.fallen) {
      if (p.fallen.getUp < 0) {
        // a splat lies still a few seconds (`wait`) before getting up
        if (p.rig.stepRagdoll(dt, personGround, this, true) && !((p.fallen.wait -= dt) > 0)) {
          p.heading = p.rig.yaw = p.rig.ragdollHeading();
          p.rig.ragdolling = false;
          p.fallen.getUp = 0;
        }
        p.position.x = p.rig.x;
        p.position.z = p.rig.z;
      } else if ((p.fallen.getUp += dt) > PEDESTRIAN_DIVE_DURATION - DIVE_GET_UP) p.fallen = null;
      p.speed = p.verticalVel = 0;
      p.position.y = this.getGroundHeight(p.position.x, p.position.z, 'person');
      return;
    }
    // in water over their head they swim: slower, turning slower, held at the surface; out where it's shallow again
    const swimming = !!p.swimming;
    const maxSpeed = swimming ? 2.6 : 8.2;
    const turnRate = swimming ? 1.7 : 2.6;

    let targetSpeed = 0;
    if (this.keys.forward) targetSpeed = maxSpeed * this.keys.forward;
    else if (this.keys.backward) targetSpeed = -maxSpeed * 0.65 * this.keys.backward;

    if (this.keys.left) p.heading += turnRate * dt * this.keys.left;
    if (this.keys.right) p.heading -= turnRate * dt * this.keys.right;

    const accelerating = Math.abs(targetSpeed) > Math.abs(p.speed) && p.speed * targetSpeed >= 0;
    const acceleration = accelerating ? 5.5 * Math.abs(targetSpeed) / maxSpeed : 12;
    p.speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, targetSpeed - p.speed));

    p.position.x += Math.sin(p.heading) * p.speed * dt;
    p.position.z += Math.cos(p.heading) * p.speed * dt;
    this.resolveHorizontalCollision(p.position, 0.48);

    const groundY = this.getGroundHeight(p.position.x, p.position.z, 'person');
    const level = riverDepth(p.position.x, p.position.z) > 0.08 ? waterLevel(p.position.x, p.position.z) : null;
    const deep = level != null ? level - groundY : 0;
    // a jump or a fall into the river goes under first, then bobs up; wading in, they push off once it's chest deep
    if (level != null && deep > (swimming ? 1.05 : 1.3) && (swimming || p.position.y <= level - 1.0 + 0.05)) {
      if (!swimming) { p.swimming = true; log('[swim] the player is swimming'); }
      const rest = level - 1.0;
      p.verticalVel = p.position.y < rest ? Math.min(p.verticalVel * Math.exp(-dt * 5) + 9 * dt, 3)
        : p.verticalVel * Math.exp(-dt * 6) - (p.position.y - rest) * 20 * dt;
      p.position.y = Math.max(groundY, p.position.y + p.verticalVel * dt);
      p.grounded = false;
      this.groundShadow(p, p.position.y - 100); // no shadow on the water
      return;
    }
    if (swimming) { p.swimming = false; p.position.y = Math.max(p.position.y, groundY); log('[swim] the player stood up in the shallows'); }
    const grounded = p.grounded ?? true;
    if (this.keys.up && grounded) {
      p.verticalVel = 5.2;
    }
    p.verticalVel -= 14.5 * dt;
    p.position.y += p.verticalVel * dt;
    // Lamp: walking downhill, or off a curb, keeps the feet on the ground rather than stepping into the air
    this.groundShadow(p, groundY);
    if (p.position.y < groundY || (grounded && p.verticalVel <= 0 && p.position.y - groundY < 0.4)) {
      p.position.y = groundY;
      p.verticalVel = 0;
      p.grounded = true;
    } else {
      p.grounded = false;
    }
  }

  updateCar(dt) {
    if (dt <= 0) return;
    const c = this.entities.car;
    const D = c.drive || (c.drive = carDrive(this.carLook?.kind));

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -this.keys.backward;

    // Space, the controller's A, the touch button: the handbrake locks the back wheels
    const handbrakeInput = +(this.keys.up || 0);
    const braking = c.speed * throttle < 0 || handbrakeInput > 0;

    let steerInput = 0;
    if (this.keys.left) steerInput = this.keys.left;
    if (this.keys.right) steerInput = -this.keys.right;

    const prevX = c.position.x;
    const prevZ = c.position.z;
    c.prevX = prevX;
    c.prevZ = prevZ;
    // Short steps keep grip, impacts and suspension consistent at different display rates.
    const steps = Math.ceil(dt * 120);
    const step = dt / steps;
    const steerResponse = 1 - Math.exp(-D.steer * step);
    const yawResponse = 1 - Math.exp(-(D.yaw || 11) * step);
    const tireResponse = 1 - Math.exp(-4 * step);
    let lockedNow = 0;
    for (let i = 0; i < steps; i++) {
      const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
      const vx = sin * c.speed + c.vx, vz = cos * c.speed + c.vz;
      const forward = vx * sin + vz * cos;
      const sideways = vx * cos - vz * sin;
      // in the air the wheels push on nothing: the car keeps its way and its spin
      const air = c.airborne;
      let speed = air ? forward : driveSpeed(forward, throttle, step, D);
      // locked back wheels scrub speed off and let go of the road sideways, so the tail swings out
      const locked = air ? 0 : handbrakeInput * Math.min(1, Math.abs(forward) / 3);
      lockedNow = locked;
      if (locked) speed -= Math.sign(speed) * Math.min(Math.abs(speed), D.brake * 0.55 * handbrakeInput * step);
      const acceleration = (speed - forward) / step;
      // Braking and cornering share tire grip; air resistance does not use it.
      const tireAcceleration = acceleration + D.drag * forward * Math.abs(forward);
      const grip = air ? 0 : Math.sqrt(Math.max(0, D.grip ** 2 - tireAcceleration ** 2));
      // A handbrake slide preserves steering while reducing lateral grip; fade it out at low speed.
      const handbrake = Math.max(locked, forward * throttle < 0 ? Math.abs(throttle) * Math.min(1, Math.abs(forward) / 5) : 0);
      const lateralGrip = grip * (1 - (0.7 + 0.2 * locked) * handbrake);
      const steeringGrip = air ? 0 : (grip + (D.grip - grip) * handbrake) * (1 + 0.8 * locked);

      // Full lock at parking speeds, progressively less steering at road speeds.
      const turn = D.wheelbase * D.cornering;
      const maxSteer = Math.atan(turn / Math.max(speed * speed, turn / Math.tan(D.lock || 0.60)));
      c.steerAngle += (steerInput * maxSteer - c.steerAngle) * steerResponse;
      const yawLimit = steeringGrip / Math.max(2, Math.abs(speed)) * (1 + 1.5 * locked);
      const targetYaw = Math.max(-yawLimit, Math.min(yawLimit, speed * Math.tan(c.steerAngle) / D.wheelbase * (1 + 1.2 * locked)));
      // Collision spin remains part of the yaw velocity; the tires gradually regain control.
      const yawStep = steeringGrip * 1.4 * step;
      c.angularVel += Math.max(-yawStep, Math.min(yawStep, (targetYaw - c.angularVel) * yawResponse));
      c.heading += c.angularVel * step;

      // Turning the chassis must not instantly rotate its momentum. Tires remove sideways slip
      // with a bounded force; longitudinal momentum, including impacts, stays in speed.
      const nextSin = Math.sin(c.heading), nextCos = Math.cos(c.heading);
      const worldX = sin * speed + cos * sideways;
      const worldZ = cos * speed - sin * sideways;
      c.speed = worldX * nextSin + worldZ * nextCos;
      const slip = worldX * nextCos - worldZ * nextSin;
      const correction = Math.max(-lateralGrip * step, Math.min(lateralGrip * step, -slip * tireResponse));
      c.vx = nextCos * (slip + correction);
      c.vz = -nextSin * (slip + correction);
      c.position.x += (nextSin * c.speed + c.vx) * step;
      c.position.z += (nextCos * c.speed + c.vz) * step;
      this.resolveHorizontalCollision(c.position, 1.35, c);
      if (this.railways?.trains?.length) this.collideTrains(c);

      const targetPitch = -Math.max(-1, Math.min(1, acceleration / D.acceleration)) * D.pitch;
      // a car's body rolls out of a bend with the tyres' pull; a bike leans into it, as far as the bend needs
      const turnRate = (nextSin * cos - nextCos * sin) / step;
      const targetRoll = c.bike ? Math.max(-0.85, Math.min(0.85, -Math.atan(c.speed * turnRate / 9.8)))
        : Math.max(-0.09, Math.min(0.09, correction / step * D.roll));
      c.pitchVel += ((targetPitch - c.chassisPivot.rotation.x) * 68 - c.pitchVel * 11.2) * step;
      c.rollVel += ((targetRoll - c.chassisPivot.rotation.z) * 68 - c.rollVel * 11.2) * step;
      c.chassisPivot.rotation.x = Math.max(-0.22, Math.min(0.22, c.chassisPivot.rotation.x + c.pitchVel * step));
      const rollMax = c.bike ? 0.85 : 0.26;
      c.chassisPivot.rotation.z = Math.max(-rollMax, Math.min(rollMax, c.chassisPivot.rotation.z + c.rollVel * step));
      c.heaveVel += (-c.heaveY * 85 - c.heaveVel * 12) * step;
      c.heaveY = Math.max(-0.08, Math.min(0.14, c.heaveY + c.heaveVel * step));
    }
    this.carVertical(c, dt, prevX, prevZ);
    // a wheel run through a pothole (potholes.js): the body drops and kicks on that corner, and the hands feel it
    if (this.potholes && !c.airborne && Math.abs(c.speed) > 2) {
      const hole = this.potholes.jolt(c, this._potholeClock = (this._potholeClock || 0) + dt, c.bike);
      if (hole) {
        const s = hole.depth * Math.min(1, Math.abs(c.speed) / 14);
        c.heaveVel -= 1.6 * s;
        c.pitchVel += (hole.front ? 1 : -1) * 1.8 * s;
        if (!c.bike) c.rollVel += hole.side * 1.4 * s;
        c.speed *= 1 - 0.04 * s;
        rumble(0, Math.min(1, 0.3 + s * 0.6), Math.min(1, 0.4 + s * 0.6), 0.14);
        this.onPothole?.(hole.x, hole.z, s);
      }
    }
    c.chassisPivot.position.y = c.heaveY;
    // how hard the back tires are sliding (skid-effects.js): locked by the handbrake, or the tail slipping sideways
    c.skid = c.airborne ? 0 : Math.max(0, Math.min(1, Math.max(lockedNow * Math.min(1, Math.abs(c.speed) / 6),
      (Math.hypot(c.vx, c.vz) - 1.5) / 4)));

    if (c.carState) {
      c.carState.value.x = braking ? 1 : 0;
      c.carState.value.w = c.speed < -0.2 ? 1 : 0;
    }

    const forwardDist = (c.position.x - prevX) * Math.sin(c.heading) + (c.position.z - prevZ) * Math.cos(c.heading);
    const rawWheelStep = forwardDist / 0.35;
    const wheelStep = Math.sign(rawWheelStep) * Math.min(Math.abs(rawWheelStep), 0.48);
    c.wheelSpin = (c.wheelSpin + wheelStep) % (Math.PI * 2);
    for (const w of c.wheels) {
      w.tire.rotation.x = c.wheelSpin + (w.isFront ? 0.0 : 0.55);
      if (w.isFront) {
        w.steerPivot.rotation.y = c.steerAngle;
      }
    }
  }

  // The car's height: on its wheels it follows the ground, but over a crest faster than gravity can pull it down
  // (the top of the stadium's stands, a hilltop, the stadium's wall) it leaves it and flies, pitching with its path,
  // until it comes down hard on the suspension. In the stadium a step taller than the car can take at its speed (the
  // field's wall, the parapet from inside) stops it like a wall.
  // The highest roof under the car that it was above (or just on): a jump can land it on a building, and it drives
  // about up there till it goes off the edge. Those roofs are kept so they don't push it aside as walls.
  carRoof(c, x, z, lastY, keep) {
    const standing = (this._carStanding ??= new Set());
    if (keep) standing.clear();
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    let roof = -Infinity;
    for (const k of this.nearColliders(x, z, 4)) {
      if (isStadium(k) || k.thin || k.knock || k.parked || k.onHit || k.maxY < lastY - 40 || k.maxY - (k.minY ?? 0) < 2.2) continue;
      let top = -Infinity;
      for (const [s, f] of CAR_CORNERS) top = Math.max(top, roofHeightAt(k, x + cs * s + sn * f, z - sn * s + cs * f));
      if (!Number.isFinite(top) || top > lastY + 0.6) continue;
      if (keep) standing.add(k);
      roof = Math.max(roof, top);
    }
    return roof;
  }

  carVertical(c, dt, prevX, prevZ) {
    const x = c.position.x, z = c.position.z, prevY = c.position.y;
    let ground = Math.max(this.getGroundHeight(x, z, 'car'), this.carRoof(c, x, z, prevY, true));
    const sx = x - STADIUM.cx, sz = z - STADIUM.cz;
    const r = Math.hypot(sx, sz);
    if (r < 160) {
      const climb = 0.45 + 0.055 * Math.abs(c.speed);
      if (ground > prevY + climb && (prevX !== x || prevZ !== z)) {
        // back to where it was, bounced off the step's face (it runs round the stadium, so its normal is radial)
        c.position.x = prevX; c.position.z = prevZ;
        const [rIn] = radiiAt(Math.atan2(sz, sx));
        const out = r < rIn + 1 ? -1 : 1; // the field's wall faces in, the rest of the steps face the field
        const nx = (sx / (r || 1)) * -out, nz = (sz / (r || 1)) * -out;
        const sin = Math.sin(c.heading), cos = Math.cos(c.heading);
        const hit = carWallImpulse(c, sin, cos, prevX, prevZ, nx, nz, c.drive?.mass || 1500);
        if (hit.closing > 0.5) this.carImpactKick(c, sin, cos, nx, nz, hit.dv);
        this.reportCollision(c, null, 'building', prevX - nx * 2, prevY + 0.5, prevZ - nz * 2, nx, 0, nz, hit.closing);
        ground = this.getGroundHeight(prevX, prevZ, 'car');
      }
    }
    c.vy ??= 0;
    const hv = Math.hypot(Math.sin(c.heading) * c.speed + (c.vx || 0), Math.cos(c.heading) * c.speed + (c.vz || 0));
    if (c.airborne) {
      c.vy -= 9.8 * dt;
      c.position.y = prevY + c.vy * dt;
      c.flightTime = (c.flightTime || 0) + dt;
      // nose follows the way it's going, a little behind
      c.airPitch += (Math.atan2(c.vy, Math.max(6, hv)) * Math.sign(c.speed || 1) - c.airPitch) * Math.min(1, dt * 2.5);
      if (c.position.y <= ground) {
        const impact = -c.vy;
        c.position.y = ground;
        c.airborne = false;
        c.vy = 0;
        if (impact > 2) {
          c.heaveVel = (c.heaveVel || 0) - Math.min(4, impact * 0.35);
          c.pitchVel = (c.pitchVel || 0) + Math.min(3, impact * 0.18);
          // a hard landing scrubs speed
          const keep = Math.max(0.7, 1 - impact * 0.012);
          c.speed *= keep;
          this.reportCollision(c, null, 'building', x, ground + 0.2, z, 0, 1, 0, impact * 0.8);
          rumble(0, Math.min(1, impact * 0.08), Math.min(1, impact * 0.05), 0.25);
          if (c.flightTime > 0.4) log(`[jump] ${c.flightTime.toFixed(1)} s in the air, landed at ${impact.toFixed(1)} m/s`);
        }
        c.flightTime = 0;
      }
      return;
    }
    // on the ground: rising or falling as fast as the slope under it carries it
    const back = 2, ux = (x - prevX), uz = (z - prevZ), ul = Math.hypot(ux, uz);
    let slopeVy = 0;
    if (ul > 1e-4) {
      const bx = x - (ux / ul) * back, bz = z - (uz / ul) * back;
      const behind = Math.max(this.getGroundHeight(bx, bz, 'car'), this.carRoof(c, bx, bz, prevY, false));
      // up a dirt pile's or a slide's ramp it climbs its full slope, so it flies off the top
      const steep = this.rampTop(x, z) > -Infinity ? 1.0 : 0.45;
      slopeVy = Math.max(-0.45, Math.min(steep, (ground - behind) / back)) * (ul / dt);
    }
    const ballistic = prevY + c.vy * dt - 4.9 * dt * dt;
    // fast over a crest it flies; off a roof's edge (or anything well above the ground) it drops at any speed
    if ((ballistic > ground + 0.08 && hv > 9) || ballistic > ground + 1.2) {
      c.airborne = true;
      c.vy -= 9.8 * dt;
      c.position.y = ballistic;
      c.flightTime = 0;
      c.airPitch = c.groundPitch || 0;
      c.airRoll = c.groundRoll || 0;
      return;
    }
    c.vy = slopeVy;
    c.position.y = ground;
    // gravity along the slope: quicker down the stands, slower up them
    if (Math.abs(c.speed) > 1) c.speed -= 9.8 * Math.sin(c.groundPitch || 0) * 0.7 * dt;
  }

  updateCyclist(dt) {
    const b = this.entities.cyclist;

    let throttle = 0;
    if (this.keys.forward) throttle = this.keys.forward;
    else if (this.keys.backward) throttle = -0.6 * this.keys.backward;

    b.speed = driveSpeed(b.speed, throttle, dt, BICYCLE_DRIVE);

    let turnInput = 0;
    if (this.keys.left) turnInput = this.keys.left;
    if (this.keys.right) turnInput = -this.keys.right;

    if (Math.abs(b.speed) > 0.15) {
      const dirSign = b.speed >= 0 ? 1 : -1;
      b.heading += turnInput * 2.15 * dirSign * dt;
    }

    b.position.x += Math.sin(b.heading) * b.speed * dt;
    b.position.z += Math.cos(b.heading) * b.speed * dt;
    this.resolveHorizontalCollision(b.position, 0.65, null, b);
    b.position.y = this.getGroundHeight(b.position.x, b.position.z, 'cyclist');

    const targetLean = -turnInput * Math.min(1.0, Math.abs(b.speed) / 9.0) * 0.34;
    b.leanAngle += (targetLean - b.leanAngle) * Math.min(1, dt * 9);
    b.leanPivot.rotation.z = b.leanAngle;

    const wheelDelta = (b.speed / 0.35) * dt;
    b.frontWheel.rotation.x += wheelDelta;
    b.rearWheel.rotation.x += wheelDelta;

    // The cranks turn with the rear wheel through the gears while pedalling (~110 rpm at cruising speed) and
    // freewheel otherwise; the rider's feet follow the pedals (see poseCharacters)
    if (throttle > 0 && wheelDelta > 0) b.pedalPhase += wheelDelta / 3.2;
    b.crankPivot.rotation.x = b.pedalPhase;
    for (const pedal of b.pedals) pedal.rotation.x = -b.pedalPhase;
  }

  // Paddling: forward and back paddle, left and right turn; the river's current carries the kayak downstream, and the
  // banks stop it (it only goes where the water is open, riverDepth). The paddle sweeps one blade then the other through
  // the water, and `strokes` counts each blade going in (the splash, main.js).
  // Pedalling a pedal boat: the paddle wheel turns with the pedals, pushing it on (or back) at a walking pace, and the
  // lever steers its rudder, turning it only while it moves. The current carries it as it carries a kayak, on the
  // livery's still pond hardly at all, and it stays on open water.
  // Bumping the Gallup Park livery's docks, its tied-up pedal boats and the boats out on its water (gallup-livery.js
  // collide), and the river's other docks and the boats tied to them (boat-docks.js): eased back clear of them, slowed, and a knock felt when it's hard
  bumpLiveryBoats(k, dt, afloat) {
    k._bumped = Math.max(0, (k._bumped || 0) - dt);
    const hit = this.livery?.collide(k.position.x, k.position.z, k.heading, k.boat, k.speed) || this.docks?.collide(k.position.x, k.position.z, k.heading);
    if (!hit) return;
    const l = Math.hypot(hit.x, hit.z), m = Math.min(l, 0.6) / l;
    if (afloat(k.position.x + hit.x * m, k.position.z + hit.z * m)) { k.position.x += hit.x * m; k.position.z += hit.z * m; }
    // the part of its way that ran into it is lost
    const fx = Math.sin(k.heading), fz = Math.cos(k.heading), into = -(fx * hit.x + fz * hit.z) / l * Math.sign(k.speed || 1);
    if (into > 0.2) {
      if (Math.abs(k.speed) > 0.8 && !(k._bumped > 0)) {
        this.reportCollision(k, groundCollider, 'ground', k.position.x + fx * 1.2, k.position.y + 0.2, k.position.z + fz * 1.2, 0, 1, 0, Math.abs(k.speed) * 0.3);
        k._bumped = 0.6;
      }
      k.speed *= 1 - Math.min(1, dt * 6) * into;
    }
    k.driftX *= 0.8; k.driftZ *= 0.8;
  }

  updatePedalBoat(dt, k, throttle, turn) {
    k.strokeAmp += ((Math.abs(throttle) > 0.05 ? 1 : 0) - k.strokeAmp) * Math.min(1, dt * 3);
    k.stroke += dt * throttle * 5.5;
    k.pedalWheel.rotation.x = k.stroke;
    // the steersman's hands: the left on the gunwale, the right on the lever, which leans with the turn
    k.hands[0].set(0.62, 0.42, -0.08);
    k.hands[1].set(0.02 - turn * 0.06, 0.62, 0.24);
    k.twist = turn * 0.08;
    k.speed += (throttle * 1.5 - 0.35 * k.speed * Math.abs(k.speed) - 0.25 * k.speed) * dt;
    const turnTarget = turn * 0.55 * Math.min(1, 0.25 + Math.abs(k.speed) / 1.2) * Math.sign(k.speed || 1);
    k.turnVel += (turnTarget - k.turnVel) * Math.min(1, dt * 2.2);
    const flow = this._flow ??= { x: 0, z: 0 };
    const m = riverFlow(k.position.x, k.position.z, flow) ? KAYAK_CURRENT * this.riverScale * 0.4 * riverDepth(k.position.x, k.position.z) : 0;
    k.driftX += (flow.x * m - k.driftX) * Math.min(1, dt);
    k.driftZ += (flow.z * m - k.driftZ) * Math.min(1, dt);
    const h = k.heading + k.turnVel * dt;
    const nx = k.position.x + (Math.sin(h) * k.speed + k.driftX) * dt, nz = k.position.z + (Math.cos(h) * k.speed + k.driftZ) * dt;
    const afloat = (x, z) => riverDepth(x, z) > 0.4 && riverDepth(x + Math.sin(h) * 1.4, z + Math.cos(h) * 1.4) > 0.2 &&
      riverDepth(x - Math.sin(h) * 1.4, z - Math.cos(h) * 1.4) > 0.2;
    k.heading = h;
    if (afloat(nx, nz)) { k.position.x = nx; k.position.z = nz; }
    else { k.speed *= -0.2; k.driftX = k.driftZ = 0; }
    this.bumpLiveryBoats(k, dt, afloat);
    const level = waterLevel(k.position.x, k.position.z) ?? k.position.y;
    k.position.y = level;
    k.groundSpeed = Math.hypot(Math.sin(h) * k.speed + k.driftX, Math.cos(h) * k.speed + k.driftZ);
    k.mesh.position.copy(k.position);
    k.mesh.rotation.y = k.heading;
    k.tiltPivot.rotation.set(Math.sin(k.stroke * 0.5) * 0.008, 0, -k.turnVel * Math.abs(k.speed) * 0.02);
    // the wheel churns rings off the stern as it turns
    const turns = Math.floor(k.stroke / 1.6);
    if (turns !== k._churn) {
      k._churn = turns;
      if (Math.abs(throttle) > 0.05) this.kayakRipple(k, k.position.x - Math.sin(h) * 1.2, k.position.z - Math.cos(h) * 1.2, 0.5);
    }
    this.updateRipples(k, dt);
  }

  updateKayak(dt, elapsed) {
    if (dt <= 0) return;
    const k = this.entities.kayak;
    const throttle = Number(this.keys.forward || 0) - 0.6 * Number(this.keys.backward || 0);
    const turn = Number(this.keys.left || 0) - Number(this.keys.right || 0);

    // the stroke: one blade, then the other, at a pace set by how hard the player paddles. Each blade goes in up by
    // the paddler's feet, is pulled back along the hull fully under water, and comes out at the hip (a reverse stroke
    // runs the other way); the shaft swings over to the other side in between.
    const effort = Math.min(1, Math.max(Math.abs(throttle), Math.abs(turn)));
    if (k.boat === 'paddleboat') { this.updatePedalBoat(dt, k, throttle, turn); return; }
    k.strokeAmp += ((effort > 0.05 ? 1 : 0) - k.strokeAmp) * Math.min(1, dt * 4);
    const entry = (phase) => Math.floor((phase - 0.15 * Math.PI) / Math.PI);
    const before = entry(k.stroke);
    if (effort > 0.05) k.stroke += dt * Math.PI * 2 * 0.72 * (0.6 + 0.4 * effort) * (throttle < 0 ? -1 : 1);
    const s = Math.sin(k.stroke), as = Math.abs(s);
    const deep = as < 0.7 ? (as / 0.7) ** 2 * (3 - 2 * as / 0.7) : 1; // held down through the pull
    const roll = k.strokeAmp * 0.84 * Math.sign(s) * deep;
    const yaw = k.strokeAmp * 0.55 * Math.cos(k.stroke);
    k.paddle.rotation.set(0, yaw, roll, 'YZX');
    const dx = Math.cos(roll) * Math.cos(yaw), dy = Math.sin(roll), dz = -Math.cos(roll) * Math.sin(yaw);
    const c = k.paddle.position;
    k.hands[0].set(c.x + dx * 0.34, c.y + dy * 0.34, c.z + dz * 0.34);
    k.hands[1].set(c.x - dx * 0.34, c.y - dy * 0.34, c.z - dz * 0.34);
    k.twist = -yaw * 0.6;
    // the lower blade's middle (in the kayak's frame), and how much of the blade is under the water line
    const down = dy > 0 ? -1 : 1;
    const bx = c.x + down * dx * 1.02, by = c.y + down * dy * 1.02, bz = c.z + down * dz * 1.02;
    const wet = Math.max(0, Math.min(1, (0.02 - by) / 0.16 + 0.5));
    const sh = Math.sin(k.heading), ch = Math.cos(k.heading);
    const bladeX = k.position.x + bx * ch + bz * sh, bladeZ = k.position.z - bx * sh + bz * ch;
    if (entry(k.stroke) !== before) {
      k.strokes++;
      k.strokeSide = -down;
      this.kayakRipple(k, bladeX, bladeZ, 1);
    }
    if (wet > 0.5 && !k._bladeIn) k._bladeIn = true;
    else if (wet < 0.2 && k._bladeIn) { k._bladeIn = false; this.kayakRipple(k, bladeX, bladeZ, 0.6); }

    // Only a blade in the water moves the kayak: each pull surges it on, and the hull's drag (rising with the square
    // of its speed) slows it between strokes, to about 5 m/s flat out
    const pull = Math.abs(throttle) > 0.05 ? wet * Math.sign(throttle) * 4.2 * (0.6 + 0.4 * Math.abs(throttle)) : 0;
    k.speed += (pull - 0.11 * k.speed * Math.abs(k.speed) - 0.18 * k.speed) * dt;
    // a turn is a sweep stroke: stronger while a blade is in
    const turnTarget = turn * (0.6 + 0.5 * wet) * (0.95 + Math.min(1, Math.abs(k.speed) / 3) * 0.45);
    k.turnVel += (turnTarget - k.turnVel) * Math.min(1, dt * 3.2);

    // the current, strongest out in the middle of the river, carries the kayak along, and where it runs faster at
    // one end than the other (a bend, the edge of the channel) it turns the kayak too
    const flow = this._flow ??= { x: 0, z: 0 };
    const current = (x, z) => riverFlow(x, z, flow) ? KAYAK_CURRENT * this.riverScale * (0.35 + 0.65 * riverDepth(x, z)) : 0;
    let cx = 0, cz = 0;
    {
      const m = current(k.position.x, k.position.z);
      cx = flow.x * m; cz = flow.z * m;
    }
    // on the pond above the cascades: still water, drawing slowly into their channel
    const still = this._still ??= { x: 0, z: 0, weight: 0 };
    if (!pondDraw(k.position.x, k.position.z, still)) still.weight = 0;
    else { cx += (still.x - cx) * still.weight; cz += (still.z - cz) * still.weight; }
    // in the Argo Cascades: their own current, down the channel and quick through each chute, and rough below it
    const rapid = this._rapid ??= { x: 0, z: 0, rough: 0, weight: 0 };
    if (!cascadeCurrent(k.position.x, k.position.z, rapid)) rapid.rough = rapid.weight = 0;
    else { cx += (rapid.x - cx) * rapid.weight; cz += (rapid.z - cz) * rapid.weight; }
    const follow = Math.min(1, dt * (0.9 + 1.6 * rapid.rough));
    k.driftX += (cx - k.driftX) * follow;
    k.driftZ += (cz - k.driftZ) * follow;
    {
      const mb = current(k.position.x + sh * 1.6, k.position.z + ch * 1.6), bowX = flow.x * mb, bowZ = flow.z * mb;
      const ms = current(k.position.x - sh * 1.6, k.position.z - ch * 1.6), sternX = flow.x * ms, sternZ = flow.z * ms;
      // across the hull: what the bow is pushed sideways more than the stern swings the heading
      k.turnVel += ((bowX - sternX) * ch - (bowZ - sternZ) * sh) / 3.2 * Math.min(1, dt * 2.5) * (1 - still.weight);
    }

    // afloat: the middle, the bow and the stern all over open water (the Argo Cascades' channel is open; the rocks of
    // their weirs aren't, but for the chute through each)
    const open = (x, z) => (onWeirRocks(x, z) ? 0 : cascadeDepth(x, z, riverDepth(x, z)));
    const afloat = (x, z, h) => {
      const sn = Math.sin(h) * 1.55, cs = Math.cos(h) * 1.55;
      return open(x, z) > 0.45 && open(x + sn, z + cs) > 0.2 && open(x - sn, z - cs) > 0.2;
    };
    // how far from aground: above 0 afloat; wedged on the rocks, any turn or move that doesn't make it worse is let go
    const fit = (x, z, h) => {
      const sn = Math.sin(h) * 1.55, cs = Math.cos(h) * 1.55;
      return Math.min(open(x, z) - 0.45, open(x + sn, z + cs) - 0.2, open(x - sn, z - cs) - 0.2);
    };
    const freed = (x, z, h) => afloat(x, z, h) || fit(x, z, h) >= fit(k.position.x, k.position.z, k.heading) - 1e-3;
    {
      // wedged for a moment: ease out to the nearest place the whole hull floats
      const wedged = !afloat(k.position.x, k.position.z, k.heading);
      k.wedged = wedged ? (k.wedged ?? 0) + dt : 0;
      if (k.wedged > 0.6 || (wedged && onWeirRocks(k.position.x, k.position.z))) {
        let best = null;
        for (let r = 1; r <= 10 && !best; r += 1) {
          for (let a = 0; a < 16 && !best; a++) {
            const ang = (a / 16) * Math.PI * 2, px = k.position.x + Math.sin(ang) * r, pz = k.position.z + Math.cos(ang) * r;
            for (const dh of [0, 0.4, -0.4, 0.8, -0.8]) if (afloat(px, pz, k.heading + dh)) { best = [px, pz, dh]; break; }
          }
        }
        if (best) {
          const t = Math.min(1, dt * 2.5);
          k.position.x += (best[0] - k.position.x) * t; k.position.z += (best[1] - k.position.z) * t;
          k.heading += best[2] * t;
          k.speed *= 0.5; k.driftX = k.driftZ = 0;
        }
      }
    }
    const x = k.position.x, z = k.position.z;
    // (not on a weir's rocks, which sit in the river's water: the wedged kayak eases off them above)
    if (!afloat(x, z, k.heading) && open(x, z) < 0.2 && !onWeirRocks(x, z)) {
      // somehow ashore: back to the nearest water
      const water = nearestWater(x, z, 2500);
      if (water) { k.position.x = water.x; k.position.z = water.z; }
    }
    let heading = k.heading + k.turnVel * dt;
    if (!freed(k.position.x, k.position.z, heading)) { heading = k.heading; k.turnVel *= 0.3; }
    k.heading = heading;
    const vx = Math.sin(heading) * k.speed + k.driftX, vz = Math.cos(heading) * k.speed + k.driftZ;
    const nx = k.position.x + vx * dt, nz = k.position.z + vz * dt;
    if (freed(nx, nz, heading)) {
      k.position.x = nx; k.position.z = nz;
    } else if (afloat(nx, k.position.z, heading)) {
      k.position.x = nx; k.speed *= 1 - Math.min(1, dt * 2); k.driftZ = 0;
    } else if (afloat(k.position.x, nz, heading)) {
      k.position.z = nz; k.speed *= 1 - Math.min(1, dt * 2); k.driftX = 0;
    } else {
      // nosed into the bank: stop, and ease back out towards deeper water
      if (Math.abs(k.speed) > 0.8) this.reportCollision(k, groundCollider, 'ground', nx, k.position.y + 0.2, nz, 0, 1, 0, Math.abs(k.speed) * 0.4);
      k.speed *= 0.3;
      k.driftX = k.driftZ = 0;
      const e = 1.5;
      const gx = open(k.position.x + e, k.position.z) - open(k.position.x - e, k.position.z);
      const gz = open(k.position.x, k.position.z + e) - open(k.position.x, k.position.z - e);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-4) {
        const px = k.position.x + gx / gl * 0.6 * dt, pz = k.position.z + gz / gl * 0.6 * dt;
        if (open(px, pz) >= open(k.position.x, k.position.z)) { k.position.x = px; k.position.z = pz; }
      }
    }
    this.bumpLiveryBoats(k, dt, (x, z) => afloat(x, z, k.heading) || onWeirRocks(x, z));
    k.position.y = waterLevel(k.position.x, k.position.z) ?? k.position.y;
    // over the river bed: the paddling and the current together, which the speed on screen shows
    k.groundSpeed = Math.min(9, Math.hypot(k.position.x - x, k.position.z - z) / dt);
    const through = Math.abs(k.speed);
    // the wake off the bow, as strong as the kayak is fast through the water
    const w = waterDisturb.wake.value;
    w.x += (Math.min(1, Math.max(0, through - 0.2) / 3) - w.x) * Math.min(1, dt * 3);
    waterDisturb.bow.value.set(k.position.x + sh * 1.7, k.position.z + ch * 1.7, sh, ch);
    this.updateRipples(k, dt);

    // bobbing on the water, leaning into turns and rocking with the stroke
    // and in the cascades, nosing down each drop and tossed about in the white water below it
    const bowY = waterLevel(k.position.x + sh * 1.2, k.position.z + ch * 1.2), sternY = waterLevel(k.position.x - sh * 1.2, k.position.z - ch * 1.2);
    const pitch = bowY != null && sternY != null ? Math.atan((sternY - bowY) / 2.4) : 0;
    k.pitch = (k.pitch ?? 0) + (pitch - (k.pitch ?? 0)) * Math.min(1, dt * 6);
    const r = rapid.rough;
    if (r > 0.05) k.turnVel += Math.sin(elapsed * 5.3) * Math.sin(elapsed * 2.1 + 1) * r * 2.2 * dt;
    k.tiltPivot.position.y = Math.sin(elapsed * 1.7) * 0.015 + r * Math.sin(elapsed * 7.1) * 0.06;
    k.tiltPivot.rotation.z = -k.turnVel * 0.06 * Math.min(1, Math.abs(k.speed) / 2) + Math.sin(elapsed * 1.3) * 0.012 + roll * 0.03
      + r * Math.sin(elapsed * 6.3 + 2) * 0.07;
    k.tiltPivot.rotation.x = Math.sin(elapsed * 1.1 + 0.7) * 0.008 + k.pitch + r * Math.sin(elapsed * 8.2) * 0.05;
    if (r > 0.3) rumble(0, r * 0.3, r * 0.5, 0.1);
  }

  // A ring on the water at (x, z), of `size` metres across when it has spread, at `strength` (its first opacity)
  kayakRipple(k, x, z, strength) {
    if (riverDepth(x, z) < 0.1) return;
    const r = k.ripples.reduce((a, b) => (b.age > a.age ? b : a));
    r.x = x; r.z = z; r.age = 0; r.strength = strength;
  }
  updateRipples(k, dt) {
    k.ripples.forEach((r, i) => {
      r.age += dt;
      r.x += k.driftX * dt;
      r.z += k.driftZ * dt;
      waterDisturb.ripples[i].value.set(r.x, r.z, r.age, r.age < 4 ? r.strength : 0);
    });
  }


  // Where the helicopter's skids come to rest: the highest of the ground (the stadium's bowl inside its wall) and the
  // roofs under its skids that it was above. The roofs it rests on are kept, so they don't push it aside.
  helicopterFloor(h, lastY) {
    const x = h.position.x, z = h.position.z;
    const bowl = bowlSurface(x, z);
    let floor = (bowl !== null ? stadiumGround() + bowl : groundHeight(x, z)) + 0.25;
    const standing = (this._heliStanding ??= new Set());
    standing.clear();
    const sn = Math.sin(h.heading), cs = Math.cos(h.heading);
    for (const c of this.nearColliders(x, z, 4)) {
      if (isStadium(c) || c.thin || c.onHit || c.maxY < floor - 0.25) continue;
      let top = -Infinity;
      for (const [s, f] of HELI_SKIDS) top = Math.max(top, roofHeightAt(c, x + cs * s + sn * f, z - sn * s + cs * f));
      // a roof it was above (or just landing on) holds it up; one above it is a wall it flew into
      if (!Number.isFinite(top) || top + 0.25 > lastY + 0.6) continue;
      standing.add(c);
      floor = Math.max(floor, top + 0.25);
    }
    return floor;
  }

  updateHelicopter(dt, elapsed) {
    const h = this.entities.helicopter;
    if (h.craft === 'plane') return this.updatePlane(dt, elapsed);
    const maxHorizSpeed = 74.6; // 167 mph, Survival Flight's Airbus H145 at its never-exceed speed
    // it climbs faster once well above the rooftops, so the ceiling is a minute and a half away, not three
    const maxVertSpeed = 16.0 + 14 * Math.min(1, Math.max(0, (h.position.y - 250) / 250));

    let fwdInput = 0;
    if (this.keys.forward) fwdInput = this.keys.forward;
    else if (this.keys.backward) fwdInput = -this.keys.backward;

    let yawInput = 0;
    if (this.keys.left) yawInput = this.keys.left;
    if (this.keys.right) yawInput = -this.keys.right;

    let vertInput = 0;
    if (this.keys.up) vertInput = this.keys.up;
    else if (this.keys.down) vertInput = -this.keys.down;

    if (fwdInput !== 0) {
      h.speed += fwdInput * 32.0 * dt;
      h.speed = Math.max(-maxHorizSpeed * 0.6, Math.min(maxHorizSpeed, h.speed));
    } else {
      h.speed *= Math.max(0, 1 - dt * 1.8);
    }

    if (vertInput !== 0) {
      h.verticalSpeed += vertInput * 22.0 * dt;
      h.verticalSpeed = Math.max(-maxVertSpeed, Math.min(maxVertSpeed, h.verticalSpeed));
    } else {
      h.verticalSpeed *= Math.max(0, 1 - dt * 3.5);
    }

    h.heading += yawInput * 1.45 * dt;

    const lastY = h.position.y;
    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y += h.verticalSpeed * dt;

    // Lamp: the skids rest on the ground wherever it is, on the stadium's field and stands, and on any roof it comes
    // down on from above
    let floor = this.helicopterFloor(h, lastY);
    if (!Number.isFinite(floor)) floor = groundHeight(h.position.x, h.position.z) + 0.25;
    if (h.position.y < floor) {
      this.reportCollision(h, groundCollider, 'ground', h.position.x, floor, h.position.z, 0, 1, 0, -h.verticalSpeed);
    }
    h.position.y = Math.max(floor, Math.min(HELI_CEILING, h.position.y));
    this.resolveHorizontalCollision(h.position, 4.5, null, h);

    const targetPitch = (h.speed / maxHorizSpeed) * 0.24;
    const targetRoll = -yawInput * 0.28;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 5);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 5);

    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = Math.sin(elapsed * 2.6) * 0.18;
  }

  // Lamp: a plane off the airport's apron (airport.js dress), flown on the helicopter's controls: forward is throttle
  // and back brakes, left and right turn it (banking in the air), up and down pull up and push over. It rolls on its
  // wheels until about 50 mph, when up lifts it off; it holds its speed in the air, and below that it sinks.
  updatePlane(dt, elapsed) {
    const h = this.entities.helicopter;
    const maxSpeed = 130, liftOff = 22, fullLift = 36; // about 290 mph flat out
    const fwd = this.keys.forward ? this.keys.forward : this.keys.backward ? -this.keys.backward : 0;
    const yaw = this.keys.left ? this.keys.left : this.keys.right ? -this.keys.right : 0;
    const pull = this.keys.up ? this.keys.up : this.keys.down ? -this.keys.down : 0;
    const lastY = h.position.y;
    let floor = this.helicopterFloor(h, lastY);
    if (!Number.isFinite(floor)) floor = groundHeight(h.position.x, h.position.z) + 0.25;
    const grounded = h.position.y <= floor + 0.05;

    // put in the air from standing (the travel buttons), it's at cruising speed
    if (!grounded && h.speed === 0) h.speed = 40;
    if (fwd > 0) h.speed += fwd * (grounded ? 8 : 11) * dt;
    else if (fwd < 0) h.speed += fwd * (grounded ? 11 : 5) * dt;
    else h.speed -= Math.sign(h.speed) * Math.min(Math.abs(h.speed), (grounded ? 1.6 : 0.25) * dt);
    h.speed = Math.max(grounded ? -3 : 12, Math.min(maxSpeed, h.speed));

    const lift = Math.min(1, Math.max(0, (h.speed - liftOff) / (fullLift - liftOff)));
    let targetVS = pull * 17 * lift;
    if (!grounded) targetVS -= (1 - lift) * 9; // too slow to fly: it sinks
    else targetVS = Math.max(0, targetVS);
    h.verticalSpeed += (targetVS - h.verticalSpeed) * Math.min(1, dt * 2.2);
    // climbing costs speed and diving gains it
    if (!grounded) h.speed = Math.min(maxSpeed, h.speed - h.verticalSpeed * 0.12 * dt);

    const turn = grounded ? yaw * 0.85 * Math.min(1, (Math.abs(h.speed) + 1.5) / 8) * Math.sign(h.speed || 1) : yaw * (0.35 + 0.45 * lift);
    h.heading += turn * dt;
    h.position.x += Math.sin(h.heading) * h.speed * dt;
    h.position.z += Math.cos(h.heading) * h.speed * dt;
    h.position.y += h.verticalSpeed * dt;

    floor = this.helicopterFloor(h, lastY);
    if (!Number.isFinite(floor)) floor = groundHeight(h.position.x, h.position.z) + 0.25;
    if (h.position.y < floor) {
      this.reportCollision(h, groundCollider, 'ground', h.position.x, floor, h.position.z, 0, 1, 0, -h.verticalSpeed);
      if (h.verticalSpeed < -8) h.speed *= 0.6; // a hard landing
      h.verticalSpeed = Math.max(0, h.verticalSpeed);
    }
    h.position.y = Math.max(floor, Math.min(HELI_CEILING, h.position.y));
    this.resolveHorizontalCollision(h.position, 4.5, null, h);

    const targetPitch = -Math.atan2(h.verticalSpeed, Math.max(10, Math.abs(h.speed))) * 0.9 - (grounded && pull > 0 && lift > 0.4 ? 0.08 : 0);
    const targetRoll = grounded ? 0 : -yaw * 0.55;
    h.pitchAngle += (targetPitch - h.pitchAngle) * Math.min(1, dt * 4);
    h.rollAngle += (targetRoll - h.rollAngle) * Math.min(1, dt * 3);
    h.tiltPivot.rotation.x = h.pitchAngle;
    h.tiltPivot.rotation.z = h.rollAngle;
    h.tiltPivot.position.y = 0;
    const prop = h.planeModel?.userData.prop;
    if (prop) prop.rotation.z += dt * (14 + Math.abs(h.speed) * 0.8 + Math.max(0, fwd) * 20);
  }
}

// Lamp: a change to how the player moves (the update methods, CAR_DRIVE and the other tuning above) goes into the
// running city with the player where they are (lamp-game.js, "Changes while it's played"); one to what the constructor
// built once (the person's, the car's, the bike's and the helicopter's bodies, the taxi's door decal and plate, the keys)
// opens the page again. The taxi's textures are drawn by functions of this file's own, so their source is kept from one
// version to the next to tell.
const live = hot(import.meta);
const texturesNow = [createGoBluePlateTexture].map(String).join('\n');
const texturesBefore = live.data.taxiTextures ?? texturesNow;
live.data.taxiTextures = texturesNow;
live.accept((next, { changed }) => texturesNow === texturesBefore
  && !changed.some((name) => /\.(create\w*Entity|bindKeyboard)$/.test(name)));

export { ThirdPersonControllerManager };
