// Long Shot: a horse-racing dice game.
// Phase 2: full action phase — each round, after the roll, every player takes one of
// five actions (Concession, Helmet, Jersey, Bet, Buy) keyed off the rolled horse number.

export const NUM_HORSES = 8;
export const TRACK_LENGTH = 16;
export const NO_BET_SPACE = 12;
export const STARTING_MONEY = 12;
export const FINISH_POSITIONS = 3;

export const MAX_HELMETS_PER_HORSE = 1;
export const MAX_JERSEYS_PER_HORSE = 1;
export const MAX_WILDS = 3;
export const MAX_BET_PER_ACTION = 3;

export const CONCESSION_ROWS = 4;
export const CONCESSION_COLS = 4;
export const CONCESSION_CELLS = CONCESSION_ROWS * CONCESSION_COLS;  // 16

/** Weighted movement die: one 1, three 2s, two 3s (six physical faces). */
export const MOVEMENT_DIE_FACES = [1, 2, 2, 2, 3, 3] as const;
export const MOVEMENT_DIE_MIN = 1;
export const MOVEMENT_DIE_MAX = 3;

export const HORSE_COLORS = [
  '#dc2626', // 1 - red
  '#eab308', // 2 - yellow
  '#1e3a8a', // 3 - navy blue
  '#c084fc', // 4 - light purple
  '#22c55e', // 5 - green
  '#38bdf8', // 6 - light blue
  '#f97316', // 7 - orange
  '#6b21a8', // 8 - deep purple
];

/** Per-horse cost for the Buy action. Favorites cost more; long shots cost less. */
export const HORSE_COSTS = [10, 10, 8, 8, 6, 6, 4, 4];

/**
 * Bet odds per horse number: [1st place mult, 2nd mult, 3rd mult, past-No-Bet mult].
 * Past-No-Bet always pays 1× the bet if the horse crossed the No-Bet line but didn't finish.
 */
export const BET_ODDS: number[][] = [
  [5, 4, 3, 1],  // horse 1
  [5, 4, 3, 1],  // horse 2
  [6, 5, 4, 1],  // horse 3
  [6, 5, 4, 1],  // horse 4
  [7, 6, 5, 1],  // horse 5
  [7, 6, 5, 1],  // horse 6
  [9, 8, 7, 1],  // horse 7
  [9, 8, 7, 1],  // horse 8
];

/**
 * Concession bonuses (ID + short label). Rendered in a 3×4 grid (3 cols, 4 rows).
 * The two Free $3 bet tiles are intentionally placed at indices 4 and 7 — the two
 * center squares of the grid (middle column, rows 1 and 2).
 * Effects are implemented in Phase 3.
 */
export const CONCESSION_BONUSES = [
  // Row 0 (top): three $7
  { id: 'cash7_a',      label: '+$7',         desc: 'Gain $7' },
  { id: 'cash7_b',      label: '+$7',         desc: 'Gain $7' },
  { id: 'cash7_c',      label: '+$7',         desc: 'Gain $7' },
  // Row 1: back2x2, FREE BET (center), forward2x2
  { id: 'back2x2',      label: '−2 / −2',     desc: 'Move any 2 Horses back 2 each' },
  { id: 'freebet3_a',   label: 'Free $3 bet', desc: 'Place a free $3 bet on any Horse' },
  { id: 'forward2x2',   label: '+2 / +2',     desc: 'Move any 2 Horses forward 2 each' },
  // Row 2: back3, FREE BET (center), forward3
  { id: 'back3',        label: '−3',          desc: 'Move 1 Horse back 3' },
  { id: 'freebet3_b',   label: 'Free $3 bet', desc: 'Place a free $3 bet on any Horse' },
  { id: 'forward3',     label: '+3',          desc: 'Move 1 Horse forward 3' },
  // Row 3 (bottom): helmet, jersey, free horse
  { id: 'helmet_any',   label: 'Helmet',      desc: 'Take Helmet action for any Horse' },
  { id: 'jersey_any',   label: 'Jersey',      desc: 'Take Jersey action for any Horse' },
  { id: 'free_horse',   label: 'Free Horse',  desc: 'Take any Horse from the market for free' },
] as const;

/**
 * Default secondary-movement bars are empty — all secondary movement comes from
 * jerseyMarks (player-placed marks). Players start with a small number of pre-marked
 * jerseys (see genStartingJerseys) so there is some cascading from round 1.
 */
export const SECONDARY_BARS: number[][] = [
  [], [], [], [], [], [], [], [], [],
];

/** Number of jersey marks each player starts the race with (one per jersey horse). */
export const STARTING_JERSEYS = 3;

export type HorseFinish = 1 | 2 | 3 | null;

export type LSHorse = {
  position: number;
  finished: HorseFinish;
};

export type LSPlayer = {
  playerId: string;
  username: string;
  seat: number;
  money: number;
  ownedHorses: number[];        // horse numbers (1-8)
  bets: number[];               // length 8, dollars wagered per horse
  helmets: number[];            // length 8, count of helmet marks per horse (0..MAX_HELMETS_PER_HORSE)
  jerseys: number[];            // length 8, count of jersey marks per horse (0..MAX_JERSEYS_PER_HORSE)
  /**
   * Additional secondary-bar X's this player has marked via the Jersey action.
   * jerseyMarks[rolledHorse - 1] = array of horse numbers (1-8) the player has marked
   * on the rolled horse's secondary movement bar.
   */
  jerseyMarks: number[][];
  wildsUsed: number;            // 0..MAX_WILDS
  concessionMarks: boolean[];   // length CONCESSION_CELLS, true = marked (per-player marks on the shared grid)
  bonusesClaimed: boolean[];    // length CONCESSION_BONUSES.length; mirrors the bonus pool order
  actedThisRound: boolean;
};

