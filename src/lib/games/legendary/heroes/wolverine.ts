import type { HeroCardDef } from '../types';

// Wolverine hero class — Instinct (+ 1 unknown class), X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const WLV_KEEN_SENSES: HeroCardDef = {
  kind: 'hero',
  cardId: 'wlv_keen_senses',
  className: 'Wolverine',
  cardName: 'Keen Senses',
  cost: 2,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const WLV_HEALING_FACTOR: HeroCardDef = {
  kind: 'hero',
  cardId: 'wlv_healing_factor',
  className: 'Wolverine',
  cardName: 'Healing Factor',
  cost: 3,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const WLV_FRENZIED_SLASHING: HeroCardDef = {
  kind: 'hero',
  cardId: 'wlv_frenzied_slashing',
  className: 'Wolverine',
  cardName: 'Frenzied Slashing',
  cost: 5,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const WLV_BERSERKER: HeroCardDef = {
  kind: 'hero',
  cardId: 'wlv_berserker',
  className: 'Wolverine',
  cardName: 'Berserker Rage',
  cost: 8,
  baseAttack: 0,
  baseAttackScales: true,   // renders as 0+⚔
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const WOLVERINE_CLASS = {
  className: 'Wolverine',
  cards: [
    { def: WLV_KEEN_SENSES,        copies: 5 },
    { def: WLV_HEALING_FACTOR,     copies: 5 },
    { def: WLV_FRENZIED_SLASHING,  copies: 3 },
    { def: WLV_BERSERKER,          copies: 1 },
  ],
};
