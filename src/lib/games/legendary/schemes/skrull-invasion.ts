import type { SchemeCardDef } from '../types';

// "Secret Invasion of the Skrull Shapeshifters" — heroes hide among villains.
//
// Official rules:
//   Setup:        8 Twists. 6 Heroes. Skrull Villain Group required.
//                 Shuffle 12 random Heroes from the Hero Deck into the
//                 Villain Deck.
//   Special:      Heroes in the Villain Deck count as Skrull Villains with
//                 [strike] equal to the Hero's [cost]+2. If you defeat that
//                 Hero, you gain it.
//   Twist:        The highest-cost Hero from the HQ moves into the Sewers as
//                 a Skrull Villain (as above).
//   Evil Wins:    If 6 Heroes get into the Escaped Villains pile.
//
// MVP implementation note: the "Heroes act as Villains in the Villain Deck"
// rule requires major engine surgery (hero-to-villain promotion, custom
// attack-cost mapping, hero-as-reward on defeat). For MVP we use
// `evilWinsAfterEscapes: 6` as a placeholder for the 6-Hero-escape timer,
// counting any villain escape against it. Skrull Villain Group not yet
// implemented. Card text preserves the official wording.

export const SKRULL_INVASION: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_skrull_invasion',
  name: 'Secret Invasion of the Skrull Shapeshifters',
  text: 'Setup: 8 Twists. 6 Heroes. Skrull Villain Group required. Shuffle 12 random Heroes from the Hero Deck into the Villain Deck.\nSpecial Rules: Heroes in the Villain Deck count as Skrull Villains with [strike] equal to the Heroes [cost]+2. If you defeat that Hero, you gain it.\nTwist: The highest-cost Hero from the HQ moves into the Sewers as a Skrull Villain, as above.\nEvil Wins: If 6 Heroes get into the Escaped Villains pile.',
  twists: 8,
  bystanders: 2,
  evilWinsAfterEscapes: 6,
};
