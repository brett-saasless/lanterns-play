// Which zones of the castle can be seen from which (fix/doorway-sky). The owner (2026-11-18):
// "when i walk from the room with the rocking horse back to the room with the funhouse mirror the
// doors in the room show the sky for a few steps. should just show interior hall/castle". The shell
// (engine/castle.js) draws the occupied zone and the zones it can see; a zone it leaves out is a hole
// with the sky behind it. The list of sight lines used to be written by hand and missed some (from
// the passage's end the mirror room's far doors, to the landing and the Count's passage, were
// holes). Here it is worked out from the plan: zone B is in sight of zone A when a straight line
// from somewhere on A's floor (or in a doorway that counts as A) runs through a chain of open
// doorways, never through a wall, into B, and passes every doorway between its sill and its head (an
// eye from crouching low to the top of a jump: the stairs drop the ground floor out of sight of the
// upper rooms). Floors and ceilings between the doorways are not tested, so the answer can only be
// too generous, never too mean. Pure: no three, no DOM.

import { ZONES, DOORS, STAIRS, UPPER, floorZoneAt } from './keepmap.js';
import { doorHeight } from './doorleaves.js';

const f = (o) => {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) f(v); });
  return Object.freeze(o);
};
const EPS = 1e-6;
const inRect = (r, x, z) => x >= r.minX - EPS && x <= r.maxX + EPS && z >= r.minZ - EPS && z <= r.maxZ + EPS;

/**
 * The openings of the plan: every door (keepmap DOORS, a rect the wall's thickness) and the head of
 * the stairs, which opens onto the landing with no wall at all (a rect of no depth).
 */
export function openingsOf(doors = DOORS, stairs = STAIRS, zones = ZONES) {
  const floorOf = (id) => { const z = zones.find((q) => q.id === id); return z ? z.y : 0; };
  const out = doors.map((d) => ({ id: d.id, zones: d.zones.slice(), rect: { ...d.rect }, y: Math.max(...d.zones.map(floorOf)), h: doorHeight(d) }));
  const s = stairs.rect;
  out.push({ id: 'stairTop', zones: ['stairs', 'landing'], rect: { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.minZ }, y: UPPER, h: 3.0 });
  return out;
}

/** Eye heights above the floor: crouched low to the top of a jump (generous both ways). */
export const EYE_HEIGHTS = f([1.0, 1.7, 2.4]);

/** Points over an opening: across its width, on the line half way through its depth, sill to head. */
function across(o, n) {
  const r = o.rect;
  const alongX = (r.maxX - r.minX) >= (r.maxZ - r.minZ);
  const pts = [];
  const nh = Math.max(3, Math.round(n / 2));
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    for (let j = 0; j < nh; j++) {
      const y = o.y + o.h * (j + 0.5) / nh;
      pts.push(alongX ? { x: r.minX + (r.maxX - r.minX) * k, z: (r.minZ + r.maxZ) / 2, y } : { x: (r.minX + r.maxX) / 2, z: r.minZ + (r.maxZ - r.minZ) * k, y });
    }
  }
  return pts;
}

/** Where an eye in zone id may stand: its floor and the doorways keepmap.zoneAt gives to it. */
function standOf(id, zones, openings) {
  const z = zones.find((q) => q.id === id);
  return [...z.rects, ...openings.filter((o) => o.zones[1] === id && o.rect.maxZ > o.rect.minZ).map((o) => o.rect)];
}

/** A grid of eye points over rects, step apart, edges included, at each eye height over the floor there. */
function grid(rects, step, ground) {
  const pts = [];
  for (const r of rects) {
    const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / step)); const nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / step));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = r.minX + (r.maxX - r.minX) * i / nx; const z = r.minZ + (r.maxZ - r.minZ) * j / nz;
      const g = ground(x, z);
      for (const h of EYE_HEIGHTS) pts.push({ x, z, y: g + h });
    }
  }
  return pts;
}

/** True when the line from eye e to point p crosses every opening of the chain between its sill and its head. */
function underHeads(e, p, chain) {
  for (const o of chain) {
    const r = o.rect;
    const alongX = (r.maxX - r.minX) >= (r.maxZ - r.minZ);
    const [a, b, c] = alongX ? [e.z, p.z, (r.minZ + r.maxZ) / 2] : [e.x, p.x, (r.minX + r.maxX) / 2];
    if (Math.abs(b - a) < EPS) continue; // the line runs along the doorway's own plane (the eye stands in it)
    const t = (c - a) / (b - a);
    if (t < -EPS || t > 1 + EPS) continue; // the eye stands inside this doorway's depth
    const y = e.y + (p.y - e.y) * t;
    if (y < o.y - EPS || y > o.y + o.h + EPS) return false;
  }
  return true;
}

