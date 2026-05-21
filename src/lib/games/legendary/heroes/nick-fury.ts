import type { HeroCardDef } from '../types';

// Nick Fury hero class — Tech / Covert / Strength, S.H.I.E.L.D.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const FURY_HIGH_TECH_WEAPONRY: HeroCardDef = {
  kind: 'hero',
  cardId: 'fury_high_tech_weaponry',
  className: 'Nick Fury',
  cardName: 'High-Tech Weaponry',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['tech'],
  teams: ['shield'],
  // TODO: verify scaling condition from card text
};

export const FURY_BATTLEFIELD_PROMOTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'fury_battlefield_promotion',
  className: 'Nick Fury',
  cardName: 'Battlefield Promotion',
  cost: 4,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['covert'],
  teams: ['shield'],
};

export const FURY_LEGENDARY_COMMANDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'fury_legendary_commander',
  className: 'Nick Fury',
  cardName: 'Legendary Commander',
  cost: 6,
  baseAttack: 1,
  baseAttackScales: true,   // renders as 1+⚔
  classes: ['strength'],
  teams: ['shield'],
  // TODO: verify scaling condition from card text
};

export const FURY_PURE_FURY: HeroCardDef = {
  kind: 'hero',
  cardId: 'fury_pure_fury',
  className: 'Nick Fury',
  cardName: 'Pure Fury',
  cost: 8,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['tech'],
  teams: ['shield'],
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const NICK_FURY_CLASS = {
  className: 'Nick Fury',
  cards: [
    { def: FURY_HIGH_TECH_WEAPONRY,      copies: 5 },
    { def: FURY_BATTLEFIELD_PROMOTION,   copies: 5 },
    { def: FURY_LEGENDARY_COMMANDER,     copies: 3 },
    { def: FURY_PURE_FURY,              copies: 1 },
  ],
};
