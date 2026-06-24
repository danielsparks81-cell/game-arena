# HeroScape engine audit — 2026-06-24

Full end-to-end audit (five system buckets, one read-only subagent each, then synthesis +
self-verification) run after a large batch of changes: the **interactive roll ceremony**
(Mitonsoul curse / Sturla resurrection), the **turn-order ring** fix, the **negation→Spirit**
suppression, and **three new symmetric battlefields** (3 / 4 / 5 players).

**Headline verdict:** the engine is in good shape — combat, movement, turn flow, AI, and the new
maps are faithful and crash-free; the fuzzer + playthroughs are green (487 tests). The new
subsystems this session (ceremony, turn-order ring, negation fix, maps) all verify correct. The
audit surfaced **one real hidden-info leak** (now fixed), **one broad fidelity bug** (Warrior's
Spirit dropped on special/curse deaths — deferred fix, documented), and a handful of rulings +
latent edges. No 🔴 shipping bug remains open.

---

## Fixed in this audit pass (shipped)

1. **🔴 `glyphSeed` hidden-info leak — FIXED.** `projectStateForViewer` masked face-down glyph
   ids but shipped `state.glyphSeed`. Since `generateGlyphs(seed)` is deterministic and the map
   (incl. `glyphAnchors`) is in the client bundle, a modified client could recompute every
   face-down glyph's id, defeating the mask. Fix: `delete next.glyphSeed` in projection
   (engine.ts `projectStateForViewer`). Regression test added (engine.test.ts "strips glyphSeed…").
2. **🟡 Stale comments — FIXED.** Three block comments claimed special-attack *defenders* lose
   height; the code correctly KEEPS it (§117 constrains the attacker only). Comments corrected
   (engine.ts Fire Line / Explosion / Big-Hero headers). No behavior change.

## Ranked OPEN issues (deferred — need a fix or a ruling)

| # | Sev | Where | Issue | Fix shape | Why deferred |
|---|-----|-------|-------|-----------|--------------|
| O1 | 🟠 | engine.ts special-attack handlers (Fire Line/Explosion/Grenade/Ice Shard/Queglix/Wild Swing/Acid Breath/Throw) + `applyCeremonyRoll` curse | A Finn/Thorgrim destroyed by a **special attack** or the **Massive Curse** leaves NO Warrior's Spirit — those kill sites never call the Spirit hook (only normal-attack / swipe / fall / Wannok do). | Add a small `pendingSpirits` queue: `enqueueSpiritOnDestroy` at every special/curse death, `openNextSpirit` after `checkEliminationWin` and after each `spirit_placement` resolves (handles a multi-kill that drops two heroes). | Multi-site refactor (~10 sites) to the death/Spirit system; pre-existing (not a regression this session). Best done with attention, not unattended. Regression tests specified below. |
| O2 | 🟡 | engine.ts Oreld/Nilrend/Wannok d20 resolutions (+ actions.ts Oreld roll) | **Glyph of Lodin (+1 to any d20 you roll) is NOT applied** to the five wave-3 glyph d20s (Mitonsoul, Sturla, Oreld, Nilrend, Wannok). Every legacy d20 power folds in `lodinD20Bonus`; these five compare the raw d20. Each effect is self-protective for the Lodin holder (curse-immune, resurrect on 19, never self-remove/negate/wound). | Mitonsoul/Sturla: `eff = d20 + lodinD20Bonus(s, fig.ownerSeat)` in `applyCeremonyRoll` (curse `eff===1`, resurrect `eff>=20`). Oreld/Nilrend/Wannok: store the *effective* d20 in `pc.d20` at the roll step + apply Lodin in the actions.ts Oreld branch. | **Needs an owner ruling** (does Lodin make your figures curse-immune?). The Mitonsoul/Sturla half is a clean engine change; Oreld/Nilrend/Wannok touch the multi-reader `pc.d20` + the action layer. Held pending the ruling so all five land consistently. |
| O3 | 🟡 | engine.ts `effectiveAttackDice`/`effectiveDefenseDice` (cardMod adds) | A Nilrend-**negated** card still applies a Warrior's Spirit `attackMod`/`defenseMod` it had *previously received*. Ambiguous: is a received Spirit token "that card's own power" (negated) or an external buff (kept)? | If "base stats" is literal: gate both `cardModFor` adds behind `!isCardNegated`. | **Needs a ruling.** Corner case (Spirit lands, then that card is negated). |
| O4 | 🟡 | engine.ts `moveConsequences` vs `stepConsequences` | Whole-move (the primary click) and step-by-step movement have drifted: the whole-move path **under-counts passing swipes** for a transiently-engaged enemy (B1), **can't bridge a water hex with a 2-hex figure** (B2), and **computes a 2-hex fall the step path defers** (B3). | Route the primary click through the step engine, or document the destination-model limits. B2/B3 are latent (no figure can trigger them on current maps until a unit descends a height-15 wall). | Pre-existing; B1 is the only live one and is a model limitation, not a crash. |
| O5 | 🟡 | maps.ts (Triskelion/Pentad) | The **central glyph** sits on a height-3 hex ringed entirely by height-2, so a **2-hex (Big Hero) figure can never stop level on it** → can't reveal/control that one glyph. 1-hex figures reach all glyphs. | Make the central hex height-2 (or raise its ring to 3) so a peanut can rest level. | Cosmetic asymmetry between figure sizes for 1 of 6–9 glyphs; symmetric across players. |
| O6 | 🟡 | types.ts `glyph_oreld.foeCandidates` on `pendingChoice` | `foeCandidates` enumerates the *positions* (cardUid+markerIndex) of an opponent's **unrevealed** order markers, and `pendingChoice` isn't masked in projection. Not currently exploitable (Oreld auto-resolves server-side, never pausing for a human). | Mask/strip `foeCandidates` in projection, or compute it server-side only. | Pre-existing; not reachable by a client today. |

