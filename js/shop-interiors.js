import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, attribute, varying, positionGeometry, positionWorld, cameraPosition, Discard, uniform, normalWorld, floor, fract, mod, abs, min, max,
  clamp, mix, step, smoothstep, dot, sin, pow, exp, normalize, reflect, fwidth, If } from 'three/tsl';
import { log } from '../lamp-game.js';
import { TIER } from './device-tier.js';
import { cityUniforms } from './tsl-materials.js';
import { polygonContains, polygonBoxOverlaps } from './building-collision.js';
import { SHOP_TYPES, SHOP_CUISINES, SHOP, shopBays, shopOutlines, shopHour, shopOpenShares, bayDoorLeft, markBayRoom, shopLookOf } from './shop-types.js';
import { shopKit, kitVariants, STYLES, FLOORS, WALLS, H0, D0, HT } from './shop-kits.js';
import { PersonCrowd, PersonRig } from './pedestrians.js';
import { LIFE } from './street-life.js';

// Lamp: the rooms behind the shopfronts' glass. Near the camera a named business's bay is a real room: the shopfront's
// shader leaves its glass out (createStorefront's `open`, tsl-materials.js, within cityUniforms.uShopGlass metres),
// and behind it stand a room box set into the building (never deeper than the building: `prepare` tests its
// footprint), the furniture of its kind (shop-kits.js: one merged shape per kind, drawn once for all the rooms of
// that kind in reach, each fitted to its own bay, mirrored by the side its door is on, in its own colors), a clear
// pane of glass with the sky in it, and people (the town's own: pedestrians.js PersonCrowd and PersonRig.perch):
// staff behind the counter, customers by the hour, sitting, queueing, browsing, never still. Far shops keep the
// painted room. None of this on a phone or the Xbox.
//
// The rooms are lit by themselves (the sun doesn't reach in): each kind's own light, brighter against the dark after
// sunset, daylight falling in from the window by day, dim with a night light when the business is shut.

