// The cave heap's making (the owner, 2026-11-19: "when the cantor dies the rubble rises out of the
// earth. it should be formed by the debris falling from the destroyed ceiling and piling up over
// the course of 2 seconds"). The heap is no longer drawn rising: it is piled. Rock breaks off the
// vault round the hole as the blast bores it, falls under gravity, and lands on the pile, which
// builds from under the hole outward over the heap's footprint, so that FALL.last seconds after
// the strike the pile is exactly the drawn heap (and the walkable heap, rubble.js, is unchanged:
// this file only times how it is seen to form; nothing here is ground or collision).
//
// The pile: at each point of the heap's footprint (the path's frame: u from the lane's start, v
// across it) its height t seconds after the strike is the heap's own there (heapAt) or the growing
// pile's (a mound under the hole, level pileLevel(t) at its middle, falling away FALL.reach per unit
// of the footprint's normalised distance from the hole), whichever is lower. It only ever grows,
// so a chunk that lands on it is never left floating.
//
// The chunks: each lands at a time and a place; it lets go of the vault a fall's time before that
// (straight down under FALL.gravity, drifting across to where it lands), never before
// FALL.release. Kept chunks lie on the finished heap and land as the pile reaches its full height
// under them; the fill lands on the pile's growing slope as it grows and is buried by it.
//
// Pure: no Math.random, no DOM. Seeded (rng.js).

import { RUBBLE, heightAt } from './rubble.js';
import { makeRng } from './rng.js';

const f = Object.freeze;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };

export const FALL = f({
  gravity: 13, // metres a second squared the rock falls at (WAYOUT.cave.gravity)
  first: 0.3, // seconds after the strike the first chunk lands and the pile begins (the art critic, C9: the pile builds over the whole 2 s; the first rock is thrown down the shaft by the blast)
  last: 2.0, // seconds after the strike the pile is the whole heap and the last chunk is down (the owner: two seconds)
  release: 0.05, // no chunk lets go before this, after the strike (the bore is open by then)
  throw: 6, // metres a second the blast throws an early chunk down at the most; one that must land sooner starts lower down the shaft
  reach: 2.6, // metres the pile falls away from its middle to the footprint's edge
  low: -0.8, // metres under the floor the pile's skin lies where the pile has not yet come
  fill: 36, // chunks that land on the pile's slope as it grows (and are buried by it)
  fringe: 4, // of them, the last: stones knocked off the pile's foot onto the floor beside the lane's start
});

const HL = RUBBLE.length; const HB = RUBBLE.back.cave;
const UPH = f({ sign: 1, height: RUBBLE.height, run: RUBBLE.run, length: RUBBLE.length });

/** The drawn heap's extent in the path's frame (passages.js lays its skin over it). */
export const SKIN = f({ u0: -0.9, u1: HL + HB + 0.9, vw: RUBBLE.half + RUBBLE.flank + 0.15 });

/** The heap along its middle u metres from the lane's start: the lane's slope, then its back falling away. */
function core(u) {
  return u <= HL ? heightAt(UPH, Math.max(0, u)) : heightAt(UPH, HL) * (1 - smooth((u - HL) / (HB + 0.8)));
}

/** The finished heap's height at (u, v): the lane's floor on the lane (rubble.js heightAt), its flanks falling away beside it. */
export function heapAt(u, v) {
  const a = Math.abs(v) - RUBBLE.half;
  return a <= 0 ? core(u) : core(u) * (1 - smooth(a / (RUBBLE.flank + 0.1)));
}

/** How far (u, v) lies from under the hole (the lane's end) toward the footprint's edge: 0 there, 1 at the edge (a rounded box). */
export function pileDistance(u, v) {
  const du = u - HL;
  const a = Math.abs(du) / (du < 0 ? HL - SKIN.u0 : SKIN.u1 - HL);
  const b = Math.abs(v) / SKIN.vw;
  return Math.min(1, Math.sqrt(Math.sqrt(a * a * a * a + b * b * b * b))); // (the footprint's corners: its edge)
}

/** The pile's level at (u, v) by which it is the heap there: the heap's height plus its fall from the middle. */
export function pileKey(u, v, h0 = heapAt(u, v)) {
  return h0 + FALL.reach * pileDistance(u, v);
}

/** The pile's level at its middle when it is the whole heap: the most of pileKey over the footprint (sampled finely). */
const LAST = (() => {
  let m = 0; let at = [0, 0];
  for (let i = 0; i <= 120; i++) {
    const u = SKIN.u0 + ((SKIN.u1 - SKIN.u0) * i) / 120;
    for (let j = 0; j <= 60; j++) {
      const v = -SKIN.vw + (2 * SKIN.vw * j) / 60;
      const k = pileKey(u, v);
      if (k > m) { m = k; at = [u, v]; }
    }
  }
  return f({ top: m, u: at[0], v: at[1] });
})();
export const PILE_TOP = LAST.top;
/** Where on the footprint the pile is last to reach the heap's height (the last stone lands there). */
export const PILE_LAST = f({ u: LAST.u, v: LAST.v });

// The level's pace: quick at first (the first rock heaps under the hole), easing as it spreads (k: 0 to 1 of the pile's time)
const levelOf = (k) => PILE_TOP * (1.3 * k - 0.3 * k * k);
const timeOf = (a) => (1.3 - Math.sqrt(Math.max(0, 1.69 - 1.2 * clamp(a)))) / 0.6; // (levelOf's inverse, a: level / PILE_TOP)

/** The pile's level at its middle bt seconds after the strike: 0 until the first chunk lands, PILE_TOP at FALL.last. */
export function pileLevel(bt) {
  if (!(bt > FALL.first)) return 0;
  if (bt >= FALL.last) return PILE_TOP;
  return levelOf((bt - FALL.first) / (FALL.last - FALL.first));
}

