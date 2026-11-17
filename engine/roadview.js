// The road up from the wood (issue #29), drawn from logic/road.js so what is seen is what the rules
// walk on: the hillside south of the castle's approach, the rutted dirt road in its five
// switchbacks, dead trees on the banks leaning in toward it, stones, the wood's edge at the foot,
// the rock the boulder breaks from, the cave in the bank above leg 4, the boulder and its dust, the
// swarm and the one giant bat, and the tunnel the road's foot opens out of (tunnel.js, G29a). And
// the light (logic/roadlight.js; the owner on art-critic pass 2): the foot's sickly low sun in a
// thin haze, grading evenly with sim.waves.road.dark (the one-way ratchet: kept state, never from
// where the warden stands) to the castle's own light at the courtyard entrance by the top, the sun
// low behind the climb and the castle a silhouette against the lighter sky until near the top;
// past the gate castle.js's light, which the top already matches. castle.js builds this into its
// root and calls update() after its own light, so on the road this has the last word on the sky,
// the fog, the fill and the air.
//
// Draw calls on the road: the hill, the road, the trees, the stones, the cave's dark, the wood's
// edge and the sun's disc; while a scare plays, the boulder, its rocks (one instanced mesh) and its
// dust, or the swarm (one instanced mesh) and the giant bat (five). Nothing here casts a shadow (the moon's one shadow map stays
// on the castle's front). No light is added: the castle's own fill, hemisphere and fog are steered.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { buildTunnel } from './tunnel.js';
import { buildRoadSurface, buildRoadProps } from './roadsurface.js'; // the owner: variability along the whole road, a few derelicts
import { createRoadCreature } from './roadcreature.js'; // the second boulder and the glimpse up the bank (P3-6)
import { SET } from './court.js';
import {
  LINE, RECTS, ROAD, LENGTH, stationAt, pointAt, heightAt, onRoad, boulderAt, boulderRockAt, BOULDER_ROCKS, BATS_X, BATS_DIR, BOULDER_X, BOULDER_DIR,
  SWARM_GUSTS, GIANT_FLAP,
} from '../logic/road.js';
import { roadLight, COURTYARD, KEY_RAISE, along, lum } from '../logic/roadlight.js';

// The colour script: the sun stands SSW (azimuth 200 degrees; north is -z, east +x), low behind
// the climbing warden on every leg and never in the forward view, at the keyframes' height.
const UP = new THREE.Vector3(0, 1, 0);
const SUN_AZ = (200 * Math.PI) / 180;
/** The direction to the sun at `elevDeg` degrees (into out). */
function sunToward(elevDeg, out) {
  const e = (elevDeg * Math.PI) / 180;
  return out.set(Math.sin(SUN_AZ) * Math.cos(e), Math.sin(e), -Math.cos(SUN_AZ) * Math.cos(e));
}
// The moon over the castle on the climb (the owner: "if the moon is in the sky above the castle
// the sky will have a natural lightness to contrast with the dark castle roof"): north, a little
// east, well up; across the top stretch it goes to castle.js's own moon, so the courtyard is exact.
const ROAD_MOON = new THREE.Vector3(0.22, 0.42, -0.88).normalize();

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

// Where the road gives onto the castle's approach: the gate's threshold (castle.js PLAN.outside.south).
// Past it the castle's own bright moonlit night takes the light at once (G29b, the owner's "Bright
// forecourt reveal"): one clear step, not a brightening up the last stretch.
const GATE_Z = 44.75;
const REVEAL = 0.45; // seconds the hand-over takes as the warden crosses the gate
// How the land's lift (roadlight.js groundLift) turns into light on the ground: set so the stills'
// road values follow the script (26 at the foot rising evenly to 66).
const LIFT_K = 2.0;
// The lift's calibration along the road: where the key swings from the sun to the moon (leg 5) the
// rendered road falls under the model's flat-ground figure, so the lift is raised there (measured on
// the stills against the script's road value 63).
const LIFT_CAL = [[0, 1], [0.76, 1], [0.92, 1.5], [0.97, 1], [1, 1]];
const BARK_FLOOR = 0.55; // the wood's and stones' shadow-side floor, in the same units (P3-4)
const rgb = (c, a) => c.setRGB(a[0], a[1], a[2], THREE.SRGBColorSpace);
const LIFT_RGB = [0, 0, 0]; // scratch: the land's lift colour this frame
const CASTLE_FLOOR = 0.3; // the castle stone's emissive floor in the dark stretch, in the haze's colour (calibrated on the leg 5 still)
const _c2 = new THREE.Color();

// ---- the hillside -----------------------------------------------------------------------------

const SEGS = [];
for (let i = 0; i + 1 < LINE.length; i++) {
  const [ax, az] = LINE[i];
  const [bx, bz] = LINE[i + 1];
  const len = Math.hypot(bx - ax, bz - az);
  SEGS.push({ ax, az, bx, bz, len, dx: (bx - ax) / len, dz: (bz - az) / len, s0: SEGS.length ? SEGS[SEGS.length - 1].s0 + SEGS[SEGS.length - 1].len : 0 });
}

