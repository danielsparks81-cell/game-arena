import { describe, it, expect, beforeAll } from 'vitest';
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
  heightAdvantage,
  moveConsequences,
} from './engine';
import { hexKey, offsetToAxial } from './board';
import { MAPS, parseMap } from './maps';
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

/** start_game on a chosen battlefield (map picked by the host). */
function startedOn(mapId: string): HSState {
  return unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mapId }));
}

/** Battle staged into 'turns' on a chosen map, both stacking on one card. */
function inTurnsOn(
  mapId: string,
  first: 'p1' | 'p2' = 'p1',
  cards: { p1?: string; p2?: string } = {},
): HSState {
  let s = startedOn(mapId);
  s = placed(s, 'p1', allOn(cards.p1 ?? 's0-finn'));
  s = placed(s, 'p2', allOn(cards.p2 ?? 's1-thorgrim'));
  return unwrap(
    applyAction(s, 'p2', {
      kind: 'roll_initiative',
      attempts: [first === 'p1' ? ATT(15, 3) : ATT(3, 15)],
    }),
  );
}

/** A purpose-built test map with deep cliff pillars (heights 5/15/25) adjacent
 *  to height-1 grass, so a normal Height-4 Marro can prove every fall band by
 *  being teleported atop a pillar and stepping down one space (free descent —
 *  no climb limit blocks a descent). Registered into MAPS (a mutable record)
 *  for the test process only; production maps are untouched. */
const CLIFF_MAP_ID = 'test_cliffs';
beforeAll(() => {
  MAPS[CLIFF_MAP_ID] = parseMap(
    CLIFF_MAP_ID,
    'Test Cliffs',
    `
    row1@1: G1 G1  G1 G1  G1 G1 G1
    row2:   R5 G1  R15 G1 R25 G1 G1
    row3:   G1 G1  G1 G1  G1 G1 G1
    row4:   G1 G1  G1 G1  G1 G1 G1
    row5:   G1 G1  G1 G1  G1 G1 G1
    row6:   G1 G1  G1 G1  G1 G1 G1
    row7@2: G1 G1  G1 G1  G1 G1 G1
    `,
  );
});

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

/** Test-only: remove every figure from the board EXCEPT the given ids — clears
 *  the start-zone clutter so an elevation/engagement scenario is isolated.
 *  Keep at least one figure per seat alive or the elimination check fires. */
