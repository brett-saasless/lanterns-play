// DOM HUD, overlays, banners, toasts and the settings form. Writes only what changed.

import { CONFIG } from '../logic/config.js';
import { hostilesLeft } from '../logic/sim.js';
import { specOf } from '../logic/weapon.js';
import { PLACES, CASTLE_PLACES, NOTICES, LABELS } from '../logic/script.js';
import { COURT_CONFIG } from '../logic/courtconfig.js';
import { STAGES } from '../logic/keep.js';

const $ = (id) => document.getElementById(id);
const HINTS = ['titlehint', 'pausehint', 'wonhint', 'losthint', 'cardhint'];

/**
 * Room copy, one table keyed by room: every label, prompt and card sentence that differs between
 * the yard, the cave and the Rose Court. The place names and card words of the court come from
 * logic/script.js by key; nothing of theirs is retyped here.
 */
const ROOM_COPY = {
  yard: {
    wave: 'Wave', ammo: 'Rivets', unit: 'rivets', dry: 'No rivets. Find a crate.', downed: 'Drones downed',
    reached: 'Surge reached', wonTitle: 'Yard secured', wonSub: 'All three surges held. The tide is turning.',
    lostSub: (st, n) => `The yard fell on surge ${st.waveReached} of ${n}.`,
    start: (ev) => ['Surge ' + ev.wave + ' of ' + ev.of, ev.wave === ev.of ? 'Last surge' : ''],
    cleared: ['Wave cleared. Restock.', 'Pads refilled'], quiet: 'Yard quiet',
  },
  cave: {
    wave: 'Chamber', ammo: 'Salt', unit: 'salt', dry: 'No salt. Find a cache.', downed: 'Creatures downed',
    reached: 'Chamber reached', wonTitle: 'Cave quiet', wonSub: 'The singing stopped.',
    lostSub: (st) => `The cave kept you in chamber ${st.waveReached}.`,
    start: (ev) => ['Chamber ' + ev.wave + ' of ' + ev.of, ev.wave === ev.of ? 'It has stopped singing.' : ''],
    cleared: ['Chamber cleared. The way opens.', ''], quiet: 'Cave quiet',
  },
  court: {
    wave: PLACES[0], ammo: 'Salt', unit: 'salt', dry: 'No salt. Find a cache.', downed: 'Figures downed',
    // The plate's label is read from sim.weapon.name every frame (R22); the halberd and the cup have no ammunition.
    // The castle's garlic (#9) is named by its approved notice word, 'Garlic'.
    ammoBy: { bore: 'Salt', crossbow: 'Stakes', halberd: LABELS.halberd, cup: LABELS.cup, garlic: NOTICES.garlic },
    dryBy: { crossbow: '', halberd: '', cup: '', garlic: '' }, drawing: 'Drawing',
    // The court's end card leads into the castle (main.js): there is no closing card, so no won words.
    reached: 'Place reached', wonTitle: '', wonSub: '',
    lostSub: (st, n, at) => `The warden wakes at ${PLACES[at] || PLACES[0]}.`,
    start: null, cleared: null, quiet: null,
  },
};
// The castle is the court's second half: the same plates and lines, its own place names. Its end
// is the after-the-dawn card and then the title, so it has no won words either.
ROOM_COPY.castle = {
  ...ROOM_COPY.court,
  wave: CASTLE_PLACES[0],
  lostSub: (st, n, at) => `The warden wakes at ${CASTLE_PLACES[at] || CASTLE_PLACES[0]}.`,
};
/** Rooms that have a warden's log, a clue card, a prompt, a notice line and an item tray. */
export const hasLog = (room) => room === 'court' || room === 'castle';
const PLACE_NAMES = { court: PLACES, castle: CASTLE_PLACES };

/**
 * The diagnostics snapshot behind window.__lanternyard.sim: a fresh object built field by field
 * from scalars, never a live sim or any array or object reachable from it (security A5). `draw`
 * is the renderer's last-frame counts as two numbers. Nothing here can be written back.
 */
