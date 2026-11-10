// js/ground-core.js
// The ground's height and the cutting of flat ground layers to follow it, as plain functions of the heights' data
// (`g`, from terrain.js: { x0, z0, step, cols, rows, heights, river }). Nothing here touches three.js or the page, so
// terrain.js and the workers that cut the ground layers on other cores (drape-worker.js) run the very same code.

// Beyond the heights' edge (a few kilometres past the town, where the helicopter still flies and the country is drawn)
// the ground is held at its edge and eased over `FAR_EASE` metres to the edge's average height, the level of the
// horizon's farmland, rather than dropping to 0 in a straight cliff.
const FAR_EASE = 1500;
export function baseHeight(g, x, z) {
  let fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  if (!(fx === fx && fz === fz)) return 0;
  const mx = g.cols - 1.001, mz = g.rows - 1.001;
  const out = Math.max(-fx, fx - mx, -fz, fz - mz, 0) * g.step;
  if (out > 0) { fx = Math.min(Math.max(fx, 0), mx); fz = Math.min(Math.max(fz, 0), mz); }
  const c = Math.floor(fx), r = Math.floor(fz), ax = fx - c, az = fz - r;
  const h = g.heights, i = r * g.cols + c;
  const at = (h[i] * (1 - ax) + h[i + 1] * ax) * (1 - az) + (h[i + g.cols] * (1 - ax) + h[i + g.cols + 1] * ax) * az;
  if (!(out > 0)) return at;
  if (g.horizon === undefined) {
    let sum = 0, n = 0;
    for (let k = 0; k < g.cols; k++) { sum += h[k] + h[(g.rows - 1) * g.cols + k]; n += 2; }
    for (let k = 1; k + 1 < g.rows; k++) { sum += h[k * g.cols] + h[k * g.cols + g.cols - 1]; n += 2; }
    g.horizon = sum / n;
  }
  const t = Math.min(1, out / FAR_EASE), ease = t * t * (3 - 2 * t);
  return at + (g.horizon - at) * ease;
}

// How far (0-1) the ground at (x, z) is dug down to the river's bed. The river's cells are kept in blocks of 64 × 64
// (`r.digBlocks`, `r.bcols` of them a row, null where a block has no water: terrain.js packDig), as the water covers a
// few hundredths of the grid.
export function digCell(r, c, w) {
  // (before terrain.js packs it, while the cascades and footbridge channels are carved, it's still the dense grid)
  if (!r.digBlocks) return r.dig[w * r.dcols + c] || 0;
  const b = r.digBlocks[(w >> 6) * r.bcols + (c >> 6)];
  return b ? b[((w & 63) << 6) | (c & 63)] : 0;
}
export function digAt(r, x, z) {
  const fx = (x - r.dx0) / r.dstep, fz = (z - r.dz0) / r.dstep;
  if (!(fx >= 0 && fz >= 0 && fx < r.dcols - 1 && fz < r.drows - 1)) return 0;
  const c = Math.floor(fx), w = Math.floor(fz), ax = fx - c, az = fz - w;
  const d0 = digCell(r, c, w), d1 = digCell(r, c + 1, w), d2 = digCell(r, c, w + 1), d3 = digCell(r, c + 1, w + 1);
  if (!(d0 | d1 | d2 | d3)) return 0;
  return ((d0 * (1 - ax) + d1 * ax) * (1 - az) + (d2 * (1 - ax) + d3 * ax) * az) / 255;
}

export function levelAt(r, x, z) {
  const fx = Math.min(Math.max((x - r.lx0) / r.lstep, 0), r.lcols - 1.001);
  const fz = Math.min(Math.max((z - r.lz0) / r.lstep, 0), r.lrows - 1.001);
  const c = Math.floor(fx), w = Math.floor(fz), ax = fx - c, az = fz - w, h = r.level, i = w * r.lcols + c;
  return (h[i] * (1 - ax) + h[i + 1] * ax) * (1 - az) + (h[i + r.lcols] * (1 - ax) + h[i + r.lcols + 1] * ax) * az;
}

export const BUCKET = 32;
export const bucketKey = (bx, bz) => bx * 100003 + bz;

