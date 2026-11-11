# Builds Ann Arbor's geography for the game, in the world frame the city is drawn in: 1 unit = 1 m, x east, z south,
# origin at Main St & Liberty St, true north up.
#   Web/js/city-geodata.js        GEO: land, streets (road graph), blocks (curb islands), parks, water, landmarks
#   Web/js/building-geodata.bin.gz   every building footprint with its height (NYB1)
#   Web/js/tree-geodata.bin.gz       every street tree (NYT1)
#   Web/data/elevation.bin.gz        the ground's heights (ELV2)
# Sources (downloaded to .lamp/reference/aa/):
#   osm.json            OpenStreetMap via Overpass (streets, water, parks, parking, landmarks), ODbL
#   poi/osm_pois.json   OpenStreetMap named shops, amenities, tourism & leisure (nodes, ways, relations), ODbL
#   sig/osm_signals.json  OpenStreetMap traffic lights, stop & yield signs and crossings (nodes), ODbL
#   aa_bldg.geojson     City of Ann Arbor Building Footprints (with heights above ground)
#   aa_trees.geojson    City of Ann Arbor Street Trees
#   canopy/p*.json      City of Ann Arbor Urban Tree Canopy, NaturalFeatures/MapServer/10
#   imperv/p*.json      City of Ann Arbor 2023 Impervious Surfaces (driveways, walks, patios), ImperviousSurfaces/MapServer/7
#   Terrain Tiles (terrarium PNGs, AWS open data) for the heights
# Run: .lamp/reference/venv/bin/python -I Assets/Tools/build-annarbor.py <app folder>
import gzip, io, json, math, os, re, struct, sys, urllib.request
import numpy as np
import shapely
import shapely.affinity
import shapely.errors
import shapely.ops
from shapely.geometry import Polygon, MultiPolygon, LineString, box, Point
from shapely.geometry.polygon import orient
from shapely.ops import unary_union, polygonize
from shapely import make_valid, set_precision

ROOT = sys.argv[1]
REF = os.path.join(ROOT, '.lamp/reference/aa')
OUT_JS = os.path.join(ROOT, 'Web/js')
OUT_DATA = os.path.join(ROOT, 'Web/data')

# --- Frame --------------------------------------------------------------------------------------------------------------
LAT0, LON0 = 42.27965, -83.74838  # Main St & Liberty St
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5


def xz(lon, lat):
    return ((lon - LON0) * KX, -(lat - LAT0) * KY)


def lonlat(x, z):
    return (LON0 + x / KX, LAT0 - z / KY)



r1 = lambda v: round(v, 1)


def flat(coords):
    out = []
    for x, z in coords:
        out += [r1(x), r1(z)]
    return out


def parts(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    if hasattr(g, 'geoms'):
        return [p for c in g.geoms for p in parts(c)]
    return []


# The city's land: the City of Ann Arbor's official limits (data.a2gov.org "City Boundary", fetched by
# fetch-annarbor.py into limits/), the township islands inside filled, and 120 m round them so the streets on the
# line are whole. Beyond it the outskirts (outskirts.js) are a plain ring of farms and woods.
from shapely.prepared import prep
_lim = unary_union([shapely.geometry.shape(f['geometry']) for f in json.load(open(os.path.join(REF, 'limits/aa_city_boundary.geojson')))['features']])
_lim = unary_union([Polygon([xz(lon, lat) for lon, lat, *_ in p.exterior.coords]) for p in parts(_lim)])
LIMITS = unary_union([Polygon(p.exterior) for p in parts(_lim)])
LAND = max(parts(LIMITS.buffer(120, join_style=2).buffer(-40).buffer(40).simplify(4)), key=lambda p: p.area)
LAND = Polygon(LAND.exterior)
# and Ann Arbor Municipal Airport, south of the limits, with all of its fence (Web/js/airport-data.js, build-airport.py)
# and the roads along it (W Ellsworth Rd, S State St): the town's south end from z 4400 down is squared off round it
# (the hull of the two), so the airport is part of town rather than hung off it, down to z 7200, inside the fine
# ground's grid (build-ground.py, to z 7218)
_src = open(os.path.join(ROOT, 'Web/js/airport-data.js')).read()
_ap = json.loads(_src[_src.index('{'):_src.rindex('}') + 1])
FENCE = Polygon([(_ap['bounds'][i], _ap['bounds'][i + 1]) for i in range(0, len(_ap['bounds']), 2)]).buffer(0)
_fb = FENCE.bounds
SOUTH = unary_union([LAND.intersection(box(-9000, 4400, 9000, 9000)), box(_fb[0] - 60, _fb[1] - 60, _fb[2] + 60, 7200)]).convex_hull
SOUTH = SOUTH.intersection(box(-9000, 4400, 9000, 7200))
LAND = Polygon(max(parts(unary_union([LAND, SOUTH]).buffer(30, join_style=2).buffer(-30, join_style=2).simplify(4)), key=lambda p: p.area).exterior)
# and the freeways where they swing out past the limits and come back in (M-14 round the northwest, US-23 and I-94 on
# the east side): the stretch between is taken into town, ~110 m wide, so a highway that leaves and rejoins the town
# stays in the world rather than ending at its edge. Stretches that leave and don't come back (I-94 west, US-23 south)
# stay outside, in the outskirts.
_fw = []
for e in json.load(open(os.path.join(REF, 'osm.json')))['elements']:
    if e['type'] == 'way' and 'geometry' in e and e.get('tags', {}).get('highway') in ('motorway', 'trunk', 'motorway_link', 'trunk_link'):
        _fw.append(LineString([xz(g['lon'], g['lat']) for g in e['geometry']]))
_out = unary_union(_fw).difference(LAND)
_out = shapely.ops.linemerge(_out) if _out.geom_type == 'MultiLineString' else _out
_rim = LAND.boundary.buffer(8)
_loops = [g for g in getattr(_out, 'geoms', [_out]) if g.length > 60 and _rim.contains(Point(g.coords[0])) and _rim.contains(Point(g.coords[-1]))]
if _loops:
    LAND = Polygon(max(parts(unary_union([LAND] + [g.buffer(55, cap_style=2) for g in _loops]).buffer(30, join_style=2).buffer(-30, join_style=2).simplify(4)), key=lambda p: p.area).exterior)
    print(f'freeway stretches taken into town: {len(_loops)}, {sum(g.length for g in _loops):.0f} m')
# (Lamp) and out to the freeways where they run just outside the line (the US-23 / M-14 interchanges at the north-east
# and north, I-94 and US-23's at the south-east): the town filled from its edge to any freeway within 600 m of it and
# 45 m past its carriageways and ramps, closing gaps up to ~640 m across, so the freeway is the town's edge there; and a
# corridor 45 m either side along every freeway the map's data carries on out of town, so the lanes run on through the
# town's ground and lawns, not the countryside's
if _fw:
    _F = unary_union(_fw)
    _near = _F.intersection(LAND.buffer(600))
    _grown = unary_union([LAND, _near.buffer(45)]).buffer(320, join_style=1).buffer(-320, join_style=1)
    _fill = _grown.difference(LAND).intersection(_near.buffer(55))
    _before = LAND.area
    LAND = Polygon(max(parts(unary_union([LAND, _fill, _F.buffer(45, cap_style=2)]).buffer(20, join_style=2).buffer(-20, join_style=2).simplify(4)), key=lambda p: p.area).exterior)
    print(f'filled out to the freeways: {(LAND.area - _before) / 1e6:.2f} km2')
# and streets asked for whole that run out past the line (Elizabeth Road, west of Maple), with ~90 m each side for the
# houses on them; their houses come from OpenStreetMap where the city has no footprints (Buildings below)
WHOLE_STREETS = ('Elizabeth Road',)
_ws = [LineString([xz(g['lon'], g['lat']) for g in e['geometry']])
       for e in json.load(open(os.path.join(REF, 'osm.json')))['elements']
       if e['type'] == 'way' and 'geometry' in e and e.get('tags', {}).get('name') in WHOLE_STREETS and e.get('tags', {}).get('highway')]
if _ws:
    LAND = Polygon(max(parts(unary_union([LAND] + [g.buffer(90) for g in _ws]).buffer(30, join_style=2).buffer(-30, join_style=2).simplify(4)), key=lambda p: p.area).exterior)
    print(f'whole streets taken into town: {len(_ws)} ways, {sum(g.length for g in _ws):.0f} m')
LAND_P = prep(LAND)
X0, Z0, X1, Z1 = [math.floor(v) if i < 2 else math.ceil(v) for i, v in enumerate(LAND.bounds)]
# The middle of town, drawn at full detail (downtown, campus, Kerrytown, the Old West Side, Burns Park, the big parks,
# the area the game first covered); beyond it the outer neighborhoods (GEO.core, read by the game to draw less there)
CORE = box(-2733, -3109, 4528, 3031)


def inland(x, z):
    return X0 < x < X1 and Z0 < z < Z1 and LAND_P.contains(Point(x, z))


print(f'land {X0}..{X1} x {Z0}..{Z1}, {LAND.area / 1e6:.1f} km2 ({LIMITS.area / 1e6:.1f} within the limits)')


# --- OpenStreetMap ------------------------------------------------------------------------------------------------------
osm = json.load(open(os.path.join(REF, 'osm.json')))['elements']
ways = [e for e in osm if e['type'] == 'way' and 'geometry' in e]
rels = [e for e in osm if e['type'] == 'relation']
nodes = [e for e in osm if e['type'] == 'node']


def way_pts(w):
    return [xz(p['lon'], p['lat']) for p in w['geometry'] if p]


def area_of(e):
    """Polygon of a closed way or a multipolygon relation (outer minus inner rings)."""
    if e['type'] == 'way':
        pts = way_pts(e)
        if len(pts) < 4 or pts[0] != pts[-1]:
            return None
        p = make_valid(Polygon(pts))
        return p if not p.is_empty else None
    outers, inners = [], []
    for m in e.get('members', []):
        if m.get('type') != 'way' or 'geometry' not in m:
            continue
        pts = [xz(p['lon'], p['lat']) for p in m['geometry'] if p]
        if len(pts) < 2:
            continue
        (inners if m.get('role') == 'inner' else outers).append(LineString(pts))
    if not outers:
        return None
    o = unary_union(list(polygonize(unary_union(outers))))
    if inners:
        o = o.difference(unary_union(list(polygonize(unary_union(inners)))))
    o = make_valid(o)
    return o if not o.is_empty else None


# --- Streets ------------------------------------------------------------------------------------------------------------
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
ABBR = [('Street', 'St'), ('Avenue', 'Ave'), ('Boulevard', 'Blvd'), ('Drive', 'Dr'), ('Road', 'Rd'), ('Place', 'Pl'),
        ('Court', 'Ct'), ('Lane', 'Ln'), ('Parkway', 'Pkwy'), ('Circle', 'Cir'), ('Terrace', 'Ter'), ('Highway', 'Hwy'),
        ('North ', 'N '), ('South ', 'S '), ('East ', 'E '), ('West ', 'W ')]


def short_name(n):
    for a, b in ABBR:
        n = n.replace(a, b) if not a.endswith(' ') else (b + n[len(a):] if n.startswith(a) else n)
    return n


def road_spec(t):
    hw = t['highway']
    link = hw.endswith('_link')
    base = hw.replace('_link', '')
    oneway = t.get('oneway') in ('yes', 'true', '1') or hw in ('motorway',) or t.get('junction') == 'roundabout'
    rev = t.get('oneway') == '-1'
    try:
        lanes = int(str(t.get('lanes', '')).split(';')[0])
    except ValueError:
        lanes = 0
    if not lanes:
        lanes = 1 if (link or oneway and base in ('residential', 'unclassified', 'living_street', 'tertiary')) else \
            {'motorway': 2, 'trunk': 4, 'primary': 4, 'secondary': 2}.get(base, 2)
    if link:
        w = max(6.5, lanes * 3.6 + 1.5)
    elif base in ('motorway', 'trunk'):
        w = lanes * 3.7 + 3
    elif base == 'primary':
        w = max(13.0, lanes * 3.4 + 1.5)
    elif base == 'secondary':
        w = max(11.0, lanes * 3.4 + 1.5)
    elif base == 'tertiary':
        w = max(9.5, lanes * 3.3 + 1.5)
    else:
        w = 6.5 if oneway else 8.5
    try:
        tw = float(str(t.get('width', '')).replace('m', '').strip())
        if 5 <= tw <= 40:
            w = tw
    except ValueError:
        pass
    d = (-1 if rev else 1) if (oneway or rev) else 0
    bike = bike_spec(t, oneway or rev)
    if 'width' not in t:  # room for the painted bike lanes along the curbs
        w += bike_room(bike)
    return round(w, 1), lanes, d, base in ('motorway', 'trunk') or (link and base in ('motorway', 'trunk'))


# The street's class, as its paint shows it: 0 freeway, 1 primary, 2 secondary, 3 tertiary, 4 residential, 5 ramp,
# 6 a street without lane lines
def road_class(t):
    hw = t['highway']
    if t.get('lane_markings') == 'no':
        return 6
    if hw.endswith('_link'):
        return 5
    return {'motorway': 0, 'trunk': 0, 'primary': 1, 'secondary': 2, 'tertiary': 3}.get(hw, 4)


# Bike lanes painted on the street (OpenStreetMap cycleway*, then the city's Non-Motorized Routes over them, below), as
# bits: a lane on the way's right (1) and left (2) as drawn, shared-lane arrows (4 right, 8 left), a painted buffer
# (16), a protected lane's flex posts in that buffer (32) or a low concrete curb there (64), advisory lanes (128: dashed,
# both sides, no centre line, inside the street's width), a signed bike route with no paint (256), and a two-way lane
# (512) on the side its 1 or 2 says
def bike_room(b):
    if b & 128:
        return 0.0
    lane = 3.0 if b & 512 else 1.7
    buf = 0.9 if b & (16 | 32) else 0.6 if b & 64 else 0.0
    return sum(lane + buf for side in (1, 2) if b & side)


def bike_spec(t, oneway):
    def kind(v):
        return 1 if v in ('lane', 'opposite_lane') else 4 if v == 'shared_lane' else 0
    r = l = 0
    if t.get('cycleway:both'):
        r = l = kind(t['cycleway:both'])
    if t.get('cycleway'):
        k = kind(t['cycleway'])
        r = r or k
        if not oneway:
            l = l or k
    if t.get('cycleway:right'):
        r = kind(t['cycleway:right'])
    if t.get('cycleway:left'):
        l = kind(t['cycleway:left'])
    buf = any(v == 'yes' for k, v in t.items() if k.startswith('cycleway') and 'buffer' in k)
    return (1 if r == 1 else 4 if r == 4 else 0) | (2 if l == 1 else 8 if l == 4 else 0) | (16 if buf and (r == 1 or l == 1) else 0)


def int_tag(t, k):
    try:
        return int(str(t.get(k, '')).split(';')[0])
    except ValueError:
        return 0


def mph(t):
    v = str(t.get('maxspeed', ''))
    try:
        n = float(v.split()[0])
    except (ValueError, IndexError):
        return 0
    return round(n if 'mph' in v else n / 1.609)


# Parking lanes along the curbs (OpenStreetMap parking:both / :left / :right), on the way's right (1) and left (2) as
# drawn. Untagged, only the meters along Main, Liberty, Washington, State and South University in the middle of town
# have one; every other curb is kept clear. Each is 2.4 m wide, added to the street's width where none is tagged.
PARK_W = 2.4
PARK_TOWN = (-480, 1500, -760, 820)
METERED = re.compile(r'^(North |South |East |West )?(Main|Liberty|Washington|State) Street$|^South University Avenue$')


def park_spec(t, pts):
    def kind(v):
        return None if v is None else 0 if v in ('no', 'separate', 'no_parking', 'no_stopping', 'fire_lane') else 1
    both = kind(t.get('parking:both'))
    r = kind(t.get('parking:right'))
    l = kind(t.get('parking:left'))
    r = both if r is None else r
    l = both if l is None else l
    if r is None and l is None:
        mx, mz = pts[len(pts) // 2]
        town = PARK_TOWN[0] < mx < PARK_TOWN[1] and PARK_TOWN[2] < mz < PARK_TOWN[3]
        if town and METERED.match(t.get('name', '')) and t['highway'] in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified'):
            r = l = 1
    return (1 if r else 0) | (2 if l else 0)


# A street closed for work is mapped as highway=construction while it lasts, with what it'll be in construction= (or
# nothing): it's still there, so it goes in as that, or as what the rest of the street of that name is. The city's
# closures (city-closures.js) shut the block while the work's on.
usual = {}
for w in ways:
    t = w.get('tags', {})
    if t.get('highway') in DRIVE and t.get('name'):
        usual.setdefault(t['name'], {}).setdefault(t['highway'], 0)
        usual[t['name']][t['highway']] += 1
for w in ways:
    t = w.get('tags', {})
    if t.get('highway') != 'construction' or t.get('area') == 'yes':
        continue
    was = t.get('construction')
    if was not in DRIVE:
        was = max(usual[t['name']].items(), key=lambda kv: kv[1])[0] if was is None and t.get('name') in usual else None
    if was:
        w['tags'] = {**t, 'highway': was}

drive = []
for w in ways:
    t = w.get('tags', {})
    if t.get('highway') not in DRIVE or t.get('area') == 'yes' or t.get('access') in ('private', 'no'):
        continue
    # a golf course's cart paths are mapped as service roads, but they're paths for carts and walkers (drawn by golf.js)
    if t.get('golf') in ('cartpath', 'path'):
        continue
    pts = way_pts(w)
    if len(pts) < 2:
        continue
    # (Lamp: the freeways and their ramps whole, as far as the map's data has them, so they run on out past the town's
    # edge into the country rather than ending 150 m past it: city-config.js keeps their lanes drivable and paved)
    if not LineString(pts).intersects(LAND.buffer(150)) and t.get('highway') not in ('motorway', 'trunk', 'motorway_link', 'trunk_link'):
        continue
    wd, lanes, d, hw = road_spec(t)
    park = 0 if hw else park_spec(t, pts)
    if park and 'width' not in t:
        wd = round(wd + PARK_W * ((park & 1) + (park >> 1)), 1)
    name = short_name(t.get('name', '') or t.get('ref', ''))
    drive.append({'id': w['id'], 'nodes': w['nodes'], 'pts': pts, 'w': wd, 'lanes': lanes, 'dir': d, 'hw': hw,
                  'name': name, 'tunnel': t.get('tunnel') in ('yes',), 'bridge': t.get('bridge') == 'yes',
                  'layer': t.get('layer', '0'), 'cls': road_class(t), 'bike': bike_spec(t, d != 0),
                  'lf': int_tag(t, 'lanes:forward'), 'lb': int_tag(t, 'lanes:backward'), 'mph': mph(t), 'park': park,
                  'wt': 'width' in t})
print(f'{len(drive)} drivable ways')

# Speed limits where OpenStreetMap has none: the city's road centerlines (RoadsSpeedlimitCrash layer 1, SpeedLimit),
# the nearest centerline within 12 m of the way's middle that runs the same way
cl_path = os.path.join(REF, 'speed/centerlines.geojson')
if os.path.exists(cl_path):
    from shapely.strtree import STRtree
    cl_lines, cl_mph = [], []
    for f in json.load(open(cl_path))['features']:
        v = (f.get('properties') or {}).get('SpeedLimit') or 0
        g = f.get('geometry') or {}
        if not v or g.get('type') not in ('LineString', 'MultiLineString'):
            continue
        for part in ([g['coordinates']] if g['type'] == 'LineString' else g['coordinates']):
            if len(part) >= 2:
                cl_lines.append(LineString([xz(lon, lat) for lon, lat in part[:]]))
                cl_mph.append(int(v))
    tree = STRtree(cl_lines)
    filled = 0
    for r in drive:
        if r['mph'] or r['hw']:
            continue
        line = LineString(r['pts'])
        mid = line.interpolate(0.5, normalized=True)
        a, b = line.interpolate(max(0, line.length / 2 - 3)), line.interpolate(min(line.length, line.length / 2 + 3))
        tx, tz = b.x - a.x, b.y - a.y
        tl = math.hypot(tx, tz) or 1
        best, bd = None, 12.0
        for i in tree.query(mid.buffer(12)):
            c = cl_lines[i]
            d = c.distance(mid)
            if d >= bd:
                continue
            u = c.project(mid)
            ca, cb = c.interpolate(max(0, u - 3)), c.interpolate(min(c.length, u + 3))
            cx, cz = cb.x - ca.x, cb.y - ca.y
            if abs(cx * tx + cz * tz) / ((math.hypot(cx, cz) or 1) * tl) < 0.85:
                continue
            best, bd = cl_mph[i], d
        if best:
            r['mph'] = best
            filled += 1
    print(f'{filled} streets given the city\'s speed limit')

# Road graph: split ways at nodes shared with another way
use = {}
for r in drive:
    for n in r['nodes']:
        use[n] = use.get(n, 0) + 1
gnodes, gnode_id, gnames, gname_id, glinks = [], {}, [], {}, []
glink_way = []  # each link's way and its points, for matching the city's routes to it


def gnode(nid, p):
    if nid not in gnode_id:
        gnode_id[nid] = len(gnodes)
        gnodes.append(p)
    return gnode_id[nid]


def gname(n):
    if n not in gname_id:
        gname_id[n] = len(gnames)
        gnames.append(n)
    return gname_id[n]


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    ax, az = pts[0]
    bx, bz = pts[-1]
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1e-9
    best, bi = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L
        if d > best:
            best, bi = d, i
    if best <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:bi + 1], eps)[:-1] + rdp(pts[bi:], eps)


