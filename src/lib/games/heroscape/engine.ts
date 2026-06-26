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
  HSPendingChoice,
  HSGlyph,
  HSGlyphId,
  HSLogEntry,
  HSMode,
  HSEdition,
  HSResult,
  HSState,
  InitiativeAttempt,
  LastRoll,
  OrderMarkerValue,
} from './types';
import { MAPS, type HSMap } from './maps';
import { HS_CARDS, HS_DRAFT_POOL, SLICE1_ARMIES, HS_GLYPHS, effectiveCardDef } from './content';
import {
  areEngaged,
  axialToOffset,
  computeFall,
  dragStep,
  hasLineOfSight3D,
  hexDistance,
  hexLine,
  neighborKeys,
  parseHexKey,
  rangeDistance,
  rangeFlood,
  reachableDestinations,
  type FallTier,
  type Occupancy,
} from './board';

export const STATE_VERSION = 8;
export const LOG_MAX = 60;
/** Quick (fixed-army) battle is always the classic 1-v-1. */
const QUICK_SEATS = 2;
/** Up to 6 players may be seated (multiplayer). The draft + turn engine scale to
 *  any 2..MAX_SEATS; teams are formed by shared `HSPlayer.team`. */
export const MAX_SEATS = 6;
const DEFAULT_MAP_ID = 'training_field';
const MARKER_VALUES: readonly OrderMarkerValue[] = ['1', '2', '3', 'X'];

/** Point-budget presets the lobby offers (slice 5). The lobby also accepts a
 *  CUSTOM amount (free entry), validated against this range. */
export const POINT_BUDGETS: readonly number[] = [200, 300, 400, 500];
export const DEFAULT_POINT_BUDGET = 400;
/** Bounds for a custom (free-entry) point budget. A drafted army needs at least
 *  the cheapest card; the ceiling keeps the pool finite and the UI sane. */
export const MIN_POINT_BUDGET = 50;
export const MAX_POINT_BUDGET = 2000;
/** A point budget is valid if it is a preset OR a positive integer in range. */
export function isValidBudget(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_POINT_BUDGET && n <= MAX_POINT_BUDGET;
}
const DEFAULT_MODE: HSMode = 'draft';

// ============================================================================
// Teams (multiplayer) — players sharing a `team` are allies. The whole engine
// keys "enemy/ally" off TEAM, not seat; with the default (team absent ⇒ team =
// seat) a 2-player or free-for-all game is unchanged. See HSPlayer.team.
// ============================================================================

/** The team a seat belongs to. Absent `team` ⇒ the seat is its OWN team, encoded
 *  as `-1 - seat` so a solo seat can NEVER collide with an explicit (non-negative)
 *  team id — e.g. an unassigned player on seat 1 must not be read as "team 1".
 *  Free-for-all still falls out for free (every seat a distinct negative id), and
 *  callers only ever compare/group these ids, never use them as seat indices. */
function teamOfSeat(state: HSState, seat: number): number {
  return state.players.find(p => p.seat === seat)?.team ?? -1 - seat;
}

/** Do two seats share a team (are they allies)? A seat is always its own ally. */
function alliedSeats(state: HSState, a: number, b: number): boolean {
  return teamOfSeat(state, a) === teamOfSeat(state, b);
}

/** Distinct team ids currently seated, in ascending order. */
function teamsInPlay(state: HSState): number[] {
  return [...new Set(state.players.map(p => teamOfSeat(state, p.seat)))].sort((x, y) => x - y);
}

/** A figure is ALIVE if it is ON the board OR waiting in RESERVE (Airborne Elite
 *  before The Drop). Distinct from "on the board" (`at != null`) — a reserve
 *  figure counts for elimination / order-marker eligibility but occupies no hex
 *  and cannot be targeted or act until deployed. Destroyed = `at == null` AND not
 *  reserve. */
function figureAlive(f: Figure): boolean {
  return f.at != null || !!f.reserve;
}

/** Is this seat still in the game (drives turns / markers / The Drop / win)? A figure ON THE BOARD
 *  keeps it alive. With NO on-board figure, the owner ruling 2026-06-25 applies in the PLAYING phase:
 *  a team is eliminated the instant its LAST on-board figure is destroyed — reserve Airborne do NOT
 *  grant a last-chance Drop. Reserve keeps the seat alive ONLY while it has never lost a figure (never
 *  committed to the board — e.g. an all-Airborne army whose Drop hasn't landed yet), so such a team
 *  still gets its rounds to roll in. (A player who fears the on-board wipe should keep a figure back so
 *  the Drop can still come down.) Outside 'playing' (draft/placement) the old reserve-counts rule holds.
 *  NB: `figureAlive`/`cardHasLivingFigures` are unchanged — you can still assign order markers to a
 *  reserve Airborne card. */
function seatIsAlive(state: HSState, seat: number): boolean {
  const figs = state.figures.filter(f => f.ownerSeat === seat);
  if (figs.some(f => f.at != null)) return true; // a figure stands on the battlefield
  if (state.phase !== 'playing') return figs.some(figureAlive); // setup never eliminates (old rule)
  const hasReserve = figs.some(f => f.reserve);
  const hasCasualty = figs.some(f => f.at == null && !f.reserve); // a figure was destroyed (in play, unplaced = none)
  return hasReserve && !hasCasualty; // un-deployed reserve survives; a wiped-on-board team does not
}

/** Seats with at least one living figure, in seat order. The round flow keys on
 *  THIS, not `players`: with 3+ players a seat can be wiped out while the game
 *  goes on (its team-mates fight on), and an eliminated seat neither places
 *  order markers nor rolls initiative nor takes turns. In a 1-v-1 a wipe ends
 *  the game, so living seats always equals all seats — unchanged. */
export function livingSeats(state: HSState): number[] {
  return state.players.map(p => p.seat).filter(seat => seatIsAlive(state, seat));
}

/** When it's time to roll initiative this round, the LIVING seats to roll for;
 *  otherwise null. The round's order-marker step is complete once every living
 *  seat has locked in — an eliminated seat (3+ players, its team fighting on)
 *  never places, so the round must NOT wait on it. The server calls this to
 *  decide both WHEN to roll and FOR WHOM, keeping the "living seats, not all
 *  players" rule in one tested place so an eliminated seat can't soft-lock the
 *  round (and so the attempt it builds matches what `doRollInitiative` demands —
 *  exactly the living seats). */
export function initiativeReadySeats(state: HSState): number[] | null {
  if (state.phase !== 'playing' || state.subPhase !== 'place_markers') return null;
  const living = livingSeats(state);
  if (living.length === 0) return null;
  return living.every(seat => (state.markersReady ?? []).includes(seat)) ? living : null;
}

/** The point budget a SEAT's team drafts within: its team's override, else the
 *  global `pointBudget`. Team-mates share one pool, so callers sum a team's
 *  spend against this single value. */
export function teamBudgetForSeat(state: HSState, seat: number): number {
  return state.teamBudgets?.[teamOfSeat(state, seat)] ?? state.pointBudget;
}

/** Deal seats out round-robin across teams, preserving the within-team priority
 *  of the input `order`. "Pass left but skip team-mates until every team has had
 *  a turn, then come back round." Teams first appear in the order their leading
 *  seat does. With all-solo teams the output equals the input (a no-op for
 *  1-v-1 / FFA). Example: order [A1,A2,B1,B2] (team A leads) → [A1,B1,A2,B2]. */
/** The living seats in PHYSICAL ring order around the battlefield — sorted by the angle of each
 *  seat's start-zone centroid about the board centre, so consecutive entries are physically
 *  ADJACENT start areas ("the player to your left"). Turn order passes around THIS ring, not by
 *  seat index: the Star Field assigns seats to its tips FARTHEST-FIRST (seat 0 and seat 1 land on
 *  OPPOSITE tips so early players spread out), so rotating by raw seat number zig-zags across the
 *  board instead of going around it. With 2 seats the ring is trivial — keep seat order. */
function physicalSeatRing(state: HSState): number[] {
  const seats = livingSeats(state);
  if (seats.length <= 2) return [...seats].sort((a, b) => a - b);
  // Pointy-top hex → pixel (matches the Star Field's own tip ordering): x = √3·(q + r/2), y = 1.5·r.
  const centroid = (seat: number): { x: number; y: number } => {
    const zone = startZoneFor(state, seat);
    if (!zone.length) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const k of zone) {
      const { q, r } = parseHexKey(k);
      x += Math.sqrt(3) * (q + r / 2);
      y += 1.5 * r;
    }
    return { x: x / zone.length, y: y / zone.length };
  };
  const pts = seats.map(seat => ({ seat, c: centroid(seat) }));
  const cx = pts.reduce((s, p) => s + p.c.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.c.y, 0) / pts.length;
  return pts
    .map(p => ({ seat: p.seat, a: Math.atan2(p.c.y - cy, p.c.x - cx) }))
    .sort((p, n) => p.a - n.a)
    .map(o => o.seat);
}

function interleaveByTeam(state: HSState, order: number[]): number[] {
  const buckets = new Map<number, number[]>();
  const teamSequence: number[] = [];
  for (const seat of order) {
    const t = teamOfSeat(state, seat);
    if (!buckets.has(t)) {
      buckets.set(t, []);
      teamSequence.push(t);
    }
    buckets.get(t)!.push(seat);
  }
  const result: number[] = [];
  while (result.length < order.length) {
    for (const t of teamSequence) {
      const q = buckets.get(t)!;
      if (q.length) result.push(q.shift()!);
    }
  }
  return result;
}

/** Card ids whose figures have a special power the engine acts on (slice 4). */
const TARN_CARD_ID = 'tarn_vikings';
const MARRO_CARD_ID = 'marro_warriors';
const FINN_CARD_ID = 'finn';
const THORGRIM_CARD_ID = 'thorgrim';
const ELDGRIM_CARD_ID = 'eldgrim';
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
/** Raelin's DEFENSIVE AURA radius — 4 CLEAR SIGHT spaces (RotV card). */
const RAELIN_AURA_RANGE = 4;
/** Raelin's DEFENSIVE AURA bonus — +2 defense dice (RotV card). */
const RAELIN_AURA_BONUS = 2;
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
    edition: 'modern',
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
    lastRoll: null,
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
  if (state.players.length >= MAX_SEATS) return state;
  const players = [...state.players, { seat, playerId, username, accent_color }].sort(
    (a, b) => a.seat - b.seat,
  );
  return { ...state, players };
}

export function removePlayer(state: HSState, playerId: string): HSState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

/** Fun, original bot names — kept SHORT (one punchy word) so they fit the standings,
 *  turn-order, and card panels without truncating. The server picks one at random per
 *  bot (see makeMoveHS); this list is the fallback when a name isn't supplied. */
export const FUN_BOT_NAMES = [
  'Chaos', 'Stabsalot', 'Bonk', 'Mayhem', 'Bumble',
  'Crusher', 'Calamity', 'Grumpus', 'Wreckage', 'Pounce',
  'Vlad', 'Snuggles', 'Smasher', 'Bash', 'Tank', 'Boomer',
];

/** Add an AI opponent to the lowest empty seat (lobby only). Synthetic playerId
 *  "bot-<seat>"; the server drives its draft / placement / turns via ai_step.
 *  Optional `team` assigns it to a side (so you can ally WITH a bot). `name` is a
 *  pre-picked fun name from the server; without it we fall back to the pool. */
function doAddBot(state: HSState, team?: number, name?: string): HSResult {
  if (state.phase !== 'lobby') return { error: 'AI opponents can only be added in the lobby' };
  if (state.players.length >= MAX_SEATS) return { error: `HeroScape seats at most ${MAX_SEATS} players` };
  const used = new Set(state.players.map(p => p.seat));
  let seat = 0;
  while (used.has(seat)) seat += 1;
  const botCount = state.players.filter(p => p.bot).length;
  const chosen = name && name.trim() ? name.trim() : FUN_BOT_NAMES[botCount % FUN_BOT_NAMES.length];
  const player = {
    seat,
    playerId: `bot-${seat}`,
    // No " (AI)" suffix — the `bot` flag drives the 🤖 marker in the panels, and a
    // shorter username fits the standings / turn-order / card panels without truncating.
    username: chosen,
    bot: true,
    ...(team !== undefined ? { team } : {}),
  };
  const players = [...state.players, player].sort((a, b) => a.seat - b.seat);
  return { ...state, players };
}

function doRemoveBot(state: HSState, seat: number): HSResult {
  if (state.phase !== 'lobby') return { error: 'AI opponents can only be removed in the lobby' };
  const p = state.players.find(x => x.seat === seat);
  if (!p?.bot) return { error: 'That seat is not an AI' };
  return { ...state, players: state.players.filter(x => x.seat !== seat) };
}

// ============================================================================
// Apply action
// ============================================================================

/** Action kinds that USE the active card's special power (so a Glyph of Nilrend
 *  negation blocks them server-side). Normal move/attack/end are NOT here — a
 *  negated unit still moves and makes normal attacks at base stats. */
const SPECIAL_POWER_ACTION_KINDS: ReadonlySet<HSAction['kind']> = new Set([
  'fire_line', 'explosion', 'grenade', 'berserker_charge', 'water_clone',
  'mind_shackle', 'chomp', 'ice_shard', 'queglix', 'wild_swing', 'acid_breath',
  'throw_figure', 'carry_move', 'overextend',
] as HSAction['kind'][]);

