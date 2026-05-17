'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LSState, type LSMove, type LSPlayer, type HorseFinish, type ActionPayload,
  TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES, MAX_WILDS,
  HORSE_COSTS, MAX_HELMETS_PER_HORSE, MAX_JERSEYS_PER_HORSE,
  CONCESSION_ROWS, CONCESSION_COLS, BET_ODDS, CONCESSION_BONUSES,
  hasValidActionOnHorse,
} from '@/lib/games/longshot';

// Oval geometry: viewBox 460x300, centered, counterclockwise on screen
// starting at bottom-middle (matches real horse-racing direction).
// Bounds chosen so the outer rail AND the starting-gate column behind the line both fit.
const VIEW_W = 460;
const VIEW_H = 300;
const TRACK_CX = 230;
const TRACK_CY = 150;
const TRACK_RX = 190;              // horizontal radius (rail centerline)
const TRACK_RY = 108;              // vertical radius
const TRACK_HALF_WIDTH = 34;       // half-width of the track surface (full width ≈ 68px)

/**
 * Pre-compute angles for each integer position. Spaces are placed at equal ARC LENGTH
 * around the oval (so they look uniform on an ellipse). Positions 1 and 15 are then
 * shifted closer to S/F by 25% so the spaces flanking the start/finish line aren't
 * visually wider than the others (they otherwise inherit the full half-space gap that
 * would normally be filled by separators on both sides).
 */
const POSITION_ANGLES: number[] = (() => {
  const STEPS = 16000;
  const dtheta = (2 * Math.PI) / STEPS;

  // Walk counterclockwise from π/2 (bottom of oval, where position 0 lives)
  let theta = Math.PI / 2;
  let arc = 0;
  const samples: Array<{ theta: number; arc: number }> = [{ theta, arc }];
  for (let i = 0; i < STEPS; i++) {
    const nextTheta = theta - dtheta;
    const midTheta = (theta + nextTheta) / 2;
    const ds = Math.hypot(TRACK_RX * Math.sin(midTheta), TRACK_RY * Math.cos(midTheta)) * dtheta;
    arc += ds;
    theta = nextTheta;
    samples.push({ theta, arc });
  }
  const total = arc;
  const unit = total / TRACK_LENGTH;

  // Linear-interpolated lookup from arc length → angle using the sample table
  const angleAtArc = (target: number): number => {
    // Binary search would be faster, but TRACK_LENGTH is small so a linear scan is fine
    let i = 0;
    while (i < samples.length - 1 && samples[i + 1].arc < target) i++;
    const a = samples[i];
    const b = samples[i + 1] ?? a;
    if (b.arc === a.arc) return a.theta;
    const frac = (target - a.arc) / (b.arc - a.arc);
    return a.theta + frac * (b.theta - a.theta);
  };

  // Custom arc offsets per position: equal spacing, but pull positions 1 and 15
  // toward S/F so spaces 1 and 15 (each currently 1.5 normal-widths) shrink by 25%
  // to 1.125 normal-widths. Other positions stay at their equal-arc spots.
  const offsets: number[] = Array.from({ length: TRACK_LENGTH }, (_, k) => k * unit);
  offsets[1] = 0.25 * unit;                          // space 1 visual width: 1.5 → 1.125 units
  offsets[TRACK_LENGTH - 1] = (TRACK_LENGTH - 0.25) * unit; // space 15: same

  return offsets.map(angleAtArc);
})();

function angleForPosition(pos: number): number {
  if (pos <= 0) return POSITION_ANGLES[0];
  if (pos >= TRACK_LENGTH) return POSITION_ANGLES[0] - 2 * Math.PI;
  const lo = Math.floor(pos);
  const hi = (lo + 1) % TRACK_LENGTH;
  const frac = pos - lo;
  const angleLo = POSITION_ANGLES[lo];
  // When wrapping from position TRACK_LENGTH-1 to position 0, the next angle is one full revolution past
  const angleHi = hi === 0 ? POSITION_ANGLES[0] - 2 * Math.PI : POSITION_ANGLES[hi];
  return angleLo + frac * (angleHi - angleLo);
}

function pointOnOval(angle: number, rx: number, ry: number) {
  return { x: TRACK_CX + rx * Math.cos(angle), y: TRACK_CY + ry * Math.sin(angle) };
}

/** Unit tangent vector at a given angle on the oval (used to stack horses along the rail). */
function tangentAt(angle: number, rx: number, ry: number) {
  const tx = -rx * Math.sin(angle);
  const ty = ry * Math.cos(angle);
  const mag = Math.hypot(tx, ty) || 1;
  return { x: tx / mag, y: ty / mag };
}

/**
 * Drive the per-horse displayed position by replaying state.lastSequence one move at a time
 * when state.rollId increases. Each move animates over `moveDurationMs`, with `gapMs` between.
 */
