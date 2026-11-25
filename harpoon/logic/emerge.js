// The wife comes out of her painting (the owner, 2026-11-18: "she should flow out of the picture
// not appear suddenly. the picture of her is coming to life. it should be a fluid transition from
// painting to ghost"). A pure timeline: sentries.js counts the seconds (e.emerge, in 'stir') and
// moves her off the wall by `lift`; the views read the rest. Read backward (t from time down to 0)
// it is the paint settling again (keepcast.js, a restore that seats her back in the canvas).
//
// emergeAt(t, dur, out) fills out (no allocation a frame) with, each 0..1 and monotonic in t. The
// seconds are at the castle's 3.2 s (the art critic, 2026-11-18: slow enough to read; u = t / dur):
//   ripple the paint surface's ripple: rising 0-0.7 s, at its height 0.7-1.8 s, settling by the end
//   mist   the mist off her painted outline: a lead-in to half 0.2-0.7 s, all of it by about 1.9 s
//   paint  the painted figure still on the canvas (1 whole, 0 the canvas empty): it falls 0.6-2.6 s
//          and a last scatter of it lingers until she stands free (0 only at the end)
//   ghost  the ghost's presence (0 none, 1 all of her): 0.5-2.2 s, so the first 0.5 s is the paint
//          alone, rippling, flat against the canvas
//   head   the canvas's sculpted head, sinking into hers as hers comes over it (u 0.15-0.6)
//   grow   her own size from the painted head's (the view scales her 0.9) to hers, from u 0.4
//   lift   how far she has come off the canvas plane to where she stands free (and her depth):
//          from 1.0 s
//   look   painted colour to ghost colour: the painted ivory and black to pale, see-through blue
//   frame  1 while she is held to her own part of the canvas (the view clips her there), letting
//          go as the lift passes 0.4-0.6, so she breaks out of the picture as a seen event
//   grin   her mouth: a calm closed line until she is clear of the frame (lift 0.5, never before
//          u 0.45), then her grin opens over 0.4 s
// paint and ghost are never both 0 and never both 1 at once.

export const EMERGE = Object.freeze({
  time: 3.2, // seconds from the first ripple of the paint to standing free of the frame (2.0 read too fast)
  free: 0.6, // metres off the wall (along the painting's facing) where she stands free
});

const clamp = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
const smooth = (k) => { const x = clamp(k); return x * x * (3 - 2 * x); };

export function emergeAt(t, dur = EMERGE.time, out = {}) {
  const u = dur > 0 ? clamp(t / dur) : 1;
  const sec = u * 3.2; // the phases are set in seconds of the 3.2 s emergence; another dur scales them
  out.u = u;
  out.ripple = smooth(sec / 0.7) * (1 - smooth((sec - 1.8) / 1.4));
  out.mist = Math.max(0.5 * smooth((sec - 0.2) / 0.5), smooth((sec - 0.7) / 1.2));
  out.paint = 0.85 * (1 - smooth((sec - 0.6) / 2.0)) + 0.15 * (1 - u);
  out.ghost = smooth((sec - 0.5) / 1.7);
  out.head = 1 - smooth((u - 0.15) / 0.45);
  out.grow = smooth((u - 0.4) / 0.35);
  out.lift = smooth((sec - 1.0) / 2.2);
  out.look = smooth((sec - 0.9) / 2.0);
  out.frame = 1 - smooth((out.lift - 0.4) / 0.2);
  // clear of the frame: the lift reaches 0.5 at sec 2.1 (u 0.656), past u 0.45
  out.grin = smooth((sec - 2.1) / 0.4);
  return out;
}
