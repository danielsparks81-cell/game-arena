import { describe, it, expect } from 'vitest';
import { initialState, applyMove, STATE_VERSION, type TTTState } from './tictactoe';

// A freshly-initialized state with both seats filled — the situation every
// real game starts in once joinRoom finishes assigning sides.
function seatedState(): TTTState {
  return {
    ...initialState(),
    seats: { X: 'user-x', O: 'user-o' },
  };
}

describe('tictactoe engine', () => {
  describe('initialState', () => {
    it('stamps the current state version', () => {
      expect(initialState().version).toBe(STATE_VERSION);
    });
    it('starts on X with an empty 9-cell board', () => {
      const s = initialState();
      expect(s.turn).toBe('X');
      expect(s.board).toHaveLength(9);
      expect(s.board.every(c => c === null)).toBe(true);
      expect(s.winner).toBeNull();
    });
  });

  describe('applyMove', () => {
    it('rejects when no seat is filled', () => {
      const s = initialState();
      const r = applyMove(s, 0, 'anyone');
      expect('error' in r).toBe(true);
    });

    it("rejects when it's not the player's turn", () => {
      const s = seatedState();
      const r = applyMove(s, 0, 'user-o');
      expect('error' in r).toBe(true);
    });

    it('places the mark and advances the turn', () => {
      const next = applyMove(seatedState(), 4, 'user-x');
      expect('error' in next).toBe(false);
      const ok = next as TTTState;
      expect(ok.board[4]).toBe('X');
      expect(ok.turn).toBe('O');
    });

    it('preserves state version through a move', () => {
      const next = applyMove(seatedState(), 4, 'user-x') as TTTState;
      expect(next.version).toBe(STATE_VERSION);
    });

    it('preserves seats through a move', () => {
      const next = applyMove(seatedState(), 4, 'user-x') as TTTState;
      expect(next.seats).toEqual({ X: 'user-x', O: 'user-o' });
    });

    it('detects a winner on the top row', () => {
      let s = seatedState();
      s = applyMove(s, 0, 'user-x') as TTTState;   // X
      s = applyMove(s, 3, 'user-o') as TTTState;   // O
      s = applyMove(s, 1, 'user-x') as TTTState;   // X
      s = applyMove(s, 4, 'user-o') as TTTState;   // O
      s = applyMove(s, 2, 'user-x') as TTTState;   // X wins
      expect(s.winner).toBe('X');
      expect(s.winningLine).toEqual([0, 1, 2]);
    });

    it('rejects moves after game is over', () => {
      let s = seatedState();
      // Force a finished state by giving X the top row.
      s.board = ['X', 'X', 'X', null, null, null, null, null, null];
      s.winner = 'X';
      const r = applyMove(s, 5, 'user-x');
      expect('error' in r).toBe(true);
    });

    it('rejects clicking a non-empty cell', () => {
      let s = seatedState();
      s = applyMove(s, 0, 'user-x') as TTTState;
      const r = applyMove(s, 0, 'user-o');
      expect('error' in r).toBe(true);
    });
  });
});
