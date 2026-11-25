// The Rose Court and the wood's look, as plain numbers the engine draws from (the art critic's
// C1, C5, C6, C7, C9). Pure: no three, no randomness. court.js, forest.js and props.js read it.
// C1 (the owner, Q7: keep the lawn's #58B04C): the one wrong thing seen from the spawn is the
// sun. It is drawn low in the northern sky, ahead of the warden as he climbs out of the
// crater, and every shadow in the court runs toward it: the light really comes from behind him.
// C7: the wood's greens grey with depth like its light, so the far wood is not the court under a
// cloud. C6: the path is a tenth darker than the old sand and is never brighter than the sky.

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return Object.freeze([v[0] / l, v[1] / l, v[2] / l]); };

// ---- the sun ---------------------------------------------------------------------------------

/** Where the court's light truly comes from (toward the light): from the south, 35 degrees up, so the shadows run long. */
export const SUN_LIGHT = unit([-8, 30, 42]);
const SEEN_UP = 17 / (180 / Math.PI); // the disc's elevation: well inside the frame at eye height
/** Where the sun is drawn: low in the north, a little east, exactly where every shadow points. */
export const SUN_SEEN = unit([
  -SUN_LIGHT[0] * Math.cos(SEEN_UP) / Math.hypot(SUN_LIGHT[0], SUN_LIGHT[2]),
  Math.sin(SEEN_UP),
  -SUN_LIGHT[2] * Math.cos(SEEN_UP) / Math.hypot(SUN_LIGHT[0], SUN_LIGHT[2]),
]);
/** Compass heading of a direction on the ground: 0 is north (-z), positive turns east (+x). */
export const groundHeading = (v) => Math.atan2(v[0], -v[2]);
/** Angle of a direction above the horizon. */
export const elevationOf = (v) => Math.atan2(v[1], Math.hypot(v[0], v[2]));

// ---- the greying with depth --------------------------------------------------------------------

// The wood's grid (logic/courtmap.js MAZE): its first row and its depth. Kept as numbers here so
// the engine and the tests share one curve; courtlook.test.js checks them against MAZE.
const WOOD = { z0: -24, length: 160 };
/** How far into the wood z is, 0 at its first row to 1 at the last. */
export const depthOf = (z) => clamp((WOOD.z0 - z) / WOOD.length);
/** The greying curve: fast to grey by the second gate, then creeping (the third block-out's). */
export function greyAt(z) {
  const t = depthOf(z);
  const a = Math.min(1, t / 0.45);
  return 0.78 * a * a * (3 - 2 * a) + 0.22 * Math.max(0, (t - 0.45) / 0.55);
}

// ---- colour, in OKLab ------------------------------------------------------------------------

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function lab(hex) {
  const r = toLin(((hex >> 16) & 255) / 255); const g = toLin(((hex >> 8) & 255) / 255); const b = toLin((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function hexOf([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.reduce((h, c) => (h << 8) | Math.round(255 * clamp(toSrgb(clamp(c)))), 0);
}
/** [L, C, hue in degrees] of a hex colour (OKLCH). */
export function oklch(hex) {
  const [L, A, B] = lab(hex);
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
const mixLab = (a, b, k) => { const p = lab(a); const q = lab(b); return hexOf(p.map((v, i) => v + (q[i] - v) * k)); };

/**
 * A leaf green at greying d (greyAt): its chroma drained toward a grey-olive and a little darker,
 * reaching about a sixth of its court chroma by the start of band 4. d 0 gives the colour back.
 */
export function woodGreen(hex, d) {
  if (d <= 0) return hex;
  const k = smooth(d / 0.86);
  const [L, A, B] = lab(hex);
  const keep = 1 - 0.86 * k;
  return hexOf([L * (1 - 0.07 * k), A * keep, B * keep + 0.004 * k]);
}

const SAND = 0xcfc3a0; // the court's walk, a tenth down from #E6D9B2
const SAND_FAR = 0x9a8e7a; // the same earth under the overcast
const EVENING = 0x8e8c84; // toward the design's #6A6860, kept lighter than the floor beside it
/** The trodden path's colour at greying d: always the lightest ground in view. */
export function pathTone(d) {
  const near = mixLab(SAND, SAND_FAR, clamp(d));
  return mixLab(near, EVENING, 0.8 * smooth((d - 0.7) / 0.3));
}
/** The floor under the walls and beyond them at greying d. */
export function floorTone(d) {
  return mixLab(0x4f9a46, 0x56544a, clamp(d * 1.15));
}

/** Fallen leaves: dull browns and ochres, never orange. */
export const LEAF_TONES = Object.freeze([0x7a5c3c, 0x8c7048, 0x6a5440, 0x957c52, 0x5c4a36, 0x80684e]);
/** A leaf's colour at greying d: wetter and greyer deeper in. */
export const leafTone = (hex, d) => mixLab(hex, 0x5e5a50, 0.55 * clamp(d));

// ---- the Bat's lanterns (C5) -----------------------------------------------------------------

/** Each lantern's point light: hung, and fallen with its oil burning; inverse-square to 6 m. */
export const LANTERN_LIGHT = Object.freeze({ hung: 4, down: 5, distance: 6, decay: 2, lift: 0.55 });
/** The additive glow the fallen lantern lays on the ground, at radius r (0 centre, 1 the edge). */
export const poolAt = (r) => 0.045 * (1 - smooth(r)) ** 2;

// ---- the sky (C9) ----------------------------------------------------------------------------

/** Ordered dither on the sky's output, in display levels: about one step in 255. */
export const SKY_DITHER = 1 / 255;
