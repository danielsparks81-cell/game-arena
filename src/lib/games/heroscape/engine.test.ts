import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  removePlayer,
  applyAction,
  computeHistory,
  getActivePlayerId,
  getOrderedPlayerIds,
  legalDestinations,
  legalTargets,
  attackDiceRequirements,
} from './engine';
import { hexKey, offsetToAxial } from './board';
import type { CombatFace, HSResult, HSState, RollOffRound } from './types';

// ---------------------------------------------------------------------------
// Helpers — all dice are FIXED values (the engine never rolls; the server
// action does). 'k' = skull, 's' = shield, 'b' = blank.
// ---------------------------------------------------------------------------

const F = (spec: string): CombatFace[] =>
  [...spec].map(c => (c === 'k' ? 'skull' : c === 's' ? 'shield' : 'blank'));

const ROLL_P1_FIRST: RollOffRound[] = [{ seat0: F('kkkkkk'), seat1: F('bbbbbb') }];
const ROLL_P2_FIRST: RollOffRound[] = [{ seat0: F('bbbbbb'), seat1: F('kkkkkk') }];

function unwrap(r: HSResult): HSState {
  if ('error' in r) throw new Error(`unexpected engine error: ${r.error}`);
  return r;
}

function errOf(r: HSResult): string {
  if (!('error' in r)) throw new Error('expected an engine error, got a state');
  return r.error;
}

function lobby(): HSState {
  let s = initialState();
  s = addPlayer(s, 'p1', 'Alice', 0, '#10b981');
  s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
  return s;
}

function started(first: 'p1' | 'p2' = 'p1'): HSState {
  return unwrap(
    applyAction(lobby(), 'p1', {
      kind: 'start_game',
      rollOffs: first === 'p1' ? ROLL_P1_FIRST : ROLL_P2_FIRST,
    }),
  );
}

/** offset (col,row) → axial key for readable coordinates. */
const at = (col: number, row: number) => {
  const { q, r } = offsetToAxial(col, row);
  return hexKey(q, r);
};

const FINN = 's0-finn-1';
const TARN = (n: number) => `s0-tarn_vikings-${n}`;
const THORGRIM = 's1-thorgrim-1';
const MARRO = (n: number) => `s1-marro_warriors-${n}`;

function fig(s: HSState, id: string) {
  const f = s.figures.find(x => x.id === id);
  if (!f) throw new Error(`no figure ${id}`);
  return f;
}

/** Test-only teleport (mirrors how the HQ tests stage scenarios). */
function place(s: HSState, id: string, key: string | null): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  fig(c, id).at = key;
  return c;
}

// ---------------------------------------------------------------------------
// Lobby + start
// ---------------------------------------------------------------------------

describe('lobby seating', () => {
  it('addPlayer caps at 2 seats and is idempotent', () => {
    let s = lobby();
    expect(s.players).toHaveLength(2);
    s = addPlayer(s, 'p1', 'Alice again', 0);
    expect(s.players).toHaveLength(2);
    s = addPlayer(s, 'p3', 'Carol', 2);
    expect(s.players).toHaveLength(2);
  });

  it('removePlayer frees the seat in the lobby only', () => {
    const s = removePlayer(lobby(), 'p2');
    expect(s.players.map(p => p.playerId)).toEqual(['p1']);
    const live = started();
    expect(removePlayer(live, 'p2')).toBe(live); // no-op once playing
  });
});

