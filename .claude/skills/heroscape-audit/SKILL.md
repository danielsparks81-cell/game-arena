---
name: heroscape-audit
description: Audit the HeroScape engine end to end — per-system correctness, cross-system interactions, and full-game playthroughs. Use this whenever the user asks to audit, review, sanity-check, regression-check, or "play test" HeroScape, or after any batch of engine/rules changes. It hunts the dangerous bugs — plausible-but-wrong rules behavior that typechecks and looks fine but violates the rules. Produces docs/heroscape/audit.md.
---

# HeroScape engine audit

Goal: catch **plausible-but-wrong** rules behavior across the engine AND its system interactions,
and confirm full games actually play start to finish. The audit doc `docs/heroscape/audit.md` is the
living template — refresh it.

## Method — five system buckets
Audit each bucket and record: overview · correctness bugs (file:line + severity 🔴/🟠/🟡) ·
rules-fidelity gaps vs `docs/heroscape/` · dead/stale code · test-coverage gaps.
1. **Turn flow** — order markers, initiative, rounds, draft (snake/budget/pass), placement, pending-choices, win/elimination.
2. **Movement** — walk/step, climb/fall/water, flying, ghost-walk, grapple, carry, The Drop, engagement swipes, 2-hex slither.
3. **Combat + LOS** — attack/defense, height advantage, line-of-sight, and every special attack vs its **printed card text**.
4. **Cross-system interactions** (the intricate part — build a matrix): glyph×combat, Lodin×d20 rolls, aura×combat, height×normal-vs-height×specials, LOS×ranged-vs-aura, flying×engagement/water/glyph, pending-choice×turn-flow.
5. **AI + projection + RNG** — does the AI use every power; does `projectStateForViewer` leak hidden info (face-down glyphs, unrevealed markers, reserves); engine RNG-free with the action layer injecting dice.

For breadth, fan out **one read-only subagent per bucket** (general-purpose), then synthesize and
**verify the critical claims yourself** before recording them. Two independent confirmations on a bug = high confidence.

## Playthroughs — don't skip
- Fuzzer: `npx vitest run src/lib/games/heroscape/fuzz.test.ts` (random 2-6p games + invariant checks).
- `src/lib/games/heroscape/audit-playthrough.test.ts` — deterministic full 2p + 3p(+teams) + FFA games, lobby→draft→placement→rounds→**win**; assert no crash, phases advance, a winner emerges, ≥1 glyph trigger + ≥1 special fires. Extend it as new mechanics land.
- **Gotcha:** playthroughs must pass a `glyphSeed` to `start_game` to exercise the RANDOM glyph pool (incl. the AUTO curses Mitonsoul/Sturla/Oreld); without it you only get the map's *static* glyphs.

## Output
Refresh `docs/heroscape/audit.md`: per-system sections + interaction matrix + playthrough results + a
**ranked** issue list (severity, file:line, fix shape). Add a **regression test for every confirmed
bug** (per the rules-fidelity skill). Be honest — separate confirmed bugs from latent/by-design, flag uncertainty.

Key files: `src/lib/games/heroscape/{engine.ts, board.ts, content.ts, types.ts, maps.ts, fuzz.test.ts, engine.test.ts, big-heroes.test.ts}`; server `src/app/rooms/[id]/actions.ts`; UI `src/components/{HeroScapeBoard,HeroBoard3D}.tsx`; canonical rules `docs/heroscape/`.
