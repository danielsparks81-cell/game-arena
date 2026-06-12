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
  HSChoiceResolution,
  HSGlyph,
  HSGlyphId,
  HSLogEntry,
  HSMode,
  HSResult,
  HSState,
  InitiativeAttempt,
  OrderMarkerValue,
} from './types';
import { MAPS } from './maps';
import { HS_CARDS, HS_DRAFT_POOL, SLICE1_ARMIES, HS_GLYPHS } from './content';
import {
  areEngaged,
  axialToOffset,
  computeFall,
  hasLineOfSight3D,
  neighborKeys,
  rangeDistance,
  reachableDestinations,
  type FallTier,
  type Occupancy,
} from './board';

export const STATE_VERSION = 7;
export const LOG_MAX = 60;
const SEATS = 2;
const DEFAULT_MAP_ID = 'training_field';
const MARKER_VALUES: readonly OrderMarkerValue[] = ['1', '2', '3', 'X'];

/** Point-budget presets the lobby offers (slice 5). */
export const POINT_BUDGETS: readonly number[] = [200, 300, 400, 500];
export const DEFAULT_POINT_BUDGET = 400;
const DEFAULT_MODE: HSMode = 'draft';
/** The second player's opening turn is a DOUBLE pick (1,2,…); every later turn
 *  is a single pick (resolutions.md). */
const DRAFT_OPENER_PICKS = 2;

/** Card ids whose figures have a special power the engine acts on (slice 4). */
const TARN_CARD_ID = 'tarn_vikings';
const MARRO_CARD_ID = 'marro_warriors';
const FINN_CARD_ID = 'finn';
const THORGRIM_CARD_ID = 'thorgrim';
const BERSERKER_THRESHOLD = 15;
const WATER_CLONE_THRESHOLD = 15;
const WATER_CLONE_WATER_THRESHOLD = 10;
const DAGMAR_INITIATIVE_BONUS = 8;

// ---- slice 6: stat-folding special powers (cards.md exact text) ----
/** Aura/power source card ids the effective-stat helpers recompute from. */
const RAELIN_CARD_ID = 'raelin';
const DEATHWALKER_CARD_ID = 'deathwalker_9000';
const AGENT_CARR_CARD_ID = 'agent_carr';
const GRIMNAK_CARD_ID = 'grimnak';
const ZETTIAN_CARD_ID = 'zettian_guards';
const SYVARRIS_CARD_ID = 'syvarris';
/** Raelin's EXTENDED DEFENSIVE AURA radius — 6 CLEAR SIGHT spaces (cards.md). */
const RAELIN_AURA_RANGE = 6;
/** Agent Carr's SWORD OF RECKONING 4 — +4 attack dice vs an adjacent figure. */
const SWORD_OF_RECKONING_BONUS = 4;
/** Deathwalker 9000's RANGE ENHANCEMENT — +2 Range to adjacent Soulborg Guards. */
const RANGE_ENHANCEMENT_BONUS = 2;
/** Species/class strings that gate the conditional powers (cards.md). Matched
 *  against HSCardDef.species / .unitClass so the conditions are data-driven. */
const SPECIES_SOULBORG = 'Soulborg';
const CLASS_GUARDS = 'Guards';
const SPECIES_ORC = 'Orc';
const CLASS_WARRIORS = 'Warriors';

// ---- slice 7: movement & defense special powers (cards.md exact text) ----
// Every slice-7 power keys off a DATA-DRIVEN flag on HSCardDef
// (flying/ghostWalk/disengage/thorianSpeed/stealthDodge/counterStrike/grappleGun)
// — never a hard-coded card id — so any future card with the same flag behaves
// identically. The flags are set in content.ts (raelin/mimring flying,
// agent_carr ghostWalk+disengage, drake thorianSpeed+grappleGun, krav_maga
// stealthDodge, izumi_samurai counterStrike).

// ============================================================================
// State construction / lobby
// ============================================================================

export function initialState(): HSState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    players: [],
    mapId: DEFAULT_MAP_ID,
    mode: DEFAULT_MODE,
    pointBudget: DEFAULT_POINT_BUDGET,
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
    turnAttacks: [],
    lastAttack: null,
    winnerSeat: null,
    glyphs: [],
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
    return doStartGame(state, action.mapId, action.pointBudget, action.mode);
  }
  if (action.kind === 'set_lobby_config') {
    // Host changing the battlefield/budget/mode in the lobby — written to shared
    // state so every player sees it (host-gated in the server action).
    return doSetLobbyConfig(state, action.mapId, action.pointBudget, action.mode);
  }
  if (state.phase === 'lobby') return { error: 'The battle has not started yet' };
  if (state.phase === 'finished') return { error: 'The battle is over' };
  const me = state.players.find(p => p.playerId === playerId)!;

  // ---- Draft phase (slice 5) ----
  if (state.phase === 'draft') {
    switch (action.kind) {
      case 'draft_roll':
        return doDraftRoll(state, action.attempts);
      case 'draft_card':
        return doDraftCard(state, me.seat, action.cardId);
      case 'draft_pass':
        return doDraftPass(state, me.seat);
      default:
        return { error: 'The army draft is in progress' };
    }
  }

  // ---- Placement phase (slice 5) ----
  if (state.phase === 'placement') {
    switch (action.kind) {
      case 'place_figure':
        return doPlaceFigure(state, me.seat, action.figureId, action.to);
      case 'unplace_figure':
        return doUnplaceFigure(state, me.seat, action.figureId);
      case 'placement_ready':
        return doPlacementReady(state, me.seat);
      default:
        return { error: 'Place your figures in your start zone first' };
    }
  }

  // PendingChoice gate (slice 4): while a decision is open, the engine blocks
  // every normal action for everyone except the owning seat, and the owner may
  // ONLY resolve it. Never auto-resolved (rules-fidelity §choice).
  if (state.pendingChoice) {
    if (action.kind !== 'resolve_choice') {
      return state.pendingChoice.seat === me.seat
        ? { error: 'Resolve your pending choice first' }
        : { error: 'An opponent has a pending choice — wait for them to resolve it' };
    }
    if (state.pendingChoice.seat !== me.seat) {
      return { error: 'This choice belongs to another player' };
    }
    return doResolveChoice(state, me.seat, action.choice);
  }
  if (action.kind === 'resolve_choice') {
    return { error: 'There is no pending choice to resolve' };
  }

  switch (action.kind) {
    // Simultaneous round-start actions — no turn check (there is no turn yet).
    case 'place_markers':
      return doPlaceMarkers(state, me.seat, action.assignments);
    case 'roll_initiative':
      return doRollInitiative(state, action.attempts);
    // Turn actions — only the revealed-marker player acts.
    case 'move_figure':
    case 'grapple_move':
    case 'attack':
    case 'berserker_charge':
    case 'water_clone':
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
      if (action.kind === 'grapple_move')
        return doGrappleMove(
          state,
          action.figureId,
          action.to,
          action.fallRoll,
          action.extremeFallD20,
          action.leaveRolls,
        );
      if (action.kind === 'attack') return doAttack(state, action);
      if (action.kind === 'berserker_charge') return doBerserkerCharge(state, me.seat, action.d20);
      if (action.kind === 'water_clone') return doWaterClone(state, me.seat, action.rolls);
      return doEndTurn(state, me.seat);
    }
    // Draft/placement actions arriving during 'playing' — out of phase.
    case 'draft_roll':
    case 'draft_card':
    case 'draft_pass':
    case 'place_figure':
    case 'unplace_figure':
    case 'placement_ready':
      return { error: 'That action is not available right now' };
  }
}

// ============================================================================
// Start: route to draft (roll-off) or quick (fixed armies + auto-placement)
// ============================================================================

/** Build a seat's army-card instances + figures from a list of card ids. Each
 *  figure starts at `null` (unplaced); `placeFigures` (quick path) moves them
 *  onto the board afterwards. Card uid = `s{seat}-{cardId}` (cards are unique
 *  per seat). Returns the new cards and figures (caller appends). */
function buildArmy(seat: number, cardIds: readonly string[]): { cards: ArmyCardInstance[]; figures: Figure[] } {
  const cards: ArmyCardInstance[] = [];
  const figures: Figure[] = [];
  for (const cardId of cardIds) {
    const def = HS_CARDS[cardId];
    if (!def) continue;
    const card: ArmyCardInstance = {
      uid: `s${seat}-${cardId}`,
      cardId,
      ownerSeat: seat,
      orderMarkers: [],
      attackMod: 0,
      defenseMod: 0,
    };
    cards.push(card);
    for (let n = 1; n <= def.figures; n++) {
      figures.push({ id: `${card.uid}-${n}`, cardUid: card.uid, ownerSeat: seat, at: null, index: n, wounds: 0 });
    }
  }
  return { cards, figures };
}

/** The seat's OUTER start-zone row (its own back edge, nearest its board edge):
 *  seat 0 = the minimum row of its zone, seat 1 = the maximum. The quick-battle
 *  auto-placement uses this single row so it reproduces the slice-4 positions
 *  exactly even now that the zone spans two rows. */
function outerZoneRow(map: { startZones: Record<number, HexKey[]> }, seat: number): HexKey[] {
  const zone = map.startZones[seat] ?? [];
  if (zone.length === 0) return [];
  const rowOf = (k: HexKey) => axialToOffset(k).row;
  const target = seat === 0 ? Math.min(...zone.map(rowOf)) : Math.max(...zone.map(rowOf));
  return zone.filter(k => rowOf(k) === target).sort((a, b) => axialToOffset(a).col - axialToOffset(b).col);
}

/** Auto-place a quick-battle army on the seat's outer zone row: hero centered,
 *  squad figures flanking — the slice-4 fixed arrangement, preserved so the
 *  quick path reproduces the slice-4 game exactly. Mutates `figures` in place. */
function autoPlaceQuickArmy(map: { startZones: Record<number, HexKey[]> }, seat: number, cards: ArmyCardInstance[], figures: Figure[]): string | null {
  const row = outerZoneRow(map, seat);
  if (row.length < 5) return 'Start zone is too small for the army';
  const center = Math.floor(row.length / 2);
  const heroSpot = row[center];
  const squadSpots = [row[center - 2], row[center - 1], row[center + 1], row[center + 2]];
  for (const card of cards.filter(c => c.ownerSeat === seat)) {
    const def = HS_CARDS[card.cardId];
    const figs = figures.filter(f => f.cardUid === card.uid);
    figs.forEach((f, i) => {
      f.at = def.type === 'hero' ? heroSpot : squadSpots[i];
    });
  }
  return null;
}