// The ground at (x, z) on a street's or railway's bridge deck, eased in from the ground over its first and last 8 m
export function onDeck(r, x, z, h) {
  const list = r.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!list) return h;
  for (const { deck, a, b } of list) {
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez;
    const t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
    if (t < -0.2 || t > 1.2) continue;
    const u = Math.min(1, Math.max(0, t));
    if (Math.hypot(x - a[0] - ex * u, z - a[1] - ez * u) > deck.half) continue;
    const s = a[2] + (b[2] - a[2]) * u, top = a[3] + (b[3] - a[3]) * u;
    const w = Math.min(1, Math.min(s, deck.length - s) / 8);
    return h + (top - h) * w;
  }
  return h;
}

// The ground at (x, z) under any bridge: the river's banks and bed where it's dug out
export function riverbedOf(g, x, z) {
  let h = baseHeight(g, x, z);
  const r = g.river;
  const f = r ? digAt(r, x, z) : 0;
  if (f > 0) {
    const bed = levelAt(r, x, z) - 1.8;
    if (bed < h) h += (bed - h) * f;
  }
  return h;
}

// The ground's height at (x, z): in the river dug down to its bed, on a bridge its deck
export function groundOf(g, x, z) {
  const r = g.river;
  return r ? onDeck(r, x, z, riverbedOf(g, x, z)) : baseHeight(g, x, z);
}

// A layer is a flat triangle list in world space: { count, attrs: [{ name, array, itemSize, normalized }] }, every
// three vertices a triangle. Cut finer where the ground (`h(x, z)`) bends away from its triangles, so a polygon drawn as
// a few long slivers can follow it: a triangle is split (at the middle of its longest edge) while the ground under its
// edges' middles, quarters and centre strays more than `tolerance` metres from the plane through its corners, down to
// edges of `minEdge`. Flat ground isn't cut at all. Every attribute is interpolated, in its own number type.
export function tessellateLayer(layer, tolerance, minEdge, h) {
  const { attrs, count } = layer;
  const sizes = attrs.map((a) => a.itemSize);
  const offsets = [];
  let stride = 0;
  for (const size of sizes) { offsets.push(stride); stride += size; }
  const P = offsets[attrs.findIndex((a) => a.name === 'position')];
  const min2 = minEdge * minEdge;

  const strays = (a, b, c) => {
    const ax = a[P], az = a[P + 2], bx = b[P], bz = b[P + 2], cx = c[P], cz = c[P + 2];
    const ab = (ax - bx) ** 2 + (az - bz) ** 2, bc = (bx - cx) ** 2 + (bz - cz) ** 2, ca = (cx - ax) ** 2 + (cz - az) ** 2;
    if (Math.max(ab, bc, ca) <= min2) return false;
    const ha = h(ax, az), hb = h(bx, bz), hc = h(cx, cz);
    for (const [u, v] of [[0.5, 0.5], [0.25, 0.75], [0.75, 0.25]]) {
      if (Math.abs(h(ax * u + bx * v, az * u + bz * v) - (ha * u + hb * v)) > tolerance) return true;
      if (Math.abs(h(bx * u + cx * v, bz * u + cz * v) - (hb * u + hc * v)) > tolerance) return true;
      if (Math.abs(h(cx * u + ax * v, cz * u + az * v) - (hc * u + ha * v)) > tolerance) return true;
    }
    return Math.abs(h((ax + bx + cx) / 3, (az + bz + cz) / 3) - (ha + hb + hc) / 3) > tolerance;
  };

  let out = new Float32Array(count * stride + stride * 3);
  let used = 0;
  const write = (v) => {
    if (used + stride > out.length) { const grown = new Float32Array(out.length * 2); grown.set(out); out = grown; }
    out.set(v, used);
    used += stride;
  };
  const vertex = (i) => {
    const v = new Float32Array(stride);
    attrs.forEach((a, n) => { for (let k = 0; k < sizes[n]; k++) v[offsets[n] + k] = a.array[i * sizes[n] + k]; });
    return v;
  };
  const d2 = (a, b) => (a[P] - b[P]) ** 2 + (a[P + 2] - b[P + 2]) ** 2;
  const mid = (a, b) => { const m = new Float32Array(stride); for (let k = 0; k < stride; k++) m[k] = (a[k] + b[k]) / 2; return m; };
  const split = (a, b, c, depth) => {
    if (depth > 24 || !strays(a, b, c)) { write(a); write(b); write(c); return; }
    const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), longest = Math.max(ab, bc, ca);
    // The longest edge split at its middle, keeping the winding.
    if (longest === ab) { const m = mid(a, b); split(a, m, c, depth + 1); split(m, b, c, depth + 1); }
    else if (longest === bc) { const m = mid(b, c); split(a, b, m, depth + 1); split(a, m, c, depth + 1); }
    else { const m = mid(c, a); split(a, b, m, depth + 1); split(m, b, c, depth + 1); }
  };
  // Most triangles are small: those are copied straight across without being looked at further.
  const pos = attrs.find((a) => a.name === 'position').array;
  const small = (i) => {
    const ax = pos[i * 3], az = pos[i * 3 + 2], bx = pos[i * 3 + 3], bz = pos[i * 3 + 5], cx = pos[i * 3 + 6], cz = pos[i * 3 + 8];
    return (ax - bx) ** 2 + (az - bz) ** 2 <= min2 && (bx - cx) ** 2 + (bz - cz) ** 2 <= min2 && (cx - ax) ** 2 + (cz - az) ** 2 <= min2;
  };
  const copy = (i) => {
    if (used + stride * 3 > out.length) { const grown = new Float32Array(out.length * 2); grown.set(out); out = grown; }
    for (let v = i; v < i + 3; v++) {
      for (let n = 0; n < attrs.length; n++) {
        const a = attrs[n].array, size = sizes[n], o = used + offsets[n];
        for (let k = 0; k < size; k++) out[o + k] = a[v * size + k];
      }
      used += stride;
    }
  };
  for (let i = 0; i < count; i += 3) {
    if (small(i)) copy(i);
    else split(vertex(i), vertex(i + 1), vertex(i + 2), 0);
  }
  const vertices = used / stride;
  if (vertices === count) return layer;
  return {
    count: vertices,
    attrs: attrs.map((a, k) => {
      const Kind = a.array.constructor;
      const whole = Kind !== Float32Array && Kind !== Float64Array;
      const data = new Kind(vertices * sizes[k]);
      for (let v = 0; v < vertices; v++) for (let j = 0; j < sizes[k]; j++) {
        const value = out[v * stride + offsets[k] + j];
        data[v * sizes[k] + j] = whole ? Math.round(value) : value;
      }
      return { name: a.name, array: data, itemSize: a.itemSize, normalized: a.normalized };
    })
  };
}

