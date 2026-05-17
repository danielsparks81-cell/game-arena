'use client';

import {
  type LSState, TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES,
} from '@/lib/games/longshot';

export default function LongShotBoard({
  state, currentUserId, disabled, onRoll,
}: {
  state: LSState;
  currentUserId: string;
  disabled: boolean;
  onRoll: () => void;
}) {
  const activePlayer = state.players.find(p => p.seat === state.activePlayerSeat);
  const me = state.players.find(p => p.playerId === currentUserId);
  const isMyTurn = me && state.activePlayerSeat === me.seat && state.step === 'roll';

  const winners = state.horses
    .map((h, i) => ({ num: i + 1, ...h }))
    .filter(h => h.finished)
    .sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0));

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">Round {state.round}</div>
          <div className="text-sm">
            Active: <span className="font-semibold text-emerald-400">{activePlayer?.username ?? '—'}</span>
            {isMyTurn && <span className="ml-2 text-xs text-emerald-400">(you)</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Die label="Horse" value={state.horseDie} color="bg-amber-500 text-neutral-950" max={8} />
          <Die label="Move"  value={state.movementDie} color="bg-emerald-500 text-neutral-950" max={6} />
          {state.phase === 'playing' && (
            <button
              onClick={onRoll}
              disabled={disabled || !isMyTurn}
              className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-40"
              title={isMyTurn ? 'Roll both dice' : 'Not your turn'}
            >
              🎲 Roll
            </button>
          )}
          {state.phase === 'finished' && (
            <span className="rounded-md bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-400">
              🏁 Race over
            </span>
          )}
        </div>
      </div>

      {/* Track */}
      <Track horses={state.horses} />

      {/* Winners */}
      {winners.length > 0 && (
        <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">Winner&apos;s Circle</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {winners.map(w => (
              <div key={w.num} className="flex items-center gap-2">
                <span className="text-neutral-400">{w.finished === 1 ? '🥇' : w.finished === 2 ? '🥈' : '🥉'}</span>
                <HorseDot num={w.num} />
                <span>Horse {w.num}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Players */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Players</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {state.players.map(p => {
            const isActive = p.seat === state.activePlayerSeat;
            const isYou = p.playerId === currentUserId;
            return (
              <div
                key={p.playerId}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                  isActive ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-neutral-800 bg-neutral-950'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{p.username}</span>
                  {isYou  && <span className="text-xs text-neutral-500">(you)</span>}
                  {isActive && <span className="text-xs text-emerald-400">●</span>}
                </div>
                <span className="font-mono text-emerald-400">${p.money}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event log */}
      {state.log.length > 0 && (
        <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm" open>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Race log
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {[...state.log].reverse().map((line, i) => (
              <li key={i} className="text-neutral-300">{line}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Phase 1 disclaimer */}
      <p className="text-center text-xs text-neutral-600">
        Phase 1 build: rolling + movement only. Bets, buys, helmets, jerseys, concessions ship next.
      </p>
    </div>
  );
}

function Die({ label, value, color, max }: { label: string; value: number | null; color: string; max: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-md font-bold shadow-md ${
        value !== null ? color : 'bg-neutral-800 text-neutral-600'
      }`}>
        {value ?? '?'}
      </div>
      <span className="mt-0.5 text-[9px] text-neutral-600">d{max}</span>
    </div>
  );
}

function HorseDot({ num }: { num: number }) {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow"
      style={{ backgroundColor: HORSE_COLORS[num - 1] }}
    >
      {num}
    </span>
  );
}

function Track({ horses }: { horses: LSState['horses'] }) {
  // Group horses by position (0 = start, TRACK_LENGTH = finished)
  const byPos = new Map<number, number[]>();
  horses.forEach((h, i) => {
    if (h.finished) return;
    const list = byPos.get(h.position) ?? [];
    list.push(i + 1);
    byPos.set(h.position, list);
  });

  // Generate spaces: 0 = Start/Finish line, 1..TRACK_LENGTH-1 = mid-track, TRACK_LENGTH = past finish
  const spaces: number[] = [];
  for (let i = 0; i <= TRACK_LENGTH; i++) spaces.push(i);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-neutral-500">
        <span>Start / Finish</span>
        <span>No-Bet line at {NO_BET_SPACE}</span>
        <span>Finish</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-fit gap-1">
          {spaces.map(pos => {
            const occupants = byPos.get(pos) ?? [];
            const isStart = pos === 0;
            const isFinish = pos === TRACK_LENGTH;
            const isNoBet = pos === NO_BET_SPACE;
            return (
              <div
                key={pos}
                className={`flex w-9 flex-col items-center rounded ${
                  isStart || isFinish ? 'bg-emerald-900/30 ring-1 ring-emerald-500/40'
                  : isNoBet ? 'bg-rose-900/20 ring-1 ring-rose-500/40'
                  : 'bg-neutral-950/60'
                }`}
                style={{ minHeight: '100px' }}
              >
                <div className={`w-full py-0.5 text-center text-[10px] ${
                  isStart || isFinish ? 'text-emerald-400'
                  : isNoBet ? 'text-rose-400'
                  : 'text-neutral-600'
                }`}>
                  {pos}
                </div>
                <div className="flex flex-1 flex-col-reverse items-center gap-0.5 px-1 pb-1">
                  {occupants.map(n => <HorseDot key={n} num={n} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(n => (
          <span key={n} className="inline-flex items-center gap-1">
            <HorseDot num={n} />
            <span>H{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
