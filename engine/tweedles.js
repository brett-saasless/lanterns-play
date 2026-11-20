// Tweedledum and Tweedledee, dead on the walk to the road (the owner: "lying dead and bloodied about
// half way thru. created true to the original lewis and carroll drawings"; and on the review page:
// "they should be full size humans, give the bodies different orientations on the ground. they are
// lying next to each other almost peacefully. give the impression/tone that they were killed by some
// unknown monster"). After Tenniel's plates for Through the Looking-Glass (1871), chapter IV: two
// identical plump men with round faces, round skull-caps with a little knob on top, short buttoned
// jackets stretched over round bellies, broad turned-down white collars with DUM and DEE worked on
// them, knee breeches, pale stockings and buckled shoes; here at a grown man's size (about 1.7 m),
// the head in a man's proportion, not a doll's.
//
// They lie close together, quiet, as if they had lain down: Dum on his back, one arm flung out, his
// cap knocked off beside his head; Dee on his side, half turned toward his brother, one arm up over
// his head and his knee drawn up. No weapon, no fight: what killed them is told by the wounds alone,
// three long claw rents through each jacket's front, the cloth torn back from them, and old blood,
// dark rust-brown and dried, pooled under them. The faces are slack, the eyes shut, little blood on
// them. At about the game's level elsewhere (the chessmen's dormouse's bite): no open flesh.
//
// Sculpted in the kit's way (sculpt.js skin rings, tinted primitives, merged): each brother is ONE
// geometry, laid in his own frame: his boots at z 0, his head toward +z, on the ground at y 0.
// tunnelwood.js turns, places and merges both into the walk's one static mesh, so they cost no draw
// call of their own. TWEEDLE_FRAMES (logic/tunnelwalk.js) holds what each frame reaches, measured
// from these geometries (the test keeps all of it off the clear floor).

import * as THREE from 'three';
import * as S from './sculpt.js';

const JACKET = 0x6d7c99; // a slate-blue cloth, light enough to read in the wood's shade
const JACKET_TORN = 0x8e9ab2; // the cloth's paler underside where it is torn back
const BREECHES = 0xbfa877;
const STOCKING = 0xe6dfcf;
const SHOE = 0x1c1816;
const SKIN = 0xdcc6b2; // gone pale
const CHEEK = 0xd2aa98;
const COLLAR = 0xf7f3ea;
const CAP = 0x2c3346;
const LETTER = 0x8a2a1d;
const BLOOD = 0x3f2117; // old blood, dried dark rust-brown
const BLOOD_EDGE = 0x5a2d1d; // where it is thinner, at a rent's edge
const GASH = 0x170b08; // the rent itself
const SCAB = 0x2e1a12;

const SIZE = 1.18; // the kit's figure (a boy's 1.46 m with the legs lengthened) to a man's 1.72 m

/** A tinted primitive, placed (rotations in radians, XYZ). */
function prim(g, hex, at = [0, 0, 0], rot = [0, 0, 0], vary = 0.08, seed = 0) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  S.tint(g, hex, vary, seed);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}

// A stroke font on a 3 x 4 grid for the four letters on the collars.
const STROKES = {
  D: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 3, 3], [3, 3, 3, 1], [3, 1, 2, 0], [2, 0, 0, 0]],
  U: [[0, 4, 0, 1], [0, 1, 1, 0], [1, 0, 2, 0], [2, 0, 3, 1], [3, 1, 3, 4]],
  M: [[0, 0, 0, 4], [0, 4, 1.5, 1.8], [1.5, 1.8, 3, 4], [3, 4, 3, 0]],
  E: [[0, 0, 0, 4], [0, 4, 3, 4], [0, 2, 2.2, 2], [0, 0, 3, 0]],
};
/** The word in raised strokes on a plane facing -z (the front), centred on x = 0, letters `h` tall, reading left to right from the front. */
function lettering(word, h) {
  const u = h / 4;
  const parts = [];
  const adv = u * 4.3;
  const x0 = ((word.length - 1) * adv) / 2 + 1.5 * u;
  [...word].forEach((ch, i) => {
    for (const [a, b, c, d] of STROKES[ch]) {
      const ax = x0 - i * adv - a * u; const bx = x0 - i * adv - c * u;
      const ay = b * u - h / 2; const by = d * u - h / 2;
      const len = Math.hypot(bx - ax, by - ay) + u * 0.7;
      parts.push(prim(new THREE.BoxGeometry(len, u * 0.72, u * 0.4), LETTER, [(ax + bx) / 2, (ay + by) / 2, 0], [0, 0, Math.atan2(by - ay, bx - ax)], 0.1));
    }
  });
  return S.merge(parts);
}

