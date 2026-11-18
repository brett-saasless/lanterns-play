// The road's pass-3 additions and the werewolf cutaway (issue #29; the owner, pass 3: "add one
// more boulder 1/2 the size of the large boulder ... a hybrid creature ... it could look like a
// werwolf-beefeater"; and 2026-11-18: "show the werewolf face, the same one as in the painting, in a
// zoomed-in cutaway, then have the entire scene of him running up the hill ... through the open
// castle doors and the one armour guard that fights the player closing the door after the werewolf
// goes in"). Drawn here, placed by the logic, writing nothing back:
//   - the second boulder (logic/road.js BOULDER_SMALL, boulderSmallAt): the large one's stone,
//     half its size, rolling the same way a beat behind it;
//   - the werewolf-beefeater (logic/cutaway.js cutawayAt): a werewolf in what is left of a Yeoman
//     Warder's Tudor state dress, hunched, too big, a weathered Tudor red with a dulled gold trim,
//     a soiled ruff, the flat bonnet with its ears through it, long furred arms ending in claws like
//     the painting's arm. Its head is made for the cutaway's close-up: the werewolf painting's face
//     (keepcast.js paintWerewolf) in the round: yellow almond eyes under a dark slash of brow, a
//     long muzzle with a black nose, the jaw open on a row of teeth with two long canines, tall
//     pointed ears up through the bonnet. Seen only while the cutaway plays (the old look-up
//     glimpse is retired: its body is this one);
//   - the rubble: the small rocks that come to rest where the boulder came down (the cutaway's
//     first beat, then lying there for good);
//   - the cutaway's staged set (the design's call): a stretch of hillside, the gate in a length of
//     the castle's own ashlar wall, its two oak leaves, and the castle's one fighting armour (its
//     own cuirass, helm, pike and claw, keepcast.js armourStill), far up out of the way of
//     everything else (CUTAWAY.set) and drawn only while the run beat plays.
//
// Cheap: no texture of its own (the wall takes stone.js's shared ashlar), no shadow, nothing
// allocated a frame. While nothing plays: the second boulder (during its fall) and the rubble
// (one instanced mesh). While the cutaway plays: the creature (body, limbs, eyes); on the set the
// ground, the wall, the dark inside, two leaves and the guard (two). Nothing here collides.
//
// roadview.js builds it into its group and calls update() once a frame:
//   const extra = createRoadCreature(group, { ground, bark }); // in createRoadView
//   extra.update(inRun ? sim : null, dt, time, outside);       // in its update()

import * as THREE from 'three';
import * as S from './sculpt.js';
import * as ST from './stone.js';
import { boulderSmallAt, BOULDER_SMALL, BOULDER_THUD, BOULDER_DIR, boulderAt } from '../logic/road.js';
import { CUTAWAY, cutawayAt, setGround } from '../logic/cutaway.js';
import { hillAt } from './roadview.js'; // read at call time only (roadview.js imports this file)
import { armourStill } from './keepcast.js'; // the fighting suit, still (read at call time only)

const STONE = 0x6a645b; // the large boulder's (roadview.js boulderGeometry)
const TUDOR = 0x7a2224; // the state dress's scarlet, gone dark and dull
const TRIM = 0x9c7a3c; // its gold lace, tarnished (keepcast.js GILT)
const FUR = 0x4f443a;
const FUR_DARK = 0x463b33;
const MUZZLE = 0x5b4d41; // the painting's muzzle, a shade over the head's fur
const RUFF = 0x9e937c; // once white
const BONNET = 0x463f4c; // the flat black velvet hat, weathered to a grey
const CLAW = 0x8a8070;
const EYE = 0xd9b23a; // the painting's yellow (paintWerewolf), unlit
const BROW = 0x1c1614; // the painting's dark slash over each eye
const PUPIL = 0x120a04; // the painting's iris
const NOSE = 0x241e1c;
const MOUTH = 0x140c0c; // the painting's open mouth
const TOOTH = 0xe6dfc6; // the painting's teeth
const OAK = 0x2d1f15; // castle.js's door leaves
const STRAP = 0x121010;
const BRASS = 0x8a6d36;

