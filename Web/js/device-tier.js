// How much of the city a device is given. The whole city laid on its hills holds about 3 GB, which a Mac with memory to
// spare holds ('full'), drawing the ground and houses within 1.5 km. A phone or tablet's browser is ended by the system well before that, so there
// ('phone') only the ground and the houses around the player are built, and filled in as they move (terrain.js,
// buildings.js: `STREAM`), with the far trees, houses and street details cut, no shadows or glow, a smaller drawing and
// fewer cars and people. A Mac with 16 GB or less ('light') streams the same way over a wider area and keeps the look.
// `?tier=phone`, `?tier=light` or `?tier=full` in the page's address chooses one, to try it.
import { log, load } from '../lamp-game.js';
// Lamp writes this beside its runtime in each copy of the game: on the Xbox it names the Xbox's controller
import device from '../lamp-device.js';

const TIERS = {
  // the ground and houses within 1.5 km built, the rest as the player comes near: built whole, the city's ground drew
  // ~14M triangles of hills out to the horizon every frame and held a Mac with any GPU near 30 frames a second
  full: { name: 'full', stream: 1500, shadows: true, bloom: true, antialias: true, scale: 1, traffic: 1, people: 1, farCut: 1, outskirts: true },
  // the ground and houses within 950 m built, the rest as the player comes near
  light: { name: 'light', stream: 950, shadows: true, bloom: true, antialias: true, scale: 0.85, traffic: 0.75, people: 0.75, farCut: 0.75, outskirts: true },
  // the Xbox's lean city (below), held tighter still: iPhone Safari ends a page at well under 2 GB, and the whole of
  // 1 km built (and the ground cut within 10 cm) came to more than that once the drafted houses and bike routes came in.
  // Within 500 m, let go of 120 m beyond that (it crashed after a few minutes of driving keeping 300 m), the ground
  // within 35 cm, uploads spread over frames, 1056x594, a seventh of the cars, a tenth of the people
  phone: { name: 'phone', stream: 500, keepBeyond: 120, ground: 0.35, shadows: false, groundShade: true, mergeTrees: 60000, far: 9000, landmarkReach: 700, spreadLoads: true, warmReach: 400, shadowTile: 768, shadowFar: 110, bloom: false, antialias: false, scale: 0.55, traffic: 0.15, people: 0.1, farCut: 0.2, outskirts: true },
  // a slower computer (a few cores, little memory, a laptop's built-in graphics, or one whose frames took too long to
  // work out last time): the city within 750 m, let go of 200 m beyond, no sun shadows (soft blobs on the ground instead) or glow,
  // drawn at 1536x864, under half the cars and people, and less drawn far off
  slow: { name: 'slow', stream: 750, keepBeyond: 200, ground: 0.2, shadows: false, groundShade: true, spreadLoads: true, warmReach: 600, landmarkReach: 1400, bloom: false, antialias: false, scale: 0.8, traffic: 0.4, people: 0.3, farCut: 0.45, outskirts: true },
  // the Xbox's web view: the phone's city, drawn nearer still (its GPU takes about a twentieth of what a Mac draws of
  // the whole city, and split screen draws it twice), the hills' ground cut to follow them within 35 cm rather than
  // 10 (terrain.js: the ground was most of what's drawn), drawn at the full 1920x1080 (the frame isn't held up by its size, and 1440x810 stretched up looked soft); no sun shadows
  // (their two cascades drew the scene twice more, ~40% of a frame): soft blobs and bands on the ground instead
  // (ground-shade.js), and the countryside kept for the coarse ground under the city it brings
  // (outskirts.js), which shows where the near ground hasn't come in yet rather than the white of the sky. Its edges
  // aren't smoothed: four samples a pixel of the city's bright color and its extra targets held it well short of 30
  // frames a second, as did the things drawn farther out and the traffic
  xbox: { name: 'phone', stream: 600, ground: 0.35, shadows: false, groundShade: true, mergeTrees: 60000, far: 14000, landmarkReach: 1000, spreadLoads: true, warmReach: 700, shadowTile: 768, shadowFar: 110, bloom: false, antialias: false, scale: 1, traffic: 0.22, people: 0.15, farCut: 0.26, outskirts: true }
};

