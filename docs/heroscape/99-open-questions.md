# HeroScape — Open Questions & Known Gaps

> Everything the rulebook scan could NOT settle, with what we know and what
> would settle it. Check items off here before coding the affected mechanic.

## 1. Combat die face distribution — ✅ RESOLVED 2026-06-10

**3 skulls / 2 shields / 1 blank**, confirmed by the set's owner against the
physical dice (the rulebook itself never states it — verified exhaustively at
high zoom across pages 3, 4, 6, 9, 13, 14). Per-die hit probability: skull
1/2, shield 1/3, blank 1/6. `rollCombatDice` is unblocked.

## 2. Army Card roster — ✅ RESOLVED 2026-06-10

All 16 cards extracted from the user's card scan PDF
(`C:\Users\Dan\Desktop\Heroscape Base Game Cards.pdf`) with every flagged digit
verified against high-res per-card crops. Canonical roster: **cards.md**.
Raw per-page notes: `extraction/cards-page-{1..4}.md`. Page images:
`C:\Users\Dan\Desktop\heroscape-extract\img-cards*\`.

Two residual notes:
- **This is a rebalanced modern printing**, not classic 2004 RotV (e.g. Marro
  Warriors 105 pts / Range 6; Raelin Range 1 / 120 pts as printed). Policy:
  cards win for card content, rulebook wins for core rules (see cards.md
  "Edition note").
- **Cards are single-sided** — no separate Basic side in this printing. The
  Basic Game slice uses these stats and ignores special powers.
- Squad figure counts are not printed on the cards; they come from the
  rulebook (Tarn 4, Marro 4, Zettian 2, Izumi 3, Airborne Elite 4) — Krav Maga
  Agents inferred 3 from the card's banner silhouettes, ⚠ verify in play.

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

## 5. Flying — ✅ RESOLVED 2026-06-10

The base Flying text is on Mimring's and Raelin's cards (see cards.md): ignore
elevation when counting move spaces, fly over water without stopping, pass
over figures without becoming engaged, fly over obstacles such as ruins; if
engaged when starting to fly, leaving-engagement attacks apply. Consistent
with the p. 16 rulebook clarifications.

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
