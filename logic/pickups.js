// Fixed pads, kill drops, collect rules and the anti-softlock ammo spawn.
// In the cave pads carry a chamber index: only the current chamber's pads are stocked or
// chosen for the rescue crate. Yard pads have no chamber, so the yard behaves as before.
// In the Rose Court pads carry a stage: every pad is stocked from the start (the level is one
// place), and the rescue crate goes to the nearest pad of the stage the run has reached. Salt
// always goes to the salt gun, found by name wherever it is carried (in hand, holstered or on
// the rack: weapon.js gunOf, security A2); with no salt gun carried a salt cache stays where it
// lies. The rescue crate watches only the guns: it comes when the salt gun is at 0 / 0 and the
// weapon in hand is the salt gun or the stake crossbow, never for the halberd or the cup.

import { healPlayer } from './player.js';
import { addReserve, gunOf } from './weapon.js';
import { climbs } from './climb.js';

/** Index of the chamber the player is fighting in (cave), or null in the yard. */
export function currentChamber(sim) {
  return sim.cfg.encounter === 'chambers' ? sim.waves.index : null;
}

function padInChamber(pad, chamber) {
  return chamber == null || pad.chamber == null || pad.chamber === chamber;
}

/** A pickup the player can still reach: anything in the yard; in the cave, not behind a sealed veil. */
function reachable(p, chamber) {
  return chamber == null || p.chamber == null || p.chamber >= chamber;
}

/**
 * Puts each pad's item back if it was taken. chamber (default: the current chamber) limits
 * it to that chamber's pads; pads without a chamber (the yard) are always stocked.
 */
export function restockPads(sim, chamber = currentChamber(sim)) {
  sim.cfg.pads.forEach((pad, i) => {
    if (!padInChamber(pad, chamber)) return;
    if (!sim.pickups.some((p) => p.padIndex === i)) {
      const p = { id: sim.nextId++, kind: pad.kind, x: pad.x, z: pad.z, source: 'pad', padIndex: i };
      if (pad.chamber != null) p.chamber = pad.chamber;
      sim.pickups.push(p);
    }
  });
}

/**
 * Rolls a kill drop. Returns null, 'ammo' or 'health'. The kind is weighted toward
 * whichever the player is lower on (as a fraction of its maximum).
 */
export function rollDrop(rng, pl, w, cfg) {
  if (rng() >= cfg.drops.chance) return null;
  const healthNeed = 1 - pl.health / cfg.player.health;
  // No salt gun carried (security A2): never salt; health if the warden needs it, else nothing.
  if (!w) return healthNeed > 0 ? 'health' : null;
  const ammoNeed = 1 - (w.mag + w.reserve) / (cfg.weapon.magazine + cfg.weapon.maxReserve);
  const total = healthNeed + ammoNeed;
  const pHealth = total > 1e-6 ? healthNeed / total : 0.5;
  return rng() < pHealth ? 'health' : 'ammo';
}

/** y (the yard's crate tops, #21): the height it lies at, when above the ground. */
export function addDrop(sim, kind, x, z, y = 0) {
  const loose = sim.pickups.filter((p) => p.source === 'drop');
  if (loose.length >= sim.cfg.drops.maxLoose) {
    sim.pickups.splice(sim.pickups.indexOf(loose[0]), 1);
  }
  const p = { id: sim.nextId++, kind, x, z, source: 'drop', padIndex: -1 };
  if (y > 0) p.y = y;
  const chamber = currentChamber(sim);
  if (chamber != null) p.chamber = chamber;
  sim.pickups.push(p);
  return p;
}

/** The Rose Court's stage the run has reached, or null in the yard and the cave. */
function currentStage(sim) {
  return sim.cfg.encounter === 'trail' ? sim.waves.index : null;
}

function nearestPad(sim, chamber) {
  const { cfg, player: pl } = sim;
  const stage = currentStage(sim);
  let pads = stage == null
    ? cfg.pads.filter((pad) => padInChamber(pad, chamber))
    : cfg.pads.filter((pad) => pad.stage === stage);
  if (!pads.length) pads = cfg.pads;
  let best = pads[0];
  let bd = Infinity;
  for (const pad of pads) {
    const d = Math.hypot(pad.x - pl.x, pad.z - pl.z);
    if (d < bd) { bd = d; best = pad; }
  }
  return best;
}

export function stepPickups(sim, dt, events) {
  const { cfg, player: pl } = sim;
  const w = gunOf(sim);
  // In the yard (cfg.levels, #21) a pickup can lie on a crate top: reach is from the feet to it.
  const levels = climbs(cfg);
  if (!pl.dead && (levels || pl.y < 1.6)) {
    const keep = [];
    for (const p of sim.pickups) {
      const lift = pl.y - (p.y || 0);
      const near = Math.hypot(p.x - pl.x, p.z - pl.z) < cfg.pickupRadius && (!levels || (lift < 1.6 && lift > -0.5));
      let used = 0;
      if (near && p.kind === 'health') used = healPlayer(pl, cfg.drops.health, cfg);
      if (near && p.kind === 'ammo' && w) used = addReserve(w, cfg.drops.ammo, cfg);
      if (used > 0) {
        events.push({ type: 'pickup', kind: p.kind, amount: used, id: p.id });
        if (cfg.encounter === 'trail' && sim.waves) {
          // The Rose Court names what was walked over on the notice line (R10): the newest wins.
          // The yard and the cave keep their own toasts.
          sim.waves.notice = { key: p.kind, left: cfg.noticeTime };
          events.push({ type: 'notice', key: p.kind });
        }
      } else {
        keep.push(p);
      }
    }
    sim.pickups = keep;
  }

  // Never a softlock: at 0 / 0 with no reachable ammo, put a crate on the nearest pad
  // (in the cave: the nearest pad of the current chamber).
  const chamber = currentChamber(sim);
  const held = sim.weapon;
  const watching = !!w && (held === w || held.name === 'crossbow');
  const dry = watching && w.mag === 0 && w.reserve === 0 && !w.reloading;
  const ammoExists = sim.pickups.some((p) => p.kind === 'ammo' && reachable(p, chamber));
  if (dry && !ammoExists) {
    sim.softlockFor += dt;
    if (sim.softlockFor >= cfg.softlockDelay) {
      const pad = nearestPad(sim, chamber);
      const p = { id: sim.nextId++, kind: 'ammo', x: pad.x + 0.8, z: pad.z + 0.8, source: 'rescue', padIndex: -1 };
      if (chamber != null) p.chamber = chamber;
      if (currentStage(sim) != null) p.stage = currentStage(sim);
      sim.pickups.push(p);
      sim.softlockFor = 0;
      events.push({ type: 'rescueCrate', id: p.id, x: p.x, z: p.z });
    }
  } else {
    sim.softlockFor = 0;
  }
}
