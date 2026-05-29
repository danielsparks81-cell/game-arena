import type { SchemeCardDef } from '../types';

// "Midtown Bank Robbery" — villains pile up Bystanders as hostages.
//
// Official rules:
//   Setup:      8 Twists. 12 total Bystanders in the Villain Deck.
//   Special:    Each Villain gets +1[strike] for each Bystander it has.
//   Twist:      Any Villain in the Bank captures 2 Bystanders. Then play the
//               top card of the Villain Deck.
//   Evil Wins:  When 8 Bystanders are carried away by escaping Villains.
//
// Fully wired:
//   • Twist captures 2 Bystanders at the Bank + reveals the next villain card.
//   • "+1[strike] per held Bystander" via villainStrikePerBystander.
//   • Loss = 8 Bystanders carried away by escaping Villains
//     (evilWinsAfterEscapedBystanders) — the engine now increments
//     state.escapedBystanders whenever a Villain holding Bystanders escapes
//     off the Bridge, and ends the game when the count hits 8.

export const MIDTOWN_BANK_ROBBERY: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_bank_robbery',
  name: 'Midtown Bank Robbery',
  text: 'Setup: 8 Twists. 12 total Bystanders in the Villain Deck.\nSpecial Rules: Each Villain gets +1[strike] for each Bystander it has.\nTwist: Any Villain in the Bank captures 2 Bystanders. Then play the top card of the Villain Deck.\nEvil Wins: When 8 Bystanders are carried away by escaping Villains.',
  twists: 8,
  bystanders: 12,
  villainStrikePerBystander: 1,
  // Real loss: 8 Bystanders carried away by escaping Villains (tracked via
  // state.escapedBystanders), replacing the old twist-count placeholder.
  evilWinsAfterEscapedBystanders: 8,
  onTwist: [
    // The Villain in the Bank space captures 2 Bystanders (auto — no choice),
    // then the top Villain Deck card is revealed.
    { kind: 'bank_villain_captures_bystanders', amount: 2 },
    { kind: 'villain_deck_reveal_top', amount: 1 },
  ],
};
