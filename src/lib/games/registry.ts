// Game registry — single source of truth for every game on the platform.
//
// Each entry combines:
//   • metadata (name, description, min/max players, beta flag) that drives the
//     lobby tiles, room headers, history rows, etc.
//   • engine ops (initialState, getActivePlayerId, getOrderedPlayerIds, optional
//     addPlayer/removePlayer) that the rest of the platform dispatches to
//     instead of switching on `game_type` everywhere.
//
// To add a new game, create the engine file + a `Board` component, then add a
// single entry here. Turn-order display, kick-player, join-room player-bookkeeping,
// member-panel rendering — everything plugs in automatically through this map.

import * as ttt from './tictactoe';
import * as c4  from './connect4';
import * as ck  from './checkers';
import * as bs  from './battleship';
import * as ls  from './longshot';
import * as bg  from './boggle';
import * as ld  from './liarsdice';
import * as yz  from './yahtzee';
import * as rps from './rps';
import * as sd  from './spellduel';
import * as lg  from './legendary';
import * as hq  from './heroquest';

/** Discoverability tags on each game. A game can carry multiple — they don't
    have to be mutually exclusive. Lobby renders these as filter chips so
    players can narrow "show me word games" or "show me quick games" as the
    catalog grows. Add new tags here when a new genre shows up. */
export const GAME_CATEGORIES = [
  'classic',  // long-established titles (TTT, C4, Checkers)
  'strategy', // thinking-game depth
  'dice',     // dice as the primary mechanic
  'word',     // word/letter games
  'party',    // 3+ players, social
  'solo',     // single-player friendly
  'quick',    // typical game under 5 minutes
] as const;
export type GameCategory = typeof GAME_CATEGORIES[number];

/** Display labels for the lobby filter chips. */
export const CATEGORY_LABELS: Record<GameCategory, string> = {
  classic:  'Classic',
  strategy: 'Strategy',
  dice:     'Dice',
  word:     'Word',
  party:    'Party',
  solo:     'Solo',
  quick:    'Quick',
};

export type GameDef = {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** ISO date the game was added to the arena. Drives the Newest/Oldest tile sort. */
  addedOn: string;
  /** When true, UI surfaces "(Beta)" next to the title (lobby tile, room header,
      history rows, invite toasts) so players know the rules / scoring may shift. */
  beta?: boolean;
  /** Discovery tags — see GAME_CATEGORIES. At least one strongly encouraged. */
  categories?: GameCategory[];

  // -------- Engine contract (typed as unknown at the registry boundary; each
  // game's engine handles its own state type internally). --------

  /** Fresh state for a new room. Always required. */
  initialState: () => unknown;
  /** UUID of the player whose turn it currently is, or null if no single
      active player (Boggle simultaneous play, game over, between rounds). */
  getActivePlayerId: (state: unknown) => string | null;
  /** All seated player UUIDs in stable turn order. Used to render the In Game
      section of MembersPanel and to drive the hourglass placement. */
  getOrderedPlayerIds: (state: unknown) => string[];
  /** Multi-player games need to register joiners in their `state.players[]`.
      Omitted for 2-player engines that key off `state.seats`. */
  addPlayer?: (
    state: unknown,
    playerId: string,
    username: string,
    seat: number,
    accent_color?: string,
  ) => unknown;
  /** Mirror of addPlayer for the host-kick flow in the waiting room. */
  removePlayer?: (state: unknown, playerId: string) => unknown;
  /**
   * Derive the game_history row to write when a game finishes. Return null if
   * the game isn't actually finished yet (the caller is just speculatively
   * checking after every state mutation). Lets one unified
   * `recordHistoryIfFinished()` cover every game type instead of the 4-5
   * bespoke `recordXxxHistory()` helpers we used to have.
   */
  computeHistory?: (state: unknown) => {
    winnerId: string | null;
    playerIds: string[];
    /** Optional per-game analytics payload stored in game_history.meta.
     *  Legendary uses it for win-rate stats (mastermind / scheme / hero
     *  classes / player count). */
    meta?: Record<string, unknown>;
  } | null;
  /**
   * Forward-migrate a state from an older shape to today's. Called on every
   * state read so in-flight games (started before a deploy) keep working
   * after engine fields change. Omit if no shape change has ever shipped.
   *
   * Convention: each engine's `initialState()` stamps `state.version = N`.
   * When you bump N (because you renamed a field, made an optional field
   * required, etc.), write the migration here. Old states with version < N
   * get translated to the latest shape. Idempotent — safe to call on
   * already-migrated states.
   */
  migrateState?: (state: unknown) => unknown;
  /**
   * Per-viewer state projection. Lets a game hide private zones (an opponent's
   * hand, a face-down deck) before the state ever leaves the server. Without
   * this, both clients receive the full JSONB state and any player can inspect
   * the opponent's hand via devtools. Returns a new state safe to send to
   * `viewerId`; should NEVER mutate the input. `viewerId` is null for
   * unauthenticated viewers (treat as a spectator).
   *
   * Convention: hidden card slots are replaced with a sentinel string the
   * game's board component renders as a card back. This preserves array
   * lengths (so opponent-hand-size displays still work) without leaking
   * identities.
   *
   * Games without private state can omit this field — `fetchProjectedRoom`
   * will return the raw state unchanged.
   */
  projectStateForViewer?: (state: unknown, viewerId: string | null) => unknown;
  /**
   * Build a fresh state with the host already seated at seat 0. Lets the
   * lobby's `createRoom` + `inviteToGame` skip the per-game switch they used
   * to need. 2-player games just stamp the host into their first seat key
   * (X/R/A); multi-player games call their own `addPlayer`.
   */
  createInitialStateForHost: (host: { userId: string; username: string; accentColor?: string }) => unknown;
};

