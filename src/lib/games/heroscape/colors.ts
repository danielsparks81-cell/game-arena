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

/** A player as far as seat-colour assignment cares. */
export type SeatColorPlayer = { seat: number; team?: number; bot?: boolean; accent_color?: string };

/**
 * Map each NON-team seat to a distinct palette colour — the SINGLE source of truth shared by the 2D
 * HUD (HeroScapeBoard) and the 3D board (HeroBoard3D) so a figure's base disc always matches that
 * player's HUD colour. (Previously each file had its own copy and they drifted: the HUD snapped to
 * the nearest palette hue while the board used the raw accent — a player could read green in the HUD
 * but blue on the board.) Policy: a HUMAN with a preset website accent claims the palette hue NEAREST
 * that accent (if still free); every other seat takes the next UNUSED palette colour in seat order,
 * so all ≤6 seats stay distinct. Team seats are coloured by the caller via teamColorById.
 */
export function computeSeatColorMap(players: readonly SeatColorPlayer[]): Map<number, string> {
  const isHex = (c?: string): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);
  const dist = (a: string, b: string) => {
    const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    return Math.abs((x >> 16 & 255) - (y >> 16 & 255)) + Math.abs((x >> 8 & 255) - (y >> 8 & 255)) + Math.abs((x & 255) - (y & 255));
  };
  const nearest = (c: string) => SEAT_COLORS.reduce((b, p) => (dist(c, p) < dist(c, b) ? p : b), SEAT_COLORS[0]);
  const map = new Map<number, string>();
  const used = new Set<string>(); // palette colours already claimed → every seat stays distinct
  // 1) Humans with a preset accent claim their NEAREST palette hue (if still free).
  for (const p of players) {
    if (p.team !== undefined || p.bot || !isHex(p.accent_color)) continue;
    const snap = nearest(p.accent_color);
    if (!used.has(snap)) { map.set(p.seat, snap); used.add(snap); }
  }
  // 2) Everyone else takes the next UNUSED palette colour (in seat order).
  for (const p of [...players].sort((a, b) => a.seat - b.seat)) {
    if (map.has(p.seat) || p.team !== undefined) continue;
    const free = SEAT_COLORS.find(c => !used.has(c)) ?? SEAT_COLORS[0];
    map.set(p.seat, free); used.add(free);
  }
  return map;
}
