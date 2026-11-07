import { log } from '../lamp-game.js';

// Lamp: what the device is really doing, to tell a slow GPU from a slow processor. `probe` logs once a page which
// graphics card WebGL draws with (the console's own GPU or a software one) and how long a fixed JavaScript loop takes
// (a few ms with the browser's fast JavaScript on; ten times that or more with it off); `gpuTimer` times each frame's
// drawing on the GPU (EXT_disjoint_timer_query_webgl2), read back a few frames later, for the [frame] line.

function probe(renderer) {
  if (renderer.userData?.probed) return;
  (renderer.userData ||= {}).probed = true;
  const gl = renderer.backend?.gl;
  let gpu = 'unknown';
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = info ? `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}` : `${gl.getParameter(gl.VENDOR)} / ${gl.getParameter(gl.RENDERER)} (no debug info)`;
  }
  // a fixed loop of float arithmetic and an array: ~3-8 ms with a JIT, 100+ ms interpreted
  const t0 = performance.now();
  const a = new Float64Array(1024);
  let s = 0;
  for (let i = 0; i < 4e6; i++) { const k = i & 1023; a[k] = a[k] * 0.5 + i * 1e-6; s += a[k]; }
  const ms = performance.now() - t0;
  const timer = gl?.getSupportedExtensions()?.includes('EXT_disjoint_timer_query_webgl2') ? 'offered, not used' : 'no';
  renderer.userData.deviceLine = `[device] GPU: ${gpu}; a fixed 4M-step JavaScript loop took ${ms.toFixed(1)} ms (${ms < 25 ? 'fast JavaScript on' : 'fast JavaScript seemingly off'}); GPU timer: ${timer}; ${navigator.hardwareConcurrency || '?'} cores (${s > 0 ? 'ok' : ''})`;
  log(renderer.userData.deviceLine);
}

// Times what's drawn between begin() and end() on the GPU. One query at a time; results come back frames later.
// Kept on the renderer, so a change of the code reuses it.
function gpuTimer(renderer) {
  const u = (renderer.userData ||= {});
  if (u.gpuTimer) return u.gpuTimer;
  const gl = renderer.backend?.gl;
  // (not turned on for now: the Xbox lost its graphics within seconds of every start after this was added)
  const ext = null;
  const free = [], pending = [];
  let active = null, total = 0, count = 0;
  const t = {
    available: !!ext,
    begin() {
      if (!ext || active) return;
      active = free.pop() || gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
      // results that are in
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (!disjoint) { total += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; count++; }
        free.push(q);
      }
      if (pending.length > 8) free.push(pending.shift()); // never piles up
    },
    // the average ms a frame since last asked, or null
    take() {
      const v = count ? total / count : null;
      total = 0; count = 0;
      return v;
    }
  };
  u.gpuTimer = t;
  return t;
}

export { probe, gpuTimer };
