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
// Fully wired:
//   • requiresVillainGroup 'skrulls' forces the Skrull group into the lineup.
//   • heroClassCountForPlayers → 6 Hero classes.
//   • shuffleHeroesIntoVillainDeck: 12 — 12 Heroes get tagged as Skrull
//     Villains (state.skrullHeroes) and mixed into the Villain Deck. On
//     reveal they enter the city; their [strike] = [cost]+2; defeating one
//     puts it in your discard (you gain it), not the victory pile.
//   • Twist (skrull_invasion_twist): the highest-cost HQ Hero slips into the
//     Sewers as a Skrull, then the HQ refills.
//   • Loss = 6 Heroes escape (evilWinsAfterEscapedHeroes / state.escapedHeroes).

export const SKRULL_INVASION: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_skrull_invasion',
  name: 'Secret Invasion of the Skrull Shapeshifters',
  text: 'Setup: 8 Twists. 6 Heroes. Skrull Villain Group required. Shuffle 12 random Heroes from the Hero Deck into the Villain Deck.\nSpecial Rules: Heroes in the Villain Deck count as Skrull Villains with [strike] equal to the Heroes [cost]+2. If you defeat that Hero, you gain it.\nTwist: The highest-cost Hero from the HQ moves into the Sewers as a Skrull Villain.\nEvil Wins: If 6 Heroes get into the Escaped Villains pile.',
  twists: 8,
  requiresVillainGroup: 'skrulls',
  heroClassCountForPlayers: () => 6,
  shuffleHeroesIntoVillainDeck: 12,
  evilWinsAfterEscapedHeroes: 6,
  onTwist: [{ kind: 'skrull_invasion_twist' }],
};
