// Dialogue for any speaker but Renfield (who keeps his own stepper in courtiers.js): a
// conversation that advances one line per Speak and then repeats its last, greeting lines said
// once on entry, an escalating warning ladder, timed taunts that never repeat back to back, and
// how long a line stays up. Words are script.js keys (LINES for spoken lines, ENTRIES for the
// log); this file holds only which keys each speaker says, in order. State lives in
// sim.waves.talk, one record per speaker, kept across checkpoints like sim.waves.renfield:
// { at, greeted, logged, next, nextIn, last, dead }.

import { LINES } from './script.js';
import { speak, addEntry } from './journal.js';

// Line timing the design states (A spoken line: 4 s or 0.06 s per character, whichever is
// longer, at most 10 s). Read from cfg (lineTime, linePerChar, lineMax) when it carries them.
const TUNE = Object.freeze({ lineTime: 4, linePerChar: 0.06, lineMax: 10 });

const keys = (stem, n) => Object.freeze(Array.from({ length: n }, (_, i) => `${stem}${i + 1}`));

/**
 * Every speaker this module voices. who: the speak event's speaker (a NAMES key where the
 * speaker has a name; the plot gardeners have none). greet: said once, in order, on entry.
 * talk: one per Speak, the last repeating. warn: the ladder, one per warn() call. taunts: one
 * per taunt() call, never the same twice running. death: said once as the speaker falls.
 * entry/entryAt: the log entry written once the conversation has reached line entryAt.
 * The plot gardeners share one log entry, written when both of their plots have been heard.
 */
export const SPEAKERS = Object.freeze({
  rabbit: Object.freeze({
    who: 'rabbit',
    greet: keys('rabbitGreet', 2),
    talk: keys('rabbitTalk', 5),
    warn: keys('rabbitWarn', 5),
  }),
  hatter: Object.freeze({
    who: 'hatter',
    greet: keys('hatterGreet', 2),
    taunts: keys('hatterTaunt', 5),
    death: 'hatterDeath',
  }),
  hunter: Object.freeze({
    who: 'hunter',
    talk: keys('hunter', 4),
    entry: 'hunter',
    entryAt: 4,
  }),
  carrotGardener: Object.freeze({ who: 'gardener', talk: Object.freeze(['gardenerCarrot']) }),
  garlicGardener: Object.freeze({ who: 'gardener', talk: Object.freeze(['gardenerGarlic']) }),
});

/**
 * The castle's four speakers, on the same steppers. Kept apart from SPEAKERS so the court's
 * approved-text checks keep reading only the court's lines; every function below finds a
 * speaker in either table. armourFirst is the first suit (it only ever greets, once, then comes
 * apart); armour is the second (two threats on waking, a taunt about every twelve seconds, a
 * last line). wife has no name on the plate (script NAMES has no `wife`); her whisper is her
 * warning. raven's three mocks are taunts. hare talks in order; hareRiddle is his line after the
 * warden's first fall, and writes his log entry when it is said.
 */
export const CASTLE_SPEAKERS = Object.freeze({
  armourFirst: Object.freeze({ who: 'armour', greet: Object.freeze(['armourFirst']), warn: Object.freeze(['armourRust1', 'armourRust2']) }), // warn: the rust complaints as it crumbles (#14)
  armour: Object.freeze({
    who: 'armour',
    greet: Object.freeze(['armourThreat1', 'armourThreat2']),
    taunts: keys('armourTaunt', 3),
    death: 'armourLast',
  }),
  wife: Object.freeze({ who: 'wife', warn: Object.freeze(['wifeWhisper']) }),
  raven: Object.freeze({ who: 'raven', taunts: keys('ravenMock', 3) }),
  hare: Object.freeze({ who: 'hare', talk: keys('hare', 3) }),
  hareRiddle: Object.freeze({ who: 'hare', talk: Object.freeze(['hareRiddle']), entry: 'hare', entryAt: 1 }),
});

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The speaker record for id from either table, or undefined. */
function speakerOf(id) {
  if (own(SPEAKERS, id)) return SPEAKERS[id];
  if (own(CASTLE_SPEAKERS, id)) return CASTLE_SPEAKERS[id];
  return undefined;
}

