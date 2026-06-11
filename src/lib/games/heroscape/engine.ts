// HeroScape engine — slice 2: the MASTER GAME round structure exactly as the
// wiki states (docs/heroscape/02-rounds-turns-order-markers.md, 04-combat) and
// the slice-2 spec (docs/heroscape/slice-2-spec.md). 2 players, fixed armies,
// flat Training Field map:
//
//   • Every round: (1) ALL players SECRETLY place order markers 1/2/3/X on
//     their own living cards — any split, stacking legal, X is a pure decoy —
//     ready-gated; (2) d20 initiative, ties re-roll; (3) for turnNumber 1→2→3,
//     each player in initiative order automatically REVEALS that marker and
//     takes a turn with THAT card only: move any/all/none of its figures
//     (each up to its Move, flat 1/hex), THEN each may attack once. Any
//     attack ends the turn's movement. After the last player's turn 3 the
//     markers are cleared and the next round begins.
//   • LOST TURN (pp. 9, 14): if the card holding the current marker has no
//     living figures, that turn is skipped entirely and the marker is NEVER
//     revealed — opponents learn only that the turn was lost.
//   • Attack: target within Range (spaces counted around gaps, elevation-free)
//     AND in line of sight. Attacker rolls Attack dice (count only skulls),
//     defender rolls Defense dice (count only shields); each unblocked skull
//     is a wound; a figure is DESTROYED when wounds reach its Life (Master
//     combat, p. 14). Ties favor the defender.
//   • A player with no figures remaining loses; last player with figures wins.
//
// HIDDEN INFORMATION: unrevealed marker values are secret to everyone but the
// owner. projectStateForViewer replaces them with 'hidden' before state leaves
// the server — the X decoy must be indistinguishable from 1/2/3 in every
// projected byte, log line, and UI element.
//
// PURE + DETERMINISTIC: every die value is rolled by the server action
// (makeMoveHS) and passed in through HSAction — the engine never calls
// Math.random. All validation lives here; the board only sends intent.

import type {
  ArmyCardInstance,
  CombatFace,
  Figure,
  HexKey,
  HSAction,
  HSCardDef,
  HSLogEntry,
  HSResult,
  HSState,
  InitiativeAttempt,
  OrderMarkerValue,
} from './types';
import { MAPS } from './maps';
import { HS_CARDS, SLICE1_ARMIES } from './content';
import {
  areEngaged,
  axialToOffset,
  computeFall,
  hasLineOfSight3D,
  rangeDistance,
  reachableDestinations,
  type FallTier,
  type Occupancy,
} from './board';

export const STATE_VERSION = 2;
export const LOG_MAX = 60;
const SEATS = 2;
const DEFAULT_MAP_ID = 'training_field';
const MARKER_VALUES: readonly OrderMarkerValue[] = ['1', '2', '3', 'X'];

// ============================================================================
// State construction / lobby
// ============================================================================

export function initialState(): HSState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    players: [],
    mapId: DEFAULT_MAP_ID,
    cards: [],
    figures: [],
    subPhase: 'place_markers',
    round: 1,
    turnNumber: 1,
    initiative: [],
    initiativeRolls: [],
    turnPointer: 0,
    markersReady: [],
    turnSeat: null,
    movedFigureIds: [],
    attackedFigureIds: [],
    lastAttack: null,
    winnerSeat: null,
    log: [],
    logSeq: 0,
  };
}

export function createInitialStateForHost(host: {
  userId: string;
  username: string;
  accent_color?: string;
}): HSState {
  return addPlayer(initialState(), host.userId, host.username, 0, host.accent_color);
}

export function addPlayer(
  state: HSState,
  playerId: string,
  username: string,
  seat: number,
  accent_color?: string,
): HSState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state; // idempotent
  if (state.players.length >= SEATS) return state;
  const players = [...state.players, { seat, playerId, username, accent_color }].sort(
    (a, b) => a.seat - b.seat,
  );
  return { ...state, players };
}

export function removePlayer(state: HSState, playerId: string): HSState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

// ============================================================================
// Apply action
// ============================================================================

export function applyAction(state: HSState, playerId: string, action: HSAction): HSResult {
  if (!state.players.some(p => p.playerId === playerId)) {
    return { error: 'You are not seated in this game' };
  }
  if (action.kind === 'start_game') {
    // Host gating happens in the server action (room.host_id); the engine
    // validates the game shape (and the chosen battlefield).
    return doStartGame(state, action.mapId);
  }
  if (state.phase === 'lobby') return { error: 'The battle has not started yet' };
  if (state.phase === 'finished') return { error: 'The battle is over' };
  const me = state.players.find(p => p.playerId === playerId)!;

  switch (action.kind) {
    // Simultaneous round-start actions — no turn check (there is no turn yet).
    case 'place_markers':
      return doPlaceMarkers(state, me.seat, action.assignments);
    case 'roll_initiative':
      return doRollInitiative(state, action.attempts);
    // Turn actions — only the revealed-marker player acts.
    case 'move_figure':
    case 'attack':
    case 'end_turn': {
      if (state.subPhase !== 'turns') return { error: 'Place your order markers first' };
      if (state.turnSeat !== me.seat) return { error: 'Not your turn' };
      if (action.kind === 'move_figure')
        return doMove(
          state,
          action.figureId,
          action.to,
          action.fallRoll,
          action.extremeFallD20,
          action.leaveRolls,
        );
      if (action.kind === 'attack') return doAttack(state, action);
      return doEndTurn(state, me.seat);
    }
  }
}

