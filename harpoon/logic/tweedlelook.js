// The Tweedles' colours (the owner, 2026-11-19: "add some brighter colors to Tweedledee and tweedle
// dumb so they stand out a little more. They're hard to see in the forest, especially on the
// phone"). Pure numbers engine/tweedles.js paints them with, and the wood's own colours they must
// stand out from, so the tests can measure it. No three, no randomness.
//
// Tenniel's two wear the same round-collared school-boy suit; here each brother's suit is its own
// bright colour and his cap (and its knob) takes his brother's, so each reads as one shape at a
// glance and the two read as a pair: Dee in saffron, Dum in azure (the comparison sheet in the
// CHANGELOG: saffron/cobalt, lemon/magenta and saffron/azure were tried on the walk's stills; the
// cobalt went as dark as the trunks under the canopy, the magenta read as blood next to the dried
// pools, the saffron and azure kept their colour to 20 m on both tiers; the saffron then a little
// toward orange, away from the pale path and the olive leaves). The collars stay white,
// the buttons brass. The dried blood and the claw rents are not here: tweedles.js keeps them as
// they were (the owner: "the red drying ... checks out nicely").
//
// Colour handling: every hex here is sRGB, as written. three (ColorManagement on) turns a hex into
// linear when sculpt.js tints the vertices, the renderer lights them in linear and writes sRGB out,
// so a hex here shows about as written in a lit, unfogged frame. The walk's TEXTURES are the other
// case (tunnelwood.js SAMPLE_SPACE: NoColorSpace, the sample's look): their texels are taken as
// linear values, so the bark's '#4a3a2b' shows as a much lighter brown than the hex; WOOD below
// measures the trunks that way.

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear rgb [0..1] of an sRGB hex. */
export const linOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => toLin(v / 255));
/** The sRGB hex of a linear rgb. */
export const hexOfLin = (rgb) => rgb.reduce((h, c) => (h << 8) | Math.round(255 * clamp(toSrgb(clamp(c)))), 0);
/** OKLab [L, a, b] of a linear rgb. */
export function labOf([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** [L, chroma, hue in degrees] (OKLCH) of a linear rgb. */
export function lchOf(rgb) { const [L, A, B] = labOf(rgb); return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]; }
/** The OKLab distance of two linear rgbs (about 0.02 is just noticeable; 0.2 is a different colour). */
export function deltaE(p, q) { const a = labOf(p); const b = labOf(q); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
/** Relative luminance (linear). */
export const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The luminance contrast (WCAG's (L1 + 0.05) / (L2 + 0.05), 1 to 21). */
export function contrastOf(p, q) { const a = lumOf(p); const b = lumOf(q); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
const mixLin = (p, q, k) => p.map((v, i) => v + (q[i] - v) * k);

// ---- the wood they lie in (the engine's numbers, measured as the walk draws them) ---------------

// tunnelwood.js: the floor (staticMesh's woodFloor, woodPath, verge, dirt), the walk's grey
// (WOOD_GREY), the dead leaf (DEAD_LEAF), the bark texture's base ('#4a3a2b', sampled raw: see
// above) and its dead silver-grey (DEAD_BARK) over it, the oak leaf's colour (its setHSL, greyed as
// grey() greys it). tweedlelook.test.js checks these against tunnelwood.js's source.
const HSL = (h, s, l) => {
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map(toLin);
};
const WOOD_GREY = linOf(0x6a6658);
/** tunnelwood.js grey(): the sample's band-2 greying, in linear. */
const grey = (c) => { const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return mixLin(c.map((v) => (l + (v - l) * 0.5) * 0.86), WOOD_GREY, 0.12); };
const BARK_RAW = [0x4a / 255, 0x3a / 255, 0x2b / 255];
export const WOOD = Object.freeze({
  floor: linOf(0x5a5a46), path: linOf(0xa39680), verge: linOf(0x403d31), dirt: linOf(0x625646),
  grey: WOOD_GREY, deadLeaf: linOf(0x6b5a40),
  bark: BARK_RAW.map((v, i) => v * grey(HSL(0.08, 0.24, 0.63))[i]), // a living oak's trunk
  deadBark: BARK_RAW.map((v, i) => v * linOf(0xb3aa9c)[i]), // the dead trees round them
  leaf: grey(HSL(0.225, 0.5, 0.52)), // the oak's canopy
});
// The walk's haze at the Tweedles: the approved sample's fog (0xc8d0d8, FogExp2 0.017), which the
// first third leans to; at `d` metres a colour is mixed toward it by 1 - exp(-(0.017 d)^2).
export const HAZE = Object.freeze({ color: linOf(0xc8d0d8), density: 0.017 });
/** A linear colour as the haze leaves it at d metres. */
export const hazed = (rgb, d) => mixLin(rgb, HAZE.color, 1 - Math.exp(-((HAZE.density * d) ** 2)));

// ---- the brothers -----------------------------------------------------------------------------

const SAFFRON = 0xff9f0a;
const AZURE = 0x2b8fe8;
/**
 * Each brother's suit (sRGB hex, before soiling): jacket, the torn-back underside, cap and knob (his
 * brother's colour), the buttons, the breeches, the stockings. Shared: the collar, the letters.
 */
export const TWEEDLE_LOOK = Object.freeze({
  dee: Object.freeze({ jacket: SAFFRON, torn: 0xf7d488, cap: AZURE, knob: 0xe8e2d0, buttons: 0xe6c25a, breeches: 0x2f6fb8, stocking: 0xf0ead8 }),
  dum: Object.freeze({ jacket: AZURE, torn: 0x9cccf5, cap: SAFFRON, knob: 0xe8e2d0, buttons: 0xe6c25a, breeches: 0xc98a1a, stocking: 0xf0ead8 }),
  collar: 0xf7f3ea,
  letter: 0x1c2a52, // the worked letters: a dark navy on the white collar (was a brick red, too near the blood)
  soil: 0.12, // how far the cloth is dirtied toward the floor's earth (mixed in linear), lying dead on it
});

/** The cloth as it lies: the hex soiled toward the floor's earth by TWEEDLE_LOOK.soil, as a linear rgb. */
export const soiledLin = (hex, k = TWEEDLE_LOOK.soil) => mixLin(linOf(hex), WOOD.dirt, k);
/** ...and as the sRGB hex tweedles.js paints. */
export const soiled = (hex, k = TWEEDLE_LOOK.soil) => hexOfLin(soiledLin(hex, k));
