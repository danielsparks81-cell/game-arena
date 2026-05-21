import type { HeroCardDef } from '../types';

// Cyclops hero class — X-Men, Ranged/Strength.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const CYCLOPS_DETERMINATION: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_determination',
  className: 'Cyclops',
  cardName: 'Determination',
  cost: 2,
  baseRecruit: 3,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '3 Recruit.',
};

export const CYCLOPS_OPTIC_BLAST: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_optic_blast',
  className: 'Cyclops',
  cardName: 'Optic Blast',
  cost: 3,
  baseAttack: 3,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '3 Attack.',
};

export const CYCLOPS_UNENDING_ENERGY: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_unending_energy',
  className: 'Cyclops',
  cardName: 'Unending Energy',
  cost: 4,
  baseAttack: 4,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '4 Attack. X-Men: +1 Attack.',
  onPlay: [
    // Card IS X-Men → need total ≥2.
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const CYCLOPS_X_MEN_UNITED: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_x_men_united',
  className: 'Cyclops',
  cardName: 'X-Men United',
  cost: 6,
  baseAttack: 6,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '6 Attack. X-Men: Draw a card.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [{ kind: 'draw', amount: 1 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const CYCLOPS_CLASS = {
  className: 'Cyclops',
  cards: [
    { def: CYCLOPS_DETERMINATION,    copies: 5 },
    { def: CYCLOPS_OPTIC_BLAST,      copies: 5 },
    { def: CYCLOPS_UNENDING_ENERGY,  copies: 3 },
    { def: CYCLOPS_X_MEN_UNITED,     copies: 1 },
  ],
};
