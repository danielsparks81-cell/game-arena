// Long Shot: a horse-racing dice game.
// Phase 2: full action phase — each round, after the roll, every player takes one of
// five actions (Concession, Helmet, Jersey, Bet, Buy) keyed off the rolled horse number.

export const NUM_HORSES = 8;
export const TRACK_LENGTH = 16;
export const NO_BET_SPACE = 12;
export const STARTING_MONEY = 12;
export const FINISH_POSITIONS = 3;

export const MAX_HELMETS_PER_HORSE = 3;
export const MAX_JERSEYS_PER_HORSE = 3;
export const MAX_WILDS = 4;
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

/** Concession bonuses (ID + short label). Effects are implemented in Phase 3. */
export const CONCESSION_BONUSES = [
  { id: 'cash7',        label: '+$7',         desc: 'Gain $7' },
  { id: 'back2x2',      label: '−2 / −2',     desc: 'Move any 2 horses back 2 each' },
  { id: 'back3',        label: '−3',          desc: 'Move 1 horse back 3' },
  { id: 'forward2x2',   label: '+2 / +2',     desc: 'Move any 2 horses forward 2 each' },
  { id: 'forward3',     label: '+3',          desc: 'Move 1 horse forward 3' },
  { id: 'freebet3',     label: 'Free $3 bet', desc: 'Place a free $3 bet on any horse' },
  { id: 'helmet_any',   label: 'Helmet ★',    desc: 'Take Helmet action for any horse' },
  { id: 'jersey_any',   label: 'Jersey ★',    desc: 'Take Jersey action for any horse' },
  { id: 'free_horse',   label: 'Free horse',  desc: 'Take any horse from the market for free' },
] as const;

/**
 * Placeholder secondary-movement bars: when horse N is rolled, every entry in
 * SECONDARY_BARS[N] also advances 1 space (the "pre-printed X's"). Real card data
 * lands in Phase 4. Players can mark ADDITIONAL X's via the Jersey action — those
 * extras live in each player's jerseyMarks (not here).
 */
export const SECONDARY_BARS: number[][] = [
  [],
  [2, 3, 4],
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
};

// ---------- Setup ----------

function genConcessionGrid(): number[] {
  // 4 × 4 = 16 cells. Each horse number 1-8 appears exactly twice; full grid is shuffled.
  // Mirrors the spirit of the Starting Cards (every player gets a unique balanced layout).
  const cells = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8];
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
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
  return {
    ...state,
    phase: 'playing',
    round: 1,
    activePlayerSeat: startSeat,
    currentTurnSeat: null,
    step: 'roll',
    concessionGrid: genConcessionGrid(),  // one random layout shared by all players
    log: [`Race begins! ${startName} rolls first.`],
  };
}

// ---------- Race mechanics ----------

function moveHorseForward(state: LSState, horseIndex: number, spaces: number): LSState {
  const h = state.horses[horseIndex];
  if (h.finished) return state;

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
      pos = TRACK_LENGTH - 1;
    }
  }

  horses[horseIndex] = { position: pos, finished };
  return { ...state, horses, finishedCount };
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

export type ActionPayload =
  | { type: 'bet'; amount: number }                 // amount 1, 2, or 3
  | { type: 'buy' }
  | { type: 'helmet' }
  | { type: 'jersey'; markHorse: number }           // horse number (1-8) to mark on rolled horse's bar
  | { type: 'concession'; cellIdx: number }         // 0..CONCESSION_CELLS-1
  | { type: 'pass' };                               // forfeit turn (use this if no valid action)

export function takeAction(
  state: LSState,
  playerId: string,
  payload: ActionPayload,
): LSState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Race not in progress' };
  if (state.step !== 'action') return { error: 'Not in action phase' };
  if (state.currentTurnSeat === null) return { error: 'No active turn' };

  const playerIdx = state.players.findIndex(p => p.playerId === playerId);
  if (playerIdx < 0) return { error: 'Not a seated player' };
  const player = state.players[playerIdx];
  if (player.seat !== state.currentTurnSeat) return { error: 'Not your turn' };
  if (player.actedThisRound) return { error: 'You already acted this round' };

  const rolledHorse = state.horseDie!;
  const horseIdx = rolledHorse - 1;
  const horse = state.horses[horseIdx];
  const log: string[] = [];

  let updatedPlayer: LSPlayer = { ...player, actedThisRound: true };

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
      updatedPlayer = {
        ...updatedPlayer,
        concessionMarks: player.concessionMarks.map((m, i) => (i === cell ? true : m)),
      };
      log.push(`🎪 ${player.username} marks a concession cell for horse ${rolledHorse}.`);
      break;
    }

    case 'pass': {
      log.push(`${player.username} passes.`);
      break;
    }
  }

  return commitTurn(state, playerIdx, updatedPlayer, log);
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
