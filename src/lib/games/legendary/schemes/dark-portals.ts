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
// Fully wired:
//   • place_dark_portal twist effect: twist 1 → portal above the Mastermind
//     (+1 strike, persistent); twists 2-6 → leftmost portal-less city slot
//     (+1 strike to villains there, persistent). Stored on state.darkPortals.
//   • Persistent buffs feed effectiveCityStrike (portalBonus) and the
//     mastermind requirement, and show on the board.
//   • Twist 7 → Evil Wins (evilWinsAfterTwists: 7).

export const DARK_PORTALS: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_dark_portals',
  name: 'Portals to the Dark Dimension',
  text: 'Setup: 7 Twists. Each Twist is a Dark Portal.\nTwist 1: Put the Dark Portal above the Mastermind. The Mastermind gets +1[strike].\nTwists 2-6: Put the Dark Portal in the leftmost city space that doesn\'t yet have a Dark Portal. Villains in the space get +1[strike].\nTwist 7: Evil Wins!',
  twists: 7,
  evilWinsAfterTwists: 7,
  onTwist: [{ kind: 'place_dark_portal' }],
};
