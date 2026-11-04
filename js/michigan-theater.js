import * as THREE from 'three/webgpu';
import { Fn, smoothstep, mix, float, texture, attribute } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { builder, groundOf } from './campus-landmarks.js';

// Lamp: the Michigan Theater (Maurice Finkel, 1928) on East Liberty, facing the end of Maynard Street, modelled by hand
// in place of the survey's two blocks: the windowless brick auditorium behind (its real outline, with a taller stage
// house at the back) and the three-storey buff-brick front on Liberty with storefronts, terra-cotta trim, the deep
// marquee over the doors, chased with bulbs, and the tall MICHIGAN blade sign above it. The signs and bulbs glow at
// dusk and night (cityUniforms.uInteriorGlow), dim by day.

const BRICK = [0.6, 0.42, 0.3];
const BUFF = [0.78, 0.66, 0.5];
const TERRA = [0.84, 0.76, 0.62];
const BASE = [0.5, 0.45, 0.4];
const ROOF = [0.26, 0.26, 0.28];
const GLASS = [0.12, 0.15, 0.19];
const FRAME = [0.18, 0.16, 0.15];
const MARQUEE = [0.48, 0.1, 0.1];
const CREAM = [0.9, 0.85, 0.72];
const BULB = [1.0, 0.78, 0.45];
const SOFFIT = [1.0, 0.86, 0.62];

// the front block on Liberty (the survey's outline), and its face along the street from west to east
const FRONT = [490.5, 18.5, 491, 2.5, 537, 4.5, 537, 2, 544, 2.5, 543, 20.5];
const FACE_A = [490.5, 18.5], FACE_B = [543, 20.5];
const DOOR_U = 34; // the doors and marquee, opposite Maynard Street

function signTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// the blade sign: MICHIGAN stacked in red on cream, framed in maroon
function bladeTexture() {
  return signTexture(256, 1280, (g, w, h) => {
    g.fillStyle = '#5c1010'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f3e6c8'; g.fillRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#c0141c';
    g.font = 'bold 150px Futura, Avenir Next Condensed, Helvetica Neue, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const word = 'MICHIGAN', step = (h - 80) / word.length;
    for (let i = 0; i < word.length; i++) g.fillText(word[i], w / 2, 40 + step * (i + 0.5) + 6);
  });
}

// the marquee's face: the name in red across the top, a lit board of black letters below
function marqueeTexture(lines) {
  return signTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#5c1010'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f3e6c8'; g.fillRect(10, 10, w - 20, 84);
    g.fillStyle = '#c0141c';
    g.font = 'bold 76px Futura, Avenir Next Condensed, Helvetica Neue, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('MICHIGAN', w / 2, 56);
    g.fillStyle = '#fbf6ea'; g.fillRect(10, 104, w - 20, h - 114);
    g.fillStyle = '#151515';
    g.font = 'bold 58px Helvetica Neue, Arial, sans-serif';
    g.fillText(lines[0], w / 2, 146);
    g.fillText(lines[1], w / 2, 208);
  });
}

function signMaterial(tex) {
  const mat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide });
  mat.emissiveNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    return texture(tex).rgb.mul(mix(float(0.12), float(1.5), night));
  })();
  return mat;
}

