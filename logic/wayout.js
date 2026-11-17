// The ways out of the yard and the cave open in a short cut scene (issue #29, the owner, 23:0x and
// 23:3x PST). The yard: the last foe killed spins off through the air and slams into the concrete;
// its blast leaves the crater. The cave: the Cantor, dying, fires one last blast up at the vault;
// the vault cracks and falls in, and daylight pours down through the hole (the shaft).
//
// Where: anywhere in the room's open space (the yard's concrete, the Nave's floor under its vault)
// with room for the mouth and what falls round it, clear of crates, walls, rock, water, pads and
// pores, reachable on foot, and never within WAYOUT.min metres of the warden as it opens. Seeded
// and pure (no Math.random, no DOM). The site is kept in sim.waves.wayout, and journey.js reads it
// as the room's mouth.
//
// The scene (sim.waves.scene, kind 'crater' or 'vault'): sim.js steps it first and returns, so the
// warden is held and nothing else moves (the same freeze as the Rose Court's bloom scene, A4).
// E, Enter, Space or a fresh click skips it (as the bloom scene's). Whatever is held as it ends
// counts for nothing until it is let go (sim.waves.latch, security A6). Nothing here hurts anyone:
// this file imports no damage path and has no damage number (tests/wayout.test.js).

import { makeRng } from './rng.js';
import { caveField, spaceIndexAt, ceilingAt, isOpen, SPACE_DEFS, BOUNDS } from './cavemap.js';

const f = Object.freeze;
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));

export const WAYOUT = f({
  min: 6, // metres (across the ground) the site keeps from the warden as it opens
  cell: 0.5, // the site search's grid
  yard: f({
    r: 2.0, // the crater's mouth (journey.js MOUTHS.yard.r)
    clear: 1.9, // its torn rim and slabs (passages.js draws them out to about r + 1.8): this much more round the mouth, clear of everything
    beat: 0.6, // seconds from the kill to the foe leaving the ground: its lantern overloads, it shudders and lifts (CS-7: long enough to read)
    fly: 1.15, // seconds it spins through the air
    apex: 3.2, // metres it rises over the higher of its two ends, at the least
    sight: 7, // metres the scene's camera may rise over the warden's eye to see the site; a site it could not see is not chosen
    steep: 0.36, // and this much more for every metre it has to cross, so it always comes down steeply
    apexMax: 11, // never higher than this
    girth: 1.0, // metres either side of its path a crate counts as under it
    over: 1.6, // metres it clears a crate's top by (the winch's drum and the hull ribs stand over their boxes)
    lift: 0.5, // metres it lifts off the ground as its lantern overloads, before it is flung
    sink: 0.3, // metres into the concrete it ends
    spin: 11, // radians a second it tumbles
    home: 1.0, // seconds at the end over which the view comes home, to the warden's eye turned toward the way out (CS-1)
    length: 4.2, // the whole scene, seconds
  }),
  cave: f({
    r: 1.8, // the shaft's mouth (journey.js MOUTHS.cave.r)
    clear: 1.2, // the rubble round it: this much more, clear of the rock face (and its scree) and the stumps
    edge: 0.6, // to a pool: the rubble (passages.js rests it within about r + 0.85) may reach a bowl's outer, dry rim (its r), never the water
    pad: 0.9, // to a pad's pickup ring: the rubble never on it
    beat: 0.9, // seconds from the kill to the Cantor's last blast: it rears, its ribs part, its core gathers
    shot: 0.35, // seconds the blast takes to reach the vault
    trail: 0.16, // seconds the blast's tail runs behind its head
    crack: 0.5, // seconds the cracks take to run out across the vault from where it is struck
    drop: 0.3, // seconds after the strike the first piece of the vault lets go
    dropSpan: 0.4, // seconds over which the rest follow, from the middle outward
    gravity: 13, // metres a second squared the pieces fall at
    fall: 1.8, // seconds after the strike by which every piece is down
    light: 1.5, // seconds from the first daylight in the shaft to the shaft fully lit
    lightAt: 0.55, // seconds after the strike the first daylight comes down the shaft
    chest: 2.0, // metres above its feet the Cantor's blast leaves from
    home: 1.0, // seconds at the end over which the view comes home, to the warden's eye turned toward the way out (CS-1)
    length: 4.6,
  }),
});

