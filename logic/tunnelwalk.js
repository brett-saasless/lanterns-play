// The walk between the Caterpillar's gate and the road (the owner, 2026-11-19): one long winding
// path between trees, from the wood's last gate to the foot of the road, replacing the two short
// shut tunnels (#29 G29a). The Rose Court level ends at the gate: the castle's card is read there,
// the level changes under it, and the warden stands at this walk's start in the castle level and
// walks it to the road. Nothing to fight or pick up on it.
//
// Pure and seeded: the centreline (three gentle S-bends, 30 to 60 degrees, the last stretch
// straight), the clear floor as rectangles (keepmap.js adds them to the 'road' zone, so its walls,
// its floor, its footsteps and the sentries' rule are the road's), the blend from the wood to the
// road along it (0 at the gate, 1 at the road, smooth), the opening of the last stretch, where the
// Tweedles lie, the seats (a journey from the wood, the title's Tunnel start), the dressing's
// placements (trees, bushes, boulders, grass: engine/tunnelwood.js draws them) and the quality tier
// and streaming window that keep a phone's frame rate.
//
// Castle coordinates (north is -z): the walk comes in from the east and its mouth is the east end
// of the road's leg 1 (road.js RECTS[0], x 50). Its start is the gate's far face, turned a quarter
// from the wood's frame (the wood's north is the road's west, ROAD.foot.turn).

import { RECTS as ROAD_RECTS, ROAD } from './road.js';
import { MAZE, corridor } from './courtmap.js';
import { makeRng } from './rng.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// The Caterpillar's gate in the wood's frame: the gate line, and the wall's far face, where the walk begins.
const GATE = MAZE.glades[3].gate;
const WALL_HALF = (MAZE.cell - corridor(MAZE.rows - 1)) / 2;
const GATE_FACE = GATE.z - WALL_HALF;

/**
 * The walk's numbers. length: metres along the centreline, the gate's face to the road (about 16 s
 * at the warden's 5.5 m/s walk). half: half the clear floor's width (2 m: a 4 m floor). bends: [s from, s to, heading
 * from, heading to] in degrees off due west (+ toward the south), eased. open: the last metres,
 * where the trees stand back and the road's vista fills the view. back: metres of dressing behind
 * the start (the gate and the wood's wall behind it). turn: the wood's frame to the road's.
 */
export const TUNNEL = f({
  length: 88,
  half: 2.0,
  bends: [[6, 20, 0, 32], [26, 42, 32, -28], [48, 62, -28, 0]],
  open: 18,
  back: 12,
  turn: ROAD.foot.turn,
  mouth: { x: ROAD_RECTS[0].maxX, z: (ROAD_RECTS[0].minZ + ROAD_RECTS[0].maxZ) / 2 },
  floor: ROAD.footY,
  // the wood's frame: the gate (its centre line) and the wall's far face, where s = 0
  gate: { x: GATE.x, z: GATE.z, face: GATE_FACE, s: -(GATE.z - GATE_FACE), half: corridor(MAZE.rows - 2) / 2 },
});

/** The heading off due west at s (radians, + toward the south). */
export function headingAt(s) {
  let h = 0;
  for (const [s0, s1, a, b] of TUNNEL.bends) {
    if (s <= s0) break;
    h = (a + (b - a) * smooth((s - s0) / (s1 - s0))) * DEG;
  }
  return h;
}

// ---- the centreline: sampled every DS metres, from the dressing behind the start to past the mouth.
const DS = 0.25;
const S_MIN = -TUNNEL.back;
const S_MAX = TUNNEL.length + 6;
const N = Math.round((S_MAX - S_MIN) / DS) + 1;
const PX = new Float64Array(N); const PZ = new Float64Array(N);
const DX = new Float64Array(N); const DZ = new Float64Array(N);
{
  const iL = Math.round((TUNNEL.length - S_MIN) / DS);
  for (let i = 0; i < N; i++) {
    const h = headingAt(S_MIN + i * DS);
    DX[i] = -Math.cos(h); DZ[i] = Math.sin(h);
  }
  PX[iL] = TUNNEL.mouth.x; PZ[iL] = TUNNEL.mouth.z;
  for (let i = iL - 1; i >= 0; i--) { // back from the mouth: the mouth is exact
    const hx = (DX[i] + DX[i + 1]) / 2; const hz = (DZ[i] + DZ[i + 1]) / 2;
    PX[i] = PX[i + 1] - hx * DS; PZ[i] = PZ[i + 1] - hz * DS;
  }
  for (let i = iL + 1; i < N; i++) {
    const hx = (DX[i] + DX[i - 1]) / 2; const hz = (DZ[i] + DZ[i - 1]) / 2;
    PX[i] = PX[i - 1] + hx * DS; PZ[i] = PZ[i - 1] + hz * DS;
  }
}
const idxOf = (s) => clamp(Math.round((s - S_MIN) / DS), 0, N - 1);

