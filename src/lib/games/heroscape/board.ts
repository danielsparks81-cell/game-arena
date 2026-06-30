// HeroScape — pure hex-grid math (slice 1: flat maps).
//
// Layout: pointy-top hexes. Map sources (docs/heroscape/test-maps.md) use
// "odd-r" offset rows — odd rows shifted right half a hex — which parse into
// axial (q, r) coordinates. Every helper here is a pure function over axial
// keys + a cell record, shared by the engine (validation) and the board
// component (highlights/rendering) so the two can never disagree.

import type { Axial, HexKey, HexCell } from './types';

export const hexKey = (q: number, r: number): HexKey => `${q},${r}`;

export function parseHexKey(key: HexKey): Axial {
  const i = key.indexOf(',');
  return { q: Number(key.slice(0, i)), r: Number(key.slice(i + 1)) };
}

/** odd-r offset (col, row) → axial. Odd rows are the ones shoved right. */
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

/** Axial → odd-r offset (col, row). Inverse of offsetToAxial. */
export function axialToOffset(key: HexKey): { col: number; row: number } {
  const { q, r } = parseHexKey(key);
  return { col: q + (r - (r & 1)) / 2, row: r };
}

/** The six axial neighbor directions (pointy-top). */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function neighborKeys(key: HexKey): HexKey[] {
  const { q, r } = parseHexKey(key);
  return DIRS.map(([dq, dr]) => hexKey(q + dq, r + dr));
}

// ============================================================================
// WALLS — a barrier that sits ON THE EDGE between two adjacent hexes (not on a
// hex). A wall fully severs that edge: you cannot MOVE across it, two figures it
// separates are NOT adjacent (no melee / no range-1 engagement), and any line of
// sight crossing the wall segment is blocked (full-height — blocks regardless of
// elevation). Walls are author-placed map content (owner ruling 2026-06-28).
// ============================================================================

/** One wall: the unordered edge between two adjacent hexes. */
export type WallEdge = readonly [HexKey, HexKey];

/** Canonical key for the edge between two hexes (order-independent), so a wall
 *  lookup is the same whichever direction you cross it. */
export function edgeKey(a: HexKey, b: HexKey): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

/** Build the fast lookup set from a map's wall list (undefined → empty). */
export function wallSetOf(walls: ReadonlyArray<WallEdge> | undefined): Set<string> {
  const s = new Set<string>();
  if (walls) for (const [a, b] of walls) s.add(edgeKey(a, b));
  return s;
}

/**
 * The `len` hexes stepping out from `from` in hex direction `dir` (0-5, indexing
 * DIRS), nearest-first: from+dir·1 … from+dir·len. Pure; does NOT filter to
 * on-map cells (the caller intersects with the battlefield). Used by line
 * special attacks (Mimring's Fire Line — a straight line of 8 spaces).
 */
export function hexLine(from: HexKey, dir: number, len: number): HexKey[] {
  const { q, r } = parseHexKey(from);
  const [dq, dr] = DIRS[((dir % 6) + 6) % 6];
  const out: HexKey[] = [];
  for (let k = 1; k <= len; k++) out.push(hexKey(q + dq * k, r + dr * k));
  return out;
}

/**
 * Straight-line hex distance (axial metric). NOTE: HeroScape counts Range
 * along actual battlefield spaces AROUND gaps (pp. 6, 13) — use rangeDistance
 * for rules checks. On gap-free maps the two agree.
 */