export function snapshotOf(sim, draw) {
  const { player: p, stats: st, weapon: w, waves } = sim;
  return {
    time: sim.time,
    status: sim.status,
    stage: waves.index,
    player: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health },
    stats: { ...st },
    weapon: { mag: w.mag, reserve: w.reserve, reloading: w.reloading },
    waves: { index: waves.index, count: typeof waves.count === 'number' ? waves.count : STAGES, queued: waves.queue.length, phase: waves.phase },
    scene: !!waves.scene,
    enemies: sim.enemies.map((e) => ({ type: e.type, hp: e.hp })),
    draw: { calls: draw ? draw.calls : 0, triangles: draw ? draw.triangles : 0 },
  };
}

/**
 * R22, the rule for which tool the viewmodel draws, pure so a test can drive it. held is the name
 * from sim.weapon ('carbine' for anything without a model of its own), drawn the tool up now,
 * swapLeft the seconds of a swap still playing, swapTo the tool a swap is raising. Returns
 * {apply, swapTo}: apply is the tool to seat at once (never during a swap), swapTo the target the
 * swap should now aim at. sim.weapon always wins over what a `swap` event said.
 */
export function drawnTool(held, drawn, swapLeft, swapTo) {
  if (!held) return { apply: null, swapTo: swapTo || null };
  if (swapLeft > 0) return { apply: null, swapTo: held !== drawn ? held : null };
  return { apply: held !== drawn ? held : null, swapTo: null };
}

/**
 * lookKey (optional): the settings key the Look speed slider drives now ('sensitivity' for the
 * mouse, 'touchSensitivity' in touch mode); the slider writes and shows that one.
 */
