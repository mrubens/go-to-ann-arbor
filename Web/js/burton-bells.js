import { log } from '../lamp-game.js';
import { gameTime } from './game-clock.js';

// Lamp: Burton Memorial Tower's bells (the Charles Baird Carillon). As U-M's School of Music says, the Westminster
// Quarters play daily on five of its heaviest bells each quarter hour from 9:15 a.m. to 9 p.m., in E-flat, and the 12-ton
// bourdon strikes the hours. Here they ring by the time the game shows (game-clock.js) under "Now" only: a preset's
// clock stands still and rings nothing. One event voice in the audio system's pool (audio-system.js emit 'bells'),
// placed in the bell chamber and heard across central campus, muffled behind buildings as every placed sound is.
// (The weekday noon recitals are live music by the university's carillonists, so they aren't played here.)

const TAU = Math.PI * 2;
const RATE = 24000;
// [ref distance, range] (m) for audio-system.js
const BELL_REACH = { bells: [45, 1000] };
// where the bells hang (campus-landmarks.js sets it as it builds the tower)
const BELL_TOWER = { at: null };
function setBellTower(at) { BELL_TOWER.at = at; }

// The quarter bells' strike notes (Hz) in E-flat, the Westminster tune's four bells high to low (G, F, E-flat, B-flat),
// and the bourdon's an octave under the E-flat
const QUARTER_NOTES = [392.0, 349.23, 311.13, 233.08];
const BOURDON = 155.56;
// Westminster's five changes (bells by index above), each three crotchets and a minim
const CHANGES = [[0, 1, 2, 3], [2, 0, 1, 3], [2, 1, 0, 2], [0, 2, 1, 3], [3, 1, 0, 2]];
// the changes played at each quarter: :15, :30, :45 and the hour (index by quarter, 0 the hour)
const QUARTERS = [[1, 2, 3, 4], [0], [1, 2], [3, 4, 0]];
const BEAT = 0.72, CHANGE = 5 * BEAT, STROKE = 2.9;

