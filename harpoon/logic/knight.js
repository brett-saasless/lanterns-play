// The Knight's Walk (R9, G7): the warden is the white knight on an 8 by 8 board of black
// pieces. Pure chess geometry: knight leaps, chess attacks with lines stopped by any piece
// between, the strongest attacker's strike on landing, captures (a taken piece stops
// attacking, but a defender still strikes), the cheapest route across, and the piece removed
// after a death. Squares are algebraic ('a1' to 'h8'): file a to the west, rank 1 to the
// south; the warden steps on from the south margin and wins on rank 8. Black pawns attack
// diagonally toward rank 1. State lives in sim.waves.board ({ at, pieces[] each { kind,
// square, taken } }); the opening position is data in keepmap.js; the Knight's Walk death
// counter is sim.waves.game.chessDeaths (A8). Nothing derived (routes, reachable squares) is
// stored. After a death the piece removed is the striker of the killing blow, or else the
// strongest other piece whose removal keeps the board crossable (G7's "next strongest", read
// board-wide); if no removal keeps it crossable, none is removed. STRIKE_EIGHTHS and
// MIN_PIECES agree with CASTLE_CONFIG.board (strikes, minPieces); knight.test.js checks it.

/** Each piece's strike as eighths of full health (R9): pawn 1/8 ... queen 1/2. */
export const STRIKE_EIGHTHS = Object.freeze({ pawn: 1, knight: 2, bishop: 2, rook: 3, queen: 4, king: 2 });

/** Order among pieces that strike alike (strongest first), so every choice is deterministic. */
export const STRENGTH_ORDER = Object.freeze(['queen', 'rook', 'bishop', 'knight', 'king', 'pawn']);

/** The fewest black pieces a reset may leave (G7). */
export const MIN_PIECES = 4;

/** The squares a knight can step onto from the south margin: the back rank's knight squares. */
export const START_SQUARES = Object.freeze(['b1', 'g1']);

const FULL = 8; // full health in eighths
const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** 'c6' -> { f: 2, r: 5 }, or null for anything that is not a square. */
export function parseSquare(sq) {
  if (typeof sq !== 'string' || sq.length !== 2) return null;
  const f = sq.charCodeAt(0) - 97;
  const r = sq.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return { f, r };
}

/** (file 0-7, rank 0-7) -> 'a1'..'h8', or null off the board. */
export function squareName(f, r) {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return String.fromCharCode(97 + f) + String(r + 1);
}

/** A fresh board from an opening position ([{ kind, square }]): the warden on the margin. */
export function createBoard(opening) {
  return { at: null, pieces: opening.map((p) => ({ kind: p.kind, square: p.square, taken: false })) };
}

/** The black pieces still standing (not taken). */
export function standing(board) {
  return board.pieces.filter((p) => !p.taken);
}

/** The standing piece on a square, or null. */
export function pieceAt(board, sq) {
  return board.pieces.find((p) => !p.taken && p.square === sq) || null;
}

/** True when the piece attacks the target square, its lines stopped by any standing piece. */
export function attacks(board, piece, target) {
  const a = parseSquare(piece.square);
  const t = parseSquare(target);
  if (!a || !t || piece.taken || piece.square === target) return false;
  const df = t.f - a.f;
  const dr = t.r - a.r;
  switch (piece.kind) {
    case 'pawn':
      return dr === -1 && Math.abs(df) === 1;
    case 'knight':
      return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    case 'king':
      return Math.max(Math.abs(df), Math.abs(dr)) === 1;
    case 'rook':
      return (df === 0 || dr === 0) && clearLine(board, a, t);
    case 'bishop':
      return Math.abs(df) === Math.abs(dr) && clearLine(board, a, t);
    case 'queen':
      return (df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr)) && clearLine(board, a, t);
    default:
      return false;
  }
}

function clearLine(board, a, t) {
  const sf = Math.sign(t.f - a.f);
  const sr = Math.sign(t.r - a.r);
  let f = a.f + sf;
  let r = a.r + sr;
  while (f !== t.f || r !== t.r) {
    if (pieceAt(board, squareName(f, r))) return false;
    f += sf;
    r += sr;
  }
  return true;
}

/** Sort key: higher strike first, then STRENGTH_ORDER, then square, so the choice is stable. */
function stronger(a, b) {
  const d = STRIKE_EIGHTHS[b.kind] - STRIKE_EIGHTHS[a.kind];
  if (d) return d;
  const o = STRENGTH_ORDER.indexOf(a.kind) - STRENGTH_ORDER.indexOf(b.kind);
  if (o) return o;
  return a.square < b.square ? -1 : a.square > b.square ? 1 : 0;
}

