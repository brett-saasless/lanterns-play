// One channel strip per sound source (distance gain, distance lowpass, stereo pan), the listener,
// and the voice budget. Called only from audio.js, which owns the gate; update() makes no voice.

import { LIMITS } from '../logic/sounds.js';

// Kit contract (read at call time, so audio.js may fill it in at unlock):
//   kit.ctx          AudioContext
//   kit.bus          where strips play: a GainNode, or an object whose `monsters` (else `sfx`) is
//                    one. If the object also has `steps` (a GainNode), that bus is the one ducked.
//   kit.attenuation  optional (d) => gain; createSpatial's second argument wins; else the law below
//   kit.duck         optional (t, factor, hold) => void, called instead of ducking kit.bus.steps
// Strip lifecycle is one rule: update() reconciles strips to sim.enemies and sim.bolts, and a
// strip whose source is absent or dead is released only once its tail (the end of the last
// voice begun on it) has passed. clear() drops everything. Nothing else calls release(id).

const MAX_RANGE = LIMITS.audible; // no node is made for a sound farther than this
const TREAD_RANGE = LIMITS.treadAudible;
const BUDGET = LIMITS.voices; // one-shot voices sounding at once; treads are the only ones discarded
const NEAR = LIMITS.nearby; // a monster sounding inside this ducks the steps bus
const DUCK = 0.631; // 4 dB
const DUCK_HOLD = 0.4;
const WRITE_EVERY = 0.05; // pan, gain and cutoff are written at most 20 times a second per strip
const MAX_BOLTS = 6;
const MAX_SPOTS = 32;

function law(d) {
  return d <= 3 ? 1 : 3 / (3 + 0.6 * (d - 3));
}

function isNum(v) {
  return typeof v === 'number' && v === v;
}

function cut(node) {
  try {
    if (node) node.disconnect();
  } catch { /* silent */ }
}

