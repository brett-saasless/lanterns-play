// Every figure in the castle: the two suits of twisted armour with their Beefeater pikes and the
// hatter's price tags, the phantom wife and the painting she leaves, the ghost at the tea table,
// the Beefeater skeleton, the raven, the werewolf painting's arm, the March Hare and the dead nun
// chained in the crypt, the rats, the snakes in the pit, the Count rising from his box of earth,
// the bats, the warden's reflection and the tall figure (both on the glass-only layer), and the
// portraits whose sculpted heads turn to follow the warden (busts.js, logic/headturn.js; the
// werewolf's painted eyes follow as before). All built in code with the sculpting kit, as the cave's creatures.
//
// The views read sim state and events only. The armour and the wife are creatures in sim.enemies
// (factories registered with actors.js); everything else is a set per castle zone, built the first
// time the shell (castle.js) shows that zone, parented under the shell's zone group so it is drawn
// exactly when the zone is (the mirror pass included), and freed when the castle is left or the
// zone has been out of sight for a while.
//
// Layers (design, Decisions): 0 both cameras; 1 the eye only (the sitters in the gallery's
// portraits); 2 the glass only (the warden's own figure and the tall figure).
//
// Draw calls and triangles per figure: registerKeepcast(...).counts() measures whatever is built.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { TAGS } from '../logic/script.js';
import { nextCurtain } from '../logic/count.js';
import { countStage, newCountStage, pyreClock } from '../logic/countlid.js'; // the lid and his rise, as keepprops.js draws the lid
import * as MAP from '../logic/keepmap.js';
import { reflectionOf } from '../logic/reflection.js';
import { batGeometry, batFlap } from './roadview.js'; // K7: the road's bat, at the swarm's scale
import { DRESS } from './roadcreature.js'; // the werewolf-beefeater's uniform: the painting wears it too
import { bustGeometry, bustSet, BUST } from './busts.js';
import { headYawToward, headSeen, HEAD_TURN } from '../logic/headturn.js';
import { EMERGE, emergeAt } from '../logic/emerge.js'; // the wife coming out of her painting
import { CLAW_EMERGE, clawStrikeAt, clawPoseAt } from '../logic/clawemerge.js'; // the werewolf's painted hand coming out to strike
import { SUIT_RODS, SUIT_REST, heapLayout, planFall, trackAt } from '../logic/debris.js'; // a fallen suit's pieces, kept out of stone
import { cutawayAt, CUTAWAY } from '../logic/cutaway.js'; // the werewolf cutaway: it poses the fighting suit at the real door
const CUT_SUIT = CUTAWAY.guard.suit;

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const approach = (cur, goal, dt, rate) => cur + (goal - cur) * Math.min(1, dt * rate);
const frac = (x) => x - Math.floor(x);
const wrap = (a) => a - TAU * Math.round(a / TAU);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);
const _a = V(); const _b = V(); const _c = V(); const _d = V(); const _e = V();
const _x = V(); const _y = V(); const _z = V(); const _t = V(); const _u = V();
const _m = new THREE.Matrix4(); const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(); const _q2 = new THREE.Quaternion();
const _col = new THREE.Color(); const _c2 = new THREE.Color();
const _o = new THREE.Object3D();
const ONE = V(1, 1, 1);

// The design's hues (UI direction, "Look, the world").
const IRON = 0x3e4248;
const RUST = 0x5b3a26;
const EMBER = 0xff2a1a;
const PHANTOM = 0xbfd4e6;
const GILT = 0x9c7a3c;
const RED = 0x7a0f14;
const BONE = 0xd8cfb4;
const INK = 0x121116;
const SCARLET = 0xb3121b;
const GOLD = 0xc9a227;
const LAYER_EYE = 1;
const LAYER_GLASS = 2;
const UPPER = MAP.UPPER;
const FAR = 70; // metres past which a creature's view is not posed
const IDLE_FREE = 45; // seconds a zone's set may stay unseen before it is freed

// ---- small tools ------------------------------------------------------------------------------

const mesh = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; return m; };
const ball = (r, x, y, z, hex, sx = 1, sy = 1, sz = 1, vary = 0.12) => S.tint(new THREE.SphereGeometry(r, 8, 6).scale(sx, sy, sz).translate(x, y, z), hex, vary, x * 7 + y);
const slab = (w, h, d, x, y, z, hex, vary = 0.12) => S.tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex, vary, x * 3 + z);
const spike = (r, h, hex, seg = 5) => S.tint(new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0), hex, 0.2, r * 91);
/** A geometry turned so its +Y lies along `dir`, then moved to `at`. */
function aimed(geo, at, dir) {
  _q.setFromUnitVectors(_y.set(0, 1, 0), _t.set(dir[0], dir[1], dir[2]).normalize());
  geo.applyQuaternion(_q);
  return geo.translate(at[0], at[1], at[2]);
}

/** Sets obj at `butt` with its +Y along `dir` and its -Z as near `fwd` as that allows (as cast.js). */
function aim(obj, butt, dir, fwd) {
  _y.copy(dir).normalize();
  _z.copy(fwd).multiplyScalar(-1).addScaledVector(_y, _y.dot(fwd));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  obj.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  obj.position.copy(butt);
}

/** Upper arm, forearm and a mitten at instances i, i+1, i+2 (as cast.js). Pulls `hand` into reach. */
function placeArm(L, i, sh, hand, l1, l2, bend, r, elbow, mitt = 1.12) {
  _t.subVectors(hand, sh);
  const d = _t.length(); const max = (l1 + l2) * 0.985;
  if (d > max) hand.copy(sh).addScaledVector(_t, max / d);
  S.ik2(sh, hand, l1, l2, bend, elbow);
  L.place(i, sh, elbow, r);
  L.place(i + 1, elbow, hand, r * 0.82);
  _t.subVectors(hand, elbow).normalize();
  _u.copy(hand).addScaledVector(_t, r * 2);
  L.place(i + 2, hand, _u, r * mitt);
}

/** Thigh, shin and a foot at instances i, i+1, i+2. `toe` is the unit way the foot points. */
function placeLeg(L, i, hip, ankle, l1, l2, bend, r, toe, knee, foot = 2.5) {
  _t.subVectors(ankle, hip);
  const d = _t.length(); const max = (l1 + l2) * 0.985;
  if (d > max) ankle.copy(hip).addScaledVector(_t, max / d);
  S.ik2(hip, ankle, l1, l2, bend, knee);
  L.place(i, hip, knee, r);
  L.place(i + 1, knee, ankle, r * 0.76);
  _t.copy(ankle).addScaledVector(toe, -r * 0.5);
  _u.copy(ankle).addScaledVector(toe, r * foot);
  L.place(i + 2, _t, _u, r * 0.86);
}

/** A canvas texture drawn once in code. */
function drawn(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const css = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

/** Frees what a view or a set built for itself; the kit's shared materials are left alone. */
function freeTree(root, keep) {
  root.traverse((m) => {
    if (!m.isMesh && !m.isSprite && !m.isPoints) return;
    if (m.geometry && !m.isSprite) m.geometry.dispose();
    if (m.isInstancedMesh) m.dispose();
    const mat = m.material;
    if (mat && !keep.has(mat)) {
      if (mat.map && mat.userData.ownMap) mat.map.dispose();
      mat.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}

const setLayer = (root, n) => root.traverse((o) => o.layers.set(n));

/** The castle shell's zone group for a keepmap zone id, and the floor height there. */
const SHELL_OF = { approach: 'outside', bridge: 'outside', forecourt: 'outside', pit: 'outside', crypt: 'gallery', passage: 'landing', countway: 'landing' };
const shellOf = (zone) => SHELL_OF[zone] || zone || 'outside';

/** Which way a thing on a wall faces (its heading into the room), from the nearest side of the zone's rectangle. */
function facingIn(zoneId, x, z) {
  const zn = MAP.ZONES.find((q) => q.id === zoneId);
  let best = 0; let bd = Infinity;
  if (zn) {
    for (const r of zn.rects) {
      const sides = [[Math.abs(z - r.maxZ), 0], [Math.abs(z - r.minZ), Math.PI], [Math.abs(x - r.maxX), Math.PI / 2], [Math.abs(x - r.minX), -Math.PI / 2]];
      for (const [d, yaw] of sides) if (d < bd) { bd = d; best = yaw; }
    }
  }
  return best;
}

// ---- paint: the sitters, the wives and the werewolf, drawn on canvas ----------------------------
// Each painter draws into a cell w by h and returns its eyes: [{ x, y, r, hex? }] in the cell's
// pixels (the middle of the white and its half width). The irises are not painted: they are small
// discs laid on the canvas, moved a little late toward wherever the warden stands (the werewolf's).
// A sitter painted with relief: true (every sitter and wife, the owner's 2026-11-18 ask: "the eyes
// turning is not visible") gets no painted face: paintRelief returns the head to stand there instead.

function varnish(g, w, h, seed) {
  // craquelure and a dark edge: old paint under old varnish
  g.strokeStyle = 'rgba(8,6,4,0.35)';
  g.lineWidth = 0.6;
  for (let i = 0; i < 26; i++) {
    let x = hash(i, seed) * w; let y = hash(i + 40, seed) * h;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (hash(i, k + seed) - 0.5) * 26; y += (hash(k, i + seed) - 0.3) * 22; g.lineTo(x, y); }
    g.stroke();
  }
}

/** A long, pale, unsmiling face. o: skin, hair, s (half width of the face), kind 'lord' | 'lady' | 'wife'. */
function paintSitter(g, cx, cy, s, o) {
  const skin = o.skin || 0xcfc8b6;
  const dark = 'rgba(20,14,16,0.55)';
  // shoulders and dress
  const cloth = g.createLinearGradient(0, cy + s * 2, 0, cy + s * 5.6);
  cloth.addColorStop(0, css(o.dress || 0x15131a)); cloth.addColorStop(1, css(o.dress || 0x15131a, 0.25));
  g.fillStyle = cloth;
  g.beginPath();
  g.moveTo(cx - s * 2.6, cy + s * 5.6); g.quadraticCurveTo(cx - s * 2.3, cy + s * 2.3, cx - s * 0.6, cy + s * 2.0);
  g.lineTo(cx + s * 0.6, cy + s * 2.0); g.quadraticCurveTo(cx + s * 2.3, cy + s * 2.3, cx + s * 2.6, cy + s * 5.6);
  g.closePath(); g.fill();
  if (o.kind === 'lord') { // a high collar and a pale stock
    g.fillStyle = css(0x0c0b10);
    g.beginPath(); g.moveTo(cx - s * 1.5, cy + s * 2.6); g.lineTo(cx - s * 1.15, cy + s * 0.9); g.lineTo(cx - s * 0.5, cy + s * 2.3); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(cx + s * 1.5, cy + s * 2.6); g.lineTo(cx + s * 1.15, cy + s * 0.9); g.lineTo(cx + s * 0.5, cy + s * 2.3); g.closePath(); g.fill();
    g.fillStyle = css(0xb9b4a4, 0.8);
    g.beginPath(); g.moveTo(cx - s * 0.45, cy + s * 2.05); g.lineTo(cx + s * 0.45, cy + s * 2.05); g.lineTo(cx, cy + s * 3.4); g.closePath(); g.fill();
  } else { // a bare throat, a grave-white gown
    g.fillStyle = css(skin, 0.9);
    g.beginPath(); g.moveTo(cx - s * 0.5, cy + s * 1.6); g.lineTo(cx + s * 0.5, cy + s * 1.6); g.lineTo(cx + s * 0.9, cy + s * 2.9); g.lineTo(cx - s * 0.9, cy + s * 2.9); g.closePath(); g.fill();
  }
  if (o.relief) return paintRelief(g, cx, cy, s, o);
  // hair behind the face
  g.fillStyle = css(o.hair || 0x0d0b0c);
  g.beginPath();
  if (o.kind === 'lord') g.ellipse(cx, cy - s * 0.55, s * 1.18, s * 1.5, 0, Math.PI * 0.9, Math.PI * 2.1);
  else { // long, unbound, falling past the shoulders in a ragged edge
    g.moveTo(cx - s * 1.3, cy - s * 0.4);
    g.bezierCurveTo(cx - s * 1.45, cy - s * 2.6, cx + s * 1.45, cy - s * 2.6, cx + s * 1.3, cy - s * 0.4);
    g.bezierCurveTo(cx + s * 1.5, cy + s * 1.6, cx + s * 2.0, cy + s * 3.2, cx + s * 1.75, cy + s * 4.9);
    for (let k = 0; k <= 8; k++) g.lineTo(cx + s * (1.75 - k * 0.44), cy + s * (4.9 - (k % 2) * 0.5 - 0.35 * Math.sin(k * 0.4)));
    g.bezierCurveTo(cx - s * 2.0, cy + s * 3.2, cx - s * 1.5, cy + s * 1.6, cx - s * 1.3, cy - s * 0.4);
  }
  g.fill();
  // the face: long, narrow at the jaw
  g.fillStyle = css(skin);
  g.beginPath();
  g.moveTo(cx - s, cy - s * 0.6);
  g.bezierCurveTo(cx - s * 1.05, cy - s * 2.1, cx + s * 1.05, cy - s * 2.1, cx + s, cy - s * 0.6);
  g.bezierCurveTo(cx + s * 0.98, cy + s * 1.0, cx + s * 0.45, cy + s * 2.15, cx, cy + s * 2.2);
  g.bezierCurveTo(cx - s * 0.45, cy + s * 2.15, cx - s * 0.98, cy + s * 1.0, cx - s, cy - s * 0.6);
  g.fill();
  // lit from above and to one side: the brow bright, the jaw falling into shadow
  const lit = g.createRadialGradient(cx - s * 0.25, cy - s * 0.9, s * 0.2, cx, cy + s * 0.4, s * 2.4);
  lit.addColorStop(0, 'rgba(255,250,240,0.28)'); lit.addColorStop(0.5, 'rgba(0,0,0,0)'); lit.addColorStop(1, 'rgba(20,12,16,0.7)');
  g.save(); g.clip(); g.fillStyle = lit; g.fillRect(cx - s * 1.2, cy - s * 2.2, s * 2.4, s * 4.6); g.restore();
  // hollows: temples, cheeks, the sockets
  const hollow = (x, y, rx, ry, a = 0.5) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, `rgba(30,20,28,${a})`); gr.addColorStop(1, 'rgba(30,20,28,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
  };
  hollow(cx - s * 0.62, cy + s * 0.75, s * 0.42, s * 0.8); hollow(cx + s * 0.62, cy + s * 0.75, s * 0.42, s * 0.8);
  const ey = cy - s * 0.32; const ex = s * 0.42; const er = s * 0.2;
  hollow(cx - ex, ey, s * 0.42, s * 0.36, 0.75); hollow(cx + ex, ey, s * 0.42, s * 0.36, 0.75);
  // the whites, and a heavy lid over each
  for (const sx of [-1, 1]) {
    g.fillStyle = css(o.white || 0xe9e4d6);
    g.beginPath(); g.ellipse(cx + sx * ex, ey, er, er * 0.62, 0, 0, TAU); g.fill();
    g.strokeStyle = dark; g.lineWidth = Math.max(1, s * 0.07);
    g.beginPath(); g.ellipse(cx + sx * ex, ey - er * 0.1, er * 1.1, er * 0.7, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    // brows, drawn down toward the nose
    g.strokeStyle = css(o.brow || o.hair || 0x0d0b0c); g.lineWidth = Math.max(1.5, s * 0.1);
    g.beginPath(); g.moveTo(cx + sx * (ex + er * 1.3), ey - er * 1.25); g.lineTo(cx + sx * (ex - er * 1.0), ey - er * 0.8); g.stroke();
  }
  // the nose: one long shadow; the mouth: thin, level, a little wrong at one corner
  g.strokeStyle = dark; g.lineWidth = Math.max(1, s * 0.06);
  g.beginPath(); g.moveTo(cx + s * 0.06, ey + s * 0.1); g.lineTo(cx + s * 0.14, cy + s * 0.78); g.lineTo(cx - s * 0.08, cy + s * 0.84); g.stroke();
  g.strokeStyle = css(o.lip || 0x5a1a1e, 0.9); g.lineWidth = Math.max(1.2, s * 0.08);
  g.beginPath(); g.moveTo(cx - s * 0.36, cy + s * 1.3); g.lineTo(cx + s * 0.3, cy + s * 1.3); g.lineTo(cx + s * 0.44, cy + s * 1.2); g.stroke();
  if (o.kind === 'lord') { // a long white moustache
    g.strokeStyle = css(0xd9d6cc, 0.95); g.lineWidth = Math.max(2, s * 0.13);
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * s * 0.06, cy + s * 1.08); g.quadraticCurveTo(cx + sx * s * 0.5, cy + s * 1.1, cx + sx * s * 0.62, cy + s * 1.75); g.stroke(); }
  }
  if (o.fangs) {
    g.fillStyle = '#efe8d4';
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * s * 0.16, cy + s * 1.3); g.lineTo(cx + sx * s * 0.1, cy + s * 1.52); g.lineTo(cx + sx * s * 0.04, cy + s * 1.3); g.fill(); }
  }
  const white = o.white || 0xe9e4d6;
  return [{ x: cx - ex, y: ey, r: er, white }, { x: cx + ex, y: ey, r: er, white }];
}

/**
 * The canvas under a sculpted head (busts.js, the owner's 2026-11-18 ask): the shoulders and the
 * dress are painted as before, the head is not (no double head). Under where the head stands: the
 * canvas's dark ground, the shadow the head casts on it (down and to the right, away from the
 * painting's light), and for a lady the ends of her hair on her shoulders. Returns no eyes and
 * the head to stand there: { eyes: [], heads: [{ x, y, s, look }] } in the cell's pixels (x, y the
 * face's middle, s its half width).
 */
function paintRelief(g, cx, cy, s, o) {
  const fy = cy - s * 0.32 + s * BUST.eyes; // the face's middle: the head's eyes where the painted ones were
  const sh = g.createRadialGradient(cx + s * 0.35, fy + s * 0.5, s * 0.3, cx + s * 0.35, fy + s * 0.5, s * 2.6);
  sh.addColorStop(0, 'rgba(6,4,5,0.75)'); sh.addColorStop(0.6, 'rgba(6,4,5,0.35)'); sh.addColorStop(1, 'rgba(6,4,5,0)');
  g.fillStyle = sh;
  g.beginPath(); g.ellipse(cx + s * 0.35, fy + s * 0.5, s * 1.9, s * 2.8, 0, 0, TAU); g.fill();
  if (o.kind !== 'lord') { // the ends of long hair, lying on the shoulders either side of the throat
    g.fillStyle = css(o.hair || 0x0d0b0c);
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * s * 0.75, cy + s * 2.6);
      g.quadraticCurveTo(cx + sx * s * 1.55, cy + s * 2.9, cx + sx * s * 1.75, cy + s * 4.9);
      for (let k = 0; k <= 4; k++) g.lineTo(cx + sx * s * (1.75 - k * 0.22), cy + s * (4.9 - (k % 2) * 0.45));
      g.quadraticCurveTo(cx + sx * s * 1.0, cy + s * 3.4, cx + sx * s * 0.55, cy + s * 2.7);
      g.closePath(); g.fill();
    }
  }
  return { eyes: [], heads: [{ x: cx, y: fy, s, look: o }] };
}

const SITTERS = [
  { kind: 'lord', hair: 0x9a968c, brow: 0x6e6a62, dress: 0x101014, skin: 0x8f8372 }, // grey-ivory, a third darker (art critic: he read as a white mask)
  { kind: 'lady', hair: 0x1a1210, dress: 0x3a0d12, skin: 0xd6cfbf },
  { kind: 'lord', hair: 0x1c1a1c, dress: 0x16181d, skin: 0xbfb9a8, fangs: true },
  { kind: 'lady', hair: 0x8a7a52, dress: 0x1b1d22, skin: 0xd8d2c4 },
  { kind: 'lord', hair: 0x2a1d16, dress: 0x1d1210, skin: 0xc7bfae },
  { kind: 'lady', hair: 0x0e0c0e, dress: 0x101014, skin: 0xcfc9bb, fangs: true },
];

/** A portrait's sitter: one of six, by index. */
const sitter = (n) => (g, w, h) => {
  const out = paintSitter(g, w / 2, h * 0.36, w * 0.13, { ...SITTERS[n % SITTERS.length], relief: true });
  varnish(g, w, h, n + 3);
  return out;
};

/** The two wives who stay (the cell is the whole canvas), or the one who leaves (alone, on clear). */
const WIFE_LOOKS = [
  { kind: 'wife', hair: 0x0e0b0d, dress: 0xb9b6ac, skin: 0xd8d3c6, fangs: true }, // the dark one who steps out
  { kind: 'wife', hair: 0x9c8a55, dress: 0xc2beb2, skin: 0xdcd7ca }, // the fair one
  { kind: 'wife', hair: 0x17110f, dress: 0xaeaaa0, skin: 0xd2ccbe },
];
const wivesWhoStay = (g, w, h) => {
  const a = paintSitter(g, w * 0.52, h * 0.3, w * 0.062, { ...WIFE_LOOKS[1], relief: true });
  const b = paintSitter(g, w * 0.82, h * 0.36, w * 0.06, { ...WIFE_LOOKS[2], relief: true });
  varnish(g, w, h, 21);
  return { eyes: [], heads: [...a.heads, ...b.heads] };
};
// where the one who leaves is painted (logic/keepmap.js, where the sim seats her): the ghost comes off the canvas there (buildWife, wifeSpot)
const WIFE_SPOT = MAP.WIFE_SPOT;
const wifeWhoLeaves = (g, w, h) => paintSitter(g, w * WIFE_SPOT.u, h * WIFE_SPOT.v, w * WIFE_SPOT.s, { ...WIFE_LOOKS[0], relief: true });

/**
 * The werewolf: hunched in a dark wood in what is left of the Yeoman Warder's state dress he wears
 * running up the hill (roadcreature.js, its own colours: DRESS): the weathered Tudor red with its
 * dulled gold bands and belt and a scrap of the badge, the soiled ruff, the flat bonnet askew with
 * his ears up through it, fur at the neck, the cuffs and the hands. One clawed hand is raised at the
 * front of the canvas (its own layer, paintWerewolfHand: it is the hand that strikes), four long hooked claws, bone at the tips (MAP.WEREWOLF_CLAW, as the arm that
 * comes out of it), large enough to read across the room; the other hangs. Yellow eyes, which the
 * iris discs lie on (their place and size as before).
 */
