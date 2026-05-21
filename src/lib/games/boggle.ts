// Boggle — 4×4 letter grid, simultaneous 3-minute race to find words.
// Words form by chaining adjacent dice (h/v/diag), no die reused, ≥3 letters.
// Server validates submitted words against an English dictionary AND adjacency.

export const BOARD_SIZE = 4;
export const CELLS = BOARD_SIZE * BOARD_SIZE;
export const MIN_WORD_LEN = 3;
export const DEFAULT_DURATION_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Modern ("New") Hasbro Boggle dice — same letter pool as the 1976 set but die 11
 * has the combined "Qu" face (since players never get any value out of a bare Q).
 * Each entry is an array of 6 face strings; "Qu" is a 2-letter face that contributes
 * both letters to any word that traces through it.
 */
export const DICE: string[][] = [
  ['A','A','E','E','G','N'],
  ['E','L','R','T','T','Y'],
  ['A','O','O','T','T','W'],
  ['A','B','B','J','O','O'],
  ['E','H','R','T','V','W'],
  ['C','I','M','O','T','U'],
  ['D','I','S','T','T','Y'],
  ['E','I','O','S','S','T'],
  ['D','E','L','R','V','Y'],
  ['A','C','H','O','P','S'],
  ['H','I','M','N','U','Qu'],   // ← Qu combined face
  ['E','E','I','N','S','U'],
  ['E','E','G','H','N','W'],
  ['A','F','F','K','P','S'],
  ['H','L','N','N','R','Z'],
  ['D','E','I','L','R','X'],
];

export type BogglePlayer = {
  playerId: string;
  username: string;
  seat: number;
  /** Player's profile accent color at join time. Optional for back-compat. */
  accent_color?: string;
  /** Words this player has submitted THIS ROUND (uppercase, deduped per player). */
  words: string[];
};

/** Game-mode = stop condition. Picked by the host in the lobby before starting. */
export type BoggleGameMode = '1-round' | '3-rounds' | 'to-50' | 'to-100';

export const GAME_MODE_LABELS: Record<BoggleGameMode, string> = {
  '1-round':  '1 Round',
  '3-rounds': '3 Rounds',
  'to-50':    'First to 50 points',
  'to-100':   'First to 100 points',
};

export type RoundResult = {
  round: number;
  board: string[];
  /** Per-word breakdown for each player in this specific round. */
  scores: {
    playerId: string;
    username: string;
    seat: number;
    breakdown: { word: string; points: number; duplicate: boolean }[];
    total: number;
  }[];
};

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export type BoggleState = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  phase: 'lobby' | 'playing' | 'between-rounds' | 'finished';
  mode: BoggleGameMode;
  /** Current round number (1-indexed). 0 while in lobby. */
  round: number;
  board: string[];                    // 16 letters, board[row*4 + col]
  startedAt: number | null;           // unix-ms when current round started
  duration: number;                   // ms per round
  players: BogglePlayer[];
  /** History of all completed rounds, in order. */
  rounds: RoundResult[];
  /** Final aggregated standings — set only when phase === 'finished'. */
  finalResults: {
    playerId: string;
    username: string;
    seat: number;
    perRound: number[];
    total: number;
  }[] | null;
};

// =====================================================================
// Lifecycle
// =====================================================================

export function initialState(): BoggleState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    mode: '1-round',
    round: 0,
    board: [],
    startedAt: null,
    duration: DEFAULT_DURATION_MS,
    players: [],
    rounds: [],
    finalResults: null,
  };
}

/** Host changes the game mode while still in the lobby. */
export function setGameMode(state: BoggleState, mode: BoggleGameMode): BoggleState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  return { ...state, mode };
}

export function addPlayer(state: BoggleState, playerId: string, username: string, seat: number, accent_color?: string): BoggleState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  return {
    ...state,
    players: [...state.players, { playerId, username, seat, accent_color, words: [] }].sort((a, b) => a.seat - b.seat),
  };
}

/** Host-only: remove a seated player while still in the lobby. */
export function removePlayer(state: BoggleState, playerId: string): BoggleState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

/** Fisher-Yates shuffle (mutates a copy). */
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Roll the 16 dice and place them in a random order to form a 4×4 board.
 * Cells are uppercased; "Qu" becomes "QU" (length 2). Adjacency works per-cell
 * regardless of the cell's letter count.
 */
export function rollBoard(): string[] {
  const shuffled = shuffle(DICE);
  return shuffled.map(die => die[Math.floor(Math.random() * die.length)].toUpperCase());
}

export function startGame(state: BoggleState, now: number = Date.now()): BoggleState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  if (state.players.length < 2) return { error: 'Need at least 2 players' };
  return {
    ...state,
    phase: 'playing',
    round: 1,
    board: rollBoard(),
    startedAt: now,
    players: state.players.map(p => ({ ...p, words: [] })),
  };
}

/** Start the next round (called between rounds, only when game isn't over). */
export function nextRound(state: BoggleState, now: number = Date.now()): BoggleState | { error: string } {
  if (state.phase !== 'between-rounds') return { error: 'Not between rounds' };
  return {
    ...state,
    phase: 'playing',
    round: state.round + 1,
    board: rollBoard(),
    startedAt: now,
    players: state.players.map(p => ({ ...p, words: [] })),
  };
}

/** Returns how many milliseconds remain in the current round, or 0 if expired. */
export function msRemaining(state: BoggleState, now: number = Date.now()): number {
  if (state.phase !== 'playing' || state.startedAt === null) return 0;
  return Math.max(0, state.startedAt + state.duration - now);
}

