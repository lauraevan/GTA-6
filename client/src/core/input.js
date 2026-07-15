// Keyboard + mouse input with per-frame edge detection and pointer-lock mouse look.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.prevKeys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = new Set();
    this.prevButtons = new Set();
    this.pointerLocked = false;
    this.wantLock = false;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      // stop the browser stealing game keys
      if (['Tab', 'Space', 'F5', 'KeyR'].includes(e.code) || e.code.startsWith('Arrow')) {
        if (e.code === 'F5' || e.code === 'Tab') e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
      this.mouseX = e.clientX; this.mouseY = e.clientY;
    });
    window.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      if (this.wantLock && !this.pointerLocked) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try { this.canvas.requestPointerLock?.(); } catch (e) { /* headless/denied */ }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
  setLockWanted(v) {
    this.wantLock = v;
    if (v) this.requestLock(); else this.releaseLock();
  }

  // ---- queries ----
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { return this.enabled && this.keys.has(code) && !this.prevKeys.has(code); }
  released(code) { return this.enabled && !this.keys.has(code) && this.prevKeys.has(code); }
  mouseDown(b = 0) { return this.enabled && this.buttons.has(b); }
  mousePressed(b = 0) { return this.enabled && this.buttons.has(b) && !this.prevButtons.has(b); }

  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  // call at END of frame
  endFrame() {
    this.prevKeys = new Set(this.keys);
    this.prevButtons = new Set(this.buttons);
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }
}
