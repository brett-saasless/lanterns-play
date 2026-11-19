// The werewolf's raised hand comes out of its painting to strike (the owner, 2026-11-18: "when he
// attacks a third hand attack, the raised left hand in the painting should do the attack. the
// beefeater sleeve should be on there. it should flow fluidly out of the painting like the wife,
// but faster since it is a claw attack"). The painting's raised left claw is the one that strikes:
// no third hand. A pure timeline, as logic/emerge.js is the wife's: keepcast.js (buildTeaSet) counts
// the seconds since the rules' clawTell and reads the rest; nothing here touches the rules (keep.js
// stepClaw keeps its 0.4 s tell, its 15 damage and its 1.5 s between strikes).
//
// clawStrikeAt(ta, hit, out): ta seconds since the clawTell, hit the second the claw landed (the rules'
// tell). Fills out with
//   t      seconds into the emergence (0 the hand in the paint, CLAW_EMERGE.time fully out): forward
//          from the tell, held out, then read backward over CLAW_EMERGE.back as it goes home
//   swipe  the rake's own sweep (0..1..0 over 0.32 s from the hit), as the arm swiped before
//   done   the hand is back in the canvas and the attack is over
// clawEmergeAt(t, dur, out) fills out (no allocation a frame) with, each 0..1 and monotonic in t
// (the phases set in seconds of the 0.55 s emergence; u = t / dur):
//   ripple the paint's ripple round the hand: up in 0.08 s, settled by the end
//   arm    the 3D arm's presence (0 none, 1 whole): 0.02-0.15 s, crossing the paint
//   paint  the painted forearm and hand still on the canvas: falls 0.06-0.22 s, a last scatter of it
//          lingering until the arm is out (0 only at the end). paint and arm are never both 0 and
//          never both 1 at once.
//   lift   the arm's depth off the canvas plane (it starts flat on the paint): 0.03-0.20 s
//   swing  the forearm pitching from upright on the canvas (as painted) down and out at the
//          warden: 0.08-0.55 s
//   reach  the sleeve's length from the painted forearm's to the strike's: 0.12-0.55 s
//   grow   the hand from the painted size to its own (CLAW_EMERGE.grow): 0.10-0.50 s
// clawPoseAt(t, dims, out) turns these into the angles and lengths the view sets, and the claw tip's
// place in the painting's frame (for the speed check).

export const CLAW_EMERGE = Object.freeze({
  time: 0.55, // seconds from the tell to the claw at full stretch (the swipe's peak is at 0.4 + 0.16 s)
  back: 0.45, // seconds home again into the canvas, the same curve backward
  stay: 1.3, // the arm out at least this long after the tell (as before), and 0.7 s past the hit
  afterHit: 0.7,
  swipe: 0.32, // the rake's sweep from the hit (as before)
  rest: Object.freeze({ pitch: Math.PI / 2, lean: 0.18 }), // the painted forearm: upright, leaning in toward the head
  strike: Object.freeze({ pitch: -0.2 }), // out of the canvas and a little down, at the warden's chest
  grow: 1.3, // the hand's own size over the painted one's
});

const clamp = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const smooth = (k) => { const x = clamp(k); return x * x * (3 - 2 * x); };

export function clawEmergeAt(t, dur = CLAW_EMERGE.time, out = {}) {
  const u = dur > 0 ? clamp(t / dur) : 1;
  const sec = u * 0.55;
  out.u = u;
  out.ripple = smooth(sec / 0.08) * (1 - smooth((sec - 0.22) / 0.25));
  out.arm = smooth((sec - 0.02) / 0.13);
  out.paint = 0.85 * (1 - smooth((sec - 0.06) / 0.16)) + 0.15 * (1 - u);
  out.lift = smooth((sec - 0.03) / 0.17);
  out.swing = smooth((sec - 0.08) / 0.47);
  out.reach = smooth((sec - 0.12) / 0.43);
  out.grow = smooth((sec - 0.1) / 0.4);
  return out;
}

export function clawStrikeAt(ta, hit = 0.4, out = {}) {
  const E = CLAW_EMERGE;
  const home = Math.max(E.stay, hit + E.afterHit);
  if (!(ta >= 0)) { out.t = 0; out.swipe = 0; out.done = true; return out; }
  out.t = ta < home ? Math.min(ta, E.time) : E.time * Math.max(0, 1 - (ta - home) / E.back);
  const sw = ta - hit;
  out.swipe = sw > 0 && sw < E.swipe ? Math.sin((Math.PI * sw) / E.swipe) : 0;
  out.done = ta >= home + E.back;
  return out;
}

const lerp = (a, b, k) => a * (1 - k) + b * k; // exact at both ends

/**
 * The pose at t seconds into the emergence. dims: { forearm: the painted elbow-to-wrist length, full:
 * the sleeve's length at full stretch, hand: the painted wrist-to-claw-tip length, pitch?: the strike's
 * pitch, CLAW_EMERGE.strike.pitch if not given } (metres, radians). out:
 * { e (clawEmergeAt's), pitch, lean, sleeve, scale, depth, tipY, tipZ } where pitch turns the arm from
 * straight out of the canvas (0) to straight up it (pi/2), lean tips it in the canvas's plane, depth is
 * its thickness off the canvas (a share), and (tipY, tipZ) is the claw tip from the elbow in the
 * painting's frame (+y up, +z out into the room; the aim's turn aside left out).
 */
export function clawPoseAt(t, dims, out = { e: {} }) {
  const E = CLAW_EMERGE;
  const e = clawEmergeAt(t, E.time, out.e || (out.e = {}));
  out.pitch = lerp(E.rest.pitch, Number.isFinite(dims.pitch) ? dims.pitch : E.strike.pitch, e.swing);
  out.lean = E.rest.lean * (1 - e.swing);
  out.sleeve = lerp(dims.forearm, dims.full, e.reach);
  out.scale = lerp(1, E.grow, e.grow);
  out.depth = lerp(0.06, 1, e.lift);
  const len = out.sleeve + dims.hand * out.scale;
  out.tipY = Math.sin(out.pitch) * Math.cos(out.lean) * len;
  out.tipZ = Math.cos(out.pitch) * len;
  return out;
}
