// Lamp: the overhead wires of Ann Arbor's older neighbourhoods and arterials: wooden utility poles down one side of
// the street, about every 40 m in the tree lawn just behind the curb, each with a crossarm carrying three power lines
// and lower down the phone and cable lines, now and then a transformer can, the wires sagging from pole to pole.
// None downtown or on central campus, where they run underground, nor on the freeways and ramps, in the cul-de-sac
// subdivisions (streets of the newer kind, cls 6), or on streets too short to need a run. Placed from the road graph
// (GEO.roadGraph), seeded by place, so a street always has its poles on the same side.
import * as THREE from 'three/webgpu';
import { float, smoothstep, length, positionWorld, cameraPosition, color } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GEO } from './city-geodata.js';
import { blockAt } from './city-config.js';
import { curbCuts } from './yards.js';
import { groundHeight } from './terrain.js';
import { TIER } from './device-tier.js';
import { log } from '../lamp-game.js';

const SPAN = 40; // m between poles
const END = 9; // no pole this close to a link's ends (the corners)
const POLE_H = 10.5;
const ARM_Y = 9.6;
const CELL = 500; // the wires are cut into cells this size, for culling
// where the wires are underground: the downtown core and central campus (x east, z south of Main & Liberty, m)
const UNDERGROUND = [[-300, 700, -170, 300], [700, 1450, -250, 820], [-120, 420, 1250, 1900]];
const underground = (x, z) => UNDERGROUND.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };

function buildUtilityPoles(group) {
  group.name = 'UtilityPoles';
  if (TIER.name === 'phone') return { poles: 0, spans: 0, obstacles: [] };
  const G = GEO.roadGraph, N = G.nodes;
  // curb cuts (driveways) in 20 m cells, to keep the poles off them
  const C = curbCuts(), cuts = new Map();
  for (let i = 0; i < C.length; i += 5) {
    const k = Math.floor(C[i] / 20) * 100000 + Math.floor(C[i + 1] / 20);
    if (!cuts.has(k)) cuts.set(k, []);
    cuts.get(k).push(C[i], C[i + 1], C[i + 4]);
  }
  const onCut = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = cuts.get((Math.floor(x / 20) + a) * 100000 + Math.floor(z / 20) + b);
      if (l) for (let i = 0; i < l.length; i += 3) if (Math.hypot(l[i] - x, l[i + 1] - z) < l[i + 2] / 2 + 1.5) return true;
    }
    return false;
  };

  const poles = []; // [x, y, z, yaw, transformer]
  const runs = []; // each a list of [x, y, z, yaw] poles in a row, wired together
  for (const [a, b, , w, , , inner, cls = 4] of G.links) {
    if (cls === 0 || cls === 5 || cls === 6) continue;
    const pts = [[N[a * 2], N[a * 2 + 1]]];
    for (let i = 0; i < inner.length; i += 2) pts.push([inner[i], inner[i + 1]]);
    pts.push([N[b * 2], N[b * 2 + 1]]);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (total < 2 * END + SPAN * 0.75) continue;
    const [mx, mz] = pts[Math.floor(pts.length / 2)];
    if (underground(mx, mz)) continue;
    // one side of the street, the same all along it; arterials a little further out
    const side = hash(Math.round(mx / 50), Math.round(mz / 50)) < 0.5 ? 1 : -1;
    const off = w / 2 + (cls <= 2 ? 1.0 : 0.75);
    const count = Math.max(1, Math.round((total - 2 * END) / SPAN));
    const step = (total - 2 * END) / count;
    let run = [];
    let seg = 1, segStart = 0;
    for (let k = 0; k <= count; k++) {
      const s = END + k * step;
      while (seg < pts.length - 1 && segStart + Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]) < s) {
        segStart += Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
        seg++;
      }
      const [x0, z0] = pts[seg - 1], [x1, z1] = pts[seg];
      const L = Math.hypot(x1 - x0, z1 - z0) || 1, tx = (x1 - x0) / L, tz = (z1 - z0) / L, t = Math.min(L, s - segStart);
      // the right-hand curb going this way is (-tz, tx) (x east, z south)
      let x = x0 + tx * t - tz * off * side, z = z0 + tz * t + tx * off * side;
      // nudged along the curb off a driveway, else left out (and the run broken there)
      let ok = false;
      for (const d of [0, 2.5, -2.5, 5, -5]) {
        const px = x + tx * d, pz = z + tz * d;
        if (blockAt(px, pz) && !onCut(px, pz) && !underground(px, pz)) { x = px; z = pz; ok = true; break; }
      }
      if (!ok) { if (run.length > 1) runs.push(run); run = []; continue; }
      const p = [x, groundHeight(x, z), z, Math.atan2(tx, tz), hash(x, z) < 0.12];
      poles.push(p);
      run.push(p);
    }
    if (run.length > 1) runs.push(run);
  }
  if (!poles.length) return { poles: 0, spans: 0, obstacles: [] };

  // The poles: a tapered weathered cedar pole with its crossarm (across the line), two insulators' braces, and a
  // transformer can on some
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x6e5e4c, roughness: 0.95 });
  const gray = new THREE.MeshStandardNodeMaterial({ color: 0x8a8d8f, roughness: 0.6, metalness: 0.4 });
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.16, POLE_H, 7).translate(0, POLE_H / 2, 0),
    new THREE.BoxGeometry(2.4, 0.1, 0.1).translate(0, ARM_Y, 0),
    new THREE.BoxGeometry(0.05, 0.6, 0.05).rotateZ(0.8).translate(-0.4, ARM_Y - 0.25, 0),
    new THREE.BoxGeometry(0.05, 0.6, 0.05).rotateZ(-0.8).translate(0.4, ARM_Y - 0.25, 0)
  ]);
  const canGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10).translate(0, 7.9, 0.38),
    ...[-1.05, 0, 1.05].map((ax) => new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6).translate(ax, ARM_Y + 0.13, 0))
  ]);
  const insGeo = mergeGeometries([-1.05, 0, 1.05].map((ax) => new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6).translate(ax, ARM_Y + 0.13, 0)));
  const dummy = new THREE.Object3D();
  const at = (p) => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(0, p[3], 0); dummy.updateMatrix(); return dummy.matrix; };
  const polesMesh = new THREE.InstancedMesh(poleGeo, wood, poles.length);
  poles.forEach((p, i) => polesMesh.setMatrixAt(i, at(p)));
  const withCan = poles.filter((p) => p[4]), bare = poles.filter((p) => !p[4]);
  const cansMesh = new THREE.InstancedMesh(canGeo, gray, Math.max(1, withCan.length));
  withCan.forEach((p, i) => cansMesh.setMatrixAt(i, at(p)));
  cansMesh.count = withCan.length;
  const insMesh = new THREE.InstancedMesh(insGeo, gray, Math.max(1, bare.length));
  bare.forEach((p, i) => insMesh.setMatrixAt(i, at(p)));
  insMesh.count = bare.length;
  for (const [m, name, reach] of [[polesMesh, 'UtilityPoles', 900], [cansMesh, 'UtilityTransformers', 400], [insMesh, 'UtilityInsulators', 300]]) {
    m.name = name;
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = m === polesMesh;
    m.userData.cullDistance = reach;
    m.userData.terrain = 'set';
    group.add(m);
  }

  // The wires: three power lines off the crossarm's ends and middle, the phone and cable lines lower on the pole's
  // street side, each a catenary sagging from pole to pole; thin lines that fade out past ~250 m
  const WIRES = [[-1.05, ARM_Y + 0.2, 0.7], [0, ARM_Y + 0.2, 0.7], [1.05, ARM_Y + 0.2, 0.7], [0, 6.6, 0.45], [0, 6.1, 0.5]];
  const cells = new Map();
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const p = run[i - 1], q = run[i];
      const k = Math.floor(p[0] / CELL) * 100000 + Math.floor(p[2] / CELL);
      if (!cells.has(k)) cells.set(k, []);
      const out = cells.get(k);
      for (const [ax, ay, sag] of WIRES) {
        // the arm's offset across each pole's own line
        const ex0 = Math.cos(p[3]) * ax, ez0 = -Math.sin(p[3]) * ax, ex1 = Math.cos(q[3]) * ax, ez1 = -Math.sin(q[3]) * ax;
        const A = [p[0] + ex0, p[1] + ay, p[2] + ez0], B = [q[0] + ex1, q[1] + ay, q[2] + ez1];
        const SEG = 8;
        let prev = A;
        for (let s = 1; s <= SEG; s++) {
          const u = s / SEG;
          const pt = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u - sag * 4 * u * (1 - u), A[2] + (B[2] - A[2]) * u];
          out.push(...prev, ...pt);
          prev = pt;
        }
      }
    }
  }
  const wireMat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  wireMat.colorNode = color(0x1d1e20);
  wireMat.opacityNode = smoothstep(float(260), float(110), length(positionWorld.sub(cameraPosition))).mul(0.85);
  for (const list of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    g.computeBoundingSphere();
    const lines = new THREE.LineSegments(g, wireMat);
    lines.name = 'UtilityWires';
    lines.userData.terrain = 'set';
    group.add(lines);
  }
  group.userData.terrain = 'set';
  const spans = runs.reduce((n, r) => n + r.length - 1, 0);
  log(`[utility poles] ${poles.length} poles, ${spans} spans of wire in ${cells.size} cells`);
  // solid, and too stout to knock over: the car stops dead against one, the bike throws its rider (main.js obstacleBox)
  const obstacles = poles.map((p) => ({ x: p[0], z: p[2], r: 0.17, kind: 'pole', fixed: true }));
  return { poles: poles.length, spans, obstacles };
}

export { buildUtilityPoles };
