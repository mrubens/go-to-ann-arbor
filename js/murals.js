import * as THREE from 'three/webgpu';
import { log, texture } from '../lamp-game.js';
import { groundHeight } from './terrain.js';
import { MURALS } from './art-places.js';
import { REAL_BUILDINGS } from './building-geodata.js';
import { polygonContains } from './building-collision.js';

// How far out from the measured wall line the building as drawn really ends, across the mural's width: the game's
// outlines are rounded to half a metre, so a mural put on the measured line can end up inside the wall
function wallFace(cx, cz, rx, rz, nx, nz, w) {
  const near = REAL_BUILDINGS.filter((b) => b.maxX > cx - w - 3 && b.minX < cx + w + 3 && b.maxZ > cz - w - 3 && b.minZ < cz + w + 3);
  const inside = (x, z) => near.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.polygons.some((p) => polygonContains(p, x, z)));
  let out = 0;
  for (let k = 0; k <= 8; k++) {
    const s = (k / 8 - 0.5) * w * 0.9, px = cx + rx * s, pz = cz + rz * s;
    // from 1.5 m in, step out until clear of every building
    let d = -1.5;
    while (d < 2.5 && inside(px + nx * d, pz + nz * d)) d += 0.05;
    if (d < 2.5) out = Math.max(out, d);
  }
  return out;
}
export { MURALS };

// Ann Arbor's best-known murals, painted on the walls they're really on: the Bookstore Mural at Liberty and State, the
// ten-story "Challenge Everything. Create Anything." on Courthouse Square, the Michigan Wings at Tower Plaza and the Ann
// Arbor Art Center's Art in Public Places murals round Ashley, First, Liberty and Washington (Ann Arbor Art Center,
// AADL's guide; walls measured off the city's building footprints). Graffiti Alley is graffiti-alley.js's own.
//
// Each is our own painting in the spirit of the work as it's described (its subject, motifs and palette), not a copy
// of it. All of them share one 2048 px picture, 512 px a mural, and are drawn as one mesh. Where each is: art-places.js.