/** Shared tail: materialize the map's glyphs (power-side up) and open round 1 in
 *  place_markers (the slice-2 round flow). Used by the quick path and the
 *  placement → playing transition. Assumes s.cards/s.figures are already built
 *  and (for the quick/placement entry) figures are placed. */
function enterPlaying(s: HSState, map: { name: string; glyphs?: { id: HSGlyphId; at: HexKey }[] }): void {
  s.glyphs = (map.glyphs ?? []).map((g): HSGlyph => ({ id: g.id, at: g.at, faceUp: true }));
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
  s.turnAttacks = [];
  s.winnerSeat = null;
  delete s.pendingChoice;
  delete s.waterClonedThisTurn;
  delete s.berserkerSpent;
  delete s.draft;
  delete s.hand;
  delete s.placementReady;
  const glyphNote = s.glyphs.length
    ? ` ${s.glyphs.length} glyph${s.glyphs.length === 1 ? '' : 's'} await on the field.`
    : '';
  pushLog(s, 'info', `Battle on the ${map.name}! Round 1 — all players secretly place their order markers.${glyphNote}`);
}

function doSetLobbyConfig(state: HSState, mapId?: string, pointBudget?: number, mode?: HSMode): HSResult {
  if (state.phase !== 'lobby') return { error: 'Settings can only be changed before the battle starts' };
  const s = clone(state);
  if (mapId !== undefined) {
    if (!MAPS[mapId]) return { error: `Unknown battlefield "${mapId}"` };
    s.mapId = mapId;
  }
  if (mode !== undefined) s.mode = mode;
  if (pointBudget !== undefined) {
    if (!POINT_BUDGETS.includes(pointBudget)) return { error: 'Pick a valid point budget' };
    s.pointBudget = pointBudget;
  }
  return s;
}

function doStartGame(state: HSState, mapId?: string, pointBudget?: number, mode?: HSMode): HSResult {
  if (state.phase !== 'lobby') return { error: 'The battle has already started' };
  if (state.players.length !== SEATS) return { error: 'HeroScape needs exactly 2 players' };
  // The host picks the battlefield at game start (default: Training Field).
  const chosenMapId = mapId ?? state.mapId ?? DEFAULT_MAP_ID;
  const map = MAPS[chosenMapId];
  if (!map) return { error: `Unknown battlefield "${chosenMapId}"` };
  const chosenMode: HSMode = mode ?? state.mode ?? DEFAULT_MODE;
  const chosenBudget = pointBudget ?? state.pointBudget ?? DEFAULT_POINT_BUDGET;
  if (chosenMode === 'draft' && !POINT_BUDGETS.includes(chosenBudget)) {
    return { error: 'Pick a valid point budget' };
  }

  const s = clone(state);
  s.mapId = chosenMapId;
  s.mode = chosenMode;
  s.pointBudget = chosenBudget;
  s.cards = [];
  s.figures = [];

  if (chosenMode === 'quick') {
    // Quick battle: auto-draft the fixed slice-1 armies and auto-place them,
    // then go straight to playing (preserves the slice-4 fast path exactly).
    for (let idx = 0; idx < SEATS; idx++) {
      const { cards, figures } = buildArmy(s.players[idx].seat, SLICE1_ARMIES[idx]);
      s.cards.push(...cards);
      s.figures.push(...figures);
      const err = autoPlaceQuickArmy(map, s.players[idx].seat, s.cards, s.figures);
      if (err) return { error: err };
    }
    enterPlaying(s, map);
    return s;
  }

  // Draft mode: enter the draft phase. The roll-off d20s are SERVER-rolled —
  // makeMoveHS issues a `draft_roll` in the same request (mirrors initiative),
  // so the draft is set up but awaits the order roll.
  s.phase = 'draft';
  s.subPhase = 'place_markers'; // unused while drafting; kept canonical
  s.glyphs = [];
  s.draft = {
    pool: [...HS_DRAFT_POOL],
    order: [],
    rollOff: [],
    turnSeat: null,
    remainingPicks: 0,
    passed: [],
    armies: { 0: [], 1: [] },
    spent: { 0: 0, 1: 0 },
  };
  delete s.hand;
  delete s.placementReady;
  pushLog(s, 'info', `Army draft on the ${map.name} — budget ${chosenBudget} points. Rolling for draft order…`);
  return s;
}

// ============================================================================
// Draft phase (slice 5) — the verified 2-player procedure
// (docs/heroscape/extraction/resolutions.md). Pure; the server rolls the d20s.
// ============================================================================

/** Cost of a card id (its printed Points). 0 for an unknown id (defensive). */
function cardPoints(cardId: string): number {
  return HS_CARDS[cardId]?.points ?? 0;
}

/** True iff the pool still holds a card the seat can AFFORD (its Points fit the
 *  seat's remaining budget). When false, the seat MUST pass (no legal pick). */
function hasAffordableCard(state: HSState, seat: number): boolean {
  const d = state.draft!;
  const remaining = state.pointBudget - (d.spent[seat] ?? 0);
  return d.pool.some(id => cardPoints(id) <= remaining);
}

/** Set the draft's turn to the next active (un-passed) seat. The 1/2/alternate-1
 *  sequence (resolutions.md): the high roller opens with 1 pick, the OTHER seat
 *  then takes 2 (its first turn only), and every turn thereafter is a single
 *  pick — back-and-forth — until a seat passes. Both passed → draft over (build
 *  figures + placement hand). */
function advanceDraftTurn(s: HSState): void {
  const d = s.draft!;
  // Whoever is NOT the current turn seat, in the fixed [high, other] order.
  const next = d.order.find(seat => seat !== d.turnSeat && !d.passed.includes(seat));
  if (next == null) {
    // The other seat has already passed — the SAME seat keeps single picks until
    // it too passes (or is forced to). Only end when BOTH have passed.
    if (d.turnSeat != null && !d.passed.includes(d.turnSeat)) {
      d.remainingPicks = 1;
      return;
    }
    finishDraft(s);
    return;
  }
  // The DOUBLE pick is the SECOND drafter's (order[1]) very first turn — i.e.
  // when it has drafted nothing yet AND no one has passed (so we're still in the
  // opening 1,2 exchange, not the late single-pick phase after a pass).
  const isSecondDrafterOpener =
    next === d.order[1] && (d.armies[next] ?? []).length === 0 && d.passed.length === 0;
  d.turnSeat = next;
  d.remainingPicks = isSecondDrafterOpener ? DRAFT_OPENER_PICKS : 1;
}

/** When BOTH seats have passed: build each seat's army cards + figures and the
 *  placement `hand`, then enter the placement phase. */
function finishDraft(s: HSState): void {
  const d = s.draft!;
  d.turnSeat = null;
  s.cards = [];
  s.figures = [];
  s.hand = { 0: [], 1: [] };
  for (const seat of [0, 1]) {
    const { cards, figures } = buildArmy(seat, d.armies[seat] ?? []);
    s.cards.push(...cards);
    s.figures.push(...figures);
    s.hand[seat] = figures.map(f => f.id); // all start in hand (unplaced)
  }
  s.placementReady = [];
  s.phase = 'placement';
  pushLog(
    s,
    'info',
    `Draft complete — place your figures in your start zone. ${playerName(s, 0)}: ${d.spent[0]} pts, ${playerName(s, 1)}: ${d.spent[1]} pts.`,
  );
}

function doDraftRoll(state: HSState, attempts: InitiativeAttempt[]): HSResult {
  const d = state.draft;
  if (!d) return { error: 'No draft is in progress' };
  if (d.order.length > 0) return { error: 'The draft order is already set' };
  if (!Array.isArray(attempts) || attempts.length === 0) return { error: 'Missing draft rolls' };
  const seats = state.players.map(p => p.seat);
  // Plain 1-20 d20s (no Dagmar in the draft); every attempt before the last must
  // be a tie for highest (that is why it was re-rolled), the final tie-free.
  for (const attempt of attempts) {
    if (
      !Array.isArray(attempt) ||
      attempt.length !== seats.length ||
      !seats.every(seat => attempt.some(a => a?.seat === seat))
    ) {
      return { error: 'Malformed draft rolls' };
    }
    for (const a of attempt) {
      if (!Number.isInteger(a.roll) || a.roll < 1 || a.roll > 20) return { error: 'Malformed draft rolls' };
    }
  }
  for (let i = 0; i < attempts.length - 1; i++) {
    if (!tiedForHighest(attempts[i])) return { error: 'Draft re-rolled an attempt that was not tied' };
  }
  const last = attempts[attempts.length - 1];
  if (tiedForHighest(last)) return { error: 'Draft order ended in a tie — roll again' };
  const highSeat = last.reduce((best, a) => (a.roll > best.roll ? a : best)).seat;
  const otherSeat = seats.find(x => x !== highSeat)!;

  const s = clone(state);
  const dd = s.draft!;
  dd.rollOff = attempts;
  dd.order = [highSeat, otherSeat];
  // High roller drafts FIRST, picking ONE card; the other then picks TWO; then
  // alternate single picks (resolutions.md). So the opener belongs to the high
  // roller with 1 pick — the DOUBLE pick is the second player's first turn.
  dd.turnSeat = highSeat;
  dd.remainingPicks = 1;
  attempts.forEach((attempt, i) => {
    const parts = attempt.map(a => `${playerName(s, a.seat)} ${a.roll}`).join(' — ');
    const tie = i < attempts.length - 1 ? ' Tie — re-roll!' : '';
    pushLog(s, 'roll', `Draft d20: ${parts}.${tie}`);
  });
  pushLog(s, 'info', `${playerName(s, highSeat)} drafts first.`);
  return s;
}

function doDraftCard(state: HSState, seat: number, cardId: string): HSResult {
  const d = state.draft;
  if (!d || d.turnSeat == null) return { error: 'The draft is not awaiting a pick' };
  if (d.turnSeat !== seat) return { error: 'It is not your pick' };
  if (!d.pool.includes(cardId)) return { error: 'That card is no longer in the pool' };
  const cost = cardPoints(cardId);
  const remaining = state.pointBudget - (d.spent[seat] ?? 0);
  if (cost > remaining) {
    return { error: `${HS_CARDS[cardId].name} costs ${cost} — only ${remaining} points left` };
  }

  const s = clone(state);
  const dd = s.draft!;
  dd.pool = dd.pool.filter(id => id !== cardId);
  dd.armies[seat] = [...(dd.armies[seat] ?? []), cardId];
  dd.spent[seat] = (dd.spent[seat] ?? 0) + cost;
  pushLog(
    s,
    'info',
    `${playerName(s, seat)} drafts ${HS_CARDS[cardId].name} (${cost} pts) — ${dd.spent[seat]}/${s.pointBudget}.`,
  );
  dd.remainingPicks -= 1;
  if (dd.remainingPicks <= 0) {
    advanceDraftTurn(s);
  }
  return s;
}

