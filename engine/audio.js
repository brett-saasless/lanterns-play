// Synthesized WebAudio, no samples: dry metal for the yard, wet and close for the cave, open
// air for the Rose Court and its wood, long stone halls for the castle.
// Cues are registered per room under the sim's event names. Every failure degrades to silence.
//
// Ownership (security A1, A4):
//  - play() holds the single gate. No voice is created on any path that does not pass its
//    `if (!ctx || muted) return`. steps.js and spatial.js are reachable only from cues run by
//    play(); audition() calls play(); update() writes parameters and never creates a voice.
//  - Every bus is upstream of `master`, and nothing may ever be connected downstream of it:
//    pause and mute are a property of that one node.

import { CATALOGUE, LADDER, LIMITS, attenuation } from '../logic/sounds.js';
import { MATERIALS } from '../logic/surfaces.js';
import { createSteps } from './steps.js';
import { createSpatial } from './spatial.js';
import { createCourtCues, isBow, placeOf, STAGES } from './courtcues.js';
import { createKeepCues, KEEP_STAGES } from './keepcues.js';
import { createRoadCues } from './roadcues.js'; // issue #29: the road up from the wood
import { createWayoutCues } from './wayoutcues.js'; // issue #29: the crater's and the vault's cut scenes
import { onRoad } from '../logic/road.js';
import { COURT } from '../logic/courtmap.js';
import { CLOCKS as CLOCK_SPOTS, zoneAt as keepZoneAt } from '../logic/keepmap.js';
import { tickGain } from '../logic/clocks.js';
import { weatherNow } from '../logic/weather.js';
import { newHiss, hissLevel } from '../logic/hiss.js'; // the snakes in the pit, by where the warden is

const _sky = { rain: 1, cloud: 1, sun: 0 }; // #28: scratch, so the frame allocates nothing

let ctx = null;
let master = null; // the last gain before the compressor: pause and mute act here and only here
let mix = null; // everything but the scare; ducked for a quarter second before it
let scareBus = null; // centred and dry, straight to master
let tone8 = null; // room tone: a touch more top in the yard, a lowered top in the cave
let send = null; // reverb send (closed in the yard; the cave's close echo, the castle's stone tail)
let verb = null; // its convolver: the cave's short impulse, or the castle's long one
let sfx = null;
let stepsBus = null;
let monsters = null;
let ambient = null;
let noise = null;
let muted = false;

// Rooms
let room = 'yard';
let yardBed = null;
let caveBed = null;
let songGain = null;
let dripIn = null;
let dripTimer = null;
let courtBed = null;
let castleBed = null;
let caveImpulse = null;
let castleImpulse = null; // built at unlock, beside the cave's
let callTimer = null;
let stage = 0; // the depth: the court's 0 the court, 1 to 4 the bands of the wood, 5 the approach; the castle's 0 to 6
let reading = false; // a story card or the log is open: the bed sits at a third
let paused = true; // nothing sounds until the first resume()
let pauseSeq = 0;
let chamber = 0;
let poolLife = 5;
let boltLife = 7;
let veils = null;
const sizzles = [];
const hums = [];
const flowing = []; // the water running down a rill, from its valve's release to its bed (R4)
const SONG_LEVEL = [0.05, 0.11, 0]; // by chamber index; chamber 3 is silent
const MASTER = 0.8;
const CAVE_SEND = 0.3;
const COURT_SEND = 0.08; // the dark bands of the wood close in a little; the garden is dry
// The castle, by stage (bridge, hall, tea room, gallery, Knight's Walk and stair, upstairs, the
// Count's room): closed outside, lower in the carpeted rooms, highest in the gallery and the Walk.
// Nearly shut in the carpeted rooms (hall, tea room, upstairs).
const CASTLE_SEND = [0, 0.03, 0.02, 0.34, 0.32, 0.03, 0.03];
const CASTLE_TONE = [0.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5]; // dB of top: open air brighter than the rooms
const CASTLE_TAIL = 2.8; // seconds: the stone tail on the shipped send
const MAX_HUMS = 6;
const FLOW_LEVEL = 0.6; // of the gulp it ends on (waterArrive): a quiet loop
const FLOW_FADE = 0.25; // seconds: the loop's own way out if its arrival is never heard

// Sound state (never game state); all of it is dropped by setRoom.
let hissMem = newHiss(); // hissLevel's memory: the level, the metres walked into it, the last place
let hissClock = NaN; // the sim time of the last hiss step
let scareUsed = false; // the Cantor's first Call of a run has been spent
let played = {}; // cues sounded since the run began, by name
let peakHums = 0;
const pools = []; // where the live Weeper pools are, oldest first (they all live equally long)
let gonePool = null;
const listener = { x: 0, z: 0, yaw: 0 };

// The kit steps.js and spatial.js share; filled in at unlock and read by them lazily.
const kit = { ctx: null, noise: null, tone: null, burst: null, beats: null, tell: null, bus: { steps: null, monsters: null, sfx: null }, attenuation };
const steps = createSteps(kit);
const spatial = createSpatial(kit, attenuation);
const court = createCourtCues(kit);
const keep = createKeepCues(kit);
const road = createRoadCues(kit); // issue #29
const wayout = createWayoutCues(kit); // issue #29

// Per-cue routing, set by play() just before a recipe runs.
let route = null; // where tone() and burst() go by default
let target = null; // the strip or placement the cue plays on (null = centred)
let live = true; // false while an audition plays: room and strip state are left alone
let long = false; // cave recipes loop the noise: their sweeps outlast the one-second buffer
let probing = false; // dry run: recipes only report how long they sound, and make nothing
let span = 0;

function isNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function clamp(v, lo, hi, dflt) {
  return isNum(v) ? (v < lo ? lo : v > hi ? hi : v) : dflt;
}

function makeNoise() {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function startAmbient() {
  ambient = ctx.createGain();
  ambient.gain.value = LADDER.ambient;
  ambient.connect(mix);
  yardBed = ctx.createGain();
  yardBed.gain.value = room === 'yard' ? 1 : 0;
  yardBed.connect(ambient);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 200;
  lp.connect(yardBed);
  for (const f of [55, 55.7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g).connect(lp);
    o.start();
  }
  // Surf: noise through a slow-LFO lowpass.
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const surf = ctx.createBiquadFilter();
  surf.type = 'lowpass';
  surf.frequency.value = 500;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 380;
  lfo.connect(lfoGain).connect(surf.frequency);
  const sg = ctx.createGain();
  sg.gain.value = 0.16;
  src.connect(surf).connect(sg).connect(yardBed);
  src.start();
  lfo.start();
}

// Cave bed: a 40 Hz rumble, drips through a feedback delay, and the song (two sines an
// uneven interval apart that drift and beat) at a level set by the chamber.
function startCaveBed() {
  caveBed = ctx.createGain();
  caveBed.gain.value = room === 'cave' ? 1 : 0;
  caveBed.connect(ambient);

  const rumble = ctx.createGain();
  rumble.gain.value = 0.9;
  rumble.connect(caveBed);
  for (const [f, lv] of [[40, 0.8], [80.6, 0.16]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = lv;
    o.connect(g).connect(rumble);
    o.start();
  }
  const air = ctx.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const airLp = ctx.createBiquadFilter();
  airLp.type = 'lowpass';
  airLp.frequency.value = 120;
  const airG = ctx.createGain();
  airG.gain.value = 0.5;
  air.connect(airLp).connect(airG).connect(rumble);
  air.start();

  dripIn = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.31;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  dripIn.connect(caveBed);
  dripIn.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(caveBed);

  songGain = ctx.createGain();
  songGain.gain.value = 0;
  const songLp = ctx.createBiquadFilter();
  songLp.type = 'lowpass';
  songLp.frequency.value = 900;
  songLp.connect(songGain).connect(caveBed);
  [[196, 0.07, 2.6], [277.4, 0.11, 3.4]].forEach(([f, rate, depth]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const lg = ctx.createGain();
    lg.gain.value = depth;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.5;
    o.connect(g).connect(songLp);
    o.start();
    lfo.start();
  });
}

// Court bed: the layers courtcues.js builds (air, wind, rain, the brook), under one gain that
// follows the room. A failure here leaves the court without a bed and everything else as it was.
function startCourtBed() {
  try {
    courtBed = ctx.createGain();
    courtBed.gain.value = room === 'court' ? 1 : 0;
    courtBed.connect(ambient);
    court.bed.start(courtBed);
  } catch { /* silent */ }
}

// The castle's bed: the snakes in the pit outside, stone-room hush, the drone that deepens to the Count.
function startCastleBed() {
  try {
    castleBed = ctx.createGain();
    castleBed.gain.value = room === 'castle' ? 1 : 0;
    castleBed.connect(ambient);
    keep.bed.start(castleBed);
    road.bed.start(castleBed); // issue #29: the road's sound with no source
  } catch { /* silent */ }
}

// A room's closeness: seconds of decaying, lowpassed noise, 60 dB down at the end. The cave's is
// 0.6 s near 1.8 kHz, generated once at unlock; the castle's is 2.8 s near 2.4 kHz, generated
// the first time the castle is entered.
function makeImpulse(seconds = 0.6, cutoff = 1800) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  const a = Math.exp((-2 * Math.PI * cutoff) / rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const x = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / len); // 60 dB down at the end
      y = (1 - a) * x + a * y;
      d[i] = y;
    }
  }
  return buf;
}

