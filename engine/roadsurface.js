// The road's own surface and the clutter along it (issue #29, the owner: "add some variability to
// the road, ruts, potholes, rocks etc. a few man made derelicts (don't over do it) such as a broken
// wagon barrels or something would add to the dread. this applies to the entire road"; the critic's
// P3-7: carry the ruts and the ragged edge up the top stretch to the gate's plinth).
//
// buildRoadSurface: the rutted dirt road, foot to gate, as one vertex-coloured mesh. The ruts wander
// along it (in place, width, depth and darkness), one doubles here and there or wears away, a few
// shallow potholes hold dark standing water, loose stone breaks out in patches, the verges are
// scuffed bare where wheels have dragged them, and the edge is ragged into the dead grass. The top
// stretch is the same road, up to the last 3 m that go to the approach's rock. The surface stays
// within 0.08 m of the logic floor (road.js heightAt), so the warden's feet neither sink nor float.
//
// buildRoadProps: small stones on the road's edges (never more than a few centimetres high on the
// road) and bigger ones off it, and four derelicts placed with intent, one to a stretch of the climb:
// a broken milestone at the foot, old barrels on leg 2, a cart tipped over on the verge below leg 3
// with its wheel off beside it, and a broken wheel left against a snapped dead tree at the last hairpin.
// Props only: nothing here collides or hurts, all of it off the road's walk path, clear of the cave's
// mouth, the boulder's fall and the tunnel at the foot. One geometry, one draw call.

import * as THREE from 'three';
import * as S from './sculpt.js';
import { LINE, RECTS, ROAD, LENGTH, stationAt, pointAt, heightAt, onRoad, rectAt, BOULDER_X, BOULDER_DIR } from '../logic/road.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const G = (hex) => new THREE.Color(hex);
// The road's own tones, as roadview.js had them.
const DIRT = G(0x625646);
const RUT = G(0x332b22);
const CROWN = G(0x5d5a3e); // the dead grass between the ruts
const GROUND = G(0x403d31); // the hill's dead grass (roadview.js buildHill), which the edge runs into
const RUT_NIGHT = G(0x120f0c); // the ruts cut darker the higher they are, to still read at night (A15)
const APPROACH = G(0x4b4d4f); // the approach's bare rock: the last 3 m go to it, no seam
// What is new: standing water, the mud round it, loose grit and the scuffed verge.
const PUDDLE = G(0x2e3132); // dark, cold and damp: never black
const MUD = G(0x473c30); // the churned lip of a pothole
const GRIT = G(0x7c7466); // loose stone broken out of the road
const SCUFF = G(0x6f6352); // a verge dragged bare by wheels
// The derelicts: weathered wood gone silvery grey-brown (never near-black), rusted iron, old stone.
const WOOD = 0x5a5249;
const IRON = 0x3a2e27;
const MILESTONE = 0x7a756c;
const SNAG = 0x3a332d; // the snapped dead tree: the banks' bark, a shade lighter so it reads

const STEP = 0.6; // metres between rows along the road (the ruts run along it: they need columns, not rows)
// Across the road, from the centreline out (both ways): close together through the ruts (about
// 0.75 m out, wandering 0.67 to 0.83, doubling to about 1.07) so they are drawn (roadview.js's
// 0.5 m grid fell either side of them), and out to the ragged edge. 1.5 is the top stretch's edge.
const ACROSS = [0, 0.4, 0.6, 0.72, 0.84, 0.98, 1.14, 1.5, 1.75, 2.0];

// ---- the cross-road coordinate ----------------------------------------------------------------

const SEGS = [];
for (let i = 0; i + 1 < LINE.length; i++) {
  const [ax, az] = LINE[i];
  const [bx, bz] = LINE[i + 1];
  const len = Math.hypot(bx - ax, bz - az);
  SEGS.push({ ax, az, len, dx: (bx - ax) / len, dz: (bz - az) / len });
}

/** Metres across the road from the nearest centreline, signed (roadview.js nearest's u1). */
function acrossOwn(x, z) {
  let best = Infinity; let u = 0;
  for (const g of SEGS) {
    const t = clamp(((x - g.ax) * g.dx + (z - g.az) * g.dz) / g.len);
    const px = g.ax + g.dx * g.len * t;
    const pz = g.az + g.dz * g.len * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; u = (x - px) * -g.dz + (z - pz) * g.dx; }
  }
  return u;
}

/** The road's half-width `s` metres up: 2 m, narrowing to 1.5 m as the top stretch begins (z 54). */
function halfAt(s) {
  return lerp(2, 1.5, smooth(s - (LENGTH - 11)));
}

