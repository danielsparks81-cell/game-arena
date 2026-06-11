# HeroScape — Components, Setup & Army Building

> Mechanics on this page are summarized in our own words for the digital adaptation; this is a structured reference, not a reproduction of the rulebook text.

*Sources: 2nd Edition rulebook (Rise of the Valkyrie Master Set, ©2004), pages 3–4, 7–8, 16. Page-by-page extractions: [`extraction/pages-01-07.md`](./extraction/pages-01-07.md), [`extraction/pages-08-14.md`](./extraction/pages-08-14.md), [`extraction/pages-15-21.md`](./extraction/pages-15-21.md).*

---

## 1. Component manifest (p. 3)

### Terrain tiles (count by terrain × size)

| Tile size | Grass | Rock | Sand | Water |
|---|---|---|---|---|
| 24-hex | 6 | 2 | — | — |
| 7-hex | 5 | 3 | 2 | — |
| 3-hex | 5 | 3 | 2 | — |
| 2-hex | 5 | 3 | 2 | — |
| 1-hex | 16 | 6 | 4 | 21 |

### Everything else

| Component | Count | Notes |
|---|---|---|
| Painted figures | 30 | Distributed across the 16 Army Cards (a Hero card = 1 figure; a Squad card = 2+ figures) |
| Ruins | 2 | One long, one short wall piece; block Line of Sight. See 04-combat-range-los-attack.md |
| Army Cards | 16 | Double-sided (Basic side / Master side); **all 16 are Unique** (p. 7, p. 16) |
| Glyphs | 10 | 1 each of Astrid, Gerda, Ivor, Valda, Dagmar, Kelda, Erland, Mitonsoul + 2× Brandar (roster per the p. 17 Glyphs Key). Powers in 05-glyphs-special-powers.md |
| Wound markers | 24 | Shared supply; track damage on Army Cards (Master Game only) |
| Round marker | 1 | Black; tracks the round number on the scenario's Round Marker Track |
| Grenade marker | 1 | Consumed by the Airborne Elite's grenade special attack (p. 16). See 04-combat-range-los-attack.md |
| Order markers | 16 | 4 per player — "1", "2", "3", "X" — so the set supports up to 4 players' marker needs |
| Combat dice (d6) | 12 | Shared pool; the **same dice** are read as attack dice (count skulls) and defense dice (count shields) |
| 20-sided die | 1 | Used for initiative, draft/placement order, LOS disputes, and Extreme Fall checks (see other topic files) |

**Notes**

