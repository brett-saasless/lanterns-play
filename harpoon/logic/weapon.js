// Weapons: magazine, reserve, fire cooldown, reload timer, dry-fire auto-reload, and (in a room
// with two) the swap. Every function reads its numbers through specOf(cfg, w): cfg.weapons[name]
// when the room has a weapons table, else cfg.weapon, so the yard and cave behave as before.
// The stake crossbow is a one-round weapon whose reload is the draw; it draws again by itself
// after each shot, and loads a worn stake before a fresh one.
// Carried weapons are sim.weapon (in hand), sim.holster (next on Q) and sim.rack (the rest, in
// Q order; empty with two weapons, so two-weapon play is as shipped). Q brings the holster to
// hand, the rack's head to the holster and the old weapon to the rack's end; the cycle keeps
// cfg.weaponOrder. The halberd and the cup are fired by sim.js (swing, splash), and the castle's
// garlic by sentries.js (raiseGarlic), never tryFire.

/** The numbers for weapon w in this room. */
export function specOf(cfg, w) {
  return (cfg.weapons && w && w.name && cfg.weapons[w.name]) || cfg.weapon;
}

export function createWeapon(cfg, spec = cfg.weapon) {
  const w = {
    mag: spec.magazine,
    reserve: spec.startReserve,
    cooldown: 0,
    reloading: false,
    reloadLeft: 0,
    autoReloadIn: -1, // seconds until an auto reload starts; -1 when none pending
  };
  if (spec.name) w.name = spec.name;
  if (spec.stake) {
    w.worn = 0; // worn stakes among the reserve
    w.loadedWorn = false; // the stake on the string is a worn one
  }
  if (spec.melee) w.windup = 0; // seconds until a swing lands; 0 when none is coming
  if (spec.ward) {
    // The garlic (#9, sentries.js): seconds it is still held up; whether this raise has found the
    // wife; and the fire button as last seen, so only a fresh press raises it (A6).
    w.raise = 0;
    w.warded = false;
    w.down = false;
  }
  return w;
}

/** Every carried weapon in Q order from the one in hand: [weapon, holster, ...rack]. */
export function carried(sim) {
  const out = [sim.weapon];
  if (sim.holster) out.push(sim.holster);
  if (Array.isArray(sim.rack)) out.push(...sim.rack);
  return out;
}

/**
 * The salt gun (the room's cfg.weapon), found by its name wherever it is carried: in hand, in
 * the holster or on the rack (security A2). Null when it is not carried, never another weapon.
 */
export function gunOf(sim) {
  const name = sim.cfg.weapon.name;
  return carried(sim).find((w) => w && w.name === name) || null;
}

/** The carried weapon called name, or null. */
export function weaponNamed(sim, name) {
  return carried(sim).find((w) => w && w.name === name) || null;
}

/** Where name falls in the Q cycle (cfg.weaponOrder; unknown names last). */
function rank(cfg, name) {
  const order = cfg.weaponOrder || [];
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
}

/**
 * Takes up weapon w (a halberd from a fallen guard, the cup from its stone) without changing
 * the one in hand: it joins the cycle at its place in cfg.weaponOrder. Returns false (and
 * changes nothing) when one of that name is already carried.
 */
export function carryWeapon(sim, w) {
  if (!w || weaponNamed(sim, w.name)) return false;
  const all = [...carried(sim), w].sort((a, b) => rank(sim.cfg, a.name) - rank(sim.cfg, b.name));
  const at = all.indexOf(sim.weapon);
  const cycle = [...all.slice(at), ...all.slice(0, at)];
  sim.holster = cycle[1] || null;
  sim.rack = cycle.slice(2);
  return true;
}

/** Stops a halberd's swing before it lands, and lowers a raised garlic (a swap, a pause, a death). */
export function cancelSwing(w) {
  if (w && w.windup) w.windup = 0;
  if (w && w.raise) w.raise = 0;
}

/**
 * Attempts one shot. Returns { ok: true } when a round left the barrel, otherwise
 * { ok: false, reason } with reason 'reloading' | 'cooldown' | 'dry' | 'empty'.
 */
