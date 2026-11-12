# Writes Web/data/building-looks.json: how each house and downtown storefront really looks, decided once here at
# build time from public data, so the game draws Ann Arbor's real siding, brick, porches and shopfronts instead of
# seeded guesses. The game itself never calls any of the services below.
#
# Sources (downloads cached under .lamp/reference/aa/):
#   parcels/aa_parcels.geojson  City of Ann Arbor parcels with the assessor's year built and storey style
#                               (a2maps.a2gov.org WaterServiceLeadMaterialAll/MapServer/3; owners' names and
#                               addresses are not downloaded)
#   mapillary/                  Mapillary street photos (API v4, CC BY-SA 4.0, "Mapillary contributors"): the tile
#                               listings, and each chosen photo cropped to its building
#   looks/answers.json          Jev's raw answers (TypeSafe System One), one request per building, kept so the
#                               thresholds can change without asking again
# Keys: TYPESAFE_API_KEY and MAPILLARY_TOKEN, from the environment or a KEY=value file (--keys, default
# ~/.lamp/reference/keys.env). They are never printed or written anywhere else.
#
# The assessor's year built and storeys are used as they are. Each building's photo is the one that best faces it
# from the street: in the camera's field of view, its wall seen head-on, near enough, and no other footprint in the
# way. Jev is asked, in one request per building, whether the photo clearly shows the building, then its walls'
# material and color (from the game's own palette), porch, shutters, dormers and roof (houses) or facade, awning,
# display windows and color (storefronts). An answer below the threshold keeps the game's generated look.
#
# Run: .lamp/reference/venv/bin/python -I Assets/Tools/build-building-looks.py <app folder> --area main --area ows
#      [--classify] [--pack] [--cache DIR] [--limit N]
import argparse, base64, collections, concurrent.futures, threading, gzip, io, json, math, os, struct, sys, time, urllib.error, urllib.parse, urllib.request, uuid

import numpy as np
from PIL import Image
import shapely
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.strtree import STRtree

ap = argparse.ArgumentParser()
ap.add_argument('root')
ap.add_argument('--cache', help='download cache (default <root>/.lamp/reference/aa)')
ap.add_argument('--keys', default=os.path.expanduser('~/.lamp/reference/keys.env'))
ap.add_argument('--area', action='append', default=[], help='main, ows, or all')
ap.add_argument('--classify', action='store_true', help='ask Jev about buildings not yet answered')
ap.add_argument('--pack', action='store_true', help='write Web/data/building-looks.json')
ap.add_argument('--out', help='where --pack writes (default <root>/Web/data/building-looks.json)')
ap.add_argument('--limit', type=int, default=0, help='ask about at most this many buildings')
ap.add_argument('--max-side', type=int, default=1024, help="the sent photo's longest side in pixels (280-1568)")
ap.add_argument('--report', help='write a JSON report of this run here')
ap.add_argument('--workers', type=int, default=12, help='buildings asked about at once')
ap.add_argument('--keep-crops', action='store_true', help='keep the photos as sent (mapillary/crops/)')
ap.add_argument('--box', action='store_true', help='find each building in a wide cut of its photo with a Jev Box '
                'question first, then ask about the cut to that box (two requests a photo)')
ap.add_argument('--tries', type=int, default=3, help="photos tried per building; raised later, a building whose "
                'earlier photos all failed is tried on the next ones')
args = ap.parse_args()
ROOT = args.root
CACHE = args.cache or os.path.join(ROOT, '.lamp/reference/aa')
UA = {'User-Agent': 'go-to-ann-arbor-build/1.0'}

# --- Frame (as build-annarbor.py) ----------------------------------------------------------------------------------------
LAT0, LON0 = 42.27965, -83.74838  # Main St & Liberty St
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)
lonlat = lambda x, z: (LON0 + x / KX, LAT0 - z / KY)


def keys():
    kv = {}
    if os.path.exists(args.keys):
        for line in open(args.keys):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                kv[k.strip()] = v.strip().strip('"\'')
    for k in ('TYPESAFE_API_KEY', 'MAPILLARY_TOKEN'):
        if os.environ.get(k):
            kv[k] = os.environ[k]
    return kv


KEYS = keys()


def get_json(url, headers=None, tries=4):
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and t + 1 < tries:
                time.sleep(2 ** t * 2)
                continue
            raise RuntimeError(f'HTTP {e.code} from {urllib.parse.urlsplit(url).netloc}') from None
        except urllib.error.URLError:
            if t + 1 < tries:
                time.sleep(2 ** t * 2)
                continue
            raise


# --- Buildings (Web/js/building-geodata.bin.gz, NYB1) ---------------------------------------------------------------------
def read_buildings():
    data = gzip.open(os.path.join(ROOT, 'Web/js/building-geodata.bin.gz')).read()
    magic, nmeta, nx = struct.unpack_from('<4sII', data)
    assert magic == b'NYB1'
    pos = {'m': 12, 'x': 12 + nmeta, 'z': 12 + nmeta + nx}

    def uint(s):
        v = shift = 0
        while True:
            b = data[pos[s]]
            pos[s] += 1
            v |= (b & 127) << shift
            shift += 7
            if not b & 128:
                return v

    def delta(s):
        v = uint(s)
        return (v >> 1) ^ -(v & 1)

    out, x, z = [], 0, 0
    for _ in range(uint('m')):
        h, kind, polys = uint('m'), uint('m'), []
        for _ in range(uint('m')):
            rings = []
            for _ in range(uint('m')):
                ring = []
                for _ in range(uint('m')):
                    x += delta('x')
                    z += delta('z')
                    ring.append((x * 0.5, z * 0.5))
                rings.append(ring)
            polys.append(rings)
        xs = [p[0] for poly in polys for p in poly[0]]
        zs = [p[1] for poly in polys for p in poly[0]]
        geom = Polygon(polys[0][0], polys[0][1:]) if polys and len(polys[0][0]) >= 3 else None
        if geom is None or not geom.is_valid:
            geom = shapely.make_valid(geom) if geom is not None else None
        out.append({'height': h, 'kind': kind, 'polys': polys, 'geom': geom,
                    'cx': (min(xs) + max(xs)) / 2, 'cz': (min(zs) + max(zs)) / 2,
                    'span': (max(xs) - min(xs)) * (max(zs) - min(zs))})
    return out


