# HeroScape glyphs — canonical spec

Source: provided by the project owner (2026-06). This is the authoritative text;
the engine must match it exactly. On the board only the **name** and **power**
show; the **effect** is revealed on hover.

Glyphs start face-down (a red `?`) and reveal the instant a figure *stops* on one.
Glyphs are a forced stop (you can't move past one). Either lobe of a 2-hex figure
counts for landing on / revealing / controlling a glyph.

## Permanent — active only while one of your figures stands on the glyph

| Glyph | Power | Effect (hover) | Status |
|-------|-------|----------------|--------|
| Astrid | Attack +1 | Each figure you control rolls one extra attack die **when using a normal attack** (not special attacks). | live |
| Dagmar | Initiative +8 | Add 8 to your initiative die roll. | live |
| Gerda | Defense +1 | Each figure you control rolls one extra defense die. | live |
| Ivor | Range +2 | Each figure you control with Range 4 or more adds 2 to its Range. | live |
| Valda | Move +2 | Each figure you control adds 2 to its Move (not the move off the glyph). | live |
| Jalgard | Defense +2 | Each figure you control rolls two extra defense dice. | live |
| Lodin | D20 +1 | While you hold this, add 1 to ANY d20 the controlling player rolls (initiative, The Drop, Mind Shackle, etc.). Stacks with Dagmar on initiative. | live |
| Rannveig | No Flying | All figures with Flying lose it while any figure stands on this glyph. | live |
| Proftaka | Trap | The figure on this glyph cannot move unless a friendly figure occupies an adjacent space. | live |
| Thorian | Melee Only | Opponents' figures must be adjacent to your figures to make a normal attack against them. | live |
| Wannok | Curse | At end of each round the Wannok controller rolls a d20: on a 1 the figure standing here takes a wound; on 2+ the controller chooses an opponent, who must wound one of their own figures. | planned |
| Brandar | Artifact | Rules vary by scenario; only used if the scenario dictates. NOT in the standard random pool. | inert |

## Temporary — fires once when a figure stops on it, then removed

| Glyph | Power | Effect (hover) | Status |
|-------|-------|----------------|--------|
| Erland | Summoning | Move any one figure (yours or an opponent's) to a space adjacent to the figure on this glyph. No leaving-engagement attacks. | planned |
| Kelda | Healer | Remove all wound markers from the stopping figure's army card. Only figures with wounds may stop here. Once revealed it stays until used. | live |
| Mitonsoul | Massive Curse | Each player rolls a d20 for each of their figures on the battlefield; each that rolls a 1 is destroyed. | planned |
| Sturla | Resurrection | Each player rolls a d20 for each of their figures destroyed this battle; on a 20 place it in any of that owner's starting zones, otherwise it stays destroyed. | planned |
| Nilrend | Negation | Roll a d20: on a 1 choose one of YOUR unique figures; on 2+ choose any opponent's unique figure — its special powers are negated for the rest of the game. | planned |
| Oreld | Remove Marker | Roll a d20: on a 1 a random order marker is removed from your unrevealed markers; on 2+ remove one random order marker from an opponent's army card. | planned |

## Owner clarifications (2026-06)

- **Wannok** — the player controlling the figure on the glyph rolls. On a 1, that
  figure takes the wound. On 2+, the controller picks a player; that player must
  select one of their own figures to take a wound.
- **Lodin + Dagmar stack** on initiative. Lodin applies to *any* d20 the
  controlling player rolls — e.g. Mimring parked on Lodin while the player rolls
  Ne-Gok-Sa's Mind Shackle: a natural 20 succeeds, and a 19 +1 (Lodin) = 20 also
  succeeds.
- **Thorian / Rannveig** are occupancy auras — active only while a figure stands
  on the glyph (like Astrid).
- **Sturla** returns a destroyed figure only if its owner rolls a 20.

## Status legend

- **live** — implemented + tested.
- **planned** — defined in `HS_GLYPHS` but `active:false` (placed inert, still a
  forced stop) until its implementation wave lands.
- **inert** — intentionally never auto-active (Brandar; scenario-only).
