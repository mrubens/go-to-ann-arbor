import { asset, log } from '../lamp-game.js';
import { toWorld, nativeJSON } from './live-feeds.js';

// Lamp: Ann Arbor's real road work. The city's "Downtown Street Closures" layer (its construction-season map, public
// on ArcGIS Online) lists each full road closure with its street, project and dates; the ones on today, by Ann Arbor's
// calendar, are the blocks road-work.js shuts (this year's layer, or last year's until the new one is up). Asked for as the city opens; offline, the copy in data/city-closures.json
// (taken when this was written) stands in, its dates still deciding what's on. A closure with no dates counts while
// the month it's mapped for is on, in its layer's year only.

// the city publishes one layer a year; the saved copy is 2026's
const LAYER = (year) => `https://services2.arcgis.com/cenCPuKxOZuq6BCE/arcgis/rest/services/Downtown_Street_Closures_${year}/FeatureServer/0/query`;
const SAVED_YEAR = 2026;
const MIDRIVE = 'https://mdotjboss.state.mi.us/MiDrive/construction/list/loadConstruction';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

async function fetchLayer(year) {
  const q = `${LAYER(year)}?where=Type%3D%27Road%20Closure%27&outFields=OBJECTID,Street,ProjectName,DateRange,StartDate,EndDate,Map&outSR=4326&geometryPrecision=6&f=json`;
  const res = await fetch(q, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(res.status);
  const d = await res.json();
  if (!Array.isArray(d?.features)) throw new Error('no features');
  return d.features.filter((f) => f.geometry?.paths).map((f) => ({ a: f.attributes, p: f.geometry.paths }));
}

// this year's layer by Ann Arbor's calendar, else last year's (early in the year the new one may not be up yet)
async function fetchLive(year) {
  try {
    return { features: await fetchLayer(year), year };
  } catch (e) {
    if (e?.name === 'TimeoutError') throw e; // offline or slow: don't hold the start up for a second try
    return { features: await fetchLayer(year - 1), year: year - 1 };
  }
}

// Ann Arbor's date as YYYYMMDD (the player's own clock may be in another time zone, or past midnight UTC)
const DETROIT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' });
const detroitDate = (ms) => DETROIT.format(new Date(ms)).replace(/-/g, '');

function onToday(a, now, layerYear) {
  const day = 864e5;
  if (a.StartDate || a.EndDate) {
    return (!a.StartDate || a.StartDate <= now + day) && (!a.EndDate || now <= a.EndDate + day);
  }
  // an undated closure is mapped for a month of its layer's year only
  if (layerYear !== +detroitDate(now).slice(0, 4)) return false;
  const month = MONTHS[+detroitDate(now).slice(4, 6) - 1];
  return String(a.Map || a.DateRange || '').toLowerCase().split(/[^a-z]+/).some((w) => w.startsWith(month));
}

// Today's full closures, each { street, project, dates, lines: [[[x, z], ...], ...] } in the world's metres; null when
// neither the city's map nor the copy could be read
async function loadCityClosures() {
  // the city's map and MDOT's list asked at once, MDOT's waited for no more than 3 s: neither holds the start up long
  const stateAsked = Promise.race([nativeJSON(MIDRIVE).catch(() => null), new Promise((done) => setTimeout(() => done(null), 3000))]);
  const now = Date.now();
  let features = null, live = false, layerYear = SAVED_YEAR;
  try {
    ({ features, year: layerYear } = await fetchLive(+detroitDate(now).slice(0, 4)));
    live = true;
  } catch {
    try {
      const bytes = await asset('data/city-closures.json');
      features = JSON.parse(new TextDecoder().decode(bytes)).features;
    } catch {
      return null;
    }
  }
  const out = [];
  for (const { a, p } of features) {
    if (!onToday(a, now, layerYear)) continue;
    out.push({
      street: a.Street || '', project: a.ProjectName || '', dates: a.DateRange || '',
      lines: p.map((path) => path.map(([lon, lat]) => { const w = toWorld(lat, lon); return [w.x, w.z]; }))
    });
  }
  // Michigan DOT's MiDrive list (only through the app: its server doesn't let a page ask) adds the state's total
  // closures in Washtenaw County, each at the point it's mapped: the road there is shut if it's in the city's streets
  const state = await stateAsked;
  let fromState = 0;
  for (const r of Array.isArray(state) ? state : []) {
    if (r.county !== 'Washtenaw' || !/total closure/i.test(r.description || '')) continue;
    const m = /lat=([\d.-]+)&lon=([\d.-]+)/.exec(r.description);
    const end = /hidden-date'>(\d{8})/.exec(r.endDate || '');
    if (!m || (end && +end[1] < +detroitDate(now))) continue;
    const w = toWorld(+m[1], +m[2]);
    const street = String(r.route || '').replace(/^(NB|SB|EB|WB)\s+/, '');
    out.push({ street, project: 'MDOT', dates: '', point: [w.x, w.z], lines: [] });
    fromState++;
  }
  log(`[road work] the city's closures${live ? '' : ' (saved copy)'}: ${out.length} on today (${new Date(now).toDateString()}) of ${features.length}${state ? `, ${fromState} from MDOT` : ''}`);
  return out;
}

export { loadCityClosures };