function paintWerewolf(g, w, h) {
  const cx = w * 0.5; const cy = h * 0.34; const s = w * 0.14;
  const D = DRESS;
  // the dark wood, a little mist low between the trunks
  g.strokeStyle = 'rgba(10,12,10,0.9)';
  for (let i = 0; i < 7; i++) { g.lineWidth = 6 + hash(i, 5) * 16; const x = hash(i, 9) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (hash(i, 2) - 0.5) * 30, h); g.stroke(); }
  const mist = g.createLinearGradient(0, h * 0.62, 0, h);
  mist.addColorStop(0, 'rgba(60,70,64,0)'); mist.addColorStop(1, 'rgba(60,70,64,0.22)');
  g.fillStyle = mist; g.fillRect(0, h * 0.62, w, h * 0.38);
  // shade over a painted shape: lit from the upper left, falling to near black at the lower right
  const shade = (x0, y0, x1, y1, a = 0.75) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(255,236,210,0.06)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, `rgba(4,2,2,${a})`);
    g.fillStyle = gr; g.fill();
  };
  const fur = (x, y, r, n, seed, col = 'rgba(92,80,68,0.75)', len = 7) => {
    g.strokeStyle = col; g.lineWidth = 1.4;
    for (let i = 0; i < n; i++) {
      const a = hash(i, seed) * TAU; const d = Math.sqrt(hash(i, seed + 1)) * r;
      const px = x + Math.cos(a) * d; const py = y + Math.sin(a) * d * 0.8;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + (hash(i, seed + 2) - 0.5) * 6, py + len * (0.6 + hash(i, seed + 3))); g.stroke();
    }
  };
  // the hunched back and shoulders in the red coat, clipped for its gold bands and shading
  const back = () => {
    g.beginPath(); g.ellipse(cx + s * 0.3, cy + s * 2.5, s * 2.6, s * 2.45, -0.3, 0, TAU);
    g.ellipse(cx - s * 1.45, cy + s * 4.4, s * 0.85, s * 2.0, 0.25, 0, TAU);
  };
  // the coat's red, painted down under old varnish (the art critic: the castle's canvases are ivory,
  // black and ink; the runner's TUDOR lit reads as the one saturated thing there): a deeper red
  const COAT = 0x6a1e22;
  g.fillStyle = css(COAT); back(); g.fill();
  g.save(); back(); g.clip();
  // the gold: two bands round the body, the belt below, what is left of the badge on the breast
  g.strokeStyle = css(D.TRIM, 0.85); g.lineWidth = s * 0.16;
  for (const k of [1.55, 1.95]) { g.beginPath(); g.ellipse(cx + s * 0.1, cy + s * (k + 2.4), s * 2.8, s * 1.1, -0.25, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); }
  g.lineWidth = s * 0.26;
  g.beginPath(); g.ellipse(cx + s * 0.2, cy + s * 5.6, s * 2.6, s * 0.9, -0.25, Math.PI * 1.05, Math.PI * 1.9); g.stroke();
  g.fillStyle = css(D.TRIM, 0.7);
  g.beginPath(); g.moveTo(cx - s * 0.75, cy + s * 2.15); g.lineTo(cx - s * 0.35, cy + s * 2.05); g.lineTo(cx - s * 0.25, cy + s * 2.6); g.lineTo(cx - s * 0.55, cy + s * 2.9); g.lineTo(cx - s * 0.85, cy + s * 2.6); g.closePath(); g.fill();
  // wear and dirt: dark scrapes through the red and the gold
  g.strokeStyle = 'rgba(14,8,8,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 40; i++) { const x = cx + (hash(i, 31) - 0.4) * s * 4.4; const y = cy + s * (1.2 + hash(i, 32) * 5); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hash(i, 33) - 0.5) * 10, y + 4 + hash(i, 34) * 9); g.stroke(); }
  // folds: a few darker strokes at the shoulder and down the back
  g.strokeStyle = 'rgba(20,6,8,0.55)'; g.lineCap = 'round';
  for (const [x0, y0, x1, y1, x2, y2, wd] of [[1.2, 1.3, 1.9, 2.2, 2.0, 3.3, 0.16], [-0.9, 1.7, -1.5, 2.6, -1.4, 3.6, 0.12], [0.5, 3.6, 1.3, 4.2, 2.1, 4.1, 0.1]]) {
    g.lineWidth = s * wd;
    g.beginPath(); g.moveTo(cx + s * x0, cy + s * y0); g.quadraticCurveTo(cx + s * x1, cy + s * y1, cx + s * x2, cy + s * y2); g.stroke();
  }
  g.lineCap = 'butt';
  back(); shade(cx - s * 2.2, cy + s * 0.8, cx + s * 2.6, cy + s * 6.2, 0.82);
  // a black glaze over the lower third of him
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, cy + s * 4.3, w, h);
  g.restore();
  // fur where the coat has gone: the mane over the hump behind the head, and at the neck
  fur(cx + s * 0.7, cy + s * 0.9, s * 1.5, 160, 41);
  fur(cx, cy + s * 1.5, s * 0.9, 70, 47, 'rgba(70,59,51,0.85)');
  // the ruff: a soiled, crushed ring of pleats under the jaw
  g.fillStyle = css(D.RUFF, 0.9);
  g.beginPath();
  for (let k = 0; k <= 24; k++) {
    const a = (k / 24) * TAU; const r = k % 2 ? 1 : 1.13;
    const x = cx + Math.cos(a) * s * 1.38 * r; const y = cy + s * 1.42 + Math.sin(a) * s * 0.42 * r;
    if (k) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.fill();
  g.strokeStyle = 'rgba(40,32,24,0.6)'; g.lineWidth = 1;
  for (let k = 0; k < 12; k++) { const a = Math.PI * (0.05 + (k / 11) * 0.9); g.beginPath(); g.moveTo(cx + Math.cos(a) * s * 0.5, cy + s * 1.42 + Math.sin(a) * s * 0.15); g.lineTo(cx + Math.cos(a) * s * 1.4, cy + s * 1.42 + Math.sin(a) * s * 0.44); g.stroke(); }
  g.fillStyle = 'rgba(52,40,26,0.35)'; // stains
  for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(cx + (hash(k, 51) - 0.5) * s * 2.2, cy + s * (1.45 + hash(k, 52) * 0.3), s * 0.18, s * 0.08, 0, 0, TAU); g.fill(); }
  // the arm that hangs, in its red sleeve, fur at the cuff, the hand low in the dark
  g.strokeStyle = css(D.TUDOR); g.lineCap = 'round'; g.lineWidth = s * 0.62;
  g.beginPath(); g.moveTo(cx - s * 1.7, cy + s * 2.3); g.quadraticCurveTo(cx - s * 2.25, cy + s * 4.0, cx - s * 1.9, cy + s * 5.3); g.stroke();
  fur(cx - s * 1.9, cy + s * 5.45, s * 0.38, 40, 61, css(D.FUR, 0.9), 6);
  g.fillStyle = css(D.FUR_DARK); g.beginPath(); g.ellipse(cx - s * 1.85, cy + s * 5.85, s * 0.3, s * 0.38, 0.2, 0, TAU); g.fill();
  for (let i = 0; i < 3; i++) { // short claws hanging
    const x = cx - s * (2.05 - i * 0.2);
    g.strokeStyle = css(D.CLAW, 0.85); g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, cy + s * 6.1); g.quadraticCurveTo(x - 1, cy + s * 6.45, x + 3, cy + s * 6.6); g.stroke();
  }
  // the dark closes in round him (before the raised hand, which stands in front of it all)
  const vig = g.createRadialGradient(cx, cy + s * 1.5, s * 2.2, cx, cy + s * 1.5, h * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vig; g.fillRect(0, 0, w, h);
  // the head: a long muzzle, the teeth (as it always was: the eyes lie where they were)
  g.fillStyle = css(0x1e1a18);
  g.beginPath(); g.ellipse(cx, cy, s * 1.05, s * 1.1, 0, 0, TAU); g.fill();
  g.fillStyle = css(0x2c2622);
  g.beginPath(); g.moveTo(cx - s * 0.55, cy + s * 0.2); g.lineTo(cx + s * 0.55, cy + s * 0.2); g.lineTo(cx + s * 0.32, cy + s * 1.7); g.lineTo(cx - s * 0.32, cy + s * 1.7); g.fill();
  g.fillStyle = '#0a0606';
  g.beginPath(); g.ellipse(cx, cy + s * 1.38, s * 0.42, s * 0.3, 0, 0, TAU); g.fill();
  g.fillStyle = '#e6dfc6';
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(cx + i * s * 0.11 - s * 0.045, cy + s * 1.17); g.lineTo(cx + i * s * 0.11, cy + s * (Math.abs(i) === 2 ? 1.5 : 1.36)); g.lineTo(cx + i * s * 0.11 + s * 0.045, cy + s * 1.17); g.fill(); }
  g.fillStyle = '#0c0808';
  g.beginPath(); g.ellipse(cx, cy + s * 0.25, s * 0.2, s * 0.13, 0, 0, TAU); g.fill();
  const ey = cy - s * 0.25; const ex = s * 0.45; const er = s * 0.17;
  for (const sx of [-1, 1]) {
    g.fillStyle = '#d9b23a';
    g.beginPath(); g.ellipse(cx + sx * ex, ey, er, er * 0.6, sx * 0.3, 0, TAU); g.fill();
    g.strokeStyle = '#0a0808'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx + sx * (ex + er * 1.4), ey - er * 1.3); g.lineTo(cx + sx * (ex - er * 1.2), ey - er * 0.35); g.stroke();
  }
  // the flat bonnet, askew on the skull above the brows, its velvet worn grey
  g.save(); g.translate(cx + s * 0.06, cy - s * 0.95); g.rotate(0.1);
  g.fillStyle = css(0x4a4748); // the runner's bonnet (DRESS.BONNET) taken toward a neutral grey: the room's cool light made it read purple
  g.beginPath(); g.ellipse(0, 0, s * 1.45, s * 0.3, 0, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(-s * 0.85, -s * 0.05); g.quadraticCurveTo(-s * 0.9, -s * 0.5, 0, -s * 0.52); g.quadraticCurveTo(s * 0.9, -s * 0.5, s * 0.85, -s * 0.05); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(160,150,170,0.25)'; g.lineWidth = 1.5; // the worn nap catching the light
  g.beginPath(); g.ellipse(0, -s * 0.02, s * 1.4, s * 0.26, 0, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
  g.restore();
  // the ears, up through the bonnet: tall, pointed, a paler hollow inside
  for (const sx of [-1, 1]) {
    g.fillStyle = css(D.FUR_DARK);
    g.beginPath(); g.moveTo(cx + sx * s * 0.95, cy - s * 0.95); g.lineTo(cx + sx * s * 1.3, cy - s * 2.05); g.lineTo(cx + sx * s * 0.42, cy - s * 1.1); g.closePath(); g.fill();
    g.fillStyle = css(0x6a5246, 0.8);
    g.beginPath(); g.moveTo(cx + sx * s * 0.86, cy - s * 1.1); g.lineTo(cx + sx * s * 1.2, cy - s * 1.85); g.lineTo(cx + sx * s * 0.6, cy - s * 1.15); g.closePath(); g.fill();
  }
  // the raised arm's upper half, from the shoulder down to the elbow (de Casteljau's halves of the one
  // curve it was painted as): the forearm and the hand above it are their own layer (paintWerewolfHand),
  // the one that comes out of the canvas to strike, and the 3D arm grows from this elbow
  g.lineCap = 'round';
  g.strokeStyle = css(D.TUDOR); g.lineWidth = s * 0.66;
  g.beginPath(); g.moveTo(cx + s * 1.5, cy + s * 2.6); g.quadraticCurveTo(cx + s * 2.225, cy + s * 3.35, cx + s * WW_ELBOW.x, cy + s * WW_ELBOW.y); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = s * 0.3; // the sleeve's shadowed side
  g.beginPath(); g.moveTo(cx + s * 1.75, cy + s * 2.95); g.quadraticCurveTo(cx + s * 2.4, cy + s * 3.475, cx + s * 2.6, cy + s * 3.3875); g.stroke();
  g.lineCap = 'butt';
  varnish(g, w, h, 12);
  return [{ x: cx - ex, y: ey, r: er, hex: 0x120a04, white: 0xd9b23a }, { x: cx + ex, y: ey, r: er, hex: 0x120a04, white: 0xd9b23a }];
}

/**
 * The werewolf's raised left hand (on the viewer's right), its own cut-out layer over the canvas
 * (paintWerewolf leaves it out): the red sleeve up from the elbow, the gold band at the cuff, fur at
 * the wrist, and four long hooked claws, bone at their tips (MAP.WEREWOLF_CLAW), large enough to read
 * across the room. It is what strikes: it ripples and falls away from the canvas as the 3D arm
 * (buildTeaSet) comes off it, in its place and at its size, and settles back when the arm goes home.
 * The places are WW_ELBOW, WW_WRIST and WW_PALM (shares of s = 0.14 of the width, from the head at
 * (w / 2, 0.34 h)), which the 3D arm reads too.
 */
const WW_ELBOW = Object.freeze({ x: 2.4125, y: 3.3375 }); // the painted sleeve's low point, where the forearm turns up
const WW_WRIST = Object.freeze({ x: 2.25, y: 2.55 });
const WW_PALM = Object.freeze({ x: 2.12, y: 1.75 });
const WW_HAND = 1.3; // the hand's size, in s: drawn large, it is what the eye should find across the room
function paintWerewolfHand(g, w, h) {
  const cx = w * 0.5; const cy = h * 0.34; const s = w * 0.14;
  const D = DRESS; const C = MAP.WEREWOLF_CLAW;
  const fur = (x, y, r, n, seed, col, len = 7) => {
    g.strokeStyle = col; g.lineWidth = 1.4;
    for (let i = 0; i < n; i++) {
      const a = hash(i, seed) * TAU; const d = Math.sqrt(hash(i, seed + 1)) * r;
      const px = x + Math.cos(a) * d; const py = y + Math.sin(a) * d * 0.8;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + (hash(i, seed + 2) - 0.5) * 6, py + len * (0.6 + hash(i, seed + 3))); g.stroke();
    }
  };
  g.lineCap = 'round';
  g.strokeStyle = css(D.TUDOR); g.lineWidth = s * 0.66;
  g.beginPath(); g.moveTo(cx + s * WW_ELBOW.x, cy + s * WW_ELBOW.y); g.quadraticCurveTo(cx + s * 2.6, cy + s * 3.325, cx + s * WW_WRIST.x, cy + s * WW_WRIST.y); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = s * 0.3; // the sleeve's shadowed side
  g.beginPath(); g.moveTo(cx + s * 2.6, cy + s * 3.3875); g.quadraticCurveTo(cx + s * 2.8, cy + s * 3.3, cx + s * 2.55, cy + s * 2.6); g.stroke();
  g.strokeStyle = css(D.TRIM, 0.9); g.lineWidth = s * 0.14; // the cuff's gold band
  g.beginPath(); g.moveTo(cx + s * 2.0, cy + s * 2.7); g.lineTo(cx + s * 2.75, cy + s * 2.6); g.stroke();
  fur(cx + s * 2.2, cy + s * 2.3, s * 0.45, 60, 71, css(D.FUR, 0.95), 6);
  const px = cx + s * WW_PALM.x; const py = cy + s * WW_PALM.y; // the palm
  const hs = s * WW_HAND;
  g.fillStyle = css(D.FUR_DARK);
  g.beginPath(); g.ellipse(px, py, hs * 0.42, hs * 0.5, 0.15, 0, TAU); g.fill();
  for (let i = 0; i < C.fingers; i++) {
    const f = i / (C.fingers - 1) - 0.5; // -0.5 .. 0.5 across the hand
    const a = -Math.PI / 2 + f * C.spread * 1.9; // up, fanned
    const ux = Math.cos(a); const uy = Math.sin(a); const vx = -uy; const vy = ux;
    const bx = px + ux * hs * 0.38 + vx * f * hs * 0.3; const by = py + uy * hs * 0.38 + vy * f * hs * 0.3;
    const kx = bx + ux * hs * 0.5; const ky = by + uy * hs * 0.5; // the knuckle, where the claw comes out
    g.strokeStyle = css(D.FUR_DARK); g.lineWidth = hs * 0.17;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(kx, ky); g.stroke();
    const len = hs * (C.length / 0.46) * 0.95 * (1 - 0.25 * Math.abs(f * 2));
    const hook = len * 0.42 * C.curl; // the claw hooks over toward the middle of the canvas
    const tx = kx + ux * len - vx * hook * 0.35; const ty = ky + uy * len - vy * hook * 0.35;
    const qx = kx + ux * len * 0.75 + vx * hook * 0.25; const qy = ky + uy * len * 0.75 + vy * hook * 0.25;
    const base = hs * 0.075;
    const gr = g.createLinearGradient(kx, ky, tx, ty);
    gr.addColorStop(0, css(D.CLAW)); gr.addColorStop(0.55, css(0xb8ae94)); gr.addColorStop(1, css(BONE));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(kx + vx * base, ky + vy * base); g.quadraticCurveTo(qx + vx * base * 0.6, qy + vy * base * 0.6, tx, ty);
    g.quadraticCurveTo(qx - vx * base * 0.9, qy - vy * base * 0.9, kx - vx * base, ky - vy * base); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,248,226,0.35)'; g.lineWidth = 1; // a glint along the claw's lit edge
    g.beginPath(); g.moveTo(kx - vx * base * 0.5, ky - vy * base * 0.5); g.quadraticCurveTo(qx - vx * base * 0.4, qy - vy * base * 0.4, tx, ty); g.stroke();
  }
  g.lineCap = 'butt';
  return [];
}

/**
 * A wall of paintings as at most four draw calls: the frames and dark canvases (vertex colour),
 * the sitters (one atlas, cut out), every iris (one instanced mesh; only a painting with painted
 * eyes has any: the werewolf's), and every sculpted head (busts.js, one draw call).
 *   list: [{ x, y, z, yaw, w, h, paint(g, cw, ch) -> eyes | { eyes, heads }, cell?: [w, h] px, extra?: BufferGeometry[],
 *           canvas?: a key shared by entries painted on one canvas (its heads wake together) }]
 *         heads: [{ x, y, s, look }] in the cell's pixels (paintRelief): a head stands out of the
 *         canvas there and turns toward the warden by logic/headturn.js.
 *   o: name (the group's, for the smoke harness); sitterLayer (0): the layer of the sitters, their eyes and their heads (A5: the gallery's
 *      sitters are the eye's alone, and so are their heads).
 * Returns { group, watch(eye, dt, still, reduced), hide(i, off), rest(), turns(), dispose-free through freeTree }.
 */
const EYE_DISCS = 3; // white, iris, catch-light (#13)
// headYawToward's options, made once (no allocation a frame): reduced flash, and half pace (the
// two wives who stay, while the third is out of the canvas and the fight is on)
const REDUCED = Object.freeze({ reduced: true });
const HALF = Object.freeze({ rate: HEAD_TURN.rate / 2 });
const HALF_REDUCED = Object.freeze({ rate: HEAD_TURN.rate / 2, reduced: true });
// The eyes' look (#13): the white's glow (a share of the painted white), the iris's radius and how
// far it travels (shares of the white's half width, so it reaches the corner), the catch-light.
// The white is the painted white's own ellipse a little wider (1.1 x 0.62), inside the painted lid's ends;
// the iris (0.45) travels 0.5 sideways and 0.05 up or down at most, which keeps it inside the white.
const EYE_LOOK = Object.freeze({ wide: 1.1, high: 0.62, white: 0.45, iris: 0.45, turn: 0.5, lift: 0.05, glint: 0xd8d2c4 });
function paintings(list, M, o = {}) {
  const group = new THREE.Group();
  if (o.name) group.name = o.name;
  const frames = []; const quads = [];
  const cellH = 352;
  const n = list.length;
  const eyes = []; // { at: Vector3 (plane space), r, mat: Matrix4, inv: Matrix4, of, sx, sy }
  const heads = []; // { of, pos: { x, y, z } (the face's middle), yaw (its rest heading), turn, off }
  const busts = []; // bustSet's items
  // each cell is as wide as its painting is, so nothing is drawn stretched
  let total = 0;
  for (const p of list) { p.cw = Math.round((cellH * p.w) / p.h); p.u0 = total; total += p.cw; }
  const tex = drawn(total, cellH, (g) => {
    for (const p of list) {
      g.save();
      g.translate(p.u0, 0);
      g.beginPath(); g.rect(0, 0, p.cw, cellH); g.clip();
      const got = p.paint(g, p.cw, cellH);
      p.eyes = Array.isArray(got) ? got : (got && got.eyes) || [];
      p.heads = (got && !Array.isArray(got) && got.heads) || [];
      g.restore();
    }
  });
  list.forEach((p, i) => {
    const mat = new THREE.Matrix4().compose(V(p.x, p.y, p.z), _q.setFromAxisAngle(_y.set(0, 1, 0), p.yaw + Math.PI).clone(), ONE);
    const inv = mat.clone().invert();
    const fw = 0.09; const d = 0.07;
    const parts = p.bare ? [] : [
      slab(p.w + fw * 2, fw, d, 0, p.h / 2 + fw / 2, 0, GILT, 0.25), slab(p.w + fw * 2, fw, d, 0, -p.h / 2 - fw / 2, 0, GILT, 0.25),
      slab(fw, p.h, d, -p.w / 2 - fw / 2, 0, 0, GILT, 0.25), slab(fw, p.h, d, p.w / 2 + fw / 2, 0, 0, GILT, 0.25),
      S.tint(new THREE.PlaneGeometry(p.w, p.h, 6, 8).translate(0, 0, 0.012), p.ground || 0x15110f, 0.35, i + 2),
    ];
    if (!p.bare) for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(ball(fw * 0.75, sx * (p.w / 2 + fw / 2), sy * (p.h / 2 + fw / 2), 0.01, GILT, 1, 1, 0.6, 0.3));
    for (const g of parts) { if (g.attributes.uv) g.deleteAttribute('uv'); frames.push(g.applyMatrix4(mat)); }
    if (p.extra) frames.push(...p.extra);
    const q = new THREE.PlaneGeometry(p.w, p.h).translate(0, 0, p.bare ? 0.023 : 0.02);
    const uv = q.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (p.u0 + uv.getX(k) * p.cw) / total);
    q.applyMatrix4(mat);
    quads.push({ geo: q, i });
    p.heads.forEach((hd, k) => {
      const sm = (hd.s / p.cw) * p.w; // the face's half width, metres
      const at = V((hd.x / p.cw - 0.5) * p.w, (0.5 - hd.y / cellH) * p.h, 0.02 + 0.3 * sm).applyMatrix4(mat); // the face's middle, its back on the paint
      const geo = bustGeometry(hd.look, sm, { seed: i * 7 + k + 1 });
      const lift = geo.userData.centre;
      heads.push({ of: i, wake: p.canvas ?? i, pos: { x: at.x, y: at.y, z: at.z }, yaw: p.yaw, turn: 0, off: false, seen: false });
      busts.push({ geo, at: at.setY(at.y - lift), yaw: p.yaw });
    });
    for (const e of p.eyes) {
      eyes.push({
        at: V((e.x / p.cw - 0.5) * p.w, (0.5 - e.y / cellH) * p.h, 0.026), r: (e.r / p.cw) * p.w, mat, inv, of: i,
        hex: e.hex != null ? e.hex : 0x0b0908, white: e.white != null ? e.white : 0xe9e4d6, sx: 0, sy: 0, off: false,
      });
    }
  });
  const frameMesh = mesh(S.merge(frames), M.skin);
  frameMesh.receiveShadow = true;
  group.add(frameMesh);
  // sitters: one mesh per painting that may be hidden alone, else all in one
  const sitMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.82, metalness: 0 });
  if (o.lift) { sitMat.emissive.set(0xffffff); sitMat.emissiveMap = tex; sitMat.emissiveIntensity = o.lift; } // this painting lit a little, not the room
  sitMat.userData.ownMap = true;
  const alone = list.map((p) => !!p.alone);
  const together = quads.filter((q) => !alone[q.i]).map((q) => q.geo);
  const sitMeshes = [];
  if (together.length) {
    const all = mergeUv(together);
    const m = mesh(all, sitMat);
    group.add(m); sitMeshes.push({ m, of: -1 });
  }
  const fades = []; // per painting index: the ripple material's uniforms (an entry with ripple: { u, v })
  for (const q of quads) {
    if (!alone[q.i]) continue;
    const p = list[q.i];
    const m = mesh(q.geo, p.ripple ? rippleMat(sitMat, p, total, cellH, fades, q.i) : sitMat);
    group.add(m); sitMeshes.push({ m, of: q.i });
  }
  // Issue #13: each eye is three discs in the one instanced mesh, unlit so they read in a dark room:
  // the white (a dim glow of the painted white), the iris, and a catch-light on the iris. Only
  // painted eyes have discs (the werewolf's); a sitter with a sculpted head looks with the head.
  const irisMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const iris = eyes.length ? new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), irisMat, eyes.length * EYE_DISCS) : null;
  if (iris) {
    iris.frustumCulled = false;
    eyes.forEach((e, k) => {
      iris.setColorAt(k * EYE_DISCS, _col.set(e.white).multiplyScalar(EYE_LOOK.white));
      iris.setColorAt(k * EYE_DISCS + 1, _col.set(e.hex));
      iris.setColorAt(k * EYE_DISCS + 2, _col.set(EYE_LOOK.glint));
    });
    group.add(iris);
  } else irisMat.dispose();
  // the sculpted heads (the owner, 2026-11-18): one draw call for the wall, on the sitters' layer
  const set = heads.length ? bustSet(busts, { name: 'painted heads', fill: o.fill ?? 0.08 }) : null;
  if (set) group.add(set.mesh);
  if (o.sitterLayer) { for (const s of sitMeshes) s.m.layers.set(o.sitterLayer); if (iris) iris.layers.set(o.sitterLayer); if (set) set.mesh.layers.set(o.sitterLayer); }
  group.userData.paintedHeads = set ? { turns: () => set.turns(), at: () => heads.map((h) => ({ ...h.pos, yaw: h.yaw, off: h.off })) } : null;

  const disc = (k, x, y, z, rx, ry, mat) => {
    _o.position.set(x, y, z).applyMatrix4(mat);
    _o.quaternion.setFromRotationMatrix(mat);
    _o.scale.set(rx, ry, 1);
    _o.updateMatrix();
    iris.setMatrixAt(k, _o.matrix);
  };
  function put() {
    if (!iris) return;
    eyes.forEach((e, k) => {
      const r = e.off ? 0 : e.r;
      const i = k * EYE_DISCS;
      disc(i, e.at.x, e.at.y, e.at.z - 0.002, r * EYE_LOOK.wide, r * EYE_LOOK.high, e.mat);
      const ix = e.at.x + e.sx; const iy = e.at.y + e.sy;
      disc(i + 1, ix, iy, e.at.z + 0.001, r * EYE_LOOK.iris, r * EYE_LOOK.iris, e.mat);
      disc(i + 2, ix - r * 0.17, iy + r * 0.17, e.at.z + 0.004, r * 0.15, r * 0.15, e.mat);
    });
    iris.instanceMatrix.needsUpdate = true;
  }
  put();
  return {
    group, count: n,
    /**
     * The heads turn toward the warden by logic/headturn.js (40 degrees a second at most, 40 either
     * way, within 8 m and in front; a quarter of the rate under reduced flash; half with `half`);
     * `still` sends them home. A head stays at rest until it has first been on screen within 5 m
     * (headSeen, with lookYaw the warden's heading; NaN on the title wakes it), so its first turn
     * is seen. The painted eyes (the werewolf's) turn with the warden, slowly and a little late.
     */
    watch(eye, dt, still = false, reduced = false, lookYaw = NaN, half = false) {
      if (set) {
        const far = (HEAD_TURN.range + 1) ** 2;
        const opts = half ? (reduced ? HALF_REDUCED : HALF) : reduced ? REDUCED : undefined;
        for (let k = 0; k < heads.length; k++) { // a plain loop: nothing made a frame
          const h = heads[k];
          if (h.off) continue;
          if (!h.seen) { // not yet seen: at rest. One head of a painting seen wakes the painting's others with it.
            if (!headSeen(false, h.pos, eye, lookYaw)) continue;
            for (let q = 0; q < heads.length; q++) if (heads[q].wake === h.wake) heads[q].seen = true;
          }
          if (h.turn === 0 && (still || (eye.x - h.pos.x) ** 2 + (eye.z - h.pos.z) ** 2 > far)) continue; // at rest and nothing to see
          h.turn = headYawToward(h.pos, h.yaw, still ? null : eye, h.turn, dt, opts);
          set.turn(k, h.turn);
        }
      }
      if (!iris) return;
      for (const e of eyes) {
        _a.copy(eye).applyMatrix4(e.inv);
        const zf = Math.max(0.6, _a.z);
        const gx = still ? 0 : clamp(Math.atan2(_a.x - e.at.x, zf) / 0.8, -1, 1) * e.r * EYE_LOOK.turn;
        const gy = still ? 0 : clamp(Math.atan2(_a.y - e.at.y, zf) / 0.8, -1, 1) * e.r * EYE_LOOK.lift;
        e.sx = dt > 0 ? approach(e.sx, gx, dt, 1.4) : gx;
        e.sy = dt > 0 ? approach(e.sy, gy, dt, 1.4) : gy;
      }
      put();
    },
    /** Takes sitter i out of its painting (her place stays empty), or puts her back. */
    hide(i, off) {
      for (const s of sitMeshes) if (s.of === i) s.m.visible = !off;
      for (const e of eyes) if (e.of === i) e.off = !!off;
      heads.forEach((h, k) => { if (h.of === i && h.off !== !!off) { h.off = !!off; h.turn = 0; set.turn(k, 0); set.show(k, !off); } });
    },
    /**
     * The wife's emergence (logic/emerge.js) on painting i (one with ripple): how much of the painted
     * figure is left (paint, dissolving through the paint's grain), the ripple across her (0..1,
     * gentler under reduced flash), her sculpted head going into the ghost's (head), and the light
     * on the dissolving edge (flash, 0 under reduced flash). Allocates nothing.
     */
    emerge(i, paint, ripple, head, time, flash = 0) {
      const f = fades[i];
      if (f) { f.uFade.value = paint; f.uRip.value = ripple; f.uTime.value = time; f.uFlash.value = flash; }
      if (set) for (let k = 0; k < heads.length; k++) if (heads[k].of === i && !heads[k].off) set.scale(k, head);
    },
    /** Every head back at rest (a restored checkpoint: the view starts from what the rules say). */
    rest() { heads.forEach((h, k) => { h.turn = 0; h.seen = false; set.turn(k, 0); }); },
  };
}

/**
 * The one animated variant of a painting's cut-out material (the wife who leaves): her figure's
 * pixels ripple outward from her (a displacement of the paint, not the quad), and dissolve through
 * the paint's grain as uFade falls from 1 (whole) to 0 (the canvas empty), the dissolving edge lit
 * a little by uFlash. Shares the atlas; one draw call as before.
 */
function rippleMat(base, p, total, cellH, fades, i) {
  const mat = base.clone();
  mat.userData.ownMap = false; // the atlas is the shared material's to free
  // see-through rather than cut out, so the flecks fade (the art critic); the paint's own edge still cut
  mat.transparent = true; mat.alphaTest = 0.02; mat.depthWrite = false;
  const u = {
    uFade: { value: 1 }, uRip: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 },
    uC: { value: new THREE.Vector2((p.u0 + p.ripple.u * p.cw) / total, 1 - p.ripple.v) },
    uSize: { value: new THREE.Vector2(total, cellH) },
  };
  fades[i] = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uFade; uniform float uRip; uniform float uTime; uniform float uFlash; uniform vec2 uC; uniform vec2 uSize;
vec2 rippleUv; float fadeEdge;
float paintHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
float paintNoise( vec2 p ) { // value noise: the paint lifts in soft blots, not in pixels
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( paintHash( i ), paintHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( paintHash( i + vec2( 0.0, 1.0 ) ), paintHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`)
      .replace('#include <map_fragment>', `{
  vec2 d = ( vMapUv - uC ) * uSize; // pixels from her middle
  float r = length( d );
  float w = uRip * exp( -r / 90.0 ) * 2.2 * sin( r * 0.16 - uTime * 7.0 );
  rippleUv = vMapUv + ( r > 0.5 ? d / r : vec2( 0.0 ) ) * w / uSize;
  vec4 sampledDiffuseColor = texture2D( map, rippleUv );
  diffuseColor *= sampledDiffuseColor;
  vec2 px = rippleUv * uSize;
  float n = 0.62 * paintNoise( px / 16.0 ) + 0.28 * paintNoise( px / 6.0 ) + 0.1 * paintNoise( px / 2.5 );
  n = clamp( ( n - 0.2 ) / 0.6, 0.0, 1.0 ) * 0.8 + clamp( 1.0 - r / 160.0, 0.0, 1.0 ) * 0.2; // her middle lifts first
  float f = uFade * 1.5 - 0.25; // a band a quarter of the noise wide: each fleck fades rather than tears
  float keep = smoothstep( n - 0.25, n + 0.25, f );
  fadeEdge = keep * ( 1.0 - smoothstep( n, n + 0.4, f ) ) * step( 0.001, uFade ) * step( uFade, 0.999 );
  // going, the paint loses its white and black to the canvas's own ivory-grey
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.48, 0.44 ), clamp( ( 1.0 - keep ) * 0.8 + ( 1.0 - uFade ) * 0.35, 0.0, 0.85 ) );
  diffuseColor.a *= keep;
}`)
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance *= texture2D( emissiveMap, rippleUv ).rgb;
#endif
  totalEmissiveRadiance += vec3( 0.55, 0.68, 0.82 ) * fadeEdge * uFlash;`);
  };
  mat.customProgramCacheKey = () => 'paint-ripple';
  return mat;
}

/** merge() for quads that carry uv (the kit's merge keeps position, normal and colour only). */
function mergeUv(list) {
  let nv = 0; let ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3); const nor = new Float32Array(nv * 3); const uv = new Float32Array(nv * 2); const idx = new Uint16Array(ni);
  let vo = 0; let io = 0;
  for (const g of list) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    for (let k = 0; k < g.index.count; k++) idx[io++] = g.index.array[k] + vo;
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---- the armour (R4) ----------------------------------------------------------------------------
// The accepted design: uneven spiked shoulders, a spiked grin for a jaw, red eye glints, a clawed
// gauntlet, a horned crest, a Beefeater's pike with the hatter's price tag. Nothing is inside it.
// Eight draw calls: cuirass, helm, glints, limbs and joints (two instanced meshes), claw, pike, tag.

const A_SH = [V(0.5, 2.05, 0), V(-0.5, 2.05, 0)]; // 0 is the suit's own right
const A_HIP = [V(0.17, 1.0, 0), V(-0.17, 1.0, 0)];
const A_ARM = [0.6, 0.62];
const A_LEG = [0.5, 0.52];
const A_STRIDE = 1.5;
const A_STRIKE = 0.5; // seconds the thrust and its recovery take (sentries.js recover)
const PIKE_R = 1.35; const PIKE_L = 0.75; // where each hand holds the shaft, from the butt
const hold = (grip, dir, fwd) => ({ grip: V(...grip), dir: V(...dir).normalize(), fwd: V(...fwd) });
function mixHold(out, a, b, k) {
  out.grip.lerpVectors(a.grip, b.grip, k);
  out.dir.lerpVectors(a.dir, b.dir, k).normalize();
  out.fwd.lerpVectors(a.fwd, b.fwd, k);
  return out;
}
const PIKE = {
  rest: hold([0.66, 1.4, -0.08], [0, 1, 0], [0, 0, -1]),
  carry: hold([0.6, 1.45, -0.22], [0.04, 1, -0.2], [0, 0, -1]),
  tell: hold([0.42, 2.3, 0.15], [0.12, 0.42, 0.9], [0, -0.9, -0.42]), // back over the shoulder
  strike: hold([0.24, 1.5, -0.75], [-0.06, -0.04, -1], [0, -1, 0]), // down and through
};

