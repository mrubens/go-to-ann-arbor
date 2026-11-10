// Golf on the city's courses: walk up to a tee on foot and press get-in ("Play golf") to tee off. The player stands
// at the ball (controllers.js holds them there in `p.golf`'s pose), aims down the hole, holds swing to fill the power
// meter and lets go to hit; the ball flies, bounces and rolls by the surface it lands on (golf.js's fairways, greens,
// tees and bunkers, the rough everywhere else on the course), runs down the ground's slope and drops in the cup when it
// reaches it slowly enough. Water and out of bounds cost a stroke and are played again from where the shot was hit.
// After each hole the player goes on to the next number on that course (round to 1 after the last), and the round
// ends with the score once every hole there is played.
// Holes: Huron Hills' from golf-holes.js, every other course's from golf-courses.js (OpenStreetMap's numbered holes,
// each tee to its green as mapped), the tee and pin snapped to the mapped tee box and green nearest each end.
import * as THREE from 'three/webgpu';
import { attribute, float } from 'three/tsl';
import { hot, log, random, rumble, sound } from '../lamp-game.js';
import { setupSceneCulling } from './scene-culling.js';
import { layOutHoles } from './golf.js';
import { GOLF_HOLES } from './golf-holes.js';
import { GOLF_COURSES } from './golf-courses.js';
import { GEO } from './city-geodata.js';
import { groundHeight, waterLevel, riverDepth } from './terrain.js';

// the courses' grass is drawn over the ground a little above its height (golf.js lays it on the city's lawn): the ball,
// the markers and the aim sit on top of it
const TURF = 0.205;
const TEE_MARKS_V = 3; // raised when the tee markers and boards change, so the open game builds them again
const turf = (x, z) => groundHeight(x, z) + TURF;

const YD = 1.0936;
const BALL_R = 0.0214, CUP_R = 0.108;
// carry in metres at full power, launch angle in degrees, and how far a full shot runs on after landing on a fairway
// (a real one's roll-out: the flight here has no drag or spin, so the ball comes down far faster than a real one does,
// and the run is set from these instead of from the speed it lands with)
const CLUBS = [
  { name: 'Driver', carry: 205, launch: 13, run: 24, tee: true },
  { name: '3 Wood', carry: 185, launch: 15, run: 16 },
  { name: '5 Iron', carry: 155, launch: 20, run: 9 },
  { name: '7 Iron', carry: 135, launch: 26, run: 6 },
  { name: '9 Iron', carry: 112, launch: 34, run: 4 },
  { name: 'Wedge', carry: 85, launch: 44, run: 2.5 },
  { name: 'Sand Wedge', carry: 55, launch: 52, run: 1.5 },
  { name: 'Chip', carry: 32, launch: 40, run: 3 },
  { name: 'Putter', carry: 24, launch: 0, putt: true }
];
const PUTTER = CLUBS.length - 1, CHIP = CLUBS.length - 2, SAND = CLUBS.length - 3;
// how a ball takes each surface: bounce, how much of a club's fairway run it gets on landing there, and how hard it
// slows rolling (m/s²)
const SURFACE = {
  green: { bounce: 0.15, run: 0.7, roll: 1.5, name: 'the green' },
  fairway: { bounce: 0.32, run: 1, roll: 1.9, name: 'the fairway' },
  tee: { bounce: 0.3, run: 1, roll: 2.0, name: 'the tee' },
  rough: { bounce: 0.1, run: 0.2, roll: 9, name: 'the rough' },
  bunker: { bounce: 0, run: 0, roll: 99, name: 'a bunker' }
};
const RESULT = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' };

const hash01 = (a, b) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
function inFlat(f, x, z) {
  let inside = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const centre = (f) => { let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; } return [x / (f.length / 2), z / (f.length / 2)]; };
const lineLength = (L) => { let s = 0; for (let i = 2; i < L.length; i += 2) s += Math.hypot(L[i] - L[i - 2], L[i + 1] - L[i - 1]); return s; };
const parFor = (m) => (m < 215 ? 3 : m < 420 ? 4 : 5);
function distToLine(L, x, z) {
  let best = Infinity;
  for (let i = 2; i < L.length; i += 2) {
    const ax = L[i - 2], az = L[i - 1], dx = L[i] - ax, dz = L[i + 1] - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return best;
}

// The holes and the surfaces they're played on, worked out once from the course data
let COURSE = null;
function course() {
  if (COURSE?.v === 4) return COURSE;
  const golf = GEO.golf ? layOutHoles(GEO.golf) : { greens: [], tees: [], bunkers: [], fairways: [], pins: [] };
  const holes = [];
  // Huron Hills, as mapped: the tee 4 m along each hole's line, the pin as golf.js places it on the green
  let hx0 = Infinity, hx1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
  for (const h of GOLF_HOLES) {
    const L = h.line, n = L.length;
    for (let i = 0; i < n; i += 2) { hx0 = Math.min(hx0, L[i]); hx1 = Math.max(hx1, L[i]); hz0 = Math.min(hz0, L[i + 1]); hz1 = Math.max(hz1, L[i + 1]); }
    const ta = Math.atan2(L[3] - L[1], L[2] - L[0]), gx = L[n - 2], gz = L[n - 1], r = hash01(gx, gz);
    const tee = [L[0] + Math.cos(ta) * 4, L[1] + Math.sin(ta) * 4], pin = [gx + (r - 0.5) * 5, gz + (hash01(gz, gx) - 0.5) * 4];
    holes.push({ ref: Number(h.ref) || holes.length + 1, course: 'hh', tee, pin, line: [tee[0], tee[1], ...L.slice(2, -2), pin[0], pin[1]], par: h.par || parFor(lineLength(L)) });
  }
  // every other course's numbered holes, as mapped: the tee on the mapped tee box nearest the hole's start,
  // the pin on the green nearest its end (the line's own ends where the map has none there)
  const teeAt = golf.tees.map((r) => centre(r[0]));
  const nearest = (pts, x, z, r) => { let best = null, bd = r; for (const q of pts) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; best = q; } } return best; };
  const pinAt = [];
  for (let i = 0; i < golf.pins.length; i += 2) pinAt.push([golf.pins[i], golf.pins[i + 1]]);
  const sizes = {};
  for (const c of GOLF_COURSES) {
    for (const h of c.holes) {
      const L = h.line, n = L.length;
      const tee = [...(nearest(teeAt, L[0], L[1], 35) || [L[0], L[1]])], pin = [...(nearest(pinAt, L[n - 2], L[n - 1], 40) || [L[n - 2], L[n - 1]])];
      holes.push({ ref: Number(h.ref) || c.holes.indexOf(h) + 1, course: c.name, tee, pin, line: [tee[0], tee[1], ...L.slice(2, -2), pin[0], pin[1]], par: h.par || parFor(lineLength(L)) });
    }
    sizes[c.name] = c.holes.length;
  }
  const ring = (rings) => rings.map((r) => {
    const f = r[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]); }
    return { f, x0, x1, z0, z1 };
  });
  COURSE = { v: 4, holes, greens: ring(golf.greens), bunkers: ring(golf.bunkers), tees: ring(golf.tees), fairways: ring(golf.fairways) };
  log(`[golf] ${holes.length} holes to play: Huron Hills ${GOLF_HOLES.length}, ${Object.entries(sizes).map(([k, v]) => `${k.replace(/ (Golf|Country) .*/, '')} ${v}`).join(', ')}`);
  return COURSE;
}
function surfaceAt(x, z) {
  const c = course();
  const hit = (list) => list.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && inFlat(r.f, x, z));
  if (hit(c.greens)) return 'green';
  if (hit(c.bunkers)) return 'bunker';
  if (hit(c.tees)) return 'tee';
  if (hit(c.fairways)) return 'fairway';
  return 'rough';
}
function inWater(x, z) {
  const level = waterLevel(x, z);
  return level != null && riverDepth(x, z) > 0.08 && groundHeight(x, z) < level;
}

