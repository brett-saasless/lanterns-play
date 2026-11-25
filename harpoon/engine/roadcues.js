// Synthesis for the road up from the wood (issue #29, the owner's mood record): wrong and too
// still. Five cues (the boulder's crack and its one thud, the bats' swarm, the giant bat and the
// glimpse's footfalls going away up the hill) and a sound with no source for the road's bed: two
// thin tones a hair apart, so the air itself seems to
// hum, swelling a little as the light goes. No birds and no wind on the road: audio.js hushes the
// castle bed's wind and its owl and gust calls while the warden is on it (keepcues.js setStill).
// Called only from audio.js, which owns the gate; every cue goes through kit.tone, kit.burst and
// kit.beats, at most 8 nodes, no attack under 2 ms, authored to its catalogue level.

import { CATALOGUE } from '../logic/sounds.js';
import { SWARM_GUSTS, SWARM_PAST, GIANT_FLAP, GIANT_PATH } from '../logic/road.js';

// A fixed jitter (no Math.random: every swarm sounds the same, as the flock is seeded the same).
const jit = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * The swarm's wing-clicks, matched to its gusts (review A8): each gust's bats pass the warden held at
 * the block SWARM_PAST along their way (road.js), on average at
 * at + 0.4 spread + SWARM_PAST * mean(fly); its clicks bunch there, each moved up to +-25 ms off any
 * grid, spread wider for a slow gust (the owner, fix/bat-pacing: the first two at half speed are
 * over the head twice as long). The last gust's are thinner and spread wider: the tail, which
 * passes with the second (it catches it up).
 * Returns two layers' offsets (the near flutter, the first two gusts, and the swell and tail), and
 * per gust its centre `mids` and its click gap `widths`.
 */
export function swarmClicks() {
  const near = []; const swell = []; const mids = []; const widths = [];
  SWARM_GUSTS.gusts.forEach((g, gi) => {
    const n = Math.round(30 * g.share / 0.42);
    const tail = gi === SWARM_GUSTS.gusts.length - 1;
    const fly = (g.fly[0] + g.fly[1]) / 2;
    const gap = tail ? 0.06 : 0.026 * (fly / 1.4); // full speed (1.4 s a bat) 0.026; the tail's clicks fewer and further apart
    const mid = g.at + 0.4 * g.spread + SWARM_PAST * fly;
    mids.push(Math.round(mid * 1000) / 1000);
    widths.push(gap);
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
  return { near: tidy(near), swell: tidy(swell), mids, widths };
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
    // The swarm: a rush of small wings out of the cave and past the head for about three and a
    // half seconds (the first two flocks at half speed), thinning to nothing. A dry flutter, not a squeak.
    // Uneven clusters, one to a gust (swarmClicks), under a rush of air from just before the first
    // gust passes the head, swelling as the second passes with the third caught up beside it (review A8).
    batSwarm(t) {
      const L = lv('batSwarm');
      const c = swarmClicks();
      beats('bandpass', 2300, 1.4, t, c.near, 0.05, L * 0.8, 0.003);
      beats('bandpass', 1500, 1.1, t, c.swell, 0.06, L * 0.55, 0.003);
      burst('bandpass', 900, 0.6, t + Math.max(0.3, c.mids[0] - 0.5), 1.5, L * 0.35, 2400, 0.75);
    },
    // The giant bat: slow, leathery beats of a wing far too big, one on each downstroke the view
    // draws all the way round its flight (road.js GIANT_FLAP, review A9), and the air it moves at
    // each of its two swoops over the head (GIANT_PATH.passes): a rush at the first, a low drone
    // under the second.
    giantBat(t) {
      const L = lv('giantBat');
      const [p1, p2] = GIANT_PATH.passes;
      beats('lowpass', 340, 0.9, t, GIANT_FLAP.beats.map((b) => Math.max(0, b - 0.05)), 0.16, L, 0.02);
      burst('bandpass', 260, 0.7, t + Math.max(0.05, p1 - 0.25), 0.5, L * 0.5, 120, 0.08);
      tone('sine', 55, 41, t + Math.max(0.02, p2 - 0.45), 0.9, L * 0.35, 0.12);
    },
    // The glimpse up the hill (pass 3): something heavy running away on all fours, four or five
    // soft footfalls in a lope (a pair close together, a gap), each further off and quieter,
    // under a low thump of weight. Not a growl, not a strike: going, not coming. 8 nodes.
    // The werewolf cutaway (cutaway.js), the film's own sound, all from the same kit:
    // a low growl in its chest as the close-up lands: two rough, falling voices a beat apart and
    // breath through them. Not a roar: it does not come for the warden. 5 nodes.
    cutawayGrowl(t) {
      const L = lv('cutawayGrowl');
      tone('sawtooth', 78, 62, t, 1.3, L * 0.45, 0.12);
      tone('square', 81, 60, t + 0.04, 1.2, L * 0.2, 0.15);
      burst('lowpass', 420, 0.9, t, 1.4, L * 0.5, 220, 0.2);
      beats('lowpass', 300, 0.8, t + 0.1, [0, 0.11, 0.24, 0.4], 0.08, L * 0.3, 0.01);
    },
    // An oak leaf the size of a cart shutting on its frame: one deep knock and the wood's ring. 3 nodes.
    cutawayDoor(t) {
      const L = lv('cutawayDoor');
      tone('sine', 70, 42, t, 0.5, L, 0.003);
      burst('lowpass', 700, 0.8, t, 0.25, L * 0.6, 180, 0.002);
      tone('triangle', 190, 150, t + 0.01, 0.35, L * 0.2, 0.004);
    },
    // The bar dropped into its brackets: a wooden clunk and an iron rattle after it. 3 nodes.
    cutawayBar(t) {
      const L = lv('cutawayBar');
      beats('bandpass', 520, 2.5, t, [0, 0.07], 0.09, L, 0.002);
      burst('highpass', 2400, 1.2, t + 0.05, 0.25, L * 0.35, 1200, 0.003);
      tone('sine', 110, 80, t, 0.3, L * 0.4, 0.003);
    },
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
