// The painted heads that follow the warden (owner, 2026-11-18): "painting should turn their heads
// to follow the player. the eyes turning is not visible." Each painted face that turns is a small
// sculpted bust standing out of its canvas (the body stays flat paint on the canvas behind it),
// shallow (about half as deep as it is wide, some 0.15 m in a gallery portrait) so it reads as
// paint in relief and not as a doll, with matte paint-like shading baked into its colours: lit
// from the painting's own upper left, the jaw falling into shadow, the sockets and cheeks hollow.
// The turn rule is logic/headturn.js; this file only draws.
//
// bustGeometry(look, s): one head, neck and features as one vertex-coloured geometry, in metres,
// its origin the pivot at the root of the neck, its front -Z (the kit's convention), s its half
// width. look: { kind: 'lord' | 'lady' | 'wife' | 'warden', skin, hair, brow?, lip?, white?,
// fangs?, female? } (the sitters' tables in keepcast.js, the warden's colours for the easel).
//
// bustSet(items): every head of one wall or room as ONE draw call. The heads are merged into one
// geometry with a per-vertex head index; a small vertex-shader patch turns each about its own
// pivot by its own heading (a uniform per head), so a frame's update writes a few floats and
// allocates nothing. Heads may be hidden one by one (a wife who has stepped out of her canvas).
// The set casts no shadow (the depth pass would not know the turn). Its bounding sphere is set
// round the pivots, so the set is culled when none of its heads is in view.
//   items: [{ geo, at: Vector3 (pivot, in the set's parent space), yaw (the heading it rests at) }]
//          (the set takes the geometries: they are merged and disposed)
//   o: name, fill (0.06: a share of the paint's own colour added as light, so the shadow side is
//      never black; the easel's is 0.25, the wives' a little more than the walls'), roughness.
//   returns { mesh, count, turn(i, rad), show(i, on), turns(), shown(i) }
// Every set has BUST_SLOTS slots, so all sets share one shader program (compiled once).

import * as THREE from 'three';
import * as S from './sculpt.js';

