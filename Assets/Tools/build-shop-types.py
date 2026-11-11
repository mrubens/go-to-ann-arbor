# What kind of business each storefront sign is: a finer type than GEO.signs' six sign categories, from the same
# OpenStreetMap places (poi/osm_pois.json: amenity, shop, tourism, leisure, cuisine), written to
# Web/data/shop-types.json for shop-types.js:
#   types  the type names, in order (index 0 'unknown': the generic shopfront)
#   list   one type index per sign, in GEO.signs' order
#   variants  1 for the signs that show something more: a barber (a pole by the door), a cinema, a supermarket (its
#             aisles reach two bays either side, and no neon OPEN)
#   cuisines  the kinds of restaurant, in order (0 'generic'), and `cuisine` one index per sign (0 for what isn't a
#             restaurant or a fast food place): from the place's cuisine tag, else from words in its name
# Each sign is matched to the place of the same name nearest to it (two places of one name can be different things),
# so build-annarbor.py and the 4 MB city-geodata.js need not be run again.
# Inputs: .lamp/reference/aa/poi/osm_pois.json and Web/js/city-geodata.js (read with node).
# Run: python3 -I Assets/Tools/build-shop-types.py <app folder> [folder holding .lamp/reference, if not the app's]
import json, math, os, subprocess, sys, collections

ARGS = [a for a in sys.argv[1:] if a != '-v']  # -v: say which signs found no place of their name
ROOT = ARGS[0]
REF = os.path.join(ARGS[1] if len(ARGS) > 1 else ROOT, '.lamp/reference/aa')
LAT0, LON0 = 42.27965, -83.74838
A, E2 = 6378137.0, 6.69437999014e-3
phi = math.radians(LAT0)
KX = math.pi / 180 * A / math.sqrt(1 - E2 * math.sin(phi) ** 2) * math.cos(phi)
KY = math.pi / 180 * A * (1 - E2) / (1 - E2 * math.sin(phi) ** 2) ** 1.5
xz = lambda lon, lat: ((lon - LON0) * KX, -(lat - LAT0) * KY)

TYPES = ['unknown', 'restaurant', 'fast_food', 'cafe', 'bakery', 'bar', 'books', 'apparel', 'jewelry_gift', 'grocery',
         'salon', 'bank', 'medical', 'bike_sports', 'dispensary', 'gallery', 'theatre', 'retail', 'service']
T = {n: i for i, n in enumerate(TYPES)}
AMENITY = {
    'restaurant': 'restaurant', 'food_court': 'fast_food', 'fast_food': 'fast_food', 'cafe': 'cafe',
    'ice_cream': 'bakery', 'bar': 'bar', 'pub': 'bar', 'biergarten': 'bar', 'nightclub': 'bar', 'bank': 'bank',
    'pharmacy': 'medical', 'dentist': 'medical', 'clinic': 'medical', 'doctors': 'medical', 'veterinary': 'medical',
    'post_office': 'service', 'theatre': 'theatre', 'cinema': 'theatre', 'library': 'gallery',
    'arts_centre': 'gallery', 'museum': 'gallery', 'gallery': 'gallery',
}
SHOP = {
    'bakery': 'bakery', 'pastry': 'bakery', 'confectionery': 'bakery', 'chocolate': 'bakery', 'ice_cream': 'bakery',
    'coffee': 'cafe', 'tea': 'cafe',
    'books': 'books',
    'clothes': 'apparel', 'shoes': 'apparel', 'boutique': 'apparel', 'fashion_accessories': 'apparel',
    'bag': 'apparel', 'leather': 'apparel', 'tailor': 'apparel', 'charity': 'apparel', 'second_hand': 'apparel',
    'department_store': 'apparel', 'baby_goods': 'apparel',
    'jewelry': 'jewelry_gift', 'gift': 'jewelry_gift', 'antiques': 'jewelry_gift', 'craft': 'jewelry_gift',
    'florist': 'jewelry_gift', 'perfumery': 'jewelry_gift', 'cosmetics': 'jewelry_gift', 'gold_buyer': 'jewelry_gift',
    'rock': 'jewelry_gift', 'stationery': 'jewelry_gift', 'toys': 'jewelry_gift', 'party': 'jewelry_gift',
    'convenience': 'grocery', 'supermarket': 'grocery', 'greengrocer': 'grocery', 'grocery': 'grocery',
    'food': 'grocery', 'deli': 'grocery', 'butcher': 'grocery', 'seafood': 'grocery', 'dairy': 'grocery',
    'health_food': 'grocery', 'alcohol': 'grocery', 'wine': 'grocery', 'beverages': 'grocery',
    'variety_store': 'grocery', 'kiosk': 'grocery', 'tobacco': 'grocery', 'e-cigarette': 'grocery',
    'nutrition_supplements': 'grocery', 'mushroom': 'grocery',
    'hairdresser': 'salon', 'beauty': 'salon', 'tattoo': 'salon', 'massage': 'salon', 'piercing': 'salon',
    'pet_grooming': 'salon',
    'optician': 'medical', 'chemist': 'medical', 'hearing_aids': 'medical', 'medical_supply': 'medical',
    'herbalist': 'medical',
    'bicycle': 'bike_sports', 'sports': 'bike_sports', 'outdoor': 'bike_sports', 'scuba_diving': 'bike_sports',
    'scooter': 'bike_sports',
    'cannabis': 'dispensary',
    'art': 'gallery', 'frame': 'gallery', 'photo': 'gallery',
    'dry_cleaning': 'service', 'laundry': 'service', 'copyshop': 'service', 'printing': 'service',
    'funeral_directors': 'service', 'money_lender': 'service', 'locksmith': 'service', 'shoe_repair': 'service',
    'storage_rental': 'service', 'rental': 'service', 'psychic': 'service', 'vacant': 'service',
    'telecommunication': 'service', 'car_repair': 'service', 'tyres': 'service', 'car': 'service',
}