const NAVE = SPACE_DEFS.findIndex((s) => s.name === 'nave');

/** Which way out a room has here, or null: the yard's crater, the cave's vault. */
export function wayoutKind(room) {
  return room === 'yard' ? 'crater' : room === 'cave' ? 'vault' : null;
}

/** Distance from (x, z) to an axis-aligned rect { minX, maxX, minZ, maxZ } (0 inside it). */
function toRect(x, z, b) {
  return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
}

/** The yard's open places for a mouth of radius r with `clear` round it (every one, in grid order). */
function yardOpen(cfg) {
  const Y = WAYOUT.yard;
  const room = Y.r + Y.clear;
  const half = cfg.arena.half;
  const blocks = [...cfg.boxes, ...(cfg.levels || []).map((L) => L.rect)];
  const zones = (cfg.surfaces && cfg.surfaces.zones) || [];
  const wet = zones.filter((z) => z.shape === 'ellipse');
  const out = [];
  for (let x = -half + room; x <= half - room + 1e-9; x += WAYOUT.cell) {
    for (let z = -half + room; z <= half - room + 1e-9; z += WAYOUT.cell) {
      if (blocks.some((b) => toRect(x, z, b) < room)) continue;
      if ((cfg.pads || []).some((p) => Math.hypot(p.x - x, p.z - z) < room + (cfg.pickupRadius || 1.1))) continue;
      if (wet.some((q) => Math.hypot(q.x - x, q.z - z) < room + Math.max(q.rx, q.rz))) continue;
      out.push({ x, z });
    }
  }
  return out;
}

/** The boxes that reach within `m` of a rect: the only ones a search inside it need ask. */
function within(boxes, a, m) {
  return boxes.filter((b) => b.maxX > a.minX - m && b.minX < a.maxX + m && b.maxZ > a.minZ - m && b.minZ < a.maxZ + m);
}

/** True when (x, z) is somewhere a warden stands: open rock floor, out of every box (radius rad). */
function walkable(boxes, x, z, rad) {
  return isOpen(x, z) && !boxes.some((b) => toRect(x, z, b) < rad);
}

/** The cells reachable on foot from (x, z) in the cave, on the site grid (a Set of "i,j" keys). */
function reachable(boxes, x0, z0, rad, area = BOUNDS) {
  const c = WAYOUT.cell;
  boxes = within(boxes, area, rad);
  const key = (i, j) => `${i},${j}`;
  const i0 = Math.round(x0 / c); const j0 = Math.round(z0 / c);
  const seen = new Set([key(i0, j0)]);
  const q = [[i0, j0]];
  const lo = { i: Math.ceil(area.minX / c), j: Math.ceil(area.minZ / c) };
  const hi = { i: Math.floor(area.maxX / c), j: Math.floor(area.maxZ / c) };
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di; const nj = j + dj;
      if (ni < lo.i || ni > hi.i || nj < lo.j || nj > hi.j) continue;
      const k = key(ni, nj);
      if (seen.has(k) || !walkable(boxes, ni * c, nj * c, rad)) continue;
      seen.add(k);
      q.push([ni, nj]);
    }
  }
  return seen;
}

/** The Nave's open places under its vault for the shaft and its rubble (every one, in grid order). */
function caveOpen(cfg, boxes) {
  const C = WAYOUT.cave;
  const room = C.r + C.clear;
  const s = cfg.spaces[NAVE];
  const zones = (cfg.surfaces && cfg.surfaces.zones) || [];
  const pools = zones.filter((z) => z.material === 'pool');
  boxes = within(boxes, s, room);
  const c = WAYOUT.cell;
  const out = [];
  for (let x = Math.ceil(s.minX / c) * c; x <= s.maxX; x += c) {
    for (let z = Math.ceil(s.minZ / c) * c; z <= s.maxZ; z += c) {
      if (spaceIndexAt(x, z) !== NAVE || caveField(x, z) < room) continue; // under the vault, rock and scree clear
      if (boxes.some((b) => toRect(x, z, b) < room)) continue;
      if (pools.some((q) => Math.hypot(q.x - x, q.z - z) < C.r + C.edge + q.r)) continue;
      if ((cfg.pads || []).some((p) => Math.hypot(p.x - x, p.z - z) < C.r + C.pad + (cfg.pickupRadius || 1.1))) continue;
      if ((cfg.pores || []).some((p) => Math.hypot(p.x - x, p.z - z) < room + 0.5)) continue;
      out.push({ x, z });
    }
  }
  return out;
}

