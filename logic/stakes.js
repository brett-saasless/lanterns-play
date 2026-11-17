// Stakes as things in the world. A fired stake stays where it stopped: lodged in a creature
// (and in its body once dead), or standing in the ground or cover it struck. E pulls it back.
// A stake pulled once is worn; a worn stake pulled from a second resting place crumbles and
// is gone. So the number of stakes in the level never grows. State: sim.waves.stakes[] and
// the crossbow's own counts (mag, reserve, worn, loadedWorn).

import { weaponNamed } from './weapon.js';

/** The crossbow wherever it is carried (in hand, holstered or on the rack), or null before it is found. */
export function crossbowOf(sim) {
  return weaponNamed(sim, 'crossbow');
}

/**
 * Leaves a fired stake in the world. at: { x, y, z, worn, enemy } (enemy: the id it is lodged
 * in, or null for a stake standing in the ground or cover). Emits stakeLodge. Returns the stake.
 */
export function lodgeStake(sim, at, events) {
  const s = {
    id: sim.nextId++,
    x: at.x, y: at.y, z: at.z,
    worn: !!at.worn,
    state: at.enemy != null ? 'lodged' : 'standing', // lodged | body | standing
    enemy: at.enemy != null ? at.enemy : null,
  };
  sim.waves.stakes.push(s);
  events.push({ type: 'stakeLodge', id: s.id, x: s.x, y: s.y, z: s.z, worn: s.worn });
  return s;
}

/** A creature died at (x, z): stakes lodged in it now lie in its body, ready to pull. */
export function stakesToBody(sim, enemyId, x, z) {
  for (const s of sim.waves.stakes) {
    if (s.state === 'lodged' && s.enemy === enemyId) {
      s.state = 'body';
      s.x = x;
      s.z = z;
      s.y = Math.min(s.y, 0.4);
    }
  }
}

/** A creature left the world alive (the court's figures past the arch): its stakes fall where it stood. */
export function stakesDrop(sim, enemyId, x, z) {
  for (const s of sim.waves.stakes) {
    if (s.state === 'lodged' && s.enemy === enemyId) {
      s.state = 'standing';
      s.enemy = null;
      s.x = x;
      s.z = z;
      s.y = 0;
    }
  }
}

/** True when a stake can be pulled now (standing, or in a dead creature's body). */
export function pullable(s) {
  return s.state === 'standing' || s.state === 'body';
}

/**
 * Pulls stake id. A fresh one comes back worn into the crossbow (stakePull); a worn one
 * crumbles (stakeBreak). Returns 'pull', 'break' or null when nothing was pulled.
 */
export function pullStake(sim, id, events) {
  const w = sim.waves;
  const i = w.stakes.findIndex((s) => s.id === id);
  if (i < 0 || !pullable(w.stakes[i])) return null;
  const s = w.stakes[i];
  const cb = crossbowOf(sim);
  if (!s.worn && !cb) return null;
  w.stakes.splice(i, 1);
  if (s.worn) {
    events.push({ type: 'stakeBreak', id: s.id, x: s.x, y: s.y, z: s.z, worn: true });
    return 'break';
  }
  cb.reserve += 1;
  cb.worn += 1;
  events.push({ type: 'stakePull', id: s.id, x: s.x, y: s.y, z: s.z, worn: true });
  return 'pull';
}

/** Adds fresh stakes found in the world: to the crossbow, or held spare until it is found. */
export function addFreshStakes(sim, n) {
  const cb = crossbowOf(sim);
  if (cb) cb.reserve += n;
  else sim.waves.items.stakes += n;
}

/**
 * Every stake in the level, by where it is: { loaded, loadedWorn, fresh, worn (in the
 * crossbow's reserve), spare (found before the crossbow), world (fired, lying anywhere), loot
 * (not yet found), total }. total never grows.
 */
export function stakeCounts(sim) {
  const w = sim.waves;
  const cb = crossbowOf(sim);
  const loaded = cb ? cb.mag : 0;
  const worn = cb ? cb.worn : 0;
  const fresh = cb ? cb.reserve - cb.worn : 0;
  const spare = w.items.stakes;
  const world = w.stakes.length;
  let loot = 0;
  sim.cfg.loot.forEach((l, i) => {
    if (!w.loot[i].taken && (l.kind === 'stakes' || l.kind === 'crossbow')) loot += l.count;
  });
  return {
    loaded, loadedWorn: !!(cb && cb.mag && cb.loadedWorn), fresh, worn, spare, world, loot,
    total: loaded + fresh + worn + spare + world + loot,
  };
}
