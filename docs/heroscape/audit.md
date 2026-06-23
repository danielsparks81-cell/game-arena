# HeroScape engine audit

Method: five parallel read-only system audits + cross-system interaction trace + full-game
playthroughs (fuzzer + scripted 2p/3p games). Each finding has a file:line and severity.
Status: **in progress** — sections fill in as audits land.

Severity: 🔴 High (wrong result / crash / cheat) · 🟠 Med (fidelity hole, narrow) · 🟡 Low (cosmetic / known-deferred).

---

## 2. Movement, engagement, terrain, falls, 2-hex  ✅ audited

**Overview.** Well-architected and faithful. `board.ts` holds pure hex math (Dijkstra
`reachableDestinations`, `stepCost`, `canStepUp`, `dragStep`, `computeFall`, `areEngaged`);
`engine.ts` layers card behavior (flying, ghost-walk, grapple, carry, The Drop, 2-hex slither).
Both `move_figure` (destination) and `move_step` (per-step) route through single-source helpers
(`moveConsequences`/`stepConsequences`) that the server calls for dice and the engine re-validates,
so highlight/roll/apply can't diverge. **No high-severity bugs found.**

**Findings**
- 🟠 **2-hex figures never take falls** (engine.ts:2358 + 2051-2057). Grimnak can walk off any cliff with no fall check. Known/documented deferral, but a real fidelity hole once tall maps ship.
- 🟡 **Leaving-engagement swipe is once-per-walk, not once-per-disengagement-event** (engine.ts:2349-2354; locked by test engine.test.ts:1655-1678). Leave→return→leave suppresses the 2nd swipe. Defensible (anti-grief) but diverges from the literal rule.
- 🟡 **Extreme-fall log prints the raw d20**, not the Lodin-adjusted value (engine.ts:2795) — "d20 18: survives" looks wrong when it was 18+1. Cosmetic.
- 🟡 **2-hex tail is deterministic first-found** (movementDestinations2 engine.ts:1953-1959); a legal destination can appear illegal if the first tail hex is occupied while another free same-level neighbor existed. Documented simplification.

**Fidelity gaps vs docs/heroscape/03-movement**
- 2-hex falling (deferred). Leave-then-return swipe (once-per-walk). Ruin-between engagement exception (omitted by design — no ruin pieces yet). Overhang/tight-quarters clearance (not modeled — no such maps). Flyer-ignores-water-stop-on-landing (board.ts:243) is a card-text assumption worth re-confirming vs the Army Card scans.
- Correct ✓: Major/Extreme fall bands (computeFall board.ts:561-571), climb limit as levels (canStepUp), glyph/water add no height.

**Dead/stale code**
- `baseLevel` alias (engine.ts:1607-1609) — likely vestigial in the movement path.
- `ReachOptions.doubleSpace` is unread by `reachableDestinations` (only `dragStep` uses it) — the doc comment implying double-space Dijkstra handling is misleading.

**Test-coverage gaps** (coverage is otherwise strong)
- No test for a ground 2-hex taking a fall (because it never does — see above).
- **Carry (Theracus) has no engine test at all** — full pick→fly→set-down, passenger-no-fall, drop-footprint adjacency all unvalidated.
- **The Drop placement legality untested** (mutual non-adjacency / not-on-glyph / not-adjacent-to-figure).
- Rannveig no-fly glyph: movement consequences of suppressed flight untested.

---

## 1. Turn flow, draft, placement, pending-choices, win  ✅ audited

**Overview.** Well-engineered and faithful. The round loop (`place_markers` → `roll_initiative` →
turn loop) keys on `livingSeats`, so eliminated seats in 3+ player games are skipped, not soft-locked.
The `pendingChoice` gate (engine.ts:398-419) is correct and load-bearing: while a choice is open every
non-`resolve_choice` action is blocked for all seats, it's never auto-resolved, and no path advances the
turn/round while one is open. True-snake draft, per-team budgets, can't-pass-empty-army, placement
ready-gate, reserve exclusion, and last-team-standing win are all implemented as documented. **No
high-severity bugs.**

