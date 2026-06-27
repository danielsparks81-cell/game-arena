// HeroScape seat / team palette — the SINGLE source of truth for figure & player
// colours. Previously this 6-hex array was hand-copied into HeroScapeBoard.tsx,
// HeroBoard3D.tsx, and the map-maker; a tweak in one silently desynced figure
// colours between the 2D and 3D boards. Import from here instead.
//
// PRIMARY + SECONDARY colours only (owner 2026-06-25: "stick to primary and
// secondary colours" — the old pink/teal/lime sat too close to red/blue).
// Ordered so the FIRST seats get the most mutually-distinct hues: a 2-player game
// is red vs blue, 3p adds yellow (the three primaries), then purple/orange, with
// GREEN last (it's nearest the grass, so it only appears at 6 players). All vivid
// for contrast against the board's grass/sand/water terrain.
export const SEAT_COLORS: readonly string[] = [
  '#e23b3b', // 1 red
  '#2f7ae5', // 2 blue
  '#f4c020', // 3 yellow
  '#9b46d6', // 4 purple
  '#f0871d', // 5 orange
  '#36b14a', // 6 green
];

// Teams (allies share one) reuse the SAME distinct palette — index = team id − 1
// (the lobby assigns team ids 1/2/3…).
export const TEAM_COLORS: readonly string[] = SEAT_COLORS;

/** Team colour by id (1-based), wrapping the palette; grey fallback for 0/invalid. */
export const teamColorById = (team: number): string =>
  TEAM_COLORS[(team - 1) % TEAM_COLORS.length] ?? '#a3a3a3';