export function hexDistance(a: HexKey, b: HexKey): number {
  const A = parseHexKey(a);
  const B = parseHexKey(b);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * Range distance: spaces counted hex-by-hex across EXISTING battlefield cells
 * (around voids, never as the crow flies). Elevation is free for Range and
 * intervening figures never affect it — they only matter through LOS.
 * Returns null when no path of spaces connects the two hexes.
 */
export function rangeDistance(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  to: HexKey,
): number | null {
  if (!cells[from] || !cells[to]) return null;
  if (from === to) return 0;
  const dist = new Map<HexKey, number>([[from, 0]]);
  const queue: HexKey[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(cur)!;
    for (const n of neighborKeys(cur)) {
      if (!cells[n] || dist.has(n)) continue;
      if (n === to) return d + 1;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return null;
}

/** Every on-map hex within `maxDist` Range-spaces of ANY `from` hex — ONE BFS that
 *  routes around off-map gaps exactly like `rangeDistance` (Range counts spaces, so
 *  terrain/figures/elevation are ignored). Excludes the source hexes (d = 0). Used
 *  for the UI's shooting-range envelope, so it's a single cheap flood rather than a
 *  `rangeDistance` call per board hex. */
export function rangeFlood(
  cells: Record<HexKey, HexCell>,
  from: HexKey[],
  maxDist: number,
): Set<HexKey> {
  const dist = new Map<HexKey, number>();
  const queue: HexKey[] = [];
  for (const k of from) if (cells[k] && !dist.has(k)) { dist.set(k, 0); queue.push(k); }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(cur)!;
    if (d >= maxDist) continue;
    for (const n of neighborKeys(cur)) {
      if (!cells[n] || dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  const out = new Set<HexKey>();
  for (const [k, d] of dist) if (d >= 1) out.add(k);
  return out;
}

export type Occupancy = 'friendly' | 'enemy' | null;

/**
 * Step movement COST from a cell at height `hFrom` onto an adjacent cell at
 * height `hTo` (03-movement §3-4 "Movement cost / forced-stop summary"):
 *   • level or DOWN  → 1 (just the destination space; descent is free of
 *     extra cost, no matter how far you drop)
 *   • UP by L levels → 1 + L (each climbed level side costs 1 extra)
 * Water adds no extra cost beyond any climbed sides; the forced STOP is handled
 * separately in the search (water is not a free pass-through node).
 */
export function stepCost(hFrom: number, hTo: number): number {
  return 1 + Math.max(0, hTo - hFrom);
}

/**
 * Climb LIMIT (03-movement §3): a figure may never rise, in a SINGLE step, a
 * number of levels ≥ its Height number ("equal to or higher … all at once").
 * Max legal single-step rise = Height − 1. Equality is illegal. Descending or
 * level steps are always allowed by this rule.
 *
 * slice 7: a FLYER ignores this entirely (it counts spaces, not levels) — the
 * caller (reachableDestinations with `flyer`) skips this check rather than
 * routing through it. Drake's GRAPPLE GUN waives it up to his level cap via
 * `maxRise` in the engine, also bypassing this helper.
 */
export function canStepUp(hFrom: number, hTo: number, cardHeight: number): boolean {
  const rise = hTo - hFrom;
  if (rise <= 0) return true;
  return rise < cardHeight;
}

/** Optional movement modifiers (slice 4): glyph forced-stops and per-figure
 *  end-restrictions. Omitting `options` keeps the slice-1/3 behaviour exactly. */
export type ReachOptions = {
  /** Hexes carrying a glyph. A glyph is a FORCED STOP (05-glyphs §1): a figure
   *  that MOVES ONTO one must stop there — it is a valid endpoint but never a
   *  pass-through node. (Mirrors water's forced stop.) The glyph's OWN hex is
   *  not a stop for the figure starting on it. */
  glyphHexes?: ReadonlySet<HexKey>;
  /** Per-figure veto on ENDING a move on a hex (e.g. Kelda only admits a
   *  wounded figure). Returns false → the hex is not a legal endpoint, but it
   *  may still be transited if it is otherwise passable. Defaults to allow. */
  canEndOn?: (key: HexKey) => boolean;
  /** DOUBLE-SPACE (2-hex) mover: water is NOT a single-step forced stop and a water→water front
   *  step is allowed — a 2-hex figure only STOPS for water when BOTH lobes are in it, which the
   *  caller decides from the full footprint. (No effect on a flyer, which never water-stops.) */
  doubleSpace?: boolean;
  /**
   * FLYING (slice 7 — Raelin, Mimring; cards.md). A flyer counts spaces, not
   * levels: every step costs 1 (no climb cost), the climb LIMIT is waived
   * (elevation is ignored entirely), water is NOT a forced stop (it may pass
   * through / end on water freely), and it may pass through ANY figure — friend
   * OR enemy — without becoming engaged. It still cannot END on an occupied hex.
   * (Flying over ruins is moot until ruins exist on a map.) Subsumes `ghostWalk`.
   */
  flyer?: boolean;
  /**
   * GHOST WALK (slice 7 — Agent Carr; cards.md "can move through all figures").
   * The ONLY clause: the figure may pass THROUGH enemy figures too (normally
   * only friendlies). Unlike Flying it does NOT ignore elevation, the climb
   * limit, or the water forced-stop — only the pass-through-any-figure rule.
   * Still cannot END on an occupied hex. Ignored when `flyer` is set (Flying
   * already passes any figure).
   */
  ghostWalk?: boolean;
  /** WALLS (owner ruling 2026-06-28): the set of blocked EDGE keys (`wallSetOf`).
   *  A figure can never step across a walled edge (it is impassable like a void),
   *  so a wall on the edge between two hexes splits movement there for EVERY mover
   *  — ground, flyer, or ghost-walker alike (it is a solid barrier, not terrain). */
  walls?: ReadonlySet<string>;
};

/**
 * Every hex a figure may legally END its move on, spending up to `move`
 * movement points under the full slice-3 terrain cost model (03-movement):
 *   • Step cost = 1 + climbed levels (up); 1 for level/descent (free descent).
 *   • Climb limit: cannot step up ≥ `cardHeight` levels at once.
 *   • Water (terrain==='water') is a FORCED STOP (03-movement §5): for a normal
 *     1-hex (small/medium) figure, moving ONTO water immediately ENDS the move —
 *     it is a valid endpoint but you can NEVER continue past it to the land
 *     beyond in the same turn (getting out of the water is a separate turn;
 *     crossing a lake is 1 space per turn). Encoded as a hard stop: a water node
 *     reached mid-move is never expanded (exactly like a glyph). The §6 exception
 *     is `options.doubleSpace` (a 2-hex figure): its FRONT lobe may BRIDGE a
 *     single water hex, so it still expands water→non-water and only stops when
 *     BOTH lobes are water (the caller decides that from the full footprint); it
 *     just never chains water→water.
 *   • Glyphs (slice 4, via `options.glyphHexes`) are a FORCED STOP too — a
 *     valid endpoint that is never a pass-through node.
 *   • Voids are absent cells (impassable). May pass THROUGH friendly figures,
 *     never through enemies; may never END on any occupied hex.
 *
 * Costs vary per edge, so this is a uniform-cost (Dijkstra) search keyed on the
 * cheapest cost to reach each hex. Pure; the engine and the board both call it.
 *
 * `heightOf`/`cardHeight` are optional: omitting them (slice-1/flat callers)
 * reads height from the cell record and applies no climb limit, so on an
 * all-height-1 map every step costs 1 and the result matches the old BFS.
 *
 * slice 7 (cards.md): `options.flyer` makes the search ignore elevation
 * entirely (flat 1/hex cost, no climb limit, no water forced-stop) and pass
 * through ANY figure (friend or enemy); `options.ghostWalk` adds ONLY the
 * pass-through-enemies clause (climb cost/limit and water stop still apply). A
 * flyer/ghost still cannot END on an occupied hex. This is the SINGLE source of
 * reachability — the board highlight and the engine validation both call it, so
 * a flyer lights up cliffs/water in the UI exactly where the engine permits.
 */
/** A WALL PILLAR is a reserved height-15 rock hex (the map generators use 15 for impassable cover;
 *  real terrain tops out ~7). NOBODY lands on one — walkers can't climb it, and a flyer flies OVER
 *  it but may not STOP on it; The Drop can't deploy onto it either. They read as pointy spikes on
 *  the board. Owner ruling 2026-06-30 ("make the walls pointy, I don't want anyone landing on them"). */
export const WALL_PILLAR_HEIGHT = 15;
export function isWallPillar(cell?: HexCell | null): boolean {
  return !!cell && cell.height >= WALL_PILLAR_HEIGHT;
}

export function reachableDestinations(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  move: number,
  occupancyOf: (key: HexKey) => Occupancy,
  cardHeight = Infinity,
  options: ReachOptions = {},
): Set<HexKey> {
  const out = new Set<HexKey>();
  if (!cells[from] || move <= 0) return out;
  const heightAt = (key: HexKey) => cells[key]?.height ?? 0;
  // slice 7: a flyer counts spaces, not levels — it ignores elevation entirely
  // (flat cost, no climb limit) and treats water as ordinary terrain (no forced
  // stop). Ghost Walk gains only the pass-through-enemies clause.
  const flyer = !!options.flyer;
  const ghostWalk = flyer || !!options.ghostWalk; // Flying already passes any figure
  const doubleSpace = !!options.doubleSpace; // a 2-hex figure may BRIDGE a single water hex (§6)
  // Water forces a stop only for a non-flyer (a flyer flies over water freely).
  const isWater = (key: HexKey) => !flyer && cells[key]?.terrain === 'water';
  const glyphHexes = options.glyphHexes;
  const canEndOn = options.canEndOn;
  // A glyph the MOVER did not start on forces a stop on entry. A flyer is NOT
  // stopped by terrain water, but a glyph forced-stop still applies (the glyph
  // rule is not an elevation/water clause Flying overrides).
  const isGlyphStop = (key: HexKey) => key !== from && !!glyphHexes?.has(key);

  // Cheapest known movement cost to reach each hex (uniform-cost search).
  const best = new Map<HexKey, number>([[from, 0]]);
  // A tiny binary-heap-free frontier: we re-scan since maps are small (<100
  // hexes) — pop the lowest-cost unsettled node each iteration.
  const settled = new Set<HexKey>();
  for (;;) {
    let cur: HexKey | null = null;
    let curCost = Infinity;
    for (const [k, c] of best) {
      if (!settled.has(k) && c < curCost) {
        cur = k;
        curCost = c;
      }
    }
    if (cur == null) break;
    settled.add(cur);
    if (curCost >= move) continue; // no budget left to step further from here

    // Water forces a stop: a figure standing on water may only step OFF it to
    // a non-water hex (never water→water). From any non-water hex, all six
    // neighbours are candidates. A glyph hex is a forced stop the same way —
    // having reached one, the figure cannot step further from it.
    const curIsWater = cur !== from && isWater(cur);
    const curIsGlyph = isGlyphStop(cur);
    if (curIsGlyph) continue; // movement ended here; do not expand past a glyph
    // Water FORCED STOP (03-movement §5): a 1-hex figure that moved ONTO water ends its move — it can
    // never continue to the land beyond this turn (getting out is a separate turn). Treat it exactly
    // like a glyph: a valid endpoint that is never expanded. A double-space figure is the §6 exception
    // (its front lobe may bridge a single water hex), so it still expands below — water→non-water only.
    if (curIsWater && !doubleSpace) continue;
    for (const n of neighborKeys(cur)) {
      if (!cells[n]) continue; // void / off-map
      if (options.walls && options.walls.has(edgeKey(cur, n))) continue; // a wall severs this edge — impassable
      if (curIsWater && isWater(n)) continue; // double-space: never chain water→water in one move
      const occ = occupancyOf(n);
      // Enemy-occupied hexes block transit normally, but Ghost Walk / Flying may
      // pass THROUGH them (cards.md). They still can't be an ENDPOINT — see below.
      if (occ === 'enemy' && !ghostWalk) continue; // never through (or onto) enemies
      const hFrom = heightAt(cur);
      const hTo = heightAt(n);
      // slice 7: a flyer ignores the climb limit (it counts spaces, not levels).
      if (!flyer && !canStepUp(hFrom, hTo, cardHeight)) continue; // climb limit
      // slice 7: a flyer pays a flat 1 per hex (no climb cost); everyone else
      // pays 1 + climbed levels.
      const cost = curCost + (flyer ? 1 : stepCost(hFrom, hTo));
      if (cost > move) continue; // no partial climbs — full step must be payable
      if (cost < (best.get(n) ?? Infinity)) {
        best.set(n, cost);
        settled.delete(n); // found a cheaper route — allow re-expansion
      }
      // May only END on an empty hex (friend OR foe block the endpoint — even a
      // flyer/ghost that PASSED THROUGH cannot land on an occupied hex); never
      // "end" back on the start hex (staying put is not a move); and a
      // per-figure end-restriction (Kelda) can still veto an otherwise-legal
      // endpoint.
      // A flyer can PASS OVER a wall pillar (it's expanded above) but never STOPS on one — no one lands
      // on a wall. Walkers can't climb height-15 anyway, so this only bites flyers.
      if (occ === null && n !== from && !isWallPillar(cells[n]) && (!canEndOn || canEndOn(n))) out.add(n);
    }
  }
  return out;
}

/**
 * The cheapest LEGAL route from `from` to `to` (inclusive at both ends), or null if `to` is not
 * reachable. Same terrain cost model as `reachableDestinations` (climb cost/limit, water + glyph
 * forced-stops, walls, flyer/ghost), so the route never crosses a hex border a real move couldn't —
 * used by the board to ANIMATE a multi-hex move along the path the figure would actually walk
 * (around water/walls) instead of a straight line that cuts through them. Occupancy is ignored (the
 * move's legality was already validated by the engine; this only needs a plausible terrain route).
 */
export function shortestPath(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  to: HexKey,
  cardHeight = Infinity,
  options: ReachOptions = {},
): HexKey[] | null {
  if (from === to) return [from];
  if (!cells[from] || !cells[to]) return null;
  const flyer = !!options.flyer;
  const doubleSpace = !!options.doubleSpace;
  const isWater = (k: HexKey) => !flyer && cells[k]?.terrain === 'water';
  const glyphHexes = options.glyphHexes;
  const walls = options.walls;
  const isGlyphStop = (k: HexKey) => k !== from && !!glyphHexes?.has(k);
  const best = new Map<HexKey, number>([[from, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const settled = new Set<HexKey>();
  for (;;) {
    let cur: HexKey | null = null;
    let curCost = Infinity;
    for (const [k, c] of best) if (!settled.has(k) && c < curCost) { cur = k; curCost = c; }
    if (cur == null) return null;
    settled.add(cur);
    if (cur === to) {
      const path: HexKey[] = [cur];
      let p: HexKey = cur;
      while (prev.has(p)) { p = prev.get(p)!; path.push(p); }
      return path.reverse();
    }
    const curIsWater = cur !== from && isWater(cur);
    if (isGlyphStop(cur)) continue; // a glyph is a forced stop — never path past it
    if (curIsWater && !doubleSpace) continue; // 1-hex: water is a hard stop — route around it
    for (const n of neighborKeys(cur)) {
      if (!cells[n]) continue; // void
      if (walls && walls.has(edgeKey(cur, n))) continue; // a wall severs this edge
      if (curIsWater && isWater(n)) continue; // double-space: never chain water→water
      const hFrom = cells[cur].height, hTo = cells[n].height;
      if (!flyer && !canStepUp(hFrom, hTo, cardHeight)) continue; // climb limit
      const cost = curCost + (flyer ? 1 : stepCost(hFrom, hTo));
      if (cost < (best.get(n) ?? Infinity)) { best.set(n, cost); prev.set(n, cur); settled.delete(n); }
    }
  }
}

/** ONE step of a hand-traced DRAG path (the HeroQuest-style movement input).
 *  Given the figure's START hex, the path's current last hex `prev`, and a
 *  candidate next hex `to`, returns that step's movement cost and whether `to` is a
 *  FORCED STOP (water / glyph) — or null if the step is illegal. Reuses the SAME
 *  primitives as reachableDestinations (stepCost / canStepUp / water-transit ban /
 *  enemy block / flyer / ghostWalk) so a hand-traced route can never diverge from
 *  engine legality. Transit THROUGH a friendly is allowed (matching
 *  reachableDestinations); the caller enforces that the FINAL hex is a legal
 *  ENDPOINT (empty + present in reachableDestinations). The running cost ≤ Move and
 *  the forced-stop flag (no extending past it) are the caller's to accumulate. */
export function dragStep(
  cells: Record<HexKey, HexCell>,
  start: HexKey,
  prev: HexKey,
  to: HexKey,
  occupancyOf: (key: HexKey) => Occupancy,
  cardHeight = Infinity,
  options: ReachOptions = {},
): { cost: number; forcedStop: boolean } | null {
  if (!cells[prev] || !cells[to]) return null;
  if (!neighborKeys(prev).includes(to)) return null; // must be an adjacent hex
  if (options.walls && options.walls.has(edgeKey(prev, to))) return null; // a wall severs this edge — impassable
  const flyer = !!options.flyer;
  const ghostWalk = flyer || !!options.ghostWalk;
  const huge = !!options.doubleSpace; // a 2-hex mover: water-stop is the caller's call (both lobes)
  const isWater = (k: HexKey) => !flyer && cells[k]?.terrain === 'water';
  if (!huge && prev !== start && isWater(prev) && isWater(to)) return null; // 1-hex: no water→water transit
  const occ = occupancyOf(to);
  if (occ === 'enemy' && !ghostWalk) return null; // can't step onto / through an enemy
  const hFrom = cells[prev]?.height ?? 0;
  const hTo = cells[to]?.height ?? 0;
  if (!flyer && !canStepUp(hFrom, hTo, cardHeight)) return null; // climb limit
  const cost = flyer ? 1 : stepCost(hFrom, hTo);
  const forcedStop = (!huge && isWater(to)) || (to !== start && !!options.glyphHexes?.has(to));
  return { cost, forcedStop };
}

// ============================================================================
// Pixel-space geometry (LOS + rendering)
// ============================================================================

export type Pixel = { x: number; y: number };

const SQRT3 = Math.sqrt(3);

/** Center of a hex in unit-size pixel space (pointy-top, size 1, y down). */
export function hexToPixel(key: HexKey): Pixel {
  const { q, r } = parseHexKey(key);
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/** The 6 corners of a pointy-top hex, optionally scaled toward its center. */
export function hexCorners(center: Pixel, size = 1, scale = 1): Pixel[] {
  const out: Pixel[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    out.push({
      x: center.x + size * scale * Math.cos(angle),
      y: center.y + size * scale * Math.sin(angle),
    });
  }
  return out;
}

/** LOS-blocking hexagons are shrunk a hair so a sight line that only grazes a
 *  corner — or slides exactly along a shared edge — does NOT block. The line
 *  must pass through the hex INTERIOR to block. */
const LOS_HEX_SCALE = 0.9999;

/**
 * True iff the segment a→b passes through the interior of the (slightly
 * shrunken) hex centered at `center`. Implemented as a parametric clip of the
 * segment against the hexagon's six inner half-planes: a non-degenerate
 * leftover interval means the segment crosses the interior.
 */
export function segmentCrossesHex(a: Pixel, b: Pixel, center: Pixel): boolean {
  const poly = hexCorners(center, 1, LOS_HEX_SCALE);
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < 6; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % 6];
    // Edge normal, oriented inward (toward the hex center).
    let nx = -(q.y - p.y);
    let ny = q.x - p.x;
    if (nx * (center.x - p.x) + ny * (center.y - p.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const denom = nx * dx + ny * dy;
    const startDist = nx * (a.x - p.x) + ny * (a.y - p.y);
    if (Math.abs(denom) < 1e-12) {
      if (startDist < 0) return false; // parallel to this edge, fully outside
      continue;
    }
    const t = -startDist / denom;
    if (denom > 0) t0 = Math.max(t0, t); // entering the half-plane
    else t1 = Math.min(t1, t); // exiting it
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-9;
}

/** Do segments p1p2 and p3p4 PROPERLY cross (interiors intersect)? Touching at an
 *  endpoint or running collinear returns false — same grazing-is-fine leniency the
 *  rest of LOS uses. Standard orientation (CCW) test. */
function segmentsCross(p1: Pixel, p2: Pixel, p3: Pixel, p4: Pixel): boolean {
  const ccw = (a: Pixel, b: Pixel, c: Pixel) => (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  const d1 = ccw(p3, p4, p1), d2 = ccw(p3, p4, p2), d3 = ccw(p1, p2, p3), d4 = ccw(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The pixel segment of the WALL on the edge between two adjacent hexes: the shared
 *  edge is perpendicular to the line of centres, centred at their midpoint, with the
 *  hex side-length (1 in unit space) — so half-length 0.5 each way. */
function wallSegment(a: HexKey, b: HexKey): [Pixel, Pixel] {
  const pa = hexToPixel(a), pb = hexToPixel(b);
  const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
  let dx = pb.x - pa.x, dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const px = -dy * 0.5, py = dx * 0.5; // perpendicular, half a side length
  return [{ x: mx + px, y: my + py }, { x: mx - px, y: my - py }];
}

/** Does the centre-to-centre sightline cross any WALL segment? Walls are full-height,
 *  so they block line of sight regardless of either figure's elevation. */
export function sightCrossesWall(
  from: HexKey,
  to: HexKey,
  wallEdges: ReadonlyArray<readonly [HexKey, HexKey]>,
): boolean {
  const a = hexToPixel(from), b = hexToPixel(to);
  for (const [wa, wb] of wallEdges) {
    const [e1, e2] = wallSegment(wa, wb);
    if (segmentsCross(a, b, e1, e2)) return true;
  }
  return false;
}

/**
 * Slice-1 line of sight: a straight line between the two hex CENTERS, blocked
 * only when it crosses the interior of a hex occupied by another figure
 * (friendly or enemy). The attacker's own hex and the target's hex never
 * block — exclude them from `occupiedKeys` or rely on the guard below.
 *
 * Documented slice-1 simplification: the full game sights from a 3-D Target
 * Point to any part of the defender's Hit Zone, and intervening figures only
 * block when they hide the ENTIRE Hit Zone (04-combat §LOS). With flat
 * terrain and abstract discs, slice 1 approximates that with the
 * center-to-center line; grazing a corner or sliding along a hex edge does
 * not block (lenient targeting, mirroring HeroQuest's philosophy).
 */
export function hasLineOfSight(
  from: HexKey,
  to: HexKey,
  occupiedKeys: Iterable<HexKey>,
): boolean {
  const a = hexToPixel(from);
  const b = hexToPixel(to);
  for (const key of occupiedKeys) {
    if (key === from || key === to) continue;
    if (segmentCrossesHex(a, b, hexToPixel(key))) return false;
  }
  return true;
}

/**
 * Parametric position (0..1) of the foot of the perpendicular from a point `p`
 * onto the segment a→b — i.e. how far along the line the point projects.
 */
function projectParam(a: Pixel, b: Pixel, p: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

/**
 * Slice-3 ELEVATION-AWARE line of sight (04-combat §LOS; ARCHITECTURE §7). A
 * straight line is drawn between the two figures' EYE points; it is blocked
 * when either:
 *   • an intervening hex's terrain COLUMN rises into the line — its tile-stack
 *     height ≥ the interpolated sightline height at that hex AND ≥ both
 *     endpoints' eye heights (a tall rock between two low figures blocks; equal
 *     columns see over a low one), or
 *   • an intervening hex is occupied by another figure (as in the flat slice-2
 *     model — bodies still block).
 *
 * Eye height of a figure = its cell height + 1 (a small constant so a figure on
 * a taller column sees over a shorter one — `eyeOf` supplies it). This is a
 * deterministic APPROXIMATION of the tabletop Target-Point→Hit-Zone 3-D line
 * (documented slice-3 simplification); grazing a corner / sliding an edge stays
 * non-blocking, and the two directions are computed independently (a figure on
 * a hill may see into a pit it could not see out of — asymmetry is fine).
 */
export function hasLineOfSight3D(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  to: HexKey,
  occupiedKeys: Iterable<HexKey>,
  eyeOf: (key: HexKey) => number,
  wallEdges?: ReadonlyArray<readonly [HexKey, HexKey]>,
): boolean {
  const a = hexToPixel(from);
  const b = hexToPixel(to);
  const eyeFrom = eyeOf(from);
  const eyeTo = eyeOf(to);

  // A WALL on any crossed edge blocks the shot outright (full-height barrier).
  if (wallEdges && wallEdges.length > 0 && sightCrossesWall(from, to, wallEdges)) return false;

  // Figures block exactly as in the flat model.
  for (const key of occupiedKeys) {
    if (key === from || key === to) continue;
    if (segmentCrossesHex(a, b, hexToPixel(key))) return false;
  }

  // Terrain columns block when they rise into the interpolated sightline.
  for (const key in cells) {
    if (key === from || key === to) continue;
    const c = hexToPixel(key);
    if (!segmentCrossesHex(a, b, c)) continue;
    const colH = cells[key].height;
    // The line's height directly above this hex's center.
    const t = Math.max(0, Math.min(1, projectParam(a, b, c)));
    const lineH = eyeFrom + (eyeTo - eyeFrom) * t;
    // Block only if the column rises STRICTLY above the sightline at this hex.
    // A column merely level with the line just grazes the top edge — that does
    // NOT block (mirrors the grazing-corner leniency of the flat model, and
    // makes a hill no taller than either viewer transparent: lineH is always
    // between the two eye heights, so a column ≤ both eyes can never out-top
    // it). EPS guards against floating-point error at exact equality.
    if (colH > lineH + 1e-9) return false;
  }
  return true;
}

// ============================================================================
// Engagement (03-movement §8) + falling (03-movement §4)
// ============================================================================

/**
 * Are two figures ENGAGED? (03-movement §8, Example 14.) Engagement is pure
 * geometry — no token. Two figures are engaged iff they stand on hex-adjacent
 * cells AND the elevation exception does not break adjacency:
 *
 *   adjacency is BROKEN when one figure's base level is ≥ the OTHER figure's
 *   Height number (Ex. 14: Deathwalker's ledge is 5 levels, equal to Finn's
 *   Height 5 → NOT adjacent). Equality breaks it.
 *
 * So engaged iff: hexAdjacent AND NOT (hHi ≥ heightLo) where hHi is the higher
 * base level and heightLo is the Height of the figure standing lower. Concretely
 * the gap must be strictly LESS than the lower figure's Height.
 *
 * (The ruin-between exception (§8 exc. 2) needs ruin pieces — out of scope until
 * ruins exist on a map; documented omission.)
 */
export function areEngaged(
  aKey: HexKey,
  aHeightStat: number,
  bKey: HexKey,
  bHeightStat: number,
  heightAt: (key: HexKey) => number,
  walls?: ReadonlySet<string>,
): boolean {
  if (aKey === bKey) return false;
  if (hexDistance(aKey, bKey) !== 1) return false;
  // A WALL on the shared edge severs adjacency entirely (the §8 exc. 2 "ruin between"
  // case): the two figures are not engaged — no melee, no leaving-engagement swipe.
  if (walls && walls.has(edgeKey(aKey, bKey))) return false;
  const ha = heightAt(aKey);
  const hb = heightAt(bKey);
  // Whoever stands LOWER — their Height stat gates the elevation exception.
  const lowerHeightStat = ha <= hb ? aHeightStat : bHeightStat;
  const gap = Math.abs(ha - hb);
  return gap < lowerHeightStat;
}

export type FallTier = 'none' | 'fall' | 'major' | 'extreme';

/**
 * Falling check (03-movement §4; banded thresholds resolved in
 * 99-open-questions §4). When a figure ends a step on a cell `drop` levels
 * BELOW the cell it left, with card Height `cardHeight`:
 *   • drop ≥ Height            → Fall    (roll 1 combat die; 1 wound/skull)
 *   • (drop − Height) ≥ 10     → Major   (roll 3 combat dice total)
 *   • (drop − Height) ≥ 20     → Extreme (roll d20; 19-20 unharmed, else destroyed)
 * Bands read on drop − Height. `intoWater` exempts the fall entirely (a figure
 * may drop onto water from any level safely).
 *
 * Returns the tier and the number of COMBAT dice the server must roll (0 for
 * none/extreme — extreme uses a d20 instead, signalled by tier === 'extreme').
 *
 * slice 7: a FLYER takes NO fall — it descends, it does not fall (cards.md). The
 * caller (moveConsequences) returns tier 'none' for a flyer without calling
 * this; for non-flyers it computes the band exactly as before.
 */
export function computeFall(
  drop: number,
  cardHeight: number,
  intoWater: boolean,
): { tier: FallTier; dice: number } {
  if (intoWater || drop < cardHeight) return { tier: 'none', dice: 0 };
  const over = drop - cardHeight;
  if (over >= 20) return { tier: 'extreme', dice: 0 };
  if (over >= 10) return { tier: 'major', dice: 3 };
  return { tier: 'fall', dice: 1 };
}

// ============================================================================
// 2.5D ISOMETRIC projection (renderer only — docs/heroscape/slice-iso-spec.md)
// ============================================================================
//
// A pure, drop-in projection over the SAME data the flat renderer uses: it maps
// an axial (q, r) cell at a given `height` to a 2.5D "tilted-camera" anchor and
// builds the hex-PRISM geometry (top hexagon + the front side-face quads) plus
// the back-to-front draw order and the whole-scene bounds. Everything stays in
// UNIT space here (a tile is `size 1`); the component scales by its pixel HEX
// and applies the per-viewer 180° flip BEFORE calling these — exactly as the
// flat board flips hex CENTERS — so the iso math and the engine read one source.
//
// Projection (affine ground plane + vertical lift):
//   1. YAW — rotate the flat pointy-top center `hexToPixel` about the origin by
//      `ISO_ROTATE_DEG` (the "camera angle"). 0° = head-on (rows recede straight
//      up the screen); 45° = classic corner-on isometric, where BOTH axes recede
//      and two faces of every column show.
//   2. SQUASH — compress the result vertically by `ISO_SQUASH` so the ground
//      reads as receding under a tilted camera.
//   3. LIFT — raise the top face up the screen (−y) by `height * ISO_LEVEL_H`,
//      the column depth.
// Steps 1–2 are a single AFFINE map, and affine maps send a tiling to a tiling,
// so the projected top hexagons still abut perfectly edge-to-edge — no seams —
// at ANY yaw. (This generalises the original pure-squash variant; the spec's
// literal `(q-r, q+r)` is simply the yaw=45° special case of the rotation.)

/** Camera YAW (degrees) applied to the ground plane before the vertical squash —
 *  the "turn the camera" knob. 0 = head-on; 45 = corner-on isometric. */
export const ISO_ROTATE_DEG = 45;
/** Vertical squash of the ground plane (0..1): smaller = more "tilted" / flatter
 *  tiles. ~0.55 reads as receding ground without losing the hex shape. */
export const ISO_SQUASH = 0.56;
/** Pixel rise (in unit-size space, before the component's HEX scale) per ONE
 *  level of terrain height — the depth of a column's side faces. */
export const ISO_LEVEL_H = 0.62;

const ISO_ROT = (Math.PI / 180) * ISO_ROTATE_DEG;
const ISO_COS = Math.cos(ISO_ROT);
const ISO_SIN = Math.sin(ISO_ROT);

/** Project a flat unit pixel onto the iso ground plane: yaw-rotate, then squash
 *  vertically. (No height lift — the callers add that.) Affine, so it preserves
 *  the hex tiling (shared edges stay shared) at any yaw. */
function isoProjectFlat(p: Pixel): Pixel {
  const rx = p.x * ISO_COS - p.y * ISO_SIN;
  const ry = p.x * ISO_SIN + p.y * ISO_COS;
  return { x: rx, y: ry * ISO_SQUASH };
}

/**
 * Iso TOP-FACE center (anchor) for a cell, in unit space. This is where the
 * figure stands and the highlight/badge sit. Lifted UP the screen (−y) by the
 * column height so a taller tile floats above its footprint.
 */
export function isoTopCenter(key: HexKey, height: number): Pixel {
  const g = isoProjectFlat(hexToPixel(key));
  return { x: g.x, y: g.y - height * ISO_LEVEL_H };
}

/** The footprint center on the BASE plane (height 0) — where a column's bottom
 *  sits. Used for the side-face quads and the scene's lower bound. */
export function isoBaseCenter(key: HexKey): Pixel {
  return isoProjectFlat(hexToPixel(key));
}

/**
 * The six corners of a cell's iso TOP hexagon, in unit space, ordered the same
 * as `hexCorners` (k=0 is the right-ish vertex, going clockwise in screen
 * space). It is the cell's real pointy-top hexagon projected through the camera
 * yaw + vertical squash and lifted by height — so it still tiles with its
 * neighbours' tops at any yaw. `scale` shrinks it toward the center (e.g. for a
 * slightly inset highlight), mirroring `hexCorners`.
 */
export function isoTopHexCorners(key: HexKey, height: number, scale = 1): Pixel[] {
  const flatC = hexToPixel(key);
  const lift = height * ISO_LEVEL_H;
  // Project each flat corner through the SAME affine as the centers, then lift,
  // so the top face is the genuine projected hexagon (not an axis-aligned
  // approximation) and shares its edges with the neighbouring tops.
  const out: Pixel[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 180) * (60 * k - 30);
    const g = isoProjectFlat({
      x: flatC.x + scale * Math.cos(angle),
      y: flatC.y + scale * Math.sin(angle),
    });
    out.push({ x: g.x, y: g.y - lift });
  }
  return out;
}

/**
 * A column side face (one quad) for the prism: the FRONT-facing top edges
 * dropped straight down to the base by `height * ISO_LEVEL_H`. Each face is
 * `{ pts: [topA, topB, baseB, baseA], shade }` where `shade` is a 0..1 form
 * factor (left faces darker than right) the renderer multiplies into the
 * terrain color. Only edges whose midpoint faces the viewer (lower half of the
 * squashed hex, screen-y ≥ center) get a wall — the back edges are hidden, so
 * we skip them (fewer polygons, correct overlap). A height-0/water tile yields
 * NO faces (flat top, no column).
 */
export type IsoSideFace = { pts: Pixel[]; shade: number };

export function isoSideFaces(key: HexKey, height: number): IsoSideFace[] {
  if (height <= 0) return [];
  const top = isoTopHexCorners(key, height);
  const drop = height * ISO_LEVEL_H;
  const center = isoTopCenter(key, height);
  const faces: IsoSideFace[] = [];
  for (let k = 0; k < 6; k++) {
    const a = top[k];
    const b = top[(k + 1) % 6];
    // FRONT edge = its midpoint sits at or below the tile center on screen
    // (the viewer looks slightly down, so the lower rim is the visible wall).
    const midY = (a.y + b.y) / 2;
    if (midY < center.y - 1e-9) continue; // back edge — hidden, skip
    const baseA = { x: a.x, y: a.y + drop };
    const baseB = { x: b.x, y: b.y + drop };
    // Directional shading so the prism reads as 3-D: faces on the LEFT of the
    // tile are darker (in shadow), the front-bottom is mid, RIGHT faces are
    // lightest (catching the light). Keyed on the face's average x relative to
    // the tile center → a smooth 0.52 (left) … 0.82 (right). Multiplied into the
    // terrain color by the renderer.
    const faceX = (a.x + b.x) / 2 - center.x;
    const t = Math.max(-1, Math.min(1, faceX / 0.866)); // −1 (far left)…+1 (far right)
    const shade = 0.67 + t * 0.15;
    faces.push({ pts: [a, b, baseB, baseA], shade });
  }
  return faces;
}

/**
 * Back-to-front PAINTER's-ORDER key for a cell, given its FLIPPED axial (the
 * component flips (q, r) for the viewer before calling). Cells are drawn in
 * ascending order of this key so nearer/taller tiles paint over farther ones:
 * sort by the cell's projected BASE-plane screen depth first (farther tiles sit
 * higher on screen, smaller y), then by `height` (a tall column at the same
 * footprint draws after a short one behind it). Returns a single comparable
 * number; ties are fine (same footprint+height never overlap). The figure draws
 * right after its tile.
 */
export function isoDrawOrderKey(q: number, r: number, height: number): number {
  // Depth = projected base-plane screen-y under the camera yaw + squash, scaled
  // up so it dominates; height is a small tiebreak so a tall column paints after
  // a shorter one directly behind it. Using the projected y (not raw q+r) keeps
  // the order correct at ANY yaw, where both axes recede toward the viewer.
  const baseY = isoProjectFlat(hexToPixel(hexKey(q, r))).y;
  return baseY * 1000 + height;
}

/** Sort cells back-to-front for the painter's algorithm. Pure; returns a new
 *  array. `qrOf` supplies the (already viewer-flipped) axial + height per cell so
 *  the caller controls the flip in ONE place. Stable within equal keys. */
export function isoSortByDepth<T>(
  cells: readonly T[],
  qrOf: (cell: T) => { q: number; r: number; height: number },
): T[] {
  return cells
    .map((cell, i) => ({ cell, i, k: (() => { const { q, r, height } = qrOf(cell); return isoDrawOrderKey(q, r, height); })() }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i))
    .map(e => e.cell);
}

/**
 * Bounds of the whole iso scene in unit space — the union of every tile's TOP
 * hexagon (lifted by its height) AND every column BASE (dropped to height 0) —
 * so the SVG viewBox fits the tallest columns and the lowest footprints. The
 * caller passes the cells with their (already viewer-flipped) keys + heights;
 * this returns `{ minX, minY, maxX, maxY }` BEFORE the HEX scale + padding.
 */
export function isoSceneBounds(
  cells: readonly { key: HexKey; height: number }[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (p: Pixel) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const { key, height } of cells) {
    // Top hexagon corners (highest point of the tile).
    for (const c of isoTopHexCorners(key, height)) eat(c);
    // Column base corners (lowest point) — the top hex dropped to the base.
    const drop = height * ISO_LEVEL_H;
    for (const c of isoTopHexCorners(key, height)) eat({ x: c.x, y: c.y + drop });
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
