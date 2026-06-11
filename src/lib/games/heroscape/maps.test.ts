import { describe, it, expect } from 'vitest';
import { parseMap, TRAINING_FIELD, MAPS } from './maps';
import { hexKey, offsetToAxial, neighborKeys } from './board';

const at = (col: number, row: number) => {
  const { q, r } = offsetToAxial(col, row);
  return hexKey(q, r);
};

describe('TEST-1 "Training Field"', () => {
  it('is registered under its id', () => {
    expect(MAPS['training_field']).toBe(TRAINING_FIELD);
  });

  it('has exactly 7×8 = 56 hexes, all grass at height 1', () => {
    const cells = Object.values(TRAINING_FIELD.cells);
    expect(cells).toHaveLength(56);
    expect(TRAINING_FIELD.cols).toBe(7);
    expect(TRAINING_FIELD.rows).toBe(8);
    for (const c of cells) {
      expect(c.terrain).toBe('grass');
      expect(c.height).toBe(1);
    }
  });

  it('start zones: full-width row 1 for player 1 and row 8 for player 2', () => {
    const zone0 = TRAINING_FIELD.startZones[0];
    const zone1 = TRAINING_FIELD.startZones[1];
    expect(zone0).toHaveLength(7);
    expect(zone1).toHaveLength(7);
    for (let col = 0; col < 7; col++) {
      expect(zone0[col]).toBe(at(col, 0));
      expect(zone1[col]).toBe(at(col, 7));
    }
  });

  it('has no glyph spots and no voids', () => {
    expect(TRAINING_FIELD.glyphSpots).toHaveLength(0);
    // Every (col,row) position exists — no '.' tokens in TEST-1.
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 7; col++) {
        expect(TRAINING_FIELD.cells[at(col, row)]).toBeDefined();
      }
    }
  });

  it('every interior hex connects to its in-bounds neighbors (odd-r parsed correctly)', () => {
    // (3,3) is interior: all 6 neighbors must exist on the map.
    const present = neighborKeys(at(3, 3)).filter(k => TRAINING_FIELD.cells[k]);
    expect(present).toHaveLength(6);
    // A corner has fewer.
    const cornerNeighbors = neighborKeys(at(0, 0)).filter(k => TRAINING_FIELD.cells[k]);
    expect(cornerNeighbors).toHaveLength(2);
  });
});

describe('parseMap notation', () => {
  it('parses terrain letters, heights, voids, glyph spots, and start zones', () => {
    const m = parseMap(
      'kitchen_sink',
      'Kitchen Sink',
      `
      row1@1: G1 R3 S2
      row2:   W1 .  G2*
      row3@2: G1 G1 G1
      `,
    );
    expect(Object.keys(m.cells)).toHaveLength(8); // 9 positions minus 1 void
    expect(m.cells[at(0, 0)]).toMatchObject({ terrain: 'grass', height: 1 });
    expect(m.cells[at(1, 0)]).toMatchObject({ terrain: 'rock', height: 3 });
    expect(m.cells[at(2, 0)]).toMatchObject({ terrain: 'sand', height: 2 });
    expect(m.cells[at(0, 1)]).toMatchObject({ terrain: 'water', height: 1 });
    // The void is ABSENT from the record — not height-0 terrain.
    expect(m.cells[at(1, 1)]).toBeUndefined();
    // Glyph spot recorded.
    expect(m.glyphSpots).toEqual([at(2, 1)]);
    // Start zones keyed 0-based from @1/@2.
    expect(m.startZones[0]).toHaveLength(3);
    expect(m.startZones[1]).toHaveLength(3);
  });

  it('throws on malformed tokens and lines', () => {
    expect(() => parseMap('bad1', 'Bad', 'row1: X9')).toThrow(/bad token/);
    expect(() => parseMap('bad2', 'Bad', 'line1: G1')).toThrow(/unparseable/);
    expect(() => parseMap('bad3', 'Bad', 'row1: G')).toThrow(/bad token/);
  });
});
