// The castle encounter (cfg.encounter 'keep', docs/features/castle/02-design.md): seven stages
// (the bridge, then one per checkpoint passed), what E is looking at and what it does, the
// arrival (the court's carry or the title kit) and the stage-0 checkpoint, restore and the
// castle's own snapshot validator (security A2), the hint ladder, the hazards (the pit and its
// snakes, the werewolf's reach), the cut scenes (count.js owns them, A4), and the end trigger.
// State lives in sim.waves under the shared names (index, count, queue, phase); `count` is the
// Count's room (count.js), so the stage count is STAGES. `under` is derived from position by
// keepmap.js floorZoneAt (security A3). `hold` counts only from a press the sim observed
// (`pressed`, security A6). The hall's inner door opens on garlic carried (A7), and the garlic
// is wielded on Q while any is carried (syncGarlic, #9). The hand lantern, once taken in the hall,
// is carried on the same cycle (syncLantern; its rules in lantern.js) and put away outdoors.
// Creature rules live in sentries.js, the puzzles in clocks.js, gallery.js and knight.js, the
// Count in count.js and the dread in haunts.js; this file seats them, calls them and applies
// what they return (damage through the shipped hurtPlayer, done flags, under).

import {
  SPAWNS, OPENING, SENTRIES, chessColliders, CLOCKS, PIT, CRYPT, GALLERY, BOARD, CRYPT_PROPS, HALL, COUNT_ROOM, END, COUNTWAY,
  STOCK, WINDOWS, HAUNT_PLACES, CURTAIN_TARGETS, TEA, DOORS, PIKES,
  floorZoneAt, zoneAt, stageOf, tileAt, tileRect, squareRect, squareCell, squareAt, walkWallsNear,
} from './keepmap.js';
import { CASTLE_PLACES, ENTRIES } from './script.js';
import { cryptSolids, pitPiers, furnitureBoxes } from './solids.js';
import { addEntry } from './journal.js';
import { MATERIALS, surfaceAt } from './surfaces.js';
import { hurtPlayer } from './enemy.js';
import { createPlayer, healPlayer } from './player.js';
import { createWeapon, cancelReload, cancelSwing, carryWeapon, swapWeapon, gunOf, carried, specOf, weaponNamed } from './weapon.js';
import { restockPads } from './pickups.js';
import { pullStake, pullable, stakesToBody, crossbowOf } from './stakes.js';
import { talkTo, talkState, hush } from './talk.js';
import { createClocks, clocksFor, setClock } from './clocks.js';
import { createTiles, wholeTiles, stepAt, shootTile, nextTrue } from './gallery.js';
import { createBoard, leap, reachable, stepOff, bestRoute, boardAfterDeath, isFarRank } from './knight.js';
import {
  createCount, stepCount, pullCord, shotsAtCurtains, countDeath, startScene, stepScene, curtainReady, countHint, FINAL_CURTAIN,
} from './count.js';
import { seatSentries, sentryKilled, innerDoorOpen, lowerGarlic } from './sentries.js';
import { LEAF_DOORS, doorLeafBoxes, swingToward } from './doorleaves.js'; // the door leaves, solid in every state
import { createHaunts, stepHaunts, ghostScream, landRaven } from './haunts.js';
import { reflectionLook } from './reflection.js';
import { createRoad, settledRoad, stepRoad, roadBlock, outSeat } from './road.js'; // issue #29: the road up from the wood
import { tunnelSeat, startSeat, TUNNEL } from './tunnelwalk.js'; // the walk from the Caterpillar's gate to the road
import { cutawayDue, startCutaway, stepCutaway } from './cutaway.js'; // the werewolf cutaway, right after the boulder
import { lidBox } from './countlid.js'; // the Count's thrown-back lid, solid once it lies there
import { LANTERN, lanternRoom, lanternIndoors, lanternBack } from './lantern.js'; // the hand lantern, found in the hall

/** The bridge, then one stage per checkpoint (the castle door to the Count's door). */
export const STAGES = 7;

/** Every done flag the castle has: only ever merged upward. */
export const DONE_KEYS = Object.freeze(['armour', 'wife', 'clocks', 'strikeSeen', 'gallery', 'fell', 'knight', 'dawn']);

/**
 * What restoreCheckpoint does to each field (security A2, as the court's RESTORE_FIELDS): every
 * field of sim and of sim.waves is either written from the checkpoint (or rebuilt) or kept. A
 * field in neither list is the defect; tests/keep.test.js fails on it.
 */
export const KEEP_RESTORE_FIELDS = Object.freeze({
  sim: Object.freeze({
    writes: Object.freeze(['player', 'weapon', 'holster', 'rack', 'enemies', 'bolts', 'globs', 'pools', 'pickups', 'boxes',
      'status', 'statusTimer', 'softlockFor', 'pending', 'waves']),
    keeps: Object.freeze(['cfg', 'seed', 'rng', 'time', 'nextId', 'stats']),
  }),
  waves: Object.freeze({
    writes: Object.freeze(['index', 'queue', 'phase', 'under', 'walk', 'clocks', 'tiles', 'board', 'count', 'haunts', 'raised',
      'items', 'loot', 'stakes', 'bodies', 'pins', 'dropped', 'stock', 'hints', 'focus', 'line', 'notice', 'scene',
      'checkpoint', 'pressed', 'leap', 'struck', 'falling', 'snake', 'claw', 'lanternPrev']),
    keeps: Object.freeze(['done', 'game', 'log', 'talk', 'road', 'leaves']), // road (#29): the dark and both scares' latches, settled; leaves: each door's swing, as it stood
  }),
});

/** The notice line's key (script.js NOTICES) for each thing taken here. */
export const KEEP_NOTICES = Object.freeze({ garlic: 'garlic', health: 'health', ammo: 'ammo', salt: 'ammo', stakes: 'stake', lantern: 'lantern' });

