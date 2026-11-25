// The Dracula pass's shared kit (game/logic/vamp.js holds its numbers and where everything stands):
// the Count's coat of arms drawn once on canvas (a bat-winged dragon coiled round a bat under a crown,
// on dusty crimson in tarnished gold; three Alice variants with a spade, a heart or the Hatter's hat with
// its 10/6 card for the bat), used as
// a painted plaque and as a carved stone relief from one atlas; gargoyles (crouching, wings spread,
// the Cheshire grin, one holding a teacup); carved bats (one with a pocket-watch on a chain); a coffin
// stood in a niche with an iron-bound lid (one with a spade); an iron chandelier and a many-armed wall
// candelabra with dripped and pooled wax (teacup variants); cobwebs; a baked glow pool; and dust motes
// that drift on the time uniform alone.
//
// Every builder returns plain geometry in its own frame (x along the wall, y up from the bottom, +z
// out of the wall or the room's face), vertex-coloured for the shared stone and fittings materials, so
// castle.js merges it into a zone's existing meshes: a room's decor costs it at most four draw calls
// (the crest atlas, the cobwebs, the dust, a glow pool) whatever it holds. No lights: the candles'
// flames ride the castle's flame and halo draws and their light is a baked additive pool. Nothing here
// runs per frame (the dust moves in its vertex stage on the shared time uniform). Every random
// choice is seeded (sculpt.js rng).
//
// API (for the later groups):
//   const kit = createVampKit({ time })     // time: the castle's { value } flame clock
//   every builder but crest takes o.lean (the lean build: fewer facets on its rounded parts; group 2)
//   kit.gargoyle({ variant, h, seed, corbel, wings, edge, light, glow }) -> { stone, fit, glow }   (wings 'spread' on any variant, edge 'gilt',
//                                                   light: a paler stone, glow: the Cheshire grin and eyes baked, for kit.materials.still)
//   kit.bat({ variant, w, tilt, seed, light })      -> { stone, fit }
//   kit.crest({ variant, finish, w, h, proud, frame }) -> { quad (uv'd, kit.materials.crest), stone, fit (frame 'gilt') }
//                                                   variant: dracul, spade, heart or hatter (the Hatter's hat with its 10/6 card)
//   kit.coffin({ variant, w, h, proud, lid })       -> { stone, fit }   (lid 'pale': a weathered lid)
//   kit.chandelier({ variant, arms, w, h, seed, cups, ring }) -> { fit, flames: [[x, y, z, size]], webs: [[a, b, c]] }   (cups: teacup size, ring: ring thickness)
//   kit.candelabra({ variant, arms, w, seed })      -> { fit, flames }
//   kit.bottle({ w, h, gilt, label })               -> { stone | fit (gilt), quad (label: DRINK ME lettered, kit.materials.crest) }
//   group 3: gargoyle variant 'hatter' (the Hatter's hat and its 10/6 card, in fit), o.cupFit (a teacup's china in fit, a third larger),
//            chandelier o.rod (a plain iron rod for a long drop in place of the chain)
//   kit.wreck(W, y0, seed)                          -> one geometry: the broken White Knight (the Gryphon) on the floor (logic/vamp.js WRECK), for the fittings
//   group 4: kit.band({ w, h, proud }) -> { quad (EAT ME, kit.materials.crest), stone, fit }; candelabra o.cups (the teacups' size)
//   kit.webs(tris)                                  -> uv'd geometry for kit.materials.web
//   kit.glowDisc(c, a, b, rgb, strength)            -> glow geometry (castle's flickering glowMat, or kit.materials.still)
//   kit.motes(vols, seed)                           -> Points geometry for kit.materials.motes
//   kit.mergeUV(list)                               -> one uv'd geometry
//   placeMatrix(x, y, z, n, out = 0)                -> the frame of a placement (logic/vamp.js)
//   kit.dispose()

import * as THREE from 'three';
import * as S from './sculpt.js';
import * as ST from './stone.js';
import { PALETTE, MOTES, motePoints, GRADE } from '../logic/vamp.js';
import { carveGryphon } from './chessmen.js'; // the broken white knight: the Gryphon, carved in the white set's ivory

const MOON_RGB = GRADE.moon; // group 3: the moon's colour for a baked cold edge (moonRim)

const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _up = V3(0, 1, 0);

// ---- small parts (no uv, vertex colour) ----------------------------------------------------------

// The lean build (group 2, o.lean on a builder): rounder parts drawn with fewer facets, for pieces seen
// high up or in the dark, so a room's decor keeps to its triangle budget. Set only for the length of one build.
let LEAN = false;
const lean = (o, build) => { const was = LEAN; LEAN = !!o.lean; try { return build(); } finally { LEAN = was; } };

function ell(rx, ry, rz, x, y, z, hex, vary = 0.12, seed = 0, ws = 7, hs = 5) {
  const g = new THREE.SphereGeometry(1, LEAN ? Math.min(ws, 5) : ws, LEAN ? Math.min(hs, 4) : hs);
  g.deleteAttribute('uv');
  g.scale(rx, ry, rz).translate(x, y, z);
  return S.tint(g, hex, vary, seed + x * 7 + y * 3);
}
function cone(r, h, x, y, z, hex, seg = 5, rx = 0, rz = 0, down = false) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.deleteAttribute('uv');
  if (down) g.rotateX(Math.PI);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return S.tint(g, hex, 0.08, x + z);
}
function cyl(r0, r1, h, x, y, z, hex, seg = 8, vary = 0.08) {
  const g = new THREE.CylinderGeometry(r1, r0, h, LEAN ? Math.min(seg, 6) : seg);
  g.deleteAttribute('uv');
  g.translate(x, y + h / 2, z);
  return S.tint(g, hex, vary, x - z + y);
}
function rod(a, b, r, hex, seg = 5) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, true);
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()), new THREE.Vector3(1, 1, 1)));
  return S.tint(g, hex, 0.12, a.x + a.y);
}
function boxG(w, h, d, x, y, z, hex, vary = 0.1, ry = 0, rx = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return S.tint(g, hex, vary, x + y + z);
}
function torus(R, r, x, y, z, hex, flat = true, seg = 16) {
  const g = new THREE.TorusGeometry(R, r, LEAN ? 3 : 4, LEAN ? Math.max(6, Math.round(seg * 0.6)) : seg);
  g.deleteAttribute('uv');
  if (flat) g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return S.tint(g, hex, 0.1, x + z);
}
function lathe(pts, x, y, z, hex, seg = 10) {
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), LEAN ? Math.min(seg, 7) : seg);
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  return S.tint(g, hex, 0.06, x + y);
}
function extrude(shape, depth, hex, vary = 0.1, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  g.deleteAttribute('uv');
  return S.tint(g, hex, vary, depth * 100);
}

/** Mirrors a geometry across x and turns its faces back the right way out. */
function mirrorX(g) {
  g.scale(-1, 1, 1);
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  } else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name]; const s = at.itemSize; const arr = at.array;
      for (let i = 0; i < at.count; i += 3) {
        for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
      }
    }
  }
  return g;
}

/** A bat's wing as a flat shape: the root at the origin, the tip out along +x (1 long), the fingers scalloped under. */
function wingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.08);
  s.lineTo(0.3, 0.24); s.lineTo(0.58, 0.2); s.lineTo(1.0, 0.06);
  s.quadraticCurveTo(0.84, -0.02, 0.8, -0.2);
  s.quadraticCurveTo(0.64, -0.1, 0.56, -0.32);
  s.quadraticCurveTo(0.4, -0.18, 0.27, -0.3);
  s.quadraticCurveTo(0.14, -0.12, 0, -0.12);
  s.closePath();
  return s;
}

/** The frame of a placement: local +z turned to the wall normal n = [nx, nz], at (x, y, z), `out` off the wall. */
export function placeMatrix(x, y, z, n, out = 0) {
  const nx = n ? n[0] : 0; const nz = n ? n[1] : 1;
  const ry = nx === 0 && nz === 0 ? 0 : Math.atan2(nx, nz);
  return new THREE.Matrix4().makeRotationY(ry).setPosition(x + nx * out, y, z + nz * out);
}

// ---- the coat of arms, drawn once ------------------------------------------------------------------

const CELL_W = 320; const CELL_H = 384;
const VARIANTS = ['dracul', 'spade', 'heart', 'hatter'];
const FINISHES = ['plaque', 'relief'];
// under the arms, a strip for a bottle's label (group 2: DRINK ME lettered), LABEL_W by LABEL_H at its left
const LABEL_W = 240; const LABEL_H = 100;
const ATLAS_H = CELL_H * VARIANTS.length + LABEL_H;

/** The DRINK ME label: old paper, a gilt rule, the words in dark ink, at (x, y) of the atlas canvas. */
function drawLabel(g, x, y) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#cdbf98'; g.fillRect(0, 0, LABEL_W, LABEL_H);
  g.strokeStyle = '#8c6c30'; g.lineWidth = 6; g.strokeRect(5, 5, LABEL_W - 10, LABEL_H - 10);
  g.fillStyle = '#2a1a0e'; g.font = 'bold 40px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DRINK ME', LABEL_W / 2, LABEL_H / 2 + 2);
  g.restore();
}

