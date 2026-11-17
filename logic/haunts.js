// Dread with no damage (R7, R8, R11, R13, R14, R16, G8, G10): the raven that dodges the reticle
// and mocks a miss, the ghost's silent scream, the jumpy furniture that moves only unseen, the
// figure-mirror's foe (one of three at random each pass, never the same twice running), the
// rocking horse that stops when looked at, the music box that stops mid-bar, the figures past
// the windows, the tall figure in the gallery's glass, and the bats in the Count's room.
//
// Haunts live in sim.waves.haunts, never in sim.enemies: they have no health, no hit zone and no
// place in the collision boxes, so no shot, swing or splash can reach one, and none of them ever
// calls a damage path. The bats only shove the warden and sway the aim. Randomness comes from
// the injected generator (sim.rng); every timer holds while a scene plays.
//
// keep.js calls stepHaunts every frame with what only it knows (ctx): the zone the warden is in
// ('tea', 'gallery', 'mirror', 'nursery', 'count', or any other name), whether that room has
// windows, whether a scene plays, whether the ladder's grin is in the glass, and the places
// (keepmap.js): { furniture: [{ id, places: [{ x, z }] }], doors: [{ minX, maxX, minZ, maxZ }],
// mirror: { minX, maxX, minZ, maxZ } (the strip before the figure-mirror), horse: { x, z },
// tall: { x, z } (where it stands on the far apron), raven: { [zone]: [{ id, x, y, z }] } }.

import { circleBlocked, moveCircle } from './collide.js';
import { taunt } from './talk.js';

/** Starting values (the design's Numbers table); CASTLE_CONFIG.haunts overrides any of them. */
export const HAUNT_TUNE = Object.freeze({
  // Degrees off the look (in 3D, pitch included) that count as in view. The camera is 75
  // degrees high (world.js); on a screen up to 21:9 its frustum's corners lie 63 degrees off
  // the look, so 75 holds the whole picture at any pitch with room to spare. Each thing is
  // widened by its own size as well (atan(size / distance)).
  viewCone: 75,
  lookCone: 20, // degrees: what the warden is looking at (the horse stops), not merely sees
  furnitureSize: 1.0, // metres: a piece's reach from its centre for the view test
  furnitureY: 0.9, // metres: a piece's centre height
  horseSize: 0.6,
  horseY: 0.6,
  furnitureMin: 6, // seconds between moves, drawn afresh each time
  furnitureMax: 12,
  furnitureClear: 1.2, // never to within this of the warden
  furnitureRadius: 0.6, // a piece's footprint against a doorway
  foes: Object.freeze(['rabbit', 'hatter', 'caterpillar']),
  boxPlay: 3.4, // seconds of the music box before it stops mid-bar
  windowMin: 40, // seconds between figures past the windows (G10)
  windowMax: 90,
  tallMin: 45, // seconds between showings of the tall figure
  tallMax: 100,
  tallShow: 4, // seconds it stands
  tallNear: 10, // metres: gone before the warden is this close
  ravenDodge: 0.8, // metres from the line of the look that send the raven off
  ravenRange: 40,
  ravenMock: 2, // metres: a shot this close to it is a miss it mocks
  bats: 12,
  batShove: 0.6, // metres a second at most
  batSway: 1.2, // degrees of aim at most
});

const tuneOf = (cfg) => ({ ...HAUNT_TUNE, ...((cfg && cfg.haunts) || {}) });

const draw = (rng, lo, hi) => lo + rng() * (hi - lo);

/** Fresh haunts for a life. lastFoe: the figure-mirror's last foe, kept across deaths. */
export function createHaunts(cfg, rng, lastFoe = null) {
  const t = tuneOf(cfg);
  return {
    zone: null, // the zone as last stepped, for entering
    gallery: false, // in the gallery itself (not the crypt) as last stepped
    furniture: [], // place index of each piece
    moveIn: draw(rng, t.furnitureMin, t.furnitureMax),
    foe: lastFoe, // the last foe the figure-mirror showed
    atMirror: false,
    horse: { rocking: true },
    box: { left: 0 },
    windows: { next: draw(rng, t.windowMin, t.windowMax), passed: 0 },
    tall: { next: draw(rng, t.tallMin, t.tallMax), left: 0 },
    raven: { on: null, x: 0, y: 0, z: 0 },
    ghost: { screamed: false },
    bats: { on: false, n: t.bats, dir: 0, t: 0, sway: 0 },
  };
}

