# HeroScape — Slice 4 Spec: Glyphs & Special Powers

> Implementation spec, written before the code. The FIRST slice that uses the
> extracted card power text (cards.md) and the glyph rules (05-glyphs-special-
> powers.md + extraction/resolutions.md). Base: slice 3 (commit ba2d8d0).
> Powers must match the printed wording exactly (rules-fidelity) — implement
> against cards.md, not memory.

## What slice 4 adds

Two systems: **glyphs** on the battlefield, and **special powers** for the four
cards currently in play (Finn, Thorgrim, Tarn Viking Warriors, Marro Warriors).
It also introduces the **PendingChoice** machinery HeroScape has lacked — the
pattern from Long Shot / Legendary — because several powers are player
decisions that must be prompted, never auto-resolved (rules-fidelity §choice).

IN: glyph framework + 5 permanent glyphs + Kelda; the 4 cards' powers; the
single-source effective-stat helpers that fold auras + glyphs + height
advantage together; a PendingChoice on `HSState`.

OUT (deferred, leave documented markers): the other 12 cards' powers (slice 5,
needed for draft); Erland (summon) and Mitonsoul (mass curse) glyphs and the
two Brandar artifacts (scenario-defined) — implement the framework so they slot
in later, but not these three effects; Flying as a card power (Mimring/Raelin
aren't in play); drafting; scenarios.

## PendingChoice (new infrastructure)

Add `pendingChoice?: HSPendingChoice` to `HSState`. While set, normal actions
are blocked for everyone except the player who owns the choice; the engine only
accepts a matching `resolve_choice` action. Mirror Long Shot's
PendingChoice/PendingChoiceResolution pair. Shape:

```ts
type HSPendingChoice =
  | { kind: 'berserker_charge'; seat: number; cardUid: string }       // may re-move?
  | { kind: 'water_clone_place'; seat: number; placements:           // choose each landing
        { cloneFigureId: string; options: HexKey[] }[]; chosen: HexKey[] }
  | { kind: 'spirit_placement'; seat: number; spirit: 'attack'|'defense';
        options: string[] /* unique card uids */ }
```

`HSAction += { kind: 'resolve_choice'; choice: <discriminated payload> }`.
The owning seat is `pendingChoice.seat`; `getActivePlayerId` returns that seat
while a choice is open (so the hourglass points at the decider). Dice inside a
choice (none here) would still be server-rolled.

Always offer the real option the rules grant — including DECLINING when the text
says "may" (Berserker re-move, Water Clone instead-of-attack, even Spirit
placement is mandatory placement but the CARD choice is free). Never auto-pick.

## Single source of truth for effective stats

Auras, glyphs, and height advantage all stack additively and are both DISPLAYED
and ENFORCED — so each must be computed in exactly one helper that the engine
and the board both call (rules-fidelity §math). Add to engine.ts:

```ts
effectiveAttackDice(state, attacker, target): { dice, breakdown }   // printed + height + Finn aura + Astrid glyph + Attack-Spirit
effectiveDefenseDice(state, defender, attacker): { dice, breakdown } // printed + height + Thorgrim aura + Gerda glyph + Armor-Spirit
effectiveMove(state, fig): number                                   // printed + Valda glyph
effectiveRange(state, fig): number                                  // printed + Ivor glyph (only if printed range >= 4)
```

`attackDiceRequirements` (slice-3 single source) now delegates to
`effectiveAttackDice`/`effectiveDefenseDice`. `reachableDestinations` callers use
`effectiveMove`. `targetBlockReason` range check uses `effectiveRange`. The
board's previews read the same helpers. `LastAttack.breakdown` (string[]) feeds
the dice-panel caption so the player sees WHY the dice count is what it is.

## The four card powers (exact wording in cards.md)

### Finn — ATTACK AURA 1 (passive) + WARRIOR'S ATTACK SPIRIT 1 (on destroy)
- Aura: friendly figures **adjacent to Finn** that have a **printed Range of 1**
  add **1 attack die** on a **NORMAL attack** (not special attacks). Folds into
  `effectiveAttackDice` (condition: attacker.range===1 && adjacent-to-living-Finn
  && same owner). Recompute from positions every time — no stored token.
- Spirit: **when Finn is destroyed**, the owner **places this figure on any
  unique Army Card**; that card permanently **adds 1 to its attack number**.
  → on-destroy `spirit_placement` PendingChoice (spirit:'attack'); options =
  all living unique cards (any owner — text says "any unique Army Card"). Apply
  a persistent `+1 attack` modifier to the chosen card. (Verified: Finn's text
  does NOT restrict to friendly; allow any unique card.)

### Thorgrim — DEFENSIVE AURA 1 (passive) + WARRIOR'S ARMOR SPIRIT 1 (on destroy)
- Aura: friendly figures **adjacent to Thorgrim** add **1 defense die**. Folds
  into `effectiveDefenseDice` (defender adjacent to living Thorgrim, same owner).
  No range restriction (unlike Finn's).
- Spirit: **when Thorgrim is destroyed**, owner places on **any unique Army
  Card**, permanently **+1 to that card's defense number**. → `spirit_placement`
  (spirit:'defense').

### Tarn Viking Warriors — BERSERKER CHARGE (d20, optional re-move)
- **After moving and before attacking**, roll d20; **15+ → you MAY move all Tarn
  Viking Warriors again.** Flow: when the active card is Tarn and the player has
  moved ≥1 Tarn figure and not yet attacked, the engine offers a
  `berserker_charge` choice (server rolls the d20 when offered? — no: the ROLL
  is the action). Cleanest: a `berserker_charge` action (server-rolled d20);
  on 15+, clear `movedFigureIds` for Tarn so all may move again (and may charge
  again — "no printed limit on repeats", cards.md). On <15, the charge is spent
  for the turn (one roll). The re-move itself is the player's choice (they may
  decline by attacking / ending). Keep it an explicit action, not auto.

### Marro Warriors — WATER CLONE (d20, instead of attacking, after moving)
- **Instead of attacking**, and **only after you move**, roll d20 for **each
  Marro Warrior in play**; **15+ (10+ if that Warrior is on a water space)** →
  **place a previously-destroyed Marro Warrior on a same-level space adjacent to
  that Warrior**. → a `water_clone` action (server rolls one d20 per living
  Marro; engine validates count). For each success that has at least one legal
  same-level-adjacent empty space AND a destroyed Marro available to return,
  collect a `water_clone_place` PendingChoice so the owner chooses each landing
  (auto-skip successes with no legal space or no clone left; log them). Consumes
  the card's attack for the turn (it's "instead of attacking").

