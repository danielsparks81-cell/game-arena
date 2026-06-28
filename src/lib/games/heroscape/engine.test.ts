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
  canOverextend,
  projectStateForViewer,
  legalDestinations,
  legalStepHexes,
  moveTailOptions,
  movementRangeHexes,
  shootingRangeHexes,
  shootBlockedHexes,
  grappleDestinations,
  legalTargets,
  attackDiceRequirements,
  heightAdvantage,
  effectiveAttackDice,
  effectiveDefenseDice,
  auraBuffedFigureIds,
  auraCoverageHexes,
  effectiveMove,
  effectiveRange,
  moveConsequences,
  disengageMoveHexes,
  scatterDestinations,
  aiNextAction,
  aiEngineAction,
  stepConsequences,
  placeableHexes,
  placeable2Leads,
  theDropHexes,
  orientationOptions,
  canMindShackle,
  mindShackleTargets,
  canChomp,
  chompTargets,
  explosionTargets,
  explosionDefenders,
  canGrenade,
  grenadeTargets,
  grenadeDefenders,
  fireLineSpaces,
  fireLineTargets,
  fireLineDefenders,
  canFireLine,
  erlandDestinations,
  erlandSummonableIds,
  sturlaPlacementHexes,
  startZoneFor,
  POINT_BUDGETS,
  glyphCountForMap,
} from './engine';
import { hexKey, offsetToAxial, rangeDistance, neighborKeys } from './board';
import { MAPS, parseMap, STAR_FIELD } from './maps';
import { HS_CARDS, HS_DRAFT_POOL, CLASSIC_OVERRIDES, effectiveCardDef, HS_GLYPHS } from './content';
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

describe('set_lobby_config (host lobby settings sync to shared state)', () => {
  it('writes mapId / mode / pointBudget onto the shared state so all players see them', () => {
    let s = lobby();
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', mapId: 'the_knoll' }));
    expect(s.mapId).toBe('the_knoll');
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', mode: 'quick' }));
    expect(s.mode).toBe('quick');
    s = unwrap(applyAction(s, 'p1', { kind: 'set_lobby_config', pointBudget: 300 }));
    expect(s.pointBudget).toBe(300);
    expect(s.phase).toBe('lobby'); // still in the lobby
  });

  it('rejects an unknown battlefield or out-of-range budget', () => {
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'set_lobby_config', mapId: 'nope' }))).toMatch(/Unknown battlefield/);
    // Custom budgets are allowed in range; only out-of-range is rejected.
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'set_lobby_config', pointBudget: 9999 }))).toMatch(/Budget must be/i);
    expect(unwrap(applyAction(lobby(), 'p1', { kind: 'set_lobby_config', pointBudget: 250 })).pointBudget).toBe(250);
  });

  it('cannot change settings once the battle has started', () => {
    expect(errOf(applyAction(started(), 'p1', { kind: 'set_lobby_config', mapId: 'the_knoll' })))
      .toMatch(/before the battle starts/);
  });
});

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
const WATER_MAP_ID = 'test_water';
const TINY_MAP_ID = 'test_tiny';
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
  // A flat map with a horizontal WATER strip (cols 2-4 of the middle row) for 2-hex water-stop tests.
  MAPS[WATER_MAP_ID] = parseMap(
    WATER_MAP_ID,
    'Test Water',
    `
    row1@1: G1 G1 G1 G1 G1
    row2:   G1 G1 W1 W1 W1
    row3@2: G1 G1 G1 G1 G1
    `,
  );
  // A 3-hex single row: at most TWO mutually-non-adjacent landings, so a 4-figure
  // Airborne squad can never fully drop here — used to exercise the "can't fit" path.
  MAPS[TINY_MAP_ID] = parseMap(TINY_MAP_ID, 'Test Tiny', `row1@1: G1 G1 G1`);
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

/** Test-only: drive a ROLL CEREMONY (Mitonsoul/Sturla) to completion the way the UI does —
 *  for each figure, its OWNER selects it then rolls it. `decide(figureId)` supplies the d20.
 *  Stops when the ceremony pending closes (a Sturla resurrect then leaves a placement pending). */
function drainCeremony(s: HSState, decide: (figureId: string) => number): HSState {
  let cur = s;
  let guard = 0;
  while (cur.pendingChoice?.kind === 'roll_ceremony' && guard++ < 300) {
    const pc = cur.pendingChoice;
    const pid = `p${pc.seat + 1}`;
    const fid = pc.queue[0].figureIds[0];
    cur = unwrap(applyAction(cur, pid, { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: fid } }));
    cur = unwrap(applyAction(cur, pid, { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll', d20: decide(fid) } }));
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Lobby + start
// ---------------------------------------------------------------------------

describe('lobby seating', () => {
  it('addPlayer caps at 6 seats and is idempotent', () => {
    let s = lobby(); // p1, p2
    expect(s.players).toHaveLength(2);
    s = addPlayer(s, 'p1', 'Alice again', 0); // same id ⇒ no-op
    expect(s.players).toHaveLength(2);
    s = addPlayer(s, 'p3', 'Carol', 2); // 3rd player now allowed (multiplayer)
    s = addPlayer(s, 'p4', 'Dave', 3);
    s = addPlayer(s, 'p5', 'Eve', 4);
    s = addPlayer(s, 'p6', 'Frank', 5);
    expect(s.players).toHaveLength(6);
    s = addPlayer(s, 'p7', 'Grace', 6); // 7th rejected — six seats max
    expect(s.players).toHaveLength(6);
  });

  it('removePlayer frees the seat in the lobby only', () => {
    const s = removePlayer(lobby(), 'p2');
    expect(s.players.map(p => p.playerId)).toEqual(['p1']);
    const live = started();
    expect(removePlayer(live, 'p2')).toBe(live); // no-op once playing
  });
});

describe('start_game (fixed setup, straight into marker placement)', () => {
  it('requires at least 2 players', () => {
    const s = addPlayer(initialState(), 'p1', 'Alice', 0);
    expect(errOf(applyAction(s, 'p1', { kind: 'start_game' }))).toMatch(/at least 2 players/);
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
    // The roll surfaces a dice overlay (lastRoll) — one d20 per seat, labelled.
    expect(a.lastRoll?.title).toBe('Initiative');
    expect(a.lastRoll?.dice).toHaveLength(2);
    expect(a.lastRoll?.labels).toHaveLength(2);
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
    // [9,3] has a unique high (9) — re-rolling at all is illegitimate, and only the tied seats may
    // re-roll, so changing seat 1 (a clean loser) is rejected.
    expect(
      errOf(
        applyAction(bothPlaced(), 'p1', { kind: 'roll_initiative', attempts: [ATT(9, 3), ATT(8, 2)] }),
      ),
    ).toMatch(/tied/i);
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
// 2c. Move undo (undo_move) — repeatable full rewind, locked after committing
// ---------------------------------------------------------------------------

describe('move undo (undo_move)', () => {
  it('rewinds a single move: position, movedFigureIds, and the stack', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    const start = fig(s, FINN).at;
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect(fig(moved, FINN).at).toBe(at(3, 1));
    expect(moved.movedFigureIds).toContain(FINN);
    expect((moved.moveHistory ?? []).length).toBe(1);
    const undone = unwrap(applyAction(moved, 'p1', { kind: 'undo_move' }));
    expect(fig(undone, FINN).at).toBe(start);
    expect(undone.movedFigureIds).not.toContain(FINN);
    expect((undone.moveHistory ?? []).length).toBe(0);
  });

  it('is repeatable LIFO across several figures of a squad', () => {
    const s = inTurns('p1', { p1: 's0-tarn_vikings' });
    const t1s = fig(s, TARN(1)).at, t2s = fig(s, TARN(2)).at;
    const d1 = [...legalDestinations(s, TARN(1))][0];
    const m1 = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: d1 }));
    const d2 = [...legalDestinations(m1, TARN(2))][0];
    const m2 = unwrap(applyAction(m1, 'p1', { kind: 'move_figure', figureId: TARN(2), to: d2 }));
    expect((m2.moveHistory ?? []).length).toBe(2);
    const u1 = unwrap(applyAction(m2, 'p1', { kind: 'undo_move' })); // reverts the most recent move
    expect(fig(u1, TARN(2)).at).toBe(t2s);
    expect(fig(u1, TARN(1)).at).toBe(d1); // earlier move still applied
    const u2 = unwrap(applyAction(u1, 'p1', { kind: 'undo_move' }));
    expect(fig(u2, TARN(1)).at).toBe(t1s);
    expect((u2.moveHistory ?? []).length).toBe(0);
  });

  it('cannot undo a move that REVEALED a glyph (the reveal is irreversible)', () => {
    let s = inTurns('p1', { p1: 's0-finn' });
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'astrid', at: glyphHex, faceUp: false }]); // a hidden power glyph one step away
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.glyphs.find(g => g.at === glyphHex)?.faceUp).toBe(true); // stopping on it flipped it face-up
    expect((moved.moveHistory ?? []).length).toBe(0); // …so the move can no longer be taken back
    expect(errOf(applyAction(moved, 'p1', { kind: 'undo_move' }))).toMatch(/Nothing to undo/);
  });

  it('rejects undo with an empty stack, when not your turn, and after attacking', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    expect(errOf(applyAction(s, 'p1', { kind: 'undo_move' }))).toMatch(/Nothing to undo/);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect(errOf(applyAction(moved, 'p2', { kind: 'undo_move' }))).toMatch(/Not your turn/);
    // Once an attack is recorded this turn, the move can no longer be taken back.
    const afterAttack = { ...moved, turnAttacks: [{ attackerId: FINN, targetId: 'x' }] };
    expect(errOf(applyAction(afterAttack, 'p1', { kind: 'undo_move' }))).toMatch(/after attacking/);
  });

  it('end_move soft-commits: clears the undo stack but keeps the move applied', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) }));
    expect((moved.moveHistory ?? []).length).toBe(1);
    const committed = unwrap(applyAction(moved, 'p1', { kind: 'end_move' }));
    expect((committed.moveHistory ?? []).length).toBe(0);  // undo no longer possible
    expect(fig(committed, FINN).at).toBe(at(3, 1));         // the move itself still stands
    expect(committed.movedFigureIds).toContain(FINN);
    expect(errOf(applyAction(committed, 'p1', { kind: 'undo_move' }))).toMatch(/Nothing to undo/);
    expect(errOf(applyAction(moved, 'p2', { kind: 'end_move' }))).toMatch(/Not your turn/);
  });

  it('an after-moving power (Mind Shackle / Throw / Chomp) ends the move step — no moving after', () => {
    const base = inTurns('p1', { p1: 's0-finn' });
    expect(legalDestinations(base, FINN).size).toBeGreaterThan(0); // can move before any power
    for (const flag of ['mindShackleSpent', 'threwThisTurn', 'chompedThisTurn'] as const) {
      const locked = { ...base, [flag]: true };
      expect(legalDestinations(locked, FINN).size).toBe(0); // board offers no move
      expect(errOf(applyAction(locked, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 1) })))
        .toMatch(/Movement is over/);
    }
    // Berserker Charge is the exception — it RE-GRANTS movement, so berserkerSpent must NOT lock.
    expect(legalDestinations({ ...base, berserkerSpent: true }, FINN).size).toBeGreaterThan(0);
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
    expect(s.turnAttacks).toEqual([]);
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
// 4. Lost turns (destroyed card — the marker IS revealed, then the turn forfeited)
// ---------------------------------------------------------------------------

describe('lost turns (p. 14)', () => {
  it('reveals the marker and names the dead card, then forfeits the turn', () => {
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

    // p1's turn-2 marker is on the destroyed Tarn → the rule is REVEAL then lose,
    // so the marker is flipped face-up and the log names the card + the marker.
    const lost = s.log.find(e => /reveals order marker 2.*Tarn.*out of play/.test(e.text));
    expect(lost).toBeDefined();
    expect(lost!.text).toMatch(/forfeit/i);

    // The dead card's markers stay where they were; the turn-2 marker is now
    // revealed (face-up), the turn-3 marker not yet.
    const tarn = s.cards.find(c => c.uid === 's0-tarn_vikings')!;
    expect(tarn.orderMarkers.map(m => m.marker).sort()).toEqual(['2', '3']);
    expect(tarn.orderMarkers.find(m => m.marker === '2')!.revealed).toBe(true);
    expect(tarn.orderMarkers.find(m => m.marker === '3')!.revealed).toBe(false);
    // The opponent's projection now decodes the revealed 2 but still hides the 3.
    const seen = projectStateForViewer(s, 'p2').cards.find(c => c.uid === 's0-tarn_vikings')!;
    expect(seen.orderMarkers).toContainEqual({ marker: '2', revealed: true });
    expect(seen.orderMarkers).toContainEqual({ marker: 'hidden', revealed: false });

    // p1's turn 3 is forfeited the same way (its marker revealed too), then the
    // round rolls over normally.
    s = unwrap(applyAction(s, 'p2', { kind: 'end_turn' }));
    expect([s.turnSeat, s.turnNumber]).toEqual([1, 3]);
    expect(s.log.some(e => /reveals order marker 3.*Tarn.*out of play/.test(e.text))).toBe(true);
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

  it('LOS: a figure between attacker and target does NOT block the shot (only terrain blocks)', () => {
    // Marro at (0,3), Finn at (4,3), a figure dead-center at (2,3) squarely on the
    // line. FIGURES DO NOT BLOCK line of sight (the house rule — on-map obstacles
    // come later), so a body on the line is irrelevant: Finn is a legal target
    // whether or not the figure sits on it. (Terrain still blocks — see the
    // rock-hill test below.) `legalTargets` lists only in-range, in-SIGHT enemies.
    let s = inTurns('p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(0, 3));
    s = place(s, FINN, at(4, 3)); // 4 spaces away, within Range 6
    const onLine = place(s, TARN(1), at(2, 3)); // squarely on the line
    const offLine = place(s, TARN(1), at(2, 2)); // off the line
    expect(legalTargets(onLine, MARRO(1))).toContain(FINN); // body on the line — still targetable
    expect(legalTargets(offLine, MARRO(1))).toContain(FINN); // and off the line — same
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
    // turnAttacks logs each attack (attacker + target) in order (slice 6).
    expect(s.turnAttacks.map(a => a.attackerId)).toEqual([TARN(2), TARN(1), TARN(3)]);
    expect(s.turnAttacks.every(a => a.targetId === THORGRIM)).toBe(true);
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

  it('strips glyphSeed so a client cannot recompute face-down glyph ids', () => {
    // generateGlyphs(seed) is deterministic and the map (incl. glyphAnchors) is in the client
    // bundle — so shipping the seed would let a modified client read every face-down glyph id,
    // defeating the id mask. The seed must never reach the wire.
    const s = JSON.parse(JSON.stringify(lobby())) as HSState;
    s.glyphSeed = 1234567;
    s.glyphs = [
      { id: 'mitonsoul', at: at(2, 2), faceUp: false },
      { id: 'astrid', at: at(3, 2), faceUp: true },
    ];
    for (const viewer of ['p1', 'p2', null] as const) {
      const proj = projectStateForViewer(s, viewer);
      expect(proj.glyphSeed).toBeUndefined();                               // seed never ships
      expect(proj.glyphs.find(g => g.at === at(2, 2))!.id).toBe('hidden');  // face-down id masked
      expect(proj.glyphs.find(g => g.at === at(3, 2))!.id).toBe('astrid');  // face-up id stays public
    }
    expect(s.glyphSeed).toBe(1234567); // input not mutated (seed survives server-side)
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
    expect(s.log.some(e => /is eliminated/i.test(e.text))).toBe(true); // the wiped seat is announced in the log
    expect(s.eliminatedSeats).toContain(1); // seat 1 (the loser) recorded as eliminated
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

  it('CLIMB X2: a Height-3 Deathreaver scales a 4-level wall its Height alone could not (2026-06-26)', () => {
    const DR = (n: number) => `s0-deathreavers-${n}`;
    const ENEMY = 's1-finn-1';
    // Deathreavers aren't in the QUICK army, so build a custom battle on Test Cliffs.
    let s = customBattle(['deathreavers'], ['finn'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, DR(1), ENEMY);
    s = place(s, ENEMY, at(6, 6)); // far opponent, never engaged
    s = place(s, DR(1), at(1, 1)); // grass beside the R5 pillar (rise 4)
    // Deathreaver Height 3 → Climb x2 doubles it to 6, so rise 4 < 6 clears the wall (Move 6 ≥ cost 5).
    expect(legalDestinations(s, DR(1)).has(at(0, 1))).toBe(true);
  });
});

// --- Deathreavers: SCATTER (reactive scuttle after defending) --------------

describe('Deathreavers — SCATTER (reactive: scuttle up to 2 rats after defending a normal attack)', () => {
  const DR = (n: number) => `s0-deathreavers-${n}`;
  const ATTACKER = 's1-marro_warriors-1';
  const tfCells = MAPS.training_field.cells;

  // p2 (Marro) attacks a Deathreaver on the FLAT Training Field (no falls); the rats' owner (p1) then
  // gets the reactive Scatter choice. DR1 sits adjacent to the attacker (engaged, so the no-swipe
  // behaviour shows); DR2/DR3 are parked far off. The attack is all-BLANK → fully blocked, so the
  // target rat SURVIVES and Scatter STILL fires ("after a figure ... rolls defense dice").
  function attackRat1(): HSState {
    let s = customBattle(['deathreavers'], ['marro_warriors'], 'p2', 'training_field');
    s = clearExcept(s, DR(1), DR(2), DR(3), ATTACKER);
    const aHex = at(3, 4);
    const r1Hex = neighborKeys(aHex).find(k => tfCells[k])!; // an in-bounds neighbour → engaged on flat ground
    s = place(s, ATTACKER, aHex);
    s = place(s, DR(1), r1Hex);
    s = place(s, DR(2), at(1, 1));
    s = place(s, DR(3), at(5, 6));
    const req = attackDiceRequirements(s, ATTACKER, DR(1))!;
    return unwrap(applyAction(s, 'p2', { kind: 'attack', attackerId: ATTACKER, targetId: DR(1), attackRoll: F('b'.repeat(req.attack)), defenseRoll: F('b'.repeat(req.defense)) }));
  }

  it('opens a Scatter choice for the DEFENDER after a normal attack (even when fully blocked)', () => {
    const s = attackRat1();
    expect(s.pendingChoice?.kind).toBe('scatter');
    if (s.pendingChoice?.kind === 'scatter') {
      expect(s.pendingChoice.seat).toBe(0); // p1 owns it — resolved on p2's turn
      expect(s.pendingChoice.cardUid).toBe('s0-deathreavers');
      expect(s.pendingChoice.movedFigureIds).toEqual([]);
    }
    expect(fig(s, DR(1)).at).not.toBeNull(); // blocked → the rat lives and may still scatter
  });

  it('scuttles a rat ≤4 with NO leaving-engagement swipe (Disengage), keeps the choice open for a 2nd', () => {
    let s = attackRat1();
    const dests = [...scatterDestinations(s, DR(1))];
    expect(dests.length).toBeGreaterThan(0);
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(1), to: dests[0] } }));
    expect(fig(s, DR(1)).at).toBe(dests[0]);
    expect(fig(s, DR(1)).wounds).toBe(0); // engaged when it left, but Disengage means NO swipe wound
    expect(s.pendingChoice?.kind).toBe('scatter'); // 1 of 2 — still open
    if (s.pendingChoice?.kind === 'scatter') expect(s.pendingChoice.movedFigureIds).toEqual([DR(1)]);
  });

  it('auto-closes once 2 rats have scattered (cap of 2)', () => {
    let s = attackRat1();
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(1), to: [...scatterDestinations(s, DR(1))][0] } }));
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(2), to: [...scatterDestinations(s, DR(2))][0] } }));
    expect(s.pendingChoice).toBeUndefined();
  });

  it('"Done" ends the scuttle immediately, moving no rat', () => {
    let s = attackRat1();
    const before = fig(s, DR(1)).at;
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', done: true } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(fig(s, DR(1)).at).toBe(before);
  });

  it('rejects a scuttle beyond 4 spaces, and a rat that already scattered', () => {
    let s = attackRat1();
    const far = Object.keys(tfCells).find(k => !scatterDestinations(s, DR(2)).has(k) && !s.figures.some(f => f.at === k))!;
    expect(errOf(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(2), to: far } }))).toMatch(/scatter range/i);
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(1), to: [...scatterDestinations(s, DR(1))][0] } }));
    expect(errOf(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'scatter', figureId: DR(1), to: [...scatterDestinations(s, DR(1))][0] } }))).toMatch(/already scattered/i);
  });

  it('is CARD-GATED — a non-Deathreaver squad never opens Scatter on defense', () => {
    // Scatter opens ONLY from doAttack (a NORMAL attack) and ONLY for a `def.scatter` card, so a
    // plain squad defending — and structurally any special-attack handler — never triggers it.
    let s = customBattle(['marro_warriors'], ['marro_warriors'], 'p2', 'training_field');
    s = clearExcept(s, 's0-marro_warriors-1', 's1-marro_warriors-1');
    const aHex = at(3, 4);
    s = place(s, 's1-marro_warriors-1', aHex);
    s = place(s, 's0-marro_warriors-1', neighborKeys(aHex).find(k => tfCells[k])!);
    const req = attackDiceRequirements(s, 's1-marro_warriors-1', 's0-marro_warriors-1')!;
    s = unwrap(applyAction(s, 'p2', { kind: 'attack', attackerId: 's1-marro_warriors-1', targetId: 's0-marro_warriors-1', attackRoll: F('b'.repeat(req.attack)), defenseRoll: F('b'.repeat(req.defense)) }));
    expect(s.pendingChoice).toBeUndefined();
  });

  it('AI flees: a bot Deathreaver owner scatters rats to safety, then ends the scuttle', () => {
    let s = attackRat1();
    const adjBefore = fig(s, DR(1)).at; // adjacent to the attacker
    let guard = 0;
    while (s.pendingChoice?.kind === 'scatter' && guard++ < 6) {
      const intent = aiNextAction(s, 0);
      expect(intent?.kind).toBe('resolve_choice');
      s = unwrap(applyAction(s, 'p1', intent!));
    }
    expect(s.pendingChoice).toBeUndefined(); // the AI closed the choice (no deadlock)
    expect(fig(s, DR(1)).at).not.toBe(adjBefore); // it fled the adjacent attacker
  });
});

// --- Grut squads: BONDING (free bonus turn before the squad acts) ----------

describe('Grut squads — BONDING (free bonus turn with an Orc Champion / Beast)', () => {
  const BG = (n: number) => `s0-blade_gruts-${n}`;

  // Seat 0 = a Grut squad (customBattle stacks all markers on the FIRST card) + a bond partner; seat
  // 1 = a far enemy. p1 goes first → the squad's marker is revealed at turn start → the bond offer
  // opens immediately. The 2-hex partners (Grimnak/Swog Rider) keep customBattle's single-hex slot;
  // bonding eligibility only needs a LIVING figure, so the unset tail doesn't matter here.
  function setup(squad: string, partner: string): HSState {
    return customBattle([squad, partner], ['marro_warriors'], 'p1', 'training_field');
  }

  it('opens a bond offer at the squad turn start, listing the eligible Orc Champion', () => {
    const s = setup('blade_gruts', 'grimnak');
    expect(s.pendingChoice?.kind).toBe('bond');
    if (s.pendingChoice?.kind === 'bond') {
      expect(s.pendingChoice.seat).toBe(0);
      expect(s.pendingChoice.squadUid).toBe('s0-blade_gruts');
      expect(s.pendingChoice.partnerCardUids).toEqual(['s0-grimnak']);
    }
  });

  it('bonding makes the PARTNER the active card for a free bonus turn; the squad cannot act yet', () => {
    let s = setup('blade_gruts', 'grimnak');
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'bond', partnerUid: 's0-grimnak' } }));
    expect(s.bond).toEqual({ squadUid: 's0-blade_gruts', partnerUid: 's0-grimnak' });
    expect(getActiveCardUid(s)).toBe('s0-grimnak'); // the partner is active during the bonus turn
    // a Blade Grut may NOT act while the partner's bonus turn is in progress (wrong active card)
    expect(errOf(applyAction(s, 'p1', { kind: 'move_step', figureId: BG(1), to: at(3, 4) }))).toMatch(/marker|revealed/i);
  });

  it('ending the bonus turn hands control to the squad WITHOUT advancing the slot', () => {
    let s = setup('blade_gruts', 'grimnak');
    const ptr = s.turnPointer;
    const tn = s.turnNumber;
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'bond', partnerUid: 's0-grimnak' } }));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' })); // end the FREE bonus turn
    expect(s.bond).toBeUndefined();
    expect(getActiveCardUid(s)).toBe('s0-blade_gruts'); // the squad's own turn now begins
    expect(s.turnPointer).toBe(ptr); // SAME slot — no advance
    expect(s.turnNumber).toBe(tn);
    expect(s.turnSeat).toBe(0);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' })); // ending the SQUAD turn advances normally
    expect(s.turnSeat).toBe(1); // off to the opponent
    expect(s.bond).toBeUndefined();
  });

  it('SKIP takes the squad turn directly — no bonus turn', () => {
    let s = setup('blade_gruts', 'grimnak');
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'bond' } })); // no partnerUid = skip
    expect(s.bond).toBeUndefined();
    expect(s.bondOffered).toBe(true);
    expect(s.pendingChoice).toBeUndefined();
    expect(getActiveCardUid(s)).toBe('s0-blade_gruts');
  });

  it('Beast Bonding (Arrow Gruts) bonds a Beast (Swog Rider); a Champion is NOT eligible', () => {
    const beast = setup('arrow_gruts', 'swog_rider');
    expect(beast.pendingChoice?.kind).toBe('bond');
    if (beast.pendingChoice?.kind === 'bond') expect(beast.pendingChoice.partnerCardUids).toEqual(['s0-swog_rider']);
    // Arrow Gruts + Grimnak (a Champion, not a Beast) → no eligible partner → no offer at all
    expect(setup('arrow_gruts', 'grimnak').pendingChoice).toBeUndefined();
  });

  it('no bond offer when the squad controls no eligible partner', () => {
    const s = customBattle(['blade_gruts'], ['marro_warriors'], 'p1', 'training_field');
    expect(s.pendingChoice).toBeUndefined();
    expect(getActiveCardUid(s)).toBe('s0-blade_gruts');
  });

  it('AI takes the free bonus turn (bonds the Champion)', () => {
    const s = setup('blade_gruts', 'grimnak');
    const intent = aiNextAction(s, 0); // owns the open bond offer
    expect(intent).toMatchObject({ kind: 'resolve_choice', choice: { kind: 'bond', partnerUid: 's0-grimnak' } });
    const after = unwrap(applyAction(s, 'p1', intent!));
    expect(getActiveCardUid(after)).toBe('s0-grimnak');
  });

  it('AI USES the bonus turn — the bonded partner ACTS, not the squad (audit fix 2026-06-27)', () => {
    let s = customBattle(['blade_gruts', 'grimnak'], ['marro_warriors'], 'p1', 'training_field');
    expect(s.pendingChoice?.kind).toBe('bond');
    // Give Grimnak (2-hex) a valid footprint + park the squad and a FAR enemy so the bonus turn moves him.
    const c: HSState = JSON.parse(JSON.stringify(s));
    const g = c.figures.find(f => f.cardUid === 's0-grimnak')!;
    g.at = at(3, 3); g.at2 = at(4, 3);
    c.figures.filter(f => f.cardUid === 's0-blade_gruts').forEach((f, i) => { f.at = at(i, 0); f.at2 = null; });
    c.figures.filter(f => f.cardUid === 's1-marro_warriors').forEach((f, i) => { f.at = at(i, 7); f.at2 = null; });
    s = c;
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'bond', partnerUid: 's0-grimnak' } }));
    expect(getActiveCardUid(s)).toBe('s0-grimnak'); // the bonus turn is Grimnak's
    const a = aiNextAction(s, 0);
    expect(a?.kind).not.toBe('end_turn'); // the bot does NOT squander the free turn (the pre-fix bug)
    const actorId = (a as { figureId?: string; attackerId?: string }).figureId ?? (a as { attackerId?: string }).attackerId;
    expect(actorId).toContain('grimnak'); // it's the PARTNER acting, not a Blade Grut
  });
});

// --- AI self-preservation (wounded Heroes retreat) -------------------------