/** The second boulder: the large one's icosahedron, noise and tint, at BOULDER_SMALL.r. 80 triangles. */
function smallBoulderGeometry() {
  const g = new THREE.IcosahedronGeometry(BOULDER_SMALL.r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + 0.3 * S.noise(p.getX(i) * 8, p.getY(i) * 8, p.getZ(i) * 8, 22);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  return S.tint(g, STONE, 0.3, 5);
}

/** A cone pointing along -Y from the origin, `len` long: a claw, an ear, a bristle. */
const spike = (r, len, sides, hex, seed) => S.tint(new THREE.ConeGeometry(r, len, sides, 1).deleteAttribute('uv').rotateX(Math.PI).translate(0, -len / 2, 0), hex, 0.15, seed);

/**
 * The body, one draw call: the tunic over a hunched back (front -Z, as sculpt.js), its torn skirt,
 * the mane through the collar, the ruff, the wolf's head with its jaw a little open, ears up
 * through the flat bonnet, two small yellow eyes. Feet at y 0; shoulders about 1.45 m, the
 * bonnet's crown about 1.85.
 */
function bodyGeometry() {
  const seed = 291;
  const parts = [];
  // the tunic: hips to shoulders, leaning hard forward, a tarnished gold belt and chest badge
  parts.push(S.skin([
    { at: [0, 0.92, 0.34], r: [0.27, 0.24] }, { at: [0, 1.12, 0.12], r: [0.31, 0.28] },
    { at: [0, 1.33, -0.16], r: [0.37, 0.33] }, { at: [0, 1.44, -0.4], r: [0.4, 0.28] },
    { at: [0, 1.5, -0.6], r: [0.16, 0.15], color: FUR },
  ], {
    seed, sides: 7, detail: 2, budget: 160, caps: ['flat', 'flat'], noise: 0.08, rough: 0.06, color: TUDOR, mottle: 0.14, shade: 0.12,
    colorAt(u, a, c) {
      const front = Math.cos(a) > 0.75; // the belly side (the spine leans forward)
      if (u > 0.3 && u < 0.45) c.setHex(TRIM); // the belt
      else if (front && u > 0.55 && u < 0.72) c.setHex(TRIM); // what is left of the badge
    },
  }));
  // the skirt: open below, torn, its hem's gold lace trailing behind the hips
  {
    const g = new THREE.CylinderGeometry(0.29, 0.44, 0.5, 9, 3, true).deleteAttribute('uv');
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const red = new THREE.Color(TUDOR); const gold = new THREE.Color(TRIM); const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const hem = p.getY(i) < -0.24;
      if (hem) { // tatters: ragged in length and in reach
        const n = S.noise(p.getX(i) * 6, 0, p.getZ(i) * 6, seed + 1);
        p.setY(i, p.getY(i) + 0.09 * n);
        p.setX(i, p.getX(i) * (1 + 0.12 * n));
      }
      c.copy(hem ? gold : red).multiplyScalar(1 + 0.12 * S.noise(p.getX(i) * 9, p.getY(i) * 9, p.getZ(i) * 9, seed + 2));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.rotateX(-0.35).translate(0, 0.74, 0.38));
  }
  // the great back (the painting's): a furred hump above the shoulders, a ragged mane along it
  parts.push(S.tint(new THREE.IcosahedronGeometry(0.3, 0).deleteAttribute('uv').scale(1.2, 0.8, 1.3).translate(0, 1.58, -0.2), FUR, 0.2, seed + 3));
  for (let i = 0; i < 3; i++) {
    parts.push(spike(0.06, 0.26, 3, FUR_DARK, seed + 4 + i).rotateX(Math.PI - 0.7).translate(0, 1.76 - i * 0.05, -0.32 + i * 0.17));
  }
  // the ruff: a soiled, crushed ring round the neck
  {
    const g = new THREE.TorusGeometry(0.19, 0.07, 3, 8).deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.18 * S.noise(p.getX(i) * 14, p.getY(i) * 14, p.getZ(i) * 14, seed + 7);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    parts.push(S.tint(g.rotateX(Math.PI / 2 - 0.6).translate(0, 1.5, -0.57), RUFF, 0.2, seed + 7));
  }
  parts.push(...headParts(seed));
  return S.merge(parts);
}

