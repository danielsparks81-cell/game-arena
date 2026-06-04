// The shared HeroQuest dungeon board.
//
// Every quest is laid out on this ONE fixed geometry — the rooms, the
// double-wide halls between them, and the entry staircase. Quests differ only
// in their monsters, furniture, traps, doors, and objective (see content.ts).
//
// Glyphs:
//   #  solid rock        .  hall / corridor floor       S  entry staircase
//   a..h  room floor — each *contiguous block of one letter* becomes a
//         distinct room (room_1, room_2, …). Repeated colours in different
//         places are different rooms.

import type { TileKind, Coord } from './types';

export const BOARD_W = 32;
export const BOARD_H = 23;

// Quest 1 "The Trial" board, reproducing the Quest Book's arrangement with our
// larger rooms + double-wide halls: the entrance room 'h' is lower-left with the
// staircase in its UPPER-LEFT corner and its only door on the BOTTOM (to the
// bottom hallway); Verag's chamber 'e' is central; the right ~third is solid
// rock for this quest. Validated for connectivity (every room reachable).
const BOARD_MAP: string[] = [
  '################################', // 0
  '#.aaaaaa..bbbbbb..cccccc..######', // 1   a=upper-left  b=mummy/tomb  c=tomb/84g
  '#.aaaaaa..bbbbbb..cccccc..######', // 2
  '#.aaaaaa..bbbbbb..cccccc..######', // 3
  '#.aaaaaa..bbbbbb..cccccc..######', // 4
  '#.aaaaaa..bbbbbb..cccccc..######', // 5
  '#.........................######', // 6   (mid hall)
  '#.dddddd..eeeeeeee..ffff..######', // 7   d=throne  e=VERAG/120g  f=side room
  '#.dddddd..eeeeeeee..ffff..######', // 8
  '#.dddddd..eeeeeeee..ffff..######', // 9
  '#.dddddd..eeeeeeee..ffff..######', // 10
  '#.........eeeeeeee........######', // 11
  '#.######..................######', // 12  (mid hall; entrance top walled off)
  '##SShhhh#.iiiiii..jjjjjj..######', // 13  h=entrance (stairs UL)  i=A/rack  j=B/chest
  '##SShhhh#.iiiiii..jjjjjj..######', // 14
  '##hhhhhh#.iiiiii..jjjjjj..######', // 15
  '##hhhhhh#.iiiiii..jjjjjj..######', // 16
  '##hhhhhh#.iiiiii..jjjjjj..######', // 17
  '##hhhhhh#.iiiiii..jjjjjj..######', // 18  (entrance opens ONLY at the bottom ↓)
  '#.........................######', // 19  (bottom hallway)
  '#.........................######', // 20
  '################################', // 21
  '################################', // 22
];

export type BaseBoard = {
  width: number;
  height: number;
  tiles: TileKind[][];
  regions: string[][];
  /** All room region ids present on the board (room_1 … room_N). */
  rooms: string[];
  /** Hero entry squares (the staircase). */
  startCells: { x: number; y: number }[];
};

const ROOM_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

/** Parse the ASCII board into tiles + regions, flood-filling each contiguous
 *  block of one room letter into a distinct room_N region. */
export function buildBaseBoard(): BaseBoard {
  const W = BOARD_W, H = BOARD_H;
  const tiles: TileKind[][] = Array.from({ length: H }, () => new Array<TileKind>(W).fill('wall'));
  const regions: string[][] = Array.from({ length: H }, () => new Array<string>(W).fill(''));
  const letter: string[][] = Array.from({ length: H }, () => new Array<string>(W).fill(''));
  const startCells: { x: number; y: number }[] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = BOARD_MAP[y][x] ?? '#';
      if (ch === '.') { tiles[y][x] = 'floor'; regions[y][x] = 'corridor'; }
      // Stairs are walkable + flagged as a start/exit; their REGION is assigned
      // after flood-fill so they join the entrance room they sit in (heroes then
      // start "in a room" that reveals on turn 1).
      else if (ch === 'S') { tiles[y][x] = 'stairs'; startCells.push({ x, y }); }
      else if (ROOM_LETTERS.has(ch)) { tiles[y][x] = 'floor'; letter[y][x] = ch; }
      // '#' (and anything else) stays a wall.
    }
  }

  // Flood-fill same-letter contiguous blocks into distinct rooms.
  const rooms: string[] = [];
  let roomN = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!letter[y][x] || regions[y][x]) continue;
      const ch = letter[y][x];
      const id = `room_${++roomN}`;
      rooms.push(id);
      // BFS the connected same-letter cells.
      const queue: Array<{ x: number; y: number }> = [{ x, y }];
      regions[y][x] = id;
      while (queue.length) {
        const c = queue.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = c.x + dx, ny = c.y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (letter[ny][nx] === ch && !regions[ny][nx]) {
            regions[ny][nx] = id;
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }
  }

  // Assign the stair cluster to the room it sits in, so the heroes begin "in a
  // room" (the entrance room) rather than bare corridor. Fall back to a distinct
  // 'stairway' region if the stairs aren't enclosed by a room.
  let stairRegion = 'stairway';
  for (const sc of startCells) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const r = regions[sc.y + dy]?.[sc.x + dx];
      if (r && r.startsWith('room_')) { stairRegion = r; break; }
    }
    if (stairRegion !== 'stairway') break;
  }
  for (const sc of startCells) regions[sc.y][sc.x] = stairRegion;

  return { width: W, height: H, tiles, regions, rooms, startCells };
}

export const BASE_BOARD: BaseBoard = buildBaseBoard();

/** Region id at a board cell (room_N, 'corridor', 'stairway', or ''). */
export function boardRegionAt(x: number, y: number): string {
  return BASE_BOARD.regions[y]?.[x] ?? '';
}

/** Auto-place a minimal set of doors that connect every room back to the
 *  corridors — a spanning tree over the region graph. Each room gets ONE door
 *  (2-wide where the shared wall allows) to an already-connected region, so the
 *  whole dungeon is reachable from the entrance. Returns door specs ready for a
 *  QuestDef (engine fills open/found). Quests can use these or hand-author. */
export function generateConnectingDoors(): { id: string; crossings: { a: Coord; b: Coord }[]; secret: boolean }[] {
  const { width: W, height: H, regions } = BASE_BOARD;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? regions[y][x] : '');
  const isRoom = (r: string) => r.startsWith('room_');
  const connected = new Set<string>(['corridor', 'stairway']);
  const doors: { id: string; crossings: { a: Coord; b: Coord }[]; secret: boolean }[] = [];
  let did = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = at(x, y);
        if (!isRoom(r) || connected.has(r)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = at(x + dx, y + dy);
          if (!nr || nr === r || !connected.has(nr)) continue;
          // Primary crossing; widen to 2 cells along the wall if possible.
          const crossings: { a: Coord; b: Coord }[] = [{ a: { x, y }, b: { x: x + dx, y: y + dy } }];
          const perp = dx !== 0 ? [{ x: 0, y: 1 }, { x: 0, y: -1 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
          for (const p of perp) {
            const ax = x + p.x, ay = y + p.y, bx = x + dx + p.x, by = y + dy + p.y;
            if (at(ax, ay) === r && at(bx, by) === nr) {
              crossings.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
              break;
            }
          }
          doors.push({ id: `door_${++did}`, crossings, secret: false });
          connected.add(r);
          changed = true;
          break;
        }
      }
    }
  }
  return doors;
}