function buildMichiganTheater(group, colliders, site) {
  if (!site || !site.ring) return false;
  const B = builder();
  const lit = { pos: [], col: [] };
  const g = Math.min(groundOf(site.ring), groundOf(FRONT)) - 0.3;
  const Y = (y) => g + y;

  // the auditorium: plain brick to a stone coping, flat roof, and the stage house rising at the back
  B.prism(site.ring, g - 2, Y(1), BASE);
  B.prism(site.ring, Y(1), Y(15), BRICK, ROOF);
  B.prism(site.ring, Y(15), Y(15.5), TERRA, ROOF);
  B.box(503, 551, Y(15), Y(20), -20.2, -9, BRICK);
  B.box(502.7, 551.3, Y(20), Y(20.5), -20.5, -8.7, TERRA);
  // brick pilasters down the long east wall
  for (let z = -16; z <= 0; z += 4) B.box(553.2, 554.1, Y(1), Y(15), z - 0.4, z + 0.4, BRICK);

  // the front: the survey's outline in buff brick, a darker base course, terra-cotta cornice and parapet
  const H = 11.2;
  B.prism(FRONT, g - 2, Y(0.5), BASE);
  B.prism(FRONT, Y(0.5), Y(H), BUFF, ROOF);

  // everything on the street face in its own frame: u along Liberty (west to east), d out over the sidewalk
  const L = Math.hypot(FACE_B[0] - FACE_A[0], FACE_B[1] - FACE_A[1]);
  const tx = (FACE_B[0] - FACE_A[0]) / L, tz = (FACE_B[1] - FACE_A[1]) / L, nx = -tz, nz = tx;
  const P = (u, y, d) => [FACE_A[0] + tx * u + nx * d, y, FACE_A[1] + tz * u + nz * d];
  const fbox = (u0, u1, y0, y1, d0, d1, col, m = B.stone) => {
    const a = P(u0, y0, d0), b = P(u1, y0, d0), c = P(u1, y0, d1), e = P(u0, y0, d1);
    const a2 = P(u0, y1, d0), b2 = P(u1, y1, d0), c2 = P(u1, y1, d1), e2 = P(u0, y1, d1);
    B.quad(m, a2, e2, c2, b2, col); // top
    B.quad(m, a, b, c, e, col); // bottom
    B.quad(m, e, c, c2, e2, col); // front
    B.quad(m, b, a, a2, b2, col); // back
    B.quad(m, c, b, b2, c2, col); // east
    B.quad(m, a, e, e2, a2, col); // west
  };

  // storefronts either side of the doors: dark glass in bronze frames, under a stone band
  fbox(0.3, L - 0.3, Y(3.5), Y(4.1), 0, 0.25, TERRA);
  for (let u = 1.2; u < L - 2; u += 4.2) {
    if (u + 3.4 > DOOR_U - 7.2 && u < DOOR_U + 7.2) continue;
    fbox(u, u + 3.4, Y(0.5), Y(3.3), 0.02, 0.05, GLASS, B.glass);
    fbox(u - 0.12, u + 3.52, Y(0.4), Y(0.6), 0, 0.12, FRAME);
    fbox(u - 0.12, u, Y(0.5), Y(3.4), 0, 0.1, FRAME);
    fbox(u + 3.4, u + 3.52, Y(0.5), Y(3.4), 0, 0.1, FRAME);
  }
  // the entrance: a row of glass doors set back under the marquee, the ticket booth between them
  fbox(DOOR_U - 6.5, DOOR_U + 6.5, Y(0), Y(3.4), -1.6, -1.5, GLASS, B.glass);
  for (let u = DOOR_U - 6; u <= DOOR_U + 6.01; u += 1.5) fbox(u - 0.06, u + 0.06, Y(0), Y(3.4), -1.5, -1.4, FRAME);
  fbox(DOOR_U - 6.8, DOOR_U - 6.5, Y(0), Y(3.5), -1.6, 0, TERRA);
  fbox(DOOR_U + 6.5, DOOR_U + 6.8, Y(0), Y(3.5), -1.6, 0, TERRA);
  fbox(DOOR_U - 0.9, DOOR_U + 0.9, Y(0), Y(2.6), -1.4, 0.2, MARQUEE);
  fbox(DOOR_U - 0.7, DOOR_U + 0.7, Y(1.2), Y(2.2), 0.2, 0.22, GLASS, B.glass);

  // two floors of paired windows with terra-cotta sills and heads; three tall ones over the entrance
  for (let u = 2.4; u < L - 2; u += 3) {
    const over = Math.abs(u + 0.8 - DOOR_U) < 5;
    if (over) continue;
    for (const [y0, y1] of [[5, 7.1], [8, 10]]) {
      fbox(u, u + 1.6, Y(y0), Y(y1), 0.02, 0.05, GLASS, B.glass);
      fbox(u - 0.15, u + 1.75, Y(y0 - 0.25), Y(y0), 0, 0.15, TERRA);
      fbox(u - 0.15, u + 1.75, Y(y1), Y(y1 + 0.22), 0, 0.1, TERRA);
    }
  }
  fbox(DOOR_U - 4.6, DOOR_U + 4.6, Y(4.6), Y(10.6), 0, 0.2, TERRA);
  for (const du of [-3, 0, 3]) {
    fbox(DOOR_U + du - 1, DOOR_U + du + 1, Y(7), Y(10.1), 0.2, 0.24, GLASS, B.glass);
    fbox(DOOR_U + du - 1.25, DOOR_U + du + 1.25, Y(6.75), Y(7), 0.2, 0.36, TERRA);
  }
  // cornice and parapet, raised into a panel over the entrance
  fbox(-0.2, L + 0.2, Y(H - 0.4), Y(H), 0, 0.45, TERRA);
  fbox(0, L, Y(H), Y(H + 0.9), -0.4, 0, BUFF);
  fbox(-0.1, L + 0.1, Y(H + 0.9), Y(H + 1.1), -0.5, 0.1, TERRA);
  fbox(DOOR_U - 5, DOOR_U + 5, Y(H + 0.9), Y(H + 2.6), -0.4, 0, BUFF);
  fbox(DOOR_U - 5.1, DOOR_U + 5.1, Y(H + 2.6), Y(H + 2.85), -0.5, 0.1, TERRA);

  // the marquee: a deep maroon box over the sidewalk, its lit soffit, and rows of bulbs along its faces
  const M0 = DOOR_U - 7.5, M1 = DOOR_U + 7.5, MY0 = Y(3.8), MY1 = Y(6.3), MD = 4.4;
  fbox(M0, M1, MY0, MY1, 0, MD, MARQUEE);
  fbox(M0 - 0.1, M1 + 0.1, MY1, MY1 + 0.25, 0, MD + 0.1, CREAM);
  fbox(M0 + 0.3, M1 - 0.3, MY0 - 0.02, MY0, 0.3, MD - 0.3, SOFFIT, lit);
  const bulbs = (u0, u1, d0, d1, y, every) => {
    const len = Math.hypot(u1 - u0, d1 - d0), n = Math.max(1, Math.round(len / every));
    for (let k = 0; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n, d = d0 + ((d1 - d0) * k) / n;
      const ou = d1 === d0 ? 0 : 0.03, od = d1 === d0 ? 0.03 : 0;
      fbox(u - 0.07 + ou, u + 0.07 + ou, y - 0.07, y + 0.07, d - 0.07 + od, d + 0.07 + od, BULB, lit);
    }
  };
  // under the soffit, a grid of bulbs over the doors
  for (let u = M0 + 0.9; u < M1 - 0.6; u += 1.1) for (let d = 0.8; d < MD - 0.5; d += 1.1) fbox(u - 0.09, u + 0.09, MY0 - 0.16, MY0 - 0.02, d - 0.09, d + 0.09, BULB, lit);
  for (const y of [MY0 + 0.12, MY1 - 0.12]) {
    bulbs(M0, M1, MD + 0.05, MD + 0.05, y, 0.42);
    bulbs(M0 - 0.05, M0 - 0.05, 0.2, MD, y, 0.42);
    bulbs(M1 + 0.05, M1 + 0.05, 0.2, MD, y, 0.42);
  }

  // the blade sign above the marquee, standing out from the face, outlined in bulbs, on a steel bracket
  const SY0 = Y(6.8), SY1 = Y(18.2), SD0 = 0.6, SD1 = 2.9, SW = 0.22;
  fbox(DOOR_U - SW, DOOR_U + SW, SY0, SY1, SD0, SD1, MARQUEE);
  fbox(DOOR_U - 0.08, DOOR_U + 0.08, SY0 + 0.6, SY0 + 0.75, 0, SD0, FRAME);
  fbox(DOOR_U - 0.08, DOOR_U + 0.08, SY1 - 0.75, SY1 - 0.6, 0, SD0, FRAME);
  fbox(DOOR_U - 0.3, DOOR_U + 0.3, SY1, SY1 + 0.5, SD0 - 0.1, SD1 + 0.1, CREAM);
  for (const s of [-1, 1]) {
    const u = DOOR_U + s * (SW + 0.04);
    for (let y = SY0 + 0.15; y < SY1 - 0.1; y += 0.4) {
      fbox(u - 0.05, u + 0.05, y - 0.06, y + 0.06, SD0 + 0.1, SD0 + 0.22, BULB, lit);
      fbox(u - 0.05, u + 0.05, y - 0.06, y + 0.06, SD1 - 0.22, SD1 - 0.1, BULB, lit);
    }
  }
  bulbs(DOOR_U, DOOR_U, SD0, SD1, SY1 + 0.62, 0.3);

  // the signs' faces: the blade's two sides and the marquee's three
  const signs = new THREE.Group();
  signs.name = 'MichiganTheaterSigns';
  const blade = signMaterial(bladeTexture());
  const board = signMaterial(marqueeTexture(['TONIGHT  7:30', 'CLASSIC FILM NIGHT']));
  const boardSide = signMaterial(marqueeTexture(['ORGAN BEFORE', 'EVERY SHOW']));
  const plane = (w, h, mat, u, y, d, along) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const p = P(u, y, d);
    m.position.set(p[0], p[1], p[2]);
    // a plane faces +z: turn it to face out (n) or along the street (t)
    m.rotation.y = along ? Math.atan2(along * tx, along * tz) : Math.atan2(nx, nz);
    m.receiveShadow = true;
    signs.add(m);
  };
  const bh = SY1 - SY0 - 0.5, by = (SY0 + SY1) / 2, bd = (SD0 + SD1) / 2;
  plane(SD1 - SD0 - 0.45, bh, blade, DOOR_U + SW + 0.01, by, bd, 1);
  plane(SD1 - SD0 - 0.45, bh, blade, DOOR_U - SW - 0.01, by, bd, -1);
  const mh = MY1 - MY0 - 0.45, my = (MY0 + MY1) / 2;
  plane(M1 - M0 - 0.6, mh, board, (M0 + M1) / 2, my, MD + 0.01, 0);
  plane(MD - 0.5, mh, boardSide, M1 + 0.01, my, MD / 2 + 0.1, 1);
  plane(MD - 0.5, mh, boardSide, M0 - 0.01, my, MD / 2 + 0.1, -1);

  const mesh = (m, mat, name, shadows = true) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const out = new THREE.Mesh(geo, mat);
    out.name = name;
    out.castShadow = shadows;
    out.receiveShadow = true;
    return out;
  };
  const stone = mesh(B.stone, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, flatShading: true }), 'MichiganTheaterMasonry');
  const glass = mesh(B.glass, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide, emissive: 0x1c1409 }), 'MichiganTheaterGlass');
  const bulbMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4 });
  bulbMat.emissiveNode = Fn(() => {
    const night = smoothstep(0.35, 1.3, cityUniforms.uInteriorGlow);
    return attribute('color', 'vec3').mul(mix(float(0.25), float(3.2), night));
  })();
  const bulbsMesh = mesh(lit, bulbMat, 'MichiganTheaterBulbs', false);
  group.add(stone, glass, bulbsMesh, signs);
  signs.updateMatrixWorld(true);

  // the colliders: the front block and the hall, kept off the neighbours either side
  colliders.push({ minX: 491.6, maxX: 542.8, minZ: 2.6, maxZ: 20.4, maxY: Y(H + 2.85) });
  colliders.push({ minX: 495.5, maxX: 553.4, minZ: -19.2, maxZ: 1.8, maxY: Y(20.5) });
  return true;
}

export { buildMichiganTheater };
