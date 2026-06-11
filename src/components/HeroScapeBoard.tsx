'use client';

// HeroScape board — slice 2 (Master Game rounds on the Training Field).
// Each round: secretly place order markers 1/2/3/X → d20 initiative → three
// turns per player, each driven by the automatically revealed marker. All
// legality comes from the engine's pure helpers so the highlights can never
// disagree with the server's validation. The state arriving here is already
// PROJECTED: an opponent's unrevealed markers are literally 'hidden' — the
// board renders every one of them as the same face-down chip (X included).

import { useEffect, useMemo, useState } from 'react';
import {
  type HSState,
  type Figure,
  type CombatFace,
  type HexKey,
  type OrderMarker,
  type OrderMarkerValue,
  type HSChoiceResolution,
  MAPS,
  HS_CARDS,
  HS_GLYPHS,
  legalDestinations,
  legalTargets,
  figureLabel,
  getActiveCardUid,
  hexToPixel,
  hexCorners,
  axialToOffset,
} from '@/lib/games/heroscape';

const HEX = 34; // px size of a unit hex
const PAD = 26;

const SEAT_COLORS = ['#34d399', '#f87171']; // fallback accents by roster index
const MARKERS: readonly OrderMarkerValue[] = ['1', '2', '3', 'X'];

type Assignment = { marker: OrderMarkerValue; cardUid: string };

/**
 * Terrain + elevation hex fill. Grass/rock/sand get a base hue that lightens
 * with height (so a 4-tier hill reads as a hill); water is a flat blue. A
 * matching darker stroke separates the tiers. Keeps the slice-2 grass look at
 * height 1 while making the slice-3 maps legible at a glance.
 */
function hexFill(terrain: string, height: number, isDest: boolean): { fill: string; stroke: string } {
  if (isDest) return { fill: '#155e3b', stroke: '#34d399' };
  if (terrain === 'water') return { fill: '#1e3a5f', stroke: '#2c5a8c' };
  // Lightness ramp by height (1→4). Hue per terrain.
  const lift = Math.min(Math.max(height - 1, 0), 3); // 0..3
  if (terrain === 'rock') {
    const fills = ['#3a3f45', '#4a5159', '#5b636d', '#6c7682'];
    return { fill: fills[lift], stroke: '#23262a' };
  }
  if (terrain === 'sand') {
    const fills = ['#7a6a3f', '#8c7b49', '#9e8c54', '#b09d60'];
    return { fill: fills[lift], stroke: '#3a3322' };
  }
  // grass
  const fills = ['#2f4a2a', '#3a5a33', '#46693c', '#527845'];
  return { fill: fills[lift], stroke: '#1c2c1a' };
}

type Props = {
  state: HSState;
  currentUserId: string;
  isHost: boolean;
  disabled?: boolean;
  onStart: (mapId?: string) => void;
  onPlaceMarkers: (assignments: Assignment[]) => void;
  onMoveFigure: (figureId: string, to: HexKey) => void;
  onAttack: (attackerId: string, targetId: string) => void;
  onBerserkerCharge: () => void;
  onWaterClone: () => void;
  onResolveChoice: (choice: HSChoiceResolution) => void;
  onEndTurn: () => void;
};

/** Is it my live turn (in 'turns', I am the turn seat)? */
function myTurnReady(state: HSState, me: { seat: number } | undefined): boolean {
  return state.phase === 'playing' && state.subPhase === 'turns' && !!me && state.turnSeat === me.seat;
}

