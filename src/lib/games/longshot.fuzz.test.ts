import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  startRace,
  rollDice,
  takeAction,
  CONCESSION_BONUSES,
  NUM_HORSES,
  TRACK_LENGTH,
  CONCESSION_CELLS,
  MOVEMENT_DIE_FACES,
  STARTING_MONEY,
  type LSState,
  type LSPlayer,
  type ActionPayload,
  type PendingChoiceResolution,
} from './longshot';

const BONUS_IDS = CONCESSION_BONUSES.map(b => b.id);

// =====================================================================
// Headless game fuzzer for Long Shot — same discipline as Legendary.
//
// Long Shot's intra-turn machine: roll → action (all players in seat order,
// each acts once) → next round. The fuzzer honours this protocol exactly.
//
// Invariants checked every step:
//   • no player money goes negative
//   • horses stay within [0, TRACK_LENGTH]
//   • concessionMarks arrays stay at the right length
//   • wildsUsed never exceeds MAX_WILDS
//   • no winner field mid-game
//   • every game terminates within a sane step budget
//   • all players have non-negative final money
// =====================================================================

const MAX_WILDS = 3;
const MAX_STEPS = 3000;

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
function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function assertInvariants(state: LSState, ctx: string): void {
  for (const p of state.players) {
    expect(p.money, `${ctx}: ${p.username} money >= 0`).toBeGreaterThanOrEqual(0);
    expect(p.wildsUsed, `${ctx}: ${p.username} wildsUsed <= MAX`).toBeLessThanOrEqual(MAX_WILDS);
    expect(p.concessionMarks.length, `${ctx}: concessionMarks length`).toBe(CONCESSION_CELLS);
  }
  for (const h of state.horses) {
    expect(h.position, `${ctx}: horse position`).toBeGreaterThanOrEqual(0);
    expect(h.position, `${ctx}: horse position`).toBeLessThanOrEqual(TRACK_LENGTH);
  }
  if (state.phase === 'playing') {
    expect((state as { winner?: unknown }).winner, `${ctx}: no winner mid-game`).toBeFalsy();
  }
}

function resolveChoice(pc: NonNullable<LSState['pendingChoice']>, rng: () => number): PendingChoiceResolution {
  const h = () => Math.floor(rng() * NUM_HORSES) + 1;
  switch (pc.kind) {
    case 'half_off_sale':    return rng() < 0.5 ? { kind: 'half_off_sale', horseNum: null } : { kind: 'half_off_sale', horseNum: h() };
    case 'partner_in_crime': return rng() < 0.5 ? { kind: 'partner_in_crime', horseNum: null } : { kind: 'partner_in_crime', horseNum: h() };
    case 'charley_horse':    return rng() < 0.5 ? { kind: 'charley_horse', horseNum: null } : { kind: 'charley_horse', horseNum: h() };
    case 'fair_play':        return rng() < 0.5 ? { kind: 'fair_play', horseNum: null } : { kind: 'fair_play', horseNum: h() };
    case 'inventory_check':  return rng() < 0.5 ? { kind: 'inventory_check', horseNum: null } : { kind: 'inventory_check', horseNum: h() };
    case 'chain_reaction':   return rng() < 0.5 ? { kind: 'chain_reaction', cellIdx: null } : { kind: 'chain_reaction', cellIdx: Math.floor(rng() * CONCESSION_CELLS) };
    case 'double_crosser':   return rng() < 0.5 ? { kind: 'double_crosser', horseNum: null } : { kind: 'double_crosser', horseNum: h() };
    case 'miracle_worker': {
      const opts = ['concession', 'helmet', 'jersey'] as const;
      const opt = pick(opts, rng);
      if (opt === 'concession') return { kind: 'miracle_worker', option: 'concession', cellIdx: Math.floor(rng() * CONCESSION_CELLS) };
      if (opt === 'helmet')     return { kind: 'miracle_worker', option: 'helmet', horseNum: h() };
      return { kind: 'miracle_worker', option: 'jersey', horseNum: h(), markHorse: h() };
    }
  }
}

