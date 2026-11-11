# The streets OpenStreetMap (ODbL) says are not asphalt, in the game's frame (metres east and south of Main St &
# Liberty St), written to Web/data/road-surfaces.json for road-feel.js:
#   streets  [[kind, x, z, x, z, ...], ...]   kind 1: brick or pavers (surface=bricks, brick, sett, paving_stones,
#            cobblestone, unhewn_cobblestone: Detroit St by Kerrytown, N Fourth Ave by the Farmers Market, N Fifth Ave,
#            Depot St and N State St by the station); kind 2: gravel or dirt (gravel, fine_gravel, compacted, unpaved,
#            dirt, ground: the town's few unpaved lanes and lots); points thinned to one every 2 m or more
# Only the blocks OSM tags are listed; every other street stays plain asphalt.
# Input: .lamp/reference/aa/ovp/road-surfaces.json (Overpass: way[highway~primary|secondary|tertiary|unclassified|
#        residential|living_street|service|*_link][surface~those above](42.22,-83.82,42.33,-83.65); out tags geom).
# Run: python3 -I Assets/Tools/build-road-surfaces.py <app folder>
import json, math, os, sys

ROOT = sys.argv[1]
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)
BRICK = ('bricks', 'brick', 'sett', 'paving_stones', 'cobblestone', 'unhewn_cobblestone')
LOOSE = ('gravel', 'fine_gravel', 'compacted', 'unpaved', 'dirt', 'ground')

streets, seen, count = [], set(), {1: 0, 2: 0}
for e in json.load(open(os.path.join(ROOT, '.lamp/reference/aa/ovp/road-surfaces.json')))['elements']:
    t = e.get('tags', {})
    if e['type'] != 'way' or e['id'] in seen or len(e.get('geometry') or []) < 2:
        continue
    kind = 1 if t.get('surface') in BRICK else 2 if t.get('surface') in LOOSE else 0
    if not kind:
        continue
    seen.add(e['id'])
    pts = [xz(q['lon'], q['lat']) for q in e['geometry']]
    keep = [pts[0]]
    for p in pts[1:-1]:
        if math.hypot(p[0] - keep[-1][0], p[1] - keep[-1][1]) >= 2:
            keep.append(p)
    keep.append(pts[-1])
    count[kind] += 1
    streets.append([kind] + [round(v, 1) for p in keep for v in p])

path = os.path.join(ROOT, 'Web/data/road-surfaces.json')
json.dump({'source': 'OpenStreetMap contributors (ODbL), surface tags on Ann Arbor streets', 'streets': streets},
          open(path, 'w'), separators=(',', ':'))
print(f'{count[1]} brick or paver streets, {count[2]} gravel or dirt ones -> {path} ({os.path.getsize(path)} bytes)')