// Buses. Everything joins `mix` (or, for the scare alone, `scareBus`), and both feed master.
function buildBuses() {
  master = ctx.createGain();
  master.gain.value = 0; // resume() opens it, once the context is running
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  mix = ctx.createGain();
  mix.connect(master);
  scareBus = ctx.createGain();
  scareBus.connect(master);
  tone8 = ctx.createBiquadFilter();
  tone8.type = 'highshelf';
  tone8.frequency.value = 4500;
  tone8.connect(mix);
  send = ctx.createGain();
  send.gain.value = 0;
  verb = ctx.createConvolver();
  caveImpulse = makeImpulse();
  verb.buffer = caveImpulse;
  try { castleImpulse = makeImpulse(CASTLE_TAIL, 2400); } catch { castleImpulse = null; }
  send.connect(verb).connect(mix);
  sfx = ctx.createGain();
  stepsBus = ctx.createGain();
  monsters = ctx.createGain();
  for (const b of [sfx, stepsBus, monsters]) {
    b.connect(tone8);
    b.connect(send);
  }
}

function setSong(now = false) {
  if (!songGain || !ctx) return;
  const lv = room === 'cave' ? SONG_LEVEL[Math.min(chamber, SONG_LEVEL.length - 1)] : 0;
  // It stops the moment the last chamber is entered; elsewhere it swells in slowly.
  songGain.gain.setTargetAtTime(lv, ctx.currentTime, lv === 0 || now ? 0.04 : 1.5);
}

function scheduleDrip() {
  clearTimeout(dripTimer);
  dripTimer = setTimeout(() => {
    play('drip'); // through the gate like everything else
    if (room === 'cave') scheduleDrip();
  }, 500 + Math.random() * 2600);
}

// The court's birds, owls and howls: one call at a time, as far apart as the stage says.
function scheduleCall() {
  clearTimeout(callTimer);
  callTimer = setTimeout(() => {
    play('call'); // through the gate like everything else
    if (room === 'court' || room === 'castle') scheduleCall();
  }, (room === 'castle' ? keep.bed : court.bed).wait() * 1000);
  if (callTimer && callTimer.unref) callTimer.unref(); // never the reason a Node test stays alive
}

// The bed's level: a third while a card or the log is being read.
function bedLevel() {
  return reading ? LADDER.ambient / 3 : LADDER.ambient;
}

// Room character by room, and in the court by depth: open and dry in the garden, the top
// falling and the trunks closing in a little by the dark bands. Parameter writes only.
function applyTone(t) {
  const deep = room === 'court' ? Math.max(0, Math.min(3, stage - 1)) / 3 : 0; // 0 to 1 by the third band
  const s = Math.min(KEEP_STAGES - 1, stage);
  send.gain.setTargetAtTime(room === 'cave' ? CAVE_SEND : room === 'castle' ? CASTLE_SEND[s] : COURT_SEND * deep, t, 0.05);
  tone8.gain.setTargetAtTime(room === 'cave' ? -2.5 : room === 'castle' ? CASTLE_TONE[s] : room === 'court' ? 0.5 - 2 * deep : 1.5, t, 0.05);
  try { useImpulse(room === 'castle'); } catch { /* the old impulse stays; the send and tone are already set */ }
}

// The castle preset on the shipped send: the long stone impulse in the castle, the cave's short
// one everywhere else. Both impulses are built at unlock; a swap makes no node.
function useImpulse(castle) {
  if (!verb) return;
  const want = castle ? castleImpulse : caveImpulse;
  if (want && verb.buffer !== want) verb.buffer = want;
}

function applyStage(tc) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (room === 'castle') {
    if (!castleBed) return;
    keep.bed.setStage(stage, t, tc);
  } else {
    if (!courtBed) return;
    court.bed.setStage(stage, t, tc);
  }
  applyTone(t);
  scheduleCall(); // the next call comes at the new stage's pace
}

function applyRoom() {
  if (!ctx || !yardBed || !caveBed) return;
  const t = ctx.currentTime;
  yardBed.gain.setTargetAtTime(room === 'yard' ? 1 : 0, t, 0.25);
  caveBed.gain.setTargetAtTime(room === 'cave' ? 1 : 0, t, 0.25);
  if (courtBed) courtBed.gain.setTargetAtTime(room === 'court' ? 1 : 0, t, 0.25);
  if (castleBed) castleBed.gain.setTargetAtTime(room === 'castle' ? 1 : 0, t, 0.25);
  // Room character: the yard is dry with a touch more top; the cave is close, with a lowered top.
  applyTone(t);
  ambient.gain.cancelScheduledValues(t);
  ambient.gain.setTargetAtTime(bedLevel(), t, 0.1); // undo an all-clear thinning
  mix.gain.cancelScheduledValues(t);
  mix.gain.setTargetAtTime(1, t, 0.02); // and a scare's duck
  setSong();
  stopSizzles();
  if (room === 'cave') scheduleDrip();
  else clearTimeout(dripTimer);
  if (room === 'court' && courtBed) {
    court.bed.setStage(stage, t, 0.25);
    scheduleCall();
  } else if (room === 'castle' && castleBed) {
    keep.bed.setStage(stage, t, 0.25);
    scheduleCall();
  } else clearTimeout(callTimer);
}

/** Creates or resumes the context; call from a user gesture. Sound starts at resume(). */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      buildBuses();
      noise = makeNoise();
      startAmbient();
      startCaveBed();
      kit.ctx = ctx;
      kit.noise = noise;
      kit.tone = tone;
      kit.burst = burst;
      kit.beats = beats;
      kit.tell = tellOf;
      startCourtBed();
      startCastleBed();
      startTicks();
      kit.bus.steps = stepsBus;
      kit.bus.monsters = monsters;
      kit.bus.sfx = sfx;
      applyRoom();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    silence();
    ctx = null;
    kit.ctx = null;
  }
}

function silence() {
  try {
    if (master) master.gain.value = 0;
  } catch { /* silent */ }
}

function rampMaster(to, over) {
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(to, t + over);
}

/**
 * Pause (security A1). The gain ramp is the silencer: master goes to 0 over 30 ms, and every
 * voice and bed passes through master. Only after the ramp is the context suspended, which
 * freezes tails so they continue on resume. If that suspend is late or rejects, master is
 * still 0: every failure direction is silence.
 */
export function suspend() {
  paused = true;
  const seq = ++pauseSeq;
  if (!ctx || !master) return;
  try {
    rampMaster(0, 0.03);
  } catch {
    silence();
  }
  setTimeout(() => {
    if (seq !== pauseSeq || !paused || !ctx) return;
    try {
      silence();
      ctx.suspend().catch(() => {});
    } catch { /* master is already at 0 */ }
  }, 40);
}

/** Resume: master is restored only once the context reports 'running'. */
export function resume() {
  paused = false;
  const seq = ++pauseSeq;
  if (!ctx || !master) return;
  const open = () => {
    try {
      if (seq !== pauseSeq || paused || !ctx || ctx.state !== 'running') return;
      rampMaster(muted ? 0 : MASTER, 0.03);
    } catch {
      silence();
    }
  };
  try {
    // Always asked for, even when 'running': a suspend still in flight is then undone in order.
    ctx.resume().then(open, () => {});
  } catch { /* silent */ }
}

/** Mute silences within 20 ms; while muted play() starts nothing. Unmute reopens master. */
export function setMuted(m) {
  muted = !!m;
  try {
    if (!master || !ctx || paused) return; // paused: master stays at 0 until resume()
    if (muted) rampMaster(0, 0.015);
    else if (ctx.state === 'running') rampMaster(MASTER, 0.03);
  } catch {
    silence();
  }
}

// Sustained world sounds, strips and placements: dropped at setRoom and at the win and lose
// cards (security A7). audio.js never calls spatial.release(id).
function releaseWorld() {
  try { stopSizzles(); } catch { /* silent */ }
  try { stopHums(); } catch { /* silent */ }
  try { stopFlow(); } catch { /* silent */ }
  try { stopTick(); } catch { /* silent */ }
  spatial.clear();
  pools.length = 0;
  gonePool = null;
}

