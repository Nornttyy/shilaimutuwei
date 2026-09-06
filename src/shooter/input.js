const BLOCKED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'ShiftLeft', 'ShiftRight']);

export class ShooterInput {
  constructor(canvas, { onPointerLockChange } = {}) {
    this.canvas = canvas;
    this.onPointerLockChange = onPointerLockChange;
    this.keys = new Set();
    this.pressed = new Set();
    this.firing = false;
    this.lookX = 0;
    this.lookY = 0;

    this.bound = {
      keydown: (event) => this.handleKeyDown(event),
      keyup: (event) => this.handleKeyUp(event),
      pointerdown: (event) => this.handlePointerDown(event),
      pointerup: (event) => this.handlePointerUp(event),
      mousemove: (event) => this.handleMouseMove(event),
      pointerlockchange: () => this.handlePointerLockChange(),
      blur: () => this.releaseAll(),
      contextmenu: (event) => event.preventDefault(),
    };
    window.addEventListener('keydown', this.bound.keydown);
    window.addEventListener('keyup', this.bound.keyup);
    window.addEventListener('pointerup', this.bound.pointerup);
    window.addEventListener('blur', this.bound.blur);
    document.addEventListener('mousemove', this.bound.mousemove);
    document.addEventListener('pointerlockchange', this.bound.pointerlockchange);
    canvas.addEventListener('pointerdown', this.bound.pointerdown);
    canvas.addEventListener('contextmenu', this.bound.contextmenu);
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  lock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  unlock() {
    if (this.locked) document.exitPointerLock?.();
  }

  handleKeyDown(event) {
    if (!this.locked) return;
    if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
    if (!event.repeat) this.pressed.add(event.code);
    this.keys.add(event.code);
  }

  handleKeyUp(event) {
    this.keys.delete(event.code);
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    if (this.locked) this.firing = true;
  }

  handlePointerUp(event) {
    if (event.button === 0) this.firing = false;
  }

  handleMouseMove(event) {
    if (!this.locked) return;
    this.lookX += event.movementX || 0;
    this.lookY += event.movementY || 0;
  }

  handlePointerLockChange() {
    if (!this.locked) this.releaseAll();
    this.onPointerLockChange?.(this.locked);
  }

  axis(negativeCode, positiveCode) {
    return Number(this.keys.has(positiveCode)) - Number(this.keys.has(negativeCode));
  }

  movement() {
    return {
      x: this.axis('KeyA', 'KeyD'),
      y: this.axis('KeyS', 'KeyW'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  consumeLook() {
    const delta = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return delta;
  }

  consumePressed(code) {
    const present = this.pressed.has(code);
    this.pressed.delete(code);
    return present;
  }

  releaseAll() {
    this.keys.clear();
    this.pressed.clear();
    this.firing = false;
    this.lookX = 0;
    this.lookY = 0;
  }

  destroy() {
    this.releaseAll();
    window.removeEventListener('keydown', this.bound.keydown);
    window.removeEventListener('keyup', this.bound.keyup);
    window.removeEventListener('pointerup', this.bound.pointerup);
    window.removeEventListener('blur', this.bound.blur);
    document.removeEventListener('mousemove', this.bound.mousemove);
    document.removeEventListener('pointerlockchange', this.bound.pointerlockchange);
    this.canvas.removeEventListener('pointerdown', this.bound.pointerdown);
    this.canvas.removeEventListener('contextmenu', this.bound.contextmenu);
  }
}