B = read_buildings()
# the city's religious parcels (Web/data/districts.json land use 9), for the churches
_rel = [Polygon([(r[i], r[i + 1]) for i in range(1, len(r) - 1, 2)]) for r in
        json.load(open(os.path.join(ROOT, 'Web/data/districts.json')))['landuse'] if r[0] == 9 and len(r) >= 7]
_rel_tree = STRtree(_rel)


def religious(x, z):
    return any(_rel[i].contains(Point(x, z)) for i in _rel_tree.query(Point(x, z)))


for b in B:
    ring = b['polys'][0][0]
    b['area'] = abs(Polygon(ring).area) if len(ring) >= 3 else 0
    # as buildings.js sorts them: houses (and small sheds) for houses.js, the rest by the facade shaders
    small_shed = b['span'] < 70 and b['height'] < 6
    # (as buildings.js: under 900 m², or out past the town that stood by 1950 a townhouse row or garden apartments up to
    # 3,000 m², drawn as houses are)
    b['house'] = ((b['kind'] or 1) == 1 and b['height'] < 14 and (b['span'] < 900 or b['area'] < 900 or (
        b['area'] < 3000 and math.hypot(b['cx'], b['cz']) > 2300))) or small_shed
    # an apartment block or townhouse row (houses.js APARTMENT_AREA)
    b['apartments'] = b['house'] and b['area'] >= 400
    b['garage'] = b['house'] and ((small_shed and (b['kind'] or 1) != 1) or b['area'] < 45)
    b['shop'] = not b['house'] and b['height'] >= 6 and b['kind'] != 5
    # the University's own: only their walls are asked about (no shopfronts)
    b['campus'] = not b['house'] and b['height'] >= 6 and b['kind'] == 5
    # a church (as buildings.js: over 150 m², 7 to 40 m, on a religious parcel, not the University's): its walls too
    b['church'] = (b['kind'] or 1) != 5 and b['area'] > 150 and 7 <= b['height'] < 40 and religious(b['cx'], b['cz'])
    if b['church']:
        b['house'], b['shop'], b['campus'] = False, False, True
    # a point inside the footprint: the game finds a building's look by which footprint holds it (as roof-shapes.json)
    p = Polygon(ring).representative_point() if len(ring) >= 3 else Point(b['cx'], b['cz'])
    b['px'], b['pz'] = round(p.x, 1), round(p.y, 1)
    b['key'] = f"{b['px']:.1f},{b['pz']:.1f}"
GEOMS = [b['geom'] for b in B]
_trees = os.path.join(CACHE, 'aa_trees.geojson')
TREES_TREE = STRtree([Point(*xz(*f['geometry']['coordinates'][:2])) for f in json.load(open(_trees))['features']
                      if f.get('geometry')]) if os.path.exists(_trees) else None
TREE = STRtree(GEOMS)
print(f'{len(B)} buildings, {sum(b["house"] and not b["garage"] for b in B)} houses, {sum(b["shop"] for b in B)} other buildings 6 m or taller')

# OSM's mapped roof shapes (the game already uses them; Jev is only asked about the rest)
roof_tags = json.load(open(os.path.join(ROOT, 'Web/data/roof-shapes.json')))
roof_pts = [Point(roof_tags[i], roof_tags[i + 1]) for i in range(0, len(roof_tags) - 2, 3)]
roof_tree = STRtree(roof_pts) if roof_pts else None


def has_roof_tag(b):
    if roof_tree is None or b['geom'] is None:
        return False
    return len(roof_tree.query(b['geom'], predicate='contains')) > 0


# --- Areas ---------------------------------------------------------------------------------------------------------------
osm = json.load(open(os.path.join(CACHE, 'osm.json')))['elements']


def street(name):
    lines = [LineString([xz(g['lon'], g['lat']) for g in e['geometry']]) for e in osm
             if e['type'] == 'way' and e.get('tags', {}).get('name') == name and 'highway' in e.get('tags', {})
             and len(e.get('geometry', [])) >= 2]
    if not lines:
        raise SystemExit(f'no street named {name}')
    return shapely.union_all(lines)


def corner(a, b):
    p = street(a).intersection(street(b))
    if p.is_empty:
        raise SystemExit(f'{a} does not meet {b}')
    return p.centroid if p.geom_type != 'Point' else p


def segment_area(name, cross1, cross2, reach):
    # both sides of one (straight) street between two cross streets
    return LineString([corner(name, cross1), corner(name, cross2)]).buffer(reach, cap_style='flat')


AREAS = {
    # Main Street downtown, Huron to William: its storefronts
    'main': lambda: (segment_area('South Main Street', 'West Huron Street', 'West William Street', 32), 'shop'),
    # one block of the Old West Side: both sides of South Seventh Street, Washington to Liberty
    'ows': lambda: (segment_area('South Seventh Street', 'West Washington Street', 'West Liberty Street', 40), 'house'),
}


