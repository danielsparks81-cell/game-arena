# HeroScape — Slice 6 Spec: Special Powers, Batch 1 (stat-folding)

> Implementation spec, written before the code. The first of two power batches
> that light up the 12 cards drafted as stat-only in slice 5. Batch 1 = powers
> that fold into the slice-4 single-source effective-stat helpers (auras,
> conditional dice/range) plus Syvarris's Double Attack. Complex active powers
> (special attacks, Mind Shackle, Flying, Chomp, The Drop, Grapple/Ghost
> movement, Stealth Dodge, Counter Strike) are **batch 2 / slice 7**. Source of
> truth: cards.md (exact printed text). Base: slice 5.

## Why batches

The 12 remaining powers range from "+1 die under a condition" to "take control of
an enemy figure." Folding the simple ones in first keeps each slice reviewable
and reuses the proven single-source helpers, so a displayed die count can never
disagree with the enforced one (rules-fidelity §math). Batch 1 adds NO new
player-decision flows except Double Attack (which reuses the turn's attack loop).

## Card-data prerequisite: species + class

Add `species: string` and `unitClass: string` to `HSCardDef` (data already in
cards.md — e.g. Zettian Guards = Soulborg / Guards; Grimnak = Orc / Champion;
Marro = Marro / Warriors). This makes the "Soulborg Guards" and "Orc Warriors"
conditions data-driven instead of hard-coded ids. Populate all 16 cards.

Add a shared pure adjacency helper if not already factored out:
`figuresAdjacent(state, a, b)` = hex-adjacent with the slice-3 elevation/ruin
exception (the same geometry `areEngaged` already uses, minus the enemy
requirement). Reuse it for every "adjacent to X" power below.

## The six batch-1 powers (exact text in cards.md)

### Raelin — EXTENDED DEFENSIVE AURA (passive, ranged)
"All figures **you control** within **6 clear sight spaces** of Raelin add 1 to
their defense dice. Does not affect Raelin."
→ `effectiveDefenseDice`: +1 if the defender shares Raelin's owner, is not
Raelin herself, a **living Raelin** exists, `rangeDistance(defender, raelin) ≤ 6`,
AND `hasLineOfSight3D(raelin ↔ defender)` (clear sight). Breakdown line
"+1 Raelin aura". Recompute from positions; stacks with Thorgrim/Gerda/height.

### Deathwalker 9000 — RANGE ENHANCEMENT (passive, conditional)
"Any **Soulborg Guards** adjacent to Deathwalker add 2 spaces to their range."
→ `effectiveRange`: +2 if the figure's card is species **Soulborg** AND class
**Guards**, and it is `figuresAdjacent` to a living friendly Deathwalker.
(Zettian Guards qualify: Range 7 → 9.) Folds into the range used by
`targetBlockReason` and the board preview.

### Agent Carr — SWORD OF RECKONING 4 (conditional attack)
"If Agent Carr is attacking an **adjacent** figure, add **4 dice** to Agent
Carr's attack."
→ `effectiveAttackDice`: +4 if the attacker is Agent Carr and the target is
`figuresAdjacent`. Normal attacks only (special attacks unmodifiable — none of
Carr's here). Breakdown "+4 Sword of Reckoning". (Big swing — make sure the
server rolls the bonused count via the single source.)

### Grimnak — ORC WARRIOR ENHANCEMENT (aura, inert in this set but correct)
"All friendly **Orc Warriors** adjacent to Grimnak roll an additional **attack
die and** an additional **defense die**."
→ both `effectiveAttackDice` and `effectiveDefenseDice`: +1 if the figure is
species **Orc** + class **Warriors**, same owner, `figuresAdjacent` to a living
Grimnak. No Orc Warriors exist in the 16-card set, so this never fires in
practice — implement it data-driven and unit-test with a synthetic Orc Warrior
so the rule is proven.

### Zettian Guards — ZETTIAN TARGETING (conditional, needs per-turn attack log)
"When attacking, if your **second** Zettian Guard attacks the **same figure** as
the first Zettian Guard, add **one attack die** to the second Zettian Guard's
attack."
→ Requires knowing the FIRST Guard already attacked this target this turn. Add
`turnAttacks: { attackerId: string; targetId: string }[]` to state (cleared at
turn start / end_turn, like movedFigureIds). `effectiveAttackDice`: +1 if the
attacker is a Zettian Guard AND some earlier `turnAttacks` entry this turn is a
Zettian Guard of the same card hitting the same `targetId`. Single source still
holds (preview reads `turnAttacks` too). Breakdown "+1 Zettian Targeting".

### Syvarris — DOUBLE ATTACK (attack-count, optional)
"When Syvarris attacks, he **may** attack one additional time." (exactly one
extra)
→ Per-figure attack budget, not a die modifier. Add `maxAttacks(card)` = 2 for
Syvarris, else 1. Replace the boolean "has this figure attacked" gate with a
COUNT from `turnAttacks` (figure may attack while its count < maxAttacks). The
second attack is optional — the player simply may end / move on. A normal
(non-Syvarris) figure is still capped at 1. Each of Syvarris's attacks is a
separate roll vs the target's defense (re-read effective dice each time —
e.g. height advantage could differ if… it can't here, but compute fresh).

## State / action deltas
```ts
HSCardDef += { species: string; unitClass: string }
HSState  += { turnAttacks: { attackerId: string; targetId: string }[] }   // cleared per turn
// no new actions; doAttack appends to turnAttacks; attack-eligibility uses the count.
STATE_VERSION → 6.
```
`attackedFigureIds` may be derived from `turnAttacks` or kept in sync — pick one
source of truth and remove the redundancy. Movement still ends a figure's move;
Double Attack does not grant extra movement.

## Engine wiring
- Fold the five dice/range powers into `effectiveAttackDice` /
  `effectiveDefenseDice` / `effectiveRange` (the slice-4 single sources). Each
  adds a breakdown line so the UI caption explains the count.
- `doAttack`: after a successful attack, push `{attackerId, targetId}` to
  `turnAttacks`. Attack-eligibility (`attackReadyFigure` / `legalTargets`) gates
  on `attacksThisTurn(fig) < maxAttacks(card)` instead of a boolean.
- Clear `turnAttacks` wherever `movedFigureIds`/`attackedFigureIds` are cleared
  (turn start / end_turn / new active card).
- Engine stays pure; no Math.random added; computeHistory + projection unchanged.

## UI (HeroScapeBoard)
- Dice-panel breakdown already renders `breakdown[]` — the new lines surface
  automatically (Raelin aura, Sword, Zettian Targeting, Range Enhancement shown
  via the larger range highlight).
- Double Attack: after Syvarris's first attack, if he may attack again, keep his
  targets highlighted and show a hint ("Double Attack — Syvarris may attack
  again or end"). No new modal.
- Remove the "⚡ powers WIP" tag from the six now-live cards in the draft pool
  (drive the tag off the `power` flag — flip Raelin/Deathwalker/Agent Carr/
  Grimnak/Zettian/Syvarris to `live`). The remaining 6 stay `wip`.

## Tests (engine.test.ts)
- Raelin aura: a controlled figure within 6 clear spaces of Raelin gets +1
  defense; out of range, or LOS-blocked, or Raelin herself → no bonus; stacks
  with Thorgrim + height in the breakdown.
- Range Enhancement: a Zettian Guard adjacent to friendly Deathwalker has range
  9 (reaches a target at 9); non-adjacent → 7; a non-Soulborg-Guard adjacent →
  no bonus.
- Sword of Reckoning: Agent Carr vs an adjacent figure rolls attack+4; vs a
  non-adjacent figure no bonus.
- Orc Warrior Enhancement: synthetic Orc Warrior adjacent to Grimnak gets +1
  attack and +1 defense; non-adjacent or non-Orc → none.
- Zettian Targeting: second Guard hitting the same target as the first this turn
  rolls +1; a different target → no bonus; the FIRST Guard never gets it.
- Double Attack: Syvarris may attack twice (two separate rolls), and may stop
  after one; a non-Syvarris figure still attacks only once; Double Attack grants
  no extra movement.
- Single-source: every bonus appears in `effective*` breakdown and the server
  roll count matches; preview == resolution.
- Regression: all slice-5 tests pass; the six cards flip to `power:'live'`; the
  other 6 stay `wip`; projection leak-free; history gated on finished.

## Verify + ship
tsc · vitest (heroscape, 2×) · build · commit · push (auto-deploys). Review the
single-source folding (no bonus computed in two places), the `turnAttacks`
lifecycle (cleared at the right boundaries), and Double Attack eligibility
personally. HeroQuest's 38 pre-existing failures stay out of scope.