describe('HeroScape AI — self-preservation', () => {
  const FINN1 = 's0-finn-1';
  const MARRO1 = 's1-marro_warriors-1';
  const tfCells = MAPS.training_field.cells;
  const distTo = (k: string, t: string) => rangeDistance(tfCells, k, t)!;

  // Finn (Life 4, melee) on the flat field, OUT of melee range of one Marro so the move AI runs. A
  // healthy Finn closes the gap; a badly-wounded Finn (3/4 wounds → past the ⅔ retreat tipping point)
  // backs away instead. Same position + same enemy — only the wound count differs.
  function finnStep(wounds: number): { from: string; to: string } {
    let s = customBattle(['finn'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, FINN1, MARRO1);
    const from = at(3, 3);
    s = place(s, FINN1, from);
    s = place(s, MARRO1, at(3, 6)); // ~3 away — out of Finn's Range 1, so the AI moves him
    if (wounds) s = wound(s, FINN1, wounds);
    const a = aiNextAction(s, 0);
    expect(a?.kind).toBe('move_step');
    return { from, to: (a as { to: string }).to };
  }

  it('a HEALTHY Hero closes the gap', () => {
    const m = finnStep(0);
    expect(distTo(m.to, at(3, 6))).toBeLessThan(distTo(m.from, at(3, 6))); // steps toward the enemy
  });

  it('a badly-WOUNDED Hero retreats to safety', () => {
    const m = finnStep(3); // 3 of 4 Life gone → values distance over closing
    expect(distTo(m.to, at(3, 6))).toBeGreaterThan(distTo(m.from, at(3, 6))); // steps away from the enemy
  });

  it('expendable 1-life squad figures stay aggressive even at full damage potential', () => {
    // A Marro Warrior (Life 1) can't be "wounded and alive", so self-preservation never applies — it
    // always advances. (Sanity: the hurt factor is 0 for a 1-life figure.)
    let s = customBattle(['marro_warriors'], ['finn'], 'p1', 'training_field');
    s = clearExcept(s, 's0-marro_warriors-1', 's1-finn-1');
    const from = at(3, 3);
    s = place(s, 's0-marro_warriors-1', from);
    s = place(s, 's1-finn-1', at(3, 6));
    const a = aiNextAction(s, 0);
    // Marro Range 6 → it may already be in range and just attack; if it moves, it never retreats.
    if (a?.kind === 'move_step') expect(distTo((a as { to: string }).to, at(3, 6))).toBeLessThanOrEqual(distTo(from, at(3, 6)));
  });
});

// --- AI objective-seeking: charge to melee + grab glyphs (2026-06-27 fix) ----

describe('HeroScape AI — advance + glyph-seeking', () => {
  const FINN1 = 's0-finn-1';
  const MARRO1 = 's1-marro_warriors-1';
  const tfCells = MAPS.training_field.cells;
  const distTo = (k: string, t: string) => rangeDistance(tfCells, k, t)!;

  // Walk the active seat's move to completion (apply each move_step until it stops walking). On the
  // flat field with the foe far off there are no swipes/falls, so the bare intent IS the action.
  function runMove(s: HSState, pid: string, seat: number): HSState {
    for (let i = 0; i < 20; i++) {
      const a = aiNextAction(s, seat);
      if (!a || a.kind !== 'move_step') break;
      s = unwrap(applyAction(s, pid, a));
    }
    return s;
  }

  it('a HEALTHY melee Hero CHARGES across the field — many steps, not one and stall', () => {
    // The Thorgrim "danced around, no advancement" regression: a healthy melee figure far from its foe
    // must walk its whole move toward it, never take one sideways hex and quit.
    let s = customBattle(['finn'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, FINN1, MARRO1);
    const from = at(1, 1);
    s = place(s, FINN1, from);
    s = place(s, MARRO1, at(5, 6)); // far across the board
    const start = distTo(from, at(5, 6));
    s = runMove(s, 'p1', 0);
    const finn = s.figures.find(f => f.id === FINN1)!;
    expect(distTo(finn.at!, at(5, 6))).toBeLessThan(start - 1); // closed well more than a single hex
  });

  it('a figure with NO enemy inbound heads for an unclaimed glyph', () => {
    // The "AI ignores glyphs" regression: with no foe within a turn's reach, a healthy figure peels
    // toward a nearby open glyph (the user's rule — take glyphs unless something more pressing).
    let s = customBattle(['finn'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, FINN1, MARRO1);
    const from = at(1, 1);
    s = place(s, FINN1, from);
    s = place(s, MARRO1, at(6, 7));    // opposite corner — NOT inbound
    const glyph = at(1, 4);            // a few hexes from Finn, far inside chase range, away from the foe
    s.glyphs = [{ id: 'astrid', at: glyph, faceUp: false }];
    const a = aiNextAction(s, 0);
    expect(a?.kind).toBe('move_step');
    expect(distTo((a as { to: string }).to, glyph)).toBeLessThan(distTo(from, glyph)); // steps toward the glyph
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

// --- water = a HEIGHT DISADVANTAGE (owner house-rule 2026-06-28) ------------

describe('water sits below the ground — a figure IN water is at a height disadvantage', () => {
  it('a bank figure gets height advantage over a water figure; the water figure gets none', () => {
    const card = (uid: string, cardId: string, seat: number) => ({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    const figAt = (id: string, uid: string, seat: number, hex: string) => ({ id, cardUid: uid, ownerSeat: seat, at: hex, at2: null, index: 1, wounds: 0 });
    // test_water row2 = G1 G1 W1 W1 W1 → (0,1) is dry bank, (2,1)/(3,1) are water; all cell-height 1.
    const state = {
      mapId: WATER_MAP_ID, edition: 'modern',
      players: [{ seat: 0 }, { seat: 1 }],
      cards: [card('s0-finn', 'finn', 0), card('s1-thorgrim', 'thorgrim', 1)],
      figures: [figAt('s0-finn-1', 's0-finn', 0, at(0, 1)), figAt('s1-thorgrim-1', 's1-thorgrim', 1, at(2, 1))],
    } as unknown as HSState;
    const bank = state.figures[0], water = state.figures[1];
    // Bank (combat level 1) striking DOWN at the water figure (combat level 0.5) → +1 ATTACK die.
    expect(heightAdvantage(state, bank, water)).toEqual({ attacker: 1, defender: 0 });
    // Water figure striking UP at the bank → the higher bank DEFENDER gets +1 DEFENCE die (water gets none).
    expect(heightAdvantage(state, water, bank)).toEqual({ attacker: 0, defender: 1 });
    // Both in the water → level again, no height die either way (so it's a disadvantage vs LAND, not vs water).
    bank.at = at(3, 1);
    expect(heightAdvantage(state, bank, water)).toEqual({ attacker: 0, defender: 0 });
  });
});

// --- water forced stop -----------------------------------------------------

describe('slice 3: water forced stop (Ford Crossing)', () => {
  it('the dry ford is the only crossing; the Ivor glyph on it forces a stop midway', () => {
    // Marro (Move 6) on the north bank at (4,1) [G2]. Col 4 is the dry ford straight across, but the
    // Ivor glyph sits ON it at (4,3) and the flanking river is water — BOTH are forced stops. So the
    // figure walks the dry ford only as far as the glyph; it can NOT reach the far bank (4,5) in one
    // move. (Crossing water immediately ends the move per 03-movement §5, and you can't blow past a
    // glyph either — earlier this far bank looked reachable only because a 1-hex figure was wrongly
    // allowed to slip through the flanking water.)
    let s = inTurnsOn('ford_crossing', 'p2', { p2: 's1-marro_warriors' });
    s = clearExcept(s, MARRO(1), FINN);
    s = place(s, FINN, at(0, 0));
    s = place(s, MARRO(1), at(4, 1));
    const dests = legalDestinations(s, MARRO(1));
    expect(dests.has(at(4, 3))).toBe(true); // reaches the Ivor glyph on the ford and STOPS there
    expect(dests.has(at(4, 4))).toBe(false); // can't continue past the glyph this turn
    expect(dests.has(at(4, 5))).toBe(false); // far bank unreachable in one move
    // Stepping sideways off the bank into the river is also a valid forced-stop endpoint.
    expect(dests.has(at(3, 2))).toBe(true); // (3,2) is the nearest water hex
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

  // SMART MOVEMENT: the board marks a reachable hex RED iff arriving there abandons a
  // start-engaged enemy (a swipe). disengageMoveHexes is that red set; green = the rest.
  it('disengageMoveHexes flags exactly the reachable hexes that provoke a swipe', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, TARN(1), at(3, 3));
    s = place(s, MARRO(1), at(3, 2)); // adjacent → engaged
    const red = disengageMoveHexes(s, TARN(1));
    const all = movementRangeHexes(s, TARN(1));
    expect(red.has(at(2, 2))).toBe(false); // stays adjacent to the Marro → SAFE (green)
    expect(red.has(at(3, 4))).toBe(true); // leaves the Marro → RED (swipe on arrival)
    for (const k of red) expect(all.has(k)).toBe(true); // red ⊆ reachable; green = reachable \ red
    // The red set matches moveConsequences exactly (the same source the swipe roll uses).
    for (const k of all) {
      const abandons = moveConsequences(s, fig(s, TARN(1)), k).abandonedEnemyIds.length > 0;
      expect(red.has(k)).toBe(abandons);
    }
  });

  it('disengageMoveHexes is empty when the figure is not engaged (every hex green)', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings' });
    s = place(s, TARN(1), at(3, 3)); // no enemy adjacent
    expect(disengageMoveHexes(s, TARN(1)).size).toBe(0);
  });

  // AGGRESSION: the bot must MOVE UP TO STRIKE — reach a hex it can attack from — not just
  // close the gap and tuck in behind a friendly (the reported testing bug).
  it('AI aggression: a melee figure routes AROUND a friendly to reach a strike hex', () => {
    let s = inTurns('p1', { p1: 's0-tarn_vikings', p2: 's1-marro_warriors' });
    s = clearExcept(s, TARN(1), TARN(2), MARRO(1));
    s = place(s, MARRO(1), at(3, 3)); // the enemy
    s = place(s, TARN(2), at(3, 4)); // a friendly Tarn already adjacent — blocks the direct lane
    s = place(s, TARN(1), at(3, 5)); // two hexes back, directly behind the friendly
    const roll = {
      rollDie: () => 'blank' as CombatFace,
      rollDice: (n: number) => Array.from({ length: n }, () => 'blank' as CombatFace),
      d20: () => 1,
    };
    // Drive the bot's MOVE phase (it activates the Tarn card holding order marker 1).
    for (let i = 0; i < 40; i++) {
      const intent = aiNextAction(s, 0);
      if (!intent || intent.kind !== 'move_step') break;
      s = unwrap(applyAction(s, 'p1', aiEngineAction(s, intent, roll)));
    }
    // It ends ADJACENT to the enemy (a strike hex) — moved up and around, not behind the friendly.
    expect(rangeDistance(MAPS[s.mapId].cells, fig(s, TARN(1)).at!, at(3, 3))).toBe(1);
    // And from there the bot's attack phase actually takes the swing.
    const afterEnd = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    const atk = aiNextAction(afterEnd, 0);
    expect(atk?.kind).toBe('attack');
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

// --- step-by-step (tap-each-space) movement --------------------------------

describe('step-by-step movement (move_step)', () => {
  const TV = (n: number) => `s0-tarn_vikings-${n}`;
  const ENEMY = 's1-finn-1';

  /** Set a 2-hex figure's full footprint (the `place` helper only sets the lead). */
  const place2 = (st: HSState, id: string, lead: string, tail: string): HSState => {
    const c: HSState = JSON.parse(JSON.stringify(st));
    const f = c.figures.find(x => x.id === id)!;
    f.at = lead;
    f.at2 = tail;
    return c;
  };

  /** A flat, glyph-free battle with one Tarn squad isolated facing a parked enemy. */
  function walker(): HSState {
    let s = customBattle(['tarn_vikings'], ['finn'], 'p1');
    s = clearExcept(s, TV(1), TV(2), ENEMY);
    s = place(s, ENEMY, at(6, 7));
    s = place(s, TV(1), at(3, 3));
    s = place(s, TV(2), at(0, 0));
    return s;
  }

  it('walks one hex per tap up to Move, and is not finalized until it stops', () => {
    let s = walker();
    const budget = effectiveMove(s, fig(s, TV(1))).dice;
    let steps = 0;
    for (;;) {
      const opts = [...legalStepHexes(s, TV(1))];
      if (opts.length === 0) break;
      s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: opts[0] }));
      expect(s.stepMove?.figureId).toBe(TV(1));
      expect(s.movedFigureIds).not.toContain(TV(1)); // unfinalized mid-walk
      if (++steps > budget + 4) throw new Error('walk did not terminate');
    }
    expect(steps).toBe(budget); // exactly Move single steps on the flat field
    expect(s.stepMove?.usedCost).toBe(budget);
  });

  it('fires a leaving swipe the STEP a start-engaged enemy is left — once per enemy', () => {
    let s = customBattle(['tarn_vikings'], ['marro_warriors'], 'p1');
    const M = 's1-marro_warriors-1';
    s = clearExcept(s, TV(1), M);
    s = place(s, TV(1), at(3, 3));
    s = place(s, M, at(3, 2)); // adjacent → engaged at the walk's start
    const leaveHex = [...legalStepHexes(s, TV(1))].find(k => {
      const c = stepConsequences(s, TV(1), k);
      return !('error' in c) && c.leavingEnemyIds.includes(M);
    })!;
    expect(leaveHex).toBeDefined();
    // The server must supply the swipe; omitting it is rejected.
    expect(errOf(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: leaveHex })))
      .toMatch(/do not match the abandoned enemies/);
    const afterLeave = unwrap(applyAction(s, 'p1', {
      kind: 'move_step', figureId: TV(1), to: leaveHex,
      leaveRolls: [{ enemyFigureId: M, roll: 'blank' }],
    }));
    expect(afterLeave.stepMove?.swiped).toContain(M); // the Marro has spent its one swipe
    expect(afterLeave.log.some(e => /swipes/.test(e.text))).toBe(true);
    // Any further step needs NO swipe — even one re-approaching the Marro (it already fired).
    const next = [...legalStepHexes(afterLeave, TV(1))][0];
    const after2 = unwrap(applyAction(afterLeave, 'p1', { kind: 'move_step', figureId: TV(1), to: next }));
    expect(after2.stepMove?.swiped).toContain(M);
  });

  it('engaging an enemy MID-walk and then leaving still draws its swipe (per-step, not move-start only)', () => {
    let s = customBattle(['tarn_vikings'], ['marro_warriors'], 'p1');
    const M = 's1-marro_warriors-1';
    const Mhex = at(3, 3);
    s = clearExcept(s, TV(1), M);
    s = place(s, M, Mhex);
    const onMap = (k: string) => !!MAPS[s.mapId].cells[k];
    const adjToM = (k: string) => neighborKeys(Mhex).includes(k);
    // enterHex: a hex adjacent to the Marro. startHex: adjacent to enterHex but NOT to the Marro,
    // so the walk BEGINS un-engaged with M.
    const enterHex = neighborKeys(Mhex).find(onMap)!;
    const startHex = neighborKeys(enterHex).find(k => onMap(k) && k !== Mhex && !adjToM(k))!;
    s = place(s, TV(1), startHex);
    // Step 1 onto enterHex — ENTERING the engagement draws NO swipe.
    const enter = stepConsequences(s, TV(1), enterHex);
    if ('error' in enter) throw new Error(enter.error);
    expect(enter.leavingEnemyIds).toEqual([]);
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: enterHex }));
    // Step 2 away from the Marro — leaving the MID-walk engagement → its swipe is now due.
    const leaveHex = neighborKeys(enterHex).find(k => onMap(k) && k !== Mhex && !adjToM(k) && k !== startHex) ?? startHex;
    const cons = stepConsequences(s, TV(1), leaveHex);
    if ('error' in cons) throw new Error(cons.error);
    expect(cons.leavingEnemyIds).toContain(M);
    expect(errOf(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: leaveHex })))
      .toMatch(/do not match the abandoned enemies/);
    const after = unwrap(applyAction(s, 'p1', {
      kind: 'move_step', figureId: TV(1), to: leaveHex,
      leaveRolls: [{ enemyFigureId: M, roll: 'blank' }],
    }));
    expect(after.stepMove?.swiped).toContain(M);
  });

  it('End move enters the ATTACK phase — no figure may move afterwards', () => {
    let s = walker();
    const a = [...legalStepHexes(s, TV(1))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: a }));
    s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
    expect(s.movementEnded).toBe(true);
    expect(s.stepMove).toBeUndefined();        // the in-progress walk was finalized
    expect(s.movedFigureIds).toContain(TV(1));
    // Movement is over for EVERY figure now — the board offers none, and the engine refuses.
    expect(legalStepHexes(s, TV(2)).size).toBe(0);
    expect(movementRangeHexes(s, TV(2)).size).toBe(0);
    expect(errOf(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(2), to: at(1, 0) })))
      .toMatch(/Movement is over/);
  });

  it('a swipe skull destroys the mover mid-walk and ends (finalizes) the move', () => {
    let s = customBattle(['tarn_vikings'], ['marro_warriors'], 'p1');
    const M = 's1-marro_warriors-1';
    s = clearExcept(s, TV(1), M);
    s = place(s, TV(1), at(3, 3));
    s = place(s, M, at(3, 2));
    const leaveHex = [...legalStepHexes(s, TV(1))].find(k => {
      const c = stepConsequences(s, TV(1), k);
      return !('error' in c) && c.leavingEnemyIds.includes(M);
    })!;
    const dead = unwrap(applyAction(s, 'p1', {
      kind: 'move_step', figureId: TV(1), to: leaveHex,
      leaveRolls: [{ enemyFigureId: M, roll: 'skull' }],
    }));
    expect(fig(dead, TV(1)).at).toBeNull();       // Life-1 Tarn dies to the swipe
    expect(dead.stepMove).toBeUndefined();        // the walk ended
    expect(dead.movedFigureIds).toContain(TV(1)); // and is locked as "moved"
  });

  it('end_move finalizes the walk; starting another figure finalizes the first', () => {
    const s = walker();
    const a = [...legalStepHexes(s, TV(1))][0];
    const mid = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: a }));
    expect(mid.stepMove?.figureId).toBe(TV(1));
    // End move locks it in.
    const ended = unwrap(applyAction(mid, 'p1', { kind: 'end_move' }));
    expect(ended.stepMove).toBeUndefined();
    expect(ended.movedFigureIds).toContain(TV(1));
    // Alternatively, stepping a DIFFERENT figure finalizes the first.
    const b = [...legalStepHexes(mid, TV(2))][0];
    const switched = unwrap(applyAction(mid, 'p1', { kind: 'move_step', figureId: TV(2), to: b }));
    expect(switched.movedFigureIds).toContain(TV(1));
    expect(switched.stepMove?.figureId).toBe(TV(2));
  });

  it('figures move ONE AT A TIME in any order: starting the next declares the previous done, and there is no going back', () => {
    let s = walker();
    // ANY ORDER — move the second figure first.
    const b1 = [...legalStepHexes(s, TV(2))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(2), to: b1 }));
    expect(s.stepMove?.figureId).toBe(TV(2));
    expect(s.movedFigureIds).not.toContain(TV(2)); // mid-walk, not yet locked
    // Starting a DIFFERENT figure DECLARES the first one done.
    const a1 = [...legalStepHexes(s, TV(1))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: a1 }));
    expect(s.movedFigureIds).toContain(TV(2)); // the first figure is now locked
    expect(s.stepMove?.figureId).toBe(TV(1));   // the second is the active walk
    // NO GOING BACK to the locked figure: the board offers it nothing, the engine refuses.
    expect(legalStepHexes(s, TV(2)).size).toBe(0);
    const a2 = [...legalStepHexes(s, TV(1))][0];
    expect(errOf(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(2), to: a2 })))
      .toMatch(/already moved/);
    // The active figure keeps stepping freely (one at a time).
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: a2 }));
    expect(fig(s, TV(1)).at).toBe(a2);
  });

  it('undo_move rewinds the entire multi-step walk', () => {
    let s = walker();
    const start = at(3, 3);
    const a = [...legalStepHexes(s, TV(1))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: a }));
    const b = [...legalStepHexes(s, TV(1))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: b }));
    expect(fig(s, TV(1)).at).toBe(b);
    const undone = unwrap(applyAction(s, 'p1', { kind: 'undo_move' }));
    expect(fig(undone, TV(1)).at).toBe(start); // all the way back to the walk's start
    expect(undone.stepMove).toBeUndefined();
    expect(undone.movedFigureIds).not.toContain(TV(1));
  });

  it('Ghost Walk steps THROUGH an enemy hex but cannot finalize on it (Agent Carr)', () => {
    let s = customBattle(['agent_carr'], ['finn', 'thorgrim'], 'p1');
    const CARR = 's0-agent_carr-1', E1 = 's1-finn-1', E2 = 's1-thorgrim-1';
    s = clearExcept(s, CARR, E1, E2);
    s = place(s, CARR, at(3, 3));
    s = place(s, E1, at(3, 2)); // an enemy directly beside Carr
    s = place(s, E2, at(6, 7)); // a second enemy alive, well out of the way
    // Carr steps ONTO the enemy's hex (Ghost Walk); Disengage suppresses any swipe.
    const onto = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: CARR, to: at(3, 2) }));
    expect(fig(onto, CARR).at).toBe(at(3, 2)); // transiently shares the hex
    expect(onto.stepMove?.figureId).toBe(CARR);
    // He may NOT stop there.
    expect(errOf(applyAction(onto, 'p1', { kind: 'end_move' }))).toMatch(/empty space/);
    // Stepping back onto his own (now vacated) hex is empty → he can finalize.
    const off = unwrap(applyAction(onto, 'p1', { kind: 'move_step', figureId: CARR, to: at(3, 3) }));
    const done = unwrap(applyAction(off, 'p1', { kind: 'end_move' }));
    expect(done.movedFigureIds).toContain(CARR);
    expect(done.stepMove).toBeUndefined();
  });

  it('a 2-hex figure slithers: front leads to the tapped hex, back follows into the vacated hex (either lobe can lead)', () => {
    let s = customBattle(['grimnak'], ['finn'], 'p1');
    const G = 's0-grimnak-1';
    s = clearExcept(s, G, ENEMY);
    s = place(s, ENEMY, at(6, 7));
    // A level peanut on the flat field: lead (3,3), tail (3,2) (proven-adjacent).
    s = place2(s, G, at(3, 3), at(3, 2));
    const opts = [...legalStepHexes(s, G)];
    // Leading with the LEAD lobe: the back slithers into the old lead hex.
    const leadStep = opts.find(k => {
      const c = stepConsequences(s, G, k);
      return !('error' in c) && c.newAt2 === at(3, 3);
    })!;
    expect(leadStep).toBeDefined();
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: G, to: leadStep }));
    expect(fig(moved, G).at).toBe(leadStep);  // front at the tapped hex
    expect(fig(moved, G).at2).toBe(at(3, 3)); // back followed into the vacated lead
    // EITHER lobe can be the front — a tail-led step also exists from the start.
    const tailStep = opts.find(k => {
      const c = stepConsequences(s, G, k);
      return !('error' in c) && c.newAt2 === at(3, 2);
    });
    expect(tailStep).toBeDefined();
  });

  it('a 2-hex move offers MULTIPLE anti-spin orientations for a common-neighbour lead; a chosen tail lands exactly that peanut', () => {
    let s = customBattle(['grimnak'], ['finn'], 'p1');
    const G = 's0-grimnak-1';
    s = clearExcept(s, G, ENEMY);
    s = place(s, ENEMY, at(6, 7));
    s = place2(s, G, at(3, 3), at(3, 2));
    // The 2nd-click case: a landing whose trailing hex has more than one legal orientation.
    const lead = [...legalDestinations(s, G)].find(l => moveTailOptions(s, G, l).size >= 2);
    expect(lead).toBeDefined();
    const tails = [...moveTailOptions(s, G, lead!)];
    // ANTI-SPIN: every offered tail is a same-distance neighbour of the lead (never the lead
    // itself) AND is itself a hex the figure could reach (a legal lead) or a current hex — so no
    // orientation extends the peanut past what its Move paid for (no full-spin → extra step).
    const reachable = new Set<string>([...movementRangeHexes(s, G), fig(s, G).at!, fig(s, G).at2!]);
    for (const t of tails) {
      expect(t).not.toBe(lead);
      expect(neighborKeys(lead!).includes(t)).toBe(true);
      expect(reachable.has(t)).toBe(true);
    }
    // Committing with an explicit, legal orientation lands EXACTLY {lead, tail}.
    const landed = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: G, to: lead!, to2: tails[1] }));
    expect(fig(landed, G).at).toBe(lead);
    expect(fig(landed, G).at2).toBe(tails[1]);
  });

  it('a 2-hex move REJECTS an orientation outside the anti-spin set (no free spin to steal a step)', () => {
    let s = customBattle(['grimnak'], ['finn'], 'p1');
    const G = 's0-grimnak-1';
    s = clearExcept(s, G, ENEMY);
    s = place(s, ENEMY, at(6, 7));
    s = place2(s, G, at(3, 3), at(3, 2));
    const lead = [...legalDestinations(s, G)].find(l => moveTailOptions(s, G, l).size >= 1)!;
    // tail === lead is a degenerate 1-hex footprint — rejected…
    expect('error' in applyAction(s, 'p1', { kind: 'move_figure', figureId: G, to: lead, to2: lead })).toBe(true);
    // …and so is a hex the engine never offered (here, two rings out, not adjacent to the lead).
    const options = moveTailOptions(s, G, lead);
    const bogus = neighborKeys(lead).flatMap(n => neighborKeys(n)).find(h => h !== lead && !neighborKeys(lead).includes(h) && !options.has(h));
    if (bogus) {
      expect('error' in applyAction(s, 'p1', { kind: 'move_figure', figureId: G, to: lead, to2: bogus })).toBe(true);
    }
    // Omitting to2 entirely still works (legacy single-orientation auto-pick).
    expect('error' in applyAction(s, 'p1', { kind: 'move_figure', figureId: G, to: lead })).toBe(false);
  });

  it('a 2-hex flyer DEFAULT move (no chosen tail) trails the back lobe behind the lead — never a hex past the destination (the "white dragon moves 7" bug)', () => {
    // Mimring: Move 6, baseSize 2, Flying. Flat training field with the enemy parked
    // in a far corner, so a move provokes no swipe/fall — committing with NO `to2`
    // exercises the engine's DEFAULT trailing-tail placement (moveTailFor).
    let s = customBattle(['mimring'], ['finn'], 'p1');
    const M = 's0-mimring-1';
    s = clearExcept(s, M, 's1-finn-1');
    s = place(s, 's1-finn-1', at(8, 8));
    s = place2(s, M, at(3, 3), at(2, 3)); // lead (3,3), trailing lobe one hex west
    const cells = MAPS[s.mapId].cells;
    const MOVE = effectiveMove(s, fig(s, M)).dice;
    const startLead = fig(s, M).at!;
    const startTail = fig(s, M).at2!;
    // Distance of a hex from the figure's STARTING footprint (nearer of the two lobes).
    const rd = (a: string, b: string) => rangeDistance(cells, a, b) ?? Infinity;
    const dStart = (k: string) => Math.min(rd(startLead, k), rd(startTail, k));

    let checked = 0;
    let sawAdvance = false; // at least one lead where the figure actually moved off its start
    for (const lead of legalDestinations(s, M)) {
      const moved = applyAction(s, 'p1', { kind: 'move_figure', figureId: M, to: lead });
      if ('error' in moved) continue;
      const at1 = fig(moved, M).at!;
      const at2 = fig(moved, M).at2!;
      expect(at1).toBe(lead); // the lead lands exactly where you tapped
      expect(neighborKeys(at1).includes(at2)).toBe(true); // a legal adjacent peanut
      // Both lobes stay within the Move the figure paid for (no lobe at Move+1).
      expect(dStart(at1)).toBeLessThanOrEqual(MOVE);
      expect(dStart(at2)).toBeLessThanOrEqual(MOVE);
      // THE FIX: whenever the lead actually advanced, the trailing lobe FOLLOWS behind —
      // it is never farther from the start than the lead. The old default took the first
      // neighbour (often the hex one step PAST the destination), so the tail jutted ahead
      // and a Move-6 dragon read as travelling 7. (Skip the degenerate "shuffle onto my
      // own start hex" lead, where dStart(lead) is 0 and a distance-1 tail is fine.)
      const dLead = dStart(at1);
      if (dLead >= 1) {
        sawAdvance = true;
        expect(dStart(at2)).toBeLessThanOrEqual(dLead);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(20); // it really did sweep the reachable leads
    expect(sawAdvance).toBe(true); // …including real forward moves (the bug's home)
  });

  it('a 2-hex FLYER (Mimring) ignores elevation — it can step onto a higher hex (flat-only deferral fixed)', () => {
    let s = customBattle(['mimring'], ['finn'], 'p1', CLIFF_MAP_ID);
    const M = 's0-mimring-1';
    s = clearExcept(s, M, 's1-finn-1');
    s = place(s, 's1-finn-1', at(6, 6)); // park the enemy far away
    const cells = MAPS[CLIFF_MAP_ID].cells;
    // A level (h1) grass hex that is adjacent to BOTH a taller pillar and another grass hex (for the tail).
    let lead = '', tail = '', pillar = '';
    for (const k of Object.keys(cells)) {
      if (cells[k].height !== 1) continue;
      const hi = neighborKeys(k).find(n => cells[n] && cells[n].height > 1);
      const lo = neighborKeys(k).find(n => cells[n] && cells[n].height === 1 && n !== k);
      if (hi && lo) { lead = k; tail = lo; pillar = hi; break; }
    }
    expect(lead).toBeTruthy();
    s = place2(s, M, lead, tail); // a level peanut beside a cliff
    expect(legalStepHexes(s, M).size).toBeGreaterThan(0); // NOT blocked by the surrounding elevation
    const c = stepConsequences(s, M, pillar);
    expect('error' in c).toBe(false); // flies up onto the higher pillar despite the height gap
  });

  it("a NEGATED card is base stats only — a Glyph-of-Nilrend-negated Braxas loses every printed power", () => {
    // Owner clarification: a negated card is "as if it only has base stats — no printed words below."
    // Braxas's printed powers are Acid Breath + Flying; negation strips BOTH — Flying via cardDefFor's
    // power-strip (so `flying` reads false everywhere) and Acid Breath via the special-power dispatcher
    // gate (the same gate proven for Fire Line). Only LIFE/MOVE/RNG/ATK/DEF remain.
    let s = customBattle(['braxas'], ['marro_warriors'], 'p1'); // Braxas active
    const B = 's0-braxas-1';
    s = clearExcept(s, B, 's1-marro_warriors-1');
    s = place(s, B, at(2, 2));
    s = place(s, 's1-marro_warriors-1', at(2, 4)); // a small/medium enemy in range
    s = { ...s, movementEnded: true }; // attack phase
    const braxasCard = s.cards.find(c => c.cardId === 'braxas')!;
    const neg = { ...s, negatedCardUids: [braxasCard.uid] };
    // ACID BREATH off — the special attack is blocked server-side with the negation message.
    // (Flying is also off — cardDefFor strips the flag — and is exercised by every flight test
    // reading through cardDefFor; the special-attack block is the behavioural lock here.)
    expect(errOf(applyAction(neg, 'p1', { kind: 'acid_breath', attackerId: B, rolls: [] }))).toMatch(/negat/i);
  });

  it('a GROUND 2-hex (Grimnak) may climb mid-move but must STOP on two level spaces', () => {
    let s = customBattle(['grimnak'], ['finn'], 'p1', CLIFF_MAP_ID);
    const G = 's0-grimnak-1';
    s = clearExcept(s, G, 's1-finn-1');
    s = place(s, 's1-finn-1', at(6, 6));
    const cells = MAPS[CLIFF_MAP_ID].cells;
    const climbCap = 1 + HS_CARDS.grimnak.height; // a ground figure may rise up to its Height
    // A grass lead beside a pillar it CAN climb (R5), plus a grass tail.
    let lead = '', tail = '', pillar = '';
    for (const k of Object.keys(cells)) {
      if (cells[k].height !== 1) continue;
      const hi = neighborKeys(k).find(n => cells[n] && cells[n].height > 1 && cells[n].height <= climbCap);
      const lo = neighborKeys(k).find(n => cells[n] && cells[n].height === 1 && n !== k);
      if (hi && lo) { lead = k; tail = lo; pillar = hi; break; }
    }
    expect(lead).toBeTruthy();
    s = place2(s, G, lead, tail);
    // Climb up onto the pillar — a cross-level footprint MID-move is allowed for a ground 2-hex.
    const up = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: G, to: pillar }));
    expect(fig(up, G).at).toBe(pillar);
    // …but it cannot STOP cross-level — finishing the move with mismatched lobe heights is rejected.
    expect(errOf(applyAction(up, 'p1', { kind: 'end_move' }))).toMatch(/level/i);
  });

  it('a 2-hex stops for water only when BOTH lobes are in it (one lobe keeps moving)', () => {
    let s = customBattle(['grimnak'], ['finn'], 'p1', WATER_MAP_ID);
    const G = 's0-grimnak-1';
    s = clearExcept(s, G, 's1-finn-1');
    s = place(s, 's1-finn-1', at(0, 0));
    const cells = MAPS[WATER_MAP_ID].cells;
    // lead = grass beside a water hex W1 that has a SECOND water neighbour W2, plus a grass tail.
    let lead = '', tail = '', w1 = '', w2 = '';
    for (const wk of Object.keys(cells).filter(k => cells[k].terrain === 'water')) {
      const w2cand = neighborKeys(wk).find(n => cells[n]?.terrain === 'water');
      const grass = neighborKeys(wk).find(n => cells[n]?.terrain === 'grass');
      const t = grass && neighborKeys(grass).find(n => cells[n]?.terrain === 'grass' && n !== grass);
      if (w2cand && grass && t) { w1 = wk; w2 = w2cand; lead = grass; tail = t; break; }
    }
    expect(lead).toBeTruthy();
    s = place2(s, G, lead, tail);
    // Front into the FIRST water hex — only one lobe in water → NOT a forced stop.
    const c1 = stepConsequences(s, G, w1);
    if ('error' in c1) throw new Error(c1.error);
    expect(c1.forcedStop).toBe(false);
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: G, to: w1 }));
    // Front into the SECOND water hex — now BOTH lobes are in water → forced stop.
    const c2 = stepConsequences(s, G, w2);
    if ('error' in c2) throw new Error(c2.error);
    expect(c2.forcedStop).toBe(true);
  });

  it('a 2-hex figure keeps an ENGAGED orientation when the landing allows it (owner: reach the space + stay engaged)', () => {
    // Repro 2026-06-24: Mimring (2-hex) reaching a glyph beside Finn was FORCED to disengage because the
    // trailing default tail pointed away. Now a 2-hex figure prefers the orientation that keeps a lobe
    // adjacent to a foe it started engaged with. Grimnak stands in (flat Training Field → engagement = adjacency).
    let s = customBattle(['grimnak'], ['finn'], 'p1');
    const G = 's0-grimnak-1', FINN = 's1-finn-1';
    s = clearExcept(s, G, FINN);
    const cells = MAPS[s.mapId].cells;
    const f = at(4, 4);
    s = place(s, FINN, f);
    const fN = neighborKeys(f).filter(k => cells[k]);
    const adjF = (k: string) => fN.includes(k);
    // a = an engaged-tail target adjacent to Finn; L = a lead adjacent to `a`, NOT adjacent to Finn, with
    // ANOTHER (disengaging) tail option too — so the engine genuinely has to CHOOSE to stay engaged.
    let a = '', L = '';
    for (const cand of fN) {
      const lead = neighborKeys(cand).find(k =>
        cells[k] && k !== f && !adjF(k) &&
        neighborKeys(k).some(t => cells[t] && t !== cand && t !== f && !adjF(t)));
      if (lead) { a = cand; L = lead; break; }
    }
    expect(a && L).toBeTruthy();
    expect(adjF(L)).toBe(false); // the lead itself is NOT adjacent to Finn — engagement must come from the tail
    // Grimnak starts engaged with Finn (a different lobe adjacent to f), clear of L and `a`.
    const gLead = fN.find(k => k !== a && k !== L)!;
    const gTail = neighborKeys(gLead).find(k => cells[k] && k !== f && k !== a && k !== L && cells[k].height === cells[gLead].height)!;
    expect(gLead && gTail).toBeTruthy();
    s = place2(s, G, gLead, gTail);
    // Move so the lead lands on L (NO to2 → the engine derives the tail). With NO leaveRolls supplied this
    // only succeeds if the engine kept the figure engaged — a disengage would require a swipe roll here.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: G, to: L }));
    const g = moved.figures.find(x => x.id === G)!;
    const foot = [g.at, g.at2].filter(Boolean) as string[];
    expect(foot).toContain(L); // landed on the chosen lead
    expect(foot.some(h => fN.includes(h))).toBe(true); // a lobe is STILL adjacent to Finn → it stayed engaged
  });

  it('EVERY 2-hex figure must finish LEVEL — flyers included (owner ruling 2026-06-25)', () => {
    // A R3 hex ringed by grass has NO same-level neighbour, so NO 2-hex figure may rest a lobe on it —
    // not a ground peanut (Grimnak) AND not a flyer (Mimring). A 2-hex figure always ends on two
    // same-height spaces.
    for (const cardId of ['grimnak', 'mimring']) {
      MAPS['test_peak'] = parseMap('test_peak', 'Test Peak', `
        row1@1: G1 G1 G1 G1 G1
        row2@1: G1 G1 G1 G1 G1
        row3:   G1 G1 R3 G1 G1
        row4:   G1 G1 G1 G1 G1
        row5@2: G1 G1 G1 G1 G1
        row6@2: G1 G1 G1 G1 G1
      `);
      let s = customBattle([cardId], ['marro_warriors'], 'p1', 'test_peak');
      const FIG = `s0-${cardId}-1`;
      s = clearExcept(s, FIG, 's1-marro_warriors-1');
      s = place(s, 's1-marro_warriors-1', at(0, 0)); // keep seat 1 alive, far off
      const cells = MAPS['test_peak'].cells;
      const peak = at(2, 2);
      expect(cells[peak].height).toBe(3);
      const lead = neighborKeys(peak).find(k => cells[k]?.height === 1)!;
      const tail = neighborKeys(lead).find(k => cells[k]?.height === 1 && k !== peak)!;
      s = place2(s, FIG, lead, tail);
      // The isolated peak has no same-level tail → it is NOT a legal landing for any 2-hex figure.
      expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: FIG, to: peak }))).toBeTruthy();
    }
  });

  it('the "max distance" range reflects REMAINING Move — full at the start, gone once it is spent', () => {
    let s = walker();
    const budget = effectiveMove(s, fig(s, TV(1))).dice;
    expect(movementRangeHexes(s, TV(1)).size).toBeGreaterThan(0); // full reach at the start
    // Spend all but the last point of Move.
    for (let i = 0; i < budget - 1; i++) {
      const opts = [...legalStepHexes(s, TV(1))];
      if (opts.length === 0) break;
      s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: opts[0] }));
    }
    expect(movementRangeHexes(s, TV(1)).size).toBeGreaterThan(0); // a step of reach still shown
    // Spend the final point — now nothing more is in reach.
    const last = [...legalStepHexes(s, TV(1))][0];
    s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: last }));
    expect(s.stepMove?.usedCost).toBe(budget);
    expect(movementRangeHexes(s, TV(1)).size).toBe(0); // Move exhausted → no range left
  });

  it('a whole walk collapses to ONE log line "origin → dest", not a line per hex', () => {
    let s = walker();
    const before = s.log.filter(e => e.tag === 'move').length;
    let steps = 0;
    for (;;) {
      const opts = [...legalStepHexes(s, TV(1))];
      if (opts.length === 0 || steps >= 3) break;
      s = unwrap(applyAction(s, 'p1', { kind: 'move_step', figureId: TV(1), to: opts[0] }));
      steps++;
    }
    expect(steps).toBeGreaterThanOrEqual(2); // genuinely multi-hex
    const moveLines = s.log.filter(e => e.tag === 'move');
    expect(moveLines.length).toBe(before + 1); // ONE line for the whole walk, not one per step
    expect(moveLines[moveLines.length - 1].text).toMatch(/moves .+→.+/); // the "x → y" form
  });

  it('a turn start logs one "<card> activates" line tagged for the active seat colour', () => {
    const s = inTurns('p1', { p1: 's0-finn' });
    const acts = s.log.filter(e => e.tag === 'activate');
    expect(acts).toHaveLength(1);
    expect(acts[0].seat).toBe(0); // coloured in the owner's hue on the board
    expect(acts[0].text.endsWith(' activates')).toBe(true);
    // the old verbose "…reveals order marker N — … acts." headline is gone for a live card
    expect(s.log.some(e => /reveals order marker.*acts/.test(e.text))).toBe(false);
  });
});

