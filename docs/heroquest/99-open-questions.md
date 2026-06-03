# 7. Open questions & conflicts vs. the current build

Everything here needs a **decision from you** before (or as) we make the engine faithful.
Grouped by priority. Each item: 📖 what the rulebook says · 💻 what we do now ·
💡 my recommendation.

---

## ✅ Shipped (2026-06-03) — first fidelity passes

These were decided "full fidelity / apply all" and are now in the engine + tested:

- **Trap spring effects** — pit / spear / falling-block each behave distinctly; falling
  block rolls 3 dice and seals the square to a permanent wall. (Q1, part)
- **In-pit −1 combat die** penalty (attack & defend, min 1). (Q4)
- **Disarm odds** — Dwarf ~83% (springs only on a black shield); others need a Tool Kit,
  ~50%. Added the Tool Kit item. (Q2, part)
- **Trap-jumping** — leap a discovered trap (≥2 movement + clear landing; shield clears /
  skull springs); not an action; "Jump trap" button. (Q2, part)
- **Monsters attack orthogonally only** — fixed the chebyshev (diagonal) adjacency bug;
  a monster in melee range now strikes where it stands. (was a separate bug)
- **Treasure search** now gates on "no monsters **in the room**" (not "visible"). (Q4)

**Still open below:** chest/furniture traps (Q's C), the treasure-deck wandering-monster /
hazard split (Q3), the 0-BP death-save (Q4 remainder), and everything blocked on the
incoming scans (Q5–Q7). The card/quest material is the gate for those.

---

## A. Conflicts where the engine diverges from the rulebook

### Q1 — Trap fidelity (biggest gap) ⚠
📖 The four traps behave very differently from each other:
- **Pit**: −1 BP, end turn, leaves a pit you're now *in* (−1 combat die while inside), can
  be jumped.
- **Falling block**: roll **3 dice, −1 BP per skull, no defending**, and the square
  becomes a **permanent wall** (can cut heroes off — it reshapes the map).
- **Spear**: roll **1 die** — shield = **dodge (no damage, keep moving)**, skull = hit;
  one-time, leaves no tile.
- **Chest/furniture**: effect defined by the quest notes.

💻 Right now pit, spear, and falling-block are all just a flat **−1 BP**; jumping and the
in-pit penalty aren't implemented.

💡 **Recommend implementing full fidelity.** The falling-block "permanent wall" especially
changes tactics and map flow. This is the headline rules upgrade.

### Q2 — Disarm & jump mechanics ⚠
📖 Disarm: announce, **move onto the trap square**, roll 1 die. **Non-dwarf needs a tool
kit** (shield = success, 50%); **Dwarf needs no kit** (only a black shield fails, ~83%).
Jumping a trap: needs ≥2 movement + an open landing, roll 1 die (shield = clear, costs 2
squares).

💻 We disarm from an **adjacent** square (not onto it), fail on a skull, with no
dwarf/tool-kit distinction; jumping isn't implemented.

💡 **Recommend implementing faithful disarm odds + tool-kit gating + jumping** alongside Q1.

### Q3 — Treasure deck behaviour ◑
📖 ~Half the treasure deck is **wandering monsters / hazards** that are **reshuffled**
(reusable); gold/potion/item cards **leave the deck until the next quest**. A wandering
monster is placed next to the searcher and immediately attacks only them. Each hero may
search a given room **only once**; rooms only (not corridors); room must be monster-free.

💻 Treasure exists but the monster/hazard split, reshuffle-vs-deplete, and the
once-per-hero / monster-free gates may not all match.

💡 **Recommend matching the rulebook**, with wandering-monster identities driven by quest
notes.

### Q4 — Small confirmations (likely quick fixes) ◑
- Monsters must **not pass over heroes** (heroes may pass heroes; monsters may not).
- **In-pit −1 combat die** (min 1), for heroes and monsters.
- **Search gates:** "no monsters visible" for secret-door/trap searches; "no monsters in
  room" for treasure.
- **Death save** at 0 BP (drink a healing potion any time, or cast a healing spell if you
  haven't acted).
- **Potions**: free to drink, any number per turn; can hand one to an ally on your turn.
- **Spells**: once per quest then discarded (confirm the UI greys out spent spells).

💡 Fold these into the same fidelity pass.

---

## B. Missing source material (outside this PDF) ❓

### Q5 — Page 22: "Ending the Quest" & "out of monsters"
The PDF excerpt stops at page 21. We're missing the **end-of-quest** rules (win recap,
between-quests flow, lost artifacts, unfinished quests) and the **"run out of monsters"**
rule. These underpin **campaign** and **store-between-quests**.
💡 Can you send a scan/photo of page 22 (and ideally the full Quest Book + GM screen)? If
not, I'll **design faithful house rules** for these and mark them clearly as ours.

### Q6 — Card faces (spells, Dread spells, equipment, artifacts, treasure)
We have counts but not the **effects**: 12 spells (4 groups × 3), 12 Dread spells, 23
equipment, 14 artifacts, 24 treasure. These are needed to finish the spell, armory, and
treasure systems.
💡 Same ask: scans if you have them, otherwise I'll author a faithful set and flag it as
custom.

### Q7 — The Dread Sorcerer monster
📖/contents: the box includes **1 Dread Sorcerer** (the Dread-spell caster). Our
`MONSTER_STATS` doesn't have it yet.
💡 **Recommend adding it** (stats + token) so Zargon's magic has a natural caster.

---

## C. Design refinements to confirm

### Q8 — Reveal strictness (our deliberate refinement)
📖 The rulebook uses **one** line-of-sight rule of thumb for both *looking* and
*targeting* (lenient: grazing a corner doesn't block).
💻 We intentionally use a **stricter** rule for **revealing/looking** (so fog doesn't leak
around corners) and the rulebook's **lenient** rule for **targeting** spells/attacks — per
your earlier "looking = physical player, line of sight = character" guidance.
💡 **Recommend keeping the split** (it fixed the "random hallways revealing" bug). Flag if
you'd rather go strictly book-accurate (one lenient rule for both).

### Q9 — 3d4 movement scope (confirm)
🎲 House rule: heroes roll **3d4** for movement. The rulebook never rolls **monster**
movement (fixed from the chart), so 3d4 is **heroes-only**.
💡 **Recommend heroes-only 3d4, monsters stay fixed** — confirm that's the intent.