const SLOT = 512, ATLAS = 2048, PER = ATLAS / SLOT;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each painter draws into a W x H space (H = 512, W = 512 times the mural's width over its height), so a circle
// comes out round on the wall
const PAINT = {
  // head-and-shoulder portraits of five writers in oval frames over a cream wall, a shelf of spines below
  authors(c, W, H, R) {
    c.fillStyle = '#e9dcc0'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#6d2e22'; c.fillRect(0, H * 0.84, W, H * 0.16);
    for (let x = 0; x < W; x += 9 + R() * 14) {
      c.fillStyle = ['#2f4a6b', '#7a3326', '#c99a3c', '#3d5a3a', '#e5d7b8', '#53304d'][Math.floor(R() * 6)];
      c.fillRect(x, H * 0.86 + R() * 6, 7 + R() * 10, H * 0.14);
    }
    const skins = ['#e2b48f', '#d9a57e', '#e8bf9b', '#cf9a74', '#e0b088'], hair = ['#2a201b', '#5b4636', '#1c1714', '#8a8178', '#3a2a20'];
    const coats = ['#3b3f46', '#5c4a3b', '#26324a', '#4a2e2e', '#2f3b33'];
    for (let i = 0; i < 5; i++) {
      const cx = W * (0.1 + i * 0.2), cy = H * 0.44, rx = W * 0.075, ry = H * 0.36;
      c.save(); c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.clip();
      const g = c.createLinearGradient(0, cy - ry, 0, cy + ry); g.addColorStop(0, ['#7fa7c9', '#d8b46a', '#9cb59a', '#c98a72', '#a49ac2'][i]); g.addColorStop(1, '#efe6d2');
      c.fillStyle = g; c.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
      c.fillStyle = coats[i]; c.beginPath(); c.ellipse(cx, cy + ry * 0.95, rx * 1.05, ry * 0.55, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f2efe8'; c.beginPath(); c.moveTo(cx - rx * 0.22, cy + ry * 0.42); c.lineTo(cx, cy + ry * 0.7); c.lineTo(cx + rx * 0.22, cy + ry * 0.42); c.fill();
      c.fillStyle = skins[i]; c.fillRect(cx - rx * 0.16, cy + ry * 0.12, rx * 0.32, ry * 0.32);
      c.beginPath(); c.ellipse(cx, cy - ry * 0.05, rx * 0.42, ry * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = hair[i]; c.beginPath(); c.ellipse(cx, cy - ry * 0.24, rx * 0.46, ry * 0.16, 0, Math.PI, Math.PI * 2); c.fill();
      if (i === 0 || i === 2) { c.strokeStyle = '#1b1b1b'; c.lineWidth = 3; for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * rx * 0.17, cy - ry * 0.05, rx * 0.12, 0, Math.PI * 2); c.stroke(); } }
      c.fillStyle = '#2a1c16'; for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * rx * 0.17, cy - ry * 0.05, 2.6, 0, Math.PI * 2); c.fill(); }
      c.restore();
      c.strokeStyle = '#8a6a2c'; c.lineWidth = 9; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();
    }
  },
  // tall: a sky running teal to sunflower yellow, the two lines in big painted letters, and the town's curiosity
  // between: a light bulb, gears, a paper plane, a hot air balloon, trees and a paint stroke
  challenge(c, W, H, R) {
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1d8f9a'); g.addColorStop(0.5, '#6cc4b5'); g.addColorStop(1, '#f6c544');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(255,255,255,${0.08 + R() * 0.12})`; c.beginPath(); c.arc(R() * W, R() * H, 2 + R() * 9, 0, Math.PI * 2); c.fill(); }
    const words = (lines, y0, size, color) => {
      c.fillStyle = color; c.textAlign = 'center'; c.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
      lines.forEach((t, i) => { c.save(); c.translate(W / 2, y0 + i * size * 1.02); c.scale(Math.min(1, (W * 0.92) / c.measureText(t).width), 1); c.strokeStyle = '#183b4a'; c.lineWidth = 5; c.strokeText(t, 0, 0); c.fillText(t, 0, 0); c.restore(); });
    };
    words(['CHALLENGE', 'EVERYTHING.'], H * 0.1, 30, '#fff6dc');
    words(['CREATE', 'ANYTHING.'], H * 0.86, 30, '#e8483b');
    // light bulb
    const bx = W / 2, by = H * 0.33;
    c.fillStyle = '#fff3a6'; c.beginPath(); c.arc(bx, by, W * 0.22, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#f5a623'; c.lineWidth = 3; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; c.beginPath(); c.moveTo(bx + Math.cos(a) * W * 0.27, by + Math.sin(a) * W * 0.27); c.lineTo(bx + Math.cos(a) * W * 0.36, by + Math.sin(a) * W * 0.36); c.stroke(); }
    c.fillStyle = '#7d8a94'; c.fillRect(bx - W * 0.09, by + W * 0.2, W * 0.18, W * 0.12);
    c.strokeStyle = '#e8483b'; c.lineWidth = 4; c.beginPath(); c.moveTo(bx - W * 0.08, by + W * 0.05); c.lineTo(bx - W * 0.03, by - W * 0.06); c.lineTo(bx + W * 0.03, by + W * 0.05); c.lineTo(bx + W * 0.08, by - W * 0.06); c.stroke();
    // gears
    const gear = (x, y, r, col) => { c.fillStyle = col; c.beginPath(); for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12, rr = k % 2 ? r : r * 1.22; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.fill(); c.fillStyle = '#6cc4b5'; c.beginPath(); c.arc(x, y, r * 0.38, 0, Math.PI * 2); c.fill(); };
    gear(W * 0.24, H * 0.55, W * 0.13, '#3f5a8c'); gear(W * 0.45, H * 0.6, W * 0.09, '#e8483b'); gear(W * 0.72, H * 0.52, W * 0.11, '#f08a2b');
    // hot air balloon
    c.fillStyle = '#e8483b'; c.beginPath(); c.ellipse(W * 0.75, H * 0.68, W * 0.1, W * 0.12, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff6dc'; c.beginPath(); c.ellipse(W * 0.75, H * 0.68, W * 0.035, W * 0.12, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7a4a26'; c.fillRect(W * 0.72, H * 0.68 + W * 0.15, W * 0.06, W * 0.05);
    // paper plane and its trail
    c.strokeStyle = '#fff6dc'; c.setLineDash([6, 6]); c.lineWidth = 3; c.beginPath(); c.moveTo(W * 0.1, H * 0.72); c.bezierCurveTo(W * 0.3, H * 0.66, W * 0.2, H * 0.78, W * 0.42, H * 0.72); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(W * 0.42, H * 0.72); c.lineTo(W * 0.56, H * 0.69); c.lineTo(W * 0.46, H * 0.745); c.fill();
    // trees along the foot
    for (let i = 0; i < 6; i++) { const x = W * (0.05 + i * 0.18), r = W * (0.08 + R() * 0.04); c.fillStyle = '#5b3a24'; c.fillRect(x - 3, H * 0.79, 6, 18); c.fillStyle = ['#2f8a4a', '#4aa35a', '#227a52'][i % 3]; c.beginPath(); c.arc(x, H * 0.79, r, 0, Math.PI * 2); c.fill(); }
  },
  // a pair of wings in black line on white, each feather holding a little picture of the town, for people to stand
  // between
  wings(c, W, H, R) {
    c.fillStyle = '#f4f2ee'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#151515'; c.lineCap = 'round';
    for (const s of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        const n = 7 - row;
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1), ang = (-0.15 - t * 1.25) * Math.PI / 2;
          const len = H * (0.2 + row * 0.07 + (1 - t) * 0.06);
          const ox = W / 2 + s * W * 0.04, oy = H * (0.5 - row * 0.03);
          const tx = ox + s * Math.cos(ang) * len * 1.5, ty = oy + Math.sin(ang) * len;
          c.lineWidth = 3;
          c.beginPath(); c.moveTo(ox, oy); c.quadraticCurveTo(ox + s * (tx - ox) * 0.3, ty - 40, tx, ty);
          c.quadraticCurveTo(ox + s * (tx - ox) * 0.6, ty + 30, ox, oy + 14); c.stroke();
          const mx = ox + (tx - ox) * 0.62, my = oy + (ty - oy) * 0.62;
          c.lineWidth = 1.6; const motif = Math.floor(R() * 4), r = 7;
          c.beginPath();
          if (motif === 0) { c.rect(mx - r * 0.5, my - r * 1.4, r, r * 2.4); c.moveTo(mx - r * 0.7, my - r * 1.4); c.lineTo(mx, my - r * 2.2); c.lineTo(mx + r * 0.7, my - r * 1.4); } // a tower
          else if (motif === 1) { c.moveTo(mx - r, my + r); c.lineTo(mx - r, my - r); c.lineTo(mx, my); c.lineTo(mx + r, my - r); c.lineTo(mx + r, my + r); } // an M
          else if (motif === 2) { c.arc(mx, my, r, 0, Math.PI * 2); c.moveTo(mx, my + r); c.lineTo(mx, my + r * 2); } // a tree
          else { c.moveTo(mx - r, my); c.lineTo(mx + r, my); c.moveTo(mx, my - r); c.lineTo(mx, my + r); c.moveTo(mx - r * 0.7, my - r * 0.7); c.lineTo(mx + r * 0.7, my + r * 0.7); } // a flower
          c.stroke();
        }
      }
    }
  },
  // big knotted pretzels and a brass bell on warm orange and brown
  pretzels(c, W, H, R) {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f08a2b'); g.addColorStop(1, '#c4492b');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(255,214,120,${0.15 + R() * 0.15})`; c.beginPath(); c.arc(R() * W, R() * H, 30 + R() * 60, 0, Math.PI * 2); c.fill(); }
    const pretzel = (x, y, s, rot) => {
      c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s);
      c.lineCap = 'round';
      for (const [col, wid] of [['#5a2c12', 22], ['#9a5523', 16]]) {
        c.strokeStyle = col; c.lineWidth = wid;
        c.beginPath(); c.moveTo(-40, 30); c.bezierCurveTo(-80, -10, -60, -60, -10, -40); c.bezierCurveTo(30, -25, 25, 30, -20, 20);
        c.moveTo(40, 30); c.bezierCurveTo(80, -10, 60, -60, 10, -40); c.bezierCurveTo(-30, -25, -25, 30, 20, 20); c.stroke();
      }
      c.fillStyle = '#fff5e0'; for (let k = 0; k < 14; k++) c.fillRect(-60 + R() * 120, -50 + R() * 80, 4, 3);
      c.restore();
    };
    for (let i = 0; i < Math.round(W / 140); i++) pretzel(70 + i * 140, H * (0.3 + (i % 2) * 0.4), 0.9 + R() * 0.5, (R() - 0.5) * 0.8);
    // the bell
    const bx = W * 0.5, by = H * 0.52;
    c.fillStyle = '#e8c35a'; c.beginPath(); c.moveTo(bx - 70, by + 60); c.quadraticCurveTo(bx - 60, by - 80, bx, by - 85); c.quadraticCurveTo(bx + 60, by - 80, bx + 70, by + 60); c.closePath(); c.fill();
    c.strokeStyle = '#8a6a22'; c.lineWidth = 5; c.stroke();
    c.fillStyle = '#8a6a22'; c.beginPath(); c.arc(bx, by + 68, 14, 0, Math.PI * 2); c.fill();
  },
  // a lush garden of coneflowers and black-eyed Susans on deep teal
  flowers(c, W, H, R) {
    c.fillStyle = '#123f45'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = ['#2d6b3a', '#3f8a46', '#245a36'][i % 3]; c.lineWidth = 3 + R() * 4;
      const x = R() * W; c.beginPath(); c.moveTo(x, H); c.quadraticCurveTo(x + (R() - 0.5) * 80, H * 0.6, x + (R() - 0.5) * 60, H * (0.2 + R() * 0.5)); c.stroke();
    }
    const flower = (x, y, r, petal, cone, droop) => {
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * Math.PI * 2; c.save(); c.translate(x, y); c.rotate(a);
        c.fillStyle = petal; c.beginPath(); c.ellipse(r * 0.95, droop * Math.sin(a) * r * 0.2, r * 0.75, r * 0.2, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 1.5; c.stroke(); c.restore();
      }
      c.fillStyle = cone; c.beginPath(); c.arc(x, y, r * 0.45, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,220,120,0.5)'; for (let k = 0; k < 10; k++) c.fillRect(x - r * 0.3 + R() * r * 0.6, y - r * 0.3 + R() * r * 0.6, 2, 2);
    };
    for (let i = 0; i < 22; i++) {
      const cone = i % 3 !== 0;
      flower(R() * W, H * (0.1 + R() * 0.75), 22 + R() * 34, cone ? ['#e07aa6', '#d4609a', '#f09ac0'][i % 3] : '#f5b821', cone ? '#c8641e' : '#3a2416', cone ? 1 : 0);
    }
  },
  // hands and figures over a field of bright pixels, a rainbow line running through, on a dark ground
  hands(c, W, H, R) { paintHands(c, W, H, R, 0); },
  hands2(c, W, H, R) { paintHands(c, W, H, R, 1); },
  // a labyrinth in Day-Glo line over an ombre of cool blues
  labyrinth(c, W, H, R) { paintLabyrinth(c, W, H, R, '#ff4fb8'); },
  labyrinth2(c, W, H, R) { paintLabyrinth(c, W, H, R, '#e9ff3a'); },
  // flowing brush strokes in blues on white, like water
  water(c, W, H, R) {
    c.fillStyle = '#f6f8f9'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = ['#0f3d6e', '#1f6fb2', '#4fa3d9', '#9fd0ee', '#16507f'][i % 5]; c.lineWidth = 6 + R() * 22; c.lineCap = 'round';
      const y = R() * H; c.beginPath(); c.moveTo(-20, y);
      for (let x = 0; x <= W + 40; x += 60) c.quadraticCurveTo(x + 30, y + Math.sin(x * 0.01 + i) * 50 + (R() - 0.5) * 40, x + 60, y + Math.cos(x * 0.008 + i) * 40);
      c.globalAlpha = 0.55 + R() * 0.4; c.stroke(); c.globalAlpha = 1;
    }
  },
  // a man sitting before a grassy field with a toy sailboat in his hands
  sailboat(c, W, H, R) {
    const g = c.createLinearGradient(0, 0, 0, H * 0.5); g.addColorStop(0, '#9cc3d9'); g.addColorStop(1, '#e3e9d8');
    c.fillStyle = g; c.fillRect(0, 0, W, H * 0.5);
    c.fillStyle = '#8fa860'; c.fillRect(0, H * 0.45, W, H * 0.55);
    for (let i = 0; i < 900; i++) { c.strokeStyle = ['#6f8c45', '#a8bd6e', '#5c7a3a', '#c2c98a'][i % 4]; c.lineWidth = 1.5; const x = R() * W, y = H * 0.45 + R() * H * 0.55; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (R() - 0.5) * 6, y - 8 - R() * 14); c.stroke(); }
    const fx = W * 0.62, fy = H * 0.62;
    c.fillStyle = '#2e3a4d'; c.beginPath(); c.ellipse(fx, fy + 40, 70, 40, 0, 0, Math.PI * 2); c.fill(); // legs
    c.fillStyle = '#c7553b'; c.beginPath(); c.ellipse(fx, fy - 30, 44, 70, 0, 0, Math.PI * 2); c.fill(); // shirt
    c.fillStyle = '#d9a47e'; c.beginPath(); c.arc(fx, fy - 118, 28, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4a3326'; c.beginPath(); c.arc(fx, fy - 126, 29, Math.PI, Math.PI * 2); c.fill();
    c.fillStyle = '#d9a47e'; c.beginPath(); c.ellipse(fx - 40, fy + 4, 12, 9, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(fx + 6, fy + 8, 12, 9, 0, 0, Math.PI * 2); c.fill();
    // the boat in his hands
    c.fillStyle = '#7a4a2a'; c.beginPath(); c.moveTo(fx - 56, fy - 6); c.lineTo(fx + 20, fy - 6); c.lineTo(fx + 8, fy + 8); c.lineTo(fx - 46, fy + 8); c.fill();
    c.fillStyle = '#f7f3e8'; c.beginPath(); c.moveTo(fx - 18, fy - 8); c.lineTo(fx - 18, fy - 80); c.lineTo(fx + 18, fy - 8); c.fill();
    c.beginPath(); c.moveTo(fx - 22, fy - 8); c.lineTo(fx - 22, fy - 60); c.lineTo(fx - 48, fy - 8); c.fill();
  },
  // bright red, with a bullseye, long lines and spheres in blue and green
  bullseye(c, W, H, R) {
    c.fillStyle = '#d42a26'; c.fillRect(0, 0, W, H);
    const bx = W * 0.3, by = H * 0.5;
    for (let k = 6; k > 0; k--) { c.fillStyle = k % 2 ? '#f7f2e6' : '#1d3f8c'; c.beginPath(); c.arc(bx, by, k * 34, 0, Math.PI * 2); c.fill(); }
    c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { c.strokeStyle = ['#1d3f8c', '#2fa05a', '#f7f2e6', '#121212'][i % 4]; c.lineWidth = 4 + R() * 10; const y = R() * H; c.beginPath(); c.moveTo(W * 0.45 + R() * 40, y); c.lineTo(W, y + (R() - 0.5) * 140); c.stroke(); }
    for (let i = 0; i < 9; i++) {
      const x = W * (0.5 + R() * 0.48), y = R() * H, r = 14 + R() * 38, col = i % 2 ? '#2fa05a' : '#2b62d9';
      const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, '#0d1e3a');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  },
  // typed notes on slips of paper pinned over a blue wall
  notes(c, W, H, R) {
    c.fillStyle = '#2c5d8f'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 46; i++) {
      const w = 60 + R() * 60, h = 40 + R() * 30, x = R() * (W - w), y = R() * (H - h);
      c.save(); c.translate(x + w / 2, y + h / 2); c.rotate((R() - 0.5) * 0.3);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);
      c.fillStyle = ['#fbf7ec', '#f4ecd6', '#ffffff', '#f6e7c1'][i % 4]; c.fillRect(-w / 2, -h / 2, w, h);
      c.fillStyle = '#2a2a2a'; for (let l = 0; l < 4; l++) { let lx = -w / 2 + 6; while (lx < w / 2 - 10) { const ww = 4 + R() * 12; c.fillRect(lx, -h / 2 + 8 + l * 8, ww, 2.5); lx += ww + 3; } }
      c.restore();
    }
  },
  // shapes and colors that nod to the buildings round it: arches, stairs, windows in flat bold color
  shapes(c, W, H, R) {
    c.fillStyle = '#f2e9d8'; c.fillRect(0, 0, W, H);
    const cols = ['#ef5b3c', '#f7b733', '#2a9d8f', '#264653', '#e76fae', '#6a4c93', '#90be6d'];
    for (let i = 0; i < 24; i++) {
      c.fillStyle = cols[i % cols.length]; const x = R() * W, y = R() * H, s = 30 + R() * 90, k = i % 4;
      c.beginPath();
      if (k === 0) { c.moveTo(x - s / 2, y + s / 2); c.lineTo(x - s / 2, y); c.arc(x, y, s / 2, Math.PI, 0); c.lineTo(x + s / 2, y + s / 2); }
      else if (k === 1) { for (let st = 0; st < 4; st++) c.rect(x + st * s / 4, y + s - (st + 1) * s / 4, s / 4, (st + 1) * s / 4); }
      else if (k === 2) c.arc(x, y, s / 2, 0, Math.PI * 2);
      else { c.moveTo(x, y - s / 2); c.lineTo(x + s / 2, y + s / 2); c.lineTo(x - s / 2, y + s / 2); }
      c.fill();
    }
  }
};

