// The walk's trees' level of detail (the owner, 2026-11-19: "the trees in the tunnel should still be
// drawn, even if the user isn't close to them ... represent them with a simpler cone ... and fill
// them in as the user gets closer ... The first one or two trees in depth should be the tunnel trees
// fully rendered, and the ones in the background can be the maze style tree").
//
// Every tree of the walk is drawn from anywhere, at every distance, always the same count: each is
// either FULL (engine/tunnelwood.js's sculpted tree) or FAR (the maze's simple tree, the same place,
// base, size and facing). This file decides which, a frame at a time, pure and allocation-free:
//   - the near band: every tree within `near` metres of the eye (`nearBare` for a bare one: a bare
//     tree costs a fifth of a leafy one, and from the road every tree in view is bare), in any
//     direction, is full; one that is full stays full until it is `hyst` metres farther (so it never
//     flickers on the edge);
//   - the sight line: whatever the band, the `inView` nearest trees inside the view cone (`viewHalf`
//     either side of where the eye looks) are full; one already full stays so while it is among the
//     `inView + 1` nearest inside the wider `keepHalf` cone;
//   - no more than `maxFull` full at once, nearest first;
//   - the swaps: at most `cap` trees are filled in a frame, nearest first, and at most `cap` given
//     back to the far tree, farthest first (a seat under a card passes cap Infinity: all at once).
// Radii, from the triangle counts (tunnelwood.js stats() on the smoke's stills): a full desktop
// tree is ~2.9k triangles leafy and ~1.3k bare, a far one 51 (the cone tree) to ~150 (the bare tree).
// The desktop's 25 m band (35 m bare) holds on average ~22 leafy and ~19 bare trees (~90k), at most
// ~58 leafy in the thick stand round the gate (~190k): never more than the old 64 m streaming
// window's ~65 whole trees, and the 99 far trees cost under 7k together. On the phone a full tree is
// ~1.1k leafy, ~0.7k bare; its 18 m band (28 m bare) holds ~10 leafy and ~7 bare (~16k). 25 m is
// also about as far as the walk's bends let you see along it before the way swings (logic/
// tunnelwalk.js: 20 degrees or more within 24 m), so in the walk a tree is mostly filled in out of
// sight; and from the road every tree in view is bare, so the bare band keeps its first rows whole.

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const DEG = Math.PI / 180;

/** Each tier's numbers (logic/tunnelwalk.js TIERS names). */
export const TREE_LOD = f({
  desktop: { near: 25, nearBare: 35, hyst: 4, inView: 2, viewHalf: 40 * DEG, keepHalf: 55 * DEG, maxFull: 72, cap: 2 },
  phone: { near: 18, nearBare: 28, hyst: 3, inView: 2, viewHalf: 40 * DEG, keepHalf: 55 * DEG, maxFull: 32, cap: 1 },
});

/** The level of detail's state for n trees (made once; planLod reuses it every frame). */
export function lodState(n) {
  return {
    n,
    full: new Uint8Array(n), // 1: the tree is drawn full now
    want: new Uint8Array(n),
    d2: new Float64Array(n),
    order: Int32Array.from({ length: n }, (_, i) => i), // nearest first (kept sorted from frame to frame)
    promote: new Int32Array(n), nPromote: 0, // filled in this frame, nearest first
    demote: new Int32Array(n), nDemote: 0, // given back to the far tree this frame, farthest first
    nFull: 0,
  };
}

/**
 * One frame's plan. trees: [{ x, z }] (the placements); eye: { x, z, fx, fz } (fx, fz: where it
 * looks, flat, need not be unit); lod: a TREE_LOD entry; st: lodState(trees.length); cap: this
 * frame's swaps (default lod.cap). Updates st.full and fills st.promote / st.demote. No allocation.
 */
export function planLod(trees, eye, lod, st, cap = lod.cap) {
  const n = st.n;
  const { d2, order, full, want } = st;
  for (let i = 0; i < n; i++) { const dx = trees[i].x - eye.x; const dz = trees[i].z - eye.z; d2[i] = dx * dx + dz * dz; }
  // insertion sort from last frame's order: nearly sorted already, so about n steps a frame
  for (let a = 1; a < n; a++) {
    const v = order[a]; const dv = d2[v]; let b = a - 1;
    while (b >= 0 && d2[order[b]] > dv) { order[b + 1] = order[b]; b -= 1; }
    order[b + 1] = v;
  }
  const fl = Math.hypot(eye.fx, eye.fz) || 1;
  const fx = eye.fx / fl; const fz = eye.fz / fl;
  const cosView = Math.cos(lod.viewHalf); const cosKeep = Math.cos(lod.keepHalf);
  const nearL = lod.near * lod.near; const holdL = (lod.near + lod.hyst) ** 2;
  const nb = lod.nearBare ?? lod.near;
  const nearB = nb * nb; const holdB = (nb + lod.hyst) ** 2;
  let inView = 0; let inKeep = 0; let count = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const d = Math.sqrt(d2[i]);
    const c = d > 1e-6 ? ((trees[i].x - eye.x) * fx + (trees[i].z - eye.z) * fz) / d : 1;
    const bare = trees[i].bare === true;
    let w = d2[i] < (bare ? nearB : nearL) || (full[i] === 1 && d2[i] < (bare ? holdB : holdL));
    if (c >= cosView) { if (inView < lod.inView) w = true; inView += 1; }
    if (c >= cosKeep) { if (full[i] === 1 && inKeep < lod.inView + 1) w = true; inKeep += 1; }
    if (w && count < lod.maxFull) { want[i] = 1; count += 1; } else want[i] = 0;
  }
  // the swaps: give back the farthest first, then fill in the nearest first, into the free places
  let nFull = 0;
  for (let i = 0; i < n; i++) nFull += full[i];
  let nd = 0; let np = 0;
  for (let k = n - 1; k >= 0 && nd < cap; k--) {
    const i = order[k];
    if (full[i] === 1 && want[i] === 0) { full[i] = 0; st.demote[nd++] = i; nFull -= 1; }
  }
  for (let k = 0; k < n && np < cap && nFull < lod.maxFull; k++) {
    const i = order[k];
    if (full[i] === 0 && want[i] === 1) { full[i] = 1; st.promote[np++] = i; nFull += 1; }
  }
  st.nDemote = nd; st.nPromote = np; st.nFull = nFull;
  return st;
}
