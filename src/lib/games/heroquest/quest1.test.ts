import { describe, it, expect } from 'vitest';
import { QUEST1 } from './content';

// Structural validation of "The Trial" map: correct dimensions, every room
// reachable from the entry staircase, and all monsters/furniture placed on
// valid floor squares inside their declared room.

const ROOM_REGIONS = ['room_c', 'room_f', 'room_d', 'room_t', 'room_e', 'room_g', 'room_a', 'room_b'];

function tileAt(x: number, y: number) {
  return { kind: QUEST1.tiles[y]?.[x], region: QUEST1.regions[y]?.[x] };
}

describe('heroquest Quest 1 "The Trial": structure', () => {
  it('has the expected dimensions and a rectangular tile grid', () => {
    expect(QUEST1.width).toBe(26);
    expect(QUEST1.height).toBe(19);
    expect(QUEST1.tiles.length).toBe(19);
    for (const row of QUEST1.tiles) expect(row.length).toBe(26);
  });

  it('places Verag as the gargoyle quest target', () => {
    const verag = QUEST1.monsters.find(m => m.displayName === 'Verag');
    expect(verag).toBeTruthy();
    expect(verag!.kind).toBe('gargoyle');
    expect(QUEST1.winCondition).toEqual({ kind: 'kill_and_exit', monsterDisplayName: 'Verag' });
  });

  it('starts the heroes on staircase tiles', () => {
    expect(QUEST1.startCells.length).toBe(4);
    for (const c of QUEST1.startCells) {
      expect(tileAt(c.x, c.y).kind).toBe('stairs');
    }
  });

  it('places every monster on a floor square inside its declared room', () => {
    for (const m of QUEST1.monsters) {
      const t = tileAt(m.at.x, m.at.y);
      expect(t.kind, `${m.id} on floor`).toBe('floor');
      expect(t.region, `${m.id} region matches roomId`).toBe(m.roomId);
    }
  });

  it('places every furniture cell on a floor square (never inside rock)', () => {
    for (const f of QUEST1.furniture) {
      for (const c of f.cells) {
        expect(tileAt(c.x, c.y).kind, `${f.id} on floor`).toBe('floor');
      }
    }
  });

  it('never places a monster on a movement-blocking furniture cell', () => {
    const blockers = new Set(
      QUEST1.furniture.filter(f => f.blocksMove).flatMap(f => f.cells.map(c => `${c.x},${c.y}`)),
    );
    for (const m of QUEST1.monsters) {
      expect(blockers.has(`${m.at.x},${m.at.y}`), `${m.id} not on a blocker`).toBe(false);
    }
  });

  it('connects the entry staircase to every room (doors treated as openable)', () => {
    const W = QUEST1.width, H = QUEST1.height;
    const start = QUEST1.startCells[0];
    const seen = new Set<string>([`${start.x},${start.y}`]);
    const queue = [start];
    const reachedRegions = new Set<string>();
    const passable = (x: number, y: number) => {
      const k = QUEST1.tiles[y]?.[x];
      return k === 'floor' || k === 'door' || k === 'stairs';
    };
    while (queue.length) {
      const cur = queue.shift()!;
      const r = QUEST1.regions[cur.y][cur.x];
      if (r) reachedRegions.add(r);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const key = `${nx},${ny}`;
        if (seen.has(key) || !passable(nx, ny)) continue;
        seen.add(key);
        queue.push({ x: nx, y: ny });
      }
    }
    for (const region of ROOM_REGIONS) {
      expect(reachedRegions.has(region), `${region} reachable from entry`).toBe(true);
    }
  });

  it('gives every door a corridor side and a room side', () => {
    expect(QUEST1.doors.length).toBeGreaterThan(0);
    for (const d of QUEST1.doors) {
      const ra = QUEST1.regions[d.a.y][d.a.x];
      const rb = QUEST1.regions[d.b.y][d.b.x];
      expect([ra, rb], `${d.id} bridges corridor + room`).toContain('corridor');
      expect(ra === rb, `${d.id} connects two different regions`).toBe(false);
    }
  });
});