def area_buildings(name):
    if name == 'all':
        return [b for b in B if (b['house'] and not b['garage']) or b['shop'] or b['campus']]
    if name == 'campus':
        return [b for b in B if b['campus'] and not b['church']]
    if name == 'churches':
        return [b for b in B if b['church']]
    if name == 'apartments':
        return [b for b in B if b['apartments'] and not b['garage']]
    poly, what = AREAS[name]()
    out = []
    for b in B:
        if not b[what] or (what == 'house' and b['garage']):
            continue
        if poly.contains(Point(b['px'], b['pz'])):
            out.append(b)
    return out


# --- Assessor ------------------------------------------------------------------------------------------------------------
parcels = json.load(open(os.path.join(CACHE, 'parcels/aa_parcels.geojson')))['features']
P_GEOMS, P_PROPS = [], []
for f in parcels:
    if not f.get('geometry'):
        continue
    g = shape(f['geometry'])
    g = shapely.transform(g, lambda c: np.column_stack(xz(c[:, 0], c[:, 1])))
    P_GEOMS.append(g if g.is_valid else shapely.make_valid(g))
    P_PROPS.append(f['properties'])
P_TREE = STRtree(P_GEOMS)
STOREYS = {'RANCH': 1, '1 1/2 ST': 1.5, '2 STORY': 2, 'SPLIT LVL': 'split'}


def assessor(b):
    hits = [i for i in P_TREE.query(Point(b['px'], b['pz'])) if P_GEOMS[i].contains(Point(b['px'], b['pz']))]
    hits.sort(key=lambda i: -(P_PROPS[i].get('yearbuilt') or 0))
    if not hits:
        return None
    p = P_PROPS[hits[0]]
    style = (p.get('resStyle') or '').split(',')[0].strip()
    return {'pin': p.get('PIN'), 'parcel': hits[0], 'year_built': p.get('yearbuilt') or None,
            'storeys': STOREYS.get(style), 'style': style or None, 'land_use': p.get('LANDUSE') or None,
            'floor_area_sqft': p.get('floorArea') or None, 'historic_district': p.get('HDC') or None}


def attach_assessor(bs):
    for b in bs:
        b['assessor'] = assessor(b)
    # the storey style describes the parcel's house: only its largest building takes it
    by_parcel = {}
    for b in bs:
        if b['assessor']:
            by_parcel.setdefault(b['assessor']['parcel'], []).append(b)
    for group in by_parcel.values():
        group.sort(key=lambda b: -b['area'])
        for b in group[1:]:
            b['assessor'] = {**b['assessor'], 'storeys': None, 'style': None}


# --- Mapillary -----------------------------------------------------------------------------------------------------------
MLY = os.path.join(CACHE, 'mapillary')
FIELDS = 'id,captured_at,computed_compass_angle,compass_angle,computed_geometry,geometry,is_pano,camera_type,camera_parameters,width,height'
TILE = 0.002  # degrees


def mly_headers():
    if 'MAPILLARY_TOKEN' not in KEYS:
        raise SystemExit('no MAPILLARY_TOKEN')
    return {'Authorization': 'OAuth ' + KEYS['MAPILLARY_TOKEN']}


def mly_tile(i, j):
    path = os.path.join(MLY, 'tiles', f'{i}_{j}.json')
    if os.path.exists(path):
        return json.load(open(path))
    w, s = i * TILE, j * TILE
    url = 'https://graph.mapillary.com/images?' + urllib.parse.urlencode(
        {'bbox': f'{w:.4f},{s:.4f},{w + TILE:.4f},{s + TILE:.4f}', 'fields': FIELDS, 'limit': 2000})
    images = []
    while url:
        d = get_json(url, mly_headers())
        images += d.get('data', [])
        url = d.get('paging', {}).get('next')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(images, open(path + '.tmp', 'w'))
    os.replace(path + '.tmp', path)
    return images


def photos_near(bs, reach=55):
    tiles = set()
    for b in bs:
        # (a University building: round its whole footprint, which can be 150 m across and set back from the street)
        x0, z0, x1, z1 = b['geom'].bounds if b['campus'] and b['geom'] is not None else (b['px'], b['pz'], b['px'], b['pz'])
        for x in (x0 - reach, x1 + reach):
            for z in (z0 - reach, z1 + reach):
                lon, lat = lonlat(x, z)
                tiles.add((math.floor(lon / TILE), math.floor(lat / TILE)))
    seen, out = set(), []
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        listings = list(pool.map(lambda t: mly_tile(*t), sorted(tiles)))
    for listing in listings:
        for im in listing:
            if im['id'] in seen:
                continue
            seen.add(im['id'])
            g = im.get('computed_geometry') or im.get('geometry')
            ang = im.get('computed_compass_angle', im.get('compass_angle'))
            if not g or ang is None or im.get('is_pano') or im.get('camera_type') not in (None, 'perspective', 'brown', 'fisheye'):
                continue
            x, z = xz(*g['coordinates'])
            f, k1, k2 = ((im.get('camera_parameters') or []) + [0.85, 0, 0][len(im.get('camera_parameters') or []):])[:3]
            w, h = im.get('width') or 4, im.get('height') or 3
            edge = 0.5 * (w / max(w, h)) / (f or 0.85)
            half = next((a for a in np.radians(np.arange(1, 89, 0.5)) if distort(math.tan(a), k1, k2) >= edge),
                        math.radians(60))
            out.append({'id': im['id'], 'x': x, 'z': z, 'heading': ang, 'half_fov': half, 'f': f or 0.85, 'k1': k1,
                        'k2': k2, 'w': w, 'h': h,
                        'year': time.gmtime(im['captured_at'] / 1000).tm_year, 'fisheye': im.get('camera_type') == 'fisheye'})
    return out


def distort(r, k1, k2):
    # Mapillary's perspective cameras: a radius on the image plane (in focal lengths) after radial distortion
    return r * (1 + k1 * r * r + k2 * r ** 4)


def wrap(a):
    return (a + 180) % 360 - 180