CUISINES = ['generic', 'pizza', 'mexican', 'chinese', 'japanese', 'korean', 'noodles', 'indian', 'mediterranean',
            'italian', 'diner', 'burger', 'sandwich', 'chicken', 'steakhouse', 'seafood', 'barbecue']
# a place's cuisine tag (its values in the order written, the first that's known wins), then words in its name
CUISINE_TAGS = [
    ('pizza', 'pizza'), ('mexican', 'mexican'), ('tex-mex', 'mexican'), ('taco', 'mexican'), ('burrito', 'mexican'), ('latin_american', 'mexican'),
    ('chinese', 'chinese'), ('dumpling', 'chinese'), ('hotpot', 'chinese'), ('sichuan', 'chinese'), ('cantonese', 'chinese'), ('taiwanese', 'chinese'),
    ('sushi', 'japanese'), ('japanese', 'japanese'), ('korean', 'korean'),
    ('ramen', 'noodles'), ('noodle', 'noodles'), ('thai', 'noodles'), ('vietnamese', 'noodles'), ('pho', 'noodles'), ('asian', 'noodles'),
    ('indian', 'indian'), ('nepalese', 'indian'), ('pakistani', 'indian'), ('curry', 'indian'),
    ('mediterranean', 'mediterranean'), ('greek', 'mediterranean'), ('middle_eastern', 'mediterranean'), ('lebanese', 'mediterranean'),
    ('kebab', 'mediterranean'), ('falafel', 'mediterranean'), ('turkish', 'mediterranean'), ('persian', 'mediterranean'), ('shawarma', 'mediterranean'),
    ('italian', 'italian'), ('pasta', 'italian'),
    ('steak_house', 'steakhouse'), ('steak', 'steakhouse'), ('french', 'steakhouse'), ('fine_dining', 'steakhouse'),
    ('seafood', 'seafood'), ('fish', 'seafood'), ('barbecue', 'barbecue'), ('bbq', 'barbecue'),
    ('burger', 'burger'), ('chicken', 'chicken'), ('wings', 'chicken'),
    ('sandwich', 'sandwich'), ('deli', 'sandwich'), ('sub', 'sandwich'), ('hot_dog', 'sandwich'),
    ('breakfast', 'diner'), ('pancake', 'diner'), ('diner', 'diner'), ('american', 'diner'), ('brunch', 'diner'),
]
CUISINE_NAMES = [
    ('pizz', 'pizza'), ('taqueria', 'mexican'), ('taco', 'mexican'), ('burrito', 'mexican'), ('cantina', 'mexican'), ('mexican', 'mexican'),
    ('sushi', 'japanese'), ('ramen', 'noodles'), ('noodle', 'noodles'), ('pho', 'noodles'), ('thai', 'noodles'),
    ('china', 'chinese'), ('chinese', 'chinese'), ('wok', 'chinese'), ('dumpling', 'chinese'), ('korea', 'korean'), ('bulgogi', 'korean'),
    ('india', 'indian'), ('curry', 'indian'), ('tandoor', 'indian'), ('shawarma', 'mediterranean'), ('falafel', 'mediterranean'),
    ('gyro', 'mediterranean'), ('kabob', 'mediterranean'), ('kebab', 'mediterranean'), ('mediterranean', 'mediterranean'),
    ('trattoria', 'italian'), ('pasta', 'italian'), ('ristorante', 'italian'), ('steak', 'steakhouse'), ('chop house', 'steakhouse'),
    ('seafood', 'seafood'), ('oyster', 'seafood'), ('fish', 'seafood'), ('bbq', 'barbecue'), ('barbecue', 'barbecue'), ('smoke', 'barbecue'),
    ('burger', 'burger'), ('chicken', 'chicken'), ('wing', 'chicken'), ('deli', 'sandwich'), ('sub', 'sandwich'), ('sandwich', 'sandwich'),
    ('diner', 'diner'), ('pancake', 'diner'), ('grill', 'diner'), ('cafe', 'diner'), ('coney', 'diner'),
]