const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const gauss = (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
const _c = new THREE.Color(); const _h = new THREE.Color(); const _v = new THREE.Vector3();

// Head units: half width 1, the face's middle at the origin, crown at +2, chin at -1.95 (then the
// whole is pressed to YS of that height: a long face, not an egg).
const EYE_Y = 0.55; const EYE_X = 0.42; const MOUTH_Y = -1.05; const NECK_TOP = -1.3; const ROOT = -2.4; // the neck a quarter shorter (art critic)
const IVORY = 0xe9dcc0; // every sitter's skin is warmed a tenth toward it (art critic: match the easel's)
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const YS = 0.84;
/** Where the neck's root and the eyes are, in half widths below and above the face's middle (for the canvases under the heads). */
export const BUST = Object.freeze({ root: -ROOT * YS, eyes: EYE_Y * YS });
const SEG_W = 28; const SEG_H = 22;

/** The face's front relief at (X, Y) in head units, as a share of the depth (forward is positive). */
function relief(X, Y) {
  const ridge = Math.exp(-((X / 0.15) ** 2));
  const t = clamp((0.45 - Y) / 1.0);
  const nose = ridge * (Y >= -0.55 ? (Y <= 0.45 ? 0.12 + 0.42 * t * t : 0.12 * Math.exp(-(((Y - 0.45) / 0.2) ** 2))) : 0.54 * Math.exp(-(((Y + 0.55) / 0.13) ** 2)));
  const brow = 0.14 * Math.exp(-(((Y - 0.86) / 0.16) ** 2)) * (1 - clamp((Math.abs(X) - 0.6) / 0.3));
  let sockets = 0; let hollows = 0; let bones = 0;
  for (const sx of [-1, 1]) {
    sockets += gauss(X, Y, sx * EYE_X, EYE_Y, 0.27, 0.22);
    hollows += gauss(X, Y, sx * 0.62, -0.38, 0.28, 0.45);
    bones += gauss(X, Y, sx * 0.62, 0.12, 0.24, 0.14);
  }
  const lips = 0.09 * gauss(X, Y, 0, MOUTH_Y, 0.32, 0.12);
  const chin = 0.12 * gauss(X, Y, 0, -1.7, 0.32, 0.22);
  return { z: nose + brow - 0.24 * sockets - 0.16 * hollows + 0.08 * bones + lips + chin, shade: 0.4 * sockets + 0.28 * hollows, ridge };
}

/** Is (X, Y, back) hair, for this look? back is how far round the head the point is (0 front, 1 back). */
function hairAt(kind, X, Y, back) {
  const ax = Math.abs(X);
  if (kind === 'lord') return Y > 1.12 + 0.18 * ax - 0.5 * back || (ax > 0.86 && Y > 0.35 && Y < 1.4) || (back > 0.55 && Y > -0.4);
  if (kind === 'warden') return back > 0.5 && Y > -0.2;
  // the ladies: parted in the middle, falling either side of the face, all of the back
  return Y > 1.02 + 0.22 * ax - 0.12 * (1 - ax) || ax > 0.8 || back > 0.4;
}

/** One sitter's head, neck and features as one geometry (see the header). o: depth (0.5), seed. */
export function bustGeometry(look = {}, s = 0.15, o = {}) {
  const D = o.depth ?? 0.5; // half depth, in head units (half width 1)
  const seed = o.seed ?? 1;
  const kind = look.kind || 'lady';
  const skin = new THREE.Color(look.skin ?? 0xcfc8b6).lerp(_h.set(IVORY), 0.1);
  const hair = new THREE.Color(look.hair ?? 0x0d0b0c);
  // hair never as light as the face: at most 60 percent of the skin's value, so a grey head of
  // hair reads as hair and not as a bald pate (art critic, the gallery lord)
  if (lum(hair) > 0.6 * lum(skin)) hair.multiplyScalar((0.6 * lum(skin)) / lum(hair));
  const hairline = hair.clone().multiplyScalar(0.55);
  const cap = kind === 'warden' ? new THREE.Color(look.cap ?? 0x24211f) : null;
  const parts = [];

  // ---- the head: a sphere pushed into a long narrow face, shallow behind ----
  const head = new THREE.SphereGeometry(1, SEG_W, SEG_H).rotateY(Math.PI / 2); // its seam behind, against the canvas
  head.deleteAttribute('uv'); head.deleteAttribute('normal');
  const p = head.attributes.position;
  const col = new Float32Array(p.count * 3);
  const jawK = kind === 'lord' ? 0.36 : kind === 'warden' ? 0.3 : 0.42;
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i); const uy = p.getY(i); const uz = p.getZ(i);
    const Y = uy * (uy > 0 ? 2.0 : 1.95);
    const narrow = uy < 0 ? 1 - jawK * (-uy) ** 1.6 : 1 - 0.06 * uy;
    const X = ux * narrow;
    const front = clamp(-uz * 1.6);
    const r = relief(X, Y);
    const n = 0.025 * S.noise(X * 3, Y * 3, uz * 3, seed); // the paint is not quite smooth
    const Z = uz * D * (uz < 0 ? 1 : 0.55) - (r.z * D * front) + n * D;
    p.setXYZ(i, X * (1 + n), Y, Z);
    // the paint: skin lit from the painting's upper left (the figure's right, +X), shadow under the jaw
    const back = clamp((uz + 0.2) / 1.0);
    if (cap && Y > 1.05 - 0.1 * back) _c.copy(cap);
    else if (hairAt(kind, X, Y, back)) _c.copy(hair).multiplyScalar(0.85 + 0.3 * clamp(0.5 + 0.5 * uy) + 0.1 * S.noise(X * 6, Y * 9, seed, 3));
    else if (!cap && hairAt(kind, X, Y + 0.13, back)) _c.copy(hairline).lerp(skin, 0.25); // a darker band along the hairline
    else {
      _c.copy(skin);
      // painted light, softly: the shadow side lifted, the terminator spread over the face
      let k = 0.86 + 0.12 * uy + 0.07 * ux - 0.8 * r.shade;
      if (Y < -1.2) k -= 0.12 * clamp((-1.2 - Y) / 0.7);
      if (Y < 0.4 && Y > -0.7) k -= 0.14 * r.ridge * clamp(-X / 0.14); // the nose's shadow, away from the light, fading in
      _c.multiplyScalar(clamp(k, 0.5, 1.02));
      if (Math.abs(Y - MOUTH_Y) < 0.12 && Math.abs(X) < 0.34 && front > 0.5) _c.lerp(_h.set(look.lip ?? 0x5a1a1e), 0.35);
    }
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  head.setAttribute('color', new THREE.BufferAttribute(col, 3));
  head.computeVertexNormals();
  parts.push(head);

  // where the front surface is at (x, y): the nearest front vertex of the head (for seating the features)
  const surface = (x, y) => {
    let best = Infinity; let z = -D;
    for (let i = 0; i < p.count; i++) {
      const pz = p.getZ(i); if (pz > 0) continue;
      const d = (p.getX(i) - x) ** 2 + (p.getY(i) - y) ** 2;
      if (d < best) { best = d; z = pz; }
    }
    return z;
  };

  // ---- the neck, down into the painted collar ----
  parts.push(S.skin([{ at: [0, ROOT, 0], r: [0.62, 0.55 * D * 1.1] }, { at: [0, (ROOT + NECK_TOP) / 2, -0.04], r: [0.52, 0.5 * D * 1.1] }, { at: [0, NECK_TOP + 0.3, 0], r: [0.5, 0.55 * D] }],
    { seed, sides: 10, detail: 2, budget: 120, noise: 0.03, mottle: 0.08, shade: 0.2, color: skin.clone().multiplyScalar(0.62), caps: ['open', 'open'] }));

  // ---- the eyes: whites, dark irises looking straight out (the head does the following), heavy lids ----
  const white = new THREE.Color(look.white ?? 0xe9e4d6).multiplyScalar(0.82);
  const lid = skin.clone().multiplyScalar(0.62);
  const browC = look.brow ?? look.hair ?? 0x0d0b0c;
  for (const sx of [-1, 1]) {
    const ex = sx * EYE_X; const ez = surface(ex, EYE_Y) + 0.06 * D;
    parts.push(S.tint(new THREE.SphereGeometry(0.19, 10, 8).scale(1, 0.62, 0.55).translate(ex, EYE_Y, ez), white, 0.05, seed));
    parts.push(S.tint(new THREE.CircleGeometry(0.085, 10).rotateY(Math.PI).translate(ex, EYE_Y - 0.01, ez - 0.19 * 0.55 - 0.004), look.iris ?? 0x0b0908, 0));
    parts.push(S.tint(new THREE.CircleGeometry(0.022, 6).rotateY(Math.PI).translate(ex + 0.03, EYE_Y + 0.025, ez - 0.19 * 0.55 - 0.008), 0xd8d2c4, 0));
    // the lid: the top of a slightly larger shell, down over the top of the eye
    parts.push(S.tint(new THREE.SphereGeometry(0.215, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1.05, 0.7, 0.62).translate(ex, EYE_Y + 0.02, ez + 0.005), lid, 0.08, seed + sx));
    // the brow, drawn down toward the nose
    const bz = surface(sx * 0.45, 0.86) - 0.02;
    parts.push(S.tint(new THREE.BoxGeometry(0.52, 0.075, 0.06).rotateZ(sx * 0.2).translate(sx * 0.47, 0.84, bz), browC, 0.1, seed));
    if (kind === 'lord' || kind === 'warden') parts.push(S.tint(new THREE.SphereGeometry(0.18, 7, 6).scale(0.45, 1.25, 0.9).translate(sx * 0.98, 0.2, 0.05), skin.clone().multiplyScalar(0.7), 0.1, seed)); // ears
  }
  // ---- the mouth: thin, level, a little wrong at one corner ----
  const mz = surface(0, MOUTH_Y) - 0.01;
  parts.push(S.tint(new THREE.BoxGeometry(0.62, 0.05, 0.05).translate(-0.04, MOUTH_Y, mz), look.lip ?? 0x5a1a1e, 0.05));
  parts.push(S.tint(new THREE.BoxGeometry(0.16, 0.045, 0.05).rotateZ(0.5).translate(0.32, MOUTH_Y + 0.04, mz + 0.01), look.lip ?? 0x5a1a1e, 0.05));
  if (look.fangs) for (const sx of [-1, 1]) parts.push(S.tint(new THREE.ConeGeometry(0.035, 0.16, 4).rotateX(Math.PI).translate(sx * 0.12, MOUTH_Y - 0.1, mz - 0.01), 0xefe8d4, 0));
  if (kind === 'lord' && !look.shaven) { // the long white moustache
    for (const sx of [-1, 1]) {
      parts.push(S.skin([{ at: [sx * 0.04, -0.86, surface(0.05, -0.86) - 0.03], r: 0.05 }, { at: [sx * 0.34, -0.95, surface(0.34, -0.95) - 0.03], r: 0.06 },
        { at: [sx * 0.5, -1.3, surface(0.5, -1.3) - 0.02], r: 0.045 }, { at: [sx * 0.55, -1.65, surface(0.55, -1.6)], r: 0.02 }],
      { seed: seed + sx, sides: 5, detail: 2, budget: 60, noise: 0.05, mottle: 0.1, color: look.moustache ?? 0x8f8b82, caps: ['round', 'round'] }));
    }
    // and a beard of its own: a darker grey cluster at the chin, apart from the neck
    for (let k = 0; k < 6; k++) {
      const bx = (k - 2.5) * 0.12; const by = -1.72 - 0.08 * (k % 2);
      parts.push(S.tint(new THREE.SphereGeometry(0.13, 7, 5).scale(1, 1.3, 0.8).translate(bx, by, surface(bx, -1.6) - 0.02), look.beard ?? 0x6e6a62, 0.2, seed + k));
    }
  }
  if (kind === 'warden') { // the scarf wound round the throat, its end hanging
    // thin and dull (art critic: the gold ring read as a mannequin's neck-stand)
    parts.push(S.tint(new THREE.TorusGeometry(0.62, 0.1, 5, 16).rotateX(Math.PI / 2).scale(1, 1, D * 1.5).translate(0, ROOT + 0.4, -0.02), look.scarf ?? 0x4d4130, 0.3, seed));
    parts.push(S.tint(new THREE.BoxGeometry(0.26, 0.55, 0.08).rotateZ(-0.15).translate(0.32, ROOT + 0.05, -D * 0.72), look.scarf ?? 0x4d4130, 0.3, seed + 1));
  }
  if (kind === 'warden') { // the cap's peak and the goggles pushed up on it, and his moustache or her hair at the sides
    parts.push(S.tint(new THREE.BoxGeometry(1.5, 0.1, 0.6).translate(0, 1.18, surface(0, 1.18) - 0.2), cap, 0.15, seed));
    for (const sx of [-1, 1]) parts.push(S.tint(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10).rotateX(Math.PI / 2).translate(sx * 0.3, 1.36, surface(sx * 0.3, 1.36) - 0.06), 0x6d7a80, 0.1, seed));
    parts.push(S.tint(new THREE.BoxGeometry(1.7, 0.1, 0.12).translate(0, 1.36, surface(0, 1.36) - 0.02), 0x2c2a28, 0.1, seed));
    if (look.female) {
      for (const sx of [-1, 1]) {
        parts.push(S.skin([{ at: [sx * 0.85, 1.05, -0.05], r: 0.24 }, { at: [sx * 1.0, 0.1, -0.02], r: 0.24 }, { at: [sx * 1.0, -1.0, 0.02], r: 0.2 }, { at: [sx * 0.95, -1.9, 0.05], r: 0.08 }],
          { seed: seed + sx, sides: 6, detail: 2, budget: 90, noise: 0.1, mottle: 0.2, color: hair, color2: hair.clone().multiplyScalar(0.7), caps: ['round', 'round'] }));
      }
    } else {
      parts.push(S.tint(new THREE.BoxGeometry(0.5, 0.09, 0.08).translate(0, -0.88, surface(0, -0.88) - 0.04), look.moustache ?? 0x3a2a20, 0.1, seed));
    }
  }
  if (kind === 'lady' || kind === 'wife') { // long hair either side of the face, down past the jaw into the paint
    for (const sx of [-1, 1]) {
      parts.push(S.skin([{ at: [sx * 0.7, 1.5, -0.1], r: [0.3, 0.32 * D * 2] }, { at: [sx * 1.0, 0.4, 0], r: [0.28, 0.3 * D * 2] }, { at: [sx * 1.06, -0.9, 0.05], r: [0.26, 0.26 * D * 2] },
        { at: [sx * 1.1, -2.0, 0.12], r: [0.24, 0.2 * D * 2] }, { at: [sx * 1.15, -2.6, 0.2], r: 0.06 }],
      { seed: seed + 7 + sx, sides: 7, detail: 2, budget: 120, noise: 0.12, rough: 0.05, mottle: 0.25, color: hair, color2: hair.clone().multiplyScalar(0.6), caps: ['round', 'round'] }));
    }
  }

  const g = S.merge(parts);
  for (const q of parts) q.dispose();
  // pressed to a face's length, to metres, the pivot at the root of the neck
  g.scale(1, YS, 1).translate(0, -ROOT * YS, 0).scale(s, s, s);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.userData.top = (2.0 - ROOT) * YS * s; // pivot to crown
  g.userData.centre = -ROOT * YS * s; // pivot to the face's middle
  return g;
}

