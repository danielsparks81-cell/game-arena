# HeroScape roster — source of truth

`src/lib/games/heroscape/roster.json` is the **canonical card roster** for HeroScape. It is generated from
the **HeroScape Card Manager** desktop app's database (community tool), which is kept current — this export
is **database version 01/2026** and holds **264 official cards** across every line:

| era | cards | notes |
|---|---|---|
| classic | 156 | Milton Bradley / Hasbro 2004–2010 (Rise of the Valkyrie → Valkrill's Gambit + promos/terrain) |
| dnd | 48 | Wizards of the Coast D&D line (Battle for the Underdark + 3 waves) |
| marvel | 10 | Marvel: The Conflict Begins |
| modern | 35 | Renegade relaunch 2024+ (Age of Annihilation, Wellspring, Revna's Rebuke, Rising Tide…) |
| gijoe | 15 | Renegade G.I. Joe line |

Each entry: `name, faction, cost, set, wave, sortOrder, era, type, class, species, personality, size,
life, move, range, attack, defense, figuresPerCard, powers[]` (power `name` + verbatim `text`).

## Regenerate
```
node --experimental-sqlite scripts/heroscape/gen-roster.mjs <path-to>/heroscape.db src/lib/games/heroscape/roster.json
```
(The app exports a `*.hsmpkg`, which is a ZIP containing `heroscape.db`; unzip it first.)

## How this relates to the engine (`content.ts`)
`roster.json` is the **data reference**; the engine's `HS_CARDS`/`CARD_IDENTITY` remain the runtime source
because they also carry hand-authored **behavior flags** (flying, baseSize, disengage, bonding, glyph
interactions, power keys) that the DB doesn't model. When adding or auditing a card, take stats / faction /
set / era / power text from `roster.json`; implement the power in the engine.

### Costs — keep BOTH editions
The DB's `cost` is the **original/classic** printed value. The engine defaults to **Modern** costs and
carries **`CLASSIC_OVERRIDES`** for the Classic edition. So: `roster.json.cost` → the Classic value;
keep the Modern value in `HS_CARDS.points`. Our 29 live cards already reconcile this way (all classic
overrides match the DB: Raelin 80, Marro Warriors 50, Grimnak 120, Nilfheim 185, Major Q9 180).
**Open item:** Deathreavers — DB classic **40** vs our **60** (no override yet); confirm which printing
before adding a `deathreavers: { points: 40 }` override.

## Not covered by the DB
- **Custom (C3V/SoV) cards** — the DB is official-only. Community customs stay separate.
- **Power implementation** — the DB gives power text, not engine behavior.
- **Card images** — the DB stores image *paths* but the export bundles no images.