function candidateActions(state: LSState, player: LSPlayer, rng: () => number): ActionPayload[] {
  const cands: ActionPayload[] = [];
  const h = () => Math.floor(rng() * NUM_HORSES) + 1;
  const money = player.money;

  // Core actions (engine validates all)
  if (money >= 1) cands.push({ type: 'bet', amount: 1 });
  if (money >= 2) cands.push({ type: 'bet', amount: 2 });
  if (money >= 3) cands.push({ type: 'bet', amount: 3 });
  cands.push({ type: 'buy' });
  cands.push({ type: 'helmet' });
  for (let i = 0; i < NUM_HORSES; i++) cands.push({ type: 'jersey', markHorse: i + 1 });
  for (let i = 0; i < CONCESSION_CELLS; i++) cands.push({ type: 'concession', cellIdx: i });
  cands.push({ type: 'refresh_wild' });

  // Wild variants
  if (player.wildsUsed < MAX_WILDS) {
    const w = h();
    cands.push({ type: 'buy', wild: w });
    cands.push({ type: 'helmet', wild: w });
    cands.push({ type: 'jersey', markHorse: h(), wild: w });
    cands.push({ type: 'concession', cellIdx: Math.floor(rng() * CONCESSION_CELLS), wild: w });
    if (money >= 1) cands.push({ type: 'bet', amount: 1, wild: w });
  }

  // Bonus claims — try every real bonus id with relevant horse/horse2 combos.
  for (const bonusId of BONUS_IDS) {
    cands.push({ type: 'claim_bonus', bonusId, horse: h() });
    cands.push({ type: 'claim_bonus', bonusId, horse: h(), horse2: h() }); // forward2x2/back2x2
    cands.push({ type: 'claim_bonus', bonusId, markHorse: h() }); // jersey_any
    cands.push({ type: 'claim_bonus', bonusId });
  }

  // refresh_wild is always the last-resort fallback: it now works even when
  // wildsUsed===0, acting as a "pass" for a player with no other legal action.
  cands.push({ type: 'refresh_wild' });

  return shuffled(cands, rng);
}

function playToCompletion(numPlayers: number, seed: number): { steps: number; rounds: number } {
  const origRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return runGame(numPlayers, seed);
  } finally {
    Math.random = origRandom;
  }
}

