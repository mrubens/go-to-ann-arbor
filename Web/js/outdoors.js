import * as THREE from 'three/webgpu';
import { Fn, attribute, float, fract, mix, normalize, positionLocal, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import { groundHeight, nearestWater, riverDepth, riverFlow, waterLevel } from './terrain.js';
import { CASCADE_DROPS } from './cascades.js';
import { GEO } from './city-geodata.js';
import { REAL_TREES } from './tree-geodata.js';
import { cityUniforms, treeWind, waterDisturb } from './tsl-materials.js';
import { sunTimes } from './lighting.js';
import { TIER, XBOX } from './device-tier.js';
import { OutdoorsAudio } from './audio-outdoors.js';
import { log } from '../lamp-game.js';

// Lamp: the outdoors as the weather, the river and the season make it (made in main.js, updated each frame):
// - storms: lightning flashing in the clouds every 20 to 60 s, now and then a bolt to the ground, and its thunder late by
//   the strike's distance (a storm 'in the vicinity' only far off, its rain not falling here); rain rings on the
//   Huron and the ponds while it rains (tsl-materials.js waterDisturb.rain)
// - the wind KARB reports in the trees (tsl-materials.js treeWind), the hydrant spray and a kayak's drift; offline, or
//   under a set time of day, the old gentle breeze
// - fireflies blinking low over the parks for an hour or two after sunset in June and July (not on the Xbox, with the
//   other animals)
// - the sounds of all of it (audio-outdoors.js), told what's around the listener: rain on a car's roof or under trees,
//   the river and its weirs, and the insects by month, hour and temperature
// The flash only lifts the sky's fill and reflections for a fraction of a second (lighting.js's preset is put back,
// and the reflections are never baked again for it).

const SMALL = XBOX || TIER.name === 'phone' || TIER.name === 'slow';
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

// A debug switch for the season: ?date=2026-07-04T21:45 on the page's address (or TRY_DATE here) makes the insects and
// fireflies those of that date and hour (the sky stays the real one). Empty: now
const TRY_DATE = '';
const tryDate = (() => {
  let s = TRY_DATE;
  try { s = new URLSearchParams(location.search).get('date') || TRY_DATE; } catch { /* no page address */ }
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t - Date.now() : 0;
})();

const DETROIT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
function clock(ms) {
  const p = {};
  for (const part of DETROIT.formatToParts(new Date(ms))) p[part.type] = +part.value;
  const doy = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 864e5) + 1;
  const { rise, set } = sunTimes(ms);
  const hourOf = (t) => (t ? (() => { const q = {}; for (const part of DETROIT.formatToParts(new Date(t))) q[part.type] = +part.value; return q.hour + q.minute / 60; })() : null);
  return { doy, hour: p.hour + p.minute / 60, rise: hourOf(rise) ?? 6.5, set: hourOf(set) ?? 19.5 };
}
// the hour a set time of day stands for, by the real sunset
const PRESET_HOUR = { midday: () => 13, golden: (c) => c.set - 0.7, twilight: (c) => c.set + 0.6, midnight: () => 1 };

// how far into a span of days (or hours, wrapping past midnight) t is, ramping up and down over `ramp` at each end
function within(t, from, to, ramp, wrap = 0) {
  if (wrap && to < from) to += wrap;
  if (wrap && t < from) t += wrap;
  return clamp((t - from) / ramp) * clamp((to - t) / ramp);
}

// Where the water drops: the Argo Cascades' weirs, and the spillways of Argo Dam and of Barton Dam (where Barton Pond
// meets the river below it, in the map's water)
const FALLS = [
  ...CASCADE_DROPS.map((d) => ({ x: (d.a[0] + d.b[0]) / 2, z: (d.a[1] + d.b[1]) / 2, loud: 1, ref: 5 })),
  { x: 158, z: -1256, loud: 2.2, ref: 12 },
  { x: -478, z: -3165, loud: 2.6, ref: 14 }
];

