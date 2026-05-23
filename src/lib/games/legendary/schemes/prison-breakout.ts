import type { SchemeCardDef } from '../types';

// "Negative Zone Prison Breakout" — the iconic introductory scheme.
// 8 twists; on each twist, an additional villain card is revealed from the
// Villain Deck (we'll wire this in the engine). Evil wins when 8 villains
// have escaped OR all 8 twists have been revealed (we use the twist count
// as the loss timer for simplicity in MVP).

export const NEGATIVE_ZONE_PRISON_BREAKOUT: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_negative_zone',
  name: 'Negative Zone Prison Breakout',
  text: 'Scheme Twists: Reveal an extra Villain. Evil Wins if 8 Villains escape.',
  twists: 8,
  bystanders: 2,
  evilWinsAfterTwists: 8,   // backup: if all 8 twists are revealed evil also wins
  evilWinsAfterEscapes: 8,  // primary: evil wins the moment the 8th villain escapes
  // Each Scheme Twist causes one extra villain-deck reveal immediately.
  onTwistReveal: true,
};
