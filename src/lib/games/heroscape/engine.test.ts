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
  effectiveAttackDice,
  effectiveDefenseDice,
  effectiveMove,
  effectiveRange,
  moveConsequences,
  placeableHexes,
  POINT_BUDGETS,
} from './engine';
import { hexKey, offsetToAxial } from './board';
import { MAPS, parseMap } from './maps';
import { HS_CARDS, HS_DRAFT_POOL } from './content';
import type {
  CombatFace,
  HSGlyph,
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

/** start_game in QUICK mode → fixed armies auto-placed → round 1, place_markers.
 *  (Default mode is now 'draft' — slice 5 — so the slice-2/3/4 fixed-army tests
 *  explicitly request quick, which reproduces the slice-4 experience exactly.) */
function started(): HSState {
  return unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'quick' }));
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

/** start_game (QUICK mode) on a chosen battlefield (map picked by the host). */
function startedOn(mapId: string): HSState {
  return unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mapId, mode: 'quick' }));
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

/** Test-only: set the battlefield's glyphs to exactly `glyphs`. Replaces any
 *  map-seeded glyphs so a scenario is isolated. */
function setGlyphs(s: HSState, glyphs: HSGlyph[]): HSState {
  const c: HSState = JSON.parse(JSON.stringify(s));
  c.glyphs = glyphs.map(g => ({ ...g }));
  return c;
}

/** Test-only: clear all map-seeded glyphs (so spawn-row figures never sit on one
 *  and the slice-3 assertions stay glyph-free). */
function noGlyphs(s: HSState): HSState {
  return setGlyphs(s, []);
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
    s = place(s, FINN, null); // remove Finn so his Attack Aura doesn't buff the Tarn (slice 4)
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
    s = place(s, FINN, null); // remove Finn so his Attack Aura doesn't buff the Tarn (slice 4)
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
    // Training Field is flat and the combatants are at their spawn rows (no
    // adjacency, no glyphs): the height bonus and every aura/glyph are 0.
    expect(attackDiceRequirements(s, FINN, THORGRIM)).toMatchObject({
      attack: 3,
      defense: 4,
      heightBonusAttacker: 0,
      heightBonusDefender: 0,
    });
    expect(attackDiceRequirements(s, MARRO(1), FINN)).toMatchObject({
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

// ===========================================================================
// SLICE 4 — glyphs + special powers (cards.md / 05-glyphs-special-powers.md)
// ===========================================================================

// Each map now seeds glyphs; strip them in the cases that assert on bare
// printed stats so a spawn-row figure never accidentally stands on one.

// --- Finn's ATTACK AURA 1 (NORMAL attack, printed Range 1, adjacent) ---------

describe('slice 4: Finn Attack Aura 1', () => {
  it('a Range-1 friendly ADJACENT to Finn rolls +1 attack die', () => {
    // Tarn (printed Range 1) beside friendly Finn → +1 attack die.
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, FINN, TARN(1), THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = place(s, TARN(1), at(3, 4)); // adjacent to Finn
    s = place(s, THORGRIM, at(3, 5)); // an enemy adjacent to the Tarn
    const eff = effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM));
    expect(eff.dice).toBe(4); // Tarn Attack 3 + 1 Finn aura
    expect(eff.breakdown).toContain('+1 Finn aura');
    // Folds through attackDiceRequirements → resolution requires 4 attack dice.
    expect(attackDiceRequirements(s, TARN(1), THORGRIM)!.attack).toBe(4);
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: TARN(1), targetId: THORGRIM, attackRoll: F('kkk'), defenseRoll: F('ssss') })),
    ).toMatch(/Malformed attack roll/);
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: TARN(1), targetId: THORGRIM, attackRoll: F('kkkb'), defenseRoll: F('ssss') }));
    expect(hit.lastAttack!.breakdown).toContain('+1 Finn aura');
  });

  it('does NOT apply when the friendly is not adjacent to Finn', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, FINN, TARN(1), THORGRIM);
    s = place(s, FINN, at(0, 0)); // far from the Tarn
    s = place(s, TARN(1), at(3, 4));
    s = place(s, THORGRIM, at(3, 5));
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM)).dice).toBe(3); // no aura
    expect(attackDiceRequirements(s, TARN(1), THORGRIM)!.attack).toBe(3);
  });

  it('does NOT apply to a friendly whose printed Range is > 1 (Marro)', () => {
    // Put a Marro next to a FRIENDLY Finn — but Marro/Finn are on opposite
    // seats by default, so build a same-seat pairing by moving a Marro onto
    // p1's side is impossible; instead verify the aura's Range gate directly:
    // a Marro (Range 6) adjacent to Finn would NOT qualify. Use p2's Marro next
    // to a p2-owned… Finn is p1 only. So assert via the helper on a constructed
    // adjacency where the would-be beneficiary has Range 6.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), FINN, THORGRIM);
    // Thorgrim (p2's? no — Thorgrim is p2). Marro + Thorgrim are both p2.
    s = place(s, THORGRIM, at(3, 3)); // stand a Thorgrim where Finn's aura can't reach (enemy anyway)
    s = place(s, MARRO(1), at(3, 4)); // Marro beside Thorgrim
    s = place(s, FINN, at(3, 5)); // enemy target, in range
    // Marro is Range 6 → even adjacent to a (hypothetical friendly) champion it
    // would not get Finn's Range-1-only aura. Here Finn is an ENEMY so the aura
    // never applies regardless; assert the printed 2 dice stand.
    expect(effectiveAttackDice(s, fig(s, MARRO(1)), fig(s, FINN)).dice).toBe(2);
  });

  it('Finn does not buff his own attack (no friendly Finn adjacent to himself)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = place(s, THORGRIM, at(3, 4)); // adjacent enemy
    expect(effectiveAttackDice(s, fig(s, FINN), fig(s, THORGRIM)).dice).toBe(3); // Finn Attack 3, no self-aura
  });

  it('does NOT apply on a SPECIAL attack (NORMAL attacks only)', () => {
    // Same adjacency that grants the aura on a normal attack, but the helper is
    // asked with isNormalAttack=false → no +1 (the special-attack gate; slice 5
    // special attacks will pass false here).
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, FINN, TARN(1), THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = place(s, TARN(1), at(3, 4));
    s = place(s, THORGRIM, at(3, 5));
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM), true).dice).toBe(4); // normal → +1
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM), false).dice).toBe(3); // special → no aura
  });

  it('the breakdown is just the printed line when nothing modifies it', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(0, 0));
    s = place(s, THORGRIM, at(6, 7));
    expect(effectiveAttackDice(s, fig(s, FINN), fig(s, THORGRIM)).breakdown).toEqual(['Attack 3 printed']);
    expect(effectiveDefenseDice(s, fig(s, THORGRIM), fig(s, FINN)).breakdown).toEqual(['Defense 4 printed']);
  });
});

// --- Thorgrim's DEFENSIVE AURA 1 (any adjacent friendly, no Range gate) -------

