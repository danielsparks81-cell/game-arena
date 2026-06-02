import { describe, it, expect } from 'vitest';
import { QUEST1 } from './content';
import { BASE_BOARD } from './board';

// The shared base board + "The Trial" laid out on it. Validates board geometry
// (dimensions, rooms, staircase, full connectivity) and the quest's placements
// (Verag objective, monsters inside rooms, furniture on floor, starts on stairs).

function passable(x: number, y: number) {
  const k = QUEST1.tiles[y]?.[x];
  return k === 'floor' || k === 'door' || k === 'stairs';
}

function reachableRegions(from: { x: number; y: number }): Set<string> {
  const W = QUEST1.width, H = QUEST1.height;
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const regions = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const r = QUEST1.regions[cur.y][cur.x];
    if (r) regions.add(r);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !passable(nx, ny)) continue;
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
    expect(BASE_BOARD.rooms.length).toBeGreaterThanOrEqual(12);
    // No duplicate room ids.
    expect(new Set(BASE_BOARD.rooms).size).toBe(BASE_BOARD.rooms.length);
  });

  it('has an entry staircase', () => {
    expect(BASE_BOARD.startCells.length).toBeGreaterThan(0);
    for (const c of BASE_BOARD.startCells) {
      expect(BASE_BOARD.tiles[c.y][c.x]).toBe('stairs');
    }
  });

  it('connects the staircase to every room', () => {
    const reached = reachableRegions(BASE_BOARD.startCells[0]);
    for (const r of BASE_BOARD.rooms) {
      expect(reached.has(r), `${r} reachable from the entrance`).toBe(true);
    }
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
    for (const c of QUEST1.startCells) {
      expect(QUEST1.tiles[c.y][c.x]).toBe('stairs');
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
      for (const c of f.cells) {
        expect(QUEST1.tiles[c.y][c.x], `${f.id} on floor`).toBe('floor');
      }
    }
  });

  it('places each monster in a room reachable from the entrance', () => {
    const reached = reachableRegions(QUEST1.startCells[0]);
    for (const m of QUEST1.monsters) {
      expect(reached.has(m.roomId), `${m.id}'s room reachable`).toBe(true);
    }
  });
});
