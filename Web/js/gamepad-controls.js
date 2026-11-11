import { isTypingInField } from './city-config.js';
import { BUTTON, hot } from '../lamp-game.js';

const DEAD_ZONE = 0.15;
const BUTTON_COUNT = 17;

function axis(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

// Lamp's pad (id 'lamp') arrives with its sticks' dead zone already taken off (lamp-game.js), so only the raw
// Gamepad API's are given one here: taking it twice left over a quarter of the stick's travel doing nothing
const deadZone = (pad) => (pad.id === 'lamp' ? 0 : DEAD_ZONE);

function steeringAxis(pad, value) {
  const v = axis(value), dz = deadZone(pad);
  return Math.sign(v) * Math.max(0, (Math.abs(v) - dz) / (1 - dz));
}

function stick(pad, offset) {
  const x = axis(pad.axes?.[offset]), y = axis(pad.axes?.[offset + 1]);
  const distance = Math.hypot(x, y), dz = deadZone(pad);
  const strength = Math.max(0, (Math.min(distance, 1) - dz) / (1 - dz));
  return distance ? { x: x / distance * strength, y: y / distance * strength } : { x: 0, y: 0 };
}

function buttonValue(pad, index) {
  const button = pad.buttons?.[index];
  return Number.isFinite(button?.value) ? Math.max(0, Math.min(1, button.value)) : button?.pressed ? 1 : 0;
}

function buttons(pad) {
  return Array.from({ length: BUTTON_COUNT }, (_, i) => Boolean(pad.buttons?.[i]?.pressed) || buttonValue(pad, i) > 0.5);
}

// Lamp's pad (lamp-game.js: sticks with up positive, buttons as bits) as the standard gamepad the code below reads.
const STANDARD = [BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.Y, BUTTON.LB, BUTTON.RB, 0, 0, BUTTON.VIEW, BUTTON.MENU,
  BUTTON.LSTICK, BUTTON.RSTICK, BUTTON.UP, BUTTON.DOWN, BUTTON.LEFT, BUTTON.RIGHT];
function standard(pad) {
  const buttons = STANDARD.map((bit, i) => {
    const value = i === 6 ? pad.lt : i === 7 ? pad.rt : (pad.down & bit) ? 1 : 0;
    return { pressed: value > 0.5, value };
  });
  return { connected: true, index: 0, id: 'lamp', mapping: 'standard', axes: [pad.lx, -pad.ly, pad.rx, -pad.ry], buttons };
}

// The toolbar (time of day, Teleport, the map, record, sound, reset, clean view) and its lists, which a controller reaches
// by View: what's in it that can be pressed now, and whether the focus is in it
const MENU = '#hud-toolbar, .popover:popover-open';
const shown = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.offsetParent !== null)
  && !el.disabled;
const pressables = (root) => root ? [...root.querySelectorAll('button')].filter(shown) : [];
const openList = () => document.querySelector('.popover:popover-open');
const inMenu = (el) => Boolean(el && el !== document.body && el.closest?.(MENU));

class GamepadControls {
  constructor(controllerManager, cameraSystem, callbacks = {}) {
    this.controller = controllerManager;
    this.camera = cameraSystem;
    this.callbacks = callbacks;
    this.connected = false;
    this.enabled = true;
    this.padIndex = null;
    this.padId = null;
    this.previousButtons = [];
    this.suppressedButtons = [];
    this.syncButtons = true;
    this.revision = 0;
    this.focused = typeof document.hasFocus !== 'function' || document.hasFocus();

    window.addEventListener('blur', () => {
      this.focused = false;
      this.reset();
    });
    window.addEventListener('focus', () => {
      this.focused = true;
      this.reset();
    });
    document.addEventListener('visibilitychange', () => this.reset());
    // On the Xbox the pad's A also comes as an Enter pressed on whatever has focus, which presses it (lamp.js): in the
    // toolbar this file presses it itself, so that one is let go, or a button would be pressed twice
    window.addEventListener('keydown', (e) => {
      if (!e.isTrusted && e.key === 'Enter' && this._padFocus && inMenu(document.activeElement)) e.preventDefault();
    });
  }

  // View: into the toolbar, its first button (or the one for the sky now) given the focus; again, back out of it
  toggleMenu() {
    if (this._padFocus && inMenu(document.activeElement)) { this.leaveMenu(); return; }
    const items = pressables(document.getElementById('hud-toolbar'));
    const first = items.find((b) => b.classList.contains('active')) || items[0];
    if (first) this.focusItem(first);
  }