/**
 * One limb, hanging from its joint at the origin along -Y, one unit long (the instance's scale
 * makes it an arm or a leg): the sleeve or the breeches' torn red, fur below, the paw forward at
 * the end with three long claws, as the painting's arm. Shared by all four (one draw call).
 */
function limbGeometry() {
  const seed = 377;
  const parts = [S.skin([
    { at: [0, 0.04, 0], r: 0.13, color: TUDOR }, { at: [0, -0.3, 0.03], r: 0.115, color: TUDOR },
    { at: [0, -0.4, 0.05], r: 0.1 }, { at: [0, -0.62, 0.04], r: 0.085 },
    { at: [0, -0.86, -0.01], r: 0.06, color: FUR_DARK }, { at: [0, -0.95, -0.07], r: 0.075, color: FUR_DARK },
  ], { seed, sides: 6, detail: 1, caps: ['flat', 'flat'], noise: 0.1, rough: 0.3, color: FUR, mottle: 0.15, shade: 0.12 })];
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.32;
    parts.push(spike(0.02, 0.17, 3, CLAW, seed + i).rotateX(-0.95).rotateY(a).translate(Math.sin(a) * 0.05, -0.97, -0.1));
  }
  return S.merge(parts);
}

// The limbs' joints in the body's frame, their reach (the instance scale) and splay.
const LIMBS = [
  { at: [-0.37, 1.42, -0.42], scale: [1, 1.32, 1], splay: -0.14, arm: true, phase: 0.25 }, // arms: long, reaching down past the knees
  { at: [0.37, 1.42, -0.42], scale: [1, 1.32, 1], splay: 0.14, arm: true, phase: 0 },
  { at: [-0.2, 0.96, 0.32], scale: [1.25, 1.0, 1.25], splay: -0.06, arm: false, phase: 0.5 }, // legs: thick, bounding
  { at: [0.2, 0.96, 0.32], scale: [1.25, 1.0, 1.25], splay: 0.06, arm: false, phase: 0 },
];
const SIZE = 1.15; // a head taller than a man, were it to stand

// ---- the head, for the close-up -------------------------------------------------------------------

/**
 * The werewolf painting's face in the round (keepcast.js paintWerewolf), in the body's frame (front
 * -Z): the skull, the long muzzle a shade lighter, the black nose, the jaw open on its teeth (the
 * two long canines), the dark slashes of brow over the eyes (outer end high, inner end low, as
 * painted), pupils, the tall pointed ears splayed up and out through the bonnet, cheek tufts, the
 * askew Tudor bonnet. The eyes' yellow is separate (headEyes): unlit, so they read at dusk.
 */
