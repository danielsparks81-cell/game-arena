import type { HeroCardDef } from '../types';

// Spider-Man hero class — Spider-Friends.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const SPIDEY_ASTONISHING_STRENGTH: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_astonishing_strength',
  className: 'Spider-Man',
  cardName: 'Astonishing Strength',
  cost: 2,
  baseRecruit: 1,
  classes: ['strength'],
  teams: ['spider-friends'],
  text: 'Reveal the top card of your deck. If that card costs 2[cost] or less, draw it.',
  onPlay: [
    { kind: 'reveal_top_draw_if_cost_le_2' },
  ],
};

export const SPIDEY_GREAT_RESPONSIBILITY: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_great_responsibility',
  className: 'Spider-Man',
  cardName: 'Great Responsibility',
  cost: 2,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['spider-friends'],
  text: 'Reveal the top card of your deck. If that card costs 2[cost] or less, draw it.',
  onPlay: [
    { kind: 'reveal_top_draw_if_cost_le_2' },
  ],
};

export const SPIDEY_WEB_SHOOTERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_web_shooters',
  className: 'Spider-Man',
  cardName: 'Web-Shooters',
  cost: 2,
  classes: ['tech'],
  teams: ['spider-friends'],
  text: 'Rescue a Bystander.\nReveal the top card of your deck. If that card costs 2[cost] or less, draw it.',
  onPlay: [
    { kind: 'rescue_bystander', amount: 1 },
    { kind: 'reveal_top_draw_if_cost_le_2' },
  ],
};

export const SPIDEY_AMAZING_SPIDER_MAN: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_amazing_spider_man',
  className: 'Spider-Man',
  cardName: 'The Amazing Spider-Man',
  cost: 2,
  classes: ['covert'],
  teams: ['spider-friends'],
  text: 'Reveal the top three cards of your deck. Put any that cost 2[cost] or less into your hand. Put the rest back in any order.',
  onPlay: [
    { kind: 'reveal_top_three_draw_cost_le_2' },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const SPIDER_MAN_CLASS = {
  className: 'Spider-Man',
  cards: [
    { def: SPIDEY_ASTONISHING_STRENGTH,  copies: 5 },
    { def: SPIDEY_GREAT_RESPONSIBILITY,  copies: 5 },
    { def: SPIDEY_WEB_SHOOTERS,          copies: 3 },
    { def: SPIDEY_AMAZING_SPIDER_MAN,    copies: 1 },
  ],
};