// --- aura-active indicators -------------------------------------------------

describe('aura-active indicators (auraBuffedFigureIds)', () => {
  const TV = (n: number) => `s0-tarn_vikings-${n}`;

  it('Finn buffs an adjacent friendly Range-1 figure; an adjacent ENEMY and Finn himself get nothing', () => {
    let s = customBattle(['finn', 'tarn_vikings'], ['marro_warriors'], 'p1');
    const FINN = 's0-finn-1', M1 = 's1-marro_warriors-1';
    s = clearExcept(s, FINN, TV(1), M1);
    s = place(s, FINN, at(3, 3));
    s = place(s, TV(1), at(3, 2)); // friendly melee adjacent → Finn-buffed
    s = place(s, M1, at(2, 3));    // ENEMY adjacent to Finn → gets nothing from your aura
    const b = auraBuffedFigureIds(s);
    expect(b.has(TV(1))).toBe(true);
    expect(b.has(M1)).toBe(false);
    expect(b.has(FINN)).toBe(false);
  });

  it('Thorgrim buffs any adjacent friendly, but not himself', () => {
    let s = customBattle(['thorgrim', 'tarn_vikings'], ['finn'], 'p1');
    const THOR = 's0-thorgrim-1';
    s = clearExcept(s, THOR, TV(1), 's1-finn-1');
    s = place(s, THOR, at(3, 3));
    s = place(s, TV(1), at(3, 2));
    s = place(s, 's1-finn-1', at(6, 7));
    const b = auraBuffedFigureIds(s);
    expect(b.has(TV(1))).toBe(true);
    expect(b.has(THOR)).toBe(false);
  });

  it('Raelin buffs a friendly within 4 clear-sight spaces, excluding herself', () => {
    let s = customBattle(['raelin', 'tarn_vikings'], ['finn'], 'p1');
    const RAEL = 's0-raelin-1';
    s = clearExcept(s, RAEL, TV(1), 's1-finn-1');
    s = place(s, RAEL, at(3, 3));
    s = place(s, TV(1), at(3, 5)); // 2 spaces away (≤4), clear sight → buffed
    s = place(s, 's1-finn-1', at(6, 7));
    const b = auraBuffedFigureIds(s);
    expect(b.has(TV(1))).toBe(true);
    expect(b.has(RAEL)).toBe(false);
  });

  it('auraCoverageHexes outlines an aura’s REACH, follows the source, and is empty for a negated source', () => {
    // Finn — an ADJACENCY aura: his on-map hex-neighbours PLUS his own hex (the source footprint is
    // included so the gold outline is one clean perimeter with no inner ring around the figure).
    let f = customBattle(['finn'], ['marro_warriors'], 'p1');
    f = clearExcept(f, 's0-finn-1', 's1-marro_warriors-1');
    f = place(f, 's0-finn-1', at(3, 3));
    f = place(f, 's1-marro_warriors-1', at(0, 0));
    const cells = MAPS[f.mapId].cells;
    const finnNbrs = neighborKeys(at(3, 3)).filter(n => cells[n]);
    const covF = auraCoverageHexes(f);
    expect(finnNbrs.length).toBeGreaterThan(0);
    for (const n of finnNbrs) expect(covF.has(n)).toBe(true);
    expect(covF.has(at(3, 3))).toBe(true); // own hex now filled (no inner-ring hole)
    expect(covF.size).toBe(finnNbrs.length + 1); // Finn alone = his neighbours + his own hex
    // The outline MOVES with the source: old neighbours clear, the new ones light.
    const covF2 = auraCoverageHexes(place(f, 's0-finn-1', at(5, 1)));
    expect(neighborKeys(at(5, 1)).some(n => covF2.has(n))).toBe(true);
    expect(neighborKeys(at(3, 3)).every(n => !covF2.has(n))).toBe(true);
    // A Glyph-of-Nilrend-negated source projects NO aura outline.
    expect(auraCoverageHexes({ ...f, negatedCardUids: ['s0-finn'] }).size).toBe(0);

    // Raelin — a RANGE-4 + clear-sight aura: reaches FAR more than mere adjacency.
    let r = customBattle(['raelin'], ['marro_warriors'], 'p1');
    r = clearExcept(r, 's0-raelin-1', 's1-marro_warriors-1');
    r = place(r, 's0-raelin-1', at(3, 3));
    r = place(r, 's1-marro_warriors-1', at(0, 0));
    const covR = auraCoverageHexes(r);
    expect(covR.size).toBeGreaterThan(neighborKeys(at(3, 3)).length); // bigger than just neighbours
    expect(covR.has(at(3, 3))).toBe(true); // her own hex is filled too (no inner ring)
  });
});

// --- Raelin's DEFENSIVE AURA (RotV card: within 4 clear sight, +2 defense) ---

describe('Raelin Defensive Aura (RotV card)', () => {
  const TV = (n: number) => `s0-tarn_vikings-${n}`;
  it('adds +2 defense dice to a friendly within 4 clear-sight spaces', () => {
    let s = noGlyphs(customBattle(['raelin', 'tarn_vikings'], ['finn'], 'p1'));
    const RAEL = 's0-raelin-1';
    s = clearExcept(s, RAEL, TV(1), 's1-finn-1');
    s = place(s, RAEL, at(3, 4));
    s = place(s, TV(1), at(3, 5)); // 1 space from Raelin (≤4) → +2 defense
    s = place(s, 's1-finn-1', at(3, 6)); // p2 attacker beside the Tarn
    const eff = effectiveDefenseDice(s, fig(s, TV(1)), fig(s, 's1-finn-1'));
    expect(eff.dice).toBe(6); // Tarn Defense 4 + 2 Raelin aura
    expect(eff.breakdown).toContain('+2 Raelin aura');
  });

  it('does NOT reach a friendly beyond 4 spaces', () => {
    let s = noGlyphs(customBattle(['raelin', 'tarn_vikings'], ['finn'], 'p1'));
    const RAEL = 's0-raelin-1';
    s = clearExcept(s, RAEL, TV(1), 's1-finn-1');
    s = place(s, RAEL, at(0, 1));
    s = place(s, TV(1), at(6, 8)); // opposite corner (>4) → no aura
    s = place(s, 's1-finn-1', at(5, 8));
    const eff = effectiveDefenseDice(s, fig(s, TV(1)), fig(s, 's1-finn-1'));
    expect(eff.dice).toBe(4); // Tarn Defense 4, no aura
    expect(eff.breakdown).not.toContain('+2 Raelin aura');
  });
});

// --- Card editions (Classic vs Modern) --------------------------------------

describe('card editions (Classic vs Modern)', () => {
  it('effectiveCardDef folds Classic point overrides; Modern is the printed card', () => {
    expect(effectiveCardDef('raelin', 'modern')!.points).toBe(125);
    expect(effectiveCardDef('marro_warriors', 'modern')!.points).toBe(105);
    expect(effectiveCardDef('raelin', 'classic')!.points).toBe(80);
    expect(effectiveCardDef('marro_warriors', 'classic')!.points).toBe(50);
    expect(effectiveCardDef('grimnak', 'classic')!.points).toBe(120);
    expect(effectiveCardDef('major_q9', 'classic')!.points).toBe(180);
    expect(effectiveCardDef('nilfheim', 'classic')!.points).toBe(185);
  });

  it('Classic is POINTS-ONLY — every other stat matches Modern', () => {
    for (const id of Object.keys(CLASSIC_OVERRIDES)) {
      const m = effectiveCardDef(id, 'modern')!;
      const c = effectiveCardDef(id, 'classic')!;
      expect({ ...c, points: m.points }).toEqual(m); // only points may differ
    }
  });

  it('an absent edition defaults to Modern (back-compat for old saves)', () => {
    expect(effectiveCardDef('raelin', undefined)!.points).toBe(125);
    expect(effectiveCardDef('raelin', undefined)).toEqual(HS_CARDS.raelin);
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
  it('height-aware sight: a figure SEES over a hill it towers over, but a TALL wall still blocks', () => {
    // A Marro on the west shoulder (1,3) G2 and Finn on the east shoulder (7,3) G2 — both on height-2
    // land, with the R3/R4 summit (max height 4) on the line between them. A Marro is HEIGHT 4, so
    // its EYE sits at 2+4 = 6 — two ABOVE the summit — and it sees clean across. (The old ground-eye
    // model wrongly pinned its eye at height-3 and reported "blocked" — the very "I tower over that
    // hill but can't see past it" bug this rule fixes.)
    let s = inTurnsOn('the_knoll', 'p2', { p2: 's1-marro_warriors' });
    s = place(s, MARRO(1), at(1, 3));
    s = place(s, FINN, at(7, 3));
    expect(legalTargets(s, MARRO(1))).toContain(FINN);
    // But raise a mid hex into a TALL WALL (height 15 — over any figure's eye) and sight is blocked.
    const cells = MAPS[s.mapId].cells;
    const mid = at(4, 3);
    const origH = cells[mid].height;
    cells[mid].height = 15;
    const blocked = !legalTargets(s, MARRO(1)).includes(FINN);
    cells[mid].height = origH; // restore (MAPS is shared across tests)
    expect(blocked).toBe(true);
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

  it('the Spirit may be placed on ANY living unique card (the verified text is not friendly-restricted)', () => {
    // Printed card text (high-res verified, docs/heroscape/extraction/cards-page-1.md):
    // "place this figure on any unique Army Card" — no "your". So an opponent's living
    // unique card must be offered too (the owner just won't pick it in practice).
    const before = finnAtDeath();
    const s = unwrap(applyAction(before, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    const options = s.pendingChoice?.kind === 'spirit_placement' ? s.pendingChoice.options : [];
    expect(options.length).toBeGreaterThan(0);
    // every option is a unique card with a living figure...
    for (const uid of options) expect(s.cards.find(c => c.uid === uid)).toBeTruthy();
    // ...including at least one of the OWNER's own (Tarn / Thorgrim survive)...
    expect(options.some(uid => s.cards.find(c => c.uid === uid)!.ownerSeat === 0)).toBe(true);
    // ...and the opponent's living Marro card is offered as well (faithful: any unique card).
    expect(options.some(uid => s.cards.find(c => c.uid === uid)!.ownerSeat === 1)).toBe(true);
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

  it('the Spirit placement is OPTIONAL — declining (cardUid "") buffs no card (owner 2026-06-26)', () => {
    let s = unwrap(applyAction(finnAtDeath(), 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    expect(s.pendingChoice?.kind).toBe('spirit_placement');
    const snapshot = s.cards.map(c => `${c.uid}:${c.attackMod}/${c.defenseMod}`).join('|');
    // p1 DECLINES — nobody is forced to receive the Spirit; it is simply lost.
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: '' } }));
    expect(s.pendingChoice).toBeUndefined();
    expect(s.cards.map(c => `${c.uid}:${c.attackMod}/${c.defenseMod}`).join('|')).toBe(snapshot); // no mods changed
    expect(s.log.some(e => /declines to place/i.test(e.text))).toBe(true);
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

  it('destroying Eldgrim opens a SWIFTNESS spirit → +1 MOVE forever on the chosen card', () => {
    let s = customBattle(['eldgrim', 'tarn_vikings'], ['marro_warriors'], 'p2'); // p2's Marro acts
    const E = 's0-eldgrim-1', T = 's0-tarn_vikings-1', M = 's1-marro_warriors-1';
    s = clearExcept(s, E, T, M);
    s = place(s, E, at(3, 4));
    s = place(s, T, at(0, 0)); // a p1 figure survives → the game continues
    s = place(s, M, at(3, 5)); // adjacent p2 attacker
    s = wound(s, E, 2); // Life 3 → one unblocked skull finishes him
    s = unwrap(applyAction(s, 'p2', { kind: 'attack', attackerId: M, targetId: E, attackRoll: F('kb'), defenseRoll: F('bb') }));
    expect(fig(s, E).at).toBeNull();
    expect(s.phase).toBe('playing');
    expect(s.pendingChoice).toMatchObject({ kind: 'spirit_placement', seat: 0, spirit: 'move' });
    // p1 (Eldgrim's owner) places the Swiftness Spirit on the Tarn squad → +1 effective Move.
    const tarnUid = s.cards.find(c => c.cardId === 'tarn_vikings' && c.ownerSeat === 0)!.uid;
    const before = effectiveMove(s, fig(s, T)).dice;
    s = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'spirit_placement', cardUid: tarnUid } }));
    expect(s.cards.find(c => c.uid === tarnUid)!.moveMod).toBe(1);
    expect(effectiveMove(s, fig(s, T)).dice).toBe(before + 1);
    expect(effectiveMove(s, fig(s, T)).breakdown).toContain('+1 Swiftness Spirit');
  });

  describe('Eldgrim — OVEREXTEND ATTACK (a wound buys another turn; once per round)', () => {
    const E = 's0-eldgrim-1';
    const ENEMY = 's1-marro_warriors-1';
    /** Eldgrim active for p1, parked away from a lone enemy on the flat field (so the
     *  enemy survives and the game keeps going while we exercise the power). */
    function staged(): HSState {
      let s = customBattle(['eldgrim'], ['marro_warriors'], 'p1');
      s = clearExcept(s, E, ENEMY);
      s = place(s, E, at(3, 3));
      s = place(s, ENEMY, at(6, 7));
      return s;
    }

    it('is NOT offered until he has taken his turn, then accepts: self-wound + FRESH turn, still active', () => {
      let s = staged();
      expect(getActiveCardUid(s)).toBe('s0-eldgrim');
      // "After taking a turn" — before he acts, the power is unavailable and rejected.
      expect(canOverextend(s, 0)).toBe(false);
      expect(errOf(applyAction(s, 'p1', { kind: 'overextend', figureId: E }))).toMatch(/Overextend/);
      // Ending his move counts as taking his turn → now available.
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
      expect(s.movementEnded).toBe(true);
      expect(canOverextend(s, 0)).toBe(true);
      const round = s.round;
      s = unwrap(applyAction(s, 'p1', { kind: 'overextend', figureId: E }));
      expect(fig(s, E).wounds).toBe(1);                              // the self-wound landed
      expect(s.turnSeat).toBe(0);                                    // STILL his turn
      expect(getActiveCardUid(s)).toBe('s0-eldgrim');                // STILL the active card
      expect(s.movementEnded).toBe(false);                           // a FRESH turn — he can move again
      expect(s.cards.find(c => c.uid === 's0-eldgrim')!.overextendRound).toBe(round);
      expect(s.log.some(e => /Overextends/.test(e.text))).toBe(true);
    });

    it('is ONCE PER ROUND — a second Overextend is rejected even after another move', () => {
      let s = staged();
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
      s = unwrap(applyAction(s, 'p1', { kind: 'overextend', figureId: E }));
      expect(canOverextend(s, 0)).toBe(false);                       // spent for the round
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));        // take the bonus turn…
      expect(canOverextend(s, 0)).toBe(false);                       // …still can't go a third time
      expect(errOf(applyAction(s, 'p1', { kind: 'overextend', figureId: E }))).toMatch(/Overextend/);
    });

    it('is BLOCKED when the self-wound would destroy him (no suicide)', () => {
      let s = staged();
      s = wound(s, E, 2);                                            // Life 3 → one more wound is lethal
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
      expect(canOverextend(s, 0)).toBe(false);
      expect(errOf(applyAction(s, 'p1', { kind: 'overextend', figureId: E }))).toMatch(/Overextend/);
    });

    it('is BLOCKED while Eldgrim is negated by the Glyph of Nilrend (base stats only — no power)', () => {
      let s = staged();
      s = unwrap(applyAction(s, 'p1', { kind: 'end_move' }));
      expect(canOverextend(s, 0)).toBe(true);
      s.negatedCardUids = ['s0-eldgrim'];
      expect(canOverextend(s, 0)).toBe(false);
      // The dispatcher's special-power-negation gate catches it first → the shared negation message.
      expect(errOf(applyAction(s, 'p1', { kind: 'overextend', figureId: E }))).toMatch(/negated by the Glyph of Nilrend/);
    });

    it('AI presses on — a HEALTHY Eldgrim that fought Overextends; a WOUNDED one banks the wound and ends', () => {
      let s = staged();
      // Simulate "he took his turn and swung": attack phase + a recorded Eldgrim attack.
      s = { ...s, movementEnded: true, turnAttacks: [{ attackerId: E, targetId: ENEMY }] };
      expect(aiNextAction(s, 0)).toEqual({ kind: 'overextend', figureId: E });
      // The same bot, already wounded, won't grind itself down — it ends the turn instead.
      const hurt = { ...s, figures: s.figures.map(f => (f.id === E ? { ...f, wounds: 1 } : f)) };
      expect(aiNextAction(hurt, 0)?.kind).toBe('end_turn');
    });
  });

  it('a NEGATED Finn leaves no Attack Spirit when destroyed (Glyph of Nilrend strips the power)', () => {
    // The user hit this: a negated Finn died and STILL prompted a Warrior's Attack Spirit.
    // Negation = base stats only, so the death-trigger power must not fire.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' })); // p2 acts → its Marro attacks
    s = clearExcept(s, FINN, TARN(1), MARRO(1));
    s = place(s, FINN, at(3, 4));
    s = wound(s, FINN, 3); // Life 4 — one unblocked skull finishes him
    s = place(s, MARRO(1), at(3, 5)); // p2 attacker, adjacent
    s = place(s, TARN(1), at(0, 0)); // a p1 figure survives → game continues
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.negatedCardUids = ['s0-finn']; // Finn's card is negated
    s = unwrap(applyAction(s, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    expect(fig(s, FINN).at).toBeNull(); // Finn is destroyed
    expect(s.phase).toBe('playing'); // game continues (Tarn alive)
    expect(s.pendingChoice).toBeUndefined(); // …but NO Spirit placement — the power was negated
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

  it('HIVE SUPREMACY (Su-Bak-Na) gives a friendly Marro d20 +1 — a Water Clone 14 then clears the 15 bar (owner 2026-06-26)', () => {
    expect(HS_CARDS.su_bak_na).toMatchObject({ type: 'hero', life: 5, move: 6, range: 1, attack: 7, defense: 3, height: 12, points: 160, flying: true, hiveSupremacy: true, baseSize: 2 });
    // A friendly (seat-1) living Su-Bak-Na makes a Marro Water Clone on grass succeed on 14 (+1 Hive = 15).
    let s = JSON.parse(JSON.stringify(stagedMarro())) as HSState;
    s.cards.push({ uid: 's1-su_bak_na', cardId: 'su_bak_na', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-su_bak_na-1', cardUid: 's1-su_bak_na', ownerSeat: 1, at: at(5, 5), at2: at(5, 6), index: 1, wounds: 0 });
    const hive = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [{ marroFigureId: MARRO(1), d20: 14 }, { marroFigureId: MARRO(2), d20: 3 }] }));
    expect(hive.pendingChoice?.kind).toBe('water_clone_place'); // 14 + 1 Hive = 15 → cloned
    // Without Su-Bak-Na the same 14 FAILS (no placement choice opens).
    const noHive = unwrap(applyAction(stagedMarro(), 'p2', { kind: 'water_clone', rolls: [{ marroFigureId: MARRO(1), d20: 14 }, { marroFigureId: MARRO(2), d20: 3 }] }));
    expect(noHive.pendingChoice).toBeUndefined();
  });

  it('HIVE SUPREMACY STACKS with Lodin — two Lodin glyphs + Su-Bak-Na = +3 to a Marro d20 (owner 2026-06-26)', () => {
    let s = JSON.parse(JSON.stringify(stagedMarro())) as HSState;
    // Su-Bak-Na (seat 1) alive → +1 Hive to a friendly Marro d20.
    s.cards.push({ uid: 's1-su_bak_na', cardId: 'su_bak_na', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-su_bak_na-1', cardUid: 's1-su_bak_na', ownerSeat: 1, at: at(5, 5), at2: at(5, 6), index: 1, wounds: 0 });
    // TWO Lodin glyphs, both held under Su-Bak-Na's two lobes → seatGlyphCount = 2 (+2). With Hive that's +3.
    s = setGlyphs(s, [{ id: 'lodin', at: at(5, 5), faceUp: true }, { id: 'lodin', at: at(5, 6), faceUp: true }]);
    // 12 + 2 Lodin + 1 Hive = 15 → clears the Water Clone bar (placement choice opens).
    const yes = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [{ marroFigureId: MARRO(1), d20: 12 }, { marroFigureId: MARRO(2), d20: 3 }] }));
    expect(yes.pendingChoice?.kind).toBe('water_clone_place');
    // 11 + 3 = 14 → still short of 15 (pins the bonus at EXACTLY +3, not +4 or +2).
    const no = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [{ marroFigureId: MARRO(1), d20: 11 }, { marroFigureId: MARRO(2), d20: 3 }] }));
    expect(no.pendingChoice).toBeUndefined();
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
    expect(errOf(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: shared } }))).toMatch(/adjacent to that Marro Warrior/);
  });

  it('a Marro standing IN water may clone UP onto the higher adjacent shore (owner 2026-06-26)', () => {
    // The printed rule says "a same-level space adjacent"; on a SUNKEN water tile (water below its
    // bank) a Marro would have no same-level shore and the card's lowered water threshold would be
    // wasted. The water relaxation lets a Marro standing IN water clone up onto the adjacent bank.
    const map = MAPS['ford_crossing'];
    let s = noGlyphs(inTurnsOn('ford_crossing', 'p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), MARRO(2), MARRO(3), FINN);
    s = place(s, MARRO(3), null); // destroyed → available to return
    s = place(s, MARRO(2), at(0, 0));
    s = place(s, FINN, at(9, 6));
    s = unwrap(applyAction(s, 'p2', { kind: 'move_figure', figureId: MARRO(2), to: at(0, 1) })); // after-move window
    // Find a water hex (W1) with a strictly-HIGHER empty land neighbour (a G2 bank). Old rule barred
    // that shore (height 2 ≠ water's 1); the relaxation now offers it.
    const taken = new Set(s.figures.filter(f => f.at != null).map(f => f.at!));
    let waterHex = '', shoreUp = '';
    for (const k of Object.keys(map.cells)) {
      if (map.cells[k].terrain !== 'water' || taken.has(k)) continue;
      const up = neighborKeys(k).find(n => map.cells[n] && map.cells[n].height > map.cells[k].height && !taken.has(n));
      if (up) { waterHex = k; shoreUp = up; break; }
    }
    expect(waterHex).not.toBe(''); // Ford Crossing really has water sitting below a higher bank
    s = place(s, MARRO(1), waterHex); // the roller stands IN the water
    s = unwrap(applyAction(s, 'p2', { kind: 'water_clone', rolls: [
      { marroFigureId: MARRO(1), d20: 12 }, // 10+ on water → success
      { marroFigureId: MARRO(2), d20: 3 },  // on grass → fail
    ] }));
    const pc = s.pendingChoice as { placements: { rollerFigureId: string; options: string[] }[] } | undefined;
    expect(pc).toBeDefined();
    expect(pc!.placements[0].rollerFigureId).toBe(MARRO(1));
    expect(pc!.placements[0].options).toContain(shoreUp); // the +1 shore is a legal landing now
    s = unwrap(applyAction(s, 'p2', { kind: 'resolve_choice', choice: { kind: 'water_clone_place', hex: shoreUp } }));
    expect(fig(s, MARRO(3)).at).toBe(shoreUp); // the destroyed Marro returns up on the bank
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

describe('projection: face-down glyphs are hidden on the wire', () => {
  it('masks a face-down glyph id (keeps its hex) and leaves a revealed one public', () => {
    let s = inTurnsOn(CORRIDOR_MAP_ID, 'p1', { p1: 's0-finn' });
    const downHex = at(2, 2);
    const upHex = at(2, 3);
    s = setGlyphs(s, [
      { id: 'mitonsoul', at: downHex, faceUp: false },
      { id: 'astrid', at: upHex, faceUp: true },
    ]);
    const proj = projectStateForViewer(s, 'p2');
    const down = proj.glyphs.find(g => g.at === downHex)!;
    const up = proj.glyphs.find(g => g.at === upHex)!;
    expect(down.id).not.toBe('mitonsoul'); // identity masked off the wire
    expect(down.faceUp).toBe(false);
    expect(down.at).toBe(downHex); // hex still known so the "?" marker renders
    expect(up.id).toBe('astrid'); // a revealed glyph is public
    // glyphs are neutral/secret to everyone — even projecting to p1 masks the face-down id.
    expect(projectStateForViewer(s, 'p1').glyphs.find(g => g.at === downHex)!.id).not.toBe('mitonsoul');
  });
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

  it('Erland (Summoning) is a forced stop AND opens a summon choice', () => {
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
    // Now LIVE: stopping on Erland opens a glyph_erland choice (the glyph is removed at
    // resolution, so it's still present here). Thorgrim is a summonable single-hex figure.
    expect(moved.pendingChoice?.kind).toBe('glyph_erland');
    expect(moved.glyphs.find(g => g.id === 'erland')).toBeDefined();
    expect(erlandSummonableIds(moved)).toContain(THORGRIM);
    expect(erlandDestinations(moved).length).toBeGreaterThan(0);
  });
});

describe('wave-3 CHOICE glyphs — Erland / Nilrend / Wannok', () => {
  // ---------------- ERLAND: Summoning (pure teleport) ----------------
  it('Erland summons any single-hex figure to an empty adjacent space, then fades', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = place(s, FINN, at(3, 2));
    s = place(s, THORGRIM, at(0, 0)); // an opponent figure, far away
    s = place(s, MARRO(1), at(6, 6)); // keeps p2 alive elsewhere
    s = setGlyphs(s, [{ id: 'erland', at: at(3, 3), faceUp: true }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 3) }));
    expect(moved.pendingChoice?.kind).toBe('glyph_erland');
    const dest = erlandDestinations(moved)[0];
    expect(dest).toBeTruthy();
    // teleport the opponent's Thorgrim next to Finn — no swipes, no fall
    const after = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_erland', figureId: THORGRIM, to: dest } }));
    expect(fig(after, THORGRIM).at).toBe(dest);
    expect(after.pendingChoice).toBeUndefined();
    expect(after.glyphs.find(g => g.id === 'erland')).toBeUndefined(); // temporary — consumed
  });

  it('Erland can summon a HUGE 2-hex figure (Su-Bak-Na) — both lobes land beside the summoner (owner 2026-06-26)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, MARRO(1));
    s = place(s, FINN, at(3, 2));
    s = place(s, MARRO(1), at(6, 6)); // keep p2 alive elsewhere
    // An opponent (seat 1) Su-Bak-Na sitting far from the glyph, occupying TWO hexes.
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.push({ uid: 's1-su_bak_na', cardId: 'su_bak_na', ownerSeat: 1, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    s.figures.push({ id: 's1-su_bak_na-1', cardUid: 's1-su_bak_na', ownerSeat: 1, at: at(0, 0), at2: at(1, 0), index: 1, wounds: 0 });
    s = setGlyphs(s, [{ id: 'erland', at: at(3, 3), faceUp: true }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 3) }));
    expect(moved.pendingChoice?.kind).toBe('glyph_erland');
    // The 2-hex figure is now offered (the old engine excluded every figure with at2 set).
    expect(erlandSummonableIds(moved)).toContain('s1-su_bak_na-1');
    const lead = at(3, 4); // a central empty neighbour of Finn — room for the trailing lobe
    expect(erlandDestinations(moved)).toContain(lead);
    const after = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_erland', figureId: 's1-su_bak_na-1', to: lead } }));
    const sb = after.figures.find(f => f.id === 's1-su_bak_na-1')!;
    expect(sb.at).toBe(lead);          // lead lobe on the chosen space
    expect(sb.at2).toBeTruthy();       // trailing lobe placed too (no more null at2)
    expect(sb.at2).not.toBe(sb.at);    // two distinct hexes
    expect(after.pendingChoice).toBeUndefined();
    expect(after.glyphs.find(g => g.id === 'erland')).toBeUndefined(); // consumed
  });

  // ---------------- NILREND: Negation ----------------
  it('Nilrend: stop → server d20 (2+) → controller negates an opponent unique card (game-long)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, MARRO(1));
    s = place(s, FINN, at(3, 2));
    s = place(s, MARRO(1), at(6, 6));
    s = setGlyphs(s, [{ id: 'nilrend', at: at(3, 3), faceUp: true }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: at(3, 3) }));
    expect(moved.pendingChoice?.kind).toBe('glyph_nilrend');
    // server rolls the d20 (≥2 → the OPPONENT side); the pick stays open
    const rolled = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', d20: 18 } }));
    expect(rolled.pendingChoice?.kind).toBe('glyph_nilrend');
    const marroCard = rolled.cards.find(c => c.cardId === 'marro_warriors')!;
    const done = unwrap(applyAction(rolled, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', cardUid: marroCard.uid } }));
    expect(done.negatedCardUids).toContain(marroCard.uid);
    expect(done.glyphs.find(g => g.id === 'nilrend')).toBeUndefined(); // temporary — consumed
  });

  it('a negated card stops granting its aura (Finn Attack Aura turns off → base stats)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings' }));
    s = clearExcept(s, FINN, TARN(1), THORGRIM);
    s = place(s, FINN, at(3, 3));
    s = place(s, TARN(1), at(3, 4)); // adjacent Range-1 friendly → +1 Finn aura
    s = place(s, THORGRIM, at(3, 5));
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, THORGRIM)).breakdown).toContain('+1 Finn aura');
    const finnCard = s.cards.find(c => c.cardId === 'finn')!;
    const neg = { ...s, negatedCardUids: [finnCard.uid] };
    const eff = effectiveAttackDice(neg, fig(neg, TARN(1)), fig(neg, THORGRIM));
    expect(eff.breakdown).not.toContain('+1 Finn aura'); // Nilrend killed the aura
    expect(eff.dice).toBe(3); // base Tarn attack, no buff
  });

  it("a Nilrend-negated Finn does NOTHING — no aura to ANOTHER army AND no Spirit on death (the user's report)", () => {
    // "finn was hit with the negation glyph — none of his powers should have worked, including
    // buffing another army." Both halves of that, end to end, through one negated card.
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' })); // p2 acts → its Marro can attack
    s = clearExcept(s, FINN, TARN(1), MARRO(1));
    s = place(s, FINN, at(3, 4));
    s = place(s, TARN(1), at(3, 5)); // p1's OTHER army (Range-1), adjacent to Finn → eligible for the aura
    s = place(s, MARRO(1), at(3, 3)); // p2 attacker, adjacent to Finn
    // Baseline (Finn NOT negated): the Tarn Viking — a DIFFERENT army — gets Finn's +1 aura.
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, MARRO(1))).breakdown).toContain('+1 Finn aura');
    // Negate Finn's card (Glyph of Nilrend).
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.negatedCardUids = ['s0-finn'];
    // 1) The other army no longer gets the aura — base stats.
    expect(effectiveAttackDice(s, fig(s, TARN(1)), fig(s, MARRO(1))).breakdown).not.toContain('+1 Finn aura');
    // 2) Killing the negated Finn leaves NO Warrior's Attack Spirit to place.
    s = wound(s, FINN, 3); // Life 4 → one unblocked skull finishes him
    s = unwrap(applyAction(s, 'p2', { kind: 'attack', attackerId: MARRO(1), targetId: FINN, attackRoll: F('kb'), defenseRoll: F('bbbb') }));
    expect(fig(s, FINN).at).toBeNull(); // destroyed
    expect(s.phase).toBe('playing'); // p1's Tarn alive → game continues
    expect(s.pendingChoice).toBeUndefined(); // …and NO Spirit placement — every Finn power was off
  });

  it('a negated card cannot use its special attack (Fire Line blocked server-side)', () => {
    // Mimring active + movement ended → Fire Line is normally available; negation blocks it.
    let s = customBattle(['mimring'], ['marro_warriors'], 'p1');
    s = clearExcept(s, 's0-mimring-1', 's1-marro_warriors-1');
    s = place(s, 's0-mimring-1', at(2, 2));
    s = place(s, 's1-marro_warriors-1', at(2, 3));
    s = { ...s, movementEnded: true }; // attack phase
    expect(canFireLine(s, 's0-mimring-1')).toBe(true);
    const mimCard = s.cards.find(c => c.cardId === 'mimring')!;
    const neg = { ...s, negatedCardUids: [mimCard.uid] };
    expect(canFireLine(neg, 's0-mimring-1')).toBe(false); // gate hidden
    expect(errOf(applyAction(neg, 'p1', { kind: 'fire_line', attackerId: 's0-mimring-1', dir: 0, attackRoll: [], defenseRolls: [] }))).toMatch(/negat/i);
  });

  // ---------------- WANNOK: end-of-round Curse ----------------
  it('Wannok rolled 1 → the figure ON the glyph takes a wound', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, MARRO(1));
    const glyphHex = at(3, 3);
    s = place(s, FINN, glyphHex);
    s = place(s, MARRO(1), at(6, 6));
    s = setGlyphs(s, [{ id: 'wannok', at: glyphHex, faceUp: true }]);
    s = { ...s, pendingChoice: { kind: 'glyph_wannok', seat: 0, at: glyphHex, d20: null } };
    const after = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 1 } }));
    expect(fig(after, FINN).wounds).toBe(1);
    expect(after.pendingChoice).toBeUndefined();
  });

  it('Wannok rolled 2+ → controller names an opponent who then wounds one of THEIR own', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, MARRO(1), MARRO(2));
    const glyphHex = at(3, 3);
    s = place(s, FINN, glyphHex);
    s = place(s, MARRO(1), at(6, 6));
    s = place(s, MARRO(2), at(6, 5));
    s = setGlyphs(s, [{ id: 'wannok', at: glyphHex, faceUp: true }]);
    s = { ...s, pendingChoice: { kind: 'glyph_wannok', seat: 0, at: glyphHex, d20: null } };
    // server roll 2+ → controller (seat 0) must name an opponent
    let s2 = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 12 } }));
    expect(s2.pendingChoice?.kind).toBe('glyph_wannok');
    s2 = unwrap(applyAction(s2, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', opponentSeat: 1 } }));
    expect(s2.pendingChoice?.kind).toBe('glyph_wannok_victim');
    expect(s2.pendingChoice?.seat).toBe(1); // the named opponent decides
    // the controller cannot decide for the opponent
    expect(errOf(applyAction(s2, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok_victim', figureId: MARRO(1) } }))).toBeTruthy();
    const after = unwrap(applyAction(s2, 'p2', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok_victim', figureId: MARRO(1) } }));
    expect(fig(after, MARRO(1)).wounds).toBe(1);
    expect(after.pendingChoice).toBeUndefined();
  });
});

describe('O2 — Glyph of Lodin lifts EVERY d20 (incl. the wave-3 choice glyphs)', () => {
  // Owner ruling 2026-06-24: "Lodin should apply to ALL d20 rolls." A raw 1 + Lodin = 2, so a
  // Lodin holder never suffers the natural-1 backfire on Wannok / Nilrend / Oreld.
  it('Wannok: a raw 1 + Lodin → 2 spares the figure on the glyph and opens the opponent curse', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, TARN(1), MARRO(1));
    const wannokHex = at(3, 3);
    const lodinHex = at(3, 1);
    s = place(s, FINN, wannokHex); // the figure standing on the Wannok glyph
    s = place(s, TARN(1), lodinHex); // a friendly seat-0 figure holds Lodin → seat 0 d20s get +1
    s = place(s, MARRO(1), at(6, 6)); // an opponent to curse
    s = setGlyphs(s, [{ id: 'wannok', at: wannokHex, faceUp: true }, { id: 'lodin', at: lodinHex, faceUp: true }]);
    s = { ...s, pendingChoice: { kind: 'glyph_wannok', seat: 0, at: wannokHex, d20: null } };
    const after = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 1 } }));
    expect(fig(after, FINN).wounds).toBe(0); // raw 1 + Lodin = 2 → NOT self-cursed
    expect(after.pendingChoice?.kind).toBe('glyph_wannok'); // opponent-pick step opened instead
    // …and WITHOUT Lodin the SAME raw 1 wounds the figure on the glyph (the un-buffed baseline).
    const noLodin = setGlyphs(s, [{ id: 'wannok', at: wannokHex, faceUp: true }]);
    const wounded = unwrap(applyAction(noLodin, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 1 } }));
    expect(fig(wounded, FINN).wounds).toBe(1);
  });

  it("Nilrend: a raw 1 + Lodin → 2 negates an OPPONENT card, not the controller's own", () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, TARN(1), MARRO(1));
    const nilrendHex = at(3, 3);
    const lodinHex = at(3, 1);
    s = place(s, FINN, at(3, 2));
    s = place(s, TARN(1), lodinHex); // seat 0 holds Lodin
    s = place(s, MARRO(1), at(6, 6));
    s = setGlyphs(s, [{ id: 'nilrend', at: nilrendHex, faceUp: true }, { id: 'lodin', at: lodinHex, faceUp: true }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: nilrendHex }));
    expect(moved.pendingChoice?.kind).toBe('glyph_nilrend');
    // raw 1 normally targets the controller's OWN side; +1 Lodin = 2 → the OPPONENT side.
    const rolled = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', d20: 1 } }));
    const marroCard = rolled.cards.find(c => c.cardId === 'marro_warriors')!;
    const done = unwrap(applyAction(rolled, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_nilrend', cardUid: marroCard.uid } }));
    expect(done.negatedCardUids).toContain(marroCard.uid);
  });

  it('TWO occupied Wannok glyphs BOTH curse — the second opens after the first resolves (audit 2026-06-25: the 2-of-each pool can roll two Wannoks)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, TARN(1), MARRO(1));
    const w1 = at(2, 2), w2 = at(5, 5);
    s = place(s, FINN, w1);      // seat 0 controls Wannok #1
    s = place(s, TARN(1), at(1, 0));
    s = place(s, MARRO(1), w2);  // seat 1 controls Wannok #2
    s = setGlyphs(s, [{ id: 'wannok', at: w1, faceUp: true }, { id: 'wannok', at: w2, faceUp: true }]);
    // Mirror what endRound builds at the round boundary: BOTH occupied Wannoks queued, the first open.
    s = { ...s, pendingWannoks: [w2], pendingChoice: { kind: 'glyph_wannok', seat: 0, at: w1, d20: null } };
    // Wannok #1 rolls a 1 → Finn (on it) is wounded; the SECOND Wannok must then OPEN (not silently dropped).
    const after = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 1 } }));
    expect(fig(after, FINN).wounds).toBe(1); // first curse landed
    expect(after.pendingChoice?.kind).toBe('glyph_wannok'); // the second Wannok opened
    if (after.pendingChoice?.kind === 'glyph_wannok') {
      expect(after.pendingChoice.seat).toBe(1); // seat 1 controls Wannok #2
      expect(after.pendingChoice.at).toBe(w2);
    }
    expect(after.pendingWannoks ?? []).toEqual([]); // queue drained
  });

  it('Wannok 2+ FIZZLES when the only opponent is alive on reserve Airborne ONLY — no unresolvable victim choice (audit 2026-06-25)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, MARRO(1));
    const wannokHex = at(2, 2);
    s = place(s, FINN, wannokHex); // seat 0 controls Wannok
    // seat 1 is "alive" only on reserve (no on-board figure) — it can't be cursed; opening its victim
    // choice would be unresolvable (a bot victim → frozen room).
    s = place(s, MARRO(1), null);
    s = { ...s, figures: s.figures.map(f => (f.id === MARRO(1) ? { ...f, reserve: true } : f)) };
    s = setGlyphs(s, [{ id: 'wannok', at: wannokHex, faceUp: true }]);
    s = { ...s, pendingChoice: { kind: 'glyph_wannok', seat: 0, at: wannokHex, d20: null } };
    const after = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_wannok', d20: 12 } }));
    expect(after.pendingChoice).toBeUndefined(); // fizzled — no victim choice opened
  });
});

