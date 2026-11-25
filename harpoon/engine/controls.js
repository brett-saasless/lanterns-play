// Keyboard state, pointer lock, mouse deltas and touch. Produces one input snapshot per frame.
import { createTouchInput } from './touchinput.js';

const BASE_SENS = 0.0022; // radians per pixel at sensitivity 1.0
const MAX_EVENT_DELTA = 250; // ignore browser pointer-lock spikes
const SWAP_KEYS = { Digit1: 'bore', Digit2: 'crossbow', Digit3: 'halberd', Digit4: 'cup', Digit5: 'garlic', Digit6: 'lantern' }; // weapon names as the rules know them (5: the castle's garlic, #9; 6: its hand lantern, again to put it away)

export function createControls(target) {
  const keys = new Set();
  let dx = 0;
  let dy = 0;
  let fireHeld = false;
  let jumpQueued = false;
  let reloadQueued = false;
  let interactQueued = false;
  let skipQueued = false; // a fresh Enter press: ends the bloom scene
  let swapQueued = null; // true (Q: the other weapon) or a weapon name (1 salt gun, 2 crossbow, 3 halberd, 4 cup, 5 garlic)
  let active = false; // only gather game input while PLAYING

  const touch = createTouchInput();
  let touchOn = false; // touch mode: no pointer lock, a flag stands in for it
  let touchLocked = false;

  const isLocked = () => (touchOn ? touchLocked : document.pointerLockElement === target);

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!active) return;
    if (e.code === 'Space' && !e.repeat) jumpQueued = true;
    if (e.code === 'KeyR' && !e.repeat) reloadQueued = true;
    if (e.code === 'KeyE' && !e.repeat) interactQueued = true;
    if (e.code === 'KeyQ' && !e.repeat) swapQueued = true;
    if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) swapQueued = SWAP_KEYS.Digit1;
    if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) swapQueued = SWAP_KEYS.Digit2;
    if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) swapQueued = SWAP_KEYS.Digit3;
    if ((e.code === 'Digit4' || e.code === 'Numpad4') && !e.repeat) swapQueued = SWAP_KEYS.Digit4;
    if ((e.code === 'Digit5' || e.code === 'Numpad5') && !e.repeat) swapQueued = SWAP_KEYS.Digit5;
    if ((e.code === 'Digit6' || e.code === 'Numpad6') && !e.repeat) swapQueued = SWAP_KEYS.Digit6;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) skipQueued = true;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  document.addEventListener('mousemove', (e) => {
    if (touchOn || !active || !isLocked()) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    if (Math.abs(mx) > MAX_EVENT_DELTA || Math.abs(my) > MAX_EVENT_DELTA) return;
    dx += mx;
    dy += my;
  });
  document.addEventListener('mousedown', (e) => {
    if (!touchOn && active && isLocked() && e.button === 0) fireHeld = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (!touchOn && e.button === 0) fireHeld = false;
  });

  const k = (...codes) => (codes.some((c) => keys.has(c)) ? 1 : 0);

  function clear() {
    keys.clear();
    dx = 0;
    dy = 0;
    fireHeld = false;
    jumpQueued = false;
    reloadQueued = false;
    interactQueued = false;
    swapQueued = null;
    skipQueued = false;
    touch.clear();
  }

  /** Builds the input for this frame and consumes one-shot presses and mouse deltas. */
  function snapshot(sensitivity) {
    const s = BASE_SENS * sensitivity;
    const t = touch.take(); // t.hold is ignored: the hold goes through main.js's eHeld
    const stickOn = t.moveX !== 0 || t.moveZ !== 0;
    const inp = {
      moveX: stickOn ? t.moveX : k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      moveZ: stickOn ? t.moveZ : k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      lookDX: (dx + t.dx) * s,
      lookDY: (dy + t.dy) * s,
      fire: fireHeld || t.fire,
      reload: reloadQueued,
      sprint: k('ShiftLeft', 'ShiftRight') === 1 || t.sprint,
      jump: jumpQueued || t.jump,
      interact: interactQueued || t.interact,
      swap: swapQueued || t.swap || false, // touch swap is Q: the cycle, the castle's lantern on it once taken
      skip: skipQueued || t.skip,
    };
    dx = 0;
    dy = 0;
    jumpQueued = false;
    reloadQueued = false;
    interactQueued = false;
    swapQueued = null;
    skipQueued = false;
    return inp;
  }

  /**
   * Requests pointer lock. Resolves true on success, false on refusal (denied, or the
   * browser's re-lock cooldown right after Esc). Never throws.
   */
  function requestLock() {
    if (touchOn) {
      touchLocked = true;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
        resolve(ok);
      };
      const onChange = () => { if (isLocked()) done(true); };
      const onError = () => done(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      const timer = setTimeout(() => done(isLocked()), 1500);
      try {
        const p = target.requestPointerLock();
        if (p && typeof p.then === 'function') p.then(() => done(true), () => done(false));
      } catch {
        done(false);
      }
    });
  }

  function releaseLock() {
    if (touchOn) {
      touchLocked = false;
      return;
    }
    if (isLocked()) document.exitPointerLock();
  }

  /** Switches touch mode; true only when the mode actually changed. */
  function setTouchMode(on) {
    on = !!on;
    if (on === touchOn) return false;
    touchOn = on;
    touchLocked = false;
    return true;
  }

  return {
    snapshot, clear, requestLock, releaseLock, isLocked, touch, setTouchMode,
    touchMode: () => touchOn,
    setActive(v) { active = v; if (!v) clear(); },
  };
}