/** The centreline point s metres along (0 the gate's face, length the mouth), with its way: { x, z, dx, dz } into out. */
export function pointAt(s, out = {}) {
  const k = clamp((s - S_MIN) / DS, 0, N - 1);
  const i = Math.min(N - 2, Math.floor(k)); const t = k - i;
  out.x = PX[i] + (PX[i + 1] - PX[i]) * t;
  out.z = PZ[i] + (PZ[i + 1] - PZ[i]) * t;
  const dx = DX[i] + (DX[i + 1] - DX[i]) * t; const dz = DZ[i] + (DZ[i + 1] - DZ[i]) * t;
  const l = Math.hypot(dx, dz) || 1;
  out.dx = dx / l; out.dz = dz / l;
  return out;
}

/** The point `u` metres to the right of the centreline at s (the warden's right facing along it): { x, z } into out. */
export function placeAt(s, u, out = {}) {
  pointAt(s, out);
  const x = out.x + -out.dz * u; const z = out.z + out.dx * u;
  out.x = x; out.z = z;
  return out;
}

/** The facing (sim yaw) along the walk at s. */
export const yawAt = (s) => { const p = pointAt(s, {}); return Math.atan2(-p.dx, -p.dz); };

/**
 * The nearest centreline place to (x, z): { s, u } into out (u + to the right). hint: an s to
 * search from (a frame's last answer): then only the 12 m either side is searched. No allocation.
 */