// ---- potholes ---------------------------------------------------------------------------------

/**
 * A few shallow potholes the length of the road (fixed: the same every run): 0.6 to 1.2 m long, a
 * little longer along the road than across it, at most 6 cm deep, half of them in a rut where the
 * wheels have worn them. None in a bend (the corner squares), in the tunnel, or in the last 4 m.
 */
const HOLES = (() => {
  const rnd = S.rng(5303);
  const out = [];
  const N = 14;
  for (let tries = 0; out.length < N && tries < 600; tries++) {
    const s = 4 + (LENGTH - 10) * ((out.length + rnd()) / N); // spread up the whole road, one to each 25 m or so
    const r = 0.3 + rnd() * 0.3;
    const depth = 0.03 + rnd() * 0.03;
    const stretch = 1 + rnd() * 0.5;
    const inRut = rnd() < 0.5;
    const side = rnd() < 0.5 ? -1 : 1;
    const jig = rnd();
    const half = halfAt(s);
    const u = inRut ? side * (0.72 + jig * 0.1) : (jig * 2 - 1) * (half - 0.5 - r);
    if (Math.abs(u) + r > half - 0.3) continue;
    const p = pointAt(s);
    const x = p.x - p.dz * u;
    const z = p.z + p.dx * u;
    const reach = r * stretch + 0.25;
    if (LINE.slice(1, -1).some(([lx, lz]) => Math.max(Math.abs(x - lx), Math.abs(z - lz)) < 2 + reach)) continue;
    if (rectAt(x, z) < 0 || x > 41 || s > LENGTH - 4) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r * o.stretch + reach + 2)) continue;
    out.push({ s, u, r, depth, stretch, x, z, dx: p.dx, dz: p.dz });
  }
  return out;
})();

const _hole = { dip: 0, wet: 0, lip: 0 };
/** The potholes at (x, z): how deep (dip, metres), how wet the floor (0 to 1) and the muddy lip (0 to 1). */
function holeAt(x, z) {
  _hole.dip = 0; _hole.wet = 0; _hole.lip = 0;
  for (const o of HOLES) {
    const ex = x - o.x; const ez = z - o.z;
    if (Math.abs(ex) > 1.5 || Math.abs(ez) > 1.5) continue;
    const a = (ex * o.dx + ez * o.dz) / (o.r * o.stretch);
    const b = (ex * -o.dz + ez * o.dx) / o.r;
    const d2 = a * a + b * b;
    const k = 1 - d2;
    if (k > 0) {
      _hole.dip = Math.max(_hole.dip, o.depth * smooth(k / 0.6)); // a dish with a flat wet floor
      _hole.wet = Math.max(_hole.wet, smooth((k - 0.25) / 0.4) * (0.8 + 0.2 * S.noise(x * 4, 2, z * 4, 77)));
    }
    _hole.lip = Math.max(_hole.lip, clamp(1 - Math.abs(d2 - 1) / 0.7));
  }
  return _hole;
}

// ---- the surface ------------------------------------------------------------------------------

const _rut = new THREE.Color();
const _grass = new THREE.Color();
/**
 * The road at (x, z), `u` metres across it: out.y (the surface) and out.c (its colour). Everything
 * wanders with the station (metres up the road), so the ruts run unbroken through the bends.
 */
