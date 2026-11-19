// The werewolf's claw scores in the tea room's flags (issue #16), as pure maths: no three, so a Node test
// can check them. keepprops.js turns these rings into decal geometry. The talons are the arm's own
// (keepmap.js WEREWOLF_CLAW, read by keepcast.js too): four fanned at its spread, the outer pair shorter,
// each tapering to a point.

import { WEREWOLF_CLAW } from './keepmap.js';

// The arm is stretched along its swipe (keepcast.js scales it by about 1.4), so its talons reach further on
// screen than WEREWOLF_CLAW.length; the scores are cut at the length the player sees.
export const RAKE_STRETCH = 1.3;
export const RAKE_ROOT_PITCH = 0.26; // sideways gap between talon roots per unit of f (the outer pair sit at +-0.13 m)
export const RAKE_SEGS = 6;
export const RAKE_Y = Object.freeze({ rim: 0.004, chip: 0.005, groove: 0.007 }); // 3 mm steps; the decal's polygonOffset covers them

/**
 * One paw print. Lands at (gx, gz) and is dragged toward `dir` (radians; +x is 0, +z is pi/2). `fingers` picks
 * the talons that landed (indices 0..3). rand() -> [0,1). Returns
 *   { scores: [{ f, yaw, len, root: [x,z], mid: [[x,z]...], rimL, rimR, grooveL, grooveR, shade: [..], chips: [[[x,z]x3]...] }], reach: [[x,z]...] }
 * where reach lists every point the print touches (for the wall check).
 */
export function rakeScores(rand, gx, gz, dir, fingers = [0, 1, 2, 3], scale = 1) {
  const C = WEREWOLF_CLAW; const scores = []; const reach = [];
  const curve = (rand() - 0.5) * 0.12; // the swipe's arc, shared by all the talons so they stay one hand
  for (const i of fingers) {
    const f = C.fingers > 1 ? i / (C.fingers - 1) - 0.5 : 0;
    const yaw = dir + f * C.spread * 2;
    const len = C.length * RAKE_STRETCH * (1 - 0.25 * Math.abs(f)) * scale;
    const dx = Math.cos(yaw); const dz = Math.sin(yaw); const nx = -dz; const nz = dx; // along the score, and across it
    const rx = gx + Math.cos(dir + Math.PI / 2) * f * RAKE_ROOT_PITCH;
    const rz = gz + Math.sin(dir + Math.PI / 2) * f * RAKE_ROOT_PITCH;
    const w0 = 0.032 * (0.9 + rand() * 0.2);
    const s = { f, yaw, len, root: [rx, rz], mid: [], rimL: [], rimR: [], grooveL: [], grooveR: [], shade: [], chips: [] };
    for (let k = 0; k <= RAKE_SEGS; k++) {
      const t = k / RAKE_SEGS;
      const cx = rx + dx * len * t + nx * curve * t * t * len + nx * (rand() - 0.5) * 0.008;
      const cz = rz + dz * len * t + nz * curve * t * t * len + nz * (rand() - 0.5) * 0.008;
      const gw = w0 * (1 - Math.pow(t, 1.3)) + 0.0015; // a needle point
      const rw = gw * (2.5 - 1.2 * t) + 0.004; // the torn rim: wide at the root, closing on the groove at the tip
      const jl = 1 + (rand() - 0.5) * 0.6; const jr = 1 + (rand() - 0.5) * 0.6; // ragged, each edge its own
      s.mid.push([cx, cz]);
      s.rimL.push([cx + nx * rw * jl, cz + nz * rw * jl]); s.rimR.push([cx - nx * rw * jr, cz - nz * rw * jr]);
      s.grooveL.push([cx + nx * gw, cz + nz * gw]); s.grooveR.push([cx - nx * gw, cz - nz * gw]);
      s.shade.push(1 + (rand() - 0.5) * 0.12);
      reach.push(s.rimL[k], s.rimR[k]);
    }
    // a few flakes knocked out beside the deepest part (0.03 to 0.05 m: smaller vanishes at a few metres)
    const flakes = 2 + Math.floor(rand() * 2);
    for (let c = 0; c < flakes; c++) {
      const t = 0.1 + rand() * 0.35; const side = rand() < 0.5 ? -1 : 1;
      const off = w0 * 2.4 + rand() * 0.03;
      const px = rx + dx * len * t + nx * side * off; const pz = rz + dz * len * t + nz * side * off;
      const sz = 0.03 + rand() * 0.02; const a0 = rand() * Math.PI * 2;
      const tri = [0, 1, 2].map((q) => [px + Math.cos(a0 + q * 2.1) * sz * (0.6 + rand() * 0.6), pz + Math.sin(a0 + q * 2.1) * sz * (0.6 + rand() * 0.6)]);
      s.chips.push(tri); reach.push(...tri);
    }
    scores.push(s);
  }
  return { scores, reach };
}

/**
 * A flat strip between left and right edge points, one pair per ring, lying at height y and wound to face up
 * (+y): a decal is one-sided, and a face that points down is culled to nothing.
 * Returns { positions: number[], index: number[] }.
 */
export function stripMesh(left, right, y) {
  const positions = []; const index = [];
  for (let i = 0; i < left.length; i++) positions.push(left[i][0], y, left[i][1], right[i][0], y, right[i][1]);
  for (let i = 0; i < left.length - 1; i++) { const a = i * 2; index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const at = (v) => [positions[v * 3], positions[v * 3 + 2]];
  for (let k = 0; k < index.length; k += 3) { // wind each triangle up on its own, so a ragged edge can never flip one under
    const [x0, z0] = at(index[k]); const [x1, z1] = at(index[k + 1]); const [x2, z2] = at(index[k + 2]);
    if ((z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0) < 0) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t; }
  }
  return { positions, index };
}

export const GOUGE_PRINT_COUNT = 2;
const GOUGE_PRINT_ANGLES = Object.freeze([Math.PI - 0.55, Math.PI + 0.55]);

export function gougePlan(rand, gc, wf, reach, room) {
  const plan = [];
  for (let i = 0; i < GOUGE_PRINT_COUNT; i++) {
    const a = GOUGE_PRINT_ANGLES[i] + (rand() - 0.5) * 0.2;
    const r = reach * (0.9 + rand() * 0.1);
    const gx = gc.x + Math.cos(a) * r;
    const gz = gc.z + Math.sin(a) * r;
    const dir = Math.atan2(wf.z - gz, wf.x - gx) + (rand() - 0.5) * 0.5;
    const rake = rakeScores(rand, gx, gz, dir, [0, 1, 2, 3], 0.95 + rand() * 0.1);
    const inside = rake.reach.every(([x, z]) => x > room.minX + 0.05 && x < room.maxX - 0.05 && z > room.minZ + 0.05 && z < room.maxZ - 0.05);
    if (inside) plan.push({ ...rake, at: [gx, gz] });
  }
  return plan;
}
