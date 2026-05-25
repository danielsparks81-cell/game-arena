// Liar's Dice — bluffing dice game, 2–8 players, last player with dice wins.
// Each player rolls 5 dice in secret. Going clockwise, players raise the bid
// (quantity + face across ALL dice on the table) or call "liar". On a call we
// reveal all hands and count: if the bid holds, the challenger loses a die,
// otherwise the bidder loses one. Wild 1s count as any face unless the bid is
// on 1s themselves. Hidden-info note: like Battleship, the server stores every
// player's dice in the shared state; clients are expected to render only their
// own dice face-up. Casual trust-based privacy.

export const STARTING_DICE = 5;
export const DICE_FACES = 6;

export type LDPlayer = {
  playerId: string;
  username: string;
  seat: number;
  /** Player's profile accent color (hex string) at the time they joined.
      Optional so older games / unknown joiners don't break — boards fall
      back to the default via safeAccent(). */
  accent_color?: string;
  /** Current hand sorted ascending. Empty array = eliminated. */
  dice: number[];
};

export type LDBid = {
  /** playerId of the seat that made the bid. */
  by: string;
  /** Claimed count of `face` (including wild 1s) across all dice on the table. */
  quantity: number;
  /** Face value 1..6. */
  face: number;
};

export type LDReveal = {
  bid: LDBid;
  challenger: string;
  /** Snapshot of every player's hand at reveal time. */
  hands: { playerId: string; username: string; seat: number; accent_color?: string; dice: number[] }[];
  /** How many `face` (with wild 1s, unless face===1) were actually showing. */
  actualCount: number;
  /** True = bid stood, challenger loses a die. False = bid busted, bidder loses. */
  bidStood: boolean;
  /** playerId who lost a die. */
  loser: string;
  /** True if the loser was eliminated this round. */
  eliminated: boolean;
};

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 1;

export type LDState = {
  /** Engine state version — see STATE_VERSION + registry.migrateState. */
  version?: number;
  phase: 'lobby' | 'playing' | 'between-rounds' | 'finished';
  /** 1-indexed round counter. 0 in lobby. */
  round: number;
  /** Whose turn it is to act. Index into `players` (regardless of alive). */
  turnIndex: number;
  /** Currently open bid, or null if the round just started. */
  bid: LDBid | null;
  players: LDPlayer[];
  /** Result of the last challenge, set while in `between-rounds`. */
  lastReveal: LDReveal | null;
  /** Winner's playerId, set when phase === 'finished'. */
  winner: string | null;
};

// =====================================================================
// Lifecycle
// =====================================================================

export function initialState(): LDState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    round: 0,
    turnIndex: 0,
    bid: null,
    players: [],
    lastReveal: null,
    winner: null,
  };
}

export function addPlayer(state: LDState, playerId: string, username: string, seat: number, accent_color?: string): LDState {
  if (state.phase !== 'lobby') return state;
  if (state.players.some(p => p.playerId === playerId)) return state;
  return {
    ...state,
    players: [...state.players, { playerId, username, seat, accent_color, dice: [] }].sort((a, b) => a.seat - b.seat),
  };
}

/** Host-only: remove a seated player while still in the lobby. No-op once
    the game is in progress (use the resign/abandon flow instead). */
export function removePlayer(state: LDState, playerId: string): LDState {
  if (state.phase !== 'lobby') return state;
  return { ...state, players: state.players.filter(p => p.playerId !== playerId) };
}

function rollHand(n: number): number[] {
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(1 + Math.floor(Math.random() * DICE_FACES));
  return dice.sort((a, b) => a - b);
}

export function startGame(state: LDState): LDState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  if (state.players.length < 2) return { error: 'Need at least 2 players' };
  // Rotate players so the randomly-chosen first player is at index 0,
  // keeping state.players in true turn order so MembersPanel matches gameplay.
  const startIdx = Math.floor(Math.random() * state.players.length);
  const players = [
    ...state.players.slice(startIdx),
    ...state.players.slice(0, startIdx),
  ].map(p => ({ ...p, dice: rollHand(STARTING_DICE) }));
  return {
    ...state,
    phase: 'playing',
    round: 1,
    turnIndex: 0,
    bid: null,
    players,
    lastReveal: null,
    winner: null,
  };
}

// =====================================================================
// Bidding & turn rotation
// =====================================================================

function isAlive(p: LDPlayer): boolean {
  return p.dice.length > 0;
}

function totalDiceOnTable(state: LDState): number {
  return state.players.reduce((sum, p) => sum + p.dice.length, 0);
}

/** Find the next alive player after `from`, wrapping. Returns -1 if none. */
function nextAliveIndex(players: LDPlayer[], from: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (isAlive(players[idx])) return idx;
  }
  return -1;
}