function surfaceAt(x, z, u, out) {
  const st = stationAt(x, z);
  const a = Math.abs(u);
  const sd = u < 0 ? 7 : 0; // each rut wanders on its own
  const half = halfAt(st);
  const dk = smooth(st / LENGTH);
  // The ruts: their line, width, depth and darkness wander; here and there one wears away to almost
  // nothing, and elsewhere a second track has been cut just outside it.
  const c = 0.75 + 0.08 * S.noise(st * 0.09, sd, 0.5, 41);
  const w = 0.19 + 0.05 * S.noise(st * 0.13, sd, 1.5, 43);
  const fade = 0.2 + 0.8 * smooth((S.noise(st * 0.03, sd, 3.5, 53) + 0.55) / 0.35);
  const wear = (0.85 + 0.3 * S.noise(st * 0.05, sd, 2.5, 47)) * fade;
  const dbl = smooth((S.noise(st * 0.04, sd, 4.5, 59) - 0.3) / 0.25);
  const r1 = smooth(1 - Math.abs(a - c) / w) * wear;
  const r2 = smooth(1 - Math.abs(a - c - 0.32) / (w * 0.8)) * dbl * 0.65;
  const flat = 1 - smooth((st - (LENGTH - 1.5)) / 1.5); // level onto the approach's plinth
  const rut = Math.max(r1, r2) * flat;
  // The ragged edge: where the dirt gives way to the dead grass wanders in and out.
  const e0 = half - 0.55 + 0.17 * S.noise(st * 0.4, sd, 5.5, 61);
  const edge = smooth((a - e0) / (half - e0));
  // Dead grass along the crown, thicker and thinner.
  const crown = a < 0.45 ? 0.55 * (1 - a / 0.45) * clamp(0.7 + 0.5 * S.noise(x * 0.7, 9, z * 0.7, 63)) : 0;
  // The verge outside the ruts, scuffed bare in streaks along the road.
  const scuff = smooth((a - c - 0.2) / 0.2) * (1 - edge);
  const streak = S.noise(st * 0.7, a * 3, 6.5, 67);
  // Patches of loose stone broken out of the road.
  const stony = smooth((S.noise(x * 0.21, 7.5, z * 0.21, 71) - 0.2) / 0.3);
  const speck = S.noise(x * 3.3, 8.5, z * 3.3, 73);
  const h = holeAt(x, z);
  const dig = Math.max(0.065 * rut, h.dip * flat + 0.025 * rut);
  const dy = -dig + 0.02 * S.noise(x * 2, 0, z * 2, 9) - 0.03 * edge + 0.01 * stony * speck + 0.008 * scuff * streak;
  out.y = heightAt(st) + clamp(dy, -0.078, 0.03);
  const col = out.c;
  col.copy(DIRT).lerp(CROWN, crown);
  col.lerp(_rut.copy(RUT).lerp(RUT_NIGHT, dk), clamp(rut) * (0.85 + 0.15 * dk));
  if (scuff > 0) col.lerp(SCUFF, scuff * clamp(0.15 + 0.45 * streak, 0, 0.6));
  if (stony > 0) col.lerp(GRIT, stony * clamp(0.25 + 0.4 * speck, 0, 0.65));
  col.multiplyScalar(0.88 + 0.22 * S.noise(x * 0.9, 3, z * 0.9, 13));
  col.lerp(MUD, h.lip * 0.45).lerp(PUDDLE, h.wet * 0.9);
  // the edge goes to the hill's own mottled dead grass, so the straight cut of the mesh is lost in it
  _grass.copy(GROUND).multiplyScalar(0.85 + 0.25 * S.noise(x * 0.3, 4, z * 0.3, 11));
  col.lerp(_grass, edge * 0.85);
  col.lerp(APPROACH, smooth((st - (LENGTH - 3)) / 3));
  return out;
}

/** The offsets across a stretch `half` metres wide each side, in order. */
function offsets(half) {
  const o = [];
  for (const a of ACROSS) if (a <= half + 1e-6) { o.push(a); if (a) o.push(-a); }
  return o.sort((p, q) => p - q);
}

/** `fixed` rows (kept exactly: they meet the next stretch's), with the `extra` rows not too near any other. */
function rowsOf(fixed, extra) {
  const out = [...fixed];
  for (const e of extra) if (out.every((f) => Math.abs(f - e) > 0.08)) out.push(e);
  return out.sort((p, q) => p - q);
}

/** Evenly spaced rows from a to b, both ends included, about STEP apart. */
function even(a, b) {
  const n = Math.max(1, Math.round((b - a) / STEP));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(a + (b - a) * (k / n));
  return out;
}

/**
 * The road's surface, foot to gate: one grid per stretch, merged (position, normal, color). A
 * drop-in for roadview.js buildRoad(). h: { nearest } (roadview.js), for the across-road
 * coordinate; without it this file's own copy is used.
 */
