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
import { CAR_RATIOS, newGearState, shiftGear, engineRPM } from './gearbox.js';

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
    if (p && [p.x, p.y, p.z, p.heading].every(Number.isFinite)) { cm.teleportActiveTo(p.x, p.z, p.heading, p.y); continue; }
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
    const here = cm.getActiveEntity(), there = cm.entities[next];
    const { x, y, z } = here.position, heading = here.heading;
    const far = Math.hypot(there.position.x - x, there.position.z - z) > 40;
    cm.setMode(next);
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

  // The second player's speedometer, in the right half's corner, laid out as the first player's race HUD
  // (index.html #hud-instruments): what they're in, the gear, the speed and, in a car, the revs
  const hud = document.createElement('div');
  hud.className = 'hud hud-bottom-right p2-hud';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const instruments = el('section', 'instruments p2-instruments');
  instruments.setAttribute('aria-label', 'Player 2 instruments');
  const name = el('div', 'race-mode');
  const readout = el('div', 'readout');
  const gearEl = el('div', 'readout-gear', 'N');
  readout.append(gearEl, el('div', 'readout-cap', 'GEAR'));
  const speedRow = el('div', 'race-speed');
  const speed = el('span', 'p2-speed', '0');
  speedRow.append(speed, el('span', 'race-unit', 'MPH'));
  const revs = el('div', 'race-revs');
  const rpmCaption = el('div', 'rev-caption');
  const rpmEl = el('span', null, '780');
  rpmCaption.append(el('span', null, 'RPM'), rpmEl);
  const revTrack = el('div', 'rev-track');
  const revFill = el('div', 'p2-rev-fill');
  revTrack.append(revFill);
  const revScale = el('div', 'rev-scale');
  revScale.append(el('span', null, '0'), el('span', null, '8 × 1000'));
  revs.append(rpmCaption, revTrack, revScale);
  instruments.append(name, readout, speedRow, revs);
  const panel = document.createElement('section');
  panel.className = 'panel cluster';
  panel.setAttribute('aria-label', 'Player 2');
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
  panel.append(chooser);
  hud.append(instruments, panel);
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
  const shown = { name: '', mph: -1, camera: '', mode: '', gear: '', rpm: -1 };
  // their car's gear and revs, from the same gearbox as the first player's (main.js gearReadout), fed their own speed
  const box = newGearState();
  const gearing = { clock: 0, last: 0, lastSpeed: 0, load: 0, first: true };
  function gearReadout(speedMps, forward) {
    const dt = Math.max(0.05, gearing.clock - gearing.last);
    const accel = (speedMps - gearing.lastSpeed) / dt;
    gearing.last = gearing.clock;
    gearing.lastSpeed = speedMps;
    const want = Math.min(1, Math.max(0, accel / 5 + Math.min(1, speedMps / 2) * (0.12 + 0.28 * Math.min(1, speedMps / 30) ** 2)));
    gearing.load += (want - gearing.load) * 0.6;
    shiftGear(box, speedMps, gearing.load, gearing.clock, gearing.first, CAR_RATIOS);
    gearing.first = false;
    const rpm = engineRPM(box, speedMps, gearing.load, CAR_RATIOS, 780);
    return { gear: speedMps < 0.5 ? 'N' : !forward ? 'R' : String(box.gear + 1), rpm: Math.round(rpm / 50) * 50 };
  }

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
    // the speedometer, every frame
    drawHud() {
      const ent = cm.getActiveEntity();
      const label = ent?.label || '';
      if (label !== shown.name) { shown.name = label; name.textContent = String(label); }
      const mphExact = (cm.activeMode === 'kayak' ? ent.groundSpeed || 0 : Math.abs(ent.speed || 0)) * 2.237;
      const mph = Math.round(mphExact);
      if (mph !== shown.mph) { shown.mph = mph; speed.textContent = String(mph); }
      // the gear and revs shown in their car only, as the first player's are (the mode on the panel, not the page)
      if (cm.activeMode !== shown.mode) { shown.mode = cm.activeMode; instruments.dataset.mode = cm.activeMode; }
      gearing.clock = performance.now() / 1000;
      if (cm.activeMode === 'car' && gearing.clock - gearing.last >= 0.1) {
        const read = gearReadout(Math.abs(ent.speed || 0), (ent.speed || 0) >= 0);
        if (read.gear !== shown.gear) { shown.gear = read.gear; gearEl.textContent = read.gear; }
        if (read.rpm !== shown.rpm) {
          shown.rpm = read.rpm;
          rpmEl.textContent = String(read.rpm);
          revFill.style.transform = `scaleX(${Math.min(1, read.rpm / 8000)})`;
        }
      }
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