/**
 * Every set has the same BUST_SLOTS heads' worth of uniforms (spare slots hidden), so every set
 * in the game shares ONE shader program: it is compiled once, not once per wall (tech critic).
 */
export const BUST_SLOTS = 8;

// The vertex patch: each vertex turns about its own head's pivot by that head's heading
// (a heading h faces (-sin h, -cos h): the kit's front, -Z, turned by h about +Y).
const TURN_GLSL = `
attribute float aBust;
uniform vec4 uBust[${BUST_SLOTS}];
uniform float uShow[${BUST_SLOTS}];
vec3 bustTurn(vec3 v, float h) { float c = cos(h); float s = sin(h); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }`;

/** The head index a vertex carries, for heads of these vertex counts in order: 0 .. n - 1. */
export function bustIndex(counts) {
  let total = 0;
  for (const c of counts) total += c;
  const idx = new Float32Array(total);
  let off = 0;
  counts.forEach((c, i) => { idx.fill(i, off, off + c); off += c; });
  return idx;
}

/**
 * The per-head state the shader reads, as flat arrays (three uploads a Float32Array to a uniform
 * array as it is): pack[4i .. 4i + 3] = pivot x, y, z and heading; show[i] = 1 shown, 0 hidden.
 * items: [{ at: { x, y, z }, yaw }], at most BUST_SLOTS. Spare slots are hidden.
 */