def view(b, im):
    """How well photo im shows building b, or None if it can't."""
    geom = b['geom']
    if geom is None:
        return None
    px, pz = im['x'], im['z']
    if geom.contains(Point(px, pz)):
        return None
    # the building's angular extent, as seen from the camera, relative to the camera's heading (+ to the right)
    ext = geom.exterior if geom.geom_type == 'Polygon' else geom.convex_hull.exterior
    angs = [wrap(math.degrees(math.atan2(x - px, -(z - pz))) - im['heading']) for x, z in ext.coords]
    lo, hi = min(angs), max(angs)
    if hi - lo > 180:
        return None
    mid = (lo + hi) / 2
    half = math.degrees(im['half_fov'])
    if abs(mid) > half * 0.9:
        return None
    inside = max(0, min(hi, half) - max(lo, -half)) / max(hi - lo, 1e-6)
    # (a University building may be too big to fit half of it in the frame from across its street)
    if inside < (0.25 if b['campus'] else 0.5):
        return None
    # the wall the camera looks at: the first footprint edge on the ray toward the building's middle
    a = math.radians(im['heading'] + mid)
    dx, dz = math.sin(a), -math.cos(a)
    ray = LineString([(px, pz), (px + dx * 80, pz + dz * 80)])
    hit = ray.intersection(ext)
    if hit.is_empty:
        return None
    pts = [hit] if hit.geom_type == 'Point' else [g for g in getattr(hit, 'geoms', []) if g.geom_type == 'Point']
    if not pts:
        return None
    q = min(pts, key=lambda p: p.distance(Point(px, pz)))
    d = q.distance(Point(px, pz))
    if d < 4 or d > 50:
        return None
    coords = list(ext.coords)
    k = min(range(len(coords) - 1), key=lambda i: LineString([coords[i], coords[i + 1]]).distance(q))
    (ax, az), (bx, bz) = coords[k], coords[k + 1]
    L = math.hypot(bx - ax, bz - az) or 1
    nx, nz = (bz - az) / L, -(bx - ax) / L
    c = geom.centroid
    if nx * (q.x - c.x) + nz * (q.y - c.y) < 0:
        nx, nz = -nx, -nz
    headon = -(dx * nx + dz * nz)
    if headon < 0.25:
        return None
    # nothing else's footprint between the camera and that wall
    sight = LineString([(px, pz), (q.x - dx * 0.4, q.y - dz * 0.4)])
    for i in TREE.query(sight, predicate='intersects'):
        if GEOMS[i] is not geom:
            return None
    # street trees (the city's inventory) near the line of sight hide the wall in summer photos
    trees = len(TREES_TREE.query(sight.buffer(2.5), predicate='intersects')) if TREES_TREE is not None else 0
    fill = min(hi, half) - max(lo, -half)
    score = (2 * headon - 0.5 * trees - 0.6 * abs(mid) / half - 0.03 * max(0, d - 12) + 0.8 * min(fill / (2 * half), 0.7)
             + 0.25 * min(1, max(0, im['year'] - 2014) / 10))
    return {'score': round(score, 3), 'dist': round(d, 1), 'headon': round(headon, 2), 'trees': trees, 'lo': lo, 'hi': hi,
            'id': im['id'], 'year': im['year']}


def best_photos(b, photos, ptree, n=3):
    # the best few, each from a different spot (photos a metre apart show the same thing)
    around = b['geom'].buffer(50) if b['campus'] and b['geom'] is not None else Point(b['px'], b['pz']).buffer(55)
    near = ptree.query(around) if ptree is not None else []
    views = sorted((v for v in (view(b, photos[i]) for i in near) if v), key=lambda v: -v['score'])
    out = []
    for v in views:
        p = photos_by_id[v['id']]
        if all(math.hypot(p['x'] - photos_by_id[o['id']]['x'], p['z'] - photos_by_id[o['id']]['z']) > 4 for o in out):
            out.append(v)
        if len(out) == n:
            break
    return out


THUMBS_KEPT = 400  # street photos are only kept while neighbouring buildings may want them (each is ~350 KB)
_thumb_lock, _thumb_locks, _thumb_order = threading.Lock(), {}, collections.deque()


def thumb(image_id):
    with _thumb_lock:
        lock = _thumb_locks.setdefault(image_id, threading.Lock())
    path = os.path.join(MLY, 'img', f'{image_id}.jpg')
    with lock:
        if not os.path.exists(path):
            d = get_json(f'https://graph.mapillary.com/{image_id}?fields=thumb_2048_url', mly_headers())
            os.makedirs(os.path.dirname(path), exist_ok=True)
            for t in range(3):
                try:
                    with urllib.request.urlopen(urllib.request.Request(d['thumb_2048_url'], headers=UA), timeout=60) as r:
                        data = r.read()
                    break
                except (urllib.error.URLError, TimeoutError):
                    if t == 2:
                        raise
                    time.sleep(3)
            open(path + '.tmp', 'wb').write(data)
            os.replace(path + '.tmp', path)
            with _thumb_lock:
                _thumb_order.append(path)
                while len(_thumb_order) > THUMBS_KEPT:
                    old = _thumb_order.popleft()
                    try:
                        os.remove(old)
                    except OSError:
                        pass
        return Image.open(path).convert('RGB')


