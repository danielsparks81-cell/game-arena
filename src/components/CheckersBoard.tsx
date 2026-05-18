'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ROWS, COLS, simpleMovesFrom, capturesFrom, anyCapturesAvailable,
  type CheckersState, type Color,
} from '@/lib/games/checkers';

export default function CheckersBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: CheckersState;
  currentUserId: string;
  disabled: boolean;
  onMove: (from: [number, number], to: [number, number]) => void;
}) {
  const yourColor: Color | null =
    state.seats.R === currentUserId ? 'R'
    : state.seats.B === currentUserId ? 'B'
    : null;
  const yourTurn = !!yourColor && state.turn === yourColor && !state.winner && !disabled;
  // Flip the board 180° for the Black player so their pieces are always at the bottom.
  // Spectators get the default (Red at bottom) view.
  const flip = yourColor === 'B';

  // Selected piece (row, col) — null = no selection
  const [selected, setSelected] = useState<[number, number] | null>(null);

  // If the engine sets mustChainFrom, force-select that piece (player must continue with it)
  useEffect(() => {
    if (state.mustChainFrom) setSelected(state.mustChainFrom);
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lastMove, state.mustChainFrom?.[0], state.mustChainFrom?.[1]]);

  // If the player is forced into a capture, only highlight captures; otherwise show all legal moves.
  const legalMoves = useMemo<[number, number][]>(() => {
    if (!selected || !yourTurn) return [];
    const [r, c] = selected;
    const captures = capturesFrom(state.board, r, c).map(x => x.to);
    const forced = !!state.mustChainFrom || anyCapturesAvailable(state.board, state.turn);
    if (forced) return captures;
    const simple = simpleMovesFrom(state.board, r, c);
    return [...captures, ...simple];
  }, [selected, yourTurn, state.board, state.turn, state.mustChainFrom]);

  const onCellClick = (r: number, c: number) => {
    if (!yourTurn) return;
    const piece = state.board[r][c];
    if (selected) {
      // Try to move
      if (legalMoves.some(([lr, lc]) => lr === r && lc === c)) {
        onMove(selected, [r, c]);
        return;
      }
      // Re-select another own piece if we're not mid-chain
      if (!state.mustChainFrom && piece && piece.color === yourColor) {
        setSelected([r, c]);
        return;
      }
      // Otherwise deselect (unless mid-chain — then stay locked)
      if (!state.mustChainFrom) setSelected(null);
      return;
    }
    if (piece && piece.color === yourColor) setSelected([r, c]);
  };

  const statusText = state.winner
    ? state.winner === 'draw'
      ? 'Draw!'
      : `${state.winner === 'R' ? 'Red' : 'Black'} wins!`
    : !yourColor ? `Turn: ${state.turn === 'R' ? 'Red' : 'Black'} (watching)`
    : yourTurn
      ? state.mustChainFrom ? 'Continue your capture chain!' : 'Your turn'
      : `Waiting on ${state.turn === 'R' ? 'Red' : 'Black'}…`;

  const youAreLabel = yourColor === 'R' ? 'You are Red' : yourColor === 'B' ? 'You are Black' : 'Spectator';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{statusText}</span>
        {yourColor && (
          <span className={`rounded px-2 py-0.5 text-xs ${
            yourColor === 'R' ? 'bg-red-500/15 text-red-300' : 'bg-neutral-700/40 text-neutral-300'
          }`}>{youAreLabel}</span>
        )}
      </div>

      {/* Board */}
      <div
        className="mx-auto inline-grid overflow-hidden rounded-lg border-2 border-neutral-800 shadow-lg"
        style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, width: 'min(100%, 480px)' }}
      >
        {Array.from({ length: ROWS }).flatMap((_, dr) =>
          Array.from({ length: COLS }, (_, dc) => {
            // Translate display (dr, dc) → data (r, c). Selection + onMove always use data coords.
            const r = flip ? ROWS - 1 - dr : dr;
            const c = flip ? COLS - 1 - dc : dc;
            const cell = state.board[r][c];
            const isDark = (r + c) % 2 === 1;
            const isSelected = selected && selected[0] === r && selected[1] === c;
            const isLegal = legalMoves.some(([lr, lc]) => lr === r && lc === c);
            const fromHighlight = state.lastMove && state.lastMove.from[0] === r && state.lastMove.from[1] === c;
            const toHighlight   = state.lastMove && state.lastMove.to[0]   === r && state.lastMove.to[1]   === c;
            return (
              <button
                key={`${r}-${c}`}
                onClick={() => onCellClick(r, c)}
                disabled={!isDark || !yourTurn}
                className={`relative aspect-square w-full transition ${
                  isDark
                    ? 'bg-[#7c2d12] hover:brightness-110'
                    : 'bg-[#fef3c7]'
                } ${isLegal ? 'ring-4 ring-inset ring-emerald-400' : ''} ${
                  isSelected ? 'ring-4 ring-inset ring-amber-300' : ''
                } ${fromHighlight || toHighlight ? 'shadow-inner shadow-emerald-500/30' : ''}`}
                aria-label={cell ? `${cell.color === 'R' ? 'Red' : 'Black'}${cell.king ? ' king' : ''} at row ${r + 1}, col ${c + 1}` : `Empty ${r + 1},${c + 1}`}
              >
                {cell && <PieceView color={cell.color} king={cell.king} />}
                {/* Dot in the center of empty legal-move squares so the target is obvious */}
                {isLegal && !cell && (
                  <span className="pointer-events-none absolute inset-0 m-auto h-3 w-3 rounded-full bg-emerald-400/80" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function PieceView({ color, king }: { color: Color; king: boolean }) {
  // Red piece = bright red; Black = dark with subtle highlight. Kings get a crown.
  const fillBg = color === 'R' ? 'bg-red-600' : 'bg-neutral-900';
  const ringClr = color === 'R' ? 'ring-red-300' : 'ring-neutral-600';
  return (
    <span className="pointer-events-none absolute inset-1 flex items-center justify-center">
      <span className={`flex h-full w-full items-center justify-center rounded-full ${fillBg} ring-2 ring-inset ${ringClr} shadow-md`}>
        {king && <span className="text-base font-bold text-amber-300" aria-hidden>♛</span>}
      </span>
    </span>
  );
}
