# 4. Search, spells & treasure (Actions 2–4)

*Rulebook pages 14–16.*

## Action 2: Cast a spell (p14) ✓/◑

- Only the **Elf** and **Wizard** can cast (they cast **instead of** attacking).
- Cast at **anything you can see** (line of sight — [section 3](./03-combat-line-of-sight.md)),
  on your turn only. Target may be **yourself, another hero, or a monster**.
  - Self-casts need no LOS; targeting an ally or monster requires LOS. ✓ Engine validates
    LOS **before** spending the spell (returns an error rather than wasting it), and the
    UI only highlights eligible targets.
- **Each spell may be cast only once per quest**, then the card is **discarded** for the
  rest of the quest. ◑ Once-per-quest discard tracked per spell; confirm UI shows spent
  spells.
- ❓ Actual spell names/effects come from the 12 spell cards (4 groups × 3) — not in this
  PDF. Needed to finish the spell system.

## Action 3: Search for treasure (p15–16) ◑

- Treasure is found **only in rooms, never corridors**.
- The searched room must be **empty of monsters**.
- A room may be searched by **all four heroes**, but **each hero may search a given room
  only once** (on their own turn). ◑ Confirm we enforce once-per-hero-per-room.
- Searching covers the **whole room** regardless of which square you're on — **do not move
  your figure** when you search.
- **Chest/furniture traps:** if you search a room for treasure **before searching it for
  traps**, you **spring** any chest/furniture trap there (see [section 5](./05-traps.md)).
  → Search traps first.

### What a treasure search yields

- If the **quest notes** specify a **special treasure** for that room, Zargon reads it
  aloud. Special treasure is found **only once, by the first hero** to search that room
  (later searchers get nothing special). ❓ Per-quest data.
- Otherwise, draw a **random treasure card** and resolve it:
  - **Gold / potions / items** → record on your sheet. These cards are **removed from the
    deck until the next quest** (the deck depletes).
  - **Wandering monster** (~half the deck is monsters/hazards) → Zargon places the monster
    (the kind is named in the **quest notes**) **adjacent to the searcher** and it
    **immediately attacks only the searcher**; the hero rolls Defend dice. Afterward the
    monster **stays** and acts normally on Zargon's turns. These cards are **reshuffled**
    back into the deck (reusable).
  - **Hazard** → read the card and follow its directions; also reshuffled.
- ◑ Our treasure system exists but the **wandering-monster / hazard** split and the
  reshuffle-vs-deplete behaviour need to match this (see open questions).

### Gold & the armory

- **Gold may be shared** among heroes and is spent **between quests** at the armory
  (equipment deck). ◑ Roadmap (store between quests).

## More about treasures (p16)

- **Treasure types:** gold coins, magic spells, **artifacts**, **potions**.
- **Artifacts** — special treasures detailed on **artifact cards** (powerful weapons,
  armor, or power items). Finding one may be a **quest objective**. A hero may **give
  artifacts to another hero** on their turn. ❓ Artifact card data not in this PDF.
- **Potions** — drink **at any time** (free, not an action); effects per the card / quest
  notes; **you may drink more than one at once**. You may **hand a potion to an ally**,
  but only on your turn. ◑ Confirm potions are free + stackable in the UI.

## Action 4: Search for secret doors (p16) ◑

- Allowed **only if no monsters are visible** to you.
- Declare the search; Zargon reveals any secret doors in the **room *or* corridor you are
  in** (places a secret-door tile). **Do not move** your figure.
- A secret door **opens** when you move adjacent and declare opening it — this reveals
  what's beyond (place its contents) and **cannot be re-closed**.
- Secret doors are **invisible to looking** — they exist only once searched for. ✓
  `doSearchSecretDoors`. ◑ Confirm the "no monsters visible" gate and room-or-corridor
  scope.