/** Puzzle by zone, for the hint ladder (R19). */
const PUZZLE_OF = Object.freeze({ tea: 'clocks', gallery: 'gallery', crypt: 'gallery', walk: 'board' });
const PLAIN = Object.freeze({ clocks: 'plainClocks', gallery: 'plainGallery', board: 'plainBoard' });

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const inRect = (r, x, z, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
const clockRules = (cfg) => ({ stopped: cfg.clocks.stopped, right: cfg.clocks.right, minute: 0 });

function freshItems() {
  return { garlic: 0, cup: 'none', ticket: false, stakes: 0 };
}

function freshDone() {
  const d = {};
  for (const k of DONE_KEYS) d[k] = false;
  return d;
}

function freshHints() {
  return {
    clocks: { idle: 0, rung: 0, last: 0 },
    gallery: { idle: 0, rung: 0, last: 0, row: 0, grin: null },
    board: { idle: 0, rung: 0, last: 0, moves: 0 },
  };
}

/** The Count's room stocks upstairs, both full (R11, R13). */
const freshStock = () => ({ salt: true, stakes: true });

/** A fresh castle state (resetSim). rng is the run's generator (haunts draw their first waits). */
export function createKeep(cfg, rng = () => 0.5) {
  return {
    index: 0,
    count: createCount(null), // the Count's room (count.js)
    phase: 'still', // still | open | done
    queue: [], // stays empty: nothing is queued in this room
    under: null, // null | 'pit' | 'crypt' (A3: from position, keepGround)
    walk: null, // the band of x on the walk from the gate whose walls are in sim.boxes, or null (from position, keepGround)
    done: freshDone(),
    game: { chessDeaths: 0, countDeaths: 0, removed: [] }, // this game's deaths (A8) and the pieces they took (G7)
    clocks: createClocks(cfg.clocks.stopped),
    tiles: createTiles(),
    board: createBoard(OPENING),
    haunts: createHaunts(cfg, rng),
    raised: 0, // hold-ups of the garlic that found the wife this life (sentries.js stepGarlic, #9)
    items: freshItems(),
    loot: cfg.loot.map((l) => ({ key: l.key, taken: false })),
    stakes: [],
    bodies: [],
    pins: [],
    dropped: [],
    stock: freshStock(),
    log: [],
    talk: {},
    hints: freshHints(),
    focus: null,
    line: null,
    notice: null,
    scene: null,
    checkpoint: null,
    pressed: false, // a press of E the sim observed, still held (A6)
    leap: null, // { from, to, left, total, damage, striker, won } while the knight is in the air
    struck: null, // the square of the last piece that struck the warden (G7's killer)
    falling: null, // 'pit' while falling into the pit, 'crypt' after a tile gave way
    snake: 0, // seconds to the next bite on the pit floor
    claw: { tell: 0, cool: 0 }, // the werewolf's arm
    lanternPrev: null, // the weapon in hand when the lantern came up: putting it away goes back there (lantern.js)
    road: createRoad(true), // issue #29: the road behind the warden (a journey from the wood seats a fresh one: enterRoad)
    leaves: {}, // door id -> its leaves' swing, 0 shut to 1 open (doorleaves.js); a door not yet seen stands as the rules say
  };
}

// ---- floors and collision (security A3) ------------------------------------------------------

/** Ground height for feet at y (sim.js floorOf): the plan's one answer. */
export function keepFloor(sim, x, z, y) {
  return floorZoneAt(x, z, y, sim.waves).floor;
}

/** After the warden moves (sim.js): which floor, from position alone, and the boxes for it. */
export function keepGround(sim) {
  const w = sim.waves;
  const pl = sim.player;
  const under = floorZoneAt(pl.x, pl.z, pl.y, w).under;
  const walk = walkBandOf(pl.x);
  if (under !== w.under || walk !== w.walk) {
    w.under = under;
    w.walk = walk;
    sim.boxes = keepBoxes(sim.cfg, w);
  }
}

// The walk's walls go into the collision list by WALK_BAND-metre bands of x round the warden, WALK_REACH
// metres either side (a frame's step is under half a metre; the band is re-read after every move).
const WALK_BAND = 4;
const WALK_REACH = 12;
/** The band of x the warden stands in, east of the road's middle (the walk and leg 1's east end), or null. */
export function walkBandOf(x) {
  return Number.isFinite(x) && x > WALK_FROM ? Math.floor(x / WALK_BAND) : null;
}
const WALK_FROM = TUNNEL.mouth.x - WALK_REACH;

/**
 * What is underfoot (sim.js asks for the warden's feet): on the pit's floor and stair, earth;
 * in the crypt, cut stone; else the room's surface zones, which describe the upper floor.
 */
export function keepSurface(sim, x, z) {
  const u = sim.waves && sim.waves.under;
  if (u === 'pit' || u === 'crypt') {
    const material = u === 'pit' ? 'earth' : 'ashlar';
    return { material, family: MATERIALS[material] };
  }
  return surfaceAt(sim, x, z);
}

/** True when door d (keepmap.js DOORS) is open now for the castle state w. */
export function doorOpen(w, d) {
  if (!d.key) return true;
  if (d.key === 'garlic') return innerDoorOpen({ waves: w }); // garlic carried (A7)
  return !!w.done[d.key];
}

const thin = (minX, maxX, minZ, maxZ) => ({
  kind: 'board', x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h: 0.1,
  minX, maxX, minY: 0, maxY: 0.1, minZ, maxZ,
});

/**
 * Live collision: the room's walls and props, every shut door, the lower floor's walls while
 * the warden is down there (the pit's edges, the crypt's walled doors and boxes of earth), the
 * stairwell's rails on the gallery floor, and the board: until it is won the warden stays on
 * the south margin or on the one square the knight stands on. In the crypt, nothing marked as
 * standing on the gallery's floor above (floor: 'upper', keepmap.js: the hearth) blocks: the plan
 * is flat, so it would be an invisible wall below.
 */
const onGalleryFloor = (b) => b.floor === 'upper';

/** Door d's leaves' swing now: the sim's own (stepLeaves), or, for a door not yet stepped, as the rules stand. */
export function leafSwing(w, d) {
  const p = w.leaves && w.leaves[d.id];
  return typeof p === 'number' ? p : (doorOpen(w, d) ? 1 : 0);
}

/**
 * Swings each leafed door toward what the rules say (open or shut) at the leaves' pace
 * (doorleaves.js). Runs every frame, in a scene too (the strike's camera watches the tea room's door
 * open), so the leaves the view draws are the ones that collide.
 */
export function stepLeaves(w, dt) {
  if (!w.leaves) w.leaves = {};
  for (const d of LEAF_DOORS) {
    const goal = doorOpen(w, d) ? 1 : 0;
    const p = w.leaves[d.id];
    w.leaves[d.id] = typeof p === 'number' ? swingToward(p, goal, dt) : goal;
  }
}

export function keepBoxes(cfg, w) {
  const out = w.under === 'crypt' ? cfg.boxes.filter((b) => !onGalleryFloor(b)) : [...cfg.boxes];
  // on the walk from the gate (or about to step onto it): its walls round the warden only (keepmap.js walkWalls)
  if (w.walk != null) walkWallsNear(w.walk * WALK_BAND - WALK_REACH, (w.walk + 1) * WALK_BAND + WALK_REACH, out);
  for (const d of DOORS) {
    // the leaves are solid wherever they stand: swinging, open, or swinging to (doorleaves.js)
    const swing = d.key ? leafSwing(w, d) : 0;
    if (swing > 0) doorLeafBoxes(d, swing, out);
    if (doorOpen(w, d)) continue;
    const r = d.rect;
    out.push({ kind: 'door', id: d.id, x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, d: r.maxZ - r.minZ, h: 4,
      minX: r.minX, maxX: r.maxX, minY: 0, maxY: 4, minZ: r.minZ, maxZ: r.maxZ });
  }
  const swarm = roadBlock(w.road); // issue #29: nothing passes the bats' trigger point while they are on the road
  if (swarm) out.push(swarm);
  if (w.under === 'pit') out.push(...PIT.walls, ...pitPiers());
  else if (w.under === 'crypt') out.push(...CRYPT.walls, ...CRYPT.props, ...cryptSolids());
  else out.push(...CRYPT.rails);
  // the mirror room's jumpy furniture, where haunts.js has it now (solids.js)
  out.push(...furnitureBoxes(w.haunts));
  // the Count's lid, thrown back: a ramp from the rim to the floor, solid like a door (countlid.js)
  const lid = lidBox(cfg, w);
  if (lid) out.push(lid);
  // the chessmen are solid wherever they are drawn: every black piece standing on its square (won
  // or not) and the three white ones by the west wall (keepmap.js chessColliders, PIECE_FOOT); but
  // not while the knight is in the air: he leaps over them, as a knight does (stepLeap carries him)
  if (!w.leap) out.push(...chessColliders(w.board));
  if (!w.done.knight && !w.leap) {
    const at = w.board && w.board.at;
    const s = at && squareRect(at);
    const T = 0.2;
    if (!s) out.push(thin(1, 25, BOARD.rect.minZ, BOARD.rect.maxZ));
    else {
      out.push(thin(s.minX - T, s.maxX + T, s.minZ - T, s.minZ)); // north
      out.push(thin(s.minX - T, s.minX, s.minZ, s.maxZ)); // west
      out.push(thin(s.maxX, s.maxX + T, s.minZ, s.maxZ)); // east
      if (squareCell(at).rank !== 1) out.push(thin(s.minX - T, s.maxX + T, s.maxZ, s.maxZ + T)); // south: rank 1 steps off
    }
  }
  return out;
}

// ---- kits, carries and snapshots -----------------------------------------------------------

/** The weapons a list of carried weapons seats: [in hand, holster, ...rack]. */
function seatWeapons(sim, list) {
  sim.weapon = list[0];
  sim.holster = list[1] || null;
  sim.rack = list.slice(2);
  for (const x of list) {
    cancelReload(x);
    cancelSwing(x);
    x.cooldown = 0;
  }
}

/** The title kit's weapons (R2): the salt gun in hand, then the crossbow, the halberd, the cup, the garlic (#9). */
function kitWeapons(cfg) {
  const k = cfg.titleKit;
  const bore = createWeapon(cfg);
  bore.mag = k.bore.mag;
  bore.reserve = k.bore.reserve;
  const cb = createWeapon(cfg, cfg.weapons.crossbow);
  cb.mag = k.crossbow.mag;
  cb.reserve = k.crossbow.reserve;
  const list = [bore, cb];
  if (k.halberd) list.push(createWeapon(cfg, cfg.weapons.halberd));
  if (k.cup) list.push(createWeapon(cfg, cfg.weapons.cup));
  if (k.garlic > 0 && cfg.weapons.garlic) list.push(createWeapon(cfg, cfg.weapons.garlic));
  return list;
}

/**
 * The garlic is wielded on Q while any is carried (#9): it joins the cycle at its place in
 * cfg.weaponOrder when items.garlic > 0 and is not carried, and leaves it at none (a carry or a
 * snapshot never wields garlic it does not hold). Nothing spends garlic (A7), so in play it only
 * ever joins, when the braid is taken.
 */
function syncGarlic(sim) {
  const { cfg, waves: w } = sim;
  if (!cfg.weapons || !cfg.weapons.garlic) return;
  const has = !!(w.items && w.items.garlic > 0);
  const g = weaponNamed(sim, 'garlic');
  if (has && !g) carryWeapon(sim, createWeapon(cfg, cfg.weapons.garlic));
  else if (!has && g) {
    const list = carried(sim).filter((x) => x !== g);
    sim.weapon = list[0];
    sim.holster = list[1] || null;
    sim.rack = list.slice(2);
  }
}

/**
 * The hand lantern (logic/lantern.js) is carried once it is taken (items.lantern): it joins the
 * cycle at its place in cfg.weaponOrder (last), and a snapshot or a carry that does not hold it
 * never wields it. Nothing spends it, so in play it only ever joins, when it is taken in the hall.
 */
function syncLantern(sim) {
  const { cfg, waves: w } = sim;
  if (!lanternRoom(cfg)) return;
  const has = !!(w.items && w.items.lantern === true);
  const l = weaponNamed(sim, LANTERN.name);
  if (has && !l) carryWeapon(sim, createWeapon(cfg, cfg.weapons.lantern));
  else if (!has && l) {
    const list = carried(sim).filter((x) => x !== l);
    sim.weapon = list[0];
    sim.holster = list[1] || null;
    sim.rack = list.slice(2);
  }
}

/** Outdoors (the road, the bridge, the forecourt) the lantern is not up: it goes back for the next weapon on Q. */
function stowLantern(sim, events) {
  if (!sim.weapon || sim.weapon.name !== LANTERN.name || lanternIndoors(sim)) return;
  if (swapWeapon(sim, lanternBack(sim))) events.push({ type: 'swap', weapon: sim.weapon.name });
}

/** Seats the Castle start's kit: full health, four weapons, the cup full, one garlic, the two cards' entries. */
function seatTitle(sim) {
  const { cfg, waves: w } = sim;
  seatWeapons(sim, kitWeapons(cfg));
  sim.player.health = cfg.titleKit.health;
  w.items = { ...freshItems(), garlic: cfg.titleKit.garlic, cup: cfg.titleKit.cup };
  w.log = ['toCastle', 'hour']; // the forest-to-castle card and Renfield's hour on its clue card (G5)
  syncGarlic(sim);
}

function snapshot(sim, index) {
  const w = sim.waves;
  const at = SPAWNS[index];
  return {
    index,
    spawn: { x: at.x, z: at.z, y: at.y },
    facing: at.yaw,
    health: sim.player.health,
    weapon: clone(sim.weapon),
    holster: clone(sim.holster),
    rack: clone(sim.rack || []),
    items: clone(w.items),
    loot: clone(w.loot),
    stakes: clone(w.stakes),
    bodies: clone(w.bodies),
    pins: clone(w.pins),
    dropped: clone(w.dropped),
    pickups: clone(sim.pickups),
    done: clone(w.done),
    log: clone(w.log),
  };
}

/** A weapon by name against the allow-list, with finite numbers no less than zero. */
function validWeapon(x, cfg) {
  return isObj(x) && typeof x.name === 'string' && own(cfg.weapons, x.name)
    && finite(x.mag) && finite(x.reserve) && x.mag >= 0 && x.reserve >= 0;
}

/** The carried weapons: each valid, no name twice, the salt gun among them, no more than the allow-list holds. */
function validWeapons(list, cfg) {
  if (!Array.isArray(list) || !list.length || list.length > Object.keys(cfg.weapons).length) return false;
  if (!list.every((x) => validWeapon(x, cfg))) return false;
  const names = list.map((x) => x.name);
  return new Set(names).size === names.length && names.includes(cfg.weapon.name);
}

/** A weapon's numbers clamped to its spec (a snapshot or a carry never holds more than a weapon can). */
function clampWeapon(x, cfg) {
  const spec = specOf(cfg, x);
  const out = createWeapon(cfg, spec); // a fresh weapon: only the name and the counts below are read from x
  for (const k of ['mag', 'reserve', 'worn', 'loadedWorn']) if (x[k] != null && k in out) out[k] = x[k];
  out.mag = clamp(Math.floor(out.mag), 0, spec.magazine);
  out.reserve = clamp(Math.floor(out.reserve), 0, spec.maxReserve);
  if (out.worn != null) out.worn = clamp(finite(out.worn) ? Math.floor(out.worn) : 0, 0, out.reserve);
  if (out.loadedWorn != null) out.loadedWorn = !!out.loadedWorn;
  return out;
}

const CUPS = Object.freeze(['none', 'empty', 'full']);

/** Most garlic or spare stakes a warden can hold (the court's patches and the braid; the crossbow's reserve). */
export const ITEM_LIMITS = Object.freeze({ garlic: 9, stakes: 10 });
const ITEM_KEYS = Object.freeze(['garlic', 'cup', 'ticket', 'stakes', 'lantern']);
const count = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

/** Items (A2): only the castle's five keys; whole counts within their limits; a cup state; a ticket flag; a lantern flag. */
function validItems(it) {
  return isObj(it) && Object.keys(it).every((k) => ITEM_KEYS.includes(k))
    && count(it.garlic, ITEM_LIMITS.garlic)
    && (it.cup == null || CUPS.includes(it.cup))
    && (it.ticket == null || typeof it.ticket === 'boolean')
    && (it.lantern == null || typeof it.lantern === 'boolean')
    && (it.stakes == null || count(it.stakes, ITEM_LIMITS.stakes));
}

const isId = (v) => Number.isInteger(v) || typeof v === 'string';
const STAKE_STATES = Object.freeze(['lodged', 'body', 'standing']);

/** A stake in the world (stakes.js lodgeStake's shape), lying somewhere on the plan. */
function validStake(st) {
  return isObj(st) && Number.isInteger(st.id) && finite(st.x) && finite(st.y) && finite(st.z) && typeof st.worn === 'boolean'
    && STAKE_STATES.includes(st.state) && (st.enemy == null || isId(st.enemy)) && zoneAt(st.x, st.z) != null;
}

/** A body: the second suit where it fell (the only body the castle lays out). */
function validBody(b) {
  return isObj(b) && (b.id == null || isId(b.id)) && b.enemy === 'armour' && finite(b.x) && finite(b.z);
}

/** A stuck pin or any world point: finite place. */
const validPoint = (p) => isObj(p) && finite(p.x) && finite(p.z) && (p.y == null || finite(p.y));

/** A dropped weapon (the court's validDropped). */
const validDropped = (d) => isObj(d) && isId(d.id) && finite(d.x) && finite(d.z) && typeof d.taken === 'boolean';

/** A pickup on the floor: a tonic or salt, with an id and a place. */
const validPickup = (p) => isObj(p) && Number.isInteger(p.id) && (p.kind === 'health' || p.kind === 'ammo')
  && finite(p.x) && finite(p.z) && typeof p.source === 'string' && Number.isInteger(p.padIndex);

/**
 * The pickups as a whole (A2): a pad's pickup is that pad's, at its place and of its kind, each
 * pad once; a loose drop or the rescue crate lies on the plan, at most drops.maxLoose drops and
 * one crate. Anything else is forged.
 */
function validPickups(list, cfg) {
  if (!list.every(validPickup)) return false;
  const pads = new Set();
  let loose = 0;
  let crates = 0;
  for (const p of list) {
    if (p.source === 'pad') {
      const pad = cfg.pads[p.padIndex];
      if (!pad || pads.has(p.padIndex) || pad.kind !== p.kind || pad.x !== p.x || pad.z !== p.z) return false;
      pads.add(p.padIndex);
    } else if (p.source === 'drop' || p.source === 'rescue') {
      if (p.padIndex !== -1 || zoneAt(p.x, p.z) == null) return false;
      if (p.source === 'drop') loose += 1;
      else crates += 1;
    } else {
      return false;
    }
  }
  return loose <= cfg.drops.maxLoose && crates <= 1;
}

/** Ids of things in the world: whole numbers, none twice, all below the sim's next id (when known). */
function validIds(items, nextId) {
  const ids = items.map((x) => x.id);
  return ids.every(Number.isInteger) && new Set(ids).size === ids.length
    && (nextId == null || ids.every((id) => id >= 0 && id < nextId));
}

/**
 * The Count's room's curtains in a seat: three booleans, the middle one (count.js FINAL_CURTAIN)
 * shut. It opens only last, and opening it is the burning (#7), so no seat may hold it open.
 */
const validCurtains = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === 'boolean') && !c[FINAL_CURTAIN];