def crop(b, v, im, wide=False):
    """The photo cut to the building, with a margin, as a baseline JPEG within Jev's size limits; wide, a much wider
    cut for Jev to find the building in. Returns the JPEG, its size, and the street photo and rectangle it came from."""
    src = thumb(v['id'])
    W, H = src.size
    fpx = im['f'] * max(W, H)
    col = lambda a: W / 2 + distort(math.tan(math.radians(max(-80, min(80, a)))), im['k1'], im['k2']) * fpx
    x0, x1 = sorted((col(v['lo']), col(v['hi'])))
    # a wide margin: Mapillary's compass angles are often a few degrees out
    m = (0.7 * (x1 - x0) + 0.12 * W) if wide else 0.25 * (x1 - x0) + 0.05 * W
    x0, x1 = max(0, min(x0 - m, W - 1)), min(W, max(x1 + m, 1))
    # street photos are level: the street fills the bottom of the frame and buildings stand from about the
    # middle up, so the bottom quarter only costs tokens
    y1 = round(0.74 * H)
    need = max((1.3 if wide else 0.9) * y1, 280)
    if x1 - x0 < need:
        c = (x0 + x1) / 2
        x0, x1 = max(0, c - need / 2), min(W, c + need / 2)
    rect = (int(x0), 0, int(math.ceil(x1)), y1)
    jpeg, size = encode(src.crop(rect), f"{b['key']}_{v['id']}{'_wide' if wide else ''}")
    # where the building's middle should be across the cut, from the camera's heading
    across = min(0.9, max(0.1, (col((v['lo'] + v['hi']) / 2) - rect[0]) / max(1, rect[2] - rect[0])))
    return jpeg, size, src, rect, across


def encode(img, name):
    s = min(1, args.max_side / max(img.size))
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    if min(img.size) < 280:
        s = 280 / min(img.size)
        img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=88)
    if args.keep_crops:
        path = os.path.join(MLY, 'crops', f'{name}.jpg')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(buf.getvalue())
    return buf.getvalue(), img.size


def boxed(b, v, src, rect, box):
    """The street photo cut to the box Jev found (fractions of the wide cut `rect`), padded a little."""
    x0, y0, x1, y1 = rect
    w, h = x1 - x0, y1 - y0
    l, r = x0 + box['left'] * w, x0 + box['right'] * w
    t, u = y0 + box['top'] * h, y0 + box['bottom'] * h
    px, py = 0.15 * (r - l) + 8, 0.12 * (u - t) + 8
    l, r, t, u = max(0, l - px), min(src.width, r + px), max(0, t - py), min(src.height, u + py)
    # not thinner than a third of its height, nor a sliver
    if r - l < (u - t) / 3:
        c = (l + r) / 2
        l, r = max(0, c - (u - t) / 6), min(src.width, c + (u - t) / 6)
    return encode(src.crop((int(l), int(t), int(math.ceil(r)), int(math.ceil(u)))), f"{b['key']}_{v['id']}_box")


# --- Palettes (houses.js) -------------------------------------------------------------------------------------------------
SIDING = [0xf2efe7, 0xebe5d3, 0xe6dcc0, 0xf0ece2, 0xe4cd85, 0xd9bf72, 0xead9a0, 0xaab595, 0x8e9b74, 0x707d57, 0x5d6a4c,
          0xb9bbb7, 0x92989a, 0x6c7378, 0x9fb2c0, 0x7b91a3, 0x5a6f82, 0x8b3a2e, 0x75302a, 0xc8b391]
HERITAGE = [0x7a3b33, 0x5b2f2a, 0x46604a, 0x5e6b45, 0xb8924a, 0xc9a96b, 0x52616d, 0x6b5b4b, 0xe6dcc3, 0x8c6f4e, 0x3f4f5a,
            0xd8c8a0]
BRICKS = [0x8e4a38, 0x9a5240, 0x7c3b2c, 0x6b4a37, 0x7b5944, 0xa86a4c]
STONES = [0x9a9286, 0x857d70, 0xa89f8e]
STUCCO = [0xe6dcc4, 0xd7cbb0, 0xc9bfa8, 0xe9e2d2]
SHAKES = [0x8a6a4a, 0x6e5a45, 0x7d7a68, 0x5f6b55]
# the colors Jev chooses from: the palette's colors, by name
COLORS = {
    'white': 0xf2efe7, 'cream': 0xe6dcc0, 'pale_yellow': 0xead9a0, 'yellow': 0xe4cd85, 'ochre': 0xb8924a,
    'tan': 0xc8b391, 'light_gray': 0xb9bbb7, 'gray': 0x92989a, 'charcoal': 0x6c7378, 'slate': 0x52616d,
    'light_blue': 0x9fb2c0, 'blue': 0x7b91a3, 'navy': 0x3f4f5a, 'sage_green': 0xaab595, 'olive_green': 0x8e9b74,
    'dark_green': 0x46604a, 'red': 0x8b3a2e, 'dark_red': 0x5b2f2a, 'brown': 0x6b5b4b, 'light_brown': 0x8c6f4e,
}
MATERIALS = {'clapboard': (1, SIDING + HERITAGE), 'brick': (2, BRICKS), 'stone': (3, STONES), 'stucco': (4, STUCCO),
             'shingle': (5, SHAKES)}
ROOFS = {'gabled': 1, 'hipped': 2, 'flat': 3, 'gambrel': 4}
# storefronts (tsl-materials.js / buildings.js): the facade's material bucket and the shopfront's frame paint
SHOP_MATERIALS = {'red_brick': 1, 'tan_brick': 1, 'stone': 0, 'painted': 3, 'glass_metal': 2}
SHOP_COLORS = {'dark_green': 0x263831, 'brown': 0x463b30, 'charcoal': 0x242a32, 'black': 0x1d1e21, 'white': 0xe9e4d6,
               'cream': 0xe6dcc0, 'red': 0x7a2a24, 'blue': 0x2b3f5a, 'natural_wood': 0x7a5a3c, 'gray_metal': 0x8a8d88}


def rgb(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], float)


def nearest(hexv, palette):
    return int(np.argmin([np.sum((rgb(hexv) - rgb(p)) ** 2) for p in palette]))


