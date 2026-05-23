# Legendary Base Set — Card Registry (Source of Truth)

This file is the permanent reference for every hero card in the base set.
**Do not edit hero `.ts` files without cross-checking this registry first.**
Once a hero class is marked ✅ Verified it must not change without explicit confirmation.

Stats key: `★` = Recruit  `⚔` = Strike/Attack  `+` = scales with effects  `—` = no stat

---

## S.H.I.E.L.D. Starters

These cards never appear in HQ. Troopers and Agents are starting-deck cards.
Officer and Sidekick are always-available pool purchases.

| Card | Cost | Class | Team | Recruit | Strike |
|------|------|-------|------|---------|--------|
| S.H.I.E.L.D. Trooper | 0 | — | shield | — | 1 |
| S.H.I.E.L.D. Agent | 0 | — | shield | 1 | — |
| S.H.I.E.L.D. Officer | 3 | — | shield | 2 | — |
| Sidekick | 2 | — | none | — | — |

> `className: 'Maria Hill'`, `cardName: 'S.H.I.E.L.D. Officer'`. She is still treated as a hero for all game checks via `kind: 'hero'` and `teams: ['shield']` — className does not affect those checks.

Status: ✅ Verified

---

## Black Widow

**Team:** Avengers | **Classes:** Covert, Tech | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Mission Accomplished | 5 | 2 | Tech | — | — | Draw a card. [tech]: Rescue a Bystander. |
| Dangerous Rescue | 5 | 3 | Covert | — | 2 | [covert]: You may KO a card from your hand or discard pile. If you do, rescue a Bystander. |
| Covert Operation | 3 | 4 | Covert | — | 0+ | You get +1⚔ for each Bystander in your Victory Pile. |
| Silent Sniper | 1 | 7 | Covert | — | 4 | Defeat a Villain or Mastermind that has a Bystander (for free — no Attack cost). |

Status: ✅ Verified

---

## Captain America

**Team:** Avengers | **Classes:** Strength, Instinct, Tech, Covert | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Perfect Teamwork | 5 | 4 | Strength | — | 0+ | You get +1⚔ for each color of Hero in your hand. |
| Avengers Assemble! | 5 | 3 | Instinct | 0+ | — | You get +1★ for each color of Hero in your hand. |
| Diving Block | 3 | 6 | Tech | — | 4 | (Hand passive) If you would gain a Wound, reveal this card and draw a card instead. |
| A Day Unlike Any Other | 1 | 7 | Covert | — | 3+ | [avengers]: You get +3⚔ for each other Avengers Hero you played this turn. |

Status: ✅ Verified

---

## Cyclops

**Team:** X-Men | **Classes:** Strength, Ranged | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Determination | 5 | 2 | Strength | 3 | — | To play this card, you must discard a card from your hand. |
| Optic Blast | 5 | 3 | Ranged | — | 3 | To play this card, you must discard a card from your hand. |
| Unending Energy | 3 | 6 | Ranged | — | 4 | If a card effect makes you discard this card, you may return it to your hand. |
| X-Men United | 1 | 8 | Ranged | — | 6+ | [x-men]: You get +2⚔ for each other X-Men Hero you played this turn. |

Status: ✅ Verified

---

## Deadpool

**Team:** None | **Classes:** Tech, Covert, Instinct, Instinct | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Here, Hold This for a Second | 5 | 3 | Tech | 2 | — | A Villain of your choice captures a Bystander. |
| Oddball | 5 | 5 | Covert | — | 2+ | You get +1⚔ for each other Hero with an odd-numbered [cost] you played this turn. |
| Hey, Can I Get a Do-Over? | 3 | 3 | Instinct | — | 2 | If this is the first Hero you played this turn, you may discard your hand and draw 4 cards. |
| Random Acts of Unkindness | 1 | 7 | Instinct | — | 6 | You may gain a Wound to your hand. Then each player passes a card to the player on their left. |

Status: ✅ Verified

---

## Gambit

**Team:** X-Men | **Classes:** Covert, Ranged, Instinct | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Stack the Deck | 5 | 2 | Covert | — | — | Draw two cards. Then put a card from your hand on top of your deck. |
| Card Shark | 5 | 4 | Ranged | — | 2 | Reveal the top card of your deck. If it's an X-Men Hero, draw it. |
| Hypnotic Charm | 3 | 3 | Instinct | 2 | — | Reveal the top card of your deck. Discard it or put it back. [instinct]: Do the same to each other player's deck. |
| High Stakes Jackpot | 1 | 7 | Instinct | — | 4+ | Reveal the top card of your deck. You get +⚔ equal to that card's cost. |

