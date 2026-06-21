import { describe, it, expect } from 'vitest';
import {
  createInitialStateForHost,
  applyAction,
  aiPendingSeat,
  aiNextAction,
  aiEngineAction,
  livingSeats,
} from './engine';
import { COMBAT_DIE_FACES } from './content';
import type { HSState, HSAction, CombatFace, InitiativeAttempt } from './types';

// A seeded PRNG so a simulated game is fully deterministic + reproducible.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function unwrap(r: ReturnType<typeof applyAction>): HSState {
  if (r && typeof r === 'object' && 'error' in r) throw new Error(`engine rejected: ${r.error}`);
  return r as HSState;
}

/** ANY seat that owes an action (the simulation drives every seat via the AI,
 *  regardless of the bot flag — so it exercises the brain on both sides). */
function anyPendingSeat(s: HSState): number | null {
  if (s.pendingChoice) return s.pendingChoice.seat;
  if (s.phase === 'draft') return s.draft?.turnSeat ?? null;
  if (s.phase === 'placement') return s.players.find(p => !(s.placementReady ?? []).includes(p.seat))?.seat ?? null;
  if (s.phase !== 'playing') return null;
  if (s.subPhase === 'place_markers') {
    const living = livingSeats(s);
    return s.players.find(p => living.includes(p.seat) && !(s.markersReady ?? []).includes(p.seat))?.seat ?? null;
  }
  return s.turnSeat ?? null;
}

/** A decisive d20 roll-off: distinct descending rolls → no tie, first seat wins. */
function decisive(seats: number[]): InitiativeAttempt {
  return seats.map((seat, i) => ({ seat, roll: 20 - i }));
}

/** Drive a full game with the AI brain on BOTH sides (host seat 0 + one bot),
 *  replicating the server's only non-AI steps (the draft roll-off + each round's
 *  initiative roll). Returns the final state; throws if the engine ever rejects
 *  an AI intent or the game stalls. */
function runAiGame(seed: number, budget: number): HSState {
  const rng = makeRng(seed);
  const rollDie = (): CombatFace => COMBAT_DIE_FACES[Math.floor(rng() * COMBAT_DIE_FACES.length)];
  const rollers = {
    rollDie,
    rollDice: (n: number) => Array.from({ length: n }, rollDie),
    d20: () => 1 + Math.floor(rng() * 20),
  };
  const idOf = (s: HSState, seat: number) => s.players.find(p => p.seat === seat)!.playerId;

  let s = createInitialStateForHost({ userId: 'host', username: 'Host' }); // seat 0
  s = unwrap(applyAction(s, 'host', { kind: 'add_bot' })); // seat 1 (bot)
  s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: budget, mapId: 'training_field' }));
  s = unwrap(applyAction(s, 'host', { kind: 'draft_roll', attempts: [decisive(s.players.map(p => p.seat))] }));

  for (let i = 0; i < 20000; i++) {
    if (s.phase === 'finished') break;
    if (
      s.phase === 'playing' &&
      s.subPhase === 'place_markers' &&
      livingSeats(s).every(seat => (s.markersReady ?? []).includes(seat))
    ) {
      s = unwrap(applyAction(s, 'host', { kind: 'roll_initiative', attempts: [decisive(livingSeats(s))] }));
      continue;
    }
    const seat = anyPendingSeat(s);
    if (seat == null) throw new Error(`stalled: nobody owes an action (phase=${s.phase}/${s.subPhase})`);
    const intent: HSAction | null = aiNextAction(s, seat);
    if (!intent) throw new Error(`seat ${seat} produced no intent (phase=${s.phase}/${s.subPhase})`);
    s = unwrap(applyAction(s, idOf(s, seat), aiEngineAction(s, intent, rollers)));
  }
  return s;
}

describe('HeroScape AI — full simulated game', () => {
  it('drafts, deploys, and plays to a finish with no stalls', () => {
    const s = runAiGame(7, 200);
    expect(s.phase).toBe('finished');
    expect([0, 1, null]).toContain(s.winnerSeat ?? null);
  });

  it('reaches a finish across several seeds + budgets (deterministic)', () => {
    for (const [seed, budget] of [[1, 150], [42, 250], [99, 300]] as const) {
      expect(runAiGame(seed, budget).phase).toBe('finished');
    }
  });
});

describe('HeroScape AI — bot bookkeeping', () => {
  it('add_bot seats an AI; nothing for it to do in the lobby', () => {
    let s = createInitialStateForHost({ userId: 'host', username: 'Host' });
    s = unwrap(applyAction(s, 'host', { kind: 'add_bot' }));
    const bot = s.players.find(p => p.bot);
    expect(bot).toBeTruthy();
    expect(bot!.playerId).toBe('bot-1');
    expect(aiPendingSeat(s)).toBeNull(); // lobby: no bot action pending
    expect(aiNextAction(s, bot!.seat)).toBeNull();
  });

  it('aiPendingSeat picks the bot during its draft pick', () => {
    let s = createInitialStateForHost({ userId: 'host', username: 'Host' });
    s = unwrap(applyAction(s, 'host', { kind: 'add_bot' }));
    s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: 200, mapId: 'training_field' }));
    s = unwrap(applyAction(s, 'host', { kind: 'draft_roll', attempts: [decisive([0, 1])] }));
    // Seat 0 (host) drafts first per the decisive roll; the bot is seat 1.
    while (s.draft?.turnSeat === 0) {
      const intent = aiNextAction(s, 0)!;
      s = unwrap(applyAction(s, 'host', aiEngineAction(s, intent, { rollDie: () => 'blank', rollDice: () => [], d20: () => 1 })));
    }
    if (s.phase === 'draft' && s.draft?.turnSeat === 1) expect(aiPendingSeat(s)).toBe(1);
  });
});
