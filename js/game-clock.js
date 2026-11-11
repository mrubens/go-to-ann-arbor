// Lamp: the time the game shows, for things that tell it (Burton Tower's clock faces and its bells, burton-bells.js).
// Under "Now" it is Ann Arbor's real time (America/Detroit); under a time preset it stands still at an hour that suits
// the look (the Night button says 23:00). lighting.js applyPreset says which is on.

// seconds after local midnight each preset's clock shows
const PRESET_TIME = { midday: 12 * 3600, golden: 19 * 3600 + 30 * 60, twilight: 20 * 3600 + 40 * 60, midnight: 23 * 3600 };

let preset = 'now';
function setClockPreset(id) { preset = id || 'now'; }

// Detroit's offset from UTC (s), worked out again each minute (it changes twice a year)
let offset = 0, offsetAt = -Infinity;
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
});
function detroitOffset(ms) {
  if (Math.abs(ms - offsetAt) < 60e3) return offset;
  const p = {};
  for (const { type, value } of PARTS.formatToParts(new Date(ms))) p[type] = +value;
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  offset = Math.round((asUTC - Math.floor(ms / 1000) * 1000) / 1000);
  offsetAt = ms;
  return offset;
}

// { sec: seconds after local midnight (with fractions), live: true under "Now" }
function gameTime(ms = Date.now()) {
  if (preset !== 'now' && PRESET_TIME[preset] != null) return { sec: PRESET_TIME[preset], live: false };
  const local = ms / 1000 + detroitOffset(ms);
  return { sec: ((local % 86400) + 86400) % 86400, live: true };
}

// the moment the game shows, as a Date's milliseconds: now under "Now", and under a preset today at its hour (for the
// stars, sky-stars.js)
function gameMoment(ms = Date.now()) {
  if (preset === 'now' || PRESET_TIME[preset] == null) return ms;
  const local = ((ms / 1000 + detroitOffset(ms)) % 86400 + 86400) % 86400;
  return ms + (PRESET_TIME[preset] - local) * 1000;
}

export { setClockPreset, gameTime, gameMoment, PRESET_TIME };