const validLog = (log) => Array.isArray(log) && log.every((k) => typeof k === 'string' && own(ENTRIES, k));

/**
 * What the forest left the warden (main.js calls it on the finished court sim before the reset
 * into the castle): health, every carried weapon in Q order from the one in hand, the garlic,
 * the cup's state and spare stakes, and the log. A copy: nothing of the court sim is shared.
 */
export function arrivalFrom(courtSim) {
  const w = courtSim && courtSim.waves;
  if (!w || !courtSim.player) return null;
  return {
    health: courtSim.player.health,
    weapons: clone(carried(courtSim)),
    items: { garlic: w.items ? w.items.garlic : 0, cup: w.items ? w.items.cup : 'none', stakes: w.items ? w.items.stakes : 0 },
    log: clone(w.log || []),
  };
}

/** A carry arrive() will seat (A2): anything else seats the title kit. */
export function validCarry(c, cfg) {
  return isObj(c) && finite(c.health) && c.health > 0
    && validWeapons(c.weapons, cfg) && validItems(c.items) && validLog(c.log);
}

/**
 * The drawbridge arrival (R1, G1): seats exactly what the forest left, with no top-up, and
 * writes the stage-0 checkpoint (index 0, the approach, the carried health, weapons, items and
 * log) before the first frame, so the bridge, the pit and the armour fight restore the carried
 * kit (A2). A carry that fails validCarry seats the title kit and emits nothing. Returns the
 * events to show (none).
 */
