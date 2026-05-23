import type { HeroCardDef } from '../types';

// Wolverine hero class — X-Men, Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const WOLVERINE_KEEN_SENSES: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_keen_senses',
  className: 'Wolverine',
  cardName: 'Keen Senses',
  cost: 2,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '[instinct]: Draw a card.',
  onPlay: [
    // Card IS Instinct → need total ≥2 (at least 1 other Instinct played).
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const WOLVERINE_HEALING_FACTOR: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_healing_factor',
  className: 'Wolverine',
  cardName: 'Healing Factor',
  cost: 3,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  text: 'You may KO a Wound from your hand or discard pile. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, filter: 'wounds_only',
      sources: ['hand', 'discard'],
      bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const WOLVERINE_FRENZIED_SLASHING: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_frenzied_slashing',
  className: 'Wolverine',
  cardName: 'Frenzied Slashing',
  cost: 5,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '[instinct]: Draw two cards.',
  onPlay: [
    // Card IS Instinct → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'draw', amount: 2 }] },
  ],
};

export const WOLVERINE_BERSERKER_RAGE: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_berserker_rage',
  className: 'Wolverine',
  cardName: 'Berserker Rage',
  cost: 8,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['instinct'],
  teams: ['x-men'],
  text: 'Draw three cards.\n[instinct]: You get +1[strike] for each extra card you\'ve drawn this turn.',
  onPlay: [
    { kind: 'draw', amount: 3 },
    // Card IS Instinct → need total ≥2. Fires AFTER the draw so all 3 count.
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'gain_attack_per_extra_card_drawn_this_turn', amount: 1 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const WOLVERINE_CLASS = {
  className: 'Wolverine',
  cards: [
    { def: WOLVERINE_KEEN_SENSES,       copies: 5 },
    { def: WOLVERINE_HEALING_FACTOR,    copies: 5 },
    { def: WOLVERINE_FRENZIED_SLASHING, copies: 3 },
    { def: WOLVERINE_BERSERKER_RAGE,    copies: 1 },
  ],
};
