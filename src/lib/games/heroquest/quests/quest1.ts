// Quest 1 "The Trial" — the finalized layout authored in the Map Authoring
// editor (exported and pasted in). This is the single source of truth shared by
// the editor's "Load Quest 1" and the review gallery. Rock, walls, stairs,
// rooms, furniture (with footprint + rotation + LOS), doors (on wall edges) and
// monsters are all placed exactly as authored.

export type Q1Cell = { x: number; y: number };
export type Q1Monster = { kind: string; x: number; y: number; name?: string };
// (x,y) = top-left of the footprint; w×h is the placed (already-rotated) size;
// los = blocks line of sight; rot = 0|1 so the editor can re-derive orientation.
export type Q1Furn = { kind: string; x: number; y: number; w: number; h: number; los: boolean; rot?: number; gold?: number };
// A door lives ON a wall edge: the TOP edge of (x,y) when v=false, or the LEFT
// edge of (x,y) when v=true.
export type Q1Door = { x: number; y: number; v: boolean; secret?: boolean };

// The authored 30×23 board. Glyphs: # rock · . hall · S stairs · W wall · a–p room.
const QUEST1_MAP: string[] = [
  '##############################',
  '##############################',
  'WWaaaabbbbcccc################',
  '..aaaabbbbcccc################',
  '..aaaabbbbcccc################',
  '..aaaabbbbcccc################',
  '..eeeeffffccccWW##############',
  '..eeeeffff..........##########',
  '..eeeeffff..........##########',
  '..eeeeffff..eeeeee..##########',
  '..eeeeffff..eeeeee..##########',
  '............eeeeee..W#########',
  '............eeeeee..W#########',
  '..ffff####..eeeeee..##########',
  '..ffff####..........##########',
  '..ffff####..........##########',
  '..ffffhhhhaaaa..aaaaa#########',
  '..SSeehhhhaaaa..aaaaa#########',
  '..SSeehhhhaaaa..aaaaa#########',
  '..eeeehhhhaaaa..aaaaa#########',
  '..eeeehhhhaaaa..aaaaa#########',
  '................W#############',
  '................W#############',
];

/** The authored board, as a per-cell glyph grid. */
export function buildQuest1Grid(): string[][] {
  return QUEST1_MAP.map(r => r.split(''));
}

// The staircase (one 2×2 space); heroes start on these four cells.
export const QUEST1_STAIRS: Q1Cell[] = [{ x: 2, y: 17 }, { x: 3, y: 17 }, { x: 2, y: 18 }, { x: 3, y: 18 }];

export const QUEST1_FURNITURE: Q1Furn[] = [
  { kind: 'rack',            x: 4,  y: 13, w: 2, h: 3, los: false, rot: 0 },
  { kind: 'sorcerer_table',  x: 2,  y: 7,  w: 2, h: 3, los: false, rot: 0 },
  { kind: 'tomb',            x: 12, y: 2,  w: 2, h: 3, los: false, rot: 0 },
  { kind: 'table',           x: 7,  y: 7,  w: 3, h: 2, los: false, rot: 1 },
  { kind: 'chest',           x: 12, y: 6,  w: 1, h: 1, los: false, rot: 0 },
  { kind: 'chest',           x: 13, y: 9,  w: 1, h: 1, los: false, rot: 0 },
  { kind: 'throne',          x: 12, y: 10, w: 1, h: 1, los: false, rot: 0 },
  { kind: 'fireplace',       x: 14, y: 9,  w: 3, h: 1, los: true,  rot: 1 },
  { kind: 'table',           x: 13, y: 11, w: 3, h: 2, los: false, rot: 1 },
  { kind: 'weapon_rack',     x: 13, y: 18, w: 1, h: 3, los: true,  rot: 0 },
  { kind: 'bookshelf',       x: 18, y: 16, w: 3, h: 1, los: true,  rot: 1 },
  { kind: 'bookshelf',       x: 18, y: 20, w: 3, h: 1, los: true,  rot: 1 },
  { kind: 'chest',           x: 20, y: 19, w: 1, h: 1, los: false, rot: 0 },
  { kind: 'alchemist_bench', x: 6,  y: 18, w: 2, h: 3, los: false, rot: 0 },
  { kind: 'cupboard',        x: 6,  y: 16, w: 3, h: 1, los: true,  rot: 1 },
];

export const QUEST1_DOORS: Q1Door[] = [
  { x: 6,  y: 3,  v: true },
  { x: 10, y: 3,  v: true },
  { x: 4,  y: 6,  v: false },
  { x: 4,  y: 11, v: false },
  { x: 8,  y: 11, v: false },
  { x: 2,  y: 14, v: true },
  { x: 4,  y: 21, v: false },
  { x: 8,  y: 21, v: false },
  { x: 16, y: 18, v: true },
  { x: 18, y: 11, v: true },
  { x: 10, y: 18, v: true },
  { x: 12, y: 16, v: false },
];

export const QUEST1_MONSTERS: Q1Monster[] = [
  { kind: 'skeleton',      x: 4,  y: 3 },
  { kind: 'skeleton',      x: 3,  y: 3 },
  { kind: 'dread_warrior', x: 19, y: 18 },
  { kind: 'dread_warrior', x: 18, y: 19 },
  { kind: 'dread_warrior', x: 16, y: 13 },
  { kind: 'goblin',        x: 12, y: 17 },
  { kind: 'goblin',        x: 3,  y: 14 },
  { kind: 'goblin',        x: 4,  y: 8 },
  { kind: 'goblin',        x: 7,  y: 9 },
  { kind: 'goblin',        x: 8,  y: 9 },
  { kind: 'skeleton',      x: 10, y: 2 },
  { kind: 'skeleton',      x: 10, y: 4 },
  { kind: 'mummy',         x: 7,  y: 3 },
  { kind: 'mummy',         x: 10, y: 5 },
  { kind: 'zombie',        x: 7,  y: 2 },
  { kind: 'zombie',        x: 7,  y: 4 },
  { kind: 'orc',           x: 5,  y: 7 },
  { kind: 'orc',           x: 13, y: 13 },
  { kind: 'orc',           x: 16, y: 10 },
  { kind: 'orc',           x: 8,  y: 17 },
  { kind: 'orc',           x: 9,  y: 18 },
  { kind: 'orc',           x: 3,  y: 15 },
  { kind: 'abomination',   x: 12, y: 19 },
  { kind: 'gargoyle',      x: 14, y: 10 },
];
