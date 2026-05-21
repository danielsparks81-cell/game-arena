import type { HeroCardDef } from '../types';

// Gambit hero class — X-Men, Covert.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const GAMBIT_STACK_THE_DECK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_stack_the_deck',
  className: 'Gambit',
  cardName: 'Stack the Deck',
  cost: 2,
  baseRecruit: 1,
  classes: ['covert'],
  teams: ['x-men'],
  text: '1 Recruit. You may discard a card from your hand. If you do, draw a card.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, bonus: [{ kind: 'draw', amount: 1 }] },
  ],
};

export const GAMBIT_CARD_SHARK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_card_shark',
  className: 'Gambit',
  cardName: 'Card Shark',
  cost: 3,
  baseAttack: 2,
  classes: ['covert'],
  teams: ['x-men'],
  text: '2 Attack. You may discard a card from your hand. If you do, +2 Attack.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, bonus: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

export const GAMBIT_HYPNOTIC_CHARM: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_hypnotic_charm',
  className: 'Gambit',
  cardName: 'Hypnotic Charm',
  cost: 4,
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

export const GAMBIT_HIGH_STAKES_JACKPOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_high_stakes_jackpot',
  className: 'Gambit',
  cardName: 'High Stakes Jackpot',
  cost: 6,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['x-men'],
  text: '4 Attack. You may discard a card from your hand. If you do, +3 Attack.',
  onPlay: [
    { kind: 'discard_from_hand', up_to: 1, bonus: [{ kind: 'gain_attack', amount: 3 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const GAMBIT_CLASS = {
  className: 'Gambit',
  cards: [
    { def: GAMBIT_STACK_THE_DECK,       copies: 5 },
    { def: GAMBIT_CARD_SHARK,           copies: 5 },
    { def: GAMBIT_HYPNOTIC_CHARM,       copies: 3 },
    { def: GAMBIT_HIGH_STAKES_JACKPOT,  copies: 1 },
  ],
};
