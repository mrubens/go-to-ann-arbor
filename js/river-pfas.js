// Lamp: PFAS in the Huron, from Michigan EGLE's surface water sampling (MPART, its "Tribar Release Surface Water PFAS
// Sampling Results" layer, public data of the State of Michigan), asked for when the city opens. The reading nearest
// town (Barton Pond, just above Ann Arbor) sets how much foam drifts on the river, against Michigan's surface water
// limit for PFOS (Rule 57, 12 parts per trillion). A result under the lab's detection limit ("<2.0") counts as half
// of it. Offline, the latest reading known when this was written stands in.

const LAYER = 'https://services1.arcgis.com/FNjlrOFR0aGJ71Tg/ArcGIS/rest/services/Tribar_Release_Surface_Water_PFAS_Sampling_Results/FeatureServer/0/query';
const TOWN = { lat: 42.317, lon: -83.779 }; // Barton Pond above Maple Road
const LIMIT_PPT = 12;
const KNOWN = { ppt: 1, site: 'Barton Pond', date: '9/08/2022', detected: false, live: false };

function parsePpt(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const n = parseFloat(s.replace('<', ''));
  if (!Number.isFinite(n)) return null;
  return s.startsWith('<') ? { ppt: n / 2, detected: false } : { ppt: n, detected: true };
}

// How much of the river foams, 0 to 1: a little even at trace levels, all of it at the limit and over
function foamFor(ppt) {
  return Math.min(1, Math.sqrt(Math.max(0, ppt) / LIMIT_PPT));
}

async function fetchRiverPfas() {
  try {
    const q = `${LAYER}?where=1%3D1&outFields=WaterbodyName,Description,Date,PFOS_ngL,Latitude,Longitude&f=json`;
    const res = await fetch(q, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(res.status);
    const rows = ((await res.json())?.features || []).map((f) => f.attributes).filter((a) => a && a.Latitude);
    let best = null;
    for (const a of rows) {
      const r = parsePpt(a.PFOS_ngL);
      const t = Date.parse(a.Date);
      if (!r || !Number.isFinite(t)) continue;
      const d = Math.hypot(a.Latitude - TOWN.lat, (a.Longitude - TOWN.lon) * 0.74);
      // the nearest site, and its latest sample (the highest of that day's)
      if (!best || d < best.d - 1e-4 || (Math.abs(d - best.d) < 1e-4 && (t > best.t || (t === best.t && r.ppt > best.ppt)))) {
        best = { d, t, ppt: r.ppt, detected: r.detected, site: a.WaterbodyName, date: a.Date };
      }
    }
    if (!best) throw new Error('no readings');
    return { ppt: best.ppt, site: best.site, date: best.date, detected: best.detected, live: true, foam: foamFor(best.ppt) };
  } catch {
    return { ...KNOWN, foam: foamFor(KNOWN.ppt) };
  }
}

export { fetchRiverPfas, LIMIT_PPT };
