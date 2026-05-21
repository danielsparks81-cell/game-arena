import type { HeroCardDef } from '../types';

// Thor hero class — Avengers, Strength/Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const THOR_ODINSON: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_odinson',
  className: 'Thor',
  cardName: 'Odinson',
  cost: 2,
  baseRecruit: 2,
  classes: ['strength'],
  teams: ['avengers'],
  text: '2 Recruit. Avengers: +1 Recruit.',
  onPlay: [
    // Card IS Avengers → need total ≥2.
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
};

export const THOR_SURGE_OF_POWER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_surge_of_power',
  className: 'Thor',
  cardName: 'Surge of Power',
  cost: 3,
  baseRecruit: 2,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '2 Recruit. Ranged: +2 Attack.',
  onPlay: [
    // Card IS Ranged → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

export const THOR_CALL_LIGHTNING: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_call_lightning',
  className: 'Thor',
  cardName: 'Call Lightning',
  cost: 5,
  baseAttack: 3,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '3 Attack. Avengers: +2 Attack.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

export const THOR_GOD_OF_THUNDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'thor_god_of_thunder',
  className: 'Thor',
  cardName: 'God of Thunder',
  cost: 7,
  baseRecruit: 5,
  classes: ['strength'],
  teams: ['avengers'],
  text: '5 Recruit. Avengers: +3 Attack.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 3 }] },
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
