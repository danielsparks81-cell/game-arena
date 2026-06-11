import { describe, it, expect } from 'vitest';
import {
  initialState,
  addPlayer,
  removePlayer,
  applyAction,
  computeHistory,
  getActivePlayerId,
  getOrderedPlayerIds,
  getActiveCardUid,
  projectStateForViewer,
  legalDestinations,
  legalTargets,
  attackDiceRequirements,
} from './engine';
import { hexKey, offsetToAxial } from './board';
import type {
  CombatFace,
  HSResult,
  HSState,
  InitiativeAttempt,
  OrderMarkerValue,
} from './types';

// ---------------------------------------------------------------------------
// Helpers — all dice are FIXED values (the engine never rolls; the server
// action does). 'k' = skull, 's' = shield, 'b' = blank.
// ---------------------------------------------------------------------------

const F = (spec: string): CombatFace[] =>
  [...spec].map(c => (c === 'k' ? 'skull' : c === 's' ? 'shield' : 'blank'));

/** One d20 initiative attempt for the 2 fixed seats. */
const ATT = (roll0: number, roll1: number): InitiativeAttempt => [
  { seat: 0, roll: roll0 },
  { seat: 1, roll: roll1 },
];

type Assignment = { marker: OrderMarkerValue; cardUid: string };

/** All four markers stacked on one card (legal — any split is). */
const allOn = (cardUid: string): Assignment[] =>
  (['1', '2', '3', 'X'] as const).map(marker => ({ marker, cardUid }));

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

/** start_game applied → round 1, place_markers. */
function started(): HSState {
  return unwrap(applyAction(lobby(), 'p1', { kind: 'start_game' }));
}

function placed(s: HSState, pid: 'p1' | 'p2', assignments: Assignment[]): HSState {
  return unwrap(applyAction(s, pid, { kind: 'place_markers', assignments }));
}

function bothPlaced(): HSState {
  let s = started();
  s = placed(s, 'p1', allOn('s0-finn'));
  s = placed(s, 'p2', allOn('s1-thorgrim'));
  return s;
}

/** Battle staged into the turns subPhase: each player stacks all four markers
 *  on one card (defaults: Finn / Thorgrim) and `first` wins the d20. */
