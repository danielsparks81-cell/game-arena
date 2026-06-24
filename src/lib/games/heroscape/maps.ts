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
import { hexKey, offsetToAxial, axialToOffset } from './board';

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
  /** Multiplayer maps (the 6-point star): the per-PLAYER-COUNT seat→zone map.
   *  A star has six point-zones; with N players the engine uses the spread-out
   *  subset for that count (`zonesByCount[N][seat]`). Absent on the 2-player
   *  rectangles — they fall back to `startZones`. See `effectiveStartZones`. */
  zonesByCount?: Record<number, Record<number, HexKey[]>>;
  /** Glyph spots (`*` tokens) — parsed for forward-compat, unused in slice 1. */
  glyphSpots: HexKey[];
  /** SYMMETRIC glyph anchor hexes for the designed multiplayer maps. When present,
   *  `generateGlyphs` places the (random per-game) glyph IDs on THESE fixed,
   *  rotationally/mirror-symmetric positions instead of computing fair ones — so a
   *  symmetric battlefield keeps its glyphs symmetric. Each must be a real, passable,
   *  non-start-zone cell. Absent on the rectangles + the star (they stay fair-random). */
  glyphAnchors?: HexKey[];
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
 *  height 1. Slice-5 start zones are TWO rows deep so a drafted army fits:
 *  seat 0 = rows 1-2, seat 1 = rows 7-8, full width (14 hexes each). */
