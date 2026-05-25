import type { SchemeCardDef } from '../types';

// "Super Hero Civil War" — heroes turn on each other.
//
// Official rules:
//   Setup:     For 1–3 players, 8 Twists. For 4–5 players, 5 Twists.
//              If only 2 players, use only 4 Heroes in the Hero Deck.
//   Twist:     KO all the Heroes in the HQ.
//   Evil Wins: If the Hero Deck runs out.
//
// MVP implementation note: we use a fixed 8 twists (the most-common 1–3p value).
// The Twist effect (KO every Hero in the HQ + refill) IS now implemented via
// the `ko_all_heroes_in_hq` engine effect. The "Hero Deck runs out = loss"
// condition still needs new engine work (no `evilWinsIfHeroDeckEmpty` flag yet),
// so loss falls back to twist-count. Card text preserves the official wording.

export const SUPER_HERO_CIVIL_WAR: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_super_hero_civil_war',
  name: 'Super Hero Civil War',
  text: 'Setup: For 1-3 players, use 8 Twists. For 4-5 players, use 5 Twists. If only 2 players, use only 4 Heroes in the Hero Deck.\nTwist: KO all the Heroes in the HQ.\nEvil Wins: If the Hero Deck runs out.',
  twists: 8,
  bystanders: 2,
  evilWinsAfterTwists: 8,
  onTwist: [
    { kind: 'ko_all_heroes_in_hq' },
  ],
};
