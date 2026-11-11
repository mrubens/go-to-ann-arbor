// Lamp: the Huron River's flow now, from the USGS gauge "Huron River at Ann Arbor" (site 04174500, the US Geological
// Survey's Water Data API, latest-continuous values, a US government work in the public domain; it replaces the old
// waterservices.usgs.gov service, which USGS is shutting down in early 2027), asked for when the city opens and
// every 15 minutes. The kayak's current follows it: faster after rain, lazier when the river is low. Offline, or when
// the service doesn't answer, the river runs at its usual flow.

const SITE = '04174500';
const USUAL_CFS = 500; // about the river's typical flow through town, in cubic feet a second
const USUAL = { cfs: USUAL_CFS, scale: 1, live: false };

// How much faster than usual the water moves for a flow: velocity grows about as the 0.4 power of discharge
function currentScale(cfs) {
  return Math.min(2.4, Math.max(0.45, (cfs / USUAL_CFS) ** 0.4));
}

async function fetchRiverFlow() {
  try {
    const url = `https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items?monitoring_location_id=USGS-${SITE}&parameter_code=00060&f=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return USUAL;
    const cfs = Number((await res.json())?.features?.[0]?.properties?.value);
    if (!Number.isFinite(cfs) || cfs < 0) return USUAL;
    return { cfs, scale: currentScale(cfs), live: true };
  } catch {
    return USUAL;
  }
}

export { fetchRiverFlow, USUAL as USUAL_RIVER_FLOW };
