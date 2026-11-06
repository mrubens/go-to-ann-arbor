import { setControlRate } from './audio-synthesis.js';

const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const smoothstep = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };

function randomSource(seed) {
  let state = (finite(seed, 1) * 2654435761) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeBuffer(ctx, duration, synthesize, peak = 0.6, rate = ctx.sampleRate) {
  const buffer = ctx.createBuffer(1, Math.ceil(duration * rate), rate);
  const samples = buffer.getChannelData(0);
  let maximum = 0, mean = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = synthesize(i / rate, i);
    mean += samples[i];
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) {
    // A short endpoint fade removes clicks even when a pitched component ends between zero crossings.
    const fade = Math.min(1, i / (rate * 0.002), (samples.length - 1 - i) / (rate * 0.012));
    samples[i] = (samples[i] - mean) * fade;
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  const scale = maximum > 0 ? peak / maximum : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return buffer;
}

function footstep(ctx, seed) {
  const random = randomSource(seed);
  const soleTime = 0.024 + random() * 0.035;
  const scuffTime = soleTime + 0.025 + random() * 0.025;
  const contacts = Array.from({ length: 5 }, () => ({
    time: random() * 0.10, decay: 170 + random() * 300, level: 0.025 + random() * 0.075
  }));
  const coefficients = [180, 1050, 4600].map((frequency) => 1 - Math.exp(-TAU * frequency / ctx.sampleRate));
  const bands = [0, 0, 0];
  return makeBuffer(ctx, 0.23, (t) => {
    const noise = random() * 2 - 1;
    for (let i = 0; i < bands.length; i++) bands[i] += (noise - bands[i]) * coefficients[i];
    const body = bands[1] - bands[0], grit = bands[2] - bands[1];
    const heel = (1 - Math.exp(-t * 1900)) * Math.exp(-t * 105);
    const sole = Math.max(0, t - soleTime);
    const roll = (1 - Math.exp(-sole * 1100)) * Math.exp(-sole * 58);
    const scuff = Math.max(0, t - scuffTime);
    const drag = (1 - Math.exp(-scuff * 130)) * Math.exp(-scuff * 38);
    let fragments = 0;
    for (const contact of contacts) {
      if (t > contact.time) fragments += Math.exp(-(t - contact.time) * contact.decay) * contact.level;
    }
    // Short, differently coloured heel and sole contacts, followed by irregular concrete grit. No pitched kick.
    return (bands[0] * 0.25 + body * 0.9 + grit * 0.55) * heel
      + (bands[0] * 0.3 + body * 0.65 + grit * 0.15) * roll
      + (grit * 0.22 + (noise - bands[2]) * 0.035) * drag + grit * fragments;
  }, 0.55);
}

function speechFragment(ctx, speaker, seed) {
  const random = randomSource(seed);
  const vowels = [[600, 1170, 2380], [470, 1740, 2460], [340, 2010, 2650], [470, 890, 2300], [420, 1450, 2350]];
  const duration = 0.57 + random() * 0.28;
  const count = 2 + Math.floor(random() * 3);
  const segments = Array.from({ length: count }, () => ({
    vowel: vowels[Math.floor(random() * vowels.length)], weight: 0.65 + random() * 0.7,
    consonant: Math.floor(random() * 5), transition: 0.028 + random() * 0.038,
    stress: 0.62 + random() * 0.38, pitch: 0.96 + random() * 0.1
  }));
  const weight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  let cursor = 0;
  for (const segment of segments) {
    segment.start = cursor;
    segment.duration = duration * segment.weight / weight;
    cursor += segment.duration;
  }
  const resonators = [95, 135, 190].map((bandwidth, i) => {
    const radius = Math.exp(-Math.PI * bandwidth / ctx.sampleRate);
    return {
      radius, a: 0, b: radius * radius, gain: (1 - radius) * [1, 0.8, 0.36][i],
      frequency: segments[0].vowel[i] * speaker.formants, y1: 0, y2: 0
    };
  });
  const pitchFall = 0.08 + random() * 0.10;
  const open = 0.52 + speaker.breath * 0.5, closing = 0.19;
  const breathCoefficient = 1 - Math.exp(-TAU * 1600 / ctx.sampleRate);
  const outputCoefficient = 1 - Math.exp(-TAU * 2900 / ctx.sampleRate);
  const formantSmoothing = 1 - Math.exp(-32 / (ctx.sampleRate * 0.022));
  const prosodySmoothing = 1 - Math.exp(-1 / (ctx.sampleRate * 0.025));
  const nasal = [250, 1180, 2250];
  let phase = random(), lastFlow = 0, breath = 0, low = 0, output = 0;
  let segmentIndex = 0, jitter = 1, shimmer = 1, pitch = speaker.pitch, stress = segments[0].stress;
  return makeBuffer(ctx, duration, (t, sample) => {
    while (segmentIndex + 1 < count && t >= segments[segmentIndex + 1].start) segmentIndex++;
    const segment = segments[segmentIndex], previous = segments[Math.max(0, segmentIndex - 1)];
    const local = t - segment.start;
    const articulation = smoothstep(local / segment.transition);
    const voiced = segment.consonant === 0 ? 0.35 + articulation * 0.65
      : segment.consonant === 1 ? 0.7 + articulation * 0.3 : articulation;
    if (sample % 32 === 0) {
      for (let i = 0; i < resonators.length; i++) {
        const r = resonators[i];
        const from = segment.consonant === 0 ? nasal[i] : previous.vowel[i];
        const target = (from + (segment.vowel[i] - from) * articulation) * speaker.formants;
        r.frequency += (target - r.frequency) * formantSmoothing;
        r.a = 2 * r.radius * Math.cos(TAU * r.frequency / ctx.sampleRate);
      }
    }
    const noise = random() * 2 - 1;
    breath += (noise - breath) * breathCoefficient;
    low += (noise - low) * 0.025;
    pitch += (speaker.pitch * segment.pitch * (1.06 - pitchFall * t / duration) - pitch) * prosodySmoothing;
    stress += (segment.stress - stress) * prosodySmoothing;
    const fundamental = pitch * jitter * (1 + 0.014 * Math.sin(t * 21) + 0.008 * Math.sin(t * 37));
    phase += fundamental / ctx.sampleRate;
    if (phase >= 1) {
      phase -= 1;
      jitter = 0.991 + random() * 0.018;
      shimmer = 0.94 + random() * 0.12;
    }
    // Asymmetric glottal flow, breath and small cycle variations avoid a steady oscillator-like vowel.
    const flow = phase < open ? 0.5 - 0.5 * Math.cos(Math.PI * phase / open)
      : phase < open + closing ? Math.cos(Math.PI * 0.5 * (phase - open) / closing) : 0;
    const pulse = (flow - lastFlow) * ctx.sampleRate / (speaker.pitch * 8);
    lastFlow = flow;
    const excitation = pulse * shimmer * voiced + breath * speaker.breath * voiced;
    let vowel = 0;
    for (const r of resonators) {
      const y = excitation + r.a * r.y1 - r.b * r.y2;
      r.y2 = r.y1;
      r.y1 = y;
      vowel += y * r.gain;
    }
    const fricative = segment.consonant === 2 ? (breath - low) * 0.10 * (1 - articulation)
      : segment.consonant === 3 ? (noise - breath) * 0.10 * Math.exp(-Math.max(0, local - 0.012) * 180)
      : segment.consonant === 4 ? breath * 0.055 * (1 - articulation) : 0;
    const envelope = smoothstep(t / 0.025) * smoothstep((duration - t) / 0.085);
    output += ((vowel * stress + fricative) * envelope - output) * outputCoefficient;
    return output;
  }, 0.5);
}

function horn(ctx, duration, seed) {
  const random = randomSource(seed);
  const frequencies = [365 + random() * 45, 465 + random() * 55];
  const phases = [random(), random()];
  const delay = 0.006 + random() * 0.009;
  const harmonics = [0.52, 1, 0.65, 0.37, 0.24, 0.14, 0.085];
  let flutter = 0, air = 0;
  return makeBuffer(ctx, duration, (t) => {
    const noise = random() * 2 - 1;
    flutter += (noise - flutter) * 0.008;
    air += (noise - air) * 0.24;
    let tone = 0;
    for (let reed = 0; reed < 2; reed++) {
      const local = Math.max(0, t - reed * delay);
      const attack = 1 - Math.exp(-local * (reed ? 160 : 230));
      const settling = 1 - 0.065 * Math.exp(-local * 65);
      phases[reed] += frequencies[reed] * (settling + flutter * 0.045 + Math.sin(local * 71 + reed) * 0.0025) / ctx.sampleRate;
      let buzz = 0;
      for (let i = 0; i < harmonics.length; i++) buzz += Math.sin(TAU * phases[reed] * (i + 1)) * harmonics[i];
      tone += buzz * attack * (reed ? 0.83 : 1);
    }
    const release = smoothstep((duration - t) / 0.045);
    const chatter = (noise - air) * Math.exp(-t * 55) * 0.6;
    return (tone * (0.95 + flutter * 0.6) + air * 0.17 + chatter) * release;
  }, 0.7);
}

// A diesel's air horn: a five-chime chord, two long blasts, a short one and a long one (the grade-crossing call)
function trainHorn(ctx) {
  const random = randomSource(911);
  const chord = [311.1, 370.0, 440.0, 554.4, 740.0];
  const phases = chord.map(() => random());
  const blasts = [[0, 1.1], [1.3, 2.4], [2.6, 2.95], [3.15, 4.4]];
  const duration = 4.6;
  let flutter = 0;
  return makeBuffer(ctx, duration, (t) => {
    let on = 0;
    for (const [a, b] of blasts) on = Math.max(on, smoothstep((t - a) / 0.06) * smoothstep((b - t) / 0.12));
    const noise = random() * 2 - 1;
    flutter += (noise - flutter) * 0.004;
    let tone = 0;
    for (let i = 0; i < chord.length; i++) {
      phases[i] += chord[i] * (1 + flutter * 0.01) / ctx.sampleRate;
      const p = phases[i] % 1;
      // a reedy, brassy wave: a sawtooth softened toward a sine
      tone += ((2 * p - 1) * 0.55 + Math.sin(TAU * p) * 0.45) * (i === 0 ? 1 : 0.8);
    }
    return (tone + noise * 0.05) * on;
  }, 0.7);
}

function crashBody(ctx, seed) {
  const random = randomSource(seed);
  const coefficients = [35, 200 + random() * 60, 800].map((frequency) => 1 - Math.exp(-TAU * frequency / ctx.sampleRate));
  const bands = [0, 0, 0];
  const rebound = 0.022 + random() * 0.028;
  const decay = 0.055 + random() * 0.020;
  return makeBuffer(ctx, 0.42, (t) => {
    const noise = random() * 2 - 1;
    for (let i = 0; i < bands.length; i++) bands[i] += (noise - bands[i]) * coefficients[i];
    const contact = (1 - Math.exp(-t * 1600)) * Math.exp(-t / decay);
    const second = Math.max(0, t - rebound);
    const compression = (1 - Math.exp(-second * 700)) * Math.exp(-second / 0.045);
    // Broad chassis pressure lasts through the initial crunch; the rebound gives the impact weight without a tone.
    return (bands[1] - bands[0]) * (contact * 2.1 + compression * 0.8)
      + (bands[2] - bands[1]) * (contact * 0.75 + compression * 0.28);
  }, 0.7);
}

function crashMetal(ctx, seed) {
  const random = randomSource(seed);
  const creases = Array.from({ length: 10 }, () => ({
    time: 0.008 + random() ** 1.25 * 0.22,
    decay: 0.010 + random() * 0.026,
    level: 0.25 + random() * 0.65
  }));
  const modes = [180, 350, 650, 1050].map((frequency, i) => {
    const radius = Math.exp(-1 / (ctx.sampleRate * (0.004 + random() * 0.005)));
    const angle = TAU * frequency * (0.85 + random() * 0.3) / ctx.sampleRate;
    // Compensate for frequency so the lower, heavily damped modes do not become a hollow ringing note.
    return { a: 2 * radius * Math.cos(angle), b: radius * radius,
      gain: 2 * (1 - radius) * Math.sin(angle) * [1, 0.85, 0.6, 0.3][i], y1: 0, y2: 0 };
  });
  const lowCoefficient = 1 - Math.exp(-TAU * 140 / ctx.sampleRate);
  const highCoefficient = 1 - Math.exp(-TAU * 2400 / ctx.sampleRate);
  let low = 0, high = 0;
  return makeBuffer(ctx, 0.43, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowCoefficient;
    high += (noise - high) * highCoefficient;
    let pressure = (1 - Math.exp(-t * 1800)) * Math.exp(-t / 0.025);
    for (const crease of creases) {
      const local = t - crease.time;
      if (local > 0) pressure += (1 - Math.exp(-local * 2200)) * Math.exp(-local / crease.decay) * crease.level;
    }
    const excitation = noise * pressure;
    let panel = 0;
    for (const mode of modes) {
      const y = excitation + mode.a * mode.y1 - mode.b * mode.y2;
      mode.y2 = mode.y1;
      mode.y1 = y;
      panel += y * mode.gain;
    }
    // Uneven folds and short saturated noise bursts dominate; panel vibration is only a quiet undertone.
    return panel * 0.35 + Math.tanh((high - low) * 2.4) * pressure * 0.75;
  }, 0.65);
}