export type LSMove = {
  horseIdx: number;
  fromPos: number;
  toPos: number;
  fromFinished: HorseFinish;
  toFinished: HorseFinish;
};

export type LSState = {
  phase: 'lobby' | 'playing' | 'finished';
  round: number;
  activePlayerSeat: number;
  currentTurnSeat: number | null;
  step: 'roll' | 'action' | 'done';
  horseDie: number | null;
  movementDie: number | null;
  horses: LSHorse[];
  finishedCount: number;
  market: number[];
  players: LSPlayer[];
  log: string[];
  rollId: number;
  lastSequence: LSMove[];
  /**
   * Shared concession grid layout for this game. Generated once when the host
   * clicks Start, every player marks on the same arrangement.
   * Length = CONCESSION_CELLS; each entry is a horse number 1..NUM_HORSES.
   */
  concessionGrid: number[];
  /**
   * When set, the named player has just completed a row and/or column on their
   * concession grid and must claim that many bonuses before the round can advance.
   */
  pendingBonus: { playerId: string; count: number } | null;
};

// ---------- Setup ----------

function genConcessionGrid(): number[] {
  // 4 × 4 = 16 cells. Each horse number 1-8 appears exactly twice. Constraints:
  //   1. No number repeats in any row.
  //   2. No number repeats in any column.
  //   3. No number is adjacent to itself (including diagonally) — Chebyshev distance ≥ 2.
  const base = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];

  const isAdjacent = (i1: number, i2: number): boolean => {
    const r1 = Math.floor(i1 / CONCESSION_COLS);
    const c1 = i1 % CONCESSION_COLS;
    const r2 = Math.floor(i2 / CONCESSION_COLS);
    const c2 = i2 % CONCESSION_COLS;
    return i1 !== i2 && Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
  };

  const isValid = (cells: number[]): boolean => {
    // No row dupes
    for (let r = 0; r < CONCESSION_ROWS; r++) {
      const row = cells.slice(r * CONCESSION_COLS, (r + 1) * CONCESSION_COLS);
      if (new Set(row).size !== row.length) return false;
    }
    // No column dupes
    for (let c = 0; c < CONCESSION_COLS; c++) {
      const col: number[] = [];
      for (let r = 0; r < CONCESSION_ROWS; r++) col.push(cells[r * CONCESSION_COLS + c]);
      if (new Set(col).size !== col.length) return false;
    }
    // No same number adjacent (incl. diagonals)
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (cells[i] === cells[j] && isAdjacent(i, j)) return false;
      }
    }
    return true;
  };

  // The combined constraints have a low hit rate per random shuffle, so allow plenty of retries.
  for (let attempt = 0; attempt < 50000; attempt++) {
    const cells = base.slice();
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    if (isValid(cells)) return cells;
  }

  // Fallback: hand-constructed arrangement that satisfies every constraint.
  // Each pair is at Chebyshev distance ≥ 2; no row/col repeats; each horse appears twice.
  return [
    1, 2, 3, 4,
    5, 6, 7, 8,
    2, 1, 4, 3,
    6, 5, 8, 7,
  ];
}

export function initialState(): LSState {
  return {
    phase: 'lobby',
    round: 0,
    activePlayerSeat: 0,
    currentTurnSeat: null,
    step: 'roll',
    horseDie: null,
    movementDie: null,
    horses: Array.from({ length: NUM_HORSES }, () => ({ position: 0, finished: null })),
    finishedCount: 0,
    market: Array.from({ length: NUM_HORSES }, (_, i) => i + 1),
    players: [],
    log: [],
    rollId: 0,
    lastSequence: [],
    concessionGrid: [],   // populated when the race starts
    pendingBonus: null,
  };
}

export function addPlayer(state: LSState, playerId: string, username: string, seat: number): LSState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  const player: LSPlayer = {
    playerId, username, seat,
    money: STARTING_MONEY,
    ownedHorses: [],
    bets: Array.from({ length: NUM_HORSES }, () => 0),
    helmets: Array.from({ length: NUM_HORSES }, () => 0),
    jerseys: Array.from({ length: NUM_HORSES }, () => 0),
    jerseyMarks: Array.from({ length: NUM_HORSES }, () => [] as number[]),
    wildsUsed: 0,
    concessionMarks: Array.from({ length: CONCESSION_CELLS }, () => false),
    bonusesClaimed: Array.from({ length: CONCESSION_BONUSES.length }, () => false),
    actedThisRound: false,
  };
  const players = [...state.players, player].sort((a, b) => a.seat - b.seat);
  return { ...state, players };
}