// a club's sound: a sharp click over a short burst of air for a full shot, a soft tock for a putt; and the ball rattling
// into the cup
// a club meeting the ball: a hard click as the face hits, a short bright metallic ring from the clubhead (a few
// partials that don't share a root, as struck steel and titanium don't), a dry crack under it, then the air
// tearing as the ball leaves; a putt is a soft, low, wooden "tock" with almost no ring and no air
function strikeSound(putt) {
  const R = 48000, n = Math.round(R * (putt ? 0.12 : 0.42)), out = new Float32Array(n);
  let s = 0x1234567, lo = 0, bp = 0, hp = 0;
  const ring = putt ? [[1180, 120, 0.5], [2650, 220, 0.18]] : [[1720, 46, 0.32], [3140, 62, 0.26], [4630, 85, 0.2], [6900, 130, 0.12]];
  for (let i = 0; i < n; i++) {
    const t = i / R;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const noise = ((s >>> 0) / 4294967296) * 2 - 1;
    // the click: a few hundredths of a millisecond of bright noise
    const click = noise * Math.exp(-t * (putt ? 900 : 1400)) * (putt ? 0.5 : 0.9);
    let v = 0;
    for (const [hz, k, a] of ring) v += Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * k) * a;
    // the crack: low-passed noise, quick
    lo += (noise - lo) * (putt ? 0.08 : 0.25);
    const crack = lo * Math.exp(-t * (putt ? 140 : 60)) * (putt ? 0.9 : 1.2);
    // the air: noise band-passed round 1.5-3 kHz, swelling just after the hit and dying away
    hp = noise - bp; bp += hp * 0.32;
    const air = putt ? 0 : (noise - bp) * 0.5 * (1 - Math.exp(-t * 60)) * Math.exp(-t * 9) * 0.22;
    out[i] = Math.tanh((click + v + crack + air) * 1.4) * 0.75;
  }
  return sound.samples(out, R, putt ? 'putt' : 'club');
}
function cupSound() {
  const n = Math.round(48000 * 0.45), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 48000;
    let v = 0;
    for (const [at, hz, k] of [[0, 520, 1], [0.11, 610, 0.7], [0.19, 470, 0.5], [0.25, 560, 0.35]]) {
      if (t >= at) v += Math.sin(2 * Math.PI * hz * (t - at)) * Math.exp(-(t - at) * 38) * k;
    }
    out[i] = v * 0.5;
  }
  return sound.samples(out, 48000, 'cup');
}