// ---- The city's ground as one mesh of right triangles (g.core, terrain.js) -----------------------------------------
// Heights in centimetres on a square grid of 2^k + 1 samples a side, and which of the grid's right triangles are cut in
// two (a bit each, at the middle of its long edge, as Martini, mapbox's terrain mesher, cuts them): the cut is made
// wherever the triangle strays from the samples under it by more than the tolerance, and a triangle is cut whenever
// one inside it is, so neighbours always share their edges. The ground is flat across each uncut triangle. Every
// ground layer is cut along the same edges and raised by the same planes (cutToGround), so a road, the sidewalk beside
// it and the lawn behind it stay their own height apart on any slope, and can't cross.

// (kept 100 m up, so the river's bed, dug below the city's base, stays in range)
export const CORE_FLOOR = -100;
export const coreHeightAt = (c, i) => c.cm[i] * 0.01 + CORE_FLOOR;
const isSplit = (c, i) => (c.split[i >> 3] >> (i & 7)) & 1;

// Which uncut triangle (fx, fz) (in samples from the grid's corner) lies on, as its corners [ax, az, bx, bz, cx, cz]
// (a-b its long edge, c its right angle), written into `t`
function leafOf(c, fx, fz, t) {
  const max = c.size - 1, size = c.size;
  let ax, az, bx, bz, cx, cz;
  if (fx >= fz) { ax = 0; az = 0; bx = max; bz = max; cx = max; cz = 0; }
  else { ax = max; az = max; bx = 0; bz = 0; cx = 0; cz = max; }
  for (;;) {
    if (Math.abs(ax - cx) + Math.abs(az - cz) <= 1) break;
    const mx = (ax + bx) >> 1, mz = (az + bz) >> 1;
    if (!isSplit(c, mz * size + mx)) break;
    // its halves (c, a, m) and (b, c, m), either side of the line from c to m
    const side = (mx - cx) * (fz - cz) - (mz - cz) * (fx - cx);
    const sa = (mx - cx) * (az - cz) - (mz - cz) * (ax - cx);
    if (side * sa >= 0) { const nx = ax, nz = az; ax = cx; az = cz; bx = nx; bz = nz; }
    else { ax = bx; az = bz; bx = cx; bz = cz; }
    cx = mx; cz = mz;
  }
  t[0] = ax; t[1] = az; t[2] = bx; t[3] = bz; t[4] = cx; t[5] = cz;
  return t;
}

