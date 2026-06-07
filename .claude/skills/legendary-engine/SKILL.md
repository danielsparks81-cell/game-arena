---
name: legendary-engine
description: >-
  Architecture and safe-extension guide for the Legendary co-op deckbuilder
  engine (src/lib/games/legendary/). USE THIS whenever you touch anything under
  src/lib/games/legendary — adding or fixing a Hero, Villain, Henchman,
  Mastermind, Master Strike, Scheme, Tactic, or card Effect; debugging a card
  that "didn't do anything", auto-discarded, double-fired, or skipped a prompt;
  or wiring board UI for a new card. The engine has hard-won invariants
  (server-authoritative resolution, the sequential Master Strike pattern,
  fire-once twist effects, hidden-info projection, the computeHistory contract)
  that are easy to violate and have each caused real bugs. Read this BEFORE
  editing the engine so you reuse the established patterns instead of
  rediscovering them.
---

# Legendary engine

A Marvel-themed cooperative deckbuilder. 1–5 players draw a 6-card hand, play
cards for Attack/Recruit, buy Heroes from the HQ, fight Villains in the City and
the Mastermind. **Win** = defeat the Mastermind (take all its Tactics). **Lose**
= the Scheme's "evil wins" timer triggers first.

The engine is **server-authoritative and pure**: `applyAction(state, playerId,
action)` clones state, validates, mutates the clone, returns the next state or
`{ error }`. It never reads the clock or RNG outside `shuffle`/dice helpers, so
it's deterministic and unit-testable.

## File map

```
src/lib/games/legendary/
  engine.ts        # ~4900 lines — applyAction, all effect resolution, doEndTurn, projection
  types.ts         # Effect / PendingChoice / LegendaryState / card-def unions
  cards.ts         # CARDS catalog (buildCatalog), getCard, shared helpers (effectiveCityStrike, SHIELD_TEAMS, CITY_LOCATION_INDEX)
  engine.test.ts   # vitest — the regression net; ADD A TEST for every bug you fix
  heroes/          # Hero classes (one file per class) + shield.ts starters
  villains/        # Villain groups (brotherhood, radiation, skrulls, ...)
  masterminds/     # one file per Mastermind + its 4 Tactics
  schemes/         # one file per Scheme
  index.ts         # re-exports everything (registry imports from here)
```

The board UI is `src/components/LegendaryBoard.tsx` + `src/components/legendary/*`.
The card sandbox (`/legendary-sandbox`, `LegendarySandbox.tsx`) has an
**exhaustive** `defaultEffectForKind` switch — when you add an `Effect` kind you
must add a case there or `tsc` fails. That's a feature: it stops you forgetting.

## The five invariants (violate these and you get the bugs we already fixed)

### 1. Reveal-time per-player interactive effects MUST use the sequential-strike pipeline

This is the single most repeated bug class — it bit Magneto, Red Skull,
Juggernaut, AND Dr. Doom before all four were fixed. **Read
`references/sequential-strikes.md` before touching any Master Strike or any
villain Ambush/Escape that makes *each* player choose something.**

The trap: an effect that fires during the end-of-turn villain reveal sets
`state.thisTurn.pendingChoice`, but `doEndTurn` calls `emptyTurnState()` on the
turn advance immediately after — which **wipes `thisTurn`**, so the prompt
silently vanishes and the player just keeps going. The deferred
`pending<Name>Strike` flag approach is also wrong for multiplayer: it makes each
player resolve on *their own* next turn instead of in turn order at trigger
time.

The fix is a state-level queue (`state.pendingStrike` + `state.strikeQueue` +
`state.thisTurn.choiceOwnerSeat`) that survives the turn advance and walks every
player in turn order, revealer first, before the new active player acts. See the
reference for the full mechanism and how to add a new strike kind.

### 2. Scheme Twist / shared-board effects fire ONCE, not once-per-player

The end-of-turn `scheme_twist` reveal and Mystique's `trigger_scheme_twist` both
fire the scheme's `onTwist` effects. Fire them **once**, passing the active
player as the effect context:

```ts
// CORRECT — board-level twists (KO all HQ heroes, place a Dark Portal,
// Bank-villain captures bystanders) happen a single time.
if (scheme?.onTwist) {
  const twistPlayer = state.players[state.currentPlayerIdx];
  for (const eff of scheme.onTwist) resolveEffect(state, twistPlayer, eff);
}
```

