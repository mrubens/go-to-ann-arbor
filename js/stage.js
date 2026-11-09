// The size the city is drawn at. Everywhere but the Xbox it's drawn at the window's own shape (Lamp's `fill`), filling
// it with no bars, at no more pixels than the fixed stage had: 1920x1080 worth (2.07 million), or the tier's smaller
// size (device-tier.js `scale`: a phone's 1056x594 worth), and never more than the window's own pixels, so a wide
// window draws wider and shorter, a tall one narrower and taller, and the browser scales it up to the window. The
// Xbox keeps Lamp's fixed 1920x1080 stage, which it's tuned for (its log said bigger costs nothing there, smaller
// looked soft). The drawing is never at the display's full pixel ratio: the pixel ratio stays 1 and the size is ours.
import { log } from '../lamp-game.js';
import { TIER, XBOX } from './device-tier.js';

export const FILLS = !XBOX;
const STAGE_W = 1920, STAGE_H = 1080;

// the window's size and the size drawn at, for its shape
export function stageSize() {
  if (!FILLS) return { w: STAGE_W, h: STAGE_H, cssW: STAGE_W, cssH: STAGE_H, aspect: STAGE_W / STAGE_H };
  const cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight), aspect = cssW / cssH;
  const scale = TIER.scale || 1, dpr = window.devicePixelRatio || 1;
  const budget = Math.min(STAGE_W * STAGE_H * scale * scale, cssW * cssH * dpr * dpr);
  return { w: Math.max(1, Math.round(Math.sqrt(budget * aspect))), h: Math.max(1, Math.round(Math.sqrt(budget / aspect))), cssW, cssH, aspect };
}

// Sizes the renderer's canvas to the window (fill) and calls `onSize(w, h)` now and on each resize, for the cameras.
// The canvas fills the window by its style; the drawing behind it is `stageSize()`.
export function fillWindow(renderer, onSize) {
  let last = '';
  const apply = () => {
    const s = stageSize();
    if (FILLS) {
      renderer.setPixelRatio(1);
      renderer.setSize(s.w, s.h, false);
      renderer.domElement.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
    }
    const key = `${s.w}x${s.h}@${s.cssW}x${s.cssH}`;
    if (key !== last) {
      last = key;
      log(`[stage] drawn at ${s.w}x${s.h} (${(s.w * s.h / 1e6).toFixed(2)}M pixels) for a ${s.cssW}x${s.cssH} window, ${s.aspect.toFixed(2)}:1${FILLS ? '' : ', the fixed stage'}`);
    }
    onSize(s.w, s.h);
  };
  apply();
  if (FILLS) window.addEventListener('resize', apply);
  return () => { if (FILLS) window.removeEventListener('resize', apply); };
}
