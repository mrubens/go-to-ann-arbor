import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log } from '../lamp-game.js';
import { groundHeight, groundUnderStreets, tessellate, drawOver, footbridgeTop } from './terrain.js';
import { splitByCell } from './merge-static.js';
import { nearestRoads } from './city-config.js';
import { GEO } from './city-geodata.js';
import { LIFT } from './ground-lifts.js';
import { TIER } from './device-tier.js';
import { B2B_ROUTE, b2bPlaces, b2bMiles, placesFrom } from './b2b-route.js';

// Lamp: the Border to Border Trail's own look (b2b-route.js, OpenStreetMap's route relation 38467), over the paths
// GEO.trails already lays (golf.js buildTrails) and the footbridges river.js builds: its ten feet of asphalt laid fresh
// along its own path, smoothed round the river's bends, darker in the wheel tracks and greyed at its crumbling edges,
// with a dashed yellow centre line (concrete where OSM says so, in slabs, unpainted); the county's green wayfinding
// signs at the places along it, each face giving the places ahead that way and how far by the trail; and a small
// numbered B2B mile marker every half mile. All of it merged, cut into 300 m squares hidden by distance: two draws a square.

const SURF = LIFT.lawn + 0.095; // over the trail ribbon under it (LAWN_Y + 0.038) and the lots and paved yards it runs over
const DASH = 12; // the texture's length along the trail: a 3 m dash, 9 m gap
const HALF_MILE = 804.67; // the mile markers' spacing
// how far off it's drawn: nearer on a phone or the Xbox, whose frame is held up by each draw
const LEAN = TIER.name === 'phone';
const SURFACE_REACH = LEAN ? 260 : 420, SIGN_REACH = LEAN ? 140 : 240;

// where the trail meets a street nothing of it is laid on the street
// a street the trail crosses at (x, z), going (tx, tz): its middle within the street's half width, the street's line
// more than 30 degrees across the trail's (one running along it, a park drive or a lot's aisle, doesn't cut it)
function crossesRoad(x, z, tx, tz) {
  for (const n of nearestRoads(x, z, 30)) {
    if (n.dist >= (n.road.w || 0) / 2 + 0.3) continue;
    const P = n.road.pts;
    let best = Infinity, dot = 1;
    for (let i = 0; i + 1 < P.length; i++) {
      const ex = P[i + 1].x - P[i].x, ez = P[i + 1].z - P[i].z, l2 = ex * ex + ez * ez || 1;
      const f = Math.max(0, Math.min(1, ((x - P[i].x) * ex + (z - P[i].z) * ez) / l2));
      const d = Math.hypot(P[i].x + ex * f - x, P[i].z + ez * f - z);
      if (d < best) { best = d; dot = Math.abs((ex * tx + ez * tz) / Math.sqrt(l2)); }
    }
    if (dot < 0.866) return true;
  }
  return false;
}
const onRoad = (x, z, pad) => nearestRoads(x, z, 30).some((n) => n.dist < (n.road.w || 0) / 2 + pad);

// inside the town's edge, where its ground is built (GEO.edge): the countryside past it is the far ground
const EDGE = GEO.edge || [];
const inTown = (x, z) => EDGE.length < 6 || inRing(EDGE, x, z);

