# HeroQuest — internal canonical ruleset (wiki)

This is our **single source of truth** for HeroQuest rules, transcribed faithfully from
the user's physical rulebook (`HeroQuest Rulebook.pdf`) and annotated with how each rule
maps to our code. When the engine and this wiki disagree, **this wiki wins** and the
engine is a bug to be fixed (unless a rule is intentionally a house rule — see below).

## House rules (intentional deviations from the printed rulebook)

> 🎲 **Movement = 3d4 (not 2d6).** Heroes roll **three four-sided dice** for movement
> distance instead of the printed two red six-sided dice. This narrows the spread
> (3–12, centered on ~7.5, fewer extreme rolls) for smoother pacing. **Monsters are
> unaffected** — they use fixed movement from the monster chart (the rulebook never
> rolls monster movement). This is the *only* deliberate rules change so far.

Any future house rules get added here with a one-line rationale.

## Decisions log

Resolved with the user on 2026-06-03 (see [`99-open-questions.md`](./99-open-questions.md)):

- **Traps → full rulebook fidelity.** Implement pit / spear / falling-block / chest
  distinctly, plus trap-jumping, the in-pit −1 die penalty, and faithful disarm odds
  (Dwarf ~83% / others need a tool kit, 50%).
- **All smaller divergences → match the rulebook** (treasure-deck wandering-monster /
  hazard split + reshuffle, search "no monsters"/once-per-room gates, in-pit −1 die,
  0-BP healing death-save, monsters can't pass heroes, spells once-per-quest discard).
- **Missing source material → the user will send scans** (page 22 "Ending the Quest" /
  "out of monsters", the Quest Book, and the card faces). The campaign / armory / spell /
  Dread-spell layers wait on those; until then we stay faithful to what we have.
- **Dread Sorcerer → not a base-stat monster.** It is used almost exclusively as a
  **unique, per-quest named character** (like Verag the gargoyle), with stats defined in
  that quest's notes — so it lives in quest data, **not** in `MONSTER_STATS`.

## Source & coverage

- Rendered page images: `C:/Users/Dan/Desktop/hq-render/quarters/q-NN-(L|R)(T|B).png`
  (each booklet page = two quarters: left column + right column).
- Faithful page-by-page transcription: [`_raw-transcription.md`](./_raw-transcription.md).
- **This PDF excerpt covers booklet pages 2–21.** It does **not** include:
  - **Page 1** (front cover) — cosmetic, no rules.
  - **Page 22** — "What happens if you run out of monsters?" and **Ending the Quest**
    (between-quests flow, lost artifacts, unfinished quests). ← needed for the
    campaign / store-between-quests layer.
  - The **Game Master's screen monster chart** (the numeric Attack/Defend/Body/Move/Mind
    table — we already have equivalent values in `content.ts MONSTER_STATS`).
  - The **Quest Book** (the 14 quests: maps, parchment text, quest notes).
  - The **card faces** (treasure ×24, equipment ×23, artifact ×14, spell ×12,
    Dread spell ×12, monster ×8, turn-order ×4).
  These are tracked as gaps in [`99-open-questions.md`](./99-open-questions.md).

## How to read the status tags

Each rule in the section files is tagged with its implementation status:

- ✓ **matches** — engine already implements this faithfully.
- ⚠ **diverges** — engine currently does something different; needs a fix or a decision.
- ◑ **partial** — engine implements some of it.
- ❓ **unconfirmed** — rule comes from outside this PDF or needs a product decision.

## Section index

1. [Components, setup & heroes](./01-components-setup-heroes.md)
2. [Turn structure, movement & looking](./02-turns-movement-looking.md)
3. [Combat & line of sight](./03-combat-line-of-sight.md)
4. [The six hero actions: search, spells & treasure](./04-actions-search-spells-treasure.md)
5. [Traps](./05-traps.md)
6. [Zargon's turn, monsters & defeat](./06-zargon-monsters-defeat.md)
7. [Open questions & conflicts vs. current build](./99-open-questions.md)

## Code map

| Concern | File |
|---|---|
| Rules engine (pure, server-authoritative) | `src/lib/games/heroquest/engine.ts` |
| Static data: heroes, monsters, quest, dice faces | `src/lib/games/heroquest/content.ts` |
| Types (state, actions, monster kinds, die faces) | `src/lib/games/heroquest/types.ts` |
| Board renderer + input | `src/components/heroquest/Board.tsx` |
| SVG art (heroes, monsters, furniture, dice) | `src/components/heroquest/Art.tsx` |
| Action panel / layout / dice panel | `src/components/HeroQuestBoard.tsx`, `src/components/heroquest/DicePanel.tsx` |
| Vision systems (looking vs LOS) | `.claude/skills/heroquest-vision/SKILL.md` |

## Roadmap (per the user, after this base is solid)

Gameplay polish → quests → campaign → automated Zargon → monster personalities →
soft enrage → dynamic quests → store between quests. The wiki is the foundation all of
those build on.
