# HeroScape — Code Audit (2026-06-27)

Bugs / dead-code / performance pass across `engine.ts`, `board.ts`, both board
components, and the cross-module surface. Method: four read-only subagents (one per
area), each finding verified against the code before recording. Commit `3341b35`
landed everything in the **Fixed** section; the **Deferred** section is the ranked
backlog (left undone because it needs visual testing or is low ROI).

## Fixed this pass

| Sev | Where | Issue → fix |
|---|---|---|
| 🟠 bug | `engine.ts` doAttack (~4695, ~4706) | A 2-hex figure (Grimnak) killed by a normal/counter-strike attack had only `at` nulled, leaving a stale `at2` tail — every *other* destruction site clears both lobes. Now clears both; masked today by `figureHexes` returning `[]` when `at==null`, but a latent landmine for any revive. **+ regression test** (`big-heroes.test.ts`). |
| 🟠 bug | `HeroScapeBoard.bigheroes.test.tsx` `dropStage` | **Pre-existing** (prior session): `canTheDrop`'s `seatIsAlive` gate made the helper's nulled quick-army figures read as casualties → the "Roll The Drop" button test failed. The engine-test helper was fixed last session but this component one was missed (component suite wasn't re-run). Fixed the helper (keep one enemy; seat owns reserves only). |
| 🟠 dead | `engine.ts` + `index.ts` | Removed `canThrow` (zero callers — the board uses `throwTargets`/`throwLandingHexes`). |
| 🟠 dead | `HeroScapeBoard.tsx` | Removed unused `teamSpentInDraft` import. |
| 🟡 dead | `index.ts` | Dropped 3 barrel type re-exports with no external importer (`HSGlyphDef`, `HSGlyphKind`, `HSDraftState`) — the types stay; only the dead re-export lines went. |
| 🔴 drift | `colors.ts` (new) | `SEAT_COLORS`/`TEAM_COLORS` were hand-copied byte-for-byte into **both** boards **and** the map-maker (comments literally said "must MATCH HeroScapeBoard.tsx"). A tweak in one silently desynced 2D vs 3D figure colours. Now one shared module imported by all three. |
| 🟠 perf | `HeroScapeBoard.tsx` `roster` | `O(players×cards×figures)` recomputed every render (incl. local hover/toggle re-renders). Memoized on `[players, cards, figures]`. |
| 🟡 bug | `HeroScapeBoard.tsx` (~2417/2431) | `flashTimer`/`hintTimer` had no unmount cleanup (unlike `glyphFlashTimer`) → a late `setState` on an unmounted board. Added the cleanup effect. |

Engine health is otherwise excellent: the clone-once invariant holds everywhere,
no input-state mutation, `seatIsAlive`/`livingSeats` are correct across the turn &
elimination flow, and per-step swipe dedup is right. `board.ts` and `figureBase.ts`
are clean (pure, no dead exports, no per-frame work).

## Deferred — ranked backlog (need visual testing or low ROI)

### 🔴 The big 3D win — `HeroBoard3D.tsx` whole-board re-render + no geometry sharing
This is the single largest perf lever and is **deliberately left for a session where
the board can be watched live** (it can't be verified by tsc/unit tests):
1. `<Scene>`, `<HexTile>`, `<Standee>` are all un-memoized, and each tile/standee
   gets fresh `{color,dim}` highlight literals + new `onClick` closures every render,
   so every hex + figure reconciles on any state tick. → `React.memo` the leaves +
   stabilize props (incl. the two inline `new Set([...])` board props at the call
   site, ~4939/4948).
2. Each `HexTile` mounts its own `cylinderGeometry` + 3 materials + `Edges`; each
   `Standee` its own disc geometry + a freshly-compiled `ShaderMaterial`. N hexes =
   N geometries + 3N materials; M figures = M shader programs. → shared/instanced
   geometry (`<Instances>`) + one pooled shader. Also `figMat` isn't `.dispose()`d
   when recreated (small GPU leak).
3. Per-figure `useFrame` sway/pulse callbacks register for figures that don't need
   them and early-return each frame. → gate registration on `trail`/`actionable`.

### 🟠 `engine.ts` clone cost
`clone = JSON.parse(JSON.stringify(state))`. A move runs 2 deep serializations (undo
snapshot + clone); finalize-then-act runs 2 full clones. Candidate: `structuredClone`
or store undo *deltas* instead of whole-state strings. Behaviour-sensitive — measure
first.

### 🟡 Lower-ROI `HeroScapeBoard.tsx` items
- `throwLandingHexes(state, …)` called inline ×3 per render while aiming a Throw
  (~4947/4962/4285) → compute once.
- `powerTargetIds` (12-way `new Set([...])`, ~4939) + sibling inline Sets → memoize.
- 2D SVG fallback (`!can3D` only) does per-cell `O(figures)` scans + `Object.entries`
  startZone lookups (~4980-5006) → build occupant / start-zone Maps once.
- Repeated full scans: `seatColor` (`players.find` per call), `livingSeats`/`livingFor`
  per row → hoist once per render.

### 🟡 Cosmetic
- `HeroBoard3D.tsx` local `hexLine` (cube-lerp) shares a name with `board.ts`'s
  `hexLine` (direction-step) — different functions; rename the 3D one `hexLerpLine`.
- `canAcidBreath` / `orientationOptions` are exported but test-only — wire into the UI
  or mark test-support.
