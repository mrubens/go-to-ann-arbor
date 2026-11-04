// js/yards.js
// The city's heaviest map layers, kept out of city-geodata.js in compact files (Assets/Tools/split-geodata.py) so the
// page never parses the whole city as one script: the driveways, walks and lawns in 500 m squares (data/yards/), read
// only as the player comes near when the city streams (device-tier.js), and the trees of the woods and the curb cuts,
// small enough to read whole (data/woods.bin.gz, data/curb-cuts.bin.gz). loadYardData() reads the small ones and the
// squares' index once, before the city is built; the whole city's yards are read at once only where it's built whole.
import { asset } from '../lamp-game.js';

const SQUARE = 500;
const files = { index: null, woods: null, cuts: null };

async function unzipped(url) {
  const packed = await asset(url);
  if (!packed) throw new Error(`${url} not found`);
  // a server that sends .gz as Content-Encoding: gzip hands over bytes the browser has already inflated
  const head = new Uint8Array(packed, 0, 2);
  return head[0] === 0x1f && head[1] === 0x8b
    ? await new Response(new Response(packed).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : packed;
}

// The squares' index, the woods' trees and the curb cuts
export async function loadYardData() {
  const [index, woods, cuts] = await Promise.all([
    asset('data/yards/index.json').then((b) => JSON.parse(new TextDecoder().decode(b))),
    unzipped('data/woods.bin.gz'), unzipped('data/curb-cuts.bin.gz')
  ]);
  files.index = index;
  // WDS1: n, then x, z of each tree, then each one's kind (0 woods, 1 parks and cemeteries, 2 yards)
  const n = new Uint32Array(woods, 4, 1)[0], xz = new Float32Array(woods, 8, n * 2), kinds = new Uint8Array(woods, 8 + n * 8, n);
  const trees = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { trees[i * 3] = xz[i * 2]; trees[i * 3 + 1] = xz[i * 2 + 1]; trees[i * 3 + 2] = kinds[i]; }
  files.woods = trees;
  // CUT1: n, then x, z, the way to the street (x, z) and the width of each
  files.cuts = new Float32Array(cuts.slice(8, 8 + new Uint32Array(cuts, 4, 1)[0] * 20));
  return files;
}

// [x, z, kind, ...] of every tree of the woods, parks and yards
export const woodsTrees = () => files.woods || new Float32Array(0);
// [x, z, ux, uz, width, ...] of every curb cut
export const curbCuts = () => files.cuts || new Float32Array(0);
// The squares' keys (x * 100000 + z in squares, as terrain.js's streamed tiles) and the fingerprint of their contents
export const yardSquares = () => Object.keys(files.index?.tiles || {}).map((k) => {
  const [x, z] = k.split(',').map(Number);
  return x * 100000 + z;
});
export const yardsVersion = () => files.index?.version || '';
export const squareBounds = (key) => {
  const x = Math.round(key / 100000), z = key - x * 100000;
  return { x0: x * SQUARE, z0: z * SQUARE, x1: (x + 1) * SQUARE, z1: (z + 1) * SQUARE };
};

// One square's yards (YRD1): [{ id, kind, rings }], every ring a flat [x, z, ...] Float32Array, in the city's order
async function readSquare(key) {
  const x = Math.round(key / 100000), z = key - x * 100000;
  const buf = await unzipped(`data/yards/${x}_${z}.bin.gz`);
  const [n, rings] = new Uint32Array(buf, 4, 3);
  const ids = new Uint32Array(buf, 16, n), kinds = new Uint32Array(buf, 16 + n * 4, n), ringsOf = new Uint32Array(buf, 16 + n * 8, n);
  const lens = new Uint32Array(buf, 16 + n * 12, rings), coords = new Float32Array(buf, 16 + n * 12 + rings * 4);
  const out = [];
  for (let i = 0, r = 0, at = 0; i < n; i++) {
    const list = [];
    for (let k = 0; k < ringsOf[i]; k++, r++) { list.push(coords.subarray(at, at + lens[r] * 2)); at += lens[r] * 2; }
    out.push({ id: ids[i], kind: kinds[i], rings: list });
  }
  return out;
}

// The lawns and the driveways of one square, as city-geodata.js had them (lists of rings), with the curb cuts near it
export async function squareYards(key) {
  const polys = await readSquare(key);
  const b = squareBounds(key), C = curbCuts(), cuts = [];
  // (a cut's ramp is a few metres across: those just outside the square may have a triangle whose middle is in it)
  for (let i = 0; i < C.length; i += 5) {
    if (C[i] > b.x0 - 10 && C[i] < b.x1 + 10 && C[i + 1] > b.z0 - 10 && C[i + 1] < b.z1 + 10) for (let k = 0; k < 5; k++) cuts.push(C[i + k]);
  }
  return { lawns: polys.filter((p) => p.kind === 1).map((p) => p.rings), driveways: polys.filter((p) => p.kind === 0).map((p) => p.rings), cuts };
}

// Every square's yards at once, each polygon once, for a city built whole
export async function allYards() {
  const seen = new Map();
  const squares = await Promise.all(yardSquares().map(readSquare));
  for (const list of squares) for (const p of list) if (!seen.has(p.id)) seen.set(p.id, p);
  const polys = [...seen.values()].sort((a, b) => a.id - b.id);
  return { lawns: polys.filter((p) => p.kind === 1).map((p) => p.rings), driveways: polys.filter((p) => p.kind === 0).map((p) => p.rings), cuts: curbCuts() };
}