Effects that genuinely hit every player (`each_player_gains_wound`,
`each_player_reveal_tech_hero_or_wound`, `bank_villain_captures_bystanders`)
**iterate over `state.players` internally**, so one call covers everyone. Never
wrap `onTwist` in a `for (const p of state.players)` loop — that double-fired
Super Hero Civil War's HQ wipe in 2-player games. When you author a new
per-player twist effect, make it self-iterating; don't rely on the caller to
loop.

### 3. Hidden information is stripped by `projectStateForViewer`, not by the engine

`projectStateForViewer(state, viewerId)` is the ONLY place that scrubs secrets
before state crosses the wire: every player's `deck` (hidden even from its
owner), other players' `hand`, the villain/hero/wound decks, the face-down
Mastermind tactics, and the heavy `undo.snapshot`. When you add a field that
holds hidden cards (a new deck, a peeked-card stash, an undo snapshot), **add it
to the projection** or you leak it to every client over Realtime. Test the
projection in `engine.test.ts` (see the "hand privacy projection" test).

### 4. `computeHistory` MUST return null unless the game is truly over

`recordHistoryIfFinished` inserts a `game_history` row **every time**
`computeHistory` returns non-null, with NO dedupe. Legendary's `computeHistory`
gates on `state.phase === 'finished'` and returns the winner + analytics `meta`
(mastermind / scheme / heroClasses / playerCount, consumed by `/legendary-stats`).
If you ever make it return a row mid-game you get phantom W/L spam (this exact
bug happened in Long Shot — see the platform skill). Win is *armed* via
`pendingResult` mid-turn and *committed* at End Turn; don't finalize early.

### 5. Effects are atomic and declarative; chain via `remaining`, not loops

Each `Effect` kind does one small thing in `resolveEffect`'s switch. Multi-step
effects (KO 2 cards, discard down to 4, put 2 on deck) chain by re-seeding a
`PendingChoice` with a decremented `remaining` counter, not by looping inside
the effect — because the player must *choose* between steps. See
`references/effects-and-choices.md`.

## Base game — frozen content (do not rename or remove)

The base game is complete and working at ~97% fidelity. The content IDs below
are used in saved `LegendaryState` objects in Supabase. **Never rename or remove
them** — doing so silently breaks any in-progress game that references them.
Additions are always safe; mutations are not.

### Masterminds
`magneto` · `red_skull` · `dr_doom` · `loki`

### Schemes
`prison_breakout` · `super_hero_civil_war` · `killbots` · `dark_portals` ·
`legacy_virus` · `skrull_invasion` · `cosmic_cube` · `bank_robbery`

### Hero classes (17 + SHIELD starters)
`captain_america` · `cyclops` · `hawkeye` · `iron_man` · `jean_grey` · `thor` ·
`storm` · `spiderman` · `gambit` · `deadpool` · `black_widow` · `hulk` ·
`rogue` · `wolverine` · `nick_fury` · `shield` (starters: `shield_trooper`, `shield_agent`)

### Villain groups (11)
`brotherhood` · `enemies_of_asgard` · `hand_ninjas` · `savage_land_mutates` ·
`doombot_legion` · `hydra` · `spider_foes` · `radiation` · `sentinels` ·
`masters_of_evil` · `skrulls`

### Regression baseline
31 targeted tests + a full mastermind × scheme fuzz matrix (4 × 8 = 32 combos,
varying 1–5 players) are the locked baseline. Run them before and after ANY
expansion work. If they were green before your change and red after, your change
broke the base game.

```bash
npx vitest run src/lib/games/legendary/engine.test.ts
npx vitest run src/lib/games/legendary/engine.fuzz.test.ts
```

---

## Adding expansion content — the safe path

### Golden rule: add files, never modify base game files

Expansion content goes in **new files only**. Never edit an existing hero/villain/
mastermind/scheme file to make room for an expansion mechanic. If an expansion
needs a new engine capability (a new Effect kind, a new PendingChoice), add it
to `engine.ts` in a purely **additive** way — new case in a switch, new field on
the state with a `?? default` fallback, never changing what an existing effect
does.

### State migration rule

Every new field added to `LegendaryState` for an expansion mechanic MUST have a
`?? defaultValue` fallback everywhere it's read. Existing in-progress games in
Supabase won't have the field; the engine must degrade gracefully, not crash.

### Expansion content location

```
heroes/         → one file per class (e.g. heroes/dark-city/punisher.ts)
villains/       → one file per group
masterminds/    → one file per mastermind
schemes/        → one file per scheme
```

