// Lamp: two players side by side, each with a controller: the first in the left half of the screen, the second in the
// right (main.js turns it on and off). The second player has a person, car, bike, helicopter and kayak of their own and
// a camera of their own; the city's traffic, sounds and map follow the first.
import * as THREE from 'three/webgpu';
import { texture, screenUV, vec2, vec3 } from 'three/tsl';
import { log } from '../lamp-game.js';
import { createPostProcessing } from './post-processing.js';
import { ThirdPersonControllerManager } from './controllers.js';
import { CameraSystem, CAMERA_PRESETS } from './cameras.js';
import { GamepadControls } from './gamepad-controls.js';

const MODES = ['person', 'car', 'cyclist', 'helicopter', 'kayak'];
const FOLLOW = CAMERA_PRESETS.filter((p) => p.category === 'follow').map((p) => p.id);
// the second player's car: the first's sports car, in Michigan blue
const P2_CAR = { kind: 'sports', hex: 0x00274c, style: 0 };

// The second player, built when split screen first starts: each of their ways of getting around beside the first
// player's, or where a kept split screen had them. `share` is what the city gives a player's controls to run into.
function createSecondPlayer({ scene, colliders, share, beside, map = null, kept = null }) {
  const cm = new ThirdPersonControllerManager(scene, colliders);
  Object.assign(cm, share);
  // the keyboard and the touch screen are the first player's: this one hears only its own controller
  cm._blendInput = (action) => { cm.keys[action] = cm._gamepadKeys[action] || false; };
  cm.restyleCar(P2_CAR);
  // no lamps that light the street: a light more in the scene would build every material's shader again
  const lamps = [...(cm.entities.car.headLights || [])];
  for (const e of Object.values(cm.entities)) e.mesh?.traverse((o) => { if (o.isLight) lamps.push(o); });
  for (const l of lamps) { l.removeFromParent(); l.target?.removeFromParent(); }

  for (const mode of MODES) {
    if (!cm.entities[mode]) continue;
    cm.setMode(mode);
    const p = kept?.entities?.[mode];
    if (p && [p.x, p.y, p.z, p.heading].every(Number.isFinite)) {
      // back where it was kept: the others (the person beside their car, or in it) don't push it aside as they would
      // a teleport's arrival
      const others = Object.values(cm.entities).filter((e) => e !== cm.entities[mode]);
      const ys = others.map((e) => e.position.y);
      for (const e of others) e.position.y = -1e6;
      cm.teleportActiveTo(p.x, p.z, p.heading, p.y);
      others.forEach((e, i) => { e.position.y = ys[i]; });
      continue;
    }
    const e = beside.entities[mode];
    if (!e) continue;
    // a few metres to the first player's right (more for the helicopter's rotor)
    const gap = mode === 'helicopter' ? 14 : mode === 'person' ? 1.5 : 3.5;
    const rx = -Math.cos(e.heading), rz = Math.sin(e.heading);
    cm.teleportActiveTo(e.position.x + rx * gap, e.position.z + rz * gap, e.heading, e.position.y);
  }
  const mode = MODES.includes(kept?.mode) ? kept.mode : beside.activeMode;
  cm.setMode(mode);
  if (mode !== 'person') { cm.entities.person.riding = mode; cm.entities[mode].leftEmpty = false; }

  // its camera: one of the follow cameras, dragged only with the right stick (there's no mouse for this half)
  const camera = CameraSystem.makeCamera();
  const cs = new CameraSystem(document.createElement('div'), cm, camera);
  cs.setCameraPreset(FOLLOW.includes(kept?.camera) ? kept.camera : 'chase', true);
  cs.onResize(960, 1080);

  let pad = null;
  function travelBy(next) {
    if (!cm.entities[next] || next === cm.activeMode) return;
    const was = cm.activeMode, here = cm.getActiveEntity(), there = cm.entities[next];
    // out of a car on the move or the helicopter in the air: on foot as the get-out button does it (thrown out, or a
    // jump); into something else, what was left goes on without them rather than stopping dead
    const jump = was !== 'person' ? cm.exitJump() : null;
    if (jump && next === 'person') { getInOrOut(); return; }
    const { x, y, z } = here.position, heading = here.heading;
    const far = Math.hypot(there.position.x - x, there.position.z - z) > 40;
    cm.setMode(next);
    // in it, as getting in does: the person rides along and what they were in stands empty
    if (next !== 'person') {
      cm.entities.person.riding = next;
      there.leftEmpty = false;
      if (was !== 'person') here.leftEmpty = true;
    }
    if (jump) here.coasting = true;
    // a way of getting around left far behind comes to the player, as the first player's goes to its own start
    if (far) cm.teleportActiveTo(x - Math.cos(heading) * 3, z + Math.sin(heading) * 3, heading, y);
    pad.reset();
    cs.resetForTeleport();
  }
  function getInOrOut() {
    const p = cm.entities.person;
    if (cm.activeMode === 'person' && p.sitting) { cm.standUp(); return; }
    const choice = cm.enterOrExit();
    if (!choice || choice.sit) return;
    cm.setMode(choice.mode);
    if (choice.jump) cm.bailOut(choice.jump);
    pad.reset();
  }
  function stepCamera(step) {
    cs.setCameraPreset(FOLLOW[(FOLLOW.indexOf(cs.activePresetId) + step + FOLLOW.length) % FOLLOW.length]);
  }
  pad = new GamepadControls(cm, cs, {
    onCycleMode: (step) => travelBy(MODES[(MODES.indexOf(cm.activeMode) + step + MODES.length) % MODES.length]),
    onCycleCamera: () => stepCamera(1),
    onGetInOut: getInOrOut
  });

  // The second player's speedometer, in the right half's corner: what they're in, and how fast
  const hud = document.createElement('div');
  hud.className = 'hud hud-bottom-right p2-hud';
  const panel = document.createElement('section');
  panel.className = 'panel cluster';
  panel.setAttribute('aria-label', 'Player 2');
  const gauge = document.createElement('div');
  gauge.className = 'gauge';
  const top = document.createElement('div');
  top.className = 'gauge-top';
  const name = document.createElement('span');
  name.className = 'gauge-label';
  top.append(name);
  const speedRow = document.createElement('div');
  speedRow.className = 'gauge-speed';
  const speed = document.createElement('span');
  speed.className = 'p2-speed';
  speed.textContent = '0';
  const unit = document.createElement('span');
  unit.className = 'gauge-unit';
  unit.textContent = 'mph';
  speedRow.append(speed, unit);
  const meter = document.createElement('div');
  meter.className = 'gauge-meter';
  const fill = document.createElement('span');
  fill.className = 'p2-meter';
  meter.append(fill);
  gauge.append(top, speedRow, meter);
  // their camera, as the first player's chooser shows it: the arrows step through the follow cameras (Y on their
  // controller does too)
  const chooser = document.createElement('div');
  chooser.className = 'camera-switch';
  const arrow = (dir, labelText) => {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.type = 'button';
    b.setAttribute('aria-label', labelText);
    b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-chevron-${dir}"/></svg>`;
    b.addEventListener('click', () => stepCamera(dir === 'left' ? -1 : 1));
    return b;
  };
  const current = document.createElement('div');
  current.className = 'camera-current';
  current.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-camera"/></svg>';
  const camName = document.createElement('span');
  current.append(camName);
  chooser.append(arrow('left', 'Player 2 previous camera'), current, arrow('right', 'Player 2 next camera'));
  panel.append(gauge, chooser);
  hud.append(panel);
  // their mini map, in the left corner of the right half
  const radarHud = document.createElement('div');
  radarHud.className = 'hud p2-radar';
  const radar = document.createElement('aside');
  radar.className = 'panel radar';
  radar.setAttribute('aria-label', 'Player 2 map');
  const radarCanvas = document.createElement('canvas');
  radarCanvas.className = 'p2-radar-canvas';
  const north = document.createElement('span');
  north.className = 'radar-north';
  north.setAttribute('aria-hidden', 'true');
  north.textContent = 'N';
  radar.append(radarCanvas, north);
  radarHud.append(radar);
  const divider = document.createElement('div');
  divider.className = 'split-divider';
  document.body.append(hud, radarHud, divider);
  const dropRadar = map?.addRadar?.(radarCanvas, null, cm, cs) || (() => {});
  const shown = { name: '', mph: -1, camera: '' };

  log(`[split] player 2 joined, in the ${mode}`);
  return {
    cm, cs, camera, pad,
    update(dt, elapsed, input, enabled) {
      pad.setEnabled(enabled);
      pad.supply(input);
      pad.update(dt);
      cm.update(dt, elapsed, cs.initialized ? cs.currentPos : null);
      cs.update(dt, elapsed);
    },
    // the speedometer, every frame; `top` is the first player's speed meter's full scale for this mode
    drawHud(topMph) {
      const ent = cm.getActiveEntity();
      const label = ent?.label || '';
      if (label !== shown.name) { shown.name = label; name.textContent = String(label); }
      const mphExact = (cm.activeMode === 'kayak' ? ent.groundSpeed || 0 : Math.abs(ent.speed || 0)) * 2.237;
      const mph = Math.round(mphExact);
      if (mph !== shown.mph) { shown.mph = mph; speed.textContent = String(mph); }
      fill.style.transform = `scaleX(${Math.min(1, mphExact / (topMph || 80))})`;
      if (cs.activePresetId !== shown.camera) {
        shown.camera = cs.activePresetId;
        camName.textContent = CAMERA_PRESETS.find((p) => p.id === shown.camera)?.name || '';
      }
    },
    snapshot() {
      const entities = Object.fromEntries(Object.entries(cm.entities).map(([m, e]) => [m, {
        x: e.position.x, y: e.position.y, z: e.position.z, heading: e.heading
      }]));
      return { mode: cm.activeMode, entities, camera: cs.activePresetId };
    },
    // Taken out of the city: its meshes, its camera and its speedometer
    dispose() {
      cs.release();
      for (const e of Object.values(cm.entities)) { e.mesh?.removeFromParent(); e.helmet?.removeFromParent(); }
      dropRadar();
      hud.remove();
      radarHud.remove();
      divider.remove();
    }
  };
}