// ============================================================================
// Start: fixed armies + auto-placement (no roll-off — initiative is per-round)
// ============================================================================

function doStartGame(state: HSState, mapId?: string): HSResult {
  if (state.phase !== 'lobby') return { error: 'The battle has already started' };
  if (state.players.length !== SEATS) return { error: 'HeroScape needs exactly 2 players' };
  // The host picks the battlefield at game start (default: Training Field).
  const chosenMapId = mapId ?? state.mapId ?? DEFAULT_MAP_ID;
  const map = MAPS[chosenMapId];
  if (!map) return { error: `Unknown battlefield "${chosenMapId}"` };

  const s = clone(state);
  s.mapId = chosenMapId;
  s.cards = [];
  s.figures = [];

  // Fixed slice-1 armies, auto-placed in each player's start zone.
  // TODO(slice 5): manual placement — the rules let each player arrange their
  // own figures inside their starting zone (01-components §5). For now we
  // auto-place a fixed, sensible arrangement (hero centered, squad figures
  // flanking) to keep scope down.
  for (let idx = 0; idx < SEATS; idx++) {
    const player = s.players[idx];
    const zone = map.startZones[idx] ?? [];
    if (zone.length < 5) return { error: 'Start zone is too small for the army' };
    const center = Math.floor(zone.length / 2);
    const heroSpot = zone[center];
    const squadSpots = [zone[center - 2], zone[center - 1], zone[center + 1], zone[center + 2]];

    for (const cardId of SLICE1_ARMIES[idx]) {
      const def = HS_CARDS[cardId];
      const card: ArmyCardInstance = {
        uid: `s${player.seat}-${cardId}`,
        cardId,
        ownerSeat: player.seat,
        orderMarkers: [],
      };
      s.cards.push(card);
      for (let n = 1; n <= def.figures; n++) {
        s.figures.push({
          id: `${card.uid}-${n}`,
          cardUid: card.uid,
          ownerSeat: player.seat,
          at: def.type === 'hero' ? heroSpot : squadSpots[n - 1],
          index: n,
          wounds: 0,
        });
      }
    }
  }

  s.phase = 'playing';
  s.subPhase = 'place_markers';
  s.round = 1;
  s.turnNumber = 1;
  s.turnPointer = 0;
  s.initiative = [];
  s.initiativeRolls = [];
  s.markersReady = [];
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.attackedFigureIds = [];
  s.winnerSeat = null;

  pushLog(s, 'info', `Battle on the ${map.name}! Round 1 — all players secretly place their order markers.`);
  return s;
}

// ============================================================================
// Round step 1 — place order markers (simultaneous, secret, ready-gated)
// ============================================================================

function doPlaceMarkers(
  state: HSState,
  seat: number,
  assignments: { marker: OrderMarkerValue; cardUid: string }[],
): HSResult {
  if (state.subPhase !== 'place_markers') {
    return { error: 'Order markers are already locked in — the round is under way' };
  }
  if (state.markersReady.includes(seat)) {
    return { error: 'You have already locked in your order markers' };
  }
  // Exactly one each of 1/2/3/X — all four are mandatory, the X included
  // (02-rounds §Step 1). Stacking several on one card is legal.
  if (
    !Array.isArray(assignments) ||
    assignments.length !== MARKER_VALUES.length ||
    MARKER_VALUES.some(v => assignments.filter(a => a?.marker === v).length !== 1)
  ) {
    return { error: 'Place exactly one each of order markers 1, 2, 3, and X' };
  }
  for (const a of assignments) {
    const card = state.cards.find(c => c.uid === a.cardUid);
    if (!card || card.ownerSeat !== seat) {
      return { error: 'You can only place order markers on your own army cards' };
    }
    // Markers on an out-of-play card are illegal (p. 14) — with unlimited
    // stacking a player can always fit all four on one living card.
    if (!cardHasLivingFigures(state, card.uid)) {
      return { error: `${HS_CARDS[card.cardId].name} is out of play — markers must go on a living card` };
    }
  }

  const s = clone(state);
  for (const card of s.cards) {
    if (card.ownerSeat === seat) card.orderMarkers = [];
  }
  // Stored in canonical 1/2/3/X order so nothing about the player's placement
  // order survives in state (the values are projected away regardless).
  for (const v of MARKER_VALUES) {
    const a = assignments.find(x => x.marker === v)!;
    s.cards.find(c => c.uid === a.cardUid)!.orderMarkers.push({ marker: v, revealed: false });
  }
  s.markersReady.push(seat);
  // Value-free by design: opponents may know THAT you locked in, never where
  // the numbers (or the X decoy) went.
  pushLog(s, 'info', `${playerName(s, seat)} locks in their order markers.`);
  return s;
}

// ============================================================================
// Round step 2 — d20 initiative (server-rolled, ties re-roll)
// ============================================================================

