# HeroScape — Slice 7 Spec: Special Powers, Batch 2a (movement & defense)

> Implementation spec, written before the code. The movement/defense half of the
> complex powers. The genuinely new ACTION TYPES (multi-target special attacks
> Grenade/Fire Line, The Drop placement, Mind Shackle control) are batch 2b /
> slice 8. Source of truth: cards.md (exact text). Base: slice 6.

## Scope

Seven powers that modify the existing movement search, move-consequences, attack
eligibility, or damage calc — no brand-new multi-target action types. Completes
Agent Carr, Sgt. Drake, Raelin, Krav Maga Agents, and Izumi Samurai; gives
Mimring its Flying (its Fire Line stays slice 8, so Mimring remains `wip`).

After slice 7, the only `wip` cards are **Airborne Elite, Mimring, Ne-Gok-Sa**
(all need a slice-8 special attack / placement / control power).

## Card-data: power flags

Add optional power flags to `HSCardDef` (data-driven, no card-id hard-coding):
```ts
flying?: boolean; ghostWalk?: boolean; disengage?: boolean;
thorianSpeed?: boolean; stealthDodge?: boolean; counterStrike?: boolean;
grappleGun?: number;   // the "25" levels
```
Set them in content.ts: raelin.flying, mimring.flying, agent_carr.ghostWalk +
disengage, drake.thorianSpeed + grappleGun:25, krav_maga.stealthDodge,
izumi_samurai.counterStrike. (Double Attack / Sword / auras stay as they are.)

## The seven powers (exact text in cards.md)

### Flying — Raelin, Mimring (movement)
"When counting spaces for movement, ignore elevations. May fly over water
without stopping, pass over figures without becoming engaged, and fly over
obstacles such as ruins. When it starts to fly, if engaged it takes any leaving
engagement attacks."
→ In the movement search (board.ts `reachableDestinations`), a flying figure:
  - step cost = **1 per hex**, ignoring climb cost AND the climb limit (ignore
    elevation entirely);
  - **no water forced-stop** (may pass through / end on water freely);
  - may **pass through ANY figure** (friend or enemy) — still can't END on an
    occupied hex;
  - flies over ruins (when ruins exist).
→ In `moveConsequences`: a flyer takes **no fall damage** (it descends, doesn't
  fall). Leaving-engagement at takeoff is UNCHANGED — the existing start-vs-end
  abandoned-enemy computation already models "if engaged when it starts, it
  takes the swipes." Remove the `// slice 4: Flying bypasses this` markers at the
  climb/fall/water sites, replacing them with the real `isFlyer` checks.

### Ghost Walk — Agent Carr (movement)
"Agent Carr can move through all figures."
→ Movement search: Ghost Walk lets the figure **pass through enemy figures** too
  (normally only friendlies). Unlike Flying it does NOT ignore elevation or water
  stops — only the pass-through-any-figure clause. Still can't end on occupied.

### Disengage — Agent Carr (move-consequence)
"Agent Carr is never attacked when leaving an engagement."
→ `moveConsequences`: if the mover has `disengage`, `abandonedEnemyIds = []`
  (no leaving-engagement swipes, ever). Unconditional.