export function arrive(sim, carry) {
  if (!sim || !sim.cfg || sim.cfg.encounter !== 'keep') return [];
  const { cfg, waves: w } = sim;
  if (!validCarry(carry, cfg)) {
    seatTitle(sim);
    w.checkpoint = snapshot(sim, 0);
    return [];
  }
  const list = carry.weapons.map((x) => clampWeapon(x, cfg));
  seatWeapons(sim, list);
  sim.player.health = clamp(carry.health, 1, cfg.player.health);
  const hasCup = list.some((x) => x.name === 'cup');
  const cup = hasCup ? (carry.items.cup === 'full' ? 'full' : 'empty') : 'none';
  w.items = { ...freshItems(), garlic: Math.floor(carry.items.garlic), cup, stakes: Math.floor(carry.items.stakes || 0) };
  w.log = carry.log.filter((k, i) => carry.log.indexOf(k) === i);
  if (!w.log.includes('toCastle')) w.log.push('toCastle');
  syncGarlic(sim);
  syncLantern(sim); // a carry never brings one: the lantern is the castle's own
  sim.boxes = keepBoxes(cfg, w);
  w.checkpoint = snapshot(sim, 0);
  return [];
}

/**
 * Issue #29: a journey from the wood arrives on the walk to the road (main.js calls it after
 * arrive(), which has already seated the carry and written the stage-0 checkpoint at the approach,
 * A2): a fresh road (the sun still up, both scares to come) and the warden just through the
 * Caterpillar's gate at the walk's start (logic/tunnelwalk.js tunnelSeat), as far past it and to the
 * side as they were when the wood's level ended (pose.z, pose.offset, clamped) and facing as they
 * were (pose.yaw, pose.pitch). pose.start: the title's Tunnel start (on the walk's centreline);
 * pose.out: the title's Road start (on the road, road.js outSeat). Nothing of the kit or the
 * checkpoint changes. Returns the seat.
 */
export function enterRoad(sim, pose = {}) {
  if (!sim || !sim.cfg || sim.cfg.encounter !== 'keep') return null;
  const w = sim.waves;
  const at = pose && pose.out ? outSeat() : pose && pose.start ? startSeat() : tunnelSeat(pose || {});
  w.road = createRoad(false);
  const pl = sim.player;
  pl.x = at.x;
  pl.z = at.z;
  pl.y = at.y;
  pl.vy = 0;
  pl.grounded = true;
  pl.airPeak = at.y;
  pl.yaw = at.yaw;
  pl.pitch = at.pitch;
  w.under = null;
  w.walk = walkBandOf(pl.x);
  sim.boxes = keepBoxes(sim.cfg, w);
  return at;
}

/** The encounter's start, after resetSim built the state: the title kit, the sentries, the stage-0 checkpoint. */
export function startKeep(sim) {
  const w = sim.waves;
  w.game.reflection = reflectionLook(sim.seed); // issue 25: this game's look in the glass, kept by every restore
  seatTitle(sim);
  seatSentries(sim, sim.pending, SENTRIES);
  sim.boxes = keepBoxes(sim.cfg, w);
  if (sim.pending[0] && sim.pending[0].type === 'waveStart') sim.pending[0].of = STAGES;
  w.checkpoint = snapshot(sim, 0);
}

/**
 * The snapshot that seats stage `index` (0 to 6) with the title kit and every earlier room done
 * (the smoke harness's seats). opts.curtains ([3] booleans) may open curtains in the Count's
 * room and is accepted for index 6 only; it is ignored otherwise. Null for anything but a whole
 * number 0 to 6, or outside the castle.
 */
export function checkpointAt(cfg, index, opts = {}) {
  if (!cfg || cfg.encounter !== 'keep' || !Number.isInteger(index) || index < 0 || index >= STAGES) return null;
  const at = SPAWNS[index];
  const list = kitWeapons(cfg);
  const done = {
    armour: index >= 1, wife: index >= 2, clocks: index >= 3, strikeSeen: index >= 3, gallery: index >= 4,
    fell: false, knight: index >= 5, dawn: false,
  };
  const s = {
    index,
    spawn: { x: at.x, z: at.z, y: at.y },
    facing: at.yaw,
    health: cfg.player.health,
    weapon: list[0],
    holster: list[1],
    rack: list.slice(2),
    items: { ...freshItems(), garlic: index >= 2 ? cfg.titleKit.garlic + 1 : cfg.titleKit.garlic, cup: cfg.titleKit.cup },
    loot: cfg.loot.map((l) => ({ key: l.key, taken: l.key === 'braid' && index >= 2 })),
    stakes: [],
    bodies: [],
    pins: [],
    dropped: [],
    pickups: null, // every pad stocked
    done,
    log: ['toCastle', 'hour'],
  };
  const c = opts && opts.curtains;
  if (index === 6 && validCurtains(c)) {
    s.curtains = c.slice();
  }
  return s;
}

const PIECE_IDS = Object.freeze(OPENING.map((p) => p.square));

function validGame(g) {
  if (g == null) return true;
  if (!isObj(g)) return false;
  for (const k of ['chessDeaths', 'countDeaths']) if (g[k] != null && !(finite(g[k]) && g[k] >= 0)) return false;
  const r = g.removed;
  return r == null || (Array.isArray(r) && r.length <= OPENING.length - 1 && r.every((s) => PIECE_IDS.includes(s))
    && new Set(r).size === r.length);
}

/**
 * The castle's own validator (security A2): an index 0 to 6 (the spawn and facing are never read
 * from a snapshot: restore takes them from SPAWNS[index]); a finite health; weapons by name
 * against cfg.weapons with no name twice (in hand, holster, rack); items with only the castle's
 * keys and whole counts within limits; the loot list entry for entry the room's, each taken or
 * not; every stake, body, pin, dropped weapon and pickup well formed; done with the castle's
 * eight keys, each true or false; log keys in ENTRIES; game (if any) with known pieces removed,
 * none twice, at most seven; curtains, at index 6 only, absent or three booleans with the middle shut
 * (ignored at any other index). Pickups are the pads' own, at their places, or loose drops on the
 * plan; stake and pickup ids are unique and, given the sim's nextId, below it.
 */
