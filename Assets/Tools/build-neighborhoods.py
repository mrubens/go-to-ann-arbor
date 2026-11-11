# Ann Arbor's neighbourhoods, in the game's frame (metres east and south of Main St & Liberty St), written to
# Web/data/neighborhoods.json for districts.js (neighborhoodAt) and the full map's area names (city-map.js):
#   [{name, rings: [[x, z, x, z, ...], ...], label: [x, z], r, w}]
#   name   the city's NEIGHBORHO attribute, in title case ("BADER-ANN ARBOR HILLS" -> "Bader–Ann Arbor Hills")
#   label  the point deepest inside the largest ring (polylabel), r its distance to the edge, w the width of the
#          neighbourhood along the east-west line through it: the map draws the name there only when it fits
# Source: the City of Ann Arbor's "Neighborhoods" layer (AAGIS, "built from the public safety program"), KMZ from
# ckan.a2gov.org/dataset/neighborhoods; no license stated, like the city's other ckan layers. 52 neighbourhoods.
# Input: .lamp/reference/aa/neighborhoods/aa_neighborhoods.kmz (fetched here when missing).
# Run: .lamp/reference/venv/bin/python -I Assets/Tools/build-neighborhoods.py <app folder>
import json, math, os, re, sys, urllib.request, zipfile
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union, polylabel
from shapely.validation import make_valid

ROOT = sys.argv[1]
REF = os.path.join(ROOT, '.lamp/reference/aa/neighborhoods')
KMZ = os.path.join(REF, 'aa_neighborhoods.kmz')
URL = ('https://ckan.a2gov.org/dataset/978b4315-bac0-487e-a481-5707f905d4a1/resource/'
       'f4dc918a-7bf1-4eb0-9daa-e176d4eca7c2/download/aa_neighborhoods.kmz')
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5

# the layer's spellings, put right
FIX = {'GLACIER HIGLANDS-GREENBRIER': 'GLACIER HIGHLANDS-GREENBRIER', 'PATTENGILL-ST FRANCIS': 'PATTENGILL-ST. FRANCIS'}
SMALL = {'of', 'the', 'and'}


def title(raw):
    raw = FIX.get(raw, raw)
    words = []
    for w in raw.split(' '):
        parts = [p if p in ('V', 'II', 'III') else p.capitalize() for p in w.split('-')]
        words.append('–'.join(parts))
    return ' '.join(w if i == 0 or w.lower() not in SMALL else w.lower() for i, w in enumerate(words))


if not os.path.exists(KMZ):
    os.makedirs(REF, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=60) as r, open(KMZ, 'wb') as f:
        f.write(r.read())

NS = {'k': 'http://www.opengis.net/kml/2.2'}
doc = ET.fromstring(zipfile.ZipFile(KMZ).read('doc.kml'))


def ring_of(el):
    pts = []
    for t in el.text.split():
        lon, lat = map(float, t.split(',')[:2])
        pts.append(((lon - LON0) * KX, -(lat - LAT0) * KY))
    return pts


out = []
for pm in doc.iter('{%s}Placemark' % NS['k']):
    m = re.search(r'<td>NEIGHBORHO</td>\s*<td>([^<]*)</td>', pm.find('k:description', NS).text or '')
    if not m:
        continue
    polys = []
    for pg in pm.iter('{%s}Polygon' % NS['k']):
        outer = ring_of(pg.find('k:outerBoundaryIs/k:LinearRing/k:coordinates', NS))
        holes = [ring_of(h) for h in pg.findall('k:innerBoundaryIs/k:LinearRing/k:coordinates', NS)]
        polys.append(make_valid(Polygon(outer, holes)))
    geom = unary_union(polys).simplify(4.0, preserve_topology=True)
    parts = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    parts = [p for p in parts if p.area > 2000]
    if not parts:
        continue
    rings = []
    for p in parts:
        # holes are dropped: the neighbourhoods tile the town, and a hole is a neighbour inside
        flat = []
        for x, z in list(p.exterior.coords)[:-1]:
            flat += [round(x), round(z)]
        rings.append(flat)
    big = max(parts, key=lambda p: p.area)
    c = polylabel(big, tolerance=5)
    r = big.exterior.distance(c)
    chord = LineString([(big.bounds[0] - 1, c.y), (big.bounds[2] + 1, c.y)]).intersection(big)
    segs = [chord] if chord.geom_type == 'LineString' else [g for g in getattr(chord, 'geoms', []) if g.geom_type == 'LineString']
    w = max((s.length for s in segs if s.distance(c) < 1), default=2 * r)
    out.append({'name': title(m.group(1).strip()), 'rings': rings, 'label': [round(c.x), round(c.y)],
                'r': round(r), 'w': round(w)})

out.sort(key=lambda d: d['name'])
path = os.path.join(ROOT, 'Web/data/neighborhoods.json')
json.dump(out, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'{len(out)} neighbourhoods, {sum(len(r) // 2 for d in out for r in d["rings"])} points, '
      f'{os.path.getsize(path) // 1024} KB')
for d in out:
    print(f'  {d["name"]:34s} label {d["label"]} r {d["r"]} w {d["w"]} rings {len(d["rings"])}')
