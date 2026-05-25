import type { SchemeCardDef } from '../types';

// "Unleash the Power of the Cosmic Cube" — escalating wound scheme.
//
// Setup:     8 Twists, 2 Bystanders.
// Twist 1-4: Nothing happens.
// Twist 5-6: Each player gains a Wound.
// Twist 7:   Each player gains 3 Wounds.
// Twist 8:   Evil Wins!

export const COSMIC_CUBE: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_cosmic_cube',
  name: 'Unleash the Power of the Cosmic Cube',
  text: 'Setup: 8 Twists.\nTwist 1-4: Nothing happens.\nTwist 5-6: Each player gains a Wound.\nTwist 7: Each player gains 3 Wounds.\nTwist 8: Evil Wins!',
  twists: 8,
  bystanders: 2,
  evilWinsAfterTwists: 8,
  onTwist: [
    // Twists 5–6: one Wound per player.
    { kind: 'if_twists_revealed', min: 5, max: 6, effects: [{ kind: 'gain_wound' }] },
    // Twist 7: three Wounds per player.
    { kind: 'if_twists_revealed', min: 7, max: 7, effects: [
      { kind: 'gain_wound' },
      { kind: 'gain_wound' },
      { kind: 'gain_wound' },
    ]},
  ],
};
