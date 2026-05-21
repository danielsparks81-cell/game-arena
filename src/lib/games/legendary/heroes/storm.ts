import type { HeroCardDef } from '../types';

// Storm hero class — X-Men, Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const STORM_GATHERING_STORMCLOUDS: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_gathering_stormclouds',
  className: 'Storm',
  cardName: 'Gathering Stormclouds',
  cost: 2,
  baseRecruit: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '2 Recruit.',
};

export const STORM_LIGHTNING_BOLT: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_lightning_bolt',
  className: 'Storm',
  cardName: 'Lightning Bolt',
  cost: 3,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '2 Attack. Ranged: +1 Attack.',
  onPlay: [
    // Card IS Ranged → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const STORM_SPINNING_CYCLONE: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_spinning_cyclone',
  className: 'Storm',
  cardName: 'Spinning Cyclone',
  cost: 4,
  baseAttack: 4,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '4 Attack. Ranged: +1 Attack.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const STORM_TIDAL_WAVE: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_tidal_wave',
  className: 'Storm',
  cardName: 'Tidal Wave',
  cost: 6,
  baseAttack: 5,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '5 Attack. Ranged: +2 Attack.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 2 }] },
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
