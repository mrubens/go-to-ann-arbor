// How much of the city a device is given. The whole city laid on its hills holds about 3 GB, which a Mac with memory to
// spare holds ('full'), drawing the ground and houses within 1.5 km. A phone or tablet's browser is ended by the system well before that, so there
// ('phone') only the ground and the houses around the player are built, and filled in as they move (terrain.js,
// buildings.js: `STREAM`), with the far trees, houses and street details cut, no shadows or glow, a smaller drawing and
// fewer cars and people. A Mac with 16 GB or less ('light') streams the same way over a wider area and keeps the look.
// `?tier=phone`, `?tier=light` or `?tier=full` in the page's address chooses one, to try it.
import { log } from '../lamp-game.js';
// Lamp writes this beside its runtime in each copy of the game: on the Xbox it names the Xbox's controller
import device from '../lamp-device.js';

const TIERS = {
  // the ground and houses within 1.5 km built, the rest as the player comes near: built whole, the city's ground drew
  // ~14M triangles of hills out to the horizon every frame and held a Mac with any GPU near 30 frames a second
  full: { name: 'full', stream: 1500, shadows: true, bloom: true, antialias: true, scale: 1, traffic: 1, people: 1, farCut: 1, outskirts: true },
  // the ground and houses within 950 m built, the rest as the player comes near
  light: { name: 'light', stream: 950, shadows: true, bloom: true, antialias: true, scale: 0.85, traffic: 0.75, people: 0.75, farCut: 0.75, outskirts: true },
  // within about 1 km; trees, houses and street details drawn half as far; 1344x756; half the cars, a third of the people
  phone: { name: 'phone', stream: 1000, shadows: false, bloom: false, antialias: false, scale: 0.7, traffic: 0.5, people: 0.35, farCut: 0.5, outskirts: true },
  // the Xbox's web view: the phone's city, drawn nearer still (its GPU takes about a twentieth of what a Mac draws of
  // the whole city, and split screen draws it twice), the hills' ground cut to follow them within 35 cm rather than
  // 10 (terrain.js: the ground was most of what's drawn), drawn at the full 1920x1080 (the frame isn't held up by its size, and 1440x810 stretched up looked soft); no sun shadows
  // (their two cascades drew the scene twice more, ~40% of a frame): soft blobs and bands on the ground instead
  // (ground-shade.js), and the countryside kept for the coarse ground under the city it brings
  // (outskirts.js), which shows where the near ground hasn't come in yet rather than the white of the sky. Its edges
  // aren't smoothed: four samples a pixel of the city's bright color and its extra targets held it well short of 30
  // frames a second, as did the things drawn farther out and the traffic
  xbox: { name: 'phone', stream: 600, ground: 0.35, shadows: false, groundShade: true, mergeTrees: 0, far: 14000, landmarkReach: 1000, spreadLoads: true, warmReach: 700, shadowTile: 768, shadowFar: 110, bloom: false, antialias: false, scale: 1, traffic: 0.22, people: 0.15, farCut: 0.26, outskirts: true }
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
  const asked = new URLSearchParams(location.search).get('tier');
  if (TIERS[asked]) name = asked;
  Object.assign(TIER, TIERS[name]);
  // Firefox's macOS WebGL2 backend stalls heavily on 4x MSAA RGBA16F offscreen blits + 11-pass HDR bloom
  if (FIREFOX && !asked) {
    Object.assign(TIER, { bloom: false, antialias: false, scale: Math.min(TIER.scale, 0.75), farCut: Math.min(TIER.farCut, 0.65) });
  }
  log(`[tier] ${name}${memory ? ` (${Math.round(memory)} GB)` : ''}${TOUCH_DEVICE ? ', a touch device' : ''}${XBOX ? ', an Xbox' : ''}${FIREFOX ? ', firefox' : ''}`);
  return TIER;
}
await chooseTier();