/**
 * Where the way out opens: { x, z, r }. room 'yard' or 'cave'; seed: the run's; warden: { x, z }
 * where the warden stands as it opens; boxes: the live collision list (the cave's closed veils
 * keep what is behind them out of reach). Uniform over the open places at least WAYOUT.min from the
 * warden (and, in the cave, reachable from where they stand); with none, the farthest open place.
 * body: { x, z, r } of a foe that stays where it fell (the Cantor's folded body): the shaft and its
 * rubble keep off it (review 3); null for none (the yard's foe flies into the crater).
 */
export function siteFor(room, cfg, seed, warden, boxes = cfg.boxes, body = null) {
  const cave = room === 'cave';
  let open = cave ? caveOpen(cfg, boxes) : yardOpen(cfg);
  if (body && Number.isFinite(body.x)) {
    const P = cave ? WAYOUT.cave : WAYOUT.yard;
    const clearOf = open.filter((p) => Math.hypot(p.x - body.x, p.z - body.z) >= P.r + P.clear + (body.r || 0));
    if (clearOf.length) open = clearOf;
  }
  if (cave) {
    const rad = (cfg.player && cfg.player.radius) || 0.4;
    const s = cfg.spaces[NAVE]; // the Nave and a margin: its entry veil is sealed behind the warden
    const reach = reachable(boxes, warden.x, warden.z, rad, { minX: s.minX - 2, maxX: s.maxX + 2, minZ: s.minZ - 2, maxZ: s.maxZ + 2 });
    const c = WAYOUT.cell;
    const near = open.filter((p) => reach.has(`${Math.round(p.x / c)},${Math.round(p.z / c)}`));
    if (near.length) open = near;
  }
  let far = open.filter((p) => Math.hypot(p.x - warden.x, p.z - warden.z) >= WAYOUT.min);
  if (!cave) {
    // the yard: only where the scene's camera, risen at most `sight` over the warden's eye, sees the ground
    const eye = ((cfg.player && cfg.player.eyeHeight) || 1.65) + WAYOUT.yard.sight;
    const seen = far.filter((p) => sightTop(warden, p, cfg.boxes) <= eye);
    if (seen.length) far = seen;
  }
  const r = (cave ? WAYOUT.cave : WAYOUT.yard).r;
  if (!far.length) {
    let best = open[0] || { x: 0, z: 0 };
    for (const p of open) if (Math.hypot(p.x - warden.x, p.z - warden.z) > Math.hypot(best.x - warden.x, best.z - warden.z)) best = p;
    return { x: best.x, z: best.z, r };
  }
  const rng = makeRng(((seed >>> 0) ^ (cave ? 0x5ca7e : 0xc4a7e5)) >>> 0);
  const p = far[Math.floor(rng() * far.length)];
  return { x: p.x, z: p.z, r };
}

/**
 * Starts the scene as the room is won (sim.js, on allClear in the yard or the cave). foe: the kill
 * that won it { id, enemy, x, y, z } (the yard's last foe; the Cantor). Picks and keeps the site.
 * Once a run: a room whose way out is already open does nothing.
 */
export function startWayout(sim, foe, input, events) {
  const w = sim && sim.waves;
  const kind = w && wayoutKind(sim.cfg.room);
  if (!kind || w.wayout) return false;
  const pl = sim.player;
  const from = foe && Number.isFinite(foe.x) ? { id: foe.id, enemy: foe.enemy, x: foe.x, y: foe.y || 0, z: foe.z } : { id: null, enemy: null, x: pl.x, y: 0, z: pl.z };
  const stays = kind === 'vault' && from.id != null ? { x: from.x, z: from.z, r: (sim.cfg.cantor && sim.cfg.cantor.radius) || 1.2 } : null;
  const site = siteFor(sim.cfg.room, sim.cfg, sim.seed, { x: pl.x, z: pl.z }, sim.boxes || sim.cfg.boxes, stays);
  w.wayout = { kind, x: site.x, z: site.z, r: site.r, open: false };
  if (kind === 'vault') w.wayout.vault = ceilingAt(site.x, site.z);
  const home = homeLook(sim, site, kind);
  w.scene = { kind, t: 0, length: WAYOUT[sim.cfg.room === 'cave' ? 'cave' : 'yard'].length, foe: from, struck: false, fireHeld: !!(input && input.fire), homeYaw: home.yaw, homePitch: home.pitch };
  events.push({ type: 'sceneStart', kind, x: site.x, z: site.z, foe: from });
  return true;
}