describe('start_game (first-turn roll-off + fixed setup)', () => {
  it('requires exactly 2 players', () => {
    const s = addPlayer(initialState(), 'p1', 'Alice', 0);
    expect(errOf(applyAction(s, 'p1', { kind: 'start_game', rollOffs: ROLL_P1_FIRST }))).toMatch(
      /exactly 2 players/,
    );
  });

  it('most skulls on 6 combat dice takes the first turn (both directions)', () => {
    const a = started('p1');
    expect(a.phase).toBe('playing');
    expect(a.turnSeat).toBe(0);
    expect(getActivePlayerId(a)).toBe('p1');
    const b = started('p2');
    expect(b.turnSeat).toBe(1);
    expect(getActivePlayerId(b)).toBe('p2');
    expect(b.rollOff?.winnerSeat).toBe(1);
  });

  it('places the fixed armies in their start zones (hero centered, squads flanking)', () => {
    const s = started();
    expect(s.figures).toHaveLength(10);
    expect(s.cards).toHaveLength(4);
    expect(fig(s, FINN).at).toBe(at(3, 0));
    expect([fig(s, TARN(1)).at, fig(s, TARN(2)).at, fig(s, TARN(3)).at, fig(s, TARN(4)).at]).toEqual(
      [at(1, 0), at(2, 0), at(4, 0), at(5, 0)],
    );
    expect(fig(s, THORGRIM).at).toBe(at(3, 7));
    expect([fig(s, MARRO(1)).at, fig(s, MARRO(2)).at, fig(s, MARRO(3)).at, fig(s, MARRO(4)).at]).toEqual(
      [at(1, 7), at(2, 7), at(4, 7), at(5, 7)],
    );
  });

  it('accepts a tie round followed by a decisive re-roll', () => {
    const rollOffs: RollOffRound[] = [
      { seat0: F('kkkbbb'), seat1: F('kkksss') }, // 3 vs 3 — tie, re-rolled
      { seat0: F('kbbbbb'), seat1: F('kkbbbb') }, // 1 vs 2 — Bob first
    ];
    const s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', rollOffs }));
    expect(s.turnSeat).toBe(1);
    expect(s.log.some(e => /Tie — re-roll/.test(e.text))).toBe(true);
  });

  it('rejects malformed roll-offs', () => {
    const tied: RollOffRound[] = [{ seat0: F('kkkbbb'), seat1: F('kkkbbb') }];
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', rollOffs: tied }))).toMatch(/tie/);
    const nonTieRerolled: RollOffRound[] = [
      { seat0: F('kkkkkk'), seat1: F('bbbbbb') },
      { seat0: F('kbbbbb'), seat1: F('kkbbbb') },
    ];
    expect(
      errOf(applyAction(lobby(), 'p1', { kind: 'start_game', rollOffs: nonTieRerolled })),
    ).toMatch(/not a tie/);
    const shortDice: RollOffRound[] = [{ seat0: F('kkk'), seat1: F('bbbbbb') }];
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', rollOffs: shortDice }))).toMatch(
      /Malformed roll-off/,
    );
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', rollOffs: [] }))).toMatch(
      /Missing/,
    );
  });

  it('cannot start twice', () => {
    expect(
      errOf(applyAction(started(), 'p1', { kind: 'start_game', rollOffs: ROLL_P1_FIRST })),
    ).toMatch(/already started/);
  });
});

// ---------------------------------------------------------------------------
// Turn alternation + ownership
// ---------------------------------------------------------------------------

