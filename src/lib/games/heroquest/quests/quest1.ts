// Quest 1 "The Trial" on the locked board — the single source of truth shared by
// the editor (Load Quest 1) and the review gallery. Rooms are per the user's
// Quest Book read; the shaded right side is rock; doors are auto-placed one per
// used room on a hall-facing wall (nudge in the editor as needed).

import { TEMPLATE_BOARD } from './templateBoard';

export type Q1Cell = { x: number; y: number };
export type Q1Monster = { kind: string; x: number; y: number; name?: string };
export type Q1Furn = { kind: string; x: number; y: number; gold?: number };

export const QUEST1_STAIRS: Q1Cell[] = [{ x: 2, y: 17 }, { x: 3, y: 17 }, { x: 2, y: 18 }, { x: 3, y: 18 }];

// One interior seed per room that is solid rock this quest (the book's shaded
// band): rooms 1, 2, D, E, F, 11, 12, 13, 14. Flood-filled from the seed so the
// exact (reused-letter) room is rocked without touching its neighbours.
const ROCK_SEEDS: Q1Cell[] = [
  { x: 21, y: 3 }, { x: 25, y: 3 },                 // 1, 2
  { x: 17, y: 3 },                                  // D
  { x: 21, y: 8 }, { x: 25, y: 8 },                 // E, F
  { x: 22, y: 14 }, { x: 25, y: 14 },               // 11, 12
  { x: 22, y: 18 }, { x: 25, y: 18 },               // 13, 14
];

// Used rooms (bounding boxes) — for auto-placing one door each on a hall edge.
const USED_ROOMS: [number, number, number, number][] = [
  [2, 2, 5, 5], [6, 2, 9, 5], [10, 2, 13, 6],        // A, B, C
  [2, 6, 5, 10], [6, 6, 9, 10],                      // 3, 4
  [12, 9, 17, 13],                                   // 5
  [2, 13, 5, 16], [2, 17, 5, 20], [6, 16, 9, 20],    // 6, 9, 10
  [10, 16, 13, 20], [16, 16, 20, 20],                // G, H
];

const isRoom = (c: string | undefined) => !!c && /[a-z]/.test(c);

/** Template board with this quest's rock, stairs and doors stamped in. */
export function buildQuest1Grid(): string[][] {
  const grid = TEMPLATE_BOARD.map(r => r.split(''));
  // rock: flood-fill each shaded room from its seed
  for (const s of ROCK_SEEDS) {
    const letter = grid[s.y]?.[s.x];
    if (!isRoom(letter)) continue;
    const stack: [number, number][] = [[s.x, s.y]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (grid[y]?.[x] !== letter) continue;
      grid[y][x] = '#';
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  // stairs
  for (const s of QUEST1_STAIRS) grid[s.y][s.x] = 'S';
  // one door per used room, on the first hall-facing edge found
  for (const [x0, y0, x1, y1] of USED_ROOMS) {
    let done = false;
    for (let y = y0; y <= y1 && !done; y++) {
      for (let x = x0; x <= x1 && !done; x++) {
        const c = grid[y]?.[x];
        if (!isRoom(c) && c !== 'S') continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          if (grid[y + dy]?.[x + dx] === '.') { grid[y + dy][x + dx] = '+'; done = true; break; }
        }
      }
    }
  }
  return grid;
}

export const QUEST1_FURNITURE: Q1Furn[] = [
  { kind: 'tomb', x: 11, y: 2 },                  // C: Fellmarg's tomb
  { kind: 'chest', x: 13, y: 4, gold: 84 },       // C: 84-gold chest
  { kind: 'chest', x: 17, y: 11, gold: 120 },     // 5: 120-gold chest (Verag)
  { kind: 'weapon_rack', x: 11, y: 16 },          // G: chipped weapon rack (empty)
  { kind: 'chest', x: 20, y: 18 },                // H: empty chest
];

export const QUEST1_MONSTERS: Q1Monster[] = [
  { kind: 'skeleton', x: 3, y: 3 }, { kind: 'skeleton', x: 4, y: 4 },                               // A
  { kind: 'mummy', x: 8, y: 3, name: 'Guardian of Fellmarg’s Tomb' }, { kind: 'zombie', x: 6, y: 3 }, { kind: 'zombie', x: 7, y: 5 }, // B
  { kind: 'skeleton', x: 10, y: 5 }, { kind: 'skeleton', x: 13, y: 5 }, { kind: 'mummy', x: 11, y: 3 }, // C
  { kind: 'goblin', x: 3, y: 7 }, { kind: 'orc', x: 4, y: 9 },                                      // 3
  { kind: 'goblin', x: 7, y: 7 }, { kind: 'goblin', x: 8, y: 9 },                                   // 4
  { kind: 'gargoyle', x: 14, y: 11, name: 'Verag' }, { kind: 'orc', x: 13, y: 10 }, { kind: 'orc', x: 16, y: 12 }, { kind: 'dread_warrior', x: 15, y: 12 }, // 5
  { kind: 'goblin', x: 3, y: 14 }, { kind: 'orc', x: 4, y: 15 },                                    // 6
  { kind: 'orc', x: 7, y: 17 }, { kind: 'orc', x: 8, y: 19 },                                       // 10
  { kind: 'goblin', x: 11, y: 18 }, { kind: 'abomination', x: 12, y: 19 },                          // G
  { kind: 'dread_warrior', x: 17, y: 18 }, { kind: 'dread_warrior', x: 19, y: 18 },                 // H
];