// The two halves drawn each into a picture of their own, then laid side by side and graded as the one view is
// (post-processing.js), without the glow, so two views cost about what one did with it.
function createSplitView(renderer, { samples = 0 } = {}) {
  const size = new THREE.Vector2();
  const targets = [0, 1].map(() => new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
  // named as the scene pass names its colour: a material with outputs of its own (the contact shadows, the glass and
  // water effects: tsl-materials.js) writes to the buffer named 'output', and with none of that name wrote nothing,
  // which the browser rejected ("Active draw buffers with missing fragment shader outputs")
  for (const t of targets) t.texture.name = 'output';
  const half = (shift) => vec2(screenUV.x.mul(2).sub(shift), screenUV.y);
  const both = screenUV.x.lessThan(0.5).select(texture(targets[0].texture, half(0)), texture(targets[1].texture, half(1)));
  const grade = createPostProcessing(renderer, both, vec3(0), { bloom: false });
  const pipeline = new THREE.RenderPipeline(renderer, grade.outputNode);
  return {
    grade,
    // halves: [{ scene, camera, before }] for the left and the right
    render(halves) {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.ceil(size.x / 2)), h = Math.max(1, size.y);
      const was = renderer.getRenderTarget();
      halves.forEach(({ scene, camera, before }, i) => {
        if (targets[i].width !== w || targets[i].height !== h) targets[i].setSize(w, h);
        before?.();
        renderer.setRenderTarget(targets[i]);
        renderer.render(scene, camera);
      });
      renderer.setRenderTarget(was);
      pipeline.render();
    },
    dispose() {
      pipeline.dispose();
      grade.dispose();
      for (const t of targets) t.dispose();
    }
  };
}

export { createSecondPlayer, createSplitView };
