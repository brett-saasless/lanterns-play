// The DOM for words in the Rose Court: story cards, the warden's log, Renfield's spoken line, the
// item tray, the pencil tick and the interact prompt text. Every word comes from logic/script.js
// by key; this file lays it out and never retypes it. It holds no game state: the sim is the
// source of truth and these are read from it each frame (the card and the open page aside).

import { CARDS, LINES, ENTRIES, NAMES, READS, COPY } from '../logic/script.js';
import { interactPrompt } from '../logic/prompt.js';
import { COURT_CONFIG } from '../logic/courtconfig.js';
import { pagesOf } from '../logic/journal.js';

const $ = (id) => document.getElementById(id);
// A node the page does not (yet) have: inert, so a missing element never throws mid-frame.
const inert = () => ({ classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, textContent: '' });
const $$ = (id) => $(id) || inert();
export const SPEECH_COLS = 44; // the speech plate: up to four lines of this many characters
export const SPEECH_LINES = 4;
export const RIDDLE_LINES = 5; // the March Hare's riddle (LINES.hareRiddle) alone may use a fifth
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Greedy word wrap at cols, for checking that a line fits the plate (the browser wraps the real one). */
export function wrapLines(text, cols = SPEECH_COLS) {
  const out = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > cols) { out.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}
const TICK_MS = 2000; // a new log entry is marked by the tick for this long
const GHOST_MS = 2500; // the two empty outlines after E on the bowl with nothing to put in

// Which story card's found document sits beside which log entry (its log half).
const DOCS = Object.freeze([['fromCave', 'arrive'], ['toForest', 'arch'], ['toCastle', 'end'], ['dawn', 'dawn']]);

