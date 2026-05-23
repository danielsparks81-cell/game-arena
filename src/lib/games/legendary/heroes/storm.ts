import type { HeroCardDef } from '../types';

// Storm hero class — X-Men, Ranged/Covert.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const STORM_GATHERING_STORMCLOUDS: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_gathering_stormclouds',
  className: 'Storm',
  cardName: 'Gathering Stormclouds',
  cost: 3,
  baseRecruit: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '[ranged]: Draw a card.',
  onPlay: [
    // Card IS Ranged → need total ≥2 (at least 1 other Ranged played).
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const STORM_LIGHTNING_BOLT: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_lightning_bolt',
  className: 'Storm',
  cardName: 'Lightning Bolt',
  cost: 4,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: 'Any Villain you fight on the Rooftops this turn gets -2[strike].',
  onPlay: [
    { kind: 'villain_debuff_at_location', location: 'rooftops', amount: 2 },
  ],
};

export const STORM_SPINNING_CYCLONE: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_spinning_cyclone',
  className: 'Storm',
  cardName: 'Spinning Cyclone',
  cost: 6,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['x-men'],
  text: 'You may move a Villain to a new city space. Rescue any Bystanders captured by that Villain.\n(If space is occupied, swap them.)',
  onPlay: [
    { kind: 'move_villain_rescue_bystanders' },
  ],
};

export const STORM_TIDAL_WAVE: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_tidal_wave',
  className: 'Storm',
  cardName: 'Tidal Wave',
  cost: 7,
  baseAttack: 5,
  classes: ['ranged'],
  teams: ['x-men'],
  text: 'Any Villain you fight on the Bridge this turn gets -2[strike].\n[ranged]: The Mastermind gets -2[strike] this turn.',
  onPlay: [
    { kind: 'villain_debuff_at_location', location: 'bridge', amount: 2 },
    // Card IS Ranged → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'mastermind_attack_debuff', amount: 2 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const STORM_CLASS = {
  className: 'Storm',
  cards: [
    { def: STORM_GATHERING_STORMCLOUDS, copies: 5 },
    { def: STORM_LIGHTNING_BOLT,        copies: 5 },
    { def: STORM_SPINNING_CYCLONE,      copies: 3 },
    { def: STORM_TIDAL_WAVE,            copies: 1 },
  ],
};