/** The plot gardeners' shared log entry, written once both plots have been heard. */
export const GARDENERS_ENTRY = 'gardeners';

/** Every script.js key this module can say or write, for the approved-text test. */
export function talkKeys() {
  const lines = new Set();
  const entries = new Set([GARDENERS_ENTRY]);
  for (const s of Object.values(SPEAKERS)) {
    for (const list of [s.greet, s.talk, s.warn, s.taunts]) if (list) list.forEach((k) => lines.add(k));
    if (s.death) lines.add(s.death);
    if (s.entry) entries.add(s.entry);
  }
  return { lines: [...lines], entries: [...entries] };
}

/** Every script.js key the castle's four speakers can say or write, for the castle's approved-text test. */
export function castleTalkKeys() {
  const lines = new Set();
  const entries = new Set();
  for (const s of Object.values(CASTLE_SPEAKERS)) {
    for (const list of [s.greet, s.talk, s.warn, s.taunts]) if (list) list.forEach((k) => lines.add(k));
    if (s.death) lines.add(s.death);
    if (s.entry) entries.add(s.entry);
  }
  return { lines: [...lines], entries: [...entries] };
}

/** The speaker at a plot that holds `holds` (a dead end's holds: 'carrot' or 'garlic'). */
export function plotSpeaker(holds) {
  return holds === 'carrot' ? 'carrotGardener' : holds === 'garlic' ? 'garlicGardener' : null;
}

const tune = (cfg, k) => (cfg && cfg[k] != null ? cfg[k] : TUNE[k]);

/** Seconds a line of `text` stays up: lineTime, or linePerChar a character if longer, at most lineMax. */
export function lineSeconds(text, cfg) {
  const n = typeof text === 'string' ? text.length : 0;
  return Math.min(tune(cfg, 'lineMax'), Math.max(tune(cfg, 'lineTime'), n * tune(cfg, 'linePerChar')));
}

/** Seconds the line with script key `key` stays up (lineTime for an unknown key). */
export function keySeconds(key, cfg) {
  const l = Object.prototype.hasOwnProperty.call(LINES, key) ? LINES[key] : null;
  return lineSeconds(l ? l.text : '', cfg);
}

function fresh() {
  return { at: 0, greeted: false, logged: false, next: null, nextIn: 0, last: -1, dead: false };
}

/** The talk record of speaker id, made on first use. */
export function talkState(sim, id) {
  const w = sim.waves;
  if (!w.talk) w.talk = {};
  if (!w.talk[id]) w.talk[id] = fresh();
  return w.talk[id];
}

/**
 * Says one line now: the newest wins and lines never stack (journal.speak), and the line stays
 * up for its length. `then` queues a line after it; a line that interrupts a queued one (a
 * warning or a Speak over a greeting) puts the queued line back after itself, so no greeting
 * line is ever lost.
 */
function say(sim, id, key, events, then = null) {
  const s = speakerOf(id);
  const t = talkState(sim, id);
  speak(sim, s.who, key, events);
  const secs = keySeconds(key, sim.cfg);
  if (sim.waves.line) sim.waves.line.left = secs;
  if (then) t.next = then;
  t.nextIn = t.next ? secs : 0;
}

/** True while the speaker's greeting is unfinished: a greeting line queued or still on screen. */
export function greeting(sim, id) {
  const s = speakerOf(id);
  const w = sim.waves;
  if (!s || !s.greet || !w) return false;
  const t = w.talk && w.talk[id];
  if (t && t.next && s.greet.includes(t.next)) return true;
  const l = w.line;
  return !!(l && l.who === s.who && l.left > 0 && s.greet.includes(l.key));
}

