// American checkers (draughts) — 8×8 board, 12 pieces per side, forced captures.
// Red sits at the bottom (rows 5-7) and moves first (up the board).
// Black sits at the top (rows 0-2) and moves down. Reach the opposite back row → king.

export const ROWS = 8;
export const COLS = 8;

export type Color = 'R' | 'B';
export type Piece = { color: Color; king: boolean };
export type Cell = Piece | null;

export type CheckersMove = {
  from: [number, number];
  to: [number, number];
  /** All opposing pieces captured during this turn (one entry per jump in a chain). */
  captured: [number, number][];
};

export type CheckersState = {
  board: Cell[][];                                // [row][col], 8×8
  turn: Color;
  winner: Color | 'draw' | null;
  seats: { R?: string; B?: string };
  lastMove: CheckersMove | null;
  /** If set, the same piece must continue capturing (multi-jump). null = pick any piece. */
  mustChainFrom: [number, number] | null;
};

export function initialState(): CheckersState {
  const board: Cell[][] = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
  // Black on top (rows 0-2), Red on bottom (rows 5-7). Pieces sit only on dark squares
  // (where (row + col) is odd).
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: 'B', king: false };
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 1) board[r][c] = { color: 'R', king: false };
    }
  }
  return { board, turn: 'R', winner: null, seats: {}, lastMove: null, mustChainFrom: null };
}

function inBounds(r: number, c: number) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

function directionsFor(piece: Piece): [number, number][] {
  if (piece.king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return piece.color === 'R' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

/** Empty squares 1 diagonal step from (r,c) in this piece's legal direction(s). */
export function simpleMovesFrom(board: Cell[][], r: number, c: number): [number, number][] {
  const piece = board[r][c];
  if (!piece) return [];
  const out: [number, number][] = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === null) out.push([nr, nc]);
  }
  return out;
}

/** Single-jump captures available from (r,c). Each entry includes the landing square and
 *  the opposing piece that gets removed. Chains are resolved one jump at a time. */
export function capturesFrom(
  board: Cell[][], r: number, c: number,
): { to: [number, number]; captured: [number, number] }[] {
  const piece = board[r][c];
  if (!piece) return [];
  const out: { to: [number, number]; captured: [number, number] }[] = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const mr = r + dr, mc = c + dc;
    const tr = r + dr * 2, tc = c + dc * 2;
    if (!inBounds(tr, tc)) continue;
    const mid = board[mr][mc];
    if (!mid || mid.color === piece.color) continue;
    if (board[tr][tc] === null) out.push({ to: [tr, tc], captured: [mr, mc] });
  }
  return out;
}

/** Does `color` have any capture available on the board right now? */
export function anyCapturesAvailable(board: Cell[][], color: Color): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.color === color && capturesFrom(board, r, c).length > 0) return true;
    }
  }
  return false;
}

function hasAnyLegalMove(board: Cell[][], color: Color): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      if (capturesFrom(board, r, c).length > 0) return true;
      if (simpleMovesFrom(board, r, c).length > 0) return true;
    }
  }
  return false;
}

/**
 * Apply one move (simple step or one capture). If the move was a capture AND the same
 * piece has further captures from its landing square AND it didn't just get crowned,
 * the state keeps the same turn and sets `mustChainFrom` to the landing square so the
 * client knows the player must continue with that piece.
 */
export function applyMove(
  state: CheckersState,
  from: [number, number],
  to: [number, number],
  playerId: string,
): CheckersState | { error: string } {
  if (state.winner) return { error: 'Game over' };
  const expected = state.seats[state.turn];
  if (!expected) return { error: 'Seat not occupied' };
  if (expected !== playerId) return { error: 'Not your turn' };

  const [fr, fc] = from;
  const [tr, tc] = to;
  if (!inBounds(fr, fc) || !inBounds(tr, tc)) return { error: 'Out of bounds' };
  const piece = state.board[fr][fc];
  if (!piece) return { error: 'No piece at source' };
  if (piece.color !== state.turn) return { error: 'Not your piece' };
  if (state.board[tr][tc] !== null) return { error: 'Target square is occupied' };

  // If mid-chain, only that piece can move
  if (state.mustChainFrom) {
    const [cr, cc] = state.mustChainFrom;
    if (fr !== cr || fc !== cc) return { error: 'You must continue the capture chain' };
  }

  const dr = tr - fr;
  const dc = tc - fc;
  const isSimple = Math.abs(dr) === 1 && Math.abs(dc) === 1;
  const isCapture = Math.abs(dr) === 2 && Math.abs(dc) === 2;
  if (!isSimple && !isCapture) return { error: 'Move must be one or two diagonal squares' };

  if (!piece.king) {
    const forward = piece.color === 'R' ? -1 : 1;
    if (Math.sign(dr) !== forward) return { error: 'Regular pieces only move forward' };
  }

  // Forced-capture rule: if any of your pieces could capture, simple moves are illegal.
  // (When mid-chain, you've already chosen to capture, so this check is skipped.)
  if (isSimple && !state.mustChainFrom && anyCapturesAvailable(state.board, piece.color)) {
    return { error: 'A capture is available — you must take it' };
  }

  let capturedSq: [number, number] | null = null;
  if (isCapture) {
    const mr = fr + dr / 2;
    const mc = fc + dc / 2;
    const mid = state.board[mr][mc];
    if (!mid || mid.color === piece.color) return { error: 'No opponent piece to jump' };
    capturedSq = [mr, mc];
  }

  // Build the next board state immutably
  const board = state.board.map(row => row.slice());
  board[fr][fc] = null;
  if (capturedSq) board[capturedSq[0]][capturedSq[1]] = null;

  let moved: Piece = piece;
  let promoted = false;
  const reachedBack = (piece.color === 'R' && tr === 0) || (piece.color === 'B' && tr === ROWS - 1);
  if (!piece.king && reachedBack) {
    moved = { color: piece.color, king: true };
    promoted = true;
  }
  board[tr][tc] = moved;

  // Combine with any prior chain captures so lastMove always reflects the full turn
  const priorCaptures =
    state.mustChainFrom && state.lastMove ? state.lastMove.captured : [];
  const lastMove: CheckersMove = {
    from: state.mustChainFrom ? (state.lastMove?.from ?? [fr, fc]) : [fr, fc],
    to: [tr, tc],
    captured: capturedSq ? [...priorCaptures, capturedSq] : [...priorCaptures],
  };

  // Decide whether the same piece continues capturing
  let nextChain: [number, number] | null = null;
  let nextTurn: Color = state.turn === 'R' ? 'B' : 'R';
  if (isCapture && !promoted && capturesFrom(board, tr, tc).length > 0) {
    nextChain = [tr, tc];
    nextTurn = state.turn;
  }

  // Win detection — opponent wiped out or stuck with no legal move
  let winner: Color | 'draw' | null = null;
  const oppColor: Color = piece.color === 'R' ? 'B' : 'R';
  const oppHasAny = board.some(row => row.some(c => c && c.color === oppColor));
  if (!oppHasAny) {
    winner = piece.color;
  } else if (nextTurn !== state.turn && !hasAnyLegalMove(board, oppColor)) {
    winner = piece.color;
  }

  return { board, turn: nextTurn, winner, seats: state.seats, lastMove, mustChainFrom: nextChain };
}