for r in drive:
    ns, ps = r['nodes'], r['pts']
    start = 0
    for i in range(1, len(ns)):
        if i == len(ns) - 1 or use.get(ns[i], 0) > 1:
            seg = ps[start:i + 1]
            if len(seg) >= 2 and ns[start] != ns[i]:
                a, b = gnode(ns[start], seg[0]), gnode(ns[i], seg[-1])
                line = rdp(seg, 0.4)
                glinks.append([a, b, gname(r['name']), r['w'], r['lanes'], r['dir'], flat(line[1:-1]),
                               r['cls'], r['bike'], r['lf'], r['lb'], r['mph'], r['park']])
                glink_way.append((r, line))
            start = i

# --- The city's Non-Motorized Routes (ckan.a2gov.org, no license stated; fetch-annarbor.py): each bike lane, buffered,
# protected, advisory or two-way lane, sharrow and signed bike route matched to the road graph's link it runs along
# (within 12 m of the link's middle and in line with it, as the speed limits are). Where the city has one, it wins over
# OpenStreetMap's tags; where it has nothing, OSM's stay. The street widens or narrows by the lanes it gains or loses
# (where OSM gives no width).
NM_PATH = os.path.join(REF, 'nonmotorized/aa_nonmotorized.geojson')
nm_feats = []
if os.path.exists(NM_PATH):
    for f in json.load(open(NM_PATH))['features']:
        g, pr = f.get('geometry') or {}, f.get('properties') or {}
        if g.get('type') not in ('LineString', 'MultiLineString'):
            continue
        for part in ([g['coordinates']] if g['type'] == 'LineString' else g['coordinates']):
            pts_ = [xz(c[0], c[1]) for c in part]
            if len(pts_) >= 2 and LineString(pts_).length > 1:
                nm_feats.append((LineString(pts_), pr))
NM_RANK = {'Protected Bike': 7, 'Buffered Bike': 6, 'Bike Lane': 5, 'Advisory Bike': 4, 'Sharrow': 3,
           'Designated Bike': 2, 'Suggested Bike': 1}
