import type { HenchmanCardDef } from '../types';

// HAND NINJAS henchman group — 10 vanilla copies. Mid-low difficulty fodder
// that fills out the Villain Deck.

export const HAND_NINJA: HenchmanCardDef = {
  kind: 'henchman',
  cardId: 'hand_ninja',
  name: 'Hand Ninjas',
  attack: 3,
  vp: 1,
  team: 'hand',
  fight: [{ kind: 'gain_recruit', amount: 1 }],
  text: 'Fight: You get +1[recruit].',
};

export const HAND_NINJA_GROUP = {
  groupId: 'hand_ninjas',
  team: 'hand' as const,
  cards: [{ def: HAND_NINJA, copies: 10 }],
};
