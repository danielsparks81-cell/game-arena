// Yahtzee — 1–6 players, classic 13-category scorecard, 3 rolls per turn.
// Solo-friendly: a single player can play through 13 turns chasing a high score.
// Scoring summary:
//   Upper (Ones..Sixes): sum of dice showing that face. Bonus +35 if upper total >= 63.
//   3-of-a-kind / 4-of-a-kind: sum of ALL dice, only if you actually have 3/4 of a kind.
//   Full house: 25 (three of one face + two of another).
//   Small straight: 30 (four consecutive faces).
//   Large straight: 40 (five consecutive faces).
//   Yahtzee: 50 (all five the same).
//   Chance: sum of all dice.
//   Yahtzee bonus: each EXTRA yahtzee rolled after scoring 50 in the Yahtzee box = +100.

export const NUM_DICE = 5;
export const ROLLS_PER_TURN = 3;
export const TOTAL_TURNS = 13;
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

export const CATEGORIES = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance',
] as const;
export type Category = typeof CATEGORIES[number];

export const UPPER: Category[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER: Category[] = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];

export const CATEGORY_LABELS: Record<Category, string> = {
  ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeKind: '3 of a Kind', fourKind: '4 of a Kind', fullHouse: 'Full House',
  smallStraight: 'Small Straight', largeStraight: 'Large Straight',
  yahtzee: 'Yahtzee', chance: 'Chance',
};

export type Scorecard = Record<Category, number | null>;

export type YPlayer = {
  playerId: string;
  username: string;
  seat: number;
  /** Player's profile accent color at join time. Optional for back-compat. */
  accent_color?: string;
  scorecard: Scorecard;
  /** Number of EXTRA yahtzees rolled after scoring 50 in the Yahtzee box; each = +100. */
  yahtzeeBonus: number;
};

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export type YState = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  phase: 'lobby' | 'playing' | 'finished';
  players: YPlayer[];
  /** Index into players[] of the active player. */
  turnIndex: number;
  /** Current dice values 1..6 (length NUM_DICE). */
  dice: number[];
  /** Which dice are "held" and won't be re-rolled. */
  held: boolean[];
  /** Number of rolls remaining this turn (3 → 2 → 1 → 0). */
  rollsLeft: number;
  /** True after the first roll of this turn — needed to score. */
  rolled: boolean;
  /** Total turns each player has taken so far. Used to detect game end. */
  turnsTaken: number;
  /** playerId of the winner — null in lobby/playing, null on tie. */
  winner: string | null;
};

// =====================================================================
// Lifecycle
// =====================================================================

export function emptyScorecard(): Scorecard {
  return {
    ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
    threeKind: null, fourKind: null, fullHouse: null,
    smallStraight: null, largeStraight: null, yahtzee: null, chance: null,
  };
}

export function initialState(): YState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    players: [],
    turnIndex: 0,
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rollsLeft: ROLLS_PER_TURN,
    rolled: false,
    turnsTaken: 0,
    winner: null,
  };
}

export function addPlayer(state: YState, playerId: string, username: string, seat: number, accent_color?: string): YState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  return {
    ...state,
    players: [...state.players, {
      playerId, username, seat, accent_color,
      scorecard: emptyScorecard(),
      yahtzeeBonus: 0,
    }].sort((a, b) => a.seat - b.seat),
  };
}

/** Host-only: remove a seated player while still in the lobby. */
export function removePlayer(state: YState, playerId: string): YState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

export function startGame(state: YState): YState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  if (state.players.length < 1) return { error: 'Need at least 1 player' };
  return {
    ...state,
    phase: 'playing',
    turnIndex: Math.floor(Math.random() * state.players.length),
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rollsLeft: ROLLS_PER_TURN,
    rolled: false,
    turnsTaken: 0,
  };
}

// =====================================================================
// Rolling
// =====================================================================

function rollOne(): number {
  return 1 + Math.floor(Math.random() * 6);
}

export function roll(state: YState, playerId: string): YState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  const me = state.players[state.turnIndex];
  if (!me || me.playerId !== playerId) return { error: 'Not your turn' };
  if (state.rollsLeft <= 0) return { error: 'No rolls left this turn — pick a category to score' };

  const dice = state.dice.map((d, i) => state.held[i] ? d : rollOne());
  return {
    ...state,
    dice,
    rollsLeft: state.rollsLeft - 1,
    rolled: true,
  };
}

export function toggleHold(state: YState, playerId: string, dieIdx: number): YState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  const me = state.players[state.turnIndex];
  if (!me || me.playerId !== playerId) return { error: 'Not your turn' };
  if (!state.rolled) return { error: 'Roll the dice first' };
  if (state.rollsLeft === 0) return { error: 'No more rolls — holding has no effect' };
  if (dieIdx < 0 || dieIdx >= NUM_DICE) return { error: 'Invalid die' };
  const held = state.held.slice();
  held[dieIdx] = !held[dieIdx];
  return { ...state, held };
}