// two indexed shapes with the same attributes as one
function mergeTwo(a, b) {
  const out = new THREE.BufferGeometry(), na = a.attributes.position.count;
  for (const k of ['position', 'normal', 'uv']) {
    const A = a.attributes[k].array, B = b.attributes[k].array, C = new Float32Array(A.length + B.length);
    C.set(A); C.set(B, A.length);
    out.setAttribute(k, new THREE.BufferAttribute(C, a.attributes[k].itemSize));
  }
  const ia = a.index.array, ib = b.index.array, idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + na;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  a.dispose(); b.dispose();
  return out;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class GolfPlay {
  constructor({ scene, cm, cameraSystem, notice, soundOn, onChange }) {
    this.scene = scene;
    this.cm = cm;
    this.cameraSystem = cameraSystem;
    this.notice = notice;
    this.soundOn = soundOn;
    this.onChange = onChange;
    this.on = null; // the round being played
    this.sounds = { v: 2, club: strikeSound(false), putt: strikeSound(true), cup: cupSound() };
    this.build();
  }

  build() {
    const g = this.group = new THREE.Group();
    g.name = 'GolfPlay';
    g.visible = false;
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x9a9a9a });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), white);
    this.ball.castShadow = true;
    // the club: a steel shaft with a black grip and a head
    const club = this.club = new THREE.Group();
    const steel = new THREE.MeshStandardNodeMaterial({ color: 0xc9ccd0, metalness: 0.9, roughness: 0.3 });
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x1b1b1d, roughness: 0.7 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0075, 1, 8).translate(0, 0.5, 0), steel);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.011, 0.26, 10).translate(0, 0.13, 0), black);
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.06).translate(0.035, 0, 0), steel);
    shaft.castShadow = grip.castShadow = this.head.castShadow = true;
    club.add(shaft, grip, this.head);
    this.shaft = shaft;
    // the aim: a line of dots along the ground to where a full shot comes down, and a ring there
    const DOTS = this.DOTS = 28;
    const dot = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
    const aimMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.dots = new THREE.InstancedMesh(dot, aimMat, DOTS);
    this.dots.frustumCulled = false;
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), aimMat);
    // the shot's tracer: a line of bright beads along the way the ball went, so it's easy to follow against the sky
    g.add(this.ball, club, this.dots, this.mark);
    this.scene.add(g);
    this.buildTeeMarks();
    // the hole, the stroke and the club, in plain words under the place signs; the power meter under it while swinging
    const line = this.line = document.createElement('div');
    line.className = 'golf-line';
    line.innerHTML = '<div class="golf-words"></div><div class="golf-meter"><i></i></div>';
    document.body.appendChild(line);
    this.words = line.firstChild;
    this.meter = line.lastChild.firstChild;
  }

  // Every hole's tee shows where to play from: a pair of blue tee markers either side of where the ball goes down, and
  // a post at the back with a dark green board facing back up the way players come. Two instanced draws for every course.
  buildTeeMarks() {
    const holes = course().holes, n = holes.length;
    const g = this.teeMarks = new THREE.Group();
    g.name = 'GolfTeeMarks';
    if (!n) { this.scene.add(g); return; }
    const marker = new THREE.SphereGeometry(0.16, 20, 14).translate(0, 0.13, 0);
    const markers = new THREE.InstancedMesh(marker, new THREE.MeshStandardNodeMaterial({ color: 0x1f5fd0, roughness: 0.35 }), n * 2);
    // the post and its board as one shape: a white post 1.3 m tall, the board across its top
    const post = new THREE.CylinderGeometry(0.035, 0.04, 1.3, 10).translate(0, 0.65, 0);
    const board = new THREE.BoxGeometry(0.84, 0.56, 0.04, 2, 2, 1).translate(0, 1.22, -0.045);
    const sign = mergeTwo(post, board);
    const signs = new THREE.InstancedMesh(sign, new THREE.MeshStandardNodeMaterial({ roughness: 0.6 }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const white = new THREE.Color(0xf2f2ee), green = new THREE.Color(0x1d4d2b);
    holes.forEach((h, i) => {
      const [tx, tz] = h.tee, dx = h.line[2] - tx, dz = h.line[3] - tz, L = Math.hypot(dx, dz) || 1;
      const fx = dx / L, fz = dz / L, ax = -fz, az = fx; // down the hole, and across it
      q.setFromAxisAngle(_up, Math.atan2(fx, fz));
      for (const side of [-1, 1]) {
        const x = tx + ax * side * 2.6 + fx * 0.6, z = tz + az * side * 2.6 + fz * 0.6;
        markers.setMatrixAt(i * 2 + (side > 0), m.compose(p.set(x, turf(x, z) - 0.02, z), q, s));
      }
      const x = tx - fx * 3.5 - ax * 3.2, z = tz - fz * 3.5 - az * 3.2;
      signs.setMatrixAt(i, m.compose(p.set(x, turf(x, z), z), q, s));
    });
    // the post white, its board green: the colour goes by height in the shape
    const col = new Float32Array(sign.attributes.position.count * 3), pos = sign.attributes.position;
    for (let v = 0; v < pos.count; v++) (pos.getY(v) > 0.9 && pos.getZ(v) < -0.02 ? green : white).toArray(col, v * 3);
    sign.setAttribute('color', new THREE.BufferAttribute(col, 3));
    signs.material.vertexColors = true;
    markers.castShadow = signs.castShadow = true;
    for (const im of [markers, signs]) { im.computeBoundingSphere(); g.add(im); }
    g.add(this.teeFaces(holes));
    // hidden once the player is well away from the course, as the town's small things are (scene-culling.js), rather
    // than drawn whenever any of it is in view: cut into squares where a course's tees spread wide
    for (const o of g.children) o.userData.cullDistance = 400;
    setupSceneCulling(g, [g]);
    this.teeMarksV = TEE_MARKS_V;
    this.scene.add(g);
  }

  // What each tee's board says, painted into one sheet: the hole's number, its par (the course's scorecard) and its
  // length as played. All the boards' faces are one draw.
  teeFaces(holes) {
    const n = holes.length, COLS = 10, CW = 204, CH = 136, rows = Math.ceil(n / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CW; canvas.height = rows * CH;
    const c = canvas.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    holes.forEach((h, i) => {
      const x0 = (i % COLS) * CW, y0 = Math.floor(i / COLS) * CH;
      c.fillStyle = '#1d4d2b'; c.fillRect(x0, y0, CW, CH);
      c.strokeStyle = '#f2f2ee'; c.lineWidth = 4; c.strokeRect(x0 + 8, y0 + 8, CW - 16, CH - 16);
      c.fillStyle = '#f2f2ee';
      const yd = Math.round(lineLength(h.line) * YD);
      const big = `HOLE ${h.ref}`, small = `PAR ${h.par} · ${yd} YDS`;
      c.font = '700 44px system-ui, sans-serif'; c.fillText(big, x0 + CW / 2, y0 + 56, CW - 30);
      c.font = '600 24px system-ui, sans-serif'; c.fillText(small, x0 + CW / 2, y0 + 100, CW - 30);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // a face on the back of each board, toward the way players come up to the tee
    const pos = [], uv = [], idx = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const W = 0.78, H = 0.52, Y = 1.22, Z = -0.066;
    holes.forEach((h, i) => {
      const [tx, tz] = h.tee, dx = h.line[2] - tx, dz = h.line[3] - tz, L = Math.hypot(dx, dz) || 1;
      const fx = dx / L, fz = dz / L, ax = -fz, az = fx;
      const x = tx - fx * 3.5 - ax * 3.2, z = tz - fz * 3.5 - az * 3.2;
      q.setFromAxisAngle(_up, Math.atan2(fx, fz));
      m.compose(v.set(x, turf(x, z), z), q, one);
      const u0 = (i % COLS) / COLS, u1 = u0 + 1 / COLS, v1 = 1 - Math.floor(i / COLS) / rows, v0 = v1 - 1 / rows;
      const base = pos.length / 3;
      // looking at it from behind the tee (toward +Z), local +X is on the left: the text starts there
      for (const [lx, ly, uu, vv] of [[W / 2, Y - H / 2, u0, v0], [-W / 2, Y - H / 2, u1, v0], [-W / 2, Y + H / 2, u1, v1], [W / 2, Y + H / 2, u0, v1]]) {
        v.set(lx, ly, Z).applyMatrix4(m);
        pos.push(v.x, v.y, v.z); uv.push(uu, vv);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const faces = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
    faces.name = 'GolfTeeBoards';
    return faces;
  }

  dispose() {
    this.teeMarks?.removeFromParent();
    this.teeMarks?.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.group.removeFromParent();
    this.group.traverse((o) => { o.geometry?.dispose(); });
    this.line.remove();
    // the round goes with this copy (a live change's new one takes it up from the snapshot): its window listeners and
    // the pin's pointer go too, or the old ones would keep catching presses and leave a pointer frozen on the screen
    this.on = null;
    this.listening?.abort();
    this.listening = null;
    this.mouseBound = this.escapeBound = false;
    this.pinTag?.remove();
    this.pinTag = null;
    if (this.cameraSystem.override === this.camHook) this.cameraSystem.override = null;
    const p = this.cm.entities.person;
    if (p.golf) p.golf = null;
  }

  get active() { return !!this.on; }

  // the hole whose tee is under or beside the player
  teeNear(x, z) {
    const holes = course().holes;
    let best = -1, bd = 9;
    for (let i = 0; i < holes.length; i++) {
      const d = Math.hypot(holes[i].tee[0] - x, holes[i].tee[1] - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  start(i) {
    const holes = course().holes, h = holes[i];
    if (!h) return;
    this.on = { course: h.course, played: [], card: [], hole: i, strokes: 0, phase: 'address', power: 0, rising: true, t: 0,
      ball: { x: h.tee[0], y: 0, z: h.tee[1], vx: 0, vy: 0, vz: 0 }, from: { x: h.tee[0], z: h.tee[1] }, aim: 0, club: 0, held: false, wait: 0 };
    this.beginHole(i, true);
    this.group.visible = true;
    this.camHook = this.camHook || ((dt, pos, look) => this.camera(dt, pos, look));
    this.cameraSystem.override = this.camHook;
    log(`[golf] teed off at ${h.course === 'hh' ? 'Huron Hills' : h.course}, hole ${h.ref} (par ${h.par}, ${Math.round(lineLength(h.line) * YD)} yd)`);
    this.onChange?.();
  }

  quit(words) {
    if (!this.on) return;
    const p = this.cm.entities.person;
    if (p.golf) {
      p.golf = null;
      // a step back from the ball, facing down the hole
      const a = this.on.aim;
      p.heading = Math.atan2(Math.cos(a) * 1, Math.sin(a));
      if (p.rig) p.rig.placed = false;
    }
    this.on = null;
    this.group.visible = false;
    this.line.classList.remove('show');
    if (this.cameraSystem.override === this.camHook) { this.cameraSystem.override = null; this.cameraSystem.followEntity = null; }
    if (words) this.notice(words, 3);
    log('[golf] stopped playing');
    this.onChange?.();
  }

  hole() { return course().holes[this.on.hole]; }
  holeNumber() {
    const h = this.hole();
    return h.ref || this.on.played.length + 1;
  }

  beginHole(i, first) {
    const o = this.on, h = course().holes[i];
    o.hole = i;
    o.strokes = 0;
    o.ball.x = h.tee[0]; o.ball.z = h.tee[1];
    o.ball.y = turf(h.tee[0], h.tee[1]) + BALL_R;
    o.ball.vx = o.ball.vy = o.ball.vz = 0;
    this.address();
    this.notice(`Hole ${this.holeNumber()} · Par ${h.par} · ${Math.round(lineLength(h.line) * YD)} yards`, first ? 3 : 2.6);
  }

  // the ball at rest: the player steps up to it with the club for the distance and lie, aimed down the hole
  address() {
    const o = this.on, h = this.hole(), b = o.ball;
    o.phase = 'address';
    o.planted = null;
    o.frozenR = 0;
    o.power = 0;
    o.t = 0;
    o.from.x = b.x; o.from.z = b.z;
    const toPin = Math.hypot(h.pin[0] - b.x, h.pin[1] - b.z);
    const lie = o.strokes === 0 ? 'tee' : surfaceAt(b.x, b.z);
    o.lie = lie;
    // putting on the green and its edge; otherwise the reach from this lie, and the shot starts at the pin or the reach
    o.putt = lie === 'green' || (toPin < 16 && lie !== 'bunker' && lie !== 'rough');
    o.max = o.putt ? 30 : lie === 'tee' ? 205 : lie === 'fairway' ? 185 : lie === 'bunker' ? 90 : 155;
    o.min = o.putt ? 0.5 : 5;
    o.dist = Math.max(o.min, Math.min(o.max, toPin));
    o.club = this.clubFor(o.dist);
    o.aim = this.aimFor(o.dist);
    o.pulse = 0;
    o.held = false;
    this.place();
    this.drawAim();
    this.words.textContent = '';
    this.line.classList.add('show');
    this.say();
  }

  // straight at the pin when it's within reach, else at the hole's line where this club comes down (a dogleg's corner)
  aimFor(carry) {
    const o = this.on, h = this.hole(), b = o.ball, L = h.line;
    if (Math.hypot(h.pin[0] - b.x, h.pin[1] - b.z) <= carry * 1.1 || L.length <= 4) return Math.atan2(h.pin[1] - b.z, h.pin[0] - b.x);
    // the first point along the line that far from the ball
    for (let i = 2; i < L.length; i += 2) {
      const ax = L[i - 2], az = L[i - 1], bx = L[i], bz = L[i + 1];
      for (let t = 0; t <= 1; t += 0.05) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (Math.hypot(x - b.x, z - b.z) >= carry) {
          // only points past the ball along the hole
          if ((x - b.x) * (h.pin[0] - b.x) + (z - b.z) * (h.pin[1] - b.z) > 0) return Math.atan2(z - b.z, x - b.x);
        }
      }
    }
    return Math.atan2(h.pin[1] - b.z, h.pin[0] - b.x);
  }

  // the club for a shot this far: the shortest that reaches it (the sand wedge only out of a bunker, the driver only
  // off the tee)
  clubFor(d) {
    const o = this.on;
    if (o.putt) return PUTTER;
    for (let k = CHIP; k >= 0; k--) {
      if (k === SAND && o.lie !== 'bunker') continue;
      if (CLUBS[k].tee && o.lie !== 'tee') continue;
      if (CLUBS[k].carry >= d) return k;
    }
    return o.lie === 'tee' ? 0 : 1;
  }

  // the landing circle's size now: it grows and shrinks while swing is held, and is widest at rest; wider the longer the
  // shot and from the rough or sand
  circleR() {
    const o = this.on, d = o.dist;
    if (o.frozenR) return o.frozenR;
    const lieK = o.lie === 'rough' ? 1.5 : o.lie === 'bunker' ? 1.8 : o.lie === 'tee' ? 0.9 : 1;
    const lo = (o.putt ? 0.06 + d * 0.015 : 0.6 + d * 0.02) * lieK, hi = (o.putt ? 0.3 + d * 0.12 : 2 + d * 0.15) * lieK;
    const u = o.held ? 0.5 + 0.5 * Math.cos(o.pulse * Math.PI * 2 / 1.1) : 1;
    return lo + (hi - lo) * u;
  }

  say() {
    const o = this.on, h = this.hole(), b = o.ball;
    const yd = Math.round(Math.hypot(h.pin[0] - b.x, h.pin[1] - b.z) * YD);
    const lie = o.strokes && (o.lie === 'rough' || o.lie === 'bunker') ? ` · In ${SURFACE[o.lie]?.name || 'the rough'}` : '';
    const shot = Math.round((o.dist || 0) * YD);
    const text = `Hole ${this.holeNumber()} · Par ${h.par} · ${yd === 0 ? 'At the pin' : `${yd} yd to the pin`} · Stroke ${o.strokes + 1} · ${o.putt ? `${Math.round((o.dist || 0) * 3.281)} ft` : `${shot} yd`} shot${lie}`;
    if (this.words.textContent !== text) this.words.textContent = text;
  }

  // the player beside the ball, the club's head behind it; how far the club is drawn back says the pose
  swingFrame(phi) {
    const club = CLUBS[this.on.club], putt = !!club.putt;
    // the plane the hands and club swing in, in the player's own space: +Z toward the ball, +X down the hole
    const ay = putt ? -0.9 : -0.83, az = putt ? 0.43 : 0.56, al = Math.hypot(ay, az);
    const A = [0, ay / al, az / al], arm = 0.6, len = putt ? 0.86 : 1.0;
    const S = [0, putt ? 1.36 : 1.38, 0.2];
    const psi = putt ? phi : phi > 0 ? Math.min(phi * 1.45, phi + 1.25) : phi * 1.3;
    const hands = [-Math.sin(phi) * arm + S[0], S[1] + Math.cos(phi) * arm * A[1], S[2] + Math.cos(phi) * arm * A[2]];
    const dir = [-Math.sin(psi), Math.cos(psi) * A[1], Math.cos(psi) * A[2]];
    // the follow-through carries the hands up and round past the front shoulder
    if (phi < 0) { hands[1] += Math.min(0.5, -phi * 0.25); hands[2] -= Math.min(0.25, -phi * 0.1); }
    return { hands, dir, len, head: [hands[0] + dir[0] * len, hands[1] + dir[1] * len, hands[2] + dir[2] * len] };
  }

  // stands the player where the club's head meets the ball, facing it, and poses them
  place() {
    const o = this.on, p = this.cm.entities.person, b = o.ball;
    const h = Math.atan2(-Math.sin(o.aim), Math.cos(o.aim)); // their left down the aim
    const sn = Math.sin(h), cs = Math.cos(h);
    const rest = this.swingFrame(0).head;
    // local (x, z) → world: x along their left (cos h, -sin h), z ahead (sin h, cos h)
    // where they stand is set once as they line up; aiming after that only turns them on the spot
    if (!o.planted) {
      const fx = b.x - (rest[0] * cs + rest[2] * sn), fz = b.z - (-rest[0] * sn + rest[2] * cs);
      // on the grass as it's drawn, where the ball is, not sunk into it as people walking are
      o.planted = { x: fx, z: fz, y: Math.max(this.cm.getGroundHeight(fx, fz, 'person'), turf(fx, fz) - 0.02) };
    }
    const fx = o.planted.x, fz = o.planted.z, fy = o.planted.y;
    p.position.set(fx, fy, fz);
    p.heading = h;
    p.speed = p.verticalVel = 0;
    o.at = { x: fx, z: fz, h };
    this.pose(o.phi || 0);
  }

  pose(phi) {
    const o = this.on, p = this.cm.entities.person, f = this.swingFrame(phi);
    const g = p.golf || (p.golf = { pose: { hip: [0, 0.95, -0.06], shoulder: [0, 1.45, 0.16], hand: [0.02, 0.9, 0.5], foot: [0.24, 0.07, 0.02], standing: true, hands: [[0, 0, 0], [0, 0, 0]] } });
    const pz = g.pose;
    pz.foot[0] = CLUBS[o.club].putt ? 0.17 : 0.25;
    // both hands on the grip, the lead one above the other
    pz.hands[0][0] = f.hands[0]; pz.hands[0][1] = f.hands[1]; pz.hands[0][2] = f.hands[2];
    pz.hands[1][0] = f.hands[0] + f.dir[0] * 0.09; pz.hands[1][1] = f.hands[1] + f.dir[1] * 0.09; pz.hands[1][2] = f.hands[2] + f.dir[2] * 0.09;
    // the club, from the hands, into the world
    const h = p.heading, sn = Math.sin(h), cs = Math.cos(h);
    const wx = (l) => p.position.x + l[0] * cs + l[2] * sn, wz = (l) => p.position.z - l[0] * sn + l[2] * cs;
    this.club.position.set(wx(f.hands), p.position.y + f.hands[1], wz(f.hands));
    _v.set(f.dir[0] * cs + f.dir[2] * sn, f.dir[1], -f.dir[0] * sn + f.dir[2] * cs).normalize();
    _q.setFromUnitVectors(_up, _v);
    this.club.quaternion.copy(_q);
    // the shaft reaches down to the head; the head turned square to the line of play
    this.shaft.scale.y = f.len;
    this.head.position.set(0, f.len, 0);
    this.head.quaternion.setFromAxisAngle(_up, 0);
    this.club.scale.setScalar(1);
    this.club.updateMatrixWorld(true);
  }

  // the dots from the ball to where a full shot with this club would come down (a putt: to the pin, at most its reach)
  drawAim() {
    const o = this.on, b = o.ball, reach = o.dist;
    const cx = Math.cos(o.aim), cz = Math.sin(o.aim), m = new THREE.Matrix4(), sc = new THREE.Vector3(), q = new THREE.Quaternion();
    const r0 = this.circleR(), n = o.putt ? Math.max(3, Math.min(this.DOTS, Math.round(reach / 0.6))) : Math.min(this.DOTS, Math.max(4, Math.round(reach / 6)));
    for (let i = 0; i < this.DOTS; i++) {
      const t = (i + 1) / (n + 1), d = reach * t, x = b.x + cx * d, z = b.z + cz * d;
      const r = i < n && d > 0.3 && reach - d > 0.4 ? (o.putt ? 0.03 : 0.08 + d * 0.003) : 0;
      m.compose(sc.set(x, turf(x, z) + 0.05, z), q, _v.set(r, r, r));
      this.dots.setMatrixAt(i, m);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = false;
    this.mark.visible = false;
    const t = this.circle?.userData.v === 5 ? this.circle : this.makeTarget(), ex = b.x + cx * reach, ez = b.z + cz * reach;
    // a smooth band round the edge, laid on the ground where it is so it follows the slopes, its edges fading out
    const N = this.CIRCLE_N, P = t.geometry.attributes.position.array;
    const w = Math.max(0.05, r0 * 0.035) / 2, f = Math.max(0.05, w * 1.2), rad = [r0 - w - f, r0 - w, r0 + w, r0 + w + f];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), y = turf(ex + c * r0, ez + sn * r0) + 0.04;
      for (let k = 0; k < 4; k++) { const j = (i * 4 + k) * 3; P[j] = ex + c * rad[k]; P[j + 1] = y; P[j + 2] = ez + sn * rad[k]; }
    }
    t.geometry.attributes.position.needsUpdate = true;
    t.visible = !!o.held;
  }

  // the hole shown over the view wherever it is, trees or hills in the way: a marker on the pin with how far it is
  tagPin() {
    if (!this.on) return;
    const o = this.on, h = this.hole(), cam = this.cameraSystem.camera, el = this.cameraSystem.domElement;
    let t = this.pinTag;
    if (!t) {
      t = this.pinTag = document.createElement('div');
      t.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:5;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;font:700 15px system-ui,-apple-system,sans-serif;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8),0 0 8px rgba(0,0,0,.5);white-space:nowrap';
      t.innerHTML = '<span></span><svg width="18" height="12" viewBox="0 0 18 12" style="margin-top:2px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))"><path d="M1 1h16L9 11z" fill="#fff"/></svg>';
      document.body.appendChild(t);
    }
    const px = h.pin[0], pz = h.pin[1];
    _v.set(px, turf(px, pz) + 2.6, pz).project(cam);
    const shown = o.phase !== 'holed' && _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1 && el;
    if (!shown) { t.style.display = 'none'; return; }
    const r = this.view();
    t.style.display = 'flex';
    t.style.left = `${r.left + (_v.x + 1) / 2 * r.width}px`;
    t.style.top = `${r.top + (1 - _v.y) / 2 * r.height}px`;
    const yd = Math.round(Math.hypot(px - o.ball.x, pz - o.ball.z) * YD), words = yd < 1 ? 'Hole' : `${yd} yd`;
    if (t.firstChild.textContent !== words) t.firstChild.textContent = words;
  }

  // the landing circle: a smooth white band on the ground, four rings of points round it (the outer two fading out,
  // so its edges are soft rather than stepped), moved each frame by drawAim
  makeTarget() {
    this.target?.removeFromParent();
    this.circle?.removeFromParent();
    this.circle?.geometry.dispose();
    this.target = null;
    const N = this.CIRCLE_N = 256;
    const pos = new Float32Array(N * 4 * 3), fade = new Float32Array(N * 4), idx = [];
    for (let i = 0; i < N; i++) {
      fade.set([0, 1, 1, 0], i * 4);
      const a = i * 4, b = ((i + 1) % N) * 4;
      for (let k = 0; k < 3; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    g.setIndex(idx);
    const mat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.opacityNode = attribute('fade', 'float').mul(float(0.92));
    const t = this.circle = new THREE.Mesh(g, mat);
    t.frustumCulled = false;
    t.renderOrder = 2;
    t.userData.v = 5;
    this.group.add(t);
    return t;
  }

  // the mouse: press on the view while lined up, pull back behind the golfer like a slingshot, let go to hit
  // The window's listeners, on one signal so dispose takes them all away (a live change makes a new GolfPlay, and the old
  // one's would otherwise go on catching presses on the view)
  bindMouse() {
    this.mouseBound = true;
    this.listening ??= new AbortController();
    const opts = { capture: true, signal: this.listening.signal };
    const el = this.cameraSystem.domElement;
    const lined = () => this.on && this.on.phase === 'address' && !this.on.held;
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !lined() || (el && e.target !== el)) return;
      e.stopPropagation(); e.preventDefault();
      const o = this.on;
      o.mouse = { id: e.pointerId, down: true, aim0: o.aim, d0: o.dist, x0: e.clientX, y0: e.clientY };
      this.mouseAt(e);
    }, opts);
    window.addEventListener('pointermove', (e) => {
      const m = this.on?.mouse;
      if (!m || !m.down || e.pointerId !== m.id) return;
      e.stopPropagation();
      this.mouseAt(e);
    }, opts);
    const up = (e) => {
      const m = this.on?.mouse;
      if (!m || !m.down || e.pointerId !== m.id) return;
      e.stopPropagation();
      m.down = false;
      // let go where it was pressed (never pulled, or brought back there): no shot
      if (!m.pulled || !(m.px > 8)) m.cancel = true;
    };
    window.addEventListener('pointerup', up, opts);
    window.addEventListener('pointercancel', up, opts);
  }

  bindEscape() {
    this.escapeBound = true;
    this.listening ??= new AbortController();
    // Escape while pulling back puts the shot down: nothing is hit, and the aim goes back to where it was
    window.addEventListener('keydown', (e) => {
      const m = this.on?.mouse;
      if (e.code !== 'Escape' || !m || !m.down) return;
      e.stopImmediatePropagation(); e.preventDefault();
      m.down = false; m.cancel = true;
    }, { capture: true, signal: this.listening.signal });
  }

  // player one's view on the screen: the whole canvas, or its left half in split screen
  view() {
    const r = this.cameraSystem.domElement.getBoundingClientRect();
    return document.body.classList.contains('split') ? { left: r.left, top: r.top, width: r.width / 2, height: r.height } : r;
  }

  // where the pointer is on the ground at the ball's height, and how far it's been pulled from where it was pressed
  mouseAt(e) {
    const o = this.on, m = o?.mouse;
    if (!m || !this.cameraSystem.domElement) return;
    const r = this.view(), cam = this.cameraSystem.camera;
    _v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(cam).sub(cam.position);
    if (_v.y >= -1e-4) return;
    const t = (o.ball.y - cam.position.y) / _v.y;
    m.gx = cam.position.x + _v.x * t; m.gz = cam.position.z + _v.z * t;
    // the slingshot's anchor: the first spot on the ground the press found
    if (m.ax === undefined) { m.ax = m.gx; m.az = m.gz; m.x0 = e.clientX; m.y0 = e.clientY; }
    // the pull on the screen, from the press, as a share of the view's height: what sets the power
    m.px = Math.hypot(e.clientX - m.x0, e.clientY - m.y0);
    m.pull = m.px / r.height;
  }

  aimShown(on) { this.dots.visible = false; this.mark.visible = false; (this.circle?.userData.v === 5 ? this.circle : this.makeTarget()).visible = on && !!this.on?.held; }

  update(dt) {
    if (this.teeMarksV !== TEE_MARKS_V) {
      this.teeMarks?.removeFromParent();
      this.teeMarks?.traverse((x) => { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose?.(); });
      this.buildTeeMarks();
    }
    const o = this.on;
    if (!o) { if (this.pinTag) this.pinTag.style.display = 'none'; return; }
    const cm = this.cm, p = cm.entities.person, k = cm.keys;
    // another way of getting about, a teleport or a fall ends the round
    if (cm.activeMode !== 'person' || p.fallen || p.onBus || p.chute) return this.quit();
    // a teleport ends the round; a nudge (a car going by, a bump from something near the tee) only puts them back
    if (o.at) {
      const off = Math.hypot(p.position.x - o.at.x, p.position.z - o.at.z);
      if (off > 6) return this.quit();
      if (off > 0.05 && o.planted) { p.position.set(o.planted.x, o.planted.y, o.planted.z); p.heading = o.at.h; p.speed = p.verticalVel = 0; }
    }
    if (!this.mouseBound) this.bindMouse();
    if (!this.escapeBound) this.bindEscape();
    const swing = !!k.up || !!o.mouse?.down, b = o.ball;
    const club = CLUBS[o.club];
    if ((o.phase === 'address' || o.phase === 'back') && !Number.isFinite(o.dist)) { this.address(); this.aimShown(true); }
    if (o.phase === 'address' || o.phase === 'back') {
      // aim with the stick or the turn keys (finer on the green), farther or nearer with a push forward or back,
      // held or not
      const turn = (Number(k.left) || 0) - (Number(k.right) || 0);
      const fwd = (Number(k.forward) || 0) - (Number(k.backward) || 0);
      let moved = false;
      if (turn) { o.aim -= turn * dt * (o.putt ? 0.3 : 0.6); moved = true; }
      if (fwd) {
        const was = o.dist;
        o.dist = Math.max(o.min, Math.min(o.max, o.dist + fwd * dt * (o.putt ? 4 : Math.max(10, o.max * 0.4))));
        if (o.dist !== was) { o.club = this.clubFor(o.dist); moved = true; }
      }
      // pulled back from where it was pressed, like a slingshot: the shot goes the other way, farther the more it's
      // pulled on the screen (a quarter of the view's height is the longest shot). Until it's moved a few pixels it's
      // only a press, and letting go then hits nothing
      const ms = o.mouse;
      if (ms && ms.ax !== undefined && (ms.pulled || ms.px > 8)) {
        const px = ms.ax - ms.gx, pz = ms.az - ms.gz, len = Math.hypot(px, pz);
        if (len > 0.05) {
          const was = o.dist, wasAim = o.aim;
          const frac = Math.max(0, Math.min(1, ((ms.pull ?? 0) - 0.01) / 0.22));
          o.dist = o.min + (o.max - o.min) * frac;
          o.aim = Math.atan2(pz, px);
          if (o.dist !== was) o.club = this.clubFor(o.dist);
          if (o.dist !== was || o.aim !== wasAim) moved = true;
          ms.pulled = true;
        }
      }
      if (moved) { this.place(); this.say(); }
      // holding swing draws the club back and sets the circle growing and shrinking; letting go hits, the ball
      // coming down somewhere in the circle as it is then
      const frac = (o.dist - o.min) / (o.max - o.min || 1);
      if (swing && !o.held && o.phase === 'address') { o.held = true; o.phase = 'back'; o.pulse = 0; }
      if (o.phase === 'back') {
        o.pulse += dt;
        const top = (o.putt ? 0.15 + 0.4 * Math.sqrt(frac) : 0.9 + 1.45 * frac);
        o.phi += (top - (o.phi || 0)) * Math.min(1, dt * 7);
        this.pose(o.phi);
        if (!swing && o.mouse?.cancel) {
          // a click without a pull back, or Escape: no shot, and the aim as it was before the press
          const m = o.mouse;
          o.held = false; o.phase = 'address'; o.mouse = null;
          if (m.pulled) { o.aim = m.aim0; o.dist = m.d0; o.club = this.clubFor(o.dist); this.place(); this.say(); }
          this.aimShown(false); o.phi = 0; this.pose(0);
        } else if (!swing) {
          o.mouse = null;
          const r = o.frozenR = this.circleR(), a = random() * Math.PI * 2, rr = r * Math.sqrt(random());
          const ex = o.ball.x + Math.cos(o.aim) * o.dist + Math.cos(a) * rr, ez = o.ball.z + Math.sin(o.aim) * o.dist + Math.sin(a) * rr;
          o.target = { x: ex, z: ez };
          o.power = 0.35 + 0.65 * frac;
          o.held = false;
          o.phase = 'down'; o.t = 0; o.top = o.phi;
        }
      } else this.pose(0);
      this.drawAim();
    } else if (o.phase === 'down') {
      o.t += dt;
      const T = club.putt ? 0.32 : 0.2, u = Math.min(1, o.t / T);
      o.phi = o.top * (1 - u * u);
      this.pose(o.phi);
      if (u >= 1) this.strike();
    } else if (o.phase === 'flight' || o.phase === 'rest' || o.phase === 'holed') {
      // the follow-through, held
      if (o.phi > -(club.putt ? o.top : 2.1)) { o.phi -= dt * (club.putt ? 1.6 : 11); this.pose(o.phi); }
      if (o.phase === 'flight') this.fly(dt);
      else if ((o.wait -= dt) <= 0) { this.next(); if (this.on !== o) return; }
    }
    this.line.classList.remove('swinging');
    // the golf words under player one's view: the middle of its half in split screen, not on the divider
    const mid = document.body.classList.contains('split') ? '25%' : '';
    if (this.line.style.left !== mid) this.line.style.left = mid;
    // the ball, kept a few pixels across however far the camera is
    this.ball.position.set(b.x, b.y, b.z);
    const cd = this.cameraSystem.camera.position.distanceTo(this.ball.position);
    // the ball as it's seen: a lit white golf ball sitting on the grass, its true size up close and only a little
    // bigger far off so it can still be followed
    if (!this.ballSeen || !this.ballSeen.v2) {
      if (this.ballSeen) { this.ballSeen.face.removeFromParent(); this.ballSeen.rim?.removeFromParent(); }
      const face = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.45, emissive: 0x5a5a5a, flatShading: true }), 1);
      face.frustumCulled = false;
      this.ballSeen = { face, v2: true };
      this.group.add(face);
    }
    const br = BALL_R * Math.max(1, Math.min(3, cd / 15)), mm = new THREE.Matrix4();
    mm.makeScale(br, br, br).setPosition(b.x, b.y - BALL_R + br, b.z);
    this.ballSeen.face.setMatrixAt(0, mm); this.ballSeen.face.instanceMatrix.needsUpdate = true;
    this.ballSeen.face.visible = o.phase !== 'holed';
    this.ball.visible = false;
    this.tagPin();
    if (this.trail) { this.trail.removeFromParent(); this.trail.geometry.dispose(); this.trail = null; }
  }

  strike() {
    const o = this.on, club = CLUBS[o.club], b = o.ball, p = o.power;
    o.strokes++;
    o.phase = 'flight';
    o.rolled = 0;
    o.landed = false;
    const t = o.target || { x: b.x + Math.cos(o.aim) * o.dist, z: b.z + Math.sin(o.aim) * o.dist };
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.max(0.05, Math.hypot(dx, dz)), cx = dx / d, cz = dz / d;
    if (club.putt) {
      // a putt rolls to the spot: the speed the grass (here and there) takes off over that far
      const roll = (SURFACE[surfaceAt(b.x, b.z)].roll + SURFACE[surfaceAt(t.x, t.z)].roll) / 2;
      const v = Math.sqrt(2 * roll * d);
      b.vx = cx * v; b.vz = cz * v; b.vy = 0;
      o.rolling = true;
    } else {
      // through the air at the club's angle, coming down on the spot (higher or lower ground there allowed for)
      const th = club.launch * Math.PI / 180, tn = Math.tan(th), cs = Math.cos(th);
      const dh = turf(t.x, t.z) + BALL_R - b.y, den = Math.max(d * tn - dh, d * tn * 0.25);
      const v = Math.sqrt(9.8 * d * d / (2 * cs * cs * den));
      b.vx = cx * cs * v; b.vz = cz * cs * v; b.vy = Math.sin(th) * v;
      b.y += 0.01;
      o.rolling = false;
    }
    this.dots.visible = false;
    if (this.circle) this.circle.visible = false;
    if (this.sounds.v !== 2) this.sounds = { v: 2, club: strikeSound(false), putt: strikeSound(true), cup: this.sounds.cup };
    if (this.soundOn()) sound.play(club.putt ? this.sounds.putt : this.sounds.club, { volume: club.putt ? 0.35 + 0.4 * p : 0.55 + 0.4 * p, pitch: 0.95 + random() * 0.1 });
    if (!club.putt) rumble(0, 0.25 + 0.4 * p, 0.5 * p, 0.12);
    o.hangTime = 0;
    log(`[golf] stroke ${o.strokes} with the ${club.name}, ${Math.round(d * YD)} yd of ${Math.round(o.dist * YD)} aimed, from ${o.lie}`);
    this.say();
  }

  // the ball through the air, bouncing and rolling, in small steps
  fly(dt) {
    const o = this.on, b = o.ball, h = this.hole();
    const steps = Math.ceil(dt / (1 / 240));
    const step = dt / steps;
    o.hangTime += dt;
    for (let s = 0; s < steps; s++) {
      if (!o.rolling) {
        b.vy -= 9.8 * step;
        b.x += b.vx * step; b.y += b.vy * step; b.z += b.vz * step;
        const g = turf(b.x, b.z) + BALL_R;
        if (b.y > g) continue;
        b.y = g;
        if (this.circle) this.circle.visible = false;
        if (inWater(b.x, b.z)) return this.penalty('In the water');
        const surf = SURFACE[surfaceAt(b.x, b.z)];
        // straight in the cup on the fly, or close enough to drop off the bounce
        if (Math.hypot(b.x - h.pin[0], b.z - h.pin[1]) < CUP_R + 0.03 && Math.hypot(b.vx, b.vz) < 9) return this.holed();
        b.vy = -b.vy * surf.bounce;
        if (!o.landed) {
          // the first landing takes most of the speed off, as a real ball's spin and the drag it has slowed by do: what's
          // left carries it the club's run for this surface (less for a shorter swing), the hop and the roll together
          o.landed = true;
          const club = CLUBS[o.club], run = (club.run || 0) * surf.run * Math.max(0.3, Math.min(1, o.dist / club.carry));
          let hop = 0, a = surf.roll;
          for (let up = b.vy; up >= 1.2; up *= surf.bounce) hop += 2 * up / 9.8; // the time in the air, every hop
          const v = run > 0 ? a * (Math.sqrt(hop * hop + 2 * run / a) - hop) : 0, sp = Math.hypot(b.vx, b.vz) || 1;
          b.vx *= v / sp; b.vz *= v / sp;
        }
        if (b.vy < 1.2) { b.vy = 0; o.rolling = true; }
      } else {
        const sp = Math.hypot(b.vx, b.vz);
        const lie = surfaceAt(b.x, b.z), surf = SURFACE[lie];
        // down the slope (a rolling ball takes 5/7 of it), and slowed by the grass
        const e = 0.25, gx = (turf(b.x + e, b.z) - turf(b.x - e, b.z)) / (2 * e), gz = (turf(b.x, b.z + e) - turf(b.x, b.z - e)) / (2 * e);
        b.vx -= 7 * gx * step; b.vz -= 7 * gz * step;
        const slow = surf.roll * step;
        const sp2 = Math.hypot(b.vx, b.vz);
        if (sp2 <= slow) { b.vx = b.vz = 0; } else { b.vx *= 1 - slow / sp2; b.vz *= 1 - slow / sp2; }
        b.x += b.vx * step; b.z += b.vz * step;
        b.y = turf(b.x, b.z) + BALL_R;
        o.rolled += sp * step;
        const toCup = Math.hypot(b.x - h.pin[0], b.z - h.pin[1]);
        if (toCup < CUP_R && sp < 1.7) return this.holed();
        if (inWater(b.x, b.z)) return this.penalty('In the water');
        // at rest: still, and not on a slope steep enough to move it
        if (Math.hypot(b.vx, b.vz) < 0.04 && Math.hypot(gx, gz) * 7 < surf.roll * 1.2) return this.stopped();
        if (o.hangTime > 25) return this.stopped();
      }
    }
  }

  stopped() {
    const o = this.on, b = o.ball, h = this.hole();
    b.vx = b.vy = b.vz = 0;
    // out of bounds: well off the hole, and not on any of the course's greens or fairways
    const off = distToLine(h.line, b.x, b.z);
    const lie = surfaceAt(b.x, b.z);
    if (off > 85 && (lie === 'rough' || off > 160)) return this.penalty('Out of bounds');
    o.phase = 'rest';
    if (this.circle) this.circle.visible = false;
    o.wait = 1.4;
    o.lie = lie;
    const yd = Math.round(Math.hypot(h.pin[0] - b.x, h.pin[1] - b.z) * YD);
    log(`[golf] at rest on ${lie}, ${yd} yd from the pin`);
    // a hole that's got away: picked up at five over par, counted as one more, and on to the next
    if (o.strokes >= h.par + 5) this.pickUp();
  }

  pickUp() {
    const o = this.on, h = this.hole();
    o.strokes++;
    o.phase = 'holed';
    o.wait = 2.6;
    o.card.push({ ref: this.holeNumber(), par: h.par, strokes: o.strokes });
    o.played.push(o.hole);
    this.notice(`Picked up · ${o.strokes}`, 2.4);
    log(`[golf] picked up on ${this.holeNumber()} at ${o.strokes} (par ${h.par})`);
    this.words.textContent = `Hole ${this.holeNumber()} · ${o.strokes} · ${this.total()}`;
  }

  penalty(words) {
    const o = this.on, b = o.ball;
    o.strokes++;
    b.x = o.from.x; b.z = o.from.z;
    b.y = turf(b.x, b.z) + BALL_R;
    b.vx = b.vy = b.vz = 0;
    o.phase = 'rest';
    if (this.circle) this.circle.visible = false;
    o.wait = 1.6;
    o.again = true;
    this.notice(`${words} · one stroke penalty`, 2.4);
    log(`[golf] ${words.toLowerCase()}: a stroke and the shot again`);
  }

  holed() {
    if (this.circle) this.circle.visible = false;
    const o = this.on, h = this.hole(), b = o.ball;
    b.x = h.pin[0]; b.z = h.pin[1]; b.y = turf(b.x, b.z) - 0.05;
    b.vx = b.vy = b.vz = 0;
    o.phase = 'holed';
    o.wait = 3.2;
    const diff = o.strokes - h.par;
    const words = o.strokes === 1 ? 'Hole in one!' : RESULT[diff] || `${o.strokes} strokes`;
    o.card.push({ ref: this.holeNumber(), par: h.par, strokes: o.strokes });
    o.played.push(o.hole);
    this.notice(words, 2.8);
    if (this.soundOn()) sound.play(this.sounds.cup, { volume: 0.8 });
    rumble(0, 0.2, 0.35, 0.15);
    log(`[golf] holed out on ${this.holeNumber()} in ${o.strokes} (par ${h.par}): ${words}`);
    this.words.textContent = `Hole ${this.holeNumber()} · ${o.strokes} · ${this.total()}`;
  }

  total() {
    const card = this.on.card;
    const s = card.reduce((t, c) => t + c.strokes, 0), d = s - card.reduce((t, c) => t + c.par, 0);
    return `${s} for ${card.length} ${card.length === 1 ? 'hole' : 'holes'} (${d === 0 ? 'even' : d > 0 ? `+${d}` : d})`;
  }

  // after a shot: up to the ball; after holing out: on to the next tee, or the round's done
  next() {
    const o = this.on;
    if (o.phase === 'rest') { o.again = false; o.phi = 0; this.address(); this.aimShown(true); return; }
    const holes = course().holes, h = this.hole();
    // the next hole by number on this course, round to 1 after the last, till every one's been played
    const same = holes.map((x, i) => i).filter((i) => holes[i].course === h.course).sort((a, b) => holes[a].ref - holes[b].ref);
    const at = same.indexOf(o.hole);
    let n = -1;
    for (let k = 1; k < same.length && n < 0; k++) { const i = same[(at + k) % same.length]; if (!o.played.includes(i)) n = i; }
    if (n < 0 || o.played.includes(n)) {
      return this.quit(`Round over · ${this.total()}`);
    }
    o.phi = 0;
    this.beginHole(n, false);
    this.aimShown(true);
  }

  // the camera: behind the ball down the line while the player lines up, then after the ball as it flies and rolls
  camera(dt, pos, look) {
    const o = this.on;
    if (!o) return false;
    const b = o.ball, club = CLUBS[o.club];
    if (o.phase === 'address' || o.phase === 'back' || o.phase === 'down' || (o.phase === 'rest' && o.again)) {
      // a little to the side away from where the golfer stands, so they're beside the view and never in front of it
      // up and back far enough that the golfer and the landing circle are both in view
      const ms = o.mouse, held = ms && (ms.down || o.phase === 'back');
      const d = held && Number.isFinite(ms.d0) ? ms.d0 : Number.isFinite(o.dist) ? o.dist : 30, aim = held ? ms.aim0 : o.aim;
      const cx = Math.cos(aim), cz = Math.sin(aim), back = club.putt ? 4 + Math.min(d, 15) * 0.15 : 9, side = 0;
      const px = b.x - cx * back - cz * side, pz = b.z - cz * back + cx * side;
      pos.set(px, Math.max(turf(px, pz), b.y) + (club.putt ? 2.2 + Math.min(d, 15) * 0.12 : 4.5), pz);
      const ahead = club.putt ? Math.min(d * 0.5, 4) : 6, lx = b.x + cx * ahead, lz = b.z + cz * ahead;
      look.set(lx, Math.max(turf(lx, lz), b.y) + 0.4, lz);
      return 4;
    }
    // following: behind the ball the way it's going, higher the farther it is from where it was hit
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.5) { o.camDir = Math.atan2(b.vz, b.vx); }
    const d = o.camDir ?? o.aim, cx = Math.cos(d), cz = Math.sin(d);
    const back = club.putt ? 3.5 : 11, px = b.x - cx * back, pz = b.z - cz * back;
    pos.set(px, Math.max(turf(px, pz) + (club.putt ? 1.6 : 3.2), b.y + (club.putt ? 1.2 : 2)), pz);
    look.set(b.x + cx * 2, b.y, b.z + cz * 2);
    return o.phase === 'flight' ? (club.putt ? 3 : 2.4) : 1.6;
  }

  snapshot() {
    const o = this.on;
    if (!o) return null;
    // the holes by course and number, not by place in the list, which a change to the course data can reorder
    const holes = course().holes, h = holes[o.hole];
    return { course: h.course, ref: h.ref, playedRefs: o.played.map((i) => holes[i]?.ref), strokes: o.strokes, card: o.card,
      ball: { x: o.ball.x, z: o.ball.z }, aim: o.aim, dist: o.dist };
  }
  restore(s) {
    if (!s) return;
    const holes = course().holes;
    const at = (ref) => holes.findIndex((h) => h.course === s.course && h.ref === ref);
    const i = s.course !== undefined ? at(s.ref) : s.hole;
    if (!Number.isFinite(i) || !holes[i]) return;
    this.start(i);
    const o = this.on;
    o.strokes = s.strokes | 0;
    o.card = Array.isArray(s.card) ? s.card : [];
    o.played = Array.isArray(s.playedRefs) ? s.playedRefs.map(at).filter((k) => k >= 0) : Array.isArray(s.played) ? s.played : [];
    if (Number.isFinite(s.ball?.x) && Number.isFinite(s.ball?.z)) { o.ball.x = s.ball.x; o.ball.z = s.ball.z; o.ball.y = turf(s.ball.x, s.ball.z) + BALL_R; }
    this.address();
    if (Number.isFinite(s.dist)) { o.dist = Math.max(o.min, Math.min(o.max, s.dist)); o.club = this.clubFor(o.dist); }
    if (Number.isFinite(s.aim)) o.aim = s.aim;
    o.planted = null;
    this.place();
    this.drawAim();
    this.say();
  }
}

hot(import.meta).accept();