export function tryFire(w, cfg) {
  const spec = specOf(cfg, w);
  if (w.reloading) return { ok: false, reason: 'reloading' };
  if (w.cooldown > 0) return { ok: false, reason: 'cooldown' };
  if (w.mag <= 0) {
    w.cooldown = spec.dryInterval;
    if (w.reserve > 0) {
      if (w.autoReloadIn < 0) w.autoReloadIn = spec.autoReloadDelay;
      return { ok: false, reason: 'dry' };
    }
    return { ok: false, reason: 'empty' };
  }
  w.mag -= 1;
  w.cooldown = spec.fireInterval;
  if (spec.draw && w.mag <= 0 && w.reserve > 0) w.autoReloadIn = spec.autoReloadDelay;
  return { ok: true };
}

/** Starts a reload. Returns false (and changes nothing) when full, empty reserve or already reloading. */
export function startReload(w, cfg) {
  const spec = specOf(cfg, w);
  if (w.reloading || w.mag >= spec.magazine || w.reserve <= 0) return false;
  w.reloading = true;
  w.reloadLeft = spec.reloadTime;
  w.autoReloadIn = -1;
  return true;
}

/** Cancels a reload in progress; no ammo moves. */
export function cancelReload(w) {
  w.reloading = false;
  w.reloadLeft = 0;
  w.autoReloadIn = -1;
}

/** Advances timers. Returns an array of event types: 'reloadStart', 'reloadDone'. */
export function stepWeapon(w, dt, cfg) {
  const spec = specOf(cfg, w);
  const out = [];
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.autoReloadIn >= 0) {
    w.autoReloadIn -= dt;
    if (w.autoReloadIn <= 0) {
      w.autoReloadIn = -1;
      if (startReload(w, cfg)) out.push('reloadStart');
    }
  }
  if (w.reloading) {
    w.reloadLeft -= dt;
    if (w.reloadLeft <= 0) {
      const moved = Math.min(spec.magazine - w.mag, w.reserve);
      w.mag += moved;
      w.reserve -= moved;
      if (w.worn != null && moved > 0) {
        // Worn stakes are loaded first.
        w.loadedWorn = w.worn > 0;
        if (w.loadedWorn) w.worn -= 1;
      }
      w.reloading = false;
      w.reloadLeft = 0;
      out.push('reloadDone');
    }
  }
  return out;
}

/** Adds reserve ammo up to the cap. Returns how many rounds were actually added. */
export function addReserve(w, amount, cfg) {
  if (!w) return 0;
  const added = Math.max(0, Math.min(amount, specOf(cfg, w).maxReserve - w.reserve));
  w.reserve += added;
  return added;
}

/** One turn of the cycle: the holster to hand, the rack's head to the holster, the old weapon to the rack's end. */
function rotate(sim) {
  const rack = Array.isArray(sim.rack) ? sim.rack : [];
  const old = sim.weapon;
  sim.weapon = sim.holster;
  if (rack.length) {
    sim.holster = rack[0];
    sim.rack = [...rack.slice(1), old];
  } else {
    sim.holster = old;
  }
}

/**
 * Q (want true) brings the next carried weapon to hand; a name (keys 1 to 4) brings that one,
 * turning the cycle so its order is kept, and does nothing when it is in hand or not carried.
 * Cancels a reload (and a swing), and the new weapon is ready after cfg.swapTime. An empty
 * crossbow with stakes in reserve starts its draw. Returns true when it swapped.
 */
export function swapWeapon(sim, want) {
  if (!sim.holster) return false;
  const all = carried(sim);
  const to = typeof want === 'string' ? all.findIndex((w) => w.name === want) : 1;
  if (to < 1) return false;
  cancelReload(sim.weapon);
  cancelSwing(sim.weapon);
  for (let i = 0; i < to; i++) rotate(sim);
  const h = sim.weapon;
  cancelReload(h);
  h.cooldown = Math.max(h.cooldown, sim.cfg.swapTime || 0);
  const spec = specOf(sim.cfg, h);
  if (spec.draw && h.mag <= 0 && h.reserve > 0) h.autoReloadIn = sim.cfg.swapTime || 0;
  return true;
}
