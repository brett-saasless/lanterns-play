// Every balance number and layout fact for the Cave. Pure data built once at load.
// Same shape as CONFIG (yard-only keys emptied) plus the chamber, creature, boss and bore tables.

import { CONFIG } from './config.js';
import { SPACE_DEFS, spaceBounds, mouthAt, towardWall, wallBoxes, ceilingBoxes, placePools, CAVE_SEED } from './cavemap.js';
import { makeRng } from './rng.js';
import { placeLoose } from './stalactites.js';

const DEG = Math.PI / 180;

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(o);
}

function aabb(minX, maxX, minZ, maxZ, minY, maxY, kind) {
  return {
    kind,
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
    w: maxX - minX, d: maxZ - minZ, h: maxY - minY,
    minX, maxX, minY, maxY, minZ, maxZ,
  };
}

// ---- Layout -----------------------------------------------------------------------------
// The shape of the cave lives in cavemap.js: a field of round rooms and winding tunnels. Here
// it becomes collision: the rock band around the walkable cells as small boxes (a fine
// staircase that follows the curved walls), lids for shots, veils fitted to the tunnel mouths.

const WALL_H = 8; // taller than every ceiling; collision is XZ only
const WALL_BAND = 1; // wall thickness generated around open space
const VEIL_T = 0.6;
const CEILING_T = 1;

const SPACES = SPACE_DEFS.map((d, i) => ({ ...d, index: i, ...spaceBounds(i) }));

function pillar(x, z, size, h, kind) {
  return aabb(x - size / 2, x + size / 2, z - size / 2, z + size / 2, 0, h, kind);
}

// A veil spans the tunnel where it crosses z at x, overlapping the rock either side by 0.5 m.
function veil(x, z) {
  const m = mouthAt(x, z, VEIL_T);
  return aabb(m.minX - 0.5, m.maxX + 0.5, z - VEIL_T / 2, z + VEIL_T / 2, 0, WALL_H, 'veil');
}

const PILLARS = [
  // Hatchery: four rock columns as cover, floor to ceiling.
  pillar(-5, -34, 1.6, 5.5, 'pillar'),
  pillar(4.4, -35.2, 1.4, 5.5, 'pillar'),
  pillar(-3.8, -42.6, 1.5, 5.5, 'pillar'),
  pillar(5.8, -41.4, 1.9, 5.5, 'pillar'),
  // Nave: three stumps (shots pass over them).
  pillar(-7, -70, 2, 1.2, 'lowPillar'),
  pillar(7, -70, 2, 1.2, 'lowPillar'),
  pillar(3, -78, 2, 1.2, 'lowPillar'),
];

// A pore sits by the wall, found by walking from a point inside the chamber toward the rock.
const pore = (chamber, x, z, dx, dz) => ({ chamber, ...towardWall(x, z, dx, dz, 1.25) });


const PADS = [
  { chamber: 0, x: 5.5, z: -8.5, kind: 'ammo' },
  { chamber: 0, x: -5.5, z: -4.5, kind: 'health' },
  { chamber: 1, x: 0, z: -38, kind: 'ammo' },
  { chamber: 1, x: 7.5, z: -45, kind: 'ammo' },
  { chamber: 1, x: -7.5, z: -31.5, kind: 'health' },
  { chamber: 1, x: 1.5, z: -45.5, kind: 'health' },
  { chamber: 2, x: -9.5, z: -66, kind: 'ammo' },
  { chamber: 2, x: 10, z: -78, kind: 'ammo' },
  { chamber: 2, x: 0, z: -62, kind: 'health' },
];

const BOXES = [
  ...wallBoxes(WALL_BAND, (x0, x1, z0, z1) => aabb(x0, x1, z0, z1, 0, WALL_H, 'wall')),
  ...PILLARS,
];

// Standing pools: placed once here, after the pads and boxes exist and before the freeze, from
// the cave's dressing seed. engine/cave.js runs the same placePools on its own generator, so
// it draws these pools and everything it places after them lands where it always has.
const POOLS = placePools(makeRng(CAVE_SEED), { spaces: SPACES, pads: PADS, boxes: BOXES });

