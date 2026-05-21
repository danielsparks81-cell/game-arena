import type { HeroCardDef } from '../types';

// Cyclops hero class — Ranged / Strength, X-Men.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const CYC_DETERMINATION: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyc_determination',
  className: 'Cyclops',
  cardName: 'Determination',
  cost: 2,
  baseRecruit: 3,
  classes: ['strength'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base recruit
};

export const CYC_OPTIC_BLAST: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyc_optic_blast',
  className: 'Cyclops',
  cardName: 'Optic Blast',
  cost: 3,
  baseAttack: 3,
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const CYC_UNENDING_ENERGY: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyc_unending_energy',
  className: 'Cyclops',
  cardName: 'Unending Energy',
  cost: 6,
  baseAttack: 4,
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify any additional effect beyond the base strike
};

export const CYC_XMEN_UNITED: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyc_xmen_united',
  className: 'Cyclops',
  cardName: 'X-Men United',
  cost: 8,
  baseAttack: 6,
  baseAttackScales: true,   // renders as 6+⚔
  classes: ['ranged'],
  teams: ['x-men'],
  // TODO: verify scaling condition from card text
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const CYCLOPS_CLASS = {
  className: 'Cyclops',
  cards: [
    { def: CYC_DETERMINATION,    copies: 5 },
    { def: CYC_OPTIC_BLAST,      copies: 5 },
    { def: CYC_UNENDING_ENERGY,  copies: 3 },
    { def: CYC_XMEN_UNITED,      copies: 1 },
  ],
};