function crashDebris(ctx, seed) {
  const random = randomSource(seed);
  const grains = Array.from({ length: 14 }, () => {
    const time = 0.015 + random() ** 1.7 * 0.51;
    return { time, frequency: 1400 + random() * 4300, decay: 0.003 + random() * 0.010,
      level: (0.25 + random() * 0.75) * (1 - time * 0.9) };
  });
  const coefficient = 1 - Math.exp(-TAU * 1100 / ctx.sampleRate);
  let low = 0;
  return makeBuffer(ctx, 0.67, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * coefficient;
    let fragments = 0;
    for (const grain of grains) {
      const local = t - grain.time;
      if (local <= 0 || local > grain.decay * 7) continue;
      const envelope = (1 - Math.exp(-local * 3500)) * Math.exp(-local / grain.decay) * grain.level;
      const ring = Math.sin(TAU * grain.frequency * local) + Math.sin(TAU * grain.frequency * 1.71 * local) * 0.3;
      fragments += ((noise - low) * 0.7 + ring * 0.16) * envelope;
    }
    return fragments;
  }, 0.55);
}

function gustBuffer(ctx) {
  // Low-rate, looping control signal: uneven overlapping gusts with a smooth seam, rather than a sine LFO.
  const sampleRate = 8000, duration = 24;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0), random = randomSource(349);
  const fast = Array.from({ length: 48 }, () => random()), slow = Array.from({ length: 12 }, () => random());
  const interpolate = (knots, position) => {
    const index = Math.floor(position), t = position - index;
    const a = knots[(index + knots.length - 1) % knots.length], b = knots[index % knots.length];
    const c = knots[(index + 1) % knots.length], d = knots[(index + 2) % knots.length];
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  };
  for (let i = 0; i < data.length; i++) {
    const phase = i / data.length;
    data[i] = 0.38 + 0.54 * clamp(interpolate(fast, phase * fast.length) * 0.36 + interpolate(slow, phase * slow.length) * 0.64);
  }
  return buffer;
}

