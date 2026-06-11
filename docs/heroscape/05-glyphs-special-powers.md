# HeroScape — Glyphs & Special Powers

> Mechanics below are summarized in our own words for the digital adaptation — this is not a reproduction of the rulebook text.

Covers the Master Game glyph system and special-power rulings (pp. 14–16), plus how scenarios repurpose glyphs (pp. 17–28). Component data: the Master Set contains **10 glyphs** — 9 distinct designs, with the Glyph of Brandar appearing twice (pp. 3, 17).

---

## 1. Glyphs — core rules (p. 15)

### Placement & orientation

- Which glyphs appear, where they sit, and which face is up is dictated entirely by the **Game Scenario** (p. 8, p. 15). Glyphs are **stationary** unless a scenario says otherwise.
- Each glyph has two faces: **symbol-side up** (identity hidden / dormant) and **power-side up** (identity revealed / power active).
- Glyphs **add no height** to the space they sit on — they never affect height advantage, climbing cost, or adjacency math (pp. 10, 14). See 04-combat-range-los-attack.md.
- On scenario maps (p. 17), a symbol-side-up glyph is marked with a **"?" hex**; a power-side-up glyph is marked with a hex bearing the glyph's **initial letter** (A = Astrid, G = Gerda, I = Ivor, V = Valda, D = Dagmar, B = Brandar, K = Kelda, E = Erland, M = Mitonsoul).

### Forced stop & flipping (automatic)

| Situation | What happens |
|---|---|
| A figure moves onto a **symbol-side-up** glyph | Movement **stops immediately**; flip the glyph **power-side up**; its power takes effect **immediately** |
| A figure lands on a **power-side-up** glyph | Movement **stops immediately**; the power applies per its class (below) |

**Notes**

- Entering the glyph's space is a **player choice**; everything after entry (stop, flip, power activation) is **automatic** — there is no way to walk across a glyph without stopping.
- The stop ends only that **figure's movement** for the turn (remaining Move is forfeited). It does not end the card's activation: other squad figures still move, and Action 3 (attack) still happens normally.
- The Glyph of Kelda carries an extra **entry restriction** — an unwounded figure may not stop on it, which (combined with the forced stop) means an unwounded figure may not enter its space at all (see §2).

### Double-space figures

- A double-space figure (e.g., Grimnak, Mimring) must stop when its **leading end** moves onto a glyph (p. 15). The leading end is what triggers — and occupies — the glyph.
- ⚠ The rulebook says nothing about the **trailing end**: whether a trailing space passing over (or resting on) a glyph triggers or holds it is undefined. The leading-end sentence is the only double-space provision on p. 15. Recommended engine reading: only the leading end triggers/holds glyphs.

### Permanent vs. temporary

- **Permanent glyphs** (Astrid, Gerda, Ivor, Valda, Dagmar): the power is in effect **only while a figure stands on the glyph**, and it benefits **the controller of the occupying figure** — it applies to **every figure that player controls** (the occupant included), not just the occupant.
- **Temporary glyphs** (Kelda, Erland, Mitonsoul): the power fires **exactly once** — when a figure moves onto the glyph, resolve its rule, then **remove the glyph from the game**.
- **Artifact exception:** the two **Glyphs of Brandar** are listed with the permanent glyphs but have no fixed power — they represent scenario objects and follow the scenario's rules (see §3).

**Notes**

- Permanent-glyph control follows occupancy: if an opponent's figure later stands on the glyph, the bonus switches to that opponent. Nobody standing on it = no effect.
- The bonuses are army-wide auras, not occupant-only buffs — easy fidelity trap.

---

## 2. The glyph roster (p. 15)

### Permanent glyphs

| Glyph | Map key | Power | Effect while one of your figures occupies it |
|---|---|---|---|
| Glyph of Astrid | A | Attack +1 | **Each figure you control** rolls **1 extra attack die** |
| Glyph of Gerda | G | Defense +1 | **Each figure you control** rolls **1 extra defense die** |
| Glyph of Ivor | I | Range +4 | **Each figure you control with Range 4 or more** adds **4** to its Range number |
| Glyph of Valda | V | Move +2 | **Each figure you control** adds **2** to its Move number — but the bonus does **not** apply to the move that takes the occupying figure **off the glyph** |
| Glyph of Dagmar | D | Initiative +8 | Add **8** to your initiative d20 roll |
| Glyph of Brandar (×2) | B | Artifact | No fixed power — rules vary per Game Scenario |

