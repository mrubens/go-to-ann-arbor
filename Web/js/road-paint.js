import * as THREE from 'three/webgpu';
import { CROSSWALK } from './road-network.js';
import { GEO } from './city-geodata.js';
import { createRoadPaintMaterial } from './tsl-materials.js';
import { curbStalls } from './curb-parking.js';
import { bridgeDecks } from './terrain.js';

// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops: dashed lane lines, double yellow centre lines on two-way roads (Lamp: not on residential
// streets, as in Ann Arbor), a centre turn lane's yellow lines, a one-way's yellow left edge, stop bars at the stop
// lines, continental crosswalks where OpenStreetMap maps a painted crossing (and at traffic lights where it says nothing),
// and the city's bike lanes (its Non-Motorized Routes over OpenStreetMap's tags, build-annarbor.py): a solid white
// line with a bike and an arrow every so often; buffered ones with a hatched buffer of two lines; protected ones the
// same with flex posts in the buffer, or a low curb (bike-routes.js); two-way ones with a dashed yellow centre;
// advisory ones dashed on both sides of a street with no centre line; and shared-lane arrows (a bike under two
// chevrons) in the travel lane every 50 m.

const WHITE = new THREE.Color(0xe6e2d6);
const YELLOW = new THREE.Color(0xe8ad22);
const GREEN = new THREE.Color(0x2f9e57); // Lamp: the bike lanes' green at conflict zones
const STEP = 6; // Lamp: metres between a strip's vertices along it, so it follows the ground
const HEIGHT = LIFT.paint; // above the asphalt (ground-lifts.js)
import { LIFT } from './ground-lifts.js';
import { TURN_LANES } from './turn-lanes-data.js';
const PAINT_CELL_SIZE = 900;
const PAINT_CULL_DISTANCE = 1150;
const WIDEN_SPHERE_PAD = 16; // createRoadPaintMaterial widens thin distant strips up to 16x in screen space