function headParts(seed) {
  const parts = [];
  // the skull, then the muzzle running out from it, the nose at its tip
  parts.push(S.skin([
    { at: [0, 1.6, -0.62], r: [0.13, 0.14] }, { at: [0, 1.65, -0.74], r: [0.17, 0.165] }, { at: [0, 1.64, -0.85], r: [0.155, 0.14] },
    { at: [0, 1.59, -0.93], r: [0.105, 0.085], color: MUZZLE }, { at: [0, 1.565, -1.03], r: [0.08, 0.065], color: MUZZLE }, { at: [0, 1.55, -1.11], r: [0.06, 0.05], color: MUZZLE },
  ], { seed: seed + 8, sides: 12, detail: 2, budget: 260, caps: ['flat', 'round'], capLen: 0.4, noise: 0.05, rough: 0.12, color: FUR, mottle: 0.12, shade: 0.14 }));
  parts.push(S.tint(new THREE.SphereGeometry(0.026, 8, 6).deleteAttribute('uv').scale(1.3, 0.8, 1).translate(0, 1.572, -1.14), NOSE, 0.1, seed + 20));
  // the jaw, hanging open, the dark of the mouth between
  parts.push(S.skin([{ at: [0, 1.49, -0.84], r: [0.085, 0.045] }, { at: [0, 1.455, -0.98], r: [0.065, 0.032] }, { at: [0, 1.44, -1.07], r: [0.048, 0.024] }],
    { seed: seed + 9, sides: 8, detail: 1, caps: ['flat', 'round'], noise: 0.05, color: FUR_DARK, mottle: 0.1, shade: 0.1 }));
  parts.push(S.tint(new THREE.SphereGeometry(1, 10, 6).deleteAttribute('uv').scale(0.062, 0.032, 0.11).translate(0, 1.485, -0.98), MOUTH, 0.05, seed + 21));
  // the teeth: a row along the upper jaw's front, the second each side long; a few below
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.34;
    const len = Math.abs(i) === 2 ? 0.052 : 0.024;
    parts.push(spike(0.008 + (Math.abs(i) === 2 ? 0.004 : 0), len, 4, TOOTH, seed + 30 + i).translate(Math.sin(a) * 0.052, 1.51, -1.085 + 0.06 * (1 - Math.cos(a))));
  }
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    const a = i * 0.4;
    parts.push(spike(0.007, Math.abs(i) === 2 ? 0.034 : 0.018, 4, TOOTH, seed + 40 + i).rotateX(Math.PI).translate(Math.sin(a) * 0.04, 1.458, -1.05 + 0.05 * (1 - Math.cos(a))));
  }
  for (const sx of [-1, 1]) {
    // the brow: a dark slash, its outer end high and its inner end low, over each eye
    parts.push(S.tint(new THREE.SphereGeometry(1, 8, 4).deleteAttribute('uv').scale(0.05, 0.011, 0.03).rotateZ(sx * 0.5).translate(sx * 0.072, 1.692, -0.905), BROW, 0.05, seed + 50));
    // the pupil: a dark slit over the yellow
    parts.push(S.tint(new THREE.BoxGeometry(0.006, 0.022, 0.004).deleteAttribute('uv').translate(sx * 0.068, 1.657, -0.951), PUPIL, 0, 0));
    // the ears: tall, pointed, up and out through the bonnet, a little back; a paler hollow inside
    parts.push(spike(0.062, 0.36, 5, FUR_DARK, seed + 10 + sx).rotateX(Math.PI).rotateX(0.12).rotateZ(-sx * 0.3).translate(sx * 0.11, 1.74, -0.72));
    parts.push(spike(0.034, 0.25, 4, 0x6a5246, seed + 12 + sx).rotateX(Math.PI).rotateX(0.12).rotateZ(-sx * 0.3).translate(sx * 0.11, 1.75, -0.748));
    // ragged tufts of cheek fur, swept back
    for (let k = 0; k < 3; k++) {
      const d = new THREE.Vector3(sx * 0.6, -0.25 - 0.15 * k, 0.75).normalize();
      const g = spike(0.025, 0.12 - 0.02 * k, 3, FUR_DARK, seed + 60 + k + sx);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d));
      parts.push(g.translate(sx * 0.13, 1.6 - 0.04 * k, -0.8 + 0.03 * k));
    }
  }
  // the Tudor bonnet: a flat crown on a broad brim, askew, the ears through it
  const askew = (g) => g.rotateX(0.12).rotateZ(0.1).translate(0.01, 1.79, -0.74);
  parts.push(askew(S.tint(new THREE.CylinderGeometry(0.17, 0.19, 0.08, 10).deleteAttribute('uv').translate(0, 0.05, 0), BONNET, 0.15, seed + 12)));
  parts.push(askew(S.tint(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 12).deleteAttribute('uv'), BONNET, 0.15, seed + 13)));
  return parts;
}

/** The two yellow eyes: almond shapes, the outer corner low as painted (an unlit material). */
const EYE_Y = 1.655; // the eyes' line in the body's frame
function headEyes() {
  return S.merge([-1, 1].map((sx) => S.tint(new THREE.SphereGeometry(0.02, 10, 6).deleteAttribute('uv').scale(1.5, 0.7, 0.6).rotateZ(-sx * 0.3).translate(sx * 0.07, 1.655, -0.935), EYE, 0, 0)));
}

// ---- the rubble ---------------------------------------------------------------------------------

