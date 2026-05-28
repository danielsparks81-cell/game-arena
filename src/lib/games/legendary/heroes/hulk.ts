import type { HeroCardDef } from '../types';

// Hulk hero class — Avengers, Strength.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const HULK_GROWING_ANGER: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_growing_anger',
  className: 'Hulk',
  cardName: 'Growing Anger',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: '[strength]: You get +1[strike].',
  onPlay: [
    // Card IS Strength → need total ≥2 (at least 1 other Strength card played).
    { kind: 'if_played_class_this_turn', cls: 'strength', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const HULK_UNSTOPPABLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_unstoppable',
  className: 'Hulk',
  cardName: 'Unstoppable Hulk',
  cost: 4,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['instinct'],
  teams: ['avengers'],
  text: 'You may KO a Wound from your hand or discard pile. If you do, you get +2[strike].',
  onPlay: [
    { kind: 'ko_from_hand', filter: 'wounds_only',
      sources: ['hand', 'discard'],
      bonus: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

export const HULK_CRAZED_RAMPAGE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_crazed_rampage',
  className: 'Hulk',
  cardName: 'Crazed Rampage',
  cost: 5,
  baseAttack: 4,
  classes: ['strength'],
  teams: ['avengers'],
  text: 'Each player gains a Wound.',
  onPlay: [
    { kind: 'each_player_gains_wound' },
  ],
};

export const HULK_SMASH: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_smash',
  className: 'Hulk',
  cardName: 'Hulk Smash!',
  cost: 8,
  baseAttack: 5,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: '[strength]: You get +5[strike].',
  onPlay: [
    // Card IS Strength → need total ≥2 (at least 1 other Strength card played).
    { kind: 'if_played_class_this_turn', cls: 'strength', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 5 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const HULK_CLASS = {
  className: 'Hulk',
  cards: [
    { def: HULK_GROWING_ANGER,   copies: 5 },
    { def: HULK_UNSTOPPABLE,     copies: 5 },
    { def: HULK_CRAZED_RAMPAGE,  copies: 3 },
    { def: HULK_SMASH,           copies: 1 },
  ],
};
