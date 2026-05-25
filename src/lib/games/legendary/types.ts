// =====================================================================
// Legendary — a Marvel-themed cooperative deckbuilder (Upper Deck clone).
//
// Core loop: 1-5 players take turns drawing 6 cards from their personal
// deck, playing them for Attack/Recruit power, buying heroes from the HQ
// row, fighting villains in the City row, and bashing the Mastermind.
// Win = defeat the Mastermind. Lose = the Scheme's "evil wins" condition
// triggers first (too many escaped villains, captured bystanders, etc.).
//
// This file is the type backbone — engine logic lives in engine.ts,
// card definitions in heroes/* villains/* masterminds/* schemes/*.
// =====================================================================

/** Stable identifier for a card DEFINITION (the printed card). Many physical
 *  cards can share a cardId (e.g. all 5 "S.H.I.E.L.D. Trooper" cards). */
export type CardId = string;

/** Stable identifier for a card INSTANCE (the physical card sitting in some
 *  zone). Unique within a game. Lets the UI track movement of specific cards
 *  through hand → discard → KO etc. without relying on array indices. */
export type CardInstanceId = string;

export type CardInstance = {
  instanceId: CardInstanceId;
  cardId: CardId;
};

// ---------- Card categorization (used by class/team synergy effects) ----------

/** Hero "class" — affects card-text synergies like "+1 Attack for each
 *  other Ranged hero you've played this turn". Same as Legendary's icons. */
export type HeroClass = 'tech' | 'covert' | 'strength' | 'instinct' | 'ranged';

/** Team affiliation — drives effects like "Spider-Friends draw a card". */
export type Team =
  | 'avengers' | 'x-men' | 'spider-friends' | 'fantastic-four'
  | 'shield' | 'shield-officer' | 'shield-agent' | 'shield-trooper'
  | 'hydra' | 'doombot-legion' | 'brotherhood' | 'masters-of-evil' | 'enemies-of-asgard'
  | 'hand' | 'savage-land-mutates' | 'sentinels'
  | 'system'; // for wounds / bystanders / scheme twists / master strikes

// ---------- Card definitions ----------

/** Effects fire as side-effects of game actions (playing a card, defeating a
 *  villain, etc.). Each kind is intentionally atomic so we can author cards
 *  declaratively and the engine resolves them in a single switch. */
