// Boggle — 4×4 letter grid, simultaneous 3-minute race to find words.
// Words form by chaining adjacent dice (h/v/diag), no die reused, ≥3 letters.
// Server validates submitted words against an English dictionary AND adjacency.

export const BOARD_SIZE = 4;
export const CELLS = BOARD_SIZE * BOARD_SIZE;
export const MIN_WORD_LEN = 3;
export const DEFAULT_DURATION_MS = 3 * 60 * 1000; // 3 minutes

/** Original 1976 Boggle dice. Each die has 6 letters; one face is rolled per game. */
export const DICE: string[] = [
  'AAEEGN', 'ABBJOO', 'ACHOPS', 'AFFKPS',
  'AOOTTW', 'CIMOTU', 'DEILRX', 'DELRVY',
  'DISTTY', 'EEGHNW', 'EEINSU', 'EHRTVW',
  'EIOSST', 'ELRTTY', 'HIMNUQ', 'HLNNRZ',
];

export type BogglePlayer = {
  playerId: string;
  username: string;
  seat: number;
  /** Words this player has submitted (uppercase, deduped per player). */
  words: string[];
};

export type BoggleState = {
  phase: 'lobby' | 'playing' | 'finished';
  board: string[];                    // 16 letters, board[row*4 + col]
  startedAt: number | null;           // unix-ms when play started; null in lobby
  duration: number;                   // ms remaining = startedAt + duration - now
  players: BogglePlayer[];
  /** Computed at end of game so clients can render a static scoreboard. */
  results: {
    playerId: string;
    username: string;
    seat: number;
    /** Per-word breakdown: word, points awarded, duplicate (cancels out). */
    breakdown: { word: string; points: number; duplicate: boolean }[];
    total: number;
  }[] | null;
};

// =====================================================================
// Lifecycle
// =====================================================================

export function initialState(): BoggleState {
  return {
    phase: 'lobby',
    board: [],
    startedAt: null,
    duration: DEFAULT_DURATION_MS,
    players: [],
    results: null,
  };
}

export function addPlayer(state: BoggleState, playerId: string, username: string, seat: number): BoggleState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  return {
    ...state,
    players: [...state.players, { playerId, username, seat, words: [] }].sort((a, b) => a.seat - b.seat),
  };
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

/** Roll the 16 dice and place them in a random order to form a 4×4 board. */
export function rollBoard(): string[] {
  const shuffled = shuffle(DICE);
  return shuffled.map(die => die[Math.floor(Math.random() * die.length)]);
}

export function startGame(state: BoggleState, now: number = Date.now()): BoggleState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  if (state.players.length < 2) return { error: 'Need at least 2 players' };
  return {
    ...state,
    phase: 'playing',
    board: rollBoard(),
    startedAt: now,
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
 * Returns the path if found (cell indices), null otherwise.
 */
export function findPath(board: string[], word: string): number[] | null {
  const upper = word.toUpperCase();
  if (upper.length < MIN_WORD_LEN) return null;

  const dfs = (path: number[], remaining: string): number[] | null => {
    if (remaining.length === 0) return path;
    const last = path[path.length - 1];
    const candidates = last === undefined
      ? board.map((_, i) => i)
      : neighbors(last);
    for (const idx of candidates) {
      if (path.includes(idx)) continue;
      if (board[idx] !== remaining[0]) continue;
      const result = dfs([...path, idx], remaining.slice(1));
      if (result) return result;
    }
    return null;
  };

  return dfs([], upper);
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
 * Compute final scores. Words submitted by more than one player are flagged
 * `duplicate: true` and earn 0 points (standard Boggle "cancels out" rule).
 */
export function computeResults(state: BoggleState): BoggleState['results'] {
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

/** Called by the action layer when time has expired to lock in results. */
export function finalize(state: BoggleState): BoggleState {
  if (state.phase !== 'playing') return state;
  return { ...state, phase: 'finished', results: computeResults(state) };
}