function signal(ctx, walk) {
  const random = randomSource(84);
  // NYC's newer APS units use rapid percussive ticks for WALK, with a quiet locator pulse between phases.
  return makeBuffer(ctx, walk ? 0.5 : 0.09, (t) => {
    const local = walk ? t % 0.125 : t;
    if (local > 0.055) return 0;
    const attack = 1 - Math.exp(-local * 2500);
    const tone = Math.sin(TAU * 880 * local) + Math.sin(TAU * 1760 * local) * 0.27;
    return (tone * 0.8 + (random() * 2 - 1) * 0.15) * attack * Math.exp(-local * (walk ? 105 : 85));
  }, 0.45);
}

// A paddle blade going into the water: a soft plunge, then a bubbly gurgle
function splash(ctx, seed) {
  const random = randomSource(seed);
  const low = 1 - Math.exp(-TAU * 500 / ctx.sampleRate), high = 1 - Math.exp(-TAU * 3200 / ctx.sampleRate);
  let a = 0, b = 0;
  const bubbles = Array.from({ length: 6 }, () => ({ time: 0.04 + random() * 0.3, freq: 500 + random() * 900, level: 0.2 + random() * 0.4 }));
  return makeBuffer(ctx, 0.55, (t) => {
    const noise = random() * 2 - 1;
    a += (noise - a) * low;
    b += (noise - b) * high;
    const plunge = (1 - Math.exp(-t * 300)) * Math.exp(-t * 14);
    let gurgle = 0;
    for (const bub of bubbles) {
      const u = t - bub.time;
      if (u > 0) gurgle += Math.sin(TAU * bub.freq * u * (1 + u * 3)) * Math.exp(-u * 45) * bub.level;
    }
    return (b - a) * plunge * 0.9 + a * plunge * 0.6 + gurgle * 0.25;
  }, 0.5);
}

