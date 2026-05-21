'use client';

import { useMemo, useState } from 'react';
import {
  DICE_FACES, STARTING_DICE, isBidHigher,
  type LDState,
} from '@/lib/games/liarsdice';
import { safeAccent } from '@/lib/accentColors';

export default function LiarsDiceBoard({
  state, currentUserId, isHost, disabled, onStart, onBid, onCallLiar, onNextRound,
}: {
  state: LDState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  onBid: (quantity: number, face: number) => void;
  onCallLiar: () => void;
  onNextRound: () => void;
}) {
  // ============ Lobby ============
  if (state.phase === 'lobby') {
    const canStart = isHost && state.players.length >= 2;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="font-medium">Waiting for the host to start the game.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Players seated: <span className="text-emerald-400">{state.players.length}</span> — need at least 2, max 8.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {state.players.map(p => (
              <li key={p.playerId} className="text-neutral-300">• {p.username}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">
            Each player rolls {STARTING_DICE} dice in secret. Going around the table, bid the total
            count of a face value across <em>all</em> dice — or call &ldquo;Liar!&rdquo; on the previous bid.
            Wild 1s count as any face unless the bid is on 1s. Lose a die when you&rsquo;re wrong; last
            player with dice wins.
          </p>
          {isHost && (
            <button
              onClick={onStart}
              disabled={!canStart || disabled}
              className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {canStart ? 'Roll dice & start' : 'Waiting for players…'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============ Finished ============
  if (state.phase === 'finished') {
    return (
      <FinishedView state={state} currentUserId={currentUserId} />
    );
  }

  // ============ Between rounds (reveal) ============
  if (state.phase === 'between-rounds') {
    return (
      <RevealView state={state} disabled={disabled} onNextRound={onNextRound} />
    );
  }

  // ============ Playing ============
  return (
    <PlayingView
      state={state}
      currentUserId={currentUserId}
      disabled={disabled}
      onBid={onBid}
      onCallLiar={onCallLiar}
    />
  );
}

// =====================================================================
// Playing
// =====================================================================

function PlayingView({
  state, currentUserId, disabled, onBid, onCallLiar,
}: {
  state: LDState;
  currentUserId: string;
  disabled: boolean;
  onBid: (quantity: number, face: number) => void;
  onCallLiar: () => void;
}) {
  const me = state.players.find(p => p.playerId === currentUserId);
  const myTurn = state.players[state.turnIndex]?.playerId === currentUserId;
  const totalDice = state.players.reduce((s, p) => s + p.dice.length, 0);

  // Bid form state: start one above the current bid, or 1×2 fresh.
  const [qty, setQty] = useState<number>(() => state.bid ? state.bid.quantity : 1);
  const [face, setFace] = useState<number>(() => state.bid ? state.bid.face : 2);

  // Keep form ≥ current bid when the bid changes (e.g. another player just raised).
  // Use a useMemo trick: if current proposal is no longer higher, snap up.
  const proposalValid = isBidHigher(state.bid, { quantity: qty, face });
  const suggested = useMemo(() => {
    if (!state.bid) return { qty: 1, face: 2 };
    // Raise face within same quantity if possible; else +1 quantity, face=2.
    if (state.bid.face < DICE_FACES) return { qty: state.bid.quantity, face: state.bid.face + 1 };
    return { qty: state.bid.quantity + 1, face: 2 };
  }, [state.bid]);

  return (
    <div className="space-y-3">
      {/* Header: round + current bid */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Round</span>
            <span className="ml-2 text-base font-semibold">{state.round}</span>
            <span className="ml-3 text-xs text-neutral-500">{totalDice} dice on the table</span>
          </div>
          <div className="text-xs text-neutral-400">
            Turn: <span className="font-semibold text-neutral-100">{state.players[state.turnIndex]?.username ?? '—'}</span>
          </div>
        </div>
        <div className="mt-2">
          {state.bid ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-400">Current bid:</span>
              <BidPill quantity={state.bid.quantity} face={state.bid.face} />
              <span className="text-xs text-neutral-500">by {state.players.find(p => p.playerId === state.bid?.by)?.username ?? '?'}</span>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">No bid yet — opening bidder must place one (can&rsquo;t call Liar).</p>
          )}
        </div>
      </div>

      {/* Opponents */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Players</div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {state.players.map((p, i) => {
            const isMe = p.playerId === currentUserId;
            const isTurn = i === state.turnIndex;
            const dead = p.dice.length === 0;
            return (
              <li
                key={p.playerId}
                className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm ${
                  dead
                    ? 'border-neutral-800 bg-neutral-950/40 text-neutral-600 line-through'
                    : isTurn
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-neutral-800 bg-neutral-950/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={isMe ? 'font-semibold' : ''}
                    style={{ color: safeAccent(p.accent_color) }}
                  >
                    {p.username}{isMe ? ' (you)' : ''}
                  </span>
                  {isTurn && !dead && <span className="rounded bg-emerald-500/20 px-1 text-[10px] uppercase text-emerald-300">turn</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: p.dice.length }).map((_, k) => (
                    <DieIcon key={k} hidden />
                  ))}
                  {p.dice.length === 0 && <span className="text-xs text-neutral-600">out</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Your dice */}
      {me && me.dice.length > 0 && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-500/5 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
            Your dice — keep them hidden!
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {me.dice.map((d, i) => <DieIcon key={i} face={d} />)}
          </div>
        </div>
      )}

      {/* Action panel — only when it's your turn */}
      {myTurn && me && me.dice.length > 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Your turn — raise the bid, or call Liar
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-neutral-400">Qty</span>
              <input
                type="number"
                min={1}
                max={totalDice}
                value={qty}
                onChange={e => setQty(Math.max(1, Math.min(totalDice, parseInt(e.target.value || '1', 10))))}
                className="w-16 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-center"
              />
            </label>
            <div className="flex items-center gap-1">
              <span className="text-neutral-400">Face</span>
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setFace(n)}
                  className={`rounded border px-1.5 py-1 transition ${
                    face === n
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : 'border-neutral-700 bg-neutral-950 hover:bg-neutral-800'
                  }`}
                  title={`Face ${n}`}
                >
                  <DieIcon face={n} size={26} noShadow />
                </button>
              ))}
            </div>

            <button
              onClick={() => onBid(qty, face)}
              disabled={disabled || !proposalValid}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              title={!proposalValid ? 'Bid must be strictly higher than the current bid' : 'Place your bid'}
            >
              Bid
            </button>

            {state.bid && !proposalValid && (
              <button
                onClick={() => { setQty(suggested.qty); setFace(suggested.face); }}
                className="text-xs text-neutral-400 underline hover:text-neutral-200"
              >
                Bump to minimum
              </button>
            )}

            <button
              onClick={onCallLiar}
              disabled={disabled || !state.bid}
              className="ml-auto rounded-md bg-rose-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-rose-400 disabled:opacity-50"
              title={!state.bid ? 'No bid to challenge yet' : 'Call the previous player a liar'}
            >
              Liar!
            </button>
          </div>

          {!proposalValid && state.bid && (
            <p className="mt-2 text-xs text-rose-300">
              Bid must be strictly higher than {state.bid.quantity}×{state.bid.face} (more dice, or same count + higher face).
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3 text-center text-xs text-neutral-500">
          {me && me.dice.length === 0
            ? 'You\'re out — watching the rest of the game.'
            : `Waiting for ${state.players[state.turnIndex]?.username ?? '…'} to act.`}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Reveal (between rounds)
// =====================================================================

function RevealView({
  state, disabled, onNextRound,
}: {
  state: LDState;
  disabled: boolean;
  onNextRound: () => void;
}) {
  const r = state.lastReveal;
  if (!r) return null;
  const bidder = state.players.find(p => p.playerId === r.bid.by);
  const challenger = state.players.find(p => p.playerId === r.challenger);
  const loserPlayer = state.players.find(p => p.playerId === r.loser);

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-4 text-sm ${r.bidStood ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5'}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Round {state.round} reveal</span>
        </div>
        <p className="mt-1">
          <span className="font-semibold">{challenger?.username}</span> called <strong>Liar!</strong> on{' '}
          <span className="font-semibold">{bidder?.username}</span>&rsquo;s bid of{' '}
          <BidPill quantity={r.bid.quantity} face={r.bid.face} compact />.
        </p>
        <p className="mt-1">
          Actual count of {r.bid.face === 1 ? 'ones' : `${r.bid.face}s (incl. wild 1s)`}:{' '}
          <span className="text-base font-bold">{r.actualCount}</span>
        </p>
        <p className="mt-2">
          {r.bidStood ? (
            <>The bid held — <span className="font-semibold">{challenger?.username}</span> loses a die.</>
          ) : (
            <>The bid was a bluff — <span className="font-semibold">{bidder?.username}</span> loses a die.</>
          )}
          {r.eliminated && (
            <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-200">
              {loserPlayer?.username} eliminated
            </span>
          )}
        </p>
      </div>

      {/* All hands revealed */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">All hands</div>
        <ul className="space-y-1.5">
          {r.hands.sort((a, b) => a.seat - b.seat).map(h => {
            const wild = r.bid.face !== 1;
            return (
              <li key={h.playerId} className="flex items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5">
                <span className="text-sm font-medium" style={{ color: safeAccent(h.accent_color) }}>{h.username}</span>
                <div className="flex items-center gap-1.5">
                  {h.dice.map((d, i) => (
                    <DieIcon
                      key={i}
                      face={d}
                      highlight={d === r.bid.face || (wild && d === 1)}
                    />
                  ))}
                  {h.dice.length === 0 && <span className="text-xs text-neutral-600">no dice</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[11px] text-neutral-500">
          Highlighted dice contributed to the count{r.bid.face === 1 ? '' : ' (1s are wild)'}.
        </p>
      </div>

      <button
        onClick={onNextRound}
        disabled={disabled}
        className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        Next round →
      </button>
    </div>
  );
}

// =====================================================================
// Finished
// =====================================================================

function FinishedView({ state, currentUserId }: { state: LDState; currentUserId: string }) {
  const winner = state.players.find(p => p.playerId === state.winner);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Winner</div>
        <div className="mt-1 text-3xl font-bold">{winner?.username ?? 'Nobody'}</div>
        {winner?.playerId === currentUserId && (
          <div className="mt-1 text-sm text-emerald-200">You won! 🎉</div>
        )}
      </div>
      {state.lastReveal && (
        <RevealView state={state} disabled onNextRound={() => {}} />
      )}
    </div>
  );
}

// =====================================================================
// Bits
// =====================================================================

function BidPill({ quantity, face, compact }: { quantity: number; face: number; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 ${compact ? 'py-0.5 text-sm' : 'py-1'}`}>
      <span className="font-bold">{quantity}</span>
      <span className="text-xs text-neutral-400">×</span>
      <DieIcon face={face} size={compact ? 18 : 22} noShadow />
    </span>
  );
}

/**
 * Square die. `hidden` renders a face-down die (used for opponents). `highlight`
 * gives a green ring (used in reveal view to call out the dice that counted).
 */
function DieIcon({
  face, size = 30, hidden = false, highlight = false, noShadow = false,
}: {
  face?: number;
  size?: number;
  hidden?: boolean;
  highlight?: boolean;
  noShadow?: boolean;
}) {
  const px = size;
  if (hidden) {
    return (
      <span
        aria-label="hidden die"
        style={{ width: px, height: px }}
        className={`inline-block rounded-md border border-stone-700 bg-gradient-to-br from-stone-700 to-stone-900 ${noShadow ? '' : 'shadow-inner'}`}
      />
    );
  }
  if (face === -1) {
    // Engine returned a masked die value (other player's dice) — render hidden.
    return <DieIcon hidden size={size} noShadow={noShadow} />;
  }
  return (
    <span
      aria-label={`face ${face}`}
      style={{ width: px, height: px }}
      className={`relative inline-block rounded-md border bg-white ${highlight ? 'border-emerald-400 ring-2 ring-emerald-400/50' : 'border-neutral-400'} ${noShadow ? '' : 'shadow-sm'}`}
    >
      <DiePips n={face ?? 0} size={px} />
    </span>
  );
}

function DiePips({ n, size }: { n: number; size: number }) {
  // Pip positions in [0,1] space; scale to size.
  const positions: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  };
  const pips = positions[n] ?? [];
  const r = Math.max(1.2, size * 0.08);
  return (
    <svg width={size} height={size} className="absolute inset-0">
      {pips.map(([x, y], i) => (
        <circle key={i} cx={x * size} cy={y * size} r={r} fill="#0a0a0a" />
      ))}
    </svg>
  );
}