// =====================================================================
// Word validation & adjacency
// =====================================================================

/** Cells adjacent to `idx` on the 4×4 board (h/v/diag, no wrap). */
function neighbors(idx: number): number[] {
  const r = Math.floor(idx / BOARD_SIZE);
  const c = idx % BOARD_SIZE;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
        out.push(nr * BOARD_SIZE + nc);
      }
    }
  }
  return out;
}

/**
 * Can `word` be traced on `board` following adjacency rules, no cell reused?
 * Returns the path (cell indices) if found, null otherwise. Handles multi-letter
 * cells (e.g. "QU") — those contribute their full letters to the word at once.
 */
export function findPath(board: string[], word: string): number[] | null {
  const upper = word.toUpperCase();
  if (upper.length < MIN_WORD_LEN) return null;

  const dfs = (path: number[], pos: number): number[] | null => {
    if (pos === upper.length) return path;
    const last = path[path.length - 1];
    const candidates = last === undefined
      ? board.map((_, i) => i)
      : neighbors(last);
    for (const idx of candidates) {
      if (path.includes(idx)) continue;
      const cell = board[idx];
      if (upper.substring(pos, pos + cell.length) !== cell) continue;
      const result = dfs([...path, idx], pos + cell.length);
      if (result) return result;
    }
    return null;
  };

  return dfs([], 0);
}

/**
 * Word points per Boggle standard scoring:
 *   3-4 letters → 1 pt, 5 → 2, 6 → 3, 7 → 5, 8+ → 11.
 */
export function pointsFor(word: string): number {
  const n = word.length;
  if (n < 3) return 0;
  if (n <= 4) return 1;
  if (n === 5) return 2;
  if (n === 6) return 3;
  if (n === 7) return 5;
  return 11;
}

// =====================================================================
// Player action: submit a word
// =====================================================================

/**
 * Returns a partial state diff to merge into the room state. Validation that needs
 * the dictionary lives outside the engine (action layer) — this just checks
 * phase, time, length, duplicates, and adjacency.
 */
export function submitWord(
  state: BoggleState,
  playerId: string,
  rawWord: string,
  now: number = Date.now(),
): BoggleState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Round not in progress' };
  if (msRemaining(state, now) <= 0) return { error: "Time's up" };
  const playerIdx = state.players.findIndex(p => p.playerId === playerId);
  if (playerIdx < 0) return { error: 'Not a seated player' };

  const word = rawWord.trim().toUpperCase();
  if (word.length < MIN_WORD_LEN) return { error: `Words must be at least ${MIN_WORD_LEN} letters` };
  if (!/^[A-Z]+$/.test(word)) return { error: 'Letters only' };
  if (state.players[playerIdx].words.includes(word)) return { error: 'Already submitted' };
  if (!findPath(state.board, word)) return { error: "That word can't be traced on the board" };

  const players = state.players.map((p, i) =>
    i === playerIdx ? { ...p, words: [...p.words, word] } : p,
  );
  return { ...state, players };
}

/**
 * Compute this round's scores. Words submitted by more than one player are flagged
 * `duplicate: true` and earn 0 points (standard Boggle "cancels out" rule).
 */
export function computeRoundScores(state: BoggleState): RoundResult['scores'] {
  const counts = new Map<string, number>();
  for (const p of state.players) {
    for (const w of p.words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return state.players.map(p => {
    const breakdown = p.words.map(word => {
      const duplicate = (counts.get(word) ?? 0) > 1;
      const points = duplicate ? 0 : pointsFor(word);
      return { word, points, duplicate };
    });
    const total = breakdown.reduce((sum, b) => sum + b.points, 0);
    return {
      playerId: p.playerId,
      username: p.username,
      seat: p.seat,
      breakdown,
      total,
    };
  });
}

/** Aggregate per-round scores into final standings (sum across rounds). */
export function aggregateTotals(state: BoggleState): NonNullable<BoggleState['finalResults']> {
  return state.players.map(p => {
    const perRound = state.rounds.map(r =>
      r.scores.find(s => s.playerId === p.playerId)?.total ?? 0,
    );
    return {
      playerId: p.playerId,
      username: p.username,
      seat: p.seat,
      perRound,
      total: perRound.reduce((sum, t) => sum + t, 0),
    };
  });
}

/** Does the game stop now given the mode and the current round's results? */
function isGameOver(state: BoggleState): boolean {
  if (state.mode === '1-round')  return state.round >= 1;
  if (state.mode === '3-rounds') return state.round >= 3;
  const totals = aggregateTotals(state);
  if (state.mode === 'to-50')  return totals.some(t => t.total >= 50);
  if (state.mode === 'to-100') return totals.some(t => t.total >= 100);
  return true;
}

/**
 * Called by the action layer when the current round's timer expires. Records the
 * round into `rounds[]` then decides whether to transition to `between-rounds`
 * (more to play) or `finished` (mode's stop condition reached).
 */
export function finalize(state: BoggleState): BoggleState {
  if (state.phase !== 'playing') return state;
  const roundResult: RoundResult = {
    round: state.round,
    board: state.board,
    scores: computeRoundScores(state),
  };
  const withRound: BoggleState = { ...state, rounds: [...state.rounds, roundResult] };

  if (isGameOver(withRound)) {
    return {
      ...withRound,
      phase: 'finished',
      finalResults: aggregateTotals(withRound),
    };
  }
  return { ...withRound, phase: 'between-rounds' };
}
