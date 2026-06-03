# Hero spell cards (the 12 elemental spells)

Faithful transcription of the user's hero spell cards (photos, 2026-06-03). The 12 spells
are split into **4 element groups of 3** (cover cards: Fire, Water, Air, Earth). The Wizard
holds 3 groups (9 spells), the Elf 1 group (3). Each spell is cast **once per quest**, then
discarded.

## Air
- **Genie** — cast on a genie that does ONE of: **open any door** on the board (revealing
  what's beyond), OR **attack any monster in your line of sight with 5 combat dice**.
- **Swift Wind** — cast on any one hero (incl. yourself): the next time they move, they
  **roll twice as many red dice** as normal.
- **Tempest** — a small whirlwind envelops **one monster of your choice**; that monster
  **misses its next turn**.

## Water
- **Sleep** — puts **one monster** into a deep sleep: it cannot move, attack, or defend.
  The sleep breaks if the monster is attacked, [or the monster rolls 1 red die per Mind
  Point and breaks free on a 6]. **May not be used against mummies, zombies, or skeletons.**
- **Veil of Mist** — cast on any one hero (incl. yourself): on their next move they may
  **move unseen through spaces occupied by monsters**.
- **Water of Healing** — cast on any one hero (incl. yourself): restores **up to 4 lost
  Body Points** (never above the hero's starting number).

## Fire
- **Ball of Flame** — cast on **one monster**: inflicts **2 Body Points** of damage; the
  monster rolls **1 red die per point of damage**, and **each 5 or 6 reduces the damage by
  1**. (So 0–2 BP through.)
- **Courage** — cast on any one hero (incl. yourself): the next time they attack they roll
  **2 extra combat dice**. The spell breaks once the hero can no longer see a monster in
  line of sight.
- **Fire of Wrath** — cast on **one monster**: inflicts **1 Body Point** of damage, **unless
  the monster immediately rolls a 4, 5, or 6** on 1 red die (then no damage).

## Earth
- **Heal Body** — cast on any one hero (incl. yourself): restores **up to 4 lost Body
  Points** (never above starting).
- **Pass Through Rock** — cast on any one hero (incl. yourself): on their next move they may
  **move through walls**, as many as their dice roll allows. ⚠ If they **end** their move in
  a solid-rock area they are **trapped forever**.
- **Rock Skin** — cast on any one hero (incl. yourself): they roll **1 extra Defend die**.
  The spell breaks when the hero **suffers 1 Body Point of damage**.

## ⚠ Diffs vs our current `SPELLS` (engine corrections needed)

| Spell | Our build | Card | Fix |
|---|---|---|---|
| **Group: Water** | Veil of Mist, **Heal Body (dup)**, Water of Healing | **Sleep**, Veil of Mist, Water of Healing | move Heal Body to Earth only; **add Sleep** |
| **Sleep** | missing | sleep 1 monster; undead-immune | add spell + effect |
| **Genie** | 4 dice attack | **5 dice** OR open a door | bump to 5; add door option |
| **Tempest** | up to 2 adjacent monsters | **one** monster of choice | single target |
| **Veil of Mist** | +10 squares | move **through monsters** next move | change effect |
| **Water of Healing** | 2 BP | **4 BP** | bump to 4 |
| **Ball of Flame** | 2-die attack (skulls) | **2 BP**, monster rolls 1 die/pt, 5–6 reduces | rework |
| **Fire of Wrath** | adjacent, no-defense 1 BP | LOS, 1 BP unless monster rolls **4–6** | rework + LOS |
| **Rock Skin** | +2 def until next turn | **+1** def until **damaged** | −1 die; break-on-damage |
| Courage / Swift Wind / Pass Through Rock / Heal Body | OK-ish | matches | minor wording |

These rework `doCastSpell` and the buff bookkeeping — do as a dedicated pass with tests.
