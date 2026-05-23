import type { HeroCardDef } from '../types';

// Deadpool hero class — Tech/Covert/Instinct/Instinct, no team affiliation.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const DEADPOOL_HERE_HOLD_THIS: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_here_hold_this',
  className: 'Deadpool',
  cardName: 'Here, Hold This for a Second',
  cost: 3,
  baseRecruit: 2,
  classes: ['tech'],
  teams: [],
  text: 'A Villain of your choice captures a Bystander.',
  onPlay: [
    { kind: 'villain_captures_bystander' },
  ],
};

export const DEADPOOL_ODDBALL: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_oddball',
  className: 'Deadpool',
  cardName: 'Oddball',
  cost: 5,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['covert'],
  teams: [],
  text: 'You get +1[strike] for each other Hero with an odd-numbered [cost] you played this turn.',
  onPlay: [
    { kind: 'gain_attack_per_odd_cost_hero_played' },
  ],
};

export const DEADPOOL_DO_OVER: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_do_over',
  className: 'Deadpool',
  cardName: 'Hey, Can I Get a Do-Over?',
  cost: 3,
  baseAttack: 2,
  classes: ['instinct'],
  teams: [],
  text: 'If this is the first Hero you played this turn, you may discard the rest of your hand and draw four cards.',
  onPlay: [
    { kind: 'if_first_hero_discard_hand_draw_four' },
  ],
};

export const DEADPOOL_RANDOM_ACTS: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_random_acts',
  className: 'Deadpool',
  cardName: 'Random Acts of Unkindness',
  cost: 7,
  baseAttack: 6,
  classes: ['instinct'],
  teams: [],
  text: 'You may gain a Wound to your hand. Then each player passes a card from their hand to the player on their left.',
  onPlay: [
    { kind: 'optional_gain_wound_pass_left' },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const DEADPOOL_CLASS = {
  className: 'Deadpool',
  cards: [
    { def: DEADPOOL_HERE_HOLD_THIS, copies: 5 },
    { def: DEADPOOL_ODDBALL,        copies: 5 },
    { def: DEADPOOL_DO_OVER,        copies: 3 },
    { def: DEADPOOL_RANDOM_ACTS,    copies: 1 },
  ],
};
