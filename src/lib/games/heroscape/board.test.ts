import { describe, it, expect } from 'vitest';
import {
  hexKey,
  parseHexKey,
  offsetToAxial,
  axialToOffset,
  neighborKeys,
  hexDistance,
  rangeDistance,
  reachableDestinations,
  stepCost,
  canStepUp,
  areEngaged,
  computeFall,
  hasLineOfSight,
  hasLineOfSight3D,
  type Occupancy,
} from './board';
import { parseMap, TRAINING_FIELD, THE_KNOLL } from './maps';
import type { HexKey, HexCell } from './types';

/** offset (col,row) → axial key, for readable test coordinates. */
const at = (col: number, row: number): HexKey => {
  const { q, r } = offsetToAxial(col, row);
  return hexKey(q, r);
};

describe('axial / odd-r conversions', () => {
  it('round-trips offset ↔ axial', () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 7; col++) {
        const { q, r } = offsetToAxial(col, row);
        expect(axialToOffset(hexKey(q, r))).toEqual({ col, row });
      }
    }
  });

  it('odd rows shift right: row 1 col 0 sits south-east of row 0 col 0', () => {
    // odd-r: (0,0) and (0,1) are neighbors, and so are (0,1) and (1,0).
    expect(neighborKeys(at(0, 0))).toContain(at(0, 1));
    expect(neighborKeys(at(0, 1))).toContain(at(1, 0));
    // Even-row step straight down is NOT adjacent (two rows apart).
    expect(neighborKeys(at(0, 0))).not.toContain(at(0, 2));
  });

  it('parseHexKey inverts hexKey including negatives', () => {
    expect(parseHexKey(hexKey(-2, 7))).toEqual({ q: -2, r: 7 });
  });

  it('every hex has 6 distinct neighbors at distance 1', () => {
    const n = neighborKeys(at(3, 3));
    expect(new Set(n).size).toBe(6);
    for (const k of n) expect(hexDistance(at(3, 3), k)).toBe(1);
  });
});

describe('hexDistance', () => {
  it('matches hand-computed distances', () => {
    expect(hexDistance(at(0, 0), at(0, 0))).toBe(0);
    expect(hexDistance(at(0, 0), at(6, 0))).toBe(6); // straight along a row
    expect(hexDistance(at(3, 0), at(3, 5))).toBe(5); // zig-zag straight "down"
    expect(hexDistance(at(0, 0), at(6, 7))).toBe(10);
  });
});

describe('rangeDistance (spaces counted around gaps)', () => {
  it('equals hexDistance on the gap-free Training Field', () => {
    const cells = TRAINING_FIELD.cells;
    const pairs: [HexKey, HexKey][] = [
      [at(0, 0), at(6, 0)],
      [at(3, 0), at(3, 6)],
      [at(0, 0), at(6, 7)],
      [at(2, 3), at(5, 5)],
    ];
    for (const [a, b] of pairs) {
      expect(rangeDistance(cells, a, b)).toBe(hexDistance(a, b));
    }
  });

  it('routes AROUND voids instead of counting across them', () => {
    // A 3-wide map whose middle row is void except the right column: the only
    // path from top-left to bottom-left detours through the right side.
    const m = parseMap(
      'void_test',
      'Void Test',
      `
      row1: G1 G1 G1
      row2: .  .  G1
      row3: G1 G1 G1
      `,
    );
    const from = at(0, 0);
    const to = at(0, 2);
    expect(hexDistance(from, to)).toBe(2); // as the crow flies
    expect(rangeDistance(m.cells, from, to)).toBe(6); // around the gap
    // Voids are absent cells, not blockers with height.
    expect(m.cells[at(0, 1)]).toBeUndefined();
  });

  it('returns null when no path of spaces exists', () => {
    const m = parseMap(
      'split_test',
      'Split Test',
      `
      row1: G1 .  G1
      `,
    );
    expect(rangeDistance(m.cells, at(0, 0), at(2, 0))).toBeNull();
  });
});

