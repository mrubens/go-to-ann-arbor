// Lamp: what the people out in town go by: Ann Arbor's hour (the clock under the "Now" sky, or the hour a picked look
// stands for), its date and its weather (weather.js). main.js sets it each time the sky is chosen or put on again
// (selectTime, every minute under "Now" and when a new weather report comes in); pedestrian-system.js (who's out on
// the park paths, sitting, walking a dog or under an umbrella) and outdoor-seating.js (patio tables set out in
// season and opening hours) read it.
//
// For a look at another season, `?date=2026-07-15` (and `?hour=13`) in the page's address overrides the date (hour).

const LOOK_HOUR = { midday: 12.5, golden: 18.5, twilight: 20.5, midnight: 0.5 };
const ASK = new URLSearchParams(location.search);
const ASKED_DATE = /^\d{4}-\d{2}-\d{2}$/.test(ASK.get('date') || '') ? ASK.get('date') : null;
const ASKED_HOUR = ASK.has('hour') && Number.isFinite(+ASK.get('hour')) ? +ASK.get('hour') % 24 : null;

const LIFE = {
  hour: 12, // 0-24, fractional
  month: 1, // 1-12
  day: 1, // day of the month
  dayOfYear: 1,
  weekday: 0, // 0 Sunday
  rain: false, // rain or storm falling (umbrellas up)
  snow: false,
  tempF: null,
  version: 0 // bumped on every change, for anyone who caches what follows from it
};
const listeners = [];

function detroitParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

function setStreetLife(timeId, weather) {
  const o = detroitParts(Date.now());
  let year = +o.year, month = +o.month, day = +o.day;
  if (ASKED_DATE) [year, month, day] = ASKED_DATE.split('-').map(Number);
  const hour = ASKED_HOUR ?? (timeId === 'now' || !(timeId in LOOK_HOUR) ? +o.hour + +o.minute / 60 : LOOK_HOUR[timeId]);
  const start = Date.UTC(year, 0, 1), at = Date.UTC(year, month - 1, day);
  const kind = timeId === 'now' ? weather?.kind : null; // rain falls only under the real sky (precipitation.set)
  const next = {
    hour, month, day, dayOfYear: Math.round((at - start) / 864e5) + 1, weekday: new Date(at).getUTCDay(),
    rain: kind === 'rain' || kind === 'storm', snow: kind === 'snow', tempF: weather?.tempF ?? null
  };
  let changed = false;
  for (const k in next) if (LIFE[k] !== next[k]) { LIFE[k] = next[k]; changed = true; }
  if (!changed) return;
  LIFE.version++;
  for (const fn of listeners) fn(LIFE);
}
setStreetLife('now', null);
const onStreetLife = (fn) => { listeners.push(fn); fn(LIFE); };

// Patio season, as Ann Arbor's restaurants keep it: tables out from April through October (by November the first
// hard frosts are in and the furniture's stacked away until spring)
const patioSeason = (l = LIFE) => l.month >= 4 && l.month <= 10;
// Set out from 7 in the morning until 11 at night; put away overnight
const patiosOpen = (l = LIFE) => patioSeason(l) && l.hour >= 7 && l.hour < 23;
// Warm enough to eat outside: under the "Now" sky by the report, else by the month
const mild = (l = LIFE) => (l.tempF != null ? l.tempF >= 55 : l.month >= 5 && l.month <= 9);

export { LIFE, setStreetLife, onStreetLife, patioSeason, patiosOpen, mild };
