import type { SchemeCardDef } from '../types';

// "Super Hero Civil War" — heroes turn on each other.
//
// Official rules:
//   Setup:     For 1–3 players, 8 Twists. For 4–5 players, 5 Twists.
//              If only 2 players, use only 4 Heroes in the Hero Deck.
//   Twist:     KO all the Heroes in the HQ.
//   Evil Wins: If the Hero Deck runs out.
//
// MVP implementation note: we use a fixed 8 twists (the most-common 1–3p value)
// and use twist-count as the loss condition placeholder. The "KO all HQ" twist
// effect and the "hero deck empty = loss" condition both need new engine work
// (no `ko_all_heroes_in_hq` Effect kind yet, and no `evilWinsIfHeroDeckEmpty`
// flag). Card text below preserves the official rules wording.

export const SUPER_HERO_CIVIL_WAR: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_super_hero_civil_war',
  name: 'Super Hero Civil War',
  text: 'Setup: For 1-3 players, use 8 Twists. For 4-5 players, use 5 Twists. If only 2 players, use only 4 Heroes in the Hero Deck.\nTwist: KO all the Heroes in the HQ.\nEvil Wins: If the Hero Deck runs out.',
  twists: 8,
  bystanders: 2,
  evilWinsAfterTwists: 8,
};