// A car door shutting: a dull thump and a latch click
function door(ctx) {
  const random = randomSource(61);
  const coefficient = 1 - Math.exp(-TAU * 260 / ctx.sampleRate);
  let low = 0;
  return makeBuffer(ctx, 0.3, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * coefficient;
    const thump = Math.sin(TAU * 72 * t) * Math.exp(-t * 28) + low * 2.2 * Math.exp(-t * 32);
    const latch = t > 0.012 ? (noise * 0.4 + Math.sin(TAU * 2300 * t) * 0.3) * Math.exp(-(t - 0.012) * 260) : 0;
    return thump + latch;
  }, 0.6);
}

// --- the animals (animals.js), made at a lower rate since nothing in them is above 10 kHz -------------------------
const ANIMAL_RATE = 24000;

// A voiced call: harmonics of f0 shaped by two formants, so it sounds like a throat and a bill rather than a whistle
function voiced(phase, f0, f1, f2, width, harmonics = 18) {
  let v = 0;
  for (let n = 1; n <= harmonics; n++) {
    const f = n * f0;
    if (f > 10000) break;
    const a = Math.exp(-(((f - f1) / width) ** 2)) + 0.6 * Math.exp(-(((f - f2) / (width * 1.4)) ** 2)) + 0.04;
    v += Math.sin(phase * n) * a;
  }
  return v;
}

// A squirrel scolding: a run of quick, harsh "chuk"s ending in a buzzy trill
function chatter(ctx, seed) {
  const random = randomSource(seed);
  const chucks = [];
  let at = 0.005;
  const count = 5 + Math.floor(random() * 4);
  for (let i = 0; i < count; i++) { chucks.push({ at, len: 0.022 + random() * 0.012, f: 2900 + random() * 700 }); at += 0.042 + random() * 0.02; }
  const trill = at + 0.01;
  return makeBuffer(ctx, trill + 0.2, (t) => {
    const noise = random() * 2 - 1;
    let v = 0;
    for (const c of chucks) {
      const u = t - c.at;
      if (u < 0 || u > c.len + 0.02) continue;
      const f = c.f * (1 - u * 9);
      const env = (1 - Math.exp(-u * 3000)) * Math.exp(-u * 120);
      v += (Math.sin(TAU * f * u) + 0.4 * Math.sin(TAU * f * 2.02 * u) + noise * 0.35) * env;
    }
    const u = t - trill;
    if (u > 0) {
      const env = (1 - Math.exp(-u * 600)) * Math.exp(-u * 14) * (0.5 + 0.5 * Math.sin(TAU * 38 * u));
      v += (Math.sin(TAU * 2300 * u) + noise * 0.5) * env * 0.6;
    }
    return v;
  }, 0.55, ANIMAL_RATE);
}

// A mallard's nasal "quack", falling as it goes
function quack(ctx, seed) {
  const random = randomSource(seed);
  const f0 = 230 + random() * 50, len = 0.2 + random() * 0.06;
  let phase = 0;
  return makeBuffer(ctx, len + 0.03, (t) => {
    const u = t / len;
    phase += TAU * f0 * (1.08 - 0.25 * u) / ANIMAL_RATE;
    const env = (1 - Math.exp(-t * 180)) * (u < 0.55 ? 1 : Math.exp(-(u - 0.55) * 7)) * (0.85 + 0.15 * Math.sin(TAU * 31 * t));
    return (voiced(phase, f0, 1150, 2400, 380) + (random() * 2 - 1) * 0.25) * env;
  }, 0.55, ANIMAL_RATE);
}

// A white-tailed deer's alarm snort: one hard blow of air through the nose, breathy and hollow, falling away
function snort(ctx, seed) {
  const random = randomSource(seed);
  const len = 0.26 + random() * 0.08, f = 520 + random() * 120;
  const lo = 1 - Math.exp(-TAU * 2200 / ANIMAL_RATE), hi = 1 - Math.exp(-TAU * 450 / ANIMAL_RATE);
  let a = 0, b = 0, phase = 0;
  return makeBuffer(ctx, len + 0.05, (t) => {
    const noise = random() * 2 - 1;
    a += (noise - a) * lo; b += (a - b) * hi;
    phase += TAU * f * (1 - 0.3 * t / len) / ANIMAL_RATE;
    const env = (1 - Math.exp(-t * 900)) * Math.exp(-t * 9) * (t > len - 0.05 ? Math.max(0, (len - t) / 0.05) : 1);
    return ((a - b) * 2.6 + Math.sin(phase) * 0.12 * Math.exp(-t * 20)) * env;
  }, 0.6, ANIMAL_RATE);
}