function paintHands(c, W, H, R, v) {
  c.fillStyle = '#171a24'; c.fillRect(0, 0, W, H);
  const cols = ['#ff4f7b', '#ffb238', '#3fd0c9', '#7a5cff', '#58e06f', '#2b8cff', '#ff7a3d'];
  for (let i = 0; i < 260; i++) { const s = 8 + Math.floor(R() * 3) * 8; c.fillStyle = cols[Math.floor(R() * cols.length)]; c.globalAlpha = 0.5 + R() * 0.5; c.fillRect(Math.floor(R() * W / 8) * 8, Math.floor(R() * H / 8) * 8, s, s); }
  c.globalAlpha = 1;
  // the rainbow line
  c.lineWidth = 7; c.lineCap = 'round';
  cols.forEach((col, k) => { c.strokeStyle = col; c.beginPath(); c.moveTo(0, H * 0.7 + k * 7); for (let x = 0; x <= W; x += 40) c.lineTo(x, H * 0.7 + k * 7 + Math.sin(x * 0.012 + v) * 40); c.stroke(); });
  // open hands reaching toward each other
  const hand = (x, y, s, flip) => {
    c.save(); c.translate(x, y); c.scale(flip * s, s);
    c.fillStyle = '#e6d7cf'; c.strokeStyle = '#0d0f16'; c.lineWidth = 3 / s;
    c.beginPath(); c.roundRect(-30, -10, 60, 70, 18); c.fill(); c.stroke();
    for (let f = 0; f < 4; f++) { c.beginPath(); c.roundRect(-28 + f * 15, -70 + Math.abs(f - 1.5) * 8, 12, 64, 6); c.fill(); c.stroke(); }
    c.beginPath(); c.roundRect(28, 0, 40, 13, 6); c.fill(); c.stroke();
    c.restore();
  };
  const n = Math.max(2, Math.round(W / 300));
  for (let i = 0; i < n; i++) hand(W * (i + 0.5) / n, H * 0.45, 1.6 + R() * 0.6, i % 2 ? -1 : 1);
}