function inTurns(
  first: 'p1' | 'p2' = 'p1',
  cards: { p1?: string; p2?: string } = {},
): HSState {
  let s = started();
  s = placed(s, 'p1', allOn(cards.p1 ?? 's0-finn'));
  s = placed(s, 'p2', allOn(cards.p2 ?? 's1-thorgrim'));
  return unwrap(
    applyAction(s, 'p2', {
      kind: 'roll_initiative',
      attempts: [first === 'p1' ? ATT(15, 3) : ATT(3, 15)],
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

/** Test-only pre-wounding (stages "earlier rounds" damage). */
function wound(s: HSState, id: string, n: number): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  fig(c, id).wounds = n;
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

describe('start_game (fixed setup, straight into marker placement)', () => {
  it('requires exactly 2 players', () => {
    const s = addPlayer(initialState(), 'p1', 'Alice', 0);
    expect(errOf(applyAction(s, 'p1', { kind: 'start_game' }))).toMatch(/exactly 2 players/);
  });

  it('opens round 1 in place_markers with no active player and no initiative', () => {
    const s = started();
    expect(s.phase).toBe('playing');
    expect(s.subPhase).toBe('place_markers');
    expect(s.round).toBe(1);
    expect(s.turnSeat).toBeNull();
    expect(getActivePlayerId(s)).toBeNull();
    expect(s.markersReady).toEqual([]);
    expect(s.initiative).toEqual([]);
    expect(s.initiativeRolls).toEqual([]);
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
    expect(s.figures.every(f => f.wounds === 0)).toBe(true);
    expect(s.cards.every(c => c.orderMarkers.length === 0)).toBe(true);
  });

  it('cannot start twice', () => {
    expect(errOf(applyAction(started(), 'p1', { kind: 'start_game' }))).toMatch(/already started/);
  });
});

// ---------------------------------------------------------------------------
// 1. place_markers validation (secret, simultaneous, ready-gated)
// ---------------------------------------------------------------------------

describe('place_markers validation', () => {
  it('requires exactly one each of 1/2/3/X', () => {
    const dup: Assignment[] = [
      { marker: '1', cardUid: 's0-finn' },
      { marker: '1', cardUid: 's0-finn' },
      { marker: '2', cardUid: 's0-finn' },
      { marker: '3', cardUid: 's0-finn' },
    ];
    expect(errOf(applyAction(started(), 'p1', { kind: 'place_markers', assignments: dup }))).toMatch(
      /exactly one/,
    );
    expect(
      errOf(applyAction(started(), 'p1', { kind: 'place_markers', assignments: allOn('s0-finn').slice(0, 3) })),
    ).toMatch(/exactly one/); // the X is mandatory too
    expect(
      errOf(
        applyAction(started(), 'p1', {
          kind: 'place_markers',
          assignments: [...allOn('s0-finn'), { marker: 'X', cardUid: 's0-finn' }],
        }),
      ),
    ).toMatch(/exactly one/);
  });

  it('only your own living cards may hold markers', () => {
    expect(
      errOf(applyAction(started(), 'p1', { kind: 'place_markers', assignments: allOn('s1-thorgrim') })),
    ).toMatch(/your own/);
    expect(
      errOf(applyAction(started(), 'p1', { kind: 'place_markers', assignments: allOn('nope') })),
    ).toMatch(/your own/);
    let dead = started();
    for (let n = 1; n <= 4; n++) dead = place(dead, TARN(n), null);
    expect(
      errOf(applyAction(dead, 'p1', { kind: 'place_markers', assignments: allOn('s0-tarn_vikings') })),
    ).toMatch(/out of play/);
  });

  it('stacking and splitting are both legal; markers store unrevealed', () => {
    const s = placed(started(), 'p1', [
      { marker: '1', cardUid: 's0-finn' },
      { marker: '2', cardUid: 's0-tarn_vikings' },
      { marker: '3', cardUid: 's0-finn' },
      { marker: 'X', cardUid: 's0-tarn_vikings' },
    ]);
    expect(s.cards.find(c => c.uid === 's0-finn')!.orderMarkers.map(m => m.marker)).toEqual(['1', '3']);
    expect(s.cards.find(c => c.uid === 's0-tarn_vikings')!.orderMarkers.map(m => m.marker)).toEqual(['2', 'X']);
    expect(s.cards.flatMap(c => c.orderMarkers).every(m => !m.revealed)).toBe(true);
    expect(s.markersReady).toEqual([0]);
    expect(s.subPhase).toBe('place_markers'); // still waiting on Bob
    expect(getActivePlayerId(s)).toBeNull();
  });

  it('cannot lock in twice and cannot place once the round is under way', () => {
    const s = placed(started(), 'p1', allOn('s0-finn'));
    expect(errOf(applyAction(s, 'p1', { kind: 'place_markers', assignments: allOn('s0-finn') }))).toMatch(
      /already locked in/,
    );
    expect(
      errOf(applyAction(inTurns(), 'p1', { kind: 'place_markers', assignments: allOn('s0-finn') })),
    ).toMatch(/round is under way/);
  });

  it('turn actions are rejected while markers are being placed', () => {
    const s = started();
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }))).toMatch(
      /order markers first/,
    );
    expect(errOf(applyAction(s, 'p1', { kind: 'end_turn' }))).toMatch(/order markers first/);
    expect(
      errOf(
        applyAction(s, 'p1', {
          kind: 'attack',
          attackerId: FINN,
          targetId: THORGRIM,
          attackRoll: F('kkk'),
          defenseRoll: F('bbbb'),
        }),
      ),
    ).toMatch(/order markers first/);
  });
});