## Glyphs

### Framework
- `state.glyphs: { id: HSGlyphId; at: HexKey; faceUp: boolean }[]` placed from a
  per-map layout (below). Slice 4: place them **power-side-up** (`faceUp:true`)
  so effects are known — the symbol-side-up + flip-on-first-land mechanic is
  deferred (note it; the framework allows `faceUp:false`).
- **Forced stop:** a figure that MOVES ONTO a glyph hex must **stop** (movement
  ends there). Encode in the movement search: a glyph hex is a valid endpoint
  and cannot be a pass-through node. (Mirrors water's forced-stop in board.ts.)
- **Permanent glyphs** are active **while one of your figures stands on the
  glyph** — they fold into the effective-stat helpers / initiative. **Temporary
  glyphs** fire once when a figure stops on them, then are **removed**.
- Double-space leading-end rule: N/A (no double-space figures in the roster).

### Permanent glyphs (slice 4) — fold into single-source helpers
| Glyph | Effect (while you occupy it) | Folds into |
|---|---|---|
| Astrid | +1 attack die for **all** your figures | effectiveAttackDice |
| Gerda  | +1 defense die for all your figures | effectiveDefenseDice |
| Ivor   | +4 Range for your figures whose printed Range ≥ 4 | effectiveRange |
| Valda  | +2 Move for all your figures (not when moving OFF the glyph — see note) | effectiveMove |
| Dagmar | +8 to your initiative roll | initiative (server adds 8 to that seat) |

"Controls a glyph" = a living figure of that seat occupies the glyph hex. Valda
caveat (resolutions): "Do not use this power when moving off of the Glyph" — the
figure ON Valda doesn't get +2 for its own move leaving it; simplest faithful
model: Valda boosts your OTHER figures, and the occupant doesn't get the bonus
on the move that leaves the glyph. Document the interpretation in code.

### Temporary glyph (slice 4): Kelda (Healer)
- **Only figures with ≥1 wound may stop on Kelda.** When a figure stops, remove
  **all** its wounds, then remove the glyph from the game. Enforce the "only
  wounded may stop" as a movement-end restriction (an unwounded figure may not
  end on Kelda).

### Deferred glyphs (framework only, not active): Erland, Mitonsoul, 2× Brandar
Leave `// slice 5: Erland summon` / `// scenario: Brandar` markers. If one is
placed on a map, treat it as inert in slice 4 (still a forced stop), and log it.

