import * as THREE from 'three/webgpu';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';
import { squareYards } from './yards.js';

// The drafted houses' yards (drafted-houses.js `yard`, from Open Facades, in the game's frame), drawn the game's way:
// fences post by post in their style and the mulch of planting beds, in the colors seen in the photos, two instanced
// draws for the lot (boxes and chain link). Shrubs, hedges and the beds' plants are drawn with the trees' own leaves
// (yardLeaves, drawn by trees.js createShrubs from street-details.js) and the trees go to the city's tree field
// (yardTreeSites). Walks, driveways and lawns are left to the map's own.

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const col = new THREE.Color();

function vary(hex, seed, amount = 0.08) {
  col.set(hex || '#556b40');
  const r = Math.sin(seed * 12.9898) * 43758.5453;
  const f = 1 + ((r - Math.floor(r)) - 0.5) * 2 * amount;
  return col.setRGB(Math.min(1, col.r * f), Math.min(1, col.g * f), Math.min(1, col.b * f));
}

// The map's driveways within reach of each drafted hedge (yards.js squares), so the hedge can be kept off them
async function hedgeDriveways(yard) {
  const hedges = yard.filter((it) => it.kind === 'hedge' && it.x != null && it.z != null);
  if (!hedges.length) return;
  const keys = new Set();
  for (const it of hedges) for (const dx of [-20, 20]) for (const dz of [-20, 20]) keys.add(Math.floor((it.x + dx) / 500) * 100000 + Math.floor((it.z + dz) / 500));
  const drives = [];
  for (const k of keys) {
    try { for (const rings of (await squareYards(k)).driveways) if (rings[0]?.length >= 6) drives.push(rings[0]); } catch { /* no yards there */ }
  }
  for (const it of hedges) {
    it.drives = drives.filter((r) => {
      for (let i = 0; i < r.length; i += 2) if (Math.abs(r[i] - it.x) < 25 && Math.abs(r[i + 1] - it.z) < 25) return true;
      return false;
    });
  }
}

// whether (x, z) is inside a flat [x, z, x, z, ...] outline
function insideFlat(r, x, z) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

// whether (x, z) is inside an outline of [x, z] points
function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

