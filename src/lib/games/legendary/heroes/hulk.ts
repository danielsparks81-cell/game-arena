import type { HeroCardDef } from '../types';

// Hulk hero class — Strength / Instinct, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const HULK_GROWING_ANGER: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_growing_anger',
  className: 'Hulk',
  cardName: 'Growing Anger',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['strength'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const HULK_UNSTOPPABLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_unstoppable',
  className: 'Hulk',
  cardName: 'Unstoppable Hulk',
  cost: 4,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['instinct'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const HULK_GRAZED_RAMPAGE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_grazed_rampage',
  className: 'Hulk',
  cardName: 'Grazed Rampage',
  cost: 5,
  baseAttack: 4,
  classes: ['strength'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

export const HULK_SMASH: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_smash',
  className: 'Hulk',
  cardName: 'Hulk Smash',
  cost: 8,
  baseAttack: 5,
  baseAttackScales: true,   // renders as 5+⚔
  classes: ['strength'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const HULK_CLASS = {
  className: 'Hulk',
  cards: [
    { def: HULK_GROWING_ANGER,    copies: 5 },
    { def: HULK_UNSTOPPABLE,      copies: 5 },
    { def: HULK_GRAZED_RAMPAGE,   copies: 3 },
    { def: HULK_SMASH,            copies: 1 },
  ],
};
