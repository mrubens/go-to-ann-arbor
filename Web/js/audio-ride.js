// The sounds of the road under the player's own wheels, the bicycle's bell and its gear changes (audio-system.js ride
// and honk call these), heard as the rider hears them (not placed in the world: the player is at the middle of it).
// - brick and pavers: a fine, fast drumming as the tires cross the joints, quicker with speed
// - gravel and dirt: a grainy crunch
// - a boardwalk: the hollow knock of its planks, one every 15 cm (bike-routes.js lays them so)
// - a wet road (road-feel.js): the tires' hiss, rising with speed
// All from one looping noise, a few filters and two oscillators; quiet when there's nothing to hear.

const smooth = (param, value, now, time = 0.06) => {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, time);
};

export function createRideVoice(ctx, noiseBuffer, out) {
  const nodes = [];
  const own = (n) => { nodes.push(n); return n; };
  const gain = (v = 0) => { const g = own(ctx.createGain()); g.gain.value = v; return g; };
  const filter = (type, f, q) => { const b = own(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const noise = own(ctx.createBufferSource());
  noise.buffer = noiseBuffer;
  noise.loop = true;

  // the joints: a band of road noise switched on and off by a square wave at the rate the tires cross them
  const joints = own(ctx.createOscillator());
  joints.type = 'square';
  joints.frequency.value = 40;
  const drumBand = filter('bandpass', 240, 1.3);
  const drumGate = gain(0.5);
  const drumDepth = gain(0.5);
  joints.connect(drumDepth).connect(drumGate.gain);
  const drum = gain(0);
  noise.connect(drumBand).connect(drumGate).connect(drum).connect(out);

  // gravel's crunch: a higher band, made grainy by a fast irregular flutter
  const grain = own(ctx.createOscillator());
  grain.type = 'sawtooth';
  grain.frequency.value = 23;
  const crunchBand = filter('bandpass', 1900, 0.7);
  const crunchGate = gain(0.6);
  const grainDepth = gain(0.4);
  grain.connect(grainDepth).connect(crunchGate.gain);
  const crunch = gain(0);
  noise.connect(crunchBand).connect(crunchGate).connect(crunch).connect(out);

  // the wet road's hiss
  const hissBand = filter('highpass', 3200, 0.6);
  const hiss = gain(0);
  noise.connect(hissBand).connect(hiss).connect(out);

  const now0 = ctx.currentTime;
  noise.start(now0); joints.start(now0); grain.start(now0);
  let quiet = false;

  // kind: road-feel.js SURFACE (1 brick, 2 gravel, 3 dirt, 4 boards), speed m/s, wet 0 to 1, bike: a bicycle's or a
  // motorbike's thin tires (higher, lighter)
  function update(kind, speed, wet, bike, now) {
    const s = Math.min(1, speed / (bike ? 10 : 20));
    const rolling = speed > 0.8 ? 1 : 0;
    const d = rolling * (kind === 1 ? 0.05 : kind === 4 ? 0.07 : 0) * Math.sqrt(s);
    const c = rolling * (kind === 2 || kind === 3 ? (kind === 2 ? 0.07 : 0.045) : 0) * Math.sqrt(s);
    const h = rolling * wet * 0.045 * s * (bike ? 0.6 : 1);
    const silent = d < 0.002 && c < 0.002 && h < 0.002;
    if (silent && quiet) return;
    quiet = silent;
    // bricks about 10 cm across the way, a boardwalk's planks 15 cm apart
    const rate = Math.max(4, Math.min(150, speed / (kind === 4 ? 0.15 : 0.1)));
    smooth(joints.frequency, rate, now, 0.05);
    smooth(drumBand.frequency, kind === 4 ? 170 : (bike ? 420 : 240) + s * 120, now);
    smooth(drumBand.Q, kind === 4 ? 3 : 1.3, now);
    smooth(drum.gain, d, now);
    smooth(grain.frequency, 17 + speed * 1.7, now);
    smooth(crunchBand.frequency, (kind === 3 ? 1100 : 1900) + s * 600, now);
    smooth(crunch.gain, c, now);
    smooth(hissBand.frequency, 2600 + s * 1800, now);
    smooth(hiss.gain, h, now);
  }

  // A derailleur shifting: the lever's tick and the chain settling on the next cog a moment after
  function click(now) {
    for (const [at, level, f] of [[0, 0.09, 3800], [0.05, 0.05, 2600]]) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass'; band.frequency.value = f; band.Q.value = 4;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now + at);
      env.gain.linearRampToValueAtTime(level, now + at + 0.002);
      env.gain.setTargetAtTime(0, now + at + 0.003, 0.008);
      src.connect(band).connect(env).connect(out);
      src.start(now + at, Math.random() * 0.5);
      src.stop(now + at + 0.06);
      src.onended = () => { src.disconnect(); band.disconnect(); env.disconnect(); };
    }
  }

  function dispose() {
    try { noise.stop(); joints.stop(); grain.stop(); } catch { /* stopped */ }
    for (const n of nodes) n.disconnect();
  }
  return { update, click, dispose };
}

// A bicycle's bell: a thumb-struck dome rung twice, the second strike a little softer, its partials ringing on
// (inharmonic, as a struck dome's are) and a pair just apart in each beating slowly
export function ringBell(ctx, out, now) {
  const PARTIALS = [[1, 1, 0.9], [2.32, 0.45, 0.5], [4.25, 0.22, 0.3], [6.63, 0.1, 0.18]];
  const master = ctx.createGain();
  master.gain.value = 0.11;
  master.connect(out);
  let end = now;
  for (const [at, strike] of [[0, 1], [0.17, 0.75]]) {
    for (const [ratio, level, decay] of PARTIALS) {
      for (const detune of [0, 3.5]) {
        const o = ctx.createOscillator();
        o.frequency.value = 2050 * ratio + detune * ratio;
        const g = ctx.createGain();
        const t = now + at;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level * strike * 0.5, t + 0.002);
        g.gain.setTargetAtTime(0, t + 0.002, decay * 0.45);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + decay * 3);
        end = Math.max(end, t + decay * 3);
        o.onended = () => { o.disconnect(); g.disconnect(); };
      }
    }
  }
  setTimeout(() => master.disconnect(), (end - now + 0.2) * 1000);
}
