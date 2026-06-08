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
- Don't-block heuristic: among valid attack squares, prefer the one that leaves the most other
  orthogonal attack lanes around the target open for teammate monsters.
- Movement uses BFS (monsterReachableSquares) — exact reachability within move budget.
- Predator far-side tie-break: when "don't-block" scores are equal, prefer the attack square
  closest to the primary target (sets up next-turn approach).

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

## Pending / blocked work

- **#65** Chest/furniture trap model — needs quest-driven trap data
- **#66** Treasure deck wandering-monster/hazard split + reshuffle
- **#69** Between-quests economy (rulebook p.22) — user to share the page
- **#71** Quest engine + Quests 2–14 — blocked on #69
- **#74** Dread spell system (12) + artifact system (14)
- **#76** Stairway = one logical space (engine + visuals)
- **#77** Apply placement ruleset to Quests 2–14
