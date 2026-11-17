// Warden: position, look, health, spawn grace, death, and the footing state movePlayer keeps
// for its step, jump, land and splash events.

import { surfaceAt } from './surfaces.js';

export function createPlayer(cfg) {
  const p = cfg.player;
  const under = surfaceAt({ cfg, pools: [] }, p.spawn.x, p.spawn.z);
  return {
    x: p.spawn.x, y: 0, z: p.spawn.z,
    vy: 0,
    grounded: true,
    yaw: p.spawnYaw,
    pitch: 0,
    health: p.health,
    grace: 0,
    dead: false,
    moving: false,
    sprinting: false,
    stride: 0.5, // fraction of a stride covered toward the next footstep (a move starts half way)
    foot: 0, // the foot of the next step: 0 left, 1 right
    surface: under.family, // family underfoot, kept from the last ground contact
    material: under.material,
    airPeak: 0, // highest y of the current jump
    splashCool: 0, // seconds until another splash may sound
  };
}

/** Applies damage. Returns the amount actually taken (0 when dead or in spawn grace). */
export function damagePlayer(pl, amount) {
  if (pl.dead || pl.grace > 0 || amount <= 0) return 0;
  const taken = Math.min(pl.health, amount);
  pl.health -= taken;
  if (pl.health <= 0) {
    pl.health = 0;
    pl.dead = true;
  }
  return taken;
}

/** Heals up to max health. Returns the amount actually restored. */
export function healPlayer(pl, amount, cfg) {
  if (pl.dead) return 0;
  const healed = Math.max(0, Math.min(amount, cfg.player.health - pl.health));
  pl.health += healed;
  return healed;
}

export function respawnPosition(pl, cfg) {
  pl.x = cfg.player.spawn.x;
  pl.z = cfg.player.spawn.z;
  pl.y = 0;
  pl.vy = 0;
  pl.grounded = true;
}
