# Adding HeroScape armies (expansion playbook)

The full **classic** roster is already **staged as data**: `HS_CARDS` holds 154 cards — the 29 hand-authored
(live, draftable) plus 125 generated from [`roster.json`](../../src/lib/games/heroscape/roster.json) into
[`classic-cards.generated.ts`](../../src/lib/games/heroscape/classic-cards.generated.ts). Staged cards are
`power:'wip'`, carry base stats + identity only, `baseSize` 1, and are **NOT in `HS_DRAFT_POOL`** — so they
exist as data but are undraftable. "Expanding" = taking a staged card live. See [`roster.md`](./roster.md).

## Per-card go-live checklist
1. **Art** — figure cut-out → `public/heroscape/figures/<id>.png` (transparent, via `bg-knockout.mjs` from
   mini photos); card portrait → `public/heroscape/cards/<id>.jpg`, tune `CARD_ART_CROP` in
   `HeroScapeBoard.tsx` (or the `/heroscape-cardcrop` picker). Missing art degrades gracefully — it only
   gates draft-inclusion. ~48 classic figures have no source PDF and need mini photos.
2. **baseSize** — set `1` vs `2` (double-space peanut) from the figure image; it's a per-figure visual fact
   the DB lacks. **Must be correct before the card drafts** (a null-`at2` 2-hex figure is an engine landmine).
3. **Draft** — add `<id>` to `HS_DRAFT_POOL` in `content.ts`.
4. **Power** — implement the special in the engine (`do*` handler + eligibility helper + `CARD_ABILITIES`/
   `ABILITIES` — power text is in `roster.json` — + any `HSCardDef` flag), then flip `power:'wip'`→`'live'`.
5. **Verify** — `GEN_MATRIX=1 npx vitest run traits-matrix`; `tsc --noEmit`;
   `vitest run src/lib/games/heroscape src/components`; `next build`.

## Costs — keep both editions
`roster.json.cost` is the **Classic/original** value → add to `CLASSIC_OVERRIDES` when it differs; keep the
**Modern** value in `HS_CARDS.points`. Classic-only cards (no modern reprint) need no override.

## Regenerate staged data
```
node scripts/heroscape/gen-classic-cards.mjs      # rebuilds classic-cards.generated.ts from roster.json
node scripts/heroscape/gen-roster.mjs <db> <out>  # rebuilds roster.json from a fresh HeroScape Card Manager DB
```

## Not from the DB (fill during expansion)
- `world` is `''` on generated cards (DB lacks it).
- A few DB names are ALL-CAPS ("4TH MASSACHUSETTS LINE", "AGENT SKAHEN") — title-case when polishing.
- Custom (C3V/SoV) cards aren't in the DB; power *implementations* are always hand-written.