describe("O3 — Glyph of Nilrend strips a card's Warrior's-Spirit stat bonus", () => {
  it('a negated card loses its placed Attack-Spirit +1 (base stats only)', () => {
    // Owner ruling 2026-06-24: "special bonus from Warrior's Spirit and the like will also be negated."
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, TARN(1), MARRO(1));
    s = place(s, TARN(1), at(3, 4));
    s = place(s, MARRO(1), at(3, 3)); // an adjacent enemy to compute attack dice against
    const tarnCard = s.cards.find(c => c.cardId === 'tarn_vikings')!;
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === tarnCard.uid)!.attackMod = 1; // a Warrior's Attack Spirit had been placed
    const buffed = effectiveAttackDice(s, fig(s, TARN(1)), fig(s, MARRO(1))).dice;
    const neg = { ...s, negatedCardUids: [tarnCard.uid] };
    const negated = effectiveAttackDice(neg, fig(neg, TARN(1)), fig(neg, MARRO(1))).dice;
    expect(buffed - negated).toBe(1); // negation removes the +1 Spirit — base stats only
  });
});

describe('AI initiates Carry + Grapple (all abilities)', () => {
  it('Theracus ferries an adjacent ally forward with carry_move', () => {
    // Theracus (2-hex flyer) + a Marro ally adjacent, the enemy far away → the move brain flies
    // forward AND carries the ally (one carry_move) rather than leaving it behind.
    let s = customBattle(['theracus', 'marro_warriors'], ['finn'], 'p1');
    const THER = 's0-theracus-1';
    const ALLY = 's0-marro_warriors-1';
    const FOE = 's1-finn-1';
    s = clearExcept(s, THER, ALLY, FOE);
    s = place(s, THER, at(2, 1));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    fig(s, THER).at2 = at(3, 1); // a valid same-height tail (the Training Field is flat)
    s = place(s, ALLY, at(1, 1)); // adjacent to Theracus's lead lobe, unengaged
    s = place(s, FOE, at(3, 7)); // far away → both sides want to advance
    const intent = aiNextAction(s, 0);
    expect(intent?.kind).toBe('carry_move');
    if (intent?.kind === 'carry_move') {
      expect(intent.figureId).toBe(THER);
      expect(intent.passengerId).toBe(ALLY);
    }
  });

  it('Sgt. Drake scales an unclimbable ledge with grapple_move to reach a strike hex', () => {
    // A height-6 ledge Drake (Height 5) can't STEP onto, but his Grapple Gun (cap 25) can. The
    // enemy waits on the ledge, so grappling up is the only way to engage → the brain grapples.
    MAPS['test_grapple'] = parseMap(
      'test_grapple',
      'Test Grapple',
      `
      row1@1: G1 G1 G1 G1 G1 G1 G1
      row2@1: G1 G1 G1 G1 G1 G1 G1
      row3:   G1 G6 G6 G1 G1 G1 G1
      row4:   G1 G1 G1 G1 G1 G1 G1
      row5@2: G1 G1 G1 G1 G1 G1 G1
      row6@2: G1 G1 G1 G1 G1 G1 G1
      `,
    );
    let s = customBattle(['drake'], ['marro_warriors'], 'p1', 'test_grapple');
    const DRAKE = 's0-drake-1';
    const FOE = 's1-marro_warriors-1';
    s = clearExcept(s, DRAKE, FOE);
    s = place(s, DRAKE, at(0, 2)); // a neutral G1 hex beside the height-6 ledge
    s = place(s, FOE, at(2, 2)); // on the far ledge hex (height 6) — only reachable by grapple
    const intent = aiNextAction(s, 0);
    expect(intent?.kind).toBe('grapple_move');
    if (intent?.kind === 'grapple_move') {
      expect(intent.figureId).toBe(DRAKE);
      expect(intent.to).toBe(at(1, 2)); // the ledge hex adjacent to the foe
    }
  });
});

describe('AI ranged kiting + self-preservation', () => {
  it('a shooter adjacent to a meleer KITES — steps OUT of melee but stays within its range to fire', () => {
    // Owner ask: fragile shooters should HOLD their range, not charge into melee. Major Q9 (Range 8)
    // starts engaged with Finn (a melee Range-1 champion) and must back off to a non-adjacent hex it can
    // still shoot from, rather than sit there and get hit.
    let s = customBattle(['major_q9'], ['finn'], 'p1');
    const Q9 = 's0-major_q9-1', FINN = 's1-finn-1';
    s = clearExcept(s, Q9, FINN);
    const cells = MAPS[s.mapId].cells;
    const f = at(4, 4);
    s = place(s, FINN, f);
    const adj = neighborKeys(f).find(k => cells[k])!;
    s = place(s, Q9, adj); // Q9 starts ADJACENT to Finn — in melee, the worst spot for a Range-8 shooter
    const intent = aiNextAction(s, 0);
    expect(intent?.kind === 'move_step' || intent?.kind === 'move_figure').toBe(true);
    if (intent && (intent.kind === 'move_step' || intent.kind === 'move_figure')) {
      const d = rangeDistance(cells, intent.to, f) ?? 0;
      expect(d).toBeGreaterThanOrEqual(2); // stepped OUT of melee (no longer adjacent)
      expect(d).toBeLessThanOrEqual(8); // …but stayed within Range 8 so it can still shoot
    }
  });

  it('a shooter already at a safe standoff HOLDS (does not shuffle) so it can fire', () => {
    // Q9 at Range-8 distance from Finn on flat ground, not adjacent → no better square, so it stays put
    // (the move brain yields nothing) and the turn proceeds to the attack.
    let s = customBattle(['major_q9'], ['finn'], 'p1');
    const Q9 = 's0-major_q9-1', FINN = 's1-finn-1';
    s = clearExcept(s, Q9, FINN);
    const cells = MAPS[s.mapId].cells;
    const f = at(3, 1);
    s = place(s, FINN, f);
    const standoff = Object.keys(cells).find(k => k !== f && (rangeDistance(cells, f, k) ?? 0) === 5)!;
    s = place(s, Q9, standoff); // a clean Range-8 standoff, not adjacent
    const intent = aiNextAction(s, 0);
    // It should NOT walk toward Finn into melee; either it holds (end_move) or repositions to a hex that
    // is STILL non-adjacent. Never ends adjacent.
    if (intent && (intent.kind === 'move_step' || intent.kind === 'move_figure')) {
      expect((rangeDistance(cells, intent.to, f) ?? 0)).toBeGreaterThanOrEqual(2);
    } else {
      expect(intent?.kind).toBe('end_move');
    }
  });
});

describe('slice 4: hidden glyphs (face-down until stepped on)', () => {
  it('a glyph is HIDDEN until a figure stops on it, then flips face-up and grants its bonus', () => {
    let s = inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' });
    s = noGlyphs(s);
    const glyphHex = at(3, 1); // adjacent to Finn at (3,0)
    s = setGlyphs(s, [{ id: 'astrid', at: glyphHex, faceUp: false }]); // a HIDDEN Astrid
    s = place(s, MARRO(1), at(3, 5)); // a target so we can read Finn's attack dice
    // While hidden, Astrid grants nothing — even with Finn standing on it (teleported, not stepped).
    const hidden = place(s, FINN, glyphHex);
    const baseDice = effectiveAttackDice(hidden, fig(hidden, FINN), fig(hidden, MARRO(1))).dice;
    expect(effectiveAttackDice(hidden, fig(hidden, FINN), fig(hidden, MARRO(1))).breakdown.some(b => /Astrid/.test(b))).toBe(false);
    // STEPPING onto the glyph flips it face-up; now Finn controls Astrid → +1 attack.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.glyphs.find(g => g.at === glyphHex)?.faceUp).toBe(true);
    expect(effectiveAttackDice(moved, fig(moved, FINN), fig(moved, MARRO(1))).dice).toBe(baseDice + 1);
    expect(moved.log.some(e => e.tag === 'glyph' && /reveals a hidden glyph/.test(e.text))).toBe(true);
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

  it('Astrid: the +1 die is NORMAL-attack only (special attacks get nothing)', () => {
    // Owner spec 2026-06: "one extra attack die when using a normal attack." Special
    // attacks pass isNormalAttack=false (and in fact never call this helper), so Astrid
    // must not add its die to them.
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM);
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'astrid', at: glyphHex, faceUp: true }]);
    s = place(s, FINN, glyphHex);
    s = place(s, THORGRIM, at(3, 4));
    const normal = effectiveAttackDice(s, fig(s, FINN), fig(s, THORGRIM), true);
    const special = effectiveAttackDice(s, fig(s, FINN), fig(s, THORGRIM), false);
    expect(normal.dice).toBe(special.dice + 1); // exactly the Astrid die
    expect(normal.breakdown).toContain('+1 Astrid');
    expect(special.breakdown).not.toContain('+1 Astrid');
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

  it('Jalgard: +2 defense dice while occupied (a stronger Gerda)', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    const glyphHex = at(3, 4);
    s = setGlyphs(s, [{ id: 'jalgard', at: glyphHex, faceUp: true }]);
    s = place(s, MARRO(1), glyphHex); // p2 controls Jalgard
    s = place(s, FINN, at(3, 3));
    s = place(s, THORGRIM, at(0, 0));
    const eff = effectiveDefenseDice(s, fig(s, MARRO(1)), fig(s, FINN));
    expect(eff.dice).toBe(5); // Marro Def 3 + 2 Jalgard
    expect(eff.breakdown).toContain('+2 Jalgard');
  });

  it('Ivor: +2 Range for a Range≥4 figure, nothing for Range 1', () => {
    let s = noGlyphs(inTurns('p2', { p2: 's1-marro_warriors' }));
    s = clearExcept(s, MARRO(1), FINN);
    const glyphHex = at(3, 3);
    s = setGlyphs(s, [{ id: 'ivor', at: glyphHex, faceUp: true }]);
    s = place(s, MARRO(1), glyphHex); // Marro Range 6 → 8 while on Ivor (+2, owner spec 2026-06)
    s = place(s, FINN, at(0, 0));
    expect(effectiveRange(s, fig(s, MARRO(1))).dice).toBe(8);
    expect(effectiveRange(s, fig(s, MARRO(1))).breakdown).toContain('+2 Ivor');
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

const pidOf = (seat: number) => `p${seat + 1}`;

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

  it('draft mode enters the draft phase with a roll-off and the full pool', () => {
    let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 400 }));
    expect(s.phase).toBe('draft');
    expect(s.mode).toBe('draft');
    expect(s.pointBudget).toBe(400);
    expect(s.draft).toBeDefined();
    expect(s.draft!.pool).toHaveLength(29);
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

  it('rejects an out-of-range point budget in draft mode but accepts custom amounts', () => {
    expect(errOf(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 9999 }))).toMatch(/Budget must be/i);
    // A custom (non-preset) amount in range is accepted.
    expect(unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 250 })).pointBudget).toBe(250);
    // …and quick mode ignores the budget entirely.
    expect(unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'quick', pointBudget: 9999 })).phase).toBe('playing');
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
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(9, 3), ATT(8, 2)] }))).toMatch(/tied/i);
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(15, 4)] }));
    expect(errOf(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(15, 4)] }))).toMatch(/already set/);
  });

  it('tie re-roll: only the tied seats re-roll — a clean loser never steals first (audit N1, 2026-06-25)', () => {
    const setup = () => {
      let s = addPlayer(initialState(), 'p1', 'Alice', 0, '#10b981');
      s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
      s = addPlayer(s, 'p3', 'Carol', 2, '#3b82f6');
      return unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 500, mapId: 'star_field' }));
    };
    // seats 0 & 1 tie for highest (20); seat 2 rolls a low 5 and KEEPS it. The tied pair re-roll to
    // [3,4]; even though seat 2's carried 5 beats both, it stays LAST — a clean loser can't win.
    const s = unwrap(applyAction(setup(), 'p1', {
      kind: 'draft_roll',
      attempts: [
        [{ seat: 0, roll: 20 }, { seat: 1, roll: 20 }, { seat: 2, roll: 5 }],
        [{ seat: 0, roll: 3 }, { seat: 1, roll: 4 }, { seat: 2, roll: 5 }],
      ],
    }));
    expect(s.draft!.order).toEqual([1, 0, 2]); // tie broken by the re-roll (seat 1 > seat 0); seat 2 last
    // …and re-rolling the NON-tied seat 2 (5 → 9) is rejected.
    expect(errOf(applyAction(setup(), 'p1', {
      kind: 'draft_roll',
      attempts: [
        [{ seat: 0, roll: 20 }, { seat: 1, roll: 20 }, { seat: 2, roll: 5 }],
        [{ seat: 0, roll: 3 }, { seat: 1, roll: 4 }, { seat: 2, roll: 9 }],
      ],
    }))).toMatch(/tied/i);
  });
});

// ---- the pick sequence (true serpentine snake) ----------------------------