/**
 * The pile's height at (u, v) bt seconds after the strike: the heap's own (h0) once the pile is
 * that high there, FALL.low (under the floor) where it has not yet come; Infinity for bt (no
 * scene: the heap is simply there) gives the heap.
 */
export function pileAt(u, v, bt, h0 = heapAt(u, v)) {
  if (bt >= FALL.last) return h0;
  const y = pileLevel(bt) - FALL.reach * pileDistance(u, v);
  return Math.max(Math.min(FALL.low, h0), Math.min(h0, y));
}

/** Seconds after the strike at which the pile reaches the heap's height at (u, v) (so a chunk resting there lands then). */
export function pileDoneAt(u, v, h0 = heapAt(u, v)) {
  return FALL.first + (FALL.last - FALL.first) * timeOf(pileKey(u, v, h0) / PILE_TOP);
}

/**
 * The fill: FALL.fill chunks that land on the pile's slope as it grows, the last FALL.fringe of
 * them knocked off its foot onto the floor beside the lane's start. Each: { u, v, y (the pile
 * there as it lands: where it rests), land (seconds after the strike) }. Seeded.
 */
export function fillOf(seed = 41) {
  const rnd = makeRng(seed);
  const out = [];
  const main = FALL.fill - FALL.fringe;
  for (let i = 0; i < main; i++) {
    const k = clamp((i + 0.2 + 0.6 * rnd()) / main) * 0.9; // spread over the pile's time
    const land = FALL.first + 0.02 + (FALL.last - FALL.first - 0.02) * k;
    const A = pileLevel(land);
    let pick = null;
    for (let tries = 0; tries < 12 && !pick; tries++) {
      // mostly toward the lane (down the slope it is climbed), some anywhere round the hole
      const psi = rnd() < 0.7 ? Math.PI + (rnd() - 0.5) * 2.2 : rnd() * 2 * Math.PI;
      const r = clamp((A / FALL.reach) * (0.25 + 0.6 * rnd()), 0, 0.95);
      const c = Math.cos(psi); const s = Math.sin(psi);
      const n = Math.sqrt(Math.sqrt(c * c * c * c + s * s * s * s));
      const du = (r * c) / n; const dv = (r * s) / n;
      const u = HL + du * (du < 0 ? HL - SKIN.u0 : SKIN.u1 - HL);
      const v = dv * SKIN.vw;
      const y = pileAt(u, v, land);
      if (y > 0.08) pick = { u, v, y, land };
    }
    if (pick) out.push(pick);
  }
  for (let i = 0; i < FALL.fringe - 1; i++) {
    const side = i % 2 ? 1 : -1;
    const u = 0.2 + 0.5 * (FALL.fringe - 2 - i) + 0.15 * rnd();
    const v = side * (SKIN.vw - 0.15 - 0.1 * rnd());
    const h0 = heapAt(u, v);
    out.push({ u, v, y: h0, land: pileDoneAt(u, v, h0) });
  }
  // and the very last, where the pile is last to be the heap: it lands as the heap is whole
  const h0 = heapAt(PILE_LAST.u, PILE_LAST.v);
  out.push({ u: PILE_LAST.u, v: PILE_LAST.v, y: h0, land: FALL.last });
  return out;
}

/**
 * A chunk's fall: from (x0, y0, z0) on the vault to (x1, y1, z1) where it lies, landing `land`
 * seconds after the strike, always under FALL.gravity. Returns { release (seconds after the strike
 * it lets go), land, fall (seconds), g, v0 (metres a second it is thrown down at as it lets go), x0,
 * y0, z0, x1, y1, z1 }. One that would have to let go before FALL.release lets go then instead,
 * thrown down by the blast (v0, up to FALL.throw); if even that is too slow it starts lower down
 * the shaft (y0 lowered: it is first seen there, in the blast's flash).
 */
export function fallOf(x0, y0, z0, x1, y1, z1, land) {
  const g = FALL.gravity;
  let drop = Math.max(0.05, y0 - y1);
  let fall = Math.sqrt((2 * drop) / g);
  let release = land - fall;
  let v0 = 0;
  let top = y0;
  if (release < FALL.release) {
    release = FALL.release;
    fall = Math.max(0.05, land - release);
    v0 = Math.max(0, (drop - 0.5 * g * fall * fall) / fall);
    if (v0 > FALL.throw) {
      v0 = FALL.throw;
      drop = v0 * fall + 0.5 * g * fall * fall;
      top = y1 + drop;
    }
  }
  return { release, land: release + fall, fall, g, v0, x0, y0: top, z0, x1, y1, z1 };
}

/**
 * Where a chunk is bt seconds after the strike: { x, y, z, k (0 to 1 of its fall: 0 still on the
 * vault, 1 down), up (still part of the vault: not yet let go), down (landed) }. Writes `out`.
 */
export function chunkAt(c, bt, out = {}) {
  const tau = bt - c.release;
  if (!(tau > 0)) { out.x = c.x0; out.y = c.y0; out.z = c.z0; out.k = 0; out.up = true; out.down = false; return out; }
  if (tau >= c.fall) { out.x = c.x1; out.y = c.y1; out.z = c.z1; out.k = 1; out.up = false; out.down = true; return out; }
  const k = tau / c.fall;
  out.x = c.x0 + (c.x1 - c.x0) * k;
  out.z = c.z0 + (c.z1 - c.z0) * k;
  out.y = Math.max(c.y1, c.y0 - (c.v0 || 0) * tau - 0.5 * c.g * tau * tau);
  out.k = k; out.up = false; out.down = false;
  return out;
}
