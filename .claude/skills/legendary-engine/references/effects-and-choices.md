# Effects and PendingChoices

The two declarative systems that make card text executable. Authoring cards =
composing `Effect`s; anything that needs player input = a `PendingChoice`.

## Effects

An `Effect` (discriminated union in types.ts) is one atomic, declarative step.
Card defs carry `Effect[]` in `onPlay` (heroes), `ambush`/`fight`/`escape`
(villains), `strike` (masterminds), `onTwist` (schemes), `fightSelf`/`fightOthers`
(tactics). `resolveEffect(state, me, effect)` is the single switch that executes
them.

Design rules:

- **Atomic.** One effect = one small thing (`gain_attack`, `draw`,
  `rescue_bystander`). Compose multiple; don't build mega-effects.
- **`me` is the context player**, not always the active player. During a
  sequential strike or a per-player iteration, `me` is whoever the effect is
  being applied to. Read `me`, not `state.players[state.currentPlayerIdx]`,
  unless you specifically need the active player.
- **Per-player effects self-iterate.** If the card says "each player …", loop
  `state.players` *inside* the effect case (see `each_player_gains_wound`). Then
  callers fire it once. Never make the caller loop — that double-fires in
  multiplayer (see invariant #2 in SKILL.md).
- **Conditionals are effects too.** `if_played_class_this_turn`,
  `if_recruit_ge`, `if_twists_revealed` nest `effects: Effect[]` and fire them
  only when the condition holds. `minOthers` counts include the playing card
  itself because `playedThisTurn` counters are bumped *before* `onPlay` fires —
  so "Covert: +1" on a Covert card needs `minOthers: 2` (itself + 1 other).

When you add a kind: update the `Effect` union (types.ts), handle it in
`resolveEffect` (engine.ts), and add a case to `defaultEffectForKind` in
`LegendarySandbox.tsx` (tsc enforces exhaustiveness — a missing case fails the
build, which is the guardrail working).

## PendingChoices

A `PendingChoice` (union in types.ts) parks the turn until the player resolves
it. While `state.thisTurn.pendingChoice` is set, `applyAction` rejects every
action except `resolve_choice` (pick a card/target), `skip_choice` (forfeit),
and `accept_choice` (binary yes). The three handlers live in engine.ts:
`doResolveChoice`, `doSkipChoice`, `doAcceptChoice`.

### The `remaining` chain — multi-step without loops

Effects that act on N cards but require a choice *per card* (KO 2 Heroes, discard
down to 4, put 2 on deck) do NOT loop. They set a `PendingChoice` with a
`remaining` counter; on each resolve, if `remaining > 0` and eligible cards
remain, re-seed the choice with `remaining - 1`. Example (Magneto discard-to-4,
in `applyStrikeToPlayer`):

```ts
const toDiscard = player.hand.length - 4;
state.thisTurn.pendingChoice = {
  kind: 'discard_from_hand', bonus: [], mandatory: true,
  sources: ['hand'], remaining: toDiscard - 1,   // this prompt is the first
};
```

`doResolveChoice` decrements and re-prompts until done. This keeps each step
interactive (the player picks *which* cards) without the engine choosing for
them.

### `mandatory` and skip-blocking

`mandatory: true` hides the Skip button and makes `doSkipChoice` reject. A few
kinds without a `mandatory` flag are still un-skippable because skipping would
lose state (`order_top_of_deck`, `escape_ko_hq_hero`, `paibok_gain_hq_hero`,
`pass_left_select_card`) — these are explicitly listed in `doSkipChoice`. If you
add a choice that must not be skipped, add it there too.

### Carryover across the turn advance

`emptyTurnState()` wipes `thisTurn` (including `pendingChoice`) on turn advance.
Most prompts are resolved before End Turn so this is fine. But a few choices are
*set during* the end-of-turn reveal and must survive to the next player. Two
mechanisms:

- **`carryoverChoice`** in `doEndTurn` explicitly preserves
  `solo_twist_tuck_hero` and `escape_ko_hq_hero` across the advance.
- **The sequential-strike pipeline** (separate reference) for anything where
  *each* player must choose in turn order.

If you set a `pendingChoice` anywhere inside the reveal path and it "vanishes,"
this is why — pick the right carrier.

### Board wiring for a new choice (don't forget the UI)

A new `PendingChoice` kind needs FOUR board touches in LegendaryBoard.tsx, or it
will be unresolvable or look broken:

1. **Banner text** — the instruction string in the pending-choice banner.
2. **Mode flag** — add to the relevant `isChoiceMode` / `is<Name>Choice`
   derivation so the right zones become clickable.
3. **Highlight ring** — a case in `HandCard`'s `choiceRing` (and the system-card
   variant if wounds/bystanders are valid). **A missing ring makes valid targets
   look greyed-out and unclickable** even though the engine accepts them — this
   was the "can't copy S.H.I.E.L.D. cards with Rogue" bug. The card is clickable;
   the player just can't tell.
4. **Skip button visibility** — exclude mandatory/state-losing kinds from the
   Skip button render.