function clearExcept(s: HSState, ...keep: string[]): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  const set = new Set(keep);
  for (const f of c.figures) if (!set.has(f.id)) f.at = null;
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
    // Spread the three figures so the blocker is NOT adjacent to the shooter
    // (otherwise the engagement rule, not LOS, would gate the attack): Marro at
    // offset (0,3), Finn at (4,3), blocker dead-center at (2,3) — two hexes
    // from each, squarely on the line.
    let s = inTurns('p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(0, 3));
    s = place(s, FINN, at(4, 3)); // 4 spaces away, within Range 6
    const blocked = place(s, TARN(1), at(2, 3)); // midpoint, on the line
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

  it('attackDiceRequirements reports printed Attack vs printed Defense (flat → no height bonus)', () => {
    const s = inTurns('p1');
    // Training Field is flat: the height bonus is 0 on both sides.
    expect(attackDiceRequirements(s, FINN, THORGRIM)).toEqual({
      attack: 3,
      defense: 4,
      heightBonusAttacker: 0,
      heightBonusDefender: 0,
    });
    expect(attackDiceRequirements(s, MARRO(1), FINN)).toEqual({
      attack: 2,
      defense: 4,
      heightBonusAttacker: 0,
      heightBonusDefender: 0,
    });
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

// ===========================================================================
// SLICE 3 — terrain depth
// ===========================================================================

// --- map selection ---------------------------------------------------------

describe('slice 3: map selection', () => {
  it('the host picks the battlefield at start_game; figures land in its zones', () => {
    const s = startedOn('the_knoll');
    expect(s.mapId).toBe('the_knoll');
    // 9-wide Knoll: hero centered at col 4 (zone[4]); squads flank.
    expect(fig(s, FINN).at).toBe(at(4, 0));
    expect(fig(s, THORGRIM).at).toBe(at(4, 7));
    // Cells carry heights 1-4 on this map.
    const heights = new Set(
      Object.values(MAPS['the_knoll'].cells).map(c => c.height),
    );
    expect([...heights].sort()).toEqual([1, 2, 3, 4]);
  });

  it('an unknown map id is rejected; default stays the Training Field', () => {
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', mapId: 'atlantis' }))).toMatch(
      /Unknown battlefield/,
    );
    expect(started().mapId).toBe('training_field'); // no mapId → default
  });
});

// --- movement cost / climb limit on a real hill ----------------------------

describe('slice 3: movement with elevation (The Knoll)', () => {
  it('climbing costs budget: a Move-5 figure crests only where the cost allows', () => {
    // Finn (Move 5) on grass at (0,3) [G1]. The east climb chain is
    // G1→G2(cost2)→R3(cost4)→R4(cost6). Finn can reach the R3 (cost 4) but not
    // the R4 summit (cost 6).
    let s = inTurnsOn('the_knoll', 'p1', { p1: 's0-finn' });
    s = place(s, FINN, at(0, 3));
    const dests = legalDestinations(s, FINN);
    expect(dests.has(at(1, 3))).toBe(true); // G2, cost 2
    expect(dests.has(at(2, 3))).toBe(true); // R3, cost 4
    expect(dests.has(at(3, 3))).toBe(false); // R4 summit, cost 6 > Move 5
  });

  it('descent is free: a figure on the summit can step far down for 1', () => {
    let s = inTurnsOn('the_knoll', 'p1', { p1: 's0-finn' });
    s = place(s, FINN, at(3, 3)); // R4 summit
    // The adjacent off-summit R3 (2,3) is one descent step (cost 1) — reachable
    // even though climbing back up would cost 2.
    expect(legalDestinations(s, FINN).has(at(2, 3))).toBe(true);
  });

  it('climb limit: a Height-4 Marro cannot scale a 4-level wall in one step', () => {
    // On Test Cliffs, the R5 pillar (0,1) rises 4 over its (1,1) grass
    // neighbour. A Marro (Height 4) standing on (1,1) may NOT step up onto it.
    let s = inTurnsOn(CLIFF_MAP_ID, 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(1, 1)); // grass beside the R5 pillar
    expect(legalDestinations(s, MARRO(1)).has(at(0, 1))).toBe(false); // rise 4 == Height
  });
});

// --- falling ---------------------------------------------------------------

describe('slice 3: falling (server-rolled, engine re-validates)', () => {
  // Marro Warrior, Height 4. Teleport onto a pillar, step down to the grass
  // beside it. Drop = pillar height − 1. Clear the board to just this Marro and
  // one enemy (Finn, parked far away) so no start-zone engagement adds a swipe.
  function onPillar(pillarCol: number): { s: HSState; from: string; to: string } {
    let s = inTurnsOn(CLIFF_MAP_ID, 'p2', { p2: 's1-marro_warriors' });
    s = clearExcept(s, MARRO(1), FINN);
    s = place(s, FINN, at(6, 6)); // far corner, never engaged
    const from = at(pillarCol, 1);
    const to = at(pillarCol + 1, 1);
    s = place(s, MARRO(1), from);
    return { s, from, to };
  }

  it('moveConsequences reports the right fall band for each drop', () => {
    const r5 = onPillar(0); // drop 4  → fall (1 die)
    expect(moveConsequences(r5.s, fig(r5.s, MARRO(1)), r5.to)).toMatchObject({ tier: 'fall', fallDice: 1 });
    const r15 = onPillar(2); // drop 14 → major (3 dice)
    expect(moveConsequences(r15.s, fig(r15.s, MARRO(1)), r15.to)).toMatchObject({ tier: 'major', fallDice: 3 });
    const r25 = onPillar(4); // drop 24 → extreme (d20)
    expect(moveConsequences(r25.s, fig(r25.s, MARRO(1)), r25.to)).toMatchObject({ tier: 'extreme', fallDice: 0 });
  });

  it('a Fall (drop ≥ Height) rolls 1 die — a skull wounds, a destroyed Life-1 dies', () => {
    const { s, to } = onPillar(0); // drop 4 ≥ Height 4
    // No skull → unharmed.
    const safe = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('b') }));
    expect(fig(safe, MARRO(1)).at).toBe(to);
    expect(fig(safe, MARRO(1)).wounds).toBe(0);
    // One skull → 1 wound → a Life-1 Marro is destroyed by the fall.
    const dead = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('k') }));
    expect(fig(dead, MARRO(1)).at).toBeNull();
    expect(dead.log.some(e => e.tag === 'fall' && /destroyed/.test(e.text))).toBe(true);
  });

  it('rejects a missing fall roll, an unneeded roll, and the wrong die count', () => {
    const { s, to } = onPillar(0); // a fall IS due (1 die)
    expect(errOf(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to }))).toMatch(
      /requires 1 combat die/,
    );
    expect(
      errOf(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('kk') })),
    ).toMatch(/requires 1 combat die/);
    // A flat move with a phantom fall roll is rejected (no fall is due).
    let flat = inTurnsOn(CLIFF_MAP_ID, 'p2', { p2: 's1-marro_warriors' });
    flat = place(flat, MARRO(1), at(5, 2)); // grass
    expect(
      errOf(applyAction(flat, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(5, 3), fallRoll: F('k') })),
    ).toMatch(/Unexpected fall dice/);
  });

  it('a Major Fall rolls 3 dice; wounds = skulls (capped at Life)', () => {
    const { s, to } = onPillar(2); // drop 14 → major
    expect(
      errOf(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('k') })),
    ).toMatch(/requires 3 combat die/); // must roll 3, not 1
    const hit = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('ksb') }));
    expect(fig(hit, MARRO(1)).at).toBeNull(); // 1 skull on a Life-1 figure → dead
  });

  it('an Extreme Fall uses a d20: 19-20 survives, 1-18 destroys (no wound dice)', () => {
    const { s, to } = onPillar(4); // drop 24 → extreme
    // Combat dice are rejected; the d20 is required.
    expect(
      errOf(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, fallRoll: F('k') })),
    ).toMatch(/Unexpected fall dice for an extreme fall/);
    expect(
      errOf(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, extremeFallD20: 21 })),
    ).toMatch(/d20 roll/);
    const survives = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, extremeFallD20: 20 }));
    expect(fig(survives, MARRO(1)).at).toBe(to);
    expect(fig(survives, MARRO(1)).wounds).toBe(0);
    const destroyed = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to, extremeFallD20: 7 }));
    expect(fig(destroyed, MARRO(1)).at).toBeNull();
  });

  it('NO fall when landing on water, from any height', () => {
    // Ford Crossing: a Finn (Height 5) teleported onto a height-2 grass bank
    // stepping into the adjacent height-1 water — drop 1, but water exempts the
    // fall regardless. (Even a deep drop onto water is exempt, proven by the
    // moveConsequences tier being 'none'.)
    let s = inTurnsOn('ford_crossing', 'p1', { p1: 's0-finn' });
    // (4,0) is G2 (bank); (4,1) is G2 too — find a water neighbour of a bank.
    // (3,2) is water W1; its neighbour (4,1) is G2 (height 2). Stand on (4,1),
    // step into the (3,2) water: drop 1, into water → no fall.
    s = place(s, FINN, at(4, 1));
    const cons = moveConsequences(s, fig(s, FINN), at(3, 2));
    expect(cons.tier).toBe('none');
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 2) }));
    expect(fig(moved, FINN).at).toBe(at(3, 2));
    expect(fig(moved, FINN).wounds).toBe(0);
  });
});

