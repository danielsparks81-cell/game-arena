import type { HenchmanCardDef } from '../types';

// SAVAGE LAND MUTATES henchman group — 10 identical copies.
// Fight: when you draw a new hand at end of turn, draw an extra card.

export const SAVAGE_LAND_MUTATE: HenchmanCardDef = {
  kind: 'henchman',
  cardId: 'savage_land_mutate',
  name: 'Savage Land Mutates',
  attack: 3,
  vp: 1,
  team: 'savage-land-mutates',
  fight: [{ kind: 'extra_hand_cards', amount: 1 }],
  text: 'Fight: When you draw a new hand of cards at the end of this turn, draw an extra card.',
};

export const SAVAGE_LAND_MUTATES_GROUP = {
  groupId: 'savage_land_mutates',
  team: 'savage-land-mutates' as const,
  cards: [{ def: SAVAGE_LAND_MUTATE, copies: 10 }],
};