describe('reachableDestinations (flat movement)', () => {
  const cells = TRAINING_FIELD.cells;
  const empty: (k: HexKey) => Occupancy = () => null;

  it('respects the move budget (1 per hex, inclusive)', () => {
    const dests = reachableDestinations(cells, at(3, 3), 2, empty);
    expect(dests.has(at(3, 3))).toBe(false); // staying put is not a move
    for (const k of dests) expect(hexDistance(at(3, 3), k)).toBeLessThanOrEqual(2);
    expect(dests.has(at(1, 3))).toBe(true); // distance 2
    expect(dests.has(at(0, 3))).toBe(false); // distance 3
  });

  it('move 0 reaches nothing', () => {
    expect(reachableDestinations(cells, at(3, 3), 0, empty).size).toBe(0);
  });

  it('never ends on an occupied hex, friendly or enemy', () => {
    const occ: (k: HexKey) => Occupancy = k =>
      k === at(3, 2) ? 'friendly' : k === at(3, 4) ? 'enemy' : null;
    const dests = reachableDestinations(cells, at(3, 3), 3, occ);
    expect(dests.has(at(3, 2))).toBe(false);
    expect(dests.has(at(3, 4))).toBe(false);
  });

  it('passes through friendly figures but never through enemies', () => {
    // Wall off row 1 of a 1-hex-wide corridor map: a 3-row single column.
    const m = parseMap(
      'corridor',
      'Corridor',
      `
      row1: G1
      row2: G1
      row3: G1
      `,
    );
    const start = at(0, 0);
    const beyond = at(0, 2);
    const gate = at(0, 1); // the only hex on the way
    const friendlyGate: (k: HexKey) => Occupancy = k => (k === gate ? 'friendly' : null);
    const enemyGate: (k: HexKey) => Occupancy = k => (k === gate ? 'enemy' : null);
    // Through a friendly: can reach the far side (but not stop on the friend).
    const viaFriend = reachableDestinations(m.cells, start, 3, friendlyGate);
    expect(viaFriend.has(beyond)).toBe(true);
    expect(viaFriend.has(gate)).toBe(false);
    // Through an enemy: completely blocked.
    const viaEnemy = reachableDestinations(m.cells, start, 3, enemyGate);
    expect(viaEnemy.has(beyond)).toBe(false);
    expect(viaEnemy.has(gate)).toBe(false);
  });

  it('passing through a friendly still costs movement', () => {
    const m = parseMap(
      'corridor2',
      'Corridor 2',
      `
      row1: G1
      row2: G1
      row3: G1
      `,
    );
    const friendlyGate: (k: HexKey) => Occupancy = k => (k === at(0, 1) ? 'friendly' : null);
    // Move 1 cannot reach past the friend (the far hex is 2 away).
    expect(reachableDestinations(m.cells, at(0, 0), 1, friendlyGate).has(at(0, 2))).toBe(false);
    expect(reachableDestinations(m.cells, at(0, 0), 2, friendlyGate).has(at(0, 2))).toBe(true);
  });
});

describe('line of sight (center-to-center, interior crossings block)', () => {
  it('a figure squarely on the line blocks', () => {
    // Three collinear hex centers along axial row r=3.
    const attacker = at(1, 3);
    const blocker = at(2, 3);
    const target = at(3, 3);
    expect(hasLineOfSight(attacker, target, [blocker])).toBe(false);
  });

  it('a figure off the line does not block', () => {
    const attacker = at(1, 3);
    const target = at(3, 3);
    const offLine = at(2, 2); // adjacent to the line but its hex is not crossed
    expect(hasLineOfSight(attacker, target, [offLine])).toBe(true);
  });

  it('grazing a corner / sliding along a shared edge does NOT block', () => {
    // The classic degenerate "diagonal": between axial (0,3) and (1,4) the
    // sight line passes through two shared corners and slides exactly along
    // the shared edge of the two intermediate hexes — it never enters either
    // interior, so NEITHER blocks even when both are occupied.
    const attacker = hexKey(0, 3);
    const target = hexKey(1, 4);
    expect(hexDistance(attacker, target)).toBe(2);
    const between1 = hexKey(1, 3);
    const between2 = hexKey(0, 4);
    expect(hasLineOfSight(attacker, target, [between1, between2])).toBe(true);
  });

  it('the attacker and target hexes never block', () => {
    const attacker = at(1, 3);
    const target = at(3, 3);
    expect(hasLineOfSight(attacker, target, [attacker, target])).toBe(true);
  });

  it('long shots across the Training Field see past out-of-lane figures', () => {
    // Diagonal shot corner to corner with clutter parked far off the line.
    expect(hasLineOfSight(at(0, 0), at(6, 7), [at(0, 7), at(6, 0)])).toBe(true);
  });
});

