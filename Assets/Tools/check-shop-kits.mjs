// Checks the rooms behind the shopfronts' glass (Web/js/shop-kits*.js) without a browser, and draws one from above.
//   node Assets/Tools/check-shop-kits.mjs            every kit and variant: triangles, people's places, what's wrong
//   node Assets/Tools/check-shop-kits.mjs cafe~1     the same for one, and a plan of it (10 cm a character across,
//                                                    20 cm down; the street and the glass at the bottom, the door at
//                                                    the bottom left)
// The plan: '.' floor, digits how high what stands there is (1 = under 0.5 m, 2 = under 1 m, 3 = under 1.5 m,
// 4 = under 2 m, 5 = taller; lamps and things above 2.3 m that don't reach lower aren't drawn), letters the people
// (capitals the staff): the arrow after each in the list is the way they face.
// What it calls wrong: a place outside the room or inside the door's clear corner (x < -1.9, z < 1.6), two people in
// one another's way, someone standing in furniture taller than 0.55 m (a seat is fine), a vertex outside the room.
import { register } from 'node:module';
register(new URL('./kit-hooks.mjs', import.meta.url));
const { shopKit, kitVariants, KIT_NAMES } = await import(new URL('../../Web/js/shop-kits.js', import.meta.url));
const H0 = 3.5, D0 = 5.5, HT = 3.2;

function check(name, draw) {
  const kit = shopKit(name);
  const P = kit.geometry.getAttribute('position').array, X = kit.geometry.getAttribute('aux').array;
  const NX = 70, NZ = 28, grid = new Float32Array(NX * NZ);
  const fine = new Float32Array(70 * 55); // 10 cm cells, for who stands in what
  const problems = [];
  let outside = 0;
  for (let t = 0; t < P.length; t += 9) {
    let x0 = 9, x1 = -9, z0 = 9, z1 = -9, y0 = 9, y1 = -9, shell = false;
    for (let k = 0; k < 3; k++) {
      const x = P[t + k * 3], y = P[t + k * 3 + 1], z = P[t + k * 3 + 2], slot = X[(t / 3 + k) * 4 + 2];
      if (Number.isNaN(x + y + z)) { problems.push('a NaN vertex'); return { kit, problems }; }
      if (Math.abs(x) > H0 + 0.02 || z < -0.02 || z > D0 + 0.02 || y < -0.02 || y > HT + 0.02) outside++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (slot === 1 || slot === 2 || slot === 5 || slot === 6 || slot === 7) shell = true;
    }
    if (y1 < 0.06 || y0 > 2.3) continue; // the floor, a rug, a shadow; a lamp, a ceiling panel
    if (shell && (x1 - x0 > 6 || z1 - z0 > 5)) continue; // the room's own walls
    if ((x1 - x0) * (z1 - z0) > 6) continue;
    const h = Math.min(y1, 2.4);
    for (let ix = Math.max(0, Math.floor((x0 + H0) * 10)); ix <= Math.min(69, Math.floor((x1 + H0) * 10 - 1e-6)); ix++) {
      for (let iz = Math.max(0, Math.floor(z0 * 10)); iz <= Math.min(54, Math.floor(z1 * 10 - 1e-6)); iz++) {
        if (y0 < 1.5) fine[iz * 70 + ix] = Math.max(fine[iz * 70 + ix], h);
        const g = Math.floor(iz / 2) * NX + ix;
        if (Math.floor(iz / 2) < NZ) grid[g] = Math.max(grid[g], h);
      }
    }
  }
  if (outside) problems.push(`${outside} vertices outside the room`);
  const heightAt = (x, z) => {
    let h = 0;
    for (let dx = 0; dx <= 0; dx++) for (let dz = 0; dz <= 0; dz++) {
      const ix = Math.floor((x + H0) * 10) + dx, iz = Math.floor(z * 10) + dz;
      if (ix >= 0 && ix < 70 && iz >= 0 && iz < 55) h = Math.max(h, fine[iz * 70 + ix]);
    }
    return h;
  };
  const sitting = (s) => ['sit', 'bar', 'type', 'read'].includes(s.pose);
  kit.spots.forEach((s, i) => {
    const who = `${s.role === 'staff' ? 'staff' : 'guest'} ${i} (${s.pose} at ${s.x.toFixed(2)}, ${s.z.toFixed(2)})`;
    if (Math.abs(s.x) > H0 - 0.22 || s.z < 0.3 || s.z > D0 - 0.2) problems.push(`${who} is outside the room or in a wall or the glass`);
    if (s.x < -1.9 && s.z < 1.6) problems.push(`${who} is in the door's corner`);
    if (!sitting(s)) { const h = heightAt(s.x, s.z); if (h > 0.55) problems.push(`${who} stands in something ${h.toFixed(2)} m high`); }
    else { const h = heightAt(s.x, s.z); if (h > 1.3) problems.push(`${who} sits inside something ${h.toFixed(2)} m high`); }
    for (let j = 0; j < i; j++) {
      const o = kit.spots[j];
      if (Math.hypot(o.x - s.x, o.z - s.z) < 0.42) problems.push(`${who} is on top of person ${j}`);
    }
  });
  if (!kit.spots.some((s) => s.role === 'staff')) problems.push('nobody works here (no staff place)');
  if (kit.spots.filter((s) => s.role !== 'staff').length < 3) problems.push('fewer than 3 places for customers');
  if (kit.triangles > 14000) problems.push(`${kit.triangles} triangles (keep under 14,000)`);
  if (draw) {
    const rows = [];
    for (let iz = NZ - 1; iz >= 0; iz--) {
      let row = '';
      for (let ix = 0; ix < NX; ix++) { const h = grid[iz * NX + ix]; row += h < 0.06 ? '.' : String(Math.min(5, Math.ceil(h / 0.5))); }
      rows.push(row.split(''));
    }
    const arrows = ['^', '>', 'v', '<'];
    const list = [];
    kit.spots.forEach((s, i) => {
      const ch = String.fromCharCode((s.role === 'staff' ? 65 : 97) + i);
      const ix = Math.max(0, Math.min(NX - 1, Math.floor((s.x + H0) * 10))), iz = Math.max(0, Math.min(NZ - 1, Math.floor(s.z * 5)));
      rows[NZ - 1 - iz][ix] = ch;
      const a = Math.round(Math.atan2(s.fx, s.fz) / (Math.PI / 2)) & 3;
      list.push(`${ch}${arrows[a]} ${s.pose}${s.role === 'staff' ? ' staff' : ''}${s.roam ? ' roam ' + s.roam : ''}`);
    });
    console.log('back wall');
    for (const r of rows) console.log(r.join(''));
    console.log('door' + ' '.repeat(26) + 'glass, the street');
    console.log(list.join('   '));
  }
  return { kit, problems };
}

const one = process.argv[2];
let bad = 0;
const names = [];
for (const base of KIT_NAMES) for (let v = 0; v < kitVariants(base); v++) names.push(v ? base + '~' + v : base);
for (const name of one ? [one] : names) {
  const { kit, problems } = check(name, !!one);
  console.log(`${name}: ${kit.triangles} triangles, ${kit.spots.filter((s) => s.role === 'staff').length} staff, ${kit.spots.filter((s) => s.role !== 'staff').length} customers${problems.length ? '' : ' - fine'}`);
  for (const p of problems) { console.log('   ! ' + p); bad++; }
}
if (!one) console.log(`${names.length} rooms, ${bad} things wrong`);
