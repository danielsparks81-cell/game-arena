import type { HeroCardDef } from '../types';

// Jean Grey hero class — Ranged / Covert, X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const JG_PSYCHIC_SEARCH: HeroCardDef = {
  kind: 'hero',
  cardId: 'jg_psychic_search',
  className: 'Jean Grey',
  cardName: 'Psychic Search',
  cost: 3,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const JG_READ_YOUR_THOUGHTS: HeroCardDef = {
  kind: 'hero',
  cardId: 'jg_read_your_thoughts',
  className: 'Jean Grey',
  cardName: 'Read Your Thoughts',
  cost: 5,
  baseRecruit: 3,
  baseRecruitScales: true,  // renders as 3+★
  classes: ['covert'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

export const JG_MIND_OVER_MATTER: HeroCardDef = {
  kind: 'hero',
  cardId: 'jg_mind_over_matter',
  className: 'Jean Grey',
  cardName: 'Mind Over Matter',
  cost: 6,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const JG_TELEKINETIC_MASTERY: HeroCardDef = {
  kind: 'hero',
  cardId: 'jg_telekinetic_mastery',
  className: 'Jean Grey',
  cardName: 'Telekinetic Mastery',
  cost: 7,
  baseAttack: 5,
  baseAttackScales: true,   // renders as 5+⚔
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const JEAN_GREY_CLASS = {
  className: 'Jean Grey',
  cards: [
    { def: JG_PSYCHIC_SEARCH,        copies: 5 },
    { def: JG_READ_YOUR_THOUGHTS,    copies: 5 },
    { def: JG_MIND_OVER_MATTER,      copies: 3 },
    { def: JG_TELEKINETIC_MASTERY,   copies: 1 },
  ],
};
