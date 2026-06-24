import { describe, it, expect } from 'vitest';
import { parseMap, TRAINING_FIELD, THE_KNOLL, FORD_CROSSING, STAR_FIELD, TRISKELION, CROSSROADS, MAPS } from './maps';
import type { HSMap } from './maps';
import { mapSupportsCount } from './engine';
import { hexKey, offsetToAxial, axialToOffset, neighborKeys } from './board';
import type { HexKey } from './types';

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

  it('start zones: TWO full-width rows each (rows 1-2 for P1, rows 7-8 for P2)', () => {
    const zone0 = TRAINING_FIELD.startZones[0];
    const zone1 = TRAINING_FIELD.startZones[1];
    expect(zone0).toHaveLength(14); // rows 1-2 × 7 cols
    expect(zone1).toHaveLength(14); // rows 7-8 × 7 cols
    // Parser pushes row-by-row: first 7 are row 1, next 7 are row 2.
    for (let col = 0; col < 7; col++) {
      expect(zone0[col]).toBe(at(col, 0));
      expect(zone0[col + 7]).toBe(at(col, 1));
      expect(zone1[col]).toBe(at(col, 6));
      expect(zone1[col + 7]).toBe(at(col, 7));
    }
    // The zones cover rows {0,1} and {6,7}; rows 2-5 are neutral.
    const rowsOf = (z: string[]) => new Set(z.map(k => axialToOffset(k).row));
    expect([...rowsOf(zone0)].sort()).toEqual([0, 1]);
    expect([...rowsOf(zone1)].sort()).toEqual([6, 7]);
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

  it('two-row start zones (rows 1-2 for P1, rows 7-8 for P2)', () => {
    expect(THE_KNOLL.startZones[0]).toHaveLength(18); // rows 1-2 × 9 cols
    expect(THE_KNOLL.startZones[1]).toHaveLength(18); // rows 7-8 × 9 cols
    for (let col = 0; col < 9; col++) {
      expect(THE_KNOLL.startZones[0][col]).toBe(at(col, 0));
      expect(THE_KNOLL.startZones[0][col + 9]).toBe(at(col, 1));
      expect(THE_KNOLL.startZones[1][col]).toBe(at(col, 6));
      expect(THE_KNOLL.startZones[1][col + 9]).toBe(at(col, 7));
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

  it('two-row start zones (rows 1-2 for P1, rows 6-7 for P2; voids excluded)', () => {
    // Row 2 (index 1) and row 6 (index 5) each have a void at col 7, so each
    // two-row zone is 10 + 9 = 19 hexes (the void is not a start-zone hex).
    expect(FORD_CROSSING.startZones[0]).toHaveLength(19);
    expect(FORD_CROSSING.startZones[1]).toHaveLength(19);
    const rowsOf = (z: string[]) => [...new Set(z.map(k => axialToOffset(k).row))].sort();
    expect(rowsOf(FORD_CROSSING.startZones[0])).toEqual([0, 1]);
    expect(rowsOf(FORD_CROSSING.startZones[1])).toEqual([5, 6]);
    // The void at (8,2)/offset(7,1) is NOT in the zone.
    expect(FORD_CROSSING.startZones[0]).not.toContain(at(7, 1));
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

describe('Star Field — every player count 2-6', () => {
  it('defines start zones for all counts 2 through 6', () => {
    for (let n = 2; n <= 6; n++) {
      const zones = STAR_FIELD.zonesByCount![n];
      expect(zones, `count ${n}`).toBeDefined();
      expect(Object.keys(zones!)).toHaveLength(n); // one zone per seat
      for (let seat = 0; seat < n; seat++) expect(zones![seat].length).toBeGreaterThan(0);
    }
  });

  it('the 2-player zones are the opposite tips and disjoint', () => {
    const zones = STAR_FIELD.zonesByCount![2]!;
    const set0 = new Set(zones[0]);
    expect(zones[1].some(h => set0.has(h))).toBe(false); // no shared hex
  });
});

describe('Star Field — symmetric terrain (mound + walls + arm ridges)', () => {
  const rot60 = (q: number, r: number): [number, number] => [-r, q + r];

  it('terrain is 6-fold rotationally symmetric — every hex equals its 60° images', () => {
    for (const c of Object.values(STAR_FIELD.cells)) {
      let q = c.q, r = c.r;
      for (let i = 0; i < 6; i++) {
        [q, r] = rot60(q, r);
        const img = STAR_FIELD.cells[hexKey(q, r)];
        expect(img).toBeDefined();
        expect(img.height).toBe(c.height); // same height under every rotation
      }
    }
  });

  it('has height-15 walls and minor (2/3) elevation, with flat grass deploy tips', () => {
    const heights = new Set(Object.values(STAR_FIELD.cells).map(c => c.height));
    expect(heights.has(15)).toBe(true); // walls
    expect(heights.has(2)).toBe(true); // minor elevation
    expect(heights.has(3)).toBe(true);
    // there are exactly six walls of each rotated feature (6-fold)
    expect(Object.values(STAR_FIELD.cells).filter(c => c.height === 15).length % 6).toBe(0);
    // every start-zone tip hex stays flat grass (fair deployment)
    for (const zone of Object.values(STAR_FIELD.startZones)) {
      for (const k of zone) expect(STAR_FIELD.cells[k]).toMatchObject({ height: 1, terrain: 'grass' });
    }
  });
});

// ---------------------------------------------------------------------------
// Symmetric multiplayer battlefields (3 / 4 / 5 players)
// ---------------------------------------------------------------------------

const ax = (k: HexKey) => { const i = k.indexOf(','); return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) }; };
const cube = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
const hexD = (a: HexKey, b: HexKey) => { const x = ax(a), y = ax(b); return cube(x.q - y.q, x.r - y.r); };
const isWall = (m: HSMap, k: HexKey) => m.cells[k].terrain === 'rock' && m.cells[k].height >= 15;

/** Shared invariants every designed symmetric map must satisfy. */
function checkMapInvariants(m: HSMap, count: number) {
  const keys = Object.keys(m.cells) as HexKey[];
  // Registered + gated to EXACTLY its player count.
  expect(MAPS[m.id]).toBe(m);
  expect(mapSupportsCount(m, count)).toBe(true);
  expect(mapSupportsCount(m, count === 6 ? 5 : count + 1)).toBe(false);
  expect(mapSupportsCount(m, count - 1)).toBe(false);
  expect(Object.keys(m.zonesByCount ?? {})).toEqual([String(count)]);

  // EXACTLY `count` start zones, all the SAME size, flat grass, disjoint.
  const zones = Object.values(m.startZones);
  expect(zones).toHaveLength(count);
  const sizes = new Set(zones.map(z => z.length));
  expect(sizes.size).toBe(1); // every player gets an identical zone
  const seen = new Set<HexKey>();
  for (const z of zones) for (const k of z) {
    expect(m.cells[k]).toMatchObject({ height: 1, terrain: 'grass' }); // flat deploy
    expect(seen.has(k)).toBe(false); // disjoint
    seen.add(k);
  }

  // No two zones within Range 9 — a deploy can't be sniped on turn one.
  let minInter = Infinity;
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++)
    for (const a of zones[i]) for (const b of zones[j]) minInter = Math.min(minInter, hexD(a, b));
  expect(minInter).toBeGreaterThanOrEqual(10);

  // Walls exist, but the board is fully CONNECTED over non-wall cells (no sealed path / stranded zone).
  const passable = new Set(keys.filter(k => !isWall(m, k)));
  expect([...passable].some(k => isWall(m, k))).toBe(false);
  expect(keys.some(k => isWall(m, k))).toBe(true); // there ARE walls
  const start = m.startZones[0][0];
  const seenBFS = new Set<HexKey>([start]); const q = [start];
  while (q.length) { const cur = q.shift()!; for (const n of neighborKeys(cur) as HexKey[]) if (passable.has(n) && !seenBFS.has(n)) { seenBFS.add(n); q.push(n); } }
  for (const k of passable) expect(seenBFS.has(k)).toBe(true); // every walkable hex reachable

  // Elevation present (more than one height besides the walls).
  const heights = new Set(keys.filter(k => !isWall(m, k)).map(k => m.cells[k].height));
  expect(heights.size).toBeGreaterThanOrEqual(2);

  // Glyph anchors: real, passable, off start zones, never adjacent (so a 2-hex figure can't cover two).
  const anchors = m.glyphAnchors ?? [];
  expect(anchors.length).toBeGreaterThanOrEqual(4);
  for (const k of anchors) {
    expect(m.cells[k]).toBeTruthy();
    expect(isWall(m, k)).toBe(false);
    expect(seen.has(k)).toBe(false); // not on a start zone
  }
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++)
    expect((neighborKeys(anchors[i]) as HexKey[]).includes(anchors[j])).toBe(false);

  // EVERY glyph anchor sits ≥5 hexes from EVERY start-zone cell (the user rule).
  for (const a of anchors) for (const z of seen) expect(hexD(a, z)).toBeGreaterThanOrEqual(5);
}

describe('Triskelion Vale (3-player, true 3-fold rotational symmetry)', () => {
  it('passes the shared symmetric-battlefield invariants', () => checkMapInvariants(TRISKELION, 3));
  it('terrain is EXACTLY invariant under 120° rotation (rot120)', () => {
    const rot120 = (q: number, r: number): [number, number] => { let a = q, b = r; for (let i = 0; i < 2; i++) { const na = -b, nb = a + b; a = na; b = nb; } return [a, b]; };
    for (const k of Object.keys(TRISKELION.cells) as HexKey[]) {
      const { q, r } = ax(k);
      const [rq, rr] = rot120(q, r);
      const rk = hexKey(rq, rr);
      expect(TRISKELION.cells[rk]).toBeTruthy(); // the rotated hex exists
      expect(TRISKELION.cells[rk].height).toBe(TRISKELION.cells[k].height);
      expect(TRISKELION.cells[rk].terrain).toBe(TRISKELION.cells[k].terrain);
    }
  });
});

describe('Crossroads Keep (4-player, EXACT hex D2 double-mirror symmetry)', () => {
  it('passes the shared symmetric-battlefield invariants', () => checkMapInvariants(CROSSROADS, 4));
  it('terrain is EXACTLY invariant under the D2 group (both hex reflections + rot180)', () => {
    // Exact hex reflections across the two centre axes, and their product rot180 — the order-4 group
    // whose orbit of an off-axis seed is the 4 corner zones. (NOT an odd-r offset mirror, which the
    // half-row shift makes only approximate — this is a true hex symmetry.)
    const D2: ((q: number, r: number) => [number, number])[] = [(q, r) => [q + r, -r], (q, r) => [-q - r, r], (q, r) => [-q, -r]];
    for (const k of Object.keys(CROSSROADS.cells) as HexKey[]) {
      const { q, r } = ax(k);
      for (const tf of D2) {
        const [a, b] = tf(q, r);
        const mk = hexKey(a, b);
        expect(CROSSROADS.cells[mk]).toBeTruthy();
        expect(CROSSROADS.cells[mk].height).toBe(CROSSROADS.cells[k].height);
        expect(CROSSROADS.cells[mk].terrain).toBe(CROSSROADS.cells[k].terrain);
      }
    }
  });
});

describe('Star Field (5 + 6 players) — glyph anchors clear the deploy tips', () => {
  it('every glyph anchor is ≥5 hexes from every start zone (all 6 tips)', () => {
    const anchors = STAR_FIELD.glyphAnchors ?? [];
    expect(anchors.length).toBeGreaterThanOrEqual(4);
    const zoneCells = Object.values(STAR_FIELD.startZones).flat();
    for (const a of anchors) {
      expect(isWall(STAR_FIELD, a)).toBe(false);
      for (const z of zoneCells) expect(hexD(a, z)).toBeGreaterThanOrEqual(5);
    }
  });
});
