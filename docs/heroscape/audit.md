# HeroScape engine audit

**2026-06-30 — Specials targeting audit (UNIQUE vs COMMON).** Triggered by a live game where
Ne-Gok-Sa Mind Shackled an Arrow Grut. Real bug: `mindShackleTargets`/`doMindShackle` admitted "any
adjacent enemy" on a stale assumption that every card is Unique — but the card reads "choose any
**UNIQUE** figure adjacent," so commons (the three Grut squads, Deathreavers, Swog Rider) are illegal.
**Fixed** — both the eligibility helper and the apply-handler now reject a `common` target (a Unique
Squad like Marro Warriors is still fair game); regression test added (`big-heroes.test.ts`). Swept
every other special for type gating and found **no other unique/common bug**: Chomp / Acid Breath /
Throw / Carry are correctly size-gated (small/medium; Throw also excludes flyers); Warrior's Spirit
correctly places on any Unique card; the special ATTACKS (Ice Shard, Queglix, Wild Swing, Explosion,
Fire Line, Grenade) have no unique/common clause on their real cards and correctly impose none. 597
HeroScape tests pass.

**Latest: 2026-06-30** — focused pass on this session's batch: **edge walls** (movement / LOS /
engagement + the `shortestPath` walk animation), **authorable water height** (raised 1.5-level pools)
+ falls, the **aggressive height-seeking AI** (no wound retreat, ranged height-then-distance, 1-health
disengage guard), **random-glyph spots**, and the new **PERCOLATOR** map. **Prior: 2026-06-27** —
the 5 new Utgar units + Bonding/Scatter. **2026-06-25** — full five-bucket engine pass.

## 2026-06-30 audit pass — walls · raised water · aggressive AI · random glyphs · PERCOLATOR

Four read-only subagents (water · walls · AI · glyphs+PERCOLATOR+projection+cross-system), then
self-verification of every critical claim + a new full-game playthrough on the walled map. Fuzzer +
playthroughs green; **591 HeroScape tests pass; tsc + production build clean.**

**Headline:** **no 🔴/🟠 correctness bug in the engine** — every change this session is rules-correct
and properly threaded. The wall barrier severs movement, adjacency/engagement AND line-of-sight at
all sites (5 reach/dragStep, 2 areEngaged-via-engagedPair/figuresAdjacent, 8 hasLineOfSight3D), and
**no special power reaches across a wall** (the full special-attack matrix is wall-aware — see §3).
Raised water (falls/climb/combatLevel) is correct; the AI cannot freeze, loop, or suicide; projection
still masks face-down glyph ids + strips `glyphSeed`. The one real finding was a **🟠 test-COVERAGE
gap** (the fuzzer + playthroughs only ran wall-less maps) — now **closed**. A latent authored-glyph
footgun was hardened. Everything else is 🟡 cosmetic / by-design.

### Fixed in this pass (shipped)
1. **🟠 Coverage gap: walls + raised water were never exercised by a full game — FIXED.** The fuzzer
   defaults to `training_field` (and hard-clears glyphs), and `audit-playthrough.test.ts` ran only
   `training_field` + `star_field` — all WALL-LESS. PERCOLATOR (the one map combining edge walls with
   raised 1.5-level water) was played by **zero** full games, so the wall-aware severing in
   `areEngaged` / `figuresAdjacent` / `hasLineOfSight3D` and the raised-water interactions were
   validated *only* by targeted unit tests — a wall-interaction regression would have passed the whole
   fuzz + playthrough suite. Fix: a new playthrough drives a complete AI-vs-AI game on
   `percolator_by_ulysses` with a ranged (LOS-gated Fire Line / Mimring) + melee (adjacency Chomp /
   Grimnak) army and a `glyphSeed`, asserting it finishes with a coherent winner and a real glyph
   trigger. (`playFullGame` gained an optional `glyphSeed` so maps that declare only `glyphSpots`/
   `glyphAnchors` actually materialize glyphs.)
2. **🟡 Authored glyph spots were trusted blindly — HARDENED.** `generateGlyphs`' `glyphAnchors` /
   `glyphSpots` branches filtered only water, not start-zone hexes or duplicate coords — an authored
   `*` inside a deploy zone would spawn a glyph under a placed figure, and a coord listed twice would
   mint two glyphs on one hex. PERCOLATOR happens to be clean, but the branch defended nothing. Fix: a
   shared `sanitizeAuthored` now drops off-board / water / **start-zone** hexes and **dedupes**
   (order-preserving, so the seeded id assignment stays stable) for both branches.

