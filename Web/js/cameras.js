import * as THREE from 'three/webgpu';
import { TIER, XBOX } from './device-tier.js';
import { groundHeight, riverbedHeight, stadiumGround, waterLevel, riverDepth } from './terrain.js';
import { hot, log } from '../lamp-game.js';

// Lamp: the camera systems made, kept through a change of this file (lamp-game.js, "Changes while it's played"), so a
// changed preset is put on the camera in use at once (the end of this file).
const live = hot(import.meta);
const systems = (live.data.systems ??= new Set());

// Under a street or railway bridge's deck: the ground's height there is the deck's (terrain.js groundHeight), which a
// camera following someone well below it (more than UNDER_DECK, on the water or the river's bed) mustn't stand on; it
// stays DECK_DEPTH under the deck's top, below its girders
const UNDER_DECK = 1.5, DECK_DEPTH = 1.3;
const floorUnder = (x, z, y) => {
  const g = groundHeight(x, z);
  return g > y + UNDER_DECK ? Math.min(g, riverbedHeight(x, z)) : g;
};

// Lamp: scenic views placed at street level, which stand on the ground where they are
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// The follow views' feel of speed and of a hit (CameraSystem.feel): the view widens with speed, up to this many degrees
// (less on the Xbox, whose drawing budget a wider view strains); a hit shakes it briefly, a fast car hums it faintly
// and it leans a touch into a bend. The shake, hum and lean are left out for a player who asks their system for
// reduced motion
const SPEED_FOV = XBOX ? 5 : 10;
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const STREET_VIEWS = new Set(['diag', 'mainStreet', 'stateLiberty', 'burtonTower', 'burtonTop', 'bigHouse', 'arbRiver']);

// Chase, action, cockpit, fixed-location and aerial cameras, with mouse/touch orbit and zoom.

const CAMERA_PRESETS = [
  { id: 'chase',       name: '3rd-Person Chase',         category: 'follow', fov: 56 },
  { id: 'action',      name: 'Low-Angle Action',         category: 'follow', fov: 60 },
  { id: 'pov',         name: 'First-Person / Cockpit',   category: 'follow', fov: 68 },
  { id: 'diag', name: 'The Diag',       category: 'scenic', fov: 52 },
  { id: 'mainStreet',    name: 'Main Street',   category: 'scenic', fov: 48 },
  { id: 'stateLiberty', name: 'State & Liberty',  category: 'scenic', fov: 58 },
  { id: 'burtonTower', name: 'Burton Tower & Ingalls Mall', category: 'scenic', fov: 50 },
  { id: 'burtonTop', name: 'Atop Burton Tower',   category: 'scenic', fov: 52 },
  { id: 'bigHouse',  name: 'The Big House',       category: 'scenic', fov: 52 },
  { id: 'arbRiver',  name: 'Arb & Huron River',     category: 'scenic', fov: 46 },
  { id: 'drone',       name: 'Auto-Director Aerial',     category: 'scenic', fov: 50 }
];

