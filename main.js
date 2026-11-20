// Boot, app state (TITLE, PLAYING, PAUSED, WON, LOST, and in the Rose Court and the castle CARD
// and LOG), the frame loop and event fan-out. The castle is the fourth room; its rules and views
// are loaded on demand and guarded (loadCastle below), so a missing piece never stops the other three.
// No static import of 'three' here: if the CDN fails, this module still runs and says so.

import { createSim, resetSim, stepSim, pauseSim } from './logic/sim.js';
import { CONFIG } from './logic/config.js';
import { warmRoutes } from './logic/climb.js';
import { CAVE_CONFIG } from './logic/caveconfig.js';
import { COURT_CONFIG } from './logic/courtconfig.js';
import { COURT } from './logic/courtmap.js';
import { restoreCheckpoint } from './logic/trail.js';
import { COPY, CASTLE_COPY } from './logic/script.js';
import { NEXT, PASSAGE, carryOf, seatCarry, passageOf, poseOf } from './logic/journey.js'; // issue #29: one continuous journey
import { needsAutoReload, isGhostClick } from './logic/touchmap.js';
import { carried } from './logic/weapon.js';
import { sameWeaponSwap, lanternReady } from './logic/lantern.js'; // the castle's hand lantern: key 6 again puts it away; its touch button
import { CUTAWAY, cutawayBlack } from './logic/cutaway.js'; // the werewolf cutaway's dip to black
import { shouldWarmHeads, HEAD_ROOMS } from './logic/headrooms.js';

const ENGINE_FAIL = 'Could not load the 3D engine. Check your connection and reload.';
const NO_WEBGL = 'This browser could not start WebGL, which LANTERN YARD needs. Try current Chrome or Safari with hardware acceleration on.';
const LOCK_HINT = 'Click the view to capture the mouse.';
const ROOMS = { yard: CONFIG, cave: CAVE_CONFIG, court: COURT_CONFIG }; // 'castle' joins once loadCastle succeeds
const LOG_ROOMS = ['court', 'castle']; // the rooms with a warden's log, clue cards, prompt line, notice line and tray
const SUBLINES = {
  yard: 'Night shift. Three surges. Hold the yard.',
  cave: 'Sea cave under the breakwater. Three chambers. Bring salt.',
  court: COPY.subline,
  castle: CASTLE_COPY.subline,
  tunnel: CASTLE_COPY.tunnelSub, // the Tunnel start's own: the walk from the Caterpillar's gate
};
const SETTINGS_KEY = 'lanternyard.settings';
const GHOST_MS = 350; // touch: a click this soon after a card, the log or the pause card opens is the lifted finger's, not a tap

function fatal(text) {
  if (window.__lyFatal) window.__lyFatal(text);
}

