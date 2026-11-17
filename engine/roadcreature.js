// The road's pass-3 additions (issue #29, the owner: "add one more boulder 1/2 the size of the
// large boulder. if the user looks up to the where the boulder came from a hybrid creature runs up
// the hill away from the user and out of sight. it runs up the hill, not up the road it does not
// attack. it could look like a werwolf-beefeater."). Drawn here, placed by the logic:
//   - the second boulder (logic/road.js BOULDER_SMALL, boulderSmallAt): the large one's stone,
//     half its size, rolling the same way a beat behind it;
//   - the glimpse (road.creature, creatureAt): a werewolf in what is left of a Yeoman Warder's
//     Tudor state dress, running away up the hillside on all fours and long arms, over the crest
//     of leg 4's shelf and gone. Hunched, too big, wrong and too still in its colours: a
//     weathered Tudor red with a dulled gold trim, a soiled ruff, the flat bonnet with its ears
//     through it, long furred arms ending in claws like the painting's arm (keepcast.js). Seen
//     from 20 to 40 m at dusk, so it is its silhouette and three colour reads, not detail.
//
// Cheap: three draw calls in all (the boulder, the body, the four limbs as one instanced mesh),
// about 900 triangles, one shared lit material (MeshStandardMaterial, vertex colour, every base
// colour at 25% value or more so the sunset's light reads on it), no texture, no shadow, nothing
// allocated a frame. It has no collision and touches nothing: it is drawn, nothing more.
//
// roadview.js builds it into its group and calls update() once a frame:
//   const extra = createRoadCreature(group);              // in createRoadView
//   extra.update(inRun ? sim : null, dt, time, outside);  // in its update()

import * as THREE from 'three';
import * as S from './sculpt.js';
import { boulderSmallAt, BOULDER_SMALL, creatureAt } from '../logic/road.js';
import { hillAt } from './roadview.js'; // read at call time only (roadview.js imports this file)

const STONE = 0x6a645b; // the large boulder's (roadview.js boulderGeometry)
const TUDOR = 0x7a2224; // the state dress's scarlet, gone dark and dull
const TRIM = 0x9c7a3c; // its gold lace, tarnished (keepcast.js GILT)
const FUR = 0x4f443a;
const FUR_DARK = 0x463b33;
const RUFF = 0x9e937c; // once white
const BONNET = 0x463f4c; // the flat black velvet hat, weathered to a grey
const CLAW = 0x8a8070;
const EYE = 0xb89a3a; // the painting's yellow, unlit
const NOSE = 0x433a36;

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
  // the head: a wolf's, low and forward of the shoulders, the muzzle long, its tip dark
  parts.push(S.skin([
    { at: [0, 1.58, -0.66], r: [0.15, 0.16] }, { at: [0, 1.62, -0.8], r: [0.17, 0.16] },
    { at: [0, 1.57, -0.95], r: [0.1, 0.09] }, { at: [0, 1.52, -1.12], r: [0.055, 0.06], color: NOSE },
  ], { seed: seed + 8, sides: 7, detail: 1, caps: ['flat', 'round'], capLen: 0.5, noise: 0.06, rough: 0.08, color: FUR, mottle: 0.12, shade: 0.12 }));
  // the jaw, hanging a little open
  parts.push(S.skin([{ at: [0, 1.5, -0.8], r: [0.08, 0.05] }, { at: [0, 1.43, -1.04], r: [0.04, 0.03] }],
    { seed: seed + 9, sides: 5, detail: 1, caps: ['flat', 'flat'], noise: 0.05, color: FUR_DARK, mottle: 0.1, shade: 0.1 }));
  // the ears, up through the bonnet and laid back
  for (const sx of [-1, 1]) {
    parts.push(spike(0.06, 0.22, 4, FUR_DARK, seed + 10 + sx).rotateX(Math.PI - 0.35).rotateZ(-sx * 0.25).translate(sx * 0.1, 1.68, -0.74));
  }
  // the eyes: small and yellow, set close under the brow
  for (const sx of [-1, 1]) parts.push(S.tint(new THREE.OctahedronGeometry(0.024, 0).deleteAttribute('uv').translate(sx * 0.075, 1.65, -0.93), EYE, 0, 0));
  // the Tudor bonnet: a flat crown on a broad brim, askew, the ears through it
  const askew = (g) => g.rotateX(0.15).rotateZ(0.22).translate(0.02, 1.77, -0.77);
  parts.push(askew(S.tint(new THREE.CylinderGeometry(0.17, 0.19, 0.08, 8).deleteAttribute('uv').translate(0, 0.05, 0), BONNET, 0.15, seed + 12)));
  parts.push(askew(S.tint(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 8).deleteAttribute('uv'), BONNET, 0.15, seed + 13)));
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

