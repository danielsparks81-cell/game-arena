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
// MVP implementation note: 18 bystanders are seeded into the Villain Deck.
// The "bystanders as Villains with escalating attack" rule needs new engine
// work (Effect for "promote bystander to villain", strike scaling, etc.).
// Loss uses `evilWinsAfterTwists: 5` as a placeholder for the 5-Killbot-escape
// timer. Card text preserves the official wording.

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
  // Loss timer placeholder: real rule is "5 Killbot bystanders escape" which
  // needs bystander-escape tracking. evilWinsAfterTwists fires when all 8
  // twists are out — roughly approximates "the game is collapsing".
  evilWinsAfterTwists: 8,
};
