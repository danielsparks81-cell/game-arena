'use client';

import { BEST_OF, ROUNDS_TO_WIN, type RPSState, type RPSChoice } from '@/lib/games/rps';

const CHOICES: { value: RPSChoice; label: string; emoji: string }[] = [
  { value: 'rock',     label: 'Rock',     emoji: '🪨' },
  { value: 'paper',    label: 'Paper',    emoji: '📄' },
  { value: 'scissors', label: 'Scissors', emoji: '✂️' },
];

export default function RpsBoard({
  state, currentUserId, disabled, onMove,
}: {
  state: RPSState;
  currentUserId: string;
  disabled: boolean;
  onMove: (choice: RPSChoice) => void;
}) {
  const mySeat: 'A' | 'B' | null =
    state.seats.A === currentUserId ? 'A' :
    state.seats.B === currentUserId ? 'B' : null;
  const oppSeat = mySeat === 'A' ? 'B' : mySeat === 'B' ? 'A' : null;
  const myChoice  = mySeat  ? state.choices[mySeat]  : undefined;
  const oppChoice = oppSeat ? state.choices[oppSeat] : undefined;

  const matchOver = !!state.winner;
  const lastRound = state.history[state.history.length - 1];
  // After both pick, choices are cleared and the result moves to history.
  // We treat "just-revealed" as "lastRound exists and current round counter
  // changed since their last move."
  const justRevealed = !myChoice && !oppChoice && !!lastRound && !matchOver;

  const statusText = matchOver
    ? state.winner === 'draw'
      ? 'Match drawn'
      : state.winner === mySeat
        ? '🏆 You won the match!'
        : '💥 You lost the match.'
    : !mySeat ? `Spectating — round ${state.round} of ${BEST_OF}`
    : myChoice && !oppChoice ? 'Waiting for opponent…'
    : justRevealed ? `Round ${state.round} — make your pick`
    : `Round ${state.round} — pick your move`;

  return (
    <div className="space-y-4">
      <div className="text-center text-sm text-neutral-300">{statusText}</div>

      {/* Score line + round dots */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <SeatScore label="You"      score={mySeat === 'A' ? state.scores.A : mySeat === 'B' ? state.scores.B : 0} active={!matchOver} />
        <span className="font-mono text-xs text-neutral-500">first to {ROUNDS_TO_WIN}</span>
        <SeatScore label="Opponent" score={mySeat === 'A' ? state.scores.B : mySeat === 'B' ? state.scores.A : 0} active={!matchOver} />
      </div>

      {/* Last-reveal banner */}
      {lastRound && (
        <div className="mx-auto max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-center text-sm">
          <div className="mb-1 text-xs uppercase tracking-wider text-neutral-500">
            Last round
          </div>
          <div className="flex items-center justify-center gap-6 text-2xl">
            <span title={mySeat === 'A' ? lastRound.A : mySeat === 'B' ? lastRound.B : lastRound.A}>
              {emojiOf(mySeat === 'A' ? lastRound.A : mySeat === 'B' ? lastRound.B : lastRound.A)}
            </span>
            <span className="text-base text-neutral-500">vs</span>
            <span title={mySeat === 'A' ? lastRound.B : mySeat === 'B' ? lastRound.A : lastRound.B}>
              {emojiOf(mySeat === 'A' ? lastRound.B : mySeat === 'B' ? lastRound.A : lastRound.B)}
            </span>
          </div>
          <div className={`mt-1 text-xs font-medium ${
            lastRound.winner === 'draw' ? 'text-neutral-400'
            : lastRound.winner === mySeat ? 'text-emerald-400'
            : 'text-rose-400'
          }`}>
            {lastRound.winner === 'draw'   ? 'Draw'
             : lastRound.winner === mySeat ? 'You won the round'
             : 'You lost the round'}
          </div>
        </div>
      )}

      {/* Pick buttons (only while playing + seated + haven't picked yet) */}
      {!matchOver && mySeat && !myChoice && (
        <div className="grid grid-cols-3 gap-3 sm:mx-auto sm:max-w-md">
          {CHOICES.map(c => (
            <button
              key={c.value}
              disabled={disabled}
              onClick={() => onMove(c.value)}
              className="flex flex-col items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-4 transition hover:border-emerald-500 hover:bg-neutral-800 disabled:opacity-40"
            >
              <span className="text-4xl">{c.emoji}</span>
              <span className="text-sm font-medium">{c.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mid-round waiting indicator */}
      {!matchOver && mySeat && myChoice && !oppChoice && (
        <div className="text-center text-sm text-neutral-500">
          You chose <span className="font-medium text-neutral-200">{emojiOf(myChoice)} {myChoice}</span> · waiting for opponent…
        </div>
      )}
    </div>
  );
}

function emojiOf(c: RPSChoice): string {
  if (c === 'rock') return '🪨';
  if (c === 'paper') return '📄';
  return '✂️';
}

function SeatScore({ label, score, active }: { label: string; score: number; active: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`font-mono text-2xl font-bold ${active ? 'text-emerald-400' : 'text-neutral-200'}`}>
        {score}
      </span>
    </div>
  );
}