COMPASS = {'North': (0, -1), 'South': (0, 1), 'East': (1, 0), 'West': (-1, 0), 'NE': (0.7, -0.7), 'NW': (-0.7, -0.7),
           'SE': (0.7, 0.7), 'SW': (-0.7, 0.7), 'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}
nm_street = [(l, p) for l, p in nm_feats if p.get('NonMotorizedType') in NM_RANK]
nm_route_links = []  # links that carry a signed bike route, for the signs
if nm_street:
    from shapely.strtree import STRtree as _STR
    nm_tree = _STR([l for l, _ in nm_street])
    kinds_n = {}
    changed = widened = 0
    for li, (r, line) in enumerate(glink_way):
        if r['hw']:
            continue
        L = LineString(line)
        if L.length < 4:
            continue
        mid = L.interpolate(0.5, normalized=True)
        a_, b_ = L.interpolate(max(0, L.length / 2 - 3)), L.interpolate(min(L.length, L.length / 2 + 3))
        tx, tz = b_.x - a_.x, b_.y - a_.y
        tl = math.hypot(tx, tz) or 1
        tx, tz = tx / tl, tz / tl
        rx, rz = -tz, tx  # the link's right, as drawn
        best = None
        for i in nm_tree.query(mid.buffer(12)):
            c, pr = nm_street[i]
            d = c.distance(mid)
            if d >= 12:
                continue
            u = c.project(mid)
            ca, cb = c.interpolate(max(0, u - 3)), c.interpolate(min(c.length, u + 3))
            cx, cz = cb.x - ca.x, cb.y - ca.y
            if abs(cx * tx + cz * tz) / (math.hypot(cx, cz) or 1) < 0.85:
                continue
            key = (NM_RANK[pr['NonMotorizedType']], -d)
            if best is None or key > best[0]:
                best = (key, c, pr)
        if not best:
            continue
        _, c, pr = best
        kind, side = pr['NonMotorizedType'], (pr.get('SideOfStreet') or '').strip()
        # which of the link's sides: both, its right (1) or its left (2)
        two = side.startswith('2Way')
        comp = COMPASS.get(side[4:] if two else side)
        if comp:
            dot = comp[0] * rx + comp[1] * rz
            if abs(dot) < 0.3:  # a compass side across the street's run: where the city's line lies
                q = c.interpolate(c.project(mid))
                off = (q.x - mid.x) * rx + (q.y - mid.y) * rz
                sides = 3 if abs(off) < 1 else (1 if off > 0 else 2)
            else:
                sides = 1 if dot > 0 else 2
        elif side in ('', 'None') and r['dir'] != 0:
            sides = 1 if r['dir'] > 0 else 2  # a one-way's: on the right as it's driven
        else:
            sides = 3
        if kind in ('Designated Bike', 'Suggested Bike'):
            bits = 256
            nm_route_links.append(li)
        elif kind == 'Sharrow':
            bits = (4 if sides & 1 else 0) | (8 if sides & 2 else 0)
        elif kind == 'Advisory Bike':
            bits = 1 | 2 | 128
        else:
            bits = sides
            if two and sides != 3:
                bits |= 512
            if kind == 'Buffered Bike':
                bits |= 16
            elif kind == 'Protected Bike':
                bits |= 64 if pr.get('LocationType') == 'CurbSeparated' else 32
        kinds_n[kind] = kinds_n.get(kind, 0) + 1
        g = glinks[li]
        if g[8] != bits:
            changed += 1
            if not r['wt']:
                nw = round(g[3] - bike_room(g[8]) + bike_room(bits), 1)
                widened += nw != g[3]
                g[3] = max(4.5, nw)
            g[8] = bits
    print(f'the city\'s bike routes on {sum(kinds_n.values())} links ({", ".join(f"{v} {k}" for k, v in sorted(kinds_n.items()))}); '
          f'{changed} differ from OSM\'s, {widened} streets widened or narrowed')

# Small green BIKE ROUTE signs along the city's signed routes (Designated and Suggested Bike): at each end of each
# route and every 400 m along it, at the right-hand curb facing the riders coming, as flat [x, z, heading] (heading the
# way the sign faces, radians from +z toward +x)
bike_signs = []
if nm_street:
    routes = shapely.ops.linemerge(unary_union([l for l, p in nm_street if p['NonMotorizedType'] in ('Designated Bike', 'Suggested Bike')]))
    route_lines = [g for g in getattr(routes, 'geoms', [routes]) if g.geom_type == 'LineString' and g.length > 30]
    link_lines = [LineString(glink_way[li][1]) for li in nm_route_links]
    lt = shapely.STRtree(link_lines) if link_lines else None
    placed = []
    for rl in route_lines:
        n = max(1, round(rl.length / 400))
        for k in range(n + 1):
            for dirn in ((1,) if 0 < k < n else (1, -1)):
                u = min(max(rl.length * k / n, 12), rl.length - 12)
                if (k == 0 and dirn == -1) or (k == n and dirn == 1):
                    continue
                p = rl.interpolate(u)
                pa, pb = rl.interpolate(max(0, u - 4)), rl.interpolate(min(rl.length, u + 4))
                hx, hz = (pb.x - pa.x) * dirn, (pb.y - pa.y) * dirn
                hl = math.hypot(hx, hz) or 1
                hx, hz = hx / hl, hz / hl
                if lt is None:
                    continue
                near = [i for i in lt.query(p.buffer(14)) if link_lines[i].distance(p) < 14]
                if not near:
                    continue
                li = nm_route_links[min(near, key=lambda i: link_lines[i].distance(p))]
                ll = link_lines[min(near, key=lambda i: link_lines[i].distance(p))]
                q = ll.interpolate(ll.project(p))
                half = glinks[li][3] / 2
                x, z = q.x - hz * (half + 0.9), q.y + hx * (half + 0.9)  # the curb on the rider's right
                if any(math.hypot(x - a, z - b) < 60 for a, b in placed):
                    continue
                placed.append((x, z))
                bike_signs += [r1(x), r1(z), round(math.atan2(-hx, -hz), 2)]
    print(f'{len(bike_signs) // 3} bike route signs')
roadGraph = {'nodes': [v for p in gnodes for v in (r1(p[0]), r1(p[1]))], 'links': glinks, 'names': gnames}
print(f'road graph {len(gnodes)} nodes {len(glinks)} links')

roads = [[r['name'], r['w'], r['dir'], r['lanes'], 1 if r['hw'] else 0, flat(rdp(r['pts'], 0.5))]
         for r in drive if r['name']]

# --- Water ----------------------------------------------------------------------------------------------------------------
water_polys = []
for e in ways + rels:
    t = e.get('tags', {})
    if t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') == 'reservoir':
        if t.get('water') in ('wastewater',):
            continue
        g = area_of(e)
        if g is not None:
            water_polys.append(g)
water = unary_union(water_polys).intersection(LAND.buffer(400)) if water_polys else Polygon()
print(f'water {water.area / 1e6:.2f} km2')

# --- Roads' surface & blocks ----------------------------------------------------------------------------------------------
surface = [LineString(r['pts']).buffer(r['w'] / 2, quad_segs=4) for r in drive if not r['tunnel']]
road_union = unary_union(surface)
water_open = water.difference(unary_union([LineString(r['pts']).buffer(r['w'] / 2 + 1.5, quad_segs=4)
                                           for r in drive if not r['bridge']]))

# Bridges over the water: the streets' (0) and railways' (1), which carry what's on them over the river on a deck
# (their ground is raised between the banks, terrain.js), and the footbridges (2), drawn as decks of their own over
# the water. The water runs on under them all, open to a kayak. [kind, width, x, z, ...]
bridges = []
for r in drive:
    if r['bridge'] and not r['tunnel'] and LineString(r['pts']).intersects(water):
        bridges.append([0, r['w']] + flat(r['pts']))
for e in ways:
    t = e.get('tags', {})
    if t.get('bridge') != 'yes' or t.get('tunnel') or t.get('area') == 'yes':
        continue
    rail = t.get('railway') == 'rail' and t.get('usage') != 'test'
    foot = t.get('highway') in ('path', 'footway', 'cycleway', 'pedestrian', 'track', 'bridleway')
    if not (rail or foot):
        continue
    pts = way_pts(e)
    if len(pts) < 2 or not LineString(pts).intersects(water):
        continue
    if rail:
        bridges.append([1, 5.0] + flat(pts))
    else:
        try:
            wd = float(t.get('width', '').split()[0])
        except (ValueError, IndexError):
            wd = 0
        bridges.append([2, round(max(1.8, min(4.5, wd or 2.8)), 1)] + flat(pts))
print(f'{len(bridges)} bridges over the water:', ', '.join(f'{sum(1 for b in bridges if b[0] == k)} {n}'
                                                        for k, n in ((0, 'street'), (1, 'rail'), (2, 'foot'))))

# Parks & green spaces
GREEN = []
for e in ways + rels:
    t = e.get('tags', {})
    kind = None
    if t.get('leisure') in ('park', 'nature_reserve', 'garden', 'recreation_ground', 'common'):
        kind = 'park'
    elif t.get('leisure') == 'golf_course':
        kind = 'golf'
    elif t.get('natural') == 'wood' or t.get('landuse') == 'forest':
        kind = 'wood'
    elif t.get('landuse') == 'cemetery':
        kind = 'cemetery'
    if not kind:
        continue
    g = area_of(e)
    if g is None:
        continue
    g = g.intersection(LAND)
    if g.is_empty or g.area < 200:
        continue
    GREEN.append({'name': t.get('name', ''), 'kind': kind, 'geom': g})
# the airfield's grass, as a park (no sidewalks or yards; airport.js paves its runways, taxiways and aprons over it)
GREEN.append({'name': 'Ann Arbor Municipal Airport', 'kind': 'park', 'geom': FENCE.intersection(LAND)})
parks_union = unary_union([g['geom'] for g in GREEN]) if GREEN else Polygon()
print(f'{len(GREEN)} green spaces, {parks_union.area / 1e6:.2f} km2')

parking = []
for e in ways + rels:
    t = e.get('tags', {})
    if t.get('amenity') == 'parking' and t.get('parking') not in ('underground', 'multi-storey', 'rooftop'):
        g = area_of(e)
        if g is not None and g.area > 150:
            parking.append(g)
parking_union = unary_union(parking).intersection(LAND) if parking else Polygon()

# --- Buildings (City of Ann Arbor footprints) -------------------------------------------------------------------------------
bj = json.load(open(os.path.join(REF, 'aa_bldg.geojson')))
KIND = {'Residential': 1, 'Commercial': 2, 'Office': 3, 'Public': 4}
OWNER_KIND = {'University': 5, 'City': 6, 'County': 6, 'Federal': 6, 'Schools': 6, 'Parks': 6}
buildings = []
for f in bj['features']:
    g = f['geometry']
    if not g:
        continue
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    shp = []
    for p in polys:
        rings = [[xz(lon, lat) for lon, lat, *_ in ring] for ring in p]
        if len(rings[0]) < 4:
            continue
        shp.append(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
    if not shp:
        continue
    geom = make_valid(MultiPolygon(shp) if len(shp) > 1 else shp[0])
    c = geom.representative_point()
    if not LAND.contains(c) or geom.area < 12 or FENCE.contains(c):  # the airport's are airport.js's own
        continue
    pr = f['properties']
    h = (pr.get('ABG_BLD_HG') or 0) * 0.3048
    kind = KIND.get(pr.get('Struc_Type'), 1)
    if h < 2.5:
        h = 7 if kind == 1 else 9
    # who owns it: 5 the University (campus brick & limestone), 6 the city, county, schools and federal government
    kind = OWNER_KIND.get(pr.get('Owned_By'), kind)
    buildings.append({'geom': geom, 'height': int(round(min(h, 120))), 'kind': kind, 'name': pr.get('Bldg_Name') or ''})
built_union = unary_union([b['geom'] for b in buildings])
# along the whole streets past the line the city has no footprints: OpenStreetMap's houses there, at a house's height
if _ws:
    _wsz = prep(unary_union([g.buffer(100) for g in _ws]))
    _added = 0
    for e in ways:
        t = e.get('tags', {})
        if 'building' not in t:
            continue
        g = area_of(e)
        if g is None or g.area < 12:
            continue
        c = g.representative_point()
        if not _wsz.contains(c) or not LAND.contains(c) or built_union.intersects(c):
            continue
        res = t.get('building') in ('yes', 'house', 'residential', 'detached', 'garage', 'shed', 'semidetached_house')
        h = float(t['height']) if re.fullmatch(r'[0-9.]+', t.get('height', '')) else (3.5 if t.get('building') in ('garage', 'shed') else 7 if res else 9)
        buildings.append({'geom': g, 'height': int(round(min(h, 120))), 'kind': 1 if res else 2, 'name': t.get('name', '')})
        _added += 1
    built_union = unary_union([b['geom'] for b in buildings])
    print(f'{_added} OpenStreetMap buildings along the whole streets')
print(f'{len(buildings)} buildings')

# --- Blocks -----------------------------------------------------------------------------------------------------------------
SIDEWALK = 4.6
DOWNTOWN = Polygon([xz(*p) for p in [(-83.7540, 42.2840), (-83.7445, 42.2840), (-83.7445, 42.2825), (-83.7330, 42.2825),
                                     (-83.7330, 42.2730), (-83.7400, 42.2730), (-83.7400, 42.2700), (-83.7540, 42.2700)]])
landuse_paved = []
for e in ways + rels:
    t = e.get('tags', {})
    if t.get('landuse') in ('retail', 'commercial', 'industrial'):
        g = area_of(e)
        if g is not None:
            landuse_paved.append(g)
paved_union = unary_union(landuse_paved) if landuse_paved else Polygon()

blocks_geom = LAND.difference(water_open).difference(road_union)

# The city's 2023 Impervious Surfaces (every paved surface on each lot): which blocks are paved over, and later the
# driveways
import glob
IMP = os.path.join(REF, 'imperv')
paved_lots = []
for path in sorted(glob.glob(os.path.join(IMP, 'p*.json'))):
    for f in json.load(open(path))['features']:
        g = f.get('geometry')
        if not g:
            continue
        for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            rings = [[xz(lon, lat) for lon, lat, *_ in r] for r in p]
            if len(rings[0]) >= 4:
                paved_lots.append(make_valid(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4])))
imperv_arr = np.array(paved_lots)
imperv_tree = shapely.STRtree(imperv_arr)



def split_holes(p, depth=0):
    if not p.interiors or depth > 12:
        return [p]
    hx = Polygon(p.interiors[0]).centroid.x
    minx, miny, maxx, maxy = p.bounds
    out = []
    for half in (box(minx - 1, miny - 1, hx, maxy + 1), box(hx, miny - 1, maxx + 1, maxy + 1)):
        for q in parts(p.intersection(half)):
            out += split_holes(q, depth + 1)
    return out


def mask_rects(m, max_rects=8, min_side=4, min_cells=30):
    h, w = m.shape
    total = int(m.sum())
    rects, covered = [], 0
    for _ in range(max_rects):
        hist = np.zeros(w, dtype=np.int32)
        best, bb = 0, None
        for j in range(h):
            hist = np.where(m[j], hist + 1, 0)
            hl = hist.tolist() + [0]
            stack = []
            for i in range(w + 1):
                hh = hl[i]
                while stack and hl[stack[-1]] >= hh:
                    top = stack.pop()
                    height = hl[top]
                    left = stack[-1] + 1 if stack else 0
                    width = i - left
                    if height >= min_side and width >= min_side and height * width > best:
                        best = height * width
                        bb = (left, i - 1, j - height + 1, j)
                stack.append(i)
        if best < min_cells or (rects and best < total * 0.06):
            break
        i0, i1, j0, j1 = bb
        rects.append(bb)
        covered += best
        m[j0:j1 + 1, i0:i1 + 1] = False
        if covered > total * 0.93:
            break
    return rects


RES = 2.0
blocks = []
green_tree = shapely.STRtree([g['geom'] for g in GREEN]) if GREEN else None
for p in parts(blocks_geom):
    for q in split_holes(p):
        if q.area < 40:
            continue
        q = q.simplify(0.5, preserve_topology=True)
        if q.is_empty or q.geom_type != 'Polygon' or q.area < 40:
            continue
        q = orient(q, sign=-1.0)
        ring = list(q.exterior.coords)[:-1]
        minx, minz, maxx, maxz = q.bounds
        is_rect = q.area / max(1e-6, (maxx - minx) * (maxz - minz)) > 0.985
        # Lot rects inside the property line (curb minus sidewalk), on a 2 m raster
        rects = []
        prop = q.buffer(-SIDEWALK, join_style='mitre')
        if not prop.is_empty and prop.area >= 120:
            px0, pz0, px1, pz1 = prop.bounds
            nx, nz = int(math.ceil((px1 - px0) / RES)), int(math.ceil((pz1 - pz0) / RES))
            if nx >= 4 and nz >= 4:
                gx, gz = np.meshgrid(px0 + (np.arange(nx) + 0.5) * RES, pz0 + (np.arange(nz) + 0.5) * RES)
                m = shapely.contains_xy(prop, gx, gz)
                for i0, i1, j0, j1 in mask_rects(m):
                    rects.append([r1(px0 + i0 * RES), r1(px0 + (i1 + 1) * RES), r1(pz0 + j0 * RES), r1(pz0 + (j1 + 1) * RES)])
        # Share of parkland & its name
        park, park_name = 0.0, ''
        if green_tree is not None:
            best = 0
            for k in green_tree.query(q):
                inter = GREEN[k]['geom'].intersection(q).area
                park += inter
                if inter > best and GREEN[k]['name']:
                    best, park_name = inter, GREEN[k]['name']
            park = min(1.0, park / q.area)
        cover = built_union.intersection(q).area / q.area if q.area < 2e6 else 0
        # paved over: a block whose buildings and paving leave little ground (downtown's Main and State Street
        # blocks, strip malls, industry); campus, the neighborhoods and anything with real lawn keep grass
        imp = float(shapely.area(shapely.intersection(imperv_arr[imperv_tree.query(q)], q)).sum()) / q.area \
            if q.area < 3e5 else 0
        hard = max(cover, imp)  # the paving map counts the rooftops too
        paved = hard > 0.8 or cover > 0.55 or (q.intersects(DOWNTOWN) and DOWNTOWN.intersection(q).area > q.area * 0.5
                                               and hard > 0.6)
        blocks.append([flat(ring), rects, round(park, 2), park_name, 1 if is_rect else 0, None, 0 if paved else 1])
