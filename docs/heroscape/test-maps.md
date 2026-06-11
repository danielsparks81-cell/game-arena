# HeroScape — Test Battlefields

> Small hand-authored maps for engine development and playtesting. These are
> NOT official maps (the rulebook's build diagrams are illegible — see
> 99-open-questions #3); they're sized to exercise specific mechanics in
> slices 1–3. Official battlefields come later via better scans or community
> VirtualScape files.

## Map notation

Maps are token grids using **offset rows** (odd rows shift right half a hex —
"odd-r" layout; convert to axial in `maps.ts`). Each token is
`<terrain><height>`:

| Token | Terrain |
|---|---|
| `G` | grass |
| `R` | rock |
| `S` | sand |
| `W` | water (height = the level of the water surface) |
| `.` | no hex (void — range must count around it, figures can't enter) |

Suffixed markers: `*` = glyph spot, `1`/`2` after `@` rows = start-zone owner.

---

## TEST-1 "Training Field" — slice 1 smoke test (flat, no terrain rules)

7 columns × 8 rows, all grass height 1. Start zones: rows 1 (player 1) and 8
(player 2), full width. Tests: seating, order of play, movement costs on flat
ground, basic attack/defense, elimination win. Nothing else.

```
row1@1: G1 G1 G1 G1 G1 G1 G1
row2:   G1 G1 G1 G1 G1 G1 G1
row3:   G1 G1 G1 G1 G1 G1 G1
row4:   G1 G1 G1 G1 G1 G1 G1
row5:   G1 G1 G1 G1 G1 G1 G1
row6:   G1 G1 G1 G1 G1 G1 G1
row7:   G1 G1 G1 G1 G1 G1 G1
row8@2: G1 G1 G1 G1 G1 G1 G1
```

Suggested armies: Finn vs Thorgrim + Tarn Viking Warriors vs Marro Warriors
(small, no ranged complexity beyond Marro 6).

## TEST-2 "The Knoll" — elevation mechanics

9 × 8 with a 3-tier rock hill in the center. Tests: climb cost (+1 per level),
climb limit vs Height, free descent, falling (jump off the 4-level cliff edge:
drop 3 onto height-1 grass = fall for Height-3 squads), height advantage
(+1 die), engagement-breaking elevation (Example 14 analog: height-5 figures
on R4 next to G1 are NOT adjacent to figures below).

```
row1@1: G1 G1 G1 G1 G1 G1 G1 G1 G1
row2:   G1 G1 G1 G2 G2 G2 G1 G1 G1
row3:   G1 G1 G2 R3 R3 R3 G2 G1 G1
row4:   G1 G2 R3 R4 R4 R4 R3 G2 G1
row5:   G1 G2 R3 R4 R4 R4 R3 G2 G1
row6:   G1 G1 G2 R3 R3 R3 G2 G1 G1
row7:   G1 G1 G1 G2 G2 G2 G1 G1 G1
row8@2: G1 G1 G1 G1 G1 G1 G1 G1 G1
```

The R4 summit is a natural Glyph of Astrid spot (`*` at row4 col5) once glyphs
land in slice 4.

## TEST-3 "Ford Crossing" — water + range-around-void

10 × 7. A water river splits two grass banks; a 1-hex ford and a sand spit are
the only dry crossings. Two void hexes test range counting around gaps. Tests:
water forced stop, climbing out of water, double-space figures vs water,
ranged attacks across the river, range counted around `.` voids.

```
row1@1: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
row2:   G1 G1 G1 G1 G2 G1 G1 .  G1 G1
row3:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
row4:   W1 W1 W1 S1 G1 S1 W1 W1 W1 W1
row5:   W1 W1 W1 W1 G1 W1 W1 W1 W1 W1
row6:   G1 G1 G1 G1 G2 G1 G1 .  G1 G1
row7@2: G1 G1 G1 G2 G2 G1 G1 G1 G1 G1
```

Suggested armies: Syvarris (Range 9 across the river) vs Airborne Elite;
Mimring to test Flying over the water entirely.

---

**Engine note:** keep these in `maps.ts` as parsed constants with a unit test
asserting cell counts, start-zone sizes, and that every `.` void is absent
from the cell record (not height-0 terrain).
