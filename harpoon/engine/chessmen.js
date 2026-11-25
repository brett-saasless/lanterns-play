// The Knight's Walk's eleven chessmen and the six deaths (R9): eight black pieces on the board
// and three white ones watching from the west wall. Every piece is built here in code as a
// museum piece: a lathe-turned base (plinth, torus, ogee, gadrooned bulb, neck, disc collar,
// rope collar), a carved figure with an oversized head standing on it, polished ebony or carved
// ivory with inlay, a fine procedural grain, and a moon-silver light along every edge.
//
//   black   pawn    the Carrier         a hooded figure hugging a box of earth
//           knight  the Coach Horse     a funeral coach horse, plumed and blinkered, eyes like coals
//           bishop  the Shrouded Lady   a pale woman bound in grave-clothes
//           rook    the Dead Captain    a drowned captain lashed to a ship's wheel
//           queen   the Bride           the fair one of the three wives, in tiara and veil
//           king    the Count's Likeness a cloak and crown on a stand; nobody is in it
//   white   turtle  the Mock Turtle     a turtle with a calf's head, weeping
//           dormouse                    slumped as if dead, a bloody bite on its neck
//           duchess                     headless; she carries her head under her arm
//   (off the board, broken: the white knight, the Gryphon, carveGryphon; a prop for vampkit.js's wreck, never on the board)
//
// The pieces are statues. Only a striking piece moves (it slides to the warden's square, tips,
// and goes back) and only a taken piece dies:
//   pawn    the box bursts into loose earth and the hood falls empty
//   knight  the horse rears and goes to black smoke from the hooves up
//   bishop  she folds into her shroud, which drops flat
//   rook    the ropes snap, the wheel spins and he falls to bones
//   queen   she ages centuries in a second and crumbles to dust
//   king    it collapses in a heap and bats burst out
//
// The view decides nothing. The board is read from sim.waves.board ({ at, pieces[] each { kind,
// square, taken } }); moves and deaths come from the events knightLeap { from, to }, capture
// { piece, square } and pieceStrike { piece, square, to, damage }; the board is won (walkWon)
// when sim.waves.done.knight says so, and the coals of the horse's eyes then go out. Places are
// logic/keepmap.js's (BOARD, squareRect).
//
// Cost. A standing piece is one mesh and one material (vertex colour, with a per-vertex finish
// and glow), so the eleven are 11 draw calls, twice that with the zone's one shadow map. A
// dying piece is drawn as its parts (at most 9 meshes) for the few seconds its death lasts, plus
// one instanced mesh of pooled motes (earth, smoke, dust; at most 360 quads) and, for the king
// only, one instanced mesh of 14 bats. Nothing is allocated per frame. Everything is built when
// the castle's shell first draws the Knight's Walk (castle.sees('walk')), shown and hidden with
// it, and freed (geometry, materials) once it is out of sight and the eye is 44 m off, or the
// room changes; with no shell to ask, by the eye's distance alone.
// Reduced flash stills the flare of the coach horse's eyes as it dies and dims the ember at
// its burning edge; a strike has no flash to still.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { BOARD, PIECE_FOOT, squareRect } from '../logic/keepmap.js';

const EBONY = 0x121116; const IVORY = 0xe9e2cf; const RED = 0x7a0f14; const GILT = 0x9c7a3c;
const EARTH = 0x2b2019; const EMBER = 0xff2a1a; const MOON = 0xc9d3e0; const VOID = 0x030304;
const PEARL = 0xbfd4e6; const SHADE = 0x24222b; // ebony cloth, a little greyer than the wood
const TAU = Math.PI * 2;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const easeIn = (k) => { const t = clamp(k); return t * t; };
const easeOut = (k) => { const t = clamp(k); return 1 - (1 - t) * (1 - t); };

/** The figure each chess kind is carved as (design, the board table). */
export const CHESS_FIGURES = Object.freeze({
  pawn: 'the Carrier', knight: 'the Coach Horse', bishop: 'the Shrouded Lady', rook: 'the Dead Captain',
  queen: 'the Bride', king: "the Count's Likeness", turtle: 'the Mock Turtle', dormouse: 'the Dormouse', duchess: 'the Duchess',
});

const BLACK_SLOTS = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'pawn', 'pawn'];
const BUILD_NEAR = 30; const FREE_FAR = 44; // metres from the board's middle
const MOTES = 360; const BATS = 14;
const DEATH_LEN = { pawn: 2.0, knight: 2.7, bishop: 2.0, rook: 3.1, queen: 2.7, king: 3.4 };
const DISSOLVES = { knight: ['horse'], rook: ['captain'], queen: ['bride'] };
const BONES = ['skull', 'ribs', 'limbs'];

const _m = new THREE.Matrix4(); const _q = new THREE.Quaternion(); const _e = new THREE.Euler();
const _p = new THREE.Vector3(); const _s = new THREE.Vector3(); const _c = new THREE.Color();
const _o = new THREE.Object3D();

// ---- geometry tools -----------------------------------------------------------------------------

