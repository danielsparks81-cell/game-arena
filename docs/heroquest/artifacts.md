# Artifact cards (the 14 artifacts)

Faithful transcription of all 14 artifact cards (photos, 2026-06-03). Artifacts are special
treasures found in quests (kept behind Zargon's screen until discovered). Many are named as
quest objectives/rewards — see the quest cross-reference.

## Weapons

- **Wizard's Staff** — glows with soft blue light; **only the Wizard** may use it: **2 Attack
  dice** + attack **diagonally**. *(Quest 12 reward.)*
- **Fortune's Longsword** — **3 Attack dice**, attack **diagonally**; **once per quest** the
  hero may use its power to **reroll 1 Attack die**. Not the Wizard.
- **Phantom Blade** — an ornate dagger, **1 Attack die**; **once per quest**, when attacking
  with it, **the target may not defend** (passes through armor).
- **Orc's Bane** — a magical shortsword, **2 Attack dice**; **may attack twice when attacking
  an orc**. Not the Wizard. *(Quest 11.)*
- **Spirit Blade** — a magical broadsword (bone handle), **3 Attack dice**, or **4 vs an
  undead** monster (skeleton/zombie/mummy). Not the Wizard. *(Quest 13 reward → the only
  thing that harms the Witch Lord in Quest 14.)*

## Armor

- **Borin's Armor** — magical plate mail: **+2 Defend dice**, and unlike normal plate mail it
  **does NOT slow the wearer**. Combines with helmet and/or shield. Not the Wizard. *(Q7.)*
- **Wizard's Cloak** — shimmering runed cloak; **only the Wizard** may wear it: **+1 Defend
  die**. *(Quest 6 reward — Grak wears it.)*

## Rings & worn items

- **Ring of Fortitude** — raises a hero's **Body Points by 1**.
- **Talisman of Lore** — increases **Mind Points by 1** while worn. *(Quest 5 objective.)*
- **Spell Ring** — lets a hero **cast one stored spell twice** per quest (not simultaneously);
  at quest start the wearer declares which spell is stored. *(Quest 14 reward — Witch Lord.)*
- **Ring of Return** — when invoked, **returns all heroes the wearer can see to the quest's
  starting point**. One use. *(Quest 10.)*

## Other

- **Wand of Magic** — lets a hero **cast two separate, different spells on their turn**
  instead of one. *(Quest 8 reward.)*
- **Rod of Telekinesis** — **once per quest**, **trap a monster** in magical force: it
  **misses its next turn**, unless it resists (rolls 1 die per Mind Point; a 6 resists).
- **Elixir of Life** — a bottle of pearly liquid: **brings a dead hero back to life**,
  restoring **all** of their Body and Mind Points. **One use.** *(Quest 9.)*

## Quest cross-reference

| Artifact | Quest | Role |
|---|---|---|
| Talisman of Lore | 5 | objective |
| Wizard's Cloak | 6 | reward (Grak) |
| Borin's Armor | 7 | found (weapons room) |
| Wand of Magic | 8 | reward (Balur) |
| Elixir of Life | 9 | found (poison chest) |
| Ring of Return | 10 | found (Dread warriors) |
| Orc's Bane | 11 | reward (Dread warrior) |
| Wizard's Staff | 12 | found (bookcase) |
| Spirit Blade | 13 | objective → unlocks 14 |
| Spell Ring | 14 | reward (Witch Lord) |
| Ring of Fortitude, Fortune's Longsword, Rod of Telekinesis, Phantom Blade | — | generic treasure finds |

## Implementation notes (artifact system — dedicated pass)

Most artifacts are passive stat mods (Ring of Fortitude +1 Body, Talisman +1 Mind, Wizard's
Cloak +1 Defend, the weapon/armor artifacts) — straightforward once equip/stat logic exists.
The **active** ones need new mechanics: once-per-quest reroll (Fortune's Longsword),
ignore-defense (Phantom Blade), attack-twice-vs-orc (Orc's Bane), conditional dice vs undead
(Spirit Blade), revive (Elixir of Life), cast-two-spells (Wand of Magic), store-a-spell
(Spell Ring), telekinesis stun (Rod), recall-to-start (Ring of Return). These tie into the
artifact + equip system and the Witch-Lord invulnerability rule (only Spirit Blade harms him).
