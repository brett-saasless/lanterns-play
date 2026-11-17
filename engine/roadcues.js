// Synthesis for the road up from the wood (issue #29, the owner's mood record): wrong and too
// still. Five cues (the boulder's crack and its one thud, the bats' swarm, the giant bat and the
// glimpse's footfalls going away up the hill) and a sound with no source for the road's bed: two
// thin tones a hair apart, so the air itself seems to
// hum, swelling a little as the light goes. No birds and no wind on the road: audio.js hushes the
// castle bed's wind and its owl and gust calls while the warden is on it (keepcues.js setStill).
// Called only from audio.js, which owns the gate; every cue goes through kit.tone, kit.burst and
// kit.beats, at most 8 nodes, no attack under 2 ms, authored to its catalogue level.

import { CATALOGUE } from '../logic/sounds.js';
import { SWARM_GUSTS, GIANT_FLAP } from '../logic/road.js';

// A fixed jitter (no Math.random: every swarm sounds the same, as the flock is seeded the same).
const jit = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * The swarm's wing-clicks, matched to its gusts (review A8): each gust's bats pass over the head
 * ~0.35 to 1.2 s after they are let go, most of them at ~0.7 s; its clicks bunch there, each moved
 * up to +-25 ms off any grid. The last gust's are thinner and spread wider: the tail.
 * Returns two layers' offsets: the near flutter (the first two gusts) and the swell and tail.
 */
export function swarmClicks() {
  const near = []; const swell = [];
  SWARM_GUSTS.gusts.forEach((g, gi) => {
    const n = Math.round(30 * g.share / 0.42);
    const tail = gi === SWARM_GUSTS.gusts.length - 1;
    const gap = tail ? 0.06 : 0.026; // the tail's clicks fewer and further apart
    const mid = g.at + g.spread / 2 + 0.7;
    for (let k = 0; k < n; k++) {
      const j = k - (n - 1) / 2; // densest at the middle pass, opening out either side
      const at = mid + Math.sign(j) * gap * Math.pow(Math.abs(j), 1.1) + (jit(gi * 97 + k) - 0.5) * 0.05;
      (gi < 2 && k % 3 !== 2 ? near : swell).push(Math.max(0, at));
    }
  });
  const tidy = (a) => a.sort((x, y) => x - y).reduce((o, x) => {
    if (!o.length || x - o[o.length - 1] >= 0.03) o.push(Math.round(x * 1000) / 1000);
    return o;
  }, []);
  return { near: tidy(near), swell: tidy(swell) };
}

const lv = (name) => CATALOGUE[name].level;

export function createRoadCues(kit) {
  const tone = (...a) => kit.tone(...a);
  const burst = (...a) => kit.burst(...a);
  const beats = (...a) => kit.beats(...a);

  const cues = {
    // Up the bank: rock splitting from rock, then the stone starting to tumble (dry knocks).
    roadCrack(t) {
      const L = lv('roadCrack');
      burst('highpass', 2600, 0.9, t, 0.09, L, 900, 0.002);
      tone('sine', 140, 70, t, 0.18, L * 0.5, 0.003);
      beats('bandpass', 420, 2.2, t + 0.12, [0, 0.21, 0.38, 0.52, 0.63], 0.07, L * 0.55, 0.004);
    },
    // The one landing on the road: heavy, short, earth thrown up. Never a cartoon bounce.
    roadThud(t) {
      const L = lv('roadThud');
      tone('sine', 62, 34, t, 0.42, L, 0.004);
      burst('lowpass', 520, 0.8, t, 0.22, L * 0.6, 160, 0.003);
      beats('lowpass', 900, 0.7, t + 0.12, [0, 0.16, 0.34], 0.12, L * 0.25, 0.01);
    },
    // The swarm: a rush of small wings out of the cave and past the head for about two and a
    // half seconds, thinning to nothing. A dry flutter, not a squeak.
    // Uneven clusters, one to a gust (swarmClicks), under a rush of air that swells with the
    // second gust and thins away with the last (review A8).
    batSwarm(t) {
      const L = lv('batSwarm');
      const c = swarmClicks();
      beats('bandpass', 2300, 1.4, t, c.near, 0.05, L * 0.8, 0.003);
      beats('bandpass', 1500, 1.1, t, c.swell, 0.06, L * 0.55, 0.003);
      burst('bandpass', 900, 0.6, t + 0.3, 1.5, L * 0.35, 2400, 0.75);
    },
    // The giant bat: three slow, leathery beats of a wing far too big, one on each downstroke
    // the view draws (road.js GIANT_FLAP, review A9), and the air it moves.
    giantBat(t) {
      const L = lv('giantBat');
      beats('lowpass', 340, 0.9, t, GIANT_FLAP.beats.map((b) => Math.max(0, b - 0.05)), 0.16, L, 0.02);
      burst('bandpass', 260, 0.7, t + 0.05, 0.42, L * 0.5, 120, 0.08);
      tone('sine', 55, 41, t + 0.02, 0.9, L * 0.35, 0.12);
    },
    // The glimpse up the hill (pass 3): something heavy running away on all fours, four or five
    // soft footfalls in a lope (a pair close together, a gap), each further off and quieter,
    // under a low thump of weight. Not a growl, not a strike: going, not coming. 8 nodes.
    roadCreature(t) {
      const L = lv('roadCreature');
      beats('lowpass', 280, 0.8, t + 0.05, [0, 0.13, 0.52, 0.64], 0.09, L * 0.8, 0.006);
      beats('lowpass', 190, 0.7, t + 0.05, [1.02, 1.14, 1.52, 1.63], 0.1, L * 0.4, 0.008); // further off: duller, quieter
      tone('sine', 68, 50, t + 0.05, 1.4, L * 0.25, 0.03);
    },
  };

  // ---- the bed: a sound with no source ------------------------------------------------------
  // Built once at unlock into the castle's bed; left running at zero until the road wants it.

  let hum = null; // its gain
  let level = 0;

  /** Builds the hum into `dest` (a GainNode). Does nothing a second time. */
  function start(dest) {
    const ctx = kit.ctx;
    if (!ctx || !dest || hum) return;
    hum = ctx.createGain();
    hum.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(hum);
    hum.connect(dest);
    for (const hz of [233, 234.7]) { // a hair apart: a slow beat, nowhere in particular
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      o.connect(lp);
      o.start();
    }
  }

  /** The hum's level, 0 to 1 (audio.js: on the road, swelling with the dark); acts on a change. */
  function setHum(k, t) {
    const v = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
    if (Math.abs(v - level) < 0.01 && v !== 0 && v !== 1) return;
    if (v === level) return;
    level = v;
    if (hum) hum.gain.setTargetAtTime(0.035 * v, t, 1.2);
  }

  return { cues, bed: { start, setHum } };
}
