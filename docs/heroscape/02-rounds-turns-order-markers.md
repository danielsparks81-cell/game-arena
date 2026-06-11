# HeroScape — Rounds, Turns & Order Markers

> Mechanics below are summarized in our own words for digital adaptation — this is not a reproduction of the rulebook text.

*Master Game round/turn engine. Source: rulebook pp. 8–9 (round structure, markers, initiative, turn anatomy) and p. 14 (destroyed cards, end of round/battle, scoring), with scenario round tracks on pp. 19–28.*

## The round at a glance (p. 8–9)

The Master Game is played in **rounds**. A round = **3 turns for each player** (p. 8). Before round 1, the black **Round Marker** is placed on space **"1"** of the chosen scenario's Round Marker Track (p. 8). Every round runs the same four steps, in this fixed order:

| Step | What happens | Who | Choice? |
|---|---|---|---|
| 1 | Place Order Markers (secretly) | All players, simultaneously | Player choice of which cards |
| 2 | Roll for Initiative (d20) | All players, every round | Automatic — highest goes first |
| 3 | Take turns until **every player has taken 3 turns** | Round-robin, passing **left** from the initiative winner | Per-turn choices inside each turn |
| 4 | Advance the Round Marker one space | — | Automatic |

**Notes**
- Step 1 happens **before** step 2: players commit their entire turn schedule for the round *before* knowing who will act first. Engine must enforce this ordering.
- Army selection, drafting, and starting-zone placement happen once, before round 1 — see the setup/army topic file.
- This file covers the **Master Game**. The Basic Game (p. 4) has no rounds, order markers, or initiative: players simply alternate single turns (choose any one card → move → attack), and the first player is whoever rolls the most skulls on **6 combat dice** (re-roll ties).

## Step 1 — Place Order Markers (p. 8–9)

Each player owns exactly **4 Order Markers**:

| Marker | Grants | Meaning |
|---|---|---|
| 1 | Your 1st turn | The card it sits on acts on your first turn this round |
| 2 | Your 2nd turn | …second turn |
| 3 | Your 3rd turn | …third turn |
| X | **Nothing** | Pure decoy/bluff — never grants a turn |

Placement rules:

- Each round, every player places **all four** markers on their own Army Card(s) (p. 8). One turn = the figures of exactly **one** Army Card; the numbered markers pre-commit which card acts on which of your three turns (p. 9).
- **Stacking is legal** (player choice): two or even all three numbered markers may go on the same Army Card (p. 9). No restriction is stated on which card receives the X, including a card that already holds numbered markers.
- Markers are placed **face-down / facing the owner** — the numbers are **hidden information**; opponents can only see *that* markers are on a card, not *which* (p. 9). Example 3 (p. 9) shows the intended texture: one player splits 1/2/3 across three cards with X as a bluff on a fourth; the opponent stacks 2 and 3 on one card.
- **Teammates MAY look at each other's markers** (p. 9) — visibility is per-team, not per-player.
- All players place **simultaneously** by default. Optional competitive variant (p. 9): all roll the d20; the highest roller places ALL of their markers first, then placement passes left until everyone has placed.
- Markers on an Army Card that is **out of play** (all figures destroyed in an earlier round) are illegal: in future rounds its markers return to the owner's pool for other cards (p. 14). Since stacking is unlimited, a player can always place all 4 markers while they have at least one live card.

**Notes**
- Engine: order-marker numbers must be **projected away** from non-teammate clients (send only "card X holds N markers"); reveal them one at a time per the turn anatomy below.
- Engine: the X is read as **mandatory to place** ("you'll place these on your Army Cards" covers all four, p. 8) — do not allow holding it back.
- Bluff value depends on opponents never learning unrevealed numbers — see the destroyed-card rules below for the one case where markers are deliberately never flipped.

## Step 2 — Roll for Initiative (p. 9)

- **Every round**, ALL players roll the 20-sided die. The **highest roller takes the first turn**; play then passes **to the left** (seating order, not roll order). This is automatic — there is no option to defer.
- **Ties for highest:** only the tying players re-roll (repeat until broken).
- **Modifiers persist through re-rolls:** if a special power or Glyph affects the initiative roll, it applies to re-rolls too (p. 9). Known modifiers: Glyph of Dagmar grants **+8** to your initiative roll while one of your figures occupies it (p. 15 — see the glyphs/special-powers topic file); the "Under Tempest's Cover" scenario gives Player 2 **+12** on Round 1 only (p. 23 — see the scenarios topic file).

## Step 3 — Taking turns: the 3-action turn anatomy (p. 9)

Players take turns one at a time, **strict round-robin passing left** starting from the initiative winner, until each player has taken **3 turns** (p. 9). After a player finishes attacking, their turn ends and play passes left (p. 14). On your Nth turn of the round, you resolve your marker **N**. Every turn consists of three actions **in this fixed order**:

| Action | What | Choice? |
|---|---|---|
| 1. Reveal your Order Marker | Flip the marker matching your current turn number (1/2/3) face-up on its Army Card. That card's figures — and only them — act this turn. | Automatic (the placement was the choice) |
| 2. Move figure(s) on that card | Move **any, all, or none** of the card's figures, each up to its Move number. | Player choice, fully optional |
| 3. Attack with figure(s) on that card | Each eligible figure may attack once. | Player choice, optional per figure |