### Thorian Speed — Sgt. Drake (attack-eligibility, defensive)
"Opponents' figures must be adjacent to Sgt. Drake to attack him with a normal
attack." (NORMAL attacks only; special attacks unrestricted.)
→ `targetBlockReason`: if the **target** is Drake and the attack is NORMAL and
  the attacker is NOT `figuresAdjacent` to Drake → block ("Thorian Speed — must
  be adjacent to attack Sgt. Drake"). So Drake can't be shot at range by normal
  attacks. (Slice 7 has no special attacks yet; the `isNormalAttack` param is
  already threaded.)

### Grapple Gun 25 — Sgt. Drake (new movement action)
"Instead of Sgt. Drake's normal move, he may move only ONE space. This space may
be up to 25 levels higher. All engagement rules still apply."
→ New action `grapple_move { to }`: Drake (only), as his move, steps to ONE
  adjacent hex, **climb limit waived up to 25 levels** (so he can scale a cliff
  he normally couldn't). Engagement/leaving-engagement apply normally (compute
  swipes via the existing path; Drake isn't a flyer so a real drop could fall —
  but he's moving UP or one space, so falls only if he steps down a cliff, which
  the rules allow). It REPLACES his normal move (can't also normal-move that
  turn). Validate: it's Drake, the active card, ≤1 hex away, height gain ≤ 25,
  hasn't already moved. Server rolls any leaving-engagement swipe dice.

### Stealth Dodge — Krav Maga Agents (damage calc, defensive)
"When a Krav Maga Agent rolls defense dice against an attacking figure who is
NOT adjacent, one shield will block all damage."
→ In `doAttack` damage resolution: if the **defender** has `stealthDodge` and the
  attacker is NOT `figuresAdjacent` (a ranged attack) and the defender rolled
  **≥1 shield**, damage = 0 (one shield negates ALL). Only vs non-adjacent
  attackers; an adjacent attacker resolves normally.

### Counter Strike — Izumi Samurai (damage calc, reflective)
"When rolling defense dice against a NORMAL attack from an ADJACENT attacking
figure, all excess shields count as unblockable hits on the attacking figure.
Does not work against other Samurai."
→ In `doAttack`, after the normal damage calc: if the **defender** has
  `counterStrike`, the attack is NORMAL, the attacker is `figuresAdjacent`, and
  the **attacker is not also a counterStrike Samurai**, then if
  `shields > skulls`, the **attacker** takes `shields - skulls` **unblockable
  wounds**. Apply them, log it, and run the elimination/finish check (Counter
  Strike can destroy the attacker — and could even end the game). The defender
  still takes its normal `max(0, skulls - shields)` (zero when countering, since
  shields>skulls). Surface in `LastAttack` (a `counterWounds` field for the UI).

## State / action deltas
```ts
HSCardDef += { flying?, ghostWalk?, disengage?, thorianSpeed?, stealthDodge?,
               counterStrike?, grappleGun? }
HSAction  += { kind: 'grapple_move'; to: HexKey; leaveRolls?: {...}[] }
LastAttack += { counterWounds?: number }
STATE_VERSION → 7.
```
No projection change (no hidden info added). computeHistory still gated on
'finished' (Counter Strike kills route through the same finish check).

## Engine wiring
- Thread an `isFlyer` / `ghostWalk` option into `reachableDestinations`
  (extend the slice-3 `ReachOptions`): flyer → flat cost, no climb limit, no
  water stop, pass any figure; ghostWalk → pass any figure only. The board's
  highlight uses the same options (single source for reachability).
- `moveConsequences`: `disengage` → no swipes; flyer → no fall.
- `doMove` already validates against `reachableDestinations` — pass the figure's
  flags in so the legal set matches.
- `grapple_move` = a sibling of `doMove` with the climb-limit waiver and the
  one-space cap; reuse the swipe/`moveConsequences` plumbing.
- `targetBlockReason`: add the Thorian Speed clause (target is Drake, normal,
  attacker non-adjacent → blocked).
- `doAttack`: Stealth Dodge (zero the damage) and Counter Strike (reflect excess
  to the attacker + elimination check) in the damage step. Keep the height/aura
  dice in the single-source helpers — these two only touch DAMAGE, not dice
  counts.

## UI (HeroScapeBoard)
- Flying / Ghost Walk: the reachable-hex highlight already comes from the engine
  helper, so flyers light up cliffs/water automatically. Add a small ✈/ghost
  hint on the selected figure.
- Grapple Gun: when Drake is selected and hasn't moved, show a "🪝 Grapple Gun
  (climb anywhere, 1 space)" toggle that switches his highlights to the 1-space
  climb set and routes the click to `grapple_move`.
- Thorian Speed: enemies simply can't target Drake at range — no targeting ring
  appears; a tooltip explains why if helpful.
- Counter Strike: surface `counterWounds` in the dice panel ("Izumi counters for
  N!"); Stealth Dodge shows "Stealth Dodge — all damage blocked" when it fires.
- Flip Drake / Krav Maga / Izumi to `power:'live'` (Raelin/Agent Carr already
  live). Mimring/Airborne/Ne-Gok-Sa stay `wip`.

## Tests (engine.test.ts)
- Flying: a flyer crosses a 4-tier cliff and water in one move where a
  non-flyer can't; ends on the far side; takes no fall; passes over an enemy
  without engaging; but a takeoff while engaged still draws the swipe.
- Ghost Walk: Agent Carr moves through an enemy figure (non-flyer paths can't);
  still pays climb cost; can't end on an occupied hex.
- Disengage: Agent Carr leaving an engagement draws zero swipes.
- Thorian Speed: a non-adjacent normal attacker can't target Drake; an adjacent
  one can.
- Grapple Gun: Drake climbs a cliff > his Height in one space; only one space;
  replaces the normal move; engagement swipe still applies.
- Stealth Dodge: a Krav Maga Agent vs a non-adjacent attacker takes 0 damage on
  ≥1 shield; vs an adjacent attacker resolves normally.
- Counter Strike: Izumi defending an adjacent normal attack reflects (shields −
  skulls) unblockable wounds onto the attacker (and can destroy it → finish
  check); no reflect vs another Counter-Strike Samurai; no reflect on a ranged
  attack.
- Regression: slice-6 tests pass; the now-live cards flip; projection leak-free;
  history gated.

## Verify + ship
tsc · vitest (heroscape, 2×) · build · commit · push (auto-deploys). Review the
movement-search flag threading (single source for reachability), the Grapple
Gun climb waiver, and the Counter Strike reflect→elimination path personally.
HeroQuest's 38 pre-existing failures stay out of scope.