**Notes**

- **Ivor threshold:** figures with Range 1–3 get nothing — no partial boost; melee figures are unaffected.
- **Valda exit exception:** when the occupant leaves the glyph it moves with its **unboosted** Move; every other friendly figure keeps +2 until the occupant's base actually leaves the space.
- **Dagmar and re-rolls:** initiative modifiers from powers or glyphs **also apply to initiative re-rolls** after ties (p. 9) — so Dagmar's +8 carries into every re-roll.

### Temporary glyphs

| Glyph | Map key | Power | One-time effect (on stopping there) |
|---|---|---|---|
| Glyph of Kelda | K | Heal | Only a figure with **1 or more Wound Markers** may stop here. When one of your figures stops here, remove **all** Wound Markers from its Army Card. May never be placed symbol-side up in **player-created** scenarios |
| Glyph of Erland | E | Summoning | You **may** summon **any other figure** on the battlefield — friendly **or enemy** — by moving it to a space **adjacent to the figure standing on the glyph**. The summoned figure receives **no leaving-engagement roll** even if it was engaged. If there is **no empty adjacent space**, the power cannot be used |
| Glyph of Mitonsoul | M | Massive Curse | For **every figure on the battlefield** (all players', your own included), roll the d20 once per figure: **1 = that figure is destroyed; 2–20 = safe**. Automatic, not optional |

**Notes**

- All three resolve, then the glyph is **removed from the game** — including Erland when the summon is declined or impossible, and Mitonsoul regardless of results.
- **Kelda:** the heal is total (all wounds), automatic on stopping, and the entry restriction is absolute — treat Kelda's space as **impassable-to-end-on** for unwounded figures. The symbol-side-up ban applies only to scenarios *you create*; official scenarios do place Kelda symbol-side up as a hidden objective (p. 23, see §3).
- **Erland:** the summon is a **player choice** ("may"), the choice of figure is unrestricted (any figure, any owner), and the destination is adjacent to **the figure on the glyph** — not merely adjacent to the glyph's hex (matters for double-space occupants). The waived swipe is specifically the **leaving-engagement roll** (p. 12; see the movement & engagement topic file).
- **Mitonsoul** hits the triggering player's own figures too — including, by the text's plain reading, the figure standing on the glyph. ⚠ The rulebook does not say which player physically rolls each d20; irrelevant for an engine (one fair d20 per figure), but flag it for UI attribution.

---

## 3. Scenario repurposing of glyphs (pp. 17, 21, 23, 25, 27)

See 07-scenarios.md for the full scenario rules; summary of the repurposing patterns:

- **Basic Game scenarios** use glyphs as **objects/objectives**, not powers; **Master Game scenarios** use them as powers per §2 (p. 17).
- **Glyphs of Brandar (Artifacts)** stand in for scenario objects: the two **deep-dive devices** in "Dive the Dark Lakes" (p. 21), two of the three **comfrey plants** in "The Search for Comfrey Plants" (p. 23), the **transfer post** in "Under Tempest's Cover" (p. 23), and the **map** in "Mimring's Fortress" (p. 27).
- **Hidden-objective shuffles:** "The Search for Comfrey Plants" turns **all 10 glyphs** symbol-side up, shuffles them, and seeds them on **10 "?" spaces** — the 2 Brandars + Kelda are the 3 real plants, the other 7 are **decoys whose powers never take effect** (revealed decoys are removed from the battlefield). "Mimring's Fortress" shuffles Astrid/Gerda/Valda/Mitonsoul face-down onto 4 catacomb "?" spaces — there the powers **do** fire normally when flipped (p. 27).
- **Hidden-role token:** Kelda doubles as the secret **Hero Scout** marker in "Under Tempest's Cover" (p. 23) — placed on an Army Card, not the battlefield.
- **Inert marker:** "A Desperate Rescue Attempt" (p. 25) places a symbol-side-up glyph under Sgt. Drake as a prison marker — it cannot be moved and its power **has no effect**.

**Notes**

- Engine takeaway: glyph behavior must be **scenario-overridable** at three levels — placement/orientation, whether the printed power functions at all, and bespoke reveal/collection rules.

---

## 4. Special powers — general rulings (pp. 14–15)

- Special powers are printed on each Army Card and **override the general rules** — card text wins (p. 7). They are always in effect per their card text; players are expected to track opponents' powers (p. 15).
- A card's "**attack dice**" / "**defense dice**" wording always means the shared **combat dice** (p. 15). Rulebook example: Raelin's aura grants "+2 defense dice" — i.e., 2 extra combat dice on defense — to all figures her controller controls within 4 clear-sight spaces.
- **Clear sight spaces** (aura range measurement, p. 15): measured from the source figure's **Target Point**; a figure is inside the aura if **any part of the figure** — not merely its Hit Zone — is visible within the stated number of spaces. This is deliberately looser than attack LOS. See 04-combat-range-los-attack.md (Target Point / Hit Zone).
- Forgotten bonuses are **not retroactive** — the rulebook applies a "you snooze, you lose" convention to height advantage, powers, and glyphs (p. 14). (A digital engine should simply apply them automatically.)

## 5. Special attacks (pp. 14–15)

- If a card lists a **special attack**, using it is a **player choice**: it replaces that figure's normal attack for the turn (p. 14).
- Some special attacks can harm **friendly figures** (p. 14).
- **Unmodifiable rule (p. 15):** a special attack's dice can **never** be modified — no bonuses from glyphs, from other special powers, or from height advantage.
- **Multi-target ordering (p. 15):** when a special attack affects multiple figures, the **attacker chooses the order** in which the affected defenders make their defense rolls. Single exception: Mimring's Fire Line, whose order is fixed (below).

**Notes**

- The unmodifiable rule constrains the **attacker's roll only**. The defenders' rolls are still modified normally: in the grenade example below, a Samurai rolls **6 defense dice = 5 (Defense) + 1 (height advantage)** *against a special attack* (p. 16). An engine must not strip defense bonuses just because the incoming attack is special.
- "Cannot be modified" includes beneficial glyphs: a figure's grenade or fire-line dice ignore Astrid's +1 attack die.

### Mimring's Fire Line (worked example, p. 15)

- Mimring is a double-space figure; the fire line is traced from **either his front or his back space** (attacker's choice) in a **straight line**; all figures within **8 spaces along the line** are affected.
- Affected figures may be on **any elevation level**, provided Mimring has **clear line of sight** to them — the line penetrates overhangs, hitting figures on every visible level (the diagram shows Airborne Elite A1, A2, A3 at three different elevations all being hit).
- Mimring rolls his **4 attack dice separately against each affected figure** (unlike the grenade's single shared roll, below).
- Defense order is **automatic, not attacker's choice**: the figure **closest to Mimring along the line** rolls defense first, then the next closest, and so on.

**Notes**

- ⚠ Whether friendly figures standing in the line are also affected is not stated on p. 15; the p. 14 warning that some special attacks harm friendly figures suggests yes, but it is unconfirmed for Fire Line specifically — check Mimring's printed card text.
- The "4 attack dice" figure comes from the worked example (Mimring's Attack value); treat per-card data as card-sourced.

### Airborne Elite — grenade lob (worked example, p. 16)

Mechanics demonstrated by the example:

- Using the grenade power **removes the Grenade Marker from the game** — one use for the squad per game. On that one use, **each squad figure lobs its own grenade as a separate attack** (A1–A4 attack in sequence).
- Eligible targets: figures within **Range 5** and a **lob height of 12 levels or less**. Height-limit illustration: a figure atop an overhang could not be attacked because the overhang plus a 6-level ruin on top totals **16 levels**, exceeding the 12-level lob limit.
- **Line of sight is NOT required** — only height clearance for the lob.
- **Splash:** the grenade targets one figure; **every figure adjacent to the target is also affected** (friend or foe).
- The attacker rolls the grenade's attack dice (**2 dice** in the example) **once per grenade**; that single result applies to **every affected figure**. Each affected figure then rolls **its own defense separately** (with its normal defense bonuses, e.g., height advantage). Shields ≥ skulls = safe; shields < skulls = wounded per unblocked skull (these squad defenders are all Life 1, so any unblocked skull destroys them). If the attack roll yields **0 skulls, no defense rolls are made** — everyone affected is automatically safe.

Worked numbers (4 Airborne Elite A1–A4 vs. Samurai S1–S3 and Marro M1–M4):

| Grenade | Target | Splash (adjacent) | Attack roll (2 dice) | Defense rolls (shields) | Result |
|---|---|---|---|---|---|
| A1 | S2 | S1, S3 | **1 skull** | S2: 6 dice (5 Defense + 1 height advantage) → **2**; S1 → **3**; S3 → **0** | S2 safe, S1 safe, **S3 destroyed** |
| A2 | S2 | S1 | **0 skulls** | none needed | all safe |
| A3 | S1 | S2 | **2 skulls** | S1 → **1**; S2 → **2** | **S1 destroyed** (1 < 2), S2 safe (2 ≥ 2) |
| A4 | M2 | M1, M3, M4 | **1 skull** | M2: 3 dice → **1**; M1 → **2**; M3 → **3**; M4 → **0** | M2, M1, M3 safe, **M4 destroyed** |

**Notes**

- A3's line confirms the tie rule for special attacks: **shields equal to skulls = safe** (same as normal combat — see 04-combat-range-los-attack.md).
- In A1's attack the defenders resolved target-first (S2, then S1, then S3) — consistent with attacker-chosen ordering (§5).
- The grenade dice count (2), Range 5, and 12-level lob limit are demonstrated by this example; the authoritative wording lives on the Airborne Elite Army Card.

---

## 6. Flying (p. 16)

The rulebook's only flying rules text is the "Flying and Overhangs" worked example (Raelin flying out from under an overhang past two Marro figures). It establishes:

- A flying figure **ignores the extra movement cost of elevation changes** — it counts **spaces only**, never level sides, when moving up or down.
- It flies **over obstacles** (the example shows her passing over ruins) and over occupied spaces.
- Flying **over an enemy figure without landing** creates no engagement and triggers **no leaving-engagement roll** from that enemy.
- Takeoff is **not** free: an enemy the flyer was **engaged with when it started its move** rolls a **leaving-engagement die** (one die) against it, exactly as for ground movement (p. 12; see the movement & engagement topic file).

**Notes**

- ⚠ Flying is a card-granted power (e.g., Raelin), not a general rule — p. 16 gives no general definition and **no explicit landing rule**. The example's "flies over him *without landing*" phrasing implies that **landing** adjacent to an enemy engages normally; implement landing as ordinary movement-end. Confirm against the flyer's printed card text.

---

## 7. Simultaneous special powers (p. 16)

- If **opposing players field the same Army Card** and its power would trigger for both **at the same time**, the players **must** roll the d20; the **winner uses/resolves the power first**. Rulebook example: both players field the Airborne Elite — roll off for whose "**The Drop**" resolves first.

**Notes**

- The roll-off is mandatory ("must roll"), and it only orders resolution — both powers still resolve.
- "The Drop" also appears in scenario rules (banned as reinforcements / disabled by storm) — see 07-scenarios.md.

---

## ⚠ Open questions

- **Double-space trailing end vs. glyphs** (§1): only the leading end is addressed on p. 15; trailing-end behavior is undefined.
- **Fire Line friendly fire** (§5): not stated on p. 15; resolve from Mimring's card text.
- **Flying — general definition and landing rule** (§6): p. 16 is example-only; the power's authoritative wording is on the Army Card.
- **Mitonsoul roller attribution** (§2): the rulebook does not say which player rolls each figure's d20 (no mechanical impact).
