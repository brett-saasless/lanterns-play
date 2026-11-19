// Synthesis for the castle: a cue for each of the keep's new events, the armour's and the wife's
// own voices, and the bed that changes by stage (the snakes hissing in the pit, heard on the
// bridge and the forecourt; the hush of stone rooms; a low drone that deepens toward the Count).
// Called only from audio.js, which owns the gate.
// The ghost makes no sound; the shades howl once as they escape (owner Q12); the Count's scream is one sound effect (noise and
// sliding saws), never a voice.

import { CATALOGUE } from '../logic/sounds.js';
import { HISS, SNAKES, hissPattern, hissEnvelope } from '../logic/hiss.js';

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

/** Stages of the castle: the bridge and forecourt, then one per checkpoint passed. */
export const KEEP_STAGES = 7;

// The bed, layer by stage (linear gain inside the ambient bus): the bridge and forecourt, the
// hall, the tea room, the gallery, the Knight's Walk and stair, the upper rooms, the Count's room.
// Owner, 2026-11-18: no wind on the bridge or the forecourt (it was the loudest thing there and did
// not read as wind); the snakes' hiss (below, hissLevel) is what is heard outside. Indoors the wind
// is the faint draught it was.
export const BED = {
  wind: [0, 0.12, 0.05, 0.03, 0.06, 0.04, 0.03], // a draught through the house; none outside
  hush: [0.05, 0.14, 0.15, 0.2, 0.22, 0.17, 0.19], // the air of a stone room
  drone: [0, 0.01, 0.03, 0.05, 0.06, 0.08, 0.18], // two low notes that beat, thicker toward the Count
};
// Seconds between calls, [fixed, random extra].
const WAIT = [[6, 8], [9, 10], [8, 9], [6, 8], [7, 9], [6, 8], [10, 12]];

const lv = (name) => CATALOGUE[name].level;
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const vary = () => 1 + (Math.random() - 0.5) * 0.08; // pitch within 4 percent, so nothing grates
const word = (v) => (typeof v === 'string' ? v.toLowerCase() : '');

// The strike of a board piece, by its weight (a pawn least, the queen most).
const WEIGHT = { pawn: 0.55, knight: 0.75, bishop: 0.75, rook: 0.9, queen: 1, king: 0.8 };