// A phone or a tablet: an iPad says it's a Mac, but has a touch screen
export const TOUCH_DEVICE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
// An Xbox: its browser is given far less memory than a Mac's, and split screen draws the city twice
export const XBOX = /Xbox/i.test(navigator.userAgent) || device?.layout === 'xbox' || device?.controller === 'xbox';
export const FIREFOX = /Firefox\//i.test(navigator.userAgent);

// The tier in use, chosen as this module loads (before anything that imports it builds the city): read by everything
// that builds it, at the top of its module too
export const TIER = { ...TIERS.full };

async function chooseTier() {
  let name = XBOX ? 'xbox' : TOUCH_DEVICE ? 'phone' : 'light';
  let memory = null;
  // the app on a Mac knows how much memory it has; a standalone browser defaults to 'light' (full visuals, 1.8 km streaming)
  if (!TOUCH_DEVICE && !XBOX && window.LampNative?.available) {
    memory = await window.LampNative.call('memory').catch(() => null);
    name = (typeof memory === 'number' && memory > 17) ? 'full' : 'light';
  }
  // a slower computer gets the lighter city (a Mac's own memory or the browser's hints, its graphics, or a frame's own
  // work that took too long last time: main.js saves `slowWork`). The mark saved before as `slowDevice` judged by
  // frames a second, which a 30 Hz screen holds down on any Mac, so it's no longer read.
  let why = null;
  if (!TOUCH_DEVICE && !XBOX) {
    // (the mark lapses after a week, and main.js clears it when the lighter city runs with plenty to spare; one saved
    // on 'full' steps down to 'light' first, one saved on 'light' to 'slow')
    const slowWork = load('slowWork');
    const marked = slowWork && Date.now() - (slowWork.at || 0) < 7 * 864e5;
    if (marked && (slowWork.from ?? 'full') === 'full' && name === 'full') { name = 'light'; log(`[tier] light: ${slowWork.ms ?? '?'} ms of work a frame last time`); }
    else if (marked) why = `${slowWork.ms ?? '?'} ms of work a frame last time`;
    else if (typeof memory === 'number' && memory <= 8.5) why = `${Math.round(memory)} GB`;
    else if (navigator.deviceMemory && navigator.deviceMemory <= 4) why = `${navigator.deviceMemory} GB`;
    else if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) why = `${navigator.hardwareConcurrency} cores`;
    else {
      // (the graphics asked for only when nothing above decided: it makes a throwaway context)
      const gpu = gpuName();
      if (/Intel|SwiftShader|llvmpipe|Software|Basic Render|Mali|Adreno|PowerVR/i.test(gpu)) why = gpu;
    }
    if (why) name = 'slow';
  }
  const asked = new URLSearchParams(location.search).get('tier');
  if (TIERS[asked]) name = asked;
  Object.assign(TIER, TIERS[name]);
  // Firefox's macOS WebGL2 backend stalls heavily on 4x MSAA RGBA16F offscreen blits + 11-pass HDR bloom
  if (FIREFOX && !asked) {
    Object.assign(TIER, { bloom: false, antialias: false, scale: Math.min(TIER.scale, 0.75), farCut: Math.min(TIER.farCut, 0.65) });
  }
  log(`[tier] ${name}${why ? ` (${why})` : ''}${memory ? ` (${Math.round(memory)} GB)` : ''}${TOUCH_DEVICE ? ', a touch device' : ''}${XBOX ? ', an Xbox' : ''}${FIREFOX ? ', firefox' : ''}`);
  return TIER;
}
// the graphics the browser draws with, from a throwaway context, or ''
function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'Software (no WebGL)';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    // (an Apple GPU, Apple's own or one the browser names only as Apple, is never slow here)
    return /Apple/i.test(name) ? '' : String(name || '');
  } catch { return ''; }
}
await chooseTier();
