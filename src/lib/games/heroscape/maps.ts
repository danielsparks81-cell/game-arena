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
  // Each ring pillar is now a 3-hex WALL SEGMENT: the centre pillar (5,0) flanked by its two ring
  // neighbours (5,-1) & (4,1), all orbited to the six arms — so every arm faces an identical tangential
  // wall arc (owner 2026-06-28: "add more walls flanking, symmetric over the entire board"). 18 wall
  // hexes of the 30-hex radius-5 ring, leaving a 2-wide gap per arm to keep the centre reachable.
  const walls = new Set([...orbit(5, 0), ...orbit(5, -1), ...orbit(4, 1)]);
  const peaks = new Set(orbit(8, -4)); // each arm's hill peak (height 3)
  const slopes = new Set([...orbit(7, -3), ...orbit(9, -5)]); // ridge either side of each peak (height 2)
  // 6-fold SYMMETRIC WATER — small ponds down each arm (owner request 2026-06-25): one just inside
  // the wall ring, one in the mid-arm, one at the foot of each hill. Each is a single seed orbited to
  // all six arms, all in the neutral interior (well inside the deploy tips) and clear of the walls /
  // glyph anchors, so fairness is untouched — water just adds forced-stop terrain to path around. A
  // water surface is height 1 (flat), so the terrain stays height-symmetric.
  const water = new Set([...orbit(3, 1), ...orbit(6, -2), ...orbit(10, -5)]);
  const starHeight = (q: number, r: number): number => {
    const d = centerDist(q, r);
    if (d > tipCut) return 1; // deploy tips stay flat
    const k = hexKey(q, r);
    if (walls.has(k)) return 15;
    if (peaks.has(k)) return 3;
    if (slopes.has(k)) return 2;
    if (d <= 2) return 2; // central plateau — FLAT (incl. the centre [0,0] glyph) so a 2-hex figure can rest level on it (owner ruling 2026-06-24)
    return 1;
  };
  const cells: Record<HexKey, HexCell> = {};
  const all: { q: number; r: number }[] = [];
  for (let q = -2 * R; q <= 2 * R; q++) {
    for (let r = -2 * R; r <= 2 * R; r++) {
      if (!inStar(q, r)) continue;
      const k = hexKey(q, r);
      const isWater = water.has(k) && centerDist(q, r) <= tipCut; // deploy tips stay dry grass
      const height = isWater ? 1 : starHeight(q, r);
      cells[k] = { q, r, height, terrain: isWater ? 'water' : height === 15 ? 'rock' : 'grass' };
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
  // SYMMETRIC glyph anchors: the centre + a 6-fold orbit at hex-radius 7 — all in the neutral
  // central hexagon, well clear of the height-15 wall ring (radius 5) and the deploy tips
  // (centre-distance > tipCut), so every glyph sits ≥5 from every start zone (the Range-9 rule).
  const glyphAnchors = [hexKey(0, 0), ...orbit(7, 0)].filter(k => cells[k] && cells[k].terrain !== 'rock');
  return {
    id, name,
    cols: maxCol - minCol + 1,
    rows: maxRow - minRow + 1,
    cells,
    startZones: Object.fromEntries(pointZones.map((z, i) => [i, z])),
    zonesByCount,
    glyphSpots: [],
    glyphs: [],
    glyphAnchors,
  };
}

/** The grand 6-point star for 3-6 player battles (R=10): 661 hexes, 21-hex tip
 *  zones ~10 apart — beyond Range 9, so no turn-one cross-map sniping. */
export const STAR_FIELD: HSMap = makeStarMap('star_field', 'Star Field', 10, 14);

// ============================================================================
// PERFECTLY SYMMETRIC battlefields for 3 & 4 players (5 & 6 players use the 6-fold Star Field —
// 5 take 5 of its 6 identical tips). Built in axial (q,r) on a HEXAGON, which carries every hex
// symmetry, so the symmetry is EXACT — not approximate:
//   • 3p — true 3-fold ROTATION (rot120 orbits).
//   • 4p — exact hex D2: reflect across BOTH centre axes + rot180 → 4 identical quarters. (A hex
//     grid has NO 4-fold rotation, but this order-4 group maps each of the 4 zones onto the others
//     EXACTLY — unlike an odd-r OFFSET mirror, which the half-row shift makes only approximate.)
// Zones are pushed to the rim and the glyphs clustered in the core, so every glyph anchor sits ≥5
// hexes from EVERY start zone. Flat grass zones ≥10 apart (no Range-9 turn-one snipe), a raised
// centre + ridges, isolated height-15 rock WALL pillars (cover/LOS, never sealing — flyers cross).
// ============================================================================

const cubeDist = (q: number, r: number): number => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
const axDist = (aq: number, ar: number, bq: number, br: number): number => cubeDist(aq - bq, ar - br);
/** Rotate (q,r) by k×60° about the origin. */
function rot60n(q: number, r: number, k: number): [number, number] {
  let a = q, b = r;
  for (let i = 0; i < ((k % 6) + 6) % 6; i++) { const na = -b, nb = a + b; a = na; b = nb; }
  return [a, b];
}
type HexTf = (q: number, r: number) => [number, number];
/** True 3-fold rotation group (identity, 120°, 240°). */
const ROT120: HexTf[] = [(q, r) => [q, r], (q, r) => rot60n(q, r, 2), (q, r) => rot60n(q, r, 4)];
/** Exact hex reflections — across the horizontal axis (q,r)→(q+r,−r) and the vertical (q,r)→(−q−r,r)
 *  — plus their product rot180. This order-4 group D2 maps an off-axis seed to 4 symmetric corners. */
const D2: HexTf[] = [(q, r) => [q, r], (q, r) => [q + r, -r], (q, r) => [-q - r, r], (q, r) => [-q, -r]];
/** Distinct on-board images of `seeds` under a symmetry group. */
function symOrbit(tfs: HexTf[], seeds: [number, number][], inB: (q: number, r: number) => boolean): [number, number][] {
  const seen = new Set<HexKey>(); const out: [number, number][] = [];
  for (const [q, r] of seeds) for (const tf of tfs) { const [a, b] = tf(q, r); const k = hexKey(a, b); if (inB(a, b) && !seen.has(k)) { seen.add(k); out.push([a, b]); } }
  return out;
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

/** A PERFECTLY SYMMETRIC hexagon battlefield (radius R, symmetry group `tfs`). The start zones are
 *  the orbit of one rim seed (flat caps spaced ≥10); the centre is a raised crater; walls + ridges
 *  are orbits; the glyph anchors are the centre + glyph orbits, kept only where they sit ≥5 from
 *  EVERY start zone (symmetry makes a whole orbit pass or fail together, so the kept set stays
 *  symmetric). Push the zones to the rim (bigger R) so the central anchors clear them by ≥5. */
function makeSymHexMap(
  id: string, name: string,
  cfg: { R: number; tfs: HexTf[]; zoneSeed: [number, number]; zoneCap: number; wallSeeds: [number, number][]; ridgeSeeds: [number, number][]; ridge3Seeds: [number, number][]; glyphSeeds: [number, number][] },
): HSMap {
  const { R, tfs, zoneSeed, zoneCap, wallSeeds, ridgeSeeds, ridge3Seeds, glyphSeeds } = cfg;
  const inBoard = (q: number, r: number) => cubeDist(q, r) <= R;
  const setOf = (seeds: [number, number][]) => new Set(symOrbit(tfs, seeds, inBoard).map(([q, r]) => hexKey(q, r)));
  const walls = setOf(wallSeeds), ridge2 = setOf(ridgeSeeds), ridge3 = setOf(ridge3Seeds);

  const cells: Record<HexKey, HexCell> = {};
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    if (!inBoard(q, r)) continue;
    const k = hexKey(q, r); const d = cubeDist(q, r);
    let height = 1; let terrain: Terrain = 'grass';
    if (walls.has(k)) { height = 15; terrain = 'rock'; }       // impassable cover (flyers cross)
    else if (d <= 2) height = 2;                              // central plateau — FLAT (incl. the centre [0,0] glyph) so a 2-hex figure can rest level on it (owner ruling 2026-06-24)
    else if (ridge3.has(k)) height = 3;
    else if (ridge2.has(k)) height = 2;
    cells[k] = { q, r, height, terrain };
  }
  // Zones: a flat grass cap around each orbit image of the zone seed.
  const zones: HexKey[][] = symOrbit(tfs, [zoneSeed], inBoard).map(([cq, cr]) => {
    const z: HexKey[] = [];
    for (const k of Object.keys(cells) as HexKey[]) { const c = cells[k]; if (axDist(c.q, c.r, cq, cr) <= zoneCap) { c.height = 1; c.terrain = 'grass'; z.push(k); } }
    return z;
  });
  // Glyph anchors: centre + glyph orbits, kept only where ≥5 from EVERY zone cell + off the walls.
  const zoneCells = zones.flat().map(k => [cells[k].q, cells[k].r] as [number, number]);
  const minToZone = (q: number, r: number) => Math.min(...zoneCells.map(([zq, zr]) => axDist(q, r, zq, zr)));
  const anchors = ([[0, 0], ...symOrbit(tfs, glyphSeeds, inBoard)] as [number, number][])
    .filter(([q, r]) => { const k = hexKey(q, r); return cells[k] && cells[k].terrain !== 'rock' && minToZone(q, r) >= 5; })
    .map(([q, r]) => hexKey(q, r));
  return finishMap(id, name, cells, zones, anchors);
}

/** TRISKELION VALE (3p) — true 3-fold rotation. Hexagon R=11; 3 corner zones (rot120 orbit, 2R=22
 *  apart); a central glyph cluster ≥5 from every zone. */
export const TRISKELION: HSMap = makeSymHexMap('triskelion', 'Triskelion Vale', {
  R: 11, tfs: ROT120, zoneSeed: [11, 0], zoneCap: 3,
  wallSeeds: [[6, -3], [5, 1]], ridgeSeeds: [[4, -1], [3, 2]], ridge3Seeds: [], glyphSeeds: [[2, 0], [1, 2]],
});

/** CROSSROADS KEEP (4p) — exact hex D2 (both mirror axes). Hexagon R=14; 4 corner zones (the D2
 *  orbit of one off-axis seed); a central glyph cluster ≥5 from every zone. */
export const CROSSROADS: HSMap = makeSymHexMap('crossroads', 'Crossroads Keep', {
  R: 14, tfs: D2, zoneSeed: [3, 9], zoneCap: 2,
  wallSeeds: [[6, 0], [4, 5], [0, 6]], ridgeSeeds: [[5, 2], [2, 5]], ridge3Seeds: [], glyphSeeds: [[2, 1], [3, -1]],
});

export const MAPS: Record<string, HSMap> = {
  [TRAINING_FIELD.id]: TRAINING_FIELD,
  [THE_KNOLL.id]: THE_KNOLL,
  [FORD_CROSSING.id]: FORD_CROSSING,
  [TRISKELION.id]: TRISKELION,
  [CROSSROADS.id]: CROSSROADS,
  [STAR_FIELD.id]: STAR_FIELD,
};
