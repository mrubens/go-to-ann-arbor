"""The freeways' grade separations: every place a street crosses a freeway (US-23, I-94, M-14 and their business
loops where they're motorways or trunks) with no junction between them, one of the two on a bridge (OpenStreetMap's
bridge=yes, or the higher layer), in town. Written to Web/js/overpass-data.js for terrain.js, which raises the bridge's
deck over the road under it (streetDeck), river.js, which draws it, road-paint.js, which paints its lanes on the deck,
and city-grid.js, which leaves the bridge's street off the ground under it.

Run from the app folder with the reference venv's Python:
    .lamp/reference/venv/bin/python -I Assets/Tools/build-overpasses.py .
It reads .lamp/reference/aa/osm.json (fetch-annarbor.py) and Web/js/city-geodata.js (build-annarbor.py: the town's
outline and its roads, whose widths and names the bridges take).
"""
import json, math, os, sys
from shapely.geometry import LineString, Point, Polygon
from shapely.strtree import STRtree

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
REF = os.path.join(ROOT, '.lamp/reference/aa')

# the world frame (build-annarbor.py): metres east (x) and south (z) of Main St & Liberty St
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5


def xz(lon, lat):
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)


src = open(os.path.join(ROOT, 'Web/js/city-geodata.js')).read()
GEO = json.loads(src[src.index('export const GEO = ') + len('export const GEO = '):].rstrip().rstrip(';'))
e = GEO['edge']
TOWN = Polygon([(e[i], e[i + 1]) for i in range(0, len(e), 2)]).buffer(0)
ROADS = [(r[0], r[1], LineString([(r[-1][i], r[-1][i + 1]) for i in range(0, len(r[-1]), 2)])) for r in GEO['roads'] if len(r[-1]) >= 4]
road_tree = STRtree([g for _, _, g in ROADS])
RIVER = [LineString([(b[i], b[i + 1]) for i in range(2, len(b), 2)]) for b in GEO['riverBridges'] if b[0] == 0]

DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'service'}
FREEWAY = {'motorway', 'trunk'}
ways = [w for w in json.load(open(os.path.join(REF, 'osm.json')))['elements']
        if w['type'] == 'way' and 'geometry' in w and w.get('tags', {}).get('highway') in DRIVE
        and w['tags'].get('area') != 'yes' and w['tags'].get('tunnel') != 'yes']
line = {w['id']: LineString([xz(p['lon'], p['lat']) for p in w['geometry'] if p]) for w in ways}


def layer(w):
    try:
        return int(w['tags'].get('layer', '0'))
    except ValueError:
        return 0


def sidewalks(w):
    """Its sidewalks on the bridge, by OpenStreetMap's sidewalk tags: 1 on the way's right, 2 on its left (3 both). A
    freeway has none; a street none where the map says so ('no'), else both (a 'separate' one runs beside it)"""
    t = w['tags']
    if t['highway'] in FREEWAY:
        return 0
    side = {'both': 3, 'right': 1, 'left': 2, 'no': 0, 'none': 0, 'separate': 3}
    if 'sidewalk' in t:
        return side.get(t['sidewalk'], 3)
    if 'sidewalk:both' in t:
        return 0 if t['sidewalk:both'] in ('no', 'none') else 3
    if 'sidewalk:left' in t or 'sidewalk:right' in t:
        return (0 if t.get('sidewalk:right', 'no') in ('no', 'none') else 1) | (0 if t.get('sidewalk:left', 'no') in ('no', 'none') else 2)
    return 3


def game_road(g):
    """The road in GEO.roads drawn along way g (the same line: within a metre of its middle, running along it)"""
    mid = g.interpolate(0.5, normalized=True)
    a, b = g.interpolate(0.45, normalized=True), g.interpolate(0.55, normalized=True)
    tl = math.hypot(b.x - a.x, b.y - a.y) or 1
    tx, tz = (b.x - a.x) / tl, (b.y - a.y) / tl
    best, bd = None, 1.5
    for i in road_tree.query(mid.buffer(2)):
        name, w, r = ROADS[i]
        d = r.distance(mid)
        if d >= bd:
            continue
        s = r.project(mid)
        p, q = r.interpolate(max(0, s - 2)), r.interpolate(min(r.length, s + 2))
        ql = math.hypot(q.x - p.x, q.y - p.y) or 1
        if abs((q.x - p.x) * tx + (q.y - p.y) * tz) / ql < 0.9:
            continue
        best, bd = (name, w), d
    return best


