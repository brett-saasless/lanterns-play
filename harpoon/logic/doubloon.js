// The doubloon's sightline puzzle (R9, R20, R26, G18): the collar's angle round the mast, three
// bearings (tower, flame, cock), which coin marks sit on their landmarks, the hold, and the nail.
// doubloon.marksOf is pure, from the landmark bearings in dockconfig.js's cfg.glass.marks: tower
// and cock answer across a wide arc (R13: "can be matched from most of the arc"), flame across a
// narrow one, so the search the player makes is for the flame alone once the other two already
// hold. Collar 0 starts away from the answer (the edge case), walked round at cfg.glass.collarSpeed.

/** The collar's starting angle (degrees): away from every mark's arc (the edge case). */
export const START_COLLAR = 120;

/** A fresh glass: not raised, the collar away from the answer, nothing held, not nailed. */
export function createGlass() {
  return { up: false, collar: START_COLLAR, hold: 0, nailed: false };
}

/** a - b, normalized to (-180, 180]. */
function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** 0 to 360, normalized to (-180, 180]. */
function norm(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * The three marks at collar angle `collar` (degrees): { tower, flame, cock, all }, each true
 * while the collar sits within that landmark's answering arc of its bearing (cfg.glass.marks).
 */
export function marksOf(collar, cfg) {
  const M = cfg.glass.marks;
  const held = (m) => Math.abs(angleDiff(collar, m.az)) <= m.arc / 2;
  const tower = held(M.tower);
  const flame = held(M.flame);
  const cock = held(M.cock);
  return { tower, flame, cock, all: tower && flame && cock };
}

/** Raises the glass (the use control, not already up): true when it changed. */
export function raise(g) {
  if (g.up) return false;
  g.up = true;
  return true;
}

/** Lowers the glass: true when it changed. Clears the hold (walking the collar on is free, but the hold restarts). */
export function lower(g) {
  if (!g.up) return false;
  g.up = false;
  g.hold = 0;
  return true;
}

/** Walks the collar at cfg.glass.collarSpeed under moveX (left/right), one frame, while the glass is up. */
export function stepCollar(g, moveX, cfg, dt) {
  if (!g.up || g.nailed) return;
  g.collar = norm(g.collar + (moveX || 0) * cfg.glass.collarSpeed * dt);
}

/**
 * One frame of the hold: while all three marks hold together the clock runs; the moment any one
 * lets go it resets to zero (R9: "dims when it leaves"). Nailed once held for cfg.glass.hold
 * seconds; stays nailed from then on (the collar may still be walked, but the prompt has changed).
 */
export function stepHold(g, cfg, dt) {
  if (!g.up || g.nailed) return false;
  const m = marksOf(g.collar, cfg);
  g.hold = m.all ? g.hold + dt : 0;
  if (g.hold >= cfg.glass.hold) {
    g.nailed = true;
    return true; // fires once, the frame it completes
  }
  return false;
}