// ---------------------------------------------------------------------------
// 2. Initiative (d20 every round, ties re-roll, server-rolled)
// ---------------------------------------------------------------------------

describe('roll_initiative', () => {
  it('the final attempt decides the order (both directions)', () => {
    const a = inTurns('p1');
    expect(a.subPhase).toBe('turns');
    expect(a.initiative).toEqual([0, 1]);
    expect(a.turnSeat).toBe(0);
    expect(getActivePlayerId(a)).toBe('p1');
    const b = inTurns('p2');
    expect(b.initiative).toEqual([1, 0]);
    expect(b.turnSeat).toBe(1);
    expect(getActivePlayerId(b)).toBe('p2');
  });

  it('keeps every attempt — ties included — for the display', () => {
    const s = unwrap(
      applyAction(bothPlaced(), 'p1', {
        kind: 'roll_initiative',
        attempts: [ATT(7, 7), ATT(12, 12), ATT(2, 19)],
      }),
    );
    expect(s.initiativeRolls).toHaveLength(3);
    expect(s.initiative).toEqual([1, 0]);
    expect(s.log.filter(e => /Tie — re-roll/.test(e.text))).toHaveLength(2);
  });

  it('rejects a final attempt containing a tie', () => {
    expect(
      errOf(applyAction(bothPlaced(), 'p1', { kind: 'roll_initiative', attempts: [ATT(9, 9)] })),
    ).toMatch(/tie/i);
  });

  it('rejects a re-rolled attempt that was not a tie', () => {
    expect(
      errOf(
        applyAction(bothPlaced(), 'p1', { kind: 'roll_initiative', attempts: [ATT(9, 3), ATT(8, 2)] }),
      ),
    ).toMatch(/not tied/);
  });

  it('rejects rolling before every player has locked in', () => {
    const s = placed(started(), 'p1', allOn('s0-finn'));
    expect(errOf(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [ATT(9, 3)] }))).toMatch(
      /every player/,
    );
  });

  it('rejects malformed attempts and double rolls', () => {
    const both = bothPlaced();
    expect(errOf(applyAction(both, 'p1', { kind: 'roll_initiative', attempts: [] }))).toMatch(/Missing/);
    expect(
      errOf(applyAction(both, 'p1', { kind: 'roll_initiative', attempts: [[{ seat: 0, roll: 21 }, { seat: 1, roll: 3 }]] })),
    ).toMatch(/Malformed/);
    expect(
      errOf(applyAction(both, 'p1', { kind: 'roll_initiative', attempts: [[{ seat: 0, roll: 0 }, { seat: 1, roll: 3 }]] })),
    ).toMatch(/Malformed/);
    expect(
      errOf(applyAction(both, 'p1', { kind: 'roll_initiative', attempts: [[{ seat: 0, roll: 5 }]] })),
    ).toMatch(/Malformed/);
    expect(
      errOf(applyAction(both, 'p1', { kind: 'roll_initiative', attempts: [[{ seat: 0, roll: 5 }, { seat: 0, roll: 3 }]] })),
    ).toMatch(/Malformed/);
    expect(
      errOf(applyAction(inTurns(), 'p1', { kind: 'roll_initiative', attempts: [ATT(9, 3)] })),
    ).toMatch(/already been rolled/);
  });
});

// ---------------------------------------------------------------------------
// 3. Reveal flow — automatic reveal, one card per turn, round rollover
// ---------------------------------------------------------------------------