/** The two nearest stretches of centreline to (x, z): their distances and road heights there. */
function nearest(x, z) {
  let d1 = Infinity; let h1 = 0; let d2 = Infinity; let h2 = 0; let u1 = 0;
  for (const g of SEGS) {
    const t = clamp(((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.len);
    const px = g.ax + g.dx * g.len * t;
    const pz = g.az + g.dz * g.len * t;
    const d = Math.hypot(x - px, z - pz);
    const h = heightAt(g.s0 + g.len * t);
    const u = (x - px) * -g.dz + (z - pz) * g.dx; // across the road, signed
    if (d < d1) { d2 = d1; h2 = h1; d1 = d; h1 = h; u1 = u; } else if (d < d2) { d2 = d; h2 = h; }
  }
  return { d1, h1, d2, h2, u1 };
}

/** The hill's own fall, away from the road: the castle's plateau, then down to the wood below. */
function hillBase(x, z) {
  const k = smooth((z - 44.5) / 82);
  const side = smooth((Math.abs(x) - 40) / 50);
  // the west flank falls away to the foot's level, so the low sun in the west-north-west is
  // still seen from the foot of the road, over open ground (the wood's end, #28)
  const west = smooth((-x - 35) / 16) * smooth((z - 46) / 10);
  const y = -31 * k - 4 * smooth((z - 126) / 60) - 6 * side * k;
  return lerp(y, -33 - 2 * smooth((-x - 60) / 40), west) + 1.4 * S.noise(x * 0.05, 0, z * 0.05, 7);
}

/** The ground at (x, z): flush with the road on it, banked between the legs, the hill beyond. */
export function hillAt(x, z) {
  if (z < 44.75) return 0;
  const n = nearest(x, z);
  if (onRoad(x, z) || n.d1 < 1.6) return n.h1 - 0.04;
  const base = hillBase(x, z);
  const e1 = Math.max(0.01, n.d1 - 1.6);
  const e2 = Math.max(0.01, n.d2 - 1.6);
  const w1 = 1 / (e1 * e1);
  const w2 = n.d2 < 13 ? 1 / (e2 * e2) : 0;
  const wb = 1 / 100;
  const h = (n.h1 * w1 + n.h2 * w2 + base * wb) / (w1 + w2 + wb);
  // a rough skin: more of it the further from the road
  const rough = Math.min(1, e1 / 3) * (0.35 * S.noise(x * 0.4, 1, z * 0.4, 3) + 0.15 * S.noise(x * 1.3, 2, z * 1.3, 5));
  return h + rough;
}

const G = (hex) => new THREE.Color(hex);
const GROUND = G(0x403d31); // dry, dead grass gone the colour of the dirt
const BANK = G(0x4a4743);
// (the road's own surface, its ruts, potholes and colours: roadsurface.js)

function buildHill() {
  const xs = [];
  for (let x = -120; x < -45; x += 3) xs.push(x);
  for (let x = -45; x <= 45; x += 1) xs.push(x);
  for (let x = 48; x <= 120; x += 3) xs.push(x);
  const zs = [];
  for (let z = 44.75; z < 132; z += 1) zs.push(z);
  for (let z = 132; z <= 210; z += 3) zs.push(z);
  const nx = xs.length; const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i]; const z = zs[j];
      const y = hillAt(x, z);
      const k = (j * nx + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const steep = Math.min(1, Math.abs(hillAt(x, z + 0.7) - y) / 0.7);
      c.copy(GROUND).lerp(BANK, steep * 0.8).multiplyScalar(0.85 + 0.25 * S.noise(x * 0.3, 4, z * 0.3, 11));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; const b = a + 1; const cc = a + nx; const d = cc + 1;
      idx[o++] = a; idx[o++] = cc; idx[o++] = b;
      idx[o++] = b; idx[o++] = cc; idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/**
 * The castle plateau's rim (the owner: "there is a gap under the fence. i can see thru it and the
 * castle looks like it is floating"). The plateau's floor is one thin plane at y 0 and the hill
 * falls away below its south edge, so from the road the eye saw under the floor, past the parapet's
 * foot, to the sky. A face of the bank's earth closes it: from the floor's edge down into the hill,
 * along the plateau's south edge and down both its sides, so the fence and the castle stand on
 * solid ground. It faces outward and is only seen from below the plateau.
 */
function buildRim() {
  const X0 = -80; const X1 = 80; const ZS = 44.75; const ZN = -62; const TOP = 0.02;
  const pos = []; const col = []; const idx = [];
  const c = new THREE.Color();
  const strip = (pts, out) => { // pts along the edge; each goes from TOP down to below the hill
    const base = pos.length / 3;
    for (const [x, z] of pts) {
      const low = Math.min(hillAt(x + out[0] * 0.6, z + out[1] * 0.6), 0) - 3;
      for (const y of [TOP, low]) {
        pos.push(x, y, z);
        c.copy(BANK).lerp(GROUND, y === TOP ? 0.3 : 0.7).multiplyScalar(0.85 + 0.25 * S.noise(x * 0.3, y * 0.5, z * 0.3, 17));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = base + i * 2; const b = a + 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1); // faces `out`: each edge is walked with the outside on its left
    }
  };
  const along = (x0, z0, x1, z1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]);
  strip(along(X0, ZS, X1, ZS, 160), [0, 1]); // the south edge, over the hill
  strip(along(X0, ZN, X0, ZS, 40), [-1, 0]); // the west side
  strip(along(X1, ZS, X1, ZN, 40), [1, 0]); // the east side
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}


/** A dead tree: a bare trunk leaning `lean` radians toward `toward` (radians, the way it leans), a few bare limbs. */
function deadTree(x, y, z, h, lean, toward, rnd) {
  const parts = [];
  // toward is the heading (cos, -sin) in (x, z); turning up (0, 1, 0) about axis a moves its top
  // along a x up, so for the top to go toward the road a = (-sin, 0, -cos) (review A4)
  const tilt = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(toward), 0, -Math.cos(toward)), lean);
  if (LEANS) {
    const top = new THREE.Vector3(0, h, 0).applyMatrix4(tilt);
    LEANS.push(top.x * Math.cos(toward) - top.z * Math.sin(toward)); // + when the top moves toward the road
  }
  const place = (g) => g.applyMatrix4(tilt).translate(x, y, z);
  const trunk = new THREE.CylinderGeometry(0.07, 0.2, h, 6, 3).translate(0, h / 2, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) { // a crooked trunk
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(t * 3.1 + x) * 0.12 * t);
    p.setZ(i, p.getZ(i) + Math.cos(t * 2.3 + z) * 0.1 * t);
  }
  parts.push(place(S.tint(trunk.deleteAttribute('uv'), 0x5a5249, 0.25, x))); // weathered, silvery grey-brown dead wood (P3-4)
  const limbs = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < limbs; i++) {
    const at = h * (0.45 + 0.5 * rnd());
    const len = h * (0.22 + 0.25 * rnd());
    const a = rnd() * TAU;
    const up = 0.5 + rnd() * 0.6;
    const g = new THREE.CylinderGeometry(0.02, 0.06, len, 4, 1).translate(0, len / 2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), up));
    g.translate(0, at, 0);
    parts.push(place(S.tint(g.deleteAttribute('uv'), 0x4e463e, 0.2, i)));
  }
  return parts;
}

// The trunk tops' movement toward the road, one per tree (metres; + toward it): the smoke checks it.
let LEANS = null;
// Nothing grows or lies in the cave's mouth (review A11): no tree within 4 m of it, no stone within 2.5 m.
const MOUTH = { x: ROAD.bats.cave.x, z: ROAD.bats.cave.z + 1 };
const nearMouth = (x, z, r) => Math.hypot(x - MOUTH.x, z - MOUTH.z) < r;
const ROAD_HALF = (RECTS[0].maxZ - RECTS[0].minZ) / 2; // the road's own half-width (leg 1 runs along x)
// The mouth faces down the bank to the road (+z), turned 35 degrees toward the way the warden comes
// up leg 4 (-x), so it is seen open from the approach and not edge-on (review A11).
const MOUTH_TURN = -0.61;
/** A point `across` metres along the mouth's face and `deep` metres into it, from its centre. */
function mouthAt(across, deep) {
  const c = Math.cos(MOUTH_TURN); const s = Math.sin(MOUTH_TURN);
  return { x: ROAD.bats.cave.x + across * c - deep * s, z: ROAD.bats.cave.z + 0.9 - across * s - deep * c };
}

