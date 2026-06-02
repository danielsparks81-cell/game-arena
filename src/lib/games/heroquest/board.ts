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

import type { TileKind } from './types';

export const BOARD_W = 32;
export const BOARD_H = 23;

const BOARD_MAP: string[] = [
  '##..............................', // 0
  '##..............................', // 1
  '##..ggggeeeebbbb..bbbbeeeeffff..', // 2
  '##..ggggeeeebbbb..bbbbeeeeffff..', // 3
  '##..ggggeeeebbbb..bbbbeeeeffff..', // 4
  '##..ggggeeeebbbb..bbbbeeeeffff..', // 5
  '##..hhhhddddbbbb..bbbbggggdddd..', // 6
  '##..hhhhdddd..........ggggdddd..', // 7
  '##..hhhhdddd..........ggggdddd..', // 8
  '##..hhhhdddd..aaaaaa..ggggdddd..', // 9
  '##..hhhhdddd..aaaaaa..ggggdddd..', // 10
  '##............aaaaaa............', // 11
  '##............aaaaaa............', // 12
  '##..hhhhbbdd..aaaaaa..hhhhdddd..', // 13
  '##..hhhhbbdd..........hhhhdddd..', // 14
  '##..hhhhbbdd..........hhhhdddd..', // 15
  '##..hhhheeeebbbb..bbbbbhhhdddd..', // 16
  '##..ggggeeeebbbb..bbbbbeeegggg..', // 17
  '##..ggggeeeebbbb..bbbbbeeegggg..', // 18
  '##..ggggeeeebbbb..bbbbbeeegggg..', // 19
  '##..ggggeeeebbbb..bbbbbeeegggg..', // 20
  '##SS............................', // 21  (entry staircase, bottom-left)
  '##SS............................', // 22
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

const ROOM_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

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
      else if (ch === 'S') { tiles[y][x] = 'stairs'; regions[y][x] = 'stairway'; startCells.push({ x, y }); }
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

  return { width: W, height: H, tiles, regions, rooms, startCells };
}

export const BASE_BOARD: BaseBoard = buildBaseBoard();

/** Region id at a board cell (room_N, 'corridor', 'stairway', or ''). */
export function boardRegionAt(x: number, y: number): string {
  return BASE_BOARD.regions[y]?.[x] ?? '';
}
