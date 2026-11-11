// Lamp: the sound of outdoors, kept apart from the city's own voices (audio-system.js) and fed into its mix: rain
// hissing on the street, pattering on the car's roof and dripping under trees, a hiss on the water; thunder after the
// lightning, late by the strike's distance at 343 m/s; the Huron murmuring along its banks and rushing over the Argo
// Cascades' weirs and the Argo and Barton dams' spillways, louder with the USGS flow; the wind in the leaves with
// KARB's wind; and the insects of the season: spring peepers, the dog-day cicadas of hot summer afternoons, crickets and
// katydids on late-summer nights. Every sound is made here in code. outdoors.js says what's around the listener.
//
// It plays only while the city's sound does (on, unlocked, the page shown), through the city's mix, so muting, a
// hidden page and a teleport's fade all reach it. Few voices: one looping bed of each kind, made when first needed
// and kept; at most two thunderclaps at once (one on the Xbox, a phone or a slower computer, which also keep one
// insect chorus at a time and plain stereo panning)

import { TIER, XBOX } from './device-tier.js';
import { setControlRate } from './audio-synthesis.js';
import { log } from '../lamp-game.js';

const SMALL = XBOX || TIER.name === 'phone' || TIER.name === 'slow';
const PANNING = SMALL ? 'equalpower' : 'HRTF';
const RATE = 22050; // the beds' own buffers: nothing in them is above 10 kHz
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

