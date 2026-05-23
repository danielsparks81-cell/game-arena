import type { HeroCardDef } from '../types';

// Iron Man hero class — Avengers, Tech/Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const IRONMAN_ENDLESS_INVENTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_endless_invention',
  className: 'Iron Man',
  cardName: 'Endless Invention',
  cost: 3,
  classes: ['tech'],
  teams: ['avengers'],
  text: 'Draw a card.\n[tech]: Draw another card.',
  onPlay: [
    { kind: 'draw', amount: 1 },
    // Card IS Tech → need total ≥2 (at least 1 other Tech card played).
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const IRONMAN_REPULSOR_RAYS: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_repulsor_rays',
  className: 'Iron Man',
  cardName: 'Repulsor Rays',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['avengers'],
  text: '[ranged]: You get +1[strike].',
  onPlay: [
    // Card IS Ranged → need total ≥2 (at least 1 other Ranged card played).
    { kind: 'if_played_class_this_turn', cls: 'ranged', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const IRONMAN_ARC_REACTOR: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_arc_reactor',
  className: 'Iron Man',
  cardName: 'Arc Reactor',
  cost: 5,
  baseAttack: 3,
  baseAttackScales: true,
  classes: ['tech'],
  teams: ['avengers'],
  text: '[tech]: You get +1[strike] for each other [tech] Hero you played this turn.',
  onPlay: [
    // gain_attack_per_class with includeSelf: false naturally gives 0
    // when no other Tech cards have been played (self counts as 1, minus 1 = 0).
    { kind: 'gain_attack_per_class', cls: 'tech', bonus: 1, includeSelf: false },
  ],
};

export const IRONMAN_QUANTUM_BREAKTHROUGH: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_quantum_breakthrough',
  className: 'Iron Man',
  cardName: 'Quantum Breakthrough',
  cost: 7,
  classes: ['tech'],
  teams: ['avengers'],
  text: 'Draw two cards.\n[tech]: Draw two more cards.',
  onPlay: [
    { kind: 'draw', amount: 2 },
    // Card IS Tech → need total ≥2 (at least 1 other Tech card played).
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'draw', amount: 2 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const IRON_MAN_CLASS = {
  className: 'Iron Man',
  cards: [
    { def: IRONMAN_ENDLESS_INVENTION,    copies: 5 },
    { def: IRONMAN_REPULSOR_RAYS,        copies: 5 },
    { def: IRONMAN_ARC_REACTOR,          copies: 3 },
    { def: IRONMAN_QUANTUM_BREAKTHROUGH, copies: 1 },
  ],
};
