import type { HenchmanCardDef } from '../types';

// HAND NINJAS henchman group — 10 vanilla copies. Mid-low difficulty fodder
// that fills out the Villain Deck.

export const HAND_NINJA: HenchmanCardDef = {
  kind: 'henchman',
  cardId: 'hand_ninja',
  name: 'Hand Ninja',
  attack: 3,
  vp: 1,
  team: 'system', // henchmen aren't bound to a villain team in Legendary
};

export const HAND_NINJA_GROUP = {
  groupId: 'hand_ninjas',
  cards: [{ def: HAND_NINJA, copies: 10 }],
};
