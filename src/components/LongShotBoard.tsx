'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type LSState, type LSMove, type LSPlayer, type HorseFinish, type ActionPayload, type AbilityScoreEntry,
  type PendingChoice, type PendingChoiceResolution,
  TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES, MAX_WILDS,
  HORSE_COSTS, MAX_HELMETS_PER_HORSE, MAX_JERSEYS_PER_HORSE,
  CONCESSION_ROWS, CONCESSION_COLS, CONCESSION_CELLS, BET_ODDS, CONCESSION_BONUSES,
  SECONDARY_BARS, PURSE, allMarksOnBar, calculateBetWinnings, calculateFinalScores,
  effectiveHorseCost,
} from '@/lib/games/longshot';
import { ABILITY_BY_ID } from '@/lib/games/longshotAbilities';
import { sounds } from '@/lib/sounds';
import { safeAccent } from '@/lib/accentColors';

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

  // Podium sounds: fire when a horse moves from unfinished → 1st/2nd/3rd.
  const prevFinishedCount = useRef<number>(state.finishedCount);
  const prevHorseFinished = useRef<boolean[]>(state.horses.map(h => !!h.finished));
  useEffect(() => {
    const prevCount = prevFinishedCount.current;
    const prevFin   = prevHorseFinished.current;
    prevFinishedCount.current = state.finishedCount;
    prevHorseFinished.current = state.horses.map(h => !!h.finished);
    if (state.finishedCount <= prevCount) return; // no new finish this update
    // How many horses newly crossed the line?
    for (let i = 0; i < state.horses.length; i++) {
      if (!prevFin[i] && state.horses[i].finished) {
        const pos = state.horses[i].finished; // 1 | 2 | 3
        if (pos === 1) sounds.lsHorseFinish1st();
        else if (pos === 2) sounds.lsHorseFinish2nd();
        else if (pos === 3) sounds.lsHorseFinish3rd();
      }
    }
  }, [state.finishedCount, state.horses]);

  // Final-round announcement: fires once when the 3rd horse finishes.
  const prevFinalRound = useRef<boolean>(!!state.finalRound);
  useEffect(() => {
    const was = prevFinalRound.current;
    prevFinalRound.current = !!state.finalRound;
    if (!was && state.finalRound) sounds.lsFinalRound();
  }, [state.finalRound]);

  // Spoken cue: "When the [N] horse moves" — fires every 5th DICE roll only.
  // Ability-driven movement (Strung Along, Pay it Forward, Partner in Crime, etc.) also
  // bumps state.rollId for animation, so we distinguish a real dice roll by detecting
  // the step transition roll → action (only the dice-rolling action does that).
  const lastSeenRollId = useRef<number>(state.rollId);
  const lastSeenStep = useRef<typeof state.step>(state.step);
  const rollSpeakCounter = useRef<number>(0);
  useEffect(() => {
    const prevRollId = lastSeenRollId.current;
    const prevStep = lastSeenStep.current;
    lastSeenRollId.current = state.rollId;
    lastSeenStep.current = state.step;
    if (state.rollId === prevRollId) return;
    if (!(prevStep === 'roll' && state.step === 'action')) return; // skip ability animations
    if (!state.horseDie) return;
    rollSpeakCounter.current += 1;
    if (rollSpeakCounter.current % 5 === 0) {
      sounds.whenHorseMoves(state.horseDie);
    }
  }, [state.rollId, state.horseDie, state.step]);

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
      // One-click direct pick: for every horse that can still take a jersey, expose the
      // not-yet-globally-chosen markHorses. The PlayerSheet renders each row's eligible
      // markHorses as clickable dots; clicking fires the bonus immediately.
      const jerseyMarks = new Map<number, Set<number>>();
      for (let i = 0; i < NUM_HORSES; i++) {
        const num = i + 1;
        if (!live(i)) continue;
        if (me.jerseys[i] >= MAX_JERSEYS_PER_HORSE) continue;
        const taken = allMarksOnBar(state, num);
        const candidates = new Set<number>();
        for (let m = 1; m <= NUM_HORSES; m++) {
          if (!taken.has(m)) candidates.add(m);
        }
        if (candidates.size > 0) jerseyMarks.set(num, candidates);
      }
      return { jerseyMarks };
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

    // Two-pick movement bonuses
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

  /** Direct jersey_any bonus pick: row dot identifies both the jersey horse and the markHorse. */
  const handleBonusPickJerseyMark = (rowHorse: number, markHorse: number) => {
    if (bonusPicking !== 'jersey_any') return;
    onAction({ type: 'claim_bonus', bonusId: 'jersey_any', horse: rowHorse, markHorse });
    resetBonusPick();
  };

  const effectiveHorse = wildHorse ?? state.horseDie ?? 0;

  const concessionCellsAvailable = useMemo(() => {
    if (!me || effectiveHorse === 0) return [];
    // Scatter Shot (h3): if horse-3 owner AND no wild is in use, rolled±1 cells are also pickable.
    const scatterShot =
      wildHorse === null &&
      state.assignedAbilities[3] === 'h3_scatter_shot' &&
      me.ownedHorses.includes(3) &&
      state.horseDie !== null;
    const scatterTargets = new Set<number>();
    if (scatterShot && state.horseDie !== null) {
      if (state.horseDie - 1 >= 1) scatterTargets.add(state.horseDie - 1);
      if (state.horseDie + 1 <= NUM_HORSES) scatterTargets.add(state.horseDie + 1);
    }
    return state.concessionGrid
      .map((n, i) => ({ n, i }))
      .filter(c => !me.concessionMarks[c.i] && (c.n === effectiveHorse || scatterTargets.has(c.n)))
      .map(c => c.i);
  }, [state.concessionGrid, me, effectiveHorse, wildHorse, state.assignedAbilities, state.horseDie]);

  const ACTION_SOUND_TYPES = new Set(['buy', 'helmet', 'jersey', 'concession']);
  const maybeLsAction = (payload: ActionPayload) => {
    if (ACTION_SOUND_TYPES.has(payload.type)) sounds.lsAction();
  };

  const sendAction = (payload: ActionPayload) => {
    if (wildHorse !== null) onAction({ ...payload, wild: wildHorse } as ActionPayload);
    else onAction(payload);
    maybeLsAction(payload);
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
    maybeLsAction(payload);
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
      if (state.market.includes(num) && me.money >= effectiveHorseCost(state, num)) buy.add(num);
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
        onPickJerseyMark: handleBonusPickJerseyMark,
        targets: bonusTargets,
        disabled,
      }
    : undefined;

  // Movement-bonus highlighting on the track itself
  const trackBonusPick = myBonusPending && bonusTargets && 'track' in bonusTargets && bonusTargets.track
    ? { eligible: bonusTargets.track, onPick: handleBonusPick }
    : undefined;

  // Pending ability-choice highlighting on the track (Partner in Crime / Fair Play / Charley Horse).
  // Mutually exclusive with trackBonusPick since pendingChoice resolves before pendingBonus.
  const trackAbilityPick = useMemo(() => {
    const pc = state.pendingChoice;
    if (!pc) return undefined;
    if (pc.playerId !== currentUserId) return undefined;
    if (pc.kind !== 'partner_in_crime' && pc.kind !== 'fair_play' && pc.kind !== 'charley_horse') return undefined;
    const eligible = new Set<number>();
    const live = state.horses.filter(h => !h.finished);
    const maxLivePos = live.length > 0 ? Math.max(...live.map(h => h.position)) : -1;
    for (let i = 0; i < NUM_HORSES; i++) {
      const h = state.horses[i];
      if (h.finished) continue;
      if (pc.kind === 'fair_play' && h.position === maxLivePos) continue;
      if (pc.kind === 'partner_in_crime' && i + 1 === 6) continue; // "another" — exclude horse 6 itself
      eligible.add(i + 1);
    }
    return {
      eligible,
      onPick: (horseNum: number) => {
        onAction({
          type: 'resolve_choice',
          choice: { kind: pc.kind, horseNum } as PendingChoiceResolution,
        });
      },
    };
  }, [state.pendingChoice, state.horses, currentUserId, onAction]);

  const trackPick = trackAbilityPick ?? trackBonusPick;

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
          canBuy: !finished && state.market.includes(effectiveHorse) && me.money >= effectiveHorseCost(state, effectiveHorse),
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
      {/* End-of-race scoring window — full width, sits above the main grid */}
      {state.phase === 'finished' && <FinalScoringPanel state={state} />}

      {/* Final Round banner — persists until the race finishes */}
      {state.finalRound && state.phase === 'playing' && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-300">
          🏁 Final Round — every player takes one last action, then scoring!
        </div>
      )}

      {/* Pending ability choice picker — only for the player who needs to act (interactive
          buttons, sub-pickers etc.). Other players see a waiting note in the phase panel. */}
      {state.pendingChoice && state.pendingChoice.playerId === currentUserId && (
        <PendingChoicePicker
          state={state}
          pending={state.pendingChoice}
          disabled={disabled}
          onResolve={(choice) => onAction({ type: 'resolve_choice', choice })}
        />
      )}

      {/* Main grid: track + abilities + phase panel + winners left, sheet right on desktop; stacked on mobile/tablet */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(483px,575px)_minmax(0,1fr)]">
        {/* LEFT: Track → Horse abilities → roll/action-phase panel → Winner's Circle */}
        <div className="space-y-3">
          <Track
            state={state}
            bonusPick={trackPick}
            infieldMessage={
              state.step === 'action' && state.horseDie
                ? {
                    effectiveHorse: effectiveHorse || state.horseDie,
                    // wildHorse + clear only meaningful for the acting player's own view
                    wildHorse: isMyTurnToAct ? wildHorse : null,
                    onClearWild: isMyTurnToAct && wildHorse !== null
                      ? () => setWildHorse(null)
                      : undefined,
                  }
                : undefined
            }
          />
          {state.assignedAbilities && Object.keys(state.assignedAbilities).length > 0 && (
            <AbilitiesPanel state={state} me={me} action={sheetAction} bonus={sheetBonus} />
          )}
        </div>

        {/* RIGHT: player sheet only */}
        {me && (
          <PlayerSheet
            state={state}
            me={me}
            action={sheetAction}
            bonus={sheetBonus}
            phasePanel={(() => {
              // Priority order: pending ability choice > pending bonus > roll/action standard.
              // Helper: stacked "Waiting on [NAME] to do X" with the name centered + larger.
              const waitingBox = (
                opts: { who: string; suffix?: string; nameClass: string; boxClass: string }
              ) => (
                <div className={`w-full flex flex-col items-center justify-center rounded-md border px-2 py-1.5 text-center text-[10px] leading-tight ${opts.boxClass}`}>
                  <span>Waiting on</span>
                  <span className={`text-sm font-bold ${opts.nameClass}`}>{opts.who}</span>
                  {opts.suffix && <span>{opts.suffix}</span>}
                </div>
              );

              if (state.pendingChoice) {
                const isMine = state.pendingChoice.playerId === currentUserId;
                const who = state.players.find(p => p.playerId === state.pendingChoice?.playerId)?.username ?? 'someone';
                return isMine ? (
                  <div className="w-full rounded-md border border-fuchsia-500/60 bg-fuchsia-500/15 px-2 py-1.5 text-center text-[11px] font-medium text-fuchsia-100">
                    ✨ Resolve your ability ↑
                  </div>
                ) : waitingBox({
                  who,
                  suffix: 'to resolve ability',
                  nameClass: 'text-fuchsia-200',
                  boxClass: 'border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-200',
                });
              }
              if (state.pendingBonus) {
                const isMine = myBonusPending;
                const who = state.players.find(p => p.playerId === state.pendingBonus?.playerId)?.username ?? 'someone';
                const n = state.pendingBonus.count;
                return isMine ? (
                  <div className="w-full rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-1.5 text-center text-[11px] font-medium text-emerald-100">
                    🎉 Pick {n} bonus{n > 1 ? 'es' : ''}
                  </div>
                ) : waitingBox({
                  who,
                  suffix: `to pick ${n} bonus${n > 1 ? 'es' : ''}`,
                  nameClass: 'text-amber-300',
                  boxClass: 'border-amber-900/40 bg-amber-500/5 text-neutral-300',
                });
              }
              if (state.step === 'roll') {
                return isMyTurnToRoll ? (
                  <button
                    onClick={onRoll}
                    disabled={disabled}
                    className="w-full rounded-lg bg-emerald-500 px-2 py-2 text-sm font-bold text-neutral-950 shadow-md transition hover:scale-[1.02] hover:bg-emerald-400 disabled:opacity-40 disabled:hover:scale-100"
                  >
                    🎲 Roll
                  </button>
                ) : waitingBox({
                  who: activePlayer?.username ?? '—',
                  suffix: 'to roll',
                  nameClass: 'text-emerald-400',
                  boxClass: 'border-neutral-800 bg-neutral-900/60 text-neutral-400',
                });
              }
              if (state.step === 'action' && !isMyTurnToAct) {
                return waitingBox({
                  who: currentTurnPlayer?.username ?? 'someone',
                  suffix: state.finalRound ? 'final action' : undefined,
                  nameClass: state.finalRound ? 'text-red-400' : 'text-amber-400',
                  boxClass: state.finalRound
                    ? 'border-red-900/40 bg-red-500/5 text-neutral-300'
                    : 'border-amber-900/40 bg-amber-500/5 text-neutral-300',
                });
              }
              if (state.step === 'action' && isMyTurnToAct) {
                return state.finalRound ? (
                  <div className="flex w-full flex-col items-center justify-center rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1.5 text-center leading-tight">
                    <span className="text-[10px] text-red-200">🏁 Final action</span>
                    <span className="text-sm font-bold text-red-300">act now — then scoring!</span>
                  </div>
                ) : (
                  <div className="flex w-full flex-col items-center justify-center rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-1.5 text-center leading-tight">
                    <span className="text-[10px] text-emerald-200">Your turn</span>
                    <span className="text-sm font-bold text-emerald-300">act now</span>
                  </div>
                );
              }
              return null;
            })()}
          />
        )}
      </div>

      {/* Other players — read-only sheets, collapsed by default */}
      {state.players.length > 1 && (
        <OtherPlayersPanel state={state} currentUserId={currentUserId} />
      )}

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
// Other players panel — collapsible. Renders read-only PlayerSheets shrunk
// to 50% scale via CSS zoom, in a 2-column grid so four tiles fit roughly in
// the space one full sheet used to occupy.
// =====================================================================
function OtherPlayersPanel({ state, currentUserId }: { state: LSState; currentUserId: string }) {
  const others = useMemo(
    () => state.players.filter(p => p.playerId !== currentUserId).sort((a, b) => a.seat - b.seat),
    [state.players, currentUserId],
  );
  if (others.length === 0) return null;

  return (
    <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Opponents ({others.length})
      </summary>
      <div className="mt-2 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {others.map(p => (
          <div key={p.playerId} className="rounded-lg border border-neutral-800 bg-neutral-950/30 p-2 opacity-95">
            <div className="mb-1 text-[11px] text-neutral-400">
              <span className="font-semibold" style={{ color: safeAccent(p.accent_color) }}>{p.username}</span>
            </div>
            <PlayerSheet state={state} me={p} readOnly />
          </div>
        ))}
      </div>
    </details>
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
  bet?: Set<number>;
  market?: Set<number>;
  track?: Set<number>;
  /** For jersey_any: row horse → set of pickable markHorses for that row. */
  jerseyMarks?: Map<number, Set<number>>;
};