describe('reveal flow (turns 1→2→3, then the next round)', () => {
  it('reveals marker N at each turn start and only the revealed card acts', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    const finnCard = s.cards.find(c => c.uid === 's0-finn')!;
    expect(finnCard.orderMarkers.find(m => m.marker === '1')!.revealed).toBe(true);
    expect(finnCard.orderMarkers.filter(m => m.revealed)).toHaveLength(1);
    expect(getActiveCardUid(s)).toBe('s0-finn');
    // Another card's figures are locked out entirely.
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }))).toMatch(
      /revealed card/,
    );
    expect(legalDestinations(s, TARN(1)).size).toBe(0);
    // The revealed card's own figures are free to act.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect(fig(moved, FINN).at).toBe(at(3, 1));
  });

  it('end_turn walks A1 B1 A2 B2 A3 B3, then rolls into round 2 with markers cleared', () => {
    let s = inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' });
    const marker = (uid: string, v: string) =>
      s.cards.find(c => c.uid === uid)!.orderMarkers.find(m => m.marker === v)!;

    expect([s.turnSeat, s.turnNumber]).toEqual([0, 1]);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 1]);
    expect(marker('s1-marro_warriors', '1').revealed).toBe(true);
    expect(getActiveCardUid(s)).toBe('s1-marro_warriors');
    expect(errOf(applyAction(s, 'p1', { kind: 'end_turn' }))).toMatch(/Not your turn/);

    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([0, 2]);
    expect(marker('s0-finn', '2').revealed).toBe(true);

    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 2]);
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([0, 3]);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 3]);

    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' })); // last turn of the round
    expect(s.round).toBe(2);
    expect(s.subPhase).toBe('place_markers');
    expect(s.turnSeat).toBeNull();
    expect(getActivePlayerId(s)).toBeNull();
    expect(s.markersReady).toEqual([]);
    expect(s.initiative).toEqual([]);
    expect(s.initiativeRolls).toEqual([]);
    for (const c of s.cards) expect(c.orderMarkers).toEqual([]);
  });

  it('end_turn resets the per-figure flags for the next turn', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 2) }));
    expect(s.movedFigureIds).toEqual([TARN(1)]);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.movedFigureIds).toEqual([]);
    expect(s.attackedFigureIds).toEqual([]);
  });

  it('rejects users who are not seated', () => {
    expect(errOf(applyAction(started(), 'intruder', { kind: 'end_turn' }))).toMatch(/not seated/);
  });

  it('getOrderedPlayerIds is stable seat order regardless of initiative', () => {
    const s = inTurns('p2'); // p2 won the d20…
    expect(getOrderedPlayerIds(s)).toEqual(['p1', 'p2']); // …but order stays by seat
  });
});

// ---------------------------------------------------------------------------
// 4. Lost turns (destroyed card, marker never revealed)
// ---------------------------------------------------------------------------

describe('lost turns (p. 14)', () => {
  it('skips the turn of a destroyed card without revealing the marker or naming the card', () => {
    let s = started();
    s = placed(s, 'p1', [
      { marker: '1', cardUid: 's0-finn' },
      { marker: '2', cardUid: 's0-tarn_vikings' },
      { marker: '3', cardUid: 's0-tarn_vikings' },
      { marker: 'X', cardUid: 's0-finn' },
    ]);
    s = placed(s, 'p2', allOn('s1-thorgrim'));
    s = unwrap(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [ATT(20, 1)] }));
    // p1 turn 1 (Finn). The whole Tarn squad falls before its markers come up.
    for (let n = 1; n <= 4; n++) s = place(s, TARN(n), null);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' })); // → p2 turn 1
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' })); // p1 turn 2 LOST → p2 turn 2
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 2]);

    const lost = s.log.find(e => /loses turn 2/.test(e.text));
    expect(lost).toBeDefined();
    expect(lost!.text).not.toMatch(/Tarn/); // never names the dead card…
    expect(lost!.text).not.toMatch(/marker [123X]/); // …or any marker value

    // The dead card's markers stay where they were and stay face-down.
    const tarn = s.cards.find(c => c.uid === 's0-tarn_vikings')!;
    expect(tarn.orderMarkers.map(m => m.marker).sort()).toEqual(['2', '3']);
    expect(tarn.orderMarkers.every(m => !m.revealed)).toBe(true);
    // The opponent's projection still shows only hidden chips on it.
    const seen = projectStateForViewer(s, 'p2').cards.find(c => c.uid === 's0-tarn_vikings')!;
    expect(seen.orderMarkers).toEqual([
      { marker: 'hidden', revealed: false },
      { marker: 'hidden', revealed: false },
    ]);

    // p1's turn 3 is lost the same way, then the round rolls over normally.
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 3]);
    expect(s.log.some(e => /loses turn 3/.test(e.text))).toBe(true);
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect(s.round).toBe(2);
    expect(s.subPhase).toBe('place_markers');
  });
});