- **Lost turn rule (p. 9):** if ALL figures on the card holding the current marker were already destroyed, the player **loses that turn entirely** — no substitution with another card, no move, no attack with anything. The marker is **not revealed** (p. 14).
- The action order is one-way: you cannot attack and then move, and the movement action completes before the attack action begins (no move-some / attack / move-rest interleaving is provided for; squad figures move one at a time within Action 2 and attack one at a time within Action 3).
- Movement details (elevation costs, water, falling, engagement/passing swipes, double-space figures): see the movement & elevation topic file.
- Attack details (Range, Line of Sight, dice, height advantage, Life/wounds): see 04-combat-range-los-attack.md.

**Notes**
- Engine: a "lost" turn is a hard skip — emit no move/attack opportunities at all, and keep the unrevealed marker hidden from opponents (they can infer it sat on *a* dead card, but never see it).
- Engine: "move none, attack none" is a legal turn (a pure reveal).
- Special powers on cards can override any of this — card text beats the general rules (p. 7).

## Destroyed Army Cards & leftover Order Markers (p. 14)

When the last figure on an Army Card is destroyed (wounds = Life — see 04-combat-range-los-attack.md), the card is **out of play**:

- **This round:** unrevealed Order Markers on it stay where they are and are **never revealed**; every turn assigned to it is **lost** (skipped per the lost-turn rule above). Worked example (Example 17, p. 14): Syvarris is destroyed with a marker still on his card — that turn is simply skipped this round.
- **Future rounds:** the markers return to the owner's pool at marker-placement time; no markers may be placed on the dead card and no turns may ever be taken for it.
- The destroyed figures themselves are placed on their Army Card (p. 14) — the card stays visible for scoring/bookkeeping but grants nothing.

**Notes**
- Destruction timing matters: the lost-turn rule triggers if the card's figures were destroyed *before its marker comes up* — even earlier in the same round. There is no refund or reassignment mid-round.
- Engine: when a player's last live card dies, all their remaining turns this round are lost; whether the *game* ends is the scenario's victory condition, not a core rule.

## Step 4 / End of round (p. 8, 14)

- The round ends after the **last player's third turn**.
- If nobody has won, advance the Round Marker **one space** on the scenario's Round Marker Track (automatic, p. 8), then begin the next round at Step 1 (place markers → roll initiative → …).
- Scenarios attach triggers to "end of round": e.g., reinforcement d20 rolls ("Winter Holdout", p. 21), rising-gas wounds ("A Toxic Mist", p. 25), and end-of-round victory checks ("Mimring's Fortress", p. 27). See the scenarios topic file.

## End of battle & scoring (p. 14)

- **Victory conditions come from the Game Scenario**, not the core rules. Most are immediate ("the moment X happens, you win").
- **Optional timer (house rule offered by the rulebook):** players may agree in advance that if no one has won after a set number of rounds, the player/side with the **most points wins** via Scoring.
- **Scoring (p. 14):** each player/team scores, for **every Army Card with at least one of its figures still on the battlefield**, the **full point value printed on the card** — even if only one figure of a Squad survives. **No pro-rating.** Cards with zero surviving figures score 0.

| Situation | Score for that card |
|---|---|
| All figures alive | Full printed Points |
| Some destroyed, ≥1 squad figure survives | Full printed Points (no reduction) |
| All figures destroyed | 0 |

⚠ The rulebook gives no tiebreaker if both sides have equal points at a round limit. (One scenario, "A Toxic Mist" p. 25, explicitly rules a simultaneous mutual wipeout as *no winner* — but that is scenario text, not a general rule.)

## Round Marker Tracks in scenarios (pp. 19–28, cross-reference only)

Each printed scenario carries its own Round Marker Track, which doubles as a **hard round limit** for the Master Game scenarios — at the end of the final round the battle ends and most-points-remaining wins per Scoring above. Track lengths in this rulebook:

| Track length | Scenarios |
|---|---|
| 12 rounds | "Clashing Fronts" (p. 19), "Winter Holdout" (p. 21), "Under Tempest's Cover" (p. 23), "To Take Barrenspur" (p. 28) |
| 8 rounds | "A Desperate Rescue Attempt", "A Toxic Mist" (p. 25) |
| 6 rounds | "Mimring's Fortress" (p. 27) |

Full per-scenario victory conditions, special rules, and timeout-win wording: see the scenarios topic file.

## Open questions

- ⚠ Unrevealed markers at end of round: the rulebook never says whether markers (including X) are shown to opponents when the round ends, or silently retrieved. For bluff integrity we read them as **never revealed** unless flipped by the turn anatomy; the lost-turn case (p. 14) explicitly keeps them unrevealed, which supports this reading.
- ⚠ No general tiebreaker exists for equal Scoring totals at a round limit (see above).
- ⚠ The strict-round-robin reading of Step 3 (A1 B1 C1 A2 B2 C2 …) is the natural reading of "players take turns one at a time… play passes to the left" (p. 9, 14); the rulebook never illustrates a 3+ player turn sequence explicitly.
