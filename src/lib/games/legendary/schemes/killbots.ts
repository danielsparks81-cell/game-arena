import type { SchemeCardDef } from '../types';

// "Replace Earth's Leaders with Killbots" — bystanders are secretly robots.
//
// Official rules:
//   Setup:        5 Twists next to this Scheme. 18 total Bystanders in the
//                 Villain Deck.
//   Special:      Bystanders in the Villain Deck count as Killbot Villains,
//                 with [strike] equal to the number of Twists next to this
//                 Scheme.
//   Twist:        Put the Twist next to this Scheme.
//   Evil Wins:    If 5 "Killbots" escape.
//
// Fully wired:
//   • 18 Bystanders seeded into the Villain Deck; each is promoted to a
//     Killbot Villain on reveal (enterCity), with [strike] = current twist
//     count (effectiveCityStrike killbot branch).
//   • 3 Twists start next to the Scheme (+3 initial Killbot strike); 5 more
//     are shuffled into the deck. Each twist raises every Killbot's strike.
//   • Loss = 5 Killbots escape (evilWinsAfterEscapedKillbots), tracked via
//     state.escapedKillbots when a Killbot is pushed off the Bridge.

export const KILLBOTS: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_killbots',
  name: "Replace Earth's Leaders with Killbots",
  text: 'Setup: 5 Twists. 3 additional Twists next to this Scheme. 18 total Bystanders in the Villain Deck.\nSpecial Rules: Bystanders in the Villain Deck count as Killbot Villains, with [strike] equal to the number of Twists next to this Scheme.\nTwist: Put the Twist next to this Scheme.\nEvil Wins: If 5 "Killbots" escape.',
  // 8 total twists in the scheme: 3 start placed next to it (giving Killbots
  // an initial +3 strike), and 5 are shuffled into the Villain Deck.
  twists: 8,
  startingTwistsRevealed: 3,
  bystanders: 18,
  evilWinsAfterEscapedKillbots: 5,
};
