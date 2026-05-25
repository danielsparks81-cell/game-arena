// Long Shot: a horse-racing dice game.
// Phase 2: full action phase — each round, after the roll, every player takes one of
// five actions (Concession, Helmet, Jersey, Bet, Buy) keyed off the rolled horse number.
// Phase 4: each horse also has a unique ability (picked at random from a pool of 4)
// that triggers on certain events while the horse is owned (see longshotAbilities.ts).

import { assignAbilities, ABILITY_BY_ID } from './longshotAbilities';

export const NUM_HORSES = 8;
export const TRACK_LENGTH = 16;
export const NO_BET_SPACE = 12;
export const STARTING_MONEY = 12;
export const FINISH_POSITIONS = 3;
/** Purse paid to the owner of the horse finishing 1st / 2nd / 3rd. */
export const PURSE: [number, number, number] = [35, 25, 15];

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
 * Concession bonuses (ID + short label). Listed in column-major order for a 3-row × 4-col
 * grid (grid-flow-col):
 *   col 1: three +$7
 *   col 2: +2/+2 · Free $3 bet · −2/−2
 *   col 3: +3   · Free $3 bet · −3
 *   col 4: Helmet · Jersey · Free Horse
 */
export const CONCESSION_BONUSES = [
  // col 1
  { id: 'cash7_a',      label: '+$7',         desc: 'Gain $7' },
  { id: 'cash7_b',      label: '+$7',         desc: 'Gain $7' },
  { id: 'cash7_c',      label: '+$7',         desc: 'Gain $7' },
  // col 2
  { id: 'forward2x2',   label: '+2 / +2',     desc: 'Move any 2 Horses forward 2 each' },
  { id: 'freebet3_a',   label: '$3 Bet',      desc: 'Place a free $3 bet on any Horse' },
  { id: 'back2x2',      label: '−2 / −2',     desc: 'Move any 2 Horses back 2 each' },
  // col 3
  { id: 'forward3',     label: '+3',          desc: 'Move 1 Horse forward 3' },
  { id: 'freebet3_b',   label: '$3 Bet',      desc: 'Place a free $3 bet on any Horse' },
  { id: 'back3',        label: '−3',          desc: 'Move 1 Horse back 3' },
  // col 4
  { id: 'helmet_any',   label: 'Helmet',      desc: 'Take Helmet action for any Horse' },
  { id: 'jersey_any',   label: 'Jersey',      desc: 'Take Jersey action for any Horse' },
  { id: 'free_horse',   label: 'Free Horse',  desc: 'Take any Horse from the market for free' },
] as const;

/**
 * Pre-printed jersey marks on each horse's secondary bar — shared by all players,
 * independent of any Jersey actions taken in-game. When horse N is rolled, every horse
 * in SECONDARY_BARS[N] also advances 1 space. Players can add more via Jersey action
 * (those live in each player's jerseyMarks and stack via a Set, no duplicates).
 */
export const SECONDARY_BARS: number[][] = [
  [],         // index 0 unused (horses are 1-indexed)
  [6],        // horse 1 → +6
  [5],        // horse 2 → +5
  [1],        // horse 3 → +1
  [2],        // horse 4 → +2
  [1, 4],     // horse 5 → +1 +4
  [2, 3],     // horse 6 → +2 +3
  [1, 3],     // horse 7 → +1 +3
  [2, 4],     // horse 8 → +2 +4
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
  /** Player's profile accent color at join time. Optional for back-compat. */
  accent_color?: string;
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
  /** Phase 4 — horse numbers where this player has already collected a Product Placement
   *  free $2 bet (one-shot per horse). Empty if Product Placement isn't even in play. */
  productPlacementTriggered?: number[];
};

export type LSMove = {
  horseIdx: number;
  fromPos: number;
  toPos: number;
  fromFinished: HorseFinish;
  toFinished: HorseFinish;
};

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export type LSState = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  phase: 'lobby' | 'playing' | 'finished';
  round: number;
  activePlayerSeat: number;
  currentTurnSeat: number | null;
  step: 'roll' | 'action' | 'done';
  horseDie: number | null;
  movementDie: number | null;
  horses: LSHorse[];
  finishedCount: number;
  /**
   * Set to true when the 3rd horse finishes. All players still take one final
   * action turn before scoring. The game transitions to 'finished' only after
   * the last player acts on that final round.
   */
  finalRound?: boolean;
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
  /**
   * Horse-ability assignment for this race. Keys are horse numbers 1..8; values
   * are ability ids in {@link ABILITY_BY_ID}. Populated by `startRace` and unchanged
   * during the race so all clients render the same panel. Empty in the lobby.
   */
  assignedAbilities: Record<number, string>;
  /**
   * Phase 4 — a horse-ability trigger that requires the player to make a choice
   * (pick a horse / cell / option) before the round can advance. Coexists with
   * `pendingBonus`; this resolves first, then pendingBonus.
   */
  pendingChoice: PendingChoice | null;
};

/** Discriminated union of every ability-driven pending choice. */
export type PendingChoice =
  | { kind: 'half_off_sale';   playerId: string }
  | { kind: 'partner_in_crime'; playerId: string }
  | { kind: 'miracle_worker';  playerId: string }
  | { kind: 'inventory_check'; playerId: string; remaining: number }
  | { kind: 'chain_reaction';  playerId: string }
  | { kind: 'charley_horse';   playerId: string }
  | { kind: 'fair_play';       playerId: string }
  /** After the player's first jersey mark, they pick a second different horse to mark on the same card. */
  | { kind: 'double_crosser';  playerId: string; rolledHorse: number };

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
    version: STATE_VERSION,
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
    assignedAbilities: {},
    pendingChoice: null,
  };
}

/** Host-only: remove a seated player while still in the lobby. */
export function removePlayer(state: LSState, playerId: string): LSState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

export function addPlayer(state: LSState, playerId: string, username: string, seat: number, accent_color?: string): LSState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  const player: LSPlayer = {
    playerId, username, seat, accent_color,
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

    return {
      ...p,
      concessionMarks,
      bets,
      bonusesClaimed: Array.from({ length: CONCESSION_BONUSES.length }, () => false),
    };
  });

  // Rotate players so the first roller is at index 0, keeping state.players
  // in true action order so MembersPanel always matches gameplay.
  const startIdx = players.findIndex(p => p.seat === startSeat);
  const orderedPlayers = startIdx > 0
    ? [...players.slice(startIdx), ...players.slice(0, startIdx)]
    : players;

  return {
    ...state,
    phase: 'playing',
    round: 1,
    activePlayerSeat: startSeat,
    currentTurnSeat: null,
    step: 'roll',
    concessionGrid,
    players: orderedPlayers,
    assignedAbilities: assignAbilities(),
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
  return Array.from(allMarksOnBar(state, rolledHorse)).sort((a, b) => a - b);
}

