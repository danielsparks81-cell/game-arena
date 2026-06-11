# HeroScape — Slice 5 Spec: Army Draft & Placement

> Implementation spec, written before the code. Adds the army-building front end
> the game has been missing: the full 16-card roster, a point-budget draft, and
> a placement phase. Sources: 01-components-setup-army-building.md + the verified
> 2-player draft procedure in extraction/resolutions.md; the roster table in
> cards.md. Base: slice 4 (glyphs + powers).

## Scope decision

Powers and draft were originally one slice; they are split for reviewability.
**Slice 5 = the draft/placement SYSTEM + the full stat-complete roster.** All 16
cards become draftable. The 4 cards with implemented powers (Finn, Thorgrim,
Tarn, Marro — slice 4) keep them; the other 12 play **stat-only** and are tagged
"⚡ powers WIP" in the draft UI. Remaining powers land in slice 6+ in batches.

IN: full roster in content.ts; lobby picks map + point budget + mode; a `draft`
phase (roll-off order, the 2-player pick procedure, unique pool, budget
enforcement, pass); a `placement` phase (arrange your figures in your start
zone, ready-gated); a "quick battle" preset path that skips draft.

OUT (deferred): the 12 cards' powers (slice 6+); official maps + scenarios
(slice 7, blocked on map data, task #83); 3+ player draft (engine stays 2p).

## Phase flow

```
lobby → (draft → placement) → playing(rounds…) → finished
                ▲ quick-battle mode skips draft: auto-fill the preset armies
                  and auto-place, going straight to placement-ready/playing.
```

- `lobby`: host chooses **battlefield** (existing), **point budget** (preset
  200 / 300 / 400 / 500), and **mode** (Draft armies | Quick battle). `start_game`
  carries `{ mapId, pointBudget, mode }`.
- `draft` (mode=draft): see below. Ends → `placement`.
- `placement`: each player places their drafted figures into their start zone,
  simultaneous + ready-gated (like marker placement). Both ready → `playing`,
  round 1, straight into `place_markers` (slice 2 flow unchanged).
- Quick battle: engine auto-drafts the slice-4 fixed armies (Finn+Tarn vs
  Thorgrim+Marro) and auto-places them, then → `playing` directly (preserves the
  current fast path for testing).

## Full roster (content.ts) — stats AS PRINTED in cards.md

Add all 16 to `HS_CARDS` (the 4 existing keep their ids). Stats from the cards.md
roster table; figure counts rulebook-sourced; each gets a disc `letter` and a
`power: 'live' | 'wip'` flag. Squads: Tarn 4 (live), Marro 4 (live), Airborne 4,
Zettian 2, Krav Maga 3, Izumi 3. Heroes field 1.

| id | name | figures | Life | Move | Range | Atk | Def | Height | Points | power |
|---|---|---|---|---|---|---|---|---|---|---|
| tarn_vikings | Tarn Viking Warriors | 4 | 1 | 4 | 1 | 3 | 4 | 5 | 50 | live |
| finn | Finn the Viking Champion | 1 | 4 | 5 | 1 | 3 | 4 | 5 | 80 | live |
| thorgrim | Thorgrim the Viking Champion | 1 | 4 | 5 | 1 | 3 | 4 | 5 | 80 | live |
| airborne_elite | Airborne Elite | 4 | 1 | 4 | 8 | 3 | 2 | 5 | 110 | wip |
| drake | Sgt. Drake Alexander | 1 | 5 | 5 | 1 | 6 | 3 | 5 | 110 | wip |
| raelin | Raelin the Kyrie Warrior | 1 | 5 | 6 | 1 | 3 | 3 | 5 | 120 | wip |
| zettian_guards | Zettian Guards | 2 | 1 | 4 | 7 | 2 | 7 | 5 | 70 | wip |
| ne_gok_sa | Ne-Gok-Sa | 1 | 5 | 5 | 1 | 3 | 6 | 5 | 90 | wip |
| marro_warriors | Marro Warriors | 4 | 1 | 6 | 6 | 2 | 3 | 4 | 105 | live |
| deathwalker_9000 | Deathwalker 9000 | 1 | 1 | 5 | 7 | 4 | 7 | 7 | 140 | wip |
| mimring | Mimring | 1 | 5 | 6 | 1 | 4 | 3 | 9 | 150 | wip |
| grimnak | Grimnak | 1 | 5 | 5 | 1 | 2 | 4 | 11 | 160 | wip |
| syvarris | Syvarris | 1 | 4 | 5 | 9 | 3 | 2 | 5 | 100 | wip |
| agent_carr | Agent Carr | 1 | 4 | 5 | 6 | 2 | 4 | 5 | 100 | wip |
| krav_maga | Krav Maga Agents | 3 | 1 | 6 | 7 | 3 | 3 | 4 | 100 | wip |
| izumi_samurai | Izumi Samurai | 3 | 1 | 6 | 1 | 2 | 5 | 5 | 60 | wip |

`SLICE1_ARMIES` stays (used by quick-battle). The engine's existing
power dispatch keys off card id, so `wip` cards simply have no handler — they
fight as stats only. Keep the slice-4 `// slice 5` markers honest: this slice
makes them DRAFTABLE, not yet powered.

## Draft phase (the 2-player procedure — resolutions.md, verified)

1. **Order roll-off**: both players roll d20 (server-rolled; re-roll ties). High
   roller drafts first. Store the attempts for display (like initiative).
2. **Pick sequence**: high roller picks **1** card; the other player picks **2**;
   thereafter **alternate 1 each**, starting back with the high roller. So with
   A = high roller: A, B, B, A, B, A, B, …
3. **Unique pool**: 16 cards, each draftable **once total** (taken by either
   player removes it from the pool — all cards are Unique in this printing).
4. **Budget**: a player may not pick a card whose Points would push their army
   over the `pointBudget`. 
5. **Pass**: a player **must** pass when no remaining card is affordable; a
   player **may** also pass voluntarily to finish under budget. Passing
   permanently completes that army (they leave the rotation). When one player has
   passed, the other keeps taking single picks until they also pass / can't
   afford. Draft ends when **both** have passed.
6. Each player must end with **≥1 card** (can't pass with an empty army while an
   affordable card exists — enforce: the very first pick can't be a pass).

Open draft: picks are PUBLIC (you see the opponent's army forming) — no
projection change. `getActivePlayerId` = the current drafter (null when both
done).

## Placement phase

- Each player's drafted figures start "in hand"; they place each onto an EMPTY
  hex of **their own start zone** (`map.startZones[seat]`). `place_figure` /
  `unplace_figure`; `placement_ready` when done (must place ≥1; figures left in
  hand when ready are **unused** — log it, faithful to "excess figures are
  unused").
- Start zones must hold a reasonable army: **enlarge each map's start zones to
  two rows** (seat 0 = rows 1-2, seat 1 = last two rows) and update the
  maps.test.ts start-zone assertions. Cap is the zone size; the draft UI warns
  if an army can't fully fit.
- Simultaneous + ready-gated; both ready → `playing` (slice-2 round flow).

## State / actions

```ts
// types.ts
HSPhase += 'draft' | 'placement'
HSState += {
  mode: 'draft' | 'quick';
  pointBudget: number;
  draft?: {
    pool: string[];                    // remaining card ids
    order: number[];                   // [highRoller, other] seats
    rollOff: InitiativeAttempt[];      // d20 attempts for display
    turnSeat: number | null;           // whose pick
    remainingPicks: number;            // picks left in this player's turn (2 then 1…)
    passed: number[];                  // seats that completed
    armies: Record<number, string[]>;  // seat → drafted card ids (public)
    spent: Record<number, number>;     // seat → points used
  };
  hand?: Record<number, string[]>;     // placement: seat → unplaced figure ids
}
HSAction +=
  | { kind: 'start_game'; mapId?; pointBudget?; mode? }   // extends slice-3 start
  | { kind: 'draft_roll'; attempts }                      // server d20 roll-off
  | { kind: 'draft_card'; cardId }
  | { kind: 'draft_pass' }
  | { kind: 'place_figure'; figureId; to: HexKey }
  | { kind: 'unplace_figure'; figureId }
  | { kind: 'placement_ready' }
STATE_VERSION → 5.
```

Server (`makeMoveHS`): rolls the draft roll-off d20s (re-roll all on tie, cap 20)
when entering draft; validates `draft_card` (in pool, affordable, this player's
turn) and the pick-count decrement; builds figures + `hand` when draft ends.

## UI (HeroScapeBoard)

- **Lobby**: add point-budget presets + a Draft / Quick-battle toggle beside the
  existing battlefield picker.
- **Draft screen**: the 16-card pool as stat cards (name, points, figures,
  Mv/Rg/⚔/🛡/H, "⚡ powers WIP" tag for `wip` cards, grey when taken); your army
  list + "spent / budget"; whose-pick banner + the roll-off; pick (click a pool
  card) / pass buttons; opponent's army shown building.
- **Placement screen**: your start zone highlighted on the board; your in-hand
  figures as a tray; click a figure then a start-zone hex to place (or
  click-to-place sequentially); unplace; "Ready" when done; opponent ready
  status. Reuse the per-viewer orientation (your zone at the bottom).
- Then the existing play board (slice 2-4) unchanged.

## Tests (engine.test.ts)

- start_game routes: draft mode → 'draft' with a roll-off; quick mode → armies
  auto-filled + placed → 'playing'.
- Draft order: high roller first; the **1,2,then-alternate-1** sequence is
  enforced (A,B,B,A,B,…); wrong-turn / not-your-pick rejected.
- Unique pool: a drafted card leaves the pool; re-drafting it is rejected.
- Budget: a card over remaining budget is rejected; forced pass when nothing
  affordable; voluntary pass allowed; can't pass an empty army while affordable
  cards remain.
- Draft end: both passed → 'placement' with each seat's `hand` = its armies'
  figures; `spent` ≤ budget.
- Placement: place only onto your own start-zone empty hexes; unplace; ready
  needs ≥1 placed; unplaced figures are dropped (unused) on ready; both ready →
  'playing' round 1 place_markers.
- Roster: all 16 cards have the cards.md stats; `power` flags correct.
- Regression: quick-battle reproduces the slice-4 fixed-army game; all slice-4
  tests pass; projection still leak-free (draft/placement add no secrets — only
  order markers are hidden).
- computeHistory still null until 'finished'.

## Verify + ship
tsc · vitest (heroscape, 2×) · build · commit · push (auto-deploys). Review the
draft turn-sequence/budget enforcement and the draft→placement→playing
transition personally. HeroQuest's 38 pre-existing failures stay out of scope.
