// Falling pieces that stone stops (the owner, 2026-11-18: "when an armored guard dies sometimes
// their pike goes thru a wall. it should not be able to pass thru stone"). A suit of armour comes
// apart where it falls (keepcast.js): its cuirass, helm, claw, pike and twelve limb plates each
// fall from where they stood toward where the design lays them (SUIT_REST, the heap). Every piece
// is a rod (two ends a and b and a radius r; a == b is a ball), and the 3.3 m pike is tested along
// its whole length, not at its middle: the rod is sampled every few centimetres and each sample is
// a ball against the boxes.
//
// Two rules keep every piece out of stone:
//   clearRest  the place a piece is laid is first made clear of the boxes: it is turned about the
//              suit's middle (in yaw, the smallest turn first) and slid out along the faces it
//              touches, so a pike that would lie through a wall lies along it instead.
//   fallTrack  the fall itself is integrated (gravity, position-based: predict, push out of the
//              boxes and the floor, keep the rod's length) at 240 steps a second, so no piece can
//              step through even a door leaf; a piece that meets a face is pushed back along it,
//              its speed into the face reflected and damped, and slowed along it; it falls until
//              it is still, and lies there.
// Boxes are the live collision list the warden walks against (keep.js keepBoxes), less the ones
// nobody sees (the board's guide rails, the bats' trigger), each standing on the piece's floor
// (the castle's plan is flat: an upstairs wall's box starts at 0 too). Pure: no DOM, no
// Math.random; the view (keepcast.js) only plays back the tracks this returns.

/** The pieces of a suit as rods in their own mesh's frame (keepcast.js builds the meshes about these). */
export const SUIT_RODS = Object.freeze({
  torso: Object.freeze({ a: [0, 1.2, 0], b: [0, 2.15, 0], r: 0.4 }), // the cuirass, waist to collar
  helm: Object.freeze({ a: [0, 0.05, 0], b: [0, 0.5, 0], r: 0.27 }),
  claw: Object.freeze({ a: [0, 0, 0], b: [0, 0, -0.3], r: 0.1 }),
  pike: Object.freeze({ a: [0, 0, 0], b: [0, 3.3, 0], r: 0.08 }), // butt to the partisan's point
});

/** Where each piece lies once the suit has come apart, in the suit's frame: p, and Euler XYZ e (radians), as three.js reads them. */
export const SUIT_REST = Object.freeze({
  torso: Object.freeze({ p: [0.1, 0.34, -1.05], e: [Math.PI / 2 - 0.1, 0.4, 0.2] }),
  helm: Object.freeze({ p: [-0.55, 0.19, -1.0], e: [1.9, 0.6, 0.5] }),
  claw: Object.freeze({ p: [-0.7, 0.05, 0.1], e: [0.1, 2, 0] }),
  pike: Object.freeze({ p: [0.75, 0.04, 0.5], e: [Math.PI / 2 + 0.02, 0.5, 0] }),
});

/** Boxes no falling piece meets: the board's guide rails (invisible, 10 cm) and the road's bat trigger. */
const UNSEEN = new Set(['board', 'swarm', 'giant']);

export const G = 9.8;
const STEP = 1 / 240;
const ITER = 3;
const BOUNCE = 0.25; // of the speed into a face
const SLIDE = 0.06; // of the speed along a face lost each step in contact
const STILL = 0.04; // m/s: slower than this ...
const STILL_FOR = 0.25; // ... for this long, and it lies still
const SAMPLE = 0.08; // metres between a rod's tested balls at most
const WALL_SLIDE = 0.005;
const GUIDE_FROM = 0.35; const GUIDE_RAMP = 0.5; const GUIDE_W = 9; // seconds; the spring's rate (1/s)

// ---- small vector helpers (arrays [x, y, z]) ---------------------------------------------------

const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const cp = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };

/** v rotated by Euler XYZ e (three.js: R = Rx Ry Rz). Writes out. */
export function eulerApply(e, v, out = v3()) {
  let [x, y, z] = v;
  const cz = Math.cos(e[2]); const sz = Math.sin(e[2]);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  const cy = Math.cos(e[1]); const sy = Math.sin(e[1]);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cx = Math.cos(e[0]); const sx = Math.sin(e[0]);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** A suit's frame: where it stands (x, y, z) and its heading f (three.js rotation.y). */
export function toWorld(fr, p, out = v3()) {
  const c = Math.cos(fr.f); const s = Math.sin(fr.f);
  const x = fr.x + p[0] * c + p[2] * s; const z = fr.z - p[0] * s + p[2] * c;
  out[0] = x; out[1] = fr.y + p[1]; out[2] = z;
  return out;
}
export function toLocal(fr, p, out = v3()) {
  const c = Math.cos(fr.f); const s = Math.sin(fr.f);
  const dx = p[0] - fr.x; const dz = p[2] - fr.z;
  out[0] = dx * c - dz * s; out[1] = p[1] - fr.y; out[2] = dx * s + dz * c;
  return out;
}

/** The rest pose's ends for a named piece, in the suit's frame. */
export function restEnds(name) {
  const rod = SUIT_RODS[name]; const rest = SUIT_REST[name];
  const a = eulerApply(rest.e, rod.a); const b = eulerApply(rest.e, rod.b);
  for (let i = 0; i < 3; i++) { a[i] += rest.p[i]; b[i] += rest.p[i]; }
  return { a, b };
}

/** The boxes a falling piece meets on a floor at height floor: the seen ones, each standing on that floor. */
export function stoneFor(boxes, floor = 0, near = null, reach = 6) {
  const out = [];
  for (const b of boxes || []) {
    if (!b || UNSEEN.has(b.kind)) continue;
    if (near && (b.maxX < near.x - reach || b.minX > near.x + reach || b.maxZ < near.z - reach || b.minZ > near.z + reach)) continue;
    const minY = floor + (Number.isFinite(b.minY) ? b.minY : 0);
    const maxY = floor + (Number.isFinite(b.maxY) ? b.maxY : 6);
    out.push({ minX: b.minX, maxX: b.maxX, minY, maxY, minZ: b.minZ, maxZ: b.maxZ });
  }
  return out;
}

const _n = v3();
/**
 * A ball (s, r) against a box: the depth it stands in (0 if clear) and the way out in _n. A centre
 * inside the box leaves by the face toward ref (where it was, or the suit's middle), else the shallowest.
 * Never down through a floor: a box's underside is not a way out.
 */
function ballBox(s, r, b, ref) {
  const cx = Math.max(b.minX, Math.min(s[0], b.maxX));
  const cy = Math.max(b.minY, Math.min(s[1], b.maxY));
  const cz = Math.max(b.minZ, Math.min(s[2], b.maxZ));
  const dx = s[0] - cx; const dy = s[1] - cy; const dz = s[2] - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-14) {
    const d = Math.sqrt(d2);
    _n[0] = dx / d; _n[1] = dy / d; _n[2] = dz / d;
    return r - d;
  }
  const faces = [
    [s[0] - b.minX + r, -1, 0, 0, ref && ref[0] < b.minX],
    [b.maxX - s[0] + r, 1, 0, 0, ref && ref[0] > b.maxX],
    [s[2] - b.minZ + r, 0, 0, -1, ref && ref[2] < b.minZ],
    [b.maxZ - s[2] + r, 0, 0, 1, ref && ref[2] > b.maxZ],
    [b.maxY - s[1] + r, 0, 1, 0, ref && ref[1] > b.maxY],
  ];
  let best = null;
  for (const fc of faces) if (fc[4] && (!best || fc[0] < best[0])) best = fc;
  if (!best) for (const fc of faces) if (!best || fc[0] < best[0]) best = fc;
  _n[0] = best[1]; _n[1] = best[2]; _n[2] = best[3];
  return best[0];
}

function samplesOf(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return Math.max(1, Math.ceil(len / SAMPLE));
}

