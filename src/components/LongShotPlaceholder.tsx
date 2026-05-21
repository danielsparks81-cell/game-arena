'use client';

/**
 * Pre-race waiting panel for Long Shot. Replaced by the LongShotBoard the
 * moment status flips to `playing`. Host gets a Start button once 2+ seats
 * are filled; everyone else sees "waiting for host" copy.
 */
export default function LongShotPlaceholder({
  status, maxPlayers, playerCount, isHost, pending, onStart,
}: {
  status: string;
  maxPlayers: number;
  playerCount: number;
  isHost: boolean;
  pending: boolean;
  onStart: () => void;
}) {
  const canStart = isHost && status === 'waiting' && playerCount >= 2;

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      {status === 'waiting' ? (
        <>
          <div>
            <h3 className="text-lg font-semibold">Waiting for players</h3>
            <p className="mt-1 text-sm text-neutral-400">
              Up to {maxPlayers} players. Share the room link or invite friends from the panel.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canStart ? (
              <button
                onClick={onStart}
                disabled={pending}
                className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Start race ({playerCount} {playerCount === 1 ? 'player' : 'players'})
              </button>
            ) : isHost ? (
              <span className="text-sm text-neutral-500">Need at least 2 seated players to start.</span>
            ) : (
              <span className="text-sm text-neutral-500">Waiting for the host to start the race…</span>
            )}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-700 p-6 text-center">
          <h3 className="text-lg font-semibold">🏇 Race in progress</h3>
          <p className="mt-2 text-sm text-neutral-400">
            The Long Shot race UI ships in the next deploy. Game state is being tracked in the background.
          </p>
        </div>
      )}
    </div>
  );
}
