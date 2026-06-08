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
- Wall check for diagonal pairs uses the **L-path rule** (`wallBetween` helper): a diagonal attack
  is allowed if **at least one** of the two "elbow" routes from attacker to target is fully clear
  (no wall on either orthogonal step of that route). Blocked only when **both** elbow routes are
  wall-blocked.
  - Example (allowed): monster just inside room at a doorway → hero just outside and to the side.
    One elbow goes room→room then open-door→hero: clear → attack allowed.
  - Example (blocked): monster inside room → hero directly behind the solid wall (orthogonal wall
    on one elbow, orthogonal wall on the other elbow "around and back"): both elbows blocked →
    attack blocked.
  - **DO NOT** simplify to a flat `||` (too strict — blocks valid door-corner attacks) or `&&`
    (too lenient — allows "around and back" through a wall). The L-path check is the correct rule.
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
| feared | Hero | Dread Fear — hero may only use 1 attack die; breaks on mind-roll 6 |
| asleep | Hero | Dread Sleep — hero cannot act or defend; breaks on mind-roll 6 |
| commanded | Hero | Dread Command — hero acts for Zargon; breaks on mind-roll 6 |
| paralyzed | Hero | Dread Cloud of Dread — hero cannot act or defend; breaks on mind-roll 6 |
| dazed | Hero | Dread Tempest — hero skips next turn; clears automatically |
| sleeping | Monster | Sleep spell active; wake check each Zargon turn |
| stunned | Monster | Tempest — loses next Zargon turn |
| personality | Monster | 'predator' \| 'aggressor' \| 'methodical' — assigned at spawn |
| dreadSpells | Monster | Spell ids this monster can cast (assigned by quest notes) |
| dreadSpellsUsed | Monster | Spent spell ids — one-shot per quest |
| summonKind | Monster | Undead kind summoned by ds_summon_undead (default: skeleton) |
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
| 10 | Dread spell system — 12 Zargon caster spells with status effects, LOS targeting, summons, and mind-point break mechanic | ✅ implemented |

## Dread spells (12 cards — Zargon's spellcaster deck)

Cards transcribed from physical cards. Two numbers flagged ⚠️ need user confirmation.

**Mind-point break mechanic (shared by Fear, Sleep, Cloud of Dread, Command):**
At the start of their turn (or immediately when noted), the affected hero rolls 1 red die per Mind
Point they have. If any die shows a 6, the spell is broken and removed.

| Spell | Target | Effect |
|---|---|---|
| **Ball of Flame** | one hero | 2 BP damage to the hero with the **lowest remaining BP** in LOS. Hero rolls 2 red dice — each **6** (only) reduces damage by 1. Caster will not cast if no hero is in LOS. |
| **Lightning Bolt** | line (H/V/diagonal) | Travels in a straight line until hitting a wall or closed door. Inflicts 2 BP on every hero and monster in its path. |
| **Firestorm** | whole room | 3 BP damage to all heroes AND monsters in the same room as caster (caster unaffected). Each victim rolls **1 red die** — a **6** reduces damage by 1. **Cannot be used in corridors.** Caster AI will not cast if there are more monster allies than heroes in the room. |
| **Rust** | one hero's item | Destroys the **best weapon (highest attack dice)** in the party (non-artifact). Targets the visible hero carrying it. Helmets are targeted if no weapons are available. |
| **Fear** | one hero | Hero may only use **1 Attack die total** (ignores all bonuses — Courage, Strength potion, etc.). Breaks via mind-point roll (6) on any future turn. |
| **Sleep** | one hero | Hero cannot move, attack, or defend. **Breaks via mind-point roll: 1d6 per Mind Point** — any 6 breaks free. Checked at start of each hero's turn. |
| **Tempest** | one hero | Target hero misses their next turn (whirlwind). |
| **Command** | one hero | Hero is under Zargon's control. AI targets the hero with the **lowest Mind Points** (hardest to break free). On the **commanded hero's own turn**: they roll mind-break first — if freed they act normally that turn; if still bound the turn is forfeit. On Zargon's turn the hero moves and attacks allies. |
| **Cloud of Dread** | all heroes in same room/corridor | All heroes in the same space are paralyzed — cannot move, attack, or defend. Each breaks independently via mind-point roll (6) immediately or any future turn. |
| **Summon Orcs** | self (protect caster) | Roll 1d6 — lookup: **1-3 → 4 orcs, 4-5 → 5 orcs, 6 → 6 orcs**. Placed BFS outward from caster. |
| **Summon Undead** | self (protect caster) | Roll 1d6 — composition lookup: **1-3 → 4 skeletons; 4-5 → 3 skeletons + 2 zombies; 6 → 2 zombies + 2 mummies**. Placed BFS outward from caster. |
| **Escape** | self | Caster vanishes instead of dying or when badly hurt (≤25% BP). **Auto-triggers when the caster would receive a killing blow** — no gold, no kill credit. One-shot per quest. |

**Design decisions (confirmed):**

1. **Which monsters cast** — Quest-book driven. Each quest's notes designate which specific monster(s)
   carry Dread spells and which cards they have access to. Many quests will have no Dread spells at all.

2. **Casting timing / rules** — Quest-book driven. The quest notes specify when and how the spellcaster
   may use their spells (e.g. instead of attacking, once per turn, etc.).

3. **Summon placement** — BFS outward from caster. Adjacent empty cells filled first; expands outward
   if all adjacent cells are occupied. Same rule for both Orcs and Undead.

4. **Summon count / composition** — Determined by d6 lookup table (not roll = count directly).
   See the table rows for Summon Orcs / Summon Undead above for exact mappings.

## Pending / blocked work

- **#65** Chest/furniture trap model — needs quest-driven trap data
- **#69** Between-quests economy (rulebook p.22) — user to share the page
- **#71** Quest engine + Quests 2–14 — blocked on #69
- **#74** ✅ Dread spell system (12 spells) — **implemented**. Artifact system still pending.
- **#74b** Artifact system (14 items) — pending (needs quest book data)
- **#77** Apply placement ruleset to Quests 2–14
