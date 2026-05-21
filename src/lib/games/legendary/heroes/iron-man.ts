import type { HeroCardDef } from '../types';

// Iron Man hero class — Tech / Ranged, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const IRON_ENDLESS_INVENTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'irm_endless_invention',
  className: 'Iron Man',
  cardName: 'Endless Invention',
  cost: 3,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['tech'],
  teams: ['avengers'],
};

export const IRON_REPULSOR_RAYS: HeroCardDef = {
  kind: 'hero',
  cardId: 'irm_repulsor_rays',
  className: 'Iron Man',
  cardName: 'Repulsor Rays',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,   // renders as 2+⚔
  classes: ['ranged'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const IRON_ARC_REACTOR: HeroCardDef = {
  kind: 'hero',
  cardId: 'irm_arc_reactor',
  className: 'Iron Man',
  cardName: 'Arc Reactor',
  cost: 5,
  baseAttack: 3,
  baseAttackScales: true,   // renders as 3+⚔
  classes: ['tech'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const IRON_QUANTUM_BREAKTHROUGH: HeroCardDef = {
  kind: 'hero',
  cardId: 'irm_quantum_breakthrough',
  className: 'Iron Man',
  cardName: 'Quantum Breakthrough',
  cost: 7,
  // No base stats — effect-only card. TODO: verify card text.
  classes: ['tech'],
  teams: ['avengers'],
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const IRON_MAN_CLASS = {
  className: 'Iron Man',
  cards: [
    { def: IRON_ENDLESS_INVENTION,     copies: 5 },
    { def: IRON_REPULSOR_RAYS,         copies: 5 },
    { def: IRON_ARC_REACTOR,           copies: 3 },
    { def: IRON_QUANTUM_BREAKTHROUGH,  copies: 1 },
  ],
};