// The height at (fx, fz) on the plane through a triangle's corners
function onPlane(c, t, fx, fz) {
  const [ax, az, bx, bz, cx, cz] = t, size = c.size;
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  const l1 = ((bz - cz) * (fx - cx) + (cx - bx) * (fz - cz)) / det;
  const l2 = ((cz - az) * (fx - cx) + (ax - cx) * (fz - cz)) / det;
  return l1 * coreHeightAt(c, az * size + ax) + l2 * coreHeightAt(c, bz * size + bx) + (1 - l1 - l2) * coreHeightAt(c, cz * size + cx);
}

const scratch = new Int32Array(6);
// The ground's height at (x, z) on the city's mesh (held to its edge outside it)
export function coreHeight(c, x, z) {
  const max = c.size - 1;
  let fx = (x - c.x0) / c.step, fz = (z - c.z0) / c.step;
  fx = fx < 0 ? 0 : fx > max ? max : fx;
  fz = fz < 0 ? 0 : fz > max ? max : fz;
  return onPlane(c, leafOf(c, fx, fz, scratch), fx, fz);
}
export const inCore = (c, x, z) => x >= c.x0 && z >= c.z0 && x <= c.x0 + (c.size - 1) * c.step && z <= c.z0 + (c.size - 1) * c.step;

// Which triangles to cut so none strays more than `tolerance` metres from the heights: Martini's errors, worked out
// from the smallest triangles up, each as the most any triangle inside it strays. Answers the bits for each tolerance.
// A triangle `smallest` samples or less across its short sides is cut only where it strays `small` times the tolerance:
// a bank or a street's edge, not every hummock of a lawn.
// Worked out level by level over the grid's points rather than triangle by triangle from the root (several times
// faster, the same bits): for s = 1, 2, 4 ..., first the long edges 2s long, each with the two triangles either side of
// it (their halves' long edges end at the four points s/2 away diagonally), then the squares 2s a side, cut along the
// diagonal that runs through the middle of the square each is a quarter of (their halves' long edges are its sides).
export function splitsOf(c, tolerances, smallest = 1, small = 1) {
  const size = c.size, max = size - 1, errors = new Float32Array(size * size), cm = c.cm;
  for (let s = 1; s < max; s <<= 1) {
    const eased = 2 * s <= smallest, h = s >> 1, row = s * size, nz = h * size;
    // the edges: middles at multiples of s with x/s + z/s odd, along x where x/s is odd
    for (let z = 0; z <= max; z += s) {
      const up = z - h >= 0, down = z + h <= max;
      for (let x = (z / s) & 1 ? 0 : s; x <= max; x += 2 * s) {
        const m = z * size + x, along = (x / s) & 1 ? s : row;
        let e = Math.abs((cm[m - along] + cm[m + along]) * 0.005 - cm[m] * 0.01);
        if (eased) e /= small;
        if (h) {
          const left = x - h >= 0, right = x + h <= max;
          if (up && left && errors[m - nz - h] > e) e = errors[m - nz - h];
          if (up && right && errors[m - nz + h] > e) e = errors[m - nz + h];
          if (down && left && errors[m + nz - h] > e) e = errors[m + nz - h];
          if (down && right && errors[m + nz + h] > e) e = errors[m + nz + h];
        }
        errors[m] = e;
      }
    }
    // the squares: middles where x/s and z/s are both odd
    for (let z = s; z < max; z += 2 * s) {
      const pz = ((z - s) / (2 * s)) & 1 ? -1 : 1;
      for (let x = s; x < max; x += 2 * s) {
        const m = z * size + x, px = ((x - s) / (2 * s)) & 1 ? -1 : 1;
        const corner = px * pz > 0 ? row + s : row - s; // (x ± s, z ± s) together, or the other two corners
        let e = Math.abs((cm[m - corner] + cm[m + corner]) * 0.005 - cm[m] * 0.01);
        if (eased) e /= small;
        if (errors[m - s] > e) e = errors[m - s];
        if (errors[m + s] > e) e = errors[m + s];
        if (errors[m - row] > e) e = errors[m - row];
        if (errors[m + row] > e) e = errors[m + row];
        errors[m] = e;
      }
    }
  }
  return tolerances.map((tolerance) => {
    const split = new Uint8Array((size * size + 7) >> 3);
    for (let i = 0; i < errors.length; i++) if (errors[i] > tolerance) split[i >> 3] |= 1 << (i & 7);
    return split;
  });
}