export type Effect =
  // Resource bumps for the current turn — the bread and butter.
  | { kind: 'gain_attack'; amount: number }
  | { kind: 'gain_recruit'; amount: number }
  // Card flow
  | { kind: 'draw'; amount: number }
  /** "You may KO a card from your hand (or discard). If you do, +Bonus."
   *  `filter: 'wounds_only'` restricts the choice to Wound cards only.
   *  `sources` defaults to `['hand']`; set to `['hand','discard']` for cards
   *  like Dangerous Rescue that let you pick from either zone. */
  | { kind: 'ko_from_hand'; up_to: number; bonus?: Effect[]; filter?: 'wounds_only' | 'shield_heroes' | 'heroes_only'; mandatory?: boolean; sources?: ('hand' | 'discard')[] }
  /** Nick Fury – Field Promotion bonus: place a new instance of `cardId` directly
   *  into the player's hand (bypassing cost and the discard pile). */
  | { kind: 'gain_card_to_hand'; cardId: CardId; may?: true }
  | { kind: 'discard_from_hand'; up_to: number; bonus?: Effect[]; mandatory?: boolean }
  // Wounds + bystanders
  | { kind: 'gain_wound' }
  | { kind: 'rescue_bystander'; amount: number }
  // "For each X played this turn" scaling (per-card bonuses).
  // `includeSelf: true` counts the card playing this effect; false excludes it.
  | { kind: 'gain_attack_per_class';   cls: HeroClass; bonus: number; includeSelf?: boolean }
  | { kind: 'gain_recruit_per_class';  cls: HeroClass; bonus: number; includeSelf?: boolean }
  | { kind: 'gain_attack_per_team';    team: Team;     bonus: number; includeSelf?: boolean }
  | { kind: 'gain_recruit_per_team';   team: Team;     bonus: number; includeSelf?: boolean }
  /** +1 Attack for each Bystander currently in the playing player's Victory Pile. */
  | { kind: 'gain_attack_per_vp_bystander' }
  /** +N Attack/Recruit per distinct Hero class color present among hero cards
   *  remaining in the player's hand when this fires (after moving this card to
   *  playedThisTurn). E.g. hand has Strength + Ranged + Strength → 2 colors → +2. */
  | { kind: 'gain_attack_per_unique_class_in_hand' }
  | { kind: 'gain_recruit_per_unique_class_in_hand' }
  /** Until the end of this turn, the player may fight ONE villain or mastermind
   *  that has an attached bystander without spending any Attack resource.
   *  The flag resets after the free fight is used or on end-of-turn. */
  | { kind: 'grant_free_bystander_fight' }
  // Conditional class/team/hero-name synergies.
  // `minOthers` = minimum count of that class/team/heroName needed in playedThisTurn
  //   (including self if the card is of that class/team/name, since counts are bumped
  //   before onPlay fires). E.g. "Covert: +1R" on a Tech card → minOthers: 1.
  //   "Covert: +2A" on a Covert card (needs 1 OTHER) → minOthers: 2.
  | { kind: 'if_played_class_this_turn'; cls: HeroClass; minOthers: number; effects: Effect[] }
  | { kind: 'if_played_team_this_turn'; team: Team; minOthers: number; effects: Effect[] }
  /** Checks if you've played at least `minOthers` cards whose className === heroName
   *  (including this card if it shares the name). Used for "Hulk: +3A" synergies. */
  | { kind: 'if_played_hero_this_turn'; heroName: string; minOthers: number; effects: Effect[] }
  // ── Gambit-specific effects ────────────────────────────────────────────────
  /** Gambit – Stack the Deck: prompt the player to put one card from hand on
   *  top of their deck (mandatory — no skip once the draw-2 bonus has fired). */
  | { kind: 'put_card_from_hand_on_deck' }
  /** Gambit – Card Shark: peek the top card of the player's deck.
   *  If it's an X-Men Hero, draw it; otherwise leave it there. */
  | { kind: 'reveal_top_draw_if_xmen' }
  /** Gambit – Hypnotic Charm (self): peek the top card of the player's deck,
   *  then prompt to discard it or return it to the top. */
  | { kind: 'reveal_top_discard_or_return' }
  /** Gambit – Hypnotic Charm ([instinct] bonus): for each OTHER player, peek
   *  the top card of their deck and auto-discard it. */
  | { kind: 'reveal_top_discard_or_return_others' }
  /** Gambit – High Stakes Jackpot: peek the top card of the player's deck and
   *  gain Attack equal to that card's cost (card stays on top). */
  | { kind: 'gain_attack_equal_to_top_card_cost' }
  // ── Deadpool-specific effects ──────────────────────────────────────────────
  /** Deadpool – Here, Hold This: forces the leftmost city villain (or the
   *  Mastermind if the city is empty) to immediately capture a fresh Bystander. */
  | { kind: 'villain_captures_bystander' }
  /** Deadpool – Oddball: +1 Attack for each OTHER Hero with an odd-numbered cost
   *  that was played before this card this turn. */
  | { kind: 'gain_attack_per_odd_cost_hero_played' }
  /** Deadpool – Do-Over: if this is the first Hero played this turn, prompt the
   *  player to discard their remaining hand and draw four cards instead. */
  | { kind: 'if_first_hero_discard_hand_draw_four' }
  /** Deadpool – Random Acts: prompt "take a Wound to your hand?" then every
   *  player passes their top hand-card to the player on their left. */
  | { kind: 'optional_gain_wound_pass_left' }
  // ── Hawkeye-specific effects ───────────────────────────────────────────────
  /** Hawkeye – Impossible Trick Shot: for the rest of this turn, whenever the
   *  active player defeats a Villain or Mastermind they rescue 3 Bystanders. */
  | { kind: 'gain_rescue_bystanders_on_kill' }
  /** Hawkeye – Covering Fire ([tech] bonus): binary choice — either each other
   *  player draws a card (Accept) or each other player discards a card (Skip). */
  | { kind: 'choose_others_draw_or_discard' }
  // ── Hulk-specific effects ──────────────────────────────────────────────────
  /** Hulk – Grazed Rampage: every player (including the active player) takes a
   *  Wound into their discard pile. Applied in seat order; silently skips
   *  players if the wound deck runs out (same behavior as `gain_wound`). */
  | { kind: 'each_player_gains_wound' }
  // ── Jean Grey-specific effects ─────────────────────────────────────────────
  /** Jean Grey – Read Your Thoughts: for the rest of this turn, each time ANY
   *  bystander is rescued the active player gains +1 Recruit. Stacks. */
  | { kind: 'gain_recruit_per_bystander_rescued_this_turn' }
  /** Jean Grey – Mind Over Matter: for the rest of this turn, each time ANY
   *  bystander is rescued the active player draws a card. Stacks. */
  | { kind: 'draw_per_bystander_rescued_this_turn' }
  /** Jean Grey – Telekinetic Mastery (line 1): for the rest of this turn, each
   *  time ANY bystander is rescued the active player gains +1 Attack. Stacks. */
  | { kind: 'gain_attack_per_bystander_rescued_this_turn' }
  /** Jean Grey – Telekinetic Mastery (line 2): rescue one Bystander for each
   *  OTHER [x-men] Hero played this turn (card itself is x-men so self is
   *  excluded via teamPlayedCounts minus 1). Each rescue fires Jean Grey
   *  per-rescue bonuses if they are active. */
  | { kind: 'rescue_bystander_per_xmen_played' }
  // ── Nick Fury-specific effects ─────────────────────────────────────────────
  /** Nick Fury – Ultimate Sanction: auto-defeat every Villain in the City AND
   *  hit the Mastermind once if their printed Attack is strictly less than the
   *  number of S.H.I.E.L.D. Heroes currently in the shared KO pile. No Attack
   *  resource is spent. Fires fight/rescue/on-kill hooks normally. */
  | { kind: 'defeat_villain_under_shield_ko_count' }
  // ── Rogue-specific effects ─────────────────────────────────────────────────
  /** Rogue – Copy Powers: prompts the player to choose a Hero they played
   *  earlier this turn; fires that Hero's onPlay effects as if Rogue were that
   *  card (also bumps classPlayedCounts for the copied Hero's classes). */
  | { kind: 'copy_played_hero' }
  /** Rogue – Steal Abilities: each player reveals and discards the top card of
   *  their deck; the active player fires the onPlay effects of every revealed
   *  Hero card (in seat order). Base stats and played-counts are bumped too. */
  | { kind: 'play_copy_each_player_top_card' }
  // ── Spider-Man-specific effects ────────────────────────────────────────────
  /** Peek the top card of the player's deck; if it costs 2 or less, draw it;
   *  otherwise leave it on top of the deck. */
  | { kind: 'reveal_top_draw_if_cost_le_2' }
  /** Reveal the top 3 cards of the player's deck; draw those that cost 2 or
   *  less into hand; put the rest back on top in their original order. */
  | { kind: 'reveal_top_three_draw_cost_le_2' }
  // ── Storm-specific effects ─────────────────────────────────────────────────
  /** Storm – Lightning Bolt / Tidal Wave: any Villain the player fights in the
   *  named city space this turn has its effective attack reduced by `amount`.
   *  `location` matches the CITY_LOCATIONS label ('Sewers','Bank','Rooftops',…). */
  | { kind: 'villain_debuff_at_location'; location: string; amount: number }
  /** Storm – Spinning Cyclone: prompts the player to pick a city Villain to
   *  move to a new slot. Bystanders carried by that villain are rescued first;
   *  if the destination is occupied the two villains swap places. */
  | { kind: 'move_villain_rescue_bystanders' }
  /** Storm – Tidal Wave ([ranged] bonus): the Mastermind's effective attack is
   *  reduced by `amount` for the rest of this turn. */
  | { kind: 'mastermind_attack_debuff'; amount: number }
  // ── Thor-specific effects ──────────────────────────────────────────────────
  /** Thor – Surge of Power: fires nested `effects` only if the active player's
   *  current Recruit pool is ≥ `threshold` at the moment this card is played. */
  | { kind: 'if_recruit_ge'; threshold: number; effects: Effect[] }
  /** Thor – God of Thunder: for the rest of this turn, Recruit can be spent as
   *  Attack (one-directional — Attack cannot substitute for Recruit). */
  | { kind: 'enable_recruit_as_attack' }
  // ── Wolverine-specific effects ─────────────────────────────────────────────
  /** Wolverine – Berserker Rage ([instinct] bonus): gain +`amount` Attack for
   *  each extra card drawn via effects this turn (tracked by extraCardsDrawnThisTurn). */
  | { kind: 'gain_attack_per_extra_card_drawn_this_turn'; amount: number }
  // ── Sidekick ability ──────────────────────────────────────────────────────
  /** Sidekick: prompt the player to optionally return this sidekick to the
   *  infinite pool. If accepted, the card is removed from playedThisTurn
   *  (won't go to discard) and the player draws two cards. */
  | { kind: 'optional_return_sidekick_draw_two' }
  // ── Red Skull Master Strike ───────────────────────────────────────────────
  /** Red Skull Master Strike: for each player who has Hero cards in hand, set a
   *  flag so they must KO a Hero of their choice at the start of their next turn. */
  | { kind: 'each_player_ko_hero_from_hand' }
  // ── Dr. Doom Master Strike ────────────────────────────────────────────────
  /** Dr. Doom Master Strike: for each player with exactly 6 cards in hand,
   *  auto-move the 2 cheapest cards from their hand to the top of their deck. */
  | { kind: 'doom_master_strike' }
  // ── Dr. Doom Tactic 2 ────────────────────────────────────────────────────
  /** Dark Technology: prompts the player to recruit one Tech or Ranged Hero
   *  from the HQ for free (no recruit cost). Sets a pending choice; skippable. */
  | { kind: 'free_recruit_tech_or_ranged_from_hq' }
  // ── Dr. Doom Tactic 3 ────────────────────────────────────────────────────
  /** Treasures of Latveria: the player draws `amount` extra cards when they
   *  draw their next full hand (stored on PlayerState until hand-deal time). */
  | { kind: 'extra_hand_cards'; amount: number }
  // ── Dr. Doom Tactic 4 ────────────────────────────────────────────────────
  /** Secrets of Time Travel: flag the current turn so the active player takes
   *  another turn immediately after this one ends. */
  | { kind: 'extra_turn' }
  // ── Red Skull Tactic effects ──────────────────────────────────────────────
  /** Red Skull Tactic 1: reveal the top 3 cards of the player's deck; auto-
   *  resolve by KO-ing the cheapest, discarding the next, returning the
   *  highest-cost to the top (TODO: interactive player choice). */
  | { kind: 'look_top_three_ko_discard_return' }
  /** Red Skull Tactic 3 bonus: draw one additional card for each Hydra Villain
   *  currently in the active player's Victory Pile. */
  | { kind: 'draw_per_hydra_in_victory_pile' }
  // ── Doombot Legion henchman fight effect ──────────────────────────────────
  /** Doombot Legion Fight: peek the top 2 cards of the player's deck; the player
   *  must KO one and return the other to the top of their deck. */
  | { kind: 'look_top_two_ko_one_return_one' }
  // ── Brotherhood villain effects ────────────────────────────────────────────
  /** Sabretooth Escape (per-player, escape handler iterates): the player
   *  auto-reveals an X-Men Hero from their hand, or gains a Wound if they have none. */
  | { kind: 'reveal_xmen_or_wound' }
  /** Sabretooth Fight (iterates all players internally, since fight fires for
   *  the active player only): each player reveals an X-Men Hero or gains a Wound. */
  | { kind: 'each_player_reveal_xmen_or_wound' }
  /** Juggernaut Ambush / general (per-player): KO up to `amount` Heroes from
   *  this player's discard pile. */
  | { kind: 'ko_heroes_from_discard'; amount: number }
  /** Juggernaut Escape (per-player): KO up to `amount` Heroes from this
   *  player's hand immediately. */
  | { kind: 'ko_heroes_from_hand_immediate'; amount: number }
  /** Mystique Escape: immediately trigger the current Scheme's twist effect
   *  (increments twist counter, fires onTwist effects, checks loss). Fired
   *  once only — the escape handler special-cases this kind. */
  | { kind: 'trigger_scheme_twist' }
  /** Scheme twist conditional: fires `effects` only when the current
   *  schemeTwistsRevealed count falls within [min, max] (inclusive).
   *  Either bound may be omitted to mean "no limit in that direction".
   *  Useful for escalating twist schemes like Cosmic Cube. */
  | { kind: 'if_twists_revealed'; min?: number; max?: number; effects: Effect[] }
  // ── Enemies of Asgard villain effects ──────────────────────────────────────
  /** Frost Giant Escape (per-player): reveal a [ranged] Hero or gain a Wound. */
  | { kind: 'reveal_ranged_or_wound' }
  /** Frost Giant Fight (iterates all players internally): each player reveals a
   *  [ranged] Hero or gains a Wound. */
  | { kind: 'each_player_reveal_ranged_or_wound' }
  /** Ymir Fight: KO all Wounds from the active player's hand and discard pile. */
  | { kind: 'ko_wounds_from_hand_and_discard' }
  /** Destroyer Fight: auto-KO all S.H.I.E.L.D. Heroes from the active player's hand. */
  | { kind: 'ko_all_shield_from_hand' }
  // ── HYDRA villain effects ──────────────────────────────────────────────────
  /** Endless Armies of Hydra Fight: reveal and immediately resolve the top
   *  `amount` cards of the Villain Deck (same routing as end-of-turn reveal). */
  | { kind: 'villain_deck_reveal_top'; amount: number }
  /** Viper Ambush / Fight / Escape: for each player who has NO HYDRA Villain
   *  in their Victory Pile, that player gains a Wound. */
  | { kind: 'each_player_without_hydra_vp_gains_wound' }
  // ── Masters of Evil villain effects ───────────────────────────────────────
  /** Baron Zemo Fight: rescue one Bystander for each Avengers Hero the active
   *  player has in hand or played this turn. */
  | { kind: 'rescue_bystander_per_avengers_hero' }
  /** Whirlwind Fight: if the active player fights Whirlwind from a specific
   *  city location, they must KO `amount` Heroes from their hand. */
  | { kind: 'ko_heroes_from_hand_if_at_location'; locations: string[]; amount: number }
  /** Ultron Escape: each player reveals a [tech] Hero from their hand or
   *  gains a Wound. */
  | { kind: 'each_player_reveal_tech_hero_or_wound' }
  /** Melter Fight: each player reveals their top deck card. For each revealed
   *  card, the active player chooses to KO it or return it to the top.
   *  MVP: auto-KOs all revealed cards (TODO: add interactive choice UI). */
  | { kind: 'melter_reveal_top_each_player' }
  // ── Loki effects ──────────────────────────────────────────────────────────────
  /** Loki Master Strike: reveals [strength] Hero (no penalty) or gains a Wound. Skip if hand empty. */
  | { kind: 'loki_master_strike' }
  /** Vanishing Illusions: KO the highest-VP Villain/Henchman from this player's Victory Pile. */
  | { kind: 'ko_villain_from_vp' }
  /** Whispers and Lies: KO up to `count` Bystanders from this player's Victory Pile. */
  | { kind: 'ko_bystanders_from_vp'; count: number }
  /** Cruel Ruler: grants one free City fight this turn (bypass attack cost once). */
  | { kind: 'grant_fight_city_free' }
  /** Maniacal Tyrant: KO up to `amount` cards from your discard pile (sets pending choice). */
  | { kind: 'ko_up_to_from_discard'; amount: number }
  // ── Magneto effects ───────────────────────────────────────────────────────────
  /** Magneto Master Strike: reveals [x-men] Hero (no penalty) or discards down to 4. Skip if hand empty. */
  | { kind: 'magneto_master_strike' }
  /** Xavier's Nemesis: rescue 1 Bystander per [x-men] Hero in your played-this-turn area. */
  | { kind: 'rescue_bystander_per_xmen_played' }
  /** Bitter Captor: sets a pending choice to recruit an [x-men] Hero from the HQ for free. */
  | { kind: 'free_recruit_xmen_from_hq_effect' }
  /** Electromagnetic Bubble: sets pending choice to select an [x-men] Hero from played area for next hand. */
  | { kind: 'em_bubble' }
  /** Crushing Shockwave: reveals [x-men] Hero (no penalty) or gains `amount` Wounds. */
  | { kind: 'reveal_xmen_or_gain_wounds'; amount: number };