/** Every standing piece attacking the square, strongest first. */
export function attackersOf(board, sq) {
  return standing(board).filter((p) => attacks(board, p, sq)).sort(stronger);
}

/** The one piece that strikes a warden landing on sq (the strongest attacker), or null. */
export function strikeOn(board, sq) {
  return attackersOf(board, sq)[0] || null;
}

/** A piece's strike in health points, for full health maxHealth (default 100). */
export function strikeDamage(kind, maxHealth = 100) {
  return (STRIKE_EIGHTHS[kind] * maxHealth) / FULL;
}

/** The squares the warden may leap to now: b1 and g1 from the margin, else a knight's leaps. */
export function reachable(board) {
  if (board.at == null) return START_SQUARES.slice();
  const a = parseSquare(board.at);
  if (!a) return [];
  const out = [];
  for (const [df, dr] of KNIGHT_STEPS) {
    const s = squareName(a.f + df, a.r + dr);
    if (s) out.push(s);
  }
  return out.sort();
}

/** True when the square is on the far rank (rank 8). */
export function isFarRank(sq) {
  const p = parseSquare(sq);
  return !!p && p.r === 7;
}

/**
 * E on a glowing square. A square not offered does nothing (returns null, no events).
 * Otherwise: the warden moves; a standing black piece there is taken first; then the
 * strongest remaining attacker strikes. Events, in order: knightLeap { from, to }, capture { piece,
 * square } if a piece was taken, pieceStrike { piece, square (the striker's), to, damage } if
 * one strikes, walkWon {} if the landing is on rank 8 and the strike does not kill.
 * opts: { health (the warden's now, default maxHealth), maxHealth (default 100) }.
 * The caller applies the damage (the shipped hurtPlayer) and sets done.knight on won.
 * Returns { from, to, captured, striker, damage, lethal, won }.
 */
export function leap(board, to, events = [], opts = {}) {
  if (!reachable(board).includes(to)) return null;
  const maxHealth = opts.maxHealth ?? 100;
  const health = opts.health ?? maxHealth;
  const from = board.at;
  board.at = to;
  events.push({ type: 'knightLeap', from, to });
  const captured = pieceAt(board, to);
  if (captured) {
    captured.taken = true;
    events.push({ type: 'capture', piece: captured.kind, square: to });
  }
  const striker = strikeOn(board, to);
  const damage = striker ? strikeDamage(striker.kind, maxHealth) : 0;
  if (striker) events.push({ type: 'pieceStrike', piece: striker.kind, square: striker.square, to, damage });
  const lethal = damage > 0 && damage >= health;
  const won = isFarRank(to) && !lethal;
  if (won) events.push({ type: 'walkWon' });
  return { from, to, captured, striker, damage, lethal, won };
}

/** The warden steps back off the back rank to the south margin (only from rank 1). */
export function stepOff(board) {
  const p = parseSquare(board.at);
  if (!p || p.r !== 0) return false;
  board.at = null;
  return true;
}

/**
 * The cheapest way across from where the warden stands (or from the margin), with captures
 * changing the board as they would in play. opts: { captures (default true): false forbids
 * landing on a piece; maxHealth (default 100) }. Returns { cost (health points), eighths,
 * path: [squares], captures: [squares] }, or null if rank 8 cannot be reached. A null in
 * path is a step back off rank 1 to the south margin (the next square is then b1 or g1).
 * Ties go to the shorter route, then to the alphabetically first. Searches every set of
 * taken pieces.
 */