// ---------------------------------------------------------------------------
// 5. The X decoy
// ---------------------------------------------------------------------------

describe('the X decoy', () => {
  it('never produces a turn and is never revealed', () => {
    let s = started();
    s = placed(s, 'p1', [
      { marker: '1', cardUid: 's0-finn' },
      { marker: '2', cardUid: 's0-finn' },
      { marker: '3', cardUid: 's0-finn' },
      { marker: 'X', cardUid: 's0-tarn_vikings' }, // the bluff
    ]);
    s = placed(s, 'p2', allOn('s1-thorgrim'));
    s = unwrap(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [ATT(20, 1)] }));
    let p1Turns = 0;
    while (s.subPhase === 'turns') {
      const xMarker = s.cards.find(c => c.uid === 's0-tarn_vikings')!.orderMarkers[0];
      expect(xMarker.marker).toBe('X');
      expect(xMarker.revealed).toBe(false);
      if (s.turnSeat === 0) {
        p1Turns += 1;
        expect(getActiveCardUid(s)).toBe('s0-finn'); // never the X card
      }
      s = unwrap(applyAction(s, s.turnSeat === 0 ? 'p1' : 'p2', { kind: 'end_turn' }));
    }
    expect(p1Turns).toBe(3); // the X granted nothing beyond the three numbered turns
    expect(s.round).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Movement (unchanged rules, now gated on the revealed card)
// ---------------------------------------------------------------------------

describe('movement', () => {
  it('allows up to Move spaces (flat 1/hex) and rejects beyond', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
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
    let s = inTurns('p1', { p1: 's0-finn' });
    // Friendly: Tarn 2 stands at (2,0).
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(2, 0) }))).toMatch(
      /out of reach/,
    );
    // Enemy: park Thorgrim adjacent to Finn.
    s = place(s, THORGRIM, at(3, 1));
    expect(legalDestinations(s, FINN).has(at(3, 1))).toBe(false);
  });

  it('a figure moves at most once per turn; squadmates still may', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }));
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 2) }))).toMatch(
      /already moved/,
    );
    const next = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(2), to: at(2, 1) }));
    expect(fig(next, TARN(2)).at).toBe(at(2, 1));
  });

  it('cannot move enemy figures or destroyed figures', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    expect(
      errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: MARRO(1), to: at(1, 6) })),
    ).toMatch(/your own figures/);
    const dead = place(inTurns('p1', { p1: 's0-tarn_vikings' }), TARN(1), null);
    expect(
      errOf(applyAction(dead, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) })),
    ).toMatch(/No such figure/);
  });
});

// ---------------------------------------------------------------------------
// Attack eligibility (range + LOS) — unchanged rules on the revealed card
// ---------------------------------------------------------------------------

