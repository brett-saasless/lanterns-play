// DOM-free touch state: which finger (pointer id) does what. Produces one snapshot per frame.
import { stickToMove, lookPixels } from '../logic/touchmap.js';

export function createTouchInput() {
  const roles = new Map(); // pointerId -> 'stick' | 'fire'
  let stick = { moveX: 0, moveZ: 0, sprint: false };
  let fire = false;
  let dx = 0;
  let dy = 0;
  let jump = false;
  let interact = false;
  let swap = false;
  let skip = false;

  const roleOf = (id) => roles.get(id);
  const heldBy = (role) => { for (const [, r] of roles) if (r === role) return true; return false; };
  const addLook = (px, py) => {
    const l = lookPixels(px, py);
    dx += l.dx;
    dy += l.dy;
  };

  function setStick(id, x, y) {
    const r = roleOf(id);
    if (r && r !== 'stick') return;
    if (!r && heldBy('stick')) return; // another finger already holds the stick
    roles.set(id, 'stick');
    stick = stickToMove(x, y);
  }
  function endStick(id) {
    if (roleOf(id) !== 'stick') return;
    roles.delete(id);
    stick = { moveX: 0, moveZ: 0, sprint: false };
  }
  function fireStart(id) {
    if (roleOf(id)) return;
    if (heldBy('fire')) return; // another finger already holds FIRE
    roles.set(id, 'fire');
    fire = true;
  }
  function fireMove(id, px, py) {
    if (roleOf(id) === 'fire') addLook(px, py);
  }
  function fireEnd(id) {
    if (roleOf(id) !== 'fire') return;
    roles.delete(id);
    fire = false;
  }
  function lookMove(id, px, py) {
    if (roleOf(id)) return;
    addLook(px, py);
  }
  function press(name) {
    if (name === 'jump') jump = true;
    else if (name === 'interact') interact = true;
    else if (name === 'swap') swap = true;
    else if (name === 'skip') skip = true;
  }
  function cancel(id) {
    const r = roleOf(id);
    if (r === 'stick') endStick(id);
    else if (r === 'fire') fireEnd(id);
  }
  function clear() {
    roles.clear();
    stick = { moveX: 0, moveZ: 0, sprint: false };
    fire = false;
    dx = 0;
    dy = 0;
    jump = false;
    interact = false;
    swap = false;
    skip = false;
  }
  /** Builds this frame's input and consumes look deltas and one-shot presses. */
  function take() {
    const out = { ...stick, dx, dy, fire, jump, interact, swap, skip };
    dx = 0;
    dy = 0;
    jump = false;
    interact = false;
    swap = false;
    skip = false;
    return out;
  }

  return { setStick, endStick, fireStart, fireMove, fireEnd, lookMove, press, cancel, take, clear };
}
