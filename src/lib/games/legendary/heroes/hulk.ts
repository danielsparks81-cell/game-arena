import type { HeroCardDef } from '../types';

// Hulk hero class — Avengers, Strength/Instinct.
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
  text: '2 Attack. +1 Attack for each other Strength hero you play this turn.',
  onPlay: [
    // Card IS Strength (counted). "Other" = total - 1 → includeSelf: false.
    { kind: 'gain_attack_per_class', cls: 'strength', bonus: 1, includeSelf: false },
  ],
};

export const HULK_UNSTOPPABLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_unstoppable',
  className: 'Hulk',
  cardName: 'Unstoppable Hulk',
  cost: 4,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['avengers'],
  text: '2 Attack. Hulk: +3 Attack.',
  onPlay: [
    // This card IS a Hulk hero (counted in heroNameCounts). Need total ≥2.
    { kind: 'if_played_hero_this_turn', heroName: 'Hulk', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

export const HULK_GRAZED_RAMPAGE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_grazed_rampage',
  className: 'Hulk',
  cardName: 'Grazed Rampage',
  cost: 5,
  baseAttack: 4,
  classes: ['strength'],
  teams: ['avengers'],
  text: '4 Attack. You may KO a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const HULK_SMASH: HeroCardDef = {
  kind: 'hero',
  cardId: 'hulk_smash',
  className: 'Hulk',
  cardName: 'Hulk Smash',
  cost: 8,
  baseAttack: 5,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: '5 Attack. Hulk: +3 Attack and draw a card.',
  onPlay: [
    { kind: 'if_played_hero_this_turn', heroName: 'Hulk', minOthers: 2,
      effects: [
        { kind: 'gain_attack', amount: 3 },
        { kind: 'draw', amount: 1 },
      ] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const HULK_CLASS = {
  className: 'Hulk',
  cards: [
    { def: HULK_GROWING_ANGER,    copies: 5 },
    { def: HULK_UNSTOPPABLE,      copies: 5 },
    { def: HULK_GRAZED_RAMPAGE,   copies: 3 },
    { def: HULK_SMASH,            copies: 1 },
  ],
};