const _s = v3();
/** How deep the rod (a, b, r) stands in the boxes at most (0: clear). */
export function rodDepth(a, b, r, boxes) {
  const n = samplesOf(a, b);
  let worst = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    for (let i = 0; i < 3; i++) _s[i] = a[i] + (b[i] - a[i]) * t;
    for (const bx of boxes) worst = Math.max(worst, ballBox(_s, r, bx, null));
  }
  return worst;
}

/** The deepest a bare segment (no radius) runs into any box: Liang-Barsky clip, then how far the clipped part is inside. */
export function segmentInside(a, b, boxes) {
  let worst = 0;
  for (const bx of boxes) {
    let t0 = 0; let t1 = 1;
    const lo = [bx.minX, bx.minY, bx.minZ]; const hi = [bx.maxX, bx.maxY, bx.maxZ];
    let ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      const d = b[i] - a[i];
      if (Math.abs(d) < 1e-12) { if (a[i] < lo[i] || a[i] > hi[i]) ok = false; continue; }
      let u0 = (lo[i] - a[i]) / d; let u1 = (hi[i] - a[i]) / d;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) ok = false;
    }
    if (!ok) continue;
    // the clipped part's deepest point: the most any point of it is from the box's surface
    for (const t of [t0, (t0 + t1) / 2, t1]) {
      const p = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t);
      const depth = Math.min(p[0] - bx.minX, bx.maxX - p[0], p[1] - bx.minY, bx.maxY - p[1], p[2] - bx.minZ, bx.maxZ - p[2]);
      worst = Math.max(worst, depth);
    }
  }
  return worst;
}

/** Pushes the rod (a, b, r) rigidly out of the boxes (a few passes); returns how far it moved. */
function pushRodOut(a, b, r, boxes, ref) {
  let moved = 0;
  for (let pass = 0; pass < 8; pass++) {
    const n = samplesOf(a, b);
    let any = false;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      for (let i = 0; i < 3; i++) _s[i] = a[i] + (b[i] - a[i]) * t;
      for (const bx of boxes) {
        const d = ballBox(_s, r, bx, ref);
        if (d <= 1e-6) continue;
        any = true;
        const m = d + 1e-4;
        for (let i = 0; i < 3; i++) { a[i] += _n[i] * m; b[i] += _n[i] * m; _s[i] += _n[i] * m; }
        moved += m;
      }
    }
    if (!any) break;
  }
  return moved;
}

/**
 * A start pose standing in stone, made clear with the least change: the rod swung up toward
 * upright about its end nearer the suit's middle (home), then, if that end is in stone too, the
 * upright rod drawn in toward home; the rigid push-out last. Mutates a and b.
 */
function freeStart(a, b, r, boxes, home, floor) {
  onFloor(a, b, r, floor);
  if (rodDepth(a, b, r, boxes) <= 0) return;
  const da = (a[0] - home[0]) ** 2 + (a[2] - home[2]) ** 2; const db = (b[0] - home[0]) ** 2 + (b[2] - home[2]) ** 2;
  const [p, q] = da <= db ? [a, b] : [b, a];
  const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const d = [(q[0] - p[0]) / (L || 1), (q[1] - p[1]) / (L || 1), (q[2] - p[2]) / (L || 1)];
  const tryAt = (o, k) => {
    const u = [d[0] * (1 - k), d[1] * (1 - k) + k, d[2] * (1 - k)];
    const n = Math.hypot(...u) || 1;
    const p2 = [o[0], Math.max(o[1], floor + r), o[2]];
    const q2 = [p2[0] + (u[0] / n) * L, p2[1] + (u[1] / n) * L, p2[2] + (u[2] / n) * L];
    if (rodDepth(p2, q2, r, boxes) > 0) return false;
    cp(p, p2); cp(q, q2);
    return true;
  };
  for (let k = 0.1; k <= 1.0001; k += 0.1) if (tryAt(p, k)) return;
  for (let m = 0.05; m <= 1.5; m += 0.05) {
    const o = [p[0] + (home[0] - p[0]) * Math.min(1, m / Math.max(1e-6, Math.hypot(home[0] - p[0], home[2] - p[2]))), p[1], p[2] + (home[2] - p[2]) * Math.min(1, m / Math.max(1e-6, Math.hypot(home[0] - p[0], home[2] - p[2])))];
    if (tryAt(o, 1)) return;
  }
  pushRodOut(a, b, r, boxes, home);
  onFloor(a, b, r, floor);
}