describe('slice 4: Thorgrim Defensive Aura 1', () => {
  it('any friendly ADJACENT to Thorgrim rolls +1 defense die', () => {
    // p2's Marro stands beside friendly Thorgrim; an enemy attacks it.
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = place(s, MARRO(1), at(3, 4)); // p2 Marro
    s = place(s, THORGRIM, at(3, 5)); // p2 Thorgrim adjacent → +1 def to the Marro
    s = place(s, FINN, at(3, 3)); // p1 attacker adjacent to the Marro
    const eff = effectiveDefenseDice(s, fig(s, MARRO(1)), fig(s, FINN));
    expect(eff.dice).toBe(4); // Marro Defense 3 + 1 Thorgrim aura
    expect(eff.breakdown).toContain('+1 Thorgrim aura');
    // Resolution rolls 4 defense dice for the Marro.
    expect(attackDiceRequirements(s, FINN, MARRO(1))!.defense).toBe(4);
    const r = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: MARRO(1), attackRoll: F('kkk'), defenseRoll: F('ssss') }));
    expect(r.lastAttack!.breakdown).toContain('+1 Thorgrim aura');
  });

  it('does NOT apply to a non-adjacent friendly', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = place(s, MARRO(1), at(3, 4));
    s = place(s, THORGRIM, at(0, 0)); // far away
    s = place(s, FINN, at(3, 3));
    expect(effectiveDefenseDice(s, fig(s, MARRO(1)), fig(s, FINN)).dice).toBe(3); // no aura
  });

  it('Thorgrim does not buff his own defense', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = place(s, THORGRIM, at(3, 4)); // adjacent enemy champion
    expect(effectiveDefenseDice(s, fig(s, THORGRIM), fig(s, FINN)).dice).toBe(4); // Thorgrim Def 4, no self-aura
  });
});

// --- Warrior's Attack/Armor Spirit on destroy (PendingChoice) -----------------

describe('slice 4: Warrior Spirits on destroy', () => {
  /** Stage: p1's Finn one wound from death, p2's Marro adjacent, p2 to act. */
  function finnAtDeath(): HSState {
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, TARN(1), MARRO(1), THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = wound(s, FINN, 3); // Life 4 → one hit kills
    s = place(s, MARRO(1), at(3, 4)); // adjacent attacker
    // keep a Tarn alive elsewhere so destroying Finn does NOT end the game
    s = place(s, TARN(1), at(0, 0));
    s = place(s, THORGRIM, at(6, 6));
    return s;
  }

  it('destroying Finn opens a spirit_placement choice owned by Finn’s owner', () => {
    const before = finnAtDeath();
    const s = unwrap(applyAction(before, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    expect(fig(s, FINN).at).toBeNull();
    expect(s.phase).toBe('playing'); // a Tarn survives → game continues
    expect(s.pendingChoice).toMatchObject({ kind: 'spirit_placement', seat: 0, spirit: 'attack' });
    // The choice belongs to p1 (Finn's owner), even though p2's attack caused it.
    expect(getActivePlayerId(s)).toBe('p1');
    // p2 cannot act while p1's choice is open; p1 must resolve it.
    expect(errOf(applyAction(s, 'p2', { kind: 'end_turn' }))).toMatch(/pending choice/i);
    expect(errOf(applyAction(s, 'p1', { kind: 'end_turn' }))).toMatch(/Resolve your pending choice/);
  });

  it('placing the Attack Spirit gives the chosen card +1 attack permanently', () => {
    let s = unwrap(applyAction(finnAtDeath(), 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    const opts = (s.pendingChoice as { options: string[] }).options;
    expect(opts).toContain('s0-tarn_vikings');
    // p1 places it on their Tarn squad.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: 's0-tarn_vikings' } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.cards.find(c => c.uid === 's0-tarn_vikings')!.attackMod).toBe(1);
    // It shows up in effectiveAttackDice for a Tarn.
    s = place(s, TARN(1), at(3, 3));
    s = place(s, THORGRIM, at(3, 4));
    const eff = effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM));
    expect(eff.dice).toBe(4); // 3 printed + 1 Spirit
    expect(eff.breakdown).toContain('+1 Attack Spirit');
  });

  it('destroying Thorgrim opens an armor spirit → +1 defense on the chosen card', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = place(s, THORGRIM, at(3, 4));
    s = wound(s, THORGRIM, 3);
    s = place(s, FINN, at(3, 3)); // p1 attacker
    s = place(s, MARRO(1), at(0, 0)); // a p2 Marro survives → game continues
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: THORGRIM, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(s.pendingChoice).toMatchObject({ kind: 'spirit_placement', seat: 1, spirit: 'defense' });
    // p2 (Thorgrim's owner) places it on the Marro card.
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: 's1-marro_warriors' } }));
    expect(s.cards.find(c => c.uid === 's1-marro_warriors')!.defenseMod).toBe(1);
  });

  it('the Spirit is SKIPPED when the destruction ends the game', () => {
    // Finn is p2's LAST figure; destroying him wins — no Spirit prompt.
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    // Make Thorgrim p2's only figure, at death, and Finn the p1 attacker.
    s = place(s, THORGRIM, at(3, 4));
    s = wound(s, THORGRIM, 3);
    s = place(s, FINN, at(3, 3));
    const s2 = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: THORGRIM, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(s2.phase).toBe('finished');
    expect(s2.winnerSeat).toBe(0);
    expect(s2.pendingChoice).toBeUndefined(); // finish takes precedence
  });
});

// --- Tarn BERSERKER CHARGE (d20, optional re-move) ---------------------------

describe('slice 4: Berserker Charge', () => {
  /** A Tarn turn with one Tarn moved (so the after-move window is open). */
  function movedTarn(): HSState {
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 1) }));
    return s;
  }

  it('15+ opens a re-move choice; resolving with remove:true re-grants Tarn movement', () => {
    let s = movedTarn();
    expect(s.movedFigureIds).toContain(TARN(1));
    s = unwrap(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 15 }));
    expect(s.pendingChoice).toMatchObject({ kind: 'berserker_charge', seat: 0 });
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'berserker_charge', remove: true } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.movedFigureIds).not.toContain(TARN(1)); // may move again
    expect(legalDestinations(s, TARN(1)).size).toBeGreaterThan(0);
  });

  it('<15 spends the charge for the turn (no re-roll)', () => {
    let s = movedTarn();
    s = unwrap(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 14 }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.berserkerSpent).toBe(true);
    expect(errOf(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 20 }))).toMatch(/spent/);
  });

  it('declining the re-move (remove:false) is legal and leaves movement spent', () => {
    let s = movedTarn();
    s = unwrap(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 18 }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'berserker_charge', remove: false } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.movedFigureIds).toContain(TARN(1)); // still spent — declined
  });

  it('charge can chain: re-move, then charge again', () => {
    let s = movedTarn();
    s = unwrap(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 16 }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'berserker_charge', remove: true } }));
    // Move again, then a SECOND charge is allowed (no printed repeat limit).
    s = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: at(1, 2) }));
    s = unwrap(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 20 }));
    expect(s.pendingChoice).toMatchObject({ kind: 'berserker_charge' });
  });

  it('rejects charging before moving, after attacking, and from the wrong card', () => {
    // Before moving.
    const fresh = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    expect(errOf(applyAction(fresh, 'p1', { kind: 'berserker_charge', d20: 18 }))).toMatch(/before charging/);
    // Wrong card (Finn turn).
    const finnTurn = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    expect(errOf(applyAction(finnTurn, 'p1', { kind: 'berserker_charge', d20: 18 }))).toMatch(/Only Tarn/);
    // After attacking: stage an attack first.
    let atk = movedTarn();
    atk = place(atk, THORGRIM, at(1, 2)); // adjacent to the Tarn at (1,1)
    atk = place(atk, FINN, null); // avoid Finn's aura changing the dice count
    atk = unwrap(applyAction(atk, 'p1', { kind: 'attack', attackerId: TARN(1), targetId: THORGRIM, attackRoll: F('bbb'), defenseRoll: F('ssss') }));
    expect(errOf(applyAction(atk, 'p1', { kind: 'berserker_charge', d20: 20 }))).toMatch(/BEFORE attacking/);
  });

  it('rejects an out-of-range d20', () => {
    const s = movedTarn();
    expect(errOf(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 21 }))).toMatch(/d20 roll/);
    expect(errOf(applyAction(s, 'p1', { kind: 'berserker_charge', d20: 0 }))).toMatch(/d20 roll/);
  });
});

