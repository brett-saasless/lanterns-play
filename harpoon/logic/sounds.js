// The sound catalogue: one entry per sim event type (who makes it, where it plays, its tier on
// the loudness ladder, nominal level, trim, the one scare), the ladder and the distance law.
//
// Entry: { who, place, tier, level, trim, range?, scare? }
//   who    'warden' | 'wick' | 'bellows' | 'lurch' | 'weeper' | 'cantor' | 'monster' (any) | 'world'
//   place  'centre' (the listener's own sound) or 'source' (on the maker's strip, or at ev.x/z)
//   tier   a LADDER key (self | strike | tell | tread | landing | run | jump | walk), or 'world'
//          for room markers (bells, veils, drops), which sit under self and off the ladder
//   level  nominal linear gain at the source: a new cue is authored to peak here; for a kept
//          cue it is the shipped recipe's peak, untouched
//   trim   gain applied on the strip on top of the recipe; only kept monster cues shipped
//          under the monster floor (LADDER.tread) get one, so level * trim reaches it
//   range  [min, max] for a cue whose level scales with its payload (landing by impact, splash)
//   scare  only on bossCall: { level, place } for the first Call of a run; later Calls use level

const f = Object.freeze;

/** Linear gain at the listener; the carbine shot is about 0.9. Tuneable within 20 percent. */
export const LADDER = f({
  scare: 1.4, // once per run, the Cantor's first Call
  self: 1.0, // ceiling for the player's weapon, damage, death
  strike: f([0.5, 0.9]),
  tell: f([0.3, 0.5]),
  tread: 0.25, // every creature's movement; also the monster floor
  landing: f([0.14, 0.25]), // owner amendment: capped at the tread level (design said 0.32)
  run: 0.11,
  jump: 0.07,
  walk: 0.05, // 7 dB under the run step
  ambient: 0.22, // bus level, as today
});

/** Distance law and the limits the audio layer keeps (metres, voices). */
export const LIMITS = f({
  full: 3, // full level inside this
  falloff: 0.6,
  nearby: 8, // R11 "nearby"; the steps bus ducks for a monster sound inside this
  audible: 32, // no node is made for a sound farther than this
  treadAudible: 16, // nor for a tread farther than this
  voices: 24, // one-shot budget; only treads are skipped or cut
});

/** 1 inside 3 m, then 3 / (3 + 0.6 (d - 3)): 0.5 at 8 m, about 0.28 at 16 m. */
export function attenuation(d) {
  if (!(d > LIMITS.full)) return 1;
  return LIMITS.full / (LIMITS.full + LIMITS.falloff * (d - LIMITS.full));
}

/** Tiers whose entries are monster sounds: level * trim must reach LADDER.tread. */
export const MONSTER_TIERS = f(['strike', 'tell', 'tread']);

const e = (who, place, tier, level, trim = 1, extra = {}) => f({ who, place, tier, level, trim, ...extra });