function paintLabyrinth(c, W, H, R, glow) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d1b4a'); g.addColorStop(0.5, '#1d5fa8'); g.addColorStop(1, '#7fc6e8');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = glow; c.lineWidth = 7; c.lineCap = 'square';
  const cx = W / 2, cy = H / 2;
  for (let k = 1; k < 9; k++) {
    const r = k * Math.min(W, H) * 0.055, gap = R() * Math.PI * 2;
    c.beginPath(); c.arc(cx, cy, r, gap + 0.35, gap + Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx + Math.cos(gap) * r, cy + Math.sin(gap) * r); c.lineTo(cx + Math.cos(gap) * (r + Math.min(W, H) * 0.055), cy + Math.sin(gap) * (r + Math.min(W, H) * 0.055)); c.stroke();
  }
  // squared runs out to the edges
  c.lineWidth = 5;
  for (let i = 0; i < 18; i++) { let x = R() * W, y = R() * H; c.beginPath(); c.moveTo(x, y); for (let s = 0; s < 6; s++) { if (s % 2) y += (R() - 0.5) * 120; else x += (R() - 0.5) * 160; c.lineTo(x, y); } c.stroke(); }
}

// The murals as one mesh on their walls, all painted into one picture
export function buildMurals(group) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d');
  const pos = [], nor = [], uv = [], idx = [];
  const own = []; // murals shown from a picture of their own, at its full size: { m, pos, nor, uv }
  const offs = [];
  MURALS.forEach((m, i) => {
    // only murals with a real picture of them go on their walls; the rest are pins on the map until one comes
    if (!m.picture) return;
    const sx = (i % PER) * SLOT, sy = Math.floor(i / PER) * SLOT;
    if (!m.picture) {
    const ar = m.w / m.h, W = SLOT * ar, H = SLOT;
    ctx.save(); ctx.beginPath(); ctx.rect(sx, sy, SLOT, SLOT); ctx.clip();
    ctx.translate(sx, sy); ctx.scale(1 / ar, 1);
    PAINT[m.paint](ctx, W, H, rng(i * 7919 + 13));
    // a little wear: the wall's own texture showing through
    const R = rng(i + 101);
    for (let k = 0; k < 500; k++) { ctx.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + R() * 0.05})`; ctx.fillRect(R() * W, R() * H, 2 + R() * 6, 1 + R() * 3); }
    ctx.restore();
    }
    // on the wall, its foot on the ground in front of it
    const [ax, az] = m.a, [bx, bz] = m.b, len = Math.hypot(bx - ax, bz - az);
    let dx = (bx - ax) / len, dz = (bz - az) / len, nx = dz, nz = -dx;
    const want = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[m.face];
    if (nx * want[0] + nz * want[1] < 0) { nx = -nx; nz = -nz; }
    // reading left to right as seen from in front: the wall's direction is the outward normal turned right
    const rx = nz, rz = -nx; // (looking at the wall, along -n, the right hand is n turned clockwise seen from above)
    const t = (m.picture?.fill ? 0.5 : (m.at ?? 0.5)) * len, cx = ax + dx * t, cz = az + dz * t;
    // clear of the wall as drawn, and of its window sills
    const off = wallFace(cx, cz, rx, rz, nx, nz, m.picture?.fill ? len : m.w) + 0.25; offs.push(off.toFixed(2)); const mx = cx + nx * off, mz = cz + nz * off;
    const gy = Math.min(groundHeight(mx + nx * 1.2, mz + nz * 1.2), groundHeight(mx - rx * m.w / 2 + nx, mz - rz * m.w / 2 + nz), groundHeight(mx + rx * m.w / 2 + nx, mz + rz * m.w / 2 + nz));
    let y0 = gy + (m.up ?? 0.5), mh = m.h, mw = m.w;
    // never above the roof of the wall it's on: a mural over the shops shrinks a little to fit under it, then comes down
    const wall = REAL_BUILDINGS.find((b) => b.polygons.some((p) => polygonContains(p, cx - nx * 1.5, cz - nz * 1.5)));
    if (wall && m.picture?.fill) {
      mw = len; y0 = gy + 0.15; mh = Math.min(wall.height * 0.55, mw / (m.picture.aspect ?? 3)); mw = mh * (m.picture.aspect ?? 3);
      log(`[murals] ${m.short}: the whole wall, ${mw.toFixed(1)} x ${mh.toFixed(1)} m`);
    } else if (wall) {
      const room = wall.height - 0.4 - (m.up ?? 0.5);
      if (m.picture && room < mh) { const k = Math.max(0.7, room / mh); mh *= k; mw *= k; }
      y0 = Math.max(gy + 0.3, Math.min(y0, gy + wall.height - 0.4 - mh));
      if (m.picture) log(`[murals] ${m.short}: wall ${wall.height} m, painted ${mw.toFixed(1)} x ${mh.toFixed(1)} m from ${(y0 - gy).toFixed(1)} m up`);
    }
    const y1 = y0 + mh;
    const P = m.picture ? { m, pos: [], nor: [], uv: [], aspect: mw / mh } : null;
    if (P) own.push(P);
    const [qp, qn, qu] = P ? [P.pos, P.nor, P.uv] : [pos, nor, uv], base = qp.length / 3;
    const u0 = P ? (m.picture.cropX?.[0] ?? 0) : sx / ATLAS, u1 = P ? (m.picture.cropX?.[1] ?? 1) : (sx + SLOT) / ATLAS;
    const v1 = P ? 1 - m.picture.crop[0] : 1 - sy / ATLAS, v0 = P ? 1 - m.picture.crop[1] : 1 - (sy + SLOT) / ATLAS;
    for (const [s, y, u, v] of [[-0.5, y0, u0, v0], [0.5, y0, u1, v0], [0.5, y1, u1, v1], [-0.5, y1, u0, v1]]) {
      qp.push(mx + rx * mw * s, y, mz + rz * mw * s); qn.push(nx, 0, nz); qu.push(u, v);
    }
    if (!P) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  if (idx.length) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.generateMipmaps = true;
  const mat = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Murals'; mesh.receiveShadow = true; mesh.castShadow = false;
  group.add(mesh);
  }
  // the ones painted as pictures of their own: one draw each, at full size, the brick showing through a little
  for (const P of own) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(P.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(P.uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeBoundingSphere();
    const pm = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, visible: false });
    const pmesh = new THREE.Mesh(g, pm);
    pmesh.name = P.m.short; pmesh.receiveShadow = true;
    group.add(pmesh);
    texture(P.m.picture.file, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }).then((t) => {
      pm.map = t; pm.color.set(0xffffff); pm.visible = true; pm.needsUpdate = true;
    }).catch((e) => log(`[murals] no picture for ${P.m.short}: ${e}`));
  }
  log(`[murals] ${own.length} of ${MURALS.length} on their walls, out from the measured line by ${offs.join(' ')} m`);
  return { count: own.length };
}