/**
 * True when a thing of reach `size` centred at (x, y, z) comes within `cone` degrees (default
 * viewCone) of the warden's look, in 3D from the eye, pitch included, its own angular size
 * added. y defaults to eye height. A thing the warden stands inside is always in view.
 */
export function inView(pl, x, z, cfg, size = 0, y = null, cone = null) {
  const eyeY = (pl.y || 0) + ((cfg && cfg.player && cfg.player.eyeHeight) || 1.65);
  const dx = x - pl.x;
  const dy = (y == null ? eyeY : y) - eyeY;
  const dz = z - pl.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= Math.max(size, 1e-6)) return true;
  const cp = Math.cos(pl.pitch || 0);
  const fx = -Math.sin(pl.yaw) * cp;
  const fy = Math.sin(pl.pitch || 0);
  const fz = -Math.cos(pl.yaw) * cp;
  const off = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / d)));
  const half = ((cone == null ? tuneOf(cfg).viewCone : cone) * Math.PI) / 180;
  return off <= half + Math.atan(size / d);
}

/** True when the warden is looking at a thing (lookCone), not merely able to see it. */
export function lookedAt(pl, x, z, cfg, size = 0, y = null) {
  return inView(pl, x, z, cfg, size, y, tuneOf(cfg).lookCone);
}

const pieceSeen = (pl, p, cfg, t) => inView(pl, p.x, p.z, cfg, t.furnitureSize, t.furnitureY);

// ---- the jumpy furniture and the figure-mirror (the mirror room) -------------------------

function stepFurniture(sim, h, dt, events, places, t) {
  const pieces = (places && places.furniture) || [];
  if (!pieces.length) return;
  while (h.furniture.length < pieces.length) h.furniture.push(0);
  h.moveIn -= dt;
  if (h.moveIn > 0) return;
  const pl = sim.player;
  const doors = (places && places.doors) || [];
  const options = [];
  pieces.forEach((p, i) => {
    const now = p.places[h.furniture[i]];
    if (!now || pieceSeen(pl, now, sim.cfg, t)) return;
    p.places.forEach((q, k) => {
      if (k === h.furniture[i]) return;
      if (pieceSeen(pl, q, sim.cfg, t)) return;
      if (Math.hypot(q.x - pl.x, q.z - pl.z) < t.furnitureClear + t.furnitureRadius) return;
      if (circleBlocked(q.x, q.z, t.furnitureRadius, doors)) return;
      options.push([i, k]);
    });
  });
  if (!options.length) {
    h.moveIn = 0.5; // nothing may move unseen just now: look again shortly
    return;
  }
  const [i, k] = options[Math.min(options.length - 1, Math.floor(sim.rng() * options.length))];
  h.furniture[i] = k;
  h.moveIn = draw(sim.rng, t.furnitureMin, t.furnitureMax);
  events.push({ type: 'haunt', kind: 'furniture', id: pieces[i].id != null ? pieces[i].id : i });
}

/** Where piece i of the mirror room stands now ({ x, z }), from the places table. */
export function furnitureAt(sim, i, places) {
  const p = places && places.furniture && places.furniture[i];
  const h = sim.waves.haunts;
  return p ? p.places[(h && h.furniture[i]) || 0] : null;
}

