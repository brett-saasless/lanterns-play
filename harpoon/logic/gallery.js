// The Looking-Glass Gallery's floor (R8, R12, G6, A5): 60 marble tiles, 5 columns by 12 rows
// (column A nearest the mirror, E nearest the windows; row 1 at the entrance). A tile is true
// when it lies on the true path; isTrue is the one source of truth for that, read by the
// rules here and by the view (keepprops.js sets each tile's layer from tileLayer). A false
// tile stepped on crumbles and stays gone, dropping the warden into the crypt for a quarter of
// full health; a shot tests a tile from afar (a false one shatters, a true one only chips; the
// salt round is spent by the shipped salt gun). nextTrue names the tile the grin hangs over.
// A death anywhere makes every tile whole again (G6). State lives in sim.waves.tiles
// ({ gone[60] }); the true path is data in keepmap.js and is read here alone.
// The footing (owner): a whole false tile holds the warden's weight within FOOTING_SHARE of a
// tile's width of any true tile (along a shared edge, or in the corner square a diagonal true
// tile meets), so the walkable path is 1.5 tiles wide between false tiles. It is never drawn:
// the view's layers are unchanged, and a shot still tests the whole tile.

import { TRUE_PATH_SOURCE, GALLERY, tileAt, tileRect } from './keepmap.js';

export const COLS = 5;
export const ROWS = 12;
export const TILE_COUNT = COLS * ROWS;

/** A fall into the crypt costs this share of full health (R8). */
export const FALL_SHARE = 0.25;

/** The view's layers (design, Decisions): 0 is seen by eye and glass, 1 by the eye only. */
export const LAYER_BOTH = 0;
export const LAYER_EYE = 1;

/** 'B4' -> its index (row - 1) * 5 + column, or -1 for anything that is not a tile. */
export function tileIndex(name) {
  if (typeof name !== 'string') return -1;
  const m = /^([A-E])(\d{1,2})$/.exec(name);
  if (!m) return -1;
  const col = m[1].charCodeAt(0) - 65;
  const row = Number(m[2]);
  if (row < 1 || row > ROWS) return -1;
  return (row - 1) * COLS + col;
}

/** Index -> 'B4'. */
export function tileName(i) {
  return String.fromCharCode(65 + (i % COLS)) + String(Math.floor(i / COLS) + 1);
}

/** Index -> { col 0-4, row 1-12 }. */
export function tileCell(i) {
  return { col: i % COLS, row: Math.floor(i / COLS) + 1 };
}

function asIndex(tile) {
  if (typeof tile === 'string') return tileIndex(tile);
  return Number.isInteger(tile) && tile >= 0 && tile < TILE_COUNT ? tile : -1;
}

/** The true path as indices, entrance to far apron, from keepmap.js. */
export const TRUE_PATH = Object.freeze(TRUE_PATH_SOURCE.map((t) => asIndex(t)));
const TRUE_SET = new Set(TRUE_PATH);

/** A5: the one source of truth. tile: an index 0-59 or a name like 'B4'. */
export function isTrue(tile) {
  return TRUE_SET.has(asIndex(tile));
}

/** A whole floor. */
export function createTiles() {
  return { gone: new Array(TILE_COUNT).fill(false) };
}

/**
 * G6: a death anywhere makes every tile whole again, in place (the same gone array, so a view
 * holding it sees the reset). Returns the tiles.
 */
export function wholeTiles(tiles) {
  if (!Array.isArray(tiles.gone) || tiles.gone.length !== TILE_COUNT) tiles.gone = new Array(TILE_COUNT);
  tiles.gone.fill(false);
  return tiles;
}

/** The fall's damage for full health maxHealth (default 100). */
export function fallDamage(maxHealth = 100) {
  return maxHealth * FALL_SHARE;
}

/**
 * The warden's weight comes onto a tile. A true tile holds (returns { fell: false }). A false
 * tile breaks (tileBreak { tile, shot: false }) and stays gone; a false or gone tile drops the
 * warden: cryptFall { tile, damage, first }. opts: { fell (done.fell: a fall has happened
 * before), maxHealth }. The caller applies the damage (the shipped hurtPlayer), sets
 * done.fell and moves the warden down; under then follows position (A3).
 * Returns null for a tile that is not on the floor.
 */
