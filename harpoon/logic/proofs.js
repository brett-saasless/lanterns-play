// The three proofs (R6, R7, R21): the knot board, the three lay tickets, the log in the
// whaleboat (needs Queequeg's harpoon to haul in - the caller enforces that, this module only
// holds what is taken), the four clippings and their count, and Peleg's check. Pure.

import { CLIPPINGS } from './dockmap.js';

/** A fresh proofs record: nothing taken, no clipping read. */
export function createProofs() {
  return { knot: null, lay: null, log: false, clippings: [] };
}

/** Takes (or changes to) a knot by name; a wrong one is taken the same way (R6: "the same way, shown the same way"). */
export function takeKnot(p, name) {
  p.knot = name;
}

/** Takes (or changes to) a lay ticket by key. */
export function takeLay(p, key) {
  p.lay = key;
}

/** Puts back whichever is held (knot or lay), as the design's edge case allows at no penalty. */
export function putBack(p, which) {
  if (which === 'knot') p.knot = null;
  else if (which === 'lay') p.lay = null;
}

/** The whaling log, taken once (needs the harpoon haul done; the caller checks that first). */
export function takeLog(p) {
  p.log = true;
}

/** Reads a clipping once: { isNew, allFour }. A clipping already read is a no-op (isNew false). */
export function readClipping(p, key) {
  if (p.clippings.includes(key)) return { isNew: false, allFour: p.clippings.length >= CLIPPINGS.length };
  p.clippings.push(key);
  return { isNew: true, allFour: p.clippings.length >= CLIPPINGS.length };
}

/** Whether the knot held is right, the lay held is right, and the log is in: { knot, lay, log }. knot/lay are null while none is held. */
export function rightness(p, cfg) {
  return {
    knot: p.knot == null ? null : p.knot === cfg.proofs.knot,
    lay: p.lay == null ? null : p.lay === cfg.proofs.lay,
    log: p.log,
  };
}

/** Every proof still missing or wrong, in Peleg's order (knot, lay, log), for his "still wanting" line. */
export function missing(p, cfg) {
  const r = rightness(p, cfg);
  const out = [];
  if (r.knot !== true) out.push('knot');
  if (r.lay !== true) out.push('lay');
  if (!r.log) out.push('log');
  return out;
}

/** True once all three are right: signs the warden on. */
export function allRight(p, cfg) {
  return missing(p, cfg).length === 0;
}