// A Canada goose's "ah-HONK": a low start breaking up into the loud, nasal note
function honk(ctx, seed) {
  const random = randomSource(seed);
  const low = 290 + random() * 40, high = 470 + random() * 70, br = 0.07 + random() * 0.03, len = br + 0.24 + random() * 0.08;
  let phase = 0;
  return makeBuffer(ctx, len + 0.04, (t) => {
    const f = t < br ? low : high * (1 - 0.06 * (t - br) / (len - br));
    phase += TAU * f / ANIMAL_RATE;
    const env = (1 - Math.exp(-t * 120)) * (t < br ? 0.45 : 1) * (t > len - 0.06 ? Math.max(0, (len - t) / 0.06) : 1);
    return (voiced(phase, f, 950, 1900, 420, 20) + (random() * 2 - 1) * 0.3) * env;
  }, 0.6, ANIMAL_RATE);
}

// A goose hissing with its neck out
function hiss(ctx) {
  const random = randomSource(911);
  const lo = 1 - Math.exp(-TAU * 1800 / ANIMAL_RATE), hi = 1 - Math.exp(-TAU * 6500 / ANIMAL_RATE);
  let a = 0, b = 0;
  return makeBuffer(ctx, 0.75, (t) => {
    const noise = random() * 2 - 1;
    a += (noise - a) * lo; b += (noise - b) * hi;
    const env = (1 - Math.exp(-t * 40)) * Math.exp(-t * 2.2) * (0.8 + 0.2 * Math.sin(TAU * 23 * t));
    return (b - a) * env + Math.sin(TAU * 180 * t) * 0.08 * Math.exp(-t * 12);
  }, 0.5, ANIMAL_RATE);
}

// Wings beating as a bird lifts off: soft whumps that quicken
function wingbeat(ctx, seed) {
  const random = randomSource(seed);
  const co = 1 - Math.exp(-TAU * 700 / ANIMAL_RATE);
  let low = 0;
  const flaps = [];
  for (let at = 0.01, p = 0.13; at < 0.85; at += p, p = Math.max(0.085, p * 0.93)) flaps.push({ at, k: 0.7 + random() * 0.3 });
  return makeBuffer(ctx, 0.95, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * co;
    let v = 0;
    for (const f of flaps) {
      const u = t - f.at;
      if (u < 0 || u > 0.09) continue;
      v += (low * 2.4 + noise * 0.25 * Math.exp(-u * 160)) * (1 - Math.exp(-u * 400)) * Math.exp(-u * 38) * f.k;
    }
    return v * Math.max(0, 1 - t * 0.6);
  }, 0.55, ANIMAL_RATE);
}

// A red-tailed hawk's raspy, falling scream: "kee-eee-arr"
function hawkCry(ctx) {
  const random = randomSource(1201);
  const len = 1.35, co = 1 - Math.exp(-TAU * 260 / ANIMAL_RATE);
  let phase = 0, rasp = 0;
  return makeBuffer(ctx, len, (t) => {
    const noise = random() * 2 - 1;
    rasp += (noise - rasp) * co;
    const u = t / len;
    const f = u < 0.15 ? 2500 + u / 0.15 * 450 : 2950 - (u - 0.15) / 0.85 * 1050;
    phase += TAU * f * (1 + rasp * 0.05) / ANIMAL_RATE;
    const env = (1 - Math.exp(-t * 30)) * (u > 0.7 ? Math.max(0, (1 - u) / 0.3) ** 1.5 : 1);
    return (Math.sin(phase) + 0.45 * Math.sin(phase * 2) + 0.15 * Math.sin(phase * 3)) * (0.55 + rasp * 2.2) * env + noise * 0.12 * env;
  }, 0.5, ANIMAL_RATE);
}