/** Hero card — the cards that go into player decks. Sit in HQ to be bought. */
export type HeroCardDef = {
  kind: 'hero';
  cardId: CardId;
  /** Hero class name e.g. "Spider-Man", "Hulk". All cards in a class share
   *  this string — used by HQ filtering / "another Spider-Man this turn"
   *  triggers / display grouping. */
  className: string;
  /** Specific card name within the class, e.g. "Astonishing Strength". */
  cardName: string;
  /** Recruit ⚔ cost to buy from HQ. */
  cost: number;
  /** Stat-stick contributions when played. Card text adds via `effects`.
   *  Set the `…Scales` flag to true to render the value with a "+" suffix
   *  (e.g. 0+⚔) indicating the stat grows from card-text conditions. */
  baseRecruit?: number;
  baseRecruitScales?: boolean;
  baseAttack?: number;
  baseAttackScales?: boolean;
  classes: HeroClass[];
  teams: Team[];
  /** Player-readable rules text (kept short — UI hover). */
  text?: string;
  /** Triggered when the card is played from hand. Resolved in order. */
  onPlay?: Effect[];
  /** Passive abilities that fire while this card is in the player's hand
   *  (never played — the card stays in hand after triggering). */
  onHand?: HandPassive[];
};

/** A passive ability that activates from the player's hand without being played.
 *  The card is "revealed" (shown) but remains in hand after use. */