export function stepOn(tiles, tile, events = [], opts = {}) {
  const i = asIndex(tile);
  if (i < 0) return null;
  if (isTrue(i) && !tiles.gone[i]) return { tile: i, fell: false };
  if (!tiles.gone[i]) {
    tiles.gone[i] = true;
    events.push({ type: 'tileBreak', tile: i, shot: false });
  }
  const damage = fallDamage(opts.maxHealth ?? 100);
  const first = !opts.fell;
  events.push({ type: 'cryptFall', tile: i, damage, first });
  return { tile: i, fell: true, damage, first };
}

/** The footing's width, as a share of a tile's: a quarter on each side makes a one-tile path 1.5 wide. */
export const FOOTING_SHARE = 0.25;

/**
 * Whether (x, z) lies in a false tile's footing: within FOOTING_SHARE of a tile's width of a
 * neighbouring true tile (its edge band, or the corner square at a diagonal one). Never on a
 * true tile, off the field, or against a wall, an apron or another false tile.
 */
export function inFooting(x, z) {
  const i = tileAt(x, z);
  if (i < 0 || isTrue(i)) return false;
  const reach = FOOTING_SHARE * GALLERY.tile;
  const { col, row } = tileCell(i);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc; const r = row + dr;
      if ((!dc && !dr) || c < 0 || c >= COLS || r < 1 || r > ROWS) continue;
      const n = (r - 1) * COLS + c;
      if (!isTrue(n)) continue;
      const t = tileRect(n);
      const gap = Math.max(t.minX - x, x - t.maxX, t.minZ - z, z - t.maxZ, 0);
      if (gap <= reach) return true;
    }
  }
  return false;
}

/**
 * The warden's weight comes down at (x, z): inside a whole false tile's footing it holds
 * ({ tile, fell: false, footing: true }, no events); anywhere else on the field it is stepOn
 * for the tile underfoot. Null off the field.
 */
export function stepAt(tiles, x, z, events = [], opts = {}) {
  const i = tileAt(x, z);
  if (i < 0) return null;
  if (!tiles.gone[i] && inFooting(x, z)) return { tile: i, fell: false, footing: true };
  return stepOn(tiles, i, events, opts);
}

/**
 * A shot meets a tile: tileShot { tile, shot: true } always; a false tile also shatters,
 * tileBreak { tile, shot: true }, and stays gone. A true tile only chips. A gone tile is not
 * there to hit (null). Returns { tile, broke }.
 */
export function shootTile(tiles, tile, events = []) {
  const i = asIndex(tile);
  if (i < 0 || tiles.gone[i]) return null;
  events.push({ type: 'tileShot', tile: i, shot: true });
  if (isTrue(i)) return { tile: i, broke: false };
  tiles.gone[i] = true;
  events.push({ type: 'tileBreak', tile: i, shot: true });
  return { tile: i, broke: true };
}

/**
 * The next true tile ahead of the warden, where the grin hangs: from the entrance apron
 * (at null) the path's first tile; from a tile on the path, the one after it; from the last,
 * null (the far apron is next). From anywhere off the path, the first path tile beyond the
 * furthest row the warden has stood on (reached, default the row of at).
 */
export function nextTrue(at = null, reached = null) {
  const i = at == null ? -1 : asIndex(at);
  const k = i < 0 ? -1 : TRUE_PATH.indexOf(i);
  if (at == null) return TRUE_PATH[0];
  if (k >= 0) return k + 1 < TRUE_PATH.length ? TRUE_PATH[k + 1] : null;
  const row = reached ?? (i >= 0 ? tileCell(i).row : 0);
  const ahead = TRUE_PATH.find((t) => tileCell(t).row > row);
  return ahead ?? null;
}

/**
 * The layer a tile is drawn on (A5): LAYER_BOTH for a true tile, LAYER_EYE for a false one
 * (it is not in the glass), null for a gone tile (in neither). The view reads only this.
 */
export function tileLayer(tiles, tile) {
  const i = asIndex(tile);
  if (i < 0 || tiles.gone[i]) return null;
  return isTrue(i) ? LAYER_BOTH : LAYER_EYE;
}

/** Indices the glass shows (present and true). */
export function glassTiles(tiles) {
  return tiles.gone.map((g, i) => i).filter((i) => tileLayer(tiles, i) === LAYER_BOTH);
}

/** Indices only the eye sees (present and false). */
export function eyeOnlyTiles(tiles) {
  return tiles.gone.map((g, i) => i).filter((i) => tileLayer(tiles, i) === LAYER_EYE);
}