/** One geometry from many, keeping position, normal, colour and finish (indexed). */
function fuse(list) {
  let nv = 0; let ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['fin', 2]]) {
    const arr = new Float32Array(nv * size); let o = 0;
    for (const g of list) { const at = g.attributes[name]; arr.set(at.array.subarray(0, at.count * size), o); o += at.count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let io = 0; let vo = 0;
  for (const g of list) {
    const cnt = g.attributes.position.count;
    if (g.index) { const src = g.index.array; for (let i = 0; i < src.length; i++) idx[io++] = src[i] + vo; }
    else for (let i = 0; i < cnt; i++) idx[io++] = i + vo;
    vo += cnt;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * A turned (lathe) solid about the Y axis. pts: [[radius, y], ...] bottom to top; a point given
 * twice makes a crisp arris, as a chisel leaves. o.seg sides; o.carve(angle, y) -> a radius
 * multiplier (gadroons, rope twist, folds); o.arc [start, length] for an open sweep (a cloak);
 * o.color hex or (y, angle, THREE.Color) -> void. Angle 0 is the front (+Z).
 */
function lathe(pts, o = {}) {
  const seg = o.seg || 40; const n = pts.length; const open = !!o.arc;
  const a0 = open ? o.arc[0] : 0; const al = open ? o.arc[1] : TAU;
  const cols = open ? seg + 1 : seg;
  const pos = new Float32Array(n * cols * 3); const col = new Float32Array(n * cols * 3);
  const idx = [];
  const flat = typeof o.color === 'function' ? null : new THREE.Color(o.color ?? EBONY);
  for (let i = 0; i < n; i++) {
    const r = pts[i][0]; const y = pts[i][1];
    for (let k = 0; k < cols; k++) {
      const a = a0 + (al * k) / seg;
      const rr = r * (o.carve ? o.carve(a, y) : 1);
      const j = (i * cols + k) * 3;
      pos[j] = Math.sin(a) * rr; pos[j + 1] = y; pos[j + 2] = Math.cos(a) * rr;
      if (flat) _c.copy(flat); else { _c.setHex(EBONY); o.color(y, a, _c); }
      const v = 1 + (o.vary ?? 0.05) * S.noise(pos[j] * 7, y * 7, pos[j + 2] * 7, o.seed || 1);
      col[j] = _c.r * v; col[j + 1] = _c.g * v; col[j + 2] = _c.b * v;
      if (i < n - 1 && k < seg) {
        const p = i * cols + k; const q = i * cols + (open ? k + 1 : (k + 1) % cols);
        idx.push(p, q, p + cols, q, q + cols, p + cols);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points of a circular arc in the (radius, y) plane, for beads (bulging out) and coves. */
function arc(out, cr, cy, rad, from, to, n = 6, squash = 1) {
  for (let i = 0; i <= n; i++) {
    const a = lerp(from, to, i / n);
    out.push([cr + rad * squash * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return out;
}
const edge = (p) => { p.push(p[p.length - 1].slice()); return p; };

/**
 * The turned base every piece stands on: foot radius R, height H (its top is the platform the
 * figure stands on). From the floor: plinth, torus, a dentilled fillet, an ogee, a gadrooned
 * bulb, a waisted neck, a sharp disc collar, a rope-twist collar, the platform.
 */
function turnedBase(R, H, hex, seed) {
  const p = [[0, 0], [1, 0]]; edge(p); p.push([1, 0.05]); edge(p);
  arc(p, 0.95, 0.098, 0.048, -Math.PI / 2, Math.PI / 2, 4, 1.2); edge(p);
  p.push([0.9, 0.146], [0.9, 0.178]); edge(p);
  for (let i = 0; i <= 5; i++) { const t = i / 5; p.push([lerp(0.87, 0.55, ease(t)), lerp(0.178, 0.36, t)]); }
  edge(p); p.push([0.61, 0.36], [0.61, 0.384]); edge(p);
  arc(p, 0.5, 0.472, 0.088, -Math.PI / 2, Math.PI / 2, 6, 2.1); edge(p);
  for (let i = 0; i <= 5; i++) { const t = i / 5; p.push([lerp(0.47, 0.43, t) - 0.12 * Math.sin(Math.PI * t), lerp(0.56, 0.74, t)]); }
  edge(p); p.push([0.63, 0.74]); edge(p); p.push([0.65, 0.772]); edge(p); p.push([0.5, 0.79]); edge(p);
  arc(p, 0.47, 0.83, 0.04, -Math.PI / 2, Math.PI / 2, 4, 1.6); edge(p);
  p.push([0.52, 0.87], [0.57, 0.905]); edge(p); p.push([0.59, 0.96]); edge(p); p.push([0.56, 1], [0, 1]);
  const pts = p.map(([r, y]) => [r * R, y * H]);
  const carve = (a, y) => {
    const u = y / H;
    if (u > 0.384 && u < 0.56) return 1 + 0.1 * (0.5 + 0.5 * Math.cos(10 * a)) * Math.sin((Math.PI * (u - 0.384)) / 0.176);
    if (u > 0.79 && u < 0.87) return 1 + 0.055 * Math.sin(10 * a + u * 150) * Math.sin((Math.PI * (u - 0.79)) / 0.08);
    if (u > 0.146 && u < 0.178) return Math.sin(10 * a) > 0 ? 1.028 : 1;
    return 1;
  };
  return lathe(pts, { seg: 40, carve, color: hex, seed });
}

/** A builder that collects geometry into named parts, each geometry painted and finished. */
function carver(seed, wood, finish) {
  const parts = {}; let cur = null; let stack = null;
  const polish = finish ?? (wood === IVORY ? 0.5 : 0.35); // a finish over 0.62 takes no chisel nicks
  const put = (g, hex, o = {}) => {
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    if (hex != null) S.tint(g, hex, o.vary ?? 0.05, seed + (cur ? cur.length : 0));
    const n = g.attributes.position.count; const f = new Float32Array(n * 2);
    let r = o.rough ?? polish; const gl = o.glow || 0;
    const tone = hex ?? o.tint;
    if (tone === IVORY && wood !== IVORY) r = Math.max(r, 0.64); // ivory let into ebony: a face, a hand, bone
    if (wood === EBONY && (tone === EBONY || tone === SHADE)) r = Math.max(r, 0.35); // black lacquer, rubbed: no long streaks
    for (let i = 0; i < n; i++) { f[i * 2] = r; f[i * 2 + 1] = gl; }
    g.setAttribute('fin', new THREE.BufferAttribute(f, 2));
    (stack || cur).push(g);
    return g;
  };
  const place = (g, c, rot, sc) => {
    _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
    _m.compose(_p.set(c[0], c[1], c[2]), _q.setFromEuler(_e), Array.isArray(sc) ? _s.set(sc[0], sc[1], sc[2]) : _s.set(sc ?? 1, sc ?? 1, sc ?? 1));
    return g.applyMatrix4(_m);
  };
  const k = {
    wood, parts,
    /** Following geometry goes into the named part. */
    to(name) { cur = parts[name] || (parts[name] = []); return k; },
    /** Runs fn, then moves everything it added by (c, rot, scale): a head, a hand, a rose. */
    group(c, rot, fn, sc) {
      const was = stack; const mine = []; stack = mine; fn(); stack = was;
      for (const g of mine) { place(g, c, rot, sc); (stack || cur).push(g); }
    },
    ell(c, r, hex, o = {}) { return put(place(new THREE.SphereGeometry(1, o.ws || 10, o.hs || 7), c, o.rot, r), hex, o); },
    cyl(c, r0, r1, h, hex, o = {}) { return put(place(new THREE.CylinderGeometry(r1, r0, h, o.seg || 10, 1, !!o.open), c, o.rot), hex, o); },
    box(c, s, hex, o = {}) { return put(place(new THREE.BoxGeometry(s[0], s[1], s[2]), c, o.rot), hex, o); },
    tor(c, R, r, hex, o = {}) { return put(place(new THREE.TorusGeometry(R, r, o.ts || 6, o.rs || 16, o.arc || TAU), c, o.rot, o.sc), hex, o); },
    /** A lofted tube through points (a limb, a rope, a strand); rad a number or one per point. */
    tube(pts, rad, hex, o = {}) {
      const rings = pts.map((at, i) => ({ at, r: Array.isArray(rad) ? rad[i] : rad }));
      const g = S.skin(rings, { color: hex, sides: o.sides || 7, detail: o.detail || 2, noise: o.noise ?? 0.012, mottle: 0.05, shade: 0.12, budget: o.budget || 220, caps: o.caps || 'round', seed: seed + pts.length });
      return put(g, null, { ...o, tint: hex });
    },
    lathe(pts, hex, o = {}) {
      const g = lathe(pts, { ...o, color: o.color || hex, seed });
      if (o.at || o.rot) place(g, o.at || [0, 0, 0], o.rot);
      return put(g, null, { ...o, tint: hex });
    },
    /**
     * A carved face on the front of a head of radius s centred on the group's origin: lidded
     * eyes, a brow, a long nose and a mouth, cut plain as the old sets cut them.
     */
    face(s, o = {}) {
      const skin = o.skin ?? wood; const dark = o.dark ?? (wood === IVORY ? 0x3a3128 : VOID);
      for (const sd of [-1, 1]) {
        if (o.closed) {
          k.ell([sd * 0.38 * s, 0.06 * s, 0.84 * s], [0.2 * s, 0.11 * s, 0.1 * s], skin, { ws: 8, hs: 6 });
          k.ell([sd * 0.38 * s, 0.0, 0.9 * s], [0.19 * s, 0.022 * s, 0.06 * s], dark, { ws: 8, hs: 4, rough: 0.9, rot: [0, 0, -sd * 0.1] });
        } else {
          k.ell([sd * 0.38 * s, 0.06 * s, 0.82 * s], [0.2 * s, 0.14 * s, 0.11 * s], o.eye ?? dark, { ws: 8, hs: 6, glow: o.eyeGlow || 0, rough: 0.12 });
          k.ell([sd * 0.38 * s, 0.16 * s, 0.86 * s], [0.23 * s, 0.07 * s, 0.1 * s], skin, { ws: 8, hs: 5, rot: [0.3, 0, 0] });
        }
        k.ell([sd * 0.4 * s, 0.3 * s, 0.84 * s], [0.27 * s, 0.065 * s, 0.13 * s], skin, { ws: 8, hs: 5, rot: [0, 0, sd * (o.brow ?? -0.2)] });
      }
      k.ell([0, -0.06 * s, 0.97 * s], [0.1 * s, 0.25 * s, 0.17 * s], skin, { ws: 8, hs: 6 });
      if (o.mouth === 'open') k.ell([0, -0.5 * s, 0.82 * s], [0.2 * s, 0.17 * s, 0.1 * s], dark, { ws: 8, hs: 6, rough: 0.95 });
      else if (o.mouth === 'frown') {
        for (const sd of [-1, 1]) k.ell([sd * 0.15 * s, -0.5 * s, 0.84 * s], [0.18 * s, 0.035 * s, 0.07 * s], dark, { ws: 6, hs: 4, rough: 0.9, rot: [0, 0, sd * 0.38] });
      } else if (o.mouth !== 'none') k.ell([0, -0.46 * s, 0.86 * s], [0.25 * s, 0.03 * s, 0.07 * s], dark, { ws: 8, hs: 4, rough: 0.9 });
    },
  };
  return k;
}

const folds = (n, amp, twist = 0) => (a, y) => 1 + amp * Math.sin(n * a + twist * y) + amp * 0.4 * Math.sin((n * 2 + 1) * a + 1.7);

// ---- the black pieces -----------------------------------------------------------------------------

function carveCarrier(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.pawn;
  baseInto(k, R, H, seed);
  // the robe: a long habit hanging in folds, girdled with a rope
  k.to('body').lathe([[0.3, H], [0.41, H + 0.02], [0.43, H + 0.08], [0.38, H + 0.4], [0.33, H + 0.72], [0.31, H + 0.95], [0.36, H + 1.08], [0.3, H + 1.2], [0.16, H + 1.28], [0, H + 1.3]],
    SHADE, { seg: 32, carve: folds(7, 0.045, 3), rough: 0.42 });
  k.tor([0, H + 0.62, 0], 0.355, 0.028, EBONY, { rot: [Math.PI / 2, 0, 0], rs: 20, rough: 0.5 });
  k.tube([[0.2, H + 0.62, 0.3], [0.22, H + 0.4, 0.34], [0.2, H + 0.2, 0.36]], [0.026, 0.024, 0.034], EBONY, { rough: 0.5 });
  for (const sd of [-1, 1]) { // wide sleeves reaching round the box
    k.tube([[sd * 0.3, H + 1.08, 0], [sd * 0.42, H + 0.9, 0.14], [sd * 0.4, H + 0.74, 0.36], [sd * 0.3, H + 0.7, 0.52]], [0.1, 0.11, 0.12, 0.1], SHADE, { sides: 8, rough: 0.42, budget: 220 });
    k.ell([sd * 0.25, H + 0.7, 0.6], [0.06, 0.075, 0.05], IVORY, { ws: 8, hs: 6, rough: 0.4 }); // a pale hand
    for (let f = 0; f < 4; f++) k.ell([sd * 0.2, H + 0.75 - f * 0.035, 0.635], [0.05, 0.014, 0.018], IVORY, { ws: 6, hs: 4, rough: 0.4 });
  }
  // the box of earth, hugged to the chest: planks, iron straps, the earth heaped proud of the rim
  k.to('box').box([0, H + 0.68, 0.44], [0.52, 0.34, 0.3], EBONY, { rough: 0.3 });
  for (const y of [-0.085, 0.085]) k.box([0, H + 0.68 + y, 0.593], [0.5, 0.012, 0.012], VOID, { rough: 0.9 });
  for (const x of [-0.17, 0.17]) {
    k.box([x, H + 0.68, 0.44], [0.045, 0.352, 0.312], GILT, { rough: 0.45 });
    for (const y of [-0.12, 0, 0.12]) k.ell([x, H + 0.68 + y, 0.597], [0.014, 0.014, 0.008], GILT, { ws: 6, hs: 4, rough: 0.3 });
  }
  k.ell([0, H + 0.85, 0.44], [0.24, 0.07, 0.13], EARTH, { rough: 0.98, vary: 0.35 });
  k.ell([0.08, H + 0.88, 0.4], [0.1, 0.05, 0.08], EARTH, { rough: 0.98, vary: 0.35, ws: 8, hs: 6 });
  // the hood: oversized, peaked, and nothing in it
  k.to('hood').group([0, H + 1.56, 0.02], [0.08, 0, 0], () => {
    k.ell([0, 0, 0], [0.37, 0.41, 0.4], SHADE, { ws: 18, hs: 12, rough: 0.4 });
    k.tor([0, -0.03, 0.27], 0.25, 0.055, SHADE, { rs: 22, ts: 7, rough: 0.4, sc: [1, 1.12, 1] });
    k.ell([0, -0.03, 0.25], [0.235, 0.27, 0.07], VOID, { ws: 14, hs: 8, rough: 1, vary: 0 });
    k.tube([[0, 0.3, -0.12], [0, 0.48, -0.3], [0, 0.5, -0.5], [0, 0.4, -0.62]], [0.2, 0.12, 0.06, 0.015], SHADE, { sides: 8, rough: 0.4, budget: 200 });
    k.lathe([[0.36, -0.5], [0.4, -0.42], [0.36, -0.3], [0.3, -0.2]], SHADE, { seg: 24, carve: folds(6, 0.05), rough: 0.42 }); // the cowl on the shoulders
  });
  // what is left: a heap of earth at the foot
  k.to('mound').ell([0, 0.1, 0.78], [0.6, 0.16, 0.42], EARTH, { rough: 0.98, vary: 0.4, ws: 14, hs: 8 });
  k.ell([0.3, 0.07, 1.0], [0.25, 0.1, 0.22], EARTH, { rough: 0.98, vary: 0.4, ws: 10, hs: 6 });
  k.ell([-0.34, 0.06, 0.96], [0.2, 0.08, 0.2], EARTH, { rough: 0.98, vary: 0.4, ws: 10, hs: 6 });
  return { k, R, H, top: H + 2.1, pivots: { body: [0, H, 0], hood: [0, H + 1.5, 0], box: [0, H + 0.68, 0.44] }, hidden: ['mound'] };
}

function finished(g, rough) {
  const n = g.attributes.position.count; const f = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) f[i * 2] = rough;
  g.setAttribute('fin', new THREE.BufferAttribute(f, 2));
  return g;
}
const baseInto = (k, R, H, seed) => { (k.parts.base = k.parts.base || []).push(finished(turnedBase(R, H, k.wood, seed), k.wood === IVORY ? 0.5 : 0.35)); };

function carveHorse(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.knight;
  baseInto(k, R, H, seed);
  k.to('horse');
  // the breast and the arched neck: deep through the crest, narrow across
  k.tube([[0, H - 0.02, -0.05], [0, H + 0.5, -0.1], [0, H + 1.05, -0.2], [0, H + 1.55, -0.12], [0, H + 1.95, 0.12], [0, H + 2.1, 0.36]],
    [[0.44, 0.4], [0.4, 0.42], [0.27, 0.38], [0.2, 0.3], [0.19, 0.27], [0.2, 0.25]], EBONY, { sides: 16, detail: 3, budget: 1000, caps: ['flat', 'round'], noise: 0.02 });
  // the long head, carried low on the bit: oversized, all bone
  k.tube([[0, H + 2.16, 0.34], [0, H + 2.0, 0.66], [0, H + 1.72, 0.98], [0, H + 1.46, 1.2], [0, H + 1.36, 1.27]],
    [[0.22, 0.26], [0.225, 0.27], [0.155, 0.2], [0.125, 0.15], [0.11, 0.1]], EBONY, { sides: 16, detail: 3, budget: 900, noise: 0.02 });
  for (const sd of [-1, 1]) {
    k.ell([sd * 0.1, H + 1.8, 0.58], [0.13, 0.25, 0.27], EBONY, { ws: 12, hs: 8 }); // the round of the jaw
    k.ell([sd * 0.15, H + 1.62, 0.98], [0.035, 0.05, 0.2], EBONY, { ws: 8, hs: 5, rot: [0.75, 0, 0] }); // the cheek ridge
    k.tube([[sd * 0.12, H + 2.26, 0.3], [sd * 0.16, H + 2.46, 0.26], [sd * 0.14, H + 2.6, 0.3]], [[0.06, 0.04], [0.055, 0.035], [0.01, 0.01]], EBONY, { sides: 6, budget: 110 }); // ears, pricked
    k.ell([sd * 0.212, H + 1.985, 0.74], [0.02, 0.04, 0.052], EMBER, { glow: 1, rough: 0.1, ws: 10, hs: 8, vary: 0 }); // eyes like coals
    k.ell([sd * 0.2, H + 2.05, 0.74], [0.05, 0.03, 0.1], EBONY, { ws: 8, hs: 5, rot: [0, 0, sd * 0.2] }); // the bony brow over them
    k.ell([sd * 0.2, H + 1.93, 0.75], [0.04, 0.02, 0.08], EBONY, { ws: 8, hs: 5 });
    k.box([sd * 0.262, H + 1.98, 0.68], [0.018, 0.16, 0.19], EBONY, { rot: [0, sd * 0.22, 0], rough: 0.3 }); // blinkers
    k.ell([sd * 0.273, H + 1.98, 0.68], [0.008, 0.028, 0.028], GILT, { ws: 6, hs: 4, rough: 0.3 });
    k.ell([sd * 0.075, H + 1.41, 1.27], [0.03, 0.045, 0.028], EMBER, { glow: 0.3, ws: 6, hs: 5, vary: 0 }); // nostrils, lit from inside
    k.tor([sd * 0.075, H + 1.41, 1.275], 0.045, 0.016, EBONY, { rs: 10, ts: 5, rot: [0.5, sd * 0.5, 0], sc: [1, 1.3, 1] });
    // bridle: cheek strap and a gilt boss
    k.tube([[sd * 0.2, H + 2.14, 0.45], [sd * 0.245, H + 1.9, 0.62], [sd * 0.17, H + 1.64, 1.02]], 0.017, EBONY, { sides: 5, rough: 0.5, budget: 80 });
    k.ell([sd * 0.25, H + 1.88, 0.62], [0.012, 0.034, 0.034], GILT, { ws: 6, hs: 4, rough: 0.3 });
    k.tube([[sd * 0.15, H + 1.52, 1.12], [sd * 0.3, H + 1.3, 0.8], [sd * 0.4, H + 0.86, 0.26]], 0.013, EBONY, { sides: 4, rough: 0.5, budget: 60 }); // the rein, to the collar
  }
  k.tor([0, H + 1.62, 1.04], 0.175, 0.017, EBONY, { rot: [0.9, 0, 0], rs: 14, ts: 5, rough: 0.5 }); // noseband
  k.tor([0, H + 2.13, 0.5], 0.235, 0.017, EBONY, { rot: [1.2, 0, 0], rs: 14, ts: 5, rough: 0.5, arc: Math.PI, sc: [1, 1.1, 1] }); // browband
  k.ell([0, H + 2.14, 0.6], [0.035, 0.035, 0.02], GILT, { ws: 6, hs: 4, rough: 0.3 });
  // bared teeth, inlaid, and the bit
  for (let i = -3; i <= 3; i++) k.box([i * 0.026, H + 1.305 - Math.abs(i) * 0.004, 1.325 - Math.abs(i) * 0.012], [0.02, 0.05, 0.016], IVORY, { rough: 0.3 });
  k.cyl([0, H + 1.4, 1.14], 0.014, 0.014, 0.36, GILT, { seg: 6, rot: [0, 0, Math.PI / 2], rough: 0.3 });
  // the mane: a hogged crest, cut in locks, down the back of the neck
  for (let i = 0; i < 13; i++) {
    const t = i / 12; const a = lerp(-0.25, 1.45, t);
    const y = H + 1.2 + Math.sin(a) * 0.95; const z = -0.14 - Math.cos(a) * 0.5 + t * t * 0.42;
    k.ell([0, y, z], [0.045, 0.1, 0.15], EBONY, { ws: 7, hs: 5, rot: [a - 1.2, 0, 0] });
  }
  k.ell([0, H + 2.16, 0.6], [0.07, 0.06, 0.17], EBONY, { ws: 8, hs: 5, rot: [0.55, 0, 0] }); // forelock
  // the funeral plume on the poll: ostrich feathers, falling back
  k.lathe([[0.05, 0], [0.06, 0.03], [0.04, 0.08], [0.05, 0.14], [0.03, 0.17]], GILT, { seg: 8, rough: 0.3, at: [0, H + 2.3, 0.3] });
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.42; const x = Math.sin(a); const back = Math.cos(a);
    k.tube([[0, H + 2.46, 0.3], [x * 0.08, H + 2.82, 0.28 - back * 0.03], [x * 0.24, H + 3.02, 0.14 - back * 0.16], [x * 0.42, H + 2.92, -0.04 - back * 0.32], [x * 0.5, H + 2.74, -0.1 - back * 0.4]],
      [[0.025, 0.025], [0.07, 0.035], [0.09, 0.04], [0.075, 0.035], [0.02, 0.012]], SHADE, { sides: 7, rough: 0.6, budget: 150, noise: 0.12 });
  }
  // the coach collar, its gilt hames and the breast-strap's boss
  k.tor([0, H + 0.52, -0.02], 0.45, 0.085, EBONY, { rot: [Math.PI / 2 - 0.16, 0, 0], rs: 26, ts: 8, rough: 0.3 });
  for (const sd of [-1, 1]) k.tube([[sd * 0.3, H + 0.34, 0.36], [sd * 0.5, H + 0.52, 0.06], [sd * 0.42, H + 0.7, -0.3], [sd * 0.18, H + 0.9, -0.5], [sd * 0.16, H + 1.06, -0.52]], [0.022, 0.026, 0.024, 0.022, 0.034], GILT, { sides: 6, rough: 0.3, budget: 130 });
  k.ell([0, H + 0.5, 0.42], [0.1, 0.12, 0.04], GILT, { ws: 10, hs: 6, rough: 0.3 });
  k.ell([0, H + 0.5, 0.45], [0.055, 0.07, 0.03], RED, { ws: 8, hs: 5, rough: 0.14, glow: 0.06 });
  for (let i = -2; i <= 2; i++) if (i) k.tube([[i * 0.07, H + 0.4, 0.42 - Math.abs(i) * 0.03], [i * 0.085, H + 0.2, 0.44 - Math.abs(i) * 0.03], [i * 0.08, H + 0.06, 0.4 - Math.abs(i) * 0.03]], [0.02, 0.026, 0.008], SHADE, { sides: 5, rough: 0.6, budget: 50 }); // tassels
  return { k, R, H, top: H + 3.05, pivots: { horse: [0, H, -0.15] }, hidden: [] };
}

function carveLady(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.bishop;
  baseInto(k, R, H, seed);
  // the woman inside the wrappings
  k.to('lady').lathe([[0.2, H], [0.3, H + 0.03], [0.27, H + 0.5], [0.24, H + 0.95], [0.28, H + 1.2], [0.34, H + 1.36], [0.28, H + 1.5], [0.12, H + 1.58], [0.1, H + 1.7]],
    SHADE, { seg: 24, rough: 0.5, carve: (a, y) => 1 + 0.03 * Math.sin(y * 34 + a * 2) });
  k.group([0, H + 2.02, 0.07], [0.16, 0, 0], () => { // the head, oversized and bowed: pale, eyes shut, the jaw bound
    k.ell([0, 0, 0], [0.31, 0.4, 0.34], IVORY, { ws: 20, hs: 14, rough: 0.3 });
    k.face(0.35, { skin: IVORY, closed: true, dark: 0x2a2320, brow: 0.14 });
    k.ell([0, -0.3, 0.2], [0.13, 0.1, 0.12], IVORY, { ws: 8, hs: 6, rough: 0.3 }); // a long chin
    k.tor([0, -0.02, 0.03], 0.35, 0.028, SHADE, { rot: [0, Math.PI / 2, 0], rs: 20, ts: 5, rough: 0.5, sc: [1, 1.16, 1] });
    k.ell([0, -0.42, 0.12], [0.07, 0.05, 0.06], SHADE, { ws: 6, hs: 5, rough: 0.5 }); // the knot under the chin
    for (const sd of [-1, 1]) k.ell([sd * 0.13, -0.25, 0.3], [0.014, 0.05, 0.012], PEARL, { ws: 5, hs: 5, rough: 0.08, vary: 0 }); // the pennies fell; two tears stayed
  });
  for (const sd of [-1, 1]) { // hands crossed on the breast
    k.tube([[sd * 0.32, H + 1.34, 0.02], [sd * 0.36, H + 1.12, 0.22], [-sd * 0.06, H + 1.22, 0.34]], [0.075, 0.065, 0.05], SHADE, { sides: 7, rough: 0.5, budget: 150 });
    k.ell([-sd * 0.1, H + 1.24 + sd * 0.03, 0.37], [0.09, 0.045, 0.03], IVORY, { ws: 8, hs: 5, rough: 0.3, rot: [0, 0, -sd * 0.5] });
    for (let f = 0; f < 4; f++) k.ell([-sd * (0.17 + f * 0.012), H + 1.275 + sd * 0.03 - f * 0.022, 0.385], [0.045, 0.011, 0.014], IVORY, { ws: 5, hs: 4, rough: 0.3, rot: [0, 0, -sd * 0.5] });
  }
  // the shroud: wound close below, a hood drawn round the face, tied off above in a cleft knot
  k.to('shroud').lathe([[0.3, H], [0.42, H + 0.02], [0.45, H + 0.1], [0.38, H + 0.5], [0.33, H + 0.9], [0.33, H + 1.05]],
    SHADE, { seg: 36, rough: 0.46, carve: (a, y) => (1 + 0.05 * Math.sin(5 * a + y * 3)) * (1 + 0.02 * Math.sign(Math.sin(y * 26 + a))) });
  k.lathe([[0.33, H + 1.0], [0.4, H + 1.25], [0.47, H + 1.45], [0.45, H + 1.7], [0.47, H + 2.0], [0.45, H + 2.25], [0.34, H + 2.45], [0.2, H + 2.54], [0.16, H + 2.6]],
    SHADE, { seg: 36, rough: 0.46, arc: [0.62, TAU - 1.24], carve: folds(6, 0.035, 2), at: [0, 0, 0.03] });
  for (const sd of [-1, 1]) { // the hood's rolled edge, either side of the face
    k.tube([[sd * 0.1, H + 2.56, 0.16], [sd * 0.25, H + 2.36, 0.36], [sd * 0.3, H + 2.0, 0.42], [sd * 0.29, H + 1.6, 0.4], [sd * 0.3, H + 1.36, 0.36], [sd * 0.22, H + 1.04, 0.28]], [0.05, 0.055, 0.055, 0.05, 0.05, 0.04], SHADE, { sides: 7, rough: 0.46, budget: 260, detail: 3 });
  }
  k.tor([0, H + 2.58, 0.03], 0.17, 0.028, GILT, { rot: [Math.PI / 2, 0, 0], rs: 16, ts: 5, rough: 0.35 });
  k.lathe([[0.15, 0], [0.21, 0.08], [0.2, 0.18], [0.1, 0.32], [0, 0.36]], SHADE, { seg: 16, rough: 0.46, at: [0, H + 2.58, 0.03], carve: (a) => 0.62 + 0.38 * Math.abs(Math.sin(a)) }); // the knot, pinched front to back: a mitre, nearly
  for (const y of [0.22, 0.62]) k.tor([0, H + y, 0], 0.415 - y * 0.1, 0.02, EBONY, { rot: [Math.PI / 2, 0, 0], rs: 24, ts: 5, rough: 0.4 }); // winding bands
  return { k, R, H, top: H + 3.0, pivots: { lady: [0, H, 0], shroud: [0, H, 0] }, hidden: [] };
}

function carveCaptain(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.rook;
  baseInto(k, R, H, seed);
  const hub = [0, H + 1.18, -0.16];
  // the wheel on its post: rim, felloe, hub, eight turned spokes that run on into handles
  k.to('post').box([0, H + 0.5, -0.3], [0.2, 1.0, 0.16], EBONY, { rough: 0.3 });
  k.cyl([0, H + 1.18, -0.26], 0.05, 0.05, 0.22, GILT, { seg: 8, rot: [Math.PI / 2, 0, 0], rough: 0.35 });
  k.to('wheel').group(hub, null, () => {
    k.tor([0, 0, 0], 0.74, 0.055, EBONY, { rs: 24, ts: 6 });
    k.tor([0, 0, 0.02], 0.74, 0.02, GILT, { rs: 24, ts: 4, rough: 0.35 });
    k.tor([0, 0, 0], 0.3, 0.035, EBONY, { rs: 16, ts: 5 });
    k.cyl([0, 0, 0], 0.13, 0.13, 0.16, EBONY, { seg: 14, rot: [Math.PI / 2, 0, 0] });
    k.ell([0, 0, 0.09], [0.07, 0.07, 0.04], GILT, { ws: 10, hs: 6, rough: 0.3 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      k.group([0, 0, 0], [0, 0, a], () => {
        k.lathe([[0.04, 0.12], [0.03, 0.32], [0.045, 0.38], [0.034, 0.7], [0.05, 0.75], [0.028, 0.82], [0.045, 0.93], [0.03, 1.03], [0, 1.045]], EBONY, { seg: 6 });
      });
    }
  });
  // the captain, hung on it by the wrists
  k.to('captain').lathe([[0.26, H], [0.34, H + 0.03], [0.33, H + 0.5], [0.3, H + 0.82], [0.33, H + 1.2], [0.4, H + 1.5], [0.36, H + 1.62], [0.14, H + 1.72], [0.11, H + 1.8]],
    EBONY, { seg: 24, rough: 0.3, carve: (a) => 1 - 0.12 * Math.max(0, -Math.cos(a)) + 0.02 * Math.sin(9 * a), at: [0, 0, 0.08] });
  k.box([0, H + 1.0, 0.4], [0.02, 0.95, 0.03], VOID, { rough: 0.9 }); // the coat's front edge
  for (let i = 0; i < 5; i++) for (const sd of [-1, 1]) k.ell([sd * 0.09, H + 0.62 + i * 0.19, 0.4 + (i > 2 ? 0.04 : 0.01)], [0.026, 0.026, 0.014], GILT, { ws: 5, hs: 3, rough: 0.28 });
  for (const sd of [-1, 1]) {
    k.tube([[sd * 0.36, H + 1.56, 0.06], [sd * 0.52, H + 1.5, 0], [sd * 0.66, H + 1.56, -0.08], [sd * 0.7, H + 1.66, -0.1]], [0.1, 0.085, 0.07, 0.06], EBONY, { sides: 8, rough: 0.3, budget: 220 });
    k.tor([sd * 0.68, H + 1.6, -0.09], 0.075, 0.016, GILT, { rot: [Math.PI / 2, 0, sd * 0.5], rs: 10, ts: 4, rough: 0.35 }); // cuff braid
    for (let f = 0; f < 4; f++) k.tube([[sd * 0.7, H + 1.68, -0.1], [sd * (0.72 + f * 0.012), H + 1.76 + f * 0.01, -0.07 + f * 0.022], [sd * (0.7 + f * 0.02), H + 1.83, -0.04 + f * 0.03]], [0.014, 0.012, 0.008], IVORY, { sides: 4, budget: 40, rough: 0.35 }); // finger bones
    k.ell([sd * 0.36, H + 1.6, 0.08], [0.13, 0.05, 0.12], GILT, { ws: 8, hs: 5, rough: 0.4 }); // epaulette
    for (let f = -1; f <= 1; f++) k.cyl([sd * 0.43, H + 1.53, 0.08 + f * 0.07], 0.014, 0.014, 0.09, GILT, { seg: 5, rough: 0.4 });
    // weed: long straps of kelp off the shoulders and the cap
    for (let j = 0; j < 2; j++) {
      const x = sd * (0.16 + j * 0.14); const z = 0.3 - j * 0.09;
      k.tube([[x, H + 1.66, z - 0.1], [x + sd * 0.03, H + 1.4, z + 0.09], [x - sd * 0.02, H + 1.0 - j * 0.12, z + 0.1], [x + sd * 0.03, H + 0.6 - j * 0.14, z + 0.06]],
        [[0.04, 0.01], [0.055, 0.012], [0.045, 0.01], [0.012, 0.006]], 0x1a2420, { sides: 5, rough: 0.5, budget: 70, noise: 0.1 });
    }
  }
  k.group([0, H + 2.08, 0.16], [0.24, 0.1, 0.06], () => { // the head, sunk forward: a skull the sea has cleaned
    skull(k, 0.3, IVORY, true);
    for (let i = -1; i <= 1; i++) k.tube([[i * 0.1, -0.5, 0.2], [i * 0.12, -0.66, 0.28], [i * 0.11, -0.86 - Math.abs(i) * 0.03, 0.26]], [0.034, 0.03, 0.008], 0x1a2420, { sides: 5, rough: 0.5, budget: 60, noise: 0.1 }); // a beard of weed
  });
  // his cap: its own part, so it can fall last
  k.to('cap').group([0, H + 2.34, 0.13], [0.2, 0.1, 0.1], () => {
    k.cyl([0, 0.04, 0], 0.3, 0.33, 0.08, EBONY, { seg: 20 });
    k.cyl([0, 0.12, 0], 0.33, 0.37, 0.09, EBONY, { seg: 20 });
    k.ell([0, 0.165, 0], [0.37, 0.05, 0.37], EBONY, { ws: 20, hs: 6 });
    k.ell([0, 0.0, 0.26], [0.26, 0.022, 0.2], EBONY, { ws: 14, hs: 5, rot: [0.3, 0, 0], rough: 0.12 }); // the peak
    k.tor([0, 0.02, 0], 0.31, 0.018, GILT, { rot: [Math.PI / 2, 0, 0], rs: 22, ts: 5, rough: 0.3 });
    k.ell([0, 0.1, 0.34], [0.06, 0.05, 0.02], GILT, { ws: 8, hs: 5, rough: 0.3 }); // badge: a fouled anchor, near enough
    k.box([0, 0.1, 0.36], [0.014, 0.075, 0.012], EBONY, {}); k.tor([0, 0.075, 0.36], 0.03, 0.007, EBONY, { arc: Math.PI, rot: [0, 0, Math.PI], rs: 8, ts: 4 });
  });
  // the lashings: wrists, chest and waist
  k.to('ropes');
  const rope = 0x4a4234;
  for (const sd of [-1, 1]) {
    for (let j = 0; j < 3; j++) k.tor([sd * (0.66 + j * 0.02), H + 1.6 + j * 0.035, -0.1], 0.1, 0.024, rope, { rot: [Math.PI / 2 - 0.3, 0, sd * 0.5], rs: 10, ts: 4, rough: 0.8 });
    k.tube([[sd * 0.38, H + 1.52, 0.2], [0, H + 1.2, 0.44], [-sd * 0.36, H + 0.86, 0.26], [-sd * 0.3, H + 0.8, -0.2]], 0.026, rope, { sides: 6, rough: 0.8, budget: 120, noise: 0.06 });
  }
  for (let j = 0; j < 2; j++) k.tor([0, H + 0.5 + j * 0.06, 0.02], 0.355, 0.026, rope, { rot: [Math.PI / 2, 0, 0], rs: 18, ts: 4, rough: 0.8, sc: [1, 1.12, 1] });
  // what he falls to: a skull, a cage of ribs, the long bones
  const bone = (a, b, r = 0.03) => { k.tube([a, b], r, IVORY, { sides: 6, rough: 0.4, budget: 60 }); k.ell(a, [r * 1.7, r * 1.4, r * 1.6], IVORY, { ws: 6, hs: 4, rough: 0.4 }); k.ell(b, [r * 1.7, r * 1.4, r * 1.6], IVORY, { ws: 6, hs: 4, rough: 0.4 }); };
  k.to('skull');
  skull(k, 0.23, IVORY, false);
  k.to('ribs');
  for (let j = 0; j < 5; j++) k.tor([0, j * 0.075, 0], 0.2 - Math.abs(j - 2) * 0.025, 0.02, IVORY, { rot: [Math.PI / 2 + 0.25, 0, 0], rs: 14, ts: 5, rough: 0.4, arc: TAU * 0.86 });
  k.tube([[0, -0.06, -0.17], [0, 0.18, -0.2], [0, 0.4, -0.16]], 0.035, IVORY, { sides: 6, rough: 0.4, budget: 80 });
  k.to('limbs');
  bone([-0.42, 0.04, 0.1], [0.2, 0.04, -0.12]); bone([0.1, 0.05, 0.3], [0.52, 0.04, 0.02]); bone([-0.3, 0.1, -0.2], [0.26, 0.05, 0.22], 0.026);
  bone([-0.5, 0.04, -0.2], [-0.16, 0.12, 0.26], 0.024); bone([0.34, 0.04, -0.3], [0.56, 0.04, 0.3], 0.024);
  k.ell([0.05, 0.07, 0.02], [0.2, 0.07, 0.15], IVORY, { ws: 10, hs: 6, rough: 0.4 }); // the pelvis
  return {
    k, R, H, top: H + 2.75, hub,
    pivots: { wheel: hub, captain: [0, H, 0.08], cap: [0, H + 2.34, 0.13], ropes: [0, H + 1.2, 0] },
    hidden: ['skull', 'ribs', 'limbs'], free: ['skull', 'ribs', 'limbs'],
  };
}

function carveBride(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.queen;
  baseInto(k, R, H, seed);
  k.to('bride');
  // the gown: three scalloped flounces, a tight waist, a square neck
  const scallop = (n, amp) => (a, y) => 1 + amp * Math.abs(Math.sin((n * a) / 2)) + 0.03 * Math.sin(7 * a + y * 2);
  k.lathe([[0.3, H], [0.5, H + 0.01], [0.52, H + 0.06], [0.47, H + 0.14], [0.44, H + 0.34]], EBONY, { seg: 32, carve: scallop(16, 0.07) });
  k.lathe([[0.4, H + 0.3], [0.45, H + 0.32], [0.46, H + 0.38], [0.4, H + 0.46], [0.36, H + 0.66]], EBONY, { seg: 28, carve: scallop(14, 0.07) });
  k.lathe([[0.33, H + 0.62], [0.38, H + 0.64], [0.385, H + 0.7], [0.31, H + 0.82], [0.21, H + 1.06], [0.17, H + 1.2]], EBONY, { seg: 24, carve: scallop(12, 0.06) });
  k.lathe([[0.17, H + 1.18], [0.165, H + 1.26], [0.22, H + 1.42], [0.27, H + 1.58], [0.25, H + 1.66], [0.1, H + 1.72], [0.085, H + 1.86]], EBONY, { seg: 24, carve: (a, y) => 1 + (y > H + 1.3 && y < H + 1.6 ? 0.016 * Math.sin(y * 70) : 0) });
  k.tor([0, H + 1.21, 0], 0.175, 0.024, GILT, { rot: [Math.PI / 2, 0, 0], rs: 20, ts: 5, rough: 0.3 }); // girdle
  k.ell([0, H + 1.64, 0.2], [0.12, 0.06, 0.04], IVORY, { ws: 8, hs: 5, rough: 0.3 }); // the bare throat
  for (let i = 0; i < 7; i++) k.ell([Math.sin((i - 3) * 0.3) * 0.2, H + 1.67 - Math.cos((i - 3) * 0.3) * 0.05, 0.2 + Math.cos((i - 3) * 0.3) * 0.05], [0.016, 0.016, 0.012], GILT, { ws: 5, hs: 4, rough: 0.3 }); // a chain
  for (const sd of [-1, 1]) {
    k.ell([sd * 0.34, H + 1.56, 0], [0.16, 0.17, 0.16], EBONY, { ws: 12, hs: 8 }); // puffed sleeves
    k.tube([[sd * 0.38, H + 1.46, 0.02], [sd * 0.4, H + 1.2, 0.14], [sd * 0.16, H + 1.02, 0.36]], [0.08, 0.06, 0.045], EBONY, { sides: 8, budget: 160 });
    k.ell([sd * 0.1, H + 1.0, 0.4], [0.06, 0.04, 0.05], IVORY, { ws: 8, hs: 5, rough: 0.3 });
  }
  // a bouquet gone dead: tight carved roses, heads hanging
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU; const rr = i === 0 ? 0 : 0.085;
    k.group([Math.sin(a) * rr, H + 0.96 - (i % 3) * 0.035, 0.46 + Math.cos(a) * rr * 0.6], [0.6 + (i % 3) * 0.25, a, 0], () => {
      k.ell([0, 0, 0], [0.055, 0.045, 0.055], RED, { ws: 7, hs: 5, rough: 0.3 });
      k.tor([0, 0.012, 0], 0.035, 0.014, RED, { rot: [Math.PI / 2, 0, 0], rs: 8, ts: 4, rough: 0.3 });
    });
  }
  k.tube([[0, H + 0.94, 0.44], [0.01, H + 0.74, 0.47], [-0.02, H + 0.6, 0.49]], [0.035, 0.024, 0.014], EBONY, { sides: 5, budget: 60 });
  k.group([0, H + 2.14, 0.02], [-0.06, 0, 0], () => { // the head: fair, long-faced, the wrong smile
    k.ell([0, 0, 0], [0.31, 0.38, 0.33], IVORY, { ws: 20, hs: 14, rough: 0.28 });
    k.face(0.34, { skin: IVORY, eye: 0x1a0c0c, brow: -0.34, mouth: 'none', dark: 0x1c0d0d });
    k.tor([0, -0.1, 0.24], 0.13, 0.014, 0x3a1014, { arc: Math.PI * 0.62, rot: [0.15, 0, Math.PI + 0.6], rs: 10, ts: 4, rough: 0.3 }); // the smile
    for (const sd of [-1, 1]) k.cyl([sd * 0.055, -0.245, 0.3], 0.0, 0.014, 0.05, IVORY, { seg: 5, rough: 0.25 }); // small fangs
    // gilt hair: drawn back in heavy waves, falling behind
    k.ell([0, 0.1, -0.06], [0.335, 0.34, 0.34], GILT, { ws: 16, hs: 10, rough: 0.34 });
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i - 4) * 0.3;
      k.tube([[Math.sin(a) * 0.28, 0.08, Math.cos(a) * 0.28], [Math.sin(a) * 0.36, -0.36, Math.cos(a) * 0.34], [Math.sin(a) * 0.3, -0.84, Math.cos(a) * 0.32], [Math.sin(a) * 0.34, -1.2 - (i % 2) * 0.1, Math.cos(a) * 0.3]],
        [0.07, 0.075, 0.06, 0.02], GILT, { sides: 6, rough: 0.34, budget: 110, noise: 0.06 });
    }
  });
  // the veil, hung from the tiara down her back
  k.lathe([[0.37, H + 2.34], [0.42, H + 2.1], [0.47, H + 1.6], [0.56, H + 1.0], [0.66, H + 0.42], [0.7, H + 0.36]], 0x2c2a33,
    { seg: 30, arc: [Math.PI * 0.56, Math.PI * 0.88], rough: 0.55, carve: (a, y) => 1 + 0.035 * Math.sin(9 * a + y * 2) + (y < H + 0.44 ? 0.03 * Math.abs(Math.sin(12 * a)) : 0) });
  // the tiara: its own part, so it can fall
  k.to('tiara').group([0, H + 2.42, 0.03], [-0.1, 0, 0], () => {
    k.tor([0, 0, 0], 0.3, 0.022, GILT, { rot: [Math.PI / 2, 0, 0], rs: 28, ts: 5, rough: 0.26 });
    for (let i = -4; i <= 4; i++) {
      const a = i * 0.24; const h = 0.2 - Math.abs(i) * 0.03;
      k.cyl([Math.sin(a) * 0.3, h / 2, Math.cos(a) * 0.3], 0.03, 0.004, h, GILT, { seg: 5, rough: 0.26 });
      k.ell([Math.sin(a) * 0.3, h + 0.012, Math.cos(a) * 0.3], [0.02, 0.02, 0.02], i === 0 ? RED : PEARL, { ws: 6, hs: 5, rough: 0.12, glow: i === 0 ? 0.12 : 0 });
    }
  });
  // what is left of her
  k.to('dust').lathe([[R * 0.92, 0], [R + 0.5, 0], [R + 0.4, 0.05], [R + 0.16, 0.14], [R * 0.9, 0.2]], 0x55514a, { seg: 28, rough: 1, vary: 0.3, carve: (a) => 1 + 0.1 * Math.sin(3 * a + 1) + 0.05 * Math.sin(7 * a) });
  return { k, R, H, top: H + 2.75, pivots: { bride: [0, H, 0], tiara: [0, H + 2.42, 0.03] }, hidden: ['dust'] };
}

function carveLikeness(seed) {
  const k = carver(seed, EBONY); const { R, H } = PIECE_FOOT.king;
  baseInto(k, R, H, seed);
  // the stand: a turned pole on three feet, a cross-bar for shoulders, a blank wig-block for a head
  k.to('stand').lathe([[0.07, H], [0.09, H + 0.04], [0.05, H + 0.1], [0.045, H + 0.7], [0.07, H + 0.76], [0.07, H + 0.82], [0.045, H + 0.88], [0.04, H + 1.56], [0.065, H + 1.62], [0.065, H + 1.68], [0.035, H + 1.74], [0.035, H + 1.94]], EBONY, { seg: 12 });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; k.tube([[0, H + 0.22, 0], [Math.sin(a) * 0.16, H + 0.12, Math.cos(a) * 0.16], [Math.sin(a) * 0.3, H + 0.03, Math.cos(a) * 0.3]], [0.04, 0.035, 0.045], EBONY, { sides: 6, budget: 80 }); }
  k.lathe([[0.03, -0.56], [0.05, -0.52], [0.045, -0.46], [0.04, 0], [0.045, 0.46], [0.05, 0.52], [0.03, 0.56], [0, 0.565]], EBONY, { seg: 10, at: [0, H + 1.66, 0], rot: [0, 0, Math.PI / 2] });
  k.ell([0, H + 2.16, 0], [0.21, 0.27, 0.23], EBONY, { ws: 18, hs: 12, rough: 0.14 }); // nobody: a block, polished blank
  // the cloak: a standing collar, the cape in deep folds, open down the front on a red lining
  const gap = 0.52;
  k.to('cloak').lathe([[0.56, H + 1.2], [0.52, H + 1.5], [0.46, H + 1.7], [0.42, H + 1.78], [0.3, H + 1.84], [0.2, H + 1.86]], SHADE, { seg: 40, arc: [gap * 0.5, TAU - gap], rough: 0.36, carve: folds(7, 0.05, 1.5) });
  k.lathe([[0.74, H + 0.04], [0.77, H + 0.1], [0.7, H + 0.5], [0.62, H + 0.95], [0.56, H + 1.2]], SHADE, { seg: 40, arc: [gap, TAU - gap * 2], rough: 0.36, carve: folds(7, 0.07, 1.5) });
  k.lathe([[0.72, H + 0.06], [0.74, H + 0.1], [0.67, H + 0.5], [0.59, H + 0.95], [0.53, H + 1.2], [0.49, H + 1.5], [0.43, H + 1.7]], RED, { seg: 40, arc: [gap, TAU - gap * 2], rough: 0.3, glow: 0.05, carve: folds(7, 0.07, 1.5) });
  k.lathe([[0.3, H + 1.78], [0.4, H + 1.9], [0.5, H + 2.2], [0.56, H + 2.5], [0.57, H + 2.56]], SHADE, { seg: 30, arc: [1.0, TAU - 2.0], rough: 0.36, carve: (a, y) => 1 + (y > H + 2.3 ? 0.07 * Math.abs(Math.sin(a * 5)) : 0) });
  k.lathe([[0.29, H + 1.8], [0.385, H + 1.9], [0.485, H + 2.2], [0.545, H + 2.5]], RED, { seg: 30, arc: [1.0, TAU - 2.0], rough: 0.3, glow: 0.05 });
  for (const sd of [-1, 1]) k.ell([sd * 0.2, H + 1.8, 0.36], [0.06, 0.06, 0.03], GILT, { ws: 8, hs: 5, rough: 0.3 }); // clasps
  for (let i = 0; i <= 8; i++) { const t = i / 8 - 0.5; k.ell([t * 0.38, H + 1.78 - 0.07 * (1 - 4 * t * t), 0.39], [0.022, 0.016, 0.014], GILT, { ws: 5, hs: 4, rough: 0.3 }); } // the chain between them
  // the crown: its own part
  k.to('crown').group([0, H + 2.4, 0], null, () => {
    k.lathe([[0.2, 0], [0.22, 0.02], [0.2, 0.05], [0.2, 0.1], [0.23, 0.13], [0.21, 0.15]], GILT, { seg: 24, rough: 0.24, carve: (a, y) => (y > 0.04 && y < 0.1 ? 1 + 0.035 * Math.abs(Math.sin(4 * a)) : 1) });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      k.cyl([Math.sin(a) * 0.21, 0.24, Math.cos(a) * 0.21], 0.035, 0.006, 0.2, GILT, { seg: 5, rough: 0.24, rot: [Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2] });
      k.ell([Math.sin(a) * 0.235, 0.35, Math.cos(a) * 0.235], [0.024, 0.024, 0.024], i % 2 ? RED : PEARL, { ws: 6, hs: 5, rough: 0.12, glow: i % 2 ? 0.12 : 0 });
    }
    for (let i = 0; i < 4; i++) k.tor([0, 0.14, 0], 0.2, 0.014, GILT, { arc: Math.PI, rot: [0, (i / 4) * Math.PI, 0], rs: 12, ts: 4, rough: 0.24 });
    k.ell([0, 0.37, 0], [0.045, 0.045, 0.045], GILT, { ws: 8, hs: 6, rough: 0.2 });
    for (const sd of [-1, 1]) k.tube([[0, 0.4, 0], [sd * 0.07, 0.5, 0], [sd * 0.15, 0.47, 0], [sd * 0.1, 0.43, 0]], [0.012, 0.022, 0.02, 0.006], GILT, { sides: 4, budget: 40, rough: 0.24 }); // a finial of two small wings
  });
  return { k, R, H, top: H + 3.0, pivots: { stand: [0, H, 0], cloak: [0, H, 0], crown: [0, H + 2.4, 0] }, hidden: [] };
}

// ---- the white pieces (they only watch) ------------------------------------------------------------

function carveTurtle(seed) {
  // shell and body rubbed smooth: its carving is the scutes and ridges cut in the form, not nicks
  const k = carver(seed, IVORY, 0.64); const { R, H } = PIECE_FOOT.turtle;
  baseInto(k, R, H, seed);
  k.to('figure');
  k.ell([0, H + 0.16, 0], [0.5, 0.2, 0.44], IVORY, { ws: 14, hs: 8, vary: 0.1 }); // the rock it sits on
  k.ell([0.24, H + 0.12, 0.3], [0.22, 0.14, 0.2], IVORY, { ws: 10, hs: 6, vary: 0.1 });
  // the shell: a domed carapace on the back, a ridged plastron in front
  k.ell([0, H + 1.0, -0.16], [0.5, 0.66, 0.34], IVORY, { ws: 22, hs: 14 });
  k.ell([0, H + 0.98, 0.02], [0.4, 0.56, 0.26], 0xd8cfb6, { ws: 18, hs: 12 });
  for (let j = 0; j < 4; j++) k.tor([0, H + 0.62 + j * 0.23, 0.25 - Math.abs(j - 1.5) * 0.035], 0.25 - Math.abs(j - 1.5) * 0.05, 0.018, 0xbdb39a, { arc: Math.PI, rot: [0, 0, 0], rs: 12, ts: 4, sc: [1, 0.25, 1] });
  k.box([0, H + 0.98, 0.285], [0.016, 0.9, 0.016], 0xbdb39a, {});
  for (let j = 0; j < 3; j++) for (let i = -1; i <= 1; i++) { // scutes, each a low boss with a rim
    if (j !== 1 && i !== 0 && j === 2) continue;
    const y = H + 0.62 + j * 0.37; const x = i * 0.27 * (j === 1 ? 1 : 0.8); const z = -0.16 - 0.34 * Math.sqrt(Math.max(0.05, 1 - (x / 0.5) ** 2 - ((y - H - 1.0) / 0.66) ** 2));
    k.ell([x, y, z], [0.13, 0.17, 0.03], 0xd8cfb6, { ws: 6, hs: 4 });
    k.tor([x, y, z - 0.005], 0.145, 0.014, 0xbdb39a, { rs: 6, ts: 4, sc: [1, 1.3, 1] });
  }
  k.tor([0, H + 1.0, -0.14], 0.5, 0.035, IVORY, { rs: 30, ts: 6, sc: [1, 1.31, 1] }); // the shell's rim
  // calf's hind hooves under the shell, and a calf's tail
  for (const sd of [-1, 1]) {
    k.tube([[sd * 0.28, H + 0.5, 0.1], [sd * 0.34, H + 0.36, 0.34], [sd * 0.33, H + 0.2, 0.42]], [0.09, 0.07, 0.06], IVORY, { sides: 8, budget: 140 });
    k.cyl([sd * 0.33, H + 0.13, 0.43], 0.075, 0.06, 0.1, 0xbdb39a, { seg: 8 });
    k.box([sd * 0.33, H + 0.13, 0.5], [0.012, 0.1, 0.03], 0x3a3128, {});
  }
  k.tube([[0.3, H + 0.5, -0.3], [0.5, H + 0.4, -0.36], [0.56, H + 0.2, -0.3]], [0.03, 0.022, 0.02], IVORY, { sides: 5, budget: 60 });
  k.ell([0.56, H + 0.13, -0.3], [0.045, 0.08, 0.045], 0xd8cfb6, { ws: 6, hs: 5 });
  // both flippers brought up over the face: it weeps into them
  for (const sd of [-1, 1]) {
    k.tube([[sd * 0.44, H + 1.36, 0.02], [sd * 0.56, H + 1.5, 0.4], [sd * 0.36, H + 1.76, 0.62], [sd * 0.12, H + 1.98, 0.62]], [[0.1, 0.05], [0.15, 0.045], [0.17, 0.04], [0.13, 0.035]], IVORY, { sides: 8, detail: 3, budget: 260 });
    for (let f = -1; f <= 1; f++) k.box([sd * 0.1 + f * 0.07, H + 2.06, 0.63], [0.012, 0.16, 0.02], 0x3a3128, { rot: [0, 0, f * 0.2] }); // the flipper's scored end
  }
  // the neck, wrinkled, and the calf's head: oversized, hung, the eyes brimming
  k.lathe([[0.2, H + 1.46], [0.19, H + 1.56], [0.16, H + 1.66], [0.17, H + 1.76]], IVORY, { seg: 16, carve: (a, y) => 1 + 0.04 * Math.sin(y * 60) });
  k.group([0, H + 1.94, 0.16], [0.62, 0, 0.05], () => {
    k.ell([0, 0, 0], [0.33, 0.33, 0.36], IVORY, { ws: 20, hs: 14 });
    k.ell([0, -0.14, 0.34], [0.23, 0.19, 0.25], IVORY, { ws: 14, hs: 10 }); // the muzzle
    k.ell([0, -0.18, 0.56], [0.17, 0.11, 0.06], 0xd8cfb6, { ws: 10, hs: 6 });
    for (const sd of [-1, 1]) {
      k.ell([sd * 0.07, -0.16, 0.598], [0.035, 0.022, 0.012], 0xc4bba3, { ws: 6, hs: 4 }); // nostrils: shallow dents in the ivory, nothing dark
      k.ell([sd * 0.24, 0.1, 0.25], [0.085, 0.085, 0.06], 0x2a2420, { ws: 10, hs: 8, rough: 0.08 }); // great wet eyes
      k.ell([sd * 0.24, 0.165, 0.26], [0.1, 0.05, 0.065], IVORY, { ws: 8, hs: 5, rot: [0.25, 0, -sd * 0.3] }); // heavy lids, drawn down at the outside
      k.tube([[sd * 0.3, 0.2, -0.02], [sd * 0.52, 0.24, -0.04], [sd * 0.66, 0.12, -0.02]], [[0.05, 0.03], [0.11, 0.035], [0.02, 0.01]], IVORY, { sides: 7, budget: 100 }); // ears, drooped
      k.tube([[sd * 0.16, 0.28, 0.02], [sd * 0.2, 0.42, 0.0], [sd * 0.17, 0.5, 0.02]], [0.05, 0.035, 0.012], 0xd8cfb6, { sides: 6, budget: 60 }); // horn buds
      // tears: a string of drops down each cheek, and one hanging from the jaw
      for (let j = 0; j < 5; j++) k.ell([sd * (0.25 - j * 0.012), 0.0 - j * 0.085, 0.3 + j * 0.035], [0.022 + j * 0.003, 0.034 + j * 0.004, 0.02], PEARL, { ws: 7, hs: 6, rough: 0.05, vary: 0 });
      k.ell([sd * 0.19, -0.44, 0.44], [0.028, 0.05, 0.028], PEARL, { ws: 7, hs: 6, rough: 0.05, vary: 0 });
    }
    k.ell([0, -0.29, 0.44], [0.15, 0.022, 0.1], 0x3a3128, { ws: 8, hs: 4, rough: 0.9, rot: [0.2, 0, 0] }); // the mouth, turned down
    k.ell([0, 0.3, 0.12], [0.12, 0.08, 0.14], 0xd8cfb6, { ws: 8, hs: 5 }); // a curl of hair on the poll
  });
  return { k, R, H, top: H + 2.6 };
}

function carveDormouse(seed) {
  const k = carver(seed, IVORY); const { R, H } = PIECE_FOOT.dormouse;
  baseInto(k, R, H, seed);
  k.to('figure');
  // a tasselled cushion, and the dormouse slumped on it as if dead
  k.ell([0, H + 0.13, 0], [0.5, 0.16, 0.46], RED, { ws: 18, hs: 8, rough: 0.5 });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.78; k.ell([Math.sin(a) * 0.5, H + 0.1, Math.cos(a) * 0.46], [0.05, 0.08, 0.05], GILT, { ws: 6, hs: 5, rough: 0.35 }); }
  k.tube([[-0.04, H + 0.2, -0.04], [0.08, H + 0.58, -0.02], [0.3, H + 0.94, 0.04], [0.5, H + 1.12, 0.1]], [[0.4, 0.38], [0.46, 0.42], [0.36, 0.32], [0.2, 0.2]], IVORY, { sides: 16, detail: 3, budget: 900, noise: 0.03, caps: ['flat', 'round'] });
  for (let j = 0; j < 4; j++) k.tor([0.01 + j * 0.01, H + 0.36 + j * 0.16, 0.36 - j * 0.02], 0.2 - j * 0.02, 0.012, 0xd8cfb6, { arc: Math.PI * 0.8, rot: [-0.2, 0, Math.PI * 1.1], rs: 10, ts: 4 }); // the fur of the belly, in rows
  for (const sd of [-1, 1]) { // paws: limp at its sides, palms up; feet stuck out in front
    k.tube([[sd * 0.34, H + 1.08, 0.06], [sd * 0.5, H + 0.74, 0.16], [sd * 0.5, H + 0.42, 0.26]], [0.09, 0.07, 0.05], IVORY, { sides: 8, budget: 150 });
    k.ell([sd * 0.5, H + 0.36, 0.3], [0.06, 0.03, 0.07], 0xd8cfb6, { ws: 8, hs: 5 });
    for (let f = -1; f <= 1; f++) k.ell([sd * 0.5 + f * 0.035, H + 0.37, 0.37], [0.014, 0.014, 0.03], 0xd8cfb6, { ws: 5, hs: 4 });
    k.ell([sd * 0.24, H + 0.3, 0.44], [0.09, 0.07, 0.16], IVORY, { ws: 10, hs: 6 });
    for (let f = -1; f <= 1; f++) k.ell([sd * 0.24 + f * 0.045, H + 0.3, 0.6], [0.02, 0.02, 0.035], 0xd8cfb6, { ws: 5, hs: 4 });
  }
  // the tail, let fall down round the base's collar
  k.tube([[-0.2, H + 0.3, -0.36], [-0.5, H + 0.2, -0.3], [-0.62, H - 0.02, 0.0], [-0.46, H - 0.14, 0.34], [-0.1, H - 0.2, 0.46], [0.16, H - 0.25, 0.4]], [0.05, 0.045, 0.04, 0.035, 0.028, 0.02], IVORY, { sides: 7, detail: 3, budget: 300 });
  // the neck, bared and stretched, and the head: oversized, hung right over the edge, lower than the shoulder
  k.tube([[0.46, H + 1.1, 0.1], [0.62, H + 1.08, 0.12], [0.76, H + 0.94, 0.14]], [0.19, 0.16, 0.19], IVORY, { sides: 10, budget: 200 });
  k.group([0.92, H + 0.74, 0.16], [0.25, 0.25, -1.9], () => {
    k.ell([0, 0, 0], [0.37, 0.34, 0.36], IVORY, { ws: 20, hs: 14 });
    k.tube([[0, -0.04, 0.26], [0, -0.06, 0.46], [0, -0.07, 0.6]], [[0.2, 0.16], [0.13, 0.1], [0.05, 0.045]], IVORY, { sides: 10, budget: 240 }); // the snout
    k.ell([0, -0.06, 0.63], [0.04, 0.035, 0.035], 0x8f8a7c, { ws: 7, hs: 5, rough: 0.7 }); // the nose, dry
    for (const sd of [-1, 1]) {
      // each eye shut: one smooth lid closed down onto the cheek, and the shallow line where it meets it
      k.ell([sd * 0.2, 0.06, 0.26], [0.1, 0.085, 0.07], IVORY, { ws: 10, hs: 7 });
      k.tor([sd * 0.2, 0.05, 0.3], 0.085, 0.007, 0xb8b09c, { arc: Math.PI, rot: [0.25, sd * 0.4, Math.PI], rs: 10, ts: 4 });
      k.group([sd * 0.3, 0.3, -0.06], [0, sd * 0.45, sd * -0.5], () => { // round ears, gone slack: ivory, with a carved rim
        k.ell([0, 0, 0], [0.19, 0.19, 0.035], IVORY, { ws: 14, hs: 6 });
        k.ell([0, 0, 0.02], [0.13, 0.13, 0.03], 0xd8cfb6, { ws: 12, hs: 5 });
        k.tor([0, 0, 0.005], 0.185, 0.02, IVORY, { rs: 16, ts: 5 });
      });
      for (let wk = -1; wk <= 1; wk++) k.tube([[sd * 0.07, -0.06, 0.54], [sd * 0.3, -0.1 + wk * 0.07, 0.56], [sd * 0.46, -0.24 + wk * 0.1, 0.5]], [0.007, 0.006, 0.003], 0x6a6354, { sides: 3, budget: 16 }); // whiskers, drooped
    }
    // the jaw hangs: the mouth a little open, two teeth above, the lower jaw fallen away from them
    for (const sd of [-1, 1]) k.box([sd * 0.017, -0.17, 0.52], [0.026, 0.06, 0.014], 0xd8cfb6, {});
    k.tube([[0, -0.2, 0.2], [0, -0.31, 0.38], [0, -0.33, 0.5]], [[0.1, 0.04], [0.085, 0.03], [0.035, 0.02]], IVORY, { sides: 8, budget: 120 });
  });
  // one forepaw trails down past the cushion on the side it has fallen to
  k.tube([[0.6, H + 0.9, 0.2], [0.82, H + 0.5, 0.3], [0.86, H + 0.12, 0.3]], [0.085, 0.065, 0.045], IVORY, { sides: 8, budget: 150 });
  k.ell([0.86, H + 0.05, 0.3], [0.05, 0.07, 0.05], 0xd8cfb6, { ws: 8, hs: 5 });
  // the bite: two punctures in the bared neck, and the blood run down from them in red lacquer
  for (const dz of [-0.05, 0.05]) {
    k.ell([0.6, H + 1.23, 0.17 + dz], [0.03, 0.03, 0.02], 0x2a0406, { ws: 8, hs: 6, rough: 0.3, vary: 0 });
    k.tor([0.6, H + 1.24, 0.17 + dz], 0.034, 0.009, RED, { rs: 10, ts: 4, rough: 0.16, rot: [Math.PI / 2, 0, 0] });
    k.tube([[0.6, H + 1.22, 0.2 + dz], [0.5, H + 1.0, 0.3 + dz * 1.3], [0.28, H + 0.74 + dz * 2, 0.4 + dz], [0.16, H + 0.56 + dz * 3, 0.43 + dz]], [0.018, 0.022, 0.018, 0.026], RED, { sides: 6, rough: 0.14, budget: 90, glow: 0.04 });
  }
  k.ell([0.12, H + 0.44, 0.45], [0.05, 0.07, 0.02], RED, { ws: 8, hs: 6, rough: 0.14 });
  return { k, R, H, top: H + 2.1 };
}

function carveDuchess(seed) {
  const k = carver(seed, IVORY); const { R, H } = PIECE_FOOT.duchess;
  baseInto(k, R, H, seed);
  k.to('figure');
  const fur = (n) => (a, y) => 1 + 0.035 * Math.abs(Math.sin((n * a) / 2)) + 0.02 * Math.sin(5 * a + y * 2);
  // the gown: a furred hem, a stiff bell of a skirt cut with a lozenge diaper, a tight bodice
  k.lathe([[0.3, H], [0.56, H + 0.01], [0.6, H + 0.07], [0.6, H + 0.15], [0.55, H + 0.2]], IVORY, { seg: 33, carve: (a) => 1 + 0.03 * Math.abs(Math.sin(11 * a)) });
  k.lathe([[0.53, H + 0.2], [0.5, H + 0.5], [0.42, H + 0.86], [0.3, H + 1.14], [0.24, H + 1.24]], IVORY,
    { seg: 33, carve: (a, y) => 1 + 0.018 * Math.sign(Math.sin(a * 11 + y * 14) * Math.sin(a * 11 - y * 14)) + 0.03 * Math.sin(5 * a) });
  k.lathe([[0.24, H + 1.22], [0.23, H + 1.3], [0.29, H + 1.5], [0.36, H + 1.7], [0.33, H + 1.8], [0.2, H + 1.86]], IVORY, { seg: 28, carve: (a) => 1 - 0.1 * Math.max(0, -Math.cos(a)) });
  k.tor([0, H + 1.24, 0], 0.25, 0.03, GILT, { rot: [Math.PI / 2, 0, 0], rs: 22, ts: 5, rough: 0.3 });
  for (let i = 0; i < 5; i++) k.ell([0, H + 1.34 + i * 0.09, 0.27 + i * 0.022], [0.026, 0.026, 0.016], GILT, { ws: 6, hs: 4, rough: 0.28 });
  // the ruff, goffered, and above it nothing: the neck cut clean, lacquered red
  k.lathe([[0.16, H + 1.84], [0.48, H + 1.82], [0.52, H + 1.88], [0.48, H + 1.95], [0.16, H + 1.93]], IVORY, { seg: 32, carve: (a, y) => 1 + 0.07 * Math.sin(8 * a) * (y > H + 1.83 && y < H + 1.94 ? 1 : 0.3) });
  k.cyl([0, H + 1.99, 0], 0.11, 0.105, 0.12, IVORY, { seg: 14 });
  k.ell([0, H + 2.05, 0], [0.105, 0.016, 0.105], RED, { ws: 12, hs: 4, rough: 0.14, glow: 0.03 });
  k.ell([0, H + 2.058, 0], [0.035, 0.014, 0.035], IVORY, { ws: 8, hs: 4 }); // the bone
  for (const [x, z, l] of [[0.1, 0.03, 0.2], [-0.07, 0.085, 0.3], [0.02, -0.1, 0.16]]) k.tube([[x, H + 2.03, z], [x * 1.25, H + 1.96, z * 1.25], [x * 1.3, H + 1.96 - l, z * 1.35]], [0.016, 0.02, 0.012], RED, { sides: 5, rough: 0.14, budget: 50 });
  // enormous sleeves
  for (const sd of [-1, 1]) {
    k.ell([sd * 0.46, H + 1.6, 0], [0.24, 0.28, 0.24], IVORY, { ws: 14, hs: 10 });
    for (let j = 0; j < 5; j++) k.tor([sd * 0.46, H + 1.6, 0], 0.245, 0.012, 0xd8cfb6, { rot: [0, (j / 5) * Math.PI, 0], rs: 14, ts: 4, sc: [1, 1.16, 1] }); // slashed panes
    k.tor([sd * 0.52, H + 1.34, 0.08], 0.1, 0.035, 0xd8cfb6, { rot: [Math.PI / 2, 0, 0], rs: 12, ts: 5 });
  }
  // her left arm crooks round her own head, carried at the hip; her right holds the pepper-pot
  k.tube([[-0.52, H + 1.34, 0.08], [-0.84, H + 1.12, 0.18], [-0.9, H + 0.8, 0.46], [-0.66, H + 0.6, 0.68]], [0.085, 0.075, 0.065, 0.055], IVORY, { sides: 8, budget: 200 });
  k.ell([-0.58, H + 0.6, 0.72], [0.07, 0.05, 0.045], 0xd8cfb6, { ws: 8, hs: 5 });
  k.tube([[0.52, H + 1.34, 0.08], [0.62, H + 1.06, 0.3], [0.46, H + 1.06, 0.52]], [0.085, 0.07, 0.055], IVORY, { sides: 8, budget: 160 });
  k.ell([0.42, H + 1.07, 0.56], [0.06, 0.06, 0.055], 0xd8cfb6, { ws: 8, hs: 5 });
  k.lathe([[0.05, 0], [0.065, 0.02], [0.06, 0.14], [0.075, 0.16], [0.06, 0.2], [0.03, 0.235], [0, 0.24]], GILT, { seg: 10, rough: 0.28, at: [0.42, H + 1.1, 0.57] });
  // the head: oversized, scowling, in a two-horned headdress with its veil
  k.group([-0.7, H + 0.9, 0.36], [0.05, -0.3, 0.3], () => {
    k.ell([0, 0, 0], [0.36, 0.37, 0.36], IVORY, { ws: 20, hs: 14 });
    k.ell([0, -0.2, 0.14], [0.3, 0.22, 0.26], IVORY, { ws: 14, hs: 10 }); // heavy jowls
    k.face(0.37, { skin: IVORY, mouth: 'frown', brow: -0.42 });
    k.ell([0, -0.02, 0.4], [0.1, 0.1, 0.1], IVORY, { ws: 10, hs: 8 }); // the nose, a knob
    k.ell([0, 0.3, -0.04], [0.37, 0.16, 0.36], 0xd8cfb6, { ws: 16, hs: 6 }); // the cap's roll
    for (const sd of [-1, 1]) {
      k.tube([[sd * 0.16, 0.34, -0.04], [sd * 0.36, 0.5, -0.06], [sd * 0.5, 0.7, -0.04]], [[0.19, 0.18], [0.15, 0.14], [0.05, 0.05]], IVORY, { sides: 10, detail: 3, budget: 300 });
      for (let j = 0; j < 3; j++) k.tor([sd * (0.24 + j * 0.08), 0.42 + j * 0.09, -0.05], 0.17 - j * 0.035, 0.012, GILT, { rot: [Math.PI / 2, 0, sd * 0.55], rs: 12, ts: 4, rough: 0.3 });
    }
    k.lathe([[0.1, 0.56], [0.3, 0.42], [0.38, 0.1], [0.42, -0.3], [0.44, -0.36]], 0xd8cfb6, { seg: 20, arc: [Math.PI * 0.62, Math.PI * 0.76], rough: 0.5, carve: folds(5, 0.05, 2) });
    k.ell([0, -0.36, 0], [0.13, 0.03, 0.13], RED, { ws: 10, hs: 4, rough: 0.14 }); // where it came off
  });
  return { k, R, H, top: H + 2.12 };
}

// ---- the Gryphon: the white knight, fallen off the board and broken (a prop, never a chessman) ----

/**
 * One eagle's wing carved flat in ivory: its root at the origin, its leading edge along +x, its
 * feathers trailing toward +z, its top face +y. n primaries fanned from the wrist (long, each with
 * its quill cut down it unless folded), the secondaries along the arm and the coverts over them.
 */
function wingInto(k, n, span = 1, folded = false) {
  const D = 0xd8cfb6; const DK = 0x3a3128;
  k.tube([[0, 0, 0], [0.3 * span, 0.01, -0.03], [0.55 * span, 0, 0.0]], [0.06, 0.045, 0.032], IVORY, { sides: 6, budget: 40 }); // the arm
  k.ell([0.28 * span, 0.012, 0.11], [0.3 * span, 0.03, 0.13], D, { ws: 7, hs: 4 }); // the coverts
  for (let i = 0; i < n; i++) { // the primaries, longest at the leading edge
    const a = (folded ? 0.05 : 0.12) + (i / Math.max(1, n - 1)) * (folded ? 0.3 : 0.75); const L = (0.62 - i * 0.05) * span;
    const c = [0.55 * span + Math.cos(a) * L * 0.5, -0.004 * i, Math.sin(a) * L * 0.5];
    k.ell(c, [L * 0.5, 0.016, 0.05], i % 2 ? D : IVORY, { ws: 5, hs: 3, rot: [0, -a, 0] });
    if (!folded) k.box([c[0], c[1] + 0.016, c[2]], [L * 0.8, 0.008, 0.008], DK, { rot: [0, -a, 0], rough: 0.9 }); // the quill
  }
  for (let i = 0; i < (folded ? 1 : 3); i++) k.ell([(0.12 + i * 0.16) * span, -0.01, 0.2], [0.075, 0.014, 0.18], i % 2 ? IVORY : D, { ws: 5, hs: 3, rot: [0, 0.15 - i * 0.1, 0] }); // the secondaries
}

/**
 * carveGryphon(seed) -> { parts: { body, head, wing, beak, claw, plume } }: the white set's
 * knight, the Gryphon (Alice's Adventures in Wonderland, ch. 9 and 10, as Tenniel drew him), carved
 * in the white pieces' ivory and found broken, each piece one fused geometry (position, normal,
 * colour, fin) in its own frame, for the wreck on the Knight's Walk's floor (vampkit.js wreck). He
 * is a prop: never stood on the board, never one of the game's chessmen.
 *   body   sejant on what is left of the base's platform: the lion's haunches and great thighs, the
 *          hind paws, the breast thrust out, the tail raised in a curve with its tuft at the top, the
 *          eagle's forelegs with gilt talons, the shaggy ruff, the left wing half raised up and back;
 *          the neck and the right wing snapped off in rough breaks. y 0 is the platform's top,
 *          the front +z, his left +x.
 *   head   the eagle's head: the hooked beak a little agape (gilt at the hook), the bristling crest
 *          and ear tufts, a sleepy eye under a heavy lid, one pearl tear; snapped at the neck.
 *          Centred on the skull, the beak toward +z, up +y.
 *   wing   the right wing, snapped at the shoulder and lying open (wingInto's frame).
 *   beak, claw, plume  chips: the gilt tip of the beak, a talon, a crest feather.
 */
export function carveGryphon(seed = 7) {
  const k = carver(seed, IVORY); // (no base of his own: the wreck turns the stub of the knight's, vampkit.js)
  const D = 0xd8cfb6; const DK = 0x3a3128; const BRK = 0xcdc2a6; // the carving's shades; a fresh break, duller
  const up = (e) => e - Math.PI / 2; // rotX that turns +y to (0, sin e, -cos e)
  k.to('body');
  // the base's platform, snapped off its neck under him
  k.lathe([[0, -0.08], [0.3, -0.08], [0.336, -0.045], [0.336, 0], [0, 0]], IVORY, { seg: 10, color: (y, a, c) => c.setHex(y < -0.07 ? BRK : IVORY) });
  // the lion's haunches, sat down: a broad rump, each thigh a great bulge forward along his flank, the hind paws out in front
  k.ell([0, 0.25, -0.14], [0.3, 0.26, 0.34], IVORY, { ws: 8, hs: 6 });
  for (const sd of [-1, 1]) {
    k.ell([sd * 0.25, 0.24, -0.02], [0.11, 0.22, 0.3], IVORY, { ws: 7, hs: 5, rot: [0.6, 0, 0] }); // the thigh
    k.ell([sd * 0.25, 0.05, 0.2], [0.08, 0.05, 0.13], D, { ws: 5, hs: 3 });
  }
  // the breast, rising to the neck, thrust out proud in front of the forelegs
  k.tube([[0, 0.2, -0.05], [0, 0.55, 0.1], [0, 0.85, 0.16]], [[0.25, 0.27], [0.23, 0.28], [0.17, 0.2]], IVORY, { sides: 10, budget: 100, caps: ['flat', 'flat'] });
  k.ell([0, 0.6, 0.22], [0.2, 0.24, 0.17], IVORY, { ws: 7, hs: 5 });
  // the ruff: a shaggy collar of locks round the neck, and the neck snapped off above it
  k.lathe([[0.15, -0.07], [0.27, -0.01], [0.25, 0.06], [0.15, 0.11]], IVORY, { seg: 14, at: [0, 0.78, 0.1], rot: [0.3, 0, 0], carve: (a) => 1 + 0.14 * Math.abs(Math.sin(4 * a)) });
  k.cyl([0, 0.94, 0.15], 0.14, 0.12, 0.16, D, { seg: 10, rot: [0.3, 0, 0] });
  k.ell([0, 1.02, 0.18], [0.12, 0.035, 0.12], BRK, { ws: 6, hs: 3, rot: [0.3, 0, 0], vary: 0.3, rough: 0.9 });
  for (let i = 0; i < 3; i++) { const a = i * 2.1; k.cyl([Math.sin(a) * 0.08, 1.04, 0.18 + Math.cos(a) * 0.08], 0.035, 0.0, 0.07, BRK, { seg: 3, rot: [0.3 + Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3], rough: 0.9 }); } // its jags
  // the eagle's forelegs, straight down to the platform clear of the breast, scaled at the shin; three talons forward, gilt at the points
  for (const sd of [-1, 1]) {
    k.tube([[sd * 0.14, 0.66, 0.18], [sd * 0.15, 0.36, 0.3], [sd * 0.14, 0.06, 0.32]], [0.09, 0.065, 0.055], IVORY, { sides: 6, budget: 50 });
    k.ell([sd * 0.14, 0.03, 0.36], [0.065, 0.032, 0.065], D, { ws: 5, hs: 3 });
    for (let t = -1; t <= 1; t++) {
      k.cyl([sd * 0.14 + t * 0.04, 0.025, 0.44], 0.024, 0.013, 0.12, D, { seg: 3, rot: [Math.PI / 2, 0, -t * 0.35] });
      k.cyl([sd * 0.14 + t * 0.06, 0.02, 0.52], 0.014, 0.0, 0.06, GILT, { seg: 3, rot: [Math.PI / 2 + 0.6, 0, -t * 0.35], rough: 0.3 });
    }
  }
  // the lion's tail, raised from the rump in a curve up behind him, its great tuft at the top
  k.tube([[0, 0.16, -0.42], [0.04, 0.3, -0.62], [0.06, 0.6, -0.68], [0.06, 0.84, -0.56]], 0.05, IVORY, { sides: 5, budget: 60 });
  k.ell([0.06, 0.93, -0.5], [0.08, 0.12, 0.08], D, { ws: 5, hs: 4, rot: [-0.5, 0, 0] });
  // the left wing, half raised up and back off the shoulder; where the right one was, a rough stump
  k.group([0.24, 0.8, -0.1], [-1.2, Math.PI, Math.PI / 2], () => wingInto(k, 3, 0.85, true));
  k.cyl([-0.19, 0.72, -0.12], 0.08, 0.06, 0.1, IVORY, { seg: 6, rot: [0, 0, Math.PI / 2] });
  k.ell([-0.24, 0.72, -0.12], [0.02, 0.07, 0.065], BRK, { ws: 5, hs: 3, vary: 0.3, rough: 0.9 });

  k.to('head');
  k.ell([0, 0, 0], [0.19, 0.2, 0.23], IVORY, { ws: 10, hs: 7 }); // the skull
  for (const sd of [-1, 1]) {
    k.ell([sd * 0.16, 0.025, 0.09], [0.045, 0.05, 0.045], DK, { ws: 5, hs: 4, rough: 0.1 }); // the eye, set in the side
    k.ell([sd * 0.165, 0.07, 0.095], [0.05, 0.026, 0.055], IVORY, { ws: 5, hs: 3, rot: [0.25, 0, -sd * 0.2] }); // its heavy lid, half down: sleepy, and sardonic
    k.ell([sd * 0.12, 0.11, 0.1], [0.07, 0.035, 0.13], IVORY, { ws: 5, hs: 3, rot: [0, sd * 0.25, -sd * 0.35] }); // the brow
    // the ear tufts, laid back
    k.cyl([sd * 0.11, 0.17, -0.1], 0.04, 0.0, 0.2, D, { seg: 5, rot: [up(0.7), 0, -sd * 0.35] });
  }
  // one pearl tear on his cheek, run from under the lid (he sobs, the book says, though he has no sorrow)
  // (a warm pearl, the ivory's own white: under the walk's moon grade the set's blue PEARL read as a blue streak)
  k.ell([-0.172, -0.06, 0.1], [0.016, 0.028, 0.014], 0xfbf3df, { ws: 5, hs: 4, rough: 0.05, vary: 0 });
  // the hooked beak, agape: the upper bill horn-pale, gilt at the hook; the cere where it meets the face
  k.tor([0, 0.02, 0.17], 0.09, 0.022, D, { rs: 8, ts: 3 });
  k.tube([[0, 0.03, 0.17], [0, 0.03, 0.32], [0, -0.01, 0.44], [0, -0.08, 0.5]], [[0.085, 0.09], [0.065, 0.065], [0.045, 0.04], [0.03, 0.03]], D, { sides: 7, budget: 90, caps: ['flat', 'round'] });
  k.tube([[0, -0.06, 0.49], [0, -0.13, 0.5], [0, -0.18, 0.46]], [0.03, 0.022, 0.006], GILT, { sides: 5, budget: 40, rough: 0.3 });
  k.tube([[0, -0.09, 0.14], [0, -0.13, 0.28], [0, -0.15, 0.38]], [0.065, 0.04, 0.014], D, { sides: 6, budget: 50 }); // the lower bill, dropped
  k.ell([0, -0.085, 0.3], [0.03, 0.016, 0.11], 0x5a3e2a, { ws: 5, hs: 3, rough: 0.9 }); // the gape, a warm umber shadow in the ivory
  // the crest: five feathers bristling back off the crown, gilt at the points
  for (let i = 0; i < 5; i++) {
    const e = 0.35 + i * 0.17; const L = 0.3 - Math.abs(i - 2) * 0.03; const sx = (i - 2) * 0.03;
    const b = [sx, 0.13 + Math.sin(e) * 0.04, -0.1 - i * 0.015]; const d = [0, Math.sin(e), -Math.cos(e)];
    k.cyl([b[0], b[1] + d[1] * L / 2, b[2] + d[2] * L / 2], 0.045, 0.004, L, i % 2 ? D : IVORY, { seg: 4, rot: [up(e), 0, -sx * 2] });
    k.cyl([b[0], b[1] + d[1] * (L + 0.02), b[2] + d[2] * (L + 0.02)], 0.01, 0.0, 0.05, GILT, { seg: 3, rot: [up(e), 0, -sx * 2], rough: 0.3 });
  }
  // the nape's feathers, and the neck snapped short under them
  for (const sd of [-1, 1]) k.ell([sd * 0.09, -0.08, -0.17], [0.07, 0.12, 0.05], D, { ws: 5, hs: 3, rot: [0.5, 0, sd * 0.3] });
  k.cyl([0, -0.19, -0.06], 0.12, 0.14, 0.18, IVORY, { seg: 10, rot: [-0.35, 0, 0] });
  k.ell([0, -0.28, -0.09], [0.12, 0.03, 0.12], BRK, { ws: 6, hs: 3, rot: [-0.35, 0, 0], vary: 0.3, rough: 0.9 });

  k.to('wing'); wingInto(k, 6, 1);
  k.ell([0, 0, 0], [0.03, 0.06, 0.06], BRK, { ws: 6, hs: 4, vary: 0.3, rough: 0.9 }); // the break at the shoulder
  k.to('beak');
  k.tube([[0, 0, 0], [0.05, 0.0, 0.0], [0.09, -0.01, -0.03]], [0.025, 0.018, 0.005], GILT, { sides: 5, budget: 24, rough: 0.3 });
  k.ell([0, 0, 0], [0.008, 0.024, 0.024], BRK, { ws: 5, hs: 3 });
  k.to('claw');
  k.cyl([0, 0, 0], 0.02, 0.012, 0.1, D, { seg: 4, rot: [0, 0, Math.PI / 2] });
  k.cyl([0.07, 0.0, 0], 0.012, 0.0, 0.05, GILT, { seg: 4, rot: [0, 0, -Math.PI / 2 - 0.5], rough: 0.3 });
  k.to('plume');
  k.cyl([0, 0, 0], 0.04, 0.004, 0.24, D, { seg: 5, rot: [0, 0, -Math.PI / 2] });
  k.cyl([0.13, 0, 0], 0.01, 0.0, 0.05, GILT, { seg: 4, rot: [0, 0, -Math.PI / 2], rough: 0.3 });

  const parts = {};
  for (const [name, list] of Object.entries(k.parts)) { parts[name] = fuse(list); for (const g of list) g.dispose(); }
  return { parts };
}

/**
 * A skull of half-width w, centred on the group's origin, face to +Z: a turned cranium pinched at
 * the temples, deep oval orbits in raised rims, a nasal notch, cheek arches, the upper jaw with its
 * teeth one by one, and the lower jaw as its own bone (dropped open on its hinge when `open`).
 */
function skull(k, w, bone, open) {
  const P = (x, y, z) => [x * w, y * w, z * w];
  k.lathe([[0, -0.6], [0.46, -0.58], [0.7, -0.36], [0.88, 0.02], [0.97, 0.42], [0.94, 0.78], [0.74, 1.04], [0.38, 1.2], [0, 1.24]].map(([r, y]) => [r * w, y * w]), bone, {
    seg: 18,
    carve: (a, y) => { const f = Math.max(0, Math.cos(a)); const sd = Math.abs(Math.sin(a)); const low = y < 0.25 * w ? 1 : 0; return (1 + 0.08 * f) * (1 - 0.13 * sd * low) * (y < -0.25 * w ? 0.72 + 0.28 * f : 1); },
  });
  for (const sd of [-1, 1]) {
    k.ell(P(sd * 0.4, 0.13, 0.7), [0.25 * w, 0.29 * w, 0.22 * w], VOID, { ws: 9, hs: 6, rough: 1, vary: 0, rot: [0, sd * 0.35, sd * 0.22] }); // the orbit: deep, oval, canted
    k.tor(P(sd * 0.4, 0.13, 0.87), 0.29 * w, 0.08 * w, bone, { rs: 12, ts: 5, rot: [0, sd * 0.35, sd * 0.22], sc: [1, 1.14, 1] }); // its rim, heavy over the brow
    k.ell(P(sd * 0.065, -0.3, 0.93), [0.075 * w, 0.16 * w, 0.08 * w], VOID, { ws: 8, hs: 6, rough: 1, vary: 0, rot: [0, 0, sd * 0.4] }); // the nasal notch, two lobes
    k.tube([P(sd * 0.56, -0.2, 0.74), P(sd * 0.9, -0.14, 0.42), P(sd * 0.95, -0.02, 0.04)], [0.11 * w, 0.085 * w, 0.07 * w], bone, { sides: 6, budget: 60 }); // the cheek arch
    k.ell(P(sd * 0.93, 0.25, 0.3), [0.07 * w, 0.26 * w, 0.3 * w], 0x5e594f, { ws: 8, hs: 5, rough: 0.9 }); // the temple, hollowed
  }
  k.ell(P(0, -0.08, 0.96), [0.07 * w, 0.14 * w, 0.07 * w], bone, { ws: 8, hs: 5 }); // the nasal bones
  k.ell(P(0, -0.58, 0.56), [0.5 * w, 0.2 * w, 0.44 * w], bone, { ws: 12, hs: 7 }); // the upper jaw
  for (let i = 0; i < 8; i++) { // upper teeth, each its own
    const a = (i - 3.5) * 0.21;
    k.cyl(P(Math.sin(a) * 0.5, -0.8, 0.56 + Math.cos(a) * 0.43), 0.04 * w, 0.055 * w, (i === 2 || i === 5 ? 0.24 : 0.18) * w, bone, { seg: 4, rough: 0.45 });
  }
  if (open) k.ell(P(0, -0.86, 0.42), [0.42 * w, 0.26 * w, 0.36 * w], VOID, { ws: 10, hs: 6, rough: 1, vary: 0 }); // the dark of the open mouth
  k.group(P(0, -0.42, 0.0), [open ? 0.55 : 0.04, 0, 0], () => { // the lower jaw: one bent bone, hinged under the ear
    k.tube([P(-0.8, 0.12, 0), P(-0.72, -0.44, 0.26), P(-0.38, -0.6, 0.78), P(0, -0.64, 0.94), P(0.38, -0.6, 0.78), P(0.72, -0.44, 0.26), P(0.8, 0.12, 0)],
      [0.1 * w, 0.12 * w, 0.11 * w, 0.13 * w, 0.11 * w, 0.12 * w, 0.1 * w], bone, { sides: 6, detail: 2, budget: 170 });
    for (let i = 0; i < 8; i++) {
      const a = (i - 3.5) * 0.21;
      k.cyl(P(Math.sin(a) * 0.45, -0.46, 0.52 + Math.cos(a) * 0.4), 0.05 * w, 0.038 * w, 0.16 * w, bone, { seg: 4, rough: 0.45 });
    }
  });
}

const CARVERS = { pawn: carveCarrier, knight: carveHorse, bishop: carveLady, rook: carveCaptain, queen: carveBride, king: carveLikeness, turtle: carveTurtle, dormouse: carveDormouse, duchess: carveDuchess };

// ---- the carved material ---------------------------------------------------------------------------

const GLSL_NOISE = `
float cmHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float cmNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( cmHash( i ), cmHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( cmHash( i + vec3( 0, 1, 0 ) ), cmHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( cmHash( i + vec3( 0, 0, 1 ) ), cmHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( cmHash( i + vec3( 0, 1, 1 ) ), cmHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`;

/**
 * Polished ebony and carved ivory in one material: vertex colour for the wood and its inlays,
 * `fin` for each vertex's polish (x, roughness) and glow (y), a grain cut into the normal, the
 * moon along every edge, and the two things a death needs (a cut that eats the figure from one
 * end, and age).
 */
function carvedMaterial() {
  const u = {
    uRim: { value: new THREE.Color(MOON) }, uRimK: { value: 0.75 }, uMoon: { value: new THREE.Vector3(0.828, 0.407, 0.386) },
    uCut: { value: -1000 }, uDir: { value: 1 }, uAge: { value: 0 }, uGlow: { value: 1 }, uEdge: { value: new THREE.Color(0x000000) },
  };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fin;\nvarying vec2 vFin;\nvarying vec3 vOP;\nvarying vec3 vWP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFin = fin;\nvOP = position;\nvON = normal;\nvWP = ( modelMatrix * vec4( position, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vFin; varying vec3 vOP; varying vec3 vWP; varying vec3 vON;
uniform vec3 uRim; uniform float uRimK; uniform vec3 uMoon; uniform float uCut; uniform float uDir; uniform float uAge; uniform float uGlow; uniform vec3 uEdge;
${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float cmN = cmNoise( vOP * 7.0 );
float cmCut = ( vWP.y + ( cmN - 0.5 ) * 0.3 - uCut ) * uDir;
if ( cmCut < 0.0 ) discard;
float cmEdge = 1.0 - smoothstep( 0.0, 0.09, cmCut );
float cmCrack = smoothstep( 0.0, 0.06, abs( fract( cmNoise( vOP * 4.3 + 7.0 ) * 5.0 ) - 0.5 ) );
// the knife works the carved bands, collars and hollows; smooth crowns and the tops of plinths are left clean
float cmBand = smoothstep( 0.44, 0.5, vFin.x ) * ( 1.0 - smoothstep( 0.58, 0.62, vFin.x ) ) * ( 1.0 - smoothstep( 0.3, 0.65, normalize( vON ).y ) );
// chisel strokes: one short straight nick to a cell of the block, each cut its own way; deep, dark in the crevice
vec3 cmCp = vOP * 13.0; vec3 cmCi = floor( cmCp ); vec3 cmCf = fract( cmCp ) - 0.5;
vec3 cmDir = normalize( vec3( -vOP.z, 0.15 * ( cmHash( cmCi + 7.1 ) - 0.5 ), vOP.x ) + 1e-4 ); // along the turning, as a tool held to the lathe cuts
float cmAlong = dot( cmCf, cmDir );
float cmGouge = ( 1.0 - smoothstep( 0.07, 0.2, length( cmCf - cmDir * cmAlong ) ) ) * ( 1.0 - smoothstep( 0.28, 0.44, abs( cmAlong ) ) ) * step( 0.7, cmHash( cmCi + 3.7 ) );
float cmRelief = cmGouge * cmBand * ( 1.0 - vFin.y );
diffuseColor.rgb *= 1.0 - 0.3 * cmRelief;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.19, 0.17 ) * ( 0.2 + 0.8 * cmCrack ) * ( 0.7 + 0.6 * cmN ), uAge );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float cmGrain = cmNoise( vOP * vec3( 14.0, 110.0, 14.0 ) ) - 0.5;
roughnessFactor = clamp( mix( vFin.x + 0.06 * cmGrain + 0.2 * cmRelief, 1.0, uAge ), 0.05, 1.0 );`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float cmH = ( 0.0005 * cmGrain + 0.0007 * cmNoise( vOP * 60.0 ) - 0.009 * cmRelief * clamp( dot( vColor.rgb, vec3( 2.5 ) ), 0.2, 1.0 ) + uAge * 0.012 * ( 1.0 - cmCrack ) ) * ( 1.0 - vFin.y );
  vec3 cmSx = dFdx( -vViewPosition ); vec3 cmSy = dFdy( -vViewPosition );
  vec3 cmR1 = cross( cmSy, normal ); vec3 cmR2 = cross( normal, cmSx );
  float cmDet = dot( cmSx, cmR1 );
  vec3 cmGrad = sign( cmDet ) * ( dFdx( cmH ) * cmR1 + dFdy( cmH ) * cmR2 );
  normal = normalize( abs( cmDet ) * normal - cmGrad );
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vColor.rgb * vFin.y * uGlow * 1.7 + uEdge * cmEdge;`)
      .replace('#include <opaque_fragment>', `{
  vec3 cmV = normalize( vViewPosition );
  float cmF = pow( 1.0 - clamp( dot( normal, cmV ), 0.0, 1.0 ), 2.6 );
  vec3 cmL = normalize( ( viewMatrix * vec4( uMoon, 0.0 ) ).xyz );
  outgoingLight += uRim * uRimK * cmF * ( 0.3 + 0.7 * clamp( dot( normal, cmL ) * 0.5 + 0.5, 0.0, 1.0 ) ) * ( 1.0 - 0.6 * uAge );
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'chessmen-carved';
  m.userData.u = u;
  return m;
}

/** Pooled motes for the deaths (earth, smoke, dust): instanced quads, premultiplied, one draw call. */
function moteMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
attribute vec4 aPos; attribute vec4 aCol; varying vec2 vUv; varying vec4 vCol;
void main() {
  vUv = position.xy; vCol = aCol;
  vec4 mv = viewMatrix * vec4( aPos.xyz, 1.0 );
  mv.xy += position.xy * aPos.w;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
varying vec2 vUv; varying vec4 vCol;
void main() {
  float d = length( vUv ) * 2.0;
  float a = smoothstep( 1.0, 0.25, d ) * vCol.a;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( vCol.rgb * a, a );
  #include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

function batMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: `
uniform float uT; varying float vShade;
void main() {
  vec3 p = position;
  float seed = instanceMatrix[ 3 ][ 0 ] * 3.1 + instanceMatrix[ 3 ][ 2 ] * 1.7;
  float w = abs( p.x );
  p.y += w * sin( uT * 26.0 + seed ) * 0.75 - w * w * 0.6;
  vShade = 0.5 + 0.5 * w;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( p, 1.0 );
}`,
    fragmentShader: 'varying float vShade;\nvoid main() { gl_FragColor = vec4( vec3( 0.012, 0.011, 0.016 ) * vShade, 1.0 ); }',
    side: THREE.DoubleSide,
  });
}

function batGeometry() {
  // a body and two scalloped wings, in the XZ plane: nose toward +Z
  const v = []; const tri = (...p) => v.push(...p);
  for (const s of [-1, 1]) {
    tri(0, 0, 0.1, s * 0.16, 0, 0.14, s * 0.08, 0, -0.06);
    tri(s * 0.16, 0, 0.14, s * 0.4, 0, 0.1, s * 0.22, 0, -0.04);
    tri(s * 0.16, 0, 0.14, s * 0.22, 0, -0.04, s * 0.08, 0, -0.06);
    tri(s * 0.4, 0, 0.1, s * 0.5, 0, -0.08, s * 0.3, 0, -0.02);
    tri(0, 0.03, 0.12, s * 0.03, 0, -0.12, 0, -0.03, 0.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  return g;
}

// ---- the layer ---------------------------------------------------------------------------------------

/**
 * createChessmen(scene, cfg) -> the layer actors.js runs: { sync(sim, dt, time, eye),
 * onEvent(ev), clear(), setReducedFlash(on), counts(), dispose() }. cfg is CASTLE_CONFIG
 * (cfg.board.leap times a strike and a death to the landing).
 */
export function createChessmen(scene, cfg) {
  const leapTime = (cfg && cfg.board && cfg.board.leap) || 0.5;
  const root = new THREE.Group();
  root.name = 'chessmen';
  root.visible = false;
  scene.add(root);
  const mid = { x: (BOARD.rect.minX + BOARD.rect.maxX) / 2, z: (BOARD.rect.minZ + BOARD.rect.maxZ) / 2 };
  const rnd = S.rng(64);

  let built = null; // { mat, dyeMats[2], slots[8], whites[3], motes, bats, geos[] }
  let reduced = false;
  let won = false; // sim.waves.done.knight, read each frame
  let leapFrom = null; let leapTo = null; // the last knightLeap, for the way a taken piece is knocked
  let lit = null; // the square the reticle points at when it is a legal leap (#15): one chalk-coloured floor quad, made on first use

  // The shell (castle.js's handle), when it has been passed on (setShell) or left on its own
  // group (userData.castle): its sees(zone) says whether the shell is drawing that zone now.
  let shell = null; // passed on by setShell
  let found = null; // found on the scene once, and kept until its group leaves the scene
  let sought = 0; // frames until the scene is searched again (a search walks the whole graph)
  function shellSees(id) {
    let s = shell;
    if (!s) {
      if (found && !(found.group && found.group.parent)) found = null;
      if (!found && --sought < 0) {
        const g = scene.getObjectByName('castle');
        const h = g && g.userData ? g.userData.castle || g.userData.shell : null;
        if (h && typeof h.sees === 'function') found = h; else sought = 120;
      }
      s = found;
    }
    return s && typeof s.sees === 'function' ? !!s.sees(id) : null; // null: no shell to ask
  }

  // motes: plain arrays, written into two instanced attributes; nothing is made per frame
  const mp = new Float32Array(MOTES * 3); const mv = new Float32Array(MOTES * 3);
  const mLife = new Float32Array(MOTES); const mMax = new Float32Array(MOTES); const mSize = new Float32Array(MOTES);
  const mKind = new Uint8Array(MOTES); // 0 earth (falls), 1 smoke (rises, swells), 2 dust (drifts down)
  let mNext = 0; let mAlive = 0;

  function mote(kind, x, y, z, vx, vy, vz, size, life) {
    const i = mNext; mNext = (mNext + 1) % MOTES;
    mp[i * 3] = x; mp[i * 3 + 1] = y; mp[i * 3 + 2] = z; mv[i * 3] = vx; mv[i * 3 + 1] = vy; mv[i * 3 + 2] = vz;
    mKind[i] = kind; mSize[i] = size; mLife[i] = life; mMax[i] = life;
  }

  function stepMotes(dt) {
    const b = built; if (!b) return;
    const aPos = b.motes.geometry.attributes.aPos; const aCol = b.motes.geometry.attributes.aCol;
    let n = 0;
    for (let i = 0; i < MOTES; i++) {
      if (mLife[i] <= 0) continue;
      mLife[i] -= dt;
      if (mLife[i] <= 0) continue;
      const kd = mKind[i]; const j = i * 3; const age = 1 - mLife[i] / mMax[i];
      if (kd === 0) { mv[j + 1] -= 9.8 * dt; } else if (kd === 1) { mv[j + 1] += 0.5 * dt; mv[j] *= 1 - 1.2 * dt; mv[j + 2] *= 1 - 1.2 * dt; } else { mv[j + 1] -= 1.1 * dt; mv[j] *= 1 - 1.5 * dt; mv[j + 2] *= 1 - 1.5 * dt; mv[j + 1] *= 1 - 1.5 * dt; }
      mp[j] += mv[j] * dt; mp[j + 1] += mv[j + 1] * dt; mp[j + 2] += mv[j + 2] * dt;
      if (mp[j + 1] < 0.03) { mp[j + 1] = 0.03; mv[j] *= 0.3; mv[j + 2] *= 0.3; mv[j + 1] *= -0.25; }
      const size = kd === 1 ? mSize[i] * (0.5 + 1.8 * age) : kd === 2 ? mSize[i] * (0.7 + 0.8 * age) : mSize[i];
      aPos.setXYZW(n, mp[j], mp[j + 1], mp[j + 2], size);
      const fade = kd === 0 ? clamp(mLife[i] * 3) : Math.sin(Math.PI * Math.min(1, age * 1.02)) ** 0.7;
      if (kd === 0) aCol.setXYZW(n, 0.011, 0.007, 0.005, fade);
      else if (kd === 1) aCol.setXYZW(n, 0.006, 0.006, 0.008, 0.72 * fade);
      else aCol.setXYZW(n, 0.075, 0.073, 0.07, 0.22 * fade);
      n++;
    }
    mAlive = n;
    b.motes.count = n;
    b.motes.visible = n > 0;
    if (n) { aPos.needsUpdate = true; aCol.needsUpdate = true; }
  }

  // ---- building and freeing ----

  function buildPiece(kind, seed, b) {
    const made = CARVERS[kind](seed);
    const group = new THREE.Group();
    const all = [];
    const hidden = made.hidden || [];
    for (const [name, list] of Object.entries(made.k.parts)) if (!hidden.includes(name)) all.push(...list);
    const whole = new THREE.Mesh(fuse(all), b.mat);
    whole.castShadow = true; whole.receiveShadow = true;
    b.geos.push(whole.geometry);
    group.add(whole);
    const piece = { kind, group, whole, parts: null, rig: null, made, triangles: whole.geometry.index.count / 3 };
    if (made.pivots) { // a black piece: the same carving again as parts, for its death
      const rig = new THREE.Group(); rig.visible = false;
      piece.parts = {};
      for (const [name, list] of Object.entries(made.k.parts)) {
        const g = fuse(list);
        const pv = made.pivots[name] || [0, 0, 0];
        if (!(made.free || []).includes(name)) g.translate(-pv[0], -pv[1], -pv[2]);
        const mesh = new THREE.Mesh(g, b.mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.home = (made.free || []).includes(name) ? [0, 0, 0] : pv;
        mesh.userData.hidden = hidden.includes(name);
        b.geos.push(g);
        rig.add(mesh);
        piece.parts[name] = mesh;
      }
      piece.rig = rig;
      group.add(rig);
    }
    for (const list of Object.values(made.k.parts)) for (const g of list) g.dispose();
    made.k = null;
    return piece;
  }

  function build() {
    const b = { mat: carvedMaterial(), dyeMats: [carvedMaterial(), carvedMaterial()], slots: [], whites: [], geos: [], motes: null, bats: null };
    BLACK_SLOTS.forEach((kind, i) => {
      const piece = buildPiece(kind, 11 + i * 7, b);
      Object.assign(piece, { square: null, state: 'off', t: 0, fired: 0, emit: 0, strikeT: -1, sx: 0, sz: 0, ox: 0, oz: 0, dye: -1, x: 0, z: 0 });
      piece.group.visible = false;
      root.add(piece.group);
      b.slots.push(piece);
    });
    BOARD.whites.forEach((w, i) => {
      const piece = buildPiece(w.kind, 101 + i * 13, b);
      piece.group.position.set(w.x, 0, w.z);
      piece.group.rotation.y = Math.PI / 2; // along the west wall, facing the board
      root.add(piece.group);
      b.whites.push(piece);
    });
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(MOTES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    quad.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(MOTES * 4), 4).setUsage(THREE.DynamicDrawUsage));
    b.motes = new THREE.InstancedMesh(quad, moteMaterial(), MOTES);
    b.motes.frustumCulled = false; b.motes.visible = false; b.motes.count = 0; b.motes.renderOrder = 5;
    root.add(b.motes);
    b.bats = new THREE.InstancedMesh(batGeometry(), batMaterial(), BATS);
    b.bats.frustumCulled = false; b.bats.visible = false;
    root.add(b.bats);
    b.geos.push(quad, b.bats.geometry);
    mLife.fill(0); mNext = 0; mAlive = 0;
    built = b;
  }

  function free() {
    const b = built; if (!b) return;
    while (root.children.length) root.remove(root.children[0]);
    if (lit) { lit.geometry.dispose(); lit.material.dispose(); lit = null; }
    for (const g of b.geos) g.dispose();
    b.mat.dispose(); b.dyeMats[0].dispose(); b.dyeMats[1].dispose();
    b.motes.material.dispose(); b.bats.material.dispose();
    b.motes.dispose(); b.bats.dispose();
    built = null;
    root.visible = false;
  }

  // ---- a slot's three states: standing, dying, remains ----

  function resetRig(piece) {
    for (const mesh of Object.values(piece.parts)) {
      const h = mesh.userData.home;
      mesh.position.set(h[0], h[1], h[2]); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1);
      mesh.visible = !mesh.userData.hidden;
      mesh.material = built.mat; mesh.castShadow = true;
    }
  }

  function stand(piece, sq) {
    const r = squareRect(sq);
    if (!r) { piece.group.visible = false; piece.state = 'off'; return; }
    if (piece.dye >= 0) releaseDye(piece);
    piece.square = sq; piece.state = 'standing'; piece.strikeT = -1; piece.ox = 0; piece.oz = 0;
    piece.x = r.x; piece.z = r.z;
    piece.group.position.set(r.x, 0, r.z); piece.group.rotation.set(0, 0, 0);
    piece.group.visible = true; piece.whole.visible = true; piece.rig.visible = false;
    if (piece.kind === 'king' && built) built.bats.visible = false;
  }

  function releaseDye(piece) {
    const u = built.dyeMats[piece.dye].userData.u;
    u.uCut.value = -1000; u.uDir.value = 1; u.uAge.value = 0; u.uGlow.value = 1; u.uEdge.value.setHex(0);
    built.dyeMats[piece.dye].userData.owner = null;
    piece.dye = -1;
  }

  function startDeath(piece) {
    resetRig(piece);
    piece.whole.visible = false; piece.rig.visible = true;
    piece.state = 'dying'; piece.t = -Math.max(0, leapTime - 0.18); piece.fired = 0; piece.emit = 0; piece.strikeT = -1;
    piece.group.rotation.set(0, 0, 0);
    // knocked off the square the warden is landing on: along the leap, or beside it if a piece stands there
    let dx = 0; let dz = -1;
    const a = leapFrom && squareRect(leapFrom); const t = squareRect(piece.square);
    if (a && t) { const l = Math.hypot(t.x - a.x, t.z - a.z) || 1; dx = (t.x - a.x) / l; dz = (t.z - a.z) / l; }
    let best = 0;
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn); const s = Math.sin(turn);
      const tx = piece.x + (dx * c - dz * s) * 1.7; const tz = piece.z + (dx * s + dz * c) * 1.7;
      let clear = true;
      for (const o of built.slots) if (o !== piece && o.state === 'standing' && Math.hypot(o.x - tx, o.z - tz) < 1.25) clear = false;
      if (clear) { best = turn; break; }
    }
    const c = Math.cos(best); const s = Math.sin(best);
    piece.ox = (dx * c - dz * s) * 1.7; piece.oz = (dx * s + dz * c) * 1.7;
    const names = DISSOLVES[piece.kind];
    if (names) {
      let d = !built.dyeMats[0].userData.owner ? 0 : !built.dyeMats[1].userData.owner ? 1 : -1;
      if (d < 0) { d = 0; const other = built.dyeMats[0].userData.owner; if (other) { other.dye = -1; for (const n of DISSOLVES[other.kind]) other.parts[n].visible = false; } }
      built.dyeMats[d].userData.owner = piece; piece.dye = d;
      for (const n of names) { piece.parts[n].material = built.dyeMats[d]; piece.parts[n].castShadow = false; }
    }
  }

  /** A fall under gravity from y0 to rest, with one small bounce: the height at tau seconds. */
  function fall(y0, rest, tau) {
    if (tau <= 0) return y0;
    const tf = Math.sqrt(Math.max(0, y0 - rest) / 4.9);
    if (tau < tf) return y0 - 4.9 * tau * tau;
    const bt = tau - tf;
    return rest + Math.max(0, 1.1 * bt - 4.9 * bt * bt);
  }
  const fallTime = (y0, rest) => Math.sqrt(Math.max(0, y0 - rest) / 4.9);

  /** Puts a part where a tumble has it at tau: from its home to a resting place on the floor. */
  function tumble(mesh, tau, rest, spin) {
    const h = mesh.userData.home; const tf = fallTime(h[1], rest[1]);
    const k = clamp(tau / tf);
    mesh.position.set(lerp(h[0], rest[0], k), fall(h[1], rest[1], tau), lerp(h[2], rest[2], k));
    mesh.rotation.set(spin[0] * k, spin[1] * k, spin[2] * k);
  }

  function ring(kind, piece, y, r, n, out, up, size, life) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU; const rr = r * (0.4 + 0.6 * rnd());
      mote(kind, piece.group.position.x + Math.sin(a) * rr, y + (rnd() - 0.5) * 0.1, piece.group.position.z + Math.cos(a) * rr,
        Math.sin(a) * out * (0.4 + rnd()), up * (0.5 + rnd()), Math.cos(a) * out * (0.4 + rnd()), size * (0.6 + 0.8 * rnd()), life * (0.6 + 0.8 * rnd()));
    }
  }

  const DEATHS = {
    // the box bursts into loose earth and the hood falls empty
    pawn(piece, t, dt) {
      const p = piece.parts; const H = piece.made.H;
      if (t < 0.35) p.box.position.x = p.box.userData.home[0] + Math.sin(t * 95) * 0.014 * (t / 0.35);
      else if (!piece.fired) {
        piece.fired = 1; p.box.visible = false;
        const gx = piece.group.position.x; const gz = piece.group.position.z;
        for (let i = 0; i < 54; i++) {
          const a = (rnd() - 0.5) * 2.6; const sp = 1.2 + 3.2 * rnd();
          mote(0, gx + (rnd() - 0.5) * 0.4, H + 0.6 + rnd() * 0.3, gz + 0.44, Math.sin(a) * sp, 1 + 3 * rnd(), Math.cos(a) * sp * 0.9, 0.05 + 0.1 * rnd(), 1.1 + rnd());
        }
        ring(2, piece, H + 0.7, 0.3, 10, 0.9, 0.5, 0.7, 1.5);
      }
      p.mound.visible = t > 0.4; p.mound.scale.setScalar(Math.max(0.01, ease((t - 0.4) / 0.6)));
      const k = ease((t - 0.45) / 0.8);
      p.body.scale.set(lerp(1, 1.22, k), lerp(1, 0.13, k), lerp(1, 1.22, k));
      const k2 = easeIn((t - 0.5) / 0.75); const hh = p.hood.userData.home;
      p.hood.position.set(hh[0] + Math.sin(t * 7) * 0.06 * (1 - k2), lerp(hh[1], H + 0.3, k2), hh[2] + 0.18 * k2);
      p.hood.rotation.set(1.15 * k2, 0, Math.sin(t * 6) * 0.2 * (1 - k2) + 0.25 * k2);
    },
    // the horse rears and goes to black smoke from the hooves up
    knight(piece, t, dt) {
      const p = piece.parts; const H = piece.made.H; const u = built.dyeMats[piece.dye].userData.u;
      const k = easeOut(t / 0.55);
      p.horse.rotation.x = -0.46 * k; p.horse.position.y = p.horse.userData.home[1] + 0.2 * k;
      u.uGlow.value = reduced ? 1 : 1 + 2.2 * k;
      const k2 = clamp((t - 0.5) / 1.9);
      const cut = lerp(H - 0.2, H + 3.6, k2);
      u.uCut.value = t > 0.5 ? cut : -1000; u.uDir.value = 1;
      u.uEdge.value.setRGB(reduced ? 0.06 : 0.3, 0.02, 0.01);
      if (t > 0.5 && k2 < 1) {
        piece.emit += dt * 46;
        while (piece.emit >= 1) { piece.emit -= 1; ring(1, piece, cut + 0.1, 0.42, 1, 0.25, 0.9, 0.6, 1.3); }
      }
      if (k2 >= 1) p.horse.visible = false;
    },
    // she folds into her shroud, which drops flat
    bishop(piece, t) {
      const p = piece.parts; const H = piece.made.H;
      const k = ease(t / 0.9);
      p.lady.scale.set(lerp(1, 0.3, k), lerp(1, 0.5, k), lerp(1, 0.3, k)); p.lady.rotation.x = 0.55 * k;
      const k2 = easeIn((t - 0.8) / 0.55);
      p.shroud.scale.set(lerp(1, 0.86, k) * lerp(1, 1.6, k2), lerp(lerp(1, 0.78, k), 0.04, k2), lerp(1, 0.86, k) * lerp(1, 1.6, k2));
      p.shroud.rotation.y = 0.5 * k;
      if (t > 1.0) p.lady.visible = false;
      if (t > 1.3 && !piece.fired) { piece.fired = 1; ring(2, piece, H + 0.1, 0.6, 16, 0.9, 0.25, 0.7, 1.6); }
    },
    // the ropes snap, the wheel spins and he falls to bones
    rook(piece, t, dt) {
      const p = piece.parts; const H = piece.made.H; const u = built.dyeMats[piece.dye].userData.u;
      if (t < 0.22) p.ropes.scale.setScalar(1 + 0.3 * (t / 0.22));
      else if (!piece.fired) {
        piece.fired = 1; p.ropes.visible = false;
        ring(0, piece, H + 1.4, 0.6, 14, 2.2, 1.6, 0.05, 0.9);
      }
      p.wheel.rotation.z = 26 * ease(t / 3.0);
      const k = ease((t - 0.22) / 0.5);
      p.captain.position.y = p.captain.userData.home[1] - 0.3 * k; p.captain.rotation.x = 0.32 * k;
      const k2 = clamp((t - 0.45) / 0.75);
      const cut = lerp(H + 3.1, H - 0.3, k2);
      u.uCut.value = t > 0.45 ? cut : 1000; u.uDir.value = -1; u.uEdge.value.setRGB(0.05, 0.05, 0.045);
      if (t > 0.45 && k2 < 1) { piece.emit += dt * 40; while (piece.emit >= 1) { piece.emit -= 1; ring(2, piece, cut, 0.4, 1, 0.5, 0.2, 0.45, 1.2); } }
      if (k2 >= 1) p.captain.visible = false;
      const b = t - 0.55;
      for (const n of BONES) p[n].visible = b > 0;
      if (b > 0) {
        p.skull.userData.home = HOME.skull; p.ribs.userData.home = HOME.ribs; p.limbs.userData.home = HOME.limbs;
        HOME.skull[1] = H + 1.95; HOME.ribs[1] = H + 1.2; HOME.limbs[1] = H + 0.6;
        tumble(p.skull, b, REST.skull, SPIN.skull); tumble(p.ribs, b - 0.05, REST.ribs, SPIN.ribs); tumble(p.limbs, b - 0.02, REST.limbs, SPIN.limbs);
      }
      tumble(p.cap, t - 0.75, REST.cap, SPIN.cap);
    },
    // she ages centuries in a second and crumbles to dust
    queen(piece, t, dt) {
      const p = piece.parts; const H = piece.made.H; const u = built.dyeMats[piece.dye].userData.u;
      const k = ease(t / 1.0);
      u.uAge.value = k; u.uGlow.value = 1 - k;
      p.bride.scale.set(lerp(1, 0.88, k), lerp(1, 0.93, k), lerp(1, 0.88, k)); p.bride.rotation.x = 0.13 * k;
      const k2 = clamp((t - 0.95) / 1.4);
      const cut = lerp(H + 3.0, H - 0.3, k2 * k2 * 0.4 + k2 * 0.6);
      u.uCut.value = t > 0.95 ? cut : 1000; u.uDir.value = -1; u.uEdge.value.setRGB(0.07, 0.065, 0.055);
      if (t > 0.95 && k2 < 1) { piece.emit += dt * 70; while (piece.emit >= 1) { piece.emit -= 1; ring(2, piece, cut, 0.36, 1, 0.5, -0.3, 0.42, 1.5); } }
      if (k2 >= 1) p.bride.visible = false;
      p.dust.visible = t > 1.1; p.dust.scale.set(1, Math.max(0.01, ease((t - 1.1) / 1.3)), 1);
      tumble(p.tiara, t - 1.12, REST.tiara, SPIN.tiara);
    },
    // it collapses in a heap and bats burst out
    king(piece, t) {
      const p = piece.parts; const H = piece.made.H;
      const k = easeIn((t - 0.2) / 0.7);
      p.stand.rotation.z = 1.32 * k; p.stand.position.y = p.stand.userData.home[1] - 0.42 * k;
      const k2 = ease((t - 0.1) / 0.85);
      p.cloak.scale.set(lerp(1, 1.3, k2), lerp(1, 0.09, k2), lerp(1, 1.3, k2)); p.cloak.rotation.y = 0.4 * k2;
      tumble(p.crown, t - 0.2, REST.crown, SPIN.crown);
      if (t > 0.5 && !piece.fired) { piece.fired = 1; ring(2, piece, H + 0.2, 0.7, 14, 1.0, 0.3, 0.7, 1.5); }
      // the bats: out from under the cloak, round once, and away toward the window
      const bats = built.bats; const tau = t - 0.3;
      bats.visible = tau > 0 && tau < 3.0;
      if (bats.visible) {
        bats.material.uniforms.uT.value = t;
        for (let i = 0; i < BATS; i++) {
          const s1 = (i * 0.618034) % 1; const s2 = (i * 0.381966 + 0.2) % 1;
          const tb = Math.max(0, tau - s1 * 0.25);
          const a = s1 * TAU + tb * (3.2 + s2 * 2) * (i % 2 ? 1 : -1);
          const r = 0.25 + 1.5 * (1 - Math.exp(-2.2 * tb)) * (0.6 + 0.6 * s2);
          const away = easeIn((tb - 0.9) / 1.6);
          const x = piece.group.position.x + Math.sin(a) * r * (1 - 0.6 * away) + away * (7 + 5 * s2);
          const y = H + 0.4 + 1.5 * (1 - Math.exp(-1.6 * tb)) * (0.7 + s2) + away * (2.4 + 2 * s1) + 0.2 * Math.sin(tb * 9 + i);
          const z = piece.group.position.z + Math.cos(a) * r * (1 - 0.6 * away) + away * (s1 - 0.5) * 4;
          const sc = (0.75 + 0.5 * s2) * clamp(tb * 6) * clamp((3.0 - tau) * 2.5);
          _o.position.set(x, y, z); _o.rotation.set(0, away > 0.2 ? Math.PI / 2 : a + (i % 2 ? Math.PI / 2 : -Math.PI / 2), 0); _o.scale.setScalar(Math.max(0.001, sc));
          _o.updateMatrix(); bats.setMatrixAt(i, _o.matrix);
        }
        bats.instanceMatrix.needsUpdate = true;
      }
    },
  };
  // where the loose parts come to rest (piece-local) and how far they turn getting there
  const HOME = { skull: [0, 0, 0.16], ribs: [0, 0, 0.1], limbs: [0, 0, 0.1] };
  const REST = { skull: [0.34, 0.25, 1.0], ribs: [-0.3, 0.14, 0.95], limbs: [0.02, 0.0, 1.2], cap: [0.5, 0.06, 1.25], tiara: [0.25, 0.05, 1.05], crown: [0.95, 0.02, 0.75] };
  const SPIN = { skull: [1.9, 0.6, 0.5], ribs: [1.45, 0.3, 0.2], limbs: [0, 1.1, 0], cap: [-0.2, 0.9, 0.12], tiara: [0.1, 1.4, 0.16], crown: [0, 1.6, 0.3] };

  function stepPiece(piece, dt) {
    if (piece.state === 'dying') {
      piece.t += dt;
      // knocked aside as the warden lands
      const shove = easeOut((piece.t + 0.18) / 0.3);
      piece.group.position.set(piece.x + piece.ox * shove, 0, piece.z + piece.oz * shove);
      if (piece.t >= 0) DEATHS[piece.kind](piece, Math.min(piece.t, DEATH_LEN[piece.kind]), dt);
      if (piece.t >= DEATH_LEN[piece.kind]) {
        piece.state = 'remains';
        if (piece.dye >= 0) { for (const n of DISSOLVES[piece.kind]) piece.parts[n].visible = false; releaseDye(piece); }
      }
      return;
    }
    if (piece.state !== 'standing' || piece.strikeT < 0) return;
    // a strike: slide to the warden's square as he lands, tip toward him, and go back
    piece.strikeT += dt;
    const t = piece.strikeT - (leapTime - 0.3);
    const out = t < 0.3 ? easeIn(t / 0.3) : t < 0.5 ? 1 : 1 - ease((t - 0.5) / 0.7);
    const hit = Math.max(0, 1 - Math.abs(t - 0.34) / 0.2);
    const hop = piece.kind === 'knight' ? 0.7 * Math.sin(Math.PI * clamp(out)) : 0; // the horse goes as a knight goes: over
    piece.group.position.set(piece.x + piece.sx * out, hop, piece.z + piece.sz * out);
    const l = Math.hypot(piece.sx, piece.sz) || 1;
    piece.group.rotation.set((piece.sz / l) * 0.2 * hit, 0, (-piece.sx / l) * 0.2 * hit);
    if (t >= 1.2) { piece.strikeT = -1; piece.group.position.set(piece.x, 0, piece.z); piece.group.rotation.set(0, 0, 0); }
  }

  /** Makes the slots agree with the board: who stands where, who is gone. */
  function seat(board) {
    const b = built;
    let pawn = 5;
    for (const s of b.slots) s.claimed = false;
    for (const p of board.pieces) {
      let slot = null;
      if (p.kind === 'pawn') { if (pawn < 8) slot = b.slots[pawn++]; } else for (let i = 0; i < 5 && !slot; i++) if (b.slots[i].kind === p.kind && !b.slots[i].claimed) slot = b.slots[i];
      if (!slot) continue;
      slot.claimed = true;
      if (!p.taken) {
        if (slot.state !== 'standing' || slot.square !== p.square) stand(slot, p.square);
      } else if (slot.state === 'standing' || slot.state === 'off') {
        // taken with no death seen (a restored, won board): simply not there
        slot.square = p.square; slot.state = 'gone'; slot.group.visible = false;
      } else if (slot.square !== p.square) { slot.square = p.square; slot.state = 'gone'; slot.group.visible = false; }
    }
    for (const s of b.slots) if (!s.claimed && s.state !== 'off') { if (s.dye >= 0) releaseDye(s); s.state = 'off'; s.group.visible = false; }
  }

  function sync(sim, dt, time, eye) {
    const w = sim && sim.cfg && sim.cfg.room === 'castle' ? sim.waves : null;
    const board = w && w.board && Array.isArray(w.board.pieces) ? w.board : null;
    if (!board || !eye) { if (built) free(); return; }
    const seen = shellSees('walk');
    const d = Math.hypot(eye.x - mid.x, eye.z - mid.z);
    if (seen !== null) {
      // the shell decides what is drawn: the board is there whenever the Knight's Walk is, and not
      // otherwise. It is built when first seen and kept while the eye is near, so stepping back and
      // forth through a door hides and shows it but never rebuilds it; it is freed only out of
      // sight and far away.
      if (!seen) {
        root.visible = false;
        if (built && d > FREE_FAR) free();
        return;
      }
      if (!built) build();
      root.visible = true;
    } else {
      // no shell to ask: by the eye's distance, drawn from the Knight's Walk, the passage into it and the stair out of it
      if (!built) { if (d > BUILD_NEAR) return; build(); }
      else if (d > FREE_FAR) { free(); return; }
      root.visible = eye.x > BOARD.south.minX - 9 && eye.x < BOARD.south.maxX + 2 && eye.z < BOARD.south.maxZ + 11 && eye.z > BOARD.north.minZ - 13 && eye.y < 8.5;
    }
    seat(board);
    won = !!(w.done && w.done.knight);
    const glow = won ? 0.12 : 1;
    const u = built.mat.userData.u;
    u.uGlow.value += (glow - u.uGlow.value) * Math.min(1, dt * 1.5);
    if (dt === 0) u.uGlow.value = glow;
    for (const s of built.slots) stepPiece(s, dt);
    if (dt > 0 || mAlive) stepMotes(dt);
    litSquare(w, time);
  }

  /**
   * Lights the square the warden's reticle points at, only when keep.js's focus marks it `aimed`
   * (a legal knight leap under the look, #15), in the prompt line's chalk. A slow swell, steady
   * under reduced flashing; hidden while a leap is on or the board is solved.
   */
  function litSquare(w, time) {
    const f = w && w.focus;
    if (!lit) {
      const g = new THREE.PlaneGeometry(BOARD.square - 0.12, BOARD.square - 0.12).rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: 0xE8E2D0, transparent: true, opacity: 0.4, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      lit = new THREE.Mesh(g, m);
      lit.renderOrder = 2;
      lit.visible = false; // made once, on the first frame the board is drawn
      root.add(lit);
    }
    const r = f && f.kind === 'square' && f.aimed && !w.leap && !(w.done && w.done.knight) ? squareRect(f.square) : null;
    if (!r) { lit.visible = false; return; }
    lit.position.set(r.x, 0.04, r.z);
    lit.material.opacity = reduced ? 0.4 : 0.34 + 0.1 * Math.sin(time * 4);
    lit.visible = true;
  }

  /** The standing piece of a kind on a square, or null. */
  function standingAt(kind, square) {
    for (const sl of built.slots) if (sl.kind === kind && sl.square === square && sl.state === 'standing') return sl;
    return null;
  }

  function onEvent(ev) {
    if (!ev) return;
    if (ev.type === 'knightLeap') { leapFrom = ev.from || null; leapTo = ev.to || null; return; }
    if (ev.type === 'restored' || ev.type === 'checkpoint') { if (ev.type === 'restored') clear(); return; }
    if (!built) return;
    if (ev.type === 'capture') {
      const slot = standingAt(ev.piece, ev.square);
      if (slot) startDeath(slot);
    } else if (ev.type === 'pieceStrike') {
      const slot = standingAt(ev.piece, ev.square);
      const to = squareRect(ev.to || leapTo);
      if (!slot || !to) return;
      const dx = to.x - slot.x; const dz = to.z - slot.z; const l = Math.hypot(dx, dz) || 1;
      const reach = Math.max(0, l - 1.45);
      slot.sx = (dx / l) * reach; slot.sz = (dz / l) * reach; slot.strikeT = 0;
    }
  }

  /** Every death ended, every mote gone, the board read afresh on the next frame. */
  function clear() {
    leapFrom = null; leapTo = null;
    if (!built) return;
    for (const s of built.slots) { if (s.dye >= 0) releaseDye(s); s.state = 'off'; s.square = null; s.group.visible = false; }
    mLife.fill(0); mAlive = 0;
    built.motes.count = 0; built.motes.visible = false; built.bats.visible = false;
  }

  /** Draw calls and triangles as built: { built, pieces: { kind: triangles }, standing, triangles }. */
  function counts() {
    if (!built) return { built: false };
    const pieces = {}; let tris = 0; let standing = 0; let calls = 0;
    for (const p of [...built.slots, ...built.whites]) {
      pieces[p.kind] = p.triangles;
      if (!p.group.visible) continue;
      if (p.whole.visible) { tris += p.triangles; standing++; calls++; }
      else if (p.rig) for (const m of Object.values(p.parts)) if (m.visible) { calls++; tris += m.geometry.index.count / 3; }
    }
    return { built: true, pieces, standing, calls: calls + (built.motes.visible ? 1 : 0) + (built.bats.visible ? 1 : 0) + (lit && lit.visible ? 1 : 0), triangles: tris + (lit && lit.visible ? 2 : 0), motes: mAlive };
  }

  const api = {
    group: root, sync, onEvent, clear, counts,
    setReducedFlash(on) { reduced = !!on; },
    /** The shell (castle.js's handle): its sees('walk') then decides when the pieces are built, drawn and freed. */
    setShell(s) { shell = s || null; },
    /** Frees everything and leaves the scene. */
    dispose() { free(); scene.remove(root); },
  };
  root.userData.chessmen = api; // found by name on the scene, as keepprops is
  return api;
}