// How far the coarser cut (`under`, bits from splitsOf at a larger tolerance) rises over the city's mesh, by the corners
// of its triangles: a Map of grid index to the most any triangle at that corner stands above the fine one, so the
// coarse ground lowered that much more stays under it everywhere. The fine mesh is the coarse one cut further, so the
// most it lies under the coarse is at its own vertices: those the coarse cut hasn't got.
export function underDrops(c, under) {
  const size = c.size, coarse = { size, cm: c.cm, split: under }, leaf = new Int32Array(6), drops = new Map();
  for (let i = 0; i < size * size; i++) {
    if (!((c.split[i >> 3] >> (i & 7)) & 1) || ((under[i >> 3] >> (i & 7)) & 1)) continue;
    const x = i % size, z = (i - x) / size;
    leafOf(coarse, x, z, leaf);
    const above = onPlane(coarse, leaf, x, z) - coreHeightAt(c, i);
    if (!(above > 0)) continue;
    for (let k = 0; k < 6; k += 2) {
      const j = leaf[k + 1] * size + leaf[k];
      if (!(drops.get(j) >= above)) drops.set(j, above);
    }
  }
  return drops;
}

// The mesh's uncut triangles by these bits (splitsOf), as ax, az, bx, bz, cx, cz in samples, one after another
export function coreTriangles(c, split = c.split) {
  const size = c.size, max = size - 1, out = [];
  const walk = (ax, az, bx, bz, cx, cz) => {
    const mx = (ax + bx) >> 1, mz = (az + bz) >> 1;
    if (Math.abs(ax - cx) + Math.abs(az - cz) > 1 && (split[(mz * size + mx) >> 3] >> ((mz * size + mx) & 7)) & 1) {
      walk(cx, cz, ax, az, mx, mz);
      walk(bx, bz, cx, cz, mx, mz);
    } else out.push(ax, az, bx, bz, cx, cz);
  };
  walk(0, 0, max, max, max, 0);
  walk(max, max, 0, 0, 0, max);
  return out;
}

