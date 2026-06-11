# HeroScape — Combat: Range, Line of Sight & Attack

> Mechanics below are summarized in our own words for digital adaptation — this is not a reproduction of the rulebook text.

*Attack action (Action 3 of a turn — see 02-rounds-turns-order-markers.md). Source: rulebook pp. 5–6 (Basic Game combat) and pp. 13–15 (Master Game range, LOS, attack procedure, height advantage, special attacks), corroborated by high-resolution re-reads.*

## Who may attack (pp. 5, 13)

A figure on the active Army Card may attack a target only if **BOTH** conditions hold:

| # | Condition | Test type |
|---|---|---|
| 1 | Target is within the attacker's **Range** | Space-counting check |
| 2 | Attacker has a clear **Line of Sight** to the target | Geometric/visual check, independent of spaces |

- These are two **separate** tests — passing one says nothing about the other.
- If **no** figure on the active card satisfies both conditions against **any** enemy figure, no attack happens and the turn simply ends (pp. 5, 13).

**Notes**
- Engine: "no legal attack" is not an error state — Action 3 silently resolves to nothing and the turn ends.
- Master Game restriction: a figure **engaged** with one or more enemies may attack **only those engaged figures** — it cannot shoot past its engagement (p. 13). Engagement rules (adjacency, elevation/ruin exceptions, passing swipes): see 03-movement-elevation-terrain.md.

## Range (pp. 6, 13)

- Range is counted **in board spaces** from the attacker to the target. Range 7 ⇒ any enemy within 7 spaces is a legal target (Range-wise).
- **Range 1 = melee:** may only attack a figure on an adjacent space.
- **Elevation is FREE for Range** — unlike movement, do **not** count level sides when counting Range spaces (pp. 6, 13). Height matters only through Height Advantage dice (below).
- **No counting across gaps:** where there are no spaces between attacker and target (board edge, chasm), the attack is still possible, but Range must be counted **along actual battlefield spaces around the gap** — never as the crow flies (pp. 6, 13).
- **Double-space figures** measure Range **from either of their two occupied spaces** (owner picks the better end) (pp. 6, 13). See 03-movement-elevation-terrain.md for double-space figures generally.

**Notes**
- Engine: range counting and movement-cost counting are different metrics over the same hex graph — range ignores elevation steps and water stops, but still routes around holes in the board.
- Engine: intervening figures never affect Range; they only matter (if at all) through the LOS test below.

## Line of Sight (pp. 6, 13)

LOS is an **imaginary straight line through 3-D space** — explicitly contrasted with Range; it ignores spaces/hexes entirely. Tabletop procedure: physically sight from behind the attacking figure's head toward the target.

| | Basic Game (p. 6) | Master Game (p. 13) |
|---|---|---|
| Sight from | Behind the attacker's head | The attacker's **Target Point** |
| Must see | **ANY part** of the target figure | **Any part** of the target's **Hit Zone** |

- **Target Point (Master, p. 13):** the point from which LOS is drawn, marked as a **green dot** on the figure's silhouette on its own Army Card.
- **Hit Zone (Master, p. 13):** the body region that must be (partly) visible for the target to be attackable, marked as a **red area** on the target's card silhouette. The Master Game thereby tightens Basic's "see any part of the figure" to "see any part of the Hit Zone" — seeing only a non-Hit-Zone part (e.g., a protruding weapon, if outside the red area) is not enough.
- **Fully hidden = untargetable:** if the target is completely concealed (behind a ruin, below a ledge), it cannot be attacked at all (p. 6).
- **LOS may pass beyond the board edge** — empty areas with no spaces do not block sight; only physical obstructions do (p. 6).
- **Intervening figures do NOT block an attack by themselves** — there is no "cover" or "blocked by body" rule; only the LOS test matters. Example 16 (p. 13): a Tarn Viking standing partially between a Marro Warrior and Syvarris does not stop the attack, because part of Syvarris' Hit Zone is still visible. Partial obstruction is irrelevant — any visible sliver of the Hit Zone suffices.

**Notes**
- Engine: model LOS as a 3-D segment test from the attacker's Target Point to a set of sample points on the target's Hit Zone — a hit on ANY sample point clears LOS. Figures (friendly or enemy) standing in between can physically occlude, but occlusion only fails the test if they hide the **entire** Hit Zone.
- Engine: per-figure Target Point / Hit Zone geometry is card data (the silhouettes on the Master card side, p. 7) — capture it during card data entry.

### Tabletop-only procedures (p. 13) — no engine impact

These are physical-table rules; a digital adaptation replaces or drops them:

