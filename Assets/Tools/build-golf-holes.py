# Golf holes the city's map data leaves out, in the game's frame (metres east and south of Main St & Liberty St),
# written to Web/js/golf-holes.js (a module, so the course and the map have them at once) for golf.js layOutHoles:
#   holes  [{ ref, par, line: flat [x, z, ...] }]   OpenStreetMap's golf=hole ways (ODbL): each from its tee to its green
# OpenStreetMap gives Huron Hills' holes no par, so each hole's par is the course's published scorecard's (SCORECARDS).
# Every other course's holes are build-golf-courses.py's (golf-courses.js); this checks their pars against the published
# scorecards too, and each mapped hole's length against its card's yards, so a hole numbered wrong on the map shows up.
# A hole the map doesn't have is left out, never made up.
# Input: .lamp/reference/huronhills/osm-map.xml (the OSM API's /map for the box around Huron Hills Golf Course:
# -83.705,42.260,-83.685,42.277).
# Run: python -I Assets/Tools/build-golf-holes.py <app folder>
import json, math, os, sys
import xml.etree.ElementTree as ET

ROOT = sys.argv[1]
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)

# Published scorecards, holes 1 to n: par, and yards from the longest tees (checked Nov 2026)
SCORECARDS = {
    # golflink.com's Huron Hills card, White tees (5,071 yd, par 67); hole19 and stymie.golf give the same pars
    'Huron Hills Golf Course': {
        'par': [4, 5, 3, 3, 4, 3, 5, 4, 4, 4, 3, 4, 4, 3, 4, 3, 3, 4],
        'yd': [384, 469, 136, 231, 326, 196, 488, 337, 376, 276, 151, 270, 239, 169, 258, 196, 184, 385]},
    # the course's own card (umgolfcourse.umich.edu), Wolverine tees (6,684 yd, par 71)
    'University of Michigan Golf Course': {
        'par': [5, 4, 5, 4, 3, 4, 4, 3, 4, 4, 5, 3, 4, 3, 4, 4, 4, 4],
        'yd': [540, 412, 554, 413, 182, 309, 374, 160, 409, 411, 529, 246, 343, 146, 392, 415, 399, 450]},
    # stymie.golf's and golflink.com's Leslie Park card, Black tees (6,608 yd, par 72)
    'Leslie Park Golf Course': {
        'par': [5, 3, 4, 5, 4, 4, 3, 4, 4, 4, 5, 3, 4, 4, 4, 5, 3, 4],
        'yd': [543, 196, 359, 507, 407, 425, 149, 344, 399, 413, 490, 174, 403, 373, 345, 495, 150, 436]},
    # golfpass.com's Georgetown card, nine holes (1,272 yd, par 28)
    'Georgetown Country Club': {
        'par': [3, 3, 3, 3, 3, 4, 3, 3, 3],
        'yd': [124, 75, 152, 115, 154, 278, 139, 90, 145]},
}

length = lambda L: sum(math.hypot(L[i + 2] - L[i], L[i + 3] - L[i + 1]) for i in range(0, len(L) - 2, 2))


def check(name, holes):
    """Each hole against its course's card: the par it's given, and its mapped length against the card's yards."""
    card = SCORECARDS.get(name)
    if not card:
        print(f'{name}: no published scorecard here, {len(holes)} holes as mapped')
        return
    bad = 0
    for h in holes:
        k = int(h['ref']) - 1 if (h['ref'] or '').isdigit() else -1
        if not 0 <= k < len(card['par']):
            print(f'  {name} hole {h["ref"]}: not on the card')
            bad += 1
            continue
        yd, cy = length(h['line']) * 1.0936, card['yd'][k]
        note = '' if abs(yd - cy) < max(25, cy * 0.12) else '  (mapped from a forward tee?)'
        if h['par'] != card['par'][k]:
            note += f'  PAR {h["par"]} on the map, {card["par"][k]} on the card'
            bad += 1
        print(f'  {h["ref"]:>2} par {card["par"][k]}  {yd:4.0f} yd mapped, {cy} on the card{note}')
    missing = sorted(set(range(1, len(card['par']) + 1)) - {int(h['ref']) for h in holes if (h['ref'] or '').isdigit()})
    print(f'{name}: {len(holes)} holes, par {sum(h["par"] or 0 for h in holes)} (card {sum(card["par"])})'
          + (f', not mapped: {missing}' if missing else '') + (f', {bad} DISAGREE' if bad else ''))


root = ET.parse(os.path.join(ROOT, '.lamp/reference/huronhills/osm-map.xml')).getroot()
nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
holes = []
card = SCORECARDS['Huron Hills Golf Course']
for w in root.iter('way'):
    t = {k.get('k'): k.get('v') for k in w.iter('tag')}
    if t.get('golf') != 'hole':
        continue
    line = []
    for nd in w.iter('nd'):
        if nd.get('ref') in nodes:
            x, z = xz(*nodes[nd.get('ref')])
            line += [round(x, 1), round(z, 1)]
    ref = t.get('ref') or ''
    if len(line) < 4 or not ref.isdigit() or not 1 <= int(ref) <= len(card['par']):
        continue
    par = int(t['par']) if t.get('par', '').isdigit() else card['par'][int(ref) - 1]
    holes.append({'ref': ref, 'par': par, 'line': line})
holes.sort(key=lambda h: int(h['ref']))
check('Huron Hills Golf Course', holes)
out = os.path.join(ROOT, 'Web/js/golf-holes.js')
with open(out, 'w') as f:
    f.write('// Lamp: written by Assets/Tools/build-golf-holes.py from OpenStreetMap (ODbL): Huron Hills Golf Course\'s 18 holes,\n')
    f.write('// each a line from its tee to its green in the game\'s frame (metres east and south of Main & Liberty), with the\n')
    f.write('// par on the course\'s published scorecard (the map gives none)\n')
    f.write('export const GOLF_HOLES = ' + json.dumps(holes, separators=(',', ':')) + ';\n')
print(len(holes), 'holes ->', out)

# the other courses, as build-golf-courses.py wrote them
src = open(os.path.join(ROOT, 'Web/js/golf-courses.js')).read()
for c in json.loads(src[src.index('['):src.rindex(']') + 1]):
    check(c['name'], c['holes'])