// A layer cut along the city's mesh and each vertex raised by the ground's plane under it: a layer's triangle is split
// along each long edge it crosses, down the tree of triangles to the uncut ones, every attribute interpolated where an
// edge crosses it. Upright faces (a curb's) are cut the same way, so they stand as tall on a slope as on the flat.
export function cutToGround(c, layer) {
  const { attrs, count } = layer;
  const sizes = attrs.map((a) => a.itemSize);
  const offsets = [];
  let stride = 0;
  for (const size of sizes) { offsets.push(stride); stride += size; }
  const P = offsets[attrs.findIndex((a) => a.name === 'position')];
  const size = c.size, max = size - 1, inv = 1 / c.step;
  let out = new Float64Array(Math.max(64, count * stride * 2));
  let used = 0;
  const leaf = new Int32Array(6);
  const emit = (poly, t) => {
    const n = poly.length;
    if (n < 3) return;
    const need = (n - 2) * 3 * stride;
    if (used + need > out.length) { const grown = new Float64Array(Math.max(out.length * 2, used + need)); grown.set(out); out = grown; }
    // (copies raised, never the polygon's own vertices: the piece beside it shares them and is cut after)
    const lift = poly.map((v) => onPlane(c, t, gx(v), gz(v)));
    const put = (k) => { out.set(poly[k], used); out[used + P + 1] += lift[k]; used += stride; };
    for (let k = 1; k + 1 < n; k++) { put(0); put(k); put(k + 1); }
  };
  const gx = (v) => Math.min(max, Math.max(0, (v[P] - c.x0) * inv));
  const gz = (v) => Math.min(max, Math.max(0, (v[P + 2] - c.z0) * inv));
  const EPS = 1e-7;
  const lerp = (a, b, t) => { const m = new Float64Array(stride); for (let k = 0; k < stride; k++) m[k] = a[k] + (b[k] - a[k]) * t; return m; };
  // The polygon cut by the line through (px, pz) and (qx, qz): the part on the side `s` (+1/-1) of it and the other
  const cut = (poly, px, pz, qx, qz) => {
    const ex = qx - px, ez = qz - pz, len = Math.hypot(ex, ez);
    const d = poly.map((v) => (ex * (gz(v) - pz) - ez * (gx(v) - px)) / len);
    let pos = false, neg = false;
    for (const x of d) { if (x > EPS) pos = true; else if (x < -EPS) neg = true; }
    if (!neg) return [poly, null];
    if (!pos) return [null, poly];
    const a = [], b = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length, u = poly[i], w = poly[j], du = d[i], dw = d[j];
      if (du >= -EPS) a.push(u);
      if (du <= EPS) b.push(u);
      if ((du > EPS && dw < -EPS) || (du < -EPS && dw > EPS)) { const m = lerp(u, w, du / (du - dw)); a.push(m); b.push(m); }
    }
    return [a.length >= 3 ? a : null, b.length >= 3 ? b : null];
  };
  const walk = (poly, ax, az, bx, bz, cx, cz) => {
    const mx = (ax + bx) >> 1, mz = (az + bz) >> 1;
    if (!(Math.abs(ax - cx) + Math.abs(az - cz) > 1 && isSplit(c, mz * size + mx))) {
      leaf[0] = ax; leaf[1] = az; leaf[2] = bx; leaf[3] = bz; leaf[4] = cx; leaf[5] = cz;
      emit(poly, leaf);
      return;
    }
    // the half with a in it lies on a's side of the line from c to m
    const [pa, pb] = cut(poly, cx, cz, mx, mz);
    const aSide = (mx - cx) * (az - cz) - (mz - cz) * (ax - cx) > 0;
    const withA = aSide ? pa : pb, withB = aSide ? pb : pa;
    if (withA) walk(withA, cx, cz, ax, az, mx, mz);
    if (withB) walk(withB, bx, bz, cx, cz, mx, mz);
  };
  const vertex = (i) => {
    const v = new Float64Array(stride);
    for (let n = 0; n < attrs.length; n++) for (let k = 0; k < sizes[n]; k++) v[offsets[n] + k] = attrs[n].array[i * sizes[n] + k];
    return v;
  };
  const inside = (t, fx, fz) => {
    const [ax, az, bx, bz, cx, cz] = t;
    const s1 = (bx - ax) * (fz - az) - (bz - az) * (fx - ax);
    const s2 = (cx - bx) * (fz - bz) - (cz - bz) * (fx - bx);
    const s3 = (ax - cx) * (fz - cz) - (az - cz) * (fx - cx);
    return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
  };
  for (let i = 0; i < count; i += 3) {
    const tri = [vertex(i), vertex(i + 1), vertex(i + 2)];
    // most triangles are small: when the uncut triangle under its middle holds all three corners it's laid whole
    const mx = (gx(tri[0]) + gx(tri[1]) + gx(tri[2])) / 3, mz = (gz(tri[0]) + gz(tri[1]) + gz(tri[2])) / 3;
    leafOf(c, mx, mz, leaf);
    if (tri.every((v) => inside(leaf, gx(v), gz(v)))) { emit(tri, leaf); continue; }
    // else down the tree from its two halves, either side of the grid's diagonal
    const [up, down] = cut(tri, 0, 0, max, max);
    // the side of the diagonal (0,0)-(max,max) where (max, 0) lies is the negative one here
    if (down) walk(down, 0, 0, max, max, max, 0);
    if (up) walk(up, max, max, 0, 0, 0, max);
  }
  const vertices = used / stride;
  return {
    count: vertices,
    attrs: attrs.map((a, k) => {
      const Kind = a.array.constructor;
      const whole = Kind !== Float32Array && Kind !== Float64Array;
      const data = new Kind(vertices * sizes[k]);
      for (let v = 0; v < vertices; v++) for (let j = 0; j < sizes[k]; j++) {
        const value = out[v * stride + offsets[k] + j];
        data[v * sizes[k] + j] = whole ? Math.round(value) : value;
      }
      return { name: a.name, array: data, itemSize: a.itemSize, normalized: a.normalized };
    })
  };
}

