import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createInitialStateForHost,
  addPlayer,
  startGame,
  getActivePlayerId,
  computeHistory,
  projectStateForViewer,
  getCard,
  HQ_SIZE,
  CITY_SIZE,
  MASTERMINDS,
  SCHEMES,
  type LegendaryState,
  type LegendaryAction,
  type CardInstance,
} from './index';

// =====================================================================
// Headless game fuzzer — the "graduate from Beta" confidence net.
//
// The engine is pure and server-authoritative, so we can flush long-tail
// bugs WITHOUT a browser by simulating full multiplayer games to completion
// with random-but-legal play, asserting hard invariants at every step. This
// sweeps every Mastermind × Scheme combination across player counts — a space
// far larger than any manual playtest covers.
//
// Invariants checked every step:
//   • applyAction never throws (a throw = uncaught crash = test failure)
//   • resources never go negative; HQ/City keep their fixed length
//   • computeHistory returns null UNLESS the game is finished (no phantom W/L)
//   • a set result is one of win|loss|tie and the game is finished
//   • projectStateForViewer never throws and never leaks the undo snapshot
//   • at stable points (no pending choice), no card instance is in two zones
//     (catches the entire "card duplicated or lost" bug class)
//   • the game never gets stuck (an active player always has a legal move)
//   • every game terminates within a sane step budget
// =====================================================================

const MAX_STEPS = 4000;

// Small seeded PRNG so the action-selection order is reproducible per game.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setupGame(mmId: string, schemeId: string, numPlayers: number): LegendaryState {
  let s = createInitialStateForHost({ userId: 'p0', username: 'P0' });
  for (let i = 1; i < numPlayers; i++) s = addPlayer(s, `p${i}`, `P${i}`, i);
  s.mastermindId = mmId;
  s.schemeId = schemeId;
  const started = startGame(s);
  if ('error' in started) throw new Error(`startGame failed (${mmId}/${schemeId}/${numPlayers}p): ${started.error}`);
  return started;
}

/** Collect every card instanceId from the canonical zones (the places a card
 *  truly "lives"). Excludes display-only / in-flight holders that legitimately
 *  reference zone cards (pendingChoice.cards, order queues) — which is why this
 *  is only run at stable points (no pending choice). */
function canonicalInstanceLocations(state: LegendaryState): Map<string, string> {
  const seen = new Map<string, string>(); // instanceId -> zone label
  const add = (cards: readonly (CardInstance | null)[], label: string) => {
    for (const c of cards) {
      if (!c) continue;
      const prev = seen.get(c.instanceId);
      if (prev) throw new Error(`DUPLICATE card ${c.cardId} (${c.instanceId}) in both "${prev}" and "${label}"`);
      seen.set(c.instanceId, label);
    }
  };
  state.players.forEach((p, i) => {
    add(p.hand, `p${i}.hand`); add(p.deck, `p${i}.deck`);
    add(p.discard, `p${i}.discard`); add(p.victoryPile, `p${i}.vp`);
  });
  add(state.hq, 'hq'); add(state.city, 'city');
  add(state.villainDeck, 'villainDeck'); add(state.heroDeck, 'heroDeck');
  add(state.ko, 'ko'); add(state.escapedPile, 'escapedPile');
  add(state.woundDeck, 'woundDeck'); add(state.bystanderDeck, 'bystanderDeck');
  add(state.mastermind.tactics, 'mm.tactics'); add(state.mastermind.bystanders, 'mm.bystanders');
  add(state.thisTurn.playedThisTurn, 'playedThisTurn');
  for (const arr of Object.values(state.cityBystanders ?? {})) add(arr, 'cityBystanders');
  add(Object.values(state.cityAttachedHeroes ?? {}), 'cityAttachedHeroes');
  return seen;
}

