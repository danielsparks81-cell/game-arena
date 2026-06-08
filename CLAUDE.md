@AGENTS.md

# HeroQuest — design decisions & canonical rules

## Spell fidelity (12 cards, confirmed rulebook)

| Spell | Element | Target | Effect |
|---|---|---|---|
| Genie | Air | genie | Open any door OR attack any visible monster with 5 combat dice (player chooses mode) |
| Tempest | Air | monster | Target monster misses its next turn (stunned flag, cleared when skipped) |
| Swift Wind | Air | hero | Target hero rolls twice as many movement dice on their next move |
| Veil of Mist | Water | hero | Target hero may move through monster-occupied squares on their next move (phaseMonsters flag) |
| Sleep | Water | monster | Monster sleeps; rolls 1d6 per Mind Point at start of each Zargon turn — wakes on any 6. Cannot be cast on undead (skeleton, zombie, mummy) |
| Water of Healing | Water | hero | Restore up to 4 lost BP to target |
| Ball of Flame | Fire | monster | 2 auto-BP damage; monster rolls 2d6 — each 6 reduces damage by 1 |
| Courage | Fire | hero | Target hero rolls 2 extra combat dice on their next attack (attackBonus +2 only — no extraAttack) |
| Fire of Wrath | Fire | monster | 1 auto-BP damage; monster rolls 1d6 — a 6 reduces damage by 1 |
| Pass Through Rock | Earth | hero | Target hero moves through walls and solid rock on their next move (phaseWalls flag) |
| Heal Body | Earth | hero | Restore up to 4 lost BP to target |
| Rock Skin | Earth | hero | Target hero gains +1 defense die until they suffer 1 BP of damage (defenseBonus, cleared on first damage) |

**Key rules:**
- Spells are one-shot per quest (card discarded on cast, even if the effect is wasted due to no LOS)
- Genie dual-mode UI: player first clicks "Open a door" or "Attack a monster", then picks the target
- Both healing spells restore exactly 4 BP (not 2; stale heal_body_w reference removed)
- Rock Skin: +1 die (not +2), cleared when damage > 0 on defense, NOT cleared at turn start
- Veil of Mist: phaseMonsters flag only — no movement bonus
- Courage: attackBonus += 2 only — does NOT grant extraAttack

## Hero death & loot drop

When a hero reaches 0 BP (and no death-save is available or declined):
- All equipment (items), potions, and gold dropped as a LootPile on the hero's current square
- A skull marker is rendered on that square
- Any living hero walking over it auto-collects (not an action, happens in walkPath)
- If no hero reaches it before quest end, loot is permanently lost
- Dead hero removed from board; body <= 0 for the rest of the quest
- "Return next quest" respawn (base stats) is tied to task #69 — deferred

## Monster personalities

Three personalities randomly assigned at spawn (1-in-3 each), hidden from players.
Players discover the personality by observing behaviour over multiple Zargon turns.

**Predator** — hunts the hero with the lowest *current* (raw) BP (not most-wounded relative to max).
- If the primary target is unreachable, attacks an intermediate hero but positions on the "far side"
  (attack square closest to the primary target) to be one step closer next turn.
- Falls back to moveTowardGreedy if no hero is reachable at all.

**Aggressor** — always attacks the nearest hero (Manhattan distance); lower raw BP breaks distance ties.
- Falls back to nearest reachable hero when primary is blocked.

**Methodical** — targets the hero with fewest effective defense dice:
  `(defense + defenseBonus) - (inPit ? 1 : 0)`. Tie-break: proximity.
- Falls back to nearest reachable hero when primary is blocked.

**Universal rules (all personalities):**
- Always attack every turn if any hero is reachable — never skip to reposition.
- Don't-block heuristic: among valid attack squares (all 8 directions), prefer the one that
  leaves the most other adjacent attack lanes open for teammate monsters.
- Movement uses BFS (monsterReachableSquares) — exact reachability within move budget.
- Predator far-side tie-break: when "don't-block" scores are equal, prefer the attack square
  closest to the primary target (sets up next-turn approach).

## Monster diagonal attacks (house rule #9)

Monsters may attack from any of the 8 squares surrounding a hero — orthogonal **and** diagonal.

- `attackSquaresFor` uses `allAdjacentCells` (8 directions) instead of 4-orthogonal `adjacentCells`.
- Wall check for diagonal pairs uses the **lenient** rule: only blocked when **both** flanking corner
  edges are walls (`wallBetween` helper). Touching a single corner still allows the strike — consistent
  with the character LOS rule.
- Monster **movement** remains orthogonal (BFS only expands 4 directions). A monster reaches a
  diagonal attack square by walking orthogonally to it, then strikes from there.
- `countFreeAttackPositions` also uses all 8 directions so the don't-block heuristic correctly
  values diagonal lanes.

## Monster gold drops

Each monster kind drops a random gold amount in [goldMin, goldMax], awarded to the killing hero.

| Kind | Min | Max |
|---|---|---|
| Goblin | 1 | 3 |
| Skeleton | 1 | 4 |
| Orc | 2 | 6 |
| Zombie | 2 | 5 |
| Abomination | 3 | 7 |
| Mummy | 3 | 8 |
| Dread Warrior | 4 | 9 |
| Gargoyle | 4 | 10 |

Stored as `goldMin` / `goldMax` on the `Monster` type (and `MonsterStats`). Rolled at kill time in
`doMonsterAttack` → `checkHeroDeath` chain. No gold if the monster has no range defined.

## Death-save rules