function runGame(numPlayers: number, seed: number): { steps: number; rounds: number } {
  const rng = mulberry32(seed ^ 0x9e3779b9);

  let state = initialState();
  for (let i = 0; i < numPlayers; i++) {
    state = addPlayer(state, `p${i}`, `P${i}`, i);
  }
  const started = startRace(state);
  if ('error' in started) throw new Error(`startRace(${numPlayers}p): ${started.error}`);
  state = started;

  let steps = 0;
  const ctx = () => `${numPlayers}p seed${seed} step${steps} round${state.round} step=${state.step}`;

  for (; steps < MAX_STEPS; steps++) {
    assertInvariants(state, ctx());
    if (state.phase === 'finished') break;

    // ── Pending ability choice ──────────────────────────────────────────
    // A pendingChoice belongs to a specific player (pc.playerId). That player
    // must resolve it before the round can continue.
    if (state.pendingChoice) {
      const pc = state.pendingChoice;
      const actorId = pc.playerId;
      // Try the generated resolution first; fall back through alternatives.
      const candidates: PendingChoiceResolution[] = [
        resolveChoice(pc, rng),
        { kind: pc.kind as 'half_off_sale', horseNum: null } as PendingChoiceResolution,
        { kind: pc.kind as 'half_off_sale', horseNum: 1 } as PendingChoiceResolution,
      ];
      let resolved = false;
      for (const res of candidates) {
        const next = takeAction(state, actorId, { type: 'resolve_choice', choice: res });
        if (!('error' in next)) { state = next; resolved = true; break; }
      }
      if (!resolved) {
        // Try every possible miracle_worker option + all other null skips.
        const fallbacks: PendingChoiceResolution[] = [
          { kind: 'miracle_worker', option: 'helmet', horseNum: 1 },
          { kind: 'miracle_worker', option: 'helmet', horseNum: 2 },
          { kind: 'miracle_worker', option: 'concession', cellIdx: 0 },
          { kind: 'miracle_worker', option: 'jersey', horseNum: 1, markHorse: 2 },
          { kind: 'inventory_check', horseNum: null },
          { kind: 'half_off_sale', horseNum: null },
          { kind: 'partner_in_crime', horseNum: null },
          { kind: 'charley_horse', horseNum: null },
          { kind: 'fair_play', horseNum: null },
          { kind: 'chain_reaction', cellIdx: null },
          { kind: 'double_crosser', horseNum: null },
        ];
        let rescued = false;
        for (const fb of fallbacks) {
          const r = takeAction(state, actorId, { type: 'resolve_choice', choice: fb });
          if (!('error' in r)) { state = r; rescued = true; break; }
        }
        if (!rescued) throw new Error(`${ctx()}: stuck on pendingChoice kind=${pc.kind}`);
      }
      continue;
    }

    // ── Pending concession bonus ────────────────────────────────────────
    if (state.pendingBonus) {
      const actorId = state.pendingBonus.playerId;
      let claimed = false;
      outer: for (const bonusId of BONUS_IDS) {
        for (let h = 1; h <= NUM_HORSES; h++) {
          const r = takeAction(state, actorId, { type: 'claim_bonus', bonusId, horse: h });
          if (!('error' in r)) { state = r; claimed = true; break outer; }
          const r2 = takeAction(state, actorId, { type: 'claim_bonus', bonusId, horse: h, horse2: h === NUM_HORSES ? 1 : h + 1 });
          if (!('error' in r2)) { state = r2; claimed = true; break outer; }
          const r3 = takeAction(state, actorId, { type: 'claim_bonus', bonusId, markHorse: h });
          if (!('error' in r3)) { state = r3; claimed = true; break outer; }
        }
        const r4 = takeAction(state, actorId, { type: 'claim_bonus', bonusId });
        if (!('error' in r4)) { state = r4; claimed = true; break; }
      }
      if (!claimed) throw new Error(`${ctx()}: stuck on pendingBonus for ${actorId}`);
      continue;
    }

    // ── Roll step ───────────────────────────────────────────────────────
    if (state.step === 'roll') {
      const horseDie = Math.floor(rng() * NUM_HORSES) + 1;
      const movementDie = pick(MOVEMENT_DIE_FACES, rng);
      const next = rollDice(state, horseDie, movementDie);
      if ('error' in next) throw new Error(`${ctx()}: rollDice error: ${next.error}`);
      state = next;
      continue;
    }

    // ── Action step ─────────────────────────────────────────────────────
    // currentTurnSeat points to whoever needs to act next. It advances after
    // each player acts until all have acted, then the round ends.
    if (state.step === 'action') {
      if (state.currentTurnSeat === null) throw new Error(`${ctx()}: step=action but currentTurnSeat=null`);
      const actorSeat = state.currentTurnSeat;
      const player = state.players.find(p => p.seat === actorSeat);
      if (!player) throw new Error(`${ctx()}: no player at seat ${actorSeat}`);
      const actorId = player.playerId;
      const cands = candidateActions(state, player, rng);
      let acted = false;
      for (const a of cands) {
        const r = takeAction(state, actorId, a);
        if (!('error' in r)) { state = r; acted = true; break; }
      }
      if (!acted) throw new Error(`${ctx()}: no legal action for seat ${actorSeat} (money=${player.money}, actedThisRound=${player.actedThisRound})`);
      continue;
    }

    throw new Error(`${ctx()}: unexpected step=${state.step}`);
  }

  expect(state.phase, `${ctx()}: game terminates`).toBe('finished');
  for (const p of state.players) {
    expect(p.money, `${ctx()}: ${p.username} final money >= 0`).toBeGreaterThanOrEqual(0);
  }
  return { steps, rounds: state.round };
}

describe('longshot: full-game fuzzer (player counts 2–6)', () => {
  const playerCounts = [2, 3, 4, 5, 6];
  const seeds = [1001, 2002, 3003, 4004];
  for (const n of playerCounts) {
    for (const seed of seeds) {
      it(`${n}p game (seed ${seed}) reaches a valid finish`, () => {
        const out = playToCompletion(n, seed);
        expect(out.steps).toBeLessThan(MAX_STEPS);
      });
    }
  }
});

describe('longshot: fuzzer — edge cases', () => {
  it('2-player minimum case finishes', () => expect(playToCompletion(2, 9999).steps).toBeLessThan(MAX_STEPS));
  it('8-player maximum case finishes', () => expect(playToCompletion(8, 8888).steps).toBeLessThan(MAX_STEPS));
  it('startRace with 1 player is rejected', () => {
    let s = initialState();
    s = addPlayer(s, 'solo', 'Solo', 0);
    const r = startRace(s);
    expect(r).toHaveProperty('error');
  });
  for (let i = 0; i < 6; i++) {
    it(`random extra game #${i + 1} finishes`, () => {
      const rng = mulberry32(70000 + i);
      const n = 2 + Math.floor(rng() * 5);
      const seed = 80000 + i;
      expect(playToCompletion(n, seed).steps).toBeLessThan(MAX_STEPS);
    });
  }
});

void STARTING_MONEY;