export type HandPassive =
  /** When the player would gain a Wound, they may reveal this card and draw a
   *  card instead. If they decline, the wound is applied normally. */
  | { kind: 'prevent_wound_draw' }
  /** When this card is selected as the target of a discard effect, it
   *  automatically returns to hand instead of going to the discard pile. */
  | { kind: 'return_to_hand_if_discarded' };

/** Villain card — gets revealed into the City row. Defeating it puts it into
 *  your Victory Pile. */
export type VillainCardDef = {
  kind: 'villain';
  cardId: CardId;
  name: string;
  /** Attack ⚔ required to defeat. */
  attack: number;
  /** Victory Points awarded when added to your Victory Pile. */
  vp: number;
  /** Team affiliation drives the Mastermind's "Always Leads" group. */
  team: Team;
  /** "Ambush" fires when the villain is revealed from the Villain Deck. */
  ambush?: Effect[];
  /** "Fight" fires when a player defeats the villain. */
  fight?: Effect[];
  /** "Escape" fires when the villain escapes off the right edge of the City. */
  escape?: Effect[];
  /** Optional requirement that must be satisfied before a player can fight
   *  this villain. Checked in doFightCity before attack is spent. */
  fightCondition?: { requires: 'xmen_hero' };
  /** Dynamic VP bonus applied during scoring. The card is worth +`amount` VP
   *  for each OTHER villain of the given team in the player's Victory Pile.
   *  Handled by recomputeVp. Example: Supreme HYDRA +3 per other HYDRA villain. */
  vpScale?: { team: Team; amount: number };
  /** Dynamic VP bonus counted across ALL the player's cards (hand + deck +
   *  discard + victoryPile). The card is worth +`amount` VP per Hero of class
   *  `cls` found anywhere in the player's collection. Handled by recomputeVp.
   *  Example: Ultron +1 VP per [black] Hero among all your cards. */
  vpScaleClass?: { cls: string; among: 'all_cards'; amount: number };
  text?: string;
};

