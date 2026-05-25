import type { VillainCardDef } from '../types';

// BROTHERHOOD — villain group.
// Composition: 2× each of Sabretooth, Juggernaut, Mystique, Blob (8 total).

export const SABRETOOTH: VillainCardDef = {
  kind: 'villain',
  cardId: 'sabretooth',
  name: 'Sabretooth',
  attack: 5,
  vp: 3,
  team: 'brotherhood',
  fight:  [{ kind: 'each_player_reveal_xmen_or_wound' }],
  escape: [{ kind: 'reveal_xmen_or_wound' }],
  text: 'Fight: Each player reveals an [x-men] Hero or gains a Wound.\nEscape: Each player reveals an [x-men] Hero or gains a Wound.',
};

export const JUGGERNAUT: VillainCardDef = {
  kind: 'villain',
  cardId: 'juggernaut',
  name: 'Juggernaut',
  attack: 6,
  vp: 4,
  team: 'brotherhood',
  ambush: [{ kind: 'ko_heroes_from_discard', amount: 2 }],
  escape: [{ kind: 'ko_heroes_from_hand_immediate', amount: 2 }],
  text: 'Ambush: Each player KOs two Heroes from their discard pile.\nEscape: Each player KOs two Heroes from their hand.',
};

export const MYSTIQUE: VillainCardDef = {
  kind: 'villain',
  cardId: 'mystique',
  name: 'Mystique',
  attack: 5,
  vp: 3,
  team: 'brotherhood',
  escape: [{ kind: 'trigger_scheme_twist' }],
  text: 'Escape: Mystique becomes a Scheme Twist that takes effect immediately.',
};

export const BLOB: VillainCardDef = {
  kind: 'villain',
  cardId: 'blob',
  name: 'Blob',
  attack: 4,
  vp: 2,
  team: 'brotherhood',
  fightCondition: { requires: 'xmen_hero' },
  text: 'You cannot defeat Blob unless you have an [x-men] Hero.',
};

export const BROTHERHOOD_GROUP = {
  groupId: 'brotherhood',
  team: 'brotherhood' as const,
  cards: [
    { def: SABRETOOTH,  copies: 2 },
    { def: JUGGERNAUT,  copies: 2 },
    { def: MYSTIQUE,    copies: 2 },
    { def: BLOB,        copies: 2 },
  ],
};
