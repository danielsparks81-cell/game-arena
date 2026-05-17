'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type LSState, TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES,
} from '@/lib/games/longshot';

// Oval geometry: viewBox 440x260, centered, counterclockwise on screen
// starting at bottom-middle (matches real horse-racing direction).
const VIEW_W = 440;
const VIEW_H = 260;
const TRACK_CX = 220;
const TRACK_CY = 130;
const TRACK_RX = 185;             // horizontal radius (rail centerline)
const TRACK_RY = 100;              // vertical radius
const TRACK_HALF_WIDTH = 26;       // half the track surface width (outer rail to inner rail = 52px)

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

/** Animate an array of numbers toward `targets` over `durationMs`. Returns the live interpolated values. */
function useAnimatedNumbers(targets: number[], durationMs = 700): number[] {
  const [displayed, setDisplayed] = useState<number[]>(() => targets.slice());
  const animsRef = useRef<{ from: number; to: number; start: number }[]>(targets.map(t => ({ from: t, to: t, start: 0 })));
  const rafRef = useRef<number | null>(null);
  const key = targets.join(',');

  useEffect(() => {
    const now = performance.now();
    // Seed animations: new `from` = current displayed value, `to` = new target
    setDisplayed(prev => {
      animsRef.current = targets.map((to, i) => ({ from: prev[i] ?? to, to, start: now }));
      return prev;
    });

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = (t: number) => {
      let stillAnimating = false;
      const next = animsRef.current.map(anim => {
        const progress = Math.min(1, (t - anim.start) / durationMs);
        if (progress < 1) stillAnimating = true;
        // ease-in-out cubic
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        return anim.from + (anim.to - anim.from) * eased;
      });
      setDisplayed(next);
      if (stillAnimating) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // Re-run only when the actual target values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, durationMs]);

  return displayed;
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

function Track({ horses }: { horses: LSState['horses'] }) {
  // Animate each horse's track position smoothly (finished horses don't render here).
  // For finished horses we just hold their last position so they don't fly back.
  const targets = horses.map(h => (h.finished ? -1 : h.position));
  const liveTargets = targets.map(t => (t < 0 ? 0 : t)); // -1 (finished) renders as 0 but hidden via opacity
  const animated = useAnimatedNumbers(liveTargets, 750);

  // Group horses by INTEGER target position for tangential stacking
  const byPos = new Map<number, number[]>();
  horses.forEach((h, i) => {
    if (h.finished) return;
    const list = byPos.get(h.position) ?? [];
    list.push(i + 1);
    byPos.set(h.position, list);
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

        {/* Equidistant separator lines between each pair of consecutive spaces */}
        {Array.from({ length: TRACK_LENGTH }, (_, i) => {
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

        {/* Space number labels — small, on the inner rail */}
        {Array.from({ length: TRACK_LENGTH }, (_, i) => {
          const a = angleForPosition(i);
          const labelPt = pointOnOval(a, TRACK_RX - TRACK_HALF_WIDTH - 10, TRACK_RY - TRACK_HALF_WIDTH - 10);
          const past = i >= NO_BET_SPACE;
          return (
            <text key={`lbl-${i}`} x={labelPt.x} y={labelPt.y + 3}
              fontSize="9" fontWeight="bold" textAnchor="middle"
              fill={past ? '#fca5a5' : '#fafafa'}
              opacity="0.85"
            >
              {i}
            </text>
          );
        })}

        {/* Horse tokens — animated along the oval, stacked tangentially per space */}
        {horses.map((h, i) => {
          if (h.finished) return null;
          const horseNum = i + 1;
          const animPos = animated[i] ?? h.position;
          const angle = angleForPosition(animPos);
          // Find this horse's index within its space group for tangential offset
          const group = byPos.get(h.position) ?? [horseNum];
          const stackIdx = group.indexOf(horseNum);
          const stackCount = group.length;
          // Spread up to 6 horses tangentially within ±18px; collapse beyond that
          const spacing = stackCount > 1 ? Math.min(11, 36 / Math.max(1, stackCount - 1)) : 0;
          const tangentOffset = (stackIdx - (stackCount - 1) / 2) * spacing;
          const center = pointOnOval(angle, TRACK_RX, TRACK_RY);
          const tan = tangentAt(angle, TRACK_RX, TRACK_RY);
          const x = center.x + tan.x * tangentOffset;
          const y = center.y + tan.y * tangentOffset;
          return (
            <g key={`horse-${horseNum}`}>
              <circle cx={x} cy={y} r="9" fill={HORSE_COLORS[horseNum - 1]} stroke="#0a0a0a" strokeWidth="1.25" />
              <text x={x} y={y + 3.5} fontSize="10.5" textAnchor="middle" fontWeight="bold"
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