// group 4: beside the label, the EAT ME band: gilt letters cut in a dusty crimson field between gilt rules, BAND_W by LABEL_H at BAND_X
const BAND_X = 260; const BAND_W = 360;
/** The EAT ME band at (x, y) of the atlas canvas; height: the same letters and rules raised on a flat grey (the bump map), so they read as cut. */
function drawBand(g, x, y, height = false) {
  g.save(); g.translate(x, y);
  g.fillStyle = height ? '#505050' : '#4a1418'; g.fillRect(0, 0, BAND_W, LABEL_H);
  const gilt = height ? '#e8e8e8' : '#b8903e';
  g.strokeStyle = gilt; g.lineWidth = 5; g.strokeRect(6, 6, BAND_W - 12, LABEL_H - 12);
  g.lineWidth = 2; g.strokeRect(14, 14, BAND_W - 28, LABEL_H - 28);
  for (const cx of [34, BAND_W - 34]) { // a currant-studded little cake at each end (the cake that says EAT ME)
    g.fillStyle = gilt; g.beginPath(); g.moveTo(cx - 14, 64); g.lineTo(cx + 14, 64); g.lineTo(cx + 11, 42); g.lineTo(cx - 11, 42); g.closePath(); g.fill();
    g.fillStyle = height ? '#909090' : '#2a0a0c'; for (const [dx, dy] of [[-5, 50], [4, 47], [0, 57], [7, 56]]) { g.beginPath(); g.arc(cx + dx, dy, 2.2, 0, TAU); g.fill(); }
  }
  g.fillStyle = gilt; g.font = 'bold 50px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!height) { g.strokeStyle = '#1a0606'; g.lineWidth = 3; g.strokeText('EAT ME', BAND_W / 2, LABEL_H / 2 + 3); }
  g.fillText('EAT ME', BAND_W / 2, LABEL_H / 2 + 3);
  g.restore();
}

// Palettes for the two finishes and the height map: the same shapes, three sets of paint.
const PAINT = {
  plaque: { field: '#5a171b', diaper: 'rgba(20,4,6,0.45)', border: '#86682f', borderDark: '#3e2f16', charge: '#0e0a0a', rim: '#9c7a3c', crown: '#8c6c30', jewel: '#6e0f14', eye: '#b0261a', heart: '#5e0f14', bg: null, spade: '#7a1a22', spadeRim: '#b08a3c' },
  relief: { field: '#5e6166', diaper: 'rgba(30,32,36,0.35)', border: '#8c8f94', borderDark: '#3a3c40', charge: '#9a9da2', rim: '#b4b7bb', crown: '#a2a5aa', jewel: '#7c7f84', eye: '#4a4c50', heart: '#8a8d92', bg: '#6b6e73', spade: '#7a1a22', spadeRim: '#b08a3c' },
  height: { field: '#6e6e6e', diaper: 'rgba(0,0,0,0.12)', border: '#c4c4c4', borderDark: '#8a8a8a', charge: '#ececec', rim: '#ffffff', crown: '#dadada', jewel: '#f4f4f4', eye: '#bdbdbd', heart: '#e4e4e4', bg: '#404040', spade: '#e4e4e4', spadeRim: '#ffffff' },
};

function shieldPath(g, W, H) {
  g.beginPath();
  g.moveTo(W * 0.12, H * 0.22);
  g.quadraticCurveTo(W * 0.5, H * 0.25, W * 0.88, H * 0.22);
  g.lineTo(W * 0.88, H * 0.56);
  g.quadraticCurveTo(W * 0.86, H * 0.84, W * 0.5, H * 0.97);
  g.quadraticCurveTo(W * 0.14, H * 0.84, W * 0.12, H * 0.56);
  g.closePath();
}

function batPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy - s * 0.32);
  g.lineTo(cx + s * 0.08, cy - s * 0.42); g.lineTo(cx + s * 0.1, cy - s * 0.26); // an ear
  g.quadraticCurveTo(cx + s * 0.45, cy - s * 0.42, cx + s * 1.0, cy - s * 0.3);
  g.quadraticCurveTo(cx + s * 0.86, cy - s * 0.08, cx + s * 0.8, cy + s * 0.06);
  g.quadraticCurveTo(cx + s * 0.66, cy - s * 0.04, cx + s * 0.56, cy + s * 0.12);
  g.quadraticCurveTo(cx + s * 0.4, cy, cx + s * 0.3, cy + s * 0.1);
  g.quadraticCurveTo(cx + s * 0.16, cy + s * 0.04, cx + s * 0.08, cy + s * 0.36);
  g.lineTo(cx, cy + s * 0.46);
  g.lineTo(cx - s * 0.08, cy + s * 0.36);
  g.quadraticCurveTo(cx - s * 0.16, cy + s * 0.04, cx - s * 0.3, cy + s * 0.1);
  g.quadraticCurveTo(cx - s * 0.4, cy, cx - s * 0.56, cy + s * 0.12);
  g.quadraticCurveTo(cx - s * 0.66, cy - s * 0.04, cx - s * 0.8, cy + s * 0.06);
  g.quadraticCurveTo(cx - s * 0.86, cy - s * 0.08, cx - s * 1.0, cy - s * 0.3);
  g.quadraticCurveTo(cx - s * 0.45, cy - s * 0.42, cx - s * 0.1, cy - s * 0.26);
  g.lineTo(cx - s * 0.08, cy - s * 0.42);
  g.closePath();
}

function pipPath(g, suit, cx, cy, s) {
  g.beginPath();
  if (suit === 'heart') {
    g.moveTo(cx, cy + s * 0.5);
    g.bezierCurveTo(cx - s * 0.95, cy - s * 0.05, cx - s * 0.45, cy - s * 0.8, cx, cy - s * 0.3);
    g.bezierCurveTo(cx + s * 0.45, cy - s * 0.8, cx + s * 0.95, cy - s * 0.05, cx, cy + s * 0.5);
  } else {
    g.moveTo(cx, cy - s * 0.5);
    g.bezierCurveTo(cx - s * 0.95, cy + s * 0.05, cx - s * 0.45, cy + s * 0.7, cx, cy + s * 0.2);
    g.bezierCurveTo(cx + s * 0.45, cy + s * 0.7, cx + s * 0.95, cy + s * 0.05, cx, cy - s * 0.5);
    g.moveTo(cx, cy + s * 0.05); g.lineTo(cx + s * 0.17, cy + s * 0.52); g.lineTo(cx - s * 0.17, cy + s * 0.52); g.closePath();
  }
}