// ===========================================================================
// Slice 3 — terrain depth
// ===========================================================================

describe('stepCost / canStepUp (movement cost model)', () => {
  it('level and descent steps cost 1; climbs cost 1 + levels risen', () => {
    expect(stepCost(1, 1)).toBe(1); // flat
    expect(stepCost(4, 1)).toBe(1); // free descent, any depth
    expect(stepCost(1, 2)).toBe(2); // up 1 level
    expect(stepCost(1, 3)).toBe(3); // up 2 levels
    expect(stepCost(2, 4)).toBe(3); // up 2 levels from a height-2 base
  });

  it('climb limit: cannot rise ≥ Height in one step; up to Height−1 is legal', () => {
    // Height 4 → may climb 3 levels, never 4+.
    expect(canStepUp(1, 4, 4)).toBe(true); // rise 3 < 4
    expect(canStepUp(1, 5, 4)).toBe(false); // rise 4 == Height
    expect(canStepUp(1, 6, 4)).toBe(false); // rise 5 > Height
    // Descending / level steps are never limited.
    expect(canStepUp(5, 1, 1)).toBe(true);
    expect(canStepUp(2, 2, 1)).toBe(true);
  });
});

describe('reachableDestinations with elevation (The Knoll)', () => {
  const cells = THE_KNOLL.cells;
  const empty: (k: HexKey) => Occupancy = () => null;

  it('climbing costs 1 + levels risen — budget gates how far up the hill you go', () => {
    // Knoll row 4 (r=3) runs G1 G2 R3 R4 … west→east; (col,row) and (col+1,row)
    // are always east-neighbours, so this is a straight adjacent climb chain.
    const from = at(0, 3); // grass height 1
    expect(cells[from]).toMatchObject({ height: 1 });
    expect(cells[at(1, 3)]).toMatchObject({ height: 2 }); // G2, step cost 2
    expect(cells[at(2, 3)]).toMatchObject({ height: 3 }); // R3, +2 → total 4
    expect(cells[at(3, 3)]).toMatchObject({ height: 4 }); // R4, +2 → total 6
    // Move 2: reaches the G2 (cost 2), not the R3 behind it (cost 4).
    const m2 = reachableDestinations(cells, from, 2, empty, 5);
    expect(m2.has(at(1, 3))).toBe(true);
    expect(m2.has(at(2, 3))).toBe(false);
    // Move 4: just crests onto the R3 (cost 4); the R4 summit (cost 6) is still
    // out of reach.
    const m4 = reachableDestinations(cells, from, 4, empty, 5);
    expect(m4.has(at(2, 3))).toBe(true);
    expect(m4.has(at(3, 3))).toBe(false);
  });

  it('descent is free: dropping off the summit costs only the landing space', () => {
    // From an R4 summit hex (3,3), the adjacent R3 (2,3 is off-summit) costs 1.
    const summit = at(3, 3);
    expect(cells[summit]).toMatchObject({ height: 4 });
    // A Move-1 figure on the summit can still step down to an adjacent R3.
    const r3Neighbor = neighborKeys(summit).find(
      k => cells[k] && cells[k].height === 3,
    )!;
    const m1 = reachableDestinations(cells, summit, 1, empty, 5);
    expect(m1.has(r3Neighbor)).toBe(true);
  });

  it('a Height-4 figure cannot crest a 4-level wall in one step', () => {
    // Build a 2-hex map: G1 next to R5 (rise 4). A Height-4 figure may not
    // climb it even with a huge Move budget; a Height-5 figure can.
    const wall = parseMap('wall', 'Wall', `row1: G1 R5`);
    const lo = at(0, 0);
    expect(reachableDestinations(wall.cells, lo, 9, () => null, 4).has(at(1, 0))).toBe(false);
    expect(reachableDestinations(wall.cells, lo, 9, () => null, 5).has(at(1, 0))).toBe(true);
  });
});