---

## Per-system findings (condensed)

### 1. Turn flow — sound
Order markers, initiative (ties re-roll with Dagmar/Lodin bonus persisting, re-validated on both
server + engine), round rollover, draft snake + per-team budget, placement, and last-team / draw
elimination all verify against `docs/heroscape/02-rounds…`. **NEW:** the turn-order **ring**
(`physicalSeatRing` → rotate-to-winner → `interleaveByTeam`) is correct — winner first, then the
physical start-zone ring, 2-player unaffected, eliminated seats excluded, no crash on an empty
zone. The **roll ceremony** advances owner-by-owner, clears its temp glyph at the end, can't
soft-lock (queue strictly drains; `pc.seat` always tracks `queue[0]`), and a board-wiping curse
ends as a draw (tested M2). Only bug: O1 (Spirit on curse death).

### 2. Movement — faithful, crash-free on the new maps
Climb cost/limit, free descent, fall bands (+Lodin on extreme), water forced-stop, flying
(Rannveig suppression), ghost walk, Theracus carry, The Drop decline, 2-hex slither, and
whole-move undo all check out. **Verified no stranding/sealed paths on Triskelion/Crossroads/
Pentad** — every non-wall hex is reachable by a Height-2 walker; height-15 walls are isolated
(flyers cross); mounds are properly ramped. Open: O4 (whole-move vs step divergences).

### 3. Combat + LOS — faithful, no shipping bug
`wounds = max(0, skulls − shields)` (tie → defender), `destroyed = wounds >= life`, height
advantage, and all 11 special attacks verify line-by-line against printed card text. Special-attack
**defenders keep height** (§117) — code correct, comments now fixed. The **negation→Spirit
suppression** (a negated Finn/Thorgrim leaves no Spirit on death) is correct + tested. Open: O3
(negated card keeps a *received* Spirit mod — ruling).

### 4. Cross-system interactions + the new maps
Glyph buffs × combat, aura × combat (negated source removed), height × normal-vs-special,
LOS × ranged-vs-aura, flying × engagement/water/glyph, pending-choice × turn-flow — all faithful.
**Lodin × the five wave-3 glyph d20s is the one gap (O2).** The new maps are geometrically sound
(fair, connected, no soft-locks; The Drop always has landings; both 1-hex AND 2-hex figures can be
placed on every seat). Glyph generation on them is safe: `generateGlyphs` branches on
`map.glyphAnchors` (symmetric fixed positions, random id per game, never on a wall/zone, ≤
GLYPH_POOL ids). Note: the anchor branch bypasses `glyphCountForMap`, so Crossroads runs ~9 glyphs
(denser than a rectangle) — by design (anchors ARE the layout).