/**
 * Picks the room's cue table and ambient bed: 'yard', 'cave', 'court' or 'castle'. cfg (optional) is the
 * room config; the cave reads cfg.pool.life for how long a pool sizzles. Starts at chamber 1
 * (in the court, at stage 0 with nothing being read) and drops all sound state: strips, the
 * scare flag and the counts.
 */
export function setRoom(name, cfg) {
  room = name === 'cave' ? 'cave' : name === 'court' ? 'court' : name === 'castle' ? 'castle' : 'yard';
  chamber = 0;
  stage = 0;
  reading = false;
  earSet = false; // the new room's first update() places the listener again (#19)
  scareUsed = false;
  played = {};
  peakHums = 0;
  if (cfg && cfg.pool && cfg.pool.life) poolLife = cfg.pool.life;
  if (cfg && cfg.bellows && cfg.bellows.boltLife) boltLife = cfg.bellows.boltLife;
  veils = (cfg && cfg.veils) || null;
  hissMem = newHiss(); // a new room starts silent: the snakes build up again from the warden's first steps
  hissClock = NaN;
  try { if (ctx) keep.bed.setHiss(0, ctx.currentTime); } catch { /* silent */ }
  releaseWorld();
  spatial.resetCounts();
  try {
    applyRoom();
  } catch { /* silent */ }
}

/** Sets the song level by 0-based chamber index (play('waveStart', ev) does this by itself). */
export function setChamber(index) {
  chamber = Math.max(0, index | 0);
  try {
    setSong();
  } catch { /* silent */ }
}

/**
 * Sets the court's (or the castle's, 0 to 6: bridge, hall, tea room, gallery, Knight's Walk,
 * upstairs, the Count's room) bed by 0-based stage index: 0 the court (one bird), 1 to 4 the bands of the
 * wood (birds, then owls and far howls, then rain coming), 5 the approach (rain). The bed
 * crossfades over a few seconds. play() follows `waveStart`, `checkpoint` and `restored` by
 * itself; this is for the caller that knows the stage some other way.
 */
export function setStage(index) {
  const top = room === 'castle' ? KEEP_STAGES - 1 : STAGES - 1;
  const i = isNum(index) ? Math.max(0, Math.min(top, Math.floor(index))) : 0;
  if (i === stage) return;
  stage = i;
  try {
    if (room === 'court' || room === 'castle') applyStage(1.5);
  } catch { /* silent */ }
}

/**
 * A story card or the log opens (true) or closes (false). The sim is frozen but the audio is
 * not suspended: the bed drops to a third and a page sound plays, and both are undone on close.
 * A page turned inside the log is play('page').
 */
export function setReading(open) {
  const on = !!open;
  if (on === reading) return;
  reading = on;
  try {
    if (ctx && ambient) {
      const t = ctx.currentTime;
      ambient.gain.cancelScheduledValues(t);
      ambient.gain.setTargetAtTime(bedLevel(), t, 0.12);
    }
  } catch { /* silent */ }
  play('page');
}

// --- building blocks -------------------------------------------------------

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function mark(end) {
  if (end > span) span = end;
}

function tone(type, f0, f1, t, dur, peak, attack = 0.004, dest = route) {
  if (probing) return mark(t + attack + dur);
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
  return o;
}

function burst(filterType, freq, q, t, dur, peak, sweepTo, attack = 0.002, dest = route) {
  if (probing) return mark(t + attack + dur);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = long; // the cave's long sweeps outlast the one-second buffer
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, attack, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + dur + 0.05);
}

// One noise source struck several times: `offsets` are the beats, each `dur` long. 3 nodes.
function beats(filterType, freq, q, t, offsets, dur, peak, attack = 0.003, dest = route) {
  const last = offsets[offsets.length - 1];
  if (probing) return mark(t + last + attack + dur);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  for (const off of offsets) env(g, t + off, peak, attack, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + last + attack + dur + 0.05);
}

// The wet layer of a tread crossing water: the wet family's falling plop. 2 nodes.
function plop(t, peak, k = 1) {
  tone('sine', 420 * k, 160 * k, t, 0.06, peak, 0.003);
}

// The noise of a blow leans toward the side it came from; the thump stays centred. 1 node.
function lean(ev) {
  if (probing || !ev) return route;
  let side = 0;
  if (isNum(ev.side)) side = ev.side;
  else if (isNum(ev.fromX) && isNum(ev.fromZ)) {
    const dx = ev.fromX - listener.x;
    const dz = ev.fromZ - listener.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) side = (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d;
  }
  if (!side) return route;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(side, -1, 1, 0) * 0.7;
  p.connect(route);
  return p;
}

// A creature's own chokeable input (spatial.tell), for its wind-up sounds; a flinch chokes it.
function tellOf(ev) {
  if (probing) return route;
  if (live && target && target.kind === 'enemy' && ev && ev.id != null && target.id === ev.id) {
    return spatial.tell(ev.id) || route;
  }
  return route;
}

// A low hum that travels with a Bellows bolt, on a strip that follows it; six at most. 3 nodes.
// It is a sustained sound, counted beside the one-shot voices; update() ends it with its bolt.
function hum(t, ev) {
  if (probing || !live || !ev || hums.length >= MAX_HUMS) return;
  const s = spatial.bolt(ev.x, ev.z);
  if (!s) return;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(92, t);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 620; // keeps partials above 300 Hz, so it survives laptop speakers
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(LADDER.tread, t + 0.05);
  o.connect(f).connect(g).connect(s.in);
  o.start(t);
  o.stop(t + boltLife + 0.2);
  const entry = { o, s };
  hums.push(entry);
  if (hums.length > peakHums) peakHums = hums.length;
  o.onended = () => {
    const i = hums.indexOf(entry);
    if (i >= 0) hums.splice(i, 1);
  };
}

// The flow (R4): water heard running down a rill from the valve's release until it reaches the
// bed. One looped noise band on a placement of its own, begun by the valveTurn cue (so inside
// the gate) and scheduled to end by itself when the travel time is up; update() carries the
// placement along the rill with the front and ends the loop early when the sim says the water
// has landed, drained or been restored away. 3 nodes on a placement (3 more), four at most.
function flow(t, ev) {
  if (probing || !live || !ev) return;
  const fl = Number.isInteger(ev.index) ? COURT.flows[ev.index] : null;
  const total = clamp(ev.flow, 0.2, 6, 0);
  if (!fl || !total) return;
  stopFlow(ev.index);
  const s = spatial.at(fl.from.x, fl.from.z, false);
  if (!s) return; // too far up the court to hear
  const dest = spatial.voice(s, total + FLOW_FADE + 0.1);
  const peak = lv('waterArrive') * FLOW_LEVEL;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.1;
  f.frequency.setValueAtTime(700, t);
  f.frequency.exponentialRampToValueAtTime(1500, t + total); // the rill fills as the front runs on
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.15);
  g.gain.setValueAtTime(peak, t + total);
  g.gain.exponentialRampToValueAtTime(0.0001, t + total + FLOW_FADE);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + total + FLOW_FADE + 0.05);
  const entry = { i: ev.index, g, src, s, fl, total };
  flowing.push(entry);
  src.onended = () => {
    const at = flowing.indexOf(entry);
    if (at >= 0) flowing.splice(at, 1);
  };
}

// Ends the flow in one rill (or, with no index, in all of them). Parameter writes only.
function stopFlow(index) {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let k = flowing.length - 1; k >= 0; k--) {
    const fw = flowing[k];
    if (index != null && fw.i !== index) continue;
    flowing.splice(k, 1);
    try {
      fw.src.onended = null;
      // Held where it is, so a stop inside the attack does not step.
      if (typeof fw.g.gain.cancelAndHoldAtTime === 'function') fw.g.gain.cancelAndHoldAtTime(t);
      else {
        fw.g.gain.cancelScheduledValues(t);
        fw.g.gain.setValueAtTime(fw.g.gain.value, t);
      }
      fw.g.gain.setTargetAtTime(0, t, 0.03);
      fw.src.stop(t + 0.2);
    } catch { /* silent */ }
  }
}

// Carries each flow along its rill with the water's front, and ends one whose water is no
// longer travelling (sim.waves.flows[i] is the seconds of travel left).
function followFlows(sim) {
  const left = sim && sim.waves && sim.waves.flows;
  for (let k = flowing.length - 1; k >= 0; k--) {
    const fw = flowing[k];
    const now = left ? left[fw.i] : 0;
    if (!(now > 0)) {
      stopFlow(fw.i);
      continue;
    }
    const along = fw.fl.length * clamp(1 - now / fw.total, 0, 1, 0);
    fw.s.x = fw.fl.from.x + fw.fl.dir.x * along;
    fw.s.z = fw.fl.from.z + fw.fl.dir.z * along;
  }
}

