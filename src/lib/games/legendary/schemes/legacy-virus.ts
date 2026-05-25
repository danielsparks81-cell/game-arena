import type { SchemeCardDef } from '../types';

// "The Legacy Virus" — Tech heroes are the cure; the wound stack is the timer.
//
// Official rules:
//   Setup:      8 Twists. Wound stack holds 6 Wounds per player.
//   Twist:      Each player reveals a [tech] Hero or gains a Wound.
//   Evil Wins:  If the Wound stack runs out.
//
// MVP implementation note: the "wound stack holds 6 per player" sizing and
// the "wound stack empty = loss" condition both need new engine work (wound
// supply is currently effectively unlimited). The twist effect itself works
// today via the pre-existing `each_player_reveal_tech_hero_or_wound` effect.
// Loss falls back to `evilWinsAfterTwists: 8`. Card text preserves the
// official wording.

export const LEGACY_VIRUS: SchemeCardDef = {
  kind: 'scheme',
  cardId: 'scheme_legacy_virus',
  name: 'The Legacy Virus',
  text: 'Setup: 8 Twists. Wound stack holds 6 Wounds per player.\nTwist: Each player reveals a [tech] hero or gains a Wound.\nEvil Wins: If the Wound stack runs out.',
  twists: 8,
  bystanders: 2,
  evilWinsAfterTwists: 8,
  onTwist: [
    { kind: 'each_player_reveal_tech_hero_or_wound' },
  ],
};
