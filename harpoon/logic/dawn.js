// The dock's one clock of light (R11, G15, G18): fog and sky eased from the stage reached, never
// from wall time (critique F1: the fourth breakpoint is "nailed", matching the Components table's
// own progress keys - arrival, signed on, nailed, cast off - not "at the glass", which the
// Numbers table first read before the fix). Pure: dawn.skyOf is a function of k alone.

import { DOCK_CONFIG } from './dockconfig.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, t) => a + (b - a) * t;

/** The four breakpoints, in order, as k (0 to 1): arrive, signed on, nailed, cast off. */
export const BREAKPOINTS = Object.freeze([0, 1 / 3, 2 / 3, 1]);

/** sim.waves.stage (0 arrived .. 4 cast off) to the dawn clock's target k. Stage 1 (harpoon won) holds at arrival's: the fog does not thin until signing on. */
export function targetFor(stage) {
  if (stage <= 1) return BREAKPOINTS[0];
  if (stage === 2) return BREAKPOINTS[1];
  if (stage === 3) return BREAKPOINTS[2];
  return BREAKPOINTS[3];
}

/** How fast the clock eases toward its target: a simple exponential approach (a starting value). */
export const EASE_RATE = 0.25;

/** One frame: sim.waves.dawn eased toward targetFor(sim.waves.stage). */
export function stepDawn(sim, dt) {
  const w = sim.waves;
  const target = targetFor(w.stage);
  const k = typeof w.dawn === 'number' ? w.dawn : 0;
  const rate = 1 - Math.exp(-EASE_RATE * Math.max(0, dt || 0));
  w.dawn = clamp(k + (target - k) * rate);
}

function hexLerp(a, b, t) {
  const ar = (a >> 16) & 0xff; const ag = (a >> 8) & 0xff; const ab = a & 0xff;
  const br = (b >> 16) & 0xff; const bg = (b >> 8) & 0xff; const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t)); const g = Math.round(lerp(ag, bg, t)); const b2 = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | b2;
}

/**
 * Fog density, fog colour, and the sky's key colour and strength at dawn clock k (0 to 1). Fog
 * density is piecewise-linear across the four breakpoints (cfg.dawn.fog); the fog colour holds
 * at cfg.dawn.fogColor throughout (one value, shared with the breach's cover). The sky eases from
 * the fog colour, dim, to cfg.dawn.firstSun at full strength by cast-off.
 */
export function skyOf(k, cfg = DOCK_CONFIG) {
  const kk = clamp(k);
  const F = cfg.dawn.fog;
  const vals = [F.arrive, F.signedOn, F.nailed, F.castOff];
  let fogDensity = vals[vals.length - 1];
  for (let i = 0; i < BREAKPOINTS.length - 1; i++) {
    if (kk >= BREAKPOINTS[i] && kk <= BREAKPOINTS[i + 1]) {
      const t = (kk - BREAKPOINTS[i]) / (BREAKPOINTS[i + 1] - BREAKPOINTS[i]);
      fogDensity = lerp(vals[i], vals[i + 1], t);
      break;
    }
  }
  return {
    fogDensity,
    fogColor: cfg.dawn.fogColor,
    sky: { color: hexLerp(cfg.dawn.fogColor, cfg.dawn.firstSun, kk), strength: lerp(0.3, 1.0, kk) },
  };
}
