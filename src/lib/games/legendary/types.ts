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
  | 'hydra' | 'brotherhood' | 'masters-of-evil' | 'enemies-of-asgard'
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
  | { kind: 'ko_from_hand'; up_to: number; bonus?: Effect[] } // "You may KO a card from your hand. If you do, +Bonus."
  | { kind: 'discard_from_hand'; up_to: number; bonus?: Effect[] }
  // Wounds + bystanders
  | { kind: 'gain_wound' }
  | { kind: 'rescue_bystander'; amount: number }
  // Conditional class/team synergies
  | { kind: 'if_played_class_this_turn'; cls: HeroClass; minOthers: number; effects: Effect[] }
  | { kind: 'if_played_team_this_turn'; team: Team; minOthers: number; effects: Effect[] };

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
};

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
 *  deck at setup. Mastermind has multiple HP layers (Tactics); MVP build
 *  uses a single HP track and skips Tactics for now. */
export type MastermindCardDef = {
  kind: 'mastermind';
  cardId: CardId;
  name: string;
  /** Attack needed to land one hit on the Mastermind. */
  attack: number;
  /** VP awarded when the Mastermind is fully defeated. */
  vp: number;
  /** Team whose villain group always rides along with this Mastermind. */
  alwaysLeads: Team;
  /** "Master Strike" effect — fires on every Master Strike reveal. */
  strike: Effect[];
  /** Number of times the Mastermind must be hit to win (Tactics-equivalent
   *  in the simplified MVP). Real Legendary: 4 Tactics → defeat. */
  hits: number;
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
  /** Threshold for "evil wins". Comparison depends on the loss condition
   *  the scheme implements in the engine — kept simple here: evil wins
   *  when this many Scheme Twists have been revealed. */
  evilWinsAfterTwists: number;
  /** Effect that fires when a Scheme Twist is revealed (in addition to
   *  bumping the twist counter). */
  onTwist?: Effect[];
};

/** Wound — clutter card that goes into discard when you take damage. Adds
 *  no stats; the only "effect" is being a junk card you have to shuffle. */
export type WoundCardDef = {
  kind: 'wound';
  cardId: 'wound';
  name: 'Wound';
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
};

/** Shared bookkeeping for the "current turn" — resets every end-of-turn.
 *  Mid-turn state like the per-turn Attack/Recruit pool, what we've already
 *  played (for "another Hulk this turn" type triggers), etc. */
export type TurnState = {
  attack: number;
  recruit: number;
  /** Cards played from hand this turn, in order. Used by class/team
   *  synergy effects and for the UI's "this is what I've played" row. */
  playedThisTurn: CardInstance[];
  /** Tracks how many times a class/team has been played this turn, so
   *  synergy triggers can resolve in O(1). Hydrated when a card is played. */
  classPlayedCounts: Partial<Record<HeroClass, number>>;
  teamPlayedCounts: Partial<Record<Team, number>>;
};

export type LegendaryEvent =
  | { kind: 'system'; text: string }
  | { kind: 'turn_started'; seat: number; username: string }
  | { kind: 'card_played'; seat: number; username: string; cardId: CardId; cardName: string }
  | { kind: 'hero_recruited'; seat: number; username: string; cardId: CardId; cardName: string; cost: number }
  | { kind: 'villain_defeated'; seat: number; username: string; cardId: CardId; cardName: string; vp: number }
  | { kind: 'villain_revealed'; cardId: CardId; cardName: string }
  | { kind: 'villain_escaped'; cardId: CardId; cardName: string }
  | { kind: 'mastermind_hit'; seat: number; username: string; hitsRemaining: number }
  | { kind: 'master_strike'; effectText: string }
  | { kind: 'scheme_twist'; twistsRevealed: number; twistsTotal: number }
  | { kind: 'wound_taken'; seat: number; username: string }
  | { kind: 'bystander_rescued'; seat: number; username: string; count: number }
  | { kind: 'game_ended'; result: 'win' | 'loss'; reasonText: string };

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
  mastermind: {
    cardId: CardId;
    hitsTaken: number;
    /** Bystanders the Mastermind has scooped up (from Always Leads villains
     *  escaping etc.). Awarded when the Mastermind is fully defeated. */
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

  // ----- Result + log -----
  result?: 'win' | 'loss';
  resultReason?: string;
  log: LegendaryEvent[];
};
