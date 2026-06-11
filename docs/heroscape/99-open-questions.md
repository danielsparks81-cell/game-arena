# HeroScape — Open Questions & Known Gaps

> Everything the rulebook scan could NOT settle, with what we know and what
> would settle it. Check items off here before coding the affected mechanic.

## 1. Combat die face distribution — ⚠ blocking for `rollCombatDice`

The rulebook **never states** how many skull / shield / blank faces the combat
d6 carries. Verified exhaustively at high zoom across pages 3, 4, 6, 9, 13, 14:
component lists give quantity only ("12 Combat Dice"), and every die
illustration depicts *rolled results*, not the die layout. What IS proven by
the Example 9 illustrations: the same white d6 carries red-skull faces,
blue-shield faces, and at least one blank face; shields rolled on attack and
skulls rolled on defense are ignored; blanks count nothing.

**Community-standard distribution: 3 skulls / 2 shields / 1 blank.** Verify
against the physical dice (a photo of all six faces settles it) before coding.

## 2. Army Card roster — blocking for `content.ts`

The Master Set has **16 Army Cards / 30 figures** (p. 3) but the rulebook shows
only **Agent Carr** in full (Life 4 / Move 5 / Range 6 / Attack 2 / Defense 4 /
100 pts, p. 7). Data leaked by examples (cross-check anchors, see
01-components-setup-army-building.md): Zettian Guards (2 figures, Basic stats
Mv 4 / Rng 7 / Atk 2 / Def 7), Marro Warriors (4 figures, Atk 2), Syvarris
(Life 4, Def 2).

Card names appearing anywhere in the rulebook (partial roster evidence, NOT
confirmed complete): Mimring, Marro Warriors, Zettian Guards, Airborne Elite,
Agent Carr, Syvarris, Thorgrim the Viking Champion, Sgt. Drake Alexander,
Ne-Gok-Sa, Deathwalker 9000, Raelin, Finn, Izumi Samurai, Tarn Viking Warriors.

**Needed: photos/scans of all 16 Army Cards (both Basic and Master sides),
including special-power text and point values.**

## 3. Battlefield map data — blocking for `maps.ts`

The five battlefield build diagrams (pp. 18, 20–22, 24, 26–27) are **illegible
at scan resolution** — hex-by-hex placements cannot be derived. Options:
higher-resolution scans of those pages, or community map files (VirtualScape
`.hsc` exists for all official maps) plus a small importer. Do **not** fabricate
coordinates from the thumbnails.

## 4. Ambiguity in the SOURCE text: Major/Extreme Fall thresholds

P. 10 prints "if the drop is **10 levels more** than the figure's height"
(major fall) and "**20 levels more**" (extreme fall) — neither "exactly" nor
"or more". The only coherent reading is banded:

| Drop − Height | Result |
|---|---|
| ≥ 0 (i.e. drop ≥ Height) | Fall — roll 1 combat die, 1 wound per skull |
| ≥ 10 | Major Fall — roll 3 dice total |
| ≥ 20 | Extreme Fall — roll d20: 19–20 survive unharmed, 1–18 destroyed |

Engine implements the banded reading. (Basic Fall threshold is verbatim
"equal to or more than the figure's height" — that one is explicit.)

## 5. Flying — base definition lives on cards we don't have

P. 16 settles flying vs overhangs/engagement (ignores elevation costs, no
swipe from figures flown over, swipe still taken from figures engaged at
takeoff, passes over ruins). But "Flying" is a card power — its full base text
presumably lives on Raelin's / the Airborne Elite's cards. **Resolve with the
card scans (see #2).**

## 6. Minor unresolved scan items

- **Winter Holdout 4-player point budget = 160** — read at [medium] confidence,
  corroborated by the matching reinforcement value. Re-verify if a better scan
  of p. 21 appears.
- **Example 6 caption** compares "6 moves" against Height 4 while the height
  limit rule is stated in *levels* (the cliff is a 5-level rise). The climb is
  illegal under either count; engine implements **levels risen ≥ Height ⇒
  illegal** per the rule text, not the caption's movement count.
- **P. 3 "two scenarios per battlefield" vs p. 4 "3 Basic Game Scenarios"** —
  reconciled by the scenario section itself: 5 battlefields × 2 scenarios
  each = 10 total, of which 3 are Basic (Attack at Dawn, Dive the Dark Lakes,
  Search for Comfrey Plants) and 7 are Master. No conflict.

## 7. Deliberate digital deviations (decided, documented, not open)

Recorded here so nobody "fixes" them back:

- **LOS d20 dispute roll dropped** — deterministic geometric LOS has no
  disputes (ARCHITECTURE.md §7, 04-combat-range-los-attack.md).
- **Tabletop etiquette rules** (walking around the table, touching figures
  only on your turn, physically hiding order markers) — no engine equivalent
  needed; projection handles information hiding.
- **Physical tile assembly** (linking/stacking, p. 17) — maps ship precomputed
  in `maps.ts`; the build steps are tabletop-only.