/**
 * The warden's new heading as the scene hands back (CS-1): toward the way out, so the view settles on
 * the crater (looking a little down at its ground) or the shaft (a little up its beam) and play
 * resumes facing it, with no jump. yaw as the player's (forward = (-sin, -cos)); pitch up positive.
 */
export function homeLook(sim, site, kind) {
  const pl = sim.player;
  const eye = (pl.y || 0) + ((sim.cfg.player && sim.cfg.player.eyeHeight) || 1.65);
  const dx = site.x - pl.x; const dz = site.z - pl.z;
  const d = Math.max(0.5, Math.hypot(dx, dz));
  const aim = kind === 'vault' ? 2.2 : 0.3; // mid-beam, or the crater's ground
  const pitch = kind === 'vault' ? clamp(Math.atan2(aim - eye, d), -0.05, 0.35) : clamp(Math.atan2(aim - eye, d), -0.35, -0.05);
  return { yaw: Math.atan2(-dx, -dz), pitch };
}

/** Turns the warden to the scene's home heading (its end, or a skip). */
function faceHome(sim, s) {
  if (!sim || !sim.player || !Number.isFinite(s.homeYaw)) return;
  sim.player.yaw = s.homeYaw;
  sim.player.pitch = s.homePitch;
}

/** Seconds into the scene at which the blast strikes (the foe lands; the vault is hit). */
export function strikeAt(kind) {
  return kind === 'vault' ? WAYOUT.cave.beat + WAYOUT.cave.shot : WAYOUT.yard.beat + WAYOUT.yard.fly;
}

/** Seconds into the cave's scene at which the shaft is fully lit. */
export const LIT_AT = strikeAt('vault') + WAYOUT.cave.lightAt + WAYOUT.cave.light;

function strike(w, s, events, skipped) {
  s.struck = true;
  w.wayout.open = true;
  const o = w.wayout;
  if (s.kind === 'vault') events.push({ type: 'vaultBreak', x: o.x, z: o.z, y: o.vault, skipped: !!skipped });
  else events.push({ type: 'craterBlast', x: o.x, z: o.z, y: 0, skipped: !!skipped });
}

const HELD = ['fire', 'jump', 'interact', 'skip', 'reload', 'sprint', 'hold'];

/**
 * One frame of the way-out scene, or false when none plays (sim.js calls it first). Its clock
 * runs, the blast strikes at strikeAt, and it ends by itself at its length or at once on a skip
 * (the way out already open). Ending sets the latch on whatever is held. True for every frame it
 * consumed.
 */
export function stepWayoutScene(sim, input, dt, events) {
  const w = sim.waves;
  const s = w && w.scene;
  if (!s || (s.kind !== 'crater' && s.kind !== 'vault')) return false;
  s.t += Math.max(0, dt || 0);
  const fire = !!(input && input.fire);
  if (s.fireHeld && !fire) s.fireHeld = false;
  const click = fire && !s.fireHeld;
  const skip = !!(input && (input.interact || click || input.jump || input.skip));
  if (!s.struck && (skip || s.t >= strikeAt(s.kind))) strike(w, s, events, skip && s.t < strikeAt(s.kind));
  if (skip || s.t >= s.length) {
    w.scene = null;
    faceHome(sim, s);
    latch(w, input);
    events.push({ type: 'sceneEnd', kind: s.kind, skipped: skip });
  }
  return true;
}

/** Latches every input held as a scene or card ends: none counts again until it is let go (A6). */
export function latch(w, input) {
  const keys = {};
  for (const k of HELD) if (input && input[k]) keys[k] = true;
  if (input && (input.moveX || input.moveZ)) keys.move = true;
  w.latch = Object.keys(keys).length ? keys : null;
}

