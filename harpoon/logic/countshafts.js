// The shafts of dawn in the Count's room, where each lies on the boards (keepprops.js draws them
// from this). Each curtain's window throws a pool of gold from its sill west across the room,
// widening and fading as it goes. The middle window's (the cord's, issue #7) falls square on the
// box and is what burns him; the two side windows' fall just off to either side of the box (the
// owner, 2026-11-19: "the light from the side windows should not hit the count when the shades are
// open. they should land just off to the side of his coffin. the central window light lands
// perfectly now"), with a dark strip of boards between the gold and the box.
//
// A shaft's centre line runs from its window's z at the sill toward the box's middle, keeping
// `aim` of its offset from it at the far end (per curtain: 0.3 drew the side pools onto the box;
// the middle one has no offset, so its aim changes nothing).

import { COUNT_ROOM, MIDDLE_CURTAIN } from './keepmap.js';

/** Each curtain's aim (by COUNT_ROOM.curtains index): the share of its offset from the box's middle kept at the far end. */
export const SHAFT_AIM = Object.freeze(COUNT_ROOM.curtains.map((c, i) => (i === MIDDLE_CURTAIN ? 0.3 : 0.6)));

/** The pool's run: from `sill` west of the east wall to `far` west of the box's middle, half width half[0] to half[1], N strips. */
export const SHAFT = Object.freeze({ sill: 0.25, far: 2.6, half: Object.freeze([0.85, 1.5]), fade: 1.4, strips: 10, lift: 0.05 });

const lerp = (a, b, k) => a + (b - a) * k;
const B = COUNT_ROOM.box;
const BX = (B.minX + B.maxX) / 2;
const BZ = (B.minZ + B.maxZ) / 2;

/**
 * Curtain i's shaft `t` of the way from its sill (0) to its far end (1), into out: x, its two
 * edges z0 < z1, and k (its brightness, 1 at the sill fading to 0).
 */
export function shaftEdge(i, t, out = {}) {
  const c = COUNT_ROOM.curtains[i];
  const x0 = COUNT_ROOM.rect.maxX - SHAFT.sill; const x1 = BX - SHAFT.far;
  const zc = lerp(c.z, BZ + (c.z - BZ) * SHAFT_AIM[i], t);
  const half = lerp(SHAFT.half[0], SHAFT.half[1], t);
  out.x = lerp(x0, x1, t);
  out.z0 = zc - half; out.z1 = zc + half;
  out.k = (1 - t) ** SHAFT.fade;
  return out;
}

/** Curtain i's shaft's z extent where it crosses x (linear between its strips, as drawn), or null off its run. */
export function shaftAt(i, x, out = {}) {
  const N = SHAFT.strips; const a = {}; const b = {};
  for (let k = 0; k < N; k++) {
    shaftEdge(i, k / N, a); shaftEdge(i, (k + 1) / N, b);
    if (x <= a.x + 1e-9 && x >= b.x - 1e-9) {
      const f = (x - a.x) / (b.x - a.x);
      out.z0 = lerp(a.z0, b.z0, f); out.z1 = lerp(a.z1, b.z1, f);
      return out;
    }
  }
  return null;
}