export function startRace(state: LSState): LSState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Race already started' };
  if (state.players.length < 2) return { error: 'Need at least 2 players' };
  const startSeat = state.players[Math.floor(Math.random() * state.players.length)].seat;
  const startName = state.players.find(p => p.seat === startSeat)!.username;
  const concessionGrid = genConcessionGrid();

  // Each player gets pre-placed marks AND starting bets. Bet rules:
  //   - $6 total per player, split as either $2+$4 or $3+$3
  //   - lower (or first) bet on a horse 1-4
  //   - higher (or second) bet on a horse 5-8
  //   - no two players share the same (lowHorse, highHorse) pair
  //   - neither bet horse may be on this player's pre-marked concession cells
  const usedPairs = new Set<string>();
  const players = state.players.map(p => {
    let concessionMarks: boolean[] = Array.from({ length: CONCESSION_CELLS }, () => false);
    let bets: number[] = Array.from({ length: NUM_HORSES }, () => 0);
    let pairKey: string | null = null;

    // Try multiple pre-mark layouts until one allows valid starting bets.
    for (let outer = 0; outer < 30; outer++) {
      const marks = genStartingMarks(concessionGrid);
      const preMarkedHorses = new Set<number>();
      marks.forEach((m, i) => { if (m) preMarkedHorses.add(concessionGrid[i]); });
      const result = tryGenStartingBets(preMarkedHorses, usedPairs);
      if (result) {
        concessionMarks = marks;
        bets = result.bets;
        pairKey = result.pairKey;
        break;
      }
    }
    if (pairKey) usedPairs.add(pairKey);

    const startingJerseys = genStartingJerseys();

    return {
      ...p,
      concessionMarks,
      bets,
      jerseys: startingJerseys.jerseys,
      jerseyMarks: startingJerseys.jerseyMarks,
      bonusesClaimed: Array.from({ length: CONCESSION_BONUSES.length }, () => false),
    };
  });

  return {
    ...state,
    phase: 'playing',
    round: 1,
    activePlayerSeat: startSeat,
    currentTurnSeat: null,
    step: 'roll',
    concessionGrid,
    players,
    log: [`Race begins! ${startName} rolls first.`],
  };
}

/**
 * Try to generate a valid starting-bet configuration that satisfies:
 *   - $6 total split as either $2+$4 or $3+$3
 *   - lower bet on a horse from {1..4}, not in the player's pre-marked horses
 *   - higher bet on a horse from {5..8}, not in the player's pre-marked horses
 *   - (lowHorse, highHorse) pair not already used by another player
 * Returns null if no valid arrangement was found within the retry budget.
 */
function tryGenStartingBets(
  preMarkedHorses: Set<number>,
  usedPairs: Set<string>,
): { bets: number[]; pairKey: string } | null {
  const lowerCandidates = [1, 2, 3, 4].filter(h => !preMarkedHorses.has(h));
  const upperCandidates = [5, 6, 7, 8].filter(h => !preMarkedHorses.has(h));
  if (lowerCandidates.length === 0 || upperCandidates.length === 0) return null;

  // Enumerate all available pairs not yet used, then pick one at random.
  const free: { lo: number; hi: number }[] = [];
  for (const lo of lowerCandidates) {
    for (const hi of upperCandidates) {
      if (!usedPairs.has(`${lo}-${hi}`)) free.push({ lo, hi });
    }
  }
  if (free.length === 0) return null;

  const { lo, hi } = free[Math.floor(Math.random() * free.length)];
  const split: [number, number] = Math.random() < 0.5 ? [2, 4] : [3, 3];
  const bets = Array.from({ length: NUM_HORSES }, () => 0);
  bets[lo - 1] = split[0];
  bets[hi - 1] = split[1];
  return { bets, pairKey: `${lo}-${hi}` };
}

/**
 * Pick STARTING_JERSEYS distinct jersey horses for a player; each gets a single
 * markHorse (random other horse). Returns the jerseys/jerseyMarks arrays ready to
 * drop into the LSPlayer struct.
 */
function genStartingJerseys(): { jerseys: number[]; jerseyMarks: number[][] } {
  const jerseys = Array.from({ length: NUM_HORSES }, () => 0);
  const jerseyMarks: number[][] = Array.from({ length: NUM_HORSES }, () => []);

  // Fisher-Yates shuffle to pick STARTING_JERSEYS distinct jersey horses
  const horses = Array.from({ length: NUM_HORSES }, (_, i) => i + 1);
  for (let i = horses.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [horses[i], horses[j]] = [horses[j], horses[i]];
  }
  const jerseyHorses = horses.slice(0, STARTING_JERSEYS);

  for (const jh of jerseyHorses) {
    jerseys[jh - 1] = 1;
    const candidates = Array.from({ length: NUM_HORSES }, (_, i) => i + 1).filter(n => n !== jh);
    const mh = candidates[Math.floor(Math.random() * candidates.length)];
    jerseyMarks[jh - 1] = [mh];
  }
  return { jerseys, jerseyMarks };
}

/**
 * Pick 4 cells from the 4×4 grid such that:
 *   - exactly one cell per row
 *   - exactly one cell per column
 *   - the four horse numbers at those cells are all distinct
 * Returns a boolean[] of length CONCESSION_CELLS with those 4 cells set to true.
 */