**Findings**
- 🟠 **`doGrenade` isn't re-gated by `canGrenade`** (engine.ts:3711-3738) — a `grenade` action sent when no target exists burns the once-per-game power + the squad's whole attack. UI gates it, so low blast radius; every *other* special re-validates internally. Easy fix: re-check `canGrenade` at the top of `doGrenade`.
- 🟠 **Total-mutual-wipeout soft-lock** (engine.ts:4014-4039, 4058). If the *last figures of the last two teams* die on one blow (most plausibly Izumi Counter Strike destroying the attacker as the attacker destroys the defender's last figure), `checkEliminationWin` no-ops (0 teams alive) and `stalemateResolve` bails (`teams.length <= 1`) → `phase` stays `'playing'` forever. Rare but real. Fix: if no team has a living figure, finish with **no winner**.
- 🟠 **Non-contiguous seats → placement soft-lock — CONFIRMED reachable at the engine level.** `removePlayer` (engine.ts) only filters, it does **not** re-pack seats, and `addPlayer` takes an arbitrary `seat`. So seats can be `{1,2}`; then `start_game` on the Star Field reads `zonesByCount[2][seat=2]` = `undefined` → `startZoneFor` returns `[]` → that player gets no placeable hexes and can never ready up = soft-lock. (Whether it's *triggerable* depends on how the room UI assigns seats, but the engine is undefended.) Fix: re-pack `players` to seats `0..n-1` at the top of `doStartGame`.
- 🟡 **`doSetLobbyConfig` doesn't prune stale `teamBudgets`** (engine.ts:771-776) — inert (read by current team only), config hygiene.
- 🟡 **Warrior's Spirit placement allows any living card incl. an opponent's**, and *cannot* place on the owner's own card if it has 0 living figures (engine.ts:3997, 5337-5339). Literal card text is ambiguous; self-harmful so no exploit. Decide intent + restrict to own cards or document.

**Dead/stale code**
- Common-card draft branch (engine.ts:1014-1020) — fully built but dead (whole roster is Unique); forward-looking.
- **Per-turn flag resets are duplicated 4×** (beginTurnOrSkip, startNextRound, doEndTurn, enterPlaying) — maintenance hazard; extract a `resetTurnScratch(s)` helper so a new per-turn flag can't leak across turns.

**Test-coverage gaps**
- **The fuzzer bypasses draft AND placement** (builds the `'playing'` state directly) and is **glyph-free** — the draft snake/all-pass/budget, placement ready-gate, The Drop / glyph pending-choices during `place_markers`, and a seat eliminated *during* `place_markers` are only covered by deterministic tests (or not at all).
- No test for the total-mutual-wipeout hang, nor for `start_game` with non-contiguous seats.

## 3. Combat, line-of-sight, height, special attacks  ✅ audited

**Overview.** Combat core is solid: server-rolled dice re-validated against one source
(`attackDiceRequirements`/`effectiveAttack/DefenseDice`), skulls-vs-shields ties-to-defender,
per-skull wounds, `wounds>=life` destruction — all correct (doAttack engine.ts:3846-3887). Height
advantage is symmetric +1 with the "+2" band off the lower figure's Height. LOS is the elevation-aware
3-D tracer (`hasLineOfSight3D`), figures correctly don't block. All 13 special attacks are implemented
(despite stale "no special attacks yet" comments) and most modifiers are faithful. **But two real
HIGH bugs:**

**Findings**
- 🔴 **Splash specials strip the DEFENDER's height advantage.** `fireLineDefenders` (3401), `explosionDefenders` (3543), `grenadeDefenders` (3693) all do `Math.max(0, d.dice - h.defender)` — subtracting the defender's height bonus, which can drive a high-ground defender to **0 defense dice**. Canonical text (docs/heroscape/05-glyphs line 117, with a worked grenade example: Samurai = 5 Def + 1 height = **6** dice) says only the *attacker's* dice are unmodifiable — defense bonuses must NOT be stripped. **Inconsistent**, too: Ice Shard, Queglix, and Wild Swing do *not* strip it. Fix: stop subtracting `h.defender` in the three splash defenders (match the others).
- 🔴 **Range-1 melee ignores the elevation-exception adjacency rule.** `targetBlockReason` (2908-2925) gates melee on `rangeDistance <= range` (flat hex-adjacency + LOS), but a figure on a tall ledge is *not* adjacent to one below (`figuresAdjacent`/`areEngaged` say so, per docs/03-movement line 127). So a height-broken melee attack is wrongly allowed (and Counter Strike then won't trigger, since it keys on `figuresAdjacent`). Fix: require `figuresAdjacent(attacker, target)` when `effectiveRange === 1`.
- 🟡 **Engaged figure may pick a non-engaged PRIMARY target** for Explosion/Fire Line/Grenade (3503/3365/3656) — the "engaged → only engaged enemies" restriction isn't applied to these (Ice Shard/Queglix do apply it). Rulebook isn't explicit for splash specials; low confidence.
- 🟡 **Mind Shackle doesn't enforce "unique figure"** (4209-4214) — inert (whole roster is Unique), matters only if a common squad is added.

**Dead/stale code**
- `hasLineOfSight` (flat 2-D, board.ts:423) is exported but unused by HeroScape (everything uses `hasLineOfSight3D`); test-only.
- Stale comments: Raelin aura "+1 / 6 spaces" in comments (engine.ts:3107, 1764, cards.md:374) vs the correct +2 / 4 in code; "slice 7 — no special attacks yet" blocks (2864, 2977) now false.
- ⚠️ **Comment-vs-code mismatch:** engine.ts:1733-1740 says auras use "simple hex-adjacency, NOT elevation-broken engagement," but the aura path actually goes through `figuresAdjacent`→`areEngaged` (which *does* apply the elevation exception). Reconcile — either the comment is wrong or auras have an unintended height carve-out. (Hand to the interactions audit.)

**Test-coverage gaps**
- Nothing exercises height bugs B1/B2 — all splash-defender and melee tests use flat maps / 1-level diffs. A high-ground splash defender, and a Range-1 attack across a height break, are both untested.
- No test asserting Ice Shard/Queglix/Wild Swing defenders *keep* height (the correct side of the inconsistency).

## 4. Cross-system interactions  ✅ audited

**Overview.** 6 of 7 interaction areas are correctly and faithfully wired — including the subtle ones.
The one real defect (height × special attacks) independently confirms §3's B1.

**Interaction matrix**

| A × B | Verdict | Note |
|---|---|---|
| Glyphs × combat (Astrid +1 atk; Gerda +1 / Jalgard +2 def) | ✅ | fold into rolled dice; gated friendly + faceUp + footprint (`seatControlsGlyph` 1798) |
| Glyph control (Ivor) | ✅ | it's **Range +2** (not attack — my prompt mislabeled it); code correct (3235) |
| Lodin × d20 rolls | ⚠️ 1 gap | applied to initiative/extreme-fall/Berserker/Mind Shackle/Chomp/Water Clone/Acid/The Drop — **missing on Jotun Throw** |
| Auras × combat (Finn/Thorgrim/Raelin/Grimnak) | ✅ | alive-gated, footprint-aware, stack additively |
| Height × normal attack | ✅ | single source `heightAdvantage` (2952) |
| Height × special attacks | 🔴 | **broken — see below (confirms §3 B1)** |
| LOS × ranged vs auras | ✅ | ranged needs LOS; auras are adjacency; only Raelin uses LOS (correct) |
| Flying × engagement/water/glyph + Rannveig/Thorian/Proftaka | ✅ | flyer waives climb/water-stop but still glyph-stops + still provokes swipes |
| Pending choice × turn flow | ✅ | glyph choices raised only *after* the move commits; resolve doesn't touch turn state |

**Findings**
- 🔴 **Height × splash specials inverted** (Fire Line 3401, Explosion 3543, Grenade 3693) — *second independent confirmation* of §3 B1. Latent on flat maps (height 0 → subtracting 0 is a no-op), wrong the moment an elevation map ships. No test pins the wrong value, so the fix won't break tests.
- 🔴 **Lodin +1 missing on Jotun's Throw** (`doThrow` throw-roll 4993, damage-roll 5013). Every sibling Big-Hero power adds `lodinD20Bonus`; Throw doesn't. **Live now** (no elevation needed) when a Jotun owner controls a Lodin glyph: should throw on a raw 13 / wound on a raw 10 but can't. Fix: add `lodinD20Bonus(state, seat)` to both comparisons.
- 🟡 **AI has no resolver for glyph_mitonsoul/sturla/oreld** (`aiResolveChoice` 5659-5701 returns null) — masked because `actions.ts` auto-resolves them in the same tick; fragile if the AI engine is ever driven directly. Defense-in-depth.
- 🟡 **Aura adjacency comment vs code** (engine.ts:1733-1740 says "simple hex-adjacency, not elevation-broken," but auras route through `figuresAdjacent`→`areEngaged`, which *does* apply the elevation exception). Behavior may be fine, but the comment is wrong and an aura could fail to reach a hex-adjacent-but-height-broken ally — reconcile intent.
- ℹ️ Stale docs: glyphs.md still lists Mitonsoul/Sturla/Oreld as *planned* (they're live + tested); Raelin "+1/6" comments vs the correct +2/4 constants.

## 5. AI, projection, full-game playthroughs  ✅ audited

**Overview.** The AI is complete and coherent: drafts, deploys (2-hex first), places markers, moves
(wall-routing BFS, climbs for height, detours onto glyphs), attacks (kills-first), and resolves most
choices. It **uses every special power except Carry** (Theracus). Server-authoritative + RNG-free
confirmed (engine never calls Math.random; all dice/seeds injected by actions.ts). Full-game
playthroughs are healthy.

**Findings**
- 🔴 **Projection leaks face-down glyph ids — LIVE, exploitable now.** `projectStateForViewer` (engine.ts:6155-6165) masks opponents' order markers but passes the full `glyphs[]` through with real `id`s. Confirmed empirically: a non-owner projection returns `{id:'mitonsoul', faceUp:false}` — a modified/devtools client reads exactly which power sits on every unrevealed glyph. The UI hides it, but the wire data doesn't. **Fix:** mask the id of face-down glyphs in projection.
- 🟡 **AI can't resolve glyph_mitonsoul/sturla/oreld** (`aiResolveChoice` 5659-5701 returns null) — same as §4; safe only because actions.ts auto-resolves them in-tick. Add branches for defense-in-depth.
- 🟡 **AI never uses Carry** (Theracus) — omitted from `aiTurn`; functional gap, not a bug.

**Playthroughs**
- **Fuzzer** (fuzz.test.ts): 120 games, 2-6 players, random FFA/teams, server-rolled dice. Asserts wounds/positions/winner invariants + the team-elimination invariant. >40% finish, every special kind fires ≥1×. PASS.
- **New `audit-playthrough.test.ts`** (8 tests, kept as a regression net): full 2p, 3p+teams (2-v-1), and 3p FFA games driven lobby→draft→placement→rounds→**finish** with the AI on every seat — all reach a coherent winner/winning-team, exercise glyph reveals + special attacks, **no crashes, no stuck phases, no never-ending games**. Total suite **450/450 pass**.

**Test-coverage gaps**
- AUTO glyphs (Mitonsoul/Sturla/Oreld) are never exercised end-to-end through the AI/server path (playthroughs use no `glyphSeed` → static map glyphs only).
- No test asserts projection hides face-down glyph ids (why the leak went unnoticed) — added with the fix.
- Carry has no AI-brain coverage.

---

## Ranked issues & recommendations  ✅

### ✅ FIXED (commit 4373366, deployed)
- **H1 Projection leaked face-down glyph ids** — now masked (sentinel id for face-down glyphs) + regression test.
- **H3 Lodin +1 missing on Jotun's Throw** — now folds `lodinD20Bonus` into both the throw and damage d20 + regression test.

### High — correctness, currently *latent* (no shipped elevation maps yet, but fix before any land)
- **H2 🔴 Splash specials strip defender height** (3401/3543/3693) — confirmed by two auditors; contradicts the rulebook's own grenade example. → remove `- h.defender`.
- **H4 🔴 Melee allowed across a height break** (targetBlockReason 2908). → require `figuresAdjacent` when `effectiveRange === 1`.

### Medium — robustness / soft-locks
- **M1 `doGrenade` not re-gated** (3711) → re-check `canGrenade` (don't burn the once-per-game marker with no target).
- **M2 Total-mutual-wipeout hang** (4014/4058) → if no team has a living figure, finish with **no winner**.
- **M3 Non-contiguous seats → placement soft-lock** (doStartGame) → re-pack `players` to seats `0..n-1`.
- **M4 AI can't self-resolve AUTO-glyph choices** (5659) → add the three branches.

### Low — cleanup (no gameplay impact)
- Dead/unused: `hasLineOfSight` flat 2-D (board.ts:423), `baseLevel` alias, `ReachOptions.doubleSpace` (unread by Dijkstra).
- Per-turn flag resets duplicated 4× → extract `resetTurnScratch(s)`.
- Stale comments/docs: Raelin "+1/6" vs the correct +2/4; "slice 7 — no special attacks yet"; glyphs.md lists live Mitonsoul/Sturla/Oreld as "planned"; aura-adjacency comment vs code.
- Design decisions to confirm: Warrior's Spirit may target any card incl. an opponent's and can't target the owner's own 0-figure card; Mind Shackle doesn't enforce "unique" (inert today).

### Test gaps to backfill (alongside the fixes)
Carry (no engine test); The Drop placement legality; projection masking (with H1); splash-defender height + melee-across-height (with H2/H4); AUTO glyphs end-to-end; Rannveig no-fly movement.

### What's solid — no action
Turn/round/draft/placement/pending-choice machinery; movement core; combat core; 6 of 7 interactions; AI plays a full coherent game using every power but Carry; server-authoritative + RNG-free; order-marker hiding. Playthroughs (120 fuzz + 8 scripted full games) all finish cleanly.
