// The night seen through a passage's moon slit (fix/wives-window, the owner, 2026-11-18: "the window
// across from the wives portrait is too bright. it can show the moon in a starry sky so light comes
// in, but not a panel of white"). A pure, seeded RGBA raster the castle's view uploads once as the
// slit's texture: a deep blue-black sky graded a little lighter toward its foot, a few dozen stars
// of varied size and brightness, a moon as a soft disc with a faint halo, and the slit's iron bars in
// silhouette across it. No pixel is brighter than the moon's core (SKY.cap, 0xe8eef8 at most), so
// nothing in the window clips to white whatever the renderer's exposure (the view draws it untoned).

import { makeRng } from './rng.js';

/** The sky's numbers. Shares (u across, v down from the top) are of the raster's width and height. */
export const SKY = Object.freeze({
  w: 128, h: 384, // the slit's plane is 0.6 m by 1.8 m: 1 by 3
  seed: 1873,
  cap: Object.freeze([0xe8, 0xee, 0xf8]), // the brightest any channel may be: the moon's core, a cold white
  top: Object.freeze([4, 7, 14]), // the sky at the slit's head
  foot: Object.freeze([12, 19, 34]), // and at its sill: a shade lighter toward the horizon
  stars: 44, // a few dozen
  starSize: Object.freeze([0.55, 1.7]), // radius in pixels, smallest to largest
  starPeak: Object.freeze([0.38, 0.86]), // a star's brightest pixel as a share of the cap
  moon: Object.freeze({ u: 0.68, v: 0.27, r: 17, rim: [0xc2, 0xca, 0xd8], halo: 3.4, haloPeak: 0.2 }), // r in pixels; halo: how far out (in radii) the glow fades, haloPeak its strength at the rim (share of the cap)
  bars: Object.freeze({ colour: Object.freeze([6, 8, 12]), upright: 0.5, across: Object.freeze([0.47, 0.74]), width: 3 }), // the iron: one upright and two saddle bars
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The stars' places, sizes and brightness: seeded, none on the moon or its halo's bright part. */
export function starField(o = {}) {
  const s = { ...SKY, ...o };
  const rng = makeRng(s.seed);
  const mx = s.moon.u * s.w; const my = s.moon.v * s.h;
  const out = [];
  let tries = 0;
  while (out.length < s.stars && tries++ < s.stars * 40) {
    const x = rng() * s.w; const y = rng() * s.h;
    const size = rng(); const peak = rng(); const tint = rng();
    if (Math.hypot(x - mx, y - my) < s.moon.r * 2.4) continue; // the moon drowns the stars round it
    // most stars small and faint, a few large and bright
    const k = size * size;
    out.push({ x, y, r: s.starSize[0] + (s.starSize[1] - s.starSize[0]) * k, peak: s.starPeak[0] + (s.starPeak[1] - s.starPeak[0]) * (0.35 * peak + 0.65 * k), warm: tint < 0.2 });
  }
  return out;
}

/**
 * The sky as RGBA bytes, w * h * 4, rows from the top unless bottomUp (a texture's first row is its
 * foot). Every channel is at most SKY.cap's; the brightest pixel is the moon's core.
 */
export function nightSky(o = {}) {
  const s = { ...SKY, ...o };
  const { w, h, cap } = s;
  const rgb = new Float32Array(w * h * 3);
  // the sky: top to foot, a little noise so the grade has no bands
  const rng = makeRng(s.seed ^ 0x5bd1);
  for (let y = 0; y < h; y++) {
    const t = smooth(0, 1, y / (h - 1));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3; const n = (rng() - 0.5) * 1.2;
      for (let c = 0; c < 3; c++) rgb[i + c] = s.top[c] + (s.foot[c] - s.top[c]) * t + n;
    }
  }
  // the stars: each a soft point, its peak a share of the cap, blue-white (a few faintly warm)
  for (const st of starField(s)) {
    const R = Math.ceil(st.r * 2.5);
    const col = st.warm ? [1, 0.93, 0.84] : [0.9, 0.95, 1];
    for (let y = Math.max(0, Math.floor(st.y - R)); y <= Math.min(h - 1, Math.ceil(st.y + R)); y++) {
      for (let x = Math.max(0, Math.floor(st.x - R)); x <= Math.min(w - 1, Math.ceil(st.x + R)); x++) {
        const d = Math.hypot(x + 0.5 - st.x, y + 0.5 - st.y);
        const a = Math.exp(-(d * d) / (2 * st.r * st.r * 0.55)) * st.peak;
        if (a < 0.004) continue;
        const i = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) rgb[i + c] += (cap[c] * col[c] - rgb[i + c]) * clamp01(a);
      }
    }
  }
  // the moon: its halo first (over the sky), then the disc, darker toward its limb, with soft maria
  const M = s.moon; const mx = M.u * w; const my = M.v * h;
  const mRng = makeRng(s.seed ^ 0x9e37);
  const maria = Array.from({ length: 6 }, () => {
    const a = mRng() * Math.PI * 2; const d = mRng() * 0.62;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.16 + mRng() * 0.22, k: 0.06 + mRng() * 0.08 };
  });
  const reach = M.r * M.halo;
  for (let y = Math.max(0, Math.floor(my - reach)); y <= Math.min(h - 1, Math.ceil(my + reach)); y++) {
    for (let x = Math.max(0, Math.floor(mx - reach)); x <= Math.min(w - 1, Math.ceil(mx + reach)); x++) {
      const dx = (x + 0.5 - mx) / M.r; const dy = (y + 0.5 - my) / M.r; const d = Math.hypot(dx, dy);
      const i = (y * w + x) * 3;
      // the halo: a faint cold glow falling from the rim to nothing at `halo` radii
      const g = M.haloPeak * Math.pow(1 - smooth(1, M.halo, d), 2);
      for (let c = 0; c < 3; c++) rgb[i + c] += (cap[c] * [0.62, 0.72, 0.9][c] - rgb[i + c]) * g;
      // the disc, its edge soft over about a pixel and a half
      const edge = 1 - smooth(1 - 1.5 / M.r, 1, d);
      if (edge <= 0) continue;
      const limb = Math.pow(clamp01(1 - d * d), 0.35); // 1 at the core, 0 at the rim
      let shade = 1;
      for (const m of maria) shade -= m.k * (1 - smooth(m.r * 0.4, m.r, Math.hypot(dx - m.x, dy - m.y)));
      for (let c = 0; c < 3; c++) {
        const disc = (M.rim[c] + (cap[c] - M.rim[c]) * limb) * shade;
        rgb[i + c] += (disc - rgb[i + c]) * edge;
      }
    }
  }
  // the iron in silhouette: one upright, two saddle bars
  const B = s.bars; const half = B.width / 2;
  const bar = (i, a) => { for (let c = 0; c < 3; c++) rgb[i + c] += (B.colour[c] - rgb[i + c]) * a; };
  const ux = B.upright * w;
  for (let y = 0; y < h; y++) for (let x = Math.floor(ux - half - 1); x <= Math.ceil(ux + half); x++) {
    if (x < 0 || x >= w) continue;
    bar((y * w + x) * 3, clamp01(half + 0.5 - Math.abs(x + 0.5 - ux)));
  }
  for (const v of B.across) {
    const uy = v * h;
    for (let y = Math.floor(uy - half - 1); y <= Math.ceil(uy + half); y++) {
      if (y < 0 || y >= h) continue;
      for (let x = 0; x < w; x++) bar((y * w + x) * 3, clamp01(half + 0.5 - Math.abs(y + 0.5 - uy)));
    }
  }
  // to bytes, capped
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = s.bottomUp ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3; const j = (row * w + x) * 4;
      for (let c = 0; c < 3; c++) out[j + c] = Math.max(0, Math.min(cap[c], Math.round(rgb[i + c])));
      out[j + 3] = 255;
    }
  }
  return out;
}

/** Rec. 709 luminance of an sRGB byte triple, 0 to 255 (the tests' and the report's measure). */
export const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