describe('reachableDestinations with water (forced stop)', () => {
  it('entering water ends the move there, but through-water-to-land is allowed', () => {
    // Land, water, land in a row. From the left land hex:
    const m = parseMap('cross', 'Cross', `row1: G1 W1 G1 W1 W1`);
    const start = at(0, 0);
    const water1 = at(1, 0);
    const landBeyond = at(2, 0);
    const water2 = at(3, 0);
    const water3 = at(4, 0);
    const dests = reachableDestinations(m.cells, start, 5, () => null, 5);
    // Water is a valid ENDPOINT (forced stop).
    expect(dests.has(water1)).toBe(true);
    // You may pass THROUGH the single water to the land beyond (cost 2).
    expect(dests.has(landBeyond)).toBe(true);
    // But you cannot chain water→water: the far waters are only reachable as
    // forced-stop endpoints adjacent to land, never transited past.
    expect(dests.has(water2)).toBe(true); // adjacent to landBeyond — endpoint
    expect(dests.has(water3)).toBe(false); // would require water2→water3 transit
  });

  it('a Move-1 figure that steps into water simply stops there', () => {
    const m = parseMap('lake', 'Lake', `row1: G1 W1 W1`);
    const dests = reachableDestinations(m.cells, at(0, 0), 1, () => null, 5);
    expect(dests.has(at(1, 0))).toBe(true); // entered water, stopped
    expect(dests.has(at(2, 0))).toBe(false); // can't reach the second water
  });

  it('climbing OUT of water onto a higher bank pays the climb cost', () => {
    // water(1) → bank(3): rise 2 → cost 3. Move 2 can't, Move 3 can.
    const m = parseMap('bank', 'Bank', `row1: W1 G3`);
    expect(reachableDestinations(m.cells, at(0, 0), 2, () => null, 5).has(at(1, 0))).toBe(false);
    expect(reachableDestinations(m.cells, at(0, 0), 3, () => null, 5).has(at(1, 0))).toBe(true);
  });
});

describe('reachableDestinations with glyphs (forced stop) — slice 4', () => {
  it('a glyph hex is a valid endpoint but never a pass-through node', () => {
    // A straight 1-wide corridor with a glyph on the middle hex.
    const m = parseMap('glyph_corr', 'Glyph Corridor', `
      row1: G1
      row2: G1
      row3: G1
      row4: G1
    `);
    const start = at(0, 0);
    const glyph = at(0, 1);
    const beyond = at(0, 2);
    const opts = { glyphHexes: new Set([glyph]) };
    const dests = reachableDestinations(m.cells, start, 5, () => null, 5, opts);
    expect(dests.has(glyph)).toBe(true); // valid stop
    expect(dests.has(beyond)).toBe(false); // cannot transit the glyph
    // Without the glyph option, the corridor is fully reachable.
    const free = reachableDestinations(m.cells, start, 5, () => null, 5);
    expect(free.has(beyond)).toBe(true);
  });

  it('a figure STARTING on a glyph is not stopped by its own hex', () => {
    const m = parseMap('glyph_start', 'Glyph Start', `row1: G1 G1 G1`);
    const start = at(0, 0);
    const opts = { glyphHexes: new Set([start]) };
    // Standing on a glyph, the figure may still move off it normally.
    const dests = reachableDestinations(m.cells, start, 2, () => null, 5, opts);
    expect(dests.has(at(2, 0))).toBe(true);
  });

  it('canEndOn vetoes an otherwise-legal endpoint (Kelda wounded-only)', () => {
    const m = parseMap('kelda_corr', 'Kelda Corridor', `row1: G1 G1`);
    const start = at(0, 0);
    const kelda = at(1, 0);
    // The figure is unwounded → canEndOn returns false for Kelda's hex.
    const dests = reachableDestinations(m.cells, start, 3, () => null, 5, {
      glyphHexes: new Set([kelda]),
      canEndOn: () => false,
    });
    expect(dests.has(kelda)).toBe(false);
  });
});

