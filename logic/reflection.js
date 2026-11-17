// The warden's reflection in the gallery glass (issues 25 and 26). Pure: no DOM, no three.
//
// The look: at a new game the warden's reflection is drawn female or male, 50/50, from the game's
// seed alone (a generator of its own, so the run's random stream is untouched), and kept in
// sim.waves.game.reflection, which restoreCheckpoint keeps: it holds across every death,
// checkpoint and seat of that game. The words never change: lines stay gender-neutral.
//
// The weapon: the reflection carries whatever is in hand (sim.weapon), by name, so Q, keys 1 to 4
// and a pickup show in the glass at once, and any weapon a room adds is named without a change here.

import { makeRng } from './rng.js';

/** The two looks the glass can show. 'male' is the shipped warden. */
export const LOOKS = Object.freeze(['male', 'female']);

const SALT = 0x5f3c2a91; // keeps this draw apart from the run's own generator on the same seed

/** This game's look, from its seed: 'female' or 'male', each half the time. */
export function reflectionLook(seed) {
  return makeRng(((seed >>> 0) ^ SALT) >>> 0)() < 0.5 ? 'female' : 'male';
}

/** What the glass shows of the warden now: { look, weapon } (weapon: the name in hand, or null). */
export function reflectionOf(sim) {
  const game = sim && sim.waves && sim.waves.game;
  const look = game && LOOKS.includes(game.reflection) ? game.reflection : 'male';
  const w = sim && sim.weapon;
  return { look, weapon: w && typeof w.name === 'string' ? w.name : null };
}