function genStartingMarks(grid: number[]): boolean[] {
  for (let attempt = 0; attempt < 1000; attempt++) {
    // Random permutation of column indices, one per row
    const cols = [0, 1, 2, 3];
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    const cellIdxs = cols.map((c, r) => r * CONCESSION_COLS + c);
    const values = cellIdxs.map(i => grid[i]);
    if (new Set(values).size === values.length) {
      const marks = new Array(CONCESSION_CELLS).fill(false);
      cellIdxs.forEach(i => { marks[i] = true; });
      return marks;
    }
  }
  // Fallback: leave empty (should be impossibly rare)
  return new Array(CONCESSION_CELLS).fill(false);
}

// ---------- Race mechanics ----------

/**
 * Move a single horse `signedSpaces` (positive = forward, negative = backward).
 * `allowFinish` controls whether the horse may cross the finish line — true for dice
 * rolls and secondary movement, false for concession-bonus movement (those stop one
 * space before the line, any extra wasted). Backward movement clamps at position 0.
 */
function moveHorse(state: LSState, horseIndex: number, signedSpaces: number, allowFinish: boolean): LSState {
  const h = state.horses[horseIndex];
  if (h.finished) return state;

  const horses = state.horses.map(x => ({ ...x }));
  let pos = horses[horseIndex].position + signedSpaces;
  let finished: HorseFinish = null;
  let finishedCount = state.finishedCount;

  if (pos < 0) {
    pos = 0;
  } else if (pos >= TRACK_LENGTH) {
    if (allowFinish && finishedCount < FINISH_POSITIONS) {
      finishedCount += 1;
      finished = (finishedCount as HorseFinish);
      pos = TRACK_LENGTH;
    } else {
      pos = TRACK_LENGTH - 1;
    }
  }

  horses[horseIndex] = { position: pos, finished };
  return { ...state, horses, finishedCount };
}

/** Backwards-compatible wrapper used by the dice-roll path (allows finishing). */
function moveHorseForward(state: LSState, horseIndex: number, spaces: number): LSState {
  return moveHorse(state, horseIndex, spaces, true);
}

