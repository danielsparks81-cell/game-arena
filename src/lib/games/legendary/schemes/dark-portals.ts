import type { SchemeCardDef } from '../types';

// "Portals to the Dark Dimension" — escalating attack buffs across the city.
//
// Official rules:
//   Setup:    7 Twists. Each Twist is a Dark Portal.
//   Twist 1:  Put the Dark Portal above the Mastermind.
//             The Mastermind gets +1[strike].
//   Twist 2-6: Put the Dark Portal in the leftmost city space that doesn't
//              yet have a Dark Portal. Villains in the space get +1[strike].
//   Twist 7:  Evil Wins!
//
// MVP implementation note: the per-twist portal-placement and per-location
// strike buff need new engine work (no concept of "portal at city slot" yet).
// We use `evilWinsAfterTwists: 7` which correctly fires Evil Wins on twist 7.
// Card text preserves the official wording.

export const DARK_PORTALS: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_dark_portals',
  name: 'Portals to the Dark Dimension',
  text: 'Setup: 7 Twists. Each Twist is a Dark Portal.\nTwist 1: Put the Dark Portal above the Mastermind. The Mastermind gets +1[strike].\nTwists 2-6: Put the Dark Portal in the leftmost city space that doesn\'t yet have a Dark Portal. Villains in the space get +1[strike].\nTwist 7: Evil Wins!',
  twists: 7,
  bystanders: 2,
  evilWinsAfterTwists: 7,
};
