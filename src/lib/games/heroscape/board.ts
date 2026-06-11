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
 * slice 4: Flying bypasses this — a flyer counts spaces, not levels, so the
 * climb limit is moot while flying.
 */
export function canStepUp(hFrom: number, hTo: number, cardHeight: number): boolean {
  const rise = hTo - hFrom;
  if (rise <= 0) return true;
  return rise < cardHeight;
}

/**
 * Every hex a figure may legally END its move on, spending up to `move`
 * movement points under the full slice-3 terrain cost model (03-movement):
 *   • Step cost = 1 + climbed levels (up); 1 for level/descent (free descent).
 *   • Climb limit: cannot step up ≥ `cardHeight` levels at once.
 *   • Water (terrain==='water') is a FORCED STOP — you may END on it, and you
 *     may pass THROUGH a single water hex to a non-water hex beyond if budget
 *     remains, but you can never chain water→water as a transit (crossing a
 *     lake is 1 space per turn). Encoded: a water node only ever continues to
 *     NON-water neighbors; reaching a water hex always makes it a valid
 *     endpoint (forced stop).
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
 * slice 4: Flying bypasses the climb cost, climb limit, and water stop.
 */
export function reachableDestinations(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  move: number,
  occupancyOf: (key: HexKey) => Occupancy,
  cardHeight = Infinity,
): Set<HexKey> {
  const out = new Set<HexKey>();
  if (!cells[from] || move <= 0) return out;
  const heightAt = (key: HexKey) => cells[key]?.height ?? 0;
  const isWater = (key: HexKey) => cells[key]?.terrain === 'water';

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
    // neighbours are candidates.
    const curIsWater = cur !== from && isWater(cur);
    for (const n of neighborKeys(cur)) {
      if (!cells[n]) continue; // void / off-map
      if (curIsWater && isWater(n)) continue; // can't transit two waters in a row
      const occ = occupancyOf(n);
      if (occ === 'enemy') continue; // never through (or onto) enemies
      const hFrom = heightAt(cur);
      const hTo = heightAt(n);
      if (!canStepUp(hFrom, hTo, cardHeight)) continue; // climb limit
      const cost = curCost + stepCost(hFrom, hTo);
      if (cost > move) continue; // no partial climbs — full step must be payable
      if (cost < (best.get(n) ?? Infinity)) {
        best.set(n, cost);
        settled.delete(n); // found a cheaper route — allow re-expansion
      }
      // May only END on an empty hex (friend or foe block the endpoint); and
      // never "end" back on the start hex (staying put is not a move).
      if (occ === null && n !== from) out.add(n);
    }
  }
  return out;
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
): boolean {
  const a = hexToPixel(from);
  const b = hexToPixel(to);
  const eyeFrom = eyeOf(from);
  const eyeTo = eyeOf(to);

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
): boolean {
  if (aKey === bKey) return false;
  if (hexDistance(aKey, bKey) !== 1) return false;
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
 * slice 4: Flying bypasses this — a flyer descends, it does not fall.
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
