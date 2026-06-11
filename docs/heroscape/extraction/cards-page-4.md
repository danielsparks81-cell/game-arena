# Army Cards — Page 4 of card scans (Master Set, 2nd Edition layout)

Source: `C:\Users\Dan\Desktop\heroscape-extract\img-cards\page-04.png` — 4 cards in a 2x2 grid, read in order top-left, top-right, bottom-left, bottom-right.

Extraction caveat: no high-resolution crop of this page existed at first extraction (`img-hi\page-04-*.png` are RULEBOOK page 4, not this card page), so the page was read only at full-page scan resolution and uncertain numerals were flagged ⚠ UNCLEAR. UPDATE (re-verification pass): high-resolution quadrant crops now exist at `C:\Users\Dan\Desktop\heroscape-extract\img-cards-hi\p4-{TL,TR,BL,BR}.png` (~1905x2465 px, ~400 DPI) and every flagged item below was re-read at native resolution (viewed at 100% in an image viewer). All former ⚠ flags are resolved inline as "(verified at high res)"; two unflagged digits were found to be wrong at high res and are corrected inline (Izumi Attack, Drake Attack).

## Airborne Elite
- General: Jandar (blue badge, label "JANDAR") | Species: Human | Uniqueness: UNIQUE SQUAD | Class: Soldiers | Personality: Disciplined | Homeworld: Earth
- Size/Height: Medium 5 | Life: 1 | Move: 4 | Range: 8 (verified at high res) | Attack: 3 | Defense: 2 | Points: 110
### Powers
#### GRENADE SPECIAL ATTACK
Range 5. Lob 12. Attack 2.
Use this power once per game. Start the game with a grenade marker on this card. Remove the grenade marker to throw grenades. One at a time do the following with each Airborne Elite: Choose a figure to attack. No clear line of sight is needed. Any figures adjacent to the chosen figure are also affected by the Grenade Special Attack. Roll 2 attack dice once for all affected figures. Each figure rolls defense dice separately.
#### THE DROP
Airborne Elite do not start the game on the battlefield. At the start of each round, before you place Order Markers, roll the 20-sided die. If you roll a 13 or higher you may place all 4 Airborne Elite figures on any empty spaces. You cannot place them adjacent to each other or other figures, or on glyphs. (Verified at high res: the final sentence contains NO "any" — it reads exactly "You cannot place them adjacent to each other or other figures, or on glyphs." The word "any" does appear one sentence earlier, in "on any empty spaces". Also verified: the card prints no comma after "13 or higher".)

Notes:
- Squad figure count is not printed as a stat, but THE DROP text itself says "all 4 Airborne Elite figures" — 4-figure squad confirmed on-card.
- Cross-checks vs rulebook extraction: the grenade worked example (see `resolutions.md`, Airborne grenade Q) matches this text exactly — attacker rolls 2 attack dice ONCE for all affected figures, each defender rolls defense dice separately. "The Drop" is also named in the rulebook's Simultaneous Special Powers section. Components list (rulebook p.3) includes exactly one "Grenade Marker", consistent with the once-per-game marker here.

## Grimnak
- General: Utgar (red badge with dragon, label "UTGAR") | Species: Orc | Uniqueness: UNIQUE HERO | Class: Champion | Personality: Ferocious | Homeworld: Grut (verified at high res — crisp "GRUT", not "Gaut")
- Size/Height: Huge 11 | Life: 5 | Move: 5 | Range: 1 | Attack: 2 (verified at high res — clean "2" on the FEROCIOUS/skull row, clearly distinct from the "4" on the GRUT/defense row below it) | Defense: 4 | Points: 160 (verified at high res)
### Powers
#### CHOMP
Before attacking, choose one medium or small figure adjacent to Grimnak. If the chosen figure is a Squad figure, destroy it. If the chosen figure is a Hero figure, roll the 20-sided die. If you roll a 16 or higher, destroy the chosen Hero.
#### ORC WARRIOR ENHANCEMENT
All friendly Orc Warriors adjacent to Grimnak roll an additional attack die and an additional defense die.

