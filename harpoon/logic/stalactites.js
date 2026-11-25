// The Nave's loose stalactites: the ones the Cantor's song can bring down (cantorsong.js). Placed
// once, at load, from a fixed seed, so the rules and the view (engine/rockfall.js) see the same rock.
// Pure: no DOM, no Math.random.
//
// They hang as the old ones do (the art critic, C3 and C4): in clusters of two to five with bare
// vault between, mostly short with a few long, thin, a little tilted, either of the two shapes, in
// a range of tones. Each is { x, z, y, len, r, shape, rx, rz, tone }: its root on the vault at
// (x, y, z) (cavemap ceilingAt), its length down from the root, its girth (the view's scale, as
// cave.js hangs its own), which of cave.js's two stalactite shapes, its tilt (radians about x and
// z), and its tone (a brightness about 1). None hangs within reach of a rock stump or the rock face,
// so every one falls on floor the warden can walk; the standing pools too (the Nave's middle is
// one, and he fights in it). Enough of them hang over the fight: every point of the combat area
// (COMBAT) has one within REACH metres, so a bout never runs dry for want of one nearby.

import { caveField, ceilingAt, spaceIndexAt, spaceBounds, SPACE_DEFS } from './cavemap.js';
import { makeRng } from './rng.js';

export const NAVE = SPACE_DEFS.findIndex((s) => s.name === 'nave');
const SEED = 0x5a1c7; // the loose rock's own seed: nothing else draws from it

/** The combat area: the Nave's floor at least this far (caveField, about metres) from the rock face. */
export const COMBAT = 1.5;
/** Every point of the combat area has a loose stalactite within this many metres (placeLoose's repair pass). */
export const REACH = 3.2;

const SIZES = [2, 2, 2, 3, 3, 3, 4, 5]; // stones in a cluster, drawn evenly: mostly two or three

/** True when (x, z) is in the Nave, at least `wall` from the rock and `boxGap` clear of every box but the walls. */
function open(x, z, boxes, wall, boxGap) {
  if (spaceIndexAt(x, z) !== NAVE || caveField(x, z) < wall) return false;
  return !boxes.some((q) => q.kind !== 'wall' && x > q.minX - boxGap && x < q.maxX + boxGap && z > q.minZ - boxGap && z < q.maxZ + boxGap);
}

/** The points of the combat area on a `step` grid (for the repair pass and the tests). */
export function combatPoints(boxes = [], step = 0.5) {
  const b = spaceBounds(NAVE);
  const out = [];
  for (let z = b.minZ; z <= b.maxZ; z += step) {
    for (let x = b.minX; x <= b.maxX; x += step) if (open(x, z, boxes, COMBAT, 0.6)) out.push({ x, z });
  }
  return out;
}

/**
 * The loose stalactites over the Nave (90 with the defaults): cluster centres on a staggered lattice
 * `gap` metres apart, each jittered and one in `bare` left out (the bare vault between), two to five stones round each within
 * `spread` metres and at least `apart` from each other; then any point of the combat area with
 * none within REACH gets a small cluster of its own. boxes: collision boxes (the rock stumps).
 */
export function placeLoose({ boxes = [], gap = 5.0, jitter = 0.3, bare = 0.18, spread = 0.9, apart = 0.45, wall = 0.9, boxGap = 1.0 } = {}) {
  const b = spaceBounds(NAVE);
  const rng = makeRng(SEED);
  const out = [];
  const add = (x, z) => {
    if (!open(x, z, boxes, wall, boxGap)) return false;
    for (const s of out) if ((s.x - x) ** 2 + (s.z - z) ** 2 < apart * apart) return false;
    const y = ceilingAt(x, z);
    // mostly short, a few long (as the old ones: cave.js), never so long a jump meets the tip
    const len = Math.min(0.35 + 1.45 * rng() ** 2.6, y - 3.05);
    if (len < 0.3) return false;
    out.push({
      x: +x.toFixed(3), z: +z.toFixed(3), y: +y.toFixed(3), len: +len.toFixed(3),
      r: +(0.12 + 0.06 * rng()).toFixed(3), shape: rng() < 0.5 ? 0 : 1,
      rx: +((rng() * 2 - 1) * 0.07).toFixed(3), rz: +((rng() * 2 - 1) * 0.07).toFixed(3),
      tone: +(0.62 + 0.7 * rng()).toFixed(3),
    });
    return true;
  };
  const cluster = (cx, cz, n) => {
    let made = 0;
    for (let tries = 0; tries < n * 6 && made < n; tries++) {
      const a = rng() * Math.PI * 2;
      const d = (made === 0 ? 0.15 : 0.3 + (spread - 0.3) * rng());
      if (add(cx + Math.cos(a) * d, cz + Math.sin(a) * d)) made += 1;
    }
    return made;
  };
  // The clusters' centres: a staggered (hexagonal) lattice `gap` apart, each pushed off it by up to
  // `jitter` of the gap and one in `bare` left out, so the clusters stand apart with bare vault between.
  const row = gap * Math.sqrt(3) / 2;
  for (let j = 0, z = b.minZ + row / 2; z < b.maxZ; j++, z += row) {
    for (let x = b.minX + (j % 2 ? gap / 2 : 0); x < b.maxX + gap / 2; x += gap) {
      const cx = x + (rng() * 2 - 1) * jitter * gap;
      const cz = z + (rng() * 2 - 1) * jitter * gap;
      const n = SIZES[Math.floor(rng() * SIZES.length)];
      if (rng() < bare) continue;
      cluster(cx, cz, n);
    }
  }
  // the repair: wherever the fight could stand with none in reach, a small cluster over it
  for (const p of combatPoints(boxes)) {
    if (out.some((s) => (s.x - p.x) ** 2 + (s.z - p.z) ** 2 <= REACH * REACH)) continue;
    cluster(p.x, p.z, 2);
  }
  return out;
}
