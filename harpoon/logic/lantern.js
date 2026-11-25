// The castle's hand lantern (the owner's idea, 2026-11-19): found in the hall beside the garlic
// braid, wielded from the weapon cycle like the garlic (Q, key 6), and while it is up it throws a
// soft warm light where the warden looks. It adds no light to the scene: castle.js keeps one key
// spot and POOL point lights for the flames, and the lantern BORROWS one of those pool lights
// (the weakest or farthest flame's, or a free one) for as long as it is drawn, so the light count,
// and with it every shader, never changes. The light's reach is the room's ceiling height; its
// brightness is constant; it lights only what is already there (nothing is hidden or revealed,
// no foe reacts to it). Only in the castle, and only indoors (never the road, the bridge or the
// forecourt). Pure rules: no DOM, no three.js, no Math.random; the view (castle.js, handlamp.js)
// reads them and never writes the sim.

import { ZONES, zoneAt } from './keepmap.js';

export const LANTERN = Object.freeze({
  name: 'lantern',
  fade: 0.2, // seconds for the borrowed pool light to hand over, drawing or holstering (a dip through zero, no pop)
  intensity: 3.2, // constant; a wall torch's pool light is 12 * 0.85 = 10.2 at its flame, a sconce candle 4.6
  // the owner (LIFT): in a room 6 m high or more a little more, constant within the room, and always under a
  // third of the room's brightest flame (lanternIntensity)
  tall: 6,
  lift: 4.2,
  // PAL.lantern 0xffc66b (the gate-post lanterns) taken 40% toward the castle's FIRELIGHT 0xd8c8bc
  color: 0xefc78b,
  decay: 1.7, // as the flames' pool lights
  lag: 9, // 1/s: how fast the light catches the look (the hand's sway behind it)
  standoff: Object.freeze({ k: 0.35, min: 0.7, max: 1.8 }), // how far it stands off the surface looked at
  back: 0.4, // up to this far behind the eye when the warden is nose to a wall (still 0.7 m off it)
});

// The ceiling height of each indoor zone (metres from its floor to the crown): castle.js makePlan's
// h plus its vault's rise (a beamed or flat ceiling has no rise). The smoke checks the two agree.
const PASSAGE = 3.0 + 0.8;
export const CEILINGS = Object.freeze({
  hall: 5 + 3, cor1: PASSAGE, tea: 6, cor2: PASSAGE, gallery: 6 + 3.6, crypt: 3.7, cor3: PASSAGE,
  walk: 6.5 + 5, stairs: 9.2, landing: 4.2, mirror: 5, passage: PASSAGE, nursery: 4.4, countway: PASSAGE, count: 6,
});

/** The lantern's reach in a zone: that room's ceiling height. 0 outdoors or for an unknown id. */
export function lanternReach(zone) {
  return Object.prototype.hasOwnProperty.call(CEILINGS, zone) ? CEILINGS[zone] : 0;
}

/** The zones the lantern may be up in: every zone past the front door (stage 1 on), and the crypt. */
export const INDOOR = Object.freeze(new Set([...ZONES.filter((z) => z.stage >= 1).map((z) => z.id), 'crypt']));

/** True when the room's rules carry a lantern at all: the castle, with the lantern in its weapons table. */
export function lanternRoom(cfg) {
  return !!(cfg && cfg.room === 'castle' && cfg.weapons && cfg.weapons[LANTERN.name]);
}

/** True when the warden has taken the lantern (waves.items.lantern, written when it is taken). */
export function ownsLantern(sim) {
  return !!(sim && sim.waves && sim.waves.items && sim.waves.items.lantern === true);
}

/** True while the warden stands indoors in the castle (the lantern may be up). */
export function lanternIndoors(sim) {
  if (!sim || !lanternRoom(sim.cfg) || !sim.player) return false;
  const id = zoneAt(sim.player.x, sim.player.z);
  return id !== null && INDOOR.has(id);
}

/** True when the lantern may be brought up: owned, in the castle, indoors (on touch, by the swap button's cycle). */
export function lanternReady(sim) {
  return ownsLantern(sim) && lanternIndoors(sim);
}

/**
 * True while the light is on: the lantern in hand, in the castle, indoors, playing, no scene,
 * the warden alive. The view crossfades its borrowed light toward this.
 */
export function lanternDrawn(sim) {
  if (!sim || !sim.weapon || sim.weapon.name !== LANTERN.name) return false;
  if (sim.status !== 'playing' || (sim.player && sim.player.dead)) return false;
  if (sim.waves && sim.waves.scene) return false;
  return lanternIndoors(sim);
}

/**
 * The light is shown with the model (the owner, SYNC): drawn, and the swap's lowering half over, so
 * the borrowed light starts its hand-over as the lantern comes up into view. sim.weapon.cooldown
 * counts down the swap (cfg.swapTime): the model swaps in at its half (viewmodel.js).
 */
export function lanternLit(sim) {
  if (!lanternDrawn(sim)) return false;
  const half = (sim.cfg && sim.cfg.swapTime > 0 ? sim.cfg.swapTime : 0) / 2;
  return !(sim.weapon.cooldown > half + 1e-9);
}

