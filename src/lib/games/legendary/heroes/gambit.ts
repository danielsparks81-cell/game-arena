import type { HeroCardDef } from '../types';

// Gambit hero class — X-Men, Covert/Ranged/Instinct.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const GAMBIT_STACK_THE_DECK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_stack_the_deck',
  className: 'Gambit',
  cardName: 'Stack the Deck',
  cost: 2,
  classes: ['covert'],
  teams: ['x-men'],
  text: 'Draw two cards. Then put a card from your hand on top of your deck.',
  onPlay: [
    { kind: 'draw', amount: 2 },
    { kind: 'put_card_from_hand_on_deck' },
  ],
};

export const GAMBIT_CARD_SHARK: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_card_shark',
  className: 'Gambit',
  cardName: 'Card Shark',
  cost: 4,
  baseAttack: 2,
  classes: ['ranged'],
  teams: ['x-men'],
  text: 'Reveal the top card of your deck. If it\'s an [x-men] Hero, draw it.',
  onPlay: [
    { kind: 'reveal_top_draw_if_xmen' },
  ],
};

export const GAMBIT_HYPNOTIC_CHARM: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_hypnotic_charm',
  className: 'Gambit',
  cardName: 'Hypnotic Charm',
  cost: 3,
  baseRecruit: 2,
  classes: ['instinct'],
  teams: ['x-men'],
  text: 'Reveal the top card of your deck. Discard it or put it back.\n[instinct]: Do the same thing to each other player\'s deck.',
  onPlay: [
    { kind: 'reveal_top_discard_or_return' },
    // Card IS instinct, so need total ≥ 2 (1 other instinct card this turn).
    { kind: 'if_played_class_this_turn', cls: 'instinct', minOthers: 2,
      effects: [{ kind: 'reveal_top_discard_or_return_others' }] },
  ],
};

export const GAMBIT_HIGH_STAKES_JACKPOT: HeroCardDef = {
  kind: 'hero',
  cardId: 'gambit_high_stakes_jackpot',
  className: 'Gambit',
  cardName: 'High Stakes Jackpot',
  cost: 7,
  baseAttack: 4,
  baseAttackScales: true,
  classes: ['instinct'],
  teams: ['x-men'],
  text: 'Reveal the top card of your deck. You get +[strike] equal to that card\'s cost.',
  onPlay: [
    { kind: 'gain_attack_equal_to_top_card_cost' },
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