/**
 * Run any registered migration for this game on the raw state from the DB.
 * Use this at every state-read site (RoomClient, board renderers, server
 * actions that need to mutate state) so in-flight games don't break after
 * engine shape changes. No-op for games without a migration registered.
 */
export function getMigratedState(gameType: string, rawState: unknown): unknown {
  const fn = GAMES[gameType]?.migrateState;
  if (!fn) return rawState;
  try { return fn(rawState); } catch { return rawState; }
}

/**
 * Apply per-viewer projection to a state if the game defines it (e.g.
 * spellduel hides opponents' hand contents). Call this at every BOUNDARY
 * where state crosses from the trusted server to a client: the room
 * page.tsx initial render, the room-refresh server action, etc.
 *
 * Server actions that READ state for engine logic should NOT use this —
 * the engine needs the full state to resolve damage prevention, draws,
 * etc. correctly. Only the client-facing transport gets the projected view.
 */
export function getProjectedState(gameType: string, state: unknown, viewerId: string | null): unknown {
  const fn = GAMES[gameType]?.projectStateForViewer;
  if (!fn) return state;
  try { return fn(state, viewerId); } catch { return state; }
}

// ---- Shared history-shape helpers ----
// 2-player seat-based games (TTT/C4/Checkers/Battleship) all store winner as
// a seat key ('X' / 'O' / 'R' / 'Y' / 'A' / 'B') or 'draw'. This builder
// matches that shape so each registry entry only needs to declare its keys.
function seatBasedHistory(state: unknown) {
  const s = (state ?? {}) as { seats?: Record<string, string>; winner?: string | null };
  if (!s.winner || !s.seats) return null;
  const playerIds = Object.values(s.seats).filter((x): x is string => !!x);
  const winnerId = s.winner === 'draw' ? null : s.seats[s.winner] ?? null;
  return { winnerId, playerIds };
}
// Multi-player engines whose state.winner is already a player UUID (LD/YZ)
// and whose state.players is the seating roster.
function playerIdWinnerHistory(state: unknown) {
  const s = (state ?? {}) as { phase?: string; winner?: string | null; players?: { playerId: string }[] };
  if (s.phase !== 'finished') return null;
  return {
    winnerId: s.winner ?? null,
    playerIds: (s.players ?? []).map(p => p.playerId),
  };
}