/**
 * The lantern's strength in a room: LANTERN.intensity, lifted in a room LANTERN.tall high or more
 * toward LANTERN.lift, but kept under a third of the room's brightest flame (brightest: that flame's
 * pool-light strength) and never below the base. One number per room: constant while in it.
 */
export function lanternIntensity(reach, brightest, opts = LANTERN) {
  if (!(reach >= opts.tall)) return opts.intensity;
  const third = (Number.isFinite(brightest) ? brightest : 0) / 3 * 0.95;
  return Math.max(opts.intensity, Math.min(opts.lift, third));
}

/**
 * Where the lantern goes back to when it is put away: the weapon that was in hand when it was
 * drawn (waves.lanternPrev) if it is still carried, else the next on Q (true).
 */
export function lanternBack(sim) {
  const prev = sim && sim.waves ? sim.waves.lanternPrev : null;
  if (typeof prev === 'string' && prev !== LANTERN.name) {
    const all = [sim.weapon, sim.holster, ...(Array.isArray(sim.rack) ? sim.rack : [])];
    for (const w of all) if (w && w.name === prev) return prev;
  }
  return true;
}

/**
 * What a swap request means with the lantern about (key 6 asks for 'lantern' by name; Q and the
 * touch swap button ask for the next on the cycle): asked for while it is already up, it is put away, back to the weapon it
 * was drawn from (lanternBack); otherwise the request as it came.
 */
export function lanternSwap(sim, want) {
  if (!sim || !sim.weapon) return want;
  if (want === LANTERN.name && sim.weapon.name === LANTERN.name) return lanternBack(sim);
  if (lanternRoom(sim.cfg) && !lanternIndoors(sim)) {
    // outdoors the lantern is not drawn: asked for by name, nothing; Q passes it by to the one after it
    if (want === LANTERN.name) return false;
    if (want === true && sim.holster && sim.holster.name === LANTERN.name) {
      const next = Array.isArray(sim.rack) && sim.rack.length ? sim.rack[0] : null;
      return next ? next.name : false;
    }
  }
  return want;
}

/**
 * main.js, a swap that names the weapon already in hand: no swap (false), except the lantern
 * asked for again, which is put away (lanternBack: the weapon it was drawn from, or true).
 */
export function sameWeaponSwap(sim, want) {
  return want === LANTERN.name && sim && sim.weapon && sim.weapon.name === LANTERN.name ? lanternBack(sim) : false;
}

/**
 * After a swap: when the lantern has just come up, remember what was in hand before it (from,
 * a weapon name) so putting it away goes back there. Not part of any snapshot (a restore clears it).
 */
export function noteLanternDraw(sim, from) {
  if (!sim || !sim.waves || !sim.weapon || sim.weapon.name !== LANTERN.name) return;
  if (typeof from === 'string' && from !== LANTERN.name) sim.waves.lanternPrev = from;
}

/** The reach the light uses in zone: its ceiling, or (outdoors, fading out) the last indoor reach. */
export function lampReach(zone, last) {
  const r = lanternReach(zone);
  return r > 0 ? r : last > 0 ? last : CEILINGS.hall;
}

// ---- the pool's decisions (castle.js runs them each frame over its POOL point lights) ----------

/** How many flames get a pool light this frame: all the pool, less the one lent to the lantern. */
export function flamesPicked(poolSize, candidates, lent) {
  return Math.max(0, Math.min(poolSize - (lent >= 0 ? 1 : 0), candidates));
}

/**
 * One frame of the flames' share of the pool, as castle.js always ran it, with the lantern's slot
 * (lent, -1 for none) left out: cand sorted strongest first (each { d, stamp }), the first picked
 * stamped; a slot whose flame was not picked fades (3.5 a second) and frees at nothing; each
 * picked flame not already held takes the first free slot (seat(slot, flame) places the light)
 * at level 0 (1 when dt is 0). The lent slot holding a flame does not count as holding it.
 */
export function assignFlames(pool, cand, picked, stamp, dt, lent, seat) {
  for (let i = 0; i < picked; i++) cand[i].stamp = stamp;
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (i === lent) continue;
    if (s.at && s.at.stamp !== stamp) {
      s.level -= dt * 3.5;
      if (s.level <= 0 || dt === 0) { s.at = null; s.level = 0; }
    }
  }
  for (let i = 0; i < picked; i++) {
    const f = cand[i];
    let held = false; let free = null;
    for (let j = 0; j < pool.length; j++) {
      if (pool[j].at === f && j !== lent) held = true;
      else if (!pool[j].at && !free && j !== lent) free = pool[j];
    }
    if (held || !free) continue;
    free.at = f; free.level = dt === 0 ? 1 : 0;
    if (seat) seat(free, f);
  }
}

/** On the way back from the lantern: the flame next in line (cand[picked]) if no slot holds it, else null. */
export function returnFlame(pool, cand, picked) {
  if (picked >= cand.length) return null;
  const f = cand[picked];
  for (let j = 0; j < pool.length; j++) if (pool[j].at === f) return null;
  return f;
}