/** An irregular flat pool of dried blood on the ground (y 0), centred at (x, z), radius r (longer along `stretch`). */
function pool(x, z, r, seed, stretch = 0.8) {
  const g = new THREE.CircleGeometry(1, 20);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const k = 0.72 + 0.22 * Math.sin(a * 3 + seed) + 0.12 * Math.sin(a * 7 + seed * 2.3);
    p.setXY(i, p.getX(i) * k * r, p.getY(i) * k * r * stretch);
  }
  g.rotateX(-Math.PI / 2);
  const out = prim(g, BLOOD, [x, 0.014 + seed * 0.0005, z], [0, seed, 0], 0.16, seed);
  // soaked darker in the middle, thinner and browner at the rim
  const c = out.attributes.color; const q = out.attributes.position;
  const edge = new THREE.Color(BLOOD_EDGE);
  for (let i = 0; i < q.count; i++) {
    const d = Math.hypot(q.getX(i) - x, q.getZ(i) - z) / r;
    if (d < 0.05) c.setXYZ(i, c.getX(i) * 0.8, c.getY(i) * 0.8, c.getZ(i) * 0.8);
    else c.setXYZ(i, edge.r, edge.g, edge.b);
  }
  return out;
}

/**
 * Three claw rents across a jacket's front (in the standing frame: the front is -z), from the
 * wearer's right shoulder down across the belly: each a dark gash with a rust-brown lip, and the
 * cloth torn back from it in a pale flap.
 */
function rents(P, seed) {
  const r = S.rng(seed * 31 + 7);
  for (let k = 0; k < 3; k++) {
    const off = (k - 1) * 0.09;
    const x = 0.02 + off * 0.75; const y = 0.69 - off * 0.6;
    const len = 0.4 + r() * 0.06; const tilt = -0.85 + (r() - 0.5) * 0.12;
    const z = -0.303 + Math.abs(y - 0.65) * 0.22; // on the belly's curve
    P.push(prim(new THREE.BoxGeometry(len + 0.06, 0.07, 0.02), BLOOD_EDGE, [x, y, z + 0.006], [0, 0, tilt], 0.2, seed + k));
    P.push(prim(new THREE.BoxGeometry(len, 0.028, 0.024), GASH, [x, y, z - 0.004], [0, 0, tilt], 0.1, seed + k));
    // the torn cloth, lifted along the rent's upper edge
    const nx = -Math.sin(tilt) * 0.03; const ny = Math.cos(tilt) * 0.03;
    P.push(prim(new THREE.BoxGeometry(len * 0.6, 0.045, 0.006), JACKET_TORN, [x + nx + (r() - 0.5) * 0.04, y + ny, z - 0.012], [-0.55, 0, tilt], 0.12, seed + k + 9));
  }
  // dried blood run from the rents into the cloth
  for (const [x, y, rr] of [[0.06, 0.6, 0.06], [-0.05, 0.66, 0.05], [0.1, 0.72, 0.045]]) {
    P.push(prim(new THREE.SphereGeometry(rr, 8, 5).scale(1.2, 1.4, 0.22), BLOOD, [x, y, -0.3], [0, 0, 0], 0.2));
  }
}

/** The round skull-cap and its knob (in the standing frame, sat on a head whose crown is at about y 1.3). */
function cap(tiltZ) {
  return S.merge([
    prim(new THREE.SphereGeometry(0.19, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.62, 1), CAP, [0, 1.2, 0.015], [0.18, 0, tiltZ], 0.1),
    prim(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 6), CAP, [tiltZ * -0.14, 1.33, 0.04], [0.18, 0, tiltZ], 0.1),
    prim(new THREE.SphereGeometry(0.026, 8, 6), 0x8a3a2a, [tiltZ * -0.18, 1.36, 0.045], [0, 0, 0], 0.1),
  ]);
}

/**
 * One brother, standing in the kit's frame (feet on y 0, facing -z), at a man's size.
 * Returns { body, cap } (cap null when it stays on his head).
 */