class CameraSystem {
  static makeCamera() {
    return new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.35,
      TIER.far || 60000 // at 1:1 the countryside runs out ~20-40 km to the fogged horizon (reversed float depth keeps
      // precision); on the Xbox only as far as the haze at street level hides (device-tier.js)
    );
  }

  // Lamp: the game's code ran again and this system goes with that run; the camera it drove is kept (main.js).
  release() { systems.delete(this); }

  constructor(domElement, controllerManager, camera = CameraSystem.makeCamera()) {
    systems.add(this);
    this.domElement = domElement;
    this.controllerManager = controllerManager;

    this.camera = camera;

    this.activePresetId = 'chase';
    this.orbitYawOffset = 0.0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1.0;
    this.isDragging = false;
    this.userOrbitTimer = 0;

    this.currentPos = new THREE.Vector3(0, 10, 380);
    this.currentLookAt = new THREE.Vector3(0, 8, 440);
    this.initialized = false;

    // Follow cameras (chase / action) are smoothed relative to the followed entity, see update()
    this.followEntity = null;
    this.followOffset = new THREE.Vector3();
    this.followLookOffset = new THREE.Vector3();
    this.followBaseY = 0;
    this.smoothedSpeed = 0;
    this._desiredPos = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();

    this.bindPointerControls();
  }

  bindPointerControls() {
    const canvas = this.domElement;
    const pointers = new Map();
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointers.size >= 2) return;
      // Only two touch pointers may share a gesture; mouse and pen drags stay independent.
      if (pointers.size && (e.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.userOrbitTimer = 4.0;
    });

    canvas.addEventListener('pointermove', (e) => {
      const pointer = pointers.get(e.pointerId);
      if (!pointer) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const pair = pointers.size === 2 ? [...pointers.values()] : null;
      const previousDistance = pair ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0;
      pointer.x = e.clientX;
      pointer.y = e.clientY;

      if (pair) {
        const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
        if (previousDistance > 1 && distance > 1) {
          this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier * previousDistance / distance));
        }
      } else {
        this.orbitYawOffset -= dx * 0.0065;
        this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + dy * 0.005));
      }
      this.userOrbitTimer = 4.0;
    });

    const releasePointer = (id) => {
      if (!pointers.delete(id)) return;
      this.isDragging = pointers.size > 0;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, (e) => releasePointer(e.pointerId));
    }
    const clearPointers = () => {
      for (const id of pointers.keys()) releasePointer(id);
    };
    this._clearPointers = clearPointers;
    window.addEventListener('blur', clearPointers);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearPointers();
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + e.deltaY * 0.001));
    }, { passive: false });
  }

  setCameraPreset(presetId, snapImmediately = false) {
    const preset = CAMERA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.activePresetId = preset.id;
    this.setFov(preset.fov);
    if (snapImmediately) {
      this.initialized = false;
    }
  }

  applyGamepadInput(lookX, lookY, zoom, dt) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.activePresetId !== 'chase' && this.activePresetId !== 'pov') return;
    // POV uses the orbit angles, but only chase renders a zoomed camera distance.
    if (this.activePresetId !== 'chase') zoom = 0;
    if (!lookX && !lookY && !zoom) return;
    this.orbitYawOffset -= lookX * 2.0 * dt;
    this.orbitPitchOffset = Math.max(-0.32, Math.min(0.68, this.orbitPitchOffset + lookY * 1.25 * dt));
    this.zoomMultiplier = Math.max(0.45, Math.min(2.4, this.zoomMultiplier + zoom * 0.9 * dt));
    this.userOrbitTimer = 4.0;
  }

  resetOrbit() {
    this.orbitYawOffset = 0;
    this.orbitPitchOffset = 0.09;
    this.zoomMultiplier = 1;
    this.userOrbitTimer = 0;
    this.lookUp = 0;
  }

  resetForTeleport() {
    // Arrive with a fresh chase view, without carrying a previous drive or gesture into the destination.
    this._clearPointers();
    this.isDragging = false;
    this.resetOrbit();
    this.smoothedSpeed = 0;
    this.followEntity = null;
    this.followOffset.set(0, 0, 0);
    this.followLookOffset.set(0, 0, 0);
    this.followBaseY = 0;
    // a landmark flyover or a jump camera ends here too, or it keeps watching the old place (main.js puts the
    // champion card away once the player is well clear of the tree)
    this.flyover = null;
    this.jumpCam = null;
    this._jumpLooked = false;
    this.setCameraPreset('chase', true);
  }

  // A real jump in the car cuts to a camera set down low beside where it will come down, which turns to follow it
  // through the air and holds a moment after it lands, then the chase or action view glides back. Only from those two
  // views, and only once the car has been up long enough that it isn't a curb or a bump. The same for the player
  // flung hard off a bike or a motorbike, or out of a moving car: a big wipeout, followed by the body until it settles.
  updateJumpCam(entity, dt) {
    const followView = this.activePresetId === 'chase' || this.activePresetId === 'action';
    let jc = this.jumpCam;
    if (jc && (entity !== jc.entity || !followView)) return this.endJumpCam(), false;
    const rag = entity.type === 'person' && entity.fallen && entity.rig?.ragdolling ? entity.rig.rag : null;
    // where to watch: the car, or the thrown body's pelvis (the player's own position stays on the ground meanwhile)
    const at = (out) => (rag ? out.set(rag.p[0], rag.p[1] - 0.4, rag.p[2]) : out.copy(entity.position));
    // a jump that touched down and took off again on a flight too short for a new cut: its numbers once it settles
    const carry = this._jumpCarry;
    if (!jc && carry) {
      if (entity.airborne) {
        const q = entity.position;
        carry.high = Math.max(carry.high, q.y - groundHeight(q.x, q.z));
        carry.air = entity.flightTime || 0;
        carry.still = 0;
      } else if ((carry.still = (carry.still || 0) + dt) > 0.5) {
        this._jumpCarry = null;
        const q = entity.position, air = carry.done + (carry.air || 0);
        const ft = Math.hypot(q.x - carry.x0, q.z - carry.z0) * 3.281;
        this.onJumpStats?.({ air, distanceFt: ft, heightFt: carry.high * 3.281 });
        log(`[jump cam] landed: ${air.toFixed(1)} s in the air, ${Math.round(ft)} ft, ${Math.round(carry.high * 3.281)} ft up`);
      }
    }
    if (!jc) {
      const launch = rag && entity.fallen.launch;
      if (!launch && (entity.type !== 'car' || !entity.airborne)) { this._jumpLooked = false; return false; }
      if (launch ? launch.looked || rag.time > 0.2 : this._jumpLooked || (entity.flightTime || 0) < 0.3) return false;
      if (!followView) return false;
      if (launch) launch.looked = true; else this._jumpLooked = true;
      // the ground a car lands on there (the stadium's stands and field included)
      const surface = (x, z) => this.controllerManager.getGroundHeight?.(x, z, 'car') ?? groundHeight(x, z);
      const p = at(this._jumpAt || (this._jumpAt = new THREE.Vector3()));
      let vx, vy, vz;
      if (launch) ({ vx, vy, vz } = launch);
      else {
        const sn = Math.sin(entity.heading), cs = Math.cos(entity.heading);
        vy = entity.vy || 0;
        vx = sn * entity.speed + (entity.vx || 0);
        vz = cs * entity.speed + (entity.vz || 0);
      }
      const h = Math.max(0, p.y - surface(p.x, p.z));
      const tLeft = (vy + Math.sqrt(vy * vy + 19.6 * h)) / 9.8;
      // only the big ones: well over a second still to fly, or a body flung fast and far (it tumbles on past where it
      // first comes down, so the camera's mark is a little farther along)
      const hv = Math.hypot(vx, vz);
      if (launch ? hv < 9 || hv * tLeft < 6 : tLeft < 1.1 || hv < 8) return false;
      const reach = launch ? tLeft * 0.75 + 0.35 : tLeft * 0.62;
      // beside the arc, a little past its middle, on whichever side has open ground
      const ax = p.x + vx * reach, az = p.z + vz * reach;
      const sx = vz / hv, sz = -vx / hv;
      const side = launch ? Math.min(11, 6 + hv * 0.2) : Math.min(16, 8 + hv * 0.25);
      // what stands in the way: a building the camera would be inside, or a pole, tree or sign between it and the arc
      const blocked = (x, z) => {
        let n = 0;
        for (const k of this.controllerManager.nearColliders(x, z, side)) {
          if (!k.thin) {
            if (x > k.minX && x < k.maxX && z > k.minZ && z < k.maxZ) n += 10;
            continue;
          }
          const kx = (k.minX + k.maxX) / 2, kz = (k.minZ + k.maxZ) / 2;
          const t = clamp01(((kx - x) * (ax - x) + (kz - z) * (az - z)) / (side * side));
          if (Math.hypot(x + (ax - x) * t - kx, z + (az - z) * t - kz) < 1.6) n++;
        }
        return n;
      };
      // either side, near or a little farther back, whichever sees the arc clearest
      let best = null;
      for (const s of [1, -1]) {
        for (const back of [0, 0.35, -0.3]) {
          const x = ax + sx * side * s - (vx / hv) * side * back, z = az + sz * side * s - (vz / hv) * side * back;
          const n = blocked(x, z) + Math.abs(back) * 0.5;
          if (!best || n < best.n) best = { x, z, n };
        }
      }
      const cx = best.x, cz = best.z;
      // never below the arc's lower end (the take-off or where it lands), so a bowl or a dip doesn't hide it
      const landY = surface(p.x + vx * tLeft, p.z + vz * tLeft);
      // and over the river, above its water (the ground there is its bed), so the car is seen going in, not landing
      // on what looks like dry ground under the surface
      const above = (x, z) => (riverDepth(x, z) > 0 ? Math.max(surface(x, z), waterLevel(x, z) ?? -Infinity) : surface(x, z));
      const camY = Math.max(above(cx, cz) + (best.n >= 1 ? 3.2 : 1.1),
        Math.min(p.y, Math.max(landY, above(p.x + vx * tLeft, p.z + vz * tLeft))) + 1.4);
      jc = this.jumpCam = { entity, after: 0, pos: new THREE.Vector3(cx, camY, cz), flight: launch ? tLeft : 0 };
      // Lamp: for the jump's numbers once it lands (a car's: airtime, how far, how high): where it left the ground, back
      // along its flight so far, and the highest it gets over the ground under it
      if (!launch) {
        const ft = entity.flightTime || 0;
        // (a jump that touched down a moment and took off again carries on as one: its take-off, airtime and height)
        const carry = this._jumpCarry;
        this._jumpCarry = null;
        jc.stats = carry ? { ...carry, air: 0, surface } : { x0: p.x - vx * ft, z0: p.z - vz * ft, high: h, done: 0, surface };
      }
      this.currentPos.copy(jc.pos);
      this.currentLookAt.set(p.x, p.y + 0.6, p.z);
      this.setFov(40);
      log(launch ? `[jump cam] cut to the side of a wipeout at ${Math.round(hv * 2.237)} mph` : `[jump cam] cut to the side for about ${tLeft.toFixed(1)} s in the air`);
    }
    // a body is down once it lies still (or has tumbled a good while), a car once it lands
    const s = jc.stats;
    if (s && entity.airborne) {
      const q = entity.position;
      // off the ground again after touching down: the same jump carries on; if it's heading well away from the camera,
      // cut to a new spot beside this flight (keeping the jump's numbers)
      if (s.down) {
        s.done += s.air || 0;
        s.air = 0;
        s.down = false;
        jc.after = 0;
        const sp = Math.hypot(entity.speed || 0, entity.vy || 0);
        if (q.distanceTo(jc.pos) > 25 || sp > 15) {
          this._jumpCarry = { x0: s.x0, z0: s.z0, high: s.high, done: s.done };
          this.endJumpCam();
          this._jumpLooked = false;
          return false;
        }
      }
      s.high = Math.max(s.high, q.y - s.surface(q.x, q.z));
      s.air = entity.flightTime || 0;
    }
    if (jc.flight ? !rag || rag.still > 0.25 || rag.time > jc.flight + 2.5 : !entity.airborne) {
      if (s) s.down = true;
      jc.after += dt;
      // settled (half a second down, not a bounce on the way): the numbers, once (main.js shows them: onJumpStats)
      if (s && !s.told && jc.after > 0.5) {
        s.told = true;
        const q = entity.position, air = s.done + (s.air || 0);
        const ft = Math.hypot(q.x - s.x0, q.z - s.z0) * 3.281;
        this.onJumpStats?.({ air, distanceFt: ft, heightFt: s.high * 3.281 });
        log(`[jump cam] landed: ${air.toFixed(1)} s in the air, ${Math.round(ft)} ft, ${Math.round(s.high * 3.281)} ft up`);
      }
    }
    if (jc.after > (jc.stats ? 1.0 : 0.8)) return this.endJumpCam(), false;
    // the camera stays put and pans with the car, a little lazily so it feels hand-held
    const p = at(this._jumpAt);
    this.currentPos.copy(jc.pos);
    this._desiredLook.set(p.x, p.y + 0.6, p.z);
    this.currentLookAt.lerp(this._desiredLook, 1 - Math.exp(-dt * 9));
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    return true;
  }

  // A slow circling flyover around a point (a champion tree, main.js): `height` is how tall it is and `spread` how wide,
  // so the circle is wide enough to see all of it, a little above its middle, looking at it. Swoops in from where the
  // camera is; endFlyover() glides back to the view in use.
  startFlyover(x, z, height, spread) {
    const g = groundHeight(x, z);
    this.flyover = {
      x, z, g, height,
      radius: Math.max(16, spread * 0.85, height * 0.95),
      angle: Math.atan2(this.currentPos.x - x, this.currentPos.z - z),
      t: 0
    };
    log(`[camera] flyover at ${Math.round(x)}, ${Math.round(z)}`);
  }
  endFlyover() {
    if (!this.flyover) return;
    this.flyover = null;
    this.followEntity = null; // the follow view re-anchors from where the flyover left it and glides back
  }
  // A view another part sets while it's on (golf-play.js: down the line, then after the ball): `override(dt, pos,
  // look)` fills where the camera goes and what it looks at and returns how quickly to ease there, or false
  updateOverride(dt) {
    const rate = this.override?.(dt, this._desiredPos, this._desiredLook);
    if (!rate) return false;
    if (this.jumpCam) this.jumpCam = null;
    const k = 1 - Math.exp(-dt * rate);
    this.currentPos.lerp(this._desiredPos, k);
    this.currentLookAt.lerp(this._desiredLook, k);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    this.followEntity = null; // the follow view re-anchors from here once it's over
    return true;
  }

  updateFlyover(dt) {
    const f = this.flyover;
    if (!f) return false;
    f.t += dt;
    f.angle += dt * 0.22;
    // rises and falls a little as it goes round
    const alt = f.g + f.height * (0.75 + 0.18 * Math.sin(f.t * 0.3)) + 4;
    const r = f.radius * (1 + 0.08 * Math.sin(f.t * 0.17));
    const px = f.x + Math.sin(f.angle) * r, pz = f.z + Math.cos(f.angle) * r;
    this._desiredPos.set(px, Math.max(alt, groundHeight(px, pz) + 3), pz);
    this._desiredLook.set(f.x, f.g + f.height * 0.5, f.z);
    const k = 1 - Math.exp(-dt * (f.t < 2.5 ? 1.6 : 6));
    this.currentPos.lerp(this._desiredPos, k);
    this.currentLookAt.lerp(this._desiredLook, k);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    return true;
  }

  // Lamp: on a playground swing (controllers.js boardSwing) or sat down anywhere (sitDown: a bench, a cafe chair, a
  // picnic table, the bleachers), from the chase or action view, the camera eases well back and up behind them, a wide
  // view out over what they face, and looks slowly about it, side to side and a little up and down, as someone taking
  // in the scenery would; the follow view glides back when they're up again
  updateSwingCam(entity, dt) {
    const cm = this.controllerManager, person = entity.type === 'person';
    const sw = person && cm.swings ? entity.swing : null, sit = person && !sw ? entity.sitting : null;
    const followView = this.activePresetId === 'chase' || this.activePresetId === 'action';
    let sc = this.swingCam;
    const what = sw ? sw.seat : sit ? sit.seat : null;
    if (!what || !followView) {
      if (sc) { this.swingCam = null; this.followEntity = null; this.setCameraPreset(this.activePresetId); }
      return false;
    }
    // where they are and the way they face
    let ox, oz, fx, fz;
    if (sw) {
      const st = cm.swings.state(sw.seat, this._swingSt || (this._swingSt = { pivot: new THREE.Vector3(), along: new THREE.Vector3(), point: new THREE.Vector3(), vel: new THREE.Vector3() }));
      ox = st.pivot.x; oz = st.pivot.z; fx = st.along.x * sw.side; fz = st.along.z * sw.side;
    } else {
      ox = what.x; oz = what.z; fx = Math.sin(what.yaw); fz = Math.cos(what.yaw);
    }
    if (!sc || sc.what !== what) {
      sc = this.swingCam = { what, t: 0 };
      this.setFov(55);
    }
    sc.t += dt;
    // looking about: two slow swings of the head that never quite repeat, and the eyes rising and falling a little
    const a = 0.45 * Math.sin(sc.t * 0.16) + 0.2 * Math.sin(sc.t * 0.41 + 1.3);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = fx * ca - fz * sa, dz = fx * sa + fz * ca;
    const g0 = groundHeight(ox, oz);
    // (the camera swings round behind them less than the view turns, so they stay in the lower middle of it)
    const b2 = a * 0.35, cb = Math.cos(b2), sb = Math.sin(b2);
    const bx = fx * cb - fz * sb, bz = fx * sb + fz * cb;
    // (closer in where a building or a wall stands behind them: sat at a cafe table against a shopfront)
    let back = 12;
    if (cm.solidAt) {
      const hy = g0 + 1.6;
      const blocked = (d) => {
        for (let i = 1; i <= 8; i++) {
          const t = (d * i) / 8;
          if (cm.solidAt(ox - bx * t, hy + (1.3 * t) / 12, oz - bz * t)) return true;
        }
        return false;
      };
      while (back > 3 && blocked(back)) back -= 1.5;
    }
    sc.back = sc.back == null ? back : sc.back + (back - sc.back) * Math.min(1, dt * 2);
    const cx = ox - bx * sc.back, cz = oz - bz * sc.back;
    // (low enough, under 3 m, to see out under the park's trees rather than from inside their leaves)
    this._desiredPos.set(cx, Math.max(groundHeight(cx, cz) + 1.7, g0 + 1.6 + 1.3 * sc.back / 12), cz);
    this._desiredLook.set(ox + dx * 30, g0 + 2.2 + 1.3 * Math.sin(sc.t * 0.11 + 0.7), oz + dz * 30);
    const k = 1 - Math.exp(-dt * (sc.t < 3 ? 0.8 : 1.8));
    this.currentPos.lerp(this._desiredPos, k);
    this.currentLookAt.lerp(this._desiredLook, k);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    return true;
  }

  endJumpCam() {
    this.jumpCam = null;
    this.followEntity = null; // the follow view re-anchors from the jump camera and glides back
    this.setCameraPreset(this.activePresetId);
  }

  getActivePreset() {
    return CAMERA_PRESETS.find((p) => p.id === this.activePresetId) || CAMERA_PRESETS[0];
  }

  // `widen`: a window narrower than 16:9 opens the vertical view so the sides seen stay as wide as a 16:9 window's
  // (a phone held upright, a narrow window: the road ahead and the car aren't cropped to a sliver); a wider one keeps
  // the vertical view and just sees more to the sides. Split screen's halves keep their view as it was.
  onResize(width, height, widen = false) {
    this.camera.aspect = width / height;
    this.widen = widen;
    this.setFov(this.baseFov ?? this.camera.fov);
  }

  // the view a preset or the jump camera asks for, opened for a narrow window (`onResize`)
  setFov(fov) {
    this.baseFov = fov;
    this.fovExtra = 0;
    this.projectFov();
  }

  // baseFov opened by fovExtra (the follow views' speed, feel), for a narrow window too
  projectFov() {
    const fov = this.baseFov + (this.fovExtra || 0);
    const a = this.camera.aspect, wide = 16 / 9;
    this.camera.fov = this.widen && a < wide
      ? Math.min(120, 2 * Math.atan(Math.tan(fov * Math.PI / 360) * wide / a) * 180 / Math.PI)
      : fov;
    this.camera.updateProjectionMatrix();
  }

  // The follow camera drawn in toward the player along the line from their head until no building is in the way
  // (controllers.js solidAt), at once, and let back out slowly once the way is clear; not for the helicopter, which flies
  // over them, nor inside a parking structure, which keeps its own camera between its decks
  pullClear(entity, dt) {
    const cm = this.controllerManager;
    let clear = 1;
    const parking = cm.parking;
    if (cm.solidAt && entity.type !== 'helicopter' && !(parking && parking.inside(entity.position.x, entity.position.z))) {
      const hx = entity.position.x, hy = entity.position.y + 1.2, hz = entity.position.z;
      const dx = this.currentPos.x - hx, dy = this.currentPos.y - hy, dz = this.currentPos.z - hz;
      // a sample every meter or so, and the camera's own spot last
      const n = Math.max(3, Math.min(10, Math.ceil(Math.hypot(dx, dz))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        if (cm.solidAt(hx + dx * t, hy + dy * t, hz + dz * t)) { clear = Math.max(0.12, (i - 1) / n - 0.05); break; }
      }
    }
    this.wallPull = clear < (this.wallPull ?? 1) ? clear : (this.wallPull ?? 1) + (clear - (this.wallPull ?? 1)) * (1 - Math.exp(-dt * 2.5));
    if (this.wallPull >= 0.999) return;
    const hy = entity.position.y + 1.2, k = this.wallPull;
    this.currentPos.set(
      entity.position.x + (this.currentPos.x - entity.position.x) * k,
      hy + (this.currentPos.y - hy) * k,
      entity.position.z + (this.currentPos.z - entity.position.z) * k
    );
  }

  update(dt, elapsed) {
    const entity = this.controllerManager.getActiveEntity();
    const desiredPos = this._desiredPos;
    const desiredLook = this._desiredLook;

    if (this.userOrbitTimer > 0 && !this.isDragging) {
      this.userOrbitTimer = Math.max(0, this.userOrbitTimer - dt);
    }

    if (!this.isDragging && this.userOrbitTimer <= 0 && Math.abs(entity.speed) > 0.5) {
      this.orbitYawOffset -= Math.round(this.orbitYawOffset / (Math.PI * 2)) * (Math.PI * 2);
      this.orbitYawOffset += (0.0 - this.orbitYawOffset) * (1 - Math.exp(-dt * 2.2));
    }
    // a teleport to a tall landmark looks up at it (lookUp, in meters), and eases down once the player moves off
    if (this.lookUp && (this.isDragging || Math.abs(entity.speed) > 0.5)) {
      this.lookUp *= Math.exp(-dt * 2.5);
      if (this.lookUp < 0.05) this.lookUp = 0;
    }

    // The follow cameras pull back with speed, eased so that they drift back as the entity speeds up (and in as it
    // slows down); speedLag is about how far their former world-space smoothing left them trailing at 60 FPS
    this.smoothedSpeed += (Math.abs(entity.speed) - this.smoothedSpeed) * (1 - Math.exp(-dt * 3.0));
    const speedLag = this.smoothedSpeed * 0.1;

    // looking back (X, the left stick's click, held: controllers.js keys.lookBack): every follow view turned to see
    // what's behind, at once (a glance, not a pan), and back as it's let go
    const back = this.controllerManager.keys?.lookBack ? Math.PI : 0;
    if (back !== (this._back || 0)) { this._back = back; this._snap = true; }
    const totalYaw = entity.heading + this.orbitYawOffset + back;
    const ahead = entity.heading + back;
    // heard from inside (audio-sources.js: no electric car's warning hum from the driver's seat)
    this.controllerManager.viewInside = this.activePresetId === 'pov';

    if (this.updateOverride(dt)) return;
    if (this.updateJumpCam(entity, dt)) return;
    if (this.updateFlyover(dt)) return;
    if (this.updateSwingCam(entity, dt)) return;

    switch (this.activePresetId) {
      case 'chase': {
        const dist = entity.chaseDistance * this.zoomMultiplier * (1 + Math.min(0.25, this.smoothedSpeed * 0.01));
        const height = entity.chaseHeight * this.zoomMultiplier + Math.sin(this.orbitPitchOffset) * dist * 0.85;
        const horizDist = Math.cos(this.orbitPitchOffset) * dist + speedLag;

        desiredPos.set(
          entity.position.x - Math.sin(totalYaw) * horizDist,
          Math.max(floorUnder(entity.position.x - Math.sin(totalYaw) * horizDist, entity.position.z - Math.cos(totalYaw) * horizDist, entity.position.y) + 0.65, entity.position.y + height),
          entity.position.z - Math.cos(totalYaw) * horizDist
        );

        const lookUpBias = entity.type === 'helicopter' ? 0.2 : (entity.type === 'car' ? 0.52 : 1.55);
        desiredLook.set(
          entity.position.x + Math.sin(ahead) * 5.2,
          entity.position.y + entity.cameraTargetOffset.y + lookUpBias + (this.lookUp || 0),
          entity.position.z + Math.cos(ahead) * 5.2
        );
        break;
      }

      case 'action': {
        const sideOffset = entity.type === 'car' ? 2.65 : (entity.type === 'helicopter' ? 4.2 : 0.95);
        const backDist = (entity.type === 'car' ? 3.6 : (entity.type === 'helicopter' ? 8.5 : 2.8)) + speedLag;
        const lowY = entity.type === 'helicopter' ? entity.position.y + 1.2 : entity.position.y + 0.92;

        desiredPos.set(
          entity.position.x - Math.sin(ahead) * backDist + Math.cos(ahead) * sideOffset,
          Math.max(floorUnder(entity.position.x, entity.position.z, entity.position.y) + 0.55, lowY),
          entity.position.z - Math.cos(ahead) * backDist - Math.sin(ahead) * sideOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(ahead) * 3.2,
          entity.position.y + 1.05,
          entity.position.z + Math.cos(ahead) * 3.2
        );
        break;
      }

      case 'pov': {
        let fwdOffset = 0.35;
        let eyeY = 1.68;
        if (entity.type === 'car') {
          fwdOffset = 0.55;
          eyeY = 1.52;
        } else if (entity.type === 'cyclist') {
          fwdOffset = 0.35;
          eyeY = 1.55;
        } else if (entity.type === 'helicopter') {
          fwdOffset = 1.65;
          eyeY = 1.65;
        } else if (entity.type === 'kayak') {
          fwdOffset = -0.05;
          eyeY = 0.98;
        }

        desiredPos.set(
          entity.position.x + Math.sin(entity.heading) * fwdOffset,
          entity.position.y + eyeY,
          entity.position.z + Math.cos(entity.heading) * fwdOffset
        );
        desiredLook.set(
          entity.position.x + Math.sin(totalYaw) * 40.0,
          entity.position.y + eyeY + Math.sin(-this.orbitPitchOffset) * 18.0 + 1.5,
          entity.position.z + Math.cos(totalYaw) * 40.0
        );
        break;
      }

      case 'diag': {
        // The Diag: across the crossing paths toward the Hatcher Graduate Library
        const sway = Math.sin(elapsed * 0.22) * 3.5;
        desiredPos.set(930.0 + sway, 9.0, 220.0);
        desiredLook.set(820.0, 6.0, 360.0);
        break;
      }

      case 'mainStreet': {
        // Main Street at William, looking north up downtown's shopfronts
        const sway = Math.sin(elapsed * 0.25) * 1.8;
        desiredPos.set(-27.0 + sway, 5.5, 250.0);
        desiredLook.set(-12.0, 8.0, -150.0);
        break;
      }

      case 'stateLiberty': {
        // State & Liberty, looking at the Michigan Theater's marquee
        const sway = Math.sin(elapsed * 0.3) * 3.0;
        desiredPos.set(600.0 + sway, 5.0, 40.0);
        desiredLook.set(500.0, 10.0, -15.0);
        break;
      }

      case 'burtonTower': {
        // Ingalls Mall, looking up at Burton Memorial Tower beside Hill Auditorium
        const sway = Math.cos(elapsed * 0.22) * 2.5;
        desiredPos.set(830.0 + sway, 4.0, 180.0);
        desiredLook.set(797.0, 30.0, 23.0);
        break;
      }

      case 'burtonTop': {
        // From the top of Burton Tower, panning across campus and downtown
        const pan = Math.sin(elapsed * 0.18) * 500.0;
        desiredPos.set(797.0, 61.0, 23.0);
        desiredLook.set(200.0 + pan, 5.0, 100.0);
        break;
      }

      case 'bigHouse': {
        // High over the Big House's north rim, looking down into the bowl and along the field
        const sway = Math.sin(elapsed * 0.25) * 20.0;
        const g = stadiumGround();
        desiredPos.set(-29.0 + sway, g + 75.0, 1330.0);
        desiredLook.set(-29.0, g - 15.0, 1560.0);
        break;
      }

      case 'arbRiver': {
        // High over the Nichols Arboretum and the Huron River, looking back at the city
        const drift = Math.sin(elapsed * 0.15) * 60.0;
        desiredPos.set(2350.0, 70.0, -500.0 + drift);
        desiredLook.set(400.0, 0.0, 0.0);
        break;
      }

      case 'drone': {
        const angle = elapsed * 0.07 + 0.65;
        const radius = 720.0 + Math.sin(elapsed * 0.23) * 140.0;
        const alt = 300.0 + Math.cos(elapsed * 0.19) * 60.0;
        desiredPos.set(
          Math.cos(angle) * radius + 350.0,
          alt,
          Math.sin(angle) * radius + 300.0
        );
        desiredLook.set(350.0, 250.0, 300.0);
        break;
      }
    }

    // Lamp: the street-level views stand on the ground where they are (terrain.js)
    if (STREET_VIEWS.has(this.activePresetId)) {
      const ground = groundHeight(desiredPos.x, desiredPos.z);
      desiredPos.y += ground;
      desiredLook.y += ground;
    }

    if (!this.initialized || this.activePresetId === 'pov') {
      this.currentPos.copy(desiredPos);
      this.currentLookAt.copy(desiredLook);
      this.initialized = true;
      this.followEntity = null; // the follow cameras re-anchor from here
    } else if (this.activePresetId === 'chase' || this.activePresetId === 'action') {
      // Smoothed in the followed entity's frame rather than in world space. A world-space follower trails a moving
      // target by a distance that depends on the frame time (about speed x dt), so with uneven frame times the camera
      // surged back and forth behind an accelerating or fast car. Relative to the entity a steady drive keeps the
      // camera steady, while turns, orbit drags, zoom & the speed pull-back are still eased. The entity's height is
      // eased in world space (curbs, park lawns, jumps, the helicopter climbing).
      if (this.followEntity !== entity) {
        // preset or mode switch: start from where the camera is and glide over to the new framing
        this.followEntity = entity;
        this.followBaseY = entity.position.y;
        this.followOffset.subVectors(this.currentPos, entity.position);
        this.followLookOffset.subVectors(this.currentLookAt, entity.position);
      }
      // (looking back or ahead again: there at once)
      const k = this._snap ? 1 : 1 - Math.exp(-dt * 8.5);
      this._snap = false;
      this.followBaseY += (entity.position.y - this.followBaseY) * k;
      // falling out of the helicopter (free or under the canopy): the height is kept with the player, not eased, or a
      // fall of 50 m/s leaves them below the frame
      if (entity.chute) this.followBaseY = entity.position.y;
      this.followOffset.lerp(desiredPos.sub(entity.position), k);
      this.followLookOffset.lerp(desiredLook.sub(entity.position), k);
      this.currentPos.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followOffset);
      this.currentLookAt.set(entity.position.x, this.followBaseY, entity.position.z).add(this.followLookOffset);
      this.currentPos.y = Math.max(floorUnder(this.currentPos.x, this.currentPos.z, entity.position.y) + 0.55, this.currentPos.y);
      // under a street or railway bridge with the player (the kayak, a swimmer, a car on the river's bed): kept under its
      // deck rather than lifted up through it
      {
        const deck = groundHeight(this.currentPos.x, this.currentPos.z), under = riverbedHeight(this.currentPos.x, this.currentPos.z);
        // (a deck: the ground there is well over the bed under it, which only a bridge's is; not a hill behind them)
        if (deck > entity.position.y + UNDER_DECK && deck > under + 1) {
          const bed = under + 0.4;
          this.currentPos.y = Math.max(bed, Math.min(this.currentPos.y, deck - DECK_DEPTH));
          this.currentLookAt.y = Math.min(this.currentLookAt.y, deck - DECK_DEPTH);
        }
      }
      // not into a building behind the player (their back to a wall, a car backed up to a storefront): drawn in along
      // the line from them until it's clear, at once, and eased back out once there's room again
      this.pullClear(entity, dt);
      // inside a parking structure: kept between the deck the player is on and the one over them, wherever the
      // camera is, so it never looks down through a deck from the floor above or up from the one below
      const parking = this.controllerManager.parking;
      if (parking && entity.type !== 'helicopter' && (parking.inside(entity.position.x, entity.position.z) || parking.inside(this.currentPos.x, this.currentPos.z))) {
        const ey = entity.position.y;
        const roof = Math.min(parking.ceiling(entity.position.x, entity.position.z, ey), parking.ceiling(this.currentPos.x, this.currentPos.z, ey));
        if (roof < Infinity) {
          const floor = Math.max(ey, parking.top(this.currentPos.x, this.currentPos.z, ey + 0.4));
          this.currentPos.y = Math.max(floor + 0.6, Math.min(this.currentPos.y, roof - 0.35));
          this.currentLookAt.y = Math.min(this.currentLookAt.y, roof - 0.4);
        }
      }
      // a car or bike driven into the river: once its roof is under, the camera goes under with it
      const level = entity.type === 'kayak' || entity.type === 'helicopter' ? null : waterLevel(entity.position.x, entity.position.z);
      if (level != null && riverDepth(entity.position.x, entity.position.z) > 0.2 && entity.position.y + 1.3 < level) {
        const bed = floorUnder(this.currentPos.x, this.currentPos.z, entity.position.y) + 0.4;
        this.currentPos.y = Math.max(bed, Math.min(this.currentPos.y, level - 0.4));
        this.currentLookAt.y = Math.min(this.currentLookAt.y, level - 0.5);
      }
    } else {
      this.followEntity = null;
      const k = 1 - Math.exp(-dt * 8.5);
      this.currentPos.lerp(desiredPos, k);
      this.currentLookAt.lerp(desiredLook, k);
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    this.feel(entity, dt, elapsed);
  }

  // Speed and hits felt in the follow views (SPEED_FOV): in the car or on the bike the chase and action views widen
  // from about 18 mph to 67 mph (eased with smoothedSpeed, over the preset's own view: projectFov); a hit in the car
  // (controllers.js feelHit sets `jolt`) shakes the view a few centimetres and a fraction of a degree, gone in about
  // 0.3 s; past about 56 mph the car's view hums faintly; and it leans a degree or two into a bend
  feel(entity, dt, elapsed) {
    const cm = this.controllerManager;
    const follow = this.activePresetId === 'chase' || this.activePresetId === 'action';
    const riding = entity.type === 'car' || entity.type === 'cyclist';
    const extra = follow && riding ? SPEED_FOV * clamp01((this.smoothedSpeed - 8) / 22) : 0;
    if (Math.abs(extra - (this.fovExtra || 0)) > 0.05 || (extra === 0 && this.fovExtra)) {
      this.fovExtra = extra;
      this.projectFov();
    }
    this._shake = Math.max((this._shake || 0) * Math.exp(-dt * 10), cm.jolt || 0);
    cm.jolt = 0;
    // the turn it's making, eased (rad/s)
    const turn = this._lastHeading === undefined ? 0 : Math.atan2(Math.sin(entity.heading - this._lastHeading), Math.cos(entity.heading - this._lastHeading)) / Math.max(dt, 1e-3);
    this._lastHeading = entity.heading;
    this._turn = (this._turn || 0) + (turn - (this._turn || 0)) * (1 - Math.exp(-dt * 4));
    if (reducedMotion?.matches || !(follow || this.activePresetId === 'pov') || !riding) { this._shake = 0; return; }
    const shake = this._shake, v = Math.abs(entity.speed || 0);
    const hum = entity.type === 'car' ? 0.004 * clamp01((v - 25) / 20) : 0;
    const a = shake * 0.05 + hum;
    if (a > 1e-4) {
      this.camera.position.x += (Math.sin(elapsed * 71) + Math.sin(elapsed * 113) * 0.5) * a;
      this.camera.position.y += (Math.sin(elapsed * 83 + 1.3) + Math.sin(elapsed * 127) * 0.5) * a;
      this.camera.position.z += (Math.sin(elapsed * 67 + 2.1) + Math.sin(elapsed * 109) * 0.5) * a;
    }
    // (into the bend: rolling the way it turns; looking back, the other way)
    const lean = Math.max(-0.03, Math.min(0.03, this._turn * Math.min(v, 30) * 0.0011)) * (this._back ? -1 : 1);
    const roll = lean + shake * 0.008 * Math.sin(elapsed * 59);
    if (Math.abs(roll) > 1e-4) this.camera.rotateZ(roll);
  }
}

// Lamp: a change to how the cameras follow and frame the player, or to CAMERA_PRESETS, goes into the running city; one
// to the drag and wheel handling the constructor set up opens the page again.
live.accept((next, { changed }) => {
  // The camera is kept while the game's code runs again, which makes it anew once this file has changed.
  if (changed.includes('CameraSystem.makeCamera')) return false;
  if (changed.some((name) => /\.bindPointerControls$/.test(name))) return false;
  // The field of view is copied from the preset as it's chosen: the one in use takes the new preset now.
  for (const system of systems) system.setCameraPreset(system.activePresetId);
});

export { CAMERA_PRESETS, CameraSystem };