// A rock pigeon's soft, throaty "coo-roo-coo": three low hooted notes, the middle one rising
function coo(ctx, seed) {
  const random = randomSource(seed);
  const notes = [[0, 0.16, 210, 1], [0.2, 0.32, 235, 1.4], [0.58, 0.22, 200, 0.8]];
  const base = 0.95 + random() * 0.1;
  let phase = 0;
  return makeBuffer(ctx, 0.85, (t) => {
    let f = 0, env = 0;
    for (const [at, len, hz, rise] of notes) {
      const u = t - at;
      if (u < 0 || u > len) continue;
      const k = u / len;
      f = hz * base * (1 + (rise - 1) * 0.12 * Math.sin(Math.PI * k));
      env = Math.sin(Math.PI * Math.min(1, k * 1.4)) ** 1.5 * (k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    if (!f) return 0;
    phase += TAU * f / ANIMAL_RATE;
    return (Math.sin(phase) + 0.35 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3) + (random() * 2 - 1) * 0.05) * env;
  }, 0.5, ANIMAL_RATE);
}

// An American crow's harsh "caaw": a hoarse, falling note with a rasp through it
function caw(ctx, seed) {
  const random = randomSource(seed);
  const len = 0.32 + random() * 0.08, f0 = 640 + random() * 90;
  const co = 1 - Math.exp(-TAU * 140 / ANIMAL_RATE);
  let phase = 0, rasp = 0;
  return makeBuffer(ctx, len + 0.04, (t) => {
    const noise = random() * 2 - 1;
    rasp += (noise - rasp) * co;
    const u = t / len;
    const f = f0 * (1.08 - 0.22 * u) * (1 + rasp * 0.12);
    phase += TAU * f / ANIMAL_RATE;
    const env = (1 - Math.exp(-t * 90)) * (u > 0.65 ? Math.max(0, (1 - u) / 0.35) : 1);
    return (voiced(phase, f, 1300, 2600, 520, 16) * (0.6 + Math.abs(rasp) * 3) + noise * 0.35) * env;
  }, 0.6, ANIMAL_RATE);
}

// A house sparrow's "chirp" (or a robin's "tut"): a quick bright note, bent down and up
function chirp(ctx, seed) {
  const random = randomSource(seed);
  const len = 0.07 + random() * 0.04, f0 = 3400 + random() * 900;
  let phase = 0;
  return makeBuffer(ctx, len + 0.02, (t) => {
    const u = t / len;
    const f = f0 * (1 - 0.35 * Math.sin(Math.PI * Math.min(1, u)));
    phase += TAU * f / ANIMAL_RATE;
    const env = u < 1 ? Math.sin(Math.PI * u) ** 0.8 : 0;
    return (Math.sin(phase) + 0.3 * Math.sin(phase * 2)) * env;
  }, 0.45, ANIMAL_RATE);
}

// A car into the Cube (the-cube.js): a deep metallic clang, a big hollow steel box struck, its low modes ringing on
function clang(ctx, seed) {
  const random = randomSource(seed);
  const modes = [[58, 1.9, 1], [61.5, 1.7, 0.6], [94, 1.4, 0.8], [139, 1.1, 0.6], [207, 0.85, 0.42], [329, 0.6, 0.3],
    [503, 0.38, 0.2], [788, 0.22, 0.12], [1240, 0.12, 0.07]].map(([f, d, g]) => ({
    w: TAU * f * (0.97 + random() * 0.06), d: d * (0.9 + random() * 0.2), g, p: random() * TAU }));
  const co = 1 - Math.exp(-TAU * 220 / ANIMAL_RATE);
  let thump = 0;
  return makeBuffer(ctx, 2.2, (t) => {
    const noise = random() * 2 - 1;
    thump += (noise - thump) * co;
    let ring = 0;
    for (const m of modes) ring += Math.sin(m.w * t + m.p) * Math.exp(-t / m.d) * m.g;
    // the strike: a dull thump in the first moments, before the ring takes over
    const hit = Math.exp(-t / 0.03);
    return ring * (1 - Math.exp(-t * 900)) + thump * hit * 5 + noise * hit * 0.25;
  }, 0.6, ANIMAL_RATE);
}

export function createEventResources(ctx, resources) {
  const speakers = [
    { pitch: 99, formants: 0.88, breath: 0.06 }, { pitch: 119, formants: 0.94, breath: 0.10 },
    { pitch: 143, formants: 1.00, breath: 0.08 }, { pitch: 166, formants: 1.04, breath: 0.12 },
    { pitch: 191, formants: 1.10, breath: 0.09 }, { pitch: 216, formants: 1.14, breath: 0.13 }
  ];
  return {
    ...resources,
    footsteps: Array.from({ length: 8 }, (_, i) => footstep(ctx, i + 1)),
    syllables: speakers.map((speaker, voice) => Array.from({ length: 4 }, (_, i) => speechFragment(ctx, speaker, i + voice * 4 + 20))),
    horns: [0.22, 0.37, 0.55].map((duration, i) => horn(ctx, duration, 17 + i)),
    trainHorn: trainHorn(ctx),
    crashes: {
      body: Array.from({ length: 3 }, (_, i) => crashBody(ctx, i + 301)),
      metal: Array.from({ length: 3 }, (_, i) => crashMetal(ctx, i + 401)),
      debris: Array.from({ length: 3 }, (_, i) => crashDebris(ctx, i + 501))
    },
    gusts: gustBuffer(ctx),
    signalTick: signal(ctx, false),
    signalWalk: signal(ctx, true),
    splashes: Array.from({ length: 4 }, (_, i) => splash(ctx, i + 701)),
    door: door(ctx),
    clang: [clang(ctx, 1701), clang(ctx, 1702)],
    animals: {
      chatter: [chatter(ctx, 1301), chatter(ctx, 1302)],
      quack: [quack(ctx, 1401), quack(ctx, 1402)],
      honk: [honk(ctx, 1501), honk(ctx, 1502)],
      hiss: hiss(ctx),
      wingbeat: wingbeat(ctx, 1601),
      hawk: hawkCry(ctx),
      snort: [snort(ctx, 1801), snort(ctx, 1802)],
      coo: [coo(ctx, 1901), coo(ctx, 1902)],
      caw: [caw(ctx, 2001), caw(ctx, 2002), caw(ctx, 2003)],
      chirp: [chirp(ctx, 2101), chirp(ctx, 2102), chirp(ctx, 2103)]
    }
  };
}

export function playEvent(ctx, resources, kind, output, options = {}) {
  const random = randomSource(options.seed);
  const start = Math.max(ctx.currentTime, finite(options.when, ctx.currentTime));
  const intensity = clamp(finite(options.intensity, 1));
  const levels = { footstep: 0.22, talk: 0.065, shout: 0.2, horn: 0.23, trainhorn: 0.5, signal: 0.13, crash: 0.35, splash: 0.5, plunge: 0.9, door: 0.45, thud: 0.5,
    chatter: 0.22, quack: 0.3, honk: 0.4, hiss: 0.22, wingbeat: 0.3, hawk: 0.32, clang: 0.55, snort: 0.4,
    coo: 0.22, caw: 0.36, chirp: 0.16 };
  if (!Object.hasOwn(levels, kind) || intensity === 0) return { endTime: start, dispose() {} };
  const gain = ctx.createGain();
  gain.gain.value = intensity * levels[kind];
  gain.connect(output);
  const sources = new Map();
  let disposed = false;
  const release = (source) => {
    const envelope = sources.get(source);
    if (!envelope) return;
    source.onended = null;
    source.disconnect();
    envelope.disconnect();
    sources.delete(source);
    if (!sources.size) {
      disposed = true;
      gain.disconnect();
    }
  };
  const event = {
    endTime: start,
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      const fade = !immediate && ctx.state === 'running' ? 0.04 : 0;
      event.endTime = Math.min(event.endTime, now + fade);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.008);
      for (const source of sources.keys()) source.stop(now + fade);
      // Suspended contexts may not dispatch ended until resumed; reset also releases future syllables now.
      if (!fade) for (const source of sources.keys()) release(source);
    }
  };
  const play = (buffer, when, rate = 1, volume = 1) => {
    const source = ctx.createBufferSource();
    const envelope = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    envelope.gain.value = volume;
    source.connect(envelope).connect(gain);
    sources.set(source, envelope);
    source.onended = () => release(source);
    const end = when + buffer.duration / rate;
    event.endTime = Math.max(event.endTime, end);
    source.start(when);
    source.stop(end);
    return end;
  };

  if (kind === 'footstep') {
    const speed = clamp(Math.abs(finite(options.speed)) / 8);
    play(resources.footsteps[Math.floor(random() * resources.footsteps.length)], start, 0.9 + random() * 0.17 + speed * 0.13);
  } else if (kind === 'talk') {
    const identity = randomSource(finite(options.voiceSeed, finite(options.seed, 1)));
    const voice = resources.syllables[Math.floor(identity() * resources.syllables.length)];
    const pitch = 0.95 + identity() * 0.1;
    const count = random() < 0.65 ? 2 : 1;
    let when = start;
    let variant = Math.floor(random() * voice.length);
    for (let i = 0; i < count; i++) {
      const buffer = voice[variant];
      const end = play(buffer, when, pitch * (0.985 + random() * 0.03), 0.78 + random() * 0.22);
      when = end + 0.065 + random() * 0.13;
      variant = (variant + 1 + Math.floor(random() * (voice.length - 1))) % voice.length;
    }
  } else if (kind === 'shout') {
    // the same voice, raised: higher, louder and quick, one or two syllables
    const identity = randomSource(finite(options.voiceSeed, finite(options.seed, 1)));
    const voice = resources.syllables[Math.floor(identity() * resources.syllables.length)];
    const pitch = (0.95 + identity() * 0.1) * 1.22;
    let when = start;
    const variant = Math.floor(random() * voice.length);
    const end = play(voice[variant], when, pitch, 1);
    if (random() < 0.6) play(voice[(variant + 1) % voice.length], end + 0.03, pitch * 1.06, 0.9);
  } else if (kind === 'horn') {
    play(resources.horns[Math.floor(random() * resources.horns.length)], start, 0.94 + random() * 0.12);
  } else if (kind === 'trainhorn') {
    play(resources.trainHorn, start, 0.98 + random() * 0.04);
  } else if (kind === 'crash') {
    const severity = clamp(finite(options.severity, intensity));
    const variant = Math.floor(random() * resources.crashes.body.length);
    const rate = (1.16 - severity * 0.24) * (0.96 + random() * 0.08);
    play(resources.crashes.body[variant], start, rate, 0.9 + severity * 0.1);
    play(resources.crashes.metal[variant], start + 0.003, rate, 0.04 + severity ** 1.4 * 0.56);
    if (severity > 0.6) {
      play(resources.crashes.debris[variant], start + 0.012, rate, (severity - 0.6) / 0.4 * 0.24);
    }
  } else if (kind === 'splash') {
    play(resources.splashes[Math.floor(random() * resources.splashes.length)], start, 0.9 + random() * 0.2);
  } else if (kind === 'plunge') {
    // a car or bike hitting the water: the paddle's splash slowed into a deep whump, a crash of spray over it, and the
    // thrown water pattering back down a moment later
    const n = resources.splashes.length, v = Math.floor(random() * n);
    play(resources.splashes[v], start, 0.42 + random() * 0.06, 1);
    play(resources.splashes[(v + 1) % n], start + 0.02, 0.62 + random() * 0.08, 0.8);
    play(resources.splashes[(v + 2) % n], start + 0.05, 1.05 + random() * 0.1, 0.5 * intensity);
    for (let i = 0; i < 5; i++) play(resources.splashes[(v + i) % n], start + 0.45 + i * 0.09 + random() * 0.08, 1.5 + random() * 0.5, 0.18 * intensity);
  } else if (kind === 'thud') {
    // a body against the car: the crash's dull chassis thump, lower and without the metal
    const variant = Math.floor(random() * resources.crashes.body.length);
    play(resources.crashes.body[variant], start, 0.62 + random() * 0.1, 1);
  } else if (kind === 'door') {
    play(resources.door, start, 0.95 + random() * 0.1);
  } else if (kind === 'chatter' || kind === 'quack' || kind === 'honk') {
    const set = resources.animals[kind], buffer = set[Math.floor(random() * set.length)];
    const pitch = 0.92 + random() * 0.16;
    const end = play(buffer, start, pitch);
    // ducks and geese call in runs: a second (and third) quack or honk, a little lower
    if (kind !== 'chatter' && random() < 0.7) {
      const next = play(set[(set.indexOf(buffer) + 1) % set.length], end + 0.06 + random() * 0.12, pitch * 0.96, 0.85);
      if (random() < 0.45) play(buffer, next + 0.07 + random() * 0.12, pitch * 0.92, 0.7);
    }
  } else if (kind === 'clang') {
    // harder hits ring a little lower and longer
    play(resources.clang[Math.floor(random() * 2)], start, 1.06 - intensity * 0.12 + random() * 0.05);
  } else if (kind === 'snort') {
    // a snort, sometimes two, as the deer goes
    const set = resources.animals.snort, pitch = 0.9 + random() * 0.2;
    const end = play(set[Math.floor(random() * set.length)], start, pitch);
    if (random() < 0.4) play(set[Math.floor(random() * set.length)], end + 0.15 + random() * 0.2, pitch * 0.97, 0.8);
  } else if (kind === 'coo') {
    const set = resources.animals.coo;
    play(set[Math.floor(random() * set.length)], start, 0.92 + random() * 0.14);
  } else if (kind === 'caw') {
    // crows call in runs of two to four
    const set = resources.animals.caw, pitch = 0.93 + random() * 0.14;
    let at = start;
    const n = 2 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) at = play(set[Math.floor(random() * set.length)], at, pitch * (1 - i * 0.015), 1 - i * 0.08) + 0.12 + random() * 0.14;
  } else if (kind === 'chirp') {
    // a sparrow's run of chirps; low intensity is a robin's slower, lower "tut"
    const set = resources.animals.chirp, robin = intensity < 0.6, pitch = (robin ? 0.62 : 0.9) + random() * 0.2;
    let at = start;
    const n = (robin ? 2 : 2) + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) at = play(set[Math.floor(random() * set.length)], at, pitch * (0.96 + random() * 0.08)) + (robin ? 0.16 : 0.05) + random() * 0.08;
  } else if (kind === 'hiss') {
    play(resources.animals.hiss, start, 0.92 + random() * 0.16);
  } else if (kind === 'wingbeat') {
    play(resources.animals.wingbeat, start, 0.85 + random() * 0.3 + intensity * 0.1, 0.7 + intensity * 0.3);
  } else if (kind === 'hawk') {
    play(resources.animals.hawk, start, 0.95 + random() * 0.08);
  } else {
    play(options.walk ? resources.signalWalk : resources.signalTick, start);
  }
  return event;
}

