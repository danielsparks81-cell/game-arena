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
| dreadSpells | Monster | Spell ids this monster can cast (assigned by quest notes — never set by default) |
| dreadSpellsUsed | Monster | Spent spell ids — one-shot per quest; auto-populated by engine on cast |
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

Zargon's equivalent of the hero spell system. Assigned to specific named monsters via quest
notes — **no monster carries Dread spells by default**. Many quests have none at all.
Each spell is one-shot per quest (tracked in `dreadSpellsUsed[]`).

---

### Quest integration

To give a monster Dread spells, add fields to its entry in the quest definition:

```ts
{
  id: 'witch_lord',
  kind: 'gargoyle',          // any monster kind
  dreadSpells: [             // cards this monster holds
    'ds_ball_of_flame',
    'ds_command',
    'ds_escape',
  ],
  dreadSpellsUsed: [],       // always start empty
  // summonKind is no longer needed — Summon Undead uses a fixed composition table
}
```

The engine reads `dreadSpells` at the start of `runMonster` via `chooseDreadSpell`.
The caster checks its remaining spells each Zargon turn **before** deciding to move/attack.
If a usable spell is found it is cast instead; the monster does not also move or attack that turn.

---

### Mind-break mechanic

Applies to: **Fear, Sleep, Command, Cloud of Dread**

At the **start of the affected hero's own turn** (before any action), the hero rolls 1 red die per
Mind Point they have. If **any die shows a 6** the spell breaks immediately and the hero acts
normally that turn. If no 6 is rolled the effect persists and the turn is handled as described
per-spell below.

Heroes with 0 Mind Points can never break free by rolling.

The rolls are resolved in `checkHeroTurnStart(s)`, called from `advanceToNextActiveTurn` and
`finishZargonTurn` before the turn-start log line is written.

| Hero class | Mind Points | Break-free chance per turn |
|---|---|---|
| Barbarian | 2 | 1 − (5/6)² ≈ 31% |
| Dwarf | 2 | ≈ 31% |
| Elf | 3 | 1 − (5/6)³ ≈ 42% |
| Wizard | 4 | 1 − (5/6)⁴ ≈ 52% |

---

### Status effects on heroes

| Status flag | Blocks | Defense | Break mechanic |
|---|---|---|---|
| `feared` | Nothing blocked — hero can still act, but attack is capped at **1 die** regardless of all bonuses | Normal | Mind-break at turn start |
| `asleep` | Move, attack, search, cast spell, open door | **0 defense dice** (auto-take hits) | Mind-break at turn start |
| `commanded` | All hero-initiated actions | Normal | Mind-break at turn start; if freed → acts normally **that same turn** |
| `paralyzed` | Move, attack, search, cast spell, open door | **0 defense dice** | Mind-break at turn start |
| `dazed` | Entire turn skipped (auto-cleared) | Normal | Automatic — clears at turn start |

---

### Complete spell reference

#### Damage spells

**Ball of Flame**
- Target: visible hero with the **lowest remaining BP** (most wounded, most vulnerable)
- Effect: 2 BP damage (automatic, no attack roll)
- Mitigation: target rolls **2d6** — each **6** reduces damage by 1 (min 0)
- AI rule: will not cast if no hero is in LOS — Zargon will not waste the card

**Lightning Bolt**
- Target: straight line in the best direction (H/V/diagonal — 8 options); AI picks the
  direction that hits the most heroes; if tied, picks randomly from tied directions
- Effect: **2 BP** to every hero AND monster in the bolt's path (no mitigation roll)
- Range: travels until it hits a wall or closed door
- Note: can and will hit allied monsters — choose direction carefully

**Firestorm**
- Target: all heroes AND monsters in the **same room** as the caster (caster exempt)
- Effect: **3 BP** damage to each victim
- Mitigation: each victim rolls **3d6** — each **6** reduces damage by 1
  - 0 sixes → 3 BP | 1 six → 2 BP | 2 sixes → 1 BP | 3 sixes → 0 BP (full dodge)
  - Approximate odds: 42% / 42% / 14% / 0.5%
- Restrictions: corridor-only casters cannot use this (no region = `room_*`)
- AI rule: will not cast if **monster allies in the room outnumber heroes** — avoids
  friendly-fire wipeout; equal counts are acceptable (trade ≥ even)

#### Item destruction

**Rust**
- Target: the visible hero carrying the **best weapon** (highest attack dice) in the party
- Effect: permanently destroys that weapon; hero's attack reverts to base + next-best weapon
- Rules: non-artifact weapons only (`kind === 'weapon'`); artifacts are immune
- Fallback: if no weapons are available, targets a **helmet** instead
- AI skips this spell entirely if no visible hero has a metal weapon or helmet

#### Status effects

**Fear**
- Target: one visible hero not already feared
- Effect: hero's attack is hard-capped at **1 die** — ignores base attack, Courage bonus,
  Strength potion, everything. The cap is applied in `doAttack` before any roll
- Duration: until mind-break (6 on any die at turn start)

**Sleep**
- Target: one visible hero not already asleep
- Effect: hero cannot move, attack, search, cast, or open doors; **0 defense dice** vs attacks
- Immediate break attempt: on cast, the target immediately rolls mind-break dice; if they
  roll a 6 they resist the spell entirely and are never asleep
- Duration: until mind-break (6 on any die at turn start)