/** Drops every speaker's queued line (trail.js calls it on a checkpoint restore). */
export function hush(sim) {
  const w = sim.waves && sim.waves.talk;
  if (!w) return;
  for (const t of Object.values(w)) {
    t.next = null;
    t.nextIn = 0;
  }
}

/**
 * Plays the speaker's queued line when the current one has had its time. Call every frame it
 * can speak; `still` (the creature is asleep, as after Try again) drops the queue instead.
 */
export function stepSpeaker(sim, id, dt, events, still = false) {
  const t = sim.waves.talk && sim.waves.talk[id];
  if (!t || !t.next) return;
  if (still) {
    t.next = null;
    t.nextIn = 0;
    return;
  }
  t.nextIn -= dt;
  if (t.nextIn > 0) return;
  const s = speakerOf(id);
  const list = s.greet || [];
  const i = list.indexOf(t.next);
  const after = i >= 0 && i + 1 < list.length ? list[i + 1] : null;
  const key = t.next;
  t.next = null; // played now; only the greeting's next line, if any, is queued after it
  say(sim, id, key, events, after);
}

/** The greeting, once per run (kept across checkpoints): the first line now, the rest in turn. False if already greeted. */
export function greet(sim, id, events) {
  const s = speakerOf(id);
  const t = talkState(sim, id);
  if (t.greeted || !s.greet || !s.greet.length) return false;
  t.greeted = true;
  say(sim, id, s.greet[0], events, s.greet[1] || null);
  return true;
}

/**
 * Speak: the conversation's next line, then its last again on every later Speak. Writes the
 * speaker's log entry once the conversation reaches entryAt, and the gardeners' entry once
 * both plots have been heard. Returns the key said, or null.
 */
export function talkTo(sim, id, events) {
  const s = speakerOf(id);
  if (!s || !s.talk || !s.talk.length) return null;
  const t = talkState(sim, id);
  const key = s.talk[Math.min(t.at, s.talk.length - 1)];
  t.at = Math.min(t.at + 1, s.talk.length);
  say(sim, id, key, events);
  if (s.entry && !t.logged && t.at >= s.entryAt) {
    t.logged = true;
    addEntry(sim, s.entry, events);
  }
  if (s.who === 'gardener') {
    const w = sim.waves.talk;
    if (w.carrotGardener && w.carrotGardener.at > 0 && w.garlicGardener && w.garlicGardener.at > 0) addEntry(sim, GARDENERS_ENTRY, events);
  }
  return key;
}

/** Warning number n (0-based) of the speaker's ladder, said now. Returns the key, or null past the top. */
export function warn(sim, id, n, events) {
  const s = speakerOf(id);
  if (!s || !s.warn || n < 0 || n >= s.warn.length) return null;
  say(sim, id, s.warn[n], events);
  return s.warn[n];
}

/** How many rungs the speaker's warning ladder has. */
export function warnings(id) {
  const s = speakerOf(id);
  return s && s.warn ? s.warn.length : 0;
}

/** One taunt now, picked by rng, never the one said last (kept across checkpoints). Returns the key. */
export function taunt(sim, id, rng, events) {
  const s = speakerOf(id);
  if (!s || !s.taunts || !s.taunts.length) return null;
  const t = talkState(sim, id);
  const n = s.taunts.length;
  let i = 0;
  if (n > 1) {
    const free = s.taunts.map((_, k) => k).filter((k) => k !== t.last);
    i = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
  }
  t.last = i;
  say(sim, id, s.taunts[i], events);
  return s.taunts[i];
}

/** The speaker's last line as it falls, once. Returns the key, or null. */
export function deathLine(sim, id, events) {
  const s = speakerOf(id);
  if (!s || !s.death) return null;
  const t = talkState(sim, id);
  if (t.dead) return null;
  t.dead = true;
  say(sim, id, s.death, events);
  return s.death;
}
