// js/diag-m.js — the bronze block M set in the paving where the Diag's walks meet, on a round granite inlay.
// Students say stepping on it before your first blue book exam means you'll fail it.
import * as THREE from 'three/webgpu';
import { groundHeight } from './terrain.js';
import { LIFT } from './ground-lifts.js';

// the open middle of the Diag's web of walks (its widest clear spot, from the survey's paving)
const AT = { x: 839.5, z: 300.5 };
const WIDTH = 2.4;

// the varsity block M, 1 wide and 0.75 tall, with its feet and shoulders
const M = [
  [0, 0], [0.38, 0], [0.38, 0.16], [0.31, 0.16], [0.31, 0.52], [0.5, 0.25], [0.69, 0.52], [0.69, 0.16], [0.62, 0.16],
  [0.62, 0], [1, 0], [1, 0.16], [0.92, 0.16], [0.92, 0.84], [1, 0.84], [1, 1], [0.72, 1], [0.5, 0.68], [0.28, 1],
  [0, 1], [0, 0.84], [0.08, 0.84], [0.08, 0.16], [0, 0.16]
];

function buildDiagM(group) {
  let g = -Infinity;
  for (let a = 0; a < 6.28; a += 0.785) g = Math.max(g, groundHeight(AT.x + Math.cos(a) * 2, AT.z + Math.sin(a) * 2));
  g = Math.max(g, groundHeight(AT.x, AT.z));
  // the paving is laid a lawn's lift over the ground: the inlay sits just over it
  const top = g + LIFT.lawn + 0.02;

  // the granite disc, flush with the paving, and a bronze rim around it
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.2, 48),
    new THREE.MeshStandardNodeMaterial({ color: 0x3a3836, roughness: 0.5 }));
  disc.position.set(AT.x, top - 0.1, AT.z);
  disc.name = 'DiagMDisc';
  const bronze = new THREE.MeshStandardNodeMaterial({ color: 0xd2a656, metalness: 0.55, roughness: 0.3 });
  const rim = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.0, 64), bronze);
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(AT.x, top + 0.004, AT.z);

  // the M, raised a hair over the granite, reading the right way up from the south, its top toward the library
  const H = WIDTH * 0.75;
  const shape = new THREE.Shape(M.map(([u, v]) => new THREE.Vector2((u - 0.5) * WIDTH, (v - 0.5) * H)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.012, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2); // lays it flat, its top toward -z
  geo.rotateY(Math.PI); // turns its top north (+z), toward the library, so it reads upright from the Diag's south walk
  const letter = new THREE.Mesh(geo, bronze);
  letter.position.set(AT.x, top - 0.012, AT.z);
  letter.name = 'DiagBlockM';

  for (const m of [disc, rim, letter]) {
    m.receiveShadow = true;
    group.add(m);
    m.updateMatrixWorld(true);
  }
  return true;
}

export { buildDiagM };
