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
  hasLineOfSight,
  type Occupancy,
} from './board';
import { parseMap, TRAINING_FIELD } from './maps';
import type { HexKey } from './types';

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