function smoothParameter(parameter, timeConstant, epsilon = 0.0001) {
  let target = NaN;
  return (value, now) => {
    if (Math.abs(value - target) < epsilon) return;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, timeConstant);
    target = value;
  };
}

export function createWindVoice(ctx, resources, output) {
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, ctx.currentTime);
  master.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  master.connect(output);
  const nodes = [master], sources = [], channels = [];
  let disposed = false, remaining = 4;
  const disconnect = () => {
    for (const node of nodes) node.disconnect();
  };
  for (let i = 0; i < 2; i++) {
    const noise = ctx.createBufferSource();
    noise.buffer = resources.noise;
    noise.loop = true;
    const highpass = ctx.createBiquadFilter();
    setControlRate(highpass.frequency, highpass.detune, highpass.Q, highpass.gain);
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.5;
    const lowpass = ctx.createBiquadFilter();
    setControlRate(lowpass.frequency, lowpass.detune, lowpass.Q, lowpass.gain);
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1550;
    lowpass.Q.value = 0.4;
    const air = ctx.createGain();
    air.gain.value = 0.010;
    const rumbleFilter = ctx.createBiquadFilter();
    setControlRate(rumbleFilter.frequency, rumbleFilter.detune, rumbleFilter.Q, rumbleFilter.gain);
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 480;
    rumbleFilter.Q.value = 0.5;
    const rumble = ctx.createGain();
    rumble.gain.value = 0.006;
    const pan = ctx.createStereoPanner();
    pan.pan.value = i ? 0.7 : -0.7;
    const gust = ctx.createBufferSource();
    gust.buffer = resources.gusts;
    gust.loop = true;
    gust.playbackRate.value = i ? 0.79 : 1;
    const modulation = ctx.createGain();
    modulation.gain.value = 0;
    noise.connect(highpass).connect(lowpass).connect(air).connect(modulation).connect(pan).connect(master);
    highpass.connect(rumbleFilter).connect(rumble).connect(modulation);
    gust.connect(modulation.gain);
    channels.push({
      air: smoothParameter(air.gain, 0.6),
      rumble: smoothParameter(rumble.gain, 1),
      cutoff: smoothParameter(lowpass.frequency, 0.8, 1)
    });
    sources.push(noise, gust);
    nodes.push(noise, highpass, lowpass, air, rumbleFilter, rumble, pan, gust, modulation);
    for (const source of [noise, gust]) source.onended = () => { if (--remaining === 0) disconnect(); };
    noise.start(ctx.currentTime, i * resources.noise.duration * 0.43);
    gust.start(ctx.currentTime, i * resources.gusts.duration * 0.37);
  }
  return {
    update({ speed = 0, altitude = 0, night = 0, traffic = 0, enclosure = 0 } = {}, now = ctx.currentTime) {
      if (disposed) return;
      now = Math.max(ctx.currentTime, finite(now, ctx.currentTime));
      const motion = clamp(Math.abs(finite(speed)) / 55);
      const exposure = Math.sqrt(clamp(altitude / 300));
      const quiet = 1 - clamp(Number(night)) * 0.3;
      const shelter = 1 - clamp(enclosure) * 0.65;
      for (const channel of channels) {
        // Walls shelter ambient wind; the rush from riding or flying still follows the player's motion.
        channel.air((0.010 * shelter + motion * 0.012 + exposure * 0.015) * quiet, now);
        channel.cutoff(1550 + motion * 700 + exposure * 850, now);
        channel.rumble((0.003 + clamp(traffic) * 0.020) * quiet * (1 - exposure * 0.5), now);
      }
    },
    dispose(immediate = false) {
      if (disposed) return;
      disposed = true;
      const now = ctx.currentTime;
      const fade = !immediate && ctx.state === 'running' ? 0.08 : 0;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.015);
      for (const source of sources) source.stop(now + fade);
      if (!fade) disconnect();
    }
  };
}
