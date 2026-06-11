// HeroScape — battlefield definitions (slice 1).
//
// Maps are authored in the docs/heroscape/test-maps.md token-grid notation:
// odd-r offset rows (odd rows shifted right half a hex); each token is
// `<terrain><height>`; `.` is a void (no hex — figures can't enter and Range
// must count around it); a `*` suffix marks a glyph spot; `@N` after the row
// label marks the entire row as player N's starting zone.
//
// Maps are parsed once at module load into static constants — they are
// CONTENT, not state (state stores only `mapId`), keeping the room JSONB lean.

import type { HexKey, HexCell, Terrain, HSGlyphId, HSGlyph } from './types';
import { hexKey, offsetToAxial } from './board';

/** A glyph placed on a map: its identity and the hex it sits on. The runtime
 *  `HSGlyph` (with `faceUp`) is materialized from this at game start. */
export type HSGlyphPlacement = { id: HSGlyphId; at: HexKey };

export type HSMap = {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: Record<HexKey, HexCell>;
  /** Start-zone hexes per roster index (0-based; `@1` → 0), in column order. */
  startZones: Record<number, HexKey[]>;
  /** Glyph spots (`*` tokens) — parsed for forward-compat, unused in slice 1. */
  glyphSpots: HexKey[];
  /** Slice-4 glyph layout: which glyph sits on which hex. Deterministic per
   *  map (no scenario randomization yet). Placed power-side-up at game start.
   *  Every hex here must be a real cell and not a start-zone hex (glyphs sit on
   *  neutral mid-board terrain). */
  glyphs: HSGlyphPlacement[];
};

const TERRAIN_BY_TOKEN: Record<string, Terrain> = {
  G: 'grass',
  R: 'rock',
  S: 'sand',
  W: 'water',
};

/** Parse a token-grid map spec. Throws on malformed input (maps are static
 *  content compiled in at build time — a bad map should fail loudly).
 *  `glyphs` is an optional slice-4 glyph layout (id → offset col,row); each
 *  placement is validated to land on a real cell. */
export function parseMap(
  id: string,
  name: string,
  spec: string,
  glyphLayout: { id: HSGlyphId; col: number; row: number }[] = [],
): HSMap {
  const cells: Record<HexKey, HexCell> = {};
  const startZones: Record<number, HexKey[]> = {};
  const glyphSpots: HexKey[] = [];
  let cols = 0;
  let rows = 0;

  for (const rawLine of spec.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^row(\d+)(?:@(\d+))?:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`heroscape maps: unparseable line "${line}" in "${id}"`);
    const row = parseInt(m[1], 10) - 1; // row1 → r=0
    const startSeat = m[2] != null ? parseInt(m[2], 10) - 1 : null; // @1 → index 0
    const tokens = m[3].split(/\s+/).filter(Boolean);
    rows = Math.max(rows, row + 1);
    cols = Math.max(cols, tokens.length);
    tokens.forEach((token, col) => {
      if (token === '.') return; // void: no hex exists here at all
      const t = /^([GRSW])(\d+)(\*)?$/.exec(token);
      if (!t) throw new Error(`heroscape maps: bad token "${token}" in "${id}" row ${row + 1}`);
      const { q, r } = offsetToAxial(col, row);
      const key = hexKey(q, r);
      cells[key] = { q, r, height: parseInt(t[2], 10), terrain: TERRAIN_BY_TOKEN[t[1]] };
      if (t[3]) glyphSpots.push(key);
      if (startSeat != null) {
        if (!startZones[startSeat]) startZones[startSeat] = [];
        startZones[startSeat].push(key);
      }
    });
  }

  // Materialize the glyph layout into axial keys, validating each lands on a
  // real cell (a typo in a layout should fail loudly at build time).
  const glyphs: HSGlyphPlacement[] = glyphLayout.map(g => {
    const { q, r } = offsetToAxial(g.col, g.row);
    const key = hexKey(q, r);
    if (!cells[key]) {
      throw new Error(`heroscape maps: glyph "${g.id}" placed off-map at (${g.col + 1}, ${g.row + 1}) in "${id}"`);
    }
    return { id: g.id, at: key };
  });

  return { id, name, cols, rows, cells, startZones, glyphSpots, glyphs };
}

/** TEST-1 "Training Field" (docs/heroscape/test-maps.md) — 7×8, all grass
 *  height 1; start zones: row 1 (player 1) and row 8 (player 2), full width.
 *  Implemented exactly as specified. */