export function buildRoadSurface(h = {}) {
  const across = h.nearest ? (x, z) => h.nearest(x, z).u1 : acrossOwn;
  const parts = [];
  const at = { y: 0, c: new THREE.Color() };
  RECTS.forEach((r, i) => {
    const leg = i % 2 === 0 && i < RECTS.length - 1; // the legs run along x; the hairpins and the top along z
    let xs; let zs;
    if (leg) {
      zs = offsets((r.maxZ - r.minZ) / 2).map((o) => (r.minZ + r.maxZ) / 2 + o);
      // Where a turn meets this leg (its corner square), the leg's columns are the turn's own.
      const fixed = []; const sq = [];
      for (const j of [i - 1, i + 1]) {
        const t = RECTS[j];
        if (!t || t.minX < r.minX - 1e-9 || t.maxX > r.maxX + 1e-9) continue;
        sq.push([t.minX, t.maxX]);
        fixed.push(...offsets((t.maxX - t.minX) / 2).map((o) => (t.minX + t.maxX) / 2 + o));
      }
      sq.sort((p, q) => p[0] - q[0]);
      let from = r.minX;
      for (const [a, b] of sq) { if (a > from + 1e-9) fixed.push(...even(from, a)); from = b; }
      if (r.maxX > from + 1e-9) fixed.push(...even(from, r.maxX));
      const extra = [];
      for (const o of HOLES) if (rectAt(o.x, o.z) === i) for (const t of [-0.85, -0.45, 0, 0.45, 0.85]) extra.push(o.x + o.dx * t * o.r * o.stretch);
      xs = rowsOf([...new Set(fixed.map((v) => Math.round(v * 1e6) / 1e6))], extra);
    } else {
      xs = offsets((r.maxX - r.minX) / 2).map((o) => (r.minX + r.maxX) / 2 + o);
      const extra = [];
      for (const o of HOLES) if (rectAt(o.x, o.z) === i) for (const t of [-0.85, -0.45, 0, 0.45, 0.85]) extra.push(o.z + o.dz * t * o.r * o.stretch);
      zs = rowsOf(even(r.minZ, r.maxZ), extra);
    }
    const nx = xs.length; const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let k = 0; k < nx; k++) {
        const x = xs[k]; const z = zs[j];
        surfaceAt(x, z, across(x, z), at);
        const o = (j * nx + k) * 3;
        pos[o] = x; pos[o + 1] = at.y; pos[o + 2] = z;
        col[o] = at.c.r; col[o + 1] = at.c.g; col[o + 2] = at.c.b;
      }
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let k = 0; k < nx - 1; k++) {
        const a = j * nx + k; const b = a + 1; const cc = a + nx; const d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  });
  const out = S.merge(parts);
  out.userData.potholes = HOLES.map((o) => ({ x: o.x, z: o.z, r: o.r, depth: o.depth }));
  return out;
}

/** The road's surface height at (x, z) (on the road): what the props sit on. */
function roadY(x, z) {
  const at = { y: 0, c: new THREE.Color() };
  return surfaceAt(x, z, acrossOwn(x, z), at).y;
}

// ---- the props: stones ------------------------------------------------------------------------

/** A stone: a squashed, knobbled low polyhedron (an octahedron for a pebble), flat shaded. */
function stone(x, y, z, r, hex, seed, big) {
  const g = big ? new THREE.IcosahedronGeometry(r, 0) : new THREE.OctahedronGeometry(r, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + 0.45 * S.noise(p.getX(i) / r * 1.5 + seed, p.getY(i) / r * 1.5, p.getZ(i) / r * 1.5, seed);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  g.rotateY(seed * 2.399);
  g.computeVertexNormals();
  return S.tint(g.translate(x, y, z), hex, 0.22, seed);
}

// What the props keep clear of. The cave's mouth (5 m round it), the boulder's fall across leg 2
// (from 6 m behind its trigger point to 16 m on, from the outcrop on the bank to below the road),
// the tunnel at the road's foot, and the approach.
const MOUTH = { x: ROAD.bats.cave.x, z: ROAD.bats.cave.z + 1 };
const BOULDER_LO = Math.min(BOULDER_X - 6 * BOULDER_DIR, BOULDER_X + 16 * BOULDER_DIR);
const BOULDER_HI = Math.max(BOULDER_X - 6 * BOULDER_DIR, BOULDER_X + 16 * BOULDER_DIR);
function keptClear(x, z, r = 0) {
  if (Math.hypot(x - MOUTH.x, z - MOUTH.z) < 5 + r) return true;
  if (x > BOULDER_LO - r && x < BOULDER_HI + r && z > 82 - r && z < 106 + r) return true;
  if (x > 41 - r && z > 96 && z < 112) return true; // the tunnel at the foot
  return z < 46 + r;
}

/** Metres from (x, z) to the road's floor (0 on it). */
function offRoad(x, z) {
  let best = Infinity;
  for (const r of RECTS) {
    const ex = Math.max(r.minX - x, 0, x - r.maxX);
    const ez = Math.max(r.minZ - z, 0, z - r.maxZ);
    best = Math.min(best, Math.hypot(ex, ez));
  }
  return best;
}

/**
 * Where roadview.js buildTrees stands its dead trees: the same draws from the same seed (2911, its
 * first use), so the props keep off the trunks. Only for keeping clear: if buildTrees changes, a
 * prop may stand against a tree, nothing worse.
 */
function treeSpots() {
  const rnd = S.rng(2911);
  const out = [];
  for (let s = 6; s < LENGTH - 8; s += 7.5 + rnd() * 3) {
    const p = pointAt(s);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 2.8 + rnd() * 3.2;
    const x = p.x + -p.dz * side * off;
    const z = p.z + p.dx * side * off;
    if (onRoad(x, z) || z < 46) continue;
    rnd(); rnd(); // its height and lean
    const limbs = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < limbs * 4; i++) rnd(); // each limb's four draws
    out.push({ x, z });
  }
  return out;
}

