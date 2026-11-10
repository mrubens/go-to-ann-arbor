// Lamp: the live public feeds whose servers don't let a page ask them directly (TheRide's bus positions, OpenSky's
// aircraft, Spin's scooters, MDOT's highway work): the app around the page fetches them (Native.swift "feed", only
// those hosts) and hands back the bytes. In Lamp's preview, and anywhere without the app, there is no live feed:
// each caller keeps to its timetable or its last known data.

const liveFeedsAvailable = () => !!window.LampNative?.available;

async function nativeFeed(url) {
  if (!liveFeedsAvailable()) return null;
  try {
    const b64 = await window.LampNative.call('feed', { url });
    if (typeof b64 !== 'string') return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function nativeJSON(url) {
  const bytes = await nativeFeed(url);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// ---- GTFS-realtime vehicle positions (protocol buffers, read by hand: only the fields used) --------------------------
// FeedMessage { 1 header { 3 timestamp }, 2 entity* { 4 vehicle { 1 trip { 1 trip_id, 5 route_id }, 2 position {
// 1 latitude f32, 2 longitude f32, 3 bearing f32, 5 speed f32 }, 5 timestamp, 8 vehicle { 1 id, 2 label } } } }
function readPb(bytes, start, end, onField) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = start;
  const varint = () => {
    let v = 0, mul = 1, b;
    do {
      b = bytes[i++];
      v += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80 && i < end);
    return v;
  };
  while (i < end) {
    const key = varint();
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) onField(field, 'int', varint());
    else if (wire === 1) { if (i + 8 > end) break; onField(field, 'f64', view.getFloat64(i, true)); i += 8; }
    else if (wire === 2) { const n = varint(); if (i + n > end) break; onField(field, 'bytes', i, i + n); i += n; }
    else if (wire === 5) { if (i + 4 > end) break; onField(field, 'f32', view.getFloat32(i, true)); i += 4; }
    else break;
  }
}
const pbString = (bytes, a, b) => new TextDecoder().decode(bytes.subarray(a, b));

function decodeVehiclePositions(bytes) {
  const out = [];
  let feedTime = 0;
  readPb(bytes, 0, bytes.length, (f, t, a, b) => {
    if (f === 1 && t === 'bytes') readPb(bytes, a, b, (g, u, v) => { if (g === 3 && u === 'int') feedTime = v; });
    if (f !== 2 || t !== 'bytes') return;
    readPb(bytes, a, b, (g, u, c, d) => {
      if (g !== 4 || u !== 'bytes') return;
      const veh = { trip: '', route: '', lat: NaN, lon: NaN, bearing: NaN, speed: NaN, time: 0, id: '' };
      readPb(bytes, c, d, (h, w, x, y) => {
        if (h === 1 && w === 'bytes') readPb(bytes, x, y, (k, z, p, q) => {
          if (k === 1 && z === 'bytes') veh.trip = pbString(bytes, p, q);
          if (k === 5 && z === 'bytes') veh.route = pbString(bytes, p, q);
        });
        else if (h === 2 && w === 'bytes') readPb(bytes, x, y, (k, z, p) => {
          if (k === 1) veh.lat = p;
          else if (k === 2) veh.lon = p;
          else if (k === 3) veh.bearing = p;
          else if (k === 5) veh.speed = p;
        });
        else if (h === 5 && w === 'int') veh.time = x;
        else if (h === 8 && w === 'bytes') readPb(bytes, x, y, (k, z, p, q) => { if (k === 1 && z === 'bytes') veh.id = pbString(bytes, p, q); });
      });
      if (Number.isFinite(veh.lat)) out.push(veh);
    });
  });
  return { time: feedTime, vehicles: out };
}

// ---- Latitude and longitude in the world frame (as build-annarbor.py: 1 unit = 1 m, x east, z south) -----------------
const LAT0 = 42.27965, LON0 = -83.74838;
const A = 6378137.0, E2 = 0.00669437999014;
const PHI = LAT0 * Math.PI / 180;
const KX = Math.PI / 180 * A / Math.sqrt(1 - E2 * Math.sin(PHI) ** 2) * Math.cos(PHI);
const KY = Math.PI / 180 * A * (1 - E2) / (1 - E2 * Math.sin(PHI) ** 2) ** 1.5;
const toWorld = (lat, lon) => ({ x: (lon - LON0) * KX, z: -(lat - LAT0) * KY });
const toLatLon = (x, z) => ({ lat: LAT0 - z / KY, lon: LON0 + x / KX });

export { liveFeedsAvailable, nativeFeed, nativeJSON, decodeVehiclePositions, toWorld, toLatLon };
