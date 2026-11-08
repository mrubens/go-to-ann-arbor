// Where Ann Arbor's murals and sculptures are, as plain data: murals.js and public-art.js build them, and
// city-config.js lists each as a landmark on the map, in search and in the street-name signs (`art`).
//
// Murals: on the walls they're really on (walls measured off the city's building footprints; Ann Arbor Art Center,
// AADL's guide). `a`, `b`: the wall's ends in the game's frame (x east, z south); `face`: which way the wall looks (N, S, E, W);
// `w`, `h`: the mural's width and height in metres, centered along the wall at `at` (0..1, default the middle);
// `up`: how far above the ground its foot is.
export const MURALS = [
  { name: 'The Bookstore Mural', short: 'Bookstore Mural', artist: 'Richard Wolk', a: [591.3, 42.2], b: [614.0, 43.0], face: 'N', w: 19, h: 5.2, up: 2.3, paint: 'authors', picture: { file: 'assets/murals/bookstore-mural.jpg', crop: [0.075, 1], cropX: [0.012, 1], aspect: 3.68, fill: true } },
  { name: 'Challenge Everything. Create Anything.', short: 'Challenge Everything', artist: 'TreeTown Murals', a: [46.5, -180.4], b: [81.9, -178.9], face: 'N', w: 13, h: 29, up: 1.2, paint: 'challenge' },
  { name: 'Michigan Wings', short: 'Michigan Wings', artist: 'Kelsey Montague', a: [474.8, 172.1], b: [475.1, 191.2], face: 'W', at: 0.72, w: 5, h: 3.8, up: 0.25, paint: 'wings' },
  { name: 'Pretzel Bell mural', short: 'Pretzel Bell Mural', artist: 'Jesse Kassel', a: [74.3, 21.8], b: [73.5, 41.8], face: 'E', w: 15, h: 8, up: 0.6, paint: 'pretzels' },
  { name: 'Drifts', short: 'Drifts', artist: 'Ouizi', a: [-148.4, -79.8], b: [-139.5, -79.4], face: 'N', w: 8.4, h: 7.2, up: 0.5, paint: 'flowers' },
  { name: 'Hands and pixels (north)', short: 'Taylor White Mural', artist: 'Taylor White', a: [-267.2, -92.5], b: [-229.0, -90.6], face: 'N', w: 32, h: 8, up: 0.6, paint: 'hands' },
  { place: false, name: 'Hands and pixels (east)', artist: 'Taylor White', a: [-229.6, -70.8], b: [-229.0, -90.6], face: 'E', w: 18, h: 8, up: 0.6, paint: 'hands2' },
  { name: 'May Her Memory Be Our Innermost Revolution', short: 'Labyrinth Mural', artist: 'Ann Lewis', a: [-143.7, -283.6], b: [-144.6, -266.0], face: 'W', w: 15.5, h: 9, up: 0.4, paint: 'labyrinth' },
  { place: false, name: 'May Her Memory Be Our Innermost Revolution', artist: 'Ann Lewis', a: [-161.0, -254.3], b: [-160.6, -266.9], face: 'W', w: 11, h: 9, up: 0.4, paint: 'labyrinth2' },
  { name: 'What the Water Gave Me', short: 'What the Water Gave Me', artist: 'Avery Williamson', a: [-70.0, -84.8], b: [-70.9, -63.6], face: 'E', w: 17, h: 6, up: 0.5, paint: 'water' },
  { name: 'Untitled (sailboat)', short: 'Sailboat Mural', artist: 'Pat Perry', a: [-105.7, -133.0], b: [-73.3, -131.7], face: 'N', w: 22, h: 9.5, up: 0.8, paint: 'sailboat' },
  { name: 'Not Afraid to Dance', short: 'Not Afraid to Dance', artist: 'Gary Horton', a: [-261.9, -34.4], b: [-232.4, -34.3], face: 'S', w: 24, h: 7, up: 0.5, paint: 'bullseye' },
  { name: 'Literati notes', short: 'Literati Mural', artist: 'Literati Bookstore', a: [78.1, -78.6], b: [76.9, -45.2], face: 'E', w: 15, h: 6, up: 0.8, paint: 'notes' },
  { name: 'Art Center wall', short: 'Art Center Mural', artist: 'Live in Color', a: [-99.6, 14.4], b: [-74.0, 15.5], face: 'N', w: 21, h: 8.5, up: 0.5, paint: 'shapes' }
];

// Sculptures, at OpenStreetMap's points for them (public-art.js models each)
export const SCULPTURES = [
  { name: 'Orion (Mark di Suvero)', short: 'Orion', x: 656, z: 415 },
  { name: 'Daedalus (Charles Ginnever)', short: 'Daedalus', x: 700, z: 499 },
  { name: 'Sunday Morning in Deep Waters (Carl Milles)', short: 'Milles Fountain', x: 834, z: 38 },
  { name: 'Sea Nymph (Carl Milles)', short: 'Sea Nymph', x: 913, z: 35 },
  { name: 'Rampant Unicorn (Carl Milles)', short: 'Rampant Unicorn', x: 912, z: 22 },
  { name: 'The Pumas', short: 'Pumas', x: 1170, z: 101 },
  { name: 'Bronze book stack', short: 'Bronze Books', x: 852, z: 499 },
  { name: 'Book of Knowledge', short: 'Book of Knowledge', x: 316, z: 531 },
  { name: 'Flame of Wisdom', short: 'Flame of Wisdom', x: 1072, z: -272 },
  { name: 'g Minus Two (Jens Zorn)', short: 'g Minus Two', x: 987, z: 345 },
  { name: 'Positronium (Jens Zorn)', short: 'Positronium', x: 987, z: 337 },
  { name: "Veltman's Diagram (Jens Zorn)", short: "Veltman's Diagram", x: 975, z: 337 },
  { name: 'Begob (Alexander Liberman)', short: 'Begob', x: 2922, z: -1338 },
  { name: 'Tilted Donut Wheel with S (Fletcher Benton)', short: 'Tilted Donut', x: 2891, z: -1006 },
  { name: 'Indexer II (Kenneth Snelson)', short: 'Indexer II', x: 2803, z: -1203 },
  { name: 'Summaries of Arithmetic up to the Year 2000 (Alice Aycock)', short: 'Aycock Swirl', x: 2715, z: -1431 },
  { name: 'Three Cubes in a Seven-Axis Relationship', short: 'Three Cubes', x: 2766, z: -1570 },
  { name: 'The Lorch Column', short: 'Lorch Column', x: 2543, z: -1162 },
  { name: 'The Wave Field (Maya Lin)', short: 'Wave Field', x: 3018, z: -1485 },
  { name: 'The Rock', short: 'The Rock', x: 1638, z: 783 }
];

// Every piece as a place: a mural's is in front of its wall, 4 m out
export const ART_PLACES = [
  ...MURALS.filter((m) => m.place !== false).map((m) => {
    const t = m.at ?? 0.5, x = m.a[0] + (m.b[0] - m.a[0]) * t, z = m.a[1] + (m.b[1] - m.a[1]) * t;
    const [nx, nz] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[m.face];
    return { name: `${m.short} (${m.artist})`, short: m.short, x: x + nx * 4, z: z + nz * 4, art: 'mural' };
  }),
  ...SCULPTURES.map((s) => ({ ...s, art: 'sculpture' }))
];