/**
 * The input the rules act on while a latch holds: each latched key counts for nothing until it has
 * been let go (then it is free again). A copy; the caller's input is untouched.
 */
export function releaseLatch(w, input) {
  const L = w && w.latch;
  if (!L || !input) return input;
  const out = { ...input };
  for (const k of Object.keys(L)) {
    if (k === 'move') {
      if (input.moveX || input.moveZ) { out.moveX = 0; out.moveZ = 0; } else delete L.move;
    } else if (input[k]) out[k] = false;
    else delete L[k];
  }
  if (!Object.keys(L).length) w.latch = null;
  return out;
}

/**
 * A run restored mid-scene comes back to the way out already open (no replay); a site kept is kept.
 * Returns the waves it was given. The yard and the cave keep no checkpoint today (main.js restores
 * the court and the castle only), so nothing calls this yet: it is the rule any snapshot of either
 * room must go through, held by its test (review 5).
 */
export function settledWayout(w) {
  if (!w) return w;
  if (w.scene && (w.scene.kind === 'crater' || w.scene.kind === 'vault')) {
    w.scene = null;
    if (w.wayout) w.wayout.open = true;
  }
  w.latch = null;
  return w;
}

/** The kept way out of a room as a mouth { x, z, r, way } once open, else null. */
export function wayoutMouth(sim, room) {
  const o = sim && sim.waves && sim.waves.wayout;
  if (!o || !o.open || sim.cfg.room !== room || o.kind !== wayoutKind(room)) return null;
  return { x: o.x, z: o.z, r: o.r, way: room === 'cave' ? 'up' : 'down' };
}

const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };

/**
 * How high the yard's foe has to arc (metres over the higher of its two ends) to come down steeply
 * on the site and to clear every crate under its path: WAYOUT.yard.apex at the least, apexMax at
 * the most. boxes: the room's collision list. Pure; the view asks once as the scene starts.
 */
/**
 * How high a box stands as drawn, not as it collides: the yard's winch carries its drum over its
 * box (world.js: up to about 1.5 m more) and the hull rib its arched frames (about 1.0 m more).
 * The scene's arc and camera clear these, so the impact is never hidden behind one.
 */
export function drawnTop(b) {
  return b.maxY + (b.kind === 'winch' ? 1.5 : b.kind === 'rib' ? 1.0 : 0);
}

/**
 * How high an eye over `from` must stand to see the ground at `site` over every box between (as
 * drawn): the yard scene's camera rises to it, and the yard's site is only chosen where it stays
 * under WAYOUT.yard.sight above the warden's eye, so the blast is never hidden.
 */
export function sightTop(from, site, boxes) {
  let top = 0;
  for (let i = 1; i < 32; i++) {
    const q = i / 32;
    const x = from.x + (site.x - from.x) * q; const z = from.z + (site.z - from.z) * q;
    for (const b of boxes) if (toRect(x, z, b) < 0.3) top = Math.max(top, (drawnTop(b) + 0.5 - 0.3 * q) / (1 - q));
  }
  return top;
}

export function flightApex(foe, site, boxes = []) {
  const Y = WAYOUT.yard;
  const dx = site.x - foe.x; const dz = site.z - foe.z;
  const y0 = (foe.y || 0) + Y.lift;
  const base = Math.max(foe.y || 0, 0);
  let apex = Math.max(Y.apex, Y.steep * Math.hypot(dx, dz));
  for (let i = 2; i < 24; i++) {
    const u = i / 24;
    const h = along(u);
    const x = foe.x + dx * h; const z = foe.z + dz * h;
    let top = 0;
    for (const b of boxes) if (toRect(x, z, b) < Y.girth && drawnTop(b) > top) top = drawnTop(b);
    if (!top) continue;
    // foeFlightAt's height at u, solved for the apex that puts it `over` above the crate
    apex = Math.max(apex, (top + Y.over + Y.sink * u - (1 - u) * y0) / (4 * u * (1 - u)) + 0.5 * y0 - base);
  }
  return Math.min(apex, Y.apexMax);
}

