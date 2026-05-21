import type { HeroCardDef } from '../types';

// Rogue hero class — Strength / Covert, X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const ROGUE_BORROWED_BRAWN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_borrowed_brawn',
  className: 'Rogue',
  cardName: 'Borrowed Brawn',
  cost: 4,
  baseAttack: 1,
  baseAttackScales: true,   // renders as 1+⚔
  classes: ['strength'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

export const ROGUE_ENERGY_DRAIN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_energy_drain',
  className: 'Rogue',
  cardName: 'Energy Drain',
  cost: 3,
  baseRecruit: 2,
  baseRecruitScales: true,  // renders as 2+★
  classes: ['covert'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

export const ROGUE_COPY_POWERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_copy_powers',
  className: 'Rogue',
  cardName: 'Copy Powers',
  cost: 5,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['covert'],
  teams: ['x-men'],
};

export const ROGUE_STEAL_ABILITIES: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_steal_abilities',
  className: 'Rogue',
  cardName: 'Steal Abilities',
  cost: 8,
  baseAttack: 4,
  classes: ['strength'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const ROGUE_CLASS = {
  className: 'Rogue',
  cards: [
    { def: ROGUE_BORROWED_BRAWN,   copies: 5 },
    { def: ROGUE_ENERGY_DRAIN,     copies: 5 },
    { def: ROGUE_COPY_POWERS,      copies: 3 },
    { def: ROGUE_STEAL_ABILITIES,  copies: 1 },
  ],
};