function doDraftPass(state: HSState, seat: number): HSResult {
  const d = state.draft;
  if (!d || d.turnSeat == null) return { error: 'The draft is not awaiting a pick' };
  if (d.turnSeat !== seat) return { error: 'It is not your pick' };
  // A player must end with ≥1 card: cannot pass an EMPTY army while an
  // affordable card still exists (the very first pick can't be a pass).
  const armyEmpty = (d.armies[seat] ?? []).length === 0;
  if (armyEmpty && hasAffordableCard(state, seat)) {
    return { error: 'You must draft at least one card before passing' };
  }

  const s = clone(state);
  const dd = s.draft!;
  if (!dd.passed.includes(seat)) dd.passed.push(seat);
  const forced = !hasAffordableCard(state, seat);
  pushLog(
    s,
    'info',
    `${playerName(s, seat)} ${forced ? 'must pass — no affordable card remains' : 'passes'}; their army is complete (${dd.spent[seat]} pts).`,
  );
  // Passing permanently completes the army — leave the rotation. Hand the turn
  // to the other seat (single picks) or finish if both have passed.
  if (dd.passed.length >= SEATS) {
    finishDraft(s);
  } else {
    advanceDraftTurn(s);
  }
  return s;
}

// ============================================================================
// Placement phase (slice 5) — arrange your drafted figures in your start zone,
// simultaneous + ready-gated. Both ready → playing, round 1 place_markers.
// ============================================================================

/** Empty start-zone hexes of `seat` a figure may be placed on right now. The
 *  board calls this to highlight legal placement squares (single source of
 *  truth with the engine's validation). */
export function placeableHexes(state: HSState, seat: number): Set<HexKey> {
  const map = MAPS[state.mapId];
  const zone = map?.startZones[seat] ?? [];
  const occupied = new Set(state.figures.filter(f => f.at != null).map(f => f.at!));
  return new Set(zone.filter(k => !occupied.has(k)));
}

function doPlaceFigure(state: HSState, seat: number, figureId: string, to: HexKey): HSResult {
  if ((state.placementReady ?? []).includes(seat)) {
    return { error: 'You have already locked in your placement' };
  }
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.ownerSeat !== seat) return { error: 'That is not your figure' };
  if (fig.at != null) return { error: 'That figure is already on the battlefield' };
  if (!(state.hand?.[seat] ?? []).includes(figureId)) return { error: 'That figure is not in your hand' };
  if (!placeableHexes(state, seat).has(to)) {
    return { error: 'Place onto an empty hex of your own start zone' };
  }
  const s = clone(state);
  s.figures.find(f => f.id === figureId)!.at = to;
  s.hand![seat] = (s.hand![seat] ?? []).filter(id => id !== figureId);
  pushLog(s, 'move', `${playerName(s, seat)} places ${figureLabel(s, fig)} at ${hexLabel(to)}.`);
  return s;
}

function doUnplaceFigure(state: HSState, seat: number, figureId: string): HSResult {
  if ((state.placementReady ?? []).includes(seat)) {
    return { error: 'You have already locked in your placement' };
  }
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.ownerSeat !== seat) return { error: 'That is not your figure' };
  if (fig.at == null) return { error: 'That figure is already in your hand' };
  const s = clone(state);
  s.figures.find(f => f.id === figureId)!.at = null;
  s.hand![seat] = [...(s.hand![seat] ?? []), figureId];
  pushLog(s, 'move', `${playerName(s, seat)} returns ${figureLabel(s, fig)} to hand.`);
  return s;
}