def cuisine_of(t, name):
    for c in (t.get('cuisine') or '').lower().replace(',', ';').split(';'):
        c = c.strip()
        for word, k in CUISINE_TAGS:
            if c == word or (len(word) > 3 and word in c):
                return k
    low = ' ' + name.lower() + ' '
    for word, k in CUISINE_NAMES:
        if (' ' + word in low) if len(word) <= 4 else (word in low):
            return k
    return 'generic'


def kind(t):
    a, s = t.get('amenity'), t.get('shop')
    if a in AMENITY:
        k = AMENITY[a]
        cuisine = t.get('cuisine', '')
        # an ice cream, doughnut or bagel counter mapped as fast food or a cafe; a coffee counter mapped as fast food
        if k in ('fast_food', 'cafe', 'restaurant'):
            if any(c in cuisine for c in ('ice_cream', 'frozen_yogurt', 'donut', 'bagel', 'dessert', 'cake', 'pastry', 'cookie')):
                return 'bakery'
            if k == 'fast_food' and any(c in cuisine for c in ('coffee', 'bubble_tea', 'tea')):
                return 'cafe'
        return k
    if t.get('tourism') in ('museum', 'gallery'):
        return 'gallery'
    if t.get('tourism') == 'hotel' or t.get('leisure') == 'fitness_centre':
        return 'service'
    if s:
        return SHOP.get(s, 'retail')
    return None


places = collections.defaultdict(list)
for e in json.load(open(os.path.join(REF, 'poi/osm_pois.json')))['elements']:
    t = e.get('tags', {})
    name = (t.get('name') or '').strip()
    k = kind(t)
    c = e.get('center') or ({'lon': e['lon'], 'lat': e['lat']} if 'lon' in e else None)
    if not name or not k or not c:
        continue
    variant = (k == 'salon' and ('barber' in name.lower() or t.get('hairdresser') == 'barber' or t.get('male') == 'yes'
                                 and t.get('female') != 'yes')) \
        or (k == 'theatre' and t.get('amenity') == 'cinema') or (k == 'grocery' and t.get('shop') == 'supermarket')
    places[name].append((*xz(c['lon'], c['lat']), k, int(variant), cuisine_of(t, name) if k in ('restaurant', 'fast_food') else 'generic'))

js = "import('./city-geodata.js').then(({GEO}) => process.stdout.write(JSON.stringify(GEO.signs)))"
signs = json.loads(subprocess.run(['node', '--input-type=module', '-e', js], cwd=os.path.join(ROOT, 'Web/js'),
                                  capture_output=True, check=True, text=True).stdout)
names, flat = signs['names'], signs['list']
# what a sign category falls back on when no place of its name is found (it shouldn't happen: the signs came from them)
FALLBACK = ['restaurant', 'cafe', 'bar', 'retail', 'service', 'gallery']
out, variants, cuisines, count, ccount, missed = [], [], [], collections.Counter(), collections.Counter(), 0
for i in range(0, len(flat), 7):
    x, z, name, cat = flat[i], flat[i + 1], names[flat[i + 5]], flat[i + 6]
    best = min(places.get(name, []), key=lambda p: math.hypot(p[0] - x, p[1] - z), default=None)
    if best is None or math.hypot(best[0] - x, best[1] - z) > 400:
        missed += 1
        if '-v' in sys.argv: print('  unmatched:', name, cat, best)
        k, v = FALLBACK[cat], 0
        c = cuisine_of({}, name) if k == 'restaurant' else 'generic'
    else:
        k, v, c = best[2], best[3], best[4]
    cuisines.append(CUISINES.index(c))
    if k in ('restaurant', 'fast_food'): ccount[c] += 1
    variants.append(v)
    out.append(T[k])
    count[k] += 1

path = os.path.join(ROOT, 'Web/data/shop-types.json')
json.dump({'types': TYPES, 'list': out, 'variants': variants, 'cuisines': CUISINES, 'cuisine': cuisines}, open(path, 'w'), separators=(',', ':'))
print(f'{len(out)} signs ({missed} unmatched) -> {path}')
print(', '.join(f'{k} {count[k]}' for k in TYPES if count[k]))
print(f'{sum(variants)} variants (barbers, cinemas, supermarkets)')
print('restaurants and fast food by kind: ' + ', '.join(f'{k} {ccount[k]}' for k in CUISINES if ccount[k]))
