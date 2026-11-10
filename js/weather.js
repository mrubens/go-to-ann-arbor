import * as THREE from 'three/webgpu';
import { Fn, float, floor, hash, instanceIndex, mix, normalize, positionLocal, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';

// Lamp: Ann Arbor's weather as it is now, from the National Weather Service's latest observation at Ann Arbor
// Municipal Airport (KARB, api.weather.gov, a US government work in the public domain), asked for when the city opens
// and every 15 minutes. It changes the "Now" sky (clouds, haze, a dimmer sun, wet roads) and lets rain or snow fall
// around the camera. Offline, or when the service doesn't answer, it's a fair day.

const STATION = 'KARB';
const FAIR = { kind: 'fair', amount: 0, text: 'Fair', tempF: null, wind: [0, 0], live: false };

// The observation's words and cloud layers, as one of: fair, partly, cloudy, overcast, haze, fog, rain, storm, snow
function classify(props) {
  const text = (props.textDescription || '').toLowerCase();
  // "Showers in Vicinity" and the like are falling somewhere near the airport, not on it: they keep the clouds, but
  // nothing falls on the player for them
  const parts = text.split(/,|;| and /);
  const nearby = parts.filter((s) => /in vicinity/.test(s)).join(' ');
  const here = parts.filter((s) => !/in vicinity/.test(s)).join(' ');
  const layers = (props.cloudLayers || []).map((l) => l.amount);
  const heavy = /heavy/.test(here) ? 1 : /light|drizzle|flurr/.test(here) ? 0.35 : 0.65;
  let kind = 'fair';
  if (layers.includes('OVC')) kind = 'overcast';
  else if (layers.includes('BKN')) kind = 'cloudy';
  else if (layers.includes('SCT') || layers.includes('FEW')) kind = 'partly';
  // "Partly Cloudy" holds the word "cloudy", so it's read first
  if (/overcast/.test(here)) kind = 'overcast';
  else if (/partly|mostly clear|mostly sunny/.test(here)) kind = 'partly';
  else if (/cloudy/.test(here)) kind = 'cloudy';
  if (/rain|shower|thunder|storm|snow/.test(nearby) && (kind === 'fair' || kind === 'partly')) kind = 'cloudy';
  // haze, smoke and a thin mist dim the distance a little; fog closes it in. The observation's own visibility
  // (meters) tells a mist of several miles from a real fog
  const seen = props.visibility && props.visibility.value;
  if (/haze|smoke|dust/.test(here)) kind = 'haze';
  if (/fog|mist/.test(here)) kind = Number.isFinite(seen) && seen >= 3000 ? 'haze' : 'fog';
  // freezing rain and drizzle fall as rain; freezing fog is fog
  if (/rain|drizzle|shower/.test(here)) kind = 'rain';
  if (/thunder|storm/.test(here)) kind = 'storm';
  if (/snow|flurr|sleet|ice pellets/.test(here)) kind = 'snow';
  const amount = kind === 'rain' || kind === 'snow' || kind === 'storm' ? heavy : 0;
  return { kind, amount };
}

// The last reading the service gave, kept through a failed request: a single error or a moment offline shouldn't
// stop the rain or clear the sky. It's dropped once it's an hour old
let lastLive = null, lastLiveAt = 0;
const KEEP_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

async function askOnce() {
  try {
    // A browser sends its own User-Agent, which the service accepts from a page; nothing of the player's goes with it
    const res = await fetch(`https://api.weather.gov/stations/${STATION}/observations/latest`, {
      headers: { Accept: 'application/geo+json' },
      // never an earlier answer kept by the web view: "latest" changes every few minutes, and a kept one showed this
      // morning's 28°F at noon
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const props = (await res.json()).properties || {};
    const { kind, amount } = classify(props);
    const c = props.temperature && props.temperature.value;
    const speed = ((props.windSpeed && props.windSpeed.value) || 0) / 3.6; // km/h to m/s
    const from = ((props.windDirection && props.windDirection.value) || 0) * Math.PI / 180;
    // blowing toward: x east, z south
    const wind = [-Math.sin(from) * speed, Math.cos(from) * speed];
    return {
      kind, amount, wind, live: true,
      text: props.textDescription || 'Fair',
      tempF: Number.isFinite(c) ? Math.round(c * 9 / 5 + 32) : null
    };
  } catch {
    return null;
  }
}

// A failed request is tried again a minute later, twice, before the answer falls back to the last reading (or a fair
// day); the caller's weather stays as it was meanwhile
async function fetchWeather() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    const w = await askOnce();
    if (w) {
      lastLive = w;
      lastLiveAt = Date.now();
      return w;
    }
  }
  return lastLive && Date.now() - lastLiveAt < KEEP_MS ? lastLive : FAIR;
}

// How each kind of weather changes a time-of-day preset: clouds, the sun's strength, haze and wet roads
const LOOKS = {
  fair: null,
  partly: { cover: 0.5, density: 0.42, sun: 0.92, fog: 1.1, wet: 0 },
  cloudy: { cover: 0.72, density: 0.6, sun: 0.6, fog: 1.4, wet: 0 },
  overcast: { cover: 0.95, density: 0.85, sun: 0.28, fog: 2.0, wet: 0.1 },
  haze: { cover: 0, density: 0, sun: 0.78, fog: 2.6, wet: 0 },
  fog: { cover: 0.9, density: 0.8, sun: 0.3, fog: 9.0, wet: 0.25 },
  rain: { cover: 0.97, density: 0.9, sun: 0.22, fog: 3.2, wet: 0.85 },
  storm: { cover: 1.0, density: 1.0, sun: 0.14, fog: 4.0, wet: 1.0 },
  snow: { cover: 0.97, density: 0.85, sun: 0.3, fog: 4.5, wet: 0.2 }
};
function weatherPreset(p, w) {
  const look = w && LOOKS[w.kind];
  if (!look) return p;
  const grey = (hex, t) => {
    const c = new THREE.Color(hex), g = (c.r + c.g + c.b) / 3;
    return c.lerp(new THREE.Color(g, g, g * 1.04), t).getHex();
  };
  const t = 1 - look.sun;
  return {
    ...p,
    cloudCoverage: Math.max(p.cloudCoverage, look.cover),
    cloudDensity: Math.max(p.cloudDensity, look.density),
    sunIntensity: p.sunIntensity * look.sun,
    envIntensity: p.envIntensity * (0.75 + 0.25 * look.sun),
    hemiIntensity: p.hemiIntensity * (0.85 + 0.15 * look.sun),
    fogDensity: p.fogDensity * look.fog,
    fogColor: grey(p.fogColor, t * 0.8),
    skyHorizon: grey(p.skyHorizon, t * 0.7),
    skyTop: grey(p.skyTop, t * 0.6),
    sunColor: grey(p.sunColor, t * 0.5),
    roadWetness: Math.max(p.roadWetness, look.wet)
  };
}

// Rain streaks or snowflakes in a 70 m box that follows the camera, every drop placed and moved in the shader
const BOX = 70;
const MAX_DROPS = 9000;
function createPrecipitation() {
  const uCam = uniform(new THREE.Vector3());
  const uTime = uniform(0);
  const uFall = uniform(9);
  const uWind = uniform(new THREE.Vector2());
  const uSway = uniform(0);

  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geometry.instanceCount = 0;
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  // camera-facing streaks have no back and front to order: one draw, not a back-face pass then a front-face one
  material.forceSinglePass = true;
  const uColor = uniform(new THREE.Color(0xc8d2dc));
  const uOpacity = uniform(0.3);
  const uSize = uniform(new THREE.Vector2(0.014, 0.7));
  // lit as the air round them is (they are drawn unlit): full by day; at night about a tenth, with the sky's horizon in
  // it, so the snow is not a flurry of self-lit white dots over the dark street (night as moon.js reads it)
  const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
  material.colorNode = uColor.mul(mix(vec3(1), cityUniforms.uSkyHorizonColor.mul(0.6).add(0.1), night));
  material.opacityNode = uOpacity;
  material.positionNode = Fn(() => {
    const i = float(instanceIndex);
    const base = vec3(hash(i), hash(i.add(17.31)), hash(i.add(41.77))).mul(BOX);
    const sway = sin(uTime.mul(0.9).add(i.mul(0.37))).mul(uSway);
    const drift = vec3(uWind.x.mul(uTime).add(sway), uFall.mul(uTime).negate(), uWind.y.mul(uTime).add(sway.mul(0.7)));
    const p = base.add(drift).sub(uCam);
    const rel = p.sub(floor(p.div(BOX)).mul(BOX)).sub(BOX / 2);
    const centre = uCam.add(rel);
    // turned to face the camera about the vertical, leaning with the wind
    const toCam = normalize(vec3(uCam.x.sub(centre.x), 0.0001, uCam.z.sub(centre.z)));
    const right = vec3(toCam.z, 0, toCam.x.negate());
    const lean = vec3(uWind.x, 0, uWind.y).div(uFall.max(1));
    // drops right by the camera shrink away, so none streaks across the view like a pole
    const near = rel.length().div(9).clamp(0.25, 1);
    const y = positionLocal.y.mul(uSize.y).mul(near);
    return centre.add(right.mul(positionLocal.x.mul(uSize.x).mul(near))).add(vec3(0, 1, 0).mul(y)).add(lean.mul(y));
  })();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Precipitation';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;

  const set = (w) => {
    const kind = w && w.kind;
    const falling = (kind === 'rain' || kind === 'storm' || kind === 'snow') && w.amount > 0;
    mesh.visible = falling;
    if (!falling) return;
    const snow = kind === 'snow';
    geometry.instanceCount = Math.round(MAX_DROPS * (snow ? 0.6 : 1) * Math.min(1, w.amount));
    uFall.value = snow ? 1.2 : kind === 'storm' ? 11 : 9;
    uSway.value = snow ? 0.6 : 0;
    uSize.value.set(snow ? 0.07 : 0.014, snow ? 0.07 : 0.7);
    uColor.value.setHex(snow ? 0xf4f7fa : 0xc8d2dc);
    uOpacity.value = snow ? 0.85 : 0.22;
    const [wx, wz] = w.wind || [0, 0];
    uWind.value.set(wx * (snow ? 0.5 : 0.3), wz * (snow ? 0.5 : 0.3));
  };
  const update = (camera, time) => {
    if (!mesh.visible) return;
    uCam.value.copy(camera.position);
    uTime.value = time;
  };
  return { mesh, set, update };
}

export { fetchWeather, weatherPreset, createPrecipitation, FAIR };