const REACH = 64; // rooms are drawn within this of the camera
const GLASS = 46; // the glass is left out within this (it comes back in a dither over the 10 m before it)
const FLOOR_Y = 0.23; // the floor above the ground the building stands on (the sidewalk's height at the door)
const MIN_DEPTH = 4, MAX_DEPTH = 8, MIN_HALF = 2.4;
const MIN_SHORT = 3.5; // a room cut short by another room or another building is kept down to this
const PHONE = TIER.name === 'phone';
const BUDGET = TIER.name === 'full' ? { rooms: 72, people: 64, each: 6 } : TIER.name === 'light' ? { rooms: 56, people: 44, each: 5 } : { rooms: 36, people: 20, each: 3 };
const STRIDE = 20; // floats a room: five vec4s (roomA..roomE below)
const hash = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------------
// Which bays get a room, and how deep
function prepare() {
  const bays = shopBays().slice().sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0));
  const rooms = [], byRecord = new Map(), skipped = { narrow: 0, low: 0, shallow: 0, corner: 0, neighbour: 0 };
  const shortened = { corner: 0, neighbour: 0 };
  const corners = (r, depth) => {
    const hw = r.halfW, d0 = -0.05, d1 = depth + 0.1;
    return [[-hw, d0], [hw, d0], [hw, d1], [-hw, d1]].map(([a, d]) => [r.x + r.ux * a + r.nx * d, r.z + r.uz * a + r.nz * d]);
  };
  const overlaps = (A, B) => {
    for (const poly of [A, B]) {
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4], ax = z1 - z0, az = x0 - x1;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const [x, z] of A) { const t = x * ax + z * az; a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
        for (const [x, z] of B) { const t = x * ax + z * az; b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
        if (a1 <= b0 || b1 <= a0) return false;
      }
    }
    return true;
  };
  // the other buildings' outlines, by where they are: none may run through a room (a neighbour's wall in a salon)
  const OUT = 24, outlines = new Map();
  for (const c of shopOutlines()) {
    for (let ix = Math.floor(c.minX / OUT); ix <= Math.floor(c.maxX / OUT); ix++) for (let iz = Math.floor(c.minZ / OUT); iz <= Math.floor(c.maxZ / OUT); iz++) {
      const k = ix + ',' + iz;
      if (!outlines.has(k)) outlines.set(k, []);
      outlines.get(k).push(c);
    }
  }
  const others = (r, rec) => {
    const found = new Set(), R = MAX_DEPTH + r.halfW + 1;
    for (let ix = Math.floor((r.x - R) / OUT); ix <= Math.floor((r.x + R) / OUT); ix++) for (let iz = Math.floor((r.z - R) / OUT); iz <= Math.floor((r.z + R) / OUT); iz++) {
      for (const c of outlines.get(ix + ',' + iz) || []) {
        if (rec.polygons.includes(c.polygon) || c.minX > r.x + R || c.maxX < r.x - R || c.minZ > r.z + R || c.maxZ < r.z - R) continue;
        found.add(c.polygon);
      }
    }
    return [...found];
  };
  // does one of them come into the room's box (a hand's width in from its sides and its glass, to its back wall)?
  const crossed = (r, depth, list) => {
    const d0 = 0.15, d1 = depth + 0.05, mid = (d0 + d1) / 2;
    return list.some((poly) => polygonBoxOverlaps(poly, r.x + r.nx * mid, r.z + r.nz * mid, r.halfW - 0.12, (d1 - d0) / 2, r.ux, -r.uz));
  };
  for (const bay of bays) {
    markBayRoom(bay, false);
    const rec = bay.record, name = SHOP_TYPES[bay.type];
    if (!rec || !STYLES[name]) continue;
    // (a restaurant or a fast food place of a known kind of cooking has that kind's room)
    const kit = bay.cuisine && (name === 'restaurant' || name === 'fast_food') && STYLES['c_' + SHOP_CUISINES[bay.cuisine]] ? 'c_' + SHOP_CUISINES[bay.cuisine] : name;
    const halfW = bay.width / 2; // (the walls between two rooms are one plane, each seen from its own side)
    if (halfW < MIN_HALF) { skipped.narrow++; continue; }
    const height = Math.min(HT, rec.height - 0.45);
    if (height < 2.5) { skipped.low++; continue; }
    const r = { bay, type: bay.type, name, kit, x: bay.x, z: bay.z, ux: bay.ux, uz: bay.uz, nx: bay.uz, nz: -bay.ux, halfW, height,
      y: (rec.ground ?? 0) + FLOOR_Y, wallRow: bay.row, col: bay.col };
    // as deep as the building is behind it, across the whole bay
    let depth = 0;
    const inside = (a, d) => polygonContains(bay.polygon, r.x + r.ux * a + r.nx * d, r.z + r.uz * a + r.nz * d);
    for (let d = 0.5; d <= MAX_DEPTH + 0.35; d += 0.25) {
      if (!inside(-halfW + 0.3, d) || !inside(0, d) || !inside(halfW - 0.3, d)) break;
      depth = d;
    }
    depth = Math.min(MAX_DEPTH, depth - 0.3);
    if (depth < MIN_DEPTH) { skipped.shallow++; continue; }
    // not into another building: its own outline was tested above, but a neighbour's may overlap it
    const near = others(r, rec);
    if (near.length && crossed(r, depth, near)) {
      while (depth >= MIN_SHORT && crossed(r, depth, near)) depth -= 0.25;
      if (depth < MIN_SHORT) { skipped.neighbour++; continue; }
      shortened.neighbour++;
    }
    // not into a room round the corner: this one is cut short, and then the one it runs into
    const mates = byRecord.get(rec) || [];
    let box = corners(r, depth);
    const hits = (bx) => mates.filter((o) => o.wallRow !== r.wallRow && overlaps(bx, o.box));
    if (hits(box).length) {
      while (depth > MIN_SHORT && hits(box).length) { depth = Math.max(MIN_SHORT, depth - 0.25); box = corners(r, depth); }
      const left = hits(box), cut = [];
      for (const o of left) {
        let d = o.depth;
        while (d > MIN_SHORT && overlaps(box, corners(o, d))) d = Math.max(MIN_SHORT, d - 0.25);
        if (overlaps(box, corners(o, d))) { cut.length = 0; cut.push(null); break; }
        cut.push([o, d]);
      }
      if (cut[0] === null) { skipped.corner++; continue; }
      for (const [o, d] of cut) { o.depth = d; o.box = corners(o, d); shortened.corner++; }
      shortened.corner++;
    }
    r.depth = depth;
    r.box = box;
    mates.push(r);
    byRecord.set(rec, mates);
    rooms.push(r);
    markBayRoom(bay, true);
  }
  // each room's own choices: its door's side (the kit's door is on the left), its colors, the walls it shares
  const key = (row, col) => row * 64 + col, at = new Map(rooms.map((r) => [key(r.wallRow, r.col), r]));
  for (const r of rooms) {
    const { bay } = r, style = STYLES[r.kit], look = shopLookOf(r.name);
    r.mirror = bayDoorLeft(bay.biz, bay.col) ? 1 : -1;
    r.seed = hash(bay.biz, r.type + 3.1);
    const pickOf = (list, salt) => list[Math.floor(hash(bay.biz, salt) * list.length) % list.length];
    r.wall = pickOf(style.walls, 1.7); r.floor = pickOf(style.floors, 2.9); r.accent = pickOf(style.accents, 4.3);
    r.light = style.light ?? look.light; r.day = style.day ?? look.day; r.night = style.night ?? look.night;
    r.floorKind = FLOORS[bay.variant && r.name === 'salon' ? 'checker' : style.floor];
    r.wallKind = WALLS[style.wall];
    const same = (c) => { const o = at.get(key(r.wallRow, c)); return o && o.bay.sign === bay.sign ? 1 : 0; };
    const before = same(bay.col - 1), after = same(bay.col + 1); // (to the left and right, seen from the street)
    r.hideLeft = r.mirror > 0 ? before : after;
    r.hideRight = r.mirror > 0 ? after : before;
    r.openAt = (bay.biz * 0.6180339) % 1; // (as createStorefront's `lit`)
    r.people = [];
    r.shown = false;
  }
  // which of its kind's layouts (shop-kits.js): by the business's own number, so its bays agree; a business beside
  // another of its kind (within 16 m) takes the next layout, so two neighbours never have the one room
  const firms = new Map();
  for (const r of rooms) {
    let f = firms.get(r.bay.sign);
    if (!f) firms.set(r.bay.sign, (f = { sign: r.bay.sign, kit: r.kit, biz: r.bay.biz, rooms: [] }));
    f.rooms.push(r);
  }
  const placedFirms = [];
  let bumped = 0;
  for (const f of [...firms.values()].sort((a, b) => a.sign - b.sign)) {
    const n = kitVariants(f.kit);
    f.layout = Math.floor(hash(f.biz, 9.1 + f.sign * 0.37) * n) % n;
    if (n > 1) {
      const taken = new Set();
      for (const o of placedFirms) {
        if (o.kit !== f.kit) continue;
        if (f.rooms.some((a) => o.rooms.some((b) => Math.hypot(a.x - b.x, a.z - b.z) < 16))) taken.add(o.layout);
      }
      let tries = 0;
      const first = f.layout;
      while (taken.has(f.layout) && tries++ < n) f.layout = (f.layout + 1) % n;
      if (taken.has(f.layout)) f.layout = first; else if (f.layout !== first) bumped++;
    }
    placedFirms.push(f);
    for (const r of f.rooms) { r.layout = f.layout; r.kitName = f.layout ? r.kit + '~' + f.layout : r.kit; }
  }
  const grid = new Map();
  for (const r of rooms) {
    const k = Math.floor(r.x / REACH) + ',' + Math.floor(r.z / REACH);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  }
  log(`[shop rooms] ${rooms.length} rooms behind the glass of ${bays.length} named bays (too narrow ${skipped.narrow}, too low ${skipped.low}, no depth ${skipped.shallow}, round a corner ${skipped.corner}, another building in it ${skipped.neighbour}); cut short ${shortened.corner} for a room round the corner, ${shortened.neighbour} for another building; ${bumped} businesses took another layout than a neighbour's`);
  return { rooms, grid };
}