function inRing(r, x, z) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// a line's corners rounded (Chaikin, twice), its ends kept: OSM's points are tens of metres apart round the bends
function smooth(pts, n = 2) {
  let p = pts;
  for (let k = 0; k < n && p.length > 2; k++) {
    const out = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      if (i > 0) out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      if (i + 2 < p.length) out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// --- The surface's textures: across it (u, 0..1) and along it (v, DASH m)
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function asphaltTexture() {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W;
    // the wheel tracks a shade darker, the edges weathered pale and ragged
    const track = Math.exp(-(((u - 0.3) / 0.09) ** 2)) + Math.exp(-(((u - 0.7) / 0.09) ** 2));
    const edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.07);
    let v = 58 - track * 6 + edge * 15 + (rand() - 0.5) * 14;
    if (rand() < 0.04) v += 20; // pale stone in the mix
    const o = (y * W + x) * 4;
    d[o] = v; d[o + 1] = v * 1.01; d[o + 2] = v * 1.03; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a crumbled edge: bites of the grey edge darker where it's broken up
  for (let k = 0; k < 90; k++) {
    const x = rand() < 0.5 ? rand() * 6 : W - rand() * 6, y = rand() * H;
    g.fillStyle = `rgba(52, 50, 46, ${0.35 + rand() * 0.4})`;
    g.beginPath(); g.ellipse(x, y, 1 + rand() * 3, 2 + rand() * 6, 0, 0, Math.PI * 2); g.fill();
  }
  // a sealed crack or two across it
  g.strokeStyle = 'rgba(28, 28, 28, 0.55)'; g.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    let x = 0, y = rand() * H;
    g.beginPath(); g.moveTo(x, y);
    while (x < W) { x += 6 + rand() * 10; y += (rand() - 0.5) * 8; g.lineTo(x, y); }
    g.stroke();
  }
  // the dashed yellow centre line, 10 cm wide: a 3 m dash of the 12, its paint worn a little
  const lw = Math.max(3, Math.round(W * 0.1 / 3.05)), x0 = W / 2 - lw / 2;
  for (let y = 0; y < H * 3 / DASH; y++) {
    g.fillStyle = `rgba(228, 182, 36, ${0.82 + rand() * 0.18})`;
    g.fillRect(x0, y, lw, 1);
  }
  return texture(c);
}
function concreteTexture() {
  const W = 128, H = 512;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, edge = Math.max(0, 1 - Math.min(u, 1 - u) / 0.04);
    const v = 168 + (rand() - 0.5) * 14 - edge * 16;
    const o = (y * W + x) * 4;
    d[o] = v; d[o + 1] = v * 0.985; d[o + 2] = v * 0.95; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a joint across it every 3 m, sawn, and a tooled one down the middle
  g.fillStyle = 'rgba(70, 68, 64, 0.8)';
  for (let k = 0; k < DASH / 3; k++) g.fillRect(0, Math.round(k * H * 3 / DASH), W, 2);
  g.fillStyle = 'rgba(90, 88, 84, 0.5)'; g.fillRect(W / 2 - 1, 0, 2, H);
  return texture(c);
}

// Where the surface is laid, for what stands and rides on it (`b2bTop`): its strips by 8 m cell, each [ax, az, bx, bz,
// half its width]
const LAID_CELL = 8;
let laid = new Map();
function addLaid(ax, az, bx, bz, half) {
  const seg = [ax, az, bx, bz, half], pad = half + 1;
  for (let ix = Math.floor((Math.min(ax, bx) - pad) / LAID_CELL); ix <= Math.floor((Math.max(ax, bx) + pad) / LAID_CELL); ix++) {
    for (let iz = Math.floor((Math.min(az, bz) - pad) / LAID_CELL); iz <= Math.floor((Math.max(az, bz) + pad) / LAID_CELL); iz++) {
      const key = ix * 100003 + iz;
      let c = laid.get(key);
      if (!c) laid.set(key, (c = []));
      c.push(seg);
    }
  }
}
/**
 * The top of the trail's surface at (x, z) where it's laid: SURF over the ground across its width, easing down to the
 * ground over 0.5 m past its edge (so wheels roll on and off it), else -Infinity. What's on it stands on this, as on a
 * sidewalk: the player (controllers.js getGroundHeight), the walkers (pedestrian-system.js), the trail's riders and geese
 */
function b2bTop(x, z) {
  const c = laid.get(Math.floor(x / LAID_CELL) * 100003 + Math.floor(z / LAID_CELL));
  if (!c) return -Infinity;
  let best = Infinity, half = 0;
  for (const [ax, az, bx, bz, h] of c) {
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const f = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const d = Math.hypot(x - ax - ex * f, z - az - ez * f) - h;
    if (d < best) { best = d; half = h; }
  }
  if (best > 0.5) return -Infinity;
  // (on the ground under a street's bridge it passes beneath, as under Broadway: not up on the street's deck)
  return groundUnderStreets(x, z) + SURF * Math.min(1, 1 - best / 0.5);
}