// Item icons: single-colour line drawings, drawn in markup. Static strings, never data.
const SVG = (inner, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${inner}</svg>`;
const ICON = {
  garlic: SVG('<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-5 4-7 5-10z"/><path d="M12 18v-9"/>'),
  carrot: SVG('<path d="M5 6c5-2 13 6 13 13-7 0-13-8-13-13z"/><path d="M5 6L3 3M5 6L2 6M5 6L3 9"/>'),
  cupEmpty: SVG('<path d="M5 5h14l-2 15H7z"/>'),
  cupFull: SVG('<path class="full" d="M6 11h12l-1 9H7z"/><path d="M5 5h14l-2 15H7z"/>'),
  stake: SVG('<path d="M12 2l3 5v15h-6V7z"/>'),
  ticket: SVG('<path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z"/><path d="M14 7v12" stroke-dasharray="2 2"/>'),
};

/**
 * opts (all optional, for tests): words (lines, names, reads, entries) and now(), the clock in ms.
 * Every word reaches the page by textContent (security A5): never markup, whatever it contains.
 */
export function createPages(opts = {}) {
  const words = { lines: LINES, names: NAMES, reads: READS, entries: ENTRIES, ...(opts.words || {}) };
  const el = {
    clue: $$('clue-card'), clueBody: $$('clue-body'), logged: $$('clue-logged'),
    card: $('card'), cardlog: $('cardlog'), carddoc: $('carddoc'),
    logbook: $('logbook'), logdoc: $('logdoc'), logentries: $('logentries'), logpage: $('logpage'),
    speech: $('speech'), who: $('speechwho'), said: $('speechsaid'),
    tray: $('tray'), tick: $('tick'),
  };
  let onDone = null; // the open story card's callback
  let spread = 0; // the log page showing
  let spreads = 1;
  let lineKey = null;
  let traySig = '';
  let tickUntil = 0;
  let ghostUntil = 0;

  let clueOpen = false;
  let loggedUntil = 0;
  const now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : 0));

  // ---- the clue card ----------------------------------------------------------------------

  /**
   * A parchment clue card (R13) for a `read` key: the found words (READS) or else the log entry
   * of that key. The game stays paused while it is up; a click calls onDone, and main.js binds
   * Enter, E and Space the same way. close() (or the click) then shows "added to your log" for
   * COURT_CONFIG.loggedTime. Returns false for a key with no words.
   */
  function clue(key, done) {
    const text = has(words.reads, key) ? words.reads[key] : has(words.entries, key) ? words.entries[key].text : null;
    if (typeof text !== 'string') return false;
    onDone = typeof done === 'function' ? done : null;
    el.clueBody.textContent = text;
    el.logged.classList.remove('on');
    loggedUntil = 0;
    el.clue.classList.add('on');
    clueOpen = true;
    return true;
  }

  el.clue.addEventListener('click', () => { if (onDone) onDone(); });

  // ---- story cards ------------------------------------------------------------------------

  function fillDoc(node, doc, base) {
    node.className = doc ? `${base} doc ${doc.kind}` : base;
    node.textContent = doc ? doc.text : '';
  }

  /**
   * Shows a story card by key ('arrive', 'arch' or 'end'): the log entry on the left, the found
   * document on the right. Returns false for a key with no card. onDone() runs when the player
   * turns it away (a click on it; main.js binds Enter, E and Space); the card stays up until
   * close() is called, so the caller can keep it when it cannot resume play yet.
   */
  function card(key, done) {
    const c = Object.prototype.hasOwnProperty.call(CARDS, key) ? CARDS[key] : null;
    if (!c || !c.document) return false;
    onDone = typeof done === 'function' ? done : null;
    el.cardlog.textContent = c.log;
    fillDoc(el.carddoc, c.document, 'leaf');
    el.card.classList.add('on');
    return true;
  }

  el.card.addEventListener('click', () => { if (onDone) onDone(); });

  // ---- the log ----------------------------------------------------------------------------

  function renderLog(sim) {
    const held = sim.waves.log;
    const pages = pagesOf(held);
    spreads = Math.max(1, pages.length);
    spread = Math.max(0, Math.min(spread, spreads - 1));
    const keys = pages[spread] || [];
    // Left leaf: the chapter's documents whose log half is on this page.
    const docKey = DOCS.find(([entry]) => keys.includes(entry));
    fillDoc(el.logdoc, docKey ? CARDS[docKey[1]].document : null, 'leaf');
    // Right leaf: the entries in the order found. Every entry is set the same way.
    el.logentries.replaceChildren();
    for (const k of keys) {
      const p = document.createElement('p');
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(held.indexOf(k) + 1).padStart(2, '0');
      p.append(no, ENTRIES[k].text);
      el.logentries.append(p);
    }
    el.logpage.textContent = `${spread + 1} / ${spreads}`;
  }

  /** Opens (true) or closes (false) the log. Opens on the newest page. */
  function log(sim, open) {
    if (open) {
      spread = Number.MAX_SAFE_INTEGER; // clamped to the last page by renderLog
      renderLog(sim);
      el.logbook.classList.add('on');
    } else {
      el.logbook.classList.remove('on');
    }
  }

  /** Turns the open log by dir (+1 or -1). Returns true when the page changed. */
  function turn(sim, dir) {
    if (!el.logbook.classList.contains('on')) return false;
    const to = Math.max(0, Math.min(spreads - 1, spread + dir));
    if (to === spread) return false;
    spread = to;
    renderLog(sim);
    return true;
  }

  /** Hides the card and the log (the callback is dropped). */
  function close() {
    onDone = null;
    if (clueOpen) {
      clueOpen = false;
      el.clue.classList.remove('on');
      el.logged.textContent = COPY.logged;
      el.logged.classList.add('on');
      loggedUntil = now() + COURT_CONFIG.loggedTime * 1000;
      tickUntil = loggedUntil; // the pencil tick lights beside it
    }
    el.card.classList.remove('on');
    el.logbook.classList.remove('on');
  }

  // ---- the spoken line --------------------------------------------------------------------

  /** Renfield's current line (sim.waves.line), bottom centre; nothing when there is none. */
  function line(sim) {
    const l = sim.waves && sim.waves.line;
    const key = l && has(words.lines, l.key) ? l.key : null;
    if (key === lineKey) return;
    lineKey = key;
    if (!key) {
      el.speech.classList.remove('on');
      return;
    }
    const name = has(words.names, l.who) ? words.names[l.who] : '';
    el.who.textContent = name; // a speaker with no name entry shows the line alone
    if (el.who.style) el.who.style.display = name ? '' : 'none';
    el.said.textContent = words.lines[key].text;
    el.speech.classList.add('on');
  }

  // ---- the item tray and the tick ---------------------------------------------------------

  function slots(items, ghost) {
    const out = [];
    if (items.garlic > 0) out.push({ id: 'garlic', icon: ICON.garlic, n: items.garlic });
    else if (ghost) out.push({ id: 'garlic', icon: ICON.garlic, ghost: true });
    if (items.carrot > 0) out.push({ id: 'carrot', icon: ICON.carrot, n: items.carrot });
    else if (ghost) out.push({ id: 'carrot', icon: ICON.carrot, ghost: true });
    if (items.cup === 'empty') out.push({ id: 'cupEmpty', icon: ICON.cupEmpty });
    else if (items.cup === 'full') out.push({ id: 'cupFull', icon: ICON.cupFull });
    if (items.stakes > 0) out.push({ id: 'stake', icon: ICON.stake, n: items.stakes });
    if (items.ticket) out.push({ id: 'ticket', icon: ICON.ticket });
    return out.slice(0, 4);
  }

  /** The item tray above the health plate: absent (not empty) until something is found. Also runs the tick. */
  function tray(sim) {
    const t = now();
    const items = sim.waves && sim.waves.items;
    const list = items ? slots(items, t < ghostUntil) : [];
    const sig = list.map((s) => `${s.id}${s.n || ''}${s.ghost ? 'g' : ''}`).join('|');
    if (sig !== traySig) {
      traySig = sig;
      el.tray.replaceChildren();
      for (const s of list) {
        const slot = document.createElement('span');
        slot.className = s.ghost ? 'slot ghost' : 'slot';
        slot.innerHTML = s.icon; // a static string from ICON above
        if (s.n > 1) {
          const b = document.createElement('b');
          b.textContent = String(s.n);
          slot.append(b);
        }
        el.tray.append(slot);
      }
      el.tray.classList.toggle('on', list.length > 0);
    }
    el.tick.classList.toggle('on', t < tickUntil);
    if (loggedUntil && t >= loggedUntil) { loggedUntil = 0; el.logged.classList.remove('on'); }
  }

  /** The interact prompt for what E would act on: "E  Turn", or just the words with the hand button; '' for none. */
  function prompt(sim, touch = false) {
    return interactPrompt(sim.waves && sim.waves.focus, touch);
  }

  /** The events pages.js reacts to: a new entry (the tick) and a refused bowl (two outlines). */
  function onEvent(ev) {
    if (ev.type === 'logEntry') tickUntil = now() + TICK_MS;
    else if (ev.type === 'itemUse' && ev.refused) ghostUntil = now() + GHOST_MS;
  }

  /** Back to nothing shown (a new run, back to title). */
  function reset() {
    clueOpen = false; // a new run shows no "added to your log"
    loggedUntil = 0;
    el.clue.classList.remove('on');
    el.logged.classList.remove('on');
    close();
    lineKey = null;
    traySig = '';
    tickUntil = 0;
    ghostUntil = 0;
    spread = 0;
    el.speech.classList.remove('on');
    el.tray.replaceChildren();
    el.tray.classList.remove('on');
    el.tick.classList.remove('on');
  }

  return { card, clue, log, turn, close, line, tray, prompt, onEvent, reset };
}