function buildTrees(rnd) {
  const parts = [];
  LEANS = [];
  const twin = S.rng(2913); // leg 1's second bank (Q3)
  // Along the road, on both banks, every few metres: leaning in toward it.
  for (let s = 6; s < LENGTH - 8; s += 7.5 + rnd() * 3) {
    const p = pointAt(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 2.8 + rnd() * 3.2;
    const x = p.x + -p.dz * side * off;
    const z = p.z + p.dx * side * off;
    if (onRoad(x, z) || z < 46) continue;
    const toward = Math.atan2(-(p.z - z), p.x - x); // the way back to the road
    const h = 3.2 + rnd() * 3.5;
    const k = rnd();
    // every bank tree stands within 4 m of the road's edge (off - ROAD_HALF < 4): all lean hard over it (review A4)
    const lean = 0.25 + k * 0.15;
    if (nearMouth(x, z, 4)) { deadTree(0, 0, 0, h, lean, toward, rnd); LEANS.pop(); continue; } // same draws
    parts.push(...deadTree(x, hillAt(x, z) - 0.2, z, h, lean, toward, rnd));
    // Leg 1 (stations 0 to 79) takes the road foot's distribution (the owner, Q3: the trees seen
    // from the tunnel's mouth "have the right distribution"): a twin on the other bank too, so the
    // road runs between leaning trunks on both sides. Drawn from its own generator, so the rest of
    // the layout is as it was.
    if (s > 9 && s < RECTS[0].maxX - RECTS[0].minX) { // clear of the tunnel at the foot
      const off2 = 2.8 + twin() * 2.4;
      const x2 = p.x + p.dz * side * off2;
      const z2 = p.z - p.dx * side * off2 + (twin() - 0.5) * 2;
      if (!onRoad(x2, z2)) {
        const toward2 = Math.atan2(-(p.z - z2), p.x - x2);
        parts.push(...deadTree(x2, hillAt(x2, z2) - 0.2, z2, 3.4 + twin() * 3.2, 0.25 + twin() * 0.15, toward2, twin));
      }
    }
  }
  const leans = LEANS;
  LEANS = null;
  const g = S.merge(parts);
  g.userData.leans = leans;
  return g;
}

function rock(x, y, z, r, hex, seed) {
  const g = new THREE.DodecahedronGeometry(r, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.45 * S.noise(p.getX(i) * 3 + seed, p.getY(i) * 3, p.getZ(i) * 3, seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  return S.tint(g.translate(x, y, z), hex, 0.25, seed);
}

function buildStones(rnd) {
  const parts = [];
  for (let s = 2; s < LENGTH - 4; s += 2.2 + rnd() * 2.5) {
    const p = pointAt(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 2.1 + rnd() * 2.2;
    const x = p.x + -p.dz * side * off + (rnd() - 0.5);
    const z = p.z + p.dx * side * off + (rnd() - 0.5);
    if (onRoad(x, z) || z < 45.5) continue;
    const r = 0.15 + rnd() * rnd() * 0.7;
    if (nearMouth(x, z, 2.5)) continue;
    parts.push(rock(x, hillAt(x, z) + r * 0.2, z, r, 0x6b655d, s));
  }
  // The outcrop above leg 2 the boulder breaks from: a broken face of rock on the bank.
  for (let i = 0; i < 26; i++) {
    const x = BOULDER_X + BOULDER_DIR * (rnd() * 17 - 1);
    const z = 83 + rnd() * 3;
    const r = 0.5 + rnd() * 1.1;
    parts.push(rock(x, hillAt(x, z) + r * 0.35, z, r, 0x5f5a54, 100 + i));
  }
  // The cave in the bank above leg 4: an arch of heavy stones round a dark mouth.
  const cv = ROAD.bats.cave;
  const cy = hillAt(cv.x, 65.6);
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * (i / 12);
    const m = mouthAt(Math.cos(a) * 1.9, -0.3 * Math.sin(a));
    const y = cy + Math.sin(a) * 2.3;
    parts.push(rock(m.x, y, m.z, 0.55 + rnd() * 0.35, 0x7a6d5e, 200 + i)); // warm like the bank, a little above it, framing the dark (A11, P3-9)
  }
  return S.merge(parts);
}

/**
 * The wood the warden has just left: thick behind the road's foot (east of it) and round the hill's
 * south-east, the way out a gap in it; the south-west left open, so the low sun is seen over it.
 */
function buildWood(rnd) {
  const parts = [];
  for (let i = 0; i < 260; i++) {
    const east = rnd() < 0.6;
    const x = east ? 52 + rnd() * 70 : 40 + rnd() * 18;
    const z = east ? 66 + rnd() * 120 : 112 + rnd() * rnd() * 80;
    if (x < 72 && z > 99 && z < 109) continue; // the way out of the wood, onto the road
    const y = hillAt(x, z) - 0.3;
    const h = 7 + rnd() * 9;
    if (rnd() < 0.55) {
      const g = new THREE.ConeGeometry(1.6 + rnd() * 1.4, h, 7).translate(x, y + h / 2 + 1, z);
      parts.push(S.tint(g.deleteAttribute('uv'), 0x1d2a20, 0.3, i));
    } else {
      const g = new THREE.IcosahedronGeometry(2.2 + rnd() * 1.8, 0).scale(1, 1.25, 1).translate(x, y + h * 0.75, z);
      parts.push(S.tint(g.deleteAttribute('uv'), 0x243325, 0.3, i));
    }
    const t = new THREE.CylinderGeometry(0.18, 0.3, h * 0.6, 5).translate(x, y + h * 0.3, z);
    parts.push(S.tint(t.deleteAttribute('uv'), 0x241c16, 0.2, i));
  }
  return S.merge(parts);
}

// ---- the scares --------------------------------------------------------------------------------

function boulderGeometry() {
  const g = new THREE.IcosahedronGeometry(ROAD.boulder.radius, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.82 + 0.3 * S.noise(p.getX(i) * 4, p.getY(i) * 4, p.getZ(i) * 4, 21);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  return S.tint(g, 0x6a645b, 0.3, 4);
}

// The bats' colours: a dark warm brown-grey skin, darker along the bones, the fur a little lighter.
const BAT = { bone: 0x3a2e27, skin: 0x4a392f, fur: 0x5c4a3d, ear: 0x33261f, finger: 0x5a4a40 };

/**
 * One small bat, its wings laid out flat: a furred body nub with a head and two ears, and two
 * wings together about twice as wide as the body is long, each a short arm and a hand of three
 * fingers, the trailing edge scalloped between the finger ends. The head is toward -z, the way
 * the flight's yaw carries a bat. Bones are dark and the skin between them lighter, so the
 * fingers show. The `aWing` attribute marks each vertex for the flap (batFlap): 0 the body, 1 the
 * arm (turns at the shoulder), 2 the hand (turns at the wrist too), signed by its side. The hinge
 * lines are left in userData.hinge. Small, dark and quick: never cute.
 */
function batGeometry(span = 0.46) {
  const h = span / 2;
  const sx = h * 0.13; const wx = h * 0.5; const hy = 0.01; // the shoulder's and the wrist's hinge lines
  const pos = []; const nor = []; const col = []; const part = [];
  const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const bone = C(BAT.bone); const skin = C(BAT.skin); const fur = C(BAT.fur); const ear = C(BAT.ear);
  const V = (x, y, z, c) => ({ x, y, z, c });
  // One triangle, wound to face up (a wing, an ear) or out from the body's middle (round: the
  // body, shaded smooth from its axis instead of flat).
  const tri = (a, b, c, mark, round) => {
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
    const vx = c.x - a.x; const vy = c.y - a.y; const vz = c.z - a.z;
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const out = round ? nx * (a.x + b.x + c.x) + ny * (a.y + b.y + c.y) + nz * (a.z + b.z + c.z) * 0.3 : ny;
    const list = out < 0 ? [a, c, b] : [a, b, c];
    if (out < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const p of list) {
      pos.push(p.x, p.y, p.z);
      col.push(p.c.r, p.c.g, p.c.b);
      part.push(mark);
      if (round) { const r = Math.hypot(p.x, p.y, p.z * 0.5) || 1; nor.push(p.x / r, p.y / r, p.z * 0.5 / r); } else nor.push(nx / l, ny / l, nz / l);
    }
  };
  // the body: nose, a small ring for the head, a wider one for the chest, tail
  const b = h * 0.5;
  const ring = (z, r, y, c) => [V(0, y + r, z, c), V(r, y, z, c), V(0, y - r * 0.85, z, C(BAT.fur, 0.7)), V(-r, y, z, c)];
  const nose = V(0, 0.004, -b, ear); const tail = V(0, -0.004, b, C(BAT.fur, 0.6));
  const head = ring(-b * 0.68, b * 0.23, 0.008, fur); const chest = ring(-b * 0.1, b * 0.36, 0, fur);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(nose, head[i], head[j], 0, true);
    tri(head[i], chest[i], chest[j], 0, true);
    tri(head[i], chest[j], head[j], 0, true);
    tri(chest[i], tail, chest[j], 0, true);
  }
  for (const sd of [-1, 1]) {
    const P = (x, f, y, c) => V(sd * x * h, hy + y, -f * h, c); // across in half spans, forward in half spans
    tri(V(sd * b * 0.08, 0.03, -b * 0.8, ear), V(sd * b * 0.3, 0.025, -b * 0.5, ear), V(sd * b * 0.34, 0.075, -b * 0.72, C(BAT.ear, 1.3)), 0, false);
    const S0 = V(sd * sx, hy, -0.22 * h, bone); const H0 = V(sd * sx, hy, 0.35 * h, C(BAT.skin, 0.7));
    const W = P(0.5, 0.45, 0, bone); const E = P(0.5, -0.6, 0, bone);
    const T = P(1, -0.05, 0, bone); const F1 = P(0.82, -0.52, 0, bone); const F2 = P(0.64, -0.66, 0, bone);
    // the notches of the scalloped edge, and the middle of the arm's skin: lighter, sagging a little
    const n1 = P(0.79, -0.065, -0.012, skin); const n2 = P(0.67, -0.33, -0.012, skin); const n3 = P(0.555, -0.36, -0.01, skin);
    const n4 = P(0.315, -0.25, -0.01, skin); const m = P(0.3, 0.05, -0.008, skin);
    const hand = [T, n1, F1, n2, F2, n3, E];
    for (let i = 0; i + 1 < hand.length; i++) tri(W, hand[i], hand[i + 1], sd * 2, false);
    const arm = [S0, W, E, n4, H0, S0];
    for (let i = 0; i + 1 < arm.length; i++) tri(m, arm[i], arm[i + 1], sd, false);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(part, 1));
  g.userData.hinge = { sx, wx, hy };
  return g;
}

/**
 * Makes a small bat's material flap its wings in the vertex shader, so the whole swarm stays one
 * draw call: each instance's `aFlap` holds two angles (the arm's at the shoulder, the hand's at
 * the wrist; up is positive) and each vertex's `aWing` says which of them turn it. Normals turn
 * with the wing, so the light on it changes through the beat.
 */
function batFlap(mat, hinge) {
  const f = (k) => k.toFixed(5);
  const fold = `
attribute float aWing;
attribute vec2 aFlap;
vec3 batFold(vec3 v, float point) {
  float part = abs(aWing);
  if (part < 0.5) return v;
  float sd = sign(aWing);
  vec2 q = vec2(v.x * sd, v.y);
  vec2 at = point * vec2(${f(hinge.wx)}, ${f(hinge.hy)});
  vec2 cs = vec2(cos(aFlap.y), sin(aFlap.y));
  if (part > 1.5) { q -= at; q = vec2(q.x * cs.x - q.y * cs.y, q.x * cs.y + q.y * cs.x) + at; }
  at = point * vec2(${f(hinge.sx)}, ${f(hinge.hy)});
  cs = vec2(cos(aFlap.x), sin(aFlap.x));
  q -= at; q = vec2(q.x * cs.x - q.y * cs.y, q.x * cs.y + q.y * cs.x) + at;
  return vec3(q.x * sd, q.y, v.z);
}`;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${fold}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = batFold(objectNormal, 0.0);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = batFold(transformed, 1.0);');
  };
  mat.customProgramCacheKey = () => 'bat-flap';
  return mat;
}

/**
 * One stretch of the giant bat's wing skin, between the bone a0-a1 and the bone b0-b1 (two fingers
 * from the wrist share their first point). Its free edge dips in between the bone ends by `dip`
 * (the scallop), the skin sags by `sag` between the bones, and it darkens toward each bone.
 */
function wingPanel(a0, a1, b0, b1, dip, sag, seed) {
  const R = 3; const N = 4;
  const pos = []; const col = []; const idx = [];
  const mx = (a0[0] + b0[0]) / 2; const mz = (a0[2] + b0[2]) / 2;
  const bone = new THREE.Color(BAT.bone); const c = new THREE.Color();
  for (let j = 0; j <= R; j++) {
    for (let i = 0; i <= N; i++) {
      const r = j / R; const s = i / N; const arch = Math.sin(Math.PI * s);
      const p = [0, 1, 2].map((k) => lerp(lerp(a0[k], a1[k], r), lerp(b0[k], b1[k], r), s));
      const dx = mx - p[0]; const dz = mz - p[2]; const d = Math.hypot(dx, dz) || 1;
      const pull = dip * arch * r * r;
      pos.push(p[0] + dx / d * pull, p[1] - sag * arch * r, p[2] + dz / d * pull);
      c.setHex(BAT.skin).multiplyScalar(1 + 0.2 * S.noise(p[0] * 5, p[2] * 5, seed, 31));
      c.lerp(bone, 1 - Math.pow(arch, 0.6));
      col.push(c.r, c.g, c.b);
      if (j < R && i < N) {
        const q = j * (N + 1) + i;
        idx.push(q, q + N + 1, q + N + 2, q, q + N + 2, q + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // faces up (the membrane is double sided, but its normals must agree with its winding)
  const n = g.attributes.normal;
  let up = 0;
  for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  for (let i = 0; i < n.count; i++) if (!(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.5)) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** One bone of the giant bat's wing, from a to b, tapering from radius ra to rb. */
function wingBone(a, b, ra, rb) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, 5, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.divideScalar(len)));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return S.tint(g, BAT.finger, 0.15, 5);
}

/**
 * The giant bat's wing, spanning `len` out along +x from the shoulder with its leading edge
 * toward -z, in two parts so it can fold: the arm (shoulder to wrist, and the skin back to the
 * hip) and the hand (three long fingers from the wrist, the skin scalloped between their ends),
 * the hand given about its wrist, which is `wrist` out along the arm. Finger bones stand proud
 * of the skin and a thumb claw hooks forward at the wrist.
 */
function wingGeometry(len) {
  const wrist = len * 0.42;
  const sh = [0, 0, -0.16]; const hip = [0, 0, 0.42];
  const wr = [wrist, 0, -0.34]; const fifth = [wrist, 0, 0.66]; // the fifth finger lies along the fold
  const tip = [len, 0, 0.05]; const f1 = [len * 0.86, 0, 0.5]; const f2 = [len * 0.64, 0, 0.72];
  const arm = S.merge([
    wingPanel(sh, hip, wr, fifth, 0.16, 0.05, 1),
    wingBone(sh, wr, 0.045, 0.03), wingBone(wr, fifth, 0.024, 0.008),
  ]);
  const hand = S.merge([
    wingPanel(wr, tip, wr, f1, 0.13, 0.04, 2), wingPanel(wr, f1, wr, f2, 0.11, 0.04, 3), wingPanel(wr, f2, wr, fifth, 0.09, 0.03, 4),
    wingBone(wr, tip, 0.028, 0.008), wingBone(wr, f1, 0.024, 0.008), wingBone(wr, f2, 0.024, 0.008),
    wingBone(wr, [wrist + 0.03, 0.03, -0.5], 0.022, 0.003),
  ]).translate(-wrist, 0, 0);
  return { arm, hand, wrist };
}

/** The giant bat's body: a furred torso, a head with a dark snout and two tall ears, toward -z. */
function giantBodyGeometry() {
  const ear = (sd) => S.tint(new THREE.ConeGeometry(0.075, 0.3, 4).scale(1, 1, 0.45).rotateZ(-sd * 0.3).translate(sd * 0.11, 0.33, -0.5), BAT.ear, 0.2, 7);
  return S.merge([
    S.tint(new THREE.SphereGeometry(0.32, 10, 8).scale(0.85, 0.7, 1.6), BAT.fur, 0.25, 2),
    S.tint(new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.9, 1.1).translate(0, 0.1, -0.5), BAT.fur, 0.25, 3),
    S.tint(new THREE.SphereGeometry(0.08, 6, 4).scale(1, 0.8, 1.2).translate(0, 0.05, -0.68), BAT.ear, 0.2, 4),
    ear(-1), ear(1),
  ]);
}

const SWARM = 110;

/** A ragged puff of grit, for the dust: a clot of uneven blots, no clean round edge (review A13). */
function dustTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = S.rng(4407);
  for (let i = 0; i < 22; i++) {
    const a = r() * TAU; const d = r() * r() * 10;
    const x = 16 + Math.cos(a) * d; const y = 16 + Math.sin(a) * d * 0.8;
    const rad = 1.5 + r() * 4.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(255,255,255,${(0.25 + r() * 0.45).toFixed(2)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the view --------------------------------------------------------------------------------

/**
 * Builds the road into `root` (the castle's group). parts: the castle's own { fill, hemi, fog,
 * background, skyMat, sky, starMat, moonMat, key, getRenderer }. Returns { update, group }.
 */
export function createRoadView(root, parts) {
  const group = new THREE.Group();
  group.name = 'castle:road';
  root.add(group);
  const rnd = S.rng(2911);
  const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  // the land's lift (the colour script's road values): an extra light on the land alone, its own
  // colour times the sky fill's (update), so the ruts and the grass keep their contrast
  const groundLift = { value: new THREE.Color(0, 0, 0) };
  ground.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = groundLift;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLift;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * uLift;');
  };
  ground.customProgramCacheKey = () => 'road-ground-lift';
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  // the dead wood's and the stones' floor (P3-4: no pure black forms): their shadow sides take the
  // sky fill's hue and never fall below the script's tree-shadow values, whatever the low key does
  const barkLift = { value: new THREE.Color(0, 0, 0) };
  bark.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = barkLift;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLift;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor * uLift;');
  };
  bark.customProgramCacheKey = () => 'road-bark-lift';
  const add = (g, m) => { const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = false; mesh.castShadow = false; group.add(mesh); return mesh; };
  add(buildHill(), ground);
  add(buildRim(), ground);
  const roadMesh = add(buildRoadSurface({ nearest }), ground); // ruts that wander, potholes, grit, the top stretch textured to the plinth (P3-7)
  roadMesh.renderOrder = 1;
  add(buildTrees(rnd), bark);
  add(buildStones(rnd), bark);
  add(buildRoadProps({ hillAt }).geometry, bark); // loose stones and four derelicts on the verges: props only, the road clear
  add(buildWood(rnd), bark);
  // Where the way comes out of the wood (#29 G29a): the road's foot opens out of the tunnel of trees
  // and brambles the wood's end ran into (tunnel.js, the same one), shut behind, its mouth to the west.
  {
    const T = ROAD.foot.tunnel;
    const tunnel = buildTunnel({
      length: T.backX - T.mouthX, seed: 31, openNear: true, openFar: false, mouthHex: 0x584c3e, // the road's dirt, out of the litter
      ground: (lx, lz) => hillAt(T.mouthX - lz, ROAD.foot.z + lx),
    });
    tunnel.rotation.y = -Math.PI / 2; // its -z (in) is the road's +x (east, back into the wood)
    tunnel.position.set(T.mouthX, 0, ROAD.foot.z);
    group.add(tunnel);
  }
  // The cave's dark: a black hollow set into the bank, swallowing light.
  {
    const cv = ROAD.bats.cave;
    const cy = hillAt(cv.x, 65.6);
    // The mouth: one large unlit black shape, bigger than any of the arch's stones (pass 2, A11).
    // Behind the arch, the bank itself (a face of the hillside's colour, lit like it), so no sky
    // shows between the stones: "i should only see cave beneath the mouth" (the owner). Both turned
    // with the arch.
    const front = mouthAt(0, -0.15);
    const g = new THREE.CircleGeometry(1.75, 18, 0, Math.PI).rotateY(MOUTH_TURN).translate(front.x, cy, front.z);
    add(g, new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide }));
    const back = mouthAt(0, 0.4);
    const bank = new THREE.CircleGeometry(3.1, 20, 0, Math.PI).rotateY(MOUTH_TURN).translate(back.x, cy - 0.3, back.z);
    add(S.tint(bank.deleteAttribute('uv'), 0x4a4743, 0.2, 5), ground);
  }

  // The sun's disc, on the dome (castle.js's sky group rides with the eye).
  const discMat = new THREE.MeshBasicMaterial({ color: SET.discHex, fog: false, toneMapped: false, transparent: true, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(6.4, 16, 10), discMat); // as large in the sky as #28's
  disc.renderOrder = -8;
  disc.visible = false;
  parts.sky.add(disc);

  // The boulder and its dust.
  const boulder = new THREE.Mesh(boulderGeometry(), bark);
  boulder.visible = false;
  group.add(boulder);
  // the smaller rocks that come down with it (road.js BOULDER_ROCKS, A13): one instanced mesh
  const rocks = new THREE.InstancedMesh(S.tint(new THREE.DodecahedronGeometry(1, 0).deleteAttribute('uv'), 0x655f57, 0.3, 6), bark, BOULDER_ROCKS.length);
  rocks.visible = false;
  rocks.frustumCulled = false;
  group.add(rocks);
  const _r = {};
  const extra = createRoadCreature(group); // the second boulder, half the size, and the creature on the bank
  const DUST = 260; // more of it, low and wide (the owner, pass 2: "enhance the dust effects")
  const dustPos = new Float32Array(DUST * 3);
  const dustVel = new Float32Array(DUST * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  // unlit points: tinted each frame by the evening's light instead (update), small and ragged
  const dustMat = new THREE.PointsMaterial({ map: dustTexture(), color: 0x8f8170, size: 0.7, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.visible = false;
  dust.frustumCulled = false;
  group.add(dust);
  let dustAge = 9;
  let dustNext = 0;

  // The swarm: one instanced mesh of small bats (one draw call), lit and vertex coloured, each
  // instance's two wing angles handed to the vertex shader (batFlap).
  const batGeo = batGeometry(0.46);
  const batMat = batFlap(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), batGeo.userData.hinge);
  const flapAt = new THREE.InstancedBufferAttribute(new Float32Array(SWARM * 2), 2);
  flapAt.setUsage(THREE.DynamicDrawUsage);
  batGeo.setAttribute('aFlap', flapAt);
  const swarm = new THREE.InstancedMesh(batGeo, batMat, SWARM);
  swarm.visible = false;
  swarm.frustumCulled = false;
  group.add(swarm);
  // Three uneven gusts (road.js SWARM_GUSTS), each bat ~1.4 s from the mouth to gone (~20 m/s),
  // beating its wings up and down at 9 to 12 Hz (review A7).
  const flock = [];
  {
    const G = SWARM_GUSTS.gusts;
    let g = 0; let upto = G[0].share;
    for (let i = 0; i < SWARM; i++) {
      while (g + 1 < G.length && i >= Math.round(upto * SWARM)) { g++; upto += G[g].share; }
      const r0 = rnd();
      flock.push({
        delay: G[g].at + G[g].spread * r0 * Math.sqrt(r0), fly: lerp(SWARM_GUSTS.fly[0], SWARM_GUSTS.fly[1], rnd()),
        dx: (rnd() - 0.5) * 3.2, dz: (rnd() - 0.5) * 3.4, up: 0.5 + rnd() * 1.4, wob: rnd() * TAU, beat: TAU * (9 + rnd() * 3), s: 0.8 + rnd() * 0.5,
      });
    }
  }
  const NEAREST = 1.2; // no bat comes nearer the eye than this (review A7): no black shard across the lens
  // The giant bat: a body with a head and ears, and two wings hinged at the shoulders, each with
  // a hand hinged again at the wrist (five draw calls while it flies).
  const giant = new THREE.Group();
  giant.visible = false;
  const body = new THREE.Mesh(giantBodyGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  giant.add(body);
  const membrane = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const wingGeo = wingGeometry(1.7);
  const hands = [];
  const wings = [-1, 1].map((sd) => {
    const hinge = new THREE.Group();
    hinge.position.set(sd * 0.22, 0.05, 0);
    const arm = new THREE.Mesh(wingGeo.arm, membrane);
    arm.scale.x = sd;
    const wrist = new THREE.Group();
    wrist.position.set(sd * wingGeo.wrist, 0, 0);
    const hand = new THREE.Mesh(wingGeo.hand, membrane);
    hand.scale.x = sd;
    wrist.add(hand);
    hinge.add(arm, wrist);
    hands.push(wrist);
    giant.add(hinge);
    return hinge;
  });
  group.add(giant);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const _b = {};
  const sunDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const moonFill = new THREE.Vector3(-0.5, 0.6, 0.8).normalize(); // castle.js's own fill

  function spray(x, y, z, n, speed, upward, spread = 0.6) {
    for (let k = 0; k < n; k++) {
      const i = dustNext;
      dustNext = (dustNext + 1) % DUST;
      dustPos[i * 3] = x + (rnd() - 0.5) * spread;
      dustPos[i * 3 + 1] = y + rnd() * 0.3;
      dustPos[i * 3 + 2] = z + (rnd() - 0.5) * spread;
      const a = rnd() * TAU;
      dustVel[i * 3] = Math.cos(a) * speed * (0.4 + rnd());
      dustVel[i * 3 + 1] = upward * (0.3 + rnd());
      dustVel[i * 3 + 2] = Math.sin(a) * speed * (0.4 + rnd());
    }
    dustAge = 0;
  }

  let lastBoulderT = -1;
  let giantOver = null; // where the giant bat passes over the warden: their place as it came out
  const EYE_UP = 1.6; // the warden's eye over their feet (keepconfig player.eyeHeight)
  const GIANT_CLEAR = 2.3; // the giant bat's body over the eye as it passes: wingtips (1.7 m, banked) still clear
  let trailAcc = 0; // the dust trail's part-particles carried from frame to frame
  let roadOn = 1; // the road's light holding (1) or handed to the forecourt's (0): the reveal at the gate
  const MOON_HALO = parts.moonHalo ? parts.moonHalo.opacity : 0;

  /**
   * Once a frame, after castle.js has set its own light for the zone. inRun: a castle run is
   * playing; outside: the zone on screen is the outside; eye: the camera's place.
   */
  function update(sim, dt, time, inRun, outside, eye) {
    group.visible = outside;
    const road = inRun && sim.waves ? sim.waves.road : null;
    const dark = road ? road.dark : 1;

    // ---- the light: the colour script, kept state on the ratchet (logic/roadlight.js) ----
    // `on`: how much the road's light holds, 1 on the road, 0 past the gate, where castle.js's own
    // light (which the courtyard end of the script equals) takes over unchanged.
    const want = road && outside && eye && eye.z >= GATE_Z ? 1 : 0;
    roadOn = dt === 0 ? want : clamp(roadOn + Math.sign(want - roadOn) * dt / REVEAL);
    const on = outside ? smooth(roadOn) : 0;
    const L = roadLight(dark);
    const dusk = outside ? L.dusk : 0;
    const sm = parts.skyMat.uniforms;
    sunToward(L.sunElevDeg, sunDir);
    sm.dusk.value = dusk * on;
    sm.sunDir.value.copy(sunDir);
    // the evening sky as structure: zenith, the warm side behind, the cooler side ahead over the
    // castle, the Earth's shadow and the Belt of Venus ahead, the sun's glow behind
    rgb(sm.uZenith.value, L.skyZenithRGB); rgb(sm.uAhead.value, L.skyAheadRGB); rgb(sm.uBehind.value, L.skyBehindRGB);
    rgb(sm.uBelt.value, L.beltRGB); sm.uBeltK.value = L.beltK;
    rgb(sm.uShadowBand.value, L.earthShadowRGB); sm.uShadowTop.value = L.shadowTopDeg;
    rgb(sm.uSunGlow.value, L.fillRGB).multiplyScalar(0.8 * smooth((L.sunElevDeg + 3) / 6));
    disc.visible = on > 0.01 && L.disc > 0.01; // behind the climb: never in the forward view; gone once set
    if (disc.visible) {
      disc.position.copy(sunDir).multiplyScalar(150);
      rgb(discMat.color, L.fillRGB);
      discMat.opacity = 0.85 * L.disc * on;
    }
    // the moon over the castle on the climb, to castle.js's own place across the top stretch
    if (parts.moon) {
      _p.copy(ROAD_MOON).lerp(parts.moonDir, Math.max(1 - on, clamp((dark - 0.97) / 0.03))).normalize();
      sm.moon.value.copy(_p);
      parts.moon.position.copy(_p).multiplyScalar(160);
      parts.moon.lookAt(0, 0, 0);
      parts.moonHaloMesh.position.copy(_p).multiplyScalar(162);
      parts.moonHaloMesh.lookAt(0, 0, 0);
    }
    if (parts.moonHalo) parts.moonHalo.opacity = lerp(MOON_HALO, MOON_HALO * L.halo, on);
    // the far crags and the castle's roofs: light and haze, under the sky behind them (N2, P3-4)
    if (parts.darkMat) parts.darkMat.color.setHex(0x080b12).lerp(rgb(_c, L.peaksRGB), on);
    // the castle: most of its colour at the foot, a very dark silhouette as the light goes, lit
    // stone on the top stretch; its windows come on a few at a time as the sun sets
    const shade = lerp(1, L.castleShade, on);
    // never black (the owner): as its own light goes, the stone keeps a floor of the haze's colour
    rgb(_c2, L.peaksRGB).multiplyScalar(CASTLE_FLOOR * (1 - L.castleShade) * on);
    for (const m of parts.castleStone || []) { m.color.setScalar(shade); m.emissive.copy(_c2); }
    const wm = parts.windowMats;
    if (wm) for (let k = 0; k < wm.length; k++) wm[k].visible = on < 0.5 || L.windows[k] > 0;
    // the land's lift: the ground's value rises in a straight line (the script's road values)
    // in the low sun's hue while it is up (the land's chroma peaks in the golden light, criterion 22),
    // the sky fill's once it has set; the same luminance either way
    const warm = smooth((L.sunElevDeg + 2) / 4);
    const gain = lum(L.hemiRGB) / Math.max(0.05, lum(L.fillRGB));
    for (let i = 0; i < 3; i++) LIFT_RGB[i] = L.hemiRGB[i] + (L.fillRGB[i] * gain - L.hemiRGB[i]) * warm;
    const liftRGB = LIFT_RGB;
    groundLift.value.copy(rgb(_c, liftRGB).multiplyScalar(L.groundLift * on * LIFT_K * along(LIFT_CAL, dark))); // calibrated on the stills (road values)
    barkLift.value.copy(rgb(_c, L.hemiRGB).multiplyScalar((BARK_FLOOR + 0.5 * L.groundLift * LIFT_K) * on));
    if (on > 0.001) {
      // the key: the low sun behind the climb (raised a little, so even on the horizon it rakes the
      // road and lights the faces the warden sees), swinging to the moon's fill as night comes
      sunToward(Math.max(L.sunElevDeg, -2) + KEY_RAISE, lightDir).lerp(moonFill, L.moonK).normalize();
      parts.fill.position.lerp(_p.copy(lightDir).multiplyScalar(100), on);
      parts.fill.color.lerp(rgb(_c, L.fillRGB), on);
      parts.fill.intensity = lerp(parts.fill.intensity, L.fill, on);
      parts.hemi.color.lerp(rgb(_c, L.hemiRGB), on);
      parts.hemi.groundColor.lerp(rgb(_c, L.groundRGB), on);
      parts.hemi.intensity = lerp(parts.hemi.intensity, L.hemi, on);
      parts.fog.color.lerp(rgb(_c, L.fogRGB), on); // the haze, tracking the horizon
      parts.fog.density = lerp(parts.fog.density, L.fog, on);
      parts.background.copy(parts.fog.color);
      parts.starMat.opacity *= lerp(1, L.stars, on);
      parts.moonMat.opacity *= lerp(1, L.moon, on);
      parts.key.intensity *= lerp(1, L.key, on); // the moon on the castle's front only over the top stretch
      const r = parts.getRenderer();
      if (r && inRun) r.toneMappingExposure = lerp(COURTYARD.exposure, L.exposure, on);
    } else {
      const r = parts.getRenderer();
      if (r && inRun) r.toneMappingExposure = COURTYARD.exposure;
    }
    // the bats' wings glow blood-orange where the low sun is behind them (the colour script)
    batMat.emissive.copy(rgb(_c, L.fillRGB)).multiplyScalar(0.35 * smooth((L.sunElevDeg + 2) / 4) * on);
    // what lit the road this frame, for the smoke's check that it follows the ratchet to the courtyard's light
    group.userData.light = { on, dark, zone: want ? 'road' : 'forecourt', fill: parts.fill.intensity, hemi: parts.hemi.intensity, exposure: inRun && parts.getRenderer() ? parts.getRenderer().toneMappingExposure : null };

    // ---- the boulder ----
    const b = road && road.boulder;
    const falling = !!b && b.state === 'falling';
    boulder.visible = falling && outside;
    if (falling) {
      boulderAt(b.t, b.x, _b);
      boulder.position.set(_b.x, _b.y, _b.z);
      boulder.rotation.set(_b.spin, _b.spin * 0.3, 0);
      for (let k = 0; k < BOULDER_ROCKS.length; k++) {
        boulderRockAt(k, b.t, b.x, _r);
        _m.compose(_p.set(_r.x, _r.y, _r.z), _q.setFromEuler(_e.set(_r.spin, _r.spin * 0.4 + k, 0)), _s.setScalar(_r.r));
        rocks.setMatrixAt(k, _m);
      }
      rocks.instanceMatrix.needsUpdate = true;
      if (dt > 0) {
        // a trail of grit off the bank and across the road, kept low; a wide, low sheet where it lands
        const R = ROAD.boulder.radius;
        if (b.t < ROAD.boulder.fall + ROAD.boulder.cross) { // 120 a second, whatever the frame rate
          trailAcc += 120 * dt;
          const n = Math.floor(trailAcc);
          trailAcc -= n;
          if (n) spray(_b.x, _b.y - R, _b.z, n, 1.0, 0.35, 1.4);
        }
        if (lastBoulderT < ROAD.boulder.fall + ROAD.boulder.cross * 0.45 && b.t >= ROAD.boulder.fall + ROAD.boulder.cross * 0.45) {
          spray(_b.x, _b.y - R, _b.z, 140, 3.4, 0.45, 2.4);
        }
      }
      lastBoulderT = b.t;
    } else lastBoulderT = -1;
    rocks.visible = boulder.visible;
    if (dustAge < 3) {
      dust.visible = outside;
      if (dt > 0) {
        dustAge += dt;
        for (let i = 0; i < DUST; i++) {
          dustPos[i * 3] += dustVel[i * 3] * dt;
          dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt;
          dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
          dustVel[i * 3] *= 1 - 1.8 * dt;
          dustVel[i * 3 + 1] = dustVel[i * 3 + 1] * (1 - 1.5 * dt) - 0.25 * dt;
          dustVel[i * 3 + 2] *= 1 - 1.8 * dt;
        }
        dustGeo.attributes.position.needsUpdate = true;
      }
      dustMat.opacity = 0.7 * (1 - smooth(dustAge / 2.6));
      // never brighter than the ground it is kicked from: dun in the last of the sun, toward
      // 0x3a3128 as the dusk goes (review A13)
      dustMat.color.setHex(0x6a5f50).lerp(_c.setHex(0x3a3128), 1 - smooth(dusk)).multiplyScalar(clamp(parts.fill.intensity / 1.1, 0.55, 1));
      if (dustAge >= 3) dust.visible = false;
    }

    extra.update(inRun ? sim : null, dt, time, outside);

    // ---- the bats ----
    const bt = road && road.bats;
    const cv = ROAD.bats.cave;
    const roadY = heightAt(ROAD.bats.at);
    swarm.visible = !!bt && bt.state === 'swarm' && outside;
    if (swarm.visible) {
      const t = bt.t;
      for (let i = 0; i < SWARM; i++) {
        const f = flock[i];
        const u = (t - f.delay) / f.fly;
        if (u <= 0 || u >= 1) {
          _m.makeScale(0, 0, 0);
          swarm.setMatrixAt(i, _m);
          continue;
        }
        // out of the mouth, back down the road over the warden's head at the trigger point, then
        // away off the edge and down the slope: a curve through three points
        const ax = cv.x; const ay = roadY + 1.6; const az = cv.z + 0.9;
        const bx = BATS_X + f.dx - BATS_DIR * 0.5; const by = roadY + 2.25 + f.up; const bz = 68 + f.dz * 0.5;
        const cx = BATS_X - BATS_DIR * 9 + f.dx * 2; const cy = roadY - 2 + f.up; const cz = 84 + f.dz;
        const a1 = (1 - u) * (1 - u); const a2 = 2 * u * (1 - u); const a3 = u * u;
        const x = a1 * ax + a2 * bx + a3 * cx + 0.35 * Math.sin(f.wob + u * 7);
        const y = a1 * ay + a2 * by + a3 * cy + 0.25 * Math.sin(f.wob * 2 + u * 11);
        const z = a1 * az + a2 * bz + a3 * cz;
        _p.set(x, y, z);
        if (eye) { // held off the eye: pushed out along the line from it
          const d = _p.distanceTo(eye);
          if (d < NEAREST) _p.sub(eye).multiplyScalar(NEAREST / Math.max(d, 1e-3)).add(eye);
        }
        _e.set(-0.2, Math.atan2(-(cx - ax), -(cz - az)) + Math.sin(f.wob + u * 9) * 0.3, Math.sin(f.wob + u * 5) * 0.4);
        _q.setFromEuler(_e);
        _s.set(f.s, f.s, f.s);
        _m.compose(_p, _q, _s);
        swarm.setMatrixAt(i, _m);
        // the beat: the arm swings up and down at the shoulder and the hand trails it at the
        // wrist, so the wings pass through a V, a W, an arch and an M each beat
        const ph = time * f.beat + f.wob;
        flapAt.array[i * 2] = 0.1 + 0.8 * Math.sin(ph);
        flapAt.array[i * 2 + 1] = -0.2 + 0.7 * Math.sin(ph - 1.2);
      }
      swarm.instanceMatrix.needsUpdate = true;
      flapAt.needsUpdate = true;
    }
    giant.visible = !!bt && bt.state === 'giant' && outside;
    if (!giant.visible) giantOver = null;
    if (giant.visible) {
      // Out of the cave and right over the warden's head (the owner: "have it fly right over the
      // head of the player"), close, then away over the slope below: big, slow, heavy wing-beats.
      // Where the warden stood as it came out is kept, so the pass is over them; it stays well
      // above the head (its wingtips at least a metre clear), and it never touches anything.
      const u = clamp(bt.t / ROAD.bats.giant);
      if (!giantOver) {
        const px = sim.player ? sim.player.x : BATS_X; const pz = sim.player ? sim.player.z : 68;
        giantOver = { x: px, z: pz, y: (sim.player ? sim.player.y : roadY) + EYE_UP + GIANT_CLEAR };
      }
      const H = giantOver;
      const ax = cv.x; const ay = roadY + 1.7; const az = cv.z + 0.9; // the mouth
      const ex = H.x + (H.x - cv.x) * 0.9; const ey = H.y + 5; const ez = H.z + 16; // away down the slope
      // a curve through the mouth, the point over the head (at u = 0.5) and away
      const cx = 2 * H.x - (ax + ex) / 2; const cy = 2 * H.y - (ay + ey) / 2; const cz = 2 * H.z - (az + ez) / 2;
      const a1 = (1 - u) * (1 - u); const a2 = 2 * u * (1 - u); const a3 = u * u;
      const x = a1 * ax + a2 * cx + a3 * ex;
      const y = a1 * ay + a2 * cy + a3 * ey;
      const z = a1 * az + a2 * cz + a3 * ez;
      giant.position.set(x, y, z);
      // facing along its flight (its head is its local -z)
      const tx = 2 * (1 - u) * (cx - ax) + 2 * u * (ex - cx); const ty = 2 * (1 - u) * (cy - ay) + 2 * u * (ey - cy); const tz = 2 * (1 - u) * (cz - az) + 2 * u * (ez - cz);
      const yaw = Math.atan2(-tx, -tz);
      // banked ~0.6 rad, its wing on the warden's side down, so its spread is seen and not its
      // edge (review A10): the side found from the eye in the bat's own frame
      let roll = 0;
      if (eye) {
        const side = (eye.x - x) * Math.cos(yaw) - (eye.z - z) * Math.sin(yaw);
        roll = -Math.sign(side || 1) * 0.6 * smooth(u / 0.15);
      }
      giant.rotation.set(clamp(Math.atan2(ty, Math.hypot(tx, tz)), -0.4, 0.4), yaw, roll);
      // ~1.6 Hz, wings spread at the start; each downstroke passes level on a cue beat (A9)
      const flap = Math.sin(bt.t * GIANT_FLAP.rate) * 0.9;
      wings[0].rotation.z = -flap;
      wings[1].rotation.z = flap;
      // the hands hang a little and trail the arms, so even level and edge-on the wings show
      // their bend and not one flat line
      const fold = -0.2 + 0.4 * Math.sin(bt.t * GIANT_FLAP.rate - 0.9);
      hands[0].rotation.z = -fold;
      hands[1].rotation.z = fold;
    }
  }

  return { group, update };
}