print(f'{len(blocks)} blocks ({sum(1 for b in blocks if b[6]) } with lawns)')

lawn_blocks = unary_union([Polygon(list(zip(b[0][0::2], b[0][1::2]))).buffer(-SIDEWALK, join_style='mitre') for b in blocks if b[6]])
# The green inside each lawn block's sidewalk ring, with its parking lots cut out (they're drawn as asphalt)
lawns = []
def tiled(polys, cell=120.0):
    # big lawns (parks, golf courses, campus) cut into tiles, which the page triangulates without gaps
    for p in polys:
        if p.area < cell * cell * 0.8 and len(p.exterior.coords) < 300:
            yield p
            continue
        x0, z0, x1, z1 = p.bounds
        for i in range(int(math.floor(x0 / cell)), int(math.ceil(x1 / cell))):
            for j in range(int(math.floor(z0 / cell)), int(math.ceil(z1 / cell))):
                yield from parts(p.intersection(box(i * cell, j * cell, (i + 1) * cell, (j + 1) * cell)))
for p in tiled(parts(lawn_blocks.difference(parking_union).simplify(0.6))):
    if p.area < 25:
        continue
    p = orient(p, -1.0)
    lawns.append([flat(list(p.exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors if Polygon(r).area > 20])
# The tree lawn: Ann Arbor's residential streets have a strip of grass between the curb and a narrow sidewalk
TREE_LAWN = (0.6, 2.9)  # from the curb, in meters; the sidewalk is the rest of the ring, 2.9 to SIDEWALK
strips = []
for b in blocks:
    if not b[6] or b[3]:
        continue
    q = Polygon(list(zip(b[0][0::2], b[0][1::2])))
    if q.area < 600:
        continue
    strips.append(q.buffer(-TREE_LAWN[0], join_style='mitre').difference(q.buffer(-TREE_LAWN[1], join_style='mitre')))
tree_lawns = unary_union(strips).difference(parking_union).difference(DOWNTOWN) if strips else Polygon()
n_strips = 0
for p in parts(tree_lawns.simplify(0.3)):
    if p.area < 6:
        continue
    p = orient(p, -1.0)
    lawns.append([flat(list(p.exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors if Polygon(r).area > 2])
    n_strips += 1
print(f'{len(lawns)} lawns ({n_strips} tree lawns)')

# --- Driveways & garage doors: the city's 2023 impervious surfaces (every paved surface on each lot) less its buildings
# (ImperviousSurfaces/MapServer/7, downloaded to imperv/p*.json), joined to the curb across the sidewalk and tree lawn
# each lot's paving less the buildings on it (piece by piece: one union of the whole city is too slow)
bld_geoms = [b['geom'].buffer(0.1) for b in buildings]
bld_tree = shapely.STRtree(bld_geoms)
lot_geoms = [g for g in paved_lots if not g.is_empty and g.area >= 6]
shapely.prepare(lawn_blocks)
shapely.prepare(parks_union)
park_tree = shapely.STRtree(parking)
drive_parts = []
for g in lot_geoms:
    c = g.representative_point()
    if not lawn_blocks.contains(c):
        continue
    # a park's paths are OSM's trails, drawn as clean strips; the city's traced paving there doubles them in blotches
    if parks_union.contains(c):
        continue
    hits = bld_tree.query(g)
    if len(hits):
        g = g.difference(unary_union([bld_geoms[k] for k in hits]))
    # the parking lots are drawn (and striped) on their own
    hits = park_tree.query(g)
    if len(hits):
        g = g.difference(unary_union([parking[k] for k in hits]))
    for p in parts(g.simplify(0.3)):
        if p.area >= 6 and p.is_valid:
            drive_parts.append(p)

# Joining each lot's paving to the street: the city's map stops at the lot line or short of it, so from the paving's
# nearest point to the curb (within 14 m) a strip runs straight out: a front walk (under 2.6 m across) to the sidewalk,
# a driveway (2.6 to 7 m across) over the sidewalk and tree lawn to the curb. Wider pieces (patios, paving that runs
# along the street) are left as they are.
from shapely.ops import nearest_points
curbs = [Polygon(list(zip(b[0][0::2], b[0][1::2]))) for b in blocks if b[6]]
curb_tree = shapely.STRtree(curbs)
aprons = []
curb_cuts = []
walks = 0
def leads_to_house(whole, near, ux, uz, tx, tz, cm, w):
    """Whether a strip 1.9 to 2.6 m across is a wide front walk: followed back from the street it ends just short of
    a house (its porch between), where a driveway that narrow ends at a garage or in the back yard"""
    ox, oz = near.x + tx * cm, near.y + tz * cm
    lane = Polygon([(ox + tx * w / 2 + ux, oz + tz * w / 2 + uz), (ox - tx * w / 2 + ux, oz - tz * w / 2 + uz),
                    (ox - tx * w / 2 - ux * 30, oz - tz * w / 2 - uz * 30), (ox + tx * w / 2 - ux * 30, oz + tz * w / 2 - uz * 30)])
    run = whole.intersection(lane)
    if run.is_empty:
        return False
    piece = min(parts(run), key=lambda g: g.distance(near))
    depth = max(-((x - ox) * ux + (z - oz) * uz) for x, z in piece.exterior.coords)
    for back in (0.6, 1.5, 3.0):
        pt = Point(ox - ux * (depth + back), oz - uz * (depth + back))
        for k in bld_tree.query(pt):
            if buildings[k]['geom'].area >= 90 and bld_geoms[k].contains(pt):
                return True
    return False


def join_end(p, q, whole=None):
    """One paved end facing the street: a walk to the sidewalk or a driveway to the curb"""
    global walks
    near, curb_pt = nearest_points(p, q.exterior)
    dx, dz = curb_pt.x - near.x, curb_pt.y - near.y
    d = math.hypot(dx, dz)
    if d > 18 or d < 0.8:
        return
    ux, uz = dx / d, dz / d
    tx, tz = -uz, ux
    # the paving's cross-section in the 1.5 m behind its nearest point
    strip = Polygon([(near.x + tx * 8, near.y + tz * 8), (near.x - tx * 8, near.y - tz * 8),
                     (near.x - tx * 8 - ux * 1.5, near.y - tz * 8 - uz * 1.5),
                     (near.x + tx * 8 - ux * 1.5, near.y + tz * 8 - uz * 1.5)])
    sec = p.intersection(strip)
    if sec.is_empty:
        return
    # the piece of the section around the nearest point (a walk and a driveway side by side are two)
    pieces = [g for g in parts(sec) if g.distance(near) < 0.3] or parts(sec)
    proj = [(x - near.x) * tx + (z - near.y) * tz for g in pieces for x, z in g.exterior.coords]
    t0, t1 = min(proj), max(proj)
    w = t1 - t0
    if w < 0.7:
        return
    if w > 7.2:  # a walk and driveway joined, or a wide pad: a driveway out from where it comes nearest
        t0, t1, w = -1.5, 1.5, 3.0
    walk = w < 1.9  # the map draws some single driveways barely 2 m wide
    if not walk and w < 2.6 and whole is not None:
        walk = leads_to_house(whole, near, ux, uz, tx, tz, (t0 + t1) / 2, w)
    stop = d - (SIDEWALK - 0.3) if walk else d - 0.25  # how far out from the paving's edge (a driveway's ramp does the rest)
    if stop < 0.3:
        return True  # already at the street
    if walk:
        walks += 1
        w = max(1.0, min(1.5, w))
    else:
        w = max(2.7, w)
    cm = (t0 + t1) / 2
    cx, cz = near.x + tx * cm - ux * 0.4, near.y + tz * cm - uz * 0.4
    L = stop + 0.4
    if not walk:
        # the curb cut: where the driveway's middle meets the curb, which way the street is, and how wide
        curb_cuts.append([r1(cx + ux * (d + 0.4)), r1(cz + uz * (d + 0.4)), round(ux, 3), round(uz, 3), r1(w)])
    aprons.append(Polygon([(cx + tx * w / 2, cz + tz * w / 2), (cx - tx * w / 2, cz - tz * w / 2),
                           (cx - tx * w / 2 + ux * L, cz - tz * w / 2 + uz * L),
                           (cx + tx * w / 2 + ux * L, cz + tz * w / 2 + uz * L)]))
    return True


joined = set()
for i, p in enumerate(drive_parts):
    ks = curb_tree.query(p.buffer(18))
    if not len(ks):
        continue
    k = min(ks, key=lambda k: curbs[k].exterior.distance(p))
    q = curbs[k]
    if q.area < 200:
        continue
    dmin = q.exterior.distance(p)
    if dmin > 18:
        continue
    # each separate end of the paving within 3 m of its nearest approach to the street (a front walk and a driveway
    # are often one piece in the city's map, joined across the front of the house)
    front = p.intersection(q.exterior.buffer(dmin + 3.0))
    ends = [e for e in parts(front) if e.area >= 1.0] if not front.is_empty else []
    for e in ends or [p]:
        if join_end(e, q, p):
            joined.add(i)
print(f'{walks} front walks joined to the sidewalk, {len(aprons) - walks} driveways to the curb')
# Tidied for drawing: only paving that reaches the street, or a garage, stays (back patios, sheds' aprons and the
# odd bits the map traces around a yard read as dirty patches from above); each piece that is nearly a rectangle
# becomes one, and the rest are simplified to clean straight edges
small_blds = [k for k, b in enumerate(buildings) if b['geom'].area < 90]
garage_tree = shapely.STRtree([bld_geoms[k].buffer(1.0) for k in small_blds])
def tidy(p):
    r = p.minimum_rotated_rectangle
    if r.area > 0 and p.area / r.area > 0.72:
        p = r
    else:
        p = make_valid(p.simplify(0.6)).buffer(-0.4, join_style=2).buffer(0.4, join_style=2)
    p = make_valid(p)
    if p.is_empty:
        return p
    hits = bld_tree.query(p)
    if len(hits):
        try:
            p = p.difference(unary_union([bld_geoms[k] for k in hits]))
        except shapely.errors.GEOSException:
            p = p.buffer(0).difference(unary_union([bld_geoms[k].buffer(0) for k in hits]).buffer(0))
    return p
kept = [tidy(p) for i, p in enumerate(drive_parts) if i in joined or p.area > 150 or len(garage_tree.query(p, predicate='intersects'))]
print(f'{len(kept)} of {len(drive_parts)} paved pieces kept')
driveways = []
for p in kept + [a.difference(unary_union([bld_geoms[k] for k in bld_tree.query(a)])) if len(bld_tree.query(a)) else a for a in aprons]:
  for p in parts(p):
    if p.area < 6:
        continue
    p = orient(p, -1.0)
    driveways.append([flat(list(p.exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors if Polygon(r).area > 1])
print(f'{len(driveways)} driveways & paved yards, {len(aprons)} aprons')
# Each curb cut where its driveway really meets the curb, as wide as it is there: the pieces above were tidied and cut
# by the buildings after the cuts were placed, so a cut is kept only where the drawn paving runs over the tree lawn to
# it, and is centred on that paving and given its width
drawn = [Polygon(list(zip(d[0][0::2], d[0][1::2]))) for d in driveways]
drawn = [g if g.is_valid else g.buffer(0) for g in drawn]
drawn_tree = shapely.STRtree(drawn)
cuts = []
for cx, cz, ux, uz, w in curb_cuts:
    tx, tz = -uz, ux
    bx, bz = cx - ux * 1.0, cz - uz * 1.0  # a metre in from the curb, over the tree lawn
    probe = LineString([(bx - tx * 6, bz - tz * 6), (bx + tx * 6, bz + tz * 6)])
    best = None
    for k in drawn_tree.query(probe):
        sec = drawn[k].intersection(probe)
        for g in ([sec] if sec.geom_type == 'LineString' else getattr(sec, 'geoms', [])):
            if g.geom_type != 'LineString' or g.length < 2.2:
                continue
            ts = [(x - bx) * tx + (z - bz) * tz for x, z in g.coords]
            t0, t1 = min(ts), max(ts)
            dist = 0 if t0 <= 0 <= t1 else min(abs(t0), abs(t1))
            if dist < 1.5 and (best is None or dist < best[0]):
                best = (dist, t0, t1)
    if best is None:
        continue
    _, t0, t1 = best
    t0, t1 = max(t0, -4.0), min(t1, 4.0)
    m = (t0 + t1) / 2
    cuts.append([r1(cx + tx * m), r1(cz + tz * m), ux, uz, r1(max(2.4, t1 - t0))])
print(f'{len(cuts)} of {len(curb_cuts)} curb cuts meet their driveway')
curb_cuts = cuts
# A garage door on each wall of a house or garage that a paved piece at least a car wide runs up to
garage_doors = []
drive_tree = shapely.STRtree(drive_parts)
for bd in buildings:
    if bd['kind'] != 1 or bd['height'] > 14:
        continue
    g = bd['geom']
    poly = max(parts(g), key=lambda q: q.area)
    ring = list(orient(poly, 1.0).exterior.coords)
    near = [drive_parts[k] for k in drive_tree.query(g.buffer(0.8))]
    if not near:
        continue
    best = None
    for i in range(len(ring) - 1):
        (x0, z0), (x1, z1) = ring[i], ring[i + 1]
        L = math.hypot(x1 - x0, z1 - z0)
        if L < 2.8:
            continue
        ux, uz = (x1 - x0) / L, (z1 - z0) / L
        nx, nz = uz, -ux  # outward (counter-clockwise in x, z)
        band = Polygon([(x0, z0), (x1, z1), (x1 + nx * 1.2, z1 + nz * 1.2), (x0 + nx * 1.2, z0 + nz * 1.2)])
        if not band.is_valid:
            continue
        hit = unary_union([n.intersection(band) for n in near])
        if hit.is_empty:
            continue
        # how far along the wall the pavement touches it
        ts = [((x - x0) * ux + (z - z0) * uz) for x, z in (hit.exterior.coords if hit.geom_type == 'Polygon'
                                                           else [c for q in parts(hit) for c in q.exterior.coords])]
        if not ts:
            continue
        t0, t1 = max(0, min(ts)), min(L, max(ts))
        if t1 - t0 < 2.6 or hit.area < 2.2:
            continue
        # the pavement must run out from the wall: a car's length of it within 6 m
        reach = unary_union(near).intersection(Polygon([(x0 + ux * t0, z0 + uz * t0), (x0 + ux * t1, z0 + uz * t1),
                                                         (x0 + ux * t1 + nx * 6, z0 + uz * t1 + nz * 6),
                                                         (x0 + ux * t0 + nx * 6, z0 + uz * t0 + nz * 6)])).area
        if reach < (t1 - t0) * 4:
            continue
        if not best or reach > best[0]:
            best = (reach, x0, z0, ux, uz, t0, t1)
    if best:
        _, x0, z0, ux, uz, t0, t1 = best
        w = min(t1 - t0 - 0.4, 5.6 if t1 - t0 > 5.6 else 2.8)
        m = (t0 + t1) / 2
        garage_doors += [r1(x0 + ux * (m - w / 2)), r1(z0 + uz * (m - w / 2)), r1(x0 + ux * (m + w / 2)), r1(z0 + uz * (m + w / 2))]
print(f'{len(garage_doors) // 4} garage doors')

# --- Trees: the city's street trees, plus woods, parks and yards ------------------------------------------------------
tj = json.load(open(os.path.join(REF, 'aa_trees.geojson')))
street_trees = set()
# Each tree's kind, as the game draws it (trees.js SPECIES): 0 sycamore / plane, 1 honeylocust, 2 elm, 3 maple,
# 4 oak, 5 small flowering tree, 6 evergreen; 255 not known. Its height from the survey's band (feet), in metres.
KIND_OF = {}
for k, names in enumerate([
        'sycamoreplanetree sycamore/planetree planetree/sycamore planetree tuliptree ginkgo sweetgum poplar/cottonwood '
        'poplarcottonwood aspen/poplar aspen dawn-redwood dawn redwood baldcypress cottonwood',
        'honeylocust locust coffeetree yellowwood maackia goldenrain goldenraintree pagodatree corktree '
        'tree-of-heaven sumac',
        'elm hackberry zelkova willow ash mulberry',
        'maple linden hornbeam hophornbeam katsura tupeloblackgum tupelo/blackgum blackgum birch buckeye horsechestnut '
        'alder parrotia filbert rubbertree hardy rubbertree',
        'oak walnut hickory beech catalpa chestnut osage-orange',
        'applecrabapple apple/crabapple crabapple serviceberry cherry cherry/plum plum lilac redbud rebud pear dogwood '
        'hawthorn hawthorn/buckthorn buckthorn magnolia fringetree smoketree chokecherry mountainash pawpaw',
        'spruce pine arborvitae juniper douglas-fir fir hemlock yew cypress']):
    for n in names.split(' '):
        KIND_OF[n] = k
FEET = {'0-10': 7, '10-20': 15, '11-20': 15, '20-30': 25, '21-30': 25, '30-50': 40, '31-50': 40, '50-70': 60,
        '51-70': 60, 'GT70': 78}
tree_kind = {}
for f in tj['features']:
    g = f.get('geometry')
    pr = f['properties']
    if not g or g['type'] != 'Point':
        continue
    genus = (pr.get('COMMONGENUS') or '').lower()
    if genus in ('vacant', 'stump', '') or 'vacant' in (pr.get('COMMONNAME') or '').lower():
        continue
    x, z = xz(*g['coordinates'][:2])
    if inland(x, z):
        key = (round(x * 2), round(z * 2))
        street_trees.add(key)
        h = FEET.get((pr.get('HEIGHT') or '').replace(' ', ''), 0)
        tree_kind[key] = (KIND_OF.get(genus.strip(), 255), min(255, round(h * 0.3048 * 4)))  # height in 25 cm steps
street_trees = sorted(street_trees)
print(f'{sum(1 for v in tree_kind.values() if v[0] != 255)} street trees of a known kind')
print(f'{len(street_trees)} street trees')

rng = np.random.default_rng(42)
keep_clear = unary_union([built_union.buffer(2.5), parking_union, water, road_union.buffer(2)])


def scatter(geom, spacing, keep):
    if geom.is_empty:
        return np.zeros((0, 2))
    x0, z0, x1, z1 = geom.bounds
    gx, gz = np.meshgrid(np.arange(x0, x1, spacing), np.arange(z0, z1, spacing))
    gx = gx.ravel() + (rng.random(gx.size) - 0.5) * spacing * 0.8
    gz = gz.ravel() + (rng.random(gz.size) - 0.5) * spacing * 0.8
    sel = rng.random(gx.size) < keep
    gx, gz = gx[sel], gz[sel]
    shapely.prepare(geom)
    ins = shapely.contains_xy(geom, gx, gz)
    return np.stack([gx[ins], gz[ins]], 1)


woods = []
pitch = unary_union([area_of(e) for e in ways if e.get('tags', {}).get('leisure') in ('pitch', 'stadium', 'track')
                     and area_of(e) is not None])
clear2 = keep_clear.union(pitch)
# Where trees really are: the city's urban tree canopy (NaturalFeatures/MapServer/10, downloaded to canopy/p*.json),
# filled with trunks about 7.5 m apart wherever it covers lawn, a park or woods, clear of buildings, roads, lots,
# driveways, pitches and the street trees (which stand for the canopy over the curb)
CAN = os.path.join(REF, 'canopy')
canopy_polys = []
for fn in sorted(glob.glob(os.path.join(CAN, 'p*.json'))):
    for f in json.load(open(fn)).get('features', []):
        g = f.get('geometry')
        if not g or g['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            rings = [[xz(lon, lat) for lon, lat, *_ in ring] for ring in poly]
            if len(rings[0]) >= 4:
                pg = make_valid(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]))
                if pg.area >= 12:
                    canopy_polys.append(pg)
# and past the city line, where the city's canopy stops, the cover read from an aerial photo (fetch-canopy-extra.py)
_beyond = LAND.difference(LIMITS)
for fn in sorted(glob.glob(os.path.join(REF, 'canopy-extra', '*.json'))):
    for f in json.load(open(fn)).get('features', []):
        rings = [[xz(lon, lat) for lon, lat, *_ in ring] for ring in f['geometry']['coordinates']]
        pg = make_valid(Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4])).intersection(_beyond)
        for p in parts(pg):
            if p.area >= 12:
                canopy_polys.append(p)
print(f'{len(canopy_polys)} canopy patches, {sum(p.area for p in canopy_polys) / 1e6:.2f} km2')

# --- Railroads (OSM railway=rail): the Michigan Line (Amtrak) along the Huron, the Ann Arbor Railroad and the Great
# Lakes Central. Each named line is merged into long runs for trains to follow; every piece is drawn as track, with
# its bridges marked. GEO.rail = {'tracks': [[flat pts, bridge 0|1, main 0|1]], 'routes': [[name, flat pts]]}
from shapely.ops import linemerge
rail_tracks, rail_lines, rail_by_name = [], [], {}
for e in ways:
    t = e.get('tags', {})
    if t.get('railway') != 'rail' or t.get('usage') == 'test' or t.get('tunnel'):
        continue
    ls = LineString(way_pts(e)).intersection(LAND.buffer(-5))
    for seg in ([ls] if ls.geom_type == 'LineString' else getattr(ls, 'geoms', [])):
        if seg.is_empty or seg.length < 2:
            continue
        seg = seg.simplify(0.3)
        rail_lines.append(seg)
        rail_tracks.append([flat(seg.coords), 1 if t.get('bridge') else 0, 0 if t.get('service') else 1])
        if not t.get('service') and t.get('name'):
            rail_by_name.setdefault(t['name'], []).append(seg)
rail_routes = []
for name, segs in rail_by_name.items():
    u = unary_union(segs)
    m = u if u.geom_type == 'LineString' else linemerge(u)
    for run in sorted(parts_lines := ([m] if m.geom_type == 'LineString' else list(m.geoms)), key=lambda l: -l.length)[:1]:
        if run.length > 800:
            rail_routes.append([name, flat(run.coords)])
rail_clear = unary_union([l.buffer(4.0) for l in rail_lines]) if rail_lines else Polygon()
print(f'{len(rail_tracks)} pieces of track, {sum(l.length for l in rail_lines) / 1000:.1f} km; trains on',
      [(r[0], round(LineString(list(zip(r[1][0::2], r[1][1::2]))).length)) for r in rail_routes])

# --- Golf (OSM golf=*): fairways, greens, tees and cart paths inside the courses. Where a course has no fairways
# mapped, its open grass (the course less the tree canopy and a margin) is mown as fairway. Each green gets a pin and
# a bunker or two at its edge. GEO.golf = {'fairways', 'greens', 'tees', 'bunkers': [rings...], 'paths': [flat pts],
# 'pins': [x, z, ...]}
golf_courses = [g['geom'] for g in GREEN if g['kind'] == 'golf']
golf_union = unary_union(golf_courses) if golf_courses else Polygon()
gf = {'fairway': [], 'green': [], 'tee': [], 'bunker': [], 'path': []}
for e in ways + rels:
    t = e.get('tags', {})
    kind = t.get('golf')
    if kind in ('fairway', 'green', 'tee', 'bunker'):
        g = area_of(e)
        if g is not None and g.intersects(golf_union):
            gf[kind].append(g)
    elif kind in ('cartpath', 'path') and e['type'] == 'way':
        pts = way_pts(e)
        if len(pts) >= 2:
            gf['path'].append(LineString(pts))
golf_paths_g = unary_union([l.buffer(1.2, quad_segs=2) for l in gf['path']]) if gf['path'] else Polygon()
greens_u = unary_union(gf['green']) if gf['green'] else Polygon()
tees_u = unary_union(gf['tee']) if gf['tee'] else Polygon()
fair_u = unary_union(gf['fairway']) if gf['fairway'] else Polygon()
# courses without mapped fairways: their open grass
canopy_u = None
for course in golf_courses:
    if course.intersection(fair_u).area > 0.05 * course.area:
        continue
    if canopy_u is None:
        canopy_u = unary_union([p for p in canopy_polys if p.intersects(golf_union)]) if canopy_polys else Polygon()
    open_g = course.buffer(-8).difference(canopy_u.buffer(6)).difference(water.buffer(3)).difference(built_union.buffer(6))
    open_g = open_g.buffer(-5).buffer(5)  # no slivers
    fair_u = fair_u.union(unary_union([p for p in parts(open_g) if p.area > 1500]))
fair_u = fair_u.intersection(blocks_geom).difference(greens_u.buffer(1.0)).difference(tees_u).difference(golf_paths_g)
# greenside bunkers: one or two kidney-shaped traps on the green's edge away from its fairway approach
bunkers = list(gf['bunker'])
grng = np.random.default_rng(23)
pins = []
for gr in parts(greens_u):
    if gr.area < 60:
        continue
    c = gr.centroid
    pins += [r1(c.x + grng.uniform(-2, 2)), r1(c.y + grng.uniform(-2, 2))]
    rad = math.sqrt(gr.area / math.pi)
    for k in range(1 + int(grng.random() < 0.6)):
        a = grng.uniform(0, 2 * math.pi)
        d = rad + 3.2
        bx, bz = c.x + math.cos(a) * d, c.y + math.sin(a) * d
        sx, sz = grng.uniform(3.5, 6), grng.uniform(2, 3)
        ell = shapely.affinity.rotate(shapely.affinity.scale(Point(bx, bz).buffer(1, quad_segs=6), sx, sz), math.degrees(a) + 90)
        ell = ell.difference(gr.buffer(1.2)).difference(golf_paths_g).difference(built_union)
        if not ell.is_empty and ell.intersection(golf_union).area > 0.9 * ell.area:
            bunkers.append(ell)
bunker_u = unary_union(bunkers) if bunkers else Polygon()
fair_u = fair_u.difference(bunker_u)


def rings_of(g, tol=0.4):
    return [[flat(list(orient(p, -1.0).exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors]
            for p in parts(g.simplify(tol)) if p.area > 4]


golf = {'fairways': rings_of(fair_u, 0.8), 'greens': rings_of(greens_u.intersection(blocks_geom)),
        'tees': rings_of(tees_u.intersection(blocks_geom)), 'bunkers': rings_of(bunker_u.intersection(blocks_geom), 0.2),
        'paths': [flat(l.simplify(0.5).coords) for l in gf['path'] if l.intersects(golf_union)], 'pins': pins}
golf_clear = unary_union([fair_u, greens_u.buffer(2), tees_u, bunker_u])
print(f"golf: {len(golf['fairways'])} fairways, {len(golf['greens'])} greens, {len(golf['tees'])} tees, "
      f"{len(golf['bunkers'])} bunkers, {len(golf['paths'])} cart paths")

clear2 = clear2.union(rail_clear).union(golf_clear)
S = 7.5
gx, gz = np.meshgrid(np.arange(X0, X1, S), np.arange(Z0, Z1, S))
gx = gx.ravel() + (rng.random(gx.size) - 0.5) * S * 0.85
gz = gz.ravel() + (rng.random(gz.size) - 0.5) * S * 0.85
pts = shapely.points(gx, gz)
inside = np.unique(shapely.STRtree(canopy_polys).query(pts, predicate='within')[0])
gx, gz, pts = gx[inside], gz[inside], pts[inside]
ground = unary_union([lawn_blocks, unary_union([g['geom'] for g in GREEN]).intersection(blocks_geom)])
shapely.prepare(ground)
shapely.prepare(clear2)
ok = shapely.contains_xy(ground, gx, gz) & ~shapely.contains_xy(clear2, gx, gz)
on_drive = np.zeros(len(gx), bool)
on_drive[np.unique(shapely.STRtree([d.buffer(1.0) for d in drive_parts]).query(pts, predicate='within')[0])] = True
ok &= ~on_drive
st_cells = set()
for sx, sz in street_trees:
    st_cells.add((int(sx * 0.5 // 4), int(sz * 0.5 // 4)))
for i in np.nonzero(ok)[0]:
    cx, cz = int(gx[i] // 4), int(gz[i] // 4)
    if any((cx + a, cz + b) in st_cells for a in (-1, 0, 1) for b in (-1, 0, 1)):
        ok[i] = False
gx, gz = gx[ok], gz[ok]
kinds = np.full(len(gx), 2)
for g in GREEN:
    shapely.prepare(g['geom'])
    hit = shapely.contains_xy(g['geom'], gx, gz)
    kinds[hit] = np.minimum(kinds[hit], 0 if g['kind'] == 'wood' else 1)
woods = [(x, z, int(k)) for x, z, k in zip(gx, gz, kinds)]
# and the single trees mapped in OpenStreetMap
osm_trees = 0
for e in osm:
    if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'tree':
        x, z = xz(e['lon'], e['lat'])
        if inland(x, z) and not clear2.contains(Point(x, z)):
            woods.append((x, z, 1))
            osm_trees += 1
print(f'{sum(1 for w in woods if w[2] < 2)} park & wood trees, {sum(1 for w in woods if w[2] == 2)} yard trees '
      f'from the canopy, {osm_trees} mapped trees')
# Playgrounds (OpenStreetMap leisure=playground): the outline for their wood-chip ground, and the oriented box the
# play structure and swings are set in: [ring, cx, cz, angle of the long side, length, width]
playgrounds = []
for e in ways:
    if e.get('tags', {}).get('leisure') != 'playground':
        continue
    g = area_of(e)
    if g is None:
        continue
    g = g.intersection(LAND).difference(built_union)
    for p in parts(g):
        if p.area < 30:
            continue
        rr = list(p.minimum_rotated_rectangle.exterior.coords)[:4]
        e1 = (rr[1][0] - rr[0][0], rr[1][1] - rr[0][1]); e2 = (rr[2][0] - rr[1][0], rr[2][1] - rr[1][1])
        l1, l2 = math.hypot(*e1), math.hypot(*e2)
        L, W, ax = (l1, l2, e1) if l1 >= l2 else (l2, l1, e2)
        c = p.centroid
        p = orient(p.simplify(0.3), -1.0)
        playgrounds.append([flat(list(p.exterior.coords)[:-1]), r1(c.x), r1(c.y), round(math.atan2(ax[1], ax[0]), 3),
                            r1(L), r1(W)])
print(f'{len(playgrounds)} playgrounds')
woods_flat = []
for x, z, k in woods:
    woods_flat += [r1(x), r1(z), k]

# --- Landmarks ------------------------------------------------------------------------------------------------------------
WANT = {
    'Michigan Stadium': ['Michigan Stadium'],
    'Burton Memorial Tower': ['Burton Memorial Tower'],
    'Michigan Theater': ['Michigan Theater'],
    'Michigan Union': ['Michigan Union'],
    'Hill Auditorium': ['Hill Auditorium'],
    'Crisler Center': ['Crisler Center', 'Crisler Arena'],
    'Rackham Building': ['Horace H. Rackham School of Graduate Studies', 'Rackham Graduate School', 'Rackham Building'],
    'Hatcher Graduate Library': ['Harlan Hatcher Graduate Library', 'Hatcher Graduate Library'],
    'Michigan League': ['Michigan League'],
    'Ann Arbor District Library': ['Ann Arbor District Library', 'Ann Arbor District Library - Downtown'],
    'Kerrytown Market & Shops': ['Kerrytown Market & Shops', 'Kerrytown'],
    'Ann Arbor Farmers Market': ['Ann Arbor Farmers Market'],
    'Yost Ice Arena': ['Yost Ice Arena'],
    'University of Michigan Museum of Art': ['University of Michigan Museum of Art'],
    'Bell Tower Hotel': ['Bell Tower Hotel'],
    'Tower Plaza': ['Tower Plaza'],
    'Ann Arbor Amtrak Station': ['Ann Arbor'],
    'Nichols Arboretum': ['Nichols Arboretum'],
    'Gallup Park': ['Gallup Park'],
    'The Diag': ['The Diag', 'Diag'],
    'Ingalls Mall': ['Ingalls Mall'],
    'Argo Pond': ['Argo Pond'],
    'West Park': ['West Park'],
    'Fuller Park': ['Fuller Park'],
    'Burns Park': ['Burns Park'],
    'Michigan Stadium Field': [],
}
named = {}
for e in ways + rels:
    t = e.get('tags', {})
    n = t.get('name')
    if not n:
        continue
    g = None
    for key, alts in WANT.items():
        if n in alts:
            g = g or area_of(e)
            if g is None:
                continue
            if key not in named or g.area > named[key].area:
                named[key] = g
for b in buildings:
    for key, alts in WANT.items():
        if b['name'] and any(a.lower() in b['name'].lower() for a in alts) and key not in named:
            named[key] = b['geom']
landmarks = {}
for key, g in named.items():
    g = g if g.geom_type == 'Polygon' else max(parts(g), key=lambda p: p.area)
    c = g.centroid
    minx, minz, maxx, maxz = g.bounds
    hgt = None
    for b in buildings:
        if b['geom'].contains(c):
            hgt = b['height']
            break
    ext = list(g.simplify(1.0).exterior.coords)[:-1]
    landmarks[key] = {'x': r1(c.x), 'z': r1(c.y), 'w': r1(maxx - minx), 'd': r1(maxz - minz), 'h': hgt,
                      'area': int(g.area), 'ring': flat(ext)}
print('landmarks:', ', '.join(f"{k} ({v['x']:.0f}, {v['z']:.0f})" for k, v in landmarks.items()))
print('missing:', [k for k in WANT if k not in landmarks])

# --- Michigan Stadium's shape (OSM relation 1637002): its outer wall and the field's wall as radii from the field's
# middle along 180 rays, and the pitch's box, for landmarks.js and the bowl terrain.js digs (Web/js/stadium-geodata.js)
stad = next(e for e in rels if e['id'] == 1637002)
st_out = [LineString([xz(q['lon'], q['lat']) for q in m['geometry']]) for m in stad['members'] if m['role'] == 'outer']
st_in = [LineString([xz(q['lon'], q['lat']) for q in m['geometry']]) for m in stad['members'] if m['role'] == 'inner']
st_out, st_in = Polygon(list(polygonize(unary_union(st_out)))[0].exterior), Polygon(list(polygonize(unary_union(st_in)))[0].exterior)
sc = st_in.centroid
NR = 180


def radii(poly):
    out = []
    for k in range(NR):
        a = 2 * math.pi * k / NR
        ray = LineString([(sc.x, sc.y), (sc.x + math.cos(a) * 400, sc.y + math.sin(a) * 400)])
        hit = ray.intersection(poly.exterior)
        pts = [hit] if hit.geom_type == 'Point' else list(getattr(hit, 'geoms', []))
        out.append(r1(max(math.hypot(q.x - sc.x, q.y - sc.y) for q in pts)))
    return out


st_pitch = area_of(next(e for e in ways if e['id'] == 181983810))
rr = list(st_pitch.minimum_rotated_rectangle.exterior.coords)[:4]
e1 = (rr[1][0] - rr[0][0], rr[1][1] - rr[0][1]); e2 = (rr[2][0] - rr[1][0], rr[2][1] - rr[1][1])
ax = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
pang = math.atan2(ax[1], ax[0])
if pang < 0:
    pang += math.pi
stadium = {'cx': r1(sc.x), 'cz': r1(sc.y), 'rIn': radii(st_in), 'rOut': radii(st_out),
           'pitch': {'cx': r1(st_pitch.centroid.x), 'cz': r1(st_pitch.centroid.y), 'angle': round(pang, 4)}}
with open(os.path.join(OUT_JS, 'stadium-geodata.js'), 'w') as f:
    f.write('// js/stadium-geodata.js — GENERATED by Assets/Tools/build-annarbor.py, do not edit by hand.\n'
            '// Michigan Stadium from OpenStreetMap (relation 1637002): the field\'s middle, the field wall\'s and the outer\n'
            '// wall\'s distance from it along 180 rays (ray k at angle 2πk/180 from +x toward +z), and the pitch.\n'
            'export const STADIUM = ' + json.dumps(stadium, separators=(',', ':')) + ';\n')
print('stadium', stadium['cx'], stadium['cz'], min(stadium['rIn']), max(stadium['rOut']), stadium['pitch'])

# --- GEO --------------------------------------------------------------------------------------------------------------------
land_ring = flat(list(orient(LAND, -1.0).exterior.coords)[:-1])
# --- Trails: the paths, footways, bike paths and tracks through the parks, woods, the cemetery and the campus lawns
# (not the sidewalks or crossings, drawn with the blocks, nor the golf courses' cart paths), as
# [kind (0 paved, 1 dirt/gravel), width, x, z, ...]
TRAIL_HW = {'path', 'footway', 'cycleway', 'pedestrian', 'track', 'bridleway'}
SOFT = {'dirt', 'ground', 'unpaved', 'gravel', 'fine_gravel', 'compacted', 'woodchips', 'grass', 'earth', 'mud', 'sand'}
trail_area = unary_union([g['geom'] for g in GREEN if g['kind'] != 'golf']).union(lawn_blocks).difference(golf_union)
shapely.prepare(trail_area)
trails = []
for w in ways:
    t = w.get('tags', {})
    if t.get('highway') not in TRAIL_HW or t.get('area') == 'yes' or t.get('footway') in ('sidewalk', 'crossing') \
            or t.get('tunnel') == 'yes' or t.get('indoor') == 'yes':
        continue
    pts = way_pts(w)
    if len(pts) < 2:
        continue
    line = LineString(pts)
    if t.get('bridge') == 'yes' and line.intersects(water):
        continue  # a footbridge (bridges)
    if not trail_area.intersects(line):
        continue
    sf = t.get('surface')
    soft = sf in SOFT or (sf is None and t.get('highway') in ('path', 'track', 'bridleway'))
    try:
        wd = float(t.get('width', '').split()[0])
    except (ValueError, IndexError):
        wd = 0
    wd = max(1.0, min(4.0, wd or (2.4 if t['highway'] == 'cycleway' else 3.0 if t['highway'] == 'track' else
                                   1.3 if soft else 1.8)))
    cut = line.intersection(trail_area)
    segs = [cut] if cut.geom_type == 'LineString' else [g for g in getattr(cut, 'geoms', []) if g.geom_type == 'LineString']
    for g in segs:
        if g.length < 4:
            continue
        g = g.simplify(0.4)
        board = t.get('bridge') == 'boardwalk' or sf == 'wood'
        trails.append([3 if board else 1 if soft else 0, round(wd, 1)] + flat(list(g.coords)))
osm_trails = len(trails)

# The city's trails, park paths and shared-use paths (Non-Motorized Routes): OSM's trail pieces take the city's material
# where most of a piece runs along one of its lines; the city's lines OSM is missing are added (kept clear of OSM's
# paths, the mountain bike trails, the streets, buildings, golf courses and water); and each shared-use path beside a
# street is a wide path over the sidewalk, pushed out past the curb. Kinds: 0 concrete, 1 dirt or gravel, 2 asphalt,
# 3 a wooden boardwalk a little above the ground, 4 steps
NM_KIND = {'Asphalt': 2, 'Concrete': 0, 'Nature Trail': 1, 'Unpaved': 1, 'Wooden': 3, 'Stairs': 4}
NM_WIDTH = {0: 2.4, 1: 1.2, 2: 2.4, 3: 1.8, 4: 1.5}
nm_off = [(l, p) for l, p in nm_feats if p.get('NonMotorizedType') in ('Trail', 'Shared Use')]
if nm_off:
    def nm_kind(p):
        m = p.get('Material')
        if m in NM_KIND:
            return NM_KIND[m]
        return 2 if p['NonMotorizedType'] == 'Shared Use' else 1
    # OSM's own pieces take the city's material where 60% of one runs within 4 m of a line of it
    mat_lines = {}
    for l, p in nm_off:
        mat_lines.setdefault(nm_kind(p), []).append(l)
    mat_area = {k: unary_union([l.buffer(4, 4) for l in v]) for k, v in mat_lines.items()}
    for a in mat_area.values():
        shapely.prepare(a)
    retyped = 0
    for tr in trails:
        g = LineString(list(zip(tr[2::2], tr[3::2])))
        if g.length < 4:
            continue
        for k, a in mat_area.items():
            if a.intersects(g) and g.intersection(a).length >= 0.6 * g.length:
                if tr[0] != k and not (tr[0] == 3 and k in (0, 2)):
                    tr[0] = k
                    if k in (0, 2):
                        tr[1] = max(tr[1], 2.0)
                    retyped += 1
                break
    # what's there already: every OSM path, sidewalk and track (not only the ones drawn as trails), the mountain bike
    # trails and what a path can't run through
    have = []
    for w in ways:
        t = w.get('tags', {})
        if t.get('highway') in TRAIL_HW | {'steps'}:
            pts = way_pts(w)
            if len(pts) >= 2:
                have.append(LineString(pts).buffer(7, 2))
    try:
        for m in json.load(open(os.path.join(ROOT, 'Web/data/mtb-trails.json')))['trails']:
            if len(m) >= 5:
                have.append(LineString(list(zip(m[1::2], m[2::2]))).buffer(5, 2))
    except (OSError, ValueError, KeyError):
        pass
    have = unary_union(have)
    keep_out = unary_union([have, road_union.buffer(1), built_union, golf_union])
    keep_out_dry = keep_out.union(water)
    shapely.prepare(keep_out)
    shapely.prepare(keep_out_dry)
    added = {k: 0 for k in NM_WIDTH}
    # the streets, for the shared-use paths beside them
    st_lines = [(LineString(r['pts']), r['w']) for r in drive if not r['hw'] and not r['tunnel'] and len(r['pts']) >= 2]
    st_tree = shapely.STRtree([l for l, _ in st_lines])
    beside = 0
    for l, p in nm_off:
        k = nm_kind(p)
        if p['NonMotorizedType'] == 'Shared Use' and p.get('LocationType') in ('Adjacent', 'CurbSeparated', 'In the Road', None):
            # beside a street: pushed out to 1.9 m past the curb wherever it's closer, then kept off the street
            line = shapely.segmentize(l, 4)
            pts_ = []
            for x, z in line.coords:
                pt = Point(x, z)
                near = st_tree.query(pt.buffer(16))
                if len(near):
                    j = min(near, key=lambda i: st_lines[i][0].distance(pt))
                    sl_, sw = st_lines[j]
                    d = sl_.distance(pt)
                    want = sw / 2 + 1.9
                    if d < want - 0.2:
                        q = sl_.interpolate(sl_.project(pt))
                        ux, uz = x - q.x, z - q.y
                        ul = math.hypot(ux, uz)
                        if ul < 0.05:  # on the centreline: off to the side the city's line is, across the street
                            a_, b_ = sl_.interpolate(max(0, sl_.project(pt) - 2)), sl_.interpolate(sl_.project(pt) + 2)
                            ux, uz, ul = -(b_.y - a_.y), b_.x - a_.x, math.hypot(b_.x - a_.x, b_.y - a_.y) or 1
                        x, z = q.x + ux / ul * want, q.y + uz / ul * want
                pts_.append((x, z))
            cut = LineString(pts_).difference(road_union.buffer(0.3)).difference(built_union)
            wd, k = 3.0, (0 if k == 0 else 2)
            beside += 1
        else:
            if k == 3:
                cut = l.difference(keep_out)
            else:
                cut = l.difference(keep_out_dry)
            wd = NM_WIDTH[k]
        for g in ([cut] if cut.geom_type == 'LineString' else [g for g in getattr(cut, 'geoms', []) if g.geom_type == 'LineString']):
            if g.length < 12 and not (k == 4 and g.length > 3):
                continue
            g = g.simplify(0.4)
            trails.append([k, wd] + flat(list(g.coords)))
            added[k] += 1
    print(f'the city\'s paths: {retyped} OSM trail pieces take its material; {sum(added.values())} pieces added '
          f'({added[2]} asphalt, {added[0]} concrete, {added[1]} dirt, {added[3]} boardwalk, {added[4]} steps), '
          f'{beside} shared-use paths beside streets')
print(f'{len(trails)} trail pieces ({osm_trails} from OSM), {sum(1 for t in trails if t[0] == 1)} dirt')

# --- Streetlights: the city's map of every streetlight (ckan.a2gov.org "streetlights"), each as a cobra head on a pole
# with its arm out over the nearest street (0), or a post-top lantern on campus, in lots and along paths (1).
# GEO.streetlights = flat [x, z, kind (0 cobra head, 1 post-top lantern, 2 downtown's ornamental double globe), heading of the arm in degrees]
streetlights = []
DOWNTOWN_LIGHTS = (-900, 900, -700, 500)  # x and z bounds, m, of the downtown core
try:
    sl = json.load(open(os.path.join(REF, 'aa_streetlights.geojson')))['features']
    drive_lines = [LineString(r['pts']) for r in drive if not r['tunnel'] and len(r['pts']) >= 2]
    line_tree = shapely.STRtree(drive_lines)
    shapely.prepare(road_union)
    for f in sl:
        g, pr = f.get('geometry'), f['properties']
        if not g or g['type'] != 'Point':
            continue
        x, z = xz(*g['coordinates'][:2])
        if not inland(x, z):
            continue
        pt = Point(x, z)
        k = line_tree.nearest(pt)
        near = shapely.ops.nearest_points(drive_lines[k], pt)[0]
        d = pt.distance(near)
        use = pr.get('UseType') or ''
        post = d > 9 or use in ('Mid-block-C', 'OffStreet-P', 'OffStreet-PL', 'OnProperty') or \
            (pr.get('Owner') == 'U of M' and d > 5)
        ux, uz = (near.x - x) / (d or 1), (near.y - z) / (d or 1)
        if road_union.contains(pt):  # mapped in the street: stood on its edge
            edge = road_union.exterior if road_union.geom_type == 'Polygon' else None
            for _ in range(12):
                x, z = x - ux * 0.8, z - uz * 0.8
                if not road_union.contains(Point(x, z)):
                    break
            x, z = x - ux * 0.6, z - uz * 0.6
        # the city's own lights in the downtown core (Main, Liberty, Washington, Fourth and Fifth, State by the
        # Diag, Kerrytown) are its black ornamental posts with two globes, not DTE's cobra heads (2)
        ornate = not post and pr.get('Owner') == 'City' and DOWNTOWN_LIGHTS[0] < x < DOWNTOWN_LIGHTS[1] and \
            DOWNTOWN_LIGHTS[2] < z < DOWNTOWN_LIGHTS[3]
        streetlights += [r1(x), r1(z), 2 if ornate else 1 if post else 0, round(math.degrees(math.atan2(uz, ux)))]
except FileNotFoundError:
    pass
print(f'{len(streetlights) // 4} streetlights')

# --- Traffic controls: OpenStreetMap's traffic lights, stop signs, yield signs and crossings (nodes, via Overpass,
# sig/osm_signals.json). GEO.controls = { signals: flat [x, z], stops: flat [x, z, kind (0 stop, 1 all-way, 2 yield)],
# crossings: flat [x, z, marked (0 no, 1 yes, 2 not said)] }; road-network.js matches each to the intersection and approach it stands at.
controls = {'signals': [], 'stops': [], 'crossings': []}
try:
    for e in json.load(open(os.path.join(REF, 'sig/osm_signals.json')))['elements']:
        t = e.get('tags', {})
        x, z = xz(e['lon'], e['lat'])
        if not inland(x, z):
            continue
        h = t.get('highway')
        if h == 'traffic_signals':
            controls['signals'] += [r1(x), r1(z)]
        elif h in ('stop', 'give_way'):
            controls['stops'] += [r1(x), r1(z), 2 if h == 'give_way' else 1 if t.get('stop') == 'all' else 0]
        elif h == 'crossing':
            # painted (1), plainly not (0), or not said (2)
            c, m = t.get('crossing'), t.get('crossing:markings')
            marked = 0 if c == 'unmarked' or m == 'no' else 1 if (m and m != 'no') or c in (
                'marked', 'zebra', 'traffic_signals', 'uncontrolled') else 2
            controls['crossings'] += [r1(x), r1(z), marked]
except FileNotFoundError:
    pass
print(f"{len(controls['signals']) // 2} traffic lights, {len(controls['stops']) // 3} stop & yield signs, "
      f"{len(controls['crossings']) // 3} crossings")

# --- Named places: OpenStreetMap's named shops, restaurants, cafes, bars and the like (poi/osm_pois.json, Overpass
# nwr[shop|amenity|tourism|leisure][name], ODbL), each a sign over its storefront: on the wall of the building it's in
# (or the nearest, within 18 m) that faces the street. GEO.signs = {names: [...], list: flat [x, z, heading (deg, the
# wall's outward normal, atan2(nx, nz)), width, height above ground, name index, category]} with categories 0 food,
# 1 coffee & sweets, 2 bars, 3 shops, 4 services, 5 culture. And the city's building names (Bldg_Name), for the HUD as
# you pass: GEO.places = {names, list: flat [x, z, radius, name index]}, one entry per building with a real name.
SIGN_CATS = {
    'restaurant': 0, 'fast_food': 0, 'food_court': 0, 'cafe': 1, 'ice_cream': 1, 'bar': 2, 'pub': 2, 'biergarten': 2,
    'nightclub': 2, 'bank': 4, 'pharmacy': 4, 'dentist': 4, 'clinic': 4, 'doctors': 4, 'post_office': 4,
    'veterinary': 4, 'theatre': 5, 'cinema': 5, 'library': 5, 'arts_centre': 5, 'museum': 5, 'gallery': 5,
    'hotel': 4, 'fitness_centre': 4,
}
sign_names, sign_name_id, signs_out = [], {}, []
try:
    pois = json.load(open(os.path.join(REF, 'poi/osm_pois.json')))['elements']
except FileNotFoundError:
    pois = []
bldg_geoms = [b['geom'] for b in buildings]
bldg_tree = shapely.STRtree(bldg_geoms)
road_tree = shapely.STRtree(surface)
taken = {}  # (building, edge) -> [(s0, s1)] along the edge
for e in pois:
    t = e.get('tags', {})
    name = (t.get('name') or '').strip()
    if not name or len(name) > 34:
        continue
    cat = SIGN_CATS.get(t.get('amenity')) if t.get('amenity') else None
    if cat is None and t.get('tourism') in ('hotel', 'museum', 'gallery'):
        cat = SIGN_CATS[t['tourism']]
    if cat is None and t.get('leisure') == 'fitness_centre':
        cat = 4
    if cat is None and t.get('shop'):
        cat = 1 if t['shop'] in ('bakery', 'coffee', 'confectionery', 'chocolate', 'pastry') else \
            4 if t['shop'] in ('hairdresser', 'beauty', 'dry_cleaning', 'laundry', 'optician', 'tattoo') else 3
    if cat is None:
        continue
    c = e.get('center') or ({'lon': e['lon'], 'lat': e['lat']} if 'lon' in e else None)
    if not c:
        continue
    px, pz = xz(c['lon'], c['lat'])
    pt = Point(px, pz)
    near = bldg_tree.query(pt.buffer(18))
    if not len(near):
        continue
    bi = min(near, key=lambda i: bldg_geoms[i].distance(pt))
    if bldg_geoms[bi].distance(pt) > 18:
        continue
    b = buildings[bi]
    if b['kind'] == 1 and b['height'] < 6:
        continue  # a house: a home business, no storefront
    best = None
    for poly in parts(b['geom']):
        ring = list(orient(poly, 1.0).exterior.coords)
        for k in range(len(ring) - 1):
            (x0, z0), (x1, z1) = ring[k], ring[k + 1]
            L = math.hypot(x1 - x0, z1 - z0)
            if L < 3.2:
                continue
            ux, uz = (x1 - x0) / L, (z1 - z0) / L
            nx, nz = uz, -ux
            mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
            if poly.contains(Point(mx + nx * 0.5, mz + nz * 0.5)):
                nx, nz = -nx, -nz
            probe = Point(mx + nx * 6, mz + nz * 6)
            ri = road_tree.query_nearest(probe)
            dr = surface[ri[0]].distance(probe) if len(ri) else 99
            if dr > 22:
                continue
            # along the edge, as near the place's point as fits
            sproj = max(0.0, min(L, (px - x0) * ux + (pz - z0) * uz))
            dp = math.hypot(x0 + ux * sproj - px, z0 + uz * sproj - pz)
            score = dr + 0.35 * dp
            if best is None or score < best[0]:
                best = (score, k, x0, z0, ux, uz, nx, nz, L, sproj)
    if best is None:
        continue
    _, k, x0, z0, ux, uz, nx, nz, L, sproj = best
    w = min(L - 0.6, max(2.4, 0.42 * len(name) + 0.8), 7.5)
    if w < 2.2:
        continue
    s0 = max(0.3, min(L - 0.3 - w, sproj - w / 2))
    used = taken.setdefault((bi, k), [])
    for a0, a1 in sorted(used):
        if s0 < a1 + 0.4 and s0 + w > a0 - 0.4:
            s0 = a1 + 0.4
    if s0 + w > L - 0.3:
        continue
    used.append((s0, s0 + w))
    sm = s0 + w / 2
    if name not in sign_name_id:
        sign_name_id[name] = len(sign_names)
        sign_names.append(name)
    y = 3.4 if b['height'] >= 5 else max(2.4, b['height'] - 0.9)
    signs_out += [r1(x0 + ux * sm + nx * 0.18), r1(z0 + uz * sm + nz * 0.18), round(math.degrees(math.atan2(nx, nz))),
                  r1(w), r1(y), sign_name_id[name], cat]
print(f'{len(signs_out) // 7} storefront signs')

place_names, place_name_id, places_out = [], {}, []
for b in buildings:
    n = b['name'].strip()
    if not n or n[0].isdigit() or n in ('Worship', 'Garage', 'Shed') or len(n) > 48:
        continue
    if n not in place_name_id:
        place_name_id[n] = len(place_names)
        place_names.append(n)
    c = b['geom'].representative_point()
    minx, minz, maxx, maxz = b['geom'].bounds
    places_out += [r1(c.x), r1(c.y), r1(max(maxx - minx, maxz - minz) / 2), place_name_id[n]]
print(f'{len(places_out) // 4} named buildings ({len(place_names)} names)')

GEO = {
    'version': 1,
    'city': 'annarbor',
    'frame': {'bearingDeg': 0, 'origin': 'Main St & Liberty St (centreline)', 'units': 'm', 'cutZ': Z0, 'strip': 0,
              'sidewalk': SIDEWALK, 'lat0': LAT0, 'lon0': LON0, 'kx': KX, 'ky': KY},
    'edge': land_ring,
    # the city's official limits as drawn on the map (each outline and each township island's), and the middle of town
    'limits': [flat(list(r.coords)[:-1]) for p in parts(_lim.simplify(3)) for r in [p.exterior, *p.interiors] if Polygon(r).area > 2000],
    'core': flat(list(orient(CORE, -1.0).exterior.coords)[:-1]),
    'roads': roads,
    'roadGraph': roadGraph,
    'blocks': blocks,
    'parks': [{'name': g['name'], 'cat': g['kind'], 'acres': round(g['geom'].area / 4046.86, 1),
               'rings': [flat(list(p.exterior.coords)[:-1]) for p in parts(g['geom'].simplify(1.0))]}
              for g in GREEN if g['name']],
    'riverBridges': [[b[0], b[1]] + [r1(v) for v in b[2:]] for b in bridges],
    'water': [[flat(list(orient(p, -1.0).exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors]
              for p in parts(water_open.simplify(0.8)) if p.area > 30],
    'parking': [[flat(list(orient(p, -1.0).exterior.coords)[:-1])] + [flat(list(r.coords)[:-1]) for r in p.interiors]
                for p in parts(parking_union.intersection(blocks_geom).simplify(0.5)) if p.area > 100],
    'woods': woods_flat,
    'curbCuts': curb_cuts,
    'rail': {'tracks': rail_tracks, 'routes': rail_routes},
    'golf': golf,
    'trails': trails,
    'bikeSigns': bike_signs,
    'streetlights': streetlights,
    'controls': controls,
    'signs': {'names': sign_names, 'list': signs_out},
    'places': {'names': place_names, 'list': places_out},
    'playgrounds': playgrounds,
    'lawns': lawns,
    'driveways': driveways,
    'garageDoors': garage_doors,
    'landmarks': landmarks,
}
with open(os.path.join(OUT_JS, 'city-geodata.js'), 'w') as f:
    f.write('// js/city-geodata.js — GENERATED by Assets/Tools/build-annarbor.py, do not edit by hand.\n'
            '// Real Ann Arbor geography in the simulation\'s world frame: 1 unit = 1 m, x = east, z = south,\n'
            '// origin at the centreline intersection of Main St & Liberty St, true north up.\n'
            '// Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.\n'
            '// Sources: © OpenStreetMap contributors (ODbL): streets, water, parks, parking & landmarks;\n'
            '// City of Ann Arbor Building Footprints (blocks\' building cover).\n'
            'export const GEO = ')
    json.dump(GEO, f, separators=(',', ':'))
    f.write(';\n')
print('wrote geodata', os.path.getsize(os.path.join(OUT_JS, 'city-geodata.js')) // 1024, 'KB')


# --- Buildings binary (NYB1) -------------------------------------------------------------------------------------------------
def canonical_ring(ring):
    pts = []
    for x, z in list(ring.coords)[:-1]:
        p = (round(x * 2), round(z * 2))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) > 1 and pts[-1] == pts[0]:
        pts.pop()
    if len(pts) < 3:
        return []
    s = min(range(len(pts)), key=pts.__getitem__)
    return pts[s:] + pts[:s]


def quantize(geom):
    out = []
    for p in parts(geom):
        p = orient(p, sign=1.0)
        o = canonical_ring(p.exterior)
        if not o:
            continue
        hs = [canonical_ring(h) for h in p.interiors]
        out.append([o] + sorted(h for h in hs if h))
    return out


def morton(x, z):
    x, z = int(x / 16) + 4096, int(z / 16) + 4096
    k = 0
    for i in range(14):
        k |= ((x >> i) & 1) << (2 * i) | ((z >> i) & 1) << (2 * i + 1)
    return k


packed = []
for b in buildings:
    polys = quantize(b['geom'].simplify(0.25))
    if polys:
        c = b['geom'].centroid
        packed.append((morton(c.x, c.y), b['height'], b['kind'], polys))
packed.sort(key=lambda t: t[0])
meta, xs, zs = bytearray(), bytearray(), bytearray()


def uint(d, v):
    while v > 127:
        d.append((v & 127) | 128)
        v >>= 7
    d.append(v)


def sint(d, v):
    uint(d, v * 2 if v >= 0 else -v * 2 - 1)


uint(meta, len(packed))
px = pz = 0
for _, h, kind, polys in packed:
    uint(meta, h)
    uint(meta, kind)
    uint(meta, len(polys))
    for poly in polys:
        uint(meta, len(poly))
        for ring in poly:
            uint(meta, len(ring))
            for x, z in ring:
                sint(xs, x - px)
                sint(zs, z - pz)
                px, pz = x, z
data = struct.pack('<4sII', b'NYB1', len(meta), len(xs)) + bytes(meta) + bytes(xs) + bytes(zs)
with gzip.open(os.path.join(OUT_JS, 'building-geodata.bin.gz'), 'wb', 9) as f:
    f.write(data)
print(f'{len(packed)} buildings packed, {os.path.getsize(os.path.join(OUT_JS, "building-geodata.bin.gz")) // 1024} KB')

# --- Trees binary (NYT1) -------------------------------------------------------------------------------------------------------
street_trees.sort(key=lambda p: morton(p[0] / 2, p[1] / 2))
txs, tzs = bytearray(), bytearray()
px = pz = 0
for x, z in street_trees:
    sint(txs, x - px)
    sint(tzs, z - pz)
    px, pz = x, z
# NYT2: NYT1's coordinates, then a byte per tree for its kind and one for its height (25 cm steps, 0 unknown)
kinds = bytes(tree_kind[p][0] for p in street_trees)
heights = bytes(tree_kind[p][1] for p in street_trees)
data = struct.pack('<III', 0x3254594e, len(street_trees), len(txs)) + bytes(txs) + bytes(tzs) + kinds + heights
with gzip.open(os.path.join(OUT_JS, 'tree-geodata.bin.gz'), 'wb', 9) as f:
    f.write(data)

LO = -30.0  # the lowest height kept, metres under BASE (227.8 m)
# --- The river's bed (RIV1): how far each 2 m cell of the water is dug down to the bed (0 at the shore, 255 a few metres
# out), and the water's level on the elevation's 10 m grid: the
# lowest ground within 40 m, a little under it, so every bank stands above the water.
from PIL import Image, ImageDraw

DSTEP = 2.0
wb = water_open.bounds
dx0, dz0 = math.floor(wb[0] / 10) * 10 - 20, math.floor(wb[1] / 10) * 10 - 20
dcols, drows = int((wb[2] - dx0) / DSTEP) + 21, int((wb[3] - dz0) / DSTEP) + 21


def raster(geoms):
    im = Image.new('L', (dcols, drows), 0)
    dr = ImageDraw.Draw(im)
    for g in geoms:
        for p in parts(g):
            dr.polygon([((x - dx0) / DSTEP, (z - dz0) / DSTEP) for x, z in p.exterior.coords], fill=255)
            for h in p.interiors:
                dr.polygon([((x - dx0) / DSTEP, (z - dz0) / DSTEP) for x, z in h.coords], fill=0)
    return np.asarray(im) > 0


wet = raster([water_open])


def dist(src, cap):
    # metres from each cell to the nearest of `src`, up to `cap` (8-neighbour chamfer, relaxed)
    d = np.where(src, 0.0, cap)
    for _ in range(int(cap / DSTEP) + 2):
        p = np.pad(d, 1, mode='edge')
        for oy, ox, c in ((0, 1, 1), (2, 1, 1), (1, 0, 1), (1, 2, 1), (0, 0, 1.414), (0, 2, 1.414), (2, 0, 1.414), (2, 2, 1.414)):
            d = np.minimum(d, p[oy:oy + drows, ox:ox + dcols] + c * DSTEP)
    return np.minimum(d, cap)


def ease(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


dig = ease((dist(~wet, 9) - 0.5) / 7.5) * wet
eb = gzip.open(os.path.join(OUT_DATA, 'elevation.bin.gz')).read()
ex0, ez0, estep, ecols, erows, _ = struct.unpack('<6f', eb[4:28])
ecols, erows = int(ecols), int(erows)
E = np.frombuffer(eb, '<u2', ecols * erows, 28).reshape(erows, ecols) / 100.0 + struct.unpack('<f', eb[24:28])[0]
lc0, lr0 = int((dx0 - ex0) / estep), int((dz0 - ez0) / estep)
lcols, lrows = int(dcols * DSTEP / estep) + 2, int(drows * DSTEP / estep) + 2
pad = 5
sub = E[max(0, lr0 - pad):lr0 + lrows + pad, max(0, lc0 - pad):lc0 + lcols + pad]
low = sub.copy()
for _ in range(4):
    p = np.pad(low, 1, mode='edge')
    low = np.minimum.reduce([p[oy:oy + low.shape[0], ox:ox + low.shape[1]] for oy in range(3) for ox in range(3)])
lvl = low - 0.45
for _ in range(3):  # eased along the river, never above the lowest bank
    p = np.pad(lvl, 1, mode='edge')
    lvl = np.minimum(sum(p[oy:oy + lvl.shape[0], ox:ox + lvl.shape[1]] for oy in range(3) for ox in range(3)) / 9, low - 0.45)
oy, ox = lr0 - max(0, lr0 - pad), lc0 - max(0, lc0 - pad)
lvl = np.clip(lvl[oy:oy + lrows, ox:ox + lcols], LO, 300)
hdr = b'RIV1' + struct.pack('<10f', dx0, dz0, DSTEP, dcols, drows, ex0 + lc0 * estep, ez0 + lr0 * estep, estep,
                            lvl.shape[1], lvl.shape[0])
body = np.round(dig * 255).astype(np.uint8).tobytes()
with gzip.open(os.path.join(OUT_DATA, 'river.bin.gz'), 'wb', 9) as f:
    f.write(hdr + body + b'\0' * (len(body) % 2) + np.round(lvl * 100).astype('<i2').tobytes())
print(f'river bed {dcols} x {drows} at {DSTEP} m, levels {lvl.shape[1]} x {lvl.shape[0]},',
      os.path.getsize(os.path.join(OUT_DATA, 'river.bin.gz')) // 1024, 'KB')

if os.environ.get('SKIP_ELEVATION'):
    sys.exit(0)

# --- Elevation (ELV2) from Terrain Tiles ----------------------------------------------------------------------------------------
from PIL import Image

STEP, MARGIN, Z = 10.0, 3000.0, 14
TILES = os.path.join(REF, 'tiles')
os.makedirs(TILES, exist_ok=True)
tile_cache = {}


def tile(tx, ty):
    if (tx, ty) not in tile_cache:
        path = os.path.join(TILES, f'{Z}_{tx}_{ty}.png')
        if not os.path.exists(path):
            url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
            req = urllib.request.Request(url, headers={'User-Agent': 'lamp-annarbor-builder'})
            open(path, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
        a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
        tile_cache[(tx, ty)] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    return tile_cache[(tx, ty)]


ex0, ez0 = math.floor((X0 - MARGIN) / STEP) * STEP, math.floor((Z0 - MARGIN) / STEP) * STEP
cols, rows = int((X1 + MARGIN - ex0) / STEP) + 1, int((Z1 + MARGIN - ez0) / STEP) + 1
gx, gz = np.meshgrid(ex0 + np.arange(cols) * STEP, ez0 + np.arange(rows) * STEP)
lon = LON0 + gx / KX
lat = LAT0 - gz / KY
n = 2 ** Z
fx = (lon + 180) / 360 * n * 256
fy = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * n * 256
H = np.zeros(gx.shape)
ix, iy = np.floor(fx - 0.5).astype(int), np.floor(fy - 0.5).astype(int)
ax, ay = fx - 0.5 - ix, fy - 0.5 - iy


def sample(px_, py_):
    out = np.zeros(px_.shape)
    tx, ty = px_ // 256, py_ // 256
    for key in set(zip(tx.ravel().tolist(), ty.ravel().tolist())):
        sel = (tx == key[0]) & (ty == key[1])
        t = tile(*key)
        out[sel] = t[py_[sel] % 256, px_[sel] % 256]
    return out


H = (sample(ix, iy) * (1 - ax) + sample(ix + 1, iy) * ax) * (1 - ay) + (sample(ix, iy + 1) * (1 - ax) + sample(ix + 1, iy + 1) * ax) * ay
# smooth (Gaussian, 1.5 samples) so streets don't follow the survey's noise
k = np.exp(-0.5 * (np.arange(-4, 5) / 1.5) ** 2)
k /= k.sum()
H = np.apply_along_axis(lambda r: np.convolve(np.pad(r, 4, mode='edge'), k, 'valid'), 1, H)
H = np.apply_along_axis(lambda r: np.convolve(np.pad(r, 4, mode='edge'), k, 'valid'), 0, H)
inside = (gx > X0) & (gx < X1) & (gz > Z0) & (gz < Z1)
# the base every height in the game is measured from: the lowest half percent of the first map's box (227.8 m),
# kept as the map grows so the river's, the dams' and the landmarks' heights in the code stay where they are
# The east end of town, down the river past Geddes, lies lower: heights go down to LO, the ELV2 header's last number,
# stored from it
BASE = 227.8
rel = np.clip(H - BASE, LO, 600)
print(f'elevation {cols} x {rows} at {STEP} m, base {BASE:.1f} m, top {rel[inside].max():.1f} m above it')
hdr = b'ELV2' + struct.pack('<6f', ex0, ez0, STEP, cols, rows, LO)
with gzip.open(os.path.join(OUT_DATA, 'elevation.bin.gz'), 'wb', 9) as f:
    f.write(hdr + np.round((rel - LO) * 100).astype('<u2').tobytes())
print('elevation', os.path.getsize(os.path.join(OUT_DATA, 'elevation.bin.gz')) // 1024, 'KB')

# The heaviest layers out of city-geodata.js into files read as they're needed (split-geodata.py)
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'split-geodata.py')], check=True)