function inRect(r, x, z) {
  return !!r && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

function stepFigureMirror(sim, h, events, places, t) {
  const pl = sim.player;
  const at = inRect(places && places.mirror, pl.x, pl.z);
  if (at && !h.atMirror) {
    const free = t.foes.filter((f) => f !== h.foe);
    const pick = free[Math.min(free.length - 1, Math.floor(sim.rng() * free.length))];
    h.foe = pick;
    events.push({ type: 'haunt', kind: 'foe', id: pick });
  }
  h.atMirror = at;
}

// ---- the nursery ---------------------------------------------------------------------------

function stepNursery(sim, h, dt, events, places, entered, t) {
  if (entered) {
    h.box.left = t.boxPlay;
    events.push({ type: 'haunt', kind: 'box', id: 'play' });
  } else if (h.box.left > 0) {
    h.box.left -= dt;
    if (h.box.left <= 0) {
      h.box.left = 0;
      events.push({ type: 'haunt', kind: 'box', id: 'stop' });
    }
  }
  const horse = places && places.horse;
  if (!horse) return;
  const seen = lookedAt(sim.player, horse.x, horse.z, sim.cfg, t.horseSize, t.horseY);
  if (seen && h.horse.rocking) events.push({ type: 'haunt', kind: 'horse', id: 'stop' });
  h.horse.rocking = !seen;
}

// ---- the windows and the gallery's glass ---------------------------------------------------

function stepWindows(sim, h, dt, events, t) {
  h.windows.next -= dt;
  if (h.windows.next > 0) return;
  h.windows.passed += 1;
  h.windows.next = draw(sim.rng, t.windowMin, t.windowMax);
  events.push({ type: 'haunt', kind: 'window', id: h.windows.passed });
}

function hideTall(sim, h, events, t) {
  if (h.tall.left <= 0) return;
  h.tall.left = 0;
  h.tall.next = draw(sim.rng, t.tallMin, t.tallMax);
  events.push({ type: 'haunt', kind: 'tall', id: 'hide' });
}

function stepTall(sim, h, dt, events, places, ctx, entered, t) {
  if (entered) h.tall.next = draw(sim.rng, t.tallMin, t.tallMax);
  if (ctx.grin) {
    hideTall(sim, h, events, t); // never with the grin in the glass; the wait holds
    return;
  }
  const spot = places && places.tall;
  const pl = sim.player;
  const near = !!spot && Math.hypot(pl.x - spot.x, pl.z - spot.z) < t.tallNear;
  if (h.tall.left > 0) {
    h.tall.left -= dt;
    if (h.tall.left <= 0 || near) {
      h.tall.left = 1; // hideTall needs it showing
      hideTall(sim, h, events, t);
    }
    return;
  }
  h.tall.next -= dt;
  if (h.tall.next > 0 || near) return;
  h.tall.left = t.tallShow;
  events.push({ type: 'haunt', kind: 'tall', id: 'show' });
}

// ---- the raven ------------------------------------------------------------------------------

function lookRay(sim) {
  const pl = sim.player;
  const cp = Math.cos(pl.pitch || 0);
  const o = { x: pl.x, y: (pl.y || 0) + sim.cfg.player.eyeHeight, z: pl.z };
  const d = { x: -Math.sin(pl.yaw) * cp, y: Math.sin(pl.pitch || 0), z: -Math.cos(pl.yaw) * cp };
  return { o, d };
}

function rayDist(p, o, d, range) {
  const k = (p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z;
  if (k < 0 || k > range) return Infinity;
  return Math.hypot(o.x + d.x * k - p.x, o.y + d.y * k - p.y, o.z + d.z * k - p.z);
}

function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  return Math.hypot(a.x + dx * k - p.x, a.y + dy * k - p.y, a.z + dz * k - p.z);
}

function perch(h, p) {
  h.raven.on = p.id;
  h.raven.x = p.x;
  h.raven.y = p.y;
  h.raven.z = p.z;
}

function stepRaven(sim, h, events, perches, entered, t) {
  if (!perches || !perches.length) return;
  if (entered || h.raven.on == null || !perches.some((p) => p.id === h.raven.on)) perch(h, perches[0]);
  const was = { x: h.raven.x, y: h.raven.y, z: h.raven.z };
  const { o, d } = lookRay(sim);
  if (perches.length > 1 && rayDist(was, o, d, t.ravenRange) < t.ravenDodge) {
    const others = perches.filter((p) => p.id !== h.raven.on && rayDist(p, o, d, t.ravenRange) >= t.ravenDodge);
    const pool = others.length ? others : perches.filter((p) => p.id !== h.raven.on);
    perch(h, pool[Math.min(pool.length - 1, Math.floor(sim.rng() * pool.length))]);
    events.push({ type: 'ravenDodge', x: h.raven.x, z: h.raven.z, on: h.raven.on });
  }
  const n = events.length;
  for (let k = 0; k < n; k++) {
    const ev = events[k];
    if (ev.type !== 'shot' || !ev.from) continue;
    const ends = ev.pellets && ev.pellets.length ? ev.pellets.map((q) => q.to) : [ev.to];
    if (ends.some((to) => to && (segDist(was, ev.from, to) < t.ravenMock || segDist(h.raven, ev.from, to) < t.ravenMock))) {
      taunt(sim, 'raven', sim.rng, events);
      break;
    }
  }
}

/** The ladder's nudge: the raven lands on perch p ({ id, x, y, z }) and says so (ravenLand). */
export function landRaven(sim, p, events) {
  const h = sim.waves.haunts;
  if (!h || !p) return;
  perch(h, p);
  events.push({ type: 'ravenLand', x: p.x, z: p.z, on: p.id });
}

/** E on the ghost or on the carriage clock: her silent scream. first: the first this life. */
export function ghostScream(sim, events) {
  const h = sim.waves.haunts;
  if (!h) return;
  const first = !h.ghost.screamed;
  h.ghost.screamed = true;
  events.push({ type: 'ghostScream', first });
}

// ---- the bats ------------------------------------------------------------------------------

function stepBats(sim, h, dt, active, t) {
  const b = h.bats;
  const pl = sim.player;
  if (!active || pl.dead) {
    if (b.on) {
      pl.yaw -= b.sway; // the aim settles back where the warden put it
      b.sway = 0;
      b.on = false;
    }
    return;
  }
  b.on = true;
  b.t += dt;
  b.dir += (sim.rng() - 0.5) * 4 * dt;
  const push = t.batShove * (0.5 + 0.5 * Math.sin(b.t * 1.7)) * dt;
  const cfg = sim.cfg;
  moveCircle(pl, { x: Math.cos(b.dir) * push, z: Math.sin(b.dir) * push }, cfg.player.radius, sim.boxes || [], cfg.arena ? cfg.arena.half : 1e6);
  const most = (t.batSway * Math.PI) / 180;
  const sway = most * Math.sin(b.t * 2.3) * Math.cos(b.t * 0.9);
  pl.yaw += sway - b.sway;
  b.sway = sway;
}

// ---- the frame -----------------------------------------------------------------------------

/**
 * One frame of every haunt. ctx: { zone, windows, scene, grin, places } (see the header).
 * During a scene nothing steps and every timer holds; the tall figure, if showing, goes.
 */
export function stepHaunts(sim, dt, events, ctx = {}) {
  const w = sim.waves;
  const h = w && w.haunts;
  if (!h) return;
  const t = tuneOf(sim.cfg);
  const places = ctx.places || (sim.cfg.haunts && sim.cfg.haunts.places) || null;
  if (ctx.scene) {
    hideTall(sim, h, events, t);
    return;
  }
  const zone = ctx.zone || null;
  const entered = zone !== h.zone;
  h.zone = zone;
  const gallery = zone === 'gallery' && w.under !== 'crypt';
  const intoGallery = gallery && !h.gallery;
  if (!gallery && h.gallery) hideTall(sim, h, events, t);
  h.gallery = gallery;

  if (zone === 'mirror') {
    stepFurniture(sim, h, dt, events, places, t);
    stepFigureMirror(sim, h, events, places, t);
  } else {
    h.atMirror = false;
  }
  if (zone === 'nursery') stepNursery(sim, h, dt, events, places, entered, t);
  else {
    if (h.box.left > 0) {
      h.box.left = 0;
      events.push({ type: 'haunt', kind: 'box', id: 'stop' });
    }
    h.horse.rocking = true;
  }
  if (ctx.windows) stepWindows(sim, h, dt, events, t);
  if (gallery) stepTall(sim, h, dt, events, places, ctx, intoGallery, t);
  stepRaven(sim, h, events, places && places.raven && places.raven[zone], entered, t);
  const c = w.count;
  stepBats(sim, h, dt, zone === 'count' && !!c && (c.phase === 'rising' || c.phase === 'lurch'), t);
}