// ---- the props: the derelicts -----------------------------------------------------------------

const _c = new THREE.Color();
/** Weathered wood: the silvery grey-brown, each piece a little lighter or darker (k). */
const wood = (g, seed, k = 1) => S.tint(g, _c.set(WOOD).multiplyScalar(k * (0.92 + 0.16 * Math.abs(Math.sin(seed * 12.9898)))).clone(), 0.18, seed);
const iron = (g, seed) => S.tint(g, IRON, 0.25, seed);
const box = (w, hh, d) => new THREE.BoxGeometry(w, hh, d);

/**
 * A cart wheel `R` metres across the rim, in the xy plane (its axle along z), centred at the
 * origin: a wooden felloe with an iron tyre, a hub and spokes. broken: a piece of the rim gone
 * and the spokes there with it, one snapped short.
 */
function wheel(R, seed, broken) {
  const parts = [];
  const arc = broken ? TAU * 0.8 : TAU;
  const turn = broken ? 0.6 : 0; // where the gap is
  parts.push(wood(new THREE.TorusGeometry(R - 0.04, 0.045, 4, 14, arc).rotateZ(turn), seed, 1.05));
  parts.push(iron(new THREE.TorusGeometry(R + 0.005, 0.022, 3, 14, arc).rotateZ(turn), seed + 1));
  parts.push(wood(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 6).rotateX(Math.PI / 2), seed + 2, 0.9));
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * (TAU / n);
    const rel = ((a - turn) % TAU + TAU) % TAU;
    if (broken && rel > arc + 0.05) continue; // gone with the rim
    const len = broken && i === 2 ? (R - 0.1) * 0.45 : R - 0.1; // one snapped short
    const g = box(0.04, len, 0.03).translate(0, 0.07 + len / 2, 0).rotateZ(a - Math.PI / 2);
    parts.push(wood(g, seed + 3 + i, 0.95));
  }
  return parts;
}

/**
 * The broken cart, tipped over on its side down the bank (its open bed away from the road, its
 * underside and axle to it), one wheel still on the axle up in the air, the other off and lying
 * flat beside it, a shaft snapped, a side board split and a plank thrown clear. Local: +x along
 * the road, +z away from it, the ground at y 0.
 */
function brokenCart() {
  const cart = [];
  const L = 2.0; const W = 1.15;
  // the bed on its axle: floor planks, two-board sides (the far upper board split off short), the front
  for (let i = 0; i < 4; i++) cart.push(wood(box(L, 0.05, W / 4 - 0.015).translate(0, 0.6, -W / 2 + W / 8 + (i * W) / 4), 10 + i));
  cart.push(wood(box(L, 0.2, 0.05).translate(0, 0.72, -W / 2), 20), wood(box(L, 0.2, 0.05).translate(0, 0.93, -W / 2), 21));
  cart.push(wood(box(L, 0.2, 0.05).translate(0, 0.72, W / 2), 22), wood(box(1.1, 0.2, 0.05).rotateZ(0.12).translate(-0.4, 0.95, W / 2), 23));
  cart.push(wood(box(0.05, 0.42, W).translate(L / 2, 0.82, 0), 24));
  cart.push(wood(box(0.09, 0.09, W + 0.5).translate(0, 0.5, 0), 25, 0.85)); // the axle
  cart.push(...wheel(0.5, 30, true).map((g) => g.translate(0, 0.5, -W / 2 - 0.3))); // the near wheel, still on
  // the shafts out of the front: one whole, one snapped and splintered
  cart.push(wood(box(1.7, 0.07, 0.07).translate(L / 2 + 0.85, 0.62, -0.4), 40, 0.95));
  cart.push(wood(box(0.7, 0.07, 0.07).rotateY(0.15).translate(L / 2 + 0.35, 0.62, 0.4), 41, 0.95));
  // Tip it over outward, about its far bottom edge, so it lies on its side on the bank.
  const tip = 1.45;
  const tipped = cart.map((g) => g.translate(0, 0, -(W / 2 + 0.1)).rotateX(tip).translate(0, 0, W / 2 + 0.1));
  // and let it down onto its side: its lowest edge a few centimetres into the ground
  let low = Infinity;
  for (const g of tipped) { g.computeBoundingBox(); low = Math.min(low, g.boundingBox.min.y); }
  for (const g of tipped) g.translate(0, -low - 0.06, 0);
  // The wheel that came off, lying flat beside it on the uphill (road) side of the cart's front.
  const off = wheel(0.5, 50, false).map((g) => g.rotateX(-Math.PI / 2 + 0.12).translate(L / 2 + 1.0, 0.06, 0.3));
  // A side board thrown clear.
  const plank = wood(box(1.3, 0.05, 0.2).rotateY(0.5).translate(-L / 2 - 0.6, 0.03, 0.4), 60, 1.05);
  return [...tipped, ...off, plank];
}

