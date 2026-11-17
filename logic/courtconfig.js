// Every balance number for the Rose Court level (court, wood and approach). Same shape as CONFIG
// with yard-only keys emptied, as caveconfig.js does, plus the two weapons, the court's figures,
// the four gate creatures, stakes, pins, the pit, the hint ladder and the far end's light.
// Positions come from courtmap.js.

import { CONFIG } from './config.js';
import { CAVE_CONFIG } from './caveconfig.js';
import { COURT, MAZE, LOOT, PADS, TRAIL_SPACING, mazeBoxes } from './courtmap.js';

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(o);
}

const S = MAZE.stream;
const A = MAZE.approach;

// Salt gun: the cave's Salt Bore block unchanged (7 pellets of 9, magazine 6, reserve 30 of 54).
const BORE = CAVE_CONFIG.weapon;

// Stake crossbow: one stake per draw; the draw is the reload, started by itself after each shot.
const CROSSBOW = {
  name: 'crossbow',
  pellets: 1,
  spread: 0,
  damage: 120, // a worn stake hits as hard as a fresh one
  magazine: 1, // the stake on the string
  startReserve: 0,
  maxReserve: 10, // every stake in the level
  range: 40,
  fireInterval: 0.3,
  dryInterval: 0.35,
  reloadTime: 2.2, // the draw
  autoReloadDelay: 0,
  draw: true, // draws again by itself after each shot while stakes remain
  stake: true, // a shot leaves a stake in the world (stakes.js)
};

// The halberd a dead guard drops (R8): slow, heavy, short reach, no ammunition. Swung with the
// fire button: a wind-up, then it lands on everything in a half-arc in front (sim.js swing).
// magazine and the reserves are explicit zeros so no weapon arithmetic meets undefined (A2).
const HALBERD = {
  name: 'halberd',
  melee: true,
  damage: 90, // under the crossbow's 120, over a salt blast's 63 (orderings kept)
  reach: 2.4, // metres from the warden's centre to a creature's edge
  arc: 50, // half-arc, degrees either side of the look
  windup: 0.45, // the heave before it lands
  push: 1.2, // metres a creature it lands on is driven back
  magazine: 0,
  startReserve: 0,
  maxReserve: 0,
  fireInterval: 1.5, // between swings (counted from the press)
  dryInterval: 0,
  reloadTime: 0,
  autoReloadDelay: 0,
};

// The tin cup as a weapon (R23). Its one fill is sim.waves.items.cup ('full' or 'empty'), never
// a magazine here. Thrown full: a splash of running water ahead that stops guards and gardeners
// and douses the Caterpillar's pipe, then the cup is empty until filled again at running water.
const CUP = {
  name: 'cup',
  splash: true,
  reach: 5, // metres
  cone: 25, // half-cone, degrees either side of the look
  stun: 3, // seconds a guard or gardener stands stopped
  stuns: ['guard', 'gardener', 'armour'], // nothing else is touched by it (the castle's second suit: G3)
  magazine: 0,
  startReserve: 0,
  maxReserve: 0,
  fireInterval: 0.6,
  dryInterval: 0.35,
  reloadTime: 0,
  autoReloadDelay: 0,
};

