// sea-1-dock-art (docs/features/sea-1-dock-art/02-design.md, Components, Interfaces, Decisions):
// the art pass's own numbers as frozen data and pure functions, so tests/dockart.test.js imports
// this directly (no three, no DOM, no built-in random source - the house rule, as keepcues.js and hud.js are
// already importable by node:test). Nothing here writes the sim; the engine reads it.

import { makeRng } from '../logic/rng.js';

// ---- tier (R1, R2, R3, R5, R9) ---------------------------------------------------------------

/** Architecture > Tier table. Every phone number is at or under its desktop number. */
const TIERS = Object.freeze({
  desktop: Object.freeze({
    name: 'desktop', mapSize: 512, waterVertexMotion: true, waterSegments: 64,
    fogSheets: 8, sprayCards: 24, dustPuffs: 9, figureRings: 'full', shadowMap: 1024,
  }),
  phone: Object.freeze({
    name: 'phone', mapSize: 256, waterVertexMotion: false, waterSegments: 1,
    fogSheets: 3, sprayCards: 10, dustPuffs: 4, figureRings: 'halved', shadowMap: 512,
  }),
});

/**
 * Which tier a device gets (the shipped rule, logic/tunnelwalk.js tunnelTier): a coarse pointer
 * or a short side under 600 px is the phone tier; an explicit override ('phone'|'desktop') wins.
 */
export function dockTier({ coarse = false, minSide = Infinity, override = null } = {}) {
  if (override === 'phone' || override === 'desktop') return TIERS[override];
  return coarse || minSide < 600 ? TIERS.phone : TIERS.desktop;
}

// ---- hatching (R1): the engraving method, planned as strokes, drawn to canvas by engraving.js ---

/** Every material kind engraving.js names. `water` is the one kind with no strokes (UI direction, Water). */
export const HATCH_KINDS = Object.freeze([
  'timber', 'plank', 'cobble', 'brick', 'canvas', 'tarredRope', 'brass', 'bone', 'steelPlate', 'newsprint', 'water',
]);

const WEIGHT = Object.freeze({ fine: 0.6, mid: 1.0, bold: 1.6 }); // line weights on a 512 map (UI direction, The hatch)
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** A long stroke along the grain, with a chance of a knot-break (two shorter strokes with a gap). */
function grainStrokes(rng, out, count, w, wobble) {
  for (let i = 0; i < count; i++) {
    const x = (i + 0.5) / count + (rng() - 0.5) * wobble;
    const knot = rng() < 0.18;
    const y0 = 0.03 + rng() * 0.05;
    const y1 = 0.97 - rng() * 0.05;
    const cx0 = clamp01(x);
    if (knot) {
      const gapAt = 0.3 + rng() * 0.4;
      const gap = 0.05 + rng() * 0.05;
      if (rng() < 0.9) out.push({ x0: cx0, y0, x1: clamp01(x + (rng() - 0.5) * wobble), y1: clamp01(gapAt - gap / 2), w });
      out.push({ x0: cx0, y0: clamp01(gapAt + gap / 2), x1: clamp01(x + (rng() - 0.5) * wobble), y1, w });
    } else if (rng() < 0.94) {
      out.push({ x0: cx0, y0, x1: clamp01(x + (rng() - 0.5) * wobble * 1.5), y1, w });
    }
  }
}

function hatchTimberOrPlank(rng, jointEvery) {
  const strokes = [];
  grainStrokes(rng, strokes, 11, WEIGHT.mid, 0.02);
  // butt joints every plank length: a thin cross-grain tick, a few skipped (a machine never ruled this)
  const cross = [];
  for (let y = jointEvery / 2; y < 1; y += jointEvery) {
    if (rng() < 0.8) cross.push({ x0: clamp01(0.02 + rng() * 0.03), y0: clamp01(y), x1: clamp01(0.95 + rng() * 0.03), y1: clamp01(y + (rng() - 0.5) * 0.015), w: WEIGHT.fine });
  }
  return { strokes, cross };
}

function hatchCobble(rng) {
  const strokes = [];
  const cols = 5; const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() < 0.12) continue; // a few skipped stones
      const cx = (c + 0.5) / cols + (rng() - 0.5) * 0.08;
      const cy = (r + 0.5) / rows + (rng() - 0.5) * 0.08;
      const rad = 0.09 + rng() * 0.02;
      const start = Math.PI * (0.15 + rng() * 0.1); // the lee side: a short arc, not a full ring
      const span = Math.PI * 0.5;
      const SEGS = 4;
      for (let s = 0; s < SEGS; s++) {
        const a0 = start + (span * s) / SEGS;
        const a1 = start + (span * (s + 1)) / SEGS;
        strokes.push({
          x0: clamp01(cx + rad * Math.cos(a0)), y0: clamp01(cy + rad * Math.sin(a0)),
          x1: clamp01(cx + rad * Math.cos(a1)), y1: clamp01(cy + rad * Math.sin(a1)), w: WEIGHT.fine,
        });
      }
    }
  }
  return { strokes, cross: [] };
}

