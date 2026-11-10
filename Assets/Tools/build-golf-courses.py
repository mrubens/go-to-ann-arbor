# Every other course's numbered holes, in the game's frame (metres east and south of Main St & Liberty St),
# written to Web/js/golf-courses.js for golf-play.js: which hole is which, so a round goes 1, 2, 3... on one course.
#   GOLF_COURSES  [{ name, holes: [{ ref, par, line: flat [x, z, ...] }] }]   OpenStreetMap's golf=hole ways (ODbL),
#   each from its tee to its green, given to the leisure=golf_course whose outline holds the hole's middle.
# Huron Hills is golf-holes.js's (build-golf-holes.py), so it's left out here, and so is disc golf, and any course
# mostly past the town's playable edge (GEO.edge in Web/js/city-geodata.js), where the player can't go.
# Input: .lamp/reference/aa/osm.json (fetch-annarbor.py's Overpass download, with way[golf] and the courses).
# Run: python -I Assets/Tools/build-golf-courses.py <app folder>
import json, math, os, sys

ROOT = sys.argv[1]
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)

els = json.load(open(os.path.join(ROOT, '.lamp/reference/aa/osm.json')))['elements']


def outline(e):
    """The course's outer edges as segments in the game's frame (a relation's outer ways needn't be joined)."""
    ways = [e.get('geometry') or []] if e['type'] == 'way' else [m.get('geometry') or [] for m in e.get('members', []) if m.get('role') == 'outer']
    segs = []
    for g in ways:
        pts = [xz(p['lon'], p['lat']) for p in g]
        segs += list(zip(pts, pts[1:]))
    return segs


def inside(segs, x, z):
    hit = False
    for (x0, z0), (x1, z1) in segs:
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            hit = not hit
    return hit


def near(segs, x, z, r):
    for (x0, z0), (x1, z1) in segs:
        dx, dz = x1 - x0, z1 - z0
        t = max(0, min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz or 1)))
        if math.hypot(x0 + dx * t - x, z0 + dz * t - z) < r:
            return True
    return False


courses = []
for e in els:
    t = e.get('tags', {})
    name = t.get('name') or ''
    if t.get('leisure') != 'golf_course' or 'Huron Hills' in name or 'Disc' in name:
        continue
    courses.append({'name': name, 'segs': outline(e), 'holes': []})

for e in els:
    t = e.get('tags', {})
    if e['type'] != 'way' or t.get('golf') != 'hole':
        continue
    line = []
    for p in e.get('geometry') or []:
        x, z = xz(p['lon'], p['lat'])
        line += [round(x, 1), round(z, 1)]
    if len(line) < 4:
        continue
    mx, mz = line[len(line) // 4 * 2], line[len(line) // 4 * 2 + 1]
    c = next((c for c in courses if inside(c['segs'], mx, mz)), None) or next((c for c in courses if near(c['segs'], mx, mz, 50)), None)
    if not c:
        continue
    c['holes'].append({'ref': t.get('ref'), 'par': int(t['par']) if t.get('par', '').isdigit() else None, 'line': line})

# the town's playable edge (GEO.edge in city-geodata.js): a course whose tees are mostly past it can't be reached
geo = open(os.path.join(ROOT, 'Web/js/city-geodata.js')).read()
geo = json.loads(geo[geo.index('{', geo.index('GEO')):geo.rindex('}') + 1])
EDGE = list(zip(geo['edge'][0::2], geo['edge'][1::2]))
EDGE = list(zip(EDGE, EDGE[1:] + EDGE[:1]))

out = []
for c in courses:
    if not c['holes']:
        continue
    if sum(inside(EDGE, h['line'][0], h['line'][1]) for h in c['holes']) * 2 < len(c['holes']):
        print(c['name'], 'is past the edge of the map: left out')
        continue
    c['holes'].sort(key=lambda h: int(h['ref']) if (h['ref'] or '').isdigit() else 99)
    out.append({'name': c['name'], 'holes': c['holes']})
    print(c['name'], len(c['holes']), [h['ref'] for h in c['holes']])
path = os.path.join(ROOT, 'Web/js/golf-courses.js')
with open(path, 'w') as f:
    f.write('// Lamp: written by Assets/Tools/build-golf-courses.py from OpenStreetMap (ODbL): every course\'s numbered holes but\n')
    f.write('// Huron Hills\' (golf-holes.js), each a line from its tee to its green in the game\'s frame (metres east and south of Main & Liberty)\n')
    f.write('export const GOLF_COURSES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print(sum(len(c['holes']) for c in out), 'holes ->', path)