export function validKeepSnapshot(s, cfg, nextId = null) {
  if (!isObj(s) || !cfg || !cfg.weapons) return false;
  if (!Number.isInteger(s.index) || s.index < 0 || s.index >= STAGES) return false;
  if (!finite(s.health) || s.health <= 0) return false;
  const list = [s.weapon, s.holster, ...(Array.isArray(s.rack) ? s.rack : [null])].filter((x) => x != null);
  if (!Array.isArray(s.rack) || (s.rack.length && s.holster == null) || !validWeapons(list, cfg)) return false;
  if (!validItems(s.items)) return false;
  if (!Array.isArray(s.loot) || s.loot.length !== cfg.loot.length) return false;
  if (!s.loot.every((l, i) => isObj(l) && l.key === cfg.loot[i].key && typeof l.taken === 'boolean' && Object.keys(l).length === 2)) return false;
  // the lantern is carried exactly when it has been taken from its nail
  const li = cfg.loot.findIndex((l) => l.key === LANTERN.name);
  if (li >= 0 && (s.items.lantern === true) !== s.loot[li].taken) return false;
  if (!Array.isArray(s.stakes) || s.stakes.length > cfg.weapons.crossbow.maxReserve + 1 || !s.stakes.every(validStake)) return false;
  if (!Array.isArray(s.bodies) || s.bodies.length > 4 || !s.bodies.every(validBody)) return false;
  if (!Array.isArray(s.pins) || s.pins.length > (cfg.maxPins || 0) || !s.pins.every(validPoint)) return false;
  if (!Array.isArray(s.dropped) || s.dropped.length > 4 || !s.dropped.every(validDropped)) return false;
  if (s.pickups != null && (!Array.isArray(s.pickups) || s.pickups.length > cfg.pads.length + cfg.drops.maxLoose + 1
    || !validPickups(s.pickups, cfg))) return false;
  if (!validIds([...s.stakes, ...(s.pickups || [])], nextId)) return false;
  if (s.index === 6 && s.curtains != null && !validCurtains(s.curtains)) return false;
  if (!isObj(s.done) || Object.keys(s.done).length !== DONE_KEYS.length) return false;
  if (!DONE_KEYS.every((k) => typeof s.done[k] === 'boolean')) return false;
  if (s.log != null && !validLog(s.log)) return false;
  if (!validGame(s.game)) return false;
  return true;
}

/** The second suit's body, laid out again once beaten (R18): where it fell, else by the door. */
function withBodies(done, bodies, fallen = []) {
  const out = bodies.slice();
  if (done.armour && !out.some((b) => b.enemy === 'armour')) {
    const was = fallen.find((b) => b && b.enemy === 'armour');
    const home = SENTRIES.suits[1];
    out.push(was ? { ...was } : { id: null, enemy: 'armour', x: home.x, z: home.z });
  }
  return out;
}

function phaseFor(w, k) {
  const key = { 0: 'armour', 2: 'clocks', 3: 'gallery', 4: 'knight', 6: 'dawn' }[k];
  return key && !w.done[key] ? 'still' : 'open';
}

/** Where the warden is now: { zone, under, stage }. */
function whereOf(sim) {
  const pl = sim.player;
  const z = floorZoneAt(pl.x, pl.z, pl.y, sim.waves);
  return { zone: z.zone, under: z.under, stage: stageOf(z.zone) };
}

/**
 * Try again (or a start seat passed as snap): writes and keeps exactly what KEEP_RESTORE_FIELDS
 * lists. A death first counts where it happened (A8): on the Knight's Walk with the board
 * unsolved (the board set again less one piece, recorded in game.removed), in the Count's room
 * (his rise grows). Then: the warden at the checkpoint with what was carried there; the
 * clocks as done says; every tile whole (G6); the board as won, or the opening less
 * game.removed; the Count's room shut with him in his box (R18); the stocks full; the sentries
 * seated (the suits' heap and body and the wife's absence as done says). Returns false and
 * changes nothing for a snapshot validKeepSnapshot refuses.
 */
export function restoreCheckpoint(sim, ...given) {
  const snap = given.length ? given[0] : sim && sim.waves && sim.waves.checkpoint;
  const cfg = sim && sim.cfg;
  if (!cfg || cfg.encounter !== 'keep' || !validKeepSnapshot(snap, cfg, sim.nextId)) return false;
  const w = sim.waves;
  const s = clone(snap);

  // The death this restore follows, counted where it happened (A8). A death in the Count's room
  // also picks the plain line for the next curtain still shut at the bite (#8), written below.
  let countLine = null;
  if (sim.player && sim.player.dead) {
    const at = whereOf(sim);
    if (countDeath(sim)) countLine = countHint(sim);
    if (!Array.isArray(w.game.removed)) w.game.removed = [];
    const r = boardAfterDeath(w.board, w.game, { onWalk: at.zone === 'walk', done: w.done, killer: w.struck });
    if (r.removed && !w.game.removed.includes(r.removed.square)) w.game.removed.push(r.removed.square);
  }

  for (const k of DONE_KEYS) w.done[k] = !!(w.done[k] || s.done[k]);
  const fallen = (w.bodies || []).slice();

  w.index = s.index;
  w.queue = [];
  w.phase = phaseFor(w, s.index);
  w.under = null;
  w.walk = walkBandOf(s.spawn ? s.spawn.x : NaN); // (every checkpoint is in the castle: none)
  w.clocks = clocksFor(w.done, clockRules(cfg));
  w.tiles = wholeTiles(w.tiles || createTiles());
  if (w.done.knight) w.board = w.board || createBoard(OPENING);
  else w.board = createBoard(OPENING.filter((p) => !w.game.removed.includes(p.square)));
  w.count = createCount(w.done);
  if (s.index === 6 && Array.isArray(s.curtains)) w.count.open = s.curtains.map(Boolean);
  w.haunts = createHaunts(cfg, sim.rng, w.haunts ? w.haunts.foe : null);
  w.raised = 0;
  const list = [s.weapon, s.holster, ...s.rack].filter(Boolean).map((x) => clampWeapon(x, cfg));
  const it = { ...freshItems(), ...s.items };
  // No cup carried, no cup state (A2).
  if (!list.some((x) => x.name === 'cup')) it.cup = 'none';
  else if (it.cup === 'none') it.cup = 'empty';
  w.items = it;
  w.loot = s.loot;
  w.stakes = s.stakes;
  w.bodies = withBodies(w.done, s.bodies, fallen);
  w.pins = s.pins;
  w.dropped = s.dropped;
  w.stock = freshStock();
  w.hints = freshHints();
  w.focus = null;
  w.line = null;
  w.notice = null;
  w.scene = null;
  w.checkpoint = snap;
  w.pressed = false;
  w.leap = null;
  w.struck = null;
  w.falling = null;
  w.snake = 0;
  w.claw = { tell: 0, cool: 0 };
  w.lanternPrev = null; // never in a snapshot: a restore puts away with the next on Q until it is drawn again
  w.road = settledRoad(w.road); // kept (#29): the dark and the latches as they were; a scare in the air is over
  hush(sim);

  const pl = createPlayer(cfg);
  const at = SPAWNS[s.index]; // never the snapshot's own spawn (A2)
  pl.x = at.x;
  pl.z = at.z;
  pl.y = at.y;
  pl.yaw = at.yaw;
  pl.health = clamp(s.health, 1, cfg.player.health);
  sim.player = pl;
  seatWeapons(sim, list);
  syncGarlic(sim);
  syncLantern(sim); // the lantern stays carried after a death once it was taken (the checkpoint's items)
  lowerGarlic(sim); // a button held through the lost card counts for nothing (A6)
  sim.enemies = [];
  sim.bolts = [];
  sim.globs = [];
  sim.pools = [];
  sim.pickups = [];
  if (s.pickups) sim.pickups = s.pickups;
  else restockPads(sim);
  sim.status = 'playing';
  sim.statusTimer = 0;
  sim.softlockFor = 0;
  sim.pending = [
    { type: 'restored', index: w.index },
    { type: 'waveStart', wave: w.index + 1, of: STAGES, stage: w.index },
  ];
  seatSentries(sim, sim.pending, SENTRIES);
  if (countLine) addEntry(sim, countLine, sim.pending); // the Count's room's hint (#8), shown as play resumes
  sim.boxes = keepBoxes(cfg, w);
  return true;
}

// ---- what E is looking at ------------------------------------------------------------------

const carries = (sim, name) => carried(sim).some((x) => x && x.name === name);

/**
 * The board square the reticle points at (#15), or null: the look ray from the eye is run down to
 * the floor, and the square it lands on counts only if it is one of the warden's legal knight leaps
 * (knight.js reachable: b1 and g1 from the margin, else the eight leaps). Nothing on a solved
 * board, off the board, past the leap's reach (5.2 m, as focusOf), or when the look is level or up.
 */
export function aimedSquare(sim) {
  const { cfg, player: pl, waves: w } = sim;
  if (!w || !w.board || pl.dead || w.leap || w.scene || w.done.knight) return null;
  const dy = Math.sin(pl.pitch || 0);
  if (dy > -1e-3) return null;
  const z = floorZoneAt(pl.x, pl.z, pl.y, w);
  if (z.zone !== 'walk') return null;
  const t = (pl.y + cfg.player.eyeHeight - z.floor) / -dy; // distance along the look to the floor
  const cp = Math.cos(pl.pitch || 0);
  const x = pl.x - Math.sin(pl.yaw) * cp * t;
  const zz = pl.z - Math.cos(pl.yaw) * cp * t;
  const sq = squareAt(x, zz);
  if (!sq || !reachable(w.board).includes(sq)) return null;
  const c = squareRect(sq); // the reach is measured to the square's middle, as focusOf does
  return Math.hypot(c.x - pl.x, c.z - pl.z) > LEAP_REACH ? null : sq;
}