**Tempest**
- Target: one visible hero not already dazed
- Effect: target loses their **next turn** entirely (dazed flag set)
- Duration: one turn — `dazed` is cleared automatically at the start of that skipped turn
- No mind-break mechanic; cannot be resisted

**Command**
- Target: the visible hero with the **lowest Mind Points** (fewest break-free dice)
- Effect: hero is under Zargon's control
  - On **Zargon's turn**: hero moves toward the nearest free allied hero and attacks them
    (uses hero's own attack stat; allies get normal defense rolls)
  - On the **hero's own turn**: mind-break roll first
    - Rolls a 6 → freed, acts normally **that turn**
    - No 6 → turn forfeit (cannot act at all)
- Duration: until mind-break; can persist multiple rounds

**Cloud of Dread**
- Target: ALL heroes in the **same region** (room or corridor) as the caster
- Effect: each targeted hero is paralyzed — cannot move, attack, search, or cast; **0 defense dice**
- Immediate break attempt: each hero rolls mind-break on cast; heroes who roll a 6 resist
- Each hero breaks independently; the others remain paralyzed
- Duration: until mind-break per hero

#### Summons

Both summon spells use BFS outward placement: adjacent empty cells are filled first; if all
adjacent cells are occupied the BFS expands to the next ring outward, and so on.
Summoned monsters are assigned a random personality at placement.

**Summon Orcs** — roll 1d6, look up count:

| Roll | Orcs summoned |
|---|---|
| 1, 2, 3 | 4 orcs |
| 4, 5 | 5 orcs |
| 6 | 6 orcs |

**Summon Undead** — roll 1d6, look up composition:

| Roll | Undead summoned |
|---|---|
| 1, 2, 3 | 4 skeletons |
| 4, 5 | 3 skeletons + 2 zombies |
| 6 | 2 zombies + 2 mummies |

Higher rolls produce rarer, harder undead. The `summonKind` field on the monster is no longer
used for this spell — composition is fixed by the table above.

#### Self / escape

**Escape**
- Effect: caster is instantly removed from the board (not killed — no gold, no kill credit,
  no win-condition trigger). Heroes cannot pursue.
- Triggers in two situations:
  1. **Proactive** (`chooseDreadSpell`): AI selects Escape when the caster's BP drops to
     **≤ 25%** of its max (badly hurt, likely to die next turn)
  2. **Reactive / auto-escape** (`tryAutoEscape` in `doAttack`): if a hero's attack would
     reduce the caster to 0 BP, Escape fires **instead of death** — the killing blow lands
     but the monster vanishes before dying
- One-shot per quest. Once used (either way), `ds_escape` is in `dreadSpellsUsed` and
  cannot trigger again.
- The proactive threshold and the reactive intercept are independent — a caster at 30% HP
  may not yet trigger proactive Escape, but a single big hit that would kill it still
  activates the reactive auto-escape.

---

### AI spell priority

`chooseDreadSpell` evaluates available spells in this fixed priority order, skipping any whose
preconditions are not met:

1. `ds_cloud_of_dread` — paralysis is the strongest crowd-control; cast first if multiple heroes are nearby
2. `ds_command` — turn a hero into an ally; high value if a powerful hero is reachable
3. `ds_sleep` — neutralise one hero for potentially several rounds
4. `ds_fear` — reliable attack debuff, no precondition failure risk
5. `ds_firestorm` — high damage but risky; skipped if allies outnumber heroes in room or if in corridor
6. `ds_ball_of_flame` — targeted damage; skipped if no hero in LOS
7. `ds_lightning_bolt` — corridor-friendly AoE; always available if at least one hero is hittable
8. `ds_rust` — strips best weapon; skipped if no viable target has a metal weapon/helmet
9. `ds_summon_undead` — reinforcements (powerful composition on high rolls)
10. `ds_summon_orcs` — reinforcements (reliable count)
11. `ds_tempest` — turn denial; useful but lower priority than direct effects
12. `ds_escape` — last resort; only chosen when HP ≤ 25%

---

### Implementation reference

| Function | File | Purpose |
|---|---|---|
| `chooseDreadSpell(s, m)` | engine.ts | AI picks next available spell or returns null |
| `doCastDreadSpell(s, m, id)` | engine.ts | Resolves all 12 spell effects |
| `tryAutoEscape(s, m)` | engine.ts | Intercepts killing blow with Escape; returns true if fired |
| `doCommandedHeroAct(s, h)` | engine.ts | Zargon-turn movement/attack for a commanded hero |
| `checkHeroTurnStart(s)` | engine.ts | Mind-break rolls for all active status effects |
| `summonNearCaster(s, caster, kind, count)` | engine.ts | BFS outward placement for summoned monsters |
| `rollMindD6(mindPoints)` | engine.ts | Rolls N d6, returns dice array + whether any showed 6 |
| `traceRay(s, from, dir)` | engine.ts | Straight-line cell list for Lightning Bolt |

## Pending / blocked work

- **#65** Chest/furniture trap model — needs quest-driven trap data
- **#69** Between-quests economy (rulebook p.22) — user to share the page
- **#71** Quest engine + Quests 2–14 — blocked on #69
- **#74** ✅ Dread spell system (12 spells) — **implemented**. Artifact system still pending.
- **#74b** Artifact system (14 items) — pending (needs quest book data)
- **#77** Apply placement ruleset to Quests 2–14