function doRollInitiative(state: HSState, attempts: InitiativeAttempt[]): HSResult {
  if (state.subPhase !== 'place_markers') {
    return { error: 'Initiative has already been rolled this round' };
  }
  // Step 1 strictly precedes step 2: players commit their whole turn schedule
  // BEFORE knowing who acts first (02-rounds §The round).
  if (state.markersReady.length !== state.players.length) {
    return { error: 'Initiative is rolled once every player has placed order markers' };
  }
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return { error: 'Missing initiative rolls' };
  }
  const seats = state.players.map(p => p.seat);
  for (const attempt of attempts) {
    if (
      !Array.isArray(attempt) ||
      attempt.length !== seats.length ||
      !seats.every(seat => attempt.some(a => a?.seat === seat)) ||
      attempt.some(a => !Number.isInteger(a.roll) || a.roll < 1 || a.roll > 20)
    ) {
      return { error: 'Malformed initiative rolls' };
    }
  }
  // Ties for highest re-roll until broken (02-rounds §Step 2): every attempt
  // before the last must BE such a tie (that is why it was re-rolled) and the
  // final attempt must be decisive.
  for (let i = 0; i < attempts.length - 1; i++) {
    if (!tiedForHighest(attempts[i])) {
      return { error: 'Initiative re-rolled an attempt that was not tied' };
    }
  }
  const last = attempts[attempts.length - 1];
  if (tiedForHighest(last)) return { error: 'Initiative ended in a tie — roll again' };
  const winnerSeat = last.reduce((best, a) => (a.roll > best.roll ? a : best)).seat;

  const s = clone(state);
  s.initiativeRolls = attempts;
  // Highest roller takes the first turn; play then passes LEFT in seating
  // order, not roll order (p. 9) — i.e. seat order rotated to the winner.
  const bySeat = [...seats].sort((a, b) => a - b);
  const w = bySeat.indexOf(winnerSeat);
  s.initiative = [...bySeat.slice(w), ...bySeat.slice(0, w)];
  s.subPhase = 'turns';
  s.turnNumber = 1;
  s.turnPointer = 0;

  attempts.forEach((attempt, i) => {
    const parts = attempt.map(a => `${playerName(s, a.seat)} ${a.roll}`).join(' — ');
    const tie = i < attempts.length - 1 ? ' Tie — re-roll!' : '';
    pushLog(s, 'roll', `Initiative d20: ${parts}.${tie}`);
  });
  pushLog(s, 'info', `${playerName(s, winnerSeat)} wins initiative.`);

  beginTurnOrSkip(s);
  return s;
}

function tiedForHighest(attempt: InitiativeAttempt): boolean {
  const max = Math.max(...attempt.map(a => a.roll));
  return attempt.filter(a => a.roll === max).length > 1;
}

// ============================================================================
// Round step 3 — the turn loop (automatic reveal, lost turns, round rollover)
// ============================================================================

/**
 * Start the turn at the current (initiative[turnPointer], turnNumber) slot:
 * automatically REVEAL that player's marker (Action 1 of the turn anatomy —
 * the placement was the choice; the reveal is not). LOST TURN (pp. 9, 14): if
 * the card holding the marker has no living figures, the turn is skipped
 * entirely — no substitution, no move, no attack — and the marker stays
 * UNREVEALED. The log names neither the card nor the marker, so opponents
 * learn only that the turn was lost. Keeps skipping forward until a turn
 * starts or the round rolls over to the next marker placement.
 */
function beginTurnOrSkip(s: HSState): void {
  for (;;) {
    const seat = s.initiative[s.turnPointer];
    const holder = s.cards.find(
      c => c.ownerSeat === seat && c.orderMarkers.some(m => m.marker === String(s.turnNumber)),
    );
    if (holder && cardHasLivingFigures(s, holder.uid)) {
      holder.orderMarkers.find(m => m.marker === String(s.turnNumber))!.revealed = true;
      s.turnSeat = seat;
      s.movedFigureIds = [];
      s.attackedFigureIds = [];
      pushLog(
        s,
        'info',
        `Round ${s.round}, turn ${s.turnNumber}: ${playerName(s, seat)} reveals order marker ${s.turnNumber} — ${HS_CARDS[holder.cardId].name} acts.`,
      );
      return;
    }
    pushLog(s, 'info', `${playerName(s, seat)} loses turn ${s.turnNumber} — the card holding that marker is out of play.`);
    if (!advanceSlot(s)) return; // the round just rolled over to place_markers
  }
}

/** Move to the next (turnPointer, turnNumber) slot. Returns false when the
 *  last player's turn 3 just finished — the next round has begun instead. */
function advanceSlot(s: HSState): boolean {
  if (s.turnPointer + 1 < s.initiative.length) {
    s.turnPointer += 1;
    return true;
  }
  if (s.turnNumber < 3) {
    s.turnPointer = 0;
    s.turnNumber = (s.turnNumber + 1) as 2 | 3;
    return true;
  }
  startNextRound(s);
  return false;
}

/** End of round (p. 8/14): markers return to the owners' pools — revealed and
 *  unrevealed alike are silently retrieved, NEVER shown (02-rounds §Open
 *  questions reads unrevealed markers as never flipped). */
function startNextRound(s: HSState): void {
  s.round += 1;
  s.subPhase = 'place_markers';
  s.turnNumber = 1;
  s.turnPointer = 0;
  s.initiative = [];
  s.initiativeRolls = [];
  s.markersReady = [];
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.attackedFigureIds = [];
  for (const card of s.cards) card.orderMarkers = [];
  pushLog(s, 'info', `Round ${s.round} — all players place their order markers.`);
}

/** The ONE army card acting this turn: the current player's card holding the
 *  revealed marker that matches turnNumber. Null outside a turn. The board
 *  uses this for the banner; the move/attack guards use it for validation. */