/** Henchman — like villains but vanilla; usually low-stat groups of 10. */
export type HenchmanCardDef = {
  kind: 'henchman';
  cardId: CardId;
  name: string;
  attack: number;
  vp: number;
  team: Team;
  /** "Fight" fires when a player defeats this henchman (same semantics as VillainCardDef.fight). */
  fight?: Effect[];
  /** Player-readable card text (shown on card face). */
  text?: string;
};

/** Master Strike — shuffled into the Villain Deck. When revealed, the
 *  Mastermind hits every player. */
export type MasterStrikeCardDef = {
  kind: 'master_strike';
  cardId: 'master_strike';
  name: 'Master Strike';
};

/** Scheme Twist — shuffled into the Villain Deck. When revealed, runs the
 *  current Scheme's twist effect (and increments twist count toward loss). */
export type SchemeTwistCardDef = {
  kind: 'scheme_twist';
  cardId: 'scheme_twist';
  name: 'Scheme Twist';
};

/** Mastermind — the boss. The "Always Leads" team gets seeded into the City
 *  deck at setup. Beaten when all Tactics have been taken by the heroes. */
export type MastermindCardDef = {
  kind: 'mastermind';
  cardId: CardId;
  name: string;
  /** Attack needed to land one hit on the Mastermind. */
  attack: number;
  /** VP — carried by the Tactic cards, not the Mastermind itself (kept for
   *  backward compat / display). */
  vp: number;
  /** Team whose villain group always rides along with this Mastermind. */
  alwaysLeads: Team;
  /** "Master Strike" effect — fires on every Master Strike reveal. */
  strike: Effect[];
  /** Number of Tactics (= number of hits to win). Used for display; the
   *  authoritative win check is `mastermind.tactics.length === 0`. */
  hits: number;
  /** CardIds of the 4 Mastermind Tactic cards, shuffled face-down at setup.
   *  One is drawn at random each time the Mastermind is hit. */
  tacticIds: CardId[];
  text?: string;
};

/** Mastermind Tactic — one of 4 face-down cards beneath the Mastermind.
 *  Spending Attack ≥ mastermind.attack lets a player take a random Tactic
 *  into their Victory Pile and resolve its "Fight" effects.
 *  The Mastermind is fully defeated when all Tactics have been taken. */
export type TacticCardDef = {
  kind: 'tactic';
  cardId: CardId;
  /** Short name printed on the card face. */
  name: string;
  /** Which Mastermind this Tactic belongs to (for catalogue linking). */
  mastermindId: CardId;
  /** Victory Points for the player who takes this Tactic. */
  vp: number;
  /** Effects fired on EACH OTHER player when this Tactic is defeated.
   *  Resolved with auto-pick (no player choice prompt) since they are
   *  punishments, not benefits. In solo play these are all no-ops. */
  fightOthers?: Effect[];
  /** Effects fired on the player who fought this Tactic. */
  fightSelf?: Effect[];
  /** Full printed rules text for UI hover / rules reference. */
  text?: string;
};

/** Scheme — defines the loss condition and the "twist" effect that fires on
 *  each Scheme Twist reveal. Schemes also seed bystanders into the Villain
 *  Deck and tweak initial setup. */
export type SchemeCardDef = {
  kind: 'scheme';
  cardId: CardId;
  name: string;
  /** Total Scheme Twists shuffled into the Villain Deck for this scheme. */
  twists: number;
  /** Number of bystanders mixed into the Villain Deck at setup. */
  bystanders: number;
  /** Number of additional villain/henchman groups to add (scheme-specific). */
  extraVillainGroups?: number;
  extraHenchmanGroups?: number;
  /** Description for UI and the rules-text hover. */
  text: string;
  /** Evil wins when this many Scheme Twists have been revealed (some schemes
   *  use twist-count as their primary loss timer). Optional — when omitted,
   *  twist count alone never triggers the loss condition. */
  evilWinsAfterTwists?: number;
  /** Evil wins when this many villains/henchmen have escaped the city.
   *  When set, this is checked immediately on each escape (before twist count). */
  evilWinsAfterEscapes?: number;
  /** Effect that fires when a Scheme Twist is revealed (in addition to
   *  bumping the twist counter). */
  onTwist?: Effect[];
  /** When set to N, each Scheme Twist immediately triggers N additional reveals
   *  from the Villain Deck (e.g. Negative Zone Prison Breakout reveals 2 extra
   *  cards per twist). Each extra reveal is processed by the same routing logic
   *  as the main end-of-turn reveal — only villain/henchman cards push the
   *  city; bystanders/twists/strikes do not. */
  onTwistRevealCount?: number;
};

