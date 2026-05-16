export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type TTTState = {
  board: Cell[];           // length 9
  turn: Mark;              // whose turn it is
  winner: Mark | 'draw' | null;
  seats: { X?: string; O?: string }; // player ids by seat
};

export function initialState(): TTTState {
  return { board: Array(9).fill(null), turn: 'X', winner: null, seats: {} };
}

const LINES: number[][] = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

export function checkWinner(board: Cell[]): Mark | 'draw' | null {
  for (const [a,b,c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(c => c !== null)) return 'draw';
  return null;
}

export function applyMove(state: TTTState, cell: number, playerId: string): TTTState | { error: string } {
  if (state.winner) return { error: 'Game over' };
  const expectedPlayer = state.seats[state.turn];
  if (!expectedPlayer) return { error: 'Seat not occupied' };
  if (expectedPlayer !== playerId) return { error: "Not your turn" };
  if (cell < 0 || cell > 8) return { error: 'Bad cell' };
  if (state.board[cell] !== null) return { error: 'Cell taken' };

  const board = state.board.slice();
  board[cell] = state.turn;
  const winner = checkWinner(board);
  return {
    board,
    turn: state.turn === 'X' ? 'O' : 'X',
    winner,
    seats: state.seats,
  };
}