/** How far a leap reaches from the warden to the square's middle (focusOf and the lit square agree). */
const LEAP_REACH = 5.2;

/**
 * The nearest thing within reach and in view that E would act on, or null: { kind, verb, x, z,
 * index?, key?, id?, square?, who?, tag? }. kind: loot | read | tag | clock | hare | square
 * | cord | stock | stake. A tag's E does nothing: the prompt line reads it (script.js TAGS). verb is a PROMPTS key (Leap is the castle's).
 * The garlic is not on E: it is wielded on Q and raised with the fire button (#9, sentries.js).
 */
export function focusOf(sim) {
  const { cfg, player: pl, waves: w } = sim;
  if (!w || pl.dead || w.leap || w.scene || w.phase === 'done') return null;
  const fx = -Math.sin(pl.yaw);
  const fz = -Math.cos(pl.yaw);
  const ic = cfg.interact;
  const where = whereOf(sim);
  let best = null;
  let bestScore = Infinity;
  const consider = (cand, x, z, reach = ic.reach, prio = 0) => {
    const dx = x - pl.x;
    const dz = z - pl.z;
    const d = Math.hypot(dx, dz);
    if (d > reach) return;
    const cos = d < 0.25 ? 1 : (dx * fx + dz * fz) / d;
    if (cos < ic.cone) return;
    const score = d * (2 - cos) - prio;
    if (score < bestScore) {
      bestScore = score;
      best = { ...cand, x, z };
    }
  };

  cfg.loot.forEach((l, i) => {
    if (w.loot[i].taken) return;
    // A thing on one of two shared floors is taken only standing on that floor (A3): the crypt's
    // within a metre of its floor (not from the stair above it), the gallery's from its floor.
    if (l.level === 'crypt' && (where.under !== 'crypt' || pl.y > CRYPT.floor + 1)) return;
    if (l.level === 'upper' && (where.under || pl.y < CRYPT.top - 0.5)) return;
    if (l.missing && carries(sim, l.kind)) return;
    consider({ kind: 'loot', verb: l.kind === 'lantern' ? 'takeLantern' : 'take', index: i, key: l.key, item: l.kind }, l.x, l.z, ic.reach, 0.5);
  });
  for (const s of w.stakes) if (pullable(s)) consider({ kind: 'stake', verb: 'pull', id: s.id }, s.x, s.z, ic.reach, 0.4);

  // The pikes' price tags: the prompt reads the tag after the verb, as the hats' do.
  if (where.zone === 'forecourt' && !where.under) for (const p of PIKES) consider({ kind: 'tag', verb: 'read', tag: p.tag }, p.x, p.z);
  if (where.zone === 'hall' && !w.log.includes('garlicScratch')) {
    consider({ kind: 'read', verb: 'read', key: 'garlicScratch' }, HALL.scratch.x, HALL.scratch.z);
  }
  if (where.zone === 'tea' && !w.done.clocks) {
    CLOCKS.forEach((c, i) => consider({ kind: 'clock', verb: 'set', index: i }, c.x, c.z));
  }
  if (where.under === 'crypt') consider({ kind: 'hare', verb: 'speak', who: 'hare' }, CRYPT_PROPS.hare.x, CRYPT_PROPS.hare.z, ic.speakReach);
  if (where.zone === 'walk') {
    if (!w.log.includes('boardPlate')) consider({ kind: 'read', verb: 'read', key: 'boardPlate' }, BOARD.plate.x, BOARD.plate.z);
    if (!w.done.knight) {
      const aimed = aimedSquare(sim); // the reticle's own square lights and wins (#15)
      for (const sq of reachable(w.board)) {
        const r = squareRect(sq);
        consider({ kind: 'square', verb: 'leap', square: sq, ...(sq === aimed ? { aimed: true } : {}) }, r.x, r.z, LEAP_REACH, sq === aimed ? 100 : 0.6);
      }
    }
  }
  if (where.zone === 'count') {
    const c = w.count;
    const cord = COUNT_ROOM.curtains[FINAL_CURTAIN].cord;
    // The middle cord is offered only once both side curtains are open (#7).
    if (c && curtainReady(c, FINAL_CURTAIN) && (c.phase === 'rising' || c.phase === 'lurch') && !c.bitten) {
      consider({ kind: 'cord', verb: 'pull' }, cord.x, cord.z, ic.reach, 0.5);
    }
  }
  // The card by the Count's door (#8): each curtain's way, and the middle one last.
  if (where.zone === 'countway' && !w.log.includes('curtainNote')) {
    consider({ kind: 'read', verb: 'read', key: 'curtainNote' }, COUNTWAY.note.x, COUNTWAY.note.z);
  }
  if (where.zone === 'mirror' && w.stock.salt) consider({ kind: 'stock', verb: 'take', key: 'salt' }, STOCK.salt.x, STOCK.salt.z, ic.reach, 0.5);
  if (where.zone === 'nursery' && w.stock.stakes) consider({ kind: 'stock', verb: 'take', key: 'stakes' }, STOCK.stakes.x, STOCK.stakes.z, ic.reach, 0.4);
  return best;
}

/** Shows the notice line for key (the newest wins) and emits notice { key }. */
function notice(sim, key, events) {
  if (!key) return;
  sim.waves.notice = { key, left: sim.cfg.noticeTime };
  events.push({ type: 'notice', key });
}

function takeLoot(sim, i, events) {
  const { cfg, waves: w, player: pl } = sim;
  const l = cfg.loot[i];
  if (w.loot[i].taken) return;
  const at = { item: l.kind, at: l.key, x: l.x, z: l.z };
  if (l.kind === 'health') {
    if (healPlayer(pl, cfg.drops.health * (l.share ?? 1), cfg) <= 0) return; // full: it stays where it is
  } else if (l.kind === 'garlic') {
    w.items.garlic += l.gives || 1;
    syncGarlic(sim); // the braid joins the Q cycle (#9)
  } else if (l.kind === 'lantern') {
    if (!lanternRoom(cfg)) return;
    w.items.lantern = true;
    syncLantern(sim); // it joins the cycle, last (Q, key 6); the weapon in hand stays in hand
    // Once found it is the warden's for the game: the checkpoint already written keeps it too, so a
    // death before the next one does not hang it back on its nail (unlike the braid, A7's key).
    const cp = w.checkpoint;
    if (cp && cp.items && Array.isArray(cp.loot)) {
      w.checkpoint = { ...cp, items: { ...cp.items, lantern: true }, loot: cp.loot.map((x) => (x.key === l.key ? { key: x.key, taken: true } : x)) };
    }
  } else if (l.kind === 'crossbow') {
    if (carries(sim, 'crossbow')) return;
    const cb = createWeapon(cfg, cfg.weapons.crossbow);
    cb.mag = 1;
    cb.reserve = Math.min(cfg.weapons.crossbow.maxReserve, w.items.stakes);
    w.items.stakes = 0;
    if (!carryWeapon(sim, cb) || !swapWeapon(sim, 'crossbow')) return;
    cb.cooldown = 0;
    w.loot[i].taken = true;
    events.push({ type: 'itemTake', ...at });
    events.push({ type: 'swap', weapon: cb.name });
    return;
  }
  w.loot[i].taken = true;
  events.push({ type: 'itemTake', ...at });
  notice(sim, KEEP_NOTICES[l.kind], events);
}

/** The salt box (a full magazine and 12 in reserve) or the stake bundle (6 stakes carried): once a life, only up to its amount. */
function takeStock(sim, key, events) {
  const { cfg, waves: w } = sim;
  if (!w.stock[key]) return;
  const at = STOCK[key];
  let added = 0;
  if (key === 'salt') {
    const gun = gunOf(sim);
    if (!gun) return;
    const mag = Math.max(gun.mag, cfg.stock.saltMag);
    const reserve = Math.max(gun.reserve, cfg.stock.saltReserve);
    added = (mag - gun.mag) + (reserve - gun.reserve);
    if (added <= 0) return;
    gun.mag = mag;
    gun.reserve = reserve;
  } else {
    const cb = crossbowOf(sim);
    const has = cb ? cb.mag + cb.reserve : w.items.stakes;
    added = Math.max(0, cfg.stock.stakes - has);
    if (added <= 0) return;
    if (cb) {
      cb.reserve += added;
      if (cb.mag <= 0 && !cb.reloading && cb.autoReloadIn < 0) cb.autoReloadIn = 0;
    } else {
      w.items.stakes += added;
    }
  }
  w.stock[key] = false;
  events.push({ type: 'stockTake', kind: key, added, x: at.x, z: at.z });
  notice(sim, KEEP_NOTICES[key], events);
}