/** Wound — clutter card that goes into discard when you take damage. Adds
 *  no stats; the only "effect" is being a junk card you have to shuffle. */
export type WoundCardDef = {
  kind: 'wound';
  cardId: 'wound';
  name: 'Wound';
  text?: string;
};

/** Bystander — civilian. Get attached to villains/mastermind, can be
 *  "rescued" by a player who defeats said villain. Worth 1 VP each. */
export type BystanderCardDef = {
  kind: 'bystander';
  cardId: 'bystander';
  name: 'Bystander';
  vp: 1;
};

/** Discriminated union of every card type in the game. Card catalogue keys
 *  by cardId; instances reference their definition through this. */
export type CardDef =
  | HeroCardDef
  | VillainCardDef
  | HenchmanCardDef
  | MasterStrikeCardDef
  | SchemeTwistCardDef
  | MastermindCardDef
  | TacticCardDef
  | SchemeCardDef
  | WoundCardDef
  | BystanderCardDef;

// ---------- Game state ----------

export type LegendaryPhase = 'lobby' | 'playing' | 'finished';

/** Per-player private + public state. Hand contents get scrubbed from
 *  other players via projectStateForViewer (Phase 1 of Spellduel paid off). */
export type PlayerState = {
  playerId: string;
  username: string;
  accent_color?: string;
  /** Stable index 0..n-1 used for turn order; never reshuffled mid-game. */
  seat: number;
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];
  /** Defeated villains/henchmen/mastermind layers go here. Worth VP at the
   *  end of the game. Counted against the Hero Cards "Schemes Defeated". */
  victoryPile: CardInstance[];
  /** Sum of VP from victoryPile + bystanders saved, minus wounds taken.
   *  Cached for the leaderboard; recomputed every state mutation. */
  vp: number;
  /** Set by a Master Strike effect (e.g. Red Skull). The player must KO a Hero
   *  of their choice from their new hand at the start of their next turn. */
  pendingMasterStrikeKO?: boolean;
  /** Set by Treasures of Latveria (Dr. Doom Tactic 3). This many extra cards
   *  are added to the player's next hand draw. Consumed and cleared on draw. */
  endOfTurnExtraDraw?: number;
  /** Electromagnetic Bubble (Magneto Tactic 3): Hero card to add to this player's next hand draw as a 7th card. */
  nextHandBonusCard?: CardInstance;
};

/** Describes a card-choice the current player must resolve before taking
 *  any further actions (playing a card, recruiting, fighting, ending turn).
 *  Set by `ko_from_hand` / `discard_from_hand` effects; cleared by
 *  `resolve_choice` (pick a card) or `skip_choice` (forfeit the bonus). */
export type PendingChoice =
  | {
      kind: 'ko_from_hand' | 'discard_from_hand';
      /** Effects that fire only if the player selects a card (the "If you do…" bonus). */
      bonus: Effect[];
      /** When set, only cards matching this filter are selectable. */
      filter?: 'wounds_only' | 'shield_heroes' | 'heroes_only';
      /** Which zones the player may pick from. Defaults to `['hand','played']`. */
      sources?: ('hand' | 'discard' | 'played')[];
      /** When true the player MUST pick a card — the Skip button is hidden. */
      mandatory?: boolean;
      /** For multi-KO effects (e.g. Whirlwind "KO 2 Heroes"): how many additional
       *  KO prompts still need to fire after this one resolves. 0 = last KO. */
      remaining?: number;
    }
  | {
      /** Cap's "reveal to prevent a wound" passive. The player reveals this card
       *  from hand (it stays there) and draws a card instead of taking the wound.
       *  Skipping applies the wound normally. */
      kind: 'reveal_to_prevent_wound';
    }
  /** Gambit – Stack the Deck: "put a card on top of your deck" — player selects
   *  a card from hand via resolve_choice; mandatory (no skip allowed). */
  | { kind: 'put_card_on_deck'; mandatory: true }
  /** Gambit – Hypnotic Charm: the revealed card is stored here while the player
   *  decides whether to discard it or return it to the top of their deck.
   *  Accept = discard; Skip = put back. */
  | { kind: 'reveal_top_discard_or_return'; card: CardInstance }
  /** Deadpool – Do-Over: "discard your remaining hand and draw 4?" Accept fires
   *  the discard+draw; Skip keeps the hand as-is. No card selection needed. */
  | { kind: 'discard_hand_draw_four' }
  /** Deadpool – Random Acts: "take a Wound to your hand?" Accept gains the wound;
   *  Skip declines it. Either way, all players then pass a card to the left. */
  | { kind: 'optional_gain_wound_pass_left' }
  /** Hawkeye – Covering Fire ([tech] bonus): "each other player draws" (Accept)
   *  or "each other player discards" (Skip). Binary — no card selection needed. */
  | { kind: 'choose_others_draw_or_discard' }
  /** Rogue – Copy Powers: the player selects a Hero from their played-this-turn
   *  zone (excluding this Copy Powers card). The selected card stays in played;
   *  its onPlay fires for the active player. */
  | { kind: 'copy_played_hero' }
  /** Storm – Spinning Cyclone step 1: player clicks a city Villain to pick it
   *  up for moving. resolve_choice receives that card's instanceId. */
  | { kind: 'move_villain_select_villain' }
  /** Storm – Spinning Cyclone step 2: player clicks a city slot as the
   *  destination. resolve_choice receives the synthetic id 'slot:N'. The
   *  villain being moved is stored in `card` so it survives between steps. */
  | { kind: 'move_villain_select_dest'; sourceSlot: number; sourceName: string; card: CardInstance }
  /** Sidekick: "You may return this card to the Sidekick stack. If you do,
   *  draw two cards." Accept = return + draw; Skip = keep in played area. */
  | { kind: 'optional_return_sidekick_draw_two' }
  /** Dark Technology (Dr. Doom Tactic 2): player clicks a Tech or Ranged Hero
   *  in the HQ to recruit it for free; skippable ("may"). */
  | { kind: 'free_recruit_from_hq' }
  /** Deadpool – Here, Hold This: player clicks a Villain or Henchman in the
   *  city to assign a captured Bystander (mandatory — must pick a target). */
  | { kind: 'choose_city_villain_for_bystander'; bystander: CardInstance }
  /** Doombot Legion Fight: two cards peeked from the deck are shown; the player
   *  clicks one to KO — the other is automatically returned to the top of the
   *  deck. Mandatory (no skip). */
  | { kind: 'look_top_two_ko_one_return_one'; cards: CardInstance[]; mandatory: true }
  /** "MAY gain [card] to hand" prompt — fires when a fight effect with `may: true`
   *  is resolved. Accept = gain the card; Skip = decline. */
  | { kind: 'optional_gain_card'; cardId: CardId; label: string }
  /** Solo mode: after a Scheme Twist, choose a Hero from the HQ costing 6 or less
   *  to put on the bottom of the Hero Deck. Mandatory when eligible targets exist.
   *  At most once per twist chain (even if Prison Breakout fires multiple twists). */
  | { kind: 'solo_twist_tuck_hero' }
  /** Bitter Captor: player clicks an [x-men] Hero in the HQ to recruit it for free. */
  | { kind: 'free_recruit_xmen_from_hq' }
  /** Maniacal Tyrant: KO up to `remaining` cards from your discard pile; click to KO, skip to stop. */
  | { kind: 'ko_up_to_from_discard'; remaining: number; cards: CardInstance[] }
  /** Electromagnetic Bubble: player clicks an [x-men] Hero from their played-this-turn area. */
  | { kind: 'em_bubble_select_hero' };