export const TRAINING_FIELD: HSMap = parseMap(
  'training_field',
  'Training Field',
  `
  row1@1: G1 G1 G1 G1 G1 G1 G1
  row2@1: G1 G1 G1 G1 G1 G1 G1
  row3:   G1 G1 G1 G1 G1 G1 G1
  row4:   G1 G1 G1 G1 G1 G1 G1
  row5:   G1 G1 G1 G1 G1 G1 G1
  row6:   G1 G1 G1 G1 G1 G1 G1
  row7@2: G1 G1 G1 G1 G1 G1 G1
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
 *  hill in the center (heights 1→2→3→4). Slice-5 start zones are two rows deep:
 *  seat 0 = rows 1-2, seat 1 = rows 7-8 (18 hexes each). Exercises climb cost /
 *  climb limit / free
 *  descent / falling off the R4 summit / height advantage / engagement-breaking
 *  elevation. The `*` summit glyph spot is parsed for forward-compat (slice 4).
 *  Implemented exactly as the token grid specifies. */
export const THE_KNOLL: HSMap = parseMap(
  'the_knoll',
  'The Knoll',
  `
  row1@1: G1 G1 G1 G1 G1 G1 G1 G1 G1
  row2@1: G1 G1 G1 G2 G2 G2 G1 G1 G1
  row3:   G1 G1 G2 R3 R3 R3 G2 G1 G1
  row4:   G1 G2 R3 R4 R4 R4 R3 G2 G1
  row5:   G1 G2 R3 R4 R4 R4 R3 G2 G1
  row6:   G1 G1 G2 R3 R3 R3 G2 G1 G1
  row7@2: G1 G1 G1 G2 G2 G2 G1 G1 G1
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
 *  Slice-5 start zones are two rows deep: seat 0 = rows 1-2, seat 1 = rows 6-7
 *  (the river rows 3-5 stay neutral). Exercises water forced-stop, climbing out
 *  of water, ranged attacks across the river, Range routed around voids.
 *  NOTE: the `G2` tokens (grass height 2) are terrain heights, NOT start-zone
 *  owners — only the `@N` row-label suffix marks a start zone. */
export const FORD_CROSSING: HSMap = parseMap(
  'ford_crossing',
  'Ford Crossing',
  `
  row1@1: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
  row2@1: G1 G1 G1 G1 G2 G1 G1 .  G1 G1
  row3:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
  row4:   W1 W1 W1 S1 G1 S1 W1 W1 W1 W1
  row5:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
  row6@2: G1 G1 G1 G1 G2 G1 G1 .  G1 G1
  row7@2: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
  `,
  // Slice-4 glyphs on neutral mid-river terrain (now that the two-row start
  // zones cover both banks): Kelda (Healer) on the west sand spit beside the
  // ford, Ivor on the mid-river ford grass (Range +4 for the long-ranged Marro
  // / Range≥4 figures who hold the crossing).
  [
    { id: 'kelda', col: 3, row: 3 }, // (4,4) — west sand spit (height 1)
    { id: 'ivor', col: 4, row: 3 }, // (5,4) — the ford, ringed by water/sand
  ],
);

// ============================================================================
// Multiplayer battlefield — the 6-POINT STAR (hexagram). GENERATED, not parsed.
// A true hexagram's points TOUCH at the centre, so each start zone is only the
// outer TIP of its point (the inner point + central hexagon stay neutral), and
// the board is sized so even the longest-range figure (Range 9) cannot hit a
// rival deployment without first moving. The six tips ARE the start zones; with
// N players the engine uses the spread-out subset (`zonesByCount`).
// ============================================================================

/** seat → point index, per player count — spread to maximise the gap between
 *  occupied points (2-3 avoid adjacency entirely; 4-6 must take adjacent points,
 *  which is why the board has to be large). */
const STAR_POINTS_BY_COUNT: Record<number, number[]> = {
  2: [0, 3], // opposite tips — farthest apart; makes the Star Field a valid 2-player map too
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

/** Build a hexagram battlefield: `R` sizes the star (cells = the union of two
 *  cube-coord triangles); `tipCut` is the centre-distance beyond which a point
 *  cell becomes a start zone (the tip), keeping deployments far apart. All grass
 *  height 1 for now. */
function makeStarMap(id: string, name: string, R: number, tipCut: number): HSMap {
  const inStar = (q: number, r: number): boolean => {
    const s = -q - r;
    return (q >= -R && r >= -R && s >= -R) || (q <= R && r <= R && s <= R);
  };
  const centerDist = (q: number, r: number): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  const px = (q: number, r: number) => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });
  // 6-FOLD SYMMETRIC TERRAIN so the star isn't a flat plain: a low central mound, a
  // ring of impassable height-15 WALL pillars around it (cover + line-of-sight
  // breakers), and a small height-2/3 ridge partway down each arm. Every feature is a
  // seed replicated to its six 60° rotations (rot60), so all six players face an
  // IDENTICAL battlefield. The neutral interior (centreDist ≤ tipCut) carries the
  // terrain; the start-zone tips stay flat grass for fair deployment.
  const rot60 = (q: number, r: number): [number, number] => [-r, q + r];
  const orbit = (q: number, r: number): string[] => {
    const out: string[] = [];
    let cq = q, cr = r;
    for (let i = 0; i < 6; i++) { out.push(hexKey(cq, cr)); [cq, cr] = rot60(cq, cr); }
    return out;
  };
  const walls = new Set(orbit(5, 0)); // 6 height-15 pillars ringing the centre
  const peaks = new Set(orbit(8, -4)); // each arm's hill peak (height 3)
  const slopes = new Set([...orbit(7, -3), ...orbit(9, -5)]); // ridge either side of each peak (height 2)
  const starHeight = (q: number, r: number): number => {
    const d = centerDist(q, r);
    if (d > tipCut) return 1; // deploy tips stay flat
    const k = hexKey(q, r);
    if (walls.has(k)) return 15;
    if (peaks.has(k)) return 3;
    if (slopes.has(k)) return 2;
    if (d === 0) return 3; // central peak
    if (d <= 2) return 2; // central mound
    return 1;
  };
  const cells: Record<HexKey, HexCell> = {};
  const all: { q: number; r: number }[] = [];
  for (let q = -2 * R; q <= 2 * R; q++) {
    for (let r = -2 * R; r <= 2 * R; r++) {
      if (!inStar(q, r)) continue;
      const height = starHeight(q, r);
      cells[hexKey(q, r)] = { q, r, height, terrain: height === 15 ? 'rock' : 'grass' };
      all.push({ q, r });
    }
  }
  // The 6 tips, ordered by screen angle so point indices run round the star.
  const tips = ([[2 * R, -R], [-R, -R], [-R, 2 * R], [R, -2 * R], [R, R], [-2 * R, R]] as const)
    .map(([q, r]) => ({ q, r, a: Math.atan2(px(q, r).y, px(q, r).x) }))
    .sort((p, n) => p.a - n.a);
  const pointZones: HexKey[][] = [[], [], [], [], [], []];
  for (const c of all) {
    if (centerDist(c.q, c.r) <= tipCut) continue; // central + inner point = neutral
    const p = px(c.q, c.r);
    let best = 0, bd = Infinity;
    tips.forEach((t, i) => {
      const tp = px(t.q, t.r);
      const d = Math.hypot(tp.x - p.x, tp.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    pointZones[best].push(hexKey(c.q, c.r));
  }
  // Assign the chosen tips to seats FARTHEST-FIRST: seat 0 takes a tip, seat 1 the
  // tip farthest from it, seat 2 the one farthest from {0,1}, … — so successive
  // players are always as far apart as the star allows (2 players land opposite, and
  // even 4-6 spread the early seats out instead of clustering at adjacent tips).
  const tipPx = (pi: number) => px(tips[pi].q, tips[pi].r);
  const farthestFirst = (idxs: number[]): number[] => {
    const out = [idxs[0]];
    const rest = idxs.slice(1);
    while (rest.length) {
      let bi = 0, bd = -1;
      rest.forEach((cand, k) => {
        const d = Math.min(...out.map(o => Math.hypot(tipPx(o).x - tipPx(cand).x, tipPx(o).y - tipPx(cand).y)));
        if (d > bd) { bd = d; bi = k; }
      });
      out.push(rest.splice(bi, 1)[0]);
    }
    return out;
  };
  const zonesByCount: Record<number, Record<number, HexKey[]>> = {};
  for (const [n, picks] of Object.entries(STAR_POINTS_BY_COUNT)) {
    zonesByCount[Number(n)] = Object.fromEntries(farthestFirst(picks).map((pi, seat) => [seat, pointZones[pi]]));
  }
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const key of Object.keys(cells)) {
    const { col, row } = axialToOffset(key);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  return {
    id, name,
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    cells,
    startZones: Object.fromEntries(pointZones.map((z, i) => [i, z])),
    zonesByCount,
    glyphSpots: [],
    glyphs: [],
  };
}

/** The grand 6-point star for 3-6 player battles (R=10): 661 hexes, 21-hex tip
 *  zones ~10 apart — beyond Range 9, so no turn-one cross-map sniping. */
export const STAR_FIELD: HSMap = makeStarMap('star_field', 'Star Field', 10, 14);

// ============================================================================
// SYMMETRIC battlefields for EXACTLY 3 / 4 / 5 players. Each is generated with true
// fairness: a raised CENTRE, symmetric height-15 rock WALL pillars (cover + line-of-
// sight breakers; isolated single hexes so they NEVER seal a path — flyers cross),
// symmetric grass RIDGES (height 2-3), flat grass START ZONES spaced beyond Range 9,
// and symmetric GLYPH ANCHORS (random ids per game). Built in axial (q,r) cube coords.
//   • 3p — TRUE 3-fold rotation (rot120 orbits) on a hexagon.
//   • 4p — 4 mirror-image quadrants (reflect across both centre axes) on a diamond.
//   • 5p — 5-fold ANGULAR symmetry on a disc (features rotated 72° + snapped to hexes;
//          a hex grid can't be exactly 5-fold, so this is symmetric to the eye + fair).
// ============================================================================

const CUBE_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const cubeDist = (q: number, r: number): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
const axDist = (aq: number, ar: number, bq: number, br: number): number => cubeDist(aq - bq, ar - br);
/** Rotate (q,r) by k×60° about the origin (cube rotation: (q,r,s)→(-r,-s,-q) is 60°). */
function rot60n(q: number, r: number, k: number): [number, number] {
  let a = q, b = r;
  const t = ((k % 6) + 6) % 6;
  for (let i = 0; i < t; i++) { const na = -b, nb = a + b; a = na; b = nb; }
  return [a, b];
}
/** Pointy-top hex → pixel, for angular placement / nearest-hex snapping. */
const hexPx = (q: number, r: number): { x: number; y: number } => ({ x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r });
/** Cube-round a fractional axial coord to the nearest hex. */
function axRound(qf: number, rf: number): [number, number] {
  const xf = qf, zf = rf, yf = -xf - zf;
  let rx = Math.round(xf), ry = Math.round(yf), rz = Math.round(zf);
  const dx = Math.abs(rx - xf), dy = Math.abs(ry - yf), dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, rz];
}
/** Build an HSMap from a cell map + per-seat zones + symmetric glyph anchors. Computes
 *  the offset bounding box (cols/rows) the renderer + odd-r conversions expect. */
function finishMap(
  id: string, name: string,
  cells: Record<HexKey, HexCell>,
  zones: HexKey[][],
  glyphAnchors: HexKey[],
): HSMap {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const key of Object.keys(cells) as HexKey[]) {
    const { col, row } = axialToOffset(key);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
  }
  const startZones: Record<number, HexKey[]> = Object.fromEntries(zones.map((z, i) => [i, z]));
  const zonesByCount: Record<number, Record<number, HexKey[]>> = { [zones.length]: startZones };
  return {
    id, name,
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    cells,
    startZones,
    zonesByCount,
    glyphSpots: [],
    glyphs: [],
    glyphAnchors,
  };
}

/** Three-player TRISKELION — a hexagon (radius R) with TRUE 3-fold rotational symmetry.
 *  Three flat start-zone caps sit at alternating corners (120° apart, 2R hexes = ≥10
 *  beyond Range 9); a raised central crater; and rot120-orbit walls + ridges + glyphs. */
function makeTriMap(id: string, name: string): HSMap {
  const R = 8;
  const inBoard = (q: number, r: number) => cubeDist(q, r) <= R;
  // The three zone corners: the rot120 orbit of (R,0) → corners 120° apart.
  const corners: [number, number][] = [0, 1, 2].map(k => rot60n(R, 0, 2 * k));
  const ZONE_CAP = 3; // hex radius of each corner cap (≥10 apart: 2R−2·CAP = 16−6 = 10)
  // Symmetric feature seeds, given in ONE 120° sector and replicated by rot120 (k=0,1,2).
  const wallSeeds: [number, number][] = [[4, -2], [2, 2], [6, -3]]; // isolated rock pillars
  const ridgeSeeds: [number, number][] = [[3, 0], [1, 3]];          // grass height-2 ridge cells
  const ridge3Seeds: [number, number][] = [[2, 1]];                 // grass height-3 knob
  const glyphSeeds: [number, number][] = [[4, 0], [1, 4]];          // 2 orbits → 6 + centre = 7

  const orbit3 = (seeds: [number, number][]): Set<HexKey> => {
    const out = new Set<HexKey>();
    for (const [q, r] of seeds) for (let k = 0; k < 3; k++) { const [a, b] = rot60n(q, r, 2 * k); if (inBoard(a, b)) out.add(hexKey(a, b)); }
    return out;
  };
  const walls = orbit3(wallSeeds);
  const ridge2 = orbit3(ridgeSeeds);
  const ridge3 = orbit3(ridge3Seeds);

  const cells: Record<HexKey, HexCell> = {};
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    if (!inBoard(q, r)) continue;
    const k = hexKey(q, r);
    const d = cubeDist(q, r);
    let height = 1; let terrain: Terrain = 'grass';
    if (walls.has(k)) { height = 15; terrain = 'rock'; }
    else if (d === 0) height = 3;        // central peak
    else if (d <= 2) height = 2;         // central crater rim
    else if (ridge3.has(k)) height = 3;
    else if (ridge2.has(k)) height = 2;
    cells[k] = { q, r, height, terrain };
  }
  // Zones: the cap of hexes within ZONE_CAP of each corner (flat grass, never a wall).
  const zones: HexKey[][] = corners.map(([cq, cr]) => {
    const z: HexKey[] = [];
    for (const k of Object.keys(cells) as HexKey[]) {
      const c = cells[k];
      if (axDist(c.q, c.r, cq, cr) <= ZONE_CAP) { c.height = 1; c.terrain = 'grass'; z.push(k); }
    }
    return z;
  });
  // Glyph anchors: the centre + the rot120 orbits of the glyph seeds (off zones + walls).
  const anchors = [hexKey(0, 0), ...orbit3(glyphSeeds)].filter(k => cells[k] && cells[k].terrain !== 'rock');
  return finishMap(id, name, cells, zones, anchors);
}

