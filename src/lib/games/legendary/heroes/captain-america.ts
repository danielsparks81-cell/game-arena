import type { HeroCardDef } from '../types';

// Captain America hero class — Strength / Instinct / Tech / Covert, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const CAP_PERFECT_TEAMWORK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_perfect_teamwork',
  className: 'Captain America',
  cardName: 'Perfect Teamwork',
  cost: 4,
  baseAttack: 0,
  baseAttackScales: true,   // renders as 0+⚔
  classes: ['strength'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const CAP_AVENGERS_ASSEMBLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_avengers_assemble',
  className: 'Captain America',
  cardName: 'Avengers Assemble!',
  cost: 3,
  baseRecruit: 0,
  baseRecruitScales: true,  // renders as 0+★
  classes: ['instinct'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const CAP_DIVING_BLOCK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_diving_block',
  className: 'Captain America',
  cardName: 'Diving Block',
  cost: 6,
  baseAttack: 4,
  classes: ['tech'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

export const CAP_A_DAY_LIKE_ANY_OTHER: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_a_day_like_any_other',
  className: 'Captain America',
  cardName: 'A Day Like Any Other',
  cost: 7,
  baseAttack: 3,
  baseAttackScales: true,   // renders as 3+⚔
  classes: ['covert'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const CAPTAIN_AMERICA_CLASS = {
  className: 'Captain America',
  cards: [
    { def: CAP_PERFECT_TEAMWORK,       copies: 5 },
    { def: CAP_AVENGERS_ASSEMBLE,      copies: 5 },
    { def: CAP_DIVING_BLOCK,           copies: 3 },
    { def: CAP_A_DAY_LIKE_ANY_OTHER,   copies: 1 },
  ],
};