export function createSpatial(kit, attenuation) {
  const att = typeof attenuation === 'function' ? attenuation
    : kit && typeof kit.attenuation === 'function' ? kit.attenuation : law;
  const byId = new Map();
  const list = []; // strips that follow an enemy or a bolt
  const spots = []; // one-shot placements from at()
  const inserts = []; // per-voice gains: a tread's cut gain, or a cue's trim
  for (let i = 0; i < 64; i++) inserts.push({ g: null, end: 0, d: 0, tread: false });
  const ends = new Float64Array(64); // end times of the voices that can never be discarded
  const L = { x: 0, z: 0, sin: 0, cos: 1 };
  let sim = null;
  let stamp = 0;
  let bolts = 0;
  let dropped = 0;
  let peakVoices = 0;
  let peakStrips = 0;
  let duckBase = null;
  let duckUntil = -1;

  function out() {
    const b = kit.bus;
    return b && (b.monsters || b.sfx || (typeof b.connect === 'function' ? b : null));
  }

  function measure(s) {
    const dx = s.x - L.x;
    const dz = s.z - L.z;
    const d = Math.hypot(dx, dz);
    s.d = d;
    if (d > 1e-6) {
      s.side = (dx * L.cos - dz * L.sin) / d; // right = (cos, -sin)
      s.front = (-dx * L.sin - dz * L.cos) / d; // forward = (-sin, -cos)
    } else {
      s.side = 0;
      s.front = 1;
    }
  }

  function range(x, z) {
    return Math.hypot(x - L.x, z - L.z);
  }

  function write(s, t, snap) {
    const d = s.d;
    // Centred inside one metre, opening over the next, so nothing snaps from ear to ear.
    const open = d <= 1 ? 0 : d >= 2 ? 1 : d - 1;
    const pan = s.side * open * 0.9;
    const behind = s.front < 0 ? -s.front * open : 0;
    // The top end falls with distance, and a source behind is slightly duller than in front.
    const hz = Math.max(700, (16000 / (1 + Math.max(0, d - 3) * 0.25)) * (1 - 0.25 * behind));
    if (snap) {
      s.pan.pan.setValueAtTime(pan, t);
      s.lp.frequency.setValueAtTime(hz, t);
      s.in.gain.setValueAtTime(att(d), t);
    } else {
      s.pan.pan.setTargetAtTime(pan, t, 0.03);
      s.lp.frequency.setTargetAtTime(hz, t, 0.03);
      if (!s.gone) s.in.gain.setTargetAtTime(att(d), t, 0.03);
    }
    s.next = t + WRITE_EVERY;
  }

  function make(kind, id, x, z, monster) {
    const ctx = kit.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    const pan = ctx.createStereoPanner();
    gain.connect(lp).connect(pan).connect(out());
    const s = {
      id, kind, monster, x, z, d: 0, side: 0, front: 1,
      in: gain, lp, pan, tell: null,
      tail: t, seen: stamp, next: 0, gone: false,
    };
    measure(s);
    write(s, t, true);
    return s;
  }

  function unmake(s) {
    cut(s.tell);
    cut(s.in);
    cut(s.lp);
    cut(s.pan);
  }

  function drop(i) {
    const s = list[i];
    unmake(s);
    byId.delete(s.id);
    if (s.kind === 'bolt') bolts--;
    list[i] = list[list.length - 1];
    list.pop();
  }

  function sweep(t) {
    for (let i = 0; i < inserts.length; i++) {
      const r = inserts[i];
      if (r.g && r.end <= t) {
        cut(r.g);
        r.g = null;
        r.tread = false;
      }
    }
  }

  function insert(s, end, tread) {
    for (let i = 0; i < inserts.length; i++) {
      const r = inserts[i];
      if (r.g) continue;
      r.g = kit.ctx.createGain();
      r.g.connect(s.in);
      r.end = end;
      r.d = s.d;
      r.tread = tread;
      return r;
    }
    return null;
  }

  function voices(t) {
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > t) n++;
    for (let i = 0; i < inserts.length; i++) {
      const r = inserts[i];
      if (r.g && r.tread && r.end > t) n++;
    }
    return n;
  }

  function note(t, end) {
    let at = 0;
    for (let i = 0; i < ends.length; i++) {
      if (ends[i] <= t) { at = i; break; }
      if (ends[i] < ends[at]) at = i;
    }
    ends[at] = end;
    const n = voices(t);
    if (n > peakVoices) peakVoices = n;
  }

  /** Ducks the steps bus 4 dB for 0.4 s. Called by itself when a monster within 8 m sounds. */
  function duck() {
    try {
      const t = kit.ctx.currentTime;
      if (t < duckUntil - DUCK_HOLD + 0.1) return; // ducked within the last tenth of a second
      duckUntil = t + DUCK_HOLD;
      if (typeof kit.duck === 'function') {
        kit.duck(t, DUCK, DUCK_HOLD);
        return;
      }
      const node = kit.bus && kit.bus.steps;
      if (!node || !node.gain) return;
      if (duckBase === null) duckBase = node.gain.value;
      node.gain.cancelScheduledValues(t);
      node.gain.setTargetAtTime(duckBase * DUCK, t, 0.01);
      node.gain.setTargetAtTime(duckBase, t + DUCK_HOLD, 0.05);
    } catch { /* silent */ }
  }

  function find(arr, id) {
    if (arr) for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  /**
   * The strip of the creature with this id, made on first use; null when it is beyond 32 m or
   * there is no context. x, z (optional) are the event's coordinates; without them the creature
   * is looked up in the sim last given to update(), and failing that it sits at the listener.
   * Pass the strip to voice() before playing into strip.in, or its tail is not kept.
   */
  function strip(id, x, z) {
    try {
      if (!kit.ctx || !out()) return null;
      let s = byId.get(id);
      const has = isNum(x) && isNum(z);
      if (s) {
        if (has && s.kind !== 'bolt') {
          s.x = x;
          s.z = z;
        }
        measure(s);
        return s.d > MAX_RANGE ? null : s;
      }
      if (!has) {
        const e = find(sim && sim.enemies, id);
        x = e ? e.x : L.x;
        z = e ? e.z : L.z;
      }
      if (range(x, z) > MAX_RANGE) return null;
      s = make('enemy', id, x, z, true);
      byId.set(id, s);
      list.push(s);
      if (list.length > peakStrips) peakStrips = list.length;
      return s;
    } catch {
      return null;
    }
  }

  /**
   * The chokeable input of a creature's strip, for its wind-up sounds; choke(id) silences only
   * this. Null under the same conditions as strip().
   */
  function tell(id, x, z) {
    try {
      const s = strip(id, x, z);
      if (!s) return null;
      if (!s.tell) {
        s.tell = kit.ctx.createGain();
        s.tell.connect(s.in);
      }
      return s.tell;
    } catch {
      return null;
    }
  }

  /** Silences the creature's tell input for `seconds`; everything else on its strip plays on. */
  function choke(id, seconds = 0.7) {
    try {
      const s = byId.get(id);
      if (!s || !s.tell) return;
      const t = kit.ctx.currentTime;
      s.tell.gain.cancelScheduledValues(t);
      s.tell.gain.setTargetAtTime(0, t, 0.002);
      s.tell.gain.setValueAtTime(1, t + seconds);
    } catch { /* silent */ }
  }

  /**
   * A strip that follows the bolt nearest (x, z) that has none yet, for its hum; null when there
   * are six already, none is found, or it is beyond 32 m. When the bolt leaves sim.bolts the
   * strip fades in about 30 ms and is released, whatever is still sounding through it.
   */
  function bolt(x, z) {
    try {
      if (!kit.ctx || !out() || bolts >= MAX_BOLTS) return null;
      const bs = sim && sim.bolts;
      let best = null;
      let bd = Infinity;
      if (bs) {
        for (let i = 0; i < bs.length; i++) {
          const b = bs[i];
          if (byId.has(b.id)) continue;
          const dd = Math.hypot(b.x - x, b.z - z);
          if (dd < bd) { bd = dd; best = b; }
        }
      }
      if (!best || range(best.x, best.z) > MAX_RANGE) return null;
      const s = make('bolt', best.id, best.x, best.z, false);
      byId.set(best.id, s);
      list.push(s);
      bolts++;
      if (list.length > peakStrips) peakStrips = list.length;
      return s;
    } catch {
      return null;
    }
  }

  /**
   * A one-shot placement for a sound with coordinates and no living source; null beyond 32 m.
   * It is released by update() once its tail has passed (one second if voice() is never called).
   * monster = true makes it duck the steps bus like a creature's own strip.
   */
  function at(x, z, monster = false) {
    try {
      if (!kit.ctx || !out() || spots.length >= MAX_SPOTS) return null;
      if (!isNum(x) || !isNum(z) || range(x, z) > MAX_RANGE) return null;
      const s = make('spot', null, x, z, !!monster);
      s.tail = kit.ctx.currentTime + 1;
      spots.push(s);
      return s;
    } catch {
      return null;
    }
  }

  /**
   * Registers a one-shot voice of `dur` seconds and returns the node to play it into. target is
   * a strip, a placement, or null for a centred sound (then it is only counted, and null comes
   * back). Never refuses. trim (optional) scales this one voice. Keeps the target's tail, and
   * ducks the steps bus when the target is a monster within 8 m.
   */
  function voice(target, dur = 0.5, trim = 1) {
    try {
      const t = kit.ctx.currentTime;
      note(t, t + dur);
      if (!target) return null;
      if (t + dur > target.tail) target.tail = t + dur;
      if (target.monster && target.d <= NEAR) duck();
      if (trim !== 1 && trim >= 0) {
        const r = insert(target, t + dur + 0.1, false);
        if (r) {
          r.g.gain.value = trim;
          return r.g;
        }
      }
      return target.in;
    } catch {
      return target ? target.in : null;
    }
  }

  /**
   * A monster tread: the only sound the budget may discard. Returns the node to play it into
   * (one gain of its own on the creature's strip, so it can be cut alone), or null when it is
   * beyond 16 m, or skipped at 24 voices. At 24, a nearer tread cuts the farthest one sounding
   * with a 10 ms fade. Skips and cuts are both counted in `dropped`.
   */
  function tread(id, x, z, dur = 0.2) {
    try {
      if (!kit.ctx) return null;
      const t = kit.ctx.currentTime;
      const d = range(x, z);
      if (!(d <= TREAD_RANGE)) return null;
      sweep(t);
      if (voices(t) >= BUDGET) {
        let far = null;
        for (let i = 0; i < inserts.length; i++) {
          const r = inserts[i];
          if (r.g && r.tread && r.end > t && (!far || r.d > far.d)) far = r;
        }
        dropped++;
        if (!far || far.d <= d) return null;
        far.g.gain.cancelScheduledValues(t);
        far.g.gain.setValueAtTime(1, t);
        far.g.gain.linearRampToValueAtTime(0, t + 0.01);
        far.tread = false;
        far.end = t + 0.02;
      }
      const s = strip(id, x, z);
      if (!s) return null;
      const r = insert(s, t + dur + 0.05, true);
      if (!r) {
        dropped++;
        return null;
      }
      if (t + dur > s.tail) s.tail = t + dur;
      const n = voices(t);
      if (n > peakVoices) peakVoices = n;
      if (d <= NEAR) duck();
      return r.g;
    } catch {
      return null;
    }
  }

  /**
   * Once per playing frame: sim is the live sim, listener { x, z, yaw }. One pass over
   * sim.enemies and sim.bolts, no allocation; moves existing strips and releases finished ones.
   */
  function update(simNow, listener) {
    try {
      const ctx = kit.ctx;
      if (!ctx) return;
      sim = simNow || null;
      if (listener) {
        L.x = listener.x;
        L.z = listener.z;
        L.sin = Math.sin(listener.yaw);
        L.cos = Math.cos(listener.yaw);
      }
      const t = ctx.currentTime;
      stamp++;
      if (list.length) {
        const es = sim && sim.enemies;
        if (es) {
          for (let i = 0; i < es.length; i++) {
            const e = es[i];
            const s = byId.get(e.id);
            if (!s) continue;
            s.x = e.x;
            s.z = e.z;
            if (!e.dead) s.seen = stamp;
          }
        }
        const bs = sim && sim.bolts;
        if (bs) {
          for (let i = 0; i < bs.length; i++) {
            const b = bs[i];
            const s = byId.get(b.id);
            if (!s) continue;
            s.x = b.x;
            s.z = b.z;
            s.seen = stamp;
          }
        }
        for (let i = list.length - 1; i >= 0; i--) {
          const s = list[i];
          if (s.seen !== stamp) {
            if (s.kind === 'bolt' && !s.gone) {
              s.gone = true;
              s.in.gain.cancelScheduledValues(t);
              s.in.gain.setTargetAtTime(0, t, 0.01);
              s.tail = t + 0.05;
            }
            if (t >= s.tail) {
              drop(i);
              continue;
            }
          }
          measure(s);
          if (t >= s.next) write(s, t, false);
        }
      }
      for (let i = spots.length - 1; i >= 0; i--) {
        const s = spots[i];
        if (t >= s.tail) {
          unmake(s);
          spots[i] = spots[spots.length - 1];
          spots.pop();
          continue;
        }
        measure(s);
        if (t >= s.next) write(s, t, false);
      }
      sweep(t);
    } catch { /* silent */ }
  }

  /** Drops one strip at once. Only update() and clear() use this rule; do not call it elsewhere. */
  function release(id) {
    try {
      const s = byId.get(id);
      if (!s) return;
      const i = list.indexOf(s);
      if (i >= 0) drop(i);
      else byId.delete(id);
    } catch { /* silent */ }
  }

  /** Drops every strip, placement and voice record, and lets the steps bus back up. */
  function clear() {
    try {
      for (let i = list.length - 1; i >= 0; i--) drop(i);
      byId.clear();
      bolts = 0;
      for (let i = spots.length - 1; i >= 0; i--) unmake(spots[i]);
      spots.length = 0;
      for (let i = 0; i < inserts.length; i++) {
        const r = inserts[i];
        cut(r.g);
        r.g = null;
        r.tread = false;
      }
      ends.fill(0);
      sim = null;
      duckUntil = -1;
      const node = kit.bus && kit.bus.steps;
      if (duckBase !== null && node && node.gain && kit.ctx) {
        node.gain.cancelScheduledValues(kit.ctx.currentTime);
        node.gain.setTargetAtTime(duckBase, kit.ctx.currentTime, 0.02);
      }
    } catch { /* silent */ }
  }

  /** A fresh snapshot: live strips and placements, voices sounding now, treads dropped, peaks. */
  function stats() {
    let now = 0;
    try {
      now = kit.ctx ? kit.ctx.currentTime : 0;
    } catch { /* silent */ }
    return {
      strips: list.length,
      spots: spots.length,
      voices: kit && kit.ctx ? voices(now) : 0,
      dropped,
      peakVoices,
      peakStrips,
    };
  }

  /** Zeroes dropped and the peaks (clear() leaves them, so a run's figures survive its end). */
  function resetCounts() {
    dropped = 0;
    peakVoices = 0;
    peakStrips = 0;
  }

  return { strip, tell, choke, bolt, at, voice, tread, duck, update, release, clear, stats, resetCounts };
}
