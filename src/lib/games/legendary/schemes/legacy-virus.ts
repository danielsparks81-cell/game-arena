import type { SchemeCardDef } from '../types';

// "The Legacy Virus" — Tech heroes are the cure; the wound stack is the timer.
//
// Official rules:
//   Setup:      8 Twists. Wound stack holds 6 Wounds per player.
//   Twist:      Each player reveals a [tech] Hero or gains a Wound.
//   Evil Wins:  If the Wound stack runs out.
//
// Now fully wired: the engine respects woundsPerPlayer at setup (6 × player
// count) and checks evilWinsIfWoundDeckEmpty after every wound-stealing
// operation. The twist effect uses the pre-existing
// each_player_reveal_tech_hero_or_wound effect.

export const LEGACY_VIRUS: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_legacy_virus',
  name: 'The Legacy Virus',
  text: 'Setup: 8 Twists. Wound stack holds 6 Wounds per player.\nTwist: Each player reveals a [tech] hero or gains a Wound.\nEvil Wins: If the Wound stack runs out.',
  twists: 8,
  // No explicit bystander count — use the default per-player table.
  woundsPerPlayer: 6,
  evilWinsIfWoundDeckEmpty: true,
  onTwist: [
    { kind: 'each_player_reveal_tech_hero_or_wound', source: 'Legacy Virus' },
  ],
};
