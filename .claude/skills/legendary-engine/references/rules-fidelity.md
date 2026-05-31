# Rules fidelity — making the engine match the printed card

Almost every Legendary bug this project hit was a **fidelity mismatch**: the
engine did *something*, but not what the card text says. As you layer on more
cards and rulesets, this is the failure mode to guard against. The card's
printed text is the spec; the engine must match it exactly.

## The audit habit

When you add or touch a card, read its printed text and verify each clause maps
to engine behavior. Concretely:

1. **WHO** does the text target? "you" (active player) vs "each player" vs "each
   OTHER player" vs "the player to your left". Off-by-one on this is the most
   common bug (Lizard hit the active player; Xavier's Nemesis over-counted x-men
   by 1 because it copied a self-subtraction that only applies to hero cards).
2. **WHAT** zone / count? "KO a Hero" vs "KO a card"; "the villain in the Bank"
   vs "any villain"; "2 Bystanders" vs "a Bystander". Bank Robbery captured the
   wrong villains because it reused Deadpool's *choose-any* effect instead of a
   Bank-specific one.
3. **CHOICE or AUTO?** "you may" / "choose" / "of your choice" = the player must
   be **prompted** (a PendingChoice), not auto-resolved. Auto-picking the
   cheapest/top card to "simulate" the choice is wrong — Juggernaut, Magneto,
   Red Skull, and Random Acts all shipped auto-resolve bugs. If the text lets
   the player decide, the engine must ask.
4. **WHEN / how many times?** Reveal-time per-player effects resolve in turn
   order at trigger (sequential-strike pipeline), not on each player's next
   turn. Twist/board effects fire **once**, not per-player.
5. **Strike / cost math.** Effective city strike runs through ONE helper,
   `effectiveCityStrike` in cards.ts — printed attack, minus location debuff
   (Storm), plus `villainStrikePerBystander * bystanders` (Bank Robbery), plus
   Dark Portal bonus, with attach-hero / killbot / skrull-hero overrides
   replacing the printed value wholesale. Both `doFightCity` (the fight gate) and
   the board (`CitySlot`) call it, so the displayed strike can never disagree
   with the enforced one. If you add a strike modifier, add it here, not in two
   places.

## Loss-timer fidelity

Schemes encode their "evil wins" condition in typed fields, not ad-hoc
placeholders: `evilWinsAfterTwists`, `evilWinsAfterEscapes`,
`evilWinsAfterEscapedBystanders`, `evilWinsAfterEscapedKillbots`,
`evilWinsAfterEscapedHeroes`, `evilWinsIfWoundDeckEmpty`,
`evilWinsIfHeroDeckEmpty`. Use the one that matches the printed "Evil Wins"
line, and make sure the corresponding counter (`escapedBystanders`,
`escapedKillbots`, …) is actually incremented on the triggering event. A scheme
that "feels endless" usually has a counter that never increments.

## Player-count scaling

Real Legendary scales setup by player count (twists, hero classes, bystanders,
villain groups, special 4-5 player rules like Warmup Rounds; 1-player solo has
its own henchmen + twist-tuck). When adding a scheme, check whether its Setup
line has player-count overrides and wire them via the typed scheme fields
(`twistsForPlayers`, `heroClassCountForPlayers`, `bystanders`,
`startingTwistsRevealed`, `requiresVillainGroup`, `shuffleHeroesIntoVillainDeck`).

## Randomizer is fair — don't "fix" clumping

`shuffle` is Fisher-Yates and was Monte-Carlo verified unbiased. If a tester
reports "6 scheme twists in a row," that's deck density (a solo deck is a high
fraction of twists/bystanders), not a shuffle bug. Don't add anti-clumping
hacks; they'd make the deck *less* random.

## When you finish a content change

Re-read the card text one more time against the diff and ask: "If I handed this
card to a rules lawyer, would the engine's behavior survive?" Then add a
regression test that encodes the specific clause you implemented (e.g. "a
Hero-Skrull is fightable at cost+2 and is GAINED to discard, not VP"). The test
is what keeps the fidelity from rotting when the next card touches shared code.
