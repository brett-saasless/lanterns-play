// The painted heads that follow the warden (owner, 2026-11-18): every painted face in the castle
// (the gallery's sitters, the mirror room's, the three wives) and the half-finished portrait on
// the easel in the Rose Court has a small sculpted head standing out of the canvas, and the head
// turns toward the warden: slowly, continuously, so it reads as aware and not twitchy. The
// werewolf painting is not one of them (its eyes move as before).
//
// The rule, pure (no three, no DOM, no clock): headYawToward() takes where the painting hangs and
// which way it faces, where the warden's eye is, the head's yaw last frame and the frame's dt,
// and returns the head's new yaw, relative to the painting's facing.
//
//   - It follows the warden while he is within `range` (8 m) of the head and in front of the
//     canvas, leading him by `gain` (1.5: a warden 20 degrees off is met 30 degrees round, so a
//     gentle walk past makes a bigger turn; the art critic), at most `limit` (40 degrees) either way, never faster than `rate` (40 degrees a
//     second; a quarter of that under reduced motion). The last part of a turn slows (ease out),
//     so it settles instead of stopping dead.
//   - Out of range, behind the canvas, or a floor away, the goal is neutral (0) and the head eases
//     back to it at the same rates.
//   - The goal is a continuous function of where the warden is: the edges (the range, the plane
//     of the canvas, the floor) fade over a short band, so a warden standing on an edge never
//     makes a head hunt, and walking round behind a painting never flips its head.
//   - headSeen(): a head does not turn at all until it has first been on screen within `wake`
//     (5 m), so the warden sees its first turn begin instead of finding it already turned. The
//     views keep that flag per head and clear it when they rest the heads (a restore, a new room).
//   - A paused frame (dt 0 or less) moves nothing; a long frame is cut to 0.25 s; anything not a
//     number is treated as missing; the result is always finite and within the limit.
//
// Angles use the game's heading sense: a heading h faces (-sin h, -cos h), as player.yaw and the
// views' headingTo(dx, dz) = atan2(-dx, -dz). A head's world heading is paintingYaw + the result.

const DEG = Math.PI / 180;

export const HEAD_TURN = Object.freeze({
  rate: 40 * DEG, // most radians a second
  limit: 40 * DEG, // most radians either way
  range: 8, // metres from the head
  reduced: 0.25, // the share of the rate under reduced motion
  gain: 1.5, // the goal is the warden's bearing times this (then held to the limit)
  wake: 5, // metres: a head wakes once it has been on screen this near
  view: 35 * DEG, // radians either side of where the warden looks that count as on screen
  follow: 3, // per second: how the end of a turn slows (the gap closes at this share a second)
  creep: 2 * DEG, // least radians a second while there is any gap left, so it arrives exactly
  soft: 0.75, // metres inside the range over which the goal fades out
  side: 3 * DEG, // radians either side of the canvas's plane over which the goal fades out
  floor: [2.5, 3.5], // metres of height apart over which the goal fades out (another floor)
  close: [0.2, 0.6], // metres along the ground under which the bearing means nothing
  maxDt: 0.25, // seconds: the longest frame it will take
});

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const pos = (o, d) => (fin(o) && o > 0 ? o : d);
const NONE = Object.freeze({}); // no options: nothing is made per call

/**
 * The head's yaw this frame, relative to the painting's facing (radians, positive turns the way
 * a heading increases). paintingPos and playerPos: { x, z, y? } (y is used when both have one);
 * paintingYaw: the heading the canvas faces; prevYaw: last frame's result (0 at rest); dt in
 * seconds. opts: { rate?, limit?, range?, reduced? } (a limit is never more than 90 degrees).
 */
export function headYawToward(paintingPos, paintingYaw, playerPos, prevYaw, dt, opts) {
  const o = opts || NONE;
  const limit = Math.min(pos(o.limit, HEAD_TURN.limit), Math.PI / 2);
  const range = pos(o.range, HEAD_TURN.range);
  const k = o.reduced ? HEAD_TURN.reduced : 1;
  const rate = pos(o.rate, HEAD_TURN.rate) * k;
  const creep = Math.min(HEAD_TURN.creep * k, rate);
  const y = fin(prevYaw) ? clamp(prevYaw, -limit, limit) : 0;
  if (!fin(dt) || dt <= 0) return y;
  const step = Math.min(dt, HEAD_TURN.maxDt);

  let goal = 0;
  const P = paintingPos; const W = playerPos;
  if (P && W && fin(P.x) && fin(P.z) && fin(W.x) && fin(W.z) && fin(paintingYaw)) {
    const dx = W.x - P.x; const dz = W.z - P.z;
    const dy = fin(P.y) && fin(W.y) ? W.y - P.y : 0;
    const flat = Math.hypot(dx, dz);
    const d = Math.hypot(flat, dy);
    const rel = wrap(Math.atan2(-dx, -dz) - paintingYaw);
    const sideCos = Math.sin(HEAD_TURN.side);
    const fade = (1 - smooth(range - HEAD_TURN.soft, range, d)) // in range
      * smooth(-sideCos, sideCos, Math.cos(rel)) // in front of the canvas
      * (1 - smooth(HEAD_TURN.floor[0], HEAD_TURN.floor[1], Math.abs(dy))) // on this floor
      * smooth(HEAD_TURN.close[0], HEAD_TURN.close[1], flat); // not standing on it
    goal = clamp(rel * HEAD_TURN.gain, -limit, limit) * fade;
  }

  const gap = goal - y;
  if (gap === 0) return y;
  const speed = clamp(Math.abs(gap) * HEAD_TURN.follow, creep, rate);
  const move = Math.min(Math.abs(gap), speed * step);
  return clamp(y + Math.sign(gap) * move, -limit, limit);
}

/**
 * Whether a head is awake: it was already (seen), or it is on screen now: within HEAD_TURN.wake
 * of the eye and within HEAD_TURN.view of where the warden looks (lookYaw, a heading). With no
 * eye or no look to go on (the title's fly-through) it wakes; with no head it does not.
 */
export function headSeen(seen, head, eye, lookYaw) {
  if (seen) return true;
  if (!head || !fin(head.x) || !fin(head.z)) return false;
  if (!eye || !fin(eye.x) || !fin(eye.z) || !fin(lookYaw)) return true;
  const dx = head.x - eye.x; const dz = head.z - eye.z;
  const dy = fin(head.y) && fin(eye.y) ? head.y - eye.y : 0;
  if (Math.hypot(dx, dy, dz) > HEAD_TURN.wake) return false;
  return Math.abs(wrap(Math.atan2(-dx, -dz) - lookYaw)) <= HEAD_TURN.view;
}
