// The road's light as a pure function of its dark (issue #29): the owner-approved colour script
// (art direction pass 3, scratchpad colour-script.json, approved 2026-11-16 22:49 PST with the
// owner's change for the castle). Eight keyframes, foot to courtyard entrance, at dark 0, 0.11
// (leg 1), 0.34 (leg 2, the boulder), 0.55 (leg 3), 0.76 (leg 4, sunset at the cave and the bats),
// 0.92 (leg 5, civil twilight), 0.97 (the top stretch, blue hour) and 1 (the courtyard entrance).
// The two ends are kept exact: the foot's light (A1, "leave as is") and the castle's own light at
// the courtyard entrance (castle.js: its outside zone).
//
// Colours move in OKLab, eased inside each segment, so nothing passes through grey on its way from
// brass to blue (the "light to dark" look the owner called lazy). The sun sits SSW, low behind the
// climbing warden, sinking through the keyframes and setting at leg 4; its key warms from brass to
// red-orange and dims while the sky's fill turns blue, then the moon takes the key. The ground's
// light (groundLight) rises in a straight line from the foot's to the courtyard's while the sky and
// the colour carry the dark. The castle keeps most of its colour at the foot and on leg 1, goes to
// a very dark (never black) silhouette as the light fades, and turns to lit stone on the top stretch.
//
// Every value is kept state: it is read from road.dark (road.js), the one-way ratchet on the
// highest point reached, never from where the warden stands, so walking back down changes nothing.
// Numbers and hex colours only: engine/roadview.js turns them into lights and the sky.

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };

/** The keyframes' dark values (colour-script.json stationsNote). */
export const KEYS = Object.freeze([0, 0.11, 0.34, 0.55, 0.76, 0.92, 0.97, 1]);

/** A value along stops [[dark, value], ...]: eased (smoothstep) or straight between stops. */
export function along(stops, d, ease = true) {
  if (d <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [d1, v1] = stops[i];
    if (d <= d1) {
      const [d0, v0] = stops[i - 1];
      const t = (d - d0) / (d1 - d0);
      return v0 + (v1 - v0) * (ease ? smooth(t) : t);
    }
  }
  return stops[stops.length - 1][1];
}
const atKeys = (values) => values.map((v, i) => [KEYS[i], v]);

