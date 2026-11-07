// What the camera draws, logged once a while after the city is in (main.js): the triangles each part of the city puts
// in front of the camera, the most first, and how many of them cast shadows (drawn again for each cascade), to find
// what to draw less of where frames run slow.
import * as THREE from 'three/webgpu';
import { log } from '../lamp-game.js';

const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const sphere = new THREE.Sphere();

function shown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function triangles(mesh) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.position) return 0;
  const n = geo.index ? geo.index.count : geo.attributes.position.count;
  const range = Math.min(n, geo.drawRange?.count ?? Infinity);
  const copies = mesh.isInstancedMesh ? mesh.count : (geo.instanceCount ?? 1);
  return (range / 3) * (Number.isFinite(copies) ? copies : 1);
}

function inView(mesh) {
  if (!mesh.frustumCulled) return true;
  const geo = mesh.geometry;
  if (mesh.isInstancedMesh) { if (!mesh.boundingSphere) mesh.computeBoundingSphere?.(); if (!mesh.boundingSphere) return true; sphere.copy(mesh.boundingSphere); }
  else { if (!geo.boundingSphere) geo.computeBoundingSphere(); sphere.copy(geo.boundingSphere); }
  sphere.applyMatrix4(mesh.matrixWorld);
  return frustum.intersectsSphere(sphere);
}

// the part a mesh belongs to: the nearest named group under the scene, or the mesh's own name
function partOf(o, scene) {
  let named = '';
  for (let p = o; p && p !== scene; p = p.parent) if (p.name) named = p.name;
  return named || o.name || o.material?.name || o.type;
}

export function reportTriangles(scene, camera, shadow = null) {
  camera.updateMatrixWorld();
  viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProj, camera.coordinateSystem, camera.reversedDepth);
  const parts = new Map(), meshes = new Map(), meshDraws = new Map();
  let all = 0, casting = 0, draws = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !shown(o) || !inView(o)) return;
    const t = triangles(o);
    if (!t) return;
    const part = partOf(o, scene);
    const p = parts.get(part) || { t: 0, shadow: 0, draws: 0 };
    p.t += t; p.draws++; if (o.castShadow) { p.shadow += t; p.sd = (p.sd || 0) + 1; }
    parts.set(part, p);
    const geo = o.geometry, n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const what = o.name || o.material?.name || geo?.name || (o.isInstancedMesh ? `${Math.round(n)} tris x${o.count}` : `${o.type} ${Math.round(n)} tris`)
      + (o.name ? '' : ` [${o.material?.type} #${o.material?.color?.getHexString?.()} in ${o.parent?.name || o.parent?.type}, r ${Math.round(geo.boundingSphere?.radius || 0)}]`);
    const key = `${part} / ${what}${o.userData?.cullDistance ? ` cull ${Math.round(o.userData.cullDistance)}` : ''}`;
    meshes.set(key, (meshes.get(key) || 0) + t);
    meshDraws.set(key, (meshDraws.get(key) || 0) + 1);
    all += t; draws++; if (o.castShadow) casting += t;
  });
  // what each shadow cascade draws, part by part
  const shadowParts = new Map();
  for (let i = 0; shadow && i < shadow.getViewportCount?.(); i++) {
    const cam = shadow.getCamera(i);
    cam.updateMatrixWorld();
    viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj, cam.coordinateSystem);
    scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow || !shown(o) || !inView(o) || !triangles(o)) return;
      if (o.material?.colorWrite === false) return;
      const part = `${i} ${partOf(o, scene)}`;
      shadowParts.set(part, (shadowParts.get(part) || 0) + 1);
    });
  }
  const shadowTop = [...shadowParts].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `shadow ${k} ${v} draws`);
  const m = (v) => `${(v / 1e6).toFixed(2)}M`;
  const top = [...parts].sort((a, b) => b[1].draws - a[1].draws).slice(0, 18)
    .map(([k, v]) => `${k} ${m(v.t)} (${v.draws} draws${v.shadow ? `, ${v.sd} cast ${m(v.shadow)}` : ''})`);
  log(`[triangles] in view: ${m(all)} in ${draws} draws, ${m(casting)} casting shadows. ${top.join('; ')}`);
  const big = [...meshes].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => `${k} ${m(v)}`);
  log(`[triangles] biggest: ${big.join('; ')}`);
  // the most draws, mesh by mesh: on the Xbox each draw costs ~70 us whatever it holds
  const most = [...meshDraws].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => `${k} x${v}`);
  log(`[triangles] most draws: ${most.join('; ')}`);
  return { top: [...top, ...shadowTop], big, all, casting, draws };
}

// for a moment, the same lines where a screen reader finds them (unseen), to read them back from the window
export function showTriangles(report) {
  let el = document.getElementById('tri-report');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tri-report';
    el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    document.body.append(el);
  }
  el.replaceChildren(...[...(showTriangles.frame || '').split(/[,;] /).map((t) => `ms ${t}`), `total ${(report.all / 1e6).toFixed(2)}M in ${report.draws}, shadows ${(report.casting / 1e6).toFixed(2)}M`, ...report.top, ...report.big]
    .map((t) => { const p = document.createElement('p'); p.textContent = t; return p; }));
}
