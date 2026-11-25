// Every balance number and layout fact for LANTERN YARD. Pure data, no imports.
// Values follow 02-ux-workflow.md section 3 (engineer may tune within 20 percent).

const DEG = Math.PI / 180;

function box(x, z, w, d, h, kind) {
  return {
    kind,
    x, z, w, d, h,
    minX: x - w / 2, maxX: x + w / 2,
    minY: 0, maxY: h,
    minZ: z - d / 2, maxZ: z + d / 2,
  };
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(o);
}

const HALF = 22;

const R = (minX, maxX, minZ, maxZ) => ({ minX, maxX, minZ, maxZ });

/**
 * The climbable crates (#21): each is a two-level place like the castle's pit (levels.js), turned
 * over. rect holds the crate, its ramp or ladder and its small box; the ground is the floor, the
 * crate top (deck, the crate's own footprint) the top, the ramp or ladder the stair (a smooth one;
 * a ladder is steep and carries climb), the small box a step. solid: nothing is hollow under it.
 * Every edge lies on the creatures' 0.5 m walk grid (climb.cell; tests/climb.test.js checks), so
 * no grid cell straddles two levels.
 */
const LEVELS = [
  { // the ramp up the east side of the tall crate at (-8, -6); the small box on its north side
    id: 'crateRamp', rect: R(-9, -2.5, -8, -5), floor: 0, top: 2.6, solid: true,
    deck: R(-9, -7, -7, -5),
    stair: { rect: R(-7, -2.5, -6.5, -5.5), axis: 'x', head: -7, dir: 1, landing: 0, run: 0.45, rise: 0.26, treads: 10, top: 2.6, smooth: true },
    steps: [{ rect: R(-8.5, -7.5, -8, -7), h: 1.2 }],
  },
  { // a ladder up the north face of the tall crate at (6, 6); the small box on its east side
    id: 'crateLadder', rect: R(5, 8, 4, 7), floor: 0, top: 2.6, solid: true,
    deck: R(5, 7, 5, 7),
    stair: { rect: R(5.5, 6.5, 4, 5), axis: 'z', head: 5, dir: -1, landing: 0, run: 0.1, rise: 0.26, treads: 10, top: 2.6, smooth: true, climb: true },
    steps: [{ rect: R(7, 8, 5.5, 6.5), h: 1.2 }],
  },
  { // a ladder up the west face of the long tall crate at (14, 2); the small box on its south end
    id: 'crateLadderWest', rect: R(12, 15, 0, 5), floor: 0, top: 2.6, solid: true,
    deck: R(13, 15, 0, 4),
    stair: { rect: R(12, 13, 1.5, 2.5), axis: 'x', head: 13, dir: -1, landing: 0, run: 0.1, rise: 0.26, treads: 10, top: 2.6, smooth: true, climb: true },
    steps: [{ rect: R(13.5, 14.5, 4, 5), h: 1.2 }],
  },
];