/** Combine the default secondary-bar with any Jersey-marked X's across all players. */
function effectiveSecondaryBar(state: LSState, rolledHorse: number): number[] {
  const set = new Set<number>(SECONDARY_BARS[rolledHorse] ?? []);
  for (const p of state.players) {
    for (const n of p.jerseyMarks[rolledHorse - 1] ?? []) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function rollDice(state: LSState, horseDie: number, movementDie: number): LSState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Race not in progress' };
  if (state.step !== 'roll') return { error: 'Not the roll step' };
  if (horseDie < 1 || horseDie > 8 || movementDie < MOVEMENT_DIE_MIN || movementDie > MOVEMENT_DIE_MAX) {
    return { error: 'Bad dice values' };
  }

  let next: LSState = { ...state, horseDie, movementDie };
  const rolledHorse = horseDie;
  const rolledIdx = rolledHorse - 1;

  const log: string[] = [`Round ${state.round}: rolled horse ${rolledHorse}, move ${movementDie}.`];
  const sequence: LSMove[] = [];

  // Step 2: move the rolled horse
  if (!next.horses[rolledIdx].finished) {
    const before = next.horses[rolledIdx];
    next = moveHorseForward(next, rolledIdx, movementDie);
    const after = next.horses[rolledIdx];
    const moved = after.position - before.position;
    sequence.push({
      horseIdx: rolledIdx,
      fromPos: before.position, toPos: after.position,
      fromFinished: before.finished, toFinished: after.finished,
    });
    if (after.finished) {
      log.push(`🏇 Horse ${rolledHorse} advances ${moved} → crosses the line, ${ordinal(after.finished)} place!`);
    } else if (moved > 0) {
      log.push(`🏇 Horse ${rolledHorse} advances ${moved}.`);
    }
  } else {
    log.push(`Horse ${rolledHorse} already finished; only secondary movement applies.`);
  }

  // Step 3: secondary movement bar (default + jersey-marked)
  const bar = effectiveSecondaryBar(next, rolledHorse);
  for (const n of bar) {
    const before = next.horses[n - 1];
    if (before.finished) continue;
    next = moveHorseForward(next, n - 1, 1);
    const after = next.horses[n - 1];
    const moved = after.position - before.position;
    sequence.push({
      horseIdx: n - 1,
      fromPos: before.position, toPos: after.position,
      fromFinished: before.finished, toFinished: after.finished,
    });
    if (after.finished) {
      log.push(`↳ Horse ${n} advances ${moved} → crosses the line, ${ordinal(after.finished)} place!`);
    } else if (moved > 0) {
      log.push(`↳ Horse ${n} advances ${moved}.`);
    }
  }

  next = { ...next, rollId: state.rollId + 1, lastSequence: sequence };

  // Race end check
  if (next.finishedCount >= FINISH_POSITIONS) {
    next = {
      ...next,
      phase: 'finished',
      step: 'done',
      currentTurnSeat: null,
    };
    log.push('🏁 Race complete!');
  } else {
    // Transition to action phase — all players act starting with active
    next = {
      ...next,
      step: 'action',
      currentTurnSeat: state.activePlayerSeat,
      players: next.players.map(p => ({ ...p, actedThisRound: false })),
    };
  }

  return { ...next, log: [...state.log, ...log].slice(-50) };
}

function advanceRound(state: LSState): LSState {
  const seats = state.players.map(p => p.seat);
  if (seats.length === 0) return state;
  const idx = seats.indexOf(state.activePlayerSeat);
  const nextSeat = seats[(idx + 1) % seats.length];
  return {
    ...state,
    round: state.round + 1,
    activePlayerSeat: nextSeat,
    currentTurnSeat: null,
    step: 'roll',
    horseDie: null,
    movementDie: null,
    players: state.players.map(p => ({ ...p, actedThisRound: false })),
  };
}

function advanceActionTurn(state: LSState, justActedSeat: number, log: string[]): LSState {
  const seats = state.players.map(p => p.seat);
  const startIdx = seats.indexOf(justActedSeat);
  // Find next unacted player going clockwise (seat++)
  for (let i = 1; i <= seats.length; i++) {
    const candidate = seats[(startIdx + i) % seats.length];
    const player = state.players.find(p => p.seat === candidate)!;
    if (!player.actedThisRound) {
      return { ...state, currentTurnSeat: candidate, log: [...state.log, ...log].slice(-50) };
    }
  }
  // Everyone has acted — round ends
  const advanced = advanceRound(state);
  return { ...advanced, log: [...state.log, ...log, `— round ${advanced.round} —`].slice(-50) };
}

// ---------- Actions ----------

export type ActionPayload = (
  | { type: 'bet'; amount: number }                 // amount 1, 2, or 3
  | { type: 'buy' }
  | { type: 'helmet' }
  | { type: 'jersey'; markHorse: number }           // horse number (1-8) to mark on rolled horse's bar
  | { type: 'concession'; cellIdx: number }         // 0..CONCESSION_CELLS-1
  | { type: 'refresh_wild' }                        // spend your turn to recover ONE wild; only legal when stuck
  | { type: 'claim_bonus'; bonusId: string;
      horse?: number;                               // single-horse bonuses
      horse2?: number;                              // second horse for back/forward 2-x-2
      markHorse?: number;                           // for jersey_any: which horse to mark on the bar
    }
) & {
  /**
   * Optional Wild Number override: use this horse number (1..8) instead of the rolled die
   * to validate / take the action. Costs one wild from the player's pool of MAX_WILDS.
   * Not applicable to claim_bonus or refresh_wilds.
   */
  wild?: number;
};

/**
 * Does this player have at least one valid action on the given horse number?
 * Mirrored on the client to gate the Refresh Wilds button.
 */
export function hasValidActionOnHorse(state: LSState, player: LSPlayer, horseNum: number): boolean {
  const horseIdx = horseNum - 1;
  const horse = state.horses[horseIdx];
  // Concession: any unmarked cell on this player's grid showing this horse number
  if (state.concessionGrid.some((n, i) => n === horseNum && !player.concessionMarks[i])) return true;
  // Helmet
  if (player.helmets[horseIdx] < MAX_HELMETS_PER_HORSE) return true;
  // Jersey
  if (player.jerseys[horseIdx] < MAX_JERSEYS_PER_HORSE &&
      (player.jerseyMarks[horseIdx]?.length ?? 0) < NUM_HORSES) return true;
  // Bet — refused on finished horses, and on past-No-Bet horses without a helmet
  if (!horse.finished &&
      (horse.position < NO_BET_SPACE || player.helmets[horseIdx] > 0) &&
      player.money >= 1) return true;
  // Buy
  if (!horse.finished &&
      state.market.includes(horseNum) &&
      player.money >= HORSE_COSTS[horseIdx]) return true;
  return false;
}

export function takeAction(
  state: LSState,
  playerId: string,
  payload: ActionPayload,
): LSState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Race not in progress' };
  if (state.step !== 'action') return { error: 'Not in action phase' };
  if (state.currentTurnSeat === null) return { error: 'No active turn' };

  // If a bonus is pending for someone, only that player can act, and only with claim_bonus.
  if (state.pendingBonus) {
    if (state.pendingBonus.playerId !== playerId) return { error: 'A bonus is pending for another player' };
    if (payload.type !== 'claim_bonus') return { error: 'You must claim your concession bonus first' };
    return applyBonusClaim(state, playerId, payload);
  }

  const playerIdx = state.players.findIndex(p => p.playerId === playerId);
  if (playerIdx < 0) return { error: 'Not a seated player' };
  const player = state.players[playerIdx];
  if (player.seat !== state.currentTurnSeat) return { error: 'Not your turn' };
  if (player.actedThisRound) return { error: 'You already acted this round' };

  // Wild Numbers: if the player chose to use a wild, validate and consume one
  let effectiveHorse = state.horseDie!;
  let wildConsumed = false;
  if (payload.type !== 'claim_bonus' && payload.type !== 'refresh_wild' && payload.wild !== undefined) {
    if (player.wildsUsed >= MAX_WILDS) return { error: 'No wilds remaining' };
    if (!Number.isInteger(payload.wild) || payload.wild < 1 || payload.wild > NUM_HORSES) {
      return { error: 'Wild horse number must be 1-8' };
    }
    effectiveHorse = payload.wild;
    wildConsumed = true;
  }

  const rolledHorse = effectiveHorse;
  const horseIdx = rolledHorse - 1;
  const horse = state.horses[horseIdx];
  const log: string[] = [];
  if (wildConsumed) log.push(`✨ ${player.username} burns a Wild to act on horse ${rolledHorse}.`);

  let updatedPlayer: LSPlayer = {
    ...player,
    actedThisRound: true,
    wildsUsed: wildConsumed ? player.wildsUsed + 1 : player.wildsUsed,
  };

  switch (payload.type) {
    case 'bet': {
      if (![1, 2, 3].includes(payload.amount)) return { error: 'Bet must be $1, $2, or $3' };
      if (horse.finished) return { error: 'Cannot bet on a finished horse' };
      const pastNoBet = horse.position >= NO_BET_SPACE;
      if (pastNoBet && player.helmets[horseIdx] === 0) {
        return { error: `Horse ${rolledHorse} is past the No-Bet line — you need a helmet first` };
      }
      if (player.money < payload.amount) return { error: 'Not enough money' };
      updatedPlayer = {
        ...updatedPlayer,
        money: player.money - payload.amount,
        bets: player.bets.map((b, i) => (i === horseIdx ? b + payload.amount : b)),
      };
      log.push(`💰 ${player.username} bets $${payload.amount} on horse ${rolledHorse}.`);
      break;
    }

    case 'buy': {
      if (horse.finished) return { error: 'Cannot buy a finished horse' };
      if (!state.market.includes(rolledHorse)) return { error: `Horse ${rolledHorse} is not in the market` };
      const cost = HORSE_COSTS[horseIdx];
      if (player.money < cost) return { error: `Not enough money (cost $${cost})` };
      updatedPlayer = {
        ...updatedPlayer,
        money: player.money - cost,
        ownedHorses: [...player.ownedHorses, rolledHorse].sort((a, b) => a - b),
      };
      log.push(`🏠 ${player.username} buys horse ${rolledHorse} for $${cost}.`);
      // Remove from market
      const newMarket = state.market.filter(n => n !== rolledHorse);
      return commitTurn(state, playerIdx, updatedPlayer, log, { market: newMarket });
    }

    case 'helmet': {
      if (player.helmets[horseIdx] >= MAX_HELMETS_PER_HORSE) {
        return { error: `You already have ${MAX_HELMETS_PER_HORSE} helmets on horse ${rolledHorse}` };
      }
      updatedPlayer = {
        ...updatedPlayer,
        helmets: player.helmets.map((h, i) => (i === horseIdx ? h + 1 : h)),
      };
      log.push(`⛑️ ${player.username} marks a helmet on horse ${rolledHorse}.`);
      break;
    }

    case 'jersey': {
      if (player.jerseys[horseIdx] >= MAX_JERSEYS_PER_HORSE) {
        return { error: `You already have ${MAX_JERSEYS_PER_HORSE} jerseys on horse ${rolledHorse}` };
      }
      const m = payload.markHorse;
      if (!Number.isInteger(m) || m < 1 || m > NUM_HORSES) {
        return { error: 'Pick which horse to add to the secondary bar (1-8)' };
      }
      if ((player.jerseyMarks[horseIdx] ?? []).includes(m)) {
        return { error: `Horse ${m} is already marked on horse ${rolledHorse}'s bar by you` };
      }
      const updatedJerseyMarks = player.jerseyMarks.map((arr, i) =>
        i === horseIdx ? [...arr, m] : arr,
      );
      updatedPlayer = {
        ...updatedPlayer,
        jerseys: player.jerseys.map((j, i) => (i === horseIdx ? j + 1 : j)),
        jerseyMarks: updatedJerseyMarks,
      };
      log.push(`🏁 ${player.username} marks horse ${m} on horse ${rolledHorse}'s secondary bar.`);
      break;
    }

    case 'concession': {
      const cell = payload.cellIdx;
      if (!Number.isInteger(cell) || cell < 0 || cell >= CONCESSION_CELLS) {
        return { error: 'Bad concession cell' };
      }
      if (state.concessionGrid[cell] !== rolledHorse) {
        return { error: `That cell shows horse ${state.concessionGrid[cell]}, not ${rolledHorse}` };
      }
      if (player.concessionMarks[cell]) return { error: 'Cell already marked' };

      const newMarks = player.concessionMarks.slice();
      newMarks[cell] = true;
      updatedPlayer = { ...updatedPlayer, concessionMarks: newMarks };
      log.push(`🎪 ${player.username} marks a concession cell for horse ${rolledHorse}.`);

      // Detect row/column completions from this fresh mark
      const row = Math.floor(cell / CONCESSION_COLS);
      const col = cell % CONCESSION_COLS;
      let rowComplete = true;
      for (let c = 0; c < CONCESSION_COLS; c++) {
        if (!newMarks[row * CONCESSION_COLS + c]) { rowComplete = false; break; }
      }
      let colComplete = true;
      for (let r = 0; r < CONCESSION_ROWS; r++) {
        if (!newMarks[r * CONCESSION_COLS + col]) { colComplete = false; break; }
      }
      const bonusCount = (rowComplete ? 1 : 0) + (colComplete ? 1 : 0);

      if (bonusCount > 0) {
        // Apply the cell mark + wild + log, set pendingBonus, BUT do NOT advance turn yet.
        const players = state.players.slice();
        players[playerIdx] = updatedPlayer;
        log.push(`🎉 ${player.username} completed a ${
          rowComplete && colComplete ? 'row & column'
          : rowComplete ? 'row' : 'column'
        } — choose ${bonusCount} bonus${bonusCount > 1 ? 'es' : ''}!`);
        return {
          ...state,
          players,
          pendingBonus: { playerId: player.playerId, count: bonusCount },
          log: [...state.log, ...log].slice(-50),
        };
      }
      break;
    }

    case 'claim_bonus': {
      return { error: 'No bonus to claim right now' };
    }

    case 'refresh_wild': {
      // Available whenever the player has at least one wild that's been used.
      // No restriction on having other legal actions.
      if (player.wildsUsed === 0) return { error: 'No wilds to refresh' };
      updatedPlayer = { ...updatedPlayer, wildsUsed: player.wildsUsed - 1 };
      log.push(`✨ ${player.username} spends the turn to refresh one Wild.`);
      break;
    }
  }

  return commitTurn(state, playerIdx, updatedPlayer, log);
}

