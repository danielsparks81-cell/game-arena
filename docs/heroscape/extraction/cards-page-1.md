# HeroScape Army Cards — Page 1 (2nd Edition layout)

Source scan: `C:\Users\Dan\Desktop\heroscape-extract\img-cards\page-01.png` (4 cards, 2x2 grid).
Extraction notes:
- Scan resolution is low; stat-chip digits are ~7px tall. Readings were cross-compared across cards (e.g. the three Jandar cards' Move glyphs are identical to each other and visibly different from Mimring's rounder Move "6", supporting Move 5 vs 6 distinctions). Every digit I could not read with certainty carries an inline `⚠ UNCLEAR` flag — those should be re-verified against a higher-resolution scan before the engine content file is finalized.
- Anchor check (rulebook): Tarn Viking Warriors points reads **50**, matching the expected ~50. No mismatch.
- High-res verification pass (2026-06-10): every ⚠ UNCLEAR digit below was re-read from the per-card high-resolution crops (`heroscape-extract\img-cards-hi\p1-*.png`) and resolved; outcomes are annotated inline as "(verified at high res)" or "(corrected at high res)". Note: the cross-card Move-glyph comparison described above was partly wrong — at high res Tarn's Move is **4**, not 5 (only Thorgrim and Finn share the Move-5 glyph). Two unflagged digits (Mimring Defense, Finn Defense) were also found wrong and corrected.
- Figure counts are NOT printed anywhere on these cards (expected for 2nd Ed fronts). Rulebook anchor: Tarn Viking Warriors = 4 figures — carry that into the content file from the rulebook, not the card.
- Power text bodies below are direct transcriptions of the printed rules text.

## Thorgrim the Viking Champion
- General: Jandar (blue badge, medal emblem) | Species: Human | Uniqueness: UNIQUE HERO | Class: Champion | Personality: Valiant | Homeworld: Earth
- Size/Height: Medium 5 | Life: 4 | Move: 5 | Range: 1 | Attack: 3 | Defense: 4 | Points: 80 (verified at high res — clear two-glyph "80", first digit is a double-bowl 8, not 9)
### Powers
#### DEFENSIVE AURA 1
All friendly figures adjacent to Thorgrim add 1 die to their defense. (Unconditional aura — no roll, no "may"; applies to ALL friendly figures while adjacent to Thorgrim; grants exactly 1 additional defense die.)
#### WARRIOR'S ARMOR SPIRIT 1
"When Thorgrim is destroyed," place this figure on any unique Army Card. Thorgrim's Spirit adds 1 to the defense number on that card. (Trigger: on Thorgrim's destruction; the owner places the figure on a card of their choice — card must be unique; effect: +1 to that card's printed Defense number.)

## Tarn Viking Warriors
- General: Jandar (blue badge, medal emblem) | Species: Human | Uniqueness: UNIQUE SQUAD | Class: Warriors | Personality: Wild | Homeworld: Earth
- Size/Height: Medium 5 | Life: 1 | Move: 4 (corrected at high res; low-res pass read 5) | Range: 1 | Attack: 3 | Defense: 4 (verified at high res — neither 3 nor 2: the glyph is an angular open-top 4, identical to this card's Move "4" and clearly distinct from the Attack "3" directly above it) | Points: 50
- Figures per squad: not printed on card. (Rulebook: 4 figures — matches expected squad size.)
### Powers
#### BERSERKER CHARGE
"After moving and before attacking," roll the 20-sided die. If you roll a 15 or higher, you "may" move all Tarn Viking Warriors again. (Timing window: strictly after the squad's move and before its attack; roll one d20; threshold 15+; the extra move is optional ("may") and applies to ALL Tarn Viking Warriors, not just one figure. No printed limit on repeats is visible in the card text.)

## Mimring
- General: Utgar (red badge, dragon emblem) | Species: Dragon | Uniqueness: UNIQUE HERO | Class: Beast | Personality: Ferocious | Homeworld: Icaria
- Size/Height: Huge 9 | Life: 5 (verified at high res — the "5 LIFE" hex is unambiguous; the Move "6" sits directly below it, the likely source of the earlier doubt) | Move: 6 | Range: 1 | Attack: 4 | Defense: 3 (corrected at high res; low-res pass read 4 — confirmed as 3 in both the p1-BL crop and the Mimring sliver visible at the edge of the p1-BR crop) | Points: 150
### Powers
#### FIRE LINE SPECIAL ATTACK
Range Special. Attack 4. Choose 8 spaces in a straight line from Mimring. All figures on those spaces who are in line of sight are affected by Mimring's Fire Line Special Attack. Roll 4 attack dice once for all affected figures. Affected figures roll defense dice separately. (Numbers: 8 spaces, straight line, 4 attack dice rolled ONCE for everyone; each affected figure rolls its own defense separately. Only figures in line of sight on those spaces are affected.)
#### FLYING
When counting spaces for Mimring's movement, ignore elevations. Mimring "may" fly over water without stopping, pass over figures without becoming engaged, and fly over obstacles such as ruins. When Mimring starts to fly, if he is engaged he will take any leaving engagement attacks. (Elevation changes cost nothing; water/figures/obstacles are overflown; leaving-engagement attacks DO apply when he starts to fly while engaged.)

## Finn the Viking Champion
- General: Jandar (blue badge, medal emblem) | Species: Human | Uniqueness: UNIQUE HERO | Class: Champion | Personality: Valiant | Homeworld: Earth
- Size/Height: Medium 5 | Life: 4 | Move: 5 | Range: 1 | Attack: 3 (verified at high res — clearly 3, not 4; the double-curve 3 glyph contrasts plainly with the angular Defense "4" in the row below, and with Mimring's Attack "4" visible at the edge of the same crop) | Defense: 4 (corrected at high res; low-res pass read 3 — as printed in this scan, Finn's statline is identical to Thorgrim's: 4/5/1/3/4/80) | Points: 80 (verified at high res — clear "80", not 90)
### Powers
#### ATTACK AURA 1
All friendly figures adjacent to Finn with a range of 1 add 1 die to their normal attack. (Unconditional aura; restricted to friendly figures that BOTH are adjacent to Finn AND have a printed Range of 1; grants exactly 1 additional die on NORMAL attacks only — not special attacks.)
#### WARRIOR'S ATTACK SPIRIT 1
"When destroyed," place this figure on any unique Army Card. Adds 1 to the normal attack number on that card. (Wording verified at high res: the printed text is exactly "When destroyed, place this figure on any unique Army Card. Adds 1 to the normal attack number on that card." — unlike Thorgrim's card it does NOT name Finn in either sentence. Mechanic: trigger on Finn's destruction, place on any unique Army Card of the owner's choice, +1 to that card's NORMAL Attack number.)
