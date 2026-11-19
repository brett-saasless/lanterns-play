// The snakes in the pit, heard (owner, 2026-11-18: "it's the wind on the bridge, remove it ... add
// the snakes hissing instead. Loudest in the pit, heard when you are on the draw bridge at a medium
// level. Lower in the rest of the forecourt. Inaudible inside the castle. Audibility builds to med
// in your first few steps into the castle forecourt").
//
// Two things, both pure (no DOM, no Math.random; the only randomness is the seeded rng):
//  - hissLevel: how loud the snakes are, 0 to 1, from where the warden is. The pit 1, the deck of
//    the draw bridge 0.5, the rest of the forecourt 0.2; the road, the approach and everything from
//    the front door in are 0. Over the first RAMP metres walked after the warden comes onto the
//    bridge (or anywhere that hisses) from silent ground, the level builds from 0 to the place's
//    level: keyed on distance, so standing still part way holds it part way. After that it follows
//    the place with a GLIDE (time constant) so crossing bridge to forecourt or dropping into the
//    pit never steps. Into silent ground it falls to exactly 0 in FADE seconds, a straight line.
//  - hissPattern / hissEnvelope: each snake's own loop of hisses (when, how long, how hard), and
//    that loop drawn as a gain envelope. audio.js (keepcues.js) plays the envelope into a gain on
//    high-passed noise, so the hiss is built once and makes no node while it runs.
//
// The memory hissLevel reads and writes is a plain object the caller owns (newHiss()); audio.js
// keeps one as sound state. Nothing here reads or writes the sim.

import { makeRng } from './rng.js';
import { PIT, zoneAt } from './keepmap.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/**
 * Levels by place (0 to 1), the build-up and the glides, and the absolute gain.
 * gain: the linear gain of the hiss layer at level 1 inside the castle bed, which sits under the
 * ambient bus (LADDER.ambient 0.22). At the listener the envelope's peak is gain * 0.22 * level:
 * the pit about 0.18, the bridge about 0.09, the forecourt about 0.035 (tests/hiss.test.js holds
 * them under the tread floor, the run step and the walk step respectively).
 */
export const HISS = f({
  pit: 1,
  bridge: 0.5,
  forecourt: 0.2,
  ramp: 3, // metres walked from silent ground before the place's level is reached
  glide: 0.4, // seconds: the time constant of following the place
  fade: 1, // seconds: from wherever it is to 0 on silent ground (the front door, the approach)
  stride: 0.5, // metres: the most one frame's step may add to the ramp (a seat or a respawn is not a walk)
  gain: 0.8,
  shortest: 0.6, // seconds: one hiss, at the least
  longest: 1.6, // and at the most
  rate: 8000, // samples a second of the drawn envelope (it is a gain curve, not audio)
});

/** Where the snakes are heard from: 'pit', 'bridge', 'forecourt', or null (silent ground). */
export function hissPlace(x, z, under = null) {
  if (under === 'pit') return 'pit';
  if (under) return null; // the crypt
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (inRect(PIT.rect, x, z)) return inRect(PIT.deck, x, z) ? 'bridge' : 'pit'; // off the deck is into the pit
  return zoneAt(x, z) === 'forecourt' ? 'forecourt' : null;
}

/** The place's own level, before the build-up and the glide. */
export function placeLevel(x, z, under = null) {
  const p = hissPlace(x, z, under);
  return p ? HISS[p] : 0;
}

/** Fresh memory for hissLevel: silent, nothing walked. */
export function newHiss() {
  return { level: 0, walked: 0, px: NaN, pz: NaN, fall: 0 };
}

/**
 * Advances the memory `state` by dt seconds with the warden at (x, z) (under: sim.waves.under) and
 * returns the level, 0 to 1. Deterministic in its arguments and the memory.
 */
