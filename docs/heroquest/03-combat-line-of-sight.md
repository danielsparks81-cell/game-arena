# 3. Combat & line of sight

*Rulebook pages 12–14, 20–21.*

## The combat dice ✓

- Combat is resolved with **white six-sided combat dice**. Each die has **6 faces:
  3 skulls, 2 white shields, 1 black shield**. ✓ `DIE_FACES` in `types.ts`.
- **Skull** = a hit. **White shield** = a *hero's* successful defense. **Black shield** =
  a *monster's* successful defense.

## How a hero attacks (Action 1) (p12–13)

- Attack a monster you are **adjacent** to. **Adjacent = directly to the side, front, or
  rear** — the **4 orthogonal squares**. Diagonal is **not** adjacent unless your weapon
  grants it (see special weapons). ✓
- **One attack per turn**, with **one weapon**. ✓
- Roll **Attack dice** equal to your weapon's value. **Each skull = 1 hit.** No skulls =
  the attack fails. ✓
- The defender **immediately defends** (see below). **Damage = skulls − shields blocked**
  (minimum 0). Each unblocked hit = **1 Body Point**. ✓ (`Math.max(0, atk.skulls -
  def.blocks)`.)
- A monster reduced to **0 Body = dead**, removed from the board. Multi-Body monsters
  track damage with **skull tiles**. ✓
- A monster that **survives** a hero's attack **cannot strike back until Zargon's turn**
  (no immediate counterattack). ✓

## How a monster attacks (p20)

- A monster attacks an **adjacent** hero (orthogonal), **once per turn**. Its attack
  strength is **innate** (from the monster chart), not weapon-based. ✓
- Roll the monster's Attack dice; no skulls = failed attack. The hero then defends. ✓

## How a hero defends (p21) ✓

- A defending hero rolls **2 Defend dice** by default. Each **white shield blocks 1 hit**.
  ✓
- Modifiers: **fewer** dice in a pit (−1, min 1) or under certain spells; **more** after
  buying armor. ◑ Armor/spell modifiers depend on equipment/spell cards (roadmap); the
  **−1-in-a-pit** rule is currently **not** applied (see [section 5](./05-traps.md) and
  open questions).
- A monster defends with its **Defend dice**, counting **black shields**. ✓

## Weapons: ranged & diagonal (p14)

Most weapons only attack an **orthogonally adjacent** target. Some are special:

- **Ranged** ("attack from a distance"): **dagger** and **crossbow**. Require **line of
  sight** to the target (no adjacency needed). ◑ Engine supports a `ranged` item flag +
  LOS; confirm which items carry it.
- **Diagonal**: **staff** and **longsword**. Attack & defend resolve normally, but you may
  strike a **diagonal** neighbor. A staff-wielding wizard can hit a monster diagonally
  while the monster **cannot** hit back diagonally (a "safe" position), and diagonal
  weapons let **multiple heroes gang up** on a monster blocking a doorway. ◑ Engine
  supports a `diagonal` item flag; confirm assignments (staff, longsword).
- Full weapon/armor stats live on the **equipment cards** (❓ not in this PDF).

## Line of sight (character view) — for spells, ranged & diagonal targeting (p14) ★

This is the **targeting** mechanic (distinct from "looking/revealing" in
[section 2](./02-turns-movement-looking.md)).

> **Rule of thumb (rulebook):** draw a straight line from the **center of the attacker/
> caster's square** to the **center of the target's square**. The target is **visible**
> unless the line **crosses a wall, a closed door, a hero, or a monster**. The target is
> still visible **even if the line just touches a corner or wall edge** — grazing a
> corner does **not** block.

- ✓ Implemented as `hasLineOfSight` (lenient diagonal: a diagonal step is blocked only if
  **both** corner edges are walls). Open doors are see-through; closed doors block.
- Figures (heroes/monsters) **block** LOS as intermediate cells; the **target itself**
  never blocks (it's the endpoint).
- **Used by:** ranged attacks, diagonal attacks beyond adjacency, and **all spell
  targeting**.

### Targeting must be validated server-side ✓

- **Melee attack** needs **adjacency** (orthogonal), *not* LOS — don't gate melee on LOS.
- **Ranged attack** needs `ranged` weapon **and** `hasLineOfSight`.
- **Spell** on another hero or a monster needs `hasLineOfSight`; **self-casts and area
  spells need none**.
- The UI only highlights **valid** targets (visible monsters for attack spells;
  self + visible allies for healing spells; melee-adjacent / ranged-visible monsters for
  attacks), and the engine **re-checks** before spending the action. ✓
