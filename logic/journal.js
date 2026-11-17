// The warden's log (which entries are held, in the order found, and how they fall on pages so a
// clue never stands at a page's edge), the one spoken line, and the hint ladder: per puzzle,
// seconds since progress, a scene nudge at 90 s and a plainer log line at 210 s. The ladder only
// ever writes to sim.waves.hints, the log and the event list; it never changes puzzle state.
// Band two is the Hatter, then (once he is dead and until the row is right) the hats: their
// nudge rocks the cheapest hat still on the shelf, their plain rung writes the card's words.
// A spoken line stays up for its length (lineTime, or linePerChar a character, at most lineMax).

import { ENTRIES, LINES } from './script.js';
import { MAZE, COURT, deadEnds, stageAt } from './courtmap.js';
import { rightTurns, nextValve } from './roses.js';
import { HATS } from './hats.js';

/** Puzzle by stage: the court, then each band's gate creature. */
export const PUZZLES = Object.freeze(['roses', 'rabbit', 'hatter', 'bat', 'caterpillar']);

/** Band two's second puzzle, after the Hatter falls: the hats on their pegs (R19). */
export const HATS_PUZZLE = 'hats';

const PLAIN = Object.freeze({
  roses: 'plainRoses', rabbit: 'plainRabbit', hatter: 'plainHatter', bat: 'plainBat', caterpillar: 'plainCaterpillar',
  hats: 'hatCard', // no approved plain line: the card's own words (design, Conflicts 5)
});

/** Fresh hint state for every puzzle. */
export function createHints() {
  const h = {};
  for (const p of [...PUZZLES, HATS_PUZZLE]) h[p] = { idle: 0, rung: 0, last: 0 };
  return h;
}

/** The puzzle of stage k: PUZZLES[k], but band two is the hats once the Hatter is dead. */
export function puzzleAt(sim, k) {
  const w = sim.waves;
  if (k === 2 && w.done && w.done.hatter && !w.done.gates[1]) return HATS_PUZZLE;
  return PUZZLES[k];
}

/** True for an entry that helps (a clue or a ladder line); these never sit at a page's edge. */
export function telling(key) {
  const e = ENTRIES[key];
  return !!e && e.kind !== 'note';
}

/**
 * Adds an entry to the log once. Emits { type: 'logEntry', key, plain } (plain marks a ladder
 * line). Returns true when the entry is new; unknown keys and repeats are ignored.
 */
export function addEntry(sim, key, events) {
  const w = sim.waves;
  if (!Object.prototype.hasOwnProperty.call(ENTRIES, key) || w.log.includes(key)) return false;
  w.log.push(key);
  events.push({ type: 'logEntry', key, plain: ENTRIES[key].kind === 'plain' });
  return true;
}

/** Seconds a spoken line of `text` stays up: lineTime, or linePerChar a character if longer, at most lineMax. */
export function lineTimeOf(text, cfg) {
  const base = cfg.lineTime;
  const n = typeof text === 'string' ? text.length : 0;
  if (!Number.isFinite(cfg.linePerChar)) return base;
  return Math.min(Number.isFinite(cfg.lineMax) ? cfg.lineMax : Infinity, Math.max(base, n * cfg.linePerChar));
}

/** Starts a character's line; the newest wins and lines never stack. It stays up for its length. Emits speak. */
export function speak(sim, who, key, events) {
  const line = Object.prototype.hasOwnProperty.call(LINES, key) ? LINES[key] : null;
  sim.waves.line = { who, key, left: lineTimeOf(line ? line.text : '', sim.cfg) };
  events.push({ type: 'speak', who, key });
}

/**
 * Lays the log out on pages. Notes are split into page groups in order; each page opens and
 * closes with a note, and the telling entries are spread over the pages in found order and
 * placed inside them. Pages hold about five entries and grow when notes are scarce. With fewer
 * than two notes (never the case in play: the level opens on two) the log is one page as found.
 */
export function pagesOf(log, size = 5) {
  const notes = log.filter((k) => !telling(k));
  const tells = log.filter((k) => telling(k));
  if (notes.length < 2 || !tells.length) {
    if (notes.length < 2) return [log.slice()];
    const out = [];
    for (let i = 0; i < notes.length; i += size) out.push(notes.slice(i, i + size));
    return out;
  }
  const want = Math.max(1, Math.ceil(log.length / size));
  const pages = Math.max(1, Math.min(want, Math.floor(notes.length / 2)));
  const split = (arr, n) => {
    const out = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      const len = Math.floor(arr.length / n) + (i < arr.length % n ? 1 : 0);
      out.push(arr.slice(at, at + len));
      at += len;
    }
    return out;
  };
  const noteGroups = split(notes, pages);
  const tellGroups = split(tells, pages);
  const order = new Map(log.map((k, i) => [k, i]));
  return noteGroups.map((ng, i) => {
    const first = ng[0];
    const last = ng[ng.length - 1];
    const middle = [...ng.slice(1, -1), ...tellGroups[i]].sort((a, b) => order.get(a) - order.get(b));
    return [first, ...middle, last];
  });
}

