// Synthesis of the player's footsteps, jump, landing and splash for the five surface families,
// and the variation that keeps them from grating. Called only from audio.js, which owns the gate.
// Two materials add to their family's voice without leaving it: `litter` (soft) crackles like
// dry leaves, and `gravel` (hard) crunches after its tick. Neither adds a node.

// Kit contract (read at call time, so audio.js may fill it in at unlock):
//   kit.ctx    AudioContext
//   kit.noise  AudioBuffer of white noise, at least one second long
//   kit.bus    the steps bus: a GainNode, or an object whose `steps` (else `sfx`) is one
// kit.tone and kit.burst are accepted and unused: a footfall shares one noise source between the
// Boot and the surface voice and adds a panner, which the 8-node budget does not allow otherwise.
// Every function takes (ev, level) and returns the seconds the cue sounds for (0 = nothing made).
// No envelope gain is ever scheduled above the level passed.

const LAND_CAP = 0.25; // owner amendment: a landing never exceeds the monster tread level
const IMPACT_LIGHT = 3; // m per s; the shipped jump lands at 7, the middle of the range
const IMPACT_HEAVY = 11;
const FAMILIES = { hard: 1, wet: 1, metal: 1, soft: 1, wood: 1, carpet: 1 };

// Push-off colour by the surface left behind: [band centre Hz, Q].
const PUSH = { hard: [1700, 1.2], wet: [1100, 1], metal: [1100, 6], soft: [480, 0.8], wood: [800, 3], carpet: [380, 0.7] };

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export function createSteps(kit) {
  let pitch = 0; // random walk within +-0.06
  let trimDb = -0.75; // random walk within -1.5..0 dB, so the level passed is a ceiling
  let waveCtx = null;
  let plopWave = null; // a sine at half amplitude, so an oscillator needs no gain of its own
  let knockWave = null;
  let ringWave = null; // partials 4 and 10 of a 107.5 Hz base: the 430 Hz and 1.1 kHz resonances

  function vary() {
    let p = pitch + (Math.random() < 0.5 ? -1 : 1) * (0.012 + Math.random() * 0.028);
    if (p > 0.06) p = 0.12 - p;
    if (p < -0.06) p = -0.12 - p;
    pitch = p;
    let d = trimDb + (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.4);
    if (d > 0) d = -d;
    if (d < -1.5) d = -3 - d;
    trimDb = d;
  }

  function waves(ctx) {
    if (waveCtx === ctx) return;
    waveCtx = ctx;
    plopWave = knockWave = ringWave = null;
    try {
      const opt = { disableNormalization: true };
      const z2 = new Float32Array(2);
      plopWave = ctx.createPeriodicWave(z2, new Float32Array([0, 0.5]), opt);
      knockWave = ctx.createPeriodicWave(z2, new Float32Array([0, 0.7]), opt);
      const im = new Float32Array(11);
      im[4] = 0.55;
      im[10] = 0.3;
      ringWave = ctx.createPeriodicWave(new Float32Array(11), im, opt);
    } catch { /* plain sines instead */ }
  }

  function dest() {
    const b = kit.bus;
    return b && (b.steps || b.sfx || b);
  }

  function source(ctx) {
    const src = ctx.createBufferSource();
    src.buffer = kit.noise;
    return src;
  }

  function filter(ctx, type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  function osc(ctx, wave, f0, f1, t, glide) {
    const o = ctx.createOscillator();
    if (wave) o.setPeriodicWave(wave);
    else o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    return o;
  }

  // The Boot (the same on every surface) plus the family's surface voice, on one noise source.
  // o: { family, material, level, dur, bright, low, pan, tilt, scuff (0..1 of level, 0 = none), len }
  function footfall(ctx, t, o) {
    const out0 = dest();
    if (!out0 || !kit.noise) return 0;
    waves(ctx);
    const k = 1 + pitch;
    const L = o.level;
    let out = out0;
    if (o.pan) {
      out = ctx.createStereoPanner();
      out.pan.value = o.pan;
      out.connect(out0);
    }
    const src = source(ctx);

    // Boot: lowpassed noise thud near 120 Hz with a mid component near 700 Hz.
    const thud = filter(ctx, 'lowpass', 120 * o.low * k, 7);
    // Carpet muffles the boot: the mid band sits an octave down and the thud is cut short.
    const rug = o.family === 'carpet';
    const mid = filter(ctx, 'bandpass', (rug ? 330 : 700) * o.tilt * o.bright * k, rug ? 1.2 : 2.5);
    const body = ctx.createGain();
    env(body, t, L, 0.004, (rug ? o.dur * 0.7 : o.dur) - 0.004);
    src.connect(thud).connect(body);
    src.connect(mid).connect(body);
    body.connect(out);

    // Surface voice.
    const g = ctx.createGain();
    g.connect(out);
    const vk = k * o.tilt * o.bright * (o.material === 'marble' ? 1.2 : 1); // marble rings brighter
    let voiceEnd = t;
    let tonal = null;
    let f = null;
    if (o.family === 'wet') {
      // Downward bandpass sweep 3 kHz to 900 Hz over 90 ms and a falling sine plop.
      const sweep = 0.09 * o.len;
      f = filter(ctx, 'bandpass', 3000 * vk, 1.4);
      f.frequency.setValueAtTime(3000 * vk, t);
      f.frequency.exponentialRampToValueAtTime(900 * vk, t + sweep);
      env(g, t, L, 0.004, sweep);
      tonal = osc(ctx, plopWave, 380 * k, 150 * k, t, 0.07 * o.len);
      voiceEnd = t + 0.004 + sweep;
    } else if (o.family === 'metal') {
      // Two narrow resonances near 430 Hz and 1.1 kHz ringing 120 ms.
      const ring = 0.12 * o.len;
      const base = ringWave ? 107.5 * vk : 430 * vk;
      tonal = osc(ctx, ringWave, base, base * 0.985, t, ring);
      env(g, t, ringWave ? L : L * 0.5, 0.003, ring);
      voiceEnd = t + 0.003 + ring;
    } else if (o.family === 'soft') {
      // Slow-attack pad under 350 Hz with a faint rustle left above it; no tick at all.
      f = filter(ctx, 'highshelf', 350, 0.7);
      f.gain.setValueAtTime(-26, t);
      if (o.material === 'litter') {
        // Leaf litter: the same pad, but the top opens as the weight comes down and the pad
        // breaks into a few dry grains (leaves giving way) instead of fading smoothly.
        const at = t + 0.018;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L), at);
        f.gain.setValueAtTime(-26, at - 0.006);
        f.gain.linearRampToValueAtTime(-9, at);
        const grains = 3 + Math.round(1.5 * (o.len - 0.85)) + (Math.random() < 0.5 ? 1 : 0);
        let at2 = at;
        for (let i = 0; i < grains; i++) {
          const dip = at2 + (0.006 + Math.random() * 0.01) * o.len;
          g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L * 0.12), dip);
          at2 = dip + 0.0025;
          g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L * (0.45 + Math.random() * 0.45) * (1 - i / (grains + 2))), at2);
        }
        voiceEnd = at2 + 0.02 * o.len;
        g.gain.exponentialRampToValueAtTime(0.0001, voiceEnd);
      } else {
        env(g, t, L, 0.018, o.dur - 0.018);
        voiceEnd = t + o.dur;
      }
    } else if (o.family === 'carpet') {
      // A low, short thud with no tail: the pile takes the grit and the ring. Nothing above 300 Hz.
      f = filter(ctx, 'lowpass', 300 * vk, 0.7);
      env(g, t, L * 0.7, 0.01, 0.045 * o.len);
      voiceEnd = t + 0.01 + 0.045 * o.len;
    } else if (o.family === 'wood') {
      // A sine knock falling from 180 Hz with a boxy band near 800 Hz.
      const knock = 0.055 * o.len;
      f = filter(ctx, 'bandpass', 800 * vk, 3.5);
      f.frequency.setValueAtTime(800 * vk, t);
      f.Q.setValueAtTime(3.5, t);
      tonal = osc(ctx, knockWave, 180 * k, 95 * k, t, knock);
      env(g, t, L, 0.003, knock);
      voiceEnd = t + 0.003 + knock;
    } else {
      // Hard: a dry grit tick near 2.2 kHz, 8 ms.
      f = filter(ctx, 'bandpass', 2200 * vk, 2.2);
      f.frequency.setValueAtTime(2200 * vk, t);
      env(g, t, L * 0.9, 0.0025, 0.0055 * o.len);
      voiceEnd = t + 0.0025 + 0.0055 * o.len;
      if (o.material === 'gravel') {
        // Gravel: after the tick the stones shift under the boot, a few lower, wider grains
        // of grit, each at its own pitch.
        const grains = 2 + Math.round(o.len) + (Math.random() < 0.5 ? 1 : 0);
        f.Q.setValueAtTime(2.2, t);
        for (let i = 0; i < grains; i++) {
          const at = voiceEnd + (0.004 + Math.random() * 0.012) * o.len;
          const sd = (0.008 + Math.random() * 0.01) * o.len;
          f.Q.setValueAtTime(0.9, at);
          f.frequency.setValueAtTime((1100 + Math.random() * 1500) * vk, at);
          env(g, at, L * (0.35 + Math.random() * 0.35), 0.0025, sd);
          voiceEnd = at + 0.0025 + sd;
        }
      }
    }
    if (f) src.connect(f).connect(g);
    if (tonal) tonal.connect(g);

    // The extra scuff (on wood a short creak): a second bump on the voice, no new node.
    let end = Math.max(t + o.dur, voiceEnd);
    let tonalEnd = voiceEnd + 0.02;
    if (o.scuff > 0) {
      const t2 = Math.max(voiceEnd + 0.01, t + o.dur * 0.6);
      const peak = L * o.scuff;
      let sd = 0.03 * o.len;
      if (o.family === 'wood') {
        sd = 0.06;
        tonalEnd = t2; // the knock is over before the board creaks
        f.Q.setValueAtTime(14, t2);
        f.frequency.setValueAtTime(600 * vk, t2);
        f.frequency.exponentialRampToValueAtTime(1500 * vk, t2 + 0.07);
        env(g, t2, peak, 0.01, sd);
      } else if (o.family === 'metal') {
        sd = 0.04 * o.len;
        tonalEnd = t2 + sd + 0.03;
        env(g, t2, peak * (ringWave ? 1 : 0.5), 0.004, sd);
      } else {
        if (o.family === 'hard') f.frequency.setValueAtTime(1300 * vk, t2);
        if (o.family === 'soft') f.gain.setValueAtTime(-12, t2);
        env(g, t2, peak, 0.004, sd);
      }
      end = Math.max(end, t2 + 0.01 + sd);
    }
    src.start(t, Math.random() * 0.4);
    src.stop(end + 0.03);
    if (tonal) {
      tonal.start(t);
      tonal.stop(tonalEnd);
    }
    return end - t;
  }

  function family(ev) {
    return ev && FAMILIES[ev.surface] ? ev.surface : 'hard';
  }

  function ready(level) {
    const ctx = kit && kit.ctx;
    return ctx && level > 0 && level < Infinity ? ctx : null;
  }

  /** ev { gait: 'walk'|'run', surface, material, foot: 0|1 }; level from the catalogue. */
  function step(ev, level) {
    try {
      const ctx = ready(level);
      if (!ctx) return 0;
      vary();
      const run = ev && ev.gait === 'run';
      const right = ev && ev.foot === 1;
      const dur = 0.075 * (1 - pitch * 2.4); // 64 to 86 ms
      return footfall(ctx, ctx.currentTime + 0.001, {
        family: family(ev),
        material: ev && ev.material,
        level: level * 10 ** (trimDb / 20),
        dur: run ? dur * 0.85 : dur,
        bright: run ? 1.15 : 1,
        low: 1,
        pan: right ? 0.08 : -0.08,
        tilt: right ? 1.05 : 0.95,
        scuff: Math.random() < 1 / 9 ? 0.35 : 0,
        len: run ? 0.85 : 1,
      });
    } catch {
      return 0;
    }
  }

  /** ev { surface, material }: a short push-off scuff coloured by the surface left behind. */
  function jump(ev, level) {
    try {
      const ctx = ready(level);
      const out = dest();
      if (!ctx || !out || !kit.noise) return 0;
      vary();
      const t = ctx.currentTime + 0.001;
      const k = 1 + pitch;
      const L = level * 10 ** (trimDb / 20);
      const [hz, q] = PUSH[family(ev)];
      const dur = 0.07;
      const src = source(ctx);
      const f = filter(ctx, 'bandpass', hz * k, q);
      f.frequency.setValueAtTime(hz * k, t);
      f.frequency.exponentialRampToValueAtTime(hz * k * 1.5, t + dur);
      const g = ctx.createGain();
      env(g, t, L, 0.008, dur);
      const push = filter(ctx, 'lowpass', 150 * k, 5);
      const pg = ctx.createGain();
      env(pg, t, L * 0.6, 0.006, dur * 0.7);
      src.connect(f).connect(g).connect(out);
      src.connect(push).connect(pg).connect(out);
      src.start(t, Math.random() * 0.4);
      src.stop(t + dur + 0.04);
      return dur + 0.008;
    } catch {
      return 0;
    }
  }

  /**
   * ev { surface, material, impact (m per s), fall (m) }. `level` is the lightest landing's level
   * (the catalogue's 0.14); it rises with impact to `cap`, which is never taken above 0.25.
   */
  function land(ev, level, cap = LAND_CAP) {
    try {
      const ctx = ready(level);
      if (!ctx) return 0;
      vary();
      let impact = ev ? ev.impact : 0;
      if (!(impact >= 0)) impact = ev && ev.fall > 0 ? Math.sqrt(44 * ev.fall) : 0;
      const w = clamp01((impact - IMPACT_LIGHT) / (IMPACT_HEAVY - IMPACT_LIGHT));
      const top = Math.min(LAND_CAP, cap > 0 ? cap : LAND_CAP);
      const base = Math.min(level, top);
      return footfall(ctx, ctx.currentTime + 0.001, {
        family: family(ev),
        material: ev && ev.material,
        level: (base + (top - base) * w) * 10 ** (trimDb / 20),
        dur: 0.12 + 0.14 * w, // 120 to 260 ms
        bright: 1 - 0.12 * w,
        low: 1 - 0.3 * w, // heavier is lower
        pan: 0,
        tilt: 1,
        scuff: w > 0.55 ? 0.3 + 0.3 * w : 0, // the second scuff of a real drop
        len: 1 + w,
      });
    } catch {
      return 0;
    }
  }

  /** ev { impact (0 when walked in), gait }: sized by gait, or by impact when landed in. */
  function splash(ev, level) {
    try {
      const ctx = ready(level);
      const out = dest();
      if (!ctx || !out || !kit.noise) return 0;
      vary();
      waves(ctx);
      const t = ctx.currentTime + 0.001;
      const k = 1 + pitch;
      const impact = ev && ev.impact > 0 ? ev.impact : 0;
      const w = clamp01((impact - IMPACT_LIGHT) / (IMPACT_HEAVY - IMPACT_LIGHT));
      const size = impact > 0 ? 0.6 + 0.4 * w : ev && ev.gait === 'run' ? 0.5 : 0.25;
      const L = level * (0.55 + 0.45 * size) * 10 ** (trimDb / 20);
      const dur = 0.15 + 0.2 * size; // 150 to 350 ms
      const src = source(ctx);
      // The wet voice writ large: the downward sweep and the plop.
      const f = filter(ctx, 'bandpass', 3000 * k, 1.2);
      f.frequency.setValueAtTime(3000 * k, t);
      f.frequency.exponentialRampToValueAtTime((900 - 300 * size) * k, t + dur * 0.6);
      const g = ctx.createGain();
      env(g, t, L, 0.004, dur - 0.004);
      src.connect(f).connect(g).connect(out);
      const plop = osc(ctx, plopWave, 420 * k, 140 * k, t, 0.09 + 0.06 * size);
      plop.connect(g);
      // Spray.
      const hp = filter(ctx, 'highpass', 4500, 0.7);
      const sg = ctx.createGain();
      env(sg, t, L * 0.5, 0.003, dur * 0.4);
      src.connect(hp).connect(sg).connect(out);
      if (impact > 0) {
        // Jumped in: the larger splash sits over a low thump.
        const lp = filter(ctx, 'lowpass', 110 * k, 6);
        const tg = ctx.createGain();
        env(tg, t, L, 0.005, 0.12);
        src.connect(lp).connect(tg).connect(out);
      }
      src.start(t, Math.random() * 0.4);
      src.stop(t + dur + 0.04);
      plop.start(t);
      plop.stop(t + dur);
      return dur;
    } catch {
      return 0;
    }
  }

  return { step, jump, land, splash };
}