// The clocks' ticking (castle design): five looped tick patterns, one per clock, built at unlock
// with the castle's bed (3 nodes a clock) and left running at zero gain. A clock that is right
// has its gain opened; nothing is ever created at play time, so a clock set right while muted
// ticks the moment the sound is back. The truth is the sim: update() reads sim.waves.clocks
// (or done.clocks) once a frame and opens or shuts what differs; follow() carries the events
// meanwhile (a setting, a restore) so even a muted run keeps the right state.
const CLOCKS = 5;
const ticks = [];
const tickWant = [false, false, false, false, false];
let earSet = false; // update() has told us where the listener is; until then a tick plays at full strength

// #19: a clock's tick carries only so far. The gain is the clock's own level (open or shut) times
// clocks.js tickGain of the listener's distance from that clock, less again outside the tea room
// (the wall). A parameter write each frame on nodes that already exist; nothing is created.
function tickTarget(i) {
  if (!tickWant[i]) return 0;
  const base = lv('clockSet') * 0.5;
  const c = CLOCK_SPOTS[i];
  if (!earSet || !c) return base;
  return base * tickGain(Math.hypot(listener.x - c.x, listener.z - c.z), keepZoneAt(listener.x, listener.z) !== 'tea');
}

function startTicks() {
  try {
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, rate * 2, rate); // 2 s: tick, tock, tick, tock
    const d = buf.getChannelData(0);
    [[0, 1], [0.5, 0.75], [1, 1], [1.5, 0.75]].forEach(([at, amp]) => {
      const from = Math.floor(rate * at);
      for (let n = 0; n < rate * 0.04 && from + n < d.length; n++) d[from + n] = (Math.random() * 2 - 1) * amp * Math.exp(-n / (rate * 0.006));
    });
    for (let i = 0; i < CLOCKS; i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      if (src.playbackRate) src.playbackRate.value = 1 + 0.013 * i; // five clocks never tick in step
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400 + 160 * i;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(sfx);
      src.start();
      ticks.push(g);
    }
    // A state recorded before unlock() (a clock set right while there was no context) is not lost.
    for (let i = 0; i < CLOCKS; i++) {
      if (tickWant[i]) ticks[i].gain.setTargetAtTime(tickTarget(i), ctx.currentTime, 0.01);
    }
  } catch { /* the clocks tick silently */ }
}

/** Opens or shuts one clock's tick (a parameter write only). */
function setTick(i, on) {
  if (!Number.isInteger(i) || i < 0 || i >= CLOCKS || tickWant[i] === on) return;
  tickWant[i] = on;
  if (!ctx || !ticks[i]) return;
  try {
    ticks[i].gain.setTargetAtTime(tickTarget(i), ctx.currentTime, on ? 0.01 : 0.03);
  } catch { /* silent */ }
}

function stopTick() {
  for (let i = 0; i < CLOCKS; i++) setTick(i, false);
}

/** The clocks the sim says are right: every one once the strike is done, else those at the hour. */
function followClocks(sim) {
  const w = sim && sim.waves;
  if (!w || !w.clocks || !Array.isArray(w.clocks.hours)) return;
  const right = (sim.cfg && sim.cfg.clocks && sim.cfg.clocks.right) || 12;
  const all = !!(w.done && w.done.clocks);
  for (let i = 0; i < CLOCKS; i++) {
    setTick(i, all || w.clocks.hours[i] === right);
    if (tickWant[i] && ticks[i]) ticks[i].gain.setTargetAtTime(tickTarget(i), ctx.currentTime, 0.1); // follows the listener (#19)
  }
}

function stopHums() {
  if (!ctx) return;
  for (const h of hums.splice(0)) {
    try {
      h.o.stop(ctx.currentTime + 0.05);
    } catch { /* silent */ }
  }
}

// All clear: the room's bed thins for the win beat. A parameter write; it makes no voice.
function thinBed(t) {
  if (probing || !ambient) return;
  ambient.gain.cancelScheduledValues(t);
  ambient.gain.setTargetAtTime(bedLevel() * 0.4, t, 0.3);
}

const lv = (name) => CATALOGUE[name].level;

function bell(t, base, peak, decay = 1.5) {
  tone('sine', base, base, t, decay, peak, 0.005);
  tone('sine', base * 2.76, base * 2.76, t, decay * 0.6, peak * 0.4, 0.005);
}

// A quiet sizzle for as long as a pool lives, at its pool (at the bed's level, as shipped).
function sizzle(t, dur) {
  if (probing) return;
  const dest = spatial.voice(target, dur + 0.1, LADDER.ambient) || caveBed;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 4800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
  g.gain.setValueAtTime(0.16, t + Math.max(0.1, dur - 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.1);
  const entry = { g, src, end: t + dur };
  sizzles.push(entry);
  src.onended = () => {
    const i = sizzles.indexOf(entry);
    if (i >= 0) sizzles.splice(i, 1);
  };
}

function stopSizzles() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const s of sizzles.splice(0)) {
    try {
      s.g.gain.cancelScheduledValues(t);
      s.g.gain.setTargetAtTime(0, t, 0.05);
      s.src.stop(t + 0.3);
    } catch { /* silent */ }
  }
}

// The Cantor's two voices, an uneven interval apart, for its discrete phrases.
function voices(t, dur, peak, bendA, bendB, attack = 0.05) {
  tone('sine', 196, 196 * bendA, t, dur, peak, attack);
  tone('sine', 277.4, 277.4 * bendB, t, dur, peak * 0.9, attack);
}