function useSequencedRace(
  state: LSState,
  moveDurationMs = 825,
  gapMs = 180,
): { positions: number[]; finished: HorseFinish[] } {
  const [positions, setPositions] = useState<number[]>(() => state.horses.map(h => h.position));
  const [finished, setFinished] = useState<HorseFinish[]>(() => state.horses.map(h => h.finished));
  const rollSeen = useRef<number>(state.rollId);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // If no new roll, just snap to the canonical state
    if (state.rollId === rollSeen.current) {
      setPositions(state.horses.map(h => h.position));
      setFinished(state.horses.map(h => h.finished));
      return;
    }
    rollSeen.current = state.rollId;

    const sequence = state.lastSequence ?? [];
    if (sequence.length === 0) {
      setPositions(state.horses.map(h => h.position));
      setFinished(state.horses.map(h => h.finished));
      return;
    }

    // Begin every animating horse at its `fromPos`; others stay where they are.
    const initPos = state.horses.map((h, i) => {
      const m = sequence.find(x => x.horseIdx === i);
      return m ? m.fromPos : h.position;
    });
    const initFin = state.horses.map((h, i) => {
      const m = sequence.find(x => x.horseIdx === i);
      return m ? m.fromFinished : h.finished;
    });
    setPositions(initPos);
    setFinished(initFin);

    let stepIdx = 0;
    let cancelled = false;

    const runStep = () => {
      if (cancelled) return;
      if (stepIdx >= sequence.length) {
        // All moves played — settle to canonical final state
        setPositions(state.horses.map(h => h.position));
        setFinished(state.horses.map(h => h.finished));
        return;
      }
      const move = sequence[stepIdx];
      const start = performance.now();
      const tick = (t: number) => {
        if (cancelled) return;
        const p = Math.min(1, (t - start) / moveDurationMs);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const animPos = move.fromPos + (move.toPos - move.fromPos) * eased;
        setPositions(prev => {
          const next = prev.slice();
          next[move.horseIdx] = animPos;
          return next;
        });
        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          // Snap to exact toPos and apply finished status
          setPositions(prev => {
            const next = prev.slice();
            next[move.horseIdx] = move.toPos;
            return next;
          });
          if (move.toFinished !== move.fromFinished) {
            setFinished(prev => {
              const next = prev.slice();
              next[move.horseIdx] = move.toFinished;
              return next;
            });
          }
          stepIdx++;
          timeoutRef.current = setTimeout(runStep, gapMs);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    runStep();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // Re-run only when the round/roll changes (or finished count, for safety)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rollId]);

  return { positions, finished };
}

export default function LongShotBoard({
  state, currentUserId, disabled, onRoll, onAction,
}: {
  state: LSState;
  currentUserId: string;
  disabled: boolean;
  onRoll: () => void;
  onAction: (payload: ActionPayload) => void;
}) {
  const activePlayer = state.players.find(p => p.seat === state.activePlayerSeat);
  const currentTurnPlayer = state.players.find(p => p.seat === state.currentTurnSeat);
  const me = state.players.find(p => p.playerId === currentUserId);
  const isMyTurnToRoll = me && state.activePlayerSeat === me.seat && state.step === 'roll';
  const isMyTurnToAct  = me && state.currentTurnSeat === me.seat && state.step === 'action';
  const myBonusPending = !!(state.pendingBonus && me && state.pendingBonus.playerId === me.playerId);

  const winners = state.horses
    .map((h, i) => ({ num: i + 1, ...h }))
    .filter(h => h.finished)
    .sort((a, b) => (a.finished ?? 0) - (b.finished ?? 0));

  // --- Lifted action state so ActionPanel (button) can drive PlayerSheet (concession grid) ---
  const [wildHorse, setWildHorse] = useState<number | null>(null);
  const [pickingConcession, setPickingConcession] = useState(false);

  // Reset on round/turn change so leftover state doesn't carry across turns
  useEffect(() => {
    setWildHorse(null);
    setPickingConcession(false);
  }, [state.rollId, state.currentTurnSeat]);

  const effectiveHorse = wildHorse ?? state.horseDie ?? 0;

  const concessionCellsAvailable = useMemo(() => {
    if (!me || effectiveHorse === 0) return [];
    return state.concessionGrid
      .map((n, i) => ({ n, i }))
      .filter(c => c.n === effectiveHorse && !me.concessionMarks[c.i])
      .map(c => c.i);
  }, [state.concessionGrid, me, effectiveHorse]);

  const sendAction = (payload: ActionPayload) => {
    if (wildHorse !== null) onAction({ ...payload, wild: wildHorse } as ActionPayload);
    else onAction(payload);
    setWildHorse(null);
    setPickingConcession(false);
  };

  // Pickable cells handed to the PlayerSheet so it can light them up in place
  const sheetConcessionPick = isMyTurnToAct && pickingConcession && concessionCellsAvailable.length > 0
    ? {
        pickable: concessionCellsAvailable,
        onPick: (idx: number) => sendAction({ type: 'concession', cellIdx: idx }),
      }
    : undefined;

  return (
    <div className="space-y-3">
      {/* Players strip + compact round/dice readout (replaces the old phase bar) */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1.5">
        <span className="rounded-md bg-neutral-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Round {state.round}
        </span>
        <Die label="Horse" value={state.horseDie} color="bg-amber-500 text-neutral-950" horseDie />
        <Die label="Move"  value={state.movementDie} color="bg-emerald-500 text-neutral-950" />
        {state.phase === 'finished' && (
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
            🏁 Race over
          </span>
        )}
        <span className="mx-1 hidden h-6 w-px bg-neutral-800 sm:inline-block" />
        {state.players.map(p => {
          const isActive = p.seat === state.activePlayerSeat;
          const isTurn   = state.step === 'action' && p.seat === state.currentTurnSeat;
          const isYou    = p.playerId === currentUserId;
          return (
            <div
              key={p.playerId}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${
                isTurn ? 'border-amber-500/60 bg-amber-500/10'
                : isActive ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-neutral-800 bg-neutral-950'
              }`}
            >
              <span className="truncate">{p.username}</span>
              {isYou && <span className="text-[10px] text-neutral-500">(you)</span>}
              {isTurn && <span className="text-[10px] text-amber-400">acting…</span>}
              {isActive && state.step === 'roll' && <span className="text-[10px] text-emerald-400">rolling…</span>}
              {p.actedThisRound && state.step === 'action' && !isTurn && <span className="text-[10px] text-neutral-500">✓</span>}
              <span className="font-mono text-emerald-400">${p.money}</span>
            </div>
          );
        })}
      </div>

      {/* Pending-bonus notice for everyone else (full width) */}
      {state.step === 'action' && state.pendingBonus && !myBonusPending && (
        <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 p-3 text-sm text-neutral-300">
          Waiting on <span className="font-semibold text-amber-400">
            {state.players.find(p => p.playerId === state.pendingBonus!.playerId)?.username ?? 'a player'}
          </span> to claim {state.pendingBonus.count} concession bonus{state.pendingBonus.count > 1 ? 'es' : ''}…
        </div>
      )}

      {/* Winners (full width) */}
      {winners.length > 0 && (
        <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">Winner&apos;s Circle</div>
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

      {/* Main grid: track left, actions+sheet right on desktop; stacked on mobile/tablet */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(420px,500px)_minmax(0,1fr)]">
        {/* LEFT: track */}
        <Track state={state} />

        {/* RIGHT: actions on top, sheet below (stacked) */}
        <div className="space-y-3">
          {state.step === 'action' && me && myBonusPending && state.pendingBonus && (
            <BonusPicker
              state={state}
              me={me}
              remaining={state.pendingBonus.count}
              disabled={disabled}
              onAction={onAction}
            />
          )}
          {state.step === 'action' && me && !state.pendingBonus && (
            <ActionPanel
              state={state}
              me={me}
              isMyTurn={!!isMyTurnToAct}
              currentTurnUsername={currentTurnPlayer?.username ?? 'someone'}
              disabled={disabled}
              wildHorse={wildHorse}
              setWildHorse={setWildHorse}
              pickingConcession={pickingConcession}
              setPickingConcession={setPickingConcession}
              concessionAvailable={concessionCellsAvailable.length > 0}
              sendAction={sendAction}
              onAction={onAction}
            />
          )}
          {/* Roll-phase panel: large centered Roll button (only the active player can roll) */}
          {state.step === 'roll' && (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
              {isMyTurnToRoll ? (
                <>
                  <p className="text-sm text-neutral-400">Your turn — roll the dice to start the round.</p>
                  <button
                    onClick={onRoll}
                    disabled={disabled}
                    className="rounded-xl bg-emerald-500 px-12 py-6 text-3xl font-bold text-neutral-950 shadow-lg transition hover:scale-105 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    🎲 Roll
                  </button>
                </>
              ) : (
                <p className="text-sm text-neutral-400">
                  Waiting on <span className="font-semibold text-emerald-400">{activePlayer?.username ?? '—'}</span> to roll…
                </p>
              )}
            </div>
          )}
          {me && <PlayerSheet state={state} me={me} concessionPick={sheetConcessionPick} />}
        </div>
      </div>

      {/* Event log (collapsed by default to save space) */}
      {state.log.length > 0 && (
        <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
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
    </div>
  );
}

// =====================================================================
// Action picker
// =====================================================================

function ActionPanel({
  state, me, isMyTurn, currentTurnUsername, disabled,
  wildHorse, setWildHorse, pickingConcession, setPickingConcession,
  concessionAvailable, sendAction, onAction,
}: {
  state: LSState;
  me: LSPlayer;
  isMyTurn: boolean;
  currentTurnUsername: string;
  disabled: boolean;
  wildHorse: number | null;
  setWildHorse: (n: number | null) => void;
  pickingConcession: boolean;
  setPickingConcession: (b: boolean) => void;
  concessionAvailable: boolean;
  sendAction: (payload: ActionPayload) => void;
  onAction: (payload: ActionPayload) => void;
}) {
  const wildsLeft = MAX_WILDS - me.wildsUsed;
  const effectiveHorse = wildHorse ?? state.horseDie!;
  const rolledHorse = effectiveHorse;
  const horseIdx = rolledHorse - 1;
  const horse = state.horses[horseIdx];
  const past = horse.position >= NO_BET_SPACE;
  const finished = !!horse.finished;
  const hasHelmet = me.helmets[horseIdx] > 0;

  const canHelmet     = me.helmets[horseIdx] < MAX_HELMETS_PER_HORSE;
  const canJersey     = me.jerseys[horseIdx] < MAX_JERSEYS_PER_HORSE
                       && (me.jerseyMarks[horseIdx]?.length ?? 0) < NUM_HORSES;
  const canBet        = !finished && me.money >= 1 && (!past || hasHelmet);
  const canBuy        = !finished && state.market.includes(rolledHorse) && me.money >= HORSE_COSTS[horseIdx];
  // Refresh Wild: available any time the player has used at least one wild
  const canRefreshWilds = me.wildsUsed > 0;

  // Sub-pickers for bet / jersey (concession is now picked directly from PlayerSheet)
  const [open, setOpen] = useState<'bet' | 'jersey' | null>(null);

  if (!isMyTurn) {
    return (
      <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 p-4 text-sm text-neutral-300">
        Action phase — waiting on <span className="font-semibold text-amber-400">{currentTurnUsername}</span>…
      </div>
    );
  }

  const closeAll = () => { setOpen(null); setPickingConcession(false); };

  return (
    <div className="space-y-3 rounded-xl border border-emerald-900/40 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-300">
        <span>
          Your action this round — must use horse <HorseDot num={rolledHorse} />
          {wildHorse !== null && <span className="ml-1 text-xs text-amber-400">(via Wild)</span>}
          {wildHorse === null && <span className="ml-1 text-xs text-neutral-500">(rolled die)</span>}
        </span>
        <span className="text-xs text-neutral-400">
          Wilds left: <span className="font-mono text-amber-400">{wildsLeft}/{MAX_WILDS}</span>
        </span>
      </div>

      {/* Wild Number selector */}
      <div className="rounded-md border border-amber-900/40 bg-amber-500/5 p-2 text-xs">
        <div className="mb-1 flex items-center gap-2 text-neutral-400">
          <span>✨ Use a Wild Number to act on a different horse:</span>
          {wildHorse !== null && (
            <button onClick={() => setWildHorse(null)}
              className="rounded border border-amber-700 px-2 py-0.5 text-amber-400 hover:bg-amber-900/30">
              Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(n => {
            const selected = wildHorse === n;
            const isRolled = n === state.horseDie;
            return (
              <button key={n}
                disabled={disabled || wildsLeft <= 0 || isRolled}
                onClick={() => setWildHorse(n)}
                title={isRolled ? 'This is the rolled horse already' : wildsLeft <= 0 ? 'No wilds left' : `Act on horse ${n} instead`}
                className={`flex items-center gap-1 rounded px-2 py-0.5 transition disabled:opacity-30 ${
                  selected ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-900 text-neutral-300 hover:bg-amber-900/30'
                }`}>
                <HorseDot num={n} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {/* Concession: don't disable when already in picking mode, so user can cancel */}
        <ActionBtn label="Concession" icon="🎪"
          disabled={disabled || (!concessionAvailable && !pickingConcession)}
          active={pickingConcession}
          tip={
            pickingConcession ? 'Click again to cancel'
            : !concessionAvailable ? 'No unmarked cell on your sheet for that horse'
            : 'Pick a circle on Your Sheet'
          }
          onClick={() => { setOpen(null); setPickingConcession(!pickingConcession); }} />
        <ActionBtn label="Helmet" icon="⛑️" disabled={disabled || !canHelmet}
          tip={!canHelmet ? `Already at ${MAX_HELMETS_PER_HORSE} helmets on this horse` : undefined}
          onClick={() => { closeAll(); sendAction({ type: 'helmet' }); }} />
        <ActionBtn label="Jersey" icon={<JerseyIcon className="h-6 w-6" />} disabled={disabled || !canJersey}
          tip={!canJersey ? 'No jersey slots left' : undefined}
          onClick={() => { setPickingConcession(false); setOpen('jersey'); }} />
        <ActionBtn label="Bet" icon="💰" disabled={disabled || !canBet}
          tip={!canBet ? (finished ? 'Horse is finished' : past && !hasHelmet ? 'Past No-Bet line — need a helmet first' : 'Not enough money') : undefined}
          onClick={() => { setPickingConcession(false); setOpen('bet'); }} />
        <ActionBtn label={`Buy ($${HORSE_COSTS[horseIdx]})`} icon="🏠" disabled={disabled || !canBuy}
          tip={!canBuy ? (finished ? 'Horse is finished' : !state.market.includes(rolledHorse) ? 'Not in market' : 'Not enough money') : undefined}
          onClick={() => { closeAll(); sendAction({ type: 'buy' }); }} />
        <ActionBtn label="Refresh Wild" icon="✨" disabled={disabled || !canRefreshWilds}
          tip={!canRefreshWilds
            ? 'All wilds already available — nothing to refresh'
            : 'Recover one Wild — spends your action'}
          onClick={() => { closeAll(); onAction({ type: 'refresh_wild' }); }} />
      </div>

      {open === 'bet' && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-400">Bet amount</div>
          <div className="flex gap-2">
            {[1, 2, 3].map(amt => (
              <button key={amt} disabled={disabled || me.money < amt}
                onClick={() => { closeAll(); sendAction({ type: 'bet', amount: amt }); }}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40">
                ${amt}
              </button>
            ))}
            <button onClick={closeAll}
              className="rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
              Cancel
            </button>
          </div>
        </div>
      )}

      {open === 'jersey' && (
        <div className="rounded-md border border-neutral-800 bg-neutral-900 p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-neutral-400">
            Mark a horse on horse {rolledHorse}&apos;s secondary movement bar
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(n => {
              const alreadyMarked = (me.jerseyMarks[horseIdx] ?? []).includes(n);
              return (
                <button key={n} disabled={disabled || alreadyMarked}
                  onClick={() => { closeAll(); sendAction({ type: 'jersey', markHorse: n }); }}
                  className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                    alreadyMarked ? 'bg-neutral-800 text-neutral-500' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-neutral-950'
                  }`}>
                  <HorseDot num={n} /> Horse {n}
                  {alreadyMarked && <span className="text-[10px]">(marked)</span>}
                </button>
              );
            })}
          </div>
          <button onClick={closeAll}
            className="mt-2 rounded-md border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Bonus picker (shown when the player has unclaimed concession bonuses)
// =====================================================================

function BonusPicker({
  state, me, remaining, disabled, onAction,
}: {
  state: LSState;
  me: LSPlayer;
  remaining: number;
  disabled: boolean;
  onAction: (payload: ActionPayload) => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const [horse1, setHorse1] = useState<number | null>(null);
  const [horse2, setHorse2] = useState<number | null>(null);
  const [markHorse, setMarkHorse] = useState<number | null>(null);

  const reset = () => { setPicking(null); setHorse1(null); setHorse2(null); setMarkHorse(null); };

  const fire = (bonusId: string, extra: { horse?: number; horse2?: number; markHorse?: number } = {}) => {
    onAction({ type: 'claim_bonus', bonusId, ...extra });
    reset();
  };

  const handlePick = (bonusId: string) => {
    // Bonuses that need no further input — fire immediately
    if (bonusId === 'cash7_a' || bonusId === 'cash7_b' || bonusId === 'cash7_c') {
      fire(bonusId);
      return;
    }
    reset();
    setPicking(bonusId);
  };

  const liveHorses = state.horses
    .map((h, i) => ({ num: i + 1, finished: !!h.finished, position: h.position }))
    .filter(h => !h.finished);

  const horsesForBetOrJersey = liveHorses; // all live horses are valid (No-Bet checked server-side)
  const marketHorses = state.market;

  // For Free $3 Bet bonuses: horses past the No-Bet line are unbettable unless the
  // player already has a helmet on them. We surface this in the picker by greying out.
  const isFreeBet = picking === 'freebet3_a' || picking === 'freebet3_b';
  const noBetDisabled = useMemo(() => {
    const set = new Set<number>();
    if (!isFreeBet) return set;
    state.horses.forEach((h, i) => {
      if (!h.finished && h.position >= NO_BET_SPACE && me.helmets[i] === 0) {
        set.add(i + 1);
      }
    });
    return set;
  }, [isFreeBet, state.horses, me.helmets]);

  // For forward movement bonuses: refuse horses already at the last space (movement
  // would be wasted — bonus movement cannot cross the finish line).
  const isForwardMove = picking === 'forward2x2' || picking === 'forward3';
  const atFinishDisabled = useMemo(() => {
    const set = new Set<number>();
    if (!isForwardMove) return set;
    state.horses.forEach((h, i) => {
      if (!h.finished && h.position >= TRACK_LENGTH - 1) set.add(i + 1);
    });
    return set;
  }, [isForwardMove, state.horses]);

  // For backward movement bonuses: refuse horses still in the starting gate (position 0) —
  // they can't move back before the start line, so the bonus would be wasted.
  const isBackMove = picking === 'back2x2' || picking === 'back3';
  const atStartDisabled = useMemo(() => {
    const set = new Set<number>();
    if (!isBackMove) return set;
    state.horses.forEach((h, i) => {
      if (!h.finished && h.position <= 0) set.add(i + 1);
    });
    return set;
  }, [isBackMove, state.horses]);

  const needs2 = picking === 'back2x2' || picking === 'forward2x2';
  const needsHorse = picking !== null && (
    picking === 'back3' || picking === 'forward3' ||
    picking === 'freebet3_a' || picking === 'freebet3_b' ||
    picking === 'helmet_any' || picking === 'jersey_any' ||
    picking === 'free_horse' || needs2
  );
  const needsMarkHorse = picking === 'jersey_any';

  const canSubmit = picking && (
    needs2 ? (horse1 && horse2 && horse1 !== horse2)
    : needsMarkHorse ? (horse1 && markHorse)
    : needsHorse ? !!horse1
    : true
  );

  const submit = () => {
    if (!picking) return;
    fire(picking, { horse: horse1 ?? undefined, horse2: horse2 ?? undefined, markHorse: markHorse ?? undefined });
  };

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-amber-400">🎉 Bonus time</h3>
        <span className="text-sm text-neutral-400">{remaining} bonus{remaining > 1 ? 'es' : ''} left to claim</span>
      </div>

      {/* Bonus tiles */}
      <div className="grid grid-cols-3 gap-2 rounded-md bg-neutral-950 p-2 sm:grid-cols-4 lg:grid-cols-6">
        {CONCESSION_BONUSES.map((b, i) => {
          const claimed = me.bonusesClaimed[i];
          const selected = picking === b.id;
          return (
            <button
              key={b.id}
              disabled={disabled || claimed}
              onClick={() => handlePick(b.id)}
              title={claimed ? 'Already claimed' : b.desc}
              className={`flex flex-col items-center justify-center rounded-md border px-2 py-2 text-center text-[11px] font-mono font-bold transition ${
                claimed ? 'border-neutral-800 bg-neutral-900 text-neutral-700 line-through'
                : selected ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-800 bg-neutral-900 text-neutral-200 hover:border-amber-500'
              }`}
            >
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Sub-pickers for whichever bonus was selected */}
      {picking && needsHorse && (
        <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900 p-3 text-xs">
          <div className="text-neutral-300">
            {needs2 ? 'Pick two different horses' :
             needsMarkHorse ? 'Pick the jersey horse, then a horse to add to its bar' :
             picking === 'free_horse' ? 'Pick a horse from the market' :
             'Pick a horse'}
          </div>

          <HorsePicker
            label={needs2 ? 'First horse' : needsMarkHorse ? 'Jersey horse' : 'Horse'}
            value={horse1}
            onChange={setHorse1}
            options={picking === 'free_horse' ? marketHorses : horsesForBetOrJersey.map(h => h.num)}
            disabledHorses={
              isFreeBet ? noBetDisabled
              : isForwardMove ? atFinishDisabled
              : isBackMove ? atStartDisabled
              : undefined
            }
            disabledReason={
              isFreeBet ? 'Past the No-Bet line — you need a helmet on this horse first'
              : isForwardMove ? 'Already at the finish line — forward bonus would be wasted'
              : isBackMove ? 'Still in the starting gate — can\'t move back'
              : undefined
            }
          />

          {needs2 && (
            <HorsePicker
              label="Second horse"
              value={horse2}
              onChange={setHorse2}
              options={horsesForBetOrJersey.map(h => h.num).filter(n => n !== horse1)}
              disabledHorses={
                isForwardMove ? atFinishDisabled
                : isBackMove ? atStartDisabled
                : undefined
              }
              disabledReason={
                isForwardMove ? 'Already at the finish line — forward bonus would be wasted'
                : isBackMove ? 'Still in the starting gate — can\'t move back'
                : undefined
              }
            />
          )}
          {needsMarkHorse && (
            <HorsePicker
              label="Horse to add to bar"
              value={markHorse}
              onChange={setMarkHorse}
              options={Array.from({ length: NUM_HORSES }, (_, i) => i + 1)}
            />
          )}

          <div className="flex gap-2 pt-1">
            <button disabled={disabled || !canSubmit}
              onClick={submit}
              className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40">
              Claim bonus
            </button>
            <button onClick={reset}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HorsePicker({
  label, value, onChange, options, disabledHorses, disabledReason,
}: {
  label: string;
  value: number | null;
  onChange: (n: number) => void;
  options: number[];
  disabledHorses?: Set<number>;
  disabledReason?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.length === 0 && <span className="text-neutral-500">No valid horses</span>}
        {options.map(n => {
          const isDisabled = disabledHorses?.has(n) ?? false;
          return (
            <button
              key={n}
              disabled={isDisabled}
              onClick={() => onChange(n)}
              title={isDisabled ? disabledReason : undefined}
              className={`rounded-md px-2 py-1 transition ${
                isDisabled ? 'cursor-not-allowed opacity-25 grayscale'
                : value === n ? 'bg-emerald-500 text-neutral-950'
                : 'bg-neutral-950 text-neutral-300 hover:bg-emerald-900/30'
              }`}
            >
              <HorseDot num={n} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionBtn({
  label, icon, disabled, onClick, tip, active,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tip?: string;
  /** Highlight the button while a multi-step pick (e.g. concession) is in progress */
  active?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={tip}
      className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-400'
          : 'border-neutral-800 bg-neutral-950 hover:border-emerald-500 hover:bg-neutral-900 disabled:hover:border-neutral-800 disabled:hover:bg-neutral-950'
      }`}>
      <span className="flex h-6 items-center justify-center text-xl">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

// =====================================================================
// Player sheet (own)
// =====================================================================

function PlayerSheet({ state, me, concessionPick }: {
  state: LSState;
  me: LSPlayer;
  /** When present, the concession grid lights up its pickable cells and clicks fire onPick. */
  concessionPick?: { pickable: number[]; onPick: (idx: number) => void };
}) {
  // Jockey set = at least one helmet AND at least one jersey on the same horse
  const jockeySets = me.helmets.reduce((acc, h, i) => acc + (h > 0 && me.jerseys[i] > 0 ? 1 : 0), 0);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Your sheet</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1">
            <span className="text-neutral-500">Wilds </span>
            <span className="font-mono text-amber-400">{MAX_WILDS - me.wildsUsed}/{MAX_WILDS}</span>
          </span>
          <span className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1">
            <span className="text-neutral-500">Jockey sets </span>
            <span className="font-mono text-sky-400">{jockeySets}</span>
            <span className="text-neutral-600"> · ${jockeySets * 5}</span>
          </span>
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10 font-mono text-sm font-bold text-emerald-400">
            ${me.money}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[195px_1fr]">
        {/* LEFT: concession grid + bonuses (both fill the column width so their edges line up) */}
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider">
              <span className="text-neutral-500">Concessions</span>
              {concessionPick && (
                <span className="normal-case tracking-normal text-emerald-400">pick one ↓</span>
              )}
            </div>
            <ConcessionGrid
              grid={state.concessionGrid}
              marks={me.concessionMarks}
              clickable={concessionPick?.pickable}
              onPick={concessionPick?.onPick}
              fullWidth
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Row/Column bonuses</div>
            <div className="grid w-full grid-cols-3 gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-2">
              {CONCESSION_BONUSES.map((b, i) => {
                const claimed = me.bonusesClaimed[i];
                return (
                  <div
                    key={b.id}
                    title={claimed ? `${b.desc} (claimed)` : b.desc}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-md border px-1 py-1 text-center ${
                      claimed ? 'border-neutral-800/60 bg-neutral-950' : 'border-neutral-800 bg-neutral-900'
                    }`}
                  >
                    <span className={`text-[11px] font-mono font-bold leading-tight ${
                      claimed ? 'text-neutral-600 line-through' : 'text-neutral-200'
                    }`}>{b.label}</span>
                    {claimed && (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-bold text-red-500/80">
                        ✕
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] italic text-neutral-600">Hover for effect</p>
          </div>
        </div>

        {/* RIGHT: horse rows with helmet/jersey/bet/odds/cost */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-center text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-2 py-1 text-center">#</th>
                <th className="px-2 py-1 text-center">Helmets</th>
                <th className="px-2 py-1 text-center">Jerseys</th>
                <th className="px-2 py-1 text-center">Bet</th>
                <th className="px-2 py-1 text-center">Odds <span className="text-neutral-700">1st·2nd·3rd</span></th>
                <th className="px-2 py-1 text-center">Market</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: NUM_HORSES }, (_, i) => {
                const num = i + 1;
                const owned = me.ownedHorses.includes(num);
                const inMarket = state.market.includes(num);
                const finished = state.horses[i].finished;
                const odds = BET_ODDS[i];
                const otherOwner = !owned && !inMarket
                  ? state.players.find(p => p.ownedHorses.includes(num))
                  : undefined;
                // Who owns this horse (if anyone) — used to suffix the place when finished
                const anyOwner = state.players.find(p => p.ownedHorses.includes(num));
                return (
                  <tr key={num} className="border-t border-neutral-800/60">
                    <td className="px-2 py-1.5 text-center">
                      <span className="inline-block">
                        <HorseDot num={num} />
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <SlotRow count={me.helmets[i]} max={MAX_HELMETS_PER_HORSE} icon={<span className="text-base leading-none">⛑️</span>} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono">
                      {me.bets[i] > 0 ? <span className="text-emerald-400">${me.bets[i]}</span> : <span className="text-neutral-700">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center font-mono text-[11px] text-neutral-300">
                      {odds[0]}·{odds[1]}·{odds[2]}
                    </td>
                    <td className="px-2 py-1.5 text-center text-[11px]">
                      {finished
                        ? (
                          <span className="text-amber-400">
                            {finished === 1 ? '🥇 1st' : finished === 2 ? '🥈 2nd' : '🥉 3rd'}
                            {anyOwner && <span className="ml-1 text-sky-400">— {anyOwner.username}</span>}
                          </span>
                        )
                        : owned
                          ? <span className="text-emerald-400">owned 🏠</span>
                          : otherOwner
                            ? <span className="truncate text-sky-400">{otherOwner.username}</span>
                            : <span className="text-neutral-400">${HORSE_COSTS[i]}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions reference */}
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-neutral-800 pt-3 text-[11px] text-neutral-400 sm:grid-cols-3 lg:grid-cols-6">
        <span className="inline-flex items-center gap-1"><span>🎪</span>Concession: mark cell</span>
        <span className="inline-flex items-center gap-1"><span>⛑️</span>Helmet: bet past No-Bet</span>
        <span className="inline-flex items-center gap-1"><JerseyIcon className="h-3.5 w-3.5" />Jersey: + secondary mark</span>
        <span className="inline-flex items-center gap-1"><span>💰</span>Bet: up to $3</span>
        <span className="inline-flex items-center gap-1"><span>🏠</span>Buy: own the horse</span>
        <span className="inline-flex items-center gap-1"><span>⏭️</span>Pass</span>
      </div>
    </div>
  );
}

function SlotRow({ count, max, icon }: { count: number; max: number; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center gap-0.5 font-mono text-xs">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`inline-flex items-center ${i < count ? '' : 'opacity-20 grayscale'}`}>{icon}</span>
      ))}
    </span>
  );
}

/**
 * Stylized racing silk (jersey) icon — short-sleeved shirt silhouette filled with a
 * checker pattern. Sized via className (default 16×16). The black/white checker keeps
 * the visual feel of the original 🏁 emoji but on a shirt shape.
 */
function JerseyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} role="img" aria-label="jersey">
      <defs>
        <pattern id="silk-checker" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#ffffff" />
          <rect width="1.5" height="1.5" fill="#0a0a0a" />
          <rect x="1.5" y="1.5" width="1.5" height="1.5" fill="#0a0a0a" />
        </pattern>
      </defs>
      <path
        d="M 8 3 Q 12 5 16 3 L 18 4 L 21 7 L 21 11 L 17 11 L 17 21 L 7 21 L 7 11 L 3 11 L 3 7 L 6 4 Z"
        fill="url(#silk-checker)"
        stroke="#0a0a0a"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConcessionGrid({
  grid, marks, clickable, onPick, fullWidth = false,
}: {
  grid: number[];
  marks: boolean[];
  clickable?: number[];
  onPick?: (idx: number) => void;
  /** When true, the grid stretches to fill its parent container (cells become responsive squares). */
  fullWidth?: boolean;
}) {
  const clickSet = useMemo(() => new Set(clickable ?? []), [clickable]);
  return (
    <div className={`rounded-md border border-neutral-800 bg-neutral-950 p-2 ${fullWidth ? 'w-full' : 'inline-block'}`}>
      <div className={`grid ${fullWidth ? 'w-full' : ''}`}
        style={{ gridTemplateColumns: `repeat(${CONCESSION_COLS}, minmax(0, 1fr))`, gap: '4px' }}>
        {Array.from({ length: CONCESSION_ROWS * CONCESSION_COLS }, (_, i) => {
          const n = grid[i];
          const marked = marks[i];
          const canClick = clickSet.has(i);
          const sizeCls = fullWidth ? 'aspect-square w-full' : 'h-7 w-7';
          return (
            <button
              key={i}
              disabled={!canClick}
              onClick={() => onPick?.(i)}
              className={`relative flex items-center justify-center rounded text-sm font-semibold text-white transition ${sizeCls} ${
                canClick ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-neutral-950 hover:scale-105' : 'cursor-default'
              } ${marked ? 'opacity-30' : ''}`}
              style={{ backgroundColor: HORSE_COLORS[n - 1] }}
            >
              <span className={n === 2 ? 'text-neutral-950' : 'text-white'}>{n}</span>
              {marked && (
                <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-neutral-950">✕</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Die({ label, value, color, horseDie }: {
  label: string;
  value: number | null;
  color: string;
  /** When true and `value` is a horse number, render as a diamond using that horse's color. */
  horseDie?: boolean;
}) {
  // Compact inline die used in the players strip — no label, smaller footprint
  if (horseDie && value !== null) {
    const horseColor = HORSE_COLORS[value - 1];
    const textColor = value === 2 ? '#0a0a0a' : '#ffffff';
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center" title={`${label}: ${value}`}>
        <span
          className="relative inline-flex h-4 w-4 rotate-45 rounded-sm shadow"
          style={{ backgroundColor: horseColor }}
        >
          <span
            className="absolute inset-0 flex -rotate-45 items-center justify-center text-[10px] font-bold leading-none"
            style={{ color: textColor }}
          >
            {value}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span
      title={`${label}${value !== null ? `: ${value}` : ''}`}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold shadow ${
        value !== null ? color : 'bg-neutral-800 text-neutral-600'
      }`}
    >
      {value ?? '?'}
    </span>
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

function Track({ state }: { state: LSState }) {
  // Sequenced animation: rolled horse first, then each secondary-bar horse, one at a time.
  const { positions, finished } = useSequencedRace(state);
  const horses = state.horses;

  // Group horses by their DISPLAYED integer position for tangential stacking
  const byPos = new Map<number, number[]>();
  horses.forEach((_, i) => {
    if (finished[i]) return;
    const intPos = Math.round(positions[i] ?? 0);
    const list = byPos.get(intPos) ?? [];
    list.push(i + 1);
    byPos.set(intPos, list);
  });

  // No-Bet line: midway between space 11 and 12
  const noBetAngle = (angleForPosition(NO_BET_SPACE - 1) + angleForPosition(NO_BET_SPACE)) / 2;
  const noBetInner = pointOnOval(noBetAngle, TRACK_RX - TRACK_HALF_WIDTH, TRACK_RY - TRACK_HALF_WIDTH);
  const noBetOuter = pointOnOval(noBetAngle, TRACK_RX + TRACK_HALF_WIDTH, TRACK_RY + TRACK_HALF_WIDTH);

  // Start/Finish line at angle of space 0
  const finishAngle = angleForPosition(0);
  const finishInner = pointOnOval(finishAngle, TRACK_RX - TRACK_HALF_WIDTH, TRACK_RY - TRACK_HALF_WIDTH);
  const finishOuter = pointOnOval(finishAngle, TRACK_RX + TRACK_HALF_WIDTH, TRACK_RY + TRACK_HALF_WIDTH);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full">
        <defs>
          <linearGradient id="ls-track-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0c4a6e" />
            <stop offset="1" stopColor="#082f49" />
          </linearGradient>
          <linearGradient id="ls-track-turf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b45309" />
            <stop offset="1" stopColor="#7c2d12" />
          </linearGradient>
          <radialGradient id="ls-track-infield" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#16a34a" />
            <stop offset="1" stopColor="#14532d" />
          </radialGradient>
        </defs>

        <rect width={VIEW_W} height={VIEW_H} fill="url(#ls-track-sky)" rx="6" />

        {/* Outer rail (white) */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX + TRACK_HALF_WIDTH + 2} ry={TRACK_RY + TRACK_HALF_WIDTH + 2} fill="#fafafa" />
        {/* Track surface */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX + TRACK_HALF_WIDTH} ry={TRACK_RY + TRACK_HALF_WIDTH} fill="url(#ls-track-turf)" />
        {/* Inner rail (white) */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX - TRACK_HALF_WIDTH + 1} ry={TRACK_RY - TRACK_HALF_WIDTH + 1} fill="#fafafa" />
        {/* Infield (grass) */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX - TRACK_HALF_WIDTH - 1} ry={TRACK_RY - TRACK_HALF_WIDTH - 1} fill="url(#ls-track-infield)" />

        {/* Equidistant separator lines between each pair of consecutive spaces.
            Skip the two separators flanking the S/F line (i=0 and i=TRACK_LENGTH-1)
            because the S/F line itself already provides the divider there. */}
        {Array.from({ length: TRACK_LENGTH }, (_, i) => {
          if (i === 0 || i === TRACK_LENGTH - 1) return null;
          const a = angleForPosition(i + 0.5); // midpoint between space i and i+1
          const inner = pointOnOval(a, TRACK_RX - TRACK_HALF_WIDTH, TRACK_RY - TRACK_HALF_WIDTH);
          const outer = pointOnOval(a, TRACK_RX + TRACK_HALF_WIDTH, TRACK_RY + TRACK_HALF_WIDTH);
          return (
            <line key={`sep-${i}`}
              x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              stroke="#fafafa" strokeWidth="0.75" strokeOpacity="0.35"
            />
          );
        })}

        {/* Start/Finish line — green/white stripes, thicker */}
        <line x1={finishInner.x} y1={finishInner.y} x2={finishOuter.x} y2={finishOuter.y}
              stroke="#34d399" strokeWidth="4" />
        <line x1={finishInner.x} y1={finishInner.y} x2={finishOuter.x} y2={finishOuter.y}
              stroke="#fafafa" strokeWidth="4" strokeDasharray="3 3" />

        {/* No-Bet line — red dashed */}
        <line x1={noBetInner.x} y1={noBetInner.y} x2={noBetOuter.x} y2={noBetOuter.y}
              stroke="#ef4444" strokeWidth="4" strokeDasharray="4 3" />


        {/* Horse tokens — sequenced, with starting-gate column behind the line */}
        {horses.map((_, i) => {
          if (finished[i]) return null;
          const horseNum = i + 1;
          const animPos = positions[i] ?? 0;
          const intPos = Math.round(animPos);

          // --- On-track position: stack diagonally so the lowest-numbered horse on a
          // shared space sits closest to the infield AND closest to the next space's
          // boundary (i.e. front-inner). Higher numbers fall back-outer.
          const ovalAngle = angleForPosition(animPos);
          const ovalCenter = pointOnOval(ovalAngle, TRACK_RX, TRACK_RY);
          const ovalTan = tangentAt(ovalAngle, TRACK_RX, TRACK_RY); // points "backward" (against travel)
          const group = (byPos.get(intPos) ?? [horseNum]).slice().sort((a, b) => a - b);
          const stackIdx = group.indexOf(horseNum);                  // 0 = lowest horse num
          const stackCount = group.length;
          // Horse tokens are radius 10 (diameter 20). Diagonal step distance between
          // neighbors = STACK_STEP * √2. Picking 15 gives ~21px separation — no overlap.
          const STACK_STEP = stackCount > 1 ? 15 : 0;
          // centerOffset > 0 → forward + inner; < 0 → backward + outer
          const centerOffset = (stackCount - 1) / 2 - stackIdx;
          // Forward direction = -tangent (tangentAt points opposite to direction of travel)
          const forwardX = -ovalTan.x * centerOffset * STACK_STEP;
          const forwardY = -ovalTan.y * centerOffset * STACK_STEP;
          // Inner direction = toward the oval center (negate the outward radial)
          const innerX = -Math.cos(ovalAngle) * centerOffset * STACK_STEP;
          const innerY = -Math.sin(ovalAngle) * centerOffset * STACK_STEP;
          const ovalX = ovalCenter.x + forwardX + innerX;
          const ovalY = ovalCenter.y + forwardY + innerY;

          // --- Starting-gate position: vertical column behind the start line.
          // Horse 1 closest to the inner rail, horse 8 closest to the outer rail.
          // radialPerHorse chosen so the full column stays inside the viewBox.
          const startAngle = angleForPosition(0);
          const radialPerHorse = 10;
          const radialOffset = (horseNum - (NUM_HORSES + 1) / 2) * radialPerHorse;
          const startCenter = pointOnOval(
            startAngle,
            TRACK_RX + radialOffset,
            TRACK_RY + radialOffset
          );
          const startTan = tangentAt(startAngle, TRACK_RX, TRACK_RY);
          const BEHIND_OFFSET = 26;
          const startX = startCenter.x + startTan.x * BEHIND_OFFSET;
          const startY = startCenter.y + startTan.y * BEHIND_OFFSET;

          // Blend starting-gate → oval position over the first space of movement
          const startWeight = Math.max(0, Math.min(1, 1 - animPos));
          const x = startX * startWeight + ovalX * (1 - startWeight);
          const y = startY * startWeight + ovalY * (1 - startWeight);

          return (
            <g key={`horse-${horseNum}`}>
              <circle cx={x} cy={y} r="10" fill={HORSE_COLORS[horseNum - 1]} stroke="#0a0a0a" strokeWidth="1.25" />
              <text x={x} y={y + 3.5} fontSize="11" textAnchor="middle" fontWeight="bold"
                fill={horseNum === 2 ? '#0a0a0a' : '#fafafa'}>
                {horseNum}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(n => (
          <span key={n} className="inline-flex items-center gap-1">
            <HorseDot num={n} />
            <span>H{n}</span>
          </span>
        ))}
        <span className="ml-2 inline-flex items-center gap-1 text-rose-400">
          <span className="inline-block h-3 w-0.5 bg-rose-500" /> No-Bet at space {NO_BET_SPACE}
        </span>
      </div>
    </div>
  );
}
