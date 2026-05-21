import type { HeroCardDef } from '../types';

// Deadpool hero class — Tech / Covert / Instinct, no team.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const DP_HERE_HOLD_THIS: HeroCardDef = {
  kind: 'hero',
  cardId: 'dp_here_hold_this',
  className: 'Deadpool',
  cardName: 'Here, Hold This for a Second',
  cost: 3,
  baseRecruit: 2,
  classes: ['tech'],
  teams: [],
  // TODO: verify any additional effect beyond the base recruit
};

export const DP_HEY_CAN_I_GET_A_DO_OVER: HeroCardDef = {
  kind: 'hero',
  cardId: 'dp_hey_can_i_get_a_do_over',
  className: 'Deadpool',
  cardName: 'Hey, Can I Get a Do-Over?',
  cost: 3,
  baseAttack: 2,
  classes: ['instinct'],
  teams: [],
  // TODO: verify any additional effect beyond the base strike
};

export const DP_ODDBALL: HeroCardDef = {
  kind: 'hero',
  cardId: 'dp_oddball',
  className: 'Deadpool',
  cardName: 'Oddball',
  cost: 5,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['covert'],
  teams: [],
  // TODO: verify scaling condition from card text
};

export const DP_RANDOM_ACTS_OF_UNKINDNESS: HeroCardDef = {
  kind: 'hero',
  cardId: 'dp_random_acts_of_unkindness',
  className: 'Deadpool',
  cardName: 'Random Acts of Unkindness',
  cost: 7,
  baseAttack: 6,
  classes: ['instinct'],
  teams: [],
  // TODO: verify any additional effect beyond the base strike
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const DEADPOOL_CLASS = {
  className: 'Deadpool',
  cards: [
    { def: DP_HERE_HOLD_THIS,             copies: 5 },
    { def: DP_ODDBALL,                    copies: 5 },
    { def: DP_HEY_CAN_I_GET_A_DO_OVER,   copies: 3 },
    { def: DP_RANDOM_ACTS_OF_UNKINDNESS,  copies: 1 },
  ],
};
