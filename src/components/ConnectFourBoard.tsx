'use client';

import { type C4State, C4_COLS, C4_ROWS } from '@/lib/games/connect4';

export default function ConnectFourBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: C4State; currentUserId: string; disabled: boolean; onMove: (col: number) => void;
}) {
  const yourMark = state.seats.R === currentUserId ? 'R' : state.seats.Y === currentUserId ? 'Y' : null;
  const yourTurn = yourMark && state.turn === yourMark && !state.winner;

  const isWinning = (r: number, c: number) =>
    !!state.winningLine?.some(cell => cell.r === r && cell.c === c);

  const colFull = (col: number) => state.board[0][col] !== null;

  const statusText = state.winner
    ? state.winner === 'draw'
      ? 'Draw!'
      : `${state.winner === 'R' ? 'Red' : 'Yellow'} wins! 🎉`
    : yourMark
      ? (yourTurn
          ? `Your turn (${yourMark === 'R' ? 'Red' : 'Yellow'})`
          : `Waiting on ${state.turn === 'R' ? 'Red' : 'Yellow'}…`)
      : `Spectating · ${state.turn === 'R' ? 'Red' : 'Yellow'}'s turn`;

  return (
    <div>
      <div className="mb-3 text-center text-sm text-neutral-400">{statusText}</div>

      <div className="mx-auto w-fit rounded-xl bg-gradient-to-b from-blue-700 to-blue-900 p-3 shadow-2xl">
        {/* Drop buttons */}
        <div
          className="mb-1 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${C4_COLS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: C4_COLS }, (_, c) => (
            <button
              key={c}
              disabled={disabled || !yourTurn || colFull(c)}
              onClick={() => onMove(c)}
              aria-label={`Drop in column ${c + 1}`}
              className="h-6 rounded text-xs text-blue-200 transition hover:bg-blue-800 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▼
            </button>
          ))}
        </div>

        {/* Board */}
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${C4_COLS}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: C4_ROWS * C4_COLS }, (_, idx) => {
            const r = Math.floor(idx / C4_COLS);
            const c = idx % C4_COLS;
            const cell = state.board[r][c];
            const winning = isWinning(r, c);
            const isLastMove = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
            return (
              <button
                key={idx}
                disabled={disabled || !yourTurn || colFull(c)}
                onClick={() => onMove(c)}
                className="aspect-square w-9 rounded-full bg-blue-950 shadow-inner transition sm:w-12 disabled:cursor-default"
              >
                {cell ? (
                  <span
                    key={`${cell}-${r}-${c}`}
                    className={`block h-full w-full rounded-full transition ${
                      cell === 'R'
                        ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-lg shadow-red-900/40'
                        : 'bg-gradient-to-br from-yellow-300 to-yellow-500 shadow-lg shadow-yellow-900/40'
                    } ${winning ? 'ring-4 ring-emerald-400 animate-win-pulse' : ''} ${isLastMove ? 'animate-drop-in' : ''}`}
                    style={isLastMove ? ({ ['--drop-from' as string]: `-${(r + 1) * 100}%` } as React.CSSProperties) : undefined}
                  />
                ) : (
                  <span className="block h-full w-full rounded-full bg-neutral-900/80" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