/** The crossfade: m (0 off, 1 fully handed to the lantern) one step toward on. dt <= 0 snaps. */
export function lanternFade(m, on, dt, fade = LANTERN.fade) {
  if (!(dt > 0)) return on ? 1 : 0;
  const step = dt / fade;
  return on ? Math.min(1, m + step) : Math.max(0, m - step);
}

/**
 * The borrowed slot's two lights at crossfade m, into out ({ flame, lamp }, reused): the flame
 * it held goes down over the first half, the lantern comes up over the second, so the one light
 * never jumps from one place to the other while lit.
 */
export function slotMix(m, out = { flame: 1, lamp: 0 }) {
  out.flame = Math.max(0, 1 - 2 * m);
  out.lamp = Math.max(0, 2 * m - 1);
  return out;
}

/**
 * Which pool slot the lantern borrows: a free one (no flame, or one gone dark) if any, the lowest
 * first; else the one whose flame ranks last (the largest d: castle.js ranks flames by distance
 * over power squared, the occupied zone's first), ties to the lowest index. pool: [{ at, level }].
 * -1 for an empty pool.
 */
export function borrowSlot(pool) {
  let best = -1;
  let worst = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (!s.at || !(s.level > 0)) return i;
    const d = Number.isFinite(s.at.d) ? s.at.d : Infinity;
    if (d > worst) { worst = d; best = i; }
  }
  return best;
}

/**
 * One frame of the hand-over, on state { m, slot } (mutated and returned): m steps toward on; a
 * slot is borrowed when the light starts to come up and kept, the same slot, until it is fully
 * back (then -1). The pool is only read: nothing is ever added to it or taken from it.
 */
export function stepBorrow(state, pool, on, dt) {
  state.m = lanternFade(state.m, on, dt);
  if (state.m > 0 && state.slot < 0) state.slot = borrowSlot(pool);
  if (state.m === 0 && !on) state.slot = -1;
  return state;
}

/**
 * How far along the look ray the light reaches before something stops it: out of the room's box
 * (room: { minX, maxX, minZ, maxZ, minY, maxY }, the floor to the ceiling), or into one of the
 * solid boxes (minY and maxY above the floor at floorY; skip(b) true leaves one out), no further
 * than reach. o the eye, d the look (unit). A slab test with no allocation.
 */
export function aimDistance(o, d, room, boxes, floorY, reach, skip = null) {
  let t = reach;
  // out of the room: the nearest exit along each axis
  t = Math.min(t, exitAlong(o.x, d.x, room.minX, room.maxX), exitAlong(o.y, d.y, room.minY, room.maxY), exitAlong(o.z, d.z, room.minZ, room.maxZ));
  if (boxes) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b || (skip && skip(b))) continue;
      const hit = entry(o, d, b.minX, b.maxX, floorY + (b.minY || 0), floorY + (b.maxY == null ? 99 : b.maxY), b.minZ, b.maxZ, t);
      if (hit < t) t = hit;
    }
  }
  return Math.max(0, t);
}

function exitAlong(o, d, lo, hi) {
  if (d > 1e-9) return Math.max(0, (hi - o) / d);
  if (d < -1e-9) return Math.max(0, (lo - o) / d);
  return Infinity;
}

// the ray's entry into a box, when it is in front of the eye and nearer than far; else Infinity
// (the eye inside a box, as against a wall's own box in a doorway, counts for nothing)
function entry(o, d, x0, x1, y0, y1, z0, z1, far) {
  let tmin = 0;
  let tmax = far;
  for (let a = 0; a < 3; a++) {
    const oo = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const lo = a === 0 ? x0 : a === 1 ? y0 : z0;
    const hi = a === 0 ? x1 : a === 1 ? y1 : z1;
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return Infinity;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin > 0 ? tmin : Infinity;
}

/**
 * Where the light sits along the look ray for a surface t metres off: stood off it by a third of
 * the distance (0.7 m to 1.8 m), so its pool is soft and has no hot spot; nose to a wall it draws
 * back to the hand and a little behind the eye, never nearer the surface than standoff.min.
 */
export function lampDistance(t, opts = LANTERN) {
  const st = opts.standoff;
  const off = Math.max(st.min, Math.min(st.max, st.k * t));
  return Math.max(-opts.back, t - off);
}

/**
 * The hand's lag: the light's direction (out, a unit {x, y, z}, mutated) eased toward the look
 * (to, unit) at rate per second, renormalised. dt <= 0 snaps. Returns out.
 */
export function easeLook(out, to, dt, rate = LANTERN.lag) {
  const k = dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
  out.x += (to.x - out.x) * k;
  out.y += (to.y - out.y) * k;
  out.z += (to.z - out.z) * k;
  const n = Math.hypot(out.x, out.y, out.z);
  if (n > 1e-6) { out.x /= n; out.y /= n; out.z /= n; } else { out.x = to.x; out.y = to.y; out.z = to.z; }
  return out;
}
