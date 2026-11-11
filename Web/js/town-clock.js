// Ann Arbor's clock for how busy the town is: how many cars are out, and how many people on campus, downtown and in
// the neighborhoods, by the hour shown (the real Detroit time under "Now", or a look's own hour), the weekday and
// U-M's term. Classes keep Tower Time (start on the hour or the half hour, let out ten minutes early), so on class
// days campus sidewalks fill from :50 to :00 and :20 to :30; Friday and Saturday nights downtown are busy until
// Michigan's 2 a.m. last call, a short rush, then quiet.

// U-M Ann Arbor's terms, [first day of classes, last day of exams] (Detroit dates, inclusive), and the recesses in
// them. Fall 2026's start (Aug 31) and Thanksgiving recess (Nov 25-27) are the Regents' calendar's; the rest follow
// the usual pattern and want checking against the Registrar's calendar (ro.umich.edu/calendars) each year.
const TERMS = [
  ['2025-08-25', '2025-12-17'], ['2026-01-07', '2026-04-29'],
  ['2026-08-31', '2026-12-17'], ['2027-01-06', '2027-04-28']
];
const RECESS = [
  ['2025-11-26', '2025-11-30'], ['2026-02-28', '2026-03-08'],
  ['2026-11-25', '2026-11-29'], ['2027-02-27', '2027-03-07']
];
const within = (d, list) => list.some(([a, b]) => d >= a && d <= b);

// the hour each fixed look stands for (Now reads the clock)
const LOOK_HOUR = { midday: 12.5, golden: 18.75, twilight: 20.5, midnight: 0.25 };

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
});
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { hour (0-24, with minutes), day (0 Sunday .. 6 Saturday), date 'YYYY-MM-DD', term: 'class' | 'weekend' | 'break' }
function townTime(timeId = 'now', now = Date.now()) {
  const p = Object.fromEntries(parts.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const day = DAYS[p.weekday] ?? 2;
  const hour = timeId === 'now' || LOOK_HOUR[timeId] == null ? (+p.hour % 24) + (+p.minute) / 60 : LOOK_HOUR[timeId];
  const inTerm = within(date, TERMS) && !within(date, RECESS);
  const term = !inTerm ? 'break' : day === 0 || day === 6 ? 'weekend' : 'class';
  return { hour, day, date, term };
}

// By the hour (index 0 = midnight to 1 a.m.), 1 the busiest
const CAMPUS = [0.22, 0.14, 0.08, 0.04, 0.03, 0.05, 0.12, 0.35, 0.75, 0.95, 1, 1, 1, 1, 1, 1, 0.95, 0.85, 0.7, 0.6, 0.55, 0.5, 0.42, 0.32];
const DOWNTOWN = [0.3, 0.22, 0.12, 0.05, 0.04, 0.05, 0.12, 0.3, 0.45, 0.5, 0.55, 0.75, 0.9, 0.8, 0.7, 0.7, 0.8, 0.95, 1, 1, 0.92, 0.75, 0.55, 0.42];
const HOMES = [0.2, 0.14, 0.1, 0.06, 0.06, 0.08, 0.2, 0.35, 0.5, 0.55, 0.6, 0.7, 0.8, 0.8, 0.8, 0.9, 1, 1, 1, 1, 0.95, 0.85, 0.6, 0.35];
// cars: the morning and evening rushes on weekdays; later, flatter weekends
const CARS_WEEKDAY = [0.3, 0.22, 0.17, 0.15, 0.16, 0.24, 0.48, 0.88, 1, 0.8, 0.7, 0.74, 0.8, 0.78, 0.78, 0.86, 0.96, 1, 0.88, 0.72, 0.6, 0.5, 0.42, 0.35];
const CARS_WEEKEND = [0.38, 0.3, 0.24, 0.16, 0.14, 0.15, 0.22, 0.32, 0.45, 0.58, 0.68, 0.75, 0.8, 0.8, 0.78, 0.76, 0.75, 0.75, 0.72, 0.66, 0.6, 0.55, 0.48, 0.42];
const lerpHour = (table, h) => {
  const i = Math.floor(h) % 24, f = h - Math.floor(h);
  return table[i] + (table[(i + 1) % 24] - table[i]) * f;
};
// a Friday or Saturday night, counted on to 3 a.m. the morning after
const lateNight = (t) => (t.hour >= 19 && (t.day === 5 || t.day === 6)) || (t.hour < 3 && (t.day === 6 || t.day === 0));
// last call (2 a.m. Saturday and Sunday mornings): the bars empty out from about 1:50 to 2:30
const lastCall = (t) => (t.day === 6 || t.day === 0) && t.hour >= 1.83 && t.hour < 2.5;

// How busy each part of town's sidewalks are against its busiest: { campus, downtown, homes, surge }
function crowdShares(t) {
  let campus = lerpHour(CAMPUS, t.hour), downtown = lerpHour(DOWNTOWN, t.hour);
  const homes = lerpHour(HOMES, t.hour);
  const min = Math.round((t.hour % 1) * 60);
  // between classes (Tower Time): the walks fill as one lets out and the next is about to start
  const surge = t.term === 'class' && t.hour >= 8.8 && t.hour < 18.5 && ((min >= 50) || (min >= 20 && min < 30));
  if (surge) campus *= 1.4;
  if (t.term === 'weekend') campus *= t.hour >= 11 && t.hour < 18 ? 0.55 : 0.75;
  else if (t.term === 'break') campus *= 0.35;
  if (lateNight(t)) { downtown = Math.max(downtown, t.hour >= 19 ? 1 : 0.75); campus = Math.max(campus, t.term === 'break' ? 0.15 : 0.45); }
  else if (t.hour >= 22 || t.hour < 3) downtown *= 0.75; // a school night
  if (lastCall(t)) { downtown = 1; campus = Math.max(campus, 0.7); }
  else if ((t.day === 6 || t.day === 0) && t.hour >= 2.5 && t.hour < 4) { downtown *= 0.4; campus *= 0.4; }
  return { campus, downtown, homes, surge };
}

// Share of traffic's cars out on the streets (1 = all of them)
function trafficShare(t) {
  const weekend = t.day === 0 || t.day === 6;
  let s = lerpHour(weekend ? CARS_WEEKEND : CARS_WEEKDAY, t.hour);
  if (lastCall(t)) s = Math.max(s, 0.42);
  if (t.term === 'break' && !weekend && t.hour > 7 && t.hour < 19) s *= 0.9;
  return s;
}

export { townTime, crowdShares, trafficShare };
