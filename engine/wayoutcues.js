// Synthesis for the two ways out (issue #29, logic/wayout.js): the yard's last foe spinning off
// and the blast that leaves the crater; the Cantor's last blast and the vault coming down. Each
// scene is three cues: its start (what flies), the strike (what breaks) and its end (what is left
// in the air). The beats are the scene's own (WAYOUT), so what is heard lands on what is seen.
// Called only from audio.js, which owns the gate; every cue goes through kit.tone, kit.burst and
// kit.beats, at most 8 nodes, no attack under 2 ms, authored to its catalogue level. A skipped
// scene's strike is one dull thump: the way out is open at once and nothing is seen to fall.

import { CATALOGUE } from '../logic/sounds.js';
import { WAYOUT } from '../logic/wayout.js';
import { FALL } from '../logic/rubblefall.js';

const lv = (name) => CATALOGUE[name].level;

export function createWayoutCues(kit) {
  const tone = (...a) => kit.tone(...a);
  const burst = (...a) => kit.burst(...a);
  const beats = (...a) => kit.beats(...a);
  const Y = WAYOUT.yard;
  const C = WAYOUT.cave;

  const yard = {
    // The last lantern overloads (an electrical fizz, its band climbing over the beat), lets go
    // with a dull thud, and goes over the yard: air, a whoosh whose band sinks as it falls to the
    // strike. All noise: no whistle, no pitched glide (critic CS-2: a falling tone is the cartoon
    // bomb). 8 nodes.
    sceneStart(t) {
      const L = lv('sceneStart');
      burst('bandpass', 900, 3, t, Y.beat, L * 0.45, 1800, 0.05);
      tone('sine', 110, 55, t + Y.beat, 0.09, L, 0.003); // the pop: 90 ms, a thud, not a note
      burst('bandpass', 650, 1.2, t + Y.beat, Y.fly, L * 0.55, 220, 0.08);
    },
    // The slam: the ground's own thump, the concrete breaking under it, and the slabs coming
    // back down one by one round the hole. No ring, no bounce. 8 nodes.
    craterBlast(t, ev) {
      const L = lv('craterBlast');
      if (ev && ev.skipped) {
        tone('sine', 66, 36, t, 0.4, L * 0.45, 0.004);
        burst('lowpass', 420, 0.8, t, 0.2, L * 0.25, 150, 0.004);
        return;
      }
      tone('sine', 74, 27, t, 1.1, L, 0.004);
      burst('lowpass', 1500, 0.7, t, 0.7, L * 0.75, 110, 0.002);
      beats('lowpass', 520, 0.9, t + 0.5, [0, 0.13, 0.31, 0.44, 0.7, 0.95], 0.1, L * 0.22, 0.006);
    },
    // What is left: the dust settling and the hole's own low breath. 5 nodes.
    sceneEnd(t) {
      const L = lv('sceneEnd');
      burst('lowpass', 360, 0.6, t, 0.7, L * 0.6, 140, 0.12);
      tone('sine', 58, 52, t, 0.9, L, 0.25);
    },
  };

  const cave = {
    // The Cantor's last note: its voice dragged up out of the fold as the core gathers (a soft
    // triangle, no buzz), then the blast itself: a tear of noise going away up to the vault, with
    // a body under it (critic CS-6: no square-wave sweep, which is an arcade laser). 7 nodes.
    sceneStart(t) {
      const L = lv('sceneStart');
      tone('triangle', 82, 196, t, C.beat, L * 0.8, 0.2);
      burst('bandpass', 2600, 1.4, t + C.beat, C.shot + 0.15, L * 0.9, 900, 0.003);
      tone('sine', 150, 70, t + C.beat, C.shot + 0.2, L * 0.6, 0.004);
    },
    // The vault struck: the crack of it, the splitting that runs out through the rock, the long
    // low give as it lets go, and the pieces landing where they are seen to land. 8 nodes.
    vaultBreak(t, ev) {
      const L = lv('vaultBreak');
      if (ev && ev.skipped) {
        tone('sine', 60, 38, t, 0.5, L * 0.4, 0.006);
        burst('lowpass', 500, 0.8, t, 0.3, L * 0.25, 160, 0.004);
        return;
      }
      const land = FALL.first; // the first piece down on the pile (rubblefall.js); the rest pile on till FALL.last
      burst('highpass', 2200, 0.8, t, 0.16, L * 0.8, 700, 0.002);
      beats('bandpass', 430, 0.9, t, [0.07, 0.19, 0.33, land, land + 0.17, land + 0.36, land + 0.6, FALL.last - 0.05], 0.15, L * 0.6, 0.004);
      tone('sine', 52, 30, t + 0.05, FALL.last + 0.6, L, 0.25);
    },
    // What is left: air moving in the shaft, where there was none. 3 nodes.
    sceneEnd(t) {
      const L = lv('sceneEnd');
      burst('bandpass', 900, 0.5, t, 1.1, L * 0.7, 1500, 0.4);
    },
  };

  return { yard, cave };
}
