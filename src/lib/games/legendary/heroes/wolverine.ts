import type { HeroCardDef } from '../types';

// Wolverine hero class — X-Men, Instinct/Strength.
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
  text: '1 Attack. Draw a card.',
  onPlay: [
    { kind: 'draw', amount: 1 },
  ],
};

export const WOLVERINE_HEALING_FACTOR: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_healing_factor',
  className: 'Wolverine',
  cardName: 'Healing Factor',
  cost: 3,
  baseAttack: 2,
  classes: ['strength'],
  teams: ['x-men'],
  text: '2 Attack. You may KO a Wound from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, filter: 'wounds_only',
      bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const WOLVERINE_FRENZIED_SLASHING: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_frenzied_slashing',
  className: 'Wolverine',
  cardName: 'Frenzied Slashing',
  cost: 4,
  baseAttack: 2,
  classes: ['strength'],
  teams: ['x-men'],
  text: '2 Attack. You may KO a card from your hand. If you do, +3 Attack.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

export const WOLVERINE_BERSERKER_RAGE: HeroCardDef = {
  kind: 'hero',
  cardId: 'wolverine_berserker_rage',
  className: 'Wolverine',
  cardName: 'Berserker Rage',
  cost: 6,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '+2 Attack for each Instinct hero you play this turn, including this one.',
  onPlay: [
    { kind: 'gain_attack_per_class', cls: 'instinct', bonus: 2, includeSelf: true },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const WOLVERINE_CLASS = {
  className: 'Wolverine',
  cards: [
    { def: WOLVERINE_KEEN_SENSES,      copies: 5 },
    { def: WOLVERINE_HEALING_FACTOR,   copies: 5 },
    { def: WOLVERINE_FRENZIED_SLASHING, copies: 3 },
    { def: WOLVERINE_BERSERKER_RAGE,   copies: 1 },
  ],
};
