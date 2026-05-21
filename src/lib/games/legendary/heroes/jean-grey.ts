import type { HeroCardDef } from '../types';

// Jean Grey hero class — X-Men, Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const JEAN_GREY_PSYCHIC_SEARCH: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_psychic_search',
  className: 'Jean Grey',
  cardName: 'Psychic Search',
  cost: 2,
  baseAttack: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '2 Attack. Instinct: Draw a card.',
  onPlay: [
    // Card IS Instinct → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const JEAN_GREY_READ_YOUR_THOUGHTS: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_read_your_thoughts',
  className: 'Jean Grey',
  cardName: 'Read Your Thoughts',
  cost: 3,
  baseRecruit: 3,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '3 Recruit. Instinct: +1 Recruit.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
};

export const JEAN_GREY_MIND_OVER_MATTER: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_mind_over_matter',
  className: 'Jean Grey',
  cardName: 'Mind Over Matter',
  cost: 4,
  baseAttack: 4,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '4 Attack. Instinct: +1 Attack.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const JEAN_GREY_TELEKINETIC_MASTERY: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_telekinetic_mastery',
  className: 'Jean Grey',
  cardName: 'Telekinetic Mastery',
  cost: 6,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['instinct'],
  teams: ['x-men'],
  text: '+1 Attack for each Instinct hero you play this turn, including this one.',
  onPlay: [
    { kind: 'gain_attack_per_class', cls: 'instinct', bonus: 1, includeSelf: true },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const JEAN_GREY_CLASS = {
  className: 'Jean Grey',
  cards: [
    { def: JEAN_GREY_PSYCHIC_SEARCH,       copies: 5 },
    { def: JEAN_GREY_READ_YOUR_THOUGHTS,   copies: 5 },
    { def: JEAN_GREY_MIND_OVER_MATTER,     copies: 3 },
    { def: JEAN_GREY_TELEKINETIC_MASTERY,  copies: 1 },
  ],
};