// --- water forced stop -----------------------------------------------------

describe('slice 3: water forced stop (Ford Crossing)', () => {
  it('the dry ford lets a figure cross; stepping into the river is a valid stop', () => {
    // Marro (Move 6) on the north bank at (4,1) [G2]. The ford column (col 4)
    // is dry grass straight across; the flanking river is water.
    let s = inTurnsOn('ford_crossing', 'p2', { p2: 's1-marro_warriors' });
    s = clearExcept(s, MARRO(1), FINN);
    s = place(s, FINN, at(0, 0));
    s = place(s, MARRO(1), at(4, 1));
    const dests = legalDestinations(s, MARRO(1));
    // Down the dry ford it can cross the whole river to the south bank.
    expect(dests.has(at(4, 5))).toBe(true); // ford continues onto grass
    // Stepping sideways off the bank into the river is a valid endpoint
    // (forced stop): (3,2) is the nearest water hex.
    expect(dests.has(at(3, 2))).toBe(true);
  });

  it('open water cannot be crossed in one move — only the ford reaches the far bank', () => {
    // Marro (Move 6) on the north bank at col 0 (offset (0,1)). Three water
    // rows separate it from the south bank at (0,5). Each water entry forces a
    // stop, so the far bank is UNREACHABLE this turn even with Move 6…
    let s = inTurnsOn('ford_crossing', 'p2', { p2: 's1-marro_warriors' });
    s = clearExcept(s, MARRO(1), FINN);
    s = place(s, FINN, at(9, 6)); // far corner
    s = place(s, MARRO(1), at(0, 1));
    const dests = legalDestinations(s, MARRO(1));
    expect(MAPS['ford_crossing'].cells[at(0, 2)].terrain).toBe('water');
    expect(dests.has(at(0, 2))).toBe(true); // wades one hex into the river, stops
    expect(dests.has(at(0, 5))).toBe(false); // can't reach the far bank across water
  });
});