// The rocks that come to rest where the boulder came down: `along` the road from the bound
// (+ on ahead), `across` it (+ downhill), radius r, rolling in from `roll` metres off over `dur`
// seconds after `delay` (seconds into the film): most settle early, two pebbles roll in last, in
// the dust beat's final second (the art critic: fragments, not a handful of gravel).
const RUBBLE = Object.freeze([
  { along: -0.4, across: 0.3, r: 0.18, roll: [0.5, 0.7], delay: 0, dur: 1.6 }, { along: 0.6, across: -0.5, r: 0.13, roll: [0.6, -0.3], delay: 0, dur: 1.4 },
  { along: 1.3, across: 0.6, r: 0.26, roll: [0.4, 0.9], delay: 0, dur: 1.8 }, { along: 0.1, across: 1.2, r: 0.11, roll: [0.2, 0.8], delay: 0.2, dur: 1.5 },
  { along: -1.1, across: -0.2, r: 0.15, roll: [-0.3, 0.5], delay: 0, dur: 1.7 }, { along: 2.0, across: 0.1, r: 0.1, roll: [0.7, 0.2], delay: 0.3, dur: 1.4 },
  { along: 0.9, across: 1.6, r: 0.22, roll: [0.3, 0.6], delay: 0, dur: 1.9 }, { along: 2.6, across: -0.3, r: 0.32, roll: [0.4, 0.3], delay: 0, dur: 1.2 },
  { along: -0.2, across: -0.9, r: 0.28, roll: [0.2, -0.4], delay: 0, dur: 1.3 }, { along: 1.7, across: 1.1, r: 0.09, roll: [1.6, 1.4], delay: 1.5, dur: 1.0 },
  { along: 0.3, across: 0.7, r: 0.08, roll: [-1.4, 1.2], delay: 1.7, dur: 0.85 },
]);

/**
 * A material's warm lift and rim (the cutaway's light on its figures, the art critic: the face lit
 * against the dark, a torch's edge on the guard): its own vertex colour times uLift added, and a
 * rim of uRim at its grazing edges. No light is added to the scene (no program for the rest
 * changes). Returns the two uniforms.
 */
function lifted(mat, key) {
  const u = { uLift: { value: new THREE.Color(0, 0, 0) }, uRim: { value: new THREE.Color(0, 0, 0) } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = u.uLift;
    sh.uniforms.uRim = u.uRim;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLift;\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { float rimK = 1.0 - clamp(normal.z, 0.0, 1.0); totalEmissiveRadiance += vColor * uLift + uRim * rimK * rimK * rimK * rimK; }');
  };
  mat.customProgramCacheKey = () => key;
  return u;
}
const WARM_LIFT = new THREE.Color(1.0, 0.78, 0.55); // the low sun's warmth on the fur, a share added to it
const WARM_RIM = new THREE.Color(1.0, 0.55, 0.25); // the sunset at its edges
const TORCH = new THREE.Color(0.9, 0.45, 0.18); // a torch in the passage, on the guard's edges

// ---- the staged set -------------------------------------------------------------------------------

/** The set's hillside: a strip up to the gate, a rutted track up its middle, a flagged floor inside. */
function setGroundGeometry() {
  const S0 = CUTAWAY.set;
  const xs = []; for (let x = -16; x <= 16; x += 1) xs.push(x);
  const zs = []; for (let z = -6; z <= 28; z += 1) zs.push(z);
  const nx = xs.length; const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3); const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color(); const grass = new THREE.Color(0x403d31); const dirt = new THREE.Color(0x584c3e); const flag = new THREE.Color(0x3a3734);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i]; const z = zs[j];
      const k = (j * nx + i) * 3;
      const bump = z > 0.8 ? 0.12 * S.noise(x * 0.5, 0, z * 0.5, 71) : 0;
      pos[k] = S0.x + x; pos[k + 1] = S0.y + setGround(z) + bump; pos[k + 2] = S0.z + z;
      if (z <= 0) c.copy(flag);
      else c.copy(grass).lerp(dirt, 1 - Math.min(1, Math.max(0, (Math.abs(x) - 1.2) / 1.6)));
      c.multiplyScalar(0.85 + 0.25 * S.noise(x * 0.4, 3, z * 0.4, 73));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i; const b = a + 1; const cc = a + nx; const d = cc + 1;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WALL_T = 1.2; // the gate wall's thickness
const HINGE_Z = 0.35; // the leaves hang just inside the wall's outer face, and swing in

