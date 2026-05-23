import type { HeroCardDef } from '../types';

// Rogue hero class — X-Men, Strength/Covert.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const ROGUE_BORROWED_BRAWN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_borrowed_brawn',
  className: 'Rogue',
  cardName: 'Borrowed Brawn',
  cost: 4,
  baseAttack: 1,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['x-men'],
  text: '[strength]: You get +3[strike].',
  onPlay: [
    // Card IS Strength → need total ≥2 (at least 1 other Strength card played).
    { kind: 'if_played_class_this_turn', cls: 'strength', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

export const ROGUE_ENERGY_DRAIN: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_energy_drain',
  className: 'Rogue',
  cardName: 'Energy Drain',
  cost: 3,
  baseRecruit: 2,
  baseRecruitScales: true,
  classes: ['covert'],
  teams: ['x-men'],
  text: '[covert]: You may KO a card from your hand or discard pile. If you do, you get +1[recruit].',
  onPlay: [
    // Card IS Covert → need total ≥2 (at least 1 other Covert card played).
    { kind: 'if_played_class_this_turn', cls: 'covert', minOthers: 2,
      effects: [{ kind: 'ko_from_hand', up_to: 1, sources: ['hand', 'discard'],
        bonus: [{ kind: 'gain_recruit', amount: 1 }] }] },
  ],
};

export const ROGUE_COPY_POWERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'rogue_copy_powers',
  className: 'Rogue',
  cardName: 'Copy Powers',
  cost: 5,
  classes: ['covert'],
  teams: ['x-men'],
  text: 'Play this card as a copy of another Hero you played this turn. This card is both [covert] and the color you copy.',
  onPlay: [
    { kind: 'copy_played_hero' },
  ],
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
  text: 'Each player discards the top card of their deck. Play a copy of each of those cards.',
  onPlay: [
    { kind: 'play_copy_each_player_top_card' },
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