// --- Marro WATER CLONE (d20, instead of attacking, after moving) -------------

describe('slice 4: Water Clone', () => {
  /** A Marro turn with one Marro destroyed (available to return) and one Marro
   *  moved (so the after-move window is open). Two living Marro on flat grass. */
  function stagedMarro(): HSState {
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), FINN);
    s = place(s, MARRO(3), null); // destroyed → available to clone back
    s = place(s, MARRO(1), at(3, 3));
    s = place(s, MARRO(2), at(0, 0));
    s = place(s, FINN, at(6, 6)); // an enemy survives
    // Move one Marro so "only after you move" is satisfied.
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(3, 4) }));
    return s;
  }

  it('15+ returns a destroyed Marro to a same-level adjacent space via PendingChoice', () => {
    let s = stagedMarro();
    // Two living Marro: MARRO(1) at (3,4) rolls 15 (success), MARRO(2) rolls 3.
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 15 },
      { marroFigureId: MARRO(2), d20: 3 },
    ] }));
    expect(s.waterClonedThisTurn).toBe(true);
    expect(s.pendingChoice).toMatchObject({ kind: 'water_clone_place', seat: 1 });
    const pc = s.pendingChoice as { placements: { options: string[] }[] };
    expect(pc.placements).toHaveLength(1); // one success with a clone + space
    const hex = pc.placements[0].options[0];
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(fig(s, MARRO(3)).at).toBe(hex); // the destroyed Marro is back
    expect(fig(s, MARRO(3)).wounds).toBe(0);
  });

  it('consumes the attack: cannot attack after Water Cloning', () => {
    let s = stagedMarro();
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 3 }, // all miss → no placement choice
      { marroFigureId: MARRO(2), d20: 3 },
    ] }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.waterClonedThisTurn).toBe(true);
    // An attack is now blocked (the card's attack was spent).
    const sNear = place(s, FINN, at(3, 5)); // put Finn in range of MARRO(1) at (3,4)
    expect(errOf(applyAction(sNear, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kk'), defenseRoll: F('sssss') }))).toMatch(/already attacked/);
    // …and a second Water Clone is rejected.
    expect(errOf(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 15 },
      { marroFigureId: MARRO(2), d20: 15 },
    ] }))).toMatch(/already Water Cloned/);
  });

  it('a Marro on a WATER space succeeds on 10+ (not 15)', () => {
    let s = noGlyphs(inTurnsOn('ford_crossing', 'p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), FINN);
    s = place(s, MARRO(3), null); // destroyed
    // MARRO(1) on a water hex (0,2) [river]; MARRO(2) on dry grass.
    expect(MAPS['ford_crossing'].cells[at(0, 2)].terrain).toBe('water');
    s = place(s, MARRO(1), at(0, 2));
    s = place(s, MARRO(2), at(4, 0));
    s = place(s, FINN, at(9, 6));
    // satisfy "after you move" by moving MARRO(2).
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(2), to: at(4, 1) }));
    // MARRO(1) on water rolls 10 → success (10+); MARRO(2) on grass rolls 10 → FAIL (needs 15).
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 10 },
      { marroFigureId: MARRO(2), d20: 10 },
    ] }));
    const pc = s.pendingChoice as { placements: { rollerFigureId: string }[] } | undefined;
    expect(pc).toBeDefined();
    expect(pc!.placements).toHaveLength(1);
    expect(pc!.placements[0].rollerFigureId).toBe(MARRO(1)); // only the water Marro succeeded
  });

  it('a success with NO destroyed Marro to return is auto-skipped (no placement)', () => {
    // All FOUR Marro alive (none destroyed → nothing to clone back). Keep an
    // enemy alive elsewhere. Two succeed but cannot place.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), MARRO(4), FINN);
    s = place(s, MARRO(1), at(3, 3));
    s = place(s, MARRO(2), at(0, 0));
    s = place(s, MARRO(3), at(5, 5));
    s = place(s, MARRO(4), at(5, 6));
    s = place(s, FINN, at(6, 6));
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(3, 4) }));
    // One per living Marro (4 alive); two succeed but nothing to return.
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 20 },
      { marroFigureId: MARRO(2), d20: 20 },
      { marroFigureId: MARRO(3), d20: 3 },
      { marroFigureId: MARRO(4), d20: 3 },
    ] }));
    expect(s.waterClonedThisTurn).toBe(true);
    expect(s.pendingChoice).toBeUndefined(); // no destroyed Marro to return
  });

  it('two successes return two clones via successive placements (no double-landing)', () => {
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), MARRO(4), FINN);
    s = place(s, MARRO(3), null); // two destroyed → two available to return
    s = place(s, MARRO(4), null);
    s = place(s, MARRO(1), at(3, 3));
    s = place(s, MARRO(2), at(5, 3));
    s = place(s, FINN, at(0, 0));
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(3, 4) }));
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 20 },
      { marroFigureId: MARRO(2), d20: 20 },
    ] }));
    let pc = s.pendingChoice as { placements: { options: string[] }[]; chosen: string[] };
    expect(pc.placements).toHaveLength(2); // two viable successes
    // Resolve the first landing.
    const hex0 = pc.placements[0].options[0];
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: hex0 } }));
    expect(s.pendingChoice).toBeDefined(); // a second placement remains
    pc = s.pendingChoice as { placements: { options: string[] }[]; chosen: string[] };
    expect(pc.chosen).toEqual([hex0]);
    // The second landing must differ from the first if they overlap.
    const hex1 = pc.placements[1].options.find(h => h !== hex0)!;
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: hex1 } }));
    expect(s.pendingChoice).toBeUndefined();
    // Both destroyed Marro are back, at distinct hexes.
    const back = [fig(s, MARRO(3)).at, fig(s, MARRO(4)).at];
    expect(back.every(h => h != null)).toBe(true);
    expect(new Set(back).size).toBe(2);
  });

  it('rejects landing on a hex already taken by an earlier clone this resolution', () => {
    // Two rollers flank a SHARED empty hex (4,4): MARRO(1) at (3,4) and MARRO(2)
    // at (5,4) are each adjacent to (4,4) on the flat field, so both placements
    // can land there. Two destroyed Marro are available to return.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), MARRO(4), FINN);
    s = place(s, MARRO(3), null); // destroyed → available
    s = place(s, MARRO(4), null); // destroyed → available
    s = place(s, MARRO(1), at(1, 4)); // start positions for the two rollers
    s = place(s, MARRO(2), at(5, 4));
    s = place(s, FINN, at(0, 0));
    // Satisfy "after you move" with a REAL move of MARRO(1), then teleport it to
    // (3,4) so both rollers flank the shared hex (4,4).
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(2, 4) }));
    s = place(s, MARRO(1), at(3, 4));
    const shared = at(4, 4);
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 20 },
      { marroFigureId: MARRO(2), d20: 20 },
    ] }));
    const pc = s.pendingChoice as { placements: { rollerFigureId: string; options: string[] }[] };
    expect(pc.placements).toHaveLength(2);
    // Both placements offer the shared hex (4,4).
    expect(pc.placements[0].options).toContain(shared);
    expect(pc.placements[1].options).toContain(shared);
    // Land the first clone on the shared hex.
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: shared } }));
    // The second clone may NOT reuse it.
    expect(errOf(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: shared } }))).toMatch(/same-level empty space/);
  });

  it('rejects cloning before moving, from the wrong card, and with a bad roll set', () => {
    // Before moving.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), FINN);
    s = place(s, FINN, at(6, 6));
    expect(errOf(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 20 }, { marroFigureId: MARRO(2), d20: 20 },
    ] }))).toMatch(/only Water Clone after you move/);
    // Wrong card.
    const finnTurn = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    expect(errOf(applyAction(finnTurn, 'p1', { kind: 'water_clone', rolls: [] }))).toMatch(/Only Marro/);
    // Wrong number of rolls (must be one per living Marro).
    const moved = stagedMarro();
    expect(errOf(applyAction(moved, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 20 },
    ] }))).toMatch(/exactly one d20 per living Marro/);
  });
});