function stepBox(s) {
  const r = s.rect;
  return { ...box((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, r.maxX - r.minX, r.maxZ - r.minZ, s.h, 'step'), ...r };
}
const WALL_T = 1.2;
const WALL_H = 6;

export const CONFIG = deepFreeze({
  room: 'yard',
  encounter: 'waves', // sim.js picks the encounter stepper from this: waves.js

  // sea-1-dock (R1, R2): the yard's way out is the east wall's stack, not the crater. The
  // crater's own rules and tests stay in the code, switched off here; a test that still wants
  // the crater names it through this field (withConfig({ wayout: 'crater' })). See wayout.js.
  wayout: 'breach',

  arena: { half: HALF, wallHeight: WALL_H, wallThickness: WALL_T },

  player: {
    health: 100,
    radius: 0.4,
    eyeHeight: 1.65,
    walkSpeed: 5.5,
    sprintSpeed: 8.5,
    gravity: 22,
    jumpVelocity: 7,
    spawn: { x: 0, z: 17 },
    spawnYaw: 0, // facing -Z, toward arena centre
    pitchLimit: 85 * DEG,
    fallResetY: -5,
    spawnGrace: 1.5, // no damage this long after a wave's first spawn
    stride: { walk: 2.1, run: 2.35 }, // metres of ground per footstep, by gait
    splashCooldown: 0.6, // at most one splash this often (seconds)
  },

  // What is underfoot (surfaces.js). First matching zone wins, else base. The engine draws
  // the puddles and plates from here, so what is seen and what is heard are the same.
  surfaces: {
    base: 'concrete',
    zones: [
      // Steel floor plates: one under each supply pad, one strip in front of the winch.
      { shape: 'rect', minX: 16.7, maxX: 19.3, minZ: -19.3, maxZ: -16.7, material: 'plate' },
      { shape: 'rect', minX: -19.3, maxX: -16.7, minZ: 16.7, maxZ: 19.3, material: 'plate' },
      { shape: 'rect', minX: -19.3, maxX: -16.7, minZ: -19.3, maxZ: -16.7, material: 'plate' },
      { shape: 'rect', minX: 16.7, maxX: 19.3, minZ: 16.7, maxZ: 19.3, material: 'plate' },
      { shape: 'rect', minX: -2.5, maxX: 2.5, minZ: -10.5, maxZ: -9, material: 'plate' },
      // Standing water: rx across, rz along the yard (0.8 of rx, the middle of the old
      // per-load 0.6 to 1.0 squash).
      { shape: 'ellipse', x: -4, z: -2, rx: 2.2, rz: 1.76, material: 'puddle' },
      { shape: 'ellipse', x: 9, z: 9, rx: 1.6, rz: 1.28, material: 'puddle' },
      { shape: 'ellipse', x: -16, z: 7, rx: 2.6, rz: 2.08, material: 'puddle' },
      { shape: 'ellipse', x: 5, z: -16, rx: 1.8, rz: 1.44, material: 'puddle' },
      { shape: 'ellipse', x: 16, z: -4, rx: 1.4, rz: 1.12, material: 'puddle' },
      { shape: 'ellipse', x: -9, z: 17, rx: 1.5, rz: 1.2, material: 'puddle' },
      { shape: 'ellipse', x: 2, z: 11, rx: 1.2, rz: 0.96, material: 'puddle' },
    ],
  },

  weapon: {
    damage: 34,
    magazine: 12,
    startReserve: 48,
    maxReserve: 96,
    range: 60,
    fireInterval: 0.2, // 5 shots per second while held
    dryInterval: 0.35,
    reloadTime: 1.4,
    autoReloadDelay: 0.4,
  },

  wick: {
    hp: 60,
    speed: 3.4,
    damage: 10,
    reach: 1.6,
    attackInterval: 1.0,
    windup: 0.35,
    radius: 0.5,
    hitRadius: 0.55,
    hitY: 1.1,
    knockback: 0.35,
    tread: 1.1, // metres of ground per tread sound
  },

  bellows: {
    hp: 100,
    speed: 1.8,
    holdMin: 10,
    holdMax: 16,
    fireInterval: 2.5,
    windup: 0.6,
    radius: 0.75,
    hitRadius: 0.8,
    hitY: 1.0,
    muzzleY: 1.1,
    knockback: 0.15,
    boltDamage: 12,
    boltSpeed: 9,
    boltRadius: 0.3,
    boltLife: 7,
    tread: 0.9,
  },

  steering: {
    probe: 2.4,
    stuckTime: 4,
    rerouteTime: 2.2,
    rerouteOffset: 7,
  },

  bellowsEnabled: true,
  waves: [
    { wicks: 4, bellows: 0 },
    { wicks: 6, bellows: 1 },
    { wicks: 8, bellows: 2 },
  ],
  maxAlive: 8,
  spawnInterval: 1.4,
  firstWaveDelay: 2,
  waveDelay: 1,
  breather: 4,
  winBeat: 1.2,
  loseBeat: 1.0,
  minSpawnDist: 12,
  minViewSpawnDist: 8,

  drops: { chance: 0.3, ammo: 12, health: 25, maxLoose: 6 },
  pickupRadius: 1.1,
  softlockDelay: 1.2, // ammo crate appears this long after hitting 0 / 0 (limit is 3 s)

  boxes: [
    // perimeter hull-plate walls
    box(0, -HALF - WALL_T / 2, 2 * HALF + 2 * WALL_T, WALL_T, WALL_H, 'wall'),
    box(0, HALF + WALL_T / 2, 2 * HALF + 2 * WALL_T, WALL_T, WALL_H, 'wall'),
    box(-HALF - WALL_T / 2, 0, WALL_T, 2 * HALF, WALL_H, 'wall'),
    // the east wall (sea-1-dock R1, R2): its middle 8 m is the stack (two steel containers, old
    // wooden crates and casks, on the same footprint as the wall it replaces, as solid), the
    // rest unchanged. Three boxes tile the same span the one wall box did (z -22 to 22), so the
    // crater path's own collision checks see no difference.
    box(HALF + WALL_T / 2, 13, WALL_T, 18, WALL_H, 'wall'), // north of the stack, z 4 to 22
    box(HALF + WALL_T / 2, -13, WALL_T, 18, WALL_H, 'wall'), // south of the stack, z -22 to -4
    box(HALF + WALL_T / 2, 0, WALL_T, 8, WALL_H, 'stack'), // the stack itself, z -4 to 4
    // cover
    box(-8, -6, 2, 2, 2.6, 'crate'),
    box(8, -6, 2.4, 2, 1.3, 'crate'),
    box(-6, 6, 3, 1.5, 1.3, 'crate'),
    box(6, 6, 2, 2, 2.6, 'crate'),
    box(0, -12, 4, 3, 2.8, 'winch'),
    box(-14, 0, 1.5, 8, 3.2, 'rib'),
    box(14, 2, 2, 4, 2.6, 'crate'),
    box(0, 2, 1.6, 1.6, 1.3, 'crate'),
    box(-12, 13, 2, 2, 2.6, 'crate'),
    box(12, 12, 3, 1.5, 1.3, 'crate'),
    box(12, -14, 2, 2, 2.6, 'crate'),
    box(-12, -14, 2.5, 2, 1.3, 'crate'),
    // the small boxes beside the climbable crates (levels, below): the safe step down. Kept at
    // the end of the list so the crates keep their stencils (world.js numbers them in order).
    ...LEVELS.map((L) => stepBox(L.steps[0])),
  ],

  // Climbing (#21): the ladder's climb speed (metres a second, up or down), and the fall. A
  // drop over safeDrop costs a share of the gallery's crypt fall (gallery.js fallDamage, for
  // its 4 m), scaled by how far past safeDrop the drop went; fallRef is that 4 m. A walk off an
  // edge (not a jump) comes down near-straight, at most dropSpeed across, so a step off the top
  // lands on the small box beside it.
  climb: { ladderSpeed: 1.6, safeDrop: 2.0, fallRef: 4, dropSpeed: 1.5, cell: 0.5 },
  levels: LEVELS,

  gates: [
    { x: 0, z: -20 }, { x: -9, z: -20 }, { x: 9, z: -20 },
    { x: -20, z: -8 }, { x: 20, z: -8 },
    { x: -20, z: 8 }, { x: 20, z: 8 },
    { x: -8, z: 20 }, { x: 8, z: 20 },
  ],

  pads: [
    { x: 18, z: -18, kind: 'ammo' },
    { x: -18, z: 18, kind: 'ammo' },
    { x: -18, z: -18, kind: 'health' },
    { x: 18, z: 18, kind: 'health' },
  ],

  // sea-1-dock (R1, R2): what the stack's box (kind 'stack', above) is swapped for once the
  // blast strikes (wayout.js breachBoxes) - debris either side of a 3 m lane (WAYOUT.breach.lane)
  // through the middle of its 8 m footprint (z -4 to 4), so the gap is walkable and the rest of
  // the stack's rubble still blocks.
  breachDebris: [
    box(HALF + WALL_T / 2, -2.75, WALL_T, 2.5, WALL_H, 'debris'), // z -4 to -1.5
    box(HALF + WALL_T / 2, 2.75, WALL_T, 2.5, WALL_H, 'debris'), // z 1.5 to 4
  ],
});

/** Returns a frozen copy of CONFIG with top-level keys replaced (tests and fallbacks). */
export function withConfig(overrides) {
  return deepFreeze({ ...CONFIG, ...overrides });
}