function hatchBrick(rng) {
  const strokes = [];
  const courses = 6;
  for (let i = 1; i < courses; i++) {
    const y = i / courses;
    strokes.push({ x0: 0.02, y0: clamp01(y), x1: 0.98, y1: clamp01(y + (rng() - 0.5) * 0.008), w: WEIGHT.mid });
  }
  const cross = [];
  const joints = 8;
  for (let r = 0; r < courses; r++) {
    const offset = (r % 2) * (1 / (joints * 2));
    for (let j = 0; j < joints; j++) {
      const x = offset + (j + 0.5) / joints;
      if (x > 0.99) continue;
      cross.push({ x0: clamp01(x), y0: clamp01(r / courses + 0.01), x1: clamp01(x), y1: clamp01(r / courses - 0.01 + 1 / courses), w: WEIGHT.fine });
    }
  }
  return { strokes, cross };
}

function hatchCanvas(rng) {
  // two fine sets crossing at a shallow angle (sailcloth), edge to edge, inside the unit tile
  const mk = (sign) => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const jitter = (rng() - 0.5) * 0.01;
      out.push({ x0: 0, y0: clamp01(t + jitter), x1: 1, y1: clamp01(t + 0.14 * sign + jitter), w: WEIGHT.fine });
    }
    return out;
  };
  return { strokes: mk(1), cross: mk(-1) };
}

function hatchTarredRope(rng) {
  const strokes = [];
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const len = 0.12 + rng() * 0.02;
    strokes.push({ x0: clamp01(t), y0: 0, x1: clamp01(t + len), y1: 1, w: WEIGHT.mid });
  }
  return { strokes, cross: [] };
}

function hatchBrass(rng) {
  const strokes = [];
  const bareBandAt = 0.5 + (rng() - 0.5) * 0.15; // the clean bare band for the highlight
  const bandW = 0.14;
  for (let i = 0; i < 22; i++) {
    const x = i / 21;
    if (Math.abs(x - bareBandAt) < bandW / 2) continue;
    strokes.push({ x0: clamp01(x), y0: 0.02, x1: clamp01(x + (rng() - 0.5) * 0.01), y1: 0.98, w: WEIGHT.fine });
  }
  return { strokes, cross: [] };
}

function hatchBone(rng) {
  const strokes = [];
  grainStrokes(rng, strokes, 4, WEIGHT.fine, 0.015); // sparse, long: most paper left
  return { strokes, cross: [] };
}

function hatchSteelPlate(rng) {
  // "no hatching, only the seam of each plate and a row of rivet dots" - seams, then dot-strokes.
  const strokes = [];
  strokes.push({ x0: 0.02, y0: 0.5, x1: 0.98, y1: 0.5 + (rng() - 0.5) * 0.01, w: WEIGHT.bold }); // the plate seam
  for (let i = 0; i < 9; i++) {
    const x = 0.06 + (i / 8) * 0.88;
    const y = 0.5 + 0.09 * (rng() < 0.5 ? -1 : 1);
    strokes.push({ x0: x, y0: y, x1: x + 0.001, y1: y + 0.001, w: WEIGHT.mid }); // a rivet, drawn as a dot (zero-length stroke)
  }
  return { strokes, cross: [] };
}

function hatchNewsprint(rng) {
  const strokes = [];
  for (let i = 0; i < 9; i++) {
    const y = 0.06 + (i / 8) * 0.88;
    const bar = rng() < 0.4; // a grey bar of type where no real line is approved, never readable text
    strokes.push({ x0: 0.04, y0: y, x1: 0.96, y1: y, w: bar ? WEIGHT.bold : WEIGHT.fine });
  }
  return { strokes, cross: [] };
}

const HATCH_BUILDERS = Object.freeze({
  timber: (rng) => hatchTimberOrPlank(rng, 1 / 3),
  plank: (rng) => hatchTimberOrPlank(rng, 1 / 4),
  cobble: hatchCobble,
  brick: hatchBrick,
  canvas: hatchCanvas,
  tarredRope: hatchTarredRope,
  brass: hatchBrass,
  bone: hatchBone,
  steelPlate: hatchSteelPlate,
  newsprint: hatchNewsprint,
  water: () => ({ strokes: [], cross: [] }),
});

/**
 * { strokes: [{x0,y0,x1,y1,w}], cross: [...] } in a unit tile (0..1), seeded through logic/rng.js.
 * `water` returns no strokes. The same seed always cuts the same plate.
 */
export function hatchPlan(kind, seed = 1) {
  const build = HATCH_BUILDERS[kind];
  if (!build) return { strokes: [], cross: [] };
  const rng = makeRng(seed >>> 0);
  return build(rng);
}

// ---- flash (R11, Security A1/A2/A3) --------------------------------------------------------