def color_options(colors):
    return {k: f"{k.replace('_', ' ')} (about #{v:06x})" for k, v in colors.items()} | {
        'cant_tell': 'The color cannot be made out: in shadow, blocked, or the wall is not visible.'}


# --- Jev -----------------------------------------------------------------------------------------------------------------
def house_questions(b, ask_roof):
    target = 'the house at the middle of `photo`'
    q = {
        'visible': {'type': 'noul', 'instructions':
                    f'Does `photo` clearly show {target}, with most of its front or side wall unobstructed by trees, '
                    'vehicles, fences or other buildings, so its siding and windows can be seen?'},
        'material': {'type': 'choice', 'instructions': f'What are the outside walls of {target} mostly covered with?',
                     'criteria': {
                         'clapboard': 'Horizontal lap siding: wood clapboard, or vinyl or aluminum siding.',
                         'brick': 'Brick.', 'stone': 'Stone or fieldstone.', 'stucco': 'Smooth or textured stucco.',
                         'shingle': 'Wood shingles or cedar shakes.',
                         'cant_tell': 'The walls cannot be made out clearly enough to tell.'}},
        'color': {'type': 'choice', 'instructions':
                  f'Which color is closest to the main color of the outside walls of {target} (not its trim, door or roof)?',
                  'criteria': color_options(COLORS)},
        'porch': {'type': 'noul', 'instructions':
                  f'Does {target} have a front porch: a raised platform at its entrance with its own roof held up by '
                  'posts or columns (a bare stoop or steps does not count)?'},
        'shutters': {'type': 'noul', 'instructions': f'Do the windows of {target} have shutters on either side?'},
        'dormers': {'type': 'noul', 'instructions':
                    f'Does the roof of {target} have one or more dormers: windows set in their own small roofed '
                    'structures that project from the roof slope?'},
    }
    if ask_roof:
        q['roof'] = {'type': 'choice', 'instructions': f'What shape is the main roof of {target}?', 'criteria': {
            'gabled': 'Two slopes meeting at a ridge, with triangular gable ends.',
            'hipped': 'Slopes on all four sides, no gable ends.',
            'gambrel': 'Barn-style: two slopes on each side, the lower one steeper.',
            'flat': 'Flat or nearly flat.',
            'cant_tell': 'The roof cannot be seen well enough to tell.'}}
    return q


def shop_questions(b):
    target = 'the building at the middle of `photo`'
    return {
        'visible': {'type': 'noul', 'instructions':
                    f'Does `photo` clearly show the street front of {target}, including its ground-floor shopfront, '
                    'mostly unobstructed by trees, vehicles or other buildings?'},
        'facade': {'type': 'choice', 'instructions': f'What are the upper walls of {target} mostly made of?',
                   'criteria': {
                       'red_brick': 'Red or brown brick.', 'tan_brick': 'Tan, buff, cream or yellow brick.',
                       'stone': 'Stone or limestone, or cast stone.',
                       'painted': 'Painted brick, stucco or painted panels.',
                       'glass_metal': 'Mostly glass and metal.',
                       'cant_tell': 'The upper walls cannot be made out clearly enough to tell.'}},
        'awning': {'type': 'noul', 'instructions': f'Does the ground-floor shopfront of {target} have a fabric awning?'},
        'windows': {'type': 'choice', 'instructions': f"How big are the display windows of {target}'s ground-floor shopfront?",
                    'criteria': {
                        'small': 'Small windows set in a mostly solid wall.',
                        'medium': 'Display windows over a knee wall, with wall or piers around them.',
                        'large': 'Glass nearly from the sidewalk to the ceiling across most of the front.',
                        'cant_tell': 'The shopfront cannot be seen well enough to tell.'}},
        'frame': {'type': 'choice', 'instructions':
                  f"What color is the frame of {target}'s shopfront: the paint or finish around its windows and door?",
                  'criteria': color_options(SHOP_COLORS)},
    }


def campus_questions(b):
    target = 'the building at the middle of `photo`'
    return {
        'visible': {'type': 'noul', 'instructions':
                    f'Does `photo` clearly show the walls of {target}, mostly unobstructed by trees, vehicles or '
                    'other buildings?'},
        'facade': {'type': 'choice', 'instructions': f'What are the walls of {target} mostly made of?',
                   'criteria': {
                       'red_brick': 'Red or brown brick.', 'tan_brick': 'Tan, buff, cream or yellow brick.',
                       'stone': 'Stone or limestone, or cast stone or precast concrete.',
                       'painted': 'Painted brick, stucco or painted panels.',
                       'glass_metal': 'Mostly glass and metal: curtain wall, metal panels or fins.',
                       'cant_tell': 'The walls cannot be made out clearly enough to tell.'}},
    }


def ask_jev(state, questions, jpeg):
    ref = 'img-' + uuid.uuid4().hex
    body = {'model': 'jev-latest', 'state': {**state, 'photo': ref}, 'questions': questions,
            'assets': {ref: {'type': 'image', 'format': 'jpg',
                             'data_base64': base64.b64encode(jpeg).decode('ascii')}}}
    req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=json.dumps(body).encode(), headers={
        **UA, 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEYS['TYPESAFE_API_KEY'],
        'TypeSafe-Danger-Zone-Images': 'true'})
    for t in range(4):
        try:
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            d['seconds'] = round(time.time() - t0, 2)
            return d
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and t < 3:
                time.sleep(2 ** t * 3)
                continue
            raise RuntimeError(f'Jev HTTP {e.code}: {e.read().decode()[:300]}') from None
        except (urllib.error.URLError, TimeoutError):
            if t < 3:
                time.sleep(2 ** t * 3)
                continue
            raise


