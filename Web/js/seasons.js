// Lamp: the season, by Ann Arbor's date. The trees (trees.js: fall color, leaf fall, bare winter crowns, blossom and
// leaf-out) and the lawns (tsl-materials.js: dormant straw in winter) take the day of the year from here, as they're
// made and again whenever main.js's watchDate sees the date turn over (refreshSeason), so a session left running
// past midnight changes in place. Nothing here runs per frame.
//
// To look at another season, open the page with `?season=01-15` (or `?season=2027-05-02`): that day stands in for
// today's, and the date watch leaves it be.
const annArborDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
let asked = null;
try { asked = new URLSearchParams(location.search).get('season'); } catch { /* no page address */ }
const askedYMD = /^(\d{4}-)?\d{2}-\d{2}$/.test(asked || '') ? (asked.length === 5 ? `${new Date().getFullYear()}-${asked}` : asked) : null;

// The day of the year (0 on January 1) of 'YYYY-MM-DD'
function dayOfYear(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5;
}
const seasonDay = () => dayOfYear(askedYMD || annArborDate());

let current = seasonDay();
const listeners = [];
// `fn(day)` now and on each new day
function onSeason(fn) {
  listeners.push(fn);
  fn(current);
}
// Looks at the date again; the listeners hear of a new day
function refreshSeason() {
  const day = seasonDay();
  if (day === current) return false;
  current = day;
  for (const fn of listeners) fn(day);
  return true;
}

export { onSeason, refreshSeason, seasonDay, dayOfYear };