// --- Glyphs: forced stop + each permanent glyph folds into its helper ---------

// Full-width start rows (≥5 hexes so the army places) joined by a 1-wide
// vertical corridor in column 2 — a glyph there is the SOLE path between the
// banks, proving the forced stop cannot be routed around.
const CORRIDOR_MAP_ID = 'test_corridor';
beforeAll(() => {
  MAPS[CORRIDOR_MAP_ID] = parseMap(
    CORRIDOR_MAP_ID,
    'Test Corridor',
    `
    row1@1: G1 G1 G1 G1 G1
    row2:   .  .  G1 .  .
    row3:   .  .  G1 .  .
    row4:   .  .  G1 .  .
    row5@2: G1 G1 G1 G1 G1
    `,
  );
});

describe('slice 4: glyph forced stop', () => {
  it('a figure that moves onto a glyph stops there and cannot pass through it', () => {
    // The 1-wide corridor is column 2. Finn (Move 5) at its north mouth (2,1),
    // a glyph on (2,2). The glyph is a valid endpoint but the hex BEYOND it
    // (2,3) is unreachable this move (the corridor offers no way around).
    let s = inTurnsOn(CORRIDOR_MAP_ID, 'p1', { p1: 's0-finn' });
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(2, 1));
    s = place(s, THORGRIM, at(0, 0)); // off in a start zone, out of the way
    const glyphHex = at(2, 2);
    const beyond = at(2, 3);
    s = setGlyphs(s, [{ id: 'astrid', at: glyphHex, faceUp: true }]);
    const dests = legalDestinations(s, FINN);
    expect(dests.has(glyphHex)).toBe(true); // valid endpoint (forced stop)
    expect(dests.has(beyond)).toBe(false); // cannot transit the glyph
    // And actually moving onto it ends there.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(fig(moved, FINN).at).toBe(glyphHex);
  });

  it('a deferred glyph (Erland) is inert: still a forced stop, no effect, not removed', () => {
    let s = inTurnsOn(CORRIDOR_MAP_ID, 'p1', { p1: 's0-finn' });
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(2, 1));
    s = place(s, THORGRIM, at(0, 0));
    const glyphHex = at(2, 2);
    s = setGlyphs(s, [{ id: 'erland', at: glyphHex, faceUp: true }]);
    // Forced stop applies to ANY glyph (the hex beyond is unreachable).
    expect(legalDestinations(s, FINN).has(at(2, 3))).toBe(false);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(fig(moved, FINN).at).toBe(glyphHex);
    // Inert: the glyph stays (not removed like a temporary that fired) and grants
    // nothing — Erland does not control anything for the effective-stat helpers.
    expect(moved.glyphs.find(g => g.id === 'erland')).toBeDefined();
    expect(moved.log.some(e => e.tag === 'glyph' && /no effect yet/.test(e.text))).toBe(true);
  });
});

describe('slice 4: permanent glyphs fold into the single-source helpers', () => {
  it('Astrid: +1 attack die while occupied, gone when vacated', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'astrid', at: glyphHex, faceUp: true }]);
    s = place(s, FINN, glyphHex); // p1 controls Astrid
    s = place(s, THORGRIM, at(3, 4));
    const eff = effectiveAttackDice(s, fig(s, FINN), fig(s, THORGRIM));
    expect(eff.dice).toBe(4); // Finn Attack 3 + 1 Astrid
    expect(eff.breakdown).toContain('+1 Astrid');
    // Step Finn off Astrid → bonus gone.
    const off = place(s, FINN, at(4, 4));
    expect(effectiveAttackDice(off, fig(off, FINN), fig(off, THORGRIM)).dice).toBe(3);
  });

  it('Gerda: +1 defense die while occupied', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    const glyphHex = at(3, 4);
    s = setGlyphs(s, [{ id: 'gerda', at: glyphHex, faceUp: true }]);
    s = place(s, MARRO(1), glyphHex); // p2 controls Gerda
    s = place(s, FINN, at(3, 3)); // p1 attacker adjacent
    s = place(s, THORGRIM, at(0, 0));
    expect(effectiveDefenseDice(s, fig(s, MARRO(1)), fig(s, FINN)).dice).toBe(4); // Marro Def 3 + 1 Gerda
  });

  it('Ivor: +4 Range for a Range≥4 figure, nothing for Range 1', () => {
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), FINN);
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'ivor', at: glyphHex, faceUp: true }]);
    s = place(s, MARRO(1), glyphHex); // Marro Range 6 → 10 while on Ivor
    s = place(s, FINN, at(0, 0));
    expect(effectiveRange(s, fig(s, MARRO(1))).dice).toBe(10);
    expect(effectiveRange(s, fig(s, MARRO(1))).breakdown).toContain('+4 Ivor');
    // A Range-1 Finn on Ivor gets nothing (threshold).
    let s2 = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s2 = setGlyphs(s2, [{ id: 'ivor', at: glyphHex, faceUp: true }]);
    s2 = place(s2, FINN, glyphHex);
    expect(effectiveRange(s2, fig(s2, FINN)).dice).toBe(1);
  });

  it('Valda: +2 Move for the army, but NOT the occupant moving off the glyph', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, TARN(1), TARN(2), THORGRIM);
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'valda', at: glyphHex, faceUp: true }]);
    s = place(s, TARN(1), glyphHex); // the occupant
    s = place(s, TARN(2), at(0, 3)); // a friendly OTHER figure
    s = place(s, THORGRIM, at(6, 6));
    // The OTHER Tarn gets +2 (Move 4 → 6).
    expect(effectiveMove(s, fig(s, TARN(2))).dice).toBe(6);
    expect(effectiveMove(s, fig(s, TARN(2))).breakdown).toContain('+2 Valda');
    // The OCCUPANT does NOT get the bonus on the move leaving the glyph (Move 4).
    expect(effectiveMove(s, fig(s, TARN(1))).dice).toBe(4);
  });

  it('Dagmar: the controller’s initiative carries +8 (server-applied, engine-validated)', () => {
    // Build a 'turns'-ready state on the Knoll with a Dagmar glyph p1 occupies.
    let s = noGlyphs(bothPlaced());
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'dagmar', at: glyphHex, faceUp: true }]);
    s = place(s, FINN, glyphHex); // p1 controls Dagmar
    // Server applies +8 to seat 0; engine validates raw+bonus=roll.
    const ok = unwrap(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: [
      [ { seat: 0, roll: 11, raw: 3, bonus: 8 }, { seat: 1, roll: 7 } ],
    ] }));
    expect(ok.initiative).toEqual([0, 1]); // 11 (=3+8) beats 7
    // Mismatched bonus is rejected (raw d20 of 3 must carry exactly the +8).
    expect(errOf(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: [
      [ { seat: 0, roll: 11, raw: 3, bonus: 0 }, { seat: 1, roll: 7 } ],
    ] }))).toMatch(/Malformed/);
    // A seat that does NOT control Dagmar may not claim a bonus.
    expect(errOf(applyAction(s, 'p2', { kind: 'roll_initiative', attempts: [
      [ { seat: 0, roll: 3 }, { seat: 1, roll: 15, raw: 7, bonus: 8 } ],
    ] }))).toMatch(/Malformed/);
  });
});

// --- Kelda (temporary healer) -------------------------------------------------