/**
 * A barrel `0.8` m tall, its base at the origin: bellied staves, two rusted hoops and a lid.
 * open: staved in (a quarter of the staves gone, the inside showing, no lid).
 */
function barrel(seed, open) {
  const parts = [];
  const prof = [[0.25, 0], [0.285, 0.15], [0.305, 0.4], [0.285, 0.65], [0.25, 0.8]];
  const phi = open ? TAU * 0.74 : TAU;
  const outside = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 10, 0, phi);
  parts.push(wood(outside.deleteAttribute('uv'), seed));
  if (open) {
    // the inside, seen through the gap: a smaller lathe turned inside out, darker
    const inside = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * 0.93, y)), 10, 0, phi);
    const ix = inside.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    inside.deleteAttribute('normal');
    inside.computeVertexNormals();
    parts.push(wood(inside.deleteAttribute('uv'), seed + 1, 0.7));
    // two broken staves lying where they fell, inside it
    parts.push(wood(box(0.08, 0.7, 0.02).rotateZ(1.2).translate(0.05, 0.18, 0.05), seed + 2, 0.9));
  } else {
    parts.push(wood(new THREE.CircleGeometry(0.25, 10).rotateX(-Math.PI / 2).translate(0, 0.79, 0), seed + 3, 0.85));
  }
  for (const [y, r] of [[0.1, 0.28], [0.7, 0.28]]) {
    parts.push(iron(new THREE.CylinderGeometry(r, r, 0.05, 10, 1, true, 0, phi).translate(0, y, 0), seed + 4));
  }
  return parts;
}

/** Old barrels left at the roadside: two standing (one leaning), one on its side staved in, loose staves. */
function barrels() {
  const parts = [];
  parts.push(...barrel(70, false));
  parts.push(...barrel(80, false).map((g) => g.rotateZ(0.14).rotateY(0.7).translate(0.62, 0, 0.34)));
  // the third on its side, its broken staves up to the sky
  parts.push(...barrel(90, true).map((g) => g.translate(0, -0.4, 0).rotateX(Math.PI / 2).rotateY(2.1).translate(-0.85, 0.29, 0.55)));
  parts.push(wood(box(0.08, 0.02, 0.78).rotateY(0.9).translate(-0.3, 0.02, -0.25), 95, 1.05));
  parts.push(wood(box(0.08, 0.02, 0.76).rotateY(-0.4).translate(-1.5, 0.02, 0.2), 96, 1.05));
  return parts;
}

/** A milestone, its face to the road: the stump of it leaning in the ground, the rounded top broken off beside it. */
function brokenMilestone() {
  const stoneTint = (g, seed) => S.tint(g, MILESTONE, 0.2, seed);
  const post = box(0.36, 0.62, 0.24, 1, 2, 1).translate(0, 0.23, 0);
  const p = post.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0.5) continue; // the break: a jagged top
    p.setY(i, p.getY(i) - 0.05 + 0.09 * S.noise(p.getX(i) * 9, 1, p.getZ(i) * 9, 81));
  }
  post.computeVertexNormals();
  const parts = [stoneTint(post.rotateZ(-0.12).rotateX(0.08), 82)];
  // the broken-off top, lying on its back
  const top = S.merge([
    stoneTint(box(0.36, 0.26, 0.24).translate(0, 0.13, 0), 83),
    stoneTint(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 8, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, 0.26, 0), 84),
  ]);
  parts.push(top.rotateZ(Math.PI / 2 + 0.25).rotateY(0.5).translate(0.62, 0.15, 0.22));
  return parts;
}

