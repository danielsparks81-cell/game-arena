import type { HeroCardDef } from '../types';

// Captain America hero class — Avengers, Strength/Instinct/Tech/Covert.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const CAP_PERFECT_TEAMWORK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_perfect_teamwork',
  className: 'Captain America',
  cardName: 'Perfect Teamwork',
  cost: 4,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: 'You get +1[strike] for each color of Hero you have.',
  onPlay: [
    { kind: 'gain_attack_per_unique_class_in_hand' },
  ],
};

export const CAP_AVENGERS_ASSEMBLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_avengers_assemble',
  className: 'Captain America',
  cardName: 'Avengers Assemble!',
  cost: 3,
  baseRecruit: 0,
  baseRecruitScales: true,
  classes: ['instinct'],
  teams: ['avengers'],
  text: 'You get +1[recruit] for each color of Hero you have.',
  onPlay: [
    { kind: 'gain_recruit_per_unique_class_in_hand' },
  ],
};

export const CAP_DIVING_BLOCK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_diving_block',
  className: 'Captain America',
  cardName: 'Diving Block',
  cost: 6,
  baseAttack: 4,
  classes: ['tech'],
  teams: ['avengers'],
  text: 'If you would gain a Wound, you may reveal this card and draw a card instead.',
  // No onPlay — this card's power activates passively from hand.
  onHand: [{ kind: 'prevent_wound_draw' }],
};

export const CAP_A_DAY_LIKE_ANY_OTHER: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_a_day_like_any_other',
  className: 'Captain America',
  cardName: 'A Day Unlike Any Other',
  cost: 7,
  baseAttack: 3,
  baseAttackScales: true,
  classes: ['covert'],
  teams: ['avengers'],
  text: '[avengers]: You get +3[strike] for each other [avengers] Hero you played this turn.',
  onPlay: [
    { kind: 'gain_attack_per_team', team: 'avengers', bonus: 3, includeSelf: false },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const CAPTAIN_AMERICA_CLASS = {
  className: 'Captain America',
  cards: [
    { def: CAP_PERFECT_TEAMWORK,     copies: 5 },
    { def: CAP_AVENGERS_ASSEMBLE,    copies: 5 },
    { def: CAP_DIVING_BLOCK,         copies: 3 },
    { def: CAP_A_DAY_LIKE_ANY_OTHER, copies: 1 },
  ],
};