- **Looking for hidden figures:** players may walk around the table at any time to see what hides behind ruins/terrain; other players may shield their Order Markers while they do. *Digital equivalent: the renderer/camera already gives this; order-marker secrecy is handled by projection (see 02-rounds-turns-order-markers.md).*
- **Adjusting figures:** figures may be touched/repositioned **only on the owner's own turn** — you cannot nudge your figure out of LOS during an opponent's turn. *Digital equivalent: positions are exact state; moot.*
- **LOS disputes:** if players disagree about whether LOS is clear, roll the 20-sided die — the **high roller wins the dispute**, no further argument. *Adaptation note: our engine uses a deterministic geometric LOS check (see ARCHITECTURE.md §7), so this tabletop dispute rule is dropped entirely.*

## Attack resolution (pp. 6, 14)

Figures on the active card attack **one at a time, in any order** the owner chooses. Each figure attacks **at most once per turn** (unless a special power says otherwise, p. 14). Multiple figures **MAY pile onto the same defender** — there is no limit on how often a figure can be attacked (and it rolls a fresh defense each time). Each attack resolves fully before the next begins:

| Step | Who | What |
|---|---|---|
| 1. Declare | Attacker | Announce which of your figures attacks and which enemy figure is the target (the "Defender") |
| 2. Attack roll | Attacker | Roll dice = card **Attack** number **+ bonus dice** (height advantage, special powers, glyphs); count **only skulls** |
| 3. Defense roll | Defender | Roll dice = card **Defense** number **+ bonus dice** (same possible sources); count **only shields** |
| 4. Compare | — | Each shield blocks one skull |

Outcome of the comparison:

| Result | Basic Game (p. 6) | Master Game (p. 14) |
|---|---|---|
| shields ≥ skulls | Attack fails — nothing happens | Attack fails — nothing happens |
| skulls > shields | Defender **destroyed** outright (binary, no wounds) | **1 Wound Marker per unblocked skull** on the Defender's Army Card |