export function getActiveCardUid(state: HSState): string | null {
  if (state.phase !== 'playing' || state.subPhase !== 'turns' || state.turnSeat == null) {
    return null;
  }
  return (
    state.cards.find(
      c =>
        c.ownerSeat === state.turnSeat &&
        c.orderMarkers.some(m => m.revealed && m.marker === String(state.turnNumber)),
    )?.uid ?? null
  );
}

/** Why `fig` may not act this turn (null = it is on the revealed card). */
function activeCardError(state: HSState, fig: Figure): string | null {
  const activeUid = getActiveCardUid(state);
  if (!activeUid) return 'No order marker is revealed';
  if (fig.cardUid !== activeUid) {
    const active = state.cards.find(c => c.uid === activeUid)!;
    return `Only the revealed card acts this turn — order marker ${state.turnNumber} is on ${HS_CARDS[active.cardId].name}`;
  }
  return null;
}

// ============================================================================
// Terrain geometry helpers (height / eye / engagement) — slice 3
// ============================================================================

/** Tile-stack level the cell under `key` sits on (0 if off-map / null). */
function heightOfKey(state: HSState, key: HexKey | null): number {
  if (key == null) return 0;
  return MAPS[state.mapId]?.cells[key]?.height ?? 0;
}

/** A figure's base level = the height of the cell it stands on. */
function baseLevel(state: HSState, fig: Figure): number {
  return heightOfKey(state, fig.at);
}

/** Sightline elevation of a figure for elevation-aware LOS (board §LOS): the
 *  cell height + 1, so a figure on a taller column sees over a shorter one. */
function eyeHeightOfKey(state: HSState, key: HexKey): number {
  return heightOfKey(state, key) + 1;
}

/** Living ENEMY figures of `fig` that it is currently engaged with — pure
 *  geometry (adjacency + the elevation exception, 03-movement §8). */
function enemiesEngagedWith(state: HSState, fig: Figure): Figure[] {
  if (fig.at == null) return [];
  const figH = cardDefFor(state, fig).height;
  const heightAt = (k: HexKey) => heightOfKey(state, k);
  return state.figures.filter(other => {
    if (other.at == null || other.ownerSeat === fig.ownerSeat || other.id === fig.id) return false;
    return areEngaged(fig.at!, figH, other.at, cardDefFor(state, other).height, heightAt);
  });
}

/** Is `fig` (at its current cell) engaged with `enemy` (at its current cell)? */
function engagedPair(state: HSState, fig: Figure, enemy: Figure): boolean {
  if (fig.at == null || enemy.at == null) return false;
  return areEngaged(
    fig.at,
    cardDefFor(state, fig).height,
    enemy.at,
    cardDefFor(state, enemy).height,
    (k: HexKey) => heightOfKey(state, k),
  );
}

// ============================================================================
// Movement
// ============================================================================

/** Shared guard: can this figure move right now? Returns the figure or a
 *  specific error. Used by both doMove and legalDestinations so the board's
 *  highlights can never disagree with the engine's validation. */
function movableFigure(state: HSState, figureId: string): { fig: Figure } | { error: string } {
  if (state.phase !== 'playing' || state.subPhase !== 'turns') {
    return { error: 'The battle is not in a turn' };
  }
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return { error: 'No such figure on the battlefield' };
  if (fig.ownerSeat !== state.turnSeat) return { error: 'You can only move your own figures' };
  const cardErr = activeCardError(state, fig);
  if (cardErr) return { error: cardErr };
  if (state.attackedFigureIds.length > 0) {
    return { error: 'Movement is over once attacking begins' };
  }
  if (state.movedFigureIds.includes(figureId)) {
    return { error: 'That figure has already moved this turn' };
  }
  return { fig };
}

/** Every hex `figureId` may legally end a move on right now (empty set when
 *  the figure can't move at all). The board uses this for highlights. */
export function legalDestinations(state: HSState, figureId: string): Set<HexKey> {
  const r = movableFigure(state, figureId);
  if ('error' in r) return new Set();
  return movementDestinations(state, r.fig);
}

function movementDestinations(state: HSState, fig: Figure): Set<HexKey> {
  const map = MAPS[state.mapId];
  if (!map || fig.at == null) return new Set();
  const def = cardDefFor(state, fig);
  // slice 4: Flying bypasses the climb cost / climb limit / water stop baked
  // into reachableDestinations — pass the figure's Height for the climb limit.
  return reachableDestinations(map.cells, fig.at, def.move, occupancyLookup(state, fig), def.height);
}

function occupancyLookup(state: HSState, mover: Figure): (key: HexKey) => Occupancy {
  const byHex = new Map<HexKey, number>();
  for (const f of state.figures) {
    if (f.at != null && f.id !== mover.id) byHex.set(f.at, f.ownerSeat);
  }
  return key => {
    const owner = byHex.get(key);
    if (owner == null) return null;
    return owner === mover.ownerSeat ? 'friendly' : 'enemy';
  };
}

/**
 * The dice a move from `fig.at` to `to` REQUIRES — a pure function of the
 * pre-move state and the destination, so the server (actions.ts) and the
 * engine's re-validation compute the SAME need (the slice-3 "server computes
 * need, then rolls, engine re-validates" seam). Falls (03-movement §4) and
 * leaving-engagement swipes (§9) are judged by START vs END geometry.
 *
 * slice 4: Flying bypasses both — a flyer does not fall, and only enemies it
 * was engaged with WHEN IT STARTED its move swipe (takeoff), so the abandoned
 * set would be computed differently.
 */