/** How far along the ground the foe is, 0 to 1, at u through its flight: straight up first, then over. */
const along = (u) => Math.pow(u, 1.5);

/**
 * The yard's foe, t seconds into the scene: { x, y, z, ax, az, spin, twist, wind, u, gone } (its
 * feet; spin in radians about the horizontal axis (ax, az) across its flight, twist about its own
 * upright; wind: 0 to 1 as its lantern overloads before it leaves the ground; u: 0 to 1 through
 * the flight; gone once it has hit). It shudders up off the ground over WAYOUT.yard.beat, then is
 * flung: up first, then over in a high tumbling arc that comes down steeply onto the site. apex:
 * flightApex's answer (by default the height its distance alone asks for).
 */
export function foeFlightAt(scene, site, t, out = {}, apex = null) {
  const Y = WAYOUT.yard;
  const p = scene.foe;
  const u = clamp((t - Y.beat) / Y.fly);
  const wind = smooth(t / Y.beat);
  const y0 = p.y + wind * Y.lift;
  const dx = site.x - p.x; const dz = site.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const rise = apex == null ? Math.min(Y.apexMax, Math.max(Y.apex, Y.steep * len)) : apex;
  const top = Math.max(p.y, 0) + rise;
  const h = along(u);
  out.x = p.x + dx * h;
  out.z = p.z + dz * h;
  out.y = (1 - u) * y0 + 4 * (top - 0.5 * y0) * u * (1 - u) - Y.sink * u; // into the concrete at the end
  out.ax = -dz / len; out.az = dx / len;
  const air = Math.max(0, t - Y.beat);
  out.spin = Y.spin * (air + 0.08 * wind * wind * Y.beat); // a slow tip as it lifts, then the full tumble
  out.twist = 2.3 * air;
  out.wind = wind;
  out.u = u;
  out.gone = t >= strikeAt('crater');
  return out;
}

/**
 * The Cantor's last blast, t seconds into the cave's scene: { x, y, z, k, on, gather, tail, tx,
 * ty, tz, y0 } (k: 0 to 1 from its chest to the vault over the site, in a straight line, so its
 * aim is plain; on while in flight; gather: 0 to 1 as its core gathers before it fires; tail and
 * (tx, ty, tz): where its streak ends behind it; y0: the height it leaves from).
 */
export function vaultShotAt(scene, wayout, t, out = {}) {
  const C = WAYOUT.cave;
  const p = scene.foe;
  const k = clamp((t - C.beat) / C.shot);
  const tail = clamp((t - C.beat - C.trail) / C.shot);
  const y0 = (p.y || 0) + C.chest;
  out.x = p.x + (wayout.x - p.x) * k;
  out.z = p.z + (wayout.z - p.z) * k;
  out.y = y0 + (wayout.vault - y0) * k;
  out.tx = p.x + (wayout.x - p.x) * tail;
  out.tz = p.z + (wayout.z - p.z) * tail;
  out.ty = y0 + (wayout.vault - y0) * tail;
  out.k = k;
  out.tail = tail;
  out.y0 = y0;
  out.gather = smooth(t / C.beat);
  out.on = t >= C.beat && t < C.beat + C.shot;
  return out;
}

/** How far the cracks have run across the vault, 0 to 1, t seconds into the cave's scene (1 with none playing). */
export function vaultCrack(scene, t) {
  if (!scene || scene.kind !== 'vault') return 1;
  return smooth((t - strikeAt('vault')) / WAYOUT.cave.crack);
}

/**
 * When piece i of n of the vault lets go, in seconds after the strike: the middle first, the rim
 * last (i runs from the middle outward), each a little off the beat (jitter: 0 to 1, the view's
 * seeded draw for the piece).
 */
export function vaultDropAt(i, n, jitter = 0.5) {
  const C = WAYOUT.cave;
  return C.drop + C.dropSpan * clamp((i + 0.6 * (jitter - 0.5)) / Math.max(1, n - 1));
}

/** How lit the shaft is, 0 to 1, t seconds into the cave's scene (1 with no scene playing: kept open). */
export function shaftLight(scene, t) {
  if (!scene || scene.kind !== 'vault') return 1;
  const C = WAYOUT.cave;
  return smooth((t - strikeAt('vault') - C.lightAt) / C.light);
}
