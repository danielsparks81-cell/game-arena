# HeroScape — Movement, Elevation & Terrain

> Mechanics below are summarized in our own words for the digital adaptation — this is a rules reference, not a reproduction of the rulebook text.

*Source: HeroScape 2nd Edition rulebook pp. 4–5 (Basic Game movement), 9–12 (Master Game movement, elevation, engagement), 16 (flying). Combat-side rules (Range, LOS, height advantage, wounds/Life) live in 04-combat-range-los-attack.md.*

---

## 1. Core movement (p. 4, p. 9)

- On its card's turn, each figure on the active Army Card may move **0 up to its Move number** of spaces, in **any direction** (there is no facing). Move 5 ⇒ 0, 1, 2, 3, 4, or 5 spaces. Moving at all is **optional, per figure** (player choice).
- **Squad figures move one at a time**, in any order the controller chooses; one figure's move is fully completed before the next figure starts (p. 4, p. 9).
- Terrain can effectively shrink the budget: climbing costs extra (§3) and water force-stops (§5).
- Movement modifiers exist outside this file: the Glyph of Valda grants +2 Move (except for the move that leaves the glyph) — see 05-glyphs-special-powers.md — and Army Card special powers may override any movement rule (card text wins, p. 12).

**Notes**
- Move is a per-figure budget spent space by space; there is no "saving" movement across turns or figures.
- A figure may move fewer spaces than its budget freely — never force full movement in the engine.

## 2. Pass-through and occupancy (p. 4, p. 9)