### Found in live play (post-audit, shipped 2026-06-30)
3. **🟠 A NEGATED Airborne Elite kept rolling The Drop — FIXED.** Owner report: after negating an
   opponent's Airborne Elite with the Glyph of Nilrend, that card still rolled The Drop every round.
   The Drop is the card's printed **special power**, so a negated card must not roll it — but
   `reserveAirborne` (the single chokepoint behind `canTheDrop` / `doTheDrop` / the round-start wait
   gate / the AI / placement) never checked `isCardNegated`. The Nilrend target list (`generateGlyphs`
   nilrend branch via `cardHasLivingFigures`, which counts reserve) legitimately lets you negate a
   reserve Airborne, so the card was genuinely negated — the gate just ignored it. Fix: `reserveAirborne`
   now excludes negated cards, so every consumer treats the negated squad as un-droppable and it stays
   in reserve (negation is permanent → a permanent lock-out, matching the owner's expectation). Defense
   against a derived stalemate: `seatIsAlive`'s "reserve keeps you alive" clause now requires a
   **non-negated** reserve Airborne, so an army whose only card is a negated Airborne (no route to the
   board) is eliminated rather than alive-forever. Regression test (big-heroes.test.ts "a NEGATED
   Airborne card … cannot roll The Drop").

### Per-system findings (condensed)

**1. Walls (movement / LOS / engagement) — faithful.** Every reach + dragStep site passes
`options.walls`; `engagedPair`/`figuresAdjacent` pass `mapWallSet` into `areEngaged` (6th arg); all 8
`hasLineOfSight3D` call sites pass `map.walls`. A wall is a FULL barrier regardless of height. The
`shortestPath` walk animation honors the same walls/water/climb cost model (ignores occupancy
by-design — it's a cosmetic route, not a legality check). Geometry (`segmentsCross`/`wallSegment`)
verified.

**2. Special-attack matrix — every helper wall-aware.** Confirmed each reaches adjacency/LOS the
right way: `chompTargets`, `mindShackleTargets`, `wildSwingDefenders`, `grenadeDefenders` splash,
`explosionTargets` splash, `carryPassengers`, counter-strike/stealth-dodge → all via
`figuresAdjacent`; `fireLineTargets`, `acidBreathTargets`→`withinRangeLos`, `explosionTargets` →
all via `hasLineOfSight3D(...map.walls)`; glyph-claim via occupancy (`glyphAt`, wall-independent).
`grenadeTargets` deliberately uses raw range (Lob 12 arcs over walls — card grants no-LOS). **No
helper bypasses a wall where it shouldn't.**

**3. Water (raised pools + falls) — correct, with one owner house-rule.** Falls into water are
damage-exempt (`computeFall intoWater`); climb-out is a forced stop for 1-hex figures (the "extra step
to get out" rule); `combatLevel = standLevel − (allHexesWater ? 0.5 : 0)` makes water a height
DISADVANTAGE — this is an intentional **owner house rule** (the rulebook §3/§4 says water adds no
height), documented so it isn't "fixed" later. No hardcoded `water == height 1` remains; render
(`WATER_DIP`) and combat math agree.

**4. Aggressive AI — no freeze / loop / suicide.** Proven: no no-op move is reachable (budget is
strictly monotonic), an A→B→A shuffle is blocked by the `moveStart` guard, and an illegal proposal is
recovered by the actions.ts driver. The new `breaksEngagement` disengage-for-height is gated behind
`oneHealthLeft && fromAbove`, so a 1-health figure never throws away a free swipe for a climb. Ranged
units can't be pulled into melee (the −60 adjacency penalty dominates even a range-8 worst case). Dead
code from the old defensive brain (`SAFETY_W` / `retreatOK` / `hurt`) is fully removed.

**5. Projection + PERCOLATOR — clean + playable.** `projectStateForViewer` hides unrevealed order
markers, masks every face-down glyph id, and strips `glyphSeed` (so a modified client can't recompute
ids); the new map/walls/glyphSpots add no new secret field. PERCOLATOR is BFS-verified fully connected
from both start zones (walls don't isolate any of the 210 cells), perfectly 180°-symmetric, with the
two glyph spots fair (each side owns the slightly-nearer one) and all four raised pools reachable.

### Ranked OPEN issues (all 🟡 — cosmetic / by-design / latent; documented, not fixed)
| # | Sev | Where | Issue | Why not fixed |
|---|-----|-------|-------|---------------|
| W1 | 🟡 | engine.ts `auraCoverageHexes` (~4008) | The gold aura-outline overlay ignores walls, so it can paint a hex a wall actually cuts off. The enforced buff (`raelinAuraReaches`) IS wall-aware — visual only. | Cosmetic overlay; the rule it depicts is correct. |
| W2 | 🟡 | engine.ts The Drop `dropHexLegal` (~6224) | The "adjacent to a figure" guard uses raw `neighborKeys`, not wall-aware — *over*-restrictive (forbids landing next to a wall-separated figure), never illegal. | Conservative & safe for an airborne drop; never produces an illegal landing. |
| W3 | 🟡 | engine.ts 2-hex tail (~2495/2544), maps.ts `tailFor` | A double-space figure's body can straddle a walled edge (the tail orientation uses raw neighbors). Harmless on current maps. | Latent; no current map walls a hex a 2-hex figure would seat across. |
| W4 | 🟡 | HeroScapeBoard.tsx (2D SVG fallback) | The fallback board ignores `WATER_DIP` (draws water flat) and doesn't render walls. | Fallback-only (3D WebGL board is the default); cosmetic. |
| W5 | 🟡 | engine.ts AI `strikesFromAbove` (~7491) | Uses raw `heightOfKey`, not `combatLevel`, when scoring a height-seeking step. | Acknowledged heuristic approximation; legality is enforced elsewhere. |
| W6 | 🟡 | engine.ts (~2103-2110) | A stale aura-adjacency comment. | No behavior; tidy on next touch. |



## 2026-06-25 full pass

Five-bucket re-audit (one read-only subagent each, then self-verification of the critical claims) run
after this session's batch: **AI walks through friendlies**, **Star Field water**, **The Drop
human-wait fix**, **2-of-every-glyph pool**, **player colours from profile presets**, and the **roll-
ceremony green/Lodin display**. Fuzzer + full playthroughs green; 546 tests pass.

**Headline:** the engine remains faithful and crash-free. The doubled glyph pool surfaced **one real
bug** (now fixed) and a freeze edge (fixed); the AI-through-friendlies and Star Field water both trace
clean (no deadlock, no sealed paths); projection has **no leaks** (glyphSeed still stripped, accent_color
is not secret); RNG stays engine-free.

## 2026-06-27 audit pass — the 5 new Utgar units + Bonding / Scatter
Focused five-bucket audit of the content shipped after the 2026-06-25 pass (Deathreavers: Scatter +
Climb X2 + Disengage; Blade/Heavy Gruts: Orc Champion Bonding; Arrow Gruts: Beast Bonding; Swog Rider:
Orc Archer Enhancement; all 29 cards now `power:'live'`). Method: 3 independent read-only subagents
(Bonding, Scatter, passives/stats), then self-verification of every claim against the code.

**Headline:** the ENGINE/HUMAN path was faithful + crash-free across all vectors. The real defects were
AI-side + a class typo + two cosmetic/fidelity nits — all FIXED + regression-tested below.

### Fixed in this pass (shipped)
1. **🟠 Bonding AI squandered the bonus turn — FIXED.** `aiTurn` derived its active card from the
   order-marker holder (the squad), not `getActiveCardUid`, so during a bond the bot evaluated the
   SQUAD and the partner (Grimnak/Swog Rider) never moved/attacked — the whole point of Bonding,
   forfeited for bots. Fix: `aiTurn` resolves the active card via `getActiveCardUid` (the partner during
   a bond). Test "AI USES the bonus turn".
2. **🟠 Grimnak didn't buff the Gruts — FIXED.** Blade/Heavy Gruts were `unitClass:'Warrior'` (singular,
   the hero convention) while squads use `'Warriors'` (Tarn/Marro) and Grimnak's Orc Warrior Enhancement
   keys on `'Warriors'` — so the iconic Grimnak+Grut +1/+1 combo never fired. Fix: Gruts → `'Warriors'`
   (+ cards.md). Test "an adjacent Blade Grut gets +1 attack & +1 defense".
3. **🟠 Fuzzer had no `bond`/`scatter` branch — FIXED.** `resolvePending` returned null on a bond or
   scatter offer → those games aborted early, so both mechanics were fuzz-UNTESTED (which is why #1
   slipped through). Fix: added both branches (random partner/skip; random fall-free scuttle/stop).
4. **🟡 Climb X2 reach backdrop — FIXED.** `movementRangeHexes` used `def.height` not `climbHeightOf`,
   so the dim remaining-move overlay under-showed a Deathreaver's climb (move legality was already
   correct). Fix: `climbHeightOf(def)`.
5. **🟡 Climb X2 not negated by Nilrend — FIXED.** A negated Deathreaver kept Climb X2 (Scatter/Bonding
   were already suppressed by their own `isCardNegated` guards). Fix: strip `climbX2` in `cardDefFor`'s
   negation block, consistent with the other movement flags.

### Verified correct (no change)
Stats (all 5 vs cards.md); Climb X2 applied at movement/fall sites ONLY (engagement/height-adv/LOS use
printed Height 3); Orc Archer Enhancement (atk+def, negation-aware, board indicators); Disengage on all
5 (negation-aware); Scatter trigger fires on NORMAL attacks only (special handlers never call
`maybeOpenScatter`) + card-scope/cap/no-repeat/glyph-exclusion/fall-revalidation/no-swipe; Bonding
negation/partner-death/combo/multi-bond/intervening-choice/projection/marker-accounting/boundary-resets.
No projection leaks; RNG stays engine-free.

### Still open (low priority / by-design)
- A human who IGNORES a reactive Scatter/Bonding (or any) prompt freezes the attacker — inherent to
  "you may" choices (no auto-resolve, per rules-fidelity); platform abandon/resign is the backstop.
- Whether Nilrend should also strip Scatter/Bonding's flags (already negated functionally via guards) —
  cosmetic consistency only.

## Fixed in THIS pass (shipped)
1. **🔴 Duplicate Wannok dropped a curse — FIXED.** `endRound` used `.find(g => g.id==='wannok' && faceUp)` — with two Wannoks on the board (now possible) only one fired, and a *vacated* first Wannok suppressed an *occupied* second entirely (nothing fired). Two subagents confirmed independently. Fix: a Wannok QUEUE (`HSState.pendingWannoks`) collected in `endRound` and drained one-at-a-time through `openNextWannokIfIdle`, called from `drainSpirits` after every `resolve_choice` (Spirits first, then the next curse). Both Wannoks now curse back-to-back. Regression test added (engine.test.ts "TWO occupied Wannok glyphs BOTH curse").
2. **🟠 Wannok could open an unresolvable victim choice → frozen room — FIXED.** The controller could name an opponent alive only on reserve Airborne (no on-board figure); a bot victim then had nothing to wound → `aiResolveChoice` null → host no-op freeze (Wannok fires at the round boundary, outside the place_markers self-heal). Fix: step-1 `hasOpponent`, step-2 validation, and the AI controller pick all now require the opponent to have an **on-board** figure (else the curse fizzles). Regression test added ("Wannok 2+ FIZZLES when the only opponent is reserve-only").
3. **🟠 AI Water Clone dropped every clone after the first — FIXED.** `aiResolveChoice` read `placements[0].options[0]`; the engine indexes by `chosen.length`, so the 2nd+ clone was rejected and the bot's turn ended early. Fix: `placements[pc.chosen.length]?.options.find(h => !pc.chosen.includes(h))`.
4. **🟡 Raelin power text wrong printing — FIXED.** The hover text advertised the SotM Raelin (6 spaces / +1) while the engine enforces RotV (4 spaces / +2). Display text + a stale comment corrected to match the enforced 4/+2.

## Owner-ruling follow-ups (shipped after the audit Q&A)
5. **🟠 N1 — tie re-roll RESOLVED** (owner: "Fix it"). Only the seats tied for highest re-roll now (everyone else keeps their first roll); a clean loser can't steal first on the re-roll. New shared `resolveRollOff` validates "only contenders re-rolled" + orders by first-roll → re-roll → seat; both `doRollInitiative` and `doDraftRoll` + the actions.ts roll-off loops use it. Regression test: a 3-player [20,20,5]→[3,4,5] keeps seat 2 last. (1-v-1 unchanged.)
6. **Duplicate buff glyphs STACK** (owner: "stack for crazy games"). `seatGlyphCount` multiplies per controlled copy — two Lodin = +2 d20, two Ivor = +4 range, two Dagmar = +16 initiative, etc. Boolean glyphs (Thorian/Rannveig/Proftaka/Kelda) stay on/off. Fixes the N4 Valda lead-hex edge too (now footprint-aware + per-copy).
7. **Stealth Dodge applies vs non-adjacent SPECIAL attacks** (owner ruling). New `specialAttackWounds` gates Fire Line / Explosion / Grenade / Ice Shard / Queglix / Wild Swing — a defender keeps its defensive powers vs specials, like keeping height. (Resolves the N4 Stealth-Dodge sub-item.)

## Found in live play (post-audit, shipped 2026-06-26)
9. **Water Clone may clone UP onto the shore when the Marro stands IN water** (owner ruling). The printed card says "place … on a **same-level** space adjacent"; that assumes real HeroScape's co-planar water tiles. Our maps model water as a SUNKEN tile, so a Marro in the pool had no same-level shore and the card's own lowered water threshold was wasted. Now a roller standing ON water may also place the returned Marro on the adjacent bank at the water level **or above** (a height-0 pool → height-1 shore). Non-water rollers keep the strict printed same-level rule. `doWaterClone` `options` filter; regression test "a Marro standing IN water may clone UP onto the higher adjacent shore". *(Alternative considered: make water co-planar in map data — more faithful but touches movement/falling across every map; deferred.)*
8. **🔴 A BOT's Airborne never got The Drop in a multi-bot game — FIXED.** Owner report (Makros/Wreckage/Vlad on Star Field): Vlad's reserve Airborne Elite (0/4) never rolled — no roll appeared, the squad stayed in reserve all round. **Ordering bug, not the gate:** The Drop rolls before order markers and the place-markers gate blocks EVERY seat until the Airborne seat rolls, but `aiPendingSeat` returned the *first* not-ready bot — so a lower-seat NON-dropper bot (Wreckage) came back ahead of the dropper (Vlad). Wreckage can't place markers (gate), its `ai_step` errors, and the host recovery sets `airborneDropRound = round` to unstick it — silently **consuming** Vlad's Drop before he rolled. Fix: `aiPendingSeat` now hands back a bot that still owes The Drop FIRST (its `the_drop` clears the gate before any non-dropper wedges). Defense-in-depth: the actions.ts recovery's wait-guard now also covers `botCanStillDrop` (no-op, never clobber a pending Drop; `canTheDrop ⇒ not-yet-rolled`, so the legit raced-dropper recovery is unaffected). Regression test added (big-heroes.test.ts "a BOT dropper rolls The Drop BEFORE a lower-seat non-dropper bot wedges the gate"). Self-heals a live game next round — The Drop re-offers every round until the squad deploys.

## Ranked OPEN issues (deferred — documented)
| # | Sev | Where | Issue | Why deferred |
|---|-----|-------|-------|--------------|
| N1 | ✅ | actions.ts + engine `resolveRollOff` | **RESOLVED 2026-06-25** (owner "Fix it"): only the tied-for-highest seats re-roll; a clean loser keeps its place. See "Owner-ruling follow-ups" above. |
| N2 | 🟡 | engine.ts `aiMoveDistField` (~6293) | The AI distance field treats a tall **descent** (`abs(Δh) ≥ Height`) as an impassable wall, so the bot avoids cliffs it could legally jump down. Suboptimal pathing only — `legalStepHexes` still enforces real legality; can't freeze or emit an illegal move. | Heuristic, not a rules bug. Fix = only block **upward** steps. |
| N3 | 🟡 | engine.ts `applyGlyphOnStop` (~3044) | A 2-hex figure stopping on TWO choice-glyphs at once (now possible with duplicates, e.g. two Mitonsoul under one peanut) opens the first; the second is revealed but its effect never re-fires. Needs anchor-map geometry + a 2-hex spanner — narrow. | Same queue machinery the Wannok fix uses could extend here; low reach. |
| N4 | 🟡 | engine.ts Valda `effectiveMove` (~3678) / Stealth Dodge vs specials / `isSmallOrMedium` default | Valda checks only the lead hex (2-hex tail-on-glyph edge); Stealth Dodge isn't applied vs non-adjacent SPECIAL attacks (defensible ruling); unsized base cards default "small/medium" (latent — only a future large/huge base card without `size`). | Edge/ruling/latent; none reachable in normal play today. |

---

# HeroScape engine audit — 2026-06-24

Full end-to-end audit (five system buckets, one read-only subagent each, then synthesis +
self-verification) run after a large batch of changes: the **interactive roll ceremony**
(Mitonsoul curse / Sturla resurrection), the **turn-order ring** fix, the **negation→Spirit**
suppression, and **three new symmetric battlefields** (3 / 4 / 5 players).

**Headline verdict:** the engine is in good shape — combat, movement, turn flow, AI, and the new
maps are faithful and crash-free; the fuzzer + playthroughs are green (487 tests). The new
subsystems this session (ceremony, turn-order ring, negation fix, maps) all verify correct. The
audit surfaced **one real hidden-info leak** (now fixed), **one broad fidelity bug** (Warrior's
Spirit dropped on special/curse deaths — deferred fix, documented), and a handful of rulings +
latent edges. No 🔴 shipping bug remains open.

---

## Fixed in this audit pass (shipped)

1. **🔴 `glyphSeed` hidden-info leak — FIXED.** `projectStateForViewer` masked face-down glyph
   ids but shipped `state.glyphSeed`. Since `generateGlyphs(seed)` is deterministic and the map
   (incl. `glyphAnchors`) is in the client bundle, a modified client could recompute every
   face-down glyph's id, defeating the mask. Fix: `delete next.glyphSeed` in projection
   (engine.ts `projectStateForViewer`). Regression test added (engine.test.ts "strips glyphSeed…").
2. **🟡 Stale comments — FIXED.** Three block comments claimed special-attack *defenders* lose
   height; the code correctly KEEPS it (§117 constrains the attacker only). Comments corrected
   (engine.ts Fire Line / Explosion / Big-Hero headers). No behavior change.

## Ranked OPEN issues (deferred — need a fix or a ruling)

| # | Sev | Where | Issue | Fix shape | Why deferred |
|---|-----|-------|-------|-----------|--------------|
| O1 | ✅ | engine.ts special-attack handlers + Chomp + `applyCeremonyRoll` curse | **RESOLVED — owner report 2026-06-24: "when Eldgrim died I wasn't prompted to add the Warrior's Spirit."** A champion (Finn/Thorgrim/Eldgrim) killed by a **special attack** (Fire Line/Explosion/Grenade/Ice Shard/Queglix/Wild Swing/Acid Breath/Throw), **Chomp**, or the **Massive Curse** left no Spirit — those kill sites never called the hook, and the old single-pending guard dropped any Spirit owed while another choice was open. Fix: a small **spirit QUEUE** (`HSState.pendingSpirits`). `maybeQueueSpiritOnDestroy` now PUSHES + `openNextSpiritIfIdle` opens one whenever no choice is open; EVERY kill site (incl. the 8 special attacks, Chomp, the curse) calls it; `drainSpirits` at the resolve_choice + grenade_throw chokepoints re-drains it, so two champions felled by one blast — or a death mid grenade-volley/ceremony — resolve their Spirits back-to-back. Nilrend negation still suppresses the Spirit (negated card = base stats). | Done. Tests: an Ice Shard and a Chomp destroying Thorgrim open his Armor Spirit; fuzzer exercises the queue. |
| O2 | ✅ | engine.ts Oreld/Nilrend/Wannok d20 resolutions + `applyCeremonyRoll` | **RESOLVED — owner ruling 2026-06-24: "Lodin should apply to ALL d20 rolls."** All five wave-3 glyph d20s now fold in `lodinD20Bonus`: Mitonsoul/Sturla use `eff = d20 + lodin` (curse `eff===1`, resurrect `eff>=20`); Oreld/Nilrend/Wannok compute `d = raw + lodin`, branch on the EFFECTIVE value, and store it in `pc.d20` (so the two-step pick reads the boosted side). The die FACE still shows the raw roll; logs/detail annotate `raw+1 Lodin = eff`. A Lodin holder is now curse/self-harm-immune (a natural 1 → 2). | Done. Regression tests: Lodin lifts Wannok 1→2 (figure on the glyph spared) and Nilrend 1→2 (negates an opponent, not own). |
| O3 | ✅ | engine.ts `cardModFor` | **RESOLVED — owner ruling 2026-06-24: "special bonus from Warrior's Spirit and the like will also be negated."** `cardModFor` now returns `{0,0,0}` for a `isCardNegated` card, so a negated card drops its persistent attack/defense/move Spirit bonuses too — base stats only, consistent with its powers/aura already being off. | Done. Regression test: a negated card loses its placed Attack-Spirit +1. |
| O4 | 🟡 | engine.ts `moveConsequences` vs `stepConsequences` | Whole-move (the primary click) and step-by-step movement have drifted: the whole-move path **under-counts passing swipes** for a transiently-engaged enemy (B1), **can't bridge a water hex with a 2-hex figure** (B2), and **computes a 2-hex fall the step path defers** (B3). | Route the primary click through the step engine, or document the destination-model limits. B2/B3 are latent (no figure can trigger them on current maps until a unit descends a height-15 wall). | Pre-existing; B1 is the only live one and is a model limitation, not a crash. |
| O5 | ✅ | maps.ts (`makeSymHexMap` + `makeStarMap`) | **RESOLVED — owner ruling 2026-06-24: "make those glyphs on flat ground so 2 hex can stand on them."** The isolated height-3 central peak at `[0,0]` (a glyph anchor) is flattened into the surrounding height-2 plateau on Triskelion, Crossroads, and Star Field, so a 2-hex figure rests level spanning the centre glyph. Keeps the central height advantage (plateau still > the height-1 field). | Done. Regression test: every symmetric glyph anchor has a same-height neighbour; the centre is no longer an isolated peak. |
| O6 | ✅ | types.ts `glyph_oreld.foeCandidates` on `pendingChoice` | `foeCandidates` enumerated the *positions* (cardUid+markerIndex) of an opponent's **unrevealed** order markers in the projected `pendingChoice`. | **RESOLVED** — Oreld reworked into a PUBLIC roll + a real *choose-a-player* pick (mirrors Wannok). The choice now carries only the rolled `d20` + the eligible victim *seats* (a coarse, non-secret fact); the exact marker positions are gone, and the marker removed is engine-picked server-side. | Fixed alongside the Oreld choice-vs-auto fidelity fix. |

---

## Per-system findings (condensed)

### 1. Turn flow — sound
Order markers, initiative (ties re-roll with Dagmar/Lodin bonus persisting, re-validated on both
server + engine), round rollover, draft snake + per-team budget, placement, and last-team / draw
elimination all verify against `docs/heroscape/02-rounds…`. **NEW:** the turn-order **ring**
(`physicalSeatRing` → rotate-to-winner → `interleaveByTeam`) is correct — winner first, then the
physical start-zone ring, 2-player unaffected, eliminated seats excluded, no crash on an empty
zone. The **roll ceremony** advances owner-by-owner, clears its temp glyph at the end, can't
soft-lock (queue strictly drains; `pc.seat` always tracks `queue[0]`), and a board-wiping curse
ends as a draw (tested M2). Only bug: O1 (Spirit on curse death).

### 2. Movement — faithful, crash-free on the new maps
Climb cost/limit, free descent, fall bands (+Lodin on extreme), water forced-stop, flying
(Rannveig suppression), ghost walk, Theracus carry, The Drop decline, 2-hex slither, and
whole-move undo all check out. **Verified no stranding/sealed paths on Triskelion/Crossroads/
Pentad** — every non-wall hex is reachable by a Height-2 walker; height-15 walls are isolated
(flyers cross); mounds are properly ramped. Open: O4 (whole-move vs step divergences).

### 3. Combat + LOS — faithful, no shipping bug
`wounds = max(0, skulls − shields)` (tie → defender), `destroyed = wounds >= life`, height
advantage, and all 11 special attacks verify line-by-line against printed card text. Special-attack
**defenders keep height** (§117) — code correct, comments now fixed. The **negation→Spirit
suppression** (a negated Finn/Thorgrim leaves no Spirit on death) is correct + tested. O3 RESOLVED
(2026-06-24): a negated card also drops any *received* Warrior's Spirit stat mod (`cardModFor` gated behind `isCardNegated`) — base stats only.

### 4. Cross-system interactions + the new maps
Glyph buffs × combat, aura × combat (negated source removed), height × normal-vs-special,
LOS × ranged-vs-aura, flying × engagement/water/glyph, pending-choice × turn-flow — all faithful.
**Lodin × the five wave-3 glyph d20s is now wired (O2 RESOLVED 2026-06-24 — "Lodin applies to ALL d20 rolls").** The new maps are geometrically sound
(fair, connected, no soft-locks; The Drop always has landings; both 1-hex AND 2-hex figures can be
placed on every seat). Glyph generation on them is safe: `generateGlyphs` branches on
`map.glyphAnchors` (symmetric fixed positions, random id per game, never on a wall/zone, ≤
GLYPH_POOL ids). Note: the anchor branch bypasses `glyphCountForMap`, so Crossroads runs ~9 glyphs
(denser than a rectangle) — by design (anchors ARE the layout).

### 5. AI + projection + RNG
The AI drives every pending + power, **including the new ceremony** (select → roll, d20 injected
by the action layer; the old Mitonsoul/Sturla bot-stall is closed; multi-owner hand-off correct).
**ALL abilities are now bot-initiated** (owner ask 2026-06-24): the move brain adds Theracus CARRY
(ferry an adjacent ally forward) and Sgt. Drake's GRAPPLE GUN (scale an unclimbable ledge to a
strike hex) — both gated off a figure mid-step (they replace the whole move), with `aiEngineAction`
dice seams. The Drop + Grenade were already wired.
Engine is RNG-free; all dice/seeds injected by the action layer; `generateGlyphs` deterministic
from the seed (incl. the anchor branch). Projection: the ceremony's public fields
(`selectedFigureId`/`queue`/`results`) expose only figure ids + d20s (correct — all watch); the
**`glyphSeed` leak (now fixed)** was the real issue; O6 (`foeCandidates` shape) is latent.

---

## The three new battlefields (geometry verified)

```
Triskelion Vale (3p) — true 3-fold rotational     Crossroads Keep (4p) — 4 mirror quadrants
  217 hexes · 9 walls · zones 16/16/16              289 hexes · 8 walls · zones 16/16/16/16
  minInterZone 10 · connected · 7 glyph anchors     minInterZone 10 · connected · 9 glyph anchors

        3 3 3 3 . . . . .                            1 1 1 1 . . . . . . . . . 2 2 2 2
     3 3 3 3 . . . . . . .                           1 1 1 1 * . # . . . # . * 2 2 2 2
    . . . . * . # + . . . . .                        . . . . . + . . . . . + . . . . .
   . . # . . + ^ . . . . # . 1                       . . * . . . . . . . . . . . * . .
  . . . . # . + + + . # . . 1 1                      . . # . + . . + + + . . + . # . .
 . . . . . . + + + + . . . 1 1 1                     . . . . . . + ^ * ^ + . . . . . .
. . . . . . + + * + + + * 1 1 1 1                    . . # . + . . + + + . . + . # . .
  . . . . # ^ + + + . # . . 1 1                      . . * . . . . . . . . . . . * . .
   . . . . . + . . . + . . . 1                       3 3 3 3 . . . . . . . . . 4 4 4 4
    . . . . * . # . . * . . .                        3 3 3 3 * . # . . . # . * 4 4 4 4
     2 2 2 2 . . . . . . . .
      2 2 2 2 . # . . . . .         Pentad Crucible (5p) — 5-fold angular (approx; equal zones)
       2 2 2 2 . . . . . .            469 hexes · 7 walls · zones 12×5 · minInterZone 11 · 6 anchors
       ( ^=h3  +=h2  .=h1  #=wall  *=glyph anchor  1-5=start zones )
```
All three: flat grass start zones spaced **≥10** (no turn-one Range-9 snipe), a raised centre +
ridges, isolated height-15 rock walls (cover / LOS breakers, never sealing), and symmetric glyph
anchors. The Pentad is **approximately** 5-fold (a hex grid can't be exactly 5-fold) — handled
honestly: caps are trimmed to equal size (12 each), and the symmetry test asserts only near-equal
rim radius. `maps.test.ts` asserts the full invariant set incl. exact rot120 (3p) + offset
double-mirror (4p) terrain invariance.

---

## Playthroughs + tests
- Fuzzer (`fuzz.test.ts`): green (random 2-6p games + invariants).
- `audit-playthrough.test.ts`: green (full 2p + 3p+teams + FFA, lobby→win).
- `maps.test.ts`: 29 pass (incl. 6 new-map invariant tests).
- **487 HeroScape tests pass; production build clean.**

### Recommended regression tests (for the open issues, when fixed)
- **O1 (DONE):** an Ice Shard and a Chomp destroying Thorgrim each open his `spirit_placement`. The
  spirit QUEUE covers Mitonsoul-curse deaths and two-champions-in-one-blast (resolved back-to-back);
  the fuzzer exercises it across hundreds of games. Tests added.
- **O2 (DONE):** a Lodin holder's figure rolling a natural 1 survives every glyph d20 — Wannok 1→2
  spares the figure on the glyph; Nilrend 1→2 negates an opponent not its own. Tests added.
- **Coverage gap (independent of a fix):** the fuzzer/playthroughs never run on the new maps with a
  `glyphSeed`, so the anchor-branch generation + AUTO/CHOICE glyphs on mounds aren't fuzzed — add a
  seeded playthrough on Triskelion/Crossroads/Pentad that drives a ceremony to completion.
