'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type LSState, type LSMove, type HorseFinish,
  TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES,
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

function angleForPosition(pos: number): number {
  // pos = 0 at bottom, counterclockwise on screen
  return Math.PI / 2 - (2 * Math.PI * pos) / TRACK_LENGTH;
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
  moveDurationMs = 550,
  gapMs = 120,
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
          <Die label="Horse" value={state.horseDie} color="bg-amber-500 text-neutral-950" caption="d8" />
          <Die label="Move"  value={state.movementDie} color="bg-emerald-500 text-neutral-950" caption="1·2·2·2·3·3" />
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
      <Track state={state} />

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

function Die({ label, value, color, caption }: { label: string; value: number | null; color: string; caption: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-md font-bold shadow-md ${
        value !== null ? color : 'bg-neutral-800 text-neutral-600'
      }`}>
        {value ?? '?'}
      </div>
      <span className="mt-0.5 text-[9px] text-neutral-600">{caption}</span>
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

        {/* Space number labels — small, on the inner rail; space 0 shows "S/F" */}
        {Array.from({ length: TRACK_LENGTH }, (_, i) => {
          const a = angleForPosition(i);
          const labelPt = pointOnOval(a, TRACK_RX - TRACK_HALF_WIDTH - 12, TRACK_RY - TRACK_HALF_WIDTH - 12);
          const past = i >= NO_BET_SPACE;
          const label = i === 0 ? 'S/F' : String(i);
          return (
            <text key={`lbl-${i}`} x={labelPt.x} y={labelPt.y + 3}
              fontSize={i === 0 ? '10' : '9'} fontWeight="bold" textAnchor="middle"
              fill={i === 0 ? '#34d399' : past ? '#fca5a5' : '#fafafa'}
              opacity="0.9"
            >
              {label}
            </text>
          );
        })}

        {/* Horse tokens — sequenced, with starting-gate column behind the line */}
        {horses.map((_, i) => {
          if (finished[i]) return null;
          const horseNum = i + 1;
          const animPos = positions[i] ?? 0;
          const intPos = Math.round(animPos);

          // --- On-track position: tangential stacking along the oval at the animated position
          const ovalAngle = angleForPosition(animPos);
          const ovalCenter = pointOnOval(ovalAngle, TRACK_RX, TRACK_RY);
          const ovalTan = tangentAt(ovalAngle, TRACK_RX, TRACK_RY);
          const group = byPos.get(intPos) ?? [horseNum];
          const stackIdx = group.indexOf(horseNum);
          const stackCount = group.length;
          const tangentSpacing = stackCount > 1 ? Math.min(13, 44 / Math.max(1, stackCount - 1)) : 0;
          const tangentOffset = (stackIdx - (stackCount - 1) / 2) * tangentSpacing;
          const ovalX = ovalCenter.x + ovalTan.x * tangentOffset;
          const ovalY = ovalCenter.y + ovalTan.y * tangentOffset;

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