// =====================================================================
// Scoring
// =====================================================================

function counts(dice: number[]): number[] {
  // counts[face] = how many dice show that face. counts[0] unused.
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) if (d >= 1 && d <= 6) c[d]++;
  return c;
}

function sumDice(dice: number[]): number {
  return dice.reduce((s, d) => s + d, 0);
}

function isStraightOfLength(dice: number[], len: number): boolean {
  const present = new Set(dice);
  // Look for `len` consecutive faces in 1..6.
  let run = 0;
  for (let f = 1; f <= 6; f++) {
    if (present.has(f)) {
      run++;
      if (run >= len) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/** Returns the score that `dice` would earn in `category`, ignoring scorecard state. */
export function scoreFor(dice: number[], category: Category): number {
  if (dice.some(d => d === 0)) return 0; // unrolled
  const c = counts(dice);
  switch (category) {
    case 'ones':   return c[1] * 1;
    case 'twos':   return c[2] * 2;
    case 'threes': return c[3] * 3;
    case 'fours':  return c[4] * 4;
    case 'fives':  return c[5] * 5;
    case 'sixes':  return c[6] * 6;
    case 'threeKind': return c.some(n => n >= 3) ? sumDice(dice) : 0;
    case 'fourKind':  return c.some(n => n >= 4) ? sumDice(dice) : 0;
    case 'fullHouse': {
      const has3 = c.some(n => n === 3);
      const has2 = c.some(n => n === 2);
      // 5-of-a-kind counts as full house only if we make it explicit; classic rules: no.
      return has3 && has2 ? 25 : 0;
    }
    case 'smallStraight': return isStraightOfLength(dice, 4) ? 30 : 0;
    case 'largeStraight': return isStraightOfLength(dice, 5) ? 40 : 0;
    case 'yahtzee':       return c.some(n => n === 5) ? 50 : 0;
    case 'chance':        return sumDice(dice);
  }
}

export function isYahtzee(dice: number[]): boolean {
  return counts(dice).some(n => n === 5);
}

/** Sum of upper-section entries (null counted as 0). */
export function upperTotal(card: Scorecard): number {
  return UPPER.reduce((s, k) => s + (card[k] ?? 0), 0);
}

/** Sum of lower-section entries (null counted as 0). */
export function lowerTotal(card: Scorecard): number {
  return LOWER.reduce((s, k) => s + (card[k] ?? 0), 0);
}

export function upperBonus(card: Scorecard): number {
  return upperTotal(card) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function grandTotal(player: YPlayer): number {
  return upperTotal(player.scorecard) + upperBonus(player.scorecard)
       + lowerTotal(player.scorecard)
       + player.yahtzeeBonus * YAHTZEE_BONUS;
}

export function isCardComplete(card: Scorecard): boolean {
  return CATEGORIES.every(k => card[k] !== null);
}

// =====================================================================
// Commit a score — ends the turn
// =====================================================================

export function commitScore(state: YState, playerId: string, category: Category): YState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  const meIdx = state.turnIndex;
  const me = state.players[meIdx];
  if (!me || me.playerId !== playerId) return { error: 'Not your turn' };
  if (!state.rolled) return { error: 'Roll the dice at least once first' };
  if (me.scorecard[category] !== null) return { error: `${CATEGORY_LABELS[category]} is already filled — pick another category` };

  const points = scoreFor(state.dice, category);
  let yahtzeeBonusInc = 0;
  // Yahtzee bonus: rolled a yahtzee AND already scored 50 in the yahtzee box AND scoring
  // somewhere other than yahtzee → +100.
  if (isYahtzee(state.dice) && me.scorecard.yahtzee === 50 && category !== 'yahtzee') {
    yahtzeeBonusInc = 1;
  }

  const players = state.players.map((p, i) => {
    if (i !== meIdx) return p;
    return {
      ...p,
      scorecard: { ...p.scorecard, [category]: points },
      yahtzeeBonus: p.yahtzeeBonus + yahtzeeBonusInc,
    };
  });

  // Advance turn.
  const nextIndex = (meIdx + 1) % players.length;
  const turnsTaken = state.turnsTaken + (nextIndex === 0 ? 1 : 0);
  const gameOver = players.every(p => isCardComplete(p.scorecard));

  if (gameOver) {
    const ranked = [...players].sort((a, b) => grandTotal(b) - grandTotal(a));
    const tie = ranked.length > 1 && grandTotal(ranked[0]) === grandTotal(ranked[1]);
    return {
      ...state,
      players,
      phase: 'finished',
      dice: state.dice,
      held: [false, false, false, false, false],
      rollsLeft: 0,
      rolled: false,
      turnsTaken,
      winner: tie ? null : ranked[0].playerId,
    };
  }

  return {
    ...state,
    players,
    turnIndex: nextIndex,
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rollsLeft: ROLLS_PER_TURN,
    rolled: false,
    turnsTaken,
  };
}