describe('slice 4: Kelda heals and is removed', () => {
  it('a wounded figure stops on Kelda, loses all wounds, and the glyph is removed', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    const keldaHex = at(3, 2);
    s = setGlyphs(s, [{ id: 'kelda', at: keldaHex, faceUp: true }]);
    s = place(s, FINN, at(3, 1));
    s = wound(s, FINN, 2); // wounded → may stop on Kelda
    s = place(s, THORGRIM, at(6, 6));
    expect(legalDestinations(s, FINN).has(keldaHex)).toBe(true);
    const healed = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: keldaHex }));
    expect(fig(healed, FINN).at).toBe(keldaHex);
    expect(fig(healed, FINN).wounds).toBe(0); // all wounds removed
    expect(healed.glyphs.find(g => g.id === 'kelda')).toBeUndefined(); // glyph gone
    expect(healed.log.some(e => e.tag === 'glyph' && /Kelda/.test(e.text))).toBe(true);
  });

  it('an UNWOUNDED figure may not stop on (or enter) Kelda', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    const keldaHex = at(3, 2);
    s = setGlyphs(s, [{ id: 'kelda', at: keldaHex, faceUp: true }]);
    s = place(s, FINN, at(3, 1)); // 0 wounds
    s = place(s, THORGRIM, at(6, 6));
    expect(legalDestinations(s, FINN).has(keldaHex)).toBe(false);
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: keldaHex }))).toMatch(/out of reach/);
  });
});

// --- Stacking: Astrid + Finn aura + height advantage all add (breakdown) ------

describe('slice 4: stacking (Astrid + Finn aura + height)', () => {
  it('a Tarn on Astrid, beside Finn, attacking downhill rolls 3+1+1+1 = 6 with a full breakdown', () => {
    // The Knoll, row 4 (r=3): … R3 R4 R4 … — a Tarn (Range 1, Attack 3) on the
    // R4 at (3,3) [height 4, Astrid placed there], beside a friendly Finn, melee
    // -attacking an enemy Marro on the ADJACENT R3 at (2,3) [height 3 → +1
    // height]. 3 printed + 1 Astrid + 1 Finn aura + 1 height = 6.
    let s = noGlyphs(inTurnsOn('the_knoll', 'p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, TARN(1), FINN, MARRO(1), THORGRIM);
    const tarnHex = at(3, 3); // R4 (height 4)
    s = setGlyphs(s, [{ id: 'astrid', at: tarnHex, faceUp: true }]);
    s = place(s, TARN(1), tarnHex); // p1 controls Astrid
    s = place(s, FINN, at(4, 3)); // R4 (height 4), adjacent friendly Finn
    s = place(s, MARRO(1), at(2, 3)); // R3 (height 3), adjacent enemy, downhill
    s = place(s, THORGRIM, at(0, 7)); // keep a 2nd p2 figure alive, far away
    // Confirm the geometry: attacker is adjacent and one level higher.
    expect(heightAdvantage(s, fig(s, TARN(1)), fig(s, MARRO(1)))).toEqual({ attacker: 1, defender: 0 });
    const eff = effectiveAttackDice(s, fig(s, TARN(1)), fig(s, MARRO(1)));
    expect(eff.dice).toBe(6);
    expect(eff.breakdown).toEqual(['Attack 3 printed', '+1 height', '+1 Finn aura', '+1 Astrid']);
    // Folds through requirements + a real melee attack (TARN Range 1, adjacent).
    expect(attackDiceRequirements(s, TARN(1), MARRO(1))!.attack).toBe(6);
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: TARN(1), targetId: MARRO(1), attackRoll: F('kkkkkk'), defenseRoll: F('sss') }));
    expect(hit.lastAttack!.breakdown).toEqual(expect.arrayContaining(['+1 height', '+1 Finn aura', '+1 Astrid']));
  });
});

// --- Projection stays leak-free (glyphs/powers add no hidden info) ------------

describe('slice 4: projection still leak-free with glyphs + pendingChoice', () => {
  it('glyphs and a pending choice are public — projection adds no new secrets', () => {
    let s = unwrap(applyAction(
      (() => {
        let st = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
        st = clearExcept(st, MARRO(1), MARRO(2), MARRO(3), FINN);
        st = place(st, MARRO(3), null);
        st = place(st, MARRO(1), at(3, 3));
        st = place(st, MARRO(2), at(0, 0));
        st = place(st, FINN, at(6, 6));
        st = setGlyphs(st, [{ id: 'astrid', at: at(5, 5), faceUp: true }]);
        return unwrap(applyAction(st, 'p2', { kind: 'move_figure', figureId: MARRO(1), to: at(3, 4) }));
      })(),
      'p2',
      { kind: 'water_clone', rolls: [ { marroFigureId: MARRO(1), d20: 15 }, { marroFigureId: MARRO(2), d20: 3 } ] },
    ));
    // A placement choice is open and PUBLIC.
    expect(s.pendingChoice).toBeDefined();
    const before = JSON.stringify(s);
    const forP1 = projectStateForViewer(s, 'p1');
    const forNull = projectStateForViewer(s, null);
    // Glyphs and pendingChoice survive projection identically for everyone —
    // they carry no hidden information.
    expect(forP1.glyphs).toEqual(s.glyphs);
    expect(forP1.pendingChoice).toEqual(s.pendingChoice);
    expect(forNull.pendingChoice).toEqual(s.pendingChoice);
    // Projection never mutates the input (slice-2 invariant preserved).
    expect(JSON.stringify(s)).toBe(before);
    // p2 stacked all four markers on the Marro card; initiative revealed only
    // marker 1. From p1's view, p2's UNREVEALED markers (2/3/X) must NOT decode
    // anywhere — count their value bytes in p2's projected cards.
    const p2Cards = JSON.stringify(forP1.cards.filter(c => c.ownerSeat === 1));
    const bytes = (v: string) => p2Cards.split(`"marker":"${v}"`).length - 1;
    expect(bytes('1')).toBe(1); // the one revealed marker is public
    expect(bytes('2')).toBe(0);
    expect(bytes('3')).toBe(0);
    expect(bytes('X')).toBe(0);
    // Spectators (null viewer) never decode even the revealed Marro marker’s X.
    expect(JSON.stringify(projectStateForViewer(s, null).cards.filter(c => c.ownerSeat === 1)).split('"marker":"X"').length - 1).toBe(0);
  });
});

// ===========================================================================
// SLICE 5 — army draft + placement + full roster
// (docs/heroscape/slice-5-spec.md; extraction/resolutions.md; cards.md)
// ===========================================================================

// ---- draft helpers --------------------------------------------------------

/** start_game in DRAFT mode, then the server roll-off so `first` drafts first
 *  (high roller). Returns the draft state awaiting `first`'s opening pick. */
function inDraft(first: 'p1' | 'p2' = 'p1', pointBudget = 500): HSState {
  let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget }));
  s = unwrap(
    applyAction(s, 'p1', {
      kind: 'draft_roll',
      attempts: [first === 'p1' ? ATT(18, 4) : ATT(4, 18)],
    }),
  );
  return s;
}

const pidOf = (seat: number) => (seat === 0 ? 'p1' : 'p2');

/** Apply a draft_card by the seat whose pick it currently is. */
function draftCard(s: HSState, cardId: string): HSState {
  const seat = s.draft!.turnSeat!;
  return unwrap(applyAction(s, pidOf(seat), { kind: 'draft_card', cardId }));
}
function draftPass(s: HSState): HSState {
  const seat = s.draft!.turnSeat!;
  return unwrap(applyAction(s, pidOf(seat), { kind: 'draft_pass' }));
}

// ---- start_game routing ---------------------------------------------------