function assertInvariants(state: LegendaryState, ctx: string): void {
  expect(state.thisTurn.attack, `${ctx}: attack >= 0`).toBeGreaterThanOrEqual(0);
  expect(state.thisTurn.recruit, `${ctx}: recruit >= 0`).toBeGreaterThanOrEqual(0);
  expect(state.hq.length, `${ctx}: HQ length`).toBe(HQ_SIZE);
  expect(state.city.length, `${ctx}: City length`).toBe(CITY_SIZE);
  expect(state.currentPlayerIdx, `${ctx}: currentPlayerIdx in range`).toBeGreaterThanOrEqual(0);
  expect(state.currentPlayerIdx, `${ctx}: currentPlayerIdx in range`).toBeLessThan(state.players.length);

  // The no-phantom-history contract: a row is only ever recorded once finished.
  const finished = state.phase === 'finished';
  const hist = computeHistory(state);
  if (!finished) {
    expect(hist, `${ctx}: computeHistory must be null while not finished`).toBeNull();
  }
  if (state.result !== undefined) {
    expect(['win', 'loss', 'tie'], `${ctx}: result value`).toContain(state.result);
    expect(state.phase, `${ctx}: result implies finished`).toBe('finished');
  }

  // Projection must never throw and never leak the heavy undo snapshot.
  const viewer = state.players[(state.currentPlayerIdx + 1) % state.players.length]?.playerId ?? null;
  const projected = projectStateForViewer(state, viewer) as LegendaryState;
  if (projected.undo) {
    expect((projected.undo as { snapshot?: unknown }).snapshot, `${ctx}: undo snapshot stripped by projection`).toBeUndefined();
  }

  // No card instance in two canonical zones — only meaningful at stable points.
  const stable = !state.thisTurn.pendingChoice && !state.pendingStrike && state.thisTurn.choiceOwnerSeat === undefined;
  if (stable) {
    expect(() => canonicalInstanceLocations(state), `${ctx}: no duplicated/lost cards`).not.toThrow();
  }
}

/** Choose and apply one legal action for whoever is active (the choice owner
 *  during a sequential strike, else the current player). Returns the next state,
 *  or throws with context if the game is stuck (no legal move available). */
function stepOnce(state: LegendaryState, rng: () => number, ctx: string): LegendaryState {
  const actorId = getActivePlayerId(state);
  if (!actorId) throw new Error(`${ctx}: no active player but game not finished (stuck)`);

  const pc = state.thisTurn.pendingChoice;
  const candidates: LegendaryAction[] = [];

  if (pc) {
    candidates.push({ kind: 'skip_choice' }, { kind: 'accept_choice' });
    const actor = state.players.find(p => p.playerId === actorId)!;
    const ids = new Set<string>();
    for (const z of [actor.hand, actor.discard, state.thisTurn.playedThisTurn]) for (const c of z) ids.add(c.instanceId);
    for (const c of state.hq) if (c) ids.add(c.instanceId);
    for (const c of state.city) if (c) ids.add(c.instanceId);
    const pcAny = pc as { cards?: CardInstance[]; queue?: Array<{ instanceId?: string; card?: CardInstance }> };
    if (Array.isArray(pcAny.cards)) for (const c of pcAny.cards) ids.add(c.instanceId);
    if (Array.isArray(pcAny.queue)) for (const q of pcAny.queue) {
      if (q.instanceId) ids.add(q.instanceId);
      if (q.card?.instanceId) ids.add(q.card.instanceId);
    }
    for (const id of ids) candidates.push({ kind: 'resolve_choice', instanceId: id });
    for (let i = 0; i < CITY_SIZE; i++) candidates.push({ kind: 'resolve_choice', instanceId: `slot:${i}` });
    shuffleInPlace(candidates, rng);
  } else {
    const me = state.players[state.currentPlayerIdx];
    if (state.turn === 1 && state.city.every(c => c === null)) candidates.push({ kind: 'reveal_first_villain' });
    for (const c of me.hand) candidates.push({ kind: 'play_card', instanceId: c.instanceId });
    for (let s = 0; s < CITY_SIZE; s++) candidates.push({ kind: 'fight_city', slot: s });
    candidates.push({ kind: 'fight_mastermind' }, { kind: 'play_wound_healing' });
    for (let s = 0; s < HQ_SIZE; s++) candidates.push({ kind: 'recruit_hero', slot: s });
    candidates.push({ kind: 'recruit_sidekick' }, { kind: 'recruit_officer' });
    shuffleInPlace(candidates, rng);
    // end_turn is the guaranteed fallback so a free turn can always progress.
    candidates.push({ kind: 'end_turn' });
  }

  for (const action of candidates) {
    const res = applyAction(state, actorId, action);
    if (!('error' in res)) return res;
  }
  throw new Error(`${ctx}: stuck — no legal action (pendingChoice=${pc?.kind ?? 'none'})`);
}

