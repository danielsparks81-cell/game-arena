# Big Heroes — special power card text (canonical)

Transcribed verbatim from the user's `Big Heroes.pdf` (2026-06-14). These are the
SPEC for the engine. Implement against this wording, not memory.

## Nilfheim — Ice Shard Breath (Special Attack)
> Range 5. Attack 4. When Nilfheim attacks with his Ice Shard Breath Special
> Attack, he may attack 2 additional times. He cannot attack the same figure
> more than once.

- Normal special attack: 3 attacks total (1 + 2 extra), each Range 5 / Attack 4.
- Each attack must target a DIFFERENT figure (no figure twice in the same turn).
- Each is a normal attack roll (defender rolls defense; height advantage applies).

## Braxas — Poisonous Acid Breath
> Instead of attacking, you may choose up to 3 different small or medium figures
> within 4 clear sight spaces of Braxas. One at a time, roll the 20-sided die for
> each chosen figure. If the chosen figure is a Squad figure and you roll an 8 or
> higher, destroy it. If the chosen figure is a Hero figure and you roll a 17 or
> higher, destroy the chosen Hero.

- "Instead of attacking" → an alternative to the normal attack action.
- Up to 3 DIFFERENT small/medium figures (baseSize 1 AND height ≤ 4 ⇒ small/medium;
  large/huge excluded), each within range 4 + clear line of sight.
- Per target: d20; Squad ≥ 8 destroy, Hero ≥ 17 destroy. No defense roll, no wounds
  — instant destroy on success (a Hero with >1 life is destroyed outright).

## Theracus — Carry
> Before moving Theracus, choose an unengaged friendly small or medium figure
> adjacent to Theracus. After you move Theracus, place the chosen figure adjacent
> to Theracus.

- Pre-move choice: an UNENGAGED, FRIENDLY (allied), small/medium figure adjacent to
  Theracus. After Theracus moves, the carried figure is placed adjacent to its new
  position (player picks which adjacent empty space).

## Major Q9 — Queglix Gun (Special Attack)
> Range 8. Attack 1, 2 or 3. Major Q9 starts each turn with 9 attack dice. Choose
> any figure within range and attack by rolling 1, 2 or 3 attack dice. Major Q9 may
> keep making special attacks with 1, 2 or 3 attack dice until he has rolled all 9
> attack dice. Major Q9 may target the same or different figures with each attack.

- A 9-die pool for the turn. Each shot: pick a figure within Range 8 + LOS, spend
  1/2/3 dice as that attack's value. Repeat until all 9 spent (or stop early).
- Same or different targets allowed. Each shot is a normal attack (defender rolls).

## Jotun — Wild Swing (Special Attack)
> Range 1. Attack 4. Choose a figure to attack. Any figures adjacent to the chosen
> figure are also affected by the Wild Swing Special Attack. Roll attack dice once
> for all affected figures. Each figure rolls defense dice separately. Jotun cannot
> be affected by his own Wild Swing Special Attack.

- Range 1 (adjacent target), Attack 4. The chosen target AND every figure adjacent
  to that target are affected (splash), EXCEPT Jotun himself.
- Roll the 4 attack dice ONCE; every affected figure rolls its own defense against
  that same skull count. Friendly fire applies (splash can hit allies).

## Jotun — Throw 14
> After moving and before attacking, choose one small or medium non-flying figure
> adjacent to Jotun. Roll the 20-sided die. If you roll a 14 or higher, you may
> throw the figure by placing it on any empty space within 4 spaces of Jotun. The
> figure must land within clear sight of Jotun. After the figure is placed, roll the
> 20-sided die for throwing damage. If you roll an 11 or higher, the thrown figure
> receives 2 wounds. If the figure is thrown onto a level higher than the height of
> Jotun or onto water, do not roll for throwing damage. The thrown figure does not
> take any leaving engagement attacks.

- After moving, before attacking: choose a small/medium NON-flying figure adjacent
  to Jotun (any owner). d20 ≥ 14 → may throw to an empty space within 4 of Jotun,
  landing space must be in clear sight of Jotun.
- Then d20 ≥ 11 → 2 wounds. EXCEPTION: if the landing space's level (elevation) is
  higher than Jotun's height, or is water, skip the damage roll (no wounds).
- The thrown figure takes no leaving-engagement attacks.
