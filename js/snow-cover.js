import { Fn, vec2, vec3, float, mix, smoothstep, fract, sin, dot, floor, positionWorld, normalWorldGeometry, materialColor } from 'three/tsl';
import { log } from '../lamp-game.js';
import { cityUniforms } from './tsl-materials.js';

// Lamp: snow lying on Ann Arbor after real snowfall. Open-Meteo's snow depth for the town at this hour (its forecast
// model for today and the last days, its ERA5 archive for a day further back, as Lamp's preview's fixed day is) sets
// how much of the ground is white: a dusting shows in patches, a few centimeters covers lawns, roofs and sidewalks;
// the plowed roads keep only slush and open water none. Snow settles on what faces up, never on walls. Weather data
// by Open-Meteo.com (CC BY 4.0).

const AT = { lat: 42.2808, lon: -83.743 };
const SNOW = vec3(0.86, 0.89, 0.93);

const hash = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const vnoise = Fn(([p]) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
});

// How white this point is: faces up, and inside the patches the cover reaches
const snowAt = Fn(([share]) => {
  const cover = cityUniforms.uSnow.mul(share);
  const up = smoothstep(0.55, 0.85, normalWorldGeometry.y);
  const wp = positionWorld.xz;
  const patch = vnoise(wp.mul(0.12)).mul(0.6).add(vnoise(wp.mul(0.9)).mul(0.4));
  const edge = float(1).sub(cover);
  return smoothstep(edge.sub(0.12), edge.add(0.04), patch).mul(up).mul(smoothstep(0.0, 0.05, cover));
});

// Every lit material under root gets the snow over its own color (not where each copy or vertex brings its own color,
// which three.js multiplies in after it: parked cars, the river banks)
function dressForSnow(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.instanceColor || o.geometry?.attributes?.color) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!mat?.isMeshStandardNodeMaterial || mat.transparent || mat.vertexColors || mat.alphaTest > 0 || mat.alphaTestNode || mat.userData.snowDressed) continue;
      const share = mat.userData.snow ?? 1;
      if (share <= 0) continue;
      mat.userData.snowDressed = true;
      const base = mat.colorNode ? vec3(mat.colorNode) : materialColor.rgb;
      mat.colorNode = mix(base, SNOW, snowAt(float(share)));
      mat.needsUpdate = true;
      n++;
    }
  });
  return n;
}

const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

// Meters of snow on the ground in Ann Arbor now, by the game's clock; null when neither service answers
async function fetchSnowDepth() {
  const now = Date.now();
  const q = `latitude=${AT.lat}&longitude=${AT.lon}&hourly=snow_depth&start_date=${day(now - 864e5)}&end_date=${day(now)}&timezone=America%2FDetroit`;
  for (const base of ['https://api.open-meteo.com/v1/forecast', 'https://archive-api.open-meteo.com/v1/archive']) {
    try {
      const res = await fetch(`${base}?${q}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const d = await res.json();
      const times = d?.hourly?.time, depth = d?.hourly?.snow_depth;
      if (!Array.isArray(times) || !Array.isArray(depth)) continue;
      // the hour nearest now, or the last one known before it
      const hour = new Date(now).toLocaleString('sv-SE', { timeZone: 'America/Detroit' }).slice(0, 13).replace(' ', 'T');
      let best = null;
      for (let i = 0; i < times.length; i++) if (times[i].slice(0, 13) <= hour && depth[i] != null) best = depth[i];
      if (best != null) return best;
    } catch { /* try the next */ }
  }
  return null;
}

async function loadSnowCover() {
  const depth = await fetchSnowDepth();
  if (depth == null) { log('[snow] no snow depth from Open-Meteo: the ground stays bare'); return 0; }
  const cover = Math.min(1, Math.max(0, (depth - 0.004) / 0.05));
  cityUniforms.uSnow.value = cover;
  log(`[snow] ${Math.round(depth * 100)} cm on the ground in Ann Arbor: ${Math.round(cover * 100)}% white`);
  return cover;
}

export { dressForSnow, loadSnowCover };