function collect(yard) {
  const boxes = [], hedges = [], blobs = [], links = [];
  // a box `w` across, `h` high and `len` long, standing at (x, y, z), its length along `yaw`
  const box = (list, x, y, z, yaw, w, h, len, color, seed) => list.push({ x, y, z, yaw, w, h, len, color: vary(color, seed).clone() });
  const ground = (x, z) => groundHeight(x, z) + LIFT.lawn;

  yard.forEach((it, n) => {
    if (it.kind === 'fence' && it.from && it.to) {
      const [ax, az] = it.from, [bx, bz] = it.to, len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) return;
      const dx = (bx - ax) / len, dz = (bz - az) / len, yaw = Math.atan2(dx, dz), h = it.h || 1;
      const at = (t) => [ax + dx * t, az + dz * t];
      const style = it.style || 'rail';
      // posts every 2.4 m and at both ends
      const posts = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k <= posts; k++) {
        const [x, z] = at(len * k / posts);
        const pw = style === 'chainlink' ? 0.06 : 0.1;
        box(boxes, x, ground(x, z), z, yaw, pw, h + 0.05, pw, style === 'chainlink' ? '#8a8c8a' : it.color, n + k);
      }
      const [mx, mz] = at(len / 2), y = ground(mx, mz);
      if (style === 'solid') box(boxes, mx, y, mz, yaw, 0.04, h, len, it.color, n);
      else if (style === 'chainlink') {
        box(boxes, mx, y + h - 0.03, mz, yaw, 0.045, 0.045, len, '#8a8c8a', n);
        links.push({ x: mx, y, z: mz, yaw, w: 0.015, h: h - 0.03, len, color: vary(it.color || '#8a8c8a', n).clone() });
      } else {
        // rails: two on a rail fence, top and bottom behind the pickets on a picket fence
        for (const f of [0.28, 0.82]) box(boxes, mx, y + h * f - 0.04, mz, yaw, 0.05, 0.08, len, it.color, n + f);
        if (style === 'picket') {
          for (let t = 0.12; t < len - 0.05; t += 0.14) {
            const [x, z] = at(t);
            box(boxes, x + Math.cos(yaw) * 0.04, ground(x, z), z - Math.sin(yaw) * 0.04, yaw, 0.022, h, 0.075, it.color, n + t);
          }
        }
      }
      return;
    }
    if (!(it.x != null && it.z != null && it.w && it.d)) return;
    const yaw = (it.rot || 0) + Math.PI / 2; // the rectangle's w lies along the draft's x: our boxes run their length along z
    const y = ground(it.x, it.z);
    if (it.kind === 'hedge') {
      // it runs along its longer side, whichever of w and d the draft gave that to
      const long = Math.max(it.w, it.d), thick = Math.min(it.w, it.d);
      const run = it.d > it.w ? (it.rot || 0) : yaw, along = [Math.sin(run), Math.cos(run)];
      let cx = it.x, cz = it.z;
      // one drafted inside its own house belongs beside it: slid across its run to the nearest place clear of the
      // house and of the map's driveways
      if (it.ring && insideRing(it.ring, cx, cz)) {
        const across = [Math.cos(run), -Math.sin(run)], drives = it.drives || [];
        const blocked = (x, z) => {
          for (const f of [-0.5, -0.25, 0, 0.25, 0.5]) for (const g of [-1, 0, 1]) {
            const px = x + along[0] * long * f + across[0] * (thick / 2 + 0.2) * g, pz = z + along[1] * long * f + across[1] * (thick / 2 + 0.2) * g;
            if (insideRing(it.ring, px, pz) || drives.some((r) => insideFlat(r, px, pz))) return true;
          }
          return false;
        };
        let best = null;
        for (const s of [1, -1]) {
          for (let t = 0.1; t < 15; t += 0.1) {
            if (blocked(cx + across[0] * s * t, cz + across[1] * s * t)) continue;
            if (!best || t < best.t) best = { t, s };
            break;
          }
        }
        if (best) { cx += across[0] * best.s * best.t; cz += across[1] * best.s * best.t; }
      }
      // a row of clipped pieces about 1.3 m long, each on the ground under it
      const pieces = Math.max(1, Math.round(long / 1.3));
      for (let k = 0; k < pieces; k++) {
        const t = ((k + 0.5) / pieces - 0.5) * long, x = cx + along[0] * t, z = cz + along[1] * t;
        hedges.push({ x, y: ground(x, z) - 0.05, z, yaw: run, w: thick, h: it.h || 1.2, len: long / pieces, color: vary(it.color, n, 0.05).clone() });
      }
    }
    else if (it.kind === 'shrub') blobs.push({ x: it.x, y: y - 0.1, z: it.z, yaw, w: it.d, h: it.h || 1, len: it.w, color: vary(it.color, n).clone() });
    else if (it.kind === 'bed') {
      // mulch and low plants along it
      box(boxes, it.x, y - 0.06, it.z, yaw, it.d, 0.14, it.w, it.color || '#4a3a2c', n);
      const along = [Math.sin(yaw), Math.cos(yaw)], plants = Math.max(1, Math.floor(it.w / 1.1));
      for (let k = 0; k < plants; k++) {
        const t = (k + 0.5) / plants - 0.5;
        const x = it.x + along[0] * t * it.w, z = it.z + along[1] * t * it.w;
        const s = Math.min(1, it.d * 0.75);
        blobs.push({ x, y: y - 0.02, z, yaw, w: s, h: 0.55, len: s * 1.1, color: vary(k % 3 ? '#4f6a38' : '#6b7d3a', n + k, 0.15).clone() });
      }
    }
  });

  return { boxes, hedges, blobs, links };
}

function buildDraftedYard(group, yard) {
  const { boxes, links } = collect(yard);
  const place = (geo, mat, list, name, shadow) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, i) => {
      tmpQ.setFromAxisAngle(UP, b.yaw);
      mesh.setMatrixAt(i, tmpM.compose(tmpP.set(b.x, b.y, b.z), tmpQ, tmpS.set(b.w, b.h, b.len)));
      mesh.setColorAt(i, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  place(unitBox, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.85 }), boxes, 'DraftedYardBoxes', true);
  place(unitBox, new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, transparent: true, opacity: 0.4, depthWrite: false }), links, 'DraftedYardChainLink', false);
  return { boxes: boxes.length, links: links.length };
}

// The yard's shrubs, the beds' plants and the hedges (in pieces) as trees.js createShrubs takes them
function yardLeaves(yard) {
  const { hedges, blobs } = collect(yard);
  return { bushes: blobs, hedges };
}

// The yard's trees as the city's tree field takes them (trees.js): its real height, a kind picked from the leaves,
// shape and size Open Facades saw, standing in the lawn
function yardTreeSites(yard) {
  const sites = [];
  for (const t of yard) {
    if (t.kind !== 'tree' || t.x == null || t.z == null) continue;
    const h = Math.max(2.5, t.h || 8);
    const species = t.leaves === 'evergreen' || t.shape === 'conical' ? 6
      : t.shape === 'columnar' ? 2
        : t.shape === 'spreading' ? (h >= 11 ? 4 : 1)
          : h < 7 ? 5 : 3;
    sites.push({ x: t.x, y: LIFT.lawn, z: t.z, scale: 1, height: h, species, noPit: true, drafted: true });
  }
  return sites;
}

export { buildDraftedYard, hedgeDriveways, yardTreeSites, yardLeaves };
