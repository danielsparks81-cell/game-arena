# The Armory — equipment for buying between quests

Faithful transcription of the user's **Armory** card (the between-quests shop). Heroes spend
gold earned in quests on these items; unlimited stock. Source: photo provided 2026-06-03.

## Items

| Item | Cost | Type | Effect | Restrictions |
|---|---|---|---|---|
| **Dagger** | 25 | Weapon | Attack **1** die. Can be **thrown** at any monster you can "see" — but is **lost once thrown**. | — |
| **Staff** | 100 | Weapon | Attack **1** die. Length lets you **attack diagonally**. | **No shield** while using it. |
| **Helmet** | 125 | Armor | **+1** Defend die. | Not the **Wizard**. |
| **Shortsword** | 150 | Weapon | Attack **2** dice. | Not the **Wizard**. |
| **Shield** | 150 | Armor | **+1** Defend die. | Not with the **Battle Axe** or **Staff**. Not the **Wizard**. |
| **Broadsword** | 250 | Weapon | Attack **3** dice. | Not the **Wizard**. (Shield IS allowed — not two-handed.) |
| **Tool Kit** | 250 | Tool | **50% chance** to disarm any searched-for-and-found (but unsprung) trap. | — |
| **Longsword** | 350 | Weapon | Attack **3** dice. Length lets you **attack diagonally**. | Not the **Wizard**. |
| **Crossbow** | 350 | Weapon | Attack **3** dice. **Ranged** — fire at any monster you can "see"; **cannot fire at an adjacent** monster. Unlimited arrows. | Not the **Wizard**. |
| **Battle Axe** | 450 | Weapon | Attack **4** dice. | **No shield** while using it. Not the **Wizard**. |
| **Chain Mail** | 500 | Armor | **+1** Defend die. Combines with **Helmet** and/or **Shield**. | Not the **Wizard**. |
| **Bracers** | 550 | Armor | **+1** Defend die. Combines with **Helmet** and/or **Shield**. | **(none — the Wizard CAN wear these; leather, not metal.)** |
| **Plate Mail** | 850 | Armor | **+2** Defend dice. Combines with **Helmet** and/or **Shield**. | **Movement: only 1 red die** while worn. Not the **Wizard**. |

> **Bracers** appear on a separate armor card (not on the summary Armory card). They are the
> **only armor the Wizard may wear** — hardened leather, so the no-metal-armor rule doesn't
> apply. +1 Defend die, stacks with Helmet/Shield.

## Key mechanics

- **Wizard** may use **only the Dagger and the Staff** — no other weapons and **no armor**
  (consistent with the rulebook: the Wizard can't wear normal armor or use large weapons).
- **Shield** can't be combined with the **Battle Axe** or the **Staff** (both two-handed).
  The **Broadsword** and **Longsword** do **not** block a shield.
- **Body armor** is one of Chain Mail (+1) *or* Plate Mail (+2); either may stack with
  **Helmet (+1)** and **Shield (+1)**. Max defense bonus = Plate + Helmet + Shield = **+4**
  (a barbarian's 2 Defend dice → 6).
- **Plate Mail movement penalty:** the book says "only 1 red die." 🎲 **Decided:** under our
  **3d4** house rule, Plate Mail = **roll 1 fewer d4 → 2d4** while worn. The item card states
  "roll 1 less d4." (Borin's Armor artifact has **no** penalty.)
- **Crossbow / thrown Dagger** are ranged (need line of sight). Crossbow **cannot** target
  an adjacent monster; the thrown Dagger is a one-shot (lost after throwing).
- **Tool Kit** = 50% disarm — matches our `doDisarmTrap` odds for non-Dwarves.

## Cross-check vs our current items (`content.ts`)

| Item | In code? | Action |
|---|---|---|
| Dagger | ✓ (`attack 1`) | add `cost 25`; optional thrown-once flag |
| Staff | ✓ (`attack 1, diagonal`) | add `cost 100` + **no-shield** (mark two-handed) |
| Shortsword | ✓ (`attack 2`) | add `cost 150` |
| Broadsword | ⚠ (`attack 3, twoHanded:true`) | **remove twoHanded** (broadsword allows a shield); add `cost 250` |
| Tool Kit | ✓ (just added) | add `cost 250` |
| Helmet | ✗ | add: armor +1, cost 125 |
| Shield | ✗ | add: armor +1, cost 150 (no axe/staff) |
| Longsword | ✗ | add: weapon attack 3, diagonal, cost 350 |
| Crossbow | ✗ | add: weapon attack 3, ranged, cost 350 (not adjacent) |
| Battle Axe | ✗ | add: weapon attack 4, no-shield, cost 450 |
| Chain Mail | ✗ | add: armor +1, cost 500 |
| Plate Mail | ✗ | add: armor +2, cost 850 (move penalty) |

## Still needed (the rest of the card faces)

Artifacts, Dread spells, the treasure deck, and the hero spell cards remain. The **armory**
unblocks the equipment half of the **store-between-quests** feature (which also needs the
rulebook **page 22** between-quests flow).

---

## Update — additional equipment cards (batch 2)

The individual equipment cards reveal items beyond the summary Armory card:

| Item | Cost | Type | Effect | Restrictions |
|---|---|---|---|---|
| **Handaxe** | 200 | Weapon | Attack **2** dice. Can be **thrown** at any monster in line of sight — **lost once thrown**. | **(none stated — the Wizard CAN use it!)** |
| **Potion of Speed** | 200 | Potion | Drink **any time**: **roll twice as many** movement dice on your next move. One use, then discarded. | — |
| **Holy Water** | 400 | Potion | Use **instead of attacking**: instantly **kills any one undead** (skeleton / zombie / mummy). One use, then discarded. | — |

- **Handaxe** has **no Wizard restriction** on its card (like the Dagger and Staff) — so the
  Wizard's usable weapons are **Dagger, Handaxe, Staff**. Three throwable/light options.
- **Two throwable weapons** now: Dagger (1 die) and Handaxe (2 dice) — both ranged via LOS,
  both lost after one throw. Crossbow is the unlimited ranged option (can't fire adjacent).
- ⚠ Our **treasure-deck** "Holy Water" placeholder (heal 4) clashes with the real
  **equipment** Holy Water (kill-undead). Renamed the placeholder; the real treasure deck
  still replaces all of those when its scans arrive.
- The weapon cards otherwise **confirm** Staff/Crossbow/Dagger/Shortsword/Broadsword/
  Longsword/Battle Axe exactly as captured above.

## Deck cover cards
Confirmed the four draw decks (cover art only): **Treasure**, **Dread Spell**, **Equipment**,
**Artifact** — plus a Zargon card. No rules text; confirms the deck taxonomy we're filling.
