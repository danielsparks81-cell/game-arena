// Long Shot: a horse-racing dice game.
// Phase 1: race loop (roll dice, move horse, secondary movement, finish line). No actions yet.

export const NUM_HORSES = 8;
export const TRACK_LENGTH = 14;     // track spaces (placeholder; tune later from board)
export const NO_BET_SPACE = 10;     // past this index, no new bets without a helmet
export const STARTING_MONEY = 12;
export const FINISH_POSITIONS = 3;  // race ends after 3 horses cross

/** Distinct colors per horse (1-indexed via HORSE_COLORS[n-1]). */
export const HORSE_COLORS = [
  '#dc2626', // 1 - red
  '#2563eb', // 2 - blue
  '#eab308', // 3 - yellow
  '#22c55e', // 4 - green
  '#a855f7', // 5 - purple
  '#f97316', // 6 - orange
  '#06b6d4', // 7 - cyan
  '#ec4899', // 8 - pink
];

/**
 * Placeholder secondary-movement bars. When horse N is rolled, every entry
 * in SECONDARY_BARS[N] moves 1 space forward. Real card data lands in Phase 4.
 */
export const SECONDARY_BARS: number[][] = [
  [],                  // index 0 unused
  [2, 3, 4],           // horse 1
  [1, 3, 5],
  [1, 4, 6],
  [2, 5, 7],
  [3, 4, 8],
  [1, 5, 7],
  [2, 6, 8],
  [3, 5, 7],
];

export type HorseFinish = 1 | 2 | 3 | null;

export type LSHorse = {
  position: number;          // 0 = at start/finish line; TRACK_LENGTH = finished
  finished: HorseFinish;     // 1/2/3 = placed; null = still racing
};

export type LSPlayer = {
  playerId: string;
  username: string;
  seat: number;
  money: number;
  ownedHorses: number[];     // horse numbers (1-8)
  bets: number[];            // length 8, dollars wagered on each horse
  helmets: boolean[];        // length 8
  jerseys: boolean[];        // length 8
  wildsUsed: number;         // 0-4 wilds marked
};

export type LSState = {
  phase: 'lobby' | 'playing' | 'finished';
  round: number;
  activePlayerSeat: number;          // who rolls the dice this round
  currentTurnSeat: number | null;    // who is choosing an action (Phase 2+); null in Phase 1
  step: 'roll' | 'action' | 'between-rounds' | 'done';
  horseDie: number | null;           // 1-8 (last roll)
  movementDie: number | null;        // 1-6
  horses: LSHorse[];                 // length 8
  finishedCount: number;             // how many horses have crossed the line
  market: number[];                  // horse numbers still purchasable
  players: LSPlayer[];               // seated players, sorted by seat
  log: string[];                     // human-readable event log (last ~20)
};

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
    helmets: Array.from({ length: NUM_HORSES }, () => false),
    jerseys: Array.from({ length: NUM_HORSES }, () => false),
    wildsUsed: 0,
  };
  const players = [...state.players, player].sort((a, b) => a.seat - b.seat);
  return { ...state, players };
}

export function startRace(state: LSState): LSState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Race already started' };
  if (state.players.length < 2) return { error: 'Need at least 2 players' };
  return {
    ...state,
    phase: 'playing',
    round: 1,
    activePlayerSeat: state.players[0].seat,
    currentTurnSeat: null,
    step: 'roll',
    log: ['Race begins!'],
  };
}

// ---------- Race mechanics ----------

/** Move a single horse N spaces forward, handling finish line + winner's circle. */
function moveHorseForward(state: LSState, horseIndex: number, spaces: number): LSState {
  const h = state.horses[horseIndex];
  if (h.finished) return state;                                   // finished horses don't move
  if (state.finishedCount >= FINISH_POSITIONS) return state;      // race over for new finishes

  const horses = state.horses.map(x => ({ ...x }));
  let pos = horses[horseIndex].position + spaces;
  let finished: HorseFinish = null;
  let finishedCount = state.finishedCount;

  if (pos >= TRACK_LENGTH) {
    if (finishedCount < FINISH_POSITIONS) {
      finishedCount += 1;
      finished = (finishedCount as HorseFinish);
      pos = TRACK_LENGTH;
    } else {
      // 3rd place already taken — stop before finish line
      pos = TRACK_LENGTH - 1;
    }
  }

  horses[horseIndex] = { position: pos, finished };
  return { ...state, horses, finishedCount };
}

/** Roll the dice, move the rolled horse, then run secondary movement. */
export function rollDice(state: LSState, horseDie: number, movementDie: number): LSState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Race not in progress' };
  if (state.step !== 'roll') return { error: 'Not the roll step' };
  if (horseDie < 1 || horseDie > 8 || movementDie < 1 || movementDie > 6) {
    return { error: 'Bad dice values' };
  }

  let next: LSState = { ...state, horseDie, movementDie };
  const rolledHorse = horseDie;
  const rolledIdx = rolledHorse - 1;

  const log: string[] = [`Round ${state.round}: rolled horse ${rolledHorse}, move ${movementDie}.`];

  // Step 2: move the rolled horse `movementDie` spaces (skipped if it's already finished)
  if (!next.horses[rolledIdx].finished) {
    next = moveHorseForward(next, rolledIdx, movementDie);
    const h = next.horses[rolledIdx];
    if (h.finished) log.push(`Horse ${rolledHorse} crossed the line — ${ordinal(h.finished)} place!`);
  } else {
    log.push(`Horse ${rolledHorse} already finished; only secondary movement applies.`);
  }

  // Step 3: secondary movement bar — each horse marked on the rolled horse's bar moves 1 forward,
  // processed in numerical order (lowest first).
  const bar = [...(SECONDARY_BARS[rolledHorse] ?? [])].sort((a, b) => a - b);
  for (const n of bar) {
    const before = next.horses[n - 1];
    next = moveHorseForward(next, n - 1, 1);
    const after = next.horses[n - 1];
    if (!before.finished && after.finished) {
      log.push(`Horse ${n} crossed the line — ${ordinal(after.finished!)} place!`);
    }
  }

  // Race end check
  if (next.finishedCount >= FINISH_POSITIONS) {
    next = { ...next, phase: 'finished', step: 'done' };
    log.push('🏁 Race complete!');
  } else {
    // Phase 1: no action step — advance directly to next round.
    next = advanceRound(next);
  }

  return { ...next, log: [...state.log, ...log].slice(-30) };
}

/** Move active-player seat to the next seated player, increment round, reset to roll. */
function advanceRound(state: LSState): LSState {
  const seats = state.players.map(p => p.seat);
  if (seats.length === 0) return state;
  const idx = seats.indexOf(state.activePlayerSeat);
  const next = seats[(idx + 1) % seats.length];
  return {
    ...state,
    round: state.round + 1,
    activePlayerSeat: next,
    currentTurnSeat: null,
    step: 'roll',
    horseDie: null,
    movementDie: null,
  };
}

function ordinal(n: 1 | 2 | 3): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : '3rd';
}
