// The LOCKED board for all 14 quests: our 32×23 layout with wider halls and
// larger rooms (the live game board). This module puts a friendly, stable
// coordinate layer on top of the engine's BASE_BOARD so quests can place
// monsters / furniture / objectives by ROOM + offset instead of raw cells, and
// so the gallery and (later) the engine speak the same language.
//
// Room map (3×3 of rooms, right third is solid rock):
//      TL    TC    TR
//      ML    C     MR
//      BL*   BC    BR        (* BL = the entrance room, holds the stairway)

import { BASE_BOARD } from '../board';

export type Cell = { x: number; y: number };

export type RoomLabel = 'TL' | 'TC' | 'TR' | 'ML' | 'C' | 'MR' | 'BL' | 'BC' | 'BR';

export type LabeledRoom = {
  label: RoomLabel;
  name: string;
  regionId: string;          // BASE_BOARD region id (room_N)
  cells: Cell[];
  minX: number; minY: number; maxX: number; maxY: number;
  cx: number; cy: number;    // centre cell
};

// One known interior cell per room — used to look up its flood-filled region.
const ANCHORS: Record<RoomLabel, [number, number]> = {
  TL: [4, 3],  TC: [12, 3], TR: [20, 3],
  ML: [4, 8],  C:  [13, 9], MR: [20, 8],
  BL: [5, 16], BC: [12, 16], BR: [19, 16],
};

const NAMES: Record<RoomLabel, string> = {
  TL: 'Top-Left', TC: 'Top-Center', TR: 'Top-Right',
  ML: 'Mid-Left', C: 'Center (large)', MR: 'Mid-Right',
  BL: 'Entrance (stairs)', BC: 'Bottom-Center', BR: 'Bottom-Right',
};

function collectRoom(label: RoomLabel): LabeledRoom {
  const [ax, ay] = ANCHORS[label];
  const regionId = BASE_BOARD.regions[ay][ax];
  const cells: Cell[] = [];
  for (let y = 0; y < BASE_BOARD.height; y++) {
    for (let x = 0; x < BASE_BOARD.width; x++) {
      if (BASE_BOARD.regions[y][x] === regionId && BASE_BOARD.tiles[y][x] !== 'stairs') {
        cells.push({ x, y });
      }
    }
  }
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    label, name: NAMES[label], regionId, cells,
    minX, minY, maxX, maxY,
    cx: Math.round((minX + maxX) / 2), cy: Math.round((minY + maxY) / 2),
  };
}

export const ROOMS32: Record<RoomLabel, LabeledRoom> = Object.fromEntries(
  (Object.keys(ANCHORS) as RoomLabel[]).map(l => [l, collectRoom(l)]),
) as Record<RoomLabel, LabeledRoom>;

// The stairway: 4 cells that count as ONE space. Stepping off the staircase
// from any of its cells costs a single move (handled in the engine separately);
// the gallery renders it as one merged staircase.
export const STAIRWAY: { cells: Cell[]; minX: number; minY: number; maxX: number; maxY: number } = (() => {
  const cells: Cell[] = [];
  for (let y = 0; y < BASE_BOARD.height; y++)
    for (let x = 0; x < BASE_BOARD.width; x++)
      if (BASE_BOARD.tiles[y][x] === 'stairs') cells.push({ x, y });
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
  return { cells, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
})();

/** Place at a room centre, with an optional offset. */
export function inRoom(label: RoomLabel, dx = 0, dy = 0): Cell {
  const r = ROOMS32[label];
  return { x: r.cx + dx, y: r.cy + dy };
}

/** Corner / edge cell of a room (for chests against a wall, racks, tombs…). */
export function roomCorner(label: RoomLabel, corner: 'tl' | 'tr' | 'bl' | 'br'): Cell {
  const r = ROOMS32[label];
  return {
    x: corner === 'tl' || corner === 'bl' ? r.minX : r.maxX,
    y: corner === 'tl' || corner === 'tr' ? r.minY : r.maxY,
  };
}

export const BOARD32 = {
  width: BASE_BOARD.width,
  height: BASE_BOARD.height,
  tiles: BASE_BOARD.tiles,
  regions: BASE_BOARD.regions,
  rooms: ROOMS32,
  stairway: STAIRWAY,
};
