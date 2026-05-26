import type { VillainCardDef } from '../types';

// SPIDER-FOES — villain group from the Marvel Legendary base set.
// Composition: 2× each of Venom, Doctor Octopus, The Lizard, Green Goblin (8 total).

export const VENOM: VillainCardDef = {
  kind: 'villain',
  cardId: 'venom',
  name: 'Venom',
  attack: 5,
  vp: 3,
  team: 'spider-foes',
  fightCondition: { requires: 'covert_hero' },
  text: 'You can\'t defeat Venom unless you have a [covert] Hero.',
};

export const DOCTOR_OCTOPUS: VillainCardDef = {
  kind: 'villain',
  cardId: 'doctor_octopus',
  name: 'Doctor Octopus',
  attack: 4,
  vp: 2,
  team: 'spider-foes',
  // Doc Ock's Fight benefits the active player — reuse extra_hand_cards which
  // adds to me.endOfTurnExtraDraw and is consumed during the next end-of-turn
  // draw. +2 makes the new hand 8 cards instead of 6.
  fight: [{ kind: 'extra_hand_cards', amount: 2 }],
  text: 'Fight: When you draw a new hand of cards at the end of this turn, draw eight cards instead of six.',
};

export const THE_LIZARD: VillainCardDef = {
  kind: 'villain',
  cardId: 'the_lizard',
  name: 'The Lizard',
  attack: 3,
  vp: 2,
  team: 'spider-foes',
  // Location-conditional Fight effect — only fires when defeated in the
  // Sewers (city slot 0). The engine reads state.thisTurn.lastFightSlot
  // (set in doFightCity right before fight effects fire) to gate the wounds.
  fight: [{ kind: 'lizard_sewers_wound_others' }],
  text: 'Fight: If you fight the Lizard in the Sewers, each other player gains a Wound.',
};

export const GREEN_GOBLIN: VillainCardDef = {
  kind: 'villain',
  cardId: 'green_goblin',
  name: 'Green Goblin',
  attack: 6,
  vp: 4,
  team: 'spider-foes',
  ambush: [{ kind: 'villain_captures_bystander' }],
  text: 'Ambush: Green Goblin captures a Bystander.',
};

export const SPIDER_FOES_GROUP = {
  groupId: 'spider-foes',
  team: 'spider-foes' as const,
  cards: [
    { def: VENOM,           copies: 2 },
    { def: DOCTOR_OCTOPUS,  copies: 2 },
    { def: THE_LIZARD,      copies: 2 },
    { def: GREEN_GOBLIN,    copies: 2 },
  ],
};