// ---------- Bonus claim ----------

/**
 * Resolve a pending concession bonus. Player must have a bonus pending; bonusId must
 * be unclaimed by this player. Some bonuses require additional params (horses).
 */
function applyBonusClaim(
  state: LSState,
  playerId: string,
  payload: Extract<ActionPayload, { type: 'claim_bonus' }>,
): LSState | { error: string } {
  if (!state.pendingBonus || state.pendingBonus.playerId !== playerId) {
    return { error: 'No bonus pending' };
  }
  const playerIdx = state.players.findIndex(p => p.playerId === playerId);
  if (playerIdx < 0) return { error: 'Not a seated player' };
  const player = state.players[playerIdx];

  const bonusIdx = CONCESSION_BONUSES.findIndex(b => b.id === payload.bonusId);
  if (bonusIdx < 0) return { error: 'Unknown bonus' };
  if (player.bonusesClaimed[bonusIdx]) return { error: 'Bonus already claimed' };
  const bonus = CONCESSION_BONUSES[bonusIdx];

  let next: LSState = state;
  let updatedPlayer: LSPlayer = { ...player };
  const log: string[] = [];
  /** Horse moves to animate (only populated by movement bonuses). */
  const animMoves: LSMove[] = [];

  const requireHorse = (h?: number, label = 'horse'): number | { error: string } => {
    if (!Number.isInteger(h) || (h as number) < 1 || (h as number) > NUM_HORSES) return { error: `Pick a ${label} (1-8)` };
    return h as number;
  };

  /** Move a horse and record the from→to transition for the client to animate. */
  const moveAndRecord = (horseNum: number, dist: number) => {
    const before = next.horses[horseNum - 1];
    next = moveHorse(next, horseNum - 1, dist, false);
    const after = next.horses[horseNum - 1];
    if (after.position !== before.position || after.finished !== before.finished) {
      animMoves.push({
        horseIdx: horseNum - 1,
        fromPos: before.position, toPos: after.position,
        fromFinished: before.finished, toFinished: after.finished,
      });
    }
  };

  switch (bonus.id) {
    case 'cash7_a':
    case 'cash7_b':
    case 'cash7_c': {
      updatedPlayer.money += 7;
      log.push(`💵 ${player.username} claims +$7.`);
      break;
    }

    case 'back2x2':
    case 'forward2x2': {
      const a = requireHorse(payload.horse,  'first horse');
      if (typeof a === 'object') return a;
      const b = requireHorse(payload.horse2, 'second horse');
      if (typeof b === 'object') return b;
      if (a === b) return { error: 'Pick two different horses' };
      const dist = bonus.id === 'back2x2' ? -2 : 2;
      // Forward/back bonuses can't be wasted on horses pinned at the track ends.
      if (dist > 0) {
        for (const h of [a, b]) {
          if (next.horses[h - 1].position >= TRACK_LENGTH - 1) {
            return { error: `Horse ${h} is already at the finish line — +${dist} would be wasted` };
          }
        }
      } else {
        for (const h of [a, b]) {
          if (next.horses[h - 1].position <= 0) {
            return { error: `Horse ${h} is still in the starting gate — ${dist} would be wasted` };
          }
        }
      }
      // Move lowest-numbered first per rules
      const order = [a, b].sort((x, y) => x - y);
      for (const h of order) moveAndRecord(h, dist);
      log.push(`${dist < 0 ? '↩️' : '↪️'} ${player.username} moves horses ${order[0]} and ${order[1]} ${dist < 0 ? 'back' : 'forward'} 2 each.`);
      break;
    }

    case 'back3':
    case 'forward3': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      const dist = bonus.id === 'back3' ? -3 : 3;
      if (dist > 0 && next.horses[h - 1].position >= TRACK_LENGTH - 1) {
        return { error: `Horse ${h} is already at the finish line — +${dist} would be wasted` };
      }
      if (dist < 0 && next.horses[h - 1].position <= 0) {
        return { error: `Horse ${h} is still in the starting gate — ${dist} would be wasted` };
      }
      moveAndRecord(h, dist);
      log.push(`${dist < 0 ? '↩️' : '↪️'} ${player.username} moves horse ${h} ${dist < 0 ? 'back' : 'forward'} 3.`);
      break;
    }

    case 'freebet3_a':
    case 'freebet3_b': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      const horseObj = next.horses[h - 1];
      if (horseObj.finished) return { error: 'Cannot bet on a finished horse' };
      const past = horseObj.position >= NO_BET_SPACE;
      if (past && updatedPlayer.helmets[h - 1] === 0) {
        return { error: `Horse ${h} is past the No-Bet line — need a helmet first` };
      }
      updatedPlayer.bets = updatedPlayer.bets.map((amt, i) => (i === h - 1 ? amt + 3 : amt));
      log.push(`💰 ${player.username} places a free $3 bet on horse ${h}.`);
      break;
    }

    case 'helmet_any': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      if (updatedPlayer.helmets[h - 1] >= MAX_HELMETS_PER_HORSE) {
        return { error: `Already have a helmet on horse ${h}` };
      }
      updatedPlayer.helmets = updatedPlayer.helmets.map((c, i) => (i === h - 1 ? c + 1 : c));
      log.push(`⛑️ ${player.username} marks a helmet on horse ${h}.`);
      break;
    }

    case 'jersey_any': {
      const h = requireHorse(payload.horse, 'jersey horse');
      if (typeof h === 'object') return h;
      const m = requireHorse(payload.markHorse, 'horse to add to bar');
      if (typeof m === 'object') return m;
      if (updatedPlayer.jerseys[h - 1] >= MAX_JERSEYS_PER_HORSE) {
        return { error: `Already have a jersey on horse ${h}` };
      }
      if ((updatedPlayer.jerseyMarks[h - 1] ?? []).includes(m)) {
        return { error: `Horse ${m} is already marked on horse ${h}'s bar` };
      }
      updatedPlayer.jerseys = updatedPlayer.jerseys.map((c, i) => (i === h - 1 ? c + 1 : c));
      updatedPlayer.jerseyMarks = updatedPlayer.jerseyMarks.map((arr, i) =>
        i === h - 1 ? [...arr, m] : arr,
      );
      log.push(`🏁 ${player.username} marks a jersey on horse ${h} (+ horse ${m} on its bar).`);
      break;
    }

    case 'free_horse': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      if (!next.market.includes(h)) return { error: `Horse ${h} is not in the market` };
      updatedPlayer.ownedHorses = [...updatedPlayer.ownedHorses, h].sort((a, b) => a - b);
      next = { ...next, market: next.market.filter(n => n !== h) };
      log.push(`🏠 ${player.username} takes horse ${h} from the market for free.`);
      break;
    }

    default:
      return { error: 'Unhandled bonus' };
  }

  // Mark the bonus as claimed and commit the player update
  updatedPlayer = {
    ...updatedPlayer,
    bonusesClaimed: updatedPlayer.bonusesClaimed.map((c, i) => (i === bonusIdx ? true : c)),
  };
  const players = next.players.slice();
  players[playerIdx] = updatedPlayer;
  next = { ...next, players };

  // If this bonus moved any horses, push the moves through the animation pipeline
  // by replacing lastSequence and bumping rollId — the client will replay them.
  if (animMoves.length > 0) {
    next = { ...next, lastSequence: animMoves, rollId: next.rollId + 1 };
  }

  // Decrement the pending count; if zero, clear pendingBonus and advance the action turn
  const remaining = state.pendingBonus.count - 1;
  if (remaining > 0) {
    return {
      ...next,
      pendingBonus: { ...state.pendingBonus, count: remaining },
      log: [...next.log, ...log].slice(-50),
    };
  }
  // All bonuses resolved — clear, and advance the turn
  const cleared: LSState = { ...next, pendingBonus: null };
  return advanceActionTurn(cleared, player.seat, log);
}

