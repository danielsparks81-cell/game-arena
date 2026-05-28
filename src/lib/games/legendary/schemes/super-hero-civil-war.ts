import type { SchemeCardDef } from '../types';

// "Super Hero Civil War" — heroes turn on each other.
//
// Official rules:
//   Setup:     For 1–3 players, 8 Twists. For 4–5 players, 5 Twists.
//              If only 2 players, use only 4 Heroes in the Hero Deck.
//   Twist:     KO all the Heroes in the HQ.
//   Evil Wins: If the Hero Deck runs out.
//
// Fully wired:
//   • twistsForPlayers — 1–3p = 8 Twists, 4–5p = 5 Twists.
//   • heroClassCountForPlayers — 2p uses only 4 Hero classes; otherwise the
//     standard per-player table.
//   • Twist effect KOs every Hero in the HQ (+ refill) via ko_all_heroes_in_hq.
//   • Loss = Hero Deck empties (evilWinsIfHeroDeckEmpty) — the real condition,
//     replacing the old twist-count placeholder.

export const SUPER_HERO_CIVIL_WAR: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_super_hero_civil_war',
  name: 'Super Hero Civil War',
  text: 'Setup: For 1-3 players, use 8 Twists. For 4-5 players, use 5 Twists. If only 2 players, use only 4 Heroes in the Hero Deck.\nTwist: KO all the Heroes in the HQ.\nEvil Wins: If the Hero Deck runs out.',
  twists: 8,
  twistsForPlayers: (n) => (n <= 3 ? 8 : 5),
  heroClassCountForPlayers: (n) => (n === 2 ? 4 : undefined),
  evilWinsIfHeroDeckEmpty: true,
  onTwist: [
    { kind: 'ko_all_heroes_in_hq' },
  ],
};