function gateCreature(sim, band) {
  return sim.enemies.find((e) => e.gate === band && !e.dead) || null;
}

/**
 * How far the player has got with a puzzle, as a number that rises with progress (Infinity once
 * done). Roses: valves open in the one right order. A gate: damage done to its creature plus
 * anything the creature reports in e.progress, plus the puzzle's items in hand.
 */
export function progress(sim, puzzle) {
  const w = sim.waves;
  if (puzzle === 'roses') return w.done.roses ? Infinity : rightTurns(w);
  if (puzzle === HATS_PUZZLE) {
    if (w.done.hats || w.done.gates[1]) return Infinity;
    return w.hats && Array.isArray(w.hats.pegs) ? w.hats.pegs.filter((h) => h != null).length : 0;
  }
  const band = PUZZLES.indexOf(puzzle);
  if (band < 1) return 0;
  if (w.done.gates[band - 1]) return Infinity;
  let p = 0;
  const e = gateCreature(sim, band);
  if (e) p += Math.max(0, sim.cfg[e.type].hp - e.hp) + (e.progress || 0);
  if (puzzle === 'rabbit') p += (w.items.garlic > 0 ? 1 : 0) + (w.items.carrot > 0 ? 1 : 0) + (w.log.includes('menu') ? 1 : 0);
  if (puzzle === 'caterpillar') p += { none: 0, empty: 1, full: 2 }[w.items.cup] || 0;
  return p;
}

/** Where the scene's nudge for a puzzle plays, or null when that puzzle has no scene nudge. */
function nudgeAt(sim, puzzle) {
  const w = sim.waves;
  if (puzzle === 'roses') {
    const v = COURT.valves[nextValve(w)];
    return v ? { x: v.x, z: v.z } : null;
  }
  if (puzzle === 'rabbit') {
    const d = deadEnds();
    const want = w.items.garlic < 1 ? 'garlic' : w.items.carrot < 1 ? 'carrot' : null;
    const de = want && d.find((x) => x.band === 1 && x.holds === want);
    return de ? { x: de.x, z: de.z } : { x: MAZE.rabbit.bowl.x, z: MAZE.rabbit.bowl.z };
  }
  if (puzzle === 'bat') {
    // A lantern still on its chain; once all three are spent, the shaft of sunlight is still there.
    const bat = gateCreature(sim, 3);
    const i = MAZE.bat.lanterns.findIndex((l, k) => !(bat && bat.lanterns && bat.lanterns[k] && bat.lanterns[k].spent));
    const at = i >= 0 ? MAZE.bat.lanterns[i] : MAZE.bat.shaft;
    return { x: at.x, z: at.z };
  }
  if (puzzle === 'caterpillar') {
    const de = deadEnds().find((x) => x.holds === 'cup');
    return { x: de.x, z: de.z };
  }
  if (puzzle === HATS_PUZZLE) {
    // The cheapest hat still on the shelf rocks.
    const pegs = (w.hats && w.hats.pegs) || [];
    const shelf = HATS.map((h, i) => i).filter((i) => !pegs.includes(i));
    if (!shelf.length) return null;
    const i = shelf.reduce((a, b) => (HATS[b].pence < HATS[a].pence ? b : a));
    const at = MAZE.hatter.hats[i];
    return { x: at.x, z: at.z, hat: i };
  }
  return null; // the Hatter: no trick beyond cover, timing and aim
}

/**
 * Advances the ladder for the puzzle the player is standing in (by stage, and only while it is
 * not done). Progress resets the timer and the rungs; 90 s without it emits
 * { type: 'nudge', puzzle, x, z }, 210 s writes the plainer line into the log.
 */
export function stepHints(sim, dt, events) {
  const w = sim.waves;
  const stage = stageAt(sim.player.x, sim.player.z);
  const puzzle = puzzleAt(sim, stage);
  if (!puzzle) return;
  const p = progress(sim, puzzle);
  if (p === Infinity) return;
  if (!w.hints[puzzle]) w.hints[puzzle] = { idle: 0, rung: 0, last: 0 };
  const h = w.hints[puzzle];
  // The hats: any hat set or taken back is progress (a row that falls drops the count).
  if (puzzle === HATS_PUZZLE ? p !== h.last : p > h.last) {
    h.last = p;
    h.idle = 0;
    h.rung = 0;
    return;
  }
  h.idle += dt;
  const c = sim.cfg.hints;
  if (h.rung < 1 && h.idle >= c.nudge) {
    h.rung = 1;
    const at = nudgeAt(sim, puzzle);
    if (at) {
      const ev = { type: 'nudge', puzzle, x: at.x, z: at.z };
      if (at.hat != null) ev.hat = at.hat;
      events.push(ev);
    }
  }
  if (h.rung < 2 && h.idle >= c.plain) {
    h.rung = 2;
    addEntry(sim, PLAIN[puzzle], events);
  }
}