/** Colored badge per glyph letter (matches the rulebook's Glyphs Key). */
const GLYPH_BADGE: Record<string, { bg: string; ring: string }> = {
  A: { bg: '#b91c1c', ring: '#fca5a5' }, // Astrid (attack)
  G: { bg: '#1d4ed8', ring: '#93c5fd' }, // Gerda (defense)
  I: { bg: '#7c3aed', ring: '#c4b5fd' }, // Ivor (range)
  V: { bg: '#047857', ring: '#6ee7b7' }, // Valda (move)
  D: { bg: '#b45309', ring: '#fcd34d' }, // Dagmar (initiative)
  K: { bg: '#0e7490', ring: '#67e8f9' }, // Kelda (heal)
  E: { bg: '#52525b', ring: '#a1a1aa' }, // Erland (deferred)
  M: { bg: '#52525b', ring: '#a1a1aa' }, // Mitonsoul (deferred)
  B: { bg: '#52525b', ring: '#a1a1aa' }, // Brandar (scenario)
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

/** One order-marker chip. A projected 'hidden' marker renders as the same
 *  anonymous face-down chip every time — the X decoy must be visually
 *  indistinguishable from 1/2/3 (slice-2 spec §Projection). */
function MarkerChip({ m, size = 16 }: { m: OrderMarker; size?: number }) {
  const faceDown = m.marker === 'hidden';
  return (
    <span
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full border font-bold ' +
        (faceDown
          ? 'border-neutral-600 bg-neutral-800 text-neutral-800'
          : m.revealed
            ? 'border-amber-400 bg-amber-500/90 text-neutral-950'
            : 'border-amber-700/70 bg-neutral-900 text-amber-300/90')
      }
      style={{ width: size, height: size, fontSize: size * 0.62 }}
      title={
        faceDown
          ? 'Face-down order marker'
          : `Order marker ${m.marker}${m.revealed ? ' (revealed)' : ''}`
      }
    >
      {faceDown ? '' : m.marker}
    </span>
  );
}

/** ♥ pips for a hero: Life − wounds remaining. */
function WoundPips({ life, wounds }: { life: number; wounds: number }) {
  return (
    <span className="tracking-tight" title={`${life - wounds}/${life} Life`}>
      <span className="text-red-400">{'♥'.repeat(Math.max(0, life - wounds))}</span>
      <span className="text-neutral-700">{'♥'.repeat(Math.min(life, wounds))}</span>
    </span>
  );
}

