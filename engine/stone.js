// The stone method for cut and carved stone, the castle's answer to the cave's rock skin. Owns:
// the canvas maps (coursed ashlar with mortar joints, drafted margins and chisel marks; the same
// stone run down; flagstones; veined marble), the materials that lay them by world position with
// a bump map (so every wall of any size shares one coursing and nothing stretches), and the cut
// shapes: walls with arched openings, carved surrounds, string courses, pointed vaults with ribs,
// columns, battlements, a fireplace and fallen rubble. Everything is geometry with vertex colour,
// made to be merged, so a whole zone's stone is one or two draw calls.
//
// Conventions: metres, Y up. "Wall space" is x along the wall, y up, z out of its face.
// Deterministic for a seed. No clocks.

import * as THREE from 'three';
import { rng, noise, merge } from './sculpt.js';

export const STONE = {
  ashlar: 0x6e7378, joint: 0x3c4046, night: 0x0e1420, moon: 0xc9d3e0, fire: 0xff8a3c,
  red: 0x7a0f14, gilt: 0x9c7a3c, marbleDark: 0x17181c, marbleLight: 0xdadde0, earth: 0x2b2019,
  ember: 0xff2a1a, dawn: 0xf2c14e,
};

const TILE = 4; // metres one map covers, both ways
const PX = 1024; // pixels across a wall or floor map
const clamp = (k, a = 0, b = 1) => Math.max(a, Math.min(b, k));
const _c = new THREE.Color();

// ---- canvas maps ------------------------------------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function texture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Draws fn at every wrapped copy of a box, so a map tiles across its edges.
function wrapped(size, x, y, w, h, fn) {
  for (const ox of [0, -size, size]) {
    for (const oy of [0, -size, size]) {
      if (x + ox + w < 0 || x + ox > size || y + oy + h < 0 || y + oy > size) continue;
      fn(x + ox, y + oy);
    }
  }
}

// Per-pixel grain: the colour map is mottled, the height map pitted. Tiles by construction.
function grain(g, size, amount, seed, pits = 0) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  const rand = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    let k = 1 + amount * (rand() + rand() - 1);
    if (pits && rand() < pits) k *= 0.72;
    d[i] = clamp(d[i] * k, 0, 255); d[i + 1] = clamp(d[i + 1] * k, 0, 255); d[i + 2] = clamp(d[i + 2] * k, 0, 255);
  }
  g.putImageData(img, 0, 0);
}

