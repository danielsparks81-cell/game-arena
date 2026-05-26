import type { VillainCardDef } from '../types';

// RADIATION — villain group from the Marvel Legendary base set.
// Composition: 2× each of The Leader, Abomination, Maestro, Zzzax (8 total).

export const THE_LEADER: VillainCardDef = {
  kind: 'villain',
  cardId: 'the_leader',
  name: 'The Leader',
  attack: 4,
  vp: 2,
  team: 'radiation',
  // Ambush fires globally (not once per player) — special-cased in enterCity.
  ambush: [{ kind: 'villain_deck_reveal_top', amount: 1 }],
  text: 'Ambush: Play the top card of the Villain Deck.',
};

export const ABOMINATION: VillainCardDef = {
  kind: 'villain',
  cardId: 'abomination',
  name: 'Abomination',
  attack: 5,
  vp: 3,
  team: 'radiation',
  fight: [{ kind: 'rescue_bystanders_if_at_locations', locations: ['streets', 'bridge'], amount: 3 }],
  text: 'Fight: If you fight Abomination on the Streets or Bridge, rescue three Bystanders.',
};

export const MAESTRO: VillainCardDef = {
  kind: 'villain',
  cardId: 'maestro',
  name: 'Maestro',
  attack: 6,
  vp: 4,
  team: 'radiation',
  fight: [{ kind: 'maestro_ko_per_strength' }],
  text: 'Fight: For each of your [strength] Heroes, KO one of your Heroes.',
};

export const ZZZAX: VillainCardDef = {
  kind: 'villain',
  cardId: 'zzzax',
  name: 'Zzzax',
  attack: 5,
  vp: 3,
  team: 'radiation',
  fight:  [{ kind: 'each_player_reveal_strength_or_wound' }],
  escape: [{ kind: 'reveal_strength_or_wound' }],
  text: 'Fight: Each player reveals a [strength] Hero or gains a Wound.\nEscape: Each player reveals a [strength] Hero or gains a Wound.',
};

export const RADIATION_GROUP = {
  groupId: 'radiation',
  team: 'radiation' as const,
  cards: [
    { def: THE_LEADER,  copies: 2 },
    { def: ABOMINATION, copies: 2 },
    { def: MAESTRO,     copies: 2 },
    { def: ZZZAX,       copies: 2 },
  ],
};