/** The rod's lowest point down to the floor (a ball's depth below it is its own radius). */
function onFloor(a, b, r, floor) {
  const low = Math.min(a[1], b[1]) - r;
  if (low < floor) { a[1] += floor - low; b[1] += floor - low; }
}

/**
 * Where a piece may lie: rest ({ a, b } world), turned about pivot ({ x, z }) and slid out of the
 * boxes, the smallest change first (a turn of one radian costs as a slide of a metre). The rod
 * stays on the floor. Returns { a, b, turn, slide, depth } (depth 0 when clear).
 */
export function clearRest(rest, r, boxes, pivot, floor = 0) {
  let best = null;
  const tryTurn = (ang) => {
    const c = Math.cos(ang); const s = Math.sin(ang);
    const turn = (p) => {
      const dx = p[0] - pivot.x; const dz = p[2] - pivot.z;
      return [pivot.x + dx * c + dz * s, p[1], pivot.z - dx * s + dz * c];
    };
    const a = turn(rest.a); const b = turn(rest.b);
    onFloor(a, b, r, floor);
    const ref = [pivot.x, floor + 1, pivot.z];
    const slide = pushRodOut(a, b, r, boxes, ref);
    onFloor(a, b, r, floor);
    const depth = rodDepth(a, b, r, boxes);
    const cost = Math.abs(ang) + slide + depth * 100;
    if (!best || cost < best.cost) best = { a, b, turn: ang, slide, depth, cost };
  };
  tryTurn(0);
  for (let k = 1; k <= 18 && !(best.depth < 1e-4 && best.cost <= (k * Math.PI) / 18); k++) {
    tryTurn((k * Math.PI) / 18);
    tryTurn((-k * Math.PI) / 18);
  }
  return { a: best.a, b: best.b, turn: best.turn, slide: best.slide, depth: best.depth };
}

/**
 * A piece's fall: from start ({ a, b } world, the pose it stood in) toward rest ({ a, b } world,
 * clear: clearRest), thrown so each end would land on its rest spot, then integrated against the
 * boxes and the floor until it is still. opts: { floor (0), pivot ({ x, z }: the suit's middle, the
 * side a piece stuck in stone is put out on), rate (frames a second kept, 60), maxT (seconds, 5) }.
 * Returns { r, rate, n, data: Float64Array(n * 6) (a then b each frame), rested }.
 */
