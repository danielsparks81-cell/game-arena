import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  takeAction,
  CONCESSION_CELLS,
  type LSState,
} from './longshot';

// Reproduces the live state right after a player completed a vertical COLUMN
// (which queues that column's base bonus AND triggers Chain Reaction): the
// player owns horse 1 with Chain Reaction, a base bonus of 1 is already pending,
// and the free Chain Reaction mark is awaiting a cell. Row 0 (cells 0,1,2,3) is
// pre-marked except cell 3, so marking cell 3 completes that row.
function chainReactionPending(): LSState {
  const seeded = addPlayer(initialState(), 'p1', 'Alice', 0);
  const players = seeded.players.map(p =>
    p.playerId === 'p1'
      ? { ...p, ownedHorses: [1], concessionMarks: p.concessionMarks.map((_, i) => i <= 2) }
      : p,
  );
  return {
    ...seeded,
    phase: 'playing',
    step: 'action',
    currentTurnSeat: 0,
    concessionGrid: Array.from({ length: CONCESSION_CELLS }, () => 1),
    assignedAbilities: { 1: 'h1_chain_reaction' },
    players,
    pendingChoice: { kind: 'chain_reaction', playerId: 'p1' },
    pendingBonus: { playerId: 'p1', count: 1 },
  };
}

describe('Long Shot — Chain Reaction free-mark completion bonus', () => {
  it('awards the base completion bonus when the free mark completes a row', () => {
    const res = takeAction(chainReactionPending(), 'p1', {
      type: 'resolve_choice',
      choice: { kind: 'chain_reaction', cellIdx: 3 },
    });
    expect('error' in res).toBe(false);
    const next = res as LSState;
    // The triggering column's bonus (1) + the row the free mark just completed (1).
    expect(next.pendingBonus).not.toBeNull();
    expect(next.pendingBonus!.count).toBe(2);
    expect(next.players[0].concessionMarks[3]).toBe(true);
  });

  it('does not change the bonus when the free mark completes nothing', () => {
    const res = takeAction(chainReactionPending(), 'p1', {
      type: 'resolve_choice',
      choice: { kind: 'chain_reaction', cellIdx: 8 }, // row 2 / col 0 — neither completes
    });
    expect('error' in res).toBe(false);
    expect((res as LSState).pendingBonus!.count).toBe(1);
  });

  it('skipping the free mark leaves the original column bonus intact', () => {
    const res = takeAction(chainReactionPending(), 'p1', {
      type: 'resolve_choice',
      choice: { kind: 'chain_reaction', cellIdx: null },
    });
    expect('error' in res).toBe(false);
    expect((res as LSState).pendingBonus!.count).toBe(1);
  });
});