function random(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// A looping buffer, its level evened out (rms) and its ends joined
function loopBuffer(ctx, seconds, fill, rms = 0.2) {
  const buffer = ctx.createBuffer(1, Math.round(seconds * RATE), RATE);
  const d = buffer.getChannelData(0);
  fill(d, RATE);
  let mean = 0;
  for (let i = 0; i < d.length; i++) mean += d[i];
  mean /= d.length;
  let e = 0;
  for (let i = 0; i < d.length; i++) { d[i] -= mean; e += d[i] * d[i]; }
  const k = e > 0 ? rms / Math.sqrt(e / d.length) : 0;
  for (let i = 0; i < d.length; i++) d[i] = Math.max(-0.98, Math.min(0.98, d[i] * k));
  return buffer;
}

// Each call of `one(d, start, n)` lays one sound into d at a sample, wrapping round the loop's end
function lay(d, start, n, at) {
  for (let j = 0; j < n; j++) d[(start + j) % d.length] += at(j);
}

const SYNTH = {
  // rain drops on a hard surface: a little ping of a few kHz each, many a second, some big
  patter(ctx) {
    return loopBuffer(ctx, 4, (d, r) => {
      const rnd = random(71);
      const count = 4 * 140;
      for (let i = 0; i < count; i++) {
        const start = Math.floor(rnd() * d.length), f = 1400 + rnd() * 3600, decay = 260 + rnd() * 700;
        const a = rnd() ** 2.2 * (rnd() < 0.08 ? 2.5 : 1), n = Math.floor(r * 0.03);
        lay(d, start, n, (j) => { const t = j / r; return a * Math.exp(-t * decay) * (Math.sin(TAU * f * t) + (rnd() * 2 - 1) * 0.4 * Math.exp(-t * 2000)); });
      }
    }, 0.18);
  },
  // dog-day cicadas: a few insects each buzzing a whine around 5 kHz, pulsed fast, swelling up and dying away
  cicada(ctx) {
    return loopBuffer(ctx, 12, (d, r) => {
      const rnd = random(5);
      for (let k = 0; k < 6; k++) {
        const f = 4300 + rnd() * 1600, pulse = 90 + rnd() * 60, start = Math.floor(rnd() * d.length);
        const len = Math.floor((5 + rnd() * 5) * r), rise = 1.6 + rnd(), fall = 1.4 + rnd();
        let phase = 0, jitter = 0;
        lay(d, start, len, (j) => {
          const t = j / r, end = len / r;
          const env = Math.min(1, t / rise) ** 2 * Math.min(1, (end - t) / fall) * (0.8 + 0.2 * Math.sin(TAU * 0.7 * t));
          jitter += ((rnd() * 2 - 1) - jitter) * 0.05;
          phase += TAU * (f + jitter * 300) / r;
          const am = Math.abs(Math.sin(Math.PI * pulse * t)) ** 3;
          return Math.sin(phase) * am * env * (0.6 + rnd() * 0.4);
        });
      }
    }, 0.16);
  },
  // field crickets: chirps of three or four quick pulses near 4.5 kHz, each insect at its own pitch and pace
  cricket(ctx) {
    return loopBuffer(ctx, 6, (d, r) => {
      const rnd = random(9);
      for (let k = 0; k < 9; k++) {
        const f = 3900 + rnd() * 1100, per = 6 / (9 + Math.floor(rnd() * 8)), offset = rnd() * per, pulses = 3 + (rnd() < 0.4 ? 1 : 0);
        const a = 0.35 + rnd() * 0.65;
        for (let t0 = offset; t0 < 6; t0 += per) {
          for (let p = 0; p < pulses; p++) {
            const start = Math.floor((t0 + p * 0.032) * r), n = Math.floor(0.02 * r);
            lay(d, start, n, (j) => { const t = j / r; return a * Math.sin(TAU * f * t) * Math.sin(Math.PI * t / 0.02); });
          }
        }
      }
    }, 0.14);
  },
  // true katydids: the rasping ka-ty-did, two or three bursts of fast clicks a little apart, from the treetops
  katydid(ctx) {
    return loopBuffer(ctx, 6, (d, r) => {
      const rnd = random(13);
      for (let k = 0; k < 6; k++) {
        const per = 6 / (5 + Math.floor(rnd() * 3)), offset = rnd() * per, centre = 3200 + rnd() * 1800, a = 0.4 + rnd() * 0.6;
        for (let t0 = offset; t0 < 6; t0 += per) {
          const bursts = rnd() < 0.5 ? 3 : 2;
          for (let b = 0; b < bursts; b++) {
            const s = t0 + b * 0.14;
            for (let c = 0; c < 9; c++) {
              const start = Math.floor((s + c * 0.0065) * r), n = Math.floor(0.004 * r);
              lay(d, start, n, (j) => { const t = j / r; return a * Math.exp(-t * 900) * Math.sin(TAU * (centre + rnd() * 800) * t); });
            }
          }
        }
      }
    }, 0.14);
  },
  // spring peepers: a chorus of little frogs, each a short whistle rising from about 2.8 to 3.2 kHz once a second
  peeper(ctx) {
    return loopBuffer(ctx, 6, (d, r) => {
      const rnd = random(17);
      for (let k = 0; k < 14; k++) {
        const per = 6 / (5 + Math.floor(rnd() * 3)), offset = rnd() * per, f0 = 2650 + rnd() * 300, a = 0.25 + rnd() ** 2 * 0.75;
        for (let t0 = offset; t0 < 6; t0 += per) {
          const n = Math.floor(0.13 * r), start = Math.floor(t0 * r);
          let phase = 0;
          lay(d, start, n, (j) => {
            const t = j / r, u = t / 0.13;
            phase += TAU * (f0 + 420 * u) / r;
            return a * Math.sin(phase) * Math.sin(Math.PI * u) ** 1.5;
          });
        }
      }
    }, 0.15);
  },
  // thunder: near, a ripping crack then the long rumble; far, only the rumble, rolling in swells as the sound comes in
  // from the whole length of the bolt
  thunderNear: (ctx) => thunder(ctx, 3, true),
  thunderFar: (ctx) => thunder(ctx, 11, false),
  thunderFar2: (ctx) => thunder(ctx, 23, false)
};

function thunder(ctx, seed, near) {
  const seconds = near ? 8 : 9;
  const buffer = ctx.createBuffer(1, Math.round(seconds * RATE), RATE);
  const d = buffer.getChannelData(0), r = RATE, rnd = random(seed);
  // swells: when each part of the bolt is heard, louder the nearer it is
  const swells = [];
  for (let i = 0; i < 9; i++) swells.push({ t: (near ? 0.25 : 0.2) + rnd() ** 1.4 * (seconds - 2.5), a: 0.3 + rnd() * 0.7, w: 0.25 + rnd() * 0.8 });
  let lo = 0, lo2 = 0, hi = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / r, n = rnd() * 2 - 1;
    let env = 0;
    for (const s of swells) { const x = (t - s.t) / s.w; env += s.a * (x < 0 ? Math.exp(-x * x * 6) : Math.exp(-x * 1.3)); }
    env *= Math.min(1, t / 0.08) * Math.min(1, (seconds - t) / 1.5);
    // the rumble: noise filtered down to below 200 Hz, with a little more body
    const c = 0.018 + 0.012 * Math.sin(t * 1.7 + seed);
    lo += (n - lo) * c; lo2 += (lo - lo2) * c;
    let v = lo2 * 9 * env;
    if (near) {
      // the crack: a sharp, bright tear in the first fraction of a second, crackling as it fades
      hi += (n - hi) * 0.5;
      const crack = Math.exp(-Math.max(0, t - 0.02) * 9) * Math.min(1, t / 0.004);
      const crackle = rnd() < 0.004 * Math.exp(-t * 3) ? (rnd() * 2 - 1) * 3 : 0;
      v += (hi * 1.4 + crackle) * crack + lo * 3 * Math.exp(-t * 2.5);
    }
    d[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= 0.9 / (peak || 1);
  return buffer;
}

class OutdoorsAudio {
  constructor(audioSystem) {
    this.audio = audioSystem;
    this.buffers = {};
    this.wanted = new Set();
    this.making = false;
    this.voices = {};
    this.thunders = [];
    this.accumulator = 0;
    this.context = null;
    this.said = '';
  }

  get playing() {
    const a = this.audio;
    return !!(a.ready && a.enabled && a.context && a.context.state === 'running' && !document.hidden && a.mix);
  }

  // The buffers are made one at a time between frames, as they're first wanted
  want(name) {
    if (this.buffers[name] || !this.context) return null;
    this.wanted.add(name);
    if (!this.making) {
      this.making = true;
      const next = () => {
        const [n] = this.wanted;
        if (!n || !this.context) { this.making = false; return; }
        this.wanted.delete(n);
        try { this.buffers[n] = SYNTH[n](this.context); } catch (error) { console.warn('[outdoors] sound', n, error); }
        setTimeout(next, 30);
      };
      setTimeout(next, 0);
    }
    return null;
  }

  buffer(name) { return this.buffers[name] || this.want(name); }

  // A looping bed: a buffer (or the city's noise) through the given filters into a gain, then a panner if it has a place
  bed(name, source, filters, { place = false, ref = 10, rate = 1, stereo = false } = {}) {
    let v = this.voices[name];
    if (v) return v;
    const ctx = this.context, now = ctx.currentTime;
    const buf = source === 'noise' ? this.audio.resources.noise : this.buffer(source);
    if (!buf) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const nodes = [gain], sources = [];
    let out = gain;
    if (place) {
      const panner = ctx.createPanner();
      setControlRate(panner.positionX, panner.positionY, panner.positionZ);
      panner.panningModel = PANNING; panner.distanceModel = 'inverse';
      panner.refDistance = ref; panner.rolloffFactor = 1; panner.maxDistance = 2000;
      gain.connect(panner);
      nodes.push(panner);
      out = panner;
      v = { panner };
    } else v = {};
    out.connect(this.audio.mix);
    // two of it, a little apart in time and either side, for a wide bed (one on a small device)
    const n = stereo && !SMALL ? 2 : 1;
    v.filters = [];
    for (let i = 0; i < n; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.playbackRate.value = rate * (i ? 0.97 : 1);
      let chain = src;
      const fs = filters.map(([type, f, q]) => {
        const b = ctx.createBiquadFilter();
        setControlRate(b.frequency, b.detune, b.Q, b.gain);
        b.type = type; b.frequency.value = f; b.Q.value = q ?? 0.7;
        chain.connect(b); chain = b; nodes.push(b);
        return b;
      });
      v.filters.push(fs);
      if (n > 1) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = i ? 0.65 : -0.65;
        chain.connect(pan); chain = pan; nodes.push(pan);
      }
      chain.connect(gain);
      src.start(now, (i * 0.41 + name.length * 0.13) * buf.duration % buf.duration);
      sources.push(src); nodes.push(src);
    }
    Object.assign(v, { gain, sources, nodes, level: 0 });
    this.voices[name] = v;
    return v;
  }

  level(v, value, now, time = 0.6) {
    if (!v || Math.abs(value - v.level) < 0.0004) return;
    v.level = value;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(value, now, time);
  }

  // A bed asked for (level > 0) is made; one not playing stays silent
  setBed(name, value, now, make) {
    let v = this.voices[name];
    if (!v && value > 0.0005) v = make();
    this.level(v, value, now);
    return v;
  }

  // Thunder `distance` m away toward (dx, dz) from the listener, `power` 0 to 1; heard after distance / 343 s
  thunder(distance, dx, dz, power = 1) {
    if (!this.playing || !this.context) return 'sound off';
    const ctx = this.context, now = ctx.currentTime;
    const near = distance < 1600;
    const name = near ? 'thunderNear' : Math.random() < 0.5 ? 'thunderFar' : 'thunderFar2';
    const buf = this.buffer(name) || this.buffer('thunderFar') || this.buffer('thunderNear');
    if (!buf) return 'its sound not made yet';
    for (let i = this.thunders.length - 1; i >= 0; i--) if (now > this.thunders[i].end) this.thunders.splice(i, 1);
    if (this.thunders.length >= (SMALL ? 1 : 2)) return 'still rumbling from the last';
    const when = now + distance / 343;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (near ? 1 : 0.8) * (0.9 + Math.random() * 0.2);
    // the air takes the highs out of a far clap, and the ground and the town's walls muffle it
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass'; low.Q.value = 0.5;
    low.frequency.value = 160 + 7000 * Math.exp(-distance / 1300);
    const gain = ctx.createGain();
    gain.gain.value = clamp(power) * 1.1 / (1 + distance / 1400);
    const panner = ctx.createPanner();
    panner.panningModel = PANNING; panner.distanceModel = 'inverse'; panner.refDistance = 1e5;
    const l = this.audio.listener, m = Math.hypot(dx, dz) || 1;
    panner.positionX.value = l.x + dx / m * 60; panner.positionY.value = l.y + 25; panner.positionZ.value = l.z + dz / m * 60;
    src.connect(low).connect(gain).connect(panner).connect(this.audio.mix);
    src.start(when);
    const end = when + buf.duration / src.playbackRate.value;
    src.onended = () => { for (const node of [src, low, gain, panner]) node.disconnect(); };
    this.thunders.push({ end });
    return '';
  }

  // Ten times a second, with what's around the listener (outdoors.js): s = { rain, storm, thunder, inCar, canopy, water: {x, z,
  // distance, speed} | null, falls: {x, z, y, loud} | null, wind (m/s), insects: {peeper, cicada, cricket, katydid},
  // chirpRate, snow, altitude }
  update(dt, s) {
    if (!this.playing) return;
    this.accumulator += dt;
    if (this.accumulator < 0.1) return;
    this.accumulator = 0;
    const a = this.audio;
    if (this.context !== a.context) { this.context = a.context; this.voices = {}; this.buffers = {}; this.thunders = []; }
    const ctx = this.context, now = ctx.currentTime;
    // a storm about: its thunder made ahead, so the first clap isn't missed
    if (s.thunder) for (const n of ['thunderNear', 'thunderFar', 'thunderFar2']) this.buffer(n);
    const open = 1 - clamp(a.acoustics?.enclosure) * 0.4;
    const inCar = s.inCar ? 1 : 0;
    const high = 1 - clamp((s.altitude - 25) / 120);

    // rain: the hiss of it on everything, muffled inside the car, where the roof's patter is loud instead; under the
    // trees the leaves' drip; a brighter hiss over open water
    const rain = clamp(s.rain);
    const hiss = this.setBed('rainHiss', rain * (0.05 + 0.05 * s.storm) * (1 - inCar * 0.55) * high, now,
      () => this.bed('rainHiss', 'noise', [['highpass', 420, 0.5], ['lowpass', 6500, 0.4]], { stereo: true }));
    if (hiss) for (const fs of hiss.filters) fs[1].frequency.setTargetAtTime(inCar ? 1300 : 6500, now, 0.2);
    const patter = rain * (inCar ? 0.32 : 0.05 + 0.12 * clamp(s.canopy)) * high;
    const pv = this.setBed('rainPatter', patter, now,
      () => this.bed('rainPatter', 'patter', [['bandpass', 2600, 0.5]], { stereo: true }));
    if (pv) for (const src of pv.sources) src.playbackRate.setTargetAtTime(inCar ? 0.62 : 1, now, 0.2);
    const onWater = s.water ? clamp(1 - s.water.distance / 40) : 0;
    this.setBed('rainWater', rain * onWater * 0.05 * (1 - inCar * 0.7), now,
      () => this.bed('rainWater', 'noise', [['highpass', 2600, 0.6], ['lowpass', 9000, 0.4]], { stereo: true, rate: 0.8 }));

    // the river along its banks: a murmur from the nearest open water, more of it the faster it runs
    const w = s.water;
    const rv = this.setBed('river', w ? clamp(1 - w.distance / 160) ** 1.5 * (0.025 + 0.03 * clamp(w.speed / 2)) * open : 0, now,
      () => this.bed('river', 'noise', [['bandpass', 520, 0.6], ['lowpass', 1700, 0.5]], { place: true, ref: 12, rate: 0.7 }));
    if (rv && w) {
      rv.panner.positionX.setTargetAtTime(w.x, now, 0.4); rv.panner.positionY.setTargetAtTime(w.y, now, 0.4); rv.panner.positionZ.setTargetAtTime(w.z, now, 0.4);
    }
    // the cascades' weirs and the dams' spillways: a rushing burble where the water drops, with the flow
    const f = s.falls;
    const fv = this.setBed('falls', f ? f.loud * 0.11 : 0, now,
      () => this.bed('falls', 'noise', [['lowpass', 2400, 0.4], ['peaking', 380, 0.8]], { place: true, ref: f?.ref || 10, rate: 0.85, stereo: true }));
    if (fv && f) {
      fv.panner.positionX.setTargetAtTime(f.x, now, 0.3); fv.panner.positionY.setTargetAtTime(f.y, now, 0.3); fv.panner.positionZ.setTargetAtTime(f.z, now, 0.3);
      fv.panner.refDistance = f.ref;
      for (const fs of fv.filters) fs[1].gain.value = 5;
    }

    // the wind in the leaves, once it's blowing more than a breeze: a rustle swelling with the gusts
    const wind = clamp((s.wind - 3.5) / 9);
    const lv = this.setBed('leaves', wind * (0.25 + 0.75 * clamp(s.canopy)) * 0.045 * (1 - inCar * 0.7) * (s.leafy ?? 1), now,
      () => this.bed('leaves', 'noise', [['highpass', 700, 0.5], ['lowpass', 3800, 0.5]], { stereo: true, rate: 0.6 }));
    if (lv && !lv.gust) {
      // the city's slow gust signal moving the rustle's level (audio-events.js gustBuffer)
      const g = ctx.createBufferSource(); g.buffer = a.resources.gusts; g.loop = true; g.playbackRate.value = 2.2;
      const depth = ctx.createGain(); depth.gain.value = 0.8;
      const mod = ctx.createGain(); mod.gain.value = 0.2;
      lv.gain.disconnect(); lv.gain.connect(mod).connect(a.mix);
      g.connect(depth).connect(mod.gain);
      g.start(now);
      lv.gust = g; lv.nodes.push(g, depth, mod);
    }

    // the insects of the season and hour, quiet in a car, high up or among the walls of downtown
    const ins = s.insects || {};
    let kinds = ['peeper', 'cicada', 'cricket', 'katydid'];
    if (SMALL) {
      const loudest = kinds.reduce((b, k) => ((ins[k] || 0) > (ins[b] || 0) ? k : b), 'peeper');
      kinds = kinds.map((k) => (k === loudest ? k : null));
    }
    const quiet = (1 - inCar * 0.75) * high * open;
    const LOUD = { peeper: 0.09, cicada: 0.05, cricket: 0.06, katydid: 0.045 };
    const BAND = { peeper: 3000, cicada: 5000, cricket: 4400, katydid: 4200 };
    for (const k of ['peeper', 'cicada', 'cricket', 'katydid']) {
      const on = kinds.includes(k) ? clamp(ins[k]) : 0;
      const v = this.setBed(k, on * LOUD[k] * quiet, now,
        () => this.bed(k, k, [['bandpass', BAND[k], 0.6]], { stereo: true }));
      // crickets chirp faster the warmer it is (the pitch goes a little with it)
      if (v && k === 'cricket') for (const src of v.sources) src.playbackRate.setTargetAtTime(s.chirpRate || 1, now, 1);
    }

    // snow on the ground hushes the town: the traffic's rumble under it (audio-system.js reads this)
    a.muffle = 1 - clamp(s.snow) * 0.45;

    const said = ['rain', 'water', 'falls', 'leaves', ...['peeper', 'cicada', 'cricket', 'katydid']]
      .map((k) => {
        const v = k === 'rain' ? this.voices.rainHiss : k === 'water' ? this.voices.river : this.voices[k];
        return v && v.level > 0.001 ? `${k} ${(v.level * 100).toFixed(1)}` : null;
      }).filter(Boolean).join(', ');
    if (said !== this.said && (!this.saidAt || now - this.saidAt > 5)) {
      this.said = said; this.saidAt = now;
      log(`[outdoors] sound: ${said || 'quiet'}${inCar ? ' (in the car)' : ''}`);
    }
  }
}

export { OutdoorsAudio };
