// Long Shot: a horse-racing dice game.
// This module is intentionally minimal in this commit (Phase 0). The full race
// loop, actions, scoring, and horse abilities ship in later phases.

export const NUM_HORSES = 8;
export const TRACK_LENGTH = 14;     // spaces around the track (rough placeholder; tune later)
export const NO_BET_SPACE = 10;     // past this index, no new bets without a helmet
export const STARTING_MONEY = 12;
export const FINISH_POSITIONS = 3;  // race ends after 3 horses finish

export type HorseFinish = 1 | 2 | 3 | null;

export type LSHorse = {
  position: number;          // 0 = behind start/finish line; reaches TRACK_LENGTH to finish
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
  currentTurnSeat: number | null;    // who is currently choosing an action
  step: 'roll' | 'action' | 'between-rounds' | 'done';
  horseDie: number | null;           // 1-8 (last roll)
  movementDie: number | null;        // 1-6
  horses: LSHorse[];                 // length 8
  finishedCount: number;             // how many horses have crossed the line
  market: number[];                  // horse numbers still purchasable
  players: LSPlayer[];               // seated players, sorted by seat
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
  };
}

/** Add a player to the lobby phase. Returns updated state or error. */
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

/** Host flips the room from lobby to playing. */
export function startRace(state: LSState): LSState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Race already started' };
  if (state.players.length < 1) return { error: 'Need at least 1 player' };
  return {
    ...state,
    phase: 'playing',
    round: 1,
    activePlayerSeat: state.players[0].seat,
    currentTurnSeat: null,
    step: 'roll',
  };
}