Status: ✅ Verified

---

## Hawkeye

**Team:** Avengers | **Classes:** Instinct, Tech | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Quick Draw | 5 | 3 | Instinct | — | 1 | Draw a card. |
| Team Player | 5 | 4 | Tech | — | 2+ | [avengers]: You get +1⚔. |
| Covering Fire | 3 | 5 | Tech | — | 3 | [tech]: Choose — each other player draws a card, OR each other player discards a card. |
| Impossible Trick Shot | 1 | 7 | Tech | — | 5 | Whenever you defeat a Villain or Mastermind this turn, rescue 3 Bystanders. |

Status: ✅ Verified

---

## Hulk

**Team:** Avengers | **Classes:** Strength, Instinct | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Growing Anger | 5 | 3 | Strength | — | 2+ | [strength]: You get +1⚔. |
| Unstoppable Hulk | 5 | 4 | Instinct | — | 2+ | You may KO a Wound from your hand or discard pile. If you do, you get +2⚔. |
| Grazed Rampage | 3 | 5 | Strength | — | 4 | Each player gains a Wound. |
| Hulk Smash! | 1 | 8 | Strength | — | 5+ | [strength]: You get +5⚔. |

Status: ✅ Verified

---

## Iron Man

**Team:** Avengers | **Classes:** Tech, Ranged | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Endless Invention | 5 | 3 | Tech | — | — | Draw a card. [tech]: Draw another card. |
| Repulsor Rays | 5 | 3 | Ranged | — | 2+ | [ranged]: You get +1⚔. |
| Arc Reactor | 3 | 5 | Tech | — | 3+ | [tech]: You get +1⚔ for each other Tech Hero you played this turn. |
| Quantum Breakthrough | 1 | 7 | Tech | — | — | Draw two cards. [tech]: Draw two more cards. |

Status: ✅ Verified

---

## Jean Grey

**Team:** X-Men | **Classes:** Ranged, Covert | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Psychic Search | 5 | 3 | Ranged | — | 2 | [x-men]: Rescue a Bystander. |
| Read Your Thoughts | 5 | 5 | Covert | 3+ | — | Whenever you rescue a Bystander this turn, you get +1★. |
| Mind Over Matter | 3 | 6 | Covert | — | 4 | Whenever you rescue a Bystander this turn, draw a card. |
| Telekinetic Mastery | 1 | 7 | Ranged | — | 5+ | Whenever you rescue a Bystander this turn, you get +1⚔. [x-men]: Rescue a Bystander for each other X-Men Hero you played this turn. |

Status: ✅ Verified

---

## Nick Fury

**Team:** S.H.I.E.L.D. (shield-officer) | **Classes:** Tech, Covert, Strength | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| High-Tech Weaponry | 5 | 3 | Tech | — | 2+ | [tech]: You get +1⚔. |
| Battlefield Promotion | 5 | 4 | Covert | — | — | You may KO a S.H.I.E.L.D. Hero from your hand or discard pile. If you do, you may gain a S.H.I.E.L.D. Officer to your hand. |
| Legendary Commander | 3 | 6 | Strength | — | 1+ | You get +1⚔ for each other S.H.I.E.L.D. Hero you played this turn. |
| Pure Fury | 1 | 8 | Tech | — | — | Defeat any Villain or Mastermind whose ⚔ is less than the number of S.H.I.E.L.D. Heroes in the KO pile. |

Status: ✅ Verified

---

## Rogue

**Team:** X-Men | **Classes:** Strength, Covert | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Borrowed Brawn | 5 | 4 | Strength | — | 1+ | [strength]: You get +3⚔. |
| Energy Drain | 5 | 3 | Covert | 2+ | — | [covert]: You may KO a card from your hand or discard pile. If you do, you get +1★. |
| Copy Powers | 3 | 5 | Covert | — | — | Play this card as a copy of another Hero you played this turn. |
| Steal Abilities | 1 | 8 | Strength | — | 4 | Each player discards the top card of their deck. Play a copy of each of those cards. |

Status: ✅ Verified

---

## Spider-Man

