// The Hatter's display (R19): five priced hats on a shelf and a row of five pegs running away
// from his gate. E sets a hat on the next free peg (the one by the gate first); E on a hat on
// a peg puts it back on the shelf. When the fifth is set the row is checked: cheapest by the
// gate rising to dearest solves it (done.hats) and the gate opens; any other full row drops
// all five back to the shelf and changes nothing else. Nothing can be touched while the Hatter
// lives. State lives in sim.waves.hats ({ pegs[5], each a hat index or null }); the solve in
// sim.waves.done.hats. Places are in courtmap.js, the tags' words in script.js.

/**
 * The five hats by shelf position (hat index), each with the key of its price tag and its
 * price in pence (2/6 is 30, 5/- is 60, 7/6 is 90, 10/6 is 126, 12/6 is 150). The shelf does
 * not stand in price order, so the row has to be worked out from the tags.
 */
export const HATS = Object.freeze([
  Object.freeze({ key: 'style76', pence: 90 }),
  Object.freeze({ key: 'style26', pence: 30 }),
  Object.freeze({ key: 'style126', pence: 150 }),
  Object.freeze({ key: 'style5', pence: 60 }),
  Object.freeze({ key: 'style106', pence: 126 }),
]);

export const PEGS = HATS.length;

/** The one right row: hat indices from the peg by the gate outward, cheapest to dearest. */
export const RIGHT_ROW = Object.freeze(HATS.map((h, i) => i).sort((a, b) => HATS[a].pence - HATS[b].pence));

/** Fresh state: every hat on the shelf. */
export function createHats() {
  return { pegs: Array(PEGS).fill(null) };
}

/** The solved state: the right row on the pegs. */
export function solvedHats() {
  return { pegs: [...RIGHT_ROW] };
}

/** The peg hat is on, or -1 when it is on the shelf (or not a hat). */
export function pegOf(state, hat) {
  return state && Array.isArray(state.pegs) ? state.pegs.indexOf(hat) : -1;
}

/** True when every peg holds a hat and their prices rise from the gate outward. */
export function inOrder(pegs) {
  if (!Array.isArray(pegs) || pegs.length !== PEGS || pegs.some((h) => h == null)) return false;
  for (let p = 1; p < PEGS; p++) if (!(HATS[pegs[p - 1]].pence < HATS[pegs[p]].pence)) return false;
  return true;
}

/** True when the hats can be touched: the Hatter is dead and the row is not yet solved. */
export function hatsOpen(w) {
  return !!(w && w.done && w.done.hatter && !w.done.hats);
}

const isHat = (h) => Number.isInteger(h) && h >= 0 && h < PEGS;

/**
 * E on hat `hat`. On the shelf: it goes on the next free peg (hatSet { hat, peg }); with that
 * the fifth, the row is checked (hatsSolved, or hatsFall and every hat back on the shelf). On
 * a peg: back to the shelf (hatSet { hat, peg: null }). Returns 'set' | 'back' | 'solved' |
 * 'fell', or false (and changes nothing) while the Hatter lives, once solved, or for a bad hat.
 */
export function useHat(sim, hat, events) {
  const w = sim.waves;
  if (!hatsOpen(w) || !isHat(hat)) return false;
  const pegs = w.hats.pegs;
  const on = pegs.indexOf(hat);
  if (on >= 0) {
    pegs[on] = null;
    events.push({ type: 'hatSet', hat, peg: null });
    return 'back';
  }
  const peg = pegs.indexOf(null);
  if (peg < 0) return false; // a full row is always checked at once; kept for safety
  pegs[peg] = hat;
  events.push({ type: 'hatSet', hat, peg });
  if (pegs.includes(null)) return 'set';
  if (inOrder(pegs)) {
    w.done.hats = true;
    events.push({ type: 'hatsSolved', hat, peg });
    return 'solved';
  }
  w.hats.pegs = Array(PEGS).fill(null);
  events.push({ type: 'hatsFall', hat, peg });
  return 'fell';
}

/** What a checkpoint restore writes: the solved row once solved, else every hat on the shelf. */
export function restoredHats(done) {
  return done && done.hats ? solvedHats() : createHats();
}