// A cut layer with each vertex the pieces share kept once (to the millimetre, every other attribute alike) and an index
// of its triangles: the cut lays every polygon as a fan, so most vertices come several times over
export function indexLayer(layer) {
  const { attrs, count } = layer;
  const P = attrs.findIndex((a) => a.name === 'position');
  const seen = new Map(), keep = new Int32Array(count), index = new Uint32Array(count);
  let unique = 0;
  for (let v = 0; v < count; v++) {
    let key = '';
    for (let n = 0; n < attrs.length; n++) {
      const { array, itemSize } = attrs[n], q = n === P ? 1000 : 10000;
      for (let k = 0; k < itemSize; k++) key += Math.round(array[v * itemSize + k] * q) + ',';
    }
    let i = seen.get(key);
    if (i === undefined) { seen.set(key, (i = unique++)); keep[i] = v; }
    index[v] = i;
  }
  return {
    count: unique, index,
    attrs: attrs.map((a) => {
      const data = new a.array.constructor(unique * a.itemSize);
      for (let i = 0; i < unique; i++) for (let k = 0; k < a.itemSize; k++) data[i * a.itemSize + k] = a.array[keep[i] * a.itemSize + k];
      return { name: a.name, array: data, itemSize: a.itemSize, normalized: a.normalized };
    })
  };
}

// How far a bridge's deck lifts the ground at (x, z) over the city's mesh (0 off every deck)
function deckLift(g, x, z) {
  const r = g.river;
  if (!r || !r.buckets.has(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)))) return 0;
  const h = coreHeight(g.core, x, z);
  return onDeck(r, x, z, h) - h;
}

// A layer cut to follow the ground (unless `tolerance` is 0) and every vertex raised by the ground under it. The
// layer's own position array is raised in place when it isn't cut. On the city's mesh (g.core) every layer is cut
// along its triangles, and only where a bridge's deck lifts it cut finer by `tolerance` as well, and comes back indexed.
export function drapeLayer(g, layer, tolerance) {
  if (g.core) {
    let out = cutToGround(g.core, layer);
    const lift = (x, z) => deckLift(g, x, z);
    if (tolerance) out = tessellateLayer(out, tolerance, 10, lift);
    const pos = out.attrs.find((a) => a.name === 'position').array;
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] += lift(pos[i], pos[i + 2]);
    return indexLayer(out);
  }
  const h = (x, z) => groundOf(g, x, z);
  const out = tolerance ? tessellateLayer(layer, tolerance, 10, h) : layer;
  const pos = out.attrs.find((a) => a.name === 'position').array;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] += h(pos[i], pos[i + 2]);
  return out;
}

// What the cutting depends on, as text, so a change to any of it makes the saved ground layers again (terrain.js)
export const CORE_SOURCE = [baseHeight, digCell, digAt, levelAt, onDeck, riverbedOf, groundOf, tessellateLayer, drapeLayer,
  leafOf, onPlane, coreHeight, cutToGround, deckLift, indexLayer]
  .map((f) => f.toString()).join('\n');