### Map glyph layouts (seed so the feature is testable)
Add a `glyphs` layout to each map (id → hex). Suggested:
- training_field: Astrid + Gerda on two mid-row hexes (flat, easy to test buffs).
- the_knoll: Astrid on the R4 summit (height + attack buff), Valda on a low hex.
- ford_crossing: Kelda on a bank hex, Ivor near the water (range buff for Marro).
Use the existing `*` glyph-spot parsing if present, else add explicit coords in
maps.ts. Keep them deterministic.

## State / action deltas

```ts
// types.ts
HSState += { glyphs: HSGlyph[]; pendingChoice?: HSPendingChoice };
ArmyCardInstance += { attackMod: number; defenseMod: number }; // Spirit bonuses (default 0)
LastAttack += { breakdown: string[] };  // ["printed 3", "+1 height", "+1 Astrid"]
HSAction +=
  | { kind: 'berserker_charge'; d20: number }
  | { kind: 'water_clone'; rolls: { marroFigureId: string; d20: number }[] }
  | { kind: 'resolve_choice'; choice: ... }
roll_initiative attempts already carry per-seat rolls — add Dagmar +8 in the
SERVER before comparing (or carry rawRoll+bonus); engine validates the bonus.
STATE_VERSION → 4.
```

## Server (actions.ts makeMoveHS)
- berserker_charge / water_clone: server rolls the d20(s), passes values in;
  engine validates count + thresholds + that the card/timing is legal.
- Dagmar: when rolling initiative, add 8 to the controlling seat's d20 (cap not
  needed); keep the raw and bonused values for display, engine re-checks.
- On-destroy Spirit: the destruction happens inside doAttack/doMove (swipes,
  falls). When Finn/Thorgrim dies, set the `spirit_placement` pendingChoice
  BEFORE returning; the next action must be the owner's resolve_choice. (A
  destruction that ALSO ends the game still resolves history after — but a
  pending choice with the game over should be skipped: if phase would be
  finished, skip the spirit, or resolve it then finish. Choose: finish takes
  precedence — no spirit placement once a side is wiped. Document.)

## UI (HeroScapeBoard)
- Glyphs: draw a marker on glyph hexes (letter A/G/I/V/D/K in a colored badge),
  dimmed when unoccupied, lit when a figure stands on it; tooltip = effect.
- Dice panel: show `breakdown` ("3 printed +1 height +1 Astrid = 5").
- PendingChoice prompts (only for the deciding player):
  - berserker_charge: after a Tarn move, a "⚡ Berserker Charge (roll d20)"
    button + "skip" (attack/end instead). Show the roll result + outcome.
  - water_clone: a "🌊 Water Clone instead of attacking" button on a Marro turn
    after moving; then per-success placement (click a highlighted same-level
    adjacent hex for each returning Warrior).
  - spirit_placement: a modal listing unique cards to receive the spirit.
- Aura/glyph indicators: small ⬆ badges on buffed figures are nice-to-have.

## Tests (engine.test.ts)
- Auras: a Range-1 friendly adjacent to Finn rolls +1 attack die (and NOT when
  non-adjacent, NOT for a Range>1 figure, NOT on a special attack); Thorgrim +1
  defense to any adjacent friendly; both fold through attackDiceRequirements.
- Spirit: destroying Finn opens spirit_placement; choosing a card gives it +1
  attack permanently (and it shows in effectiveAttackDice); Thorgrim → +1 def.
  Spirit skipped if the destruction ends the game.
- Berserker Charge: 15+ re-grants Tarn movement; <15 does not; re-move can chain;
  declining (attacking) is legal.
- Water Clone: instead-of-attack only after moving; 15+/10+-on-water thresholds;
  returns a destroyed Marro to a same-level adjacent space via PendingChoice;
  consumes the attack; success with no legal space auto-skips.
- Glyphs: forced stop on entering; Astrid/Gerda/Ivor/Valda/Dagmar each fold into
  the right single-source helper while occupied and stop when vacated; Kelda
  heals all wounds and is removed, and an unwounded figure may not stop on it.
- Stacking: Astrid + Finn aura + height advantage all add (breakdown correct).
- Regression: all slice-3 tests pass; projection still leak-free (glyphs/powers
  add no hidden info — pendingChoice is public).

## Verify + ship
tsc · vitest (heroscape, 2×) · build · commit · push (auto-deploys). Review the
single-source effective-stat helpers, the PendingChoice gating, and the
on-destroy Spirit timing personally before commit. The 38 pre-existing HeroQuest
failures stay out of scope.