// Soft blots: stains on the colour map, hollows and swells on the height map.
function blots(g, size, rand, n, rMin, rMax, colors) {
  for (let i = 0; i < n; i++) {
    const r = rMin + rand() * (rMax - rMin);
    const x = rand() * size; const y = rand() * size;
    const col = colors[Math.floor(rand() * colors.length)];
    wrapped(size, x - r, y - r, r * 2, r * 2, (px, py) => {
      const grad = g.createRadialGradient(px + r, py + r, 0, px + r, py + r, r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      g.fillStyle = grad;
      g.fillRect(px, py, r * 2, r * 2);
    });
  }
}

const rgb = (hex, k = 1, a = 1) => {
  _c.setHex(hex);
  const f = (q) => Math.round(clamp(q * k) * 255);
  return `rgba(${f(_c.r)},${f(_c.g)},${f(_c.b)},${a})`;
};
const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

// The blocks of a map: rows of given heights, each cut into stones of uneven length with the
// joints of one course never over the joints of the next.
function courses(rand, size, rows, minW, maxW) {
  const out = [];
  let y = 0;
  let lastCuts = [];
  for (const h of rows) {
    let cuts;
    for (let tries = 0; tries < 30; tries++) {
      cuts = [];
      let x = rand() * maxW;
      const start = x;
      while (x < start + size - minW * 0.6) {
        cuts.push(x);
        x += minW + rand() * (maxW - minW);
      }
      const clash = cuts.some((c) => lastCuts.some((l) => {
        const dd = Math.abs(((c - l) % size + size * 1.5) % size - size / 2);
        return dd < minW * 0.22;
      }));
      if (!clash) break;
    }
    for (let i = 0; i < cuts.length; i++) {
      const x0 = cuts[i];
      const x1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + size;
      out.push({ x: x0 % size, y, w: x1 - x0, h });
    }
    lastCuts = cuts;
    y += h;
  }
  return out;
}

/**
 * ashlarMaps(opts) -> { map, bump }. Coursed cut stone, 4 m square, tiling.
 *   opts: seed (1); worn (0 to 1): fallen mortar, cracks, spalled faces and damp stains;
 *         rows (10) courses in the 4 m; tone (STONE.ashlar); joint (STONE.joint).
 */
export function ashlarMaps(opts = {}) {
  const o = { seed: 1, worn: 0, rows: 10, tone: STONE.ashlar, joint: STONE.joint, ...opts };
  const rand = rng(o.seed);
  const [cc, g] = canvas(PX);
  const [bc, b] = canvas(PX);
  const m = PX / TILE; // pixels per metre
  g.fillStyle = rgb(o.joint, 0.8);
  g.fillRect(0, 0, PX, PX);
  b.fillStyle = grey(38);
  b.fillRect(0, 0, PX, PX);
  const rows = Array.from({ length: o.rows }, () => PX / o.rows);
  const blocks = courses(rand, PX, rows, 0.5 * m, 1.15 * m);
  for (const bl of blocks) {
    const j = 2 + (o.worn ? rand() * 3 * o.worn : 0); // half a joint, in pixels
    const lift = 150 + rand() * 46; // how proud this stone stands
    const shade = 0.86 + rand() * 0.3;
    const warm = rand() - 0.5;
    const ang = (rand() < 0.5 ? 1 : -1) * (0.5 + rand() * 0.7); // the mason's stroke
    const gap = 2.2 + rand() * 1.6;
    const spall = o.worn && rand() < 0.16 * o.worn;
    wrapped(PX, bl.x, bl.y, bl.w, bl.h, (x, y) => {
      const x0 = x + j; const y0 = y + j; const w = bl.w - 2 * j; const h = bl.h - 2 * j;
      // colour: the face, a paler arris, a darker foot where dust sits
      _c.setHex(o.tone);
      g.fillStyle = `rgb(${Math.round(_c.r * 255 * shade * (1 + 0.05 * warm))},${Math.round(_c.g * 255 * shade)},${Math.round(_c.b * 255 * shade * (1 - 0.06 * warm))})`;
      g.fillRect(x0, y0, w, h);
      g.fillStyle = 'rgba(235,240,245,0.10)';
      g.fillRect(x0, y0, w, 3);
      g.fillStyle = 'rgba(8,10,14,0.22)';
      g.fillRect(x0, y0 + h - 4, w, 4);
      // height: a rounded arris, a drafted margin, then the tooled face
      b.fillStyle = grey(lift * 0.62);
      b.fillRect(x0, y0, w, h);
      b.fillStyle = grey(lift * 0.84);
      b.fillRect(x0 + 2, y0 + 2, w - 4, h - 4);
      const mg = 9; // the margin: about 3.5 cm of smooth draft
      b.fillStyle = grey(lift * 0.93);
      b.fillRect(x0 + 4, y0 + 4, w - 8, h - 8);
      b.save();
      b.beginPath();
      b.rect(x0 + mg, y0 + mg, w - 2 * mg, h - 2 * mg);
      b.clip();
      b.fillStyle = grey(lift);
      b.fillRect(x0, y0, w, h);
      g.save();
      g.beginPath();
      g.rect(x0 + mg, y0 + mg, w - 2 * mg, h - 2 * mg);
      g.clip();
      const dx = Math.cos(ang); const dy = Math.sin(ang);
      const reach = w + h;
      for (let s = -reach; s < reach; s += gap) {
        const wob = (rand() - 0.5) * 2;
        const cx = x0 + w / 2 - dy * s; const cy = y0 + h / 2 + dx * s;
        const len = reach * (0.25 + rand() * 0.75);
        const off = (rand() - 0.5) * reach * 0.6;
        b.lineWidth = 0.7 + rand() * 0.7;
        b.strokeStyle = grey(rand() < 0.5 ? 40 : 250, 0.08 + rand() * 0.14);
        b.beginPath();
        b.moveTo(cx + dx * (off - len / 2), cy + dy * (off - len / 2) + wob);
        b.lineTo(cx + dx * (off + len / 2), cy + dy * (off + len / 2) - wob);
        b.stroke();
        if (rand() < 0.35) {
          g.lineWidth = 0.8;
          g.strokeStyle = rand() < 0.55 ? 'rgba(12,14,18,0.08)' : 'rgba(225,230,236,0.05)';
          g.beginPath();
          g.moveTo(cx + dx * (off - len / 2), cy + dy * (off - len / 2));
          g.lineTo(cx + dx * (off + len / 2), cy + dy * (off + len / 2));
          g.stroke();
        }
      }
      b.restore();
      g.restore();
      // chipped corners
      const chips = 1 + Math.floor(rand() * 2 + o.worn * 3);
      for (let k = 0; k < chips; k++) {
        const cxn = rand() < 0.5 ? x0 : x0 + w; const cyn = rand() < 0.5 ? y0 : y0 + h;
        const r = 3 + rand() * (5 + 14 * o.worn);
        b.fillStyle = grey(52, 0.9);
        g.fillStyle = 'rgba(20,22,27,0.55)';
        for (const q of [b, g]) {
          q.beginPath();
          q.moveTo(cxn, cyn);
          q.lineTo(cxn + (cxn === x0 ? r : -r) * (0.6 + rand()), cyn);
          q.lineTo(cxn, cyn + (cyn === y0 ? r : -r) * (0.6 + rand()));
          q.fill();
        }
      }
      if (spall) {
        // a face that has come away: a shallow ragged hollow, fresher stone inside
        const sx = x0 + w * (0.2 + rand() * 0.6); const sy = y0 + h * (0.3 + rand() * 0.4);
        const sr = Math.min(w, h) * (0.25 + rand() * 0.2);
        for (const [q, fill] of [[b, grey(lift * 0.66)], [g, 'rgba(128,130,130,0.2)']]) {
          q.fillStyle = fill;
          q.beginPath();
          for (let a = 0; a < 9; a++) {
            const t = (a / 9) * Math.PI * 2;
            const rr = sr * (0.6 + 0.5 * rand());
            q.lineTo(sx + Math.cos(t) * rr * 1.5, sy + Math.sin(t) * rr * 0.8);
          }
          q.fill();
        }
      }
    });
  }
  // The whole wall: stains and, when run down, missing mortar, cracks and damp.
  blots(g, PX, rand, 26, 50, 190, ['rgba(20,24,30,0.22)', 'rgba(150,158,166,0.12)', 'rgba(60,54,44,0.14)']);
  blots(b, PX, rand, 14, 60, 200, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)']);
  if (o.worn) {
    const holes = Math.round(70 * o.worn);
    for (let i = 0; i < holes; i++) {
      const bl = blocks[Math.floor(rand() * blocks.length)];
      const along = rand() < 0.7;
      const px = along ? bl.x + rand() * bl.w : bl.x;
      const py = along ? bl.y : bl.y + rand() * bl.h;
      const len = 14 + rand() * 60; const th = 5 + rand() * 7;
      wrapped(PX, px - len, py - len, len * 2, len * 2, (x, y) => {
        for (const [q, fill] of [[b, grey(8, 0.95)], [g, 'rgba(10,11,14,0.85)']]) {
          q.fillStyle = fill;
          q.beginPath();
          q.ellipse(x + len, y + len, along ? len / 2 : th / 2, along ? th / 2 : len / 2, 0, 0, Math.PI * 2);
          q.fill();
        }
      });
    }
    const cracks = Math.round(9 * o.worn);
    for (let i = 0; i < cracks; i++) {
      let x = rand() * PX; let y = rand() * PX;
      let a = Math.PI / 2 + (rand() - 0.5) * 1.2;
      for (const [q, st, lw] of [[b, grey(0, 0.9), 2.4], [g, 'rgba(8,9,12,0.8)', 1.6]]) {
        q.strokeStyle = st; q.lineWidth = lw; q.beginPath(); q.moveTo(x, y);
      }
      const steps = 8 + Math.floor(rand() * 14);
      for (let s = 0; s < steps; s++) {
        a += (rand() - 0.5) * 1.1;
        x += Math.cos(a) * (8 + rand() * 16); y += Math.sin(a) * (8 + rand() * 16);
        b.lineTo(x, y); g.lineTo(x, y);
      }
      b.stroke(); g.stroke();
    }
    // damp runs down from the joints: long soft streaks, greener than the stone
    for (let i = 0; i < 40 * o.worn; i++) {
      const x = rand() * PX; const y = rand() * PX; const w = 8 + rand() * 30; const h = 80 + rand() * 260;
      wrapped(PX, x, y, w, h, (px, py) => {
        const grad = g.createLinearGradient(0, py, 0, py + h);
        grad.addColorStop(0, 'rgba(22,34,30,0.42)');
        grad.addColorStop(1, 'rgba(22,34,30,0)');
        g.fillStyle = grad;
        g.fillRect(px, py, w, h);
      });
    }
  }
  grain(g, PX, 0.11, o.seed + 5);
  grain(b, PX, 0.07, o.seed + 9, 0.012 + 0.02 * o.worn);
  return { map: texture(cc, true), bump: texture(bc, false) };
}

/**
 * flagMaps(opts) -> { map, bump }. Floor flags, 4 m square, tiling: uneven slabs worn to a
 * hollow where feet fall. opts: seed (2); worn (0 to 1) cracked flags and open joints; tone.
 */
export function flagMaps(opts = {}) {
  const o = { seed: 2, worn: 0, tone: 0x5f6468, joint: 0x2a2d32, ...opts };
  const rand = rng(o.seed);
  const [cc, g] = canvas(PX);
  const [bc, b] = canvas(PX);
  const m = PX / TILE;
  g.fillStyle = rgb(o.joint);
  g.fillRect(0, 0, PX, PX);
  b.fillStyle = grey(30);
  b.fillRect(0, 0, PX, PX);
  const rows = [0.7, 0.55, 0.8, 0.6, 0.75, 0.6].map((h) => h * m);
  const slabs = courses(rand, PX, rows, 0.6 * m, 1.3 * m);
  for (const s of slabs) {
    const j = 2.5 + rand() * 1.5 + o.worn * 2;
    const lift = 150 + rand() * 50;
    const shade = 0.82 + rand() * 0.36;
    const cracked = o.worn && rand() < 0.3 * o.worn;
    wrapped(PX, s.x, s.y, s.w, s.h, (x, y) => {
      const x0 = x + j; const y0 = y + j; const w = s.w - 2 * j; const h = s.h - 2 * j;
      g.fillStyle = rgb(o.tone, shade);
      g.fillRect(x0, y0, w, h);
      b.fillStyle = grey(lift * 0.7);
      b.fillRect(x0, y0, w, h);
      b.fillStyle = grey(lift);
      b.fillRect(x0 + 3, y0 + 3, w - 6, h - 6);
      // worn to a dish in the middle, polished there
      const r = Math.max(w, h) * 0.6;
      const dish = b.createRadialGradient(x0 + w / 2, y0 + h / 2, 0, x0 + w / 2, y0 + h / 2, r);
      dish.addColorStop(0, 'rgba(0,0,0,0.22)');
      dish.addColorStop(1, 'rgba(0,0,0,0)');
      b.save(); b.beginPath(); b.rect(x0, y0, w, h); b.clip();
      b.fillStyle = dish;
      b.fillRect(x0, y0, w, h);
      b.restore();
      const sheen = g.createRadialGradient(x0 + w / 2, y0 + h / 2, 0, x0 + w / 2, y0 + h / 2, r);
      sheen.addColorStop(0, 'rgba(190,196,204,0.10)');
      sheen.addColorStop(1, 'rgba(190,196,204,0)');
      g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
      g.fillStyle = sheen;
      g.fillRect(x0, y0, w, h);
      if (cracked) {
        let px = x0 + rand() * w; let py = y0;
        g.strokeStyle = 'rgba(6,7,9,0.85)'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(px, py);
        b.save(); b.beginPath(); b.rect(x0, y0, w, h); b.clip();
        b.strokeStyle = grey(0, 0.95); b.lineWidth = 2.6; b.beginPath(); b.moveTo(px, py);
        while (py < y0 + h) {
          px += (rand() - 0.5) * 26; py += 6 + rand() * 16;
          g.lineTo(px, py); b.lineTo(px, py);
        }
        g.stroke(); b.stroke(); b.restore();
      }
      g.restore();
    });
  }
  blots(g, PX, rand, 30, 40, 170, ['rgba(12,14,18,0.25)', 'rgba(140,146,152,0.10)', 'rgba(50,44,36,0.16)']);
  blots(b, PX, rand, 18, 50, 180, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)']);
  grain(g, PX, 0.1, o.seed + 3);
  grain(b, PX, 0.06, o.seed + 4, 0.01 + 0.02 * o.worn);
  return { map: texture(cc, true), bump: texture(bc, false) };
}

/**
 * marbleMaps(dark, seed) -> { map, bump }. Polished marble, tiling: veins that fork and fade.
 * The vertex colour sets black or white; the map carries the veining for that stone.
 */
export function marbleMaps(dark = false, seed = 3) {
  const size = 512;
  const rand = rng(seed + (dark ? 50 : 0));
  const [cc, g] = canvas(size);
  const [bc, b] = canvas(size);
  g.fillStyle = dark ? '#8c8f96' : '#f4f5f6';
  g.fillRect(0, 0, size, size);
  b.fillStyle = grey(128);
  b.fillRect(0, 0, size, size);
  blots(g, size, rand, 30, 30, 120, dark ? ['rgba(255,255,255,0.10)', 'rgba(20,22,30,0.4)'] : ['rgba(150,156,166,0.16)', 'rgba(255,255,255,0.3)']);
  // Each vein is walked once and stroked at every wrapped copy, so the map tiles.
  const veins = [];
  const walk = (x, y, a, w, life) => {
    const pts = [[x, y]];
    for (let s = 0; s < life; s++) {
      a += (rand() - 0.5) * 0.7;
      x += Math.cos(a) * 9; y += Math.sin(a) * 9;
      pts.push([x, y]);
      if (w > 0.8 && rand() < 0.06) walk(x, y, a + (rand() - 0.5) * 1.6, w * 0.55, life * 0.4);
    }
    veins.push({ pts, w, alpha: rand() });
  };
  for (let i = 0; i < 9; i++) walk(rand() * size, rand() * size, rand() * Math.PI * 2, 1.2 + (i % 3) * 0.7, 70);
  for (const v of veins) {
    g.lineWidth = v.w;
    g.strokeStyle = dark ? `rgba(255,255,255,${0.35 + v.alpha * 0.5})` : `rgba(74,80,92,${0.2 + v.alpha * 0.35})`;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        v.pts.forEach(([x, y], k) => (k ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
        g.stroke();
      }
    }
  }
  grain(g, size, 0.04, seed + 1);
  grain(b, size, 0.02, seed + 2);
  return { map: texture(cc, true), bump: texture(bc, false) };
}

/**
 * rockMaps(seed) -> { map, bump }. Bare ground and living rock, tiling: no joints, only fissures,
 * hollows and grit. For the approach, the banks and the floor of the pit and the crypt.
 */
export function rockMaps(seed = 41) {
  const rand = rng(seed);
  const [cc, g] = canvas(PX);
  const [bc, b] = canvas(PX);
  g.fillStyle = '#4b4d4f';
  g.fillRect(0, 0, PX, PX);
  b.fillStyle = grey(128);
  b.fillRect(0, 0, PX, PX);
  blots(g, PX, rand, 60, 40, 220, ['rgba(16,18,22,0.3)', 'rgba(120,122,120,0.18)', 'rgba(60,50,38,0.2)']);
  blots(b, PX, rand, 46, 30, 200, ['rgba(255,255,255,0.22)', 'rgba(0,0,0,0.26)']);
  blots(g, PX, rand, 500, 4, 16, ['rgba(10,12,14,0.3)', 'rgba(150,150,146,0.16)']);
  blots(b, PX, rand, 700, 3, 14, ['rgba(255,255,255,0.3)', 'rgba(0,0,0,0.34)']);
  // fissures, each walked once and stroked at every wrapped copy
  for (let i = 0; i < 26; i++) {
    let x = rand() * PX; let y = rand() * PX; let a = rand() * Math.PI * 2;
    const pts = [[x, y]];
    const n = 10 + Math.floor(rand() * 30);
    for (let k = 0; k < n; k++) { a += (rand() - 0.5) * 0.9; x += Math.cos(a) * 14; y += Math.sin(a) * 14; pts.push([x, y]); }
    for (const [q, st, lw] of [[b, grey(0, 0.8), 2.5], [g, 'rgba(6,7,9,0.6)', 1.6]]) {
      q.strokeStyle = st; q.lineWidth = lw;
      for (const ox of [-PX, 0, PX]) for (const oy of [-PX, 0, PX]) {
        q.beginPath();
        pts.forEach(([px, py], k) => (k ? q.lineTo(px + ox, py + oy) : q.moveTo(px + ox, py + oy)));
        q.stroke();
      }
    }
  }
  grain(g, PX, 0.16, seed + 1);
  grain(b, PX, 0.1, seed + 2, 0.03);
  return { map: texture(cc, true), bump: texture(bc, false) };
}

// ---- materials --------------------------------------------------------------------------------

// Lays a stone map by world position (floors by x and z, walls by their run and height), adds a
// slow change of tone over metres so the 4 m repeat does not read, and wets the foot of the wall.
function layByWorld(mat, o) {
  const S = (1 / o.metres).toFixed(4);
  const key = `stone:${S}:${o.damp}:${o.floorY}:${o.vary}`;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStoneP;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
      {
        vec4 sP = vec4( position, 1.0 );
        vec3 sN = normal;
        #ifdef USE_INSTANCING
          sP = instanceMatrix * sP;
          sN = mat3( instanceMatrix ) * sN;
        #endif
        sP = modelMatrix * sP;
        sN = abs( normalize( mat3( modelMatrix ) * sN ) );
        vec2 sUv = sN.y > 0.7 ? sP.xz : ( sN.x > sN.z ? sP.zy : sP.xy );
        vStoneP = sP.xyz;
        #ifdef USE_MAP
          vMapUv = sUv * ${S};
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = sUv * ${S};
        #endif
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vStoneP;
        float stoneDamp = 0.0;
        float stoneHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
        float stoneNoise( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( stoneHash( i ), stoneHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( stoneHash( i + vec3( 0, 1, 0 ) ), stoneHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( stoneHash( i + vec3( 0, 0, 1 ) ), stoneHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( stoneHash( i + vec3( 0, 1, 1 ) ), stoneHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float big = stoneNoise( vStoneP * 0.31 ) * 0.6 + stoneNoise( vStoneP * 1.17 + 3.0 ) * 0.4;
          diffuseColor.rgb *= 1.0 + ${o.vary.toFixed(3)} * ( big - 0.5 );
          float foot = smoothstep( 1.25, 0.0, vStoneP.y - ${o.floorY.toFixed(3)} ) * step( ${o.floorY.toFixed(3)} - 0.05, vStoneP.y ) * ${o.damp.toFixed(3)};
          foot *= 0.45 + 0.55 * stoneNoise( vStoneP * vec3( 1.9, 0.7, 1.9 ) + 7.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.36, 0.47, 0.42 ), foot );
          stoneDamp = foot;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix( roughnessFactor, 0.3, stoneDamp );');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

const MAPS = new Map();
const MATS = new Map();
const mapsFor = (name, make) => {
  if (!MAPS.has(name)) MAPS.set(name, make());
  return MAPS.get(name);
};

/**
 * stoneMaterial(kind, opts) -> MeshStandardMaterial, shared per kind and floor. Every one uses
 * vertex colour (white leaves the map as drawn) and lays its map by world position.
 *   kind: 'ashlar' (kept rooms), 'worn' (passages: open joints, cracks, damp at the foot),
 *         'flag' (room floors), 'flagWorn' (passage floors), 'rock' (the pit and the crypt
 *         floor), 'marbleLight', 'marbleDark' (polished; the gallery and the board).
 *   opts: floorY (0) the floor the damp rises from (worn kinds only); side.
 */
export function stoneMaterial(kind = 'ashlar', opts = {}) {
  const floorY = opts.floorY || 0;
  const key = `${kind}:${floorY}:${opts.side || 0}`;
  if (MATS.has(key)) return MATS.get(key);
  let maps; let o;
  if (kind === 'worn') {
    maps = mapsFor('worn', () => ashlarMaps({ seed: 11, worn: 1, tone: 0x676c70 }));
    o = { roughness: 0.9, bump: 2.6, damp: 1, vary: 0.5 };
  } else if (kind === 'flag') {
    maps = mapsFor('flag', () => flagMaps({ seed: 21 }));
    o = { roughness: 0.62, bump: 1.6, damp: 0, vary: 0.3 };
  } else if (kind === 'flagWorn') {
    maps = mapsFor('flagWorn', () => flagMaps({ seed: 23, worn: 1, tone: 0x565b5e }));
    o = { roughness: 0.7, bump: 2.2, damp: 0, vary: 0.5 };
  } else if (kind === 'rock') {
    maps = mapsFor('rock', () => rockMaps());
    o = { roughness: 0.92, bump: 3.2, damp: 0, vary: 0.7, metres: 5 };
  } else if (kind === 'marbleLight' || kind === 'marbleDark') {
    const dark = kind === 'marbleDark';
    maps = mapsFor(kind, () => marbleMaps(dark));
    o = { roughness: 0.16, bump: 0.15, damp: 0, vary: 0.08, metres: 2.6, metalness: 0.05, color: dark ? 0x2a2b31 : 0xc6cad0 };
  } else {
    maps = mapsFor('ashlar', () => ashlarMaps({ seed: 7 }));
    o = { roughness: 0.84, bump: 2.2, damp: 0, vary: 0.3 };
  }
  const mat = new THREE.MeshStandardMaterial({
    map: maps.map, bumpMap: maps.bump, bumpScale: o.bump, roughness: o.roughness, metalness: o.metalness || 0,
    vertexColors: true, color: o.color == null ? 0xffffff : o.color, side: opts.side || THREE.FrontSide,
  });
  layByWorld(mat, { metres: o.metres || TILE, damp: o.damp, floorY, vary: o.vary });
  mat.userData.stone = true; // one of the shared cache: an owner's dispose leaves it for disposeStone
  MATS.set(key, mat);
  return mat;
}

// ---- cut shapes -------------------------------------------------------------------------------

/**
 * paint(geo, hex = white, opts) -> geo. Vertex colour for a stone part: `vary` mottles it by
 * position, `soot` darkens it upward from `sootY` (over a fire or a torch).
 */
export function paint(geo, hex = 0xffffff, opts = {}) {
  const o = { vary: 0.08, seed: 0, soot: 0, sootY: 0, sootH: 2, ...opts };
  const c = _c.setHex(hex);
  const r = c.r; const gg = c.g; const bb = c.b;
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    let k = 1 + o.vary * noise(x * 0.7, y * 0.7, z * 0.7, o.seed);
    if (o.soot) k *= 1 - o.soot * clamp((y - o.sootY) / o.sootH) * clamp(1.4 - (y - o.sootY) / (o.sootH * 2.2));
    arr[i * 3] = r * k; arr[i * 3 + 1] = gg * k; arr[i * 3 + 2] = bb * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** A box from its low corner sizes: centred on (x, z), standing on y0. Painted white. */
export function block(x, y0, z, w, h, d, hex = 0xffffff, vary = 0.06) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y0 + h / 2, z);
  g.deleteAttribute('uv');
  return paint(g, hex, { vary });
}

/**
 * archPoints(w, rise, n = 8) -> [[x, y], ...] from the left springing (-w/2, 0) over the point
 * (0, rise) to the right springing. rise >= w/2 gives a two-centred pointed arch; rise = w/2 is
 * a round one; rise 0 a flat head.
 */
export function archPoints(w, rise, n = 8) {
  const half = w / 2;
  if (rise <= 0.001) return [[-half, 0], [half, 0]];
  const r0 = Math.max(rise, half);
  const cx = (r0 * r0 - half * half) / (2 * half);
  const r = cx + half;
  const top = Math.atan2(r0, -cx);
  const left = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (top - Math.PI) * (i / n);
    left.push([cx + Math.cos(a) * r, Math.sin(a) * r * (rise / r0)]);
  }
  const right = left.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
  return left.concat(right);
}

// The outline of an opening in wall space, anticlockwise from its low left corner.
function openingOutline(op) {
  const half = op.w / 2;
  const rise = op.rise == null ? op.w * 0.62 : op.rise;
  const y0 = op.y || 0;
  const spring = y0 + op.h - rise;
  const pts = [[op.at + half, y0], [op.at + half, spring]];
  const arch = archPoints(op.w, rise, op.n || 8).reverse();
  for (let i = 1; i < arch.length - 1; i++) pts.push([op.at + arch[i][0], spring + arch[i][1]]);
  pts.push([op.at - half, spring], [op.at - half, y0]);
  return pts;
}

/**
 * wall(o) -> BufferGeometry in world space. One straight wall with arched openings cut clean
 * through it, reveals included.
 *   o: from [x, z], to [x, z] (its centre line), y0 (0), y1 (4), t (0.6) thickness,
 *      openings: [{ at (metres from `from`), w, h (to the point), y (sill, 0 = a doorway),
 *      rise (0.62 w; 0 for a flat head) }], hex, vary.
 */
export function wall(o) {
  const y0 = o.y0 || 0; const y1 = o.y1 == null ? 4 : o.y1; const t = o.t == null ? 0.6 : o.t;
  const dx = o.to[0] - o.from[0]; const dz = o.to[1] - o.from[1];
  const len = Math.hypot(dx, dz);
  const ops = (o.openings || []).slice().sort((a, b) => a.at - b.at);
  const shape = new THREE.Shape();
  shape.moveTo(0, y0);
  for (const op of ops.filter((q) => !(q.y > 0.001))) {
    // a doorway is part of the outline, so the wall has no sliver under it
    const out = openingOutline({ ...op, y: y0 }).reverse();
    for (const [x, y] of out) shape.lineTo(x, y);
  }
  shape.lineTo(len, y0);
  shape.lineTo(len, y1);
  shape.lineTo(0, y1);
  shape.closePath();
  for (const op of ops.filter((q) => q.y > 0.001)) {
    const out = openingOutline({ ...op, y: y0 + op.y });
    const hole = new THREE.Path();
    hole.moveTo(out[0][0], out[0][1]);
    for (let i = 1; i < out.length; i++) hole.lineTo(out[i][0], out[i][1]);
    hole.closePath();
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.deleteAttribute('uv');
  g.translate(0, 0, -t / 2);
  g.applyMatrix4(wallMatrix(o.from, o.to));
  return paint(g, o.hex == null ? 0xffffff : o.hex, { vary: o.vary == null ? 0.07 : o.vary, seed: o.seed || 0 });
}

const _mx = new THREE.Matrix4();
/** The matrix taking wall space (x along, y up, z out of the face on the left of the run) to the world. */
export function wallMatrix(from, to, out = 0, y = 0) {
  const dx = to[0] - from[0]; const dz = to[1] - from[1];
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l; const uz = dz / l;
  // z axis = x cross y, so the face looks to the left of the direction of travel
  const nx = -uz; const nz = ux;
  return new THREE.Matrix4().set(
    ux, 0, nx, from[0] + nx * out,
    0, 1, 0, y,
    uz, 0, nz, from[1] + nz * out,
    0, 0, 0, 1,
  );
}

/**
 * sweep(points, profile, opts) -> BufferGeometry. Runs a carved profile along a path: the way
 * every moulding, rib and string course is cut. Smooth along the run, crisp across the profile.
 *   points: [{ p: [x, y, z], n: [x, y, z], b: [x, y, z] }] the path with, at each point, the two
 *           unit directions the profile is measured in;
 *   profile: [[a, b], ...] metres along n and along b; opts: closed (false) joins the last point
 *           to the first; hex, vary.
 */
export function sweep(points, profile, opts = {}) {
  const np = points.length; const nq = profile.length - 1;
  const pos = []; const idx = [];
  for (let q = 0; q < nq; q++) {
    const [a0, b0] = profile[q]; const [a1, b1] = profile[q + 1];
    const base = pos.length / 3;
    for (const pt of points) {
      pos.push(pt.p[0] + pt.n[0] * a0 + pt.b[0] * b0, pt.p[1] + pt.n[1] * a0 + pt.b[1] * b0, pt.p[2] + pt.n[2] * a0 + pt.b[2] * b0);
      pos.push(pt.p[0] + pt.n[0] * a1 + pt.b[0] * b1, pt.p[1] + pt.n[1] * a1 + pt.b[1] * b1, pt.p[2] + pt.n[2] * a1 + pt.b[2] * b1);
    }
    const last = opts.closed ? np : np - 1;
    for (let i = 0; i < last; i++) {
      const a = base + i * 2; const c = base + ((i + 1) % np) * 2;
      if (opts.flip) idx.push(a, a + 1, c, c, a + 1, c + 1);
      else idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, opts.hex == null ? 0xffffff : opts.hex, { vary: opts.vary == null ? 0.05 : opts.vary, seed: opts.seed || 0 });
}

// Path points for an opening's surround in wall space, with the in-plane normal pointing away
// from the opening (mitred at the corners) and the binormal out of the wall.
function surroundPath(op) {
  const out = openingOutline(op).reverse(); // left foot, up, over, down to the right foot
  const pts = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const a = out[Math.max(0, i - 1)]; const c = out[Math.min(out.length - 1, i + 1)];
    let tx = c[0] - a[0]; let ty = c[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    pts.push({ p: [p[0], p[1], 0], n: [-ty, tx, 0], b: [0, 0, 1] });
  }
  return pts;
}

/** Carved profiles, [away from the opening, proud of the wall], for surrounds and ribs. */
export const PROFILE = {
  // a hollow chamfer, a roll and a fillet: a kept room's doorcase
  door: [[0, 0], [0, 0.05], [0.05, 0.11], [0.09, 0.11], [0.11, 0.15], [0.16, 0.17], [0.21, 0.15], [0.23, 0.1], [0.3, 0.1], [0.34, 0.05], [0.34, 0]],
  // a plain splay: a passage arch
  plain: [[0, 0], [0, 0.08], [0.1, 0.14], [0.22, 0.14], [0.26, 0.08], [0.26, 0]],
  // a slim bead: window tracery and frames
  bead: [[0, 0], [0, 0.05], [0.03, 0.08], [0.08, 0.08], [0.11, 0.05], [0.11, 0]],
  rib: [[0, -0.11], [0.07, -0.11], [0.1, -0.06], [0.17, -0.05], [0.2, 0], [0.17, 0.05], [0.1, 0.06], [0.07, 0.11], [0, 0.11]],
  string: [[0, 0], [0.05, 0.02], [0.09, 0.08], [0.09, 0.12], [0.05, 0.16], [0, 0.18]],
};

/**
 * surround(op, opts) -> BufferGeometry in wall space (z = 0 is the wall's face). The carved
 * case round an opening: op as for wall(); opts: profile (PROFILE.door), hex.
 */
export function surround(op, opts = {}) {
  return sweep(surroundPath(op), opts.profile || PROFILE.door, { hex: opts.hex, vary: opts.vary, seed: opts.seed });
}

/** Moves wall-space geometry onto a wall's face: `out` metres proud of its centre line. */
export function onWall(geo, from, to, out = 0, y = 0) {
  geo.applyMatrix4(wallMatrix(from, to, out, y));
  return geo;
}

/**
 * course(from, to, y, out, opts) -> BufferGeometry in world space. A string course, plinth or
 * cornice along a wall face: opts.profile ([proud, up] pairs, PROFILE.string), hex.
 */
export function course(from, to, y, out, opts = {}) {
  const dx = to[0] - from[0]; const dz = to[1] - from[1];
  const l = Math.hypot(dx, dz) || 1;
  const n = [-dz / l, 0, dx / l];
  const pts = [from, to].map((p) => ({ p: [p[0] + n[0] * out, y, p[1] + n[2] * out], n, b: [0, 1, 0] }));
  return sweep(pts, opts.profile || PROFILE.string, { hex: opts.hex, vary: opts.vary, flip: true });
}

/**
 * vault(o) -> BufferGeometry in world space. A pointed vault over a rectangle, seen from below,
 * with a transverse rib at every bay, a ridge rib, and a wall rib each side.
 *   o: x0, x1, z0, z1 (the room), spring (height the vault springs from), rise, along ('z' | 'x':
 *      the way the ridge runs), bays (ribs = bays + 1), hex, ribHex.
 */
export function vault(o) {
  const alongZ = o.along !== 'x';
  const w = alongZ ? o.x1 - o.x0 : o.z1 - o.z0;
  const len = alongZ ? o.z1 - o.z0 : o.x1 - o.x0;
  const mid = alongZ ? (o.x0 + o.x1) / 2 : (o.z0 + o.z1) / 2;
  const start = alongZ ? o.z0 : o.x0;
  const arch = archPoints(w, o.rise, 7);
  const at = (a, s, y) => (alongZ ? [mid + a, y, start + s] : [start + s, y, mid + a]);
  const parts = [];
  // the web, in strips between ribs so its colour can vary by bay
  const pos = []; const idx = [];
  const bays = Math.max(1, o.bays || 1);
  for (let k = 0; k <= bays; k++) {
    for (const [a, y] of arch) { const p = at(a, (len * k) / bays, o.spring + y); pos.push(p[0], p[1], p[2]); }
  }
  const n = arch.length;
  for (let k = 0; k < bays; k++) {
    for (let i = 0; i < n - 1; i++) {
      const a = k * n + i; const c = (k + 1) * n + i;
      if (alongZ) idx.push(a, a + 1, c, c, a + 1, c + 1); else idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const web = new THREE.BufferGeometry();
  web.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  web.setIndex(idx);
  web.computeVertexNormals();
  parts.push(paint(web, o.hex == null ? 0xd9dce0 : o.hex, { vary: 0.1 }));
  // ribs: the profile is measured inward (toward the room) and along the vault
  const inward = arch.map(([a, y], i) => {
    const p = arch[Math.max(0, i - 1)]; const q = arch[Math.min(n - 1, i + 1)];
    let tx = q[0] - p[0]; let ty = q[1] - p[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    return [ty, -tx]; // right-hand normal of a left-to-right run over the top: points down and in
  });
  const run = alongZ ? [0, 0, 1] : [1, 0, 0];
  const ribHex = o.ribHex == null ? 0xffffff : o.ribHex;
  for (let k = 0; k <= bays; k++) {
    const s = (len * k) / bays;
    const inset = k === 0 ? 0.11 : k === bays ? -0.11 : 0;
    const pts = arch.map(([a, y], i) => ({
      p: at(a, s + inset, o.spring + y),
      n: alongZ ? [inward[i][0], inward[i][1], 0] : [0, inward[i][1], inward[i][0]],
      b: run,
    }));
    parts.push(sweep(pts, PROFILE.rib, { hex: ribHex, flip: !alongZ }));
  }
  const ridge = [0, len].map((s) => ({ p: at(0, s, o.spring + o.rise), n: [0, -1, 0], b: alongZ ? [1, 0, 0] : [0, 0, 1] }));
  parts.push(sweep(ridge, PROFILE.rib, { hex: ribHex, flip: alongZ }));
  return merge(parts);
}

/**
 * column(o) -> BufferGeometry standing on the origin: a turned shaft with a moulded base and a
 * carved bell capital. o: h (4), r (0.22), half (false: true makes a wall shaft, flat side at
 * z = 0 facing -z), hex.
 */
export function column(o = {}) {
  const h = o.h || 4; const r = o.r || 0.22;
  const prof = [
    [r * 1.9, 0], [r * 1.9, 0.14], [r * 1.6, 0.2], [r * 1.7, 0.27], [r * 1.35, 0.34], [r * 1.25, 0.42], [r, 0.5],
    [r * 0.96, h * 0.5], [r, h - 0.62], [r * 1.18, h - 0.58], [r * 1.2, h - 0.5], [r * 1.02, h - 0.46],
    [r * 1.15, h - 0.3], [r * 1.6, h - 0.14], [r * 1.9, h - 0.1], [r * 1.9, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = o.half
    ? new THREE.LatheGeometry(prof, 8, Math.PI / 2, Math.PI)
    : new THREE.LatheGeometry(prof, 12);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return paint(g, o.hex == null ? 0xffffff : o.hex, { vary: 0.06 });
}

/** Battlements along a wall top: merlons of width `w` every `gap + w`, `h` high, `t` thick. */
export function battlements(from, to, y, t = 0.7, w = 1.1, h = 1.0, gap = 0.9) {
  const dx = to[0] - from[0]; const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round((len + gap) / (w + gap)));
  const step = len / n;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(step - gap, h, t);
    g.deleteAttribute('uv');
    g.translate((i + 0.5) * step, y + h / 2, 0);
    // a weathered cap on each merlon
    const cap = new THREE.BoxGeometry(step - gap + 0.12, 0.12, t + 0.12);
    cap.deleteAttribute('uv');
    cap.translate((i + 0.5) * step, y + h + 0.06, 0);
    parts.push(g, cap);
  }
  const all = merge(parts.map((p) => paint(p, 0xffffff, { vary: 0.08 })));
  all.applyMatrix4(wallMatrix(from, to));
  return all;
}

/**
 * fireplace(o) -> { stone, fire: [x, y, z], mouth: { w, h } } in wall space (z out of the wall,
 * standing on y = 0, centred on x = 0). A carved chimneypiece: shafts, a four-centred arch, a
 * mantel on corbels, an overmantel panel and a raised hearth. o: w (2.6), h (2.2), d (0.7), hex,
 * slab (true: false leaves the hearth stone out, where the floor before it is not solid),
 * slabW (w + 0.5) and slabD (1.1) the hearth stone's width and depth.
 */
export function fireplace(o = {}) {
  const w = o.w || 2.6; const h = o.h || 2.2; const d = o.d || 0.7;
  const hex = o.hex == null ? 0xf0f2f4 : o.hex;
  const mw = w * 0.56; const mh = h * 0.62; // the mouth
  const parts = [];
  // cheeks and lintel, cut as one small wall with a low arch
  const face = wall({ from: [-w / 2, 0], to: [w / 2, 0], y0: 0, y1: h, t: d, openings: [{ at: w / 2, w: mw, h: mh, rise: mw * 0.32 }], hex, vary: 0.05 });
  face.rotateY(Math.PI); // wall() looks to the left of its run: turn it to face +z
  face.translate(0, 0, d / 2);
  parts.push(face);
  parts.push(surround({ at: 0, w: mw, h: mh, rise: mw * 0.32 }, { profile: PROFILE.door, hex }).translate(0, 0, d));
  for (const s of [-1, 1]) {
    parts.push(column({ h: h * 0.9, r: 0.09, hex }).translate(s * (w / 2 - 0.16), 0, d + 0.06));
    // corbels under the mantel
    parts.push(block(s * (w / 2 - 0.16), h * 0.9, d + 0.02, 0.3, h * 0.1, 0.34, hex));
  }
  // mantel shelf, stepped
  parts.push(block(0, h, d * 0.5 + 0.06, w + 0.3, 0.1, d + 0.3, hex));
  parts.push(block(0, h + 0.1, d * 0.5 + 0.1, w + 0.46, 0.08, d + 0.42, hex));
  // overmantel: a recessed panel with a pointed head and a string above
  const oh = h * 0.75;
  parts.push(block(0, h + 0.18, d * 0.25, w * 0.86, oh, d * 0.5, hex));
  parts.push(surround({ at: 0, w: w * 0.5, h: oh * 0.8, y: h + 0.26, rise: w * 0.3 }, { profile: PROFILE.bead, hex }).translate(0, 0, d * 0.5));
  parts.push(block(0, h + 0.18 + oh, d * 0.25 + 0.05, w * 0.95, 0.12, d * 0.5 + 0.14, hex));
  // hearth and the black of the firebox
  const slabD = o.slabD || 1.1;
  if (o.slab !== false) parts.push(block(0, 0, d - 0.2 + slabD / 2, o.slabW || w + 0.5, 0.09, slabD, 0xc9ccd0));
  parts.push(block(0, 0.0, 0.03, mw + 0.2, mh + 0.2, 0.06, 0x020202, 0));
  parts.push(block(0, 0.09, d * 0.5, mw, 0.02, d, 0x020202, 0));
  return { stone: merge(parts), fire: [0, 0.3, d * 0.5], mouth: { w: mw, h: mh } };
}

/**
 * rubble(o) -> BufferGeometry in world space: fallen mortar and a few lost blocks along the foot
 * of a wall. o: from [x, z], to [x, z] (the foot of the wall's face), out (0.5) how far it lies
 * from it, n (10), seed, y (0).
 */
export function rubble(o) {
  const rand = rng(o.seed || 1);
  const dx = o.to[0] - o.from[0]; const dz = o.to[1] - o.from[1];
  const l = Math.hypot(dx, dz) || 1;
  const nx = -dz / l; const nz = dx / l;
  const parts = [];
  for (let i = 0; i < (o.n || 10); i++) {
    const s = rand(); const out = rand() * rand() * (o.out || 0.5);
    const big = rand() < 0.1;
    const sz = big ? 0.12 + rand() * 0.14 : 0.03 + rand() * 0.07;
    const g = new THREE.BoxGeometry(sz * (1 + rand()), sz * (big ? 0.7 : 0.5), sz * (0.7 + rand() * 0.6));
    g.deleteAttribute('uv');
    g.rotateY(rand() * 3).rotateZ((rand() - 0.5) * 0.5);
    g.translate(o.from[0] + dx * s + nx * (out + 0.08), (o.y || 0) + sz * 0.22, o.from[1] + dz * s + nz * (out + 0.08));
    parts.push(paint(g, big ? 0xe6e8ea : 0xb5b1a6, { vary: 0.2, seed: i }));
  }
  return merge(parts);
}

/**
 * steps(o) -> BufferGeometry in world space: a straight stone flight, each tread a solid block
 * with a nosing. o: x, z (the foot, centre of the first riser), dir [dx, dz] (unit, the way up),
 * w, n, rise (total), run (total), y (foot height), hex.
 */
export function steps(o) {
  const parts = [];
  const tr = o.run / o.n; const rs = o.rise / o.n;
  const yaw = Math.atan2(o.dir[0], o.dir[1]);
  for (let i = 0; i < o.n; i++) {
    const g = new THREE.BoxGeometry(o.w, rs * (i + 1), tr);
    g.deleteAttribute('uv');
    g.translate(0, (rs * (i + 1)) / 2, tr * (i + 0.5));
    const nose = new THREE.BoxGeometry(o.w + 0.04, 0.05, 0.08);
    nose.deleteAttribute('uv');
    nose.translate(0, rs * (i + 1) - 0.025, tr * i + 0.0);
    parts.push(paint(g, o.hex == null ? 0xffffff : o.hex, { vary: 0.08, seed: i }), paint(nose, 0xe6e8ea, { vary: 0.04 }));
  }
  const all = merge(parts);
  all.rotateY(yaw);
  all.translate(o.x, o.y || 0, o.z);
  return all;
}

/**
 * Frees every cached stone map and material (their canvases with them). The cache is shared by
 * every view that calls stoneMaterial, so call this once, after all of them have been disposed.
 * They are made again on next use.
 */
export function disposeStone() {
  for (const m of MATS.values()) m.dispose();
  for (const maps of MAPS.values()) {
    for (const t of [maps.map, maps.bump]) {
      t.dispose();
      if (t.image) { t.image.width = t.image.height = 0; } // let the canvas's pixels go now
    }
  }
  MATS.clear();
  MAPS.clear();
}

/** Stone parts into one mesh on a stone material, casting and receiving shadow. */
export function stoneMesh(parts, kind = 'ashlar', opts = {}) {
  const m = new THREE.Mesh(merge(parts), stoneMaterial(kind, opts));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}
