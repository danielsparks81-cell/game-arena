import type { VillainCardDef } from '../types';

// ENEMIES OF ASGARD — villain group.
// Composition: 3× Frost Giant, 2× Enchantress, 2× Ymir, 1× Destroyer (8 total).

export const FROST_GIANT: VillainCardDef = {
  kind: 'villain',
  cardId: 'frost_giant',
  name: 'Frost Giant',
  attack: 4,
  vp: 2,
  team: 'enemies-of-asgard',
  fight:  [{ kind: 'each_player_reveal_ranged_or_wound' }],
  escape: [{ kind: 'reveal_ranged_or_wound' }],
  text: 'Fight: Each player reveals a [ranged] Hero or gains a Wound.\nEscape: Each player reveals a [ranged] Hero or gains a Wound.',
};

export const ENCHANTRESS: VillainCardDef = {
  kind: 'villain',
  cardId: 'enchantress',
  name: 'Enchantress',
  attack: 6,
  vp: 4,
  team: 'enemies-of-asgard',
  fight: [{ kind: 'draw', amount: 3 }],
  text: 'Fight: Draw three cards.',
};

export const YMIR: VillainCardDef = {
  kind: 'villain',
  cardId: 'ymir',
  name: 'Ymir, Frost Giant King',
  attack: 6,
  vp: 4,
  team: 'enemies-of-asgard',
  ambush: [{ kind: 'reveal_ranged_or_wound' }],
  fight:  [{ kind: 'ko_wounds_from_hand_and_discard' }],
  text: 'Ambush: Each player reveals a [ranged] Hero or gains a Wound.\nFight: Choose a player. That player KOs any number of Wounds from their hand and discard pile.',
};

export const DESTROYER: VillainCardDef = {
  kind: 'villain',
  cardId: 'destroyer',
  name: 'Destroyer',
  attack: 7,
  vp: 5,
  team: 'enemies-of-asgard',
  fight:  [{ kind: 'ko_all_shield_from_hand' }],
  escape: [{ kind: 'ko_heroes_from_hand_immediate', amount: 2 }],
  text: 'Fight: KO all of your [shield] Heroes.\nEscape: Each player KOs two of their Heroes.',
};

export const ENEMIES_OF_ASGARD_GROUP = {
  groupId: 'enemies-of-asgard',
  team: 'enemies-of-asgard' as const,
  cards: [
    { def: FROST_GIANT, copies: 3 },
    { def: ENCHANTRESS, copies: 2 },
    { def: YMIR,        copies: 2 },
    { def: DESTROYER,   copies: 1 },
  ],
};
