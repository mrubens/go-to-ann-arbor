import * as THREE from 'three/webgpu';
import { attribute, color, float, floor, fract, mix, mod, step, texture, uniform, uv, vec2 } from 'three/tsl';
import { groundHeight } from './terrain.js';
import { SIGNAL_TIMING, blockAt, pedTiming } from './city-config.js';
import { createPedestrianRoutes } from './pedestrian-routes.js';
import { log } from '../lamp-game.js';

// Lamp: the town's pedestrian signals: at each end of every signalised junction's crosswalk, on a short pole at the
// corner, a traffic-yellow head facing the people waiting at the other end, an LED hand and walking person on its left
// and a two-digit countdown on its right, as the city has put up across downtown and along its main roads. Each runs
// on its crosswalk's own timing (city-config.js pedTiming, which the walkers obey: traffic.js walkOn), from its
// junction's offset into the cycle, worked out per frame in the lamp's shader from instance attribute `psig`: the
// WALK's start, its end, the countdown's end, and the junction's offset. The crosswalks are the walkers' own
// (pedestrian-routes.js across), so a head stands wherever someone waits for one.

const HAND = '#ff7b1c', PERSON = '#f2f6ff';
const POLE_H = 3.3; // m, the pole's top
const HEAD_Y = 2.85; // m, the head's middle (its bottom about 8 ft up, as the manual has it)
const HEAD_W = 0.46, HEAD_HT = 0.46, HEAD_D = 0.2;

