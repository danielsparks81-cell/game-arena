import type { HeroCardDef } from '../types';

// Deadpool hero class — no team affiliation (Deadpool plays by his own rules).
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const DEADPOOL_HERE_HOLD_THIS: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_here_hold_this',
  className: 'Deadpool',
  cardName: 'Here Hold This',
  cost: 2,
  baseRecruit: 2,
  classes: ['instinct'],
  teams: [],
  text: '2 Recruit. You may discard a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const DEADPOOL_DO_OVER: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_do_over',
  className: 'Deadpool',
  cardName: 'Hey Can I Get a Do-Over',
  cost: 3,
  baseAttack: 2,
  classes: ['ranged'],
  teams: [],
  text: '2 Attack. You may KO a card from your hand. If you do, +2 Attack.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

export const DEADPOOL_ODDBALL: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_oddball',
  className: 'Deadpool',
  cardName: 'Oddball',
  cost: 4,
  baseAttack: 2,
  classes: ['ranged'],
  teams: [],
  text: '2 Attack. Tech: +2 Recruit. Instinct: +2 Attack.',
  onPlay: [
    // Oddball is Ranged, so cross-class checks → minOthers: 1 for each.
    { kind: 'if_played_class_this_turn', cls: 'tech',     minOthers: 1,
      effects: [{ kind: 'gain_recruit', amount: 2 }] },
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 1,
      effects: [{ kind: 'gain_attack',  amount: 2 }] },
  ],
};

export const DEADPOOL_RANDOM_ACTS: HeroCardDef = {
  kind: 'hero',
  cardId: 'deadpool_random_acts',
  className: 'Deadpool',
  cardName: 'Random Acts of Unkindness',
  cost: 5,
  baseAttack: 6,
  classes: ['ranged'],
  teams: [],
  text: '6 Attack. You may KO a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const DEADPOOL_CLASS = {
  className: 'Deadpool',
  cards: [
    { def: DEADPOOL_HERE_HOLD_THIS, copies: 5 },
    { def: DEADPOOL_DO_OVER,        copies: 5 },
    { def: DEADPOOL_ODDBALL,        copies: 3 },
    { def: DEADPOOL_RANDOM_ACTS,    copies: 1 },
  ],
};