function read(sim, key, events) {
  sim.waves.pressed = false; // a card opens: a key held across it counts for nothing (A6)
  events.push({ type: 'read', key });
  addEntry(sim, key, events);
}

/** The knight leaps (R9): half a second in the air; the strike, if any, lands with the warden. */
function leapTo(sim, sq, events) {
  const { cfg, player: pl, waves: w } = sim;
  const res = leap(w.board, sq, events, { health: pl.health, maxHealth: cfg.player.health });
  if (!res) return;
  const to = squareRect(sq);
  w.leap = { from: { x: pl.x, z: pl.z }, to: { x: to.x, z: to.z }, left: cfg.board.leap, total: cfg.board.leap,
    damage: res.damage, striker: res.striker ? res.striker.square : null, won: res.won };
  w.hints.board.moves += 1;
  sim.boxes = keepBoxes(cfg, w);
}

function stepLeap(sim, dt) {
  const { cfg, player: pl, waves: w } = sim;
  const L = w.leap;
  L.left = Math.max(0, L.left - dt);
  const k = L.total > 0 ? 1 - L.left / L.total : 1;
  pl.x = L.from.x + (L.to.x - L.from.x) * k;
  pl.z = L.from.z + (L.to.z - L.from.z) * k;
  sim.weapon.cooldown = Math.max(sim.weapon.cooldown, L.left); // no act while in the air
  if (L.left > 0) return [];
  const events = [];
  w.leap = null;
  w.struck = L.striker;
  if (L.damage > 0) {
    const r = squareRect(L.striker);
    pl.grace = 0;
    hurtPlayer(sim, L.damage, r ? r.x : pl.x, r ? r.z : pl.z, events);
  }
  if (L.won && !pl.dead) w.done.knight = true;
  sim.boxes = keepBoxes(cfg, w);
  return events;
}

function interact(sim, f, events, input) {
  const w = sim.waves;
  switch (f.kind) {
    case 'loot': takeLoot(sim, f.index, events); return;
    case 'stake': pullStake(sim, f.id, events); return;
    case 'read': read(sim, f.key, events); return;
    case 'stock': takeStock(sim, f.key, events); return;
    case 'clock': {
      const r = setClock(w.clocks, f.index, events, w.done, clockRules(sim.cfg));
      if (CLOCKS[f.index].id === 'carriage') ghostScream(sim, events); // E on the clock in front of her
      if (r && r.struck) {
        w.done.clocks = true;
        if (w.index === 2) w.phase = 'open';
        if (!w.done.strikeSeen) {
          w.done.strikeSeen = true;
          w.pressed = false;
          startScene(sim, 'strike', input, events);
        }
      }
      return;
    }
    case 'hare': {
      const riddle = w.done.fell && !(w.talk.hareRiddle && w.talk.hareRiddle.at > 0);
      if (riddle) talkState(sim, 'hareRiddle');
      talkTo(sim, riddle ? 'hareRiddle' : 'hare', events);
      return;
    }
    case 'square': leapTo(sim, f.square, events); return;
    default: return; // the cord acts on the hold
  }
}

// ---- hazards -------------------------------------------------------------------------------

/** The pit (R3, G2): a fall in costs 20 once; on its floor the snakes bite every 1.5 s. Not a reset. */
function stepPit(sim, dt, events) {
  const { cfg, player: pl, waves: w } = sim;
  const c = cfg.pit;
  // A fall in is one that began at the deck's level: a jump on the pit floor or a low tread is not (G2).
  if (!pl.grounded && w.under === 'pit' && !w.falling && pl.y < PIT.top - c.drop && pl.airPeak > PIT.top - c.drop) w.falling = 'pit';
  if (pl.grounded && w.falling) {
    if (w.falling === 'pit') {
      events.push({ type: 'pitFall', x: pl.x, z: pl.z, damage: c.damage });
      pl.grace = 0;
      hurtPlayer(sim, c.damage, pl.x, pl.z, events);
      w.snake = c.snakeEvery;
    }
    w.falling = null;
  }
  const onFloor = pl.grounded && w.under === 'pit' && pl.y <= PIT.floor + 0.01 && !inRect(PIT.stair.rect, pl.x, pl.z);
  if (!onFloor || pl.dead) {
    w.snake = c.snakeEvery;
    return;
  }
  w.snake -= dt;
  if (w.snake > 0) return;
  w.snake += c.snakeEvery;
  pl.grace = 0;
  const taken = hurtPlayer(sim, c.snakeBite, pl.x, pl.z, events);
  events.push({ type: 'snakeBite', x: pl.x, z: pl.z, damage: taken });
}

/** The werewolf's arm (R7): inside the gouges, a 0.4 s tell, then the claw, again every 1.5 s while inside. */
function stepClaw(sim, dt, events, zone) {
  const { cfg, player: pl, waves: w } = sim;
  const c = cfg.werewolf;
  const cl = w.claw;
  const g = TEA.werewolf.gouge;
  cl.cool = Math.max(0, cl.cool - dt);
  const inside = zone === 'tea' && !pl.dead && Math.hypot(pl.x - g.x, pl.z - g.z) <= c.reach;
  if (cl.tell > 0) {
    cl.tell -= dt;
    if (cl.tell > 0) return;
    cl.tell = 0;
    cl.cool = c.every;
    let taken = 0;
    if (inside) {
      pl.grace = 0;
      taken = hurtPlayer(sim, c.damage, g.x, g.z, events);
    }
    events.push({ type: 'claw', x: g.x, z: g.z, damage: taken });
    return;
  }
  if (inside && cl.cool <= 0) {
    cl.tell = c.tell;
    events.push({ type: 'clawTell', x: g.x, z: g.z, damage: c.damage });
  }
}

/** The gallery's floor (R8): a false tile stepped on past its footing gives way (a quarter of full health); shots test whole tiles. */
function stepGallery(sim, events, where) {
  const { cfg, player: pl, waves: w } = sim;
  if (where.zone !== 'gallery' || where.under) return;
  // Shots that met the floor test the tile they met (the round was spent by the shipped fire path).
  const hit = new Set();
  for (const ev of events) {
    if (ev.type !== 'shot') continue;
    const ends = Array.isArray(ev.pellets) && ev.pellets.length ? ev.pellets : [{ to: ev.to, kind: ev.kind }];
    for (const p of ends) if (p.kind === 'ground' && p.to) { const t = tileAt(p.to.x, p.to.z); if (t >= 0) hit.add(t); }
  }
  for (const t of hit) shootTile(w.tiles, t, events);
  if (!pl.grounded || pl.y < -0.01) return;
  if (inRect(GALLERY.farApron, pl.x, pl.z) && !w.done.gallery) {
    w.done.gallery = true; // the far door opens for good
    if (w.index === 3) w.phase = 'open';
  }
  const t = tileAt(pl.x, pl.z);
  if (t < 0 || w.tiles.gone[t]) return;
  w.hints.gallery.row = Math.max(w.hints.gallery.row, tileRect(t).row);
  const r = stepAt(w.tiles, pl.x, pl.z, events, { fell: w.done.fell, maxHealth: cfg.player.health }); // the footing holds
  if (!r || !r.fell) return;
  w.done.fell = true;
  w.falling = 'crypt'; // under follows position on the next move (A3: keepGround is the one authority)
  pl.grounded = false;
  pl.vy = 0;
  pl.airPeak = pl.y;
  pl.grace = 0;
  hurtPlayer(sim, r.damage, pl.x, pl.z, events);
}

// ---- the hint ladder (R19) -------------------------------------------------------------------

function progressOf(sim, puzzle) {
  const w = sim.waves;
  if (puzzle === 'clocks') return w.done.clocks ? Infinity : w.clocks.hours.filter((h) => h === sim.cfg.clocks.right).length;
  if (puzzle === 'gallery') return w.done.gallery ? Infinity : w.hints.gallery.row;
  if (puzzle === 'board') return w.done.knight ? Infinity : w.hints.board.moves;
  return Infinity;
}