Notes:
- Anchor check PASSED: rulebook anchor says Grimnak is an Orc champion riding a T-Rex with a "Chomp" power — card shows Species Orc, Class Champion, CHOMP present, and the card art shows the T-Rex mount. No mismatch.
- Chomp is unconditional auto-destroy on Squad figures (no roll); Hero destroy requires d20 roll of 16+. Trigger window is "Before attacking". Target restriction: one medium or small figure adjacent to Grimnak (i.e. large/huge figures cannot be Chomped).

## Izumi Samurai
- General: Einar (badge label "EINAR") | Species: Human | Uniqueness: UNIQUE SQUAD | Class: Samurai | Personality: Disciplined | Homeworld: Earth
- Size/Height: Medium 5 (verified at high res — size line reads "MEDIUM 5") | Life: 1 | Move: 6 (verified at high res) | Range: 1 | Attack: 2 (CORRECTED at high res — the earlier full-page read transcribed 3, but the printed digit on the DISCIPLINED/skull row is unambiguously 2 at native resolution. External-knowledge caveat, NOT from this scan: official printings list Izumi Attack as 3, so this PDF deviates here — recording as printed) | Defense: 5 (verified at high res) | Points: 60 (verified at high res)
### Powers
#### COUNTER STRIKE
When rolling defense dice against a normal attack from an adjacent attacking figure, all excess shields count as unblockable hits on the attacking figure. This power does not work against other Samurai.

Notes:
- General is EINAR — a fifth General badge outside the four listed in the extraction brief (Jandar/Utgar/Ullar/Vydar). Not treated as an error; recorded as printed. Flagging so the roster/general list gets updated.
- Anchor check: brief says Izumi Samurai = 3 figures. No figure count is printed anywhere on the card face (as the brief anticipated) — count ABSENT from card, take squad size from the rulebook/components.
- Counter Strike conditions worth preserving for the engine: applies only when DEFENDING, only against a NORMAL attack (not special attacks), only from an ADJACENT attacking figure; excess shields (shields beyond the skulls rolled) become unblockable hits on the attacker; explicitly does not work against other Samurai.
- This is the only power on the card (1 power).

## Sgt. Drake Alexander
- General: Jandar (blue badge, label "JANDAR") | Species: Human | Uniqueness: UNIQUE HERO | Class: Soldier | Personality: Valiant | Homeworld: Earth
- Size/Height: Medium 5 | Life: 5 (verified at high res) | Move: 5 | Range: 1 | Attack: 6 (CORRECTED at high res — the earlier full-page read transcribed 4, but the printed digit on the VALIANT/skull row is unambiguously 6 at native resolution) | Defense: 3 | Points: 110
### Powers
#### THORIAN SPEED
Opponents' figures must be adjacent to Sgt. Drake Alexander to attack him with a normal attack.
#### GRAPPLE GUN 25
Instead of Sgt. Drake Alexander's normal move, he may move only one space. This space may be up to 25 levels higher. When using the Grapple Gun, all engagement rules still apply.

Notes:
- Thorian Speed is a restriction on OPPONENTS ("must be adjacent") and applies only to NORMAL attacks — i.e. non-adjacent normal attacks (ranged) cannot target him; special attacks are not restricted by this power.
- Grapple Gun is a replacement move ("Instead of ... normal move"), permission "may", exactly one space, up to 25 levels higher; engagement rules (including leaving-engagement swipes) explicitly still apply.

---

## Page-level cross-checks
- Cards on this page: Airborne Elite, Grimnak, Izumi Samurai, Sgt. Drake Alexander — all 4 are on the Master Set roster.
- Mimring is NOT on this page, so no Fire Line duplication to note (Fire Line was captured from page 1).
- Ne-Gok-Sa and Marro Warriors anchors do not apply to this page.
- All former ⚠ items RESOLVED at native resolution from `img-cards-hi\p4-*.png`: Airborne Range 8; Grimnak Attack 2, Points 160, Homeworld Grut; Izumi Size "Medium 5", Move 6, Defense 5, Points 60; Drake Life 5; THE DROP final sentence has no "any" ("...adjacent to each other or other figures, or on glyphs."). Two unflagged digits were also corrected during the same pass: Izumi Attack 3 → 2 and Drake Attack 4 → 6 (both unambiguous at high res). No ⚠ UNCLEAR flags remain on this page.