# --- Run -----------------------------------------------------------------------------------------------------------------
# One line per building asked about, appended as each finishes, so a run can stop and pick up where it left off
ANSWERS = os.path.join(CACHE, 'looks/answers.jsonl')
answers = {}
if os.path.exists(ANSWERS):
    for line in open(ANSWERS):
        if line.strip():
            e = json.loads(line)
            answers[e['key']] = e
_answers_lock = threading.Lock()
VISIBLE = 0.5  # below this, the photo doesn't show the building: ignore its answers
BOX_SURE = 0.5  # a Box answer less sure than this keeps the usual crop
photos_by_id = {}


def classify(b, views, area, tries=()):
    a = b['assessor'] or {}
    if b['house']:
        state = {'assessor': {k: a.get(k) for k in ('year_built', 'style', 'historic_district') if a.get(k)}}
        qs = house_questions(b, not has_roof_tag(b))
    else:
        state = {'assessor': {k: a.get(k) for k in ('year_built', 'land_use') if a.get(k)}}
        qs = campus_questions(b) if b['campus'] else shop_questions(b)
    state['about'] = 'A street-level photo of one building in Ann Arbor, Michigan, cut to that building.'
    # the best photo first; the next only if Jev says this one doesn't clearly show the building (after any tried
    # in an earlier run)
    tries = list(tries)
    first = len(tries)
    for v in views:
        box = None
        if args.box:
            # first find the building in a wider cut, then ask about the cut to its box
            wide, _, src, rect, across = crop(b, v, photos_by_id[v['id']], wide=True)
            what = 'house' if b['house'] else 'building' if b['campus'] else 'building with a shopfront'
            d0 = ask_jev({'about': 'A street-level photo in Ann Arbor, Michigan.', 'photo_hint':
                          f"The {what} we want is about {across:.0%} of the way across `photo` from the left, its "
                          f"nearest wall about {v['dist']:.0f} m from the camera."}, {
                'present': {'type': 'noul', 'instructions':
                            f'Can the walls of the {what} described in `photo_hint` be clearly seen, mostly '
                            'unobstructed by trees, vehicles or other buildings?'},
                'target': {'type': 'box', 'instructions':
                           f'the whole {what} described in `photo_hint`, walls and roof, not its neighbours'}}, wide)
            box = {'answers': d0['answers'], 'usage': d0.get('usage')}
            if d0['answers']['present']['noul'] < 0.3:
                tries.append({'image': v['id'], 'box': box, 'view': {k: v[k] for k in ('dist', 'headon', 'trees', 'score', 'year')},
                              'answers': {'visible': {'type': 'noul', 'noul': d0['answers']['present']['noul']}},
                              'usage': d0.get('usage')})
                d = d0
                continue
        if box and d0['answers']['target'].get('confidence', 0) >= BOX_SURE:
            jpeg, size = boxed(b, v, src, rect, d0['answers']['target']['box'])
        else:
            jpeg, size, _, _, _ = crop(b, v, photos_by_id[v['id']])
        d = ask_jev(state, qs, jpeg)
        last = len(tries) - first == len(views) - 1
        seen = d['answers']['visible']['noul'] >= VISIBLE
        usage = d.get('usage') or {}
        if box:
            usage = {'input_tokens': usage.get('input_tokens', 0) + (box['usage'] or {}).get('input_tokens', 0)}
        tries.append({'image': v['id'], 'box': box, 'view': {k: v[k] for k in ('dist', 'headon', 'trees', 'score', 'year')},
                      'size': size, 'usage': usage, 'seconds': d.get('seconds'),
                      # a photo that doesn't show the building only keeps its visibility answer
                      'answers': d['answers'] if seen or last else {'visible': d['answers']['visible']}})
        if seen:
            break
    e = {'key': b['key'], 'kind': 'house' if b['house'] else 'campus' if b['campus'] else 'shop', 'area': area, 'model': d.get('model'),
         'tries': tries}
    with _answers_lock:
        with open(ANSWERS, 'a') as f:
            f.write(json.dumps(e, separators=(',', ':')) + '\n')
        answers[b['key']] = e
    return e


report = {'areas': {}}
for area in args.area:
    bs = area_buildings(area)
    attach_assessor(bs)
    photos = photos_near(bs)
    photos_by_id.update({p['id']: p for p in photos})
    ptree = STRtree([Point(p['x'], p['z']) for p in photos]) if photos else None
    # neighbours one after another, so a street photo is usually still on disk for the next building
    bs.sort(key=lambda b: (math.floor(b['pz'] / 60), b['px'] if math.floor(b['pz'] / 60) % 2 == 0 else -b['px']))
    stats = {'buildings': len(bs), 'houses': sum(1 for b in bs if b['house']),
             'with_assessor': sum(1 for b in bs if b['assessor']),
             'with_year': sum(1 for b in bs if b['assessor'] and b['assessor']['year_built']),
             'with_storeys': sum(1 for b in bs if b['assessor'] and b['assessor']['storeys']),
             'photos_nearby': len(photos), 'matched': 0, 'asked': 0, 'errors': 0}
    todo = []
    for b in bs:
        views = best_photos(b, photos, ptree, args.tries)
        if not views:
            continue
        stats['matched'] += 1
        e = answers.get(b['key'])
        if not args.classify:
            continue
        if not e:
            todo.append((b, views, ()))
        elif e['tries'][-1]['answers']['visible']['noul'] < VISIBLE:
            # with --box, each photo gets one boxed try of its own; without, each photo is tried once
            done = [t for t in e['tries'] if bool(t.get('box')) == args.box]
            tried = {t['image'] for t in done}
            more = [v for v in views if v['id'] not in tried][:max(0, args.tries - len(done))]
            if more:
                todo.append((b, more, e['tries']))
    if args.limit:
        todo = todo[:args.limit]
    print(area, {k: v for k, v in stats.items()}, f'{len(todo)} to ask', flush=True)
    t0, tokens, done = time.time(), 0, 0
    with concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(classify, b, views, area, tries): b for b, views, tries in todo}
        for fut in concurrent.futures.as_completed(futures):
            try:
                e = fut.result()
                tokens += sum((t['usage'] or {}).get('input_tokens', 0) for t in e['tries'])
                stats['asked'] += 1
            except Exception as ex:
                stats['errors'] += 1
                print(f"  {futures[fut]['key']}: {type(ex).__name__} {str(ex)[:200]}", flush=True)
            done += 1
            if done % 200 == 0 or done == len(todo):
                el = time.time() - t0
                print(f'  {done}/{len(todo)} in {el / 60:.1f} min, {tokens:,} tokens (${tokens * 0.042e-6:.2f}), '
                      f'{stats["errors"]} errors, about {(len(todo) - done) * el / done / 60:.0f} min left', flush=True)
    report['areas'][area] = stats
    report['areas'][area]['keys'] = [b['key'] for b in bs]