function armourTorso(seed, first) {
  // Wrung like a rag: the flutes wind round it as they climb, deep enough to throw their own shadows.
  const wrung = (a, u) => 1 + 0.17 * Math.sin(a * 3 + u * 9 + seed) + 0.08 * Math.sin(a * 7 - u * 13 + seed * 2);
  // Rust in patches, pits where it has eaten through, bright wear on the high edges.
  const decay = (k) => (u, a, c) => {
    const n = S.noise(u * 6 + k, a * 1.7, seed, seed + k);
    if (n > 0.02) c.lerp(_col.set(RUST), Math.min(0.9, 0.35 + n * 1.6));
    if (hash(Math.floor(u * 70) + k * 13, Math.floor(a * 11)) > 0.84) c.multiplyScalar(0.38);
    if (S.noise(u * 19, a * 5, k, seed + 9) > 0.55) c.lerp(_col.set(0x5a5e66), 0.4);
  };
  const parts = [
    // the cuirass: pinched at the waist, the chest thrown out to one side, the back humped
    S.skin([
      { at: [0.02, 1.2, 0], r: [0.3, 0.24] }, { at: [-0.04, 1.42, 0.03], r: [0.25, 0.2] }, { at: [0.06, 1.66, -0.05], r: [0.42, 0.33] },
      { at: [-0.03, 1.9, 0.02], r: [0.5, 0.36] }, { at: [0.02, 2.1, 0.08], r: [0.4, 0.3] }, { at: [0, 2.22, 0.02], r: [0.2, 0.19] },
    ], { seed, sides: 13, detail: 3, budget: 900, noise: 0.16, grain: 2.2, mottle: 0.4, color: IRON, color2: 0x24272c, profile: wrung, colorAt: decay(0), caps: ['flat', 'flat'] }),
    S.tint(new THREE.TorusGeometry(0.2, 0.05, 6, 14).rotateX(Math.PI / 2).translate(0, 2.2, 0.02), 0x25282c, 0.3, seed),
    // a keel down the breast, notched
    slab(0.035, 0.5, 0.07, 0.04, 1.78, -0.39, 0x4a4e55, 0.3).rotateX(0.06),
  ];
  // plates laid over one another down the belly and round the hips, none of them square to the next, each dented
  for (let k = 0; k < 6; k++) {
    const y = 0.9 + k * 0.105; const rx = 0.47 - k * 0.028 + 0.03 * Math.sin(k * 2.3 + seed); const rz = 0.38 - k * 0.024;
    const dx = 0.035 * Math.sin(k * 1.9 + seed); const dz = 0.03 * Math.cos(k * 2.7);
    parts.push(S.skin([{ at: [dx, y + 0.17, dz], r: [rx * 0.86, rz * 0.86] }, { at: [dx * 2, y + 0.07, dz * 2], r: [rx, rz] }, { at: [dx * 3, y, dz], r: [rx * 1.05, rz * 1.04] }],
      { seed: seed + 20 + k, sides: 12, detail: 1, budget: 90, noise: 0.14, grain: 2.6, mottle: 0.4, color: k % 2 ? 0x30343a : IRON, color2: 0x24272c, caps: ['open', 'open'],
        profile: (a) => 1 + 0.07 * Math.sin(a * 5 + k * 1.3) + 0.05 * Math.sin(a * 2 + k), colorAt: decay(k + 1) }));
    for (let j = 0; j < 4; j++) { // rivets, some gone
      if (hash(k, j + seed) < 0.25) continue;
      const a = -1.1 + j * 0.73 + 0.2 * Math.sin(k);
      parts.push(ball(0.018, dx * 3 + Math.sin(a) * rx * 1.07, y + 0.035, dz - Math.cos(a) * rz * 1.07, 0x6a6e75, 1, 1, 1, 0.2));
    }
  }
  // the shoulders: never a pair. Its own left is a great hump of three long spikes; its right sits high, bristling.
  const sp = (r, h, at, dir) => parts.push(aimed(spike(r, h, 0x55595f), at, dir));
  parts.push(S.skin([{ at: [-0.36, 2.02, 0.02], r: [0.2, 0.17] }, { at: [-0.6, 2.1, 0], r: [0.3, 0.24] }, { at: [-0.82, 1.95, 0.03], r: [0.16, 0.2] }],
    { seed: seed + 7, sides: 9, detail: 2, budget: 200, noise: 0.18, grain: 2.4, mottle: 0.4, color: IRON, color2: 0x24272c, colorAt: decay(8) }));
  sp(0.07, 0.46, [-0.66, 2.24, 0], [-0.75, 1, 0.1]); sp(0.06, 0.3, [-0.5, 2.26, -0.14], [-0.2, 1, -0.5]); sp(0.065, 0.38, [-0.8, 2.08, 0.12], [-1, 0.35, 0.4]);
  parts.push(S.skin([{ at: [0.36, 2.1, 0], r: [0.16, 0.15] }, { at: [0.56, 2.2, 0], r: [0.22, 0.2] }, { at: [0.72, 2.1, 0.02], r: [0.12, 0.15] }],
    { seed: seed + 8, sides: 9, detail: 2, budget: 200, noise: 0.18, grain: 2.4, mottle: 0.4, color: 0x30343a, color2: 0x24272c, colorAt: decay(9) }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + seed;
    sp(0.035, 0.14 + 0.12 * hash(i, seed), [0.56 + 0.14 * Math.cos(a), 2.32, 0.13 * Math.sin(a)], [0.5 + Math.cos(a), 1, Math.sin(a)]);
  }
  if (first) parts.push(slab(0.3, 0.02, 0.02, 0.1, 1.6, -0.345, RUST, 0.3).rotateZ(0.5)); // the first is already coming apart: a split plate
  return S.merge(parts);
}

/** A joint's guard: a dented cop with a short spike, and the cuff of the plate below it. Along +Y, about the origin. */
function armourCop(seed) {
  return S.merge([
    S.skin([{ at: [0, -0.1, 0], r: [0.1, 0.1] }, { at: [0, 0, -0.02], r: [0.15, 0.16] }, { at: [0, 0.1, 0], r: [0.1, 0.1] }],
      { seed, sides: 8, detail: 2, budget: 150, noise: 0.2, grain: 2.4, mottle: 0.4, color: 0xffffff, color2: 0x9a8a80, capLen: 0.5 }),
    S.tint(new THREE.TorusGeometry(0.115, 0.022, 4, 9).rotateX(Math.PI / 2).translate(0, -0.13, 0), 0xd0d0d0, 0.3, seed),
    aimed(spike(0.035, 0.13, 0xe0e0e0, 4), [0, 0, -0.14], [0, 0.2, -1]),
  ]);
}

function armourHelm(seed, first) {
  const parts = [
    S.skin([
      { at: [0, 0, 0], r: [0.2, 0.2] }, { at: [0, 0.2, -0.02], r: [0.27, 0.3] }, { at: [0, 0.42, 0], r: [0.26, 0.29] }, { at: [0, 0.6, 0.03], r: [0.13, 0.15] },
    ], { seed: seed + 3, sides: 11, detail: 2, budget: 420, noise: 0.07, mottle: 0.3, color: IRON, color2: 0x202328, capLen: 0.5,
      profile: (a, u) => 1 + 0.05 * Math.sin(a * 5 + u * 4 + seed),
      colorAt: (u, a, c) => { if (u > 0.5 && u < 0.66 && Math.cos(a) > 0.35) c.setRGB(0.01, 0.01, 0.012); } }), // the sight: a black slot
    // the jaw: a grin of spikes
    // the jaw: a narrow, ragged rip of teeth, set crooked
    S.grin({ width: 0.34, teeth: 9, smile: 0.25, lip: 0x121316, tooth: 0x8a8d92, sharp: true, seed: seed + 5 }).scale(1, 2.3, 1).rotateZ(first ? -0.16 : 0.13).translate(first ? -0.02 : 0.03, 0.15, -0.292),
  ];
  // the crest: horns that do not match, and a comb of blades between
  const horn = (sx, len, broken) => S.skin([
    { at: [sx * 0.2, 0.46, 0], r: 0.075 }, { at: [sx * 0.44, 0.6, -0.03], r: 0.06 }, { at: [sx * 0.55, 0.6 + 0.3 * len, -0.08], r: 0.04 },
    { at: [sx * 0.46, 0.6 + 0.62 * len, -0.16], r: broken ? 0.034 : 0.004 },
  ], { seed: seed + sx, sides: 6, detail: 2, noise: 0.1, color: 0x3d3a36, color2: 0x15110f, mottle: 0.3, caps: ['round', broken ? 'flat' : 'round'] });
  parts.push(horn(-1, 1, false), horn(1, first ? 0.5 : 0.7, true));
  for (let i = 0; i < 5; i++) parts.push(aimed(spike(0.04, 0.12 + 0.07 * hash(i, seed + 2), 0x55595f, 4), [0, 0.58 - 0.02 * i, -0.16 + 0.09 * i], [0, 1, 0.25 * (i - 2)]));
  return S.merge(parts);
}

function pikeGeometry(seed) {
  const parts = [
    S.skin([{ at: [0, 0, 0], r: 0.03 }, { at: [0.012, 1.1, 0], r: 0.028 }, { at: [-0.01, 2.2, 0.004], r: 0.026 }, { at: [0, 2.8, 0], r: 0.025 }],
      { seed, sides: 6, detail: 2, budget: 150, color: 0x3d2c1f, color2: 0x241910, noise: 0.06, mottle: 0.22 }),
    // the partisan's head: a long leaf, two lugs like fangs, a brass socket
    S.skin([{ at: [0, 2.78, 0], r: [0.035, 0.03], color: GILT }, { at: [0, 2.9, 0], r: [0.085, 0.014] }, { at: [0, 3.1, 0], r: [0.06, 0.011] }, { at: [0, 3.3, 0], r: [0.004, 0.003] }],
      { seed: seed + 1, sides: 6, detail: 2, noise: 0.03, color: 0x8c9096, color2: 0x4a4d52, mottle: 0.2, caps: ['flat', 'flat'] }),
    S.tint(new THREE.CylinderGeometry(0.036, 0.03, 0.07, 6).translate(0, 0.035, 0), 0x55595f, 0.2, seed),
  ];
  for (const sx of [-1, 1]) {
    parts.push(S.skin([{ at: [sx * 0.03, 2.88, 0], r: [0.03, 0.01] }, { at: [sx * 0.14, 2.9, 0], r: [0.022, 0.008] }, { at: [sx * 0.19, 3.0, 0], r: 0.003 }],
      { seed: seed + 4 + sx, sides: 5, detail: 2, noise: 0.03, color: 0x8c9096, mottle: 0.2 }));
  }
  // a rotten red tassel under the head
  parts.push(S.skin([{ at: [0, 2.76, 0], r: 0.05, color: RED }, { at: [0.02, 2.64, 0.01], r: 0.06, color: RED }, { at: [0.03, 2.5, 0.02], r: 0.012, color: 0x3a0a0e }],
    { seed: seed + 6, sides: 6, detail: 2, rough: 0.35, noise: 0.1, shade: 0.2 }));
  return S.merge(parts);
}

/** (x, z) moved clear of the forecourt's cover by r, so a heap never lies in a block: writes into out. */
function clearOfCover(x, z, r, out) {
  let nz = z;
  for (const b of MAP.COVER) {
    if (x > b.minX - r && x < b.maxX + r && nz > b.minZ - r && nz < b.maxZ + r) nz = nz < (b.minZ + b.maxZ) / 2 ? b.minZ - r : b.maxZ + r;
  }
  out.x = x; out.z = Math.max(1.5, nz); // and off the door's own wall
  return out;
}

/** The hatter's price tag (the shipped words, script.js TAGS.style106), on a card. */
function tagTexture() {
  return drawn(256, 160, (g, w, h) => {
    g.fillStyle = '#e4dcc4'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,96,60,0.25)';
    for (let i = 0; i < 40; i++) g.fillRect(hash(i, 1) * w, hash(i, 2) * h, 14 * hash(i, 3), 10 * hash(i, 4)); // foxing
    g.strokeStyle = '#2a2018'; g.lineWidth = 4; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#1a1410'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const words = String(TAGS.style106).split(' ');
    const top = words.slice(0, -1).join(' '); const price = words[words.length - 1];
    g.font = 'italic 38px Georgia, "Times New Roman", serif'; g.fillText(top, w / 2, 56);
    g.font = 'bold 58px Georgia, "Times New Roman", serif'; g.fillText(price, w / 2, 108);
  });
}

function buildArmour(e, cfg, ctx) {
  const M = ctx.M;
  const first = e.suit === 1;
  const seed = first ? 31 : 44;
  const rand = S.rng(seed);
  const g = new THREE.Group();
  g.name = `armour:${e.suit}`;
  const torso = mesh(armourTorso(seed, first), ctx.plate, true);
  const helm = mesh(armourHelm(seed, first), ctx.plate, true);
  const glintMat = new THREE.MeshBasicMaterial({ color: EMBER, toneMapped: false, fog: false });
  const glints = mesh(S.merge([new THREE.SphereGeometry(0.022, 8, 6).scale(1.5, 0.7, 1).translate(0.085, 0, 0), new THREE.SphereGeometry(0.018, 8, 6).scale(1.5, 0.7, 1).translate(-0.09, 0.012, 0)]), glintMat);
  glints.position.set(0, 0.37, -0.285);
  helm.add(glints);
  const L = S.limbs(12, { seed, sides: 7, taper: 0.62, material: ctx.plate, noise: 0.22 });
  // the joints: elbows, knees, wrists and ankles, one instanced mesh
  const J = new THREE.InstancedMesh(armourCop(seed), ctx.plate, 8);
  J.castShadow = true; J.frustumCulled = false;
  for (let i = 0; i < 8; i++) J.setColorAt(i, _col.set(i % 2 ? 0x30343a : IRON).lerp(_c2.set(RUST), 0.25 * hash(i, seed)));
  const jointAt = []; const jointDir = []; const JSEG = [0, 3, 6, 9, 1, 4, 7, 10]; const JSIZE = [1, 1, 1.1, 1.1, 0.72, 0.72, 0.8, 0.8];
  for (let i = 0; i < 8; i++) { jointAt.push(V()); jointDir.push(V(0, 1, 0)); }
  for (let i = 0; i < 12; i++) L.tone(i, i % 3 === 2 ? 0x3a3d42 : i % 3 === 1 ? 0x4a4e55 : IRON);
  const claw = mesh(S.claw({ fingers: 4, length: 0.36, spread: 0.55, curl: 0.9, r: 0.042, color: 0x3c4046, tip: 0xb0b4ba, seed }), ctx.plate, true);
  const pike = mesh(pikeGeometry(seed), M.gloss, true);
  const tag = mesh(new THREE.PlaneGeometry(0.2, 0.125), ctx.tagMat);
  tag.position.set(0.02, 2.5, -0.045); tag.rotation.set(0.12, Math.PI, first ? 0.2 : -0.14);
  pike.add(tag);
  torso.name = 'armour-torso'; helm.name = 'armour-helm'; claw.name = 'armour-claw'; pike.name = 'armour-pike';
  g.add(torso, helm, L.mesh, J, claw, pike);

  // where each piece lies once the suit has come apart
  const lay = (x, y, z, rx, ry, rz) => ({ p: V(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), wait: rand() * 0.3 });
  const REST = {}; // logic/debris.js SUIT_REST: the same places its fall planner lays them
  for (const k of ['torso', 'helm', 'claw', 'pike']) { const R = SUIT_REST[k]; REST[k] = lay(...R.p, ...R.e); }
  const segA = []; const segB = []; const segR = [];
  const heap = heapLayout(rand); const heapA = heap.A.map((p) => V(...p)); const heapB = heap.B.map((p) => V(...p)); const heapW = heap.W;
  for (let i = 0; i < 12; i++) { segA.push(V()); segB.push(V()); segR.push(0.08); }
  const rec = { place(i, a, b, r) { segA[i].copy(a); segB[i].copy(b); segR[i] = r; } };
  /** It comes apart now: its pieces will lie clear of the forecourt's cover. */
  function startFall() {
    v.fallT = 0; v.fallSec = 0; v.waitK = 1; v.heap = true;
    const f = g.rotation.y;
    clearOfCover(g.position.x - Math.sin(f) * 0.6, g.position.z - Math.cos(f) * 0.6, 1.25, _a);
    const wx = _a.x - (g.position.x - Math.sin(f) * 0.6); const wz = _a.z - (g.position.z - Math.cos(f) * 0.6);
    if (wx === 0 && wz === 0) return;
    const lx = wx * Math.cos(f) - wz * Math.sin(f); const lz = wx * Math.sin(f) + wz * Math.cos(f);
    for (const r of Object.values(REST)) { r.p.x += lx; r.p.z += lz; }
    for (let i = 0; i < 12; i++) { heapA[i].x += lx; heapA[i].z += lz; heapB[i].x += lx; heapB[i].z += lz; }
  }

  const v = {
    g, type: 'armour', suit: e.suit, seed, eye: V(), face: e.heading || 0, first: true, phase: frac(seed * 0.37), move: 0, awake: 0,
    tellAmt: 0, tellOn: false, tellClock: 0, tellDur: 0.8, strikeT: 0, flash: 0, jolt: 0, stun: 0, talk: 0, fallT: -1, fallSec: -1, waitK: 1, fallRate: 1, dead: false, heap: false, lit: 0,
  };
  const mat = new THREE.Matrix4(); const eul = new THREE.Euler();
  const cur = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]); const base = hold([0, 0, 0], [0, 1, 0], [0, 0, -1]);
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()];
  const elbow = V(); const knee = V(); const butt = V(); const toe = V(); const bendA = V(); const bendL = V(); const pq = new THREE.Quaternion();

  // The fall (logic/debris.js): planned once, from the pose each piece stood in as the suit came
  // apart, against the live collision boxes, so nothing falls into or lies in stone. Each piece is a
  // rod; the meshes keep their designed turn toward the rest pose, squared onto the rod's way.
  const PIECES = ['torso', 'helm', 'claw', 'pike'];
  const MESH = { torso, helm, claw, pike };
  let plan = null; // { tracks[16]: the four pieces then the twelve plates, in the suit's frame; q0: the pieces' turn as they stood }
  const _ra = [0, 0, 0]; const _rb = [0, 0, 0]; const _pa = V(); const _pb = V(); const _ax = V(); const _dq = new THREE.Quaternion();
  const ends = (obj, rod) => ({
    a: _pa.set(...rod.a).applyQuaternion(obj.quaternion).add(obj.position).toArray(),
    b: _pb.set(...rod.b).applyQuaternion(obj.quaternion).add(obj.position).toArray(),
  });
  const restOf = (k) => {
    const rod = SUIT_RODS[k]; const R = REST[k];
    return { a: _pa.set(...rod.a).applyQuaternion(R.q).add(R.p).toArray(), b: _pb.set(...rod.b).applyQuaternion(R.q).add(R.p).toArray() };
  };
  function makePlan() {
    const bodies = PIECES.map((k) => ({ start: ends(MESH[k], SUIT_RODS[k]), rest: restOf(k), r: SUIT_RODS[k].r }));
    for (let i = 0; i < 12; i++) bodies.push({ start: { a: segA[i].toArray(), b: segB[i].toArray() }, rest: { a: heapA[i].toArray(), b: heapB[i].toArray() }, r: Math.max(0.08, segR[i]) });
    const boxes = ctx.boxes || (ctx.cfg && ctx.cfg.boxes) || [];
    plan = { tracks: planFall({ x: g.position.x, y: g.position.y, z: g.position.z, f: g.rotation.y }, bodies, boxes), q0: PIECES.map((k) => MESH[k].quaternion.clone()) };
  }
  /**
   * A piece's seconds into its own fall: real seconds since the suit came apart, less its wait (in a
   * slow crumble the waits are drawn out, so it sheds them one by one, each falling at its own pace).
   */
  const own = (fall, wait) => (fall < 0 ? -1 : v.fallSec - wait * v.waitK);
  function settle(k, i, fall) {
    const obj = MESH[k]; const R = REST[k];
    const t = own(fall, R.wait);
    if (t <= 0) return;
    const tr = plan.tracks[i];
    const len = trackAt(tr, t, _ra, _rb);
    _pa.fromArray(_ra); _pb.fromArray(_rb);
    obj.quaternion.copy(plan.q0[i]).slerp(R.q, smooth(clamp(t / Math.max(0.3, len))));
    const rod = SUIT_RODS[k];
    _ax.set(...rod.b).sub(_t.set(...rod.a)).applyQuaternion(obj.quaternion).normalize();
    _d.subVectors(_pb, _pa).normalize();
    obj.quaternion.premultiply(_dq.setFromUnitVectors(_ax, _d));
    obj.position.copy(_pa).sub(_t.set(...rod.a).applyQuaternion(obj.quaternion));
  }

  // o: mv, ph, awake, tell, chop, recover, jolt, stun, talk, wobble, fall (seconds since it came apart, or -1), time
  function pose(o) {
    const step = o.ph * TAU;
    const lunge = o.chop * (1 - o.recover);
    const fall = o.fall >= 0 ? o.fall : -1;
    const up = fall >= 0 ? 1 - smooth(fall / 0.25) : 1; // the lean lets go as it comes apart
    eul.set(
      (-0.04 * o.mv + 0.16 * o.tell * (1 - o.chop) - 0.32 * lunge + 0.07 * o.jolt + 0.16 * o.stun + 0.1 * o.wobble * Math.sin(o.time * 7.3)) * up,
      (-0.45 * o.tell * (1 - o.chop) + 0.4 * lunge) * up,
      (0.05 * o.mv * Math.sin(step) + 0.05 * o.stun * Math.sin(o.time * 23) + 0.16 * o.wobble * Math.sin(o.time * 9.1)) * up,
    );
    mat.makeRotationFromEuler(eul);
    mat.setPosition(0, -0.04 * o.mv * Math.abs(Math.sin(step)), 0);
    pq.setFromRotationMatrix(mat);

    torso.position.setFromMatrixPosition(mat); torso.quaternion.copy(pq);
    helm.position.set(0, 2.22, 0).applyMatrix4(mat);
    // the helm: cocked to speak, thrown back for the blow, rattling when stopped
    eul.set(0.1 * Math.sin(o.time * 9) * o.talk - 0.25 * o.tell * (1 - o.chop) + 0.2 * lunge, o.yaw != null ? o.yaw : v.yaw || 0, 0.14 * o.talk * Math.sin(o.time * 2.3) + 0.2 * o.stun * Math.sin(o.time * 19));
    helm.quaternion.copy(pq).multiply(_q.setFromEuler(eul));

    mixHold(base, PIKE.rest, PIKE.carry, o.awake);
    if (o.chop > 0) mixHold(cur, PIKE.tell, PIKE.strike, o.chop);
    else mixHold(cur, base, PIKE.tell, o.tell);
    if (o.recover > 0) mixHold(cur, cur, base, o.recover);
    cur.grip.applyMatrix4(mat); cur.dir.transformDirection(mat); cur.fwd.transformDirection(mat);
    butt.copy(cur.grip).addScaledVector(cur.dir, -PIKE_R);
    if (butt.y < 0.02 && o.chop <= 0) butt.y = 0.02;
    aim(pike, butt, cur.dir, cur.fwd);

    const two = Math.max(o.tell, o.chop > 0 ? 1 - o.recover : 0);
    for (let i = 0; i < 2; i++) sh[i].copy(A_SH[i]).applyMatrix4(mat);
    hand[0].copy(butt).addScaledVector(cur.dir, PIKE_R);
    _a.set(-0.62, 1.02 + 0.03 * o.mv * Math.sin(step), 0.03 + 0.24 * o.mv * Math.sin(step)).applyMatrix4(mat);
    _a.y += 0.5 * o.talk * (0.6 + 0.4 * Math.sin(o.time * 3.1)); _a.z -= 0.35 * o.talk; // the claw comes up when it speaks
    hand[1].copy(butt).addScaledVector(cur.dir, PIKE_L).lerp(_a, 1 - two);
    if (o.hand) hand[1].lerp(o.hand, o.reach); // the werewolf cutaway: the claw out to a door leaf
    for (let i = 0; i < 2; i++) {
      bendA.set(i ? -0.3 : 0.3, -0.3, 1).transformDirection(mat);
      placeArm(rec, i * 3, sh[i], hand[i], A_ARM[0], A_ARM[1], bendA, 0.115, elbow, 1.2);
      jointAt[i].copy(elbow); jointDir[i].subVectors(elbow, sh[i]);
      jointAt[4 + i].copy(hand[i]); jointDir[4 + i].subVectors(hand[i], elbow);
      if (i === 1) {
        _d.subVectors(hand[1], elbow).normalize();
        if (o.clawDir && o.reach > 0) _d.lerp(o.clawDir, o.reach).normalize(); // square onto the leaf's face, fingers on it
        claw.position.copy(hand[1]).addScaledVector(_d, 0.14); claw.quaternion.setFromUnitVectors(_z.set(0, 0, -1), _d);
        if (o.clawDir && o.reach > 0) claw.quaternion.multiply(_q.setFromAxisAngle(_x.set(1, 0, 0), -0.26 * o.reach)); // curled in on the boards: a grip, not a hover (the critic)
      }
    }
    toe.set(0, -0.1, -1).normalize().transformDirection(mat);
    bendL.set(0, 0.1, -1).transformDirection(mat);
    for (let i = 0; i < 2; i++) {
      const c = frac(o.ph + i * 0.5);
      const T = A_STRIDE * 0.55; let fz; let fy = 0;
      if (c < 0.55) fz = (c / 0.55 - 0.5) * T;
      else { const s = (c - 0.55) / 0.45; fz = (0.5 - smooth(s)) * T; fy = Math.sin(Math.PI * s) * 0.22; }
      foot[i].set(A_HIP[i].x * 1.1, 0.08 + fy * o.mv, fz * o.mv);
      hip[i].copy(A_HIP[i]).applyMatrix4(mat);
      placeLeg(rec, 6 + i * 3, hip[i], foot[i], A_LEG[0], A_LEG[1], bendL, 0.135, toe, knee, 2.4);
      jointAt[2 + i].copy(knee); jointDir[2 + i].subVectors(knee, hip[i]);
      jointAt[6 + i].copy(foot[i]); jointDir[6 + i].subVectors(foot[i], knee);
    }
    if (fall >= 0) {
      if (!plan) makePlan();
      PIECES.forEach((k, i) => settle(k, i, fall));
    }
    for (let i = 0; i < 12; i++) {
      const t = fall >= 0 ? own(fall, heapW[i]) : -1;
      if (t > 0) {
        trackAt(plan.tracks[4 + i], t, _ra, _rb);
        _a.fromArray(_ra); _b.fromArray(_rb);
        heapB[i].copy(_b); // the joints follow their plate's lower end
        L.place(i, _a, _b, segR[i]);
      } else L.place(i, segA[i], segB[i], segR[i]);
    }
    L.commit();
    for (let i = 0; i < 8; i++) {
      _o.position.copy(jointAt[i]);
      if (fall >= 0) { const sgi = JSEG[i]; if (own(fall, heapW[sgi]) > 0) _o.position.copy(heapB[sgi]); } // on its plate's falling end
      _o.quaternion.setFromUnitVectors(_y.set(0, 1, 0), _t.copy(jointDir[i]).normalize());
      _o.scale.setScalar(JSIZE[i]);
      _o.updateMatrix();
      J.setMatrixAt(i, _o.matrix);
    }
    J.instanceMatrix.needsUpdate = true;
  }

  const looks = [torso, helm, L.mesh, J, claw];
  function setFlash(on) { for (const m of looks) m.material = on ? M.flash : ctx.plate; }
  function lightEyes(level, big) {
    glintMat.color.setHex(EMBER).multiplyScalar(clamp(level, 0, 2.5));
    glints.scale.set(1, 1 + 0.8 * big, 1 + 0.8 * big);
    glints.visible = level > 0.02;
  }

  v.sync = (en, dt, time, eye, cfg2, reduced, force = false) => {
    // the werewolf cutaway holds the suits (the layer below): no sync from the rules while it plays,
    // so nothing of them tracks the film's camera; `force` poses it once, from the rules, for the film
    if (ctx.filmHold && !force) return;
    v.eye.copy(eye);
    v.tellDur = (cfg2 && cfg2.armour && cfg2.armour.tell) || 0.8;
    g.position.set(en.x, num(en.y), en.z);
    if (v.first) { v.face = num(en.heading); v.first = false; }
    const st = String(en.state || '');
    const heap = st === 'heap' || (en.dead && first);
    if (heap && v.fallT < 0) { if (v.seen) startFall(); else { v.fallT = 9; v.fallSec = 9; v.heap = true; } } // seated already fallen: it lies as it fell
    // The first suit's slow collapse (#14): the same fall, played over the crumble's own length so the pieces drop one by one.
    if (st === 'crumble' && v.fallT < 0 && v.seen) { startFall(); v.fallRate = 1.2 / Math.max(1, (cfg2 && cfg2.armour && cfg2.armour.crumbleTime) || 6); v.waitK = 1 / v.fallRate; }
    if (heap) v.fallRate = 1;
    v.seen = true;
    if (!v.heap) v.face += wrap(num(en.heading) - v.face) * Math.min(1, dt * 7);
    g.rotation.y = v.face;
    g.visible = force || Math.hypot(eye.x - en.x, eye.z - en.z) < FAR;
    if (!g.visible) return;
    if (v.fallT >= 0) { v.fallT += dt * v.fallRate; v.fallSec += dt; }
    const asleep = st === 'stand' && !en.called;
    const walking = num(en.speedNow) > 0.05 && !v.heap;
    if (walking) v.phase += (en.speedNow * dt) / A_STRIDE;
    v.move = approach(v.move, walking ? 1 : 0, dt, 8);
    v.awake = approach(v.awake, asleep ? 0 : 1, dt, 3);
    v.jolt = Math.max(0, v.jolt - dt * 5);
    v.flash = Math.max(0, v.flash - dt);
    v.stun = approach(v.stun, en.stun > 0 ? 1 : 0, dt, 12);
    v.talk = approach(v.talk, st === 'speak' || st === 'threat' || v.say > 0 ? 1 : 0, dt, 6);
    v.say = Math.max(0, (v.say || 0) - dt);
    if (en.stun > 0) v.tellOn = false;
    if (v.tellOn) { v.tellClock += dt; if (v.tellClock > v.tellDur + 0.4) v.tellOn = false; }
    const tell = Math.max(en.tell > 0 ? 1 - en.tell / v.tellDur : 0, v.tellOn ? clamp(v.tellClock / v.tellDur) : 0, st === 'tell' ? 0.05 : 0);
    v.tellAmt = approach(v.tellAmt, smooth(tell), dt, 22);
    v.strikeT = Math.max(0, v.strikeT - dt);
    const u = v.strikeT > 0 ? 1 - v.strikeT / A_STRIKE : 0;
    const chop = v.strikeT > 0 ? smooth(u / 0.22) : 0;
    const recover = v.strikeT > 0 ? smooth((u - 0.5) / 0.5) : 0;
    // the helm turns to the warden before the body does
    const dx = eye.x - en.x; const dz = eye.z - en.z;
    v.yaw = approach(v.yaw || 0, v.heap || asleep ? 0 : clamp(wrap(headingTo(dx, dz) - v.face), -1.2, 1.2), dt, 5);
    pose({
      mv: v.move, ph: v.phase, awake: v.awake, tell: chop > 0 ? 1 : v.tellAmt, chop, recover, jolt: v.jolt, stun: v.stun, talk: v.talk,
      wobble: st === 'stagger' ? 1 : 0, fall: v.fallT, time,
    });
    // glints: a pin of red asleep, steady awake, a flare for the tell (held steady under reduced flash), out when it lies in pieces
    const out = v.fallT >= 0 ? 1 - clamp(v.fallT / 0.8) : 1;
    const flare = reduced ? 0.6 * v.tellAmt : 1.5 * v.tellAmt * (0.8 + 0.2 * Math.sin(time * 40));
    lightEyes((0.18 + 0.75 * v.awake + flare + 0.25 * v.talk * Math.sin(time * 11)) * out, v.tellAmt);
    setFlash(v.flash > 0 && !reduced);
  };
  /**
   * The werewolf cutaway (logic/cutaway.js guard): the fighting suit posed by the film, over the
   * frozen sim, its own state (face, phase, wakefulness) untouched, so the next sync puts it back
   * exactly where the rules have it. G: { x, z, heading, move, walked, reach, hand, contact }.
   */
  const filmHand = V(); const filmClaw = V();
  let held = null; // its pose as the film found it, put back when the film ends
  const keepPose = () => {
    // its parts' pose (where the suit stands and faces, g, is the rules' to set: every sync does)
    const parts = [torso, helm, glints, claw, pike, L.mesh, J];
    held = {
      parts: parts.map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), vis: o.visible, inst: o.isInstancedMesh ? o.instanceMatrix.array.slice() : null })),
      glint: glintMat.color.clone(),
      at: g.position.clone(), face: g.rotation.y, shown: g.visible,
    };
  };
  /** The film is over: the suit exactly as the film found it (the next sync poses it from the rules as ever). */
  v.unfilm = () => {
    if (!held) return;
    for (const r of held.parts) {
      r.o.position.copy(r.p); r.o.quaternion.copy(r.q); r.o.scale.copy(r.s); r.o.visible = r.vis;
      r.o.updateMatrix();
      if (r.inst) { r.o.instanceMatrix.array.set(r.inst); r.o.instanceMatrix.needsUpdate = true; }
    }
    glintMat.color.copy(held.glint);
    g.position.set(held.at.x, held.at.y, held.at.z); g.rotation.set(0, held.face, 0); g.visible = held.shown;
    held = null;
  };
  /** The film begins: its pose as the film found it, to put back at the end. */
  v.filmStart = () => { if (!held) keepPose(); };
  v.film = (G, time) => {
    if (!held) keepPose();
    g.position.set(G.x, 0, G.z);
    g.rotation.y = G.heading;
    g.visible = true;
    // the world's wrist and the leaf's face, into the suit's own frame
    const c = Math.cos(G.heading); const s2 = Math.sin(G.heading);
    const wx = G.hand.x - G.x; const wz = G.hand.z - G.z;
    filmHand.set(wx * c - wz * s2, G.hand.y, wx * s2 + wz * c);
    const touching = G.contact && G.contact.leaf >= 0;
    if (touching) filmClaw.set(-G.contact.nx * c + G.contact.nz * s2, 0, -G.contact.nx * s2 - G.contact.nz * c).normalize();
    pose({
      mv: G.move, ph: G.walked / A_STRIDE, awake: 0, tell: 0, chop: 0, recover: 0, jolt: 0, stun: 0, talk: 0, wobble: 0, fall: -1, time,
      yaw: 0, hand: filmHand, reach: G.reach, clawDir: touching ? filmClaw : null,
    });
    lightEyes(0.93, 0);
  };
  v.onEvent = (ev) => {
    if (ev.type === 'hit') { v.flash = 0.08; v.jolt = 1; }
    else if (ev.type === 'strikeTell') { v.tellOn = true; v.tellClock = 0; }
    else if (ev.type === 'strike') { v.tellOn = false; v.strikeT = A_STRIKE; }
    else if (ev.type === 'suitFalls') { if (v.fallT < 0) startFall(); }
  };
  /** Lies as a heap from the start (laid again after a death, from the run's record). */
  v.layDown = (x, y, z, yaw) => {
    clearOfCover(x, z, 1.25, _a);
    g.position.set(_a.x, y, _a.z); g.rotation.y = yaw; v.fallT = 9; v.fallSec = 9; v.heap = true; v.dead = true;
    pose({ mv: 0, ph: v.phase, awake: 0, tell: 0, chop: 0, recover: 0, jolt: 0, stun: 0, talk: 0, wobble: 0, fall: 9, time: 0 });
    lightEyes(0, 0);
    for (const m of [...looks, pike]) m.castShadow = false;
  };
  v.linger = () => v.heap; // the first suit's heap stays where it fell
  v.die = () => { v.dead = true; if (v.fallT < 0) startFall(); v.heap = true; setFlash(false); };
  v.updateDeath = (dt, time) => {
    if (v.fallT > 2) return false; // lies where it fell
    v.fallT += dt; v.fallSec += dt;
    pose({ mv: 0, ph: v.phase, awake: 1, tell: 0, chop: 0, recover: 0, jolt: 0, stun: 0, talk: 0, wobble: 0, fall: v.fallT, time });
    lightEyes(0.9 * (1 - clamp(v.fallT / 0.8)), 0);
    if (v.fallT > 2) for (const m of [...looks, pike]) m.castShadow = false;
    return false;
  };
  v.dispose = () => { ctx.suits.delete(v); freeTree(g, ctx.keep); };
  v.count = () => S.count(g);
  pose({ mv: 0, ph: v.phase, awake: 0, tell: 0, chop: 0, recover: 0, jolt: 0, stun: 0, talk: 0, wobble: 0, fall: -1, time: 0 });
  lightEyes(0.18, 0);
  ctx.suits.add(v);
  return v;
}

