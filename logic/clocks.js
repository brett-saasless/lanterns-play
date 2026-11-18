// Tea for the Dead's five clocks (R7, G5). Every stopped clock's minute hand already stands at
// twelve and never moves; E moves the hour hand on one hour, round again after twelve.
// Renfield's hour is midnight, so the right setting is hour 12 (12:00). A right clock
// ticks; E on a ticking clock still moves it on (it stops), so there is nothing to lock and
// nothing to fail. When all five tick they strike together, once per game; after that the
// clocks cannot be moved. No timer: nothing here steps with time. State lives in
// sim.waves.clocks ({ hours[5], each 1 to 12 }); the solve in sim.waves.done.clocks. Places
// are in keepmap.js; the stopped hours are the castle's numbers (CASTLE_CONFIG may pass its own).

/** The five clocks, in the order of hours[]: by the door, mantel, table, skeleton's hand, wall. */
export const CLOCK_NAMES = Object.freeze(['longcase', 'mantel', 'carriage', 'pocket', 'wall']);

/** The design's numbers: the stopped hours (none of them right), the right hour, the minute. */
export const CLOCK_RULES = Object.freeze({
  stopped: Object.freeze([3, 11, 6, 1, 5]),
  right: 12,
  minute: 0,
});

/**
 * Every exported function takes an optional rules object (CASTLE_CONFIG.clocks, which has
 * stopped and right but no minute) and reads it merged over CLOCK_RULES. Keys whose value is
 * undefined are dropped first, so they cannot blank a default. If the merged stopped hours
 * are not valid against the merged right hour (say { right: 3 }, which the default stopped
 * list holds), CLOCK_RULES is used entirely, stopped and right, so no clock starts right (G5).
 */
function merged(rules) {
  if (!rules || rules === CLOCK_RULES || typeof rules !== 'object') return CLOCK_RULES;
  const defined = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== undefined));
  const m = { ...CLOCK_RULES, ...defined };
  if (!validStopped(m.stopped, m.right)) {
    if (!validStopped(CLOCK_RULES.stopped, m.right)) return CLOCK_RULES;
    m.stopped = CLOCK_RULES.stopped;
  }
  return m;
}

/** True for exactly five whole hours 1 to 12, none of them the right hour. */
export function validStopped(stopped, right = CLOCK_RULES.right) {
  return Array.isArray(stopped) && stopped.length === CLOCK_NAMES.length
    && stopped.every((h) => Number.isInteger(h) && h >= 1 && h <= 12 && h !== right);
}

/**
 * Fresh clocks at their stopped hours. A list that is not exactly five whole hours 1 to 12,
 * none of them right, is refused and the rules' own stopped hours are used instead (merged
 * guarantees those are valid against its right hour).
 */
export function createClocks(stopped = CLOCK_RULES.stopped, rules) {
  const r = merged(rules);
  return { hours: (validStopped(stopped, r.right) ? stopped : r.stopped).slice() };
}

/** Clocks as a restore writes them: all at the right hour if solved, else the stopped hours. */
export function clocksFor(done, rules) {
  const r = merged(rules);
  return done && done.clocks
    ? { hours: CLOCK_NAMES.map(() => r.right) }
    : createClocks(r.stopped, r);
}

/** True when clock i is at the right hour, and so ticks. */
export function ticking(clocks, i, rules) {
  return clocks.hours[i] === merged(rules).right;
}

/** True when all five are right. */
export function allRight(clocks, rules) {
  const r = merged(rules);
  return clocks.hours.length === CLOCK_NAMES.length && clocks.hours.every((h) => h === r.right);
}

/** The hour after h on a twelve-hour face. */
export function nextHour(h) {
  return (h % 12) + 1;
}

/**
 * E on clock i. Once the clocks have struck (done.clocks) nothing moves and this returns
 * null. Otherwise the hour hand moves on one hour; pushes clockSet { clock (the index), hour,
 * right }, then clocksStrike {} the moment all five are right. The caller sets done.clocks
 * on struck and starts the strike scene. Returns { clock, hour, right, struck }.
 */
export function setClock(clocks, i, events = [], done = {}, rules) {
  if ((done && done.clocks) || !Number.isInteger(i) || i < 0 || i >= CLOCK_NAMES.length) return null;
  const r = merged(rules);
  const hour = nextHour(clocks.hours[i]);
  clocks.hours[i] = hour;
  const right = hour === r.right;
  events.push({ type: 'clockSet', clock: i, hour, right });
  const struck = allRight(clocks, r);
  if (struck) events.push({ type: 'clocksStrike' });
  return { clock: i, hour, right, struck };
}

/**
 * How a face reads at hour h, for the view: the minute hand always at twelve, the hour
 * hand exactly on h. Turns are fractions of a full turn
 * clockwise from twelve.
 */
export function faceOf(h, rules) {
  const r = merged(rules);
  return {
    hour: h,
    minute: r.minute,
    hourTurn: ((h % 12) + r.minute / 60) / 12,
    minuteTurn: r.minute / 60,
  };
}

/**
 * How far a clock's tick carries (#19): full strength within `near` metres, then a smooth fall to
 * nothing at `far`; a listener on the other side of a wall (out of the tea room, in the hallway)
 * hears `wall` of what the distance leaves. Metres, not seconds: the audio reads it each frame.
 */
export const TICK_REACH = Object.freeze({ near: 5, far: 22, wall: 0.5 });

/** The tick's share of full strength (0 to 1) at `dist` metres from the clock; `walled` when a wall is between. */
export function tickGain(dist, walled = false) {
  const d = Number(dist);
  if (!Number.isFinite(d)) return 0;
  const { near, far, wall } = TICK_REACH;
  const u = Math.min(1, Math.max(0, (d - near) / (far - near)));
  const g = (1 - u) * (1 - u);
  return walled ? g * wall : g;
}