/** The gate's wall: a length of the castle's ashlar with the pointed doorway through it, a plinth either side. */
function setWallGeometry() {
  const S0 = CUTAWAY.set; const D = S0.door;
  const half = 12;
  const wall = ST.wall({ from: [S0.x - half, S0.z], to: [S0.x + half, S0.z], y0: S0.y - 0.02, y1: S0.y + S0.wallH + 3, t: WALL_T,
    openings: [{ at: half, w: D.w, h: D.h }], hex: 0xd9dbde, vary: 0.08, seed: 5 });
  const plinth = [-1, 1].map((sd) => ST.block(S0.x + sd * (half + D.w / 2 + 0.3) / 2, S0.y - 1.2, S0.z + WALL_T / 2 + 0.1, half - D.w / 2 - 0.3, 1.45, 0.5, 0xc9cbce, 0.08));
  const sill = ST.block(S0.x, S0.y - 0.6, S0.z + WALL_T / 2 + 0.2, D.w + 0.4, 0.62, 0.7, 0xc9cbce, 0.06); // the threshold's step
  return S.merge([wall, ...plinth, sill]);
}

/**
 * One door leaf, hung at its hinge (the origin) and running +x, its top cut to the pointed arch:
 * oak boards, three iron straps, the seams between the boards, the ring. A castle.js leaf's look.
 */
function leafGeometry() {
  const D = CUTAWAY.set.door;
  const w = D.w - 0.06; const half = w / 2;
  const rise = D.w * 0.62; const spring = D.h - rise;
  const arch = ST.archPoints(w, rise, 8); // left springing, over the point, to the right springing
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(half, 0); shape.lineTo(half, spring + rise);
  for (let i = Math.floor(arch.length / 2) - 1; i >= 0; i--) shape.lineTo(arch[i][0] + half, spring + arch[i][1]);
  shape.lineTo(0, 0);
  const board = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false, curveSegments: 1 });
  board.deleteAttribute('uv');
  board.translate(0, 0, -0.045);
  const parts = [S.tint(board, OAK, 0.25, 81)];
  const n = 7;
  for (let i = 1; i < n; i++) { // the seams, front and back, as high as the board goes there
    const x = (i / n) * half;
    const top = spring + rise * Math.sqrt(Math.max(0, 1 - ((half - x) / half) ** 2)) * 0.98;
    for (const z of [-0.048, 0.048]) parts.push(S.tint(new THREE.BoxGeometry(0.012, top, 0.006).deleteAttribute('uv').translate(x, top / 2, z), 0x1a120c, 0.1, i));
  }
  for (const y of [0.4, spring * 0.55, spring - 0.1]) for (const z of [-0.06, 0.06]) parts.push(S.tint(new THREE.BoxGeometry(half - 0.04, 0.1, 0.02).deleteAttribute('uv').translate(half / 2, y, z), STRAP, 0.1, y));
  parts.push(S.tint(new THREE.TorusGeometry(0.09, 0.016, 5, 10).deleteAttribute('uv').translate(half - 0.22, spring * 0.48, 0.075), BRASS, 0.1, 3));
  return S.merge(parts);
}

/** The dark of the gate passage behind the doors: a black hall, swallowing the light. */
function insideGeometry() {
  const S0 = CUTAWAY.set;
  return new THREE.PlaneGeometry(10, 16).translate(S0.x, S0.y + 6, S0.z - 4.6);
}

/**
 * Builds the second boulder, the rubble, the werewolf-beefeater and the cutaway's set into `group`
 * (roadview.js's road group). mats: roadview.js's { ground, bark } (the land's and the stones'
 * materials, with their evening lift). Returns { update(sim, dt, time, outside), meshes, set }.
 */