/** Four-player CROSSROADS — a 17×17 board with 4 MIRROR-IMAGE quadrants (reflect across both
 *  centre lines in odd-r OFFSET space, the natural symmetry for a square hex board). Four flat
 *  corner zones (≥10 apart), a raised centre, and quadrant-mirrored rock walls + grass ridges +
 *  glyph anchors — each of the four quarters is identical. */
function makeQuadMap(id: string, name: string): HSMap {
  const C = 17, Rr = 17;
  const cMid = (C - 1) / 2, rMid = (Rr - 1) / 2; // centre offset (8,8)
  const keyAt = (c: number, r: number): HexKey => { const { q, r: ar } = offsetToAxial(c, r); return hexKey(q, ar); };
  const inGrid = (c: number, r: number) => c >= 0 && c < C && r >= 0 && r < Rr;
  // Mirror a TOP-LEFT-quadrant offset seed into all four quadrants.
  const mirror4 = (seeds: [number, number][]): Set<HexKey> => {
    const out = new Set<HexKey>();
    for (const [c, r] of seeds) for (const [cc, rr] of [[c, r], [C - 1 - c, r], [c, Rr - 1 - r], [C - 1 - c, Rr - 1 - r]] as [number, number][]) if (inGrid(cc, rr)) out.add(keyAt(cc, rr));
    return out;
  };
  const wallSeeds: [number, number][] = [[3, 3], [6, 2], [2, 6]];  // isolated rock pillars
  const ridgeSeeds: [number, number][] = [[5, 4], [4, 6]];          // grass height-2 ridge
  const glyphSeeds: [number, number][] = [[4, 2], [2, 5]];          // 2 mirror-orbits → 8 + centre = 9
  const walls = mirror4(wallSeeds);
  const ridge2 = mirror4(ridgeSeeds);

  const cells: Record<HexKey, HexCell> = {};
  for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
    const { q, r: ar } = offsetToAxial(c, r);
    const k = hexKey(q, ar);
    const md = Math.hypot(c - cMid, r - rMid); // central mound by offset radius
    let height = 1; let terrain: Terrain = 'grass';
    if (walls.has(k)) { height = 15; terrain = 'rock'; }
    else if (md < 1.2) height = 3;
    else if (md < 2.6) height = 2;
    else if (ridge2.has(k)) height = 2;
    cells[k] = { q, r: ar, height, terrain };
  }
  // Zones: a cap of offset-radius ≤ ZONE_CAP at each of the four corners (flat grass).
  const ZONE_CAP = 3;
  const cornersOff: [number, number][] = [[0, 0], [C - 1, 0], [0, Rr - 1], [C - 1, Rr - 1]];
  const zones: HexKey[][] = cornersOff.map(([cc, cr]) => {
    const z: HexKey[] = [];
    for (let r = 0; r < Rr; r++) for (let c = 0; c < C; c++) {
      if (Math.max(Math.abs(c - cc), Math.abs(r - cr)) <= ZONE_CAP) {
        const k = keyAt(c, r); const cell = cells[k];
        if (cell) { cell.height = 1; cell.terrain = 'grass'; z.push(k); }
      }
    }
    return z;
  });
  const anchors = [keyAt(cMid, rMid), ...mirror4(glyphSeeds)].filter(k => cells[k] && cells[k].terrain !== 'rock');
  return finishMap(id, name, cells, zones, anchors);
}