export function fallTrack(start, rest, r, boxes, opts = {}) {
  const floor = opts.floor || 0;
  const rate = opts.rate || 60;
  const maxT = opts.maxT || 5;
  const pivot = opts.pivot || { x: (start.a[0] + start.b[0]) / 2, z: (start.a[2] + start.b[2]) / 2 };
  const home = [pivot.x, floor + 1, pivot.z];
  const P = [cp(v3(), start.a), cp(v3(), start.b)];
  const L = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]);
  // a piece already in stone as it falls (a thrust into a jamb or a leaf) is first swung up clear
  freeStart(P[0], P[1], r, boxes, home, floor);
  const V = [0, 1].map((e) => {
    const p = P[e]; const q = e ? rest.b : rest.a;
    const T = Math.min(0.8, Math.max(0.25, Math.sqrt((2 * Math.max(0.05, p[1] - q[1])) / G)));
    return [(q[0] - p[0]) / T, (q[1] - p[1]) / T + (G * T) / 2, (q[2] - p[2]) / T];
  });
  const Q = [v3(), v3()]; const pre = [v3(), v3()];
  const frames = [];
  const keep = () => frames.push(P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2]);
  keep();
  const every = Math.round(1 / (rate * STEP));
  let still = 0; let rested = false;
  const steps = Math.ceil(maxT / STEP);
  const contacts = [];
  let aim = null;
  for (let st = 1; st <= steps; st++) {
    for (let e = 0; e < 2; e++) {
      V[e][1] -= G * STEP;
      // once it has had its fall, each end is drawn (a damped spring, coming on over half a second)
      // to the clear place it is laid: a pike that came down across a corridor turns to lie along it
      const pull = Math.min(1, Math.max(0, (st * STEP - GUIDE_FROM) / GUIDE_RAMP));
      if (pull > 0) {
        if (!aim) { // end for end, whichever way round it came down nearer
          const d = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]);
          aim = d(P[0], rest.a) + d(P[1], rest.b) <= d(P[0], rest.b) + d(P[1], rest.a) ? [rest.a, rest.b] : [rest.b, rest.a];
        }
        const q = aim[e];
        for (let i = 0; i < 3; i++) V[e][i] += (GUIDE_W * GUIDE_W * (q[i] - P[e][i]) - 2 * GUIDE_W * V[e][i]) * pull * STEP;
      }
      for (let i = 0; i < 3; i++) { Q[e][i] = P[e][i] + V[e][i] * STEP; pre[e][i] = V[e][i]; }
    }
    contacts.length = 0;
    for (let it = 0; it < ITER; it++) {
      // the rod keeps its length
      if (L > 1e-6) {
        const dx = Q[1][0] - Q[0][0]; const dy = Q[1][1] - Q[0][1]; const dz = Q[1][2] - Q[0][2];
        const len = Math.hypot(dx, dy, dz) || 1e-9;
        const k = (len - L) / len / 2;
        Q[0][0] += dx * k; Q[0][1] += dy * k; Q[0][2] += dz * k;
        Q[1][0] -= dx * k; Q[1][1] -= dy * k; Q[1][2] -= dz * k;
      } else { cp(Q[1], Q[0]); }
      // the floor
      for (let e = 0; e < 2; e++) if (Q[e][1] < floor + r) { Q[e][1] = floor + r; contacts.push([e, 0, 1, 0]); }
      // the stone: every sample of the rod, each end taking its share of the push
      const n = L > 1e-6 ? samplesOf(Q[0], Q[1]) : 0;
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n : 0;
        for (let i = 0; i < 3; i++) _s[i] = Q[0][i] + (Q[1][i] - Q[0][i]) * t;
        const was = [0, 1, 2].map((i) => P[0][i] + (P[1][i] - P[0][i]) * t);
        for (const bx of boxes) {
          const d = ballBox(_s, r, bx, was);
          if (d <= 0) continue;
          const wa = 1 - t; const wb = t; const den = wa * wa + wb * wb;
          for (let i = 0; i < 3; i++) {
            Q[0][i] += (_n[i] * d * wa) / den;
            Q[1][i] += (_n[i] * d * wb) / den;
            _s[i] += _n[i] * d;
          }
          if (L <= 1e-6) cp(Q[1], Q[0]);
          contacts.push([t < 0.5 ? 0 : 1, _n[0], _n[1], _n[2]]);
          if (t > 0 && t < 1) contacts.push([t < 0.5 ? 1 : 0, _n[0], _n[1], _n[2]]);
        }
      }
    }
    let fast = 0;
    for (let e = 0; e < 2; e++) {
      for (let i = 0; i < 3; i++) { V[e][i] = (Q[e][i] - P[e][i]) / STEP; P[e][i] = Q[e][i]; }
      fast = Math.max(fast, Math.hypot(V[e][0], V[e][1], V[e][2])); // how fast it really moved (a jammed piece pressing on a jamb is still)
    }
    // at a face: what drove into it comes back a little (reflected, damped); along it, it slows
    for (const [e, nx, ny, nz] of contacts) {
      const into = pre[e][0] * nx + pre[e][1] * ny + pre[e][2] * nz;
      const vn = V[e][0] * nx + V[e][1] * ny + V[e][2] * nz;
      const tx = V[e][0] - vn * nx; const ty = V[e][1] - vn * ny; const tz = V[e][2] - vn * nz;
      const back = into < -0.6 ? -into * BOUNCE : Math.max(0, vn);
      const slow = ny > 0.5 ? SLIDE : WALL_SLIDE; // a floor or a top grips; a wall's face lets it slide down
      V[e][0] = tx * (1 - slow) + back * nx; V[e][1] = ty * (1 - slow) + back * ny; V[e][2] = tz * (1 - slow) + back * nz;
    }
    if (L <= 1e-6) cp(V[1], V[0]);
    if (st % every === 0) keep();
    still = fast < STILL ? still + STEP : 0;
    if (still >= STILL_FOR) { rested = true; if (st % every) keep(); break; }
  }
  return { r, rate, n: frames.length / 6, data: Float64Array.from(frames), rested };
}