### 5. AI + projection + RNG
The AI drives every pending + power, **including the new ceremony** (select → roll, d20 injected
by the action layer; the old Mitonsoul/Sturla bot-stall is closed; multi-owner hand-off correct).
Engine is RNG-free; all dice/seeds injected by the action layer; `generateGlyphs` deterministic
from the seed (incl. the anchor branch). Projection: the ceremony's public fields
(`selectedFigureId`/`queue`/`results`) expose only figure ids + d20s (correct — all watch); the
**`glyphSeed` leak (now fixed)** was the real issue; O6 (`foeCandidates` shape) is latent.

---

## The three new battlefields (geometry verified)

```
Triskelion Vale (3p) — true 3-fold rotational     Crossroads Keep (4p) — 4 mirror quadrants
  217 hexes · 9 walls · zones 16/16/16              289 hexes · 8 walls · zones 16/16/16/16
  minInterZone 10 · connected · 7 glyph anchors     minInterZone 10 · connected · 9 glyph anchors

        3 3 3 3 . . . . .                            1 1 1 1 . . . . . . . . . 2 2 2 2
     3 3 3 3 . . . . . . .                           1 1 1 1 * . # . . . # . * 2 2 2 2
    . . . . * . # + . . . . .                        . . . . . + . . . . . + . . . . .
   . . # . . + ^ . . . . # . 1                       . . * . . . . . . . . . . . * . .
  . . . . # . + + + . # . . 1 1                      . . # . + . . + + + . . + . # . .
 . . . . . . + + + + . . . 1 1 1                     . . . . . . + ^ * ^ + . . . . . .
. . . . . . + + * + + + * 1 1 1 1                    . . # . + . . + + + . . + . # . .
  . . . . # ^ + + + . # . . 1 1                      . . * . . . . . . . . . . . * . .
   . . . . . + . . . + . . . 1                       3 3 3 3 . . . . . . . . . 4 4 4 4
    . . . . * . # . . * . . .                        3 3 3 3 * . # . . . # . * 4 4 4 4
     2 2 2 2 . . . . . . . .
      2 2 2 2 . # . . . . .         Pentad Crucible (5p) — 5-fold angular (approx; equal zones)
       2 2 2 2 . . . . . .            469 hexes · 7 walls · zones 12×5 · minInterZone 11 · 6 anchors
       ( ^=h3  +=h2  .=h1  #=wall  *=glyph anchor  1-5=start zones )
```
All three: flat grass start zones spaced **≥10** (no turn-one Range-9 snipe), a raised centre +
ridges, isolated height-15 rock walls (cover / LOS breakers, never sealing), and symmetric glyph
anchors. The Pentad is **approximately** 5-fold (a hex grid can't be exactly 5-fold) — handled
honestly: caps are trimmed to equal size (12 each), and the symmetry test asserts only near-equal
rim radius. `maps.test.ts` asserts the full invariant set incl. exact rot120 (3p) + offset
double-mirror (4p) terrain invariance.

---

## Playthroughs + tests
- Fuzzer (`fuzz.test.ts`): green (random 2-6p games + invariants).
- `audit-playthrough.test.ts`: green (full 2p + 3p+teams + FFA, lobby→win).
- `maps.test.ts`: 29 pass (incl. 6 new-map invariant tests).
- **487 HeroScape tests pass; production build clean.**

### Recommended regression tests (for the open issues, when fixed)
- **O1:** Explosion/Fire Line/Grenade/etc. destroying Finn or Thorgrim (with the owner's other card
  alive) → a `spirit_placement` opens; Mitonsoul rolling a 1 on Finn → the Spirit after the
  ceremony; a single special destroying **both** Finn and Thorgrim → **both** Spirits placeable.
- **O2:** a Lodin holder's figure rolling a natural 1 under Mitonsoul survives (once the ruling lands).
- **Coverage gap (independent of a fix):** the fuzzer/playthroughs never run on the new maps with a
  `glyphSeed`, so the anchor-branch generation + AUTO/CHOICE glyphs on mounds aren't fuzzed — add a
  seeded playthrough on Triskelion/Crossroads/Pentad that drives a ceremony to completion.
