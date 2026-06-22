import { describe, it, expect } from 'vitest';
import {
  createInitialStateForHost,
  applyAction,
  aiPendingSeat,
  aiNextAction,
  aiEngineAction,
  livingSeats,
  initiativeReadySeats,
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
function runAiGame(seed: number, budget: number, bots = 1, mapId = 'training_field'): HSState {
  const rng = makeRng(seed);
  const rollDie = (): CombatFace => COMBAT_DIE_FACES[Math.floor(rng() * COMBAT_DIE_FACES.length)];
  const rollers = {
    rollDie,
    rollDice: (n: number) => Array.from({ length: n }, rollDie),
    d20: () => 1 + Math.floor(rng() * 20),
  };
  const idOf = (s: HSState, seat: number) => s.players.find(p => p.seat === seat)!.playerId;

  let s = createInitialStateForHost({ userId: 'host', username: 'Host' }); // seat 0
  for (let b = 0; b < bots; b++) s = unwrap(applyAction(s, 'host', { kind: 'add_bot' })); // seats 1..bots
  s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: budget, mapId }));
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

  it('grabs the glyphs — a bot claims unclaimed power glyphs as it advances', () => {
    // training_field carries two mid-board glyphs (Astrid +1 attack, Gerda +1
    // defence). The move brain detours onto a nearby unclaimed glyph, so by the end
    // of a full game at least one has been claimed (flipped face-up by a figure
    // stopping on it) — the AI no longer marches past free buffs like the v1 did.
    const s = runAiGame(7, 200);
    const claimed = (s.glyphs ?? []).filter(g => g.faceUp);
    expect(claimed.length).toBeGreaterThanOrEqual(1);
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

describe('HeroScape round flow — eliminated seats', () => {
  // The soft-lock was the SERVER waiting on `players.length` lock-ins; with a dead
  // seat that count is never reached. `initiativeReadySeats` centralizes the rule
  // (living seats only) so the server can't get it wrong again. Build the minimal
  // state the helper reads: phase/subPhase, players, figures (a seat is alive iff
  // it has a figure on the board or in reserve), markersReady.
  const base = (markersReady: number[]): HSState =>
    ({
      phase: 'playing',
      subPhase: 'place_markers',
      players: [{ seat: 0 }, { seat: 1 }, { seat: 2 }],
      // seat 1 is ELIMINATED — its only figure is off-board and not in reserve.
      figures: [
        { ownerSeat: 0, at: '0,0' },
        { ownerSeat: 1, at: null, reserve: false },
        { ownerSeat: 2, at: '1,1' },
      ],
      markersReady,
    }) as unknown as HSState;

  it('does not roll until every LIVING seat has placed (dead seat 1 is ignored)', () => {
    expect(initiativeReadySeats(base([]))).toBeNull(); // nobody placed
    expect(initiativeReadySeats(base([0]))).toBeNull(); // only one living seat placed
    // Both LIVING seats (0 and 2) placed — roll for exactly them, never the dead seat 1.
    expect(initiativeReadySeats(base([0, 2]))).toEqual([0, 2]);
    // Even if the dead seat somehow appears in markersReady, it's not rolled for.
    expect(initiativeReadySeats(base([0, 1, 2]))).toEqual([0, 2]);
  });

  it('returns null outside the place_markers step', () => {
    const s = base([0, 2]);
    expect(initiativeReadySeats({ ...s, subPhase: 'turn' } as unknown as HSState)).toBeNull();
    expect(initiativeReadySeats({ ...s, phase: 'draft' } as unknown as HSState)).toBeNull();
  });

  it('integration: a 3-seat round survives a wipe — initiative rolls, a living seat acts', () => {
    // Drive a real 3-seat game (Star Field) only as far as the first order-marker
    // step (draft + placement — fast, no slow board-crossing combat), then SIMULATE
    // seat 1 being wiped (drop its figures off-board), and confirm the round still
    // completes: the two living seats place markers, initiative rolls for exactly
    // them, and a LIVING seat's turn begins — the dead seat is never asked to act.
    const rng = makeRng(5);
    const rollDie = (): CombatFace => COMBAT_DIE_FACES[Math.floor(rng() * COMBAT_DIE_FACES.length)];
    const rollers = { rollDie, rollDice: (n: number) => Array.from({ length: n }, rollDie), d20: () => 1 + Math.floor(rng() * 20) };
    const idOf = (s: HSState, seat: number) => s.players.find(p => p.seat === seat)!.playerId;

    let s = createInitialStateForHost({ userId: 'host', username: 'Host' });
    s = unwrap(applyAction(s, 'host', { kind: 'add_bot' })); // seat 1
    s = unwrap(applyAction(s, 'host', { kind: 'add_bot' })); // seat 2
    s = unwrap(applyAction(s, 'host', { kind: 'start_game', mode: 'draft', pointBudget: 200, mapId: 'star_field' }));
    s = unwrap(applyAction(s, 'host', { kind: 'draft_roll', attempts: [decisive([0, 1, 2])] }));
    // Run draft + placement, stopping the instant we reach the first marker step.
    for (let i = 0; i < 5000 && !(s.phase === 'playing' && s.subPhase === 'place_markers'); i++) {
      const seat = anyPendingSeat(s);
      if (seat == null) break;
      s = unwrap(applyAction(s, idOf(s, seat), aiEngineAction(s, aiNextAction(s, seat)!, rollers)));
    }
    expect(s.subPhase).toBe('place_markers');

    // Wipe seat 1 — its figures leave the board and reserve (how the engine marks a kill).
    s = { ...s, figures: s.figures.map(f => (f.ownerSeat === 1 ? { ...f, at: null, at2: null, reserve: false } : f)) };
    expect(livingSeats(s)).toEqual([0, 2]);

    // The two living seats lock in their markers (the dead seat is never prompted).
    for (const seat of [0, 2]) {
      s = unwrap(applyAction(s, idOf(s, seat), aiEngineAction(s, aiNextAction(s, seat)!, rollers)));
    }
    const seats = initiativeReadySeats(s);
    expect(seats).toEqual([0, 2]); // roll for exactly the living seats
    s = unwrap(applyAction(s, 'host', { kind: 'roll_initiative', attempts: [decisive(seats!)] }));
    expect(s.subPhase).not.toBe('place_markers'); // round advanced into turns
    expect([0, 2]).toContain(s.turnSeat); // a living seat acts — never the wiped seat 1
  });
});