function standing(name, seed) {
  const P = [];
  const dee = name === 'dee';
  const sk = (rings, o = {}) => S.skin(rings, { sides: 10, detail: 2, budget: 700, seed, noise: 0.03, mottle: 0.08, shade: 0.25, ...o });
  // legs: breeches to the knee, stockings, buckled shoes (Dee's left knee drawn up)
  for (const s of [-1, 1]) {
    const bend = dee && s < 0;
    const knee = bend ? [s * 0.13, 0.32, -0.22] : [s * 0.115, 0.29, -0.01];
    const ankle = bend ? [s * 0.13, 0.08, -0.12] : [s * 0.125, 0.07, 0];
    P.push(sk([
      { at: [s * 0.1, 0.52, 0], r: 0.11, color: BREECHES }, { at: [s * 0.11, 0.4, -0.01], r: 0.1, color: BREECHES },
      { at: knee, r: 0.08, color: BREECHES }, { at: [(knee[0] + ankle[0]) / 2, (knee[1] + ankle[1]) / 2, (knee[2] + ankle[2]) / 2], r: 0.062, color: STOCKING },
      { at: ankle, r: 0.048, color: STOCKING },
    ], { caps: ['open', 'round'] }));
    P.push(sk([{ at: [ankle[0], ankle[1] - 0.035, ankle[2] + 0.04], r: [0.05, 0.035], color: SHOE }, { at: [ankle[0], ankle[1] - 0.04, ankle[2] - 0.08], r: [0.048, 0.03], color: SHOE }, { at: [ankle[0], ankle[1] - 0.04, ankle[2] - 0.13], r: [0.03, 0.025], color: SHOE }], { sides: 8, budget: 160 }));
    P.push(prim(new THREE.BoxGeometry(0.045, 0.025, 0.012), 0xb8a46a, [ankle[0], ankle[1] - 0.015, ankle[2] - 0.07], [0.5, 0, 0], 0)); // the buckle
  }
  // the round body in its short jacket, the breeches showing under it
  P.push(sk([
    { at: [0, 0.44, 0.01], r: 0.2, color: BREECHES }, { at: [0, 0.53, -0.01], r: 0.25, color: JACKET },
    { at: [0, 0.64, -0.03], r: 0.285, color: JACKET }, { at: [0, 0.76, -0.02], r: 0.265, color: JACKET },
    { at: [0, 0.87, 0], r: 0.2, color: JACKET }, { at: [0, 0.94, 0], r: 0.085, color: SKIN },
  ], { budget: 900, sides: 14 }));
  for (let i = 0; i < 4; i++) P.push(prim(new THREE.SphereGeometry(0.016, 6, 4), 0xc9b27a, [-0.1, 0.56 + i * 0.07, -0.29 + Math.abs(i - 1.5) * 0.012], [0, 0, 0], 0)); // brass buttons (to one side: the rents run through the middle)
  rents(P, seed);
  // the broad turned-down collar, its rim bright, the word worked on it
  P.push(prim(new THREE.CylinderGeometry(0.11, 0.26, 0.075, 18, 1, true), COLLAR, [0, 0.905, 0], [0, 0, 0], 0.04));
  P.push(prim(new THREE.TorusGeometry(0.255, 0.012, 4, 18).rotateX(Math.PI / 2), COLLAR, [0, 0.868, 0], [0, 0, 0], 0.02)); // the rim
  P.push(prim(new THREE.BoxGeometry(0.27, 0.115, 0.012), COLLAR, [0, 0.88, -0.21], [-0.55, 0, 0], 0.04));
  const word = lettering(name.toUpperCase(), 0.072);
  word.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI)).applyMatrix4(new THREE.Matrix4().makeRotationX(-0.55)).translate(0, 0.882, -0.219);
  P.push(word);
  // arms (Dum: one flung out, one along his side; Dee: one up over his head, one fallen across him)
  const arm = (s, elbow, wrist) => {
    P.push(sk([{ at: [s * 0.25, 0.86, 0], r: 0.085, color: JACKET }, { at: elbow, r: 0.068, color: JACKET }, { at: wrist, r: 0.055, color: JACKET }], { sides: 8, budget: 260, caps: ['round', 'open'] }));
    P.push(prim(new THREE.SphereGeometry(0.052, 8, 6).scale(1, 0.75, 1.2), SKIN, [wrist[0] + (wrist[0] - elbow[0]) * 0.35, wrist[1] + (wrist[1] - elbow[1]) * 0.35, wrist[2] + (wrist[2] - elbow[2]) * 0.35], [0, 0, 0], 0.06));
  };
  if (dee) {
    arm(-1, [-0.36, 1.08, 0.04], [-0.3, 1.32, 0.06]);
    arm(1, [0.3, 0.68, -0.24], [0.06, 0.6, -0.33]);
  } else {
    arm(1, [0.47, 0.82, 0.03], [0.68, 0.72, 0.0]);
    arm(-1, [-0.33, 0.68, 0.05], [-0.31, 0.5, -0.04]);
  }
  // the round head (a man's proportion), a little turned, the face slack, the eyes shut
  const head = [];
  head.push(sk([
    { at: [0, 0.95, 0], r: 0.075, color: SKIN }, { at: [0, 1.02, -0.01], r: 0.16, color: SKIN }, { at: [0, 1.12, -0.005], r: 0.19, color: SKIN },
    { at: [0, 1.23, 0], r: 0.175, color: SKIN }, { at: [0, 1.31, 0.01], r: 0.1, color: SKIN },
  ], { budget: 800, sides: 14, caps: ['open', 'round'] }));
  for (const s of [-1, 1]) {
    head.push(prim(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 0.7, 0.3), CHEEK, [s * 0.1, 1.07, -0.168], [0, s * 0.45, 0], 0.06)); // the round cheeks, gone grey
    head.push(prim(new THREE.BoxGeometry(0.055, 0.009, 0.012), 0x4a3a32, [s * 0.065, 1.145, -0.183], [0, s * 0.3, s * 0.1], 0)); // shut lids
    head.push(prim(new THREE.BoxGeometry(0.05, 0.008, 0.01), 0x6a5a4c, [s * 0.065, 1.18, -0.178], [0, s * 0.3, -s * 0.12], 0)); // brows
    head.push(prim(new THREE.SphereGeometry(0.035, 8, 6).scale(0.5, 1, 0.8), SKIN, [s * 0.19, 1.13, 0], [0, 0, 0], 0.05)); // ears
  }
  head.push(prim(new THREE.SphereGeometry(0.024, 8, 6), 0xd6b6a0, [0, 1.095, -0.192], [0, 0, 0], 0.05)); // the nose
  head.push(prim(new THREE.SphereGeometry(0.026, 8, 6).scale(1.3, 0.5, 0.4), 0x2a1410, [0, 1.025, -0.17], [0, 0, 0], 0)); // the mouth fallen a little open
  head.push(prim(new THREE.BoxGeometry(0.014, 0.05, 0.008), SCAB, [0.02, 0.995, -0.168], [0.3, 0, 0.1], 0.1)); // a thin dried line from it
  head.push(prim(new THREE.SphereGeometry(0.028, 8, 6).scale(1, 0.8, 0.35), SCAB, [dee ? 0.13 : -0.13, 1.21, -0.115], [0, dee ? 0.8 : -0.8, 0], 0.12)); // a small dark wound at the temple
  // (both caps knocked off: buildTweedles lays them on the ground)
  const hg = S.merge(head);
  hg.translate(0, -0.95, 0).scale(0.84, 0.84, 0.84).translate(0, 0.95, 0); // a man's head, not a doll's
  hg.translate(0, -1.0, 0).rotateY(dee ? 0.35 : -0.3).rotateX(dee ? 0.08 : -0.1).translate(0, 1.0, 0);
  P.push(hg);
  const body = S.merge(P);
  // a man's legs: below the hip (y 0.52) a quarter longer, the rest raised with them
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y < 0.52 ? y * 1.25 : y + 0.13); }
  body.scale(SIZE, SIZE, SIZE);
  body.computeVertexNormals();
  return { body, cap: cap(0) };
}

