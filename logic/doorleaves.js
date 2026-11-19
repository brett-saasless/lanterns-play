// The castle's door leaves as solid things (the owner, 2026-11-18: "even when open a player should
// not be able to walk thru an open door"). Only a door the rules can shut (keepmap.js DOORS with a
// key) is hung with leaves: two of them, hinged at the doorway's sides and swung into one room; the
// rest are bare arches. This module is the one description of those leaves: where each hinge is,
// which way it swings, how far, how fast, and how thick and long the leaf is. castle.js builds and
// turns the leaves from it, and keep.js keepBoxes stands their footprints in the collision list,
// so what is seen and what stops the warden cannot drift apart.
//
// The swing is the sim's (keep.js steps w.leaves, the view only reads it). The rule while a door
// moves: each leaf is solid at its angle of that frame, as a short run of boxes along it. A warden
// (or a creature) in its way is shoved ahead of it by the ordinary push-out (collide.js moveCircle
// runs every frame, standing still too): the leaf comes on at most a few centimetres a frame against
// a 0.4 m body, so the push is always back the way the leaf is going, never through it. Fully open
// a leaf stands square to the wall (LEAF.open), leaving the doorway clear but for its own thickness
// at the hinge, and leaving no pocket behind it that a warden could be shut into.
//
// Top view, metres. A leaf's own frame (as castle.js builds it): u along the leaf from the hinge
// (0 to length), v through its thickness (+ toward the room it swings into when shut). The world
// pose follows three.js: a hinge turned by rotY maps (x, z) to (x cos + z sin, -x sin + z cos).

import { DOORS, ZONES } from './keepmap.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};

/**
 * The leaves' make and motion. open: the angle a leaf stands at fully open (radians): square to the
 * wall. (It was 1.75, ten degrees past square: once the leaves were solid, the tea room's open west
 * leaf left a 0.76 m gap to the sideboard, too narrow for the warden, and shut whoever stood in the
 * corner behind it in; and the gallery's far leaves cut 17 cm into the corridor's walls.) opening / closing: seconds for a full swing each way (eased: smooth below); seat: the
 * hinge line's distance in from the face of the wall the leaves open from; seam: how far each leaf
 * stops short of the doorway's middle (the shut pair meet on a 6 mm seam); board, strap: the
 * boards' and the iron straps' thickness (the straps are the thickest along the leaf); ring: the
 * pull ring's span along the leaf from its free edge (from, to), and its depth through the leaf;
 * head: the fixed board over the leaves, as a share of the doorway's width (the arch's rise); slack:
 * the most a collision box may stand proud of a slanted leaf (a run of boxes covers it).
 */
export const LEAF = f({
  open: Math.PI / 2,
  opening: 1.4,
  closing: 0.8,
  seat: 0.04,
  seam: 0.003,
  board: 0.07,
  strap: 0.1,
  ring: { from: 0.17, to: 0.11, d: 0.16, w: 0.06, y: 0.46, h: 0.2 },
  head: 0.27,
  slack: 0.1,
});

/** Which way each leafed door swings: 's' into the room south of it (+z), 'n' north (-z). */
export const SWING = f({ front: 'n', inner: 's', teaOut: 's', galleryOut: 'n', walkOut: 's' });

/** The doorway's height to the arch's point: the castle's front door is the tall one. */
export const doorHeight = (d) => (d.id === 'front' ? 4.6 : 3.0);

/** The doors that are hung with leaves (every door with a key), in DOORS order. */
export const LEAF_DOORS = f(DOORS.filter((d) => d.key));

const floorOf = (d) => Math.max(...d.zones.map((id) => ZONES.find((z) => z.id === id).y));

/** The eased swing: progress 0 (shut) to 1 (open) to the leaf's angle off the wall. */
export function leafAngle(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t) * LEAF.open;
}

/** Progress after dt seconds toward goal (0 or 1), at the leaves' own pace each way. */
export function swingToward(progress, goal, dt) {
  if (goal > progress) return Math.min(goal, progress + dt / LEAF.opening);
  return Math.max(goal, progress - dt / LEAF.closing);
}

/**
 * The fixed numbers of door d's leaves: the doorway's middle c and width w along its wall, the
 * floor y, the hinge line hz, the leaf's length and height, the head board's height, and which way
 * it swings (south true: into the room at +z).
 */