// --- engagement + leaving-engagement swipes --------------------------------

describe('slice 3: engagement & leaving-engagement swipes', () => {
  it('an engaged figure may attack only the enemy it is engaged with', () => {
    // p2's Marro (Range 6) is engaged with one enemy (Finn, adjacent) while a
    // SECOND enemy (a Tarn Viking) stands in range + clear LOS but not adjacent.
    // The engagement rule forbids shooting the Tarn past the engagement.
    let s = inTurnsOn('training_field', 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(3, 3));
    s = place(s, FINN, at(3, 2)); // adjacent → engages the Marro
    s = place(s, TARN(1), at(3, 5)); // a second enemy, 2 spaces off, not engaged
    // Move every other p1 figure off the board so only Finn + this Tarn remain
    // as candidate targets.
    for (let n = 2; n <= 4; n++) s = place(s, TARN(n), null);
    expect(legalTargets(s, MARRO(1))).toEqual([FINN]); // only the engaged enemy
    expect(
      errOf(
        applyAction(s, 'p2', {
          kind: 'attack',
          attackerId: MARRO(1),
          targetId: TARN(1),
          attackRoll: F('kk'),
          defenseRoll: F('sss'),
        }),
      ),
    ).toMatch(/only attack a figure you are engaged with/);
  });

  it('leaving an engagement: each abandoned enemy rolls 1 swipe die', () => {
    // Flat Training Field: a Tarn squad figure flanked by two Marro, walks free.
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, TARN(1), at(3, 3)); // axial (2,3)
    s = place(s, MARRO(1), at(3, 2)); // axial (2,2), adjacent → engaged
    s = place(s, MARRO(2), at(2, 3)); // axial (1,3), adjacent → engaged
    // Step east to (4,3) [axial (3,3)] — adjacent to NEITHER Marro (both 2 away).
    const dest = at(4, 3);
    const cons = moveConsequences(s, fig(s, TARN(1)), dest);
    expect(new Set(cons.abandonedEnemyIds)).toEqual(new Set([MARRO(1), MARRO(2)]));
    // Server must supply exactly those two swipes.
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: dest }))).toMatch(
      /do not match the abandoned enemies/,
    );
    // Both miss → the Tarn lives and reaches the destination.
    const safe = unwrap(
      applyAction(s, 'p1', {
        kind: 'move_figure',
        figureId: TARN(1),
        to: dest,
        leaveRolls: [
          { enemyFigureId: MARRO(1), roll: 'blank' },
          { enemyFigureId: MARRO(2), roll: 'blank' },
        ],
      }),
    );
    expect(fig(safe, TARN(1)).at).toBe(dest);
    expect(fig(safe, TARN(1)).wounds).toBe(0);
  });

  it('a swipe skull is an unblockable wound that can destroy the mover mid-move', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, TARN(1), at(3, 3));
    s = place(s, MARRO(1), at(3, 2)); // one engaged enemy
    const dest = at(3, 4);
    const dead = unwrap(
      applyAction(s, 'p1', {
        kind: 'move_figure',
        figureId: TARN(1),
        to: dest,
        leaveRolls: [{ enemyFigureId: MARRO(1), roll: 'skull' }],
      }),
    );
    expect(fig(dead, TARN(1)).at).toBeNull(); // Life-1 Tarn dies to the swipe
    expect(dead.log.some(e => e.tag === 'fall' && /leaving-engagement/.test(e.text))).toBe(true);
  });

  it('moving while staying adjacent to the enemy triggers NO swipe', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, TARN(1), at(3, 3));
    s = place(s, MARRO(1), at(3, 2)); // engaged
    // (2,3) and (3,3) are both adjacent to (3,2)? (3,3)'s and (2,3)'s adjacency
    // to (3,2): move to a DIFFERENT hex still adjacent to the Marro.
    const stillAdj = at(2, 2); // verify it's adjacent to the Marro at (3,2)
    const cons = moveConsequences(s, fig(s, TARN(1)), stillAdj);
    expect(cons.abandonedEnemyIds).toEqual([]); // no enemy abandoned
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: stillAdj }));
    expect(fig(moved, TARN(1)).at).toBe(stillAdj);
  });

  it('a sufficient height gap breaks engagement (Example 14): no swipe leaving a non-engaged enemy', () => {
    // Test Cliffs: a Tarn Viking (Height 5, enemy) stands on the R5 pillar
    // (h5); a Marro (Height 4) sits on the adjacent grass (h1). Gap 4 ≥ the
    // LOWER figure's Height 4 → NOT engaged (Example 14 boundary). The Marro
    // moving away therefore abandons NO enemy and needs no swipe rolls.
    let s = inTurnsOn(CLIFF_MAP_ID, 'p2', { p2: 's1-marro_warriors' });
    s = clearExcept(s, TARN(1), MARRO(1)); // isolate the pair from the start zones
    s = place(s, TARN(1), at(0, 1)); // p1's Tarn on the R5 pillar
    s = place(s, MARRO(1), at(1, 1)); // p2's Marro on the grass beside it
    // Geometry: the pair is NOT engaged (gap 4, lower Height 4).
    const cons = moveConsequences(s, fig(s, MARRO(1)), at(1, 2));
    expect(cons.abandonedEnemyIds).toEqual([]);
    // The move succeeds with no leaveRolls (no swipe was due).
    const moved = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(1, 2) }));
    expect(fig(moved, MARRO(1)).at).toBe(at(1, 2));
    expect(fig(moved, MARRO(1)).wounds).toBe(0);
  });
});