/**
 * Strengths in the unit the shipped scare light uses (times pi in the light's intensity).
 * scare.reduced (2.0) is the dock's own shipped reduced peak (dock.js, pre-rebuild), a real,
 * already-live number - not derived from this table.
 *
 * breach.reduced: Security A3 (owner decided, option a) - the self-referential "a quarter of
 * full" (6.0 / 4 = 1.5) is removed. Pinned instead to a real, already-shipped number: the
 * crater's own way-light (game/engine/passages.js:757, `createCrater`'s `light.intensity`),
 * its ambient ember-glow term (the `9` coefficient of `(fol ? 6 : 9) * glow * ...`, the
 * no-follow case - the crater's *sustained* glow, not its one-off 900-candela strike flash,
 * which is a different scale of light and would make breach's "reduced" brighter than its own
 * full peak). Converted to this table's unit (intensity / pi): 9 / Math.PI =~ 2.8648.
 */
export const FLASH = Object.freeze({
  scare: Object.freeze({ full: 4.0, reduced: 2.0, rise: 0.15, fall: 0.4, duration: 1.6 }),
  breach: Object.freeze({ full: 6.0, reduced: 9 / Math.PI, rise: 0.12, fall: 0.6, duration: 0.72 }),
});

/**
 * The light's strength at `t` seconds into its own envelope (0 at the start), for `kind` 'scare'
 * or 'breach'. One rise then one fall (scare holds near peak between them over its 1.6 s dwell;
 * breach does not hold - "one pulse"); 0 before 0 and after the envelope's duration.
 */
export function glowAt(kind, t, reduced = false) {
  const f = FLASH[kind];
  if (!f || !Number.isFinite(t) || t < 0 || t > f.duration) return 0;
  const peak = reduced ? f.reduced : f.full;
  const ramp = Math.min(1, t / f.rise, (f.duration - t) / f.fall);
  return peak * Math.max(0, ramp);
}

// ---- motion (R12, B11): the targets the re-run critique measures against --------------------

/** UI direction > "Speeds and dwell". `exact: true` rows are fixed by logic and must match to the frame; the rest pass within 15%. */
export const MOTION = Object.freeze({
  scareDwell: Object.freeze({ label: 'Scare on the surface', target: 1.6, unit: 's', exact: true }),
  scareRise: Object.freeze({ label: 'Scare rise', target: 1.3, unit: 'm/0.3s', tolerancePct: 15 }),
  scareRoll: Object.freeze({ label: 'Scare roll', target: 20, unit: 'deg/1.0s', tolerancePct: 15 }),
  scareSlide: Object.freeze({ label: 'Scare forward slide', target: 1.2, unit: 'm', tolerancePct: 15 }),
  wakeRing: Object.freeze({ label: 'Wake ring', target: 4, unit: 'm/s, gone at 2.5s', tolerancePct: 15 }),
  ironFlight: Object.freeze({ label: 'Iron in flight', target: 30, unit: 'm/s', exact: true }),
  ironHaul: Object.freeze({ label: 'Iron hauled home', target: 1.2, unit: 's', exact: true }),
  barrelBob: Object.freeze({ label: 'Barrel bob and drift', target: 0.08, unit: 'm/2.4s', exact: true }),
  nedWindup: Object.freeze({ label: "Ned's wind-up", target: 0.4, unit: 's', tolerancePct: 15 }),
  breachTiming: Object.freeze({ label: 'Breach', target: 5.75, unit: 's total', exact: true }),
  castOff: Object.freeze({ label: 'Cast-off', target: 9, unit: 's', exact: true }),
  tavernHeadTurn: Object.freeze({ label: 'Heads turning in the tavern', target: 120, unit: 'deg/s max', tolerancePct: 15 }),
  fogSheets: Object.freeze({ label: 'Fog sheets', target: 0.225, unit: 'm/s (0.15-0.3)', tolerancePct: 33 }),
});

/** A measured value passes if it is within the row's tolerance of target (15% default), or matches exactly when `exact`. */
export function withinMotionTarget(row, measured) {
  if (!row || !Number.isFinite(measured)) return false;
  if (row.exact) return measured === row.target;
  const pct = row.tolerancePct || 15;
  return Math.abs(measured - row.target) <= row.target * (pct / 100);
}

// ---- sound bed (R8): the gain table dockcues.js's bed reads ----------------------------------

const OUTDOOR_ZONES = Object.freeze(['quay', 'pier', 'underPier', 'deck']);

/**
 * Per-layer gain (0..1) for `zone` ('quay'|'pier'|'underPier'|'deck'|'tavern') and `hush` (0 full
 * murmur, 1 hushed). The murmur is scaled by one minus hush; the fire, clock and sign are always
 * on in the tavern (it is never silent) and are not scaled by hush at all.
 */
export function bedGains(zone, hush = 0) {
  const h = clamp01(Number.isFinite(hush) ? hush : 0);
  const outdoor = OUTDOOR_ZONES.includes(zone);
  return Object.freeze({
    water: zone === 'underPier' ? 0.8 : outdoor ? 0.5 : 0,
    rigging: zone === 'quay' || zone === 'deck' ? 0.35 : 0,
    gulls: outdoor && zone !== 'underPier' ? 0.3 : 0,
    bellBuoy: outdoor ? 0.15 : 0,
    murmur: zone === 'tavern' ? 0.6 * (1 - h) : 0,
    fireClockSign: zone === 'tavern' ? 0.4 : 0,
  });
}