// The parks, for the fireflies and the insects
const PARKS = (GEO.parks || []).map((p) => {
  const ring = p.rings[0];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
  }
  return { ring, x0, x1, z0, z1, quad: /Diag|Ingalls Mall|Law Quad|Liberty Plaza|Hanover Square/.test(p.name) };
});
function inPark(x, z) {
  for (const p of PARKS) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1 || p.quad) continue;
    let c = false;
    const r = p.ring;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    }
    if (c) return true;
  }
  return false;
}
const downtown = (x, z) => Math.abs(x - 40) < 330 && Math.abs(z + 20) < 420;

// The street trees in 20 m cells, made the first time they're asked about: how many stand within 9 m
let treeCells = null;
function treesNear(x, z) {
  if (!treeCells) {
    treeCells = new Map();
    for (let i = 0; i < REAL_TREES.length; i += 2) {
      const k = Math.floor(REAL_TREES[i] / 20) * 65536 + Math.floor(REAL_TREES[i + 1] / 20);
      let c = treeCells.get(k);
      if (!c) treeCells.set(k, (c = []));
      c.push(REAL_TREES[i], REAL_TREES[i + 1]);
    }
  }
  let n = 0;
  const i0 = Math.floor((x - 9) / 20), i1 = Math.floor((x + 9) / 20), j0 = Math.floor((z - 9) / 20), j1 = Math.floor((z + 9) / 20);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const c = treeCells.get(i * 65536 + j);
    if (c) for (let q = 0; q < c.length; q += 2) if ((c[q] - x) ** 2 + (c[q + 1] - z) ** 2 < 81) n++;
  }
  return n;
}