export function bestRoute(board, opts = {}) {
  const allowCaptures = opts.captures !== false;
  const maxHealth = opts.maxHealth ?? 100;
  const pieces = board.pieces;
  const startMask = pieces.reduce((m, p, i) => (p.taken ? m | (1 << i) : m), 0);
  const key = (sq, mask) => (sq || '--') + ':' + mask;
  const view = { pieces: pieces.map((p) => ({ ...p })), at: null };
  const setMask = (mask) => view.pieces.forEach((p, i) => { p.taken = !!(mask & (1 << i)); });
  const best = new Map();
  const start = { sq: board.at, mask: startMask, cost: 0, len: 0, path: [], caps: [] };
  best.set(key(board.at, startMask), start);
  const open = [start];
  let found = null;
  const better = (a, b) => a.cost !== b.cost ? a.cost < b.cost
    : a.len !== b.len ? a.len < b.len : a.path.map(String).join() < b.path.map(String).join();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (better(open[i], open[bi])) bi = i;
    const cur = open.splice(bi, 1)[0];
    const k = key(cur.sq, cur.mask);
    if (best.get(k) !== cur) continue; // a stale entry: a cheaper way here was found later
    if (cur.sq && isFarRank(cur.sq)) { found = cur; break; }
    setMask(cur.mask);
    view.at = cur.sq;
    for (const to of reachable(view)) {
      setMask(cur.mask);
      let mask = cur.mask;
      const caps = cur.caps.slice();
      const idx = view.pieces.findIndex((p) => !p.taken && p.square === to);
      if (idx >= 0) {
        if (!allowCaptures) continue;
        mask |= 1 << idx;
        caps.push(to);
        setMask(mask);
      }
      const s = strikeOn(view, to);
      const step = s ? STRIKE_EIGHTHS[s.kind] : 0;
      const next = { sq: to, mask, cost: cur.cost + step, len: cur.len + 1, path: cur.path.concat(to), caps };
      const nk = key(to, mask);
      const prev = best.get(nk);
      if (!prev || better(next, prev)) {
        best.set(nk, next);
        open.push(next);
      }
    }
    // from the back rank the warden may step off to the margin (and come on at b1 or g1)
    if (cur.sq && parseSquare(cur.sq).r === 0) {
      const off = { sq: null, mask: cur.mask, cost: cur.cost, len: cur.len + 1, path: cur.path.concat(null), caps: cur.caps };
      const ok = key(null, cur.mask);
      const prev = best.get(ok);
      if (!prev || better(off, prev)) {
        best.set(ok, off);
        open.push(off);
      }
    }
  }
  if (!found) return null;
  return { cost: (found.cost * maxHealth) / FULL, eighths: found.cost, path: found.path, captures: found.caps };
}

/** A board set fresh from the margin with only these pieces (all standing). */
function freshWith(pieces) {
  return { at: null, pieces: pieces.map((p) => ({ kind: p.kind, square: p.square, taken: false })) };
}

/** G7's "crossable": from the margin, some route to rank 8 costs less than full health. */
export function crossable(board) {
  const r = bestRoute(freshWith(board.pieces));
  return !!r && r.eighths < FULL;
}

/**
 * The piece removed after a Knight's Walk death (G7): the one that struck the killing blow
 * (killer: a piece object or its square), or, if removing it would leave the board
 * uncrossable, the next strongest whose removal keeps it crossable. "Next strongest" is read
 * board-wide: the strongest of all the other pieces (STRIKE_EIGHTHS, then STRENGTH_ORDER,
 * then square), not the next below the striker. If no single removal keeps the board
 * crossable, nothing is removed: a removal can open a line and make the board harder, so a
 * removal is never forced. (From the opening position every subset of four or more is
 * crossable, so this never happens in play; knight.test.js proves it.) Returns the piece
 * from board.pieces, or null if the board already has MIN_PIECES or fewer or no removal
 * keeps it crossable.
 */
export function pieceToRemove(board, killer) {
  if (board.pieces.length <= MIN_PIECES) return null;
  const killSq = killer && typeof killer === 'object' ? killer.square : killer;
  const k = board.pieces.find((p) => p.square === killSq) || null;
  const rest = board.pieces.filter((p) => p !== k).sort(stronger);
  const order = k ? [k, ...rest] : rest;
  for (const cand of order) {
    if (crossable(freshWith(board.pieces.filter((p) => p !== cand)))) return cand;
  }
  return null;
}

/**
 * True when a death counts toward chessDeaths (A8): the warden was on the Knight's Walk board
 * or its margins (onWalk) and the board is unsolved (done.knight false).
 */
export function isChessDeath(where) {
  return !!(where && where.onWalk && !(where.done && where.done.knight));
}

/**
 * A death, as the Knight's Walk sees it. game: sim.waves.game ({ chessDeaths }); where:
 * { onWalk, done, killer }. A death that is not a chess death (A8) changes nothing and returns
 * the board as it was. A chess death adds one to game.chessDeaths and returns the board set
 * again: every piece standing, the warden on the margin, and one piece fewer (pieceToRemove)
 * while more than MIN_PIECES remain, so the board holds max(4, opening - chessDeaths) pieces
 * (in the never-seen case where no removal keeps the board crossable, the count stays as it
 * was for that death).
 * Returns { board, removed, counted }.
 */
export function boardAfterDeath(board, game, where = {}) {
  if (!isChessDeath(where)) return { board, removed: null, counted: false };
  game.chessDeaths = (game.chessDeaths || 0) + 1;
  const fresh = freshWith(board.pieces);
  const removed = pieceToRemove(fresh, where.killer);
  if (removed) fresh.pieces = fresh.pieces.filter((p) => p !== removed);
  return { board: fresh, removed: removed ? { kind: removed.kind, square: removed.square } : null, counted: true };
}
