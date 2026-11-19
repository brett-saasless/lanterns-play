// Where the sculpted heads are, and when their shader is built (the owner, 2026-11-18: "compile
// heads when starting the first level with a head. make the first level a parameter with a test
// incase i add levels/heads"). Pure data and rules; main.js asks shouldWarmHeads() when a level
// starts and world.warmHeads() builds the heads' one shared program then, under the level's
// loading moment, so it is never built the first time a face comes into view.
//
// To add a level: it joins LEVEL_ORDER through journey.js's NEXT. To add heads to a level: list
// the view that builds them (it calls busts.js bustSet) in HEAD_VIEWS with its room, and the room
// in HEAD_ROOMS; tests/headrooms.test.js fails until both are listed.

import { NEXT } from './journey.js';

/** The rooms in the order the journey goes through them, from a { room: next } chain. [] for none or a loop. */
export function levelOrder(next) {
  if (!next || typeof next !== 'object') return [];
  const rooms = Object.keys(next);
  const targets = new Set(Object.values(next));
  const start = rooms.find((r) => !targets.has(r));
  if (start === undefined) return [];
  const out = [];
  for (let r = start; typeof r === 'string' && !out.includes(r); r = next[r]) out.push(r);
  return out;
}

/** The levels in order: the journey's own chain (journey.js NEXT). */
export const LEVEL_ORDER = Object.freeze(levelOrder(NEXT));

/** The engine views that build sculpted heads (bustSet), and the room each draws them in. */
export const HEAD_VIEWS = Object.freeze({
  'court.js': 'court', // the half-finished portrait on the easel
  'keepcast.js': 'castle', // the gallery's, the mirror room's and the three wives' portraits
});

/** The rooms that show sculpted heads. */
export const HEAD_ROOMS = Object.freeze(['court', 'castle']);

/** The first level in `order` that has heads, or null. */
export function firstHeadRoom(order, headRooms) {
  if (!Array.isArray(order) || !Array.isArray(headRooms)) return null;
  const r = order.find((q) => headRooms.includes(q));
  return r === undefined ? null : r;
}

/** The first level a journey from the start reaches with heads in it (today the Rose Court). */
export const FIRST_HEAD_ROOM = firstHeadRoom(LEVEL_ORDER, HEAD_ROOMS);

/**
 * Whether starting `room` should build the heads' shader now: a head room, not yet warmed.
 * warmed: true once the session has warmed, or the rooms warmed so far (an array or a Set).
 */
export function shouldWarmHeads(o) {
  if (!o || typeof o !== 'object') return false;
  const { room, warmed, headRooms } = o;
  if (typeof room !== 'string' || !Array.isArray(headRooms) || !headRooms.includes(room)) return false;
  if (warmed === true) return false;
  if (warmed && typeof warmed.has === 'function' && warmed.has(room)) return false;
  if (Array.isArray(warmed) && warmed.includes(room)) return false;
  return true;
}