describe('attack eligibility', () => {
  it('melee (Range 1) hits adjacent only', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
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
    expect(fig(r, THORGRIM).wounds).toBe(3); // Life 4 — wounded, not destroyed
    // Two hexes away is out of melee range.
    let far = inTurns('p1', { p1: 's0-finn' });
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
    let s = inTurns('p2', { p2: 's1-marro_warriors' });
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
    expect(fig(ok, FINN).wounds).toBe(2);

    let far = inTurns('p2', { p2: 's1-marro_warriors' });
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
    let s = inTurns('p2', { p2: 's1-marro_warriors' });
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
  });

  it('cannot target friends, dead figures, or attack twice with one figure', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
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
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
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

  it('squad figures pile onto one defender, each with a fresh defense roll', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, THORGRIM, at(3, 2));
    s = place(s, TARN(2), at(3, 1));
    s = place(s, TARN(1), at(2, 2));
    s = place(s, TARN(3), at(3, 3)); // three Vikings ring Thorgrim
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(2),
        targetId: THORGRIM,
        attackRoll: F('kkb'),
        defenseRoll: F('ssbb'),
      }),
    );
    expect(fig(s, THORGRIM).wounds).toBe(0); // 2 skulls vs 2 shields — blocked
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(1),
        targetId: THORGRIM,
        attackRoll: F('kkk'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(s, THORGRIM).wounds).toBe(3); // wounded but standing (Life 4)
    expect(fig(s, THORGRIM).at).toBe(at(3, 2));
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: TARN(3),
        targetId: THORGRIM,
        attackRoll: F('kbb'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(s, THORGRIM).at).toBeNull(); // 3 + 1 = Life 4 — destroyed
    expect(s.attackedFigureIds).toEqual([TARN(2), TARN(1), TARN(3)]);
  });
});

// ---------------------------------------------------------------------------
// 6. Wounds (Master combat, p. 14) + dice validation
// ---------------------------------------------------------------------------