export function createRoadCreature(group, mats = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const quiet = (m) => { m.castShadow = false; m.receiveShadow = false; return m; };

  const stone = quiet(new THREE.Mesh(smallBoulderGeometry(), mat));
  stone.name = 'road:boulder2';
  stone.visible = false;
  group.add(stone);

  // the rubble where the boulder came down
  const rubble = quiet(new THREE.InstancedMesh(S.tint(new THREE.DodecahedronGeometry(1, 0).deleteAttribute('uv'), 0x655f57, 0.3, 9), mats.bark || mat, RUBBLE.length));
  rubble.name = 'road:rubble';
  rubble.visible = false;
  rubble.frustumCulled = false;
  group.add(rubble);

  // the werewolf-beefeater
  const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const furLight = lifted(furMat, 'road-werewolf-lift');
  const rig = new THREE.Group();
  rig.name = 'road:werewolf';
  rig.visible = false;
  rig.rotation.order = 'YXZ'; // its heading outermost, then its lean
  rig.scale.setScalar(SIZE);
  const body = quiet(new THREE.Mesh(bodyGeometry(), furMat));
  const limbs = quiet(new THREE.InstancedMesh(limbGeometry(), furMat, LIMBS.length));
  limbs.frustumCulled = false; // its instances move every frame; the rig is small and brief
  // the eyes: unlit and out of the tone mapping, so they glow faintly in the dusk (the critic)
  const eyes = quiet(new THREE.Mesh(headEyes(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  rig.add(body, limbs, eyes);
  group.add(rig);

  // the staged set: built once, drawn only while the run beat plays
  const set = new THREE.Group();
  set.name = 'road:cutaway-set';
  set.visible = false;
  set.add(quiet(new THREE.Mesh(setGroundGeometry(), mats.ground || mat)));
  set.add(quiet(new THREE.Mesh(setWallGeometry(), ST.stoneMaterial('ashlar'))));
  set.add(quiet(new THREE.Mesh(insideGeometry(), new THREE.MeshBasicMaterial({ color: 0x050404 }))));
  const leafGeo = leafGeometry();
  const leafMirror = leafGeo.clone().scale(-1, 1, 1);
  leafMirror.index.array.reverse();
  const S0 = CUTAWAY.set;
  const leaves = [1, -1].map((sd) => { // [0] the right leaf (hinged at +x), [1] the left
    const hinge = new THREE.Group();
    hinge.position.set(S0.x + sd * (S0.door.w / 2 - 0.03), S0.y, S0.z + HINGE_Z);
    hinge.add(quiet(new THREE.Mesh(sd > 0 ? leafMirror : leafGeo, mat)));
    set.add(hinge);
    return { hinge, sign: sd > 0 ? -1 : 1 };
  });
  const still = armourStill();
  const guard = new THREE.Group();
  guard.name = 'road:cutaway-guard';
  const plateMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
  const plateLight = lifted(plateMat, 'road-guard-lift');
  plateLight.uLift.value.copy(TORCH).multiplyScalar(0.22);
  plateLight.uRim.value.copy(TORCH).multiplyScalar(0.25);
  guard.add(quiet(new THREE.Mesh(still.body, plateMat)));
  const guardLegs = still.legs.map((l) => {
    const m = quiet(new THREE.Mesh(l.geo, plateMat));
    m.position.set(l.hip[0], l.hip[1], l.hip[2]);
    guard.add(m);
    return m;
  });
  guard.add(quiet(new THREE.Mesh(still.glints, new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false, fog: false }))));
  guard.visible = false;
  set.add(guard);
  group.add(set);

  const _b = {};
  const _l = {};
  const cut = {}; // cutawayAt's output, reused every frame
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  /** The rubble `T` seconds into the film (Infinity: at rest), about where the boulder bounded at crossX. */
  function placeRubble(crossX, T) {
    const L = boulderAt(BOULDER_THUD, crossX, _l);
    for (let i = 0; i < RUBBLE.length; i++) {
      const R = RUBBLE[i];
      const k = Math.min(1, Math.max(0, (T - R.delay) / R.dur));
      const e = k * (2 - k); // eased in: quick, then coming to rest
      const x = L.x + BOULDER_DIR * (R.along + R.roll[0] * (1 - e));
      const z = L.z + R.across + R.roll[1] * (1 - e);
      const hop = 0.25 * Math.abs(Math.sin(k * 9 + i)) * (1 - k) * (1 - k);
      const spin = (1 - e) * 6 + i;
      _m.compose(_p.set(x, hillAt(x, z) + R.r * 0.55 + hop, z), _q.setFromEuler(_e.set(spin, i * 1.3, spin * 0.5)), _s.set(R.r, R.r * 0.7, R.r));
      rubble.setMatrixAt(i, _m);
    }
    rubble.instanceMatrix.needsUpdate = true;
  }

  let rubbleK = -2; let rubbleX = null; // where the rubble was last placed
  /** Once a frame. sim: the castle run (null when none plays); outside: the outside is on screen. */
  function update(sim, dt, time, outside) {
    const road = sim && sim.waves ? sim.waves.road : null;
    const sc = sim && sim.waves && sim.waves.scene && sim.waves.scene.kind === 'cutaway' ? sim.waves.scene : null;

    // ---- the second boulder: with the large one, a beat behind it ----
    const b = road && road.boulder;
    stone.visible = !!b && b.state === 'falling' && !!outside;
    if (stone.visible) {
      boulderSmallAt(b.t, b.x, _b);
      stone.position.set(_b.x, _b.y, _b.z);
      stone.rotation.set(_b.spin, _b.spin * 0.3, 0);
    }

    // ---- the cutaway ----
    if (sc) cutawayAt(sc.t, sc, cut);
    // the rubble: settling in the dust beat, then lying where it came to rest for good
    const landed = !!road && !!b && b.x != null && road.cutaway && road.cutaway.state !== 'ready' && road.cutaway.state !== 'due';
    rubble.visible = landed && !!outside;
    if (rubble.visible) {
      const k = sc && cut.rubbleT < 4 ? cut.rubbleT : Infinity;
      if (k !== rubbleK || b.x !== rubbleX) { placeRubble(b.x, k); rubbleK = k; rubbleX = b.x; } // at rest: placed once
    }

    set.visible = !!sc && !!outside && cut.set;
    rig.visible = !!sc && !!outside && cut.creature.where !== 'gone';
    if (set.visible) {
      for (let i = 0; i < 2; i++) leaves[i].hinge.rotation.y = leaves[i].sign * (Math.PI / 2) * cut.door[i];
      const G = cut.guard;
      guard.visible = G.show;
      // it steps: the legs swing from the hips, the body bobs and rolls a little on each stride
      const sw = G.walk ? Math.sin(G.stride) : 0;
      guard.position.set(G.x, S0.y + 0.03 * Math.abs(sw), G.z);
      guard.rotation.set(0, G.heading, 0.04 * sw);
      guardLegs[0].rotation.x = 0.45 * sw;
      guardLegs[1].rotation.x = -0.45 * sw;
    }
    // the warm light on the creature: none on the road beat, full on the close-up, some on the set
    furLight.uLift.value.copy(WARM_LIFT).multiplyScalar(0.05 * (sc ? cut.light : 0));
    furLight.uRim.value.copy(WARM_RIM).multiplyScalar(0.06 * (sc ? cut.light : 0));
    if (!rig.visible) return;
    const cr = cut.creature;
    const ph = cr.stride;
    if (cr.where === 'bank') {
      // standing on the bank where the boulder let go, hunched, breathing, looking down at the road
      const ground = hillAt(cr.x, cr.z);
      const br = Math.sin(cr.breathe * 2.3);
      rig.position.set(cr.x, ground + 0.012 * br, cr.z);
      rig.rotation.set(0.015 * br, cr.heading, 0);
      // a slow blink: the lids close over the yellow (the eyes squash about their own line)
      const open = 1 - 0.92 * cr.blink;
      eyes.scale.y = open;
      eyes.position.y = EYE_Y * (1 - open);
    } else {
      // the lope up the set's hill
      const lean = 0.5 * Math.atan(CUTAWAY.set.slope);
      rig.position.set(cr.x, cr.y + 0.07 * SIZE * Math.abs(Math.sin(ph)), cr.z);
      rig.rotation.set(lean + 0.07 * Math.sin(ph), cr.heading, 0.03 * Math.sin(ph * 0.5));
    }
    const run = cr.pose === 'run' ? 1 : 0;
    for (let i = 0; i < LIMBS.length; i++) {
      const L = LIMBS[i];
      // the lope: the long arms reach and pull as the legs drive; standing, the arms hang forward
      const swing = run ? (L.arm ? 0.5 + 0.75 * Math.sin(ph + Math.PI + L.phase) : -0.15 + 0.65 * Math.sin(ph + L.phase))
        : (L.arm ? 0.35 + 0.04 * Math.sin(cr.breathe * 2.3 + L.phase) : -0.12);
      _e.set(swing, 0, L.splay);
      _m.compose(_p.set(L.at[0], L.at[1], L.at[2]), _q.setFromEuler(_e), _s.set(L.scale[0], L.scale[1], L.scale[2]));
      limbs.setMatrixAt(i, _m);
    }
    limbs.instanceMatrix.needsUpdate = true;
  }

  return { update, meshes: [stone, body, limbs, eyes, rubble], set, rig };
}