// Spatial chunk builder shared by the town's street markings and perimeter highway markings (js/city-grid.js), so
// off-screen and distant (> 1.65 km) road paint is culled instead of transforming all 12.5 km of vertices every frame.
function createRoadPaintChunkBuilder(name, { cellSize = PAINT_CELL_SIZE, cullDistance = PAINT_CULL_DISTANCE } = {}) {
  const cells = new Map();

  function cellAt(mx, mz) {
    const key = (Math.floor(mx / cellSize) << 16) ^ (Math.floor(mz / cellSize) & 0xffff);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { position: [], side: [], paint: [], colors: [], index: [] }));
    return cell;
  }

  function strip3D(ax, ay, az, bx, by, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const end = phase + len * flow;
    // Lamp: in lengths of at most STEP, so the strip can follow the ground (terrain.js lays each vertex on it and
    // doesn't cut the strip itself: a cut would average its two sides' `side` vectors to nothing)
    const pieces = Math.max(1, Math.ceil(len / STEP));
    const cell = cellAt((ax + bx) * 0.5, (az + bz) * 0.5);
    const { position, side, paint, colors, index } = cell;
    const first = position.length / 3;
    for (let k = 0; k <= pieces; k++) {
      const t = k / pieces;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, u = phase + (end - phase) * t;
      for (const s of [-1, 1]) {
        position.push(x + sx * s, y, z + sz * s);
        side.push(sx * s, sz * s);
        paint.push(u, period, duty);
        colors.push(col.r, col.g, col.b);
      }
    }
    for (let k = 0; k < pieces; k++) {
      const i = first + k * 2;
      index.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }

  function build() {
    const group = new THREE.Group();
    group.name = name;
    const material = createRoadPaintMaterial();
    let first = null;

    for (const cell of cells.values()) {
      if (!cell.index.length) continue;
      const vertCount = cell.position.length / 3;
      const normal = new Float32Array(cell.position.length);
      for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(cell.position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(cell.colors, 3));
      geometry.setAttribute('side', new THREE.Float32BufferAttribute(cell.side, 2));
      geometry.setAttribute('paint', new THREE.Float32BufferAttribute(cell.paint, 3));
      geometry.setIndex(
        vertCount <= 65535
          ? new THREE.Uint16BufferAttribute(cell.index, 1)
          : new THREE.Uint32BufferAttribute(cell.index, 1)
      );
      geometry.computeBoundingSphere();
      if (geometry.boundingSphere) geometry.boundingSphere.radius += WIDEN_SPHERE_PAD;

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${name}Chunk`;
      mesh.receiveShadow = true;
      mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
      mesh.userData.cullDistance = cullDistance;
      if (first) mesh.userData.sharesPipelineWith = first;
      else first = mesh;
      group.add(mesh);
    }
    return group;
  }

  return { strip3D, build };
}

// Lamp: the bike lane's bicycle and rider (as the MUTCD draws it, upright to the rider coming up to it: wheels across
// the lane, the rider's head ahead) and its arrow beyond, and the shared-lane marking's bicycle under two chevrons, as
// strips [u ahead, v to the right, u, v, width] in metres
function ring(cu, cv, r, w, n = 8) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
    out.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, cu + Math.cos(b) * r, cv + Math.sin(b) * r, w]);
  }
  return out;
}
const BICYCLE = [
  ...ring(0, -0.5, 0.3, 0.08), ...ring(0, 0.5, 0.3, 0.08),
  [0, -0.5, 0, -0.05, 0.08], [0, -0.05, 0.45, -0.2, 0.08], [0.45, -0.2, 0.45, 0.35, 0.08], [0, -0.05, 0.45, 0.35, 0.08],
  [0.45, 0.35, 0, 0.5, 0.08], [0.45, 0.35, 0.6, 0.3, 0.08], // fork and bars
  [0.5, -0.2, 1.0, 0.05, 0.14], [1.0, 0.05, 0.6, 0.32, 0.08], [0.5, -0.2, 0, -0.05, 0.1], // body, arm, leg
  [1.12, 0.08, 1.34, 0.08, 0.22], // head
];
const BIKE = [...BICYCLE, [1.9, 0, 2.8, 0, 0.15], [3.15, 0, 2.75, -0.32, 0.15], [3.15, 0, 2.75, 0.32, 0.15]];
const SHARROW = [...BICYCLE,
  [1.7, -0.5, 2.15, 0, 0.22], [2.15, 0, 1.7, 0.5, 0.22], [2.3, -0.5, 2.75, 0, 0.22], [2.75, 0, 2.3, 0.5, 0.22]];

// Lamp: the freeways' overpasses (terrain.js, overpass-data.js) as pieces of their decks [deck, a, b] (a and b its
// points), and where a strip from (ax, az) to (bx, bz) runs along one up off the ground: its top there, or null. The
// road on an overpass is painted on its deck (not laid on the ground under it, across the road below), and the road
// under it runs on painted under it
// (in 50 m cells: { cells, near(ax, az, bx, bz) whether a strip's box meets any }, so the rest of the town's paint
// costs nothing)
const DECK_CELL = 50;
function overpassPieces() {
  const cells = new Map();
  for (const deck of bridgeDecks()) {
    if (!deck.overpass) continue;
    for (let i = 0; i + 1 < deck.points.length; i++) {
      const piece = [deck, deck.points[i], deck.points[i + 1]], [, a, b] = piece, r = deck.half;
      for (let cx = Math.floor((Math.min(a[0], b[0]) - r) / DECK_CELL); cx <= Math.floor((Math.max(a[0], b[0]) + r) / DECK_CELL); cx++) {
        for (let cz = Math.floor((Math.min(a[1], b[1]) - r) / DECK_CELL); cz <= Math.floor((Math.max(a[1], b[1]) + r) / DECK_CELL); cz++) {
          const k = cx * 65536 + cz;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(piece);
        }
      }
    }
  }
  const near = (ax, az, bx, bz) => {
    for (let cx = Math.floor(Math.min(ax, bx) / DECK_CELL); cx <= Math.floor(Math.max(ax, bx) / DECK_CELL); cx++) {
      for (let cz = Math.floor(Math.min(az, bz) / DECK_CELL); cz <= Math.floor(Math.max(az, bz) / DECK_CELL); cz++) if (cells.has(cx * 65536 + cz)) return true;
    }
    return false;
  };
  return { cells, near, size: cells.size };
}
function deckUnder(decks, x, z, dx, dz) {
  for (const [deck, a, b] of decks.cells.get(Math.floor(x / DECK_CELL) * 65536 + Math.floor(z / DECK_CELL)) || []) {
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
    const t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) > deck.half) continue;
    // (across it, the road under it: even at a sharp angle, I-94 under E Ellsworth Rd at 25°)
    if (dx !== undefined && Math.abs(dx * ex + dz * ez) / Math.sqrt(l2) < 0.96) continue;
    const top = a[3] + (b[3] - a[3]) * t, ground = a[7] + (b[7] - a[7]) * t;
    if (top - ground < 0.1) continue; // (at its ends, on the ground: painted as the street is)
    return top;
  }
  return null;
}

function buildRoadPaint(scene, network, sharedBuilder = null) {
  const builder = sharedBuilder || createRoadPaintChunkBuilder('RoadMarkings');
  const lines = [];
  const bends = new Map();
  // Lamp: the paint on the overpasses' decks, at their height (not laid on the ground: terrain.js setOnTerrain)
  const decks = sharedBuilder ? null : overpassPieces();
  const deckBuilder = decks?.size ? createRoadPaintChunkBuilder('RoadMarkingsOnDecks') : null;
  const DECK_STEP = 2;

  // Flat strip w wide from a to b, with a dash pattern (period, duty cycle) running along it
  function strip(ax, az, bx, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1) {
    // (Lamp) where it runs along an overpass up off the ground, in short pieces on its deck
    if (deckBuilder && decks.near(ax, az, bx, bz)) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len > 0.05) {
        const ux = (bx - ax) / len, uz = (bz - az) / len, n = Math.max(1, Math.ceil(len / DECK_STEP));
        const P = (k) => [ax + (bx - ax) * k / n, az + (bz - az) * k / n];
        const on = [];
        for (let k = 0; k < n; k++) { const [x, z] = P(k + 0.5); on.push(deckUnder(decks, x, z, ux, uz) !== null); }
        if (on.some(Boolean)) {
          for (let k0 = 0; k0 < n;) {
            let k1 = k0 + 1;
            while (k1 < n && on[k1] === on[k0]) k1++;
            const [x0, z0] = P(k0), [x1, z1] = P(k1), ph = phase + (len * k0 / n) * flow;
            if (!on[k0]) builder.strip3D(x0, HEIGHT, z0, x1, HEIGHT, z1, w, col, period, duty, ph, flow);
            else {
              for (let k = k0; k < k1; k++) {
                const [xa, za] = P(k), [xb, zb] = P(k + 1);
                const ya = deckUnder(decks, xa, za, ux, uz) ?? deckUnder(decks, (xa + xb) / 2, (za + zb) / 2, ux, uz);
                const yb = deckUnder(decks, xb, zb, ux, uz) ?? ya;
                deckBuilder.strip3D(xa, ya + HEIGHT, za, xb, yb + HEIGHT, zb, w, col, period, duty, phase + (len * k / n) * flow, flow);
              }
            }
            k0 = k1;
          }
          return;
        }
      }
    }
    builder.strip3D(ax, HEIGHT, az, bx, HEIGHT, bz, w, col, period, duty, phase, flow);
  }

  // Edges run between stop lines; s is measured from the start one and o to the right of the centre line
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, e.sz + e.dz * s + e.rz * o];
  const along = (e, o, w, col, period = 1, duty = 1, kind = null) => {
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const ends = [at(e, e.from.shape ? -start : 0.9, o), at(e, e.to.shape ? e.span - start : e.len - 0.9, o)];
    lines.push({ e, o, w, col, period, duty, ends, joins: [], kind });
  };
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty);
  const clearCentre = (e, o) => {
    if (!network.isRoadClear) return false;
    const steps = Math.max(1, Math.ceil((e.len - 1.8) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const s = 0.9 + (e.len - 1.8) * i / steps;
      for (const offset of [o - 0.12, o + 0.12]) if (!network.isRoadClear(...at(e, s, offset), 0.15)) return false;
    }
    return true;
  };

  // Lamp: OpenStreetMap's crossings ([x, z, marked: 0 no, 1 yes, 2 not said]) in 20 m cells
  const CELL = 20;
  const crossingCells = new Map();
  {
    const list = (GEO.controls && GEO.controls.crossings) || [];
    for (let i = 0; i + 2 < list.length; i += 3) {
      const key = Math.floor(list[i] / CELL) + ',' + Math.floor(list[i + 1] / CELL);
      if (!crossingCells.has(key)) crossingCells.set(key, []);
      crossingCells.get(key).push({ x: list[i], z: list[i + 1], marked: list[i + 2], used: false });
    }
  }
  const crossingsNear = (x, z, r) => {
    const out = [];
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        for (const c of crossingCells.get(i + ',' + j) || []) if (Math.hypot(c.x - x, c.z - z) < r) out.push(c);
      }
    }
    return out;
  };
  // Lamp: the paint's streets are a snapshot taken before the network's lights and signs were placed (road-network.js,
  // its step 10), so what makes traffic stop is read from the finished network's junction at the same place: whether
  // it's signalised, and which approaches to it have a stop sign
  const placeKey = (x, z) => Math.round(x * 4) + ',' + Math.round(z * 4);
  const liveNodes = new Map();
  for (const n of network.nodes || []) liveNodes.set(placeKey(n.x, n.z), n);
  const liveNode = (node) => liveNodes.get(placeKey(node.x, node.z)) || null;
  const signalled = (node) => !!(node.signal || liveNode(node)?.signal);
  // whether traffic coming along f stops at its end: a light there, or a stop sign on the approach from f's way
  const stopsAt = (f) => {
    const n = liveNode(f.to);
    if (!n) return false;
    if (n.signal) return true;
    return (n.in || []).some((e) => e.control === 'stop' && e.dx * f.dx + e.dz * f.dz > 0.9);
  };

  // A crosswalk at the end of e by node: where a painted crossing is mapped there, not where an unpainted one is,
  // and where nothing is said, only at traffic lights. Lamp: and not on a leg with no crossing mapped at a light whose
  // other legs have theirs: there the map's crossings are the junction's, and the bare leg is one people don't cross
  // (Fuller Rd, Stadium Blvd: the arterial's own legs left bare where the side street's are painted)
  const paintedEnd = (e, s, node) => {
    const [x, z] = at(e, s, 0);
    const near = crossingsNear(x, z, e.half + 5);
    for (const c of near) c.used = true;
    if (near.some((c) => c.marked === 1)) return true;
    if (near.some((c) => c.marked === 0)) return false;
    if (!near.length && crossingsNear(node.x, node.z, 40).length >= 2) return false;
    return signalled(node);
  };

  // The one or two directed edges of each road between a pair of intersections
  const roads = new Map();
  for (const e of network.paintEdges || network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }
  for (const [e, back] of roads.values()) {
    const firstLine = lines.length;
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // Dashed white between lanes going the same way, double yellow between opposing ones
    // (nothing across a median or a lane closed off by an obstacle). Lamp: a residential street (class 4) or one marked
    // without lines (6) has no centre line, a street with a centre turn lane its solid and dashed yellow either side
    const lined = ((e.cls ?? 4) <= 3 || e.cls === 5 || lanes.length > 2) && !(e.bk & 128);
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (p.dir !== q.dir && e.turn && q.o - p.o > 4.5 && q.o - p.o < 9 && clearCentre(e, mid)) {
        for (const sgn of [-1, 1]) {
          along(e, mid + sgn * 1.65, 0.12, YELLOW, 1, 1, { turn: sgn });
          along(e, mid + sgn * 1.4, 0.12, YELLOW, 6, 0.5, { turn: sgn, dashed: true });
        }
        continue;
      }
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        if (e.cls !== 6) along(e, mid, 0.13, WHITE, 12, 0.25);
      } else if (lined) {
        along(e, mid - 0.12, 0.11, YELLOW, 1, 1, { centre: -1 });
        along(e, mid + 0.12, 0.11, YELLOW, 1, 1, { centre: 1 });
      }
    }

    // Lamp: a one-way main street's left edge, solid yellow
    if (!back && lanes.length >= 2 && (e.cls ?? 4) <= 3 && !e.divided && !e.freeway) along(e, lanes[0].o - 1.75, 0.12, YELLOW);
    // Lamp: a freeway's carriageway and its ramps, edge lines both sides: solid yellow on the left (the median's side),
    // solid white on the right (the shoulder's), the dashed white lane lines between
    if (e.freeway && !back && lanes.length) {
      along(e, lanes[0].o - 1.75, 0.15, YELLOW, 1, 1, { edge: -1 });
      along(e, lanes[lanes.length - 1].o + 1.75, 0.15, WHITE, 1, 1, { edge: 1 });
    }

    // Lamp: a picture painted on the street at e's s, o, facing f (1 along e, -1 against it), from strips given in
    // metres as [u ahead, v to the right, u, v, width]
    const picture = (s, o, f, parts) => {
      for (const [u0, v0, u1, v1, w] of parts) strip(...at(e, s + f * u0, o + f * v0), ...at(e, s + f * u1, o + f * v1), w, WHITE);
    };
    // pictures every `every` m along e (from 10 m in), where the edge is long enough to hold one clear of its ends
    const pictures = (o, f, every, parts) => {
      if (e.len < 22) return;
      const n = Math.max(1, Math.floor((e.len - 20) / every) + 1);
      const gap = n > 1 ? (e.len - 20) / (n - 1) : 0;
      for (let k = 0; k < n; k++) {
        const s = n > 1 ? 10 + gap * k : e.len / 2;
        picture(f > 0 ? s - 1.6 : s + 1.6, o, f, parts);
      }
    };

    // Lamp: bike lanes along the curb (offsets in e's frame), `width` the lane and any buffer, `bk` its kind:
    // a solid white line on the traffic side; a buffer's second line and hatching (16, 32), or a curb's line (64);
    // a two-way lane's dashed yellow centre (512); and the bike and arrow in each direction it's ridden
    // Lamp: and, as Ann Arbor paints them, the lane green for its last and first 15 m at a traffic light, where
    // turning cars cross it (Dexter at Maple, Miller, S Industrial), the bike and arrow white on the green
    const bikeLane = (curb, width, bk, f) => {
      const sgn = Math.sign(curb);
      const lane = bk & 512 ? 3 : 1.7;
      const inner = curb - sgn * lane;
      const G = Math.min(15, e.len / 2 - 1);
      if (G > 4) {
        const mid = curb - sgn * lane / 2;
        if (!e.from.shape && signalled(e.from)) strip(...at(e, 0.2, mid), ...at(e, G, mid), lane - 0.2, GREEN);
        if (!e.to.shape && signalled(e.to)) strip(...at(e, e.len - G, mid), ...at(e, e.len - 0.2, mid), lane - 0.2, GREEN);
      }
      along(e, inner, 0.15, WHITE);
      if (width > lane + 0.3) {
        const outer = curb - sgn * width;
        along(e, outer, 0.15, WHITE);
        if (bk & 48) { // 45° hatching every 3 m, between the two lines
          const B = width - lane;
          for (let s = 3; s + B < e.len - 2; s += 3) strip(...at(e, s, inner - sgn * 0.08), ...at(e, s + B, outer + sgn * 0.08), 0.12, WHITE);
        }
      }
      if (bk & 512) {
        along(e, curb - sgn * lane / 2, 0.1, YELLOW, 6, 0.5);
        pictures(curb - sgn * lane * 0.25, f, 130, BIKE);
        pictures(curb - sgn * lane * 0.75, -f, 130, BIKE);
      } else pictures(curb - sgn * lane / 2, f, 130, BIKE);
    };
    // (not on a divided road's two halves, whose half-width spans both: their curbs aren't known here)
    // Lamp: a parking lane along each curb (curb-parking.js) ends in a solid white line, any bike lane beside it
    const pR = e.divided ? 0 : e.parkR || 0, pL = e.divided ? 0 : e.parkL || 0;
    // (a residential street's unmarked curbside parking has no line: curb-parking.js `marked`)
    if (pR && e.parkMarked !== false) along(e, e.half - pR, 0.12, WHITE);
    if (pL && e.parkMarked !== false) along(e, -e.half + pL, 0.12, WHITE);
    const bk = e.bk || 0;
    if (!e.divided) {
      if (bk & 128) { // advisory lanes: dashed, inside the street's width, either side
        for (const sgn of [1, -1]) {
          const curb = sgn > 0 ? e.half - pR : -e.half + pL;
          if (e.half - pR - pL < 4.5) continue;
          along(e, curb - sgn * 1.5, 0.15, WHITE, 6, 0.5);
          pictures(curb - sgn * 0.8, back ? sgn : 1, 130, BIKE);
        }
      }
      if (e.bikeR) bikeLane(e.half - pR, e.bikeR, bk, 1);
      if (!back && e.bikeL) bikeLane(-e.half + pL, e.bikeL, bk, 1);
      if (back && back.bikeR) bikeLane(-e.half + pL, back.bikeR, back.bk || 0, -1);
      // shared-lane arrows in the outermost travel lane, a little toward the curb: Lamp: as the MUTCD places them, one
      // just past the intersection the rider comes from and then every 75 m (250 ft), none in the last 25 m before
      // the next, so a street's approach to a corner is bare (E Washington at Fourth, Fourth at Ann), not one at
      // each end of every block
      const sharrows = (o, f) => {
        if (e.len < 30) return;
        for (let d = 12; d <= e.len - 25 || d === 12; d += 75) picture(f > 0 ? d - 1.6 : e.len - d + 1.6, o, f, SHARROW);
      };
      const rightLane = (f) => f.lanes.length ? f.lanes[f.lanes.length - 1] : null;
      if (e.share && rightLane(e) != null) sharrows(Math.min(rightLane(e) + 0.3, e.half - pR - 1.2), 1);
      if (!back && e.shareL && e.lanes.length) sharrows(Math.max(e.lanes[0] - 0.3, -e.half + pL + 1.2), 1);
      if (back && back.share && rightLane(back) != null) sharrows(-Math.min(rightLane(back) + 0.3, back.half - pL - 1.2), -1);
    }

    // Stop bars across the lanes arriving at each stop line, from the centre line (or median) to the curb, only where
    // traffic is made to stop: at a light or a stop sign (none at a through street's side streets, nor where a street
    // merely bends: a shape node of the centreline streets)
    for (const f of back ? [e, back] : [e]) {
      if (f.to.shape || !stopsAt(f) || f.cls === 0) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, 0.45, WHITE);
    }

    // Continental crosswalks curb to curb, between the stop lines and the intersections at both ends
    if (!e.from.shape && e.cls !== 0 && paintedEnd(e, -CROSSWALK / 2, e.from)) {
      across(e, -CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    }
    if (!e.to.shape && e.cls !== 0 && paintedEnd(e, e.len + CROSSWALK / 2, e.to)) {
      across(e, e.len + CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    }

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!node.shape) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
    }
  }

  // Lamp: lane-use arrows on the approaches OpenStreetMap gives turn lanes (turn-lanes-data.js): one in each lane 8 m
  // before the stop line and, on a long approach, another 30 m back, where the map's lanes and the street's agree in
  // number: left, through and right arrows and their pairs (State at Huron, Scio Church at Main)
  {
    const arrowCells = new Map();
    for (const a of TURN_LANES) {
      const k = Math.floor(a[0] / 40) + ',' + Math.floor(a[1] / 40);
      if (!arrowCells.has(k)) arrowCells.set(k, []);
      arrowCells.get(k).push(a);
    }
    const SHAFT = [[-2.6, 0, 0.1, 0, 0.16]];
    const AHEAD = [[-0.4, -0.42, 0.75, 0, 0.16], [-0.4, 0.42, 0.75, 0, 0.16], [-0.2, 0, 0.6, 0, 0.36]];
    const turn = (v) => [[-0.4, 0, 0.35, v * 0.75, 0.16], [0.35, v * 0.75, 0.35, v * 1.05, 0.16],
      [-0.05, v * 0.68, 0.35, v * 1.25, 0.16], [0.75, v * 0.68, 0.35, v * 1.25, 0.16]];
    let painted = 0, unmatched = 0;
    for (const f of network.paintEdges || network.edges) {
      if (f.to.shape || f.cls === 0 || f.len < 14 || !f.lanes.length) continue;
      const ex = f.sx + f.dx * f.len, ez = f.sz + f.dz * f.len;
      let best = null, bestD = 22;
      for (let i = Math.floor((ex - 22) / 40); i <= Math.floor((ex + 22) / 40); i++) {
        for (let j = Math.floor((ez - 22) / 40); j <= Math.floor((ez + 22) / 40); j++) {
          for (const a of arrowCells.get(i + ',' + j) || []) {
            const d = Math.hypot(a[0] - ex, a[1] - ez);
            if (d < bestD && a[2] * f.dx + a[3] * f.dz > 0.9) { best = a; bestD = d; }
          }
        }
      }
      if (!best) continue;
      // the map's lanes onto the street's: the same number, or one more where the map's leftmost is a left-turn lane
      // (into the street's centre turn lane, where it has one: S Main, Stadium; else left out) or its rightmost a
      // right-turn lane (left out)
      let codes = best.slice(4);
      const lanes = [...f.lanes].sort((p, q) => p - q);
      if (codes.length === lanes.length + 1 && codes[0] === 1) {
        codes = codes.slice(1);
        if (f.turn) { lanes.unshift(0); codes.unshift(1); }
      } else if (codes.length === lanes.length + 1 && codes[codes.length - 1] === 4) codes = codes.slice(0, -1);
      if (codes.length !== lanes.length) { unmatched++; continue; }
      for (const s of f.len > 60 ? [f.len - 8, f.len - 38] : [f.len - 8]) {
        lanes.forEach((o, k) => {
          const c = codes[k];
          const parts = [...SHAFT, ...(c & 2 ? AHEAD : []), ...(c & 1 ? turn(-1) : []), ...(c & 4 ? turn(1) : [])];
          // (drawn about 2.2 m long and scaled up to a real arrow's 4.5 m: long, as a driver sees it foreshortened)
          for (const [u0, v0, u1, v1, w] of parts) strip(...at(f, s + u0 * 1.6, o + v0 * 1.15), ...at(f, s + u1 * 1.6, o + v1 * 1.15), w * 1.3, WHITE);
        });
      }
      painted++;
    }
    console.info(`[road paint] lane-use arrows on ${painted} approaches (${unmatched} tagged ones whose lanes don't match the street's)`);
  }

  // Lamp: painted crossings mid-block (by a school, a park path, a campus walk), wherever one wasn't an intersection's
  for (const [e] of roads.values()) {
    if (e.len < CROSSWALK * 2 + 4) continue;
    const [mx, mz] = at(e, e.len / 2, 0);
    for (const c of crossingsNear(mx, mz, e.len / 2 + e.half)) {
      if (c.used || c.marked !== 1) continue;
      const s = (c.x - e.sx) * e.dx + (c.z - e.sz) * e.dz;
      const o = (c.x - e.sx) * e.rx + (c.z - e.sz) * e.rz;
      if (s < CROSSWALK + 2 || s > e.len - CROSSWALK - 2 || Math.abs(o) > e.half + 1) continue;
      c.used = true;
      across(e, s, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    }
  }

  // At a simple bend, corresponding offset lines meet at a bounded miter, without an intersection-sized gap.
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2) continue;
    const [a, b] = roadsAtBend;
    const sign = a.end === b.end ? -1 : 1;
    if ((a.e.dx * b.e.dx + a.e.dz * b.e.dz) * sign < 0.5) continue;
    for (const p of a.lines) {
      let q = null;
      let distance = 0.5;
      for (const line of b.lines) {
        const d = Math.abs(p.o - line.o * sign);
        if (!line.joins[b.end] && line.col === p.col && line.w === p.w && line.period === p.period &&
          line.duty === p.duty && d < distance) {
          q = line;
          distance = d;
        }
      }
      if (!q) continue;
      const A = p.ends[a.end];
      const B = q.ends[b.end];
      const dx = B[0] - A[0];
      const dz = B[1] - A[1];
      const cross = a.e.dx * b.e.dz - a.e.dz * b.e.dx;
      let join;
      if (Math.abs(cross) < 0.001) {
        if (Math.hypot(dx, dz) > 0.5) continue;
        join = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5];
      } else {
        const t = (dx * b.e.dz - dz * b.e.dx) / cross;
        const u = (dx * a.e.dz - dz * a.e.dx) / cross;
        const limit = Math.min(6, a.e.span * 0.25, b.e.span * 0.25);
        if (Math.abs(t) > limit || Math.abs(u) > limit) continue;
        join = [A[0] + a.e.dx * t, A[1] + a.e.dz * t];
      }
      p.ends[a.end] = q.ends[b.end] = join;
      p.joins[a.end] = [q, b.end];
      q.joins[b.end] = [p, a.end];
    }
  }

  // Continue the same dash phase around bends, even when adjacent road edges point in opposite directions.
  for (const line of lines) {
    // An unmatched marking keeps its original gap instead of extending towards a curb at a sharp bend.
    for (const end of [0, 1]) {
      if (!line.joins[end]) line.ends[end] = at(line.e, end ? line.e.len - 0.9 : 0.9, line.o);
    }
  }
  // Lamp: where a centre turn lane ends at a bend and the street goes on with a plain double yellow, the turn lane's
  // solid edges taper in to meet the double yellow (its dashed ones stop where the taper starts), rather than both
  // stopping short with a gap and the double yellow starting between them
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2) continue;
    for (const [A, B] of [roadsAtBend, [...roadsAtBend].reverse()]) {
      const sign = A.end === B.end ? -1 : 1;
      if ((A.e.dx * B.e.dx + A.e.dz * B.e.dz) * sign < 0.5) continue;
      const turnLines = A.lines.filter((l) => l.kind?.turn && !l.joins[A.end]);
      const centre = B.lines.filter((l) => l.kind?.centre && !l.joins[B.end]);
      if (!turnLines.length || centre.length !== 2) continue;
      const T = Math.min(18, A.e.len * 0.4);
      const sT = A.end ? A.e.len - 0.9 - T : 0.9 + T;
      for (const l of turnLines) {
        l.ends[A.end] = at(l.e, sT, l.o);
        if (l.kind.dashed) continue;
        // the double yellow line on the same side, in A's frame
        const q = centre.reduce((m, c) => ((c.o - m.o) * sign * l.kind.turn > 0 ? c : m));
        strip(...l.ends[A.end], ...q.ends[B.end], l.w, l.col);
      }
    }
  }
  for (const line of lines) {
    line.len = Math.hypot(line.ends[1][0] - line.ends[0][0], line.ends[1][1] - line.ends[0][1]);
  }
  // Lamp: a street's lines stop at a freeway's carriageway it crosses (where the map has it cross on a bridge, the game
  // has it at grade: Geddes Rd over US-23), so the freeway's own paint runs on unbroken across it. The carriageways in
  // 50 m cells: [edge, its paint's half width]
  const FW_CELL = 50;
  const fwCells = new Map();
  for (const f of network.paintEdges || network.edges) {
    if (f.cls !== 0 || !f.lanes.length) continue;
    const half = Math.max(Math.abs(f.lanes[0]), Math.abs(f.lanes[f.lanes.length - 1])) + 2.2;
    const x0 = f.sx, z0 = f.sz, x1 = f.sx + f.dx * f.len, z1 = f.sz + f.dz * f.len;
    for (let i = Math.floor((Math.min(x0, x1) - half) / FW_CELL); i <= Math.floor((Math.max(x0, x1) + half) / FW_CELL); i++) {
      for (let j = Math.floor((Math.min(z0, z1) - half) / FW_CELL); j <= Math.floor((Math.max(z0, z1) + half) / FW_CELL); j++) {
        const k = i * 65536 + j;
        if (!fwCells.has(k)) fwCells.set(k, []);
        fwCells.get(k).push(f);
      }
    }
  }
  // the stretches [t0, t1] (0 to 1 along a to b) over a carriageway
  const overFreeway = (ax, az, bx, bz) => {
    const out = [];
    // (Lamp: not where it crosses on an overpass or under one: a grade separation, terrain.js)
    const seen = new Set();
    for (const [x, z] of [[ax, az], [(ax + bx) / 2, (az + bz) / 2], [bx, bz]]) {
      for (const f of fwCells.get(Math.floor(x / FW_CELL) * 65536 + Math.floor(z / FW_CELL)) || []) {
        if (seen.has(f)) continue;
        seen.add(f);
        // the segment clipped to the carriageway's rectangle (along 0..len, across its paint's width)
        const half = Math.max(Math.abs(f.lanes[0]), Math.abs(f.lanes[f.lanes.length - 1])) + 2.2;
        const mid = (f.lanes[0] + f.lanes[f.lanes.length - 1]) / 2;
        let t0 = 0, t1 = 1;
        const clip = (p, q, lo, hi) => {
          if (Math.abs(q - p) < 1e-9) return p >= lo && p <= hi;
          let u = (lo - p) / (q - p), v = (hi - p) / (q - p);
          if (u > v) [u, v] = [v, u];
          t0 = Math.max(t0, u);
          t1 = Math.min(t1, v);
          return t0 < t1;
        };
        const sa = (ax - f.sx) * f.dx + (az - f.sz) * f.dz, sb = (bx - f.sx) * f.dx + (bz - f.sz) * f.dz;
        const oa = (ax - f.sx) * f.rx + (az - f.sz) * f.rz, ob = (bx - f.sx) * f.rx + (bz - f.sz) * f.rz;
        if (clip(sa, sb, -2, f.len + 2) && clip(oa, ob, mid - half, mid + half)) {
          const tm = (t0 + t1) / 2, cx = ax + (bx - ax) * tm, cz = az + (bz - az) * tm;
          if (deckBuilder && deckUnder(decks, cx, cz) !== null) continue;
          out.push([t0, t1]);
        }
      }
    }
    return out.sort((p, q) => p[0] - q[0]);
  };
  function paintLine(line) {
    const [A, B] = line.ends;
    const cuts = line.e.cls === 0 || line.e.freeway ? [] : overFreeway(A[0], A[1], B[0], B[1]);
    if (!cuts.length) {
      strip(...A, ...B, line.w, line.col, line.period, line.duty, line.phase, line.flow);
      return;
    }
    let t = 0;
    for (const [t0, t1] of cuts) {
      if (t0 > t + 1e-3) {
        strip(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0,
          line.w, line.col, line.period, line.duty, line.phase + t * line.len * line.flow, line.flow);
      }
      t = Math.max(t, t1);
    }
    if (t < 1 - 1e-3) {
      strip(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, ...B, line.w, line.col, line.period, line.duty,
        line.phase + t * line.len * line.flow, line.flow);
    }
  }
  for (const root of lines) {
    if (root.phase !== undefined) continue;
    root.phase = 0;
    root.flow = 1;
    const stack = [root];
    while (stack.length) {
      const line = stack.pop();
      for (let end = 0; end < 2; end++) {
        if (!line.joins[end]) continue;
        const [next, nextEnd] = line.joins[end];
        if (next.phase !== undefined) continue;
        next.flow = line.flow * (end === nextEnd ? -1 : 1);
        next.phase = line.phase + end * line.len * line.flow - nextEnd * next.len * next.flow;
        next.phase = ((next.phase % next.period) + next.period) % next.period;
        stack.push(next);
      }
      paintLine(line);
    }
  }

  // Lamp: each parallel-parking stall's marks (curb-parking.js), from the parking lane's line to near the curb
  for (const st of curbStalls()) {
    if (st.marked === false) continue;
    for (const end of [-0.5, 0.5]) {
      const cx = st.x + st.tx * st.length * end, cz = st.z + st.tz * st.length * end;
      const h = st.lane / 2;
      strip(cx - st.nx * h, cz - st.nz * h, cx + st.nx * (h - 0.35), cz + st.nz * (h - 0.35), 0.12, WHITE);
    }
  }

  const group = builder.build();
  scene.add(group);
  if (deckBuilder) {
    const onDecks = deckBuilder.build();
    onDecks.userData.terrain = 'set';
    let tris = 0;
    onDecks.traverse((o) => { o.userData.terrain = 'set'; if (o.isMesh) tris += o.geometry.index.count / 3; });
    scene.add(onDecks);
    console.log(`[paint] on the overpasses' decks: ${onDecks.children.length} draws, ${tris} triangles`);
  }
  return group;
}

export { buildRoadPaint, createRoadPaintChunkBuilder };