describe('reachableDestinations regression (flat map, no extra args)', () => {
  it('matches the old 1/hex BFS on the all-height-1 Training Field', () => {
    const cells = TRAINING_FIELD.cells;
    const dests = reachableDestinations(cells, at(3, 3), 2, () => null);
    expect(dests.has(at(1, 3))).toBe(true); // distance 2
    expect(dests.has(at(0, 3))).toBe(false); // distance 3
    expect(dests.has(at(3, 3))).toBe(false); // staying put isn't a move
    for (const k of dests) expect(hexDistance(at(3, 3), k)).toBeLessThanOrEqual(2);
  });
});

describe('areEngaged (Example 14 elevation boundary)', () => {
  // A sits on a ledge at (1,0) whose height varies; B on the ground at (0,0).
  const ledgeAt = (ledge: number) => (k: HexKey) => (k === at(1, 0) ? ledge : 1);

  it('adjacent figures on level ground are engaged', () => {
    expect(areEngaged(at(0, 0), 5, at(1, 0), 5, () => 1)).toBe(true);
  });

  it('Example 14: a height gap == the lower figure Height breaks adjacency', () => {
    // The lower figure is B on the ground (height 1, Height 5). A's ledge sets
    // the gap. The exception triggers at gap ≥ lower Height (5).
    expect(areEngaged(at(0, 0), 5, at(1, 0), 5, ledgeAt(6))).toBe(false); // gap 5 ≥ 5
    expect(areEngaged(at(0, 0), 5, at(1, 0), 5, ledgeAt(5))).toBe(true); // gap 4 < 5
  });

  it('the LOWER figure Height gates the exception, regardless of argument order', () => {
    // A high on a height-4 ledge (Height 3); B low on the ground (Height 7).
    // B is lower → its Height 7 gates: gap 3 < 7 → engaged. The high figure's
    // own small Height does NOT shrink the engagement window.
    expect(areEngaged(at(1, 0), 3, at(0, 0), 7, ledgeAt(4))).toBe(true);
    // Swap who is short: A high (Height 7) on the ledge, B low (Height 3) on
    // the ground. B lower → Height 3 gates: gap 3 ≥ 3 → not engaged.
    expect(areEngaged(at(1, 0), 7, at(0, 0), 3, ledgeAt(4))).toBe(false);
  });

  it('non-adjacent hexes are never engaged', () => {
    expect(areEngaged(at(0, 0), 5, at(2, 0), 5, () => 1)).toBe(false);
    expect(areEngaged(at(0, 0), 5, at(0, 0), 5, () => 1)).toBe(false); // same hex
  });
});

describe('computeFall (banded thresholds)', () => {
  it('no fall when the drop is below Height', () => {
    expect(computeFall(2, 4, false)).toEqual({ tier: 'none', dice: 0 }); // drop 2 < H4
  });

  it('Fall at drop ≥ Height → 1 die (equality counts)', () => {
    expect(computeFall(4, 4, false)).toEqual({ tier: 'fall', dice: 1 }); // equal
    expect(computeFall(5, 4, false)).toEqual({ tier: 'fall', dice: 1 }); // Ex. 8
  });

  it('Major Fall when drop − Height ≥ 10 → 3 dice', () => {
    expect(computeFall(14, 4, false)).toEqual({ tier: 'major', dice: 3 }); // over 10
    expect(computeFall(13, 4, false)).toEqual({ tier: 'fall', dice: 1 }); // over 9 — still plain
  });

  it('Extreme Fall when drop − Height ≥ 20 → d20 survival (0 combat dice)', () => {
    expect(computeFall(24, 4, false)).toEqual({ tier: 'extreme', dice: 0 }); // over 20
    expect(computeFall(23, 4, false)).toEqual({ tier: 'major', dice: 3 }); // over 19
  });

  it('water exempts the fall from any height', () => {
    expect(computeFall(25, 4, true)).toEqual({ tier: 'none', dice: 0 });
  });
});