export function moveConsequences(
  state: HSState,
  fig: Figure,
  to: HexKey,
): { tier: FallTier; fallDice: number; abandonedEnemyIds: string[] } {
  const from = fig.at;
  const map = MAPS[state.mapId];
  const cardHeight = cardDefFor(state, fig).height;

  // Fall: drop = height(from) − height(to); none if landing on water.
  const drop = from != null ? heightOfKey(state, from) - heightOfKey(state, to) : 0;
  const intoWater = map?.cells[to]?.terrain === 'water';
  const { tier, dice: fallDice } = computeFall(Math.max(0, drop), cardHeight, intoWater);

  // Leaving engagement: enemies engaged at move START that the DESTINATION is
  // no longer adjacent-engaged to. Build a hypothetical "fig stands on `to`"
  // figure for the end-adjacency test.
  const startEngaged = enemiesEngagedWith(state, fig);
  const figAtDest: Figure = { ...fig, at: to };
  const abandonedEnemyIds = startEngaged
    .filter(enemy => !engagedPair(state, figAtDest, enemy))
    .map(enemy => enemy.id);

  return { tier, fallDice, abandonedEnemyIds };
}

function doMove(
  state: HSState,
  figureId: string,
  to: HexKey,
  fallRoll?: CombatFace[],
  extremeFallD20?: number,
  leaveRolls?: { enemyFigureId: string; roll: CombatFace }[],
): HSResult {
  const r = movableFigure(state, figureId);
  if ('error' in r) return r;
  const map = MAPS[state.mapId];
  if (!map.cells[to]) return { error: 'There is no hex there' };
  if (!movementDestinations(state, r.fig).has(to)) {
    return { error: 'That hex is out of reach for this figure' };
  }

  // Recompute the exact dice this move needs (server-roll seam): the engine is
  // the source of truth, so a missing-but-required or unneeded roll is rejected.
  const { tier, fallDice, abandonedEnemyIds } = moveConsequences(state, r.fig, to);

  // --- validate falling dice ---
  if (tier === 'extreme') {
    if (fallRoll != null && fallRoll.length > 0) return { error: 'Unexpected fall dice for an extreme fall' };
    if (!Number.isInteger(extremeFallD20) || extremeFallD20! < 1 || extremeFallD20! > 20) {
      return { error: 'Extreme fall requires a d20 roll (1-20)' };
    }
  } else {
    if (extremeFallD20 != null) return { error: 'Unexpected d20 roll — this is not an extreme fall' };
    if (!validFaces(fallRoll ?? [], fallDice)) {
      return { error: fallDice > 0 ? `This fall requires ${fallDice} combat die roll(s)` : 'Unexpected fall dice — no fall is due' };
    }
  }

  // --- validate the leaving-engagement swipe set matches exactly ---
  const wantSwipe = new Set(abandonedEnemyIds);
  const gotSwipe = leaveRolls ?? [];
  if (gotSwipe.length !== wantSwipe.size) {
    return { error: 'Leaving-engagement rolls do not match the abandoned enemies' };
  }
  for (const lr of gotSwipe) {
    if (!wantSwipe.has(lr.enemyFigureId)) {
      return { error: `${lr.enemyFigureId} is not a leaving-engagement attacker for this move` };
    }
    if (lr.roll !== 'skull' && lr.roll !== 'shield' && lr.roll !== 'blank') {
      return { error: 'Malformed leaving-engagement roll' };
    }
  }
  if (new Set(gotSwipe.map(lr => lr.enemyFigureId)).size !== gotSwipe.length) {
    return { error: 'Duplicate leaving-engagement attacker' };
  }

  const s = clone(state);
  const fig = s.figures.find(f => f.id === figureId)!;
  const moverLabel = figureLabel(s, fig);
  const fromKey = fig.at;
  fig.at = to;
  s.movedFigureIds.push(figureId);
  pushLog(s, 'move', `${moverLabel} moves to ${hexLabel(to)}.`);

  // --- leaving-engagement swipes resolve first (mid-move, as the figure
  // leaves): each abandoned enemy lands 1 unblockable wound per skull. A swipe
  // that kills the mover removes it before it can land/fall (documented
  // slice-3 reading: the move ends, no fall). ---
  for (const lr of gotSwipe) {
    if (fig.at == null) break; // already destroyed by an earlier swipe
    const enemy = s.figures.find(f => f.id === lr.enemyFigureId);
    const enemyLabel = enemy ? figureLabel(s, enemy) : 'an enemy';
    const skull = lr.roll === 'skull' ? 1 : 0;
    if (skull > 0) {
      fig.wounds += 1;
      const dead = fig.wounds >= cardDefFor(s, fig).life;
      if (dead) fig.at = null;
      pushLog(s, 'fall', `${enemyLabel} takes a leaving-engagement swipe at ${moverLabel} — 1 wound${dead ? `, ${moverLabel} is destroyed!` : '.'}`);
    } else {
      pushLog(s, 'fall', `${enemyLabel} swipes at ${moverLabel} as it leaves — miss.`);
    }
  }

  // --- falling resolves after landing (skipped if a swipe already killed the
  // mover, since it never landed). ---
  if (fig.at != null && tier !== 'none') {
    applyFall(s, fig, fromKey, to, tier, fallRoll ?? [], extremeFallD20);
  }

  // A mid-move destruction can win the game (last enemy of a seat removed).
  checkEliminationWin(s);
  return s;
}

