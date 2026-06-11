// HeroScape engine — slice 1: the BASIC GAME exactly as the wiki states
// (docs/heroscape/01…04). 2 players, fixed armies, flat Training Field map:
//
//   • First player: each player rolls 6 combat dice, most skulls goes first,
//     ties re-roll (a combat-dice roll, NOT the Master Game's d20 initiative).
//   • Turns strictly alternate. On your turn you activate ONE army card:
//     move any/all/none of its figures (each up to its Move, flat 1/hex, may
//     pass through friendlies, never enemies, can't end on an occupied hex),
//     THEN each of its figures may attack once. The order is one-way — once
//     any attack happens, movement for the turn is over.
//   • Attack: target must be within Range (spaces counted around gaps,
//     elevation-free) AND in line of sight. Attacker rolls Attack dice
//     (count only skulls), defender rolls Defense dice (count only shields);
//     shields ≥ skulls → nothing; skulls > shields → defender DESTROYED
//     (Basic Game is binary — no wounds in slice 1).
//   • A player with no figures remaining loses; last player with figures wins.
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
  RollOffRound,
} from './types';
import { MAPS } from './maps';
import { HS_CARDS, SLICE1_ARMIES, ROLL_OFF_DICE } from './content';
import {
  axialToOffset,
  hasLineOfSight,
  rangeDistance,
  reachableDestinations,
  type Occupancy,
} from './board';

export const STATE_VERSION = 1;
export const LOG_MAX = 60;
const SEATS = 2;
const DEFAULT_MAP_ID = 'training_field';

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
    turnSeat: null,
    activeCardUid: null,
    movedFigureIds: [],
    attackedFigureIds: [],
    rollOff: null,
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
    // validates the game shape + the server-rolled roll-off.
    return doStartGame(state, action.rollOffs);
  }
  if (state.phase === 'lobby') return { error: 'The battle has not started yet' };
  if (state.phase === 'finished') return { error: 'The battle is over' };
  const me = state.players.find(p => p.playerId === playerId)!;
  if (state.turnSeat !== me.seat) return { error: 'Not your turn' };

  switch (action.kind) {
    case 'move_figure':
      return doMove(state, action.figureId, action.to);
    case 'attack':
      return doAttack(state, me.seat, action);
    case 'end_turn':
      return doEndTurn(state, me.seat);
  }
}

// ============================================================================
// Start: roll-off + fixed armies + auto-placement
// ============================================================================

function doStartGame(state: HSState, rollOffs: RollOffRound[]): HSResult {
  if (state.phase !== 'lobby') return { error: 'The battle has already started' };
  if (state.players.length !== SEATS) return { error: 'HeroScape needs exactly 2 players' };
  const map = MAPS[state.mapId];
  if (!map) return { error: `Unknown battlefield "${state.mapId}"` };

  // Validate the server-rolled roll-off: 6 combat dice each per round; every
  // round before the last must be a skull tie (that's why it was re-rolled);
  // the final round must be decisive. Most skulls takes the first turn.
  if (!Array.isArray(rollOffs) || rollOffs.length === 0) {
    return { error: 'Missing first-turn roll-off' };
  }
  for (const round of rollOffs) {
    if (!validFaces(round?.seat0, ROLL_OFF_DICE) || !validFaces(round?.seat1, ROLL_OFF_DICE)) {
      return { error: 'Malformed roll-off dice' };
    }
  }
  for (let i = 0; i < rollOffs.length - 1; i++) {
    if (countFaces(rollOffs[i].seat0, 'skull') !== countFaces(rollOffs[i].seat1, 'skull')) {
      return { error: 'Roll-off re-rolled a round that was not a tie' };
    }
  }
  const last = rollOffs[rollOffs.length - 1];
  const skulls0 = countFaces(last.seat0, 'skull');
  const skulls1 = countFaces(last.seat1, 'skull');
  if (skulls0 === skulls1) return { error: 'Roll-off ended in a tie — roll again' };
  const winnerIdx = skulls0 > skulls1 ? 0 : 1;

  const s = clone(state);
  s.cards = [];
  s.figures = [];

  // Fixed slice-1 armies, auto-placed in each player's start zone.
  // TODO(slice 2): manual placement — the rules let each player arrange their
  // own figures inside their starting zone (01-components §5). Slice 1
  // auto-places a fixed, sensible arrangement (hero centered, squad figures
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
      };
      s.cards.push(card);
      for (let n = 1; n <= def.figures; n++) {
        s.figures.push({
          id: `${card.uid}-${n}`,
          cardUid: card.uid,
          ownerSeat: player.seat,
          at: def.type === 'hero' ? heroSpot : squadSpots[n - 1],
          index: n,
        });
      }
    }
  }

  s.phase = 'playing';
  // Keep at most the last 4 rounds in state (tie spam is astronomically rare).
  s.rollOff = { rounds: rollOffs.slice(-4), winnerSeat: s.players[winnerIdx].seat };
  s.turnSeat = s.players[winnerIdx].seat;
  s.activeCardUid = null;
  s.movedFigureIds = [];
  s.attackedFigureIds = [];
  s.winnerSeat = null;

  pushLog(s, 'info', `Battle on the ${map.name}! Each player rolls ${ROLL_OFF_DICE} combat dice for the first turn.`);
  rollOffs.forEach((round, i) => {
    const a = countFaces(round.seat0, 'skull');
    const b = countFaces(round.seat1, 'skull');
    const tie = a === b ? ' Tie — re-roll!' : '';
    pushLog(s, 'roll', `Roll-off ${i + 1}: ${s.players[0].username} ${a} skull${a === 1 ? '' : 's'} — ${s.players[1].username} ${b} skull${b === 1 ? '' : 's'}.${tie}`);
  });
  pushLog(s, 'info', `${s.players[winnerIdx].username} takes the first turn.`);
  return s;
}

