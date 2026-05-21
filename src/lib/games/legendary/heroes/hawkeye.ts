import type { HeroCardDef } from '../types';

// Hawkeye hero class — Instinct / Tech, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const HAWK_QUICK_DRAW: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawk_quick_draw',
  className: 'Hawkeye',
  cardName: 'Quick Draw',
  cost: 3,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

export const HAWK_COVERING_FIRE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawk_covering_fire',
  className: 'Hawkeye',
  cardName: 'Covering Fire',
  cost: 5,
  baseAttack: 3,
  classes: ['tech'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

export const HAWK_TEAM_PLAYER: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawk_team_player',
  className: 'Hawkeye',
  cardName: 'Team Player',
  cost: 4,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['tech'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const HAWK_IMPOSSIBLE_TRICK_SHOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawk_impossible_trick_shot',
  className: 'Hawkeye',
  cardName: 'Impossible Trick Shot',
  cost: 7,
  baseAttack: 5,
  classes: ['tech'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const HAWKEYE_CLASS = {
  className: 'Hawkeye',
  cards: [
    { def: HAWK_QUICK_DRAW,             copies: 5 },
    { def: HAWK_COVERING_FIRE,          copies: 5 },
    { def: HAWK_TEAM_PLAYER,            copies: 3 },
    { def: HAWK_IMPOSSIBLE_TRICK_SHOT,  copies: 1 },
  ],
};