describe('slice 5: start_game routing (draft vs quick)', () => {
  it('quick mode auto-fills the preset armies and goes straight to playing', () => {
    const s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'quick' }));
    expect(s.phase).toBe('playing');
    expect(s.subPhase).toBe('place_markers');
    expect(s.mode).toBe('quick');
    expect(s.figures).toHaveLength(10);
    // Reproduces the slice-4 fixed armies + auto-placement exactly.
    expect(fig(s, FINN).at).toBe(at(3, 0));
    expect(fig(s, THORGRIM).at).toBe(at(3, 7));
    expect(s.cards.map(c => c.cardId).sort()).toEqual(['finn', 'marro_warriors', 'tarn_vikings', 'thorgrim']);
    expect(s.draft).toBeUndefined();
    expect(s.hand).toBeUndefined();
  });

  it('draft mode enters the draft phase with a roll-off and an empty pool of 16', () => {
    let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 400 }));
    expect(s.phase).toBe('draft');
    expect(s.mode).toBe('draft');
    expect(s.pointBudget).toBe(400);
    expect(s.draft).toBeDefined();
    expect(s.draft!.pool).toHaveLength(16);
    expect(s.draft!.turnSeat).toBeNull(); // awaiting the server roll-off
    expect(getActivePlayerId(s)).toBeNull();
    // Server rolls the order; p1 wins → drafts first.
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(15, 4)] }));
    expect(s.draft!.order).toEqual([0, 1]);
    expect(s.draft!.turnSeat).toBe(0);
    expect(s.draft!.remainingPicks).toBe(1);
    expect(getActivePlayerId(s)).toBe('p1');
  });

  it('the default mode is draft (no mode arg)', () => {
    const s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game' }));
    expect(s.phase).toBe('draft');
    expect(s.mode).toBe('draft');
  });

  it('rejects an invalid point budget in draft mode', () => {
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 250 }))).toMatch(/point budget/i);
    // …but quick mode ignores the budget.
    expect(unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'quick', pointBudget: 250 })).phase).toBe('playing');
  });
});

// ---- draft roll-off -------------------------------------------------------

describe('slice 5: draft order roll-off', () => {
  it('re-rolls ties and the high roller drafts first (both directions)', () => {
    const a = inDraft('p1');
    expect(a.draft!.order).toEqual([0, 1]);
    expect(a.draft!.turnSeat).toBe(0);
    const b = inDraft('p2');
    expect(b.draft!.order).toEqual([1, 0]);
    expect(b.draft!.turnSeat).toBe(1);
    // Ties before the final attempt are kept for display and re-rolled.
    let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft' }));
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(9, 9), ATT(2, 17)] }));
    expect(s.draft!.rollOff).toHaveLength(2);
    expect(s.draft!.order).toEqual([1, 0]);
    expect(s.log.some(e => /Tie — re-roll/.test(e.text))).toBe(true);
  });

  it('rejects a tied final attempt, a non-tie re-roll, and a double roll-off', () => {
    let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft' }));
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(7, 7)] }))).toMatch(/tie/i);
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(9, 3), ATT(8, 2)] }))).toMatch(/not tied/);
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(15, 4)] }));
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(15, 4)] }))).toMatch(/already set/);
  });
});

// ---- the pick sequence (1, 2, then alternate 1) ---------------------------

describe('slice 5: draft pick sequence (A, B, B, A, B, A…)', () => {
  // THE draft-sequence test: the high roller opens with ONE pick, the other
  // takes TWO, then the draft alternates single picks starting back with the
  // high roller (resolutions.md, verified).
  it('enforces 1 (high), 2 (other), then alternating single picks', () => {
    let s = inDraft('p1'); // p1 (seat 0) is the high roller
    const order: number[] = [];
    // Draft 8 cards total, recording whose turn each pick was.
    const seq = ['finn', 'thorgrim', 'tarn_vikings', 'drake', 'raelin', 'syvarris', 'agent_carr', 'izumi_samurai'];
    for (const id of seq) {
      order.push(s.draft!.turnSeat!);
      s = draftCard(s, id);
    }
    // A, B, B, A, B, A, B, A — the 1/2/alternate sequence.
    expect(order).toEqual([0, 1, 1, 0, 1, 0, 1, 0]);
  });

  it('rejects a pick from the seat whose turn it is NOT', () => {
    const s = inDraft('p1'); // p1's pick
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_card', cardId: 'finn' }))).toMatch(/not your pick/i);
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_pass' }))).toMatch(/not your pick/i);
  });

  it('getActivePlayerId follows the current drafter', () => {
    let s = inDraft('p2'); // p2 high roller, drafts first
    expect(getActivePlayerId(s)).toBe('p2');
    s = draftCard(s, 'finn'); // p2 opener (1) → p1's double turn
    expect(getActivePlayerId(s)).toBe('p1');
  });
});

// ---- unique pool ----------------------------------------------------------

describe('slice 5: unique pool', () => {
  it('a drafted card leaves the pool and cannot be re-drafted', () => {
    let s = inDraft('p1');
    expect(s.draft!.pool).toContain('finn');
    s = draftCard(s, 'finn'); // p1 takes Finn
    expect(s.draft!.pool).not.toContain('finn');
    expect(s.draft!.armies[0]).toEqual(['finn']);
    // It is now p2's (double) turn — p2 cannot draft the same Finn.
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_card', cardId: 'finn' }))).toMatch(/no longer in the pool/);
  });
});

// ---- budget + pass kinds + no-empty-army ----------------------------------

describe('slice 5: budget enforcement and passing', () => {
  it('rejects a card that would exceed the remaining budget', () => {
    // Budget 200: p1 takes Grimnak (160). Remaining 40 — nothing ≥40 except the
    // 50-pt Tarn would overflow on p1's NEXT pick. First test the over-budget
    // rejection directly: with 200 and Grimnak (160) taken, drafting Mimring
    // (150) would push to 310 > 200.
    let s = inDraft('p1', 200);
    s = draftCard(s, 'grimnak'); // p1: 160/200, then p2's double turn
    // Hand the turn back to p1 by having p2 take two cheap cards.
    s = draftCard(s, 'izumi_samurai'); // p2: 60
    s = draftCard(s, 'tarn_vikings'); // p2: 110 → back to p1
    expect(s.draft!.turnSeat).toBe(0);
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_card', cardId: 'mimring' }))).toMatch(/points left/);
  });

  it('forces a pass when nothing affordable remains, and the pass completes the army', () => {
    // Budget 200. p1 drafts Grimnak (160) leaving 40 — the cheapest pool card is
    // 50 (Tarn) so nothing is affordable: p1 must pass on its next turn.
    let s = inDraft('p1', 200);
    s = draftCard(s, 'grimnak'); // p1: 160/200 → p2 double
    s = draftCard(s, 'finn'); // p2: 80
    s = draftCard(s, 'thorgrim'); // p2: 160 → back to p1
    // p1 has 40 left; cheapest remaining is 50 (Tarn). The forced pass is legal.
    expect(s.draft!.turnSeat).toBe(0);
    s = draftPass(s);
    expect(s.draft!.passed).toContain(0);
    expect(s.log.some(e => /must pass — no affordable card/.test(e.text))).toBe(true);
  });

  it('allows a VOLUNTARY pass under budget (army already non-empty)', () => {
    let s = inDraft('p1', 500);
    s = draftCard(s, 'finn'); // p1: 80 (army non-empty)
    s = draftCard(s, 'thorgrim'); // p2 double pick 1
    s = draftCard(s, 'marro_warriors'); // p2 double pick 2 → back to p1
    expect(s.draft!.turnSeat).toBe(0);
    // p1 has 420 left and affordable cards, but chooses to pass voluntarily.
    s = draftPass(s);
    expect(s.draft!.passed).toContain(0);
    expect(s.log.some(e => /passes; their army is complete/.test(e.text))).toBe(true);
  });

  it('cannot pass an EMPTY army while affordable cards remain (first pick can not be a pass)', () => {
    const s = inDraft('p1', 500); // p1's very first pick
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_pass' }))).toMatch(/at least one card/);
  });

  it('after one seat passes, the other keeps single picks until it too passes', () => {
    let s = inDraft('p1', 300);
    s = draftCard(s, 'finn'); // p1: 80
    s = draftCard(s, 'thorgrim'); // p2 pick 1: 80
    s = draftCard(s, 'marro_warriors'); // p2 pick 2: 185 → back to p1
    s = draftPass(s); // p1 passes voluntarily (army non-empty)
    expect(s.draft!.turnSeat).toBe(1); // p2 keeps drafting alone
    s = draftCard(s, 'tarn_vikings'); // p2: 235
    expect(s.draft!.turnSeat).toBe(1); // still p2 (single picks)
    expect(s.phase).toBe('draft');
  });
});