// ---------- Small per-game adapters ----------
// Each pulls active/ordered player IDs out of that engine's state. Mirrors what
// the old switch in turnOrder.ts and the SQL trigger in migration 009 do.

function activeByTurnKey<K extends string>(s: unknown, keys: K[]): string | null {
  const o = (s ?? {}) as { seats?: Record<string, string>; turn?: string; winner?: unknown };
  if (o.winner || !o.turn || !o.seats) return null;
  return o.seats[o.turn] ?? null;
}
function orderedBySeats(s: unknown, keys: string[]): string[] {
  const o = (s ?? {}) as { seats?: Record<string, string> };
  return keys.map(k => o.seats?.[k]).filter((x): x is string => !!x);
}

export const GAMES: Record<string, GameDef> = {
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic-Tac-Toe',
    description: 'The classic. First to three in a row wins.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-04-20',
    categories: ['classic', 'quick'],
    initialState: ttt.initialState,
    createInitialStateForHost: (h) => ({ ...ttt.initialState(), seats: { X: h.userId } }),
    getActivePlayerId: (s) => activeByTurnKey(s, ['X', 'O']),
    getOrderedPlayerIds: (s) => orderedBySeats(s, ['X', 'O']),
    computeHistory: seatBasedHistory,
  },
  connect4: {
    id: 'connect4',
    name: 'Connect Four',
    description: 'Drop pieces, get four in a row. 7 columns, 6 rows.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-04-27',
    categories: ['classic', 'quick'],
    initialState: c4.initialState,
    createInitialStateForHost: (h) => ({ ...c4.initialState(), seats: { R: h.userId } }),
    getActivePlayerId: (s) => activeByTurnKey(s, ['R', 'Y']),
    getOrderedPlayerIds: (s) => orderedBySeats(s, ['R', 'Y']),
    computeHistory: seatBasedHistory,
  },
  checkers: {
    id: 'checkers',
    name: 'Checkers',
    description: 'Classic 8×8 checkers. Forced captures, kings, multi-jumps.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-05-12',
    categories: ['classic', 'strategy'],
    initialState: ck.initialState,
    createInitialStateForHost: (h) => ({ ...ck.initialState(), seats: { R: h.userId } }),
    getActivePlayerId: (s) => activeByTurnKey(s, ['R', 'B']),
    getOrderedPlayerIds: (s) => orderedBySeats(s, ['R', 'B']),
    computeHistory: seatBasedHistory,
  },
  battleship: {
    id: 'battleship',
    name: 'Battleship',
    description: 'Place your fleet, then take turns firing shots. Sink them all.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-05-14',
    categories: ['strategy'],
    initialState: bs.initialState,
    createInitialStateForHost: (h) => ({ ...bs.initialState(), seats: { A: h.userId } }),
    getActivePlayerId: (s) => {
      const o = (s ?? {}) as { phase?: string; seats?: Record<string, string>; turn?: string; winner?: unknown };
      if (o.phase !== 'playing' || o.winner || !o.turn || !o.seats) return null;
      return o.seats[o.turn] ?? null;
    },
    getOrderedPlayerIds: (s) => orderedBySeats(s, ['A', 'B']),
    computeHistory: seatBasedHistory,
  },
  longshot: {
    id: 'longshot',
    name: 'Long Shot',
    description: 'Horse-racing dice game. Buy, bet, and influence the race.',
    minPlayers: 2,
    maxPlayers: 8,
    addedOn: '2026-05-17',
    beta: true,
    categories: ['dice', 'party', 'strategy'],
    initialState: ls.initialState,
    createInitialStateForHost: (h) => ls.addPlayer(ls.initialState(), h.userId, h.username, 0, h.accentColor),
    addPlayer: ls.addPlayer as GameDef['addPlayer'],
    removePlayer: ls.removePlayer as GameDef['removePlayer'],
    getActivePlayerId: (s) => {
      const o = (s ?? {}) as {
        players?: { playerId: string; seat: number }[];
        step?: 'roll' | 'action' | 'done';
        activePlayerSeat?: number;
        currentTurnSeat?: number | null;
        winner?: unknown;
      };
      if (o.winner || !Array.isArray(o.players)) return null;
      const seat = o.step === 'action' ? o.currentTurnSeat : o.activePlayerSeat;
      if (seat == null) return null;
      return o.players.find(p => p.seat === seat)?.playerId ?? null;
    },
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { players?: { playerId: string }[] };
      return Array.isArray(o.players) ? o.players.map(p => p.playerId) : [];
    },
    computeHistory: (s) => {
      // CRITICAL: only record history for a COMPLETED race. The server calls
      // recordHistoryIfFinished after every roll/action, and that helper
      // inserts a row whenever computeHistory returns non-null — so returning
      // a winner mid-game wrote a W/L row on every single move (the cause of
      // players racking up dozens of phantom wins/losses per game). Gate on
      // phase === 'finished' like every other engine does.
      const o = (s ?? {}) as { phase?: string };
      if (o.phase !== 'finished') return null;
      // Winner = top of the final-score table. Ties at top + same best-podium
      // result in winnerId=null (treated as a draw for W/L stats).
      const state = s as Parameters<typeof ls.calculateFinalScores>[0];
      const scores = [...ls.calculateFinalScores(state)].sort(ls.compareFinalScores);
      if (scores.length === 0) return null;
      const isTie =
        scores.length > 1 &&
        scores[0].total === scores[1].total &&
        (scores[0].bestPodium ?? 4) === (scores[1].bestPodium ?? 4);
      return {
        winnerId: isTie ? null : scores[0].playerId,
        playerIds: scores.map(x => x.playerId),
      };
    },
  },
  boggle: {
    id: 'boggle',
    name: 'Boggle',
    description: '4×4 letter grid, 3-minute race to find the most words. 2–6 players.',
    minPlayers: 2,
    maxPlayers: 6,
    addedOn: '2026-05-18',
    categories: ['word', 'party', 'quick'],
    initialState: bg.initialState,
    createInitialStateForHost: (h) => bg.addPlayer(bg.initialState(), h.userId, h.username, 0, h.accentColor),
    addPlayer: bg.addPlayer as GameDef['addPlayer'],
    removePlayer: bg.removePlayer as GameDef['removePlayer'],
    // Simultaneous play — no single active player.
    getActivePlayerId: () => null,
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { players?: { playerId: string }[] };
      return Array.isArray(o.players) ? o.players.map(p => p.playerId) : [];
    },
    computeHistory: (s) => {
      const o = (s ?? {}) as {
        phase?: string;
        finalResults?: { playerId: string; total: number }[] | null;
      };
      if (o.phase !== 'finished') return null;
      const ranked = [...(o.finalResults ?? [])].sort((a, b) => b.total - a.total);
      if (ranked.length === 0) return null;
      const tie = ranked.length > 1 && ranked[0].total === ranked[1].total;
      return {
        winnerId: tie ? null : ranked[0].playerId,
        playerIds: ranked.map(r => r.playerId),
      };
    },
  },
  liarsdice: {
    id: 'liarsdice',
    name: "Liar's Dice",
    description: 'Bluffing dice game. Bid the count of a face across all hidden dice — or call liar.',
    minPlayers: 2,
    maxPlayers: 8,
    addedOn: '2026-05-18',
    categories: ['dice', 'party'],
    initialState: ld.initialState,
    createInitialStateForHost: (h) => ld.addPlayer(ld.initialState(), h.userId, h.username, 0, h.accentColor),
    addPlayer: ld.addPlayer as GameDef['addPlayer'],
    removePlayer: ld.removePlayer as GameDef['removePlayer'],
    getActivePlayerId: (s) => {
      const o = (s ?? {}) as {
        phase?: string;
        players?: { playerId: string }[];
        turnIndex?: number;
        winner?: unknown;
      };
      if (o.phase !== 'playing' || o.winner || typeof o.turnIndex !== 'number') return null;
      return o.players?.[o.turnIndex]?.playerId ?? null;
    },
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { players?: { playerId: string }[] };
      return Array.isArray(o.players) ? o.players.map(p => p.playerId) : [];
    },
    computeHistory: playerIdWinnerHistory,
  },
  rps: {
    id: 'rps',
    name: 'Rock-Paper-Scissors',
    description: 'Best of 5. Pick simultaneously, reveal at once.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-05-20',
    categories: ['classic', 'quick'],
    initialState: rps.initialState,
    createInitialStateForHost: (h) => ({ ...rps.initialState(), seats: { A: h.userId } }),
    // Simultaneous reveal — no single "active" player. The board surfaces a
    // "waiting for opponent" cue based on choices[seat] instead.
    getActivePlayerId: () => null,
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { seats?: { A?: string; B?: string } };
      return [o.seats?.A, o.seats?.B].filter((x): x is string => !!x);
    },
    computeHistory: (s) => {
      const o = (s ?? {}) as { winner?: 'A' | 'B' | 'draw' | null; seats?: { A?: string; B?: string } };
      if (!o.winner) return null;
      const playerIds = [o.seats?.A, o.seats?.B].filter((x): x is string => !!x);
      const winnerId =
        o.winner === 'draw' ? null
        : o.winner === 'A' ? (o.seats?.A ?? null)
        : (o.seats?.B ?? null);
      return { winnerId, playerIds };
    },
  },
  spellduel: {
    id: 'spellduel',
    name: 'Spellduel',
    description: '2-player interactive card duel. 8 starter cards with effects, triggers, and combos.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-05-20',
    beta: true,
    categories: ['strategy', 'quick'],
    initialState: sd.initialState,
    migrateState: sd.migrateState,
    projectStateForViewer: ((state, viewerId) =>
      sd.projectStateForViewer(state as sd.SDState, viewerId)
    ) as GameDef['projectStateForViewer'],
    createInitialStateForHost: (h) =>
      sd.createInitialStateForHost({
        userId: h.userId,
        username: h.username,
        accent_color: h.accentColor,
      }),
    // No active player while in lobby (waiting for B); during play, the seat
    // currentSeat → playerId.
    getActivePlayerId: (s) => {
      const o = (s ?? {}) as { phase?: string; seats?: { A?: string; B?: string }; currentSeat?: 'A' | 'B'; winner?: unknown };
      if (o.phase !== 'playing' || o.winner || !o.currentSeat || !o.seats) return null;
      return o.seats[o.currentSeat] ?? null;
    },
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { seats?: { A?: string; B?: string } };
      return [o.seats?.A, o.seats?.B].filter((x): x is string => !!x);
    },
    // We deliberately don't register addPlayer here: spellduel's state.players
    // is keyed by seat ({A, B}) not an array, so it doesn't match the cross-
    // engine "state.players is an array of {playerId,...}" contract. joinRoom
    // handles spellduel's seat-B fill + phase flip in a dedicated branch.
    removePlayer: ((s, playerId) => sd.removePlayer(s as sd.SDState, playerId)) as GameDef['removePlayer'],
    computeHistory: (s) => {
      const o = (s ?? {}) as {
        phase?: string;
        winner?: 'A' | 'B' | 'draw' | null;
        seats?: { A?: string; B?: string };
      };
      if (o.phase !== 'finished' || !o.winner) return null;
      const playerIds = [o.seats?.A, o.seats?.B].filter((x): x is string => !!x);
      const winnerId =
        o.winner === 'draw' ? null
        : o.winner === 'A' ? (o.seats?.A ?? null)
        : (o.seats?.B ?? null);
      return { winnerId, playerIds };
    },
  },
  legendary: {
    id: 'legendary',
    name: 'Legendary',
    description: 'Marvel-themed cooperative deck-builder. Recruit heroes, fight villains, defeat the Mastermind. 1–5 players.',
    minPlayers: 1,
    maxPlayers: 5,
    addedOn: '2026-05-20',
    beta: true,
    categories: ['strategy', 'party'],
    initialState: lg.initialState,
    createInitialStateForHost: (h) =>
      lg.createInitialStateForHost({
        userId: h.userId,
        username: h.username,
        accent_color: h.accentColor,
      }),
    addPlayer: ((state, playerId, username, seat, accent_color) =>
      lg.addPlayer(state as lg.LegendaryState, playerId, username, seat, accent_color)
    ) as GameDef['addPlayer'],
    removePlayer: ((s, playerId) => lg.removePlayer(s as lg.LegendaryState, playerId)) as GameDef['removePlayer'],
    projectStateForViewer: ((state, viewerId) =>
      lg.projectStateForViewer(state as lg.LegendaryState, viewerId)
    ) as GameDef['projectStateForViewer'],
    getActivePlayerId: (s) => lg.getActivePlayerId(s as lg.LegendaryState),
    getOrderedPlayerIds: (s) => lg.getOrderedPlayerIds(s as lg.LegendaryState),
    computeHistory: (s) => lg.computeHistory(s as lg.LegendaryState),
  },
  heroquest: {
    id: 'heroquest',
    name: 'HeroQuest',
    description: 'Cooperative dungeon crawl. 1–4 heroes vs an automated Zargon. Slay Verag in Quest 1.',
    minPlayers: 1,
    maxPlayers: 4,
    addedOn: '2026-05-26',
    beta: true,
    categories: ['strategy', 'party', 'solo'],
    initialState: hq.initialState,
    createInitialStateForHost: (h) =>
      hq.createInitialStateForHost({
        userId: h.userId,
        username: h.username,
        accent_color: h.accentColor,
      }),
    addPlayer: ((state, playerId, username, seat, accent_color) =>
      hq.addPlayer(state as hq.HQState, playerId, username, seat, accent_color)
    ) as GameDef['addPlayer'],
    removePlayer: ((s, playerId) => hq.removePlayer(s as hq.HQState, playerId)) as GameDef['removePlayer'],
    projectStateForViewer: ((state, viewerId) =>
      hq.projectStateForViewer(state as hq.HQState, viewerId)
    ) as GameDef['projectStateForViewer'],
    getActivePlayerId: (s) => hq.getActivePlayerId(s as hq.HQState),
    getOrderedPlayerIds: (s) => hq.getOrderedPlayerIds(s as hq.HQState),
    computeHistory: (s) => hq.computeHistory(s as hq.HQState),
  },
  yahtzee: {
    id: 'yahtzee',
    name: 'Yahtzee',
    description: 'Solo or party. Roll 5 dice, fill a 13-category scorecard chasing a high score.',
    minPlayers: 1,
    maxPlayers: 6,
    addedOn: '2026-05-18',
    categories: ['dice', 'solo', 'party'],
    initialState: yz.initialState,
    createInitialStateForHost: (h) => yz.addPlayer(yz.initialState(), h.userId, h.username, 0, h.accentColor),
    addPlayer: yz.addPlayer as GameDef['addPlayer'],
    removePlayer: yz.removePlayer as GameDef['removePlayer'],
    getActivePlayerId: (s) => {
      const o = (s ?? {}) as {
        phase?: string;
        players?: { playerId: string }[];
        turnIndex?: number;
        winner?: unknown;
      };
      if (o.phase !== 'playing' || o.winner || typeof o.turnIndex !== 'number') return null;
      return o.players?.[o.turnIndex]?.playerId ?? null;
    },
    getOrderedPlayerIds: (s) => {
      const o = (s ?? {}) as { players?: { playerId: string }[] };
      return Array.isArray(o.players) ? o.players.map(p => p.playerId) : [];
    },
    computeHistory: playerIdWinnerHistory,
  },
};

export function getGame(id: string): GameDef | undefined {
  return GAMES[id];
}

/** Title for end-users, with a "(Beta)" suffix if the game is flagged beta. */
export function displayName(g: { name: string; beta?: boolean } | undefined, fallback = 'Game'): string {
  if (!g) return fallback;
  return g.beta ? `${g.name} (Beta)` : g.name;
}
