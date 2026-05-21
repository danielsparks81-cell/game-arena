import type { HeroCardDef } from '../types';

// Rogue hero class — X-Men, Strength/Covert/Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const ROGUE_BORROWED_BRAWN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_borrowed_brawn',
  className: 'Rogue',
  cardName: 'Borrowed Brawn',
  cost: 3,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['x-men'],
  text: '+1 Attack for each Strength hero you play this turn, including this one.',
  onPlay: [
    // Card IS Strength (counted). IncludeSelf: true counts this card too.
    { kind: 'gain_attack_per_class', cls: 'strength', bonus: 1, includeSelf: true },
  ],
};

export const ROGUE_ENERGY_DRAIN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_energy_drain',
  className: 'Rogue',
  cardName: 'Energy Drain',
  cost: 3,
  baseRecruit: 2,
  classes: ['covert'],
  teams: ['x-men'],
  text: '2 Recruit. X-Men: +1 Recruit.',
  onPlay: [
    // Card IS X-Men → need total ≥2.
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
};

export const ROGUE_COPY_POWERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_copy_powers',
  className: 'Rogue',
  cardName: 'Copy Powers',
  cost: 5,
  classes: ['instinct'],
  teams: ['x-men'],
  text: 'X-Men: +2 Recruit and draw a card.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [
        { kind: 'gain_recruit', amount: 2 },
        { kind: 'draw', amount: 1 },
      ] },
  ],
};

export const ROGUE_STEAL_ABILITIES: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_steal_abilities',
  className: 'Rogue',
  cardName: 'Steal Abilities',
  cost: 6,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['x-men'],
  text: '4 Attack. X-Men: +2 Attack and draw a card.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'x-men', minOthers: 2,
      effects: [
        { kind: 'gain_attack', amount: 2 },
        { kind: 'draw', amount: 1 },
      ] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const ROGUE_CLASS = {
  className: 'Rogue',
  cards: [
    { def: ROGUE_BORROWED_BRAWN,  copies: 5 },
    { def: ROGUE_ENERGY_DRAIN,    copies: 5 },
    { def: ROGUE_COPY_POWERS,     copies: 3 },
    { def: ROGUE_STEAL_ABILITIES, copies: 1 },
  ],
};
