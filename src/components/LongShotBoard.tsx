'use client';

import {
  type LSState, TRACK_LENGTH, NO_BET_SPACE, HORSE_COLORS, NUM_HORSES,
} from '@/lib/games/longshot';

// Oval geometry: viewBox 400x220, centered at (200,110), counterclockwise on screen
// starting at bottom-middle (matches real horse-racing direction).
const TRACK_CX = 200;
const TRACK_CY = 110;
const TRACK_RX = 165;
const TRACK_RY = 75;

function angleForSpace(i: number): number {
  // i = 0 at bottom, counterclockwise on screen (bottom → right → top → left → bottom)
  return Math.PI / 2 - (2 * Math.PI * i) / TRACK_LENGTH;
}

function pointOnOval(angle: number, rx: number, ry: number) {
  return { x: TRACK_CX + rx * Math.cos(angle), y: TRACK_CY + ry * Math.sin(angle) };
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
  // Group horses by position; finished horses are not on the track
  const byPos = new Map<number, number[]>();
  horses.forEach((h, i) => {
    if (h.finished) return;
    const list = byPos.get(h.position) ?? [];
    list.push(i + 1);
    byPos.set(h.position, list);
  });

  // Pre-compute label/horse positions for each of the 16 spaces
  const spaceData = Array.from({ length: TRACK_LENGTH }, (_, i) => {
    const angle = angleForSpace(i);
    return { i, angle, ...pointOnOval(angle, (TRACK_RX + TRACK_RY) / 2 + 18, (TRACK_RY + TRACK_RY * 0.4)) };
  });

  // No-Bet line: drawn between space 11 and 12 (i.e., at angle midway)
  const noBetAngle = (angleForSpace(NO_BET_SPACE - 1) + angleForSpace(NO_BET_SPACE)) / 2;
  const noBetInner  = pointOnOval(noBetAngle, TRACK_RX - 35, TRACK_RY - 14);
  const noBetOuter  = pointOnOval(noBetAngle, TRACK_RX + 14, TRACK_RY + 6);

  // Start/Finish line: at angle of space 0 (bottom)
  const finishAngle = angleForSpace(0);
  const finishInner = pointOnOval(finishAngle, TRACK_RX - 35, TRACK_RY - 14);
  const finishOuter = pointOnOval(finishAngle, TRACK_RX + 14, TRACK_RY + 6);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3">
      <svg viewBox="0 0 400 220" className="block h-auto w-full">
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

        <rect width="400" height="220" fill="url(#ls-track-sky)" rx="6" />

        {/* Track surface (outer ring) */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX + 14} ry={TRACK_RY + 14} fill="#fafafa" />
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX + 12} ry={TRACK_RY + 12} fill="url(#ls-track-turf)" />
        {/* Infield (grass) */}
        <ellipse cx={TRACK_CX} cy={TRACK_CY} rx={TRACK_RX - 35} ry={TRACK_RY - 14} fill="url(#ls-track-infield)" stroke="#fafafa" strokeWidth="1.5" />

        {/* Start/Finish line — emerald with stripes */}
        <line x1={finishInner.x} y1={finishInner.y} x2={finishOuter.x} y2={finishOuter.y}
              stroke="#34d399" strokeWidth="3" />
        <line x1={finishInner.x} y1={finishInner.y} x2={finishOuter.x} y2={finishOuter.y}
              stroke="#fafafa" strokeWidth="3" strokeDasharray="2 2" />
        <text x={finishOuter.x} y={finishOuter.y + 14} fill="#34d399" fontSize="9" fontWeight="bold" textAnchor="middle">
          START / FINISH
        </text>

        {/* No-Bet line — red */}
        <line x1={noBetInner.x} y1={noBetInner.y} x2={noBetOuter.x} y2={noBetOuter.y}
              stroke="#ef4444" strokeWidth="3" strokeDasharray="3 2" />
        <text x={noBetOuter.x - 4} y={noBetOuter.y - 4} fill="#fca5a5" fontSize="8" fontWeight="bold" textAnchor="end">
          NO-BET
        </text>

        {/* Space markers around the track (small numbered dots on the rail) */}
        {Array.from({ length: TRACK_LENGTH }, (_, i) => {
          const a = angleForSpace(i);
          const railOuter = pointOnOval(a, TRACK_RX + 9, TRACK_RY + 9);
          const past = i >= NO_BET_SPACE;
          return (
            <g key={`sp-${i}`}>
              <circle cx={railOuter.x} cy={railOuter.y} r="6" fill="#1f2937" stroke={past ? '#7f1d1d' : '#374151'} strokeWidth="1" />
              <text x={railOuter.x} y={railOuter.y + 3} fontSize="8" textAnchor="middle"
                    fill={past ? '#fca5a5' : '#9ca3af'} fontWeight="bold">
                {i}
              </text>
            </g>
          );
        })}

        {/* Horse tokens — placed at each space's location, stacked radially when sharing */}
        {spaceData.map(({ i, angle }) => {
          const occupants = byPos.get(i) ?? [];
          if (occupants.length === 0) return null;
          // base ring radius (just inside the rail)
          const baseRx = TRACK_RX - 14;
          const baseRy = TRACK_RY - 14;
          return (
            <g key={`occ-${i}`}>
              {occupants.map((horseNum, idx) => {
                // Offset each subsequent horse outward by 11px so they stack visually
                const inward = idx * 13;
                const p = pointOnOval(angle, baseRx - inward, baseRy - inward * 0.7);
                return (
                  <g key={horseNum}>
                    <circle cx={p.x} cy={p.y} r="7.5" fill={HORSE_COLORS[horseNum - 1]} stroke="#0a0a0a" strokeWidth="1" />
                    <text x={p.x} y={p.y + 3} fontSize="9" textAnchor="middle" fontWeight="bold"
                          fill={horseNum === 2 ? '#0a0a0a' : '#fafafa'}>
                      {horseNum}
                    </text>
                  </g>
                );
              })}
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