describe('hasLineOfSight3D (elevation)', () => {
  // Three collinear hexes along axial row r=3: A=(0,3) mid=(1,3) B=(2,3) in
  // axial. Use offset coords for clarity via `at`.
  const A = at(1, 3); // axial (0,3)
  const MID = at(2, 3); // axial (1,3)
  const B = at(3, 3); // axial (2,3)
  const eye1: (k: HexKey) => number = () => 2; // all figures at cell height 1 → eye 2

  function cellsWith(midHeight: number): Record<HexKey, HexCell> {
    const mk = (k: HexKey, h: number): HexCell => {
      const { q, r } = parseHexKey(k);
      return { q, r, height: h, terrain: 'grass' };
    };
    return { [A]: mk(A, 1), [MID]: mk(MID, midHeight), [B]: mk(B, 1) };
  }

  it('a tall rock column between two low figures blocks', () => {
    // Both figures on height-1 cells (eye 2); a height-3 column between blocks.
    const cells = cellsWith(3);
    expect(hasLineOfSight3D(cells, A, B, [], eye1)).toBe(false);
  });

  it('a low hill no taller than the viewers does not block', () => {
    // Column height 2 == eye height of both → does NOT block (see over/along).
    const cells = cellsWith(2);
    expect(hasLineOfSight3D(cells, A, B, [], eye1)).toBe(true);
  });

  it('equal high columns see each other over a low gap', () => {
    // Both endpoints on height-3 columns (eye 4); a height-2 dip between is
    // well below the line → clear.
    const { q: qa, r: ra } = parseHexKey(A);
    const { q: qb, r: rb } = parseHexKey(B);
    const { q: qm, r: rm } = parseHexKey(MID);
    const cells: Record<HexKey, HexCell> = {
      [A]: { q: qa, r: ra, height: 3, terrain: 'rock' },
      [MID]: { q: qm, r: rm, height: 2, terrain: 'grass' },
      [B]: { q: qb, r: rb, height: 3, terrain: 'rock' },
    };
    const eyeOf = (k: HexKey) => cells[k].height + 1;
    expect(hasLineOfSight3D(cells, A, B, [], eyeOf)).toBe(true);
  });

  it('pit asymmetry: a hill figure sees a pit figure it could not see in reverse', () => {
    // A stands high (height 5, eye 6); B sits in a pit (height 1, eye 2). A
    // rim hex (height 3) sits between. From A's high eye the line slopes down
    // and the rim is below it → clear. (We only assert the high→low direction;
    // the reverse may legitimately differ — directions are independent.)
    const { q: qa, r: ra } = parseHexKey(A);
    const { q: qb, r: rb } = parseHexKey(B);
    const { q: qm, r: rm } = parseHexKey(MID);
    const cells: Record<HexKey, HexCell> = {
      [A]: { q: qa, r: ra, height: 5, terrain: 'rock' },
      [MID]: { q: qm, r: rm, height: 3, terrain: 'rock' },
      [B]: { q: qb, r: rb, height: 1, terrain: 'grass' },
    };
    const eyeOf = (k: HexKey) => cells[k].height + 1;
    expect(hasLineOfSight3D(cells, A, B, [], eyeOf)).toBe(true);
  });

  it('intervening figures still block regardless of terrain', () => {
    const cells = cellsWith(1); // flat terrain
    expect(hasLineOfSight3D(cells, A, B, [MID], eye1)).toBe(false);
  });
});