/** Apply a resolved fall to the mover (03-movement §4). Fall/Major: 1 wound per
 *  skull. Extreme: d20 19-20 unharmed, 1-18 destroyed outright (no wound dice).
 *  Wounds are unblockable. */
function applyFall(
  s: HSState,
  fig: Figure,
  fromKey: HexKey | null,
  to: HexKey,
  tier: FallTier,
  fallRoll: CombatFace[],
  extremeFallD20: number | undefined,
): void {
  const drop = Math.max(0, heightOfKey(s, fromKey) - heightOfKey(s, to));
  const label = figureLabel(s, fig);
  if (tier === 'extreme') {
    const survived = (extremeFallD20 ?? 0) >= 19;
    if (!survived) fig.at = null;
    pushLog(
      s,
      'fall',
      `${label} takes an EXTREME fall of ${drop} — d20 ${extremeFallD20}: ${survived ? 'survives unharmed.' : `destroyed!`}`,
    );
    return;
  }
  const skulls = fallRoll.filter(f => f === 'skull').length;
  if (skulls > 0) {
    fig.wounds += skulls;
    const dead = fig.wounds >= cardDefFor(s, fig).life;
    if (dead) fig.at = null;
    pushLog(
      s,
      'fall',
      `${label} ${tier === 'major' ? 'takes a MAJOR fall' : 'falls'} ${drop} level${drop === 1 ? '' : 's'} — ${skulls} skull${skulls === 1 ? '' : 's'}, ${skulls} wound${skulls === 1 ? '' : 's'}${dead ? `, destroyed!` : '.'}`,
    );
  } else {
    pushLog(s, 'fall', `${label} ${tier === 'major' ? 'takes a MAJOR fall' : 'falls'} ${drop} level${drop === 1 ? '' : 's'} — no skulls, unharmed.`);
  }
}

// ============================================================================
// Attack
// ============================================================================

/** Shared guard: can this figure attack right now? */
function attackReadyFigure(state: HSState, attackerId: string): { fig: Figure } | { error: string } {
  if (state.phase !== 'playing' || state.subPhase !== 'turns') {
    return { error: 'The battle is not in a turn' };
  }
  const fig = state.figures.find(f => f.id === attackerId);
  if (!fig || fig.at == null) return { error: 'No such attacker on the battlefield' };
  if (fig.ownerSeat !== state.turnSeat) return { error: 'You can only attack with your own figures' };
  const cardErr = activeCardError(state, fig);
  if (cardErr) return { error: cardErr };
  if (state.attackedFigureIds.includes(attackerId)) {
    return { error: 'That figure has already attacked this turn' };
  }
  return { fig };
}

/** Why `target` can't be attacked by `attacker` (null = legal target).
 *  Three separate gates per the rules: an ENGAGED figure may attack only the
 *  enemies it is engaged with (04-combat §Who may attack, p. 13); the target
 *  must be within Range (spaces, elevation-free); and there must be a clear,
 *  elevation-aware Line of Sight. */
function targetBlockReason(state: HSState, attacker: Figure, target: Figure): string | null {
  if (target.at == null) return 'No such target on the battlefield';
  if (target.ownerSeat === attacker.ownerSeat) return 'You cannot attack your own figures';
  const map = MAPS[state.mapId];
  const def = cardDefFor(state, attacker);

  // Engaged figures can't shoot past their engagement: if the attacker is
  // engaged with any enemy, it may attack ONLY an enemy it is engaged with.
  const engaged = enemiesEngagedWith(state, attacker);
  if (engaged.length > 0 && !engaged.some(e => e.id === target.id)) {
    return 'Engaged — you may only attack a figure you are engaged with';
  }

  const dist = rangeDistance(map.cells, attacker.at!, target.at);
  if (dist == null || dist > def.range) return `Out of range (Range ${def.range})`;
  const occupied: HexKey[] = [];
  for (const f of state.figures) {
    if (f.at != null && f.id !== attacker.id && f.id !== target.id) occupied.push(f.at);
  }
  if (
    !hasLineOfSight3D(map.cells, attacker.at!, target.at, occupied, (k: HexKey) =>
      eyeHeightOfKey(state, k),
    )
  ) {
    return 'No line of sight — terrain or a figure is in the way';
  }
  return null;
}

/** Enemy figure ids `attackerId` may attack right now (range + LOS + turn
 *  rules). The board uses this for target highlights. */
export function legalTargets(state: HSState, attackerId: string): string[] {
  const r = attackReadyFigure(state, attackerId);
  if ('error' in r) return [];
  return state.figures
    .filter(t => t.at != null && t.ownerSeat !== r.fig.ownerSeat)
    .filter(t => targetBlockReason(state, r.fig, t) == null)
    .map(t => t.id);
}

/**
 * Height advantage (04-combat §Height Advantage, resolved +2 rule) — the SINGLE
 * source of truth for the bonus. Compare base elevations of the two cells:
 *   • attacker higher → +1 ATTACK die (the higher figure rolls the extra die)
 *   • defender higher → +1 DEFENSE die
 *   • the "+2 instead" band: if the higher figure's base level is ≥ 10 above
 *     the LOWER figure's HEIGHT number, +2 instead of +1 (keys off the lower
 *     figure's Height, per the printed rule — never fires on slice-3 maps, but
 *     implemented and tested).
 *   • equal base elevation → 0.
 * Returns the bonus on each side (one is always 0). Symmetric; computed once
 * here so the board preview and the resolution can never disagree.
 */
