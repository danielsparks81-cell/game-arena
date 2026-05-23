import type { HeroCardDef } from '../types';

// Cyclops hero class — X-Men, Strength/Ranged.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const CYCLOPS_DETERMINATION: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_determination',
  className: 'Cyclops',
  cardName: 'Determination',
  cost: 2,
  baseRecruit: 3,
  classes: ['strength'],
  teams: ['x-men'],
  text: 'To play this card, you must discard a card from your hand.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, mandatory: true, bonus: [] },
  ],
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
  text: 'To play this card, you must discard a card from your hand.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, mandatory: true, bonus: [] },
  ],
};

export const CYCLOPS_UNENDING_ENERGY: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_unending_energy',
  className: 'Cyclops',
  cardName: 'Unending Energy',
  cost: 6,
  baseAttack: 4,
  classes: ['ranged'],
  teams: ['x-men'],
  text: 'If a card effect makes you discard this card, you may return this card to your hand.',
  // No onPlay — ability is passive, triggers when chosen in a discard effect.
  onHand: [{ kind: 'return_to_hand_if_discarded' }],
};

export const CYCLOPS_X_MEN_UNITED: HeroCardDef = {
  kind: 'hero',
  cardId: 'cyclops_x_men_united',
  className: 'Cyclops',
  cardName: 'X-Men United',
  cost: 8,
  baseAttack: 6,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['x-men'],
  text: '[x-men]: You get +2[strike] for each other [x-men] Hero you have played this turn.',
  onPlay: [
    { kind: 'gain_attack_per_team', team: 'x-men', bonus: 2, includeSelf: false },
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
