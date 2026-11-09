# Builds three of the City of Ann Arbor's open data sets into the game, in the world frame (1 unit = 1 m, x east,
# z south, origin at Main St & Liberty St):
#   Web/data/speed-humps.json   the speed humps and speed tables of the Traffic Calming program's built projects, as
#                               [x, z, ux, uz, kind] (a point on the street, the street's direction there, 0 a hump or
#                               1 a table). A project says how many it built ("two speed humps and one speed table");
#                               where it doesn't, one every ~120 m. Spaced evenly along its street.
#   Web/data/collection-days.json  the trash and recycling pickup day zones, as rings of x, z by weekday (1 Monday).
#   Web/js/champion-trees.js    the city's champion trees: kind, address, height, crown spread, trunk.
# Reads what Lamp downloaded into .lamp/reference/aa/newdata/ (calming.geojson from the Traffic Calming
# FeatureServer, routes.geojson from CollectionRoutes/FeatureServer/27, champ-webmap.json from the Champion Trees
# web map 433acf4ca81a4230a6653a6158e2a8bd).
# Run: python3 -I Assets/Tools/build-humps-carts-champions.py <app folder>
import json, math, os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
SRC = os.path.join(ROOT, '.lamp/reference/aa/newdata')
LAT0, LON0, KX, KY = 42.27965, -83.74838, 82487.0165, 111078.7167
xy = lambda lon, lat: ((lon - LON0) * KX, (LAT0 - lat) * KY)

# ---- speed humps
WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8}
calming = json.load(open(os.path.join(SRC, 'calming.geojson')))
humps, projects = [], 0
for f in calming['features']:
    p = f['properties']
    if p.get('Status') != 'Constructed' or not f.get('geometry'):
        continue
    text = ' '.join(re.sub('<[^>]+>', ' ', p.get('PopupInfo') or '').split()).lower()
    # what the last installation note says it built
    last = text.split('installed')[-1] if 'installed' in text else text
    n_hump = n_table = 0
    for num, what in re.findall(r'(\d+|one|two|three|four|five|six|seven|eight)\s+speed\s+(hump|table)', last):
        k = int(num) if num.isdigit() else WORDS[num]
        if what == 'hump': n_hump += k
        else: n_table += k
    g = f['geometry']
    lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    pts = [[xy(*c[:2]) for c in line] for line in lines]
    segs = [(a, b, math.dist(a, b)) for line in pts for a, b in zip(line, line[1:]) if math.dist(a, b) > 0.5]
    total = sum(s[2] for s in segs)
    if not segs or total < 40:
        continue
    if not n_hump and not n_table:
        # "speed humps", or nothing said but that it was installed: humps along it; only raised crossings: none here
        if 'speed hump' in last or not re.search(r'raised|circle|island|narrowing|bump', last):
            n_hump = max(2, round(total / 120))
        else:
            continue
    # tables and humps alternated along the street, evenly spaced, kept off its ends where it's long enough
    kinds = [k for i in range(max(n_hump, n_table)) for k in ([0] if i < n_hump else []) + ([1] if i < n_table else [])]
    n = len(kinds)
    margin = min(25, total / (2 * n))
    for i, kind in enumerate(kinds):
        at = margin + (total - 2 * margin) * (i + 0.5) / n
        for a, b, L in segs:
            if at <= L:
                t = at / L
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                humps += [round(x, 1), round(z, 1), round(ux, 3), round(uz, 3), kind]
                break
            at -= L
    projects += 1
json.dump({'humps': humps}, open(os.path.join(ROOT, 'Web/data/speed-humps.json'), 'w'), separators=(',', ':'))
print(f'{projects} built projects, {len(humps) // 5} humps and tables')

# ---- pickup days
DAYS = {'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5}
routes = json.load(open(os.path.join(SRC, 'routes.geojson')))
zones = {}
for f in routes['features']:
    day = DAYS.get(str(f['properties'].get('RefuseDay') or '').strip().lower())
    g = f.get('geometry')
    if not day or not g:
        continue
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        for ring in poly:
            out, last = [], None
            for c in ring:
                p = tuple(round(v) for v in xy(*c[:2]))
                if last is None or math.dist(p, last) >= 4:
                    out += list(p)
                    last = p
            if len(out) >= 6:
                zones.setdefault(str(day), []).append(out)
json.dump({'zones': zones}, open(os.path.join(ROOT, 'Web/data/collection-days.json'), 'w'), separators=(',', ':'))
print('pickup zones:', {d: sum(len(r) // 2 for r in rs) for d, rs in zones.items()}, 'points')

# ---- champion trees
# the game's tree shapes (trees.js): 0 plane, 1 locust, 2 elm, 3 maple, 4 oak, 5 small flowering, 6 evergreen
SHAPES = [
    (6, r'spruce|fir\b|pine|tamarack|redwood'),
    (5, r'crabapple|redbud|weeping cherry|paperbark'),
    (2, r'elm|zelkova'),
    (1, r'locust|coffeetree|corktree'),
    (0, r'sycamore|sweetgum|tulip|cottonwood|gingko|ginkgo'),
    (4, r'oak|hickory|walnut|butternut|osage|mulberry|persimmon'),
    (3, r'.'),
]
web = json.load(open(os.path.join(SRC, 'champ-webmap.json')))
feats = web['operationalLayers'][0]['featureCollection']['layers'][0]['featureSet']['features']
FT = 0.3048
trees = []
for f in feats:
    a = f['attributes']
    name = ' '.join(re.sub('<[^>]+>', ' ', a['name']).split())
    common, _, latin = name.partition(' - ')
    common = common.replace('Popular', 'Poplar').replace('Gingko', 'Ginkgo').strip()
    d = a['description']
    num = lambda k: float(m.group(1)) if (m := re.search(k + r':\s*([\d.]+)', d)) else 0
    addr = (m.group(1).strip() if (m := re.search(r'<b>(.*?)</b>', d)) else '')
    since = int(num('Champion Since')) or None
    x, z = xy(a['long'], a['lat'])
    shape = next(s for s, rx in SHAPES if re.search(rx, common.lower()))
    trees.append({
        'name': common, 'latin': latin.strip(), 'address': addr, 'x': round(x, 1), 'z': round(z, 1), 'shape': shape,
        'height': round(num('Height') * FT, 1), 'spread': round(num('Crown Spread') * FT, 1),
        # the trunk's width at chest height, from its girth
        'trunk': round(num('Circumference') * 0.0254 / math.pi, 2), 'since': since
    })
trees.sort(key=lambda t: t['name'])
with open(os.path.join(ROOT, 'Web/js/champion-trees.js'), 'w') as out:
    out.write('// The City of Ann Arbor\'s champion trees: the biggest of each kind in the city, measured by its forestry staff\n'
              '// (the Champion Trees map, a2gov.org). Written by Assets/Tools/build-humps-carts-champions.py: x, z in the world\n'
              '// frame, height, crown spread and trunk width in metres, and `shape`, the game\'s tree it grows as (trees.js).\n'
              'export const CHAMPION_TREES = [\n')
    for t in trees:
        out.write('  ' + json.dumps(t, separators=(', ', ': ')) + ',\n')
    out.write('];\n')
print(f'{len(trees)} champion trees')