function doPlacementReady(state: HSState, seat: number): HSResult {
  if ((state.placementReady ?? []).includes(seat)) {
    return { error: 'You have already locked in your placement' };
  }
  // Must place at least one figure (an army can't deploy nothing).
  const placed = state.figures.filter(f => f.ownerSeat === seat && f.at != null).length;
  if (placed < 1) return { error: 'Place at least one figure before locking in' };

  const s = clone(state);
  // Figures left in hand are DROPPED (unused) — faithful to "excess figures are
  // unused" (01-components §5). Remove them from the army entirely.
  const leftover = (s.hand?.[seat] ?? []);
  if (leftover.length > 0) {
    const drop = new Set(leftover);
    s.figures = s.figures.filter(f => !drop.has(f.id));
    s.hand![seat] = [];
    pushLog(
      s,
      'info',
      `${playerName(s, seat)} locks in — ${leftover.length} unplaced figure${leftover.length === 1 ? '' : 's'} left unused.`,
    );
  } else {
    pushLog(s, 'info', `${playerName(s, seat)} locks in their placement.`);
  }
  s.placementReady = [...(s.placementReady ?? []), seat];

  // Both ready → into playing. Drop any card that has no living figures left
  // (its whole squad was left unplaced) so it cannot hold an order marker.
  if ((s.placementReady ?? []).length >= SEATS) {
    s.cards = s.cards.filter(c => s.figures.some(f => f.cardUid === c.uid));
    enterPlaying(s, MAPS[s.mapId]);
  }
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
  // The Glyph of Dagmar adds +8 to its controller's initiative (05-glyphs). The
  // SERVER applies it; the engine re-validates the bonus matches Dagmar control
  // (controlled by whoever occupies the glyph right now). Each seat is owed
  // exactly 0 or 8.
  const dagmarBonusFor = (seat: number): number =>
    seatControlsGlyph(state, seat, 'dagmar') ? DAGMAR_INITIATIVE_BONUS : 0;
  for (const attempt of attempts) {
    if (
      !Array.isArray(attempt) ||
      attempt.length !== seats.length ||
      !seats.every(seat => attempt.some(a => a?.seat === seat))
    ) {
      return { error: 'Malformed initiative rolls' };
    }
    for (const a of attempt) {
      const owed = dagmarBonusFor(a.seat);
      if (a.raw != null || a.bonus != null) {
        // Broken-out form: raw d20 1-20, bonus exactly the Dagmar owed, roll the sum.
        if (
          !Number.isInteger(a.raw) || a.raw! < 1 || a.raw! > 20 ||
          a.bonus !== owed ||
          a.roll !== a.raw! + owed
        ) {
          return { error: 'Malformed initiative rolls' };
        }
      } else {
        // Bare form (no Dagmar): roll is a plain 1-20, and no seat may be owed a
        // bonus it didn't carry.
        if (!Number.isInteger(a.roll) || a.roll < 1 || a.roll > 20 || owed !== 0) {
          return { error: 'Malformed initiative rolls' };
        }
      }
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
    const parts = attempt
      .map(a => {
        const dag = a.bonus && a.bonus > 0 ? ` (${a.raw}+${a.bonus} Dagmar)` : '';
        return `${playerName(s, a.seat)} ${a.roll}${dag}`;
      })
      .join(' — ');
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
      s.turnAttacks = [];
      delete s.waterClonedThisTurn;
      delete s.berserkerSpent;
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
  s.turnAttacks = [];
  delete s.waterClonedThisTurn;
  delete s.berserkerSpent;
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

/**
 * Are two LIVING figures ADJACENT for an "adjacent to X" special power (slice
 * 6)? Same geometry as engagement (`areEngaged`) — hex-adjacency with the
 * slice-3 elevation exception (a tall enough cliff between the two breaks
 * adjacency, Example 14) — MINUS the enemy requirement, so it works for friend
 * or foe. Every "adjacent to Grimnak / Deathwalker / an adjacent figure" power
 * (Range Enhancement, Sword of Reckoning, Orc Warrior Enhancement) reuses this
 * single helper, so the rule is consistent and recomputed from positions (never
 * a stored token). `a`/`b` may be the same figure or unplaced → false.
 */
function figuresAdjacent(state: HSState, a: Figure, b: Figure): boolean {
  if (a.id === b.id || a.at == null || b.at == null) return false;
  return areEngaged(
    a.at,
    cardDefFor(state, a).height,
    b.at,
    cardDefFor(state, b).height,
    (k: HexKey) => heightOfKey(state, k),
  );
}

/** Is there a LIVING figure owned by `seat`, on a card of `cardId`, FIGURE-
 *  ADJACENT (slice-6 elevation-exception geometry) to `fig`? The data-driven
 *  basis for "adjacent to a friendly Deathwalker / Grimnak" (recomputed from
 *  positions every time — no token). `fig` itself is excluded. */
function hasFiguresAdjacentLivingCard(
  state: HSState,
  fig: Figure,
  cardId: string,
  seat: number,
): boolean {
  if (fig.at == null) return false;
  return state.figures.some(
    o =>
      o.id !== fig.id &&
      o.at != null &&
      o.ownerSeat === seat &&
      cardDefFor(state, o).id === cardId &&
      figuresAdjacent(state, fig, o),
  );
}

// ============================================================================
// Adjacency + glyph control (slice 4)
// ============================================================================

/**
 * Plain hex-adjacency between two living figures (distance 1) — the basis for
 * the aura conditions (Finn/Thorgrim auras attach to "friendly figures adjacent
 * to" the champion). Auras use simple hex-adjacency, NOT the elevation-broken
 * engagement adjacency: the printed text says only "adjacent" with no Example-14
 * caveat, so we keep it as hex-adjacency (documented interpretation; the maps in
 * play rarely stack an aura source on a tall enough ledge for it to matter).
 */
/**
 * Does Raelin's EXTENDED DEFENSIVE AURA reach `defender` (slice 6, cards.md):
 * "All figures YOU CONTROL within 6 clear sight spaces of Raelin add 1 to their
 * defense dice. … does not affect Raelin."
 *   • a LIVING Raelin owned by the DEFENDER's seat must exist (figures you
 *     control = same owner — NOT all friendly-player figures),
 *   • the defender is NOT that Raelin herself (explicit self-exclusion),
 *   • the defender is within 6 RANGE-spaces of Raelin (counted around gaps,
 *     elevation-free — the rulebook's clear-sight-spaces measurement), AND
 *   • Raelin has a clear, elevation-aware LINE OF SIGHT to the defender.
 * Recomputed from positions on every call (no token); stacks additively with
 * Thorgrim/Gerda/height in the breakdown. Any LIVING Raelin reaching the
 * defender qualifies (only one Raelin per army — she is a Unique Hero).
 */
function raelinAuraReaches(state: HSState, defender: Figure): boolean {
  if (defender.at == null) return false;
  const map = MAPS[state.mapId];
  if (!map) return false;
  return state.figures.some(raelin => {
    if (raelin.at == null) return false;
    if (raelin.ownerSeat !== defender.ownerSeat) return false; // figures YOU control
    if (raelin.id === defender.id) return false; // does not affect Raelin herself
    if (cardDefFor(state, raelin).id !== RAELIN_CARD_ID) return false;
    // Within 6 range-spaces (around gaps, elevation-free). Both `at`s are guarded
    // non-null above (the `!` is just for the closure, which widens the param).
    const dist = rangeDistance(map.cells, raelin.at!, defender.at!);
    if (dist == null || dist > RAELIN_AURA_RANGE) return false;
    // Clear sight: an elevation-aware LOS from Raelin to the defender, with
    // intervening figures (neither endpoint) blocking exactly as in combat LOS.
    const occupied: HexKey[] = [];
    for (const f of state.figures) {
      if (f.at != null && f.id !== raelin.id && f.id !== defender.id) occupied.push(f.at);
    }
    return hasLineOfSight3D(map.cells, raelin.at!, defender.at!, occupied, (k: HexKey) =>
      eyeHeightOfKey(state, k),
    );
  });
}

/** The glyph sitting on `key`, if any (slice-4 glyphs are unique per hex). The
 *  `?? []` tolerates a pre-slice-4 state with no glyphs array. */
function glyphAt(state: HSState, key: HexKey | null): HSGlyph | undefined {
  if (key == null) return undefined;
  return (state.glyphs ?? []).find(g => g.at === key);
}

/** Set of hexes that currently carry a glyph (for the movement forced-stop). */
function glyphHexSet(state: HSState): Set<HexKey> {
  return new Set((state.glyphs ?? []).map(g => g.at));
}

/**
 * Does `seat` CONTROL the (active, power-side-up) glyph `glyphId`? — i.e. one of
 * that seat's LIVING figures stands on a glyph of that id (05-glyphs §1
 * "permanent-glyph control follows occupancy"). A deferred/inert glyph
 * (`active:false`) is never "controlled" for effect purposes. Permanent-glyph
 * bonuses are army-wide auras, so the engine asks this once per seat and applies
 * the bonus to every figure that seat controls.
 */
function seatControlsGlyph(state: HSState, seat: number, glyphId: HSGlyphId): boolean {
  if (!HS_GLYPHS[glyphId]?.active) return false;
  return (state.glyphs ?? []).some(
    g =>
      g.id === glyphId &&
      g.faceUp &&
      state.figures.some(f => f.at === g.at && f.ownerSeat === seat),
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
  if (state.turnAttacks.length > 0) {
    return { error: 'Movement is over once attacking begins' };
  }
  // Water Clone is the card's attack-step action — once used, the turn's
  // movement is likewise over (slice 4).
  if (state.waterClonedThisTurn) {
    return { error: 'Movement is over — the Marro Warriors Water Cloned this turn' };
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
  // Effective Move folds in the Glyph of Valda (single source of truth — the
  // board preview reads the same helper).
  const move = effectiveMove(state, fig).dice;
  // slice 4: glyphs are a FORCED STOP (valid endpoint, never transited), and
  // Kelda admits only a WOUNDED figure as an endpoint (an unwounded figure may
  // not stop — and therefore may not enter — its space).
  const glyphHexes = glyphHexSet(state);
  const canEndOn = (key: HexKey): boolean => {
    const g = glyphAt(state, key);
    if (g && g.id === 'kelda' && g.faceUp && fig.wounds < 1) return false;
    return true;
  };
  // slice 7: thread the moving figure's FLYING / GHOST WALK flags into the
  // single-source reachability helper so the board highlight and the engine
  // validation read the same legal set. A flyer ignores elevation/water and
  // passes any figure; Ghost Walk only adds pass-through-enemies (cards.md).
  return reachableDestinations(map.cells, fig.at, move, occupancyLookup(state, fig), def.height, {
    glyphHexes,
    canEndOn,
    flyer: !!def.flying,
    ghostWalk: !!def.ghostWalk,
  });
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
 * slice 7 (cards.md):
 *   • FLYING — a flyer takes NO fall (it descends, it does not fall). Its
 *     takeoff leaving-engagement is UNCHANGED: the start-vs-end abandoned-enemy
 *     computation already models "if engaged when it starts, it takes the
 *     swipes", so a flyer that takes off while engaged still draws them.
 *   • DISENGAGE — the mover is NEVER swiped when leaving an engagement
 *     (`abandonedEnemyIds = []`), unconditionally.
 * Both are data-driven flags on the mover's card; everything else (a Grapple Gun
 * step, a normal move) flows through the same start-vs-end geometry.
 */
export function moveConsequences(
  state: HSState,
  fig: Figure,
  to: HexKey,
): { tier: FallTier; fallDice: number; abandonedEnemyIds: string[] } {
  const from = fig.at;
  const map = MAPS[state.mapId];
  const def = cardDefFor(state, fig);
  const cardHeight = def.height;

  // Fall: drop = height(from) − height(to); none if landing on water. A FLYER
  // descends rather than falling, so it never takes fall damage (cards.md).
  let tier: FallTier = 'none';
  let fallDice = 0;
  if (!def.flying) {
    const drop = from != null ? heightOfKey(state, from) - heightOfKey(state, to) : 0;
    const intoWater = map?.cells[to]?.terrain === 'water';
    const fall = computeFall(Math.max(0, drop), cardHeight, intoWater);
    tier = fall.tier;
    fallDice = fall.dice;
  }

  // Leaving engagement: enemies engaged at move START that the DESTINATION is
  // no longer adjacent-engaged to. Build a hypothetical "fig stands on `to`"
  // figure for the end-adjacency test. DISENGAGE (Agent Carr) suppresses this
  // entirely — he is never swiped when leaving an engagement (cards.md).
  let abandonedEnemyIds: string[] = [];
  if (!def.disengage) {
    const startEngaged = enemiesEngagedWith(state, fig);
    const figAtDest: Figure = { ...fig, at: to };
    abandonedEnemyIds = startEngaged
      .filter(enemy => !engagedPair(state, figAtDest, enemy))
      .map(enemy => enemy.id);
  }

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
  // Reachability passed → resolve the move (dice validation + execution) through
  // the shared path Grapple Gun also uses. "moves to" is the normal-move log.
  return applyValidatedMove(state, figureId, to, { fallRoll, extremeFallD20, leaveRolls }, 'moves to');
}

/**
 * Shared move EXECUTION (slice 7 refactor): given a destination already proven
 * legal by the caller (doMove via reachableDestinations; doGrappleMove via its
 * own one-space/climb-waiver check), recompute the move's required dice from
 * `moveConsequences`, validate the supplied server rolls against that need, then
 * apply the move — leaving-engagement swipes, then fall, then glyph-on-stop,
 * then the elimination/Spirit checks. This is the single seam where falls and
 * swipes resolve, so a normal move and a Grapple Gun step are identical once the
 * destination is authorized (cards.md: "all engagement rules still apply"). The
 * engine is the source of truth for the dice need — a missing-but-required or
 * unneeded roll is rejected. `verb` colours the move log ("moves to" /
 * "grapples to").
 */
function applyValidatedMove(
  state: HSState,
  figureId: string,
  to: HexKey,
  rolls: {
    fallRoll?: CombatFace[];
    extremeFallD20?: number;
    leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
  },
  verb: string,
): HSResult {
  const mover = state.figures.find(f => f.id === figureId)!;
  const { fallRoll, extremeFallD20, leaveRolls } = rolls;
  const { tier, fallDice, abandonedEnemyIds } = moveConsequences(state, mover, to);

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
  pushLog(s, 'move', `${moverLabel} ${verb} ${hexLabel(to)}.`);

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

  // --- glyph effect on stopping (slice 4): the forced stop already routed the
  // figure to END here. A TEMPORARY glyph (Kelda) fires once and is removed; a
  // PERMANENT glyph just becomes active by occupancy (handled live in the
  // effective-stat helpers, nothing to do on entry). Only fires if the mover
  // survived the swipes/fall and actually occupies the glyph hex. ---
  if (fig.at != null && fig.at === to) {
    applyGlyphOnStop(s, fig);
  }

  // A mid-move destruction can win the game (last enemy of a seat removed).
  // Resolve elimination FIRST so a champion death that ends the game skips its
  // Spirit (finish takes precedence). A swipe/fall can destroy the MOVER, who
  // may be Finn/Thorgrim — queue its Spirit if the game is still live.
  checkEliminationWin(s);
  if (fig.at == null && fig.wounds >= cardDefFor(s, fig).life) {
    maybeQueueSpiritOnDestroy(s, fig);
  }
  return s;
}

/**
 * The hexes Drake's GRAPPLE GUN can reach (slice 7, cards.md): exactly ONE
 * adjacent space, EMPTY (friend or enemy blocks the endpoint), whose height is
 * up to `grappleGun` levels HIGHER than Drake's current cell — the climb limit
 * is WAIVED up to that cap, so he can scale a cliff he normally couldn't.
 * Descending or level steps are always allowed (the cap only bounds the RISE).
 * Pure; the board's Grapple-Gun toggle and the engine validation read the same
 * set (single source). Empty when the figure has no grappleGun, can't move, or
 * has already moved this turn.
 */
export function grappleDestinations(state: HSState, figureId: string): Set<HexKey> {
  const out = new Set<HexKey>();
  const r = movableFigure(state, figureId);
  if ('error' in r) return out;
  const fig = r.fig;
  const def = cardDefFor(state, fig);
  if (!def.grappleGun || fig.at == null) return out;
  const map = MAPS[state.mapId];
  if (!map) return out;
  const cap = def.grappleGun;
  const fromH = heightOfKey(state, fig.at);
  const occ = occupancyLookup(state, fig);
  for (const n of neighborKeys(fig.at)) {
    if (!map.cells[n]) continue; // void / off-map
    if (occ(n) !== null) continue; // can't END on an occupied hex (friend or foe)
    const rise = heightOfKey(state, n) - fromH;
    if (rise > cap) continue; // climb waiver only up to the Grapple Gun cap
    out.add(n);
  }
  return out;
}

/**
 * Sgt. Drake GRAPPLE GUN 25 (slice 7, cards.md): "Instead of Sgt. Drake's
 * normal move, he may move only ONE space. This space may be up to 25 levels
 * higher. … all engagement rules still apply." Data-driven on `def.grappleGun`
 * (the level cap). It REPLACES his normal move: `movableFigure` rejects a figure
 * that has already moved, and this push to `movedFigureIds` blocks a subsequent
 * normal move — mutual exclusion. Engagement/leaving-engagement/fall all flow
 * through the SAME `applyValidatedMove` path as a normal move (Drake is not a
 * flyer, so a downward step can still fall). The SERVER rolls the swipe dice.
 */
function doGrappleMove(
  state: HSState,
  figureId: string,
  to: HexKey,
  fallRoll?: CombatFace[],
  extremeFallD20?: number,
  leaveRolls?: { enemyFigureId: string; roll: CombatFace }[],
): HSResult {
  const r = movableFigure(state, figureId);
  if ('error' in r) return r;
  if (!cardDefFor(state, r.fig).grappleGun) {
    return { error: 'Only Sgt. Drake Alexander may use the Grapple Gun' };
  }
  const map = MAPS[state.mapId];
  if (!map.cells[to]) return { error: 'There is no hex there' };
  // One space, empty, rise within the Grapple Gun cap — the single-source set.
  if (!grappleDestinations(state, figureId).has(to)) {
    return { error: 'Grapple Gun: step exactly one space, up to its climb cap, onto an empty hex' };
  }
  // Resolve via the shared move path (engagement rules still apply). "grapples
  // to" colours the log so the Grapple Gun is visible.
  return applyValidatedMove(state, figureId, to, { fallRoll, extremeFallD20, leaveRolls }, 'grapples to');
}

/**
 * Resolve a glyph's effect when `fig` STOPS on it (slice 4). Permanent glyphs
 * are passive (their bonus lives in the effective-stat helpers); only the
 * temporary HEALER (Kelda) acts here: remove ALL wound markers from the figure,
 * then remove the glyph from the game (05-glyphs §2). The wounded-only entry
 * restriction is already enforced upstream (movementDestinations), so a figure
 * that reached Kelda is guaranteed to have ≥1 wound. Deferred temporary glyphs
 * (Erland/Mitonsoul) are inert — logged but the glyph stays (so the framework
 * is visible) per the slice-4 "treat as inert, still a forced stop" rule.
 */
function applyGlyphOnStop(s: HSState, fig: Figure): void {
  const g = glyphAt(s, fig.at);
  if (!g || !g.faceUp) return;
  const def = HS_GLYPHS[g.id];
  if (g.id === 'kelda') {
    const healed = fig.wounds;
    fig.wounds = 0;
    s.glyphs = s.glyphs.filter(x => x.at !== g.at);
    pushLog(
      s,
      'glyph',
      `${figureLabel(s, fig)} stops on the Glyph of Kelda — healed of ${healed} wound${healed === 1 ? '' : 's'}; the glyph fades.`,
    );
    return;
  }
  if (def.kind === 'permanent' && def.active) {
    pushLog(s, 'glyph', `${figureLabel(s, fig)} claims the ${def.name} — ${def.effect}`);
    return;
  }
  // Deferred / inert glyph (Erland, Mitonsoul, Brandar): a forced stop with no
  // effect yet (slice 5 / scenario). Log it so the framework is visible.
  pushLog(s, 'glyph', `${figureLabel(s, fig)} stops on the ${def.name} — no effect yet.`);
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

/**
 * How many times a figure of `card` may attack in one turn (slice 6). Normally
 * 1; Syvarris's DOUBLE ATTACK ("When Syvarris attacks, he may attack one
 * additional time", cards.md) makes it 2. The second attack is OPTIONAL — this
 * is a per-figure budget, not a forced second roll, so the player may simply
 * stop after one. Data-driven on card id (only Syvarris in this roster).
 */
function maxAttacks(card: HSCardDef): number {
  return card.id === SYVARRIS_CARD_ID ? 2 : 1;
}

/** How many times `figureId` has already attacked this turn — counted from the
 *  single-source `turnAttacks` log (replaces the old boolean membership test). */
function attacksThisTurn(state: HSState, figureId: string): number {
  return state.turnAttacks.filter(a => a.attackerId === figureId).length;
}

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
  // Water Clone is "instead of attacking" — once the active card has cloned this
  // turn its attack is spent (slice 4, cards.md). Treat as already-attacked.
  if (state.waterClonedThisTurn) {
    return { error: 'That figure has already attacked this turn (Water Clone was used instead)' };
  }
  // Per-figure attack budget (slice 6): a figure may attack while its count this
  // turn is below maxAttacks (1 for a normal figure, 2 for Syvarris's Double
  // Attack). Replaces the old boolean "has this figure attacked" gate.
  if (attacksThisTurn(state, attackerId) >= maxAttacks(cardDefFor(state, fig))) {
    return { error: 'That figure has already attacked this turn' };
  }
  return { fig };
}

/** Why `target` can't be attacked by `attacker` (null = legal target).
 *  Gates per the rules: an ENGAGED figure may attack only the enemies it is
 *  engaged with (04-combat §Who may attack, p. 13); THORIAN SPEED restricts
 *  normal attacks on Drake to adjacent attackers (slice 7); the target must be
 *  within Range (spaces, elevation-free); and there must be a clear,
 *  elevation-aware Line of Sight. `isNormalAttack` is true for every slice-7
 *  attack (no special attacks yet) — threaded for the slice-8 Thorian Speed
 *  carve-out ("special attacks are not restricted"). */
function targetBlockReason(
  state: HSState,
  attacker: Figure,
  target: Figure,
  isNormalAttack = true,
): string | null {
  if (target.at == null) return 'No such target on the battlefield';
  if (target.ownerSeat === attacker.ownerSeat) return 'You cannot attack your own figures';
  const map = MAPS[state.mapId];

  // Engaged figures can't shoot past their engagement: if the attacker is
  // engaged with any enemy, it may attack ONLY an enemy it is engaged with.
  const engaged = enemiesEngagedWith(state, attacker);
  if (engaged.length > 0 && !engaged.some(e => e.id === target.id)) {
    return 'Engaged — you may only attack a figure you are engaged with';
  }

  // THORIAN SPEED (Sgt. Drake, slice 7, cards.md): "Opponents' figures must be
  // adjacent to Sgt. Drake to attack him with a normal attack." So a NORMAL
  // attack on Drake from a NON-adjacent attacker is blocked (he can't be shot at
  // range). Special attacks are unrestricted (isNormalAttack === false skips
  // this). Data-driven on the target's `thorianSpeed` flag.
  if (
    isNormalAttack &&
    cardDefFor(state, target).thorianSpeed &&
    !figuresAdjacent(state, attacker, target)
  ) {
    return 'Thorian Speed — must be adjacent to attack Sgt. Drake';
  }

  const range = effectiveRange(state, attacker).dice;
  const dist = rangeDistance(map.cells, attacker.at!, target.at);
  if (dist == null || dist > range) return `Out of range (Range ${range})`;
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

// ============================================================================
// SINGLE-SOURCE effective-stat helpers (slice 4)
//
// Auras, glyphs, height advantage, and Spirit mods all stack ADDITIVELY and are
// BOTH displayed and enforced — so each effective stat is computed in EXACTLY
// ONE helper that the engine resolution AND the board preview call (rules-
// fidelity §math). A displayed die count can therefore never disagree with an
// enforced one. Each returns the value plus a human-readable `breakdown`.
//
// `isNormalAttack` is true for the slice-4 cards (none have a special attack
// yet); the parameter is threaded through so Finn's Attack Aura — NORMAL attacks
// only — and the special-attack unmodifiable rule slot in for slice 5.
// ============================================================================

export type EffectiveStat = { dice: number; breakdown: string[] };

/**
 * Effective ATTACK dice for `attacker` striking `target` (cards.md / 05-glyphs):
 *   printed Attack
 *   + card.attackMod        (Warrior's Attack Spirit — permanent +1 per Spirit)
 *   + height advantage      (heightAdvantage, attacker side)
 *   + Finn's ATTACK AURA 1  (+1 IFF NORMAL attack AND attacker printed Range 1
 *                            AND a living friendly Finn is adjacent — Finn does
 *                            not buff himself, no Finn buffs his own card)
 *   + Agent Carr SWORD OF RECKONING 4 (slice 6) — +4 IFF NORMAL attack AND the
 *                            attacker is Agent Carr AND the target is adjacent
 *   + Grimnak ORC WARRIOR ENHANCEMENT (slice 6) — +1 IFF the attacker is an Orc
 *                            Warrior (species Orc + class Warriors) adjacent to a
 *                            living friendly Grimnak
 *   + Zettian Guards ZETTIAN TARGETING (slice 6) — +1 IFF the attacker is a
 *                            Zettian Guard AND an earlier Zettian Guard of the
 *                            same card already attacked THIS target this turn
 *   + Glyph of Astrid       (+1 if the attacker's seat controls Astrid)
 * Every slice-6 bonus is folded in HERE (the single source); the board preview
 * and engine resolution both read this, so a shown count can never disagree.
 */
export function effectiveAttackDice(
  state: HSState,
  attacker: Figure,
  target: Figure,
  isNormalAttack = true,
): EffectiveStat {
  const def = cardDefFor(state, attacker);
  const mod = cardModFor(state, attacker).attackMod;
  const breakdown: string[] = [`Attack ${def.attack} printed`];
  let dice = def.attack;
  if (mod !== 0) {
    dice += mod;
    breakdown.push(`${mod > 0 ? '+' : ''}${mod} Attack Spirit`);
  }
  const h = heightAdvantage(state, attacker, target);
  if (h.attacker > 0) {
    dice += h.attacker;
    breakdown.push(`+${h.attacker} height`);
  }
  // Finn's Attack Aura: NORMAL attacks only, attacker printed Range 1, adjacent
  // to a living friendly Finn (recomputed from positions — no token).
  if (
    isNormalAttack &&
    def.range === 1 &&
    hasFiguresAdjacentLivingCard(state, attacker, FINN_CARD_ID, attacker.ownerSeat)
  ) {
    dice += 1;
    breakdown.push('+1 Finn aura');
  }
  // Agent Carr's SWORD OF RECKONING 4 (slice 6, cards.md): "If Agent Carr is
  // attacking an adjacent figure, add 4 dice to Agent Carr's attack." NORMAL
  // attacks only (special attacks are unmodifiable; Carr has none here).
  if (def.id === AGENT_CARR_CARD_ID && isNormalAttack && figuresAdjacent(state, attacker, target)) {
    dice += SWORD_OF_RECKONING_BONUS;
    breakdown.push(`+${SWORD_OF_RECKONING_BONUS} Sword of Reckoning`);
  }
  // Grimnak's ORC WARRIOR ENHANCEMENT (slice 6, cards.md): "All friendly Orc
  // Warriors adjacent to Grimnak roll an additional attack die …" Data-driven on
  // species Orc + class Warriors, same owner, adjacent to a living Grimnak. No
  // Orc Warriors exist in the 16-card roster, so this never fires in practice —
  // proven by a synthetic Orc Warrior in the tests.
  if (
    def.species === SPECIES_ORC &&
    def.unitClass === CLASS_WARRIORS &&
    hasFiguresAdjacentLivingCard(state, attacker, GRIMNAK_CARD_ID, attacker.ownerSeat)
  ) {
    dice += 1;
    breakdown.push('+1 Grimnak aura');
  }
  // Zettian Guards' ZETTIAN TARGETING (slice 6, cards.md): "When attacking, if
  // your second Zettian Guard attacks the same figure as the first Zettian Guard,
  // add one attack die to the second Zettian Guard's attack." The FIRST Guard's
  // attack against this target must already be logged in turnAttacks this turn
  // (so the second Guard — and only the second — gets +1). The preview reads the
  // same turnAttacks, keeping the single source intact. Imperative "add" — not
  // optional.
  if (def.id === ZETTIAN_CARD_ID && zettianTargetingApplies(state, attacker, target)) {
    dice += 1;
    breakdown.push('+1 Zettian Targeting');
  }
  if (seatControlsGlyph(state, attacker.ownerSeat, 'astrid')) {
    dice += 1;
    breakdown.push('+1 Astrid');
  }
  return { dice, breakdown };
}

/**
 * Does ZETTIAN TARGETING grant `attacker` (a Zettian Guard) +1 vs `target`?
 * True iff some EARLIER attack this turn (in `turnAttacks`) was made by a
 * DIFFERENT Zettian Guard of the SAME card against the SAME target. So the
 * FIRST Guard to hit a target never gets it (no prior entry), and a second Guard
 * hitting a DIFFERENT target gets nothing. Reads only the per-turn attack log —
 * the single source the preview shares.
 */
function zettianTargetingApplies(state: HSState, attacker: Figure, target: Figure): boolean {
  if (cardDefFor(state, attacker).id !== ZETTIAN_CARD_ID) return false;
  return state.turnAttacks.some(a => {
    if (a.targetId !== target.id) return false;
    if (a.attackerId === attacker.id) return false; // must be the OTHER Guard
    const prior = state.figures.find(f => f.id === a.attackerId);
    // The earlier attacker must be a Zettian Guard of the same card AND owner
    // (your second Guard vs your first Guard — same squad).
    return (
      prior != null &&
      prior.cardUid === attacker.cardUid &&
      cardDefFor(state, prior).id === ZETTIAN_CARD_ID
    );
  });
}

/**
 * Effective DEFENSE dice for `defender` against `attacker` (cards.md/05-glyphs):
 *   printed Defense
 *   + card.defenseMod         (Warrior's Armor Spirit — permanent +1 per Spirit)
 *   + height advantage        (heightAdvantage, defender side)
 *   + Thorgrim's DEFENSIVE AURA 1 (+1 to ANY adjacent friendly — no Range
 *                              restriction, unlike Finn's; Thorgrim does not
 *                              buff himself)
 *   + Raelin EXTENDED DEFENSIVE AURA (slice 6) — +1 to every figure the same
 *                              player controls within 6 clear-sight spaces of a
 *                              living Raelin, excluding Raelin herself
 *   + Grimnak ORC WARRIOR ENHANCEMENT (slice 6) — +1 to a friendly Orc Warrior
 *                              adjacent to a living Grimnak (the defense half)
 *   + Glyph of Gerda          (+1 if the defender's seat controls Gerda)
 * (Defense dice are NEVER stripped for a special attack — only the attacker's
 *  roll is unmodifiable, 05-glyphs §5 note.)
 */
export function effectiveDefenseDice(
  state: HSState,
  defender: Figure,
  attacker: Figure,
): EffectiveStat {
  const def = cardDefFor(state, defender);
  const mod = cardModFor(state, defender).defenseMod;
  const breakdown: string[] = [`Defense ${def.defense} printed`];
  let dice = def.defense;
  if (mod !== 0) {
    dice += mod;
    breakdown.push(`${mod > 0 ? '+' : ''}${mod} Armor Spirit`);
  }
  const h = heightAdvantage(state, attacker, defender);
  if (h.defender > 0) {
    dice += h.defender;
    breakdown.push(`+${h.defender} height`);
  }
  if (hasFiguresAdjacentLivingCard(state, defender, THORGRIM_CARD_ID, defender.ownerSeat)) {
    dice += 1;
    breakdown.push('+1 Thorgrim aura');
  }
  // Raelin's EXTENDED DEFENSIVE AURA (slice 6): +1 defense die to every figure
  // the same player controls within 6 clear-sight spaces of a living Raelin
  // (Raelin herself excluded — handled in raelinAuraReaches). Recomputed from
  // positions; stacks with Thorgrim / Gerda / height.
  if (raelinAuraReaches(state, defender)) {
    dice += 1;
    breakdown.push('+1 Raelin aura');
  }
  // Grimnak's ORC WARRIOR ENHANCEMENT — the defense half: "… and an additional
  // defense die." Same gate as the attack half (Orc Warrior adjacent to a living
  // friendly Grimnak). Inert in this roster (no Orc Warriors) but proven by a
  // synthetic Orc Warrior test.
  if (
    def.species === SPECIES_ORC &&
    def.unitClass === CLASS_WARRIORS &&
    hasFiguresAdjacentLivingCard(state, defender, GRIMNAK_CARD_ID, defender.ownerSeat)
  ) {
    dice += 1;
    breakdown.push('+1 Grimnak aura');
  }
  if (seatControlsGlyph(state, defender.ownerSeat, 'gerda')) {
    dice += 1;
    breakdown.push('+1 Gerda');
  }
  return { dice, breakdown };
}

/**
 * Effective MOVE for `fig` (05-glyphs): printed Move + Glyph of Valda (+2 if the
 * figure's seat controls Valda). VALDA EXIT CAVEAT (resolutions): "Do not use
 * this power when moving off of the Glyph." Faithful model: the OCCUPANT of
 * Valda does not get +2 on the move that leaves it (it moves with its unboosted
 * Move), while every OTHER friendly figure keeps +2. `movingOffValda` flags the
 * occupant's own move so we drop the bonus for it.
 */
export function effectiveMove(state: HSState, fig: Figure): EffectiveStat {
  const def = cardDefFor(state, fig);
  const breakdown: string[] = [`Move ${def.move} printed`];
  let move = def.move;
  if (seatControlsGlyph(state, fig.ownerSeat, 'valda')) {
    // The occupant of Valda gets no boost on the move that leaves it.
    const onValda = (state.glyphs ?? []).some(g => g.id === 'valda' && g.at === fig.at);
    if (!onValda) {
      move += 2;
      breakdown.push('+2 Valda');
    } else {
      breakdown.push('(no Valda bonus moving off the glyph)');
    }
  }
  return { dice: move, breakdown };
}

/**
 * Effective RANGE for `fig` (05-glyphs / cards.md):
 *   printed Range
 *   + Glyph of Ivor          (+4 ONLY if printed Range ≥ 4 AND seat controls Ivor)
 *   + Deathwalker 9000 RANGE ENHANCEMENT (slice 6) — +2 if the figure is a
 *                            Soulborg Guard (species Soulborg + class Guards)
 *                            adjacent to a living friendly Deathwalker 9000.
 *                            Zettian Guards qualify: Range 7 → 9 while adjacent.
 * Folds into the range used by `targetBlockReason` and the board preview (single
 * source), so the larger reach is both shown and enforced.
 */
export function effectiveRange(state: HSState, fig: Figure): EffectiveStat {
  const def = cardDefFor(state, fig);
  const breakdown: string[] = [`Range ${def.range} printed`];
  let range = def.range;
  if (def.range >= 4 && seatControlsGlyph(state, fig.ownerSeat, 'ivor')) {
    range += 4;
    breakdown.push('+4 Ivor');
  }
  // Deathwalker 9000's RANGE ENHANCEMENT (cards.md): "Any Soulborg Guards
  // adjacent to Deathwalker add 2 spaces to their range." Data-driven on species
  // Soulborg + class Guards, adjacent to a living friendly Deathwalker.
  if (
    def.species === SPECIES_SOULBORG &&
    def.unitClass === CLASS_GUARDS &&
    hasFiguresAdjacentLivingCard(state, fig, DEATHWALKER_CARD_ID, fig.ownerSeat)
  ) {
    range += RANGE_ENHANCEMENT_BONUS;
    breakdown.push(`+${RANGE_ENHANCEMENT_BONUS} Range Enhancement`);
  }
  return { dice: range, breakdown };
}

/**
 * Dice the server must roll for an attack: the effective Attack/Defense numbers
 * (printed + Spirit + height + auras + glyphs) from the SINGLE source of truth —
 * board preview and engine resolution both read this, so a displayed count can
 * never disagree with an enforced one. `heightBonusAttacker`/`heightBonusDefender`
 * and the two `breakdown` arrays feed the dice-panel caption. Null when either
 * figure id is unknown — the engine then rejects with a real error message.
 */
export function attackDiceRequirements(
  state: HSState,
  attackerId: string,
  targetId: string,
): {
  attack: number;
  defense: number;
  heightBonusAttacker: number;
  heightBonusDefender: number;
  attackBreakdown: string[];
  defenseBreakdown: string[];
} | null {
  const attacker = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!attacker || !target) return null;
  const bonus = heightAdvantage(state, attacker, target);
  const atk = effectiveAttackDice(state, attacker, target, true);
  const def = effectiveDefenseDice(state, target, attacker);
  return {
    attack: atk.dice,
    defense: def.dice,
    heightBonusAttacker: bonus.attacker,
    heightBonusDefender: bonus.defender,
    attackBreakdown: atk.breakdown,
    defenseBreakdown: def.breakdown,
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
  //
  // slice 7 (cards.md), DAMAGE-step defensive powers — both hinge on whether the
  // ATTACKER is adjacent, so they are mutually exclusive:
  const adjacent = figuresAdjacent(state, attacker, target);
  const attackerDef = cardDefFor(state, attacker);
  // STEALTH DODGE (Krav Maga Agents): "When a Krav Maga Agent rolls defense dice
  // against an attacking figure who is NOT adjacent, one shield will block all
  // damage." Only vs a NON-adjacent attacker, and only with ≥1 shield rolled →
  // ALL damage is negated. An adjacent attacker resolves normally.
  const stealthDodge = !!tDef.stealthDodge && !adjacent && shields >= 1;
  const wounds = stealthDodge ? 0 : Math.max(0, skulls - shields);
  // COUNTER STRIKE (Izumi Samurai): "When rolling defense dice against a NORMAL
  // attack from an ADJACENT attacking figure, all excess shields count as
  // unblockable hits on the attacking figure. Does not work against other
  // Samurai." Excess = shields − skulls (only when shields > skulls). Never vs
  // another counter-striking Samurai. The defender still takes its normal
  // wounds (which is 0 here, since shields > skulls). isNormalAttack is true for
  // every slice-7 attack.
  const counterWounds =
    tDef.counterStrike && adjacent && !attackerDef.counterStrike && shields > skulls
      ? shields - skulls
      : 0;

  const s = clone(state);
  // Record the attack in the per-turn log (slice-6 single source). Pushed AFTER
  // `req` was computed from the pre-attack state, so a figure never sees its own
  // current attack when folding Zettian Targeting / the attack budget — and the
  // NEXT attack (e.g. the second Zettian Guard, or Syvarris's second shot) reads
  // this entry. Movement-over and "already attacked" both derive from this list.
  s.turnAttacks.push({ attackerId: attacker.id, targetId: target.id });
  const targetMut = s.figures.find(f => f.id === target.id)!;
  targetMut.wounds += wounds;
  const destroyed = targetMut.wounds >= tDef.life;
  if (destroyed) targetMut.at = null;

  // COUNTER STRIKE reflect (slice 7): the excess shields land on the ATTACKER as
  // unblockable wounds. Apply BEFORE the dice panel / elimination so a reflected
  // kill is reflected in lastAttack and can end the game. (Mutually exclusive
  // with Stealth Dodge — both gate on attacker adjacency.)
  const attackerMut = s.figures.find(f => f.id === attacker.id)!;
  let counterDestroyed = false;
  if (counterWounds > 0 && attackerMut.at != null) {
    attackerMut.wounds += counterWounds;
    counterDestroyed = attackerMut.wounds >= attackerDef.life;
    if (counterDestroyed) attackerMut.at = null;
  }

  const attackerLabel = figureLabel(s, attacker);
  const targetLabel = figureLabel(s, targetMut);
  // Build the dice-panel breakdown: the attack reasons followed by the defense
  // reasons (printed base + every modifier), for the caption.
  const breakdown = buildAttackBreakdown(req);
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
    counterWounds: counterWounds > 0 ? counterWounds : undefined,
    heightBonusAttacker: req.heightBonusAttacker,
    heightBonusDefender: req.heightBonusDefender,
    breakdown,
    seq: s.logSeq + 1,
  };
  const outcome = stealthDodge
    ? 'all damage blocked (Stealth Dodge).'
    : destroyed
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
  // Counter Strike log (slice 7): the reflected hits onto the attacker.
  if (counterWounds > 0) {
    pushLog(
      s,
      'power',
      `Counter Strike — ${targetLabel} reflects ${counterWounds} unblockable wound${counterWounds === 1 ? '' : 's'} onto ${attackerLabel}${counterDestroyed ? `, ${attackerLabel} is destroyed!` : '.'}`,
    );
  }

  // Elimination win: the last player with figures remaining wins. Resolve this
  // FIRST — if the destruction (target OR a Counter Strike kill of the attacker)
  // ends the game, the on-destroy Spirit is skipped entirely ("finish takes
  // precedence", slice-4 spec §Server).
  checkEliminationWin(s);
  // On-destroy Spirits: the TARGET (Finn/Thorgrim) if it died, and the ATTACKER
  // if Counter Strike just destroyed it (a reflected kill can also be a champion,
  // and could even end the game — handled by the finish-gate inside the helper).
  if (destroyed) maybeQueueSpiritOnDestroy(s, targetMut);
  if (counterDestroyed) maybeQueueSpiritOnDestroy(s, attackerMut);
  return s;
}

/** Compact dice-panel breakdown from a requirements result: only the non-base
 *  contribution lines (skip the bare "Attack N printed" / "Defense N printed"
 *  unless nothing else modified them, so the caption stays terse). */
function buildAttackBreakdown(req: {
  attackBreakdown: string[];
  defenseBreakdown: string[];
}): string[] {
  return [...req.attackBreakdown, ...req.defenseBreakdown];
}

/**
 * On-destroy Spirit (Finn's Warrior's Attack Spirit / Thorgrim's Warrior's Armor
 * Spirit, cards.md). When the destroyed figure is Finn or Thorgrim AND the game
 * is still in progress, queue a `spirit_placement` PendingChoice OWNED BY THE
 * DESTROYED CHAMPION'S OWNER (not the attacker). The owner then places the
 * Spirit on ANY living unique Army Card (any owner — the text is not friendly-
 * restricted), permanently +1 attack (Finn) or +1 defense (Thorgrim).
 *
 * Skipped when the game just finished (phase !== 'playing') — no Spirit once a
 * side is wiped (slice-4 spec §Server). Also a no-op if there are no living
 * unique cards to place on (every slice-4 card is a Unique Hero/Squad, so this
 * only bites in pathological wiped-board cases the finish-gate already covers).
 */
function maybeQueueSpiritOnDestroy(s: HSState, destroyed: Figure): void {
  if (s.phase !== 'playing') return; // finish takes precedence
  if (s.pendingChoice) return; // one decision at a time
  const cardId = cardDefFor(s, destroyed).id;
  const spirit: 'attack' | 'defense' | null =
    cardId === FINN_CARD_ID ? 'attack' : cardId === THORGRIM_CARD_ID ? 'defense' : null;
  if (!spirit) return;
  const ownerSeat = destroyed.ownerSeat;
  // "any unique Army Card" — every card in play is unique; offer all that still
  // have at least one living figure (a card with no figures left is out of play).
  const options = s.cards.filter(c => cardHasLivingFigures(s, c.uid)).map(c => c.uid);
  if (options.length === 0) return; // nothing to place it on
  s.pendingChoice = { kind: 'spirit_placement', seat: ownerSeat, spirit, options };
  pushLog(
    s,
    'power',
    `${cardDef(cardId).shortName} is destroyed — ${playerName(s, ownerSeat)} may place the Warrior's ${spirit === 'attack' ? 'Attack' : 'Armor'} Spirit on any unique Army Card.`,
  );
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
// Special powers — Berserker Charge, Water Clone (slice 4)
// ============================================================================

/** Living figures of the active card owned by `seat` (for the squad powers). */
function activeCardFigures(state: HSState, seat: number): Figure[] {
  const activeUid = getActiveCardUid(state);
  if (!activeUid) return [];
  return state.figures.filter(f => f.cardUid === activeUid && f.ownerSeat === seat && f.at != null);
}

/**
 * Tarn BERSERKER CHARGE (cards.md): "After moving and before attacking, roll the
 * 20-sided die. If you roll a 15 or higher, you may move all Tarn Viking Warriors
 * again." The SERVER rolls the d20; the engine validates timing + threshold.
 *   • timing: the active card must be Tarn, ≥1 Tarn figure must have moved this
 *     turn, no figure may have attacked yet, and the charge must not be SPENT by
 *     an earlier failed roll this turn (one roll on a miss).
 *   • 15+  → open a `berserker_charge` PendingChoice — the re-move is the
 *     player's "may" (resolve_choice with remove:true re-grants movement;
 *     remove:false declines). The charge may then repeat.
 *   • <15  → the charge is spent for the turn; log the miss.
 */
function doBerserkerCharge(state: HSState, seat: number, d20: number): HSResult {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
    return { error: 'Berserker Charge requires a d20 roll (1-20)' };
  }
  const activeUid = getActiveCardUid(state);
  const activeCard = state.cards.find(c => c.uid === activeUid);
  if (!activeCard || activeCard.cardId !== TARN_CARD_ID) {
    return { error: 'Only Tarn Viking Warriors may Berserker Charge' };
  }
  if (state.turnAttacks.length > 0) {
    return { error: 'Berserker Charge happens after moving and BEFORE attacking' };
  }
  // "After moving" — at least one Tarn figure must have moved this turn.
  const movedThisCard = state.movedFigureIds.some(id => {
    const f = state.figures.find(x => x.id === id);
    return f && f.cardUid === activeUid;
  });
  if (!movedThisCard) {
    return { error: 'Move at least one Tarn Viking Warrior before charging' };
  }
  if (state.berserkerSpent) {
    return { error: 'Berserker Charge is spent for this turn' };
  }

  const s = clone(state);
  if (d20 >= BERSERKER_THRESHOLD) {
    // Success — offer the optional re-move (never auto-applied).
    s.pendingChoice = { kind: 'berserker_charge', seat, cardUid: activeCard.uid };
    pushLog(
      s,
      'power',
      `Berserker Charge — ${playerName(s, seat)} rolls ${d20} (≥${BERSERKER_THRESHOLD})! They may move all Tarn Viking Warriors again.`,
    );
  } else {
    s.berserkerSpent = true;
    pushLog(
      s,
      'power',
      `Berserker Charge — ${playerName(s, seat)} rolls ${d20} (<${BERSERKER_THRESHOLD}). No extra move.`,
    );
  }
  return s;
}

/**
 * Marro WATER CLONE (cards.md): "Instead of attacking with the Marro Warriors,
 * roll the 20-sided die for each Marro Warrior in play. If you roll a 15 or
 * higher, place a previously destroyed Marro Warrior on a same-level space
 * adjacent to that Marro Warrior. Any Marro Warrior on a water space needs a 10
 * or higher … You may only Water Clone after you move."
 *
 * The SERVER rolls one d20 per LIVING Marro Warrior of the active card; the
 * engine validates the set + per-Warrior threshold (15+, or 10+ on water), then
 * collects a `water_clone_place` PendingChoice with one entry per VIABLE success
 * (a success that has ≥1 same-level empty adjacent hex AND a destroyed Marro
 * still available to return). Successes with no legal landing / no clone left
 * auto-skip and are logged. Consumes the card's attack for the turn.
 */
function doWaterClone(
  state: HSState,
  seat: number,
  rolls: { marroFigureId: string; d20: number }[],
): HSResult {
  const activeUid = getActiveCardUid(state);
  const activeCard = state.cards.find(c => c.uid === activeUid);
  if (!activeCard || activeCard.cardId !== MARRO_CARD_ID) {
    return { error: 'Only Marro Warriors may Water Clone' };
  }
  // "Instead of attacking" — cannot clone after an attack, and not twice.
  if (state.turnAttacks.length > 0) {
    return { error: 'Water Clone is instead of attacking — you have already attacked' };
  }
  if (state.waterClonedThisTurn) {
    return { error: 'The Marro Warriors have already Water Cloned this turn' };
  }
  // "You may only Water Clone after you move" — at least one Marro must have
  // moved this turn (the squad's activation must include a move).
  const movedThisCard = state.movedFigureIds.some(id => {
    const f = state.figures.find(x => x.id === id);
    return f && f.cardUid === activeUid;
  });
  if (!movedThisCard) {
    return { error: 'You may only Water Clone after you move' };
  }

  // The rolls must be exactly one per LIVING Marro Warrior of the active card.
  const livingMarro = activeCardFigures(state, seat);
  const livingIds = new Set(livingMarro.map(f => f.id));
  if (
    !Array.isArray(rolls) ||
    rolls.length !== livingMarro.length ||
    new Set(rolls.map(r => r.marroFigureId)).size !== rolls.length ||
    !rolls.every(r => livingIds.has(r.marroFigureId)) ||
    !rolls.every(r => Number.isInteger(r.d20) && r.d20 >= 1 && r.d20 <= 20)
  ) {
    return { error: 'Water Clone needs exactly one d20 per living Marro Warrior' };
  }

  const map = MAPS[state.mapId];
  const s = clone(state);
  s.waterClonedThisTurn = true; // consumes the attack for the turn

  // Destroyed Marro Warriors available to return (figures of the active card
  // with no position). Each success consumes one; we walk successes in figure
  // order and assign destroyed clones in id order for determinism.
  const destroyedClones = s.figures
    .filter(f => f.cardUid === activeUid && f.at == null)
    .map(f => f.id);

  const placements: { cloneFigureId: string; rollerFigureId: string; options: HexKey[] }[] = [];
  // Occupied hexes (live figures) — landing spaces must be EMPTY. Glyph hexes
  // are not blocked for placement (the rules only require same-level adjacency);
  // a clone placed on a glyph does not "move onto" it, so no forced-stop/heal.
  const occupied = new Set(s.figures.filter(f => f.at != null).map(f => f.at!));

  let successes = 0;
  let skippedNoSpace = 0;
  for (const roller of livingMarro) {
    const roll = rolls.find(r => r.marroFigureId === roller.id)!;
    const onWater = map?.cells[roller.at!]?.terrain === 'water';
    const threshold = onWater ? WATER_CLONE_WATER_THRESHOLD : WATER_CLONE_THRESHOLD;
    if (roll.d20 < threshold) continue; // failed roll
    successes += 1;
    if (placements.length >= destroyedClones.length) {
      // No destroyed Marro left to return — the success can't place.
      skippedNoSpace += 1;
      continue;
    }
    // Same-level, empty, in-bounds hexes adjacent to the roller.
    const myLevel = map?.cells[roller.at!]?.height;
    const options = neighborKeys(roller.at!).filter(k => {
      const cell = map?.cells[k];
      return cell != null && cell.height === myLevel && !occupied.has(k);
    });
    if (options.length === 0) {
      skippedNoSpace += 1;
      continue;
    }
    const cloneFigureId = destroyedClones[placements.length];
    placements.push({ cloneFigureId, rollerFigureId: roller.id, options });
  }

  pushLog(
    s,
    'power',
    `Water Clone — ${playerName(s, seat)} rolls for ${livingMarro.length} Marro Warrior${livingMarro.length === 1 ? '' : 's'}: ${successes} success${successes === 1 ? '' : 'es'}${
      skippedNoSpace > 0 ? `, ${skippedNoSpace} with no landing/clone (skipped)` : ''
    }. (Instead of attacking.)`,
  );

  if (placements.length > 0) {
    // Prompt the owner to choose each landing (never auto-placed).
    s.pendingChoice = { kind: 'water_clone_place', seat, placements, chosen: [] };
  }
  // If no viable placement, the Water Clone simply spent the attack with no
  // returns (all successes lacked a clone or a legal space).
  return s;
}

// ============================================================================
// Resolve a PendingChoice (slice 4) — never auto-issued; the owning seat sends
// the matching resolution. The engine validates the payload kind matches the
// open choice and that the chosen option is legal.
// ============================================================================

function doResolveChoice(state: HSState, seat: number, choice: HSChoiceResolution): HSResult {
  const pc = state.pendingChoice!;
  if (pc.kind !== choice.kind) {
    return { error: `Expected a ${pc.kind} resolution` };
  }

  // --- Spirit placement (Finn/Thorgrim on destroy) ---
  if (pc.kind === 'spirit_placement' && choice.kind === 'spirit_placement') {
    if (!pc.options.includes(choice.cardUid)) {
      return { error: 'The Spirit must be placed on a living unique Army Card' };
    }
    const s = clone(state);
    const card = s.cards.find(c => c.uid === choice.cardUid)!;
    if (pc.spirit === 'attack') card.attackMod += 1;
    else card.defenseMod += 1;
    delete s.pendingChoice;
    pushLog(
      s,
      'power',
      `${playerName(s, seat)} places the Warrior's ${pc.spirit === 'attack' ? 'Attack' : 'Armor'} Spirit on ${cardDef(card.cardId).name} — +1 ${pc.spirit} forever.`,
    );
    return s;
  }

  // --- Berserker Charge re-move (optional "may") ---
  if (pc.kind === 'berserker_charge' && choice.kind === 'berserker_charge') {
    const s = clone(state);
    delete s.pendingChoice;
    if (choice.remove) {
      // Re-grant movement to ALL Tarn Viking Warriors (clear the active card's
      // moved flags). They may move again — and may charge again afterwards (no
      // printed repeat limit; the charge is not marked spent on a success).
      s.movedFigureIds = s.movedFigureIds.filter(id => {
        const f = s.figures.find(x => x.id === id);
        return !(f && f.cardUid === pc.cardUid);
      });
      pushLog(s, 'power', `${playerName(s, seat)} charges again — all Tarn Viking Warriors may move once more!`);
    } else {
      pushLog(s, 'power', `${playerName(s, seat)} declines the Berserker Charge re-move.`);
    }
    return s;
  }

  // --- Water Clone placement (one landing per viable success, in order) ---
  if (pc.kind === 'water_clone_place' && choice.kind === 'water_clone_place') {
    const idx = pc.chosen.length; // the placement being resolved now
    const placement = pc.placements[idx];
    if (!placement) return { error: 'No Water Clone placement is pending' };
    // The chosen hex must be one of this placement's same-level adjacent options
    // AND not already taken by an earlier clone this resolution.
    if (!placement.options.includes(choice.hex) || pc.chosen.includes(choice.hex)) {
      return { error: 'Choose a same-level empty space adjacent to that Marro Warrior' };
    }
    // It must also still be empty (a live figure could not have moved here while
    // the choice was open, but guard anyway).
    if (state.figures.some(f => f.at === choice.hex)) {
      return { error: 'That space is occupied' };
    }
    const s = clone(state);
    const clone_ = s.figures.find(f => f.id === placement.cloneFigureId)!;
    clone_.at = choice.hex;
    clone_.wounds = 0; // a returned figure comes back fresh
    const chosen = [...pc.chosen, choice.hex];
    pushLog(
      s,
      'power',
      `Water Clone — ${figureLabel(s, clone_)} returns to the battlefield at ${hexLabel(choice.hex)}.`,
    );
    if (chosen.length < pc.placements.length) {
      // More clones to place — keep the choice open with the updated progress.
      s.pendingChoice = { ...pc, chosen };
    } else {
      delete s.pendingChoice;
    }
    return s;
  }

  return { error: 'Unhandled choice resolution' };
}

// ============================================================================
// End turn
// ============================================================================

function doEndTurn(state: HSState, seat: number): HSResult {
  const s = clone(state);
  pushLog(s, 'info', `${playerName(s, seat)} ends the turn.`);
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.turnAttacks = [];
  delete s.waterClonedThisTurn;
  delete s.berserkerSpent;
  if (advanceSlot(s)) beginTurnOrSkip(s);
  return s;
}

// ============================================================================
// Registry contract
// ============================================================================

export function getActivePlayerId(state: HSState): string | null {
  // Draft (slice 5): the hourglass follows the current drafter; null once both
  // seats have passed (the draft is finishing) — there is no single drafter.
  if (state.phase === 'draft') {
    const turnSeat = state.draft?.turnSeat;
    if (turnSeat == null) return null;
    return state.players.find(p => p.seat === turnSeat)?.playerId ?? null;
  }
  // Placement (slice 5): simultaneous + ready-gated — no single active player.
  if (state.phase === 'placement') return null;
  if (state.phase !== 'playing') return null;
  // A pending choice points the hourglass at the DECIDER (slice 4) — which may
  // be the opponent (a Spirit placement triggers on whoever's turn caused the
  // destruction, but the choice belongs to the destroyed champion's owner).
  if (state.pendingChoice) {
    return state.players.find(p => p.seat === state.pendingChoice!.seat)?.playerId ?? null;
  }
  // Null while placing markers (simultaneous, ready-gated) and in lobby /
  // finished — there is a single active player only during a turn.
  if (state.turnSeat == null) return null;
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

/** The PERMANENT Spirit mods on `fig`'s army card (slice 4). Defaults to 0/0 if
 *  the card is missing or the fields are absent (slice-2/3 saves). */
function cardModFor(state: HSState, fig: Figure): { attackMod: number; defenseMod: number } {
  const card = state.cards.find(c => c.uid === fig.cardUid);
  return { attackMod: card?.attackMod ?? 0, defenseMod: card?.defenseMod ?? 0 };
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
