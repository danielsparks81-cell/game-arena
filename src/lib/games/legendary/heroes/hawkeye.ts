import type { HeroCardDef } from '../types';

// Hawkeye hero class — Avengers, Ranged/Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const HAWKEYE_QUICK_DRAW: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_quick_draw',
  className: 'Hawkeye',
  cardName: 'Quick Draw',
  cost: 2,
  baseAttack: 1,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '1 Attack. Draw a card.',
  onPlay: [
    { kind: 'draw', amount: 1 },
  ],
};

export const HAWKEYE_COVERING_FIRE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_covering_fire',
  className: 'Hawkeye',
  cardName: 'Covering Fire',
  cost: 3,
  baseAttack: 3,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '3 Attack. Tech: +1 Attack.',
  onPlay: [
    // Hawkeye is Ranged, not Tech → cross-class → minOthers: 1.
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 1,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const HAWKEYE_TEAM_PLAYER: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_team_player',
  className: 'Hawkeye',
  cardName: 'Team Player',
  cost: 4,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['avengers'],
  text: '2 Attack. Avengers: +1 Attack.',
  onPlay: [
    // Card IS Avengers → need total ≥2.
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const HAWKEYE_IMPOSSIBLE_TRICK_SHOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_impossible_trick_shot',
  className: 'Hawkeye',
  cardName: 'Impossible Trick Shot',
  cost: 6,
  baseAttack: 5,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '5 Attack. You may KO a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const HAWKEYE_CLASS = {
  className: 'Hawkeye',
  cards: [
    { def: HAWKEYE_QUICK_DRAW,             copies: 5 },
    { def: HAWKEYE_COVERING_FIRE,          copies: 5 },
    { def: HAWKEYE_TEAM_PLAYER,            copies: 3 },
    { def: HAWKEYE_IMPOSSIBLE_TRICK_SHOT,  copies: 1 },
  ],
};
