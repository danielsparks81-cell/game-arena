# HeroScape 2nd Edition — Rules Reference

> Structured reference for the digital adaptation, built from the HeroScape
> 2nd Edition Master Set rulebook ("Rise of the Valkyrie", ©2004 Hasbro,
> 28-page scan). Mechanics are summarized in our own words for adaptation —
> this is not a reproduction of the rulebook.

## Reading order

| File | Covers |
|---|---|
| [01-components-setup-army-building.md](01-components-setup-army-building.md) | Component manifest, Basic/Master setup, Army Card anatomy, drafting (2p + snake), starting zones, Unique vs Common multi-set rules |
| [02-rounds-turns-order-markers.md](02-rounds-turns-order-markers.md) | Round structure, secret order markers (1/2/3/X), d20 initiative, the 3-turn round, marker loss on destruction, end of battle & scoring |
| [03-movement-elevation-terrain.md](03-movement-elevation-terrain.md) | Movement costs, climbing & the Height limit, falling tiers, water, double-space figures, overhangs, engagement & leaving-engagement swipes, flying |
| [04-combat-range-los-attack.md](04-combat-range-los-attack.md) | Attack eligibility, range counting, line of sight (Basic + Target Point/Hit Zone), attack resolution, height advantage, special attacks, the combat dice |
| [05-glyphs-special-powers.md](05-glyphs-special-powers.md) | All 9 glyphs with exact powers, permanent vs temporary, special-power rulings, the grenade-lob worked example, simultaneous-power roll-offs |
| [06-battlefield-key-assembly.md](06-battlefield-key-assembly.md) | Tile size/border-color/terrain matrix, assembly, glyph map legend |
| [07-scenarios.md](07-scenarios.md) | All 10 boxed scenarios (5 battlefields × Basic/Master) with budgets, round limits, special rules, victory conditions |
| [99-open-questions.md](99-open-questions.md) | **Read before coding** — unverified data (die faces!), missing content (cards, maps), source ambiguities, deliberate digital deviations |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How all of this maps onto the Game Arena platform: state model, phases, projection of order markers, hex/elevation model, build order |

## Provenance

- `extraction/pages-*.md` — page-by-page extraction notes from the scan
  (4 parallel readers, one per 7-page chunk).
- `extraction/resolutions.md` — every ⚠ UNCLEAR flag re-examined against
  high-resolution re-renders; [high]-confidence answers there are canonical
  and **override the extraction notes** where they differ.
- The topic files were then synthesized from both, and audited for
  completeness against the extraction (gaps patched).

The source scan lives at `C:\Users\Dan\Desktop\HeroScape_2nd_Edition_Rules.pdf`
(28 pages, image-only — no text layer). Page images:
`C:\Users\Dan\Desktop\heroscape-extract\img\`.

## Status

Rules are fully extracted and cross-checked. Engine work is **unblocked for
slices 1–3** (basic game, master turn engine, terrain — see ARCHITECTURE.md
§11). Slices 4–5 are blocked on content: the Army Card roster and battlefield
map data are not in this rulebook (99-open-questions #2, #3).