/** Set of horses currently on horse N's bar — pre-printed + all players' jersey marks. */
export function allMarksOnBar(state: LSState, horseNum: number): Set<number> {
  const set = new Set<number>(SECONDARY_BARS[horseNum] ?? []);
  for (const p of state.players) {
    for (const n of p.jerseyMarks[horseNum - 1] ?? []) set.add(n);
  }
  return set;
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

  // --- Die-roll ability hooks (Phase 4) ---
  // Too Lucky (h2): physical die === 2 → owner of horse 2 gains $2
  if (horseDie === 2) {
    const owner = ownerOfHorse(next, 2);
    if (owner && abilityIdFor(next, 2) === 'h2_too_lucky') {
      next = {
        ...next,
        players: next.players.map(p =>
          p.playerId === owner.playerId ? { ...p, money: p.money + 2 } : p,
        ),
      };
      log.push(`🍀 Too Lucky — ${owner.username} gains $2.`);
    }
  }
  // Magic Hate Ball (h8): physical die === 8 → every player except horse-8 owner loses $2 (cap $0; money vanishes)
  if (horseDie === 8) {
    const owner = ownerOfHorse(next, 8);
    if (owner && abilityIdFor(next, 8) === 'h8_magic_hate_ball') {
      next = {
        ...next,
        players: next.players.map(p =>
          p.playerId === owner.playerId ? p : { ...p, money: Math.max(0, p.money - 2) },
        ),
      };
      log.push(`🎱 Magic Hate Ball — every other player loses $2.`);
    }
  }
  // Fair Play (h7): physical die === 7 → owner of horse 7 may pick a non-lead horse to +2
  let fairPlayPending: PendingChoice | null = null;
  if (horseDie === 7) {
    const owner = ownerOfHorse(next, 7);
    if (owner && abilityIdFor(next, 7) === 'h7_fair_play') {
      fairPlayPending = { kind: 'fair_play', playerId: owner.playerId };
      log.push(`⚖️ Fair Play — ${owner.username} may push a non-lead horse +2 before acting.`);
    }
  }

  // Race end check — when the 3rd horse finishes, grant all players one final
  // action turn before scoring instead of ending immediately.
  if (next.finishedCount >= FINISH_POSITIONS && !next.finalRound) {
    next = {
      ...next,
      finalRound: true,
      step: 'action',
      currentTurnSeat: state.activePlayerSeat,
      players: next.players.map(p => ({ ...p, actedThisRound: false })),
      ...(fairPlayPending ? { pendingChoice: fairPlayPending } : {}),
    };
    log.push('🏁 3rd horse finished! Everyone gets one final action before scoring.');
  } else {
    // Transition to action phase — all players act starting with active
    next = {
      ...next,
      step: 'action',
      currentTurnSeat: state.activePlayerSeat,
      players: next.players.map(p => ({ ...p, actedThisRound: false })),
      // Apply Fair Play pending choice (gates everyone until horse-7 owner resolves it)
      ...(fairPlayPending ? { pendingChoice: fairPlayPending } : {}),
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
  // Everyone has acted — if this was the final round, end the race; otherwise start the next round.
  if (state.finalRound) {
    return {
      ...state,
      phase: 'finished',
      step: 'done',
      currentTurnSeat: null,
      log: [...state.log, ...log, '🏁 Race complete!'].slice(-50),
    };
  }
  const advanced = advanceRound(state);
  return { ...advanced, log: [...state.log, ...log, `— round ${advanced.round} —`].slice(-50) };
}

// ---------- Actions ----------

export type ActionPayload = (
  | { type: 'bet'; amount: number; strungAlong?: boolean } // Strung Along (h1): owner's alt option — pay $1, bet $1, +1 the bet target
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
  | { type: 'resolve_choice'; choice: PendingChoiceResolution } // Phase 4 — resolve a pendingChoice
) & {
  /**
   * Optional Wild Number override: use this horse number (1..8) instead of the rolled die
   * to validate / take the action. Costs one wild from the player's pool of MAX_WILDS.
   * Not applicable to claim_bonus, refresh_wild, or resolve_choice.
   */
  wild?: number;
};

/** Payload variant for resolving a `pendingChoice`. The `kind` must match the pending choice. */
export type PendingChoiceResolution =
  | { kind: 'half_off_sale';   horseNum: number | null }       // null = skip
  | { kind: 'partner_in_crime'; horseNum: number | null }      // null = skip
  | { kind: 'miracle_worker';  option: 'concession' | 'helmet' | 'jersey';
      cellIdx?: number; horseNum?: number; markHorse?: number }
  | { kind: 'inventory_check'; horseNum: number | null }       // pick one of two (engine drives 2× calls); null = skip remaining
  | { kind: 'chain_reaction';  cellIdx: number | null }        // null = skip
  | { kind: 'charley_horse';   horseNum: number | null }       // null = skip
  | { kind: 'fair_play';       horseNum: number | null }       // null = skip
  | { kind: 'double_crosser';  horseNum: number | null };      // null = skip second mark

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
      player.money >= effectiveHorseCost(state, horseNum)) return true;
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

  // Phase 4: pending ability choice resolves before anything else.
  if (state.pendingChoice) {
    if (state.pendingChoice.playerId !== playerId) return { error: 'An ability choice is pending for another player' };
    if (payload.type !== 'resolve_choice') return { error: 'You must resolve your ability choice first' };
    return applyChoiceResolution(state, playerId, payload.choice);
  }
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
      // Strung Along (h1): owner's alt option — instead of a normal bet, pay $1 to place a $1 bet
      // AND advance the bet target +1 (cap before finish). Must be requested via `strungAlong: true`.
      const strungAlong = !!payload.strungAlong;
      if (strungAlong) {
        if (!playerHasAbility(state, player, 1, 'h1_strung_along')) {
          return { error: "You don't have Strung Along this race" };
        }
        if (horse.finished) return { error: 'Cannot bet on a finished horse' };
        const pastNoBet = horse.position >= NO_BET_SPACE;
        if (pastNoBet && player.helmets[horseIdx] === 0) {
          return { error: `Horse ${rolledHorse} is past the No-Bet line — you need a helmet first` };
        }
        if (player.money < 1) return { error: 'Not enough money for Strung Along ($1)' };
        updatedPlayer = {
          ...updatedPlayer,
          money: player.money - 1,
          bets: player.bets.map((b, i) => (i === horseIdx ? b + 1 : b)),
        };
        log.push(`🧶 Strung Along — ${player.username} pays $1, bets $1 on horse ${rolledHorse}, advances it +1.`);
        // Capture the move so the client animates the +1 (rollId bump tells useSequencedRace
        // to re-pick up positions; lastSequence drives the visual tween).
        const before = state.horses[horseIdx];
        const nextStateMoved = moveHorse(state, horseIdx, 1, false);
        const after = nextStateMoved.horses[horseIdx];
        const moves: LSMove[] = (after.position !== before.position || after.finished !== before.finished)
          ? [{ horseIdx, fromPos: before.position, toPos: after.position, fromFinished: before.finished, toFinished: after.finished }]
          : [];
        const finalState = moves.length
          ? { ...nextStateMoved, lastSequence: moves, rollId: nextStateMoved.rollId + 1 }
          : nextStateMoved;
        return commitTurn(finalState, playerIdx, updatedPlayer, log);
      }
      if (![1, 2, 3].includes(payload.amount)) return { error: 'Bet must be $1, $2, or $3' };
      if (horse.finished) return { error: 'Cannot bet on a finished horse' };
      const pastNoBet = horse.position >= NO_BET_SPACE;
      if (pastNoBet && player.helmets[horseIdx] === 0) {
        return { error: `Horse ${rolledHorse} is past the No-Bet line — you need a helmet first` };
      }
      // Early Bird Special (h4): owner's bet is free if they have $0 already wagered on the target
      const earlyBird = playerHasAbility(state, player, 4, 'h4_early_bird') && player.bets[horseIdx] === 0;
      const cost = earlyBird ? 0 : payload.amount;
      if (player.money < cost) return { error: 'Not enough money' };
      updatedPlayer = {
        ...updatedPlayer,
        money: player.money - cost,
        bets: player.bets.map((b, i) => (i === horseIdx ? b + payload.amount : b)),
      };
      log.push(
        earlyBird
          ? `💰 Early Bird — ${player.username} places a free $${payload.amount} bet on horse ${rolledHorse}.`
          : `💰 ${player.username} bets $${payload.amount} on horse ${rolledHorse}.`,
      );
      // Fancy Hat (h5): owner gains $1 for any bet on a horse they have a helmet on
      if (playerHasAbility(state, player, 5, 'h5_fancy_hat') && player.helmets[horseIdx] > 0) {
        updatedPlayer = { ...updatedPlayer, money: updatedPlayer.money + 1 };
        log.push(`🎩 Fancy Hat — ${player.username} gains $1.`);
      }
      // Pay it Forward (h3): on a $3 bet, if the bet target shares a space with at least one
      // other unfinished horse, every horse on that space advances +1 (cap before finish).
      if (
        payload.amount === 3 &&
        playerHasAbility(state, player, 3, 'h3_pay_it_forward') &&
        !horse.finished
      ) {
        const targetPos = horse.position;
        const sharingIdxs: number[] = [];
        for (let i = 0; i < NUM_HORSES; i++) {
          const h = state.horses[i];
          if (h.finished) continue;
          if (h.position === targetPos) sharingIdxs.push(i);
        }
        if (sharingIdxs.length >= 2) {
          // Apply +1 to each (capped — no crossing the finish line) and record for animation.
          let nextState = state;
          const moves: LSMove[] = [];
          for (const idx of sharingIdxs) {
            const before = nextState.horses[idx];
            nextState = moveHorse(nextState, idx, 1, false);
            const after = nextState.horses[idx];
            if (after.position !== before.position || after.finished !== before.finished) {
              moves.push({ horseIdx: idx, fromPos: before.position, toPos: after.position, fromFinished: before.finished, toFinished: after.finished });
            }
          }
          if (moves.length > 0) {
            nextState = { ...nextState, lastSequence: moves, rollId: nextState.rollId + 1 };
          }
          log.push(`🤝 Pay it Forward — ${sharingIdxs.length} horses on space ${targetPos} advance +1.`);
          return commitTurn(nextState, playerIdx, updatedPlayer, log);
        }
      }
      break;
    }

    case 'buy': {
      if (horse.finished) return { error: 'Cannot buy a finished horse' };
      if (!state.market.includes(rolledHorse)) return { error: `Horse ${rolledHorse} is not in the market` };
      const cost = effectiveHorseCost(state, rolledHorse);
      if (player.money < cost) return { error: `Not enough money (cost $${cost})` };
      updatedPlayer = {
        ...updatedPlayer,
        money: player.money - cost,
        ownedHorses: [...player.ownedHorses, rolledHorse].sort((a, b) => a - b),
      };
      log.push(`🏠 ${player.username} buys horse ${rolledHorse} for $${cost}.`);
      const acq = applyOnAcquired(state, updatedPlayer, rolledHorse);
      updatedPlayer = acq.player;
      log.push(...acq.logLines);
      const newMarket = acq.state.market.filter(n => n !== rolledHorse);
      return commitTurn(acq.state, playerIdx, updatedPlayer, log, {
        market: newMarket,
        ...(acq.pendingChoice ? { pendingChoice: acq.pendingChoice } : {}),
      });
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
      // Product Placement (h8): if this helmet completed a jockey set on rolledHorse → free $2 bet
      const pp = tryProductPlacement(state, updatedPlayer, rolledHorse);
      if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
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
      if (allMarksOnBar(state, rolledHorse).has(m)) {
        return { error: `Horse ${m} is already marked on horse ${rolledHorse}'s bar` };
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
      // Sticky Fingers (h7): owner of horse 7 steals up to $2 from owner of the jerseyed horse
      const stolen = stickyFingersSteal(state, updatedPlayer, rolledHorse);
      let customPlayers: LSPlayer[] | undefined;
      if (stolen) {
        updatedPlayer = stolen.actor;
        log.push(stolen.line);
        customPlayers = replacePlayerInList(state.players, stolen.victimSeat, stolen.victim);
      }
      // Product Placement (h8): if this jersey completed a jockey set on rolledHorse → free $2 bet
      const pp = tryProductPlacement(state, updatedPlayer, rolledHorse);
      if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
      // Double Crosser (h4): pending pick to mark a SECOND different horse on the same card
      let jerseyPending: PendingChoice | null = null;
      if (playerHasAbility(state, updatedPlayer, 4, 'h4_double_crosser')) {
        // Only meaningful if there's still room on the bar (8 distinct horse numbers max)
        const onBar = allMarksOnBar(state, rolledHorse);
        if (onBar.size < NUM_HORSES) {
          jerseyPending = { kind: 'double_crosser', playerId: player.playerId, rolledHorse };
          log.push(`🪞 Double Crosser — ${player.username} may mark a second horse on the bar.`);
        }
      }
      if (customPlayers || jerseyPending) {
        return commitTurn(state, playerIdx, updatedPlayer, log, {
          ...(customPlayers ? { players: customPlayers } : {}),
          ...(jerseyPending ? { pendingChoice: jerseyPending } : {}),
        });
      }
      break;
    }

    case 'concession': {
      const cell = payload.cellIdx;
      if (!Number.isInteger(cell) || cell < 0 || cell >= CONCESSION_CELLS) {
        return { error: 'Bad concession cell' };
      }
      const cellHorse = state.concessionGrid[cell];
      // Scatter Shot (h3): owner may mark a cell showing rolled±1 (no wrap), mutually exclusive with Wild.
      const scatterShot =
        cellHorse !== rolledHorse &&
        !wildConsumed &&
        playerHasAbility(state, player, 3, 'h3_scatter_shot') &&
        cellHorse >= 1 && cellHorse <= NUM_HORSES &&
        Math.abs(cellHorse - rolledHorse) === 1;
      if (cellHorse !== rolledHorse && !scatterShot) {
        return { error: `That cell shows horse ${cellHorse}, not ${rolledHorse}` };
      }
      if (player.concessionMarks[cell]) return { error: 'Cell already marked' };

      const newMarks = player.concessionMarks.slice();
      newMarks[cell] = true;
      updatedPlayer = { ...updatedPlayer, concessionMarks: newMarks };
      log.push(
        scatterShot
          ? `🎯 Scatter Shot — ${player.username} marks a concession cell for horse ${cellHorse}.`
          : `🎪 ${player.username} marks a concession cell for horse ${rolledHorse}.`,
      );

      // Apply row/col-completion immediate abilities (Out of Alignment, Five Leaf Clover).
      const completion = applyConcessionCompletion(state, updatedPlayer, cell);
      updatedPlayer = completion.actor;
      log.push(...completion.logLines);
      const { rowComplete, colComplete, bonusCount } = completion;

      // Chain Reaction (h1) + Charley Horse (h5): set pendingChoice; resolves before pendingBonus.
      // If BOTH would fire (h1 + h5 both active and a row+col was completed), prefer Chain Reaction
      // (column trigger), then Charley Horse runs as part of the next bonus cycle. Realistically only
      // one is in play per race since they're on different horses, and only if both are owned.
      let abilityPending: PendingChoice | null = null;
      if (colComplete && playerHasAbility(state, updatedPlayer, 1, 'h1_chain_reaction')) {
        abilityPending = { kind: 'chain_reaction', playerId: player.playerId };
        log.push(`⚡ Chain Reaction — ${player.username} may mark any concession cell.`);
      } else if (rowComplete && playerHasAbility(state, updatedPlayer, 5, 'h5_charley_horse')) {
        abilityPending = { kind: 'charley_horse', playerId: player.playerId };
        log.push(`🐎 Charley Horse — ${player.username} may move any horse back 1.`);
      }

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
          // pendingChoice resolves first (gated in takeAction); pendingBonus persists after.
          pendingChoice: abilityPending,
          log: [...state.log, ...log].slice(-50),
        };
      }
      // No bonus, but maybe a pending ability choice (e.g. Charley Horse on a row that
      // doesn't cap a bonus — rare, but possible if row was completed by a different cell)
      if (abilityPending) {
        return commitTurn(state, playerIdx, updatedPlayer, log, { pendingChoice: abilityPending });
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
      // Silver Spoon (h2): owner of horse 2 gets $9 instead of $7
      const silverSpoon = playerHasAbility(state, player, 2, 'h2_silver_spoon');
      const amount = silverSpoon ? 9 : 7;
      updatedPlayer.money += amount;
      log.push(`💵 ${player.username} claims +$${amount}${silverSpoon ? ' (Silver Spoon)' : ''}.`);
      break;
    }

    case 'back2x2':
    case 'forward2x2': {
      const a = requireHorse(payload.horse,  'first horse');
      if (typeof a === 'object') return a;
      const b = requireHorse(payload.horse2, 'second horse');
      if (typeof b === 'object') return b;
      if (a === b) return { error: 'Pick two different horses' };
      const isBack = bonus.id === 'back2x2';
      // Receding Mare Line (h3): owner adds -1 to BACK bonuses (each horse goes back 3)
      // Donut Dollie (h8): owner adds +1 in the same direction (each horse +/- 3)
      const recede = isBack && playerHasAbility(state, player, 3, 'h3_receding_mare');
      const donut  = playerHasAbility(state, player, 8, 'h8_donut_dollie');
      let dist = isBack ? -2 : 2;
      if (recede) dist -= 1;
      if (donut)  dist += isBack ? -1 : 1;
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
      const extras: string[] = [];
      if (recede) extras.push('Receding Mare');
      if (donut)  extras.push('Donut Dollie');
      const tag = extras.length ? ` (${extras.join(' + ')})` : '';
      log.push(`${dist < 0 ? '↩️' : '↪️'} ${player.username} moves horses ${order[0]} and ${order[1]} ${dist < 0 ? 'back' : 'forward'} ${Math.abs(dist)} each${tag}.`);
      break;
    }

    case 'back3':
    case 'forward3': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      const isBack = bonus.id === 'back3';
      const recede = isBack && playerHasAbility(state, player, 3, 'h3_receding_mare');
      const donut  = playerHasAbility(state, player, 8, 'h8_donut_dollie');
      let dist = isBack ? -3 : 3;
      if (recede) dist -= 1;
      if (donut)  dist += isBack ? -1 : 1;
      if (dist > 0 && next.horses[h - 1].position >= TRACK_LENGTH - 1) {
        return { error: `Horse ${h} is already at the finish line — +${dist} would be wasted` };
      }
      if (dist < 0 && next.horses[h - 1].position <= 0) {
        return { error: `Horse ${h} is still in the starting gate — ${dist} would be wasted` };
      }
      moveAndRecord(h, dist);
      const extras: string[] = [];
      if (recede) extras.push('Receding Mare');
      if (donut)  extras.push('Donut Dollie');
      const tag = extras.length ? ` (${extras.join(' + ')})` : '';
      log.push(`${dist < 0 ? '↩️' : '↪️'} ${player.username} moves horse ${h} ${dist < 0 ? 'back' : 'forward'} ${Math.abs(dist)}${tag}.`);
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
      // Three Four Five (h4): owner of horse 4 places a $5 free bet instead of $3
      const threeFourFive = playerHasAbility(state, player, 4, 'h4_three_four_five');
      const amount = threeFourFive ? 5 : 3;
      updatedPlayer.bets = updatedPlayer.bets.map((amt, i) => (i === h - 1 ? amt + amount : amt));
      log.push(`💰 ${player.username} places a free $${amount} bet on horse ${h}${threeFourFive ? ' (Three Four Five)' : ''}.`);
      // Fancy Hat (h5): also fires on free-bet bonus claims when the player has a helmet on that horse
      if (playerHasAbility(state, player, 5, 'h5_fancy_hat') && updatedPlayer.helmets[h - 1] > 0) {
        updatedPlayer.money += 1;
        log.push(`🎩 Fancy Hat — ${player.username} gains $1.`);
      }
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
      const pp = tryProductPlacement(next, updatedPlayer, h);
      if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
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
      if (allMarksOnBar(state, h).has(m)) {
        return { error: `Horse ${m} is already marked on horse ${h}'s bar` };
      }
      updatedPlayer.jerseys = updatedPlayer.jerseys.map((c, i) => (i === h - 1 ? c + 1 : c));
      updatedPlayer.jerseyMarks = updatedPlayer.jerseyMarks.map((arr, i) =>
        i === h - 1 ? [...arr, m] : arr,
      );
      log.push(`🏁 ${player.username} marks a jersey on horse ${h} (+ horse ${m} on its bar).`);
      // Sticky Fingers (h7): also fires on bonus-claim jersey marks
      const stolen = stickyFingersSteal(next, updatedPlayer, h);
      if (stolen) {
        updatedPlayer = stolen.actor;
        next = { ...next, players: replacePlayerInList(next.players, stolen.victimSeat, stolen.victim) };
        log.push(stolen.line);
      }
      const pp = tryProductPlacement(next, updatedPlayer, h);
      if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
      break;
    }

    case 'free_horse': {
      const h = requireHorse(payload.horse);
      if (typeof h === 'object') return h;
      if (!next.market.includes(h)) return { error: `Horse ${h} is not in the market` };
      updatedPlayer.ownedHorses = [...updatedPlayer.ownedHorses, h].sort((a, b) => a - b);
      next = { ...next, market: next.market.filter(n => n !== h) };
      log.push(`🏠 ${player.username} takes horse ${h} from the market for free.`);
      // Equestrian Inception (h6): Free-Horse-specific bonus
      if (h === 6 && abilityIdFor(state, 6) === 'h6_equestrian_inception') {
        updatedPlayer.money += 6;
        log.push(`✨ Equestrian Inception — ${player.username} also gains $6.`);
      }
      // All other on-acquisition abilities (Loosey Goosey, Half Off Sale, Partner in Crime,
      // Miracle Worker, Inventory Check) fire here too — fairness so the horse's ability
      // works regardless of how it was obtained.
      const acq = applyOnAcquired(next, updatedPlayer, h);
      updatedPlayer = acq.player;
      next = acq.state;
      log.push(...acq.logLines);
      if (acq.pendingChoice) {
        next = { ...next, pendingChoice: acq.pendingChoice };
      }
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

/** Replace the player with `seat` in `list` (returns a new array). */
function replacePlayerInList(list: LSPlayer[], seat: number, replacement: LSPlayer): LSPlayer[] {
  return list.map(p => (p.seat === seat ? replacement : p));
}

/**
 * After a player marks a concession cell (by any means — normal action, Chain Reaction,
 * Miracle Worker), apply the row/col-completion-triggered abilities (Out of Alignment +$1
 * per completion, Five Leaf Clover refunds 1 Wild on row completion). Returns the updated
 * actor + the rowComplete/colComplete flags so callers can decide what to do next.
 */
function applyConcessionCompletion(
  state: LSState,
  actor: LSPlayer,
  cellIdx: number,
): { actor: LSPlayer; logLines: string[]; rowComplete: boolean; colComplete: boolean; bonusCount: number } {
  const marks = actor.concessionMarks;
  const row = Math.floor(cellIdx / CONCESSION_COLS);
  const col = cellIdx % CONCESSION_COLS;
  let rowComplete = true;
  for (let c = 0; c < CONCESSION_COLS; c++) {
    if (!marks[row * CONCESSION_COLS + c]) { rowComplete = false; break; }
  }
  let colComplete = true;
  for (let r = 0; r < CONCESSION_ROWS; r++) {
    if (!marks[r * CONCESSION_COLS + col]) { colComplete = false; break; }
  }
  const bonusCount = (rowComplete ? 1 : 0) + (colComplete ? 1 : 0);
  let updatedActor = actor;
  const logLines: string[] = [];

  // Out of Alignment (h1): +$1 per completed row or column
  if (bonusCount > 0 && playerHasAbility(state, actor, 1, 'h1_out_of_alignment')) {
    updatedActor = { ...updatedActor, money: updatedActor.money + bonusCount };
    logLines.push(`💵 Out of Alignment — ${actor.username} gains $${bonusCount}.`);
  }
  // Five Leaf Clover (h5): horizontal row completion refunds 1 used Wild
  if (rowComplete && playerHasAbility(state, actor, 5, 'h5_five_leaf')) {
    if (updatedActor.wildsUsed > 0) {
      updatedActor = { ...updatedActor, wildsUsed: updatedActor.wildsUsed - 1 };
      logLines.push(`✨ Five Leaf Clover — refunds 1 Wild.`);
    }
  }
  return { actor: updatedActor, logLines, rowComplete, colComplete, bonusCount };
}

/**
 * Fire all on-acquisition horse abilities for `horseNum` (regardless of how the horse
 * was acquired — regular Buy, Free Horse bonus, or Half Off Sale follow-up). Returns
 * the mutated player + any state delta + a pending choice to set.
 *
 * Equestrian Inception is NOT handled here because it's Free-Horse-specific (the caller
 * applies it inline at the Free Horse claim site).
 */
function applyOnAcquired(
  state: LSState,
  acquirer: LSPlayer,
  horseNum: number,
): { player: LSPlayer; state: LSState; pendingChoice: PendingChoice | null; logLines: string[] } {
  const abId = abilityIdFor(state, horseNum);
  let player = acquirer;
  let next = state;
  let pendingChoice: PendingChoice | null = null;
  const logLines: string[] = [];
  const animMoves: LSMove[] = [];

  // Loosey Goosey (h3) — refund up to 2 used Wilds
  if (horseNum === 3 && abId === 'h3_loosey_goosey') {
    const refund = Math.min(2, player.wildsUsed);
    if (refund > 0) {
      player = { ...player, wildsUsed: player.wildsUsed - refund };
      logLines.push(`✨ Loosey Goosey — refunds ${refund} Wild${refund === 1 ? '' : 's'}.`);
    }
  }
  // Half Off Sale (h2) — pick another market horse at half price
  if (horseNum === 2 && abId === 'h2_half_off_sale') {
    pendingChoice = { kind: 'half_off_sale', playerId: player.playerId };
    logLines.push(`🛍️ Half Off Sale — ${player.username} may buy another horse at half price.`);
  }
  // Partner in Crime (h6) — horse 6 +2 immediately; pending pick for a second horse
  if (horseNum === 6 && abId === 'h6_partner_in_crime') {
    const before = next.horses[5];
    next = moveHorse(next, 5, 2, false);
    const after = next.horses[5];
    if (after.position !== before.position || after.finished !== before.finished) {
      animMoves.push({ horseIdx: 5, fromPos: before.position, toPos: after.position, fromFinished: before.finished, toFinished: after.finished });
    }
    pendingChoice = { kind: 'partner_in_crime', playerId: player.playerId };
    logLines.push(`🤝 Partner in Crime — horse 6 +2, pick another to also +2.`);
  }
  // Miracle Worker (h6) — pick concession / helmet / jersey
  if (horseNum === 6 && abId === 'h6_miracle_worker') {
    pendingChoice = { kind: 'miracle_worker', playerId: player.playerId };
    logLines.push(`✨ Miracle Worker — ${player.username} may mark a concession / helmet / jersey.`);
  }
  // Inventory Check (h7) — pick 2 jersey targets
  if (horseNum === 7 && abId === 'h7_inventory_check') {
    pendingChoice = { kind: 'inventory_check', playerId: player.playerId, remaining: 2 };
    logLines.push(`📋 Inventory Check — ${player.username} marks jerseys on 2 horse cards.`);
  }

  // Push any acquisition-time horse movement through the animation pipeline.
  if (animMoves.length > 0) {
    next = { ...next, lastSequence: animMoves, rollId: next.rollId + 1 };
  }

  return { player, state: next, pendingChoice, logLines };
}

/**
 * Product Placement (h8) helper. If the actor owns horse 8 AND its ability is h8_product_placement,
 * AND completing this action made `horseNum` form a fresh helmet+jersey jockey set for this player
 * (and hasn't already triggered for this horse), return an updated player with a free $2 bet on
 * `horseNum` and the trigger recorded. Returns null if no trigger.
 */
function tryProductPlacement(state: LSState, actor: LSPlayer, horseNum: number): { actor: LSPlayer; line: string } | null {
  if (!playerHasAbility(state, actor, 8, 'h8_product_placement')) return null;
  const idx = horseNum - 1;
  if (actor.helmets[idx] === 0 || actor.jerseys[idx] === 0) return null;
  const already = actor.productPlacementTriggered ?? [];
  if (already.includes(horseNum)) return null;
  // Don't place a bet on a horse past the no-bet line (without a helmet); we already have the helmet here.
  // Don't place a bet on a finished horse.
  if (state.horses[idx].finished) return null;
  return {
    actor: {
      ...actor,
      bets: actor.bets.map((b, i) => (i === idx ? b + 2 : b)),
      productPlacementTriggered: [...already, horseNum],
    },
    line: `🎬 Product Placement — ${actor.username} earns a free $2 bet on horse ${horseNum}.`,
  };
}

/**
 * Sticky Fingers (h7) helper. Returns the actor + victim deltas and a log line if all
 * preconditions hold; null otherwise. Preconditions:
 *   - Actor owns horse 7 AND its ability is h7_sticky_fingers
 *   - Marked horse card has an owner OTHER than the actor
 *   - Victim has ≥ $1 (we steal up to $2, capped at their balance)
 */
function stickyFingersSteal(
  state: LSState,
  actor: LSPlayer,
  cardHorse: number,
): { actor: LSPlayer; victim: LSPlayer; victimSeat: number; line: string } | null {
  if (!playerHasAbility(state, actor, 7, 'h7_sticky_fingers')) return null;
  const victim = ownerOfHorse(state, cardHorse);
  if (!victim || victim.playerId === actor.playerId) return null;
  const take = Math.min(2, victim.money);
  if (take <= 0) return null;
  return {
    actor: { ...actor, money: actor.money + take },
    victim: { ...victim, money: victim.money - take },
    victimSeat: victim.seat,
    line: `💸 Sticky Fingers — ${actor.username} steals $${take} from ${victim.username}.`,
  };
}

/**
 * Apply a pending ability choice resolution. After resolution:
 *   - Inventory Check decrements `remaining`; clears at 0 (or on `null` skip)
 *   - All other kinds clear `pendingChoice` immediately
 *   - If `pendingBonus` is also set, leave it (caller still needs to claim bonuses)
 *   - If neither pending is set, advance the action turn normally
 */
function applyChoiceResolution(
  state: LSState,
  playerId: string,
  choice: PendingChoiceResolution,
): LSState | { error: string } {
  const pending = state.pendingChoice;
  if (!pending) return { error: 'No choice pending' };
  if (pending.kind !== choice.kind) return { error: `Pending choice is ${pending.kind}, not ${choice.kind}` };
  const playerIdx = state.players.findIndex(p => p.playerId === playerId);
  if (playerIdx < 0) return { error: 'Not a seated player' };
  const player = state.players[playerIdx];
  let next: LSState = state;
  let updatedPlayer: LSPlayer = player;
  const log: string[] = [];
  /** Custom players list when a non-actor player is mutated (e.g. Sticky Fingers, victim of theft). */
  let customPlayers: LSPlayer[] | undefined;
  /** Horse moves accumulated during this resolution — bumped into lastSequence at the end. */
  const animMoves: LSMove[] = [];

  const moveAndRecord = (horseNum: number, dist: number, allowFinish = false) => {
    const idx = horseNum - 1;
    const before = next.horses[idx];
    next = moveHorse(next, idx, dist, allowFinish);
    const after = next.horses[idx];
    if (after.position !== before.position || after.finished !== before.finished) {
      animMoves.push({ horseIdx: idx, fromPos: before.position, toPos: after.position, fromFinished: before.finished, toFinished: after.finished });
    }
  };

  switch (choice.kind) {
    case 'half_off_sale': {
      if (choice.horseNum === null) { log.push(`(Half Off Sale — skipped)`); break; }
      const h = choice.horseNum;
      if (h < 1 || h > NUM_HORSES) return { error: 'Pick a market horse (1-8)' };
      if (!next.market.includes(h)) return { error: `Horse ${h} is not in the market` };
      if (next.horses[h - 1].finished) return { error: 'Cannot buy a finished horse' };
      const halfCost = Math.floor(effectiveHorseCost(state, h) / 2);
      if (updatedPlayer.money < halfCost) return { error: `Not enough money (half cost $${halfCost})` };
      updatedPlayer = {
        ...updatedPlayer,
        money: updatedPlayer.money - halfCost,
        ownedHorses: [...updatedPlayer.ownedHorses, h].sort((a, b) => a - b),
      };
      next = { ...next, market: next.market.filter(n => n !== h) };
      log.push(`🛍️ Half Off Sale — ${player.username} buys horse ${h} for $${halfCost}.`);
      // Cascade on-acquisition abilities (Loosey Goosey etc.) — but skip if the half-price
      // pick was ANOTHER horse 2 with Half Off Sale (would chain forever; engine protects
      // by clearing pendingChoice at the end of resolution, but be explicit and skip).
      if (!(h === 2 && abilityIdFor(state, 2) === 'h2_half_off_sale')) {
        const acq = applyOnAcquired(next, updatedPlayer, h);
        updatedPlayer = acq.player;
        next = acq.state;
        log.push(...acq.logLines);
        // If this cascade itself sets a pending choice, stack it for after current resolution.
        if (acq.pendingChoice) {
          next = { ...next, pendingChoice: acq.pendingChoice };
        }
      }
      break;
    }
    case 'partner_in_crime': {
      if (choice.horseNum === null) { log.push(`(Partner in Crime — skipped)`); break; }
      const h = choice.horseNum;
      if (h < 1 || h > NUM_HORSES) return { error: 'Pick an unfinished horse (1-8)' };
      if (next.horses[h - 1].finished) return { error: 'Pick an unfinished horse' };
      moveAndRecord(h, 2, false); // capped before finish
      log.push(`🤝 Partner in Crime — horse ${h} +2 (capped before finish).`);
      break;
    }
    case 'miracle_worker': {
      if (choice.option === 'concession') {
        const c = choice.cellIdx;
        if (typeof c !== 'number' || c < 0 || c >= CONCESSION_CELLS) return { error: 'Pick a cell' };
        if (updatedPlayer.concessionMarks[c]) return { error: 'That cell is already marked' };
        const marks = updatedPlayer.concessionMarks.slice();
        marks[c] = true;
        updatedPlayer = { ...updatedPlayer, concessionMarks: marks };
        log.push(`✨ Miracle Worker — ${player.username} marks a concession cell.`);
        // If this mark completes a row/col, apply Out of Alignment / Five Leaf Clover.
        const completion = applyConcessionCompletion(next, updatedPlayer, c);
        updatedPlayer = completion.actor;
        log.push(...completion.logLines);
      } else if (choice.option === 'helmet') {
        const h = choice.horseNum;
        if (!h || h < 1 || h > NUM_HORSES) return { error: 'Pick a horse for the helmet' };
        if (updatedPlayer.helmets[h - 1] >= MAX_HELMETS_PER_HORSE) return { error: `Already have a helmet on horse ${h}` };
        updatedPlayer = { ...updatedPlayer, helmets: updatedPlayer.helmets.map((c, i) => (i === h - 1 ? c + 1 : c)) };
        log.push(`✨ Miracle Worker — ${player.username} marks a helmet on horse ${h}.`);
        const pp = tryProductPlacement(next, updatedPlayer, h);
        if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
      } else if (choice.option === 'jersey') {
        const h = choice.horseNum;
        const m = choice.markHorse;
        if (!h || h < 1 || h > NUM_HORSES) return { error: 'Pick a horse for the jersey' };
        if (!m || m < 1 || m > NUM_HORSES) return { error: 'Pick a horse to mark on the bar' };
        if (updatedPlayer.jerseys[h - 1] >= MAX_JERSEYS_PER_HORSE) return { error: `Already have a jersey on horse ${h}` };
        if (allMarksOnBar(next, h).has(m)) return { error: `Horse ${m} is already on horse ${h}'s bar` };
        updatedPlayer = {
          ...updatedPlayer,
          jerseys: updatedPlayer.jerseys.map((c, i) => (i === h - 1 ? c + 1 : c)),
          jerseyMarks: updatedPlayer.jerseyMarks.map((arr, i) => (i === h - 1 ? [...arr, m] : arr)),
        };
        log.push(`✨ Miracle Worker — ${player.username} marks a jersey on horse ${h} (+ horse ${m}).`);
        const stolen = stickyFingersSteal(next, updatedPlayer, h);
        if (stolen) {
          updatedPlayer = stolen.actor;
          customPlayers = replacePlayerInList(next.players, stolen.victimSeat, stolen.victim);
          log.push(stolen.line);
        }
        const pp = tryProductPlacement(next, updatedPlayer, h);
        if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
      } else {
        return { error: 'Pick concession, helmet, or jersey' };
      }
      break;
    }
    case 'inventory_check': {
      if (choice.horseNum === null) {
        log.push(`(Inventory Check — skipped remaining)`);
        const cleared: LSState = { ...next, pendingChoice: null };
        return finishChoiceResolution(cleared, playerIdx, updatedPlayer, customPlayers, log);
      }
      const h = choice.horseNum;
      if (h < 1 || h > NUM_HORSES) return { error: 'Pick a horse (1-8)' };
      if (updatedPlayer.jerseys[h - 1] >= MAX_JERSEYS_PER_HORSE) return { error: `Horse ${h} already has a jersey` };
      updatedPlayer = { ...updatedPlayer, jerseys: updatedPlayer.jerseys.map((c, i) => (i === h - 1 ? c + 1 : c)) };
      log.push(`📋 Inventory Check — ${player.username} marks a jersey on horse ${h}.`);
      const pp = tryProductPlacement(next, updatedPlayer, h);
      if (pp) { updatedPlayer = pp.actor; log.push(pp.line); }
      // Decrement remaining; if still > 0, keep pendingChoice set
      const inv = pending as Extract<PendingChoice, { kind: 'inventory_check' }>;
      const remaining = inv.remaining - 1;
      if (remaining > 0) {
        const players = customPlayers ? customPlayers.slice() : next.players.slice();
        players[playerIdx] = updatedPlayer;
        return {
          ...next, players,
          pendingChoice: { kind: 'inventory_check', playerId, remaining },
          log: [...next.log, ...log].slice(-50),
        };
      }
      break;
    }
    case 'chain_reaction': {
      if (choice.cellIdx === null) { log.push(`(Chain Reaction — skipped)`); break; }
      const c = choice.cellIdx;
      if (c < 0 || c >= CONCESSION_CELLS) return { error: 'Pick a cell' };
      if (updatedPlayer.concessionMarks[c]) return { error: 'That cell is already marked' };
      const marks = updatedPlayer.concessionMarks.slice();
      marks[c] = true;
      updatedPlayer = { ...updatedPlayer, concessionMarks: marks };
      log.push(`⚡ Chain Reaction — ${player.username} marks a free concession cell.`);
      // Apply Out of Alignment / Five Leaf Clover if this completes a row/col.
      // (Note: Chain Reaction is mutually exclusive with Out of Alignment per race since
      // both are h1's abilities, so Out of Alignment won't actually fire here — but the
      // call is safe and Five Leaf Clover (h5) may legitimately co-trigger.)
      const completion = applyConcessionCompletion(next, updatedPlayer, c);
      updatedPlayer = completion.actor;
      log.push(...completion.logLines);
      break;
    }
    case 'charley_horse': {
      if (choice.horseNum === null) { log.push(`(Charley Horse — skipped)`); break; }
      const h = choice.horseNum;
      if (h < 1 || h > NUM_HORSES) return { error: 'Pick a horse (1-8)' };
      moveAndRecord(h, -1, false);
      log.push(`🐎 Charley Horse — horse ${h} moves back 1.`);
      break;
    }
    case 'fair_play': {
      if (choice.horseNum === null) { log.push(`(Fair Play — skipped)`); break; }
      const h = choice.horseNum;
      if (h < 1 || h > NUM_HORSES) return { error: 'Pick a horse (1-8)' };
      if (next.horses[h - 1].finished) return { error: 'Pick an unfinished horse' };
      // Must not be the lead (or tied for it) among horses STILL IN THE RACE.
      // Finished horses are off the track and don't count toward the "lead".
      const livePositions = next.horses.filter(x => !x.finished).map(x => x.position);
      const maxLivePos = livePositions.length > 0 ? Math.max(...livePositions) : 0;
      if (next.horses[h - 1].position === maxLivePos) return { error: 'Pick a horse that is not the lead (or tied for it)' };
      moveAndRecord(h, 2, false);
      log.push(`⚖️ Fair Play — horse ${h} +2 (capped before finish).`);
      break;
    }
    case 'double_crosser': {
      const dc = pending as Extract<PendingChoice, { kind: 'double_crosser' }>;
      if (choice.horseNum === null) { log.push(`(Double Crosser — only marked 1 horse)`); break; }
      const m = choice.horseNum;
      if (m < 1 || m > NUM_HORSES) return { error: 'Pick a horse (1-8)' };
      if (allMarksOnBar(next, dc.rolledHorse).has(m)) {
        return { error: `Horse ${m} is already marked on horse ${dc.rolledHorse}'s bar` };
      }
      updatedPlayer = {
        ...updatedPlayer,
        jerseyMarks: updatedPlayer.jerseyMarks.map((arr, i) =>
          i === dc.rolledHorse - 1 ? [...arr, m] : arr,
        ),
      };
      log.push(`🪞 Double Crosser — also marks horse ${m} on horse ${dc.rolledHorse}'s bar.`);
      break;
    }
  }

  // If we moved any horses, push the moves through the animation pipeline so clients tween them.
  let cleared: LSState = { ...next, pendingChoice: null };
  if (animMoves.length > 0) {
    cleared = { ...cleared, lastSequence: animMoves, rollId: cleared.rollId + 1 };
  }
  return finishChoiceResolution(cleared, playerIdx, updatedPlayer, customPlayers, log);
}

/**
 * Tail of `applyChoiceResolution`: stitch the updated player back in and either keep the
 * round paused (if pendingBonus is still active) or advance the action turn.
 */
function finishChoiceResolution(
  state: LSState,
  playerIdx: number,
  updatedPlayer: LSPlayer,
  customPlayers: LSPlayer[] | undefined,
  log: string[],
): LSState {
  const players = customPlayers ? customPlayers.slice() : state.players.slice();
  players[playerIdx] = updatedPlayer;
  const next: LSState = { ...state, players };
  // If pendingBonus is still set, just record the log and wait — bonus claim drives advancement.
  if (next.pendingBonus) {
    return { ...next, log: [...next.log, ...log].slice(-50) };
  }
  return advanceActionTurn(next, updatedPlayer.seat, log);
}

function commitTurn(
  state: LSState,
  playerIdx: number,
  updatedPlayer: LSPlayer,
  log: string[],
  extra: Partial<LSState> = {},
): LSState {
  // If extra.players is provided, start from THAT list (so victim updates from Sticky Fingers
  // etc. survive). Then overwrite the actor slot. Otherwise start from state.players.
  const base = extra.players ?? state.players;
  const players = base.slice();
  players[playerIdx] = updatedPlayer;
  const { players: _ignored, ...restExtra } = extra;
  void _ignored;
  const next: LSState = { ...state, ...restExtra, players };
  // If a pendingChoice was just set by this action (e.g. Half Off Sale after a buy),
  // don't advance the turn — keep waiting on the same player to resolve it.
  if (next.pendingChoice) {
    return { ...next, log: [...next.log, ...log].slice(-50) };
  }
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

// =====================================================================
// Horse-ability helpers (Phase 4)
// =====================================================================

/** Returns the player currently owning horse N, or null. */
export function ownerOfHorse(state: LSState, horseNum: number): LSPlayer | null {
  return state.players.find(p => p.ownedHorses.includes(horseNum)) ?? null;
}

/** Returns the ability id assigned to horse N this race, or null. */
export function abilityIdFor(state: LSState, horseNum: number): string | null {
  return state.assignedAbilities[horseNum] ?? null;
}

/** True when horse N is owned AND its assigned ability id equals `id`. */
export function ownedAbilityActive(state: LSState, horseNum: number, id: string): boolean {
  return ownerOfHorse(state, horseNum) !== null && abilityIdFor(state, horseNum) === id;
}

/** True when player owns horse N AND that horse's assigned ability id equals `id`. */
export function playerHasAbility(state: LSState, player: LSPlayer, horseNum: number, id: string): boolean {
  return player.ownedHorses.includes(horseNum) && abilityIdFor(state, horseNum) === id;
}

/**
 * Effective buy cost for horse N this race. Defaults to {@link HORSE_COSTS} but the
 * horse's assigned ability may discount it (e.g. Pie In The Sky drops horse 2 to $4).
 */
export function effectiveHorseCost(state: LSState, horseNum: number): number {
  const base = HORSE_COSTS[horseNum - 1];
  // Pie In The Sky (h2): owning this horse is a scoring liability — cheaper to compensate.
  if (horseNum === 2 && abilityIdFor(state, 2) === 'h2_pie_in_the_sky') return 4;
  return base;
}

/**
 * End-of-race score breakdown per player, summing five categories:
 *   - Purse: $35/$25/$15 to the owner of each finishing horse (1st/2nd/3rd)
 *   - Bonus: $5 per Jockey Set (horse with both at least one helmet AND one jersey)
 *   - Bets:  payouts from {@link calculateBetWinnings}
 *   - Money: cash on hand at race end
 *   - Abilities (Phase 4): sum of all owned-horse ability scoring adjustments
 */
export type AbilityScoreEntry = {
  /** Ability id from longshotAbilities.ABILITY_BY_ID (e.g. 'h1_golden_corral'). */
  abilityId: string;
  /** Human-readable ability name for the scoring panel breakdown. */
  name: string;
  /** Signed delta in dollars (positive = gained, negative = lost). */
  delta: number;
};

export type FinalScore = {
  playerId: string;
  username: string;
  seat: number;
  purse: number;
  bonus: number;       // jockey-set bonus
  bets: number;
  money: number;
  /** Per-ability score adjustments (one entry per triggered scoring ability). */
  abilityBreakdown: AbilityScoreEntry[];
  /** Sum of `abilityBreakdown[].delta`. */
  abilityTotal: number;
  total: number;
  /** Best podium finish among horses this player owns (1/2/3), or null if none. Used as
   *  a tiebreaker when totals are equal: lower (better) place wins. */
  bestPodium: 1 | 2 | 3 | null;
};

export function calculateFinalScores(state: LSState): FinalScore[] {
  // ---- Precompute purse multipliers (Great Appreciation = horse 8 + h8_great_appreciation) ----
  // If horse 8 podiums AND it's owned AND its assigned ability is Great Appreciation, every
  // podium purse pays +$10 to its owner. This benefits ALL podium owners, not just horse-8's.
  const horse8 = state.horses[7];
  const greatAppActive =
    horse8.finished !== null &&
    ownedAbilityActive(state, 8, 'h8_great_appreciation');
  const purseFor = (place: 1 | 2 | 3): number =>
    PURSE[place - 1] + (greatAppActive ? 10 : 0);

  return state.players.map(player => {
    let purse = 0;
    let bestPodium: 1 | 2 | 3 | null = null;
    for (const horseNum of player.ownedHorses) {
      const place = state.horses[horseNum - 1].finished;
      if (place === 1 || place === 2 || place === 3) {
        purse += purseFor(place);
        if (bestPodium === null || place < bestPodium) bestPodium = place;
      }
    }
    const jockeySets = player.helmets.reduce(
      (acc, h, i) => acc + (h > 0 && player.jerseys[i] > 0 ? 1 : 0),
      0,
    );
    const bonus = jockeySets * 5;
    const bets = calculateBetWinnings(state, player).total;
    const money = player.money;

    // ---- Per-player scoring-time ability adjustments ----
    const abilityBreakdown: AbilityScoreEntry[] = [];
    const push = (abilityId: string, delta: number) => {
      if (delta === 0) return;
      abilityBreakdown.push({ abilityId, name: ABILITY_BY_ID[abilityId]?.name ?? abilityId, delta });
    };

    // Golden Corral (h1): +$10 if owner of horse 1 owns 3+ horses
    if (playerHasAbility(state, player, 1, 'h1_golden_corral') && player.ownedHorses.length >= 3) {
      push('h1_golden_corral', 10);
    }
    // Pie In The Sky (h2): -$10 if owner of horse 2 sees horse 2 not podium
    if (playerHasAbility(state, player, 2, 'h2_pie_in_the_sky') && state.horses[1].finished === null) {
      push('h2_pie_in_the_sky', -10);
    }
    // Dance Card (h4): EVERY owner gains $4 per owned horse marked on horse 4's bar — but
    // only when horse 4 is owned AND its ability is Dance Card.
    if (ownedAbilityActive(state, 4, 'h4_dance_card')) {
      const markedOnH4 = allMarksOnBar(state, 4);
      let countOwnedMarked = 0;
      for (const h of player.ownedHorses) if (markedOnH4.has(h)) countOwnedMarked++;
      push('h4_dance_card', countOwnedMarked * 4);
    }
    // Laundry Day (h5): +$10 if owner of horse 5 has 0 jockey sets
    if (playerHasAbility(state, player, 5, 'h5_laundry_day') && jockeySets === 0) {
      push('h5_laundry_day', 10);
    }
    // Lone Ranger (h6): +$2 per horse where owner of horse 6 has helmet XOR jersey
    if (playerHasAbility(state, player, 6, 'h6_lone_ranger')) {
      let xorCount = 0;
      for (let i = 0; i < NUM_HORSES; i++) {
        const h = player.helmets[i] > 0;
        const j = player.jerseys[i] > 0;
        if (h !== j) xorCount++;
      }
      push('h6_lone_ranger', xorCount * 2);
    }
    // Bread Line (h7): +$3 per filled horizontal row in this player's concession grid
    if (playerHasAbility(state, player, 7, 'h7_bread_line')) {
      let filledRows = 0;
      for (let r = 0; r < CONCESSION_ROWS; r++) {
        let full = true;
        for (let c = 0; c < CONCESSION_COLS; c++) {
          if (!player.concessionMarks[r * CONCESSION_COLS + c]) { full = false; break; }
        }
        if (full) filledRows++;
      }
      push('h7_bread_line', filledRows * 3);
    }
    // Great Appreciation (h8): purse already inflated above; surface as an info entry on
    // the horse-8 owner's card so the scoring panel shows it. Delta=0 here since the
    // money already landed in `purse`.
    if (playerHasAbility(state, player, 8, 'h8_great_appreciation') && greatAppActive) {
      abilityBreakdown.push({
        abilityId: 'h8_great_appreciation',
        name: ABILITY_BY_ID['h8_great_appreciation'].name,
        delta: 0,
      });
    }

    const abilityTotal = abilityBreakdown.reduce((s, e) => s + e.delta, 0);

    return {
      playerId: player.playerId,
      username: player.username,
      seat: player.seat,
      purse,
      bonus,
      bets,
      money,
      abilityBreakdown,
      abilityTotal,
      total: purse + bonus + bets + money + abilityTotal,
      bestPodium,
    };
  });
}

/**
 * Comparator for sorting final scores from best → worst.
 *   1) Higher total wins.
 *   2) Tiebreaker: player whose owned horse finished in a HIGHER place wins
 *      (1st > 2nd > 3rd > no podium). If still tied, considered an exact tie.
 */
export function compareFinalScores(a: FinalScore, b: FinalScore): number {
  if (a.total !== b.total) return b.total - a.total;
  const aPodium = a.bestPodium ?? 4;
  const bPodium = b.bestPodium ?? 4;
  return aPodium - bPodium;
}