export function heightAdvantage(
  state: HSState,
  attacker: Figure,
  target: Figure,
): { attacker: number; defender: number } {
  const aBase = baseLevel(state, attacker);
  const dBase = baseLevel(state, target);
  if (aBase === dBase) return { attacker: 0, defender: 0 };
  if (aBase > dBase) {
    const big = aBase >= 10 + cardDefFor(state, target).height;
    return { attacker: big ? 2 : 1, defender: 0 };
  }
  const big = dBase >= 10 + cardDefFor(state, attacker).height;
  return { attacker: 0, defender: big ? 2 : 1 };
}

/**
 * Dice the server must roll for an attack: the printed Attack/Defense numbers
 * WITH the height-advantage bonus already folded in (the SINGLE source of
 * truth — board preview and engine resolution both read this, so a displayed
 * count can never disagree with an enforced one). `heightBonusAttacker` /
 * `heightBonusDefender` break out the bonus for the dice-panel caption.
 * Null when either figure id is unknown — the engine then rejects with a real
 * error message.
 *
 * slice 4: powers/glyphs add further bonus dice here on BOTH sides.
 */
export function attackDiceRequirements(
  state: HSState,
  attackerId: string,
  targetId: string,
): { attack: number; defense: number; heightBonusAttacker: number; heightBonusDefender: number } | null {
  const attacker = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!attacker || !target) return null;
  const bonus = heightAdvantage(state, attacker, target);
  return {
    attack: cardDefFor(state, attacker).attack + bonus.attacker,
    defense: cardDefFor(state, target).defense + bonus.defender,
    heightBonusAttacker: bonus.attacker,
    heightBonusDefender: bonus.defender,
  };
}

function doAttack(
  state: HSState,
  action: { attackerId: string; targetId: string; attackRoll: CombatFace[]; defenseRoll: CombatFace[] },
): HSResult {
  const r = attackReadyFigure(state, action.attackerId);
  if ('error' in r) return r;
  const attacker = r.fig;
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target) return { error: 'No such target on the battlefield' };
  const blockReason = targetBlockReason(state, attacker, target);
  if (blockReason) return { error: blockReason };

  // Read the required dice counts from the SINGLE source of truth — the same
  // helper the board's preview uses — so the rolled-dice count the server sent
  // is validated against exactly the displayed count (printed stat + height
  // advantage). req is non-null here (both ids resolved above).
  const req = attackDiceRequirements(state, attacker.id, target.id)!;
  const tDef = cardDefFor(state, target);
  if (!validFaces(action.attackRoll, req.attack)) return { error: 'Malformed attack roll' };
  if (!validFaces(action.defenseRoll, req.defense)) return { error: 'Malformed defense roll' };

  // Count ONLY skulls on the attack and ONLY shields on the defense —
  // off-symbols and blanks never count (04-combat §Attack resolution).
  const skulls = countFaces(action.attackRoll, 'skull');
  const shields = countFaces(action.defenseRoll, 'shield');
  // Master combat (p. 14): each shield blocks one skull; shields ≥ skulls →
  // nothing (ties favor the defender); each UNBLOCKED skull places one wound;
  // the figure is destroyed when wounds reach its Life. Life-1 squad figures
  // therefore still die to a single unblocked skull.
  const wounds = Math.max(0, skulls - shields);

  const s = clone(state);
  s.attackedFigureIds.push(attacker.id);
  const targetMut = s.figures.find(f => f.id === target.id)!;
  targetMut.wounds += wounds;
  const destroyed = targetMut.wounds >= tDef.life;
  if (destroyed) targetMut.at = null;

  const attackerLabel = figureLabel(s, attacker);
  const targetLabel = figureLabel(s, targetMut);
  s.lastAttack = {
    attackerId: attacker.id,
    targetId: target.id,
    attackerLabel,
    targetLabel,
    attackRoll: action.attackRoll,
    defenseRoll: action.defenseRoll,
    skulls,
    shields,
    wounds,
    destroyed,
    heightBonusAttacker: req.heightBonusAttacker,
    heightBonusDefender: req.heightBonusDefender,
    seq: s.logSeq + 1,
  };
  const outcome = destroyed
    ? `${targetLabel} is destroyed!`
    : wounds > 0
      ? `${wounds} wound${wounds === 1 ? '' : 's'}.`
      : 'blocked.';
  const height =
    req.heightBonusAttacker > 0
      ? ` (+${req.heightBonusAttacker} height advantage)`
      : req.heightBonusDefender > 0
        ? ` (defender +${req.heightBonusDefender} height advantage)`
        : '';
  pushLog(
    s,
    'attack',
    `${attackerLabel} attacks ${targetLabel}${height}: ${skulls} skull${skulls === 1 ? '' : 's'} vs ${shields} shield${shields === 1 ? '' : 's'} — ${outcome}`,
  );

  // Elimination win: the last player with figures remaining wins.
  checkEliminationWin(s);
  return s;
}

/**
 * Finish the battle if exactly one seat still has living figures (the last
 * army standing wins). Idempotent and roll-source-agnostic, so attack kills,
 * fall deaths, and leaving-engagement swipes all settle the win the same way.
 * A figure can be removed mid-move (a swipe/fall), so this is called after
 * movement as well as after an attack.
 */
