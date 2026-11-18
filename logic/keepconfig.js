// Every balance number for the castle (room 'castle', encounter 'keep'): the design's Numbers
// table (docs/features/castle/02-design.md), the surface zones, and the weapon allow-list, the
// Rose Court's four unchanged (the cup's `stuns` list, shared with the court, names the armour).
// Same shape as COURT_CONFIG; the player, the weapons, interact, the line timing, the notice
// time and the hint ladder's 90 s and 210 s are the court's values. Positions are keepmap.js's.

import { COURT_CONFIG } from './courtconfig.js';
import { ARMOUR_TUNE, WIFE_TUNE } from './sentries.js';
import {
  ZONES, SPAWNS, PADS, LOOT, SENTRIES, HAUNT_PLACES, PIT, GALLERY, keepWalls, keepProps,
} from './keepmap.js';

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(o);
}

const C = COURT_CONFIG;

// The garlic, wielded on Q (#9): carried while any garlic is (keep.js syncGarlic). The fire button
// holds it up for raiseTime (sentries.js raiseGarlic, stepGarlic); it spends nothing (A7) and has
// no ammunition: the magazine and reserves are explicit zeros, as the halberd's and the cup's.
const GARLIC = {
  name: 'garlic',
  ward: true,
  raiseTime: 0.8, // seconds it is held up: the wife within cfg.wife.ward in that time is found once
  magazine: 0,
  startReserve: 0,
  maxReserve: 0,
  fireInterval: 1.0, // from one raise to the next
  dryInterval: 0,
  reloadTime: 0,
  autoReloadDelay: 0,
};
const zoneRects = (id, material) => ZONES.find((z) => z.id === id).rects
  .map((r) => ({ shape: 'rect', minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, material }));

export const CASTLE_CONFIG = deepFreeze({
  ...C,
  room: 'castle',
  encounter: 'keep', // sim.js picks keep.js

  arena: { half: 240, wallHeight: 6, wallThickness: 0.5 }, // the bounds clamp is a safety net only

  player: {
    ...C.player,
    spawn: { x: SPAWNS[0].x, z: SPAWNS[0].z }, // the approach
    spawnYaw: SPAWNS[0].yaw, // facing the bridge
    fallResetY: -60, // the pit and the crypt are 4 m down; the road's foot (#29) is 30 m below the approach
  },

  // What is underfoot. First match wins: the deck is timber, rooms have a rug or a runner, the
  // gallery and the board are marble, everything else is cut stone.
  surfaces: {
    base: 'ashlar',
    zones: [
      { shape: 'rect', ...PIT.deck, material: 'plank' },
      { shape: 'rect', minX: -12, maxX: 12, minZ: 34, maxZ: 44, material: 'earth' },
      ...zoneRects('road', 'earth'), // issue #29: the rutted dirt road up from the wood
      { shape: 'rect', minX: -6, maxX: -4, minZ: GALLERY.field.minZ, maxZ: GALLERY.field.maxZ, material: 'runner' },
      ...zoneRects('gallery', 'marble'),
      { shape: 'rect', minX: 5, maxX: 21, minZ: -113, maxZ: -97, material: 'marble' }, // the board
      { shape: 'rect', minX: -2, maxX: 2, minZ: -7, maxZ: -2, material: 'rug' }, // the hall
      { shape: 'rect', minX: 15, maxX: 29, minZ: -38, maxZ: -26, material: 'rug' }, // under the table
      { shape: 'rect', minX: 6, maxX: 20, minZ: -143, maxZ: -135, material: 'rug' }, // the mirror room
      { shape: 'rect', minX: -14, maxX: -6, minZ: -158, maxZ: -151, material: 'rug' }, // the nursery
      { shape: 'rect', minX: 4, maxX: 22, minZ: -168, maxZ: -154, material: 'rug' }, // the Count's room
    ],
  },

  // The salt gun is cfg.weapon; the allow-list a checkpoint and a carry are checked against is
  // the court's four, unchanged, and the garlic (#9; security A2 checks it by name as the rest).
  weapon: C.weapon,
  weapons: { ...C.weapons, garlic: GARLIC },
  weaponOrder: [...C.weaponOrder, 'garlic'],

  // The Castle start (R2, G1): full health, the salt gun with a full magazine and 30 in reserve,
  // the crossbow with one stake drawn and three more, the halberd, the cup full, one garlic.
  titleKit: {
    health: 100,
    bore: { mag: 6, reserve: 30 },
    crossbow: { mag: 1, reserve: 3 },
    halberd: true,
    cup: 'full',
    garlic: 1,
  },

  pit: { damage: 20, snakeBite: 5, snakeEvery: 1.5, drop: 2 }, // drop: metres of fall that count as a fall in
  gallery: { fall: 25 }, // a quarter of full health

  // The armour (sentries.js reads every key; R4, Conflicts 4): within 20 percent of the court guard.
  armour: { ...ARMOUR_TUNE, hp: 400, speed: 2.0, reach: 3, tell: 0.8, damage: 22, attackInterval: 2.1, tauntEvery: 12 },
  wife: { ...WIFE_TUNE, tell: 0.6, damage: 15, attackInterval: 2.4, drives: 3 },
  sentries: SENTRIES,
  cover: { pieces: 8, within: 4, far: 8, farCount: 3 }, // the Hatter's rule (keepmap.js COVER)

  werewolf: { reach: 1.8, tell: 0.4, damage: 15, every: 1.5 },
  clocks: { stopped: [3, 11, 6, 1, 5], right: 12 },
  board: { leap: 0.5, minPieces: 4, strikes: { pawn: 12.5, knight: 25, bishop: 25, rook: 37.5, queen: 50, king: 25 } },
  stock: { saltMag: 6, saltReserve: 12, stakes: 6 }, // the salt box; the stake bundle

  // The Count's room (count.js reads these; R14, G9) and the castle's two scenes (A4).
  count: {
    rise: 75, perDeath: 10, riseMax: 105, recoil: 4, recoilHold: 1.5, pace: [1, 0.8, 0.6],
    cord: 4, lock: 120, nailRadius: 0.18, lockRadius: 0.55, lurch: 1.2,
  },
  scenes: { strike: 6, pyre: 10 },
  // Dread with no damage (haunts.js reads these, and its places).
  haunts: {
    furnitureMin: 6, furnitureMax: 12, furnitureClear: 1.2, windowMin: 40, windowMax: 90,
    tallMin: 45, tallMax: 100, tallShow: 4, tallNear: 10, bats: 12, batShove: 0.6, batSway: 1.2,
    places: HAUNT_PLACES,
  },
  reverb: { tail: 2.8 },

  end: { r: 1.6 }, // metres from the middle window that end the level, after the dawn

  maxAlive: 3,
  maxPins: 0, // no hat-pins in the castle: a save that carries any is forged (A2)
  drops: { chance: 0.35, ammo: 8, health: 25, maxLoose: 6 },

  // Always-solid collision: the walls and the props. keep.js keepBoxes adds the shut doors, the
  // pit's or the crypt's walls while the warden is down there, the stairwell's rails, the board.
  boxes: [...keepWalls(), ...keepProps()],
  pads: PADS,
  loot: LOOT,
});

/** Enemy types that exist only in the castle; resetSim to another room must leave none. */
export const CASTLE_ENEMY_TYPES = Object.freeze(['armour', 'wife']);
