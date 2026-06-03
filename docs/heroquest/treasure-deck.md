# The Treasure deck (24 cards)

Faithful transcription of the full treasure deck (photos, 2026-06-03 — two shots of 12 = 24).
Drawn when a hero searches a monster-free room for treasure with no quest-specific treasure.

## Return rule (★ matches rulebook p.15)
- **Wealth & potions** say *"Do not return this card to the deck"* → **removed** for the rest
  of the quest (the deck depletes).
- **Hazards & Wandering Monsters** say *"Return this card to the bottom of the deck"* →
  **reused** within the quest.
- So **10 of 24** (4 hazards + 6 wandering) cycle; **14** (8 wealth + 6 potions) are one-shot.
  "Almost half are wandering monsters and hazards" ✓.

## Composition

| Card | Qty | Effect | Return? |
|---|---|---|---|
| **Gold!** (loose stone / leather pouch) | 2 | **25 gold** | removed |
| **Gold!** (old rags / fur robes) | 2 | **15 gold** | removed |
| **Jewels!** (velvet-lined box) | 2 | **50 gold** | removed |
| **Gem!** (in an old boot) | 2 | **35 gold** | removed |
| **Potion of Healing** | 3 | drink any time: heal **= roll 1 red die** (not above starting BP), once | removed |
| **Potion of Strength** | 1 | drink any time: **+2 Attack dice** next attack, once | removed |
| **Potion of Defense** | 1 | drink any time: **+2 Defend dice** next defend, once | removed |
| **Heroic Brew** | 1 | drink before attacking: **make two attacks** instead of one, once | removed |
| **Hazard!** (hidden arrow) | 2 | **−1 BP, turn over** | return to bottom |
| **Hazard!** (pit / stone gives way) | 2 | fall in a shallow hole: **−1 BP, turn ends**; climb out & move normally next turn | return to bottom |
| **Wandering Monster** | 6 | Zargon places the **quest's wandering monster** on any square next to you; **it attacks immediately** | return to bottom |
| **Total** | **24** | | |

## ⚠ vs our current deck (`buildTreasureDeck`) — task #66

Our deck is invented (gold 75/100/50/25, gems 50/75, 3 heal potions, 2 generic hazards,
3 wandering). To make it faithful:
- **Composition** → the 24 cards above (exact counts, gold values, two hazard flavors).
- **Return logic** → hazards & wandering go to the **bottom of the live deck**; wealth &
  potions are **removed** (don't reshuffle them back). Our `resolveTreasureCard` currently
  discards potions/hazards into a pile that only reshuffles when the deck empties — change to
  return-to-bottom for hazard/wandering and remove the rest.
- **Potion of Healing** heals **1d6** (random), not a fixed amount.

## Consumable potions = a held-item system (new task)

Potion of Strength / Defense / Heroic Brew (treasure) and Potion of Speed / Holy Water
(equipment) are **not** auto-applied — the hero **keeps** them and **drinks at will** (any
time, one use). Today `resolveTreasureCard` auto-applies heal potions on draw. Faithful
behaviour needs a **consumables inventory** + a "drink potion" action, with effects:
heal-1d6, +2 attack (next attack), +2 defend (next defend), two-attacks (Heroic Brew),
double-move (Potion of Speed), kill-undead (Holy Water). Queued as its own pass.
