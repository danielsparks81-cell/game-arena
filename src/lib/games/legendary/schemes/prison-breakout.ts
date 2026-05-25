import type { SchemeCardDef } from '../types';

// "Negative Zone Prison Breakout" — the iconic introductory scheme.
//
// Setup:  8 Twists, 2 Bystanders, + 1 extra Henchman group in the Villain Deck.
// Twist:  Play the top 2 cards of the Villain Deck.
// Lose:   12 Villains escape.

export const NEGATIVE_ZONE_PRISON_BREAKOUT: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_negative_zone',
  name: 'Negative Zone Prison Breakout',
  text: 'Setup: 8 Twists. Add an extra Henchman group to the Villain Deck.\nTwist: Play the top 2 cards of the Villain Deck.\nEvil Wins: If 12 Villains escape.',
  twists: 8,
  bystanders: 2,
  extraHenchmanGroups: 1,
  // Each Scheme Twist immediately plays 2 more cards from the Villain Deck.
  onTwistRevealCount: 2,
  // Primary loss condition: 12 villains escape the city.
  evilWinsAfterEscapes: 12,
};
