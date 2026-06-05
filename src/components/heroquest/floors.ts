// Shared dungeon-floor palette + per-room assignment, used by BOTH the in-game
// board (Board.tsx) and the Map Authoring editor so the two never drift. Every
// room gets its OWN (colour, pattern) — there are more palette entries than any
// quest has rooms — so no two rooms ever render identical tiles.

import type { FloorStyle } from './Art';

export type RoomFloor = { tl: string; br: string; style: FloorStyle };

// Light grey "broken slate" flooring for hallways / corridors.
export const CORRIDOR_FLOOR: RoomFloor = { tl: '#9c9c98', br: '#6c6c68', style: 'slate' };

// 24 curated muted (colour, pattern) looks. Each colour is paired with a
// distinct pattern, and the order alternates warm/cool + pattern so that
// numerically-adjacent rooms (often near each other on a board) contrast.
export const ROOM_FLOORS: RoomFloor[] = [
  { tl: '#7a6147', br: '#4c3d2c', style: 'flag' },        // warm tan flagstone
  { tl: '#4e5e72', br: '#2e3b47', style: 'checker' },     // slate-blue checker
  { tl: '#566b4a', br: '#384630', style: 'brick' },       // moss-green brick
  { tl: '#7a4c4c', br: '#472e2e', style: 'cobble' },      // dusty-red cobble
  { tl: '#5d4a6b', br: '#3c2f48', style: 'diag' },        // purple diagonal
  { tl: '#7a7050', br: '#474230', style: 'herringbone' }, // olive herringbone
  { tl: '#487a70', br: '#2e4844', style: 'plank' },       // teal plank
  { tl: '#7a5650', br: '#473934', style: 'slate' },       // brown-rose slate
  { tl: '#4f566b', br: '#333848', style: 'flag' },        // indigo flag
  { tl: '#6f7a48', br: '#42472e', style: 'checker' },     // yellow-green checker
  { tl: '#3f6b7a', br: '#2a4450', style: 'brick' },       // cyan brick
  { tl: '#7a5a3a', br: '#4a3622', style: 'cobble' },      // oak cobble
  { tl: '#6b4a5e', br: '#45303c', style: 'diag' },        // magenta diagonal
  { tl: '#5a6b5a', br: '#384538', style: 'herringbone' }, // grey-green herringbone
  { tl: '#5f676e', br: '#3a4046', style: 'plank' },       // steel plank
  { tl: '#84563a', br: '#4e3120', style: 'slate' },       // rust slate
  { tl: '#45506b', br: '#2b3248', style: 'flag' },        // deep-blue flag
  { tl: '#69755c', br: '#424b38', style: 'checker' },     // sage checker
  { tl: '#6a4658', br: '#432c38', style: 'brick' },       // plum brick
  { tl: '#837049', br: '#4f422a', style: 'cobble' },      // ochre cobble
  { tl: '#466b52', br: '#2c4434', style: 'diag' },        // forest diagonal
  { tl: '#74474f', br: '#45292e', style: 'herringbone' }, // burgundy herringbone
  { tl: '#4a6a6f', br: '#2d4246', style: 'plank' },       // slate-teal plank
  { tl: '#6d5f72', br: '#423a47', style: 'slate' },       // mauve slate
];

const FLOOR_STYLES: FloorStyle[] = ['flag', 'checker', 'brick', 'cobble', 'diag', 'herringbone', 'plank', 'slate'];

/** Shift every RGB channel of a #rrggbb colour by d (clamped) — same hue, just
 *  lighter/darker. */
function shiftLightness(hex: string, d: number): string {
  const m = hex.replace('#', '');
  const ch = (i: number) => Math.max(0, Math.min(255, parseInt(m.slice(i, i + 2), 16) + d));
  const hx = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hx(ch(0))}${hx(ch(2))}${hx(ch(4))}`;
}

/** Deterministic muted variation for the rare case of more rooms than palette
 *  entries: nudge the shade and rotate to a different pattern so the room stays
 *  in-aesthetic but never matches another room's tiles. */
function varyFloor(base: RoomFloor, tier: number): RoomFloor {
  const d = (tier % 2 === 0 ? 1 : -1) * (10 + 6 * Math.floor((tier - 1) / 2));
  const style = FLOOR_STYLES[(FLOOR_STYLES.indexOf(base.style) + tier) % FLOOR_STYLES.length];
  return { tl: shiftLightness(base.tl, d), br: shiftLightness(base.br, d), style };
}

/** Assign each room region its own floor look. `orderedRegions` must be the
 *  region ids (e.g. room_1, room_2, …) in a stable order (by room number); each
 *  gets the next palette entry, wrapping with a unique variation if there are
 *  somehow more rooms than entries. */
export function assignRoomFloors(orderedRegions: string[]): Map<string, RoomFloor> {
  const N = ROOM_FLOORS.length;
  const map = new Map<string, RoomFloor>();
  orderedRegions.forEach((r, i) => {
    const base = ROOM_FLOORS[i % N];
    const tier = Math.floor(i / N);
    map.set(r, tier === 0 ? base : varyFloor(base, tier));
  });
  return map;
}
