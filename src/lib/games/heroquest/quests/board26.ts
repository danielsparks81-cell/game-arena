// The shared HeroQuest dungeon board, at the TRUE printed proportions: 26 wide
// × 19 tall. In real HeroQuest every one of the 14 quests is laid out on this
// ONE fixed board — quests differ only in the stairway position, which rooms are
// walled off as "solid rock", and the doors / monsters / furniture / traps
// placed on it. Reproducing the board once lets every quest be a short overlay.
//
// This geometry was reconstructed from the Quest Book's blank map template
// ("Design Your Own Quest Adventures", Page 33) by pixel-analysing the printed
// wall grid. It is a faithful FIRST PASS — verify room-by-room against a
// physical copy and refine (that's what the sandbox gallery is for).
//
// Glyphs: '.' = corridor floor · 'a'..'z' = room floor (each contiguous block of
// one letter is a distinct room). The whole board is floor; walls live on the
// EDGES between differing regions and are crossed only through doors. Per quest,
// some rooms are turned to solid rock (rendered shaded / impassable).

export type Cell = { x: number; y: number };

export const BOARD26_W = 26;
export const BOARD26_H = 19;

// 19 rows × 26 columns. Rooms lettered a–s (19 rooms); '.' = corridor.
export const BASE26: string[] = [
  '..........................', // 0  top corridor
  '.kkkkllll.....iiieeee.pppp', // 1
  '.kkkkllll.....iiieeee.pppp', // 2
  '.kkkkllll.....iiieeee.pppp', // 3
  '.aaaabbbb.....iiieeee.pppp', // 4
  '.aaaabbbb.....iiiffff.qqqq', // 5
  '.aaaabbbb........ffff.qqqq', // 6
  '.aaaabbbb........ffff.qqqq', // 7
  '.aaaabbbb........ffff.qqqq', // 8
  '..........................', // 9  middle corridor
  '.ggggnnoo........jjjj.rrrr', // 10
  '.ggggnnoo........jjjj.rrrr', // 11
  '.ggggnnoo........jjjj.rrrr', // 12
  '.ggggcccc.....ddddjjj.rrrr', // 13
  '.hhhhcccc.....ddddmmm.ssss', // 14
  '.hhhhcccc.....ddddmmm.ssss', // 15
  '.hhhhcccc.....ddddmmm.ssss', // 16
  '.hhhhcccc.....ddddmmm.ssss', // 17
  '..........................', // 18 bottom corridor
];

export type Room = {
  id: string;        // 'room_a' … (stable id keyed off the source letter)
  letter: string;
  cells: Cell[];
  cx: number;        // centre (for labels / room-level placement)
  cy: number;
  minX: number; minY: number; maxX: number; maxY: number;
};

export type Board26 = {
  width: number;
  height: number;
  regionAt: string[][];       // 'room_x' | 'corridor'
  rooms: Room[];
  roomById: Record<string, Room>;
};

const LETTERS = new Set('abcdefghijklmnopqrstuvwxyz'.split(''));

/** Parse BASE26 into rooms + a region map. Each distinct letter is one room
 *  (letters are unique here, but we flood-fill by contiguity to be safe). */
export function buildBoard26(map: string[] = BASE26): Board26 {
  const W = BOARD26_W, H = BOARD26_H;
  const regionAt: string[][] = Array.from({ length: H }, () => new Array<string>(W).fill('corridor'));
  const rooms: Room[] = [];
  const roomById: Record<string, Room> = {};
  const seen: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = map[y]?.[x] ?? '.';
      if (!LETTERS.has(ch) || seen[y][x]) continue;
      const id = `room_${ch}`;
      const cells: Cell[] = [];
      const queue: Cell[] = [{ x, y }];
      seen[y][x] = true;
      while (queue.length) {
        const c = queue.shift()!;
        cells.push(c);
        regionAt[c.y][c.x] = id;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = c.x + dx, ny = c.y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (!seen[ny][nx] && map[ny]?.[nx] === ch) { seen[ny][nx] = true; queue.push({ x: nx, y: ny }); }
        }
      }
      const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const room: Room = {
        id, letter: ch, cells,
        cx: Math.round((minX + maxX) / 2), cy: Math.round((minY + maxY) / 2),
        minX, minY, maxX, maxY,
      };
      rooms.push(room);
      roomById[id] = room;
    }
  }
  return { width: W, height: H, regionAt, rooms, roomById };
}

export const BOARD26 = buildBoard26();

/** Region id at a cell ('room_x' or 'corridor'); '' if off-board. */
export function region26At(x: number, y: number): string {
  return BOARD26.regionAt[y]?.[x] ?? '';
}

/** Centre cell of a room by id — handy for room-level placements. */
export function roomCenter(id: string): Cell | null {
  const r = BOARD26.roomById[id];
  return r ? { x: r.cx, y: r.cy } : null;
}