// ---- the phantom wife (R6) ------------------------------------------------------------------------
// One of the three: pale, see-through, hungry and polite. Nothing fired at her does anything. She
// comes out of the canvas, lunges after her tell, recoils from the garlic out through the house
// (wall, ceiling or floor) and comes back from any side, and at the last shreds away for good.
// Six draw calls: gown, skull, jaw, eyes, arms (one instanced mesh), hair; and the mist, while she comes out of the canvas and a moment after.

const W_SH = [V(0.2, 1.46, 0), V(-0.2, 1.46, 0)];
const W_ARM = [0.38, 0.44]; // too long
// Coming out of the canvas (logic/emerge.js, the owner's 2026-11-18 ask, re-timed by the art critic):
// first the paint ripples and a mist lifts off her painted outline; then she forms on the paint, flat,
// at the painted head's size (0.9) with her face over the canvas's sculpted head, in the painting's
// colours, almost opaque, her mouth a calm closed line, held to her own part of the canvas (clipped to
// it); as the timeline's lift runs she comes off the plane to where the sim stands her (a step off the
// wall), takes her own depth and size, breaks out past the picture's edge, her colour crossfades to the
// ghost's, and only once she is clear of the frame does her grin open. A mist trails after her. Her
// own material variants (body, and her face's for the calm mouth), one more draw call (the mist).
const W_FACE = 1.83; // her face's middle above her feet, in her own frame
const W_S0 = 0.9; // her scale while she is still the painted figure: the painted head's size
const W_FLAT = 0.06; // her depth then, a share of her own
const W_PAINTED = 0.92; // her opacity in the painting's colours
const MIST = 36; // motes in the mist that trails from the canvas after her

/** Where the one who leaves is painted, in the world: her face's middle on the canvas, the way it faces, its lower edge, her part of the canvas. */
const W_CELL = 0.37; // her part of the canvas, from its left edge (as seen) to before the fair wife's shoulder, a share of its width
function wifeSpot() {
  const P = MAP.CORRIDOR.painting; const W = MAP.WALL_ART.wives;
  const yaw = facingIn('cor1', P.x, P.z);
  const lx = (WIFE_SPOT.u - 0.5) * W.w; const ly = (0.5 - WIFE_SPOT.v) * W.h;
  const off = 0.02 + 0.3 * WIFE_SPOT.s * W.w; // as paintings() stands the head out of the canvas
  // the canvas's own x (its left to right as seen) and its facing, for a painting turned yaw + pi
  const ax = -Math.cos(yaw); const az = Math.sin(yaw); const nx = -Math.sin(yaw); const nz = -Math.cos(yaw);
  const cx = (W_CELL / 2 - 0.5) * W.w; // her part's middle along the canvas
  return {
    x: P.x + ax * lx + nx * off, y: 1.8 + ly, z: P.z + az * lx + nz * off, yaw, bottom: 1.8 - W.h / 2, ax, az, nx, nz,
    cell: { x: P.x + ax * cx, y: 1.8, z: P.z + az * cx, hw: (W_CELL / 2) * W.w, hh: W.h / 2 },
  };
}