export function bustState(items) {
  if (items.length > BUST_SLOTS) throw new Error(`busts: ${items.length} heads in one set, at most ${BUST_SLOTS}`);
  const pack = new Float32Array(BUST_SLOTS * 4);
  const show = new Float32Array(BUST_SLOTS);
  const base = new Float32Array(BUST_SLOTS);
  const turned = new Float32Array(BUST_SLOTS);
  items.forEach((it, i) => { pack.set([it.at.x, it.at.y, it.at.z, it.yaw], i * 4); base[i] = it.yaw; show[i] = 1; });
  const n = items.length;
  return {
    pack, show, count: n,
    turn(i, rad) { if (i < 0 || i >= n) return; turned[i] = rad; pack[i * 4 + 3] = base[i] + rad; },
    setShown(i, on) { if (i >= 0 && i < n) show[i] = on ? 1 : 0; },
    // part way: a head going into the ghost that comes over it (keepcast.js, the wife's emergence)
    setScale(i, k) { if (i >= 0 && i < n) show[i] = Math.max(0, Math.min(1, k)); },
    shown(i) { return show[i] === 1; },
    turns() { return Array.from(turned.subarray(0, n)); },
  };
}

/** Every head of one wall or room as one draw call (see the header). */
export function bustSet(items, o = {}) {
  const state = bustState(items);
  const geos = items.map((it) => it.geo);
  const merged = S.merge(geos);
  // S.merge keeps position, normal and colour in order: the head index follows the same order
  merged.setAttribute('aBust', new THREE.BufferAttribute(bustIndex(geos.map((g) => g.attributes.position.count)), 1));
  // culled as a whole: a sphere round every pivot, as big as the biggest head
  let rad = 0;
  const centre = new THREE.Vector3();
  for (const it of items) { centre.add(it.at); rad = Math.max(rad, it.geo.boundingSphere ? it.geo.boundingSphere.radius + it.geo.boundingSphere.center.length() : 1); }
  if (items.length) centre.multiplyScalar(1 / items.length);
  let spread = 0;
  for (const it of items) spread = Math.max(spread, _v.copy(it.at).sub(centre).length());
  merged.boundingSphere = new THREE.Sphere(centre.clone(), spread + rad);
  for (const g of geos) g.dispose(); // merged: the set owns its one geometry

  const uBust = { value: state.pack };
  const uShow = { value: state.show };
  const uFill = { value: o.fill ?? 0.06 }; // a little of the paint's own colour as light: the shadow side is never black
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBust = uBust;
    sh.uniforms.uShow = uShow;
    sh.uniforms.uFill = uFill;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFill;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * uFill;');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${TURN_GLSL}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = bustTurn(objectNormal, uBust[int(aBust + 0.5)].w);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  { int bi = int(aBust + 0.5); vec4 B = uBust[bi]; transformed = bustTurn(transformed, B.w) * uShow[bi] + B.xyz; }`);
  };
  mat.customProgramCacheKey = () => 'bust-turn'; // one program for every set (BUST_SLOTS)
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = o.name || 'busts';
  return {
    mesh, count: items.length,
    /** Sets head i's turn from its resting heading (radians). */
    turn: state.turn,
    /** Hides head i (scaled to nothing at its pivot) or shows it again. */
    show: state.setShown,
    /** Scales head i toward its pivot, 0 (gone) to 1 (whole). */
    scale: state.setScale,
    /** The turns as last set (radians), a copy: for the smoke harness and the tests. */
    turns: state.turns,
    shown: state.shown,
  };
}