// The Nave's loose stalactites, the ones the Cantor's song brings down (stalactites.js, cantorsong.js).
const LOOSE = placeLoose({ boxes: BOXES });

export const CAVE_CONFIG = deepFreeze({
  ...CONFIG,
  room: 'cave',
  encounter: 'chambers', // sim.js picks chambers.js

  arena: { half: 90, wallHeight: WALL_H, wallThickness: WALL_BAND }, // bounds clamp is a safety net only

  player: {
    ...CONFIG.player,
    spawn: { x: 0, z: -2 }, // near end of chamber 1
    spawnYaw: 0, // facing -Z, down the cave
    spawnGrace: 1.5,
  },

  // What is underfoot (surfaces.js): rock, with the standing pools as bowls whose shore is the
  // same noisy dip the engine draws (wet where bowlAt is above SHORE).
  surfaces: {
    base: 'rock',
    zones: POOLS.map((p) => ({ shape: 'bowl', x: p.x, z: p.z, r: p.r, chamber: p.chamber, material: 'pool' })),
  },

  // The Salt Bore. pellets/spread drive sim.js fire(); the carbine is pellets 1, spread 0.
  weapon: {
    name: 'bore',
    pellets: 7,
    spread: 5 * DEG, // largest angle of any pellet off the aim line
    damage: 9, // per pellet
    magazine: 6,
    startReserve: 30,
    maxReserve: 54,
    range: 26,
    fireInterval: 0.75,
    dryInterval: 0.35,
    reloadTime: 1.8,
    autoReloadDelay: 0.4,
    flinchPellets: 4, // this many pellets on one flinchable creature in one blast -> flinch
    flinchTime: 0.6, // stun length
    flinchKnockback: 1.0, // metres, along the shot, on top of the per-type knockback
  },

  // Regular creatures (creatures.js). radius/hitRadius/hitY/knockback are read by shared code.
  lurch: {
    hp: 60,
    speed: 2.6, // stalking speed (average of the pulse)
    pulsePeriod: 0.6, // seconds per stride pulse
    pulseDepth: 0.5, // speed swings +/- this fraction of speed over a pulse
    weavePeriod: 1.8, // seconds per side-to-side weave
    weaveAngle: 35 * DEG, // largest heading offset from the straight line while stalking
    coilRange: 7, // coils inside this distance with a clear line
    coilTime: 0.6,
    leapDistance: 6,
    leapSpeed: 12,
    leapDamage: 12, // R9: 14 as shipped, down 14 percent now that they hunt as a pack
    leapHeight: 0.9, // apex of the pounce arc, metres
    leapHitRadius: 0.9, // touching distance (centre to player centre) during a leap
    windedTime: 0.9, // lies winded this long after a leap
    radius: 0.45,
    hitRadius: 0.5,
    hitY: 0.45,
    knockback: 0.3,
    flinchable: true,
    tread: 0.8, // metres of ground per tread sound
    // The pack (R9): two or more stalking Lurches within `link` of each other (chained) hold a
    // ring of radius `ring` round the warden, evenly spaced and circling at `circle` of their
    // speed, until every one is within `tolerance` of the ring or `patience` seconds pass;
    // then every member with a clear leap line coils on the same frame and they leap together,
    // each leap long enough to reach the warden from the ring: at least leapDistance, at most
    // rushLeap (leapDistance x 1.2, the owner's 20 percent rule). From the 8 m ring a 7.2 m leap
    // ends 0.8 m from the warden, inside the touch of leapHitRadius + the warden's radius (1.3 m),
    // so the ring stays 8 m; the tolerance is 0.5 m so a member counted on the ring (8.5 m at
    // most) always reaches. Only Lurches within ring + link of the warden gather (`near`); a
    // gathering member aims at most `arc` radians round the ring ahead of itself. One alone: as shipped.
    pack: { link: 14, ring: 8, tolerance: 0.5, patience: 4, circle: 0.5, reach: 1, rushLeap: 7.2, arc: 0.6 },
  },

  weeper: {
    hp: 70,
    speed: 1.0, // slow shuffle
    holdMin: 8,
    holdMax: 14,
    lobInterval: 4.5,
    swellTime: 0.7,
    muzzleY: 1.8, // sac height the glob leaves from
    radius: 0.6,
    hitRadius: 0.6, // bounding sphere (aim point for scripts); shots use hitZones
    hitY: 1.3,
    // Shot volumes in the Weeper's own frame (x right, y up, z back; it faces -z), each with
    // the share of damage a pellet does there. The sac is the weak spot; the stalk takes half.
    hitZones: [
      { name: 'sac', x: -0.3, y: 1.78, z: -0.36, r: 0.42, mult: 1 },
      { name: 'body', x: 0.05, y: 0.45, z: 0.05, r: 0.42, mult: 0.5 },
      { name: 'body', x: 0.17, y: 1.1, z: 0.1, r: 0.38, mult: 0.5 },
      { name: 'body', x: 0.12, y: 1.75, z: -0.08, r: 0.32, mult: 0.5 },
    ],
    knockback: 0.1,
    flinchable: true,
    tread: 0.55,
  },

  // Globs and pools (hazards.js), shared by the Weeper and the Cantor's Shed.
  glob: {
    flight: 1.3, // seconds from launch to landing
    damage: 10,
    radius: 1.5, // landing damage radius
    arcHeight: 4, // engine only: apex of the drawn arc above the higher end
  },
  pool: {
    radius: 2,
    life: 4,
    damage: 4,
    tickInterval: 0.5,
  },

  // The boss (boss.js).
  cantor: {
    hp: 900,
    speed: 1.7, // Drag
    turnRate: 90 * DEG, // radians per second while turning (Drag and Sweep wind-up)
    radius: 1.2,
    hitRadius: 1.3,
    hitY: 1.8,
    knockback: 0,
    flinchable: false,
    critMultiplier: 2, // sim.js applies this while enemy.critWindow is true (Open)
    sweepRange: 5, // starts a Sweep inside this distance
    sweepWindup: 0.9,
    sweepReach: 5.5,
    sweepArc: 120 * DEG, // full arc, centred on the locked facing
    sweepDamage: 25,
    swingTime: 0.4, // the swing after the wind-up; no moving or turning, arc locked
    swingHitAt: 0.2, // seconds into the swing when the arc damage resolves
    openTime: 1.6,
    shedInterval: 9,
    shedTime: 0.8,
    shedGlobs: 3,
    shedFan: 20 * DEG, // angle between neighbouring globs in the fan
    shedFanDistanceMin: 2, // globs aimed this close to the Cantor are pushed out to it
    callInterval: 14,
    callBelow: 0.5, // fraction of hp under which Call starts
    callMax: 2, // never more than this many called Lurches alive
    callType: 'lurch',
    tread: 1.7,
  },

  // The Cantor's song (cantorsong.js; the owner, 2026-11-19). He sings in bouts while the fight is
  // on; each bout shakes stalactites loose from the vault: the first ever where the warden looks,
  // every one after over him or near him. A fallen one is gone for the run (stump and rubble, seen only).
  song: {
    first: 8, // seconds from the fight's start (the Shed clock's) to the first bout
    gapMin: 12, // seconds from one bout's end to the next, at random between these
    gapMax: 16,
    length: 2.4, // a bout: the four notes (cantorsong.js SONG_NOTES)
    drops: [0.9, 1.6, 2.3], // seconds into the bout each stalactite begins to come loose (during the song)
    more: [0.6, 0.25], // under each of these shares of his health a bout brings one more down (1, 2, 3)
    warn: 1.4, // seconds from the first warning (shadow, glow, glint, dust, grinding) to the impact (the art critic, C1: 0.8 s loosening)
    fall: 0.6, // of which the last this many it falls (let go at warn - fall)
    damage: 20, // to a warden within radius of the impact (once a bout at most)
    radius: 1.1, // metres, centre to the warden's centre
    near: 1.5, // metres: after the first, the ones within this of the warden are chosen from
    look: { min: 4, max: 6, level: 5 }, // metres ahead the first falls (level: looking level or down; the critic, C2: 4 to 6)
    stalactites: LOOSE,
  },

  bellowsEnabled: false,
  waves: [], // yard only
  gates: [], // yard only; the cave spawns from pores
  maxAlive: 4, // highest per-chamber cap; per-chamber caps below
  spawnInterval: 1.8,
  firstWaveDelay: 2, // chamber 1 banner before the first pore opens
  waveDelay: 1, // chambers 2 and 3: banner after the seal before the first pore opens
  winBeat: 1.2,
  loseBeat: 1.0,
  minPoreDist: 6, // pores closer than this to the player are skipped when others exist
  poreJitter: 0.5, // spawn position jitter (full width) around a pore

  drops: { chance: 0.4, ammo: 8, health: 25, maxLoose: 6 },
  pickupRadius: 1.1,
  softlockDelay: 1.2,

  spaces: SPACES,
  boxes: BOXES,
  // Read only by hitscan (castShot); a ceiling in boxes would block walking.
  ceilings: SPACES.flatMap((s) => ceilingBoxes(
    s.index, WALL_BAND, (x0, x1, z0, z1) => aabb(x0, x1, z0, z1, s.ceiling, s.ceiling + CEILING_T, 'ceiling'),
  )),

  // Veils: role exit = closed from the start until its chamber is cleared;
  // role entry = open until the player is 3 m inside its chamber, then sealed for good.
  // side: which way the veil folds open (+1 toward +Z, -1 toward -Z: into its tunnel).
  // zone: the engine zone of that tunnel. height: the tunnel's ceiling.
  veils: [
    { chamber: 0, role: 'exit', box: veil(0, -18), side: -1, zone: 1, height: 3 },
    { chamber: 1, role: 'entry', box: veil(8.5, -28), side: 1, zone: 1, height: 3 },
    { chamber: 1, role: 'exit', box: veil(-8.5, -48), side: -1, zone: 3, height: 3 },
    { chamber: 2, role: 'entry', box: veil(0, -58), side: 1, zone: 3, height: 3 },
  ],

  // Weeper seats in the Hatchery alcoves. y is the ledge height a seated Weeper stands at.
  ledges: [
    { chamber: 1, x: -11.75, z: -31.5, y: 0.9 },
    { chamber: 1, x: 11.4, z: -37.5, y: 0.9 },
  ],

  pores: [
    pore(0, 0, -8, -1, -0.12),
    pore(0, 1, -10, 1, -0.45),
    pore(0, -1, -11, -0.55, -1),
    pore(1, 0, -38.5, 1, 0.5),
    pore(1, 0, -38.5, -1, 0.12),
    pore(1, 2, -40, 1, -0.75),
    pore(1, 0, -40, 0.3, -1),
    pore(1, -3, -36, -0.1, 1),
    pore(2, 0, -74, -1, 0), // Call pores
    pore(2, 0, -74, 1, 0),
  ],

  pads: PADS,

  // Chamber table (chambers.js). entryVeil/exitVeil index into veils (null = none).
  // trigger: the player inside this XZ box enters the chamber (3 m past the entry veil).
  chambers: [
    {
      name: 'Throat', entryVeil: null, exitVeil: 0, trigger: null,
      lurch: 5, weeper: 0, seated: 0, boss: null, maxAlive: 3,
    },
    {
      name: 'Hatchery', entryVeil: 1, exitVeil: 2,
      trigger: { minX: -11, maxX: 11, minZ: -48, maxZ: -31 },
      lurch: 5, weeper: 2, seated: 2, boss: null, maxAlive: 4,
    },
    {
      name: 'Nave', entryVeil: 3, exitVeil: null,
      trigger: { minX: -14, maxX: 14, minZ: -86, maxZ: -61 },
      lurch: 0, weeper: 0, seated: 0, boss: 'cantor', bossSpawn: { x: 0, z: -82 }, maxAlive: 3,
    },
  ],
});

/** Enemy types that exist only in the cave; resetSim to the yard must leave none. */
export const CAVE_ENEMY_TYPES = Object.freeze(['lurch', 'weeper', 'cantor']);
