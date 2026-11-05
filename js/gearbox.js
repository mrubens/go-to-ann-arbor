// js/gearbox.js
// One automatic gearbox for a car's engine sound (audio-synthesis.js) and for the gear and revs on the dial (main.js),
// so what you hear, what you see and how fast you go agree. Ratios are engine rpm per metre a second of road speed.

export const CAR_RATIOS = [480, 300, 205, 150, 112, 86]; // six speeds: 6th is about 3,000 rpm at 36 m/s (80 mph)
export const BUS_RATIOS = [320, 205, 145, 108, 82];

export function newGearState() {
  return { gear: 0, gearLock: 0, shiftUntil: 0 };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Where the next shift is: higher with more throttle. Returns true on the frame it shifts up.
export function shiftGear(state, speed, throttle, now, first, ratios, bus = false) {
  const shiftRPM = (bus ? 1700 : 2700) + throttle * (bus ? 950 : 2900);
  let upshift = false;
  if (speed < 0.6) {
    // A fresh launch starts in first immediately, even after a hard stop from top gear.
    state.gear = 0;
    state.gearLock = state.shiftUntil = 0;
  } else if (first) {
    while (state.gear < ratios.length - 1 && speed * ratios[state.gear] > shiftRPM) state.gear++;
  } else if (now >= state.gearLock) {
    const old = state.gear;
    const wheelRPM = speed * ratios[state.gear];
    if (state.gear < ratios.length - 1 && wheelRPM > shiftRPM) state.gear++;
    else if (state.gear > 0 && speed * ratios[state.gear - 1] < shiftRPM * 0.82
      && (wheelRPM < (bus ? 1000 : 1600) || (throttle > 0.65 && wheelRPM < shiftRPM * 0.55))) state.gear--;
    if (state.gear !== old) {
      state.gearLock = now + 0.65;
      upshift = state.gear > old;
      if (upshift) state.shiftUntil = now + 0.16;
    }
  }
  return upshift;
}

// Engine revs for a gear: the wheels' share, with torque-converter slip at low speed
export function engineRPM(state, speed, throttle, ratios, idle, bus = false) {
  const slip = throttle * (bus ? 600 : 1500) * Math.max(0.12, 1 - speed / 16);
  return clamp(Math.max(idle, speed * ratios[state.gear]) + slip, idle, bus ? 2900 : 6200);
}
