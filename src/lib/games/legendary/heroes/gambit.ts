import type { HeroCardDef } from '../types';

// Gambit hero class — Covert / Ranged / Instinct, X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const GAMBIT_STACK_THE_DECK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gbt_stack_the_deck',
  className: 'Gambit',
  cardName: 'Stack the Deck',
  cost: 2,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['covert'],
  teams: ['x-men'],
};

export const GAMBIT_CARD_SHARK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gbt_card_shark',
  className: 'Gambit',
  cardName: 'Card Shark',
  cost: 4,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const GAMBIT_HYPNOTIC_CHARM: HeroCardDef = {
  kind: 'hero',
  cardId: 'gbt_hypnotic_charm',
  className: 'Gambit',
  cardName: 'Hypnotic Charm',
  cost: 3,
  baseRecruit: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base recruit
};

export const GAMBIT_HIGH_STAKES_JACKPOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'gbt_high_stakes_jackpot',
  className: 'Gambit',
  cardName: 'High Stakes Jackpot',
  cost: 7,
  baseAttack: 4,
  baseAttackScales: true,   // renders as 4+⚔
  classes: ['instinct'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const GAMBIT_CLASS = {
  className: 'Gambit',
  cards: [
    { def: GAMBIT_STACK_THE_DECK,       copies: 5 },
    { def: GAMBIT_CARD_SHARK,           copies: 5 },
    { def: GAMBIT_HYPNOTIC_CHARM,       copies: 3 },
    { def: GAMBIT_HIGH_STAKES_JACKPOT,  copies: 1 },
  ],
};