describe('slice 5: draft pick sequence (true snake: A, B, B, A, A, B, B…)', () => {
  // THE draft-sequence test: a TRUE serpentine snake — forward through the roll
  // order, then reverse, the seat at each end picking twice in a row at the
  // turnaround, repeating EVERY round (not a one-time opener). For 2 players
  // that is A, B, B, A, A, B, B, A…  Note round 1 (A,B,B,A) matches the old
  // opener rule; the snake only diverges from pick 5 onward (A,A vs B,A).
  it('drafts as a true snake (A, B, B, A, A, B, B, A)', () => {
    let s = inDraft('p1'); // p1 (seat 0) is the high roller
    const order: number[] = [];
    // Draft 8 cards total, recording whose turn each pick was.
    const seq = ['finn', 'thorgrim', 'tarn_vikings', 'drake', 'raelin', 'syvarris', 'agent_carr', 'izumi_samurai'];
    for (const id of seq) {
      order.push(s.draft!.turnSeat!);
      s = draftCard(s, id);
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1, 1, 0]);
  });

  it('snakes for 3 players over multiple rounds (A,B,C,C,B,A,A,B,C…)', () => {
    // The snake is N-player general: forward 0→1→2, bounce, back 2→1→0, bounce,
    // forward again — the end seat doubling at each turnaround, every round.
    let s = addPlayer(initialState(), 'p1', 'Alice', 0, '#10b981');
    s = addPlayer(s, 'p2', 'Bob', 1, '#ef4444');
    s = addPlayer(s, 'p3', 'Carol', 2, '#3b82f6');
    // 3 players need a 3-6 player battlefield (the Star Field) — the engine now
    // enforces this on start_game, mirroring the lobby's map gating.
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 500, mapId: 'star_field' }));
    // Server roll-off: p1 18 > p2 12 > p3 6 ⇒ order [0,1,2].
    s = unwrap(applyAction(s, 'p1', {
      kind: 'draft_roll',
      attempts: [[{ seat: 0, roll: 18 }, { seat: 1, roll: 12 }, { seat: 2, roll: 6 }]],
    }));
    expect(s.draft!.order).toEqual([0, 1, 2]);
    const order: number[] = [];
    // 9 picks = three full passes; every card is cheap enough for a 500 budget.
    const seq = ['finn', 'thorgrim', 'tarn_vikings', 'drake', 'raelin', 'syvarris', 'agent_carr', 'izumi_samurai', 'krav_maga'];
    for (const id of seq) {
      order.push(s.draft!.turnSeat!);
      s = draftCard(s, id);
    }
    expect(order).toEqual([0, 1, 2, 2, 1, 0, 0, 1, 2]);
  });

  it('rejects a pick from the seat whose turn it is NOT', () => {
    const s = inDraft('p1'); // p1's pick
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_card', cardId: 'finn' }))).toMatch(/not your pick/i);
    expect(errOf(applyAction(s, 'p2', { kind: 'draft_pass' }))).toMatch(/not your pick/i);
  });

  it('getActivePlayerId follows the current drafter', () => {
    let s = inDraft('p2'); // p2 high roller, drafts first
    expect(getActivePlayerId(s)).toBe('p2');
    s = draftCard(s, 'finn'); // p2 picks first; snake hands to p1
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

// ---- common pool (Common cards are repeatable) -----------------------------

describe('slice 5: common pool (Common cards are repeatable)', () => {
  // Swog Rider (Common Hero) is the roster's first real Common; this test still mocks
  // izumi for an isolated repeat-draft check. Encodes the rule the user set: a Common card
  // STAYS in the shared pool and can be drafted again; a Unique leaves once.
  it('a Common card stays in the pool and can be drafted again', () => {
    HS_CARDS.izumi_samurai.common = true;
    try {
      let s = inDraft('p1');
      expect(s.draft!.pool).toContain('izumi_samurai');
      s = draftCard(s, 'izumi_samurai'); // seat 0 takes a copy
      expect(s.draft!.pool).toContain('izumi_samurai'); // COMMON → still available
      expect(s.draft!.armies[0]).toEqual(['izumi_samurai']);
      s = draftCard(s, 'izumi_samurai'); // the next picker takes another copy
      expect(s.draft!.pool).toContain('izumi_samurai'); // still there
    } finally {
      delete HS_CARDS.izumi_samurai.common;
    }
  });

  it('the Common Utgar cards (Swog Rider + 3 Gruts + Deathreavers) are Common; every other roster card is Unique', () => {
    // Real HeroScape: Swog Rider (Common Hero) and Blade/Arrow/Heavy Gruts + Deathreavers (Common
    // squads) are Utgar's common units — all repeatable in the draft. Everything else is Unique.
    // (All five verified 2026-06-27 from the user's index-card PDFs — nameplates read COMMON SQUAD.)
    const COMMON = new Set(['swog_rider', 'blade_gruts', 'arrow_gruts', 'heavy_gruts', 'deathreavers']);
    for (const id of COMMON) expect(HS_CARDS[id].common).toBe(true);
    for (const id of HS_DRAFT_POOL) {
      if (COMMON.has(id)) continue;
      expect(HS_CARDS[id].common).toBeFalsy();
    }
  });

  it('a COMMON drafted N times POOLS into ONE card holding all N copies’ figures (owner 2026-06-28)', () => {
    // Owner rule: "you only need ONE card per army" for a common. Drafting 3 Swog Riders gives ONE
    // s0-swog_rider card that POOLS all 3 figures (a revealed marker then activates any N up to the
    // card's printed squad size — see the activation-cap test). The SAME figure count reaches the
    // board as before; only the card/marker layer collapses 3→1.
    let s = inDraft('p1', 500); // p1 is the high roller and drafts first
    const want: Record<number, string[]> = { 0: ['swog_rider', 'swog_rider', 'swog_rider'], 1: ['finn'] };
    while (s.phase === 'draft') {
      const seat = s.draft!.turnSeat!;
      const list = want[seat] ?? [];
      s = list.length ? draftCard(s, list.shift()!) : draftPass(s);
    }
    expect(s.phase).toBe('placement');
    // ONE pooled Swog Rider card (canonical uid, no #2/#3 splits).
    const swogCards = s.cards.filter(c => c.cardId === 'swog_rider' && c.ownerSeat === 0);
    expect(swogCards).toHaveLength(1);
    expect(swogCards[0].uid).toBe('s0-swog_rider');
    // …holding all 3 figures (Swog Rider = 1 each → 3 pooled), each with a distinct id → all placeable.
    const swogFigs = s.figures.filter(f => f.cardUid === 's0-swog_rider');
    expect(swogFigs).toHaveLength(3);
    expect(new Set(swogFigs.map(f => f.id)).size).toBe(3);
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
    // Budget 169. p1 drafts Grimnak (160) leaving 9 — the cheapest pool card is now
    // 10 (Otonashi) so nothing is affordable: p1 must pass on its next turn.
    let s = inDraft('p1', 169);
    s = draftCard(s, 'grimnak'); // p1: 160/169 → p2 double
    s = draftCard(s, 'finn'); // p2: 80
    s = draftCard(s, 'thorgrim'); // p2: 160 → back to p1
    // p1 has 9 left; cheapest remaining is 10 (Otonashi). The forced pass is legal.
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

// ---- glyphs are laid out BEFORE figures, and placed fairly ----------------

describe('slice 4/5: fair glyph placement (before figures, equidistant)', () => {
  /** Drive a 2-player Training Field draft to the placement phase WITH a glyph seed,
   *  so the seeded fair-random layout (generateGlyphs) runs. */
  function toPlacementWithGlyphs(seed: number): HSState {
    let s = unwrap(
      applyAction(lobby(), 'p1', { kind: 'start_game', mode: 'draft', pointBudget: 500, mapId: 'training_field', glyphSeed: seed }),
    );
    s = unwrap(applyAction(s, 'p1', { kind: 'draft_roll', attempts: [ATT(18, 4)] }));
    s = draftCard(s, 'finn'); // p1
    s = draftCard(s, 'thorgrim'); // p2
    s = draftCard(s, 'marro_warriors'); // p2 (snake)
    s = draftPass(s); // p1 done
    s = draftPass(s); // p2 done → placement
    return s;
  }

  // Independent multi-source BFS (same plain path metric the engine uses) — distance from
  // a set of source hexes to every reachable cell, around off-map gaps.
  function distField(cells: (typeof MAPS)['training_field']['cells'], sources: string[]): Map<string, number> {
    const dist = new Map<string, number>();
    let frontier = sources.filter(k => cells[k]);
    frontier.forEach(k => dist.set(k, 0));
    for (let d = 1; frontier.length; d++) {
      const next: string[] = [];
      for (const k of frontier) for (const n of neighborKeys(k)) {
        if (cells[n] && !dist.has(n)) { dist.set(n, d); next.push(n); }
      }
      frontier = next;
    }
    return dist;
  }

  it('lays glyphs out at the START of placement — before any figure is on the board', () => {
    const s = toPlacementWithGlyphs(12345);
    expect(s.phase).toBe('placement');
    expect(s.glyphs.length).toBeGreaterThan(0); // glyphs already exist…
    expect(s.figures.every(f => f.at == null)).toBe(true); // …and figures are still in hand
    // Never on a start zone, and face-DOWN until someone stops on one.
    const map = MAPS['training_field'];
    const zone = new Set([...map.startZones[0], ...map.startZones[1]]);
    for (const g of s.glyphs) {
      expect(zone.has(g.at)).toBe(false);
      expect(g.faceUp).toBe(false);
      expect(map.cells[g.at].terrain).not.toBe('water');
    }
  });

  it('no glyph is closer to one start zone than another — each lands among the most-equidistant hexes', () => {
    const map = MAPS['training_field'];
    const f0 = distField(map.cells, map.startZones[0]);
    const f1 = distField(map.cells, map.startZones[1]);
    const imbalanceOf = (k: string) => Math.abs((f0.get(k) ?? Infinity) - (f1.get(k) ?? Infinity));
    const startSet = new Set([...map.startZones[0], ...map.startZones[1]]);
    const candidates = Object.keys(map.cells).filter(
      k => !startSet.has(k) && map.cells[k].terrain !== 'water' && f0.has(k) && f1.has(k),
    );
    // Try several seeds — we're testing the algorithm, not one lucky layout.
    for (const seed of [1, 42, 777, 9999]) {
      const s = toPlacementWithGlyphs(seed);
      // The engine picks the `count` LOWEST-imbalance hexes; the count-th smallest imbalance
      // is the worst any fair choice may have. Every chosen glyph must be within that.
      const sortedImb = candidates.map(imbalanceOf).sort((a, b) => a - b);
      const threshold = sortedImb[Math.min(s.glyphs.length, sortedImb.length) - 1];
      for (const g of s.glyphs) {
        expect(imbalanceOf(g.at)).toBeLessThanOrEqual(threshold);
        expect(imbalanceOf(g.at)).toBeLessThanOrEqual(1); // and equidistant within hex parity
      }
    }
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

  it('placement SPILLS to the next row only once the start zone is FULL (overflow rule)', () => {
    const s = placementState();
    const zone0 = MAPS[s.mapId].startZones[0];
    const cells = MAPS[s.mapId].cells;
    // While the zone has room, placement is exactly the open zone hexes — no overflow yet.
    expect(placeableHexes(s, 0)).toEqual(new Set(zone0));
    // Fill the ENTIRE start zone with dummy figures, then re-check.
    const c: HSState = JSON.parse(JSON.stringify(s));
    c.figures = zone0.map((k, i) => ({ ...s.figures[0], id: `filler-${i}`, ownerSeat: 0, at: k, at2: null }));
    const overflow = placeableHexes(c, 0);
    expect(overflow.size).toBeGreaterThan(0); // the zone is full → spill outward
    for (const k of overflow) {
      expect(zone0.includes(k)).toBe(false);                              // never back inside the full zone
      expect(cells[k]).toBeDefined();                                     // a real on-map hex
      expect(zone0.some(z => rangeDistance(cells, z, k) === 1)).toBe(true); // ONLY the first row out (adjacent to the zone)
    }
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

describe('slice 5: full roster (23 base + 6 Big Heroes)', () => {
  it('HS_CARDS has all 29 cards with the printed stats', () => {
    expect(Object.keys(HS_CARDS)).toHaveLength(29);
    expect(HS_DRAFT_POOL).toHaveLength(29);
    // Every pool id resolves to a card.
    for (const id of HS_DRAFT_POOL) expect(HS_CARDS[id]).toBeDefined();
    expect(HS_CARDS.eldgrim).toMatchObject({ life: 3, move: 5, range: 1, attack: 2, defense: 2, height: 4, points: 30 });
    // Spot-check stats AS PRINTED (cards.md roster table).
    expect(HS_CARDS.marro_warriors).toMatchObject({ figures: 4, life: 1, move: 6, range: 6, attack: 2, defense: 3, height: 4, points: 105 });
    expect(HS_CARDS.airborne_elite).toMatchObject({ figures: 4, range: 8, attack: 3, defense: 2, points: 110 });
    expect(HS_CARDS.zettian_guards).toMatchObject({ figures: 2, range: 7, attack: 2, defense: 7, points: 70 });
    expect(HS_CARDS.deathwalker_9000).toMatchObject({ figures: 1, life: 1, range: 7, attack: 4, defense: 9, height: 7, points: 140 });
    expect(HS_CARDS.mimring).toMatchObject({ life: 5, attack: 4, defense: 3, height: 9, points: 150 });
    expect(HS_CARDS.grimnak).toMatchObject({ attack: 2, defense: 4, height: 11, points: 160 });
    expect(HS_CARDS.syvarris).toMatchObject({ range: 9, attack: 3, defense: 2, points: 100 });
    expect(HS_CARDS.raelin).toMatchObject({ life: 5, move: 6, range: 1, defense: 3, points: 125 }); // RotV card
    expect(HS_CARDS.izumi_samurai).toMatchObject({ figures: 3, attack: 2, defense: 5, points: 60 });
    expect(HS_CARDS.krav_maga).toMatchObject({ figures: 3, move: 6, range: 7, points: 100 });
    expect(HS_CARDS.ne_gok_sa).toMatchObject({ life: 5, defense: 6, points: 90 });
    expect(HS_CARDS.drake).toMatchObject({ life: 5, attack: 6, defense: 3, points: 110 });
    expect(HS_CARDS.agent_carr).toMatchObject({ range: 6, attack: 2, defense: 4, points: 100 });
    // Big Heroes — all double-space (baseSize 2), printed stats.
    expect(HS_CARDS.nilfheim).toMatchObject({ life: 6, attack: 6, defense: 4, height: 12, points: 240, baseSize: 2, flying: true });
    expect(HS_CARDS.braxas).toMatchObject({ life: 8, attack: 5, defense: 3, height: 13, points: 210, baseSize: 2, flying: true });
    expect(HS_CARDS.theracus).toMatchObject({ life: 3, move: 7, attack: 3, height: 5, points: 40, baseSize: 2, flying: true });
    expect(HS_CARDS.major_q9).toMatchObject({ life: 4, range: 8, attack: 4, defense: 7, height: 7, points: 250, baseSize: 2 });
    expect(HS_CARDS.jotun).toMatchObject({ life: 7, attack: 8, defense: 4, height: 10, points: 225, baseSize: 2 });
  });

  it('power flags: ALL 29 cards are now live (Grut Bonding completes the set)', () => {
    // Every card's printed power is implemented — slice 4/6/7/8 + the Big Heroes + the five 2026-06
    // classic Utgar units: Deathreavers (Scatter + Climb x2 + Disengage), Swog Rider (Orc Archer
    // Enhancement), and the three Grut squads' Orc Champion / Beast Bonding. No card remains 'wip'.
    const live = Object.values(HS_CARDS).filter(c => c.power === 'live').map(c => c.id).sort();
    expect(live).toEqual([
      'agent_carr', 'airborne_elite', 'arrow_gruts', 'blade_gruts', 'braxas', 'deathreavers', 'deathwalker_9000', 'drake', 'eldgrim', 'finn', 'grimnak', 'heavy_gruts',
      'izumi_samurai', 'jotun', 'krav_maga', 'major_q9', 'marro_warriors', 'mimring', 'ne_gok_sa',
      'nilfheim', 'otonashi', 'raelin', 'su_bak_na', 'swog_rider', 'syvarris', 'tarn_vikings', 'theracus', 'thorgrim', 'zettian_guards',
    ]);
    expect(Object.values(HS_CARDS).filter(c => c.power === 'wip').map(c => c.id)).toEqual([]);
  });

  it('slice-7 power flags are set on exactly the right cards (data-driven)', () => {
    expect(HS_CARDS.raelin.flying).toBe(true);
    expect(HS_CARDS.mimring.flying).toBe(true);
    expect(HS_CARDS.agent_carr.ghostWalk).toBe(true);
    expect(HS_CARDS.agent_carr.disengage).toBe(true);
    expect(HS_CARDS.drake.thorianSpeed).toBe(true);
    expect(HS_CARDS.drake.grappleGun).toBe(25);
    expect(HS_CARDS.krav_maga.stealthDodge).toBe(true);
    expect(HS_CARDS.izumi_samurai.counterStrike).toBe(true);
    // The Big Heroes Nilfheim/Braxas/Theracus also FLY (their other powers are
    // wip). No card carries a slice-7 combat flag it shouldn't.
    expect(HS_CARDS.nilfheim.flying).toBe(true);
    expect(HS_CARDS.braxas.flying).toBe(true);
    expect(HS_CARDS.theracus.flying).toBe(true);
    const flagged = Object.values(HS_CARDS).filter(
      c => c.flying || c.ghostWalk || c.disengage || c.thorianSpeed || c.stealthDodge || c.counterStrike || c.grappleGun,
    ).map(c => c.id).sort();
    expect(flagged).toEqual(['agent_carr', 'arrow_gruts', 'blade_gruts', 'braxas', 'deathreavers', 'drake', 'heavy_gruts', 'izumi_samurai', 'krav_maga', 'mimring', 'nilfheim', 'otonashi', 'raelin', 'su_bak_na', 'swog_rider', 'theracus']);
  });

  it('a wip card fights with its printed stats (no power handler)', () => {
    // Draft Ne-Gok-Sa (still wip in slice 6, Attack 3) for p1; it attacks as
    // printed (its Mind Shackle power is unimplemented — slice 7).
    let s = inDraft('p1', 500);
    s = draftCard(s, 'ne_gok_sa'); // p1 picks first; snake hands to p2
    s = draftCard(s, 'marro_warriors'); // p2 pick 1 of its turnaround double (still p2)
    s = draftPass(s); // p2 passes its 2nd pick voluntarily (1 card) → back to p1
    s = draftPass(s); // p1 passes (Ne-Gok-Sa) → both passed → placement
    expect(s.phase).toBe('placement');
    // Place Ne-Gok-Sa and verify attack dice = printed 3 (no aura/glyph/height).
    const z0 = MAPS[s.mapId].startZones[0];
    const z1 = MAPS[s.mapId].startZones[1];
    s = unwrap(applyAction(s, 'p1', { kind: 'place_figure', figureId: s.hand![0][0], to: z0[0] }));
    s = unwrap(applyAction(s, 'p2', { kind: 'place_figure', figureId: s.hand![1][0], to: z1[0] }));
    s = unwrap(applyAction(s, 'p1', { kind: 'placement_ready' }));
    s = unwrap(applyAction(s, 'p2', { kind: 'placement_ready' }));
    const negoksa = s.figures.find(f => f.ownerSeat === 0)!;
    const marro = s.figures.find(f => f.ownerSeat === 1)!;
    expect(attackDiceRequirements(s, negoksa.id, marro.id)!.attack).toBe(3); // Ne-Gok-Sa printed Attack 3
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

    // Placement phase: figures + hands are public; the ONLY hidden thing now is the
    // face-down glyph identities (glyphs are laid out power-side-down before placement).
    s = draftCard(s, 'thorgrim');
    s = draftCard(s, 'marro_warriors');
    s = draftPass(s);
    s = draftPass(s);
    expect(s.phase).toBe('placement');
    const proj = projectStateForViewer(s, 'p2');
    for (const g of proj.glyphs) {
      if (!g.faceUp) expect(g.id).not.toBe(s.glyphs.find(x => x.at === g.at)!.id); // masked
    }
    expect({ ...proj, glyphs: s.glyphs }).toEqual(s); // …and nothing else differs
    expect(projectStateForViewer(s, null)).toEqual(proj); // glyphs are secret to everyone alike
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

// ===========================================================================
// SLICE 6 — special powers, batch 1 (stat-folding)
// (docs/heroscape/slice-6-spec.md; cards.md exact printed text)
//
// Every bonus is folded into the slice-4 single-source effective-stat helpers,
// so the board preview and the engine resolution read the SAME count. These
// tests assert the helper output, that it folds through attackDiceRequirements,
// and that the resolution enforces exactly the previewed count.
// ===========================================================================

// ---- custom-army staging --------------------------------------------------

/** A wide, flat all-grass test map (12×4) registered for the test process only:
 *  a straight-line ranged shot of 8+ spaces with unobstructed LOS is trivial, so
 *  Deathwalker's Range Enhancement (7 → 9) can be demonstrated reaching a target
 *  at distance 8 (the Training Field is only 7 wide — max range < 8 there). */
const WIDE_MAP_ID = 'test_wide';
beforeAll(() => {
  MAPS[WIDE_MAP_ID] = parseMap(
    WIDE_MAP_ID,
    'Test Wide',
    `
    row1@1: G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1
    row2:   G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1
    row3:   G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1
    row4@2: G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1 G1
    `,
  );
});

/** Build a 'turns'-ready battle with ARBITRARY card ids per seat (the quick
 *  armies are fixed Finn/Tarn vs Thorgrim/Marro, so slice-6 cards like Raelin /
 *  Zettian / Deathwalker need a custom army). Synthesizes cards + figures the
 *  same way the engine's buildArmy does (uid `s{seat}-{cardId}`, figures
 *  `${uid}-${n}`), drops them onto distinct flat hexes, strips the map glyphs,
 *  stacks all four markers on each seat's FIRST card, and rolls initiative so
 *  `first` acts. Tests then teleport figures with `place`. */
function customBattle(
  p1cards: string[],
  p2cards: string[],
  first: 'p1' | 'p2' = 'p1',
  mapId = 'training_field',
): HSState {
  const cols = MAPS[mapId].cols;
  const rows = MAPS[mapId].rows;
  let s = noGlyphs(startedOn(mapId));
  // Default landing hexes: seat 0 on the top two rows, seat 1 on the bottom two
  // (enough for any army; tests reposition as needed).
  const hexesFor = (seat: number): string[] => {
    const useRows = seat === 0 ? [0, 1] : [rows - 2, rows - 1];
    const out: string[] = [];
    for (const row of useRows) for (let col = 0; col < cols; col++) out.push(at(col, row));
    return out;
  };
  const cards: HSState['cards'] = [];
  const figures: HSState['figures'] = [];
  for (const [seat, ids] of [[0, p1cards], [1, p2cards]] as const) {
    const slots = hexesFor(seat);
    let slot = 0;
    for (const cardId of ids) {
      const def = HS_CARDS[cardId];
      const uid = `s${seat}-${cardId}`;
      cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
      for (let n = 1; n <= def.figures; n++) {
        figures.push({ id: `${uid}-${n}`, cardUid: uid, ownerSeat: seat, at: slots[slot++], index: n, wounds: 0 });
      }
    }
  }
  const c: HSState = JSON.parse(JSON.stringify(s));
  c.cards = cards;
  c.figures = figures;
  s = c;
  // Stack all four markers on each seat's first card (a living card).
  s = placed(s, 'p1', allOn(`s0-${p1cards[0]}`));
  s = placed(s, 'p2', allOn(`s1-${p2cards[0]}`));
  return unwrap(
    applyAction(s, 'p2', {
      kind: 'roll_initiative',
      attempts: [first === 'p1' ? ATT(15, 3) : ATT(3, 15)],
    }),
  );
}

// ---- Raelin — EXTENDED DEFENSIVE AURA --------------------------------------

describe('slice 6: Raelin Defensive Aura (RotV card)', () => {
  // p1: Raelin + Zettian Guards (a squad to receive the aura). p2: Marro (an
  // enemy attacker). Raelin's aura is +2 defense to figures SHE controls within
  // 4 clear spaces, excluding herself. Flat field → no height to muddy it.
  const RAELIN = 's0-raelin-1';
  const ZG = (n: number) => `s0-zettian_guards-${n}`;
  const ENEMY = 's1-marro_warriors-1';
  function aura(): HSState {
    let s = customBattle(['raelin', 'zettian_guards'], ['marro_warriors'], 'p1');
    s = clearExcept(s, RAELIN, ZG(1), ENEMY);
    s = place(s, RAELIN, at(3, 3));
    s = place(s, ZG(1), at(3, 4)); // 1 space from Raelin, clear sight
    s = place(s, ENEMY, at(3, 6)); // a p2 attacker, well clear
    return s;
  }

  it('a controlled figure within 4 clear spaces of Raelin gets +2 defense', () => {
    const s = aura();
    const eff = effectiveDefenseDice(s, fig(s, ZG(1)), fig(s, ENEMY));
    expect(eff.dice).toBe(9); // Zettian Defense 7 + 2 Raelin aura
    expect(eff.breakdown).toContain('+2 Raelin aura');
    // Folds through requirements: an enemy attacking the Guard rolls 9 def dice.
    expect(attackDiceRequirements(s, ENEMY, ZG(1))!.defense).toBe(9);
  });

  it('does NOT apply beyond 4 range-spaces', () => {
    let s = aura();
    s = place(s, RAELIN, at(3, 7));
    s = place(s, ZG(1), at(3, 1)); // (3,7)→(3,1) = 6 spaces > 4 → out of range
    expect(effectiveDefenseDice(s, fig(s, ZG(1)), fig(s, ENEMY)).dice).toBe(7); // no aura
    expect(effectiveDefenseDice(s, fig(s, ZG(1)), fig(s, ENEMY)).breakdown).not.toContain('+2 Raelin aura');
  });

  it('is NOT broken by a figure between Raelin and the unit (figures do not block sight)', () => {
    // A friendly body squarely between Raelin and the Guard does NOT break "clear
    // sight" — figures don't block line of sight (only terrain does; on-map
    // obstacles come later), so the aura still reaches the Guard. HORIZONTAL row
    // (offset row 3) so the midpoint figure is truly on the interior of the line.
    let s = aura();
    s = place(s, RAELIN, at(1, 3));
    s = place(s, ZG(1), at(5, 3)); // 4 spaces away, in range
    s = place(s, ZG(2), at(3, 3)); // a friendly body dead-center on the line
    s = place(s, ENEMY, at(1, 6)); // attacker arg — off the Raelin↔Guard line
    expect(effectiveDefenseDice(s, fig(s, ZG(1)), fig(s, ENEMY)).dice).toBe(9); // aura reaches through the body
  });

  it('does NOT affect Raelin herself', () => {
    const s = aura();
    // Raelin's own defense: printed 3, no self-aura.
    expect(effectiveDefenseDice(s, fig(s, RAELIN), fig(s, ENEMY)).dice).toBe(3);
    expect(effectiveDefenseDice(s, fig(s, RAELIN), fig(s, ENEMY)).breakdown).not.toContain('+2 Raelin aura');
  });

  it('only buffs figures the SAME player controls (not the enemy)', () => {
    // The enemy Marro is within 4 clear spaces of p1's Raelin but is NOT
    // controlled by Raelin's owner → no aura.
    let s = aura();
    s = place(s, ENEMY, at(3, 4)); // right beside Raelin at (3,3), clear sight
    expect(effectiveDefenseDice(s, fig(s, ENEMY), fig(s, ZG(1))).dice).toBe(3); // Marro Def 3, no aura
  });

  it('a destroyed (non-living) Raelin grants no aura', () => {
    let s = aura();
    s = place(s, RAELIN, null); // Raelin gone
    expect(effectiveDefenseDice(s, fig(s, ZG(1)), fig(s, ENEMY)).dice).toBe(7);
  });

  it('stacks with Thorgrim + height in the breakdown', () => {
    // On The Knoll: a friendly Marro on the R4 summit (3,3) — adjacent to a
    // friendly Thorgrim AND in a friendly Raelin's aura — defended against an
    // enemy Finn on the lower R3 (2,3). Defense = printed 3 + Thorgrim 1 +
    // Raelin 2 + height 1 = 7, all four lines in the breakdown.
    let s = customBattle(['raelin', 'thorgrim', 'marro_warriors'], ['finn'], 'p1', 'the_knoll');
    const MARRO1 = 's0-marro_warriors-1';
    const THORG = 's0-thorgrim-1';
    const RA = 's0-raelin-1';
    const FENEMY = 's1-finn-1';
    s = clearExcept(s, MARRO1, THORG, RA, FENEMY);
    s = place(s, MARRO1, at(3, 3)); // R4 summit — the beneficiary
    s = place(s, THORG, at(4, 3)); // R4, adjacent → +1 Thorgrim
    s = place(s, RA, at(3, 2)); // adjacent → clear sight → +2 Raelin
    s = place(s, FENEMY, at(2, 3)); // R3, lower & adjacent → attacker, defender +1 height
    // Confirm the height geometry first.
    expect(heightAdvantage(s, fig(s, FENEMY), fig(s, MARRO1))).toEqual({ attacker: 0, defender: 1 });
    const eff = effectiveDefenseDice(s, fig(s, MARRO1), fig(s, FENEMY));
    expect(eff.dice).toBe(7); // Marro Def 3 + Thorgrim 1 + Raelin 2 + height 1
    expect(eff.breakdown).toEqual(
      expect.arrayContaining(['Defense 3 printed', '+1 height', '+1 Thorgrim aura', '+2 Raelin aura']),
    );
  });
});

// ---- Deathwalker 9000 — RANGE ENHANCEMENT ----------------------------------

describe('slice 6: Deathwalker 9000 Range Enhancement', () => {
  // p1: Deathwalker + Zettian Guards (Soulborg Guards — qualify). p2: Finn (a
  // far target). +2 Range to a Soulborg Guard adjacent to a living Deathwalker:
  // Zettian Range 7 → 9.
  const DW = 's0-deathwalker_9000-1';
  const ZG = (n: number) => `s0-zettian_guards-${n}`;
  const TARGET = 's1-finn-1';

  it('a Zettian Guard adjacent to friendly Deathwalker has Range 9 and reaches an 8-away target only when enhanced', () => {
    // Wide flat map: a straight ROW shot. Guard at (0,1), target at (8,1) — a
    // clean 8 spaces apart with unobstructed LOS; DW adjacent at (0,0), off the
    // row so it never blocks the sightline. The Training Field is only 7 wide
    // (max range < 8), so this needs the wider test map.
    // Zettian Guards must be the ACTIVE card (first in the army) so legalTargets
    // applies to a Guard; Deathwalker rides along to supply the adjacency.
    let s = customBattle(['zettian_guards', 'deathwalker_9000'], ['finn'], 'p1', WIDE_MAP_ID);
    s = clearExcept(s, DW, ZG(1), TARGET);
    const guardHex = at(0, 1);
    const targetHex = at(8, 1);
    expect(rangeDistance(MAPS[s.mapId].cells, guardHex, targetHex)).toBe(8); // exactly 8 spaces
    s = place(s, ZG(1), guardHex);
    s = place(s, DW, at(0, 0)); // adjacent to the Guard, off the shooting row
    s = place(s, TARGET, targetHex);
    expect(effectiveRange(s, fig(s, ZG(1))).dice).toBe(9); // 7 + 2
    expect(effectiveRange(s, fig(s, ZG(1))).breakdown).toContain('+2 Range Enhancement');
    // With Deathwalker adjacent (Range 9) the 8-away target is reachable…
    expect(legalTargets(s, ZG(1))).toContain(TARGET);
    // …but remove Deathwalker from the board (plain Range 7) and it drops out.
    const plain = place(s, DW, null);
    expect(effectiveRange(plain, fig(plain, ZG(1))).dice).toBe(7);
    expect(legalTargets(plain, ZG(1))).not.toContain(TARGET);
  });

  it('a Zettian Guard NOT adjacent to Deathwalker keeps Range 7', () => {
    let s = customBattle(['deathwalker_9000', 'zettian_guards'], ['finn'], 'p1');
    s = clearExcept(s, DW, ZG(1), TARGET);
    s = place(s, ZG(1), at(3, 0));
    s = place(s, DW, at(3, 3)); // far from the Guard
    expect(effectiveRange(s, fig(s, ZG(1))).dice).toBe(7); // printed only
    expect(effectiveRange(s, fig(s, ZG(1))).breakdown).not.toContain('+2 Range Enhancement');
  });

  it('a NON-Soulborg-Guard adjacent to Deathwalker gets no bonus', () => {
    // Marro Warriors (species Marro, class Warriors) adjacent to a friendly
    // Deathwalker do NOT qualify (the power names Soulborg Guards).
    let s = customBattle(['deathwalker_9000', 'marro_warriors'], ['finn'], 'p1');
    const MARRO1 = 's0-marro_warriors-1';
    s = clearExcept(s, DW, MARRO1, TARGET);
    s = place(s, MARRO1, at(3, 0));
    s = place(s, DW, at(4, 0)); // adjacent, but Marro ≠ Soulborg Guard
    expect(effectiveRange(s, fig(s, MARRO1)).dice).toBe(6); // Marro Range 6, no bonus
  });
});

// ---- Agent Carr — SWORD OF RECKONING 4 -------------------------------------

describe('slice 6: Agent Carr Sword of Reckoning 4', () => {
  const CARR = 's0-agent_carr-1';
  const ENEMY = 's1-finn-1';

  it('Agent Carr attacking an ADJACENT figure rolls attack + 4', () => {
    let s = customBattle(['agent_carr'], ['finn'], 'p1');
    s = clearExcept(s, CARR, ENEMY);
    s = place(s, CARR, at(3, 3));
    s = place(s, ENEMY, at(3, 4)); // adjacent
    const eff = effectiveAttackDice(s, fig(s, CARR), fig(s, ENEMY));
    expect(eff.dice).toBe(6); // Agent Carr Attack 2 + 4 Sword of Reckoning
    expect(eff.breakdown).toContain('+4 Sword of Reckoning');
    // Folds through requirements; resolution must roll exactly 6 and reject 2.
    expect(attackDiceRequirements(s, CARR, ENEMY)!.attack).toBe(6);
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: CARR, targetId: ENEMY, attackRoll: F('kk'), defenseRoll: F('ssss') })),
    ).toMatch(/Malformed attack roll/);
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: CARR, targetId: ENEMY, attackRoll: F('kkkkkk'), defenseRoll: F('ssss') }));
    expect(hit.lastAttack!.breakdown).toContain('+4 Sword of Reckoning');
  });

  it('Agent Carr attacking a NON-adjacent figure gets no bonus (Carr Range 6)', () => {
    let s = customBattle(['agent_carr'], ['finn'], 'p1');
    s = clearExcept(s, CARR, ENEMY);
    s = place(s, CARR, at(3, 3));
    s = place(s, ENEMY, at(3, 5)); // 2 spaces — in Range 6 but not adjacent
    const eff = effectiveAttackDice(s, fig(s, CARR), fig(s, ENEMY));
    expect(eff.dice).toBe(2); // printed only — no Sword
    expect(eff.breakdown).not.toContain('+4 Sword of Reckoning');
    expect(attackDiceRequirements(s, CARR, ENEMY)!.attack).toBe(2);
  });
});

// ---- Grimnak — ORC WARRIOR ENHANCEMENT (synthetic Orc Warrior) --------------

describe('slice 6: Grimnak Orc Warrior Enhancement', () => {
  // No Orc Warrior exists in the 16-card roster, so the rule never fires in
  // practice. Prove it data-driven with a SYNTHETIC Orc Warrior card injected
  // into HS_CARDS for the test process only.
  const ORC_CARD = 'test_orc_warrior';
  beforeAll(() => {
    (HS_CARDS as Record<string, typeof HS_CARDS['finn']>)[ORC_CARD] = {
      id: ORC_CARD, name: 'Test Orc Warrior', shortName: 'Orc', type: 'squad',
      figures: 2, life: 1, move: 5, range: 1, attack: 3, defense: 3, height: 5,
      points: 50, letter: 'O', species: 'Orc', unitClass: 'Warriors', power: 'wip',
    };
  });

  const GRIM = 's0-grimnak-1';
  const ORC = (n: number) => `s0-${ORC_CARD}-${n}`;
  const ENEMY = 's1-finn-1';

  it('an Orc Warrior adjacent to a friendly Grimnak gets +1 attack AND +1 defense', () => {
    let s = customBattle(['grimnak', ORC_CARD], ['finn'], 'p1');
    s = clearExcept(s, GRIM, ORC(1), ENEMY);
    s = place(s, ORC(1), at(3, 3));
    s = place(s, GRIM, at(3, 2)); // adjacent
    s = place(s, ENEMY, at(3, 4)); // an enemy adjacent to the Orc (for the attack)
    const atk = effectiveAttackDice(s, fig(s, ORC(1)), fig(s, ENEMY));
    expect(atk.dice).toBe(4); // Orc Attack 3 + 1 Grimnak
    expect(atk.breakdown).toContain('+1 Grimnak aura');
    const def = effectiveDefenseDice(s, fig(s, ORC(1)), fig(s, ENEMY));
    expect(def.dice).toBe(4); // Orc Defense 3 + 1 Grimnak
    expect(def.breakdown).toContain('+1 Grimnak aura');
  });

  it('buffs a REAL Orc Warrior — an adjacent Blade Grut gets +1 attack & +1 defense (the Grimnak+Grut combo, audit fix 2026-06-27)', () => {
    // Regression for the singular/plural class bug: Blade/Heavy Gruts are unitClass 'Warriors' so
    // Grimnak's "Orc Warrior Enhancement" actually fires on them (it keys on 'Warriors').
    let s = customBattle(['grimnak', 'blade_gruts'], ['finn'], 'p1', 'training_field');
    s = clearExcept(s, GRIM, 's0-blade_gruts-1', ENEMY);
    s = place(s, 's0-blade_gruts-1', at(3, 3));
    s = place(s, GRIM, at(3, 2)); // a Grimnak hex adjacent to the Grut
    s = place(s, ENEMY, at(3, 4)); // an enemy adjacent to the Grut (for the attack calc)
    const atk = effectiveAttackDice(s, fig(s, 's0-blade_gruts-1'), fig(s, ENEMY));
    expect(atk.dice).toBe(3); // Blade Grut Attack 2 + 1 Grimnak
    expect(atk.breakdown).toContain('+1 Grimnak aura');
    const def = effectiveDefenseDice(s, fig(s, 's0-blade_gruts-1'), fig(s, ENEMY));
    expect(def.dice).toBe(3); // Blade Grut Defense 2 + 1 Grimnak
  });

  it('does NOT apply when the Orc Warrior is not adjacent to Grimnak', () => {
    let s = customBattle(['grimnak', ORC_CARD], ['finn'], 'p1');
    s = clearExcept(s, GRIM, ORC(1), ENEMY);
    s = place(s, ORC(1), at(3, 3));
    s = place(s, GRIM, at(0, 0)); // far away
    s = place(s, ENEMY, at(3, 4));
    expect(effectiveAttackDice(s, fig(s, ORC(1)), fig(s, ENEMY)).dice).toBe(3);
    expect(effectiveDefenseDice(s, fig(s, ORC(1)), fig(s, ENEMY)).dice).toBe(3);
  });

  it('does NOT apply to a non-Orc-Warrior adjacent to Grimnak', () => {
    // Marro Warriors (Marro, not Orc) adjacent to Grimnak get nothing.
    let s = customBattle(['grimnak', 'marro_warriors'], ['finn'], 'p1');
    const MARRO1 = 's0-marro_warriors-1';
    s = clearExcept(s, GRIM, MARRO1, ENEMY);
    s = place(s, MARRO1, at(3, 3));
    s = place(s, GRIM, at(3, 2)); // adjacent, but Marro ≠ Orc
    s = place(s, ENEMY, at(3, 4));
    expect(effectiveAttackDice(s, fig(s, MARRO1), fig(s, ENEMY)).dice).toBe(2); // Marro Attack 2
    expect(effectiveDefenseDice(s, fig(s, MARRO1), fig(s, ENEMY)).dice).toBe(3); // Marro Defense 3
  });
});

// ---- Swog Rider — ORC ARCHER ENHANCEMENT (real Arrow Gruts) -----------------

describe('Swog Rider Orc Archer Enhancement (2026-06-26)', () => {
  const SWOG = 's0-swog_rider-1';
  const AG = (n: number) => `s0-arrow_gruts-${n}`;
  const ENEMY = 's1-finn-1';

  it('an Orc Archer (Arrow Grut) adjacent to a friendly Swog Rider gets +1 attack AND +1 defense', () => {
    let s = customBattle(['swog_rider', 'arrow_gruts'], ['finn'], 'p1');
    s = clearExcept(s, SWOG, AG(1), ENEMY);
    s = place(s, AG(1), at(3, 3));
    s = place(s, SWOG, at(3, 2)); // adjacent (place sets the 2-hex peanut)
    s = place(s, ENEMY, at(3, 4));
    const atk = effectiveAttackDice(s, fig(s, AG(1)), fig(s, ENEMY));
    expect(atk.dice).toBe(2); // Arrow Grut Attack 1 + 1 Swog Rider
    expect(atk.breakdown).toContain('+1 Swog Rider aura');
    const def = effectiveDefenseDice(s, fig(s, AG(1)), fig(s, ENEMY));
    expect(def.dice).toBe(2); // Arrow Grut Defense 1 + 1 Swog Rider
    expect(def.breakdown).toContain('+1 Swog Rider aura');
  });

  it('does NOT apply when the Arrow Grut is not adjacent to a Swog Rider', () => {
    let s = customBattle(['swog_rider', 'arrow_gruts'], ['finn'], 'p1');
    s = clearExcept(s, SWOG, AG(1), ENEMY);
    s = place(s, AG(1), at(3, 3));
    s = place(s, SWOG, at(0, 0)); // far away
    s = place(s, ENEMY, at(3, 4));
    expect(effectiveAttackDice(s, fig(s, AG(1)), fig(s, ENEMY)).dice).toBe(1); // Arrow Grut Attack 1, no aura
    expect(effectiveDefenseDice(s, fig(s, AG(1)), fig(s, ENEMY)).dice).toBe(1);
  });
});

// ---- Zettian Guards — ZETTIAN TARGETING ------------------------------------

describe('slice 6: Zettian Targeting', () => {
  // p1: Zettian Guards (2 figures). p2: Finn + Thorgrim (two distinct targets,
  // Life 4 so they survive the first hits). +1 to the SECOND Guard when it hits
  // the SAME figure the first Guard already hit this turn.
  const ZG = (n: number) => `s0-zettian_guards-${n}`;
  const T1 = 's1-finn-1';
  const T2 = 's1-thorgrim-1';
  function staged(): HSState {
    let s = customBattle(['zettian_guards'], ['finn', 'thorgrim'], 'p1');
    s = clearExcept(s, ZG(1), ZG(2), T1, T2);
    s = place(s, ZG(1), at(2, 3));
    s = place(s, ZG(2), at(4, 3));
    s = place(s, T1, at(3, 3)); // both Guards in range + clear sight
    s = place(s, T2, at(3, 5));
    return s;
  }

  it('the SECOND Guard hitting the SAME target as the first rolls +1; the FIRST never gets it', () => {
    let s = staged();
    // First Guard attacks Finn — printed Attack 2, no Targeting (no prior).
    expect(effectiveAttackDice(s, fig(s, ZG(1)), fig(s, T1)).dice).toBe(2);
    expect(attackDiceRequirements(s, ZG(1), T1)!.attack).toBe(2);
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ZG(1), targetId: T1, attackRoll: F('bb'), defenseRoll: F('ssss') }));
    expect(s.turnAttacks).toEqual([{ attackerId: ZG(1), targetId: T1 }]);
    // Second Guard now hits the SAME Finn → +1 (Attack 3).
    const eff = effectiveAttackDice(s, fig(s, ZG(2)), fig(s, T1));
    expect(eff.dice).toBe(3); // 2 + 1 Zettian Targeting
    expect(eff.breakdown).toContain('+1 Zettian Targeting');
    expect(attackDiceRequirements(s, ZG(2), T1)!.attack).toBe(3);
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ZG(2), targetId: T1, attackRoll: F('kbb'), defenseRoll: F('ssss') }));
    expect(hit.lastAttack!.breakdown).toContain('+1 Zettian Targeting');
  });

  it('the second Guard hitting a DIFFERENT target gets no bonus', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ZG(1), targetId: T1, attackRoll: F('bb'), defenseRoll: F('ssss') }));
    // Second Guard hits Thorgrim (different from the first Guard's Finn) → no +1.
    const eff = effectiveAttackDice(s, fig(s, ZG(2)), fig(s, T2));
    expect(eff.dice).toBe(2);
    expect(eff.breakdown).not.toContain('+1 Zettian Targeting');
  });

  it('the FIRST Guard never gets Targeting even attacking a fresh target', () => {
    const s = staged();
    // No prior attacks this turn → the first shot is always plain.
    expect(effectiveAttackDice(s, fig(s, ZG(1)), fig(s, T1)).breakdown).not.toContain('+1 Zettian Targeting');
    expect(effectiveAttackDice(s, fig(s, ZG(2)), fig(s, T2)).breakdown).not.toContain('+1 Zettian Targeting');
  });

  it('Targeting clears at end of turn (next turn the first Guard is plain again)', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ZG(1), targetId: T1, attackRoll: F('bb'), defenseRoll: F('ssss') }));
    expect(s.turnAttacks).toHaveLength(1);
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.turnAttacks).toEqual([]); // cleared at the turn boundary
  });
});

// ---- Syvarris — DOUBLE ATTACK ----------------------------------------------

describe('slice 6: Syvarris Double Attack', () => {
  // p1: Syvarris (Range 9). p2: Finn + Thorgrim (Life 4 — survive two hits).
  const SYV = 's0-syvarris-1';
  const T1 = 's1-finn-1';
  function staged(): HSState {
    let s = customBattle(['syvarris'], ['finn', 'thorgrim'], 'p1');
    s = clearExcept(s, SYV, T1, 's1-thorgrim-1');
    s = place(s, SYV, at(3, 3));
    s = place(s, T1, at(3, 5)); // ranged target, clear sight
    s = place(s, 's1-thorgrim-1', at(0, 7)); // keep p2 alive elsewhere
    return s;
  }

  it('Syvarris may attack TWICE (two separate rolls)', () => {
    let s = staged();
    // Finn (T1) has Defense 4 → 4 blank dice let each skull land.
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(fig(s, T1).wounds).toBe(1); // first roll landed
    expect(s.turnAttacks).toHaveLength(1);
    // The SECOND attack is allowed (count 1 < maxAttacks 2).
    expect(legalTargets(s, SYV)).toContain(T1);
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(fig(s, T1).wounds).toBe(2); // second roll landed too — two separate rolls
    expect(s.turnAttacks.map(a => a.attackerId)).toEqual([SYV, SYV]);
    // A THIRD attack is rejected (exactly one additional, no more).
    expect(legalTargets(s, SYV)).not.toContain(T1);
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('bbbb') })),
    ).toMatch(/already attacked/);
  });

  it('may split his two attacks across DIFFERENT targets', () => {
    let s = staged();
    const T2 = 's1-thorgrim-1';
    s = place(s, T2, at(5, 3)); // a 2nd target in Range 9 + clear sight, away from Finn
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(fig(s, T1).wounds).toBe(1);
    expect(legalTargets(s, SYV)).toContain(T2); // the 2nd attack may pick a different figure
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T2, attackRoll: F('kbb'), defenseRoll: F('bbbb') }));
    expect(fig(s, T2).wounds).toBe(1); // the other target is hit by the 2nd attack
    expect(s.turnAttacks).toHaveLength(2);
  });

  it('Syvarris MAY stop after one attack (the second is optional)', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('ssss') }));
    // The player simply ends the turn — no forced second attack.
    s = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(s.turnSeat).toBe(1); // turn passed; only one attack happened
    expect(s.turnAttacks).toEqual([]);
  });

  it('Double Attack grants NO extra movement', () => {
    let s = staged();
    // First attack ends movement (the slice-2 rule still holds for Syvarris).
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: T1, attackRoll: F('kbb'), defenseRoll: F('ssss') }));
    expect(legalDestinations(s, SYV).size).toBe(0); // cannot move between/after attacks
    expect(
      errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: SYV, to: at(3, 2) })),
    ).toMatch(/Movement is over/);
  });

  it('a NON-Syvarris figure is still capped at one attack', () => {
    // Finn (a normal figure) attacks once, then a second attack is rejected.
    let s = customBattle(['finn'], ['thorgrim', 'marro_warriors'], 'p1');
    const FN = 's0-finn-1';
    const TH = 's1-thorgrim-1';
    s = clearExcept(s, FN, TH, 's1-marro_warriors-1');
    s = place(s, FN, at(3, 3));
    s = place(s, TH, at(3, 4)); // adjacent (Finn Range 1)
    s = place(s, 's1-marro_warriors-1', at(0, 7)); // keep p2 alive
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FN, targetId: TH, attackRoll: F('kkk'), defenseRoll: F('ssss') }));
    expect(s.turnAttacks).toHaveLength(1);
    expect(legalTargets(s, FN)).not.toContain(TH);
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: FN, targetId: TH, attackRoll: F('kkk'), defenseRoll: F('ssss') })),
    ).toMatch(/already attacked/);
  });
});