function loadSettings() {
  const d = { sensitivity: 1, touchSensitivity: 1, reducedFlash: false, muted: false };
  const look = (v) => typeof v === 'number' && v >= 0.2 && v <= 3;
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (look(s.sensitivity)) d.sensitivity = s.sensitivity;
    if (look(s.touchSensitivity)) d.touchSensitivity = s.touchSensitivity; // the look speed on touch, kept apart from the mouse's
    if (typeof s.reducedFlash === 'boolean') d.reducedFlash = s.reducedFlash;
    if (typeof s.muted === 'boolean') d.muted = s.muted;
  } catch { /* defaults */ }
  return d;
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  if (location.protocol === 'file:') return; // the inline script already explained
  try {
    await import('three');
  } catch {
    fatal(ENGINE_FAIL);
    return;
  }
  if (!webglAvailable()) {
    fatal(NO_WEBGL);
    return;
  }
  let mods;
  try {
    mods = await Promise.all([
      import('./engine/world.js'), import('./engine/actors.js'), import('./engine/viewmodel.js'),
      import('./engine/hud.js'), import('./engine/audio.js'), import('./engine/controls.js'), import('./engine/pages.js'),
      import('./engine/handover.js'), import('./engine/touchui.js'),
    ]);
  } catch {
    fatal(ENGINE_FAIL);
    return;
  }
  const [{ buildWorld }, { createActors }, { createViewmodel }, { createHud, snapshotOf }, audio, { createControls }, { createPages }, { createHandover }, { createTouchUi }] = mods;
  let castleViews = []; // the names of the castle's views that loaded (read by the smoke seat)
  let keepRules = null; // { cfg, keep }: the castle's config and rules module, once loaded and checked

  const canvas = document.getElementById('view');
  let world;
  try {
    world = buildWorld(canvas);
  } catch {
    fatal(NO_WEBGL);
    return;
  }
  const { renderer, scene, camera } = world;
  renderer.info.autoReset = false; // one frame is two render calls (world, then viewmodel): reset by hand
  const drawStats = { calls: 0, triangles: 0 }; // the last frame's draw calls and triangles
  const actors = createActors(scene);
  const vm = createViewmodel(camera.aspect, camera);
  const controls = createControls(canvas);
  // Touch (layout C): the on-screen controls feed controls.touch; with no touch they stay hidden.
  const touchUi = createTouchUi({
    root: document.getElementById('touch'),
    controls,
    hooks: {
      pause: () => pause(),
      toggleLog: () => { if (state === 'LOG') closeLog(); else if (state === 'PLAYING' && inLogRoom()) openLog(); }, // as Tab
      modeChanged: () => { if (document.pointerLockElement) document.exitPointerLock(); hud.syncSettings(settings); if (state === 'PLAYING') pause(); }, // the lock goes with the mode: let the browser's go too
      holdE: (down) => { eHeld = !!down && state === 'PLAYING'; }, // the touch E, as the E key: the cord reads it as `hold`
    },
  });
  const pages = createPages();
  const handover = createHandover(renderer); // #29: the fade and the dissolve between levels

  const settings = loadSettings();
  audio.setMuted(settings.muted);
  vm.setReducedFlash(settings.reducedFlash);
  actors.setReducedFlash(settings.reducedFlash);
  world.setReducedFlash(settings.reducedFlash);
  // The Look speed slider drives whichever look speed is in use: the mouse's, or the touch one.
  const lookKey = () => (controls.touchMode() ? 'touchSensitivity' : 'sensitivity');
  const hud = createHud(settings, (patch) => {
    Object.assign(settings, patch);
    saveSettings(settings);
    audio.setMuted(settings.muted);
    vm.setReducedFlash(settings.reducedFlash);
    actors.setReducedFlash(settings.reducedFlash);
    world.setReducedFlash(settings.reducedFlash);
    hud.syncSettings(settings);
  }, lookKey);

  const sim = createSim((Date.now() >>> 0) || 1);
  warmRoutes(CONFIG); // the yard creatures' walk grids, built before the first wave (#21)
  let state = 'TITLE';
  let runRoom = 'yard'; // the room of the current run; Play again and Try again replay it
  let runStart = null; // 'road': this castle run began at the road's foot (the title's Road start); Restart and Play again keep it
  let cardAfter = null; // what happens when the open story card is turned away
  let cardNeedsLock = false; // the card sits over play: turning it away needs the mouse captured
  let seenArch = false; // the arch card is shown once a run, not again after a death
  let titleRoom = 'yard'; // the room shown behind the title (hover or focus); never persisted
  let sceneEase = null; // { pos, quat, t }: the camera easing home after the bloom scene
  let sceneLast = null; // the camera as the bloom scene last placed it
  // Art pass K11/K12, the castle's death and triumph: the dawn's gold dip that carries the cut into
  // the pyre ({ t }), and the triumph's last view held under THE END ({ pos, quat, fov }).
  let goldDip = null;
  let cutDip = 0; // seconds left of the fade back in from black after the werewolf cutaway
  let cutDipOn = false; // the cutaway's dip holds the cover
  let endHold = null;
  const DAWN_GOLD = 0xf2c14e;
  const CASTLE_EASE = 0.75; // seconds: the castle's hand-overs between a scene's camera and the warden's eye (K11)
  let dead = false; // WebGL context lost: the frame loop is over
  let locking = false;
  let jolt = 0;
  let tremor = 0; // #29 review A14: the ground shaking under the boulder's landing, seconds left of TREMOR
  const TREMOR = 0.25;
  // #29: the same channel under the crater's blast and the vault coming down, longer and harder
  // (the ground and the view on it shake; never the hurt jolt, and no flinch): what is shaking now.
  // swell: the vault's second shudder as its rock lands, [seconds in, seconds wide, strength].
  const QUAKES = {
    boulder: { len: TREMOR, amp: 0.035, swell: null },
    crater: { len: 1.1, amp: 0.11, swell: null },
    vault: { len: 2.3, amp: 0.07, swell: [1.55, 0.5, 0.8] },
  };
  let quaking = QUAKES.boulder;
  const shake = (kind) => { quaking = QUAKES[kind]; tremor = quaking.len; };
  const FOV = camera.fov; // the warden's own lens; a way-out scene's camera may ask for a longer one
  const setFov = (f) => { if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); } };
  let swapDue = null; // { to, hex, frames }: the card is up; the level swaps under it once it has been drawn
  let arriveDue = null; // the cover's colour, cleared as the card is turned away
  let journeyDue = null; // #29: the room the journey hands over to at the end of this frame
  let journeyLog = []; // #29: the last hand-overs { from, to, at, ms, freed } (the smoke reads it over its debugging seat)
  let last = performance.now();
  let fps = 60;
  let frameDt = 0;
  const ear = { x: 0, z: 0, yaw: 0 }; // the listener handed to audio.update each playing frame

  let openedAt = -Infinity; // when a card, the log, the pause card or the won/lost card last opened (the touch ghost-click guard)
  function setState(s) {
    state = s;
    if (s === 'CARD' || s === 'PAUSED' || s === 'LOG' || s === 'WON' || s === 'LOST') openedAt = performance.now();
    if (s !== 'PLAYING') eHeld = false;
    controls.setActive(s === 'PLAYING');
    hud.showScreen(s.toLowerCase(), sim);
  }

  const inCourt = () => runRoom === 'court' && sim.cfg.room === 'court';
  const inLogRoom = () => LOG_ROOMS.includes(runRoom) && sim.cfg.room === runRoom; // log, clue cards, prompt, notice, tray
  let eHeld = false; // E is down and went down in play: the cord reads it as `hold` (the sim wants a fresh press)
  const inView = () => state === 'PLAYING' || state === 'PAUSED' || state === 'CARD' || state === 'LOG';
  // Touch only: the click a finger makes as it lifts, just after the press that opened a card or the pause card,
  // or just after a finger left an on-screen control (WebKit aims that click where the finger lifts).
  // A click from inside the #touch overlay (the lifted finger of a pause or log press) is never a card tap either.
  const ghostClick = (e) => controls.touchMode() && (isGhostClick(performance.now(), openedAt, touchUi.releasedAt(), GHOST_MS) || !!e?.target?.closest?.('#touch'));
  const tapCard = () => { if (!ghostClick()) turnCard(); }; // a click on a story or clue card
  /** Touch only, on a Play or Resume tap: fullscreen, then landscape where the browser allows it. Failures are ignored. */
  function fullscreenOnTouch() {
    if (!controls.touchMode() || document.fullscreenElement) return;
    const lock = () => { try { const p = screen.orientation?.lock?.('landscape'); if (p && p.catch) p.catch(() => {}); } catch { /* no lock here */ } };
    try {
      const p = document.documentElement.requestFullscreen?.();
      if (p && typeof p.then === 'function') p.then(lock, () => {});
    } catch { /* no fullscreen here */ }
  }

  const toolsWarmed = new Set(); // the viewmodel tools whose programs have been built this session (the castle's lantern)
  const headsWarmed = new Set(); // the head rooms whose lights the heads' program has been built for, this session
  /** Switches the sim, the scene and the weapon to a room (Engine API, "Choosing a room"). */
  function enterRoom(name) {
    const cfg = ROOMS[name];
    resetSim(sim, (Date.now() >>> 0) || 1, cfg);
    actors.clear();
    world.setRoom(cfg.room);
    if (cfg.room === 'court' || cfg.room === 'castle') {
      vm.setSpecs(cfg.weapons, cfg.swapTime);
      vm.setWeapon('bore', cfg.weapon, cfg.room); // the salt gun; the crossbow, the halberd and the cup come by a swap
    } else {
      vm.setWeapon(cfg.room === 'cave' ? 'bore' : 'carbine', cfg.weapon);
    }
    // #29: the crater, the shaft, the road's scares: built before they first show. After the weapon is
    // set: the salt gun's pilot lamp is one of the cave's lights, and a program is built for the lights there are.
    world.warmExtras(camera);
    // The sculpted heads' shader, built as a level with heads starts (any start: a title button, the
    // journey's hand-over, a checkpoint), before its first frame (the owner; logic/headrooms.js).
    if (shouldWarmHeads({ room: cfg.room, warmed: headsWarmed, headRooms: HEAD_ROOMS })) { headsWarmed.add(cfg.room); world.warmHeads(camera); }
    audio.setRoom(cfg.room, cfg);
    vm.cancel();
    hud.setRoom(cfg);
    hud.reset();
    pages.reset();
    sceneEase = null;
    sceneLast = null;
    goldDip = null;
    endHold = null;
    seenArch = false;
    jolt = 0;
    tremor = 0;
    journeyDue = null;
    settling = null;
    actors.setBuildBudget(Infinity);
    handover.reset();
    arriveDue = null;
  }

  // The owner (2026-11-19): the wood's level ends just through the Caterpillar's gate and the castle's
  // card is read there; under the card the cover is this dark, and it clears onto the walk to the
  // road (tunnelwalk.js) at the same place, the castle level's copy of it, as the warden walks on.
  const TUNNEL_DARK = 0x0a0907;
  // The story card each hand-over stops on (owner, after G29a): the next chapter's card, the same
  // one its title start shows. The cave's title start shows none, so the yard's crater has none.
  const JOURNEY_CARD = { court: 'arrive', castle: 'end' }; // (not an Object.freeze literal: tests/snapshot.test.js finds the __lanternyard handle by the first one)

  /**
   * Issue #29: a level just handed over is not drawn until its programs are built: a few of the
   * drawn objects' programs a frame (compileAsync: built in the background where the browser
   * can), while the cover (the dark, the daylight, the glare) stays up and play goes on beneath.
   * Returns true while it is still building (the frame then draws only the cover). Capped at
   * SETTLE_MAX seconds: whatever is left is built as it is first drawn, as before.
   */
  let settling = null;
  const SETTLE_MAX = 2.5;
  function settle() {
    if (!settling) return false;
    const s = settling;
    const done = () => { // how long the new level took to build, for the smoke (the hold under the card)
      const j = journeyLog[journeyLog.length - 1];
      if (j && j.settled == null) j.settled = Math.round(performance.now() - s.t0);
      settling = null; actors.setBuildBudget(Infinity); return false;
    };
    if ((performance.now() - s.t0) / 1000 > SETTLE_MAX) return done();
    if (!s.queue.length) { // what the scene draws now (the cast comes a figure a frame): queue anything new
      s.queue = world.drawables(s.seen);
      s.quiet = s.queue.length ? 0 : s.quiet + 1;
    }
    for (let i = 0; i < 6 && s.queue.length; i++) {
      const o = s.queue.shift();
      try {
        s.waiting += 1;
        renderer.compileAsync(o, camera, scene).then(() => { s.waiting -= 1; }, () => { s.waiting -= 1; });
      } catch { s.waiting -= 1; }
    }
    if (!s.queue.length && s.waiting <= 0 && s.quiet >= 3) return done();
    return true;
  }

  /**
   * Issue #29: the journey goes on into `to`, at the end of a frame. With a card for it (JOURNEY_CARD)
   * the card comes up first, over the full cover (the shaft's daylight, the tunnel's dark), and the
   * level swaps under it a frame or two later, once the card is on screen, so the swap's long frame
   * and the building after it are read through; turned away, the cover clears and the warden walks
   * on. With none (the yard's crater) the swap is at once and the dark clears as before.
   */
  function journeyOn(to) {
    const key = JOURNEY_CARD[to];
    const way = passageOf(sim);
    const hex = to === 'castle' ? TUNNEL_DARK : way && way.way === 'up' ? 0xfff4dc : 0x050403; // (the yard's dark: an amber-black, not pure black)
    if (!key || (to === 'castle' && !keepRules)) { handOver(to, hex); handover.arrive(hex, PASSAGE.arrive); return; }
    handover.fade(hex, 1);
    handover.update(0); // (fade only sets the strength: update writes it, holding every timer)
    handover.render(); // over this frame already, so the card's first paint is on the cover
    swapDue = { to, hex, key, frames: 2 };
    const cardEl = document.getElementById('card');
    showCard(key, () => { cardEl.classList.remove('daylit'); arriveDue = hex; resumePlay(); }, true);
    if (state === 'CARD') cardEl.classList.toggle('daylit', to === 'court'); // N6: the shaft's daylight from above behind the court's card
    if (state !== 'CARD' && swapDue) { swapDue = null; handOver(to, hex); handover.arrive(hex, PASSAGE.arrive); } // no card to show: on at once (its log entry then has no card fields)
  }

  /** The swap under the card: once it has been drawn (or at once, if it is being turned away). */
  function swapUnderCard(now) {
    if (!swapDue) return;
    if (!now && --swapDue.frames > 0) return;
    const { to, hex, key } = swapDue;
    swapDue = null;
    const after = cardAfter;
    const up = state === 'CARD';
    handOver(to, hex);
    const j = journeyLog[journeyLog.length - 1];
    if (j) { j.card = key; j.underCard = up; j.forced = !!now; } // for the smoke: made with the card on screen, not forced by its dismissal
    handover.fade(hex, 1); // enterRoom cleared the cover: back up, held until the card is turned away
    // enterRoom cleared the HUD and the pages too: the same card back up at once (one task, no paint between)
    if (after && !now) {
      pages.card(key, tapCard);
      cardAfter = after;
      setState('CARD');
      audio.setReading(true);
    }
    cardKeep(); // A6: a key held through the card counts for nothing in the new level either
  }

  /**
   * Issue #29: the journey's hand-over. The yard's crater and the Nave's shaft have carried the
   * warden through (journey.js), or the wood's end has run on into its tunnel: the next room comes
   * up under the cover with what they carry (the castle's arrival seats the carry and writes its
   * stage-0 checkpoint as the card did, A2, then the road's foot, in its tunnel, is the seat). The
   * room left behind is freed.
   */
  function handOver(to, hex) {
    const t0 = performance.now();
    const from = runRoom;
    if (to === 'castle' && !keepRules) return;
    const carry = carryOf(sim);
    const pose = poseOf(sim);
    const castleCarry = to === 'castle' ? keepRules.keep.arrivalFrom(sim) : null;
    runRoom = to;
    runStart = null;
    enterRoom(to);
    handover.fade(hex, 1);
    if (to === 'castle') {
      const events = keepRules.keep.arrive(sim, castleCarry);
      if (Array.isArray(events)) fanOut(events);
      if (typeof keepRules.keep.enterRoad === 'function') keepRules.keep.enterRoad(sim, pose);
    } else {
      seatCarry(sim, carry);
      if (to === 'court') pages.onEvent({ type: 'logEntry', key: 'fromCave' }); // the log has the cave's page: the pencil tick says so
    }
    const freed = world.free(from);
    settling = { queue: [], seen: new Set(), quiet: 0, waiting: 0, t0: performance.now() };
    actors.setBuildBudget(1); // the new level's cast comes a figure a frame, under the cover
    const kitOf = () => [sim.weapon, sim.holster, ...sim.rack].filter(Boolean).map((w) => `${w.name} ${w.mag}/${w.reserve}`);
    journeyLog.push({ from, to, at: performance.now(), ms: +(performance.now() - t0).toFixed(1), freed,
      carried: { health: carry.health, kit: carry.weapons.map((w) => `${w.name} ${w.mag}/${w.reserve}`), log: carry.log.length },
      seated: { health: sim.player.health, kit: kitOf(), log: sim.waves.log ? sim.waves.log.length : 0 } });
    if (journeyLog.length > 8) journeyLog.shift();
    last = performance.now();
  }

  /** A6: a card or the log opening in the castle clears the rules' held-press latch (keep.js cardKeep, when it exists). */
  function cardKeep() {
    if (runRoom === 'castle' && keepRules && typeof keepRules.keep.cardKeep === 'function') keepRules.keep.cardKeep(sim);
  }

  /** The clue card's HUD state: the card readable over a dimmed, frozen view; the HUD told to assistive tech. */
  function setReading(on) {
    const hudEl = document.getElementById('hud');
    hudEl.classList.toggle('reading', on);
    hudEl.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  /** A story card over the frozen view. needsLock: turning it away must have the mouse captured. */
  function showCard(key, after, needsLock, open = pages.card) {
    cardKeep();
    document.getElementById('card').classList.remove('daylit'); // N6's daylight only on the journey's court card (journeyOn sets it after)
    if (!open(key, tapCard)) { after(); return; }
    cardAfter = after;
    cardNeedsLock = needsLock;
    hud.hint('');
    setState('CARD');
    // A clue card sits in the HUD: dim the view behind it fully and keep the card itself at full strength.
    if (open !== pages.card) setReading(true);
    audio.setReading(true);
  }

  /** Enter, E, Space or a click: turn the card away. A lost capture is asked for again; refused, the card stays. */
  async function turnCard() {
    if (state !== 'CARD' || locking) return;
    if (cardNeedsLock && !controls.isLocked()) {
      locking = true;
      const ok = await controls.requestLock();
      locking = false;
      if (!ok) {
        hud.hint(LOCK_HINT);
        return;
      }
    }
    if (state !== 'CARD') return;
    swapUnderCard(true); // #29: turned away before the swap was drawn: it happens now, still under the cover
    const after = cardAfter;
    cardAfter = null;
    pages.close();
    setReading(false);
    audio.setReading(false);
    hud.hint('');
    last = performance.now();
    after();
  }

  function resumePlay() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    last = performance.now();
    setState('PLAYING');
    if (arriveDue != null) { handover.arrive(arriveDue, PASSAGE.arrive); arriveDue = null; } // #29: out of the cover, walking on
  }

  /** Tab: the warden's log over the frozen view (the Rose Court and the castle). */
  function openLog() {
    if (state !== 'PLAYING' || !inLogRoom() || sim.status !== 'playing') return;
    if (sim.waves && sim.waves.scene) return; // no scene is interrupted
    vm.cancel();
    cardKeep();
    pages.log(sim, true);
    setState('LOG');
    audio.setReading(true);
  }

  /** Closes the log. With the capture lost (Escape took it) there is no resuming: the pause card instead. */
  function closeLog(forcePause = false) {
    if (state !== 'LOG') return;
    pages.log(sim, false);
    audio.setReading(false);
    if (forcePause || !controls.isLocked()) {
      pauseSim(sim);
      setState('PAUSED');
      audio.suspend();
      controls.releaseLock();
      return;
    }
    resumePlay();
  }

  /** Title hover or focus: show a room's backdrop and subline (sub: a start's own, the Tunnel's), nothing else. */
  function previewRoom(name, sub = name) {
    if (state !== 'TITLE') return;
    if (titleRoom !== name) {
      titleRoom = name;
      world.setRoom(name);
      // the title's backdrop of a level with heads shows them too: build their program before it is drawn
      if (shouldWarmHeads({ room: name, warmed: headsWarmed, headRooms: HEAD_ROOMS })) { headsWarmed.add(name); world.warmHeads(camera); }
    }
    document.getElementById('titlesub').textContent = SUBLINES[sub];
  }

  /** Locks the pointer, then enters PLAYING. `fresh` starts a new run. Lock refused: stay put. */
  async function deploy(fresh, room = runRoom, checkpoint = false, start = room === runRoom ? runStart : null) {
    if (locking) return;
    audio.unlock();
    locking = true;
    hud.hint('');
    const ok = await controls.requestLock();
    locking = false;
    if (!ok) {
      hud.hint(LOCK_HINT);
      return;
    }
    if (fresh) {
      runRoom = room;
      runStart = room === 'castle' && (start === 'road' || start === 'tunnel') ? start : null;
      enterRoom(room);
      // The Road start (the owner, 2026-11-17): the castle run, seated at the road's foot. The Tunnel
      // start (the owner, 2026-11-19): the same run, seated just through the Caterpillar's gate at the
      // start of the walk to the road, right after his death, with the kit the wood leaves.
      if (runStart && keepRules && typeof keepRules.keep.enterRoad === 'function') keepRules.keep.enterRoad(sim, runStart === 'road' ? { out: true } : { start: true });
    } else if (checkpoint && !restoreAtCheckpoint()) {
      enterRoom(runRoom); // no checkpoint to go back to: the level starts over
      fresh = true;
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // Space must not re-press a button
    last = performance.now();
    if (fresh && runRoom === 'court') {
      audio.resume();
      showCard('arrive', resumePlay, true); // the first story card, over the court
      return;
    }
    if (fresh && runRoom === 'castle') {
      audio.resume();
      // The Castle start: the forest-to-castle card, then Renfield's hour on a clue card (both are in the log).
      showCard('end', () => showCard('hour', resumePlay, true, pages.clue), true);
      return;
    }
    setState('PLAYING');
    audio.resume();
  }

  /**
   * Try again in the Rose Court (trail.js) or the castle (keep.js): the last checkpoint, with what was
   * carried through it. A drawbridge arrival wrote its own stage-0 checkpoint, so this restores the carried kit.
   */
  function restoreAtCheckpoint() {
    const restore = runRoom === 'court' ? restoreCheckpoint : runRoom === 'castle' && keepRules ? keepRules.keep.restoreCheckpoint : null;
    if (!restore || !restore(sim)) return false;
    if (runRoom === 'castle') audio.setRoom('castle', sim.cfg); // the castle bed follows the stage from the checkpoint/restored/waveStart events that come next
    // This clear empties every view now. The `restored` event restoreCheckpoint queues arrives on
    // the next step, so the views' own restored handlers (cast.js, beasts.js, props.js) then find
    // nothing left to undo. They are the fallback if this clear is ever removed: keep one of the two.
    actors.clear();
    vm.cancel();
    hud.reset();
    pages.reset();
    jolt = 0;
    tremor = 0;
    return true;
  }

  function pause() {
    if (state !== 'PLAYING' || sim.status !== 'playing' && sim.status !== 'winning' && !passageOf(sim)) return; // #29: walking on to the way out pauses too
    pauseSim(sim);
    vm.cancel();
    setState('PAUSED');
    audio.suspend();
    controls.releaseLock();
  }

  /** Drops the run, frees the pointer and shows the title (Yard backdrop until a room is hovered). */
  function backToTitle() {
    if (state === 'TITLE') return;
    setState('TITLE');
    controls.releaseLock();
    audio.suspend();
    titleRoom = null;
    enterRoom('yard');
    previewRoom('yard');
  }

  /**
   * The court's end card leads into the castle: the finished court sim hands over what the warden
   * carries (arrivalFrom), the sim is reset into the castle, and arrive() seats that kit and writes
   * the stage-0 checkpoint. A refused carry seats the title kit (keep.js decides). With no castle
   * loaded the card ends at the title.
   */
  function toCastle() {
    if (!keepRules) { backToTitle(); return; }
    const carry = keepRules.keep.arrivalFrom(sim); // read before the reset below
    runRoom = 'castle';
    enterRoom('castle');
    const events = keepRules.keep.arrive(sim, carry);
    if (Array.isArray(events)) fanOut(events);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    audio.resume();
    resumePlay();
  }

  function finish(s) {
    setState(s);
    controls.releaseLock();
  }

  // Buttons
  const roomBtns = { yard: document.getElementById('deploy-yard'), cave: document.getElementById('deploy-cave'), court: document.getElementById('deploy-court') };
  roomBtns.court.textContent = COPY.button;
  const bindRoomBtn = (name, btn) => {
    btn.addEventListener('click', () => { fullscreenOnTouch(); deploy(true, name, false, null); });
    btn.addEventListener('mouseenter', () => previewRoom(name));
    btn.addEventListener('focus', () => previewRoom(name));
  };
  for (const [name, btn] of Object.entries(roomBtns)) bindRoomBtn(name, btn);
  document.getElementById('pausetitle').addEventListener('click', () => { if (!ghostClick()) backToTitle(); });
  document.getElementById('wontitlebtn').addEventListener('click', () => { if (!ghostClick()) backToTitle(); });
  document.getElementById('losttitlebtn').addEventListener('click', () => { if (!ghostClick()) backToTitle(); });
  document.getElementById('resume').addEventListener('click', () => {
    if (ghostClick()) return;
    fullscreenOnTouch();
    deploy(false);
  });
  document.getElementById('restart').addEventListener('click', () => { if (!ghostClick()) deploy(true); });
  document.getElementById('again').addEventListener('click', () => { if (!ghostClick()) deploy(true); });
  document.getElementById('retry').addEventListener('click', () => {
    if (ghostClick()) return;
    if (LOG_ROOMS.includes(runRoom)) deploy(false, runRoom, true); else deploy(true);
  });
  document.getElementById('paused').addEventListener('click', (e) => {
    if (e.target.id === 'paused' && !ghostClick()) { fullscreenOnTouch(); deploy(false); } // clicking the dimmed view resumes
  });
  // The log's footer under touch: previous, next and close, as A, D and Tab.
  const logTurn = (dir) => { if (state === 'LOG' && !ghostClick() && pages.turn(sim, dir)) audio.play('page'); };
  document.getElementById('logprev').addEventListener('click', () => logTurn(-1));
  document.getElementById('lognext').addEventListener('click', () => logTurn(1));
  document.getElementById('logclose').addEventListener('click', () => { if (!ghostClick()) closeLog(); });
  for (const btn of Object.values(roomBtns)) btn.disabled = false; // hint is cleared by setState('TITLE') below

  /**
   * The fourth room, loaded once boot is done and guarded end to end: the castle's config and rules
   * (keepconfig.js, keep.js), a check that the sim knows its encounter, its scene (castle.js, through
   * world.loadCastle) and its cast and props. Any failure leaves the Castle button empty (hidden) and
   * the yard, the cave and the Rose Court exactly as they were. Resolves true when the castle is ready.
   */
  async function loadCastle() {
    let cfg;
    let keep;
    try {
      const cfgMod = await import('./logic/keepconfig.js');
      keep = await import('./logic/keep.js');
      cfg = cfgMod.CASTLE_CONFIG;
      const need = ['arrivalFrom', 'arrive', 'restoreCheckpoint', 'checkpointAt'];
      if (!cfg || cfg.room !== 'castle' || need.some((n) => typeof keep[n] !== 'function')) return false;
      // The sim must know the encounter: a scratch sim of the castle has the castle's fields.
      const probe = createSim(1, cfg);
      if (!probe.waves || !('under' in probe.waves) || !probe.waves.done) return false;
    } catch (err) {
      console.warn('castle not loaded:', err && err.message);
      return false; // the castle's rules are not there (yet): the other three rooms carry on
    }
    if (!(await world.loadCastle(cfg))) return false;
    keepRules = { cfg, keep };
    ROOMS.castle = cfg;
    castleViews = await loadCastleViews(cfg);
    roomBtns.castle = document.getElementById('deploy-castle');
    roomBtns.castle.textContent = CASTLE_COPY.button; // words by textContent only
    for (const n of document.querySelectorAll('.castlenote')) n.textContent = CASTLE_COPY.controls;
    bindRoomBtn('castle', roomBtns.castle);
    roomBtns.castle.disabled = false;
    const roadBtn = document.getElementById('deploy-road'); // the Road start: the castle's run from the road's foot
    if (roadBtn && typeof keep.enterRoad === 'function') {
      roadBtn.textContent = CASTLE_COPY.road;
      roadBtn.addEventListener('click', () => { fullscreenOnTouch(); deploy(true, 'castle', false, 'road'); });
      roadBtn.addEventListener('mouseenter', () => previewRoom('castle'));
      roadBtn.addEventListener('focus', () => previewRoom('castle'));
      roadBtn.disabled = false;
      roomBtns.road = roadBtn; // Enter on the focused Road button starts it (the title's Enter handler)
    }
    const tunnelBtn = document.getElementById('deploy-tunnel'); // the Tunnel start: the castle's run from the Caterpillar's gate
    if (tunnelBtn && typeof keep.enterRoad === 'function') {
      tunnelBtn.textContent = CASTLE_COPY.tunnel;
      tunnelBtn.addEventListener('click', () => { fullscreenOnTouch(); deploy(true, 'castle', false, 'tunnel'); });
      tunnelBtn.addEventListener('mouseenter', () => previewRoom('castle', 'tunnel'));
      tunnelBtn.addEventListener('focus', () => previewRoom('castle', 'tunnel'));
      tunnelBtn.disabled = false;
      roomBtns.tunnel = tunnelBtn; // Enter on the focused Tunnel button starts it
    }
    return true;
  }

  /**
   * The castle's cast, props, death scene and cues, each optional: a module that is missing or does
   * not export what is expected is skipped (the room is then played without that view).
   */
  async function loadCastleViews(cfg) {
    const loaded = [];
    const attempt = async (path, name, how) => {
      try {
        const mod = await import(path);
        if (typeof mod[name] !== 'function') throw new Error(`${path} does not export ${name}`);
        how(mod[name]);
        loaded.push(name);
      } catch (err) {
        console.warn('castle view not loaded:', name, err && err.message);
      }
    };
    await attempt('./engine/keepcast.js', 'registerKeepcast', (fn) => fn(actors, scene));
    await attempt('./engine/keepprops.js', 'createKeepprops', (fn) => actors.addLayer(fn(scene, cfg)));
    if (loaded.includes('createKeepprops')) { // the figure-mirror's stand-in is one of the forest creatures (beasts.js)
      try {
        const { buildCreature } = await import('./engine/beasts.js');
        const props = scene.getObjectByName('keepprops');
        props.userData.keepprops.setCreature(buildCreature);
      } catch (err) {
        console.warn('figure-mirror creature not set:', err && err.message);
      }
    }
    await attempt('./engine/chessmen.js', 'createChessmen', (fn) => actors.addLayer(fn(scene, cfg)));
    await attempt('./engine/pyre.js', 'createPyre', (fn) => actors.addLayer(fn(scene, cfg)));
    return loaded;
  }

  const primary = { PAUSED: 'resume', WON: 'again', LOST: 'retry' };
  window.addEventListener('keydown', (e) => {
    if (state === 'CARD' && !e.repeat && ['Enter', 'NumpadEnter', 'KeyE', 'Space'].includes(e.code)) {
      e.preventDefault();
      turnCard();
      return;
    }
    if (e.code === 'KeyE' && !e.repeat && state === 'PLAYING') eHeld = true;
    if (e.code === 'Tab' && inLogRoom() && (state === 'PLAYING' || state === 'LOG')) {
      e.preventDefault();
      if (!e.repeat) (state === 'LOG' ? closeLog() : openLog());
      return;
    }
    if (state === 'LOG' && !e.repeat) {
      if (e.code === 'Escape') {
        e.preventDefault();
        closeLog();
        return;
      }
      const dir = ['KeyA', 'ArrowLeft'].includes(e.code) ? -1 : ['KeyD', 'ArrowRight'].includes(e.code) ? 1 : 0;
      if (dir && pages.turn(sim, dir)) audio.play('page');
    }
    if (e.code === 'KeyM' && !e.repeat) {
      settings.muted = !settings.muted;
      saveSettings(settings);
      audio.setMuted(settings.muted);
      hud.syncSettings(settings);
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      if (state === 'TITLE') {
        e.preventDefault();
        const focused = Object.values(roomBtns).find((b) => b === document.activeElement);
        (focused || roomBtns.yard).click(); // Yard by default
      } else if (state === 'WON' && inLogRoom()) {
        e.preventDefault();
        document.getElementById('wontitlebtn').click(); // a log room has no won card of its own
      } else if (primary[state]) {
        e.preventDefault();
        document.getElementById(primary[state]).click();
      }
    }
  });

  window.addEventListener('keyup', (e) => { if (e.code === 'KeyE') eHeld = false; });
  window.addEventListener('blur', () => { eHeld = false; });

  // Any loss of lock or focus pauses.
  // With the mouse captured a click is delivered to the canvas, not the card: take it from the document.
  document.addEventListener('click', (e) => { if (state === 'CARD' && !ghostClick(e)) turnCard(); });

  // A card stays up and a click resumes; the log closes into the pause card.
  document.addEventListener('pointerlockchange', () => {
    if (controls.isLocked()) return;
    if (state === 'PLAYING') pause();
    else if (state === 'LOG') closeLog(true);
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  // Touch: turned upright, the game pauses (the rotate screen covers it). Back to landscape it stays
  // paused: the pause card waits for Resume.
  try {
    const portrait = matchMedia('(orientation: portrait)');
    portrait.addEventListener('change', (e) => { if (e.matches && controls.touchMode()) pause(); });
  } catch { /* no media queries: nothing to watch */ }

  window.addEventListener('resize', () => {
    world.resize();
    vm.resize(camera.aspect);
  });

  function fanOut(events) {
    for (const ev of events) {
      if (ev.type === 'hurt') jolt = 1;
      actors.onEvent(ev);
      vm.onEvent(ev);
      hud.onEvent(ev, sim, settings.reducedFlash);
      pages.onEvent(ev);
      audio.play(ev.type, ev);
      if (ev.type === 'checkpoint' && ev.index === 1 && runRoom === 'court' && !seenArch && state === 'PLAYING') {
        seenArch = true;
        showCard('arch', resumePlay, true); // the second story card, under the hedge arch
      }
      if (ev.type === 'read' && state === 'PLAYING' && inLogRoom()) {
        showCard(ev.key, resumePlay, true, pages.clue); // the clue card, in the same CARD state
      }
      if (ev.type === 'roadThud') shake('boulder'); // #29: the boulder lands: the ground shakes, not the warden (no hurt jolt, no flinch)
      if (ev.type === 'craterBlast' && !ev.skipped) shake('crater'); // #29: the last foe slams into the concrete
      if (ev.type === 'vaultBreak' && !ev.skipped) shake('vault'); // #29: the vault is struck, and comes down
      if (ev.type === 'allClear' && inCourt() && keepRules && typeof keepRules.keep.enterRoad === 'function') journeyDue = 'castle'; // #29: the wood's end runs on
      if (ev.type === 'won') {
        if (passageOf(sim)) { /* #29: the way on is open (the crater, the shaft): walk on to it */ }
        else if (inCourt() && journeyDue === 'castle') { /* #29: already on the road */ }
        else if (inCourt()) showCard('end', toCastle, !!keepRules); // the third card, then the castle (or the title if it cannot load)
        else if (runRoom === 'castle') showCard('dawn', backToTitle, false); // the after-the-dawn card, then the title
        else finish('WON');
      }
      if (ev.type === 'lost') finish('LOST');
    }
    // The sound-only events (footsteps, treads, ...) ride beside the main list: audio alone.
    const sounds = events.sounds;
    if (sounds) for (const ev of sounds) audio.play(ev.type, ev);
  }

  /** Issue #20: true while THE END shows: the triumph's last part, then the castle's win beat after it. */
  function theEndShowing() {
    const w = sim.waves;
    if (runRoom !== 'castle' || state !== 'PLAYING' || !w || !w.count) return false;
    if (w.scene) return w.scene.kind === 'triumph' && !!w.scene.theEnd;
    return !!w.count.cheered && (sim.status === 'winning' || sim.status === 'won');
  }

  function placeCamera(time) {
    const pl = sim.player;
    if (state === 'TITLE') {
      setFov(FOV);
      const t = world.titleCamera(time);
      if (t) {
        camera.position.copy(t.position);
        camera.lookAt(t.target);
      } else {
        const a = time * 0.05;
        camera.position.set(Math.sin(a) * 17, 7, Math.cos(a) * 17);
        camera.lookAt(0, 1, 0);
      }
      camera.rotation.order = 'YXZ';
      return;
    }
    const bloom = sim.waves && sim.waves.scene;
    if (bloom && inView()) {
      // The castle's two scenes (strike, pyre) have their own cameras in castle.js; the bloom scene keeps its own here.
      const view = bloom.kind === 'bloom' ? null : world.sceneCamera(sim, bloom);
      if (view) {
        camera.rotation.order = 'YXZ';
        camera.position.copy(view.position);
        camera.lookAt(view.target);
        setFov(view.fov || FOV);
        if (sceneEase) easeFrom(sceneEase, view.fov || FOV); // K11: a scene that follows another (the pyre, then the triumph) picks up the ease
        if (sceneLast && sceneLast.fov != null) { sceneLast.pos.copy(camera.position); sceneLast.quat.copy(camera.quaternion); sceneLast.fov = camera.fov; }
        else sceneLast = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
        const q = quake();
        if (q) { // #29: the ground's tremor under the scene's camera: the frame shudders by the same share whatever the lens
          camera.position.y += q;
          camera.rotateX(q * 0.2 * (camera.fov / FOV));
        }
        return;
      }
      if (bloom.kind === 'bloom') {
        placeSceneCamera(bloom);
        return;
      }
    }
    if (endHold) { // K12: THE END stands over the triumph's last view, not over the warden's eye and gun
      camera.position.copy(endHold.pos);
      camera.quaternion.copy(endHold.quat);
      setFov(endHold.fov);
      return;
    }
    const dying = sim.status === 'dying' || sim.status === 'lost';
    const fall = dying ? Math.min(1, 1 - Math.max(0, sim.statusTimer) / sim.cfg.loseBeat) : 0;
    camera.rotation.order = 'YXZ';
    const way = passageOf(sim); // #29: down into the crater, up toward the daylight
    // (the rubble ways: the feet themselves go down the ramp or up the heap, and the follow is a
    // scene with its own camera; only a passage with no path still dips the view)
    const lift = way && !way.path ? (way.way === 'up' ? 1.2 : -1.6) * way.k * way.k : 0;
    const quakeY = quake();
    camera.position.set(
      pl.x + (Math.random() - 0.5) * 0.05 * jolt,
      pl.y + sim.cfg.player.eyeHeight - fall * 1.25 + lift + quakeY + (Math.random() - 0.5) * 0.05 * jolt,
      pl.z,
    );
    camera.rotation.set(pl.pitch - 0.03 * jolt - fall * 0.5, pl.yaw, fall * 0.6);
    if (sceneEase) {
      // Back from the rill: ease from where the scene left the view to the warden's eye.
      easeFrom(sceneEase, FOV);
    } else setFov(FOV);
  }

  /** Eases the camera from where a scene left it (e: { pos, quat, fov, t }) to where it is placed now (the lens fov). */
  function easeFrom(e, fov) {
    e.t = Math.min(1, e.t + frameDt / (runRoom === 'castle' ? CASTLE_EASE : 0.4));
    const k = e.t * e.t * (3 - 2 * e.t);
    const eye = camera.position.clone();
    const eyeQ = camera.quaternion.clone();
    camera.position.copy(e.pos).lerp(eye, k);
    camera.quaternion.copy(e.quat).slerp(eyeQ, k);
    setFov(e.fov != null ? e.fov + (fov - e.fov) * k : fov);
    if (e.t >= 1 && sceneEase === e) sceneEase = null;
  }

  /**
   * The ground's tremor now, metres up or down (0 when still): a low ~11 Hz shudder dying away over
   * its length (the boulder's quarter second; longer and rougher under the crater's blast and the
   * vault, whose rock landing swells it once more).
   */
  function quake() {
    if (!(tremor > 0)) return 0;
    const Q = quaking;
    const e = Q.len - tremor; // seconds in
    if (Q === QUAKES.boulder) return Q.amp * (tremor / Q.len) * Math.sin(e * 70);
    const left = tremor / Q.len;
    let env = left * left;
    if (Q.swell) { const d = (e - Q.swell[0]) / Q.swell[1]; env = Math.max(env, Q.swell[2] * Math.exp(-d * d) * Math.min(1, left * 6)); }
    return Q.amp * env * (0.7 * Math.sin(e * 70) + 0.3 * Math.sin(e * 113 + 1));
  }

  const smooth = (x) => x * x * (3 - 2 * x);

  /**
   * The bloom scene (R3). The view lifts from the warden's eye to a vantage above the rill and
   * follows the water's front (sim.waves.flows[index], over cfg.valveFlow) while it still runs,
   * holds on the bed as it opens, then rises and comes home. The line is kept above every box.
   */
  function placeSceneCamera(sc) {
    const pl = sim.player;
    const total = sim.cfg.bloomScene || 5.5;
    const t = Math.max(0, total - sc.left); // seconds into the scene
    const flowT = sim.cfg.valveFlow || 1.5;
    const fl = COURT.flows[sc.index] || COURT.flows[2];
    const eyeY = pl.y + sim.cfg.player.eyeHeight;
    const at = (q) => ({ x: fl.from.x + fl.dir.x * fl.length * q, z: fl.from.z + fl.dir.z * fl.length * q });
    const left = (sim.waves.flows && sim.waves.flows[sc.index]) || 0;
    const q = Math.min(1, Math.max(0, 1 - left / flowT)); // how far the front has run
    const ride = 0.7; // seconds to lift and reach the rill: before the front has landed
    const back = 0.88 * total; // from here the view rises and comes home
    const a = ride > 0 ? smooth(Math.min(1, t / ride)) : 1;
    const c = at(Math.max(0, q - 0.1));
    const vant = { x: c.x - fl.dir.x * 3, z: c.z - fl.dir.z * 3 };
    const top = 3.8; // over the hedges (3 m)
    const vy = t < ride ? eyeY + (top - eyeY) * (1 - (1 - a) * (1 - a)) : top - 1.4 * smooth(Math.min(1, (t - ride) / 0.8));
    let x = pl.x + (vant.x - pl.x) * a;
    let y = vy;
    let z = pl.z + (vant.z - pl.z) * a;
    const f = at(q);
    const home = { x: pl.x - Math.sin(pl.yaw) * 6, y: eyeY + pl.pitch * 6, z: pl.z - Math.cos(pl.yaw) * 6 };
    let look = { x: f.x + fl.dir.x * 2, y: 0.3, z: f.z + fl.dir.z * 2 };
    const lead = smooth(Math.min(1, t / ride)); // the first look is still the warden's own heading
    look = { x: home.x + (look.x - home.x) * lead, y: home.y + (look.y - home.y) * lead, z: home.z + (look.z - home.z) * lead };
    if (t > back) {
      // One smooth arc home: position and height ease together, with a lift in the middle.
      const k = smooth(Math.min(1, (t - back) / (total - back)));
      const bump = 1.2;
      x += (pl.x - x) * k; z += (pl.z - z) * k;
      y = y + (eyeY - y) * k + bump * Math.sin(Math.PI * k);
      look = { x: look.x + (home.x - look.x) * k, y: look.y + (home.y - look.y) * k, z: look.z + (home.z - look.z) * k };
    }
    // Never inside a hedge, bed or the fountain: lift over a box, easing in across a 0.8 m margin.
    for (const b of sim.boxes || []) {
      const out = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
      const w = 1 - smooth(Math.min(1, out / 0.8));
      const want = b.maxY + 0.5;
      if (w > 0 && y < want) y += (want - y) * w;
    }
    camera.rotation.order = 'YXZ';
    camera.position.set(x, y, z);
    camera.lookAt(look.x, look.y, look.z);
    sceneLast = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  }

  function frame(now) {
    if (dead) return;
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(raw, 0), 0.05);
    frameDt = dt;
    if (raw > 0) fps += (1 / raw - fps) * 0.05;
    const time = now / 1000;

    let simDt = 0;
    if (state === 'PLAYING') {
      simDt = dt;
      const input = controls.snapshot(controls.touchMode() ? settings.touchSensitivity : settings.sensitivity);
      // 1 and 2 name a weapon; asking for the one already in hand is no swap (but key 6 with the lantern up puts it away).
      if (typeof input.swap === 'string' && sim.weapon.name === input.swap) input.swap = sameWeaponSwap(sim, input.swap);
      // touch has no R: an empty clip reloads by itself, but not on a swap frame (the sim swaps first: the reload would go to the new weapon)
      if (controls.touchMode() && !input.swap && needsAutoReload(sim.weapon)) input.reload = true;
      input.hold = eHeld; // E held down (the cord); ending a scene is the sim's call, never this file's
      if (theEndShowing()) { // issue #20: nothing is fired or walked behind THE END
        input.fire = false; input.jump = false; input.moveX = 0; input.moveZ = 0; input.interact = false; input.hold = false;
      }
      const sceneBefore = sim.waves && sim.waves.scene ? sim.waves.scene.kind : null;
      fanOut(stepSim(sim, input, dt));
      const sceneNow = sim.waves && sim.waves.scene ? sim.waves.scene.kind : null;
      if (sceneBefore && !sceneNow && sceneLast) {
        if (sceneBefore === 'triumph' && runRoom === 'castle') endHold = { pos: sceneLast.pos, quat: sceneLast.quat, fov: sceneLast.fov || FOV };
        else if (sceneBefore === 'cutaway') sceneEase = null; // the film ends on a cut back to the warden's own eye (the castle's front is far off)
        else sceneEase = { pos: sceneLast.pos, quat: sceneLast.quat, fov: sceneLast.fov, t: 0 };
        sceneLast = null;
      }
      // K11: the third curtain opens and the dawn floods in: the cut to the pyre's camera is carried by a dip through dawn gold
      if (!sceneBefore && sceneNow === 'pyre' && runRoom === 'castle') { goldDip = { t: 0 }; sceneEase = null; }
      if (sceneBefore === 'cutaway' && !sceneNow) cutDip = CUTAWAY.fade; // the werewolf cutaway: back to the warden out of black
      const way = passageOf(sim); // #29: the crater's dark, the shaft's light, as the warden goes through
      if (way) {
        handover.fade(way.way === 'up' ? 0xfff4dc : 0x050403, way.cover != null ? way.cover : way.k * way.k); // the rubble's: a touch walking on, then the follow's fade
        if (way.done && NEXT[runRoom]) journeyDue = NEXT[runRoom];
      }
      ear.x = sim.player.x;
      ear.z = sim.player.z;
      ear.yaw = sim.player.yaw;
      audio.update(sim, ear); // after the fan-out; moves what is sounding, starts nothing
    }
    // the werewolf cutaway's dip to black at its end, and the fade back in from it (CUTAWAY.fade)
    const playing = sim.waves && sim.waves.scene;
    const film = playing && playing.kind === 'cutaway' ? playing : undefined;
    if (film) { handover.fade(0x000000, cutawayBlack(film.t)); cutDipOn = true; }
    else if (cutDip > 0) { cutDip = Math.max(0, cutDip - (state === 'PLAYING' ? dt : 0)); handover.fade(0x000000, cutDip / CUTAWAY.fade); }
    else if (cutDipOn) { handover.fade(0x000000, 0); cutDipOn = false; }
    if (goldDip) {
      goldDip.t += state === 'PLAYING' ? dt : 0;
      const len = settings.reducedFlash ? 0.9 : 0.55;
      const k = Math.max(0, 1 - goldDip.t / len);
      handover.fade(DAWN_GOLD, (settings.reducedFlash ? 0.5 : 0.85) * k * k * (3 - 2 * k));
      if (k <= 0) goldDip = null;
    }
    if (endHold && ((state !== 'PLAYING' && state !== 'PAUSED') || runRoom !== 'castle' || !(sim.waves && sim.waves.count && sim.waves.count.cheered))) endHold = null; // held until the closing card
    jolt = Math.max(0, jolt - dt / 0.18);
    tremor = Math.max(0, tremor - dt);

    // Issue #20: THE END over the triumph's last seconds and the win beat after it, until the
    // closing card (the dawn card) takes the screen; the plates stay hidden all that while.
    const theEnd = theEndShowing();
    const endEl = document.getElementById('theend');
    if (endEl) {
      if (theEnd && !endEl.textContent) endEl.textContent = CASTLE_COPY.theEnd || '';
      endEl.classList.toggle('on', theEnd);
    }
    const inScene = !!(sim.waves && sim.waves.scene) || theEnd;
    document.getElementById('hud').classList.toggle('scene', inScene);
    document.body.classList.toggle('scene', inScene);
    placeCamera(time);
    const animDt = state === 'TITLE' ? dt : simDt;
    world.update(sim, animDt, time);
    actors.sync(sim, animDt, time, camera.position);
    vm.update(simDt, sim.player, sim.weapon, sim);
    let usePrompt = ''; // the interact prompt on screen (E  Turn, E  Read, ...): the touch E shows with it
    if (inView()) {
      const court = LOG_ROOMS.includes(sim.cfg.room);
      usePrompt = court && state === 'PLAYING' && !inScene ? pages.prompt(sim, controls.touchMode()) : '';
      hud.render(sim, simDt, usePrompt);
      if (court) {
        pages.line(sim);
        pages.tray(sim);
      }
    }
    const cut = sim.waves && sim.waves.scene; // (not `scene`: that is the world's, drawn below)
    touchUi.setContext({
      state,
      hasUsePrompt: !!usePrompt,
      inLogRoom: inLogRoom(),
      sceneSkippable: !!cut && cut.skippable !== false, // the bloom, the crater, the vault, the castle's strike: not the pyre or the triumph
      film: !!cut && cut.kind === 'cutaway', // the werewolf cutaway: SKIP alone over the film
      weaponCount: carried(sim).length, // in hand, the holster (next on Q) and the rack
      hasLantern: lanternReady(sim), // the castle's hand lantern, taken, and the warden indoors
    });

    renderer.info.reset();
    renderer.clear();
    const building = settle(); // #29: the new level's programs are still being built under the cover
    if (!building) {
      // the castle's hand lantern: its programs built once a session, on the first frame of play in the castle (the
      // room's tone mapping, shadows and the tools' castle lights set by then: built earlier, at the title behind the
      // castle, they would not be the programs its first raise asks for)
      if (state === 'PLAYING' && sim.cfg.room === 'castle' && !toolsWarmed.has('lantern') && vm.warm(renderer, ['lantern'])) toolsWarmed.add('lantern');
      world.prerender(camera); // the gallery's glass redraws its target first (counted in the frame's draw stats)
      renderer.render(scene, camera);
      if (inView() && !(sim.waves && sim.waves.scene) && !endHold) {
        renderer.clearDepth();
        renderer.render(vm.scene, vm.camera);
      }
    }
    handover.update(building || state === 'CARD' ? 0 : frameDt); // held while the card is read
    handover.render();
    drawStats.calls = renderer.info.render.calls;
    drawStats.triangles = renderer.info.render.triangles;
    if (journeyDue && state === 'PLAYING') { const to = journeyDue; journeyDue = null; journeyOn(to); } // #29: after the frame is drawn
    else if (swapDue && state === 'CARD') swapUnderCard(false); // #29: the card is on screen: the level swaps under it
  }

  // WebGL context loss: stop, free the pointer, say so. No retry.
  canvas.addEventListener('webglcontextlost', () => {
    dead = true;
    controls.setActive(false);
    controls.releaseLock();
    audio.suspend();
    fatal(NO_WEBGL);
  });

  // Diagnostics for QA: a fresh copy by value on every read (snapshotOf, in hud.js), never the live
  // sim and never an array or object reachable from it. `stage` is a number and `draw` two numbers.
  // Read-only except `audition`, which is labelled below.
  function snapshot() {
    return snapshotOf(sim, drawStats);
  }
  Object.defineProperty(window, '__lanternyard', {
    value: Object.freeze({
      get state() { return state; },
      get fps() { return fps; },
      get room() { return world.room; },
      get sim() { return snapshot(); },
      get draw() { return { calls: drawStats.calls, triangles: drawStats.triangles }; }, // a fresh pair of numbers
      get audio() { return audio.stats(); }, // a fresh stats snapshot on every read
      // QA-only action surface: the one member of this object that does something. It plays a
      // catalogue cue for the listening check, with every option clamped inside audio.js; it
      // goes through the mute gate and touches no game state. Everything else here is read-only.
      audition: (name, opts) => { audio.audition(name, opts); },
    }),
  });

  setState('TITLE');
  requestAnimationFrame(frame);
  loadCastle().catch((err) => console.error(err)); // not awaited: the title is up and the other three rooms are ready now
}

boot().catch((err) => { console.error(err); fatal(ENGINE_FAIL); });
