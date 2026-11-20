// Touch controls' pure maths: stick to move, finger travel to look, auto-reload and which buttons show.

export const STICK_DEAD = 0.12;
export const SPRINT_AT = 0.92;
export const TOUCH_LOOK_GAIN = 1.6;

// x right, y down, each in [-1, 1]. Forward is moveZ = -y. The dead zone is rescaled so
// the magnitude runs 0..1 across (STICK_DEAD, 1].
export function stickToMove(x, y) {
  const raw = Math.hypot(x, y);
  const m = Math.min(raw, 1);
  if (m < STICK_DEAD) return { moveX: 0, moveZ: 0, sprint: false };
  const scale = (m - STICK_DEAD) / (1 - STICK_DEAD) / raw;
  return { moveX: x * scale, moveZ: -y * scale, sprint: m >= SPRINT_AT };
}

export function lookPixels(dx, dy) {
  return { dx: dx * TOUCH_LOOK_GAIN, dy: dy * TOUCH_LOOK_GAIN };
}

export function needsAutoReload(w) {
  return w.mag === 0 && w.reserve > 0 && !w.reloading;
}

// ctx.film: a cut scene that is a film (the werewolf cutaway): nothing is played under it, so only
// SKIP stays on the screen (the stick and the look zone go with fire, so they hide too).
export function visibleControls(ctx) {
  const on = ctx.state === 'PLAYING' && !ctx.film;
  return {
    fire: on,
    jump: on,
    e: on && !!ctx.hasUsePrompt,
    swap: on && ctx.weaponCount > 1,
    lamp: on && !!ctx.hasLantern, // the castle's hand lantern, once taken, indoors (logic/lantern.js lanternReady)
    pause: on,
    log: on && !!ctx.inLogRoom,
    skip: ctx.state === 'PLAYING' && !!ctx.sceneSkippable,
  };
}

// Touch only: a click at `now` is the lifted finger's, not a tap, within `ms` of a card opening
// (`openedAt`) or of a finger leaving an on-screen control (`releasedAt`). WebKit aims that click
// where the finger lifts, which by then can be a card's button or backdrop.
export function isGhostClick(now, openedAt, releasedAt, ms) {
  return now - openedAt < ms || now - releasedAt < ms;
}

// A thumb at (px, py) on a fixed stick centred at (cx, cy): its offset over the radius,
// clamped to the unit circle. x right, y down (the input stickToMove takes).
export function stickFromPoint(px, py, cx, cy, radius) {
  if (!(radius > 0)) return { x: 0, y: 0 };
  let x = (px - cx) / radius;
  let y = (py - cy) / radius;
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  return { x: x + 0, y: y + 0 }; // + 0 turns -0 into 0
}
