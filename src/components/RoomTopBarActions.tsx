'use client';

import { useState, useTransition } from 'react';
import { resignGame, voteAbandon } from '@/app/rooms/[id]/actions';
import NotificationBell from './NotificationBell';
import SoundToggle from './SoundToggle';

/**
 * Lives in the TopBar center while you're in a live game room. Renders:
 *   • Resign — instant loss for the clicker, opponent wins (2-player only).
 *   • Propose Abandon — toggleable vote. When every seated player has voted,
 *     the game ends with NO W/L recorded. Shows current vote tally so you
 *     know who's already agreed.
 *
 * Hidden entirely when the game is not in `playing` status or when the viewer
 * isn't seated. The parent (RoomClient) decides whether to render this.
 */
export default function RoomTopBarActions({
  roomId,
  isTwoPlayerGame,
  abandonVotes,
  seatedCount,
  iVoted,
}: {
  roomId: string;
  /** Resign is hidden in 3+ player games (use Propose Abandon instead). */
  isTwoPlayerGame: boolean;
  /** Number of seated players who've voted to abandon. */
  abandonVotes: number;
  /** Total seated players (denominator for the vote tally). */
  seatedCount: number;
  /** Has the current user already voted to abandon? */
  iVoted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingResign, setConfirmingResign] = useState(false);

  return (
    <>
      <SoundToggle />
      <NotificationBell />
      {isTwoPlayerGame && (
        <button
          disabled={pending}
          onClick={() => setConfirmingResign(true)}
          className="rounded-md border border-rose-700/60 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-50 sm:text-sm"
        >
          Resign
        </button>
      )}

      <button
        disabled={pending}
        onClick={() => startTransition(() => { voteAbandon(roomId); })}
        title={iVoted
          ? 'Click to withdraw your vote'
          : 'Asks everyone to end the game with no W/L recorded'}
        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 sm:text-sm ${
          iVoted
            ? 'border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
            : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800'
        }`}
      >
        {iVoted ? '✓ Abandoning' : 'Propose abandon'}
        {abandonVotes > 0 && (
          <span className="ml-1.5 rounded bg-neutral-950/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
            {abandonVotes}/{seatedCount}
          </span>
        )}
      </button>

      {confirmingResign && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-neutral-950/70 p-4"
          onClick={() => setConfirmingResign(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-rose-300">Resign this game?</h3>
            <p className="mt-1 text-sm text-neutral-400">
              You&apos;ll take the loss and your opponent will be credited with the win. This counts
              toward your W/L record.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                disabled={pending}
                onClick={() => {
                  setConfirmingResign(false);
                  startTransition(() => { resignGame(roomId); });
                }}
                className="flex-1 rounded-md bg-rose-500 px-4 py-2 text-sm font-bold text-neutral-950 hover:bg-rose-400 disabled:opacity-50"
              >
                Yes, resign
              </button>
              <button
                onClick={() => setConfirmingResign(false)}
                className="flex-1 rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
