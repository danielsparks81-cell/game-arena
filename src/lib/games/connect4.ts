/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export type C4Mark = 'R' | 'Y';
export type C4Cell = C4Mark | null;
export type C4State = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  board: C4Cell[][];          // [row][col], 6 rows x 7 cols, row 0 = top
  turn: C4Mark;
  winner: C4Mark | 'draw' | null;
  winningLine: { r: number; c: number }[] | null;
  lastMove: { r: number; c: number } | null;
  seats: { R?: string; Y?: string };
};

export const C4_ROWS = 6;
export const C4_COLS = 7;

export function initialState(): C4State {
  return {
    version: STATE_VERSION,
    board: Array.from({ length: C4_ROWS }, () => Array<C4Cell>(C4_COLS).fill(null)),
    turn: 'R',
    winner: null,
    winningLine: null,
    lastMove: null,
    seats: {},
  };
}

function findWin(board: C4Cell[][]): { mark: C4Mark; line: { r: number; c: number }[] } | null {
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      for (const [dr, dc] of dirs) {
        const line = [{ r, c }];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i, nc = c + dc * i;
          if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS || board[nr][nc] !== cell) break;
          line.push({ r: nr, c: nc });
        }
        if (line.length === 4) return { mark: cell, line };
      }
    }
  }
  return null;
}

export function applyMove(state: C4State, col: number, playerId: string): C4State | { error: string } {
  if (state.winner) return { error: 'Game over' };
  const expected = state.seats[state.turn];
  if (!expected) return { error: 'Seat not occupied' };
  if (expected !== playerId) return { error: 'Not your turn' };
  if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) return { error: 'Bad column' };

  // Find lowest empty row in this column
  let row = -1;
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (state.board[r][col] === null) { row = r; break; }
  }
  if (row === -1) return { error: 'Column full' };

  const board = state.board.map(r => r.slice());
  board[row][col] = state.turn;

  const win = findWin(board);
  const allFull = board.every(r => r.every(c => c !== null));
  const winner: C4State['winner'] = win ? win.mark : allFull ? 'draw' : null;

  // Spread state first so version (and any future top-level field) survives.
  return {
    ...state,
    board,
    turn: state.turn === 'R' ? 'Y' : 'R',
    winner,
    winningLine: win ? win.line : null,
    lastMove: { r: row, c: col },
  };
}