export function hissLevel(x, z, state, dt = 0, under = null) {
  const s = state;
  const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
  const place = placeLevel(x, z, under);
  const step = Number.isFinite(s.px) && Number.isFinite(x) ? Math.min(HISS.stride, Math.hypot(x - s.px, z - s.pz)) : 0;
  s.px = Number.isFinite(x) ? x : NaN;
  s.pz = Number.isFinite(z) ? z : NaN;
  if (place === 0) {
    // Silent ground: a straight fall to exactly 0 in FADE seconds, and the build-up starts over.
    s.walked = 0;
    if (s.level > 0) {
      if (!(s.fall > 0)) s.fall = s.level / HISS.fade;
      s.level = Math.max(0, s.level - s.fall * d);
    }
    if (s.level <= 1e-6) { s.level = 0; s.fall = 0; }
    return s.level;
  }
  s.fall = 0;
  s.walked = Math.min(HISS.ramp, s.walked + step);
  const target = place * (s.walked / HISS.ramp);
  s.level += (target - s.level) * (1 - Math.exp(-d / HISS.glide));
  s.level = clamp(s.level);
  return s.level;
}

// ---- the snakes ------------------------------------------------------------------------------

/**
 * The snakes: each its own loop of hisses (seconds long, lengths that share no beat, so the three
 * together do not repeat for many minutes), where it sits in the stereo field and how far and how
 * slowly it drifts, and the top of its noise (its high-pass). Three, so they overlap now and then.
 */
export const SNAKES = f([
  { seed: 13, loop: 15.1, pan: -0.55, swing: 0.3, drift: 0.031, hz: 3800 },
  { seed: 23, loop: 19.7, pan: 0.1, swing: 0.4, drift: 0.043, hz: 4400 },
  { seed: 37, loop: 23.3, pan: 0.6, swing: 0.3, drift: 0.057, hz: 5000 },
]);

/**
 * One snake's hisses over a loop of `length` seconds: [{ at, dur, peak, rise }], at and dur in
 * seconds, dur 0.6 to 1.6, rests of 0.8 to 4 s between, the last ending before the loop does.
 */
export function hissPattern(seed, length) {
  const rng = makeRng(seed);
  const out = [];
  let t = 0.2 + rng() * 2.5;
  for (;;) {
    const dur = HISS.shortest + rng() * (HISS.longest - HISS.shortest);
    if (t + dur > length - 0.3) break;
    out.push({ at: t, dur, peak: 0.6 + 0.4 * rng(), rise: 0.06 + 0.1 * rng() });
    t += dur + 0.8 + rng() * 3.2;
  }
  return out;
}

/**
 * The pattern drawn as a gain curve, `rate` samples a second over `length` seconds: each hiss a
 * raised-cosine rise (60 to 160 ms, never under 2 ms), a body that tires a quarter as the breath
 * runs out with a slight flutter in it, and a cosine fall over its last third. 0 between.
 */
export function hissEnvelope(pattern, length, rate = HISS.rate) {
  const n = Math.max(1, Math.round(length * rate));
  const out = new Float32Array(n);
  for (const h of pattern) {
    const i0 = Math.max(0, Math.floor(h.at * rate));
    const i1 = Math.min(n, Math.ceil((h.at + h.dur) * rate));
    const fallFrom = h.dur * (2 / 3);
    for (let i = i0; i < i1; i++) {
      const u = i / rate - h.at;
      if (u < 0 || u > h.dur) continue;
      let k = h.peak * (1 - 0.25 * (u / h.dur)) * (1 + 0.07 * Math.sin(2 * Math.PI * 5.5 * u));
      if (u < h.rise) k *= 0.5 - 0.5 * Math.cos((Math.PI * u) / h.rise);
      if (u > fallFrom) k *= 0.5 + 0.5 * Math.cos((Math.PI * (u - fallFrom)) / (h.dur - fallFrom));
      out[i] = Math.max(out[i], k);
    }
  }
  return out;
}
