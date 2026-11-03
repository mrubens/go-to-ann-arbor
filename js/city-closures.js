import { asset, log } from '../lamp-game.js';
import { toWorld, nativeJSON } from './live-feeds.js';

// Lamp: Ann Arbor's real road work. The city's "Downtown Street Closures" layer (its construction-season map, public
// on ArcGIS Online) lists each full road closure with its street, project and dates; the ones on today, by Ann Arbor's
// calendar, are the blocks road-work.js shuts. Asked for as the city opens; offline, the copy in data/city-closures.json
// (taken when this was written) stands in, its dates still deciding what's on. A closure with no dates counts while
// the month it's mapped for is on.

const LAYER = 'https://services2.arcgis.com/cenCPuKxOZuq6BCE/arcgis/rest/services/Downtown_Street_Closures_2026/FeatureServer/0/query';
const MIDRIVE = 'https://mdotjboss.state.mi.us/MiDrive/construction/list/loadConstruction';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

async function fetchLive() {
  const q = `${LAYER}?where=Type%3D%27Road%20Closure%27&outFields=OBJECTID,Street,ProjectName,DateRange,StartDate,EndDate,Map&outSR=4326&geometryPrecision=6&f=json`;
  const res = await fetch(q, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(res.status);
  const d = await res.json();
  if (!Array.isArray(d?.features)) throw new Error('no features');
  return d.features.filter((f) => f.geometry?.paths).map((f) => ({ a: f.attributes, p: f.geometry.paths }));
}

function onToday(a, now) {
  const day = 864e5;
  if (a.StartDate || a.EndDate) {
    return (!a.StartDate || a.StartDate <= now + day) && (!a.EndDate || now <= a.EndDate + day);
  }
  const month = MONTHS[new Date(now).getMonth()];
  return String(a.Map || a.DateRange || '').toLowerCase().split(/[^a-z]+/).some((w) => w.startsWith(month));
}

// Today's full closures, each { street, project, dates, lines: [[[x, z], ...], ...] } in the world's metres; null when
// neither the city's map nor the copy could be read
async function loadCityClosures() {
  let features = null, live = false;
  try {
    features = await fetchLive();
    live = true;
  } catch {
    try {
      const bytes = await asset('data/city-closures.json');
      features = JSON.parse(new TextDecoder().decode(bytes)).features;
    } catch {
      return null;
    }
  }
  const now = Date.now();
  const out = [];
  for (const { a, p } of features) {
    if (!onToday(a, now)) continue;
    out.push({
      street: a.Street || '', project: a.ProjectName || '', dates: a.DateRange || '',
      lines: p.map((path) => path.map(([lon, lat]) => { const w = toWorld(lat, lon); return [w.x, w.z]; }))
    });
  }
  // Michigan DOT's MiDrive list (only through the app: its server doesn't let a page ask) adds the state's total
  // closures in Washtenaw County, each at the point it's mapped: the road there is shut if it's in the city's streets
  const state = await nativeJSON(MIDRIVE);
  let fromState = 0;
  for (const r of Array.isArray(state) ? state : []) {
    if (r.county !== 'Washtenaw' || !/total closure/i.test(r.description || '')) continue;
    const m = /lat=([\d.-]+)&lon=([\d.-]+)/.exec(r.description);
    const end = /hidden-date'>(\d{8})/.exec(r.endDate || '');
    if (!m || (end && +end[1] < +new Date(now).toISOString().slice(0, 10).replace(/-/g, ''))) continue;
    const w = toWorld(+m[1], +m[2]);
    const street = String(r.route || '').replace(/^(NB|SB|EB|WB)\s+/, '');
    out.push({ street, project: 'MDOT', dates: '', point: [w.x, w.z], lines: [] });
    fromState++;
  }
  log(`[road work] the city's closures${live ? '' : ' (saved copy)'}: ${out.length} on today (${new Date(now).toDateString()}) of ${features.length}${state ? `, ${fromState} from MDOT` : ''}`);
  return out;
}

export { loadCityClosures };
