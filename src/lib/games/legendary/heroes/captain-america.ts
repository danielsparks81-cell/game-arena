import type { HeroCardDef } from '../types';

// Captain America hero class — Avengers, Strength/Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const CAP_PERFECT_TEAMWORK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_perfect_teamwork',
  className: 'Captain America',
  cardName: 'Perfect Teamwork',
  cost: 3,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['avengers'],
  text: '+1 Attack for each other Avengers hero you play this turn.',
  onPlay: [
    // Card IS Avengers (already counted). "Other" = total - 1 → includeSelf: false.
    { kind: 'gain_attack_per_team', team: 'avengers', bonus: 1, includeSelf: false },
  ],
};

export const CAP_AVENGERS_ASSEMBLE: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_avengers_assemble',
  className: 'Captain America',
  cardName: 'Avengers Assemble!',
  cost: 4,
  baseRecruit: 0,
  baseRecruitScales: true,
  classes: ['instinct'],
  teams: ['avengers'],
  text: '+1 Recruit for each other Avengers hero you play this turn.',
  onPlay: [
    { kind: 'gain_recruit_per_team', team: 'avengers', bonus: 1, includeSelf: false },
  ],
};

export const CAP_DIVING_BLOCK: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_diving_block',
  className: 'Captain America',
  cardName: 'Diving Block',
  cost: 5,
  baseAttack: 4,
  classes: ['strength'],
  teams: ['avengers'],
  text: '4 Attack. You may KO a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const CAP_A_DAY_LIKE_ANY_OTHER: HeroCardDef = {
  kind: 'hero',
  cardId: 'cap_a_day_like_any_other',
  className: 'Captain America',
  cardName: 'A Day Like Any Other',
  cost: 7,
  baseAttack: 3,
  classes: ['instinct'],
  teams: ['avengers'],
  text: '3 Attack. Avengers: +2 Attack.',
  onPlay: [
    // Card IS Avengers → need total ≥2 (self + ≥1 other).
    { kind: 'if_played_team_this_turn', team: 'avengers', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 2 }] },
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