// An LED face: the shape drawn solid, then cut down to a grid of round dots
function ledMask(ctx, w, h, pitch) {
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const m = mask.getContext('2d');
  m.fillStyle = '#fff';
  for (let y = pitch / 2; y < h; y += pitch) for (let x = pitch / 2; x < w; x += pitch) {
    m.beginPath();
    m.arc(x, y, pitch * 0.42, 0, Math.PI * 2);
    m.fill();
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

// the raised hand (left half) and the walking person (right half), 512 x 256
function symbolsTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  // the hand: a palm, four fingers and a thumb
  g.fillStyle = HAND;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  rr(78, 112, 104, 100, 30);
  for (const [x, top] of [[80, 48], [106, 34], [132, 38], [158, 54]]) rr(x, top, 22, 100, 11);
  g.save();
  g.translate(178, 150);
  g.rotate(-0.75);
  rr(-12, -66, 24, 74, 12);
  g.restore();
  // the person, mid-stride
  g.save();
  g.translate(256, 0);
  g.strokeStyle = PERSON;
  g.fillStyle = PERSON;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.arc(134, 46, 20, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 30;
  g.beginPath(); g.moveTo(128, 84); g.lineTo(120, 146); g.stroke(); // body
  g.lineWidth = 20;
  g.beginPath(); g.moveTo(120, 146); g.lineTo(92, 182); g.lineTo(80, 226); g.stroke(); // back leg
  g.beginPath(); g.moveTo(120, 146); g.lineTo(150, 186); g.lineTo(170, 222); g.stroke(); // front leg
  g.lineWidth = 16;
  g.beginPath(); g.moveTo(126, 92); g.lineTo(98, 124); g.lineTo(88, 152); g.stroke(); // back arm
  g.beginPath(); g.moveTo(130, 92); g.lineTo(156, 120); g.lineTo(176, 136); g.stroke(); // front arm
  g.restore();
  ledMask(g, 512, 256, 9);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// the countdown's digits 0-9, seven segments each in a 64 x 128 cell
function digitsTexture() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = HAND;
  const SEG = { a: [12, 8, 40, 12], b: [44, 14, 12, 46], c: [44, 68, 12, 46], d: [12, 108, 40, 12], e: [8, 68, 12, 46], f: [8, 14, 12, 46], g: [12, 58, 40, 12] };
  const ON = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  ON.forEach((segs, d) => {
    for (const s of segs) {
      const [x, y, w, h] = SEG[s];
      g.fillRect(d * 64 + x, y, w, h);
    }
  });
  ledMask(g, 640, 128, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The face: hand and person on the left half, the countdown on the right, each lit through its part of the
// crosswalk's cycle (a flashing hand blinks once a second, in step with the count)
function faceMaterial() {
  const time = uniform(0);
  const symbols = symbolsTexture(), digits = digitsTexture();
  const sig = attribute('psig', 'vec4');
  const { cycle } = SIGNAL_TIMING;
  const walkLen = sig.y.sub(sig.x), endLen = sig.z.sub(sig.x);
  const t = mod(time.add(sig.w).sub(sig.x), cycle);
  const isWalk = float(1).sub(step(walkLen, t));
  const isFlash = step(walkLen, t).mul(float(1).sub(step(endLen, t)));
  const handOn = float(1).sub(isWalk).mul(float(1).sub(isFlash.mul(step(0.5, fract(t)))));
  const p = uv();
  const right = step(0.5, p.x);
  // left half: the symbols, overlaid in one place as the town's are
  const u = p.x.mul(2);
  const hand = texture(symbols, vec2(u.mul(0.5), p.y));
  const person = texture(symbols, vec2(u.mul(0.5).add(0.5), p.y));
  const left = hand.rgb.mul(mix(float(0.05), float(2.4), handOn)).add(person.rgb.mul(mix(float(0.03), float(2.2), isWalk)));
  // right half: the seconds left on the flashing hand, the tens only from 10
  const secs = floor(endLen.sub(t).add(0.999));
  const tens = floor(secs.div(10)), ones = secs.sub(tens.mul(10));
  const u2 = p.x.sub(0.5).mul(2);
  const second = step(0.5, u2);
  const cell = mix(tens, ones, second);
  const du = fract(u2.mul(2)).mul(0.8).add(0.1);
  const digit = texture(digits, vec2(cell.add(du).div(10), p.y.mul(0.8).add(0.1)));
  const shown = isFlash.mul(mix(step(0.5, tens), float(1), second));
  const count = digit.rgb.mul(shown.mul(2.4));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = mix(left, count, right);
  mat.userData.time = time;
  return mat;
}

function buildPedSignals(group, network) {
  const routes = createPedestrianRoutes(network, blockAt);
  const lists = { pole: [], head: [], face: [], button: [], plate: [] };
  const psig = [];
  const dummy = new THREE.Object3D();
  const put = (name) => { dummy.updateMatrix(); lists[name].push(dummy.matrix.clone()); };
  const obstacles = [];
  let junctions = 0;
  for (const n of network.nodes) {
    if (!n.signal) continue;
    const tracks = routes.across(n);
    if (!tracks.length) continue;
    junctions++;
    // one crosswalk to each side: its lines' ends averaged
    const bySide = new Map();
    for (const tr of tracks) {
      if (!bySide.has(tr.side)) bySide.set(tr.side, []);
      bySide.get(tr.side).push(tr);
    }
    for (const lines of bySide.values()) {
      const tr = lines[0];
      let ax = 0, az = 0;
      for (const l of lines) { ax += l.ax; az += l.az; }
      ax /= lines.length; az /= lines.length;
      const { ux, uz, len } = tr;
      const bx = ax + ux * len, bz = az + uz * len;
      const { start, walkEnd, end } = pedTiming(tr.group !== 0, !!n.leftPhase, len - 4);
      // away from the junction, beside the crosswalk
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      let ox = -uz, oz = ux;
      if (ox * (cx - n.x) + oz * (cz - n.z) < 0) { ox = -ox; oz = -oz; }
      for (const [ex, ez, fx, fz] of [[ax, az, ux, uz], [bx, bz, -ux, -uz]]) {
        // 0.8 m back from the curb (2 m in from the track's end), 1.9 m out from the crosswalk's middle
        let x = ex + fx * 1.2 + ox * 1.9, z = ez + fz * 1.2 + oz * 1.9;
        if (!blockAt(x, z)) { x = ex + fx * 0.4 + ox * 1.6; z = ez + fz * 0.4 + oz * 1.6; }
        if (!blockAt(x, z)) continue;
        const g = groundHeight(x, z);
        dummy.rotation.set(0, 0, 0);
        dummy.position.set(x, g + POLE_H / 2, z);
        dummy.scale.set(0.065, POLE_H, 0.065);
        put('pole');
        obstacles.push({ x, z, r: 0.1, kind: 'sign', height: POLE_H, parts: [] });
        // the head, facing across to the far curb
        const yaw = Math.atan2(fx, fz);
        dummy.rotation.set(0, yaw, 0);
        dummy.position.set(x + fx * 0.2, g + HEAD_Y, z + fz * 0.2);
        dummy.scale.set(1, 1, 1);
        put('head');
        dummy.position.set(x + fx * (0.2 + HEAD_D / 2 + 0.004), g + HEAD_Y, z + fz * (0.2 + HEAD_D / 2 + 0.004));
        put('face');
        psig.push(start, walkEnd, end, n.offset || 0);
        // the push button, toward the curb, with its sign over it
        dummy.position.set(x + fx * 0.08, g + 1.05, z + fz * 0.08);
        put('button');
        dummy.position.set(x + fx * 0.075, g + 1.4, z + fz * 0.075);
        put('plate');
      }
    }
  }
  const housing = new THREE.MeshStandardNodeMaterial({ color: 0xd9a514, roughness: 0.5, metalness: 0.1 });
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.7 });
  const plateMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  const faceMat = faceMaterial();
  const faceGeo = new THREE.PlaneGeometry(HEAD_W - 0.04, HEAD_HT * 0.5);
  faceGeo.setAttribute('psig', new THREE.InstancedBufferAttribute(new Float32Array(psig), 4));
  const kinds = {
    pole: [new THREE.CylinderGeometry(1, 1, 1, 8), metal, true],
    head: [new THREE.BoxGeometry(HEAD_W, HEAD_HT, HEAD_D), housing, true],
    face: [faceGeo, faceMat, false],
    button: [new THREE.BoxGeometry(0.11, 0.17, 0.09), housing, false],
    plate: [new THREE.PlaneGeometry(0.23, 0.3), plateMat, false]
  };
  for (const [name, matrices] of Object.entries(lists)) {
    if (!matrices.length) continue;
    const [geo, mat, shadow] = kinds[name];
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadow;
    inst.userData.cullDistance = name === 'face' ? 400 : 250;
    inst.name = 'PedSignals_' + name;
    group.add(inst);
  }
  group.userData.terrain = 'set';
  log(`[ped signals] ${lists.face.length} walk heads at ${junctions} signalised junctions' crosswalks`);
  return { update: (time) => { faceMat.userData.time.value = time; }, obstacles };
}

export { buildPedSignals };