if args.report:
    json.dump(report, open(args.report, 'w'), indent=1)


# --- Pack ----------------------------------------------------------------------------------------------------------------
# Web/data/building-looks.json: {"v": 1, "houses": [x, z, code, ...], "shops": [x, z, code, ...]}. (x, z) is a point
# inside the footprint (0.1 m); the game gives a building the code whose point its footprint holds, and draws its
# generated look for anything a code leaves at 0.
# House code, from bit 0: wall material 3 bits (1 clapboard, 2 brick, 3 stone, 4 stucco, 5 shingle), wall color 6
# (1 + index into that material's palette in houses.js, SIDING then HERITAGE for clapboard), porch 2, shutters 2,
# dormers 2 (1 no, 2 yes), roof 3 (as roof-shapes.json: 1 gabled, 2 hipped, 3 flat, 4 gambrel), storeys 3 (from the
# assessor: 1 one, 2 one and a half, 3 two, 4 split level), year built 7 ((year - 1800) / 2, the assessor's).
# Shop code: facade 3 bits (1 red brick, 2 tan brick, 3 stone, 4 painted, 5 glass and metal), awning 2 (1 no, 2 yes),
# display windows 2 (1 small, 2 medium, 3 large), shopfront frame color 4 (1 + index into SHOP_FRAMES), year built 7.
CONFIDENT = {'material': 0.5, 'color': 0.4, 'roof': 0.55, 'facade': 0.5, 'windows': 0.5, 'frame': 0.5}
YES, NO = 0.7, 0.3
SHOP_FACADES = ['red_brick', 'tan_brick', 'stone', 'painted', 'glass_metal']
SHOP_WINDOWS = ['small', 'medium', 'large']
SHOP_FRAMES = list(SHOP_COLORS)
STOREY_CODE = {1: 1, 1.5: 2, 2: 3, 'split': 4}


def year_code(a):
    y = a and a.get('year_built')
    return max(1, min(127, (int(y) - 1800) // 2)) if y and 1800 <= int(y) <= 2060 else 0


def pack():
    def choice(ans, q):
        x = ans.get(q)
        if not x or x['choice'] == 'cant_tell' or x['confidence'] < CONFIDENT[q]:
            return None
        return x['choice']

    def noul(ans, q):
        x = ans.get(q)
        return 0 if not x else 2 if x['noul'] >= YES else 1 if x['noul'] <= NO else 0

    houses, shops = [], []
    n = collections.Counter()
    for b in B:
        if not ((b['house'] and not b['garage']) or b['shop'] or b['campus']):
            continue
        a = b.get('assessor')
        e = answers.get(b['key'])
        ans = e['tries'][-1]['answers'] if e else {}
        if ans and ans['visible']['noul'] < VISIBLE:
            ans = {}
        code = 0
        if b['house']:
            mat = choice(ans, 'material')
            if mat:
                kind, palette = MATERIALS[mat]
                code |= kind
                col = choice(ans, 'color')
                if col:
                    code |= (1 + nearest(COLORS[col], palette)) << 3
            code |= noul(ans, 'porch') << 9 | noul(ans, 'shutters') << 11 | noul(ans, 'dormers') << 13
            roof = choice(ans, 'roof')
            if roof:
                code |= ROOFS[roof] << 15
            code |= STOREY_CODE.get(a and a.get('storeys'), 0) << 18 | year_code(a) << 21
            if code:
                houses += [b['px'], b['pz'], code]
                n['houses'] += 1
                n['houses_from_photo'] += bool(code & ((1 << 18) - 1))
        else:
            f = choice(ans, 'facade')
            if f:
                code |= 1 + SHOP_FACADES.index(f)
            code |= noul(ans, 'awning') << 3
            w = choice(ans, 'windows')
            if w:
                code |= (1 + SHOP_WINDOWS.index(w)) << 5
            fr = choice(ans, 'frame')
            if fr:
                code |= (1 + SHOP_FRAMES.index(fr)) << 7
            code |= year_code(a) << 11
            if code:
                shops += [b['px'], b['pz'], code]
                n['shops'] += 1
                n['shops_from_photo'] += bool(code & ((1 << 11) - 1))
    out = args.out or os.path.join(ROOT, 'Web/data/building-looks.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'v': 1, 'houses': houses, 'shops': shops}, open(out, 'w'), separators=(',', ':'))
    print(f'{out}: {dict(n)}, {os.path.getsize(out) // 1024} KB, '
          f'{len(gzip.compress(open(out, "rb").read())) // 1024} KB gzipped')


if args.pack:
    everyone = area_buildings('all')
    if not args.area:
        attach_assessor(everyone)
    else:
        missing = [b for b in everyone if 'assessor' not in b]
        attach_assessor(missing)
    pack()
