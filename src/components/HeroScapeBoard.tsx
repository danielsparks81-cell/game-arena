'use client';

// HeroScape board — slice 1 (Basic Game on the Training Field).
// Flat map, fixed armies, alternate turns: pick ONE card, move its figures,
// then attack. All legality comes from the engine's pure helpers so the
// highlights can never disagree with the server's validation.

import { useMemo, useState } from 'react';
import {
  type HSState,
  type Figure,
  type CombatFace,
  type HexKey,
  MAPS,
  HS_CARDS,
  legalDestinations,
  legalTargets,
  figureLabel,
  hexToPixel,
  hexCorners,
} from '@/lib/games/heroscape';

const HEX = 34; // px size of a unit hex
const PAD = 26;

const SEAT_COLORS = ['#34d399', '#f87171']; // fallback accents by roster index

type Props = {
  state: HSState;
  currentUserId: string;
  isHost: boolean;
  disabled?: boolean;
  onStart: () => void;
  onMoveFigure: (figureId: string, to: HexKey) => void;
  onAttack: (attackerId: string, targetId: string) => void;
  onEndTurn: () => void;
};

function DieFace({ face, size = 22 }: { face: CombatFace; size?: number }) {
  const fill = face === 'skull' ? '#7f1d1d' : face === 'shield' ? '#1e3a8a' : '#404040';
  const glyph = face === 'skull' ? '💀' : face === 'shield' ? '🛡' : '';
  return (
    <span
      className="inline-flex items-center justify-center rounded border border-neutral-600 bg-neutral-100/10"
      style={{ width: size, height: size, fontSize: size * 0.55, background: fill }}
      title={face}
    >
      {glyph}
    </span>
  );
}