export const TRAINING_FIELD: HSMap = parseMap(
  'training_field',
  'Training Field',
  `
  row1@1: G1 G1 G1 G1 G1 G1 G1
  row2:   G1 G1 G1 G1 G1 G1 G1
  row3:   G1 G1 G1 G1 G1 G1 G1
  row4:   G1 G1 G1 G1 G1 G1 G1
  row5:   G1 G1 G1 G1 G1 G1 G1
  row6:   G1 G1 G1 G1 G1 G1 G1
  row7:   G1 G1 G1 G1 G1 G1 G1
  row8@2: G1 G1 G1 G1 G1 G1 G1
  `,
  // Slice-4 glyphs: Astrid (+1 attack) and Gerda (+1 defense) on two mid-row
  // hexes — flat ground makes the buffs easy to read and test.
  [
    { id: 'astrid', col: 2, row: 3 }, // (3,4) — left of center
    { id: 'gerda', col: 4, row: 3 }, // (5,4) — right of center
  ],
);

/** TEST-2 "The Knoll" (docs/heroscape/test-maps.md) — 9×8 with a 3-tier rock
 *  hill in the center (heights 1→2→3→4). Start zones: full-width row 1
 *  (player 1) and row 8 (player 2). Exercises climb cost / climb limit / free
 *  descent / falling off the R4 summit / height advantage / engagement-breaking
 *  elevation. The `*` summit glyph spot is parsed for forward-compat (slice 4).
 *  Implemented exactly as the token grid specifies. */
export const THE_KNOLL: HSMap = parseMap(
  'the_knoll',
  'The Knoll',
  `
  row1@1: G1 G1 G1 G1 G1 G1 G1 G1 G1
  row2:   G1 G1 G1 G2 G2 G2 G1 G1 G1
  row3:   G1 G1 G2 R3 R3 R3 G2 G1 G1
  row4:   G1 G2 R3 R4 R4 R4 R3 G2 G1
  row5:   G1 G2 R3 R4 R4 R4 R3 G2 G1
  row6:   G1 G1 G2 R3 R3 R3 G2 G1 G1
  row7:   G1 G1 G1 G2 G2 G2 G1 G1 G1
  row8@2: G1 G1 G1 G1 G1 G1 G1 G1 G1
  `,
  // Slice-4 glyphs: Astrid on the R4 summit (height advantage stacks with the
  // +1 attack die — the spec's "stacking" scenario), Valda on a low west grass
  // hex (the Move +2 boost rewards holding the flank).
  [
    { id: 'astrid', col: 4, row: 3 }, // (5,4) — central R4 summit (height 4)
    { id: 'valda', col: 0, row: 4 }, // (1,5) — low grass (height 1)
  ],
);

/** TEST-3 "Ford Crossing" (docs/heroscape/test-maps.md) — 10×7. A water river
 *  (rows 3-5) splits two grass banks; a 1-hex ford (col 5 grass) and a sand
 *  spit (col 4/6 row 4) are the only dry crossings. Two void hexes (row 2/6
 *  col 8) test Range counting around gaps. Start zones: full-width row 1
 *  (player 1) and row 7 (player 2). Exercises water forced-stop, climbing out
 *  of water, ranged attacks across the river, Range routed around voids.
 *  NOTE: the `@2`/`@1` row tokens (G2 = grass height 2) are terrain heights,
 *  NOT start-zone owners — only the `@N` row-label suffix marks a start zone. */
export const FORD_CROSSING: HSMap = parseMap(
  'ford_crossing',
  'Ford Crossing',
  `
  row1@1: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
  row2:   G1 G1 G1 G1 G2 G1 G1 .  G1 G1
  row3:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
  row4:   W1 W1 W1 S1 G1 S1 W1 W1 W1 W1
  row5:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
  row6:   G1 G1 G1 G1 G2 G1 G1 .  G1 G1
  row7@2: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
  `,
  // Slice-4 glyphs: Kelda (Healer) on a south-bank grass hex (heal up after
  // fording), Ivor on the mid-river ford grass (Range +4 for the long-ranged
  // Marro / Range≥4 figures who hold the crossing).
  [
    { id: 'kelda', col: 1, row: 5 }, // (2,6) — south bank grass (height 1)
    { id: 'ivor', col: 4, row: 3 }, // (5,4) — the ford, ringed by water/sand
  ],
);

export const MAPS: Record<string, HSMap> = {
  [TRAINING_FIELD.id]: TRAINING_FIELD,
  [THE_KNOLL.id]: THE_KNOLL,
  [FORD_CROSSING.id]: FORD_CROSSING,
};