// ============================================================================
// Movement
// ============================================================================

/** Shared guard: can this figure move right now? Returns the figure or a
 *  specific error. Used by both doMove and legalDestinations so the board's
 *  highlights can never disagree with the engine's validation. */
function movableFigure(state: HSState, figureId: string): { fig: Figure } | { error: string } {
  if (state.phase !== 'playing') return { error: 'The battle is not in progress' };
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return { error: 'No such figure on the battlefield' };
  if (fig.ownerSeat !== state.turnSeat) return { error: 'You can only move your own figures' };
  const lockErr = cardLockError(state, fig);
  if (lockErr) return { error: lockErr };
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
  return reachableDestinations(map.cells, fig.at, def.move, occupancyLookup(state, fig));
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

function doMove(state: HSState, figureId: string, to: HexKey): HSResult {
  const r = movableFigure(state, figureId);
  if ('error' in r) return r;
  const map = MAPS[state.mapId];
  if (!map.cells[to]) return { error: 'There is no hex there' };
  if (!movementDestinations(state, r.fig).has(to)) {
    return { error: 'That hex is out of reach for this figure' };
  }
  const s = clone(state);
  const fig = s.figures.find(f => f.id === figureId)!;
  fig.at = to;
  s.activeCardUid = fig.cardUid; // first action of the turn locks the card
  s.movedFigureIds.push(figureId);
  pushLog(s, 'move', `${figureLabel(s, fig)} moves to ${hexLabel(to)}.`);
  return s;
}

// ============================================================================
// Attack
// ============================================================================

/** Shared guard: can this figure attack right now? */
function attackReadyFigure(state: HSState, attackerId: string): { fig: Figure } | { error: string } {
  if (state.phase !== 'playing') return { error: 'The battle is not in progress' };
  const fig = state.figures.find(f => f.id === attackerId);
  if (!fig || fig.at == null) return { error: 'No such attacker on the battlefield' };
  if (fig.ownerSeat !== state.turnSeat) return { error: 'You can only attack with your own figures' };
  const lockErr = cardLockError(state, fig);
  if (lockErr) return { error: lockErr };
  if (state.attackedFigureIds.includes(attackerId)) {
    return { error: 'That figure has already attacked this turn' };
  }
  return { fig };
}

/** Why `target` can't be attacked by `attacker` (null = legal target).
 *  Both eligibility tests are separate, per the rules: within Range AND a
 *  clear line of sight. */
function targetBlockReason(state: HSState, attacker: Figure, target: Figure): string | null {
  if (target.at == null) return 'No such target on the battlefield';
  if (target.ownerSeat === attacker.ownerSeat) return 'You cannot attack your own figures';
  const map = MAPS[state.mapId];
  const def = cardDefFor(state, attacker);
  const dist = rangeDistance(map.cells, attacker.at!, target.at);
  if (dist == null || dist > def.range) return `Out of range (Range ${def.range})`;
  const occupied: HexKey[] = [];
  for (const f of state.figures) {
    if (f.at != null && f.id !== attacker.id && f.id !== target.id) occupied.push(f.at);
  }
  if (!hasLineOfSight(attacker.at!, target.at, occupied)) {
    return 'No line of sight — a figure is in the way';
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

/** Dice the server must roll for an attack: the printed Attack vs the printed
 *  Defense (slice 1 has no height advantage / powers / glyph bonuses).
 *  Null when either figure id is unknown — the engine then rejects the action
 *  with a real error message. */
export function attackDiceRequirements(
  state: HSState,
  attackerId: string,
  targetId: string,
): { attack: number; defense: number } | null {
  const attacker = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!attacker || !target) return null;
  return {
    attack: cardDefFor(state, attacker).attack,
    defense: cardDefFor(state, target).defense,
  };
}

function doAttack(
  state: HSState,
  seat: number,
  action: { attackerId: string; targetId: string; attackRoll: CombatFace[]; defenseRoll: CombatFace[] },
): HSResult {
  const r = attackReadyFigure(state, action.attackerId);
  if ('error' in r) return r;
  const attacker = r.fig;
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target) return { error: 'No such target on the battlefield' };
  const blockReason = targetBlockReason(state, attacker, target);
  if (blockReason) return { error: blockReason };

  const aDef = cardDefFor(state, attacker);
  const tDef = cardDefFor(state, target);
  if (!validFaces(action.attackRoll, aDef.attack)) return { error: 'Malformed attack roll' };
  if (!validFaces(action.defenseRoll, tDef.defense)) return { error: 'Malformed defense roll' };

  // Count ONLY skulls on the attack and ONLY shields on the defense —
  // off-symbols and blanks never count (04-combat §Attack resolution).
  const skulls = countFaces(action.attackRoll, 'skull');
  const shields = countFaces(action.defenseRoll, 'shield');
  // shields ≥ skulls → nothing (ties favor the defender);
  // skulls > shields → destroyed outright (Basic Game binary, no wounds).
  const destroyed = skulls > shields;

  const s = clone(state);
  s.activeCardUid = attacker.cardUid; // first action of the turn locks the card
  s.attackedFigureIds.push(attacker.id);
  const targetMut = s.figures.find(f => f.id === target.id)!;
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
    destroyed,
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `${attackerLabel} attacks ${targetLabel}: ${skulls} skull${skulls === 1 ? '' : 's'} vs ${shields} shield${shields === 1 ? '' : 's'} — ${destroyed ? `${targetLabel} is destroyed!` : 'blocked.'}`,
  );

  // Elimination win: the last player with figures remaining wins.
  const enemyAlive = s.figures.some(f => f.ownerSeat !== seat && f.at != null);
  if (!enemyAlive) {
    s.phase = 'finished';
    s.winnerSeat = seat;
    s.turnSeat = null;
    s.activeCardUid = null;
    pushLog(s, 'win', `${playerName(s, seat)} wins — the enemy army is destroyed!`);
  }
  return s;
}

