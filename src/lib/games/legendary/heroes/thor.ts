import type { HeroCardDef } from '../types';

// Thor hero class — Avengers, Strength/Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const THOR_ODINSON: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_odinson',
  className: 'Thor',
  cardName: 'Odinson',
  cost: 3,
  baseRecruit: 2,
  baseRecruitScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: '[strength]: You get +2[recruit].',
  onPlay: [
    // Card IS Strength → need total ≥2 (at least 1 other Strength played).
    { kind: 'if_played_class_this_turn', cls: 'strength', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 2 }] },
  ],
};

export const THOR_SURGE_OF_POWER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_surge_of_power',
  className: 'Thor',
  cardName: 'Surge of Power',
  cost: 4,
  baseRecruit: 2,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['avengers'],
  text: 'If you made 8 or more [recruit] this turn, you get +3[strike].',
  onPlay: [
    { kind: 'if_recruit_ge', threshold: 8, effects: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

export const THOR_CALL_LIGHTNING: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_call_lightning',
  className: 'Thor',
  cardName: 'Call Lightning',
  cost: 6,
  baseAttack: 3,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '[ranged]: You get +3[strike].',
  onPlay: [
    // Card IS Ranged → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

export const THOR_GOD_OF_THUNDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_god_of_thunder',
  className: 'Thor',
  cardName: 'God of Thunder',
  cost: 8,
  baseRecruit: 5,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['avengers'],
  text: 'You can use [recruit] as [strike] this turn.',
  onPlay: [
    { kind: 'enable_recruit_as_attack' },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const THOR_CLASS = {
  className: 'Thor',
  cards: [
    { def: THOR_ODINSON,        copies: 5 },
    { def: THOR_SURGE_OF_POWER, copies: 5 },
    { def: THOR_CALL_LIGHTNING, copies: 3 },
    { def: THOR_GOD_OF_THUNDER, copies: 1 },
  ],
};
