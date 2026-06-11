# HeroScape — Battlefield Key & Assembly

> Mechanics are summarized in our own words for the digital adaptation — this is not a reproduction of the rulebook text.

Covers the page-17 Battlefield & Game Scenario section opener: the tile size / border-color / terrain matrix, the physical linking & stacking rules, and the Glyphs Key legend used by every battlefield diagram. Per-map build data (pages 18, 20–22, 24, 26–27) is **not** reproducible from our scans — see §5.

---

## 1. Tile identification — center color + border color (p. 17)

Every terrain piece in a build diagram is identified by **two colors** (the chart's header cell literally instructs builders to "notice center and border colors"):

- **Center color = terrain type** (what the hex *is* in play).
- **Border/outline color = tile size** (how many hexes the physical piece spans — a diagram-notation convention for picking the right piece, with no in-game effect).

### Terrain types (center colors)

| Terrain | Center color |
|---|---|
| Grass | Green |
| Sand | Golden |
| Rock | Gray |
| Water | Blue |

### Size / border / terrain availability matrix

| Tile size (hexes) | Border color in diagrams | Grass | Sand | Rock | Water |
|---|---|---|---|---|---|
| 24-space | Tan | ✔ | — | ✔ | — |
| 7-space | Purple | ✔ | ✔ | ✔ | — |
| Triple space (3) | Black | ✔ | ✔ | ✔ | — |
| Double space (2) | Yellow | ✔ | ✔ | ✔ | — |
| Single space (1) | Red (land) / Blue (water) | ✔ | ✔ | ✔ | ✔ |

Two **ruin** pieces also appear in the key — they are wall scenery, not bordered hex tiles, and are drawn in diagrams as red zigzag symbols:

| Piece | Diagram symbol |
|---|---|
| Long ruin | Long red zigzag (≈3 peaks) |
| Short ruin | Short red zigzag (≈2 peaks) |

**Notes**
- The matrix was re-verified at high zoom: **rock double-space tiles exist** (yellow-bordered gray double hex), and **sand has no 24-space tile** — 24-space exists only in grass and rock. (Earlier low-res extraction had these two cells wrong.)
- **Water exists only as single spaces** (blue center, blue border). There is no multi-hex water piece in this Master Set.
- Single-space land tiles (grass/sand/rock) all use **red** borders; the blue border is reserved for the water single.
- These four terrains are the **complete terrain enum for this Master Set**. Boards flavored as "swamps" (Durgeth, Trollsford, pp. 22–25) are built entirely from these same grass/sand/rock/water pieces; additional terrain types (lava, road, etc.) exist only in expansion sets (p. 2).
- Engine relevance: tile size is **assembly-only**. A digital board needs only per-hex `terrain` + `height`; piece outlines matter solely when transcribing official builds from diagrams (the outline color tells you which physical piece a shape is).
- Terrain rules live elsewhere: water movement stop / falling immunity and the rule that **water and glyphs add no height to a space**, plus ruins blocking line of sight and gating engagement by height — see 04-combat-range-los-attack.md and the movement topic file.

## 2. Master Set tile inventory (p. 3, cross-check)

The page-3 component manifest matches the matrix exactly (every printed size/terrain combination exists in the box, and no other):

| Size (hexes) | Grass | Sand | Rock | Water |
|---|---|---|---|---|
| 24 | 6 | — | 2 | — |
| 7 | 5 | 2 | 3 | — |
| 3 | 5 | 2 | 3 | — |
| 2 | 5 | 2 | 3 | — |
| 1 | 16 | 4 | 6 | 21 |

Plus **2 ruin wall pieces** (1 long + 1 short).

**Notes**
- The sand line (2/2/2/4), previously the hardest to read, is now confirmed at zoom from the verbatim contents list.
- This inventory is the hard cap on what any **official** (single-Master-Set) battlefield can use — a useful sanity check when transcribing maps from community sources. Combining multiple sets lifts the cap (p. 16).

## 3. Assembly — linking and stacking (p. 17)

Battlefields are built with exactly two physical operations:

- **Linking** (horizontal): join tiles edge-to-edge by **sliding** one tile's notches into another's grooves. The rulebook explicitly says to slide them together, not press/snap them straight down — a physical-care instruction with no rules content.
- **Stacking** (vertical): seat one tile flat on top of already-placed tiles. Each stacked layer raises the hexes it covers by **one elevation level**.

**Notes**
- Digital equivalent: linking ⇒ the hex grid itself; stacking ⇒ an integer `height` per hex (number of layers under the walkable surface).
- Elevation produced by stacking feeds every height-based rule: climb costs and the Height-number climb limit, falling tiers, height advantage dice, adjacency/engagement exceptions, and overhangs (tiles stacked with open space beneath them). Those rules live in the movement and combat topic files (see 04-combat-range-los-attack.md for height advantage / LOS).
- Ruins are placed standing on the battlefield as the **final** build step of every official map (pp. 18–27); they are LOS-blocking walls (p. 3) with a height used by the engagement-across-ruins rule.

## 4. Glyphs in battlefield diagrams — the Glyphs Key (p. 17)

Role of glyphs by game mode (placement is always scenario-directed):

- **Basic Game scenarios:** glyphs represent **objects** (scenario objectives — e.g., the comfrey plants, the deep-dive devices).
- **Master Game scenarios:** glyphs grant **special powers** per the page-15 glyph rules. See the Glyphs & Special Powers topic file.

Every battlefield diagram marks glyph spaces with one of two badge styles:

| Badge in diagram | Meaning |
|---|---|
| Gold/orange hex containing **?** | Glyph placed **symbol-side up** (dormant; identity usually hidden — scenarios that use "?" spaces shuffle the glyphs before placing) |
| Red hex containing a white **key letter** | That **specific** glyph placed **power-side up** (identity known, power active) |

Key letters — each glyph's initial:

| Letter | Glyph | Copies in set |
|---|---|---|
| A | Glyph of Astrid | 1 |
| G | Glyph of Gerda | 1 |
| I | Glyph of Ivor | 1 |
| V | Glyph of Valda | 1 |
| D | Glyph of Dagmar | 1 |
| B | Glyph of Brandar | 2 |
| K | Glyph of Kelda | 1 |
| E | Glyph of Erland | 1 |
| M | Glyph of Mitonsoul | 1 |

**Notes**
- Total = **10 glyphs**, matching the page-3 component manifest; the two Brandar (Artifact) copies share the letter B.
- Physical faces (photos beside the key): **symbol side** = engraved emblem; **power side** = artwork face printing the glyph's name and power (the sample tile shown is "Glyph of Mitonsoul / Massive Curse").
- The "?" badge encodes **placement orientation**, not a specific glyph — which glyphs go onto "?" spaces (and whether they are shuffled) is stated by each scenario's Setup text.
- A figure that moves onto a glyph **must stop** in either orientation; that rule, the leading-end rule for double-space figures, and all nine glyph powers belong to the Glyphs & Special Powers topic file (p. 15).

## 5. Per-map build diagrams (pp. 18, 20–22, 24, 26–27) — data status ⚠

Diagram convention (consistent across all five battlefields):

- The first, largest diagram is the complete **Level 1** base layout.
- Each subsequent **LEVEL** diagram shows **only the tiles newly stacked at that elevation** in solid color, drawn over a ghosted/faded image of everything already built. Tile outlines use the §1 border-color code; glyph spaces use the §4 badges.
- The final diagram, **RUINS**, places the long/short ruin walls (red zigzags). Build order is therefore unambiguous: base layer → each level in ascending sequence → ruins last.

The five official battlefields:

| Battlefield | Build pages | Build steps observed |
|---|---|---|
| Table of the Giants | p. 18 | 6 level diagrams + ruins ⚠ |
| The Forsaken Waters | pp. 20–21 | 8 level diagrams + ruins ⚠ |
| Durgeth Swamps | pp. 22–23 | Levels 01–08 + ruins ⚠ |
| Trollsford Swamps | p. 24 | Levels 01–06 + ruins ⚠ |
| Migol's Tomb | pp. 26–27 | Levels 01–11 + ruins (tallest build) ⚠ |

- ⚠ **The hex-by-hex contents of these diagrams are NOT legible at our scan resolution.** Step counts above come from counting diagrams on the page; some level-badge numerals were inferred from sequence. **Do not fabricate coordinates** — authoritative map data for the engine's `maps.ts` must come from higher-resolution scans of these pages or from community map files, then validated against the §2 tile inventory.
- Scenario content printed alongside the maps (goals, setup, special rules, victory, round limits) is covered in the scenarios topic file, not here.

---

⚠ **Open items for this topic**
- Per-map hex data (all five battlefields) — pending higher-res scans or community sources, as above.
- Exact level counts per build where badge numerals were inferred (marked ⚠ in §5).