/** One cell of the arms: the crown, the shield, the dragon coiled round the charge (bat, spade or heart). */
function drawArms(g, W, H, variant, p, rand, worn) {
  if (p.bg) { g.fillStyle = p.bg; g.fillRect(0, 0, W, H); }
  // the crown: a band, five points with pearls, a jewel in the band
  g.fillStyle = p.crown;
  g.beginPath();
  g.moveTo(W * 0.3, H * 0.19); g.lineTo(W * 0.7, H * 0.19); g.lineTo(W * 0.72, H * 0.12);
  for (let i = 4; i >= 0; i--) {
    const x = lerp(W * 0.3, W * 0.7, i / 4);
    g.lineTo(x + W * 0.03, H * 0.12); g.lineTo(x, H * (i % 2 ? 0.075 : 0.045)); g.lineTo(x - W * 0.03, H * 0.12);
  }
  g.lineTo(W * 0.28, H * 0.12); g.closePath(); g.fill();
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.arc(lerp(W * 0.3, W * 0.7, i / 4), H * (i % 2 ? 0.067 : 0.037), W * 0.018, 0, TAU); g.fill(); }
  g.fillStyle = p.jewel;
  for (const k of [0.4, 0.5, 0.6]) { g.beginPath(); g.arc(W * k, H * 0.158, W * 0.014, 0, TAU); g.fill(); }
  // the shield: a border, the field with a lattice
  shieldPath(g, W, H); g.fillStyle = p.borderDark; g.fill();
  g.save(); g.translate(W * 0.5, H * 0.58); g.scale(0.96, 0.965); g.translate(-W * 0.5, -H * 0.58);
  shieldPath(g, W, H); g.fillStyle = p.border; g.fill();
  g.restore();
  g.save(); g.translate(W * 0.5, H * 0.6); g.scale(0.86, 0.87); g.translate(-W * 0.5, -H * 0.6);
  shieldPath(g, W, H); g.fillStyle = p.field; g.fill();
  g.clip();
  g.strokeStyle = p.diaper; g.lineWidth = 2;
  for (let k = -H; k < W + H; k += 22) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
  g.restore();
  // the dragon: a thick coil round the middle, head at the upper right, tail curling at the upper left
  const cx = W * 0.5; const cy = H * 0.6; const R = W * 0.2;
  g.lineCap = 'round';
  g.strokeStyle = p.rim; g.lineWidth = W * 0.085;
  g.beginPath(); g.arc(cx, cy, R, -0.95, Math.PI + 0.95, false); g.stroke();
  g.strokeStyle = p.charge; g.lineWidth = W * 0.062;
  g.beginPath(); g.arc(cx, cy, R, -0.95, Math.PI + 0.95, false); g.stroke();
  // scales: short gold ticks along the coil
  g.strokeStyle = p.rim; g.lineWidth = 1.5;
  for (let a = -0.8; a < Math.PI + 0.8; a += 0.26) {
    const x0 = cx + Math.cos(a) * (R - W * 0.018); const y0 = cy + Math.sin(a) * (R - W * 0.018);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(cx + Math.cos(a + 0.1) * (R + W * 0.016), cy + Math.sin(a + 0.1) * (R + W * 0.016)); g.stroke();
  }
  // the head, at the coil's upper right end: a wedge snout, open jaw, a horn swept back
  const hx = cx + Math.cos(-0.95) * R; const hy = cy + Math.sin(-0.95) * R;
  g.fillStyle = p.charge; g.strokeStyle = p.rim; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(hx - W * 0.03, hy + W * 0.03); g.lineTo(hx - W * 0.02, hy - W * 0.05); g.lineTo(hx - W * 0.1, hy - W * 0.07); // upper jaw out to the left
  g.lineTo(hx - W * 0.04, hy - W * 0.02); g.lineTo(hx - W * 0.09, hy + W * 0.0); // the open mouth, the lower jaw
  g.lineTo(hx + W * 0.02, hy + W * 0.035); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(hx, hy - W * 0.045); g.quadraticCurveTo(hx + W * 0.05, hy - W * 0.08, hx + W * 0.08, hy - W * 0.05); g.lineTo(hx + W * 0.02, hy - W * 0.03); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = p.eye; g.beginPath(); g.arc(hx - W * 0.025, hy - W * 0.03, W * 0.008, 0, TAU); g.fill();
  // the tail, at the upper left: thinning and curling, a barbed tip
  const tx = cx + Math.cos(Math.PI + 0.95) * R; const ty = cy + Math.sin(Math.PI + 0.95) * R;
  g.strokeStyle = p.charge; g.lineWidth = W * 0.03;
  g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + W * 0.02, ty - W * 0.09, tx + W * 0.09, ty - W * 0.07); g.stroke();
  g.fillStyle = p.charge; g.beginPath(); g.moveTo(tx + W * 0.08, ty - W * 0.1); g.lineTo(tx + W * 0.13, ty - W * 0.065); g.lineTo(tx + W * 0.075, ty - W * 0.045); g.closePath(); g.fill();
  // its bat wings, spread from the top of the coil
  for (const sd of [-1, 1]) {
    g.save(); g.translate(cx + sd * W * 0.13, cy - R * 0.92); g.scale(sd, 1);
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(W * 0.1, -W * 0.12, W * 0.23, -W * 0.1);
    g.quadraticCurveTo(W * 0.18, -W * 0.05, W * 0.19, 0); g.quadraticCurveTo(W * 0.14, -W * 0.03, W * 0.12, W * 0.03);
    g.quadraticCurveTo(W * 0.07, -W * 0.0, W * 0.04, W * 0.04); g.closePath();
    g.fillStyle = p.charge; g.fill(); g.strokeStyle = p.rim; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W * 0.19, -W * 0.085); g.moveTo(W * 0.02, 0); g.lineTo(W * 0.17, -W * 0.01); g.moveTo(W * 0.02, W * 0.01); g.lineTo(W * 0.11, W * 0.025); g.stroke();
    g.restore();
  }
  // the charge in the coil: the bat (the Count's own), or a card's suit (the Alice variants)
  if (variant === 'dracul') {
    batPath(g, cx, cy + W * 0.01, W * 0.13); g.fillStyle = p.charge; g.fill(); g.strokeStyle = p.rim; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = p.eye; for (const sd of [-1, 1]) { g.beginPath(); g.arc(cx + sd * W * 0.012, cy - W * 0.012, W * 0.006, 0, TAU); g.fill(); }
  } else if (variant === 'hatter') { // the Hatter's hat, flared at the crown, the 10/6 card in its band (group 2, the tea room)
    const s = W * 0.17; const hy = cy + W * 0.02;
    g.fillStyle = p.charge; g.strokeStyle = p.rim; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(cx - s * 0.5, hy + s * 0.36); g.lineTo(cx - s * 0.66, hy - s * 0.62); g.quadraticCurveTo(cx, hy - s * 0.74, cx + s * 0.66, hy - s * 0.62); g.lineTo(cx + s * 0.5, hy + s * 0.36); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(cx, hy + s * 0.4, s * 0.98, s * 0.17, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = p.heart; g.beginPath(); g.moveTo(cx - s * 0.53, hy + s * 0.12); g.lineTo(cx + s * 0.53, hy + s * 0.12); g.lineTo(cx + s * 0.51, hy + s * 0.3); g.lineTo(cx - s * 0.51, hy + s * 0.3); g.closePath(); g.fill(); g.stroke(); // the band
    g.save(); g.translate(cx + s * 0.24, hy + s * 0.02); g.rotate(0.18);
    g.fillStyle = p.crown; g.fillRect(-s * 0.2, -s * 0.24, s * 0.4, s * 0.44); g.strokeRect(-s * 0.2, -s * 0.24, s * 0.4, s * 0.44); // the card
    g.fillStyle = p.borderDark; g.font = `bold ${Math.round(s * 0.17)}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('10/6', 0, -s * 0.02);
    g.restore();
  } else if (variant === 'spade') { // (group 3, round 2: larger, in the heart's crimson with a gilt rim, so the hybrid reads at the landing's distance)
    pipPath(g, variant, cx, cy + W * 0.01, W * 0.2); g.fillStyle = p.spade; g.fill(); g.strokeStyle = p.spadeRim; g.lineWidth = 3.5; g.stroke();
  } else {
    pipPath(g, variant, cx, cy + W * 0.01, W * 0.15); g.fillStyle = variant === 'heart' ? p.heart : p.charge; g.fill(); g.strokeStyle = p.rim; g.lineWidth = 2; g.stroke();
  }
  if (!worn) return;
  // decay: dust in the hollows, the gilt rubbed through, hairline cracks
  g.save(); shieldPath(g, W, H); g.clip();
  for (let i = 0; i < 260; i++) {
    const x = rand() * W; const y = H * 0.2 + rand() * H * 0.8; const r = 0.6 + rand() * 2.4;
    g.fillStyle = rand() < 0.65 ? `rgba(170,162,150,${0.08 + rand() * 0.16})` : `rgba(10,6,6,${0.1 + rand() * 0.2})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  const dust = g.createLinearGradient(0, H * 0.2, 0, H);
  dust.addColorStop(0, 'rgba(160,150,140,0.22)'); dust.addColorStop(0.5, 'rgba(160,150,140,0.05)'); dust.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = dust; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(12,8,8,0.55)'; g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    let x = W * (0.25 + rand() * 0.5); let y = H * 0.25;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (rand() - 0.5) * W * 0.08; y += H * (0.03 + rand() * 0.05); g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
}

function drawCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  return c;
}

