# Adding a card / army to HeroScape

A practical checklist. The engine is **data-driven** — most cards are pure data + art and
need **zero engine code**. Only a genuinely new *active* power needs a handler.

## Effort tiers (decide this first)

| Tier | Example | What it costs |
|------|---------|---------------|
| **A — data only** | A new soldier/archer; a card whose power is a stat bonus, a species/class aura, or an existing keyword flag (Flying, Disengage, …) | `content.ts` edit + art |
| **B — new active power** | A brand-new special attack / control / summon power not already implemented | Tier A **+** engine handler + action wiring + board UI + tests |
| **always** | every figure | a cut-out PNG (+ card-face image) |

The 3 reusable mechanisms that make most cards Tier A:
- **Species/class auras are data-driven.** Grimnak's "Orc Warrior Enhancement" reads `unitClass === 'Orc Warriors'`; Deathwalker's "Range Enhancement" reads `species === 'Soulborg'`. A new card with the matching `species`/`unitClass` benefits automatically.
- **Passive/movement/defense powers are FLAGS** the engine already honors: `flying`, `ghostWalk`, `disengage`, `thorianSpeed`, `stealthDodge`, `counterStrike`, `grappleGun`. Set the flag → behavior works.
- **Abilities are declared by NAME** from a shared glossary, so a card listing "Flying" gets the tooltip for free.

---

## Step-by-step

### 1. Card data — `src/lib/games/heroscape/content.ts` → `HS_CARDS`
Add one entry. Required fields (see `HSCardDef` in `types.ts`):
`id, name, shortName, type ('hero'|'squad'), figures (1 for a hero; N for a squad), life, move, range, attack, defense, height, points, letter, species, unitClass, power ('live'|'wip')`.
Optional: `size` ('small'|'medium'|'large'|'huge'; absent ⇒ medium), `baseSize` (1|2; absent ⇒ 1), `common` (true ⇒ draftable unlimited; absent ⇒ unique), and the behavior flags below.

### 2. Power behavior — pick the tier
- **Stat/passive flag (Tier A):** set the relevant flag on the card (`flying`, `ghostWalk`, `disengage`, `thorianSpeed`, `stealthDodge`, `counterStrike`, `grappleGun: N`). Done.
- **Species/class aura beneficiary (Tier A):** set `species`/`unitClass` to match the existing aura's text. Done.
- **New active/special power (Tier B):**
  1. Engine handler in `engine.ts` (mirror an existing one: Chomp, Grenade, Fire Line, Mind Shackle, Explosion). If it needs a player/AI decision or a die roll, open a `pendingChoice` (the engine stays RNG-free).
  2. Add the action to `HSAction` in `types.ts`.
  3. Roll its dice + resolve in `src/app/rooms/[id]/actions.ts` (the action layer injects randomness), and mirror it in `fuzz.test.ts`'s `resolvePending`.
  4. Board targeting/aim UI in `HeroScapeBoard.tsx` (mirror Chomp/Grenade arming).
  5. Until wired, ship the card with `power: 'wip'` — it's draftable with stats and tagged "⚡ powers WIP".

### 3. Abilities (display) — `content.ts` → `CARD_ABILITIES[id]`
List the card's ability **names**. Reuse glossary keywords where possible; add new entries to the ability glossary (same file) for any new keyword so the tooltip exists.

### 4. Draft — `content.ts` → `HS_DRAFT_POOL`
Append the `id`. Set `points` on the card; if its Classic-edition cost differs, add a `CLASSIC_OVERRIDES` entry.

### 5. Art (always) — `public/heroscape/figures/`
- Hero: `<id>.png`. Squad: one cut-out per pose — `<id>-0.png`, `<id>-1.png`, … (members cycle through them).
- Produce with the background-knockout pipeline (`scripts/.../bg-knockout.mjs`) from a source photo.
- Missing art degrades gracefully (colored base + letter, no crash) but looks placeholder.
- Card-face image: the `cards-batch` pipeline (see the card-art docs).
- **2-hex figures** also want a `figureBase` `span2` entry so the art spans the peanut and front/back land on the marks.

### 6. Flavor (optional) — `content.ts` → `CARD_IDENTITY[id]`
`{ general, personality, world }` strings for the card-detail panel.

### 7. Verify
```
npx tsc --noEmit
npx vitest run src/lib/games/heroscape     # engine + fuzzer must stay green
npx next build
```
Add a **regression test** that encodes the printed card text for any new power (per the rules-fidelity discipline).

---

## What you DON'T touch
Movement engine, walk animation (generic for 1- and 2-hex), camera/framing, board highlighting, draft snake, initiative, and win conditions are all generic — a Tier-A card never needs them.

## Known limits
- `baseSize` is only **1 or 2** — no 3-hex / "huge" figures yet (would need footprint, placement, slither, and animation work).
- A genuinely new **movement mode** (teleport, multi-move, …) needs a new flag + engine code, not just data.