// ---- Single-source: preview == resolution; projection; history -------------

describe('slice 6: single-source + projection + history', () => {
  it('every slice-6 bonus folds through attackDiceRequirements (preview == the rolled count)', () => {
    // Sword of Reckoning is the biggest swing — prove the server-side roll count
    // (attackDiceRequirements, the single source actions.ts uses) matches the
    // effective helper and the resolution all at once.
    let s = customBattle(['agent_carr'], ['finn'], 'p1');
    const CARR = 's0-agent_carr-1';
    const ENEMY = 's1-finn-1';
    s = clearExcept(s, CARR, ENEMY);
    s = place(s, CARR, at(3, 3));
    s = place(s, ENEMY, at(3, 4)); // adjacent
    const eff = effectiveAttackDice(s, fig(s, CARR), fig(s, ENEMY)).dice;
    const req = attackDiceRequirements(s, CARR, ENEMY)!.attack;
    expect(req).toBe(eff); // single source — the preview number IS the rolled number
    // The resolution accepts exactly that many dice (and nothing else).
    const ok = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: CARR, targetId: ENEMY, attackRoll: F('k'.repeat(req) as string), defenseRoll: F('ssss') }));
    expect(ok.lastAttack!.attackRoll).toHaveLength(req);
  });

  it('projection stays leak-free with the new powers (turnAttacks carries no hidden info)', () => {
    let s = customBattle(['zettian_guards'], ['finn', 'thorgrim'], 'p1');
    const ZG = (n: number) => `s0-zettian_guards-${n}`;
    s = clearExcept(s, ZG(1), ZG(2), 's1-finn-1', 's1-thorgrim-1');
    s = place(s, ZG(1), at(2, 3));
    s = place(s, ZG(2), at(4, 3));
    s = place(s, 's1-finn-1', at(3, 3));
    s = place(s, 's1-thorgrim-1', at(3, 5));
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ZG(1), targetId: 's1-finn-1', attackRoll: F('bb'), defenseRoll: F('ssss') }));
    const before = JSON.stringify(s);
    const forP2 = projectStateForViewer(s, 'p2');
    // turnAttacks is public (figure ids, no marker values) — survives identically.
    expect(forP2.turnAttacks).toEqual(s.turnAttacks);
    // p1's UNREVEALED markers (2/3/X) never decode in p2's view.
    const p1Cards = JSON.stringify(forP2.cards.filter(c => c.ownerSeat === 0));
    expect(p1Cards.split('"marker":"2"').length - 1).toBe(0);
    expect(p1Cards.split('"marker":"X"').length - 1).toBe(0);
    expect(JSON.stringify(s)).toBe(before); // never mutates
  });

  it('history stays gated on finished through a slice-6 attack', () => {
    let s = customBattle(['syvarris'], ['finn', 'thorgrim'], 'p1');
    const SYV = 's0-syvarris-1';
    s = clearExcept(s, SYV, 's1-finn-1', 's1-thorgrim-1');
    s = place(s, SYV, at(3, 3));
    s = place(s, 's1-finn-1', at(3, 5));
    s = place(s, 's1-thorgrim-1', at(0, 7));
    expect(computeHistory(s)).toBeNull();
    s = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: 's1-finn-1', attackRoll: F('kbb'), defenseRoll: F('ssss') }));
    expect(computeHistory(s)).toBeNull(); // mid-game — still null
  });
});

// ===========================================================================
// SLICE 7 — movement & defense special powers (cards.md exact text)
// ===========================================================================

// A purpose-built FLYING map (7×6): a 3-wide R5 cliff wall (a true "4-tier"
// cliff over the grass) backed by a TWO-DEEP, FULL-WIDTH water moat — the only
// way from the north bank (rows 1-2) to the south bank (row 6) is OVER the cliff
// and water, which only a flyer can do. The moat spans every column AND is two
// hexes deep, so a non-flyer can step onto the first water row (forced stop) but
// can NEVER cross to the south (water→water transit is illegal), and it cannot
// land on the R5 wall (a Height-4 figure's climb limit). No detour exists.
// Registered for the test process only; production maps are untouched.
const FLY_MAP_ID = 'test_flying_field';
// A NECK corridor (7×5) whose middle row is a SINGLE hex (col 3) — the only
// passage between the north half (rows 1-2) and the south half (rows 4-5). An
// enemy parked on the neck blocks ALL north↔south movement for a normal figure
// (no detour exists), so it isolates Ghost Walk's pass-through-enemies clause.
// The 7-wide outer rows satisfy the quick-battle auto-placement.
const GHOST_MAP_ID = 'test_ghost_neck';
beforeAll(() => {
  MAPS[FLY_MAP_ID] = parseMap(
    FLY_MAP_ID,
    'Test Flying Field',
    `
    row1@1: G1 G1 G1 G1 G1 G1 G1
    row2:   G1 G1 R5 R5 R5 G1 G1
    row3:   W1 W1 W1 W1 W1 W1 W1
    row4:   W1 W1 W1 W1 W1 W1 W1
    row5@2: G1 G1 G1 G1 G1 G1 G1
    row6@2: G1 G1 G1 G1 G1 G1 G1
    `,
  );
  MAPS[GHOST_MAP_ID] = parseMap(
    GHOST_MAP_ID,
    'Test Ghost Neck',
    `
    row1@1: G1 G1 G1 G1 G1 G1 G1
    row2:   G1 G1 G1 G1 G1 G1 G1
    row3:   .  .  .  G1 .  .  .
    row4@2: G1 G1 G1 G1 G1 G1 G1
    row5@2: G1 G1 G1 G1 G1 G1 G1
    `,
  );
});

describe('slice 7: Flying (Raelin / Mimring)', () => {
  const RAELIN = 's0-raelin-1';
  const MARRO1 = 's1-marro_warriors-1';

  // Raelin (flyer, Move 6) vs a single Marro (non-flyer, Height 4, Move 6),
  // both on the north bank directly below the R5 cliff wall (col 3). Column-3
  // chain north→south: (3,1)=R5 wall, (3,2)/(3,3)=W1 moat (2 deep), (3,4)=south.
  function lane(): HSState {
    let s = customBattle(['raelin'], ['marro_warriors'], 'p1', FLY_MAP_ID);
    s = clearExcept(s, RAELIN, MARRO1);
    s = place(s, RAELIN, at(3, 0)); // north grass, below the R5 wall
    s = place(s, MARRO1, at(1, 0)); // a far north-grass corner (out of the way)
    return s;
  }

  it('a flyer crosses a 4-tier cliff AND the water moat in one move; a non-flyer cannot', () => {
    const s = lane();
    const air = legalDestinations(s, RAELIN);
    // Flying IGNORES elevation: Raelin may LAND ON the R5 cliff wall (a 4-tier
    // rise no Height-4 figure could climb) and FLY OVER it + the 2-deep water to
    // the south grass — all flat 1/hex.
    expect(air.has(at(3, 1))).toBe(true); // the R5 wall top (elevation ignored)
    expect(air.has(at(3, 4))).toBe(true); // south grass, across cliff + moat
    // The same Marro, on the same north hex (its seat made active), is blocked at
    // BOTH: it cannot land on the R5 wall (rise 4 == Height 4 climb limit) and
    // the 2-deep full-width moat stops it — it can never reach the south bank.
    let m = customBattle(['raelin'], ['marro_warriors'], 'p2', FLY_MAP_ID);
    m = clearExcept(m, RAELIN, MARRO1);
    m = place(m, MARRO1, at(3, 0)); // where Raelin stood
    m = place(m, RAELIN, at(6, 0)); // Raelin out of the way
    const ground = legalDestinations(m, MARRO1);
    expect(ground.has(at(3, 1))).toBe(false); // climb limit blocks the R5 wall
    expect(ground.has(at(3, 4))).toBe(false); // the 2-deep moat blocks the south bank
    // The non-flyer CAN end ON the water (a forced-stop endpoint), proving the
    // moat is what stops it — not a void.
    expect([...ground].some(k => MAPS[FLY_MAP_ID].cells[k].terrain === 'water')).toBe(true);
  });

  it('a flyer passes OVER an enemy figure without becoming engaged', () => {
    // Park an enemy Marro on the R5 wall directly in Raelin's column. A flyer
    // passes through any figure; she still reaches the south grass beyond.
    let s = lane();
    s = place(s, MARRO1, at(3, 1)); // enemy squarely on Raelin's flight column
    const air = legalDestinations(s, RAELIN);
    expect(air.has(at(3, 4))).toBe(true); // flew over the enemy + moat to the far grass
    expect(air.has(at(3, 1))).toBe(false); // …but cannot LAND on the occupied wall
  });

  it('a flyer takes NO fall stepping down a cliff a non-flyer would fall off', () => {
    // On Test Cliffs, the R25 pillar (4,1) towers 24 over the grass beside it —
    // an EXTREME fall for a non-flyer. A flyer descends without falling.
    let s = customBattle(['raelin'], ['marro_warriors'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, RAELIN, MARRO1);
    s = place(s, RAELIN, at(4, 1)); // atop the R25 pillar
    s = place(s, MARRO1, at(6, 6)); // far corner, never engaged
    const to = at(5, 1); // grass beside the pillar (a 24-level drop)
    const cons = moveConsequences(s, fig(s, RAELIN), to);
    expect(cons).toMatchObject({ tier: 'none', fallDice: 0 }); // flyer never falls
    // The move needs NO fall dice and lands cleanly.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: RAELIN, to }));
    expect(fig(moved, RAELIN).at).toBe(to);
    expect(fig(moved, RAELIN).wounds).toBe(0);
  });

  it('a takeoff while ENGAGED still draws the leaving-engagement swipe', () => {
    // Flying does NOT exempt the takeoff swipe (cards.md): if engaged when she
    // starts to fly, Raelin takes any leaving-engagement attacks. Stage Raelin
    // adjacent to an enemy on flat grass, then fly away out of adjacency.
    let s = customBattle(['raelin'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, RAELIN, MARRO1);
    s = place(s, RAELIN, at(3, 3));
    s = place(s, MARRO1, at(3, 2)); // adjacent → engaged at takeoff
    const dest = at(3, 5); // 2 spaces away, no longer adjacent to the Marro
    const cons = moveConsequences(s, fig(s, RAELIN), dest);
    expect(cons.abandonedEnemyIds).toEqual([MARRO1]); // the swipe is still due
    // The engine demands exactly that swipe roll (server-rolled).
    expect(errOf(applyAction(s, 'p1', { kind: 'move_figure', figureId: RAELIN, to: dest }))).toMatch(
      /do not match the abandoned enemies/,
    );
    const moved = unwrap(
      applyAction(s, 'p1', {
        kind: 'move_figure',
        figureId: RAELIN,
        to: dest,
        leaveRolls: [{ enemyFigureId: MARRO1, roll: 'blank' }],
      }),
    );
    expect(fig(moved, RAELIN).at).toBe(dest);
  });
});

describe('slice 7: Ghost Walk (Agent Carr)', () => {
  const CARR = 's0-agent_carr-1';
  const MARRO1 = 's1-marro_warriors-1';

  it('Agent Carr moves THROUGH an enemy figure; a non-ghost cannot path past it', () => {
    // The NECK map: an enemy on the single neck hex (3,3) is the only way between
    // north and south. Carr (Move 5) passes through the enemy to the south hex
    // beyond — a route no non-ghost has (no detour exists).
    let s = customBattle(['agent_carr'], ['marro_warriors'], 'p1', GHOST_MAP_ID);
    s = clearExcept(s, CARR, MARRO1);
    s = place(s, CARR, at(3, 1)); // north half, above the neck
    s = place(s, MARRO1, at(3, 2)); // enemy ON the neck (the only crossing)
    const dests = legalDestinations(s, CARR);
    expect(dests.has(at(3, 3))).toBe(true); // ghost-walked through the neck enemy
    expect(dests.has(at(3, 2))).toBe(false); // …but cannot END on the enemy's hex
    // Contrast: a non-ghost Marro from the same north hex, with the same enemy on
    // the neck, is walled off — the south half is unreachable.
    let g = customBattle(['marro_warriors'], ['agent_carr', 'finn'], 'p1', GHOST_MAP_ID);
    const BLOCKER = 's1-agent_carr-1';
    g = clearExcept(g, 's0-marro_warriors-1', BLOCKER, 's1-finn-1');
    g = place(g, 's0-marro_warriors-1', at(3, 1));
    g = place(g, BLOCKER, at(3, 2)); // enemy on the neck blocks the Marro
    g = place(g, 's1-finn-1', at(0, 0)); // keep p2 alive elsewhere
    expect(legalDestinations(g, 's0-marro_warriors-1').has(at(3, 3))).toBe(false); // no ghost walk
  });

  it('Ghost Walk still pays climb cost and still cannot end on an occupied hex', () => {
    // On The Knoll, Ghost Walk does NOT ignore elevation: Carr (Move 5) on grass
    // at (0,3) pays the normal climb chain G1→G2(2)→R3(4) and cannot crest the
    // R4 summit (cost 6) — exactly like any non-flyer.
    let s = customBattle(['agent_carr'], ['marro_warriors'], 'p1', 'the_knoll');
    s = clearExcept(s, CARR, MARRO1);
    s = place(s, CARR, at(0, 3));
    s = place(s, MARRO1, at(8, 4)); // far away
    const dests = legalDestinations(s, CARR);
    expect(dests.has(at(2, 3))).toBe(true); // R3, cost 4 — reachable
    expect(dests.has(at(3, 3))).toBe(false); // R4 summit, cost 6 > Move 5 (climb cost still applies)
  });

  it('Agent Carr leaving an engagement draws ZERO swipes (Disengage)', () => {
    // DISENGAGE: "never attacked when leaving an engagement." Carr walks out of a
    // two-enemy engagement and takes no swipe at all — unconditional.
    let s = customBattle(['agent_carr'], ['marro_warriors'], 'p1', 'training_field');
    const MARRO2 = 's1-marro_warriors-2';
    s = clearExcept(s, CARR, MARRO1, MARRO2);
    s = place(s, CARR, at(3, 3));
    s = place(s, MARRO1, at(3, 2)); // adjacent → engaged
    s = place(s, MARRO2, at(2, 3)); // adjacent → engaged
    const dest = at(4, 3); // adjacent to NEITHER Marro
    const cons = moveConsequences(s, fig(s, CARR), dest);
    expect(cons.abandonedEnemyIds).toEqual([]); // Disengage suppresses all swipes
    // The move needs no leaveRolls and succeeds unharmed.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: CARR, to: dest }));
    expect(fig(moved, CARR).at).toBe(dest);
    expect(fig(moved, CARR).wounds).toBe(0);
  });
});

describe('slice 7: Thorian Speed (Sgt. Drake)', () => {
  const DRAKE = 's1-drake-1';
  const MARRO1 = 's0-marro_warriors-1';

  it('a NON-adjacent normal attacker cannot target Drake; an ADJACENT one can', () => {
    // Marro (Range 6) shoots at Drake. Two spaces away (a normal ranged attack)
    // Thorian Speed blocks it — Drake cannot be shot at range by a normal attack.
    let s = customBattle(['marro_warriors'], ['drake'], 'p1', 'training_field');
    s = clearExcept(s, MARRO1, DRAKE);
    s = place(s, MARRO1, at(3, 3));
    s = place(s, DRAKE, at(3, 5)); // 2 spaces — in Range 6 but NOT adjacent
    expect(legalTargets(s, MARRO1)).not.toContain(DRAKE); // no targeting ring
    expect(
      errOf(applyAction(s, 'p1', { kind: 'attack', attackerId: MARRO1, targetId: DRAKE, attackRoll: F('kk'), defenseRoll: F('sss') })),
    ).toMatch(/Thorian Speed/);
    // Adjacent, the same normal attack is allowed.
    let adj = customBattle(['marro_warriors'], ['drake'], 'p1', 'training_field');
    adj = clearExcept(adj, MARRO1, DRAKE);
    adj = place(adj, MARRO1, at(3, 3));
    adj = place(adj, DRAKE, at(3, 4)); // adjacent
    expect(legalTargets(adj, MARRO1)).toContain(DRAKE);
    const hit = unwrap(applyAction(adj, 'p1', { kind: 'attack', attackerId: MARRO1, targetId: DRAKE, attackRoll: F('kk'), defenseRoll: F('sss') }));
    expect(hit.lastAttack!.targetId).toBe(DRAKE);
  });

  it('Thorian Speed does not protect a NON-Drake figure from ranged normal attacks', () => {
    // Sanity: the clause is data-driven on the target's flag — a plain Finn at
    // range is still a legal target.
    let s = customBattle(['marro_warriors'], ['finn'], 'p1', 'training_field');
    s = clearExcept(s, MARRO1, 's1-finn-1');
    s = place(s, MARRO1, at(3, 3));
    s = place(s, 's1-finn-1', at(3, 5)); // 2 spaces, in Range 6
    expect(legalTargets(s, MARRO1)).toContain('s1-finn-1');
  });
});

describe('slice 7: Grapple Gun 25 (Sgt. Drake)', () => {
  const DRAKE = 's0-drake-1';
  const MARRO1 = 's1-marro_warriors-1';

  it('Drake grapples up a cliff taller than his Height in one space (climb waived ≤ 25)', () => {
    // Test Cliffs: the R15 pillar (2,1) rises 14 over the grass beside it (3,1) —
    // far above Drake's Height 5. A normal move can't scale it; the Grapple Gun
    // (≤ 25 levels) can, exactly one space.
    let s = customBattle(['drake'], ['marro_warriors'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, DRAKE, MARRO1);
    s = place(s, DRAKE, at(3, 1)); // grass beside the R15 pillar
    s = place(s, MARRO1, at(6, 6)); // far corner
    const top = at(2, 1); // the R15 pillar top (rise 14)
    // A NORMAL move can't reach it (climb limit).
    expect(legalDestinations(s, DRAKE).has(top)).toBe(false);
    // The Grapple Gun set DOES include it (one space, rise 14 ≤ 25).
    expect(grappleDestinations(s, DRAKE).has(top)).toBe(true);
    const up = unwrap(applyAction(s, 'p1', { kind: 'grapple_move', figureId: DRAKE, to: top }));
    expect(fig(up, DRAKE).at).toBe(top);
    expect(up.log.some(e => e.tag === 'move' && /grapples to/.test(e.text))).toBe(true);
  });

  it('the Grapple Gun moves EXACTLY one space (no two-space hops)', () => {
    let s = customBattle(['drake'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, DRAKE, MARRO1);
    s = place(s, DRAKE, at(3, 3));
    s = place(s, MARRO1, at(0, 7));
    // One space is fine.
    expect(grappleDestinations(s, DRAKE).has(at(3, 4))).toBe(true);
    // Two spaces is not in the set, and the engine rejects it.
    expect(grappleDestinations(s, DRAKE).has(at(3, 5))).toBe(false);
    expect(
      errOf(applyAction(s, 'p1', { kind: 'grapple_move', figureId: DRAKE, to: at(3, 5) })),
    ).toMatch(/exactly one space/);
  });

  it('the Grapple Gun REPLACES the normal move (and vice-versa)', () => {
    let s = customBattle(['drake'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, DRAKE, MARRO1);
    s = place(s, DRAKE, at(3, 3));
    s = place(s, MARRO1, at(0, 7));
    // Grapple first → a normal move afterwards is rejected (already moved).
    const g = unwrap(applyAction(s, 'p1', { kind: 'grapple_move', figureId: DRAKE, to: at(3, 4) }));
    expect(errOf(applyAction(g, 'p1', { kind: 'move_figure', figureId: DRAKE, to: at(3, 5) }))).toMatch(
      /already moved/,
    );
    // Normal move first → a grapple afterwards is rejected too.
    const m = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: DRAKE, to: at(3, 4) }));
    expect(errOf(applyAction(m, 'p1', { kind: 'grapple_move', figureId: DRAKE, to: at(3, 5) }))).toMatch(
      /already moved/,
    );
  });

  it('only Drake may Grapple Gun; engagement swipes still apply to his grapple', () => {
    // A non-Drake figure is refused.
    let s = customBattle(['finn'], ['marro_warriors'], 'p1', 'training_field');
    s = clearExcept(s, 's0-finn-1', MARRO1);
    s = place(s, 's0-finn-1', at(3, 3));
    s = place(s, MARRO1, at(0, 7));
    expect(
      errOf(applyAction(s, 'p1', { kind: 'grapple_move', figureId: 's0-finn-1', to: at(3, 4) })),
    ).toMatch(/Only Sgt. Drake/);
    // Drake grappling OUT of an engagement still draws the swipe (engagement
    // rules apply): Drake adjacent to an enemy, grapple ONE space to (4,3) which
    // is no longer adjacent to the Marro at (3,2) (same geometry the slice-3
    // swipe test uses for the abandoned-enemy check).
    let e = customBattle(['drake'], ['marro_warriors'], 'p1', 'training_field');
    e = clearExcept(e, DRAKE, MARRO1);
    e = place(e, DRAKE, at(3, 3));
    e = place(e, MARRO1, at(3, 2)); // adjacent → engaged
    const dest = at(4, 3); // one space east, no longer adjacent to the Marro
    const cons = moveConsequences(e, fig(e, DRAKE), dest);
    expect(cons.abandonedEnemyIds).toEqual([MARRO1]); // the swipe is due
    // The grapple needs exactly that swipe roll (server-rolled).
    expect(
      errOf(applyAction(e, 'p1', { kind: 'grapple_move', figureId: DRAKE, to: dest })),
    ).toMatch(/do not match the abandoned enemies/);
    const grappled = unwrap(
      applyAction(e, 'p1', {
        kind: 'grapple_move',
        figureId: DRAKE,
        to: dest,
        leaveRolls: [{ enemyFigureId: MARRO1, roll: 'blank' }],
      }),
    );
    expect(fig(grappled, DRAKE).at).toBe(dest);
  });
});

describe('slice 7: Stealth Dodge (Krav Maga Agents)', () => {
  const KRAV1 = 's1-krav_maga-1';
  const SYV = 's0-syvarris-1';
  const FINN = 's0-finn-1';

  it('a Krav Maga Agent takes 0 damage from a NON-adjacent attacker on ≥1 shield', () => {
    // Syvarris (Range 9) shoots a Krav Maga Agent from 3 spaces away. With one
    // shield rolled, Stealth Dodge blocks ALL damage even against 3 skulls.
    let s = customBattle(['syvarris'], ['krav_maga'], 'p1', 'training_field');
    s = clearExcept(s, SYV, KRAV1);
    s = place(s, SYV, at(3, 3));
    s = place(s, KRAV1, at(3, 6)); // 3 spaces — non-adjacent ranged attack
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: KRAV1, attackRoll: F('kkk'), defenseRoll: F('sbb') }));
    expect(fig(hit, KRAV1).wounds).toBe(0); // one shield negates all 3 skulls
    expect(fig(hit, KRAV1).at).toBe(at(3, 6)); // survives (Life 1)
    expect(hit.lastAttack).toMatchObject({ skulls: 3, shields: 1, wounds: 0, destroyed: false });
    expect(hit.log.some(e => /Stealth Dodge/.test(e.text))).toBe(true);
  });

  it('zero shields means Stealth Dodge does NOT fire — the Agent still takes wounds', () => {
    let s = customBattle(['syvarris'], ['krav_maga'], 'p1', 'training_field');
    s = clearExcept(s, SYV, KRAV1);
    s = place(s, SYV, at(3, 3));
    s = place(s, KRAV1, at(3, 6));
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: KRAV1, attackRoll: F('kbb'), defenseRoll: F('bbb') }));
    expect(fig(hit, KRAV1).at).toBeNull(); // 1 skull, 0 shields → Life-1 dies (no dodge)
  });

  it('an ADJACENT attacker is resolved normally (Stealth Dodge only vs non-adjacent)', () => {
    // Finn (melee) adjacent to a Krav Maga Agent. One shield does NOT block all —
    // 3 skulls vs 1 shield = 2 wounds, which kills the Life-1 Agent.
    let s = customBattle(['finn'], ['krav_maga'], 'p1', 'training_field');
    s = clearExcept(s, FINN, KRAV1);
    s = place(s, FINN, at(3, 3));
    s = place(s, KRAV1, at(3, 4)); // adjacent
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: KRAV1, attackRoll: F('kkk'), defenseRoll: F('sbb') }));
    expect(fig(hit, KRAV1).at).toBeNull(); // resolved normally → destroyed
    expect(hit.lastAttack).toMatchObject({ skulls: 3, shields: 1, destroyed: true });
    expect(hit.log.some(e => /Stealth Dodge/.test(e.text))).toBe(false);
  });
});

describe('slice 7: Counter Strike (Izumi Samurai)', () => {
  const IZUMI1 = 's1-izumi_samurai-1';
  const FINN = 's0-finn-1';

  it('Izumi reflects (shields − skulls) unblockable wounds onto an adjacent normal attacker', () => {
    // Finn (Life 4, Attack 3) attacks an adjacent Izumi (Defense 5) and rolls 1
    // skull; Izumi rolls 4 shields (of its 5 dice) → 4 − 1 = 3 excess → 3
    // unblockable wounds onto Finn (who survives at 3/4). Izumi takes 0.
    let s = customBattle(['finn'], ['izumi_samurai'], 'p1', 'training_field');
    s = clearExcept(s, FINN, IZUMI1);
    s = place(s, FINN, at(3, 3));
    s = place(s, IZUMI1, at(3, 4)); // adjacent
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: IZUMI1, attackRoll: F('kbb'), defenseRoll: F('ssssb') }));
    expect(fig(hit, IZUMI1).wounds).toBe(0); // defender unharmed (shields > skulls)
    expect(fig(hit, FINN).wounds).toBe(3); // 4 shields − 1 skull = 3 reflected
    expect(fig(hit, FINN).at).toBe(at(3, 3)); // survives (Life 4)
    expect(hit.lastAttack!.counterWounds).toBe(3);
    expect(hit.log.some(e => /Counter Strike/.test(e.text))).toBe(true);
    expect(hit.lastEffect?.kind).toBe('counter_strike'); // 3D VFX: a blade swipe back at the attacker
    expect(hit.lastEffect?.to).toEqual([at(3, 3)]); // toward Finn (the attacker)
  });

  it('Counter Strike can DESTROY the attacker (and run the finish check)', () => {
    // A lone Finn (Life 4, pre-wounded to 1) attacks an adjacent Izumi who is the
    // last enemy; 4 excess shields reflect 4 wounds → Finn (1+4 ≥ 4) is destroyed.
    // With Finn the only p1 figure, that ends the game — p2 (Izumi) wins.
    let s = customBattle(['finn'], ['izumi_samurai'], 'p1', 'training_field');
    s = clearExcept(s, FINN, IZUMI1);
    s = place(s, FINN, at(3, 3));
    s = place(s, IZUMI1, at(3, 4));
    s = wound(s, FINN, 1); // staged earlier damage; Finn at 1/4 wounds
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: FINN, targetId: IZUMI1, attackRoll: F('bbb'), defenseRoll: F('sssss') }));
    // 0 skulls vs 5 shields → 5 excess → 5 wounds onto Finn → destroyed.
    expect(fig(hit, FINN).at).toBeNull();
    expect(hit.lastAttack!.counterWounds).toBe(5);
    expect(hit.phase).toBe('finished'); // Counter Strike ended the game
    expect(hit.winnerSeat).toBe(1); // the Izumi's owner wins
    expect(computeHistory(hit)).not.toBeNull(); // history opens only now
  });

  it('Counter Strike does NOT fire against another Samurai', () => {
    // An Izumi attacking an adjacent Izumi: the attacker's own Counter Strike
    // power means the defender's Counter Strike "does not work against other
    // Samurai" — no reflect either way.
    let s = customBattle(['izumi_samurai'], ['izumi_samurai'], 'p1', 'training_field');
    const ATK = 's0-izumi_samurai-1';
    s = clearExcept(s, ATK, IZUMI1);
    s = place(s, ATK, at(3, 3));
    s = place(s, IZUMI1, at(3, 4)); // adjacent
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: ATK, targetId: IZUMI1, attackRoll: F('bb'), defenseRoll: F('sssss') }));
    expect(hit.lastAttack!.counterWounds).toBeUndefined(); // no reflect vs a Samurai
    expect(fig(hit, ATK).wounds).toBe(0); // the attacker is unharmed
  });

  it('Counter Strike does NOT fire on a RANGED (non-adjacent) normal attack', () => {
    // Syvarris (Range 9) shoots the Izumi from 3 spaces. Counter Strike requires
    // an ADJACENT attacker — no reflect, the Izumi simply blocks.
    let s = customBattle(['syvarris'], ['izumi_samurai'], 'p1', 'training_field');
    const SYV = 's0-syvarris-1';
    s = clearExcept(s, SYV, IZUMI1);
    s = place(s, SYV, at(3, 3));
    s = place(s, IZUMI1, at(3, 6)); // 3 spaces — not adjacent
    const hit = unwrap(applyAction(s, 'p1', { kind: 'attack', attackerId: SYV, targetId: IZUMI1, attackRoll: F('kbb'), defenseRoll: F('sssss') }));
    expect(hit.lastAttack!.counterWounds).toBeUndefined(); // no reflect at range
    expect(fig(hit, SYV).wounds).toBe(0); // attacker unharmed
  });
});