/** A soft round mote, drawn once. */
function moteTexture() {
  return drawn(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function buildWife(e, cfg, ctx) {
  const seed = 63;
  const g = new THREE.Group(); const body = new THREE.Group();
  g.add(body);
  const mat = ctx.phantom.clone();
  const faceMat = ctx.phantom.clone(); // her skull and her face's features: the same, and the calm mouth
  const jawMat = ctx.phantom.clone(); // her jaw (its lower lip and teeth): the same, in the jaw's own frame
  const spot = wifeSpot();
  // her own variant: painted colour to ghost colour (uLook), the ripple through her (uRip), her part
  // of the canvas she is held to (uCell its middle, uAx the canvas's x, uCellHalf, uGrow letting go),
  // the light as she breaks free (uFlash); on her face, the calm closed mouth (uCalm, uMouth: the
  // mouth's band in the head's frame: top, line, bottom, half width)
  const wu = {
    uLook: { value: 1 }, uRip: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uGrow: { value: 99 },
    uCell: { value: V(spot.cell.x, spot.cell.y, spot.cell.z) }, uAx: { value: V(spot.ax, 0, spot.az) }, uCellHalf: { value: new THREE.Vector2(spot.cell.hw, spot.cell.hh) },
    uCalm: { value: 0 }, uMouth: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const shader = (calm, off = [0, 0, 0]) => (shd) => {
    const o3 = `vec3( ${off.map((q) => q.toFixed(5)).join(', ')} )`;
    Object.assign(shd.uniforms, wu);
    shd.vertexShader = shd.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uRip; uniform float uTime; varying vec3 vWp; varying vec3 vLoc;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.x += uRip * 0.03 * sin( position.y * 13.0 + uTime * 6.5 );
  transformed.z += uRip * 0.025 * sin( position.y * 8.0 - uTime * 5.0 + position.x * 17.0 );`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 wp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
    vWp = ( modelMatrix * wp ).xyz; vLoc = position + ${o3}; }`);
    shd.fragmentShader = shd.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uLook; uniform float uFlash; uniform float uTime; uniform float uGrow; uniform vec3 uCell; uniform vec3 uAx; uniform vec2 uCellHalf;
uniform float uCalm; uniform vec4 uMouth; varying vec3 vWp; varying vec3 vLoc;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  { float l = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
    diffuseColor.rgb = mix( vec3( l ) * vec3( 0.98, 0.93, 0.82 ), diffuseColor.rgb, uLook );
    // held to her part of the canvas (along its facing, so off the wall too) until she lets go
    vec3 d = vWp - uCell;
    float wob = 0.03 * sin( vWp.y * 23.0 + uTime * 3.0 ) + 0.03 * sin( dot( d, uAx ) * 31.0 - uTime * 2.0 );
    float outside = max( abs( dot( d, uAx ) ) - uCellHalf.x - uGrow, abs( d.y ) - uCellHalf.y - uGrow ) + wob;
    diffuseColor.a *= 1.0 - smoothstep( -0.03, 0.03, outside );
${calm ? `    // the calm mouth: her grin's teeth and lips under the pale of her face, one dark closed line
    float inBand = step( uMouth.z, vLoc.y ) * step( vLoc.y, uMouth.x ) * ( 1.0 - smoothstep( uMouth.w * 0.8, uMouth.w, abs( vLoc.x ) ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.66, 0.66, 0.62 ), vec3( 0.72, 0.8, 0.88 ), uLook ), uCalm * inBand );
    float line = ( 1.0 - smoothstep( 0.003, 0.006, abs( vLoc.y - uMouth.y ) ) ) * ( 1.0 - smoothstep( uMouth.w * 0.45, uMouth.w * 0.6, abs( vLoc.x ) ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.1, 0.11 ), uCalm * line * inBand );` : ''}
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance = totalEmissiveRadiance * uLook + vec3( 0.6, 0.72, 0.86 ) * uFlash;`);
  };
  mat.onBeforeCompile = shader(false);
  mat.customProgramCacheKey = () => 'wife-emerge';
  faceMat.onBeforeCompile = shader(true);
  faceMat.customProgramCacheKey = () => 'wife-emerge-face';
  const gown = mesh(S.skin([
    { at: [0, 0.0, 0.85], r: 0.012, color: 0x5f7286 }, { at: [0, 0.1, 0.5], r: [0.09, 0.05], color: 0x6f8296 }, { at: [0, 0.38, 0.2], r: [0.19, 0.13], color: 0x8fa3b8 },
    { at: [0, 0.85, 0.04], r: [0.19, 0.13] }, { at: [0, 1.2, 0], r: [0.125, 0.095] }, { at: [0, 1.44, -0.02], r: [0.225, 0.115] }, { at: [0, 1.58, 0], r: [0.06, 0.06], color: 0xdde8f2 },
  ], { seed, sides: 10, detail: 3, budget: 700, noise: 0.1, grain: 1.8, rough: 0.05, mottle: 0.2, color: PHANTOM, color2: 0x9db4c9,
    profile: (a, u) => 1 + (1 - u) * 0.22 * Math.sin(a * 5 + seed) }), mat);
  const hair = S.cloth({ width: 0.26, widthEnd: 0.12, length: 1.15, cols: 6, rows: 9, budget: 200, color: 0x1a1d24, folds: 5, foldDepth: 0.03, tatter: 0.9, dirt: 0, seed, material: mat, cast: false });
  const hd = S.head({
    size: 0.2, seed, budget: 1700, defects: ['fangsFront', 'teethMany', 'noBlink', 'pupilsPin', 'mouthCrooked:R'], cast: false,
    face: {
      skin: 0xdfe9f2, eye: 0xf2f6ff, hair: 0x1a1d24, skull: { tall: 1.3, wide: 0.84, taper: 0.56, cheek: 0.01, socket: 0.16, temple: 0.1 },
      eyes: { r: 0.2, open: 1.2, iris: 0.3, white: 0x06080c }, brow: { color: 0x15171c, thick: 0.03, tilt: 0.8 }, nose: { kind: 'long', size: 0.07, length: 0.26 },
      mouth: { width: 0.62, smile: 0.75, lip: 0x7a1a22, toothLen: 0.1 }, cheek: { rosy: 0 }, ears: { kind: 'none' },
    },
  });
  hd.group.position.set(0, 1.58, 0);
  hd.skull.material = faceMat; hd.features.material = faceMat;
  if (hd.jaw) {
    hd.jaw.material = jawMat;
    const jp = hd.jaw.position; // the jaw's frame is the head's moved to its hinge (it barely turns while her mouth is closed)
    jawMat.onBeforeCompile = shader(true, [jp.x, jp.y, jp.z]);
    jawMat.customProgramCacheKey = () => 'wife-emerge-jaw';
  }
  { // the mouth's band in the head's frame: from below the lower lip to above the smile's corners, as wide as the smile
    const pm = hd.plan.mouth; const ml = pm.lat;
    const yMid = hd.at(0, ml).y; const yTop = hd.at(0, ml + 0.06 + pm.smile * 0.12).y; const yBot = hd.at(0, ml - 0.42).y; // down past the front fangs
    wu.uMouth.value.set(Math.max(yTop, yMid), yMid, Math.min(yBot, yMid), Math.abs(hd.at(pm.width * 1.12, ml).x));
  }
  hair.mesh.position.set(0, 0.36, 0.16); hair.mesh.rotation.y = Math.PI;
  hd.group.add(hair.mesh);
  const L = S.limbs(6, { seed, sides: 5, taper: 0.6, material: mat, cast: false });
  for (let i = 0; i < 6; i++) L.tone(i, i % 3 === 2 ? 0xe6eef6 : PHANTOM);
  body.add(gown, hd.group);
  g.add(L.mesh);
  const rig = { root: body, chest: gown, head: hd, cloths: [hair], seed, rate: 0.16, depth: 1.6 };
  const v = { g, type: 'wife', seed, shown: 0, tellAmt: 0, tellOn: false, tellClock: 0, lunge: 0, flinch: 0, goneT: -1, yaw: 0, first: true, home: V(e.x, 0, e.z) };
  const EK = {}; // emergeAt's out, reused
  v.hairYaw = 0; v.hairTilt = 0; v.px = 0; v.pz = 0; // the hair's lag (0.15 s) behind her head and her going
  // the mist: one Points draw call in the world (not under g, which is scaled flat while she is)
  const mPos = new Float32Array(MIST * 3); const mCol = new Float32Array(MIST * 4);
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3).setUsage(THREE.DynamicDrawUsage));
  mistGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 4).setUsage(THREE.DynamicDrawUsage));
  const mistMat = new THREE.PointsMaterial({ size: 0.26, map: moteTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
  mistMat.userData.ownMap = true;
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false; mist.visible = false; mist.name = 'wife mist';
  if (ctx.scene) ctx.scene.add(mist);
  v.mist = 0;
  // for the smoke harness: what is shown of her, read each frame
  g.userData.wifeEmerge = { ghost: 0, look: 1, lift: 1, t: -1, mist: 0, x: 0, y: 0, z: 0, sx: 1, sz: 1 };
  function mistAt(time, amt) {
    mist.visible = amt > 0.002 && g.visible;
    if (!mist.visible) return;
    for (let i = 0; i < MIST; i++) {
      const p = frac(time * 0.45 + hash(i, 3)); const q = smooth(p);
      // from a point of her painted figure on the canvas to a point of her, wherever she now is
      const lx = (hash(i, 5) - 0.5) * 0.7; const ly = -0.9 * hash(i, 6) + 0.15;
      const sx = spot.x + spot.ax * lx; const sy = spot.y + ly; const sz = spot.z + spot.az * lx;
      const hy = g.position.y + g.scale.y * (0.2 + 1.5 * hash(i, 7));
      const tx = g.position.x + (hash(i, 8) - 0.5) * 0.5; const tz = g.position.z + (hash(i, 9) - 0.5) * 0.5;
      const curl = 0.08 * Math.sin(time * 1.7 + i * 2.3) * Math.sin(Math.PI * p);
      mPos[i * 3] = lerp(sx, tx, q) + curl * spot.az; mPos[i * 3 + 1] = lerp(sy, hy, q) + 0.1 * p; mPos[i * 3 + 2] = lerp(sz, tz, q) - curl * spot.ax;
      mCol[i * 4] = 0.78; mCol[i * 4 + 1] = 0.85; mCol[i * 4 + 2] = 0.93; mCol[i * 4 + 3] = 0.42 * amt * Math.sin(Math.PI * p);
    }
    mistGeo.attributes.position.needsUpdate = true;
    mistGeo.attributes.color.needsUpdate = true;
  }
  const m4 = new THREE.Matrix4(); const sh = [V(), V()]; const hand = [V(), V()]; const elbow = V(); const bend = V();

  function pose(o) {
    body.position.set(0, 0.16 + 0.05 * Math.sin(o.time * 1.3), 0);
    body.rotation.set(-0.16 - 0.45 * o.tell - 0.2 * o.lunge + 0.5 * o.flinch, 0.5 * o.flinch, 0.05 * Math.sin(o.time * 0.9));
    body.updateMatrix();
    m4.copy(body.matrix);
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1;
      sh[i].copy(W_SH[i]).applyMatrix4(m4);
      // out: hands held low and open; the tell: both come up and reach; the garlic: crossed before the face
      _a.set(sx * 0.28, 1.0 + 0.04 * Math.sin(o.time * 1.1 + i), -0.25);
      _b.set(sx * (0.2 + 0.08 * Math.sin(o.time * 17 + i)), 1.55 + 0.1 * o.lunge, -0.72);
      _c.set(-sx * 0.06, 1.72, -0.2);
      hand[i].copy(_a).lerp(_b, o.tell).lerp(_c, o.flinch).applyMatrix4(m4);
      bend.set(sx * 0.6, -0.5, 0.6).transformDirection(m4);
      placeArm(L, i * 3, sh[i], hand[i], W_ARM[0], W_ARM[1], bend, 0.034, elbow, 2.6);
    }
    L.commit();
  }

  v.sync = (en, dt, time, eye, cfg2, reduced) => {
    const st = String(en.state || '');
    // Seen coming out of the canvas (stir with en.emerge: logic/emerge.js), out of it, going out
    // through the house when driven back (flee) and coming back (return, #10); unseen while she is
    // away (en.hidden).
    const out = !en.hidden && (st === 'out' || st === 'tell' || st === 'flee' || st === 'return');
    const emerging = !en.hidden && st === 'stir' && en.emerge != null;
    if (v.first) { v.home.set(en.home ? en.home.x : en.x, 0, en.home ? en.home.z : en.z); v.first = false; }
    const report = g.userData.wifeEmerge;
    if (emerging) {
      const ET = (cfg2 && cfg2.wife && cfg2.wife.emergeTime) || EMERGE.time;
      emergeAt(en.emerge, ET, EK);
      v.shown = EK.ghost; // all of her by 40 percent of the way: out, she is whole
      if (v.shown >= 1) v.emerged = true;
    } else v.shown = out ? Math.min(1, v.shown + dt / 0.55) : 0;
    if (v.shown >= 1) v.emerged = true; // once fully out, later showings fade in where she is
    g.visible = (out || emerging) && Math.hypot(eye.x - en.x, eye.z - en.z) < FAR;
    v.mist = emerging ? Math.max(v.mist, EK.mist) : approach(v.mist, 0, dt, 1.1);
    if (!g.visible) { mist.visible = false; report.ghost = 0; report.t = -1; return; }
    const k = smooth(v.shown);
    let look = 1; let rip = 0; let grow = 99; let flash = 0; let calm = 0;
    if (emerging) {
      // off the canvas: from the painted figure, flat on the paint at the painted head's size, to where the rules stand her
      const L = EK.lift; const sc = lerp(W_S0, 1, EK.grow);
      g.position.set(lerp(spot.x, en.x, L), lerp(spot.y - sc * W_FACE, num(en.y), L), lerp(spot.z, en.z, L));
      g.rotation.y = spot.yaw + wrap(num(en.heading) - spot.yaw) * L;
      g.scale.set(sc, sc, sc * lerp(W_FLAT, 1, L));
      look = EK.look; rip = (reduced ? 0.35 : 1) * EK.ripple;
      grow = 4 * (1 - EK.frame); // held to her part of the canvas, then out past its edge (her gown pours below the frame)
      calm = 1 - EK.grin;
      flash = reduced ? 0 : 0.35 * EK.ripple * EK.look;
    } else {
      // (a showing with no emergence, as after a restore mid-fight: from the painting to where the rules have her)
      const from = v.emerged ? 1 : k;
      g.position.set(lerp(v.home.x, en.x, from), num(en.y), lerp(v.home.z, en.z, from));
      g.rotation.y = num(en.heading);
      g.scale.set(0.3 + 0.7 * from, 1, 0.3 + 0.7 * from);
    }
    wu.uLook.value = look; wu.uRip.value = rip; wu.uTime.value = time; wu.uGrow.value = grow; wu.uFlash.value = flash; wu.uCalm.value = calm;
    // the hair a beat (0.15 s) behind her head's turn, and trailing as she goes
    const yawNow = g.rotation.y + hd.group.rotation.y;
    const speed = dt > 0 ? Math.hypot(g.position.x - v.px, g.position.z - v.pz) / dt : 0;
    v.px = g.position.x; v.pz = g.position.z;
    v.hairYaw = dt > 0 ? v.hairYaw + wrap(yawNow - v.hairYaw) * Math.min(1, dt / 0.15) : yawNow;
    v.hairTilt = dt > 0 ? approach(v.hairTilt, clamp(speed * 0.3, 0, 0.45), dt, 1 / 0.15) : 0;
    hair.mesh.rotation.y = Math.PI + clamp(wrap(v.hairYaw - yawNow), -0.6, 0.6);
    hair.mesh.rotation.x = -v.hairTilt;
    mistAt(time, v.mist * (reduced ? 0.6 : 1));
    report.ghost = emerging ? EK.ghost : k; report.look = look; report.lift = emerging ? EK.lift : 1; report.t = emerging ? en.emerge : -1; report.mist = v.mist; // nothing made a frame
    report.x = g.position.x; report.y = g.position.y; report.z = g.position.z; report.sx = g.scale.x; report.sz = g.scale.z;
    v.fleeK = approach(v.fleeK || 0, st === 'flee' ? 1 : 0, dt, 6); // she thins as she goes into the stone
    if (v.tellOn) { v.tellClock += dt; if (v.tellClock > 1.2) v.tellOn = false; }
    const wt = (cfg2 && cfg2.wife && cfg2.wife.tell) || 0.6;
    const tell = Math.max(en.tell > 0 ? 1 - en.tell / wt : 0, v.tellOn ? clamp(v.tellClock / wt) : 0);
    v.tellAmt = approach(v.tellAmt, smooth(tell), dt, 20);
    v.lunge = Math.max(0, v.lunge - dt * 2.5);
    v.flinch = approach(v.flinch, st === 'flee' ? 1 : 0, dt, 9);
    S.breathe(rig, time, { look: eye, sway: 2.2, wind: 0.5 });
    hd.group.rotation.y = approach(hd.group.rotation.y, -1.1 * v.flinch, dt, 10);
    hd.pose({ jaw: Math.max(0.15 * (1 - calm), 0.95 * Math.max(v.tellAmt, v.lunge)), frown: (0.6 + 0.4 * v.flinch) * (1 - 0.7 * calm), brow: -0.6 * (1 - 0.7 * calm) });
    pose({ time, tell: v.tellAmt, lunge: v.lunge, flinch: v.flinch });
    // painted, almost opaque; then a third strength; brighter on the lunge (not under reduced flash)
    mat.opacity = lerp(W_PAINTED, 0.42, look) * k * (1 - 0.35 * v.flinch) * (1 - 0.6 * v.fleeK) + (reduced ? 0 : 0.3 * v.lunge);
    faceMat.opacity = mat.opacity; jawMat.opacity = mat.opacity;
  };
  v.onEvent = (ev) => {
    if (ev.type === 'strikeTell') { v.tellOn = true; v.tellClock = 0; }
    else if (ev.type === 'strike') { v.tellOn = false; v.lunge = 1; }
  };
  // Driven off (she leaves the sim with no kill): she shreds upward and is gone.
  v.linger = (dt, time) => {
    if (!g.visible) return false;
    if (v.goneT < 0) v.goneT = 0;
    v.goneT += dt;
    const k = clamp(v.goneT / 0.9);
    g.scale.set((1 - k) * (1 + 0.25 * Math.sin(time * 37)), 1 + 1.6 * k * k, 1 - 0.8 * k);
    g.position.y += dt * 1.2 * k;
    wu.uLook.value = 1; wu.uRip.value = 0; wu.uGrow.value = 99; wu.uFlash.value = 0; wu.uCalm.value = 0; mist.visible = false;
    mat.opacity = 0.42 * (1 - k); faceMat.opacity = mat.opacity; jawMat.opacity = mat.opacity;
    hd.pose({ jaw: 1 });
    pose({ time, tell: 0, lunge: 0, flinch: 1 });
    return k < 1;
  };
  v.die = () => { g.visible = false; mist.visible = false; };
  v.updateDeath = () => true;
  v.dispose = () => { freeTree(g, ctx.keep); freeTree(mist, ctx.keep); };
  v.count = () => S.count(g);
  g.visible = false;
  pose({ time: 0, tell: 0, lunge: 0, flinch: 0 });
  return v;
}

// ---- what the zone sets share ---------------------------------------------------------------------
// A set is { g, figures: { name: Object3D }, update(c), onEvent?(ev, c), reset?() }.
// c (once a frame): { sim, w, pl, dt, time, eye, reduced, zone } with sim, w and pl null on the title.

/** A bone: a shaft with a knob at each end. */
function bone(a, b, r, seed = 1) {
  const A = V(...a); const B = V(...b);
  return S.skin([
    { at: A, r: r * 1.7 }, { at: A.clone().lerp(B, 0.14), r }, { at: A.clone().lerp(B, 0.86), r: r * 0.9 }, { at: B, r: r * 1.55 },
  ], { sides: 5, detail: 1, noise: 0.08, seed, color: BONE, color2: 0x9c9072, mottle: 0.25, shade: 0.35, capLen: 0.6 });
}

/** Moves a geometry built round the origin (facing -Z) to a place and heading on the plan. */
const seat = (geo, x, y, z, yaw) => geo.applyMatrix4(_m.compose(_a.set(x, y, z), _q.setFromAxisAngle(_y.set(0, 1, 0), yaw), ONE));

// ---- the ghost at the tea table (R7) --------------------------------------------------------------
// She sits at the head of the table and never leaves. E on her, or on the carriage clock in front
// of her, and her mouth opens far too wide: a scream with no sound. Six draw calls (seven in the scream).

function buildGhost(ctx) {
  const seed = 71;
  const g = new THREE.Group(); const body = new THREE.Group();
  g.add(body);
  const mat = ctx.phantom.clone();
  mat.opacity = 0.4;
  const gown = mesh(S.skin([
    { at: [0, 0.06, 0.34], r: [0.34, 0.3], color: 0x7f93a8 }, { at: [0, 0.46, 0.36], r: [0.27, 0.25] }, { at: [0, 0.62, 0.42], r: [0.2, 0.17] },
    { at: [0, 0.9, 0.34], r: [0.14, 0.115] }, { at: [0, 1.12, 0.23], r: [0.2, 0.12] }, { at: [0, 1.22, 0.19], r: 0.06, color: 0xdde8f2 },
  ], { seed, sides: 10, detail: 2, budget: 520, noise: 0.08, mottle: 0.2, color: PHANTOM, color2: 0x9db4c9, profile: (a, u) => 1 + (1 - u) * 0.12 * Math.sin(a * 7) }), mat);
  const hd = S.head({
    size: 0.2, seed, budget: 1500, defects: ['noPupil:L', 'noPupil:R', 'noBlink'], cast: false,
    face: {
      skin: 0xdfe9f2, eye: 0xf2f6ff, hair: 0xb8c6d4, skull: { tall: 1.2, wide: 0.88, taper: 0.5, cheek: 0.01, socket: 0.12, temple: 0.1 },
      eyes: { r: 0.19, open: 1.0, white: 0xf4f8ff }, brow: { color: 0x8f9eae, thick: 0.02, tilt: -0.5 }, nose: { kind: 'long', size: 0.06, length: 0.22 },
      mouth: { width: 0.24, smile: -0.2, lip: 0x8fa3b8, toothLen: 0.05 }, cheek: { rosy: 0 }, ears: { kind: 'none' },
    },
    extras: [ball(0.1, 0, 0.4, 0.1, 0xb8c6d4, 1, 0.8, 1)], // her hair, up
  });
  hd.group.position.set(0, 1.22, 0.19);
  for (const m of [hd.skull, hd.jaw, hd.features]) if (m) m.material = mat;
  // the dark she opens on
  const maw = mesh(new THREE.SphereGeometry(1, 10, 8), ctx.black);
  maw.position.copy(hd.at(0, -0.6, -0.5)); maw.visible = false; // set back inside the head: a cavity, not a patch
  const lips = mesh(new THREE.TorusGeometry(1, 0.13, 6, 22), mat); // the stretched rim of it, at the face
  S.tint(lips.geometry, 0x9db4c9); lips.geometry.deleteAttribute('uv');
  lips.position.copy(hd.at(0, -0.6, 0.0)); lips.visible = false;
  hd.group.add(maw, lips);
  const L = S.limbs(6, { seed, sides: 5, taper: 0.6, material: mat, cast: false });
  for (let i = 0; i < 6; i++) L.tone(i, i % 3 === 2 ? 0xe6eef6 : PHANTOM);
  body.add(gown, hd.group);
  g.add(L.mesh);
  const rig = { root: body, chest: gown, head: hd, seed, rate: 0.12, depth: 0.7 };
  const sh = [V(), V()]; const hand = [V(), V()]; const elbow = V(); const bend = V();
  let scream = -1; let yaw = 0; let faceWorld = 0;
  const mawY = maw.position.y; const jawY = hd.jaw ? hd.jaw.position.y : 0;

  function arms(k, time) {
    body.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1;
      sh[i].set(sx * 0.19, 1.1, 0.23).applyMatrix4(body.matrix);
      // forearms on the cloth either side of the clock; flung wide and clawed when she screams
      hand[i].set(sx * 0.2, 0.84, -0.42).lerp(_a.set(sx * (0.5 + 0.03 * Math.sin(time * 31 + i)), 1.0, -0.3), k);
      bend.set(sx * 0.8, -0.6, 0.2);
      placeArm(L, i * 3, sh[i], hand[i], 0.3, 0.32, bend, 0.038, elbow, 1.5);
    }
    L.commit();
  }

  return {
    g,
    place(x, y, z, facing) { g.position.set(x, y, z); g.rotation.y = facing; faceWorld = facing; },
    scream() { scream = 0; },
    reset() { scream = -1; },
    update(c) {
      const { dt, time, eye, reduced } = c;
      let k = 0;
      if (scream >= 0) {
        scream += dt;
        const open = reduced ? 0.5 : 0.14;
        k = scream < 1.5 ? smooth(scream / open) : 1 - smooth((scream - 1.5) / 0.6);
        if (scream > 2.1) { scream = -1; k = 0; }
      }
      const dx = eye.x - g.position.x; const dz = eye.z - g.position.z;
      yaw = approach(yaw, clamp(wrap(headingTo(dx, dz) - faceWorld), -1.5, 1.5), dt, k > 0 ? 12 : 1.2);
      body.rotation.x = -0.1 - 0.22 * k;
      S.breathe(rig, time, { look: eye, amount: 1 - k });
      hd.group.rotation.y = yaw;
      hd.group.rotation.x += 0.3 * k; // the head goes back as the jaw goes down
      hd.pose({ jaw: k, brow: k, frown: -0.6 * (1 - k) });
      // impossibly wide: the jaw comes off its hinge, drops and spreads, and the whole lower face goes with it
      if (hd.jaw) { hd.jaw.scale.set(1 + 1.2 * k, 1 + 1.5 * k, 1 + 0.2 * k); hd.jaw.position.y = jawY - 0.07 * k; }
      hd.skull.scale.set(1 + 0.42 * k, 1 + 0.12 * k, 1);
      hd.features.scale.set(1 + 0.42 * k, 1 + 0.12 * k, 1);
      maw.visible = k > 0.02;
      maw.scale.set(0.16 * k + 0.01, 0.115 * k + 0.01, 0.11 * k + 0.01); // a dark nearly as wide as her face, and deep inside it
      maw.position.y = mawY - 0.07 * k;
      lips.visible = maw.visible;
      lips.scale.set(0.165 * k + 0.01, 0.12 * k + 0.01, 0.06);
      lips.position.y = mawY - 0.07 * k;
      mat.opacity = 0.4 + (reduced ? 0.1 : 0.3) * k;
      arms(k, time);
    },
  };
}

// ---- the Beefeater skeleton (R7) ------------------------------------------------------------------
// Small body, big head, a big smile, in the Rose Court guard's hat, a pocket watch in his hand (the
// watch itself is one of the five clocks: keepprops.js draws it in his palm, and his chair). Four draw calls.

function buildSkeleton(ctx) {
  const seed = 83; const M = ctx.M;
  const g = new THREE.Group();
  const parts = [
    S.skin([{ at: [0, 0.54, 0.1], r: 0.035 }, { at: [0, 0.78, 0.13], r: 0.03 }, { at: [0, 1.0, 0.08], r: 0.03 }, { at: [0, 1.08, 0.04], r: 0.026 }],
      { sides: 6, detail: 3, noise: 0.05, rough: 0.45, seed, color: BONE, color2: 0x9c9072, mottle: 0.25 }), // the spine, knuckled
    ball(0.13, 0, 0.56, 0.1, BONE, 1.2, 0.55, 0.8, 0.25),
    S.tint(new THREE.TorusGeometry(0.1, 0.035, 5, 12).rotateX(Math.PI / 2).translate(0, 1.04, 0.05), SCARLET, 0.35, seed), // what is left of the ruff
    // legs: thighs along the seat, shins down
    bone([0.08, 0.57, 0.08], [0.1, 0.56, -0.27], 0.022, 2), bone([-0.08, 0.57, 0.08], [-0.1, 0.56, -0.27], 0.022, 3),
    bone([0.1, 0.55, -0.28], [0.1, 0.07, -0.25], 0.018, 4), bone([-0.1, 0.55, -0.28], [-0.11, 0.07, -0.22], 0.018, 5),
    S.claw({ fingers: 4, length: 0.13, spread: 0.3, curl: 0.25, r: 0.014, color: BONE, tip: 0x9c9072, seed }).translate(0.1, 0.05, -0.26),
    S.claw({ fingers: 4, length: 0.13, spread: 0.3, curl: 0.25, r: 0.014, color: BONE, tip: 0x9c9072, seed: seed + 1 }).translate(-0.11, 0.05, -0.23),
    // the right arm: out across the cloth, palm up under the watch
    bone([0.2, 1.0, 0.06], [0.22, 0.86, -0.22], 0.02, 6), bone([0.22, 0.86, -0.23], [0.02, 0.855, -0.6], 0.017, 7),
    S.claw({ fingers: 4, length: 0.15, spread: 0.45, curl: 0.55, r: 0.015, color: BONE, tip: 0x9c9072, seed: seed + 2 }).rotateZ(Math.PI).translate(0, 0.845, -0.62),
    // the left: hanging, the fingers open over the spilled wine
    bone([-0.2, 1.0, 0.06], [-0.27, 0.72, 0.04], 0.02, 8), bone([-0.27, 0.71, 0.04], [-0.3, 0.44, -0.02], 0.017, 9),
    S.claw({ fingers: 4, length: 0.14, spread: 0.4, curl: 0.3, r: 0.014, color: BONE, tip: 0x9c9072, seed: seed + 3 }).rotateX(-Math.PI / 2).translate(-0.3, 0.43, -0.02),
    bone([-0.2, 1.01, 0.06], [0.2, 1.01, 0.06], 0.018, 10), // collar bones
    // a watch chain from the ribs to the hand
    S.skin([{ at: [0.06, 0.8, -0.06], r: 0.006 }, { at: [0.07, 0.7, -0.25], r: 0.006 }, { at: [0.03, 0.82, -0.5], r: 0.006 }, { at: [0, 0.86, -0.6], r: 0.006 }],
      { sides: 4, detail: 3, noise: 0.3, seed, color: GOLD, mottle: 0.3 }),
  ];
  for (let i = 0; i < 5; i++) { // ribs: hoops open at the back
    const y = 0.72 + i * 0.058; const r = 0.1 + 0.035 * Math.sin((i + 0.6) / 5 * Math.PI);
    parts.push(S.tint(new THREE.TorusGeometry(r, 0.011, 4, 12, Math.PI * 1.6).rotateZ(Math.PI * 0.7).rotateX(Math.PI / 2).scale(1.25, 1, 0.9).translate(0, y, 0.05), BONE, 0.25, i));
  }
  const body = mesh(S.merge(parts), M.skin, true);
  body.receiveShadow = true;
  // the guard's hat: tall, black, leaning; the gold heart on it scratched out
  const hat = [
    S.skin([{ at: [0, 0.6, 0.02], r: 0.42, color: GOLD }, { at: [0, 0.67, 0.02], r: 0.415, color: GOLD }, { at: [0, 0.69, 0.02], r: 0.41 },
      { at: [0.05, 1.0, 0.04], r: 0.39 }, { at: [0.16, 1.34, 0.07], r: 0.36 }],
    { seed, sides: 12, detail: 2, budget: 320, caps: ['open', 'round'], capLen: 0.3, color: INK, color2: 0x3b3027, noise: 0.05, rough: 0.04, mottle: 0.22, shade: 0.1 }),
    S.tint(new THREE.TorusGeometry(0.44, 0.036, 5, 16).rotateX(Math.PI / 2).scale(1, 0.5, 1).translate(0, 0.6, 0.02), INK, 0.25, seed),
    S.pip('heart', 0.22, GOLD).rotateY(Math.PI).translate(0, 0.92, -0.395),
    slab(0.3, 0.024, 0.012, 0, 0.92, -0.4, 0x15110f).rotateZ(0.5),
  ];
  const hd = S.head({
    size: 0.4, seed, budget: 2200, defects: ['smileWide', 'teethMany', 'noPupil:L', 'noPupil:R', 'noBlink'], extras: hat,
    face: {
      skin: BONE, eye: 0x0a0908, skull: { wide: 1.02, tall: 1.0, taper: 0.4, cheek: 0.09, brow: 0.05, socket: 0.22, temple: 0.14, chin: 0.02 },
      eyes: { r: 0.24, open: 1.4, white: 0x0b0a09, lat: 0.12 }, brow: { none: true }, nose: { kind: 'none' },
      mouth: { width: 0.95, smile: 0.9, lip: 0xb8ae92, teeth: 14, toothLen: 0.11, rest: 0.12 }, cheek: { rosy: 0 }, ears: { kind: 'none' },
    },
    wet: [S.tint(new THREE.ConeGeometry(0.045, 0.09, 3).rotateX(Math.PI).translate(0, 0.27, -0.385), 0x0b0a09)], // where the nose was
  });
  hd.group.position.set(0, 1.08, 0.03);
  g.add(body, hd.group);
  const rig = { head: hd, seed };
  let yaw = 0; let near = 0; let faceWorld = 0;
  return {
    g,
    place(x, y, z, facing) { g.position.set(x, y, z); g.rotation.y = facing; faceWorld = facing; },
    update(c) {
      const { dt, time, eye } = c;
      const dx = eye.x - g.position.x; const dz = eye.z - g.position.z;
      // the head comes round after the warden, slowly, and the smile widens when the warden is close
      yaw = approach(yaw, clamp(wrap(headingTo(dx, dz) - faceWorld), -1.3, 1.3), dt, 0.9);
      near = approach(near, Math.hypot(dx, dz) < 3.2 ? 1 : 0, dt, 1.5);
      S.breathe(rig, time, { amount: 0, blink: false });
      hd.group.rotation.y = yaw;
      hd.group.rotation.z = 0.12;
      hd.pose({ jaw: 0.1 + 0.4 * near + 0.05 * near * Math.sin(time * 14) });
    },
  };
}

// ---- the raven (R7, R9, R14) ----------------------------------------------------------------------
// Never where the reticle is going. It perches where haunts.js says (sim.waves.haunts.raven), flies
// when that changes, and in the Count's room goes to each curtain in turn (issue #8: the padlock,
// the hem nails, then the middle cord, count.js nextCurtain) and tugs at its way. Three
// draw calls: the bird and its two wings.

const PERCH_Y = Object.fromEntries(MAP.TEA.ravenPerches.map((p) => [p.on, p.y])); // the top of each clock (keepmap TEA.ravenPerches)

function buildRaven(ctx) {
  const seed = 5; const M = ctx.M;
  const g = new THREE.Group(); const bird = new THREE.Group();
  g.add(bird);
  const black = 0x0b0b10; const sheen = 0x1c2540;
  const parts = [
    S.skin([{ at: [0, 0.0, 0.16], r: [0.04, 0.03] }, { at: [0, 0.03, 0.05], r: [0.075, 0.07] }, { at: [0, 0.06, -0.08], r: [0.07, 0.072] }, { at: [0, 0.12, -0.15], r: 0.045 }],
      { seed, sides: 8, detail: 2, budget: 260, noise: 0.06, rough: 0.12, color: black, color2: sheen, mottle: 0.3 }),
    ball(0.052, 0, 0.15, -0.17, black, 0.95, 0.95, 1.1, 0.3),
    S.skin([{ at: [0, 0.15, -0.2], r: [0.02, 0.024] }, { at: [0, 0.145, -0.27], r: [0.012, 0.016] }, { at: [0, 0.125, -0.315], r: 0.002 }],
      { seed: seed + 1, sides: 5, detail: 2, noise: 0.03, color: 0x15151a, mottle: 0.2 }), // the beak: heavy, a little hooked
    S.skin([{ at: [0, 0.01, 0.14], r: [0.05, 0.012] }, { at: [0, -0.01, 0.27], r: [0.062, 0.008] }, { at: [0, -0.03, 0.38], r: [0.03, 0.004] }],
      { seed: seed + 2, sides: 6, detail: 2, noise: 0.05, color: black, color2: sheen, mottle: 0.3 }), // the tail, a wedge
    ball(0.009, 0.036, 0.165, -0.2, 0x3a3a44, 1, 1, 1, 0), ball(0.009, -0.036, 0.165, -0.2, 0x3a3a44, 1, 1, 1, 0),
  ];
  for (const sx of [-1, 1]) {
    parts.push(S.skin([{ at: [sx * 0.035, 0, 0], r: 0.012 }, { at: [sx * 0.04, -0.075, -0.01], r: 0.007 }], { sides: 4, detail: 1, noise: 0, color: 0x1a1a1e }));
    parts.push(S.claw({ fingers: 3, length: 0.05, spread: 0.5, curl: 0.5, r: 0.006, color: 0x1a1a1e, tip: 0x050505, back: true, seed: seed + sx }).translate(sx * 0.04, -0.075, -0.01));
  }
  const bodyMesh = mesh(S.merge(parts), M.gloss, true);
  bird.add(bodyMesh);
  const wings = [-1, 1].map((sx) => {
    const geo = S.skin([
      { at: [0, 0, 0], r: [0.06, 0.012] }, { at: [sx * 0.16, 0, 0.015], r: [0.1, 0.01] }, { at: [sx * 0.34, 0, 0.05], r: [0.085, 0.006] }, { at: [sx * 0.52, 0, 0.12], r: [0.02, 0.003] },
    ], { seed: seed + 5 + sx, sides: 6, detail: 2, budget: 160, noise: 0.05, color: black, color2: sheen, mottle: 0.35, side: [0, 0, 1],
      profile: (a, u) => 1 + 0.25 * Math.max(0, Math.sin(a)) * Math.abs(Math.sin(u * 22)) }); // the trailing edge: feather tips
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.055, 0.085, -0.05);
    pivot.add(mesh(geo, M.gloss, true));
    bird.add(pivot);
    return pivot;
  });
  g.scale.setScalar(1.25);
  const at = V(); const from = V(); const to = V(); const look = V();
  let flyT = -1; let flyDur = 0.6; let has = false; let yaw = 0; let caw = 0; let spread = 0; let tug = false;
  return {
    g,
    reset() { has = false; flyT = -1; caw = 0; g.visible = false; },
    caw() { caw = 1.6; },
    /** goal: { x, y, z, tug } or null (not in this room). */
    update(c, goal) {
      const { dt, time, eye } = c;
      if (!goal) { g.visible = false; has = false; return; }
      g.visible = true;
      tug = !!goal.tug;
      if (!has) { at.set(goal.x, goal.y, goal.z); to.copy(at); has = true; flyT = -1; }
      if (to.distanceTo(_a.set(goal.x, goal.y, goal.z)) > 0.15) {
        from.copy(at); to.copy(_a); flyT = 0;
        flyDur = clamp(from.distanceTo(to) / 13, 0.45, 1.6);
      }
      let air = 0;
      if (flyT >= 0) {
        flyT += dt;
        const k = clamp(flyT / flyDur); const s = smooth(k);
        at.lerpVectors(from, to, s);
        at.y += Math.sin(Math.PI * k) * Math.min(1.4, 0.25 + 0.12 * from.distanceTo(to));
        air = Math.sin(Math.PI * Math.min(1, k * 1.15));
        look.subVectors(to, from);
        if (k >= 1) { flyT = -1; at.copy(to); }
      }
      spread = approach(spread, Math.max(air > 0 ? 1 : 0, tug ? 0.55 : 0), dt, 14);
      caw = Math.max(0, caw - dt);
      g.position.copy(at);
      // perched it watches the warden side-on, as birds do; in the air it faces where it is going
      const goalYaw = flyT >= 0 ? headingTo(look.x, look.z) : headingTo(eye.x - at.x, eye.z - at.z) + 0.9;
      yaw += wrap(goalYaw - yaw) * Math.min(1, dt * (flyT >= 0 ? 14 : 3));
      g.rotation.y = yaw;
      const flap = Math.sin(time * 24);
      const hop = flyT < 0 ? Math.max(0, Math.sin(time * 1.3 + 2)) ** 12 * 0.03 : 0;
      bird.position.y = 0.09 + hop + (tug ? 0.05 * Math.sin(time * 7) : 0);
      bird.rotation.x = -0.25 * spread + (caw > 0 ? 0.35 * Math.sin(time * 16) * Math.min(1, caw) : 0) + (tug ? 0.3 + 0.25 * Math.sin(time * 7) : 0);
      wings.forEach((p, i) => {
        const sx = i ? 1 : -1;
        p.rotation.y = -sx * 1.42 * (1 - spread); // folded back along the body
        p.scale.set(0.5 + 0.5 * spread, 1, 1);
        p.rotation.z = sx * (-0.3 * (1 - spread) + spread * 0.75 * flap);
      });
    },
  };
}

// ---- the tea room (R7): the ghost, the skeleton, the werewolf's painting and its arm --------------

function buildTeaSet(ctx) {
  const M = ctx.M; const T = MAP.TEA;
  const g = new THREE.Group();
  const ghost = buildGhost(ctx);
  ghost.place(T.ghost.x, 0, T.table.maxZ + 0.42 - 0.38, 0); // on the chair at the head of the table, facing up it, the carriage clock in front of her
  const skel = buildSkeleton(ctx);
  skel.place(T.skeleton.x, 0, T.skeleton.z, headingTo(MAP.CLOCKS[3].x - T.skeleton.x, MAP.CLOCKS[3].z - T.skeleton.z)); // his hand under the watch
  // the werewolf's wall and its reach
  const wyaw = facingIn('tea', T.werewolf.x, T.werewolf.z);
  const reach = (ctx.cfg && ctx.cfg.werewolf && ctx.cfg.werewolf.reach) || 1.8;
  const wall = { x: T.werewolf.x + Math.sin(wyaw) * 0.14, z: T.werewolf.z + Math.cos(wyaw) * 0.14 }; // back onto the wall's face
  const G = T.werewolf.gouge; // the middle of the gouge ring keepprops.js draws: the arm comes as far as its rim
  // The painting is two layers on one canvas (as the wives'): the werewolf with the upper half of his
  // raised arm, and over it the raised forearm and clawed hand (paintWerewolfHand), cut out, which
  // ripples and falls away from the canvas as the 3D arm comes off it (logic/clawemerge.js).
  const AW = MAP.WALL_ART.werewolf;
  const at = { x: wall.x - Math.sin(wyaw) * 0.04, y: 1.95, z: wall.z - Math.cos(wyaw) * 0.04, yaw: wyaw, w: AW.w, h: AW.h };
  const SM = 0.14 * AW.w; // the painter's s, in metres
  const onCanvas = (q) => ({ x: SM * q.x, y: (0.16 - 0.14 * q.y * (AW.w / AW.h)) * AW.h }); // a painter's point in the plane (+x the viewer's right, +y up)
  const elbow = onCanvas(WW_ELBOW); const wrist = onCanvas(WW_WRIST); const palm = onCanvas(WW_PALM);
  const art = paintings([
    { ...at, paint: paintWerewolf, ground: 0x0b0f0c, canvas: 'werewolf' },
    { ...at, paint: paintWerewolfHand, bare: true, alone: true, canvas: 'werewolf', ripple: { u: 0.5 + 0.14 * WW_PALM.x, v: 0.34 + 0.14 * WW_PALM.y * (AW.w / AW.h) } },
  ], M, { name: 'painted:werewolf' });
  // The arm that strikes is that raised hand: from the painted elbow, the scarlet sleeve (DRESS, as
  // painted) to the cuff's two gold bands and the fur at the wrist, the dark palm, four fingers and the
  // four long hooked claws, bone at the tips. Built along +z from the elbow (the hand from the wrist),
  // at the painted size; the view lays it upright on the canvas, flat, and swings it out at the warden
  // while the sleeve stretches out of the canvas. Its own material (the skin's, dithered by alphaHash:
  // no sorting, no transparency pass) crosses with the paint.
  const D = DRESS; const C = MAP.WEREWOLF_CLAW;
  const HS = SM * WW_HAND; // the hand's size
  const PALM_AT = Math.hypot(palm.x - wrist.x, palm.y - wrist.y); // wrist to palm
  const armMat = M.skin.clone(); armMat.alphaHash = true;
  const sleeveGeo = S.skin([{ at: [0, 0, -0.03], r: 0.07 }, { at: [0, 0, 0.5], r: 0.067 }, { at: [0, 0, 1], r: 0.064 }],
    { seed: 9, sides: 10, detail: 2, budget: 160, noise: 0.04, mottle: 0.12, color: D.TUDOR, caps: ['round', 'open'] });
  const handParts = [
    S.skin([{ at: [0, 0, -0.07], r: 0.07, color: D.TUDOR }, { at: [0, 0, -0.052], r: 0.072, color: D.TUDOR }, { at: [0, 0, -0.045], r: 0.076, color: D.TRIM }, { at: [0, 0, -0.03], r: 0.076, color: D.TRIM },
      { at: [0, 0, -0.022], r: 0.074, color: D.TUDOR }, { at: [0, 0, -0.012], r: 0.074, color: D.TUDOR }, { at: [0, 0, -0.005], r: 0.077, color: D.TRIM }, { at: [0, 0, 0.01], r: 0.077, color: D.TRIM }],
    { seed: 10, sides: 10, detail: 1, budget: 200, noise: 0.03, mottle: 0.1, caps: ['open', 'flat'] }),
    S.skin([{ at: [0, 0, 0.0], r: 0.082 }, { at: [0, 0, 0.05], r: 0.09 }, { at: [0, 0, 0.1], r: 0.072 }],
      { seed: 11, sides: 9, detail: 2, budget: 140, noise: 0.18, rough: 0.6, color: D.FUR, color2: D.FUR_DARK, mottle: 0.3 }),
    ball(HS * 0.5, 0, 0, PALM_AT, D.FUR_DARK, 0.84, 0.36, 1, 0.15),
  ];
  for (let i = 0; i < C.fingers; i++) {
    const f = i / (C.fingers - 1) - 0.5;
    const a = f * C.spread * 1.9; // fanned across the hand, as painted
    const dx = Math.sin(a); const dz = Math.cos(a); const px = Math.cos(a); const pz = -Math.sin(a);
    const bx = dx * HS * 0.38 + px * f * HS * 0.3; const bz = PALM_AT + dz * HS * 0.38 + pz * f * HS * 0.3;
    const kx = bx + dx * HS * 0.5; const kz = bz + dz * HS * 0.5;
    handParts.push(S.skin([{ at: [bx, 0, bz], r: HS * 0.09 }, { at: [kx, 0, kz], r: HS * 0.075 }], { seed: 12 + i, sides: 6, detail: 1, budget: 40, noise: 0.1, color: D.FUR_DARK }));
    const len = HS * (C.length / 0.46) * 0.95 * (1 - 0.25 * Math.abs(f * 2));
    handParts.push(S.claw({ ...MAP.WEREWOLF_CLAW, fingers: 1, length: len, spread: 0, r: HS * 0.075, color: D.CLAW, tip: BONE, seed: 20 + i }).rotateY(Math.PI + a).translate(kx, 0, kz));
  }
  const handLen = PALM_AT + HS * 0.88 + HS * 0.95; // the painted wrist to the middle claws' tips
  const mount = new THREE.Group(); // the painted elbow, in the canvas's frame (+z out into the room)
  mount.position.set(elbow.x, elbow.y, 0.03).applyMatrix4(new THREE.Matrix4().compose(V(at.x, at.y, at.z), _q.setFromAxisAngle(_y.set(0, 1, 0), wyaw + Math.PI), ONE));
  mount.rotation.set(0, wyaw + Math.PI, 0);
  const pivot = new THREE.Group(); const body = new THREE.Group(); const hand = new THREE.Group();
  const sleeve = mesh(sleeveGeo, armMat, true); const handMesh = mesh(S.merge(handParts), armMat, true);
  hand.add(handMesh); body.add(sleeve, hand); pivot.add(body); mount.add(pivot);
  const arm = mount;
  arm.visible = false;
  g.add(ghost.g, skel.g, art.group, arm);
  // How far it reaches, and where it aims, set at each tell from where the warden's eye is: the claws
  // stop short of the eye (0.45 m), at the face a little under it, so the hand reads coming at the
  // warden rather than passing through the view; never past the gouges' ring (keepprops.js).
  const reachOut = Math.hypot(G.x - wall.x, G.z - wall.z) + reach * 0.9;
  const dims = { forearm: Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y), hand: handLen, full: 0, pitch: CLAW_EMERGE.strike.pitch };
  const target = (eye) => {
    const dh = eye ? Math.hypot(eye.x - mount.position.x, eye.z - mount.position.z) : reachOut;
    const dy = eye ? eye.y - 0.2 - mount.position.y : 0;
    const d = clamp(dh - 0.45, 0.9, reachOut);
    dims.pitch = clamp(Math.atan2(dy, dh), -0.45, 0.25);
    dims.full = Math.max(dims.forearm, d / Math.cos(dims.pitch) - handLen * CLAW_EMERGE.grow);
  };
  target(null);
  let retarget = false;
  const pose = { e: {} }; const clock = {};
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion();
  const AX = V(1, 0, 0); const AY = V(0, 1, 0); const AZ = V(0, 0, 1); const TIP = V();
  let ta = -1; let hitAt = CLAW_EMERGE.time; let aimYaw = wyaw;
  // the harness's window on it (scripts/smoke.mjs): hold pins the seconds since the tell, for stills
  const shown = { hold: null, ta: -1, t: 0, paint: 1, arm: 0, ripple: 0, swipe: 0, sleeve: dims.forearm, tip: { x: 0, y: 0, z: 0 }, dims };
  arm.userData.clawEmerge = shown;
  const tell = (ctx.cfg && ctx.cfg.werewolf && ctx.cfg.werewolf.tell) || 0.4;
  return {
    g, figures: { ghost: ghost.g, skeleton: skel.g, 'werewolf painting': art.group, "werewolf's arm": arm },
    reset() { ghost.reset(); ta = -1; arm.visible = false; art.hide(1, false); art.emerge(1, 1, 0, 1, 0, 0); },
    onEvent(ev) {
      if (ev.type === 'ghostScream') ghost.scream();
      else if (ev.type === 'clawTell') { ta = ta >= 0 ? clawStrikeAt(ta, hitAt, clock).t : 0; hitAt = tell; retarget = true; } // from where it is: a tell while it goes home picks it up there
      else if (ev.type === 'claw' && ta >= 0) hitAt = ta; // the swipe from the hit, as before
    },
    update(c) {
      ghost.update(c); skel.update(c);
      art.watch(c.eye, c.dt);
      const held = Number.isFinite(shown.hold);
      if (held) { ta = shown.hold; hitAt = tell; } else if (ta >= 0) ta += c.dt;
      if ((held || retarget) && c.eye) { target(c.eye); retarget = false; }
      const k = clawStrikeAt(ta, hitAt, clock);
      if (!held && k.done) ta = -1;
      const t = ta >= 0 ? k.t : 0; const swipe = ta >= 0 ? k.swipe : 0;
      clawPoseAt(t, dims, pose);
      const e = pose.e;
      art.hide(1, e.paint <= 0);
      art.emerge(1, e.paint, (c.reduced ? 0.35 : 1) * e.ripple, 1, c.time, c.reduced ? 0 : 0.3 * e.ripple);
      arm.visible = e.arm > 0;
      shown.ta = ta; shown.t = t; shown.paint = e.paint; shown.arm = arm.visible ? e.arm : 0; shown.ripple = e.ripple; shown.swipe = swipe; shown.sleeve = pose.sleeve;
      if (!arm.visible) return;
      const pl = c.pl;
      if (pl && ta >= 0 && ta < CLAW_EMERGE.stay) aimYaw = headingTo(pl.x - arm.position.x, pl.z - arm.position.z);
      const aim = clamp(wrap(aimYaw - wyaw), -1.0, 1.0) * e.swing;
      armMat.opacity = e.arm;
      // turn aside at the warden, lean as painted, pitch from upright on the canvas out at him, the rake's
      // roll. The rake's sweep (0.5 aside, 0.55 down, at its height) is scaled to the arm's length, so the
      // claws sweep about 0.3 m through the warden's view rather than out of it (the arm stops 0.45 m short of the eye)
      const sweep = swipe * clamp(0.6 / (pose.sleeve + handLen * pose.scale), 0.2, 1);
      pivot.quaternion.setFromAxisAngle(AY, aim + 0.5 * sweep)
        .multiply(qa.setFromAxisAngle(AZ, pose.lean))
        .multiply(qb.setFromAxisAngle(AX, -(pose.pitch - 0.55 * sweep)))
        .multiply(qa.setFromAxisAngle(AZ, 0.6 * swipe));
      body.scale.set(1, pose.depth, 1);
      sleeve.scale.set(1, 1, pose.sleeve);
      hand.position.set(0, 0, pose.sleeve);
      hand.scale.setScalar(pose.scale);
      hand.updateWorldMatrix(true, false); TIP.set(0, 0, handLen); hand.localToWorld(TIP); // the middle claws' tips, for the harness
      shown.tip.x = TIP.x; shown.tip.y = TIP.y; shown.tip.z = TIP.z;
    },
  };
}

// ---- the first corridor (R6): the painting of the three wives -------------------------------------

function buildCorridorSet(ctx) {
  const P = MAP.CORRIDOR.painting;
  const yaw = facingIn('cor1', P.x, P.z);
  const at = { x: P.x, y: 1.8, z: P.z, yaw, w: MAP.WALL_ART.wives.w, h: MAP.WALL_ART.wives.h };
  // her figure ripples out from between her face and her shoulders (1.5 face half-widths down)
  const cellAspect = MAP.WALL_ART.wives.w / MAP.WALL_ART.wives.h;
  const ripple = { u: WIFE_SPOT.u, v: WIFE_SPOT.v + 1.5 * WIFE_SPOT.s * cellAspect };
  const art = paintings([{ ...at, paint: wivesWhoStay, ground: 0x12100f, canvas: 'wives' }, { ...at, paint: wifeWhoLeaves, bare: true, alone: true, canvas: 'wives', ripple }], ctx.M, { name: 'painted:wives', lift: 0.3, fill: 0.2 });
  // The emergence as the canvas shows it (logic/emerge.js): read from the sim's e.emerge while she
  // comes out; on a restore that seats her back in it, the same curve read backward (settle counts
  // down from the emergence's length): the paint settles where she was. For the smoke harness too.
  const EK = {};
  const shown = { paint: 1, ripple: 0, head: 1, t: -1, settle: 0 };
  art.group.userData.wifeEmerge = shown;
  let wasAway = false; let settle = 0;
  return {
    g: art.group, figures: { 'painting of the three wives': art.group },
    reset() { art.rest(); },
    update(c) {
      // The three heads turn toward the warden while the dark wife is still in the canvas (at
      // rest in it, and while she whispers: wifeStir). Once she is out of it her place is empty,
      // and stays empty when she is driven off; her head goes with her, and the two who stay go
      // on following at half pace through the fight (the owner, 2026-11-18; the art critic).
      const w = c.w;
      let away = false;
      let t = -1; // seconds into her coming out, while she is
      if (w) {
        const e = c.sim.enemies.find(isWife);
        const st = e ? String(e.state) : '';
        away = !!(w.done && w.done.wife) || !!(e && st !== 'painting' && st !== 'stir');
        if (e && st === 'stir' && e.emerge != null) t = e.emerge;
      }
      art.hide(1, away);
      art.watch(c.eye, c.dt, false, c.reduced, c.pl ? c.pl.yaw : NaN, away);
      const ET = (c.sim && c.sim.cfg && c.sim.cfg.wife && c.sim.cfg.wife.emergeTime) || EMERGE.time;
      if (wasAway && !away && !(w && w.done && w.done.wife)) settle = ET; // seated back in it: the paint settles
      wasAway = away;
      if (settle > 0 && t < 0) { settle = Math.max(0, settle - c.dt); t = settle; } else settle = 0;
      emergeAt(Math.max(0, t), ET, EK);
      const paint = away ? 0 : EK.paint;
      art.emerge(1, paint, (c.reduced ? 0.35 : 1) * EK.ripple, EK.head, c.time, c.reduced ? 0 : 0.8 * EK.ripple);
      shown.paint = paint; shown.ripple = EK.ripple; shown.head = away ? 0 : EK.head; shown.t = t; shown.settle = settle;
    },
  };
}
const isWife = (q) => q.type === 'wife';

// ---- the pit (R3): snakes -------------------------------------------------------------------------
// One instanced mesh. They wander the pit floor, and come for the warden who is down there.

function buildOutsideSet(ctx) {
  const N = 18; const P = MAP.PIT;
  const geo = S.skin([
    { at: [0, 0.02, 0.6], r: 0.006 }, { at: [0, 0.03, 0.35], r: 0.028 }, { at: [0, 0.035, 0], r: 0.04 }, { at: [0, 0.035, -0.35], r: 0.034 },
    { at: [0, 0.04, -0.52], r: [0.03, 0.022] }, { at: [0, 0.04, -0.6], r: [0.046, 0.024] }, { at: [0, 0.035, -0.68], r: [0.02, 0.012] },
  ], { seed: 4, sides: 6, detail: 3, budget: 220, noise: 0.03, color: 0x3d4024, color2: 0x15170d, mottle: 0.3, shade: 0.5,
    colorAt: (u, a, c) => { if (Math.sin(u * 46) > 0.2) c.multiplyScalar(0.3); } }); // banded
  const mat = ctx.M.skin.clone();
  const uTime = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { float ph = float( gl_InstanceID ) * 1.9; float tail = 0.35 + 0.65 * smoothstep( -0.7, 0.6, position.z );
        transformed.x += 0.13 * tail * sin( position.z * 10.5 + uTime * 4.2 + ph ); }`);
  };
  mat.customProgramCacheKey = () => 'keep-snake';
  const snakes = new THREE.InstancedMesh(geo, mat, N);
  snakes.frustumCulled = false;
  const g = new THREE.Group();
  g.add(snakes);
  const S0 = [];
  for (let i = 0; i < N; i++) {
    S0.push({
      x: lerp(P.rect.minX + 3, P.rect.maxX - 1, hash(i, 1)), z: lerp(P.rect.minZ + 1, P.rect.maxZ - 1, hash(i, 2)),
      ph: hash(i, 3) * TAU, r: 0.8 + 1.4 * hash(i, 4), w: 0.1 + 0.12 * hash(i, 5), size: 0.8 + 0.7 * hash(i, 6), yaw: 0, px: 0, pz: 0, set: false, strike: 0,
    });
  }
  let draw = 0;
  return {
    g, figures: { snakes: g },
    onEvent(ev) {
      if (ev.type !== 'snakeBite' || !Number.isFinite(ev.x)) return;
      let best = null; let bd = Infinity;
      for (const s of S0) { const d = Math.hypot(s.px - ev.x, s.pz - ev.z); if (d < bd) { bd = d; best = s; } }
      if (best) best.strike = 0.35;
    },
    update(c) {
      const { dt, time, w, pl } = c;
      uTime.value = time;
      const down = !!(w && w.under === 'pit' && pl && !pl.dead);
      draw = approach(draw, down ? 1 : 0, dt, 0.7);
      S0.forEach((s, i) => {
        let x = s.x + Math.sin(time * s.w + s.ph) * s.r; let z = s.z + Math.cos(time * s.w * 0.83 + s.ph * 1.7) * s.r;
        if (draw > 0.001 && pl) { // they close on whoever is in the pit, and ring them
          const a = s.ph + time * 0.25; const rr = 0.7 + 1.5 * hash(i, 8);
          x = lerp(x, pl.x + Math.cos(a) * rr, draw * 0.9); z = lerp(z, pl.z + Math.sin(a) * rr, draw * 0.9);
        }
        x = clamp(x, P.stair.rect.maxX + 0.5, P.rect.maxX - 0.4); z = clamp(z, P.rect.minZ + 0.4, P.rect.maxZ - 0.4);
        if (s.set && dt > 0) {
          const vx = x - s.px; const vz = z - s.pz;
          if (vx * vx + vz * vz > 1e-8) s.yaw += wrap(headingTo(vx, vz) - s.yaw) * Math.min(1, dt * 4);
        }
        s.strike = Math.max(0, s.strike - dt);
        if (s.strike > 0 && pl) s.yaw = headingTo(pl.x - x, pl.z - z);
        s.px = x; s.pz = z; s.set = true;
        const k = s.strike > 0 ? Math.sin(Math.PI * (1 - s.strike / 0.35)) : 0;
        _o.position.set(x - Math.sin(s.yaw) * 0.4 * k, P.floor + 0.01 + 0.12 * k, z - Math.cos(s.yaw) * 0.4 * k);
        _o.rotation.set(0.3 * k, s.yaw, 0);
        _o.scale.setScalar(s.size);
        _o.updateMatrix();
        snakes.setMatrixAt(i, _o.matrix);
      });
      snakes.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- chains (the crypt) ---------------------------------------------------------------------------

function chainLinks(n, M) {
  const geo = S.tint(new THREE.TorusGeometry(0.03, 0.008, 5, 8).scale(1.5, 1, 1), 0x3c3a38, 0.3, 2);
  geo.deleteAttribute('uv');
  const links = new THREE.InstancedMesh(geo, M.metal, n);
  const X = V(1, 0, 0);
  const hung = (a, b, sag, floorY, t, out) => { out.lerpVectors(a, b, t); out.y = Math.max(floorY + 0.012, out.y - sag * Math.sin(Math.PI * t)); return out; };
  return {
    mesh: links,
    /** Hangs links i0..i0+n-1 from a to b with a sag, never under the floor. */
    hang(i0, count, a, b, sag, floorY) {
      for (let k = 0; k < count; k++) {
        hung(a, b, sag, floorY, (k + 0.5) / count, _o.position);
        hung(a, b, sag, floorY, (k + 0.9) / count, _a).sub(hung(a, b, sag, floorY, (k + 0.1) / count, _b));
        if (_a.lengthSq() < 1e-9) _a.set(1, 0, 0);
        _o.quaternion.setFromUnitVectors(X, _a.normalize()).multiply(_q.setFromAxisAngle(X, (k % 2) * Math.PI / 2));
        _o.scale.set(1, 1, 1);
        _o.updateMatrix();
        links.setMatrixAt(i0 + k, _o.matrix);
      }
      links.instanceMatrix.needsUpdate = true;
      links.computeBoundingSphere(); // so the links are culled with the crypt they hang in
    },
  };
}

// ---- the March Hare as Jonathan Harker (R12) ------------------------------------------------------
// A gaunt hare in a solicitor's travelling coat, bitten, chained by one wrist, harmless, fretting
// about the time. Six draw calls (and the chain he shares with the nun).

function buildHare(ctx) {
  const seed = 97; const M = ctx.M;
  const TWEED = 0x4a3a2a; const FUR = 0x7a705f; const LAPEL = 0x5e4c38;
  const g = new THREE.Group(); const body = new THREE.Group();
  g.add(body);
  const torso = mesh(S.merge([
    // a coat with nothing much left inside it: the chest sunk, the shoulders all bone, the neck a stalk
    S.skin([{ at: [0, 0.58, 0.03], r: [0.15, 0.1] }, { at: [0, 0.84, 0.045], r: [0.125, 0.085] }, { at: [0, 1.06, -0.01], r: [0.2, 0.095] }, { at: [0, 1.13, -0.04], r: [0.07, 0.055] },
      { at: [0, 1.16, -0.05], r: 0.04, color: FUR }, { at: [0, 1.22, -0.07], r: 0.036, color: FUR }],
      { seed, sides: 10, detail: 2, budget: 420, noise: 0.06, mottle: 0.2, color: TWEED, color2: 0x2e241b,
        colorAt: (u, a, c) => {
          if ((Math.sin(u * 60) > 0.75 || Math.sin(a * 14) > 0.85) && u < 0.9) c.multiplyScalar(0.72); // the check of the cloth
          if (Math.cos(a) > 0.93 && u > 0.25 && u < 0.86) c.set(0x6a614f); // a waistcoat, gone grey
        } }),
    // the cape of the travelling coat, over the shoulders
    S.skin([{ at: [0, 1.12, -0.03], r: [0.09, 0.07] }, { at: [0, 1.05, -0.01], r: [0.24, 0.125] }, { at: [0, 0.92, 0.0], r: [0.26, 0.14] }],
      { seed: seed + 1, sides: 10, detail: 2, budget: 200, noise: 0.07, mottle: 0.22, color: 0x41332a, color2: 0x2e241b, caps: ['open', 'open'], rough: 0.04 }),
    // a solicitor's lapels, a stiff collar gone grey, three buttons, one hanging by its thread
    slab(0.075, 0.26, 0.014, 0.062, 0.97, -0.112, LAPEL, 0.2).rotateZ(0.0).translate(0, 0, 0), slab(0.075, 0.26, 0.014, -0.062, 0.97, -0.112, LAPEL, 0.2),
    aimed(spike(0.05, 0.1, LAPEL, 3), [0.085, 1.07, -0.105], [0.6, 1, 0]), aimed(spike(0.05, 0.1, LAPEL, 3), [-0.085, 1.07, -0.105], [-0.6, 1, 0]),
    S.tint(new THREE.TorusGeometry(0.052, 0.014, 4, 10).rotateX(Math.PI / 2).translate(0, 1.145, -0.045), 0x8f8a7c, 0.2, seed),
    ball(0.013, 0, 0.9, -0.1, 0x15110f, 1, 1, 0.5, 0), ball(0.013, 0, 0.8, -0.098, 0x15110f, 1, 1, 0.5, 0), ball(0.013, 0.02, 0.685, -0.1, 0x15110f, 1, 1, 0.5, 0),
    // bitten: two holes in the side of the neck, and what ran from them
    ball(0.011, 0.036, 1.2, -0.085, 0x2a0508, 1, 1, 1, 0), ball(0.011, 0.042, 1.175, -0.075, 0x2a0508, 1, 1, 1, 0),
    S.skin([{ at: [0.04, 1.18, -0.082], r: 0.009 }, { at: [0.06, 1.13, -0.1], r: 0.008 }, { at: [0.07, 1.04, -0.115], r: 0.004 }], { sides: 4, detail: 2, noise: 0.2, seed, color: RED }),
  ]), M.skin, true);
  const skirt = S.cloth({
    curve: TAU * 0.86, radius: 0.14, flare: 0.6, length: 0.58, cols: 12, rows: 5, budget: 260, color: TWEED, folds: 6, foldDepth: 0.03, tatter: 0.8, dirt: 0.5, seed,
    pattern: (u, v, c) => { if (Math.sin(v * 38) > 0.75 || Math.sin(u * 90) > 0.85) c.multiplyScalar(0.72); },
  });
  skirt.mesh.position.set(0, 0.64, 0.03); skirt.mesh.rotation.y = Math.PI; // open down the front
  const ear = (sx, bent) => S.skin(bent
    ? [{ at: [sx * 0.08, 0.34, 0.03], r: [0.045, 0.02] }, { at: [sx * 0.17, 0.56, 0.05], r: [0.055, 0.016] }, { at: [sx * 0.31, 0.6, 0.06], r: [0.05, 0.014] }, { at: [sx * 0.4, 0.47, 0.07], r: [0.02, 0.008] }]
    : [{ at: [sx * 0.08, 0.34, 0.03], r: [0.045, 0.02] }, { at: [sx * 0.12, 0.6, 0.06], r: [0.06, 0.016] }, { at: [sx * 0.13, 0.84, 0.1], r: [0.045, 0.012] }, { at: [sx * 0.11, 0.98, 0.14], r: [0.012, 0.006] }],
  { seed: seed + sx, sides: 7, detail: 2, budget: 150, noise: 0.07, color: FUR, color2: 0x5e5244, mottle: 0.2,
    colorAt: (u, a, c) => { if (Math.cos(a) > 0.3 && u > 0.1) c.lerp(_col.set(0x5a4640), 0.5); if (bent && u > 0.45 && u < 0.55) c.multiplyScalar(0.5); } }).scale(0.85, 0.9, 0.85);
  const hd = S.head({
    size: 0.17, seed, budget: 2000, fine: true, defects: ['eyesWide', 'fangsFront', 'blinkUneven'], extras: [ear(1, false), ear(-1, true)],
    face: {
      // starved: the cheeks fallen in under the bone, the eyes sunk and too big, the muzzle narrow
      skin: FUR, eye: 0xb89a5a, skull: { wide: 0.78, tall: 1.24, taper: 0.72, cheek: -0.13, muzzle: 0.34, socket: 0.26, temple: 0.2, chin: 0, brow: 0.08 },
      eyes: { r: 0.2, open: 0.95, iris: 0.5, pupil: 0.16, white: 0x2e241e }, brow: { none: true }, nose: { kind: 'none' },
      mouth: { width: 0.18, smile: -0.25, lip: 0x3a2622, toothLen: 0.07, lat: -0.58 }, cheek: { rosy: 0 }, ears: { kind: 'none' },
    },
    wet: [ball(0.013, 0, 0.127, -0.215, 0x15100e, 1.3, 0.8, 0.8, 0)], // a dry dark nose
  });
  hd.group.position.set(0, 1.22, -0.07);
  const L = S.limbs(12, { seed, sides: 5, taper: 0.7 });
  [0, 1, 3, 4].forEach((i) => L.tone(i, TWEED)); [2, 5].forEach((i) => L.tone(i, FUR));
  [6, 7, 9, 10].forEach((i) => L.tone(i, 0x25211f)); [8, 11].forEach((i) => L.tone(i, FUR));
  body.add(torso, hd.group, skirt.mesh);
  g.add(L.mesh);
  const rig = { root: body, chest: torso, head: hd, cloths: [skirt], seed, rate: 0.5, depth: 1.3 }; // breathing fast
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()]; const elbow = V(); const knee = V(); const bend = V(); const toe = V(0, -0.05, -1).normalize();
  const wrist = V();
  let yaw = 0; let say = 0; let faceWorld = 0; let turn = 0;
  const P = { wring: [V(), V()], watch: [V(), V()], pat: [V(), V()] };
  return {
    g, wrist,
    place(x, y, z, facing) { g.position.set(x, y, z); g.rotation.y = facing; faceWorld = facing; },
    say(t) { say = t; },
    reset() { say = 0; },
    update(c) {
      const { dt, time, eye } = c;
      const dx = eye.x - g.position.x; const dz = eye.z - g.position.z;
      const near = Math.hypot(dx, dz) < 7 && Math.abs(eye.y - g.position.y) < 3;
      const want = near ? clamp(wrap(headingTo(dx, dz) - faceWorld), -1.2, 1.2) : 0;
      turn = approach(turn, want * 0.5, dt, 1.5);
      yaw = approach(yaw, want - turn, dt, 3);
      say = Math.max(0, say - dt);
      const talk = clamp(say * 3);
      // the fret: wring the paws; lift the chained wrist to a watch that is not there; pat the pockets
      const cy = (time % 7) / 7;
      const kWatch = smooth((cy - 0.34) / 0.07) * (1 - smooth((cy - 0.6) / 0.07));
      const kPat = smooth((cy - 0.66) / 0.06) * (1 - smooth((cy - 0.94) / 0.05));
      body.position.set(0, -0.02 + 0.012 * Math.sin(time * 5.1), 0);
      body.rotation.set(-0.2 - 0.08 * kWatch, turn, 0.03 * Math.sin(time * 2.2));
      S.breathe(rig, time, { look: near ? eye : null, sway: 1.2 });
      hd.group.rotation.y = yaw + 0.5 * kPat * Math.sin(time * 3.3);
      hd.group.rotation.x += 0.45 * kWatch * (1 - talk) + 0.05 * Math.sin(time * 9.7); // a tremor
      hd.pose({ jaw: 0.08 + talk * (0.3 + 0.3 * Math.sin(time * 15)), brow: 0.4, frown: -1 });
      body.updateMatrix();
      const w = time * 6;
      P.wring[0].set(0.05 + 0.03 * Math.sin(w), 0.97 + 0.03 * Math.cos(w), -0.24); P.wring[1].set(-0.05 - 0.03 * Math.sin(w), 0.97 - 0.03 * Math.cos(w), -0.25);
      P.watch[0].set(0.1, 1.14 + 0.02 * Math.sin(time * 19) * smooth((cy - 0.5) / 0.03), -0.27); P.watch[1].set(-0.02, 1.08, -0.3); // and shakes it
      P.pat[0].set(0.09, 1.0 + 0.03 * Math.sin(time * 11), -0.17); P.pat[1].set(-0.19, 0.74 + 0.03 * Math.sin(time * 11 + 2), -0.1);
      for (let i = 0; i < 2; i++) {
        const sx = i ? -1 : 1;
        sh[i].set(sx * 0.19, 1.05, -0.01).applyMatrix4(body.matrix);
        hand[i].copy(P.wring[i]).lerp(P.watch[i], kWatch).lerp(P.pat[i], kPat);
        if (talk > 0) hand[i].lerp(_a.set(sx * 0.3, 0.92 + 0.04 * Math.sin(time * 5 + i), -0.3), talk * 0.8); // open hands: what is to be done
        hand[i].applyMatrix4(body.matrix);
        bend.set(sx * 0.8, -0.7, 0.3);
        placeArm(L, i * 3, sh[i], hand[i], 0.29, 0.3, bend, 0.034, elbow, 1.5);
        hip[i].set(sx * 0.08, 0.6, 0.03);
        foot[i].set(sx * 0.13, 0.05, 0.06 + i * 0.05);
        bend.set(sx * 0.2, 0, -1);
        placeLeg(L, 6 + i * 3, hip[i], foot[i], 0.3, 0.3, bend, 0.044, toe, knee, 5.2); // a hare's long feet
      }
      L.commit();
      wrist.copy(hand[0]);
    },
  };
}

// ---- the nun (R12): long dead, bones in a habit, still chained ------------------------------------
// One draw call. She knelt, and is kneeling yet.

function nunGeometry() {
  const seed = 113; const BLACK = 0x0c0c10; const DUST = 0x2c2c30; const LINEN = 0xbfb9a6;
  const parts = [
    S.skin([{ at: [0, 0.04, 0.34], r: [0.36, 0.26] }, { at: [0, 0.26, 0.14], r: [0.31, 0.25] }, { at: [0, 0.52, -0.03], r: [0.2, 0.16] },
      { at: [0, 0.76, -0.2], r: [0.21, 0.13] }, { at: [0, 0.84, -0.29], r: 0.075 }],
    { seed, sides: 11, detail: 3, budget: 520, noise: 0.09, mottle: 0.25, color: BLACK, color2: DUST, rough: 0.05,
      profile: (a, u) => 1 + (1 - u) * 0.16 * Math.sin(a * 6 + 1), colorAt: (u, a, c) => { if (u < 0.12) c.lerp(_col.set(0x4a463e), 0.6); } }), // dust on the hem
    // the skull, bowed: cranium, sockets, what is left of the jaw
    ball(0.105, 0, 0.9, -0.42, BONE, 0.92, 1, 1.08, 0.25),
    ball(0.03, 0.04, 0.87, -0.515, 0x070606, 1.1, 1, 0.5, 0), ball(0.03, -0.04, 0.87, -0.515, 0x070606, 1.1, 1, 0.5, 0),
    ball(0.014, 0, 0.835, -0.53, 0x070606, 1, 1.4, 0.5, 0),
    slab(0.1, 0.035, 0.06, 0, 0.785, -0.47, BONE, 0.2),
    // the coif and the veil
    S.tint(new THREE.TorusGeometry(0.108, 0.02, 5, 14).rotateX(-0.45).translate(0, 0.9, -0.4), LINEN, 0.25, seed),
    slab(0.15, 0.07, 0.014, 0, 0.77, -0.4, LINEN, 0.25),
    S.skin([{ at: [0, 1.02, -0.43], r: [0.13, 0.12] }, { at: [0, 0.95, -0.27], r: [0.18, 0.13] }, { at: [0, 0.66, -0.05], r: [0.24, 0.1] }, { at: [0, 0.4, 0.12], r: [0.2, 0.06] }],
      { seed: seed + 2, sides: 9, detail: 2, budget: 220, noise: 0.08, mottle: 0.25, color: BLACK, color2: DUST, capLen: 0.4 }),
    // the sleeves and the hands, still together; the beads still in them
    S.skin([{ at: [0.2, 0.74, -0.2], r: 0.07 }, { at: [0.19, 0.56, -0.34], r: 0.065 }, { at: [0.06, 0.5, -0.42], r: 0.05 }], { seed: seed + 3, sides: 7, detail: 2, noise: 0.08, color: BLACK, color2: DUST }),
    S.skin([{ at: [-0.2, 0.74, -0.2], r: 0.07 }, { at: [-0.19, 0.56, -0.34], r: 0.065 }, { at: [-0.06, 0.5, -0.42], r: 0.05 }], { seed: seed + 4, sides: 7, detail: 2, noise: 0.08, color: BLACK, color2: DUST }),
    S.claw({ fingers: 4, length: 0.1, spread: 0.3, curl: 0.6, r: 0.011, color: BONE, tip: 0x9c9072, seed }).rotateY(-1.2).translate(0.05, 0.5, -0.44),
    S.claw({ fingers: 4, length: 0.1, spread: 0.3, curl: 0.6, r: 0.011, color: BONE, tip: 0x9c9072, seed: seed + 1 }).rotateY(1.2).translate(-0.05, 0.5, -0.44),
    S.tint(new THREE.TorusGeometry(0.07, 0.007, 4, 14).translate(0, 0.42, -0.46), 0x2a1c14, 0.3, seed),
    slab(0.012, 0.07, 0.012, 0, 0.32, -0.46, 0x2a1c14), slab(0.045, 0.012, 0.012, 0, 0.335, -0.46, 0x2a1c14),
    // an iron cuff, and the staple in the floor it was made fast to
    S.tint(new THREE.TorusGeometry(0.055, 0.014, 5, 10).rotateY(Math.PI / 2).translate(0.09, 0.51, -0.4), 0x3c3a38, 0.3, seed),
    S.tint(new THREE.TorusGeometry(0.05, 0.014, 5, 10, Math.PI).translate(0.55, 0, -0.5), 0x3c3a38, 0.3, seed),
  ];
  return S.merge(parts);
}

// ---- rats (R12) -----------------------------------------------------------------------------------

function ratGeometry() {
  return S.merge([
    S.skin([{ at: [0, 0.035, 0.1], r: 0.03 }, { at: [0, 0.045, 0.0], r: [0.04, 0.042] }, { at: [0, 0.04, -0.09], r: 0.028 }, { at: [0, 0.03, -0.15], r: 0.008 }],
      { seed: 6, sides: 6, detail: 2, budget: 110, noise: 0.06, rough: 0.2, color: 0x2a2623, color2: 0x15110f, mottle: 0.3 }),
    S.skin([{ at: [0, 0.02, 0.11], r: 0.008 }, { at: [0.03, 0.012, 0.22], r: 0.006 }, { at: [-0.01, 0.01, 0.33], r: 0.002 }], { sides: 4, detail: 2, noise: 0, color: 0x6a5048 }),
    ball(0.014, 0.022, 0.066, -0.085, 0x4a3a36, 1, 1, 0.4, 0), ball(0.014, -0.022, 0.066, -0.085, 0x4a3a36, 1, 1, 0.4, 0),
  ]);
}

/** Where a rat is at time t: it darts, stops, darts. */
function ratAt(spot, ph, fy, t, out) {
  const u = Math.floor(t) + smooth(frac(t) * 1.7);
  return out.set(spot.x + Math.sin(u * 2.1 + ph) * 1.0, fy, spot.z + Math.cos(u * 1.3 + ph * 1.3) * 0.8);
}

// ---- the warden in the glass (R8; issues 25, 26) ---------------------------------------------------
// The only time the warden is seen: a works foreman in an oilskin, cap low, scarf high. In half of all
// games (the game's look, logic/reflection.js) the foreman is a woman: the oilskin cut in at the waist
// and skirted to the knee, hair under the cap and a plait down the back. Glass-only layer. Three draw
// calls: the figure (one look shown), the limbs, and what is in hand (one tool shown).

/**
 * What the reflection can carry, by weapon name (issue 26): the tool the glass shows is always the one
 * in hand (reflectionOf(sim).weapon). grips: where the two hands close, in the tool's frame; lift: how far
 * the tool is tipped up. A name not listed here (a weapon added later) shows the hands empty.
 */
export const REFLECTED_TOOLS = Object.freeze({
  bore: Object.freeze({ name: 'bore', grips: [[0, -0.03, 0.14], [0, -0.01, -0.3]], free: [false, false], lift: 0 }), // the salt gun
  crossbow: Object.freeze({ name: 'crossbow', grips: [[0, -0.04, 0.12], [0, -0.02, -0.26]], free: [false, false], lift: 0 }),
  halberd: Object.freeze({ name: 'halberd', grips: [[0, -0.03, 0.14], [0, -0.01, -0.3]], free: [false, false], lift: 0.5 }),
  cup: Object.freeze({ name: 'cup', grips: [[0.045, -0.02, -0.26], [-0.045, -0.02, -0.26]], free: [false, false], lift: 0 }),
  garlic: Object.freeze({ name: 'garlic', grips: [[0, 0.0, -0.28], [-0.2, 0.86, 0.08]], free: [false, true], lift: 0.25 }), // the braid held out, the other hand down
  lantern: Object.freeze({ name: 'lantern', grips: [[0, 0.02, -0.3], [-0.2, 0.86, 0.08]], free: [false, true], lift: 0 }), // the hand lantern held up by its ring
});
// A free grip is a hand hanging at the side, placed in the body's frame (not the tool's, so it does not swing with the look).
const EMPTY_HANDS = Object.freeze({ name: null, grips: [[0.2, 0.86, 0.08], [-0.2, 0.86, 0.08]], free: [true, true], lift: 0 });

/** The tool the reflection shows for a weapon name: { name, grips, free, lift }; name null when none is drawn. */
export function reflectedTool(name) {
  return typeof name === 'string' && Object.hasOwn(REFLECTED_TOOLS, name) ? REFLECTED_TOOLS[name] : EMPTY_HANDS;
}

/** The two figures, the shipped foreman and the woman (issue 25): one merged geometry each, the same height. */
function wardenFigure(seed, look) {
  const COAT = 0x1f3a3a; const HAIR = 0x7d4f2c; // chestnut: it has to read against the dark coat and the scarf
  const female = look === 'female';
  const rings = female
    ? [{ at: [0, 0.5, 0], r: [0.3, 0.24] }, { at: [0, 0.97, 0], r: [0.19, 0.15] }, { at: [0, 1.26, 0], r: [0.22, 0.16] }, { at: [0, 1.46, 0], r: [0.22, 0.14] }, { at: [0, 1.56, 0], r: 0.085 }]
    : [{ at: [0, 0.5, 0], r: [0.27, 0.21] }, { at: [0, 0.95, 0], r: [0.22, 0.17] }, { at: [0, 1.28, 0], r: [0.25, 0.17] }, { at: [0, 1.47, 0], r: [0.25, 0.15] }, { at: [0, 1.56, 0], r: 0.09 }];
  const parts = [
    S.skin(rings, { seed, sides: 10, detail: 2, budget: 420, noise: 0.05, mottle: 0.2, color: COAT, color2: 0x152a2c, caps: ['flat', 'round'],
      colorAt: (u, a, c) => { if (u > 0.4 && u < 0.46) c.set(0x2a2018); } }), // a belt
    S.tint(new THREE.TorusGeometry(0.115, 0.05, 6, 12).rotateX(Math.PI / 2).translate(0, 1.56, 0), 0x5e4a22, 0.3, seed), // the scarf
    ball(female ? 0.108 : 0.115, 0, 1.69, 0, 0x8f7a68, 0.95, 1.05, 1, 0.2),
    ball(0.13, 0, 1.76, 0.01, 0x24211f, 1.05, 0.5, 1.12, 0.2), // the cap, and its peak
    slab(0.17, 0.016, 0.1, 0, 1.745, -0.15, 0x24211f, 0.2),
    // K6: a face, plain as the foreman's (the court figures' register): the goggles pushed up on
    // the peak, a brow, two eyes in their shadow, a nose, a mouth, a jaw and a chin, the ears
    slab(0.15, 0.026, 0.03, 0, 1.768, -0.128, 0x2c2a28, 0.15), slab(0.05, 0.03, 0.012, -0.034, 1.768, -0.144, 0x6d7a80, 0.1), slab(0.05, 0.03, 0.012, 0.034, 1.768, -0.144, 0x6d7a80, 0.1),
    slab(0.13, 0.02, 0.035, 0, 1.722, -0.095, 0x6e5b4c, 0.15), // the brow
    ...[-1, 1].flatMap((sx) => [
      ball(0.021, sx * 0.04, 1.699, -0.093, 0x5a4638, 1.2, 0.8, 0.6, 0.1), // the socket's shadow
      ball(0.0085, sx * 0.04, 1.699, -0.104, 0xc8c0b2, 1.3, 0.75, 0.5, 0.05), ball(0.0065, sx * 0.04, 1.699, -0.11, 0x1a1512, 1, 1, 0.5, 0), // eye, iris
      ball(0.026, sx * (female ? 0.105 : 0.113), 1.69, 0.0, 0x86705f, 0.5, 1.2, 0.8, 0.15), // the ear
    ]),
    ball(0.02, 0, 1.672, -0.112, 0x8a7262, 0.8, 1.5, 1.1, 0.1), // the nose
    slab(0.044, 0.007, 0.012, 0, 1.636, -0.104, 0x4a3530, 0.1), // the mouth
    ball(female ? 0.078 : 0.088, 0, 1.63, -0.03, female ? 0x8f7a68 : 0x86705f, 1.08, 0.72, 1.05, 0.15), // the jaw
    ball(0.032, 0, 1.608, -0.082, 0x8a7464, 1.1, 0.9, 0.9, 0.1), // the chin
    // the yard's lantern at the belt
    slab(0.09, 0.14, 0.09, -0.22, 0.86, -0.12, 0x3a3d42, 0.2), slab(0.06, 0.08, 0.095, -0.22, 0.86, -0.12, 0xffb14a, 0),
  ];
  if (!female) parts.push(slab(0.07, 0.013, 0.016, 0, 1.651, -0.11, 0x3a2a20, 0.15)); // his moustache
  if (female) {
    parts.push(
      ball(0.12, 0, 1.68, 0.05, HAIR, 1.02, 0.72, 1, 0.15), // hair under the cap, over the ears
      ...[-1, 1].map((sx) => S.skin([{ at: [sx * 0.09, 1.74, 0.0], r: 0.04 }, { at: [sx * 0.125, 1.63, -0.01], r: 0.045 }, { at: [sx * 0.165, 1.52, 0.0], r: 0.042 },
        { at: [sx * 0.19, 1.42, 0.02], r: 0.03 }, { at: [sx * 0.2, 1.36, 0.03], r: 0.01 }],
      { seed: seed + 3 + sx, sides: 6, detail: 2, budget: 90, noise: 0.08, mottle: 0.2, color: HAIR, color2: 0x5a3820, caps: ['flat', 'round'] })), // hair to the shoulders, framing the face
      S.skin([{ at: [0, 1.66, 0.11], r: 0.045 }, { at: [0, 1.48, 0.17], r: 0.04 }, { at: [0, 1.28, 0.2], r: 0.032 }, { at: [0, 1.1, 0.2], r: 0.018 }],
        { seed: seed + 5, sides: 6, detail: 2, budget: 90, noise: 0.08, mottle: 0.2, color: HAIR, color2: 0x5a3820, caps: ['flat', 'round'] }), // the plait
    );
  }
  return S.merge(parts);
}

/** What the hand holds, one mesh per tool, all hidden but the one in hand. */
function reflectionTools(M, seed) {
  const gun = S.merge([
    slab(0.05, 0.07, 0.62, 0, 0, -0.2, 0x3a3d42, 0.2), slab(0.045, 0.12, 0.26, 0, -0.035, 0.22, 0x4a3524, 0.25),
    S.tint(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, -0.55), 0x55595f, 0.2, 1),
  ]);
  const crossbow = S.merge([
    slab(0.05, 0.07, 0.66, 0, 0, -0.12, 0x4a3524, 0.25), slab(0.045, 0.13, 0.2, 0, -0.04, 0.2, 0x3e2c1e, 0.25), // the stock
    S.tint(new THREE.TorusGeometry(0.34, 0.016, 4, 14, Math.PI * 0.8).rotateZ(Math.PI * 0.1).rotateX(-Math.PI / 2).translate(0, 0.01, -0.12), 0x5e5a54, 0.2, 3), // the bow, its arms swept back
    slab(0.56, 0.008, 0.008, 0, 0.012, -0.02, 0xcfc6b0, 0.1), // the string
    slab(0.016, 0.016, 0.42, 0, 0.045, -0.24, 0xd8cfb8, 0.1), // a stake on the rail
  ]);
  const halberd = S.merge([
    S.tint(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5), 0x4a3524, 0.25, 2),
    S.claw({ fingers: 3, length: 0.4, spread: 0.4, curl: 1.1, r: 0.05, color: 0x5e5a54, tip: 0x2a0a0e, seed }).translate(0, 0, -1.65),
  ]);
  const cup = S.merge([
    S.tint(new THREE.CylinderGeometry(0.055, 0.045, 0.1, 10).translate(0, 0.02, -0.3), 0x8d9296, 0.2, 4), // the tin cup
    S.tint(new THREE.TorusGeometry(0.03, 0.008, 4, 8).rotateY(Math.PI / 2).translate(0.06, 0.02, -0.3), 0x8d9296, 0.2, 5),
  ]);
  const braid = [S.tint(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4).translate(0, -0.13, -0.3), 0x8a7a52, 0.2, 6)]; // the cord
  for (let i = 0; i < 6; i++) braid.push(ball(0.035, (i % 2 ? 0.025 : -0.025), -0.04 - i * 0.05, -0.3, 0xe8e0cc, 1, 1.15, 1, 0.12));
  const out = {};
  for (const [name, geo] of Object.entries({ bore: gun, crossbow, halberd, cup })) out[name] = mesh(geo, M.metal);
  out.garlic = mesh(S.merge(braid), M.skin);
  // the hand lantern (logic/lantern.js), hanging from the ring in the fist: cap, four posts, base, the warm glass
  const LI = 0x2b2326;
  const lamp = [
    S.tint(new THREE.TorusGeometry(0.03, 0.007, 4, 10).translate(0, 0.0, -0.3), LI, 0.1, 7),
    S.tint(new THREE.ConeGeometry(0.11, 0.08, 4).rotateY(Math.PI / 4).translate(0, -0.07, -0.3), LI, 0.1, 8),
    slab(0.17, 0.022, 0.17, 0, -0.33, -0.3, LI, 0.1),
    slab(0.13, 0.2, 0.13, 0, -0.21, -0.3, 0xe0a85a, 0.05), // the glass, lit
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lamp.push(slab(0.014, 0.22, 0.014, x * 0.075, -0.21, -0.3 + z * 0.075, LI, 0));
  out.lantern = mesh(S.merge(lamp), M.metal);
  return out;
}

function buildReflection(ctx) {
  const seed = 17; const M = ctx.M;
  const COAT = 0x1f3a3a;
  const g = new THREE.Group(); const body = new THREE.Group();
  const figs = { male: mesh(wardenFigure(seed, 'male'), M.skin), female: mesh(wardenFigure(seed, 'female'), M.skin) };
  const L = S.limbs(12, { seed, sides: 5, taper: 0.75, cast: false });
  [0, 1, 3, 4].forEach((i) => L.tone(i, COAT)); [2, 5].forEach((i) => L.tone(i, 0x2a2018));
  [6, 7, 9, 10].forEach((i) => L.tone(i, 0x2a2826)); [8, 11].forEach((i) => L.tone(i, 0x15110f));
  const tools = reflectionTools(M, seed);
  const toolList = Object.entries(tools);
  body.add(figs.male, figs.female);
  g.add(body, L.mesh, ...Object.values(tools));
  setLayer(g, LAYER_GLASS);
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()]; const elbow = V(); const knee = V(); const bend = V(); const toe = V();
  const tool = new THREE.Object3D();
  let phase = 0; let move = 0; let lx = 0; let lz = 0; let had = false;
  return {
    g,
    reset() { had = false; },
    update(c, show) {
      g.visible = !!show;
      if (!show) { had = false; return; }
      const { dt, sim, pl } = c;
      const seen = reflectionOf(sim); // the game's look and the weapon in hand, this frame (issues 25, 26)
      const female = seen.look === 'female';
      figs.male.visible = !female; figs.female.visible = female;
      const held = reflectedTool(seen.weapon);
      for (const [name, m] of toolList) m.visible = name === held.name;
      const speed = had && dt > 0 ? Math.hypot(pl.x - lx, pl.z - lz) / dt : 0;
      lx = pl.x; lz = pl.z; had = true;
      move = approach(move, speed > 0.3 ? 1 : 0, dt, 8);
      phase += (Math.min(speed, 8) * dt) / 1.6;
      g.position.set(pl.x, num(pl.y), pl.z);
      g.rotation.y = num(pl.yaw);
      const step = phase * TAU;
      const pitch = clamp(num(pl.pitch), -0.9, 0.9);
      body.position.set(0, -0.03 * move * Math.abs(Math.sin(step)), 0);
      body.rotation.set(-0.05 * move - 0.15 * pitch, 0, 0.03 * move * Math.sin(step));
      body.updateMatrix();
      tool.position.set(0.16, 1.18, -0.2).applyMatrix4(body.matrix);
      tool.rotation.set(pitch + held.lift, 0, 0);
      if (held.name && tools[held.name]) { tools[held.name].position.copy(tool.position); tools[held.name].rotation.copy(tool.rotation); }
      const shoulder = female ? 0.23 : 0.27;
      for (let i = 0; i < 2; i++) {
        const sx = i ? -1 : 1;
        sh[i].set(sx * shoulder, 1.44, 0).applyMatrix4(body.matrix);
        const gp = held.grips[i];
        if (held.free[i]) hand[i].set(gp[0], gp[1], gp[2]).applyMatrix4(body.matrix);
        else hand[i].set(gp[0], gp[1], gp[2]).applyEuler(tool.rotation).add(tool.position);
        bend.set(sx * 0.6, -0.8, 0.3);
        placeArm(L, i * 3, sh[i], hand[i], 0.31, 0.31, bend, 0.058, elbow);
        const cph = frac(phase + i * 0.5);
        let fz; let fy = 0;
        if (cph < 0.55) fz = (cph / 0.55 - 0.5) * 0.8; else { const s = (cph - 0.55) / 0.45; fz = (0.5 - smooth(s)) * 0.8; fy = Math.sin(Math.PI * s) * 0.14; }
        hip[i].set(sx * 0.11, 0.9, 0).applyMatrix4(body.matrix);
        foot[i].set(sx * 0.12, 0.06 + fy * move, fz * move);
        toe.set(0, -0.08, -1).normalize();
        bend.set(0, 0.1, -1);
        placeLeg(L, 6 + i * 3, hip[i], foot[i], 0.44, 0.44, bend, 0.075, toe, knee);
      }
      L.commit();
    },
  };
}

// ---- the tall figure (R8) -------------------------------------------------------------------------
// It stands on the far apron, in the glass only: a tall shape with no face. It is nobody: the house's
// vampires cast no reflection. One draw call, on the glass-only layer.

function buildTall() {
  const seed = 131;
  const pale = new THREE.Color(0xaeb6ba);
  const parts = [
    S.skin([{ at: [0, 0, 0.05], r: [0.4, 0.36] }, { at: [0, 0.9, 0], r: [0.25, 0.2] }, { at: [0, 2.2, -0.02], r: [0.2, 0.15] }, { at: [0, 2.46, -0.03], r: [0.33, 0.15] },
      { at: [0, 2.56, -0.03], r: 0.075 }, { at: [0, 2.68, -0.07], r: [0.1, 0.12] }, { at: [0, 2.95, -0.1], r: [0.085, 0.105] }],
    { seed, sides: 12, detail: 3, budget: 800, noise: 0.05, mottle: 0.2, color: 0x07080b, color2: 0x10131a, caps: ['flat', 'round'], capLen: 0.7,
      profile: (a, u) => 1 + (u < 0.7 ? 0.1 * Math.sin(a * 8) * (0.7 - u) : 0),
      colorAt: (u, a, c) => {
        if (u < 0.86) return;
        c.copy(pale); // the head: long, bare, and no face on it at all
      } }),
  ];
  for (const sx of [-1, 1]) { // arms that hang to the knee, the hands too long
    parts.push(S.skin([{ at: [sx * 0.31, 2.44, -0.03], r: 0.075 }, { at: [sx * 0.36, 1.7, -0.06], r: 0.06 }, { at: [sx * 0.34, 1.02, -0.12], r: 0.045 },
      { at: [sx * 0.33, 0.95, -0.13], r: 0.03, color: pale }, { at: [sx * 0.32, 0.62, -0.14], r: [0.035, 0.014], color: pale }, { at: [sx * 0.31, 0.5, -0.13], r: 0.004, color: pale }],
    { seed: seed + sx, sides: 6, detail: 2, budget: 160, noise: 0.05, color: 0x07080b, mottle: 0.2 }));
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, transparent: true, opacity: 0, emissive: 0x141a20, emissiveIntensity: 0.6 });
  const m = mesh(S.merge(parts), mat);
  m.layers.set(LAYER_GLASS);
  m.visible = false;
  let level = 0;
  return {
    g: m,
    reset() { level = 0; m.visible = false; mat.opacity = 0; },
    update(c, show) {
      level = c.dt > 0 ? approach(level, show ? 1 : 0, c.dt, show ? 5 : 9) : (show ? 1 : 0);
      m.visible = level > 0.02;
      mat.opacity = level;
      m.rotation.z = 0.012 * Math.sin(c.time * 0.6); // it does not quite stand still
    },
  };
}

