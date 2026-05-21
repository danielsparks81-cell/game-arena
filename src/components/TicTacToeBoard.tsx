'use client';

import type { TTTState } from '@/lib/games/tictactoe';

export default function TicTacToeBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: TTTState; currentUserId: string; disabled: boolean; onMove: (i: number) => void;
}) {
  const yourMark = state.seats.X === currentUserId ? 'X' : state.seats.O === currentUserId ? 'O' : null;
  const yourTurn = yourMark && state.turn === yourMark && !state.winner;
  const winning = new Set(state.winningLine ?? []);

  const statusText = state.winner
    ? state.winner === 'draw' ? 'Draw!' : `${state.winner} wins! 🎉`
    : yourMark
      ? (yourTurn ? `Your turn (${yourMark})` : `Waiting on ${state.turn}…`)
      : `Spectating · ${state.turn}'s turn`;

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">{statusText}</div>
      <div className="mx-auto grid w-72 grid-cols-3 gap-2 sm:w-96">
        {state.board.map((cell, i) => {
          const isWin = winning.has(i);
          return (
            <button
              key={i}
              disabled={disabled || !yourTurn || cell !== null}
              onClick={() => onMove(i)}
              className={`group flex aspect-square items-center justify-center rounded-xl border p-4 shadow-inner transition ${
                isWin
                  ? 'border-emerald-400 bg-emerald-500/10 animate-win-pulse'
                  : 'border-neutral-800 bg-gradient-to-br from-neutral-900 to-neutral-950 hover:border-emerald-500 hover:from-neutral-800 disabled:hover:border-neutral-800 disabled:hover:from-neutral-900'
              }`}
            >
              {cell === 'X' && (
                <svg key={`X-${i}`} viewBox="0 0 24 24" className="h-full w-full text-emerald-400 animate-piece-in">
                  <line x1="5"  y1="5"  x2="19" y2="19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  <line x1="19" y1="5"  x2="5"  y2="19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {cell === 'O' && (
                <svg key={`O-${i}`} viewBox="0 0 24 24" className="h-full w-full text-sky-400 animate-piece-in">
                  <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="3" fill="none" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