/** Lays a geometry on the ground in its frame: its lowest point at y `sink` below 0, its boots' end at z 0. */
function ground(g, sink) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(0, -b.min.y - sink, -b.min.z);
  return g;
}

/**
 * buildTweedles({ seed }) -> { dum, dee }: each brother's geometry, laid in his own frame (boots at
 * z 0, head toward +z, the ground y 0), with the dried blood pooled under him and, by Dum's head,
 * his cap.
 */
export function buildTweedles({ seed = 1 } = {}) {
  // Dum on his back, the flung arm to his left (+x)
  const a = standing('dum', seed);
  const dum = a.body.rotateX(Math.PI / 2); // the front faces up, the head toward +z
  ground(dum, 0.03);
  const dumCap = a.cap.scale(SIZE, SIZE, SIZE).rotateX(Math.PI * 0.9).translate(0, 0, 0);
  dumCap.computeBoundingBox();
  const cb = dumCap.boundingBox;
  dumCap.translate(-0.62 - (cb.min.x + cb.max.x) / 2, -cb.min.y - 0.02, 1.62 - (cb.min.z + cb.max.z) / 2); // fallen on its crown beside his head
  // Dee on his side, half turned toward his brother (his front toward -x), his knee drawn up
  const b = standing('dee', seed + 3);
  const dee = b.body.rotateX(Math.PI / 2).rotateZ(1.3);
  ground(dee, 0.04);
  const deeCap = b.cap.scale(SIZE, SIZE, SIZE).rotateX(Math.PI * 0.6).rotateZ(0.9);
  deeCap.computeBoundingBox();
  const db = deeCap.boundingBox;
  deeCap.translate(-0.62 - (db.min.x + db.max.x) / 2, -db.min.y - 0.02, 0.62 - (db.min.z + db.max.z) / 2); // rolled away, by his drawn-up knee
  return {
    dum: S.merge([dum, dumCap, pool(0.18, 0.95, 0.62, 2, 0.9), pool(-0.08, 1.5, 0.36, 3.7)]),
    dee: S.merge([dee, deeCap, pool(-0.38, 0.95, 0.58, 5, 1.1), pool(-0.2, 1.45, 0.3, 6.7)]),
  };
}