**Team:** Spider-Friends | **Classes:** Strength, Instinct, Tech, Covert | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Astonishing Strength | 5 | 2 | Strength | 1 | — | Reveal the top card of your deck. If that card costs 2 or less, draw it. |
| Great Responsibility | 5 | 2 | Instinct | — | 1 | Reveal the top card of your deck. If that card costs 2 or less, draw it. |
| Web-Shooters | 3 | 2 | Tech | — | — | Rescue a Bystander. Reveal the top card of your deck. If that card costs 2 or less, draw it. |
| The Amazing Spider-Man | 1 | 2 | Covert | — | — | Reveal the top three cards of your deck. Put any that cost 2 or less into your hand. Put the rest back in any order. |

Status: ✅ Verified

---

## Storm

**Team:** X-Men | **Classes:** Ranged, Covert | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Gathering Stormclouds | 5 | 3 | Ranged | 2 | — | [ranged]: Draw a card. |
| Lightning Bolt | 5 | 4 | Ranged | — | 2 | Any Villain you fight on the Rooftops this turn gets -2⚔. |
| Spinning Cyclone | 3 | 6 | Covert | — | 4 | You may move a Villain to a new city space. Rescue any Bystanders captured by that Villain. (If space is occupied, swap them.) |
| Tidal Wave | 1 | 7 | Ranged | — | 5 | Any Villain you fight on the Bridge this turn gets -2⚔. [ranged]: The Mastermind gets -2⚔ this turn. |

Status: ✅ Verified

---

## Thor

**Team:** Avengers | **Classes:** Strength, Ranged | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Odinson | 5 | 3 | Strength | 2+ | — | [strength]: You get +2★. |
| Surge of Power | 5 | 4 | Ranged | 2 | 0+ | If you made 8 or more ★ this turn, you get +3⚔. |
| Call Lightning | 3 | 6 | Ranged | — | 3+ | [ranged]: You get +3⚔. |
| God of Thunder | 1 | 8 | Ranged | 5 | 0+ | You can use ★ as ⚔ this turn. |

Status: ✅ Verified

---

## Wolverine

**Team:** X-Men | **Classes:** Instinct | **Distribution:** 5 / 5 / 3 / 1

| Card | Copies | Cost | Class | Recruit | Strike | Ability text |
|------|--------|------|-------|---------|--------|--------------|
| Keen Senses | 5 | 2 | Instinct | — | 1 | [instinct]: Draw a card. |
| Healing Factor | 5 | 3 | Instinct | — | 2 | You may KO a Wound from your hand or discard pile. If you do, draw a card. |
| Frenzied Slashing | 3 | 5 | Instinct | — | 2 | [instinct]: Draw two cards. |
| Berserker Rage | 1 | 8 | Instinct | — | 0+ | Draw three cards. [instinct]: You get +1⚔ for each extra card you've drawn this turn. |

Status: ✅ Verified

---

## Verification log

| Hero | Verified by | Date | Notes |
|------|-------------|------|-------|
| S.H.I.E.L.D. Starters | Dan | 2026-05-22 | className "Maria Hill", cardName "S.H.I.E.L.D. Officer" — confirmed |
| Black Widow | Dan | 2026-05-22 | |
| Captain America | Dan | 2026-05-22 | |
| Cyclops | Dan | 2026-05-22 | |
| Deadpool | Dan | 2026-05-22 | Oddball text: 'cost' word replaced with [cost] symbol |
| Gambit | Dan | 2026-05-22 | Hypnotic Charm: cost 4→3, baseRecruit 2 added |
| Hawkeye | Dan | 2026-05-22 | |
| Hulk | Dan | 2026-05-22 | |
| Iron Man | Dan | 2026-05-22 | |
| Jean Grey | Dan | 2026-05-22 | |
| Nick Fury | Dan | 2026-05-22 | Battlefield Promotion text: "S.H.I.E.L.D. Officer" confirmed |
| Rogue | Dan | 2026-05-22 | |
| Spider-Man | Dan | 2026-05-22 | Web-Shooters & Amazing: no baseRecruit; "If that card costs" wording confirmed |
| Storm | Dan | 2026-05-22 | Spinning Cyclone line 2: "If space is occupied, swap them." confirmed |
| Thor | Dan | 2026-05-22 | |
| Wolverine | Dan | 2026-05-22 | |