  // the focus on a button, marked (pad-focus) for the page to ring it: a focus given by a script isn't always drawn
  focusItem(el) {
    this._padFocus?.classList.remove('pad-focus');
    this._padFocus = el;
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true, focusVisible: true });
  }

  leaveMenu() {
    const list = openList();
    if (list && typeof list.hidePopover === 'function') list.hidePopover();
    if (inMenu(document.activeElement)) document.activeElement.blur();
    this._padFocus?.classList.remove('pad-focus');
    this._padFocus = null;
  }

  // In the toolbar: the d-pad or the left stick steps along it (or up and down an open list), A presses, B closes the
  // list or leaves; nothing drives meanwhile
  menuInput(pad, edge, pressed) {
    const target = document.activeElement;
    const list = openList();
    const items = list ? pressables(list) : pressables(document.getElementById('hud-toolbar'));
    const s = stick(pad, 0), now = performance.now();
    // the stick steps once as it's pushed, then again every quarter second while it's held
    const dir = Math.abs(s.x) > 0.5 || Math.abs(s.y) > 0.5 ? (Math.abs(s.x) > Math.abs(s.y) ? Math.sign(s.x) : -Math.sign(s.y)) : 0;
    let step = (edge(15) || edge(13) ? 1 : 0) - (edge(14) || edge(12) ? 1 : 0);
    if (!step && dir) {
      if (dir !== this._menuDir || now - this._menuAt > 250) step = dir;
    }
    if (dir !== this._menuDir || step) { this._menuDir = dir; this._menuAt = now; }
    if (step && items.length) {
      const i = items.indexOf(target);
      const next = items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + step))];
      this.focusItem(next);
    }
    if (edge(0) && inMenu(target) && typeof target.click === 'function') {
      target.click();
      // the map, opened from it, has the pad now
      if (!this.enabled) { this.leaveMenu(); return; }
      // a list it opened (Teleport, Reset) takes the focus, at its first entry
      const opened = openList();
      const entry = opened && opened !== list ? pressables(opened)[0] : null;
      if (entry) this.focusItem(entry);
      // and a press that took the focus out of the toolbar (a place teleported to) is the end of it
      else if (!inMenu(document.activeElement) && !opened) this.leaveMenu();
      else if (inMenu(document.activeElement)) this.focusItem(document.activeElement);
    }
    if (edge(1)) {
      if (list) {
        if (typeof list.hidePopover === 'function') list.hidePopover();
        const opener = document.querySelector(`[popovertarget="${list.id}"]`);
        if (opener && shown(opener)) this.focusItem(opener);
        else this.leaveMenu();
      } else this.leaveMenu();
    }
  }

  // Each frame Lamp's runtime gives the first controller (and in its preview the script's moves) as a pad.
  supply(pad) {
    this.supplied = pad ? standard(pad) : null;
  }

  readPad() {
    if (this.supplied !== undefined) return this.supplied;
    // Some browsers expose the API but reject it through Permissions Policy.
    try {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
      const pads = navigator.getGamepads();
      let first = null;
      for (let i = 0; i < (pads?.length || 0); i++) {
        const pad = pads[i];
        if (!pad?.connected || pad.mapping !== 'standard') continue;
        if (pad.index === this.padIndex && pad.id === this.padId) return pad;
        if (!first) first = pad;
      }
      return first;
    } catch {
      return null;
    }
  }

  reset() {
    this.revision++;
    this.controller.clearGamepadInput();
    const pad = this.readPad();
    if (pad && pad.index === this.padIndex && pad.id === this.padId) {
      this.previousButtons = buttons(pad);
      this.suppressedButtons = this.previousButtons.slice();
      this.syncButtons = false;
    } else {
      this.syncButtons = true;
    }
  }

  setEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  update(dt) {
    const pad = this.readPad();
    const connected = Boolean(pad);
    const changedPad = pad ? pad.index !== this.padIndex || pad.id !== this.padId : this.connected;
    if (changedPad) {
      this.controller.clearGamepadInput();
      this.padIndex = pad ? pad.index : null;
      this.padId = pad ? pad.id : null;
      this.syncButtons = true;
    }
    this.connected = connected;
    if (!pad) return;

    const pressed = buttons(pad);
    if (this.syncButtons) {
      // Connecting, switching pads, or resetting must not turn a held button into a fresh action.
      this.previousButtons = pressed.slice();
      this.suppressedButtons = pressed.slice();
      this.syncButtons = false;
    }
    for (let i = 0; i < BUTTON_COUNT; i++) if (!pressed[i]) this.suppressedButtons[i] = false;
    const edge = (i) => pressed[i] && !this.previousButtons[i] && !this.suppressedButtons[i];
    const held = (i) => pressed[i] && !this.suppressedButtons[i];
    // Capture edges before callbacks: changing mode or opening the map may synchronously call reset().
    const toggleMap = edge(9), closeMap = edge(1), go = edge(0), mark = edge(2);
    const cycleMode = Number(Boolean(edge(5))) - Number(Boolean(edge(4)));
    const cycleCamera = edge(3), recenter = edge(11), getInOut = edge(2);
    const radio = Number(Boolean(edge(15))) - Number(Boolean(edge(14)));
    // View: the toolbar; B: the horn (a bicycle's bell; on the map B is back); Y on the map: clear the route set with X
    const menu = edge(8), horn = edge(1), clear = edge(3);
    const menuEdges = Array.from({ length: BUTTON_COUNT }, (_, i) => edge(i));
    this.previousButtons = pressed;

    const target = document.activeElement;
    const typing = isTypingInField({ target }) || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    // Lamp's pad is only what reached this page (its preview has no focus to lose).
    const away = this.supplied === undefined && (!this.focused || document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()));
    if (away || typing) {
      this.suppressedButtons = pressed.slice();
      this.controller.clearGamepadInput();
      // in the map's search field the pad still has B (back to the map's cursor) and Menu (close the map)
      if (typing && !away && !this.enabled && (closeMap || toggleMap)) {
        target.blur?.();
        if (toggleMap) this.callbacks.onCloseMap?.();
      }
      return;
    }

    const revision = this.revision;
    // (the mouse took the focus out of the toolbar: no longer the pad's)
    if (this._padFocus && !inMenu(target)) { this._padFocus.classList.remove('pad-focus'); this._padFocus = null; }
    // in the toolbar or one of its lists (View): the pad works the toolbar until it's left. Only by the pad's own way
    // in: a toolbar button clicked with the mouse keeps the focus, and the pad still drives
    if (this.enabled && !toggleMap && ((this._padFocus && inMenu(target)) || menu)) {
      this.controller.clearGamepadInput();
      if (menu) this.toggleMenu();
      else this.menuInput(pad, (i) => menuEdges[i], pressed);
      // what's held as the toolbar is left does nothing until it's let go
      this.suppressedButtons = pressed.slice();
      return;
    }
    if (toggleMap) {
      if (this._padFocus) this.leaveMenu();
      this.controller.clearGamepadInput();
      this.callbacks.onToggleMap?.();
      return;
    }
    if (!this.enabled) {
      this.controller.clearGamepadInput();
      // the map's cursor: the left stick moves it, the right pans, the triggers or the pad's up and down zoom, A goes there, X routes there, Y clears the route,
      // View types in the search field
      for (let i = 0; i < BUTTON_COUNT; i++) if (i !== 0 && i !== 1 && i !== 2 && i !== 9) this.suppressedButtons[i] = pressed[i];
      if (closeMap) {
        this.callbacks.onCloseMap?.();
        return;
      }
      const zoom = buttonValue(pad, 7) - buttonValue(pad, 6) + Number(pressed[12]) - Number(pressed[13]);
      this.callbacks.onMapInput?.({ move: stick(pad, 0), pan: stick(pad, 2), zoom, go, mark, clear, search: menu }, dt);
      return;
    }
    if (cycleMode) this.callbacks.onCycleMode?.(cycleMode);
    if (revision !== this.revision) return;
    if (getInOut) this.callbacks.onGetInOut?.();
    if (revision !== this.revision) return;
    if (cycleCamera) this.callbacks.onCycleCamera?.(1);
    if (revision !== this.revision) return;
    if (recenter) this.camera.resetOrbit();
    if (horn) this.callbacks.onHorn?.();
    if (radio) this.callbacks.onRadio?.(radio);

    const mode = this.controller.activeMode;
    const driving = mode === 'car' || mode === 'cyclist';
    const movement = driving ? { x: steeringAxis(pad, pad.axes?.[0]), y: 0 } : stick(pad, 0);
    const look = stick(pad, 2);
    let drive = -movement.y;
    let vertical = 0;
    if (driving) {
      drive = buttonValue(pad, 7) - buttonValue(pad, 6);
    } else if (mode === 'helicopter') {
      vertical = buttonValue(pad, 7) - buttonValue(pad, 6);
    }
    this.controller.setGamepadInput('forward', Math.max(0, drive));
    this.controller.setGamepadInput('backward', Math.max(0, -drive));
    this.controller.setGamepadInput('left', Math.max(0, -movement.x));
    this.controller.setGamepadInput('right', Math.max(0, movement.x));
    // A: jump, the car's handbrake, the bicycle's brake
    this.controller.setGamepadInput('up', mode === 'person' || mode === 'car' || mode === 'cyclist' ? Number(Boolean(held(0))) : Math.max(0, vertical));
    // the left stick's click, held: look behind (cameras.js)
    this.controller.setGamepadInput('lookBack', Boolean(held(10)));
    this.controller.setGamepadInput('down', Math.max(0, -vertical));
    const zoom = Number(Boolean(held(13))) - Number(Boolean(held(12)));
    this.camera.applyGamepadInput(look.x, look.y, zoom, Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0);
  }
}

// Lamp: a change to how the controller is read goes into the running city (lamp-game.js, "Changes while it's played").
hot(import.meta).accept();

export { GamepadControls };
