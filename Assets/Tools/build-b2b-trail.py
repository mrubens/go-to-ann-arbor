# The Border to Border Trail (Washtenaw County's paved shared-use path along the Huron), in the game's frame (metres
# east and south of Main St & Liberty St), written to Web/js/b2b-data.js for b2b-trail.js:
#   B2B_WAYS   [[flags, width, x, z, x, z, ...], ...]  each OpenStreetMap (ODbL) way of the route relation "Border to
#              Border Trail" (relation 38467, ref B2B) in the town's box, its points thinned to one every 1.5 m or more
#              (bends, and the points two ways share, kept), flags: 1 its own path (not a street), 2 a boardwalk,
#              4 a bridge, 8 lit, 16 asphalt, 32 concrete, 64 wood or metal deck; width in metres (OSM's, else 3 m:
#              the trail's ten feet; 0 on a street)
#   B2B_PLACES [[name, x, z], ...]  the places along it the wayfinding signs give the way and distance to: the point
#              of the trail nearest each (a park's nearest edge, from osm.json's parks; the Argo Cascades and the
#              Gallup livery from the game's own landmarks)
# The way's tread itself is drawn already (GEO.trails, golf.js buildTrails; footbridges river.js): this is what makes it
# the B2B (the map's line and name, its centre line and signs, its riders and runners, the place label).
# Input: .lamp/reference/aa/ovp/b2b.json (Overpass: rel(38467); out body; way(r); out tags geom;) and osm.json
# Run: python3 -I Assets/Tools/build-b2b-trail.py <app folder holding .lamp>  (writes beside this script's Web/)
import json, math, os, sys
from collections import Counter

ROOT = sys.argv[1]
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)
S, W, N, E = 42.21250, -83.80706, 42.32916, -83.66934  # osm.json's box (fetch-annarbor.py)
PATHS = ('cycleway', 'footway', 'path', 'pedestrian', 'bridleway')
REF = os.path.join(ROOT, '.lamp/reference/aa')

def metres(v):
    try:
        v = str(v).strip().lower()
        if v.endswith("'") or v.endswith('ft'):
            return float(v.rstrip("'ft ")) * 0.3048
        return float(v.rstrip('m '))
    except ValueError:
        return None

els = json.load(open(os.path.join(REF, 'ovp/b2b.json')))['elements']
raw = []
for e in els:
    if e['type'] != 'way' or len(e.get('geometry') or []) < 2:
        continue
    g = [q for q in e['geometry'] if S - 0.002 < q['lat'] < N + 0.002 and W - 0.003 < q['lon'] < E + 0.003]
    if len(g) >= 2:
        raw.append((e.get('tags', {}), [xz(q['lon'], q['lat']) for q in g]))
# the points more than one way passes through (their ends and the junctions on them): always kept
shared = Counter(p for _, pts in raw for p in set(pts))

def thin(pts, step=1.5):
    keep = [pts[0]]
    for i in range(1, len(pts) - 1):
        p, q, a = pts[i], pts[i + 1], keep[-1]
        h1 = math.atan2(p[1] - a[1], p[0] - a[0]); h2 = math.atan2(q[1] - p[1], q[0] - p[0])
        turn = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        if shared[p] > 1 or math.hypot(p[0] - a[0], p[1] - a[1]) >= step or turn > 0.14:
            keep.append(p)
    keep.append(pts[-1])
    return keep

ways, total, own = [], 0, 0
for t, pts in raw:
    hw, surf = t.get('highway', ''), t.get('surface', '')
    path = hw in PATHS
    flags = (1 if path else 0) | (2 if t.get('bridge') == 'boardwalk' else 0) | (4 if t.get('bridge') in ('yes', 'viaduct') else 0)
    flags |= 8 if t.get('lit') == 'yes' else 0
    flags |= 16 if surf in ('asphalt', 'paved', '') and path else 32 if surf.startswith('concrete') else 64 if surf in ('wood', 'metal') else 0
    w = round(max(2.4, min(4, metres(t.get('width')) or 3.0)), 2) if path else 0
    pts = thin(pts)
    L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    total += L; own += L if path else 0
    ways.append([flags, w] + [round(v, 2) for p in pts for v in p])

# the places along it, each at the trail's point nearest it
trail = [(w[i], w[i + 1]) for w in ways for i in range(2, len(w), 2)]
def nearest(cands):
    best = None
    for x, z in cands:
        for px, pz in trail:
            d = (px - x) ** 2 + (pz - z) ** 2
            if best is None or d < best[0]:
                best = (d, px, pz)
    return best
PARKS = {'Delhi Metropark': 'Delhi Metropark', 'Barton Nature Area': 'Barton Nature Area', 'Bandemer Park': 'Bandemer Park',
         'Broadway Park': 'Broadway Park', 'Riverside Park': 'Riverside Park', 'Nichols Arboretum': 'Nichols Arboretum',
         'Furstenberg Nature Area': 'Furstenberg Park', 'Parker Mill County Park': 'Parker Mill'}
places = [['Argo Cascades', 419, -1228], ['Gallup Park', 3962, 316]]
for e in json.load(open(os.path.join(REF, 'osm.json')))['elements']:
    t = e.get('tags', {})
    if t.get('name') in PARKS and (t.get('leisure') in ('park', 'nature_reserve') or t.get('boundary') == 'protected_area'):
        g = e.get('geometry') or [m for mm in e.get('members', []) for m in (mm.get('geometry') or [])]
        if g:
            places.append([PARKS.pop(t['name']), *[round(v, 1) for v in nearest([xz(q['lon'], q['lat']) for q in g])[1:]]])
for p in places[:2]:
    p[1:] = [round(v, 1) for v in nearest([(p[1], p[2])])[1:]]

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../Web/js/b2b-data.js')
with open(out, 'w') as f:
    f.write('// js/b2b-data.js: GENERATED by Assets/Tools/build-b2b-trail.py, do not edit by hand.\n')
    f.write('// The Border to Border Trail in the game\'s frame: © OpenStreetMap contributors (ODbL), route relation 38467.\n')
    f.write('// B2B_WAYS [flags (1 own path, 2 boardwalk, 4 bridge, 8 lit, 16 asphalt, 32 concrete, 64 deck), width, x, z, ...]\n')
    f.write('// B2B_PLACES [name, x, z]: the places its signs point to, at the trail\'s point nearest each\n')
    f.write('export const B2B_WAYS = ' + json.dumps(ways, separators=(',', ':')) + ';\n')
    f.write('export const B2B_PLACES = ' + json.dumps(places, separators=(',', ':')) + ';\n')
print(f'{len(ways)} ways, {total / 1000:.1f} km ({own / 1000:.1f} km its own path), {len(places)} places, {os.path.getsize(out)} bytes')
print(places)