const CUES = {
  ...wayout.yard, // issue #29: the last foe spins off, the blast, the crater (sceneStart, craterBlast, sceneEnd)
  shot(t) {
    const v = 1 + (Math.random() - 0.5) * 0.08;
    burst('bandpass', 1800 * v, 0.9, t, 0.04, 0.9);
    tone('square', 180 * v, 60, t, 0.09, 0.35);
  },
  dry(t) {
    burst('highpass', 4000, 0.7, t, 0.015, 0.4);
    tone('sine', 2000, 2000, t, 0.02, 0.15);
  },
  reloadStart(t) {
    tone('triangle', 120, 110, t, 0.06, 0.5);
  },
  reloadDone(t) {
    for (let i = 0; i < 3; i++) burst('highpass', 3000, 1, t + i * 0.05, 0.012, 0.3);
    tone('triangle', 200, 180, t + 0.16, 0.07, 0.5);
  },
  hit(t) {
    tone('sine', 1400, 1400, t, 0.03, 0.35);
  },
  kill(t) {
    tone('sine', 1400, 1400, t, 0.03, 0.35);
    tone('sine', 220, 50, t + 0.02, 0.25, 0.6);
  },
  windup(t) {
    tone('sawtooth', 90, 240, t, 0.3, 0.12, 0.02);
  },
  swipe(t) {
    burst('bandpass', 600, 1.5, t, 0.16, 0.35, 2400, 0.02);
  },
  inhale(t) {
    burst('lowpass', 300, 0.8, t, 0.55, 0.3, 2200, 0.3);
  },
  boltFired(t, ev) {
    tone('sine', 140, 60, t, 0.18, 0.5);
    burst('lowpass', 900, 0.7, t, 0.12, 0.3);
    hum(t, ev);
  },
  boltBurst(t) {
    burst('bandpass', 900, 1.2, t, 0.12, 0.25);
  },
  hurt(t, ev) {
    tone('sine', 70, 55, t, 0.2, 0.9);
    burst('lowpass', 1200, 0.7, t, 0.06, 0.6, undefined, undefined, lean(ev));
  },
  pickup(t) {
    tone('sine', 660, 660, t, 0.1, 0.35);
    tone('sine', 990, 990, t + 0.09, 0.16, 0.35);
  },
  waveStart(t) {
    bell(t, 392, 0.4);
  },
  won(t) {
    bell(t, 392, 0.4);
    bell(t + 0.45, 494, 0.4);
    bell(t + 0.9, 587, 0.45, 2.2);
  },
  lost(t) {
    bell(t, 330, 0.45, 2.2);
    tone('sine', 318, 300, t, 2.2, 0.2, 0.01);
  },

  // ---- new with the audio pass: terse and physical, each authored to its catalogue level ----
  // The warden dies: a body-weight drop and a breath out.
  died(t) {
    const L = lv('died');
    tone('sine', 110, 45, t, 0.35, L, 0.006);
    burst('lowpass', 500, 0.8, t, 0.18, L * 0.6, 200, 0.005);
    burst('bandpass', 900, 0.8, t + 0.25, 0.7, L * 0.25, 500, 0.15);
  },
  // Arrival at a gate: a lamp-strike hiss and a gate rattle; the Bellows' is lower and longer.
  spawn(t, ev) {
    const L = lv('spawn');
    const big = !!(ev && ev.enemy === 'bellows');
    const k = big ? 0.62 : 1;
    const d = big ? 1.8 : 1;
    burst('highpass', 3500 * k, 0.7, t, 0.09 * d, L, null, 0.004);
    burst('bandpass', 700 * k, 5, t + 0.03 * d, 0.05 * d, L * 0.8, null, 0.003);
    tone('square', 240 * k, 200 * k, t + 0.09 * d, 0.06 * d, L * 0.5, 0.003);
  },
  // Every creature can be heard moving: one voice each, plus a plop when it crosses water.
  tread(t, ev) {
    const k = 1 + (Math.random() - 0.5) * 0.12; // pitch within 6 percent
    const L = lv('tread') * 10 ** ((-Math.random() * 1.5) / 20); // level within 1.5 dB, never over
    const wet = !!(ev && ev.wet);
    const who = ev && ev.enemy;
    if (who === 'bellows') {
      // A slow leathery thump with a wheeze.
      burst('lowpass', 320 * k, 1.2, t, 0.09, L, 140, 0.006);
      burst('bandpass', 1100 * k, 3, t + 0.05, 0.16, L * 0.3, 700, 0.05);
    } else if (who === 'lurch') {
      // A wet three-beat patter.
      beats('bandpass', 1500 * k, 3, t, [0, 0.05, 0.11], 0.022, L);
      tone('sine', 520 * k, 260 * k, t, 0.03, L * 0.35, 0.003);
    } else if (who === 'weeper') {
      // A slow root drag.
      burst('bandpass', 420 * k, 1.5, t, 0.2, L, 260, 0.05);
      tone('sawtooth', 70 * k, 62 * k, t, 0.18, L * 0.25, 0.05);
    } else if (who === 'cantor') {
      // A heavy scrape and set-down.
      burst('bandpass', 600 * k, 1.2, t, 0.2, L * 0.55, 300, 0.05);
      tone('sine', 85 * k, 45, t + 0.2, 0.14, L, 0.006);
      if (!wet) burst('lowpass', 500 * k, 0.8, t + 0.2, 0.05, L * 0.6, null, 0.004);
    } else {
      // Wick (and anything unnamed): quick dry wire-and-glass ticks.
      burst('bandpass', 3800 * k, 9, t, 0.012, L, null, 0.002);
      tone('sine', 2600 * k, 2500 * k, t + 0.012, 0.02, L * 0.4, 0.002);
    }
    if (wet) plop(t + (who === 'cantor' ? 0.2 : 0), L * 0.4, k);
  },
  // A kill drops a pickup: a small clink where it lands.
  drop(t) {
    const L = lv('drop');
    burst('bandpass', 2800, 12, t, 0.03, L, null, 0.003);
    tone('sine', 2100, 2050, t, 0.04, L * 0.4, 0.003);
  },
  // Rescue crate: a crate set-down and one soft chime at its pad.
  rescueCrate(t) {
    const L = lv('rescueCrate');
    burst('lowpass', 400, 1, t, 0.1, L, 150, 0.005);
    tone('sine', 95, 60, t, 0.1, L * 0.7, 0.005);
    tone('sine', 880, 880, t + 0.14, 0.5, L * 0.35, 0.01);
  },
  // Surge cleared: one low bell, the cave's cleared bell a fourth lower and drier.
  waveCleared(t) {
    bell(t, 294 * 0.75, lv('waveCleared'), 0.9);
  },
  // All clear: the bed thins for the win beat (no voice is made).
  allClear: Object.assign((t) => thinBed(t), { quiet: true }),
};
CUES.empty = CUES.dry;

// The warden's feet (steps.js), at the catalogue levels; `k` (0..1) only ever lowers them.
const feet = (fn) => Object.assign(fn, { feet: true });
CUES.step = feet((ev, k) => {
  const r = CATALOGUE.step.range;
  return steps.step(ev, (ev && ev.gait === 'run' ? r[1] : r[0]) * k);
});
CUES.jump = feet((ev, k) => steps.jump(ev, lv('jump') * k));
CUES.land = feet((ev, k) => steps.land(ev, CATALOGUE.land.range[0] * k, CATALOGUE.land.range[1] * k));
CUES.splash = feet((ev, k) => steps.splash(ev, lv('splash') * k));

