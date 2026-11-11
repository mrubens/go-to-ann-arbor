import { input } from '../lamp-game.js';

// Touch input stays separate from the keyboard, so releasing a finger never releases a held key.
const DEAD_ZONE = 0.15;
const MAX_RADIUS = 44;

// Each action button shows a picture only; its words stay as the button's spoken name.
const TOUCH_ICONS = {
  Jump: 'i-jump', Handbrake: 'i-handbrake', Ascend: 'i-ascend', Descend: 'i-descend',
  'Get in': 'i-get-in', 'Get out': 'i-get-out', 'Jump out': 'i-jump-out',
};

class TouchControls {
  constructor(controllerManager) {
    this.controller = controllerManager;
    this.root = document.getElementById('touch-controls');
    this.stick = document.getElementById('touch-stick');
    this.knob = document.getElementById('touch-stick-knob');
    this.buttons = this.root ? [...this.root.querySelectorAll('[data-touch-action]')] : [];
    this.buttonPointers = new Map();
    this.stickPointer = null;
    this.enabled = true;
    this.available = false;
    this.onAvailabilityChange = null;
    this.onGetInOut = null; // (main.js) the tap button: get in or out
    this.getInOut = this.root?.querySelector('[data-touch-tap="getinout"]') ?? null;
    this.onHorn = null; // (main.js) the horn, one honk a tap, shown only while driving a car
    this.horn = this.root?.querySelector('[data-touch-tap="horn"]') ?? null;
    this.onSiren = null; // (main.js) lights and siren on or off, shown only in a cruiser or the ambulance (setSiren)
    this.siren = this.root?.querySelector('[data-touch-tap="siren"]') ?? null;
    this.sirenCan = false;

    if (!this.root || !this.stick || !this.knob) return;

    this.stick.addEventListener('pointerdown', (event) => {
      if (!this.canInteract() || event.button !== 0 || this.stickPointer !== null || this.buttonPointers.has(event.pointerId)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = this.stick.getBoundingClientRect();
      this.stickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stickRadius = Math.min(MAX_RADIUS, Math.min(rect.width, rect.height) / 2) || MAX_RADIUS;
      this.stickPointer = event.pointerId;
      this.stick.setPointerCapture(event.pointerId);
      this.stick.classList.add('is-pressed');
      this.moveStick(event);
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveStick(event);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.stick.addEventListener(type, (event) => this.releaseStick(event.pointerId));
    }

    for (const button of this.buttons) {
      const action = button.getAttribute('data-touch-action');
      button.addEventListener('pointerdown', (event) => {
        if (!this.canInteract() || button.hidden || event.button !== 0 || this.buttonPointers.has(event.pointerId) || event.pointerId === this.stickPointer) return;
        event.preventDefault();
        event.stopPropagation();
        this.buttonPointers.set(event.pointerId, { button, action });
        button.setPointerCapture(event.pointerId);
        this.updateButton(button, action);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(type, (event) => this.releaseButton(event.pointerId));
      }
    }

    this.getInOut?.addEventListener('pointerdown', (event) => {
      if (!this.canInteract() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.onGetInOut?.();
    });

    if (this.horn) {
      this.horn.addEventListener('pointerdown', (event) => {
        if (!this.canInteract() || this.horn.hidden || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.horn.classList.add('is-pressed');
        this.onHorn?.();
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
        this.horn.addEventListener(type, () => this.horn.classList.remove('is-pressed'));
      }
    }

    this.siren?.addEventListener('pointerdown', (event) => {
      if (!this.canInteract() || this.siren.hidden || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.onSiren?.();
    });

    window.addEventListener('blur', () => this.reset());
    window.addEventListener('resize', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this.setMode(controllerManager.activeMode || 'car');
    this.updateAvailability();
  }

  canInteract() {
    return this.enabled && this.available && !document.hidden;
  }

  updateAvailability() {
    // While the player is playing by touch (Lamp's runtime says, main.js asks again as it changes): from the start on
    // an iPhone, an iPad or an Android phone, until a controller or the keyboard is used. A Mac has no touch screen.
    // Lamp's own touch controls are off for the city (`touch: false` in main.js), so these are its only ones.
    const available = input().kind === 'touch';
    const changed = available !== this.available;
    if (changed) this.reset();
    this.available = available;
    document.body.classList.toggle('touch-enabled', available);
    this.root.hidden = !this.enabled || !available;
    if (changed && typeof this.onAvailabilityChange === 'function') this.onAvailabilityChange(available);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.reset();
    if (this.root) this.root.hidden = !this.enabled || !this.available;
  }

  setGetOutWords(words) {
    if (!this.getInOut || !this.root) return;
    this.getInOut.setAttribute('aria-label', words);
    this.setIcon('getinout', TOUCH_ICONS[words] || 'i-get-in');
  }

  setIcon(action, id) {
    const use = this.root?.querySelector(`[data-touch-icon="${action}"] use`);
    if (use && use.getAttribute('href') !== `#${id}`) use.setAttribute('href', `#${id}`);
  }

  setMode(mode) {
    if (!['person', 'car', 'cyclist', 'helicopter', 'kayak'].includes(mode)) return;
    this.reset();
    if (!this.root) return;
    if (this.getInOut) {
      this.getInOut.hidden = false;
      this.setGetOutWords(mode === 'person' ? 'Get in' : 'Get out');
    }
    if (this.horn) this.horn.hidden = mode !== 'car';
    this.mode = mode;
    if (this.siren) this.siren.hidden = mode !== 'car' || !this.sirenCan;
    const labels = { up: mode === 'helicopter' ? 'Ascend' : mode === 'car' ? 'Handbrake' : 'Jump', down: 'Descend' };
    for (const button of this.buttons) {
      const action = button.getAttribute('data-touch-action');
      button.hidden = (action === 'up' && mode !== 'person' && mode !== 'helicopter' && mode !== 'car') || (action === 'down' && mode !== 'helicopter');
      button.setAttribute('aria-label', labels[action]);
      this.setIcon(action, TOUCH_ICONS[labels[action]]);
    }
  }

  // whether the car has a siren (a cruiser, the ambulance) and whether it's on
  setSiren(can, on) {
    this.sirenCan = Boolean(can);
    if (!this.siren) return;
    this.siren.hidden = this.mode !== 'car' || !this.sirenCan;
    this.siren.classList.toggle('is-on', Boolean(on));
    this.siren.setAttribute('aria-pressed', String(Boolean(on)));
  }

  moveStick(event) {
    const dx = event.clientX - this.stickCenter.x;
    const dy = event.clientY - this.stickCenter.y;
    const distance = Math.hypot(dx, dy);
    const reach = Math.min(distance / this.stickRadius, 1);
    const strength = Math.max(0, (reach - DEAD_ZONE) / (1 - DEAD_ZONE));
    const x = distance ? dx / distance : 0;
    const y = distance ? dy / distance : 0;
    this.knob.style.setProperty('--stick-x', `${x * reach * this.stickRadius}px`);
    this.knob.style.setProperty('--stick-y', `${y * reach * this.stickRadius}px`);
    this.controller.setTouchInput('left', Math.max(0, -x * strength));
    this.controller.setTouchInput('right', Math.max(0, x * strength));
    this.controller.setTouchInput('forward', Math.max(0, -y * strength));
    this.controller.setTouchInput('backward', Math.max(0, y * strength));
  }

  releaseCapture(element, pointerId) {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  }

  releaseStick(pointerId) {
    if (pointerId !== this.stickPointer || this.stickPointer === null) return;
    this.stickPointer = null;
    this.releaseCapture(this.stick, pointerId);
    this.stick.classList.remove('is-pressed');
    this.knob.style.setProperty('--stick-x', '0px');
    this.knob.style.setProperty('--stick-y', '0px');
    for (const action of ['forward', 'backward', 'left', 'right']) this.controller.setTouchInput(action, 0);
  }

  updateButton(button, action) {
    const held = [...this.buttonPointers.values()];
    const pressed = held.some((pointer) => pointer.button === button);
    button.classList.toggle('is-pressed', pressed);
    button.setAttribute('aria-pressed', String(pressed));
    this.controller.setTouchInput(action, held.some((pointer) => pointer.action === action) ? 1 : 0);
  }

  releaseButton(pointerId) {
    const pointer = this.buttonPointers.get(pointerId);
    if (!pointer) return;
    this.buttonPointers.delete(pointerId);
    this.releaseCapture(pointer.button, pointerId);
    this.updateButton(pointer.button, pointer.action);
  }

  reset() {
    this.releaseStick(this.stickPointer);
    for (const pointerId of this.buttonPointers.keys()) this.releaseButton(pointerId);
    this.horn?.classList.remove('is-pressed');
    for (const button of this.buttons) {
      button.classList.remove('is-pressed');
      button.setAttribute('aria-pressed', 'false');
    }
    this.controller.clearTouchInput();
  }
}

export { TouchControls };
