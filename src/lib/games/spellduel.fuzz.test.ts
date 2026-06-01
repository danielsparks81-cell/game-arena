import { describe, it, expect } from 'vitest';
import {
  CARDS,
  STARTING_HP,
  STARTING_HAND_SIZE,
  MAX_MANA,
  DRAFT_DECK_SIZE,
  applyMove,
  createInitialStateForHost,
  seatJoinerAndStart,
  type SDState,
  type SDAction,
  type Seat,
  type CardId,
  type ResolvedTarget,
} from './spellduel';

// =====================================================================
// Headless full-game fuzzer for Spellduel — same discipline as Legendary
// and Long Shot. Each game:
//   1. Builds a duel through the public API (host → join → DRAFT).
//   2. Drafts both decks with random-legal picks.
//   3. Plays to completion with random-legal moves, honouring the engine's
//      turn machine: the active seat plays/ends; during a reaction window the
//      reactor plays a reaction or passes.
//
// Invariants checked every step:
//   • HP never exceeds STARTING_HP (heals cap; can drop ≤0 only at the end)
//   • mana ≥ 0 and maxMana ≤ MAX_MANA
//   • total card tokens across BOTH players' zones is conserved at 2×35 = 70
//     (cards only ever MOVE between deck/hand/discard/opponent — never created
//     or destroyed) — pins down steal / discard / draw / reshuffle bugs
//   • no winner is set while phase === 'playing'
//   • the active player (or reactor) always has a legal move — no stuck states
//   • a reaction window's reactor is always the caster's opponent
//   • every game terminates within a sane step budget
//
// Math.random is seeded per game so any failure is a stable CI regression.
// =====================================================================

const TOTAL_CARDS = DRAFT_DECK_SIZE * 2; // 70
const MAX_STEPS = 12000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(arr: readonly T[], rng: () => number): T { return arr[Math.floor(rng() * arr.length)]; }

function zoneTotal(s: SDState): number {
  let n = 0;
  for (const seat of ['A', 'B'] as Seat[]) {
    const p = s.players[seat];
    n += p.deck.length + p.hand.length + p.discard.length;
  }
  return n;
}

function assertInvariants(s: SDState, ctx: string): void {
  for (const seat of ['A', 'B'] as Seat[]) {
    const p = s.players[seat];
    expect(p.hp, `${ctx}: ${seat} hp ≤ STARTING_HP`).toBeLessThanOrEqual(STARTING_HP);
    expect(p.mana, `${ctx}: ${seat} mana ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(p.maxMana, `${ctx}: ${seat} maxMana ≤ MAX_MANA`).toBeLessThanOrEqual(MAX_MANA);
  }
  // Card conservation only holds once the decks are built (playing/finished).
  if (s.phase === 'playing' || s.phase === 'finished') {
    expect(zoneTotal(s), `${ctx}: card tokens conserved`).toBe(TOTAL_CARDS);
  }
  if (s.phase === 'playing') {
    expect(s.winner, `${ctx}: no winner mid-game`).toBeFalsy();
    if (s.pendingReaction) {
      const { casterSeat, reactorSeat } = s.pendingReaction;
      expect(reactorSeat, `${ctx}: reactor is caster's opponent`).toBe(casterSeat === 'A' ? 'B' : 'A');
    }
  }
}

/** The legal draft pick for whichever seat still needs to act. */
function draftMove(s: SDState): { seat: Seat; action: SDAction } | null {
  const d = s.draft;
  if (!d) return null;
  const seat: Seat | null = !d.A.done ? 'A' : !d.B.done ? 'B' : null;
  if (!seat) return null;
  const ds = d[seat];
  const rarity = ds.need.common > 0 ? 'common' : ds.need.uncommon > 0 ? 'uncommon' : 'rare';
  const offer = ds.offer[rarity];
  if (offer.length === 0) return null;
  return { seat, action: { kind: 'draft_pick', cardId: offer[0] } };
}

/** Build a random ResolvedTarget[] for a card that requires targets. */
function randomTargets(cardId: CardId, rng: () => number): ResolvedTarget[] {
  const specs = CARDS[cardId].targets ?? [];
  return specs.map<ResolvedTarget>(() => ({ kind: 'player', seat: rng() < 0.5 ? 'A' : 'B' }));
}

/** All legal moves for the active seat right now (play any affordable
 *  non-reaction card respecting silence, or end the turn). */