/** Shared bookkeeping for the "current turn" — resets every end-of-turn.
 *  Mid-turn state like the per-turn Attack/Recruit pool, what we've already
 *  played (for "another Hulk this turn" type triggers), etc. */
export type TurnState = {
  attack: number;
  recruit: number;
  /** Cards played from hand this turn, in order. Used by class/team
   *  synergy effects and for the UI's "this is what I've played" row. */
  playedThisTurn: CardInstance[];
  /** Tracks how many times a class/team/heroName has been played this turn,
   *  so synergy triggers can resolve in O(1). Hydrated when a card is played. */
  classPlayedCounts: Partial<Record<HeroClass, number>>;
  teamPlayedCounts: Partial<Record<Team, number>>;
  /** Tracks hero class-name plays (e.g. 'Hulk', 'Nick Fury') for hero-name
   *  synergies like "Hulk: +3 Attack". Keyed by HeroCardDef.className. */
  heroNameCounts: Partial<Record<string, number>>;
  /** Rules: "Up to once per turn" for the Sidekick pool. Resets on end-turn. */
  sidekickRecruited: boolean;
  /** When set, the active player must pick a card from their hand to
   *  KO/discard before they can take any other action. */
  pendingChoice?: PendingChoice;
  /** Set by `grant_free_bystander_fight`. Allows the player to fight ONE
   *  villain or mastermind that has an attached bystander without spending any
   *  Attack. Consumed on use; reset to false on end-of-turn. */
  freeBystanderFightAvailable: boolean;
  /** Set by Hawkeye – Impossible Trick Shot. Each time the player defeats a
   *  Villain or Mastermind this turn they rescue this many Bystanders.
   *  Resets to 0 on end-of-turn. */
  rescueBystandersOnKillCount: number;
  /** Set by Jean Grey – Read Your Thoughts. Each time a Bystander is rescued
   *  this turn the active player gains this much Recruit. Stacks. */
  rescueBonusRecruit: number;
  /** Set by Jean Grey – Mind Over Matter. Each time a Bystander is rescued
   *  this turn the active player draws this many cards. Stacks. */
  rescueBonusDraw: number;
  /** Set by Jean Grey – Telekinetic Mastery. Each time a Bystander is rescued
   *  this turn the active player gains this much Attack. Stacks. */
  rescueBonusAttack: number;
  /** Whirlwind Fight: records which city slot (0–4) the last villain fight
   *  occurred at, so location-conditional effects can read it during resolution.
   *  Set by doFightCity immediately before firing fight effects; undefined at
   *  turn start and between fights. */
  lastFightSlot?: number;
  /** Storm – Lightning Bolt / Tidal Wave: per-city-slot villain attack reduction.
   *  Key = slot index (0 = Sewers … 4 = Bridge). */
  locationVillainDebuffs: Partial<Record<number, number>>;
  /** Storm – Tidal Wave ([ranged] bonus): Mastermind effective attack is reduced
   *  by this much for the rest of this turn. */
  mastermindAttackDebuff: number;
  /** Thor – God of Thunder: when true, Recruit points may be spent as Attack
   *  (one-directional — Attack cannot substitute for Recruit). */
  recruitAsAttackEnabled: boolean;
  /** Wolverine – Berserker Rage: counts every card drawn via play effects this
   *  turn (not the initial 6-card hand draw). Used by gain_attack_per_extra_card_drawn_this_turn. */
  extraCardsDrawnThisTurn: number;
  /** Set by Secrets of Time Travel (Dr. Doom Tactic 4). When true, the active
   *  player takes another full turn after this one ends instead of passing. */
  extraTurn?: boolean;
  /** Solo mode: set to true when the solo-twist tuck choice has been queued this
   *  turn, preventing a Prison Breakout twist chain from triggering it twice. */
  soloTwistTuckPending?: boolean;
  /** Set to true the first time the player successfully fights a villain or
   *  mastermind this turn. Used for Wound healing eligibility check. */
  foughtThisTurn: boolean;
  /** Set to true the first time the player recruits a card (HQ, sidekick, or
   *  officer pool) this turn. Used for Wound healing eligibility check. */
  recruitedThisTurn: boolean;
  /** Cruel Ruler (Loki Tactic 3): when true, the next fight_city action is free (no attack cost). */
  fightCityFreeAvailable?: boolean;
};

