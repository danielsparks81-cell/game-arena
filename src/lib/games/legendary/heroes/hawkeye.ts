import type { HeroCardDef } from '../types';

// Hawkeye hero class — Avengers, Instinct/Tech.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const HAWKEYE_QUICK_DRAW: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_quick_draw',
  className: 'Hawkeye',
  cardName: 'Quick Draw',
  cost: 3,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['avengers'],
  text: 'Draw a card.',
  onPlay: [
    { kind: 'draw', amount: 1 },
  ],
};

export const HAWKEYE_TEAM_PLAYER: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_team_player',
  className: 'Hawkeye',
  cardName: 'Team Player',
  cost: 4,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['tech'],
  teams: ['avengers'],
  text: '[avengers]: You get +1[strike].',
  onPlay: [
    // Card IS Avengers → need total ≥2 (at least 1 other Avengers card played).
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const HAWKEYE_COVERING_FIRE: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_covering_fire',
  className: 'Hawkeye',
  cardName: 'Covering Fire',
  cost: 5,
  baseAttack: 3,
  classes: ['tech'],
  teams: ['avengers'],
  text: '[tech]: Choose one — each other player draws a card, or each other player discards a card.',
  onPlay: [
    // Card IS Tech → need total ≥2 (at least 1 other tech card this turn).
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'choose_others_draw_or_discard' }] },
  ],
};

export const HAWKEYE_IMPOSSIBLE_TRICK_SHOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'hawkeye_impossible_trick_shot',
  className: 'Hawkeye',
  cardName: 'Impossible Trick Shot',
  cost: 7,
  baseAttack: 5,
  classes: ['tech'],
  teams: ['avengers'],
  text: 'Whenever you defeat a Villain or Mastermind this turn, rescue 3 Bystanders.',
  onPlay: [
    { kind: 'gain_rescue_bystanders_on_kill' },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const HAWKEYE_CLASS = {
  className: 'Hawkeye',
  cards: [
    { def: HAWKEYE_QUICK_DRAW,             copies: 5 },
    { def: HAWKEYE_TEAM_PLAYER,            copies: 5 },
    { def: HAWKEYE_COVERING_FIRE,          copies: 3 },
    { def: HAWKEYE_IMPOSSIBLE_TRICK_SHOT,  copies: 1 },
  ],
};