describe('slice 7: regression + projection + history', () => {
  it('slice-6 powers still fire after the slice-7 changes (Agent Carr Sword of Reckoning)', () => {
    // Agent Carr now also has Ghost Walk + Disengage, but his Sword of Reckoning 4
    // must still add +4 vs an adjacent figure.
    let s = customBattle(['agent_carr'], ['finn'], 'p1', 'training_field');
    const CARR = 's0-agent_carr-1';
    s = clearExcept(s, CARR, 's1-finn-1');
    s = place(s, CARR, at(3, 3));
    s = place(s, 's1-finn-1', at(3, 4)); // adjacent
    expect(effectiveAttackDice(s, fig(s, CARR), fig(s, 's1-finn-1')).dice).toBe(6); // 2 + 4
  });

  it('a flyer reaching cliffs/water adds NO hidden info to the projection', () => {
    let s = customBattle(['raelin'], ['marro_warriors'], 'p1', FLY_MAP_ID);
    s = clearExcept(s, 's0-raelin-1', 's1-marro_warriors-1');
    s = place(s, 's0-raelin-1', at(3, 0));
    s = place(s, 's1-marro_warriors-1', at(1, 4));
    const before = JSON.stringify(s);
    const forP2 = projectStateForViewer(s, 'p2');
    // p1's unrevealed markers never decode in p2's view.
    const p1Cards = JSON.stringify(forP2.cards.filter(c => c.ownerSeat === 0));
    expect(p1Cards.split('"marker":"2"').length - 1).toBe(0);
    expect(p1Cards.split('"marker":"X"').length - 1).toBe(0);
    expect(JSON.stringify(s)).toBe(before); // never mutates
  });

  it('history stays gated on finished through a Grapple Gun + Stealth Dodge sequence', () => {
    let s = customBattle(['drake'], ['krav_maga'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, 's0-drake-1', 's1-krav_maga-1');
    s = place(s, 's0-drake-1', at(3, 1));
    s = place(s, 's1-krav_maga-1', at(6, 6));
    expect(computeHistory(s)).toBeNull();
    s = unwrap(applyAction(s, 'p1', { kind: 'grapple_move', figureId: 's0-drake-1', to: at(2, 1) }));
    expect(computeHistory(s)).toBeNull(); // mid-game — still null
  });
});

// ---------------------------------------------------------------------------
// Double-space (2-hex) figures — Mimring / Grimnak occupy TWO hexes
// ---------------------------------------------------------------------------
describe('double-space (2-hex) figures', () => {
  /** Stage a double-space figure for `seat` across {lead, tail} (its own card,
   *  so it doesn't collide with the fixed army's copy). */
  function injectBig(s: HSState, seat: number, cardId: string, id: string, lead: string, tail: string): HSState {
    const c: HSState = JSON.parse(JSON.stringify(s));
    const uid = `s${seat}-${cardId}-big`;
    c.cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    c.figures.push({ id, cardUid: uid, ownerSeat: seat, at: lead, at2: tail, index: 1, wounds: 0 });
    return c;
  }

  it('Mimring and Grimnak are baseSize 2; ordinary figures are 1', () => {
    expect(HS_CARDS.mimring.baseSize).toBe(2);
    expect(HS_CARDS.grimnak.baseSize).toBe(2);
    expect(HS_CARDS.finn.baseSize ?? 1).toBe(1);
    expect(HS_CARDS.tarn_vikings.baseSize ?? 1).toBe(1);
  });

  it('occupies BOTH hexes — neither is a legal move destination for an enemy', () => {
    let s = inTurns('p1'); // p1's turn, Finn is the active/movable figure
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(2, 3));
    s = injectBig(s, 1, 'grimnak', 'big-grim', at(3, 3), at(4, 3));
    const dests = legalDestinations(s, FINN);
    expect(dests.has(at(3, 3))).toBe(false); // lead hex is occupied
    expect(dests.has(at(4, 3))).toBe(false); // trailing hex is occupied too
    expect(dests.has(at(2, 2))).toBe(true); // an empty neighbour is still reachable
  });

  it('is TARGETABLE from EITHER hex — range measured from the better end', () => {
    // Finn (Range 1) sits adjacent ONLY to Grimnak's TRAILING hex (4,3).
    let near = inTurns('p1');
    near = clearExcept(near, FINN, THORGRIM);
    near = place(near, FINN, at(5, 3));
    near = injectBig(near, 1, 'grimnak', 'big-grim', at(3, 3), at(4, 3));
    expect(legalTargets(near, FINN)).toContain('big-grim');
    // Far away → neither hex within Range 1 → not targetable.
    let far = inTurns('p1');
    far = clearExcept(far, FINN, THORGRIM);
    far = place(far, FINN, at(0, 3));
    far = injectBig(far, 1, 'grimnak', 'big-grim', at(3, 3), at(4, 3));
    expect(legalTargets(far, FINN)).not.toContain('big-grim');
  });

  it('ENGAGES from either hex — touching only the trailing hex draws a leaving swipe', () => {
    let s = inTurns('p1');
    s = clearExcept(s, FINN, THORGRIM);
    s = place(s, FINN, at(5, 3)); // adjacent to the TRAILING hex (4,3)
    s = injectBig(s, 1, 'grimnak', 'big-grim', at(3, 3), at(4, 3));
    // Finn was engaged via the dragon's trailing hex; stepping out abandons it.
    const cons = moveConsequences(s, fig(s, FINN), at(6, 3));
    expect(cons.abandonedEnemyIds).toContain('big-grim');
  });

  it('placeable2Leads returns only leads with an empty same-level neighbour', () => {
    const s = clearExcept(inTurns('p1'), FINN); // clear the seat-0 zone clutter
    const seat = s.turnSeat!; // in 'turns' a player always holds the turn
    const leads = placeable2Leads(s, seat);
    const free = placeableHexes(s, seat);
    expect(leads.size).toBeGreaterThan(0);
    for (const lead of leads) {
      expect(free.has(lead)).toBe(true);
      expect(neighborKeys(lead).some(n => free.has(n))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fire Line Special Attack (Mimring) — straight line of 8, friend-or-foe, LOS
// ---------------------------------------------------------------------------
describe('Fire Line Special Attack (Mimring)', () => {
  function inject(s: HSState, seat: number, cardId: string, id: string, at1: string, at2: string | null = null): HSState {
    const c: HSState = JSON.parse(JSON.stringify(s));
    const uid = `s${seat}-${cardId}-${id}`;
    c.cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    c.figures.push({ id, cardUid: uid, ownerSeat: seat, at: at1, at2, index: 1, wounds: 0 });
    return c;
  }
  // Mimring anchored at (3,3) with his trailing hex BEHIND the line, so neither
  // of his spaces gives an alternate sightline past a blocker on the line.
  function withMimring(): HSState {
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    s = inject(s, 0, 'mimring', 'mim', at(3, 3), at(2, 3));
    return s;
  }

  it('the line is 8 straight spaces from Mimring, clipped to the board', () => {
    const line = fireLineSpaces(withMimring(), 'mim', 0);
    expect(line).toContain(at(4, 3));
    expect(line).toContain(at(6, 3));
    expect(line.length).toBe(3); // cols 4,5,6 on a 7-wide field
  });

  it('hits a FRIENDLY figure on the line — no "enemy" qualifier', () => {
    let s = withMimring();
    s = inject(s, 0, 'tarn_vikings', 'ally', at(4, 3)); // same owner, on the line
    expect(fireLineTargets(s, 'mim', 0).map(f => f.id)).toContain('ally');
  });

  it('hits an enemy on the line; never an off-line figure or Mimring himself', () => {
    let s = withMimring();
    s = inject(s, 1, 'marro_warriors', 'enemy', at(4, 3));
    s = inject(s, 1, 'thorgrim', 'off', at(3, 4)); // off the line
    const ids = fireLineTargets(s, 'mim', 0).map(f => f.id);
    expect(ids).toContain('enemy');
    expect(ids).not.toContain('off');
    expect(ids).not.toContain('mim');
  });

  it('figures do NOT block the line — a figure behind another is still hit', () => {
    let s = withMimring();
    s = inject(s, 1, 'marro_warriors', 'near', at(4, 3)); // on the line, nearer
    s = inject(s, 1, 'marro_warriors', 'far', at(5, 3)); // behind 'near' on the line
    const ids = fireLineTargets(s, 'mim', 0).map(f => f.id);
    expect(ids).toContain('near');
    expect(ids).toContain('far'); // the fire passes through 'near' to reach 'far'
  });

  it('a height-15 WALL on the line BLOCKS the fire beyond it — no see-around from the back lobe (owner 2026-06-26)', () => {
    // Firing lobe (3,3) with the tail OFF the line at (3,4): the offset back lobe is exactly the case
    // where the old "either lobe" sight let it see AROUND a wall on the line, so the fire passed THROUGH
    // a pillar. Fire dir 0 → (4,3),(5,3),(6,3); a wall pillar at (5,3) must stop everything beyond it.
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    s = inject(s, 0, 'mimring', 'mim', at(3, 3), at(3, 4));
    s = inject(s, 1, 'marro_warriors', 'before', at(4, 3)); // in front of the wall
    s = inject(s, 1, 'marro_warriors', 'behind', at(6, 3)); // beyond the wall
    const cell = MAPS['training_field'].cells[at(5, 3)];
    const orig = cell.height;
    try {
      cell.height = 15; // a tall wall pillar between Mimring and 'behind'
      const ids = fireLineTargets(s, 'mim', 0, at(3, 3)).map(f => f.id);
      expect(ids).toContain('before');     // before the wall — still hit
      expect(ids).not.toContain('behind'); // beyond the wall — BLOCKED (the fix)
    } finally {
      cell.height = orig; // restore the shared map
    }
  });

  it('an ENGAGED Mimring may NOT Fire Line past his engagement (04-combat p.13, owner 2026-06-26)', () => {
    const MIM = 's0-mimring-1';
    let s = customBattle(['mimring'], ['finn', 'thorgrim'], 'p1'); // Mimring is the ACTIVE card
    s = place(s, MIM, at(3, 3));
    s = place(s, 's1-finn-1', at(3, 4));     // adjacent to Mimring → ENGAGED, OFF his dir-0 line
    s = place(s, 's1-thorgrim-1', at(5, 3)); // a NON-engaged enemy ON the dir-0 line
    // Firing the line would hit Thorgrim, whom Mimring is NOT engaged with → "shoots past" → rejected.
    const err = errOf(applyAction(s, 'p1', { kind: 'fire_line', attackerId: MIM, dir: 0, attackRoll: F('bbbb'), defenseRolls: [] }));
    expect(err).toMatch(/engaged/i);
    // Control: with Finn moved away (no engagement), the same line is no longer engagement-blocked.
    const free = place(s, 's1-finn-1', at(0, 7));
    expect(errOf(applyAction(free, 'p1', { kind: 'fire_line', attackerId: MIM, dir: 0, attackRoll: F('bbbb'), defenseRolls: [] }))).not.toMatch(/engaged/i);
  });

  it('fireLineDefenders returns one defense entry per affected figure', () => {
    let s = withMimring();
    s = inject(s, 0, 'tarn_vikings', 'ally', at(4, 3));
    const defs = fireLineDefenders(s, 'mim', 0);
    expect(defs.length).toBe(fireLineTargets(s, 'mim', 0).length);
    for (const d of defs) expect(d.defense).toBeGreaterThanOrEqual(0);
  });

  it('a lethal Fire Line that wipes the last enemy ENDS the game (fuzzer-found gap)', () => {
    // Mimring must be the ACTIVE card to actually fire, so stage it via customBattle.
    const MIM = 's0-mimring-1';
    const THOR = 's1-thorgrim-1';
    let s = customBattle(['mimring'], ['thorgrim'], 'p1'); // p2's ONLY figure is Thorgrim
    s = place(s, MIM, at(3, 3));
    s = place(s, THOR, at(4, 3)); // onto Mimring's dir-0 line
    s = { ...s, figures: s.figures.map(f => (f.id === THOR ? { ...f, wounds: 4 } : f)) }; // 1 life left
    const defs = fireLineDefenders(s, MIM, 0);
    s = unwrap(applyAction(s, 'p1', {
      kind: 'fire_line',
      attackerId: MIM,
      dir: 0,
      attackRoll: F('kkkk'),
      defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: F('b'.repeat(d.defense)) })),
    }));
    expect(fig(s, THOR).at).toBeNull(); // destroyed
    expect(s.phase).toBe('finished'); // ← was the bug: the game kept going
    expect(s.winnerSeat).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// orient_figure — player-chosen 2-hex orientation + 1-hex cosmetic facing
// ---------------------------------------------------------------------------
describe('orient_figure (2-hex orientation + 1-hex facing)', () => {
  /** Stage a figure on its own card (1-hex when at2 is null, else 2-hex). */
  function inject(s: HSState, seat: number, cardId: string, id: string, at1: string, at2: string | null = null): HSState {
    const c: HSState = JSON.parse(JSON.stringify(s));
    const uid = `s${seat}-${cardId}-${id}`;
    c.cards.push({ uid, cardId, ownerSeat: seat, orderMarkers: [], attackMod: 0, defenseMod: 0 });
    c.figures.push({ id, cardUid: uid, ownerSeat: seat, at: at1, at2, index: 1, wounds: 0 });
    return c;
  }

  it('swings a 2-hex figure’s trailing hex to a chosen free same-level direction', () => {
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    s = inject(s, 0, 'grimnak', 'big', at(3, 3), at(4, 3)); // my figure, my turn
    const opts = orientationOptions(s, 'big');
    expect(opts.baseSize).toBe(2);
    const target = opts.validDirs.find(d => d !== opts.currentDir);
    expect(target).toBeDefined();
    s = unwrap(applyAction(s, 'p1', { kind: 'orient_figure', figureId: 'big', dir: target! }));
    const f = fig(s, 'big');
    expect(f.at).toBe(at(3, 3)); // the LEAD never moves — orienting is not a move
    expect(f.at2).toBe(neighborKeys(at(3, 3))[target!]); // the tail swung to the chosen dir
    expect(f.facing).toBe(target);
  });

  it('rejects swinging the trailing hex onto an OCCUPIED hex', () => {
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    s = inject(s, 0, 'grimnak', 'big', at(3, 3), at(4, 3));
    const target = orientationOptions(s, 'big').validDirs.find(
      d => d !== orientationOptions(s, 'big').currentDir,
    )!;
    const blockHex = neighborKeys(at(3, 3))[target];
    s = inject(s, 0, 'finn', 'block', blockHex); // park a friendly on the target
    expect(errOf(applyAction(s, 'p1', { kind: 'orient_figure', figureId: 'big', dir: target })))
      .toMatch(/occupied/);
  });

  it('a 2-hex figure ENGAGED with an enemy cannot turn in place — it must move', () => {
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    s = inject(s, 0, 'grimnak', 'big', at(3, 3), at(4, 3));
    const before = orientationOptions(s, 'big');
    const enemyDir = before.validDirs.find(d => d !== before.currentDir)!;
    s = inject(s, 1, 'finn', 'foe', neighborKeys(at(3, 3))[enemyDir]); // adjacent enemy → engaged
    const after = orientationOptions(s, 'big');
    expect(after.engagedBlocked).toBe(true);
    const otherDir = after.validDirs.find(d => d !== after.currentDir)!;
    expect(errOf(applyAction(s, 'p1', { kind: 'orient_figure', figureId: 'big', dir: otherDir })))
      .toMatch(/engaged/);
  });

  it('sets a 1-hex figure’s cosmetic facing without moving it', () => {
    let s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    const before = fig(s, FINN).at;
    s = unwrap(applyAction(s, 'p1', { kind: 'orient_figure', figureId: FINN, dir: 3 }));
    expect(fig(s, FINN).facing).toBe(3);
    expect(fig(s, FINN).at).toBe(before); // a 1-hex turn never changes position
  });

  it('only your OWN figure, only on your turn', () => {
    const s = clearExcept(inTurns('p1'), FINN, THORGRIM);
    // p1 holds the turn but THORGRIM is the enemy's figure.
    expect(errOf(applyAction(s, 'p1', { kind: 'orient_figure', figureId: THORGRIM, dir: 1 })))
      .toMatch(/your own/);
    // p2 cannot act at all on p1's turn.
    expect(errOf(applyAction(s, 'p2', { kind: 'orient_figure', figureId: THORGRIM, dir: 1 })))
      .toMatch(/Not your turn/);
  });

  it('orientationOptions: a 1-hex figure can face any of the six directions', () => {
    const opts = orientationOptions(clearExcept(inTurns('p1'), FINN, THORGRIM), FINN);
    expect(opts.baseSize).toBe(1);
    expect(opts.validDirs).toEqual([0, 1, 2, 3, 4, 5]);
    expect(opts.engagedBlocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ne-Gok-Sa MIND SHACKLE 20 — seize an adjacent enemy's whole Army Card on a 20
// ---------------------------------------------------------------------------
describe('Mind Shackle 20 (Ne-Gok-Sa)', () => {
  const NEGOK = 's0-ne_gok_sa-1';
  const MW = (n: number) => `s1-marro_warriors-${n}`;

  /** Ne-Gok-Sa (p1, active) adjacent to a Marro Warrior (p2). p2 keeps a SECOND
   *  card (Thorgrim) so a successful shackle doesn't end the game. */
  function staged(p2 = ['marro_warriors', 'thorgrim']): HSState {
    let s = customBattle(['ne_gok_sa'], p2, 'p1');
    s = place(s, NEGOK, at(3, 3));
    s = place(s, MW(1), at(4, 3)); // adjacent to Ne-Gok-Sa
    return s;
  }

  it('mindShackleTargets / canMindShackle surface the adjacent enemy', () => {
    const s = staged();
    expect(mindShackleTargets(s, 0)).toContain(MW(1));
    expect(canMindShackle(s, 0)).toBe(true);
  });

  it('a natural 20 seizes the whole Army Card + every figure and clears its markers', () => {
    let s = staged();
    const marroUid = s.cards.find(c => c.cardId === 'marro_warriors')!.uid;
    s = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(1), d20: 20 }));
    const after = s.cards.find(c => c.uid === marroUid)!;
    expect(after.ownerSeat).toBe(0); // card seized
    expect(after.orderMarkers).toEqual([]); // "Remove any Order Markers on this card."
    for (const f of s.figures.filter(f => f.cardUid === marroUid)) {
      expect(f.ownerSeat).toBe(0); // ALL figures on the card transferred
    }
    expect(s.phase).toBe('playing'); // p2 still has Thorgrim
    // The roll surfaces a dice overlay (lastRoll) so players SEE the natural 20.
    expect(s.lastRoll).toMatchObject({ title: 'Mind Shackle', dice: [20], success: true });
  });

  it('below 20 transfers nothing and spends the one attempt for the turn', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(1), d20: 19 }));
    expect(s.cards.find(c => c.cardId === 'marro_warriors')!.ownerSeat).toBe(1);
    expect(s.mindShackleSpent).toBe(true);
    expect(s.lastRoll).toMatchObject({ title: 'Mind Shackle', dice: [19], success: false });
    expect(errOf(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(1), d20: 20 })))
      .toMatch(/already been attempted/);
  });

  it('only an ADJACENT ENEMY figure is a legal target', () => {
    let s = staged();
    s = place(s, MW(2), at(0, 0)); // far from Ne-Gok-Sa
    expect(errOf(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(2), d20: 20 }))).toMatch(/adjacent/);
    expect(errOf(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: NEGOK, d20: 20 }))).toMatch(/enemy/);
  });

  it('only Ne-Gok-Sa may Mind Shackle', () => {
    let s = customBattle(['finn'], ['marro_warriors'], 'p1');
    s = place(s, 's0-finn-1', at(3, 3));
    s = place(s, MW(1), at(4, 3));
    expect(errOf(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(1), d20: 20 }))).toMatch(/Only Ne-Gok-Sa/);
  });

  it('seizing a seat’s LAST figures wins the game', () => {
    let s = staged(['marro_warriors']); // p2 has ONLY the Marro
    s = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: MW(1), d20: 20 }));
    expect(s.phase).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });

  it('can Mind Shackle a 2-hex enemy via its SECOND lobe (footprint adjacency)', () => {
    let s = customBattle(['ne_gok_sa'], ['grimnak', 'thorgrim'], 'p1');
    s = place(s, NEGOK, at(3, 3));
    const GRIM = 's1-grimnak-1';
    s = place(s, GRIM, at(5, 3));   // the 2-hex LEAD is NOT adjacent to Ne-Gok-Sa
    fig(s, GRIM).at2 = at(4, 3);    // ...but its TAIL lobe is adjacent at (4,3)
    expect(mindShackleTargets(s, 0)).toContain(GRIM); // targetable via the 2nd lobe
    const grimUid = s.cards.find(c => c.cardId === 'grimnak')!.uid;
    s = unwrap(applyAction(s, 'p1', { kind: 'mind_shackle', targetId: GRIM, d20: 20 }));
    expect(s.cards.find(c => c.uid === grimUid)!.ownerSeat).toBe(0); // whole card seized
    expect(fig(s, GRIM).ownerSeat).toBe(0); // the 2-hex figure changed owner
  });
});

// ---------------------------------------------------------------------------
// Grimnak CHOMP — auto-destroy a Squad figure, d20 16+ vs a Hero, no Large/Huge
// ---------------------------------------------------------------------------
describe('Chomp (Grimnak)', () => {
  const GRIM = 's0-grimnak-1';
  const MW = (n: number) => `s1-marro_warriors-${n}`;
  const FINN1 = 's1-finn-1';

  /** Grimnak (p1, active) at (3,3); the test parks targets adjacent at (4,3). */
  function staged(p2: string[] = ['marro_warriors', 'finn']): HSState {
    let s = customBattle(['grimnak'], p2, 'p1');
    return place(s, GRIM, at(3, 3));
  }

  it('chompTargets / canChomp surface adjacent medium/small enemies', () => {
    let s = staged();
    s = place(s, MW(1), at(4, 3));
    expect(chompTargets(s, 0)).toContain(MW(1));
    expect(canChomp(s, 0)).toBe(true);
  });

  it('a Squad figure is devoured automatically (no roll needed)', () => {
    let s = staged();
    s = place(s, MW(1), at(4, 3));
    s = unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: MW(1), d20: 1 })); // even a 1
    expect(fig(s, MW(1)).at).toBeNull(); // destroyed regardless of the roll
    expect(s.lastEffect?.kind).toBe('chomp'); // 3D VFX: fangs snap at the target's hex
    expect(s.lastEffect?.to).toEqual([at(4, 3)]);
  });

  it('a Hero is devoured on 16+, survives below', () => {
    let s = staged();
    s = place(s, FINN1, at(4, 3));
    expect(fig(unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: FINN1, d20: 15 })), FINN1).at).not.toBeNull();
    expect(fig(unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: FINN1, d20: 16 })), FINN1).at).toBeNull();
  });

  it('Large/Huge figures cannot be Chomped', () => {
    let s = staged(['mimring']); // p2 has a Huge dragon
    s = place(s, 's1-mimring-1', at(4, 3));
    expect(chompTargets(s, 0)).not.toContain('s1-mimring-1');
    expect(errOf(applyAction(s, 'p1', { kind: 'chomp', targetId: 's1-mimring-1', d20: 20 }))).toMatch(/too large/);
  });

  it('only an adjacent enemy, and only one chomp per turn', () => {
    let s = staged();
    s = place(s, MW(1), at(4, 3));
    s = place(s, MW(2), at(0, 0)); // far away
    expect(errOf(applyAction(s, 'p1', { kind: 'chomp', targetId: MW(2), d20: 20 }))).toMatch(/adjacent/);
    s = unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: MW(1), d20: 1 }));
    expect(s.chompedThisTurn).toBe(true);
    s = place(s, MW(3), at(4, 3));
    expect(errOf(applyAction(s, 'p1', { kind: 'chomp', targetId: MW(3), d20: 1 }))).toMatch(/already Chomped/);
  });

  it('only Grimnak may Chomp', () => {
    let s = customBattle(['finn'], ['marro_warriors'], 'p1');
    s = place(s, 's0-finn-1', at(3, 3));
    s = place(s, MW(1), at(4, 3));
    expect(errOf(applyAction(s, 'p1', { kind: 'chomp', targetId: MW(1), d20: 20 }))).toMatch(/Only Grimnak/);
  });

  it('chomping a seat’s LAST figure ends the game', () => {
    let s = staged(['finn']); // p2 fields only a lone Hero
    s = place(s, FINN1, at(4, 3)); // adjacent to Grimnak at (3,3)
    s = unwrap(applyAction(s, 'p1', { kind: 'chomp', targetId: FINN1, d20: 16 }));
    expect(s.phase).toBe('finished');
    expect(s.winnerSeat).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deathwalker 9000 EXPLOSION — Range 7, Attack 3; chosen target + adjacent splash
// ---------------------------------------------------------------------------
describe('Explosion Special Attack (Deathwalker 9000)', () => {
  const DW = 's0-deathwalker_9000-1';
  const MW = (n: number) => `s1-marro_warriors-${n}`;
  const THOR = 's1-thorgrim-1';
  function staged(): HSState {
    let s = customBattle(['deathwalker_9000'], ['marro_warriors', 'thorgrim'], 'p1');
    s = clearExcept(s, DW, MW(1), MW(2), THOR);
    s = place(s, DW, at(3, 3));
    s = place(s, MW(1), at(5, 3)); // chosen target — Range 2, clear sight (not adjacent to DW)
    s = place(s, MW(2), at(4, 3)); // adjacent to MW(1) → caught in the splash
    s = place(s, THOR, at(0, 0));  // far away; keeps p2 alive after the blast
    return s;
  }

  it('targets an enemy in range/sight; defenders = target + adjacent splash', () => {
    const s = staged();
    expect(explosionTargets(s, DW)).toContain(MW(1));
    const ids = explosionDefenders(s, DW, MW(1)).map(d => d.figureId);
    expect(ids).toEqual(expect.arrayContaining([MW(1), MW(2)]));
    expect(ids).not.toContain(THOR); // not adjacent to the target → not splashed
  });

  it('one attack roll hits the target AND every adjacent figure; each defends', () => {
    let s = staged();
    const defs = explosionDefenders(s, DW, MW(1));
    const tHex = fig(s, MW(1)).at; // blast centre, captured before destruction
    s = unwrap(applyAction(s, 'p1', {
      kind: 'explosion', attackerId: DW, targetId: MW(1),
      attackRoll: F('kkk'), // 3 skulls
      defenseRolls: defs.map(d => ({ figureId: d.figureId, roll: F('b'.repeat(d.defense)) })),
    }));
    expect(s.lastEffect?.kind).toBe('blast'); // 3D VFX: a blast at the target hex
    expect(s.lastEffect?.to).toEqual([tHex]);
    expect(fig(s, MW(1)).at).toBeNull(); // target destroyed (Marro Life 1)
    expect(fig(s, MW(2)).at).toBeNull(); // adjacent splash destroyed too
    expect(s.turnAttacks.length).toBe(1); // the special IS the attack
    expect(s.lastAttack?.targetLabel).toMatch(/Explosion/);
  });

  it('only Deathwalker 9000 may Explosion', () => {
    let s = customBattle(['finn'], ['marro_warriors'], 'p1');
    s = place(s, 's0-finn-1', at(3, 3));
    s = place(s, MW(1), at(4, 3));
    expect(errOf(applyAction(s, 'p1', {
      kind: 'explosion', attackerId: 's0-finn-1', targetId: MW(1), attackRoll: F('kkk'), defenseRolls: [],
    }))).toMatch(/Only Deathwalker/);
  });
});

// ---------------------------------------------------------------------------
// Airborne Elite GRENADE SPECIAL ATTACK — once/game, per-Elite, splash, no LOS
// ---------------------------------------------------------------------------
describe('Grenade Special Attack (Airborne Elite)', () => {
  const A = (n: number) => `s0-airborne_elite-${n}`;
  const M = (n: number) => `s1-marro_warriors-${n}`;

  /** Airborne Elite (p1, active) with A1 in grenade range of two ADJACENT Marro
   *  (M1,M2); the other Marro are parked far away (out of range). */
  function staged(): HSState {
    let s = customBattle(['airborne_elite'], ['marro_warriors'], 'p1');
    for (let n = 1; n <= 4; n++) s = place(s, A(n), at(n - 1, 0)); // Elites near the top
    s = place(s, M(3), at(0, 7));
    s = place(s, M(4), at(6, 7)); // M3/M4 far from the Elites
    s = place(s, A(1), at(3, 1));
    s = place(s, M(1), at(3, 3));
    s = place(s, M(2), at(4, 3)); // adjacent to M1
    return s;
  }

  it('canGrenade + grenadeTargets surface in-range figures', () => {
    const s = staged();
    expect(canGrenade(s, 0)).toBe(true);
    expect(grenadeTargets(s, A(1))).toContain(M(1));
  });

  it('initiating opens the throw sequence, removes the once-per-game marker, spends the attack', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'grenade' }));
    expect(s.pendingChoice?.kind).toBe('grenade_throw');
    expect(s.cards.find(c => c.cardId === 'airborne_elite')!.grenadeUsed).toBe(true);
    expect(s.turnAttacks.length).toBeGreaterThan(0);
    expect(canGrenade(s, 0)).toBe(false); // marker gone
  });

  it('spends EVERY living Elite’s attack — no Elite may normal-attack after the grenade (squad special)', () => {
    let s = staged();
    const living = [1, 2, 3, 4].map(A).filter(id => fig(s, id).at != null);
    expect(living.length).toBeGreaterThan(1); // a real squad, not one figure
    s = unwrap(applyAction(s, 'p1', { kind: 'grenade' }));
    // Each living Elite now carries a spent-attack entry, so the per-figure attack
    // budget (attacksThisTurn ≥ maxAttacks) blocks a normal attack from any of them.
    for (const id of living) expect(s.turnAttacks.some(a => a.attackerId === id)).toBe(true);
  });

  it('a throw hits the target AND its neighbours (splash)', () => {
    let s = staged();
    s = unwrap(applyAction(s, 'p1', { kind: 'grenade' }));
    const defenders = grenadeDefenders(s, A(1), M(1)).map(d => d.figureId);
    expect(defenders).toContain(M(1));
    expect(defenders).toContain(M(2)); // adjacent → splashed
    s = unwrap(applyAction(s, 'p1', {
      kind: 'grenade_throw',
      targetId: M(1),
      attackRoll: F('kk'),
      defenseRolls: defenders.map(id => ({ figureId: id, roll: F('bbb') })),
    }));
    expect(fig(s, M(1)).at).toBeNull(); // destroyed
    expect(fig(s, M(2)).at).toBeNull(); // splash destroyed
  });

  it('once per game: after the grenade is used it cannot be used again', () => {
    let s = staged();
    // Leave only ONE living Elite so the throw sequence is exactly [A1] (a
    // grenade can target friend OR foe, so multiple Elites keep finding each
    // other as targets — that is correct, just not what this test isolates).
    s = place(s, A(2), null);
    s = place(s, A(3), null);
    s = place(s, A(4), null);
    s = unwrap(applyAction(s, 'p1', { kind: 'grenade' }));
    const defenders = grenadeDefenders(s, A(1), M(1)).map(d => ({ figureId: d.figureId, roll: F('bbb') }));
    s = unwrap(applyAction(s, 'p1', { kind: 'grenade_throw', targetId: M(1), attackRoll: F('kk'), defenseRolls: defenders }));
    expect(s.pendingChoice).toBeUndefined(); // only Elite has thrown → sequence ends
    expect(errOf(applyAction(s, 'p1', { kind: 'grenade' }))).toMatch(/once per game/);
  });

  it('targets beyond Range 5 are not legal', () => {
    const s = staged();
    expect(grenadeTargets(s, A(1))).not.toContain(M(3)); // far corner
    expect(grenadeTargets(s, A(1))).not.toContain(M(4));
  });
});

describe('shootBlockedHexes — the shooting envelope minus blocked line of sight', () => {
  // A flat map with one height-15 WALL in the middle row. A ranged shooter at that
  // row's left end sights straight DOWN the row, so every hex beyond the wall is in
  // Range but has no line of sight (the wall towers over the sightline). Start zones
  // are two rows top + bottom so the quick-game deploy succeeds before we hand-place.
  const WALL_MAP = 'test_los_wall';
  beforeAll(() => {
    MAPS[WALL_MAP] = parseMap(
      WALL_MAP,
      'LOS Wall',
      `
      row1@1: G1 G1 G1 G1 G1 G1 G1
      row2@1: G1 G1 G1 G1 G1 G1 G1
      row3:   G1 G1 G1 R15 G1 G1 G1
      row4:   G1 G1 G1 G1 G1 G1 G1
      row5@2: G1 G1 G1 G1 G1 G1 G1
      row6@2: G1 G1 G1 G1 G1 G1 G1
      `,
    );
  });

  /** Quick game on the wall map, board cleared, with one ranged Marro Warrior placed
   *  at the LEFT end of the wall's row (so the wall lies on its line of fire). */
  function withShooter(): { s: HSState; shooter: string } {
    let s = unwrap(applyAction(lobby(), 'p1', { kind: 'start_game', mapId: WALL_MAP, mode: 'quick' }));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    for (const f of s.figures) { f.at = null; f.at2 = null; }
    const cells = MAPS[WALL_MAP].cells;
    const wallKey = Object.keys(cells).find(k => cells[k].height === 15)!;
    const wr = cells[wallKey].r;
    const rowKeys = Object.keys(cells).filter(k => cells[k].r === wr);
    const shooterKey = rowKeys.reduce((a, b) => (cells[a].q < cells[b].q ? a : b)); // leftmost in the wall's row
    const marro = s.figures.find(f => f.cardUid === 's1-marro_warriors')!; // range 6
    marro.at = shooterKey;
    return { s, shooter: marro.id };
  }

  it('greys the in-range hexes a wall hides, keeps the clear ones', () => {
    const { s, shooter } = withShooter();
    const reach = shootingRangeHexes(s, shooter);
    const blocked = shootBlockedHexes(s, shooter);
    expect(blocked.size).toBeGreaterThan(0); // the wall hides something within range
    expect([...blocked].every(k => reach.has(k))).toBe(true); // blocked ⊆ in range
    expect(blocked.size).toBeLessThan(reach.size); // open directions stay clear
    const at = s.figures.find(f => f.id === shooter)!.at!;
    expect(blocked.has(at)).toBe(false); // never the shooter's own hex
  });

  it('is empty for a melee figure (Range 1) — nothing to preview', () => {
    const { s } = withShooter();
    const finn = s.figures.find(f => f.cardUid === 's0-finn')!; // Finn, Range 1
    finn.at = Object.keys(MAPS[WALL_MAP].cells)[0];
    expect(shootingRangeHexes(s, finn.id).size).toBe(0);
    expect(shootBlockedHexes(s, finn.id).size).toBe(0);
  });
});

describe('Glyph of Rannveig — suppresses Flying while occupied', () => {
  it('a flyer passes OVER a blocking enemy, but not while a figure stands on Rannveig', () => {
    // CORRIDOR_MAP: a 1-wide vertical corridor (col 2) is the only path between the banks.
    let s = inTurnsOn(CORRIDOR_MAP_ID, 'p1', { p1: 's0-finn' });
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === 's0-finn')!.cardId = 'raelin'; // make the active figure a FLYER
    s = place(s, FINN, at(2, 1)); // north corridor mouth
    s = place(s, MARRO(1), at(2, 2)); // enemy blocks the 1-wide corridor
    s = place(s, THORGRIM, at(0, 0)); // parked off the path (will stand on Rannveig)
    s = setGlyphs(s, []);
    expect(legalDestinations(s, FINN).has(at(2, 3))).toBe(true); // flies over the blocker to the far side
    // A figure on a face-up Rannveig strips Flying from everyone → the blocker now stops her.
    const r = setGlyphs(s, [{ id: 'rannveig', at: at(0, 0), faceUp: true }]); // Thorgrim already on (0,0)
    expect(legalDestinations(r, FINN).has(at(2, 3))).toBe(false);
  });
});