function activeMoves(s: SDState, rng: () => number): SDAction[] {
  const seat = s.currentSeat;
  const me = s.players[seat];
  const moves: SDAction[] = [];
  const effMana = me.mana + me.manaBonusThisTurn;
  me.hand.forEach((cardId, idx) => {
    const c = CARDS[cardId];
    if (!c || c.isReaction) return;
    if (c.cost > effMana) return;
    const dealsDamage = c.effects.some(e => e.kind === 'damage' || e.kind === 'burn')
      || c.dynamic === 'combo' || c.dynamic === 'last_gasp';
    if (dealsDamage && me.silencedDamage) return;
    if (!dealsDamage && me.silencedUtility) return;
    moves.push({ kind: 'play', cardIdx: idx, targets: randomTargets(cardId, rng) });
  });
  moves.push({ kind: 'end_turn' }); // always legal
  return moves;
}

/** Legal reaction responses for the reactor: play any eligible reaction or pass. */
function reactionMoves(s: SDState): SDAction[] {
  const pr = s.pendingReaction!;
  const reactor = s.players[pr.reactorSeat];
  const effMana = reactor.mana + reactor.manaBonusThisTurn;
  const pendingCard = CARDS[pr.cardId];
  const pendingDealsDamage = pendingCard.effects.some(e => e.kind === 'damage' || e.kind === 'burn')
    || pendingCard.dynamic === 'combo' || pendingCard.dynamic === 'last_gasp';
  const moves: SDAction[] = [{ kind: 'pass_reaction' }];
  reactor.hand.forEach((cardId, idx) => {
    const c = CARDS[cardId];
    if (!c?.isReaction || c.cost > effMana) return;
    if (c.reactionType === 'reflect' && !pendingDealsDamage) return;
    moves.push({ kind: 'play_reaction', cardIdx: idx });
  });
  return moves;
}

function playToCompletion(seed: number): { steps: number; turns: number; phase: string } {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try {
    return runGame(seed);
  } finally {
    Math.random = orig;
  }
}

function runGame(seed: number): { steps: number; turns: number; phase: string } {
  const rng = mulberry32(seed ^ 0x9e3779b9);

  let state = seatJoinerAndStart(
    createInitialStateForHost({ userId: 'A', username: 'Alice' }),
    { userId: 'B', username: 'Bob' },
  );

  let steps = 0;
  const ctx = () => `seed${seed} step${steps} phase=${state.phase} turn=${state.turn}`;

  for (; steps < MAX_STEPS; steps++) {
    assertInvariants(state, ctx());
    if (state.phase === 'finished') break;

    // ── Draft phase ────────────────────────────────────────────────────
    if (state.phase === 'drafting') {
      const mv = draftMove(state);
      if (!mv) throw new Error(`${ctx()}: no draft move available`);
      const next = applyMove(state, mv.action, mv.seat);
      if ('error' in next) throw new Error(`${ctx()}: draft pick error: ${next.error}`);
      state = next;
      continue;
    }

    // ── Reaction window ────────────────────────────────────────────────
    if (state.pendingReaction) {
      const reactorId = state.seats[state.pendingReaction.reactorSeat]!;
      const moves = reactionMoves(state);
      const action = pick(moves, rng);
      const next = applyMove(state, action, reactorId);
      if ('error' in next) throw new Error(`${ctx()}: reaction error: ${next.error} (action=${action.kind})`);
      state = next;
      continue;
    }

    // ── Normal turn ────────────────────────────────────────────────────
    const actorId = state.seats[state.currentSeat]!;
    const moves = activeMoves(state, rng);
    let acted = false;
    // Try moves in random order until one is accepted (targets may be invalid
    // for a given pick; end_turn is the guaranteed fallback at the end).
    for (const action of [...moves].sort(() => rng() - 0.5)) {
      const next = applyMove(state, action, actorId);
      if (!('error' in next)) { state = next; acted = true; break; }
    }
    if (!acted) throw new Error(`${ctx()}: no legal move for ${state.currentSeat}`);
  }

  expect(state.phase, `${ctx()}: game terminates`).toBe('finished');
  // Exactly one side is dead (or a simultaneous-KO draw with a recorded winner).
  expect(state.winner, `${ctx()}: winner recorded`).toBeTruthy();
  const dead = state.players.A.hp <= 0 || state.players.B.hp <= 0;
  expect(dead, `${ctx()}: a player reached 0 HP`).toBe(true);
  return { steps, turns: state.turn, phase: state.phase };
}

describe('spellduel: full-game fuzzer', () => {
  const seeds = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010];
  for (const seed of seeds) {
    it(`random duel (seed ${seed}) drafts, plays, and finishes cleanly`, () => {
      const out = playToCompletion(seed);
      expect(out.steps).toBeLessThan(MAX_STEPS);
      expect(out.phase).toBe('finished');
    });
  }
});

describe('spellduel: fuzzer — many quick seeds', () => {
  for (let i = 0; i < 12; i++) {
    it(`extra duel #${i + 1} finishes`, () => {
      const out = playToCompletion(40000 + i * 7);
      expect(out.steps).toBeLessThan(MAX_STEPS);
    });
  }
});

void STARTING_HAND_SIZE;