// Cave cues, under the sim's event names. `ev` is the event when the caller passes it.
const CAVE_CUES = {
  ...CUES,
  ...wayout.cave, // issue #29: the Cantor's last blast, the vault coming down (sceneStart, vaultBreak, sceneEnd)
  // Salt Bore: lowpassed boom with a sine thump, a second of salt hiss, then the pump's two ticks.
  shot(t) {
    burst('lowpass', 900, 0.7, t, 0.07, 1.0);
    tone('sine', 110, 40, t, 0.22, 0.9);
    burst('highpass', 3600, 0.5, t + 0.03, 1.0, 0.11, null, 0.02);
    burst('bandpass', 1400, 3, t + 0.3, 0.025, 0.4);
    tone('square', 160, 120, t + 0.3, 0.03, 0.18);
    burst('bandpass', 1900, 3, t + 0.43, 0.025, 0.45);
    tone('square', 210, 150, t + 0.43, 0.03, 0.18);
  },
  // Reload: hinge creak, a pour of grains, and (on reloadDone) the snap shut.
  reloadStart(t) {
    tone('sawtooth', 62, 150, t, 0.42, 0.1, 0.06);
    tone('sawtooth', 64.5, 141, t + 0.03, 0.4, 0.07, 0.06);
    for (let i = 0; i < 11; i++) {
      burst('highpass', 4200 + Math.random() * 2500, 1, t + 0.5 + i * 0.1 + Math.random() * 0.04, 0.05, 0.1);
    }
  },
  reloadDone(t) {
    burst('bandpass', 1200, 2, t, 0.03, 0.6);
    tone('triangle', 150, 90, t, 0.08, 0.5);
  },
  hit(t, ev) {
    tone('sine', 1400, 1400, t, 0.03, 0.3);
    burst('highpass', 5000, 1, t, 0.03, 0.2); // salt on hide
    if (ev && ev.crit) tone('sine', 2100, 2100, t + 0.04, 0.05, 0.3);
  },
  kill(t, ev) {
    if (ev && ev.enemy === 'cantor') {
      // The two voices slide into unison and stop.
      tone('sine', 196, 233, t, 1.15, 0.4, 0.05);
      tone('sine', 277.4, 233, t, 1.15, 0.4, 0.05);
      tone('sine', 98, 58, t, 1.2, 0.3, 0.1);
      return;
    }
    if (ev && ev.cause === 'boss') return; // felled with the Cantor: its note covers them
    tone('sine', 1400, 1400, t, 0.03, 0.3);
    burst('lowpass', 700, 1.2, t + 0.01, 0.16, 0.45, 180);
    tone('sine', 170, 55, t + 0.02, 0.22, 0.45);
  },
  spawn(t, ev) {
    if (ev && ev.enemy === 'cantor') {
      // The Cantor appears: a long low unfolding groan with an audible upper partial (new).
      const L = lv('spawn');
      tone('sawtooth', 52, 78, t, 1.6, L, 0.4);
      tone('sine', 392, 415, t + 0.2, 1.3, L * 0.35, 0.3);
      burst('lowpass', 180, 2, t, 1.6, L * 0.6, 420, 0.5);
      return;
    }
    tone('sine', 190, 85, t, 0.08, 0.1);
  },
  // Lurch: wet clicks that quicken and rise through the coil, a swoosh on the leap, a slap on a miss.
  coil(t, ev) {
    const tell = tellOf(ev);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const at = t + 0.48 * (i / n) ** 0.62;
      burst('bandpass', 2200 + i * 150, 6, at, 0.012, 0.3, null, 0.001, tell);
      tone('sine', 620 + i * 70, 320, at, 0.02, 0.1, 0.002, tell);
    }
  },
  leap(t) {
    burst('bandpass', 500, 1.2, t, 0.22, 0.4, 2600, 0.03);
  },
  leapMiss(t) {
    burst('lowpass', 700, 0.8, t, 0.07, 0.35);
    tone('sine', 120, 70, t, 0.08, 0.3);
  },
  // The pack coils together (R9): one rising chitter for the group, where the warden stands in
  // the ring, in place of each member's own clicks (their coil sounds, begun this same frame,
  // are choked; a lone Lurch keeps its own).
  packRush(t, ev) {
    const L = lv('packRush');
    if (!probing && live && ev && Array.isArray(ev.ids)) {
      for (let i = 0; i < ev.ids.length && i < 8; i++) spatial.choke(ev.ids[i], 0.6);
    }
    const at = [0, 0.09, 0.17, 0.24, 0.3, 0.35, 0.39, 0.425, 0.455, 0.48];
    beats('bandpass', 2300, 6, t, at, 0.012, L, 0.002);
    beats('bandpass', 3400, 8, t + 0.02, at, 0.012, L * 0.7, 0.002);
    tone('sine', 520, 1350, t, 0.48, L * 0.3, 0.05);
  },
  flinch(t, ev) {
    // A choked click, and whatever wind-up the flinched creature was sounding is cut off.
    if (!probing && live && ev && ev.id != null) spatial.choke(ev.id, 0.7);
    burst('bandpass', 900, 8, t, 0.02, 0.5);
    tone('square', 300, 120, t, 0.04, 0.2);
  },
  // Weeper: rising gulp on the swell, low plop on release, splat and a sizzle while the pool lives.
  globTell(t, ev) {
    const tell = tellOf(ev);
    tone('sine', 110, 330, t, 0.6, 0.3, 0.08, tell);
    burst('lowpass', 250, 2, t, 0.6, 0.16, 720, 0.2, tell);
  },
  globLaunch(t, ev) {
    tone('sine', 260, 70, t, 0.14, 0.4);
    // In flight: a faint falling whistle from launch to landing (new).
    const flight = clamp(ev && ev.flight, 0.2, 3, 0);
    if (flight) tone('sine', 1500, 600, t + 0.05, flight - 0.05, lv('globLaunch') * 0.15, 0.05);
  },
  // The pool expires: the sizzle's last short fizz (new).
  poolGone(t) {
    burst('highpass', 4800, 0.7, t, 0.14, lv('poolGone'), null, 0.004);
  },
  // A seated Weeper climbs off its ledge: a root scrape and a wet set-down (new).
  unseat(t) {
    const L = lv('unseat');
    burst('bandpass', 500, 1.5, t, 0.25, L * 0.65, 320, 0.05);
    burst('lowpass', 900, 0.8, t + 0.3, 0.09, L, 300, 0.004);
    tone('sine', 300, 110, t + 0.3, 0.07, L * 0.5, 0.004);
  },
  globLand(t) {
    burst('lowpass', 1400, 0.8, t, 0.12, 0.5, 300);
    tone('sine', 150, 60, t, 0.1, 0.3);
    if (sizzles.length < 4) sizzle(t + 0.05, poolLife);
  },
  // Cantor. Its song has stopped; these are the only sounds it makes.
  bossTell(t, ev) {
    if (ev && ev.attack === 'shed') {
      tone('sine', 70, 210, t, 0.75, 0.4, 0.1);
      burst('lowpass', 200, 2, t, 0.75, 0.2, 600, 0.25);
    } else {
      voices(t, 0.9, 0.34, 0.6, 0.56); // Sweep: both voices bend down
    }
  },
  bossSweep(t, ev) {
    const d = (ev && ev.swingTime) || 0.4;
    burst('bandpass', 260, 1, t, d, 0.55, 1900, d * 0.4);
  },
  bossSwingHit(t, ev) {
    const hit = !!(ev && ev.hit);
    tone('sine', 92, 40, t, 0.26, hit ? 0.9 : 0.4);
    burst('lowpass', hit ? 900 : 500, 0.7, t, 0.08, hit ? 0.6 : 0.25);
  },
  bossOpen(t) {
    // Open: a long breathy sag.
    burst('bandpass', 700, 0.6, t, 1.4, 0.22, 220, 0.25);
    tone('sine', 150, 88, t, 1.4, 0.16, 0.2);
  },
  bossShut(t) {
    burst('bandpass', 500, 3, t, 0.05, 0.3);
    tone('sine', 120, 90, t, 0.08, 0.2);
  },
  bossCall(t) {
    // One note that cracks.
    tone('sawtooth', 330, 330, t, 0.22, 0.2, 0.02);
    tone('sawtooth', 497, 468, t + 0.2, 0.5, 0.24, 0.005);
    tone('square', 333, 331, t, 0.7, 0.06, 0.02);
  },
  // Veil: a slow tearing sweep over a low swell (and the reverse when one seals).
  gateOpen(t) {
    burst('bandpass', 400, 2.5, t, 1.2, 0.4, 2600, 0.3);
    tone('sine', 55, 86, t, 1.3, 0.4, 0.5);
  },
  gateSeal(t) {
    burst('bandpass', 2000, 2, t, 0.6, 0.3, 300, 0.1);
    tone('sine', 82, 50, t, 0.6, 0.35, 0.1);
  },
  waveStart(t, ev) {
    if (ev && ev.wave >= 3) tone('sine', 60, 45, t, 1.2, 0.5, 0.05); // the song has stopped: one low breath
    else bell(t, 196, 0.25);
  },
  waveCleared(t) {
    bell(t, 294, 0.2, 1.2);
  },
  won(t) {
    bell(t, 196, 0.35, 2.4);
    bell(t + 0.7, 294, 0.3, 2.6);
  },
};

// Court cues: the yard's table for what the rooms share, the cave's salt gun (the warden
// carries it here), and courtcues.js for everything the level adds or sounds its own way.
const COURT_CUES = {
  ...CUES,
  reloadStart: CAVE_CUES.reloadStart,
  reloadDone: CAVE_CUES.reloadDone,
  hit: CAVE_CUES.hit,
  flinch: CAVE_CUES.flinch,
  ...court.cues,
  // A valve opened by hand: the wheel, and then its water heard running down the rill (R4).
  valveTurn(t, ev) {
    court.cues.valveTurn(t, ev);
    flow(t, ev);
  },
  // The weapon in hand decides: the stake crossbow when `weapon` says so, else the salt gun.
  shot(t, ev) {
    if (isBow(ev)) court.cues.shot(t, ev);
    else CAVE_CUES.shot(t, ev);
  },
};

// Castle cues: the court's table for what the rooms share (the court's weapons, items, words and
// scenes carry over), then keepcues.js for every event the castle adds, and the armour's and the
// wife's own voices over the court's guard and rabbit.
const CASTLE_CUES = {
  ...COURT_CUES,
  ...keep.cues,
  ...keep.creatures(court.cues),
  ...road.cues, // issue #29: the boulder and the bats
  // A right clock is heard to be right: the setting, then its tick for as long as it stands.
  clockSet(t, ev) {
    keep.cues.clockSet(t, ev);
  },
};

const ROOM_CUES = { yard: CUES, cave: CAVE_CUES, court: COURT_CUES, castle: CASTLE_CUES };
// Events whose `id` names a thing in the world (a stake, a pin, a glob), not a creature: they
// play where they happened, never on a creature's strip.
const BY_PLACE = { globLand: 1, stakeLodge: 1, stakePull: 1, stakeBreak: 1, pinThrow: 1, pinStick: 1 };

/** Whether a room has a cue for an event name. Answers from the tables; needs no context. */
export function hasCue(roomName, name) {
  const table = Object.prototype.hasOwnProperty.call(ROOM_CUES, roomName) ? ROOM_CUES[roomName] : null;
  return !!table && Object.prototype.hasOwnProperty.call(table, name) && typeof table[name] === 'function';
}

const FAR = {}; // "placed, but too far to hear": no node is made
const AUDITION = {}; // marks the options object audition() hands to play()

