// Thin dispatcher — defers to each game's registered getActivePlayerId /
// getOrderedPlayerIds in `registry.ts`. Used by RoomClient to drive the
// MembersPanel "In game" section (turn order + hourglass + countdown).
//
// To support a new game's turn display, you just fill in those two functions
// on the game's registry entry; no edits to this file required.

import { GAMES } from './registry';

type TurnInfo = { orderedIds: string[]; activeId: string | null };

export function getTurnInfo(gameType: string, rawState: unknown): TurnInfo {
  const def = GAMES[gameType];
  if (!def) return { orderedIds: [], activeId: null };
  try {
    return {
      orderedIds: def.getOrderedPlayerIds(rawState) ?? [],
      activeId:   def.getActivePlayerId(rawState)   ?? null,
    };
  } catch {
    return { orderedIds: [], activeId: null };
  }
}