export function createKeepCues(kit) {
  const tone = (...a) => kit.tone(...a);
  const burst = (...a) => kit.burst(...a);
  const beats = (...a) => kit.beats(...a);

  // The suit that last came apart (suitFalls or kill, whichever came first) and when: the other
  // one, within 3 s for the same id, adds nothing.
  const fallen = { id: null, at: -9 };
  const nowOf = () => (kit.ctx ? kit.ctx.currentTime : 0);
  const dup = (ev) => !!ev && ev.id != null && fallen.id === ev.id && nowOf() - fallen.at < 3;
  const note = (ev) => { fallen.id = ev ? ev.id : null; fallen.at = nowOf(); };

  // Issue #20: the triumph's swell, a rising open fifth that blooms into a major third as THE END
  // comes up (TRIUMPH_STAGES 'end', 4 s in). Three tones, 6 nodes.
  function triumphSwell(t, L) {
    tone('sine', 196, 262, t, 7.5, L * 0.6, 1.6);
    tone('triangle', 294, 392, t + 0.6, 6.9, L * 0.45, 1.4);
    tone('sine', 330, 330, t + 4, 4, L * 0.7, 0.25);
  }

  const cues = {
    // ---- the pit, the forecourt and the hall -------------------------------------------------

    // The deck gives way, or the warden steps off it: a short drop, then dry scrabbling in the pit.
    pitFall(t) {
      const L = lv('pitFall');
      tone('sine', 130, 50, t, 0.22, L * 0.8, 0.006);
      burst('lowpass', 700, 0.9, t, 0.18, L * 0.7, 180, 0.004);
      beats('bandpass', 2100, 3, t + 0.15, [0, 0.07, 0.15, 0.26], 0.04, L * 0.35);
    },
    // A snake: breath through teeth and the snap after it.
    snakeBite(t) {
      const L = lv('snakeBite');
      const k = vary();
      burst('highpass', 4200 * k, 0.7, t, 0.28, L * 0.6, 2600, 0.02);
      burst('bandpass', 2400 * k, 5, t + 0.26, 0.025, L, null, 0.002);
      tone('sine', 220 * k, 120, t + 0.26, 0.07, L * 0.4, 0.003);
    },
    // The first suit begins to come apart (#14): a long dry creak of rust and a few loose plates ticking down.
    suitCrumbles(t) {
      const L = lv('suitCrumbles');
      const k = vary();
      tone('sawtooth', 150 * k, 96 * k, t, 0.7, L * 0.25, 0.1);
      beats('bandpass', 2300 * k, 5, t + 0.2, [0, 0.9, 1.7, 2.9, 3.6, 4.8], 0.03, L * 0.5);
    },
    // The first suit comes apart: a rattle of plate down a stair, a long ring, and the helm last.
    suitFalls(t, ev) {
      const L = lv('suitFalls');
      if (dup(ev)) return; // its kill came first: that was the sound of it
      if (t > 0) note(ev);
      const k = vary();
      beats('bandpass', 1500 * k, 4, t, [0, 0.07, 0.13, 0.22, 0.3, 0.44, 0.58], 0.05, L * 0.8);
      tone('sine', 84 * k, 40, t + 0.05, 0.45, L, 0.004);
      tone('sine', 560 * k, 520 * k, t + 0.6, 0.8, L * 0.35, 0.003);
    },
    // The wife stirs: a breath drawn that comes from the wrong side of the room.
    wifeStir(t) {
      const L = lv('wifeStir');
      burst('bandpass', 1100, 0.9, t, 0.9, L, 500, 0.4);
      tone('sine', 188, 176, t, 0.9, L * 0.25, 0.35);
    },
    // She is driven off: the breath goes out of her, high and thin, and the cold with it.
    wifeGone(t) {
      const L = lv('wifeGone');
      burst('highpass', 2600, 0.7, t, 0.8, L, 700, 0.05);
      tone('sine', 220, 110, t, 0.7, L * 0.3, 0.04);
    },
    // The braid is raised: dry cloves rattling on their twine.
    garlicUp(t) {
      const L = lv('garlicUp');
      beats('bandpass', 2500, 1.2, t, [0, 0.05, 0.09, 0.16], 0.045, L * 0.8, 0.006);
      tone('sine', 460, 640, t, 0.14, L * 0.3, 0.02);
    },
    // ---- the wife who comes back (#10): her two sounds, on her own strip ---------------------
    // Driven back: a hiss that falls away from the warden as she goes into the stone.
    wifeDriven(t) {
      const L = lv('wifeDriven');
      burst('bandpass', 1800, 0.8, t, 0.7, L, 420, 0.02);
      tone('sine', 300, 140, t, 0.6, L * 0.25, 0.03);
    },
    // Coming back: a thin keen that rises and wavers, sounded every nearEvery seconds from where
    // she is, so it grows and turns as she closes from behind, above or below.
    wifeNear(t) {
      const L = lv('wifeNear');
      const k = vary();
      tone('sine', 620 * k, 880 * k, t, 0.55, L * 0.6, 0.12);
      tone('triangle', 931 * k, 1240 * k, t + 0.04, 0.5, L * 0.25, 0.14);
      burst('bandpass', 1500 * k, 2.5, t, 0.55, L * 0.35, 2400, 0.1);
    },

    // ---- the tea room ------------------------------------------------------------------------

    // The werewolf's arm drags out of the canvas: claws along stone, and a rising low growl of
    // wood. It is a tell, so it rises toward the blow.
    clawTell(t) {
      const L = lv('clawTell');
      burst('bandpass', 700, 1.4, t, 0.38, L, 2300, 0.2);
      tone('sawtooth', 88, 190, t, 0.38, L * 0.35, 0.1);
    },
    // The claw comes across: air, then the blow.
    claw(t) {
      const L = lv('claw');
      const k = vary();
      burst('bandpass', 420 * k, 1.2, t, 0.13, L * 0.7, 2600, 0.02);
      tone('sine', 104 * k, 46, t + 0.1, 0.18, L, 0.004);
      burst('bandpass', 3100 * k, 6, t + 0.1, 0.03, L * 0.5, null, 0.002);
    },
    // A clock is set. A right one answers with a click and a small ring, and then keeps
    // ticking (audio.js holds that loop, one per clock, for as long as it is right); a wrong one
    // gives a dead click and nothing else.
    clockSet(t, ev) {
      const L = lv('clockSet');
      if (ev && ev.right === true) {
        burst('bandpass', 2700, 9, t, 0.03, L, null, 0.002);
        tone('sine', 1560, 1550, t, 0.5, L * 0.35, 0.003);
      } else {
        burst('lowpass', 520, 1, t, 0.07, L * 0.7, 200, 0.004);
        tone('sine', 190, 140, t, 0.06, L * 0.4, 0.004);
      }
    },
    // All five are right: eight strokes of the hour, each a struck bell with its upper partial.
    clocksStrike(t) {
      const L = lv('clocksStrike');
      beats('bandpass', 196, 14, t, [0, 0.8, 1.6, 2.4, 3.2, 4, 4.8, 5.6], 0.7, L);
      tone('sine', 392, 390, t, 0.9, L * 0.2, 0.004);
      tone('sine', 540, 536, t + 5.6, 1.2, L * 0.15, 0.004);
    },
    // The ghost screams without a sound (design): the event keeps its name and its cue, and the
    // cue makes nothing. The scream is its pose and the written line.
    ghostScream() {},
    // The raven shies from the reticle: a flurry of wing, and a dry rasp.
    ravenDodge(t) {
      const L = lv('ravenDodge');
      beats('bandpass', 900, 1, t, [0, 0.06, 0.12, 0.19, 0.27], 0.06, L * 0.7, 0.01);
      tone('sawtooth', 300, 200, t + 0.05, 0.16, L * 0.22, 0.02);
    },
    // It lands on a nudge: claws on stone, and the wings folded.
    ravenLand(t) {
      const L = lv('ravenLand');
      beats('bandpass', 3300, 9, t, [0.1, 0.15], 0.012, L * 0.8);
      burst('lowpass', 620, 1, t, 0.14, L * 0.6, 200, 0.02);
    },

    // ---- the gallery and the crypt -----------------------------------------------------------

    // A false tile goes: a crack, the pieces falling after it, and the deep thud below.
    tileBreak(t) {
      const L = lv('tileBreak');
      const k = vary();
      burst('bandpass', 1900 * k, 4, t, 0.04, L, null, 0.002);
      beats('bandpass', 3600 * k, 6, t + 0.04, [0, 0.05, 0.11, 0.19], 0.025, L * 0.5);
      tone('sine', 112 * k, 46, t + 0.3, 0.4, L * 0.7, 0.006);
    },
    // A shot meets a tile that holds: a clean ping, and nothing falls.
    tileShot(t) {
      const L = lv('tileShot');
      burst('bandpass', 2600, 6, t, 0.02, L * 0.7, null, 0.002);
      tone('sine', 2350, 2320, t, 0.3, L * 0.5, 0.003);
    },
    // The warden lands in the crypt: a fall, the hard floor, and the dust settling in the dark.
    cryptFall(t, ev) {
      const L = lv('cryptFall');
      tone('sine', 96, 38, t, 0.5, L, 0.005);
      burst('lowpass', 650, 0.9, t, 0.28, L * 0.7, 150, 0.004);
      beats('lowpass', 420, 1, t + 0.2, ev && ev.first ? [0, 0.12, 0.3] : [0], 0.07, L * 0.45, 0.006);
    },

    // ---- the Knight's Walk -------------------------------------------------------------------

    // The warden leaps from one square to the next: a lift, a short flight, a set-down. The
    // board's `knightLeap` has a from and a to (no place); a longer leap is a longer flight.
    knightLeap(t, ev) {
      const L = lv('knightLeap');
      const f = squareFile(ev && ev.from);
      const g = squareFile(ev && ev.to);
      const d = 0.16 + 0.05 * Math.min(3, Math.abs(f - g));
      burst('bandpass', 500, 1.1, t, d, L * 0.5, 1800, 0.03);
      tone('sine', 150, 70, t + d, 0.1, L * 0.9, 0.004);
    },
    // A piece is taken: a hollow clack of wood, and it rolls off the board.
    capture(t) {
      const L = lv('capture');
      const k = vary();
      burst('bandpass', 1300 * k, 4, t, 0.04, L, null, 0.002);
      beats('lowpass', 500 * k, 1, t + 0.05, [0, 0.09, 0.15, 0.2], 0.04, L * 0.5, 0.004);
      tone('sine', 150 * k, 75, t, 0.1, L * 0.5, 0.004);
    },
    // A piece strikes: the heavier the piece, the lower and longer the blow.
    pieceStrike(t, ev) {
      const L = lv('pieceStrike');
      const w = WEIGHT[word(ev && ev.piece)] || 0.75;
      const k = vary();
      tone('sine', (130 - 40 * w) * k, 40, t, 0.12 + 0.18 * w, L * (0.6 + 0.4 * w), 0.004);
      burst('bandpass', 700 * k, 1.5, t, 0.1, L * 0.7, 2600, 0.01);
      tone('sine', 740 * k, 700 * k, t + 0.02, 0.2 + 0.3 * w, L * 0.25, 0.003);
    },
    // The far rank is reached: three rising notes, a little flat, and left standing.
    walkWon(t) {
      const L = lv('walkWon');
      tone('sine', 262, 262, t, 1.8, L * 0.7, 0.01);
      tone('sine', 330, 330, t + 0.45, 1.7, L * 0.7, 0.01);
      tone('sine', 394, 394, t + 0.9, 2.2, L, 0.01);
    },

    // ---- upstairs ----------------------------------------------------------------------------

    // The salt box or the stake bundle: grain poured over a lid, or wood knocked together.
    stockTake(t, ev) {
      const L = lv('stockTake');
      if (word(ev && ev.kind).startsWith('stake')) {
        beats('bandpass', 1000, 4, t, [0, 0.06, 0.11, 0.19, 0.25], 0.035, L);
        tone('sine', 210, 150, t, 0.12, L * 0.4, 0.004);
      } else {
        beats('highpass', 4200, 0.8, t, [0, 0.05, 0.09, 0.13, 0.2, 0.26, 0.3], 0.06, L * 0.8, 0.01);
        tone('sine', 340, 220, t + 0.3, 0.08, L * 0.3, 0.004);
      }
    },
    // The haunts. Furniture is dragged and set down, the horse rocks, the music box plays its
    // eight notes and stops on the seventh. A figure at a window, the figure in the mirror and
    // the tall figure in the glass make no sound.
    haunt(t, ev) {
      const L = lv('haunt');
      const kind = word(ev && ev.kind);
      if (kind === 'furniture') {
        burst('lowpass', 320, 1, t, 0.55, L, 150, 0.12);
        tone('sine', 76, 52, t + 0.55, 0.14, L * 0.8, 0.006);
      } else if (kind === 'horse') {
        tone('sawtooth', 110, 150, t, 0.4, L * 0.2, 0.06);
        tone('sawtooth', 150, 105, t + 0.45, 0.4, L * 0.2, 0.06);
        burst('bandpass', 600, 2, t + 0.85, 0.05, L * 0.4, null, 0.004);
      } else if (kind === 'box') {
        // Three pitches, seven notes: G E C E G E G. The eighth never comes.
        beats('bandpass', 784, 40, t, [0, 1.8, 2.7], 0.5, L, 0.003);
        beats('bandpass', 659, 40, t, [0.45, 1.35, 2.25], 0.5, L, 0.003);
        tone('sine', 523, 523, t + 0.9, 0.5, L * 0.5, 0.003);
      }
    },

    // ---- the Count's room --------------------------------------------------------------------

    // The lid grates on the box: stone dragged over stone, and a low note under it.
    countStir(t) {
      const L = lv('countStir');
      burst('bandpass', 260, 1.5, t, 1.4, L, 520, 0.45);
      tone('sawtooth', 52, 66, t, 1.5, L * 0.35, 0.4);
    },
    // A shaft of daylight takes him: a hiss of burning and a dull shock. His one scream is the
    // pyre's, not this.
    countRecoil(t) {
      const L = lv('countRecoil');
      burst('highpass', 3400, 0.7, t, 0.5, L * 0.8, 1200, 0.01);
      tone('sine', 150, 70, t, 0.2, L * 0.5, 0.006);
    },
    // He lurches: a heavy rush across the floor and a low shock on the end of it.
    countLurch(t) {
      const L = lv('countLurch');
      burst('bandpass', 300, 1.1, t, 0.45, L * 0.8, 1700, 0.18);
      tone('sine', 80, 38, t + 0.38, 0.3, L, 0.005);
    },
    // The bite: the loudest sound in the castle, and short.
    countBite(t) {
      const L = lv('countBite');
      tone('sine', 90, 32, t, 0.5, L, 0.003);
      burst('lowpass', 1100, 0.8, t, 0.12, L * 0.8, 240, 0.002);
      burst('bandpass', 2800, 5, t + 0.01, 0.03, L * 0.5, null, 0.002);
    },
    // A curtain falls open: heavy cloth, and its rings running down the rod.
    curtainOpen(t) {
      const L = lv('curtainOpen');
      burst('bandpass', 500, 0.9, t, 0.55, L * 0.7, 1700, 0.08);
      beats('bandpass', 3100, 8, t + 0.05, [0, 0.04, 0.09, 0.13, 0.2, 0.26], 0.025, L * 0.45);
      tone('sine', 88, 60, t + 0.3, 0.3, L * 0.5, 0.01);
    },

    // A stake glances off him (issue #8): a dull knock on something that is not wood or flesh,
    // and the stake skittering on the boards.
    stakeGlance(t) {
      const L = lv('stakeGlance');
      burst('bandpass', 1300, 2.2, t, 0.07, L, 650, 0.002);
      tone('sine', 210, 120, t, 0.12, L * 0.5, 0.003);
      beats('bandpass', 2400, 6, t + 0.16, [0, 0.09, 0.16, 0.21], 0.03, L * 0.35, 0.002);
    },

    // The scenes, as the Count and the dawn make them: `strike` is the held breath, `pyre` is fire
    // and the shriek for the ten seconds it takes, `triumph` (issue #20) the swell in the light.
    sceneStart(t, ev) {
      const L = lv('sceneStart');
      if (word(ev && ev.kind) === 'triumph') {
        triumphSwell(t, L);
      } else if (word(ev && ev.kind) === 'pyre') {
        burst('bandpass', 900, 0.6, t, 7.2, L, 2400, 1.2); // owner Q12: gone by the ash, so the ash lies in quiet
        tone('sawtooth', 700, 1500, t + 0.4, 1.6, L * 0.3, 0.1);
        tone('square', 720, 1380, t + 0.4, 1.4, L * 0.15, 0.1);
      } else {
        burst('bandpass', 420, 0.8, t, 0.7, L * 0.7, 1500, 0.45);
        tone('sine', 196, 196, t, 0.9, L, 0.3);
      }
    },
    sceneEnd(t, ev) {
      const L = lv('sceneEnd');
      if (word(ev && ev.kind) === 'triumph') {
        tone('sine', 131, 131, t, 1.6, L * 0.4, 0.2); // the swell settles; the dawn's bells follow (won)
      } else if (word(ev && ev.kind) === 'pyre') {
        burst('lowpass', 1800, 0.8, t, 1.4, L * 0.7, 240, 0.05);
        tone('sine', 98, 70, t, 1.2, L * 0.5, 0.2);
      } else {
        burst('bandpass', 1500, 0.8, t, 0.6, L * 0.7, 420, 0.08);
        tone('sine', 196, 147, t, 0.6, L, 0.05);
      }
    },

    // The art pass (owner Q12): the demon spirits howl as they claw out of the Count (the pyre's
    // shades stage, 4 s in) and are torn up the whirlwind and out through the window. Two voices a
    // semitone apart that rise and beat against each other, swelling over a second and a half, and
    // a whistling wind under them that climbs as they go out. 7 nodes.
    shadesHowl(t) {
      const L = lv('shadesHowl');
      tone('triangle', 196, 311, t, 3.6, L * 0.45, 1.5);
      tone('sawtooth', 208, 294, t + 0.12, 3.4, L * 0.16, 1.3);
      burst('bandpass', 620, 6, t + 0.2, 4.1, L * 0.55, 2300, 1.6);
    },

    // The dawn: three bells that resolve, where the court's did not.
    won(t) {
      const L = lv('won');
      tone('sine', 262, 262, t, 2.4, L * 0.7, 0.006);
      tone('sine', 330, 330, t + 0.6, 2.4, L * 0.7, 0.006);
      tone('sine', 392, 392, t + 1.2, 3, L, 0.006);
    },
  };

  // ---- the castle's creatures: the armour and the wife ---------------------------------------
  // Each wraps the court's cue and takes over only for its own two enemies. `court` is the
  // court's cue table, given by audio.js.

  /** Cues for the armour and the wife, over the court's table of the same names. */
  function creatures(court) {
    const armour = (ev) => word(ev && ev.enemy) === 'armour';
    const wife = (ev) => word(ev && ev.enemy) === 'wife';
    return {
      // The armour's tell is a scrape of plate on plate as the pike comes up; the wife's is a
      // breath drawn, the room's cold coming to a point.
      strikeTell(t, ev) {
        const d = kit.tell(ev);
        if (armour(ev)) {
          const L = lv('strikeTell');
          burst('bandpass', 1800, 6, t, 0.75, L, 3300, 0.2, d);
          tone('sawtooth', 70, 140, t, 0.75, L * 0.4, 0.1, d);
        } else if (wife(ev)) {
          const L = lv('strikeTell');
          burst('bandpass', 1000, 0.9, t, 0.55, L * 0.9, 2100, 0.3, d);
          tone('sine', 180, 330, t, 0.55, L * 0.25, 0.25, d);
        } else court.strikeTell(t, ev);
      },
      strike(t, ev) {
        if (armour(ev)) {
          const L = lv('strike');
          const k = vary();
          burst('bandpass', 300 * k, 1.2, t, 0.2, L, 1700, 0.03);
          tone('sine', 88 * k, 40, t + 0.15, 0.22, L * 0.9, 0.004);
          tone('sine', 560 * k, 530 * k, t + 0.15, 0.3, L * 0.3, 0.003);
        } else if (wife(ev)) {
          const L = lv('strike');
          burst('highpass', 3000, 0.7, t, 0.12, L * 0.8, 1400, 0.004);
          tone('sine', 150, 60, t + 0.08, 0.16, L * 0.6, 0.004);
        } else court.strike(t, ev);
      },
      tread(t, ev) {
        if (armour(ev)) {
          const k = vary();
          const L = lv('tread') * 10 ** ((-Math.random() * 1.5) / 20);
          burst('lowpass', 250 * k, 1.3, t, 0.1, L, 110, 0.005);
          beats('bandpass', 2000 * k, 5, t + 0.04, [0, 0.05], 0.025, L * 0.35);
        } else if (!wife(ev)) court.tread(t, ev); // she glides: her tread is no sound at all
      },
      // The first suit's collapse is suitFalls; a kill for the id that just fell adds nothing (and
      // the other way round). Any other suit going over has its own short plate-and-stone sound.
      kill(t, ev) {
        if (armour(ev)) {
          if (dup(ev)) return;
          if (t > 0) note(ev);
          const L = lv('kill');
          burst('bandpass', 1300, 4, t, 0.18, L * 0.7, 700, 0.003);
          tone('sine', 90, 42, t + 0.05, 0.25, L, 0.004);
        } else if (!wife(ev)) court.kill(t, ev);
      },
    };
  }

  // ---- the bed ------------------------------------------------------------------------------
  // Built once (at unlock) and left running for the life of the context, as the court's bed is;
  // audio.js fades the whole of it with the room. Calls are one-shots.

  let layers = null; // { wind, hush, drone }: one gain each
  let hiss = null; // the snakes' gain: HISS.gain * hissLevel (setHiss); 0 until the warden is near the pit
  let hissAt = 0;
  let perches = null; // three fixed places in the stereo field a call can come from
  let far = null; // a lowpass: a far sound
  let stage = 0;
  let still = 0; // issue #29: on the road the world holds its breath: no wind, no owl

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
    const made = {};
    for (const k of Object.keys(BED)) made[k] = gain(BED[k][stage], dest);
    const src = ctx.createBufferSource();
    src.buffer = kit.noise;
    src.loop = true;

    // Wind: round the keep's corners, rising and falling slowly.
    const wind = filter('bandpass', 380, 0.8, made.wind);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(wind.frequency);
    lfo.start();
    src.connect(wind);
    // Hush: the closed air of a stone room.
    src.connect(filter('lowpass', 170, 0.6, made.hush));
    src.start();
    // Drone: two low notes an uneven step apart, through a lowpass so only their beating is left.
    const droneLp = filter('lowpass', 240, 0.5, made.drone);
    for (const hz of [49, 52.1]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      o.connect(droneLp);
      o.start();
    }

    perches = [-0.7, 0.15, 0.75].map((p) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p;
      pan.connect(dest);
      return pan;
    });
    far = filter('lowpass', 900, 0.5, perches[0]);
    hiss = gain(0, filter('lowpass', 10000, 0.5, dest)); // the top kept to a sibilant's 4 to 10 kHz, not static
    try { snakes(ctx, filter); } catch { /* no hiss; the rest of the bed stands */ }
    layers = made;
  }

  // The snakes in the pit: three, each breath through teeth (high-passed noise near 4 kHz, the
  // snakeBite cue's breath, held 0.6 to 1.6 s) on its own loop of hisses (hiss.js), drifting slowly
  // across the stereo field. Each is its own read of the noise, a gain whose curve is the drawn
  // envelope, a high-pass and a panner on a very slow sine: 7 nodes, 21 for the three, made once;
  // with the shared gain and its lowpass, 23.
  function snakes(ctx, filter) {
    SNAKES.forEach((sn, i) => {
      const env = hissEnvelope(hissPattern(sn.seed, sn.loop), sn.loop, HISS.rate);
      const buf = ctx.createBuffer(1, env.length, HISS.rate);
      buf.getChannelData(0).set(env);
      const pan = ctx.createStereoPanner();
      pan.pan.value = sn.pan;
      pan.connect(hiss);
      const vca = ctx.createGain();
      vca.gain.value = 0; // the envelope is the whole of its gain
      vca.connect(pan);
      const hp = filter('highpass', sn.hz, 0.7, vca);
      const src = ctx.createBufferSource();
      src.buffer = kit.noise;
      src.loop = true;
      src.connect(hp);
      src.start(0, (i * 0.37) % 1); // three reads of the noise, out of step, so no two snakes are one
      const curve = ctx.createBufferSource();
      curve.buffer = buf;
      curve.loop = true;
      curve.connect(vca.gain);
      curve.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = sn.drift;
      const lg = ctx.createGain();
      lg.gain.value = sn.swing;
      lfo.connect(lg).connect(pan.pan);
      lfo.start();
    });
  }

  /** The snakes' level, 0 to 1 (hissLevel): a parameter write only. */
  function setHiss(k, t) {
    const v = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
    if (v === hissAt || (v > 0 && Math.abs(v - hissAt) < 0.002)) return;
    hissAt = v;
    if (!hiss) return;
    if (v > 0) {
      hiss.gain.setTargetAtTime(HISS.gain * v, t, 0.03);
      return;
    }
    // hissLevel has already brought it down over a second: land on exactly 0.
    hiss.gain.cancelScheduledValues(t);
    hiss.gain.setValueAtTime(hiss.gain.value, t);
    hiss.gain.linearRampToValueAtTime(0, t + 0.06);
  }

  /** The snakes' gain as it stands (the smoke run reads it through audio.js stats). */
  function hissGain() {
    return hiss ? hiss.gain.value : 0;
  }

  /** Crossfades the layers to a stage (0 the bridge to 6 the Count's room). */
  function setStage(index, t, tc = 1.5) {
    stage = index >= 0 && index < KEEP_STAGES ? index | 0 : index >= KEEP_STAGES ? KEEP_STAGES - 1 : 0;
    if (!layers) return;
    for (const k of Object.keys(BED)) layers[k].gain.setTargetAtTime(BED[k][stage] * (k === 'wind' ? 1 - still : 1), t, tc);
  }

  /** Issue #29: 0 to 1, how still the air is (1 on the road); acts on a change. */
  function setStill(k, t) {
    const v = k > 0.5 ? 1 : 0;
    if (v === still) return;
    still = v;
    if (layers) layers.wind.gain.setTargetAtTime(BED.wind[stage] * (1 - still), t, 1.2);
  }

  /** Seconds until the next call at the current stage. */
  function wait() {
    const w = WAIT[stage];
    return w[0] + Math.random() * w[1];
  }

  // A timber creak, a stone settling, a drip into the dark, a gust in a slit window.
  function creak(t, peak, dest) {
    const f = rnd(90, 130);
    tone('sawtooth', f, f * rnd(1.3, 1.7), t, rnd(0.5, 0.8), peak * 0.5, 0.15, dest);
  }
  function drip(t, peak, dest) {
    const f = rnd(1300, 1900);
    tone('sine', f, f * 0.55, t, 0.07, peak, 0.003, dest);
    tone('sine', f * 0.8, f * 0.45, t + 0.19, 0.05, peak * 0.4, 0.003, dest);
  }
  function settle(t, peak, dest) {
    burst('lowpass', 420, 1, t, 0.16, peak, 150, 0.01, dest);
    tone('sine', 70, 48, t, 0.2, peak * 0.7, 0.01, dest);
  }
  function gust(t, peak, dest) {
    burst('bandpass', 500, 1.2, t, rnd(1.2, 2), peak, 1400, 0.5, dest);
  }
  function owl(t, peak, dest) {
    const f = rnd(340, 410);
    tone('sine', f, f * 0.93, t, 0.22, peak * 0.8, 0.05, dest);
    tone('sine', f, f * 0.9, t + 0.4, 0.5, peak, 0.05, dest);
  }

  /** One call for the current stage, at most 8 nodes, into the bed. audio.js gates and times it. */
  function call(t) {
    if (!layers || (still && stage === 0)) return; // #29: nothing calls on the road
    const perch = perches[(Math.random() * perches.length) | 0];
    const r = Math.random();
    if (stage === 0) {
      if (r < 0.5) owl(t, 0.26, far); // no gust outside (owner, 2026-11-18): the snakes are heard instead
    } else if (stage === 1 || stage === 2) {
      if (r < 0.6) creak(t, 0.2, perch);
      else settle(t, 0.2, far);
    } else if (stage === 3) {
      if (r < 0.7) drip(t, 0.24, perch); // the crypt's below, and it drips
      else settle(t, 0.18, far);
    } else if (stage === 4) {
      if (r < 0.5) gust(t, 0.18, perch);
      else creak(t, 0.18, far);
    } else if (stage === 5) {
      if (r < 0.5) creak(t, 0.2, perch);
      else drip(t, 0.16, far);
    } else settle(t, 0.16, far); // the Count's room: the box of earth, and little else
  }

  return { cues, creatures, bed: { start, setStage, setStill, setHiss, hissGain, wait, call } };
}

function squareFile(sq) {
  return typeof sq === 'string' && sq.length > 0 ? sq.charCodeAt(0) - 97 : 0;
}