// ---- draft end → placement hand -------------------------------------------

describe('slice 5: draft end → placement', () => {
  it('both passed → placement with each seat hand = its army figures and spent ≤ budget', () => {
    let s = inDraft('p1', 500);
    s = draftCard(s, 'finn'); // p1: 80
    s = draftCard(s, 'thorgrim'); // p2: 80
    s = draftCard(s, 'marro_warriors'); // p2: 185 → p1
    s = draftPass(s); // p1 done (1 card)
    s = draftPass(s); // p2 done (2 cards) → both passed
    expect(s.phase).toBe('placement');
    expect(s.draft!.turnSeat).toBeNull();
    expect(getActivePlayerId(s)).toBeNull();
    // Hands hold each army's figures (Finn 1; Thorgrim 1 + Marro 4 = 5).
    expect(s.hand![0]).toHaveLength(1);
    expect(s.hand![1]).toHaveLength(5);
    expect(s.figures.filter(f => f.ownerSeat === 0)).toHaveLength(1);
    expect(s.figures.filter(f => f.ownerSeat === 1)).toHaveLength(5);
    // All figures start in hand (unplaced).
    expect(s.figures.every(f => f.at == null)).toBe(true);
    // spent ≤ budget.
    expect(s.draft!.spent[0]).toBeLessThanOrEqual(500);
    expect(s.draft!.spent[1]).toBeLessThanOrEqual(500);
    expect(s.cards.map(c => c.cardId).sort()).toEqual(['finn', 'marro_warriors', 'thorgrim']);
  });
});

// ---- placement legality + ready gate --------------------------------------

describe('slice 5: placement', () => {
  /** Clean placement setup: p1 drafts Finn; p2 drafts Thorgrim + Marro; both
   *  pass → placement. p1 hand = [Finn]; p2 hand = [Thorgrim, Marro×4]. */
  function placementState(): HSState {
    let s = inDraft('p1', 500);
    s = draftCard(s, 'finn');
    s = draftCard(s, 'thorgrim');
    s = draftCard(s, 'marro_warriors');
    s = draftPass(s); // p1 (1 card) done
    s = draftPass(s); // p2 (2 cards) done → placement
    expect(s.phase).toBe('placement');
    return s;
  }

  it('places only onto your own empty start-zone hexes; unplace returns to hand', () => {
    const s0 = placementState();
    const finnFig = s0.hand![0][0];
    const zone0 = MAPS[s0.mapId].startZones[0];
    // A hex in p2's zone is illegal for p1.
    const zone1 = MAPS[s0.mapId].startZones[1];
    expect(errOf(applyAction(s0, 'p1', { kind: 'place_figure', figureId: finnFig, to: zone1[0] }))).toMatch(/your own start zone/);
    // p1 cannot place p2's figure.
    expect(errOf(applyAction(s0, 'p1', { kind: 'place_figure', figureId: s0.hand![1][0], to: zone0[0] }))).toMatch(/not your figure/);
    // placeableHexes lists exactly the empty own-zone hexes.
    expect(placeableHexes(s0, 0)).toEqual(new Set(zone0));
    // Place Finn.
    let s = unwrap(applyAction(s0, 'p1', { kind: 'place_figure', figureId: finnFig, to: zone0[0] }));
    expect(fig(s, finnFig).at).toBe(zone0[0]);
    expect(s.hand![0]).toHaveLength(0);
    expect(placeableHexes(s, 0).has(zone0[0])).toBe(false); // now occupied
    // Cannot stack a second figure on the same hex (p2 places into p1's? no — own
    // zone only). Re-placing the same figure is rejected (already on board).
    expect(errOf(applyAction(s, 'p1', { kind: 'place_figure', figureId: finnFig, to: zone0[1] }))).toMatch(/already on the battlefield/);
    // Unplace returns it to hand.
    s = unwrap(applyAction(s, 'p1', { kind: 'unplace_figure', figureId: finnFig }));
    expect(fig(s, finnFig).at).toBeNull();
    expect(s.hand![0]).toEqual([finnFig]);
  });

  it('ready needs ≥1 placed; unplaced figures are dropped (unused) on ready', () => {
    let s = placementState();
    // p1 readies with nothing placed → rejected.
    expect(errOf(applyAction(s, 'p1', { kind: 'placement_ready' }))).toMatch(/at least one figure/);
    // p1 places Finn and readies.
    const z0 = MAPS[s.mapId].startZones[0];
    s = unwrap(applyAction(s, 'p1', { kind: 'place_figure', figureId: s.hand![0][0], to: z0[0] }));
    s = unwrap(applyAction(s, 'p1', { kind: 'placement_ready' }));
    expect(s.placementReady).toEqual([0]);
    expect(s.phase).toBe('placement'); // waiting on p2
    // p2 places only ONE Marro (leaves Thorgrim + 3 Marro in hand) and readies.
    const z1 = MAPS[s.mapId].startZones[1];
    const oneMarro = s.hand![1].find(id => id.includes('marro'))!;
    s = unwrap(applyAction(s, 'p2', { kind: 'place_figure', figureId: oneMarro, to: z1[0] }));
    expect(s.hand![1]).toHaveLength(4);
    s = unwrap(applyAction(s, 'p2', { kind: 'placement_ready' }));
    // Both ready → playing, round 1, place_markers.
    expect(s.phase).toBe('playing');
    expect(s.subPhase).toBe('place_markers');
    expect(s.round).toBe(1);
    // The 4 unplaced p2 figures were DROPPED (unused).
    expect(s.figures.filter(f => f.ownerSeat === 1)).toHaveLength(1);
    expect(s.figures.find(f => f.id === oneMarro)).toBeDefined();
    // The Thorgrim card (no figures placed) is removed so it can't hold a marker.
    expect(s.cards.some(c => c.cardId === 'thorgrim')).toBe(false);
    expect(s.cards.some(c => c.cardId === 'marro_warriors')).toBe(true);
    expect(s.log.some(e => /left unused/.test(e.text))).toBe(true);
    // Cleanup: draft/hand state is gone in playing.
    expect(s.draft).toBeUndefined();
    expect(s.hand).toBeUndefined();
  });

  it('cannot place/unplace after locking in placement', () => {
    let s = placementState();
    const z0 = MAPS[s.mapId].startZones[0];
    s = unwrap(applyAction(s, 'p1', { kind: 'place_figure', figureId: s.hand![0][0], to: z0[0] }));
    s = unwrap(applyAction(s, 'p1', { kind: 'placement_ready' }));
    const finnFig = `s0-finn-1`;
    expect(errOf(applyAction(s, 'p1', { kind: 'unplace_figure', figureId: finnFig }))).toMatch(/already locked in/);
    expect(errOf(applyAction(s, 'p1', { kind: 'place_figure', figureId: finnFig, to: z0[1] }))).toMatch(/already locked in/);
  });

  it('a full placed army flows into a normal round-1 turn', () => {
    let s = placementState();
    const z0 = MAPS[s.mapId].startZones[0];
    const z1 = MAPS[s.mapId].startZones[1];
    s = unwrap(applyAction(s, 'p1', { kind: 'place_figure', figureId: s.hand![0][0], to: z0[0] }));
    // p2 places all 5 figures.
    [...s.hand![1]].forEach((id, i) => {
      s = unwrap(applyAction(s, 'p2', { kind: 'place_figure', figureId: id, to: z1[i] }));
    });
    s = unwrap(applyAction(s, 'p1', { kind: 'placement_ready' }));
    s = unwrap(applyAction(s, 'p2', { kind: 'placement_ready' }));
    expect(s.phase).toBe('playing');
    expect(s.figures.filter(f => f.at != null)).toHaveLength(6); // 1 + 5
    // Markers can now be placed normally.
    s = placed(s, 'p1', allOn('s0-finn'));
    expect(s.markersReady).toEqual([0]);
  });
});