export default function HeroScapeBoard({
  state, currentUserId, isHost, disabled,
  onStart, onMoveFigure, onAttack, onEndTurn,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const map = MAPS[state.mapId];
  const me = state.players.find(p => p.playerId === currentUserId);
  const turnPlayer = state.players.find(p => p.seat === state.turnSeat);
  const myTurn = state.phase === 'playing' && !!me && state.turnSeat === me.seat;
  const canAct = myTurn && !disabled;

  const seatColor = (seat: number) => {
    const idx = state.players.findIndex(p => p.seat === seat);
    return state.players[idx]?.accent_color || SEAT_COLORS[idx] || '#a3a3a3';
  };

  const selected = state.figures.find(f => f.id === selectedId) ?? null;

  // Engine-derived legality for the selected figure (empty when not my figure
  // or it has already moved/attacked — the engine helpers encode all of that).
  const destinations = useMemo(
    () => (canAct && selected ? legalDestinations(state, selected.id) : new Set<HexKey>()),
    [state, selected, canAct],
  );
  const targets = useMemo(
    () => (canAct && selected ? new Set(legalTargets(state, selected.id)) : new Set<string>()),
    [state, selected, canAct],
  );

  // Geometry: scale unit-space pixel coords to screen px and translate into view.
  const cells = Object.values(map?.cells ?? {});
  const centers = cells.map(c => ({ c, p: hexToPixel(`${c.q},${c.r}`) }));
  const minX = Math.min(...centers.map(e => e.p.x)) * HEX;
  const minY = Math.min(...centers.map(e => e.p.y)) * HEX;
  const maxX = Math.max(...centers.map(e => e.p.x)) * HEX;
  const maxY = Math.max(...centers.map(e => e.p.y)) * HEX;
  const W = maxX - minX + 2 * (HEX + PAD);
  const H = maxY - minY + 2 * (HEX + PAD);
  const toScreen = (key: HexKey) => {
    const p = hexToPixel(key);
    return { x: p.x * HEX - minX + HEX + PAD, y: p.y * HEX - minY + HEX + PAD };
  };

  const figureAt = (key: HexKey) => state.figures.find(f => f.at === key) ?? null;

  function clickHex(key: HexKey) {
    if (!canAct) return;
    const fig = figureAt(key);
    if (fig && fig.ownerSeat === me!.seat) { setSelectedId(fig.id === selectedId ? null : fig.id); return; }
    if (fig && selected && targets.has(fig.id)) { onAttack(selected.id, fig.id); setSelectedId(null); return; }
    if (!fig && selected && destinations.has(key)) { onMoveFigure(selected.id, key); return; }
  }

  // Army roster panel data: cards with surviving / total figures.
  const roster = state.players.map(pl => ({
    pl,
    cards: state.cards.filter(c => c.ownerSeat === pl.seat).map(c => {
      const def = HS_CARDS[c.cardId];
      const alive = state.figures.filter(f => f.cardUid === c.uid && f.at != null).length;
      return { uid: c.uid, def, alive };
    }),
  }));

  // ---------- lobby ----------
  if (state.phase === 'lobby') {
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-xl font-bold text-amber-100">HeroScape — Training Field</h2>
        <p className="text-sm text-neutral-400">
          Basic Game (beta): {HS_CARDS.finn.name} + {HS_CARDS.tarn_vikings.name} vs{' '}
          {HS_CARDS.thorgrim.name} + {HS_CARDS.marro_warriors.name}. First to wipe out the
          enemy army wins.
        </p>
        <div className="text-sm text-neutral-300">
          {state.players.length}/2 players seated{state.players.length < 2 ? ' — waiting…' : ''}
        </div>
        {isHost && (
          <button
            onClick={onStart}
            disabled={disabled || state.players.length < 2}
            className="rounded-lg border-2 border-emerald-600 px-6 py-2 font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⚔ Start the battle
          </button>
        )}
        {!isHost && <div className="text-xs text-neutral-500">Waiting for the host to start.</div>}
      </div>
    );
  }

  // ---------- playing / finished ----------
  return (
    <div className="flex flex-col gap-3 p-3 lg:flex-row">
      {/* Left column: status, dice, roster, log */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[300px]">
        {/* Turn / result banner */}
        <div
          className="rounded-lg border-2 px-3 py-2 text-center text-sm font-bold"
          style={{
            borderColor: state.phase === 'finished'
              ? '#fbbf24'
              : seatColor(state.turnSeat ?? 0),
            color: state.phase === 'finished' ? '#fde68a' : seatColor(state.turnSeat ?? 0),
          }}
        >
          {state.phase === 'finished'
            ? `🏆 ${state.players.find(p => p.seat === state.winnerSeat)?.username ?? '—'} wins the battle!`
            : myTurn
              ? '⚔ Your turn'
              : `${turnPlayer?.username ?? '…'}'s turn`}
          {state.phase === 'playing' && state.activeCardUid && (
            <div className="mt-0.5 text-[11px] font-normal opacity-80">
              Active card: {HS_CARDS[state.cards.find(c => c.uid === state.activeCardUid)?.cardId ?? '']?.name}
            </div>
          )}
        </div>

        {/* Opening roll-off */}
        {state.rollOff && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">First-turn roll</div>
            {state.rollOff.rounds.map((rd, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="w-14 truncate">{state.players[0]?.username}</span>
                {rd.seat0.map((f, j) => <DieFace key={j} face={f} size={14} />)}
                <span className="mx-1 opacity-60">vs</span>
                {rd.seat1.map((f, j) => <DieFace key={j} face={f} size={14} />)}
              </div>
            ))}
            <div className="mt-1">
              → {state.players.find(p => p.seat === state.rollOff!.winnerSeat)?.username} goes first
            </div>
          </div>
        )}

        {/* Last attack dice */}
        {state.lastAttack && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-200">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">Last attack</div>
            <div className="mb-1">{state.lastAttack.attackerLabel} → {state.lastAttack.targetLabel}</div>
            <div className="flex items-center gap-1">
              <span className="text-orange-300">⚔</span>
              {state.lastAttack.attackRoll.map((f, i) => <DieFace key={i} face={f} />)}
              <span className="ml-1 font-bold text-orange-300">{state.lastAttack.skulls}</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-sky-300">🛡</span>
              {state.lastAttack.defenseRoll.map((f, i) => <DieFace key={i} face={f} />)}
              <span className="ml-1 font-bold text-sky-300">{state.lastAttack.shields}</span>
            </div>
            <div className={`mt-1 font-semibold ${state.lastAttack.destroyed ? 'text-red-400' : 'text-neutral-400'}`}>
              {state.lastAttack.destroyed ? `${state.lastAttack.targetLabel} is destroyed!` : 'Attack blocked.'}
            </div>
          </div>
        )}

        {/* Armies */}
        {roster.map(({ pl, cards }) => (
          <div key={pl.seat} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
            <div className="mb-1 text-xs font-bold" style={{ color: seatColor(pl.seat) }}>
              {pl.username}{pl.playerId === currentUserId ? ' (you)' : ''}
            </div>
            {cards.map(({ uid, def, alive }) => (
              <div key={uid} className="flex items-center justify-between text-[11px] text-neutral-300">
                <span className={alive === 0 ? 'line-through opacity-50' : ''}>{def.name}</span>
                <span className="ml-2 shrink-0 tabular-nums">
                  {alive}/{def.figures} · Mv {def.move} Rg {def.range} ⚔{def.attack} 🛡{def.defense}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* End turn */}
        {myTurn && (
          <button
            onClick={() => { onEndTurn(); setSelectedId(null); }}
            disabled={disabled}
            className="rounded-lg border-2 border-amber-600 px-4 py-2 text-sm font-semibold text-amber-300 transition hover:bg-amber-900/40 disabled:opacity-40"
          >
            End turn ▶
          </button>
        )}

        {/* Log */}
        <div className="max-h-44 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[11px] leading-relaxed text-neutral-400">
          {state.log.slice(-12).map(e => (
            <div key={e.seq} className={e.tag === 'win' ? 'font-bold text-amber-300' : e.tag === 'attack' ? 'text-red-300/80' : ''}>
              {e.text}
            </div>
          ))}
        </div>
      </div>

      {/* Board */}
      <div className="min-w-0 flex-1 overflow-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-[860px]" style={{ minWidth: 420 }}>
          {/* Hexes */}
          {cells.map(c => {
            const key: HexKey = `${c.q},${c.r}`;
            const ctr = toScreen(key);
            const pts = hexCorners(ctr, HEX * 0.985).map(p => `${p.x},${p.y}`).join(' ');
            const isDest = destinations.has(key);
            const startZoneSeat = Object.entries(map.startZones).find(([, keys]) => keys.includes(key))?.[0];
            return (
              <g key={key} onClick={() => clickHex(key)} className={canAct ? 'cursor-pointer' : ''}>
                <polygon
                  points={pts}
                  fill={isDest ? '#155e3b' : '#2f4a2a'}
                  stroke={isDest ? '#34d399' : '#1c2c1a'}
                  strokeWidth={isDest ? 2 : 1}
                />
                {state.phase === 'playing' && startZoneSeat != null && !figureAt(key) && (
                  <circle cx={ctr.x} cy={ctr.y} r={3} fill={seatColor(Number(startZoneSeat))} opacity={0.25} />
                )}
              </g>
            );
          })}

          {/* Figures */}
          {state.figures.filter(f => f.at != null).map(f => {
            const ctr = toScreen(f.at!);
            const def = HS_CARDS[state.cards.find(c => c.uid === f.cardUid)?.cardId ?? ''];
            const isSel = f.id === selectedId;
            const isTarget = targets.has(f.id);
            const mine = me && f.ownerSeat === me.seat;
            return (
              <g key={f.id} onClick={() => clickHex(f.at!)} className={canAct && (mine || isTarget) ? 'cursor-pointer' : ''}>
                {isTarget && (
                  <circle cx={ctr.x} cy={ctr.y} r={HEX * 0.62} fill="none" stroke="#ef4444" strokeWidth={3} strokeDasharray="6 3" />
                )}
                <circle
                  cx={ctr.x} cy={ctr.y} r={HEX * 0.5}
                  fill={seatColor(f.ownerSeat)}
                  stroke={isSel ? '#fde68a' : '#0a0a0a'}
                  strokeWidth={isSel ? 3.5 : 1.5}
                />
                <text
                  x={ctr.x} y={ctr.y + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={HEX * 0.5} fontWeight={800} fill="#0a0a0a"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {def?.letter}{def?.type === 'squad' ? f.index : ''}
                </text>
                {state.movedFigureIds.includes(f.id) && state.turnSeat === f.ownerSeat && (
                  <circle cx={ctr.x + HEX * 0.34} cy={ctr.y - HEX * 0.34} r={4.5} fill="#a3a3a3" stroke="#0a0a0a" />
                )}
              </g>
            );
          })}
        </svg>
        {myTurn && (
          <div className="mt-1 text-center text-[11px] text-neutral-500">
            {selected
              ? `${figureLabel(state, selected)} — click a highlighted hex to move, a marked enemy to attack, or another of your figures.`
              : 'Click one of your figures. Your first move or attack locks in that card for the turn.'}
          </div>
        )}
      </div>
    </div>
  );
}