function nudge(sim, puzzle, events) {
  const w = sim.waves;
  if (puzzle === 'clocks') {
    const i = w.clocks.hours.findIndex((h) => h !== sim.cfg.clocks.right);
    if (i < 0) return;
    const c = CLOCKS[i];
    landRaven(sim, { id: c.id, x: c.x, y: 1.8, z: c.z }, events);
    events.push({ type: 'nudge', puzzle, x: c.x, z: c.z, clock: i });
  } else if (puzzle === 'gallery') {
    const pl = sim.player;
    const here = tileAt(pl.x, pl.z);
    const t = nextTrue(here >= 0 ? here : null, w.hints.gallery.row);
    if (t == null) return;
    w.hints.gallery.grin = t;
    const r = tileRect(t);
    events.push({ type: 'nudge', puzzle, x: r.x, z: r.z, tile: t });
  } else if (puzzle === 'board') {
    const route = bestRoute(w.board, { maxHealth: sim.cfg.player.health });
    const sq = route && route.path[0];
    if (!sq) return;
    const r = squareRect(sq);
    landRaven(sim, { id: sq, x: r.x, y: 0.2, z: r.z }, events);
    events.push({ type: 'nudge', puzzle, x: r.x, z: r.z, square: sq });
  }
}

/** The castle's ladder, on the shipped timings: 90 s without progress, the room nudges; 210 s, the plainer line. */
function stepKeepHints(sim, dt, events, zone) {
  const w = sim.waves;
  const puzzle = PUZZLE_OF[zone];
  if (!puzzle) return;
  const p = progressOf(sim, puzzle);
  const h = w.hints[puzzle];
  if (p === Infinity) {
    if (h.grin != null) h.grin = null;
    return;
  }
  if (p > h.last) {
    h.last = p;
    h.idle = 0;
    h.rung = 0;
    if (h.grin != null) h.grin = null;
    return;
  }
  // The grin hangs over the next true tile from where the warden stands now: a step along the
  // row moves it on, so it is never over the tile underfoot.
  if (puzzle === 'gallery' && h.grin != null) {
    const pl = sim.player;
    const here = tileAt(pl.x, pl.z);
    const t = nextTrue(here >= 0 ? here : null, h.row);
    h.grin = t == null || t === here ? null : t;
  }
  h.idle += dt;
  const c = sim.cfg.hints;
  if (h.rung < 1 && h.idle >= c.nudge) {
    h.rung = 1;
    nudge(sim, puzzle, events);
  }
  if (h.rung < 2 && h.idle >= c.plain) {
    h.rung = 2;
    addEntry(sim, PLAIN[puzzle], events);
  }
}

// ---- stages, scenes and the end -----------------------------------------------------------

function enterStage(sim, k, events) {
  const w = sim.waves;
  w.index = k;
  w.phase = phaseFor(w, k);
  sim.stats.waveReached = Math.max(sim.stats.waveReached, k + 1);
  events.push({ type: 'checkpoint', index: k, name: CASTLE_PLACES[k] });
  events.push({ type: 'waveStart', wave: k + 1, of: STAGES, stage: k });
  w.checkpoint = snapshot(sim, k);
}

function finish(sim, events) {
  const w = sim.waves;
  w.phase = 'done';
  w.focus = null;
  addEntry(sim, 'dawn', events);
  events.push({ type: 'allClear' });
}

/**
 * The castle's scene frame (sim.js calls it first, the shipped freeze): count.js stepScene owns
 * the scenes (strike, pyre, triumph) and their no-skip rules (A4). Any key held through a scene counts for
 * nothing after it until pressed again (A6).
 */
export function stepKeepScene(sim, input, dt, events) {
  const w = sim.waves;
  const used = w && w.scene && w.scene.kind === 'cutaway' ? stepCutaway(sim, input, dt, events) : stepScene(sim, input, dt, events);
  if (used) {
    sim.waves.pressed = false;
    lowerGarlic(sim);
    stepLeaves(sim.waves, dt); // the leaves swing on under a scene, as they are seen to
    sim.boxes = keepBoxes(sim.cfg, sim.waves);
  }
  return used;
}

/** The pause card: a key held through it counts for nothing (A6). */
export function pauseKeep(sim) {
  if (sim.waves) sim.waves.pressed = false;
  lowerGarlic(sim);
}

/** Any card over the castle (the log on Tab, a story card): main.js calls it as one opens (A6). */
export function cardKeep(sim) {
  if (sim && sim.waves) sim.waves.pressed = false;
  if (sim && sim.waves) lowerGarlic(sim);
}

/** Events that put a card or a scene over the view: a key held across one counts for nothing after it (A6). */
const CARD_EVENTS = Object.freeze(['read', 'logEntry', 'sceneStart']);

/** Kills this frame: the second suit's body, its stakes, its last line and done.armour. */
function settleKills(sim, events) {
  const w = sim.waves;
  const seen = new Set();
  for (const ev of events) {
    if (ev.type !== 'kill' || seen.has(ev.id)) continue;
    seen.add(ev.id);
    w.bodies.push({ id: ev.id, enemy: ev.enemy, x: ev.x, z: ev.z });
    stakesToBody(sim, ev.id, ev.x, ev.z);
  }
  const before = w.done.armour;
  sentryKilled(sim, events);
  if (!before && w.done.armour && w.index === 0) w.phase = 'open';
}

/**
 * One frame of the castle, after the player, creatures, bolts and pickups have moved and death
 * has been checked. input.interact (a fresh press) acts on focusOf(sim); input.hold (E held)
 * pulls the cord, but only from a press the sim observed (A6).
 */
export function stepKeep(sim, dt, events, input = {}) {
  const { cfg, player: pl, waves: w } = sim;
  if (w.phase === 'done') return;
  if (w.line) {
    w.line.left -= dt;
    if (w.line.left <= 0) w.line = null;
  }
  if (w.notice) {
    w.notice.left -= dt;
    if (w.notice.left <= 0) w.notice = null;
  }
  settleKills(sim, events);
  for (const ev of events) if (ev.type === 'pickup' && KEEP_NOTICES[ev.kind]) notice(sim, KEEP_NOTICES[ev.kind], events);
  stepRoad(w.road, pl, dt, events, sim.rng); // issue #29: the dark's ratchet, the boulder and the bats
  if (cutawayDue(sim)) startCutaway(sim, events); // the boulder is gone: the werewolf cutaway, once (logic/cutaway.js)

  if (w.leap) events.push(...stepLeap(sim, dt));
  const where = whereOf(sim);

  // E: a fresh press acts on what is in view; a hold counts only from a press seen here (A6).
  const press = !!(input && input.interact);
  const held = !!(input && input.hold);
  const f = focusOf(sim);
  if (!held && !press) w.pressed = false;
  if (press && f && f.kind === 'cord') w.pressed = true;
  else if (press) w.pressed = false;
  const holding = w.pressed && (held || press);
  if (holding && f && f.kind === 'cord') pullCord(sim, dt, events, input);
  if (press && f) interact(sim, f, events, input);
  stowLantern(sim, events); // the lantern is an indoor thing: out of the front door it is put away

  stepPit(sim, dt, events);
  stepClaw(sim, dt, events, where.zone);
  stepGallery(sim, events, where);
  if (where.zone === 'count') shotsAtCurtains(sim, events, CURTAIN_TARGETS, input);
  stepCount(sim, dt, events);

  // The board: the warden steps back off the back rank to the margin.
  if (!w.done.knight && !w.leap && w.board.at && pl.z > BOARD.rect.maxZ) stepOff(w.board);
  if (w.done.knight && w.board.at && !isFarRank(w.board.at) && !squareRect(w.board.at)) w.board.at = null;

  stepHaunts(sim, dt, events, {
    zone: where.zone, windows: !!WINDOWS[where.zone], scene: !!w.scene, grin: w.hints.gallery.grin != null, places: HAUNT_PLACES,
  });

  while (w.index < where.stage && !pl.dead) enterStage(sim, w.index + 1, events);
  // After the dawn (#20): at the middle window the triumph plays (the light, then THE END); once
  // it has played, the level ends and the closing card (the dawn card) follows.
  if (w.done.dawn && !w.scene && w.count && w.count.cheered) {
    finish(sim, events);
    return;
  }
  if (w.done.dawn && !w.scene && where.zone === 'count' && Math.hypot(pl.x - END.x, pl.z - END.z) < cfg.end.r) {
    w.pressed = false;
    startScene(sim, 'triumph', input, events);
  }
  if (!w.scene) stepKeepHints(sim, dt, events, where.zone);
  if (events.some((e) => CARD_EVENTS.includes(e.type))) { w.pressed = false; lowerGarlic(sim); }
  stepLeaves(w, dt);
  sim.boxes = keepBoxes(cfg, w);
  w.focus = focusOf(sim);
}