function randomSource(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// A struck carillon bell: its inharmonic partials over the strike note `f` ([ratio, level, decay s]): the hum an octave
// under, the prime, the minor-third tierce that gives a bell its plaintive sound, the quint, the nominal an octave over,
// and the brighter upper partials that die first. The hum and prime are split doublets a fraction of a hertz apart, so
// they beat slowly as a big bell's do. A short clapper's knock starts it. Faded out over its last `tail` seconds.
function bellBuffer(ctx, f, duration, partials, seed, tail) {
  const random = randomSource(seed);
  const modes = [];
  for (const [ratio, level, decay, split] of partials) {
    modes.push({ w: TAU * f * ratio, g: level, k: Math.exp(-1 / (RATE * decay)), p: random() * TAU });
    if (split) modes.push({ w: TAU * (f * ratio + split), g: level * 0.35, k: Math.exp(-1 / (RATE * decay * 0.9)), p: random() * TAU });
  }
  const buffer = ctx.createBuffer(1, Math.ceil(duration * RATE), RATE);
  const out = buffer.getChannelData(0);
  let knock = 0, peak = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    let v = 0;
    for (const m of modes) { v += Math.sin(m.w * t + m.p) * m.g; m.g *= m.k; }
    // the clapper: a dull thump of filtered noise in the first few hundredths of a second
    knock += (random() * 2 - 1 - knock) * 0.18;
    v = v * (1 - Math.exp(-t * 2500)) + knock * Math.exp(-t / 0.012) * 0.5;
    const left = duration - t;
    if (left < tail) { const x = left / tail; v *= x * x * (3 - 2 * x); }
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const scale = peak > 0 ? 0.6 / peak : 0;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return buffer;
}

// One quarter bell (made at the top note and played slower for the lower three, which then ring longer, as heavier
// bells do) and the bourdon, which hums longest. About 1.5 MB in all, made on the first chime.
const made = new WeakMap();
function bellBuffers(ctx) {
  let b = made.get(ctx);
  if (!b) {
    b = {
      quarter: bellBuffer(ctx, QUARTER_NOTES[0], 5.5, [
        [0.5, 0.45, 5.5, 0.3], [1, 0.55, 3.4, 0.4], [1.19, 0.5, 2.6], [1.5, 0.2, 1.7], [2, 0.7, 1.9],
        [2.51, 0.22, 1.0], [2.66, 0.15, 0.85], [3.01, 0.12, 0.65], [4.07, 0.09, 0.4], [5.33, 0.05, 0.22], [6.7, 0.035, 0.13]
      ], 53, 1.6),
      bourdon: bellBuffer(ctx, BOURDON, 13, [
        [0.5, 0.6, 11, 0.12], [1, 0.6, 7, 0.18], [1.19, 0.5, 5.5], [1.5, 0.18, 3.5], [2, 0.65, 4],
        [2.51, 0.2, 2.2], [2.66, 0.14, 1.8], [3.01, 0.12, 1.3], [4.07, 0.08, 0.8], [5.33, 0.04, 0.45], [6.7, 0.03, 0.25]
      ], 1936, 3.5)
    };
    made.set(ctx, b);
  }
  return b;
}

// The Westminster changes for `quarter` (0 the hour), then `strikes` strokes of the bourdon; returns an event voice
// ({ endTime, dispose }) for the audio system's pool
function playBells(ctx, output, { quarter = 1, strikes = 0, seed = 1 } = {}) {
  const buffers = bellBuffers(ctx);
  const random = randomSource(seed + 7);
  const gain = ctx.createGain();
  gain.gain.value = 0.55;
  gain.connect(output);
  const sources = new Map();
  let disposed = false;
  const start = ctx.currentTime + 0.05;
  const event = {
    endTime: start,
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      const fade = !immediate && ctx.state === 'running' ? 0.08 : 0;
      event.endTime = Math.min(event.endTime, now + fade);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.015);
      for (const source of sources.keys()) { try { source.stop(now + fade); } catch { /* not started */ } }
      if (!fade) { for (const [s, e] of sources) { s.onended = null; s.disconnect(); e.disconnect(); } sources.clear(); gain.disconnect(); }
    }
  };
  const strike = (buffer, when, rate, volume) => {
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    envelope.gain.value = volume;
    source.connect(envelope).connect(gain);
    sources.set(source, envelope);
    source.onended = () => {
      source.disconnect(); envelope.disconnect(); sources.delete(source);
      if (!sources.size) { disposed = true; gain.disconnect(); }
    };
    source.start(when);
    event.endTime = Math.max(event.endTime, when + buffer.duration / rate);
  };
  let at = start;
  for (const c of QUARTERS[quarter] || []) {
    CHANGES[c].forEach((bell, k) => {
      // an automatic player keeps steady time; only a breath of unevenness in the stroke
      strike(buffers.quarter, at + k * BEAT + random() * 0.02, QUARTER_NOTES[bell] / QUARTER_NOTES[0], 0.72 + random() * 0.06);
    });
    at += CHANGE;
  }
  if (strikes) at += BEAT * 2;
  for (let k = 0; k < strikes; k++) strike(buffers.bourdon, at + k * STROKE, 1, 1);
  return event;
}

// Rings the quarter hours as the shown time crosses them. Called from the audio system's update (10 times a second,
// only while sound is on and playing); a jump past a quarter (a hidden tab, the clock going back) rings nothing.
class BurtonBells {
  constructor() { this.last = null; this.warm = null; }

  update(audio) {
    // the buffers made in an idle moment once there is sound, so the first chime costs no frame
    if (!this.warm && audio.context) {
      this.warm = audio.context;
      const idle = globalThis.requestIdleCallback ? (f) => requestIdleCallback(f, { timeout: 5000 }) : (f) => setTimeout(f, 200);
      idle(() => bellBuffers(this.warm));
    }
    const at = BELL_TOWER.at;
    const t = gameTime();
    if (!at || !t.live) { this.last = null; return; }
    const q = Math.floor(t.sec / 900);
    if (this.last === null || q === this.last) { this.last = q; return; }
    this.last = q;
    if (t.sec - q * 900 > 20) return;
    const minute = q * 15;
    if (minute < 9 * 60 + 15 || minute > 21 * 60) return;
    const quarter = q % 4, hour = Math.floor(q / 4);
    this.ring(audio, quarter, quarter === 0 ? ((hour + 11) % 12) + 1 : 0, q);
  }

  ring(audio, quarter, strikes, seed = 1) {
    const at = BELL_TOWER.at;
    if (!at) return false;
    const played = audio.emit('bells', { id: 'burton', x: at.x, y: at.y, z: at.z, seed }, { quarter, strikes, seed, priority: true });
    const what = quarter === 0 ? `the hour, ${strikes} strokes` : `${['', 'first', 'half', 'third'][quarter]} quarter`;
    log(`[bells] Burton Tower: Westminster quarters, ${what}${played ? '' : ' (out of earshot)'}`);
    return played;
  }
}

export { BELL_REACH, BELL_TOWER, setBellTower, playBells, BurtonBells, QUARTERS, CHANGES };