function checkEliminationWin(s: HSState): void {
  if (s.phase !== 'playing') return;
  const seatsAlive = new Set(
    s.figures.filter(f => f.at != null).map(f => f.ownerSeat),
  );
  if (seatsAlive.size > 1) return;
  // 0 or 1 seats remain. With 2 players a draw is impossible in practice (a
  // turn belongs to one seat, whose own move can only kill via a swipe FROM
  // the enemy or a self-inflicted fall — the surviving seat wins). If somehow
  // nobody is left, the acting seat is gone too; fall back to the last living
  // seat, else leave the game running.
  const winner = [...seatsAlive][0];
  if (winner == null) return;
  s.phase = 'finished';
  s.winnerSeat = winner;
  s.turnSeat = null;
  pushLog(s, 'win', `${playerName(s, winner)} wins — the enemy army is destroyed!`);
}

// ============================================================================
// End turn
// ============================================================================

function doEndTurn(state: HSState, seat: number): HSResult {
  const s = clone(state);
  pushLog(s, 'info', `${playerName(s, seat)} ends the turn.`);
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.attackedFigureIds = [];
  if (advanceSlot(s)) beginTurnOrSkip(s);
  return s;
}

// ============================================================================
// Registry contract
// ============================================================================

export function getActivePlayerId(state: HSState): string | null {
  // Null while placing markers (simultaneous, ready-gated) and in lobby /
  // finished — there is a single active player only during a turn.
  if (state.phase !== 'playing' || state.turnSeat == null) return null;
  return state.players.find(p => p.seat === state.turnSeat)?.playerId ?? null;
}

/** Stable seat order for the whole match (platform invariant — initiative
 *  decides who ACTS first each round, never the seating order). */
export function getOrderedPlayerIds(state: HSState): string[] {
  return state.players.map(p => p.playerId); // players[] is kept sorted by seat
}

export function computeHistory(
  state: HSState,
): { winnerId: string | null; playerIds: string[] } | null {
  // THE GATE: no history row until the battle is truly over.
  // recordHistoryIfFinished inserts with no dedupe on every non-null return —
  // returning a winner mid-game writes phantom W/L rows (the Long Shot lesson).
  if (state.phase !== 'finished') return null;
  return {
    winnerId: state.players.find(p => p.seat === state.winnerSeat)?.playerId ?? null,
    playerIds: getOrderedPlayerIds(state),
  };
}

/**
 * Per-viewer projection — the hidden-information boundary (slice-2 spec
 * §Projection, ARCHITECTURE §8). For every card NOT owned by the viewer,
 * every UNREVEALED marker projects to the same `{ marker: 'hidden',
 * revealed: false }` placeholder: the count is public (chips are visible on
 * the table), the values are not, and the X decoy is byte-for-byte
 * indistinguishable from 1/2/3. Revealed markers keep their value — they are
 * public by definition and only ever 1/2/3, because the X is never revealed
 * (not even on a destroyed card, p. 14). Everything else is public. Never
 * mutates the input.
 */
export function projectStateForViewer(state: HSState, viewerId: string | null): HSState {
  const viewerSeat = state.players.find(p => p.playerId === viewerId)?.seat ?? null;
  const next = clone(state);
  for (const card of next.cards) {
    if (card.ownerSeat === viewerSeat) continue;
    card.orderMarkers = card.orderMarkers.map(m =>
      m.revealed ? m : { marker: 'hidden', revealed: false },
    );
  }
  return next;
}

// ============================================================================
// Small helpers
// ============================================================================

function clone(state: HSState): HSState {
  return JSON.parse(JSON.stringify(state)) as HSState;
}

function pushLog(s: HSState, tag: HSLogEntry['tag'], text: string): void {
  s.logSeq += 1;
  s.log.push({ seq: s.logSeq, text, tag });
  if (s.log.length > LOG_MAX) s.log = s.log.slice(-LOG_MAX);
}

export function cardDef(cardId: string): HSCardDef {
  return HS_CARDS[cardId];
}

function cardDefFor(state: HSState, fig: Figure): HSCardDef {
  const card = state.cards.find(c => c.uid === fig.cardUid);
  return HS_CARDS[card?.cardId ?? ''] ?? HS_CARDS.finn;
}

function cardHasLivingFigures(state: HSState, cardUid: string): boolean {
  return state.figures.some(f => f.cardUid === cardUid && f.at != null);
}

/** "Finn" for heroes, "Marro Warrior 3" for squad figures. */
export function figureLabel(state: HSState, fig: Figure): string {
  const def = cardDefFor(state, fig);
  return def.type === 'hero' ? def.shortName : `${def.shortName} ${fig.index}`;
}

function playerName(state: HSState, seat: number): string {
  return state.players.find(p => p.seat === seat)?.username ?? 'Player';
}

/** Human-readable hex label in the map's (col, row) notation, 1-based. */
function hexLabel(key: HexKey): string {
  const { col, row } = axialToOffset(key);
  return `(${col + 1}, ${row + 1})`;
}

function countFaces(faces: CombatFace[], face: CombatFace): number {
  return faces.filter(f => f === face).length;
}

function validFaces(faces: CombatFace[] | undefined, expected: number): boolean {
  return (
    Array.isArray(faces) &&
    faces.length === expected &&
    faces.every(f => f === 'skull' || f === 'shield' || f === 'blank')
  );
}