| Space contains | Move through it? | End move on it? |
|---|---|---|
| Friendly figure (yours or a teammate's), **not engaged** | Yes | No |
| Friendly figure that is **engaged** (Master Game, p. 9) | **No** | No |
| Enemy figure | **No** | No |
| Empty space | Yes | Yes (terrain permitting) |

- The Basic Game (p. 4) states only "through friendly: yes / through enemy: never / end on occupied: never"; the Master Game (p. 9) adds the engaged-friendly exception.
- Special powers can override (e.g., Agent Carr's Ghost Walk: may move through **all** figures, friendly and enemy — p. 7).

**Notes**
- "Engaged" is a computed state (§8) — pathfinding must re-check it per friendly figure, per move.
- Ending on an occupied space is illegal even when passing through it was legal.

## 3. Climbing — moving up (p. 5, p. 10)

- **Cost:** moving onto a higher space costs **1 movement per level side climbed, plus 1 for the destination space itself**. A step rising L levels costs **L + 1** movement (up 1 level = 2; up 2 levels = 3; flat = 1).
- **No partial climbs:** if the figure's remaining Move cannot pay the **full** cost of the step, it cannot make that step at all (p. 10). Worked example (Ex. 5, p. 10): Finn (Move 5) cannot reach a ledge whose total path cost is 7.
- **Climb limit (Height stat):** a figure may **never rise, in a single step, a number of levels equal to or greater than its Height number**. Maximum legal single-step rise = **Height − 1 levels** (p. 10). Equality is illegal.
- **Glyphs and water tiles add NO height** to the space they sit on (p. 10) — a space's level is its terrain-tile stack only. (Also matters for height advantage — see 04-combat-range-los-attack.md.)

| Worked example | Numbers | Outcome |
|---|---|---|
| Ex. 4 (p. 5) | Zettian Guard, Move 4, climbs a ledge | Climb consumes the full 4 movement (sides counted) |
| Ex. 5 (p. 10) | Finn, Move 5; path to ledge top costs 7 | Cannot move there at all |
| Ex. 6 (p. 10) | Marro Warrior, Height 4; single step rising 5 levels (captioned "6 moves") | Illegal — rise ≥ Height |

**Notes**
- Implement the climb limit in **levels risen per step**, not movement cost: Example 6's caption compares "6 moves" to Height 4, but the printed rule is "a number of levels equal to or higher than its Height number all at once," and the pictured rise is 5 levels. Either count makes Ex. 6 illegal; levels is the rule as written.
- "All at once" = one step between adjacent spaces; a figure may rise more total levels than its Height across **multiple** steps, paying each step's cost.

## 4. Descending and falling (p. 5, p. 10)

- **Descent is free:** moving to a lower space costs only the destination space (1), no matter how many levels are dropped (p. 5, p. 10). But large drops trigger falling checks:

| Tier | Trigger (drop D in levels vs Height H) | Dice | Result |
|---|---|---|---|
| **Fall** | D **≥ H** ("equal to or more than the figure's height") | **1 combat die** | Each skull = 1 wound |
| **Major Fall** | D is **10 levels more** than H (read: H+10 ≤ D < H+20) | **3 combat dice total** (2 additional) | Each skull = 1 wound |
| **Extreme Fall** | D is **20 levels more** than H (read: D ≥ H+20) | **d20 only** — no wound dice | **19–20: survives with no falling damage; 1–18: figure destroyed** |

- The fall check is **automatic, not optional** — but taking the drop in the first place is a normal movement choice.
- Wounds from falls are **unblockable**: no defense roll exists for falling. Each skull places 1 Wound Marker on the figure's Army Card (Life/destruction: see 04-combat-range-los-attack.md). A Life-1 figure dies to a single skull.
- **Water-landing exemption:** the entire falling rule does **not** apply when the figure drops onto a **water space** — a figure may fall onto water from **any** level, safely (p. 10).
- Worked example (Ex. 8, p. 10): Marro Warrior (Height 4) descends a 5-level cliff → 5 ≥ 4, roll 1 die; no skull, no wound. (The rules text says "combat die," the example says "attack die" — same shared dice pool, p. 8.)
- The base Fall threshold triggers at **exact equality** (drop = Height falls). ⚠ The Major/Extreme thresholds are printed literally as "is 10 levels more than" / "is 20 levels more than" — the rulebook says neither "exactly" nor "or more." The only coherent reading is the banded one in the table (an "exactly" reading would leave drops of H+11…H+19 undefined). Implement banded; flag as a source-text ambiguity, not a scan issue.

**Notes**
- Roll **after the move** ("roll one combat die after moving"). ⚠ Whether a figure that descends two separate big drops in one move rolls twice is not addressed; recommend evaluating each qualifying down-step and rolling after the move completes.
- Drop D = level difference between the step's origin space and destination space.
- Extreme Fall is a pure survival check — it replaces wound dice entirely (all-or-nothing).

## 5. Water (p. 5, p. 11)

- **Forced stop:** moving onto a water space **from any space — including from another water space — immediately ends that figure's move** (automatic, not player choice). A figure crossing a lake therefore moves 1 space per turn while in it.
- **Leaving water onto higher land:** the normal climbing rule applies — count each climbed land-level side. Worked example (Ex. 9B, p. 11): water → adjacent higher land space costs **2** (side + landing space).
- Water spaces **add no height** (p. 10), falls onto water are safe from any level (§4), and a double-space figure can bridge a single water space (§6).

**Notes**
- Forced stops end the move but nothing else — the figure still attacks normally in Action 3.
- The full forced-stop list for movement: **water space** (this section), **glyph space, either side up** (p. 15 — see 05-glyphs-special-powers.md), and the scenario-specific variants of glyph stops.

## 6. Double-space figures (p. 5, p. 11)

Figures occupying two hexes (Grimnak, Mimring in the Master Set).

- **Leading end is a player choice** (front or back may lead). The trailing end must then **follow exactly through the spaces the leading end just vacated** — snake movement. Costs are paid by the leading end's path.
- **End-of-move constraint:** must always end its move on **two spaces of the same level**.
- **Water exception:** may pass over a **single** water space without stopping when that space lies between two non-water spaces (one end bridges it); it **must stop** as soon as it would occupy **two water spaces at once** (p. 5, p. 11).
- **Glyphs:** a double-space figure must stop when its **leading end** moves onto a glyph (p. 15) — the leading end is the trigger and holds the glyph. See 05-glyphs-special-powers.md.
- **Orientation matters physically:** Ex. 13 (p. 12) — Grimnak cannot back tail-first into a nook he can enter forward-facing (§7).
- Range is measured from either occupied space — see 04-combat-range-los-attack.md.

**Notes**
- The trailing end never takes a different path than the leader — no pivoting/side-stepping model is needed; store the path and trail one space behind.
- The same-level ending rule plus the two-water-spaces stop means a double-space figure can legally *end* astride water + land only if both spaces are the same level and at most one is water (Ex. 7, p. 5, shows Mimring ending straddling a water space on two same-level spaces).

## 7. Overhangs, base fit, and tight quarters (p. 11–12)

- **Overhang** = one or more tiles sitting above another tile with open space between (p. 11).
- **Moving under an overhang:** legal only for figures **physically small enough to fit** in the gap. Ex. 11 (p. 11): Finn fits under a Migol's Tomb overhang; Grimnak does not.
- **Moving up onto a low overhang:** count the **nearby supporting tile** as part of the climb's movement cost (Ex. 12, p. 12) — i.e., the climb path runs over the adjacent support, not magically through the lip.
- **Keep the base on the space (p. 12):** at the end of a move, the figure's base must lie **flat and entirely within** its space (both spaces for double-space figures); no overlapping other spaces or the gaps between them.
- **Tight quarters (p. 12):** a figure cannot move **through or onto** any space it cannot completely fit on (narrow passages, ruins, overhangs). Orientation can decide legality for double-space figures (Ex. 13).

**Notes**
- ⚠ These are physical-fit rules with **no numeric clearance threshold printed** (the rulebook never says, e.g., "fits if gap ≥ figure Height"). The digital adaptation must define a deterministic clearance model — recommended: a figure may enter a space under an overhang only if (overhang underside level − floor level) > figure Height, with the chosen rule documented as an adaptation decision.
- "Base fit" and "tight quarters" mostly dissolve digitally (hexes are exact), but the overhang-clearance and double-space-orientation consequences must be modeled explicitly.

## 8. Engagement (p. 12)

- A figure becomes **engaged automatically** the moment it is adjacent to an enemy figure (moving adjacent engages both figures; no choice involved).
- Engagement is mutual and per-pair; a figure can be engaged with **several enemies at once**.
- Consequence for combat: an engaged figure may attack **only** figures it is engaged with (p. 13) — see 04-combat-range-los-attack.md. Engaged friendly figures also block pass-through (§2).

**Adjacency exceptions** — figures on neighboring spaces that are nevertheless NOT adjacent and NOT engaged (p. 12):

| # | Exception | Exact threshold | Worked numbers |
|---|---|---|---|
| 1 | **Elevation** | One figure's **base level ≥ the other figure's Height number** → not adjacent | Ex. 14: Deathwalker's ledge is 5 levels; Finn's Height is 5; equal ⇒ **not** adjacent |
| 2 | **Ruin between the figures** | **Both** figures' Heights must be **strictly higher** than the ruin's height to be engaged; if even one is lower, not engaged | Ruin height 6: Finn (5) and Deathwalker (7) across it ⇒ **not** engaged |

**Notes**
- Exception 1 triggers at **exact equality** (base level = Height breaks adjacency) — confirmed by Example 14.
- Exception 2 requires *strictly* higher; the text never grants engagement at height-equal-to-ruin, so treat Height = ruin height as not engaged.
- Adjacency for engagement is therefore: hex-neighbors AND neither elevation exception nor ruin exception applies. These same exceptions gate melee (Range 1) attacks, since those require adjacency.
- Engagement is recomputed from positions — it is state-free (no "engagement token"); it begins and ends purely by geometry.

## 9. Leaving an engagement — passing swipes (p. 12–13)

- A figure may move **around** an enemy it is engaged with freely — staying adjacent space-to-space never triggers anything.
- The moment the figure moves onto a space **not adjacent** to an engaged enemy, that enemy **may take a "passing swipe"** at it:
  - **WHO:** the enemy figure being left; executed by its controlling player.
  - **PLAYER CHOICE:** optional — the rule says the figure "**may** take" the swipe (opponent's option, not automatic).
  - **DICE:** exactly **1 attack die** per swiping figure.
  - **DEFENSE:** none — the moving figure rolls **no defense dice**. A skull = **1 unblockable wound** (Wound Marker on its Army Card).
- **Multiple engagements (p. 12–13):** when a figure disengages from several enemies, **each** engaged enemy gets its **own separate 1-die swipe**. Ex. 15 (p. 13): Finn leaves two Tarn Viking Warriors → opponent rolls 2 dice (one per Viking), both skulls → 2 wounds.
- Bypasses exist outside this file: the Glyph of Erland's summon explicitly skips the leaving-engagement roll (see 05-glyphs-special-powers.md), and card powers can negate swipes entirely (Agent Carr's Disengage, p. 7).

**Notes**
- One swipe per enemy per disengagement event — not per space moved afterward.
- The governing sentence uses "may"; the multiple-engagement paragraph uses indicative phrasing ("the engaged figure rolls one attack die"), but the "may" controls — implement as a PendingChoice for the opposing player, per enemy.
- ⚠ Timing inference (not printed): the swipe resolves immediately "as soon as" the figure moves away, mid-move. The rulebook never says what happens if the swipe destroys a Life-1 figure mid-move; the natural reading is the figure is removed and its move ends. Adaptation decision — document it.
- A figure that moves from adjacent-to-enemy to a *different* space still adjacent to that enemy has not left the engagement — no swipe.

## 10. Flying (p. 16)

Page 16 teaches flying through a worked example (Raelin flying out from under an overhang); the general flying power text lives on the flyer's Army Card, not in the movement chapter.

- **Elevation is free:** a flying figure ignores the extra movement cost of elevation changes — it counts **spaces, not levels** (no climb costs; by extension the Height climb limit is moot while flying).
- **Obstacles:** it flies over obstacles such as **ruins**.
- **Flying over enemies:** passing over an enemy figure **without landing** creates no engagement and triggers **no** leaving-engagement roll from that figure (Raelin flies over M3 — nothing happens).
- **Takeoff is NOT free:** every enemy the flyer was **engaged with when it started its move** gets a normal leaving-engagement roll ("leaving engagement die", 1 die — Raelin's engaged Marro M1 rolls one).

**Notes**
- ⚠ Landing rules are not stated on p. 16. Implied by "flies over him without landing": landing adjacent to an enemy engages normally. The card-text definition of flying (and whether it ignores water stops, glyph stops, or falling on landing) is **not in the rulebook movement pages** — source it from the Army Card scans before implementing; until then, recommend: glyph/water forced stops apply to the landing space only, and no fall check on landing (a flyer descends, it doesn't fall).
- Scenarios can disable flying outright (storm rule in "Under Tempest's Cover", p. 23) — see 07-scenarios.md.

---

## Movement cost / forced-stop summary (engine table)

| Step onto… | Cost | Forced stop? | Extra check |
|---|---|---|---|
| Same-level land space | 1 | No | — |
| Higher land space, rising L levels | 1 + L | No | Illegal if L ≥ figure Height; full cost must be payable |
| Lower land space, dropping D levels | 1 | No | Fall check if D ≥ Height (§4) |
| Water space | 1 (+ climbed sides if it is higher) | **Yes** — move ends | No fall check ever (water exemption) |
| Glyph space (either orientation) | normal terrain cost | **Yes** — move ends | Glyph effect (05-glyphs-special-powers.md); double-space: leading end triggers |
| Space under an overhang | normal | No | Figure must physically fit (§7 ⚠) |
| Space occupied by unengaged friendly | normal (pass-through only) | Cannot end there | — |
| Space occupied by engaged friendly or any enemy | illegal | — | — |

## Basic Game vs Master Game (engine slice note)

The **Basic Game** (pp. 4–5) uses only: Move budget, squad-sequential movement, pass-through table (without the engaged-friendly clause), climb costs, free descent, water stops, and double-space movement. **Falling, the Height climb limit, engagement/swipes, overhang/tight-quarters rules, and flying are Master Game rules** (pp. 10–12, 16) and should be gated behind the Master ruleset in the engine.