// The bolt: one thin ribbon, jagged, with a branch or two, made again for each strike and turned to face the camera
function createBolt() {
  const uGlow = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  material.fog = false;
  // brightest along its core, soft at its edges
  const across = uv().x.sub(0.5).abs().mul(2);
  material.colorNode = vec3(0.82, 0.86, 1.0).mul(smoothstep(1, 0.1, across)).mul(uGlow).mul(1.2);
  material.opacityNode = smoothstep(1, 0.1, across).mul(uGlow);
  // one geometry, kept: each strike writes its quads into it (a new geometry each time drew stale pieces under WebGPU)
  const QUADS = 40;
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(QUADS * 4 * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const uvArr = new Float32Array(QUADS * 4 * 2), index = [];
  for (let q = 0; q < QUADS; q++) {
    uvArr.set([0, 0, 1, 0, 0, 1, 1, 1], q * 8);
    const v = q * 4;
    index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Lightning';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 6;
  const build = (height, width) => {
    const pos = posAttr.array;
    pos.fill(0);
    let quad = 0;
    const strand = (x0, y0, x1, y1, w, steps, jag) => {
      let x = x0, y = y0;
      const pts = [[x, y]];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        x = x0 + (x1 - x0) * t + (i < steps ? (Math.random() - 0.5) * jag : 0);
        y = y0 + (y1 - y0) * t + (i < steps ? (Math.random() - 0.5) * jag * 0.3 : 0);
        pts.push([x, y]);
      }
      for (let i = 0; i < pts.length - 1 && quad < QUADS; i++, quad++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        pos.set([ax - w, ay, 0, ax + w, ay, 0, bx - w, by, 0, bx + w, by, 0], quad * 12);
      }
      return pts;
    };
    const main = strand(0, height, (Math.random() - 0.5) * height * 0.3, 0, width, 16, height * 0.12);
    for (let b = 0; b < 1 + Math.floor(Math.random() * 2); b++) {
      const [sx, sy] = main[3 + Math.floor(Math.random() * 10)];
      strand(sx, sy, sx + (Math.random() - 0.5) * height * 0.5, sy - height * (0.2 + Math.random() * 0.25), width * 0.55, 9, height * 0.05);
    }
    posAttr.needsUpdate = true;
  };
  return { mesh, uGlow, build };
}

// Fireflies: a few hundred points of light near the camera over the park lawns, each flashing its own half-second
// J-shaped flash every five to eight seconds, drifting slowly
function createFireflies(count) {
  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  const spots = new Float32Array(count * 4);
  const spot = new THREE.InstancedBufferAttribute(spots, 4);
  spot.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aSpot', spot);
  geometry.instanceCount = count;
  const uCam = uniform(new THREE.Vector3());
  const uOn = uniform(0);
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  material.fog = false;
  const a = attribute('aSpot', 'vec4');
  const seed = a.w;
  const period = seed.mul(2.5).add(5.2);
  const u = fract(time.div(period).add(seed.mul(7.13))).mul(period); // seconds into this one's cycle
  const flash = smoothstep(0.0, 0.08, u).mul(smoothstep(0.55, 0.12, u));
  const r = uv().sub(0.5).length().mul(2);
  const glow = smoothstep(1, 0, r).pow(3).mul(0.8).add(smoothstep(0.25, 0, r));
  material.positionNode = Fn(() => {
    const drift = vec3(sin(time.mul(0.31).add(seed.mul(40))), sin(time.mul(0.23).add(seed.mul(17))).mul(0.4), sin(time.mul(0.27).add(seed.mul(29)))).mul(0.7);
    // rising as it flashes, the J of Photinus
    const centre = a.xyz.add(drift).add(vec3(0, u.min(0.6).mul(0.5), 0));
    const toCam = normalize(vec3(uCam.x.sub(centre.x), 0.0001, uCam.z.sub(centre.z)));
    const right = vec3(toCam.z, 0, toCam.x.negate());
    const near = smoothstep(48, 30, uCam.sub(centre).length());
    const size = float(0.32).mul(near);
    return centre.add(right.mul(positionLocal.x.mul(size))).add(vec3(0, positionLocal.y.mul(size), 0));
  })();
  material.colorNode = vec3(0.78, 1.0, 0.28).mul(glow).mul(flash).mul(uOn).mul(2.2);
  material.opacityNode = glow.mul(flash).mul(uOn);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Fireflies';
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 5;
  const live = new Uint8Array(count);
  let cursor = 0;
  // a few slots a frame: any that has gone out of reach (or was never placed) is put somewhere over a lawn near the camera
  const tend = (cam, reach = 40) => {
    let changed = false;
    for (let k = 0; k < 12; k++) {
      const i = cursor;
      cursor = (cursor + 1) % count;
      const dx = spots[i * 4] - cam.x, dz = spots[i * 4 + 2] - cam.z;
      if (live[i] && dx * dx + dz * dz < reach * reach * 1.3) continue;
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * reach;
      const x = cam.x + Math.cos(ang) * rr, z = cam.z + Math.sin(ang) * rr;
      live[i] = 1;
      if (!inPark(x, z) || riverDepth(x, z) > 0.05) { spots[i * 4 + 1] = -1000; spots[i * 4] = x; spots[i * 4 + 2] = z; changed = true; continue; }
      spots[i * 4] = x; spots[i * 4 + 1] = groundHeight(x, z) + 0.3 + Math.random() ** 1.5 * 2.6; spots[i * 4 + 2] = z;
      spots[i * 4 + 3] = Math.random();
      changed = true;
    }
    if (changed) spot.needsUpdate = true;
  };
  return { mesh, uCam, uOn, tend };
}

function createOutdoors({ scene, lightingSystem, audioSystem, controllerManager, hydrantSpray }) {
  // the scene outlives a change to the code: take away what a previous run left in it
  for (const old of scene.children.filter((c) => c.name === 'Lightning' || c.name === 'Fireflies')) scene.remove(old);
  const sound = new OutdoorsAudio(audioSystem);
  const bolt = createBolt();
  scene.add(bolt.mesh);
  const flies = XBOX ? null : createFireflies(SMALL ? 120 : 260);
  if (flies) scene.add(flies.mesh);

  let weather = null, look = null;
  let storm = null; // { thunder: 'here' | 'near', next: seconds }
  const flash = { pulses: [], t: 0, wrote: null, base: null };
  const wind = { dir: new THREE.Vector2(0.86, 0.51), strength: 1, x: 0, z: 0, speed: 0 };
  const env = { x: 0, z: 0, canopy: 0, park: false, water: null, falls: null, waterAt: -10, envAt: -10, clockAt: -10, clock: null };
  const state = { rain: 0, storm: 0, inCar: false, canopy: 0, water: null, falls: null, wind: 0, insects: {}, chirpRate: 1, snow: 0, altitude: 0, leafy: 1 };

  // the weather now, put on the trees, the spray, the kayak and the water
  function setWeather(w, presetId) {
    const real = presetId === 'now' ? w : null;
    if (real === weather && presetId === look) return;
    weather = real; look = presetId;
    const [wx, wz] = real && real.live && real.wind ? real.wind : [0, 0];
    const speed = Math.hypot(wx, wz);
    wind.speed = real && real.live ? speed : 3.5;
    if (real && real.live && speed > 0.3) wind.dir.set(wx / speed, wz / speed);
    else if (!(real && real.live)) wind.dir.set(0.86, 0.51);
    wind.strength = real && real.live ? clamp(0.2 + speed / 5.5, 0.2, 2.4) : 1;
    // at the street the wind is about half what it is at the airport's 10 m mast
    if (real && real.live) hydrantSpray?.setWind(wx * 0.45, wz * 0.45);
    else hydrantSpray?.setWind(0.9, 0.35);
    if (controllerManager) {
      const k = real && real.live ? Math.min(0.25, speed * 0.02) / Math.max(speed, 0.001) : 0;
      controllerManager.windDrift = { x: wx * k, z: wz * k };
    }
    const kind = real?.kind;
    const rain = (kind === 'rain' || kind === 'storm') ? clamp(real.amount) : 0;
    state.rain = rain;
    state.storm = kind === 'storm' ? 1 : 0;
    waterDisturb.rain.value = rain ? 0.35 + rain * 0.6 : 0;
    const thunder = real?.thunder || (kind === 'storm' ? 'here' : null);
    storm = thunder ? { thunder, next: storm?.next ?? 3 + Math.random() * 8 } : null;
    state.thunder = !!storm;
    log(`[outdoors] ${real ? `${real.text}: ` : `${presetId}: `}wind ${wind.speed.toFixed(1)} m/s, trees ×${wind.strength.toFixed(2)}${rain ? `, rain ${rain.toFixed(2)} on the water` : ''}${storm ? `, thunder ${storm.thunder}` : ''}`);
  }

  // a strike: where, how bright, the bolt if it's to the ground and in sight, and its thunder
  function strike(camera) {
    const far = storm.thunder === 'near';
    const d = far ? 7000 + Math.random() * 9000 : 400 + Math.random() ** 1.6 * 7600;
    const ang = Math.random() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    const power = clamp(1.25 - d / 9000, 0.12, 1);
    const pulses = [{ at: 0, a: 1 }];
    if (Math.random() < 0.7) pulses.push({ at: 0.07 + Math.random() * 0.05, a: 0.45 + Math.random() * 0.4 });
    if (Math.random() < 0.4) pulses.push({ at: 0.18 + Math.random() * 0.1, a: 0.3 + Math.random() * 0.4 });
    flash.pulses = pulses.map((p) => ({ ...p, a: p.a * power }));
    flash.t = 0;
    const toGround = Math.random() < (far ? 0.25 : 0.45);
    if (toGround) {
      const x = camera.position.x + dx * d, z = camera.position.z + dz * d;
      const g = groundHeight(x, z) || 0;
      const height = 900 + Math.random() * 500;
      bolt.build(height, Math.max(1.2, d * 0.0012));
      bolt.mesh.position.set(x, g, z);
      bolt.mesh.rotation.set(0, Math.atan2(camera.position.x - x, camera.position.z - z), 0);
      bolt.power = power * (far ? 0.5 : 1);
    } else bolt.power = 0;
    const heard = sound.thunder(d, dx, dz, power);
    log(`[outdoors] lightning ${(d / 1000).toFixed(1)} km off${toGround ? ', a bolt to the ground' : ' in the clouds'}; thunder ${heard ? `not played: ${heard}` : `in ${(d / 343).toFixed(1)} s`}`);
    storm.next = far ? 25 + Math.random() * 60 : 18 + Math.random() * 42;
  }

  // the flash: the sky's fill light, its reflections and its colour lifted for a moment, then put back as they were
  // (a preset put on meanwhile is taken as the new base)
  function applyFlash(dt, night) {
    if (!flash.pulses.length) return;
    flash.t += dt;
    let f = 0;
    for (const p of flash.pulses) if (flash.t >= p.at) f += p.a * Math.exp(-(flash.t - p.at) / 0.045);
    const L = lightingSystem;
    const now = { hemi: L.hemiLight.intensity, env: L.scene.environmentIntensity, exp: L.uSkyExposure.value };
    if (!flash.base || !flash.wrote || now.hemi !== flash.wrote.hemi || now.env !== flash.wrote.env || now.exp !== flash.wrote.exp) {
      flash.base = { ...now, night: L.uNightSkyColor.value.clone() };
    }
    const done = flash.t > 0.6;
    const k = done ? 0 : f * (night ? 1.6 : 0.6);
    L.hemiLight.intensity = flash.base.hemi * (1 + k);
    L.scene.environmentIntensity = flash.base.env * (1 + k * 0.8);
    L.uSkyExposure.value = flash.base.exp * (1 + k * 0.7);
    L.uNightSkyColor.value.copy(flash.base.night).multiplyScalar(1 + k * 1.2);
    flash.wrote = { hemi: L.hemiLight.intensity, env: L.scene.environmentIntensity, exp: L.uSkyExposure.value };
    bolt.mesh.visible = !done && bolt.power > 0 && flash.t < 0.35;
    bolt.uGlow.value = clamp(f) * (bolt.power || 0);
    if (done) { flash.pulses = []; flash.wrote = null; flash.base = null; }
  }

  // what's around the listener, for the sound, a couple of times a second
  function sense(elapsed, camera) {
    const p = camera.position;
    if (elapsed - env.envAt > 0.5) {
      env.envAt = elapsed;
      const ground = groundHeight(p.x, p.z) || 0;
      state.altitude = p.y - ground;
      env.x = p.x; env.z = p.z;
      env.park = inPark(p.x, p.z);
      env.canopy = clamp(treesNear(p.x, p.z) / 4 + (env.park ? 0.25 : 0));
      state.canopy = env.canopy;
      state.inCar = controllerManager?.activeMode === 'car';
      // the nearest weir or spillway, by how loud it would be here; louder with the river's flow (cfs ~ 500 scale^2.5)
      const cfs = 500 * (controllerManager?.riverScale || 1) ** 2.5;
      const flow = clamp(Math.sqrt(cfs / 500), 0.45, 2);
      let best = null, bestHeard = 0;
      for (const f of FALLS) {
        const dist = Math.hypot(f.x - p.x, f.z - p.z);
        if (dist > 600) continue;
        const heard = f.loud / (1 + dist / f.ref);
        if (heard > bestHeard) { bestHeard = heard; best = f; }
      }
      state.falls = best ? { x: best.x, z: best.z, y: (waterLevel(best.x, best.z) ?? groundHeight(best.x, best.z)) + 0.5, loud: best.loud * flow / 2.6, ref: best.ref } : null;
    }
    if (elapsed - env.waterAt > 1 && state.altitude < 150) {
      env.waterAt = elapsed;
      const near = nearestWater(p.x, p.z, 200);
      if (near) {
        const flowDir = env.flowDir ??= { x: 0, z: 0 };
        const moving = riverFlow(near.x, near.z, flowDir);
        state.water = { x: near.x, z: near.z, y: (waterLevel(near.x, near.z) ?? 0) + 0.2, distance: Math.hypot(near.x - p.x, near.z - p.z),
          speed: moving ? 1.5 * (controllerManager?.riverScale || 1) * riverDepth(near.x, near.z) : 0.2 };
      } else state.water = null;
    } else if (state.altitude >= 150) state.water = null;
    if (elapsed - env.clockAt > 5) {
      env.clockAt = elapsed;
      env.clock = clock(Date.now() + tryDate);
    }
  }

  // the insects singing now, 0 to 1 each, and whether the fireflies are out
  function season() {
    const c = env.clock;
    if (!c) return;
    const hour = look === 'now' || !PRESET_HOUR[look] ? c.hour : PRESET_HOUR[look](c);
    const t = weather?.tempF ?? lightingSystem.weather?.tempF ?? null;
    const temp = t ?? (c.doy > 160 && c.doy < 250 ? 75 : 50);
    const warm = (lo) => clamp((temp - lo) / 6);
    const wet = state.rain, snow = clamp(state.snow * 3);
    const dusk = c.set + 0.3, dawn = c.rise - 0.3;
    const night = within(hour, dusk, dawn, 0.5, 24);
    const inTown = downtown(env.x, env.z);
    const green = clamp(env.canopy * 0.7 + (env.park ? 0.5 : 0) + (inTown ? 0 : 0.2));
    const town = inTown ? 0.3 : 1;
    const nearWater = state.water ? clamp(1 - state.water.distance / 400) : 0;
    const peeper = within(c.doy, 82, 142, 10) * within(hour, c.set + 0.2, 2, 0.6, 24) * warm(40) * (1 - snow)
      * (0.15 + 0.85 * Math.max(nearWater, env.park ? 0.5 : 0)) * (1 - wet * 0.5);
    const cicada = within(c.doy, 188, 252, 8) * within(hour, 10, c.set + 0.2, 1) * warm(72) * (1 - wet) * (0.25 + 0.75 * green);
    const cricket = within(c.doy, 198, 288, 9) * Math.max(night, within(hour, 13, c.set, 1) * 0.25) * warm(52) * (1 - wet * 0.8) * (1 - snow) * (0.35 + 0.65 * green);
    const katydid = within(c.doy, 208, 272, 8) * within(hour, c.set + 0.75, 3, 0.6, 24) * warm(60) * (1 - wet) * (0.2 + 0.8 * clamp(env.canopy + (env.park ? 0.3 : 0)));
    state.insects = { peeper: peeper * town, cicada: cicada * town, cricket: cricket * town, katydid: katydid * town };
    // Dolbear: a cricket chirps about as fast as it is warm above 40 °F
    state.chirpRate = clamp((temp - 40) / 30, 0.8, 1.2);
    // the trees in leaf rustle fully; bare ones only whisper
    state.leafy = within(c.doy, 110, 320, 18) * 0.7 + 0.3;
    const fireflies = within(c.doy, 155, 210, 8) * within(hour, c.set + 0.15, c.set + 2.2, 0.35) * warm(60) * (wet > 0 ? 0 : 1) * (1 - snow);
    return fireflies;
  }

  let said = '';
  function update(dt, elapsed, camera) {
    setWeather(lightingSystem.weather, lightingSystem.activePresetId);
    const night = (lightingSystem.uNightFactor?.value ?? 0) > 0.5;
    // the wind eases to what's reported rather than snapping the trees round
    const k = Math.min(1, dt * 0.25);
    const d = treeWind.dir.value;
    d.lerp(wind.dir, k);
    if (d.lengthSq() > 1e-6) d.normalize();
    treeWind.strength.value += (wind.strength - treeWind.strength.value) * k;
    // lightning
    if (storm) {
      storm.next -= dt;
      if (storm.next <= 0) strike(camera);
    }
    applyFlash(Math.min(dt, 0.05), night);
    sense(elapsed, camera);
    state.snow = cityUniforms.uSnow?.value ?? 0;
    const fireflies = season() || 0;
    state.wind = weather?.live ? wind.speed : 2;
    sound.update(dt, state);
    if (flies) {
      const on = state.altitude < 60 ? fireflies : 0;
      flies.mesh.visible = on > 0.01;
      flies.uOn.value = on;
      if (flies.mesh.visible) { flies.uCam.value.copy(camera.position); flies.tend(camera.position); }
    }
    const ins = Object.entries(state.insects).filter(([, v]) => v > 0.05).map(([n, v]) => `${n} ${v.toFixed(1)}`).join(', ');
    const now = `${ins || 'no insects'}${fireflies > 0.05 ? `, fireflies ${fireflies.toFixed(1)}` : ''}`;
    if (now !== said && env.clock && elapsed - (env.saidAt ?? -99) > 10) {
      said = now; env.saidAt = elapsed;
      log(`[outdoors] season: day ${env.clock.doy}, ${env.clock.hour.toFixed(1)} h (sunset ${env.clock.set.toFixed(1)}), ${now}`);
    }
  }

  return { update, sound };
}

export { createOutdoors };
