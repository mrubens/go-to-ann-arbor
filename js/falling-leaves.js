// Lamp: leaves coming down in the fall. While the street trees drop their leaves (trees.js `leavesFalling`, by the
// season) a few hundred leaves drift and tumble down round the camera, as many as the leaf-dropping crowns over it
// (trees.js `litterAt`) and the day's share falling call for: none downtown away from trees, none up in the helicopter,
// none in winter, spring or summer. Carried by the live wind (weather.js), rust, orange, yellow and brown. One draw,
// every leaf placed, turned and moved in the shader in a box that follows the camera (as weather.js's rain); none on
// the phone and Xbox tier.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, uniform, instanceIndex, positionLocal, uv, sin, cos, floor, fract, mix, smoothstep, length } from 'three/tsl';
import { cityUniforms } from './tsl-materials.js';
import { litterAt, leavesFalling } from './trees.js';
import { groundHeight } from './terrain.js';
import { TIER } from './device-tier.js';

const BOX = 36; // m, round the camera
const MAX_LEAVES = TIER.name === 'phone' ? 0 : 900;
const hash = (n) => fract(sin(n.mul(12.9898)).mul(43758.5453));

function createFallingLeaves() {
  const uCam = uniform(new THREE.Vector3());
  const uTime = uniform(0);
  const uWind = uniform(new THREE.Vector2());

  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geometry.instanceCount = 0;
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const i = float(instanceIndex);
  // each leaf its own color: rust, orange, yellow or brown, a little darker or lighter
  const pick = hash(i.add(3.1));
  const tone = mix(mix(vec3(0.42, 0.07, 0.02), vec3(0.62, 0.22, 0.03), smoothstep(0.0, 0.35, pick)),
    mix(vec3(0.62, 0.45, 0.05), vec3(0.22, 0.12, 0.05), smoothstep(0.65, 1.0, pick)), smoothstep(0.3, 0.7, pick));
  // lit as the air round them (drawn unlit): full by day, dim at night (weather.js's rain does the same)
  const night = smoothstep(0.7, 1.45, cityUniforms.uInteriorGlow);
  material.colorNode = tone.mul(hash(i.add(8.7)).mul(0.5).add(0.75)).mul(mix(float(1), float(0.12), night));
  // a leaf's outline: a pointed oval
  const q = uv().sub(0.5).mul(vec2(2.0, 1.0));
  material.alphaTestNode = float(0.5);
  material.opacityNode = smoothstep(0.52, 0.46, length(vec2(q.x.div(float(1.05).sub(q.y.abs().mul(1.4))), q.y)));
  material.positionNode = Fn(() => {
    const t = uTime;
    const fall = hash(i.add(5.3)).mul(0.6).add(0.7); // m/s
    const phase = hash(i.add(11.9)).mul(6.283);
    // a leaf swings side to side as it falls and is carried downwind
    const swing = sin(t.mul(1.7).add(phase)).mul(0.9);
    const base = vec3(hash(i), hash(i.add(17.31)), hash(i.add(41.77))).mul(BOX);
    const drift = vec3(uWind.x.mul(t).add(swing), fall.mul(t).negate(), uWind.y.mul(t).add(cos(t.mul(1.3).add(phase)).mul(0.6)));
    const p = base.add(drift).sub(uCam);
    const rel = p.sub(floor(p.div(BOX)).mul(BOX)).sub(BOX / 2);
    // tumbling: turned about the vertical and tipped over, each at its own pace
    const a = t.mul(hash(i.add(2.2)).mul(3.0).add(1.0)).add(phase);
    const b = t.mul(hash(i.add(7.7)).mul(4.0).add(1.5)).add(phase.mul(2.0));
    const size = hash(i.add(13.1)).mul(0.05).add(0.09);
    const lx = positionLocal.x.mul(size), ly = positionLocal.y.mul(size.mul(1.3));
    const tipped = vec3(lx, ly.mul(cos(b)), ly.mul(sin(b)));
    const turned = vec3(tipped.x.mul(cos(a)).sub(tipped.z.mul(sin(a))), tipped.y, tipped.x.mul(sin(a)).add(tipped.z.mul(cos(a))));
    return uCam.add(rel).add(turned);
  })();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'FallingLeaves';
  mesh.frustumCulled = false;
  mesh.visible = false;

  let wind = [0, 0];
  const set = (w) => { wind = (w && w.wind) || [0, 0]; uWind.value.set(wind[0] * 0.6, wind[1] * 0.6); };
  // how many leaves are in the air, looked at again every half second or so (and as the camera moves on)
  let nextLook = 0, want = 0, have = 0;
  const update = (camera, time) => {
    if (!MAX_LEAVES) return;
    const { x, y, z } = camera.position;
    if (time >= nextLook) {
      nextLook = time + 0.5;
      const share = leavesFalling();
      let over = 0;
      if (share > 0) for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) over += litterAt(x + dx, z + dz) / 5;
      const aloft = Math.max(0, 1 - Math.max(0, y - groundHeight(x, z) - 25) / 30);
      // a breeze brings more down
      const breeze = 1 + Math.min(1, Math.hypot(wind[0], wind[1]) / 8);
      want = Math.round(MAX_LEAVES * Math.min(1, share * 2.5 * breeze) * Math.min(1, over * 1.6) * aloft);
    }
    // eased in and out, so leaves don't blink in by the hundred
    if (have !== want) have += Math.sign(want - have) * Math.min(Math.abs(want - have), 8);
    geometry.instanceCount = have;
    mesh.visible = have > 0;
    if (!mesh.visible) return;
    uCam.value.copy(camera.position);
    uTime.value = time;
  };
  return { mesh, set, update };
}

export { createFallingLeaves };
