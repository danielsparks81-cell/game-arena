import type { HeroCardDef } from '../types';

// Iron Man hero class — Avengers, Tech/Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const IRONMAN_ENDLESS_INVENTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_endless_invention',
  className: 'Iron Man',
  cardName: 'Endless Invention',
  cost: 3,
  baseRecruit: 2,
  classes: ['tech'],
  teams: ['avengers'],
  text: '2 Recruit. Tech: +1 Recruit.',
  onPlay: [
    // Card IS Tech → need total ≥2.
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
};

export const IRONMAN_REPULSOR_RAYS: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_repulsor_rays',
  className: 'Iron Man',
  cardName: 'Repulsor Rays',
  cost: 4,
  baseAttack: 2,
  classes: ['tech'],
  teams: ['avengers'],
  text: '2 Attack. Tech: +1 Attack.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
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
  classes: ['tech'],
  teams: ['avengers'],
  text: '3 Attack. Tech: +1 Attack and +1 Recruit.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [
        { kind: 'gain_attack',  amount: 1 },
        { kind: 'gain_recruit', amount: 1 },
      ] },
  ],
};

export const IRONMAN_QUANTUM_BREAKTHROUGH: HeroCardDef = {
  kind: 'hero',
  cardId: 'ironman_quantum_breakthrough',
  className: 'Iron Man',
  cardName: 'Quantum Breakthrough',
  cost: 6,
  baseRecruit: 5,
  classes: ['tech'],
  teams: ['avengers'],
  text: '5 Recruit. Tech: +2 Recruit.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 2 }] },
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