type SheetBonus = {
  picking: string | null;
  horse1: number | null;
  onTileClick: (bonusId: string) => void;
  onPick: (horseNum: number) => void;
  onPickJerseyMark: (rowHorse: number, markHorse: number) => void;
  targets: BonusTargets | null;
  disabled: boolean;
};

function PlayerSheet({ state, me, action, bonus, phasePanel, readOnly = false }: {
  state: LSState;
  me: LSPlayer;
  /** When present, the sheet is the interactive action surface for the current player's turn. */
  action?: SheetAction;
  /** When present, the Row/Column bonus tiles become clickable for claiming a pending bonus. */
  bonus?: SheetBonus;
  /** Compact roll/action turn indicator rendered under the Money box. */
  phasePanel?: React.ReactNode;
  /** Hides redundant global info (Marks column, Odds column, Winner's Circle) when this
   *  sheet is being rendered as a read-only view of another player. */
  readOnly?: boolean;
}) {
  const effHorseIdx = action ? action.effectiveHorse - 1 : -1;

  // Concession pick handler: covers the normal "rolled horse" case, the wild case, and the
  // Scatter Shot case (rolled±1, no wild — mutually exclusive with Wild).
  const onConcessionPick = action
    ? (idx: number) => {
        const cellHorse = state.concessionGrid[idx];
        const scatterShotActive =
          state.assignedAbilities[3] === 'h3_scatter_shot' &&
          me?.ownedHorses.includes(3) &&
          action.wildHorse === null &&
          cellHorse !== action.rolledHorse &&
          Math.abs(cellHorse - action.rolledHorse) === 1;
        if (scatterShotActive) {
          // Don't wrap as wild — engine accepts rolled±1 for Scatter Shot owner.
          action.send({ type: 'concession', cellIdx: idx });
        } else if (cellHorse !== action.rolledHorse) {
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
    <div
      className={`rounded-xl border border-neutral-800 bg-neutral-900 p-4 ${readOnly ? 'gap-x-4 gap-y-3' : ''}`}
      style={readOnly ? {
        display: 'grid',
        gridTemplateColumns: 'auto 80px',
        gridTemplateAreas: '"table money" "table wilds" "bottom bottom"',
        alignItems: 'stretch',
      } : undefined}
    >
      {/* "Acting on horse N" indicator moved to the track infield (Track component). */}

      {/* TOP: horse table (full width — sub-pickers are inline in their respective cells) */}
      <div
        className={readOnly ? '' : 'overflow-x-auto'}
        style={readOnly ? { gridArea: 'table' } : undefined}
      >
        {/* Fixed table-layout + explicit column widths so cells don't reflow when an
            ActionCell wraps inactive content or a row goes into pick-mode. */}
        <table
          className={`border-collapse text-center text-sm ${readOnly ? 'w-fit' : 'w-full min-w-[640px]'}`}
          style={{ tableLayout: 'fixed' }}
        >
          <colgroup>
            <col style={{ width: readOnly ? '60px' : '36px'  }} /> {/* # */}
            <col style={{ width: readOnly ? '60px' : '60px'  }} /> {/* Helmets */}
            <col style={{ width: readOnly ? '60px' : '44px'  }} /> {/* Jersey */}
            <col style={{ width: readOnly ? '60px' : '44px'  }} /> {/* Bonus */}
            {!readOnly && <col style={{ width: '170px' }} />}{/* Marks (8 dots) */}
            <col style={{ width: readOnly ? '60px' : '120px' }} /> {/* Bet */}
            {!readOnly && <col style={{ width: '76px' }} />}{/* Odds 1·2·3·N/B */}
          </colgroup>
            <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-2 py-1 text-center">#</th>
                <th className="px-2 py-1 text-center">Helmets</th>
                <th className="px-2 py-1 text-center">Jersey</th>
                <th className="px-2 py-1 text-center">Bonus</th>
                {!readOnly && <th className="px-2 py-1 text-center">Marks</th>}
                <th className="px-2 py-1 text-center">Bet</th>
                {!readOnly && (
                  <th className="px-2 py-1 text-center">Odds <span className="text-neutral-700">1·2·3·N/B</span></th>
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: NUM_HORSES }, (_, i) => {
                const num = i + 1;
                const odds = BET_ODDS[i];

                const isActive = !!action && num === action.effectiveHorse;
                // Clickable horse # = Wild Number selector (act on a different horse via Wild)
                const isRolled = !!action && num === action.rolledHorse;
                const canWild = !!action && !isRolled && action.wildsLeft > 0;
                const wildSelected = !!action && action.wildHorse === num;
                const highlightWild = !!action && action.pickingWild && canWild;

                return (
                  <tr key={num} className={`${readOnly ? 'h-6' : 'h-11'} border-t border-neutral-800/60 ${isActive ? 'bg-emerald-500/[0.04]' : ''}`}>
                    {/* # — clickable when this is a wild candidate */}
                    <td className="px-2 py-1.5 text-center">
                      {canWild ? (
                        <button
                          onClick={() => action!.setWildHorse(wildSelected ? null : num)}
                          disabled={action!.disabled}
                          title={wildSelected ? 'Clear Wild selection' : `Use a Wild to act on horse ${num}`}
                          className={`group/wild inline-flex items-center justify-center rounded-full p-0.5 transition ${
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

                    {/* Jersey — just the placement indicator */}
                    <td className="px-2 py-1.5 text-center">
                      <SlotRow count={me.jerseys[i]} max={MAX_JERSEYS_PER_HORSE} icon={<JerseyIcon className="h-4 w-4" />} />
                    </td>

                    {/* Bonus — $5 jockey-set bonus, dim until BOTH helmet + jersey are placed */}
                    <td className="px-2 py-1.5 text-center font-mono">
                      {(() => {
                        const hasSet = me.helmets[i] > 0 && me.jerseys[i] > 0;
                        return (
                          <span
                            title={hasSet ? 'Jockey set complete — +$5 at end of race' : 'Place both a helmet and a jersey to earn $5'}
                            className={hasSet ? 'font-bold text-sky-300' : 'text-neutral-700'}
                          >
                            $5
                          </span>
                        );
                      })()}
                    </td>

                    {/* Marks — 8 always-visible horse dots */}
                    {!readOnly && (
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        // Pickable contexts for this row's jersey marks:
                        // 1) Active row (rolled horse) and canJersey
                        // 2) Wild-target jersey row (uses a wild)
                        // 3) Bonus jersey_any direct pick — every row with available markHorses
                        const bonusJerseyMarksForRow = bonus?.targets?.jerseyMarks?.get(num);
                        const isBonusJerseyAnyRow = !!bonusJerseyMarksForRow;
                        const canActionPickHere = !!action && (
                          (isActive && action.canJersey) ||
                          (action.wildTargets?.jersey.has(num) ?? false)
                        );

                        const onPickMark = (markN: number) => {
                          if (isBonusJerseyAnyRow) {
                            bonus!.onPickJerseyMark(num, markN);
                          } else if (action) {
                            if (num === action.effectiveHorse) {
                              action.send({ type: 'jersey', markHorse: markN });
                            } else {
                              action.sendWithWild(num, { type: 'jersey', markHorse: markN });
                            }
                          }
                        };

                        return (
                          <div className="flex items-center justify-center">

                            {/* Always-visible 8 horse dots. Chosen (default or any player's mark)
                                = bright horse color. Not chosen = greyed out entirely. When this
                                row is in pick mode, the greyed dot also gets an emerald ring. */}
                            <div className="flex gap-1">
                              {Array.from({ length: NUM_HORSES }, (_, k) => k + 1).map(n => {
                                const isDefaultMark = (SECONDARY_BARS[num] ?? []).includes(n);
                                const isPlayerMark = (me.jerseyMarks[i] ?? []).includes(n);
                                const isOtherPlayerMark = state.players.some(p =>
                                  p.playerId !== me.playerId && (p.jerseyMarks[i] ?? []).includes(n)
                                );
                                const chosen = isDefaultMark || isPlayerMark || isOtherPlayerMark;
                                const pickable = !chosen && (
                                  (isBonusJerseyAnyRow && bonusJerseyMarksForRow!.has(n)) ||
                                  (canActionPickHere && !(state.horses[i].finished))
                                );
                                if (pickable) {
                                  return (
                                    <button
                                      key={n}
                                      onClick={() => onPickMark(n)}
                                      disabled={isBonusJerseyAnyRow ? bonus!.disabled : action!.disabled}
                                      title={`Add H${n} to horse ${num}'s jersey bar`}
                                      className="inline-flex items-center justify-center rounded-full p-0.5 ring-2 ring-emerald-400 ring-offset-1 ring-offset-neutral-900 opacity-40 grayscale transition hover:opacity-100 hover:grayscale-0 disabled:opacity-50"
                                    >
                                      <HorseDot num={n} />
                                    </button>
                                  );
                                }
                                return (
                                  <span
                                    key={n}
                                    title={
                                      isPlayerMark ? `H${n} marked by you on horse ${num}'s bar`
                                      : isOtherPlayerMark ? `H${n} marked by another player on horse ${num}'s bar`
                                      : isDefaultMark ? `H${n} pre-marked on horse ${num}'s bar`
                                      : `H${n} available on horse ${num}'s bar`
                                    }
                                    className={`inline-flex items-center justify-center rounded-full p-0.5 ${
                                      chosen ? '' : 'opacity-25 grayscale'
                                    }`}
                                  >
                                    <HorseDot num={n} />
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    )}

                    {/* Bet — inline $1/$2/$3 picker on the active row (or wild target row) */}
                    <td className="px-2 py-1.5 text-center font-mono">
                      {(() => {
                        // Free $3 bet from bonus is a direct-fire on the cell.
                        // Three Four Five (h4): owner's free bet pays $5 instead of $3 — reflect that in the label.
                        if (bonus?.targets?.bet?.has(num)) {
                          const freeBetAmt =
                            me.ownedHorses.includes(4) && state.assignedAbilities[4] === 'h4_three_four_five' ? 5 : 3;
                          return (
                            <ActionCell
                              disabled={bonus.disabled}
                              onClick={() => bonus.onPick(num)}
                              title={`Free $${freeBetAmt} bet on horse ${num} (bonus)`}
                            >
                              <span className="text-emerald-300">
                                {me.bets[i] > 0 ? `$${me.bets[i]} +$${freeBetAmt}` : `+$${freeBetAmt}`}
                              </span>
                            </ActionCell>
                          );
                        }
                        const useWild = !!action && !isActive && (action.wildTargets?.bet.has(num) ?? false);
                        const canPlaceBet = !!action && ((isActive && action.canBet) || useWild);
                        const strungAlongActive =
                          state.assignedAbilities[1] === 'h1_strung_along' &&
                          me.ownedHorses.includes(1);
                        const horseTarget = state.horses[i];
                        const strungAlongAllowed =
                          strungAlongActive &&
                          canPlaceBet &&
                          me.money >= 1 &&
                          !horseTarget.finished;
                        if (canPlaceBet) {
                          const onBet = (amt: number) => {
                            if (useWild) action!.sendWithWild(num, { type: 'bet', amount: amt });
                            else action!.send({ type: 'bet', amount: amt });
                          };
                          const onStrungAlong = () => {
                            const payload: ActionPayload = { type: 'bet', amount: 1, strungAlong: true };
                            if (useWild) action!.sendWithWild(num, payload);
                            else action!.send(payload);
                          };
                          return (
                            <div className="flex items-center justify-center gap-1">
                              {me.bets[i] > 0 && <span className="mr-1 text-emerald-400">${me.bets[i]}</span>}
                              {[1, 2, 3].map(amt => (
                                <button
                                  key={amt}
                                  disabled={action!.disabled || me.money < amt}
                                  onClick={() => onBet(amt)}
                                  title={`Bet $${amt} on horse ${num}${useWild ? ' (uses a Wild)' : ''}`}
                                  className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-300 ring-2 ring-emerald-400 hover:bg-emerald-500 hover:text-neutral-950 disabled:opacity-30"
                                >
                                  ${amt}
                                </button>
                              ))}
                              {strungAlongAllowed && (
                                <button
                                  disabled={action!.disabled}
                                  onClick={onStrungAlong}
                                  title={`Strung Along — pay $1, bet $1 on horse ${num}, advance it +1`}
                                  className="ml-1 rounded-md bg-fuchsia-500/15 px-1.5 py-0.5 text-xs font-semibold text-fuchsia-200 ring-2 ring-fuchsia-400 hover:bg-fuchsia-500 hover:text-neutral-950 disabled:opacity-30"
                                >
                                  🧶
                                </button>
                              )}
                            </div>
                          );
                        }
                        return me.bets[i] > 0
                          ? <span className="text-emerald-400">${me.bets[i]}</span>
                          : <span className="text-neutral-700">—</span>;
                      })()}
                    </td>

                    {/* Odds — 1st · 2nd · 3rd · past-No-Bet consolation (1×) */}
                    {!readOnly && (
                    <td
                      className="px-2 py-1.5 text-center font-mono text-[11px] text-neutral-300"
                      title="Payout multipliers: 1st · 2nd · 3rd · past No-Bet (consolation, bet back)"
                    >
                      {odds[0]}·{odds[1]}·{odds[2]}·{odds[3]}
                    </td>
                    )}

                  </tr>
                );
              })}
            </tbody>
          </table>

        {/* Bet winnings — shown when the race is over (Phase 4 will fold this into full settlement) */}
        {state.phase === 'finished' && <BetWinningsPanel state={state} me={me} />}
      </div>

      {/* In readOnly mode this container becomes `display: contents` so its 4 children
          participate directly in the outer CSS Grid (positioned via gridArea on each item).
          When interactive, it's the horizontal 4-column row under the table. */}
      <div
        className={readOnly ? '' : 'mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-start'}
        style={readOnly ? { display: 'contents' } : undefined}
      >
        {/* Wrapper for Concessions + Bonuses. In readOnly it's a flex row pinned to the
            bottom grid area; Concessions has a fixed width, Bonuses flex-1 to fill the rest. */}
        <div style={readOnly
          ? { gridArea: 'bottom', display: 'flex', gap: 8, alignItems: 'stretch' }
          : { display: 'contents' }}>
        <div
          className={readOnly ? 'w-[160px] flex-shrink-0' : 'w-full sm:w-[216px]'}
        >
          <div className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">Concessions</div>
          <ConcessionGrid
            grid={state.concessionGrid}
            marks={me.concessionMarks}
            clickable={concessionPickable}
            onPick={onConcessionPick}
            fullWidth
          />
        </div>
        <div
          className={`flex w-full flex-col ${readOnly ? 'flex-1' : 'sm:w-80'}`}
        >
          <div className="mb-1 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <span className="text-neutral-500">Bonuses</span>
            {bonus && <span className="normal-case tracking-normal text-emerald-400">pick one</span>}
          </div>
          {/* Wrapper is width-matched so the centered title above lands directly over the box.
              flex-1 here makes the inner grid fill remaining height after the header. */}
          <div
            className="grid w-full flex-1 grid-flow-col gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-2"
            style={{
              gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            }}
          >
            {CONCESSION_BONUSES.map((b, i) => {
              const claimed = me.bonusesClaimed[i];
              const isPickable = !!bonus && !claimed;
              const isSelected = !!bonus && bonus.picking === b.id;
              const isCash7 = b.id === 'cash7_a' || b.id === 'cash7_b' || b.id === 'cash7_c';
              const isFreeBet3 = b.id === 'freebet3_a' || b.id === 'freebet3_b';
              const silverSpoonBoost =
                isCash7 &&
                me.ownedHorses.includes(2) &&
                state.assignedAbilities[2] === 'h2_silver_spoon';
              const threeFourFiveBoost =
                isFreeBet3 &&
                me.ownedHorses.includes(4) &&
                state.assignedAbilities[4] === 'h4_three_four_five';
              const baseTile = `relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-md border px-1 py-1 text-center transition`;
              // Special-case rendering: bottom-row bonuses show their action icon instead of a text label
              const renderLabel = () => {
                if (b.id === 'helmet_any')  return <span className="text-2xl leading-none">⛑️</span>;
                if (b.id === 'jersey_any')  return <JerseyIcon className="h-7 w-7" />;
                if (b.id === 'free_horse')  return <span className="text-2xl leading-none">🐎</span>;
                if (silverSpoonBoost) {
                  return (
                    <span
                      title="Silver Spoon — pays $9"
                      className={`text-[12px] font-mono font-bold leading-tight ${
                        claimed ? 'text-neutral-600 line-through' : 'text-emerald-300 drop-shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                      }`}
                    >+$9</span>
                  );
                }
                if (threeFourFiveBoost) {
                  return (
                    <span
                      title="Three Four Five — $5 free bet"
                      className={`text-[12px] font-mono font-bold leading-tight ${
                        claimed ? 'text-neutral-600 line-through' : 'text-emerald-300 drop-shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                      }`}
                    >$5 Bet</span>
                  );
                }
                return (
                  <span className={`text-[11px] font-mono font-bold leading-tight ${
                    isPickable
                      ? 'text-emerald-100'
                      : claimed ? 'text-neutral-600 line-through' : 'text-neutral-200'
                  }`}>{b.label}</span>
                );
              };
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
                        : 'border-emerald-400 bg-emerald-500/5 ring-2 ring-emerald-400 hover:bg-emerald-500/15'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {renderLabel()}
                  </button>
                );
              }
              return (
                <div
                  key={b.id}
                  title={claimed
                    ? `${b.desc} (claimed)`
                    : silverSpoonBoost ? `${b.desc} (Silver Spoon: +$9)`
                    : threeFourFiveBoost ? `${b.desc} (Three Four Five: $5 free bet)`
                    : b.desc}
                  className={`${baseTile} ${
                    claimed ? 'border-neutral-800/60 bg-neutral-950 opacity-50' : 'border-neutral-800 bg-neutral-900'
                  }`}
                >
                  {renderLabel()}
                </div>
              );
            })}
          </div>
        </div>
        </div>{/* close Concessions+Bonuses wrapper */}

        {/* WILDS — 3 individual horseshoe tiles. Available tiles enter Wild-pick mode on click;
            used tiles show a refresh ↺ overlay and click-to-recover (spends your action). */}
        <div
          className={`flex w-full flex-col ${readOnly ? '' : 'sm:w-24'}`}
          style={readOnly ? { gridArea: 'wilds' } : undefined}
        >
          <div className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">Wilds</div>
          <div className="flex flex-1 flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-2">
            {Array.from({ length: MAX_WILDS }, (_, idx) => {
              const used = idx >= MAX_WILDS - me.wildsUsed;
              const isPickingWild = action?.pickingWild ?? false;
              const canActivate = !used && action && action.wildsLeft > 0;
              const canRefresh = used && !!action?.refreshWild;

              const tileBase =
                'relative flex flex-1 items-center justify-center rounded-md border-2 transition disabled:opacity-50';

              if (canActivate) {
                return (
                  <button
                    key={idx}
                    onClick={() => action!.setPickingWild(!isPickingWild)}
                    disabled={action!.disabled}
                    title={isPickingWild ? 'Cancel Wild pick' : 'Use a Wild — light up every legal action'}
                    className={`${tileBase} ${
                      isPickingWild
                        ? 'border-amber-300 bg-amber-500/20 ring-2 ring-amber-300'
                        : 'border-amber-600 bg-neutral-950 hover:bg-amber-900/20'
                    }`}
                  >
                    <HorseshoeIcon className="h-8 w-8" />
                  </button>
                );
              }
              if (canRefresh) {
                return (
                  <button
                    key={idx}
                    onClick={action!.refreshWild}
                    disabled={action!.disabled}
                    title="Recover this Wild — spends your action"
                    className={`${tileBase} border-neutral-700 bg-neutral-900 hover:border-amber-600 hover:bg-amber-900/20`}
                  >
                    <HorseshoeIcon className="h-8 w-8" used />
                    {/* Refresh-arrow overlay on top of the greyed horseshoe */}
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-bold text-amber-400">
                      ↺
                    </span>
                  </button>
                );
              }
              return (
                <div
                  key={idx}
                  title={used ? 'Wild spent' : 'Wild available'}
                  className={`${tileBase} border-neutral-800 bg-neutral-900`}
                >
                  <HorseshoeIcon className="h-8 w-8" used={used} />
                </div>
              );
            })}
          </div>
        </div>

        {/* MONEY — fills column height; money + phase panel split the available space */}
        <div
          className={`flex w-full flex-col gap-1.5 ${readOnly ? '' : 'sm:w-28'}`}
          style={readOnly ? { gridArea: 'money' } : undefined}
        >
          <div className="text-center text-xs font-semibold uppercase tracking-wider text-neutral-500">Money</div>
          <div className="flex flex-1 items-center justify-center rounded-md border-2 border-emerald-500/50 bg-emerald-500/10 px-2 py-1">
            <span className="font-mono text-2xl font-bold text-emerald-400">${me.money}</span>
          </div>
          {phasePanel && <div className="flex flex-1 flex-col [&>*]:h-full [&>*]:w-full">{phasePanel}</div>}
        </div>
      </div>

      {/* Winner's Circle spans the full width of the player sheet at the bottom.
          Hidden in read-only opponent views since it's global info. */}
      {!readOnly && (
        <div className="mt-3">
          <WinnersCircle state={state} />
        </div>
      )}
    </div>
  );
}

