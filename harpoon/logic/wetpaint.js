// The wet runs on the easel's half-finished portrait (owner, 2026-11-18: "the paint is still wet
// and drips slowly"; the art critic: slow, but not so slow nobody sees it move). Pure: time in,
// a run's length and dryness out; court.js draws it.
//
// Each run is fast at first (2.5 cm a second, easing to 0.3 cm a second over its first 8 s, so
// about 11 cm), hangs wet for 6 s, dries back into the canvas over 3 s, is gone, and starts again
// from the top. The runs are staggered by cycle / count, so one is always in its fast start.

export const WET_PAINT = Object.freeze({
  fast: 8, // seconds of the fast start
  v0: 0.025, // metres a second at the start (odd runs a little quicker)
  v1: 0.003, // metres a second at the end of the fast start
  hold: 6, // seconds it hangs wet
  fade: 3, // seconds it takes to dry back into the canvas
  cycle: 20, // seconds from one start to the next
});

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/** Run i of n at `time` (seconds): writes { len (metres), dry (0 wet .. 1 gone) } into out and returns it. */
export function runAt(i, n, time, out) {
  const W = WET_PAINT;
  const count = fin(n) && n > 0 ? n : 1;
  const t0 = fin(time) ? time : 0;
  const t = (((t0 + ((fin(i) ? i : 0) * W.cycle) / count) % W.cycle) + W.cycle) % W.cycle;
  const v0 = W.v0 + 0.003 * (Math.abs(i) % 2); const v1 = W.v1;
  const u = Math.min(1, t / W.fast);
  let len = W.fast * (v0 * u - ((v0 - v1) * u * u) / 2); // the speed eases from v0 to v1
  const end = W.fast + W.hold;
  const dry = t <= end ? 0 : Math.min(1, (t - end) / W.fade);
  if (t > end + W.fade) len = 0; // gone: the next starts from the top
  out.len = fin(len) ? len : 0;
  out.dry = dry;
  return out;
}