/** Is `next` a strictly higher bid than `prev`? */
export function isBidHigher(prev: LDBid | null, next: { quantity: number; face: number }): boolean {
  if (next.quantity < 1 || next.face < 1 || next.face > DICE_FACES) return false;
  if (!prev) return true;
  if (next.quantity > prev.quantity) return true;
  if (next.quantity === prev.quantity && next.face > prev.face) return true;
  return false;
}

export function placeBid(
  state: LDState,
  playerId: string,
  quantity: number,
  face: number,
): LDState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Round not in progress' };
  const me = state.players[state.turnIndex];
  if (!me || me.playerId !== playerId) return { error: 'Not your turn' };
  if (!Number.isInteger(quantity) || !Number.isInteger(face)) return { error: 'Invalid bid' };
  if (face < 1 || face > DICE_FACES) return { error: 'Face must be 1–6' };
  if (quantity < 1) return { error: 'Quantity must be at least 1' };
  if (quantity > totalDiceOnTable(state)) return { error: 'Quantity exceeds total dice on the table' };
  if (!isBidHigher(state.bid, { quantity, face })) {
    return { error: 'Bid must be strictly higher (more dice, or same count with a higher face)' };
  }
  return {
    ...state,
    bid: { by: playerId, quantity, face },
    turnIndex: nextAliveIndex(state.players, state.turnIndex),
  };
}

// =====================================================================
// Challenge / reveal
// =====================================================================

/** Count `face` across all dice, with wild 1s — except when `face === 1`. */
export function countFace(players: LDPlayer[], face: number): number {
  let n = 0;
  const wild = face !== 1;
  for (const p of players) {
    for (const d of p.dice) {
      if (d === face || (wild && d === 1)) n++;
    }
  }
  return n;
}

export function callLiar(state: LDState, playerId: string): LDState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Round not in progress' };
  if (!state.bid) return { error: "Can't call liar on the opening turn — make a bid" };
  const me = state.players[state.turnIndex];
  if (!me || me.playerId !== playerId) return { error: 'Not your turn' };

  const actualCount = countFace(state.players, state.bid.face);
  const bidStood = actualCount >= state.bid.quantity;
  const loserId = bidStood ? me.playerId : state.bid.by;

  const players = state.players.map(p => {
    if (p.playerId !== loserId) return p;
    return { ...p, dice: p.dice.slice(0, Math.max(0, p.dice.length - 1)) };
  });
  const loser = players.find(p => p.playerId === loserId)!;
  const eliminated = loser.dice.length === 0;

  const reveal: LDReveal = {
    bid: state.bid,
    challenger: me.playerId,
    hands: state.players.map(p => ({
      playerId: p.playerId,
      username: p.username,
      seat: p.seat,
      accent_color: p.accent_color,
      dice: p.dice.slice(),
    })),
    actualCount,
    bidStood,
    loser: loserId,
    eliminated,
  };

  const alive = players.filter(isAlive);
  if (alive.length <= 1) {
    return {
      ...state,
      phase: 'finished',
      players,
      lastReveal: reveal,
      bid: null,
      winner: alive[0]?.playerId ?? null,
    };
  }

  return {
    ...state,
    phase: 'between-rounds',
    players,
    lastReveal: reveal,
    bid: null,
  };
}

// =====================================================================
// Between-rounds → next round
// =====================================================================

/** Start the next round: reroll surviving hands, starting player = round loser (if alive) else next alive. */
export function startNextRound(state: LDState): LDState | { error: string } {
  if (state.phase !== 'between-rounds') return { error: 'Not between rounds' };
  const reveal = state.lastReveal;
  if (!reveal) return { error: 'Missing reveal' };

  // Reroll every alive player's hand.
  const players = state.players.map(p => isAlive(p) ? { ...p, dice: rollHand(p.dice.length) } : p);

  // Determine who acts first this round.
  const loserIdx = players.findIndex(p => p.playerId === reveal.loser);
  let firstIdx: number;
  if (loserIdx >= 0 && isAlive(players[loserIdx])) {
    firstIdx = loserIdx;
  } else {
    // Loser was eliminated — next alive after their seat.
    firstIdx = nextAliveIndex(players, loserIdx >= 0 ? loserIdx : 0);
    if (firstIdx < 0) return { error: 'No players left' };
  }

  return {
    ...state,
    phase: 'playing',
    round: state.round + 1,
    turnIndex: firstIdx,
    bid: null,
    players,
    lastReveal: null,
  };
}

// =====================================================================
// View helpers
// =====================================================================

/** Hide other players' dice values for client rendering — returns dice as [-1,-1,…] for non-self. */
export function maskedView(state: LDState, viewerId: string | null): LDState {
  // During between-rounds and finished, hands are public (revealed).
  if (state.phase === 'between-rounds' || state.phase === 'finished') return state;
  return {
    ...state,
    players: state.players.map(p =>
      p.playerId === viewerId ? p : { ...p, dice: p.dice.map(() => -1) },
    ),
  };
}