describe('turn alternation', () => {
  it('strictly alternates on end_turn and rejects out-of-turn actions', () => {
    let s = started('p1');
    expect(errOf(applyAction(s, 'p2', { kind: 'end_turn' }))).toMatch(/Not your turn/);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.turnSeat).toBe(1);
    expect(getActivePlayerId(s)).toBe('p2');
    expect(errOf(applyAction(s, 'p1', { kind: 'end_turn' }))).toMatch(/Not your turn/);
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect(s.turnSeat).toBe(0);
  });

  it('end_turn resets the card lock and per-figure flags', () => {
    let s = started('p1');
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 2) }));
    expect(s.activeCardUid).toBe('s0-tarn_vikings');
    expect(s.movedFigureIds).toEqual([TARN(1)]);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.activeCardUid).toBeNull();
    expect(s.movedFigureIds).toEqual([]);
    expect(s.attackedFigureIds).toEqual([]);
  });

  it('rejects users who are not seated', () => {
    expect(errOf(applyAction(started(), 'intruder', { kind: 'end_turn' }))).toMatch(/not seated/);
  });

  it('getOrderedPlayerIds is stable seat order regardless of who acts', () => {
    const s = started('p2'); // p2 won the roll-off…
    expect(getOrderedPlayerIds(s)).toEqual(['p1', 'p2']); // …but order stays by seat
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('movement', () => {
  it('allows up to Move spaces (flat 1/hex) and rejects beyond', () => {
    const s = started('p1');
    // Finn: Move 5. (3,0) → (3,5) is exactly 5 spaces; (3,6) is 6.
    const dests = legalDestinations(s, FINN);
    expect(dests.has(at(3, 5))).toBe(true);
    expect(dests.has(at(3, 6))).toBe(false);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 5) }));
    expect(fig(moved, FINN).at).toBe(at(3, 5));
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 6) }))).toMatch(
      /out of reach/,
    );
  });

  it('cannot end on an occupied hex (friend or enemy)', () => {
    let s = started('p1');
    // Friendly: Tarn 2 stands at (2,0).
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(2, 0) }))).toMatch(
      /out of reach/,
    );
    // Enemy: park Thorgrim adjacent to Finn.
    s = place(s, THORGRIM, at(3, 1));
    expect(legalDestinations(s, FINN).has(at(3, 1))).toBe(false);
  });

  it('a figure moves at most once per turn', () => {
    let s = started('p1');
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }));
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 2) }))).toMatch(
      /already moved/,
    );
    // …but a squadmate on the same card may still move.
    const next = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(2), to: at(2, 1) }));
    expect(fig(next, TARN(2)).at).toBe(at(2, 1));
  });

  it('locks the turn to ONE army card on the first action', () => {
    let s = started('p1');
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }));
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }))).toMatch(
      /one army card/i,
    );
    expect(legalDestinations(s, FINN).size).toBe(0);
  });

  it('cannot move enemy figures or destroyed figures', () => {
    const s = started('p1');
    expect(
      errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: MARRO(1), to: at(1, 6) })),
    ).toMatch(/your own figures/);
    const dead = place(s, TARN(1), null);
    expect(
      errOf(applyAction(dead, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) })),
    ).toMatch(/No such figure/);
  });
});

// ---------------------------------------------------------------------------
// Attack eligibility (range + LOS) and combat math
// ---------------------------------------------------------------------------

