// Rock-Paper-Scissors — best-of-5, 2 players, simultaneous reveal.
// Designed as a validation game for the registerGame pipeline: tiny engine
// that exercises a different pattern than our turn-based / round-based games.
//
// Flow per round:
//   1. Both players submit their choice (stored privately until both arrive).
//   2. Once both `choices` are filled, the engine reveals + scores the round,
//      appends to `history`, increments scores, and clears `choices` for the
//      next round.
//   3. First to ROUNDS_TO_WIN takes the match.

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export const BEST_OF = 5;
export const ROUNDS_TO_WIN = Math.ceil(BEST_OF / 2);  // 3

export type RPSChoice = 'rock' | 'paper' | 'scissors';
export type RPSSeat   = 'A' | 'B';

export type RPSRound = {
  A: RPSChoice;
  B: RPSChoice;
  /** Winner of this round, or 'draw' if both threw the same. */
  winner: RPSSeat | 'draw';
};

export type RPSState = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  phase: 'playing' | 'finished';
  round: number;                                  // 1-indexed
  seats: { A?: string; B?: string };
  /** Pending choice for the current round, indexed by seat. Cleared on reveal. */
  choices: { A?: RPSChoice; B?: RPSChoice };
  history: RPSRound[];
  scores: { A: number; B: number };
  /** Match winner ('A' / 'B' / 'draw') once score threshold is reached. */
  winner: RPSSeat | 'draw' | null;
};

export function initialState(): RPSState {
  return {
    version: STATE_VERSION,
    phase: 'playing',
    round: 1,
    seats: {},
    choices: {},
    history: [],
    scores: { A: 0, B: 0 },
    winner: null,
  };
}

function seatOf(state: RPSState, playerId: string): RPSSeat | null {
  if (state.seats.A === playerId) return 'A';
  if (state.seats.B === playerId) return 'B';
  return null;
}

function beats(a: RPSChoice, b: RPSChoice): boolean {
  return (
    (a === 'rock'     && b === 'scissors') ||
    (a === 'paper'    && b === 'rock')     ||
    (a === 'scissors' && b === 'paper')
  );
}

export type RPSPayload = { choice: RPSChoice };

/**
 * Submit a choice for the current round. If this completes both players'
 * choices, the round is revealed + scored + history is appended; if the
 * match-winning score is reached, phase flips to 'finished'.
 *
 * Returns either the next state or an `{error}` for the standard reasons:
 * not seated, game over, already chose this round.
 */
export function applyMove(state: RPSState, payload: RPSPayload, playerId: string): RPSState | { error: string } {
  if (state.winner) return { error: 'Match is over' };
  if (state.phase !== 'playing') return { error: 'Match not in progress' };
  const seat = seatOf(state, playerId);
  if (!seat) return { error: 'You are not seated in this match' };
  if (!state.seats.A || !state.seats.B) return { error: 'Waiting for an opponent' };
  if (!isValidChoice(payload.choice)) return { error: 'Invalid choice' };
  if (state.choices[seat]) return { error: 'You already chose this round' };

  // Record the choice. If the other seat hasn't chosen yet, return early
  // (no reveal until both arrive).
  const choices = { ...state.choices, [seat]: payload.choice };
  if (!choices.A || !choices.B) {
    return { ...state, choices };
  }

  // Both chose — resolve the round.
  const A = choices.A;
  const B = choices.B;
  const winner: RPSSeat | 'draw' = A === B ? 'draw' : beats(A, B) ? 'A' : 'B';
  const scores = {
    A: state.scores.A + (winner === 'A' ? 1 : 0),
    B: state.scores.B + (winner === 'B' ? 1 : 0),
  };
  const history = [...state.history, { A, B, winner }];

  // Did anyone hit the match-winning threshold?
  const matchWinner: RPSSeat | 'draw' | null =
    scores.A >= ROUNDS_TO_WIN ? 'A' :
    scores.B >= ROUNDS_TO_WIN ? 'B' : null;

  return {
    ...state,
    phase: matchWinner ? 'finished' : 'playing',
    round: matchWinner ? state.round : state.round + 1,
    choices: matchWinner ? choices : {}, // keep last reveal visible on the finished panel
    history,
    scores,
    winner: matchWinner,
  };
}

function isValidChoice(c: unknown): c is RPSChoice {
  return c === 'rock' || c === 'paper' || c === 'scissors';
}
