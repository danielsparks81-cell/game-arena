import { describe, it, expect } from 'vitest';
import { QUEST1 } from './content';
import { BASE_BOARD } from './board';
import type { Coord } from './types';

// The shared base board + "The Trial" on it. Rooms are walled (walls on every
// line where the colour changes); doors are the openings. Validates geometry,
// that the auto-doors connect every room, and the quest's placements.

const W = QUEST1.width, H = QUEST1.height;
const regionAt = (x: number, y: number) => QUEST1.regions[y]?.[x] ?? '';

function eKey(a: Coord, b: Coord) {
  return (a.y < b.y || (a.y === b.y && a.x < b.x))
    ? `${a.x},${a.y}|${b.x},${b.y}` : `${b.x},${b.y}|${a.x},${a.y}`;
}
const doorEdges = new Set<string>();
for (const d of QUEST1.doors) for (const c of d.crossings) doorEdges.add(eKey(c.a, c.b));

function isWallEdge(ax: number, ay: number, bx: number, by: number) {
  const ra = regionAt(ax, ay), rb = regionAt(bx, by);
  if (ra === rb) return false;
  return ra.startsWith('room_') || rb.startsWith('room_');
}

/** Regions reachable from `from`, crossing room-boundary walls only where a
 *  door exists (doors start closed but can be opened, so they count as paths). */
function reachableRegions(from: Coord): Set<string> {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const regions = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    regions.add(regionAt(cur.x, cur.y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = QUEST1.tiles[ny]?.[nx];
      if (k !== 'floor' && k !== 'stairs') continue;
      // Can't cross a room-boundary wall unless a door bridges that edge.
      if (isWallEdge(cur.x, cur.y, nx, ny) && !doorEdges.has(eKey(cur, { x: nx, y: ny }))) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return regions;
}

describe('heroquest base board', () => {
  it('is 32x23 with many distinct rooms', () => {
    expect(BASE_BOARD.width).toBe(32);
    expect(BASE_BOARD.height).toBe(23);
    expect(BASE_BOARD.rooms.length).toBeGreaterThanOrEqual(8);
    expect(new Set(BASE_BOARD.rooms).size).toBe(BASE_BOARD.rooms.length);
  });

  it('has an entry staircase', () => {
    expect(BASE_BOARD.startCells.length).toBeGreaterThan(0);
    for (const c of BASE_BOARD.startCells) expect(BASE_BOARD.tiles[c.y][c.x]).toBe('stairs');
  });
});

describe('heroquest Quest 1 "The Trial" on the shared board', () => {
  it('uses the shared board geometry', () => {
    expect(QUEST1.width).toBe(BASE_BOARD.width);
    expect(QUEST1.height).toBe(BASE_BOARD.height);
    expect(QUEST1.startCells).toBe(BASE_BOARD.startCells);
  });

  it('makes Verag the gargoyle objective', () => {
    const verag = QUEST1.monsters.find(m => m.displayName === 'Verag');
    expect(verag).toBeTruthy();
    expect(verag!.kind).toBe('gargoyle');
    expect(QUEST1.winCondition).toEqual({ kind: 'kill_and_exit', monsterDisplayName: 'Verag' });
  });

  it('starts heroes on staircase tiles', () => {
    for (const c of QUEST1.startCells) expect(QUEST1.tiles[c.y][c.x]).toBe('stairs');
  });

  it('has edge-doors (each with at least one crossing)', () => {
    expect(QUEST1.doors.length).toBeGreaterThan(0);
    for (const d of QUEST1.doors) {
      expect(d.crossings.length).toBeGreaterThanOrEqual(1);
      for (const c of d.crossings) {
        // Each crossing bridges two orthogonally-adjacent floor cells.
        expect(Math.abs(c.a.x - c.b.x) + Math.abs(c.a.y - c.b.y)).toBe(1);
        expect(QUEST1.tiles[c.a.y][c.a.x]).toBe('floor');
        expect(QUEST1.tiles[c.b.y][c.b.x]).toBe('floor');
      }
    }
  });

  it('connects every room to the entrance through doors', () => {
    const reached = reachableRegions(QUEST1.startCells[0]);
    for (const r of BASE_BOARD.rooms) {
      expect(reached.has(r), `${r} reachable via doors`).toBe(true);
    }
  });

  it('places every monster on a room floor square (region == its roomId)', () => {
    for (const m of QUEST1.monsters) {
      expect(QUEST1.tiles[m.at.y][m.at.x], `${m.id} on floor`).toBe('floor');
      expect(QUEST1.regions[m.at.y][m.at.x], `${m.id} region`).toBe(m.roomId);
      expect(m.roomId.startsWith('room_'), `${m.id} in a room`).toBe(true);
    }
  });

  it('places every furniture cell on a floor square', () => {
    for (const f of QUEST1.furniture) {
      for (const c of f.cells) expect(QUEST1.tiles[c.y][c.x], `${f.id} on floor`).toBe('floor');
    }
  });
});
