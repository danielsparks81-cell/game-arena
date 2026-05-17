'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LSState, type LSMove, type LSPlayer, type HorseFinish, type ActionPayload,
  TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES, MAX_WILDS,
  HORSE_COSTS, MAX_HELMETS_PER_HORSE, MAX_JERSEYS_PER_HORSE,
  CONCESSION_ROWS, CONCESSION_COLS, BET_ODDS, CONCESSION_BONUSES,
  calculateBetWinnings,
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

  // --- Lifted action state — the PlayerSheet itself is now the action surface ---
  const [wildHorse, setWildHorse] = useState<number | null>(null);
  const [subPicker, setSubPicker] = useState<'bet' | 'jersey' | null>(null);
  const [pickingWild, setPickingWild] = useState(false);

  // --- Lifted bonus-picking state — bonus tiles in the sheet drive this ---
  const [bonusPicking, setBonusPicking] = useState<string | null>(null);
  const [bonusHorse1, setBonusHorse1] = useState<number | null>(null);

  const resetBonusPick = () => {
    setBonusPicking(null);
    setBonusHorse1(null);
  };

  // Reset on round/turn change so leftover state doesn't carry across turns
  useEffect(() => {
    setWildHorse(null);
    setSubPicker(null);
    setPickingWild(false);
    resetBonusPick();
  }, [state.rollId, state.currentTurnSeat]);

  // Clear bonus picking when the pending bonus is satisfied (no more bonuses to claim)
  useEffect(() => {
    if (!myBonusPending) resetBonusPick();
  }, [myBonusPending]);

  const handleBonusTileClick = (bonusId: string) => {
    if (bonusId === 'cash7_a' || bonusId === 'cash7_b' || bonusId === 'cash7_c') {
      onAction({ type: 'claim_bonus', bonusId });
      resetBonusPick();
      return;
    }
    if (bonusPicking === bonusId) {
      // toggle off
      resetBonusPick();
      return;
    }
    setBonusHorse1(null);
    setBonusPicking(bonusId);
  };

  // Per-bonus eligibility — which sheet/track targets should light up right now
  const bonusTargets = useMemo(() => {
    if (!myBonusPending || !me || !bonusPicking) return null;
    const live = (i: number) => !state.horses[i].finished;

    if (bonusPicking === 'helmet_any') {
      return { helmet: new Set(
        Array.from({ length: NUM_HORSES }, (_, i) => i + 1)
          .filter(n => live(n - 1) && me.helmets[n - 1] < MAX_HELMETS_PER_HORSE)
      )};
    }
    if (bonusPicking === 'jersey_any') {
      // Step 1: pick the jersey horse. Step 2: pick which horse to add to its bar.
      if (bonusHorse1 === null) {
        return { jersey: new Set(
          Array.from({ length: NUM_HORSES }, (_, i) => i + 1)
            .filter(n => live(n - 1) && me.jerseys[n - 1] < MAX_JERSEYS_PER_HORSE)
        )};
      }
      const markedAlready = new Set(me.jerseyMarks[bonusHorse1 - 1] ?? []);
      return { jerseyMark: new Set(
        Array.from({ length: NUM_HORSES }, (_, i) => i + 1).filter(n => !markedAlready.has(n))
      )};
    }
    if (bonusPicking === 'freebet3_a' || bonusPicking === 'freebet3_b') {
      return { bet: new Set(
        Array.from({ length: NUM_HORSES }, (_, i) => i + 1).filter(n => {
          if (!live(n - 1)) return false;
          const past = state.horses[n - 1].position >= NO_BET_SPACE;
          return !past || me.helmets[n - 1] > 0;
        })
      )};
    }
    if (bonusPicking === 'free_horse') {
      return { market: new Set(state.market) };
    }
    if (bonusPicking === 'back2x2' || bonusPicking === 'back3') {
      const eligible = new Set(
        Array.from({ length: NUM_HORSES }, (_, i) => i + 1)
          .filter(n => live(n - 1) && state.horses[n - 1].position > 0)
      );
      if (bonusHorse1 !== null) eligible.delete(bonusHorse1);
      return { track: eligible };
    }
    if (bonusPicking === 'forward2x2' || bonusPicking === 'forward3') {
      const eligible = new Set(
        Array.from({ length: NUM_HORSES }, (_, i) => i + 1)
          .filter(n => live(n - 1) && state.horses[n - 1].position < TRACK_LENGTH - 1)
      );
      if (bonusHorse1 !== null) eligible.delete(bonusHorse1);
      return { track: eligible };
    }
    return null;
  }, [myBonusPending, me, bonusPicking, bonusHorse1, state.horses, state.market]);

  // Handle a click on a highlighted bonus target (helmet/jersey/jerseyMark/bet/market/track horse)
  const handleBonusPick = (horseNum: number) => {
    if (!bonusPicking) return;

    // Single-pick bonuses → fire immediately
    if (
      bonusPicking === 'helmet_any' ||
      bonusPicking === 'free_horse' ||
      bonusPicking === 'freebet3_a' || bonusPicking === 'freebet3_b' ||
      bonusPicking === 'back3' || bonusPicking === 'forward3'
    ) {
      onAction({ type: 'claim_bonus', bonusId: bonusPicking, horse: horseNum });
      resetBonusPick();
      return;
    }

    // Two-pick bonuses (jersey: jersey horse → mark horse; movement2x2: horse1 → horse2)
    if (bonusPicking === 'jersey_any') {
      if (bonusHorse1 === null) {
        setBonusHorse1(horseNum);
      } else {
        onAction({ type: 'claim_bonus', bonusId: bonusPicking, horse: bonusHorse1, markHorse: horseNum });
        resetBonusPick();
      }
      return;
    }
    if (bonusPicking === 'back2x2' || bonusPicking === 'forward2x2') {
      if (bonusHorse1 === null) {
        setBonusHorse1(horseNum);
      } else {
        onAction({ type: 'claim_bonus', bonusId: bonusPicking, horse: bonusHorse1, horse2: horseNum });
        resetBonusPick();
      }
      return;
    }
  };

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
    setSubPicker(null);
    setPickingWild(false);
  };

  /**
   * Fire an action with a Wild Number explicitly passed (bypasses the wildHorse state — needed
   * because React batches setState, so we can't `setWildHorse(n)` then immediately call sendAction.)
   */
  const sendActionWithWild = (wildHorseNum: number, payload: ActionPayload) => {
    onAction({ ...payload, wild: wildHorseNum } as ActionPayload);
    setWildHorse(null);
    setSubPicker(null);
    setPickingWild(false);
  };

  // When pickingWild is active, compute eligibility for each non-rolled horse — every cell
  // that would be a legal action *if* that horse had been rolled becomes a target.
  const wildTargets = useMemo(() => {
    if (!isMyTurnToAct || !me || !pickingWild || state.horseDie === null) return null;
    const helmet = new Set<number>();
    const jersey = new Set<number>();
    const bet = new Set<number>();
    const buy = new Set<number>();
    const concessionCells = new Set<number>();

    for (let i = 0; i < NUM_HORSES; i++) {
      const num = i + 1;
      if (num === state.horseDie) continue; // rolled horse already drives the normal action highlights
      const h = state.horses[i];
      if (h.finished) continue;
      const past = h.position >= NO_BET_SPACE;
      const hasHelmet = me.helmets[i] > 0;

      if (me.helmets[i] < MAX_HELMETS_PER_HORSE) helmet.add(num);
      if (me.jerseys[i] < MAX_JERSEYS_PER_HORSE && (me.jerseyMarks[i]?.length ?? 0) < NUM_HORSES) jersey.add(num);
      if (me.money >= 1 && (!past || hasHelmet)) bet.add(num);
      if (state.market.includes(num) && me.money >= HORSE_COSTS[i]) buy.add(num);
    }
    state.concessionGrid.forEach((n, idx) => {
      if (!me.concessionMarks[idx] && n !== state.horseDie) concessionCells.add(idx);
    });

    return { helmet, jersey, bet, buy, concessionCells };
  }, [isMyTurnToAct, me, pickingWild, state.horseDie, state.horses, state.market, state.concessionGrid]);

  // Bonus context for PlayerSheet — light up the tiles + per-target highlights
  const sheetBonus = myBonusPending && me
    ? {
        picking: bonusPicking,
        horse1: bonusHorse1,
        onTileClick: handleBonusTileClick,
        onPick: handleBonusPick,
        targets: bonusTargets,
        disabled,
      }
    : undefined;

  // Movement-bonus highlighting on the track itself
  const trackBonusPick = myBonusPending && bonusTargets && 'track' in bonusTargets && bonusTargets.track
    ? { eligible: bonusTargets.track, onPick: handleBonusPick }
    : undefined;

  // Build the action context handed to PlayerSheet. Undefined when the sheet is read-only
  // (not my action turn, or a bonus is pending, or no rolled horse yet).
  const sheetAction = isMyTurnToAct && me && !state.pendingBonus && effectiveHorse > 0
    ? (() => {
        const horseIdx = effectiveHorse - 1;
        const horse = state.horses[horseIdx];
        const past = horse.position >= NO_BET_SPACE;
        const finished = !!horse.finished;
        const hasHelmet = me.helmets[horseIdx] > 0;
        return {
          effectiveHorse,
          rolledHorse: state.horseDie ?? 0,
          wildHorse,
          // Setting a wild auto-closes the picking-wild highlight mode
          setWildHorse: (n: number | null) => { setWildHorse(n); setPickingWild(false); },
          wildsLeft: MAX_WILDS - me.wildsUsed,
          pickingWild,
          setPickingWild,
          canHelmet: !finished && me.helmets[horseIdx] < MAX_HELMETS_PER_HORSE,
          canJersey: !finished && me.jerseys[horseIdx] < MAX_JERSEYS_PER_HORSE
                    && (me.jerseyMarks[horseIdx]?.length ?? 0) < NUM_HORSES,
          canBet: !finished && me.money >= 1 && (!past || hasHelmet),
          canBuy: !finished && state.market.includes(effectiveHorse) && me.money >= HORSE_COSTS[horseIdx],
          concessionCells: concessionCellsAvailable,
          subPicker,
          setSubPicker,
          send: sendAction,
          sendWithWild: sendActionWithWild,
          wildTargets,
          refreshWild: me.wildsUsed > 0 ? () => onAction({ type: 'refresh_wild' }) : undefined,
          disabled,
        };
      })()
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
        <Track state={state} bonusPick={trackBonusPick} />

        {/* RIGHT: actions on top, sheet below (stacked) */}
        <div className="space-y-3">
          {/* Waiting-on-X notice when in action phase but not my turn (sheet stays read-only) */}
          {state.step === 'action' && me && !state.pendingBonus && !isMyTurnToAct && (
            <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 p-3 text-sm text-neutral-300">
              Action phase — waiting on <span className="font-semibold text-amber-400">{currentTurnPlayer?.username ?? 'someone'}</span>…
            </div>
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
          {me && <PlayerSheet state={state} me={me} action={sheetAction} bonus={sheetBonus} />}
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
// Bonus picker (shown when the player has unclaimed concession bonuses)
// =====================================================================


// =====================================================================
// Player sheet (own)
// =====================================================================

type WildTargets = {
  helmet: Set<number>;
  jersey: Set<number>;
  bet: Set<number>;
  buy: Set<number>;
  concessionCells: Set<number>;
};

type SheetAction = {
  effectiveHorse: number;
  rolledHorse: number;
  wildHorse: number | null;
  setWildHorse: (n: number | null) => void;
  wildsLeft: number;
  pickingWild: boolean;
  setPickingWild: (b: boolean) => void;
  canHelmet: boolean;
  canJersey: boolean;
  canBet: boolean;
  canBuy: boolean;
  concessionCells: number[];
  subPicker: 'bet' | 'jersey' | null;
  setSubPicker: (s: 'bet' | 'jersey' | null) => void;
  send: (payload: ActionPayload) => void;
  /** Fire an action with a specific Wild horse passed inline (used in pickingWild mode). */
  sendWithWild: (wildHorseNum: number, payload: ActionPayload) => void;
  /** Per-horse eligibility for each action type during pickingWild mode. */
  wildTargets: WildTargets | null;
  refreshWild?: () => void;
  disabled: boolean;
};

type BonusTargets = {
  helmet?: Set<number>;
  jersey?: Set<number>;
  jerseyMark?: Set<number>;
  bet?: Set<number>;
  market?: Set<number>;
  track?: Set<number>;
};

function PlayerSheet({ state, me, action, bonus }: {
  state: LSState;
  me: LSPlayer;
  /** When present, the sheet is the interactive action surface for the current player's turn. */
  action?: SheetAction;
  /** When present, the Row/Column bonus tiles become clickable for claiming a pending bonus. */
  bonus?: {
    picking: string | null;
    horse1: number | null;
    onTileClick: (bonusId: string) => void;
    onPick: (horseNum: number) => void;
    targets: BonusTargets | null;
    disabled: boolean;
  };
}) {
  const jockeySets = me.helmets.reduce((acc, h, i) => acc + (h > 0 && me.jerseys[i] > 0 ? 1 : 0), 0);
  const effHorseIdx = action ? action.effectiveHorse - 1 : -1;

  // Concession pick handler: covers both the normal "rolled horse" case and the wild case.
  // The cell number tells us which horse to use; if it isn't the rolled horse, pass it as wild.
  const onConcessionPick = action
    ? (idx: number) => {
        const cellHorse = state.concessionGrid[idx];
        if (cellHorse !== action.rolledHorse) {
          action.sendWithWild(cellHorse, { type: 'concession', cellIdx: idx });
        } else {
          action.setSubPicker(null);
          action.send({ type: 'concession', cellIdx: idx });
        }
      }
    : undefined;

  // Combined set of pickable concession cells: rolled-horse cells (normal) +
  // wild-eligible cells from any non-rolled horse when pickingWild is active.
  const concessionPickable = action
    ? Array.from(new Set([
        ...action.concessionCells,
        ...(action.wildTargets ? Array.from(action.wildTargets.concessionCells) : []),
      ]))
    : undefined;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Your sheet
          {action && (
            <span className="ml-2 normal-case tracking-normal text-emerald-400">
              · acting on horse <HorseDot num={action.effectiveHorse} />
              {action.wildHorse !== null && <span className="ml-1 text-amber-400">(Wild)</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {/* Prominent Wild action button — when clicked, lights up the eligible horse #s in the table */}
          {action && action.wildsLeft > 0 && (
            <button
              onClick={() => action.setPickingWild(!action.pickingWild)}
              disabled={action.disabled}
              title={action.pickingWild ? 'Cancel — pick a horse # in the table' : 'Use a Wild to act on a different horse'}
              className={`inline-flex items-center gap-1.5 rounded-md border-2 px-3 py-1.5 text-sm font-bold transition disabled:opacity-40 ${
                action.pickingWild
                  ? 'border-amber-300 bg-amber-500 text-neutral-950 ring-2 ring-amber-300'
                  : 'border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/30 hover:scale-105'
              }`}
            >
              ✨ Wild
              <span className="font-mono text-[11px] opacity-80">({action.wildsLeft}/{MAX_WILDS})</span>
            </button>
          )}
          {action?.wildHorse !== null && action?.wildHorse !== undefined && (
            <button
              onClick={() => action.setWildHorse(null)}
              disabled={action.disabled}
              title="Clear Wild selection"
              className="inline-flex items-center gap-1 rounded-md border border-amber-500 bg-amber-500/15 px-2 py-1.5 text-xs text-amber-300 hover:bg-amber-500/30"
            >
              Wild: <HorseDot num={action.wildHorse} /> <span>✕</span>
            </button>
          )}
          {action?.refreshWild && (
            <button
              onClick={action.refreshWild}
              disabled={action.disabled}
              title="Spend your action to recover one Wild"
              className="rounded-md border border-amber-600 px-2 py-1.5 text-xs text-amber-400 hover:bg-amber-900/30 disabled:opacity-40"
            >
              ↺ Refresh
            </button>
          )}
          {!action && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1">
              <span className="text-neutral-500">Wilds </span>
              <span className="font-mono text-amber-400">{MAX_WILDS - me.wildsUsed}/{MAX_WILDS}</span>
            </span>
          )}
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
        {/* LEFT: concession grid + bonuses */}
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Concessions</div>
            <ConcessionGrid
              grid={state.concessionGrid}
              marks={me.concessionMarks}
              clickable={concessionPickable}
              onPick={onConcessionPick}
              fullWidth
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider">
              <span className="text-neutral-500">Row/Column bonuses</span>
              {bonus && <span className="normal-case tracking-normal text-emerald-400">pick one</span>}
            </div>
            <div className="grid w-full grid-cols-3 gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-2">
              {CONCESSION_BONUSES.map((b, i) => {
                const claimed = me.bonusesClaimed[i];
                const isPickable = !!bonus && !claimed;
                const isSelected = !!bonus && bonus.picking === b.id;
                const baseTile = `relative flex aspect-square flex-col items-center justify-center rounded-md border px-1 py-1 text-center transition`;
                if (isPickable) {
                  return (
                    <button
                      key={b.id}
                      disabled={bonus.disabled}
                      onClick={() => bonus.onTileClick(b.id)}
                      title={b.desc}
                      className={`${baseTile} ${
                        isSelected
                          ? 'border-emerald-300 bg-emerald-500/25 ring-2 ring-emerald-300'
                          : 'border-emerald-400 bg-emerald-500/5 ring-2 ring-emerald-400 hover:bg-emerald-500/15 hover:scale-[1.03]'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span className="text-[11px] font-mono font-bold leading-tight text-emerald-100">{b.label}</span>
                    </button>
                  );
                }
                return (
                  <div
                    key={b.id}
                    title={claimed ? `${b.desc} (claimed)` : b.desc}
                    className={`${baseTile} ${
                      claimed ? 'border-neutral-800/60 bg-neutral-950' : 'border-neutral-800 bg-neutral-900'
                    }`}
                  >
                    <span className={`text-[11px] font-mono font-bold leading-tight ${
                      claimed ? 'text-neutral-600 line-through' : 'text-neutral-200'
                    }`}>{b.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] italic text-neutral-600">Hover for effect</p>
          </div>
        </div>

        {/* RIGHT: horse rows */}
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
                const anyOwner = state.players.find(p => p.ownedHorses.includes(num));

                const isActive = !!action && num === action.effectiveHorse;
                // Clickable horse # = Wild Number selector (act on a different horse via Wild)
                const isRolled = !!action && num === action.rolledHorse;
                const canWild = !!action && !isRolled && action.wildsLeft > 0;
                const wildSelected = !!action && action.wildHorse === num;
                const highlightWild = !!action && action.pickingWild && canWild;

                return (
                  <tr key={num} className={`border-t border-neutral-800/60 ${isActive ? 'bg-emerald-500/[0.04]' : ''}`}>
                    {/* # — clickable when this is a wild candidate */}
                    <td className="px-2 py-1.5 text-center">
                      {canWild ? (
                        <button
                          onClick={() => action!.setWildHorse(wildSelected ? null : num)}
                          disabled={action!.disabled}
                          title={wildSelected ? 'Clear Wild selection' : `Use a Wild to act on horse ${num}`}
                          className={`group/wild inline-flex items-center justify-center rounded-full p-0.5 transition hover:scale-110 ${
                            wildSelected
                              ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-neutral-900'
                              : highlightWild
                                ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-neutral-900 animate-pulse'
                                : ''
                          }`}
                        >
                          <HorseDot num={num} />
                        </button>
                      ) : (
                        <span className={`inline-flex items-center justify-center rounded-full p-0.5 ${
                          isActive ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-neutral-900' : ''
                        }`}>
                          <HorseDot num={num} />
                        </span>
                      )}
                    </td>

                    {/* Helmets */}
                    <td className="px-2 py-1.5 text-center">
                      {bonus?.targets?.helmet?.has(num) ? (
                        <ActionCell
                          disabled={bonus.disabled}
                          onClick={() => bonus.onPick(num)}
                          title={`Add a helmet to horse ${num} (bonus)`}
                        >
                          <SlotRow count={me.helmets[i]} max={MAX_HELMETS_PER_HORSE} icon={<span className="text-base leading-none">⛑️</span>} />
                        </ActionCell>
                      ) : isActive && action!.canHelmet ? (
                        <ActionCell
                          disabled={action!.disabled}
                          onClick={() => action!.send({ type: 'helmet' })}
                          title="Add a helmet to this horse"
                        >
                          <SlotRow count={me.helmets[i]} max={MAX_HELMETS_PER_HORSE} icon={<span className="text-base leading-none">⛑️</span>} />
                        </ActionCell>
                      ) : action?.wildTargets?.helmet.has(num) ? (
                        <ActionCell
                          disabled={action.disabled}
                          onClick={() => action.sendWithWild(num, { type: 'helmet' })}
                          title={`Use a Wild on horse ${num} + helmet`}
                        >
                          <SlotRow count={me.helmets[i]} max={MAX_HELMETS_PER_HORSE} icon={<span className="text-base leading-none">⛑️</span>} />
                        </ActionCell>
                      ) : (
                        <SlotRow count={me.helmets[i]} max={MAX_HELMETS_PER_HORSE} icon={<span className="text-base leading-none">⛑️</span>} />
                      )}
                    </td>

                    {/* Jerseys */}
                    <td className="px-2 py-1.5 text-center">
                      {bonus?.targets?.jersey?.has(num) ? (
                        <ActionCell
                          disabled={bonus.disabled}
                          active={bonus.horse1 === num}
                          onClick={() => bonus.onPick(num)}
                          title={`Pick horse ${num} as the jersey horse (bonus)`}
                        >
                          <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                        </ActionCell>
                      ) : isActive && action!.canJersey ? (
                        <ActionCell
                          disabled={action!.disabled}
                          active={action!.subPicker === 'jersey'}
                          onClick={() => action!.setSubPicker(action!.subPicker === 'jersey' ? null : 'jersey')}
                          title="Mark a horse on this horse's secondary bar"
                        >
                          <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                        </ActionCell>
                      ) : action?.wildTargets?.jersey.has(num) ? (
                        <ActionCell
                          disabled={action.disabled}
                          onClick={() => { action.setWildHorse(num); action.setSubPicker('jersey'); }}
                          title={`Use a Wild on horse ${num} + jersey`}
                        >
                          <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                        </ActionCell>
                      ) : (
                        <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                      )}
                    </td>

                    {/* Bet */}
                    <td className="px-2 py-1.5 text-center font-mono">
                      {bonus?.targets?.bet?.has(num) ? (
                        <ActionCell
                          disabled={bonus.disabled}
                          onClick={() => bonus.onPick(num)}
                          title={`Free $3 bet on horse ${num} (bonus)`}
                        >
                          <span className="text-emerald-300">
                            {me.bets[i] > 0 ? `$${me.bets[i]} +$3` : '+$3'}
                          </span>
                        </ActionCell>
                      ) : isActive && action!.canBet ? (
                        <ActionCell
                          disabled={action!.disabled}
                          active={action!.subPicker === 'bet'}
                          onClick={() => action!.setSubPicker(action!.subPicker === 'bet' ? null : 'bet')}
                          title="Place a bet on this horse"
                        >
                          {me.bets[i] > 0
                            ? <span className="text-emerald-400">${me.bets[i]}</span>
                            : <span className="text-emerald-300">$+</span>}
                        </ActionCell>
                      ) : action?.wildTargets?.bet.has(num) ? (
                        <ActionCell
                          disabled={action.disabled}
                          onClick={() => { action.setWildHorse(num); action.setSubPicker('bet'); }}
                          title={`Use a Wild on horse ${num} + bet`}
                        >
                          {me.bets[i] > 0
                            ? <span className="text-emerald-400">${me.bets[i]}</span>
                            : <span className="text-emerald-300">$+</span>}
                        </ActionCell>
                      ) : (
                        me.bets[i] > 0 ? <span className="text-emerald-400">${me.bets[i]}</span> : <span className="text-neutral-700">—</span>
                      )}
                    </td>

                    {/* Odds */}
                    <td className="px-2 py-1.5 text-center font-mono text-[11px] text-neutral-300">
                      {odds[0]}·{odds[1]}·{odds[2]}
                    </td>

                    {/* Market */}
                    <td className="px-2 py-1.5 text-center text-[11px]">
                      {finished ? (
                        <span className="text-amber-400">
                          {finished === 1 ? '🥇 1st' : finished === 2 ? '🥈 2nd' : '🥉 3rd'}
                          {anyOwner && <span className="ml-1 text-sky-400">— {anyOwner.username}</span>}
                        </span>
                      ) : owned ? (
                        <span className="text-emerald-400">owned 🏠</span>
                      ) : bonus?.targets?.market?.has(num) ? (
                        <ActionCell
                          disabled={bonus.disabled}
                          onClick={() => bonus.onPick(num)}
                          title={`Claim horse ${num} free (bonus)`}
                        >
                          <span className="font-mono font-bold text-emerald-200">FREE</span>
                        </ActionCell>
                      ) : otherOwner ? (
                        <span className="truncate text-sky-400">{otherOwner.username}</span>
                      ) : isActive && action!.canBuy ? (
                        <ActionCell
                          disabled={action!.disabled}
                          onClick={() => action!.send({ type: 'buy' })}
                          title={`Buy horse ${num} for $${HORSE_COSTS[i]}`}
                        >
                          <span className="text-emerald-300">${HORSE_COSTS[i]}</span>
                        </ActionCell>
                      ) : action?.wildTargets?.buy.has(num) ? (
                        <ActionCell
                          disabled={action.disabled}
                          onClick={() => action.sendWithWild(num, { type: 'buy' })}
                          title={`Use a Wild on horse ${num} + buy ($${HORSE_COSTS[i]})`}
                        >
                          <span className="text-emerald-300">${HORSE_COSTS[i]}</span>
                        </ActionCell>
                      ) : (
                        <span className="text-neutral-400">${HORSE_COSTS[i]}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Bet winnings — shown when the race is over (Phase 4 will fold this into full settlement) */}
          {state.phase === 'finished' && <BetWinningsPanel state={state} me={me} />}

          {/* Bonus inline picker: jersey-step-2 (pick which horse to add to bar) */}
          {bonus?.targets?.jerseyMark && bonus.horse1 !== null && (
            <div className="mt-3 rounded-md border border-emerald-500 bg-emerald-500/10 p-3">
              <div className="mb-2 text-xs uppercase tracking-wider text-emerald-300">
                Pick a horse to add to horse {bonus.horse1}&apos;s jersey bar
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: NUM_HORSES }, (_, k) => k + 1).map(n => {
                  const pickable = bonus.targets!.jerseyMark!.has(n);
                  return (
                    <button
                      key={n}
                      disabled={bonus.disabled || !pickable}
                      onClick={() => bonus.onPick(n)}
                      className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                        pickable
                          ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400 hover:bg-emerald-500 hover:text-neutral-950'
                          : 'bg-neutral-800 text-neutral-500'
                      }`}
                    >
                      <HorseDot num={n} /> H{n}
                      {!pickable && <span className="text-[10px]">(marked)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sub-picker: bet amount */}
          {action?.subPicker === 'bet' && (
            <div className="mt-3 rounded-md border border-emerald-500 bg-emerald-500/10 p-3">
              <div className="mb-2 text-xs uppercase tracking-wider text-emerald-300">
                Bet amount for horse {action.effectiveHorse}
              </div>
              <div className="flex gap-2">
                {[1, 2, 3].map(amt => (
                  <button
                    key={amt}
                    disabled={action.disabled || me.money < amt}
                    onClick={() => action.send({ type: 'bet', amount: amt })}
                    className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:opacity-40"
                  >
                    ${amt}
                  </button>
                ))}
                <button
                  onClick={() => action.setSubPicker(null)}
                  className="rounded-md border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Sub-picker: jersey horse to mark */}
          {action?.subPicker === 'jersey' && (
            <div className="mt-3 rounded-md border border-emerald-500 bg-emerald-500/10 p-3">
              <div className="mb-2 text-xs uppercase tracking-wider text-emerald-300">
                Mark a horse on horse {action.effectiveHorse}&apos;s secondary bar
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(n => {
                  const alreadyMarked = (me.jerseyMarks[effHorseIdx] ?? []).includes(n);
                  return (
                    <button
                      key={n}
                      disabled={action.disabled || alreadyMarked}
                      onClick={() => action.send({ type: 'jersey', markHorse: n })}
                      className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                        alreadyMarked
                          ? 'bg-neutral-800 text-neutral-500'
                          : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-neutral-950'
                      }`}
                    >
                      <HorseDot num={n} /> H{n}
                      {alreadyMarked && <span className="text-[10px]">(marked)</span>}
                    </button>
                  );
                })}
                <button
                  onClick={() => action.setSubPicker(null)}
                  className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Final-state panel showing the player's bet payouts with per-horse breakdown. */
function BetWinningsPanel({ state, me }: { state: LSState; me: LSPlayer }) {
  const { total, breakdown } = calculateBetWinnings(state, me);
  if (breakdown.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-500">
        No bets placed this race.
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-semibold uppercase tracking-wider text-emerald-300">Bet winnings</span>
        <span className="font-mono text-base font-bold text-emerald-300">${total}</span>
      </div>
      <ul className="space-y-1">
        {breakdown.map(b => {
          const placeLabel =
            b.place === 1 ? '🥇 1st'
            : b.place === 2 ? '🥈 2nd'
            : b.place === 3 ? '🥉 3rd'
            : b.pastNoBet ? 'past No-Bet (bet back)'
            : 'did not cross No-Bet (forfeit)';
          const tone =
            b.payout > b.bet ? 'text-emerald-400'
            : b.payout === b.bet ? 'text-neutral-300'
            : 'text-rose-400';
          return (
            <li key={b.horseNum} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <HorseDot num={b.horseNum} />
                <span className="text-neutral-400">${b.bet} bet · {placeLabel}</span>
              </span>
              <span className={`font-mono ${tone}`}>
                ${b.bet} × {b.multiplier} = <span className="font-bold">${b.payout}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A table cell rendered as a clickable green-ringed button — the shared "actionable" style. */
function ActionCell({ children, active, disabled, onClick, title }: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex w-full items-center justify-center rounded-md px-2 py-1 transition ring-2 ring-offset-1 ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'bg-emerald-500/25 ring-emerald-300'
          : 'bg-emerald-500/5 ring-emerald-400 hover:bg-emerald-500/15 hover:scale-[1.03]'
      }`}
    >
      {children}
    </button>
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

function Track({ state, bonusPick }: {
  state: LSState;
  /** When set, horses whose number is in `eligible` are clickable (movement-bonus selection). */
  bonusPick?: { eligible: Set<number>; onPick: (horseNum: number) => void };
}) {
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

          const pickable = bonusPick?.eligible.has(horseNum) ?? false;
          return (
            <g key={`horse-${horseNum}`}
              onClick={pickable ? () => bonusPick!.onPick(horseNum) : undefined}
              style={pickable ? { cursor: 'pointer' } : undefined}
            >
              {/* Emerald halo behind eligible horses during a movement-bonus pick */}
              {pickable && (
                <circle cx={x} cy={y} r="14" fill="none" stroke="#34d399" strokeWidth="2.5"
                  opacity="0.9">
                  <animate attributeName="r" values="13;16;13" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0.5;0.9" dur="1.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={x} cy={y} r="10" fill={HORSE_COLORS[horseNum - 1]} stroke="#0a0a0a" strokeWidth="1.25" />
              <text x={x} y={y + 3.5} fontSize="11" textAnchor="middle" fontWeight="bold"
                pointerEvents="none"
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
