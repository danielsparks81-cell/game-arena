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
// MVP implementation note: the "Bank" city location is the leftmost slot in
// our city grid; `villain_captures_bystander` already lets a villain there
// grab a bystander. We chain two of those plus a fresh top-of-deck reveal
// on each twist. The "+1[strike] per attached Bystander" rule is driven by
// the `villainStrikePerBystander` scheme flag — the engine adds it to the
// fight requirement and the card art shows the boosted strike. Loss uses
// `evilWinsAfterTwists: 8` as a placeholder for the "8 carried-away
// Bystanders" timer — proper escape-tracking still to be added. Card text
// preserves the official wording.

export const MIDTOWN_BANK_ROBBERY: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_bank_robbery',
  name: 'Midtown Bank Robbery',
  text: 'Setup: 8 Twists. 12 total Bystanders in the Villain Deck.\nSpecial Rules: Each Villain gets +1[strike] for each Bystander it has.\nTwist: Any Villain in the Bank captures 2 Bystanders. Then play the top card of the Villain Deck.\nEvil Wins: When 8 Bystanders are carried away by escaping Villains.',
  twists: 8,
  bystanders: 12,
  evilWinsAfterTwists: 8,
  villainStrikePerBystander: 1,
  onTwist: [
    { kind: 'villain_captures_bystander' },
    { kind: 'villain_captures_bystander' },
    { kind: 'villain_deck_reveal_top', amount: 1 },
  ],
};
