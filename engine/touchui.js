// The touch overlay (layout C): builds the on-screen controls in `root` and drives controls.touch.
// Thin DOM glue only: the stick maths and which buttons show live in logic/touchmap.js.
import { visibleControls, stickFromPoint } from '../logic/touchmap.js';
import { ICONS } from './touchicons.js';

// [data-touch value, label]. The look zone comes first so every button sits above it.
const PARTS = [
  ['look', ''],
  ['stick', ''],
  ['fire', ''],
  ['jump', ''],
  ['e', ''],
  ['swap', ''], // the weapon cycle, the castle's hand lantern on it once taken
  ['pause', 'II'],
  ['log', ''],
  ['skip', 'SKIP'],
];

export function createTouchUi({ root, controls, hooks }) {
  const touch = controls.touch;
  const html = document.documentElement;
  const els = {};
  const held = new Map(); // pointerId -> { el, x, y, release }
  const downOnOverlay = new Set(); // pointers that went down on a control and have not lifted yet
  let releasedAt = -Infinity; // when a finger that went down on a control last lifted (main.js's ghost-click guard)

  for (const [name, label] of PARTS) {
    const el = document.createElement('div');
    el.dataset.touch = name;
    if (label) el.textContent = label;
    if (ICONS[name]) { el.innerHTML = ICONS[name]; el.ariaLabel = name; } // a picture, not a word
    if (name === 'stick') el.appendChild(document.createElement('i'));
    root.appendChild(el);
    els[name] = el;
  }
  const knob = els.stick.firstChild;
  let eIcon = 'hand'; // the picture E carries now (ICONS.e, the hand, as built)
  els.e.dataset.icon = eIcon;
  let knobBy = null; // the pointer that owns the stick role: only it moves or recentres the knob

  function stickAt(id, e) {
    const r = els.stick.getBoundingClientRect();
    const radius = r.width / 2;
    const p = stickFromPoint(e.clientX, e.clientY, r.left + radius, r.top + r.height / 2, radius);
    touch.setStick(id, p.x, p.y); // touchinput keeps the stick role for its first finger
    if (knobBy !== null && knobBy !== id) return; // a second finger on the stick does not move the knob
    knobBy = id;
    const travel = radius - knob.offsetWidth / 2;
    knob.style.transform = `translate(${p.x * travel}px, ${p.y * travel}px)`;
  }

  // One control's pointer handling: down captures, move reports, up/cancel/lost capture release.
  function bind(el, { down, move, up }) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const id = e.pointerId;
      if (held.has(id)) return;
      downOnOverlay.add(id);
      try { el.setPointerCapture(id); } catch { /* capture is best effort */ }
      held.set(id, { el, x: e.clientX, y: e.clientY, release: up });
      el.classList.add('on');
      if (down) down(id, e);
    });
    el.addEventListener('pointermove', (e) => {
      const h = held.get(e.pointerId);
      if (!h || h.el !== el) return;
      const dx = e.clientX - h.x;
      const dy = e.clientY - h.y;
      h.x = e.clientX;
      h.y = e.clientY;
      if (move) move(e.pointerId, dx, dy, e);
    });
    const end = (e) => release(e.pointerId, el);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  function release(id, el) {
    const h = held.get(id);
    if (!h || (el && h.el !== el)) return;
    held.delete(id);
    touch.cancel(id);
    if (h.release) h.release(id);
    if (![...held.values()].some((o) => o.el === h.el)) h.el.classList.remove('on');
  }

  const releaseAllOn = (el) => { for (const [id, h] of [...held]) if (h.el === el) release(id, el); };

  bind(els.stick, {
    down: stickAt,
    move: (id, dx, dy, e) => stickAt(id, e),
    up: (id) => { if (id !== knobBy) return; knobBy = null; knob.style.transform = ''; },
  });
  bind(els.fire, {
    down: (id) => touch.fireStart(id),
    move: (id, dx, dy) => touch.fireMove(id, dx, dy),
  });
  bind(els.look, { move: (id, dx, dy) => touch.lookMove(id, dx, dy) });
  bind(els.jump, { down: () => touch.press('jump') });
  bind(els.swap, { down: () => touch.press('swap') });
  bind(els.skip, { down: () => touch.press('skip') });
  bind(els.e, {
    down: () => { touch.press('interact'); hooks.holdE(true); },
    up: () => hooks.holdE(false),
  });
  bind(els.pause, { down: () => hooks.pause() });
  bind(els.log, { down: () => hooks.toggleLog() });

  // Touch mode: seeded from the primary pointer, then follows whichever pointer went down last.
  function setMode(on, report) {
    const changed = controls.setTouchMode(on);
    html.classList.toggle('touch', on);
    if (changed && report) hooks.modeChanged(on);
  }
  let coarse = false;
  try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { coarse = false; }
  if (coarse) setMode(true, false);

  const onPointerDown = (e) => {
    downOnOverlay.delete(e.pointerId); // a new press (capture runs first): a control's own handler adds it back
    if (e.pointerType === 'touch') setMode(true, true);
    else if (e.pointerType === 'mouse') setMode(false, true);
  };
  const onContextMenu = (e) => {
    if (!html.classList.contains('touch')) return;
    const t = e.target;
    if (root.contains(t) || (t && t.tagName === 'CANVAS')) e.preventDefault();
  };
  // The lift is timed on the document: a control that hid as its press opened a card (pause, E) has
  // already let go of the finger, and the finger may lift anywhere.
  const onLift = (e) => { if (downOnOverlay.delete(e.pointerId)) releasedAt = performance.now(); };
  // iOS Safari ignores user-scalable=no: a pinch on a card would zoom the page, with no way back in play.
  const onGesture = (e) => { if (html.classList.contains('touch')) e.preventDefault(); };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('pointerup', onLift, true);
  document.addEventListener('pointercancel', onLift, true);
  document.addEventListener('gesturestart', onGesture, { capture: true, passive: false });

  function setContext(ctx) {
    root.dataset.state = ctx.state;
    const vis = visibleControls(ctx);
    const show = { ...vis, stick: vis.fire, look: vis.fire }; // the stick and look zone go with play
    for (const name of Object.keys(els)) {
      const off = !show[name];
      if (off && !els[name].hidden) releaseAllOn(els[name]); // a control that hides lets go of its finger
      els[name].hidden = off;
    }
    // E's picture: a hand, or a foot for the Knight's Walk leap (logic/touchmap.js useIcon); swapped only on a change
    const icon = ctx.useIcon === 'foot' ? 'foot' : 'hand';
    if (icon !== eIcon) {
      eIcon = icon;
      els.e.innerHTML = icon === 'foot' ? ICONS.foot : ICONS.e;
      els.e.dataset.icon = icon;
    }
  }

  function destroy() {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('pointerup', onLift, true);
    document.removeEventListener('pointercancel', onLift, true);
    document.removeEventListener('gesturestart', onGesture, { capture: true });
    for (const id of [...held.keys()]) release(id);
    for (const el of Object.values(els)) el.remove();
  }

  return { setContext, destroy, releasedAt: () => releasedAt };
}
