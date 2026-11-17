// The wood's weather after the Caterpillar (issue #28): it rains in the last band and on the
// approach until the Caterpillar's gate is opened; then the rain thins to nothing, the cloud
// breaks and a low setting sun shows. Pure and seeded: state lives in sim.waves.weather, the
// engine draws it (forest.js the rain, court.js the sky and the sun, courtcues.js the sound).
// `clear` runs 0 (raining) to 1 (clear sky) and only ever goes up within a run; `drift` is
// where the cloud breaks, from the run's seed.

import { makeRng } from './rng.js';
import { MAZE } from './courtmap.js';

export const WEATHER = Object.freeze({
  clearing: 30, // seconds from the gate opening to a clear sky, if the warden lingers
  gate: 4, // the band whose gate creature (the Caterpillar) holds the rain
});

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const smooth = (k) => { const t = clamp(k); return t * t * (3 - 2 * t); };

/** Fresh weather for a run: raining, the cloud's breaks placed by the seed. */
export function createWeather(seed = 1, clear = 0) {
  const rnd = makeRng((seed ^ 0x5e1a) >>> 0);
  return { clear: clamp(clear), drift: [rnd() * 100, rnd() * 100] };
}

/**
 * The weather a restore seats (security A2: written, never kept): clear once the checkpoint is
 * past the Caterpillar's gate (the approach, stage 5); short of it, as far as it had cleared if
 * the gate is open (`done` is kept, so the sky never goes back), else raining. The drift is kept.
 */
export function restoredWeather(was, index, seed = 1, gateOpen = false) {
  const ok = !!was && Array.isArray(was.drift) && was.drift.length === 2 && was.drift.every(Number.isFinite);
  const wx = ok ? { clear: 0, drift: was.drift.slice() } : createWeather(seed);
  const had = was && Number.isFinite(was.clear) ? clamp(was.clear) : 0;
  wx.clear = index >= 5 ? 1 : gateOpen ? had : 0;
  return wx;
}

/**
 * One frame. Nothing changes until the Caterpillar's gate is open; then the sky clears over
 * WEATHER.clearing seconds, and never later than the warden's walk down the approach (gate
 * to the level's end), so the sun is out by the time the wood is left behind.
 */
export function stepWeather(sim, dt) {
  const w = sim.waves;
  const wx = w && w.weather;
  if (!wx || !w.done || !w.done.gates[WEATHER.gate - 1]) return;
  if (!(dt > 0)) return;
  let clear = wx.clear + dt / WEATHER.clearing;
  if (w.index >= 5 && sim.cfg && sim.cfg.end) {
    const gateZ = MAZE.glades[WEATHER.gate - 1].gate.z;
    const along = (gateZ - sim.player.z) / (gateZ - sim.cfg.end.z);
    clear = Math.max(clear, along);
  }
  wx.clear = clamp(Math.max(wx.clear, clear));
}

/**
 * What the engine draws for a `clear` (0 to 1): rain (1 full, 0 none) goes first, the cloud
 * cover (1 overcast, 0 parted) breaks through the middle, the sun (0 hidden, 1 out) comes last.
 */
export function skyOf(clear, out = {}) {
  const k = clamp(Number.isFinite(clear) ? clear : 0);
  out.rain = 1 - smooth(k / 0.45);
  out.cloud = 1 - smooth((k - 0.2) / 0.6);
  out.sun = smooth((k - 0.35) / 0.65);
  return out;
}

/** The sky the sim is under now (raining when there is no weather, as before #28), into `out` if given. */
export function weatherNow(sim, out) {
  const wx = sim && sim.waves && sim.waves.weather;
  return skyOf(wx ? wx.clear : 0, out);
}