/** The arms atlas: two columns (plaque, relief) by four rows (dracul, spade, heart, hatter), and its height map. */
function crestAtlas() {
  const W = CELL_W * FINISHES.length; const H = ATLAS_H;
  const cell = (g, fi, vi, fn) => { g.save(); g.translate(fi * CELL_W, vi * CELL_H); g.beginPath(); g.rect(0, 0, CELL_W, CELL_H); g.clip(); fn(); g.restore(); };
  const colour = drawCanvas(W, H, (g) => {
    drawLabel(g, 0, CELL_H * VARIANTS.length); // the DRINK ME label, in the strip under the arms
    drawBand(g, BAND_X, CELL_H * VARIANTS.length); // and the EAT ME band beside it (group 4)
    VARIANTS.forEach((v, vi) => FINISHES.forEach((fin, fi) => cell(g, fi, vi, () => {
      const rand = S.rng(31 + vi * 7 + fi);
      drawArms(g, CELL_W, CELL_H, v, PAINT[fin], rand, true);
      if (fin === 'relief') { // the panel's stone: grain, and a dark drop under every raised edge
        const img = g.getImageData(0, 0, CELL_W, CELL_H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) { const k = 1 + 0.16 * (rand() - 0.5); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
        g.putImageData(img, 0, 0);
      }
    })));
  });
  const height = drawCanvas(W, H, (g) => {
    VARIANTS.forEach((v, vi) => FINISHES.forEach((fin, fi) => cell(g, fi, vi, () => drawArms(g, CELL_W, CELL_H, v, PAINT.height, S.rng(5), false))));
    drawBand(g, BAND_X, CELL_H * VARIANTS.length, true); // the band's letters raised (group 4)
  });
  const map = new THREE.CanvasTexture(colour); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(height); bump.anisotropy = 4;
  return { map, bump };
}

// ---- the cobweb, drawn once -------------------------------------------------------------------------

/** A web drawn into the triangle (0, 0), (W, 0), (W / 2, H) of its canvas: anchors, spokes, a sagging spiral, a few broken threads. */
function webTexture() {
  const N = 256;
  const c = drawCanvas(N, N, (g) => {
    const rand = S.rng(66);
    const A = [2, 2]; const B = [N - 2, 2]; const C = [N / 2, N - 2];
    const hub = [N / 2 + 6, N * 0.34];
    const thread = (a, alpha = 0.85, wdt = 1.4) => { g.strokeStyle = `rgba(236,232,224,${alpha})`; g.lineWidth = wdt; g.beginPath(); g.moveTo(a[0][0], a[0][1]); for (let i = 1; i < a.length; i++) g.lineTo(a[i][0], a[i][1]); g.stroke(); };
    thread([A, B], 0.9, 1.8); thread([B, C], 0.9, 1.8); thread([C, A], 0.9, 1.8);
    // spokes: from the hub to points round the three edges
    const rim = [];
    const edge = (p, q, n) => { for (let i = 0; i < n; i++) { const k = (i + 0.5) / n; rim.push([lerp(p[0], q[0], k), lerp(p[1], q[1], k)]); } };
    edge(A, B, 6); edge(B, C, 5); edge(C, A, 5);
    for (const r of rim) thread([hub, r], 0.8, 1.3);
    // the spiral: rings of chords between neighbouring spokes, sagging toward the hub, some broken
    for (let ring = 1; ring <= 9; ring++) {
      const f = ring / 10;
      for (let i = 0; i < rim.length; i++) {
        if (rand() < 0.12) continue;
        const a = rim[i]; const b = rim[(i + 1) % rim.length];
        const p = [lerp(hub[0], a[0], f), lerp(hub[1], a[1], f)]; const q = [lerp(hub[0], b[0], f), lerp(hub[1], b[1], f)];
        const m = [lerp(p[0], q[0], 0.5) + (hub[0] - lerp(p[0], q[0], 0.5)) * 0.08, lerp(p[1], q[1], 0.5) + (hub[1] - lerp(p[1], q[1], 0.5)) * 0.08 + 1.5];
        g.strokeStyle = `rgba(232,228,220,${0.55 + 0.3 * rand()})`; g.lineWidth = 1.1;
        g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(m[0], m[1], q[0], q[1]); g.stroke();
      }
    }
    // dust caught in it
    for (let i = 0; i < 40; i++) {
      const k = rand(); const r = rim[Math.floor(rand() * rim.length)];
      g.fillStyle = `rgba(210,204,194,${0.3 + rand() * 0.4})`;
      g.beginPath(); g.arc(lerp(hub[0], r[0], k), lerp(hub[1], r[1], k), 1 + rand() * 2.2, 0, TAU); g.fill();
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dotTexture() {
  const N = 32;
  const c = drawCanvas(N, N, (g) => {
    const grad = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, N, N);
  });
  return new THREE.CanvasTexture(c);
}

// ---- the kit ---------------------------------------------------------------------------------------

export function createVampKit(opts = {}) {
  const time = opts.time || { value: 0 };
  const atlas = crestAtlas();
  const crestMat = new THREE.MeshStandardMaterial({
    map: atlas.map, bumpMap: atlas.bump, bumpScale: 5, roughness: 0.72, metalness: 0.18, alphaTest: 0.5,
    emissive: 0x3a2214, emissiveMap: atlas.map, emissiveIntensity: 0.35, // the gilt holds a little of the candlelight
    vertexColors: true, // (group 4: a quad's own tone, mergeUV's colour from its userData.tone; white for every other)
  });
  // a baked light that holds still (the moon's on what stands in its shaft), beside castle.js's flickering glowMat
  const stillMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  // bone, at 60%: old webs, not new nets (the art critic)
  const webMat = new THREE.MeshLambertMaterial({ map: webTexture(), color: PALETTE.bone, alphaTest: 0.12, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, emissive: 0x16140f });
  const moteMat = new THREE.PointsMaterial({
    size: MOTES.size, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  });
  const [r0, r1, r2] = MOTES.rates;
  moteMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMote;\nattribute float aSize;\nuniform float uTime;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;') // (group 4: a shaft's own share of the size)
      .replace('#include <color_vertex>', `#include <color_vertex>\n  vColor.rgb *= 0.55 + 0.45 * sin( uTime * ${MOTES.twinkle.toFixed(3)} + aMote * 40.0 );`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float s = aMote * 6.2832;
        transformed += vec3( sin( uTime * ${r0.toFixed(3)} + s ), 0.7 * sin( uTime * ${r1.toFixed(3)} + s * 1.7 ), cos( uTime * ${r2.toFixed(3)} + s * 2.3 ) ) * ${MOTES.amp.toFixed(3)};
      }`);
  };
  moteMat.customProgramCacheKey = () => 'vamp-motes';

  const STONE = PALETTE.stone; const SOOT = PALETTE.soot;

  /** A crouching gargoyle on a corbel: h tall, facing +z with its back to the wall at z = 0. */
  function gargoyle(o = {}) {
    const v = o.variant || 'crouch'; const seed = o.seed || 1; const rand = S.rng(seed);
    const k = (o.h || 0.8) / (v === 'hatter' ? 1.12 : 0.9); // (group 3: the Hatter's hat stands over the head, inside h)
    const st = []; const fit = [];
    const c = (hex) => hex;
    const dark = lerp(0.88, 1.05, rand());
    const tone = new THREE.Color(STONE).multiplyScalar(dark * (o.light || 1)).getHex(); // o.light: a paler stone (group 2), so it parts from a dark wall
    let glow = null; // o.glow (the Cheshire one): a baked pale grin and cat's eyes, drawn additive over the carving
    if (o.corbel !== false) {
      const ct = o.corbelTone ? new THREE.Color(tone).multiplyScalar(0.85).getHex() : SOOT; // (group 3, round 2: o.corbelTone, the corbel in the figure's own stone, not a black block)
      st.push(boxG(0.44, 0.15, 0.5, 0, -0.075, 0.25, c(ct), 0.06));
      st.push(boxG(0.32, 0.12, 0.36, 0, -0.21, 0.18, c(ct), 0.06));
      if (o.edge === 'gilt') { // a tarnished gilt fillet round the corbel's lip, so the figure stands off the dark wall
        fit.push(boxG(0.46, 0.035, 0.03, 0, -0.02, 0.5, PALETTE.gold, 0.25));
        for (const sd of [-1, 1]) fit.push(boxG(0.03, 0.035, 0.5, sd * 0.225, -0.02, 0.25, PALETTE.gold, 0.25));
      }
    }
    // haunches and feet, claws over the corbel's lip
    for (const sd of [-1, 1]) {
      st.push(ell(0.13, 0.15, 0.17, sd * 0.12, 0.16, 0.2, tone, 0.14, seed));
      st.push(ell(0.06, 0.04, 0.09, sd * 0.13, 0.035, 0.35, tone));
      for (const cx of [-0.03, 0, 0.03]) st.push(cone(0.012, 0.05, sd * 0.13 + cx, 0.02, 0.45, c(SOOT), 4, Math.PI / 2 + 0.5));
    }
    // body leaning out, chest, forelegs to the lip
    const body = ell(0.16, 0.24, 0.15, 0, 0, 0, tone, 0.14, seed);
    body.rotateX(0.35).translate(0, 0.36, 0.22);
    st.push(body, ell(0.13, 0.14, 0.12, 0, 0.5, 0.32, tone, 0.12, seed));
    const teacup = v === 'teacup';
    for (const sd of [-1, 1]) {
      const paw = teacup ? V3(sd * 0.055, 0.3, 0.5) : V3(sd * 0.1, 0.06, 0.46);
      st.push(rod(V3(sd * 0.09, 0.48, 0.34), paw, 0.036, tone, 6));
      st.push(ell(0.045, 0.032, 0.058, paw.x, paw.y - 0.01, paw.z + 0.01, tone));
    }
    if (teacup) { // the cup held out in both forepaws, on its saucer, the handle to one side
      const cup = [];
      cup.push(cyl(0.075, 0.08, 0.012, 0, 0.255, 0.53, PALETTE.china, 14));
      cup.push(lathe([[0.001, 0], [0.028, 0.002], [0.04, 0.015], [0.05, 0.05], [0.054, 0.068], [0.05, 0.068], [0.044, 0.05], [0.001, 0.05]], 0, 0.267, 0.53, PALETTE.china, 12));
      const handle = torus(0.018, 0.006, 0, 0, 0, PALETTE.china, false, 10); handle.rotateY(Math.PI / 2).translate(0.058, 0.31, 0.53);
      cup.push(handle);
      // (group 3, o.cupFit: the china in the fittings, a third larger, so it keeps its own pale colour and reads as a cup, not as more stone)
      if (o.cupFit) {
        const C = S.merge(cup); C.translate(0, -0.29, -0.53).scale(2.0, 2.0, 2.0).translate(0, 0.29, 0.58).scale(k, k, k);
        if (o.cupTone) { const a = C.attributes.color.array; for (let i = 0; i < a.length; i++) a[i] *= o.cupTone; } // (group 5's fix round: china toned down, so it reads as a cup, not a white blob)
        fit.push(C);
      } else st.push(...cup);
    }
    // the head
    const hy = 0.66; const hz = 0.4;
    if (v === 'cheshire') {
      st.push(ell(0.135, 0.115, 0.12, 0, hy, hz, tone, 0.1, seed));
      const g = S.grin({ width: 0.25, teeth: 12, smile: 0.95, lip: SOOT, tooth: 0xd6d8da, sharp: true, seed });
      g.scale(1, 1, 0.55).translate(0, hy - 0.04, hz + 0.1);
      st.push(g);
      if (o.glow) { // the same grin again, its lips black (nothing added) and its teeth a cool pale, and the eyes lit
        const gg = S.grin({ width: 0.25, teeth: 12, smile: 0.95, lip: 0x000000, tooth: 0xd4e4ee, sharp: true, seed });
        gg.scale(1, 1, 0.55).translate(0, hy - 0.04, hz + 0.1);
        const eyes = [-1, 1].map((sd) => boxG(0.05, 0.016, 0.004, sd * 0.05, hy + 0.035, hz + 0.122, 0xb8f4cc, 0, 0, 0, sd * 0.35));
        // and the grin's crescent itself, a little wider than the mouth, so it reads from across a dark room
        const cr = new THREE.Shape(); const a0 = Math.PI * 1.12; const a1 = Math.PI * 1.88;
        cr.absarc(0, 0.1, 0.17, a0, a1, false); cr.absarc(0, 0.135, 0.13, a1, a0, true);
        const crescent = new THREE.ShapeGeometry(cr, 10); crescent.deleteAttribute('uv'); crescent.translate(0, hy - 0.12, hz + 0.135);
        glow = S.merge([gg, ...eyes, S.tint(crescent, 0x9fb4c0, 0, 1)]);
      }
      for (const sd of [-1, 1]) {
        st.push(cone(0.048, 0.11, sd * 0.075, hy + 0.12, hz - 0.01, tone, 4, -0.2, -sd * 0.35)); // cat's ears
        st.push(boxG(0.045, 0.012, 0.01, sd * 0.05, hy + 0.035, hz + 0.115, 0x101012, 0, 0, 0, sd * 0.35)); // slit eyes
      }
    } else {
      st.push(ell(0.11, 0.1, 0.12, 0, hy, hz, tone, 0.12, seed));
      st.push(boxG(0.11, 0.07, 0.13, 0, hy - 0.03, hz + 0.11, tone, 0.1));
      st.push(boxG(0.09, 0.03, 0.11, 0, hy - 0.085, hz + 0.1, tone, 0.1, 0, 0.3));
      st.push(boxG(0.19, 0.03, 0.05, 0, hy + 0.05, hz + 0.08, tone, 0.1));
      for (const sd of [-1, 1]) {
        st.push(cone(0.012, 0.05, sd * 0.035, hy - 0.085, hz + 0.155, 0xd0d2d4, 4, 0, 0, true)); // fangs
        if (v !== 'hatter') st.push(cone(0.03, 0.2, sd * 0.06, hy + 0.12, hz - 0.03, tone, 5, -0.75, -sd * 0.35)); // horns swept back (the hat sits there)
        st.push(cone(0.036, 0.1, sd * 0.105, hy + 0.06, hz - 0.02, tone, 4, -0.1, -sd * 0.7)); // bat's ears
        st.push(boxG(0.03, 0.018, 0.01, sd * 0.042, hy + 0.025, hz + 0.115, 0x121214, 0)); // deep-set eyes
      }
      if (v === 'hatter') { // group 3: the Hatter's tall hat, cocked back on the horned head, the 10/6 card in its crimson band (fittings: it keeps its colours)
        const hat = [];
        hat.push(cyl(0.165, 0.165, 0.016, 0, 0, 0, 0x2a1f2e, 18)); // the brim
        hat.push(lathe([[0.001, 0.014], [0.092, 0.014], [0.086, 0.09], [0.094, 0.24], [0.112, 0.31], [0.001, 0.31]], 0, 0, 0, 0x3a2a40, 14)); // the crown (round 2: a notch darker, never the brightest thing there), flared at the top
        hat.push(cyl(0.095, 0.094, 0.05, 0, 0.03, 0, PALETTE.crimson, 14)); // the band
        const card = boxG(0.128, 0.09, 0.006, 0, 0, 0, 0xf2ece0, 0.03); card.rotateZ(0.25).translate(0.05, 0.09, 0.088); // the card, tucked in the band (round 2: half as big again, white)
        hat.push(card);
        // "10/6" inked on it: a one, a nought, a stroke and a six, in four marks (half as big again with the card)
        for (const [x, w, hgt, rz] of [[0.02, 0.005, 0.026, 0], [0.035, 0.012, 0.024, 0], [0.051, 0.004, 0.03, -0.5], [0.066, 0.012, 0.024, 0]]) {
          const X = 0.05 + (x - 0.043) * 1.5;
          const mk = boxG(w * 1.5, hgt * 1.5, 0.002, 0, 0, 0, 0x1a1214, 0, 0, 0, rz); mk.rotateZ(0.25).translate(X, 0.09 + (X - 0.05) * 0.25, 0.0925); hat.push(mk);
        }
        const H = S.merge(hat); H.scale(1.25, 1.25, 1.25).rotateX(-0.28).rotateZ(0.12).translate(0, hy + 0.075, hz - 0.03).scale(k, k, k); // (with the carving's own scale)
        fit.push(H);
      }
    }
    // wings: folded down the back, or spread
    if (v === 'spread' || o.wings === 'spread') {
      for (const sd of [-1, 1]) {
        const w = extrude(wingShape(), 0.025, tone, 0.12);
        w.scale(0.5, 0.5, 1).rotateZ(0.35).rotateX(-0.3).translate(0.1, 0.58, 0.14);
        st.push(sd < 0 ? mirrorX(w) : w);
      }
    } else {
      for (const sd of [-1, 1]) {
        const s = new THREE.Shape();
        s.moveTo(0.08, 0.56); s.lineTo(0.03, 0.82); s.lineTo(-0.05, 0.64); s.quadraticCurveTo(-0.12, 0.52, -0.1, 0.4);
        s.quadraticCurveTo(-0.06, 0.32, -0.09, 0.2); s.quadraticCurveTo(-0.03, 0.14, 0.0, 0.08); s.lineTo(0.08, 0.3); s.closePath();
        const w = extrude(s, 0.03, tone, 0.12);
        w.rotateY(-Math.PI / 2).translate(0.16 + 0.03, 0, 0.2);
        st.push(sd < 0 ? mirrorX(w) : w);
      }
    }
    // the tail, round the corbel's edge
    const tail = [V3(0, 0.1, 0.06), V3(0.15, 0.04, 0.05), V3(0.24, 0.025, 0.18), V3(0.2, 0.02, 0.32), V3(0.13, 0.02, 0.38)];
    for (let i = 0; i + 1 < tail.length; i++) st.push(rod(tail[i], tail[i + 1], 0.028 - i * 0.004, tone, 5));
    st.push(cone(0.03, 0.06, 0.1, 0.02, 0.41, tone, 4, Math.PI / 2));
    const stone = S.merge(st);
    stone.scale(k, k, k);
    if (glow) glow.scale(k, k, k);
    return { stone, fit: fit.length ? S.merge(fit) : null, glow };
  }

  /** A carved bat flat on a wall, wings spread, w across; the watch variant has a pocket-watch hanging from a claw. */
  function bat(o = {}) {
    const w = o.w || 0.6; const st = []; const fit = [];
    const tone = new THREE.Color(PALETTE.stone).multiplyScalar(o.light || 1).getHex(); // o.light: paler (group 2)
    for (const sd of [-1, 1]) {
      const wing = extrude(wingShape(), 0.035, tone, 0.12);
      wing.scale(0.46, 0.46, 1).translate(0.05, 0.3, 0.015);
      st.push(sd < 0 ? mirrorX(wing) : wing);
    }
    st.push(ell(0.065, 0.12, 0.05, 0, 0.27, 0.045, tone), ell(0.05, 0.048, 0.05, 0, 0.41, 0.06, tone));
    for (const sd of [-1, 1]) {
      st.push(cone(0.02, 0.07, sd * 0.028, 0.47, 0.06, tone, 4, 0, -sd * 0.25));
      st.push(cone(0.012, 0.06, sd * 0.03, 0.14, 0.05, tone, 4, 0, 0, true));
      st.push(boxG(0.012, 0.008, 0.006, sd * 0.018, 0.418, 0.105, 0x141416, 0));
    }
    if (o.variant === 'watch') { // a pocket-watch on a short chain from the right foot
      // big enough to read as a watch at a few metres (the art critic)
      const top = V3(0.03, 0.12, 0.06); const at = V3(0.06, -0.04, 0.07); const R = 0.085 * (o.watchK || 1); // (group 4, o.watchK: a larger face, to read from a door)
      fit.push(rod(top, at, 0.006, PALETTE.gold, 4));
      const caseG = new THREE.CylinderGeometry(R, R, 0.022, 16); caseG.deleteAttribute('uv'); caseG.rotateX(Math.PI / 2).translate(at.x, at.y - R - 0.01, at.z);
      fit.push(S.tint(caseG, PALETTE.gold, 0.15, 2));
      const dial = new THREE.CircleGeometry(R * 0.82, 16); dial.deleteAttribute('uv'); dial.translate(at.x, at.y - R - 0.01, at.z + 0.0115);
      fit.push(S.tint(dial, PALETTE.bone, 0.05, 3));
      fit.push(boxG(0.006, R * 0.6, 0.002, at.x, at.y - R + R * 0.25, at.z + 0.0125, 0x101010, 0), boxG(R * 0.45, 0.006, 0.002, at.x + R * 0.18, at.y - R - 0.01, at.z + 0.0125, 0x101010, 0, 0, 0, 0.5));
      fit.push(cyl(0.012, 0.012, 0.018, at.x, at.y - 0.012, at.z, PALETTE.gold, 6));
    }
    const stone = S.merge(st); const sk = w / 0.9;
    stone.scale(sk, sk, Math.min(1.4, sk)).rotateZ(o.tilt || 0);
    let f = null;
    if (fit.length) { f = S.merge(fit); f.scale(sk, sk, Math.min(1.4, sk)).rotateZ(o.tilt || 0); }
    return { stone, fit: f };
  }

  /** The arms, w by h, standing on y = 0, facing +z: the atlas quad and its stone (a tablet behind a plaque, a moulded frame round a relief). */
  function crest(o = {}) {
    const vi = Math.max(0, VARIANTS.indexOf(o.variant || 'dracul')); const fi = o.finish === 'relief' ? 1 : 0;
    const w = o.w || 1.2; const h = o.h || 1.45; const proud = o.proud == null ? 0.1 : o.proud;
    const quad = new THREE.PlaneGeometry(w, h);
    const uv = quad.attributes.uv;
    const u0 = fi / FINISHES.length; const u1 = (fi + 1) / FINISHES.length;
    const v1 = 1 - (vi * CELL_H) / ATLAS_H; const v0 = 1 - ((vi + 1) * CELL_H) / ATLAS_H;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
    quad.translate(0, h / 2, proud);
    const st = [];
    if (fi === 0) { // a plain tablet the plaque is fixed to, a little proud of the wall
      st.push(ST.block(0, h * 0.18, proud * 0.4, w * 0.92, h * 0.8, proud * 0.8, 0x9a9da2, 0.08));
    } else { // the panel the relief is cut in: a frame round it
      const t = 0.07; const d = proud;
      st.push(ST.block(0, -t, d / 2, w + 2 * t, t, d + 0.02, 0xb4b7bb), ST.block(0, h, d / 2, w + 2 * t, t, d + 0.02, 0xb4b7bb));
      for (const sd of [-1, 1]) st.push(ST.block(sd * (w / 2 + t / 2), 0, d / 2, t, h, d + 0.02, 0xb4b7bb));
      st.push(ST.block(0, 0, d / 2 - 0.01, w, h, d - 0.02, 0x8a8d92));
    }
    let fit = null;
    if (o.frame === 'gilt') { // a gilded frame gone dull: a moulded bar each side, corner bosses, cracks and a lost corner of gilt
      const f = []; const t = 0.075; const d = proud + 0.035; const rand = S.rng(w * 100 + h);
      const bar = (bw, bh, x, y) => f.push(boxG(bw, bh, d, x, y, d / 2, PALETTE.gold, 0.35), boxG(Math.max(0.02, bw - 0.04), Math.max(0.02, bh - 0.04), 0.012, x, y, d + 0.005, PALETTE.goldDim, 0.3));
      bar(w + 2 * t, t, 0, h + t / 2); bar(w + 2 * t, t, 0, -t / 2);
      for (const sd of [-1, 1]) bar(t, h, sd * (w / 2 + t / 2), h / 2);
      for (const sx of [-1, 1]) for (const sy of [0, 1]) f.push(ell(t * 0.7, t * 0.7, 0.03, sx * (w / 2 + t / 2), sy ? h + t / 2 : -t / 2, d + 0.01, sx > 0 && sy ? PALETTE.soot : PALETTE.gold, 0.3)); // one boss lost to the stone
      for (let i = 0; i < 5; i++) { // cracks across the gilt
        const side = i % 4; const k = 0.15 + rand() * 0.7;
        const x = side < 2 ? lerp(-w / 2, w / 2, k) : (side === 2 ? -1 : 1) * (w / 2 + t / 2);
        const y = side < 2 ? (side ? h + t / 2 : -t / 2) : lerp(0, h, k);
        f.push(boxG(side < 2 ? 0.008 : t * 1.02, side < 2 ? t * 1.02 : 0.008, 0.006, x, y, d + 0.012, 0x0e0b08, 0, 0, 0, (rand() - 0.5) * 0.6));
      }
      fit = S.merge(f);
    }
    return { quad, stone: S.merge(st), fit };
  }

  /** A coffin stood upright in a stone niche, w wide, h tall, its iron-bound lid facing out; spade: a suit on the lid. */
  function coffin(o = {}) {
    const W = o.w || 1.0; const H = o.h || 2.3; const proud = o.proud || 0.15;
    const st = []; const fit = [];
    const aw = W - 0.24; const rise = aw * 0.6;
    st.push(ST.surround({ at: 0, w: aw, h: H - 0.1, rise }, { profile: ST.PROFILE.plain.map(([a, b]) => [a * 0.5, b * 0.55]), hex: 0xc8cbcf }).translate(0, 0.08, 0));
    st.push(ST.block(0, 0, 0.08, W, 0.08, 0.16, 0xb8bbbf));
    // the dark of the niche: its outline, flat against the wall
    const back = new THREE.Shape();
    const pts = ST.archPoints(aw, rise, 8);
    back.moveTo(-aw / 2, 0.08); back.lineTo(-aw / 2, 0.08 + H - 0.1 - rise);
    for (const [ax, ay] of pts) back.lineTo(ax, 0.08 + H - 0.1 - rise + ay);
    back.lineTo(aw / 2, 0.08); back.closePath();
    const bg = new THREE.ShapeGeometry(back, 2); bg.deleteAttribute('uv'); bg.translate(0, 0, 0.006);
    st.push(ST.paint(bg, 0x4a4644, { vary: 0.25 }));
    // the lid: a coffin's six sides, the wood dark and dry, three iron bands, corner irons and a ring
    const L = Math.min(1.8, H - 0.35); const y0 = 0.1; // the lid's top at 1.9 m, over the eye
    const half = (y) => { const k = (y - y0) / L; return k < 0.72 ? lerp(0.17, 0.29, k / 0.72) : lerp(0.29, 0.2, (k - 0.72) / 0.28); };
    const lid = new THREE.Shape();
    lid.moveTo(-0.17, y0); lid.lineTo(0.17, y0); lid.lineTo(0.29, y0 + 0.72 * L); lid.lineTo(0.2, y0 + L); lid.lineTo(-0.2, y0 + L); lid.lineTo(-0.29, y0 + 0.72 * L); lid.closePath();
    const lg = extrude(lid, 0.085, o.lid === 'pale' ? 0x8a6444 : o.lid === 'moon' ? 0x332c34 : PALETTE.wood, 0.28, 0.012); // o.lid pale: a weathered lid that reads in a dim room lg.translate(0, 0, 0.02);
    fit.push(lg);
    const front = 0.02 + 0.085 + 0.012;
    for (const k of [0.16, 0.5, 0.84]) {
      const y = y0 + k * L; const hw = half(y) + 0.018;
      fit.push(boxG(hw * 2, 0.05, 0.016, 0, y, front + 0.004, PALETTE.iron, 0.12));
      for (const sd of [-1, 1]) fit.push(boxG(0.022, 0.022, 0.012, sd * (hw - 0.03), y, front + 0.014, PALETTE.rust, 0.1)); // rivets
    }
    for (const [x, y] of [[-0.29, y0 + 0.72 * L], [0.29, y0 + 0.72 * L], [-0.2, y0 + L], [0.2, y0 + L], [-0.17, y0], [0.17, y0]]) fit.push(boxG(0.06, 0.06, 0.02, x * 0.94, y + (y > y0 + 0.5 * L ? -0.02 : 0.02), front + 0.002, PALETTE.iron, 0.1));
    const ring = torus(0.05, 0.009, 0, 0, 0, PALETTE.iron, false, 12); ring.translate(0, y0 + 0.5 * L - 0.075, front + 0.02);
    fit.push(ring);
    if (o.variant === 'spade') {
      const pip = S.pip('spade', 0.24, PALETTE.iron); pip.translate(0, y0 + 0.67 * L, front + 0.003);
      fit.push(pip);
    }
    void proud;
    return { stone: S.merge(st), fit: S.merge(fit) };
  }

  /** One candle in its pan or teacup at (x, y, z): the parts, and where its flame burns. */
  function candle(fit, x, y, z, rand, cupped, drip = 1, K = 1) { // K: the teacup's size (a larger cup is a paler china, to read from the floor)
    const hc = 0.08 + rand() * 0.14;
    if (cupped) {
      const china = K > 1 ? 0xf6f2ea : PALETTE.china;
      fit.push(cyl(0.07 * K, 0.072 * K, 0.01 * K, x, y, z, china, 12));
      fit.push(lathe([[0.001, 0], [0.025, 0.002], [0.036, 0.014], [0.045, 0.045], [0.048, 0.06], [0.044, 0.06], [0.04, 0.045], [0.001, 0.045]].map(([a, b]) => [a * K, b * K]), x, y + 0.01 * K, z, china, 10));
      const handle = torus(0.016 * K, 0.005 * K, 0, 0, 0, china, false, 8); handle.rotateY(rand() * TAU).translate(x + 0.05 * K, y + 0.045 * K, z);
      fit.push(handle);
    } else {
      fit.push(cyl(0.065, 0.075, 0.018, x, y, z, PALETTE.iron, 10));
      fit.push(cyl(0.03, 0.03, 0.04, x, y + 0.018, z, PALETTE.iron, 8));
    }
    const base = y + (cupped ? 0.03 * K : 0.05);
    fit.push(cyl(0.021, 0.019, hc, x, base, z, PALETTE.wax, 7, 0.04));
    // wax: a long run down the side, a pool on the pan, drips hanging off its rim
    const a = rand() * TAU;
    fit.push(ell(0.007 * drip, hc * 0.35, 0.007 * drip, x + Math.cos(a) * 0.021, base + hc * 0.55, z + Math.sin(a) * 0.021, PALETTE.wax, 0.05));
    fit.push(ell(0.034, 0.011, 0.034, x, base + 0.002, z, PALETTE.wax, 0.06));
    const dr = 2 + Math.floor(rand() * 3); const drips = LEAN ? 2 : dr;
    for (let i = 0; i < drips; i++) {
      const b = rand() * TAU; const r = cupped ? 0.048 * K : 0.068;
      fit.push(cone((0.007 + rand() * 0.004) * drip, (0.03 + rand() * 0.08) * drip, x + Math.cos(b) * r, y - 0.02 - rand() * 0.02, z + Math.sin(b) * r, PALETTE.wax, 4, 0, 0, true));
    }
    return [x, base + hc + 0.004, z, 0.065];
  }

  /** An iron chandelier on chains, w across, its lowest point at y = 0 and its chain h up to the ceiling. */
  function chandelier(o = {}) {
    const n = o.arms || 8; const R = (o.w || 1.8) / 2; const H = o.h || 3; const rand = S.rng(o.seed || 9);
    const cupped = o.variant === 'teacup';
    const fit = []; const flames = []; const webs = [];
    const I = PALETTE.iron;
    fit.push(cone(0.05, 0.2, 0, 0.1, 0, I, 6, 0, 0, true));
    fit.push(cyl(0.035, 0.035, 0.6, 0, 0.18, 0, I, 6));
    fit.push(ell(0.075, 0.05, 0.075, 0, 0.3, 0, I, 0.1, 0, 8, 5), ell(0.06, 0.06, 0.06, 0, 0.72, 0, I, 0.1, 0, 8, 5));
    const ring = o.ring || 1; // o.ring: the iron rings' thickness, a share of the first
    fit.push(torus(R * 0.94, 0.024 * ring, 0, 0.42, 0, I, true, 28), torus(R * 0.46, 0.018 * ring, 0, 0.36, 0, I, true, 18));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const p = [V3(ca * 0.05, 0.32, sa * 0.05), V3(ca * R * 0.45, 0.28, sa * R * 0.45), V3(ca * R * 0.8, 0.34, sa * R * 0.8), V3(ca * R, 0.48, sa * R)];
      for (let k = 0; k + 1 < p.length; k++) fit.push(rod(p[k], p[k + 1], 0.017, I, 5));
      // a scroll under the arm
      fit.push(rod(V3(ca * R * 0.6, 0.29, sa * R * 0.6), V3(ca * R * 0.66, 0.2, sa * R * 0.66), 0.01, I, 4));
      flames.push(candle(fit, ca * R, 0.49, sa * R, rand, cupped, 1.6, o.cups || 1)); // years of wax: thick drips
    }
    // the chains: four up from the ring to a hub, one from the hub to the rose on the ceiling
    const hub = V3(0, Math.min(1.3, H - 0.4), 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.2 + Math.PI / n;
      fit.push(rod(V3(Math.cos(a) * R * 0.94, 0.42, Math.sin(a) * R * 0.94), hub, 0.009, I, 4));
    }
    fit.push(torus(0.05, 0.012, hub.x, hub.y, hub.z, I, true, 10));
    const step = LEAN ? 0.24 : 0.16; // (lean: longer links, fewer of them, on a long chain)
    if (o.rod) fit.push(cyl(0.018, 0.018, H - 0.1 - hub.y, 0, hub.y, 0, I, 5)); // (group 3, o.rod: a long drop under a high vault on a plain iron rod)
    for (let y = hub.y; !o.rod && y < H - 0.12; y += step) { // links, alternately turned
      const l = torus(0.035, 0.008, 0, 0, 0, I, false, 8);
      if (Math.round(y / step) % 2) l.rotateY(Math.PI / 2);
      l.scale(1, step * 10, 1).translate(0, y + step / 2, 0);
      fit.push(l);
    }
    fit.push(cyl(0.14, 0.1, 0.05, 0, H - 0.05, 0, I, 10));
    // decay: webs strung between two arms and a chain, and between the ring and the stem
    for (const i of [1, Math.floor(n / 2) + 1]) {
      const a = (i / n) * TAU + 0.2; const b = ((i + 1) / n) * TAU + 0.2;
      webs.push([[Math.cos(a) * R * 0.9, 0.45, Math.sin(a) * R * 0.9], [Math.cos(b) * R * 0.9, 0.45, Math.sin(b) * R * 0.9], [Math.cos((a + b) / 2) * R * 0.35, 0.95, Math.sin((a + b) / 2) * R * 0.35]]);
    }
    webs.push([[R * 0.46, 0.37, 0], [0.04, 0.6, 0], [R * 0.3, 0.12, 0.12]]);
    return { fit: S.merge(fit), flames, webs };
  }

  /** An iron candelabra on a wall bracket, w across, its backplate standing on y = 0, the arms rising out of the wall. */
  function candelabra(o = {}) {
    const n = o.arms || 5; const W = o.w || 0.7; const rand = S.rng(o.seed || 4); const cupped = o.variant === 'teacup';
    const fit = []; const flames = []; const I = PALETTE.iron;
    fit.push(boxG(0.14, 0.34, 0.025, 0, 0.17, 0.0125, I, 0.1));
    fit.push(boxG(0.1, 0.06, 0.02, 0, 0.34, 0.02, I, 0.1));
    const out = 0.24;
    fit.push(rod(V3(0, 0.22, 0.02), V3(0, 0.24, out), 0.016, I, 5), rod(V3(0, 0.05, 0.02), V3(0, 0.22, out - 0.02), 0.012, I, 4));
    fit.push(rod(V3(-W / 2 + 0.04, 0.24, out), V3(W / 2 - 0.04, 0.24, out), 0.014, I, 5));
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0.5 : i / (n - 1);
      const x = lerp(-W / 2 + 0.05, W / 2 - 0.05, k);
      const top = 0.36 + 0.08 * (1 - Math.abs(k - 0.5) * 2);
      fit.push(rod(V3(x * 0.85, 0.24, out), V3(x, top - 0.04, out), 0.012, I, 4));
      flames.push(candle(fit, x, top, out, rand, cupped, 1, o.cups || 1)); // (group 4, o.cups: larger, paler teacups for pans, so the hybrid reads from the floor)
    }
    return { fit: S.merge(fit), flames };
  }

  /** The cracked DRINK ME bottle cut in a lintel, w across, h tall, standing on y = 0 (stone). */
  function bottle(o = {}) {
    const w = o.w || 0.3; const h = o.h || 0.5; const st = [];
    const k = h / 0.5;
    const tone = o.gilt ? PALETTE.gold : 0xb4b7bb; // o.gilt: the bottle gilded (group 2), so the candle's glow finds it
    st.push(lathe([[0.001, 0], [0.09, 0], [0.1, 0.03], [0.1, 0.2], [0.07, 0.27], [0.03, 0.31], [0.028, 0.4], [0.035, 0.42], [0.001, 0.43]], 0, 0, 0, tone, 10).scale(1, 1, 0.35));
    st.push(cyl(0.03, 0.024, 0.06, 0, 0.42, 0, 0x9a9da2, 6).scale(1, 1, 0.35)); // the cork
    st.push(ST.block(0, 0.08, 0.032, 0.13, 0.08, 0.012, 0xd0d2d4, 0.04)); // the label
    // the crack: a dark zig-zag down the shoulder
    let x = 0.04; let y = 0.26;
    for (let i = 0; i < 4; i++) { const nx = x - 0.02 + (i % 2) * 0.03; const ny = y - 0.045; st.push(rod(V3(x, y, 0.036), V3(nx, ny, 0.036), 0.0045, 0x1a1a1c, 3)); x = nx; y = ny; }
    const g = S.merge(st); g.scale(k * w / 0.3 * 1.0, k, 1);
    let quad = null; // o.label: DRINK ME lettered on the label (the arms' atlas, its strip under the arms)
    if (o.label) {
      quad = new THREE.PlaneGeometry(0.17, 0.07);
      const uv = quad.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * LABEL_W / (CELL_W * FINISHES.length), uv.getY(i) * LABEL_H / ATLAS_H);
      quad.translate(0, 0.12, 0.04).scale(k * w / 0.3, k, 1);
    }
    return o.gilt ? { stone: null, fit: g, quad } : { stone: g, quad };
  }

  /**
   * Group 4: a carved band cut over a door, w by h, standing on y = 0, facing +z: the atlas's EAT ME (gilt letters
   * and two little cakes in a crimson field) on a moulded stone tablet, a tarnished gilt fillet round it.
   */
  function band(o = {}) {
    const w = o.w || 1.2; const h = o.h || w * LABEL_H / BAND_W; const proud = o.proud == null ? 0.06 : o.proud;
    const quad = new THREE.PlaneGeometry(w, h);
    const uv = quad.attributes.uv; const AW = CELL_W * FINISHES.length;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(BAND_X / AW, (BAND_X + BAND_W) / AW, uv.getX(i)), uv.getY(i) * LABEL_H / ATLAS_H);
    quad.translate(0, h / 2, proud - 0.015); // 5 mm before the tablet's panel (its face at proud - 0.02), inside the frame
    const t = 0.05;
    const st = [ST.block(0, -t, proud / 2, w + 2 * t, t, proud + 0.02, 0xb4b7bb), ST.block(0, h, proud / 2, w + 2 * t, t, proud + 0.02, 0xb4b7bb)];
    for (const sd of [-1, 1]) st.push(ST.block(sd * (w / 2 + t / 2), 0, proud / 2, t, h, proud + 0.02, 0xb4b7bb));
    st.push(ST.block(0, 0, proud / 2 - 0.01, w, h, proud - 0.02, 0x8a8d92));
    const f = [];
    for (const y of [h + t / 2, -t / 2]) f.push(boxG(w + 2 * t, 0.016, 0.01, 0, y, proud + 0.017, PALETTE.gold, 0.3)); // a gilt line along the middle of the top and bottom bars
    return { quad, stone: S.merge(st), fit: S.merge(f) };
  }

  /** Cobwebs: one triangle per [a, b, c] (world points), uv'd to the drawn web. */
  function webs(tris) {
    const pos = new Float32Array(tris.length * 9); const nor = new Float32Array(tris.length * 9); const uv = new Float32Array(tris.length * 6);
    const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3(); const N = new THREE.Vector3(); const T = new THREE.Vector3();
    tris.forEach((t, i) => {
      A.fromArray(t[0]); B.fromArray(t[1]); C.fromArray(t[2]);
      N.subVectors(B, A).cross(T.subVectors(C, A)).normalize();
      [A, B, C].forEach((p, k) => { p.toArray(pos, i * 9 + k * 3); N.toArray(nor, i * 9 + k * 3); });
      uv.set([0, 1, 1, 1, 0.5, 0], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  /**
   * A baked pool of candlelight: a disc (or ellipse) of additive vertex colour, bright at c and nothing
   * at the rim. a and b are its two half-axes as vectors (the disc's plane), rgb the light's colour.
   */
  function glowDisc(c, a, b, rgb, strength) {
    const SEG = 18; const pos = []; const col = []; const idx = [];
    const RINGS = [[0.42, 0.32], [1, 0]];
    pos.push(c[0], c[1], c[2]); col.push(rgb[0] * strength, rgb[1] * strength, rgb[2] * strength);
    for (const [f, share] of RINGS) {
      for (let i = 0; i <= SEG; i++) {
        const t = (i / SEG) * TAU; const ca = Math.cos(t) * f; const sa = Math.sin(t) * f;
        pos.push(c[0] + a[0] * ca + b[0] * sa, c[1] + a[1] * ca + b[1] * sa, c[2] + a[2] * ca + b[2] * sa);
        col.push(rgb[0] * strength * share, rgb[1] * strength * share, rgb[2] * strength * share);
      }
    }
    const ring = SEG + 1;
    for (let i = 0; i < SEG; i++) idx.push(0, 1 + i, 2 + i);
    for (let i = 0; i < SEG; i++) idx.push(1 + i, 1 + ring + i, 2 + i, 2 + i, 1 + ring + i, 2 + ring + i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  /** The dust: every shaft of a zone as one Points geometry (base positions, colour by tone and light, a seed each). */
  function motes(vols, seed = 1) {
    const parts = vols.map((v, i) => ({ v, m: motePoints(v, seed * 31 + i * 7) }));
    const n = parts.reduce((s, p) => s + p.v.n, 0);
    const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3); const sd = new Float32Array(n);
    let o = 0;
    for (const { v, m } of parts) {
      const tone = v.variant === 'moon' ? [0.5, 0.56, 0.68] : v.variant === 'dawn' ? [1.0, 0.8, 0.5] : [0.95, 0.62, 0.36]; // (group 5: the dawn's gold)
      pos.set(m.positions, o * 3);
      sd.set(m.seeds, o);
      for (let i = 0; i < v.n; i++) for (let k = 0; k < 3; k++) col[(o + i) * 3 + k] = tone[k] * m.glow[i] * 0.6;
      o += v.n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMote', new THREE.BufferAttribute(sd, 1));
    // (group 4) each shaft's own point size, a share of MOTES.size (v.size, 1 when absent): a narrow passage's dust smaller, so it reads as motes up close
    const sz = new Float32Array(n); o = 0;
    for (const { v } of parts) { sz.fill(v.size || 1, o, o + v.n); o += v.n; }
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += MOTES.amp * 2;
    return g;
  }

  /** Merges position, normal and uv (the crest quads and the webs). */
  function mergeUV(list) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    const out = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
      const total = parts.reduce((s, p) => s + p.attributes[name].count, 0);
      const arr = new Float32Array(total * size);
      let o = 0;
      for (const p of parts) { arr.set(p.attributes[name].array, o); o += p.attributes[name].count * size; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    // (group 4) a colour for every vertex: each part's userData.tone ([r, g, b], white when it has none), so one quad can be drawn darker
    const total = parts.reduce((s, p) => s + p.attributes.position.count, 0);
    const col = new Float32Array(total * 3); let o = 0;
    parts.forEach((p, i) => { const t = list[i].userData.tone || [1, 1, 1]; for (let k = 0; k < p.attributes.position.count; k++, o++) col.set(t, o * 3); });
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }

  // ---- group 3: the White Knight, fallen off the board and broken (logic/vamp.js WRECK) ----

  /**
   * A turned solid about local +y through pts [[r, y], ...] (bottom to top), seg sides, each end cut in a
   * jagged break (jag [bottom, top]: how far the break wanders up and down, 0 for a clean end), the broken
   * faces closed in a duller, coarser ivory. Its outside is ivory. Returns one geometry (vertex colour).
   */
  function broken(pts, seg, jag, rand, hex) {
    const n = pts.length; const pos = []; const idx = [];
    const off = jag.map((j) => Array.from({ length: seg }, () => j * (rand() * 2 - 1)));
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * TAU; const [r, y] = pts[i];
        const dy = i === 0 ? off[0][k] : i === n - 1 ? off[1][k] : 0;
        pos.push(Math.sin(a) * r, y + dy, Math.cos(a) * r);
      }
    }
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) { const p = i * seg + k; const q = i * seg + (k + 1) % seg; idx.push(p, q, p + seg, q, q + seg, p + seg); }
    const side = new THREE.BufferGeometry(); side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); side.setIndex(idx); side.computeVertexNormals();
    const out = [S.tint(side, hex, 0.06, rand() * 9)];
    for (const [end, up] of [[0, false], [n - 1, true]]) { // the broken faces: a fan from a rough middle to the jagged rim
      if (!jag[end ? 1 : 0] && !(end === 0 && pts[0][0] > 0.001)) continue;
      if (pts[end][0] < 0.001) continue; // a closed point needs no face
      const cp = []; let my = 0;
      for (let k = 0; k < seg; k++) my += pos[(end * seg + k) * 3 + 1] / seg;
      const c = [0, my + (up ? 1 : -1) * jag[end ? 1 : 0] * 0.4 * rand(), 0];
      for (let k = 0; k < seg; k++) {
        const p = (end * seg + k) * 3; const q = (end * seg + (k + 1) % seg) * 3;
        const A = [pos[p], pos[p + 1], pos[p + 2]]; const B = [pos[q], pos[q + 1], pos[q + 2]];
        cp.push(...c, ...(up ? A : B), ...(up ? B : A));
      }
      const face = new THREE.BufferGeometry(); face.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); face.computeVertexNormals();
      out.push(S.tint(face, end === 0 && !jag[0] ? hex : 0xcdc2a6, end === 0 && !jag[0] ? 0.06 : 0.22, rand() * 9)); // a fresh break: duller, grainier
    }
    return S.merge(out);
  }

  /**
   * Lies one of the Gryphon's carved pieces (chessmen.js carveGryphon, in its own frame) down as it fell:
   * scaled by s, turned by rot ([x, y, z] radians, applied x, then y, then z, about the world axes), its
   * long axis then along +x, and its footprint's middle moved to the origin, so W.parts' oriented len by
   * 2r rectangle is its footprint exactly (setDown sets it on the floor).
   */
  function lie(g, [rot, s]) {
    g.scale(s, s, s).rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]);
    g.computeBoundingBox(); const b = g.boundingBox;
    return g.translate(-(b.min.x + b.max.x) / 2, 0, -(b.min.z + b.max.z) / 2);
  }
  // how each piece lies, and its scale (the white pieces' figures stand 2 m and more over their bases; the head is
  // carved largest, so it reads from the way in): the body sat where it fell off the base, tipped onto his right side
  // on the broken platform's rim, so his profile (rump, thighs, breast, forelegs, raised tail and wing) shows from the
  // side (the fix round: on his side he read as a toppled carving), facing +z; the head upright on its neck's break and the hook of its beak, the beak toward +x, its profile
  // to the side; the wing open and flat, its feathers toward +z
  const LIE = { body: [[0, 0, 0.35], 1.15], head: [[0.22, Math.PI / 2, 0], 1.3], wing: [[0, 0, 0], 1.2],
    beak: [[0, 0, 0.3], 1.3], claw: [[0, 0, 0.2], 1.15], plume: [[0, 0, 0], 1.3] };

  /** Sets a geometry down on the floor at y0 (its lowest point a hair above it), then turns it yaw about y and moves it to (x, z). */
  function setDown(g, y0, yaw, x, z) {
    g.computeBoundingBox();
    return g.translate(0, y0 + 0.003 - g.boundingBox.min.y, 0).rotateY(-yaw).translate(x, 0, z);
  }

  /**
   * moonRim(g, k) -> g: a cold moon edge baked into the vertex colour (round 2, no light): every vertex whose
   * normal turns up or toward dir ([x, y, z], default straight up) takes k of the moon's colour on top of its own,
   * as far as it faces that way. For iron in the moon's room and the white knight's top faces.
   */
  function moonRim(g, k, dir = [0, 1, 0], from = 0.3) {
    const n = g.attributes.normal; const c = g.attributes.color;
    if (!n || !c) return g;
    const m = Math.max(...MOON_RGB); const rgb = MOON_RGB.map((v) => v / m);
    for (let i = 0; i < n.count; i++) {
      const d = n.getX(i) * dir[0] + n.getY(i) * dir[1] + n.getZ(i) * dir[2];
      if (d <= from) continue;
      const t = k * (d - from) / (1 - from);
      c.setXYZ(i, c.getX(i) + t * rgb[0], c.getY(i) + t * rgb[1], c.getZ(i) + t * rgb[2]);
    }
    return g;
  }

  /**
   * wreck(W, y0, seed) -> one vertex-coloured geometry in world space, for the fittings (castle.js tints it
   * with vamp.js wreckTint): the set's white knight, the Gryphon (chessmen.js carveGryphon, carved as the
   * other white pieces are, on the set's turned base), in his pieces where W.parts has them lying (the base's
   * stub upright, the body on its side, the head on its neck's break, the snapped wing open), his chips and
   * a faint scatter of ivory dust on the flags.
   */
  function wreck(W, y0, seed = 7) {
    const rand = S.rng(seed); const I = W.ivory; const parts = [];
    const G = carveGryphon(seed).parts; // the Gryphon himself, carved as the white pieces are (chessmen.js)
    for (const p of W.parts) {
      if (p.id === 'foot') {
        // the foot of the turned base (plinth, torus, ogee and the bulb), broken across above the bulb, standing
        // (round 2: up through the gadrooned bulb into the waisted neck, so the stub shows the set's turned profile)
        const R = p.r; const H = 0.95; // PIECE_FOOT.knight
        const footPts = [[0, 0], [1, 0], [1, 0.05], [0.98, 0.075], [0.95, 0.1], [0.98, 0.125], [0.9, 0.146], [0.9, 0.178], [0.75, 0.25], [0.6, 0.33], [0.61, 0.384],
          [0.66, 0.43], [0.67, 0.47], [0.62, 0.53], [0.5, 0.57], [0.44, 0.61], [0.42, 0.65]].map(([r, y]) => [r * R, y * H]);
        parts.push(setDown(broken(footPts, 10, [0, 0.04], rand, I), y0, p.yaw, p.x, p.z));
      } else if (G[p.id]) parts.push(setDown(lie(G[p.id], LIE[p.id]), y0, p.yaw, p.x, p.z)); // his pieces, where they lie
    }
    // the chips: his own (the gilt tip of the beak, a talon, a crest feather) and flakes of ivory, each resting on the flags at its own angle
    for (const [x, z, s, yaw, kind] of W.chips) {
      if (kind) { parts.push(setDown(lie(G[kind], LIE[kind]), y0, yaw, x, z)); continue; }
      const c = new THREE.OctahedronGeometry(s, 0); c.deleteAttribute('uv'); c.scale(1, 0.5, 0.8).rotateX(0.3 + rand() * 0.4);
      parts.push(setDown(S.tint(c, rand() < 0.5 ? I : 0xcdc2a6, 0.12, x * 3), y0, yaw, x, z));
    }
    for (const g of Object.values(G)) if (!parts.includes(g)) g.dispose();
    // a faint cold moon rim on every face turned up, so the pieces sit in the room's light (round 2: no light added, colour only)
    // (the fix round: only as far as the carving is pale, so the dark cuts, the gape and the eye, keep their warm dark and take no blue)
    const lit = S.merge(parts); parts.length = 0;
    const was = Float32Array.from(lit.attributes.color.array); moonRim(lit, 0.35);
    const cc = lit.attributes.color.array; const pale = 0.6; // the ivory's darker shading (linear) and above take the whole rim
    for (let i = 0; i < cc.length; i += 3) {
      const w = Math.min(1, Math.max(0, (was[i] + was[i + 1] + was[i + 2]) / 3 / pale)) ** 2;
      for (let j = 0; j < 3; j++) cc[i + j] = was[i + j] + (cc[i + j] - was[i + j]) * w;
    }
    parts.push(lit);
    // a faint scatter: flecks of ivory dust lying flat round it, thinning out
    const sc = W.scatter; const fl = [];
    for (let i = 0; i < sc.n; i++) {
      const a = rand() * TAU; const d = Math.sqrt(rand()) * sc.r; const s = 0.025 + rand() * 0.035; const t = rand() * TAU;
      const x = sc.x + Math.cos(a) * d; const z = sc.z + Math.sin(a) * d;
      for (let k = 0; k < 3; k++) { const u = t + (k * TAU) / 3 * -1; fl.push(x + Math.cos(u) * s, y0 + 0.004, z + Math.sin(u) * s); }
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fl, 3)); fg.computeVertexNormals();
    parts.push(S.tint(fg, 0xb8b09c, 0.2, 5));
    return S.merge(parts);
  }

  function dispose() {
    for (const m of [crestMat, webMat, moteMat, stillMat]) { if (m.map) m.map.dispose(); if (m.bumpMap) m.bumpMap.dispose(); m.dispose(); }
  }

  const leanly = (fn) => (o = {}) => lean(o, () => fn(o)); // o.lean: the lean build
  return {
    materials: { crest: crestMat, web: webMat, motes: moteMat, still: stillMat },
    gargoyle: leanly(gargoyle), bat: leanly(bat), crest, coffin: leanly(coffin), chandelier: leanly(chandelier), candelabra: leanly(candelabra), bottle: leanly(bottle),
    webs, glowDisc, motes, mergeUV, dispose,
    wreck, moonRim, // group 3
    band, // group 4
  };
}
