import type { HeroCardDef } from '../types';

// Jean Grey hero class — X-Men, Ranged/Covert.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const JEAN_GREY_PSYCHIC_SEARCH: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_psychic_search',
  className: 'Jean Grey',
  cardName: 'Psychic Search',
  cost: 3,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '[x-men]: Rescue a Bystander.',
  onPlay: [
    // Card IS X-Men → need total ≥2 (at least 1 other X-Men card played).
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [{ kind: 'rescue_bystander', amount: 1 }] },
  ],
};

export const JEAN_GREY_READ_YOUR_THOUGHTS: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_read_your_thoughts',
  className: 'Jean Grey',
  cardName: 'Read Your Thoughts',
  cost: 5,
  baseRecruit: 3,
  baseRecruitScales: true,
  classes: ['covert'],
  teams: ['x-men'],
  text: 'Whenever you rescue a Bystander this turn, you get +1[recruit].',
  onPlay: [
    { kind: 'gain_recruit_per_bystander_rescued_this_turn' },
  ],
};

export const JEAN_GREY_MIND_OVER_MATTER: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_mind_over_matter',
  className: 'Jean Grey',
  cardName: 'Mind Over Matter',
  cost: 6,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['x-men'],
  text: 'Whenever you rescue a Bystander this turn, draw a card.',
  onPlay: [
    { kind: 'draw_per_bystander_rescued_this_turn' },
  ],
};

export const JEAN_GREY_TELEKINETIC_MASTERY: HeroCardDef = {
  kind: 'hero',
  cardId: 'jean_grey_telekinetic_mastery',
  className: 'Jean Grey',
  cardName: 'Telekinetic Mastery',
  cost: 7,
  baseAttack: 5,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['x-men'],
  text: 'Whenever you rescue a Bystander this turn, you get +1[strike].\n[x-men]: Rescue a Bystander for each other [x-men] Hero you played this turn.',
  onPlay: [
    // Line 1: set up the per-rescue attack bonus (fires before line 2's rescues,
    // so those rescues immediately benefit from it).
    { kind: 'gain_attack_per_bystander_rescued_this_turn' },
    // Line 2: card IS X-Men → need total ≥2 to have any "other" x-men to count.
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [{ kind: 'rescue_bystander_per_xmen_played' }] },
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