/** Final-state panel showing the player's bet payouts with per-horse breakdown. */
/**
 * Always-visible Winner's Circle panel. Shows three medal slots (1st/2nd/3rd) — empty
 * when no horses have finished yet, populated as horses cross the line. Sits above the
 * track in the left column.
 */
function WinnersCircle({ state }: { state: LSState }) {
  const places: { place: 1 | 2 | 3; medal: string; horseNum?: number; owner?: string }[] = [
    { place: 1, medal: '🥇' },
    { place: 2, medal: '🥈' },
    { place: 3, medal: '🥉' },
  ];
  for (let i = 0; i < NUM_HORSES; i++) {
    const f = state.horses[i].finished;
    if (f) {
      const slot = places.find(p => p.place === f);
      if (slot) {
        slot.horseNum = i + 1;
        slot.owner = state.players.find(p => p.ownedHorses.includes(i + 1))?.username;
      }
    }
  }
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-500/5 px-3 py-1">
      <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-amber-400">
        Winner&apos;s Circle
      </div>
      <ul className="text-sm">
        {places.map(p => {
          const prize = PURSE[p.place - 1];
          const purseActive = !!p.horseNum && !!p.owner;
          return (
            <li key={p.place} className="flex items-center gap-2 py-0.5">
              <span className={`text-base leading-none ${p.horseNum ? '' : 'opacity-40 grayscale'}`}>{p.medal}</span>
              {p.horseNum ? (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: HORSE_COLORS[p.horseNum - 1] }}
                >
                  {p.horseNum}
                </span>
              ) : (
                <span className="inline-block h-5 w-5 rounded-full border border-neutral-800 bg-neutral-950/40" />
              )}
              {p.horseNum
                ? <span className="truncate text-sky-400">{p.owner ?? <span className="text-neutral-600">no owner</span>}</span>
                : <span className="text-neutral-600">—</span>}
              <span
                title={purseActive ? `Owner takes the $${prize} purse` : `${prize} purse — paid to the owner of the finishing horse`}
                className={`ml-auto font-mono ${purseActive ? 'font-bold text-sky-300' : 'text-neutral-700'}`}
              >
                ${prize}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * End-of-race scoring panel — reveals categories one at a time for dramatic effect:
 *   step 1: Purse only (5s)
 *   step 2: +Money (5s)
 *   step 3: +Jockey Bonus (5s)
 *   step 4: +Horses (ability deltas) (5s)
 *   step 5: +Bets → final standings
 * Player order is re-sorted by the running revealed total at each step.
 */
/**
 * Animates a number from the previous value to `target` over `durationMs`, using
 * ease-out cubic. Used by the scoring panel so per-category and per-player totals
 * tick up during the 5-second reveal window instead of snapping.
 */
function useCountUp(target: number, durationMs = 4500): number {
  const [displayed, setDisplayed] = useState(target);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const prevTargetRef = useRef(target);
  useEffect(() => {
    if (target === prevTargetRef.current) return;
    const from = displayedRef.current;
    const to = target;
    prevTargetRef.current = target;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return displayed;
}

function FinalScoringPanel({ state }: { state: LSState }) {
  const allScores = useMemo(() => calculateFinalScores(state), [state]);
  const TOTAL_STEPS = 5;
  const [step, setStep] = useState(1);
  // Lookup so the winner banner + leaderboard rows color usernames with each
  // player's preferred accent (sourced from state.players).
  const accentByPlayerId = useMemo<Record<string, string | undefined>>(() => {
    const m: Record<string, string | undefined> = {};
    for (const p of state.players) m[p.playerId] = p.accent_color;
    return m;
  }, [state.players]);

  useEffect(() => {
    if (step >= TOTAL_STEPS) return;
    const t = setTimeout(() => setStep(s => s + 1), 5000);
    return () => clearTimeout(t);
  }, [step]);

  const runningTotal = (s: typeof allScores[number]) =>
    s.purse
    + (step >= 2 ? s.money : 0)
    + (step >= 3 ? s.bonus : 0)
    + (step >= 4 ? s.abilityTotal : 0)
    + (step >= 5 ? s.bets  : 0);

  const ranked = [...allScores].sort((a, b) => {
    const diff = runningTotal(b) - runningTotal(a);
    if (diff !== 0) return diff;
    // Tiebreaker: player whose owned horse finished higher (1st > 2nd > 3rd > no podium)
    const aPodium = a.bestPodium ?? 4;
    const bPodium = b.bestPodium ?? 4;
    if (aPodium !== bPodium) return aPodium - bPodium;
    return a.seat - b.seat; // final fallback: stable seat order
  });

  // --- FLIP animation: slide rows between their old and new positions on re-sort ---
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());
  const prevTops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    rowRefs.current.forEach((el, id) => {
      if (!el) return;
      const newTop = el.getBoundingClientRect().top;
      const oldTop = prevTops.current.get(id);
      if (oldTop !== undefined && oldTop !== newTop) {
        const delta = oldTop - newTop;
        // Invert: snap back to old position with no transition
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
        // Force a reflow so the browser commits the inverted transform before we animate back
        void el.offsetHeight;
        // Play: animate to the natural (new) position
        el.style.transition = 'transform 900ms cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = '';
      }
      prevTops.current.set(id, newTop);
    });
  });

  const cats: Array<{
    key: 'purse' | 'money' | 'bonus' | 'bets' | 'abilityTotal';
    label: string;
    title: string;
    color: string;
    visibleAt: number;
    signed?: boolean;
  }> = [
    { key: 'purse',        label: 'Purse',        title: 'Purse for owned horses on the podium ($35 / $25 / $15; +$10 each with Great Appreciation)', color: 'text-amber-300',   visibleAt: 1 },
    { key: 'money',        label: 'Money',        title: 'Cash on hand at race end',                                                                    color: 'text-emerald-400', visibleAt: 2 },
    { key: 'bonus',        label: 'Jockey Bonus', title: '$5 per completed helmet + jersey combo',                                                      color: 'text-sky-300',     visibleAt: 3 },
    { key: 'abilityTotal', label: 'Horses',       title: 'Net delta from owned-horse scoring abilities',                                                color: 'text-fuchsia-300', visibleAt: 4, signed: true },
    { key: 'bets',         label: 'Bets',         title: 'Bet payouts (place odds + past-No-Bet consolation)',                                          color: 'text-emerald-400', visibleAt: 5 },
  ];

  const winner = step >= TOTAL_STEPS ? ranked[0] : null;
  const medals = ['🥇', '🥈', '🥉'];
  const currentLabel = cats[step - 1]?.label;

  return (
    <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/5 p-4">
      <div className="mb-3 text-center">
        <h2 className="text-xl font-bold text-amber-400">🏁 Final Scoring</h2>
        {winner ? (
          <p className="text-sm text-neutral-300">
            Winner: <span className="font-semibold" style={{ color: safeAccent(accentByPlayerId[winner.playerId]) }}>{winner.username}</span>
            <span className="ml-2 font-mono">${winner.total}</span>
          </p>
        ) : (
          <p className="text-xs text-neutral-400">
            Tallying… revealed: <span className="font-semibold text-emerald-300">{currentLabel}</span> ({step}/{TOTAL_STEPS})
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] table-fixed border-collapse text-sm">
          <colgroup>
            {/* Player gets a fixed share; the remaining categories + Total share the rest equally. */}
            <col style={{ width: '20%' }} />
            {cats.map(c => <col key={c.key} style={{ width: `${80 / (cats.length + 1)}%` }} />)}
            <col style={{ width: `${80 / (cats.length + 1)}%` }} />
          </colgroup>
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="px-2 py-1 text-left">Player</th>
              {cats.map(c => (
                <th
                  key={c.key}
                  className={`px-2 py-1 text-center transition ${step >= c.visibleAt ? '' : 'opacity-30'}`}
                  title={c.title}
                >
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-1 text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s, idx) => (
              <tr
                key={s.playerId}
                ref={el => { rowRefs.current.set(s.playerId, el); }}
                className="border-t border-neutral-800/60"
              >
                <td className="px-2 py-2">
                  <span className="font-medium" style={{ color: safeAccent(accentByPlayerId[s.playerId]) }}>
                    <span className="mr-1">{step >= 4 ? (medals[idx] ?? '') : ''}</span>
                    {s.username}
                  </span>
                </td>
                {cats.map(c => (
                  <CategoryCell key={c.key} value={s[c.key] as number} cat={c} visible={step >= c.visibleAt} breakdown={s.abilityBreakdown} />
                ))}
                <TotalCell target={runningTotal(s)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Single category cell — animates its dollar amount when first revealed. */
function CategoryCell({ value, cat, visible, breakdown }: {
  value: number;
  cat: { key: string; color: string; signed?: boolean };
  visible: boolean;
  breakdown: AbilityScoreEntry[];
}) {
  // Target is 0 until the category is revealed, then the actual value. The hook
  // smoothly animates from current to target over ~4.5s — happens right inside
  // the 5s reveal window before the next step ticks.
  const target = visible ? value : 0;
  const displayed = useCountUp(target);
  const ability = cat.key === 'abilityTotal' ? <AbilityCell entries={breakdown} /> : null;

  if (!visible) {
    return <td className="px-2 py-2 text-center font-mono transition"><span className="text-neutral-700">—</span></td>;
  }

  // Signed (Horses/Abilities) — show with leading + / −. Final value uses original sign;
  // mid-animation we use Math.sign(displayed) so the sign flips naturally as it crosses 0.
  if (cat.signed) {
    const sign = displayed === 0 ? 0 : displayed > 0 ? 1 : -1;
    const formatted =
      sign === 0   ? <span className="text-neutral-600">$0</span> :
      sign > 0     ? <span className={cat.color}>+${displayed}</span> :
                     <span className="text-rose-400">-${Math.abs(displayed)}</span>;
    return (
      <td className="px-2 py-2 text-center font-mono transition">
        <span className="inline-flex items-center gap-1">
          {formatted}
          {ability}
        </span>
      </td>
    );
  }

  return (
    <td className="px-2 py-2 text-center font-mono transition">
      {displayed > 0
        ? <span className={cat.color}>${displayed}</span>
        : <span className="text-neutral-600">$0</span>}
    </td>
  );
}

/** Total cell — counts up smoothly as new categories add to the running total. */
function TotalCell({ target }: { target: number }) {
  const displayed = useCountUp(target);
  return (
    <td className="px-2 py-2 text-center font-mono text-lg font-bold text-amber-400 transition">
      ${displayed}
    </td>
  );
}

/** Tiny info icon listing each ability adjustment on hover. */
function AbilityCell({ entries }: { entries: AbilityScoreEntry[] }) {
  if (entries.length === 0) return null;
  const title = entries
    .map(e => `${e.name}: ${e.delta === 0 ? 'triggered' : (e.delta > 0 ? `+$${e.delta}` : `-$${Math.abs(e.delta)}`)}`)
    .join('\n');
  return (
    <span
      title={title}
      className="cursor-help text-[10px] text-neutral-500 underline decoration-dotted"
    >
      ?
    </span>
  );
}

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
          : 'bg-emerald-500/5 ring-emerald-400 hover:bg-emerald-500/15'
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

/**
 * U-shaped horseshoe icon with nail dots. `used` flips it to a dim grey state
 * so spent wilds are visually distinct from available ones.
 */
function HorseshoeIcon({ className, used }: { className?: string; used?: boolean }) {
  const body = used ? '#3f3f46' : '#a16207';
  const stroke = used ? '#27272a' : '#451a03';
  const dots = used ? '#52525b' : '#1c1917';
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-8 w-8'} role="img" aria-label="horseshoe">
      {/* U-shaped horseshoe outline */}
      <path
        d="M 5 3 L 5 13 Q 5 18 12 18 Q 19 18 19 13 L 19 3 L 15.5 3 L 15.5 13 Q 15.5 15.5 12 15.5 Q 8.5 15.5 8.5 13 L 8.5 3 Z"
        fill={body}
        stroke={stroke}
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      {/* Nail holes — 2 per side */}
      <circle cx="6.75" cy="5"  r="0.7" fill={dots} />
      <circle cx="17.25" cy="5" r="0.7" fill={dots} />
      <circle cx="6.75" cy="9"  r="0.7" fill={dots} />
      <circle cx="17.25" cy="9" r="0.7" fill={dots} />
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
                canClick ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-neutral-950' : 'cursor-default'
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

/**
 * Diamond-shaped horse badge — same color scheme as HorseDot but rotated 45° and larger.
 * Used in places where we want a more prominent "the rolled horse" visual.
 */
function HorseDiamond({ num, size = 'md' }: { num: number; size?: 'md' | 'lg' }) {
  // `size` controls outer bounding box AND the inner rotated square / text size together.
  const box = size === 'lg' ? 'h-12 w-12' : 'h-9 w-9';
  const inner = size === 'lg' ? 'h-8 w-8' : 'h-6 w-6';
  const text = size === 'lg' ? 'text-lg' : 'text-sm';
  const textColor = num === 2 ? '#0a0a0a' : '#ffffff';
  return (
    <span className={`inline-flex ${box} shrink-0 items-center justify-center`}>
      <span
        className={`relative inline-flex ${inner} rotate-45 rounded-sm shadow-lg`}
        style={{ backgroundColor: HORSE_COLORS[num - 1] }}
      >
        <span
          className={`absolute inset-0 flex -rotate-45 items-center justify-center ${text} font-bold leading-none`}
          style={{ color: textColor }}
        >
          {num}
        </span>
      </span>
    </span>
  );
}

function Track({ state, bonusPick, infieldMessage }: {
  state: LSState;
  /** When set, horses whose number is in `eligible` are clickable (movement-bonus selection). */
  bonusPick?: { eligible: Set<number>; onPick: (horseNum: number) => void };
  /** Effective horse for the current action turn (rolled or wild). Renders the
   *  "When the [N] horse moves…" tagline in the infield. */
  infieldMessage?: { effectiveHorse: number; wildHorse: number | null; onClearWild?: () => void };
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

        {/* No-Bet line — candy-cane: bright red base + white dashes on top */}
        <line x1={noBetInner.x} y1={noBetInner.y} x2={noBetOuter.x} y2={noBetOuter.y}
              stroke="#ff2020" strokeWidth="6" />
        <line x1={noBetInner.x} y1={noBetInner.y} x2={noBetOuter.x} y2={noBetOuter.y}
              stroke="#fff" strokeWidth="6" strokeDasharray="4 4" />


        {/* Horse tokens — sequenced, with starting-gate column behind the line */}
        {horses.map((_, i) => {
          if (finished[i]) return null;
          const horseNum = i + 1;
          const animPos = positions[i] ?? 0;
          const intPos = Math.round(animPos);

          // --- On-track position. For 1-3 horses on a space: diagonal stack (lowest # = front-inner).
          // For 4+ horses: tight 2D grid (max 3 per row, multiple rows stacked radially) so we
          // don't overflow into adjacent spaces.
          const ovalAngle = angleForPosition(animPos);
          const ovalCenter = pointOnOval(ovalAngle, TRACK_RX, TRACK_RY);
          const ovalTan = tangentAt(ovalAngle, TRACK_RX, TRACK_RY); // points "backward" (against travel)
          const group = (byPos.get(intPos) ?? [horseNum]).slice().sort((a, b) => a - b);
          const stackIdx = group.indexOf(horseNum);                  // 0 = lowest horse num
          const stackCount = group.length;

          let forwardX = 0, forwardY = 0, innerX = 0, innerY = 0;
          if (stackCount > 3) {
            // Grid layout: max 3 per row, rows stacked radially inner→outer
            const PER_ROW = 3;
            const STEP = 15;
            const rowCount = Math.ceil(stackCount / PER_ROW);
            const rowIdx = Math.floor(stackIdx / PER_ROW);
            const colIdx = stackIdx % PER_ROW;
            const colsInThisRow = rowIdx === rowCount - 1
              ? stackCount - rowIdx * PER_ROW
              : PER_ROW;
            // Inwardness: positive = closer to infield, negative = closer to outer rail
            const inwardness = (rowCount - 1) / 2 - rowIdx;
            innerX = -Math.cos(ovalAngle) * inwardness * STEP;
            innerY = -Math.sin(ovalAngle) * inwardness * STEP;
            // Forwardness within row: positive = toward next space, negative = toward previous
            const forwardness = (colsInThisRow - 1) / 2 - colIdx;
            forwardX = -ovalTan.x * forwardness * STEP;
            forwardY = -ovalTan.y * forwardness * STEP;
          } else {
            // Diagonal stack (existing behavior for 1-3 horses)
            const STACK_STEP = stackCount > 1 ? 15 : 0;
            const centerOffset = (stackCount - 1) / 2 - stackIdx;
            forwardX = -ovalTan.x * centerOffset * STACK_STEP;
            forwardY = -ovalTan.y * centerOffset * STACK_STEP;
            innerX = -Math.cos(ovalAngle) * centerOffset * STACK_STEP;
            innerY = -Math.sin(ovalAngle) * centerOffset * STACK_STEP;
          }
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

        {/* Infield message: "When the [N] horse moves…" — sits in the green center of the oval */}
        {infieldMessage && (
          <foreignObject
            x={TRACK_CX - 130}
            y={TRACK_CY - 28}
            width="260"
            height="56"
            style={{ overflow: 'visible' }}
          >
            <div className="flex h-full items-center justify-center gap-2 text-center text-sm font-medium text-white drop-shadow">
              <span>When the</span>
              <HorseDiamond num={infieldMessage.effectiveHorse} size="lg" />
              <span>horse moves…</span>
              {infieldMessage.wildHorse !== null && infieldMessage.onClearWild && (
                <button
                  onClick={infieldMessage.onClearWild}
                  title="Clear Wild — go back to the rolled horse"
                  className="ml-1 rounded border border-amber-300 bg-amber-500/30 px-1.5 py-0 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/60"
                >
                  Wild ✕
                </button>
              )}
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

// =====================================================================
// Pending ability choice picker (Phase 4) — full-width banner shown to the
// player who triggered an ability that requires a choice. All eight kinds
// share the same shell; the body switches on `pending.kind`.
// =====================================================================
function PendingChoicePicker({ state, pending, disabled, onResolve }: {
  state: LSState;
  pending: PendingChoice;
  disabled: boolean;
  onResolve: (choice: PendingChoiceResolution) => void;
}) {
  const me = state.players.find(p => p.playerId === pending.playerId);
  const isCharley = pending.kind === 'charley_horse';
  const isFairPlay = pending.kind === 'fair_play';
  const isChain   = pending.kind === 'chain_reaction';
  const isHalfOff = pending.kind === 'half_off_sale';
  const isPartner = pending.kind === 'partner_in_crime';
  const isMiracle = pending.kind === 'miracle_worker';
  const isInv     = pending.kind === 'inventory_check';
  const isDouble  = pending.kind === 'double_crosser';

  // Title + helper text
  const title =
    isHalfOff ? 'Half Off Sale — pick a horse to buy at half price' :
    isPartner ? 'Partner in Crime — pick a second horse to advance +2' :
    isMiracle ? 'Miracle Worker — pick a bonus' :
    isInv     ? `Inventory Check — pick a horse for jersey ${3 - (pending as Extract<PendingChoice, {kind:'inventory_check'}>).remaining} of 2` :
    isChain   ? 'Chain Reaction — mark any unmarked concession cell' :
    isCharley ? 'Charley Horse — pick a horse to move back 1' :
    isFairPlay? 'Fair Play — pick a horse (not tied for the lead) to advance +2' :
    isDouble  ? `Double Crosser — pick a second horse to mark on horse ${(pending as Extract<PendingChoice, {kind:'double_crosser'}>).rolledHorse}'s bar` :
    'Resolve your ability';

  return (
    <div className="rounded-xl border-2 border-fuchsia-500/60 bg-fuchsia-500/5 p-3 text-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-semibold text-fuchsia-200">✨ {title}</span>
        {me && <span className="text-[11px] text-neutral-400">acting: {me.username}</span>}
      </div>
      <PickerBody state={state} pending={pending} disabled={disabled} onResolve={onResolve} />
    </div>
  );
}

function PickerBody({ state, pending, disabled, onResolve }: {
  state: LSState;
  pending: PendingChoice;
  disabled: boolean;
  onResolve: (choice: PendingChoiceResolution) => void;
}) {
  const skipBtn = (kind: PendingChoiceResolution['kind'], label = 'Skip') => (
    <button
      onClick={() => onResolve(
        kind === 'inventory_check'
          ? { kind: 'inventory_check', horseNum: null }
          : kind === 'miracle_worker'
            ? { kind: 'miracle_worker', option: 'concession' } // never used — miracle_worker has no skip
            : { kind, horseNum: null } as PendingChoiceResolution
      )}
      disabled={disabled}
      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
    >
      {label}
    </button>
  );

  switch (pending.kind) {
    case 'half_off_sale': {
      const meIdx = state.players.findIndex(p => p.playerId === pending.playerId);
      const me = state.players[meIdx];
      return (
        <div className="flex flex-wrap items-center gap-2">
          {state.market.map(h => {
            const half = Math.floor(effectiveHorseCost(state, h) / 2);
            const tooPoor = me && me.money < half;
            const finished = state.horses[h - 1].finished !== null;
            return (
              <button
                key={h}
                disabled={disabled || tooPoor || finished}
                onClick={() => onResolve({ kind: 'half_off_sale', horseNum: h })}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition ${
                  tooPoor || finished
                    ? 'border-neutral-800 bg-neutral-950/40 text-neutral-600 opacity-50'
                    : 'border-emerald-500 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                }`}
                title={tooPoor ? `Need $${half}` : `Buy horse ${h} for $${half}`}
              >
                <HorseDot num={h} />
                <span className="font-mono">${half}</span>
              </button>
            );
          })}
          {state.market.length === 0 && <span className="text-xs text-neutral-500">Market is empty.</span>}
          {skipBtn('half_off_sale')}
        </div>
      );
    }

    case 'partner_in_crime':
    case 'fair_play':
    case 'charley_horse': {
      // Horse picks happen by clicking the highlighted horse directly on the track.
      // Lead = max position among UNFINISHED horses (finished horses are off the track).
      const liveHorses = state.horses.filter(h => !h.finished);
      const maxLivePos = liveHorses.length > 0 ? Math.max(...liveHorses.map(h => h.position)) : -1;
      const anyEligible = state.horses.some((h, i) => {
        if (h.finished) return false;
        if (pending.kind === 'fair_play' && h.position === maxLivePos) return false;
        if (pending.kind === 'partner_in_crime' && i + 1 === 6) return false;
        return true;
      });
      return (
        <div className="flex items-center gap-2 text-xs text-neutral-300">
          <span>👉 Click a highlighted horse on the track.</span>
          {!anyEligible && <span className="text-neutral-500">(No eligible horses.)</span>}
          {skipBtn(pending.kind)}
        </div>
      );
    }

    case 'chain_reaction': {
      const meIdx = state.players.findIndex(p => p.playerId === pending.playerId);
      const me = state.players[meIdx];
      if (!me) return null;
      return (
        <div className="space-y-2">
          <p className="text-[11px] text-neutral-400">Click any unmarked cell on your grid.</p>
          <div className="grid w-fit grid-cols-4 gap-1">
            {state.concessionGrid.map((horseNum, idx) => {
              const marked = me.concessionMarks[idx];
              return (
                <button
                  key={idx}
                  disabled={disabled || marked}
                  onClick={() => onResolve({ kind: 'chain_reaction', cellIdx: idx })}
                  className={`flex h-8 w-8 items-center justify-center rounded text-xs font-bold transition ${
                    marked
                      ? 'cursor-not-allowed bg-neutral-800 text-neutral-600 line-through'
                      : 'text-white hover:scale-105 hover:ring-2 hover:ring-emerald-300'
                  }`}
                  style={{ backgroundColor: marked ? undefined : HORSE_COLORS[horseNum - 1] }}
                  title={`Mark cell (horse ${horseNum})`}
                >
                  {horseNum}
                </button>
              );
            })}
          </div>
          {skipBtn('chain_reaction')}
        </div>
      );
    }

    case 'inventory_check': {
      const meIdx = state.players.findIndex(p => p.playerId === pending.playerId);
      const me = state.players[meIdx];
      const candidates: number[] = [];
      for (let i = 0; i < NUM_HORSES; i++) {
        if (me && me.jerseys[i] < MAX_JERSEYS_PER_HORSE) candidates.push(i + 1);
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          {candidates.map(h => (
            <button
              key={h}
              disabled={disabled}
              onClick={() => onResolve({ kind: 'inventory_check', horseNum: h })}
              className="flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <HorseDot num={h} />
              <span>Jersey</span>
            </button>
          ))}
          {candidates.length === 0 && <span className="text-xs text-neutral-500">No horses without a jersey.</span>}
          {skipBtn('inventory_check', 'Skip remaining')}
        </div>
      );
    }

    case 'miracle_worker': {
      return <MiracleWorkerPicker state={state} pending={pending} disabled={disabled} onResolve={onResolve} />;
    }

    case 'double_crosser': {
      const dc = pending as Extract<PendingChoice, { kind: 'double_crosser' }>;
      const onBar = allMarksOnBar(state, dc.rolledHorse);
      const candidates: number[] = [];
      for (let h = 1; h <= NUM_HORSES; h++) if (!onBar.has(h)) candidates.push(h);
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-neutral-400">On horse {dc.rolledHorse}&rsquo;s bar:</span>
          {candidates.map(h => (
            <button
              key={h}
              disabled={disabled}
              onClick={() => onResolve({ kind: 'double_crosser', horseNum: h })}
              className="flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <HorseDot num={h} />
              <span>mark</span>
            </button>
          ))}
          {candidates.length === 0 && <span className="text-xs text-neutral-500">Bar is full.</span>}
          {skipBtn('double_crosser')}
        </div>
      );
    }
  }
}

/** Miracle Worker has its own sub-state for picking between concession / helmet / jersey. */
function MiracleWorkerPicker({ state, pending, disabled, onResolve }: {
  state: LSState;
  pending: PendingChoice;
  disabled: boolean;
  onResolve: (choice: PendingChoiceResolution) => void;
}) {
  const [mode, setMode] = useState<'pick' | 'concession' | 'helmet' | 'jersey'>('pick');
  const [jerseyHorse, setJerseyHorse] = useState<number | null>(null);
  const meIdx = state.players.findIndex(p => p.playerId === pending.playerId);
  const me = state.players[meIdx];
  if (!me) return null;

  if (mode === 'pick') {
    return (
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setMode('concession')} disabled={disabled}
          className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
          Mark a concession cell
        </button>
        <button onClick={() => setMode('helmet')} disabled={disabled}
          className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
          Mark a helmet
        </button>
        <button onClick={() => setMode('jersey')} disabled={disabled}
          className="rounded border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50">
          Mark a jersey
        </button>
      </div>
    );
  }

  if (mode === 'concession') {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-neutral-400">Click any unmarked cell on your grid.</p>
        <div className="grid w-fit grid-cols-4 gap-1">
          {state.concessionGrid.map((horseNum, idx) => {
            const marked = me.concessionMarks[idx];
            return (
              <button
                key={idx}
                disabled={disabled || marked}
                onClick={() => onResolve({ kind: 'miracle_worker', option: 'concession', cellIdx: idx })}
                className={`flex h-8 w-8 items-center justify-center rounded text-xs font-bold transition ${
                  marked ? 'cursor-not-allowed bg-neutral-800 text-neutral-600 line-through'
                         : 'text-white hover:scale-105 hover:ring-2 hover:ring-emerald-300'
                }`}
                style={{ backgroundColor: marked ? undefined : HORSE_COLORS[horseNum - 1] }}
              >
                {horseNum}
              </button>
            );
          })}
        </div>
        <button onClick={() => setMode('pick')} className="text-xs text-neutral-400 underline">← back</button>
      </div>
    );
  }

  if (mode === 'helmet') {
    const candidates: number[] = [];
    for (let i = 0; i < NUM_HORSES; i++) if (me.helmets[i] < MAX_HELMETS_PER_HORSE) candidates.push(i + 1);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {candidates.map(h => (
          <button
            key={h}
            disabled={disabled}
            onClick={() => onResolve({ kind: 'miracle_worker', option: 'helmet', horseNum: h })}
            className="flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <HorseDot num={h} /><span>helmet</span>
          </button>
        ))}
        {candidates.length === 0 && <span className="text-xs text-neutral-500">All horses already have a helmet.</span>}
        <button onClick={() => setMode('pick')} className="text-xs text-neutral-400 underline">← back</button>
      </div>
    );
  }

  // jersey: pick horse card, then pick mark
  if (jerseyHorse === null) {
    const candidates: number[] = [];
    for (let i = 0; i < NUM_HORSES; i++) if (me.jerseys[i] < MAX_JERSEYS_PER_HORSE) candidates.push(i + 1);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-neutral-400">Pick a horse card to jersey:</span>
        {candidates.map(h => (
          <button
            key={h}
            disabled={disabled}
            onClick={() => setJerseyHorse(h)}
            className="flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <HorseDot num={h} />
          </button>
        ))}
        {candidates.length === 0 && <span className="text-xs text-neutral-500">All horses already have a jersey.</span>}
        <button onClick={() => setMode('pick')} className="text-xs text-neutral-400 underline">← back</button>
      </div>
    );
  }
  const onBar = allMarksOnBar(state, jerseyHorse);
  const marks: number[] = [];
  for (let h = 1; h <= NUM_HORSES; h++) if (!onBar.has(h)) marks.push(h);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-neutral-400">Jersey on horse {jerseyHorse}. Pick a mark for its bar:</span>
      {marks.map(m => (
        <button
          key={m}
          disabled={disabled}
          onClick={() => onResolve({ kind: 'miracle_worker', option: 'jersey', horseNum: jerseyHorse, markHorse: m })}
          className="flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <HorseDot num={m} />
        </button>
      ))}
      <button onClick={() => setJerseyHorse(null)} className="text-xs text-neutral-400 underline">← back</button>
    </div>
  );
}

// =====================================================================
// Horse abilities panel (one per horse, picked at race start) — also acts as
// the "market" surface for buying horses (click the row when it's your turn).
// =====================================================================
function AbilitiesPanel({ state, me, action, bonus }: {
  state: LSState;
  me?: LSPlayer;
  action?: SheetAction;
  bonus?: SheetBonus;
}) {
  const ownerByHorse = useMemo(() => {
    const m = new Map<number, LSPlayer>();
    for (const p of state.players) for (const h of p.ownedHorses) m.set(h, p);
    return m;
  }, [state.players]);

  return (
    <details className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 text-sm" open>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-neutral-400">
        Horse abilities
      </summary>
      <ul className="mt-2 grid auto-rows-fr gap-1.5 sm:grid-cols-2">
        {Array.from({ length: NUM_HORSES }, (_, i) => i + 1).map(horseNum => {
          const i = horseNum - 1;
          const id = state.assignedAbilities[horseNum];
          const ability = id ? ABILITY_BY_ID[id] : null;
          const owner = ownerByHorse.get(horseNum);
          const finished = state.horses[i]?.finished ?? null;
          const baseCost = HORSE_COSTS[i];
          const cost = effectiveHorseCost(state, horseNum);
          const costModified = cost !== baseCost;
          const ownedByMe = !!(me && owner?.playerId === me.playerId);
          const inMarket = state.market.includes(horseNum);
          // Reusable price label: shows the base $cost; when an ability has modified it,
          // shows the original with strikethrough and the new value in emerald.
          const priceLabel = costModified ? (
            <span className="inline-flex items-baseline gap-1" title={`Ability modifier · normally $${baseCost}`}>
              <span className="text-neutral-500 line-through">${baseCost}</span>
              <span className="text-emerald-300">${cost}</span>
            </span>
          ) : (
            <span>${cost}</span>
          );

          // Decide what right-side status / button to render.
          // Priority: finished > owned-by-me > Free Horse bonus pending > other-owner
          //         > active-turn buyable > wild buyable > plain $cost (dormant).
          let right: React.ReactNode;
          if (finished) {
            right = (
              <span className="text-[11px] font-semibold text-amber-300">
                {finished === 1 ? '🥇 1st' : finished === 2 ? '🥈 2nd' : '🥉 3rd'}
                {owner && <span className="ml-1 text-sky-300">— {owner.username}</span>}
              </span>
            );
          } else if (ownedByMe) {
            right = <span className="text-[11px] font-semibold text-emerald-300">owned 🏠</span>;
          } else if (bonus?.targets?.market?.has(horseNum)) {
            right = (
              <button
                disabled={bonus.disabled}
                onClick={() => bonus.onPick(horseNum)}
                className="rounded border border-emerald-500 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                title={`Claim horse ${horseNum} free (bonus)`}
              >
                FREE
              </button>
            );
          } else if (owner) {
            right = <span className="truncate text-[11px] text-sky-300">{owner.username}</span>;
          } else if (action && inMarket && horseNum === action.effectiveHorse && action.canBuy) {
            right = (
              <button
                disabled={action.disabled}
                onClick={() => action.send({ type: 'buy' })}
                className="rounded border border-emerald-500 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                title={`Buy horse ${horseNum} for $${cost}${costModified ? ` (ability discount from $${baseCost})` : ''}`}
              >
                Buy <span className="inline-flex items-baseline gap-1">
                  {costModified && <span className="text-emerald-200/60 line-through">${baseCost}</span>}
                  <span>${cost}</span>
                </span>
              </button>
            );
          } else if (action?.wildTargets?.buy.has(horseNum)) {
            right = (
              <button
                disabled={action.disabled}
                onClick={() => action.sendWithWild(horseNum, { type: 'buy' })}
                className="rounded border border-amber-500 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-50"
                title={`Wild + buy horse ${horseNum} ($${cost})${costModified ? ` (ability discount from $${baseCost})` : ''}`}
              >
                Wild + <span className="inline-flex items-baseline gap-1">
                  {costModified && <span className="text-amber-200/60 line-through">${baseCost}</span>}
                  <span>${cost}</span>
                </span>
              </button>
            );
          } else {
            right = <span className="text-[11px] font-mono text-neutral-400">{priceLabel}</span>;
          }

          return (
            <li
              key={horseNum}
              className={`rounded-md border px-2 py-1.5 ${owner ? 'border-emerald-900/50 bg-emerald-500/5' : 'border-neutral-800 bg-neutral-950/40'}`}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: HORSE_COLORS[i] }}
                  title={`Horse ${horseNum}`}
                >
                  {horseNum}
                </span>
                <span className="text-[13px] font-semibold text-neutral-100">
                  {ability?.name ?? '—'}
                </span>
                <span className="ml-auto">{right}</span>
              </div>
              {ability && (
                <p className="mt-0.5 min-h-[2.7rem] text-[11px] leading-snug text-neutral-400">
                  {ability.description}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