// ---- the gallery and the crypt (R8, R12) ----------------------------------------------------------

function buildGallerySet(ctx) {
  const M = ctx.M; const G = MAP.GALLERY_PROPS; const C = MAP.CRYPT_PROPS; const fy = MAP.CRYPT.floor;
  const g = new THREE.Group();
  const art = paintings(G.portraits.map((p, i) => {
    const yaw = p.wall === 's' ? 0 : p.wall === 'n' ? Math.PI : facingIn('gallery', p.x, p.z);
    return { x: p.x, y: 2.35, z: p.z, yaw, w: MAP.WALL_ART.portrait.w, h: MAP.WALL_ART.portrait.h, paint: sitter(i), ground: 0x14110f };
  }), M, { sitterLayer: LAYER_EYE, name: 'painted:gallery' });
  const self = buildReflection(ctx);
  const tall = buildTall();
  tall.g.position.set(G.tall.x, 0, G.tall.z);
  tall.g.rotation.y = headingTo(0, MAP.GALLERY.entrance.maxZ - G.tall.z); // facing down the room, to the entrance
  // below: the Hare, the nun, the rats
  const crypt = new THREE.Group();
  const hare = buildHare(ctx);
  hare.place(C.hare.x, fy, C.hare.z, headingTo(C.hare.x - C.coffin.x, 0.6)); // his back to the coffin, turned a little to the stair
  const ring = V(C.coffin.x - 0.6, fy + 0.55, C.hare.z); // on the coffin's side
  const nunAt = { x: C.nun.x, z: C.nun.z, yaw: -Math.PI / 2 };
  const nun = mesh(seat(nunGeometry(), nunAt.x, fy, nunAt.z, nunAt.yaw), M.skin, true);
  const HARE_LINKS = 14; const NUN_LINKS = 12;
  const chain = chainLinks(HARE_LINKS + NUN_LINKS, M);
  _m.compose(_a.set(nunAt.x, fy, nunAt.z), _q.setFromAxisAngle(_y.set(0, 1, 0), nunAt.yaw), ONE);
  chain.hang(HARE_LINKS, NUN_LINKS, V(0.09, 0.47, -0.4).applyMatrix4(_m), V(0.55, 0.03, -0.5).applyMatrix4(_m), 0.1, fy);
  const RATS = C.rats.length * 2;
  const rats = new THREE.InstancedMesh(ratGeometry(), M.skin, RATS);
  crypt.add(hare.g, nun, chain.mesh, rats);
  g.add(art.group, self.g, tall.g, crypt);
  const wr = V();
  let showTall = false;
  return {
    g, figures: { 'gallery portraits': art.group, "warden's reflection": self.g, 'tall figure': tall.g, 'March Hare': hare.g, nun, chains: chain.mesh, rats },
    reset() { self.reset(); tall.reset(); hare.reset(); showTall = false; art.rest(); },
    onEvent(ev) {
      if (ev.type === 'haunt' && ev.kind === 'tall') showTall = ev.id === 'show';
      else if (ev.type === 'speak' && ev.who === 'hare') hare.say(4);
    },
    update(c) {
      const { w, pl, time, eye } = c;
      art.watch(eye, c.dt, false, c.reduced, pl ? pl.yaw : NaN);
      const up = !!(w && pl && !pl.dead && c.zone === 'gallery' && w.under !== 'crypt');
      self.update(c, up);
      const h = w && w.haunts;
      if (h && h.tall) showTall = h.tall.left > 0; // the rules' own record wins over a missed event
      tall.update(c, up && showTall);
      // the crypt is drawn from below, or from above through a tile that has gone
      const holes = !!(w && w.tiles && w.tiles.gone && w.tiles.gone.some(Boolean));
      crypt.visible = eye.y < 0.3 || holes;
      if (!crypt.visible) return;
      hare.update(c);
      hare.g.updateMatrix();
      wr.copy(hare.wrist).applyMatrix4(hare.g.matrix);
      chain.hang(0, HARE_LINKS, wr, ring, 0.28, fy);
      for (let i = 0; i < RATS; i++) {
        const spot = C.rats[i >> 1]; const ph = i * 2.4;
        const t = time * 0.45 + ph;
        ratAt(spot, ph, fy, t, _o.position); ratAt(spot, ph, fy, t + 0.02, _a).sub(_o.position);
        _o.rotation.set(0, _a.lengthSq() > 1e-10 ? headingTo(_a.x, _a.z) : ph, 0);
        _o.scale.setScalar(1.1 + 0.3 * hash(i, 3));
        _o.updateMatrix();
        rats.setMatrixAt(i, _o.matrix);
      }
      rats.computeBoundingSphere();
      rats.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- the mirror room (R11): portraits -------------------------------------------------------------

function buildMirrorSet(ctx) {
  const art = paintings(MAP.MIRROR_ROOM.portraits.map((p, i) => ({
    x: p.x, y: UPPER + 2.1, z: p.z, yaw: facingIn('mirror', p.x, p.z), w: MAP.WALL_ART.mirrorPortrait.w, h: MAP.WALL_ART.mirrorPortrait.h, paint: sitter(i + 3), ground: 0x14110f,
  })), ctx.M, { name: 'painted:mirror' });
  return { g: art.group, figures: { 'mirror room portraits': art.group }, reset() { art.rest(); }, update(c) { art.watch(c.eye, c.dt, false, c.reduced, c.pl ? c.pl.yaw : NaN); } };
}

// ---- the Count (R14, R15) and the bats ------------------------------------------------------------
// The book's Count: a tall old man with thick white hair, heavy brows, a long white moustache, small fangs, eyes like coals. He rises in beats that read across the room
// (countlid.js: his hand comes up and pushes the lid open, it falls back, he sits, he stands), recoils from each shaft of dawn, lurches, and
// burns. Eight draw calls: torso, skull, jaw, eyes, cloak, limbs, and the two glow sprites of his
// eyes. The bats are one instanced mesh.

const C_TALL = 1.14; // he is a tall man
const C_EARTH = 0.84; // the earth in the box, to its rim, over the room's floor (keepprops.js: earthBox(…, B.h - 0.06))
const C_FLOOR = C_EARTH / C_TALL; // the same in his own (scaled) measure
const C_LIE = -0.34; // lying, his hips this far under the earth's top (his own measure): his face clear of the shut lid by a dark slit
const C_FACE = -0.3; // lying, his face tipped up to the lid (radians)
const C_SEG_R = 0.1; // sculpt.js limbs(): the segment's radius as built (place() scales by r / it)

/**
 * The mitten at instance i laid flat on a face (the lid's inner face: n its normal toward him, t the
 * way along it), from the wrist on: fingers along the face where the forearm would carry them, the
 * palm's depth halved against the boards. k blends from the arm's own mitten (0) to the flat palm (1).
 */
function palmOn(L, i, wrist, elbow, n, t, len, r, k) {
  _d.subVectors(wrist, elbow).normalize();
  _e.copy(_d).addScaledVector(n, -_d.dot(n)); // the forearm's way, along the face
  if (_e.lengthSq() < 1e-6) _e.copy(t);
  _e.normalize();
  _y.copy(_d).lerp(_e, k).normalize();
  _x.crossVectors(_y, n);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _z.crossVectors(_x, _y).normalize();
  const across = r / C_SEG_R; const deep = across * lerp(1, 0.5, k);
  _m.makeBasis(_x.multiplyScalar(across), _y.multiplyScalar(len), _z.multiplyScalar(deep));
  _u.copy(wrist).addScaledVector(_y, 0.5); // _y is scaled by len: half way along the palm
  _m.setPosition(_u);
  L.mesh.setMatrixAt(i, _m);
}

/**
 * Where the Count is, for the fire (pyre.js): world positions, rewritten every frame he is drawn.
 * { live, chest: Vector3, hands: [right, left] }. live is true only while he lurches or burns.
 */
export const countPoints = { live: false, chest: new THREE.Vector3(), hands: [new THREE.Vector3(), new THREE.Vector3()] };

function buildCount(ctx) {
  const seed = 151; const M = ctx.M;
  const g = new THREE.Group(); const body = new THREE.Group();
  g.add(body);
  const skinC = M.skin.clone(); const clothC = M.cloth.clone();
  const BLACK = 0x0a0a0d; const HAIR = 0xdcd9cf;
  const torso = mesh(S.merge([
    S.skin([{ at: [0, -0.06, 0], r: [0.2, 0.15] }, { at: [0, 0.25, 0], r: [0.185, 0.14] }, { at: [0, 0.5, -0.02], r: [0.25, 0.15] }, { at: [0, 0.62, 0], r: [0.23, 0.13] }, { at: [0, 0.7, 0], r: 0.07, color: 0xd4d0c6 }],
      { seed, sides: 10, detail: 2, budget: 440, noise: 0.04, mottle: 0.15, color: BLACK, color2: 0x15151b,
        colorAt: (u, a, c) => { if (Math.cos(a) > 0.95 && u > 0.5 && u < 0.9) c.set(0xcfccc2); } }), // a white shirt front, a hand's breadth
    // the collar of the cloak, standing behind the head
    S.skin([{ at: [0, 0.6, 0.1], r: [0.24, 0.05] }, { at: [0, 0.78, 0.15], r: [0.27, 0.035] }, { at: [0, 0.93, 0.19], r: [0.2, 0.012] }],
      { seed: seed + 1, sides: 8, detail: 2, budget: 120, noise: 0.03, color: BLACK, color2: 0x1a0c10, mottle: 0.15, capLen: 0.3 }),
  ]), skinC, true);
  const stache = (sx) => S.skin([
    { at: [sx * 0.01, 0.117, -0.202], r: 0.018 }, { at: [sx * 0.07, 0.104, -0.187], r: 0.017 }, { at: [sx * 0.113, 0.043, -0.161], r: 0.012 }, { at: [sx * 0.126, -0.043, -0.143], r: 0.004 },
  ], { seed: seed + sx, sides: 5, detail: 2, noise: 0.08, rough: 0.2, color: HAIR, mottle: 0.12 });
  // the book's Count: a tall old man, thick white hair swept back from a high brow and curling at the neck
  const lock = (rings, k) => S.skin(rings, { seed: seed + 30 + k, sides: 8, detail: 2, budget: 170, noise: 0.14, grain: 2.4, rough: 0.28, color: HAIR, color2: 0xa9a69c, mottle: 0.2, shade: 0.4 });
  const mane = [
    lock([{ at: [0, 0.315, -0.125], r: [0.15, 0.035] }, { at: [0, 0.4, -0.02], r: [0.2, 0.075] }, { at: [0, 0.37, 0.12], r: [0.215, 0.1] }, { at: [0, 0.2, 0.2], r: [0.21, 0.09] },
      { at: [0, 0.04, 0.19], r: [0.16, 0.07] }, { at: [0, -0.04, 0.17], r: [0.09, 0.04] }], 0),
    lock([{ at: [0.17, 0.3, -0.03], r: [0.05, 0.06] }, { at: [0.2, 0.16, 0.04], r: [0.055, 0.09] }, { at: [0.18, 0.03, 0.08], r: [0.035, 0.05] }], 1),
    lock([{ at: [-0.17, 0.3, -0.03], r: [0.05, 0.06] }, { at: [-0.2, 0.16, 0.04], r: [0.055, 0.09] }, { at: [-0.18, 0.03, 0.08], r: [0.035, 0.05] }], 2),
  ];
  const hd = S.head({
    size: 0.2, seed, budget: 2400, fine: true, defects: ['fangTips', 'noBlink', 'eyesRed'], extras: [stache(1), stache(-1), ...mane],
    face: {
      skin: 0xd4d0c6, eye: EMBER, hair: HAIR, skull: { tall: 1.1, wide: 0.97, taper: 0.34, cheek: 0.03, brow: 0.1, socket: 0.12, temple: 0.04, chin: 0.09 },
      eyes: { r: 0.15, open: 0.7, iris: 0.6, pupil: 0.14 }, brow: { color: HAIR, thick: 0.09, tilt: 0.75 }, nose: { kind: 'long', size: 0.13, length: 0.44 },
      mouth: { width: 0.4, smile: 0.0, lip: 0x6a1418, toothLen: 0.07 }, cheek: { rosy: 0 }, ears: { kind: 'round', size: 0.6 },
    },
  });
  hd.group.position.set(0, 0.7, 0);
  hd.skull.material = skinC; if (hd.jaw) hd.jaw.material = skinC;
  const glow = S.eyeGlow(hd, { color: EMBER, strength: 0.7, size: 0.55, opacity: 0.45 });
  const cloak = S.cloth({ curve: 4.3, radius: 0.25, flare: 0.55, length: 1.42, cols: 12, rows: 7, budget: 340, color: BLACK, folds: 7, foldDepth: 0.04, tatter: 0.35, dirt: 0.2, seed, material: clothC });
  cloak.mesh.position.set(0, 0.63, 0.02); cloak.mesh.rotation.y = Math.PI;
  const L = S.limbs(12, { seed, sides: 5, taper: 0.7, material: skinC });
  [0, 1, 3, 4, 6, 7, 9, 10].forEach((i) => L.tone(i, 0x0d0d11)); [2, 5].forEach((i) => L.tone(i, 0xd4d0c6)); [8, 11].forEach((i) => L.tone(i, 0x050506));
  body.add(torso, hd.group, cloak.mesh);
  g.add(L.mesh);
  const rig = { root: null, chest: torso, head: hd, cloths: [cloak], seed, rate: 0.1 };
  const sh = [V(), V()]; const hip = [V(), V()]; const hand = [V(), V()]; const foot = [V(), V()]; const elbow = V(); const knee = V(); const bend = V(); const toe = V();
  const home = V(); let homeYaw = Math.PI;
  let burn = -1; let recoil = 0; let yaw = 0; let was = 'box';
  // the lid and his rise as the rules have them (countlid.js), the one answer keepprops.js turns the lid by
  const stage = newCountStage();
  const lidWrist = V(); const lidN = V(); const lidT = V(); const toLocal = new THREE.Matrix4();

  // o: sit (0 lying, 1 sitting), stand (0..1 on his feet), reach (0..1: his east hand on the lid's inner face at
  // lidWrist, in his own frame), grip0 / grip1 (each hand on the rim), recoil, lurch, burn (0..1 arms flung), time
  function pose(o) {
    const sit = o.sit; const stand = o.stand;
    const out = o.lurch; // out of the box, on the floor
    const fl = C_FLOOR * (1 - out);
    const hy = fl + lerp(C_LIE, 0.14, Math.max(sit, out)) + 0.8 * stand; // lying, he is half under the earth
    body.position.set(0, hy, 0.2 * (1 - stand));
    body.rotation.set(
      // thrown back by a shaft of dawn once he is up; lying in his box (sit 0) there is nowhere to be thrown: the
      // lid is over him, so only his arm comes across his eyes (the smoke's countlid leg caught the cloak swinging up through it)
      (Math.PI / 2) * 0.97 * (1 - sit) - 0.16 * sit * (1 - stand) + 0.3 * o.recoil * sit * (1 - o.reach) - 0.35 * o.lurch - 0.3 * o.burn,
      -0.65 * o.recoil * sit * (1 - o.reach), 0.04 * o.burn * Math.sin(o.time * 31),
    );
    body.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1;
      sh[i].set(sx * 0.24, 0.6, 0).applyMatrix4(body.matrix);
      // at his side; then on the rim (his east hand only once it has left the lid, and off the hinge line)
      hand[i].set(sx * 0.21, fl + 0.06 + C_LIE, 0.5).lerp(_a.set(sx * (i ? 0.42 : 0.6) / C_TALL, 0.96 / C_TALL, 0.42 - 0.3 * sit), i ? o.grip1 : o.grip0);
      if (i === 1) hand[i].lerp(lidWrist, o.reach); // his east hand pushes the lid: the wrist rides its inner face
      hand[i].lerp(_a.set(sx * (0.42 + 0.1 * Math.sin(o.time * 0.8 + i)), hy + 0.2, -0.22), stand); // off the rim, the cloak opening
      hand[i].lerp(_a.set(sx * 0.22, hy + 0.55, -0.8), o.lurch);
      if (i === 0) hand[i].lerp(_a.set(-0.02, 0.86, -0.24).applyMatrix4(body.matrix), o.recoil); // an arm across the eyes
      hand[i].lerp(_a.set(sx * 0.78, hy + 0.85 + 0.04 * Math.sin(o.time * 27 + i), 0.05), o.burn);
      if (i === 1) bend.set(sx * lerp(-0.15, 0.7, stand), lerp(-0.8, -0.7, stand), 0.6); // his east elbow down into the earth, never out over the hinge side
      else bend.set(sx * 0.7, -0.2 - 0.5 * stand, 0.6);
      placeArm(L, i * 3, sh[i], hand[i], 0.33, 0.34, bend, 0.05, elbow, 1.7);
      if (i === 1 && o.reach > 0) palmOn(L, 5, hand[1], elbow, lidN, lidT, 0.1, 0.05 * 1.7, o.reach); // the palm flat on the boards
      hip[i].set(sx * 0.1, 0, 0).applyMatrix4(body.matrix);
      const stride = o.lurch > 0 ? Math.sin(o.time * 14 + i * Math.PI) * 0.35 * o.lurch : 0;
      foot[i].set(sx * 0.1, fl + 0.04 + C_LIE * (1 - sit), -0.74).lerp(_a.set(sx * 0.12, fl + 0.04, -0.03 + stride), stand);
      toe.set(0, 0.6 * (1 - stand), -1).normalize();
      bend.set(0, 1 - stand, -0.2 - stand);
      placeLeg(L, 6 + i * 3, hip[i], foot[i], 0.46, 0.46, bend, 0.066, toe, knee);
    }
    L.commit();
    // for the fire: his chest and both hands, in the world, while he lurches or burns
    countPoints.live = o.lurch > 0 || o.burn > 0;
    if (countPoints.live) {
      g.updateWorldMatrix(false, false); body.updateWorldMatrix(false, false);
      countPoints.chest.set(0, 0.5, -0.05).applyMatrix4(body.matrixWorld);
      for (let i = 0; i < 2; i++) countPoints.hands[i].copy(hand[i]).applyMatrix4(g.matrixWorld);
    }
  }

  return {
    g,
    place(x, y, z, facing) { home.set(x, y, z); homeYaw = facing; g.position.copy(home); g.rotation.y = facing; },
    reset() { burn = -1; recoil = 0; was = 'box'; g.visible = false; countPoints.live = false; g.scale.set(1, 1, 1); skinC.color.setScalar(1); clothC.color.setScalar(1); glow.material.color.setScalar(1); },
    recoil() { recoil = 1; },
    update(c) {
      const { sim, w, pl, dt, time, eye, reduced } = c;
      const cs = w && w.count;
      const phase = cs ? cs.phase : 'box';
      if (!cs || phase === 'box' || phase === 'ash') { g.visible = false; was = phase; burn = -1; countPoints.live = false; return; }
      if (phase === 'burning') {
        if (was !== 'burning') burn = 0;
        const pc = pyreClock(w);
        burn = Number.isFinite(pc) ? pc : burn + dt;
      }
      countStage(sim, pyreClock(w), reduced, stage); // the same clock keepprops.js turns the lid by (its own burn below only chars him)
      g.visible = true;
      g.scale.setScalar(C_TALL);
      let lurch = 0; let burnK = 0;
      recoil = cs.still > 0 ? approach(recoil, 1, dt, 14) : approach(recoil, 0, dt, 2.5);
      if (phase === 'lurch') {
        const total = (sim.cfg.count && sim.cfg.count.lurch) || 1.2;
        lurch = smooth(1 - clamp(num(cs.lurchLeft) / total) + (cs.bitten ? 1 : 0));
        const dx = pl.x - home.x; const dz = pl.z - home.z; const d = Math.hypot(dx, dz) || 1;
        g.position.set(home.x + dx * lurch * Math.max(0, 1 - 0.6 / d), home.y, home.z + dz * lurch * Math.max(0, 1 - 0.6 / d));
        g.rotation.y = homeYaw + wrap(headingTo(dx, dz) - homeYaw) * Math.min(1, lurch * 3);
      } else {
        g.position.copy(home); g.rotation.y = homeYaw;
      }
      if (phase === 'burning') {
        burnK = stage.up; // he comes up out of the earth into the light (once the lid is flung clear), and it has him
        const char = smooth((burn - 1.5) / 4.5);
        skinC.color.setScalar(1 - 0.94 * char); clothC.color.setScalar(1 - 0.9 * char); glow.material.color.setScalar(1 - 0.5 * char);
        const sink = smooth((burn - 6.5) / 2);
        g.scale.set(C_TALL * (1 - 0.55 * sink), C_TALL * (1 - 0.93 * sink), C_TALL * (1 - 0.55 * sink));
        if (burn >= 8.5) { g.visible = false; was = phase; countPoints.live = false; return; }
      }
      was = phase;
      const stand = stage.stand; const sit = stage.sit;
      // his east hand's wrist on the lid, and the lid's face, in his own (scaled, turned) frame
      g.updateMatrix(); toLocal.copy(g.matrix).invert();
      lidWrist.set(stage.wrist.x, stage.wrist.y, stage.wrist.z).applyMatrix4(toLocal);
      lidN.set(stage.normal.x, stage.normal.y, stage.normal.z).transformDirection(toLocal);
      lidT.set(stage.along.x, stage.along.y, stage.along.z).transformDirection(toLocal);
      S.breathe(rig, time, { look: eye, amount: 0.4, sway: 0.6 + 2 * lurch + 3 * burnK, wind: lurch + burnK });
      // the head comes round to the warden once he sits; thrown back when he burns
      const dx = eye.x - g.position.x; const dz = eye.z - g.position.z;
      yaw = approach(yaw, sit * (1 - recoil) * clamp(wrap(headingTo(dx, dz) - g.rotation.y), -1.2, 1.2), dt, 2.5);
      hd.group.rotation.y = yaw;
      hd.group.rotation.x += C_FACE * (1 - sit) + 0.45 * burnK + 0.25 * recoil; // lying, his face is to the lid
      hd.pose({ jaw: Math.max(0.9 * lurch, burnK, 0.5 * recoil), frown: 0.9, brow: -0.8 });
      glow.set((0.35 + 0.65 * Math.max(sit, stand) + (reduced ? 0.3 : 1.0) * Math.max(lurch, recoil)) * (burn > 6.5 ? 0 : 1));
      pose({ sit, stand, reach: stage.reach, grip0: stage.grip[0], grip1: stage.grip[1], recoil, lurch, burn: phase === 'burning' ? Math.max(burnK, 1e-3) : 0, time });
    },
  };
}

function buildBats(ctx, n) {
  // K7: the road's bat (roadview.js) at the Count's swarm scale: a furred body with ears, wings of
  // membrane over a short arm and three finger bones, scalloped between them, flapping in the
  // vertex shader (one draw call). Lit like the room, so the fill and the dawn rim fall on them.
  const geo = batGeometry(0.5);
  const flapAt = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  flapAt.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlap', flapAt);
  const mat = batFlap(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), geo.userData.hinge);
  const beat = Array.from({ length: n }, (_, i) => TAU * (8 + 3 * hash(i, 6)));
  const bats = new THREE.InstancedMesh(geo, mat, n);
  bats.frustumCulled = false;
  bats.visible = false;
  let level = 0; let flee = 0; const mid = V(); let had = false;
  return {
    g: bats,
    reset() { level = 0; flee = 0; bats.visible = false; had = false; },
    /** on: they crowd the warden; gone: they scatter (the dawn has him). */
    update(c, on, gone) {
      const { dt, time, pl } = c;
      level = approach(level, on ? 1 : 0, dt, on ? 1.2 : 3);
      if (gone && level > 0.02) flee += dt * 7; else if (on) flee = 0;
      bats.visible = level > 0.02 && !!pl && flee < 14;
      if (!bats.visible) { had = false; return; }
      _a.set(pl.x, num(pl.y) + 1.55, pl.z);
      if (!had) { mid.copy(_a); had = true; } else mid.lerp(_a, Math.min(1, dt * 6));
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? 1 : -1;
        const a = time * (1.5 + 0.9 * hash(i, 1)) * dir + hash(i, 2) * TAU;
        const r = (0.75 + 1.3 * hash(i, 3) + 0.35 * Math.sin(time * 1.1 + i)) * (2 - level) + flee;
        const y = 0.45 * Math.sin(time * (1.7 + hash(i, 4)) + i * 2.1) - 0.1 + flee * 0.25;
        _o.position.set(mid.x + Math.cos(a) * r, mid.y + y, mid.z + Math.sin(a) * r);
        // nose along the way it flies, banked into the turn
        _o.rotation.set(0.25 * Math.cos(time * 3 + i), -a + (dir > 0 ? Math.PI : 0), dir * 0.5, 'YXZ');
        _o.scale.setScalar(1.0 + 0.4 * hash(i, 5));
        _o.updateMatrix();
        bats.setMatrixAt(i, _o.matrix);
        const ph = time * beat[i] + hash(i, 7) * TAU;
        flapAt.array[i * 2] = 0.1 + 0.8 * Math.sin(ph);
        flapAt.array[i * 2 + 1] = -0.2 + 0.7 * Math.sin(ph - 1.2);
      }
      bats.instanceMatrix.needsUpdate = true;
      flapAt.needsUpdate = true;
    },
  };
}