// ---------------------------------------------------------------------------------------------------------------------
// The rooms' one material: fits the kit to the room, tints it, and lights it from inside
const uNight = uniform(0); // 0 by day, 1 after dark
const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
const unpack = (v) => pow(vec3(floor(v.div(65536)), floor(mod(v, 65536).div(256)), mod(v, 256)).div(255), vec3(2.2));

function createRoomMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const A = attribute('roomA', 'vec4'), B = attribute('roomB', 'vec4'), Cc = attribute('roomC', 'vec4');
  const Dd = attribute('roomD', 'vec4'), Ee = attribute('roomE', 'vec4');
  const aux = attribute('aux', 'vec4'), p = positionGeometry;
  const halfW = B.z, depth = B.w, height = Cc.x;
  const slot = aux.z;
  const is = (n) => step(abs(slot.sub(n)), 0.25);
  const local = vec3(
    p.x.add(aux.x.mul(halfW.sub(H0))),
    p.y.sub(max(float(HT).sub(height), 0).mul(clamp(p.y.sub(2.0).div(HT - 2.0), 0, 1))),
    p.z.add(aux.y.mul(depth.sub(D0))));
  const hidden = max(is(5).mul(Cc.z), is(6).mul(Cc.w));
  const U = vec3(B.x, 0, B.y), N = vec3(B.y, 0, B.x.negate());
  mat.positionNode = mix(A.xyz.add(U.mul(local.x.mul(A.w))).add(vec3(0, 1, 0).mul(local.y)).add(N.mul(local.z)), A.xyz, hidden);

  const wallCol = unpack(Dd.x), floorCol = unpack(Dd.y), accentCol = unpack(Dd.z);
  const isWall = max(max(is(1), is(5)), is(6));
  const tint = mix(mix(mix(mix(vec3(1), wallCol, isWall), floorCol, is(2)), accentCol, is(3)), mix(wallCol, vec3(1), 0.55).mul(0.92), is(7));
  const vTint = varying(tint, 'vShopTint');
  const vAccent = varying(accentCol, 'vShopAccent');
  const vLight = varying(unpack(Dd.w), 'vShopLight');
  const vRoom = varying(local, 'vShopRoom');
  const nrm = attribute('normal', 'vec3');
  const vNormal = varying(nrm, 'vShopNormal');
  const vOut = varying(U.mul(nrm.x.mul(A.w)).add(vec3(0, 1, 0).mul(nrm.y)).add(N.mul(nrm.z)), 'vShopOut');
  const vColor = varying(attribute('color', 'vec3'), 'vShopColor');
  const vAux = varying(vec4(slot, aux.w, halfW, depth), 'vShopAux');
  const vState = varying(vec4(Cc.x, Cc.y, Ee.x, Ee.y), 'vShopState'); // height, open, its light by day and by night
  const vKinds = varying(vec2(Ee.z, Ee.w), 'vShopKinds');

  mat.colorNode = Fn(() => {
    const s = vAux.x, glow = vAux.y, hw = vAux.z, dp = vAux.w;
    const fs = (n) => step(abs(s.sub(n)), 0.25);
    const x = vRoom.x, y = vRoom.y, z = vRoom.z;
    const n = normalize(vNormal);
    const floorIs = fs(2), backIs = fs(1), sideIs = max(fs(5), fs(6)), wallIs = max(backIs, sideIs), ceilIs = fs(7);
    const albedo = vColor.mul(vTint).toVar();
    // the room's own walls, floor and ceiling are seen only from inside it (two rooms share the plane between them)
    If(max(max(wallIs, floorIs), ceilIs).greaterThan(0.5).and(dot(vOut, cameraPosition.sub(positionWorld)).lessThan(0)), () => { Discard(); });

    // the floor: boards, a checker of tiles, big tiles, carpet, concrete
    If(floorIs.greaterThan(0.5), () => {
      const kind = vKinds.x, fw = max(fwidth(x), fwidth(z));
      const pat = float(1).toVar();
      If(kind.lessThan(0.5), () => {
        const g = x.div(0.13), id = floor(g);
        const zz = z.add(hash21(vec2(id, 3.3)).mul(2.4)).div(1.9);
        const tone = hash21(vec2(id, floor(zz))).mul(0.3).add(0.84);
        const seam = smoothstep(0.5, float(0.46).sub(fw.div(0.13)), abs(fract(g).sub(0.5)));
        const butt = smoothstep(0.5, float(0.495).sub(fw.div(1.9)), abs(fract(zz).sub(0.5)));
        pat.assign(tone.mul(mix(0.62, 1.0, seam.mul(butt))));
      }).ElseIf(kind.lessThan(1.5), () => {
        const c = mod(floor(x.div(0.32)).add(floor(z.div(0.32))), 2);
        const soft = smoothstep(0.12, 0.3, fw);
        pat.assign(mix(mix(float(0.62), float(1.18), c), float(0.9), soft));
      }).ElseIf(kind.lessThan(2.5), () => {
        const gx = x.div(0.6), gz = z.div(0.6);
        const line = smoothstep(0.5, float(0.485).sub(fw.div(0.6)), max(abs(fract(gx).sub(0.5)), abs(fract(gz).sub(0.5))));
        pat.assign(mix(0.72, 1.0, line).mul(hash21(vec2(floor(gx), floor(gz))).mul(0.1).add(0.95)));
      }).ElseIf(kind.lessThan(3.5), () => {
        pat.assign(hash21(floor(vec2(x, z).mul(90))).mul(0.14).add(0.93).mul(sin(x.mul(1.7)).mul(sin(z.mul(1.3))).mul(0.04).add(1)));
      }).Else(() => {
        pat.assign(sin(x.mul(1.1).add(sin(z.mul(0.9)).mul(2))).mul(0.05).add(sin(z.mul(2.3).add(x)).mul(0.03)).add(1.0));
      });
      albedo.mulAssign(pat);
    });
    // the walls: brick, a dark dado under a rail, boards, a band of the business's color
    If(wallIs.greaterThan(0.5), () => {
      const kind = vKinds.y, u = mix(z, x, backIs);
      const fw = max(fwidth(u), fwidth(y));
      If(kind.greaterThan(0.5).and(kind.lessThan(1.5)), () => {
        const row = floor(y.div(0.078)), gu = u.div(0.23).add(mod(row, 2).mul(0.5));
        const mortar = smoothstep(0.5, float(0.45).sub(fw.div(0.078)), abs(fract(y.div(0.078)).sub(0.5)))
          .mul(smoothstep(0.5, float(0.48).sub(fw.div(0.23)), abs(fract(gu).sub(0.5))));
        const tone = hash21(vec2(floor(gu), row)).mul(0.34).add(0.8);
        const far = smoothstep(0.02, 0.06, fw);
        albedo.mulAssign(mix(mix(float(1.35), tone, mortar), float(0.98), far));
      }).ElseIf(kind.greaterThan(1.5).and(kind.lessThan(2.5)), () => {
        const dado = float(1).sub(smoothstep(1.0, 1.01, y));
        const stile = smoothstep(0.5, 0.47, abs(fract(u.div(0.7)).sub(0.5))).mul(smoothstep(0.1, 0.13, y)).mul(float(1).sub(smoothstep(0.9, 0.93, y)));
        const rail = smoothstep(0.98, 1.0, y).mul(float(1).sub(smoothstep(1.05, 1.07, y)));
        albedo.assign(mix(albedo, mix(vec3(0.07, 0.045, 0.03), vec3(0.1, 0.066, 0.044), stile), dado));
        albedo.assign(mix(albedo, vec3(0.05, 0.032, 0.022), rail));
      }).ElseIf(kind.greaterThan(2.5).and(kind.lessThan(3.5)), () => {
        const low = float(1).sub(smoothstep(1.1, 1.11, y));
        const bead = smoothstep(0.5, float(0.44).sub(fw.div(0.11)), abs(fract(u.div(0.11)).sub(0.5)));
        albedo.assign(mix(albedo, vec3(0.86, 0.84, 0.78).mul(mix(0.8, 1.0, bead)), low));
        albedo.assign(mix(albedo, vec3(0.9, 0.88, 0.82), smoothstep(1.1, 1.11, y).mul(float(1).sub(smoothstep(1.16, 1.17, y)))));
      }).ElseIf(kind.greaterThan(3.5), () => {
        const band = smoothstep(0.95, 0.96, y).mul(float(1).sub(smoothstep(1.2, 1.21, y)));
        albedo.assign(mix(albedo, vAccent.mul(vColor), band));
      });
    });

    // light: from the ceiling's lamps (tops brighter than sides, undersides dark), darker into the corners and under
    // things, and the day falling in from the window
    const up = n.y.mul(0.5).add(0.5);
    const shade = mix(float(0.6), float(1.0), up).mul(float(1).sub(abs(n.x).mul(0.1))).mul(mix(1.0, 0.86, clamp(z.div(dp), 0, 1)));
    const wallDist = min(hw.sub(abs(x)), dp.sub(z));
    const ao = float(1).toVar();
    ao.assign(mix(ao, mix(0.68, 1.0, smoothstep(0.0, 0.8, wallDist)), max(floorIs, ceilIs)));
    ao.assign(mix(ao, mix(0.7, 1.0, smoothstep(0.0, 0.55, y)).mul(mix(0.8, 1.0, smoothstep(0.0, 0.5, vState.x.sub(y))))
      .mul(mix(0.78, 1.0, smoothstep(0.0, 0.7, mix(dp.sub(z), hw.sub(abs(x)), backIs)))), wallIs));
    ao.assign(mix(ao, mix(0.7, 1.0, smoothstep(0.0, 0.42, y)), max(fs(0), fs(3))));
    const open = vState.y;
    const level = mix(vState.z, vState.w, uNight).mul(mix(mix(0.1, 0.04, uNight), 1.0, open));
    const day = float(1).sub(uNight);
    const daylight = cityUniforms.uSkyHorizonColor.mul(day).mul(exp(z.div(-2.6)))
      .mul(max(n.z.negate(), 0).mul(0.5).add(up.mul(0.3)).add(0.3)).mul(0.62);
    const raw = albedo.mul(vLight.mul(level).mul(shade).add(daylight)).mul(ao);
    // (after dark a pale room would be a white-hot box in the street: its brightest eased down)
    const lit = raw.div(raw.mul(uNight.mul(0.32)).add(1));
    // what shines by itself: a lamp while the shop is open (2: all night)
    const always = step(1.75, glow);
    const gain = mix(clamp(glow, 1, 1.6), float(0.85), always);
    const shine = albedo.mul(gain).mul(mix(1.15, 0.95, uNight)).mul(mix(0.04, 1.0, max(open, always)));
    return vec4(mix(lit, shine, clamp(glow, 0, 1)), 1);
  })();
  return mat;
}

