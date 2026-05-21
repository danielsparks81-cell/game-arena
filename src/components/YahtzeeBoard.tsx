'use client';

import { useMemo } from 'react';
import {
  NUM_DICE, ROLLS_PER_TURN, UPPER, LOWER, CATEGORY_LABELS, UPPER_BONUS, UPPER_BONUS_THRESHOLD,
  scoreFor, upperTotal, upperBonus, lowerTotal, grandTotal, isYahtzee,
  type YState, type Category,
} from '@/lib/games/yahtzee';
import { safeAccent } from '@/lib/accentColors';

export default function YahtzeeBoard({
  state, currentUserId, isHost, disabled, onStart, onRoll, onToggleHold, onScore,
}: {
  state: YState;
  currentUserId: string;
  isHost: boolean;
  disabled: boolean;
  onStart: () => void;
  onRoll: () => void;
  onToggleHold: (idx: number) => void;
  onScore: (category: Category) => void;
}) {
  // ============ Lobby ============
  if (state.phase === 'lobby') {
    const canStart = isHost && state.players.length >= 1;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <p className="font-medium">Roll 5 dice, fill 13 categories, chase the high score.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Players seated: <span className="text-emerald-400">{state.players.length}</span> — solo play is fine, up to 6.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {state.players.map(p => (
              <li key={p.playerId} className="text-neutral-300">• {p.username}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">
            Each turn: roll all 5 dice, then re-roll any subset up to {ROLLS_PER_TURN - 1} more times.
            Score in any open category. Upper-section bonus +{UPPER_BONUS} if you reach {UPPER_BONUS_THRESHOLD}+.
          </p>
          {isHost && (
            <button
              onClick={onStart}
              disabled={!canStart || disabled}
              className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {canStart ? 'Start game' : 'Waiting for at least 1 player…'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============ Finished ============
  if (state.phase === 'finished') {
    return <FinishedView state={state} currentUserId={currentUserId} />;
  }

  // ============ Playing ============
  return (
    <PlayingView
      state={state}
      currentUserId={currentUserId}
      disabled={disabled}
      onRoll={onRoll}
      onToggleHold={onToggleHold}
      onScore={onScore}
    />
  );
}

// =====================================================================
// Playing
// =====================================================================

function PlayingView({
  state, currentUserId, disabled, onRoll, onToggleHold, onScore,
}: {
  state: YState;
  currentUserId: string;
  disabled: boolean;
  onRoll: () => void;
  onToggleHold: (idx: number) => void;
  onScore: (category: Category) => void;
}) {
  const active = state.players[state.turnIndex];
  const myTurn = active?.playerId === currentUserId;
  const me = state.players.find(p => p.playerId === currentUserId);

  return (
    <div className="space-y-3">
      {/* Turn + rolls indicator */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Turn</span>
            <span className="ml-2 font-semibold">{active?.username ?? '—'}</span>
            {myTurn && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase text-emerald-300">your turn</span>}
          </div>
          <div className="text-xs text-neutral-400">
            Rolls left: <span className="font-bold text-neutral-100">{state.rollsLeft}</span> / {ROLLS_PER_TURN}
          </div>
        </div>
      </div>

      {/* Dice */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {state.dice.map((d, i) => {
            const empty = d === 0;
            const held = state.held[i];
            const canToggle = myTurn && state.rolled && state.rollsLeft > 0 && !disabled;
            return (
              <button
                key={i}
                onClick={() => canToggle && onToggleHold(i)}
                disabled={!canToggle}
                className={`relative inline-block transition ${canToggle ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'}`}
                aria-label={empty ? 'unrolled die' : `die ${i + 1} showing ${d}${held ? ', held' : ''}`}
                title={held ? 'Held — click to release' : canToggle ? 'Click to hold' : ''}
              >
                <Die face={d} size={56} held={held} empty={empty} />
              </button>
            );
          })}
        </div>
        {state.rolled && state.rollsLeft > 0 && (
          <p className="mt-2 text-center text-[11px] text-neutral-500">
            Tap dice to hold them between rolls.
          </p>
        )}
        {myTurn && (
          <div className="mt-3 flex justify-center">
            <button
              onClick={onRoll}
              disabled={disabled || state.rollsLeft === 0}
              className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {state.rolled ? `Roll unheld dice (${state.rollsLeft} left)` : 'Roll 🎲'}
            </button>
          </div>
        )}
      </div>

      {/* Scorecard */}
      <Scorecard
        state={state}
        currentUserId={currentUserId}
        canScore={myTurn && state.rolled && !disabled}
        onScore={onScore}
      />

      {me && (
        <p className="text-center text-xs text-neutral-500">
          Your total: <span className="font-semibold text-neutral-200">{grandTotal(me)}</span>
        </p>
      )}
    </div>
  );
}

// =====================================================================
// Scorecard
// =====================================================================

function Scorecard({
  state, currentUserId, canScore, onScore,
}: {
  state: YState;
  currentUserId: string;
  canScore: boolean;
  onScore: (cat: Category) => void;
}) {
  const active = state.players[state.turnIndex];
  const rolledDice = state.rolled ? state.dice : null;

  const previews = useMemo(() => {
    if (!rolledDice) return null;
    const p: Record<Category, number> = {} as Record<Category, number>;
    for (const k of [...UPPER, ...LOWER]) p[k] = scoreFor(rolledDice, k);
    return p;
  }, [rolledDice]);

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="bg-neutral-950/60 text-xs uppercase tracking-wider text-neutral-500">
            <th className="px-2 py-1.5 text-left">Category</th>
            {state.players.map(p => (
              <th
                key={p.playerId}
                className={`px-2 py-1.5 text-center ${p.playerId === active?.playerId ? 'font-bold' : ''}`}
                style={{ color: safeAccent(p.accent_color) }}
              >
                {p.username}{p.playerId === currentUserId ? ' (you)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <SectionHeader label="Upper section" cols={state.players.length} />
          {UPPER.map(cat => (
            <ScoreRow
              key={cat}
              cat={cat}
              state={state}
              previews={previews}
              currentUserId={currentUserId}
              canScore={canScore}
              onScore={onScore}
            />
          ))}
          <SummaryRow
            label="Subtotal"
            cols={state.players.map(p => upperTotal(p.scorecard))}
            faint
          />
          <SummaryRow
            label={`Bonus (≥${UPPER_BONUS_THRESHOLD})`}
            cols={state.players.map(p => upperBonus(p.scorecard))}
            faint
            highlight={state.players.map(p => upperBonus(p.scorecard) > 0)}
          />

          <SectionHeader label="Lower section" cols={state.players.length} />
          {LOWER.map(cat => (
            <ScoreRow
              key={cat}
              cat={cat}
              state={state}
              previews={previews}
              currentUserId={currentUserId}
              canScore={canScore}
              onScore={onScore}
            />
          ))}
          <SummaryRow
            label="Yahtzee bonus"
            cols={state.players.map(p => p.yahtzeeBonus * 100)}
            faint
            highlight={state.players.map(p => p.yahtzeeBonus > 0)}
          />

          <SummaryRow
            label="TOTAL"
            cols={state.players.map(p => grandTotal(p))}
            bold
          />
        </tbody>
      </table>
    </div>
  );
}

function ScoreRow({
  cat, state, previews, currentUserId, canScore, onScore,
}: {
  cat: Category;
  state: YState;
  previews: Record<Category, number> | null;
  currentUserId: string;
  canScore: boolean;
  onScore: (cat: Category) => void;
}) {
  const active = state.players[state.turnIndex];
  return (
    <tr className="border-t border-neutral-800/60">
      <td className="px-2 py-1.5 text-neutral-300">{CATEGORY_LABELS[cat]}</td>
      {state.players.map(p => {
        const filled = p.scorecard[cat];
        const isActive = p.playerId === active?.playerId;
        const isMe = p.playerId === currentUserId;
        const showPreview = isActive && filled === null && previews != null;
        const previewPoints = showPreview ? previews[cat] : null;
        const clickable = canScore && isMe && filled === null;
        return (
          <td key={p.playerId} className="px-2 py-1 text-center">
            {filled !== null ? (
              <span className="font-semibold text-neutral-100">{filled}</span>
            ) : clickable ? (
              <button
                onClick={() => onScore(cat)}
                className={`min-w-[36px] rounded border px-2 py-0.5 text-xs transition ${
                  previewPoints! > 0
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                }`}
                title={previewPoints! > 0 ? `Score ${previewPoints} here` : `Zero this category`}
              >
                {previewPoints}
                {cat === 'yahtzee' && previewPoints! > 0 && isYahtzee(state.dice) && ' ✨'}
              </button>
            ) : showPreview ? (
              <span className={previewPoints! > 0 ? 'text-emerald-300/70 italic' : 'text-neutral-600 italic'}>
                {previewPoints}
              </span>
            ) : (
              <span className="text-neutral-700">—</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="bg-neutral-950/40">
      <td colSpan={1 + cols} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </td>
    </tr>
  );
}

function SummaryRow({
  label, cols, faint, bold, highlight,
}: {
  label: string;
  cols: number[];
  faint?: boolean;
  bold?: boolean;
  highlight?: boolean[];
}) {
  return (
    <tr className={`border-t ${bold ? 'border-emerald-700/50 bg-emerald-500/5' : 'border-neutral-800/60'}`}>
      <td className={`px-2 py-1 ${faint ? 'text-xs text-neutral-500' : bold ? 'font-bold text-neutral-100' : 'text-neutral-300'}`}>
        {label}
      </td>
      {cols.map((n, i) => (
        <td
          key={i}
          className={`px-2 py-1 text-center ${
            bold ? 'font-bold text-neutral-100' :
            faint ? (highlight?.[i] ? 'text-emerald-300 font-medium' : 'text-neutral-500 text-xs') :
            'text-neutral-200'
          }`}
        >
          {n}
        </td>
      ))}
    </tr>
  );
}

// =====================================================================
// Finished
// =====================================================================

function FinishedView({ state, currentUserId }: { state: YState; currentUserId: string }) {
  const ranked = [...state.players].sort((a, b) => grandTotal(b) - grandTotal(a));
  const winner = ranked[0];
  const tied = ranked.length > 1 && grandTotal(ranked[0]) === grandTotal(ranked[1]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
          {tied ? 'Tie!' : 'Winner'}
        </div>
        <div className="mt-1 text-2xl font-bold">
          {tied ? 'Tied at the top' : winner?.username ?? 'Nobody'}
        </div>
        {!tied && winner?.playerId === currentUserId && (
          <div className="mt-1 text-sm text-emerald-200">High score! 🎉</div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
        <table className="w-full min-w-[300px] text-sm">
          <thead>
            <tr className="bg-neutral-950/60 text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-3 py-1.5 text-left">Rank</th>
              <th className="px-3 py-1.5 text-left">Player</th>
              <th className="px-3 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.playerId} className="border-t border-neutral-800/60">
                <td className="px-3 py-1.5 text-neutral-400">{i + 1}</td>
                <td className="px-3 py-1.5">{p.username}{p.playerId === currentUserId ? ' (you)' : ''}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{grandTotal(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =====================================================================
// Die widget
// =====================================================================

function Die({ face, size, held, empty }: { face: number; size: number; held: boolean; empty: boolean }) {
  const r = Math.max(2, size * 0.08);
  if (empty) {
    return (
      <span
        style={{ width: size, height: size }}
        className="inline-block rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-950/40"
      />
    );
  }
  const positions: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.28, 0.28], [0.72, 0.72]],
    3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  };
  return (
    <span
      style={{ width: size, height: size }}
      className={`relative inline-block rounded-lg border-2 bg-white shadow ${
        held ? 'border-emerald-400 ring-2 ring-emerald-400/50' : 'border-neutral-400'
      }`}
    >
      <svg width={size} height={size} className="absolute inset-0">
        {(positions[face] ?? []).map(([x, y], i) => (
          <circle key={i} cx={x * size} cy={y * size} r={r} fill="#0a0a0a" />
        ))}
      </svg>
      {held && (
        <span className="absolute -top-2 -right-2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-neutral-950">
          HOLD
        </span>
      )}
    </span>
  );
}

// Suppress unused warning for NUM_DICE — exported for future use elsewhere.
void NUM_DICE;