export function createHud(settings, onSettingsChange, lookKey = () => 'sensitivity') {
  const el = {
    hud: $('hud'), wavenum: $('wavenum'), hostiles: $('hostiles'), wavelab: $('wavelab'), hostlab: $('hostlab'), ammolab: $('ammolab'), mute: $('mutebox'),
    hbar: $('hbar'), hnum: $('hnum'), mag: $('mag'), reserve: $('reserve'), pips: $('pips'),
    crosshair: $('crosshair'), hitmark: $('hitmark'), prompt: $('prompt'), banner: $('banner'), toast: $('toast'),
    notice: $('notice-line') || { classList: { add() {}, remove() {} }, textContent: '' }, // the notice line (R10)
    dmg: $('dmg'), lowhp: $('lowhp'), dirarc: $('dirarc'), fade: $('fade'),
  };
  const screens = { title: $('title'), paused: $('paused'), won: $('won'), lost: $('lost') };
  const hostBox = el.hostiles.parentElement; // the hostile count's label, hidden in the court

  for (let i = 0; i < 10; i++) el.hbar.appendChild(document.createElement('i'));
  const last = {};
  const segs = [...el.hbar.children];
  let pips = [];
  let room = 'yard';
  let copy = ROOM_COPY.yard;

  function buildPips(n) {
    el.pips.replaceChildren();
    for (let i = 0; i < n; i++) el.pips.appendChild(document.createElement('i'));
    pips = [...el.pips.children];
  }

  /** Room copy and pip count; call after every resetSim. Clears the cached readouts. */
  function setRoom(cfg) {
    room = cfg.room;
    copy = ROOM_COPY[room] || ROOM_COPY.yard;
    const court = hasLog(room);
    el.wavelab.textContent = copy.wave;
    el.hostlab.textContent = 'Hostiles';
    el.ammolab.textContent = copy.ammo;
    el.wavenum.style.display = court ? 'none' : ''; // the place plate never shows a count
    hostBox.style.display = court ? 'none' : '';
    buildPips(cfg.weapon.magazine);
    for (const k of Object.keys(last)) delete last[k];
  }

  // Settings form, rendered into the title and pause cards and kept in sync.
  const forms = [...document.querySelectorAll('[data-settings]')];
  forms.forEach((f, i) => {
    f.innerHTML = `
      <label class="label" for="sens${i}">Look speed</label>
      <input type="range" id="sens${i}" data-k="sensitivity" min="0.2" max="3" step="0.05">
      <label class="label" for="rf${i}">Reduced flash</label>
      <input type="checkbox" id="rf${i}" data-k="reducedFlash">
      <label class="label" for="mu${i}">Mute (M)</label>
      <input type="checkbox" id="mu${i}" data-k="muted">`;
    f.addEventListener('input', (e) => {
      const k = e.target.dataset.k === 'sensitivity' ? lookKey() : e.target.dataset.k;
      if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value);
      onSettingsChange({ [k]: v });
    });
    // Keep keyboard focus off the form so Enter and Space reach the game.
    f.addEventListener('change', (e) => e.target.blur());
  });
  function syncSettings(s) {
    for (const f of forms) {
      f.querySelector('[data-k=sensitivity]').value = s[lookKey()];
      f.querySelector('[data-k=reducedFlash]').checked = s.reducedFlash;
      f.querySelector('[data-k=muted]').checked = s.muted;
    }
    el.mute.classList.toggle('on', s.muted);
    el.dmg.classList.toggle('reduced', s.reducedFlash);
  }
  syncSettings(settings);
  setRoom(CONFIG);

  const set = (key, node, text) => {
    if (last[key] !== text) { last[key] = text; node.textContent = text; }
  };
  let noticeOn = false; // kept outside `last`, which setRoom clears
  const timers = { hit: 0, fire: 0, dmg: 0, dmgPeak: 0, arc: 0, toast: 0, banner: 0, notice: 0 };

  /** interactText (optional): the interact prompt from pages.prompt(sim); it wins the prompt line. */
  function render(sim, dt, interactText = '') {
    const pl = sim.player;
    const w = sim.weapon;
    const court = hasLog(room);
    const spec = specOf(sim.cfg, w);
    if (court) {
      const names = PLACE_NAMES[room];
      set('place', el.wavelab, names[Math.min(sim.waves.index, names.length - 1)]);
      set('ammolab', el.ammolab, copy.ammoBy[w.name] || copy.ammo);
    } else {
      set('wave', el.wavenum, `${sim.waves.index + 1}/${sim.waves.count}`);
    }
    const boss = room === 'cave' && sim.waves.index === sim.waves.count - 1 && sim.waves.bossId != null
      ? sim.enemies.find((e) => e.id === sim.waves.bossId && !e.dead) : null;
    if (court) {
      // no hostile count in this room: the plate names the place
    } else if (boss) {
      set('hostlab', el.hostlab, 'Cantor');
      set('hostiles', el.hostiles, `${Math.max(1, Math.ceil((100 * boss.hp) / sim.cfg.cantor.hp))}%`);
    } else {
      set('hostlab', el.hostlab, 'Hostiles');
      set('hostiles', el.hostiles, String(hostilesLeft(sim)));
    }
    const hp = Math.ceil(pl.health);
    if (last.hp !== hp) {
      last.hp = hp;
      el.hnum.textContent = String(hp);
      const lit = Math.ceil(hp / 10);
      segs.forEach((s, i) => s.classList.toggle('off', i >= lit));
      el.hbar.classList.toggle('low', hp < 30);
      el.lowhp.classList.toggle('on', hp > 0 && hp < 30);
    }
    // R22: the label, the count and the pips are all read from sim.weapon here, every frame.
    // The halberd and the garlic show a dash and no pips; the cup shows one pip, lit when full (waves.items.cup).
    const noAmmo = court && !!(spec.melee || spec.splash || spec.ward);
    const isCup = noAmmo && w.name === 'cup';
    const cupFull = isCup && !!sim.waves.items && sim.waves.items.cup === 'full';
    set('mag', el.mag, noAmmo ? (isCup ? '' : '\u2013') : String(w.mag));
    const emptyNow = noAmmo ? false : w.mag === 0;
    if (last.empty !== emptyNow) { last.empty = emptyNow; el.mag.classList.toggle('empty', emptyNow); }
    const total = isCup ? 1 : noAmmo ? 0 : spec.magazine;
    const lit = isCup ? (cupFull ? 1 : 0) : w.mag;
    const pipSig = `${total}:${lit}`;
    if (last.pips !== pipSig) {
      last.pips = pipSig;
      el.pips.style.display = total ? '' : 'none';
      if (total) {
        if (pips.length !== total) buildPips(total);
        pips.forEach((p, i) => p.classList.toggle('off', i >= lit));
      }
    }
    // Stakes: the count is fresh ones, with the worn ones beside it (they are loaded first).
    const worn = noAmmo ? 0 : w.worn || 0;
    const wornNow = !noAmmo && !!w.loadedWorn && w.mag > 0;
    if (last.worn !== wornNow) { last.worn = wornNow; el.mag.classList.toggle('worn', wornNow); }
    set('reserve', el.reserve, noAmmo ? '' : worn > 0 ? `/ ${w.reserve - worn} +${worn} worn` : `/ ${w.reserve}`);

    let prompt = '';
    if (noAmmo) prompt = '';
    else if (w.reloading) prompt = 'reload';
    else if (w.mag === 0 && w.reserve === 0) prompt = court ? (copy.dryBy[w.name] ?? copy.dry) : copy.dry;
    else if (w.mag === 0 && !spec.draw) prompt = 'Press R to reload';
    if (interactText) {
      set('prompt', el.prompt, interactText);
    } else if (prompt === 'reload') {
      if (last.prompt !== 'reload') {
        last.prompt = 'reload';
        el.prompt.innerHTML = `${court && w.name === 'crossbow' ? copy.drawing : 'Reloading'}<span class="prog"></span>`;
      }
      const k = 1 - w.reloadLeft / spec.reloadTime;
      el.prompt.firstElementChild.style.width = `${Math.round(k * 100)}%`;
    } else {
      set('prompt', el.prompt, prompt);
    }

    // Timed effects
    timers.hit = Math.max(0, timers.hit - dt);
    if (timers.hit === 0) el.hitmark.classList.remove('on');
    timers.fire = Math.max(0, timers.fire - dt);
    el.crosshair.classList.toggle('fire', timers.fire > 0);
    timers.dmg = Math.max(0, timers.dmg - dt);
    el.dmg.style.opacity = timers.dmg > 0 ? String((timers.dmg / 0.15) * timers.dmgPeak) : '0';
    timers.arc = Math.max(0, timers.arc - dt);
    el.dirarc.style.opacity = String(Math.min(1, timers.arc / 0.4));
    if (timers.arc > 0 && last.arcFrom) {
      const a = Math.atan2(-(last.arcFrom.x - pl.x), -(last.arcFrom.z - pl.z));
      const rel = a - pl.yaw;
      el.dirarc.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    }
    timers.toast = Math.max(0, timers.toast - dt);
    if (timers.toast === 0) el.toast.classList.remove('on');
    timers.banner = Math.max(0, timers.banner - dt);
    if (timers.banner === 0) el.banner.classList.remove('on');
    timers.notice = Math.max(0, timers.notice - dt);
    if (timers.notice === 0 && noticeOn) { noticeOn = false; el.notice.classList.remove('on'); }
  }

  /**
   * The notice line (R10): one line of plain words under the prompt for COURT_CONFIG.noticeTime
   * seconds of play. The newest wins: a second call replaces the first and restarts the clock.
   * The words are set as text only (security A5), whatever they contain.
   */
  function notice(text) {
    if (typeof text !== 'string' || !text) return;
    el.notice.textContent = text;
    el.notice.classList.add('on');
    noticeOn = true;
    timers.notice = COURT_CONFIG.noticeTime;
  }

  function banner(text, sub, seconds) {
    el.banner.innerHTML = '';
    el.banner.append(text);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.banner.append(s);
    }
    el.banner.classList.add('on');
    timers.banner = seconds;
  }

  function toast(text, kind) {
    el.toast.textContent = text;
    el.toast.className = `label on ${kind}`;
    timers.toast = 1.2;
  }

  function onEvent(ev, sim, reducedFlash) {
    switch (ev.type) {
      case 'shot': timers.fire = 0.08; break;
      case 'hit':
        el.hitmark.classList.toggle('kill', ev.kill);
        el.hitmark.classList.add('on');
        timers.hit = 0.12;
        break;
      case 'hurt':
        timers.dmg = 0.15;
        timers.dmgPeak = reducedFlash ? 0.6 : 1;
        if (!ev.fall) { // a fall (the yard's crates) has no direction to show
          timers.arc = 0.9;
          last.arcFrom = { x: ev.fromX, z: ev.fromZ };
        }
        break;
      case 'pickup':
        toast(ev.kind === 'ammo' ? `+${ev.amount} ${copy.unit}` : `+${ev.amount} patched`, ev.kind);
        break;
      case 'waveStart':
        if (copy.start) {
          const [text, sub] = copy.start(ev);
          banner(text, sub, 2);
        }
        break;
      case 'notice':
        if (Object.prototype.hasOwnProperty.call(NOTICES, ev.key)) notice(NOTICES[ev.key]);
        break;
      case 'checkpoint': banner(ev.name, '', 2.5); break; // the court: a place name and nothing else
      case 'waveCleared':
        if (copy.cleared) banner(copy.cleared[0], copy.cleared[1], room === 'yard' ? CONFIG.breather : 2.5);
        break;
      case 'allClear': if (copy.quiet) banner(copy.quiet, '', 1.2); break;
      case 'died': el.fade.classList.add('on'); break;
      default:
    }
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  function statsHtml(st, extra, c) {
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    const rows = hasLog(room)
      ? [...extra, ['Time', fmtTime(st.time)], ['Shots', st.shots], ['Damage taken', st.damageTaken]]
      : [
        ...extra,
        ['Time', fmtTime(st.time)],
        [c.downed, st.kills],
        ['Shots', st.shots],
        ['Accuracy', `${acc}%`],
        ['Damage taken', st.damageTaken],
      ];
    return rows.map(([k, v]) => `<dt class="label">${k}</dt><dd>${v}</dd>`).join('');
  }

  /**
   * Shows one overlay by state name. 'card' and 'log' belong to pages.js (it shows its own
   * leaves); here they only dim the HUD over the frozen view, as the pause card does.
   */
  function showScreen(name, sim) {
    for (const [k, node] of Object.entries(screens)) node.classList.toggle('on', k === name);
    const inPlay = name === 'playing' || name === 'paused' || name === 'card' || name === 'log';
    el.hud.classList.toggle('on', inPlay);
    el.hud.classList.toggle('dim', name !== 'playing' && inPlay);
    el.lowhp.style.display = inPlay ? '' : 'none';
    el.dirarc.style.display = inPlay ? '' : 'none';
    const c = ROOM_COPY[sim.cfg.room] || ROOM_COPY.yard;
    const court = hasLog(sim.cfg.room);
    document.body.classList.toggle('court', court);
    if (name === 'won') {
      $('wontitle').textContent = c.wonTitle;
      $('wonsub').textContent = c.wonSub;
      $('wonstats').innerHTML = statsHtml(sim.stats, [], c);
      $('again').style.display = court ? 'none' : ''; // a log room has no won card of its own
    }
    if (name === 'lost') {
      const at = court && sim.waves.checkpoint ? sim.waves.checkpoint.index : 0;
      $('lostsub').textContent = c.lostSub(sim.stats, sim.waves.count, at);
      $('loststats').innerHTML = statsHtml(sim.stats, court ? [] : [[c.reached, `${sim.stats.waveReached} / ${sim.waves.count}`]], c);
    }
    if (name !== 'lost') el.fade.classList.remove('on');
    for (const h of HINTS) $(h).textContent = '';
  }

  function hint(text) {
    for (const h of HINTS) $(h).textContent = text;
  }

  function reset() {
    for (const k of Object.keys(timers)) timers[k] = 0;
    for (const k of Object.keys(last)) delete last[k];
    el.banner.classList.remove('on');
    el.toast.classList.remove('on');
    el.notice.classList.remove('on');
    el.notice.textContent = '';
    noticeOn = false;
    el.hitmark.classList.remove('on');
    el.fade.classList.remove('on');
    el.dmg.style.opacity = '0';
    el.dirarc.style.opacity = '0';
  }

  return { render, notice, onEvent, showScreen, hint, reset, setRoom, syncSettings };
}