Registration: each new content piece is imported into the relevant `all-*.ts`
catalog file and listed in `HEROES`, `VILLAIN_GROUPS`, `MASTERMINDS`, `SCHEMES`.
The base game entries are already there — append, don't replace.

### Content type table

| Adding a… | Do this |
|---|---|
| **Hero card** | New file or class entry. Use existing `Effect` kinds in `onPlay` where possible. New effect kind → see below. |
| **Villain / Henchman** | New group file. `ambush`/`fight`/`escape` are `Effect[]`. Per-player ambush/escape that prompts → sequential-strike pattern. |
| **Mastermind** | New file with 4 Tactics. `strike: Effect[]`. If the strike makes each player choose → register a `seqKind` (reference). |
| **Scheme** | New file. `onTwist: Effect[]` fires once. Wire the loss timer via the typed `evilWinsAfter*` fields, not a placeholder. |
| **New Effect kind** | 1) add to the `Effect` union in types.ts; 2) handle it in `resolveEffect` (engine.ts); 3) add a case to `defaultEffectForKind` in LegendarySandbox.tsx (tsc enforces this); 4) if it opens a prompt, add a `PendingChoice` kind + handle it in `doResolveChoice`/`doSkipChoice`/`doAcceptChoice` + render it in LegendaryBoard.tsx. |
| **New PendingChoice kind** | Add to the union (types.ts), handle resolve/skip/accept, AND add the board UI: the choice-mode banner text, the highlight ring in `HandCard`'s `choiceRing` (a missing ring makes valid targets look unclickable — that was the Rogue-copy bug), and any zone targeting. |

### After any expansion content change

1. Run the full test suite (both files above) — all 31 + 32 fuzz tests must still pass.
2. Add a targeted test for any new mechanic the expansion introduces.
3. Run the fidelity check in `references/rules-fidelity.md` — new card text must match implementation exactly.

After ANY content change, run the fidelity check in
`references/rules-fidelity.md` — the engine behavior must match the card's
printed text exactly (wrong KO target, off-by-one bystander counts, and "+strike
per bystander applied to the wrong villain" were all real mismatches).

## Debugging playbook — symptom → likely cause

- **"Card/strike did nothing / auto-resolved / let me keep playing"** → invariant #1. The prompt was set in `thisTurn` then wiped by the turn advance. Move it to the sequential-strike pipeline.
- **An effect happened N times in an N-player game** → invariant #2. It's being looped per-player; make it fire once / self-iterate.
- **Players didn't get to *choose* (auto-picked top card / cheapest)** → an "each player" effect was deferred or auto-resolved instead of prompting in turn order. Use the sequential pipeline so each player picks.
- **A valid target looks greyed-out / unclickable in a choice** → missing `choiceRing` case in `HandCard` (LegendaryBoard.tsx). The engine accepts it; the UI just isn't highlighting it.
- **Phantom W/L rows / stats inflated** → invariant #4. `computeHistory` returning non-null before `phase==='finished'`.
- **Opponent's hand/deck visible, or huge Realtime payloads** → invariant #3. A hidden-card field isn't stripped in `projectStateForViewer`.
- **First player is always the host** → starting player not randomized in `startGame` (`currentPlayerIdx = Math.floor(Math.random()*players.length)`). This is a *platform-wide* concern — see the game-arena-platform skill.

## Verify every change

```bash
cd /c/Users/Dan/Desktop/game-arena
npx tsc --noEmit -p tsconfig.json      # MUST run from the repo root (WindowsApps shim otherwise)
npx vitest run src/lib/games/legendary/engine.test.ts
```

`freshSinglePlayerGame()` picks a **random** scheme/mastermind, so engine tests
can be flaky if they assume a specific one — run the suite 3× when in doubt, and
pin `currentPlayerIdx = 0` / a specific `mastermindId` in tests that need
determinism (the starting player is now randomized). Always add a regression
test for the exact bug you fixed; the suite is the memory that stops a fix from
silently regressing.

## References

- `references/sequential-strikes.md` — the per-player interactive resolution pipeline (invariant #1). Read before any Master Strike / per-player ambush work.
- `references/effects-and-choices.md` — the Effect + PendingChoice systems, how to add each, the `remaining` chain pattern, carryover across turns.
- `references/rules-fidelity.md` — the "engine matches the printed card" checklist + a faithfulness audit habit for when you layer on new cards/rulesets.
