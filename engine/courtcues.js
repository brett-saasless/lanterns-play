// Synthesis for the Rose Court and the wood: a cue for each of the level's events, and the bed
// that changes with depth (air and birds, owls and far howls, rain). Called only from audio.js,
// which owns the gate.

import { CATALOGUE } from '../logic/sounds.js';
import { COURT, MAZE } from '../logic/courtmap.js';

// Kit contract (read at call time, so audio.js may fill it in at unlock):
//   kit.ctx    AudioContext
//   kit.noise  AudioBuffer of white noise, at least one second long
//   kit.tone   (type, f0, f1, t, dur, peak, attack, dest)                 2 nodes
//   kit.burst  (filterType, freq, q, t, dur, peak, sweepTo, attack, dest)  3 nodes
//   kit.beats  (filterType, freq, q, t, offsets, dur, peak, attack, dest)  3 nodes
//   kit.tell   (ev) => the striking creature's chokeable input, else the cue's route
// A cue is (t, ev) and makes its sound only through kit.tone, kit.burst and kit.beats, so
// audio.js's dry run can time it and nothing is made outside the gate. Each cue is authored to
// its catalogue level and uses at most 8 nodes; no attack is under 2 ms.

/** Stages of the level: the court, the four bands of the wood, the castle approach. */
export const STAGES = 6;

const PAGE_LEVEL = 0.25; // a turned page (no sim event, so no catalogue entry): a world-marker level

// The bed, layer by stage (linear gain inside the ambient bus). Birds, owls and howls are
// one-shot calls on a timer; these are what runs under them.
const BED = {
  air: [0.1, 0.13, 0.09, 0.05, 0.04, 0.05], // a breeze in leaves: brightest where the wood is clipped
  deep: [0, 0.04, 0.22, 0.4, 0.34, 0.26], // wind in old trunks, from the second band on
  drone: [0, 0, 0.03, 0.07, 0.07, 0.04], // two low notes that beat: the dark bands
  rain: [0, 0, 0, 0, 0.38, 0.62], // drizzle in the last band, steady on the approach
  brook: [0, 0, 0, 0, 0.1, 0], // the stream that crosses the fourth band
};
// Seconds between calls, [fixed, random extra]. The court's one bird is exact on purpose.
const WAIT = [[4.2, 0], [0.7, 1.8], [1.8, 3.2], [3.5, 5], [4.5, 5.5], [7, 7]];

const lv = (name) => CATALOGUE[name].level;
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const vary = () => 1 + (Math.random() - 0.5) * 0.08; // pitch within 4 percent, so nothing grates
const word = (v) => (typeof v === 'string' ? v.toLowerCase() : '');
const has = (s, ...parts) => parts.some((p) => s.includes(p));

/** True when a `shot` or `swap` event names the stake crossbow. */
export function isBow(ev) {
  return has(word(ev && ev.weapon), 'bow', 'stake');
}

const slot = (list, i) => (list && Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : null);

/**
 * Where a court event with no coordinates of its own sounds: the water's gulp at the bed end of
 * its rill, a hat at its peg (or back on its shelf place), the fallen row at the middle peg.
 * Returns { x, z }, or null for an event that carries its own place or has none.
 */
export function placeOf(name, ev) {
  if (!ev) return null;
  if (name === 'waterArrive') {
    const fl = slot(COURT.flows, ev.index);
    return fl ? fl.to : null;
  }
  const h = MAZE.hatter;
  if (name === 'hatSet') return slot(h.pegs, ev.peg) || slot(h.hats, ev.hat) || h.pegs[2];
  if (name === 'hatsFall') return h.pegs[2];
  return null;
}