When a hero reaches 0 BP, before they are killed the engine checks **only that hero's own resources**:
- **Potion of Healing** (`heal_d6`) in their own inventory → always available.
- **Uncast healing spell** (`heal_body_e` / `water_heal`) in their own spell hand → available only if
  they haven't acted this turn (`!h.hasActed`).

A `pendingDeathSave` prompt is raised for the dying hero's player. Only that player can resolve it
(`dying.playerId === playerId` enforced in `doDeathSave`). No other hero or healer can intervene.
If the player declines (or has no options), `killHero` is called immediately.

**Self-only (house rule #5):** the Wizard cannot cast a healing spell on a dying Barbarian. Each hero
saves themselves with their own resources, or not at all.

## Key type flags

| Flag | Lives on | Meaning |
|---|---|---|
| phaseMonsters | Hero | Veil of Mist — hero passes through monster cells this move |
| phaseWalls | Hero | Pass Through Rock — hero passes through walls this move |
| attackBonus | Hero | Extra attack dice on next attack (Courage) |
| defenseBonus | Hero | Extra defense die until damage taken (Rock Skin) |
| sleeping | Monster | Sleep spell active; wake check each Zargon turn |
| stunned | Monster | Tempest — loses next Zargon turn |
| personality | Monster | 'predator' \| 'aggressor' \| 'methodical' — assigned at spawn |
| lootPiles | HQState | Loot dropped by dead heroes; auto-collected on walkover |

## Stairway rules

The stairway is a 2×2 block of 4 tiles (kind `'stairs'`) tucked into the entrance room.
It is treated as **one logical space** for movement only — stair→stair steps cost 0;
entering or leaving the stairway costs 1. All 4 heroes start on the stairway tiles.
Stair tiles belong to the entrance room region (not their own region).

Monsters **can** enter stair tiles (needed so they can attack heroes cornered there).

**Exit flow (kill_and_exit):**
- Once the objective is killed, any hero who reaches the stairway gets an exit prompt.
- When they confirm, they are marked `escaped` and removed from the turn order;
  the quest **continues** — Zargon still acts and can kill the remaining heroes.
- Each subsequent hero gets the same prompt when they reach the stairway.
- The quest ends only when every hero is either escaped or dead.
- If **any** hero escaped → heroes win and advance to the next quest.
- If **all** heroes died without escaping → Zargon wins.
- Rationale: heroes who die after the first escape lose their items,
  weakening the party's resources for the next quest.

## Spell draft rules

Draft happens at the start of every quest (pre-quest `spell_draft` phase), before heroes enter the dungeon.

- If **only Wizard** is present: no draft — Wizard gets all 4 schools (12 spells). Quest begins immediately.
- If **only Elf** is present: Elf picks any 1 school. Quest begins.
- If **both** are present:
  1. Wizard picks 1 school first (`pick_spell_school` action, `step === 'wizard'`).
  2. Elf picks 1 school from the remaining 3 (`step === 'elf'`).
  3. Wizard receives **all remaining 3 schools** (9 spells total). Elf keeps their 3.
- Dwarf and Barbarian receive no spells and are skipped by the draft entirely.
- `spellsCast[]` tracks spent cards per quest (one-shot). Cleared at quest start.
- Both `heal_body_e` (Earth) and `water_heal` (Water) are healing spells usable as a death-save (`HEALING_SPELL_IDS`).

## Treasure deck rules

A hero who searches for treasure triggers this in order:
1. If the current room has quest-specific fixed content on a piece of furniture marked `fixedContent`, that triggers instead (gold, armor, etc.). No card drawn.
2. Otherwise, draw the top card of the shuffled treasure deck.
   - **Gold / gem / jewels / potion**: hero keeps it; card goes to the discard pile permanently.
   - **Hazard**: hero loses BP; card goes to the BOTTOM of the live deck (cycles back).
3. The deck is reshuffled (from discard) only when it runs empty before a draw.
4. Wandering-monster cards are **not** in the treasure deck — monsters spawn via quest content and room reveals only.
5. Heroes can only search **rooms** for treasure. Hallways and rooms can be searched for secret doors and traps.

## House / custom rules

These override the printed rulebook. Do not revert them without explicit instruction.

| # | Rule | Status |
|---|------|--------|
| 1 | Heroes always number exactly 4 (unfilled seats use AI-controlled heroes) | ✅ implemented |
| 2 | Monster personalities (Predator / Aggressor / Methodical) hidden from players | ✅ implemented |
| 3 | Gold drops per monster kill — random range per kind (see table above) | ✅ implemented |
| 4 | Treasure deck: hazard cards cycle back to the bottom; wandering monsters spawn from room reveals only (not the deck) | ✅ implemented |
| 5 | Death-save is **self-only** — a hero can only use their own potion or spell to survive 0 BP; no other hero can intervene | ✅ implemented |
| 6 | Spell draft at quest start — Wizard picks first, Elf picks second, Wizard gets remaining 3 schools | ✅ implemented |
| 7 | Stairway is one logical space — stair→stair movement costs 0; heroes start on stairway tiles | ✅ implemented |
| 8 | Heroes who die after the first escape still lose their items (loot dropped, not carried to next quest) | ✅ implemented |
| 9 | Monsters **can** attack diagonally (all 8 adjacent squares valid attack positions) | ✅ implemented |

## Pending / blocked work

- **#65** Chest/furniture trap model — needs quest-driven trap data
- **#69** Between-quests economy (rulebook p.22) — user to share the page
- **#71** Quest engine + Quests 2–14 — blocked on #69
- **#74** Dread spell system (12 spells) + artifact system (14 items) — awaiting card screenshots
- **#77** Apply placement ruleset to Quests 2–14