export function leafFrameOf(d) {
  const r = d.rect;
  if (r.maxX - r.minX < r.maxZ - r.minZ) throw new Error(`doorleaves: door ${d.id} is not in an east-west wall`);
  const south = SWING[d.id] === 's';
  const w = r.maxX - r.minX;
  const h = doorHeight(d);
  const leafH = h - w * LEAF.head;
  return {
    id: d.id, south, c: (r.minX + r.maxX) / 2, w, y: floorOf(d), h, leafH,
    hz: south ? r.maxZ - LEAF.seat : r.minZ + LEAF.seat,
    length: w / 2 - LEAF.seam, half: w / 2,
  };
}

/**
 * The pose of leaf `side` (0 the west, 1 the east) of door d at swing progress: its hinge (hx, hz,
 * y), mirror (1 for the west leaf, built along +u; -1 for the east, the same leaf mirrored) and
 * rotY, the turn castle.js gives the hinge.
 */
export function leafPose(d, side, progress) {
  const F = leafFrameOf(d);
  const sign = (side === 0 ? 1 : -1) * (F.south ? -1 : 1);
  return { hx: F.c + (side === 0 ? -F.half : F.half), hz: F.hz, y: F.y, mirror: side === 0 ? 1 : -1, rotY: sign * leafAngle(progress), angle: leafAngle(progress) };
}

/** A point of the leaf's own frame (u along, v through) at the pose, in the world's top view. */
export function leafPoint(pose, u, v) {
  const x = pose.mirror * u;
  const c = Math.cos(pose.rotY); const s = Math.sin(pose.rotY);
  return { x: pose.hx + x * c + v * s, z: pose.hz - x * s + v * c };
}

const aabbOf = (pose, u0, u1, v0, v1, y0, y1, extra) => {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const u of [u0, u1]) for (const v of [v0, v1]) {
    const p = leafPoint(pose, u, v);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { ...extra, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h: y1 - y0,
    minX, maxX, minY: y0, maxY: y1, minZ, maxZ };
};

/**
 * Leaf `side` of door d at swing progress as collision boxes (keep.js keepBoxes): the leaf, straps
 * and all, as a run of boxes along it (each at most LEAF.slack proud of the slanted leaf), and its
 * pull ring. Each is { kind: 'leaf', id, side, minX..maxZ, minY, maxY } as the other boxes are.
 */
export function leafBoxes(d, side, progress, out = []) {
  const F = leafFrameOf(d);
  const pose = leafPose(d, side, progress);
  const t = LEAF.strap / 2;
  const lean = Math.min(Math.abs(Math.cos(pose.angle)), Math.abs(Math.sin(pose.angle)));
  const n = Math.max(1, Math.ceil((F.length * lean) / LEAF.slack));
  const extra = { kind: 'leaf', id: d.id, side };
  for (let k = 0; k < n; k++) out.push(aabbOf(pose, (k * F.length) / n, ((k + 1) * F.length) / n, -t, t, F.y, F.y + F.leafH, extra));
  const R = LEAF.ring;
  out.push(aabbOf(pose, F.half - R.from, F.half - R.to, -R.d / 2, R.d / 2, F.y, F.y + F.leafH, extra));
  return out;
}

/** Both leaves of door d at progress, as boxes. */
export function doorLeafBoxes(d, progress, out = []) {
  leafBoxes(d, 0, progress, out);
  leafBoxes(d, 1, progress, out);
  return out;
}

/**
 * The leaf's outline in the world's top view at progress: its four corners (straps' thickness),
 * for tests and for anyone checking the boxes cover what is drawn.
 */
export function leafOutline(d, side, progress) {
  const F = leafFrameOf(d);
  const pose = leafPose(d, side, progress);
  const t = LEAF.strap / 2;
  return [[0, -t], [F.length, -t], [F.length, t], [0, t]].map(([u, v]) => leafPoint(pose, u, v));
}

/**
 * The iron gate at the top of the road (castle.js): it stands open for good, each leaf swung back
 * flat against the parapet's outer face, outside the road's walls. x0: the first bar's distance
 * from the middle, pitch: between bars, bars: how many, off: its line's distance south of the
 * parapet's outer face, rail: the two rails' half-span middle and length.
 */
export const IRON_GATE = f({ x0: 2.35, pitch: 0.2, bars: 8, off: 0.08, bar: 0.04, rail: { x: 3.05, w: 1.5, d: 0.05 } });