export type LegendaryEvent =
  | { kind: 'system'; text: string }
  | { kind: 'turn_started'; seat: number; username: string }
  | { kind: 'card_played'; seat: number; username: string; cardId: CardId; cardName: string }
  | { kind: 'hero_recruited'; seat: number; username: string; cardId: CardId; cardName: string; cost: number; slot: number }
  | { kind: 'villain_defeated'; seat: number; username: string; cardId: CardId; cardName: string; vp: number }
  | { kind: 'villain_revealed'; cardId: CardId; cardName: string }
  | { kind: 'villain_escaped'; cardId: CardId; cardName: string }
  | { kind: 'mastermind_hit'; seat: number; username: string; tacticName: string; tacticVp: number; tacticsRemaining: number; tacticCardId: string; tacticText: string }
  | { kind: 'master_strike'; effectText: string }
  | { kind: 'scheme_twist'; twistsRevealed: number; twistsTotal: number }
  | { kind: 'wound_taken'; seat: number; username: string }
  | { kind: 'bystander_rescued'; seat: number; username: string; count: number }
  /** Fires when a bystander drawn from the Villain Deck is captured by the
   *  nearest villain in the city (or the mastermind if the city is empty). */
  | { kind: 'bystander_captured'; capturedBy: 'villain' | 'mastermind'; captorName: string }
  /** Fires each time refillHQ places a card into an empty HQ slot during
   *  gameplay (NOT at setup). Drives the per-slot flip-in animation. */
  | { kind: 'hq_refilled'; slot: number; cardId: CardId; cardName: string }
  | { kind: 'game_ended'; result: 'win' | 'loss' | 'tie'; reasonText: string };

/** Full game state. Lives in the rooms.state JSONB column. */
export type LegendaryState = {
  version: number;
  phase: LegendaryPhase;

  // ----- Setup (fixed at game start) -----
  schemeId: CardId;
  mastermindId: CardId;
  /** Hero classes in the Hero Deck (always >=5 to fill HQ; recommended 5 for MVP). */
  heroClassIds: string[];
  villainGroupIds: string[]; // team identifiers, e.g. 'hydra'
  henchmanGroupIds: string[];

  // ----- Shared zones -----
  heroDeck: CardInstance[];
  hq: (CardInstance | null)[]; // length 5; null while waiting for refill
  villainDeck: CardInstance[];
  /** City row. Index 0 = newest (just revealed), increases toward the right.
   *  At end-of-turn we shift right; rightmost falls off → escape. Length 5. */
  city: (CardInstance | null)[];
  /** Bystanders that revealed off the Villain Deck before any villain to
   *  attach to. Sit in this "limbo" until the next villain is revealed and
   *  scoops them up. */
  pendingBystanders: CardInstance[];
  /** Bystanders currently attached to a villain (keyed by villain instanceId).
   *  Defeating the villain awards these as VP for the defeating player. */
  cityBystanders: Record<CardInstanceId, CardInstance[]>;
  escapedPile: CardInstance[]; // villains + their bystanders that escaped
  ko: CardInstance[]; // permanent KO pile (cards removed from the game)
  woundDeck: CardInstance[];
  bystanderDeck: CardInstance[];
  /** Cards remaining in the finite Sidekick pool (starts at 30). Recruits are
   *  blocked when this reaches 0; the card is simply not given. */
  sidekickPoolCount: number;
  /** Cards remaining in the finite S.H.I.E.L.D. Officer pool (starts at 30).
   *  Recruits are blocked when this reaches 0. */
  officerPoolCount: number;
  mastermind: {
    cardId: CardId;
    hitsTaken: number;
    /** Face-down shuffled Tactic cards. One is drawn at random each time the
     *  Mastermind is hit. Empty = all Tactics taken = heroes win. */
    tactics: CardInstance[];
    /** Bystanders the Mastermind has scooped up. All are rescued when any
     *  Tactic is taken (per the rules). */
    bystanders: CardInstance[];
  };

  // ----- Per-player -----
  players: PlayerState[];

  // ----- Current turn -----
  currentPlayerIdx: number;
  turn: number;
  thisTurn: TurnState;

  // ----- Scheme bookkeeping -----
  schemeTwistsRevealed: number;

  // ----- Solo mode -----
  /** Solo: the 2 Henchman cards set aside at setup to enter the city before the
   *  first villain-deck reveal on turn 1 (one at a time, with any ambush effects).
   *  Cleared to [] once placed. */
  soloStartingHenchmen?: CardInstance[];
  /** Solo: true once the starting henchmen have entered the city. */
  soloStartingHenchmenPlaced?: boolean;

  // ----- Result + log -----
  result?: 'win' | 'loss' | 'tie';
  resultReason?: string;
  /** Set when the last Mastermind Tactic is taken mid-turn. The current player
   *  may finish their turn for bonus VP; win is finalized at End Turn.
   *  Per the rules: "That player can still finish the rest of their turn." */
  pendingResult?: 'win';
  /** Set when either the Hero Deck or Villain Deck reaches zero cards.
   *  The current player finishes their turn as a final chance to win;
   *  if no win/loss is achieved by End Turn the game ends in a tie. */
  lastTurnTie?: boolean;
  /** Monotonically-increasing counter. Every call to pushLog stamps the event
   *  with the current value, incremented by 1. The board uses this seq number
   *  instead of an array-index cursor so log rotation (LOG_MAX trim) never
   *  desynchronises the animation tracker. */
  logSeq: number;
  log: LegendaryEvent[];
};