/** True when the segment a-b stays inside the free rects (no wall crossed), checked every `step` metres. */
function clear(a, b, free, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (b.x - a.x) * i / n; const z = a.z + (b.z - a.z) * i / n;
    let ok = false;
    for (const r of free) if (inRect(r, x, z)) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

/**
 * The zones in sight of each zone: { [id]: [ids] } (the zone itself not listed; its doorway
 * neighbours always are). A chain of openings A -o1-> B -o2-> C ... is followed while some straight
 * line from an eye point in A to a point across the last opening stays on the chain's floors and
 * doorways and passes each doorway under its head. opts: eye (grid step, metres), across (points
 * per opening), step (segment check), zones/openings/ground (the plan and its floor heights; keepmap's
 * by default).
 */
export function sightLines(opts = {}) {
  const { eye = 0.5, across: nAcross = 9, step = 0.1, zones = ZONES, openings = openingsOf(), ground = (x, z) => floorZoneAt(x, z, 99).floor } = opts;
  const out = {};
  const open = (id) => openings.filter((o) => o.zones.includes(id));
  for (const a of zones) {
    const eyes = grid(standOf(a.id, zones, openings), eye, ground);
    const seen = new Set();
    // depth-first along chains of openings; `free` is the chain's floors and doorways so far
    const walk = (zone, chain, free, visited) => {
      for (const o of open(zone)) {
        if (chain.includes(o)) continue;
        const next = o.zones[0] === zone ? o.zones[1] : o.zones[0];
        if (visited.has(next)) continue;
        const nz = zones.find((q) => q.id === next);
        if (!nz) continue;
        const free2 = [...free, o.rect];
        const ends = across(o, nAcross);
        // the first opening is always in sight (it is a doorway of the zone); beyond it, a straight line
        const chain2 = [...chain, o];
        const sees = chain.length === 0 || eyes.some((e) => ends.some((p) => underHeads(e, p, chain2) && clear(e, p, free2, step)));
        if (!sees) continue;
        seen.add(next);
        walk(next, chain2, [...free2, ...nz.rects], new Set([...visited, next]));
      }
    };
    walk(a.id, [], [...standOf(a.id, zones, openings)], new Set([a.id]));
    out[a.id] = [...seen].sort();
  }
  // a sight line runs both ways: make the answer symmetric (the eye grid is finite)
  for (const [id, ids] of Object.entries(out)) for (const b of ids) if (!out[b].includes(id)) out[b] = [...out[b], id].sort();
  return out;
}

/**
 * The answer for the castle as built, worked out once (tests/sightlines.test.js checks it against
 * sightLines() on the live plan, so a moved door or a new room cannot leave it stale). The shell
 * reads this; it never runs the search in the browser.
 */
export const SIGHT = f({
  // approach, road and bridge have no doorway of their own: open ground, the shell's 'outside'
  forecourt: ['cor1', 'hall'],
  hall: ['cor1', 'forecourt'],
  cor1: ['cor2', 'forecourt', 'hall', 'tea'],
  tea: ['cor1', 'cor2'],
  cor2: ['cor1', 'cor3', 'gallery', 'tea'],
  gallery: ['cor2', 'cor3'],
  cor3: ['cor2', 'gallery', 'stairs', 'walk'],
  walk: ['cor3', 'landing', 'mirror', 'stairs'],
  stairs: ['cor3', 'count', 'countway', 'landing', 'mirror', 'walk'],
  landing: ['count', 'countway', 'mirror', 'passage', 'stairs', 'walk'],
  mirror: ['count', 'countway', 'landing', 'passage', 'stairs', 'walk'],
  passage: ['countway', 'landing', 'mirror', 'nursery'],
  nursery: ['passage'],
  countway: ['count', 'landing', 'mirror', 'passage', 'stairs'],
  count: ['countway', 'landing', 'mirror', 'stairs'],
});

/** The zones drawn for an eye in zone id: the zone itself and every zone in sight of it. */
export function visibleFrom(id, sight = SIGHT) {
  return [id, ...(sight[id] || [])];
}
