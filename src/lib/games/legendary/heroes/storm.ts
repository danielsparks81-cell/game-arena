import type { HeroCardDef } from '../types';

// Storm hero class — Ranged / Covert, X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const STORM_GATHERING_STORMCLOUDS: HeroCardDef = {
  kind: 'hero',
  cardId: 'storm_gathering_stormclouds',
  className: 'Storm',
  cardName: 'Gathering Stormclouds',
  cost: 3,
  baseRecruit: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base recruit
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
  // TODO: verify any additional effect beyond the base strike
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
  // TODO: verify any additional effect beyond the base strike
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
  // TODO: verify any additional effect beyond the base strike
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const STORM_CLASS = {
  className: 'Storm',
  cards: [
    { def: STORM_GATHERING_STORMCLOUDS, copies: 5 },
    { def: STORM_LIGHTNING_BOLT,        copies: 5 },
    { def: STORM_SPINNING_CYCLONE,      copies: 3 },
    { def: STORM_TIDAL_WAVE,            copies: 1 },
  ],
};
