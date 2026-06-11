import { describe, it, expect } from 'vitest';
import { parseMap, TRAINING_FIELD, THE_KNOLL, FORD_CROSSING, MAPS } from './maps';
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

describe('TEST-2 "The Knoll" (elevation)', () => {
  it('is registered under its id', () => {
    expect(MAPS['the_knoll']).toBe(THE_KNOLL);
  });

  it('has 9×8 = 72 hexes (no voids), rising 1→2→3→4 to the rock summit', () => {
    const cells = Object.values(THE_KNOLL.cells);
    expect(cells).toHaveLength(72);
    expect(THE_KNOLL.cols).toBe(9);
    expect(THE_KNOLL.rows).toBe(8);
    expect(Math.max(...cells.map(c => c.height))).toBe(4);
    // Heights present: every level 1..4 appears.
    expect([...new Set(cells.map(c => c.height))].sort()).toEqual([1, 2, 3, 4]);
    // The four summit hexes (rows 4-5, cols 3-5) are rock at height 4.
    for (const [col, row] of [[3, 3], [4, 3], [5, 3], [3, 4], [4, 4], [5, 4]]) {
      expect(THE_KNOLL.cells[at(col, row)]).toMatchObject({ terrain: 'rock', height: 4 });
    }
    // Grass skirt is height 1, never rock.
    expect(THE_KNOLL.cells[at(0, 0)]).toMatchObject({ terrain: 'grass', height: 1 });
    // The R4 summit center matches the documented (row4, col5) glyph-spot
    // location for slice 4 — but no `*` was authored in test-maps.md's grid.
    expect(THE_KNOLL.glyphSpots).toHaveLength(0);
  });

  it('full-width start zones on rows 1 and 8', () => {
    expect(THE_KNOLL.startZones[0]).toHaveLength(9);
    expect(THE_KNOLL.startZones[1]).toHaveLength(9);
    for (let col = 0; col < 9; col++) {
      expect(THE_KNOLL.startZones[0][col]).toBe(at(col, 0));
      expect(THE_KNOLL.startZones[1][col]).toBe(at(col, 7));
    }
  });
});

describe('TEST-3 "Ford Crossing" (water + voids)', () => {
  it('is registered under its id', () => {
    expect(MAPS['ford_crossing']).toBe(FORD_CROSSING);
  });

  it('has 10×7 − 2 voids = 68 hexes: 41 grass, 25 water, 2 sand', () => {
    const cells = Object.values(FORD_CROSSING.cells);
    expect(cells).toHaveLength(68);
    expect(FORD_CROSSING.cols).toBe(10);
    expect(FORD_CROSSING.rows).toBe(7);
    const byTerrain: Record<string, number> = {};
    for (const c of cells) byTerrain[c.terrain] = (byTerrain[c.terrain] ?? 0) + 1;
    expect(byTerrain).toEqual({ grass: 41, water: 25, sand: 2 });
    // Heights are only 1 and 2 (G2 banks); water surfaces are all height 1.
    expect([...new Set(cells.map(c => c.height))].sort()).toEqual([1, 2]);
    expect(cells.filter(c => c.terrain === 'water').every(c => c.height === 1)).toBe(true);
  });

  it('the two voids are ABSENT from the record (not height-0 terrain)', () => {
    expect(FORD_CROSSING.cells[at(7, 1)]).toBeUndefined();
    expect(FORD_CROSSING.cells[at(7, 5)]).toBeUndefined();
  });

  it('the ford column (col 4) is dry grass straight across the river', () => {
    for (let row = 0; row < 7; row++) {
      expect(FORD_CROSSING.cells[at(4, row)]).toMatchObject({ terrain: 'grass' });
    }
    // The sand spit flanks the ford at row 4.
    expect(FORD_CROSSING.cells[at(3, 3)]).toMatchObject({ terrain: 'sand', height: 1 });
    expect(FORD_CROSSING.cells[at(5, 3)]).toMatchObject({ terrain: 'sand', height: 1 });
  });

  it('full-width start zones on rows 1 and 7', () => {
    expect(FORD_CROSSING.startZones[0]).toHaveLength(10);
    expect(FORD_CROSSING.startZones[1]).toHaveLength(10);
  });
});

describe('slice 4: per-map glyph layouts', () => {
  it('Training Field seeds Astrid + Gerda on mid-row grass (not in a start zone)', () => {
    const ids = TRAINING_FIELD.glyphs.map(g => g.id).sort();
    expect(ids).toEqual(['astrid', 'gerda']);
    for (const g of TRAINING_FIELD.glyphs) {
      expect(TRAINING_FIELD.cells[g.at]).toBeDefined(); // on a real cell
      expect(TRAINING_FIELD.startZones[0]).not.toContain(g.at);
      expect(TRAINING_FIELD.startZones[1]).not.toContain(g.at);
    }
    expect(TRAINING_FIELD.glyphs.find(g => g.id === 'astrid')!.at).toBe(at(2, 3));
    expect(TRAINING_FIELD.glyphs.find(g => g.id === 'gerda')!.at).toBe(at(4, 3));
  });

  it('The Knoll seeds Astrid on the R4 summit and Valda on low grass', () => {
    const astrid = THE_KNOLL.glyphs.find(g => g.id === 'astrid')!;
    const valda = THE_KNOLL.glyphs.find(g => g.id === 'valda')!;
    expect(THE_KNOLL.cells[astrid.at]).toMatchObject({ terrain: 'rock', height: 4 });
    expect(THE_KNOLL.cells[valda.at]).toMatchObject({ height: 1 });
  });

  it('Ford Crossing seeds Kelda on a bank and Ivor on the ford', () => {
    const ids = FORD_CROSSING.glyphs.map(g => g.id).sort();
    expect(ids).toEqual(['ivor', 'kelda']);
    const ivor = FORD_CROSSING.glyphs.find(g => g.id === 'ivor')!;
    expect(FORD_CROSSING.cells[ivor.at]).toMatchObject({ terrain: 'grass' });
  });

  it('parseMap validates a glyph lands on a real cell', () => {
    expect(() =>
      parseMap('g_ok', 'G OK', 'row1: G1 G1', [{ id: 'astrid', col: 0, row: 0 }]),
    ).not.toThrow();
    expect(() =>
      parseMap('g_bad', 'G Bad', 'row1: G1 G1', [{ id: 'astrid', col: 5, row: 5 }]),
    ).toThrow(/off-map/);
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