export const COURT_CONFIG = deepFreeze({
  ...CONFIG,
  room: 'court',
  encounter: 'trail', // sim.js picks trail.js

  arena: { half: 204, wallHeight: 6, wallThickness: 1.5 }, // bounds clamp is a safety net only

  player: {
    ...CONFIG.player,
    spawn: { x: COURT.spawn.x, z: COURT.spawn.z }, // beside the crater
    spawnYaw: COURT.spawn.yaw, // facing north up the gravel walk
    spawnGrace: 1.5,
  },

  // What is underfoot. First match wins. Rill zones are wet only while their channel runs
  // (channel 0 to 3, or 'arch' once the roses are red); see surfaces.js.
  surfaces: {
    base: 'grass',
    zones: [
      ...COURT.rills.map((r, i) => ({ shape: 'rect', minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, material: 'stream', channel: i })),
      { shape: 'rect', ...rect(COURT.threshold), material: 'stream', channel: 'arch' },
      { shape: 'ellipse', x: 0, z: 0, rx: COURT.plaza.r, rz: COURT.plaza.r, material: 'flag' },
      { shape: 'rect', minX: -1.5, maxX: 1.5, minZ: COURT.plaza.r - 0.5, maxZ: 20, material: 'gravel' }, // south walk
      { shape: 'rect', minX: -1.5, maxX: 1.5, minZ: -24, maxZ: -COURT.plaza.r + 0.5, material: 'gravel' }, // north walk
      ...COURT.beds.map((b) => ({ shape: 'rect', minX: b.x - 3.8, maxX: b.x + 3.8, minZ: b.z - 3.8, maxZ: b.z + 3.8, material: 'earth' })),
      { shape: 'rect', minX: S.minX, maxX: S.maxX, minZ: S.minZ, maxZ: S.maxZ, material: 'stream' },
      { shape: 'ellipse', x: -6, z: -186, rx: 2.4, rz: 1.8, material: 'puddle' },
      { shape: 'ellipse', x: 3, z: -192, rx: 2, rz: 1.5, material: 'puddle' },
      { shape: 'ellipse', x: 9, z: -183, rx: 1.6, rz: 1.2, material: 'puddle' },
      { shape: 'ellipse', x: -12, z: -195, rx: 2.2, rz: 1.6, material: 'puddle' },
      { shape: 'rect', minX: -28, maxX: 28, minZ: -40, maxZ: -24, material: 'grass' }, // band 1 starts clipped
      { shape: 'rect', minX: -28, maxX: 28, minZ: -176, maxZ: -56, material: 'litter' }, // from band 2
      { shape: 'rect', minX: -40, maxX: 40, minZ: -210, maxZ: -24, material: 'earth' }, // the wood's base
    ],
  },

  // The salt gun is cfg.weapon (pickups, drops and the rescue crate find it by its name wherever
  // it is carried: weapon.js gunOf). weapons is the allow-list a checkpoint is checked against
  // (security A1). weaponOrder is the Q cycle and keys 1 to 4 (R8, R22, R23).
  weapon: BORE,
  weapons: { bore: BORE, crossbow: CROSSBOW, halberd: HALBERD, cup: CUP },
  weaponOrder: ['bore', 'crossbow', 'halberd', 'cup'],
  swapTime: 0.4, // a swap takes this long and cancels a reload (and a halberd's wind-up)

  interact: { reach: 2.3, cone: 0.8, renfieldReach: 3.2, speakReach: 7 }, // cone: cosine of the half-angle
  // A spoken line stays up lineTime, or linePerChar a character if longer, at most lineMax.
  lineTime: 4,
  linePerChar: 0.06,
  lineMax: 10,
  noticeTime: 4, // the notice line (an item's name, a narration line); the newest wins. The single source: overrides trail.js's TUNE
  loggedTime: 2, // "added to your log" after a clue card closes

  // The court wakes one figure per hand turn (R1); the water runs before the bed flushes (R4);
  // the first turn of a run plays the bloom scene once (R3).
  wakeOrder: ['gardener', 'guard', 'gardener', 'guard', 'gardener'],
  valveFlow: 1.5, // seconds for the water to run down a rill to its bed
  bedFlush: 2, // seconds for the bed to open and turn red (or close and fade white)
  bloomScene: 5.5, // seconds, once per run

  // Guards route round the court on a coarse grid and flank in pairs; gardeners wobble (R9).
  paths: {
    cell: 1, // metres; 40 by 40 cells over the court
    replan: 0.5, // seconds between re-plans (and on every valve turn)
    flankBeyond: 5, // the second guard heads for a point this far past the warden...
    flankUntil: 6, // ...until it is this close to him
  },
  wobble: { angle: 30, min: 0.8, max: 1.6 }, // degrees either side; seconds between re-draws
  // The court figures' finer tuning (courtiers.js reads these, its TUNE values as they stand).
  courtiers: {
    flankArc: 60, // degrees: the flanker turns in once its bearing on the warden is this far from the lead's
    flankClear: 1, // metres inside the flank goal's distance the flanker's way round keeps off the warden
    straight: 3, // metres: inside this a gardener comes dead straight (its wobble fades out)
    duckNear: 3, // metres: a shot, swing or splash this close makes a plot gardener duck
    duckTime: 1.5, // seconds it stays ducked
    dropSide: 0.8, // metres beside a fallen guard its halberd lies
  },

  trails: TRAIL_SPACING, // metres between petal clusters and between toadstools (R14)

  // The court's figures (courtiers.js). radius/hitRadius/hitY/knockback/tread are read by shared code.
  guard: {
    hp: 300,
    speed: 2.4,
    reach: 2.6, // halberd
    tell: 0.7,
    damage: 19, // R9: smarter, a little softer (was 22)
    attackInterval: 1.8,
    radius: 0.55,
    hitRadius: 0.9,
    hitY: 1.5,
    hitZones: [
      { name: 'head', x: 0, y: 2.45, z: 0, r: 0.5, mult: 1.5 },
      { name: 'body', x: 0, y: 1.3, z: 0, r: 0.6, mult: 1 },
      { name: 'body', x: 0, y: 0.5, z: 0, r: 0.45, mult: 1 },
    ],
    knockback: 0.1,
    flinchable: false,
    tread: 1.0,
  },
  gardener: {
    hp: 66, // two blasts of four pellets (72) or one of four to the head (72) kill; seven to the body (63) does not
    speed: 3.4,
    reach: 1.7, // brush
    tell: 0.35,
    damage: 8,
    attackInterval: 1.0,
    radius: 0.45,
    hitRadius: 0.8,
    hitY: 1.2,
    hitZones: [
      { name: 'head', x: 0, y: 2.0, z: 0, r: 0.42, mult: 2 },
      { name: 'body', x: 0, y: 1.05, z: 0, r: 0.55, mult: 1 },
    ],
    knockback: 0.3,
    flinchable: true,
    tread: 0.9,
  },

  // The four gate creatures (hybrids.js), one per band, leashed to their glades.
  rabbit: {
    hp: 1, // cannot be damaged: shots pass where he was (intangible)
    lungeRange: 4, // from his chair
    lungeDamage: 15,
    lungeTell: 0.42, // was 0.35 (R15)
    lungeInterval: 2.4, // was 2 (R15)
    warnings: 5, // warnings before any lunge (R15)
    warnGap: 3, // seconds at least between them, and from the fifth to a lunge
    setback: 9, // his chair is at least this far from the glade's way in (courtmap.js)
    eatTime: 3, // eats, then dies
    radius: 0.45,
    hitRadius: 0.6,
    hitY: 1.0,
    knockback: 0,
    flinchable: false,
    tread: 0.7,
    noDrop: true,
  },
  hatter: {
    hp: 380,
    volley: 3, // pins per volley
    pinGap: 0.3, // seconds between pins in a volley (was 0.25, R17)
    volleyInterval: 3.1, // was 2.6 (R17)
    aimTime: 0.54, // the volley's tell (was 0.45). The single source: overrides hybrids.js's tuning block
    tauntEvery: 12, // seconds between taunts, never the same twice running
    pinDamage: 12,
    pinSpeed: 11.5, // was 14 (R17)
    pinRadius: 0.25,
    pinLife: 3,
    kickRange: 3,
    kickDamage: 18,
    kickTell: 0.4,
    speed: 3,
    radius: 0.5,
    hitRadius: 1.1,
    hitY: 1.6,
    hitZones: [
      { name: 'hat', x: 0, y: 2.95, z: 0, r: 0.5, mult: 0 }, // armour: shots there do nothing
      { name: 'head', x: 0, y: 2.25, z: 0, r: 0.36, mult: 1.5 }, // under the brim
      { name: 'body', x: 0, y: 1.3, z: 0, r: 0.6, mult: 1 },
      { name: 'body', x: 0, y: 0.5, z: 0, r: 0.45, mult: 1 },
    ],
    knockback: 0,
    flinchable: false,
    tread: 0.8,
    noDrop: true,
  },
  bat: {
    hp: 200,
    biteDamage: 11.2, // was 14: down 20 percent (R21, Conflicts 3)
    swoopInterval: 4.2, // was 3.5 (R21)
    swoopTell: 0.48, // was 0.4: the grin flares and it hisses (R21)
    swoopRange: 6,
    lanternRadius: 4, // a fallen lantern's pool of light
    lanternTime: 20,
    chainHit: 0.35, // a shot passing this close to a chain cuts it
    shaftRadius: 2.5, // the sun shaft is a pool that never ends
    radius: 0.6,
    hitRadius: 0.8,
    hitY: 2.2,
    knockback: 0,
    flinchable: false,
    tread: 0, // it flies
    noDrop: true,
  },
  caterpillar: {
    hp: 240,
    smokeRadius: 7,
    smokeDamage: 4,
    smokeTick: 0.5,
    clearTime: 2, // doused, the smoke is gone in this long
    whipRange: 3.5,
    whipDamage: 16,
    whipTell: 0.8, // slowly
    whipInterval: 2.6,
    radius: 1.0,
    hitRadius: 1.0,
    hitY: 0.9,
    knockback: 0,
    flinchable: false,
    tread: 0,
    noDrop: true,
  },
  gateCreatures: ['rabbit', 'hatter', 'bat', 'caterpillar'], // band 1 to 4

  maxPins: 24, // stuck hat-pins kept in the world; the oldest goes on overflow (security A3)
  pit: { damage: 20 }, // shape in courtmap.js (MAZE.pit)
  grin: { armed: 2.2, turn: 0.6, reach: 0.9 }, // armed this close to the dead end's centre; fires when facing out
  end: { z: A.endZ }, // twelve metres onto the approach ends the level
  hints: { nudge: 90, plain: 210 }, // seconds without progress on the puzzle the player stands in
  light: { sun: 0.9, sky: 1.1, exposure: 0.87, fog: 0.021 }, // the far end: the third mockup's values x 0.85

  bellowsEnabled: false,
  waves: [], // yard only
  gates: [], // yard only
  maxAlive: 5, // creatures awake at once never exceed this (also the audio bound)
  spawnInterval: 1.4,
  firstWaveDelay: 0,
  waveDelay: 0,
  winBeat: 1.2,
  loseBeat: 1.0,

  drops: { chance: 0.35, ammo: 8, health: 25, maxLoose: 6 },
  pickupRadius: 1.1,
  softlockDelay: 1.2,

  // Always-solid collision. The briar and the four gates are added by trail.js while closed.
  boxes: [...COURT.boxes, ...mazeBoxes(), MAZE.rabbit.table, ...MAZE.hatter.cover, MAZE.hatter.stand],
  pads: PADS,
  loot: LOOT,
});

function rect(b) {
  return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
}

/** Enemy types that exist only in the Rose Court; resetSim to the yard or cave must leave none. */
export const COURT_ENEMY_TYPES = Object.freeze(['guard', 'gardener', 'rabbit', 'hatter', 'bat', 'caterpillar']);