describe('wounds (fixed server dice)', () => {
  function duel(attackRoll: CombatFace[], defenseRoll: CombatFace[]): HSState {
    let s = inTurns('p1', { p1: 's0-finn' });
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

  it('each unblocked skull is one wound — a Life-4 hero soaks 2 and lives', () => {
    const s = duel(F('kkb'), F('bbbb'));
    expect(fig(s, THORGRIM).wounds).toBe(2);
    expect(fig(s, THORGRIM).at).toBe(at(3, 1));
    expect(s.lastAttack).toMatchObject({ skulls: 2, shields: 0, wounds: 2, destroyed: false });
    expect(s.phase).toBe('playing');
  });

  it('shields block skull-for-skull: 3 skulls vs 1 shield = 2 wounds', () => {
    const s = duel(F('kkk'), F('sbbb'));
    expect(fig(s, THORGRIM).wounds).toBe(2);
    expect(s.lastAttack).toMatchObject({ skulls: 3, shields: 1, wounds: 2, destroyed: false });
  });

  it('wounds accumulate and reaching Life destroys the figure', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
    s = place(s, THORGRIM, at(3, 1));
    s = wound(s, THORGRIM, 3); // staged damage from earlier rounds
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kbb'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(fig(s, THORGRIM).at).toBeNull(); // 3 + 1 = Life 4
    expect(s.lastAttack).toMatchObject({ wounds: 1, destroyed: true });
  });

  it('a Life-1 squad figure still dies to a single unblocked skull (regression)', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
    s = place(s, MARRO(1), at(3, 1));
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: MARRO(1),
        attackRoll: F('kbb'),
        defenseRoll: F('bbb'),
      }),
    );
    expect(fig(s, MARRO(1)).at).toBeNull();
    expect(s.lastAttack).toMatchObject({ skulls: 1, shields: 0, wounds: 1, destroyed: true });
  });

  it('ties favor the defender — no wounds, no side effects', () => {
    const s = duel(F('kkb'), F('ssbb'));
    expect(fig(s, THORGRIM).wounds).toBe(0);
    expect(fig(s, THORGRIM).at).toBe(at(3, 1));
    expect(s.lastAttack).toMatchObject({ skulls: 2, shields: 2, wounds: 0, destroyed: false });
    expect(s.figures.filter(f => f.at != null)).toHaveLength(10);
  });

  it('off-symbols never count: shields on attack dice and skulls on defense dice are ignored', () => {
    const s = duel(F('ssk'), F('kkkb'));
    expect(s.lastAttack).toMatchObject({ skulls: 1, shields: 0, wounds: 1, destroyed: false });
    expect(fig(s, THORGRIM).wounds).toBe(1);
  });

  it('validates the rolled dice counts against the printed stats', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
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
    const s = inTurns('p1');
    expect(attackDiceRequirements(s, FINN, THORGRIM)).toEqual({ attack: 3, defense: 4 });
    expect(attackDiceRequirements(s, MARRO(1), FINN)).toEqual({ attack: 2, defense: 4 });
    expect(attackDiceRequirements(s, 'nope', FINN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Projection — the hidden-information boundary (NON-NEGOTIABLE leak test)
// ---------------------------------------------------------------------------

describe('projectStateForViewer (order-marker secrecy)', () => {
  const VALUES = ['1', '2', '3', 'X'] as const;

  /** Occurrences of each marker-value byte pattern in the serialized state. */
  function markerBytes(x: unknown): Record<string, number> {
    const json = JSON.stringify(x);
    return Object.fromEntries(VALUES.map(v => [v, json.split(`"marker":"${v}"`).length - 1]));
  }
  const NONE = { '1': 0, '2': 0, '3': 0, X: 0 };

  it('JSON.stringify of a projected state never contains an unrevealed opponent marker value (X decoy indistinguishable)', () => {
    // Lobby: nothing to leak — projection is a safe no-op.
    expect(markerBytes(projectStateForViewer(lobby(), 'p1'))).toEqual(NONE);

    // Bob places a known split; Alice has NOT placed, so ANY marker-value
    // byte anywhere in Alice's projected state is a leak of Bob's secrets.
    let s = started();
    s = placed(s, 'p2', [
      { marker: '1', cardUid: 's1-thorgrim' },
      { marker: '2', cardUid: 's1-marro_warriors' },
      { marker: '3', cardUid: 's1-marro_warriors' },
      { marker: 'X', cardUid: 's1-thorgrim' },
    ]);
    const forAlice = projectStateForViewer(s, 'p1');
    expect(markerBytes(forAlice)).toEqual(NONE);
    // Spectators (null viewer) get the fully hidden view too.
    expect(markerBytes(projectStateForViewer(s, null))).toEqual(NONE);
    // Chip COUNTS stay public — Bob's cards still show two face-down chips each…
    expect(forAlice.cards.find(c => c.uid === 's1-thorgrim')!.orderMarkers).toEqual([
      { marker: 'hidden', revealed: false },
      { marker: 'hidden', revealed: false },
    ]);
    // …Bob still sees his own four, and projection never mutates the input.
    expect(markerBytes(projectStateForViewer(s, 'p2'))).toEqual({ '1': 1, '2': 1, '3': 1, X: 1 });
    expect(markerBytes(s)).toEqual({ '1': 1, '2': 1, '3': 1, X: 1 });

    // After reveals: Bob wins initiative, so his marker 1 (Thorgrim) flips
    // face-up and IS public; 2/3/X must stay hidden from Alice.
    s = placed(s, 'p1', allOn('s0-finn'));
    s = unwrap(applyAction(s, 'p1', { kind: 'roll_initiative', attempts: [ATT(3, 15)] }));
    let proj = projectStateForViewer(s, 'p1');
    const bobCards = () => proj.cards.filter(c => c.ownerSeat === 1);
    const restOfState = () => ({ ...proj, cards: proj.cards.filter(c => c.ownerSeat === 0) });
    expect(markerBytes(bobCards())).toEqual({ '1': 1, '2': 0, '3': 0, X: 0 });
    // Everything OUTSIDE Bob's cards (log, lastAttack, Alice's own cards…)
    // carries only Alice's own four marker values — nothing of Bob's.
    expect(markerBytes(restOfState())).toEqual({ '1': 1, '2': 1, '3': 1, X: 1 });
    // A revealed marker is never an X.
    expect(proj.cards.flatMap(c => c.orderMarkers).some(m => m.revealed && m.marker === 'X')).toBe(false);

    // After card destruction: the Marro card (holding Bob's unrevealed 2 and
    // 3) is wiped out — its markers must STAY hidden in Alice's projection.
    for (let n = 1; n <= 4; n++) s = place(s, MARRO(n), null);
    proj = projectStateForViewer(s, 'p1');
    expect(markerBytes(bobCards())).toEqual({ '1': 1, '2': 0, '3': 0, X: 0 });
    expect(
      proj.cards
        .find(c => c.uid === 's1-marro_warriors')!
        .orderMarkers.every(m => m.marker === 'hidden' && !m.revealed),
    ).toBe(true);

    // And in finished: Alice destroys Thorgrim (Bob's last figure) — even
    // with the battle over, Bob's unrevealed markers never decode.
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' })); // Bob's turn 1 → Alice's turn 1
    s = place(s, THORGRIM, at(3, 1));
    s = wound(s, THORGRIM, 3);
    s = unwrap(
      applyAction(s, 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kbb'),
        defenseRoll: F('bbbb'),
      }),
    );
    expect(s.phase).toBe('finished');
    proj = projectStateForViewer(s, 'p1');
    expect(markerBytes(bobCards())).toEqual({ '1': 1, '2': 0, '3': 0, X: 0 });
    expect(markerBytes(restOfState())).toEqual({ '1': 1, '2': 1, '3': 1, X: 1 });
    expect(markerBytes(projectStateForViewer(s, null)).X).toBe(0); // no X byte for spectators either
  });

  it('does not mutate the input state', () => {
    const s = bothPlaced();
    const before = JSON.stringify(s);
    projectStateForViewer(s, 'p1');
    projectStateForViewer(s, null);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 8. Elimination, win, history gate
// ---------------------------------------------------------------------------

describe('elimination and history', () => {
  function lastEnemyStanding(): HSState {
    let s = inTurns('p1', { p1: 's0-finn' });
    // Only Thorgrim remains for p2, adjacent to Finn and one wound from death.
    for (let n = 1; n <= 4; n++) s = place(s, MARRO(n), null);
    s = place(s, THORGRIM, at(3, 1));
    return wound(s, THORGRIM, 3);
  }

  it('destroying the last enemy figure finishes the game with a winner', () => {
    const s = unwrap(
      applyAction(lastEnemyStanding(), 'p1', {
        kind: 'attack',
        attackerId: FINN,
        targetId: THORGRIM,
        attackRoll: F('kbb'),
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
    expect(computeHistory(started())).toBeNull(); // place_markers
    expect(computeHistory(bothPlaced())).toBeNull(); // ready, pre-initiative
    let s = inTurns('p1', { p1: 's0-finn' });
    expect(computeHistory(s)).toBeNull(); // mid-turn
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
  it('legalTargets is empty out of turn, off the revealed card, and from spawn', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    // p2's marro can't act on p1's turn.
    expect(legalTargets(s, MARRO(1))).toEqual([]);
    // From its spawn row every p1 figure is 7+ spaces away (Range 6).
    const s2 = inTurns('p2', { p2: 's1-marro_warriors' });
    expect(legalTargets(s2, MARRO(1))).toEqual([]);
    // Melee figure with no adjacent enemy has no targets.
    expect(legalTargets(s, FINN)).toEqual([]);
    // A figure on a non-revealed card has none either.
    expect(legalTargets(s, TARN(1))).toEqual([]);
  });

  it('legalTargets lists in-range, in-sight enemies only', () => {
    let s = inTurns('p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(3, 6)); // 6 spaces from Finn
    const targets = legalTargets(s, MARRO(1));
    expect(targets).toContain(FINN);
    expect(targets).not.toContain(THORGRIM); // never your own figure
    for (const id of targets) expect(fig(s, id).ownerSeat).toBe(0);
  });

  it('legalDestinations is empty for the opponent, off-card figures, and spent movers', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
    expect(legalDestinations(s, MARRO(1)).size).toBe(0);
    expect(legalDestinations(s, TARN(1)).size).toBe(0); // not the revealed card
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect(legalDestinations(s, FINN).size).toBe(0); // already moved
    expect(legalDestinations(started(), FINN).size).toBe(0); // placing markers
  });
});