// ---- OKLab (Björn Ottosson) -------------------------------------------------------------------

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** 0xrrggbb -> OKLab [L, a, b]. */
export function hexToOklab(hex) {
  const r = toLin(((hex >> 16) & 255) / 255); const g = toLin(((hex >> 8) & 255) / 255); const b = toLin((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab [L, a, b] -> sRGB [r, g, b] (0 to 1, clamped). */
export function oklabToRgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b].map((c) => clamp(toSrgb(clamp(c))));
}

/** OKLCH chroma of an sRGB [r, g, b] (0 to 1). */
export function chromaOf(rgb) {
  const hex = (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255);
  const [, a, b] = hexToOklab(hex);
  return Math.hypot(a, b);
}

/** A colour along hex stops, interpolated in OKLab, eased in each segment: sRGB [r, g, b] 0 to 1. */
const LABS = new WeakMap(); // each stop list's OKLab channels, converted once
function colourAlong(stops, d) {
  let labs = LABS.get(stops);
  if (!labs) {
    const ok = stops.map(([k, h]) => [k, hexToOklab(h)]);
    labs = [0, 1, 2].map((i) => ok.map(([k, v]) => [k, v[i]]));
    LABS.set(stops, labs);
  }
  return oklabToRgb([along(labs[0], d), along(labs[1], d), along(labs[2], d)]);
}

// ---- the script -------------------------------------------------------------------------------

/**
 * The castle's light at its courtyard entrance (castle.js: the outside zone's ambient, the fill and
 * fog it sets for an outside zone, STONE.night, STONE.moon, the exposure it shows with). The top
 * of the road ends on exactly these (tests/roadlight.test.js reads them out of castle.js).
 */
export const COURTYARD = Object.freeze({
  fill: 1.1, fillHex: 0xc9d3e0, hemi: 2.2, hemiHex: 0x6f86b4, groundHex: 0x45536f,
  exposure: 1.15, fog: 0.0055, fogHex: 0x0e1420, peaksHex: 0x080b12,
});

/** The foot's light (pass 2, the owner on A1: "leave as is"). */
export const FOOT = Object.freeze({
  fill: 1.7, fillHex: 0xc9a25c, hemi: 1.0, hemiHex: 0xb0a283, groundHex: 0x3b3a26,
  exposure: 0.98, fog: 0.0125, fogHex: 0x8f8268,
});

/** The keyframes (colour-script.json keyframes[], DEFAULTS TAKEN where the script left a gap). */
export const ROAD_LIGHT = Object.freeze({
  // the key: the sun (SSW, behind the climb) warming and failing, then the afterglow and the moon
  fillHex: atKeys([FOOT.fillHex, 0xd0a055, 0xd49a4e, 0xd48a45, 0xc8703c, 0x9a8496, 0x9faec8, COURTYARD.fillHex]),
  fill: atKeys([FOOT.fill, 1.75, 1.75, 1.7, 1.5, 0.95, 1.0, COURTYARD.fill]),
  // the sky's fill turning blue while the key warms: shadows take the sky's hue
  hemiHex: atKeys([FOOT.hemiHex, 0xa8a590, 0x9c9e9e, 0x8d95ae, 0x8088b4, 0x6e7bb0, 0x6a80b2, COURTYARD.hemiHex]),
  groundHex: atKeys([FOOT.groundHex, 0x3d3a28, 0x403a2c, 0x433a30, 0x463b37, 0x3f4258, 0x43506a, COURTYARD.groundHex]),
  hemi: atKeys([FOOT.hemi, 1.15, 1.3, 1.45, 1.6, 1.8, 2.0, COURTYARD.hemi]),
  exposure: atKeys([FOOT.exposure, 1.0, 1.02, 1.05, 1.07, 1.1, 1.13, COURTYARD.exposure]),
  // the haze: thick and warm at the foot, mauve at sunset, clear night air at the top
  fogHex: atKeys([FOOT.fogHex, 0x8a8070, 0x827a78, 0x76707e, 0x686480, 0x48506e, 0x1e2840, COURTYARD.fogHex]),
  fog: atKeys([FOOT.fog, 0.0118, 0.011, 0.0102, 0.0094, 0.0085, 0.0068, COURTYARD.fog]),
  // the sky: zenith, the horizon ahead (anti-solar, over the castle), the horizon behind (the sun's side)
  skyZenithHex: atKeys([0xa3abb7, 0x9aa6b8, 0x8e9db6, 0x7f8fb0, 0x6c7ba6, 0x4f5e94, 0x2e3a6a, 0x1a2334]),
  skyAheadHex: atKeys([0xdcc8a8, 0xd6c2a8, 0xcdb3aa, 0xc29da4, 0xb88a9c, 0x56608a, 0x323d60, 0x283449]),
  skyBehindHex: atKeys([0xffe5b9, 0xf6d29a, 0xf0b878, 0xe89a5c, 0xd9733f, 0x8e5a6e, 0x4a4566, 0x283449]),
  // the Belt of Venus (dusty mauve, never candy) over the Earth's shadow, both on the anti-solar side
  beltHex: atKeys([0xdcc8a8, 0xd4bdb0, 0xcba9a6, 0xc29da4, 0xb88a9c, 0x8c7790, 0x323d60, 0x283449]),
  beltK: [[0, 0], [0.11, 0], [0.76, 1], [0.97, 0], [1, 0]],
  earthShadowHex: atKeys([0x9aa0aa, 0x949aa6, 0x8a90a4, 0x7e85a0, 0x5f6888, 0x414c72, 0x323d60, 0x283449]),
  shadowTopDeg: [[0, 0], [0.45, 0], [0.92, 8], [0.97, 22], [1, 22]],
  // the far peaks: 15 to 25 values under the sky behind them, in its hue; the castle's own black past the gate
  peaksHex: atKeys([0xb7a997, 0xb7a997, 0xb39a92, 0x636b8e, 0x484f67, 0x2e3343, 0x21242f, COURTYARD.peaksHex]),
  // the sun's height (degrees): straight lines; set at leg 4, gone under by leg 5
  sunElevDeg: atKeys([11, 8, 5, 2.5, 0.5, -3, -6, -6]),
  // the castle: most of its colour at the foot and on leg 1, a very dark (never black) silhouette
  // as the light fades, lit stone over the top stretch (the owner's change to the script)
  castleShade: [[0, 1], [0.11, 0.85], [0.34, 0.5], [0.55, 0.3], [0.76, 0.24], [0.92, 0.3], [0.966, 0.3], [1, 1]],
  key: [[0, 0], [0.966, 0], [1, 1]], // of the castle's moon key on its front
  stars: [[0, 0], [0.8, 0], [1, 1]],
  halo: [[0, 0], [0.8, 0], [1, 1]],
  moon: [[0, 0.1], [0.55, 0.25], [0.8, 0.5], [1, 1]],
  // the windows come on a few at a time as the sun goes (four sets, each at its own dark)
  windows: Object.freeze([0.76, 0.81, 0.86, 0.91]),
  // the key light's direction swings from the sun to the moon
  moonSwing: [0.85, 0.97],
});

/** The evening left at a road dark of d: 1 below the top stretch, falling to 0 (the courtyard's night) across it. */
export function duskOf(d) {
  return clamp((1 - clamp(d)) / (1 - KEYS[6]));
}

const lumRgb = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const rgbOf = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** How flat ground takes the key: the sine of its height (the sun's raised KEY_RAISE, swinging to the moon's). */
function keyUp(sunElevDeg, moonK) {
  const sunUp = Math.sin(((sunElevDeg + KEY_RAISE) * Math.PI) / 180);
  return Math.max(0, sunUp + (MOON_UP - sunUp) * moonK);
}
/** castle.js moonFill (-0.5, 0.6, 0.8), normalised: its height. */
const MOON_UP = 0.6 / Math.hypot(0.5, 0.6, 0.8);
const groundOf = (exposure, fill, fillHex, hemi, hemiHex, groundHex, up) =>
  exposure * (fill * lumRgb(rgbOf(fillHex)) * up + 0.6 * hemi * (0.6 * lumRgb(rgbOf(hemiHex)) + 0.4 * lumRgb(rgbOf(groundHex))));
const FOOT_G = groundOf(FOOT.exposure, FOOT.fill, FOOT.fillHex, FOOT.hemi, FOOT.hemiHex, FOOT.groundHex, Math.sin(((11 + 6) * Math.PI) / 180));
const COURT_G = groundOf(COURTYARD.exposure, COURTYARD.fill, COURTYARD.fillHex, COURTYARD.hemi, COURTYARD.hemiHex, COURTYARD.groundHex, MOON_UP);

/** How far the key light stands above the sun (degrees), so a sun on the horizon still rakes the road. */
export const KEY_RAISE = 6;

/**
 * The road's light at dark d (0 the foot to 1 the courtyard entrance). Colours are sRGB [r, g, b]
 * from 0 to 1. The ground's value is carried by the hemisphere (its intensity rising through the
 * keyframes) more than by the low key, which only rakes; the stills are measured against the
 * script's road values (26 rising evenly to 66).
 */
let lastK = NaN; let lastLight = null; // the dark is a ratchet: most frames ask for the same one again

export function roadLight(d) {
  const L = ROAD_LIGHT;
  const k = clamp(d);
  if (k === lastK) return lastLight;
  const fillRGB = colourAlong(L.fillHex, k);
  const hemiRGB = colourAlong(L.hemiHex, k);
  const groundRGB = colourAlong(L.groundHex, k);
  const exposure = along(L.exposure, k, false);
  const fill = along(L.fill, k);
  const sunElevDeg = along(L.sunElevDeg, k, false);
  const moonK = smooth((k - L.moonSwing[0]) / (L.moonSwing[1] - L.moonSwing[0]));
  const hemi = along(L.hemi, k);
  // The script's road values rise in a straight line (26 -> 66) while its lights, set for the sky,
  // the trees and the castle, would leave the ground flat until the moon comes (the low key only
  // rakes). So the land alone gets a lift, in the sky fill's hue, solved so the ground's light is
  // that straight line: the silhouettes keep their dark. 0 at both ends.
  const want = FOOT_G + (COURT_G - FOOT_G) * k;
  const lit = exposure * (fill * lumRgb(fillRGB) * keyUp(sunElevDeg, moonK) + 0.6 * hemi * (0.6 * lumRgb(hemiRGB) + 0.4 * lumRgb(groundRGB)));
  const groundLift = Math.max(0, want - lit) / (exposure * Math.max(0.05, lumRgb(hemiRGB)));
  lastLight = Object.freeze({
    dusk: duskOf(k),
    fill, fillRGB, groundLift,
    hemi, hemiRGB, groundRGB, exposure,
    fog: along(L.fog, k), fogRGB: colourAlong(L.fogHex, k),
    skyZenithRGB: colourAlong(L.skyZenithHex, k), skyAheadRGB: colourAlong(L.skyAheadHex, k), skyBehindRGB: colourAlong(L.skyBehindHex, k),
    beltRGB: colourAlong(L.beltHex, k), beltK: along(L.beltK, k), earthShadowRGB: colourAlong(L.earthShadowHex, k), shadowTopDeg: along(L.shadowTopDeg, k),
    peaksRGB: colourAlong(L.peaksHex, k),
    sunElevDeg,
    disc: smooth((sunElevDeg + 1) / 2), // gone once the sun is a degree under (no ghost disc)
    moonK,
    castleShade: along(L.castleShade, k), key: along(L.key, k), stars: along(L.stars, k), halo: along(L.halo, k), moon: along(L.moon, k),
    windows: L.windows.map((w) => (k >= w ? 1 : 0)),
  });
  lastK = k;
  return lastLight;
}

/** Relative luminance of an sRGB [r, g, b] (weights on the stored values: a comparison only). */
export function lum(c) {
  return lumRgb(c);
}

/**
 * How brightly the road's flat ground is lit at dark d: a comparison figure only. The key falls on
 * level ground by the sine of its height (the sun's, raised KEY_RAISE; the moon's as it swings in).
 */
export function groundLight(d) {
  const l = roadLight(d);
  return l.exposure * (l.fill * lum(l.fillRGB) * keyUp(l.sunElevDeg, l.moonK) + 0.6 * l.hemi * (0.6 * lum(l.hemiRGB) + 0.4 * lum(l.groundRGB)) + l.groundLift * lum(l.hemiRGB));
}