// ---- warming the program (the owner, 2026-11-18: "compile heads when starting the first level
// with a head") ------------------------------------------------------------------------------------
// One small head, never drawn and never freed, kept for the session: compiling it against a room's
// scene (its lights, its fog, the renderer's shadow state) builds the one program every bust set
// shares, when a level with heads starts and before its first frame, so the first face that comes
// into view never stalls a frame building it. Its material holds the program, so leaving a room
// (world.free) cannot release it. Returns { mesh, done } (done resolves true once built, false if
// the renderer could not).
let warmHead = null;
export function warmBusts(renderer, camera, scene) {
  if (!warmHead) {
    const geo = S.tint(new THREE.BoxGeometry(0.01, 0.01, 0.01), 0xffffff, 0);
    warmHead = bustSet([{ geo, at: new THREE.Vector3(0, -1000, 0), yaw: 0 }], { name: 'warm head' });
    warmHead.show(0, false);
  }
  const mesh = warmHead.mesh;
  let done;
  try {
    if (!renderer) done = Promise.resolve(false);
    else if (typeof renderer.compileAsync === 'function') done = Promise.resolve(renderer.compileAsync(mesh, camera, scene)).then(() => true, () => false);
    else { renderer.compile(mesh, camera, scene); done = Promise.resolve(true); }
  } catch { done = Promise.resolve(false); } // built when first drawn, as before
  return { mesh, done };
}