/** A dead tree snapped off at chest height, a splinter standing from the break, and a broken wheel left against it. */
function wheelAgainstSnag() {
  const parts = [];
  const h = 1.5;
  const snag = new THREE.CylinderGeometry(0.15, 0.24, h, 6, 3).translate(0, h / 2, 0);
  const p = snag.attributes.position;
  for (let i = 0; i < p.count; i++) { // crooked, the break ragged
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(t * 3.1) * 0.06 * t);
    if (t > 0.99) p.setY(i, p.getY(i) + 0.18 * S.noise(p.getX(i) * 11, 2, p.getZ(i) * 11, 91));
  }
  snag.deleteAttribute('uv');
  snag.computeVertexNormals();
  parts.push(S.tint(snag, SNAG, 0.25, 92));
  parts.push(S.tint(new THREE.ConeGeometry(0.06, 0.45, 4).translate(0.06, h + 0.2, 0.03), SNAG, 0.2, 93));
  // The wheel leans back against the trunk from the road's side, its foot on the ground.
  const R = 0.5; const lean = 0.3;
  const zc = -0.2 - R * Math.sin(lean) - 0.05;
  parts.push(...wheel(R, 100, true).map((g) => g.rotateX(lean).translate(0.04, R * Math.cos(lean) + 0.01, zc)));
  return parts;
}

/**
 * Where each derelict goes: `s` metres up the road, on `side` of it (+1 the centreline's left, as
 * roadview.js's nearest measures u), stood off the road's edge by `gap` metres past its own reach.
 * lie: how far it lies with the ground's fall (1, a wreck on its side) or stands upright (0).
 */
const DERELICTS = [
  // at the foot, a few steps out of the tunnel: the road's last milestone, broken, on the level
  // verge below the road (the bank above is too steep for a stone to stand)
  { name: 'broken milestone', s: 13, side: -1, gap: 0.45, lie: 0, build: brokenMilestone },
  // leg 2, before the boulder's stretch: old barrels on the downhill verge, one staved in
  { name: 'old barrels', s: 102, side: 1, gap: 0.4, lie: 0.4, build: barrels },
  // leg 3, east of the boulder's outcrop where the verge is level: a cart gone off the road and
  // tipped over on the downhill side, a wheel off beside it, seen from leg 3 and up from leg 2
  { name: 'tipped cart', s: 172, side: -1, gap: 0.45, lie: 1, build: brokenCart },
  // the last hairpin before the top (x 31, z 58 to 66), on its outer side: a wheel against a snag
  { name: 'wheel against a dead tree', s: 307, side: 1, gap: 0.45, lie: 0, build: wheelAgainstSnag },
];

/**
 * Places a local prop (x along the road, z away from it) with its origin at (x, z): tilted to the
 * ground's fall under the middle of its footprint, then let down until it is dug in a little (a
 * few of its lowest points go into the ground, so it lies on the bank rather than resting on one
 * corner above it).
 */
function setOnBank(parts, x, z, dx, dz, side, hill, lie = 1) {
  const X = new THREE.Vector3(side * dx, 0, side * dz);
  const Z = new THREE.Vector3(side * -dz, 0, side * dx);
  const box3 = new THREE.Box3();
  for (const q of parts) { q.computeBoundingBox(); box3.union(q.boundingBox); }
  const ca = (box3.min.x + box3.max.x) / 2; const co = (box3.min.z + box3.max.z) / 2;
  const g = (a, o) => hill(x + X.x * (ca + a) + Z.x * (co + o), z + X.z * (ca + a) + Z.z * (co + o));
  const across = lie * Math.atan(clamp((g(0, 0.9) - g(0, -0.9)) / 1.8, -0.7, 0.7));
  const along = lie * Math.atan(clamp((g(0.9, 0) - g(-0.9, 0)) / 1.8, -0.7, 0.7));
  const m = new THREE.Matrix4().makeTranslation(x + X.x * ca + Z.x * co, g(0, 0), z + X.z * ca + Z.z * co)
    .multiply(new THREE.Matrix4().makeBasis(X, UP, Z))
    .multiply(new THREE.Matrix4().makeRotationZ(along))
    .multiply(new THREE.Matrix4().makeRotationX(-across))
    .multiply(new THREE.Matrix4().makeTranslation(-ca, 0, -co));
  const geo = S.merge(parts.map((q) => q.applyMatrix4(m)));
  const p = geo.attributes.position;
  const clear = [];
  for (let i = 0; i < p.count; i++) clear.push(p.getY(i) - hill(p.getX(i), p.getZ(i)));
  clear.sort((a, b) => a - b);
  geo.translate(0, -0.02 - clear[Math.floor(clear.length * 0.06)], 0);
  return geo;
}