/** Five-player PENTAD — a disc (radius R) with 5-fold ANGULAR symmetry. Five flat zone
 *  caps sit evenly around the rim (72° apart), each behind a rock-pillar screen so a
 *  Range-9 figure can't snipe across on turn one even where caps are <10 apart. A hex
 *  grid can't be exactly 5-fold, so features are placed by rotating a seed 72° five times
 *  and snapping to the nearest hex — symmetric to the eye and fair. */
function makePentaMap(id: string, name: string): HSMap {
  const R = 13;
  const inBoard = (q: number, r: number) => cubeDist(q, r) <= R;
  const cellSet = new Set<HexKey>();
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) if (inBoard(q, r)) cellSet.add(hexKey(q, r));
  const nearestIn = (x: number, y: number): [number, number] => {
    // pixel → fractional axial (inverse of hexPx), then cube-round, clamped onto the disc.
    const rf = y / 1.5; const qf = x / Math.sqrt(3) - rf / 2;
    let [q, r] = axRound(qf, rf);
    if (!inBoard(q, r)) { // walk inward to the rim
      while (cubeDist(q, r) > R) { q = Math.trunc(q * 0.9); r = Math.trunc(r * 0.9); }
    }
    return [q, r];
  };
  // 5 hexes at HEX-radius `hexR` (converted to pixels: a hex at (hexR,0) sits √3·hexR out),
  // one per 72° spoke from `baseDeg`, snapped to the nearest cell.
  const ring = (hexR: number, baseDeg: number): [number, number][] =>
    [0, 1, 2, 3, 4].map(k => {
      const a = ((baseDeg + 72 * k) * Math.PI) / 180;
      const px = hexR * Math.sqrt(3);
      return nearestIn(px * Math.cos(a), px * Math.sin(a));
    });
  const zoneCenters = ring(R - 1, -90);          // 5 zone caps near the rim, first one at top
  const wallScreens = [...ring(R - 3, -90), ...ring(R - 6, -90 + 36)]; // a pillar screening each zone + one between
  const ridges = ring(R - 4, -90);               // grass height-2 lip in front of each zone
  const glyphRing = ring(R - 4, -90 + 36);       // glyphs in the lanes BETWEEN zones (distinct from walls/ridges)
  const ZONE_CAP = 2;

  const walls = new Set(wallScreens.map(([q, r]) => hexKey(q, r)));
  const ridgeSet = new Set(ridges.map(([q, r]) => hexKey(q, r)));

  const cells: Record<HexKey, HexCell> = {};
  for (const k of cellSet) {
    const { q, r } = parseAx(k);
    const d = cubeDist(q, r);
    let height = 1; let terrain: Terrain = 'grass';
    if (walls.has(k)) { height = 15; terrain = 'rock'; }
    else if (d === 0) height = 3;
    else if (d <= 2) height = 2;
    else if (ridgeSet.has(k)) height = 2;
    cells[k] = { q, r, height, terrain };
  }
  // A hex grid can't be EXACTLY 5-fold, so the rim clips each cap slightly differently — gather
  // each cap (cells within ZONE_CAP of its centre, sorted nearest-first) then TRIM all five to the
  // smallest count so every player gets an identical-size flat zone.
  const caps: { k: HexKey; d: number }[][] = zoneCenters.map(([cq, cr]) => {
    const cap: { k: HexKey; d: number }[] = [];
    for (const k of Object.keys(cells) as HexKey[]) {
      const c = cells[k];
      const d = axDist(c.q, c.r, cq, cr);
      if (d <= ZONE_CAP) cap.push({ k, d });
    }
    return cap.sort((a, b) => a.d - b.d);
  });
  const zoneSize = Math.min(...caps.map(c => c.length));
  const zones: HexKey[][] = caps.map(cap => cap.slice(0, zoneSize).map(e => { const cell = cells[e.k]; cell.height = 1; cell.terrain = 'grass'; return e.k; }));
  const anchors = [hexKey(0, 0), ...glyphRing.map(([q, r]) => hexKey(q, r))].filter(k => cells[k] && cells[k].terrain !== 'rock');
  return finishMap(id, name, cells, zones, anchors);
}

/** Parse an axial "q,r" key back to numbers (local helper; board.ts owns the canonical one). */
function parseAx(key: HexKey): { q: number; r: number } {
  const i = key.indexOf(',');
  return { q: Number(key.slice(0, i)), r: Number(key.slice(i + 1)) };
}

export const TRISKELION: HSMap = makeTriMap('triskelion', 'Triskelion Vale');
export const CROSSROADS: HSMap = makeQuadMap('crossroads', 'Crossroads Keep');
export const PENTAD: HSMap = makePentaMap('pentad', 'Pentad Crucible');

export const MAPS: Record<string, HSMap> = {
  [TRAINING_FIELD.id]: TRAINING_FIELD,
  [THE_KNOLL.id]: THE_KNOLL,
  [FORD_CROSSING.id]: FORD_CROSSING,
  [TRISKELION.id]: TRISKELION,
  [CROSSROADS.id]: CROSSROADS,
  [PENTAD.id]: PENTAD,
  [STAR_FIELD.id]: STAR_FIELD,
};