export const CATALOGUE = f({
  // The warden: weapon, confirmations, pain (centred).
  shot: e('warden', 'centre', 'self', 1.0),
  dry: e('warden', 'centre', 'self', 0.4),
  empty: e('warden', 'centre', 'self', 0.4),
  reloadStart: e('warden', 'centre', 'self', 0.5),
  reloadDone: e('warden', 'centre', 'self', 0.6),
  hit: e('warden', 'centre', 'self', 0.35),
  pickup: e('warden', 'centre', 'self', 0.35),
  hurt: e('warden', 'centre', 'self', 0.9),
  died: e('warden', 'centre', 'self', 0.8),
  // The warden's feet (new).
  step: e('warden', 'centre', 'run', LADDER.run, 1, { range: f([LADDER.walk, LADDER.run]) }),
  jump: e('warden', 'centre', 'jump', LADDER.jump),
  land: e('warden', 'centre', 'landing', LADDER.landing[1], 1, { range: LADDER.landing }),
  splash: e('warden', 'centre', 'landing', LADDER.landing[1], 1, { range: f([LADDER.run, LADDER.landing[1]]) }),

  // Any creature.
  spawn: e('monster', 'source', 'tell', 0.1, 3), // the cave tick is 0.1: trimmed to the floor
  kill: e('monster', 'source', 'tell', 0.45),
  tread: e('monster', 'source', 'tread', LADDER.tread),
  flinch: e('monster', 'source', 'tell', 0.5),
  // Wick.
  windup: e('wick', 'source', 'tell', 0.12, 2.5), // shipped at 0.12: trimmed to 0.3
  swipe: e('wick', 'source', 'strike', 0.35),
  // Bellows.
  inhale: e('bellows', 'source', 'tell', 0.3),
  boltFired: e('bellows', 'source', 'strike', 0.5),
  boltBurst: e('bellows', 'source', 'strike', 0.25),
  // Lurch.
  coil: e('lurch', 'source', 'tell', 0.3),
  leap: e('lurch', 'source', 'strike', 0.4),
  leapMiss: e('lurch', 'source', 'strike', 0.35),
  // Weeper.
  unseat: e('weeper', 'source', 'tell', 0.3),
  globTell: e('weeper', 'source', 'tell', 0.3),
  globLaunch: e('weeper', 'source', 'tell', 0.4),
  globLand: e('weeper', 'source', 'strike', 0.5),
  poolGone: e('weeper', 'source', 'tread', 0.25),
  // Cantor.
  bossTell: e('cantor', 'source', 'tell', 0.4),
  bossSweep: e('cantor', 'source', 'strike', 0.55),
  bossSwingHit: e('cantor', 'source', 'strike', 0.9),
  bossOpen: e('cantor', 'source', 'tell', 0.22, 1.25), // shipped at 0.22
  bossShut: e('cantor', 'source', 'tell', 0.3),
  bossCall: e('cantor', 'source', 'tell', 0.24, 1.25, { scare: f({ level: LADDER.scare, place: 'centre' }) }),
  // The Cantor's song (cantorsong.js): four clear notes in a minor key, on his own strip, at the
  // bottom of the tell tier (well under the salt gun's 1.0); each bout shakes the vault.
  bossSing: e('cantor', 'source', 'tell', 0.32),
  stalactiteLoose: e('world', 'source', 'world', 0.3), // the rock grinds loose where it will fall
  stalactiteFall: e('world', 'source', 'world', 0.6), // it lands and breaks

  // The world.
  gateOpen: e('world', 'source', 'world', 0.4),
  gateSeal: e('world', 'source', 'world', 0.35),
  drop: e('world', 'source', 'world', 0.2),
  rescueCrate: e('world', 'source', 'world', 0.3),
  waveStart: e('world', 'centre', 'world', 0.4),
  waveCleared: e('world', 'centre', 'world', 0.3),
  allClear: e('world', 'centre', 'world', 0.22),
  won: e('world', 'centre', 'world', 0.45),
  lost: e('world', 'centre', 'world', 0.45),

  // The Rose Court (docs/features/wonderland/02-design.md, Interfaces). The creature is named
  // in the payload (ev.enemy, or by ev.id), so `who` keeps its shipped values.
  // The warden's own: items, stakes in hand, the swap, the log's pencil tick.
  itemTake: e('warden', 'centre', 'self', 0.35),
  itemUse: e('warden', 'centre', 'self', 0.4),
  stakePull: e('warden', 'centre', 'self', 0.35),
  stakeBreak: e('warden', 'centre', 'self', 0.3),
  swap: e('warden', 'centre', 'self', 0.4),
  logEntry: e('warden', 'centre', 'self', 0.15),
  // Creatures: tells and strikes of every figure and gate creature; the one jump scare sits at
  // the top of the ordinary strike range (Conflicts 4: still one scare entry in the catalogue).
  strikeTell: e('monster', 'source', 'tell', 0.4),
  strike: e('monster', 'source', 'strike', 0.6),
  pinThrow: e('monster', 'source', 'strike', 0.5),
  solid: e('monster', 'source', 'tell', 0.35),
  smokeTick: e('monster', 'source', 'tell', 0.3),
  eats: e('monster', 'source', 'tell', 0.3),
  grin: e('monster', 'source', 'strike', 0.9),
  // The world: the plumbing, the court waking, words, nudges, stakes and pins at rest, the
  // pit, lanterns, the pipe, checkpoints.
  valveTurn: e('world', 'source', 'world', 0.4),
  valveSlam: e('world', 'source', 'world', 0.5),
  bedTurn: e('world', 'source', 'world', 0.2),
  wake: e('world', 'centre', 'world', 0.35),
  rosesSolved: e('world', 'centre', 'world', 0.45),
  speak: e('world', 'source', 'world', 0.15),
  nudge: e('world', 'source', 'world', 0.25),
  stakeLodge: e('world', 'source', 'world', 0.3),
  pinStick: e('world', 'source', 'world', 0.25),
  pitFall: e('world', 'centre', 'world', 0.5),
  lanternFall: e('world', 'source', 'world', 0.45),
  doused: e('world', 'source', 'world', 0.45),
  checkpoint: e('world', 'centre', 'world', 0.35),
  restored: e('world', 'centre', 'world', 0.3),

  // The wonderland polish track (docs/features/wonderland-polish/02-design.md, Interfaces).
  // The warden's own: reading a clue card, the notice line, the halberd landing with weight,
  // the cup thrown (the stream in a smaller key).
  read: e('warden', 'centre', 'self', 0.3),
  notice: e('warden', 'centre', 'self', 0.1),
  swing: e('warden', 'centre', 'self', 0.8),
  splashThrow: e('warden', 'centre', 'self', 0.5),
  // Creatures: a called figure waking (a clank and a bark, or a riffle of card and a yelp, at
  // the figure: tell tier), a figure stopped by the splash, the cave pack's one shared chitter.
  wakeOne: e('monster', 'source', 'tell', 0.45),
  stun: e('monster', 'source', 'tell', 0.35),
  packRush: e('lurch', 'source', 'tell', 0.45),
  // The world: the water's soft gulp at the bed, the bloom scene's ends, a dropped halberd,
  // the hats.
  waterArrive: e('world', 'source', 'world', 0.25),
  sceneStart: e('world', 'centre', 'world', 0.2),
  sceneEnd: e('world', 'centre', 'world', 0.2),
  halberdDrop: e('world', 'source', 'world', 0.4),
  hatSet: e('world', 'source', 'world', 0.25),
  hatsFall: e('world', 'source', 'world', 0.4),
  hatsSolved: e('world', 'centre', 'world', 0.45),

  // The castle (docs/features/castle/02-design.md, Interfaces). An event with an x/z plays on
  // its source; one without (the board, the Count's room, a curtain, a haunt) plays centred,
  // which keeps the monster rule (a monster entry is always a source entry). `leap` is the
  // shipped Lurch entry above: the castle's board leap shares the name (payload from/to).
  // Pit, enemies and bodies: the snakes, the first suit coming apart, the wife.
  snakeBite: e('monster', 'source', 'strike', 0.35),
  suitCrumbles: e('monster', 'source', 'strike', 0.35), // the first suit begins to come apart (#14)
  suitFalls: e('monster', 'source', 'strike', 0.6),
  wifeStir: e('monster', 'source', 'tell', 0.3),
  wifeGone: e('monster', 'source', 'tell', 0.3),
  garlicUp: e('warden', 'centre', 'self', 0.3),
  // The wife driven back out through the house, and her keen as she comes back from any side
  // (#10): both on her own strip, so the keen is heard from where she is as she closes.
  wifeDriven: e('monster', 'source', 'tell', 0.3),
  wifeNear: e('monster', 'source', 'tell', 0.35),
  // The tea room: the werewolf's arm, the clocks, the ghost, the raven.
  clawTell: e('monster', 'source', 'tell', 0.4),
  claw: e('monster', 'source', 'strike', 0.6),
  clockSet: e('world', 'source', 'world', 0.3),
  clocksStrike: e('world', 'centre', 'world', 0.45),
  ghostScream: e('monster', 'source', 'tell', 0.35),
  ravenDodge: e('monster', 'source', 'tell', 0.3),
  ravenLand: e('monster', 'source', 'tell', 0.3),
  // The gallery and the crypt.
  tileBreak: e('world', 'source', 'world', 0.4),
  tileShot: e('world', 'source', 'world', 0.3),
  cryptFall: e('world', 'centre', 'world', 0.5),
  // The board.
  knightLeap: e('warden', 'centre', 'self', 0.3), // the board leap (the Lurch's `leap` above is unchanged)
  capture: e('world', 'centre', 'world', 0.4),
  pieceStrike: e('world', 'centre', 'world', 0.5),
  walkWon: e('world', 'centre', 'world', 0.45),
  // Upstairs: the salt box and the stake bundle, and the haunts (no damage, no hit zone).
  stockTake: e('warden', 'centre', 'self', 0.35),
  haunt: e('world', 'centre', 'world', 0.2),
  // The Count's room.
  countStir: e('world', 'centre', 'world', 0.35),
  countRecoil: e('world', 'centre', 'world', 0.5),
  countLurch: e('world', 'centre', 'world', 0.55),
  countBite: e('world', 'centre', 'world', 0.7),
  curtainOpen: e('world', 'centre', 'world', 0.4),
  // Issue #8: a stake fired at the Count glances off him and drops by the box (count.js).
  stakeGlance: e('world', 'centre', 'world', 0.35),
  // The art pass (owner Q12): the shades howl as they are torn out of the Count and up through the
  // window, a noticeable sound over the fire, under the warden's ceiling (count.js, the pyre's shades stage).
  shadesHowl: e('world', 'centre', 'world', 0.6),
  // Issue #29: the road up from the wood (road.js). Placed where they happen; nothing here is a
  // creature's strike or tell, and none of it is the warden's pain.
  roadCrack: e('world', 'source', 'world', 0.45), // the boulder lets go, up the bank
  roadThud: e('world', 'source', 'world', 0.6), // it lands once on the road
  batSwarm: e('world', 'source', 'world', 0.5), // the swarm out of the cave, past the warden's head
  giantBat: e('world', 'source', 'world', 0.55), // the one giant bat after the silence
  roadCreature: e('world', 'source', 'world', 0.3), // the werewolf's footfalls going away (the cutaway's run), quiet
  // The werewolf cutaway (cutaway.js): the film's own sound, centred; nothing here is a strike.
  cutawayGrowl: e('world', 'centre', 'world', 0.4), // low in its chest, as the close-up lands
  cutawayDoor: e('world', 'centre', 'world', 0.5), // an oak leaf shuts, heavy
  cutawayBar: e('world', 'centre', 'world', 0.45), // the bar dropped across the shut doors
  // Issue #29: the ways out of the yard and the cave open in a cut scene (wayout.js). The whole
  // room shakes with each, so both are the room's own sound (centred), under the warden's ceiling;
  // their scenes' starts and ends are sceneStart and sceneEnd above, in each room's own voice.
  craterBlast: e('world', 'centre', 'world', 0.8), // the yard's last foe slams into the concrete
  vaultBreak: e('world', 'centre', 'world', 0.8), // the Cantor's last blast strikes the vault, and it comes down
  breach: e('world', 'centre', 'world', 0.8), // sea-1-dock R1, R2: config.js wayout:'breach' instead - the stack blown open

  // sea-1-dock (docs/features/sea-1-dock/02-design.md): the dock's own events.
  signedOn: e('world', 'centre', 'world', 0.4),
  kitStowed: e('warden', 'centre', 'self', 0.3),
  contestRound: e('world', 'source', 'world', 0.2),
  proof: e('warden', 'centre', 'self', 0.35),
  clipping: e('warden', 'centre', 'self', 0.3),
  monsterKnown: e('world', 'centre', 'world', 0.3),
  glassUp: e('world', 'source', 'world', 0.2),
  nailed: e('world', 'centre', 'world', 0.5),
  harpoonThrow: e('warden', 'centre', 'self', 0.5),
  harpoonStick: e('world', 'source', 'world', 0.4),
  harpoonRing: e('world', 'source', 'world', 0.6),
  harpoonHaul: e('world', 'source', 'world', 0.25),
  dunk: e('warden', 'centre', 'self', 0.6),
  // The scare under the pier (R8): once a run, loud, but under LADDER.self - the Cantor's first
  // Call (bossCall) is the one catalogue entry that ducks the mix for a true scare beat, and
  // tests/sounds.test.js holds it to exactly one.
  scare: e('world', 'centre', 'world', 0.9),
  castOff: e('world', 'centre', 'world', 0.5),
  contestWon: e('world', 'centre', 'world', 0.45),
});

// ---- the sound-only event list --------------------------------------------------------------
// The audio pass's new events (step, jump, land, splash, tread, leapMiss, unseat) ride beside
// stepSim's events on a non-enumerable `sounds` list of the same returned array, each in the
// usual { type, ...payload } shape, so the existing event vocabulary is unchanged for every
// other consumer. The presentation fans out events, then events.sounds.

/** The sound-only list riding on an events array (created empty on first use). */
export function soundsOf(events) {
  if (!events.sounds) Object.defineProperty(events, 'sounds', { value: [], enumerable: false });
  return events.sounds;
}

/** Emits a sound-only event beside the events array. */
export function emitSound(events, ev) {
  soundsOf(events).push(ev);
}