# the road graph's links (unnamed ramps too, which GEO.roads leaves out): [name, width, line]
RG = GEO['roadGraph']
LINKS = []
for l in RG['links']:
    a, b, ni, wd, inner = l[0], l[1], l[2], l[3], l[6]
    pts = [(RG['nodes'][a * 2], RG['nodes'][a * 2 + 1])] + [(inner[i], inner[i + 1]) for i in range(0, len(inner), 2)] + [(RG['nodes'][b * 2], RG['nodes'][b * 2 + 1])]
    LINKS.append((RG['names'][ni], wd, LineString(pts)))
link_tree = STRtree([g for _, _, g in LINKS])


def game_link(g):
    """The road graph's link drawn along way g, for a ramp GEO.roads has no name for"""
    mid = g.interpolate(0.5, normalized=True)
    best, bd = None, 1.5
    for i in link_tree.query(mid.buffer(2)):
        name, w, r = LINKS[i]
        d = r.distance(mid)
        if d < bd:
            best, bd = (name, w), d
    return best


fw = [w for w in ways if w['tags']['highway'] in FREEWAY]
tree = STRtree([line[w['id']] for w in fw])
bridges = {}  # the bridge way's id -> its entry
for w in ways:
    lw = line[w['id']]
    for i in tree.query(lw):
        f = fw[i]
        # (two freeways crossing, US-23 over I-94: each pair once)
        if w['tags']['highway'] in FREEWAY and f['id'] >= w['id']:
            continue
        lf = line[f['id']]
        if set(f['nodes']) & set(w['nodes']) or not lf.crosses(lw):
            continue
        cross = lf.intersection(lw)
        for p in getattr(cross, 'geoms', [cross]):
            # (in town, or out where the map's data carries the freeways on: both roads in the game's, below)
            if not TOWN.buffer(5).contains(p) and not (game_road(lf) or game_link(lf)):
                continue
            # the one on the bridge, or the higher layer, goes over
            fb, wb = f['tags'].get('bridge') not in (None, 'no'), w['tags'].get('bridge') not in (None, 'no')
            if fb != wb:
                up, down = (f, w) if fb else (w, f)
            elif layer(f) != layer(w):
                up, down = (f, w) if layer(f) > layer(w) else (w, f)
            else:
                print(f'  at grade? {f["tags"].get("ref")} x {w["tags"].get("name")} at {p.x:.0f}, {p.y:.0f}')
                continue
            lu = line[up['id']]
            if up['tags'].get('bridge') in (None, 'no'):
                print(f'  {up["tags"].get("name") or up["tags"].get("ref")} over at {p.x:.0f}, {p.y:.0f} has no bridge way: left out')
                continue
            # (already a river bridge: GEO.riverBridges)
            if any(r.distance(lu.interpolate(0.5, normalized=True)) < 1 for r in RIVER):
                continue
            under = game_road(line[down['id']]) or game_link(line[down['id']])
            road = game_road(lu) or (game_link(lu) if up['tags']['highway'].endswith('_link') else None)
            if not road or not under:
                print(f'  {up["tags"].get("name") or up["tags"].get("ref")} over {down["tags"].get("name") or down["tags"].get("ref")} at {p.x:.0f}, {p.y:.0f}: not both in the game\'s roads, left out')
                continue
            b = bridges.setdefault(up['id'], {'name': road[0], 'w': road[1], 'fw': 1 if up['tags']['highway'] in FREEWAY else 0,
                                              'sw': sidewalks(up), 'layer': max(1, layer(up)), 'over': [], 'at': [],
                                              'pts': [round(v, 1) for c in lu.coords for v in c]})
            if under[0] not in b['over']:
                b['over'].append(under[0])
            b['at'].append([round(p.x), round(p.y)])

out = sorted(bridges.values(), key=lambda b: (b['at'][0][0], b['at'][0][1]))
print(f'{len(out)} bridges at the freeways\' grade separations:')
for b in out:
    print(f'  {b["name"]} over {", ".join(b["over"])} at {b["at"][0][0]}, {b["at"][0][1]} ({b["w"]} m wide)')
with open(os.path.join(ROOT, 'Web/js/overpass-data.js'), 'w') as f:
    f.write('// js/overpass-data.js — GENERATED by Assets/Tools/build-overpasses.py, do not edit by hand.\n'
            '// The bridges where a street and a freeway cross with no junction (© OpenStreetMap contributors, ODbL):\n'
            '// { name (the road on the bridge, as GEO.roads names it), w (its width), fw (1: a freeway carriageway),\n'
            '//   sw (its sidewalks: 1 on the right of the way as its points run, 2 on the left), over (the roads under it),\n'
            '//   layer (OSM\'s: a higher one built over a lower), at (where they cross), pts (the bridge way, flat x, z) }\n'
            'export const OVERPASSES = [\n')
    f.write(',\n'.join('  ' + json.dumps(b, separators=(',', ':')) for b in out))
    f.write('\n];\n')