- ⚠ **Combat die face distribution is never stated anywhere in the rulebook** (checked exhaustively: pp. 3, 4, 6, 9, 13, 14 carry no face count, in text or diagram). The p. 6 example illustrations prove each d6 carries red **skull** faces, blue **shield** faces, and at least one **blank** face, and that off-symbols never count (a shield rolled on an attack roll is ignored; a skull rolled on a defense roll is ignored; blanks count as nothing). The widely known distribution — 3 skulls / 2 shields / 1 blank — is **external knowledge, not confirmed by this rulebook**; the engine must adopt it as an explicit, documented assumption. See 04-combat-range-los-attack.md.
- There is **no 24-hex sand tile** and water exists **only as 1-hex tiles** — constrains the map builder's tile inventory.
- The 16 order markers are not a shared pool: each player takes exactly 4 (see §6). A 5+ player game would need a second set's markers.
- "The first time you play" content on p. 3 is one-time physical assembly (snapping Mimring's wings on) — no digital relevance.

---

## 2. Basic Game setup (p. 4)

The Basic Game is the introductory mode: Basic card side only, no order markers, no rounds, no wounds (one-hit destruction). Setup, in order:

1. **Battlefield + scenario:** build a battlefield from the Battlefield & Game Scenario section (p. 17 ff.). That section contains **five battlefields** (with step-by-step build instructions) and provides **3 Basic Game Scenarios**, each defining its own victory condition. Setup is scenario-driven, not freeform.
2. **Armies are pre-assigned, not drafted:** **Player 1 takes the Good Army, Player 2 takes the Evil Army**, with composition fixed by the chosen scenario. Each player lays their Army Cards face-up and places their figures on the scenario's printed starting positions.
3. **Card side:** use the **Basic side** of each Army Card — it shows only Move / Range / Attack / Defense.
4. **Card types:** a **Hero Card** controls exactly 1 figure; a **Squad Card** controls 2+ figures that all activate together as one card.
5. **Dice:** place the **12 combat dice** near the battlefield. No other components are used in the Basic Game unless the scenario says so (no order markers, wound markers, round marker, or d20).

### First-player determination (Basic Game)

| Step | Rule |
|---|---|
| Roll | **Each player rolls 6 combat dice** |
| Winner | Most **skulls** rolled takes the first turn |
| Tie | Re-roll (repeat until broken) |
| Thereafter | Players **strictly alternate** turns until the scenario's victory condition is met |

**Notes**

- The Basic Game's first-turn roll is a **skull-counting combat-dice roll**, not the d20 initiative roll — d20 initiative is a Master Game mechanic, re-rolled every round. See 02-rounds-turns-order-markers.md.
- The "6 combat dice" numeral was verified at high zoom against the scan (previously flagged unclear; now confirmed).
- The apparent p. 3 vs p. 4 conflict ("two scenarios per battlefield" vs "3 Basic Game Scenarios") is reconciled by the scenario pages themselves: each of the 5 battlefields carries 2 scenarios (10 total), of which exactly 3 are Basic — Attack at Dawn (p. 19), Dive the Dark Lakes (p. 21), The Search for Comfrey Plants (p. 23); the other 7 are Master. See 07-scenarios.md.
- Basic-side stat example (Zettian Guards): MOVE 4, RANGE 7, ATTACK 2, DEFENSE 7 — confirms the four Basic stats and that the card edge also carries World / Set / Collector-number identifiers (flavor data, no rules weight).

---

## 3. Master Game setup & team play (p. 7)

The Master Game is the full game: same core loop as Basic, but cards flip to their **Master side**, adding Life (wound tracking), point values, special powers, and the extra movement/combat rules covered in the other topic files.

- **Objective:** as Basic — first player (or team) to meet the chosen **Master Game Scenario's** victory condition wins.
- **Battlefield + scenario:** pick from the section starting p. 17; custom battlefields/scenarios are encouraged once players know the game.
- **Team play** (any scenario that defines teams):
  - Teammates sit together on one side, facing the opposing players.
  - Each teammate plays **their own separate turns** — teams do not merge armies or turns.
  - **Open table-talk is allowed**: teammates may freely discuss strategy (and may look at each other's hidden order markers — see 02-rounds-turns-order-markers.md).
  - Team victory conditions come from the scenario; usually a single shared goal.
- **Combining multiple Master Sets / expansion sets:** see §7 (rules from p. 16).

---

## 4. Army Card anatomy — Master side (p. 7)

Every field on the Master side, and what it drives in the engine:

| Field | Meaning | Engine relevance |
|---|---|---|
| Unique / Common | Card duplication class (all Master Set cards are Unique) | Army-validation rule — see §7 |
| Hero / Squad | 1 figure vs 2+ figures activating as one card | Activation grouping; armies may mix freely (all Heroes, all Squads, or any blend) |
| General (Valkyrie) | Which of the five Generals the card serves: **Jandar, Utgar, Ullar, Vydar, Einar** | Referenced by some card powers (p. 16); no army-building restriction stated in this rulebook |
| Species | Race (e.g., Human) | Power-reference hook (p. 16) |
| Class | Profession/type (e.g., Agent) | Power-reference hook |
| Personality | Dominant trait (e.g., Tricky) | Power-reference hook |
| Size / Height | Size class + height in levels (e.g., Medium 5) | Height number drives climbing limits, falls, engagement exceptions, overhang fit — see 03-movement-elevation-terrain.md |
| Life | Wounds the figure absorbs before being destroyed | Master Game replaces Basic's one-hit destruction |
| Move | Max spaces moved per activation | |
| Range | Max attack distance in spaces (1 = melee) | |
| Attack | Base attack dice rolled per attacking figure | |
| Defense | Base defense dice rolled when attacked | |
| Points | Army-building cost | Summed against the scenario's point limit (§5) |
| Special power(s) | Named card abilities | **Card text overrides the general rules** for moving/attacking/defending |
| Target Point | Green dot on the card's figure silhouette | The point LOS is sighted **from** |
| Hit Zone | Red region on the card's figure silhouette | The region that must be visible to be attacked (Master Game tightens Basic's "see any part" rule) |

**Notes**

- The Target Point caption on p. 7 is partially obscured by card art in the scan, but p. 13 settles its function: LOS runs **from the attacker's Target Point to any part of the defender's Hit Zone**. See 04-combat-range-los-attack.md.
- Species / Class / Personality / General / Unique-Common / Hero-Squad have no intrinsic rules — they exist to be referenced by special powers (p. 16). Two worked references from p. 16: **Deathwalker references Soulborg Guards — and the Master Set's Zettian Guards ARE Soulborgs, so they qualify for that reference.** This pairing is rulebook-confirmed and is all the engine needs to implement Deathwalker's power against base-set content without card scans. Grimnak references Orc Warriors, who only exist in expansion sets.

### Worked example — Agent Carr (printed card values, p. 7)

| Field | Value |
|---|---|
| Card type | Unique Hero |
| General | Vydar |
| Species | Human |
| Class | Agent |
| Personality | Tricky |
| Size / Height | Medium 5 |
| Life | 4 |
| Move | 5 |
| Range | 6 |
| Attack | 2 |
| Defense | 4 |
| Points | 100 |

His printed special powers (recorded as card data, not general rules):

| Power | Effect |
|---|---|
| Ghost Walk | May move through **all** figures, friendly and enemy |
| Sword of Reckoning 4 | When attacking an **adjacent** figure, add **4 attack dice** (2 + 4 = 6 dice in melee) |
| Disengage | Never takes leaving-engagement attacks when leaving an engagement (see 03-movement-elevation-terrain.md) |

### Card data leaked by rulebook examples (cross-check anchors)

The rulebook's worked examples confirm a handful of printed card values. These are **cross-check anchors only** — the real card roster must come from card scans (see ARCHITECTURE.md §10) — but any content pipeline should validate against them:

| Card | Confirmed data | Source |
|---|---|---|
| Marro Warriors (squad) | **4 figures** per squad | p. 4, Example 1 |
| Zettian Guards (squad) | **2 figures** per squad; Basic-side stats **Move 4 / Range 7 / Attack 2 / Defense 7** | p. 4, Example 2 |
| Syvarris | **Life 4, Defense 2** | p. 14, Example 17 |
| Marro Warrior | **Attack 2** | p. 14, Example 17 |
| Agent Carr | Full Master-side card — see the worked example above | p. 7 |

---

## 5. Building an army — Master Game (p. 8)

### Point limit (hard constraint)

- Each player's army = a set of Army Cards whose **summed Points must be ≤ the scenario's point limit**. Under-spending is legal (the rulebook's own example fields a 390-point army against a 400-point limit); exceeding it is not.
- Players do **not** need equal card counts (3 cards vs 5 cards is fine).
- Good/evil card loyalties are loosened in the Master Game: an army may **mix card colors freely**.
- Two ways to build (player choice per scenario): bring a **pre-made army** or **draft**.

### Method A — Pre-made armies

1. Each player arrives with a legal army already chosen and lays its cards face-up.
2. **Placement order:** all players roll the d20 (re-roll ties). The **highest roller places their ENTIRE army first** in their starting zone; placement then passes **left**, each player placing their whole army in turn.

### Method B — Drafting (2 players)

| Step | Who | Picks |
|---|---|---|
| 1 | Both roll the d20 (re-roll ties) | — |
| 2 | Higher roller | **1** Army Card |
| 3 | Other player | **2** Army Cards |
| 4+ | Alternate | **1** card each, until both armies are completely chosen and placed |

### Method B — Drafting (3+ players, snake draft)

1. All players roll the d20 (re-roll ties). Highest roller drafts first: **1** Army Card.
2. Drafting passes **left**, 1 card per player; the **last player in the chain picks 2** cards.
3. The draft **reverses direction**. The player at the end of the chain at every turnaround — **including the original first drafter when the snake returns to them** — picks **2** cards, then the direction flips again.
4. **Mandatory pass:** if every remaining card a player could pick would push them over the scenario's point limit, that player **must pass** — and passing **permanently completes their army** (they never re-enter the draft).
5. Snaking continues until every player has completed their army.

Worked pick order for players A→B→C→D (A = highest roller): A:1, B:1, C:1, **D:2**, C:1, B:1, **A:2**, B:1, C:1, **D:2**, …

**Notes**

- Drafting and placement are interleaved: when a player drafts a card, they place its figure(s) on the battlefield **immediately, before the next player picks** — so later picks can react to enemy deployment.
- The pass is **forced, not optional**: a player may not "sit out" a pick to wait for a cheaper card later while still under budget; they pass only when no further legal pick exists, and that pass is terminal.
- The double pick at every snake turnaround means seat order matters: end-of-chain seats get paired picks.

### Starting-zone placement (applies to both methods)

- A player's **entire army goes in one single starting zone** (zones are defined by the scenario map).
- You may **not** place figures into a starting zone occupied by an enemy.
- **Teammates share one starting zone** unless the scenario says otherwise.
- If an army has more figures than the zone has spaces, the **excess figures are simply not used** (no overflow placement).

---

## 6. Table components at setup — Master Game (p. 8)

| Component | Allocation | Rule |
|---|---|---|
| Order markers | **4 per player**: "1", "2", "3", "X" | Placed on the player's Army Cards each round to schedule which card acts on which turn; "X" is a decoy. Full mechanics in 02-rounds-turns-order-markers.md |
| Combat dice | 12, shared pool near the battlefield | Same dice serve as attack dice (skulls) and defense dice (shields) |
| Wound markers | All in a shared supply near the battlefield | No per-player split; 24 total exist (p. 3) |
| Glyphs | Per scenario | Placed on specific spaces only as the scenario directs; most grant powers to a figure landing on them. See 05-glyphs-special-powers.md |
| Round marker | 1 (black) | Starts on space "1" of the scenario's Round Marker Track; advances one space at the end of each round (automatic) |

**Notes**

- The game is played in **rounds**; a round = **3 turns per player** (full round/turn loop in 02-rounds-turns-order-markers.md).
- The rulebook prints no count for wound markers or glyphs on p. 8 ("place all of the Wound Markers") — the counts come from the p. 3 manifest (24 wound markers, 10 glyphs). Glyph quantity *used* is scenario-directed, 0–10.

---

## 7. Unique vs Common cards & multi-set play (p. 16)

Combining multiple Master Sets and/or expansion sets enables bigger battlefields, more players, mirror-matched armies, and larger point totals. Card-duplication rules:

### Unique Army Cards

- Every Army Card in the Master Set is **Unique**.
- One player's army may **never contain two copies of the same Unique card** (no double Grimnak), even when playing with multiple sets.
- It **is legal for opposing players to each field the same Unique card** — one Grimnak per player is fine.

### Common Army Cards (expansion sets only)

- One army **may include multiple copies of the same Common card**, with two special rules:
  1. **Figures are interchangeable** across matching Common cards — players do not track which physical figure belongs to which card. An order marker placed on *either* card activates the card's figure count drawn from *any* matching figures (e.g., two Blade Grut cards: a marker on either activates **any 4** Blade Gruts).
  2. **Casualties fill one card at a time.** A destroyed Common figure goes onto a matching Army Card; if a matching card already holds destroyed figures, it **must be filled completely before any destroyed figure is placed on an empty matching card**. (Only the first casualty may choose freely among matching cards.)
- **Marking figures** (advisory, not a rule): when mixing sets, initial the underside of figure bases to track ownership — physical-only concern.

**Notes**

- Engine model for Common duplicates: treat matching Common cards as one shared figure pool of (copies × squad size); the casualty-fill rule means cards die **sequentially**, so the first card goes out of play (losing its order-marker eligibility — see 02-rounds-turns-order-markers.md) after exactly one squad's worth of total casualties, the next after two, etc.
- The base Master Set contains **no Common cards** — this whole section only activates once expansion content is added.
- Unique-card validation is **per army**, not per table: the duplicate check runs inside each player's card list only.

---

## Cross-reference map

| Topic touched here | Detailed in |
|---|---|
| Rounds, turns, order markers, initiative | 02-rounds-turns-order-markers.md |
| Movement, elevation, Height number, engagement | 03-movement-elevation-terrain.md |
| Combat, Range, LOS, Target Point / Hit Zone, dice reading | 04-combat-range-los-attack.md |
| Glyph powers and placement | 05-glyphs-special-powers.md |
| Battlefield assembly, tile key, build instructions | 06-battlefield-key-assembly.md |
| Scenarios, starting zones, point limits per scenario | 07-scenarios.md |

## Open questions (⚠)

- ⚠ **Combat die face distribution** (skulls/shields/blanks per d6) is not printed anywhere in the rulebook. Engine assumption needed; the community-standard 3 skulls / 2 shields / 1 blank must be sourced externally and documented as such.