function commitTurn(
  state: LSState,
  playerIdx: number,
  updatedPlayer: LSPlayer,
  log: string[],
  extra: Partial<LSState> = {},
): LSState {
  const players = state.players.slice();
  players[playerIdx] = updatedPlayer;
  const next: LSState = { ...state, ...extra, players };
  return advanceActionTurn(next, updatedPlayer.seat, log);
}

function ordinal(n: 1 | 2 | 3): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : '3rd';
}

/**
 * Calculate a player's total bet winnings at the end of the race.
 * For each horse the player bet on:
 *   - If the horse finished 1st/2nd/3rd: bet × BET_ODDS[horseIdx][place-1]
 *   - Else if the horse crossed the No-Bet line: bet × 1 (consolation — bet back)
 *   - Else: $0 (forfeit)
 * The place payout and the consolation payout are mutually exclusive.
 *
 * Returns both the grand total and a per-horse breakdown so the UI can show the math.
 */
export type BetBreakdownEntry = {
  horseNum: number;
  bet: number;
  place: HorseFinish;          // null if not on the podium
  pastNoBet: boolean;          // horse crossed the No-Bet line
  multiplier: number;          // 0, 1, or one of the BET_ODDS place values
  payout: number;              // bet * multiplier
};

export function calculateBetWinnings(state: LSState, player: LSPlayer): {
  total: number;
  breakdown: BetBreakdownEntry[];
} {
  const breakdown: BetBreakdownEntry[] = [];
  let total = 0;
  for (let i = 0; i < NUM_HORSES; i++) {
    const bet = player.bets[i];
    if (bet <= 0) continue;
    const horse = state.horses[i];
    const place = horse.finished;
    const pastNoBet = horse.position >= NO_BET_SPACE;

    let multiplier = 0;
    if (place === 1 || place === 2 || place === 3) {
      multiplier = BET_ODDS[i][place - 1];
    } else if (pastNoBet) {
      multiplier = 1;
    }
    const payout = bet * multiplier;
    breakdown.push({ horseNum: i + 1, bet, place, pastNoBet, multiplier, payout });
    total += payout;
  }
  return { total, breakdown };
}