export function applyAction(state: HSState, playerId: string, action: HSAction): HSResult {
  if (!state.players.some(p => p.playerId === playerId)) {
    return { error: 'You are not seated in this game' };
  }
  if (action.kind === 'start_game') {
    // Host gating happens in the server action (room.host_id); the engine
    // validates the game shape (and the chosen battlefield).
    return doStartGame(state, action.mapId, action.pointBudget, action.mode, action.edition, action.glyphSeed);
  }
  if (action.kind === 'set_lobby_config') {
    // Host changing the battlefield/budget/mode in the lobby — written to shared
    // state so every player sees it (host-gated in the server action).
    return doSetLobbyConfig(
      state,
      action.mapId,
      action.pointBudget,
      action.mode,
      action.edition,
      action.teams,
      action.teamBudgets,
    );
  }
  if (action.kind === 'add_bot') return doAddBot(state, action.team, action.name);
  if (action.kind === 'remove_bot') return doRemoveBot(state, action.seat);
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
      case 'orient_figure':
        // Orienting a deployed figure during setup is free (no engagement yet).
        return doOrientFigure(state, me.seat, action.figureId, action.dir);
      default:
        return { error: 'Place your figures in your start zone first' };
    }
  }

  // PendingChoice gate (slice 4): while a decision is open, the engine blocks
  // every normal action for everyone except the owning seat, and the owner may
  // ONLY resolve it. Never auto-resolved (rules-fidelity §choice).
  if (state.pendingChoice) {
    // The Airborne grenade throw sequence resolves via its OWN server-rolled
    // action (not resolve_choice), so it is permitted while its choice is open.
    if (state.pendingChoice.kind === 'grenade_throw' && action.kind === 'grenade_throw') {
      if (state.pendingChoice.seat !== me.seat) {
        return { error: 'This grenade belongs to another player' };
      }
      return drainSpirits(doGrenadeThrow(state, me.seat, action));
    }
    if (action.kind !== 'resolve_choice') {
      return state.pendingChoice.seat === me.seat
        ? { error: 'Resolve your pending choice first' }
        : { error: 'An opponent has a pending choice — wait for them to resolve it' };
    }
    if (state.pendingChoice.seat !== me.seat) {
      return { error: 'This choice belongs to another player' };
    }
    return drainSpirits(doResolveChoice(state, me.seat, action.choice));
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
    // Airborne Elite THE DROP — at round start, before this seat's order markers.
    // ROLL ONLY: on 13+ it opens an `airborne_drop` pending choice (placement).
    case 'the_drop':
      return doTheDrop(state, me.seat, action.d20);
    // Turn actions — only the revealed-marker player acts.
    case 'move_figure':
    case 'move_step':
    case 'grapple_move':
    case 'undo_move':
    case 'end_move':
    case 'attack':
    case 'fire_line':
    case 'explosion':
    case 'grenade':
    case 'berserker_charge':
    case 'water_clone':
    case 'mind_shackle':
    case 'chomp':
    case 'ice_shard':
    case 'queglix':
    case 'wild_swing':
    case 'acid_breath':
    case 'throw_figure':
    case 'carry_move':
    case 'orient_figure':
    case 'overextend':
    case 'end_turn': {
      if (state.subPhase !== 'turns') return { error: 'Place your order markers first' };
      if (state.turnSeat !== me.seat) return { error: 'Not your turn' };
      // Glyph of Nilrend — the active card's SPECIAL POWERS are negated: server-side block of
      // every special-power action (the canX gates also hide them for the board/AI). A negated
      // unit may still move + make NORMAL attacks (those aren't powers), so move/attack/end pass.
      if (SPECIAL_POWER_ACTION_KINDS.has(action.kind)) {
        const auid = getActiveCardUid(state);
        if (auid && isCardNegated(state, auid)) {
          return { error: 'This unit’s special powers are negated by the Glyph of Nilrend.' };
        }
      }
      // Movement UNDO (repeatable, full rewind) — pops the pre-move snapshot stack.
      if (action.kind === 'undo_move') return doUndoMove(state, me.seat);
      // FINALIZE an in-progress tap-walk: anything other than continuing to step the SAME figure
      // (a new figure, an attack/special, end move/turn) locks the walk in — the figure must be on
      // an empty space (Agent Carr can't stop mid-pass-through). `state` is then post-finalize.
      const sameStep = action.kind === 'move_step' && state.stepMove?.figureId === action.figureId;
      if (state.stepMove && !sameStep) {
        const fin = finalizeStepMove(state);
        if ('error' in fin) return fin;
        state = fin;
      }
      let res: HSResult;
      if (action.kind === 'move_figure')
        res = doMove(state, action.figureId, action.to, action.fallRoll, action.extremeFallD20, action.leaveRolls, action.to2);
      else if (action.kind === 'move_step')
        res = doMoveStep(state, me.seat, action);
      else if (action.kind === 'grapple_move')
        res = doGrappleMove(state, action.figureId, action.to, action.fallRoll, action.extremeFallD20, action.leaveRolls);
      else if (action.kind === 'attack') res = doAttack(state, action);
      else if (action.kind === 'fire_line') res = doFireLine(state, action);
      else if (action.kind === 'explosion') res = doExplosion(state, action);
      else if (action.kind === 'grenade') res = doGrenade(state, me.seat);
      else if (action.kind === 'berserker_charge') res = doBerserkerCharge(state, me.seat, action.d20);
      else if (action.kind === 'water_clone') res = doWaterClone(state, me.seat, action.rolls);
      else if (action.kind === 'mind_shackle') res = doMindShackle(state, me.seat, action.targetId, action.d20);
      else if (action.kind === 'chomp') res = doChomp(state, me.seat, action.targetId, action.d20);
      else if (action.kind === 'ice_shard') res = doIceShard(state, action);
      else if (action.kind === 'queglix') res = doQueglix(state, action);
      else if (action.kind === 'wild_swing') res = doWildSwing(state, action);
      else if (action.kind === 'acid_breath') res = doAcidBreath(state, me.seat, action.rolls);
      else if (action.kind === 'throw_figure') res = doThrow(state, me.seat, action);
      else if (action.kind === 'carry_move') res = doCarryMove(state, me.seat, action);
      else if (action.kind === 'orient_figure') res = doOrientFigure(state, me.seat, action.figureId, action.dir);
      // "End move": a soft commit — the boundary below clears the undo stack so the move is
      // locked in. No other state change, so it stays clear of the Berserker/pending-choice flow.
      else if (action.kind === 'end_move') {
        // End move = leave the MOVE phase and enter the ATTACK phase; movement is now locked
        // (movableFigure blocks it) and the board only lets the player attack.
        const ended = clone(state);
        ended.movementEnded = true;
        res = ended;
      }
      else if (action.kind === 'overextend') res = doOverextend(state, me.seat, action.figureId);
      else res = doEndTurn(state, me.seat);
      // COMMIT BOUNDARY for movement-undo: a move/grapple PUSHES its own undo snapshot
      // (inside applyValidatedMove); orienting is a free reposition that leaves the stack
      // intact; EVERY other turn action (attack / any special / end_turn) ends the chance
      // to take a move back, so the stack is cleared (see [[the undo design]]).
      if (!('error' in res)
          && action.kind !== 'move_figure'
          && action.kind !== 'move_step'
          && action.kind !== 'grapple_move'
          && action.kind !== 'orient_figure') {
        res.moveHistory = [];
      }
      return res;
    }
    // Draft/placement actions arriving during 'playing' — out of phase.
    case 'draft_roll':
    case 'draft_card':
    case 'draft_pass':
    case 'place_figure':
    case 'unplace_figure':
    case 'placement_ready':
      return { error: 'That action is not available right now' };
    // A grenade_throw only arrives mid-sequence (caught by the pendingChoice
    // gate above); reaching here means there is no open grenade.
    case 'grenade_throw':
      return { error: 'No grenade throw is pending' };
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
    // Airborne Elite THE DROP: they do NOT start on the battlefield — every figure
    // begins in RESERVE (alive, off-board) and is deployed later by The Drop.
    const inReserve = def.id === AIRBORNE_CARD_ID;
    for (let n = 1; n <= def.figures; n++) {
      figures.push({ id: `${card.uid}-${n}`, cardUid: card.uid, ownerSeat: seat, at: null, index: n, wounds: 0, ...(inReserve ? { reserve: true } : {}) });
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
function autoPlaceQuickArmy(map: { startZones: Record<number, HexKey[]>; cells: Record<HexKey, { height: number }> }, seat: number, cards: ArmyCardInstance[], figures: Figure[]): string | null {
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
  // DOUBLE-SPACE figures (Big Heroes) need a trailing hex too — without it the
  // engine sees them on ONE hex (figureHexes = [at]) and they'd miss
  // engagement/adjacency/occupancy from their second lobe. SLICE1_ARMIES is all
  // 1-hex today so this is defensive, but it keeps the quick path correct if a
  // 2-hex card ever joins a preset. Give each a free same-level zone neighbour.
  const zone = map.startZones[seat] ?? [];
  const occupied = new Set<HexKey>();
  for (const f of figures) { if (f.at) occupied.add(f.at); if (f.at2) occupied.add(f.at2); }
  for (const card of cards.filter(c => c.ownerSeat === seat)) {
    if (HS_CARDS[card.cardId]?.baseSize !== 2) continue;
    for (const f of figures.filter(fg => fg.cardUid === card.uid)) {
      if (f.at == null || f.at2 != null) continue;
      const free = new Set(zone.filter(h => !occupied.has(h)));
      const tail = tailFor(map.cells, free, f.at);
      if (tail == null) return `${HS_CARDS[card.cardId].name} needs two empty adjacent same-level spaces in the start zone`;
      f.at2 = tail;
      occupied.add(tail);
    }
  }
  return null;
}

/** Shared tail: materialize the map's glyphs (power-side up) and open round 1 in
 *  place_markers (the slice-2 round flow). Used by the quick path and the
 *  placement → playing transition. Assumes s.cards/s.figures are already built
 *  and (for the quick/placement entry) figures are placed. */
// ---------------------------------------------------------------------------
// Random per-game glyph layout. The engine stays deterministic — the server injects
// a seed at start_game and the layout is reproducible from it. Count scales with the
// map's hex count (small maps 2, the big star up to 10); glyph ids + hexes are drawn
// at random from the ACTIVE pool (Brandar / unfinished glyphs excluded), never on a
// start zone or water.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleSeeded<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// TWO copies of every active glyph in the draw pool (owner 2026-06-25: "2 of every glyph in the pool
// … so we can see some crazy things like 2 curse 2 range attack") — a map can now roll DUPLICATES.
const GLYPH_POOL: HSGlyphId[] = (() => {
  const ids = (Object.keys(HS_GLYPHS) as HSGlyphId[]).filter(id => HS_GLYPHS[id].active && id !== 'brandar');
  return [...ids, ...ids];
})();
/** Glyph count for a map: ~1 per 60 hexes, clamped to [2, 7]. */
export function glyphCountForMap(cellCount: number): number {
  return Math.min(7, Math.max(2, Math.round(cellCount / 60)));
}
/** Multi-source flat BFS: path distance (around voids; height ignored) from a set of source
 *  hexes to every reachable cell. Used to measure how "close" a hex is to a start zone so
 *  glyphs can be placed fairly. */
function flatDistField(cells: HSMap['cells'], sources: readonly HexKey[]): Map<HexKey, number> {
  const dist = new Map<HexKey, number>();
  let frontier: HexKey[] = [];
  for (const src of sources) if (cells[src] && !dist.has(src)) { dist.set(src, 0); frontier.push(src); }
  for (let d = 1; frontier.length; d++) {
    const next: HexKey[] = [];
    for (const k of frontier) {
      for (const n of neighborKeys(k)) {
        if (dist.has(n) || !cells[n]) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}
/** Deterministic glyph layout from the game's `seed`: distinct pool ids on distinct neutral
 *  hexes (no start zones, no water), all face-down. FAIRNESS: a glyph must not sit closer to
 *  one player's start zone than another's, so candidates are ranked by IMBALANCE — the spread
 *  (max − min) of path-distance to the seats' start zones, 0 = perfectly equidistant — and the
 *  most-equidistant hexes are chosen. The seeded shuffle BEFORE the (stable) sort randomizes
 *  order among hexes that tie on imbalance, so the layout still varies game to game. */
function generateGlyphs(s: HSState, seed: number): HSGlyph[] {
  const map = MAPS[s.mapId];
  if (!map) return [];
  const rnd = mulberry32(seed);
  const cells = map.cells;
  // SYMMETRIC maps declare fixed glyph anchor positions — keep the layout symmetric, but still
  // give a random GLYPH (id) per anchor each game. (Rectangles + the star have no anchors → the
  // fair-equidistant algorithm below runs instead.)
  if (map.glyphAnchors && map.glyphAnchors.length > 0) {
    const spots = map.glyphAnchors.filter(k => cells[k] && cells[k].terrain !== 'water');
    const gids = shuffleSeeded(GLYPH_POOL, rnd).slice(0, spots.length);
    return spots.map((at, i): HSGlyph => ({ id: gids[i], at, faceUp: false }));
  }
  const seats = s.players.map(p => p.seat);
  // Distance from each seat's ACTUAL start zone (zonesByCount for the star) to every cell.
  const fields = seats.map(seat => flatDistField(cells, startZoneFor(s, seat)));
  const startHexes = new Set<HexKey>(seats.flatMap(seat => startZoneFor(s, seat)));
  // Neutral, dry, and reachable from EVERY start zone (so the per-seat distances compare).
  const candidates = (Object.keys(cells) as HexKey[]).filter(
    k => !startHexes.has(k) && cells[k].terrain !== 'water' && fields.every(f => f.has(k)),
  );
  const imbalance = (k: HexKey): number => {
    const ds = fields.map(f => f.get(k)!);
    return Math.max(...ds) - Math.min(...ds);
  };
  const count = Math.min(glyphCountForMap(Object.keys(cells).length), candidates.length, GLYPH_POOL.length);
  // Pick the most-equidistant hexes, but GREEDILY skip any adjacent to one already chosen so
  // two glyphs never sit next to each other (a 2-hex figure could otherwise cover both, and
  // they read as cramped). May yield fewer than `count` if the map can't space them out.
  const ranked = shuffleSeeded(candidates, rnd).sort((a, b) => imbalance(a) - imbalance(b));
  const hexes: HexKey[] = [];
  for (const k of ranked) {
    if (hexes.length >= count) break;
    if (hexes.some(h => neighborKeys(h).includes(k))) continue;
    hexes.push(k);
  }
  const ids = shuffleSeeded(GLYPH_POOL, rnd).slice(0, hexes.length);
  return hexes.map((at, i): HSGlyph => ({ id: ids[i], at, faceUp: false }));
}
/** The glyph layout for a game: the seeded fair-random layout when the server supplied a
 *  seed, else the map's hand-authored static glyphs. All face-down (power-side-down). */
function glyphLayoutFor(s: HSState): HSGlyph[] {
  if (s.glyphSeed != null) return generateGlyphs(s, s.glyphSeed);
  const map = MAPS[s.mapId];
  return (map?.glyphs ?? []).map((g): HSGlyph => ({ id: g.id, at: g.at, faceUp: false }));
}

/** Clear the per-turn / per-activation scratch flags (once-per-turn powers). Called at EVERY turn
 *  boundary — beginTurnOrSkip, startNextRound, doEndTurn — and at game start (enterPlaying), so a
 *  new per-turn flag added here can't leak across turns by being forgotten at one call site. */
function resetTurnScratch(s: HSState): void {
  delete s.waterClonedThisTurn;
  delete s.berserkerSpent;
  delete s.mindShackleSpent;
  delete s.chompedThisTurn;
  delete s.queglixDiceSpent;
  delete s.threwThisTurn;
}

function enterPlaying(s: HSState): void {
  // Glyphs start HIDDEN (face-down): unknown + inert until a figure stops on one — then
  // applyGlyphOnStop flips it face-up and it takes effect (05-glyphs: placed power-side-DOWN).
  // They are normally laid out at the START of placement (finishDraft) so figures are placed
  // AROUND them; preserve that layout. Only generate here for paths with no placement phase
  // (quick battle), where they aren't set yet.
  if (!s.glyphs || s.glyphs.length === 0) s.glyphs = glyphLayoutFor(s);
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
  s.stepMove = undefined;
  s.movementEnded = false;
  s.moveHistory = [];
  s.winnerSeat = null;
  s.winnerTeam = null;
  delete s.pendingChoice;
  resetTurnScratch(s);
  delete s.draft;
  delete s.hand;
  delete s.placementReady;
  const glyphNote = s.glyphs.length
    ? ` ${s.glyphs.length} glyph${s.glyphs.length === 1 ? '' : 's'} await on the field.`
    : '';
  pushLog(s, 'info', `Battle on the ${MAPS[s.mapId]?.name ?? 'battlefield'}! Round 1 — all players secretly place their order markers.${glyphNote}`);
}

function doSetLobbyConfig(
  state: HSState,
  mapId?: string,
  pointBudget?: number,
  mode?: HSMode,
  edition?: HSEdition,
  teams?: Record<number, number>,
  teamBudgets?: Record<number, number>,
): HSResult {
  if (state.phase !== 'lobby') return { error: 'Settings can only be changed before the battle starts' };
  const s = clone(state);
  if (mapId !== undefined) {
    if (!MAPS[mapId]) return { error: `Unknown battlefield "${mapId}"` };
    s.mapId = mapId;
  }
  if (mode !== undefined) s.mode = mode;
  if (edition !== undefined) s.edition = edition;
  if (pointBudget !== undefined) {
    if (!isValidBudget(pointBudget)) {
      return { error: `Budget must be ${MIN_POINT_BUDGET}–${MAX_POINT_BUDGET} points` };
    }
    s.pointBudget = pointBudget;
  }
  // Team assignment (host groups players by colour). Seats map to team ids; a
  // seat omitted from the map is its own team (free-for-all). Write it onto each
  // seated player (an unknown seat in the map is just ignored).
  if (teams !== undefined) {
    s.players = s.players.map(p => {
      const t = teams[p.seat];
      return t === undefined ? { ...p, team: undefined } : { ...p, team: t };
    });
  }
  if (teamBudgets !== undefined) {
    for (const v of Object.values(teamBudgets)) {
      if (!isValidBudget(v)) return { error: `Each team budget must be ${MIN_POINT_BUDGET}–${MAX_POINT_BUDGET} points` };
    }
    s.teamBudgets = { ...teamBudgets };
  }
  return s;
}

function doStartGame(state: HSState, mapId?: string, pointBudget?: number, mode?: HSMode, edition?: HSEdition, glyphSeed?: number): HSResult {
  if (state.phase !== 'lobby') return { error: 'The battle has already started' };
  if (state.players.length < 2) return { error: 'HeroScape needs at least 2 players' };
  if (state.players.length > MAX_SEATS) return { error: `HeroScape seats at most ${MAX_SEATS} players` };
  // At least two opposing TEAMS must be present, or there is no battle to fight
  // (the host can't put everyone on one colour).
  if (teamsInPlay(state).length < 2) {
    return { error: 'Players must be split into at least two teams' };
  }
  // The host picks the battlefield at game start (default: Training Field).
  const chosenMapId = mapId ?? state.mapId ?? DEFAULT_MAP_ID;
  const map = MAPS[chosenMapId];
  if (!map) return { error: `Unknown battlefield "${chosenMapId}"` };
  const chosenMode: HSMode = mode ?? state.mode ?? DEFAULT_MODE;
  const chosenBudget = pointBudget ?? state.pointBudget ?? DEFAULT_POINT_BUDGET;
  if (chosenMode === 'draft' && !isValidBudget(chosenBudget)) {
    return { error: `Budget must be ${MIN_POINT_BUDGET}–${MAX_POINT_BUDGET} points` };
  }
  // Quick (fixed-army) mode only ships the two slice-1 armies — it stays 1-v-1.
  if (chosenMode === 'quick' && state.players.length !== QUICK_SEATS) {
    return { error: 'Quick battle is 2 players only — choose Draft for 3+ players' };
  }
  // The battlefield must have a start zone for every seat: the rectangles are
  // 2-player; the Star Field carries 3-6 player zones (`zonesByCount`).
  if (chosenMode === 'draft' && !mapSupportsCount(map, state.players.length)) {
    return {
      error: `${map.name} is for ${map.zonesByCount ? '3-6' : '2'} players — pick ${map.zonesByCount ? 'a 2-player battlefield' : 'the Star Field'} for ${state.players.length}.`,
    };
  }

  const s = clone(state);
  // Re-pack seats to 0..n-1 so a gap (a player left seat 0, or seats were assigned sparsely in the
  // lobby) can't leave a seat with no start zone — the Star Field's zonesByCount is keyed 0..n-1, so
  // a seat 2 in a 2-player game would project to an empty zone and soft-lock placement (M3). Players
  // keep their identity + team (team is per-player); only the seat index is normalised, before any
  // seat-keyed build (cards/figures/start zones all read the new seat).
  s.players = [...s.players].sort((a, b) => a.seat - b.seat).map((p, i) => ({ ...p, seat: i }));
  s.mapId = chosenMapId;
  s.mode = chosenMode;
  if (glyphSeed != null) s.glyphSeed = glyphSeed; // random per-game glyph layout (server-injected)
  // Freeze the card-stat edition for the whole game (combat + budget read it).
  s.edition = edition ?? state.edition ?? 'modern';
  s.pointBudget = chosenBudget;
  s.cards = [];
  s.figures = [];

  if (chosenMode === 'quick') {
    // Quick battle: auto-draft the fixed slice-1 armies and auto-place them,
    // then go straight to playing (preserves the slice-4 fast path exactly).
    for (let idx = 0; idx < QUICK_SEATS; idx++) {
      const { cards, figures } = buildArmy(s.players[idx].seat, SLICE1_ARMIES[idx]);
      s.cards.push(...cards);
      s.figures.push(...figures);
      const err = autoPlaceQuickArmy(map, s.players[idx].seat, s.cards, s.figures);
      if (err) return { error: err };
    }
    enterPlaying(s);
    return s;
  }

  // Draft mode: enter the draft phase. The roll-off d20s are SERVER-rolled —
  // makeMoveHS issues a `draft_roll` in the same request (mirrors initiative),
  // so the draft is set up but awaits the order roll. armies/spent are keyed for
  // EVERY seat (2..6), not just the original 2.
  const seats = s.players.map(p => p.seat);
  s.phase = 'draft';
  s.subPhase = 'place_markers'; // unused while drafting; kept canonical
  s.glyphs = [];
  s.draft = {
    pool: [...HS_DRAFT_POOL],
    order: [],
    dir: 1,
    rollOff: [],
    turnSeat: null,
    remainingPicks: 0,
    passed: [],
    armies: Object.fromEntries(seats.map(seat => [seat, [] as string[]])),
    spent: Object.fromEntries(seats.map(seat => [seat, 0])),
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

/** Cost of a card id under the active edition (Classic costs differ for several
 *  cards). 0 for an unknown id (defensive). */
function cardPoints(state: HSState, cardId: string): number {
  return effectiveCardDef(cardId, state.edition)?.points ?? 0;
}

/** Points a seat's TEAM has spent so far (Σ team-mates' spend) — the shared
 *  pool is team-wide, so a 3-player team's picks all draw on one budget. For a
 *  solo seat (FFA) this is just its own spend. */
export function teamSpentInDraft(state: HSState, seat: number): number {
  const d = state.draft!;
  const team = teamOfSeat(state, seat);
  return state.players
    .filter(p => teamOfSeat(state, p.seat) === team)
    .reduce((sum, p) => sum + (d.spent[p.seat] ?? 0), 0);
}

/** Points still available to a seat: its TEAM budget minus the team's spend. */
export function teamRemainingInDraft(state: HSState, seat: number): number {
  return teamBudgetForSeat(state, seat) - teamSpentInDraft(state, seat);
}

/** True iff the pool still holds a card the seat can AFFORD within its team's
 *  remaining budget. When false, the seat MUST pass (no legal pick). */
function hasAffordableCard(state: HSState, seat: number): boolean {
  const remaining = teamRemainingInDraft(state, seat);
  const d = state.draft!;
  return d.pool.some(id => cardPoints(state, id) <= remaining);
}

/** Hand the draft to the next active (un-passed) seat following a TRUE SNAKE:
 *  forward through the roll order, then reverse, bouncing at each end — the seat at
 *  an end picks twice in a row at the turnaround — repeating every round, for ANY
 *  player count (2-6). This balances going late every pass (no one-time opener
 *  bonus). Passed seats are skipped; all passed → draft over. */
function advanceDraftTurn(s: HSState): void {
  const d = s.draft!;
  if (!d.order.some(seat => !d.passed.includes(seat))) {
    finishDraft(s);
    return;
  }
  const n = d.order.length;
  let i = Math.max(0, d.order.indexOf(d.turnSeat ?? d.order[0]));
  let dir: 1 | -1 = d.dir ?? 1;
  // Walk the bounce sequence (0,1,…,n-1, n-1,…,1,0, 0,1,…) until a non-passed seat.
  for (let guard = 0; guard <= 2 * n + 2; guard++) {
    const ni = i + dir;
    if (ni < 0 || ni >= n) dir = dir === 1 ? -1 : 1; // turnaround: keep i, flip dir
    else i = ni;
    if (!d.passed.includes(d.order[i])) {
      d.turnSeat = d.order[i];
      d.dir = dir;
      d.remainingPicks = 1;
      return;
    }
  }
  finishDraft(s); // unreachable (guarded above), but safe
}

/** When EVERY seat has passed: build each seat's army cards + figures and the
 *  placement `hand`, then enter the placement phase. */
function finishDraft(s: HSState): void {
  const d = s.draft!;
  d.turnSeat = null;
  s.cards = [];
  s.figures = [];
  const seats = s.players.map(p => p.seat);
  s.hand = Object.fromEntries(seats.map(seat => [seat, [] as string[]]));
  for (const seat of seats) {
    const { cards, figures } = buildArmy(seat, d.armies[seat] ?? []);
    s.cards.push(...cards);
    s.figures.push(...figures);
    // Reserve figures (Airborne Elite — The Drop) are NOT placed in the start zone;
    // they deploy later, so they never enter the placement hand.
    s.hand[seat] = figures.filter(f => !f.reserve).map(f => f.id);
  }
  s.placementReady = [];
  // Lay out the glyphs NOW, before figures are placed, so players can see them and place
  // their armies around them. The fair-placement pass keeps no glyph closer to one start
  // zone than another (generateGlyphs). enterPlaying preserves this layout.
  s.glyphs = glyphLayoutFor(s);
  s.phase = 'placement';
  const tally = seats.map(seat => `${playerName(s, seat)}: ${d.spent[seat] ?? 0} pts`).join(', ');
  pushLog(s, 'info', `Draft complete — place your figures in your start zone. ${tally}.`);
}

/** Shared d20 ROLL-OFF resolution for initiative + draft (02-rounds §Step 2). Only the seats TIED FOR
 *  HIGHEST in the FIRST attempt re-roll, until one is highest; everyone else keeps their first roll (a
 *  seat that lost outright can never steal first place on a re-roll). Validates that every re-roll
 *  changed ONLY the contenders, and that each non-final attempt was a real tie among them. Returns the
 *  final order — first roll (a clean loser keeps its place), then the re-roll (breaks the top tie),
 *  then seat. `order[0]` is the winner / first drafter. */
function resolveRollOff(attempts: InitiativeAttempt[], seats: number[]): { order: number[] } | { error: string } {
  const first = attempts[0];
  const rollIn = (att: InitiativeAttempt, seat: number) => att.find(a => a.seat === seat)?.roll ?? -Infinity;
  const firstMax = Math.max(...first.map(a => a.roll));
  const contenders = first.filter(a => a.roll === firstMax).map(a => a.seat);
  // Non-contenders must carry their FIRST roll unchanged through every re-roll.
  for (let i = 1; i < attempts.length; i++) {
    for (const seat of seats) {
      if (!contenders.includes(seat) && rollIn(attempts[i], seat) !== rollIn(first, seat)) {
        return { error: 'A non-tied seat was re-rolled' };
      }
    }
  }
  const contenderTie = (att: InitiativeAttempt): number => {
    const m = Math.max(...contenders.map(s => rollIn(att, s)));
    return contenders.filter(s => rollIn(att, s) === m).length;
  };
  for (let i = 0; i < attempts.length - 1; i++) {
    if (contenderTie(attempts[i]) <= 1) return { error: 'Re-rolled an attempt that was not tied for highest' };
  }
  if (contenderTie(attempts[attempts.length - 1]) > 1) return { error: 'Roll-off ended in a tie — roll again' };
  const last = attempts[attempts.length - 1];
  const order = [...seats].sort((a, b) => rollIn(first, b) - rollIn(first, a) || rollIn(last, b) - rollIn(last, a) || a - b);
  return { order };
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
  // Tie-break: only the seats tied for highest re-roll until one wins; everyone else keeps their first
  // roll (so a clean loser stays in its place). Order = first roll, then the re-roll, then seat.
  const resolved = resolveRollOff(attempts, seats);
  if ('error' in resolved) return { error: resolved.error };
  const order = resolved.order;
  const highSeat = order[0];

  const s = clone(state);
  const dd = s.draft!;
  dd.rollOff = attempts;
  dd.order = order;
  // High roller drafts FIRST; the draft then SNAKES forward through `order` and
  // back — the seat at each end picks twice at the turnaround — repeating every
  // round, for ANY player count (see advanceDraftTurn).
  dd.turnSeat = highSeat;
  dd.dir = 1;
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
  const cost = cardPoints(state, cardId);
  const remaining = teamRemainingInDraft(state, seat);
  if (cost > remaining) {
    return { error: `${HS_CARDS[cardId].name} costs ${cost} — only ${remaining} points left` };
  }

  const s = clone(state);
  const dd = s.draft!;
  // Unique cards leave the shared pool (drafted once total). COMMON cards stay,
  // so they can be drafted again — same player or another — limited only by
  // budget (HeroScape's rarity rule). No current card is Common; this is ready
  // for future ones. Edition-aware so rarity could differ by edition if needed.
  if (!effectiveCardDef(cardId, state.edition)?.common) {
    dd.pool = dd.pool.filter(id => id !== cardId);
  }
  dd.armies[seat] = [...(dd.armies[seat] ?? []), cardId];
  dd.spent[seat] = (dd.spent[seat] ?? 0) + cost;
  // Show the TEAM pool (shared) so team-mates see the common budget drain.
  pushLog(
    s,
    'info',
    `${playerName(s, seat)} drafts ${HS_CARDS[cardId].name} (${cost} pts) — ${teamSpentInDraft(s, seat)}/${teamBudgetForSeat(s, seat)}.`,
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
  if (dd.passed.length >= s.players.length) {
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

/** Does this battlefield have a start zone for every one of `n` seats? The
 *  rectangles author seats 0-1 (2 players only); the Star Field carries 3-6 via
 *  `zonesByCount`. */
export function mapSupportsCount(map: HSMap, n: number): boolean {
  if (map.zonesByCount) return map.zonesByCount[n] != null;
  return n === 2 && map.startZones[0] != null && map.startZones[1] != null;
}

/** A seat's start-zone hexes, honouring the multiplayer STAR's per-PLAYER-COUNT
 *  point assignment (`zonesByCount`). The 2-player rectangles have none, so they
 *  fall back to their authored `startZones`. Single source of truth for "whose
 *  hexes are these" — placement validation, the UI highlight, and the board tint
 *  all read it. */
export function startZoneFor(state: HSState, seat: number): HexKey[] {
  const map = MAPS[state.mapId];
  if (!map) return [];
  return map.zonesByCount?.[state.players.length]?.[seat] ?? map.startZones[seat] ?? [];
}

/** Empty start-zone hexes of `seat` a figure may be placed on right now. The
 *  board calls this to highlight legal placement squares (single source of
 *  truth with the engine's validation). */
export function placeableHexes(state: HSState, seat: number): Set<HexKey> {
  const zone = startZoneFor(state, seat);
  const occupied = new Set<HexKey>();
  for (const f of state.figures) for (const k of figureHexes(f)) occupied.add(k);
  return new Set(zone.filter(k => !occupied.has(k)));
}

/** Lead hexes a DOUBLE-SPACE figure may be placed on: an empty start-zone hex
 *  that also has an empty SAME-LEVEL start-zone neighbour for its trailing
 *  space. The board highlights these when a 2-hex figure is the one being
 *  placed; the engine fills the trailing hex deterministically (`tailFor`). */
export function placeable2Leads(state: HSState, seat: number): Set<HexKey> {
  const map = MAPS[state.mapId];
  if (!map) return new Set();
  const free = placeableHexes(state, seat);
  const out = new Set<HexKey>();
  for (const lead of free) if (tailFor(map.cells, free, lead) != null) out.add(lead);
  return out;
}

function doPlaceFigure(state: HSState, seat: number, figureId: string, to: HexKey): HSResult {
  if ((state.placementReady ?? []).includes(seat)) {
    return { error: 'You have already locked in your placement' };
  }
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.ownerSeat !== seat) return { error: 'That is not your figure' };
  if (fig.at != null) return { error: 'That figure is already on the battlefield' };
  if (!(state.hand?.[seat] ?? []).includes(figureId)) return { error: 'That figure is not in your hand' };
  const free = placeableHexes(state, seat);
  if (!free.has(to)) {
    return { error: 'Place onto an empty hex of your own start zone' };
  }
  // A DOUBLE-SPACE figure needs a second empty same-level zone hex; the engine
  // picks it deterministically (tailFor) so the board only sends the lead.
  const def = cardDefFor(state, fig);
  let tail: HexKey | null = null;
  if (baseSizeOf(def) === 2) {
    tail = tailFor(MAPS[state.mapId].cells, free, to);
    if (tail == null) {
      return { error: `${def.name} needs two empty adjacent spaces of the same level in your start zone` };
    }
  }
  const s = clone(state);
  const placed = s.figures.find(f => f.id === figureId)!;
  placed.at = to;
  placed.at2 = tail;
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
  const f = s.figures.find(f => f.id === figureId)!;
  f.at = null;
  f.at2 = null;
  s.hand![seat] = [...(s.hand![seat] ?? []), figureId];
  pushLog(s, 'move', `${playerName(s, seat)} returns ${figureLabel(s, fig)} to hand.`);
  return s;
}

/**
 * Player-chosen ORIENTATION (figure-presentation slice). A 1-hex figure gets a
 * purely COSMETIC facing (HeroScape has no facing rules) — always allowed. A
 * DOUBLE-SPACE figure swings its TRAILING hex onto the lead's neighbour in hex
 * direction `dir`, which must be a real, EMPTY, SAME-LEVEL hex. Reorienting must
 * never be a free escape from engagement — that would dodge the leaving-
 * engagement swipe dice a real move provokes — so a 2-hex figure that is
 * currently engaged with an enemy must MOVE instead. Free: it never spends the
 * figure's move or attack (the lead hex never changes).
 */
function doOrientFigure(state: HSState, seat: number, figureId: string, dir: number): HSResult {
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return { error: 'No such figure to turn' };
  if (fig.ownerSeat !== seat) return { error: 'You can only turn your own figures' };
  if (!Number.isInteger(dir) || dir < 0 || dir > 5) return { error: 'Not a valid facing' };
  const def = cardDefFor(state, fig);

  // 1-hex: cosmetic facing only — never touches the footprint, so always allowed.
  if (baseSizeOf(def) !== 2) {
    if ((fig.facing ?? 0) === dir) return state; // no-op (already facing that way)
    const s = clone(state);
    s.figures.find(f => f.id === figureId)!.facing = dir;
    return s;
  }

  // 2-hex: swing the TRAILING hex onto the lead's neighbour in `dir`.
  const lead = fig.at;
  const tail = neighborKeys(lead)[dir];
  const cells = MAPS[state.mapId]?.cells;
  if (!cells || !cells[tail]) return { error: 'No space there to swing the second hex onto' };
  if (tail === fig.at2) return state; // already oriented that way (no-op)
  if (cells[tail].height !== cells[lead].height) {
    return { error: `${def.name}'s two hexes must be the same height` };
  }
  const blocked = state.figures.some(
    o => o.id !== fig.id && o.at != null && figureHexes(o).includes(tail),
  );
  if (blocked) return { error: 'That hex is occupied' };
  if (enemiesEngagedWith(state, fig).length > 0) {
    return { error: `${def.name} is engaged — move to reposition instead of turning in place` };
  }

  const s = clone(state);
  const f = s.figures.find(f => f.id === figureId)!;
  f.at2 = tail;
  f.facing = dir;
  pushLog(s, 'move', `${playerName(s, seat)} turns ${figureLabel(s, fig)} to face ${hexLabel(tail)}.`);
  // Swinging the trailing lobe onto a glyph puts the figure ON it — reveal + claim it
  // (footprint-aware), so a 2-hex figure controls a glyph under either half. (05-glyphs)
  applyGlyphOnStop(s, f);
  return s;
}

/**
 * UI helper for the board's rotate control (figure-presentation slice): for one
 * figure, which hex directions it can orient toward right NOW, its current
 * facing, and — for a 2-hex figure — whether an in-place turn is currently
 * BLOCKED because it is engaged (the board disables the control + explains). A
 * 1-hex figure can always face any of the six directions (cosmetic). Pure.
 */
export function orientationOptions(
  state: HSState,
  figureId: string,
): { baseSize: 1 | 2; currentDir: number; validDirs: number[]; engagedBlocked: boolean } {
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) {
    return { baseSize: 1, currentDir: 0, validDirs: [], engagedBlocked: false };
  }
  const def = cardDefFor(state, fig);
  if (baseSizeOf(def) !== 2) {
    return { baseSize: 1, currentDir: fig.facing ?? 0, validDirs: [0, 1, 2, 3, 4, 5], engagedBlocked: false };
  }
  const lead = fig.at;
  const cells = MAPS[state.mapId]?.cells;
  const neigh = neighborKeys(lead);
  const dirOf = fig.at2 != null ? neigh.indexOf(fig.at2) : -1;
  const currentDir = dirOf >= 0 ? dirOf : (fig.facing ?? 0);
  const validDirs: number[] = [];
  if (cells) {
    for (let d = 0; d < 6; d++) {
      const t = neigh[d];
      if (!cells[t] || cells[t].height !== cells[lead].height) continue;
      if (state.figures.some(o => o.id !== fig.id && o.at != null && figureHexes(o).includes(t))) continue;
      validDirs.push(d);
    }
  }
  return {
    baseSize: 2,
    currentDir,
    validDirs,
    engagedBlocked: enemiesEngagedWith(state, fig).length > 0,
  };
}

function doPlacementReady(state: HSState, seat: number): HSResult {
  if ((state.placementReady ?? []).includes(seat)) {
    return { error: 'You have already locked in your placement' };
  }
  // Must field at least one figure — placed in the start zone OR held in reserve
  // (Airborne Elite, who deploy later via The Drop). An army can't be empty.
  const placed = state.figures.filter(f => f.ownerSeat === seat && f.at != null).length;
  const reserve = state.figures.filter(f => f.ownerSeat === seat && f.reserve).length;
  if (placed < 1 && reserve < 1) return { error: 'Place at least one figure before locking in' };

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
  if ((s.placementReady ?? []).length >= s.players.length) {
    s.cards = s.cards.filter(c => s.figures.some(f => f.cardUid === c.uid));
    enterPlaying(s);
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
  // THE DROP COMES FIRST. The Airborne player rolls (publicly) and deploys BEFORE anyone places
  // order markers, so every player can react to where the Airborne landed. Block ALL marker
  // placement until the reserve-Airborne seat has rolled its Drop this round: a hit then opens its
  // airborne_drop choice (the pendingChoice gate blocks everyone until it deploys); a miss sets
  // airborneDropRound and we fall through. (Airborne Elite is Unique → at most one such seat.)
  const dropper = livingSeats(state).find(st => reserveAirborne(state, st).length > 0);
  if (dropper != null && state.airborneDropRound !== state.round) {
    return { error: 'The Drop is rolled before order markers this round — wait for the Airborne Elite to deploy.' };
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
  // Readiness drives the board's "waiting on…" UI; it deliberately does NOT log a
  // per-player line — that secret-phase bookkeeping just clutters the battle log
  // (and is value-free: opponents may know THAT you locked in, never where the
  // numbers went). The single per-round banner marks the placement step instead.
  s.markersReady.push(seat);
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
  // BEFORE knowing who acts first (02-rounds §The round). Only LIVING seats
  // place markers, roll, and take turns — an eliminated seat (3+ players, its
  // team fighting on) is skipped entirely this and every later round.
  const seats = livingSeats(state);
  if (state.markersReady.length !== seats.length) {
    return { error: 'Initiative is rolled once every player has placed order markers' };
  }
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return { error: 'Missing initiative rolls' };
  }
  // The Glyph of Dagmar adds +8 to its controller's initiative (05-glyphs). The
  // SERVER applies it; the engine re-validates the bonus matches Dagmar control
  // (controlled by whoever occupies the glyph right now). Each seat is owed
  // exactly 0 or 8.
  // Dagmar (+8) and Lodin (+1) both add to a seat's initiative; a seat may hold either,
  // both, or neither. The server carries raw+bonus; this re-validates the exact total.
  const initiativeBonusFor = (seat: number): number =>
    seatGlyphCount(state, seat, 'dagmar') * DAGMAR_INITIATIVE_BONUS + lodinD20Bonus(state, seat);
  for (const attempt of attempts) {
    if (
      !Array.isArray(attempt) ||
      attempt.length !== seats.length ||
      !seats.every(seat => attempt.some(a => a?.seat === seat))
    ) {
      return { error: 'Malformed initiative rolls' };
    }
    for (const a of attempt) {
      const owed = initiativeBonusFor(a.seat);
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
  // Tie-break: only the seats tied for highest re-roll until one wins; everyone else keeps their first
  // roll (02-rounds §Step 2 — a seat that lost outright can't steal first on the re-roll). Turn order
  // is winner-first then the seat ring, so only the WINNER is read from the roll-off.
  const resolved = resolveRollOff(attempts, seats);
  if ('error' in resolved) return { error: resolved.error };
  const winnerSeat = resolved.order[0];
  const last = attempts[attempts.length - 1];

  const s = clone(state);
  s.initiativeRolls = attempts;
  // Highest roller takes the first turn; play then passes LEFT around the table (p. 9) — i.e.
  // the PHYSICAL start-zone ring rotated to the winner, NOT raw seat-index order (seat numbers
  // are assigned farthest-first on the Star, so they don't run around the board).
  const ring = physicalSeatRing(s);
  const w = ring.indexOf(winnerSeat);
  const ffaOrder = [...ring.slice(w), ...ring.slice(0, w)];
  // Teams: the turn passes left but SKIPS team-mates until every team has acted,
  // then comes back round — i.e. deal the seats out round-robin across teams in
  // the FFA order. With all-solo teams this is a no-op (ffaOrder unchanged).
  s.initiative = interleaveByTeam(s, ffaOrder);
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
  // Pop the dice overlay for the DECIDING attempt (one d20 per seat).
  setLastRoll(s, {
    title: 'Initiative',
    dice: last.map(a => a.roll),
    labels: last.map(a => playerName(s, a.seat)),
    detail: `${playerName(s, winnerSeat)} wins initiative — takes the first turn.`,
  });
  pushLog(s, 'info', `${playerName(s, winnerSeat)} wins initiative.`);

  beginTurnOrSkip(s);
  return s;
}

// ============================================================================
// Round step 3 — the turn loop (automatic reveal, lost turns, round rollover)
// ============================================================================

/**
 * Start the turn at the current (initiative[turnPointer], turnNumber) slot:
 * automatically REVEAL that player's marker (Action 1 of the turn anatomy —
 * the placement was the choice; the reveal is not). LOST TURN (pp. 9, 14): the
 * rule is "REVEAL the Order Marker, THEN lose the turn" — so if the card holding
 * the marker has no living figures we STILL flip the marker face-up (the opponent
 * sees which card and which marker it was) and the log names both, then the turn
 * is forfeited: no move, no attack. Keeps skipping forward until a turn starts or
 * the round rolls over to the next marker placement.
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
      s.stepMove = undefined;
      s.movementEnded = false;
      s.moveHistory = [];
      resetTurnScratch(s);
      // One clean, colour-coded headline per turn ("Braxas activates" in the
      // owner's hue) instead of the old verbose "Round/turn/marker reveals…" line.
      pushLog(s, 'activate', `${HS_CARDS[holder.cardId].name} activates`, seat);
      return;
    }
    if (holder) {
      // The marker's card is out of play (all figures destroyed). You STILL
      // reveal the marker — flip it face-up so the opponent sees which card and
      // marker it was — then forfeit the turn.
      holder.orderMarkers.find(m => m.marker === String(s.turnNumber))!.revealed = true;
      pushLog(
        s,
        'info',
        `Round ${s.round}, turn ${s.turnNumber}: ${playerName(s, seat)} reveals order marker ${s.turnNumber} — ${HS_CARDS[holder.cardId].name} is out of play, turn forfeited.`,
      );
    } else {
      pushLog(s, 'info', `${playerName(s, seat)} has no order marker ${s.turnNumber} — turn skipped.`);
    }
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
  endRound(s);
  return false;
}

/** Roll over to the next round, then fire the Glyph of Wannok if a figure controls it.
 *  Wannok's curse resolves at the round boundary, BEFORE order markers — we roll the new
 *  round first (so the pendingChoice gate then blocks markers until the curse resolves),
 *  which keeps a curse-caused death (and any resulting Spirit) on the normal pending rails
 *  without a deferred-rollover dance. */
function endRound(s: HSState): void {
  startNextRound(s);
  if (s.phase !== 'playing') return; // stalemate/last-army may have finished the game
  if (!HS_GLYPHS.wannok?.active) return;
  // EVERY occupied face-up Wannok curses, one after another (the pool now holds 2 of each glyph, so a
  // map can carry two Wannoks). Queue their hexes and open them one at a time — only one pendingChoice
  // is ever open — draining through the same chokepoint as the Spirit queue.
  s.pendingWannoks = (s.glyphs ?? [])
    .filter(g => g.id === 'wannok' && g.faceUp && s.figures.some(f => f.at != null && figureHexes(f).includes(g.at)))
    .map(g => g.at);
  openNextWannokIfIdle(s);
}
/** Open the next queued Wannok curse if one is owed and no choice / Spirit is open. Re-checks the
 *  glyph is still occupied (a prior curse this boundary could have vacated it). Drained from
 *  `drainSpirits` after every resolve_choice, so two Wannoks resolve back-to-back. */
function openNextWannokIfIdle(s: HSState): void {
  if (s.phase !== 'playing' || s.pendingChoice || (s.pendingSpirits?.length ?? 0) > 0) return;
  while (s.pendingWannoks && s.pendingWannoks.length > 0) {
    const at = s.pendingWannoks.shift()!;
    const g = (s.glyphs ?? []).find(x => x.at === at && x.id === 'wannok' && x.faceUp);
    const occupant = g ? s.figures.find(f => f.at != null && figureHexes(f).includes(at)) : undefined;
    if (!g || !occupant) continue; // glyph gone or vacated by an earlier curse — skip
    s.pendingChoice = { kind: 'glyph_wannok', seat: occupant.ownerSeat, at, d20: null };
    pushLog(s, 'glyph', `Glyph of Wannok — ${playerName(s, occupant.ownerSeat)} rolls its curse before order markers.`);
    return;
  }
}

/** Deal exactly one (unblockable) wound to a figure and remove it if that meets its Life.
 *  Used by the Glyph of Wannok. Queues a Finn/Thorgrim Spirit on death (the caller must have
 *  already cleared any pendingChoice so the Spirit can open), then the caller checks the win. */
function woundOneFigure(s: HSState, fig: Figure, reason: string): void {
  fig.wounds += 1;
  const dead = fig.wounds >= cardDefFor(s, fig).life;
  if (dead) { fig.at = null; fig.at2 = null; }
  pushLog(s, 'glyph', `${reason}: ${figureLabel(s, fig)} takes a wound${dead ? ' and is destroyed!' : '.'}`);
  if (dead) maybeQueueSpiritOnDestroy(s, fig);
}

/** End of round (p. 8/14): markers return to the owners' pools — revealed and
 *  unrevealed alike are silently retrieved, NEVER shown (02-rounds §Open
 *  questions reads unrevealed markers as never flipped). */
function startNextRound(s: HSState): void {
  s.round += 1;
  // No-progress stalemate backstop: track the living-figure count; if it hasn't
  // changed (no kills, no clones) for STALEMATE_ROUNDS rounds, the armies can't engage
  // — end the game by surviving army rather than hang forever.
  const living = s.figures.filter(figureAlive).length;
  if (s.staleLiving == null || living !== s.staleLiving) {
    s.staleLiving = living;
    s.staleSinceRound = s.round;
  }
  const noProgress = s.staleSinceRound != null && s.round - s.staleSinceRound >= STALEMATE_ROUNDS;
  if (noProgress || s.round >= HARD_ROUND_CAP) {
    stalemateResolve(s);
    if (s.phase === 'finished') return; // game over — don't open another round
  }
  s.subPhase = 'place_markers';
  s.turnNumber = 1;
  s.turnPointer = 0;
  s.initiative = [];
  s.initiativeRolls = [];
  s.markersReady = [];
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.turnAttacks = [];
  s.stepMove = undefined;
  s.movementEnded = false;
  s.moveHistory = [];
  resetTurnScratch(s);
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

/** A figure's base level = the height of the cell it stands on (a double-space
 *  figure rests on two same-level cells, so either works). */
function baseLevel(state: HSState, fig: Figure): number {
  return figureStandLevel(state, fig);
}

/** Sightline elevation of a figure for elevation-aware LOS (board §LOS): the
 *  cell height + 1, so a figure on a taller column sees over a shorter one. */
function eyeHeightOfKey(state: HSState, key: HexKey): number {
  return heightOfKey(state, key) + 1;
}

/** The single HEIGHT-AWARE line-of-sight eye rule. A figure SEES from its OWN height: the sightline
 *  leaves its hex at `terrain + the figure's Height stat`, while every other hex (the target, the
 *  terrain in between) uses the default ground eye (`terrain + 1`). So a figure TALLER than the land
 *  or wall between it and a foe sees right over it, while a height-15 wall (taller than any figure)
 *  still blocks everyone. Pass the returned `eyeOf` into hasLineOfSight3D for any attack/range check
 *  so normal attacks, ranged specials (Queglix/Ice Shard), Fire Line, Explosion, throws, auras and
 *  the range-highlight all share ONE rule (no more "I tower over that hill but can't see past it"). */
function attackerEyeFn(state: HSState, attacker: Figure): (k: HexKey) => number {
  const atkH = cardDefFor(state, attacker).height;
  const aHexes = figureHexes(attacker);
  return (k: HexKey) => (aHexes.includes(k) ? heightOfKey(state, k) + atkH : eyeHeightOfKey(state, k));
}

// ============================================================================
// DOUBLE-SPACE (2-hex) figure helpers — Mimring & Grimnak occupy 2 hexes.
// `figureHexes` is the single source of a figure's FOOTPRINT: a 1-hex figure
// yields [at]; a double-space figure yields [at, at2]. Occupancy, engagement,
// range and LOS all loop over it, so a 2-hex figure blocks both spaces and is
// engaged / targeted / sighted from EITHER end (04-combat "from the better
// end"). A double-space figure always RESTS on two same-level hexes.
// ============================================================================
function baseSizeOf(def: HSCardDef): 1 | 2 {
  return def.baseSize === 2 ? 2 : 1;
}
function figureHexes(fig: Figure): HexKey[] {
  if (fig.at == null) return [];
  return fig.at2 != null ? [fig.at, fig.at2] : [fig.at];
}
/** Resting elevation of a figure (max over its hexes; equals height(at) for a
 *  1-hex figure, and a 2-hex figure always rests level so max == min). */
function figureStandLevel(state: HSState, fig: Figure): number {
  let h = 0;
  for (const k of figureHexes(fig)) h = Math.max(h, heightOfKey(state, k));
  return h;
}
/** The trailing hex for a 2-hex LEAD: the first empty, same-level neighbour in
 *  fixed DIRS order, so the engine (and any preview) agree deterministically.
 *  `free` is the set of currently-empty (or vacated) candidate hexes. */
function tailFor(
  cells: Record<HexKey, { height: number }>,
  free: Set<HexKey>,
  lead: HexKey,
): HexKey | null {
  const lh = cells[lead]?.height;
  for (const n of neighborKeys(lead)) {
    if (n !== lead && free.has(n) && cells[n] && cells[n].height === lh) return n;
  }
  return null;
}

/** Living ENEMY figures of `fig` that it is currently engaged with — pure
 *  geometry (adjacency + the elevation exception, 03-movement §8). */
function enemiesEngagedWith(state: HSState, fig: Figure): Figure[] {
  if (fig.at == null) return [];
  return state.figures.filter(other => {
    // ALLIES never engage one another (teams): you move freely through team-mates
    // and are never swiped leaving their side. A solo seat is its own team, so
    // 1-v-1 / FFA is unchanged. (You may still CHOOSE to attack a team-mate —
    // friendly fire — but engagement is not forced on allies.)
    if (other.at == null || other.id === fig.id) return false;
    if (alliedSeats(state, other.ownerSeat, fig.ownerSeat)) return false;
    return engagedPair(state, fig, other);
  });
}

/** Is `fig` engaged with `enemy`? True when ANY hex of one is engagement-
 *  adjacent to ANY hex of the other, so a double-space figure engages (and is
 *  engaged) from either of its two spaces (03-movement §8). */
function engagedPair(state: HSState, fig: Figure, enemy: Figure): boolean {
  if (fig.at == null || enemy.at == null) return false;
  const fh = cardDefFor(state, fig).height;
  const eh = cardDefFor(state, enemy).height;
  const heightAt = (k: HexKey) => heightOfKey(state, k);
  for (const fk of figureHexes(fig)) {
    for (const ek of figureHexes(enemy)) {
      if (areEngaged(fk, fh, ek, eh, heightAt)) return true;
    }
  }
  return false;
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
  const ah = cardDefFor(state, a).height;
  const bh = cardDefFor(state, b).height;
  const heightAt = (k: HexKey) => heightOfKey(state, k);
  for (const ak of figureHexes(a)) {
    for (const bk of figureHexes(b)) {
      if (areEngaged(ak, ah, bk, bh, heightAt)) return true;
    }
  }
  return false;
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
      !isCardNegated(state, o.cardUid) && // Nilrend: a negated source grants no aura
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
 * Does Raelin's DEFENSIVE AURA reach `defender` (RotV card):
 * "All figures YOU CONTROL within 4 clear sight spaces of Raelin add 2 to their
 * defense dice. … does not affect Raelin."
 *   • a LIVING Raelin owned by the DEFENDER's seat must exist (figures you
 *     control = same owner — NOT all friendly-player figures),
 *   • the defender is NOT that Raelin herself (explicit self-exclusion),
 *   • the defender is within 4 RANGE-spaces of Raelin (counted around gaps,
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
    if (isCardNegated(state, raelin.cardUid)) return false; // Nilrend: a negated Raelin projects no aura
    // Within RAELIN_AURA_RANGE (4) clear-sight spaces (RotV printing). Both `at`s are guarded
    // non-null above (the `!` is just for the closure, which widens the param).
    const dist = rangeDistance(map.cells, raelin.at!, defender.at!);
    if (dist == null || dist > RAELIN_AURA_RANGE) return false;
    // Clear sight: an elevation-aware LOS from Raelin to the defender, with
    // intervening figures (neither endpoint) blocking exactly as in combat LOS.
    // Figures do NOT block line of sight — only terrain does (on-map obstacles may
    // come later) — so the aura's clear-sight check passes no figure blockers.
    // Raelin is a TALL FLYER, so her aura's clear sight is cast from HER height, not the default
    // hex+1 ground eye — she sees over low hills/land and only tall walls break it (user: "she is
    // taller than the land"). Source eye = her hex height + her figure Height; targets stay normal.
    const raelinEye = heightOfKey(state, raelin.at!) + cardDefFor(state, raelin).height;
    return hasLineOfSight3D(map.cells, raelin.at!, defender.at!, [], (k: HexKey) =>
      k === raelin.at ? raelinEye : eyeHeightOfKey(state, k),
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
      // EITHER lobe of a 2-hex figure standing on the glyph controls it (footprint, not just lead hex).
      state.figures.some(f => f.ownerSeat === seat && figureHexes(f).includes(g.at)),
  );
}

/** How many face-up glyphs of `glyphId` a seat CONTROLS (has a figure standing on). Duplicate BUFF
 *  glyphs STACK per copy (owner ruling 2026-06-25: "stack for crazy games") — e.g. two Lodin = +2 to
 *  every d20, two Ivor = +4 range. Boolean conditions (Thorian / Rannveig / Proftaka / Kelda) keep
 *  using `seatControlsGlyph` — controlling two of an on/off glyph changes nothing. */
function seatGlyphCount(state: HSState, seat: number, glyphId: HSGlyphId): number {
  if (!HS_GLYPHS[glyphId]?.active) return 0;
  return (state.glyphs ?? []).filter(
    g => g.id === glyphId && g.faceUp && state.figures.some(f => f.ownerSeat === seat && figureHexes(f).includes(g.at)),
  ).length;
}

/** Glyph of Lodin: +1 PER controlled Lodin to ANY d20 the seat rolls (initiative — stacking with
 *  Dagmar — The Drop, Mind Shackle, Berserker Charge, Chomp, extreme-fall saves). */
function lodinD20Bonus(state: HSState, seat: number): number {
  return seatGlyphCount(state, seat, 'lodin');
}

/** Wounds a defender takes from a SPECIAL attack. STEALTH DODGE (Krav Maga) applies to special attacks
 *  too (owner ruling 2026-06-25 — a defender keeps its defensive powers vs specials, the same way it
 *  keeps height): against a NON-adjacent attacker, ≥1 rolled shield blocks ALL the damage. */
function specialAttackWounds(state: HSState, attacker: Figure | undefined, defender: Figure, skulls: number, shields: number): number {
  if (attacker && shields >= 1 && cardDefFor(state, defender).stealthDodge && !figuresAdjacent(state, attacker, defender)) return 0;
  return Math.max(0, skulls - shields);
}

/** Does `fig`'s FOOTPRINT cover a face-up, active glyph of `glyphId`? (Either lobe of a
 *  2-hex figure counts — same footprint rule as control.) */
function figureStandsOnGlyph(state: HSState, fig: Figure, glyphId: HSGlyphId): boolean {
  if (!HS_GLYPHS[glyphId]?.active) return false;
  const hexes = figureHexes(fig);
  return (state.glyphs ?? []).some(g => g.id === glyphId && g.faceUp && hexes.includes(g.at));
}

/** Glyph of Rannveig suppresses ALL Flying while ANY figure (friend or foe) stands on a
 *  face-up Rannveig — a global toggle, not per-controller. */
function rannveigSuppressesFlying(state: HSState): boolean {
  if (!HS_GLYPHS.rannveig?.active) return false;
  return (state.glyphs ?? []).some(
    g => g.id === 'rannveig' && g.faceUp && state.figures.some(f => f.at != null && figureHexes(f).includes(g.at)),
  );
}

/** Effective Flying for a card def — its printed Flying unless a Glyph of Rannveig is
 *  occupied (strips Flying from every figure). The single source for movement decisions.
 *  (A Nilrend-negated card already has `flying:false` via cardDefFor's power-strip.) */
function effectiveFlying(state: HSState, def: HSCardDef): boolean {
  return !!def.flying && !rannveigSuppressesFlying(state);
}

/** Is this army card's special powers NEGATED for the game (Glyph of Nilrend)? The
 *  chosen card's figures then fight with only base stats. Threaded into: cardDefFor
 *  (strips the passive power FLAGS), the aura-source scans (hasFiguresAdjacentLivingCard /
 *  raelinAuraReaches / Carr / Zettian self-buffs), maxAttacks (Syvarris), and the
 *  special-power action gate. Glyph bonuses + height are NOT card powers — unaffected. */
function isCardNegated(state: HSState, cardUid: string | undefined): boolean {
  return cardUid != null && (state.negatedCardUids ?? []).includes(cardUid);
}

/** Is the ACTIVE card (the one taking this turn) negated? Every special power is used by the
 *  active card, so this hides all of them — used at the top of each can-X / targets-X gate so
 *  the board never shows a negated card's power button and the AI never proposes it. */
function activeCardNegated(state: HSState): boolean {
  return isCardNegated(state, getActiveCardUid(state) ?? undefined);
}

/** Is a FRIENDLY figure (same seat, not `fig` itself) in a space adjacent to `fig`? Used by
 *  the Glyph of Proftaka trap. */
function hasFriendlyAdjacent(state: HSState, fig: Figure): boolean {
  return state.figures.some(
    o => o.id !== fig.id && o.at != null && o.ownerSeat === fig.ownerSeat && figuresAdjacent(state, fig, o),
  );
}

/** Resurrect `fig` (currently destroyed) onto an EMPTY space in its OWNER's starting zone —
 *  a 1-hex figure on any free start hex, a 2-hex figure on a free same-level adjacent pair
 *  (Glyph of Sturla). Mutates `s` in place; returns true if it found room (false = stays dead). */
/** The empty start-zone hexes a resurrected figure (Glyph of Sturla) may be placed on by its
 *  OWNER — every free hex for a 1-hex figure; for a 2-hex figure, the lead hexes that have a
 *  free same-zone tail. Single source for the board highlight + the placement validation. */
export function sturlaPlacementHexes(state: HSState, figureId: string): HexKey[] {
  const map = MAPS[state.mapId];
  const fig = state.figures.find(f => f.id === figureId);
  if (!map || !fig) return [];
  const occupied = new Set<HexKey>();
  for (const f of state.figures) { if (f.id === figureId) continue; if (f.at) occupied.add(f.at); if (f.at2) occupied.add(f.at2); }
  const free = (map.startZones[fig.ownerSeat] ?? []).filter(h => !occupied.has(h));
  if (baseSizeOf(cardDefFor(state, fig)) === 2) {
    return free.filter(lead => tailFor(map.cells, new Set(free.filter(h => h !== lead)), lead) != null);
  }
  return free;
}

/** Open the next Sturla PLACEMENT choice (owned by that figure's owner). Skips a riser with no
 *  legal spot (start zone full) — it stays fallen. Clears the pending when the queue is empty. */
function openSturlaPlacement(s: HSState, risers: string[]): void {
  let queue = risers;
  while (queue.length > 0) {
    const figureId = queue[0];
    const fig = s.figures.find(f => f.id === figureId);
    if (fig && fig.at == null && sturlaPlacementHexes(s, figureId).length > 0) {
      s.pendingChoice = { kind: 'glyph_sturla_place', seat: fig.ownerSeat, figureId, remaining: queue.slice(1) };
      return;
    }
    if (fig) pushLog(s, 'glyph', `Resurrection — no room in ${playerName(s, fig.ownerSeat)}'s start zone for ${figureLabel(s, fig)}; it stays fallen.`);
    queue = queue.slice(1);
  }
  delete s.pendingChoice; // all risers placed (or skipped)
}

/** Open the interactive ROLL CEREMONY (Mitonsoul curse / Sturla resurrection). Collects the
 *  eligible figures — curse = every LIVING figure, resurrect = every DEAD non-reserve figure —
 *  grouped by owner and ordered by TURN ORDER starting at `stepperSeat` (the figure that revealed
 *  the glyph). Each owner rolls their figures one at a time; all players watch. Fizzles (removes the
 *  temporary glyph, logs) if no figure is eligible — so a Resurrection with no fallen just vanishes. */
function openRollCeremony(s: HSState, mode: 'curse' | 'resurrect', at: HexKey, stepperSeat: number): void {
  const eligible = (seat: number): string[] =>
    s.figures
      .filter(f => f.ownerSeat === seat && (mode === 'curse' ? f.at != null : f.at == null && !f.reserve))
      .map(f => f.id);
  const ring = s.initiative.length ? s.initiative : livingSeats(s).slice().sort((a, b) => a - b);
  const si = ring.indexOf(stepperSeat);
  const order = si >= 0 ? [...ring.slice(si), ...ring.slice(0, si)] : ring;
  const queue = order.map(seat => ({ seat, figureIds: eligible(seat) })).filter(q => q.figureIds.length > 0);
  if (queue.length === 0) {
    s.glyphs = s.glyphs.filter(g => g.at !== at); // temporary — nothing to do, it fades
    pushLog(s, 'glyph', mode === 'curse' ? 'Massive Curse — no figures on the field.' : 'Resurrection — no fallen to raise.');
    delete s.pendingChoice;
    return;
  }
  s.pendingChoice = { kind: 'roll_ceremony', mode, seat: queue[0].seat, at, queue, selectedFigureId: null, results: [], risers: [] };
}

/** Apply ONE ceremony roll to its selected figure, record it, and advance the queue. Mutates `s`.
 *  Curse: a 1 destroys the figure (its Spirit, if any, is handled by the caller's win/Spirit check).
 *  Resurrect: a 20 marks it a riser (placed later via `openSturlaPlacement`). Closes the ceremony
 *  when every figure has rolled — removing the temporary glyph, then opening the Sturla placement
 *  queue (resurrect) and checking the elimination win (curse). */
function applyCeremonyRoll(s: HSState, pc: Extract<HSPendingChoice, { kind: 'roll_ceremony' }>, figureId: string, d20: number): void {
  const fig = s.figures.find(f => f.id === figureId);
  const label = fig ? figureLabel(s, fig) : 'A figure';
  let outcome: 'died' | 'rose' | 'safe' = 'safe';
  // Glyph of Lodin: +1 to EVERY d20 the figure's owner rolls (owner ruling 2026-06-24: "Lodin applies
  // to ALL d20 rolls"). So a Lodin-holder's figures are curse-IMMUNE (a 1 becomes a 2) and resurrect on
  // a 19+. `eff` is the value the outcome is decided on; the die still shows the raw roll.
  const lodin = lodinD20Bonus(s, fig?.ownerSeat ?? pc.seat);
  const eff = d20 + lodin;
  const lodinNote = lodin > 0 ? ` (+${lodin} Lodin → ${eff})` : '';
  if (pc.mode === 'curse') {
    if (eff === 1 && fig && fig.at != null) {
      fig.at = null; fig.at2 = null; outcome = 'died';
      maybeQueueSpiritOnDestroy(s, fig); // a cursed Finn/Thorgrim/Eldgrim still leaves its Spirit
      pushLog(s, 'glyph', `Massive Curse — ${playerName(s, fig.ownerSeat)} rolls 1 for ${label} — it is DESTROYED!`);
    } else {
      pushLog(s, 'glyph', `Massive Curse — ${fig ? playerName(s, fig.ownerSeat) : '?'} rolls ${d20}${lodinNote} for ${label} — it resists.`);
    }
  } else {
    if (eff >= 20 && fig && fig.at == null) {
      pc.risers.push(figureId); outcome = 'rose';
      pushLog(s, 'glyph', `Resurrection — ${playerName(s, fig.ownerSeat)} rolls ${d20}${lodinNote} for ${label} — it RISES! Place it in your start zone.`);
    } else {
      pushLog(s, 'glyph', `Resurrection — ${fig ? playerName(s, fig.ownerSeat) : '?'} rolls ${d20}${lodinNote} for ${label} (needs 20) — it stays fallen.`);
    }
  }
  pc.results.push({ figureId, seat: fig?.ownerSeat ?? pc.seat, d20, lodin, outcome });
  setLastRoll(s, {
    title: pc.mode === 'curse' ? 'Glyph of Mitonsoul — Massive Curse' : 'Glyph of Sturla — Resurrection',
    dice: [d20],
    success: outcome !== 'safe',
    detail: outcome === 'died' ? `${label} is destroyed!` : outcome === 'rose' ? `${label} rises!` : `${label} — ${d20}${lodinNote}`,
  });
  // Drop the rolled figure from the current owner's list; advance past any drained owner.
  pc.queue[0].figureIds = pc.queue[0].figureIds.filter(id => id !== figureId);
  while (pc.queue.length > 0 && pc.queue[0].figureIds.length === 0) pc.queue.shift();
  pc.selectedFigureId = null;
  if (pc.queue.length > 0) {
    pc.seat = pc.queue[0].seat; // next roller (its owner); the pending object stays open
    return;
  }
  // Ceremony over — remove the temporary glyph, then resolve the aftermath.
  s.glyphs = s.glyphs.filter(g => g.at !== pc.at);
  delete s.pendingChoice;
  if (pc.mode === 'resurrect') {
    openSturlaPlacement(s, pc.risers); // each riser placed FRESH by its owner
  } else {
    checkEliminationWin(s); // a curse can wipe a side
  }
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
  // "End move" was tapped — the player committed to the ATTACK phase, so no figure
  // may move for the rest of this turn (Berserker Charge clears this to re-grant moves).
  if (state.movementEnded) {
    return { error: 'Movement is over — you ended your move step' };
  }
  // Water Clone is the card's attack-step action — once used, the turn's
  // movement is likewise over (slice 4).
  if (state.waterClonedThisTurn) {
    return { error: 'Movement is over — the Marro Warriors Water Cloned this turn' };
  }
  // GLOBAL "after moving" rule: a power used in the after-moving / before-attacking window ENDS
  // the move step — you cannot go back and move once you've used one (rules-fidelity; the card
  // text reads "After moving and before attacking…"). These three each "do NOT use the attack",
  // so unlike the special ATTACKS (Fire Line / Grenade / Queglix / Ice Shard / Wild Swing / Acid
  // Breath, which register a turnAttack and are caught above) they need their own gate here.
  // Berserker Charge is deliberately ABSENT: it RE-GRANTS movement (by clearing movedFigureIds).
  if (state.mindShackleSpent || state.threwThisTurn || state.chompedThisTurn) {
    return { error: 'Movement is over — you used an after-moving power this turn' };
  }
  if (state.movedFigureIds.includes(figureId)) {
    return { error: 'That figure has already moved this turn' };
  }
  // GLYPH OF PROFTAKA (trap): a figure standing on Proftaka can't move unless a FRIENDLY
  // figure occupies an adjacent space.
  if (figureStandsOnGlyph(state, fig, 'proftaka') && !hasFriendlyAdjacent(state, fig)) {
    return { error: 'Trapped by the Glyph of Proftaka — a friendly figure must be adjacent to move' };
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

/**
 * Simple-move destinations for a DOUBLE-SPACE figure (the approved "foundation"
 * model — not the strict snake path yet). The figure may lead with EITHER end,
 * so we union the single-hex reachable sets from its two spaces, then keep a
 * lead L (within Move) that has at least one empty SAME-LEVEL neighbour T for
 * its trailing space — it ends on {L, T}. Its own two spaces count as free (it
 * vacates them). Returns the legal LEAD hexes + the deterministic tail per lead
 * (orientation isn't player-selectable yet).
 */
function movementDestinations2(
  state: HSState,
  fig: Figure,
  moveOverride?: number,
): { leads: Set<HexKey>; tailOf: Map<HexKey, HexKey>; reach: Set<HexKey> } {
  const out = { leads: new Set<HexKey>(), tailOf: new Map<HexKey, HexKey>(), reach: new Set<HexKey>() };
  const map = MAPS[state.mapId];
  if (!map || fig.at == null) return out;
  const def = cardDefFor(state, fig);
  const move = moveOverride ?? effectiveMove(state, fig).dice;
  const occ = occupancyLookup(state, fig); // excludes the mover's BOTH hexes
  const opts = { glyphHexes: glyphHexSet(state), flyer: effectiveFlying(state, def), ghostWalk: !!def.ghostWalk };
  const reach = out.reach;
  for (const start of figureHexes(fig)) {
    for (const k of reachableDestinations(map.cells, start, move, occ, def.height, opts)) reach.add(k);
  }
  const isFree = (k: HexKey) => !!map.cells[k] && occ(k) == null; // mover's own hexes read null → free
  const origin = figureHexes(fig); // the figure's pre-move footprint (for the trailing default)
  const distToOrigin = (k: HexKey) => Math.min(...origin.map(o => hexDistance(o, k)));
  // Enemies this figure is engaged with at the START of the move. When non-empty, the trailing
  // default below is OVERRIDDEN to prefer an orientation that KEEPS the figure engaged with as many
  // of them as possible — so a 2-hex figure can reach a space (e.g. a glyph) and STAY ENGAGED when
  // geometry allows, instead of being forced to disengage (owner report 2026-06-24). Empty (the common
  // case) → no engagement work, identical trailing behaviour to before.
  const startEngaged = def.disengage ? [] : enemiesEngagedWith(state, fig);
  const keptEngaged = (lead: HexKey, tail: HexKey): number =>
    startEngaged.length === 0 ? 0 : startEngaged.filter(e => engagedPair(state, { ...fig, at: lead, at2: tail }, e)).length;
  for (const lead of reach) {
    if (!isFree(lead)) continue;
    const lh = map.cells[lead].height;
    // Candidate trailing lobes: free, same-level neighbours the figure could ALSO
    // reach this move (∈ reach, or one of its current hexes) — the SAME anti-spin
    // bound moveTailOptions enforces, so the default placement can never jut the
    // peanut a hex PAST the paid reach (that was the "white dragon moves 7" bug:
    // the old code took the first neighbour, e.g. the hex one step FORWARD of the
    // destination, with no reach check). Excludes the current no-move placement.
    const cands = neighborKeys(lead).filter(
      t =>
        t !== lead &&
        map.cells[t] &&
        map.cells[t].height === lh && // a 2-hex figure RESTS LEVEL — both lobes same height, FLYERS INCLUDED (owner ruling 2026-06-25)
        isFree(t) &&
        (reach.has(t) || t === fig.at || t === fig.at2) && // anti-spin
        !((lead === fig.at && t === fig.at2) || (lead === fig.at2 && t === fig.at)),
    );
    if (cands.length === 0) continue; // no legal in-reach tail → not a legal lead at all
    // Choose the trailing lobe: PREFER the orientation that preserves the most start-engagement (so a
    // figure engaged with a foe STAYS engaged after it lands — e.g. reaching a glyph beside an enemy);
    // tie-break by TRAIL — the candidate nearest where the figure came from, so an un-engaged peanut
    // still follows BEHIND the lead (no spin), exactly as before.
    const tail = cands.reduce((a, b) => {
      const ka = keptEngaged(lead, a), kb = keptEngaged(lead, b);
      if (kb !== ka) return kb > ka ? b : a;
      return distToOrigin(b) < distToOrigin(a) ? b : a;
    });
    out.leads.add(lead);
    out.tailOf.set(lead, tail);
  }
  return out;
}
/** The trailing hex a double-space figure's move to `to` will occupy (same
 *  deterministic choice the highlight used), or null if `to` is not a legal
 *  lead for it right now. */
function moveTailFor(state: HSState, fig: Figure, to: HexKey): HexKey | null {
  return movementDestinations2(state, fig).tailOf.get(to) ?? null;
}

/** DOUBLE-SPACE only: the legal trailing-hex ORIENTATIONS for a landing `lead` —
 *  the set the player chooses among on the 2nd click. ANTI-SPIN by construction:
 *  a tail may only sit on a free, same-level neighbour of `lead` that the figure
 *  could ALSO reach this move (∈ reach, or one of its current hexes). So no
 *  orientation ever extends the peanut past what its Move paid for — you can't
 *  spin a full turn to steal an extra hex of reach. Excludes the figure's CURRENT
 *  placement (that's a no-move). Empty for a 1-hex figure or a lead it can't reach. */
export function moveTailOptions(state: HSState, figureId: string, lead: HexKey): Set<HexKey> {
  const out = new Set<HexKey>();
  const fig = state.figures.find(f => f.id === figureId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return out;
  if (baseSizeOf(cardDefFor(state, fig)) !== 2) return out;
  const { leads, reach } = movementDestinations2(state, fig);
  if (!leads.has(lead) || !map.cells[lead]) return out; // not a legal lead right now
  const occ = occupancyLookup(state, fig); // the mover's own two hexes read free
  const lh = map.cells[lead].height;
  const reachable = (k: HexKey) => reach.has(k) || k === fig.at || k === fig.at2;
  for (const t of neighborKeys(lead)) {
    if (t === lead || !map.cells[t]) continue;
    if (map.cells[t].height !== lh) continue;          // a 2-hex figure rests LEVEL (flyers too — owner ruling 2026-06-25)
    if (occ(t) != null) continue;                      // another figure is there
    if (!reachable(t)) continue;                       // ANTI-SPIN: tail stays within paid reach
    if ((lead === fig.at && t === fig.at2) || (lead === fig.at2 && t === fig.at)) continue; // no-move
    out.add(t);
  }
  return out;
}

function movementDestinations(state: HSState, fig: Figure): Set<HexKey> {
  const map = MAPS[state.mapId];
  if (!map || fig.at == null) return new Set();
  const def = cardDefFor(state, fig);
  // A double-space figure ends on two same-level hexes — its legal "destinations"
  // are the legal LEAD hexes (the trailing hex follows deterministically).
  if (baseSizeOf(def) === 2) return movementDestinations2(state, fig).leads;
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
    flyer: effectiveFlying(state, def),
    ghostWalk: !!def.ghostWalk,
  });
}

function occupancyLookup(state: HSState, mover: Figure): (key: HexKey) => Occupancy {
  const byHex = new Map<HexKey, number>();
  for (const f of state.figures) {
    if (f.id === mover.id) continue;
    for (const k of figureHexes(f)) byHex.set(k, f.ownerSeat);
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
  to2?: HexKey,
): { tier: FallTier; fallDice: number; abandonedEnemyIds: string[] } {
  const from = fig.at;
  const map = MAPS[state.mapId];
  const def = cardDefFor(state, fig);
  const cardHeight = def.height;
  // A double-space figure derives its trailing destination the same way the
  // mover does, so the server's dice-need and the engine's apply agree.
  const destTail =
    baseSizeOf(def) === 2 ? (to2 ?? moveTailFor(state, fig, to) ?? null) : null;

  // Fall: a figure rests level, so drop = its rest level − the destination
  // level (for a 1-hex figure this is height(from) − height(to)); none onto
  // water. A FLYER descends rather than falling (cards.md).
  let tier: FallTier = 'none';
  let fallDice = 0;
  if (!effectiveFlying(state, def)) {
    const drop = from != null ? figureStandLevel(state, fig) - heightOfKey(state, to) : 0;
    const intoWater = map?.cells[to]?.terrain === 'water';
    const fall = computeFall(Math.max(0, drop), cardHeight, intoWater);
    tier = fall.tier;
    fallDice = fall.dice;
  }

  // Leaving engagement: enemies engaged at move START that the DESTINATION
  // footprint {to, to2} is no longer adjacent-engaged to. DISENGAGE (Agent Carr)
  // suppresses this entirely — never swiped when leaving (cards.md).
  let abandonedEnemyIds: string[] = [];
  if (!def.disengage) {
    const startEngaged = enemiesEngagedWith(state, fig);
    const figAtDest: Figure = { ...fig, at: to, at2: destTail };
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
  to2Choice?: HexKey,
): HSResult {
  const r = movableFigure(state, figureId);
  if ('error' in r) return r;
  const map = MAPS[state.mapId];
  if (!map.cells[to]) return { error: 'There is no hex there' };
  if (!movementDestinations(state, r.fig).has(to)) {
    return { error: 'That hex is out of reach for this figure' };
  }
  // A double-space figure also lands its trailing hex. The player MAY choose the
  // orientation (2nd click → `to2Choice`); it's validated against the anti-spin
  // option set so a chosen tail can never steal reach. Without a choice the engine
  // resolves it deterministically (legacy single-orientation behaviour).
  const def = cardDefFor(state, r.fig);
  let to2: HexKey | null = null;
  if (baseSizeOf(def) === 2) {
    if (to2Choice != null) {
      if (!moveTailOptions(state, figureId, to).has(to2Choice)) {
        return { error: 'That orientation is not legal for this move' };
      }
      to2 = to2Choice;
    } else {
      to2 = moveTailFor(state, r.fig, to);
    }
    if (to2 == null) return { error: 'That hex is out of reach for this figure' };
  }
  // Reachability passed → resolve the move (dice validation + execution) through
  // the shared path Grapple Gun also uses. "moves to" is the normal-move log.
  return applyValidatedMove(state, figureId, to, { fallRoll, extremeFallD20, leaveRolls, to2 }, 'moves to');
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
/** UNDO the last move this turn (repeatable) — pops `moveHistory` and restores that
 *  pre-move snapshot, a full rewind incl. any leaving-engagement/fall dice. Allowed
 *  only for the active seat during 'turns', only while the stack is non-empty and no
 *  attack has been made (the dispatcher also clears the stack on any commit). */
function doUndoMove(state: HSState, seat: number): HSResult {
  if (state.subPhase !== 'turns') return { error: 'No move to undo right now' };
  if (state.turnSeat !== seat) return { error: 'Not your turn' };
  if (state.turnAttacks.length > 0) return { error: 'You cannot undo a move after attacking' };
  const hist = state.moveHistory ?? [];
  if (hist.length === 0) return { error: 'Nothing to undo' };
  let prev: HSState;
  try {
    prev = JSON.parse(hist[hist.length - 1]) as HSState;
  } catch {
    return { error: 'The move could not be undone (corrupt snapshot)' };
  }
  prev.moveHistory = hist.slice(0, -1); // keep the rest of the stack for further undos
  return prev;
}

function applyValidatedMove(
  state: HSState,
  figureId: string,
  to: HexKey,
  rolls: {
    fallRoll?: CombatFace[];
    extremeFallD20?: number;
    leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
    /** Trailing destination hex for a double-space mover (null for 1-hex). */
    to2?: HexKey | null;
  },
  verb: string,
): HSResult {
  const mover = state.figures.find(f => f.id === figureId)!;
  const { fallRoll, extremeFallD20, leaveRolls } = rolls;
  const { tier, fallDice, abandonedEnemyIds } = moveConsequences(state, mover, to, rolls.to2 ?? undefined);

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
  // Movement UNDO: push a snapshot of the PRE-move state (with the history itself
  // stripped, so snapshots never nest) onto the stack `undo_move` pops. This makes
  // the move a full rewind — including the swipe/fall dice resolved below.
  s.moveHistory = [...(state.moveHistory ?? []), JSON.stringify({ ...state, moveHistory: undefined })];
  const fig = s.figures.find(f => f.id === figureId)!;
  const moverLabel = figureLabel(s, fig);
  const fromKey = fig.at;
  fig.at = to;
  fig.at2 = rolls.to2 ?? null; // double-space trailing hex (null for 1-hex)
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
  // Surface the swipe(s) in the dice overlay — they resolve mid-move and otherwise
  // only show in the log, so the player never SEES the roll.
  if (gotSwipe.length > 0) {
    const swipeDice = gotSwipe.map(lr => lr.roll);
    const sk = swipeDice.filter(f => f === 'skull').length;
    s.lastAttack = {
      attackerId: gotSwipe[0].enemyFigureId,
      targetId: fig.id,
      attackerLabel: 'Leaving-engagement swipe',
      targetLabel: moverLabel,
      attackRoll: swipeDice,
      defenseRoll: [],
      skulls: sk,
      shields: 0,
      wounds: sk,
      destroyed: fig.at == null,
      seq: (s.lastAttack?.seq ?? 0) + 1,
    };
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
    const glyphsBefore = JSON.stringify(s.glyphs ?? []);
    applyGlyphOnStop(s, fig);
    // If this move REVEALED/triggered a glyph (a hidden glyph flipped face-up, a temporary glyph
    // fired and was removed, or a choice opened), the move is NO LONGER UNDOABLE — un-revealing a
    // glyph or replaying its one-shot effect would be an exploit. Drop the undo stack.
    if (JSON.stringify(s.glyphs ?? []) !== glyphsBefore || s.pendingChoice) {
      s.moveHistory = [];
    }
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

// ============================================================================
// STEP-BY-STEP movement (tap each space) — walk one hex at a time.
// A figure walks a single adjacent hex per `move_step`; `state.stepMove` tracks
// the in-progress walk so it can keep going until it stops (any other action
// finalizes it). Leaving-engagement swipes fire PER STEP — each enemy engaged at
// the walk's START swipes the step it stops being adjacent (once each), so
// leaving AND returning still provokes it. Agent Carr (Ghost Walk) may step
// THROUGH an occupied hex but must finalize on an empty one. A 2-hex figure
// SLITHERS: the front lobe (either end) leads to `to`, the back follows into the
// just-vacated hex, staying on one level.
// ============================================================================

/** The footprint after stepping the figure's FRONT to `to`. 1-hex → just `to`.
 *  2-hex → front lands `to`, back follows into the front's old hex; either lobe
 *  may be the front (whichever `to` is adjacent to). null if `to` isn't a single
 *  step from a lobe. */
function stepFootprint(
  state: HSState,
  fig: Figure,
  to: HexKey,
): { newAt: HexKey; newAt2: HexKey | null; frontOld: HexKey } | null {
  const def = cardDefFor(state, fig);
  if (baseSizeOf(def) === 2) {
    if (fig.at != null && fig.at !== to && fig.at2 !== to && neighborKeys(fig.at).includes(to)) {
      return { newAt: to, newAt2: fig.at, frontOld: fig.at }; // lead with `at`
    }
    if (fig.at2 != null && fig.at2 !== to && fig.at !== to && neighborKeys(fig.at2).includes(to)) {
      return { newAt: to, newAt2: fig.at2, frontOld: fig.at2 }; // lead with `at2`
    }
    return null;
  }
  if (fig.at != null && neighborKeys(fig.at).includes(to)) {
    return { newAt: to, newAt2: null, frontOld: fig.at };
  }
  return null;
}

/** Per-STEP consequences of walking `figureId`'s front to `to`: the resulting
 *  footprint, the step's cost + forced-stop, the start-engaged enemies this step
 *  LEAVES (one swipe die each), and the fall this single step triggers. The ONE
 *  source for the board's legal-step set, the server's dice need, and the engine
 *  apply, so they can't disagree. Returns `{ error }` if the step is illegal. */
export function stepConsequences(
  state: HSState,
  figureId: string,
  to: HexKey,
):
  | {
      newAt: HexKey;
      newAt2: HexKey | null;
      cost: number;
      forcedStop: boolean;
      leavingEnemyIds: string[];
      tier: FallTier;
      fallDice: number;
    }
  | { error: string } {
  const fig = state.figures.find(f => f.id === figureId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return { error: 'No such figure on the battlefield' };
  if (!map.cells[to]) return { error: 'There is no hex there' };
  const def = cardDefFor(state, fig);
  const is2 = baseSizeOf(def) === 2;
  const fp = stepFootprint(state, fig, to);
  if (!fp) return { error: 'That space is not a single step for this figure' };
  // A 2-hex figure may climb/descend DURING a move — a ground figure within its normal climb limit
  // (enforced by dragStep below), a flyer ignoring elevation entirely. It only has to be LEVEL when
  // it STOPS, which is checked at finalize (finalizeStepMove), NOT per step. So no same-level gate here.
  const occ = occupancyLookup(state, fig);
  // A peanut can't share a hex (no ghost-walk slither); the lead must be empty.
  if (is2 && occ(to) !== null) return { error: 'That space is occupied' };
  const sm = state.stepMove?.figureId === figureId ? state.stepMove : null;
  const startHex = sm?.startHex ?? fp.frontOld;
  const step = dragStep(map.cells, startHex, fp.frontOld, to, occ, def.height, {
    glyphHexes: glyphHexSet(state),
    flyer: effectiveFlying(state, def),
    ghostWalk: !!def.ghostWalk,
    doubleSpace: is2, // a 2-hex front may traverse water; the water-STOP is decided below (both lobes)
  });
  if (!step) return { error: 'You can’t step there' };
  // Kelda admits only a WOUNDED figure as a stop; a forced-stop step onto it is illegal otherwise.
  const g = glyphAt(state, to);
  if (step.forcedStop && g && g.id === 'kelda' && g.faceUp && fig.wounds < 1) {
    return { error: 'Only a wounded figure may stop on the Glyph of Kelda' };
  }
  // Leaving engagement, judged PER STEP: enemies engaged with the figure's CURRENT footprint
  // that this step LEAVES (no longer engaged after it), minus any that already swiped this walk.
  // Evaluated fresh from the current position, so engaging an enemy MID-walk and then stepping
  // away STILL draws its swipe. DISENGAGE (Agent Carr) suppresses every swipe.
  const figAtNew: Figure = { ...fig, at: fp.newAt, at2: fp.newAt2 };
  const alreadySwiped = sm?.swiped ?? [];
  const leavingEnemyIds = def.disengage
    ? []
    : enemiesEngagedWith(state, fig)
        .filter(e => !alreadySwiped.includes(e.id) && !engagedPair(state, figAtNew, e))
        .map(e => e.id);
  // Fall: only a descending 1-hex step falls (2-hex falling is deferred; a flyer descends, never falls).
  let tier: FallTier = 'none';
  let fallDice = 0;
  if (!effectiveFlying(state, def) && !is2) {
    const drop = heightOfKey(state, fp.frontOld) - heightOfKey(state, to);
    const intoWater = map.cells[to]?.terrain === 'water';
    const f = computeFall(Math.max(0, drop), def.height, intoWater);
    tier = f.tier;
    fallDice = f.dice;
  }
  // A 2-hex figure stops for water only when BOTH new lobes end in water (the front entering water
  // alone keeps moving). A flyer never water-stops. (1-hex water-stop is already in step.forcedStop.)
  const bothWater = is2 && !effectiveFlying(state, def)
    && map.cells[fp.newAt]?.terrain === 'water'
    && fp.newAt2 != null && map.cells[fp.newAt2]?.terrain === 'water';
  return {
    newAt: fp.newAt,
    newAt2: fp.newAt2,
    cost: step.cost,
    forcedStop: step.forcedStop || bothWater,
    leavingEnemyIds,
    tier,
    fallDice,
  };
}

/** The hexes `figureId` may step to RIGHT NOW (one tap) — neighbours of each lobe
 *  that pass `stepConsequences` within the REMAINING Move budget. The board
 *  highlights these; recomputed every render so they update after each step. */
export function legalStepHexes(state: HSState, figureId: string): Set<HexKey> {
  const out = new Set<HexKey>();
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return out;
  const sm = state.stepMove?.figureId === figureId ? state.stepMove : null;
  if (sm?.stopped) return out; // a water/glyph forced this figure to stop
  // A different figure being mid-walk is fine — selecting this one finalizes that
  // walk (it ended where it stands), so we still preview THIS figure's first steps.
  if ('error' in movableFigure(state, figureId)) return out;
  const budget = effectiveMove(state, fig).dice - (sm?.usedCost ?? 0);
  const seen = new Set<HexKey>();
  for (const lobe of figureHexes(fig)) {
    for (const n of neighborKeys(lobe)) {
      if (seen.has(n)) continue;
      seen.add(n);
      const c = stepConsequences(state, figureId, n);
      if (!('error' in c) && c.cost <= budget) out.add(n);
    }
  }
  return out;
}

/** The full set of hexes `figureId` could still reach with its REMAINING Move from
 *  where it currently stands — the dim "max distance" backdrop the board paints
 *  behind the bright single-step targets. It SHRINKS as the figure walks (current
 *  hex + `effectiveMove − stepMove.usedCost`). Empty when the figure can't move, a
 *  forced-stop ended its walk, or it has no Move left. Reuses the same Dijkstra
 *  reach as a normal full-Move destination preview. */
export function movementRangeHexes(state: HSState, figureId: string): Set<HexKey> {
  const fig = state.figures.find(f => f.id === figureId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return new Set();
  if ('error' in movableFigure(state, figureId)) return new Set();
  const sm = state.stepMove?.figureId === figureId ? state.stepMove : null;
  if (sm?.stopped) return new Set();
  const remaining = effectiveMove(state, fig).dice - (sm?.usedCost ?? 0);
  if (remaining <= 0) return new Set();
  const def = cardDefFor(state, fig);
  if (baseSizeOf(def) === 2) return movementDestinations2(state, fig, remaining).leads;
  const canEndOn = (key: HexKey): boolean => {
    const g = glyphAt(state, key);
    if (g && g.id === 'kelda' && g.faceUp && fig.wounds < 1) return false;
    return true;
  };
  return reachableDestinations(map.cells, fig.at, remaining, occupancyLookup(state, fig), def.height, {
    glyphHexes: glyphHexSet(state),
    canEndOn,
    flyer: effectiveFlying(state, def),
    ghostWalk: !!def.ghostWalk,
  });
}

/** "Smart movement" classifier: among a figure's reachable destinations, the ones
 *  whose ENDPOINT leaves at least one enemy it is engaged with at the start of the
 *  move — reaching them provokes a leaving-engagement swipe (03-movement §8: a figure
 *  that ends "no longer adjacent" to a start-engaged enemy is attacked). The board
 *  marks these RED and the rest GREEN. Empty when the figure isn't engaged or has
 *  Disengage (Agent Carr never provokes). Reuses `moveConsequences`, so the red
 *  warning matches EXACTLY the swipes `doMove` will roll on arrival. */
export function disengageMoveHexes(state: HSState, figureId: string): Set<HexKey> {
  const out = new Set<HexKey>();
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return out;
  if (cardDefFor(state, fig).disengage) return out; // Agent Carr — never swiped
  if (enemiesEngagedWith(state, fig).length === 0) return out; // not engaged → every hex safe
  for (const to of movementRangeHexes(state, figureId)) {
    if (moveConsequences(state, fig, to).abandonedEnemyIds.length > 0) out.add(to);
  }
  return out;
}

/** Finalize the in-progress walk: lock the figure as "moved" (so it can't start a
 *  new walk) and clear `stepMove`. Rejects if the figure is still mid-pass-through
 *  on an occupied hex — Agent Carr must end on an empty space. */
function finalizeStepMove(state: HSState): HSState | { error: string } {
  const sm = state.stepMove;
  if (!sm) return state;
  const fig = state.figures.find(f => f.id === sm.figureId);
  const s = clone(state);
  delete s.stepMove;
  if (fig && fig.at != null) {
    const occ = occupancyLookup(state, fig);
    if (figureHexes(fig).some(h => occ(h) !== null)) {
      return { error: 'Finish the move on an empty space first' };
    }
    // A 2-hex figure may climb/descend mid-move but must STOP on two LEVEL spaces.
    if (fig.at2 != null && heightOfKey(state, fig.at) !== heightOfKey(state, fig.at2)) {
      return { error: 'Finish a double-space figure on two level spaces' };
    }
    if (!s.movedFigureIds.includes(sm.figureId)) s.movedFigureIds.push(sm.figureId);
  }
  return s;
}

/** Walk a figure ONE adjacent hex (tap-to-step). Validates the step + the
 *  server-rolled per-step swipe/fall dice, applies the swipes (a kill ends the
 *  walk), the fall, then moves the figure and updates `stepMove`. Switching to a
 *  different figure finalizes the one already walking. */
function doMoveStep(
  state: HSState,
  seat: number,
  action: {
    figureId: string;
    to: HexKey;
    fallRoll?: CombatFace[];
    extremeFallD20?: number;
    leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
  },
): HSResult {
  const { figureId, to } = action;
  // A new figure ⇒ finalize the one mid-walk first (it stopped where it stands).
  let base: HSState = state;
  if (state.stepMove && state.stepMove.figureId !== figureId) {
    const fin = finalizeStepMove(state);
    if ('error' in fin) return fin;
    base = fin;
  }
  const r = movableFigure(base, figureId);
  if ('error' in r) return r;
  const fig = r.fig;
  const sm = base.stepMove?.figureId === figureId ? base.stepMove : null;
  if (sm?.stopped) return { error: 'This figure has stopped — a water/glyph space ended its move' };

  const cons = stepConsequences(base, figureId, to);
  if ('error' in cons) return cons;

  const def = cardDefFor(base, fig);
  const usedCost = sm?.usedCost ?? 0;
  if (usedCost + cons.cost > effectiveMove(base, fig).dice) {
    return { error: 'That’s beyond this figure’s Move' };
  }

  // --- validate falling dice (mirror applyValidatedMove) ---
  const { fallRoll, extremeFallD20, leaveRolls } = action;
  if (cons.tier === 'extreme') {
    if (fallRoll != null && fallRoll.length > 0) return { error: 'Unexpected fall dice for an extreme fall' };
    if (!Number.isInteger(extremeFallD20) || extremeFallD20! < 1 || extremeFallD20! > 20) {
      return { error: 'Extreme fall requires a d20 roll (1-20)' };
    }
  } else {
    if (extremeFallD20 != null) return { error: 'Unexpected d20 roll — this is not an extreme fall' };
    if (!validFaces(fallRoll ?? [], cons.fallDice)) {
      return { error: cons.fallDice > 0 ? `This step requires ${cons.fallDice} fall die roll(s)` : 'Unexpected fall dice — no fall is due' };
    }
  }
  // --- validate the leaving-engagement swipe set matches exactly ---
  const want = new Set(cons.leavingEnemyIds);
  const got = leaveRolls ?? [];
  if (got.length !== want.size) return { error: 'Leaving-engagement rolls do not match the abandoned enemies' };
  for (const lr of got) {
    if (!want.has(lr.enemyFigureId)) return { error: `${lr.enemyFigureId} is not a leaving-engagement attacker for this step` };
    if (lr.roll !== 'skull' && lr.roll !== 'shield' && lr.roll !== 'blank') return { error: 'Malformed leaving-engagement roll' };
  }
  if (new Set(got.map(lr => lr.enemyFigureId)).size !== got.length) return { error: 'Duplicate leaving-engagement attacker' };

  const s = clone(base);
  const firstStep = !sm;
  if (firstStep) {
    // Whole-move undo: snapshot the PRE-walk state (history + stepMove stripped so snapshots don't nest).
    s.moveHistory = [...(base.moveHistory ?? []), JSON.stringify({ ...base, moveHistory: undefined, stepMove: undefined })];
  }
  const f = s.figures.find(x => x.id === figureId)!;
  const moverLabel = figureLabel(s, f);
  const fromKey = f.at!;
  const walkOrigin = sm?.startHex ?? fromKey;
  f.at = cons.newAt;
  f.at2 = cons.newAt2;
  // Collapse the whole walk into ONE log line that grows "origin → current" as the
  // figure steps, instead of a line per hex. The first step pushes the line; later
  // steps rewrite that same entry in place (found by its seq) so movement stays at
  // a single line no matter how far the figure walks.
  const moveText = `${moverLabel} moves ${hexLabel(walkOrigin)} → ${hexLabel(cons.newAt)}.`;
  const prevMoveEntry = sm?.moveLogSeq != null ? s.log.find(e => e.seq === sm.moveLogSeq) : undefined;
  if (prevMoveEntry) prevMoveEntry.text = moveText;
  else pushLog(s, 'move', moveText);
  const moveLogSeq = prevMoveEntry ? prevMoveEntry.seq : s.logSeq;

  // --- leaving-engagement swipes resolve as the figure steps away (1 unblockable
  // wound per skull); a swipe that kills the mover ends the walk before any fall. ---
  for (const lr of got) {
    if (f.at == null) break;
    const enemy = s.figures.find(x => x.id === lr.enemyFigureId);
    const enemyLabel = enemy ? figureLabel(s, enemy) : 'an enemy';
    if (lr.roll === 'skull') {
      f.wounds += 1;
      const dead = f.wounds >= cardDefFor(s, f).life;
      if (dead) { f.at = null; f.at2 = null; }
      pushLog(s, 'fall', `${enemyLabel} takes a leaving-engagement swipe at ${moverLabel} — 1 wound${dead ? `, ${moverLabel} is destroyed!` : '.'}`);
    } else {
      pushLog(s, 'fall', `${enemyLabel} swipes at ${moverLabel} as it leaves — miss.`);
    }
  }
  if (got.length > 0) {
    const dice = got.map(lr => lr.roll);
    const sk = dice.filter(d => d === 'skull').length;
    s.lastAttack = {
      attackerId: got[0].enemyFigureId,
      targetId: f.id,
      attackerLabel: 'Leaving-engagement swipe',
      targetLabel: moverLabel,
      attackRoll: dice,
      defenseRoll: [],
      skulls: sk,
      shields: 0,
      wounds: sk,
      destroyed: f.at == null,
      seq: (s.lastAttack?.seq ?? 0) + 1,
    };
  }

  // --- falling resolves after landing (skipped if a swipe already killed the mover). ---
  if (f.at != null && cons.tier !== 'none') {
    applyFall(s, f, fromKey, cons.newAt, cons.tier, fallRoll ?? [], extremeFallD20);
  }
  // --- glyph effect on stopping (a forced-stop step ends ON the glyph). ---
  if (f.at != null && f.at === cons.newAt) applyGlyphOnStop(s, f);

  // --- advance / finalize the walk ---
  if (f.at == null) {
    // Destroyed mid-walk → the move is over and locked.
    delete s.stepMove;
    if (!s.movedFigureIds.includes(figureId)) s.movedFigureIds.push(figureId);
  } else {
    // Record this step's swiped enemies so each draws at most one swipe across the whole walk.
    const swiped = [...(sm?.swiped ?? []), ...cons.leavingEnemyIds];
    s.stepMove = {
      figureId,
      usedCost: usedCost + cons.cost,
      startHex: sm?.startHex ?? fromKey,
      swiped,
      stopped: cons.forcedStop || undefined,
      moveLogSeq,
    };
  }

  checkEliminationWin(s);
  if (f.at == null && f.wounds >= cardDefFor(s, f).life) maybeQueueSpiritOnDestroy(s, f);
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
/** Glyph ids whose effect opens a player CHOICE (a pendingChoice). Only one choice can be open
 *  at a time, so a second such glyph hit in the SAME move (a 2-hex figure on two, or a carried
 *  passenger) is revealed but its effect is deferred rather than lost-silently. */
const GLYPH_OPENS_CHOICE: ReadonlySet<HSGlyphId> = new Set(['mitonsoul', 'sturla', 'oreld', 'erland', 'nilrend']);

/** Fire EVERY glyph under a figure's footprint when it stops — a 2-hex figure (Braxas, Theracus)
 *  can sit on more than one, and they should ALL trigger (not just the first). The carried
 *  passenger of a Carry move is a separate figure and gets its own call (doCarryMove). */
function applyGlyphOnStop(s: HSState, fig: Figure): void {
  const glyphs = figureHexes(fig).map(h => glyphAt(s, h)).filter((x): x is HSGlyph => x != null);
  for (const g of glyphs) {
    // A 2nd choice-glyph can't open while one is already pending — reveal it, defer its effect.
    if (s.pendingChoice && GLYPH_OPENS_CHOICE.has(g.id)) {
      if (!g.faceUp) {
        g.faceUp = true;
        pushLog(s, 'glyph', `${figureLabel(s, fig)} also reveals the ${HS_GLYPHS[g.id].name} — its effect waits for the open choice.`);
      }
      continue;
    }
    applyOneGlyph(s, fig, g);
  }
}

/** Apply ONE revealed glyph's effect to the figure that stopped on it. */
function applyOneGlyph(s: HSState, fig: Figure, g: HSGlyph): void {
  // A glyph starts HIDDEN (face-down); the instant a figure stops on it, flip it face-up — only
  // then can it take effect (the stat helpers + seatControlsGlyph all gate on faceUp).
  if (!g.faceUp) {
    g.faceUp = true;
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals a hidden glyph — the ${HS_GLYPHS[g.id].name}!`);
  }
  const def = HS_GLYPHS[g.id];
  if (g.id === 'kelda') {
    // Kelda heals a WOUNDED figure once, then fades. An unwounded figure that happened to reveal it
    // leaves it in play (face-up) for a wounded figure to use later.
    if (fig.wounds > 0) {
      const healed = fig.wounds;
      fig.wounds = 0;
      s.glyphs = s.glyphs.filter(x => x.at !== g.at);
      pushLog(
        s,
        'glyph',
        `${figureLabel(s, fig)} stops on the Glyph of Kelda — healed of ${healed} wound${healed === 1 ? '' : 's'}; the glyph fades.`,
      );
    }
    return;
  }
  if (g.id === 'mitonsoul') {
    // Massive Curse — every LIVING figure rolls a d20; a 1 destroys it. Opens the interactive
    // ROLL CEREMONY (owners roll their own figures one at a time, all watching, in turn order).
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Mitonsoul — a Massive Curse sweeps the field!`);
    openRollCeremony(s, 'curse', g.at, fig.ownerSeat);
    return;
  }
  if (g.id === 'sturla') {
    // Resurrection — every DESTROYED figure rolls a d20; a 20 raises it FRESH (its owner then
    // places it via glyph_sturla_place). Opens the interactive ROLL CEREMONY (owners roll their
    // own fallen one at a time, all watching, in turn order); fizzles if no one has fallen.
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Sturla — the fallen may rise!`);
    openRollCeremony(s, 'resurrect', g.at, fig.ownerSeat);
    return;
  }
  if (g.id === 'oreld') {
    // Remove Marker — a PUBLIC two-step (mirrors Wannok). STEP 1: the action layer rolls the
    // controller's d20 (the engine never rolls). On a 1 it backfires onto the controller; on 2+
    // the controller then NAMES a player to lose an unrevealed order marker. Open the choice with
    // d20 unrolled.
    s.pendingChoice = { kind: 'glyph_oreld', seat: fig.ownerSeat, at: g.at, d20: null };
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Oreld — roll a d20 to steal a turn!`);
    return;
  }
  if (g.id === 'erland') {
    // Summoning (temporary) — pure teleport. The controller (stopper) picks ANY single-hex
    // figure on the board and an EMPTY space adjacent to the figure on the glyph; it moves
    // there with no swipes/fall. Fizzle (remove, no effect) when there is no one to summon
    // or no empty adjacent space. Resolved by the human/AI via a glyph_erland choice.
    const dests = emptyNeighborsOf(s, fig);
    const summonable = s.figures.filter(o => o.at != null && o.at2 == null && o.id !== fig.id);
    if (dests.length === 0 || summonable.length === 0) {
      s.glyphs = s.glyphs.filter(x => x.at !== g.at);
      pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Erland — but there is no one to summon. It fades.`);
      return;
    }
    s.pendingChoice = { kind: 'glyph_erland', seat: fig.ownerSeat, at: g.at, summonerFigureId: fig.id };
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Erland — summon any figure to an adjacent space!`);
    return;
  }
  if (g.id === 'nilrend') {
    // Negation (temporary) — the action layer rolls the controller's d20 (recorded into the
    // pending), THEN the controller picks a UNIQUE card to negate for the game: one of their
    // own on a 1, any opponent's on 2+. Candidates = unique cards (not Common) with a living
    // figure, not already negated. `d20:null` until the server rolls it.
    const myTeam = teamOfSeat(s, fig.ownerSeat);
    const isUnique = (c: ArmyCardInstance) => !effectiveCardDef(c.cardId, s.edition)?.common;
    const cardsWhere = (pred: (c: ArmyCardInstance) => boolean) =>
      s.cards.filter(c => pred(c) && isUnique(c) && cardHasLivingFigures(s, c.uid) && !isCardNegated(s, c.uid)).map(c => c.uid);
    s.pendingChoice = {
      kind: 'glyph_nilrend',
      seat: fig.ownerSeat,
      at: g.at,
      d20: null,
      ownCardUids: cardsWhere(c => c.ownerSeat === fig.ownerSeat),
      foeCardUids: cardsWhere(c => teamOfSeat(s, c.ownerSeat) !== myTeam),
    };
    pushLog(s, 'glyph', `${figureLabel(s, fig)} reveals the Glyph of Nilrend — a unique figure's powers will be negated!`);
    return;
  }
  if (def.kind === 'permanent' && def.active) {
    pushLog(s, 'glyph', `${figureLabel(s, fig)} claims the ${def.name} — ${def.effect}`);
    return;
  }
  // Deferred / inert glyph (Brandar artifact): a forced stop with no effect (scenario-only).
  pushLog(s, 'glyph', `${figureLabel(s, fig)} stops on the ${def.name} — no effect yet.`);
}

/** Empty, on-map spaces adjacent to `fig` (either lobe of a 2-hex figure), excluding the
 *  figure's own hexes, any occupied hex, and any glyph hex — the legal landings for a
 *  Glyph of Erland summon (pure teleport; height/engagement ignored). */
function emptyNeighborsOf(s: HSState, fig: Figure): HexKey[] {
  const cells = MAPS[s.mapId]?.cells;
  if (!cells) return [];
  const own = new Set(figureHexes(fig));
  const occupied = new Set(s.figures.flatMap(f => figureHexes(f)));
  const onGlyph = new Set((s.glyphs ?? []).map(g => g.at));
  const out = new Set<HexKey>();
  for (const h of figureHexes(fig)) {
    for (const n of neighborKeys(h)) {
      if (cells[n] && !occupied.has(n) && !onGlyph.has(n) && !own.has(n)) out.add(n);
    }
  }
  return [...out];
}

/** Board helper — the EMPTY adjacent spaces a Glyph of Erland summon may land on (only
 *  meaningful while a glyph_erland choice is open). Empty otherwise. */
export function erlandDestinations(state: HSState): HexKey[] {
  const pc = state.pendingChoice;
  if (!pc || pc.kind !== 'glyph_erland') return [];
  const summoner = state.figures.find(f => f.id === pc.summonerFigureId);
  return summoner ? emptyNeighborsOf(state, summoner) : [];
}

/** Board helper — the figure ids a Glyph of Erland may summon (any single-hex figure on
 *  the board other than the figure standing on the glyph). Empty unless a choice is open. */
export function erlandSummonableIds(state: HSState): string[] {
  const pc = state.pendingChoice;
  if (!pc || pc.kind !== 'glyph_erland') return [];
  return state.figures.filter(o => o.at != null && o.at2 == null && o.id !== pc.summonerFigureId).map(o => o.id);
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
    const survived = ((extremeFallD20 ?? 0) + lodinD20Bonus(s, fig.ownerSeat)) >= 19;
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
function maxAttacks(state: HSState, fig: Figure): number {
  if (isCardNegated(state, fig.cardUid)) return 1; // Nilrend: Double Attack negated
  return cardDefFor(state, fig).id === SYVARRIS_CARD_ID ? 2 : 1;
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
  if (attacksThisTurn(state, attackerId) >= maxAttacks(state, fig)) {
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
 *  attack — threaded for the slice-8 Thorian Speed
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

  // GLYPH OF THORIAN: while a seat controls the glyph, opponents must be ADJACENT to make
  // a NORMAL attack on ANY of that seat's figures (army-wide Thorian Speed). Special attacks
  // are unrestricted (isNormalAttack === false skips this).
  if (
    isNormalAttack &&
    seatControlsGlyph(state, target.ownerSeat, 'thorian') &&
    !figuresAdjacent(state, attacker, target)
  ) {
    return 'Thorian glyph — must be adjacent to attack this figure';
  }

  const range = effectiveRange(state, attacker).dice;
  // MELEE (Range 1) requires TRUE adjacency, which honours the elevation exception: a figure on a
  // tall ledge is NOT adjacent to one far below even though their hexes touch, so it can't melee it
  // (03-movement line 127). Plain hex-distance ≤ 1 would wrongly allow it. Adjacent figures always
  // have clear LOS, so no separate LOS check is needed here.
  if (range <= 1) {
    return figuresAdjacent(state, attacker, target) ? null : 'Out of range — melee must be adjacent';
  }
  // A double-space figure measures range and traces LOS from EITHER of its two
  // spaces, to EITHER of the target's — the owner gets the better end (04-combat).
  // Figures do NOT block line of sight — only terrain does (on-map obstacles may
  // come later) — so the tracer is given no figure blockers.
  const eye = attackerEyeFn(state, attacker); // height-aware: a taller figure sees over low land/walls
  let inRange = false;
  for (const ak of figureHexes(attacker)) {
    for (const tk of figureHexes(target)) {
      const dist = rangeDistance(map.cells, ak, tk);
      if (dist == null || dist > range) continue;
      inRange = true;
      if (hasLineOfSight3D(map.cells, ak, tk, [], eye)) return null;
    }
  }
  return inRange
    ? 'No line of sight — terrain or a figure is in the way'
    : `Out of range (Range ${range})`;
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
  if (
    def.id === AGENT_CARR_CARD_ID &&
    !isCardNegated(state, attacker.cardUid) && // Nilrend negates Carr's own power
    isNormalAttack &&
    figuresAdjacent(state, attacker, target)
  ) {
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
  if (
    def.id === ZETTIAN_CARD_ID &&
    !isCardNegated(state, attacker.cardUid) && // Nilrend negates Zettian Targeting
    zettianTargetingApplies(state, attacker, target)
  ) {
    dice += 1;
    breakdown.push('+1 Zettian Targeting');
  }
  // Astrid: +1 attack die for a NORMAL attack ONLY. Special attacks (Fire Line,
  // Explosion, Acid Breath, …) don't call this helper at all, but gate explicitly
  // on isNormalAttack so the printed "normal attack" restriction is self-documenting
  // and survives any future caller.
  const astridN = isNormalAttack ? seatGlyphCount(state, attacker.ownerSeat, 'astrid') : 0;
  if (astridN > 0) {
    dice += astridN;
    breakdown.push(`+${astridN} Astrid`);
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
 *                              player controls within 4 clear-sight spaces of a
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
  // Raelin's DEFENSIVE AURA (RotV card): +2 defense dice to every figure the
  // same player controls within 4 clear-sight spaces of a living Raelin (Raelin
  // herself excluded — handled in raelinAuraReaches). Recomputed from positions;
  // stacks with Thorgrim / Gerda / height.
  if (raelinAuraReaches(state, defender)) {
    dice += RAELIN_AURA_BONUS;
    breakdown.push(`+${RAELIN_AURA_BONUS} Raelin aura`);
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
  const gerdaN = seatGlyphCount(state, defender.ownerSeat, 'gerda');
  if (gerdaN > 0) {
    dice += gerdaN;
    breakdown.push(`+${gerdaN} Gerda`);
  }
  // Glyph of Jalgard — TWO extra defense dice PER copy (a stronger Gerda). Stacks with Gerda and
  // with itself. Army-wide while occupied.
  const jalgardN = seatGlyphCount(state, defender.ownerSeat, 'jalgard');
  if (jalgardN > 0) {
    dice += jalgardN * 2;
    breakdown.push(`+${jalgardN * 2} Jalgard`);
  }
  return { dice, breakdown };
}

/** Figures CURRENTLY benefiting from a friendly POSITION aura — Finn (an adjacent friendly Range-1
 *  figure, +1 attack), Thorgrim (any adjacent friendly, +1 defense), Raelin (a friendly within 4
 *  clear-sight spaces, +1 defense, not herself), and Grimnak (an adjacent friendly Orc Warrior, +1
 *  attack & defense). Reuses the SAME predicates the effective-stat folds use, so the board's
 *  "aura active" ring can never disagree with the bonus actually applied. Excludes per-attack
 *  effects (Zettian Targeting), self bonuses (Agent Carr's Sword of Reckoning), and the Krav/Izumi
 *  defensive reactions — none are standing position auras. UI-only. */
export function auraBuffedFigureIds(state: HSState): Set<string> {
  const out = new Set<string>();
  for (const f of state.figures) {
    if (f.at == null) continue;
    const def = cardDefFor(state, f);
    const buffed =
      (def.range === 1 && hasFiguresAdjacentLivingCard(state, f, FINN_CARD_ID, f.ownerSeat)) ||
      hasFiguresAdjacentLivingCard(state, f, THORGRIM_CARD_ID, f.ownerSeat) ||
      raelinAuraReaches(state, f) ||
      (def.species === SPECIES_ORC &&
        def.unitClass === CLASS_WARRIORS &&
        hasFiguresAdjacentLivingCard(state, f, GRIMNAK_CARD_ID, f.ownerSeat));
    if (buffed) out.add(f.id);
  }
  return out;
}

/** The HEXES every living, non-negated aura SOURCE on the board reaches — the area a
 *  friendly figure standing there would be buffed in. Drives the board's always-on GOLD
 *  aura outline (so you can see, e.g., exactly where Raelin's +2 defense lands and watch it
 *  move with her). Geometry mirrors the stat folds: Raelin = within `RAELIN_AURA_RANGE`
 *  range-spaces + clear LOS; Finn/Thorgrim/Grimnak = the source's hex-neighbours. Includes
 *  every owner's auras (it's a reach indicator, not an ownership one). Recomputed from
 *  positions; a Nilrend-negated source contributes nothing (it grants no aura). */
export function auraCoverageHexes(state: HSState): Set<HexKey> {
  const out = new Set<HexKey>();
  const map = MAPS[state.mapId];
  if (!map) return out;
  for (const src of state.figures) {
    if (src.at == null || isCardNegated(state, src.cardUid)) continue;
    const id = cardDefFor(state, src).id;
    const isAura = id === RAELIN_CARD_ID || id === FINN_CARD_ID || id === THORGRIM_CARD_ID || id === GRIMNAK_CARD_ID;
    if (id === RAELIN_CARD_ID) {
      // Cast from Raelin's tall flyer eye (her Height), matching raelinAuraReaches — so the gold
      // coverage line and the actual +2 defence agree, and low terrain doesn't wrongly clip it.
      const raelinEye = heightOfKey(state, src.at) + cardDefFor(state, src).height;
      for (const h of Object.keys(map.cells)) {
        if (h === src.at) continue;
        const d = rangeDistance(map.cells, src.at, h);
        if (d == null || d > RAELIN_AURA_RANGE) continue;
        if (hasLineOfSight3D(map.cells, src.at, h, [], (k: HexKey) => k === src.at ? raelinEye : eyeHeightOfKey(state, k))) out.add(h);
      }
    } else if (id === FINN_CARD_ID || id === THORGRIM_CARD_ID || id === GRIMNAK_CARD_ID) {
      for (const lobe of figureHexes(src)) {
        for (const n of neighborKeys(lobe)) {
          if (map.cells[n] && n !== src.at && n !== src.at2) out.add(n);
        }
      }
    }
    // Include the source's OWN footprint in the visual coverage so the outline has no hole where
    // the figure stands — i.e. ONE outer perimeter, not an extra inner ring around the aura figure
    // (board clutter). This set drives only the gold outline; the actual buff is auraBuffedFigureIds.
    if (isAura) for (const lobe of figureHexes(src)) out.add(lobe);
  }
  return out;
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
  // Eldgrim's Warrior's Swiftness Spirit — a permanent +1 move per Spirit placed on this card.
  const swift = cardModFor(state, fig).moveMod;
  if (swift !== 0) { move += swift; breakdown.push(`${swift > 0 ? '+' : ''}${swift} Swiftness Spirit`); }
  // Glyph of Valda — +2 move PER controlled copy, EXCEPT the one this figure is moving off (no boost
  // on the move that leaves a Valda). Stacks if the seat holds more than one. Footprint-aware, so a
  // 2-hex tail on Valda also counts as "on it".
  if (HS_GLYPHS.valda?.active) {
    const valdaN = (state.glyphs ?? []).filter(g =>
      g.id === 'valda' && g.faceUp &&
      state.figures.some(f => f.ownerSeat === fig.ownerSeat && figureHexes(f).includes(g.at)) &&
      !figureHexes(fig).includes(g.at), // not the Valda THIS figure is leaving
    ).length;
    if (valdaN > 0) { move += 2 * valdaN; breakdown.push(`+${2 * valdaN} Valda`); }
    else if ((state.glyphs ?? []).some(g => g.id === 'valda' && figureHexes(fig).includes(g.at))) {
      breakdown.push('(no Valda bonus moving off the glyph)');
    }
  }
  return { dice: move, breakdown };
}

/**
 * Effective RANGE for `fig` (05-glyphs / cards.md):
 *   printed Range
 *   + Glyph of Ivor          (+2 ONLY if printed Range ≥ 4 AND seat controls Ivor)
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
  const ivorN = def.range >= 4 ? seatGlyphCount(state, fig.ownerSeat, 'ivor') : 0;
  if (ivorN > 0) {
    range += 2 * ivorN;
    breakdown.push(`+${2 * ivorN} Ivor`);
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

/** The "shooting envelope" for a RANGED figure: every hex within its effective Range
 *  (counted around gaps), PLUS the figure's own footprint, so the UI can keep that
 *  island bright and dim everything beyond — the edge marks the furthest hex the
 *  figure could shoot from where it stands. Recompute as it steps and the envelope
 *  follows. Range-only (no line-of-sight), so it's the figure's REACH, not a
 *  guaranteed clear shot. Empty for a melee figure (Range ≤ 1) — nothing to preview. */
export function shootingRangeHexes(state: HSState, figureId: string): Set<HexKey> {
  const fig = state.figures.find(f => f.id === figureId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return new Set();
  const range = effectiveRange(state, fig).dice;
  if (range <= 1) return new Set();
  const foot = figureHexes(fig);
  const out = rangeFlood(map.cells, foot, range);
  for (const k of foot) out.add(k); // keep the figure's own hexes bright
  return out;
}

/** The BLOCKED subset of a ranged figure's shooting envelope: hexes within Range
 *  (so they're in `shootingRangeHexes`) but with NO clear line of sight from the
 *  figure — a wall or tall column sits between. The board greys these so "in range"
 *  no longer implies "can shoot". LOS is TERRAIN-ONLY (occupiedKeys = []), so the
 *  overlay tracks the map's walls and doesn't flicker as figures shuffle around (it
 *  is a reach preview, not a live to-hit check). A double-space figure sees from the
 *  BETTER of its two hexes (matches Range, which is measured from either end). Empty
 *  for a melee figure. Mirrors `shootingRangeHexes`'s reach so the two sets align. */
export function shootBlockedHexes(state: HSState, figureId: string): Set<HexKey> {
  const out = new Set<HexKey>();
  const fig = state.figures.find(f => f.id === figureId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return out;
  const range = effectiveRange(state, fig).dice;
  if (range <= 1) return out;
  const foot = figureHexes(fig);
  const footSet = new Set(foot);
  const eye = attackerEyeFn(state, fig); // height-aware: a taller figure sees over low land/walls
  for (const k of rangeFlood(map.cells, foot, range)) {
    if (footSet.has(k)) continue; // the figure's own hexes are always "clear"
    if (!foot.some(jk => hasLineOfSight3D(map.cells, jk, k, [], eye))) out.add(k);
  }
  return out;
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

// ============================================================================
// SPECIAL ATTACKS (slice 8) — Mimring's FIRE LINE.
//
// A special attack's ATTACK roll is never modified by glyphs, other powers, or
// height (04-combat §117 — the unmodifiable rule constrains the ATTACKER only):
// it is a flat printed value. The DEFENDER, however, keeps its FULL defense —
// defensive powers/auras AND height advantage (a defender on high ground still
// gets +1, per the §117 Samurai example). The attack is
// rolled ONCE for all affected figures; each affected figure rolls defense
// SEPARATELY. Fire Line hits EVERY figure (friend OR foe) on a straight line of
// 8 spaces from Mimring that he has line of sight to.
// ============================================================================
const FIRE_LINE_LEN = 8;
const FIRE_LINE_ATTACK = 4;

/** Only Mimring has Fire Line, and only when he could otherwise attack — it IS
 *  his attack (it spends his turn's attack and ends his movement). */
export function canFireLine(state: HSState, attackerId: string): boolean {
  if (activeCardNegated(state)) return false; // Glyph of Nilrend
  const r = attackReadyFigure(state, attackerId);
  if ('error' in r) return false;
  return cardDefFor(state, r.fig).id === 'mimring';
}

/** On-map spaces of the Fire Line in hex direction `dir` (0-5) from Mimring. */
export function fireLineSpaces(state: HSState, attackerId: string, dir: number, origin?: HexKey): HexKey[] {
  const fig = state.figures.find(f => f.id === attackerId);
  const map = MAPS[state.mapId];
  if (!fig || fig.at == null || !map) return [];
  // A 2-hex dragon (Mimring) may fire from EITHER lobe — the line starts at `origin` when it's one
  // of the figure's hexes, else the lead. Gives both straight rows out of each base.
  const start = origin && figureHexes(fig).includes(origin) ? origin : fig.at;
  return hexLine(start, dir, FIRE_LINE_LEN).filter(k => !!map.cells[k]);
}

/** Figures the Fire Line affects: any figure (friend OR foe, never Mimring) on a
 *  line space he has clear, elevation-aware line of sight to. Figures do NOT
 *  block the line — the fire passes through them, so everyone on the straight
 *  line is hit unless TERRAIN / height breaks the sightline. */
export function fireLineTargets(state: HSState, attackerId: string, dir: number, origin?: HexKey): Figure[] {
  const attacker = state.figures.find(f => f.id === attackerId);
  const map = MAPS[state.mapId];
  if (!attacker || attacker.at == null || !map) return [];
  const spaces = new Set(fireLineSpaces(state, attackerId, dir, origin));
  if (spaces.size === 0) return [];
  const aHexes = figureHexes(attacker);
  // Mimring is a HUGE dragon, so his fire line is cast from HIS height (not the default hex+1
  // ground eye) — it clears low hills/land the way a towering figure would, instead of being
  // wrongly blocked by terrain it plainly sees over. Only the tall wall pillars stop it. (Same
  // height-aware sight as Raelin's aura.) Source hexes use the dragon's eye; targets stay normal.
  const atkH = cardDefFor(state, attacker).height;
  const eye = (k: HexKey) => (aHexes.includes(k) ? heightOfKey(state, k) + atkH : eyeHeightOfKey(state, k));
  const out: Figure[] = [];
  for (const f of state.figures) {
    if (f.id === attacker.id || f.at == null) continue;
    const onLine = figureHexes(f).filter(h => spaces.has(h));
    if (onLine.length === 0) continue;
    // A LINE special attack's fire passes THROUGH figures — only TERRAIN / height
    // blocks the straight line, never an intervening figure. So every figure on
    // the line that Mimring can see past walls/columns is hit (an enemy standing
    // in front no longer shields the figures behind it). Hence NO figure
    // occluders in the LOS check — just elevation-aware terrain.
    const sighted = onLine.some(th => aHexes.some(ah => hasLineOfSight3D(map.cells, ah, th, [], eye)));
    if (sighted) out.push(f);
  }
  return out;
}

/** Per-defender defense dice for the SERVER to roll: printed defense + defensive
 *  auras/glyphs, but NO height advantage (special attack). */
export function fireLineDefenders(
  state: HSState,
  attackerId: string,
  dir: number,
  origin?: HexKey,
): { figureId: string; defense: number }[] {
  const attacker = state.figures.find(f => f.id === attackerId);
  if (!attacker) return [];
  return fireLineTargets(state, attackerId, dir, origin).map(t => {
    // Keep the defender's FULL dice incl. height — only the ATTACKER's special-attack roll is
    // unmodifiable (05-glyphs §117). (Was stripping height; Ice Shard/Queglix/Wild Swing keep it.)
    return { figureId: t.id, defense: effectiveDefenseDice(state, t, attacker).dice };
  });
}

function doFireLine(
  state: HSState,
  action: {
    attackerId: string;
    dir: number;
    origin?: HexKey;
    attackRoll: CombatFace[];
    defenseRolls: { figureId: string; roll: CombatFace[] }[];
  },
): HSResult {
  const r = attackReadyFigure(state, action.attackerId);
  if ('error' in r) return r;
  const attacker = r.fig;
  if (cardDefFor(state, attacker).id !== 'mimring') {
    return { error: 'Only Mimring has the Fire Line Special Attack' };
  }
  if (!Number.isInteger(action.dir) || action.dir < 0 || action.dir > 5) {
    return { error: 'Invalid Fire Line direction' };
  }
  // The line may be cast from EITHER lobe of the 2-hex dragon — `origin` must be one of its hexes.
  if (action.origin != null && !figureHexes(attacker).includes(action.origin)) {
    return { error: 'Fire Line must start from one of the figure\'s own hexes' };
  }
  if (!validFaces(action.attackRoll, FIRE_LINE_ATTACK)) {
    return { error: 'Malformed Fire Line attack roll' };
  }
  // Re-derive the affected set + each defender's dice (server-authoritative) and
  // validate the supplied rolls match it exactly.
  const defenders = fireLineDefenders(state, action.attackerId, action.dir, action.origin);
  const got = new Map(action.defenseRolls.map(d => [d.figureId, d.roll] as const));
  if (got.size !== action.defenseRolls.length) return { error: 'Duplicate Fire Line defender' };
  if (defenders.length !== action.defenseRolls.length) return { error: 'Fire Line defender set mismatch' };
  for (const d of defenders) {
    const roll = got.get(d.figureId);
    if (!roll || !validFaces(roll, d.defense)) return { error: 'Malformed Fire Line defense roll' };
  }

  const skulls = countFaces(action.attackRoll, 'skull');
  const s = clone(state);
  const mover = s.figures.find(f => f.id === attacker.id)!;
  // Spend Mimring's attack: movement is over and he can't attack again this turn.
  s.turnAttacks.push({ attackerId: attacker.id, targetId: defenders[0]?.figureId ?? attacker.id });

  const results: string[] = [];
  const defenseGroups: NonNullable<HSState['lastAttack']>['defenseGroups'] = [];
  let totalWounds = 0;
  for (const d of defenders) {
    const roll = got.get(d.figureId)!;
    const shields = countFaces(roll, 'shield');
    const t = s.figures.find(f => f.id === d.figureId);
    if (!t) continue;
    const w = specialAttackWounds(s, attacker, t, skulls, shields);
    t.wounds += w;
    totalWounds += w;
    const tDef = cardDefFor(s, t);
    const destroyed = t.wounds >= tDef.life;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    const label = figureLabel(s, t);
    defenseGroups.push({ label, roll, shields, wounds: w, destroyed });
    results.push(
      `${label} (${shields} shield${shields === 1 ? '' : 's'}) — ${destroyed ? 'destroyed!' : w > 0 ? `${w} wound${w === 1 ? '' : 's'}` : 'blocked'}`,
    );
  }

  s.lastAttack = {
    attackerId: attacker.id,
    targetId: defenders[0]?.figureId ?? attacker.id,
    attackerLabel: figureLabel(s, mover),
    targetLabel: `Fire Line — ${defenders.length} figure${defenders.length === 1 ? '' : 's'}`,
    attackRoll: action.attackRoll,
    defenseRoll: [],
    defenseGroups,
    skulls,
    shields: 0,
    wounds: totalWounds,
    destroyed: false,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: ['Fire Line Special Attack', `Attack ${FIRE_LINE_ATTACK} (special — no height / aura)`],
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `${figureLabel(s, mover)} unleashes the Fire Line (${skulls} skull${skulls === 1 ? '' : 's'}): ${results.length ? results.join('; ') : 'no figures in the line'}.`,
  );
  setEffect(s, 'fire_line', action.origin ?? mover.at, fireLineSpaces(state, attacker.id, action.dir, action.origin)); // tunnel of fire down the line from the firing lobe
  checkEliminationWin(s); // a lethal line can remove a seat's last figures
  return s;
}

// ============================================================================
// Deathwalker 9000 EXPLOSION SPECIAL ATTACK (cards.md) — Range 7, Attack 3.
// Choose an enemy figure in clear sight within Range 7; the target AND every
// figure adjacent to it (friend OR foe — INCLUDING Deathwalker himself) are hit.
// 3 attack dice rolled ONCE for all affected; each defends separately. Special
// attack → flat printed Attack (unmodifiable); defenders KEEP their full defense
// incl. height advantage (§117 constrains the attacker only).
// ============================================================================
const EXPLOSION_RANGE = 7;
const EXPLOSION_ATTACK = 3;

/** Enemy figures Deathwalker may Explode: within Range 7 AND in clear (elevation-
 *  aware) line of sight. The splash to adjacent figures needs no separate sight. */
export function explosionTargets(state: HSState, attackerId: string): string[] {
  const dw = state.figures.find(f => f.id === attackerId);
  const map = MAPS[state.mapId];
  if (!dw || dw.at == null || !map) return [];
  // Deathwalker is a TALL figure, so his Explosion sight is cast from HIS height (not the default
  // hex+1 ground eye) — it clears low hills/land the way a towering figure would, instead of being
  // wrongly blocked by terrain it plainly sees over. Only tall wall pillars stop it. (Same
  // height-aware sight as Mimring's Fire Line + Raelin's aura.) Source hexes use his eye; targets normal.
  const atkH = cardDefFor(state, dw).height;
  const aHexes = figureHexes(dw);
  const eye = (k: HexKey) => (aHexes.includes(k) ? heightOfKey(state, k) + atkH : eyeHeightOfKey(state, k));
  const out: string[] = [];
  for (const f of state.figures) {
    if (f.id === dw.id || f.at == null || f.ownerSeat === dw.ownerSeat) continue;
    const reachable = figureHexes(f).some(th =>
      aHexes.some(ah => {
        const d = rangeDistance(map.cells, ah, th);
        return d != null && d <= EXPLOSION_RANGE && hasLineOfSight3D(map.cells, ah, th, [], eye);
      }),
    );
    if (reachable) out.push(f.id);
  }
  return out;
}

/** The figures an Explosion at `targetId` AFFECTS — the target plus every figure
 *  adjacent to it (friend OR foe, INCLUDING Deathwalker if he is adjacent — he
 *  "can be affected by his own explosion") — with each one's defense dice (printed
 *  + auras, NO height: special attack). */
export function explosionDefenders(
  state: HSState,
  attackerId: string,
  targetId: string,
): { figureId: string; defense: number }[] {
  const dw = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!dw || !target || target.at == null) return [];
  const affected = new Map<string, Figure>([[target.id, target]]);
  for (const f of state.figures) {
    if (f.at == null || f.id === target.id) continue;
    if (figuresAdjacent(state, target, f)) affected.set(f.id, f); // incl. Deathwalker (self-hit allowed)
  }
  return [...affected.values()].map(t => {
    // Keep the defender's FULL dice incl. height — only the ATTACKER's special-attack roll is
    // unmodifiable (05-glyphs §117). (Was stripping height; Ice Shard/Queglix/Wild Swing keep it.)
    return { figureId: t.id, defense: effectiveDefenseDice(state, t, dw).dice };
  });
}

/** Can the active Deathwalker Explode now (card active, hasn't attacked, ≥1 enemy
 *  in range + sight)? The board shows the control + highlights the targets. */
export function canExplosion(state: HSState, seat: number): boolean {
  if (activeCardNegated(state)) return false; // Glyph of Nilrend
  if (state.subPhase !== 'turns' || state.turnSeat !== seat || state.turnAttacks.length > 0 || state.pendingChoice) {
    return false;
  }
  const active = state.cards.find(c => c.uid === getActiveCardUid(state));
  if (!active || active.cardId !== DEATHWALKER_CARD_ID) return false;
  const dw = state.figures.find(f => f.cardUid === active.uid && f.at != null);
  return !!dw && explosionTargets(state, dw.id).length > 0;
}

function doExplosion(
  state: HSState,
  action: {
    attackerId: string;
    targetId: string;
    attackRoll: CombatFace[];
    defenseRolls: { figureId: string; roll: CombatFace[] }[];
  },
): HSResult {
  const r = attackReadyFigure(state, action.attackerId);
  if ('error' in r) return r;
  const attacker = r.fig;
  if (cardDefFor(state, attacker).id !== DEATHWALKER_CARD_ID) {
    return { error: 'Only Deathwalker 9000 has the Explosion Special Attack' };
  }
  if (!explosionTargets(state, attacker.id).includes(action.targetId)) {
    return { error: 'Explosion target must be an enemy in clear sight within Range 7' };
  }
  if (!validFaces(action.attackRoll, EXPLOSION_ATTACK)) {
    return { error: 'Malformed Explosion attack roll' };
  }
  // Re-derive the affected set + each defender's dice (server-authoritative) and
  // validate the supplied rolls match it exactly.
  const defenders = explosionDefenders(state, attacker.id, action.targetId);
  const got = new Map(action.defenseRolls.map(d => [d.figureId, d.roll] as const));
  if (got.size !== action.defenseRolls.length) return { error: 'Duplicate Explosion defender' };
  if (defenders.length !== action.defenseRolls.length) return { error: 'Explosion defender set mismatch' };
  for (const d of defenders) {
    const roll = got.get(d.figureId);
    if (!roll || !validFaces(roll, d.defense)) return { error: 'Malformed Explosion defense roll' };
  }

  const skulls = countFaces(action.attackRoll, 'skull');
  const s = clone(state);
  const mover = s.figures.find(f => f.id === attacker.id)!;
  s.turnAttacks.push({ attackerId: attacker.id, targetId: action.targetId }); // the special IS the attack
  const results: string[] = [];
  const defenseGroups: NonNullable<HSState['lastAttack']>['defenseGroups'] = [];
  let totalWounds = 0;
  for (const d of defenders) {
    const roll = got.get(d.figureId)!;
    const shields = countFaces(roll, 'shield');
    const t = s.figures.find(f => f.id === d.figureId);
    if (!t) continue;
    const w = specialAttackWounds(s, attacker, t, skulls, shields);
    t.wounds += w;
    totalWounds += w;
    const tDef = cardDefFor(s, t);
    const destroyed = t.wounds >= tDef.life;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    const label = figureLabel(s, t);
    defenseGroups.push({ label, roll, shields, wounds: w, destroyed });
    results.push(
      `${label} (${shields} shield${shields === 1 ? '' : 's'}) — ${destroyed ? 'destroyed!' : w > 0 ? `${w} wound${w === 1 ? '' : 's'}` : 'blocked'}`,
    );
  }
  s.lastAttack = {
    attackerId: attacker.id,
    targetId: action.targetId,
    attackerLabel: figureLabel(s, mover),
    targetLabel: `Explosion — ${defenders.length} figure${defenders.length === 1 ? '' : 's'}`,
    attackRoll: action.attackRoll,
    defenseRoll: [],
    defenseGroups,
    skulls,
    shields: 0,
    wounds: totalWounds,
    destroyed: false,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: ['Explosion Special Attack', `Attack ${EXPLOSION_ATTACK} (special — no height / aura)`],
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `${figureLabel(s, mover)} detonates an Explosion (${skulls} skull${skulls === 1 ? '' : 's'}): ${results.length ? results.join('; ') : 'no figures affected'}.`,
  );
  setEffect(s, 'blast', attacker.at, [state.figures.find(f => f.id === action.targetId)?.at ?? null]); // blast at the target (covers adjacent)
  checkEliminationWin(s);
  return s;
}

// ============================================================================
// Airborne Elite GRENADE SPECIAL ATTACK (slice 8, cards.md) — Range 5, Lob 12,
// Attack 2, ONCE PER GAME. One grenade per living Elite, thrown one at a time:
// choose a figure within Range 5 (no LOS); the target AND every figure adjacent
// to it (friend or foe) are hit. 2 attack dice rolled ONCE for all affected;
// each defends separately. Special attack → the ATTACK is unmodifiable (no height /
// attack-aura / LOS); each DEFENDER still rolls its full effective defense, height
// included (verified §117: Samurai = 5 Def + 1 height = 6 dice vs a special attack).
// ============================================================================
const AIRBORNE_CARD_ID = 'airborne_elite';
const GRENADE_RANGE = 5;
const GRENADE_ATTACK = 2;

/** Figures a given Airborne Elite could lob a grenade at right now: any living
 *  figure (friend OR foe) within Range 5 — NO line of sight needed ("Lob 12";
 *  our map heights never exceed the lob arc). */
export function grenadeTargets(state: HSState, throwerId: string): string[] {
  const thrower = state.figures.find(f => f.id === throwerId);
  const map = MAPS[state.mapId];
  if (!thrower || thrower.at == null || !map) return [];
  const out: string[] = [];
  for (const f of state.figures) {
    if (f.id === thrower.id || f.at == null) continue;
    const within = figureHexes(thrower).some(ah =>
      figureHexes(f).some(th => {
        const d = rangeDistance(map.cells, ah, th);
        return d != null && d <= GRENADE_RANGE;
      }),
    );
    if (within) out.push(f.id);
  }
  return out;
}

/** The figures a grenade thrown at `targetId` AFFECTS — the target plus every
 *  figure adjacent to it (friend OR foe) — with each one's defense dice (printed
 *  + auras, NO height advantage: special attack). */
export function grenadeDefenders(
  state: HSState,
  throwerId: string,
  targetId: string,
): { figureId: string; defense: number }[] {
  const thrower = state.figures.find(f => f.id === throwerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!thrower || !target || target.at == null) return [];
  const affected = new Map<string, Figure>([[target.id, target]]);
  for (const f of state.figures) {
    if (f.at == null || f.id === target.id) continue;
    if (figuresAdjacent(state, target, f)) affected.set(f.id, f);
  }
  return [...affected.values()].map(t => {
    // Keep the defender's FULL dice incl. height — only the ATTACKER's special-attack roll is
    // unmodifiable (05-glyphs §117). (Was stripping height; Ice Shard/Queglix/Wild Swing keep it.)
    return { figureId: t.id, defense: effectiveDefenseDice(state, t, thrower).dice };
  });
}

/** Can the active Airborne Elite throw grenades now — squad active, marker
 *  unused, no attack yet, no open choice, and ≥1 Elite has a figure in range. */
export function canGrenade(state: HSState, seat: number): boolean {
  if (activeCardNegated(state)) return false; // Glyph of Nilrend
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return false;
  if (state.turnAttacks.length > 0 || state.pendingChoice) return false;
  const active = state.cards.find(c => c.uid === getActiveCardUid(state));
  if (!active || active.cardId !== AIRBORNE_CARD_ID || active.grenadeUsed) return false;
  return state.figures
    .filter(f => f.cardUid === active.uid && f.at != null)
    .some(f => grenadeTargets(state, f.id).length > 0);
}

/** INITIATE the grenade: remove the once-per-game marker, spend the squad's
 *  attack, and open the throw sequence (living Elites with a target in range). */
function doGrenade(state: HSState, seat: number): HSResult {
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (!active || active.cardId !== AIRBORNE_CARD_ID) {
    return { error: 'Only Airborne Elite have the Grenade Special Attack' };
  }
  if (active.grenadeUsed) return { error: 'The Grenade Special Attack is once per game (already used)' };
  if (state.turnAttacks.length > 0) {
    return { error: 'The Grenade Special Attack replaces this turn’s attack — you have already attacked' };
  }
  const living = state.figures.filter(f => f.cardUid === activeUid && f.at != null).map(f => f.id);
  if (living.length === 0) return { error: 'No Airborne Elite are on the battlefield' };
  // Re-gate on a TARGET before spending anything: with no Elite within Range 5 of an enemy, the
  // grenade would burn the once-per-game marker AND the squad's whole attack for zero effect (M1).
  if (!living.some(id => grenadeTargets(state, id).length > 0)) {
    return { error: 'No Airborne Elite has a target within Range 5 — the grenade would be wasted' };
  }

  const s = clone(state);
  s.cards.find(c => c.uid === activeUid)!.grenadeUsed = true; // remove the marker (once per game)
  // The Grenade Special Attack IS the SQUAD's attack ("instead of attacking normally") — so EVERY
  // living Elite's attack is spent, not just the first. Mark each so no Elite can normal-attack
  // after the grenade this turn (per-figure attack budget reads turnAttacks).
  for (const id of living) s.turnAttacks.push({ attackerId: id, targetId: id });
  pushLog(s, 'power', `${playerName(s, seat)} pulls the Grenade marker — the Airborne Elite lob grenades one at a time.`);
  const throwers = living.filter(id => grenadeTargets(s, id).length > 0);
  if (throwers.length === 0) {
    pushLog(s, 'power', 'No figures within Range 5 — no grenades are thrown.');
    return s;
  }
  s.pendingChoice = { kind: 'grenade_throw', seat, cardUid: active.uid, throwers };
  return s;
}

/** Resolve the CURRENT Elite's grenade at a chosen Range-5 target; apply the
 *  2-attack-once + per-defender splash, then advance the queue (skipping any
 *  remaining Elite that no longer has a target). */
function doGrenadeThrow(
  state: HSState,
  seat: number,
  action: { targetId: string; attackRoll: CombatFace[]; defenseRolls: { figureId: string; roll: CombatFace[] }[] },
): HSResult {
  const pc = state.pendingChoice;
  if (!pc || pc.kind !== 'grenade_throw') return { error: 'No grenade throw is pending' };
  if (pc.seat !== seat) return { error: 'This grenade belongs to another player' };
  const throwerId = pc.throwers[0];
  const thrower = state.figures.find(f => f.id === throwerId);
  if (!thrower || thrower.at == null) return { error: 'The throwing Elite is no longer on the field' };
  if (!grenadeTargets(state, throwerId).includes(action.targetId)) {
    return { error: 'Choose a figure within Range 5 of the throwing Elite' };
  }
  if (!validFaces(action.attackRoll, GRENADE_ATTACK)) return { error: 'Malformed grenade attack roll' };
  const defenders = grenadeDefenders(state, throwerId, action.targetId);
  const got = new Map(action.defenseRolls.map(d => [d.figureId, d.roll] as const));
  if (got.size !== action.defenseRolls.length) return { error: 'Duplicate grenade defender' };
  if (defenders.length !== action.defenseRolls.length) return { error: 'Grenade defender set mismatch' };
  for (const d of defenders) {
    const roll = got.get(d.figureId);
    if (!roll || !validFaces(roll, d.defense)) return { error: 'Malformed grenade defense roll' };
  }

  const skulls = countFaces(action.attackRoll, 'skull');
  const s = clone(state);
  const results: string[] = [];
  const defenseGroups: NonNullable<HSState['lastAttack']>['defenseGroups'] = [];
  let totalWounds = 0;
  let totalShields = 0;
  for (const d of defenders) {
    const roll = got.get(d.figureId)!;
    const shields = countFaces(roll, 'shield');
    const t = s.figures.find(f => f.id === d.figureId);
    if (!t) continue;
    const w = specialAttackWounds(s, thrower, t, skulls, shields);
    t.wounds += w;
    totalWounds += w;
    totalShields += shields;
    const destroyed = t.wounds >= cardDefFor(s, t).life;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    const label = figureLabel(s, t);
    defenseGroups.push({ label, roll, shields, wounds: w, destroyed });
    // Spell out the math so a partial block reads correctly: N shields cancel N skulls, the rest
    // wound. A Life-1 squad figure dies to even 1 leftover skull — show the wound count on a kill
    // so "1 shield → destroyed" isn't mistaken for "blocked but died anyway".
    const outcome = destroyed
      ? `${w} wound${w === 1 ? '' : 's'} → destroyed!`
      : w > 0 ? `${w} wound${w === 1 ? '' : 's'}` : 'fully blocked';
    results.push(`${label} (${shields} shield${shields === 1 ? '' : 's'} vs ${skulls}) — ${outcome}`);
  }
  s.lastAttack = {
    attackerId: throwerId,
    targetId: action.targetId,
    attackerLabel: figureLabel(s, s.figures.find(f => f.id === throwerId)!),
    targetLabel: `Grenade — ${defenders.length} figure${defenders.length === 1 ? '' : 's'}`,
    attackRoll: action.attackRoll,
    // Each affected figure rolled defense separately against the one shared
    // attack — the overlay reveals each figure's roll in turn via defenseGroups.
    // The flattened defenseRoll remains for the compact side-panel summary.
    defenseRoll: action.defenseRolls.flatMap(d => d.roll),
    defenseGroups,
    skulls,
    shields: totalShields,
    wounds: totalWounds,
    destroyed: false,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: ['Grenade Special Attack', `Attack ${GRENADE_ATTACK} (special — no height / aura / LOS) · each figure defends separately`],
    seq: s.logSeq + 1,
  };
  pushLog(s, 'attack', `Grenade (${skulls} skull${skulls === 1 ? '' : 's'}): ${results.length ? results.join('; ') : 'no effect'}.`);
  setEffect(s, 'blast', thrower.at, [state.figures.find(f => f.id === action.targetId)?.at ?? null]); // grenade blast at the target (covers adjacent)
  checkEliminationWin(s); // a splash can remove a seat's last figures
  if (s.phase !== 'playing') {
    delete s.pendingChoice;
    return s;
  }
  // Advance: drop this thrower; skip any remaining Elite that now has no target.
  const rest = pc.throwers.slice(1).filter(id => {
    const f = s.figures.find(x => x.id === id);
    return f && f.at != null && grenadeTargets(s, id).length > 0;
  });
  if (rest.length === 0) delete s.pendingChoice;
  else s.pendingChoice = { kind: 'grenade_throw', seat, cardUid: pc.cardUid, throwers: rest };
  return s;
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
    setEffect(s, 'counter_strike', target.at, [attacker.at]); // 3D VFX: a blade swipe from the Samurai back at the attacker
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
 * Spirit). When the destroyed figure is Finn or Thorgrim AND the game is still in
 * progress, queue a `spirit_placement` PendingChoice OWNED BY THE DESTROYED
 * CHAMPION'S OWNER (not the attacker). The owner then places the Spirit on ANY
 * living unique Army Card, permanently +1 attack (Finn) or +1 defense (Thorgrim).
 *
 * FIDELITY — the choice is NOT friendly-restricted. The printed card text, verified
 * at high resolution (docs/heroscape/extraction/cards-page-1.md), is exactly "place
 * this figure on any unique Army Card" — no "your". So we offer every unique card
 * with a living figure, regardless of owner. (In practice the owner picks their own;
 * the AI resolver already prefers its own cards. An earlier build wrongly restricted
 * this to own cards and mislabeled it "per the card text" — that was a regression.)
 *
 * Skipped when the game just finished (phase !== 'playing') — no Spirit once a
 * side is wiped (slice-4 spec §Server). Also a no-op if there are no living
 * unique cards to place on (every slice-4 card is a Unique Hero/Squad, so this
 * only bites in pathological wiped-board cases the finish-gate already covers).
 */
function maybeQueueSpiritOnDestroy(s: HSState, destroyed: Figure): void {
  if (s.phase !== 'playing') return; // finish takes precedence
  const cardId = cardDefFor(s, destroyed).id;
  const spirit: 'attack' | 'defense' | 'move' | null =
    cardId === FINN_CARD_ID ? 'attack' : cardId === THORGRIM_CARD_ID ? 'defense' : cardId === ELDGRIM_CARD_ID ? 'move' : null;
  if (!spirit) return;
  // Warrior's Attack/Armor/Swiftness Spirit is a CARD POWER — a Glyph-of-Nilrend-negated card has
  // no powers (base stats only), so a negated Finn/Thorgrim/Eldgrim leaves no Spirit when it dies.
  if (isCardNegated(s, destroyed.cardUid)) return;
  // QUEUE it, never silently drop it. EVERY kill site funnels here — normal AND special attacks,
  // Chomp, falls, leaving-engagement swipes, the Massive Curse — and a champion can die WHILE another
  // choice is open (a grenade-throw queue, the roll ceremony, a prior Spirit) or several can die at
  // once (one Fire Line through two champions). `openNextSpiritIfIdle` drains the queue one at a time
  // whenever no other choice is open; the resolve chokepoints re-drain it as each choice clears.
  (s.pendingSpirits ??= []).push({ seat: destroyed.ownerSeat, spirit, cardId });
  openNextSpiritIfIdle(s);
}

/** Open a `spirit_placement` choice for the next queued Warrior's Spirit when no other choice is
 *  open. Skips a queued Spirit with no living unique Army Card to land on. Called when a Spirit is
 *  queued AND after any choice resolves (so two deaths resolve their Spirits back-to-back, and a
 *  death during a grenade/curse opens its Spirit once that sequence finishes). */
function openNextSpiritIfIdle(s: HSState): void {
  if (s.phase !== 'playing') { s.pendingSpirits = []; return; } // a finished battle places no Spirits
  if (s.pendingChoice) return; // one decision at a time — re-drained when it clears
  while (s.pendingSpirits && s.pendingSpirits.length > 0) {
    const next = s.pendingSpirits.shift()!;
    // "place this figure on any unique Army Card" (verified card text) — every card in play is
    // unique, so offer ALL that still have a living figure, regardless of owner. Not friendly-restricted.
    const options = s.cards.filter(c => cardHasLivingFigures(s, c.uid)).map(c => c.uid);
    if (options.length === 0) continue; // nothing to place it on — drop this one
    s.pendingChoice = { kind: 'spirit_placement', seat: next.seat, spirit: next.spirit, options };
    pushLog(
      s,
      'power',
      `${cardDef(next.cardId).shortName} is destroyed — ${playerName(s, next.seat)} may place the Warrior's ${next.spirit === 'attack' ? 'Attack' : next.spirit === 'defense' ? 'Armor' : 'Swiftness'} Spirit on any unique Army Card.`,
    );
    return;
  }
}

/** After a choice resolves, open the next queued Warrior's Spirit if one is owed and no choice is
 *  now open — so a champion killed during a grenade volley / roll ceremony, or the SECOND of two
 *  champions felled together, gets its Spirit prompt the moment the prior sequence clears. A no-op
 *  on an error result or when nothing is queued. */
function drainSpirits(res: HSResult): HSResult {
  if (!('error' in res)) { openNextSpiritIfIdle(res); openNextWannokIfIdle(res); } // Spirits first, then the next queued Wannok curse
  return res;
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
  // Win = last TEAM standing (teams). The game ends once every living figure
  // belongs to a single team — that team wins even if several of its players
  // are still alive. A solo seat is its own team, so this is "last seat
  // standing" for 1-v-1 / FFA, unchanged.
  const aliveSeats = livingSeats(s); // owner ruling: a team wiped on the board is OUT even with reserve Airborne
  const teamsAlive = new Set(aliveSeats.map(seat => teamOfSeat(s, seat)));
  if (teamsAlive.size > 1) return;
  // 0 or 1 teams remain.
  const winningTeam = [...teamsAlive][0];
  if (winningTeam == null) {
    // True mutual wipe — no figure left on ANY side (e.g. Izumi's Counter Strike destroys the
    // attacker on the same blow whose strike emptied the defender's last team). Finish as a DRAW
    // rather than hang: stalemateResolve also bails at 0 teams, so without this the round loops
    // forever over an empty board (M2).
    s.phase = 'finished';
    s.winnerSeat = null;
    s.winnerTeam = null;
    s.turnSeat = null;
    pushLog(s, 'win', 'Mutual destruction — every army is wiped out. No winner.');
    return;
  }
  // A representative living seat of the winning team (the survivor in 1-v-1).
  const winnerSeat = aliveSeats.find(seat => teamOfSeat(s, seat) === winningTeam)!;
  const teamSeats = s.players.filter(p => teamOfSeat(s, p.seat) === winningTeam);
  s.phase = 'finished';
  s.winnerSeat = winnerSeat;
  s.winnerTeam = winningTeam;
  s.turnSeat = null;
  const who =
    teamSeats.length > 1
      ? `${teamSeats.map(p => playerName(s, p.seat)).join(' & ')} win`
      : `${playerName(s, winnerSeat)} wins`;
  pushLog(s, 'win', `${who} — all rival armies are destroyed!`);
}

const STALEMATE_ROUNDS = 15;
// Absolute backstop — no real game runs anywhere near this many rounds (typical: 8-15).
// Catches an oscillating grind (e.g. Water Clone reviving + losing a figure every few
// rounds) that the no-progress counter alone keeps resetting.
const HARD_ROUND_CAP = 80;

/** Stalemate backstop (digital-only): if NO figure is gained or lost for
 *  STALEMATE_ROUNDS straight rounds, the surviving armies can't reach each other
 *  (e.g. a 2-hex figure stranded on a peak it can't slither off varied terrain, or a
 *  ranged pair walled apart with no line of sight). End the game so it never hangs —
 *  the team with the most surviving FIGURES wins, ties broken by remaining life then
 *  lowest seat. A normal game takes casualties every few rounds, so this never fires
 *  in real play; it is purely a no-progress safety net. */
function stalemateResolve(s: HSState): void {
  if (s.phase !== 'playing') return;
  const seatsAlive = livingSeats(s); // wiped-on-board teams are already eliminated (seatIsAlive)
  const teams = [...new Set(seatsAlive.map(seat => teamOfSeat(s, seat)))];
  if (teams.length <= 1) return; // checkEliminationWin owns the single-team case
  const score = (team: number) => {
    // ON-BOARD figures only — an army that never left RESERVE (Airborne Elite whose Drop never
    // landed) has NOT "survived on the battlefield", so it can't win a stalemate on a figure-count
    // technicality. Owner ruling 2026-06-24: failing The Drop is the Airborne gambit's risk — that
    // team loses; reserve figures must not tip the tiebreak its way.
    const figs = s.figures.filter(f => f.at != null && teamOfSeat(s, f.ownerSeat) === team);
    const life = figs.reduce((sum, f) => sum + Math.max(0, cardDefFor(s, f).life - f.wounds), 0);
    return figs.length * 1000 + life; // figures dominate; remaining life breaks ties
  };
  const bestTeam = teams.reduce((b, t) => (score(t) > score(b) ? t : b), teams[0]);
  const winnerSeat = seatsAlive.filter(seat => teamOfSeat(s, seat) === bestTeam).sort((a, b) => a - b)[0];
  const teamSeats = s.players.filter(p => teamOfSeat(s, p.seat) === bestTeam);
  s.phase = 'finished';
  s.winnerSeat = winnerSeat;
  s.winnerTeam = bestTeam;
  s.turnSeat = null;
  const who = teamSeats.length > 1 ? `${teamSeats.map(p => playerName(s, p.seat)).join(' & ')} win` : `${playerName(s, winnerSeat)} wins`;
  pushLog(s, 'win', `Stalemate — ${STALEMATE_ROUNDS} rounds with no losses; ${who} on the larger surviving army.`);
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
  const lodin = lodinD20Bonus(state, seat); // Glyph of Lodin: +1 to this d20
  const rollNote = lodin ? `${d20}+${lodin} Lodin = ${d20 + lodin}` : `${d20}`;
  if (d20 + lodin >= BERSERKER_THRESHOLD) {
    // Success — offer the optional re-move (never auto-applied).
    s.pendingChoice = { kind: 'berserker_charge', seat, cardUid: activeCard.uid };
    pushLog(
      s,
      'power',
      `Berserker Charge — ${playerName(s, seat)} rolls ${rollNote} (≥${BERSERKER_THRESHOLD})! They may move all Tarn Viking Warriors again.`,
    );
    setLastRoll(s, { title: 'Berserker Charge', dice: [d20], success: true, detail: `${rollNote} (≥${BERSERKER_THRESHOLD}) — move the Vikings again!` });
  } else {
    s.berserkerSpent = true;
    pushLog(
      s,
      'power',
      `Berserker Charge — ${playerName(s, seat)} rolls ${rollNote} (<${BERSERKER_THRESHOLD}). No extra move.`,
    );
    setLastRoll(s, { title: 'Berserker Charge', dice: [d20], success: false, detail: `${rollNote} (<${BERSERKER_THRESHOLD}) — no extra move.` });
  }
  return s;
}

const NE_GOK_SA_CARD_ID = 'ne_gok_sa';

/** Living ENEMY figures adjacent to the active Ne-Gok-Sa that he could Mind
 *  Shackle right now. Every roster card is Unique, so "any unique figure
 *  adjacent" admits any adjacent enemy. Empty unless it is this seat's Ne-Gok-Sa
 *  turn, before attacking, with the one attempt unspent (the board highlights
 *  these as shackle targets). */
export function mindShackleTargets(state: HSState, seat: number): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return [];
  if (state.turnAttacks.length > 0 || state.mindShackleSpent) return [];
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (!active || active.cardId !== NE_GOK_SA_CARD_ID) return [];
  const negok = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!negok) return [];
  return state.figures
    .filter(f => f.at != null && f.ownerSeat !== seat && figuresAdjacent(state, negok, f))
    .map(f => f.id);
}

/** Can this seat's Ne-Gok-Sa Mind Shackle right now (≥1 legal adjacent enemy)? */
export function canMindShackle(state: HSState, seat: number): boolean {
  return mindShackleTargets(state, seat).length > 0;
}

/**
 * Ne-Gok-Sa MIND SHACKLE 20 (cards.md): "After moving and before attacking, you
 * may choose any unique figure adjacent to Ne-gok-sa. Roll the 20-sided die. If
 * you roll a 20, take control of the chosen figure and that figure's Army Card.
 * You now control that Army Card and all figures on it. Remove any Order Markers
 * on this card. If Ne-Gok-Sa is destroyed, you retain control…"
 *
 * Clause-by-clause (rules-fidelity):
 *  • WHO/WHEN: the active Ne-Gok-Sa only, after the move step and BEFORE attacking
 *    (turnAttacks empty), one attempt per turn (mindShackleSpent). Optional.
 *  • TARGET: a unique figure ADJACENT to Ne-Gok-Sa. All roster cards are Unique,
 *    so we admit any adjacent ENEMY (shackling your own card is a pointless no-op
 *    the rule never intends).
 *  • ROLL: success on a NATURAL 20 only.
 *  • EFFECT: the target's whole Army Card AND every figure on it change owner to
 *    the shackler; that card's Order Markers are removed (so it sits out the rest
 *    of the round — getActiveCardUid/beginTurnOrSkip key off ownerSeat+markers).
 *    Control is a plain ownerSeat change, so it persists if Ne-Gok-Sa later dies.
 *    Seizing a seat's last living figures eliminates them (checkEliminationWin
 *    reads live figures' current ownerSeat). Does NOT consume Ne-Gok-Sa's attack.
 */
function doMindShackle(state: HSState, seat: number, targetId: string, d20: number): HSResult {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
    return { error: 'Mind Shackle requires a d20 roll (1-20)' };
  }
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (!active || active.cardId !== NE_GOK_SA_CARD_ID) {
    return { error: 'Only Ne-Gok-Sa may Mind Shackle' };
  }
  if (state.turnAttacks.length > 0) {
    return { error: 'Mind Shackle happens after moving and BEFORE attacking' };
  }
  if (state.mindShackleSpent) {
    return { error: 'Mind Shackle has already been attempted this turn' };
  }
  const negok = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!negok) return { error: 'Ne-Gok-Sa is not on the battlefield' };
  const target = state.figures.find(f => f.id === targetId);
  if (!target || target.at == null) return { error: 'No such figure to Mind Shackle' };
  if (target.ownerSeat === seat) return { error: 'Choose an enemy figure to Mind Shackle' };
  if (!figuresAdjacent(state, negok, target)) {
    return { error: 'The target must be adjacent to Ne-Gok-Sa' };
  }

  const s = clone(state);
  s.mindShackleSpent = true;
  const tdef = cardDefFor(state, target);
  // Glyph of Lodin: +1 to this d20 — a 19 + Lodin reaches Mind Shackle's natural-20 bar.
  const lodin = lodinD20Bonus(state, seat);
  const rollNote = lodin ? `${d20} +${lodin} Lodin` : `${d20}`;
  if (d20 + lodin >= 20) {
    const card = s.cards.find(c => c.uid === target.cardUid)!;
    const formerSeat = card.ownerSeat;
    card.ownerSeat = seat;
    card.orderMarkers = []; // "Remove any Order Markers on this card."
    let moved = 0;
    for (const f of s.figures) {
      if (f.cardUid === card.uid) {
        f.ownerSeat = seat;
        moved++;
      }
    }
    pushLog(
      s,
      'power',
      `Mind Shackle! ${playerName(s, seat)} rolls ${rollNote} and seizes ${tdef.name} — ${playerName(s, formerSeat)}'s whole Army Card (${moved} figure${moved === 1 ? '' : 's'}).`,
    );
    setLastRoll(s, { title: 'Mind Shackle', dice: [d20], success: true, detail: `${rollNote} ≥ 20 — seizes ${tdef.name}!` });
    checkEliminationWin(s); // seizing a seat's last figures eliminates them
  } else {
    pushLog(
      s,
      'power',
      `${playerName(s, seat)} attempts Mind Shackle on ${tdef.name} but rolls ${rollNote} (needs 20).`,
    );
    setLastRoll(s, { title: 'Mind Shackle', dice: [d20], success: false, detail: `Rolled ${rollNote} — needs 20.` });
  }
  return s;
}

// ============================================================================
// Grimnak CHOMP (cards.md): "Before attacking, choose one medium or small figure
// adjacent to Grimnak. If the chosen figure is a Squad figure, destroy it. If the
// chosen figure is a Hero figure, roll the d20 — on 16+ destroy it." Once per
// turn, does NOT consume Grimnak's attack. Large/Huge figures cannot be Chomped.
// (GRIMNAK_CARD_ID is declared above for the Orc Warrior Enhancement aura.)
// ============================================================================
const CHOMP_HERO_THRESHOLD = 16;

/** A figure is Chompable only if it is medium or small (cards.md) — Large/Huge
 *  figures (Deathwalker, Mimring, an enemy Grimnak) are immune. */
function isChompable(def: HSCardDef): boolean {
  return def.size !== 'large' && def.size !== 'huge';
}

/** Living ENEMY medium-or-small figures adjacent to the active Grimnak that he
 *  could Chomp right now (the board highlights these). Empty unless it is this
 *  seat's Grimnak turn, before attacking, with the one chomp unspent. */
export function chompTargets(state: HSState, seat: number): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return [];
  if (state.turnAttacks.length > 0 || state.chompedThisTurn) return [];
  const active = state.cards.find(c => c.uid === getActiveCardUid(state));
  if (!active || active.cardId !== GRIMNAK_CARD_ID) return [];
  const grimnak = state.figures.find(f => f.cardUid === active.uid && f.at != null);
  if (!grimnak) return [];
  return state.figures
    .filter(
      f =>
        f.at != null &&
        f.ownerSeat !== seat &&
        isChompable(cardDefFor(state, f)) &&
        figuresAdjacent(state, grimnak, f),
    )
    .map(f => f.id);
}

/** Can this seat's Grimnak Chomp right now (≥1 legal adjacent enemy)? */
export function canChomp(state: HSState, seat: number): boolean {
  return chompTargets(state, seat).length > 0;
}

function doChomp(state: HSState, seat: number, targetId: string, d20: number): HSResult {
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) return { error: 'Chomp requires a d20 roll (1-20)' };
  const active = state.cards.find(c => c.uid === getActiveCardUid(state));
  if (!active || active.cardId !== GRIMNAK_CARD_ID) return { error: 'Only Grimnak may Chomp' };
  if (state.turnAttacks.length > 0) return { error: 'Chomp happens before attacking' };
  if (state.chompedThisTurn) return { error: 'Grimnak has already Chomped this turn' };
  const grimnak = state.figures.find(f => f.cardUid === active.uid && f.at != null);
  if (!grimnak) return { error: 'Grimnak is not on the battlefield' };
  const target = state.figures.find(f => f.id === targetId);
  if (!target || target.at == null) return { error: 'No such figure to Chomp' };
  if (target.ownerSeat === seat) return { error: 'Choose an enemy figure to Chomp' };
  const tdef = cardDefFor(state, target);
  if (!isChompable(tdef)) return { error: `${tdef.name} is too large to Chomp (medium or small figures only)` };
  if (!figuresAdjacent(state, grimnak, target)) return { error: 'The figure must be adjacent to Grimnak' };

  const s = clone(state);
  s.chompedThisTurn = true;
  const isSquad = tdef.type === 'squad';
  const lodin = lodinD20Bonus(state, seat); // Glyph of Lodin: +1 to the hero-chomp d20
  const rollNote = lodin ? `${d20}+${lodin} Lodin = ${d20 + lodin}` : `${d20}`;
  const destroyed = isSquad || d20 + lodin >= CHOMP_HERO_THRESHOLD;
  if (destroyed) {
    const t = s.figures.find(f => f.id === targetId)!;
    t.at = null;
    t.at2 = null;
    maybeQueueSpiritOnDestroy(s, t); // Chomp can devour Finn/Thorgrim/Eldgrim → their Spirit still fires
    pushLog(
      s,
      'power',
      isSquad
        ? `Chomp! Grimnak devours ${figureLabel(s, target)} (a Squad figure — automatic).`
        : `Chomp! Grimnak rolls ${rollNote} (≥${CHOMP_HERO_THRESHOLD}) and devours ${figureLabel(s, target)}.`,
    );
    // Only a HERO chomp actually rolled the d20 (squads are auto-devoured).
    if (!isSquad) setLastRoll(s, { title: 'Chomp', dice: [d20], success: true, detail: `${rollNote} (≥${CHOMP_HERO_THRESHOLD}) — devours ${tdef.name}!` });
    checkEliminationWin(s); // chomping a seat's last figure ends the game
  } else {
    pushLog(
      s,
      'power',
      `Grimnak snaps at ${figureLabel(s, target)} but rolls ${rollNote} (<${CHOMP_HERO_THRESHOLD}) — it survives.`,
    );
    setLastRoll(s, { title: 'Chomp', dice: [d20], success: false, detail: `${rollNote} (<${CHOMP_HERO_THRESHOLD}) — ${tdef.name} survives.` });
  }
  setEffect(s, 'chomp', grimnak.at, [target.at]); // jaws snap shut at the target (hit or miss)
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

  const lodin = lodinD20Bonus(state, seat); // Glyph of Lodin: +1 to each clone d20
  let successes = 0;
  let skippedNoSpace = 0;
  for (const roller of livingMarro) {
    const roll = rolls.find(r => r.marroFigureId === roller.id)!;
    const onWater = map?.cells[roller.at!]?.terrain === 'water';
    const threshold = onWater ? WATER_CLONE_WATER_THRESHOLD : WATER_CLONE_THRESHOLD;
    if (roll.d20 + lodin < threshold) continue; // failed roll
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
  setLastRoll(s, {
    title: 'Water Clone',
    dice: rolls.map(r => r.d20),
    success: successes > 0,
    detail: `${successes}/${livingMarro.length} cloned (${WATER_CLONE_THRESHOLD}+, or ${WATER_CLONE_WATER_THRESHOLD}+ on water).`,
  });

  if (placements.length > 0) {
    // Prompt the owner to choose each landing (never auto-placed).
    s.pendingChoice = { kind: 'water_clone_place', seat, placements, chosen: [] };
  }
  // If no viable placement, the Water Clone simply spent the attack with no
  // returns (all successes lacked a clone or a legal space).
  return s;
}

// ============================================================================
// BIG HEROES special powers (docs/heroscape/big-heroes-powers.md) — the printed
// card text is the spec. Nilfheim Ice Shard Breath, Braxas Poisonous Acid Breath,
// Theracus Carry, Major Q9 Queglix Gun, Jotun Wild Swing + Throw.
//
// SPECIAL-ATTACK convention (matches doFireLine / doGrenadeThrow): the attack
// rolls its FIXED printed value (no height advantage, no attack auras); each
// defender rolls its EFFECTIVE defense (printed + defensive auras + glyphs AND
// height — §117 constrains the attacker only). The slice-7 defender powers
// (Stealth Dodge / Counter Strike) are NOT
// applied to special attacks here, exactly as the two existing splash specials
// already omit them — kept consistent so the special-attack damage model is one
// thing across the engine.
// ============================================================================
const NILFHEIM_CARD_ID = 'nilfheim';
const BRAXAS_CARD_ID = 'braxas';
const THERACUS_CARD_ID = 'theracus';
const MAJOR_Q9_CARD_ID = 'major_q9';
const JOTUN_CARD_ID = 'jotun';

const ICE_SHARD_RANGE = 5;
const ICE_SHARD_ATTACK = 4;
const ICE_SHARD_MAX_ATTACKS = 3;
const QUEGLIX_RANGE = 8; // = Major Q9's printed RANGE — the Queglix Gun shoots as far as his normal attack (was wrongly 6, so foes his normal attack could hit were "out of range")
const QUEGLIX_DICE_POOL = 9;
const WILD_SWING_ATTACK = 4;
const ACID_RANGE = 4;
const ACID_SQUAD_THRESHOLD = 8;
const ACID_HERO_THRESHOLD = 17;
const ACID_MAX_TARGETS = 3;
const THROW_RANGE = 4;
const THROW_THRESHOLD = 14;
const THROW_DAMAGE_THRESHOLD = 11;
const THROW_WOUNDS = 2;

/** Small/Medium = NOT Large/Huge (cards.md size line; absent ⇒ Medium). The
 *  same predicate Chomp uses — Carry/Acid Breath/Throw all target small/medium. */
function isSmallOrMedium(def: HSCardDef): boolean {
  return def.size !== 'large' && def.size !== 'huge';
}

/** Common guard for a Big-Hero special: it must be this seat's turn, the figure
 *  must be a LIVING figure of the ACTIVE (revealed-marker) card, owned by the
 *  turn seat. Unlike `attackReadyFigure` it does NOT apply the 1-attack budget —
 *  the multi-shot specials (Ice Shard / Queglix) police their own limits. */
function activeSpecialFigure(state: HSState, figureId: string): { fig: Figure } | { error: string } {
  if (state.phase !== 'playing' || state.subPhase !== 'turns') return { error: 'The battle is not in a turn' };
  const fig = state.figures.find(f => f.id === figureId);
  if (!fig || fig.at == null) return { error: 'No such figure on the battlefield' };
  if (fig.ownerSeat !== state.turnSeat) return { error: 'You can only act with your own figures' };
  const cardErr = activeCardError(state, fig);
  if (cardErr) return { error: cardErr };
  return { fig };
}

/** True if `attacker` has range+line-of-sight to `target` within `range` —
 *  measured/traced from EITHER of a double-space figure's hexes to EITHER of the
 *  target's (the same 3D LOS the normal attack uses, just a custom range).
 *  `ignoreEngagement` lifts the can't-shoot-past-engagement rule for powers that
 *  are NOT attacks (Acid Breath is "instead of attacking", so it has no such
 *  restriction — the card just says "within 4 clear sight spaces"). */
function withinRangeLos(state: HSState, attacker: Figure, target: Figure, range: number, ignoreEngagement = false): boolean {
  const map = MAPS[state.mapId];
  if (!map || target.at == null) return false;
  // Engaged figures can't shoot past their engagement (04-combat p.13): if the
  // attacker is engaged with any enemy, it may ATTACK ONLY an enemy it is engaged
  // with. This applies to the ranged special ATTACKS (Queglix, Ice Shard) that
  // roll attack dice — but NOT to Acid Breath, which is "instead of attacking".
  if (!ignoreEngagement) {
    const engaged = enemiesEngagedWith(state, attacker);
    if (engaged.length > 0 && !engaged.some(e => e.id === target.id)) return false;
  }
  // Figures do NOT block line of sight — only terrain does (on-map obstacles may
  // come later) — so the tracer is given no figure blockers.
  const eye = attackerEyeFn(state, attacker); // height-aware: a taller figure sees over low land/walls
  for (const ak of figureHexes(attacker)) {
    for (const tk of figureHexes(target)) {
      const dist = rangeDistance(map.cells, ak, tk);
      if (dist == null || dist > range) continue;
      if (hasLineOfSight3D(map.cells, ak, tk, [], eye)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Nilfheim — ICE SHARD BREATH (Range 5, Attack 4, up to 3 attacks, no repeats)
// ---------------------------------------------------------------------------

/** How many Ice Shard attacks Nilfheim has made this turn (tagged history). */
function iceShardCount(state: HSState, attackerId: string): number {
  return state.turnAttacks.filter(a => a.attackerId === attackerId && a.special === 'ice_shard').length;
}
/** Figures this Nilfheim already Ice-Sharded this turn (no repeats allowed). */
function iceShardHitIds(state: HSState, attackerId: string): Set<string> {
  return new Set(
    state.turnAttacks.filter(a => a.attackerId === attackerId && a.special === 'ice_shard').map(a => a.targetId),
  );
}
/** Enemy figures Nilfheim could Ice Shard right now (Range 5 + LOS, not already
 *  hit this turn). Empty unless it is his active turn with shots left and he has
 *  not made a NORMAL/other attack. */
export function iceShardTargets(state: HSState, attackerId: string): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  const r = activeSpecialFigure(state, attackerId);
  if ('error' in r) return [];
  const nilf = r.fig;
  if (cardDefFor(state, nilf).id !== NILFHEIM_CARD_ID) return [];
  // No mixing with a normal attack; cap at 3 shots.
  if (state.turnAttacks.some(a => a.attackerId === attackerId && a.special !== 'ice_shard')) return [];
  if (iceShardCount(state, attackerId) >= ICE_SHARD_MAX_ATTACKS) return [];
  const hit = iceShardHitIds(state, attackerId);
  return state.figures
    .filter(t => t.at != null && t.ownerSeat !== nilf.ownerSeat && !hit.has(t.id) && withinRangeLos(state, nilf, t, ICE_SHARD_RANGE))
    .map(t => t.id);
}

function doIceShard(
  state: HSState,
  action: { attackerId: string; targetId: string; attackRoll: CombatFace[]; defenseRoll: CombatFace[] },
): HSResult {
  const r = activeSpecialFigure(state, action.attackerId);
  if ('error' in r) return r;
  const nilf = r.fig;
  if (cardDefFor(state, nilf).id !== NILFHEIM_CARD_ID) return { error: 'Only Nilfheim has the Ice Shard Breath Special Attack' };
  if (state.turnAttacks.some(a => a.attackerId === nilf.id && a.special !== 'ice_shard')) {
    return { error: 'Nilfheim has already made his attack this turn' };
  }
  if (iceShardCount(state, nilf.id) >= ICE_SHARD_MAX_ATTACKS) {
    return { error: 'Ice Shard Breath may attack at most 3 times per turn' };
  }
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target || target.at == null) return { error: 'No such target on the battlefield' };
  if (target.ownerSeat === nilf.ownerSeat) return { error: 'You cannot attack your own figures' };
  if (iceShardHitIds(state, nilf.id).has(target.id)) return { error: 'Ice Shard cannot attack the same figure twice' };
  if (!withinRangeLos(state, nilf, target, ICE_SHARD_RANGE)) return { error: `Out of range or no line of sight (Range ${ICE_SHARD_RANGE})` };
  const defDice = Math.max(0, effectiveDefenseDice(state, target, nilf).dice);
  if (!validFaces(action.attackRoll, ICE_SHARD_ATTACK)) return { error: 'Malformed Ice Shard attack roll' };
  if (!validFaces(action.defenseRoll, defDice)) return { error: 'Malformed Ice Shard defense roll' };

  const skulls = countFaces(action.attackRoll, 'skull');
  const shields = countFaces(action.defenseRoll, 'shield');
  const wounds = specialAttackWounds(state, nilf, target, skulls, shields);
  const s = clone(state);
  s.turnAttacks.push({ attackerId: nilf.id, targetId: target.id, special: 'ice_shard' });
  const t = s.figures.find(f => f.id === target.id)!;
  t.wounds += wounds;
  const tDef = cardDefFor(s, t);
  const destroyed = t.wounds >= tDef.life;
  if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
  const shotNo = iceShardCount(state, nilf.id) + 1;
  s.lastAttack = {
    attackerId: nilf.id,
    targetId: target.id,
    attackerLabel: figureLabel(s, nilf),
    targetLabel: figureLabel(s, t),
    attackRoll: action.attackRoll,
    defenseRoll: action.defenseRoll,
    skulls,
    shields,
    wounds,
    destroyed,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: [`Ice Shard Breath (shot ${shotNo}/${ICE_SHARD_MAX_ATTACKS})`, `Attack ${ICE_SHARD_ATTACK} (special — no height / aura)`],
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `Ice Shard Breath ${shotNo}/${ICE_SHARD_MAX_ATTACKS} — ${figureLabel(s, nilf)} hits ${figureLabel(s, t)}: ${skulls} skull${skulls === 1 ? '' : 's'} vs ${shields} shield${shields === 1 ? '' : 's'} — ${destroyed ? 'destroyed!' : wounds > 0 ? `${wounds} wound${wounds === 1 ? '' : 's'}` : 'blocked'}.`,
  );
  setEffect(s, 'ice_shard', nilf.at, [target.at]); // a shard streaks from Nilfheim to the target (pre-destroy hex)
  checkEliminationWin(s);
  return s;
}

// ---------------------------------------------------------------------------
// Major Q9 — QUEGLIX GUN (Range 6, 9-die pool spent 1-3 per shot)
// ---------------------------------------------------------------------------

/** Enemy figures Major Q9 could Queglix right now (Range 6 + LOS), if he has
 *  dice left and has not made a normal attack. */
export function queglixTargets(state: HSState, attackerId: string): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  const r = activeSpecialFigure(state, attackerId);
  if ('error' in r) return [];
  const q9 = r.fig;
  if (cardDefFor(state, q9).id !== MAJOR_Q9_CARD_ID) return [];
  if (state.turnAttacks.some(a => a.attackerId === attackerId && a.special !== 'queglix')) return [];
  if ((state.queglixDiceSpent ?? 0) >= QUEGLIX_DICE_POOL) return [];
  return state.figures
    .filter(t => t.at != null && t.ownerSeat !== q9.ownerSeat && withinRangeLos(state, q9, t, QUEGLIX_RANGE))
    .map(t => t.id);
}
/** Dice left in Major Q9's Queglix pool this turn (9 minus spent). */
export function queglixDiceLeft(state: HSState): number {
  return Math.max(0, QUEGLIX_DICE_POOL - (state.queglixDiceSpent ?? 0));
}

function doQueglix(
  state: HSState,
  action: { attackerId: string; targetId: string; dice: number; attackRoll: CombatFace[]; defenseRoll: CombatFace[] },
): HSResult {
  const r = activeSpecialFigure(state, action.attackerId);
  if ('error' in r) return r;
  const q9 = r.fig;
  if (cardDefFor(state, q9).id !== MAJOR_Q9_CARD_ID) return { error: 'Only Major Q9 has the Queglix Gun Special Attack' };
  if (state.turnAttacks.some(a => a.attackerId === q9.id && a.special !== 'queglix')) {
    return { error: 'Major Q9 has already made his attack this turn' };
  }
  if (!Number.isInteger(action.dice) || action.dice < 1 || action.dice > 3) {
    return { error: 'Queglix Gun fires 1, 2, or 3 attack dice per shot' };
  }
  const spent = state.queglixDiceSpent ?? 0;
  if (spent + action.dice > QUEGLIX_DICE_POOL) {
    return { error: `Queglix Gun has only ${QUEGLIX_DICE_POOL - spent} attack dice left this turn` };
  }
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target || target.at == null) return { error: 'No such target on the battlefield' };
  if (target.ownerSeat === q9.ownerSeat) return { error: 'You cannot attack your own figures' };
  if (!withinRangeLos(state, q9, target, QUEGLIX_RANGE)) return { error: `Out of range or no line of sight (Range ${QUEGLIX_RANGE})` };
  const defDice = Math.max(0, effectiveDefenseDice(state, target, q9).dice);
  if (!validFaces(action.attackRoll, action.dice)) return { error: 'Malformed Queglix attack roll' };
  if (!validFaces(action.defenseRoll, defDice)) return { error: 'Malformed Queglix defense roll' };

  const skulls = countFaces(action.attackRoll, 'skull');
  const shields = countFaces(action.defenseRoll, 'shield');
  const wounds = specialAttackWounds(state, q9, target, skulls, shields);
  const s = clone(state);
  s.queglixDiceSpent = spent + action.dice;
  s.turnAttacks.push({ attackerId: q9.id, targetId: target.id, special: 'queglix' });
  const t = s.figures.find(f => f.id === target.id)!;
  t.wounds += wounds;
  const tDef = cardDefFor(s, t);
  const destroyed = t.wounds >= tDef.life;
  if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
  s.lastAttack = {
    attackerId: q9.id,
    targetId: target.id,
    attackerLabel: figureLabel(s, q9),
    targetLabel: figureLabel(s, t),
    attackRoll: action.attackRoll,
    defenseRoll: action.defenseRoll,
    skulls,
    shields,
    wounds,
    destroyed,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: [`Queglix Gun (${action.dice} of ${QUEGLIX_DICE_POOL} dice; ${QUEGLIX_DICE_POOL - s.queglixDiceSpent} left)`, 'Special — no height / aura'],
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `Queglix Gun (${action.dice} ${action.dice === 1 ? 'die' : 'dice'}, ${QUEGLIX_DICE_POOL - s.queglixDiceSpent} left) — ${figureLabel(s, q9)} hits ${figureLabel(s, t)}: ${skulls} skull${skulls === 1 ? '' : 's'} vs ${shields} shield${shields === 1 ? '' : 's'} — ${destroyed ? 'destroyed!' : wounds > 0 ? `${wounds} wound${wounds === 1 ? '' : 's'}` : 'blocked'}.`,
  );
  checkEliminationWin(s);
  return s;
}

// ---------------------------------------------------------------------------
// Jotun — WILD SWING (Range 1, Attack 4; splash to figures adjacent to target)
// ---------------------------------------------------------------------------

/** Enemy figures adjacent to the active Jotun he may Wild Swing (the primary
 *  target). Empty unless his active turn, before attacking. */
export function wildSwingTargets(state: HSState, attackerId: string): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  const r = activeSpecialFigure(state, attackerId);
  if ('error' in r) return [];
  const jotun = r.fig;
  if (cardDefFor(state, jotun).id !== JOTUN_CARD_ID) return [];
  if (state.turnAttacks.some(a => a.attackerId === attackerId)) return [];
  return state.figures
    .filter(t => t.at != null && t.ownerSeat !== jotun.ownerSeat && figuresAdjacent(state, jotun, t))
    .map(t => t.id);
}

/** Figures a Wild Swing at `targetId` AFFECTS — the target plus every figure
 *  adjacent to it (friend or foe), EXCEPT Jotun — with each one's defense dice. */
export function wildSwingDefenders(state: HSState, attackerId: string, targetId: string): { figureId: string; defense: number }[] {
  const jotun = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!jotun || !target || target.at == null) return [];
  const affected = new Map<string, Figure>([[target.id, target]]);
  for (const f of state.figures) {
    if (f.at == null || f.id === target.id || f.id === jotun.id) continue;
    if (figuresAdjacent(state, target, f)) affected.set(f.id, f);
  }
  affected.delete(jotun.id); // "Jotun cannot be affected by his own Wild Swing"
  return [...affected.values()].map(t => ({ figureId: t.id, defense: Math.max(0, effectiveDefenseDice(state, t, jotun).dice) }));
}

function doWildSwing(
  state: HSState,
  action: { attackerId: string; targetId: string; attackRoll: CombatFace[]; defenseRolls: { figureId: string; roll: CombatFace[] }[] },
): HSResult {
  const r = activeSpecialFigure(state, action.attackerId);
  if ('error' in r) return r;
  const jotun = r.fig;
  if (cardDefFor(state, jotun).id !== JOTUN_CARD_ID) return { error: 'Only Jotun has the Wild Swing Special Attack' };
  if (state.turnAttacks.some(a => a.attackerId === jotun.id)) return { error: 'Jotun has already attacked this turn' };
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target || target.at == null) return { error: 'No such target on the battlefield' };
  if (target.ownerSeat === jotun.ownerSeat) return { error: 'Choose an enemy figure to attack' };
  if (!figuresAdjacent(state, jotun, target)) return { error: 'Wild Swing is Range 1 — the target must be adjacent' };
  if (!validFaces(action.attackRoll, WILD_SWING_ATTACK)) return { error: 'Malformed Wild Swing attack roll' };
  const defenders = wildSwingDefenders(state, jotun.id, target.id);
  const got = new Map(action.defenseRolls.map(d => [d.figureId, d.roll] as const));
  if (got.size !== action.defenseRolls.length) return { error: 'Duplicate Wild Swing defender' };
  if (defenders.length !== action.defenseRolls.length) return { error: 'Wild Swing defender set mismatch' };
  for (const d of defenders) {
    const roll = got.get(d.figureId);
    if (!roll || !validFaces(roll, d.defense)) return { error: 'Malformed Wild Swing defense roll' };
  }

  const skulls = countFaces(action.attackRoll, 'skull');
  const s = clone(state);
  s.turnAttacks.push({ attackerId: jotun.id, targetId: target.id, special: 'wild_swing' });
  const results: string[] = [];
  const defenseGroups: NonNullable<HSState['lastAttack']>['defenseGroups'] = [];
  let totalWounds = 0;
  for (const d of defenders) {
    const roll = got.get(d.figureId)!;
    const shields = countFaces(roll, 'shield');
    const t = s.figures.find(f => f.id === d.figureId);
    if (!t) continue;
    const w = specialAttackWounds(s, jotun, t, skulls, shields);
    t.wounds += w;
    totalWounds += w;
    const destroyed = t.wounds >= cardDefFor(s, t).life;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    const label = figureLabel(s, t);
    defenseGroups.push({ label, roll, shields, wounds: w, destroyed });
    // Spell out the math so a partial block reads correctly: N shields cancel N skulls, the rest
    // wound. A Life-1 squad figure dies to even 1 leftover skull — show the wound count on a kill
    // so "1 shield → destroyed" isn't mistaken for "blocked but died anyway".
    const outcome = destroyed
      ? `${w} wound${w === 1 ? '' : 's'} → destroyed!`
      : w > 0 ? `${w} wound${w === 1 ? '' : 's'}` : 'fully blocked';
    results.push(`${label} (${shields} shield${shields === 1 ? '' : 's'} vs ${skulls}) — ${outcome}`);
  }
  s.lastAttack = {
    attackerId: jotun.id,
    targetId: target.id,
    attackerLabel: figureLabel(s, jotun),
    targetLabel: `Wild Swing — ${defenders.length} figure${defenders.length === 1 ? '' : 's'}`,
    attackRoll: action.attackRoll,
    defenseRoll: [],
    defenseGroups,
    skulls,
    shields: 0,
    wounds: totalWounds,
    destroyed: false,
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: ['Wild Swing Special Attack', `Attack ${WILD_SWING_ATTACK} (special — no height / aura); splash to figures adjacent to the target`],
    seq: s.logSeq + 1,
  };
  pushLog(
    s,
    'attack',
    `${figureLabel(s, jotun)} makes a Wild Swing (${skulls} skull${skulls === 1 ? '' : 's'}): ${results.join('; ')}.`,
  );
  checkEliminationWin(s);
  return s;
}

// ---------------------------------------------------------------------------
// Braxas — POISONOUS ACID BREATH (up to 3 small/medium in Range 4 + sight; d20
// destroy: Squad 8+, Hero 17+). INSTEAD of attacking.
// ---------------------------------------------------------------------------

/** Figures Braxas could Acid Breath right now — small/medium, within Range 4 +
 *  clear sight, any owner but Braxas. (Friendly fire is allowed in this engine;
 *  the card says "figures", not "enemy figures".) Empty after Braxas attacks. */
export function acidBreathTargets(state: HSState, seat: number): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return [];
  if (!active || active.cardId !== BRAXAS_CARD_ID || state.turnAttacks.length > 0) return [];
  const braxas = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!braxas) return [];
  return state.figures
    .filter(t => t.at != null && t.id !== braxas.id && isSmallOrMedium(cardDefFor(state, t)) && withinRangeLos(state, braxas, t, ACID_RANGE, true /* not an attack — engagement doesn't gate it */))
    .map(t => t.id);
}
export function canAcidBreath(state: HSState, seat: number): boolean {
  return acidBreathTargets(state, seat).length > 0;
}

function doAcidBreath(state: HSState, seat: number, rolls: { targetId: string; d20: number }[]): HSResult {
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (!active || active.cardId !== BRAXAS_CARD_ID) return { error: 'Only Braxas has Poisonous Acid Breath' };
  if (state.turnAttacks.length > 0) return { error: 'Poisonous Acid Breath is instead of attacking — you have already attacked' };
  const braxas = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!braxas) return { error: 'Braxas is not on the battlefield' };
  if (!Array.isArray(rolls) || rolls.length < 1 || rolls.length > ACID_MAX_TARGETS) {
    return { error: `Choose 1 to ${ACID_MAX_TARGETS} figures for Acid Breath` };
  }
  if (new Set(rolls.map(r => r.targetId)).size !== rolls.length) return { error: 'Acid Breath must choose different figures' };
  const legal = new Set(acidBreathTargets(state, seat));
  for (const roll of rolls) {
    if (!legal.has(roll.targetId)) return { error: 'A chosen figure is not a small/medium figure within 4 clear-sight spaces' };
    if (!Number.isInteger(roll.d20) || roll.d20 < 1 || roll.d20 > 20) return { error: 'Acid Breath needs a d20 (1-20) per chosen figure' };
  }

  const s = clone(state);
  // "Instead of attacking" — spend Braxas's attack for the turn (one entry).
  s.turnAttacks.push({ attackerId: braxas.id, targetId: rolls[0].targetId, special: 'acid_breath' });
  const lodin = lodinD20Bonus(state, seat); // Glyph of Lodin: +1 to each acid d20
  const results: string[] = [];
  const d20Rolls: { label: string; d20: number; need: number; destroyed: boolean }[] = [];
  for (const roll of rolls) {
    const t = s.figures.find(f => f.id === roll.targetId);
    if (!t || t.at == null) continue;
    const tdef = cardDefFor(s, t);
    const threshold = tdef.type === 'squad' ? ACID_SQUAD_THRESHOLD : ACID_HERO_THRESHOLD;
    const destroyed = roll.d20 + lodin >= threshold;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    results.push(`${figureLabel(s, t)} — rolled ${roll.d20}${lodin ? ` +${lodin} Lodin` : ''} (needs ${threshold}+) ${destroyed ? '→ destroyed!' : '→ survives'}`);
    d20Rolls.push({ label: figureLabel(s, t), d20: roll.d20 + lodin, need: threshold, destroyed });
  }
  s.lastAttack = {
    attackerId: braxas.id,
    targetId: rolls[0].targetId,
    attackerLabel: figureLabel(s, braxas),
    targetLabel: `Acid Breath — ${rolls.length} figure${rolls.length === 1 ? '' : 's'}`,
    attackRoll: [],
    defenseRoll: [],
    d20Rolls, // each chosen figure's d20 vs its threshold — the panel shows THESE, not skulls/shields
    skulls: 0,
    shields: 0,
    wounds: 0,
    destroyed: d20Rolls.some(r => r.destroyed),
    heightBonusAttacker: 0,
    heightBonusDefender: 0,
    breakdown: ['Poisonous Acid Breath (instead of attacking)', `d20: Squad ${ACID_SQUAD_THRESHOLD}+, Hero ${ACID_HERO_THRESHOLD}+ → destroyed`],
    seq: s.logSeq + 1,
  };
  pushLog(s, 'power', `${figureLabel(s, braxas)} exhales Poisonous Acid: ${results.join('; ')}.`);
  // Surface the per-target d20s as a GLOBAL roll (the same dice overlay every
  // other d20 power pops), so both players see each acid roll — not just the
  // log/summary panel.
  setLastRoll(s, {
    title: 'Poisonous Acid Breath',
    dice: rolls.map(r => r.d20),
    labels: rolls.map(r => {
      const t = s.figures.find(f => f.id === r.targetId);
      return t ? figureLabel(s, t) : '';
    }),
    success: results.some(r => r.includes('destroyed')),
    detail: results.join('; '),
  });
  // Acid blobs fly from Braxas to each gassed figure (their PRE-destroy hexes).
  setEffect(s, 'acid_breath', braxas.at, rolls.map(r => state.figures.find(f => f.id === r.targetId)?.at ?? null));
  checkEliminationWin(s);
  return s;
}

// ---------------------------------------------------------------------------
// Jotun — THROW 14 (after move, before attack: d20 14+ throw a small/medium
// non-flying adjacent figure within 4 + sight; d20 11+ → 2 wounds). Not an attack.
// ---------------------------------------------------------------------------

/** Small/medium non-flying figures adjacent to the active Jotun he may Throw
 *  (any owner). Empty unless his active turn, before attacking, throw unspent. */
export function throwTargets(state: HSState, seat: number): string[] {
  if (activeCardNegated(state)) return []; // Glyph of Nilrend
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return [];
  if (!active || active.cardId !== JOTUN_CARD_ID || state.turnAttacks.length > 0 || state.threwThisTurn) return [];
  const jotun = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!jotun) return [];
  return state.figures
    .filter(
      t =>
        t.at != null &&
        t.id !== jotun.id &&
        isSmallOrMedium(cardDefFor(state, t)) &&
        !cardDefFor(state, t).flying &&
        figuresAdjacent(state, jotun, t),
    )
    .map(t => t.id);
}
export function canThrow(state: HSState, seat: number): boolean {
  return throwTargets(state, seat).length > 0;
}
/** Empty hexes Jotun may throw a figure onto: within Range 4 of Jotun + clear
 *  sight from Jotun. (The thrown figure is small/medium = 1 hex.) */
export function throwLandingHexes(state: HSState, attackerId: string, targetId: string): HexKey[] {
  const map = MAPS[state.mapId];
  const jotun = state.figures.find(f => f.id === attackerId);
  const target = state.figures.find(f => f.id === targetId);
  if (!map || !jotun || jotun.at == null || !target) return [];
  // `occupied`/`occSet` block LANDING — a thrown figure needs an empty hex, and
  // every figure occupies one. Figures do NOT block SIGHT (only terrain does;
  // on-map obstacles may come later), so the LOS check below gets no figure blockers.
  const occupied: HexKey[] = [];
  for (const f of state.figures) {
    if (f.id === jotun.id || f.id === target.id) continue;
    occupied.push(...figureHexes(f));
  }
  const occSet = new Set(occupied);
  const eye = attackerEyeFn(state, jotun); // height-aware: a taller figure sees over low land/walls
  const out: HexKey[] = [];
  for (const key of Object.keys(map.cells)) {
    if (occSet.has(key)) continue; // must be empty
    const within = figureHexes(jotun).some(jk => {
      const d = rangeDistance(map.cells, jk, key);
      return d != null && d <= THROW_RANGE;
    });
    if (!within) continue;
    if (figureHexes(jotun).some(jk => hasLineOfSight3D(map.cells, jk, key, [], eye))) out.push(key);
  }
  return out;
}

function doThrow(
  state: HSState,
  seat: number,
  action: { attackerId: string; targetId: string; to: HexKey; throwD20: number; damageD20: number },
): HSResult {
  const r = activeSpecialFigure(state, action.attackerId);
  if ('error' in r) return r;
  const jotun = r.fig;
  if (cardDefFor(state, jotun).id !== JOTUN_CARD_ID) return { error: 'Only Jotun may Throw' };
  if (state.turnAttacks.length > 0) return { error: 'Throw happens after moving and before attacking' };
  if (state.threwThisTurn) return { error: 'Jotun has already used Throw this turn' };
  if (!Number.isInteger(action.throwD20) || action.throwD20 < 1 || action.throwD20 > 20) return { error: 'Throw needs a d20 (1-20)' };
  if (!Number.isInteger(action.damageD20) || action.damageD20 < 1 || action.damageD20 > 20) return { error: 'Throw needs a damage d20 (1-20)' };
  const target = state.figures.find(f => f.id === action.targetId);
  if (!target || target.at == null) return { error: 'No such figure to Throw' };
  if (target.id === jotun.id) return { error: 'Jotun cannot Throw himself' };
  const tdef = cardDefFor(state, target);
  if (!isSmallOrMedium(tdef)) return { error: `${tdef.name} is too large to Throw (small or medium figures only)` };
  if (tdef.flying) return { error: 'A flying figure cannot be Thrown' };
  if (!figuresAdjacent(state, jotun, target)) return { error: 'The figure must be adjacent to Jotun' };

  const s = clone(state);
  s.threwThisTurn = true; // the attempt is spent regardless of the roll
  // Lodin's Glyph adds +1 to ANY d20 the controlling player rolls — Throw's success roll AND its
  // damage roll both qualify (every other Big-Hero d20 power already folds this in).
  const lodin = lodinD20Bonus(state, jotun.ownerSeat);
  const throwRoll = action.throwD20 + lodin;
  const lodinNote = lodin ? ` (${action.throwD20}+${lodin} Lodin)` : '';
  if (throwRoll < THROW_THRESHOLD) {
    pushLog(s, 'power', `${figureLabel(s, jotun)} tries to Throw ${figureLabel(s, target)} but rolls ${throwRoll}${lodinNote} (needs ${THROW_THRESHOLD}+) — it stays put.`);
    setLastRoll(s, { title: 'Throw', dice: [action.throwD20], success: false, detail: `${throwRoll}${lodinNote} (needs ${THROW_THRESHOLD}+) — ${tdef.name} stays put.` });
    return s;
  }
  // 14+ — validate the landing and place the figure.
  if (!throwLandingHexes(state, jotun.id, target.id).includes(action.to)) {
    return { error: 'Throw target space must be empty, within 4 spaces, and in clear sight of Jotun' };
  }
  const map = MAPS[state.mapId];
  const landCell = map?.cells[action.to];
  const t = s.figures.find(f => f.id === target.id)!;
  t.at = action.to;
  t.at2 = null; // small/medium = single hex
  // Throwing damage — UNLESS the landing is higher than Jotun's Height, or water.
  const jotunHeight = cardDefFor(s, jotun).height;
  const noDamage = (landCell && landCell.height > jotunHeight) || landCell?.terrain === 'water';
  let woundLine = '';
  if (noDamage) {
    woundLine = landCell?.terrain === 'water' ? ' (landed in water — no throwing damage)' : ' (landed above Jotun’s height — no throwing damage)';
  } else if (action.damageD20 + lodin >= THROW_DAMAGE_THRESHOLD) {
    t.wounds += THROW_WOUNDS;
    const destroyed = t.wounds >= tdef.life;
    if (destroyed) { t.at = null; t.at2 = null; maybeQueueSpiritOnDestroy(s, t); }
    woundLine = ` and takes ${THROW_WOUNDS} wounds (rolled ${action.damageD20 + lodin}${lodin ? `=${action.damageD20}+${lodin} Lodin` : ''} ≥ ${THROW_DAMAGE_THRESHOLD})${destroyed ? ' — destroyed!' : ''}`;
  } else {
    woundLine = ` and is unharmed (rolled ${action.damageD20 + lodin} < ${THROW_DAMAGE_THRESHOLD})`;
  }
  pushLog(s, 'power', `${figureLabel(s, jotun)} Throws ${figureLabel(s, t)} (rolled ${action.throwD20}) onto ${action.to}${woundLine}.`);
  setLastRoll(s, { title: 'Throw', dice: [action.throwD20], success: true, detail: `${action.throwD20} (≥${THROW_THRESHOLD}) — Jotun hurls ${tdef.name}!` });
  checkEliminationWin(s);
  return s;
}

// ---------------------------------------------------------------------------
// Theracus — CARRY (before move: pick an unengaged friendly small/medium adjacent
// figure; after Theracus flies, place it adjacent to his new position).
// ---------------------------------------------------------------------------

/** Unengaged friendly (allied) small/medium figures adjacent to the active
 *  Theracus he may Carry. Empty unless his active turn, before he has moved. */
export function carryPassengers(state: HSState, seat: number): string[] {
  const activeUid = getActiveCardUid(state);
  const active = state.cards.find(c => c.uid === activeUid);
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return [];
  if (!active || active.cardId !== THERACUS_CARD_ID) return [];
  const theracus = state.figures.find(f => f.cardUid === activeUid && f.at != null);
  if (!theracus) return [];
  if (state.movedFigureIds.includes(theracus.id) || state.turnAttacks.length > 0) return [];
  return state.figures
    .filter(
      p =>
        p.at != null &&
        p.id !== theracus.id &&
        teamOfSeat(state, p.ownerSeat) === teamOfSeat(state, theracus.ownerSeat) &&
        isSmallOrMedium(cardDefFor(state, p)) &&
        figuresAdjacent(state, theracus, p) &&
        enemiesEngagedWith(state, p).length === 0,
    )
    .map(p => p.id);
}

function doCarryMove(
  state: HSState,
  seat: number,
  action: {
    figureId: string;
    to: HexKey;
    passengerId: string;
    passengerTo: HexKey;
    fallRoll?: CombatFace[];
    extremeFallD20?: number;
    leaveRolls?: { enemyFigureId: string; roll: CombatFace }[];
  },
): HSResult {
  const r = activeSpecialFigure(state, action.figureId);
  if ('error' in r) return r;
  const theracus = r.fig;
  if (cardDefFor(state, theracus).id !== THERACUS_CARD_ID) return { error: 'Only Theracus has Carry' };
  // The passenger must be a legal Carry choice BEFORE the move.
  if (!carryPassengers(state, seat).includes(action.passengerId)) {
    return { error: 'Choose an unengaged friendly small/medium figure adjacent to Theracus' };
  }
  // Theracus's move validates and resolves exactly like a normal flying move
  // (movement budget, takeoff leaving-engagement swipes — the SERVER rolled them).
  const moved = doMove(state, theracus.id, action.to, action.fallRoll, action.extremeFallD20, action.leaveRolls);
  if ('error' in moved) return moved;
  if (moved.phase !== 'playing') return moved; // a takeoff swipe ended the game — no carry
  const s = moved; // doMove returns a fresh clone we own
  const carrier = s.figures.find(f => f.id === theracus.id)!;
  const passenger = s.figures.find(f => f.id === action.passengerId);
  if (!passenger || passenger.at == null) return { error: 'The carried figure is no longer on the battlefield' };
  // Landing must be an empty real cell adjacent to Theracus's NEW position.
  const map = MAPS[s.mapId];
  if (!map || !map.cells[action.passengerTo]) return { error: 'Invalid landing space for the carried figure' };
  const occupied = new Set(s.figures.filter(f => f.id !== passenger.id && f.at != null).flatMap(f => figureHexes(f)));
  if (occupied.has(action.passengerTo)) return { error: 'The carried figure’s landing space is occupied' };
  const carrierHexes = new Set(figureHexes(carrier).flatMap(k => neighborKeys(k)));
  if (!carrierHexes.has(action.passengerTo)) return { error: 'Place the carried figure adjacent to Theracus’s new position' };
  passenger.at = action.passengerTo;
  passenger.at2 = null;
  pushLog(s, 'power', `${figureLabel(s, carrier)} carries ${figureLabel(s, passenger)} along, setting it down at ${action.passengerTo}.`);
  // The set-down passenger STOPS on its landing space, so a glyph there triggers for it too
  // (Theracus's own glyph(s) already fired inside doMove). A glyph kill can end the game.
  applyGlyphOnStop(s, passenger);
  checkEliminationWin(s);
  return s;
}

/** Empty hexes a carried passenger may be set down on for Theracus's chosen flight
 *  destination `to` — the footprint-aware twin of doCarryMove's landing check. Theracus
 *  is a 2-hex figure, so his TAIL at `to` counts: the drop must be adjacent to either
 *  lobe, on a real empty cell that isn't his footprint. Single source for the board. */
export function carryLandingHexes(state: HSState, theracusId: string, to: HexKey, passengerId: string): HexKey[] {
  const map = MAPS[state.mapId];
  const theracus = state.figures.find(f => f.id === theracusId);
  if (!map || !theracus || !map.cells[to]) return [];
  const tail = baseSizeOf(cardDefFor(state, theracus)) === 2 ? moveTailFor(state, theracus, to) : null;
  const footprint = [to, ...(tail ? [tail] : [])];
  const occupied = new Set(
    state.figures
      .filter(f => f.id !== passengerId && f.id !== theracusId && f.at != null)
      .flatMap(f => figureHexes(f)),
  );
  const out = new Set<HexKey>();
  for (const fk of footprint) {
    for (const n of neighborKeys(fk)) {
      if (map.cells[n] && !footprint.includes(n) && !occupied.has(n)) out.add(n);
    }
  }
  return [...out];
}

/** Theracus's FOOTPRINT (lead + derived tail) if he flew to `to` — so the board can show him
 *  optimistically "in position" before the player picks where to set the passenger down. */
export function carryDestFootprint(state: HSState, theracusId: string, to: HexKey): HexKey[] {
  const theracus = state.figures.find(f => f.id === theracusId);
  if (!theracus) return [to];
  const tail = baseSizeOf(cardDefFor(state, theracus)) === 2 ? moveTailFor(state, theracus, to) : null;
  return tail ? [to, tail] : [to];
}

// ---------------------------------------------------------------------------
// Airborne Elite — THE DROP (cards.md): they start OFF the battlefield (reserve);
// at the start of each round, before order markers, roll a d20 — on 13+ you MAY
// deploy all reserve Airborne onto empty spaces not adjacent to each other or any
// figure, and not on glyphs. One roll per round until it succeeds.
// ---------------------------------------------------------------------------
const THE_DROP_THRESHOLD = 13;

/** Reserve (un-deployed) Airborne Elite figures this seat can still drop. */
function reserveAirborne(state: HSState, seat: number): Figure[] {
  return state.figures.filter(
    f => f.ownerSeat === seat && f.reserve && cardDefFor(state, f).id === AIRBORNE_CARD_ID,
  );
}

/** Is a single hex a legal Drop landing w.r.t. the board — a real cell, EMPTY, not
 *  on a glyph, and not adjacent to any ON-BOARD figure? (Mutual non-adjacency
 *  among the chosen landings is enforced separately, since it depends on the set.) */
function dropHexLegal(state: HSState, key: HexKey): boolean {
  const map = MAPS[state.mapId];
  if (!map || !map.cells[key]) return false;
  if (state.figures.some(f => figureHexes(f).includes(key))) return false; // occupied
  if ((state.glyphs ?? []).some(g => g.at === key)) return false; // on a glyph
  const adj = new Set(neighborKeys(key));
  if (state.figures.some(f => f.at != null && figureHexes(f).some(h => adj.has(h)))) return false; // adjacent to a figure
  return true;
}

/** Can this seat roll The Drop right now — round start (place_markers), before it
 *  locks order markers, not already rolled this round, with reserve Airborne left? */
export function canTheDrop(state: HSState, seat: number): boolean {
  return (
    state.phase === 'playing' &&
    state.subPhase === 'place_markers' &&
    !(state.markersReady ?? []).includes(seat) &&
    state.airborneDropRound !== state.round &&
    reserveAirborne(state, seat).length > 0
  );
}

/** Every empty board hex an Airborne figure may land on during the DROP
 *  PLACEMENT step — i.e. while this seat has an `airborne_drop` pending choice
 *  (opened by a 13+ roll). Ignores mutual adjacency among the drop set (the board
 *  enforces that as figures are chosen). Empty when no placement is pending. */
export function theDropHexes(state: HSState, seat: number): HexKey[] {
  const pc = state.pendingChoice;
  if (!pc || pc.kind !== 'airborne_drop' || pc.seat !== seat) return [];
  return Object.keys(MAPS[state.mapId]?.cells ?? {}).filter(k => dropHexLegal(state, k));
}

/** The Drop — ROLL step (cards.md). At round start, before order markers, roll a
 *  d20. The roll is GLOBAL (setLastRoll → every player's dice overlay). On a miss
 *  (<13) the Airborne stay in reserve; on 13+ open an `airborne_drop` pending
 *  choice so the LANDING is offered only AFTER the roll is seen. One roll/round. */
function doTheDrop(state: HSState, seat: number, d20: number): HSResult {
  if (state.phase !== 'playing' || state.subPhase !== 'place_markers') {
    return { error: 'The Drop happens at the start of a round, before order markers' };
  }
  if ((state.markersReady ?? []).includes(seat)) {
    return { error: 'The Drop must come before you place your order markers' };
  }
  const reserve = reserveAirborne(state, seat);
  if (reserve.length === 0) return { error: 'You have no Airborne Elite in reserve' };
  if (state.airborneDropRound === state.round) return { error: 'The Drop has already been rolled this round' };
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) return { error: 'The Drop requires a d20 roll (1-20)' };

  const s = clone(state);
  s.airborneDropRound = s.round; // one roll per round, hit or miss
  const lodin = lodinD20Bonus(state, seat); // Glyph of Lodin: +1 to this d20
  const rollNote = lodin ? `${d20}+${lodin} Lodin = ${d20 + lodin}` : `${d20}`;
  if (d20 + lodin < THE_DROP_THRESHOLD) {
    pushLog(s, 'power', `${playerName(s, seat)} rolls ${rollNote} for The Drop (needs ${THE_DROP_THRESHOLD}+) — the Airborne Elite stay in reserve.`);
    setLastRoll(s, { title: 'The Drop', dice: [d20], success: false, detail: `${rollNote} (needs ${THE_DROP_THRESHOLD}+) — stays in reserve.` });
    return s;
  }
  // 13+ — DEFER placement to a pending choice so the GLOBAL roll is seen before any
  // landing is chosen. The pendingChoice gate then forces this seat to deploy
  // before placing order markers (The Drop resolves before markers).
  s.pendingChoice = { kind: 'airborne_drop', seat, cardUid: reserve[0].cardUid, count: reserve.length };
  pushLog(s, 'power', `The Drop! ${playerName(s, seat)} rolls ${rollNote} (≥${THE_DROP_THRESHOLD}) — deploy ${reserve.length} Airborne Elite.`);
  setLastRoll(s, { title: 'The Drop', dice: [d20], success: true, detail: `${rollNote} (≥${THE_DROP_THRESHOLD}) — place ${reserve.length} Airborne Elite!` });
  return s;
}

/** The Drop — PLACEMENT step: resolve the `airborne_drop` pending choice by
 *  deploying all reserve Airborne onto the chosen empty spaces (each legal — not
 *  occupied / on a glyph / adjacent to a figure — and mutually non-adjacent),
 *  validated against the pre-drop board. */
function doAirborneDropPlace(state: HSState, seat: number, placements: HexKey[]): HSResult {
  const reserve = reserveAirborne(state, seat);
  if (reserve.length === 0) return { error: 'You have no Airborne Elite in reserve' };
  if (!Array.isArray(placements)) return { error: 'The Drop placements must be an array' };
  // The Drop is "you MAY place all your Airborne Elite": it's all-or-nothing.
  // An empty array is a legal DECLINE — the figures stay in reserve (e.g. when
  // the board has no room to land a full, mutually-non-adjacent squad). Anything
  // between 1 and reserve.length-1 is a partial drop, which the rules don't allow.
  if (placements.length === 0) {
    const s = clone(state);
    delete s.pendingChoice;
    pushLog(s, 'power', `${playerName(s, seat)} holds the Airborne Elite in reserve.`);
    return s;
  }
  if (placements.length !== reserve.length) {
    return { error: `The Drop places all ${reserve.length} Airborne Elite, or none` };
  }
  if (new Set(placements).size !== placements.length) return { error: 'The Drop landings must be distinct spaces' };
  for (const k of placements) {
    if (!dropHexLegal(state, k)) return { error: 'A landing is occupied, on a glyph, or adjacent to a figure' };
  }
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (neighborKeys(placements[i]).includes(placements[j])) {
        return { error: 'Airborne Elite cannot be dropped adjacent to each other' };
      }
    }
  }
  const s = clone(state);
  reserveAirborne(s, seat).forEach((rf, i) => {
    const f = s.figures.find(x => x.id === rf.id)!;
    f.at = placements[i];
    f.at2 = null;
    delete f.reserve;
  });
  delete s.pendingChoice;
  pushLog(s, 'power', `${playerName(s, seat)} deploys ${reserve.length} Airborne Elite.`);
  return s;
}

// ============================================================================
// Resolve a PendingChoice (slice 4) — never auto-issued; the owning seat sends
// the matching resolution. The engine validates the payload kind matches the
// open choice and that the chosen option is legal.
// ============================================================================

function doResolveChoice(state: HSState, seat: number, choice: HSChoiceResolution): HSResult {
  const pc = state.pendingChoice!;

  // --- ROLL CEREMONY (Mitonsoul curse / Sturla resurrection): the current roller SELECTS one of
  //     their figures (it highlights for everyone), then ROLLS it. One figure at a time, in turn
  //     order; all players watch. The d20 is rolled by the action layer (like every glyph d20).
  //     Handled BEFORE the kind-match guard below: one pending (roll_ceremony) takes TWO different
  //     resolution kinds (select + roll), so they never equal pc.kind. ---
  if (pc.kind === 'roll_ceremony' && choice.kind === 'roll_ceremony_select') {
    const mine = pc.queue[0]?.figureIds ?? [];
    if (!mine.includes(choice.figureId)) return { error: 'Select one of your own un-rolled figures' };
    const s = clone(state);
    const npc = s.pendingChoice;
    if (npc?.kind === 'roll_ceremony') npc.selectedFigureId = choice.figureId; // shared highlight
    return s;
  }
  if (pc.kind === 'roll_ceremony' && choice.kind === 'roll_ceremony_roll') {
    if (!Number.isInteger(choice.d20) || choice.d20! < 1 || choice.d20! > 20) return { error: 'Malformed ceremony roll' };
    const figureId = pc.selectedFigureId;
    if (!figureId) return { error: 'Select a figure before rolling' };
    if (!(pc.queue[0]?.figureIds ?? []).includes(figureId)) return { error: 'That figure is not up to roll' };
    const s = clone(state);
    const npc = s.pendingChoice;
    if (npc?.kind !== 'roll_ceremony') return { error: 'Ceremony already resolved' };
    applyCeremonyRoll(s, npc, figureId, choice.d20!);
    return s;
  }

  if (pc.kind !== choice.kind) {
    return { error: `Expected a ${pc.kind} resolution` };
  }

  // --- Airborne Elite THE DROP placement (the landing step after a 13+ roll) ---
  if (pc.kind === 'airborne_drop' && choice.kind === 'airborne_drop') {
    return doAirborneDropPlace(state, seat, choice.placements);
  }

  // --- Glyph of Sturla PLACEMENT: the current owner sets their risen figure down on an empty
  //     start-zone hex (returns FRESH); then the queue advances to the next riser's owner. ---
  if (pc.kind === 'glyph_sturla_place' && choice.kind === 'glyph_sturla_place') {
    if (!sturlaPlacementHexes(state, pc.figureId).includes(choice.hex)) {
      return { error: 'Place the figure on an empty space in its start zone' };
    }
    const s = clone(state);
    const fig = s.figures.find(f => f.id === pc.figureId)!;
    const map = MAPS[s.mapId]!;
    fig.wounds = 0; // returns FRESH
    if (baseSizeOf(cardDefFor(s, fig)) === 2) {
      const occupied = new Set(s.figures.filter(f => f.id !== fig.id && f.at != null).flatMap(f => figureHexes(f)));
      const freeZone = new Set((map.startZones[fig.ownerSeat] ?? []).filter(h => !occupied.has(h) && h !== choice.hex));
      const tail = tailFor(map.cells, freeZone, choice.hex);
      if (tail == null) return { error: 'That space has no room for the 2-hex figure' };
      fig.at = choice.hex; fig.at2 = tail;
    } else {
      fig.at = choice.hex; fig.at2 = null;
    }
    pushLog(s, 'glyph', `Resurrection — ${playerName(s, fig.ownerSeat)} returns ${figureLabel(s, fig)} to the battlefield.`);
    openSturlaPlacement(s, pc.remaining); // next riser (its own owner), or done
    return s;
  }

  // --- Glyph of Oreld: Remove Marker — a PUBLIC two-step (mirrors Wannok). STEP 1: the action
  //     layer rolls the controller's d20 (a 1 backfires onto them; 2+ opens the pick). STEP 2: the
  //     controller NAMES a player, who loses one unrevealed order marker. ---
  if (pc.kind === 'glyph_oreld' && choice.kind === 'glyph_oreld') {
    const s = clone(state);
    // Remove ONE unrevealed order marker from a seat's cards. WHICH one is immaterial — markers are
    // hidden, so the value lost is unknowable to everyone; take the first unrevealed slot. Returns
    // whether a marker was actually removed.
    const stripOneMarker = (st: HSState, victimSeat: number): boolean => {
      for (const c of st.cards) {
        if (c.ownerSeat !== victimSeat) continue;
        const idx = c.orderMarkers.findIndex(m => !m.revealed);
        if (idx >= 0) { c.orderMarkers.splice(idx, 1); return true; }
      }
      return false;
    };
    const myTeam = teamOfSeat(s, pc.seat);
    const eligibleVictims = (): number[] =>
      livingSeats(s).filter(
        st => teamOfSeat(s, st) !== myTeam && s.cards.some(c => c.ownerSeat === st && c.orderMarkers.some(m => !m.revealed)),
      );

    // STEP 1 — the server d20 roll.
    if (pc.d20 == null) {
      const raw = choice.d20;
      if (!Number.isInteger(raw) || (raw ?? 0) < 1 || (raw ?? 0) > 20) return { error: 'Malformed Oreld roll' };
      const lodin = lodinD20Bonus(s, pc.seat); // Glyph of Lodin: +1 to the controller's d20 (so a Lodin holder never self-backfires on a 1)
      const d = (raw ?? 0) + lodin;
      const rollNote = lodin ? `${raw}+${lodin} Lodin = ${d}` : `${d}`;
      if (d === 1) {
        const lost = stripOneMarker(s, pc.seat); // BACKFIRE — the controller loses their own
        pushLog(s, 'glyph', lost
          ? `Oreld — ${playerName(s, pc.seat)} rolls ${rollNote}: it backfires — they lose one of their own unrevealed order markers!`
          : `Oreld — ${playerName(s, pc.seat)} rolls ${rollNote}: it backfires, but they have no unrevealed marker to lose.`);
        s.glyphs = s.glyphs.filter(g => g.at !== pc.at); // temporary — spent
        delete s.pendingChoice;
        return s;
      }
      const victims = eligibleVictims(); // 2+ — open the pick (fizzle if no one is eligible)
      if (victims.length === 0) {
        pushLog(s, 'glyph', `Oreld — ${playerName(s, pc.seat)} rolls ${rollNote}: no opponent has an unrevealed order marker to take.`);
        s.glyphs = s.glyphs.filter(g => g.at !== pc.at);
        delete s.pendingChoice;
        return s;
      }
      pushLog(s, 'glyph', `Oreld — ${playerName(s, pc.seat)} rolls ${rollNote}: choose a player to lose an unrevealed order marker.`);
      s.pendingChoice = { kind: 'glyph_oreld', seat: pc.seat, at: pc.at, d20: d!, victimSeats: victims };
      return s;
    }

    // STEP 2 — the controller names the victim seat (2+ only).
    if (choice.victimSeat == null) return { error: 'Choose a player to lose an order marker' };
    if (!(pc.victimSeats ?? []).includes(choice.victimSeat)) return { error: 'That player is not an eligible Oreld target' };
    const lost = stripOneMarker(s, choice.victimSeat);
    pushLog(s, 'glyph', lost
      ? `Oreld — ${playerName(s, pc.seat)} (rolled ${pc.d20}) takes an unrevealed order marker from ${playerName(s, choice.victimSeat)}!`
      : `Oreld — ${playerName(s, choice.victimSeat)} had no unrevealed marker to lose.`);
    s.glyphs = s.glyphs.filter(g => g.at !== pc.at); // temporary — spent
    delete s.pendingChoice;
    return s;
  }

  // --- Glyph of Erland: Summoning (teleport any single-hex figure to an empty space
  //     adjacent to the figure on the glyph; no swipes/fall) ---
  if (pc.kind === 'glyph_erland' && choice.kind === 'glyph_erland') {
    const summoner = state.figures.find(f => f.id === pc.summonerFigureId);
    if (!summoner || summoner.at == null) {
      const s = clone(state);
      s.glyphs = s.glyphs.filter(g => g.at !== pc.at);
      delete s.pendingChoice;
      return s; // summoner gone — fizzle
    }
    const target = state.figures.find(f => f.id === choice.figureId);
    if (!target || target.at == null || target.at2 != null || target.id === pc.summonerFigureId) {
      return { error: 'Choose a single-hex figure to summon' };
    }
    if (!emptyNeighborsOf(state, summoner).includes(choice.to)) {
      return { error: 'Choose an empty space adjacent to the figure on the glyph' };
    }
    const s = clone(state);
    const f = s.figures.find(x => x.id === choice.figureId)!;
    f.at = choice.to;
    f.at2 = null;
    s.glyphs = s.glyphs.filter(g => g.at !== pc.at); // temporary — fired once
    delete s.pendingChoice;
    pushLog(s, 'glyph', `Erland — ${figureLabel(s, f)} is summoned beside ${figureLabel(s, summoner)} (no swipes).`);
    return s;
  }

  // --- Glyph of Nilrend: Negation — STEP 1 the server d20 (narrow to the eligible side);
  //     STEP 2 the controller picks a unique card → its powers off for the game ---
  if (pc.kind === 'glyph_nilrend' && choice.kind === 'glyph_nilrend') {
    if (pc.d20 == null) {
      const raw = choice.d20;
      if (raw == null || !Number.isInteger(raw) || raw < 1 || raw > 20) {
        return { error: 'Nilrend needs a d20 roll' };
      }
      const lodin = lodinD20Bonus(state, pc.seat); // Glyph of Lodin: +1 (a 1 → 2, so a Lodin holder never self-negates)
      const d = raw + lodin;
      const rollNote = lodin ? `${raw}+${lodin} Lodin = ${d}` : `${d}`;
      const eligible = d === 1 ? pc.ownCardUids : pc.foeCardUids;
      const whose = d === 1 ? 'your own' : "an opponent's";
      const s = clone(state);
      setLastRoll(s, { title: 'Glyph of Nilrend', dice: [raw], success: d >= 2, detail: `${rollNote} — negate ${whose} unique figure.` });
      if (eligible.length === 0) {
        s.glyphs = s.glyphs.filter(g => g.at !== pc.at); // fizzle — nothing on that side
        delete s.pendingChoice;
        pushLog(s, 'glyph', `Nilrend — ${playerName(s, seat)} rolls ${rollNote}, but there is no ${whose} unique figure to negate. It fades.`);
        return s;
      }
      s.pendingChoice = { ...pc, d20: d }; // keep open for the human pick (store the EFFECTIVE value)
      pushLog(s, 'glyph', `Nilrend — ${playerName(s, seat)} rolls ${rollNote}: choose ${whose} unique figure to negate.`);
      return s;
    }
    if (choice.cardUid == null) return { error: 'Choose a unique card to negate' };
    const eligible = pc.d20 === 1 ? pc.ownCardUids : pc.foeCardUids;
    if (!eligible.includes(choice.cardUid)) return { error: 'That card is not an eligible Nilrend target' };
    const s = clone(state);
    s.negatedCardUids = [...(s.negatedCardUids ?? []), choice.cardUid];
    s.glyphs = s.glyphs.filter(g => g.at !== pc.at); // temporary — fired once
    delete s.pendingChoice;
    const card = s.cards.find(c => c.uid === choice.cardUid);
    pushLog(s, 'glyph', `Nilrend — ${card ? HS_CARDS[card.cardId].name : 'a unique card'}'s special powers are negated for the rest of the game.`);
    return s;
  }

  // --- Glyph of Wannok: end-of-round Curse. STEP 1 the server d20 (1 → wound the figure on
  //     the glyph; 2+ → the controller names an opponent). The round has ALREADY rolled over,
  //     so resolving just applies the wound / opens the next step and clears the pending. ---
  if (pc.kind === 'glyph_wannok' && choice.kind === 'glyph_wannok') {
    if (pc.d20 == null) {
      const raw = choice.d20;
      if (raw == null || !Number.isInteger(raw) || raw < 1 || raw > 20) {
        return { error: 'Wannok needs a d20 roll' };
      }
      const lodin = lodinD20Bonus(state, pc.seat); // Glyph of Lodin: +1 (a 1 → 2, so a Lodin holder's own figure is never self-cursed)
      const d = raw + lodin;
      const rollNote = lodin ? `${raw}+${lodin} Lodin = ${d}` : `${d}`;
      const s = clone(state);
      setLastRoll(s, {
        title: 'Glyph of Wannok',
        dice: [raw],
        success: d >= 2,
        detail: d === 1 ? `${rollNote} — the figure on the glyph is cursed.` : `${rollNote} — choose an opponent to curse.`,
      });
      if (d === 1) {
        delete s.pendingChoice; // clear FIRST so a curse death can queue its Spirit
        const occupant = s.figures.find(f => f.at != null && figureHexes(f).includes(pc.at));
        if (occupant) woundOneFigure(s, occupant, 'Wannok curse (rolled 1)');
        else pushLog(s, 'glyph', 'Wannok — rolled 1, but no figure stands on the glyph.');
        checkEliminationWin(s);
        return s;
      }
      // 2+ — the controller must name an opponent (next step). If there are no opponents to
      // curse (shouldn't happen in a live game), the curse simply fizzles.
      // An opponent must have an ON-BOARD figure to wound — a seat alive only on reserve Airborne
      // can't be cursed, and opening its victim choice would be unresolvable (a bot victim → frozen room).
      const hasOpponent = livingSeats(s).some(st => teamOfSeat(s, st) !== teamOfSeat(s, pc.seat) && s.figures.some(f => f.ownerSeat === st && f.at != null));
      if (!hasOpponent) {
        delete s.pendingChoice;
        pushLog(s, 'glyph', `Wannok — ${playerName(s, pc.seat)} rolls ${rollNote}, but there is no opponent to curse.`);
        return s;
      }
      s.pendingChoice = { ...pc, d20: d };
      pushLog(s, 'glyph', `Wannok — ${playerName(s, pc.seat)} rolls ${rollNote}: choose an opponent who must wound one of their own.`);
      return s;
    }
    // STEP 2 — the controller names an opponent → open that opponent's victim choice.
    if (choice.opponentSeat == null) return { error: 'Choose an opponent' };
    if (teamOfSeat(state, choice.opponentSeat) === teamOfSeat(state, seat)) return { error: 'Choose an OPPONENT, not an ally' };
    if (!state.figures.some(f => f.ownerSeat === choice.opponentSeat && f.at != null)) return { error: 'That opponent has no figure on the board to wound' };
    const s = clone(state);
    s.pendingChoice = { kind: 'glyph_wannok_victim', seat: choice.opponentSeat, at: pc.at, controllerSeat: seat };
    pushLog(s, 'glyph', `Wannok — ${playerName(s, choice.opponentSeat)} must wound one of their own figures.`);
    return s;
  }

  // --- Glyph of Wannok step 2: the named opponent wounds one of their OWN living figures. ---
  if (pc.kind === 'glyph_wannok_victim' && choice.kind === 'glyph_wannok_victim') {
    const victim = state.figures.find(f => f.id === choice.figureId);
    if (!victim || victim.at == null || victim.ownerSeat !== pc.seat) {
      return { error: 'Choose one of YOUR living figures to take the wound' };
    }
    const s = clone(state);
    delete s.pendingChoice; // clear FIRST so a curse death can queue its Spirit
    const f = s.figures.find(x => x.id === choice.figureId)!;
    woundOneFigure(s, f, 'Wannok curse');
    checkEliminationWin(s);
    return s;
  }

  // --- Spirit placement (Finn/Thorgrim on destroy) ---
  if (pc.kind === 'spirit_placement' && choice.kind === 'spirit_placement') {
    if (!pc.options.includes(choice.cardUid)) {
      return { error: 'The Spirit must be placed on a living unique Army Card' };
    }
    const s = clone(state);
    const card = s.cards.find(c => c.uid === choice.cardUid)!;
    if (pc.spirit === 'attack') card.attackMod += 1;
    else if (pc.spirit === 'defense') card.defenseMod += 1;
    else card.moveMod = (card.moveMod ?? 0) + 1;
    delete s.pendingChoice;
    const spiritName = pc.spirit === 'attack' ? 'Attack' : pc.spirit === 'defense' ? 'Armor' : 'Swiftness';
    pushLog(
      s,
      'power',
      `${playerName(s, seat)} places the Warrior's ${spiritName} Spirit on ${cardDef(card.cardId).name} — +1 ${pc.spirit} forever.`,
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
      s.movementEnded = false; // re-grant movement even if the player had tapped End move
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

/** Can `seat`'s active Eldgrim OVEREXTEND right now? — the turns phase, his turn, the active card is
 *  a LIVING, non-negated Eldgrim that hasn't Overextended THIS round, and the self-wound would NOT
 *  kill him. The single source for the board button + the engine gate + the AI. */
export function canOverextend(state: HSState, seat: number): boolean {
  if (state.subPhase !== 'turns' || state.turnSeat !== seat) return false;
  const auid = getActiveCardUid(state);
  if (!auid) return false;
  const card = state.cards.find(c => c.uid === auid);
  if (!card || card.cardId !== ELDGRIM_CARD_ID) return false;
  if (isCardNegated(state, auid)) return false; // Nilrend strips the power
  if (card.overextendRound === state.round) return false; // once per round
  const fig = state.figures.find(f => f.cardUid === auid && f.at != null);
  if (!fig) return false;
  if (fig.wounds + 1 >= cardDefFor(state, fig).life) return false; // must survive the wound
  // "After taking a turn" (card text): Eldgrim must have actually taken his turn — moved,
  // ended his move, or attacked — before he may press on. This honours the timing AND stops
  // a player from wasting the self-wound by triggering it before doing anything.
  return state.movementEnded
    || state.movedFigureIds.includes(fig.id)
    || state.turnAttacks.some(a => a.attackerId === fig.id);
}

/** Eldgrim OVEREXTEND ATTACK (verified card text): place an unblockable wound on Eldgrim and take
 *  ANOTHER turn with him — reset the per-turn scratch but keep him the active card (his Order Marker
 *  stays revealed), so the player moves + attacks again. Once per round; he must survive the wound. */
function doOverextend(state: HSState, seat: number, figureId: string): HSResult {
  if (!canOverextend(state, seat)) return { error: 'Eldgrim can’t Overextend right now' };
  const auid = getActiveCardUid(state)!;
  const active = state.figures.find(f => f.cardUid === auid && f.at != null);
  if (!active || active.id !== figureId) return { error: 'Overextend uses the active Eldgrim figure' };
  const s = clone(state);
  const f = s.figures.find(x => x.id === figureId)!;
  const card = s.cards.find(c => c.uid === f.cardUid)!;
  f.wounds += 1; // unblockable self-wound (canOverextend guarantees he survives)
  card.overextendRound = s.round; // spent for this round
  // FRESH turn: clear the per-turn scratch but keep Eldgrim active so he can move + attack again.
  s.movedFigureIds = [];
  s.turnAttacks = [];
  s.stepMove = undefined;
  s.movementEnded = false;
  s.moveHistory = [];
  resetTurnScratch(s);
  pushLog(s, 'power', `${playerName(s, seat)}'s Eldgrim Overextends — takes a wound and presses on for another turn.`);
  return s;
}

function doEndTurn(state: HSState, seat: number): HSResult {
  const s = clone(state);
  pushLog(s, 'info', `${playerName(s, seat)} ends the turn.`);
  s.turnSeat = null;
  s.movedFigureIds = [];
  s.turnAttacks = [];
  s.stepMove = undefined;
  s.movementEnded = false;
  s.moveHistory = [];
  resetTurnScratch(s);
  if (advanceSlot(s)) beginTurnOrSkip(s);
  return s;
}

// ============================================================================
// Registry contract
// ============================================================================

// ============================================================================
// AI OPPONENT (deterministic). `aiNextAction` returns the next INTENT for a bot
// `seat` given the phase; the SERVER (ai_step) rolls any dice and applies it,
// exactly like a human action. Pure — no Math.random — so it is reproducible
// and testable. Never throws; returns null when the seat has nothing to do (the
// driver then advances / ends the turn). A first FUNCTIONAL pass: draft a strong
// army, deploy, then advance on the enemy and attack the best target. Special
// powers / fancier strategy come later — it only takes normal moves + attacks.
// ============================================================================

/** Living enemy figures of `seat` (a different team) that are on the board. */
function aiEnemies(state: HSState, seat: number): Figure[] {
  const myTeam = teamOfSeat(state, seat);
  return state.figures.filter(f => f.at != null && figureAlive(f) && teamOfSeat(state, f.ownerSeat) !== myTeam);
}

/** Path distance from `from` to the nearest enemy (Infinity if none/unreachable). */
function aiNearestEnemyDist(state: HSState, from: HexKey, enemies: Figure[]): number {
  const cells = MAPS[state.mapId]?.cells;
  if (!cells) return Infinity;
  let best = Infinity;
  for (const e of enemies) {
    const d = rangeDistance(cells, from, e.at!);
    if (d != null && d < best) best = d;
  }
  return best;
}

/** Movement-aware step distance to the nearest enemy, as a BFS field flooded from
 *  every enemy hex over edges a figure can WALK (height step < its Height, so a
 *  height-15 wall is impassable) — UNLIKE rangeDistance, which counts straight
 *  THROUGH walls and traps the greedy mover against one (it never takes the step
 *  AROUND because that briefly raises the through-wall distance). The mover then
 *  steps to cut its own field value, routing around walls. A flyer ignores height
 *  (all edges open); unreachable hexes are absent (the caller reads Infinity). */
function aiMoveDistField(state: HSState, enemies: Figure[], cardHeight: number, flying: boolean): Map<HexKey, number> {
  const cells = MAPS[state.mapId]?.cells;
  const dist = new Map<HexKey, number>();
  if (!cells) return dist;
  let frontier: HexKey[] = [];
  for (const e of enemies) for (const h of figureHexes(e)) if (cells[h] && !dist.has(h)) { dist.set(h, 0); frontier.push(h); }
  for (let d = 1; frontier.length; d++) {
    const next: HexKey[] = [];
    for (const k of frontier) {
      const hk = cells[k].height ?? 0;
      for (const n of neighborKeys(k)) {
        if (dist.has(n) || !cells[n]) continue;
        if (!flying && Math.abs((cells[n].height ?? 0) - hk) >= cardHeight) continue; // a wall is impassable
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Rough value of an attack: expected unblocked skulls (half the attack dice
 *  minus half the defence dice), with a bonus for a likely kill and the target's
 *  point value. -Infinity if the attack is illegal. */
function aiAttackScore(state: HSState, attacker: Figure, target: Figure): number {
  const req = attackDiceRequirements(state, attacker.id, target.id);
  if (!req) return -Infinity;
  // `req.attack` already folds in the attacker's HEIGHT advantage (effectiveAttackDice),
  // so attacks from high ground naturally score higher.
  const expDmg = Math.max(0, req.attack * 0.5 - req.defense * 0.5);
  const tdef = cardDefFor(state, target);
  const remainingLife = tdef.life - (target.wounds ?? 0);
  // A likely KILL is worth a lot (removes the enemy for good). Otherwise weight by
  // expected wounds, the enemy's THREAT (its Attack — kill dangerous units first),
  // and its point value (trade up).
  const likelyKill = expDmg >= remainingLife;
  return expDmg * 2 + (likelyKill ? 8 : 0) + tdef.attack * 0.6 + tdef.points / 80;
}

// SYNERGY scoring for the draft — tilt picks toward cards that COMBINE with what's
// already drafted, grounded in the ACTUAL powers (data-driven on species / class /
// range) so the army hangs together instead of being a pile of unrelated models:
//   • Range Enhancement — Deathwalker 9000 boosts adjacent Soulborg GUARDS (Zettian).
//   • Orc Warrior Enh.  — Grimnak boosts adjacent Orc WARRIORS (none in the roster yet).
//   • Attack Aura       — Finn boosts adjacent friendly Range-1 (melee) squads.
//   • Defence Aura      — Thorgrim / Raelin shield clustered friendlies (squads gain most).
// Plus a small SAME-SPECIES cohesion nudge. Score = raw strength (points) PLUS synergy.
const DRAFT_SYN_PTS = 40; // one power synergy ≈ 40 pts of pick value; a species match ≈ 10.
function draftCardScore(state: HSState, army: string[], id: string): number {
  const def = (x: string) => effectiveCardDef(x, state.edition);
  const buffs = (sourceId: string, target: ReturnType<typeof def>): boolean => {
    if (!target) return false;
    switch (sourceId) {
      case 'deathwalker_9000': return target.species === 'Soulborg' && target.unitClass === 'Guards';
      case 'grimnak': return target.species === 'Orc' && target.unitClass === 'Warriors';
      case 'finn': return target.type === 'squad' && target.range <= 1;
      case 'thorgrim':
      case 'raelin': return target.type === 'squad';
      default: return false;
    }
  };
  const cDef = def(id);
  let syn = 0;
  for (const m of army) {
    const mDef = def(m);
    if (buffs(m, cDef)) syn += 1;   // an owned buff-source would enhance this pick
    if (buffs(id, mDef)) syn += 1;  // this pick (a buff-source) would enhance an owned unit
    if (cDef && mDef && cDef.species === mDef.species) syn += 0.25; // same-species core
  }
  return (def(id)?.points ?? 0) + syn * DRAFT_SYN_PTS;
}

/** The strategically-constrained draft candidate set (affordable, with the bodies-first
 *  squad anchor + leave-room-early rules applied). Empty ⇒ the bot should pass. Shared by
 *  the deterministic pick (aiDraft) and the weighted-random pick (aiDraftWeightedPick). */
function draftCandidates(state: HSState, seat: number): string[] {
  const d = state.draft!;
  const ptsOf = (id: string) => effectiveCardDef(id, state.edition)?.points ?? 0;
  const isSquad = (id: string) => effectiveCardDef(id, state.edition)?.type === 'squad';
  const remaining = teamRemainingInDraft(state, seat);
  const affordable = d.pool.filter(id => ptsOf(id) <= remaining);
  if (affordable.length === 0) return [];
  const army = d.armies[seat] ?? [];
  let candidates = affordable;
  // Bodies win — anchor a SQUAD early if the army has none, so it isn't a fragile,
  // easily-outnumbered hero-only force.
  if (army.length <= 2 && !army.some(isSquad)) {
    const squads = affordable.filter(isSquad);
    if (squads.length) candidates = squads;
  }
  // First two picks: leave room for at least one more unit so the army isn't a single model.
  if (army.length < 2) {
    const poolPts = d.pool.map(ptsOf).filter(p => p > 0);
    const cheapest = poolPts.length ? Math.min(...poolPts) : 0;
    const roomLeavers = candidates.filter(id => remaining - ptsOf(id) >= cheapest);
    if (roomLeavers.length) candidates = roomLeavers;
  }
  return candidates;
}

/** Deterministic draft pick (used by aiNextAction + the tests): the single
 *  highest-scoring candidate. The action layer picks RANDOMLY instead (below). */
function aiDraft(state: HSState, seat: number): HSAction {
  const army = state.draft!.armies[seat] ?? [];
  const candidates = draftCandidates(state, seat);
  if (candidates.length === 0) return { kind: 'draft_pass' };
  const ptsOf = (id: string) => effectiveCardDef(id, state.edition)?.points ?? 0;
  const best = candidates.reduce((b, id) => {
    const sb = draftCardScore(state, army, b), si = draftCardScore(state, army, id);
    return si > sb || (si === sb && ptsOf(id) > ptsOf(b)) ? id : b;
  }, candidates[0]);
  return { kind: 'draft_card', cardId: best };
}

/** WEIGHTED-RANDOM draft pick — stronger cards are likelier but never certain, so the bot
 *  doesn't open with the same unit every game. Weight = score² (a 110-pt squad ≈ 2.4× a
 *  70-pt one head-to-head, not 100%). `rng()` ∈ [0,1) is INJECTED by the action layer, so
 *  the engine stays pure (no Math.random); aiEngineAction calls this for a draft_card. */
function aiDraftWeightedPick(state: HSState, seat: number, rng: () => number): HSAction {
  const army = state.draft!.armies[seat] ?? [];
  const candidates = draftCandidates(state, seat);
  if (candidates.length === 0) return { kind: 'draft_pass' };
  const weighted = candidates.map(id => ({ id, w: Math.max(1, draftCardScore(state, army, id)) ** 2 }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  for (const x of weighted) { r -= x.w; if (r <= 0) return { kind: 'draft_card', cardId: x.id }; }
  return { kind: 'draft_card', cardId: weighted[weighted.length - 1].id }; // float-rounding fallback
}

function aiPlace(state: HSState, seat: number): HSAction {
  const hand = state.hand?.[seat] ?? [];
  if (hand.length === 0) return { kind: 'placement_ready' };
  const sizeOf = (id: string) => {
    const fig = state.figures.find(f => f.id === id);
    return fig ? baseSizeOf(cardDefFor(state, fig)) : 1;
  };
  // Place the BIG (2-hex) figures FIRST — a double-space figure needs a contiguous
  // same-level PAIR, so claim it while the zone is still roomy; 1-hex figures then
  // fill the gaps. Each figure gets a spot VALID FOR ITS SIZE: a 2-hex figure must
  // land on a lead that has a same-level empty tail (placeable2Leads), a 1-hex on
  // any free zone hex (placeableHexes). The OLD code used placeableHexes for every
  // figure and placed hand[0] at free[0] — once 1-hex figures had fragmented the
  // zone, a 2-hex figure's free[0] had no tail, the engine rejected it, and the bot
  // re-proposed the same rejected move forever → placement HARD-LOCKED on a big
  // army (the Star Field's narrow tips, not the flat Training Field). Placing the
  // first figure that fits also means a figure that genuinely can't be placed is
  // skipped (and at worst left in reserve) instead of stalling the whole game.
  const ordered = [...hand].sort((a, b) => sizeOf(b) - sizeOf(a));
  for (const figureId of ordered) {
    const spots = sizeOf(figureId) === 2 ? placeable2Leads(state, seat) : placeableHexes(state, seat);
    const to = [...spots][0];
    if (to) return { kind: 'place_figure', figureId, to };
  }
  return { kind: 'placement_ready' };
}

export function aiPlaceMarkers(state: HSState, seat: number): HSAction {
  // Put 1/2/3 on the strongest cards (by points); X (decoy) on the best. Prefer cards
  // with figures ON THE BOARD — a reserve-only card (e.g. Airborne Elite that missed The
  // Drop this round, rolled BEFORE markers) can't take a turn, so a marker on it is wasted.
  // Fall back to any living card, then to all owned cards, so the 4 markers always land.
  const onBoard = state.cards.filter(c =>
    c.ownerSeat === seat && state.figures.some(f => f.cardUid === c.uid && f.at != null));
  const living = state.cards.filter(c =>
    c.ownerSeat === seat && state.figures.some(f => f.cardUid === c.uid && figureAlive(f)));
  const mine = onBoard.length ? onBoard : living.length ? living : state.cards.filter(c => c.ownerSeat === seat);
  const ranked = [...mine].sort((a, b) =>
    (effectiveCardDef(b.cardId, state.edition)?.points ?? 0) - (effectiveCardDef(a.cardId, state.edition)?.points ?? 0));
  const at = (i: number) => (ranked[i] ?? ranked[ranked.length - 1] ?? mine[0]).uid;
  return {
    kind: 'place_markers',
    assignments: [
      { marker: '1', cardUid: at(0) },
      { marker: '2', cardUid: at(1) },
      { marker: '3', cardUid: at(2) },
      { marker: 'X', cardUid: at(0) },
    ],
  };
}

/** Greedy Drop landing plan: from the legal landing hexes, take `count` that are
 *  CLOSEST to the enemy (Airborne drop in aggressively) while staying mutually
 *  NON-adjacent (the engine rejects adjacent drops). Returns fewer than `count` only
 *  if the board can't fit them — callers guard on the length so a Drop is never rolled
 *  when its placement couldn't complete (a rejected action would freeze the turn). */
function airborneDropPlan(state: HSState, seat: number, legal: HexKey[]): HexKey[] {
  const count = reserveAirborne(state, seat).length;
  const cells = MAPS[state.mapId]?.cells;
  const enemies = aiEnemies(state, seat).filter(e => e.at != null);
  const distToEnemy = (k: HexKey): number => {
    if (!cells || enemies.length === 0) return 0;
    let best = Infinity;
    for (const e of enemies) { const d = rangeDistance(cells, k, e.at!); if (d != null && d < best) best = d; }
    return best;
  };
  // Precompute distToEnemy ONCE per hex — calling it inside the sort comparator reran a
  // rangeDistance flood O(n log n) times over the 661-hex Star Field (seconds per plan).
  const scored = legal.map(k => ({ k, d: distToEnemy(k) })).sort((a, b) => a.d - b.d);
  const sorted = scored.map(x => x.k);
  const chosen: HexKey[] = [];
  for (const k of sorted) {
    if (chosen.length >= count) break;
    if (chosen.some(c => neighborKeys(c).includes(k))) continue;
    chosen.push(k);
  }
  return chosen;
}

function aiResolveChoice(state: HSState, seat: number): HSAction | null {
  const pc = state.pendingChoice;
  if (!pc || pc.seat !== seat) return null;
  if (pc.kind === 'spirit_placement') {
    const ptsOfUid = (uid: string) =>
      effectiveCardDef(state.cards.find(c => c.uid === uid)?.cardId ?? '', state.edition)?.points ?? 0;
    const mine = pc.options.filter(uid => state.cards.find(c => c.uid === uid)?.ownerSeat === seat);
    const pool = mine.length ? mine : pc.options;
    const best = pool.reduce((b, uid) => (ptsOfUid(uid) > ptsOfUid(b) ? uid : b), pool[0]);
    return { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: best } };
  }
  if (pc.kind === 'berserker_charge') {
    // The charge succeeded (15+) — ACCEPT the bonus move (aggression: the bot only
    // initiates a charge when a Viking is still out of range, so the re-move always helps).
    return { kind: 'resolve_choice', choice: { kind: 'berserker_charge', remove: true } };
  }
  if (pc.kind === 'water_clone_place') {
    // Resolve the CURRENT placement (the engine indexes by `chosen.length`), and pick an option not
    // already taken — reading placements[0] dropped every clone after the first.
    const hex = pc.placements[pc.chosen.length]?.options.find(h => !pc.chosen.includes(h));
    if (hex) return { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex } };
  }
  // Glyph of Erland — drag the most valuable ENEMY single-hex figure next to the summoner
  // (so the controller's army can focus it); fall back to any summonable figure. Destination
  // = any empty adjacent space. The pending only opens when both lists are non-empty.
  if (pc.kind === 'glyph_erland') {
    const dests = erlandDestinations(state);
    const summonable = erlandSummonableIds(state);
    if (dests.length === 0 || summonable.length === 0) return null;
    const foeIds = new Set(aiEnemies(state, seat).map(e => e.id));
    const pts = (id: string) => { const f = state.figures.find(x => x.id === id); return f ? cardDefFor(state, f).points : 0; };
    const foes = summonable.filter(id => foeIds.has(id));
    const pool = foes.length ? foes : summonable;
    const figureId = pool.reduce((b, id) => (pts(id) > pts(b) ? id : b), pool[0]);
    return { kind: 'resolve_choice', choice: { kind: 'glyph_erland', figureId, to: dests[0] } };
  }
  // Glyph of Nilrend — STEP 2 only (the server rolls the d20 in the action layer). Negate the
  // biggest threat: on a foe roll (2+) the highest-point opponent card; on an own roll (1)
  // sacrifice the LEAST valuable own card. Returns null until the d20 is recorded.
  if (pc.kind === 'glyph_nilrend') {
    if (pc.d20 == null) return null;
    const eligible = pc.d20 === 1 ? pc.ownCardUids : pc.foeCardUids;
    if (eligible.length === 0) return null;
    const pts = (uid: string) => effectiveCardDef(state.cards.find(c => c.uid === uid)?.cardId ?? '', state.edition)?.points ?? 0;
    const pick = pc.d20 === 1
      ? eligible.reduce((b, u) => (pts(u) < pts(b) ? u : b), eligible[0]) // bad roll — give up the cheapest
      : eligible.reduce((b, u) => (pts(u) > pts(b) ? u : b), eligible[0]); // negate the biggest threat
    return { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', cardUid: pick } };
  }
  // Glyph of Oreld — controller side (the server rolls the d20). On a 2+ name a player from the
  // engine-vetted `victimSeats` to lose an order marker; pick the opponent holding the MOST
  // unrevealed markers (the juiciest turn to steal). Returns null until the d20 is recorded (a 1
  // backfires and is resolved without a choice).
  if (pc.kind === 'glyph_oreld') {
    if (pc.d20 == null || pc.d20 === 1) return null;
    const victims = pc.victimSeats ?? [];
    if (victims.length === 0) return null;
    const unrevealed = (st: number) =>
      state.cards.filter(c => c.ownerSeat === st).reduce((n, c) => n + c.orderMarkers.filter(m => !m.revealed).length, 0);
    const pick = victims.reduce((b, st) => (unrevealed(st) > unrevealed(b) ? st : b), victims[0]);
    return { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', victimSeat: pick } };
  }
  // Glyph of Wannok — controller side (the server rolls the d20). On a 2+ name any living
  // opponent to be cursed. Returns null until the d20 is recorded (or on a 1, which the
  // engine auto-resolves without a choice).
  if (pc.kind === 'glyph_wannok') {
    if (pc.d20 == null || pc.d20 === 1) return null;
    const opp = livingSeats(state).find(st => teamOfSeat(state, st) !== teamOfSeat(state, seat) && state.figures.some(f => f.ownerSeat === st && f.at != null));
    if (opp == null) return null;
    return { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', opponentSeat: opp } };
  }
  // Glyph of Wannok — the cursed opponent sacrifices their LEAST valuable living figure.
  if (pc.kind === 'glyph_wannok_victim') {
    const mine = state.figures.filter(f => f.ownerSeat === seat && f.at != null);
    if (mine.length === 0) return null;
    const pts = (f: Figure) => cardDefFor(state, f).points;
    const pick = mine.reduce((b, f) => (pts(f) < pts(b) ? f : b), mine[0]);
    return { kind: 'resolve_choice', choice: { kind: 'glyph_wannok_victim', figureId: pick.id } };
  }
  // ROLL CEREMONY (Mitonsoul / Sturla) — the bot rolls its figures one at a time: SELECT the next
  // un-rolled figure (highlight), then ROLL it (the d20 is injected by aiEngineAction). Two calls
  // per figure; the ai_step driver loops until the ceremony's seat is no longer this bot.
  if (pc.kind === 'roll_ceremony') {
    if (pc.selectedFigureId == null) {
      const next = pc.queue[0]?.figureIds[0];
      if (!next) return null;
      return { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: next } };
    }
    return { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll' } }; // d20 added by the action layer
  }
  // Glyph of Sturla — place a resurrected figure on the first available start-zone hex.
  if (pc.kind === 'glyph_sturla_place') {
    const hexes = sturlaPlacementHexes(state, pc.figureId);
    if (hexes.length === 0) return null; // engine skips it
    return { kind: 'resolve_choice', choice: { kind: 'glyph_sturla_place', hex: hexes[0] } };
  }
  // Airborne Elite THE DROP — land all reserve Airborne on the planned non-adjacent hexes
  // (closest to the enemy). The Drop is all-or-nothing, so deploy the full squad only when
  // the plan fits every reserve figure; otherwise DECLINE with [] (they stay in reserve).
  // This is what keeps the place-markers gate from deadlocking after a 13+ hit on a board
  // that can't seat a complete, mutually-non-adjacent drop.
  if (pc.kind === 'airborne_drop') {
    const plan = airborneDropPlan(state, seat, theDropHexes(state, seat));
    const full = plan.length === reserveAirborne(state, seat).length ? plan : [];
    return { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: full } };
  }
  // Airborne Elite GRENADE — resolve the CURRENT Elite's throw at the target whose splash
  // catches the most enemies (net of friendly fire). The engine advances the queue + skips
  // target-less Elites, so the head thrower always has ≥1 target here.
  if (pc.kind === 'grenade_throw') {
    const throwerId = pc.throwers[0];
    const foeIds = new Set(aiEnemies(state, seat).map(e => e.id));
    const scored = grenadeTargets(state, throwerId)
      .map(tid => {
        const aff = grenadeDefenders(state, throwerId, tid);
        const foes = aff.filter(x => foeIds.has(x.figureId)).length;
        return { tid, net: foes - (aff.length - foes) };
      })
      .sort((a, b) => b.net - a.net);
    if (scored[0]) return { kind: 'grenade_throw', targetId: scored[0].tid, attackRoll: [], defenseRolls: [] };
  }
  return null;
}

function aiTurn(state: HSState, seat: number): HSAction {
  // Only the card holding the current turn's order marker may act.
  const active = state.cards.find(c =>
    c.ownerSeat === seat && c.orderMarkers.some(m => m.marker === String(state.turnNumber)));
  if (!active) return { kind: 'end_turn' };
  const myFigs = state.figures.filter(f => f.cardUid === active.uid && f.at != null && figureAlive(f));
  const enemies = aiEnemies(state, seat);
  if (myFigs.length === 0 || enemies.length === 0) return { kind: 'end_turn' };

  // legalTargets enforces range / line-of-sight / adjacency, but it also includes
  // ALLIES (friendly fire is legal in the rules) — filter to the other team so the
  // bot never shoots its own side.
  const enemyIds = new Set(enemies.map(e => e.id));
  const enemyTargets = (f: Figure) => legalTargets(state, f.id).filter(id => enemyIds.has(id));

  // ATTACK PHASE (after End Move): take the single best legal attack, else end.
  if (state.movementEnded) {
    // Glyph of Nilrend — a negated active card has NO special powers: skip every special
    // below (proposing one would be rejected by the engine and freeze the bot's turn) and
    // fall straight through to a normal attack / end. Base-stat fighting only.
    if (!isCardNegated(state, active.uid)) {
    // Grimnak CHOMP first — a FREE auto-kill of an adjacent figure that does NOT use his
    // normal attack (he still swings after, next tick, once chomp is spent). Pure
    // aggression: a Squad figure is devoured for certain, a Hero on a d20 of 16+. Always
    // take it; prefer a Squad (guaranteed kill) over a Hero, then by point value.
    const chomps = chompTargets(state, seat);
    if (chomps.length > 0) {
      const figOf = (id: string) => state.figures.find(x => x.id === id)!;
      const isSquad = (id: string) => cardDefFor(state, figOf(id)).type === 'squad';
      const pts = (id: string) => cardDefFor(state, figOf(id)).points;
      const target = chomps.reduce((b, id) => {
        if (isSquad(id) !== isSquad(b)) return isSquad(id) ? id : b; // a guaranteed squad kill wins
        return pts(id) > pts(b) ? id : b;
      }, chomps[0]);
      return { kind: 'chomp', targetId: target, d20: 0 }; // d20 rolled by aiEngineAction
    }

    // SPECIAL ATTACKS — a Big Hero's special either REPLACES its normal attack (Fire
    // Line / Explosion / Ice Shard / Queglix / Wild Swing / Acid Breath) or, like Mind
    // Shackle, comes free BEFORE it. They hit harder or wider, so the bot uses one
    // whenever it catches an enemy; the dice are rolled in aiEngineAction. A Big Hero is
    // a single figure, so `hero` is the active card's figure.
    const hero = myFigs[0];
    const aid = active.cardId;
    const isEnemy = (id: string) => enemyIds.has(id);
    const valueOf = (id: string) => { const f = state.figures.find(x => x.id === id); return f ? cardDefFor(state, f).points : 0; };
    const mostValuable = (ids: string[]) => ids.reduce((b, id) => (valueOf(id) > valueOf(b) ? id : b), ids[0]);

    // Ne-Gok-Sa MIND SHACKLE — FREE (does not use the attack): a 5% (nat-20) seize of the
    // most valuable adjacent enemy's WHOLE army card. Always worth the attempt before the swing.
    if (aid === 'ne_gok_sa') {
      const t = mindShackleTargets(state, seat).filter(isEnemy);
      if (t.length > 0) return { kind: 'mind_shackle', targetId: mostValuable(t), d20: 0 };
    }
    // Mimring FIRE LINE — the straight line that catches the most enemies (net of friendly fire).
    if (aid === 'mimring' && canFireLine(state, hero.id)) {
      let bestDir = -1, bestNet = 0;
      for (let d = 0; d < 6; d++) {
        const aff = fireLineDefenders(state, hero.id, d);
        const foes = aff.filter(x => isEnemy(x.figureId)).length;
        const net = foes - (aff.length - foes);
        if (foes > 0 && net > bestNet) { bestNet = net; bestDir = d; }
      }
      if (bestDir >= 0) return { kind: 'fire_line', attackerId: hero.id, dir: bestDir, attackRoll: [], defenseRolls: [] };
    }
    // Deathwalker 9000 EXPLOSION — the Range-7 target whose blast catches the most enemies.
    // Gate on canExplosion (NOT explosionTargets alone): it enforces "instead of attacking"
    // (turnAttacks === 0), so the bot doesn't try to blast again after it has already fired.
    if (aid === 'deathwalker_9000' && canExplosion(state, seat)) {
      const scored = explosionTargets(state, hero.id).map(id => {
        const aff = explosionDefenders(state, hero.id, id);
        const foes = aff.filter(x => isEnemy(x.figureId)).length;
        return { id, net: foes - (aff.length - foes), foes };
      }).filter(s => s.foes > 0).sort((a, b) => b.net - a.net);
      if (scored.length > 0) return { kind: 'explosion', attackerId: hero.id, targetId: scored[0].id, attackRoll: [], defenseRolls: [] };
    }
    // Nilfheim ICE SHARD BREATH — up to 3 shots; fire the most valuable enemy each tick.
    if (aid === 'nilfheim') {
      const t = iceShardTargets(state, hero.id).filter(isEnemy);
      if (t.length > 0) return { kind: 'ice_shard', attackerId: hero.id, targetId: mostValuable(t), attackRoll: [], defenseRoll: [] };
    }
    // Major Q9 QUEGLIX GUN — focus up to 3 of the 9-die pool on the most valuable enemy.
    if (aid === 'major_q9') {
      const left = queglixDiceLeft(state);
      const t = queglixTargets(state, hero.id).filter(isEnemy);
      if (left > 0 && t.length > 0) {
        const dice = Math.min(3, left) as 1 | 2 | 3;
        return { kind: 'queglix', attackerId: hero.id, targetId: mostValuable(t), dice, attackRoll: [], defenseRoll: [] };
      }
    }
    // Jotun WILD SWING — the target whose splash (it + neighbours) catches the most enemies.
    if (aid === 'jotun') {
      const scored = wildSwingTargets(state, hero.id).filter(isEnemy).map(id => ({
        id, foes: wildSwingDefenders(state, hero.id, id).filter(x => isEnemy(x.figureId)).length,
      })).sort((a, b) => b.foes - a.foes);
      if (scored.length > 0) return { kind: 'wild_swing', attackerId: hero.id, targetId: scored[0].id, attackRoll: [], defenseRolls: [] };
    }
    // Braxas POISONOUS ACID BREATH — gas up to 3 of the most valuable enemies (auto-destroy odds).
    if (aid === 'braxas') {
      const t = acidBreathTargets(state, seat).filter(isEnemy).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 3);
      if (t.length > 0) return { kind: 'acid_breath', attackerId: hero.id, rolls: t.map(targetId => ({ targetId, d20: 0 })) };
    }
    // Jotun THROW — fallback once Wild Swing finds no target: hurl the most valuable
    // small/medium adjacent enemy onto the LOWEST landing hex (a long fall adds wounds; on
    // flat ground the throw itself still deals 2 wounds on an 11+). Ordered AFTER Wild
    // Swing, which catches more (the target plus its neighbours), so Throw only fires when
    // the swing can't reach anyone.
    if (aid === 'jotun' && !state.threwThisTurn) {
      const t = throwTargets(state, seat).filter(isEnemy);
      if (t.length > 0) {
        const targetId = mostValuable(t);
        const lands = throwLandingHexes(state, hero.id, targetId);
        if (lands.length > 0) {
          const to = lands.reduce((b, k) => (heightOfKey(state, k) < heightOfKey(state, b) ? k : b), lands[0]);
          return { kind: 'throw_figure', attackerId: hero.id, targetId, to, throwD20: 0, damageD20: 0 };
        }
      }
    }
    // Tarn BERSERKER CHARGE — after moving, roll a d20; on 15+ the whole squad may move
    // AGAIN (and may charge again). Pure aggression: charge whenever a Viking is still out
    // of attack range so a success closes the gap. Bounded — only before any attack and
    // only while someone needs to move; a sub-15 roll spends it. aiResolveChoice ACCEPTS
    // the bonus move so the Vikings actually advance.
    if (aid === 'tarn_vikings' && !state.berserkerSpent && state.turnAttacks.length === 0) {
      const movedThisCard = state.movedFigureIds.some(id => { const f = state.figures.find(x => x.id === id); return f != null && f.cardUid === active.uid; });
      const someoneOutOfRange = myFigs.some(f => enemyTargets(f).length === 0);
      if (movedThisCard && someoneOutOfRange) return { kind: 'berserker_charge', d20: 0 };
    }
    // Marro WATER CLONE — "instead of attacking", after moving: each living Marro rolls;
    // 15+ (10+ on water) returns a fallen Marro to the board. Only when there IS a fallen
    // Marro to bring back AND nothing is in attack range — never trade a swing for a revive,
    // but rebuild the swarm on an otherwise-idle turn. The placement is resolved in
    // aiResolveChoice (water_clone_place).
    if (aid === 'marro_warriors' && !state.waterClonedThisTurn) {
      const deadMarro = state.figures.some(f => f.cardUid === active.uid && f.at == null);
      const movedThisCard = state.movedFigureIds.some(id => { const f = state.figures.find(x => x.id === id); return f != null && f.cardUid === active.uid; });
      const canAttack = myFigs.some(f => enemyTargets(f).length > 0);
      // turnAttacks === 0 is REQUIRED: Water Clone is "instead of attacking", so it is only
      // legal before any Marro has swung. Without this, once some Marro attacked and the rest
      // ran out of targets the bot tried to clone illegally (engine reject → frozen turn).
      if (deadMarro && movedThisCard && state.turnAttacks.length === 0 && !canAttack) return { kind: 'water_clone', rolls: [] };
    }
    // Airborne Elite GRENADE — a once-per-game squad special that REPLACES the attack.
    // Pull it only when the best throw's splash catches ≥2 enemies (real AoE value);
    // otherwise the squad attacks normally and saves the grenade. doGrenade opens the
    // per-Elite throw queue, resolved in aiResolveChoice.
    if (aid === 'airborne_elite' && canGrenade(state, seat)) {
      let bestFoes = 0;
      for (const f of myFigs) {
        for (const tid of grenadeTargets(state, f.id)) {
          if (!isEnemy(tid)) continue;
          const foes = grenadeDefenders(state, f.id, tid).filter(x => isEnemy(x.figureId)).length;
          if (foes > bestFoes) bestFoes = foes;
        }
      }
      if (bestFoes >= 2) return { kind: 'grenade' };
    }
    } // end Glyph of Nilrend specials-off guard

    let best: { attackerId: string; targetId: string; score: number } | null = null;
    for (const f of myFigs) {
      for (const tid of enemyTargets(f)) {
        const target = state.figures.find(x => x.id === tid);
        if (!target) continue;
        const score = aiAttackScore(state, f, target);
        if (!best || score > best.score) best = { attackerId: f.id, targetId: tid, score };
      }
    }
    if (best) return { kind: 'attack', attackerId: best.attackerId, targetId: best.targetId, attackRoll: [], defenseRoll: [] };
    // OVEREXTEND (Eldgrim) — after a full turn in which he actually FOUGHT, if he's still at
    // full health take a self-wound to act AGAIN rather than ending. canOverextend enforces the
    // once-per-round + survive-the-wound + not-negated rules; the extra wounds===0 gate keeps the
    // bot from grinding itself to the brink. doOverextend's once-per-round flag prevents any loop
    // (the very next aiTurn finds canOverextend false and falls through to end_turn here).
    if (canOverextend(state, seat)) {
      const eld = myFigs[0]; // a Champion is a single figure → the active Eldgrim
      const fought = state.turnAttacks.some(a => a.attackerId === eld.id);
      if (fought && eld.wounds === 0) return { kind: 'overextend', figureId: eld.id };
    }
    return { kind: 'end_turn' };
  }

  // MOVE PHASE: advance each out-of-range figure toward the nearest enemy — or
  // toward a nearby UNCLAIMED glyph, an edge a human always grabs — ONE step at a
  // time to completion, then end the move. A figure already in range stays put to
  // attack. A figure RESTS only on empty hexes — but a 1-hex walker may pass straight THROUGH a
  // friendly's hex (HeroScape lets you move over allies; you just can't STOP on one) so the bot goes
  // through its own line instead of detouring around it. Switching figures or ending the move
  // finalizes the prior one, which the engine requires to be on an empty space.
  const occupied = new Set<HexKey>();
  for (const f of state.figures) { if (f.at) occupied.add(f.at); if (f.at2) occupied.add(f.at2); }
  // Hexes held by an ALLY (mine or a team-mate's) — a walker may transit these; enemy hexes block.
  const allyHexes = new Set<HexKey>();
  for (const f of state.figures) if (!enemyIds.has(f.id)) for (const h of figureHexes(f)) allyHexes.add(h);
  // Grabbable glyphs = those no figure stands on (an enemy-held glyph is contested
  // by attacking, handled in the attack phase). A figure only DETOURS for one that's
  // genuinely close, so the bot never marches its army off the battle to chase a
  // distant glyph. Stepping ONTO a glyph force-stops the figure there (it holds it).
  const cells = MAPS[state.mapId]?.cells;
  const openGlyphs = (state.glyphs ?? []).filter(g => !occupied.has(g.at));
  const glyphStops = new Set((state.glyphs ?? []).map(g => g.at)); // every glyph hex forces a stop
  const GLYPH_CHASE_RANGE = 5;
  const nearestGlyphDist = (from: HexKey): number => {
    if (!cells || openGlyphs.length === 0) return Infinity;
    let best = Infinity;
    for (const g of openGlyphs) { const d = rangeDistance(cells, from, g.at); if (d != null && d < best) best = d; }
    return best;
  };
  // A figure WANTS to move when it can improve its square. A BRAWLER — melee (Range 1) OR a short-"reach"
  // fighter (Range 2-3) — only closes in (it already attacks once a foe is in reach, so it holds). A
  // LONG-RANGE shooter (Range 4+) always re-evaluates so it can KITE — hold the FAR edge of its range,
  // climb to higher ground, or back off when a meleer closes — and bestStepFor returns null (no move)
  // when staying put is already its best square, so it then just shoots. (Owner 2026-06-25: Range 2-3
  // "reach" figures are brawlers, not kiters.)
  const wantsMove = (f: Figure) =>
    effectiveRange(state, f).dice >= 4 ? true : enemyTargets(f).length === 0;
  const bestStepFor = (f: Figure, candidatesOverride?: Iterable<HexKey>): { to: HexKey; score: number } | null => {
    // A figure that already FINISHED its move this turn can't move again — a flyer's one-shot
    // move_figure especially (a walker's legalStepHexes is already empty once finalized, but a
    // flyer's movementDestinations isn't, so without this the bot re-picks a dragon that just flew).
    if ((state.movedFigureIds ?? []).includes(f.id)) return null;
    // Movement-aware distance (routes AROUND height-15 walls) so the mover never gets
    // stuck against a wall it can't see past — the old rangeDistance counted through walls.
    const fDef = cardDefFor(state, f);
    const isFlyer = effectiveFlying(state, fDef);
    const distField = aiMoveDistField(state, enemies, fDef.height, isFlyer);
    const pathDist = (k: HexKey): number => distField.get(k) ?? Infinity;
    const curEnemy = pathDist(f.at!);
    // Don't pull a figure that already holds a glyph off it to chase another — it
    // only leaves its post to actually close on an enemy.
    const onGlyphNow = (state.glyphs ?? []).some(g => figureHexes(f).includes(g.at));
    const curGlyph = onGlyphNow ? Infinity : nearestGlyphDist(f.at!);
    const chaseGlyph = curGlyph <= GLYPH_CHASE_RANGE;
    // AGGRESSION: a hex this figure could ATTACK an enemy from (within its Range,
    // counted around gaps — melee = adjacent) is worth far more than shaving a hex off
    // the gap. This is what makes the bot MOVE UP TO STRIKE — routing around a friendly
    // to reach a firing/melee spot — instead of just tucking in behind it. (Range only;
    // an LOS-blocked hex simply yields no real target so the figure keeps closing.)
    const range = effectiveRange(state, f).dice;
    const isRanged = range >= 4; // a LONG-RANGE shooter (4+) KITES; Range 1-3 (melee + short "reach") BRAWLS (charges)
    const canHitFrom = (hex: HexKey): boolean =>
      !!cells && enemies.some(e => { const d = rangeDistance(cells!, hex, e.at!); return d != null && d >= 1 && d <= range; });
    const nearestEnemyDist = (hex: HexKey): number =>
      !cells ? Infinity : Math.min(...enemies.map(e => rangeDistance(cells, hex, e.at!) ?? Infinity));
    // A DOUBLE-SPACE figure slithers and must FINISH on two LEVEL spaces. The engine
    // permits a mid-slither climb, but the bot ends its move as soon as no better step
    // exists — which would strand the peanut on a non-level footprint (engine reject →
    // frozen turn). So keep a 2-hex figure on ONE level: only step onto hexes at its
    // current height, so every footprint it ever rests on is already level. (Climbing a
    // peanut is a deferred feature; on flat ground this filter is a no-op.)
    const is2hex = f.at2 != null;
    const curH = heightOfKey(state, f.at!);
    // PASS-THROUGH guard: a 1-hex walker may step onto an ally's hex (cross it) only when it can also
    // step straight off onto an empty SAME-level hex this move — so it never finalizes sharing a hex
    // (the engine rejects that → a frozen turn). Flat entry + flat exit keep both steps a guaranteed
    // affordable cost-1, which is exactly the open-field case where the detour showed up.
    const remaining = effectiveMove(state, f).dice - (state.stepMove?.figureId === f.id ? state.stepMove.usedCost : 0);
    const passThroughOk = (hex: HexKey): boolean => {
      if (remaining < 2 || heightOfKey(state, hex) !== curH) return false;
      // A glyph/water hex FORCES A STOP — crossing onto an ally standing on one would strand the
      // figure sharing it (it could never step off). Never pass through those.
      if (glyphStops.has(hex) || cells?.[hex]?.terrain === 'water') return false;
      for (const n of neighborKeys(hex)) {
        if (cells?.[n] && !occupied.has(n) && heightOfKey(state, n) === curH) return true;
      }
      return false;
    };
    // FLYERS pick a whole DESTINATION (the move plays as ONE smooth flight to the landing, animated
    // as an arc — not a hex-by-hex walk); WALKERS step one hex at a time.
    // A GRAPPLE GUN passes its own landing set as the override (an alternative one-space move
    // with a climb waiver); otherwise flyers pick a whole destination and walkers one step.
    const candidates = candidatesOverride ?? (isFlyer ? movementDestinations(state, f) : legalStepHexes(state, f.id));
    // Never step BACK to where THIS move began. That net-zero round-trip is exactly the "dance on/off
    // a glyph" the bot used to do — step off toward a foe, get yanked back by the glyph bonus, repeat —
    // which re-claims the glyph and wastes the whole turn. A figure that leaves a glyph now COMMITS.
    const moveStart = state.stepMove?.figureId === f.id ? state.stepMove.startHex : f.at;
    // One scorer for the candidates AND the current square (so a long-range figure only repositions when
    // it truly improves). BRAWLER (Range 1-3) = AGGRESSION: a strike hex dominates, then close the gap +
    // high ground; a glyph is a small bonus on the way. LONG-RANGE (4+) = KITING: being IN RANGE dominates; among
    // in-range hexes prefer the FAR edge of the range (max standoff) and HIGH ground, and HEAVILY avoid
    // sitting next to a foe (it'd be charged/meleed); when still out of range, close in (but the
    // adjacency penalty still steers it away from ending the step in melee).
    const scoreHex = (hex: HexKey): number => {
      const toDist = pathDist(hex);
      const enemyGain = Number.isFinite(curEnemy) && Number.isFinite(toDist) ? curEnemy - toDist : 0;
      const onG = openGlyphs.some(g => g.at === hex);
      const glyphGain = chaseGlyph ? curGlyph - nearestGlyphDist(hex) : 0;
      const glyphScore = (chaseGlyph ? glyphGain * 2 : 0) + (onG ? 14 : 0);
      const canHit = canHitFrom(hex);
      if (isRanged) {
        const ne = nearestEnemyDist(hex);
        const standoff = Math.min(ne, range); // reward distance up to the range edge — no point fleeing past it
        const adjacent = ne <= 1 ? 60 : 0;     // a shooter next to a foe gets charged → big penalty
        return (canHit ? 80 : 0) + (canHit ? standoff * 6 : enemyGain * 4) + heightOfKey(state, hex) * 1.5 + glyphScore - adjacent;
      }
      return (canHit ? 50 : 0) + enemyGain * 4 + glyphScore + heightOfKey(state, hex);
    };
    let best: { to: HexKey; score: number } | null = null;
    for (const to of candidates) {
      if (occupied.has(to)) {
        // Cross an ally (don't detour) — 1-hex ground walker only, and only with a guaranteed empty
        // SAME-level hex to step off onto next. Enemy hexes always block.
        if (is2hex || isFlyer || !allyHexes.has(to) || !passThroughOk(to)) continue;
      }
      if (to === moveStart) continue;
      if (is2hex && !isFlyer && heightOfKey(state, to) !== curH) continue; // level-keep is a WALKING-peanut limit only
      const toDist = pathDist(to);
      const enemyGain = Number.isFinite(curEnemy) && Number.isFinite(toDist) ? curEnemy - toDist : 0;
      const glyphGain = chaseGlyph ? curGlyph - nearestGlyphDist(to) : 0;
      // Make progress toward SOMETHING — a strike hex, the enemy, or a nearby glyph. A pure
      // sideways/backward step with no payoff is skipped so we never stall — but a ranged retreat that
      // STAYS in range (canHit) is a real payoff and survives this guard.
      if (enemyGain <= 0 && glyphGain <= 0 && !openGlyphs.some(g => g.at === to) && !canHitFrom(to)) continue;
      const score = scoreHex(to);
      if (!best || score > best.score) best = { to, score };
    }
    // RANGED hold rule: only SKIP a move when the shooter is ALREADY in range — then a marginal
    // reposition isn't worth the shuffle, so it holds + attacks. When still OUT of range it must always
    // advance to a firing spot (the margin must NEVER freeze the approach, or armies never close).
    if (isRanged && canHitFrom(f.at!) && best && best.score <= scoreHex(f.at!) + 6) return null;
    return best;
  };
  // Finish the in-progress figure's walk before switching to another.
  // If it's mid-walk SHARING an ally's hex (it passed through one), it MUST step off to an empty hex
  // before anything else — finalizing on a shared hex is illegal (a frozen turn). passThroughOk only
  // ever let it onto a hex from which such an empty step is guaranteed, so this always finds one.
  const exitStepOffShared = (f: Figure): HexKey | null => {
    const distField = aiMoveDistField(state, enemies, cardDefFor(state, f).height, false);
    let pick: { to: HexKey; d: number } | null = null;
    for (const to of legalStepHexes(state, f.id)) {
      if (occupied.has(to)) continue; // must land on an empty hex
      const d = distField.get(to) ?? Infinity;
      if (!pick || d < pick.d) pick = { to, d };
    }
    return pick?.to ?? null;
  };
  const movingFig = state.stepMove ? myFigs.find(f => f.id === state.stepMove!.figureId) : null;
  if (movingFig) {
    const sharing = movingFig.at != null
      && state.figures.some(x => x.id !== movingFig.id && !enemyIds.has(x.id) && figureHexes(x).includes(movingFig.at!));
    if (sharing) {
      const exit = exitStepOffShared(movingFig);
      if (exit) return { kind: 'move_step', figureId: movingFig.id, to: exit };
    }
    if (wantsMove(movingFig)) {
      const step = bestStepFor(movingFig);
      if (step) return { kind: 'move_step', figureId: movingFig.id, to: step.to };
    }
  }
  // --- Theracus CARRY — his flight ferries an unengaged adjacent ally toward the front.
  // Whenever Theracus is advancing anyway (no enemy in his own range), bring the ally that
  // gains the most ground: a free tempo boost that walks the slow squad up the board. One
  // carry_move flies Theracus AND sets the passenger down adjacent to his landing; the takeoff
  // swipes / fall are rolled in aiEngineAction. carryPassengers is empty unless the active card
  // is Theracus before he has moved, so this is a no-op for every other army.
  const carryable = carryPassengers(state, seat);
  if (carryable.length > 0 && cells) {
    const theracus = myFigs[0]; // Theracus is a single Champion → the active figure
    // Carry REPLACES the whole move, so only ferry from a standstill: not already moved, and not
    // mid-walk (any non-step action finalizes an open step → "already moved" on the carry).
    if (theracus && wantsMove(theracus) && !(state.movedFigureIds ?? []).includes(theracus.id) && state.stepMove?.figureId !== theracus.id) {
      const enemyDistOf = (k: HexKey): number => Math.min(...enemies.map(e => rangeDistance(cells, k, e.at!) ?? Infinity));
      // Theracus flies as far forward as he can — the reachable landing closest to an enemy.
      let to: HexKey | null = null;
      let toD = Infinity;
      for (const d of movementDestinations(state, theracus)) {
        if (occupied.has(d)) continue;
        const nd = enemyDistOf(d);
        if (nd < toD) { toD = nd; to = d; }
      }
      if (to) {
        // Ferry the ally whose set-down ends closest to the front (it must actually gain ground).
        let pick: { passengerId: string; passengerTo: HexKey; gain: number } | null = null;
        for (const pid of carryable) {
          const p = state.figures.find(f => f.id === pid);
          if (!p || p.at == null) continue;
          const here = enemyDistOf(p.at);
          for (const pTo of carryLandingHexes(state, theracus.id, to, pid)) {
            const gain = here - enemyDistOf(pTo);
            if (!pick || gain > pick.gain) pick = { passengerId: pid, passengerTo: pTo, gain };
          }
        }
        if (pick && pick.gain > 0) {
          return { kind: 'carry_move', figureId: theracus.id, to, passengerId: pick.passengerId, passengerTo: pick.passengerTo };
        }
      }
    }
  }

  let bestMove: { figureId: string; to: HexKey; score: number; kind: 'move_figure' | 'move_step' | 'grapple_move' } | null = null;
  for (const f of myFigs) {
    if (!wantsMove(f)) continue;
    const fly = effectiveFlying(state, cardDefFor(state, f));
    const step = bestStepFor(f);
    if (step && (!bestMove || step.score > bestMove.score)) {
      // A FLYER takes its whole flight in ONE move (a smooth arc to the landing); a walker steps a hex.
      bestMove = { figureId: f.id, to: step.to, score: step.score, kind: fly ? 'move_figure' : 'move_step' };
    }
    // Sgt. Drake's GRAPPLE GUN — an ALTERNATIVE one-space move that scales terrain a normal
    // step can't (climb up to its cap, land adjacent to ANY figure). Score its landings with
    // the same strike/closing/height heuristic and prefer it only when it STRICTLY beats Drake's
    // normal step — on flat ground the two tie and the step wins, so flat-map play is unchanged.
    // grappleDestinations is empty unless the figure has a Grapple Gun. NEVER offer it to a
    // figure already mid-walk: Grapple is "instead of the normal move", and any non-step action
    // finalizes that open step first (→ marked moved), so a grapple then rejects "already moved".
    const grapples = state.stepMove?.figureId === f.id ? new Set<HexKey>() : grappleDestinations(state, f.id);
    if (grapples.size > 0) {
      const g = bestStepFor(f, grapples);
      if (g && g.score > (step?.score ?? -Infinity) && (!bestMove || g.score > bestMove.score)) {
        bestMove = { figureId: f.id, to: g.to, score: g.score, kind: 'grapple_move' };
      }
    }
  }
  if (bestMove) {
    return { kind: bestMove.kind, figureId: bestMove.figureId, to: bestMove.to };
  }
  return { kind: 'end_move' };
}

/** Turn an AI INTENT into the full engine action, rolling any dice it needs via
 *  the injected `rollers` (so the engine itself stays RNG-free). Mirrors the
 *  server's human attack / move_step dice seam; every other intent passes through
 *  unchanged. Used by both the server's ai_step and the AI simulation test. */
export function aiEngineAction(
  state: HSState,
  intent: HSAction,
  rollers: { rollDie: () => CombatFace; rollDice: (n: number) => CombatFace[]; d20: () => number; rng?: () => number },
): HSAction {
  // DRAFT — pick weighted-randomly (stronger cards likelier, not certain) so the bot varies
  // its army each game. ONLY when the caller injects an `rng` (the live action layer passes
  // Math.random); without one — the deterministic tests/fuzzer/playthroughs — we keep the
  // intent's deterministic pick (aiDraft) so those stay reproducible. Engine stays pure.
  if (intent.kind === 'draft_card' && rollers.rng) {
    const seat = state.draft?.turnSeat;
    if (seat != null) return aiDraftWeightedPick(state, seat, rollers.rng);
  }
  if (intent.kind === 'attack') {
    const req = attackDiceRequirements(state, intent.attackerId, intent.targetId);
    return {
      kind: 'attack',
      attackerId: intent.attackerId,
      targetId: intent.targetId,
      attackRoll: rollers.rollDice(req?.attack ?? 0),
      defenseRoll: rollers.rollDice(req?.defense ?? 0),
    };
  }
  if (intent.kind === 'move_step') {
    const cons = stepConsequences(state, intent.figureId, intent.to);
    const c = 'error' in cons ? { tier: 'none' as const, fallDice: 0, leavingEnemyIds: [] as string[] } : cons;
    return {
      kind: 'move_step',
      figureId: intent.figureId,
      to: intent.to,
      ...(c.tier === 'extreme' ? { extremeFallD20: rollers.d20() } : c.fallDice > 0 ? { fallRoll: rollers.rollDice(c.fallDice) } : {}),
      ...(c.leavingEnemyIds.length > 0
        ? { leaveRolls: c.leavingEnemyIds.map(enemyFigureId => ({ enemyFigureId, roll: rollers.rollDie() })) }
        : {}),
    };
  }
  // DESTINATION move (the AI uses this for FLYERS — one smooth flight instead of a hex-by-hex walk).
  // Mirrors the server's move_figure dice seam: a flyer usually needs nothing (it ignores terrain +
  // engagement), but if it STARTED engaged it still takes leaving-engagement swipes, and a fall is
  // rolled if the landing drops it. The engine re-derives the need and validates the roll shapes.
  if (intent.kind === 'move_figure') {
    const mover = state.figures.find(f => f.id === intent.figureId);
    const cons = mover
      ? moveConsequences(state, mover, intent.to, intent.to2)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    return {
      ...intent,
      ...(cons.tier === 'extreme' ? { extremeFallD20: rollers.d20() } : cons.fallDice > 0 ? { fallRoll: rollers.rollDice(cons.fallDice) } : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? { leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({ enemyFigureId, roll: rollers.rollDie() })) }
        : {}),
    };
  }
  // Sgt. Drake GRAPPLE GUN — resolves through the shared move path, so it needs the SAME dice
  // as a normal move: takeoff leaving-engagement swipes if Drake started engaged, and a fall if
  // the one-space hop drops him. The engine re-derives the need and validates the roll shape.
  if (intent.kind === 'grapple_move') {
    const mover = state.figures.find(f => f.id === intent.figureId);
    const cons = mover
      ? moveConsequences(state, mover, intent.to)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    return {
      ...intent,
      ...(cons.tier === 'extreme' ? { extremeFallD20: rollers.d20() } : cons.fallDice > 0 ? { fallRoll: rollers.rollDice(cons.fallDice) } : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? { leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({ enemyFigureId, roll: rollers.rollDie() })) }
        : {}),
    };
  }
  // Theracus CARRY — his flight resolves like any flying move (the passenger set-down needs no
  // dice), so roll Theracus's OWN takeoff swipes / fall from moveConsequences on his landing.
  if (intent.kind === 'carry_move') {
    const mover = state.figures.find(f => f.id === intent.figureId);
    const cons = mover
      ? moveConsequences(state, mover, intent.to)
      : { tier: 'none' as const, fallDice: 0, abandonedEnemyIds: [] as string[] };
    return {
      ...intent,
      ...(cons.tier === 'extreme' ? { extremeFallD20: rollers.d20() } : cons.fallDice > 0 ? { fallRoll: rollers.rollDice(cons.fallDice) } : {}),
      ...(cons.abandonedEnemyIds.length > 0
        ? { leaveRolls: cons.abandonedEnemyIds.map(enemyFigureId => ({ enemyFigureId, roll: rollers.rollDie() })) }
        : {}),
    };
  }
  // Grimnak CHOMP — the engine is RNG-free, so the d20 (only used for a Hero target)
  // is rolled here, matching the server's chomp seam.
  if (intent.kind === 'chomp') {
    return { ...intent, d20: rollers.d20() };
  }
  // Ne-Gok-Sa MIND SHACKLE — single d20 (seizes the card on a natural 20).
  if (intent.kind === 'mind_shackle') {
    return { ...intent, d20: rollers.d20() };
  }
  // BIG-HERO SPECIAL ATTACKS — each mirrors its server-roll seam (actions.ts): the
  // FIXED attack dice are rolled ONCE (the attack is unmodifiable); each affected
  // figure's defense is rolled SEPARATELY from the engine's single-source defender
  // helper (printed defense + auras + height — a defender keeps height vs a special
  // attack, per §117). The engine re-derives the affected set and validates.
  if (intent.kind === 'fire_line') {
    const defs = fireLineDefenders(state, intent.attackerId, intent.dir);
    return { ...intent, attackRoll: rollers.rollDice(4), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollers.rollDice(d.defense) })) };
  }
  if (intent.kind === 'explosion') {
    const defs = explosionDefenders(state, intent.attackerId, intent.targetId);
    return { ...intent, attackRoll: rollers.rollDice(3), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollers.rollDice(d.defense) })) };
  }
  if (intent.kind === 'wild_swing') {
    const defs = wildSwingDefenders(state, intent.attackerId, intent.targetId);
    return { ...intent, attackRoll: rollers.rollDice(4), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollers.rollDice(d.defense) })) };
  }
  // Nilfheim ICE SHARD / Major Q9 QUEGLIX — a single-target special attack: roll the
  // shot's FIXED attack dice (the attack is unmodifiable) + the target's full effective
  // defense (printed + auras + height — a defender keeps height vs a special attack, per
  // the verified §117 grenade example: Samurai = 5 Def + 1 height = 6 dice).
  if (intent.kind === 'ice_shard' || intent.kind === 'queglix') {
    const tgt = state.figures.find(f => f.id === intent.targetId);
    const atk = state.figures.find(f => f.id === intent.attackerId);
    const defDice = tgt && atk ? Math.max(0, effectiveDefenseDice(state, tgt, atk).dice) : 0;
    const atkDice = intent.kind === 'queglix' ? intent.dice : 4;
    return { ...intent, attackRoll: rollers.rollDice(atkDice), defenseRoll: rollers.rollDice(defDice) };
  }
  // Braxas POISONOUS ACID BREATH — one d20 per chosen figure (Squad 8+, Hero 17+ destroy).
  if (intent.kind === 'acid_breath') {
    return { ...intent, rolls: intent.rolls.map(r => ({ targetId: r.targetId, d20: rollers.d20() })) };
  }
  // Tarn BERSERKER CHARGE — single d20 (15+ re-grants the squad's move).
  if (intent.kind === 'berserker_charge') {
    return { ...intent, d20: rollers.d20() };
  }
  // Jotun THROW — the throw d20 (14+ succeeds) + the damage d20 (11+ → 2 wounds).
  if (intent.kind === 'throw_figure') {
    return { ...intent, throwD20: rollers.d20(), damageD20: rollers.d20() };
  }
  // Marro WATER CLONE — one d20 per LIVING Marro Warrior of the active card (mirrors the
  // server seam); the engine validates the set + per-Warrior threshold and collects the
  // placement choices (resolved by aiResolveChoice).
  if (intent.kind === 'water_clone') {
    const activeUid = getActiveCardUid(state);
    const livingMarro = state.figures.filter(f => f.cardUid === activeUid && f.at != null);
    return { kind: 'water_clone', rolls: livingMarro.map(f => ({ marroFigureId: f.id, d20: rollers.d20() })) };
  }
  // Airborne Elite THE DROP — the global d20 (13+ opens the landing placement).
  if (intent.kind === 'the_drop') {
    return { ...intent, d20: rollers.d20() };
  }
  // Airborne Elite GRENADE THROW — 2 attack dice ONCE + each splashed figure's defense.
  // The thrower is the head of the pending throw queue (mirrors the server seam).
  if (intent.kind === 'grenade_throw') {
    const pc = state.pendingChoice;
    const throwerId = pc && pc.kind === 'grenade_throw' ? pc.throwers[0] : '';
    const defs = grenadeDefenders(state, throwerId, intent.targetId);
    return { ...intent, attackRoll: rollers.rollDice(2), defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: rollers.rollDice(d.defense) })) };
  }
  // ROLL CEREMONY roll — the bot "presses Roll"; the d20 is rolled server-side here (the engine
  // validates it 1..20 at resolution), mirroring the human path's makeMoveHS injection.
  if (intent.kind === 'resolve_choice' && intent.choice.kind === 'roll_ceremony_roll') {
    return { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll', d20: rollers.d20() } };
  }
  return intent;
}

/** A BOT seat that currently owes an action (drives the server ai_step loop), or
 *  null when every pending action belongs to a human. */
export function aiPendingSeat(state: HSState): number | null {
  const isBot = (seat: number) => state.players.find(p => p.seat === seat)?.bot === true;
  if (state.pendingChoice && isBot(state.pendingChoice.seat)) return state.pendingChoice.seat;
  if (state.phase === 'draft') {
    const ts = state.draft?.turnSeat;
    return ts != null && isBot(ts) ? ts : null;
  }
  if (state.phase === 'placement') {
    const ready = state.placementReady ?? [];
    return state.players.find(p => p.bot && !ready.includes(p.seat))?.seat ?? null;
  }
  if (state.phase !== 'playing') return null;
  if (state.subPhase === 'place_markers') {
    // While a HUMAN still owes The Drop (the place-markers gate blocks EVERYONE until the Airborne seat
    // rolls), the bots can't act — return null so the host's driver WAITS for the human instead of
    // firing a blocked marker-place whose recovery used to consume the human's Drop (owner 2026-06-25:
    // "Roll for drop showed for a brief moment then went away with no chance to bring them in").
    if (state.players.some(p => !p.bot && canTheDrop(state, p.seat))) return null;
    const ready = state.markersReady ?? [];
    const living = livingSeats(state);
    return state.players.find(p => p.bot && living.includes(p.seat) && !ready.includes(p.seat))?.seat ?? null;
  }
  if (state.turnSeat != null && isBot(state.turnSeat)) return state.turnSeat;
  return null;
}

/** The next intent for an AI `seat`, or null if it has nothing to do right now. */
export function aiNextAction(state: HSState, seat: number): HSAction | null {
  if (state.pendingChoice?.seat === seat) return aiResolveChoice(state, seat);
  if (state.phase === 'draft') return state.draft?.turnSeat === seat ? aiDraft(state, seat) : null;
  if (state.phase === 'placement') return (state.placementReady ?? []).includes(seat) ? null : aiPlace(state, seat);
  if (state.phase !== 'playing') return null;
  if (state.subPhase === 'place_markers') {
    if ((state.markersReady ?? []).includes(seat)) return null;
    // THE DROP must be rolled before order markers, and the place-markers gate
    // (doPlaceMarkers) blocks markers until this seat has rolled. So ALWAYS roll
    // when able — the roll sets airborneDropRound (hit or miss), which clears the
    // gate. On a 13+ hit we then resolve the landing in aiResolveChoice, deploying
    // a full squad or declining if the board can't fit one. Gating the roll here on
    // "can a full plan fit" would leave the gate set and freeze the room forever.
    if (canTheDrop(state, seat)) return { kind: 'the_drop', d20: 0 };
    return aiPlaceMarkers(state, seat);
  }
  if (state.turnSeat === seat) return aiTurn(state, seat);
  return null;
}

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
  // Glyphs are placed power-side-DOWN — their identity is secret until a figure stops on one. Mask
  // the id of every face-down glyph so a modified/devtools client can't read it off the projected
  // wire state (the UI already renders these as "?"; the real id returns the instant it flips
  // faceUp server-side). Applies to all viewers — glyphs are neutral, hidden from everyone.
  next.glyphs = next.glyphs.map(g => (g.faceUp ? g : { ...g, id: 'hidden' as HSGlyphId }));
  // STRIP the glyph SEED from the wire: generateGlyphs(seed) is deterministic and the map (incl.
  // glyphAnchors) is in the client bundle, so a modified client holding the seed could recompute
  // every face-down glyph's id — defeating the mask above. The server keeps it on the DB row; the
  // layout is already materialized into `glyphs`, so clients never need the seed.
  delete next.glyphSeed;
  return next;
}

// ============================================================================
// Small helpers
// ============================================================================

function clone(state: HSState): HSState {
  return JSON.parse(JSON.stringify(state)) as HSState;
}

function pushLog(s: HSState, tag: HSLogEntry['tag'], text: string, seat?: number): void {
  s.logSeq += 1;
  s.log.push({ seq: s.logSeq, text, tag, ...(seat != null ? { seat } : {}) });
  if (s.log.length > LOG_MAX) s.log = s.log.slice(-LOG_MAX);
}

/** Record a non-combat d20 roll (initiative + every d20 special power) so the UI
 *  can pop a dice overlay for it — the same prominence attacks get. Additive: the
 *  caller still pushes its own log line; this only sets the shared `lastRoll` with
 *  a fresh monotonic `seq` the UI watches. */
function setLastRoll(s: HSState, roll: Omit<LastRoll, 'seq'>): void {
  s.lastRoll = { ...roll, seq: (s.lastRoll?.seq ?? 0) + 1 };
}

/** Record a transient breath/line VFX (3D board only) — source hex + hit hexes, with a
 *  fresh seq so every viewer replays it once. Drop empty target sets (nothing to show). */
function setEffect(s: HSState, kind: NonNullable<HSState['lastEffect']>['kind'], from: HexKey | null, to: (HexKey | null)[]): void {
  const hits = to.filter((h): h is HexKey => h != null);
  if (from == null || hits.length === 0) return;
  s.lastEffect = { kind, from, to: hits, seq: (s.lastEffect?.seq ?? 0) + 1 };
}

export function cardDef(cardId: string): HSCardDef {
  return HS_CARDS[cardId];
}

function cardDefFor(state: HSState, fig: Figure): HSCardDef {
  const card = state.cards.find(c => c.uid === fig.cardUid);
  // Resolve through the active edition so Classic combat stats (e.g. Raelin/Marro
  // Range, Izumi Attack) are what the engine actually fights with.
  const def = effectiveCardDef(card?.cardId ?? '', state.edition) ?? HS_CARDS.finn;
  // Glyph of Nilrend negation — strip the PASSIVE power flags so every read-site
  // (movement/defense: flying, ghost walk, disengage, stealth dodge, counter strike,
  // Thorian Speed, grapple) sees them off. Printed STATS (attack/defense/move/range/
  // life/size/height/id/species) are kept — a negated card still fights at base stats.
  if (isCardNegated(state, fig.cardUid)) {
    return {
      ...def,
      flying: false,
      ghostWalk: false,
      disengage: false,
      stealthDodge: false,
      counterStrike: false,
      thorianSpeed: false,
      grappleGun: 0,
    };
  }
  return def;
}

/** The PERMANENT Spirit mods on `fig`'s army card (slice 4). Defaults to 0/0 if
 *  the card is missing or the fields are absent (slice-2/3 saves). */
function cardModFor(state: HSState, fig: Figure): { attackMod: number; defenseMod: number; moveMod: number } {
  const card = state.cards.find(c => c.uid === fig.cardUid);
  // A Glyph-of-Nilrend-NEGATED card drops to base stats — that includes any Warrior's-Spirit bonus
  // (attack/defense/move) it had been granted. Owner ruling 2026-06-24: "special bonus from Warrior's
  // Spirit and the like will also be negated." So a negated card contributes zero card-mods.
  if (!card || isCardNegated(state, fig.cardUid)) return { attackMod: 0, defenseMod: 0, moveMod: 0 };
  return { attackMod: card.attackMod ?? 0, defenseMod: card.defenseMod ?? 0, moveMod: card.moveMod ?? 0 };
}

function cardHasLivingFigures(state: HSState, cardUid: string): boolean {
  return state.figures.some(f => f.cardUid === cardUid && figureAlive(f));
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