// The panes: one quad a bay, a little behind the wall's face, clear but for the sky in it
function createPaneMaterial() {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const P = attribute('paneA', 'vec4'), Q = attribute('paneB', 'vec4');
  const p = positionGeometry;
  const U = vec3(Q.x, 0, Q.y), N = vec3(Q.y, 0, Q.x.negate());
  const world = P.xyz.add(U.mul(p.x.mul(P.w))).add(vec3(0, 1, 0).mul(p.y.add(0.5).mul(Q.z))).add(N.mul(0.035));
  mat.positionNode = world;
  const vWorld = varying(world, 'vPaneWorld');
  const vOut = varying(N.negate(), 'vPaneOut');
  const vUV = varying(vec2(p.x.mul(P.w), p.y.add(0.5).mul(Q.z)), 'vPaneUV');
  const result = Fn(() => {
    const view = normalize(cameraPosition.sub(vWorld));
    const n = normalize(vOut);
    const fres = pow(float(1).sub(abs(dot(view, n))).clamp(0, 1), 2.2);
    const r = reflect(view.negate(), n);
    const sky = mix(cityUniforms.uSkyHorizonColor, cityUniforms.uSkyTopColor, clamp(r.y.mul(1.6), 0, 1));
    // below the horizon the street across the way, dim, its roofline uneven
    const along = dot(r, vec3(n.z, 0, n.x.negate()));
    const roofs = sin(along.mul(9).add(vWorld.x.add(vWorld.z).mul(0.35))).mul(0.05).add(sin(along.mul(23)).mul(0.025)).add(0.16);
    const env = mix(cityUniforms.uSkyHorizonColor.mul(0.3), sky, smoothstep(roofs.sub(0.02), roofs.add(0.02), r.y));
    // soft streaks of sheen across the pane, sliding as the eye moves
    const slide = vUV.x.add(vUV.y.mul(0.55)).add(dot(view, vec3(n.z, 0, n.x.negate())).mul(2.2));
    const streak = smoothstep(0.0, 0.5, sin(slide.mul(1.9))).mul(smoothstep(0.2, 0.9, sin(slide.mul(0.83).add(1.3)))).mul(0.5).add(smoothstep(0.75, 1.0, sin(slide.mul(4.3))).mul(0.25));
    const day = float(1).sub(uNight);
    const alpha = fres.mul(0.6).add(0.06).add(streak.mul(0.06)).mul(mix(0.4, 1.0, day)).clamp(0, 0.9);
    return vec4(mix(env, cityUniforms.uSkyHorizonColor.mul(1.05), streak.mul(0.4)).mul(mix(0.5, 1.0, day)), alpha);
  })();
  mat.colorNode = result.rgb;
  mat.opacityNode = result.a;
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// How full a kind of business is at an hour of the day, 0 to 1
function busyAt(name, h, weekend) {
  const bump = (a, b, ramp = 0.75) => smooth((h - a) / ramp) * smooth((b - h) / ramp);
  switch (name) {
    case 'restaurant': return Math.max(0.2, bump(11.5, 14), bump(17.5, 21.5));
    case 'fast_food': return Math.max(0.3, bump(11.3, 13.8), 0.85 * bump(17, 20), 0.6 * bump(21.5, 25));
    case 'cafe': return Math.max(0.35, bump(7.3, 10.5), 0.7 * bump(13, 16.5));
    case 'bakery': return Math.max(0.25, bump(7, 10), 0.6 * bump(12, 14), 0.5 * bump(16, 18));
    case 'bar': return Math.max(0.2, 0.5 * bump(16.5, 19), h >= 19 || h < 2.5 ? (weekend ? 1 : 0.8) : 0);
    case 'theatre': return Math.max(0.15, bump(18.3, 22.5), weekend ? 0.6 * bump(13, 17) : 0);
    case 'bank': case 'medical': case 'service': return Math.max(0.3, 0.8 * bump(11.5, 13.5), 0.6 * bump(15, 17));
    case 'grocery': return Math.max(0.35, 0.7 * bump(11.5, 13.5), bump(16.5, 19.5));
    default: return Math.max(0.3, 0.7 * bump(12, 14), (weekend ? 1 : 0.75) * bump(15.5, 19));
  }
}

// Someone's pose at a moment, for PersonRig.perch: by what they're doing there, never quite still
const POSE = { hip: [0, 0, 0], shoulder: [0, 0, 0], hand: [0.2, 0.9, 0.05], foot: [0.1, 0, 0], standing: false, hands: [[0, 0, 0], [0, 0, 0]], head: [0, 0] };
// a slow pulse now and then: 0 mostly, rising to 1 and back for `len` seconds every `every` or so
const nowAndThen = (t, every, len, phase) => {
  const u = ((t + phase * every) % every) / len;
  return u < 1 ? Math.sin(u * Math.PI) ** 2 : 0;
};
function poseOf(person, t) {
  const sp = person.spot, ph = person.phase, P = POSE, h = sp.h ?? 0.45;
  const breathe = Math.sin(t * 1.3 + ph * 9) * 0.006, sway = Math.sin(t * 0.37 + ph * 20) * 0.02;
  const look = Math.sin(t * 0.23 + ph * 31) * 0.35 + Math.sin(t * 0.61 + ph * 7) * 0.12;
  const L = P.hands[0], R = P.hands[1];
  P.head[0] = look; P.head[1] = 0.04;
  switch (sp.pose) {
    case 'sit': case 'bar': case 'type': case 'read': {
      const bar = sp.pose === 'bar';
      P.standing = false;
      P.hip[1] = h; P.hip[2] = -0.04;
      P.shoulder[0] = sway * 0.5; P.shoulder[1] = h + 0.52 + breathe; P.shoulder[2] = (sp.table ? 0.02 : -0.09) + sway;
      P.foot[0] = 0.13; P.foot[1] = bar ? 0.31 : 0.07; P.foot[2] = bar ? 0.2 : Math.min(0.5, 0.2 + h * 0.62);
      const ty = bar ? 1.13 : 0.79;
      if (sp.pose === 'type') {
        L[0] = 0.12; L[1] = ty; L[2] = 0.36 + Math.sin(t * 7 + ph) * 0.012; R[0] = -0.12; R[1] = ty + Math.max(0, Math.sin(t * 9 + ph)) * 0.012; R[2] = 0.37;
        P.head[0] = look * 0.2; P.head[1] = 0.2;
      } else if (sp.pose === 'read') {
        const turn = nowAndThen(t, 14, 1.2, ph);
        L[0] = 0.11; L[1] = h + 0.3; L[2] = 0.3; R[0] = -0.11 + turn * 0.12; R[1] = h + 0.3 + turn * 0.05; R[2] = 0.3;
        P.shoulder[2] = -0.12; P.head[0] = look * 0.15; P.head[1] = 0.38;
      } else if (sp.table) {
        // hands on the table; now and then the fork, or the glass, comes up
        const eat = nowAndThen(t, 6 + ph * 5, 1.7, ph * 3), talk = nowAndThen(t, 9, 2.5, ph * 5 + 0.4);
        L[0] = 0.2; L[1] = ty + talk * 0.1; L[2] = 0.36 - talk * 0.05;
        R[0] = -0.2 + eat * 0.14; R[1] = ty + eat * (h + 0.66 - ty); R[2] = 0.36 - eat * 0.2;
        P.head[1] = 0.1 + eat * 0.1;
      } else {
        L[0] = 0.16; L[1] = h + 0.13; L[2] = 0.3; R[0] = -0.16; R[1] = h + 0.13; R[2] = 0.3;
      }
      break;
    }
    default: {
      P.standing = true;
      const lean = sp.pose === 'lean' ? 0.15 : sp.pose === 'work' ? 0.08 : 0.02;
      P.hip[0] = 0; P.hip[1] = 0.95; P.hip[2] = 0;
      P.shoulder[0] = 0; P.shoulder[1] = 1.45 + breathe; P.shoulder[2] = lean + sway * 0.4;
      P.foot[0] = 0.1; P.foot[1] = 0; P.foot[2] = 0;
      L[0] = 0.23; L[1] = 0.86; L[2] = 0.04 + sway; R[0] = -0.23; R[1] = 0.86; R[2] = 0.04 - sway;
      if (sp.pose === 'counter') {
        const hh = (sp.h ?? 1.0) + 0.04, staff = sp.role === 'staff';
        const reach = nowAndThen(t, staff ? 5 + ph * 3 : 11, 1.6, ph * 2), busy = staff ? 1 : 0.25;
        L[0] = 0.22 + Math.sin(t * 0.9 + ph * 5) * 0.07 * busy; L[1] = hh + Math.max(0, Math.sin(t * 1.7 + ph * 3)) * 0.06 * busy; L[2] = 0.33;
        R[0] = -0.2 + Math.sin(t * 1.1 + ph * 8) * 0.08 * busy; R[1] = hh + reach * 0.12; R[2] = 0.32 + reach * 0.18;
        P.shoulder[2] = 0.05 + reach * 0.05;
        P.head[1] = 0.12 + reach * 0.1;
      } else if (sp.pose === 'lean') {
        L[0] = 0.2; L[1] = 0.99; L[2] = 0.36; R[0] = -0.2 + nowAndThen(t, 8, 2, ph) * 0.1; R[1] = 0.99 + nowAndThen(t, 8, 2, ph) * 0.08; R[2] = 0.4;
        P.head[0] = look * 0.4; P.head[1] = 0.42;
      } else if (sp.pose === 'browse') {
        const take = nowAndThen(t, 7 + ph * 4, 2.6, ph * 3);
        R[0] = -0.19; R[1] = 0.9 + take * (0.45 + ph * 0.3); R[2] = 0.08 + take * 0.34;
        P.head[0] = look * 0.7; P.head[1] = 0.08 - take * 0.12 + Math.sin(t * 0.3 + ph * 4) * 0.12;
      } else if (sp.pose === 'drink') {
        const sip = nowAndThen(t, 8 + ph * 5, 2.2, ph * 2);
        R[0] = -0.17 + sip * 0.1; R[1] = 1.14 + sip * 0.38; R[2] = 0.24 - sip * 0.08;
        L[1] = 0.9; P.head[1] = -sip * 0.12;
      } else if (sp.pose === 'work') {
        // (a stylist's hands at the head in the chair before them)
        L[0] = 0.13 + Math.sin(t * 2.1 + ph) * 0.04; L[1] = 1.3 + Math.sin(t * 1.3) * 0.05; L[2] = 0.4;
        R[0] = -0.12 + Math.sin(t * 2.7 + ph * 2) * 0.05; R[1] = 1.34 + Math.sin(t * 3.1) * 0.04; R[2] = 0.42;
        P.head[0] = look * 0.2; P.head[1] = 0.3;
      }
    }
  }
  return P;
}

// ---------------------------------------------------------------------------------------------------------------------
export function createShopInteriors(group) {
  const idle = { update() {}, stats: () => 'none', rooms: [], setShown() {} };
  if (PHONE) { cityUniforms.uShopGlass.value = 0; return idle; }
  const { rooms, grid } = prepare();
  if (!rooms.length) { cityUniforms.uShopGlass.value = 0; return idle; }
  const roomMaterial = createRoomMaterial();
  const kinds = new Map(); // name -> { mesh, buffer, array, count, cap }
  function kindOf(name) {
    let k = kinds.get(name);
    if (k) return k;
    const kit = shopKit(name), cap = kitVariants(name.split('~')[0]) > 1 ? 16 : 28;
    const g = new THREE.InstancedBufferGeometry();
    for (const a of ['position', 'normal', 'color', 'aux']) g.setAttribute(a, kit.geometry.getAttribute(a));
    const array = new Float32Array(cap * STRIDE);
    array[1] = -5000; // (one room far underground until the first is wanted, so the shader's made with the rest)
    const buffer = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    ['roomA', 'roomB', 'roomC', 'roomD', 'roomE'].forEach((n, i) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)));
    g.instanceCount = 1;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const mesh = new THREE.Mesh(g, roomMaterial);
    mesh.name = 'ShopRooms_' + name;
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    k = { mesh, g, buffer, array, count: 0, cap, kit };
    kinds.set(name, k);
    return k;
  }
  kindOf('restaurant');

  // the panes
  const PANES = BUDGET.rooms;
  const paneArray = new Float32Array(PANES * 8);
  paneArray[1] = -5000;
  const paneBuffer = new THREE.InstancedInterleavedBuffer(paneArray, 8, 1);
  paneBuffer.setUsage(THREE.DynamicDrawUsage);
  const paneGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  paneGeo.setAttribute('position', quad.getAttribute('position'));
  paneGeo.setIndex(quad.getIndex());
  paneGeo.setAttribute('paneA', new THREE.InterleavedBufferAttribute(paneBuffer, 4, 0));
  paneGeo.setAttribute('paneB', new THREE.InterleavedBufferAttribute(paneBuffer, 4, 4));
  paneGeo.instanceCount = 1;
  paneGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const panes = new THREE.Mesh(paneGeo, createPaneMaterial());
  panes.name = 'ShopGlass';
  panes.frustumCulled = false;
  panes.matrixAutoUpdate = false;
  panes.renderOrder = 2;
  group.add(panes);

  // the people: the town's own crowd shapes, lit as the rooms are
  const crowd = new PersonCrowd(BUDGET.people, { farDistance: 22, castShadow: false });
  const uPeopleLight = uniform(new THREE.Color(1, 1, 1));
  for (const m of crowd.meshes) {
    m.material.lights = false;
    m.material.colorNode = m.material.colorNode.mul(uPeopleLight).mul(normalWorld.y.mul(0.3).add(0.74));
    m.name = 'Shop' + m.name;
    m.receiveShadow = false;
    group.add(m);
  }
  const root = new THREE.Object3D();
  const active = []; // the people drawn now

  let lastX = Infinity, lastZ = Infinity, lastHour = -1, lastAt = -1, shownCount = 0, frame = 0, clock = 0, on = true;
  const near = [];
  const place = (r, sp, out) => {
    const x = (sp.x + sp.ax * (r.halfW - H0)) * r.mirror, z = sp.z + sp.az * (r.depth - D0);
    out.x = r.x + r.ux * x + r.nx * z; out.z = r.z + r.uz * x + r.nz * z;
    const fx = r.ux * sp.fx * r.mirror + r.nx * sp.fz, fz = r.uz * sp.fx * r.mirror + r.nz * sp.fz;
    out.yaw = Math.atan2(fx, fz);
    out.rx = Math.cos(out.yaw); out.rz = -Math.sin(out.yaw); // (to their right)
    return out;
  };

  function peopleFor(r, k, hour, weekend, allow) {
    const spots = k.kit.spots;
    const busy = busyAt(r.name, hour, weekend);
    const guests = spots.filter((s) => s.role !== 'staff');
    const want = Math.min(guests.length, Math.round(guests.length * busy * (0.5 + 0.8 * hash(r.bay.biz, 7.7))));
    const chosen = [];
    const paired = new Set();
    // staff: the first always, the rest when it's busy; a stylist only with someone in their chair
    let g = 0;
    const takeGuest = () => { const s = guests[g++]; if (s.pair != null) paired.add(s.pair); return s; };
    const picked = [];
    while (g < want && picked.length < BUDGET.each - 1) picked.push(takeGuest());
    let staffN = 0;
    for (const s of spots) {
      if (s.role !== 'staff') continue;
      if (s.pair != null ? paired.has(s.pair) : staffN === 0 || busy > 0.6) { chosen.push(s); if (s.pair == null) staffN++; }
    }
    for (const s of picked) chosen.push(s);
    return chosen.slice(0, Math.min(allow, BUDGET.each));
  }

  function refresh(cx, cz, cx2, cz2) {
    const hour = shopHour(), shares = shopOpenShares(hour);
    const weekend = LIFE.weekday === 0 || LIFE.weekday === 6;
    near.length = 0;
    const seen = new Set();
    for (const [px, pz] of cx2 == null ? [[cx, cz]] : [[cx, cz], [cx2, cz2]]) {
      const gx = Math.floor(px / REACH), gz = Math.floor(pz / REACH);
      for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
        for (const r of grid.get(ix + ',' + iz) || []) {
          if (seen.has(r)) continue;
          const dx = px - r.x, dz = pz - r.z, d = Math.hypot(dx, dz);
          // (in reach, and seen from the street side of its wall)
          if (d > REACH || dx * r.nx + dz * r.nz > 1.5) continue;
          seen.add(r);
          r.dist = d;
          near.push(r);
        }
      }
    }
    near.sort((a, b) => a.dist - b.dist);
    // what doesn't fit keeps its painted glass: the glass is left out only as far as the rooms go
    let reach = GLASS;
    if (near.length > BUDGET.rooms) { reach = Math.min(GLASS, near[BUDGET.rooms].dist - 2); near.length = BUDGET.rooms; }
    for (const k of kinds.values()) k.count = 0;
    let nPanes = 0, nPeople = 0;
    const keep = new Map();
    for (const r of near) {
      const k = kindOf(r.kitName);
      if (k.count >= k.cap) { reach = Math.min(reach, r.dist - 2); continue; }
      const open = r.openAt <= shares[r.type] - 0.001 ? 1 : 0;
      const a = k.array, o = k.count++ * STRIDE;
      a[o] = r.x; a[o + 1] = r.y; a[o + 2] = r.z; a[o + 3] = r.mirror;
      a[o + 4] = r.ux; a[o + 5] = r.uz; a[o + 6] = r.halfW; a[o + 7] = r.depth;
      a[o + 8] = r.height; a[o + 9] = open; a[o + 10] = r.hideLeft; a[o + 11] = r.hideRight;
      a[o + 12] = r.wall; a[o + 13] = r.floor; a[o + 14] = r.accent; a[o + 15] = r.light;
      a[o + 16] = 1.7 * r.day; a[o + 17] = 1.15 * r.night; a[o + 18] = r.floorKind; a[o + 19] = r.wallKind;
      const q = nPanes++ * 8;
      paneArray[q] = r.x; paneArray[q + 1] = r.y - 0.05; paneArray[q + 2] = r.z; paneArray[q + 3] = r.bay.width;
      paneArray[q + 4] = r.ux; paneArray[q + 5] = r.uz; paneArray[q + 6] = Math.min(2.8, r.height - 0.15); paneArray[q + 7] = 0;
      if (open && nPeople < BUDGET.people) {
        const spots = peopleFor(r, k, hour, weekend, BUDGET.people - nPeople);
        for (const sp of spots) {
          const id = r.bay.row * 100000 + r.bay.col * 1000 + sp.i;
          let person = active.find((p) => p.id === id);
          if (!person) {
            const seed = hash(r.bay.biz + sp.i * 13.7, r.bay.col + 1.3), female = hash(seed, 2.2) < 0.5, hair = hash(seed, 3.3);
            person = { id, room: r, spot: sp, phase: hash(seed, 5.5), x: 0, z: 0, yaw: 0, rx: 1, rz: 0, posed: -99,
              rig: new PersonRig({ seed: seed * 977 + 0.13, female, scale: (female ? 0.91 : 0.97) + hash(seed, 4.4) * 0.09, girth: 0.9 + hash(seed, 6.6) * 0.22,
                hair: female ? (hair < 0.68 ? 1 : 0.3 + hair * 0.25) : hair < 0.08 ? 1 : hair * 0.35 }) };
            // (staff in plain dark clothes mostly; nobody in a backpack look matters here)
            place(r, sp, person);
          }
          keep.set(id, person);
          nPeople++;
        }
      }
    }
    active.length = 0;
    for (const p of keep.values()) active.push(p);
    for (const k of kinds.values()) {
      k.g.instanceCount = k.count;
      k.mesh.visible = k.count > 0;
      if (k.count) { k.buffer.clearUpdateRanges(); k.buffer.addUpdateRange(0, k.count * STRIDE); k.buffer.needsUpdate = true; }
    }
    paneGeo.instanceCount = nPanes;
    panes.visible = nPanes > 0;
    if (nPanes) { paneBuffer.clearUpdateRanges(); paneBuffer.addUpdateRange(0, nPanes * 8); paneBuffer.needsUpdate = true; }
    cityUniforms.uShopGlass.value = Math.max(0, reach);
    shownCount = nPanes;
  }

  function update(dt, cam, cam2 = null) {
    if (!on) return;
    clock += dt;
    frame++;
    const glow = cityUniforms.uInteriorGlow.value;
    uNight.value = smooth((glow - 0.35) / 0.8);
    uPeopleLight.value.setRGB(1, 0.93, 0.82).multiplyScalar(0.6 + 0.02 * uNight.value);
    const hour = shopHour();
    const moved = Math.hypot(cam.x - lastX, cam.z - lastZ);
    if (moved > 2.5 || hour !== lastHour || clock - lastAt > 2) {
      lastX = cam.x; lastZ = cam.z; lastHour = hour; lastAt = clock;
      refresh(cam.x, cam.z, cam2 ? cam2.x : null, cam2 ? cam2.z : null);
    }
    crowd.begin();
    for (let i = 0; i < active.length; i++) {
      const p = active[i], r = p.room;
      let d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (cam2) d = Math.min(d, Math.hypot(p.x - cam2.x, p.z - cam2.z));
      // (the far ones move a few times a second)
      if (d < 26 || (frame + i) % 5 === 0 || p.posed < 0) {
        const sp = p.spot;
        let off = 0;
        if (sp.roam) {
          // along the counter and back, stopping at each end
          const u = clock * 0.11 + p.phase * 7, k = u - Math.floor(u);
          off = sp.roam * (k < 0.5 ? smooth((k - 0.1) / 0.25) * 2 - 1 : 1 - smooth((k - 0.6) / 0.25) * 2);
        }
        root.position.set(p.x + p.rx * off, r.y, p.z + p.rz * off);
        root.rotation.set(0, p.yaw, 0);
        p.rig.perch(root, poseOf(p, clock));
        p.posed = frame;
      }
      crowd.add(p.rig, d);
    }
    crowd.end();
  }

  return {
    rooms,
    update,
    // (for looking at them and measuring: main.js)
    setShown(v) {
      on = v;
      for (const k of kinds.values()) k.mesh.visible = v && k.count > 0;
      panes.visible = v;
      for (const m of crowd.meshes) m.visible = v;
      if (!v) cityUniforms.uShopGlass.value = 0;
      lastAt = -99; lastX = Infinity;
    },
    stats: () => `${shownCount} rooms, ${active.length} people, ${[...kinds.values()].filter((k) => k.count).length} kinds`
  };
}

export { SHOP };