/**
 * Builds the second boulder and the glimpse into `group` (roadview.js's road group). Returns
 * { update(sim, dt, time, outside), meshes } (meshes: the three, for a smoke's counts).
 */
export function createRoadCreature(group) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const quiet = (m) => { m.castShadow = false; m.receiveShadow = false; return m; };

  const stone = quiet(new THREE.Mesh(smallBoulderGeometry(), mat));
  stone.name = 'road:boulder2';
  stone.visible = false;
  group.add(stone);

  const rig = new THREE.Group();
  rig.name = 'road:glimpse';
  rig.visible = false;
  rig.rotation.order = 'YXZ'; // its heading outermost, then its lean up the slope
  rig.scale.setScalar(SIZE);
  const body = quiet(new THREE.Mesh(bodyGeometry(), mat));
  const limbs = quiet(new THREE.InstancedMesh(limbGeometry(), mat, LIMBS.length));
  limbs.frustumCulled = false; // its instances move every frame; the rig is small and brief
  rig.add(body, limbs);
  group.add(rig);

  const _b = {};
  const _c = {};
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();

  /** Once a frame. sim: the castle run (null when none plays); outside: the outside is on screen. */
  function update(sim, dt, time, outside) {
    const road = sim && sim.waves ? sim.waves.road : null;

    // ---- the second boulder: with the large one, a beat behind it ----
    const b = road && road.boulder;
    stone.visible = !!b && b.state === 'falling' && !!outside;
    if (stone.visible) {
      boulderSmallAt(b.t, b.x, _b);
      stone.position.set(_b.x, _b.y, _b.z);
      stone.rotation.set(_b.spin, _b.spin * 0.3, 0);
    }

    // ---- the glimpse: away up the hill, once ----
    const c = road && road.creature;
    rig.visible = !!c && c.state === 'run' && !!outside && c.x != null;
    if (!rig.visible) return;
    creatureAt(c.t, c.x, _c);
    const fx = -Math.sin(_c.heading); const fz = -Math.cos(_c.heading);
    const ground = hillAt(_c.x, _c.z);
    // the slope along its way: it leans into the climb, about half the hill's own fall
    const rise = hillAt(_c.x + fx * 0.8, _c.z + fz * 0.8) - hillAt(_c.x - fx * 0.8, _c.z - fz * 0.8);
    const lean = 0.5 * Math.atan2(rise, 1.6);
    const ph = _c.stride;
    rig.position.set(_c.x, ground - _c.sink + 0.07 * SIZE * Math.abs(Math.sin(ph)), _c.z);
    rig.rotation.set(lean + 0.07 * Math.sin(ph), _c.heading, 0.03 * Math.sin(ph * 0.5));

    // the lope: the long arms reach and pull as the legs drive, out of step a little, side to side
    for (let i = 0; i < LIMBS.length; i++) {
      const L = LIMBS[i];
      const swing = L.arm ? 0.5 + 0.75 * Math.sin(ph + Math.PI + L.phase) : -0.15 + 0.65 * Math.sin(ph + L.phase);
      _e.set(swing, 0, L.splay);
      _m.compose(_p.set(L.at[0], L.at[1], L.at[2]), _q.setFromEuler(_e), _s.set(L.scale[0], L.scale[1], L.scale[2]));
      limbs.setMatrixAt(i, _m);
    }
    limbs.instanceMatrix.needsUpdate = true;
  }

  return { update, meshes: [stone, body, limbs] };
}