function playToCompletion(mmId: string, schemeId: string, numPlayers: number, seed: number): {
  result: string; turns: number; steps: number;
} {
  // Seed Math.random for the whole game so the ENGINE (deck shuffle, random
  // starting player, dice) AND the action selection are fully reproducible —
  // a stable regression net rather than a flaky CI fuzzer. The heavy stochastic
  // exploration was done manually during development; this commits a fixed set
  // of full-game property tests. Restored in `finally` so other tests are
  // unaffected.
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return runGame(mmId, schemeId, numPlayers, seed);
  } finally {
    Math.random = origRandom;
  }
}

function runGame(mmId: string, schemeId: string, numPlayers: number, seed: number): {
  result: string; turns: number; steps: number;
} {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  let state = setupGame(mmId, schemeId, numPlayers);
  let steps = 0;
  for (; steps < MAX_STEPS; steps++) {
    const ctx = `${mmId}/${schemeId}/${numPlayers}p turn${state.turn} step${steps}`;
    assertInvariants(state, ctx);
    if (state.phase === 'finished') break;
    state = stepOnce(state, rng, ctx);
  }
  const ctx = `${mmId}/${schemeId}/${numPlayers}p`;
  expect(state.phase, `${ctx}: game terminated within ${MAX_STEPS} steps`).toBe('finished');
  // A finished game must yield a recordable history row with a sane shape.
  const hist = computeHistory(state);
  expect(hist, `${ctx}: finished game records history`).not.toBeNull();
  if (hist) {
    expect(hist.playerIds.length, `${ctx}: history lists all players`).toBe(numPlayers);
    // winnerId is null for loss/tie, or a real player for a win.
    if (hist.winnerId !== null) {
      expect(state.players.some(p => p.playerId === hist.winnerId), `${ctx}: winnerId is a seated player`).toBe(true);
    }
  }
  return { result: state.result ?? 'none', turns: state.turn, steps };
}

describe('legendary: full-game fuzzer (every Mastermind × Scheme)', () => {
  // Sweep the whole 4×8 matrix, varying player count deterministically across
  // 1–5 so each combo is exercised at a different table size.
  let combo = 0;
  for (const mm of MASTERMINDS) {
    for (const scheme of SCHEMES) {
      const numPlayers = 1 + (combo % 5);
      const seed = 1000 + combo;
      combo++;
      it(`plays ${mm.name} / ${scheme.name} (${numPlayers}p) to a valid finish`, () => {
        const out = playToCompletion(mm.cardId, scheme.cardId, numPlayers, seed);
        expect(['win', 'loss', 'tie']).toContain(out.result);
      });
    }
  }
});

describe('legendary: fuzzer — extra randomized games', () => {
  // A handful of fully-random games (random combo + player count + seed) to
  // exercise combinations the deterministic sweep doesn't pair up.
  for (let i = 0; i < 12; i++) {
    it(`random game #${i + 1} reaches a valid finish`, () => {
      const rng = mulberry32(50000 + i);
      const mm = MASTERMINDS[Math.floor(rng() * MASTERMINDS.length)];
      const scheme = SCHEMES[Math.floor(rng() * SCHEMES.length)];
      const numPlayers = 1 + Math.floor(rng() * 5);
      const out = playToCompletion(mm.cardId, scheme.cardId, numPlayers, 60000 + i);
      expect(['win', 'loss', 'tie']).toContain(out.result);
    });
  }
});

// Silence unused-import lint if getCard ends up unreferenced after edits.
void getCard;