// --- The surface: along each of the trail's own (not bridged) ways, a strip its width every metre, cut where it crosses
// a street or meets a footbridge and where it leaves the town's ground; laid over the parking lots it runs through or
// beside (OSM's lot outlines often take in the path's edge); flat at SURF, then laid on the ground (drapeGeometry)
function surfaces() {
  laid = new Map();
  const asphalt = { pos: [], uv: [] }, concrete = { pos: [], uv: [] };
  let length = 0;
  for (const w of B2B_ROUTE) {
    if (!w.own || w.bridge || w.pts.length < 2) continue;
    const half = w.width / 2, out = w.flags & 32 ? concrete : asphalt;
    const P = smooth(w.pts);
    const S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const len = S[S.length - 1];
    if (len < 3) continue;
    const n = Math.max(1, Math.ceil(len));
    let i = 0, prev = null;
    for (let k = 0; k <= n; k++) {
      const s = (len * k) / n;
      while (i + 2 < P.length && S[i + 1] < s) i++;
      const l = S[i + 1] - S[i] || 1, f = (s - S[i]) / l;
      const x = P[i][0] + (P[i + 1][0] - P[i][0]) * f, z = P[i][1] + (P[i + 1][1] - P[i][1]) * f;
      // the heading here: the average of the segments' either side of a point, so a bend is mitred
      const j0 = Math.max(0, f < 0.02 ? i - 1 : i), j1 = Math.min(P.length - 2, f > 0.98 ? i + 1 : i);
      let tx = P[j1 + 1][0] - P[j0][0], tz = P[j1 + 1][1] - P[j0][1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      // (a street it crosses: its middle on the street; beside one, as along Fuller Rd, it's laid right up to the curb,
      // and over a park drive or lot aisle the map runs along it, as at Gallup, it's laid whole)
      const ok = inTown(x, z) && !crossesRoad(x, z, tx, tz) && footbridgeTop(x, z) === -Infinity;
      const cur = ok ? { x, z, lx: x - tz * half, lz: z + tx * half, rx: x + tz * half, rz: z - tx * half, v: s / DASH } : null;
      if (cur && prev) {
        const p = out.pos, uv = out.uv;
        p.push(prev.lx, SURF, prev.lz, cur.rx, SURF, cur.rz, prev.rx, SURF, prev.rz,
          prev.lx, SURF, prev.lz, cur.lx, SURF, cur.lz, cur.rx, SURF, cur.rz);
        uv.push(0, prev.v, 1, cur.v, 1, prev.v, 0, prev.v, 0, cur.v, 1, cur.v);
        addLaid(prev.x, prev.z, cur.x, cur.z, half);
        length += len / n;
      }
      prev = cur;
    }
  }
  return { asphalt, concrete, length };
}

// --- The signs' faces, on one atlas: a slot for the B2B marker and one per wayfinding face
const SLOT_W = 256, SLOT_H = 320, COLS = 8, ROWS = 6;
function badge(g, cx, cy, r) {
  // the trail's badge: a white disc, the river's blue waves across its foot and B2B over them
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, r - 3, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#2b78c2';
  for (let k = 0; k < 2; k++) {
    g.beginPath(); g.moveTo(cx - r, cy + r * (0.35 + k * 0.3));
    for (let x = -r; x <= r; x += 2) g.lineTo(cx + x, cy + r * (0.35 + k * 0.3) + Math.sin((x / r) * Math.PI * 2) * r * 0.08);
    g.lineTo(cx + r, cy + r); g.lineTo(cx - r, cy + r); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = '#1d4f37'; g.font = `800 ${Math.round(r * 0.72)}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('B2B', cx, cy - r * 0.12);
}
function fitText(g, text, max, size, weight = 700) {
  let s = size;
  do { g.font = `${weight} ${s}px Helvetica, Arial, sans-serif`; s -= 1; } while (g.measureText(text).width > max && s > 10);
}
// a panel's plain back and edges (slot 0): the sign's green with a pale rim, nothing written on it
function drawBack(g, x0, y0) {
  g.fillStyle = '#1d4f37'; g.fillRect(x0, y0, SLOT_W, SLOT_H);
  g.strokeStyle = 'rgba(244, 242, 234, 0.55)'; g.lineWidth = 6; g.strokeRect(x0 + 10, y0 + 10, SLOT_W - 20, SLOT_H - 20);
}
// a mile marker's face: the B2B badge, the trail's name and the mile, by the trail from its west end in town
function drawMarker(g, x0, y0, mile) {
  g.fillStyle = '#1d4f37'; g.fillRect(x0, y0, SLOT_W, SLOT_H);
  g.strokeStyle = '#f4f2ea'; g.lineWidth = 6; g.strokeRect(x0 + 8, y0 + 8, SLOT_W - 16, SLOT_H - 16);
  badge(g, x0 + SLOT_W / 2, y0 + 82, 56);
  g.fillStyle = '#f4f2ea'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  fitText(g, 'BORDER TO BORDER', SLOT_W - 44, 24, 800); g.fillText('BORDER TO BORDER', x0 + SLOT_W / 2, y0 + 168);
  fitText(g, 'TRAIL', SLOT_W - 44, 24, 800); g.fillText('TRAIL', x0 + SLOT_W / 2, y0 + 194);
  g.fillRect(x0 + 30, y0 + 210, SLOT_W - 60, 3);
  g.font = '800 22px Helvetica, Arial, sans-serif'; g.fillText('MILE', x0 + SLOT_W / 2, y0 + 240);
  const n = Math.floor(mile), half = mile - n > 0.25;
  fitText(g, `${n}${half ? '½' : ''}`, SLOT_W - 50, 64, 800);
  g.fillText(`${n}${half ? '½' : ''}`, x0 + SLOT_W / 2, y0 + 296);
}
function drawFace(g, x0, y0, here, ahead) {
  g.fillStyle = '#1d4f37'; g.fillRect(x0, y0, SLOT_W, SLOT_H);
  g.strokeStyle = '#f4f2ea'; g.lineWidth = 5; g.strokeRect(x0 + 7, y0 + 7, SLOT_W - 14, SLOT_H - 14);
  badge(g, x0 + 52, y0 + 54, 34);
  g.fillStyle = '#f4f2ea'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = '800 19px Helvetica, Arial, sans-serif';
  g.fillText('BORDER-TO-', x0 + 96, y0 + 50); g.fillText('BORDER TRAIL', x0 + 96, y0 + 72);
  let y = y0 + 104;
  if (here) {
    g.fillStyle = '#f4f2ea'; g.fillRect(x0 + 18, y - 6, SLOT_W - 36, 3);
    fitText(g, here.toUpperCase(), SLOT_W - 40, 26, 800);
    g.fillText(here.toUpperCase(), x0 + 20, y + 26);
    y += 46;
  }
  g.fillStyle = '#f4f2ea'; g.fillRect(x0 + 18, y - 6, SLOT_W - 36, 3);
  y += 8;
  for (const p of ahead.slice(0, here ? 3 : 4)) {
    const mi = p.metres / 1609.34;
    const dist = `${mi < 9.95 ? mi.toFixed(1) : Math.round(mi)} mi`;
    // an arrow straight on
    g.beginPath(); g.moveTo(x0 + 30, y + 2); g.lineTo(x0 + 40, y + 16); g.lineTo(x0 + 20, y + 16); g.closePath(); g.fill();
    g.fillRect(x0 + 27, y + 16, 6, 12);
    g.font = '700 18px Helvetica, Arial, sans-serif'; g.textAlign = 'right';
    g.fillText(dist, x0 + SLOT_W - 20, y + 24);
    const room = SLOT_W - 70 - g.measureText(dist).width - 12;
    g.textAlign = 'left'; fitText(g, p.name, room, 20, 700);
    g.fillText(p.name, x0 + 50, y + 24);
    y += 40;
  }
}

// A sign's panel, `w` by `h` and `d` thick, centred on its middle with its front facing +z: the front face is atlas
// slot `front`, the back `back` (read the right way round from behind), the four edges the plain back's green (slot 0)
function panel(w, h, front, back, d = 0.025) {
  const x = w / 2, y = h / 2, t = d / 2;
  const uvOf = (slot, u, v) => [((slot % COLS) + u) / COLS, 1 - (Math.floor(slot / COLS) + 1 - v) / ROWS];
  const pos = [], uv = [], nor = [];
  const quad = (a, b, c, e, n, uvs) => { // a, b, c, e counter-clockwise seen from the side `n` points to
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...[a, b, c, e][i]); nor.push(...n); uv.push(...uvs[i]); }
  };
  const plain = uvOf(0, 0.02, 0.02), P = [plain, plain, plain, plain];
  // the front, then the back (its corners taken the other way round, its picture's u running from the right)
  quad([-x, -y, t], [x, -y, t], [x, y, t], [-x, y, t], [0, 0, 1], [uvOf(front, 0, 0), uvOf(front, 1, 0), uvOf(front, 1, 1), uvOf(front, 0, 1)]);
  quad([x, -y, -t], [-x, -y, -t], [-x, y, -t], [x, y, -t], [0, 0, -1], [uvOf(back, 0, 0), uvOf(back, 1, 0), uvOf(back, 1, 1), uvOf(back, 0, 1)]);
  quad([x, -y, t], [x, -y, -t], [x, y, -t], [x, y, t], [1, 0, 0], P);
  quad([-x, -y, -t], [-x, -y, t], [-x, y, t], [-x, y, -t], [-1, 0, 0], P);
  quad([-x, y, t], [x, y, t], [x, y, -t], [-x, y, -t], [0, 1, 0], P);
  quad([-x, -y, -t], [x, -y, -t], [x, -y, t], [-x, -y, t], [0, -1, 0], P);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}
const place = (geo, x, y, z, yaw) => geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));

function buildB2BTrail(group) {
  group.name = 'B2BTrail';
  // --- the surface
  const { asphalt, concrete, length } = surfaces();
  const laid = [];
  for (const [part, tex, name] of [[asphalt, asphaltTexture(), 'B2BAsphalt'], [concrete, concreteTexture(), 'B2BConcrete']]) {
    if (!part.pos.length) continue;
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
    // laid on the ground, cut where it bends (terrain.js drapeGeometry), the ground under a street's bridge where it
    // passes beneath one (Broadway), not the street's deck
    geo = tessellate(geo, 0.04);
    { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + groundUnderStreets(p.getX(i), p.getZ(i))); geo.computeBoundingSphere(); }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    // drawn in front of the trail ribbon it covers (golf.js: 0.07), as if 9 cm over it
    const mat = drawOver(new THREE.MeshStandardNodeMaterial({ map: tex, roughness: name === 'B2BAsphalt' ? 0.93 : 0.88 }), 0.09);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const piece of splitByCell(mesh, 300)) { piece.userData.cullDistance = SURFACE_REACH; laid.push(piece); }
  }

  // --- the signs: a wayfinding sign at each place along it (where the trail passes nearest it), its faces giving the
  // places ahead each way; a numbered mile marker every half mile along its own path
  const [atlas, g] = canvas(SLOT_W * COLS, SLOT_H * ROWS);
  drawBack(g, 0, 0);
  let slot = 1;
  const slotAt = (k) => [(k % COLS) * SLOT_W, Math.floor(k / COLS) * SLOT_H];
  const plates = [], posts = [];
  const postGeo = (h) => new THREE.BoxGeometry(0.1, h, 0.1).translate(0, h / 2 - 0.25, 0);
  const signAt = (w, k, f, side, kind, here, mile) => {
    const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1, tx = (bx - ax) / l, tz = (bz - az) / l;
    const off = w.width / 2 + 0.9;
    let x = ax + (bx - ax) * f + -tz * off * side, z = az + (bz - az) * f + tx * off * side;
    if (onRoad(x, z, 0.6) || footbridgeTop(x, z) > -Infinity) {
      x = ax + (bx - ax) * f + tz * off * side; z = az + (bz - az) * f - tx * off * side;
      if (onRoad(x, z, 0.6) || footbridgeTop(x, z) > -Infinity) return false;
    }
    const y = groundHeight(x, z) + LIFT.lawn;
    // the plate across the trail: its front (+z) faces those coming along the way (going -t), its back those going +t
    const yaw = Math.atan2(-tx, -tz);
    if (kind === 'marker') {
      // a 4x4 post beside the trail with a 12 x 15 inch plate screwed to each of its two faces across the trail, so
      // it's read coming either way; each plate's back plain against the post, its top at 1.2 m
      if (slot + 1 > COLS * ROWS) return false;
      drawMarker(g, ...slotAt(slot), mile);
      for (const way of [-1, 1]) {
        const a = Math.atan2(tx * way, tz * way); // facing back along the trail, toward those coming the other way
        plates.push(place(panel(0.3, 0.375, slot, 0, 0.02), x + Math.sin(a) * 0.058, y + 1.01, z + Math.cos(a) * 0.058, a));
      }
      posts.push(place(postGeo(1.55), x, y, z, yaw));
      slot += 1;
    } else {
      if (slot + 2 > COLS * ROWS) return false;
      const node = f > 0.5 ? k + 1 : k;
      const fwd = placesFrom(w, node, 1), back = placesFrom(w, node, -1);
      const name = here || fwd.here[0] || null;
      // the front faces back down the way (-t), so it's read by those coming along it (+t): the places ahead of them
      drawFace(g, ...slotAt(slot), name, fwd.ahead);
      drawFace(g, ...slotAt(slot + 1), name, back.ahead);
      plates.push(place(panel(0.62, 0.775, slot, slot + 1), x, y + 1.72, z, yaw));
      // a post either side of the plate, just clear of its edges
      for (const sd of [-1, 1]) posts.push(place(postGeo(2.2), x + Math.sin(yaw + Math.PI / 2) * 0.37 * sd, y, z + Math.cos(yaw + Math.PI / 2) * 0.37 * sd, yaw));
      slot += 2;
    }
    return true;
  };
  // the wayfinding signs: where the trail's own path passes each place, 15 m on from its nearest point
  let signs = 0;
  for (const [i, p] of [...placesNear()].entries()) {
    const at = p.at;
    if (signAt(at.way, at.k, at.f, i % 2 ? 1 : -1, 'sign', p.name)) signs++;
  }
  // the mile markers: every half mile by the trail from its west end in town (b2bMiles), where each of its own ways
  // (not its bridges) passes one, alternating sides
  let markers = 0;
  const miles = b2bMiles();
  for (const w of B2B_ROUTE) {
    if (!w.own || w.bridge || w.len < 20) continue;
    const at = (s) => {
      let k = 0;
      while (k + 2 < w.pts.length && w.cum[k + 1] < s) k++;
      const f = (s - w.cum[k]) / (w.cum[k + 1] - w.cum[k] || 1);
      return { k, f, m: miles[w.nodes[k]] + (miles[w.nodes[k + 1]] - miles[w.nodes[k]]) * f };
    };
    let prev = at(5);
    for (let s2 = 7; s2 < w.len - 5; s2 += 2) {
      const cur = at(s2);
      if (Number.isFinite(prev.m) && Number.isFinite(cur.m) && Math.floor(cur.m / HALF_MILE) !== Math.floor(prev.m / HALF_MILE)) {
        const mile = Math.round(Math.max(cur.m, prev.m) / HALF_MILE) / 2;
        const [x, z] = [w.pts[cur.k][0] + (w.pts[cur.k + 1][0] - w.pts[cur.k][0]) * cur.f, w.pts[cur.k][1] + (w.pts[cur.k + 1][1] - w.pts[cur.k][1]) * cur.f];
        if (mile > 0 && inTown(x, z) && signAt(w, cur.k, cur.f, markers % 2 ? 1 : -1, 'marker', null, mile)) markers++;
      }
      prev = cur;
    }
  }
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 8;
  if (plates.length) {
    const faces = new THREE.Mesh(mergeGeometries(plates), new THREE.MeshStandardNodeMaterial({ map: atlasTex, roughness: 0.55 }));
    faces.name = 'B2BSigns';
    const wood = new THREE.Mesh(mergeGeometries(posts.map((p) => p.toNonIndexed())), new THREE.MeshStandardNodeMaterial({ color: 0x4a3a2a, roughness: 0.9 }));
    wood.name = 'B2BSignPosts';
    for (const m of [faces, wood]) {
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      for (const piece of splitByCell(m, 300)) piece.userData.cullDistance = SIGN_REACH;
    }
  }
  log(`[b2b] ${(length / 1000).toFixed(1)} km of the Border to Border Trail laid in ${laid.length} squares, ${signs} wayfinding signs, ${markers} mile markers`);
  return {};
}

// each place's sign spot: the trail's own path nearest it (b2b-route.js places), 15 m along so it stands clear of
// the junction there
function* placesNear() {
  for (const p of b2bPlaces()) {
    let best = null, bestD = 80;
    for (const w of B2B_ROUTE) {
      if (!w.own || w.bridge || w.len < 40) continue;
      for (let k = 0; k + 1 < w.pts.length; k++) {
        const d = Math.hypot(w.pts[k][0] - p.x, w.pts[k][1] - p.z);
        if (d < bestD) { bestD = d; best = { way: w, k }; }
      }
    }
    if (!best) continue;
    const w = best.way, s = Math.min(w.len - 10, Math.max(10, w.cum[best.k] + 15));
    let k = 0;
    while (k + 2 < w.pts.length && w.cum[k + 1] < s) k++;
    yield { name: p.name, at: { way: w, k, f: (s - w.cum[k]) / (w.cum[k + 1] - w.cum[k] || 1) } };
  }
}
export { buildB2BTrail, b2bTop, SURF as B2B_SURF };