describe('attack eligibility', () => {
  it('melee (Range 1) hits adjacent only', () => {
    let s = started('p1');
    s = place(s, THORGRIM, at(3, 1)); // adjacent to Finn at (3,0)
    const r = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kkk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(r, THORGRIM).at).toBeNull();
    // Two hexes away is out of melee range.
    let far = started('p1');
    far = place(far, THORGRIM, at(3, 2));
    expect(
      errOf(
        applyAction(far, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: THORGRIM,
          attackRoll: F('kkk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/Out of range/);
  });

  it('ranged: distance equal to Range is legal, one more is not (Marro Range 6)', () => {
    let s = started('p2');
    s = place(s, MARRO(1), at(3, 6)); // exactly 6 spaces from Finn at (3,0)
    const ok = unwrap(
      applyAction(s, 'p2', {
        kind: 'attack',
        attackerId: MARRO(1),
        targetId: FINN,
        attackRoll: F('kk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(ok, FINN).at).toBeNull();

    let far = started('p2');
    far = place(far, THORGRIM, at(0, 7)); // clear the spot
    far = place(far, MARRO(1), at(3, 7)); // 7 spaces from Finn
    expect(
      errOf(
        applyAction(far, 'p2', {
          kind: 'attack',
          attackerId: MARRO(1),
          targetId: FINN,
          attackRoll: F('kk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/Out of range/);
  });

  it('LOS: a figure squarely between attacker and target blocks the shot', () => {
    let s = started('p2');
    s = place(s, MARRO(1), at(1, 3)); // axial (0,3)
    s = place(s, FINN, at(3, 3)); // axial (2,3) — same axial row
    const blocked = place(s, TARN(1), at(2, 3)); // axial (1,3), dead center
    expect(
      errOf(
        applyAction(blocked, 'p2', {
          kind: 'attack',
          attackerId: MARRO(1),
          targetId: FINN,
          attackRoll: F('kk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/line of sight/i);
    expect(legalTargets(blocked, MARRO(1))).not.toContain(FINN);
    // Slide the blocker one row off the line: shot is clear again.
    const clear = place(s, TARN(1), at(2, 2));
    expect(legalTargets(clear, MARRO(1))).toContain(FINN);
    const r = unwrap(
      applyAction(clear, 'p2', {
        kind: 'attack',
        attackerId: MARRO(1),
        targetId: FINN,
        attackRoll: F('kk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(r, FINN).at).toBeNull();
  });

  it('cannot target friends, dead figures, or attack twice with one figure', () => {
    let s = started('p1');
    s = place(s, THORGRIM, at(3, 1));
    expect(
      errOf(
        applyAction(s, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: TARN(1),
          attackRoll: F('kkk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/your own figures/);
    const afterMiss = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('bbb'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(
      errOf(
        applyAction(afterMiss, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: THORGRIM,
          attackRoll: F('kkk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/already attacked/);
  });

  it('attacking ends movement for the rest of the turn', () => {
    let s = started('p1');
    s = place(s, THORGRIM, at(2, 1)); // adjacent to Tarn 2 at (2,0)
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(2),
        targetId: THORGRIM,
        attackRoll: F('bbb'),
        defenseRoll: F('ssss'),
      }),
    );
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }))).toMatch(
      /Movement is over/,
    );
  });

  it('figures move (all movement first), then may pile onto one target', () => {
    let s = started('p1');
    s = place(s, THORGRIM, at(3, 2));
    // Movement action: both Tarn warriors walk adjacent to Thorgrim.
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(2), to: at(3, 1) }));
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(2, 2) }));
    // Attack action: Tarn 2 first — blocked by shields.
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(2),
        targetId: THORGRIM,
        attackRoll: F('kkb'),
        defenseRoll: F('ssbb'),
      }),
    );
    expect(fig(s, THORGRIM).at).toBe(at(3, 2)); // 2 skulls vs 2 shields — survives
    // Tarn 1 piles onto the SAME defender (fresh defense roll) and finishes it.
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(1),
        targetId: THORGRIM,
        attackRoll: F('kkk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(s, THORGRIM).at).toBeNull();
    expect(s.attackedFigureIds).toEqual([TARN(2), TARN(1)]);
  });
});

describe('combat math (fixed server dice)', () => {
  function duel(attackRoll: CombatFace[], defenseRoll: CombatFace[]): HSState {
    let s = started('p1');
    s = place(s, THORGRIM, at(3, 1));
    return unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll,
        defenseRoll,
      }),
    );
  }

  it('skulls > shields destroys the defender outright (binary, no wounds)', () => {
    const s = duel(F('kkk'), F('sbbb')); // 3 skulls vs 1 shield
    expect(fig(s, THORGRIM).at).toBeNull();
    expect(s.lastAttack).toMatchObject({ skulls: 3, shields: 1, destroyed: true });
  });

  it('ties favor the defender — nothing happens', () => {
    const s = duel(F('kkb'), F('ssbb')); // 2 vs 2
    expect(fig(s, THORGRIM).at).toBe(at(3, 1));
    expect(s.lastAttack).toMatchObject({ skulls: 2, shields: 2, destroyed: false });
  });

  it('shields > skulls — nothing happens, no side effects', () => {
    const s = duel(F('kbb'), F('ssss'));
    expect(fig(s, THORGRIM).at).toBe(at(3, 1));
    expect(s.figures.filter(f => f.at != null)).toHaveLength(10);
  });

  it('off-symbols never count: shields on attack dice and skulls on defense dice are ignored', () => {
    // Attack rolled [shield, shield, skull] = 1 skull; defense rolled
    // [skull, skull, skull, blank] = 0 shields → 1 > 0 destroys.
    const s = duel(F('ssk'), F('kkkb'));
    expect(fig(s, THORGRIM).at).toBeNull();
    expect(s.lastAttack).toMatchObject({ skulls: 1, shields: 0, destroyed: true });
  });

  it('validates the rolled dice counts against the printed stats', () => {
    let s = started('p1');
    s = place(s, THORGRIM, at(3, 1));
    expect(
      errOf(
        applyAction(s, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: THORGRIM,
          attackRoll: F('kk'), // Finn rolls 3 attack dice, not 2
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/Malformed attack roll/);
    expect(
      errOf(
        applyAction(s, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: THORGRIM,
          attackRoll: F('kkk'),
          defenseRoll: F('bb'), // Thorgrim rolls 4 defense dice
        }),
      ),
    ).toMatch(/Malformed defense roll/);
  });

  it('attackDiceRequirements reports printed Attack vs printed Defense', () => {
    const s = started('p1');
    expect(attackDiceRequirements(s, FINN, THORGRIM)).toEqual({ attack: 3, defense: 4 });
    expect(attackDiceRequirements(s, MARRO(1), FINN)).toEqual({ attack: 2, defense: 4 });
    expect(attackDiceRequirements(s, 'nope', FINN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Elimination, win, history gate
// ---------------------------------------------------------------------------

describe('elimination and history', () => {
  function lastEnemyStanding(): HSState {
    let s = started('p1');
    // Only Thorgrim remains for p2, adjacent to Finn.
    for (let n = 1; n <= 4; n++) s = place(s, MARRO(n), null);
    return place(s, THORGRIM, at(3, 1));
  }

  it('destroying the last enemy figure finishes the game with a winner', () => {
    const s = unwrap(
      applyAction(lastEnemyStanding(), 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kkk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(s.phase).toBe('finished');
    expect(s.winnerSeat).toBe(0);
    expect(s.turnSeat).toBeNull();
    expect(getActivePlayerId(s)).toBeNull();
    expect(computeHistory(s)).toEqual({ winnerId: 'p1', playerIds: ['p1', 'p2'] });
    expect(errOf(applyAction(s, 'p2', { kind: 'end_turn' }))).toMatch(/over/);
  });

  it('a blocked attack on the last figure does NOT finish the game', () => {
    const s = unwrap(
      applyAction(lastEnemyStanding(), 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kbb'),
        defenseRoll: F('ssss'),
      }),
    );
    expect(s.phase).toBe('playing');
    expect(computeHistory(s)).toBeNull();
  });

  it('computeHistory returns null until phase === finished (THE GATE)', () => {
    expect(computeHistory(initialState())).toBeNull();
    expect(computeHistory(lobby())).toBeNull();
    let s = started('p1');
    expect(computeHistory(s)).toBeNull();
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 2) }));
    expect(computeHistory(s)).toBeNull();
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(computeHistory(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Board-helper sanity (what the UI highlights)
// ---------------------------------------------------------------------------

describe('legal-move helpers for the board', () => {
  it('legalTargets is empty out of turn, after attacking, and from spawn for the Marro', () => {
    const s = started('p1');
    // p2's marro can't act on p1's turn.
    expect(legalTargets(s, MARRO(1))).toEqual([]);
    // From its spawn row every p1 figure is 7+ spaces away (Range 6).
    const s2 = started('p2');
    expect(legalTargets(s2, MARRO(1))).toEqual([]);
    // Melee figure with no adjacent enemy has no targets.
    expect(legalTargets(s, FINN)).toEqual([]);
  });

  it('legalTargets lists in-range, in-sight enemies only', () => {
    let s = started('p2');
    s = place(s, MARRO(1), at(3, 6)); // 6 spaces from Finn
    const targets = legalTargets(s, MARRO(1));
    expect(targets).toContain(FINN);
    expect(targets).not.toContain(THORGRIM); // never your own figure
    for (const id of targets) expect(fig(s, id).ownerSeat).toBe(0);
  });

  it('legalDestinations is empty for the opponent and after the card lock', () => {
    let s = started('p1');
    expect(legalDestinations(s, MARRO(1)).size).toBe(0);
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect(legalDestinations(s, TARN(1)).size).toBe(0); // other card is locked out
    expect(legalDestinations(s, FINN).size).toBe(0); // already moved
  });
});
