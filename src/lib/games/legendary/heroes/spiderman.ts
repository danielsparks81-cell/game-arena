import type { HeroCardDef } from '../types';

// Spider-Man hero class — Strength / Instinct / Tech / Covert, Spider-Friends.
// All four cards cost 2 — confirmed against physical cards.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card text effects marked TODO — verify against physical cards.

export const SPIDER_ASTONISHING: HeroCardDef = {
  kind: 'hero',
  cardId: 'spm_astonishing_strength',
  className: 'Spider-Man',
  cardName: 'Astonishing Strength',
  cost: 2,
  baseRecruit: 1,
  classes: ['strength'],
  teams: ['spider-friends'],
  // TODO: verify any additional effect beyond the base recruit
};

export const SPIDER_GREAT_RESPONSIBILITY: HeroCardDef = {
  kind: 'hero',
  cardId: 'spm_great_responsibility',
  className: 'Spider-Man',
  cardName: 'Great Responsibility',
  cost: 2,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['spider-friends'],
  // TODO: verify any additional effect beyond the base strike
};

export const SPIDER_WEB_SHOOTERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'spm_web_shooters',
  className: 'Spider-Man',
  cardName: 'Web-Shooters',
  cost: 2,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['tech'],
  teams: ['spider-friends'],
};

export const SPIDER_AMAZING: HeroCardDef = {
  kind: 'hero',
  cardId: 'spm_the_amazing_spider_man',
  className: 'Spider-Man',
  cardName: 'The Amazing Spider-Man',
  cost: 2,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['covert'],
  teams: ['spider-friends'],
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const SPIDER_MAN_CLASS = {
  className: 'Spider-Man',
  cards: [
    { def: SPIDER_ASTONISHING,           copies: 5 },
    { def: SPIDER_GREAT_RESPONSIBILITY,  copies: 5 },
    { def: SPIDER_WEB_SHOOTERS,          copies: 3 },
    { def: SPIDER_AMAZING,               copies: 1 },
  ],
};