// Where a source sound plays: a creature's strip, a placement at coordinates, or null (centre).
function locate(name, ev, entry) {
  if (!ev) return null;
  if (name === 'globLaunch') return ev.owner != null ? spatial.strip(ev.owner) || FAR : null;
  if (name === 'poolGone') return gonePool ? spatial.at(gonePool.x, gonePool.z, true) || FAR : null;
  if (room !== 'court' && (name === 'gateOpen' || name === 'gateSeal')) {
    const b = veils && veils[ev.veil] && veils[ev.veil].box;
    return b ? spatial.at((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, false) || FAR : null;
  }
  if (room === 'court') {
    const p = placeOf(name, ev); // the gulp at the bed, a hat at its peg: events with no place of their own
    if (p) return spatial.at(p.x, p.z, false) || FAR;
  }
  const creature = entry.who !== 'world' && entry.who !== 'warden';
  if (creature && ev.id != null && !BY_PLACE[name]) return spatial.strip(ev.id, ev.x, ev.z) || FAR;
  if (isNum(ev.x) && isNum(ev.z)) return spatial.at(ev.x, ev.z, creature) || FAR;
  return null;
}

// Room and sound state follow the events even when muted or before the context exists.
// Returns true when this event is the run's one scare.
function follow(name, ev) {
  let scare = false;
  if (room === 'cave') {
    if (name === 'waveStart') {
      chamber = ev && ev.wave ? ev.wave - 1 : chamber;
      try { setSong(); } catch { /* silent */ }
    } else if (name === 'waveCleared' || name === 'allClear' || name === 'won' || name === 'lost') {
      try { stopSizzles(); } catch { /* silent */ }
      pools.length = 0;
    } else if (name === 'globLand') {
      if (ev && isNum(ev.x) && isNum(ev.z) && pools.length < 32) pools.push({ x: ev.x, z: ev.z });
    } else if (name === 'poolGone') {
      gonePool = pools.shift() || null;
    } else if (name === 'bossCall') {
      // Spent by the first Call whether or not it is heard: muted, it is not saved for later.
      scare = !scareUsed;
      scareUsed = true;
    }
  }
  if ((room === 'court' || room === 'castle') && (name === 'waveStart' || name === 'checkpoint' || name === 'restored') && ev) {
    // The bed follows the player's depth: `waveStart` carries the stage, a checkpoint its index.
    const i = name !== 'waveStart' ? ev.index : isNum(ev.stage) ? ev.stage : isNum(ev.wave) ? ev.wave - 1 : ev.index;
    if (isNum(i)) setStage(i);
  }
  // A wrong setting, a restore: the clocks' ticking stops here even when muted.
  if (room === 'castle') {
    if (name === 'clockSet' && ev) setTick(Math.floor(ev.clock), ev.right === true);
    else if (name === 'restored') stopTick(); // update() reopens the ones the restored sim says are right
  }
  // The water has landed, or its valve has slammed shut: its flow stops here even when muted.
  if (room === 'court' && (name === 'waterArrive' || name === 'valveSlam') && ev) {
    try { stopFlow(ev.index); } catch { /* silent */ }
  }
  // The won and lost cards are not pauses: their bells play, sustained world sounds are released.
  if (name === 'won' || name === 'lost') releaseWorld();
  return scare;
}

function centre(k) {
  if (k === 1) return sfx;
  const g = ctx.createGain();
  g.gain.value = k;
  g.connect(sfx);
  return g;
}

/**
 * Plays the cue registered for an event name in the current room. Pass the event as `ev`.
 * This is the single gate (security A4): the only place a voice can be created.
 */
export function play(name, ev, opt) {
  const aud = opt && opt.token === AUDITION ? opt : null;
  const scare = aud ? aud.scare : follow(name, ev);
  if (!ctx || muted) return;
  try {
    if (name === 'drip') {
      // The cave bed's own drip (scheduleDrip), into the bed's echo.
      if (room !== 'cave' || paused || ctx.state !== 'running' || !dripIn) return;
      const f = 1300 + Math.random() * 1500;
      probing = false;
      tone('sine', f, f * 0.55, ctx.currentTime + 0.01, 0.06, 0.25 + Math.random() * 0.3, 0.002, dripIn);
      return;
    }
    if (name === 'call') {
      // The court bed's own birds, owls and howls (scheduleCall), into the bed.
      if ((room !== 'court' && room !== 'castle') || paused || ctx.state !== 'running') return;
      probing = false;
      (room === 'castle' ? keep.bed : court.bed).call(ctx.currentTime + 0.01);
      return;
    }
    if (name === 'page') {
      // A card or the log opening, closing or turning: centred, and counted like any voice.
      if (paused || ctx.state !== 'running') return;
      probing = false;
      route = sfx;
      spatial.voice(null, court.page(ctx.currentTime + 0.001));
      played.page = (played.page || 0) + 1;
      return;
    }
    const table = ROOM_CUES[aud ? aud.room : room];
    const entry = CATALOGUE[name];
    const cue = table[name];
    if (!cue || !entry || !hasCue(aud ? aud.room : room, name)) return;
    const k = aud ? aud.scale : 1;
    live = !aud;
    long = table !== CUES; // the cave's and the court's long sweeps loop the noise
    target = null;

    if (cue.feet) {
      const dur = cue(ev, k);
      if (dur > 0) {
        spatial.voice(null, dur);
        played[name] = (played[name] || 0) + 1;
      }
      return;
    }

    // Dry run: how long does this cue sound for this event? Nothing is created.
    span = 0;
    probing = true;
    try {
      cue(0, ev);
    } finally {
      probing = false;
    }
    const dur = span;
    const t = ctx.currentTime + 0.001;
    if (!(dur > 0)) {
      if (cue.quiet) cue(t, ev); // a parameter write (the bed thinning), not a voice
      return;
    }

    let at = t;
    if (entry.place === 'source') {
      if (aud) target = spatial.at(aud.x, aud.z, false) || FAR;
      else if (name === 'tread') {
        // The only sound the voice budget may skip or cut.
        route = spatial.tread(ev && ev.id, ev ? ev.x : NaN, ev ? ev.z : NaN, dur);
        if (!route) return;
        cue(t, ev);
        played[name] = (played[name] || 0) + 1;
        return;
      } else target = locate(name, ev, entry);
    }
    const scaring = !!(scare && entry.scare);
    if (target === FAR && !scaring) return; // too far to hear: no node is made
    if (scaring) {
      // The one scare: the bed and everything else duck for a quarter second, then the note
      // arrives centred and dry at the scare level and settles back to where the Cantor stands.
      const lead = 0.25;
      mix.gain.cancelScheduledValues(t);
      mix.gain.setValueAtTime(1, t);
      mix.gain.linearRampToValueAtTime(0.12, t + 0.03);
      mix.gain.setValueAtTime(0.12, t + lead);
      mix.gain.linearRampToValueAtTime(1, t + lead + 0.35);
      at = t + lead;
      const g = ctx.createGain();
      const top = (entry.scare.level * k) / entry.level;
      g.gain.setValueAtTime(top, at);
      g.gain.setValueAtTime(top, at + 0.4);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      g.connect(scareBus);
      spatial.voice(null, lead + dur);
      route = g;
      const strip = target;
      target = null;
      cue(at, ev);
      played[name] = (played[name] || 0) + 1;
      if (strip === FAR) return;
      target = strip;
    }
    if (!scaring && cue.hush > 0) {
      // The grin: everything drops for a quarter second, then the chord lands at its ordinary
      // catalogue level. It is not a scare: no scare bus, and nothing above the ladder.
      at = t + cue.hush;
      mix.gain.cancelScheduledValues(t);
      mix.gain.setValueAtTime(1, t);
      mix.gain.linearRampToValueAtTime(0.12, t + 0.03);
      mix.gain.setValueAtTime(0.12, at - 0.012);
      mix.gain.linearRampToValueAtTime(1, at);
    }
    route = spatial.voice(target, at - t + dur, entry.trim * k) || centre(entry.trim * k);
    cue(at, ev);
    if (!scaring) played[name] = (played[name] || 0) + 1;
  } catch { /* silent */ } finally {
    probing = false;
    live = true;
    target = null;
    route = sfx;
  }
}

/**
 * Issue #29: on the road the castle bed's wind and calls fall still, and the sound with no source
 * swells as the light goes (sim.waves.road.dark, the one-way ratchet). Writes parameters only.
 */
function followRoad(sim) {
  const pl = sim && sim.player;
  const on = !!pl && onRoad(pl.x, pl.z);
  const dark = sim && sim.waves && sim.waves.road ? sim.waves.road.dark : 1;
  keep.bed.setStill(on ? 1 : 0, ctx.currentTime);
  road.bed.setHum(on ? 0.35 + 0.65 * dark : 0, ctx.currentTime);
}

/**
 * The snakes in the pit (owner, 2026-11-18): their level from where the warden is (hissLevel: the
 * pit loudest, the bridge medium, the forecourt lower, nothing on the road, the approach or inside),
 * built up over the first steps in, stepped by the sim's own clock. Writes parameters only.
 */
function followHiss(sim) {
  const pl = sim && sim.player;
  if (!pl) return;
  const now = Number.isFinite(sim.time) ? sim.time : NaN;
  const dt = Number.isFinite(hissClock) && now > hissClock ? now - hissClock : 0;
  hissClock = now;
  const under = sim.waves ? sim.waves.under : null;
  keep.bed.setHiss(hissLevel(pl.x, pl.z, hissMem, dt, under), ctx.currentTime);
}

/**
 * Once per playing frame, after the event fan-out: listener is { x, z, yaw } of the player.
 * Moves the strips and ends the hum of a bolt that is gone. It writes parameters on what
 * already exists and never creates a voice (security A4).
 */
export function update(sim, at) {
  if (!ctx) return;
  try {
    if (at) {
      listener.x = at.x;
      listener.z = at.z;
      listener.yaw = at.yaw;
      earSet = true;
    }
    if (flowing.length) followFlows(sim);
    if (room === 'castle') followClocks(sim);
    if (room === 'castle') followRoad(sim); // issue #29
    if (room === 'castle') followHiss(sim); // the snakes in the pit
    if (room === 'court' && courtBed) court.bed.setRain(weatherNow(sim, _sky).rain, ctx.currentTime); // #28
    spatial.update(sim, at);
    for (let i = hums.length - 1; i >= 0; i--) {
      const h = hums[i];
      if (!h.s.gone) continue;
      hums[i] = hums[hums.length - 1];
      hums.pop();
      try {
        h.o.onended = null;
        h.o.stop(ctx.currentTime + 0.06); // its strip has already faded
      } catch { /* silent */ }
    }
  } catch { /* silent */ }
}

/**
 * A fresh snapshot of the audio layer. `voices` is what is sounding now (one-shot cues plus
 * bolt hums), `strips` the per-source strips, `played` the cues sounded since the run began,
 * `dropped` the monster treads the voice budget skipped or cut. Peaks are since setRoom.
 */
export function stats() {
  let s;
  try {
    s = spatial.stats();
  } catch {
    s = { strips: 0, spots: 0, voices: 0, dropped: 0, peakVoices: 0, peakStrips: 0 };
  }
  return {
    state: ctx ? ctx.state : 'none',
    voices: s.voices + hums.length,
    strips: s.strips,
    played: { ...played },
    dropped: s.dropped,
    spots: s.spots,
    peakVoices: s.peakVoices + peakHums, // never under the true peak
    peakStrips: s.peakStrips,
    muted,
    paused,
    hiss: { level: hissMem.level, walked: hissMem.walked, gain: keep.bed.hissGain() }, // the snakes, as they stand
  };
}

// ---- the bound the smoke run asserts (security A7) ---------------------------------------
// Worst case at once: 24 treads (the budget) + every creature that can be alive, each sounding
// its tell, its strike, its death and a pool sizzle + six bolt hums + the player's and the
// room's few (weapon, reload, hit, hurt, step, landing, splash, pickup, bell, veil, drop, crate).
export const VOICES_PER_MONSTER = 4;
export const PLAYER_VOICES = 12;

/** { voices, strips } a room's config can never exceed. */
export function bounds(cfg) {
  const crowd = ((cfg && cfg.maxAlive) || 0) + ((cfg && cfg.cantor && cfg.cantor.callMax) || 0);
  return {
    voices: LIMITS.voices + crowd * VOICES_PER_MONSTER + MAX_HUMS + PLAYER_VOICES,
    // A creature that dies keeps its strip until its death sound ends, while its replacement
    // already has one: twice the crowd, plus one strip per humming bolt.
    strips: crowd * 2 + MAX_HUMS,
  };
}

// ---- audition: the QA-only listening check (security A5) ---------------------------------
const GAITS = ['walk', 'run'];
const ENEMIES = ['wick', 'bellows', 'lurch', 'weeper', 'cantor'];
const ROOMS = ['yard', 'cave', 'court', 'castle'];
// What an audition may ask of the court's cues, each a value the level's rules can produce.
const COURT_ENEMIES = ['guard', 'gardener', 'rabbit', 'hatter', 'bat', 'caterpillar', 'armour', 'wife'];
const MOVES = ['halberd', 'brush', 'lunge', 'kick', 'swoop', 'whip', 'volley', 'pike'];
// The castle's: a haunt's kind, a stock-take's, a scene's, and the board's pieces.
const KINDS = ['furniture', 'horse', 'box', 'window', 'mirror', 'tall', 'salt', 'stakes', 'strike', 'pyre'];
const PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const WEAPONS = ['salt', 'crossbow', 'halberd', 'cup'];
const ITEMS = ['garlic', 'carrot', 'cup', 'stakes', 'crossbow', 'salad', 'halberd'];
const PLACES = ['patch', 'bowl', 'stream', 'pipe'];
const PUZZLES = ['roses', 'rabbit', 'hatter', 'bat', 'caterpillar'];
const SPEAKERS = ['renfield', 'rabbit'];
const IMPACT = [0, 11]; // m per s: a walked-in splash to the heaviest landing steps.js weighs
const GRAVITY = 22;

/**
 * Pure: resolves an audition through the catalogue and clamps every option to what the sim
 * can produce. Returns null for an unknown cue, else { name, room, ev, level, scale, scare,
 * distance, bearing }, where `level` is the highest gain the audition can reach: never above
 * the entry's own ceiling, and never above the scare tier.
 */
export function clampAudition(name, opts, currentRoom = 'yard') {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOGUE, name)) return null;
  const entry = CATALOGUE[name];
  const o = opts && typeof opts === 'object' ? opts : {};
  const pick = (v, list, dflt) => (typeof v === 'string' && list.includes(v) ? v : dflt);
  const roomName = pick(o.room, ROOMS, ROOMS.includes(currentRoom) ? currentRoom : 'yard');
  const gait = pick(o.gait, GAITS, 'walk');
  const material = typeof o.material === 'string' && Object.prototype.hasOwnProperty.call(MATERIALS, o.material)
    ? o.material : roomName === 'cave' ? 'rock' : roomName === 'court' ? 'grass' : roomName === 'castle' ? 'ashlar' : 'concrete';
  const impact = clamp(o.impact, IMPACT[0], IMPACT[1], name === 'land' ? 7 : 0);
  const scare = o.scare === true && !!entry.scare;
  let ceiling = entry.level * entry.trim;
  if (scare) ceiling = entry.scare.level;
  else if (name === 'step') ceiling = gait === 'run' ? entry.range[1] : entry.range[0];
  else if (entry.range) ceiling = entry.range[1];
  ceiling = Math.min(ceiling, LADDER.scare);
  const level = clamp(o.level, 0, ceiling, ceiling);
  const who = ENEMIES.includes(entry.who) ? entry.who : 'wick';
  const ev = {
    type: name,
    gait,
    material,
    surface: MATERIALS[material],
    foot: o.foot === 1 ? 1 : 0,
    impact,
    fall: (impact * impact) / (2 * GRAVITY),
    enemy: pick(o.enemy, ENEMIES, pick(o.enemy, COURT_ENEMIES, who)),
    wet: o.wet === true,
    attack: pick(o.attack, ['sweep', 'shed'], 'sweep'),
    hit: o.hit === true,
    crit: o.crit === true,
    wave: Math.round(clamp(o.wave, 1, 3, 1)),
    swingTime: clamp(o.swingTime, 0.2, 1, 0.4),
    flight: clamp(o.flight, 0.2, 3, 1),
    side: clamp(o.side, -1, 1, 0),
    // The court's payloads.
    move: pick(o.move, MOVES, 'halberd'),
    weapon: pick(o.weapon, WEAPONS, 'salt'),
    item: pick(o.item, ITEMS, 'garlic'),
    at: pick(o.at, PLACES, 'patch'),
    puzzle: pick(o.puzzle, PUZZLES, 'roses'),
    who: pick(o.who, SPEAKERS, 'renfield'),
    stage: Math.round(clamp(o.stage, 0, STAGES - 1, 0)),
    on: o.on !== false,
    red: o.red !== false,
    worn: o.worn === true,
    plain: o.plain === true,
    // The castle's payloads.
    kind: pick(o.kind, KINDS, 'furniture'),
    piece: pick(o.piece, PIECES, 'pawn'),
    right: o.right === true,
    first: o.first === true,
    from: 'b1',
    to: 'c3',
  };
  return {
    name,
    room: roomName,
    ev,
    level,
    scale: ceiling > 0 ? level / ceiling : 0,
    scare,
    distance: clamp(o.distance, 0, name === 'tread' ? LIMITS.treadAudible : LIMITS.audible, 0),
    bearing: clamp(o.bearing, -Math.PI, Math.PI, 0),
  };
}

/**
 * Plays any catalogue cue on demand through the real buses at the real levels, for the
 * listening check: audition('step', { gait: 'run', material: 'plank' }), audition('land',
 * { material: 'grass', impact: 9 }), audition('tread', { enemy: 'lurch', distance: 8,
 * bearing: -1 }). Goes through play()'s gate (muted: silent), touches no game state and no
 * run state, plays nothing for an unknown name and never throws.
 */
export function audition(name, opts) {
  try {
    const a = clampAudition(name, opts, room);
    if (!a || !(a.scale > 0)) return;
    // Placed by distance and bearing (radians, clockwise from dead ahead) from the listener.
    const fx = -Math.sin(listener.yaw);
    const fz = -Math.cos(listener.yaw);
    const c = Math.cos(a.bearing);
    const s = Math.sin(a.bearing);
    play(a.name, a.ev, {
      token: AUDITION,
      room: a.room,
      scale: a.scale,
      scare: a.scare,
      x: listener.x + a.distance * (fx * c - fz * s),
      z: listener.z + a.distance * (fz * c + fx * s),
    });
  } catch { /* silent */ }
}
