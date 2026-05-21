import type { HeroCardDef } from '../types';

// Thor hero class — Strength / Ranged, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const THOR_ODINSON: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_odinson',
  className: 'Thor',
  cardName: 'Odinson',
  cost: 3,
  baseRecruit: 2,
  baseRecruitScales: true,  // renders as 2+★
  classes: ['strength'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const THOR_SURGE_OF_POWER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_surge_of_power',
  className: 'Thor',
  cardName: 'Surge of Power',
  cost: 4,
  baseRecruit: 2,
  baseAttack: 0,
  baseAttackScales: true,   // renders as 2★ and 0+⚔
  classes: ['ranged'],
  teams: ['avengers'],
  // TODO: verify scaling conditions from card text
};

export const THOR_CALL_LIGHTNING: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_call_lightning',
  className: 'Thor',
  cardName: 'Call Lightning',
  cost: 6,
  baseAttack: 3,
  baseAttackScales: true,   // renders as 3+⚔
  classes: ['ranged'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const THOR_GOD_OF_THUNDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_god_of_thunder',
  className: 'Thor',
  cardName: 'God of Thunder',
  cost: 8,
  baseRecruit: 5,
  baseAttack: 0,
  baseAttackScales: true,   // renders as 5★ and 0+⚔
  classes: ['ranged'],
  teams: ['avengers'],
  // TODO: verify scaling conditions from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const THOR_CLASS = {
  className: 'Thor',
  cards: [
    { def: THOR_ODINSON,          copies: 5 },
    { def: THOR_SURGE_OF_POWER,   copies: 5 },
    { def: THOR_CALL_LIGHTNING,   copies: 3 },
    { def: THOR_GOD_OF_THUNDER,   copies: 1 },
  ],
};