// --- height advantage (single source of truth) -----------------------------

describe('slice 3: height advantage', () => {
  it('a higher attacker rolls +1 attack die in requirements AND in resolution', () => {
    // Knoll summit (3,3) R4 (h4) vs a defender on grass (3,1) ... pick adjacent
    // cells at different heights within melee range. Finn on R4 summit, an
    // enemy Marro on the adjacent R3 (2,3 h3): attacker higher by 1 level.
    let s = inTurnsOn('the_knoll', 'p1', { p1: 's0-finn' });
    s = place(s, FINN, at(3, 3)); // R4 (height 4)
    s = place(s, MARRO(1), at(2, 3)); // R3 (height 3), adjacent
    const req = attackDiceRequirements(s, FINN, MARRO(1))!;
    expect(req).toMatchObject({ attack: 4, heightBonusAttacker: 1, heightBonusDefender: 0 }); // Finn Attack 3 + 1
    expect(heightAdvantage(s, fig(s, FINN), fig(s, MARRO(1)))).toEqual({ attacker: 1, defender: 0 });
    // Resolution must accept exactly 4 attack dice (and reject 3).
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: MARRO(1), attackRoll: F('kkk'), defenseRoll: F('sss') })),
    ).toMatch(/Malformed attack roll/);
    const hit = unwrap(
      applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: MARRO(1), attackRoll: F('kbbb'), defenseRoll: F('sss') }),
    );
    expect(hit.lastAttack).toMatchObject({ heightBonusAttacker: 1, heightBonusDefender: 0 });
  });

  it('a higher defender rolls +1 defense die', () => {
    // Reverse: Marro (low, attacking) vs Finn on the summit (higher defender).
    let s = inTurnsOn('the_knoll', 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(2, 3)); // R3 (height 3)
    s = place(s, FINN, at(3, 3)); // R4 (height 4) — defender higher
    const req = attackDiceRequirements(s, MARRO(1), FINN)!;
    expect(req).toMatchObject({ attack: 2, defense: 5, heightBonusDefender: 1 }); // Finn Defense 4 + 1
    const r = unwrap(
      applyAction(s, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kk'), defenseRoll: F('sssss') }),
    );
    expect(r.lastAttack).toMatchObject({ heightBonusDefender: 1 });
  });

  it('equal base elevation gives no bonus', () => {
    // Two figures on the flat grass skirt at height 1.
    let s = inTurnsOn('the_knoll', 'p1', { p1: 's0-finn' });
    s = place(s, FINN, at(0, 0)); // G1
    s = place(s, MARRO(1), at(1, 0)); // G1, adjacent
    expect(heightAdvantage(s, fig(s, FINN), fig(s, MARRO(1)))).toEqual({ attacker: 0, defender: 0 });
    expect(attackDiceRequirements(s, FINN, MARRO(1))).toMatchObject({ attack: 3, defense: 3 });
  });

  it('the +2 band fires when the higher base is ≥ 10 above the lower figure Height', () => {
    // Test Cliffs: Marro (Height 4) on the R15 pillar (h15) vs an enemy on the
    // adjacent grass (h1). 15 ≥ 10 + lower Height. Use the pure helper (the
    // band never fires on the slice-3 production maps).
    let s = inTurnsOn(CLIFF_MAP_ID, 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(2, 1)); // R15
    s = place(s, FINN, at(3, 1)); // grass (height 1), Finn Height 5
    // Attacker (Marro) base 15 ≥ 10 + defender Finn Height 5 (=15) → +2.
    expect(heightAdvantage(s, fig(s, MARRO(1)), fig(s, FINN))).toEqual({ attacker: 2, defender: 0 });
    expect(attackDiceRequirements(s, MARRO(1), FINN)).toMatchObject({ attack: 4, heightBonusAttacker: 2 }); // 2 + 2
  });
});

// --- elevation-aware LOS through the engine --------------------------------

describe('slice 3: elevation LOS (The Knoll)', () => {
  it('the central rock hill blocks a ground-level shot across it', () => {
    // A Marro on the west shoulder (1,3) G2 and Finn on the east shoulder
    // (7,3) G2 — both height 2, with the R3/R4 summit sitting on the line
    // between them. The tall column out-tops the height-3 eye line and blocks.
    let s = inTurnsOn('the_knoll', 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(1, 3)); // G2 (height 2)
    s = place(s, FINN, at(7, 3)); // G2 (height 2)
    expect(legalTargets(s, MARRO(1))).not.toContain(FINN);
  });

  it('a figure on the summit sees a figure on the open skirt below', () => {
    let s = inTurnsOn('the_knoll', 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(4, 3)); // R4 summit (height 4)
    s = place(s, FINN, at(4, 6)); // G2/G1 skirt to the south, within Range 6
    // From the summit the sightline slopes down over the lower hill — clear.
    expect(legalTargets(s, MARRO(1))).toContain(FINN);
  });
});