function buildCountSet(ctx) {
  const R = MAP.COUNT_ROOM;
  const g = new THREE.Group();
  const count = buildCount(ctx);
  const door = MAP.doorOf('countIn');
  const dz = door ? (door.rect.minZ + door.rect.maxZ) / 2 - R.boxAt.z : 1;
  count.place(R.boxAt.x, UPPER, R.boxAt.z, headingTo(0, dz)); // he sits up facing the door
  const n = (ctx.cfg && ctx.cfg.haunts && ctx.cfg.haunts.bats) || 12;
  const bats = buildBats(ctx, n);
  g.add(count.g, bats.g);
  return {
    g, figures: { 'the Count': count.g, bats: bats.g },
    reset() { count.reset(); bats.reset(); },
    onEvent(ev) { if (ev.type === 'countRecoil') count.recoil(); },
    update(c) {
      count.update(c);
      const w = c.w; const h = w && w.haunts; const cs = w && w.count;
      const gone = !!cs && (cs.phase === 'burning' || cs.phase === 'ash');
      bats.update(c, !!(h && h.bats && h.bats.on) && !gone, gone);
    },
  };
}

// ---- the figures past the windows (G10) -----------------------------------------------------------
// Things flit about outside: some vampiric, some of both books. On haunts.js's haunt { kind:
// 'window' } one crosses the opening of a window of the room the warden is in, outside the glass,
// and is gone; none during a scene. Shapes against the night, no more: two instanced meshes (three
// winged, three long-eared), so one or two draw calls while one passes and none between.

