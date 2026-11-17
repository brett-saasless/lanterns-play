// Keyboard state, pointer lock and mouse deltas. Produces one input snapshot per frame.

const BASE_SENS = 0.0022; // radians per pixel at sensitivity 1.0
const MAX_EVENT_DELTA = 250; // ignore browser pointer-lock spikes
const SWAP_KEYS = { Digit1: 'bore', Digit2: 'crossbow', Digit3: 'halberd', Digit4: 'cup', Digit5: 'garlic' }; // weapon names as the rules know them (5: the castle's garlic, #9)

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

  const isLocked = () => document.pointerLockElement === target;

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
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) skipQueued = true;
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  document.addEventListener('mousemove', (e) => {
    if (!active || !isLocked()) return;
    const mx = e.movementX || 0;
    const my = e.movementY || 0;
    if (Math.abs(mx) > MAX_EVENT_DELTA || Math.abs(my) > MAX_EVENT_DELTA) return;
    dx += mx;
    dy += my;
  });
  document.addEventListener('mousedown', (e) => {
    if (active && isLocked() && e.button === 0) fireHeld = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) fireHeld = false;
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
  }

  /** Builds the input for this frame and consumes one-shot presses and mouse deltas. */
  function snapshot(sensitivity) {
    const s = BASE_SENS * sensitivity;
    const inp = {
      moveX: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      moveZ: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      lookDX: dx * s,
      lookDY: dy * s,
      fire: fireHeld,
      reload: reloadQueued,
      sprint: k('ShiftLeft', 'ShiftRight') === 1,
      jump: jumpQueued,
      interact: interactQueued,
      swap: swapQueued || false,
      skip: skipQueued,
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
    if (isLocked()) document.exitPointerLock();
  }

  return {
    snapshot, clear, requestLock, releaseLock, isLocked,
    setActive(v) { active = v; if (!v) clear(); },
  };
}