/** True when every vertex of `geo` stands 0.3 m or more off the road and out of the kept-clear places. */
function standsClear(geo, trees) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const z = p.getZ(i);
    if (offRoad(x, z) < 0.3 || keptClear(x, z)) return false;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 0.45)) return false;
  }
  return true;
}

/**
 * The clutter along the road: small stones on its edges and in its stony patches (no more than
 * 5 cm proud of the road), bigger stones on the verges and banks off it, and the derelicts. One
 * merged geometry (position, normal, color) for one MeshStandardMaterial (vertexColors, roughness
 * about 0.92). h: { hillAt } (roadview.js), the ground off the road. Returns { geometry,
 * triangles, derelicts: [{ name, x, z, s }] }.
 */
export function buildRoadProps(h = {}) {
  const hill = h.hillAt || ((x, z) => heightAt(stationAt(x, z)) - 0.04);
  const rnd = S.rng(6131);
  const parts = [];
  const trees = treeSpots();
  // Pebbles on the road: along its edges, where the wheels have thrown them, and in the stony patches.
  for (let n = 0, tries = 0; n < 150 && tries < 1200; tries++) {
    const s = 1 + rnd() * (LENGTH - 4);
    const side = rnd() < 0.5 ? -1 : 1;
    const half = halfAt(s);
    const inPatch = rnd() < 0.3;
    const a = inPatch ? rnd() * (half - 0.1) : half - 0.05 - rnd() * 0.55;
    const r = 0.035 + rnd() * 0.04;
    const p = pointAt(s);
    const x = p.x - p.dz * side * a;
    const z = p.z + p.dx * side * a;
    if (!onRoad(x, z) || keptClear(x, z, 0)) continue;
    if (inPatch && S.noise(x * 0.21, 7.5, z * 0.21, 71) < 0.3) continue; // only where the road has broken up
    parts.push(stone(x, roadY(x, z) - r * 0.3, z, r, rnd() < 0.5 ? 0x6e675d : 0x7d776c, 300 + n, false));
    n++;
  }
  // Stones off the road: on the verges just past the edge, a few bigger ones further up the banks.
  for (let n = 0, tries = 0; n < 85 && tries < 900; tries++) {
    const s = 2 + rnd() * (LENGTH - 6);
    const side = rnd() < 0.5 ? -1 : 1;
    const big = rnd() < 0.3;
    const r = big ? 0.25 + rnd() * 0.25 : 0.09 + rnd() * 0.12;
    const off = halfAt(s) + r + 0.15 + rnd() * (big ? 2.2 : 0.9);
    const p = pointAt(s);
    const x = p.x - p.dz * side * off;
    const z = p.z + p.dx * side * off;
    if (offRoad(x, z) < r + 0.1 || keptClear(x, z, r)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < r + 0.4)) continue;
    parts.push(stone(x, hill(x, z) + r * 0.12, z, r, big ? 0x625d56 : 0x6b655d, 600 + n, true));
    n++;
  }
  // The derelicts: each where it is meant to be, nudged along the road if a tree or the rules are in the way.
  const placed = [];
  const taken = [];
  for (const d of DERELICTS) {
    let done = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const s = d.s + k * 1.5;
      const p = pointAt(s);
      const local = d.build();
      // how far it reaches back toward the road (local -z), so its near side stands `gap` off the edge
      let reach = 0;
      for (const g of local) { g.computeBoundingBox(); reach = Math.max(reach, -g.boundingBox.min.z); }
      const off = halfAt(s) + d.gap + reach;
      const x = p.x - p.dz * d.side * off;
      const z = p.z + p.dx * d.side * off;
      const geo = setOnBank(local, x, z, p.dx, p.dz, d.side, hill, d.lie);
      if (!standsClear(geo, trees)) continue;
      done = { geo, name: d.name, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, s: Math.round(s * 10) / 10 };
      break;
    }
    if (!done) { console.warn(`roadsurface: no clear place for the ${d.name}`); continue; }
    taken.push(done.geo);
    placed.push({ name: done.name, x: done.x, z: done.z, s: done.s });
  }
  const geometry = S.merge([...parts, ...taken]);
  const triangles = geometry.index.count / 3;
  geometry.userData.derelicts = placed;
  return { geometry, triangles, derelicts: placed };
}
