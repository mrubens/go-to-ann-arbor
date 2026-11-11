import * as THREE from 'three/webgpu';
import { stadiumGround, groundHeight } from './terrain.js';
import { GEO } from './city-geodata.js';
import { buildCampusLandmarks, builder, landmarkGlass } from './campus-landmarks.js';
import { buildMoreLandmarks } from './more-landmarks.js';
import { buildDiagM } from './diag-m.js';
import { buildGraffitiAlley } from './graffiti-alley.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { STADIUM, N, radiiAt, setWallTops, FIELD_Y, WALL_TOP, SEAT_TOP, RIM_Y, WALL_Y, AISLE_IN, CONCOURSE } from './stadium-shape.js';
import { mergeStatic, splitByCell } from './merge-static.js';
import { TIER } from './device-tier.js';

// Ann Arbor's landmarks are the city's own surveyed buildings (Burton Tower, Hill Auditorium, the Union...), drawn by
// buildings.js. What the survey can't give is Michigan Stadium, "the Big House": a bowl dug into the ground, its stands
// sloping from a low rim down to the field. It's modelled here on its real outline.

let bryantParkLawn = null; // (New York's Bryant Park; Ann Arbor has none)

// Michigan Stadium on its real outline (stadium-shape.js): the field 15 m below the street, a bowl of 70-odd rows of
// aluminium benches on concrete with aisles, the blue halo with its maize stripe at the top, a brick outer wall only a
// few metres high, the press box and suite towers along the west and east sides (2010), and the video boards at
// each end. Everything stands on stadiumGround(), the ground around it, which terrain.js has dug out inside.
function buildBigHouse(group, colliders) {
  const { cx, cz } = STADIUM;
  const G = stadiumGround();
  const ROWS = 72, AISLE_EVERY = 6;
  const pos = [], col = [];
  const C = (hex) => new THREE.Color(hex); // already linear: three converts a hex color as it's set
  const bench = C(0xb9bdc2), riser = C(0x6d727a), aisle = C(0xd2cdc2), concrete = C(0xa6a39b), blue = C(0x00274c),
    maize = C(0xffcb05), brick = C(0x8a4d37), stone = C(0xcfc6b4), turfDark = C(0x2f6b2c);
  const quad = (a, b, c, d, color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  // point on ray k (fractional) at distance r from the middle, height y above the ground around
  const at = (k, r, y) => {
    const a = (k / N) * Math.PI * 2;
    return [cx + Math.cos(a) * r, G + y, cz + Math.sin(a) * r];
  };
  // the outer wall stands at least a parapet's height over the ground outside it, where the hill rises above the
  // lowest of it (the north end, up the slope from Main St)
  const wallTop = [];
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2, r = radiiAt(a)[1] + 4;
    wallTop.push(Math.max(WALL_Y, groundHeight(cx + Math.cos(a) * r, cz + Math.sin(a) * r) - G + 1.6));
  }
  // smoothed round the ring (the ground's bumps would make it a sawtooth)
  const raw = wallTop.slice(0, N);
  for (let k = 0; k <= N; k++) {
    let sum = 0;
    for (let d = -8; d <= 8; d++) sum += raw[(k + d + N) % N];
    wallTop[k] = Math.max(WALL_Y, sum / 17);
  }
  // the parapet walked and driven on (carSurface) is this stone's top
  setWallTops(wallTop);
  for (let k = 0; k < N; k++) {
    const k1 = k + 1, wy0 = wallTop[k], wy1 = wallTop[k1];
    const [i0, o0] = radiiAt((k / N) * Math.PI * 2), [i1, o1] = radiiAt((k1 / N) * Math.PI * 2);
    const isAisle = k % AISLE_EVERY === 0;
    // the field wall: blue padding with a maize line along its top
    quad(at(k, i0, FIELD_Y), at(k1, i1, FIELD_Y), at(k1, i1, WALL_TOP - 0.25), at(k, i0, WALL_TOP - 0.25), blue);
    quad(at(k, i0, WALL_TOP - 0.25), at(k1, i1, WALL_TOP - 0.25), at(k1, i1, WALL_TOP), at(k, i0, WALL_TOP), maize);
    // the walk around the field
    quad(at(k, i0, WALL_TOP), at(k1, i1, WALL_TOP), at(k1, i1 + AISLE_IN, WALL_TOP), at(k, i0 + AISLE_IN, WALL_TOP), concrete);
    // the rows: a riser and a tread each
    const s0 = i0 + AISLE_IN, s1 = i1 + AISLE_IN, e0 = o0 - CONCOURSE, e1 = o1 - CONCOURSE;
    for (let row = 0; row < ROWS; row++) {
      const t0 = row / ROWS, t1 = (row + 1) / ROWS;
      const ya = WALL_TOP + (SEAT_TOP - WALL_TOP) * t0, yb = WALL_TOP + (SEAT_TOP - WALL_TOP) * t1;
      const ra0 = s0 + (e0 - s0) * t0, ra1 = s1 + (e1 - s1) * t0, rb0 = s0 + (e0 - s0) * t1, rb1 = s1 + (e1 - s1) * t1;
      quad(at(k, ra0, ya), at(k1, ra1, ya), at(k1, ra1, yb), at(k, ra0, yb), isAisle ? aisle : riser);
      quad(at(k, ra0, yb), at(k1, ra1, yb), at(k1, rb1, yb), at(k, rb0, yb), isAisle ? aisle : (row % 2 ? bench : C(0xaeb3b8)));
    }
    // the halo: blue fascia with a maize stripe over the top row, then the concourse to the outer wall
    quad(at(k, e0, SEAT_TOP), at(k1, e1, SEAT_TOP), at(k1, e1, RIM_Y - 0.15), at(k, e0, RIM_Y - 0.15), blue);
    quad(at(k, e0, RIM_Y - 0.15), at(k1, e1, RIM_Y - 0.15), at(k1, e1, RIM_Y), at(k, e0, RIM_Y), maize);
    quad(at(k, e0, RIM_Y), at(k1, e1, RIM_Y), at(k1, o1 - 0.6, RIM_Y), at(k, o0 - 0.6, RIM_Y), concrete);
    // the outer wall: a stone parapet over brick, down to the ground (and a little under it, on a slope)
    quad(at(k, o0 - 0.6, RIM_Y), at(k1, o1 - 0.6, RIM_Y), at(k1, o1 - 0.6, wy1), at(k, o0 - 0.6, wy0), brick);
    quad(at(k, o0 - 0.6, wy0), at(k1, o1 - 0.6, wy1), at(k1, o1, wy1), at(k, o0, wy0), stone);
    quad(at(k, o0, wy0), at(k1, o1, wy1), at(k1, o1, wy1 - 0.7), at(k, o0, wy0 - 0.7), stone);
    quad(at(k, o0, wy0 - 0.7), at(k1, o1, wy1 - 0.7), at(k1, o1, -3), at(k, o0, -3), brick);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const stands = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }));
  stands.name = 'BigHouseStands';
  stands.castShadow = stands.receiveShadow = true;
  group.add(stands);

  // The field: the floor inside the wall, then the turf with its maize-and-blue end zones, yard lines and the block M
  const floorShape = new THREE.Shape();
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, r = radiiAt(a)[0];
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    k ? floorShape.lineTo(x, -z) : floorShape.moveTo(x, -z);
  }
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(floorShape).rotateX(-Math.PI / 2),
    new THREE.MeshStandardNodeMaterial({ color: turfDark, roughness: 0.92 }));
  floor.position.set(cx, G + FIELD_Y, cz);
  floor.receiveShadow = true;
  group.add(floor);
  const P = STADIUM.pitch;
  const field = new THREE.Group();
  field.position.set(P.cx, G + FIELD_Y + 0.03, P.cz);
  field.rotation.y = Math.PI / 2 - P.angle; // the field's length (local z) along the pitch's long side
  // one material per color, so the hundreds of stripes and marks merge into a few draws (mergeStatic, by material)
  const flatMats = new Map();
  const flatMat = (color) => {
    if (!flatMats.has(color)) flatMats.set(color, new THREE.MeshStandardNodeMaterial({ color, roughness: 0.9 }));
    return flatMats.get(color);
  };
  const flat = (w, d, color, y = 0, x = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), flatMat(color));
    m.position.set(x, y, z);
    m.receiveShadow = true;
    field.add(m);
    return m;
  };
  const W = 48.8, L = 91.4, EZ = 9.1; // 53⅓ yards wide, 100 yards and two end zones long
  for (let i = 0; i < 20; i++) flat(W + 6, L / 20, i % 2 ? 0x3b8a35 : 0x347f30, 0.0, 0, -L / 2 + (i + 0.5) * (L / 20));
  flat(W + 6, EZ + 3, 0x00274c, 0.01, 0, -(L / 2 + (EZ + 3) / 2));
  flat(W + 6, EZ + 3, 0x00274c, 0.01, 0, L / 2 + (EZ + 3) / 2);
  for (let yd = 0; yd <= 100; yd += 5) flat(W, yd % 10 ? 0.12 : 0.22, 0xf2f2ee, 0.03, 0, -L / 2 + (yd / 100) * L);
  for (const sx of [-1, 1]) flat(0.2, L + EZ * 2, 0xf2f2ee, 0.03, sx * W / 2, 0);
  for (const sz of [-1, 1]) flat(W, 0.2, 0xf2f2ee, 0.03, 0, sz * (L / 2 + EZ));
  // hash marks
  for (let yd = 1; yd < 100; yd++) for (const hx of [-6.096, 6.096]) flat(0.6, 0.1, 0xf2f2ee, 0.03, hx, -L / 2 + (yd / 100) * L);
  // MICHIGAN across each end zone in maize outlined in white, its tops toward the end line
  {
    const cv = document.createElement('canvas');
    cv.width = 2048; cv.height = 300;
    const g = cv.getContext('2d');
    g.font = 'bold 270px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 22; g.strokeStyle = '#ffffff';
    g.strokeText('MICHIGAN', 1024, 160, 1960);
    g.fillStyle = '#ffcb05';
    g.fillText('MICHIGAN', 1024, 160, 1960);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardNodeMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.85,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.PlaneGeometry(W - 4, (W - 4) * 300 / 2048).rotateX(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const word = new THREE.Mesh(geo, mat);
      word.position.set(0, 0.035, s * (L / 2 + EZ / 2));
      word.rotation.y = s > 0 ? Math.PI : 0;
      word.renderOrder = 1;
      field.add(word);
    }
  }
  // the yard numbers, 6 ft tall with their bottoms 8 yards in from each sideline, tops toward it, and the little
  // arrows beside them pointing to the nearer goal
  const numberTex = new Map();
  const numberMat = (n) => {
    if (!numberTex.has(n)) {
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 220;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.font = 'bold 230px "Arial Black", "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), 160, 118, 300);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      numberTex.set(n, new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, map: tex, transparent: true, depthWrite: false,
        roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    }
    return numberTex.get(n);
  };
  const numberGeo = new THREE.PlaneGeometry(2.66, 1.83).rotateX(-Math.PI / 2);
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.45); arrowShape.lineTo(-0.23, -0.45); arrowShape.lineTo(0.23, -0.45);
  const arrowGeo = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2); // points to -z
  const lineMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.9 });
  const NX = W / 2 - 7.4 - 0.915;
  for (let yd = 10; yd <= 90; yd += 10) {
    const z = -L / 2 + (yd / 100) * L, n = yd <= 50 ? yd : 100 - yd;
    for (const side of [-1, 1]) {
      const num = new THREE.Mesh(numberGeo, numberMat(n));
      num.position.set(side * NX, 0.035, z);
      num.rotation.y = -side * Math.PI / 2; // the top of the numbers toward this sideline
      num.renderOrder = 1;
      field.add(num);
      if (n === 50) continue;
      const toward = yd < 50 ? -1 : 1;
      const arrow = new THREE.Mesh(arrowGeo, lineMat);
      arrow.position.set(side * (NX + 0.55), 0.035, z + toward * 1.75);
      arrow.rotation.y = toward < 0 ? 0 : Math.PI;
      field.add(arrow);
    }
  }
  // The Block M: slab serifs on its outer feet and top corners, inner legs standing on serifs of their own, and the
  // middle V coming down to a point; maize, outlined in blue
  const BLOCK_M = [[-5, -3.7], [-1.9, -3.7], [-1.9, -2.7], [-2.6, -2.7], [-2.6, 0.9], [0, -2.9], [2.6, 0.9], [2.6, -2.7],
    [1.9, -2.7], [1.9, -3.7], [5, -3.7], [5, -2.7], [4.3, -2.7], [4.3, 2.7], [5, 2.7], [5, 3.7], [2.4, 3.7], [0, 0.4],
    [-2.4, 3.7], [-5, 3.7], [-5, 2.7], [-4.3, 2.7], [-4.3, -2.7], [-5, -2.7]];
  const blockM = (grow) => {
    const shape = new THREE.Shape();
    BLOCK_M.forEach(([x, y], i) => {
      // grow the outline outward by `grow` m (each corner pushed out along the outline's bisector, near enough)
      const [px, py] = BLOCK_M[(i + BLOCK_M.length - 1) % BLOCK_M.length], [nx, ny] = BLOCK_M[(i + 1) % BLOCK_M.length];
      let ax = y - py, ay = px - x, bx = ny - y, by = x - nx;
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      ax /= la; ay /= la; bx /= lb; by /= lb;
      const mx = ax + bx, my = ay + by, d = (mx * ax + my * ay) || 1;
      const ox = x + (mx / d) * grow, oy = y + (my / d) * grow;
      i ? shape.lineTo(ox, oy) : shape.moveTo(ox, oy);
    });
    return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  };
  for (const [grow, hex, y] of [[0.35, 0x00274c, 0.045], [0, 0xffcb05, 0.05]]) {
    const mMesh = new THREE.Mesh(blockM(grow), new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.8 }));
    mMesh.position.y = y;
    mMesh.scale.setScalar(1.4);
    mMesh.rotation.y = -Math.PI / 2; // reads from the press box on the west side
    field.add(mMesh);
  }
  // goalposts: maize uprights on a single post behind each end line
  const postMat = new THREE.MeshStandardNodeMaterial({ color: 0xffcb05, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const z = s * (L / 2 + EZ + 0.6);
    const add = (geo, x, y, zz) => { const m = new THREE.Mesh(geo, postMat); m.position.set(x, y, zz); m.castShadow = true; field.add(m); };
    add(new THREE.CylinderGeometry(0.12, 0.12, 3.05, 8), 0, 1.52, z + s * 1.5);
    add(new THREE.BoxGeometry(0.15, 0.15, 1.6), 0, 3.05, z + s * 0.75);
    add(new THREE.BoxGeometry(5.64, 0.12, 0.12), 0, 3.05, z);
    for (const x of [-2.82, 2.82]) add(new THREE.CylinderGeometry(0.06, 0.06, 6.1, 6), x, 3.05 + 3.05, z);
  }
  group.add(field);

  // The press box and suites (2010) along the west side, the suites along the east, over the top rows. Toward the
  // field, tiers of glass in slim mullions (suites, club and, on the west, the press box at the top) each standing out
  // over the one below, a blue panelled fascia under each with a maize line, a maize stripe under the precast cap.
  // Toward the street, brick in tall bays between proud piers, two storeys of glass and a precast spandrel in each
  // bay, a precast cap; stair and lift cores at both ends rising past the roof, its camera booths and units on top.
  // Brick down to the ground on the outside. Two meshes (masonry, glass: lit at night) of vertex colours.
  const SB = builder();
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r ** (1 / 2.2), c.g ** (1 / 2.2), c.b ** (1 / 2.2)]; };
  const BRICK = lin(0x7e4733), BRICK_DARK = lin(0x6a3b2b), PRECAST = lin(0xd9d4c8), BLUE = lin(0x00274c), BLUE_SEAM = lin(0x0b3460),
    MAIZE = lin(0xffcb05), MULL = lin(0x2a2f35), SGLASS = lin(0x1d2c3c), ROOFC = lin(0x55595e);
  const towers = [
    { side: -1, top: 36, half: 66, depth: 22, tiers: [[3, 9.5, 0], [11.2, 17.6, 1.6], [19.4, 25.6, 3.2]] },
    { side: 1, top: 27, half: 60, depth: 18, tiers: [[3, 9.2, 0], [10.9, 16.7, 1.8]] }
  ];
  for (const t of towers) {
    const rOut = radiiAt(t.side < 0 ? Math.PI : 0)[1];
    const f = -t.side; // toward the field
    const outerX = cx + t.side * rOut, innerX = outerX - t.side * t.depth;
    const X = (d) => outerX + f * d; // d metres in from the street face toward the field
    const y0 = RIM_Y + 1.5, z0 = cz - t.half, z1 = cz + t.half;
    const xb = (d0, d1, ya, yb, za, zb, col, m = SB.stone) => SB.box(X(d0), X(d1), G + ya, G + yb, za, zb, col, m);
    // the body, and its flat roof
    xb(0, t.depth, y0, t.top, z0, z1, BRICK);
    // solid to a car driving round the top of the stands (one passing under its overhang clears it)
    colliders.push({ minX: Math.min(innerX, outerX), maxX: Math.max(innerX, outerX), minZ: z0, maxZ: z1, minY: G + y0, maxY: G + t.top, solid: true });
    // the field side's tiers
    let prevTop = y0;
    for (const [ga, gb, proj] of t.tiers) {
      const fa = y0 + ga - 1.6, face = t.depth + proj;
      // the tier's floor standing out, its fascia panels and maize line, the glass and its mullions
      if (proj > 0) {
        xb(t.depth, face, fa, y0 + gb + 1.0, z0 + 3, z1 - 3, BRICK_DARK);
        colliders.push({ minX: Math.min(X(t.depth), X(face)), maxX: Math.max(X(t.depth), X(face)), minZ: z0 + 3, maxZ: z1 - 3,
          minY: G + fa, maxY: G + y0 + gb + 1.0, solid: true });
      }
      xb(face, face + 0.12, fa, y0 + ga - 0.1, z0 + 3, z1 - 3, BLUE);
      for (let z = z0 + 3 + 2.4; z < z1 - 3; z += 2.4) xb(face + 0.12, face + 0.16, fa + 0.05, y0 + ga - 0.15, z - 0.03, z + 0.03, BLUE_SEAM);
      xb(face, face + 0.2, fa - 0.25, fa, z0 + 3, z1 - 3, MAIZE);
      xb(face - 0.1, face + 0.02, y0 + ga, y0 + gb, z0 + 3, z1 - 3, SGLASS, SB.glass);
      for (let z = z0 + 3; z <= z1 - 2.99; z += 1.6) xb(face, face + 0.12, y0 + ga, y0 + gb, z - 0.05, z + 0.05, MULL);
      xb(face, face + 0.14, y0 + gb, y0 + gb + 0.12, z0 + 3, z1 - 3, MULL);
      prevTop = y0 + gb;
    }
    // the top: a maize stripe and the precast cap round it
    const topFace = t.depth + t.tiers[t.tiers.length - 1][2];
    xb(topFace, topFace + 0.25, t.top - 2.4, t.top - 1.2, z0 + 3, z1 - 3, MAIZE);
    xb(t.depth, topFace + 0.3, prevTop + 0.12, t.top - 2.4, z0 + 3, z1 - 3, BLUE);
    xb(-0.4, topFace + 0.4, t.top - 0.1, t.top + 0.5, z0 - 0.3, z1 + 0.3, PRECAST);
    // the street side: piers, two storeys of glass a bay, a precast spandrel, the cap
    const bays = Math.round((t.half * 2 - 16) / 4.4), bw = (t.half * 2 - 16) / bays;
    for (let k = 0; k <= bays; k++) {
      const z = z0 + 8 + k * bw;
      xb(-0.45, 0, y0 - 3, t.top - 0.1, z - 0.45, z + 0.45, BRICK);
      if (k === bays) break;
      for (let fl = 0; fl + 6.5 <= t.top - y0 - 2; fl += 7.2) {
        xb(-0.05, 0.02, y0 + fl + 0.8, y0 + fl + 5.6, z + 0.6, z + bw - 0.6, SGLASS, SB.glass);
        xb(-0.12, 0, y0 + fl + 3.1, y0 + fl + 3.25, z + 0.6, z + bw - 0.6, MULL);
        xb(-0.12, 0, y0 + fl + 0.8, y0 + fl + 5.6, z + bw / 2 - 0.05, z + bw / 2 + 0.05, MULL);
        xb(-0.2, 0, y0 + fl + 5.6, y0 + fl + 7.2, z + 0.5, z + bw - 0.5, PRECAST);
      }
    }
    // the cores at both ends, a little proud, past the roof
    for (const [za, zb] of [[z0, z0 + 8], [z1 - 8, z1]]) {
      xb(-0.6, t.depth + 0.4, y0 - 3, t.top + 3.2, za, zb, BRICK);
      xb(-0.7, t.depth + 0.5, t.top + 3.2, t.top + 3.7, za - 0.1, zb + 0.1, PRECAST);
      for (let y = y0 + 2; y < t.top; y += 3.6) xb(-0.65, -0.6, y, y + 2.2, (za + zb) / 2 - 0.5, (za + zb) / 2 + 0.5, SGLASS, SB.glass);
    }
    // on the roof: camera booths along the field edge and plant set back
    for (let z = z0 + 14; z < z1 - 12; z += 18) {
      xb(topFace - 3.5, topFace - 0.5, t.top + 0.5, t.top + 3.0, z, z + 5, PRECAST);
      xb(topFace - 0.52, topFace - 0.48, t.top + 1.0, t.top + 2.6, z + 0.4, z + 4.6, SGLASS, SB.glass);
    }
    xb(3, t.depth - 6, t.top + 0.5, t.top + 2.4, cz - 14, cz + 14, ROOFC);
    // the brick down to the ground on the outside
    xb(0, 3, -3, y0, z0, z1, BRICK);
    colliders.push({ minX: Math.min(outerX, outerX - t.side * 3), maxX: Math.max(outerX, outerX - t.side * 3),
      minZ: z0, maxZ: z1, minY: G - 3, maxY: G + y0, solid: true });
  }
  const towerMesh = (m, mat, name) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const out = new THREE.Mesh(geo, mat);
    out.name = name;
    out.castShadow = out.receiveShadow = true;
    group.add(out);
  };
  towerMesh(SB.stone, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }), 'StadiumTowers');
  towerMesh(SB.glass, landmarkGlass(), 'StadiumTowerGlass');

  // The video boards behind each end zone, on the outer wall
  const boxMat = new THREE.MeshStandardNodeMaterial({ color: 0x3f474f, roughness: 0.5, metalness: 0.3 });
  // What they show: GO BLUE in maize on Michigan blue
  const cv = document.createElement('canvas');
  cv.width = 1240; cv.height = 400;
  const cx2 = cv.getContext('2d');
  const sky = cx2.createLinearGradient(0, 0, 0, 400);
  sky.addColorStop(0, '#0b3a6b'); sky.addColorStop(1, '#00274c');
  cx2.fillStyle = sky; cx2.fillRect(0, 0, 1240, 400);
  cx2.strokeStyle = '#ffcb05'; cx2.lineWidth = 14; cx2.strokeRect(22, 22, 1196, 356);
  cx2.fillStyle = '#ffcb05';
  cx2.font = '900 250px "Helvetica Neue", Helvetica, Arial, sans-serif';
  cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
  cx2.fillText('GO BLUE', 620, 212, 1100);
  const screenTex = new THREE.CanvasTexture(cv);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 8;
  const screenMat = new THREE.MeshBasicNodeMaterial({ map: screenTex });
  // and their backs, toward the street: a maize block M on Michigan blue
  const bv = document.createElement('canvas');
  bv.width = 1024; bv.height = 420;
  const bx = bv.getContext('2d');
  bx.fillStyle = '#00274c'; bx.fillRect(0, 0, 1024, 420);
  // the field's own Block M outline (slab serifs, the V to a point), not a font's M
  {
    const k = 44;
    bx.beginPath();
    BLOCK_M.forEach(([x, y], i) => (i ? bx.lineTo : bx.moveTo).call(bx, 512 + x * k, 210 - y * k));
    bx.closePath();
    bx.fillStyle = '#ffcb05'; bx.fill();
  }
  const backTex = new THREE.CanvasTexture(bv);
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.anisotropy = 8;
  const backMat = new THREE.MeshStandardNodeMaterial({ map: backTex, roughness: 0.55 });
  for (const s of [-1, 1]) {
    const a = s < 0 ? -Math.PI / 2 : Math.PI / 2, rOut = radiiAt(a)[1];
    const bz = cz + s * (rOut - 2);
    const board = new THREE.Mesh(new THREE.BoxGeometry(34, 14, 2), new THREE.MeshStandardNodeMaterial({ color: 0x00274c, roughness: 0.5 }));
    board.position.set(cx, G + 23, bz);
    board.castShadow = true;
    group.add(board);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(31, 10), screenMat);
    screen.position.set(cx, G + 23.5, bz - s * 1.05);
    if (s > 0) screen.rotation.y = Math.PI;
    group.add(screen);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(33, 13.5), backMat);
    back.position.set(cx, G + 23, bz + s * 1.02);
    if (s < 0) back.rotation.y = Math.PI;
    group.add(back);
    const band = new THREE.Mesh(new THREE.BoxGeometry(34.2, 1.2, 2.2), new THREE.MeshStandardNodeMaterial({ color: 0xffcb05, roughness: 0.6 }));
    band.position.set(cx, G + 16.6, bz);
    group.add(band);
    for (const lx of [-12, 12]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.6, 16, 1.6), boxMat);
      leg.position.set(cx + lx, G + 8, bz);
      group.add(leg);
    }
  }

  // Keep people, bikes and traffic outside the wall (a car may drive in over it), on the wall's own outline so the
  // ground beyond it and the survey's neighbors stay clear (keepsSurvey); it stands for the survey's blocks inside
  // the wall (the bowl and the two side towers), which the block filter drops (`replaces`)
  const outer = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, r = radiiAt(a)[1];
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    outer.push({ x, z });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const inside = (x, z) => Math.hypot(x - cx, z - cz) < radiiAt(Math.atan2(z - cz, x - cx))[1];
  const replaces = REAL_BUILDINGS.filter((b) => b.maxX > minX && b.minX < maxX && b.maxZ > minZ && b.minZ < maxZ
    && inside(b.cx, b.cz));
  // the survey draws each end's video board as a thin block just outside the wall: the boards above stand for them
  for (const b of REAL_BUILDINGS) {
    if (b.maxZ - b.minZ > 6 || b.maxX - b.minX < 30 || b.maxX < minX || b.minX > maxX) continue;
    if (b.maxZ > minZ - 10 && b.minZ < minZ + 4 || b.minZ < maxZ + 10 && b.maxZ > maxZ - 4) replaces.push(b);
  }
  colliders.push({ minX, maxX, minZ, maxZ, maxY: G + 45, polygon: { outer, holes: [] }, stadium: true, keepsSurvey: true,
    replaces }); // the helicopter flies into the bowl
  // the video boards and their legs are solid where they're drawn (the helicopter and a car on the concourse meet them)
  for (const s of [-1, 1]) {
    const bz = cz + s * (radiiAt(s < 0 ? -Math.PI / 2 : Math.PI / 2)[1] - 2);
    colliders.push({ minX: cx - 17.1, maxX: cx + 17.1, minZ: bz - 1.1, maxZ: bz + 1.1, minY: G + 16, maxY: G + 30, solid: true });
    for (const lx of [-12, 12]) colliders.push({ minX: cx + lx - 0.8, maxX: cx + lx + 0.8, minZ: bz - 0.8, maxZ: bz + 0.8,
      minY: G - 1, maxY: G + 16, solid: true });
  }
  // stood on the ground it was measured from: setOnTerrain leaves it be
  group.userData.terrain = 'set';
}

