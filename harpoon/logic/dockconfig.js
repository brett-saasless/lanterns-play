// Every balance number for the dock (room 'dock', encounter 'dock'): the design's Numbers table
// (docs/features/sea-1-dock/02-design.md), the harpoon's allow-list, the contest table, the fog
// and dawn table, and tier limits. Positions are dockmap.js's. A number for a thing that did not
// exist before this design is a starting value (the design's own words); the build may tune it
// within 20 percent.

import { dockWalls, dockEdges, dockProps, PLACES, UNDER_PIER } from './dockmap.js';

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(o);
}

// The harpoon: the dock's only weapon in hand once signed on; thrown with fire, hauled back with
// the use control. Before signing on the carbine is carried slung (R3, Conflicts 2): it will not
// fire, and is not in cfg.weapons at all (nothing to swap to; security A2's allow-list check is
// still by name, against this table).
const HARPOON = {
  name: 'harpoon',
  harpoon: true, // sim.js: fire goes to harpoon.js, not the hitscan path
  speed: 30, // m/s
  gravity: 4, // m/s^2 the thrown iron falls under
  reach: 20, // metres the line can haul in
  haulTime: 1.2, // seconds for the line to bring a thrown iron home
  magazine: 0,
  startReserve: 0,
  maxReserve: 0,
  fireInterval: 0.6,
  dryInterval: 0,
  reloadTime: 0,
  autoReloadDelay: 0,
};

// The carbine, carried slung from arrival (never fired on the dock): zero ammunition, as the
// castle's ward and lamp weapons are (A2: no weapon arithmetic ever meets undefined).
const CARBINE_SLUNG = {
  name: 'carbine',
  slung: true, // sim.js: the fire button does nothing while it is up
  magazine: 0,
  startReserve: 0,
  maxReserve: 0,
  fireInterval: 0,
  dryInterval: 0,
  reloadTime: 0,
  autoReloadDelay: 0,
};

export const DOCK_CONFIG = deepFreeze({
  room: 'dock',
  encounter: 'dock', // sim.js picks dock.js

  arena: { half: 60, wallHeight: 6, wallThickness: 0.5 }, // the bounds clamp is a safety net only

  player: {
    health: 100,
    radius: 0.4,
    eyeHeight: 1.65,
    walkSpeed: 5.5,
    sprintSpeed: 8.5,
    gravity: 22,
    jumpVelocity: 7,
    spawn: { x: PLACES.spawn.x, z: PLACES.spawn.z },
    spawnYaw: PLACES.spawn.yaw,
    pitchLimit: (85 * Math.PI) / 180,
    fallResetY: -10,
    spawnGrace: 0, // nothing on the dock deals damage (Decisions): grace is moot, kept for shape
    stride: { walk: 2.1, run: 2.35 },
    splashCooldown: 0.6,
  },

  surfaces: {
    base: 'plank', // the quay and the pier: timber (wood family)
    zones: [
      { shape: 'rect', minX: -28, maxX: -16, minZ: -6, maxZ: 8, material: 'deck' }, // the tavern's boards
      { shape: 'rect', minX: -16, maxX: 16, minZ: -2, maxZ: 18, material: 'cobble' }, // the wharf street
      { shape: 'rect', minX: 4, maxX: 14, minZ: -30, maxZ: 0, material: 'deck' }, // the Pequod's own deck
    ],
  },

  weapon: HARPOON,
  weapons: { carbine: CARBINE_SLUNG, harpoon: HARPOON },
  weaponOrder: ['carbine', 'harpoon'], // the carbine leaves the cycle once stowed (R3)

  interact: { reach: 2.3, cone: 0.8, speakReach: 7 },
  lineTime: 4,
  linePerChar: 0.06,
  lineMax: 10,
  noticeTime: 4,
  loggedTime: 2,

  // The title start (R3, G8): full health, the carbine slung.
  titleKit: { health: 100, carbine: true },

  // The harpoon contest (R5, R22; Numbers). Rounds nearest first; Ned hits, hits, misses.
  contest: {
    distances: [8, 12, 16], // metres from the mark
    barrelLength: 0.9,
    barrelWidth: 0.6,
    hitRadius: 0.45,
    bobAmplitude: 0.08,
    bobPeriod: 2.4, // seconds, up and down
    drift: [0, 0.3, 0.6], // metres each way, by distance index
    driftPeriod: 6, // seconds for a full side to side cycle
    nedHits: [true, true, false], // 8 m, 12 m, 16 m
    wardenWinsAt: 3, // of 3 barrels hit
    haulTime: 1.2, // the line bringing an iron home (same as the harpoon's)
  },

  // The boat haul (R6, Numbers): seconds of holding the use control to bring the whaleboat in.
  boatHaul: { time: 2.0 },

  // The three proofs (R6): which knot and which lay ticket is right (Melville ch. 16, the 300th).
  proofs: { knot: 'bowline', lay: 'lay300' },

  // The scare under the pier (R8, Numbers).
  scare: { delayAfterLog: 1.0, surfaceTime: 1.6, burstNear: 6, burstFar: 9 },

  // The tavern's hush (R7, Numbers).
  tavern: { hushWithin: 3, murmurBack: 2 },

  // The telescope's sightline puzzle (R9, Numbers). Each landmark's azimuth (degrees from the
  // mast, the view's yaw convention) and the answering arc (full width, degrees) within which it
  // holds: tower and cock wide (the search is for the flame, the narrow one). tolerance: how
  // close the engine's drawn marks read as "matched" for the glow (no effect on the win test,
  // which uses the arc alone). hold: seconds all three must hold together before `nailed` fires.
  glass: {
    field: 12, // degrees, the view's width
    marks: { tower: { az: 3, arc: 12 }, flame: { az: 0, arc: 4 }, cock: { az: -3, arc: 12 } },
    tolerance: 0.5,
    hold: 0.6,
    collarSpeed: 20, // degrees a second
  },

  // The hint ladder (R19-style; Numbers): proofs after 240 s with no new one; the glass at 90, 150, 210 s.
  hints: { proofs: 240, glass: [90, 150, 210] },

  // Fog and dawn (dawn.js skyOf; critique F1: the fourth breakpoint is "nailed", matching dawn.js's
  // progress keys, not "at the glass" as the Numbers table first read).
  dawn: {
    fog: { arrive: 0.030, signedOn: 0.012, nailed: 0.006, castOff: 0.003 },
    fogColor: 0x8a908c, // "fog grey": one value for the dock's arrival fog and the breach's cover (UI direction, Palette)
    firstSun: 0xf0c878,
  },

  // The cast-off scene (R10, Numbers): no fanfare, a level camera, the ship under way.
  castOff: { length: 9, shipSpeed: 0.6 },

  drops: { chance: 0, ammo: 0, health: 0, maxLoose: 0 }, // nothing drops on the dock: nothing fights
  pickupRadius: 1.1,
  softlockDelay: 1.2,

  // Always-solid collision: the plan's walls, the pier's rails, the hull and the water's edge (dockEdges, never drawn), every named prop (dockmap.js).
  // The stage under the pier and the Pequod's deck swap in by dock.js dockBoxes (security A3).
  boxes: [...dockWalls(), ...dockEdges(), ...dockProps(), ...UNDER_PIER.props],
  pads: [],
  loot: [],
});