export function createCourtCues(kit) {
  const tone = (...a) => kit.tone(...a);
  const burst = (...a) => kit.burst(...a);
  const beats = (...a) => kit.beats(...a);
  const plop = (t, peak, k = 1) => tone('sine', 420 * k, 160 * k, t, 0.06, peak, 0.003);

  // ---- the level's own events ---------------------------------------------------------------

  const cues = {
    // Stake crossbow: the string's thwack and the prod's knock, then the ratchet of the draw.
    shot(t) {
      const L = lv('shot');
      const k = vary();
      burst('bandpass', 720 * k, 1.6, t, 0.05, L * 0.8, 2400, 0.002);
      tone('triangle', 150 * k, 62, t, 0.13, L * 0.7, 0.003);
      beats('bandpass', 1700 * k, 7, t, [0.55, 0.8, 1.05, 1.3, 1.55, 1.8], 0.018, L * 0.14);
    },
    // The other weapon comes to hand: wood and gut for the crossbow, a steel clack for the gun.
    swap(t, ev) {
      const L = lv('swap');
      if (isBow(ev)) {
        burst('lowpass', 520, 1, t, 0.07, L, 180, 0.004);
        tone('sawtooth', 170, 236, t + 0.05, 0.13, L * 0.3, 0.02);
      } else if (has(word(ev && ev.weapon), 'halberd')) {
        // A long ash haft taken in both hands, and the head settling.
        burst('lowpass', 420, 1, t, 0.1, L, 150, 0.006);
        tone('sine', 640, 615, t + 0.08, 0.3, L * 0.35, 0.004);
      } else if (has(word(ev && ev.weapon), 'cup')) {
        // Tin on a belt buckle.
        tone('sine', 1760, 1735, t, 0.16, L * 0.8, 0.003);
        tone('sine', 2870, 2840, t + 0.02, 0.09, L * 0.35, 0.003);
      } else {
        burst('bandpass', 1500, 3, t, 0.03, L, null, 0.002);
        tone('triangle', 190, 150, t + 0.02, 0.06, L * 0.6, 0.003);
      }
    },

    // A valve opened by hand: the wheel's dry squeal, its rim ringing, and water finding the rill.
    valveTurn(t) {
      const L = lv('valveTurn');
      const k = vary();
      tone('sawtooth', 310 * k, 520 * k, t, 0.32, L * 0.35, 0.03);
      tone('sine', 1180 * k, 1170 * k, t + 0.3, 0.7, L * 0.5, 0.004);
      burst('bandpass', 700, 0.8, t + 0.25, 1.1, L * 0.6, 1900, 0.3);
    },
    // A valve shut by the plumbing: it spins back with a clang that carries across the lawn.
    valveSlam(t) {
      const L = lv('valveSlam');
      const k = vary();
      tone('sine', 432 * k, 428 * k, t, 0.9, L, 0.003);
      tone('sine', 1192 * k, 1184 * k, t, 0.5, L * 0.45, 0.003);
      burst('lowpass', 900, 0.8, t, 0.07, L * 0.7, 240, 0.002);
    },
    // A bed changes colour: water drawn up through the roots, or draining back out of them.
    bedTurn(t, ev) {
      const L = lv('bedTurn');
      const red = !ev || ev.red !== false;
      burst('lowpass', red ? 260 : 900, 1.4, t, 0.9, L, red ? 1100 : 220, 0.25);
      tone('sine', red ? 150 : 330, red ? 330 : 140, t, 0.8, L * 0.4, 0.2);
    },
    // The court wakes: five lacquered necks turn at once, over one low held breath.
    wake(t) {
      const L = lv('wake');
      beats('bandpass', 1900, 8, t, [0, 0.022, 0.05, 0.07, 0.1], 0.016, L);
      tone('sine', 58, 92, t, 1.1, L * 0.7, 0.3);
    },
    // All four beds red: the fountain fills, and one open fifth rings off the stone.
    rosesSolved(t) {
      const L = lv('rosesSolved');
      burst('bandpass', 500, 0.7, t, 2.2, L * 0.7, 2300, 0.7);
      tone('sine', 294, 294, t + 0.5, 1.8, L, 0.01);
      tone('sine', 441, 441, t + 0.5, 1.5, L * 0.6, 0.01);
    },

    // A line starts. There are no voices in this game: the speaker only makes his small noise
    // (Renfield sets a spoon on china; anyone else clicks his tongue twice).
    speak(t, ev) {
      const L = lv('speak');
      const who = word(ev && ev.who);
      if (!who || has(who, 'renfield')) {
        tone('sine', 2350, 2330, t, 0.22, L, 0.003);
        tone('sine', 3530, 3500, t + 0.07, 0.14, L * 0.5, 0.003);
      } else {
        beats('bandpass', 2100, 9, t, [0, 0.16], 0.018, L);
      }
    },
    // The log gains an entry: three strokes of a pencil.
    logEntry(t, ev) {
      const L = lv('logEntry');
      beats('bandpass', 3100, 2.5, t, ev && ev.plain ? [0, 0.1, 0.19, 0.3] : [0, 0.1, 0.19], 0.06, L, 0.012);
    },
    // The scene's hint, where it is: a drop from a wheel, a rat running, a chain, the stream.
    nudge(t, ev) {
      const L = lv('nudge');
      const p = word(ev && ev.puzzle);
      if (has(p, 'rab', 'salad', 'bowl', 'rat')) {
        beats('bandpass', 4200, 6, t, [0, 0.04, 0.085, 0.12, 0.17, 0.2, 0.25], 0.012, L);
        tone('sine', 5200, 4300, t + 0.3, 0.05, L * 0.5, 0.004);
      } else if (has(p, 'bat', 'lantern', 'chain', 'light')) {
        tone('sawtooth', 410, 470, t, 0.5, L * 0.5, 0.08);
        tone('sawtooth', 465, 400, t + 0.6, 0.55, L * 0.5, 0.08);
        tone('sine', 1640, 1630, t + 0.55, 0.3, L * 0.35, 0.004);
      } else if (has(p, 'cat', 'smoke', 'pipe', 'stream', 'cup', 'water')) {
        burst('bandpass', 1300, 2.2, t, 1.6, L, 2100, 0.5);
        plop(t + 0.5, L * 0.5, 1.3);
        plop(t + 1.05, L * 0.45, 0.95);
      } else if (has(p, 'hat', 'pin')) {
        tone('sine', 3900, 3850, t, 0.3, L, 0.003);
        tone('sine', 5870, 5800, t, 0.18, L * 0.4, 0.003);
      } else {
        // The roses: one slow drop from the next wheel, and its small ring.
        plop(t, L, 1.15);
        tone('sine', 1180, 1175, t + 0.03, 0.35, L * 0.4, 0.004);
      }
    },

    // Something is picked up: pulled from earth, lifted off stone, drawn from a stump.
    itemTake(t, ev) {
      const L = lv('itemTake');
      const it = word(ev && ev.item);
      if (has(it, 'garlic', 'carrot')) {
        burst('lowpass', 700, 1, t, 0.11, L, 240, 0.01);
        tone('sine', 170, 95, t + 0.07, 0.07, L * 0.6, 0.004);
      } else if (has(it, 'cup')) {
        tone('sine', 1760, 1740, t, 0.2, L, 0.003);
        tone('sine', 2870, 2850, t, 0.11, L * 0.4, 0.003);
      } else if (has(it, 'bow')) {
        burst('lowpass', 480, 1, t, 0.09, L, 170, 0.004);
        tone('triangle', 210, 150, t, 0.1, L * 0.5, 0.004);
        tone('sawtooth', 180, 250, t + 0.1, 0.14, L * 0.25, 0.02);
      } else if (has(it, 'halberd')) {
        // Lifted off the stone where its guard fell: the head scrapes, then rings once.
        burst('bandpass', 1900, 3, t, 0.12, L * 0.7, 2700, 0.02);
        tone('sine', 655, 630, t + 0.1, 0.4, L, 0.004);
      } else if (has(it, 'stake')) {
        beats('bandpass', 1050, 4, t, [0, 0.07, 0.13], 0.03, L);
        tone('sine', 520, 430, t, 0.05, L * 0.4, 0.003);
      } else {
        tone('sine', 620, 620, t, 0.09, L, 0.004);
        tone('sine', 930, 930, t + 0.08, 0.14, L * 0.8, 0.004);
      }
    },
    // Something is used on the world: the salad tossed, the cup filled, the cup emptied on a coal.
    itemUse(t, ev) {
      const L = lv('itemUse');
      const where = `${word(ev && ev.at)} ${word(ev && ev.item)}`;
      if (has(where, 'bowl', 'salad', 'mix', 'table')) {
        beats('highpass', 2600, 0.7, t, [0, 0.14, 0.3], 0.09, L * 0.7, 0.02);
        tone('sine', 1320, 1310, t + 0.42, 0.3, L, 0.003);
      } else if (has(where, 'pipe', 'douse', 'coal')) {
        burst('lowpass', 1600, 0.8, t, 0.3, L, 500, 0.03);
        plop(t + 0.05, L * 0.5, 0.8);
      } else if (has(where, 'stream', 'fill', 'water', 'cup')) {
        burst('bandpass', 900, 2, t, 0.55, L * 0.8, 2600, 0.08);
        tone('sine', 300, 720, t, 0.5, L * 0.5, 0.05);
        plop(t + 0.5, L * 0.5, 1.2);
      } else {
        burst('bandpass', 1400, 3, t, 0.04, L, null, 0.003);
        tone('sine', 700, 640, t, 0.06, L * 0.5, 0.004);
      }
    },

    // A stake stops: in a body, the ground or a hedge. A worn one rattles along its split.
    stakeLodge(t, ev) {
      const L = lv('stakeLodge');
      const k = vary();
      tone('sine', 150 * k, 70, t, 0.1, L, 0.003);
      burst('bandpass', 950 * k, 3, t, 0.035, L * 0.7, null, 0.002);
      if (ev && ev.worn) beats('bandpass', 2300 * k, 7, t, [0.03, 0.055, 0.075], 0.012, L * 0.4);
    },
    // A stake is pulled: a short wet drag and the pop as it comes free.
    stakePull(t, ev) {
      const L = lv('stakePull');
      const k = vary();
      burst('bandpass', 520 * k, 2, t, 0.14, L * 0.7, 1300, 0.02);
      tone('sine', 190 * k, 330 * k, t + 0.13, 0.05, L, 0.003);
      if (ev && ev.worn) tone('sawtooth', 240 * k, 300 * k, t, 0.12, L * 0.25, 0.02);
    },
    // A worn stake crumbles in the hand: a dry snap and splinters.
    stakeBreak(t) {
      const L = lv('stakeBreak');
      burst('bandpass', 1500, 3, t, 0.03, L, null, 0.002);
      tone('square', 330, 140, t, 0.05, L * 0.4, 0.003);
      beats('bandpass', 2700, 5, t, [0.05, 0.09, 0.15, 0.2, 0.28], 0.014, L * 0.5);
    },

    // A place is passed for the first time: two small notes, a fourth apart, and nothing more.
    checkpoint(t) {
      const L = lv('checkpoint');
      tone('sine', 392, 392, t, 0.7, L, 0.006);
      tone('sine', 523, 523, t + 0.22, 0.9, L * 0.8, 0.006);
    },
    // Put back after a death: a breath drawn in, and the same note the checkpoint left.
    restored(t) {
      const L = lv('restored');
      burst('bandpass', 400, 0.8, t, 0.7, L * 0.6, 1500, 0.5);
      tone('sine', 392, 392, t + 0.6, 0.9, L, 0.01);
    },

    // The mat over the bramble pit gives way: leaves, then the sticks under them.
    pitFall(t) {
      const L = lv('pitFall');
      burst('highpass', 2200, 0.7, t, 0.3, L * 0.7, null, 0.01);
      beats('bandpass', 1300, 4, t, [0.02, 0.07, 0.1, 0.16, 0.24], 0.022, L);
      tone('sine', 120, 60, t + 0.05, 0.2, L * 0.5, 0.01);
    },
    // The one jump scare: after a quarter second of nothing, a single sharp chord, a semitone
    // wrong at both ends, gone before half a second is up. It sits at the top of the ordinary
    // strike range; the silence before it is what gives it force.
    grin: Object.assign((t) => {
      const L = lv('grin');
      tone('sawtooth', 466, 462, t, 0.3, L * 0.34, 0.002);
      tone('sawtooth', 494, 498, t, 0.3, L * 0.28, 0.002);
      tone('square', 932, 921, t, 0.22, L * 0.2, 0.002);
      tone('sine', 1397, 1386, t, 0.16, L * 0.18, 0.002);
    }, { hush: 0.25 }),

    // A creature winds up, each in its own way. Played into its chokeable input.
    strikeTell(t, ev) {
      const L = lv('strikeTell');
      const d = kit.tell(ev);
      const m = word(ev && ev.move);
      if (m === 'halberd') {
        // The guard lifts it: leather creaks and the claw comes up through the air.
        tone('sawtooth', 82, 168, t, 0.6, L * 0.6, 0.08, d);
        burst('bandpass', 480, 1.4, t, 0.6, L, 1500, 0.35, d);
      } else if (m === 'brush') {
        burst('bandpass', 1700, 2, t, 0.28, L, 3600, 0.12, d);
        tone('sine', 310, 600, t, 0.26, L * 0.4, 0.05, d);
      } else if (m === 'lunge') {
        // The Rabbit looks at his watch: it ticks faster.
        beats('bandpass', 2700, 10, t, [0, 0.13, 0.22, 0.28, 0.32], 0.014, L, 0.003, d);
        tone('sine', 210, 520, t + 0.05, 0.3, L * 0.45, 0.06, d);
      } else if (m === 'kick') {
        burst('bandpass', 900, 3, t, 0.3, L, 2100, 0.1, d);
        tone('square', 108, 164, t, 0.28, L * 0.3, 0.05, d);
      } else if (m === 'swoop') {
        // The Bat hisses as its grin flares (R21): breath through teeth, not a voice. Half a second.
        burst('highpass', 3000, 0.7, t, 0.44, L, 5200, 0.1, d);
        burst('bandpass', 1700, 0.8, t, 0.44, L * 0.5, 2600, 0.18, d);
      } else if (m === 'volley') {
        // The Hatter's hand goes to his hatband (R17): pins ticking out of felt, quicker and rising.
        beats('bandpass', 3400, 9, t, [0, 0.14, 0.26, 0.36, 0.44, 0.5], 0.014, L, 0.003, d);
        tone('sine', 900, 2400, t, 0.5, L * 0.35, 0.1, d);
      } else if (m === 'whip') {
        tone('sine', 92, 205, t, 0.7, L, 0.15, d);
        burst('lowpass', 210, 2, t, 0.7, L * 0.5, 540, 0.3, d);
      } else {
        tone('sawtooth', 100, 230, t, 0.35, L * 0.6, 0.04, d);
        burst('bandpass', 600, 1.5, t, 0.35, L, 1700, 0.15, d);
      }
    },
    // It strikes.
    strike(t, ev) {
      const L = lv('strike');
      const k = vary();
      const m = word(ev && ev.move);
      if (m === 'halberd') {
        burst('bandpass', 300 * k, 1.2, t, 0.22, L, 1900, 0.03);
        tone('sine', 96 * k, 44, t + 0.16, 0.2, L * 0.8, 0.004);
        tone('sine', 640 * k, 610 * k, t + 0.16, 0.25, L * 0.35, 0.003);
      } else if (m === 'brush') {
        // A slap of wet bristle: the lightest blow in the level.
        burst('lowpass', 1900 * k, 0.9, t, 0.07, L * 0.75, 480, 0.003);
        tone('sine', 265 * k, 120, t, 0.06, L * 0.4, 0.003);
      } else if (m === 'lunge') {
        burst('bandpass', 520 * k, 1.3, t, 0.14, L * 0.8, 3000, 0.02);
        burst('bandpass', 3400 * k, 6, t + 0.14, 0.02, L, null, 0.002);
        tone('sine', 140 * k, 60, t + 0.14, 0.1, L * 0.5, 0.003);
      } else if (m === 'kick') {
        tone('sine', 122 * k, 50, t, 0.16, L, 0.003);
        burst('lowpass', 800 * k, 0.8, t, 0.06, L * 0.7, null, 0.003);
        burst('bandpass', 2600 * k, 4, t + 0.03, 0.05, L * 0.4, 1500, 0.004);
      } else if (m === 'swoop') {
        burst('bandpass', 420 * k, 1.1, t, 0.3, L * 0.8, 2400, 0.1);
        tone('sine', 1500 * k, 900 * k, t + 0.05, 0.25, L * 0.25, 0.04);
        burst('bandpass', 3000 * k, 7, t + 0.3, 0.018, L, null, 0.002);
      } else if (m === 'whip') {
        burst('bandpass', 300 * k, 1.2, t, 0.3, L * 0.7, 1600, 0.12);
        burst('lowpass', 1200 * k, 0.8, t + 0.3, 0.05, L, 300, 0.003);
        tone('sine', 100 * k, 55, t + 0.3, 0.12, L * 0.6, 0.004);
      } else {
        burst('bandpass', 600 * k, 1.5, t, 0.16, L, 2400, 0.02);
        tone('sine', 110 * k, 50, t + 0.1, 0.14, L * 0.6, 0.004);
      }
    },

    // The Hatter looses a pin: a thin zip through the air.
    pinThrow(t) {
      const L = lv('pinThrow');
      const k = vary();
      tone('sine', 3300 * k, 1700 * k, t, 0.2, L * 0.6, 0.01);
      burst('highpass', 3800, 0.7, t, 0.07, L, null, 0.004);
    },
    // A pin stops in cover or ground: a tick, and the pin singing for a moment.
    pinStick(t) {
      const L = lv('pinStick');
      const k = vary();
      burst('bandpass', 2300 * k, 6, t, 0.016, L, null, 0.002);
      tone('sine', 4150 * k, 4050 * k, t, 0.18, L * 0.45, 0.003);
    },
    // The Bat gains its body (weight arrives all at once) or loses it (it lets go into the air).
    solid(t, ev) {
      const L = lv('solid');
      if (ev && ev.on === false) {
        burst('bandpass', 1400, 1, t, 0.35, L, 4200, 0.06);
        tone('sine', 520, 1300, t, 0.3, L * 0.3, 0.05);
      } else {
        tone('sine', 190, 72, t, 0.18, L, 0.004);
        burst('lowpass', 700, 1, t, 0.09, L * 0.7, 220, 0.004);
        burst('bandpass', 2600, 2, t + 0.02, 0.12, L * 0.3, 900, 0.01);
      }
    },
    // A shot cuts a lantern down: the chain parts, the lantern lands, the oil takes.
    lanternFall(t) {
      const L = lv('lanternFall');
      tone('sine', 2480, 2440, t, 0.14, L * 0.6, 0.002);
      beats('bandpass', 1250, 5, t, [0.28, 0.35, 0.46], 0.04, L);
      burst('lowpass', 300, 1, t + 0.5, 0.6, L * 0.6, 1300, 0.15);
    },
    // The smoke bites, each half second inside it: a short acrid fizz.
    smokeTick(t) {
      const L = lv('smokeTick');
      burst('bandpass', 2600 * vary(), 1.2, t, 0.12, L, 5200, 0.02);
      tone('sine', 300, 210, t, 0.09, L * 0.3, 0.01);
    },
    // The pipe goes out: a long hiss that falls, and the coal's last crack.
    doused(t) {
      const L = lv('doused');
      burst('highpass', 3000, 0.7, t, 1.5, L, 900, 0.012);
      burst('bandpass', 1500, 5, t + 0.12, 0.02, L * 0.6, null, 0.002);
      tone('sine', 240, 90, t, 0.4, L * 0.35, 0.01);
    },
    // The Rabbit takes the salad, with great neatness: fork on china, then small exact bites.
    eats(t) {
      const L = lv('eats');
      tone('sine', 2640, 2620, t, 0.2, L * 0.6, 0.003);
      beats('bandpass', 1500, 3, t, [0.3, 0.62, 0.94, 1.26, 1.58, 1.9, 2.22], 0.05, L, 0.006);
    },

    // ---- the wonderland polish track ----------------------------------------------------------

    // A called figure wakes where it stands (R1), so the ear finds it before it moves: a guard's
    // armour clanks and he barks; a gardener's card body riffles and it yelps.
    wakeOne(t, ev) {
      const L = lv('wakeOne');
      const k = vary();
      if (has(word(ev && ev.enemy), 'guard')) {
        burst('bandpass', 2500 * k, 7, t, 0.03, L * 0.8, null, 0.002);
        tone('sine', 1840 * k, 1800 * k, t, 0.22, L * 0.3, 0.003);
        tone('sawtooth', 230 * k, 150 * k, t + 0.12, 0.15, L * 0.5, 0.012); // an unfiltered saw: half the level carries
      } else {
        beats('highpass', 2800 * k, 0.8, t, [0, 0.03, 0.06, 0.09, 0.12, 0.15], 0.022, L * 0.7, 0.004);
        tone('triangle', 640 * k, 1020 * k, t + 0.14, 0.11, L, 0.012);
        tone('sine', 1300 * k, 1900 * k, t + 0.14, 0.09, L * 0.3, 0.012);
      }
    },
    // The splash stops a figure (R23): a wet slap across lacquer or card, and it sputters.
    stun(t) {
      const L = lv('stun');
      const k = vary();
      burst('lowpass', 1500 * k, 0.9, t, 0.1, L, 380, 0.003);
      beats('bandpass', 950 * k, 3, t, [0.14, 0.24, 0.37], 0.04, L * 0.5, 0.008);
    },
    // The water reaches its bed (R4): the flow stops on one soft gulp as the roots take it.
    waterArrive(t) {
      const L = lv('waterArrive');
      tone('sine', 300, 118, t, 0.16, L, 0.012);
      tone('sine', 176, 262, t + 0.13, 0.13, L * 0.6, 0.02);
      burst('lowpass', 520, 1, t, 0.3, L * 0.5, 180, 0.04);
    },
    // The bloom scene (R3): the garden holds its breath as the eye leaves the warden...
    sceneStart(t) {
      const L = lv('sceneStart');
      burst('bandpass', 420, 0.8, t, 0.7, L * 0.7, 1500, 0.45);
      tone('sine', 196, 196, t, 0.9, L, 0.3);
    },
    // ...and lets it out when the eye comes back.
    sceneEnd(t) {
      const L = lv('sceneEnd');
      burst('bandpass', 1500, 0.8, t, 0.6, L * 0.7, 420, 0.08);
      tone('sine', 196, 147, t, 0.6, L, 0.05);
    },
    // A note, sign, menu or card is taken up to read: its corner flicked square.
    read(t) {
      const L = lv('read');
      burst('bandpass', 1100, 0.9, t, 0.1, L, 2800, 0.02);
      burst('highpass', 5200, 0.7, t + 0.11, 0.025, L * 0.5, null, 0.004);
    },
    // The notice line shows a name: two pencil dots, under the pickup they follow.
    notice(t) {
      const L = lv('notice');
      tone('sine', 1560, 1560, t, 0.07, L, 0.004);
      tone('sine', 2080, 2080, t + 0.07, 0.09, L * 0.7, 0.004);
    },
    // The halberd comes down (R8): it lands with weight, and rings if it met anything.
    swing(t, ev) {
      const L = lv('swing');
      const k = vary();
      const met = !!(ev && ev.hits && ev.hits.length);
      burst('lowpass', 900 * k, 0.8, t, 0.09, L * 0.7, 190, 0.003);
      tone('sine', 88 * k, 38, t, 0.3, L, 0.004);
      tone('sine', 612 * k, 590 * k, t + 0.01, met ? 0.5 : 0.25, L * (met ? 0.32 : 0.14), 0.003);
    },
    // The cup is thrown (R23): the stream in a smaller key, a sheet of water and where it lands.
    splashThrow(t) {
      const L = lv('splashThrow');
      burst('bandpass', 1300, 2, t, 0.34, L, 2500, 0.04);
      plop(t + 0.2, L * 0.5, 1.5);
      plop(t + 0.31, L * 0.4, 1.15);
    },
    // A dead guard's halberd lands beside him: steel on stone, twice, and its ring.
    halberdDrop(t) {
      const L = lv('halberdDrop');
      const k = vary();
      beats('bandpass', 2400 * k, 6, t, [0, 0.15, 0.23], 0.03, L);
      tone('sine', 655 * k, 630 * k, t, 0.55, L * 0.5, 0.003);
      tone('sine', 1318 * k, 1290 * k, t + 0.15, 0.25, L * 0.22, 0.003);
    },
    // A hat goes on a peg (R19): felt over wood. Put back on the shelf it is only set down.
    hatSet(t, ev) {
      const L = lv('hatSet');
      const back = !ev || ev.peg == null;
      burst('lowpass', back ? 420 : 640, 1, t, 0.07, L, 170, 0.006);
      tone('sine', back ? 170 : 250, back ? 120 : 190, t + 0.02, 0.06, L * (back ? 0.4 : 0.7), 0.004);
    },
    // Five in the wrong order: the row lets go and all five drop to the grass.
    hatsFall(t) {
      const L = lv('hatsFall');
      burst('bandpass', 1200, 5, t, 0.03, L * 0.7, null, 0.003);
      beats('lowpass', 480, 1, t, [0.1, 0.17, 0.25, 0.34, 0.46], 0.06, L, 0.006);
      tone('sine', 180, 92, t + 0.1, 0.3, L * 0.4, 0.01);
    },
    // Cheapest to dearest: a catch gives behind the rail, and one small fifth, a little flat.
    hatsSolved(t) {
      const L = lv('hatsSolved');
      burst('bandpass', 1300, 5, t, 0.03, L * 0.7, null, 0.002);
      tone('sine', 392, 392, t + 0.12, 1.3, L, 0.01);
      tone('sine', 583, 583, t + 0.3, 1.1, L * 0.6, 0.01);
    },

    // ---- the shared events, as they sound in this room --------------------------------------

    // A figure comes alive or steps out: a stir of leaves and cloth, no lamp and no gate.
    spawn(t) {
      const L = lv('spawn');
      burst('highpass', 1800, 0.7, t, 0.22, L, null, 0.05);
      tone('sine', 150, 96, t + 0.05, 0.16, L * 0.6, 0.02);
    },
    // Every figure has a tread of its own; one voice each, plus a plop when it crosses water.
    tread(t, ev) {
      const k = 1 + (Math.random() - 0.5) * 0.12; // pitch within 6 percent
      const L = lv('tread') * 10 ** ((-Math.random() * 1.5) / 20); // level within 1.5 dB, never over
      const who = word(ev && ev.enemy);
      if (has(who, 'guard')) {
        // A parade boot, and the braid and buckles after it.
        burst('lowpass', 270 * k, 1.4, t, 0.09, L, 120, 0.005);
        tone('sine', 2900 * k, 2850 * k, t + 0.05, 0.04, L * 0.2, 0.003);
      } else if (has(who, 'garden', 'card')) {
        // Pasteboard: two quick flat pats.
        beats('bandpass', 2300 * k, 2.5, t, [0, 0.06], 0.022, L);
      } else if (has(who, 'rabbit')) {
        beats('lowpass', 420 * k, 1.2, t, [0, 0.07], 0.035, L, 0.005);
      } else if (has(who, 'hatter')) {
        // Bird's claws where boots should be.
        beats('bandpass', 3300 * k, 9, t, [0, 0.035, 0.07], 0.012, L);
        tone('sine', 160 * k, 100, t, 0.05, L * 0.5, 0.004);
      } else if (has(who, 'bat')) {
        burst('lowpass', 520 * k, 1, t, 0.13, L, 190, 0.03);
      } else if (has(who, 'cater', 'grub')) {
        burst('bandpass', 380 * k, 1.6, t, 0.22, L, 230, 0.06);
        tone('sine', 150 * k, 92, t, 0.2, L * 0.3, 0.05);
      } else {
        burst('lowpass', 320 * k, 1.2, t, 0.08, L, 150, 0.006);
      }
      if (ev && ev.wet) plop(t, L * 0.4, k);
    },
    // A figure falls, each as what it is made of.
    kill(t, ev) {
      const L = lv('kill');
      const who = word(ev && ev.enemy);
      if (has(who, 'guard')) {
        // A toy soldier goes over: lacquered wood, then the halberd on the stone.
        beats('bandpass', 760, 4, t, [0, 0.09, 0.2], 0.05, L);
        tone('sine', 104, 48, t + 0.2, 0.24, L * 0.8, 0.004);
        tone('sine', 655, 630, t + 0.42, 0.5, L * 0.4, 0.003);
      } else if (has(who, 'garden', 'card')) {
        // A card folds, and its brush lands beside it.
        burst('highpass', 2000, 0.7, t, 0.16, L, null, 0.01);
        burst('bandpass', 1100, 5, t + 0.26, 0.03, L * 0.6, null, 0.003);
        tone('sine', 300, 150, t, 0.1, L * 0.4, 0.004);
      } else if (has(who, 'rabbit')) {
        // He folds onto the cloth; a plate moves; the watch goes on a moment and stops.
        burst('lowpass', 380, 1, t, 0.14, L, 140, 0.01);
        tone('sine', 1980, 1960, t + 0.12, 0.3, L * 0.4, 0.003);
        beats('bandpass', 2700, 10, t, [0.5, 0.8, 1.15], 0.014, L * 0.35);
      } else if (has(who, 'hatter')) {
        // Down, and the pins out of his hatband after him.
        tone('sine', 130, 52, t, 0.22, L, 0.004);
        burst('lowpass', 700, 1, t, 0.1, L * 0.7, 200, 0.004);
        beats('bandpass', 4200, 9, t, [0.16, 0.21, 0.25, 0.32, 0.4, 0.52], 0.012, L * 0.4);
      } else if (has(who, 'bat')) {
        // The grin lets go: the body it had falls out of the air.
        burst('bandpass', 2400, 1, t, 0.45, L * 0.7, 380, 0.03);
        tone('sine', 900, 180, t, 0.4, L * 0.5, 0.01);
        tone('sine', 120, 50, t + 0.42, 0.18, L, 0.004);
      } else if (has(who, 'cater', 'grub')) {
        // A long soft sag off the toadstool.
        burst('bandpass', 600, 0.8, t, 1.1, L, 190, 0.1);
        tone('sine', 170, 62, t, 1.0, L * 0.6, 0.08);
      } else {
        burst('lowpass', 700, 1.2, t, 0.16, L, 180, 0.004);
        tone('sine', 170, 55, t + 0.02, 0.22, L, 0.004);
      }
    },
    // A gate in the wood opens when its keeper is gone: a latch lifts, old hinges, it rests.
    gateOpen(t) {
      const L = lv('gateOpen');
      burst('bandpass', 1300, 5, t, 0.03, L * 0.8, null, 0.002);
      tone('sawtooth', 96, 150, t + 0.08, 0.9, L * 0.5, 0.15);
      tone('sine', 78, 50, t + 1.05, 0.25, L, 0.006);
    },
    // A place is named: one bell, lower the deeper in.
    waveStart(t, ev) {
      const L = lv('waveStart');
      const i = ev && ev.stage >= 0 ? ev.stage : ev && ev.wave >= 1 ? ev.wave - 1 : 0;
      const base = 330 * 0.94 ** Math.min(STAGES - 1, i);
      tone('sine', base, base, t, 1.4, L * 0.6, 0.006);
      tone('sine', base * 2.76, base * 2.76, t, 0.8, L * 0.24, 0.006);
    },
    // The approach is reached: two bells and a third that does not resolve. The house is not open.
    won(t) {
      const L = lv('won');
      tone('sine', 262, 262, t, 2.0, L * 0.8, 0.006);
      tone('sine', 392, 392, t + 0.6, 2.2, L * 0.7, 0.006);
      tone('sine', 370, 370, t + 1.3, 2.6, L, 0.006);
      tone('sine', 1021, 1021, t + 1.3, 1.4, L * 0.3, 0.006);
    },
  };

  // A page turned, or a card or the log opened or shut. 6 nodes.
  function page(t) {
    const L = PAGE_LEVEL;
    burst('bandpass', 900, 0.9, t, 0.16, L, 2600, 0.04);
    burst('highpass', 4800, 0.7, t + 0.15, 0.03, L * 0.5, null, 0.004);
    return 0.2;
  }

  // ---- the bed --------------------------------------------------------------------------------
  // Built once (at unlock) and left running for the life of the context, as the yard's and the
  // cave's beds are; audio.js fades the whole of it with the room. Calls are one-shots.

  let layers = null; // { air, deep, drone, rain, brook }: one gain each
  let perches = null; // three fixed places in the stereo field a call can come from
  let far = null; // a lowpass: a howl is a long way off
  let stage = 0;
  let rainLeft = 1; // #28: how much of the rain is still falling (logic/weather.js), 1 before the Caterpillar's gate
  const level = (k) => BED[k][stage] * (k === 'rain' ? rainLeft : 1);

  /** Builds the running layers into `dest` (a GainNode). Does nothing a second time. */
  function start(dest) {
    const ctx = kit.ctx;
    if (!ctx || !kit.noise || !dest || layers) return;
    const gain = (v, to) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(to);
      return g;
    };
    const filter = (type, hz, q, to) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      if (q) f.Q.value = q;
      f.connect(to);
      return f;
    };
    const sway = (rate, depth, param) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
    };
    const made = {};
    for (const k of Object.keys(BED)) made[k] = gain(level(k), dest);
    const src = ctx.createBufferSource();
    src.buffer = kit.noise;
    src.loop = true;

    // Air: a breeze through leaves, opening and closing slowly.
    const air = filter('bandpass', 1500, 0.5, made.air);
    sway(0.11, 600, air.frequency);
    src.connect(air);
    // Deep: wind in old trunks.
    const deep = filter('lowpass', 300, 0.7, made.deep);
    sway(0.07, 150, deep.frequency);
    src.connect(deep);
    // Drone: two low notes an uneven step apart, through a lowpass so only their beating is left.
    const droneLp = filter('lowpass', 420, 0.5, made.drone);
    for (const hz of [98, 103.6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      o.connect(droneLp);
      o.start();
    }
    // Rain: a band of hiss that thickens and thins.
    const rainLp = filter('lowpass', 8500, 0.5, made.rain);
    const rainHp = filter('highpass', 1900, 0.5, rainLp);
    sway(0.23, 500, rainHp.frequency);
    src.connect(rainHp);
    // Brook: a narrow band that wanders, for the stream across the fourth band.
    const brook = filter('bandpass', 1300, 3.5, made.brook);
    sway(1.7, 420, brook.frequency);
    src.connect(brook);
    src.start();

    perches = [-0.7, 0.15, 0.75].map((p) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p;
      pan.connect(dest);
      return pan;
    });
    far = filter('lowpass', 1100, 0.5, perches[0]);
    layers = made;
  }

  /** Crossfades the layers to a stage (0 the court, 1 to 4 the bands, 5 the approach). */
  function setStage(index, t, tc = 1.5) {
    stage = index >= 0 && index < STAGES ? index | 0 : index >= STAGES ? STAGES - 1 : 0;
    if (!layers) return;
    for (const k of Object.keys(BED)) layers[k].gain.setTargetAtTime(level(k), t, tc);
  }

  /** #28: the rain thins to `left` (0 to 1) as the sky clears; called each frame, acts on a change. */
  function setRain(left, t) {
    const k = Math.max(0, Math.min(1, Number.isFinite(left) ? left : 1));
    if (k === rainLeft || (Math.abs(k - rainLeft) < 0.01 && k > 0 && k < 1)) return;
    rainLeft = k;
    if (layers) layers.rain.gain.setTargetAtTime(level('rain'), t, 0.5);
  }

  /** Seconds until the next call at the current stage. */
  function wait() {
    const w = WAIT[stage];
    return w[0] + Math.random() * w[1];
  }

  // The court's bird: the same four notes, the same length, from the same place, every time.
  function exactBird(t, peak, dest) {
    tone('sine', 2640, 3140, t, 0.09, peak, 0.008, dest);
    tone('sine', 3140, 2640, t + 0.16, 0.09, peak, 0.008, dest);
    tone('sine', 2640, 3140, t + 0.32, 0.09, peak, 0.008, dest);
    tone('sine', 3960, 3520, t + 0.52, 0.2, peak * 0.9, 0.008, dest);
  }

  function bird(t, peak, dest) {
    const f = rnd(2300, 4200);
    const kind = Math.random();
    if (kind < 0.4) {
      // A trill of quick rising chirps.
      const gap = rnd(0.06, 0.09);
      for (let i = 0; i < 4; i++) tone('sine', f, f * 1.25, t + i * gap, 0.045, peak, 0.006, dest);
    } else if (kind < 0.75) {
      // A two-note whistle, falling.
      tone('sine', f * 0.7, f * 0.71, t, 0.16, peak, 0.02, dest);
      tone('sine', f * 0.56, f * 0.55, t + 0.22, 0.24, peak * 0.9, 0.02, dest);
    } else {
      // A warble.
      tone('sine', f, f * 1.19, t, 0.1, peak, 0.01, dest);
      tone('sine', f * 1.19, f * 0.94, t + 0.12, 0.1, peak, 0.01, dest);
      tone('sine', f * 0.94, f * 1.1, t + 0.25, 0.14, peak * 0.8, 0.01, dest);
    }
  }

  function owl(t, peak, dest) {
    const f = rnd(340, 420);
    const at = Math.random() < 0.5 ? [0, 0.5, 0.78] : [0, 0.34, 0.9, 1.24];
    at.forEach((off, i) => {
      const long = i === at.length - 1;
      tone('sine', f, f * 0.93, t + off, long ? 0.45 : 0.2, peak * (long ? 1 : 0.8), 0.05, dest);
    });
  }

  function howl(t, peak, dest) {
    const f = rnd(290, 350);
    tone('triangle', f, f * 1.5, t, 0.7, peak * 0.8, 0.25, dest);
    tone('triangle', f * 1.5, f * 1.08, t + 0.8, 1.6, peak, 0.15, dest);
    if (Math.random() < 0.4) {
      // A second, farther one answers under it.
      tone('sine', f * 1.19, f * 1.7, t + 1.3, 0.7, peak * 0.4, 0.3, dest);
      tone('sine', f * 1.7, f * 1.26, t + 2.1, 1.4, peak * 0.45, 0.15, dest);
    }
  }

  function twig(t, peak, dest) {
    burst('bandpass', rnd(1500, 2400), 4, t, 0.02, peak, null, 0.002, dest);
    burst('bandpass', rnd(900, 1300), 3, t + rnd(0.05, 0.12), 0.03, peak * 0.6, null, 0.003, dest);
  }

  /** One call for the current stage, at most 8 nodes, into the bed. audio.js gates and times it. */
  function call(t) {
    if (!layers) return;
    const perch = perches[(Math.random() * perches.length) | 0];
    const r = Math.random();
    if (stage === 0) exactBird(t, 0.3, perches[2]);
    else if (stage === 1) {
      if (r < 0.12) exactBird(t, 0.12, perches[2]); // still at it, behind you
      else bird(t, rnd(0.2, 0.36), perch);
    } else if (stage === 2) {
      if (r < 0.3) owl(t, 0.28, perch);
      else bird(t, rnd(0.1, 0.2), perch);
    } else if (stage === 3) {
      if (r < 0.5) owl(t, 0.38, perch);
      else if (r < 0.85) howl(t, 0.42, far);
      else twig(t, 0.3, perch);
    } else if (stage === 4) {
      if (r < 0.4) owl(t, 0.26, perch);
      else howl(t, 0.4, far);
    } else howl(t, 0.26, far);
  }

  return { cues, page, bed: { start, setStage, setRain, wait, call } };
}