describe('Glyph of Mitonsoul — Massive Curse on reveal', () => {
  it('stopping on it opens the interactive curse ceremony; each owner rolls their figures, a 1 destroys', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    const glyphHex = at(3, 1); // adjacent to Finn at (3,0)
    s = setGlyphs(s, [{ id: 'mitonsoul', at: glyphHex, faceUp: false }]);
    s = place(s, FINN, at(3, 0));
    s = place(s, THORGRIM, at(0, 0));
    s = place(s, MARRO(1), at(5, 5));
    // Finn stops on Mitonsoul → the ROLL CEREMONY opens (mode 'curse'), every on-board figure queued.
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('roll_ceremony');
    const pc0 = moved.pendingChoice;
    expect(pc0?.kind === 'roll_ceremony' && pc0.mode).toBe('curse');
    const queued = pc0?.kind === 'roll_ceremony' ? pc0.queue.flatMap(q => q.figureIds) : [];
    expect(queued).toEqual(expect.arrayContaining([FINN, THORGRIM, MARRO(1)]));
    expect(pc0?.kind === 'roll_ceremony' && pc0.seat).toBe(0); // Finn's owner (the stepper) rolls first
    // Only Finn rolls a 1 → only Finn is destroyed; the temporary glyph is removed at the end.
    const after = drainCeremony(moved, id => (id === FINN ? 1 : 7));
    expect(fig(after, FINN).at).toBeNull(); // rolled a 1 → destroyed
    expect(fig(after, THORGRIM).at).not.toBeNull(); // survived
    expect(fig(after, MARRO(1)).at).not.toBeNull(); // survived
    expect(after.glyphs.find(g => g.at === glyphHex)).toBeUndefined(); // temporary glyph removed
    expect(after.pendingChoice).toBeUndefined();
  });

  it('select highlights a figure for everyone, and only the current owner may roll it', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'mitonsoul', at: glyphHex, faceUp: false }]);
    s = place(s, FINN, at(3, 0));
    s = place(s, THORGRIM, at(0, 0));
    s = place(s, MARRO(1), at(5, 5));
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    // Seat 0 (Finn) is up. p2 cannot select or roll; p1 selects → the highlight is shared on state.
    expect(errOf(applyAction(moved, 'p2', { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: FINN } }))).toBeTruthy();
    const sel = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: FINN } }));
    expect(sel.pendingChoice?.kind === 'roll_ceremony' && sel.pendingChoice.selectedFigureId).toBe(FINN);
    // You can't roll before selecting is honoured — but here it's selected, so a roll resolves it.
    const rolled = unwrap(applyAction(sel, 'p1', { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll', d20: 1 } }));
    expect(fig(rolled, FINN).at).toBeNull(); // destroyed; the ceremony then moves to seat 1's figures
    expect(rolled.pendingChoice?.kind === 'roll_ceremony' && rolled.pendingChoice.seat).toBe(1);
  });

  it('Glyph of Lodin saves a figure from the curse (raw 1 + Lodin = 2) and the result carries the +1 for the panel', () => {
    // Seat 0 = Tarn Vikings (a squad), so one of its figures can HOLD Lodin while another is cursed.
    let s = noGlyphs(inTurns('p1', { p1: 's0-tarn_vikings', p2: 's1-marro_warriors' }));
    s = clearExcept(s, TARN(1), TARN(2), MARRO(1));
    const glyphHex = at(3, 1);   // adjacent to TARN(1) at (3,0)
    const lodinHex = at(0, 0);
    s = setGlyphs(s, [{ id: 'mitonsoul', at: glyphHex, faceUp: false }, { id: 'lodin', at: lodinHex, faceUp: true }]);
    s = place(s, TARN(1), at(3, 0));
    s = place(s, TARN(2), lodinHex); // a seat-0 figure holds Lodin → seat 0's d20s get +1
    s = place(s, MARRO(1), at(5, 5));
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: TARN(1), to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('roll_ceremony');
    // TARN(1) (seat 0) rolls a raw 1 — but Lodin lifts it to 2, so the curse SPARES him.
    const sel = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_select', figureId: TARN(1) } }));
    const rolled = unwrap(applyAction(sel, 'p1', { kind: 'resolve_choice', choice: { kind: 'roll_ceremony_roll', d20: 1 } }));
    expect(fig(rolled, TARN(1)).at).not.toBeNull(); // raw 1 + Lodin = 2 → SURVIVES (not destroyed)
    // The result records the raw die AND the Lodin bonus so the panel can render "1+1" → green (safe).
    const res = rolled.pendingChoice?.kind === 'roll_ceremony'
      ? rolled.pendingChoice.results.find(r => r.figureId === TARN(1))
      : undefined;
    expect(res).toMatchObject({ d20: 1, lodin: 1, outcome: 'safe' });
  });
});

describe('audit fixes: soft-lock / waste guards (M1–M3)', () => {
  it('M1 — grenade with no figure in Range 5 is rejected and does NOT burn the once-per-game marker', () => {
    // grenadeTargets counts ANY figure (the splash hits friend or foe), so leave a SINGLE Elite on
    // the board with the lone enemy parked out of range — then nothing is targetable.
    let s = customBattle(['airborne_elite'], ['marro_warriors'], 'p1');
    s = clearExcept(s, 's0-airborne_elite-1', 's1-marro_warriors-1');
    s = place(s, 's0-airborne_elite-1', at(0, 0));
    s = place(s, 's1-marro_warriors-1', at(6, 7)); // out of Range 5
    expect(canGrenade(s, 0)).toBe(false);
    expect(errOf(applyAction(s, 'p1', { kind: 'grenade' }))).toMatch(/wasted|target|range/i);
    expect(s.cards.find(c => c.cardId === 'airborne_elite')!.grenadeUsed).toBeFalsy(); // marker NOT burned
    expect(s.turnAttacks.length).toBe(0); // attack NOT spent
  });

  it('M2 — a Massive Curse that destroys the last figure of EVERY team ends as a draw, not a hang', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, MARRO(1)); // exactly one figure per team on the board
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'mitonsoul', at: glyphHex, faceUp: false }]);
    s = place(s, FINN, at(3, 0));
    s = place(s, MARRO(1), at(5, 5));
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('roll_ceremony');
    const after = drainCeremony(moved, () => 1); // everyone rolls a 1 → all destroyed
    expect(after.figures.every(f => f.at == null)).toBe(true); // board wiped
    expect(after.phase).toBe('finished'); // ended — not stuck looping over an empty board
    expect(after.winnerSeat).toBeNull(); // draw: no winner
    expect(after.winnerTeam).toBeNull();
  });

  it('M3 — start_game re-packs non-contiguous seats so no seat is left without a start zone', () => {
    let s = initialState();
    s = addPlayer(s, 'p1', 'Alice', 0);
    s = addPlayer(s, 'p3', 'Carol', 2); // seat 1 left empty — a gap (a player left, or sparse seating)
    expect(s.players.map(p => p.seat)).toEqual([0, 2]);
    s = unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'draft', mapId: 'training_field', pointBudget: 300 }));
    expect(s.players.map(p => p.seat).sort((a, b) => a - b)).toEqual([0, 1]); // normalised
    for (const p of s.players) expect(placeableHexes(s, p.seat).size).toBeGreaterThan(0); // every seat has a zone
  });

  it('grenade splash hits a 2-hex figure adjacent via EITHER lobe — and only ONCE', () => {
    let s = customBattle(['airborne_elite'], ['marro_warriors', 'grimnak'], 'p1');
    s = place(s, 's0-airborne_elite-1', at(3, 0)); // thrower in range of the target
    s = place(s, 's1-marro_warriors-1', at(3, 3)); // primary target (1-hex)
    s = place(s, 's1-marro_warriors-2', at(0, 7)); // other Marro parked far (not adjacent)
    s = place(s, 's1-marro_warriors-3', at(2, 7));
    s = place(s, 's1-marro_warriors-4', at(6, 7));
    // Grimnak (2-hex): LEAD not adjacent to the target, TAIL adjacent — so it's caught via the tail.
    const grim = s.figures.find(f => f.id === 's1-grimnak-1')!;
    grim.at = at(5, 3); // lead — distance 2 from the target, NOT adjacent
    grim.at2 = at(4, 3); // tail — adjacent to the target (3,3)
    const defs = grenadeDefenders(s, 's0-airborne_elite-1', 's1-marro_warriors-1');
    expect(defs.filter(d => d.figureId === 's1-grimnak-1')).toHaveLength(1); // hit once, not twice for its 2 hexes
    expect(defs.some(d => d.figureId === 's1-marro_warriors-1')).toBe(true); // …plus the target itself
  });
});

describe('The Drop — rolled before markers + placement legality', () => {
  // A fresh round-start (place_markers) state with the Airborne squad held in reserve.
  function dropStart(): HSState {
    let s = customBattle(['airborne_elite'], ['marro_warriors'], 'p1');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.subPhase = 'place_markers';
    s.markersReady = [];
    s.turnSeat = null;
    delete s.airborneDropRound;
    for (const f of s.figures) if (f.cardUid === 's0-airborne_elite') { f.at = null; f.reserve = true; }
    return s;
  }

  it('order markers are blocked until the Airborne player rolls The Drop', () => {
    let s = dropStart();
    const markers = allOn('s1-marro_warriors');
    // p2 (no Airborne) can't lock in while the Airborne still owe a Drop this round.
    expect(errOf(applyAction(s, 'p2', { kind: 'place_markers', assignments: markers }))).toMatch(/Drop/i);
    // After the Airborne roll (a miss still counts as rolled), markers open.
    s = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 1 }));
    s = unwrap(applyAction(s, 'p2', { kind: 'place_markers', assignments: markers }));
    expect(s.markersReady).toContain(1);
  });

  it('a 13+ Drop opens placement; landings exclude figures + their neighbours; a valid drop deploys all reserve', () => {
    let s = dropStart();
    for (const f of s.figures) if (f.cardUid === 's1-marro_warriors' && f.id !== 's1-marro_warriors-1') f.at = null;
    s = place(s, 's1-marro_warriors-1', at(3, 3)); // one enemy on the board
    s = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 20 })); // hit → airborne_drop pending opens
    expect(s.pendingChoice?.kind).toBe('airborne_drop');
    const legal = theDropHexes(s, 0);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal).not.toContain(at(3, 3)); // never on a figure
    for (const n of neighborKeys(at(3, 3))) expect(legal).not.toContain(n); // nor adjacent to one
    const pick: string[] = [];
    for (const k of legal) { if (pick.length >= 4) break; if (!pick.some(p => neighborKeys(p).includes(k))) pick.push(k); }
    expect(pick).toHaveLength(4);
    expect(errOf(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: pick.slice(0, 3) } }))).toMatch(/all|place|4/i); // must place all 4
    const ok = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: pick } }));
    expect(ok.figures.filter(f => f.cardUid === 's0-airborne_elite' && f.at != null)).toHaveLength(4); // all deployed
    expect(ok.figures.filter(f => f.cardUid === 's0-airborne_elite' && f.reserve)).toHaveLength(0); // none still reserve
  });

  // --- Deadlock regression (re-audit HIGH): the place-markers gate blocks markers
  // until the Airborne seat rolls The Drop. If an AI ever DECLINED the roll (returned
  // place_markers) the gate rejected it and ai_step threw — freezing the whole room.
  // The fix: always roll; on a 13+ that can't seat a full squad, decline the LANDING.
  it('AI always rolls The Drop before markers — even when no full squad can land (root cause of the freeze)', () => {
    let s = dropStart();
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.mapId = TINY_MAP_ID; // 3-hex strip: a 4-figure drop can never fit here
    for (const f of s.figures) if (f.cardUid === 's1-marro_warriors') f.at = null;
    s = place(s, 's1-marro_warriors-1', at(1, 0)); // one enemy mid-strip (kills every landing)
    // Pre-fix the AI returned place_markers here; the gate then rejected it and the
    // room hung. The roll itself sets airborneDropRound (hit or miss), clearing the gate.
    expect(aiNextAction(s, 0)?.kind).toBe('the_drop');
  });

  it('AI DECLINES the landing ([]) when the board cannot seat a full squad — no freeze', () => {
    let s = dropStart();
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.mapId = TINY_MAP_ID;
    for (const f of s.figures) if (f.cardUid === 's1-marro_warriors') f.at = null;
    s = place(s, 's1-marro_warriors-1', at(1, 0));
    s = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 20 })); // guaranteed hit → landing opens
    expect(s.pendingChoice?.kind).toBe('airborne_drop');
    const a = aiNextAction(s, 0); // routes to aiResolveChoice (pendingChoice.seat === 0)
    expect(a).toEqual({ kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: [] } });
    const after = unwrap(applyAction(s, 'p1', a!)); // the engine accepts the decline
    expect(after.pendingChoice).toBeUndefined();
    expect(after.figures.filter(f => f.cardUid === 's0-airborne_elite' && f.reserve)).toHaveLength(4); // all kept
  });

  it('The Drop landing accepts an empty decline — squad stays in reserve, gate clears, markers open', () => {
    let s = dropStart();
    s = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 20 })); // hit opens the landing
    expect(s.pendingChoice?.kind).toBe('airborne_drop');
    const declined = unwrap(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: [] } }));
    expect(declined.pendingChoice).toBeUndefined();
    expect(declined.figures.filter(f => f.cardUid === 's0-airborne_elite' && f.reserve)).toHaveLength(4); // none deployed
    expect(declined.figures.filter(f => f.cardUid === 's0-airborne_elite' && f.at != null)).toHaveLength(0);
    // the round's Drop WAS rolled, so the other player can now lock order markers (gate cleared)
    const s2 = unwrap(applyAction(declined, 'p2', { kind: 'place_markers', assignments: allOn('s1-marro_warriors') }));
    expect(s2.markersReady).toContain(1);
  });

  it('a partial drop (some-but-not-all) is rejected — The Drop is all-or-nothing', () => {
    let s = dropStart();
    for (const f of s.figures) if (f.cardUid === 's1-marro_warriors' && f.id !== 's1-marro_warriors-1') f.at = null;
    s = place(s, 's1-marro_warriors-1', at(3, 3));
    s = unwrap(applyAction(s, 'p1', { kind: 'the_drop', d20: 20 }));
    const legal = theDropHexes(s, 0);
    const pick: string[] = [];
    for (const k of legal) { if (pick.length >= 4) break; if (!pick.some(p => neighborKeys(p).includes(k))) pick.push(k); }
    expect(pick.length).toBeGreaterThanOrEqual(2);
    // 2 of a 4-figure squad is neither a full drop nor a decline → rejected.
    expect(errOf(applyAction(s, 'p1', { kind: 'resolve_choice', choice: { kind: 'airborne_drop', placements: pick.slice(0, 2) } }))).toMatch(/all|none/i);
  });
});

describe('eliminated seat forfeits its reserve-Airborne turn — no last-chance Drop (fix 2026-06-27)', () => {
  it('a team wiped ON THE BOARD but holding reserve Airborne does NOT reveal its marker and DROP', () => {
    // The user's 6-player report: a seat did The Drop AFTER it was eliminated. Repro at the turn-loop
    // level: seat 1 = Airborne Elite (its first card → all 4 markers land on it) + Eldgrim. customBattle
    // deploys both; we then hold the Airborne in RESERVE and KILL Eldgrim, so seat 1 is wiped on the
    // board with only reserve Airborne left — eliminated per the 2026-06-25 ruling (no last-chance
    // Drop). Seat 0 (Finn) lives. The bug was beginTurnOrSkip gating on cardHasLivingFigures (counts
    // reserve) instead of seatIsAlive, so seat 1's Airborne marker turn revealed + Dropped it back in.
    let s = customBattle(['finn'], ['airborne_elite', 'eldgrim'], 'p1', 'training_field');
    s = JSON.parse(JSON.stringify(s)) as HSState;
    for (const f of s.figures) {
      if (f.cardUid === 's1-airborne_elite') { f.at = null; f.at2 = null; f.reserve = true; }
      if (f.cardUid === 's1-eldgrim') { f.at = null; f.at2 = null; } // killed → casualty (off-board, not reserve)
    }
    expect(s.figures.some(f => f.ownerSeat === 1 && f.at != null)).toBe(false); // seat 1 wiped on-board
    expect(s.turnSeat).toBe(0);          // it's seat 0's (Finn's) turn
    // Seat 0 ends its turn → the loop reaches seat 1's Airborne marker. It must FORFEIT, not Drop.
    const after = unwrap(applyAction(s, 'p1', { kind: 'end_turn' }));
    expect(after.turnSeat).not.toBe(1);                          // seat 1 never becomes the acting seat
    expect(after.pendingChoice?.kind).not.toBe('airborne_drop'); // no Drop landing was opened
    // The Airborne stay in reserve — they did NOT drop back onto the board (no resurrection).
    expect(after.figures.filter(f => f.cardUid === 's1-airborne_elite' && f.reserve)).toHaveLength(4);
    expect(after.figures.some(f => f.cardUid === 's1-airborne_elite' && f.at != null)).toBe(false);
    // The log names the forfeit (the marker IS still revealed per the lost-turn rule, then forfeited).
    expect(after.log.some(e => /eliminated.*forfeit/i.test(e.text))).toBe(true);
  });

  it('an eliminated seat canNOT ROLL The Drop at round start — no comeback (fix 2026-06-27)', () => {
    // The round-start path (separate from the turn loop above): the AI rolled The Drop for a defeated
    // seat and it came back — game-breaking. Seat 0 = Airborne (reserve) + Eldgrim (deployed, killed)
    // → wiped on board, only reserve left = eliminated; it must not be allowed to roll The Drop.
    const atRoundStart = (cards: string[]) => {
      let s = customBattle(cards, ['marro_warriors'], 'p1', 'training_field');
      s = JSON.parse(JSON.stringify(s)) as HSState;
      s.subPhase = 'place_markers'; s.markersReady = []; s.turnSeat = null; delete s.airborneDropRound;
      for (const f of s.figures) {
        if (f.cardUid === 's0-airborne_elite') { f.at = null; f.at2 = null; f.reserve = true; }
        if (f.cardUid === 's0-eldgrim') { f.at = null; f.at2 = null; } // killed → casualty
      }
      return s;
    };
    const wiped = atRoundStart(['airborne_elite', 'eldgrim']);
    expect(errOf(applyAction(wiped, 'p1', { kind: 'the_drop', d20: 20 }))).toMatch(/wiped|eliminat/i);
    expect(aiNextAction(wiped, 0)).not.toMatchObject({ kind: 'the_drop' }); // AI never rolls for the dead seat
    // Control: an ALL-Airborne team that never lost a figure (no casualty) CAN still roll + drop.
    const allAir = atRoundStart(['airborne_elite']);
    const dropped = unwrap(applyAction(allAir, 'p1', { kind: 'the_drop', d20: 20 }));
    expect(dropped.pendingChoice?.kind).toBe('airborne_drop'); // a hit opens the landing — it's alive
  });
});

describe('audit fixes: height × special attacks / melee (H2/H4)', () => {
  it('H2 — a grenade KEEPS the defender height bonus (no longer strips it)', () => {
    let s = customBattle(['airborne_elite'], ['marro_warriors'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, 's0-airborne_elite-1', 's1-marro_warriors-1');
    s = place(s, 's0-airborne_elite-1', at(1, 1)); // grass — height 1
    s = place(s, 's1-marro_warriors-1', at(0, 1)); // on the R5 pillar — height 5, above the thrower
    const target = fig(s, 's1-marro_warriors-1');
    const thrower = fig(s, 's0-airborne_elite-1');
    const h = heightAdvantage(s, thrower, target).defender;
    expect(h).toBeGreaterThan(0); // the defender IS on higher ground
    const def = grenadeDefenders(s, 's0-airborne_elite-1', 's1-marro_warriors-1')
      .find(d => d.figureId === 's1-marro_warriors-1')!.defense;
    // The grenade defender keeps the FULL height-included dice (pre-fix this returned dice − h).
    expect(def).toBe(effectiveDefenseDice(s, target, thrower).dice);
  });

  it('H4 — melee across a big height break is blocked (figures are not truly adjacent)', () => {
    let s = customBattle(['finn'], ['marro_warriors'], 'p1', CLIFF_MAP_ID);
    s = clearExcept(s, FINN, MARRO(1));
    s = place(s, FINN, at(4, 1)); // atop the R25 pillar — height 25
    s = place(s, MARRO(1), at(5, 1)); // grass, hex-adjacent but 24 levels below
    expect(legalTargets(s, FINN)).not.toContain(MARRO(1)); // can't melee across the break
    // control: on flat grass the same hex-adjacency IS a legal melee target
    const flat = place(place(s, FINN, at(3, 3)), MARRO(1), at(4, 3));
    expect(legalTargets(flat, FINN)).toContain(MARRO(1));
  });
});

describe('Glyph of Sturla — Resurrection on reveal', () => {
  it('a destroyed figure rolls a d20; a 20 returns it to its owner start zone, else it stays dead', () => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, THORGRIM, MARRO(1));
    s = place(s, FINN, at(3, 0));
    s = place(s, THORGRIM, at(0, 0));
    // MARRO(1) is destroyed (off the board, not reserve) — eligible for resurrection.
    s = JSON.parse(JSON.stringify(s)) as HSState;
    const marro = s.figures.find(f => f.id === MARRO(1))!;
    marro.at = null; marro.at2 = null; marro.wounds = 2; // died carrying wounds
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'sturla', at: glyphHex, faceUp: false }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('roll_ceremony');
    expect(moved.pendingChoice?.kind === 'roll_ceremony' && moved.pendingChoice.mode).toBe('resurrect');
    const queued = moved.pendingChoice?.kind === 'roll_ceremony' ? moved.pendingChoice.queue.flatMap(q => q.figureIds) : [];
    expect(queued).toContain(MARRO(1)); // the dead figure is eligible to roll
    // Roll a 20 for MARRO, a miss for any other dead figure → only MARRO rises and must be PLACED.
    const rolled = drainCeremony(moved, id => (id === MARRO(1) ? 20 : 7));
    // The roll does NOT auto-place — it opens a placement choice OWNED by the figure's owner (seat 1).
    expect(rolled.pendingChoice?.kind).toBe('glyph_sturla_place');
    expect(rolled.pendingChoice?.kind === 'glyph_sturla_place' && rolled.pendingChoice.figureId).toBe(MARRO(1));
    expect(rolled.pendingChoice?.kind === 'glyph_sturla_place' && rolled.pendingChoice.seat).toBe(1); // seat-1 owns Marro
    expect(fig(rolled, MARRO(1)).at).toBeNull(); // still off-board until its owner sets it down
    expect(rolled.glyphs.find(g => g.at === glyphHex)).toBeUndefined(); // temporary glyph already removed
    // The OWNER (p2) taps a free start-zone hex; the figure returns FRESH.
    const z1 = MAPS[rolled.mapId].startZones[1] ?? [];
    const spots = sturlaPlacementHexes(rolled, MARRO(1));
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every(h => z1.includes(h))).toBe(true); // only its owner's start zone
    const back = unwrap(applyAction(rolled, 'p2', {
      kind: 'resolve_choice',
      choice: { kind: 'glyph_sturla_place', hex: spots[0] },
    }));
    expect(fig(back, MARRO(1)).at).toBe(spots[0]); // placed where the owner chose
    expect(fig(back, MARRO(1)).wounds).toBe(0); // returns FRESH — no leftover wound markers
    expect(back.pendingChoice).toBeUndefined(); // queue drained — back to normal play
    // A non-20 leaves it destroyed with NO placement step at all.
    const stay = drainCeremony(moved, () => 7);
    expect(stay.pendingChoice).toBeUndefined(); // nobody rose → no placement pending
    expect(fig(stay, MARRO(1)).at).toBeNull();
  });

  it('returns a riser to its OWNER\'s real Star-Field zone, not the raw 2-player startZones (owner 2026-06-28)', () => {
    // Multiplayer games run on the Star Field, whose per-seat zones live in zonesByCount. Reading
    // map.startZones DIRECTLY (the bug) gave the 2-player rectangle tips, so a resurrected figure landed
    // in the WRONG seat's zone (or was skipped for seat 2+). startZoneFor resolves the real per-count zone.
    const state = {
      mapId: STAR_FIELD.id, edition: 'modern',
      players: [
        { seat: 0, playerId: 'p0', username: 'A' },
        { seat: 1, playerId: 'p1', username: 'B' },
        { seat: 2, playerId: 'p2', username: 'C' },
      ],
      cards: [{ uid: 's2-finn', cardId: 'finn', ownerSeat: 2, orderMarkers: [], attackMod: 0, defenseMod: 0 }],
      figures: [{ id: 's2-finn-1', cardUid: 's2-finn', ownerSeat: 2, at: null, index: 1, wounds: 0 }],
    } as unknown as HSState;
    const ownerZone = startZoneFor(state, 2); // zonesByCount[3][2] — seat 2's REAL zone
    const spots = sturlaPlacementHexes(state, 's2-finn-1');
    expect(spots.length).toBeGreaterThan(0); // not skipped (the buggy map.startZones[2] was empty)
    expect(spots).toEqual(ownerZone); // nothing occupied → exactly the owner's per-count zone
    // …and that zone is NOT the raw startZones the buggy code read (the bug's wrong location).
    expect(ownerZone).not.toEqual(STAR_FIELD.startZones[2] ?? []);
  });

  it('places risers one at a time, each owned by that figure\'s owner (cross-player queue)', () => {
    // Two seats each lose a figure; both roll 20 → two placement choices, in turn, each owned
    // by the respective owner. Confirms the queue advances owner-by-owner and drains fully.
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    // Keep one SURVIVOR alive per seat (Finn for seat 0, Thorgrim for seat 1) so killing the
    // risers can't trigger an elimination win before the glyph fires.
    s = clearExcept(s, FINN, TARN(1), THORGRIM, MARRO(1));
    s = place(s, FINN, at(3, 0));
    s = place(s, THORGRIM, at(0, 7)); // seat-1 survivor, parked out of the way
    s = JSON.parse(JSON.stringify(s)) as HSState;
    // TARN(1) is seat-0's dead figure; MARRO(1) is seat-1's. Both off-board, both eligible.
    for (const id of [TARN(1), MARRO(1)]) {
      const f = s.figures.find(x => x.id === id)!;
      f.at = null; f.at2 = null; f.wounds = 1;
    }
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'sturla', at: glyphHex, faceUp: false }]);
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('roll_ceremony');
    // Roll 20 only for our two stage-managed figures (others among the cleared dead miss) → exactly two rise.
    const risers = new Set([TARN(1), MARRO(1)]);
    let cur = drainCeremony(moved, id => (risers.has(id) ? 20 : 7));
    // Drain the placement queue: each step is owned by the current riser's owner; place into its zone.
    const placedOwners: number[] = [];
    let guard = 0;
    while (cur.pendingChoice?.kind === 'glyph_sturla_place' && guard++ < 10) {
      const pc = cur.pendingChoice;
      placedOwners.push(pc.seat);
      const spots = sturlaPlacementHexes(cur, pc.figureId);
      expect(spots.length).toBeGreaterThan(0);
      // Only the riser's OWNER may resolve it — an outsider is rejected.
      expect(errOf(applyAction(cur, pc.seat === 0 ? 'p2' : 'p1', {
        kind: 'resolve_choice', choice: { kind: 'glyph_sturla_place', hex: spots[0] },
      }))).toBeTruthy();
      cur = unwrap(applyAction(cur, pc.seat === 0 ? 'p1' : 'p2', {
        kind: 'resolve_choice',
        choice: { kind: 'glyph_sturla_place', hex: spots[0] },
      }));
    }
    expect(cur.pendingChoice).toBeUndefined(); // fully drained
    expect(placedOwners.sort()).toEqual([0, 1]); // one placement per owner (cross-player)
    expect(fig(cur, TARN(1)).at).not.toBeNull();
    expect(fig(cur, MARRO(1)).at).not.toBeNull();
    expect(fig(cur, TARN(1)).wounds).toBe(0);
    expect(fig(cur, MARRO(1)).wounds).toBe(0);
  });
});

describe('Glyph of Oreld — Remove Marker: public roll, then choose a player', () => {
  // Shared setup: Finn (p1/seat 0) reveals Oreld; the enemy Marro (p2/seat 1) has one unrevealed
  // marker. Finn keeps a REVEALED '1' (active card) plus one unrevealed '2'.
  const setup = (): { s: HSState; glyphHex: string } => {
    let s = noGlyphs(inTurns('p1', { p1: 's0-finn', p2: 's1-marro_warriors' }));
    s = clearExcept(s, FINN, MARRO(1));
    s = place(s, FINN, at(3, 0));
    s = JSON.parse(JSON.stringify(s)) as HSState;
    for (const c of s.cards) c.orderMarkers = [];
    s.cards.find(c => c.uid === 's0-finn')!.orderMarkers = [{ marker: '1', revealed: true }, { marker: '2', revealed: false }];
    s.cards.find(c => c.uid === 's1-marro_warriors')!.orderMarkers = [{ marker: '3', revealed: false }];
    const glyphHex = at(3, 1);
    s = setGlyphs(s, [{ id: 'oreld', at: glyphHex, faceUp: false }]);
    return { s, glyphHex };
  };

  it('STEP 1 rolls a public d20; on 2+ the controller NAMES a player who loses an unrevealed marker', () => {
    const { s, glyphHex } = setup();
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    expect(moved.pendingChoice?.kind).toBe('glyph_oreld');
    expect(moved.pendingChoice?.kind === 'glyph_oreld' && moved.pendingChoice.d20).toBe(null); // unrolled
    // STEP 1 — a 5 (a win). The choice stays OPEN with the rolled d20 + engine-vetted victim seats;
    // the glyph is NOT spent until the pick is made.
    const rolled = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 5 } }));
    const pc = rolled.pendingChoice?.kind === 'glyph_oreld' ? rolled.pendingChoice : null;
    expect(pc?.d20).toBe(5);
    expect(pc?.victimSeats).toEqual([1]); // only the opponent has an unrevealed marker
    expect(rolled.glyphs.find(g => g.at === glyphHex)).toBeDefined();
    // STEP 2 — name the opponent (seat 1). They lose their unrevealed marker; OWN is untouched; glyph spent.
    const after = unwrap(applyAction(rolled, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', victimSeat: 1 } }));
    expect(after.cards.find(c => c.uid === 's1-marro_warriors')!.orderMarkers.length).toBe(0);
    expect(after.cards.find(c => c.uid === 's0-finn')!.orderMarkers.length).toBe(2);
    expect(after.pendingChoice).toBeUndefined();
    expect(after.glyphs.find(g => g.at === glyphHex)).toBeUndefined();
  });

  it('naming a non-eligible player is rejected (only vetted victim seats)', () => {
    const { s, glyphHex } = setup();
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    const rolled = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 9 } }));
    // Seat 0 is the controller themselves — never a valid Oreld victim.
    expect('error' in applyAction(rolled, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', victimSeat: 0 } })).toBe(true);
  });

  it('a roll of 1 BACKFIRES — the controller loses their OWN unrevealed marker, no pick, glyph spent', () => {
    const { s, glyphHex } = setup();
    const moved = unwrap(applyAction(s, 'p1', { kind: 'move_figure', figureId: FINN, to: glyphHex }));
    const after = unwrap(applyAction(moved, 'p1', { kind: 'resolve_choice', choice: { kind: 'glyph_oreld', d20: 1 } }));
    const finnMarks = after.cards.find(c => c.uid === 's0-finn')!.orderMarkers;
    expect(finnMarks.length).toBe(1);
    expect(finnMarks[0].marker).toBe('1'); // the revealed '1' stays; the unrevealed '2' is lost
    expect(after.cards.find(c => c.uid === 's1-marro_warriors')!.orderMarkers.length).toBe(1); // opponent safe
    expect(after.pendingChoice).toBeUndefined();
    expect(after.glyphs.find(g => g.at === glyphHex)).toBeUndefined();
  });
});

describe('Random per-game glyph layout', () => {
  it('count scales with map size (small → 2, capped at 7)', () => {
    expect(glyphCountForMap(56)).toBe(2); // Training Field-sized → minimum 2
    expect(glyphCountForMap(300)).toBe(5); // ~1 per 60 hexes
    expect(glyphCountForMap(661)).toBe(7); // Star Field-sized → capped at 7
  });

  it('a seed places distinct active-pool glyphs off start zones + water; same seed is deterministic', () => {
    const start = (seed: number): HSState => {
      let s = initialState();
      s = addPlayer(s, 'p1', 'A', 0, '#10b981');
      s = addPlayer(s, 'p2', 'B', 1, '#ef4444');
      return unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick', mapId: 'training_field', glyphSeed: seed }));
    };
    const s = start(98765);
    expect(s.glyphs.length).toBe(2); // Training Field is small → 2
    const map = MAPS['training_field'];
    const startHexes = new Set(Object.values(map.startZones).flat());
    expect(new Set(s.glyphs.map(g => g.id)).size).toBe(s.glyphs.length); // distinct ids
    expect(new Set(s.glyphs.map(g => g.at)).size).toBe(s.glyphs.length); // distinct hexes
    for (const g of s.glyphs) {
      expect(g.faceUp).toBe(false);
      expect(HS_GLYPHS[g.id].active).toBe(true); // only implemented glyphs
      expect(g.id).not.toBe('brandar'); // scenario-only excluded
      expect(startHexes.has(g.at)).toBe(false); // neutral mid-board
      expect(map.cells[g.at].terrain).not.toBe('water');
    }
    expect(start(98765).glyphs).toEqual(s.glyphs); // deterministic per seed
    expect(start(11111).glyphs).not.toEqual(s.glyphs); // different seed → different layout
  });

  it('never places two glyphs on adjacent hexes (across many seeds)', () => {
    const layout = (seed: number): HSState => {
      let s = initialState();
      s = addPlayer(s, 'p1', 'A', 0, '#10b981');
      s = addPlayer(s, 'p2', 'B', 1, '#ef4444');
      return unwrap(applyAction(s, 'p1', { kind: 'start_game', mode: 'quick', mapId: 'training_field', glyphSeed: seed }));
    };
    for (let seed = 1; seed <= 25; seed++) {
      const s = layout(seed);
      for (const a of s.glyphs) {
        for (const b of s.glyphs) {
          if (a.at === b.at) continue;
          expect(neighborKeys(a.at).includes(b.at)).toBe(false); // never adjacent
        }
      }
    }
  });
});

describe('combat: a tie favours the DEFENDER (shields ≥ skulls fully blocks)', () => {
  it('2 skulls vs 2 shields leaves a fresh Life-1 Viking alive — even with an Attack Spirit', () => {
    // Mirrors a user report ("why did the Viking die? he blocked the 2 shields"): a Krav Maga
    // with a Warrior's Attack Spirit (+1 die) rolls 2 skulls; the Tarn Viking rolls 2 shields.
    // Each shield cancels one skull, ties go to the defender → 0 wounds, the Viking survives.
    let s = customBattle(['krav_maga'], ['tarn_vikings'], 'p1');
    const KM = 's0-krav_maga-1';
    const TV = 's1-tarn_vikings-1';
    s = JSON.parse(JSON.stringify(s)) as HSState;
    s.cards.find(c => c.uid === 's0-krav_maga')!.attackMod = 1; // Warrior's Attack Spirit
    s = place(s, KM, at(3, 3));
    s = place(s, TV, at(3, 4)); // adjacent
    expect(attackDiceRequirements(s, KM, TV)!.attack).toBe(4); // Attack 3 + 1 Spirit = 4 dice
    const st = unwrap(applyAction(s, 'p1', {
      kind: 'attack', attackerId: KM, targetId: TV,
      attackRoll: F('kkbb'), defenseRoll: F('ssbb'), // 2 skulls vs 2 shields
    }));
    expect(st.lastAttack?.skulls).toBe(2);
    expect(st.lastAttack?.shields).toBe(2);
    expect(st.lastAttack?.wounds).toBe(0); // a tie is a full block
    expect(st.lastAttack?.destroyed).toBe(false);
    expect(fig(st, TV).at).not.toBeNull(); // survives
  });
});
