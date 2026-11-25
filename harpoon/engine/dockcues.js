// Synthesis for the dock (docs/features/sea-1-dock/02-design.md, R11): a cue for each event the
// chapter adds. Called only from audio.js, which owns the gate (the kit contract is courtcues.js's:
// kit.tone, kit.burst, kit.beats, each at most a handful of nodes, no attack under 2 ms).
//
// sea-1-dock-art R8: the bed (water, rigging, gulls, the bell buoy, and in the tavern the murmur,
// fire, clock and sign), built once at unlock as keepcues.js's own bed is. Each layer's gain comes
// only from dockart.js's bedGains(zone, hush) - the same numbers tests/dockart.test.js checks -
// never a literal here. Gulls, the bell buoy and the clock's tick are each the design's own "sparse"
// or "struck" character simplified to a slow, continuous amplitude-modulated texture rather than
// discrete scheduled events (no new per-room scheduler added to audio.js for this pass); noted in
// the build report.

import { bedGains } from './dockart.js';

export function createDockCues(kit) {
  const tone = (...a) => kit.tone(...a);
  const burst = (...a) => kit.burst(...a);

  const cues = {
    signedOn(t) {
      tone('triangle', 440, 440, t, 0.1, 0.3);
      tone('triangle', 660, 660, t + 0.1, 0.16, 0.3);
    },
    kitStowed(t) {
      burst('lowpass', 400, 1, t, 0.08, 0.25);
    },
    contestRound(t) {
      tone('square', 300, 300, t, 0.06, 0.2);
    },
    proof(t) {
      tone('sine', 660, 660, t, 0.1, 0.3);
      tone('sine', 880, 880, t + 0.08, 0.14, 0.3);
    },
    clipping(t) {
      burst('highpass', 2200, 1, t, 0.03, 0.25);
    },
    monsterKnown(t) {
      tone('sine', 120, 60, t, 0.4, 0.3);
    },
    glassUp(t) {
      burst('bandpass', 1200, 1.2, t, 0.1, 0.2);
    },
    nailed(t) {
      tone('triangle', 523, 523, t, 0.12, 0.4);
      tone('triangle', 784, 784, t + 0.12, 0.22, 0.4);
    },
    harpoonThrow(t) {
      burst('bandpass', 700, 1.6, t, 0.1, 0.4, 300);
    },
    harpoonStick(t) {
      tone('triangle', 180, 90, t, 0.1, 0.4);
      burst('bandpass', 1400, 2, t, 0.04, 0.3);
    },
    harpoonRing(t) {
      tone('sine', 1600, 1200, t, 0.3, 0.6);
      burst('bandpass', 2600, 4, t, 0.2, 0.45);
    },
    harpoonHaul(t) {
      burst('lowpass', 250, 0.9, t, 0.2, 0.25);
    },
    dunk(t) {
      burst('lowpass', 300, 0.7, t, 0.3, 0.6);
      tone('sine', 150, 60, t, 0.25, 0.5);
    },
    scare(t) {
      tone('sine', 60, 40, t, 0.6, 0.6);
      burst('lowpass', 200, 0.6, t, 0.5, 0.5);
    },
    castOff(t) {
      burst('lowpass', 350, 0.8, t, 0.5, 0.3);
      tone('sine', 55, 55, t, 0.5, 0.3);
    },
    contestWon(t) {
      tone('triangle', 392, 392, t, 0.1, 0.35);
      tone('triangle', 523, 523, t + 0.1, 0.12, 0.35);
      tone('triangle', 659, 659, t + 0.22, 0.2, 0.35);
    },
  };

  // ---- the bed --------------------------------------------------------------------------------

  let layers = null; // { water, rigging, gulls, bellBuoy, murmur, fireClockSign }: one gain each
  let zone = 'quay';
  let hush = 0;

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
    const noiseInto = (to) => {
      const src = ctx.createBufferSource();
      src.buffer = kit.noise;
      src.loop = true;
      src.connect(to);
      src.start();
      return src;
    };
    const lfo = (hz, depth, to, phase = 0) => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(to);
      o.start();
      if (phase) { try { o.detune.value = phase; } catch { /* cosmetic only */ } }
      return o;
    };

    const made = {};

    // Water: low-passed noise, a slow swell on its own gain (never fully off: a harbour is never silent either).
    made.water = gain(0, dest);
    const waterLp = filter('lowpass', 500, 0.6, made.water);
    noiseInto(waterLp);
    lfo(0.07, 0.15, made.water.gain);

    // Rigging: two slow creaks at uneven periods (bandpassed noise, each its own slow LFO) plus a soft block knock (a third, faster one).
    made.rigging = gain(0, dest);
    const rigA = filter('bandpass', 180, 2, made.rigging);
    const rigAGain = gain(0, rigA);
    noiseInto(rigAGain);
    lfo(0.045, 0.5, rigAGain.gain);
    const rigB = filter('bandpass', 260, 3, made.rigging);
    const rigBGain = gain(0, rigB);
    noiseInto(rigBGain);
    lfo(0.067, 0.4, rigBGain.gain, 17);
    const knock = filter('bandpass', 900, 4, made.rigging);
    const knockGain = gain(0, knock);
    noiseInto(knockGain);
    lfo(0.031, 0.18, knockGain.gain, 31);

    // Gulls: sparse falling calls - simplified to a slow, quiet amplitude-modulated tone (no new
    // per-room scheduler added for this pass; a true one-at-a-time call sequencer is future work).
    made.gulls = gain(0, dest);
    const gullTone = ctx.createOscillator();
    gullTone.type = 'sine';
    gullTone.frequency.value = 1400;
    const gullSweep = ctx.createGain();
    gullSweep.gain.value = 0;
    gullTone.connect(gullSweep).connect(made.gulls);
    gullTone.start();
    lfo(0.05, 0.12, gullSweep.gain, 53);

    // Bell buoy: one struck partial every 7 to 11 s - simplified to a slow-pulsed low partial.
    made.bellBuoy = gain(0, dest);
    const bell = ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.value = 520;
    const bellSweep = ctx.createGain();
    bellSweep.gain.value = 0;
    bell.connect(bellSweep).connect(made.bellBuoy);
    bell.start();
    lfo(1 / 9, 0.3, bellSweep.gain, 71);

    // Murmur: three band-passed noise voices, swelling at speech rate, detuned so no word forms.
    made.murmur = gain(0, dest);
    for (const [hz, rate, seed] of [[650, 3.4, 5], [900, 4.1, 23], [1200, 3.7, 41]]) {
      const bp = filter('bandpass', hz, 2.2, made.murmur);
      const vg = gain(0, bp);
      noiseInto(vg);
      lfo(rate, 0.5, vg.gain, seed);
    }

    // Fire, clock, sign: crackle bursts; a tick each second; the sign's creak through the wall.
    made.fireClockSign = gain(0, dest);
    const fireLp = filter('lowpass', 1800, 0.7, made.fireClockSign);
    const fireGain = gain(0, fireLp);
    noiseInto(fireGain);
    lfo(2.2, 0.35, fireGain.gain, 7);
    const tick = ctx.createOscillator();
    tick.type = 'square';
    tick.frequency.value = 1000;
    const tickGain = ctx.createGain();
    tickGain.gain.value = 0;
    tick.connect(tickGain).connect(made.fireClockSign);
    tick.start();
    lfo(1, 0.08, tickGain.gain, 13); // once a second
    const sign = filter('bandpass', 220, 3, made.fireClockSign);
    const signGain = gain(0, sign);
    noiseInto(signGain);
    lfo(0.09, 0.2, signGain.gain, 29);

    layers = made;
    apply();
  }

  function apply() {
    if (!layers || !kit.ctx) return;
    const t = kit.ctx.currentTime;
    const g = bedGains(zone, hush);
    for (const k of Object.keys(g)) if (layers[k]) layers[k].gain.setTargetAtTime(g[k], t, k === 'murmur' ? 2.0 : 0.3);
  }

  /** 'quay'|'pier'|'underPier'|'deck'|'tavern' (R8). */
  function setZone(id) {
    if (id === zone) return;
    zone = id;
    apply();
  }

  /** 0 (full murmur) to 1 (hushed) - R7's sim.waves.hush, passed straight through. */
  function setHush(k) {
    const v = Number.isFinite(k) ? k : 0;
    if (Math.abs(v - hush) < 0.002) return;
    hush = v;
    apply();
  }

  return { cues, bed: { start, setZone, setHush } };
}
