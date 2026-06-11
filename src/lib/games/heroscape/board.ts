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
 * Every hex a figure may legally END its move on, spending up to `move`
 * spaces at a flat 1 per hex (slice 1 — no climb costs / water stops yet):
 *   • may pass THROUGH friendly figures, never through enemies
 *   • may not END on any occupied hex, friend or foe
 * `occupancyOf` describes every OTHER figure; the caller excludes the mover
 * itself (its own hex is vacated by the move).
 */
export function reachableDestinations(
  cells: Record<HexKey, HexCell>,
  from: HexKey,
  move: number,
  occupancyOf: (key: HexKey) => Occupancy,
): Set<HexKey> {
  const out = new Set<HexKey>();
  if (!cells[from] || move <= 0) return out;
  const dist = new Map<HexKey, number>([[from, 0]]);
  const queue: HexKey[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist.get(cur)!;
    if (d >= move) continue;
    for (const n of neighborKeys(cur)) {
      if (!cells[n] || dist.has(n)) continue;
      const occ = occupancyOf(n);
      if (occ === 'enemy') continue; // never through (or onto) enemies
      dist.set(n, d + 1);
      queue.push(n); // may continue THROUGH a friendly figure
      if (occ === null) out.add(n); // …but may only END on an empty hex
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