function buildPassers() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x04060a, side: THREE.DoubleSide });
  const flat = (pts, idx) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return S.tint(geo, 0xffffff);
  };
  // a cloaked thing on bat's wings, seen side on (it travels along -Z)
  const winged = S.merge([
    S.skin([{ at: [0, 0, 0.25], r: [0.1, 0.16] }, { at: [0, 0.7, 0.08], r: [0.14, 0.2] }, { at: [0, 1.3, -0.08], r: [0.12, 0.17] }, { at: [0, 1.5, -0.14], r: 0.06 }], { sides: 6, detail: 1, noise: 0.1, color: 0xffffff, mottle: 0 }),
    ball(0.13, 0, 1.66, -0.2, 0xffffff, 0.8, 1.1, 1, 0),
    flat([[0, 1.35, 0], [0, 2.3, 0.7], [0, 1.7, 1.25], [0, 1.2, 0.95], [0, 0.75, 1.3], [0, 0.6, 0.6]], [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]),
    flat([[0, 1.4, -0.1], [0, 2.2, -0.75], [0, 1.6, -1.2], [0, 1.15, -0.85]], [0, 1, 2, 0, 2, 3]),
  ]);
  // something long-eared and stooped, a long arm out in front of it
  const eared = S.merge([
    S.skin([{ at: [0, 0, 0.2], r: [0.16, 0.26] }, { at: [0, 0.8, 0.1], r: [0.15, 0.24] }, { at: [0, 1.35, -0.15], r: [0.13, 0.2] }, { at: [0, 1.55, -0.32], r: 0.07 }], { sides: 6, detail: 1, noise: 0.1, color: 0xffffff, mottle: 0 }),
    ball(0.15, 0, 1.68, -0.45, 0xffffff, 0.8, 0.95, 1.25, 0),
    flat([[0, 1.78, -0.42], [0, 2.5, -0.2], [0, 2.45, -0.05], [0, 1.74, -0.3]], [0, 1, 2, 0, 2, 3]),
    flat([[0, 1.76, -0.36], [0, 2.3, 0.18], [0, 2.2, 0.3], [0, 1.7, -0.22]], [0, 1, 2, 0, 2, 3]),
    flat([[0, 1.25, -0.2], [0, 1.0, -0.95], [0, 0.72, -1.3], [0, 0.9, -0.9], [0, 1.1, -0.2]], [0, 1, 3, 1, 2, 3, 0, 3, 4]),
  ]);
  const g = new THREE.Group();
  const kinds = [winged, eared].map((geo) => {
    const m = new THREE.InstancedMesh(geo, mat, 3);
    m.frustumCulled = false; m.visible = false; m.count = 1;
    g.add(m);
    return m;
  });
  const P = { on: false, t: 0, dur: 1, x: 0, y: 0, z: 0, tx: 0, tz: 0, span: 2, kind: 0, n: 1, bob: 0 };
  function hide() { P.on = false; for (const m of kinds) m.visible = false; }
  return {
    g,
    reset: hide,
    /** One (now and then two or three, a little apart) crosses a window of `zone`. n: haunts.js's running count. */
    pass(zone, n) {
      const list = MAP.WINDOWS[zone];
      if (!list || !list.length) return;
      const win = list[Math.floor(hash(n, 3) * list.length) % list.length];
      const yaw = facingIn(zone, win.x, win.z); // the way the window looks into the room
      const zn = MAP.ZONES.find((q) => q.id === zone);
      const dir = hash(n, 5) < 0.5 ? 1 : -1;
      P.tx = Math.cos(yaw) * dir; P.tz = -Math.sin(yaw) * dir; // along the wall
      P.span = zone === 'walk' ? 7 : 2.8;
      P.x = win.x + Math.sin(yaw) * 1.5; P.z = win.z + Math.cos(yaw) * 1.5; // outside the glass
      P.y = (zn ? zn.y : 0) + 0.7 + 0.7 * hash(n, 7);
      P.kind = n % 2; P.n = hash(n, 9) > 0.7 ? 3 : hash(n, 9) > 0.45 ? 2 : 1;
      P.t = 0; P.dur = (P.span * 2) / (3.2 + 1.5 * hash(n, 11)); P.bob = hash(n, 13) * TAU;
      P.on = true;
    },
    update(c) {
      if (!P.on) return;
      if (!c.w || c.w.scene) { hide(); return; }
      P.t += c.dt;
      if (P.t >= P.dur + 0.6) { hide(); return; }
      const m = kinds[P.kind];
      kinds[1 - P.kind].visible = false;
      m.visible = true; m.count = P.n;
      for (let i = 0; i < P.n; i++) {
        const s = (P.t - i * 0.28) / P.dur;
        const d = -P.span + 2 * P.span * s;
        _o.position.set(P.x + P.tx * d, P.y + 0.18 * Math.sin(P.bob + s * 9 + i) + 0.25 * i, P.z + P.tz * d);
        _o.rotation.set(0.12 * Math.sin(P.bob + s * 13), headingTo(P.tx, P.tz), 0);
        _o.scale.setScalar(s < 0 || s > 1 ? 0 : 1 - 0.12 * i);
        _o.updateMatrix();
        m.setMatrixAt(i, _o.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- registration ---------------------------------------------------------------------------------

const ZONE_IDS = ['outside', 'cor1', 'tea', 'gallery', 'mirror', 'count'];
const BUILDERS = { outside: buildOutsideSet, cor1: buildCorridorSet, tea: buildTeaSet, gallery: buildGallerySet, mirror: buildMirrorSet, count: buildCountSet };

/**
 * Registers the castle's cast with actors.js: the factories for 'armour' and 'wife', and one layer
 * that builds, steps and frees the figures of each zone. Returns { counts(), sets, setShell(castle) }.
 * castle (optional): the shell castle.js built. With it, a zone's figures are built and kept while
 * castle.sees(zone) is true; without it (or found at scene.userData.castle or on the shell's root
 * group's userData.castle), the same question is asked of the shell's own zone group's `visible`.
 */
export function registerKeepcast(actors, scene, castle = null) {
  const M = S.materials();
  const ctx = {
    M, scene, cfg: null, suits: new Set(), reduced: false,
    phantom: new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.36, roughness: 0.9, metalness: 0, emissive: 0x6f8aa6, emissiveIntensity: 0.55, depthWrite: true,
    }),
    black: new THREE.MeshBasicMaterial({ color: 0x020203, fog: false }),
    plate: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.25 }), // old iron, rusted dull: it reads by torchlight with no sky to mirror
    tagMat: new THREE.MeshStandardMaterial({ map: tagTexture(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  };
  ctx.keep = new Set([...Object.values(M), ctx.phantom, ctx.black, ctx.tagMat, ctx.plate]);

  actors.register('armour', (e, cfg) => buildArmour(e, cfg, ctx));
  actors.register('wife', (e, cfg) => buildWife(e, cfg, ctx));

  const sets = new Map(); // shell zone id -> { set, seen }
  const shells = new Map();
  let root = null;
  let raven = null;
  let passers = null; // the figures past the windows
  const laid = []; // heaps laid again from the run's record: { v, suit }
  const c = { sim: null, w: null, pl: null, dt: 0, time: 0, eye: V(), reduced: false, zone: null };
  let frozenAt = null; // the clock the castle's figures hold at under the werewolf cutaway
  const filmed = new Set(); // the suits the film holds, to put back as it ends
  const wardenEye = V();
  const filmOut = {}; // cutawayAt's answer, reused

  function shell(id) {
    let s = shells.get(id);
    if (!s || !s.parent) { s = root ? root.getObjectByName(`castle:${id}`) : null; if (s) shells.set(id, s); else shells.delete(id); }
    return s || null;
  }
  /**
   * Whether the shell is drawing zone id now: castle.sees where the shell is known (looked up from the
   * current root every frame; a shell handed over is trusted only while its group is that root), else
   * the zone group's own flag.
   */
  function onScreen(id, sh) {
    if (!sh) return false;
    const api = root.userData.castle || root.userData.shell || (castle && castle.group === root ? castle : null);
    return api && typeof api.sees === 'function' ? !!api.sees(id) : sh.visible;
  }
  function freeSet(id) {
    const rec = sets.get(id);
    if (!rec) return;
    freeTree(rec.set.g, ctx.keep);
    sets.delete(id);
    if (id === 'count') countPoints.live = false;
  }
  function dropLaid() {
    for (const l of laid) { if (l.v.g.parent) l.v.g.parent.remove(l.v.g); l.v.dispose(); }
    laid.length = 0;
  }
  function freeAll() {
    for (const id of [...sets.keys()]) freeSet(id);
    if (raven) { freeTree(raven.g, ctx.keep); raven = null; }
    if (passers) { freeTree(passers.g, ctx.keep); passers = null; }
    dropLaid();
    shells.clear();
    countPoints.live = false;
  }

  /** The suits that have fallen and that nothing is drawing (after a death every view is cleared). */
  const WANT = [false, false];
  function drawnSuit(suit) {
    for (const v of ctx.suits) {
      if (v.suit !== suit) continue;
      let mine = false;
      for (const l of laid) if (l.v === v) mine = true;
      if (!mine) return true;
    }
    return false;
  }
  function layHeaps(sim) {
    const w = sim.waves; const done = w.done || {};
    const t = w.talk;
    WANT[0] = !!(done.armour || (t && t.armourFirst && t.armourFirst.greeted)) && !drawnSuit(1);
    WANT[1] = !!done.armour && !drawnSuit(2);
    for (let i = laid.length - 1; i >= 0; i--) if (!WANT[laid[i].suit - 1]) { const l = laid[i]; if (l.v.g.parent) l.v.g.parent.remove(l.v.g); l.v.dispose(); laid.splice(i, 1); }
    for (let suit = 1; suit <= 2; suit++) {
      if (!WANT[suit - 1]) continue;
      let has = false;
      for (const l of laid) if (l.suit === suit) has = true;
      if (has) continue;
      const at = (sim.cfg.sentries && sim.cfg.sentries.suits) || MAP.SENTRIES.suits;
      const p = at[suit - 1];
      const body = (w.bodies || []).find((b) => b && b.enemy === 'armour' && (b.suit == null ? suit === 2 : b.suit === suit));
      const v = buildArmour({ suit, x: p.x, z: p.z, heading: p.yaw || 0 }, sim.cfg, ctx);
      // where the run's record has it; else a step out from the door (the first), or where it stood to fight (the second)
      const out = suit === 1 ? 0.8 : 1.6;
      const yaw = body && Number.isFinite(body.heading) ? body.heading : (p.yaw || 0) + (suit === 1 ? 0.3 : -0.4);
      v.layDown(body ? body.x : p.x - Math.sin(p.yaw || 0) * out, 0, body ? body.z : p.z - Math.cos(p.yaw || 0) * out, yaw);
      (shell('outside') || scene).add(v.g);
      laid.push({ v, suit });
    }
  }

  /** Where the raven is, or null: haunts.js's perch; in the Count's room, the next curtain's way. */
  const GOAL = { x: 0, y: 0, z: 0, zone: null, tug: false };
  const goalAt = (x, y, z, zone, tug) => { GOAL.x = x; GOAL.y = y; GOAL.z = z; GOAL.zone = zone; GOAL.tug = tug; return GOAL; };
  const TEA_RECT = MAP.ZONES.find((z) => z.id === 'tea').rects[0];
  function ravenGoal() {
    const w = c.w; const h = w && w.haunts; const zone = c.zone;
    if (!h || !h.raven) return null;
    const r = h.raven;
    if (zone === 'count') {
      const cs = w.count;
      if (r.on != null && r.on !== 'cord' && MAP.zoneAt(r.x, r.z) === 'count') return goalAt(r.x, UPPER + (num(r.y) > 0 ? r.y : 1.5), r.z, zone, false);
      // Issue #8: the next curtain to work, in turn (the padlock, the hem nails, then the middle
      // cord): it perches on that way and tugs at it; once all are open, or he burns, it sits on
      // the middle curtain's rail.
      const live = !!cs && cs.phase !== 'ash' && cs.phase !== 'burning';
      const i = live ? nextCurtain(cs) : null;
      if (i != null) { const p = MAP.COUNT_ROOM.curtains[i].perch; return goalAt(p.x, UPPER + p.y, p.z, zone, cs.phase !== 'box'); }
      const mid = MAP.COUNT_ROOM.curtains[MAP.MIDDLE_CURTAIN].cord;
      return goalAt(mid.x, UPPER + 2.7, mid.z, zone, false);
    }
    if (r.on == null) return null;
    const rz = MAP.zoneAt(r.x, r.z);
    if (!rz || shellOf(rz) !== shellOf(zone)) return null;
    const floor = r.z <= -128 ? UPPER : 0;
    // on a clock it sits on the clock's own top (the wall clock hangs on the wall's face); on the board, on the square
    const y = floor + (PERCH_Y[r.on] != null ? PERCH_Y[r.on] : rz === 'walk' ? 0 : Math.max(0, num(r.y)));
    return goalAt(r.on === 'wall' ? TEA_RECT.maxX - 0.1 : r.x, y, r.z, rz, false);
  }

  const layer = {
    setReducedFlash(v) { ctx.reduced = !!v; },
    onEvent(ev) {
      if (ev.type === 'restored') { for (const rec of sets.values()) if (rec.set.reset) rec.set.reset(); if (raven) raven.reset(); if (passers) passers.reset(); dropLaid(); return; }
      if (ev.type === 'haunt' && ev.kind === 'window' && c.w && !c.w.scene && MAP.WINDOWS[c.zone]) {
        const sh = shell(shellOf(c.zone));
        if (sh) {
          if (!passers) passers = buildPassers();
          if (passers.g.parent !== sh) sh.add(passers.g);
          passers.pass(c.zone, num(ev.id));
        }
      }
      if (ev.type === 'speak' && ev.who === 'armour') { for (const v of ctx.suits) if (v.suit === 2 && !v.heap) v.say = 2.6; }
      if (ev.type === 'speak' && ev.who === 'raven' && raven) raven.caw();
      if ((ev.type === 'ravenDodge' || ev.type === 'ravenLand') && raven && ev.type === 'ravenLand') raven.caw();
      for (const rec of sets.values()) if (rec.set.onEvent) rec.set.onEvent(ev, c);
    },
    clear() {
      for (const rec of sets.values()) if (rec.set.reset) rec.set.reset();
      if (raven) raven.reset();
      if (passers) passers.reset();
      dropLaid();
    },
    sync(sim, dt, time, eye) {
      if (!root || !root.parent) root = scene.getObjectByName('castle') || null;
      if (!root || !root.visible) { if (sets.size || raven || laid.length) freeAll(); return; }
      const inRun = !!(sim && sim.cfg && sim.cfg.room === 'castle' && sim.waves);
      c.sim = inRun ? sim : null; c.w = inRun ? sim.waves : null; c.pl = inRun ? sim.player : null;
      // the werewolf cutaway: the castle stands still under the film but for its fires (castle.js)
      // and the fighting suit, which the film poses: the sets, the raven and the window figures
      // hold where they were as it began
      const film = inRun && sim.waves.scene && sim.waves.scene.kind === 'cutaway' ? sim.waves.scene : null;
      if (film) { if (frozenAt === null) frozenAt = time; } else frozenAt = null;
      c.dt = film ? 0 : dt; c.time = film ? frozenAt : time; c.eye.copy(eye); c.reduced = ctx.reduced;
      if (film) {
        // as the film begins, the suits are held: each one's pose kept to put back at the end, and no
        // sync from the rules while it plays (so nothing tracks the film's camera)
        if (!ctx.filmHold) {
          ctx.filmHold = true;
          for (const v of ctx.suits) if (!v.heap && v.filmStart) { v.filmStart(); filmed.add(v); }
        }
        cutawayAt(film.t || 0, film, filmOut);
        for (const v of filmed) {
          if (!filmOut.front) { v.g.visible = false; continue; } // over the climb the castle is not drawn, nor its figures
          if (v.suit === CUT_SUIT && filmOut.guard.active) { v.film(filmOut.guard, time); continue; } // the fighting suit: the film's
          if (!v.filmShown) { // the other: posed once from the rules, as the warden would find it, and left so
            const en = sim.enemies.find((e) => e.type === 'armour' && e.suit === v.suit);
            if (en) { wardenEye.set(sim.player.x, num(sim.player.y) + 1.65, sim.player.z); v.sync(en, 0, frozenAt, wardenEye, sim.cfg, ctx.reduced, true); }
            v.g.visible = !!en;
            v.filmShown = true;
          }
        }
      } else if (ctx.filmHold) {
        for (const v of filmed) { v.unfilm(); v.filmShown = false; }
        filmed.clear();
        ctx.filmHold = false;
      }
      if (inRun) { ctx.cfg = sim.cfg; ctx.boxes = sim.boxes; } // a fallen suit's pieces fall against the warden's own walls (debris.js)
      const at = inRun ? MAP.floorZoneAt(sim.player.x, sim.player.z, num(sim.player.y), sim.waves) : null;
      c.zone = at ? (at.zone === 'crypt' ? 'gallery' : at.zone === 'pit' ? 'bridge' : at.zone) : MAP.zoneAt(eye.x, eye.z);
      const now = performance.now() / 1000;
      for (const id of ZONE_IDS) {
        const sh = shell(id);
        let rec = sets.get(id);
        if (onScreen(id, sh)) {
          if (!rec) {
            rec = { set: BUILDERS[id](ctx), seen: now };
            sh.add(rec.set.g);
            sets.set(id, rec);
          }
          rec.seen = now;
          rec.set.update(c);
        } else if (rec && now - rec.seen > IDLE_FREE) freeSet(id);
      }
      // the raven goes where the rules put it, under the shell zone it is in
      const goal = inRun ? ravenGoal() : null;
      if (goal && !raven) raven = buildRaven(ctx);
      if (raven) {
        const sh = goal ? shell(shellOf(goal.zone)) : null;
        if (goal && sh && raven.g.parent !== sh) sh.add(raven.g);
        raven.update(c, goal && sh ? goal : null);
      }
      if (passers) passers.update(c);
      if (inRun) layHeaps(sim); else if (laid.length) dropLaid();
    },
  };
  actors.addLayer(layer);

  return {
    sets,
    /** Hands over the shell (castle.js's buildCastle result), so zones follow castle.sees. */
    setShell(c2) { castle = c2 || null; },
    /** Draw calls and triangles of every figure built so far: { name: { meshes, triangles } }. */
    counts() {
      const out = {};
      for (const rec of sets.values()) for (const [name, obj] of Object.entries(rec.set.figures || {})) out[name] = S.count(obj);
      if (raven) out.raven = S.count(raven.g);
      if (passers) out['window figures'] = S.count(passers.g);
      for (const v of ctx.suits) out[`armour ${v.suit}`] = S.count(v.g);
      return out;
    },
  };
}