/** A track's ends at time t (seconds from its start; held at its last frame after). Writes outA, outB ([x, y, z]). */
export function trackAt(track, t, outA, outB) {
  const f = Math.max(0, t * track.rate);
  const i = Math.min(track.n - 1, Math.floor(f));
  const j = Math.min(track.n - 1, i + 1);
  const k = Math.min(1, f - i);
  const d = track.data;
  for (let c = 0; c < 3; c++) {
    outA[c] = d[i * 6 + c] + (d[j * 6 + c] - d[i * 6 + c]) * k;
    outB[c] = d[i * 6 + 3 + c] + (d[j * 6 + 3 + c] - d[i * 6 + 3 + c]) * k;
  }
  return track.n / track.rate; // how long the track runs
}

/** The last frame's ends. */
export function trackEnd(track) {
  const d = track.data; const o = (track.n - 1) * 6;
  return { a: [d[o], d[o + 1], d[o + 2]], b: [d[o + 3], d[o + 4], d[o + 5]] };
}

/**
 * A suit comes apart (keepcast.js startFall). frame: { x, y, z, f } where it stands and faces;
 * bodies: [{ start: { a, b }, rest: { a, b }, r }] in the suit's frame (the pieces' poses as they
 * stood and where the design lays them); boxes: the live collision list. Each piece's resting
 * place is made clear (clearRest) and its fall integrated (fallTrack), in the world; the tracks
 * come back in the suit's frame ({ r, rate, n, data, rested } each, data local), so the view plays
 * them under the suit's own group.
 */
export function planFall(frame, bodies, boxes) {
  const stone = stoneFor(boxes, frame.y, frame, 7);
  const pivot = { x: frame.x, z: frame.z };
  return bodies.map((bd) => {
    const s = { a: toWorld(frame, bd.start.a), b: toWorld(frame, bd.start.b) };
    const q = { a: toWorld(frame, bd.rest.a), b: toWorld(frame, bd.rest.b) };
    const rest = clearRest(q, bd.r, stone, pivot, frame.y);
    const tr = fallTrack(s, rest, bd.r, stone, { floor: frame.y, pivot });
    const w = v3(); const l = v3();
    for (let i = 0; i < tr.n * 2; i++) {
      w[0] = tr.data[i * 3]; w[1] = tr.data[i * 3 + 1]; w[2] = tr.data[i * 3 + 2];
      toLocal(frame, w, l);
      tr.data[i * 3] = l[0]; tr.data[i * 3 + 1] = l[1]; tr.data[i * 3 + 2] = l[2];
    }
    return tr;
  });
}

/**
 * The heap the twelve limb plates fall into (keepcast.js), from a seeded rand (0..1): ends a and b
 * in the suit's frame and each plate's wait (fall-clock seconds) before it drops.
 */
export function heapLayout(rand) {
  const A = []; const B = []; const W = [];
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2; const r = 0.25 + rand() * 0.75; const d = rand() * Math.PI * 2; const len = 0.22 + 0.2 * rand();
    const cx = Math.cos(a) * r; const cz = Math.sin(a) * r - 0.2;
    A.push([cx - Math.cos(d) * len, 0.07 + 0.1 * rand(), cz - Math.sin(d) * len]);
    B.push([cx + Math.cos(d) * len, 0.07, cz + Math.sin(d) * len]);
    W.push(rand() * 0.35);
  }
  return { A, B, W };
}