export function nearest(x, z, out = {}, hint = null) {
  let i0 = 0; let i1 = N - 1; let step = 4;
  if (hint != null && Number.isFinite(hint)) { const h = idxOf(hint); i0 = Math.max(0, h - 48); i1 = Math.min(N - 1, h + 48); step = 1; }
  let best = Infinity; let bi = i0;
  for (let i = i0; i <= i1; i += step) {
    const d = (x - PX[i]) ** 2 + (z - PZ[i]) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  if (step > 1) for (let i = Math.max(0, bi - step); i <= Math.min(N - 1, bi + step); i++) {
    const d = (x - PX[i]) ** 2 + (z - PZ[i]) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  const ox = x - PX[bi]; const oz = z - PZ[bi];
  const along = ox * DX[bi] + oz * DZ[bi];
  out.s = S_MIN + bi * DS + along;
  out.u = ox * -DZ[bi] + oz * DX[bi];
  return out;
}

/** The start (s 0, the gate's face) and the mouth, in castle coordinates. */
export const START = f({ x: PX[idxOf(0)], z: PZ[idxOf(0)] });

/** 0 at the gate to 1 at the road: how far the wood has turned to the road (smooth, no step anywhere). */
export function blendAt(s) {
  return smooth(s / TUNNEL.length);
}

/** 0 until the last stretch, rising to 1 at the mouth: how far the trees have stood back and opened the view. */
export function openAt(s) {
  return smooth((s - (TUNNEL.length - TUNNEL.open)) / TUNNEL.open);
}

// ---- the clear floor ------------------------------------------------------------------------------
// One rectangle per metre of x (the walk runs east to west and never turns past 32 degrees, so each
// slice holds one stretch of it), each as tall in z as the 4 m corridor is at its slant, sharing its
// x edges with the next so keepmap.js walls only the outside. The last abuts the road's leg 1.
export const RECTS = f((() => {
  const out = [];
  const x0 = TUNNEL.mouth.x; const x1 = START.x;
  const iEnd = idxOf(TUNNEL.length); const iStart = idxOf(0);
  const n = Math.ceil(x1 - x0 - 1e-9);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  for (let k = 0; k < n; k++) {
    const a = x0 + k; const b = Math.min(x1, x0 + k + 1);
    let lo = Infinity; let hi = -Infinity;
    for (let i = iStart; i <= iEnd; i++) {
      if (PX[i] < a - 0.3 || PX[i] > b + 0.3) continue;
      const hz = TUNNEL.half / Math.max(0.5, Math.abs(DX[i]));
      lo = Math.min(lo, PZ[i] - hz); hi = Math.max(hi, PZ[i] + hz);
    }
    if (k === 0) { lo = ROAD_RECTS[0].minZ; hi = ROAD_RECTS[0].maxZ; } // straight at the mouth: flush with the road
    out.push({ minX: r3(a), maxX: r3(b), minZ: r3(lo), maxZ: r3(hi) });
  }
  return out;
})());

/** The slice of the clear floor under (x, z), or -1. */
export function rectIn(x, z) {
  const k = Math.floor(x - TUNNEL.mouth.x);
  for (const j of [k, k - 1]) {
    const r = RECTS[j];
    if (r && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return j;
  }
  return -1;
}

/** True when (x, z) is on the walk's floor. */
export const inTunnel = (x, z) => rectIn(x, z) >= 0;

/** The floor under (x, z) on the walk (the road's foot level, flat), or null off it. */
export function tunnelFloor(x, z) {
  return inTunnel(x, z) ? TUNNEL.floor : null;
}

// ---- the seats ----------------------------------------------------------------------------------

/**
 * A journey from the wood: the warden was just through the gate (the level ended on its far side,
 * under the castle's card) and stands the same distance past its face, as far to the side, facing
 * as they did (turned with the frame). pose: { offset, z, yaw, pitch } in the wood's frame (journey.js
 * poseOf). Returns { x, z, y, yaw, pitch }.
 */
export function tunnelSeat(pose = {}) {
  const along = Number.isFinite(pose.z) ? clamp(TUNNEL.gate.face - pose.z, 0.45, 3) : 0.6; // (never in the start's wall)
  const u = Number.isFinite(pose.offset) ? clamp(pose.offset - TUNNEL.gate.x, -1.4, 1.4) : 0;
  const p = placeAt(along, u, {});
  return {
    x: p.x, z: p.z, y: TUNNEL.floor,
    yaw: Number.isFinite(pose.yaw) ? pose.yaw + TUNNEL.turn : yawAt(along),
    pitch: Number.isFinite(pose.pitch) ? clamp(pose.pitch, -1.4, 1.4) : 0,
  };
}

/** The title's Tunnel start: just through the Caterpillar's gate, on the centreline, facing along the walk. */
export function startSeat() {
  const s = 0.6;
  const p = pointAt(s, {});
  return { x: p.x, z: p.z, y: TUNNEL.floor, yaw: yawAt(s), pitch: 0 };
}

// ---- the Tweedles -------------------------------------------------------------------------------
// Tweedledum and Tweedledee, dead, about halfway, full-sized men lying close together on the left verge,
// each his own way (engine/tweedles.js): Dum on his back across the verge, his head by the path; Dee on
// his side beside him, turned along the way. All of each is just outside the clear floor (nothing to
// walk into, nothing to take). The bay round them is kept clear of bushes and near trees, and the
// canopy over them is open (tunnelwood.js), so they lie in a patch of light.
const TW_S = Math.round(TUNNEL.length / 2);
// Each brother's frame (as tweedles.js lays him: his boots' end at z 0, his head toward +z, x across
// him) reaches TWEEDLE_FRAMES[name] (measured from the geometry, a little padded). s, u: where his frame's
// origin lies; turn: how far his head is turned from pointing straight at the path (+ toward the road).
export const TWEEDLE_FRAMES = f({
  dum: { x0: -0.87, x1: 0.98, z0: 0, z1: 1.87 }, // (x1: his flung arm; x0: his cap by his head)
  dee: { x0: -0.93, x1: 0.34, z0: 0, z1: 1.89 },
});
export const TWEEDLES = f([
  { name: 'dum', s: TW_S - 0.9, u: -4.75, turn: 0.12 },
  { name: 'dee', s: TW_S + 2.5, u: -4.25, turn: -1.05 },
].map((b) => {
  const p = placeAt(b.s, b.u, {});
  const right = { x: -p.dz, z: p.dx }; // toward the path from the left verge
  const c = Math.cos(b.turn); const sn = Math.sin(b.turn);
  const head = { x: right.x * c + p.dx * sn, z: right.z * c + p.dz * sn };
  return { ...b, x: p.x, z: p.z, headYaw: Math.atan2(head.x, head.z), frame: TWEEDLE_FRAMES[b.name] };
}));
export const TWEEDLE_BAY = f({ s0: TW_S - 3, s1: TW_S + 4.5, u0: -6.8, u1: -1.9 });
const inBay = (s, u, pad = 0) => s > TWEEDLE_BAY.s0 - pad && s < TWEEDLE_BAY.s1 + pad && u > TWEEDLE_BAY.u0 - pad && u < TWEEDLE_BAY.u1 + pad;

// ---- the quality tier and the streaming window ----------------------------------------------------

/**
 * The tier's budgets (counts are per metre of walk, both sides). phone: about 40 to 50 per cent of
 * the trees, bushes and boulders, a third of the grass, plainer geometry, and only ahead + behind
 * metres of dressing alive at once (~38 m); desktop: the whole walk.
 */
export const TIERS = f({
  desktop: {
    name: 'desktop', near: 3.2, back: 5.2, shrub: 2.6, boulder: 6, grass: 140,
    depth: 3, trunkSegs: [12, 6], branchSegs: [5, 2], shrubSegs: [5, 1], cardSegs: 2, rockDetail: 2, bladeSegs: 3, rocks: 3,
    leafKeep: 0.28, leafGrow: 1.85, pine: false, maps: true, ahead: 40, behind: 24,
    screen: 6, edge: 7, edgeGrass: 5,
  },
  phone: {
    name: 'phone', near: 6.2, back: 11, shrub: 5.6, boulder: 13, grass: 44,
    depth: 3, trunkSegs: [7, 3], branchSegs: [4, 1], shrubSegs: [4, 1], cardSegs: 1, rockDetail: 1, bladeSegs: 2, rocks: 1,
    leafKeep: 0.26, leafGrow: 1.9, pine: false, maps: false, ahead: 26, behind: 16,
    screen: 5.6, edge: 11, edgeGrass: 3,
  },
});

/**
 * Which tier a device gets, chosen once when the walk is built: a coarse pointer (a phone, a
 * tablet: the test touchui.js starts touch mode by) or a small screen is the phone tier; an
 * explicit override ('phone' or 'desktop': the browser smoke's hook, tunnelwood.js deviceTier) wins.
 */
export function tunnelTier({ coarse = false, minSide = Infinity, override = null } = {}) {
  if (override === 'phone' || override === 'desktop') return TIERS[override];
  return coarse || minSide < 600 ? TIERS.phone : TIERS.desktop;
}

/** The dressing is cut into CHUNK-metre lengths of walk, from the back of the gate to the mouth. */
export const CHUNK = 8;
export const CHUNKS = Math.ceil((TUNNEL.length + TUNNEL.back) / CHUNK);
export const chunkOf = (s) => clamp(Math.floor((s - S_MIN) / CHUNK), 0, CHUNKS - 1);

/**
 * The chunks alive with the eye at s on this tier: { from, to } inclusive. Every chunk with any
 * of [s - behind, s + ahead] in it; the eye off the walk (on the road) counts as its mouth.
 */
export function windowAt(s, tier, out = {}) {
  const k = Number.isFinite(s) ? clamp(s, S_MIN, TUNNEL.length) : TUNNEL.length;
  out.from = chunkOf(k - tier.behind);
  out.to = chunkOf(k + tier.ahead);
  return out;
}

/** The most chunks a tier ever has alive at once. */
export function maxAlive(tier) {
  return Math.min(CHUNKS, Math.ceil((tier.ahead + tier.behind) / CHUNK) + 1);
}

// ---- the dressing's placements --------------------------------------------------------------------

/**
 * Where everything the walk is dressed with stands, for a tier: trees (leafy or bare: bare ones
 * rise with the blend), bushes (fewer with the blend), boulders and grass patches, each with its
 * chunk. Trees and bushes stand close on both sides with gaps; nothing stands on the clear floor;
 * in the last stretch they stand back and thin out (openAt) so the road is seen ahead; behind the
 * start they stand thick (the wood's wall the gate is in). Seeded: the same walk every load.
 * Returns { trees, shrubs, boulders, grass }: arrays of { s, u, x, z, rot, scale, tone, ... }.
 */
const PLACES = new Map();
export function placements(tier) {
  if (PLACES.has(tier.name)) return PLACES.get(tier.name);
  const rnd = makeRng(0x2026 ^ (tier.name === 'phone' ? 0x51 : 0));
  const rr = (a, b) => a + rnd() * (b - a);
  const p = {};
  const trees = []; const shrubs = []; const boulders = []; const grass = [];
  const put = (list, s, u, extra) => {
    placeAt(s, u, p);
    list.push({ s, u, x: p.x, z: p.z, chunk: chunkOf(s), rot: rr(0, Math.PI * 2), tone: rnd(), ...extra });
  };
  // moved out from the way until it stands at least 0.5 m clear of the floor (whose slices reach out to
  // ~2.7 m from the centreline in the bends)
  const offFloor = (s, u) => {
    let v = u;
    for (let k = 0; k < 12 && inTunnel(...xz(placeAt(s, v - Math.sign(v) * 0.5, p))); k++) v += Math.sign(v) * 0.25;
    return v;
  };
  const xz = (q) => [q.x, q.z];
  const clearOf = (list, s, u, r) => list.every((q) => (q.s - s) ** 2 + (q.u - u) ** 2 > r * r);
  const H = TUNNEL.half;
  const L = TUNNEL.length;
  // trees: a near row each side (close, with gaps) and a back row, behind the gate a thick stand
  for (const side of [-1, 1]) {
    for (const [step, u0, u1, gap, row] of [[tier.near, H + 1.3, H + 3.2, 0.2, 'near'], [tier.back, H + 5, H + 10, 0.12, 'back']]) {
      for (let s = S_MIN + rr(0, step); s < L + 2; s += step * rr(0.75, 1.25)) {
        const o = openAt(s);
        const behind = s < 0;
        if (!behind && rnd() < gap + 0.75 * o) continue; // the gaps; the last stretch thins
        let u = side * (rr(u0, u1) + o * (row === 'near' ? 7 : 9)); // the last stretch stands back
        if (behind && s < TUNNEL.gate.s - 2.5) u = side * rr(0, u1); // past the gate: the wood, across the way too
        if (inBay(s, u, row === 'near' ? 1.2 : 0)) continue; // the Tweedles' bay
        if (!clearOf(trees, s, u, 2.4)) continue;
        const b = blendAt(s);
        const bare = rnd() < smooth((b - 0.08) / 0.84); // bare dead trees rise with the blend: a few early, all of them by the road
        const r = rnd();
        const species = bare ? (r < 0.6 ? 'oak' : 'maple') : r < 0.55 ? 'oak' : r < 0.7 ? 'maple' : tier.pine ? 'pine' : 'oak';
        put(trees, s, u, { species, bare, scale: rr(0.8, 1.3) * (row === 'back' ? 1.1 : 1), lean: bare ? rr(0.08, 0.22) : rr(0, 0.06) });
      }
    }
  }
  // behind the gate, the wood the warden has come out of: a stand of trees across the way
  const thick = tier.name === 'phone' ? 3.4 : 2.4;
  for (let s = S_MIN + 0.8; s < TUNNEL.gate.s - 2.5; s += thick) {
    for (let u = -8; u <= 8; u += thick * 1.3) {
      const ss = s + rr(-0.4, 0.4); const uu = u + rr(-0.6, 0.6);
      if (!clearOf(trees, ss, uu, thick * 0.8)) continue;
      put(trees, ss, uu, { species: rnd() < 0.7 ? 'oak' : 'maple', bare: false, scale: rr(0.85, 1.2), lean: 0 });
    }
  }
  // bushes: close to the floor's edge with gaps (not a hedge wall), fewer as the wood turns to the road
  for (const side of [-1, 1]) {
    for (let s = S_MIN + rr(0, tier.shrub); s < L; s += tier.shrub * rr(0.7, 1.3)) {
      const b = blendAt(s);
      const o = openAt(s);
      const behind = s < 0;
      if (!behind && rnd() < 0.18 + 0.7 * b + 0.25 * o) continue;
      let u = side * (H + rr(0.7, 2.4) + o * 5);
      if (behind && s < TUNNEL.gate.s - 2.5) u = rr(-H - 2, H + 2);
      if (inBay(s, u, 0.6) || !clearOf(trees, s, u, 1.1)) continue;
      if (!behind) u = offFloor(s, u);
      put(shrubs, s, u, { scale: (behind ? rr(1.5, 2) : rr(1.1, 1.7)) * (1 - 0.3 * b) });
    }
  }
  // the wall the gate stands in: thick bushes either side of the gate's way, the gate's face to its line
  for (const side of [-1, 1]) {
    for (let s = TUNNEL.gate.s - 2.6; s < 0.2; s += tier.shrub * 0.35) {
      put(shrubs, s, side * (TUNNEL.gate.half + 0.9 + rr(0, 0.6)), { scale: rr(1.6, 2.1) });
    }
  }
  // boulders: a few by the way, more of them toward the road's stony banks
  for (let s = rr(0, tier.boulder); s < L + 2; s += tier.boulder * rr(0.6, 1.4) * (1 - 0.35 * blendAt(s))) {
    const side = rnd() < 0.5 ? -1 : 1;
    const u = offFloor(s, side * (H + rr(0.6, 4.5) + openAt(s) * 4));
    if (inBay(s, u, 0.4)) continue;
    put(boulders, s, u, { variant: Math.floor(rnd() * tier.rocks), scale: rr(0.35, 1.3), squash: rr(0.72, 1.07) });
  }
  // grass: patches either side of the trodden floor (none on it), thinning and drying toward the road
  for (let s = S_MIN; s < L + 4; s += 1) {
    const n = Math.round(tier.grass * (1 - 0.55 * blendAt(s)));
    for (let k = 0; k < n; k++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const u = side * (H - 0.2 + rnd() * rnd() * 9);
      const ds = rnd();
      if (s + ds < 0 && Math.abs(u) < TUNNEL.gate.half) continue; // the gate's own way is trodden
      grass.push({ s: s + ds, u, chunk: chunkOf(s + ds) });
    }
  }
  // (what follows was added after the art review, 2026-11-19; it comes last, so all of the above
  // stands where it stood)
  // the screen: over the first half an outer ring of leafy trees each side, behind the near rows' gaps,
  // so the road's dark wood beyond is not seen early through them (on the phone too)
  for (const side of [-1, 1]) {
    for (let s = 1 + rr(0, 2); s < L * 0.55; s += tier.screen * rr(0.8, 1.2)) {
      const u = side * (H + rr(6.5, 10.5));
      if (inBay(s, u, 1.5) || !clearOf(trees, s, u, 2.6)) continue;
      put(trees, s, u, { species: rnd() < 0.65 ? 'oak' : 'maple', bare: false, scale: rr(1, 1.35), lean: rr(0, 0.05), screen: true });
    }
  }
  // the ground sheet's edge (15 m out, run into the hill): bushes, boulders and grass along it, so it is
  // never seen as a line
  for (const side of [-1, 1]) {
    for (let s = S_MIN + rr(0, tier.edge); s < L + 2; s += tier.edge * rr(0.7, 1.3)) {
      const u = side * rr(11.5, 14.5);
      if (!clearOf(trees, s, u, 1.6)) continue;
      put(shrubs, s, u, { scale: rr(1.5, 2.2) * (1 - 0.3 * blendAt(s)) });
    }
    for (let s = S_MIN + rr(0, tier.edge * 2.5); s < L + 2; s += tier.edge * 2.5 * rr(0.7, 1.3)) {
      const u = side * rr(10.5, 14.5);
      put(boulders, s, u, { variant: Math.floor(rnd() * tier.rocks), scale: rr(0.6, 1.5), squash: rr(0.7, 1) });
    }
    for (let s = S_MIN; s < L + 2; s += 1) {
      for (let k = 0; k < tier.edgeGrass; k++) {
        const ds = rnd();
        grass.push({ s: s + ds, u: side * rr(10.5, 15), chunk: chunkOf(s + ds) });
      }
    }
  }
  const out = f({ trees, shrubs, boulders, grass });
  PLACES.set(tier.name, out);
  return out;
}