- **Ties favor the defender.** A failed attack has no side effects whatsoever — no partial damage, no retreat, no knockback (pp. 6, 14).
- Skulls rolled on defense dice and shields rolled on attack dice are **ignored**, as are blanks — only the "right" symbol counts on each side (p. 14; proven visually by Example 9's illustrated rolls, see below).
- Master Game: a figure is destroyed when Wound Markers equal its **Life**; for destruction consequences (figure placed on card, dead-card turns lost, markers returned, scoring) see 02-rounds-turns-order-markers.md.
- After every figure the player can and wants to attack with has done so, the turn ends (p. 6; play passes left, p. 14).

**Notes**
- Engine: the rolls are sequential (attacker first, then defender) — irrelevant for plain attacks but keep the ordering in case card powers ever key off "after the attack roll".
- Engine: bonus dice stack from multiple sources (height advantage + powers + glyphs) on **both** sides of the roll.
- The rulebook applies a "you snooze, you lose" convention (p. 14): bonuses a player forgets to claim are not retroactive. *Adaptation note: a digital engine computes all applicable bonuses automatically, so this convention is moot.*

## Height Advantage (pp. 6, 14)

- Compare **base elevations only** — the level each figure's base stands on; sculpt/model size is irrelevant.
- If one figure's base is on a **higher level** than the other's, the higher figure rolls **+1 die**. This is **symmetric**: a higher attacker rolls +1 attack die; a higher defender rolls +1 defense die.
- If the higher figure's base is **10 or more levels above the lower figure's Height**, it rolls **+2 dice instead** (p. 14) — "instead", so +2 total, not +3.
- Reminder (pp. 10, 14): **glyphs and water add no height** to the spaces they sit on. See 03-movement-elevation-terrain.md for level/Height mechanics.

**Notes**
- Engine: evaluate height advantage **per attack, per figure pair** — Example 9 (below) shows two attackers each independently qualifying against the same defender.
- ⚠ The +2 threshold mixes units: the higher figure's **base level** is compared against "10 + the lower figure's **Height** (levels)" — i.e., it keys off the lower figure's Height number, not its base level. That is the printed rule; implement as written.

## Special attacks (pp. 14–15) — brief

- Some Army Cards carry a **special attack**; the owner may **choose** to use it **instead of** a normal attack (p. 14).
- Special attacks **cannot be modified by ANY bonus dice** — not height advantage, not glyphs, not other powers (p. 15).
- When a special attack hits **multiple targets**, the **attacker chooses the order** in which the affected figures are resolved (p. 15).
- Warning printed on p. 14: some special powers/attacks can harm **friendly** figures too.
- Full special-power and glyph rules, including the Airborne Elite grenade worked example: see 05-glyphs-special-powers.md.

## The combat die (pp. 3, 4, 8)

- The Master Set contains **12 combat dice** (p. 3), kept in a shared pool: the **same dice** are read as attack dice (count skulls) and defense dice (count shields) (pp. 4, 8).
- The faces carry three symbols, confirmed from the Example 9 illustrations (p. 6): **red skull**, **blue shield**, and **blank**. Off-symbols never count: a shield rolled on an attack die and a skull rolled on a defense die are both ignored, as are blanks.
- ⚠ **The rulebook NEVER states the face distribution** (how many skull/shield/blank faces per d6). Confirmed exhaustively at high zoom across pp. 3, 4, 6, 9, 13, and 14 — no text or diagram enumerates the faces anywhere. The community-standard distribution is **3 skulls / 2 shields / 1 blank**, but that is external knowledge and **must be verified against physical dice before coding** the RNG.
- The 20-sided die is not a combat die — in combat contexts it appears only in the (dropped) tabletop LOS-dispute rule above. Its other uses (initiative, draft order, extreme falls) live in the other topic files.

## Worked examples — engine-corroborating data

Use these as test fixtures: the rulebook's own numbers, exactly as printed.

### Example 8 (p. 6) — Range + LOS check, Basic Game

| Fact | Value |
|---|---|
| Attacker / Range | Zettian Guard, Range **7** |
| Spaces counted to target (Airborne Elite) | exactly **7** — just inside Range |
| LOS | sighting from behind the Guard's head, only the **top** of the target is visible → LOS clear |

Corroborates: range boundary is inclusive (distance = Range is legal); partial visibility suffices (Basic Game).

### Example 9 (p. 6) — full attack sequence, Basic Game

Two Zettian Guards (Attack 2) attack the same Airborne Elite figure (Defense 2); both Guards stand higher than the defender.

| Attack | Attack dice | Attack faces rolled | Skulls | Defense dice | Defense faces rolled | Shields | Result |
|---|---|---|---|---|---|---|---|
| Guard 1 | 2 + 1 height = **3** | skull, skull, blank | **2** | **2** | shield, shield | **2** | 2 ≤ 2 → blocked, nothing happens |
| Guard 2 | 2 + 1 height = **3** | skull, skull, *shield (ignored)* | **2** | **2** | shield, *skull (ignored)* | **1** | 2 > 1 → defender destroyed |

Corroborates: per-figure height advantage, pile-on onto one defender, tie-goes-to-defender, off-symbols and blanks ignored on both sides, binary destruction in the Basic Game.

### Example 16 (p. 13) — Range + LOS check, Master Game

| Fact | Value |
|---|---|
| Attacker / Range | Marro Warrior, Range **6** |
| Spaces counted to target (Syvarris) | **6** — within Range |
| LOS | a Tarn Viking stands partially between them, but part of Syvarris' **Hit Zone** is visible from the Marro's **Target Point** → LOS clear, attack proceeds |

Corroborates: intervening figures don't block by themselves; any visible part of the Hit Zone suffices; distance = Range is legal.

### Example 17 (p. 14) — wounds and destruction, Master Game

| Fact | Value |
|---|---|
| Attacker | Marro Warrior, Attack **2**, no bonuses → **2 attack dice** |
| Defender | Syvarris, Defense **2**, +1 die for (minor) height advantage → **3 defense dice** |
| Roll | **2 skulls vs 0 shields** → **2 wounds** → 2 Wound Markers placed |
| Aftermath | Syvarris already had 2 wounds → 4 total = his **Life 4** → destroyed; an Order Marker still on his card stays unrevealed and that turn is skipped (see 02-rounds-turns-order-markers.md) |

Implied card data: Syvarris — Life **4**, Defense **2**; Marro Warrior — Attack **2**. Corroborates: defender-side height advantage, one Wound Marker per unblocked skull, wounds accumulate across turns, wounds = Life ⇒ destruction.

## Open questions

- ⚠ **Combat die face distribution is unverified** (see above) — blocker for coding dice odds; verify against physical dice (community-standard 3 skull / 2 shield / 1 blank).
- ⚠ The Hit Zone / Target Point geometry exists only as silhouette art on each Master card (p. 7) — the rulebook gives no coordinates. The digital LOS model must define per-figure 3-D Target Point and Hit Zone volumes itself and document them per card.
- ⚠ The Basic Game describes sighting "from behind the attacker's head" without a Target Point; we read Basic LOS as the same geometric test with origin at the head and target = whole figure. The rulebook never reconciles the two procedures explicitly.