// ---- full roster stats + power flags --------------------------------------

describe('slice 5: full 16-card roster', () => {
  it('HS_CARDS has all 16 cards with the cards.md stats', () => {
    expect(Object.keys(HS_CARDS)).toHaveLength(16);
    expect(HS_DRAFT_POOL).toHaveLength(16);
    // Every pool id resolves to a card.
    for (const id of HS_DRAFT_POOL) expect(HS_CARDS[id]).toBeDefined();
    // Spot-check stats AS PRINTED (cards.md roster table).
    expect(HS_CARDS.marro_warriors).toMatchObject({ figures: 4, life: 1, move: 6, range: 6, attack: 2, defense: 3, height: 4, points: 105 });
    expect(HS_CARDS.airborne_elite).toMatchObject({ figures: 4, range: 8, attack: 3, defense: 2, points: 110 });
    expect(HS_CARDS.zettian_guards).toMatchObject({ figures: 2, range: 7, attack: 2, defense: 7, points: 70 });
    expect(HS_CARDS.deathwalker_9000).toMatchObject({ figures: 1, life: 1, range: 7, attack: 4, defense: 7, height: 7, points: 140 });
    expect(HS_CARDS.mimring).toMatchObject({ life: 5, attack: 4, defense: 3, height: 9, points: 150 });
    expect(HS_CARDS.grimnak).toMatchObject({ attack: 2, defense: 4, height: 11, points: 160 });
    expect(HS_CARDS.syvarris).toMatchObject({ range: 9, attack: 3, defense: 2, points: 100 });
    expect(HS_CARDS.raelin).toMatchObject({ life: 5, move: 6, range: 1, defense: 3, points: 120 });
    expect(HS_CARDS.izumi_samurai).toMatchObject({ figures: 3, attack: 2, defense: 5, points: 60 });
    expect(HS_CARDS.krav_maga).toMatchObject({ figures: 3, move: 6, range: 7, points: 100 });
    expect(HS_CARDS.ne_gok_sa).toMatchObject({ life: 5, defense: 6, points: 90 });
    expect(HS_CARDS.drake).toMatchObject({ life: 5, attack: 6, defense: 3, points: 110 });
    expect(HS_CARDS.agent_carr).toMatchObject({ range: 6, attack: 2, defense: 4, points: 100 });
  });

  it('power flags: only Finn/Thorgrim/Tarn/Marro are live; the rest are wip', () => {
    const live = Object.values(HS_CARDS).filter(c => c.power === 'live').map(c => c.id).sort();
    expect(live).toEqual(['finn', 'marro_warriors', 'tarn_vikings', 'thorgrim']);
    const wipCount = Object.values(HS_CARDS).filter(c => c.power === 'wip').length;
    expect(wipCount).toBe(12);
  });

  it('a wip card fights with its printed stats (no power handler)', () => {
    // Draft Syvarris (wip, Range 9, Attack 3) for p1; it attacks as printed.
    let s = inDraft('p1', 500);
    s = draftCard(s, 'syvarris'); // p1 opener (1) → p2's double turn
    s = draftCard(s, 'marro_warriors'); // p2 pick 1 of 2 (still p2's turn)
    s = draftPass(s); // p2 passes its 2nd pick voluntarily (1 card) → back to p1
    s = draftPass(s); // p1 passes (Syvarris) → both passed → placement
    expect(s.phase).toBe('placement');
    // Place Syvarris adjacent-ish to a Marro and verify attack dice = printed 3
    // (no aura/glyph/height on flat ground).
    const z0 = MAPS[s.mapId].startZones[0];
    const z1 = MAPS[s.mapId].startZones[1];
    s = unwrap(applyAction(s, 'p1', { kind: 'place_figure', figureId: s.hand![0][0], to: z0[0] }));
    s = unwrap(applyAction(s, 'p2', { kind: 'place_figure', figureId: s.hand![1][0], to: z1[0] }));
    s = unwrap(applyAction(s, 'p1', { kind: 'placement_ready' }));
    s = unwrap(applyAction(s, 'p2', { kind: 'placement_ready' }));
    const syv = s.figures.find(f => f.ownerSeat === 0)!;
    const marro = s.figures.find(f => f.ownerSeat === 1)!;
    expect(attackDiceRequirements(s, syv.id, marro.id)!.attack).toBe(3); // Syvarris printed Attack 3
  });
});

// ---- regression + projection ----------------------------------------------

describe('slice 5: quick-battle regression + projection', () => {
  it('quick battle reproduces the slice-4 fixed-army game', () => {
    const s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'quick' }));
    expect(s.figures).toHaveLength(10);
    expect(s.cards).toHaveLength(4);
    expect(fig(s, FINN).at).toBe(at(3, 0));
    expect([fig(s, TARN(1)).at, fig(s, TARN(2)).at, fig(s, TARN(3)).at, fig(s, TARN(4)).at]).toEqual([at(1, 0), at(2, 0), at(4, 0), at(5, 0)]);
    expect(fig(s, THORGRIM).at).toBe(at(3, 7));
    expect([fig(s, MARRO(1)).at, fig(s, MARRO(2)).at, fig(s, MARRO(3)).at, fig(s, MARRO(4)).at]).toEqual([at(1, 7), at(2, 7), at(4, 7), at(5, 7)]);
  });

  it('projection is leak-free through draft and placement (only order markers are hidden)', () => {
    // Draft phase: everything is public.
    let s = inDraft('p1', 500);
    s = draftCard(s, 'finn');
    const before = JSON.stringify(s);
    expect(projectStateForViewer(s, 'p2')).toEqual(s); // no hidden info in draft
    expect(projectStateForViewer(s, null)).toEqual(s);
    expect(JSON.stringify(s)).toBe(before); // never mutates

    // Placement phase: figures + hands are public too.
    s = draftCard(s, 'thorgrim');
    s = draftCard(s, 'marro_warriors');
    s = draftPass(s);
    s = draftPass(s);
    expect(s.phase).toBe('placement');
    expect(projectStateForViewer(s, 'p2')).toEqual(s);
    expect(projectStateForViewer(s, null)).toEqual(s);
  });

  it('computeHistory stays null through draft and placement', () => {
    let s = inDraft('p1', 500);
    expect(computeHistory(s)).toBeNull();
    s = draftCard(s, 'finn');
    expect(computeHistory(s)).toBeNull();
    s = draftCard(s, 'thorgrim');
    s = draftCard(s, 'marro_warriors');
    s = draftPass(s);
    s = draftPass(s);
    expect(s.phase).toBe('placement');
    expect(computeHistory(s)).toBeNull();
  });
});
