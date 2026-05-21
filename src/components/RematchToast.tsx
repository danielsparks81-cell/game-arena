'use client';

import { useEffect, useState, useTransition } from 'react';
import { proposeRematch } from '@/app/rooms/[id]/actions';

/**
 * Floating top-of-screen toast that appears when the current game finishes
 * (mirrors the invite-toast pattern in MembersPanel). Lets a seated player
 * cast / withdraw their rematch vote and see who else has agreed. Auto-hides
 * if the player dismisses it for this game, and reappears for the next.
 */
export default function RematchToast({
  roomId,
  finished,
  imSeated,
  iVoted,
  voteTally,
  totalSeated,
  otherSeated,
  unvotedOthers,
  allOthersVoted,
}: {
  roomId: string;
  finished: boolean;
  imSeated: boolean;
  iVoted: boolean;
  voteTally: number;
  totalSeated: number;
  /** Seated players other than me. */
  otherSeated: { player_id: string; profiles: { username: string } | null }[];
  /** Subset of otherSeated that hasn't voted yet. */
  unvotedOthers: { player_id: string; profiles: { username: string } | null }[];
  /** All non-me players have voted. */
  allOthersVoted: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Dismissal is per-game-end: if the user dismisses, hide until the next game
  // finishes (status flips). We reset whenever `finished` transitions false→true.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!finished) setDismissed(false);
  }, [finished]);

  if (!finished || !imSeated || dismissed) return null;

  const subline = otherSeated.length === 0
    ? 'No opponents in room'
    : allOthersVoted
      ? 'All players ready ✓ — starting…'
      : `Waiting on: ${unvotedOthers.map(p => p.profiles?.username ?? 'opponent').join(', ')}`;

  return (
    <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-toast-in">
      <div className="flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-emerald-500/40 bg-neutral-900 px-4 py-3 shadow-xl shadow-emerald-500/20">
        <span className="text-2xl">🔁</span>
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">
            <span className="text-emerald-400">Rematch?</span>{' '}
            <span className="text-neutral-300">All players need to agree.</span>
          </div>
          <div className="mt-0.5 text-xs text-neutral-400">{subline}</div>
        </div>
        <button
          disabled={pending || iVoted}
          onClick={() => startTransition(() => { proposeRematch(roomId); })}
          className="shrink-0 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {iVoted ? `✓ Ready ${voteTally}/${totalSeated}` : `Rematch ${voteTally}/${totalSeated}`}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