// ============================================================================
// End turn
// ============================================================================

function doEndTurn(state: HSState, seat: number): HSResult {
  const s = clone(state);
  const next = s.players.find(p => p.seat !== seat)!; // 2 players: strict alternation
  s.turnSeat = next.seat;
  s.activeCardUid = null;
  s.movedFigureIds = [];
  s.attackedFigureIds = [];
  pushLog(s, 'info', `${playerName(s, seat)} ends the turn — ${next.username} is up.`);
  return s;
}

// ============================================================================
// Registry contract
// ============================================================================

export function getActivePlayerId(state: HSState): string | null {
  if (state.phase !== 'playing' || state.turnSeat == null) return null;
  return state.players.find(p => p.seat === state.turnSeat)?.playerId ?? null;
}

/** Stable seat order for the whole match (platform invariant — the roll-off
 *  decides who ACTS first, never the seating order). */
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

/** Card-activation lock: the turn's first move/attack picks the ONE army card
 *  acting this turn. Until then the player may freely change their mind. */
function cardLockError(state: HSState, fig: Figure): string | null {
  if (state.activeCardUid && state.activeCardUid !== fig.cardUid) {
    const active = state.cards.find(c => c.uid === state.activeCardUid);
    const name = active ? HS_CARDS[active.cardId].name : 'another card';
    return `Only one army card acts per turn — ${name} is already activated`;
  }
  return null;
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
