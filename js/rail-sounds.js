// The railroad's own sounds (railways.js cues them, audio-system.js places them): a locomotive's air horn blown in the
// grade-crossing call, its last blast held for as long as the train takes to reach the crossing, and a crossing's
// warning bell ringing while its lamps flash. Both are made in code as loops (one second of the horn's chord, two
// strokes of the bell) and shaped by a gain envelope, so a horn can be held any length without a longer buffer.

const TAU = Math.PI * 2;

// A five-chime air horn (a Nathan K5LA-like chord), each note a whole number of hertz so one second loops seamlessly;
// a slow waver on the reeds' pitch and a little air, both periodic in that second too
function hornLoop(ctx) {
  const rate = ctx.sampleRate, n = Math.round(rate);
  const buffer = ctx.createBuffer(1, n, rate);
  const out = buffer.getChannelData(0);
  const chord = [311, 370, 440, 554, 740];
  const offsets = chord.map((_, i) => (i * 0.37) % 1);
  let peak = 0;
  for (let j = 0; j < n; j++) {
    const t = j / n;
    let tone = 0;
    for (let i = 0; i < chord.length; i++) {
      const p = (chord[i] * t + offsets[i] + 0.0009 * Math.sin(TAU * (t * (2 + i) + i * 0.3))) % 1;
      // reedy and brassy: a sawtooth softened toward a sine
      tone += ((2 * p - 1) * 0.55 + Math.sin(TAU * p) * 0.45) * (i === 0 ? 1 : 0.8);
    }
    tone += Math.sin(TAU * 1733 * t) * 0.04 * Math.sin(TAU * 7 * t);
    out[j] = tone;
    peak = Math.max(peak, Math.abs(tone));
  }
  for (let j = 0; j < n; j++) out[j] *= 0.7 / peak;
  return buffer;
}

// A crossing bell's two strokes (a hammer on a dome gong, ~160 a minute): a struck partial series decaying, each
// stroke's ring carried under the next; the buffer is one period of the strokes, so it loops with no seam
const BELL_STROKE = 0.375;
function bellLoop(ctx) {
  const rate = ctx.sampleRate, T = Math.round(BELL_STROKE * rate), n = T * 2;
  const buffer = ctx.createBuffer(1, n, rate);
  const out = buffer.getChannelData(0);
  // [ratio, amplitude, decay per second]
  const partials = [[1, 1, 7], [2.02, 0.55, 10], [2.74, 0.5, 13], [4.1, 0.22, 18], [5.43, 0.2, 22], [8.9, 0.08, 34]];
  const base = [985, 992]; // the two strokes not quite alike
  let peak = 0;
  for (let j = 0; j < n; j++) {
    let v = 0;
    for (let back = 0; back < 6; back++) {
      // the stroke `back` periods before this sample, wrapped round the loop
      const k = Math.floor(j / T) - back;
      const age = (j - k * T) / rate;
      const f = base[((k % 2) + 2) % 2];
      for (const [r, a, d] of partials) v += Math.sin(TAU * f * r * age) * a * Math.exp(-d * age);
      // the hammer's tick
      if (back === 0 && age < 0.004) v += (Math.sin(j * 12.9898) * 43758.5453 % 1) * 0.6 * (1 - age / 0.004);
    }
    out[j] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let j = 0; j < n; j++) out[j] *= 0.7 / peak;
  return buffer;
}

const made = new WeakMap();
function railBuffers(ctx) {
  let b = made.get(ctx);
  if (!b) made.set(ctx, b = { horn: hornLoop(ctx), bell: bellLoop(ctx) });
  return b;
}

// The blasts, [start, end] in seconds. 'crossing': long, long, short, long (FRA 49 CFR 222.21), the last held `hold`
// seconds, until the train reaches the crossing; 'start': two short, to set off (GCOR 5.8.2)
const LONG = 1.5, SHORT = 0.55, GAP = 0.4;
function hornBlasts(kind, hold) {
  if (kind === 'start') return [[0, SHORT], [SHORT + GAP, 2 * SHORT + GAP]];
  const last = Math.max(LONG, Math.min(30, hold));
  // close to the crossing already: only the one long blast
  if (kind === 'long') return [[0, last]];
  let t = 0;
  const out = [];
  for (const len of [LONG, LONG, SHORT]) { out.push([t, t + len]); t += len + GAP; }
  out.push([t, t + Math.max(LONG, last - t)]);
  return out;
}
const HORN_PATTERN = 2 * (LONG + GAP) + SHORT + GAP; // when the last blast starts

// Play a horn into `output` (an emitter's input); answers an event as audio-events.js playEvent does
function playRailHorn(ctx, output, kind = 'crossing', hold = 0, level = 0.5) {
  const { horn } = railBuffers(ctx);
  const start = ctx.currentTime + 0.02;
  const source = ctx.createBufferSource();
  source.buffer = horn;
  source.loop = true;
  source.playbackRate.value = 0.985 + Math.random() * 0.03;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, start);
  const blasts = hornBlasts(kind, hold);
  for (const [a, b] of blasts) {
    // the valve opens fast and the chord swells; it closes a little slower
    env.gain.setTargetAtTime(level, start + a, 0.025);
    env.gain.setTargetAtTime(0, start + b, 0.06);
  }
  const end = start + blasts[blasts.length - 1][1] + 0.4;
  source.connect(env).connect(output);
  source.start(start, Math.random());
  source.stop(end);
  let disposed = false;
  const event = {
    endTime: end,
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime, fade = immediate ? 0 : 0.05;
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0, now, 0.01);
      try { source.stop(now + fade); } catch { /* already stopped */ }
      event.endTime = Math.min(event.endTime, now + fade);
    }
  };
  source.onended = () => { source.disconnect(); env.disconnect(); disposed = true; };
  return event;
}

// The one crossing bell voice: a looping bell into `output`, its level set each update (0 silent)
function createBellVoice(ctx, output) {
  const { bell } = railBuffers(ctx);
  const source = ctx.createBufferSource();
  source.buffer = bell;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(gain).connect(output);
  source.start();
  return {
    set(level, now) { gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(level, now, 0.08); },
    dispose() { try { source.stop(); } catch { /* stopped */ } source.disconnect(); gain.disconnect(); }
  };
}

export { railBuffers, playRailHorn, createBellVoice, hornBlasts, HORN_PATTERN };