export default function HeroScapeBoard({
  state, currentUserId, isHost, disabled,
  onStart, onPlaceMarkers, onMoveFigure, onAttack,
  onBerserkerCharge, onWaterClone, onResolveChoice, onEndTurn,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Lobby: the host's chosen battlefield (sent with start_game).
  const [lobbyMapId, setLobbyMapId] = useState<string>('training_field');
  // Marker-placement scratchpad: which card each chip sits on, and which chip
  // the next card tap will drop. Reset every round.
  const [assign, setAssign] = useState<Record<OrderMarkerValue, string | null>>({
    '1': null, '2': null, '3': null, X: null,
  });
  const [pickedMarker, setPickedMarker] = useState<OrderMarkerValue>('1');
  useEffect(() => {
    setAssign({ '1': null, '2': null, '3': null, X: null });
    setPickedMarker('1');
    setSelectedId(null);
  }, [state.round, state.phase]);

  const map = MAPS[state.mapId];
  const me = state.players.find(p => p.playerId === currentUserId);
  const turnPlayer = state.players.find(p => p.seat === state.turnSeat);
  const placing = state.phase === 'playing' && state.subPhase === 'place_markers';
  const myTurn =
    state.phase === 'playing' && state.subPhase === 'turns' && !!me && state.turnSeat === me.seat;
  const canAct = myTurn && !disabled;
  const iAmReady = !!me && state.markersReady.includes(me.seat);
  const activeCardUid = getActiveCardUid(state);
  const activeCard = state.cards.find(c => c.uid === activeCardUid);
  const activeCardDef = HS_CARDS[activeCard?.cardId ?? ''];

  // --- slice 4: pending choice + special-power availability (only mine) ------
  const pending = state.pendingChoice;
  const myChoice = !!me && pending != null && pending.seat === me.seat ? pending : null;
  // The Tarn Berserker Charge prompt: my Tarn turn, ≥1 Tarn moved, none
  // attacked, the charge not spent, and no other choice open.
  const movedActiveCard =
    activeCardUid != null &&
    state.movedFigureIds.some(id => state.figures.find(f => f.id === id)?.cardUid === activeCardUid);
  const canBerserk =
    myTurnReady(state, me) &&
    activeCard?.cardId === 'tarn_vikings' &&
    movedActiveCard &&
    state.attackedFigureIds.length === 0 &&
    !state.berserkerSpent &&
    !pending;
  // The Marro Water Clone prompt: my Marro turn, ≥1 Marro moved, none attacked,
  // not already cloned, no choice open.
  const canWaterClone =
    myTurnReady(state, me) &&
    activeCard?.cardId === 'marro_warriors' &&
    movedActiveCard &&
    state.attackedFigureIds.length === 0 &&
    !state.waterClonedThisTurn &&
    !pending;

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

  // slice 4: the NEXT Water Clone landing the player must pick (the placement at
  // index chosen.length). Its same-level adjacent options light up the board;
  // clicking one resolves it.
  const clonePlacement =
    myChoice?.kind === 'water_clone_place' ? myChoice.placements[myChoice.chosen.length] : null;
  const cloneChosen = myChoice?.kind === 'water_clone_place' ? myChoice.chosen : [];
  const cloneOptions = useMemo(
    // Exclude hexes already taken by an earlier clone this resolution (the
    // engine rejects them too) so the board never highlights an invalid landing.
    () => new Set<HexKey>((clonePlacement?.options ?? []).filter(h => !cloneChosen.includes(h))),
    [clonePlacement, cloneChosen],
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
  // Orient the board so the VIEWER's own start zone is always at the bottom.
  // Decision is based on the static start zones (not live figure positions), so
  // it stays fixed for the whole game. We implement it as a 180° point
  // reflection (x,y)->(W-x,H-y): a pointy-top hex maps onto itself and figure
  // letters stay upright (we reflect hex CENTERS, not the SVG canvas). Seat 0
  // starts at the top row, so it flips; seat 1 already sits at the bottom.
  const myZone = me ? (map?.startZones[me.seat] ?? []) : [];
  const myAvgRow = myZone.length
    ? myZone.reduce((s, k) => s + axialToOffset(k).row, 0) / myZone.length
    : 0;
  const flip = myZone.length > 0 && map != null && myAvgRow < (map.rows - 1) / 2;
  const toScreen = (key: HexKey) => {
    const p = hexToPixel(key);
    const x = p.x * HEX - minX + HEX + PAD;
    const y = p.y * HEX - minY + HEX + PAD;
    return flip ? { x: W - x, y: H - y } : { x, y };
  };

  const figureAt = (key: HexKey) => state.figures.find(f => f.at === key) ?? null;

  function clickHex(key: HexKey) {
    // Water Clone placement takes priority: click a highlighted same-level
    // adjacent hex to land the returning Marro Warrior.
    if (cloneOptions.has(key) && !disabled) {
      onResolveChoice({ kind: 'water_clone_place', hex: key });
      return;
    }
    if (!canAct) return;
    const fig = figureAt(key);
    if (fig && fig.ownerSeat === me!.seat) { setSelectedId(fig.id === selectedId ? null : fig.id); return; }
    if (fig && selected && targets.has(fig.id)) { onAttack(selected.id, fig.id); setSelectedId(null); return; }
    if (!fig && selected && destinations.has(key)) { onMoveFigure(selected.id, key); return; }
  }

  // Army roster panel data: cards with surviving figures, wounds, markers.
  const roster = state.players.map(pl => ({
    pl,
    cards: state.cards.filter(c => c.ownerSeat === pl.seat).map(c => {
      const def = HS_CARDS[c.cardId];
      const figs = state.figures.filter(f => f.cardUid === c.uid);
      const alive = figs.filter(f => f.at != null).length;
      return { uid: c.uid, def, alive, heroWounds: figs[0]?.wounds ?? 0, markers: c.orderMarkers };
    }),
  }));
  function assignPicked(cardUid: string) {
    const next = { ...assign, [pickedMarker]: cardUid };
    setAssign(next);
    const nextUnassigned = MARKERS.find(v => !next[v]);
    if (nextUnassigned) setPickedMarker(nextUnassigned);
  }
  const allAssigned = MARKERS.every(v => assign[v]);

  function lockIn() {
    if (!allAssigned) return;
    onPlaceMarkers(MARKERS.map(v => ({ marker: v, cardUid: assign[v]! })));
  }

  // ---------- lobby ----------
  if (state.phase === 'lobby') {
    const mapList = Object.values(MAPS);
    const mapBlurb: Record<string, string> = {
      training_field: 'Flat grass — learn the ropes.',
      the_knoll: 'A 3-tier rock hill — climb for height advantage.',
      ford_crossing: 'A water river split by a narrow ford.',
    };
    return (
      <div className="flex flex-col items-center gap-4 p-6">
        <h2 className="text-xl font-bold text-amber-100">HeroScape</h2>
        <p className="max-w-md text-center text-sm text-neutral-400">
          Master Game (beta): {HS_CARDS.finn.name} + {HS_CARDS.tarn_vikings.name} vs{' '}
          {HS_CARDS.thorgrim.name} + {HS_CARDS.marro_warriors.name}. Each round, secretly
          schedule your three turns with order markers, roll for initiative, and fight on
          3-D terrain — climb for height advantage, mind the falls and water — first to wipe
          out the enemy army wins.
        </p>
        <div className="text-sm text-neutral-300">
          {state.players.length}/2 players seated{state.players.length < 2 ? ' — waiting…' : ''}
        </div>

        {/* Battlefield picker (host chooses; others see the selection) */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Battlefield
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {mapList.map(m => {
              const active = lobbyMapId === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => isHost && setLobbyMapId(m.id)}
                  disabled={!isHost || disabled}
                  title={mapBlurb[m.id]}
                  className={
                    'flex w-40 flex-col items-start rounded-lg border-2 px-3 py-2 text-left transition ' +
                    (active
                      ? 'border-amber-400 bg-amber-900/30'
                      : 'border-neutral-700 hover:border-neutral-500') +
                    (isHost ? '' : ' cursor-default opacity-90')
                  }
                >
                  <span className={'text-sm font-bold ' + (active ? 'text-amber-200' : 'text-neutral-200')}>
                    {m.name}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {m.cols}×{m.rows} · {mapBlurb[m.id] ?? ''}
                  </span>
                </button>
              );
            })}
          </div>
          {!isHost && (
            <div className="mt-0.5 text-[10px] text-neutral-500">The host chooses the battlefield.</div>
          )}
        </div>

        {isHost && (
          <button
            onClick={() => onStart(lobbyMapId)}
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
      {/* Left column: status, markers, dice, roster, log */}
      <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[300px]">
        {/* Placement status — the interactive assignment lives below the board,
            directly above your army cards. */}
        {placing ? (
          <div className="rounded-lg border-2 border-amber-700 bg-neutral-900/70 px-3 py-2 text-center">
            <div className="text-sm font-bold text-amber-300">
              Round {state.round} — place order markers
            </div>
            <div className="mt-1 text-xs text-neutral-400">
              {me
                ? iAmReady
                  ? 'Locked in — waiting for the enemy…'
                  : 'Assign 1/2/3/X on your cards below the board, then lock in.'
                : 'Players are placing markers…'}
            </div>
            <div className="mt-2 flex flex-col gap-0.5 border-t border-neutral-800 pt-1.5 text-[11px]">
              {state.players.filter(p => p.playerId !== currentUserId).map(p => (
                <div key={p.seat} className="flex items-center justify-between">
                  <span style={{ color: seatColor(p.seat) }}>{p.username}</span>
                  <span className={state.markersReady.includes(p.seat) ? 'text-emerald-400' : 'text-neutral-500'}>
                    {state.markersReady.includes(p.seat) ? 'ready ✓' : 'placing…'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Turn / result banner */
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
            {state.phase === 'playing' && (
              <div className="mt-0.5 text-[11px] font-normal opacity-80">
                {map?.name ? `${map.name} · ` : ''}Round {state.round} · Turn {state.turnNumber}/3
                {activeCardDef ? ` · ${activeCardDef.name}` : ''}
              </div>
            )}
          </div>
        )}

        {/* This round's d20 initiative (every attempt, ties marked) */}
        {state.subPhase === 'turns' && state.initiativeRolls.length > 0 && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-[11px] text-neutral-300">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">
              Round {state.round} initiative
            </div>
            {state.initiativeRolls.map((attempt, i) => {
              const isLast = i === state.initiativeRolls.length - 1;
              return (
                <div key={i} className="flex items-center gap-1.5">
                  {attempt.map(a => (
                    <span key={a.seat}>
                      <span style={{ color: seatColor(a.seat) }}>
                        {state.players.find(p => p.seat === a.seat)?.username}
                      </span>{' '}
                      <span className="font-bold tabular-nums">{a.roll}</span>
                    </span>
                  ))}
                  <span className={isLast ? 'text-amber-300' : 'text-neutral-500'}>
                    {isLast
                      ? `→ ${state.players.find(p => p.seat === state.initiative[0])?.username} first`
                      : '— tie, re-roll'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Last attack dice */}
        {state.lastAttack && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-200">
            <div className="mb-1 font-semibold uppercase tracking-wider text-neutral-400">Last attack</div>
            <div className="mb-1">{state.lastAttack.attackerLabel} → {state.lastAttack.targetLabel}</div>
            {/* Dice breakdown caption (slice 4): WHY the dice counts are what
                they are — printed + height + auras + glyphs + Spirit. The
                bonuses are already folded into the rolls below. */}
            {state.lastAttack.breakdown && state.lastAttack.breakdown.length > 0 && (
              <div className="mb-1 text-[10px] font-semibold text-amber-300">
                {state.lastAttack.breakdown.join('  ·  ')}
              </div>
            )}
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
            <div className={`mt-1 font-semibold ${state.lastAttack.destroyed ? 'text-red-400' : state.lastAttack.wounds > 0 ? 'text-orange-300' : 'text-neutral-400'}`}>
              {state.lastAttack.destroyed
                ? `${state.lastAttack.targetLabel} is destroyed!`
                : state.lastAttack.wounds > 0
                  ? `${state.lastAttack.wounds} wound${state.lastAttack.wounds === 1 ? '' : 's'} inflicted.`
                  : 'Attack blocked.'}
            </div>
          </div>
        )}

        {/* (Army cards render below the board — see the main column.) */}

        {/* slice 4: special-power buttons (after moving, before attacking) */}
        {canBerserk && (
          <button
            onClick={onBerserkerCharge}
            disabled={disabled}
            title="Roll a d20 — on 15+ you may move all Tarn Viking Warriors again."
            className="rounded-lg border-2 border-orange-600 px-4 py-2 text-sm font-semibold text-orange-300 transition hover:bg-orange-900/40 disabled:opacity-40"
          >
            ⚡ Berserker Charge (roll d20)
          </button>
        )}
        {canWaterClone && (
          <button
            onClick={onWaterClone}
            disabled={disabled}
            title="Instead of attacking: roll a d20 per Marro Warrior (15+, or 10+ on water) to return slain Warriors."
            className="rounded-lg border-2 border-cyan-600 px-4 py-2 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-900/40 disabled:opacity-40"
          >
            🌊 Water Clone (instead of attacking)
          </button>
        )}

        {/* slice 4: Berserker Charge re-move choice (the optional "may") */}
        {myChoice?.kind === 'berserker_charge' && (
          <div className="rounded-lg border-2 border-orange-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-orange-300">⚡ Berserker Charge!</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              You rolled 15+. Move all Tarn Viking Warriors again, or decline.
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onResolveChoice({ kind: 'berserker_charge', remove: true })}
                disabled={disabled}
                className="flex-1 rounded-md border-2 border-emerald-600 px-2 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:opacity-40"
              >
                Move again
              </button>
              <button
                onClick={() => onResolveChoice({ kind: 'berserker_charge', remove: false })}
                disabled={disabled}
                className="flex-1 rounded-md border-2 border-neutral-600 px-2 py-1 text-xs font-semibold text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-40"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* slice 4: Water Clone placement — click a highlighted hex on the board */}
        {myChoice?.kind === 'water_clone_place' && (
          <div className="rounded-lg border-2 border-cyan-600 bg-neutral-900/70 px-3 py-2">
            <div className="text-sm font-bold text-cyan-300">🌊 Water Clone — place a Warrior</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Returning {myChoice.chosen.length + 1} of {myChoice.placements.length}. Click a
              highlighted same-level space adjacent to the Warrior that rolled.
            </div>
          </div>
        )}

        {/* slice 4: Spirit placement — pick any living unique card */}
        {myChoice?.kind === 'spirit_placement' && (
          <div className="rounded-lg border-2 border-amber-500 bg-neutral-900/80 px-3 py-2">
            <div className="text-sm font-bold text-amber-300">
              {myChoice.spirit === 'attack' ? "Warrior's Attack Spirit" : "Warrior's Armor Spirit"}
            </div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              Place the Spirit on any unique Army Card — +1 {myChoice.spirit} forever.
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {myChoice.options.map(uid => {
                const c = state.cards.find(x => x.uid === uid);
                const def = HS_CARDS[c?.cardId ?? ''];
                const ownerName = state.players.find(p => p.seat === c?.ownerSeat)?.username ?? '';
                return (
                  <button
                    key={uid}
                    onClick={() => onResolveChoice({ kind: 'spirit_placement', cardUid: uid })}
                    disabled={disabled}
                    className="flex items-center justify-between rounded-md border border-amber-700 px-2 py-1 text-left text-xs text-amber-100 transition hover:border-amber-400 hover:bg-amber-900/30 disabled:opacity-40"
                  >
                    <span className="font-semibold">{def?.name ?? uid}</span>
                    <span className="text-[10px] text-neutral-400">{ownerName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* End turn */}
        {myTurn && !pending && (
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
            <div
              key={e.seq}
              className={
                e.tag === 'win'
                  ? 'font-bold text-amber-300'
                  : e.tag === 'attack'
                    ? 'text-red-300/80'
                    : e.tag === 'fall'
                      ? 'text-orange-300/90'
                      : ''
              }
            >
              {e.text}
            </div>
          ))}
        </div>
      </div>

      {/* Board + army cards (cards below the board; markers sit above them) */}
      <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2">
        <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto block max-w-[860px]" style={{ minWidth: 420 }}>
          {/* Hexes — terrain + elevation shading (height lightens the fill) */}
          {cells.map(c => {
            const key: HexKey = `${c.q},${c.r}`;
            const ctr = toScreen(key);
            const pts = hexCorners(ctr, HEX * 0.985).map(p => `${p.x},${p.y}`).join(' ');
            const isDest = destinations.has(key);
            const isCloneOpt = cloneOptions.has(key);
            const { fill, stroke } = hexFill(c.terrain, c.height, isDest);
            const startZoneSeat = Object.entries(map.startZones).find(([, keys]) => keys.includes(key))?.[0];
            const occupied = !!figureAt(key);
            const clickable = canAct || isCloneOpt;
            return (
              <g key={key} onClick={() => clickHex(key)} className={clickable ? 'cursor-pointer' : ''}>
                <polygon
                  points={pts}
                  fill={isCloneOpt ? '#0e4f6e' : fill}
                  stroke={isCloneOpt ? '#22d3ee' : isDest ? '#34d399' : stroke}
                  strokeWidth={isCloneOpt || isDest ? 2 : 1}
                />
                {/* Height pip for elevated / water hexes (skip flat grass and
                    occupied hexes where the figure disc covers it). */}
                {!occupied && (c.height > 1 || c.terrain === 'water') && (
                  <text
                    x={ctr.x + HEX * 0.6} y={ctr.y - HEX * 0.55}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={HEX * 0.32} fontWeight={700}
                    fill={c.terrain === 'water' ? '#7dd3fc' : '#e7e5e4'} opacity={0.75}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {c.terrain === 'water' ? '≈' : c.height}
                  </text>
                )}
                {state.phase === 'playing' && startZoneSeat != null && !figureAt(key) && (
                  <circle cx={ctr.x} cy={ctr.y} r={3} fill={seatColor(Number(startZoneSeat))} opacity={0.25} />
                )}
              </g>
            );
          })}

          {/* Glyphs — a colored letter badge on each glyph hex. Dimmed when no
              figure stands on it, LIT when occupied (its power is active). When
              a figure is on the hex the badge tucks into the top-left corner so
              the figure disc stays legible. */}
          {(state.glyphs ?? []).map(g => {
            const ctr = toScreen(g.at);
            const def = HS_GLYPHS[g.id];
            const badge = GLYPH_BADGE[def.letter] ?? GLYPH_BADGE.B;
            const occ = figureAt(g.at);
            const lit = occ != null;
            const cx = occ ? ctr.x - HEX * 0.46 : ctr.x;
            const cy = occ ? ctr.y + HEX * 0.46 : ctr.y;
            const r = occ ? HEX * 0.26 : HEX * 0.34;
            return (
              <g key={`glyph-${g.at}`} onClick={() => clickHex(g.at)} style={{ pointerEvents: occ ? 'none' : undefined }} className={canAct && !occ ? 'cursor-pointer' : ''}>
                <title>{`${def.name}${lit ? ' (active)' : ''} — ${def.effect}`}</title>
                <circle
                  cx={cx} cy={cy} r={r}
                  fill={badge.bg}
                  stroke={lit ? badge.ring : '#0a0a0a'}
                  strokeWidth={lit ? 2.5 : 1.5}
                  opacity={lit ? 1 : 0.6}
                />
                <text
                  x={cx} y={cy + 0.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={r * 1.1} fontWeight={900} fill="#fafafa"
                  opacity={lit ? 1 : 0.85}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {def.letter}
                </text>
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
                {f.wounds > 0 && (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={ctr.x - HEX * 0.34} cy={ctr.y - HEX * 0.34} r={6} fill="#dc2626" stroke="#0a0a0a" />
                    <text
                      x={ctr.x - HEX * 0.34} y={ctr.y - HEX * 0.34 + 0.5}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={8} fontWeight={800} fill="#fee2e2"
                      style={{ userSelect: 'none' }}
                    >
                      {f.wounds}
                    </text>
                  </g>
                )}
                {state.movedFigureIds.includes(f.id) && state.turnSeat === f.ownerSeat && (
                  <circle cx={ctr.x + HEX * 0.34} cy={ctr.y - HEX * 0.34} r={4.5} fill="#a3a3a3" stroke="#0a0a0a" />
                )}
              </g>
            );
          })}
        </svg>
        </div>
        {myTurn && (
          <div className="text-center text-[11px] text-neutral-500">
            {selected
              ? `${figureLabel(state, selected)} — click a highlighted hex to move, a marked enemy to attack, or another of your figures.`
              : `Order marker ${state.turnNumber} is revealed — only ${activeCardDef?.name ?? 'that card'}'s figures act this turn.`}
          </div>
        )}
        {placing && me && !iAmReady && (
          <div className="text-center text-[11px] text-neutral-500">
            Pick a chip on your army strip, then click a card to schedule that turn.
          </div>
        )}

        {/* Army cards — below the board. Opponent on top, you nearest the
            bottom (where the flip puts your figures). Order markers render
            directly ABOVE each card; during placement your strip is interactive. */}
        {(() => {
          const ordered = me
            ? [...roster].sort(
                (a, b) => (a.pl.seat === me.seat ? 1 : 0) - (b.pl.seat === me.seat ? 1 : 0),
              )
            : roster;
          return ordered.map(({ pl, cards }) => {
            const isMe = !!me && pl.seat === me.seat;
            const placingMine = placing && isMe && !iAmReady;
            return (
              <div
                key={pl.seat}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900/40 px-2 py-1.5"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold" style={{ color: seatColor(pl.seat) }}>
                    {pl.username}{isMe ? ' (you)' : ''}
                  </span>
                  {placingMine && (
                    <span className="flex items-center gap-1">
                      {MARKERS.map(v => (
                        <button
                          key={v}
                          onClick={() => setPickedMarker(v)}
                          disabled={disabled}
                          title={v === 'X' ? 'Decoy — never takes a turn' : `Your turn ${v} this round`}
                          className={
                            'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-extrabold transition ' +
                            (pickedMarker === v
                              ? 'border-amber-400 bg-amber-500 text-neutral-950'
                              : assign[v]
                                ? 'border-amber-700 bg-neutral-800 text-amber-300'
                                : 'border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-neutral-400')
                          }
                        >
                          {v}
                        </button>
                      ))}
                      <button
                        onClick={lockIn}
                        disabled={disabled || !allAssigned}
                        className="ml-1 rounded-md border-2 border-emerald-600 px-2 py-0.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        🔒 Lock in
                      </button>
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {cards.map(({ uid, def, alive, heroWounds, markers }) => {
                    const canAssign = placingMine && alive > 0;
                    const markersToShow = placingMine
                      ? MARKERS.filter(v => assign[v] === uid).map(v => ({ marker: v, revealed: false }))
                      : markers;
                    const active = uid === activeCardUid && state.subPhase === 'turns';
                    const body = (
                      <>
                        <div className={'text-xs font-semibold ' + (alive === 0 ? 'text-neutral-600 line-through' : 'text-neutral-100')}>
                          {def.name}
                        </div>
                        <div className="mt-0.5 text-[10px] text-neutral-400 tabular-nums">
                          {def.type === 'hero'
                            ? <WoundPips life={def.life} wounds={alive === 0 ? def.life : heroWounds} />
                            : `${alive}/${def.figures} figs`}
                          {' · '}Mv {def.move} · Rg {def.range} · ⚔{def.attack} · 🛡{def.defense} · H{def.height}
                        </div>
                      </>
                    );
                    return (
                      <div key={uid} className="flex w-44 flex-col items-stretch gap-1">
                        {/* order markers — directly ABOVE the card */}
                        <div className="flex h-6 items-center justify-center gap-1">
                          {markersToShow.map((m, i) => <MarkerChip key={i} m={m} size={20} />)}
                        </div>
                        {canAssign ? (
                          <button
                            onClick={() => assignPicked(uid)}
                            disabled={disabled}
                            className="rounded-md border border-neutral-700 px-2 py-1 text-left transition hover:border-amber-500 hover:bg-amber-900/20"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className={'rounded-md border px-2 py-1 ' + (active ? 'border-amber-500 bg-amber-900/20' : 'border-neutral-800')}>
                            {body}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
