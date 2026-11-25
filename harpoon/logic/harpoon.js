// The harpoon (R3, R5, R8; Components): the throw (a projectile arc under gravity), the line that
// hauls a thrown iron home, the stayed arm (never thrown at a person: harpoon.aim's `why: 'person'`),
// and the same hold-to-complete haul used to bring the whaleboat's gunwale in (R6). Pure: no three,
// window, document or Math.random; state is a small object the caller (dock.js) keeps in
// sim.waves.harpoon and mutates through these functions.

/** A fresh harpoon state: held ('none' before the contest, 'contest' at the rack, 'own' once Queequeg's), resting at `at`. */
export function createHarpoon(held, at) {
  return { held, flight: null, stands: { x: at.x, y: 0, z: at.z, target: 'mark' }, haul: null };
}

/**
 * Whether the fire control may throw now: { can, why }. why is 'person' when a figure (Ned,
 * Queequeg, Elijah, Peleg: anyone `figures` lists) stands within `reach` of the throw's line
 * ahead of `player` within half-angle `coneDeg` - the arm is stayed, nothing is thrown. why is
 * 'held' while an iron is already in flight or being hauled.
 */
const STAY_CONE_DEG = 6; // half-angle either side of the look the stayed-arm check covers

export function aim(player, figures, cfg) {
  const reach = cfg.weapons.harpoon.reach;
  const half = STAY_CONE_DEG * (Math.PI / 180);
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  for (const p of figures || []) {
    const dx = p.x - player.x;
    const dz = p.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || d < 1e-6) continue;
    const cos = (dx * fx + dz * fz) / d;
    if (cos >= Math.cos(half)) return { can: false, why: 'person' };
  }
  return { can: true, why: null };
}

/**
 * Starts the throw: a projectile from `from` along unit direction `dir` at cfg.weapon.speed (the
 * harpoon's own spec), under cfg.weapon.gravity. Does nothing (returns false) while an iron is
 * already in flight or hauling, or when the state holds none.
 */
export function throwIron(h, cfg, from, dir) {
  if (!h || h.held === 'none' || h.flight || h.haul) return false;
  const spec = cfg.weapons.harpoon;
  h.flight = {
    x: from.x, y: from.y, z: from.z,
    vx: dir.x * spec.speed, vy: dir.y * spec.speed, vz: dir.z * spec.speed,
    t: 0, from: { x: from.x, y: from.y, z: from.z },
  };
  h.stands = null;
  return true;
}

/**
 * One frame of flight: advances the arc under gravity. Returns the iron's new position, or null
 * when nothing is in flight. The caller tests this position against barrels, the boat or the
 * monster each frame (contest.js barrelAt, dock.js); landing (a hit or the ground) is the
 * caller's call: it then calls land() with where it stopped.
 */
export function stepFlight(h, cfg, dt) {
  if (!h || !h.flight) return null;
  const spec = cfg.weapons.harpoon;
  const f = h.flight;
  f.t += dt;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  f.vy -= spec.gravity * dt;
  return { x: f.x, y: f.y, z: f.z };
}

/** The iron lands at `at`, stuck in `target` ('barrel' | 'boat' | 'monster' | 'ground'), index optional (the barrel's). */
export function land(h, at, target, index = null) {
  h.flight = null;
  h.stands = { x: at.x, y: at.y, z: at.z, target, index };
}

/** Starts the line hauling the iron home (cfg.weapons.harpoon.haulTime), or a hold-to-complete haul of `seconds` (the boat, R6). */
export function startHaul(h, seconds) {
  if (h.haul) return false;
  h.haul = { t: 0, total: seconds };
  return true;
}

/** One frame of a haul: true once it is complete (the caller then calls land() back at the mark, or finishes the boat). */
export function stepHaul(h, dt) {
  if (!h.haul) return false;
  h.haul.t += dt;
  if (h.haul.t < h.haul.total) return false;
  h.haul = null;
  return true;
}

/** True while the iron is at the mark and nothing is in flight or being hauled: the only time it may be thrown. */
export function atMark(h) {
  return !h.flight && !h.haul && !!h.stands && h.stands.target === 'mark';
}
