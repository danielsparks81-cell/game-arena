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
import * as hs  from './heroscape';

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

/** Player-facing "How to play" copy, keyed by game id. Kept separate from the
 *  engine-heavy GameDef entries so all the prose lives in one readable block.
 *  The lobby renders this in an info modal (theme → objective → basic rules).
 *  Every game in GAMES should have an entry; lobbyInfo() falls back gracefully. */
export type GameGuide = {
  /** One or two sentences: the setting/flavor + what kind of game it is. */
  theme: string;
  /** How you win, in one sentence. */
  objective: string;
  /** 3–6 short bullets covering the core loop / basic rules. */
  rules: string[];
};

export const GAME_GUIDES: Record<string, GameGuide> = {
  tictactoe: {
    theme: 'The classic 3×3 pencil-and-paper duel — quick, sharp, and endlessly replayable.',
    objective: 'Be the first to line up three of your marks in a row.',
    rules: [
      'Players alternate placing their mark (X or O) on any empty square.',
      'Who goes first is decided randomly.',
      'Three of your marks in a row — horizontal, vertical, or diagonal — wins.',
      'If the board fills with no line, the game is a draw.',
    ],
  },
  connect4: {
    theme: 'Four-in-a-row with gravity: drop your discs and stack toward a winning line.',
    objective: 'Be the first to connect four of your discs in a straight line.',
    rules: [
      'On your turn, drop a disc into a column; it falls to the lowest open slot.',
      'Players alternate colors; the first mover is chosen randomly.',
      'Line up four of your color — horizontal, vertical, or diagonal — to win.',
      'If the grid fills with no four-in-a-row, it’s a draw.',
    ],
  },
  checkers: {
    theme: 'Timeless diagonal-capture strategy on an 8×8 board.',
    objective: 'Capture or trap all of your opponent’s pieces.',
    rules: [
      'Move a piece one square diagonally forward.',
      'Jump over an adjacent enemy piece into the empty square beyond to capture it; chained jumps are allowed.',
      'Reach the far row to crown a King, which can move and capture in both directions.',
      'You lose when you have no pieces left or no legal move.',
    ],
  },
  battleship: {
    theme: 'A hidden-fleet naval guessing duel — deduce where the enemy ships are hiding.',
    objective: 'Sink your opponent’s entire fleet before they sink yours.',
    rules: [
      'Secretly arrange your ships on your grid at the start.',
      'Take turns firing at a coordinate on the enemy grid.',
      'Each shot is reported as a hit or a miss; a ship sinks when all its cells are hit.',
      'The first player to sink every enemy ship wins.',
    ],
  },
  longshot: {
    theme: 'A rowdy horse-race betting game where everyone cheers, wagers, and meddles with the field. 2–8 players.',
    objective: 'Finish the race with the most money.',
    rules: [
      'On your turn, roll the dice to advance one of the horses, then take a single action.',
      'Actions: bet on a horse, buy a horse you own, place a Helmet or Jersey, or mark your concession card.',
      'Owned and bet-on horses pay out depending on whether they finish 1st, 2nd, or 3rd.',
      'The race ends once three horses cross the line; the richest player wins.',
    ],
  },
  boggle: {
    theme: 'A frantic word hunt on a shared grid of letters — everyone races the same board against the clock.',
    objective: 'Score more points than everyone else before time runs out.',
    rules: [
      'All players see the same letter grid and play simultaneously.',
      'Form words by linking adjacent letters (including diagonals); each letter cell is used once per word.',
      'Submit as many valid words as you can before the timer expires.',
      'Longer words are worth more points; words other players also found may not count.',
    ],
  },
  liarsdice: {
    theme: 'A game of bluff and nerve — everyone has hidden dice and the bids keep climbing.',
    objective: 'Be the last player with dice remaining.',
    rules: [
      'Everyone rolls their dice in secret each round.',
      'On your turn, raise the bid for how many of a face are showing across ALL players’ dice — or call “Liar”.',
      'When someone calls Liar, all dice are revealed and counted.',
      'Whoever was wrong loses a die; lose all your dice and you’re out. Last player standing wins.',
    ],
  },
  rps: {
    theme: 'The instant-reveal hand duel everyone already knows.',
    objective: 'Win the most rounds in a best-of match.',
    rules: [
      'Both players secretly choose Rock, Paper, or Scissors.',
      'Choices reveal at the same time.',
      'Rock beats Scissors, Scissors beats Paper, Paper beats Rock; matching picks replay.',
      'First player to reach the round target wins the match.',
    ],
  },
  spellduel: {
    theme: 'A head-to-head wizard’s duel of spell cards, mana, and timing across 40 cards in three rarities.',
    objective: 'Draft a 36-card deck, then reduce your opponent’s HP to zero.',
    rules: [
      'Everyone starts with a fixed 24-card deck; a quick 3-round draft adds 12 cards (each round pick 2 of 5 commons, 1 of 4 uncommons, 1 of 3 rares).',
      'Each turn you gain a mana crystal (up to 10) and refill — spend it to cast spells.',
      'Deal damage, heal, draw, burn (damage over time), shield, silence, copy, and steal.',
      'Hold reaction cards (Counterspell / Reflect) to counter or bounce an opponent’s spell in real time.',
      'Cards come in three rarities: common, silver uncommon, and glowing gold rare.',
      'Manage your hand and tempo; drop your opponent to 0 HP to win.',
    ],
  },
  legendary: {
    theme: 'A Marvel-themed cooperative deck-builder: 1–5 heroes team up against a supervillain Mastermind and their evil Scheme.',
    objective: 'Work together to defeat the Mastermind before the Scheme’s “Evil Wins” timer triggers.',
    rules: [
      'Each turn, draw a 6-card hand and play cards for Attack and Recruit power.',
      'Spend Recruit to buy stronger Hero cards from the HQ into your deck.',
      'Spend Attack to defeat Villains in the City and to wound the Mastermind.',
      'Master Strikes and escaping Villains punish the team; beat the Mastermind to win, or lose if the Scheme completes.',
    ],
  },
  heroquest: {
    theme: 'A cooperative dungeon crawl: up to 4 heroes explore, fight monsters, and complete a quest while an automated Zargon runs the dungeon.',
    objective: 'Complete the quest — survive the dungeon and reach its goal — before the party falls.',
    rules: [
      'On your turn, roll to move, then take one action: attack, search (treasure / traps / secret doors), cast a spell, or open a door.',
      'Combat is resolved with attack and defense dice.',
      'The automated Zargon moves the monsters and springs traps against you.',
      'The heroes win by completing the quest; you lose if all heroes are defeated.',
    ],
  },
  heroscape: {
    theme: 'A hex-battlefield miniatures skirmish: champions, squads, and beasts clash across grass, rock, and water. 2 players, dice-driven combat on 3-D terrain.',
    objective: 'Destroy every figure in the enemy army — the last player with figures on the battlefield wins.',
    rules: [
      'The host picks the battlefield (Training Field, The Knoll, or Ford Crossing) plus a point budget and a mode: DRAFT armies from the 16-card roster, or QUICK BATTLE with the preset Vikings-vs-Marro armies. The game is played in rounds of three turns per player.',
      'Drafting (2 players): both roll a d20 for order (re-roll ties). The high roller picks 1 Army Card, the other picks 2, then you alternate single picks. Each card is unique (taken once total) and you cannot exceed the point budget; pass when you are done (or when nothing is affordable) — passing finishes your army. Then each player arranges their drafted figures in their own start zone before the battle begins.',
      'Each round, both players SECRETLY place order markers 1, 2, 3, and X on their army cards — the numbers schedule which card acts on each of your turns; the X is a pure decoy. Stacking markers on one card is allowed.',
      'Once both players lock in, everyone rolls a d20 for initiative (ties re-roll). On each of your turns the matching marker is revealed and ONLY that card acts: move any of its figures up to their Move, then each may attack once.',
      'Terrain has depth: climbing UP costs 1 extra movement per level (descent is free), a figure can never climb a number of levels equal to or above its Height in one step, and stepping into water ends that figure’s move. Dropping a long way down triggers a falling roll; landing in water is always safe.',
      'Moving next to an enemy ENGAGES you; leaving that engagement lets each abandoned enemy take a free swipe (1 die, no defense). A tall enough cliff between two figures breaks adjacency so they are not engaged.',
      'To attack, the target must be within Range and in a clear, elevation-aware line of sight — tall terrain can block the shot. Standing HIGHER than your foe grants Height Advantage: +1 attack die when you attack from above, +1 defense die when you are attacked from below.',
      'The attacker rolls attack dice (count skulls), the defender rolls defense dice (count shields); each unblocked skull is a wound. A figure is destroyed when its wounds reach its Life; ties favor the defender.',
      'Glyphs sit on the field and force a figure to STOP when it steps on one. While you stand on a permanent glyph it buffs your whole army — Astrid (+1 attack die), Gerda (+1 defense die), Ivor (+4 Range), Valda (+2 Move), or Dagmar (+8 initiative). Kelda is a one-shot healer: only a wounded figure may stop there, and it removes all wounds before the glyph vanishes.',
      'Each army card has a special power. Finn’s Attack Aura gives +1 attack die to adjacent Range-1 friendlies; Thorgrim’s Defensive Aura gives +1 defense die to any adjacent friendly. When a champion is destroyed you place its Spirit on any unique card for a permanent +1. After moving, Tarn Viking Warriors may roll to Berserker Charge (move again on a 15+); instead of attacking, Marro Warriors may Water Clone to return a slain Warrior (15+, or 10+ on water).',
      'More card powers are online: Raelin gives every figure you control within 6 clear-sight spaces +1 defence die; Zettian Guards adjacent to Deathwalker 9000 gain +2 Range; Agent Carr adds +4 attack dice against an adjacent figure; Grimnak boosts adjacent friendly Orc Warriors (+1 attack and +1 defence die); a second Zettian Guard hitting the same target as the first this turn rolls +1 attack die; and Syvarris may attack one extra time each turn (no extra move).',
      'Movement & defence powers: Raelin and Mimring FLY — they ignore elevation and water and pass over figures (no fall, but a take-off while engaged still draws leaving-engagement swipes). Agent Carr can GHOST WALK through any figure and DISENGAGE freely (never swiped when leaving an engagement). Sgt. Drake has THORIAN SPEED (he can only be hit by NORMAL attacks from adjacent figures — no being shot at range) and a GRAPPLE GUN (instead of his normal move, climb up to 25 levels in one space). Krav Maga Agents’ STEALTH DODGE blocks ALL damage from a non-adjacent attacker on a single shield; Izumi Samurai COUNTER STRIKE reflects every excess shield back onto an adjacent normal attacker as an unblockable wound. Airborne Elite, Mimring’s Fire Line, and Ne-Gok-Sa’s Mind Shackle are still being wired up.',
    ],
  },
  yahtzee: {
    theme: 'The classic push-your-luck dice game — chase the big combinations. 1–6 players.',
    objective: 'Finish with the highest total on your scorecard.',
    rules: [
      'Roll five dice up to three times per turn, holding any dice you like between rolls.',
      'Score your result in one open category (three-of-a-kind, full house, straight, Yahtzee, etc.).',
      'Each category can be used only once, so choose where to bank each turn.',
      'Fill the upper section well for a bonus; the highest grand total wins.',
    ],
  },
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
    // Graduated from Beta after the headless fuzzer hardened the engine across
    // 2–8 player counts (see longshot.fuzz.test.ts). Also fixed: refresh_wild
    // now acts as a guaranteed pass for a player with no other legal action.
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
    description: '2-player spell-slinging card duel. Burn, shields, silence, steal, and powerful rares.',
    minPlayers: 2,
    maxPlayers: 2,
    addedOn: '2026-05-20',
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
      const o = (s ?? {}) as {
        phase?: string; seats?: { A?: string; B?: string }; currentSeat?: 'A' | 'B';
        winner?: unknown; pendingReaction?: { reactorSeat?: 'A' | 'B' };
      };
      if (o.phase !== 'playing' || o.winner || !o.currentSeat || !o.seats) return null;
      // During a reaction window the reactor is on the clock, not the caster.
      if (o.pendingReaction?.reactorSeat) return o.seats[o.pendingReaction.reactorSeat] ?? null;
      return o.seats[o.currentSeat] ?? null;
    },
    getOrderedPlayerIds: (s) => {
      // Order by who actually went FIRST (chosen at random at duel start), not seat
      // A→B — otherwise the host always sits on top even when they moved second.
      const o = (s ?? {}) as { seats?: { A?: string; B?: string }; firstSeat?: 'A' | 'B' };
      const order: ('A' | 'B')[] = o.firstSeat === 'B' ? ['B', 'A'] : ['A', 'B'];
      return order.map(k => o.seats?.[k]).filter((x): x is string => !!x);
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
    // Graduated from Beta after the headless fuzzer hardened the engine across
    // the full Mastermind × Scheme × player-count space (see engine.fuzz.test.ts).
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
  heroscape: {
    id: 'heroscape',
    name: 'HeroScape',
    description: 'Hex-battlefield skirmish on 3-D terrain. Draft an army from the 16-card roster (or quick-battle), arrange your figures, then climb for height advantage, roll skulls, and destroy the enemy army.',
    minPlayers: 2,
    maxPlayers: 6,
    addedOn: '2026-06-10',
    beta: true,
    categories: ['strategy', 'dice'],
    initialState: hs.initialState,
    createInitialStateForHost: (h) =>
      hs.createInitialStateForHost({
        userId: h.userId,
        username: h.username,
        accent_color: h.accentColor,
      }),
    addPlayer: ((state, playerId, username, seat, accent_color) =>
      hs.addPlayer(state as hs.HSState, playerId, username, seat, accent_color)
    ) as GameDef['addPlayer'],
    removePlayer: ((s, playerId) => hs.removePlayer(s as hs.HSState, playerId)) as GameDef['removePlayer'],
    // Hidden information: opponents' unrevealed order markers (the X decoy
    // included) project to 'hidden' before state ever leaves the server.
    projectStateForViewer: ((state, viewerId) =>
      hs.projectStateForViewer(state as hs.HSState, viewerId)
    ) as GameDef['projectStateForViewer'],
    getActivePlayerId: (s) => hs.getActivePlayerId(s as hs.HSState),
    getOrderedPlayerIds: (s) => hs.getOrderedPlayerIds(s as hs.HSState),
    computeHistory: (s) => hs.computeHistory(s as hs.HSState),
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