function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'AnnArborLandmarks';
  const colliders = [];
  buildBigHouse(group, colliders);
  // Burton Tower, Hill Auditorium and the Union, modelled by hand in place of the survey's blocks
  const campus = buildCampusLandmarks(group, colliders, GEO.landmarks || {});
  // (the Michigan Theater's own model is left out at the person's wish: the survey's building stands there)
  // the rest, on the survey's own outlines
  campus.push(...buildMoreLandmarks(group, colliders));
  // the bronze block M where the Diag's walks meet
  if (buildDiagM(group)) campus.push('the Diag M');
  // Graffiti Alley beside the theater, painted over every surface
  if (buildGraffitiAlley(group, colliders)) campus.push('Graffiti Alley');
  // the hundreds of small pieces they're built of, merged by material: a few dozen draws (merge-static.js)
  const reach = TIER.landmarkReach;
  // Lamp: on the Xbox the landmarks built as one mesh across the town (campus-landmarks.js, more-landmarks.js) are cut
  // by where they stand, so each building is culled and hidden on its own
  if (reach) for (const o of [...group.children]) if (/^(CampusLandmark|MoreLandmarks)/.test(o.name)) splitByCell(o, 300);
  const { before, after } = mergeStatic(group, 400, { share: !!reach });
  // Lamp: on the Xbox none drawn beyond about a kilometre (the city's culling scales a distance by `farCut`)
  if (reach) group.traverse((o) => { if (o.isMesh && !o.userData.cullDistance) o.userData.cullDistance = reach / TIER.farCut; });
  console.info(`[landmarks] the Big House, ${campus.join(', ')}; ${before} pieces drawn as ${after}`);
  scene.add(group);
  return { group, colliders };
}

export { buildLandmarks, bryantParkLawn };
