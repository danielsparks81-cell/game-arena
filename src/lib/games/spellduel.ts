// Spellduel — 2-player interactive card duel. Designed as the foundation for
// richer card games: the engine treats each card as a sequence of typed
// "effects" plus an optional reactive "trigger" that waits for a future
// event. Add a new effect type or trigger type and a whole new card
// archetype unlocks.
//
// State model:
//   • Each seat (A/B) has HP, mana, deck, hand, discard, pendingTriggers,
//     and `cardsPlayedThisTurn` (for combo cards).
//   • The shared `log` records every meaningful event so the board can
//     replay/animate them.
//
// Resolution rules:
//   • A card's `effects[]` resolve top-to-bottom, atomically — opponent
//     can't respond mid-card.
//   • After every effect that targets a player, any matching pendingTriggers
//     on that player fire (e.g. Counter prevents the next damage).
//   • Triggers are consumed when they fire (one-shot for now).
//
// Future-proofing — adding a card archetype usually means:
//   1. Add a new EffectKind or TriggerKind value
//   2. Handle it in resolveEffect() / fireTriggers()
//   3. Define cards in CARDS that use it
//
// HP <= 0 ends the match. Tie-breaker (both at 0 same instant): the player
// who DIDN'T just play wins (it was their opponent's last move that killed
// them simultaneously).

/** Bump and add a registry `migrateState` whenever you change this state's shape. */
export const STATE_VERSION = 4;

/** Sentinel card-id stamped into hidden zones (opponent's hand, both decks)
 *  by projectStateForViewer. The board renders any entry that isn't a known
 *  CARDS[id] as a face-down card back, so we never need to expose real
 *  card identities to clients that aren't allowed to see them. */
export const HIDDEN_CARD = 'hidden' as const;

export const STARTING_HP        = 20;
export const STARTING_HAND_SIZE = 3;
export const MAX_MANA           = 10;

export type Seat = 'A' | 'B';

export type CardId =
  // Commons (max 5 per deck)
  | 'strike' | 'mend' | 'insight' | 'fireball' | 'counter' | 'combo'
  | 'sacrifice' | 'hex' | 'spark' | 'arcane_bolt' | 'mana_spring' | 'siphon'
  | 'recuperate' | 'blaze' | 'blood_pact' | 'fade' | 'overload' | 'tome'
  | 'double_strike' | 'frostbite'
  // Uncommons (max 2 per deck)
  | 'mind_pick' | 'curse' | 'ward' | 'drain' | 'mana_void' | 'mirror'
  | 'pilfer' | 'scorch' | 'counterspell' | 'reflect'
  // Rares (max 1 per deck)
  | 'inferno' | 'mind_wipe' | 'time_warp' | 'arcane_surge' | 'blood_ritual'
  | 'phoenix_flame' | 'soul_drain' | 'dimensional_rift' | 'last_gasp' | 'archmages_wrath';

export type Rarity = 'common' | 'uncommon' | 'rare';

/** Max copies of a card allowed in a single deck, by rarity. */
export const MAX_COPIES: Record<Rarity, number> = { common: 5, uncommon: 2, rare: 1 };

export type EffectKind =
  | 'damage'        // target loses HP (checked against prevent_damage / shield triggers)
  | 'heal'          // target heals (capped at STARTING_HP)
  | 'draw'          // self draws N
  | 'force_discard' // opponent discards N random
  | 'gain_mana'     // self gains N mana THIS TURN (manaBonus)
  | 'lose_hp'       // self pays N HP (not damage, can't be prevented)
  | 'burn'          // apply a damage-over-time to the target (amount/turn for `turns`)
  | 'silence'       // opponent can't cast a category of spell next turn (mode)
  | 'copy_last_spell' // re-cast the opponent's last spell as your own
  | 'steal'         // take N random cards from opponent's hand into yours
  | 'discard_hand'  // target discards their ENTIRE hand
  | 'opponent_draw' // opponent draws N
  | 'extra_turn';   // take another turn immediately after this one

export type Effect = {
  kind: EffectKind;
  amount: number;
  /**
   * If set, the effect's target is the resolved-target at this index in the
   * card's `targets[]` (e.g. Hex picks ANY player). Omit for implicit-target
   * effects — damage/force_discard/burn/silence/discard_hand default to opponent,
   * heal/draw/gain_mana/lose_hp default to self.
   */
  targetIdx?: number;
  /** burn: how many of the target's upcoming turns it ticks for. */
  turns?: number;
  /** silence: which category of spell is locked out next turn. */
  mode?: 'damage' | 'utility';
  /** Override an implicit-opponent effect (discard_hand) to hit the caster instead. */
  selfTarget?: boolean;
};

export type TriggerKind =
  | 'prevent_damage' // fully prevents the NEXT damage instance, then is consumed
  | 'shield';        // absorbs up to `amount` total damage across instances, then breaks

/**
 * Targeting infrastructure (Phase 2 foundation).
 *
 * A card declares what it needs to target via `targets[]` on its CardDef;
 * the player picks one ResolvedTarget per spec when they play the card; the
 * server validates each pick matches its spec; effects reference resolved
 * targets by index via Effect.targetIdx.
 *
 * Adding a target kind:
 *   1. Add the literal to TargetKind below
 *   2. Add a corresponding ResolvedTarget variant
 *   3. Handle it in validateTargets + resolveTargetSeat
 *   4. Build the picker UI for it in SpellduelBoard.tsx
 */
export type TargetKind = 'any_player';

export type TargetSpec = {
  kind: TargetKind;
  /** Shown above the picker, e.g. "Hex who?". Defaults to a generic prompt. */
  prompt?: string;
};

/** A target the player has actually picked. As more TargetKinds are added
    (e.g. card-in-hand, card-in-discard) this becomes a discriminated union. */
export type ResolvedTarget = { kind: 'player'; seat: Seat };

export type Trigger = {
  kind: TriggerKind;
  amount: number;
  /** Name of the card that planted this — for the activation log line. */
  source: string;
};

export type CardDef = {
  id: CardId;
  name: string;
  cost: number;
  rarity: Rarity;
  description: string;
  /** Static effects fire on play, top to bottom. */
  effects: Effect[];
  /** Optional pending trigger planted after effects resolve. */
  trigger?: Trigger;
  /** Some cards override their effects based on game state (e.g. Combo
   *  swaps in a different damage amount once cardsPlayedThisTurn >= 3).
   *  Branchy logic lives in resolveDynamic() keyed by this string. */
  dynamic?: 'combo' | 'last_gasp' | 'blood_ritual';
  /** Targets the player must pick when playing this card. Resolved targets
   *  ride along with the action; effects reference them via targetIdx. */
  targets?: TargetSpec[];
  /** Reaction cards are played OUT OF TURN in response to an opponent's spell,
   *  not on your own turn. `reactionType` picks the behavior. */
  isReaction?: boolean;
  reactionType?: 'counter' | 'reflect';
};

export const CARDS: Record<CardId, CardDef> = {
  // ───────── COMMONS (max 5) ─────────
  strike: {
    id: 'strike', name: 'Strike', cost: 1, rarity: 'common',
    description: 'Deal 2 damage.',
    effects: [{ kind: 'damage', amount: 2 }],
  },
  mend: {
    id: 'mend', name: 'Mend', cost: 1, rarity: 'common',
    description: 'Heal 3 HP.',
    effects: [{ kind: 'heal', amount: 3 }],
  },
  insight: {
    id: 'insight', name: 'Insight', cost: 1, rarity: 'common',
    description: 'Draw 2 cards.',
    effects: [{ kind: 'draw', amount: 2 }],
  },
  fireball: {
    id: 'fireball', name: 'Fireball', cost: 3, rarity: 'common',
    description: 'Deal 4 damage.',
    effects: [{ kind: 'damage', amount: 4 }],
  },
  counter: {
    id: 'counter', name: 'Counter', cost: 1, rarity: 'common',
    description: 'Prevent the next damage you take.',
    effects: [],
    trigger: { kind: 'prevent_damage', amount: 99, source: 'Counter' },
  },
  combo: {
    id: 'combo', name: 'Combo', cost: 2, rarity: 'common',
    description: 'Deal 1 damage. If you played 3+ cards this turn, deal 5 instead.',
    effects: [],
    dynamic: 'combo',
  },
  sacrifice: {
    id: 'sacrifice', name: 'Sacrifice', cost: 0, rarity: 'common',
    description: 'Lose 1 HP. Gain 2 mana this turn.',
    effects: [{ kind: 'lose_hp', amount: 1 }, { kind: 'gain_mana', amount: 2 }],
  },
  hex: {
    id: 'hex', name: 'Hex', cost: 2, rarity: 'common',
    description: 'Deal 3 damage to any player (including yourself).',
    effects: [{ kind: 'damage', amount: 3, targetIdx: 0 }],
    targets: [{ kind: 'any_player', prompt: 'Hex who?' }],
  },
  spark: {
    id: 'spark', name: 'Spark', cost: 1, rarity: 'common',
    description: 'Deal 1 damage. Draw 1 card.',
    effects: [{ kind: 'damage', amount: 1 }, { kind: 'draw', amount: 1 }],
  },
  arcane_bolt: {
    id: 'arcane_bolt', name: 'Arcane Bolt', cost: 2, rarity: 'common',
    description: 'Deal 3 damage.',
    effects: [{ kind: 'damage', amount: 3 }],
  },
  mana_spring: {
    id: 'mana_spring', name: 'Mana Spring', cost: 1, rarity: 'common',
    description: 'Gain 2 mana this turn.',
    effects: [{ kind: 'gain_mana', amount: 2 }],
  },
  siphon: {
    id: 'siphon', name: 'Siphon', cost: 2, rarity: 'common',
    description: 'Deal 2 damage. Heal 2 HP.',
    effects: [{ kind: 'damage', amount: 2 }, { kind: 'heal', amount: 2 }],
  },
  recuperate: {
    id: 'recuperate', name: 'Recuperate', cost: 2, rarity: 'common',
    description: 'Heal 5 HP.',
    effects: [{ kind: 'heal', amount: 5 }],
  },
  blaze: {
    id: 'blaze', name: 'Blaze', cost: 2, rarity: 'common',
    description: 'Deal 2 damage. Burn: 1 damage next turn.',
    effects: [{ kind: 'damage', amount: 2 }, { kind: 'burn', amount: 1, turns: 1 }],
  },
  blood_pact: {
    id: 'blood_pact', name: 'Blood Pact', cost: 0, rarity: 'common',
    description: 'Lose 2 HP. Draw 3 cards.',
    effects: [{ kind: 'lose_hp', amount: 2 }, { kind: 'draw', amount: 3 }],
  },
  fade: {
    id: 'fade', name: 'Fade', cost: 1, rarity: 'common',
    description: 'Shield: absorb the next 3 damage.',
    effects: [],
    trigger: { kind: 'shield', amount: 3, source: 'Fade' },
  },
  overload: {
    id: 'overload', name: 'Overload', cost: 4, rarity: 'common',
    description: 'Deal 6 damage.',
    effects: [{ kind: 'damage', amount: 6 }],
  },
  tome: {
    id: 'tome', name: 'Tome', cost: 3, rarity: 'common',
    description: 'Draw 4 cards.',
    effects: [{ kind: 'draw', amount: 4 }],
  },
  double_strike: {
    id: 'double_strike', name: 'Double Strike', cost: 3, rarity: 'common',
    description: 'Deal 2 damage twice.',
    effects: [{ kind: 'damage', amount: 2 }, { kind: 'damage', amount: 2 }],
  },
  frostbite: {
    id: 'frostbite', name: 'Frostbite', cost: 3, rarity: 'common',
    description: "Deal 3 damage. Opponent can't cast damage spells next turn.",
    effects: [{ kind: 'damage', amount: 3 }, { kind: 'silence', amount: 1, mode: 'damage' }],
  },

  // ───────── UNCOMMONS (max 2) ─────────
  mind_pick: {
    id: 'mind_pick', name: 'Mind Pick', cost: 2, rarity: 'uncommon',
    description: 'Opponent discards 1 random card.',
    effects: [{ kind: 'force_discard', amount: 1 }],
  },
  curse: {
    id: 'curse', name: 'Curse', cost: 3, rarity: 'uncommon',
    description: 'Burn: 2 damage for 2 turns.',
    effects: [{ kind: 'burn', amount: 2, turns: 2 }],
  },
  ward: {
    id: 'ward', name: 'Ward', cost: 3, rarity: 'uncommon',
    description: 'Shield: absorb the next 8 damage.',
    effects: [],
    trigger: { kind: 'shield', amount: 8, source: 'Ward' },
  },
  drain: {
    id: 'drain', name: 'Drain', cost: 3, rarity: 'uncommon',
    description: 'Deal 3 damage. Opponent discards 2 cards.',
    effects: [{ kind: 'damage', amount: 3 }, { kind: 'force_discard', amount: 2 }],
  },
  mana_void: {
    id: 'mana_void', name: 'Mana Void', cost: 3, rarity: 'uncommon',
    description: "Opponent can't cast non-damage spells next turn.",
    effects: [{ kind: 'silence', amount: 1, mode: 'utility' }],
  },
  mirror: {
    id: 'mirror', name: 'Mirror', cost: 4, rarity: 'uncommon',
    description: 'Copy the last spell the opponent played.',
    effects: [{ kind: 'copy_last_spell', amount: 1 }],
  },
  pilfer: {
    id: 'pilfer', name: 'Pilfer', cost: 2, rarity: 'uncommon',
    description: 'Steal a random card from the opponent’s hand.',
    effects: [{ kind: 'steal', amount: 1 }],
  },
  scorch: {
    id: 'scorch', name: 'Scorch', cost: 3, rarity: 'uncommon',
    description: 'Deal 4 damage. Burn: 1 damage for 2 turns.',
    effects: [{ kind: 'damage', amount: 4 }, { kind: 'burn', amount: 1, turns: 2 }],
  },
  counterspell: {
    id: 'counterspell', name: 'Counterspell', cost: 1, rarity: 'uncommon',
    description: 'Reaction: cancel the spell your opponent is casting.',
    effects: [], isReaction: true, reactionType: 'counter',
  },
  reflect: {
    id: 'reflect', name: 'Reflect', cost: 2, rarity: 'uncommon',
    description: 'Reaction: send a damage spell back at its caster.',
    effects: [], isReaction: true, reactionType: 'reflect',
  },

  // ───────── RARES (max 1) ─────────
  inferno: {
    id: 'inferno', name: 'Inferno', cost: 5, rarity: 'rare',
    description: 'Deal 8 damage. Burn: 3 damage for 3 turns.',
    effects: [{ kind: 'damage', amount: 8 }, { kind: 'burn', amount: 3, turns: 3 }],
  },
  mind_wipe: {
    id: 'mind_wipe', name: 'Mind Wipe', cost: 4, rarity: 'rare',
    description: 'Opponent discards their entire hand, then draws 2.',
    effects: [{ kind: 'discard_hand', amount: 0 }, { kind: 'opponent_draw', amount: 2 }],
  },
  time_warp: {
    id: 'time_warp', name: 'Time Warp', cost: 6, rarity: 'rare',
    description: 'Take an extra turn immediately after this one.',
    effects: [{ kind: 'extra_turn', amount: 1 }],
  },
  arcane_surge: {
    id: 'arcane_surge', name: 'Arcane Surge', cost: 3, rarity: 'rare',
    description: 'Deal 4 damage. Draw 3 cards. Gain 2 mana this turn.',
    effects: [{ kind: 'damage', amount: 4 }, { kind: 'draw', amount: 3 }, { kind: 'gain_mana', amount: 2 }],
  },
  blood_ritual: {
    id: 'blood_ritual', name: 'Blood Ritual', cost: 0, rarity: 'rare',
    description: 'Lose half your current HP. Gain that much mana this turn.',
    effects: [],
    dynamic: 'blood_ritual',
  },
  phoenix_flame: {
    id: 'phoenix_flame', name: 'Phoenix Flame', cost: 5, rarity: 'rare',
    description: 'Heal 10 HP. Burn: 2 damage for 3 turns.',
    effects: [{ kind: 'heal', amount: 10 }, { kind: 'burn', amount: 2, turns: 3 }],
  },
  soul_drain: {
    id: 'soul_drain', name: 'Soul Drain', cost: 4, rarity: 'rare',
    description: 'Deal 5 damage. Steal 2 random cards from the opponent.',
    effects: [{ kind: 'damage', amount: 5 }, { kind: 'steal', amount: 2 }],
  },
  dimensional_rift: {
    id: 'dimensional_rift', name: 'Dimensional Rift', cost: 3, rarity: 'rare',
    description: 'Discard your hand. Draw 6 cards.',
    effects: [{ kind: 'discard_hand', amount: 0, selfTarget: true }, { kind: 'draw', amount: 6 }],
  },
  last_gasp: {
    id: 'last_gasp', name: 'Last Gasp', cost: 0, rarity: 'rare',
    description: 'Deal damage equal to your missing HP.',
    effects: [],
    dynamic: 'last_gasp',
  },
  archmages_wrath: {
    id: 'archmages_wrath', name: "Archmage's Wrath", cost: 7, rarity: 'rare',
    description: 'Deal 12 damage.',
    effects: [{ kind: 'damage', amount: 12 }],
  },
};

/** All card ids grouped by rarity — used by the draft + deck validation. */
export const CARDS_BY_RARITY: Record<Rarity, CardId[]> = {
  common:   (Object.values(CARDS).filter(c => c.rarity === 'common')   as CardDef[]).map(c => c.id),
  uncommon: (Object.values(CARDS).filter(c => c.rarity === 'uncommon') as CardDef[]).map(c => c.id),
  rare:     (Object.values(CARDS).filter(c => c.rarity === 'rare')     as CardDef[]).map(c => c.id),
};

// =====================================================================
// Draft configuration
// ---------------------------------------------------------------------
// Pre-duel draft: over DRAFT_ROUNDS rounds, each player picks 2 commons (of 5
// shown) + 1 uncommon (of 5), and on every 2nd round 1 rare (of 3). That lands
// every player at exactly 20 commons / 10 uncommons / 5 rares = a 35-card deck,
// while respecting MAX_COPIES. Both players draft simultaneously and privately.
// =====================================================================
export const DRAFT_ROUNDS          = 10;
export const DRAFT_COMMON_OFFER    = 5;
export const DRAFT_COMMON_PICK     = 2;
export const DRAFT_UNCOMMON_OFFER  = 5;
export const DRAFT_UNCOMMON_PICK   = 1;
export const DRAFT_RARE_OFFER      = 3;
export const DRAFT_RARE_PICK       = 1;   // only on even rounds
/** Rares appear for drafting on these rounds (every 2nd → 5 rares total). */
export const isRareRound = (round: number): boolean => round % 2 === 0;

/** Final deck composition each player ends up with. */
export const DRAFT_DECK_COMMONS   = DRAFT_ROUNDS * DRAFT_COMMON_PICK;      // 20
export const DRAFT_DECK_UNCOMMONS = DRAFT_ROUNDS * DRAFT_UNCOMMON_PICK;    // 10
export const DRAFT_DECK_RARES     = (DRAFT_ROUNDS / 2) * DRAFT_RARE_PICK;  // 5
export const DRAFT_DECK_SIZE      = DRAFT_DECK_COMMONS + DRAFT_DECK_UNCOMMONS + DRAFT_DECK_RARES; // 35

export type PlayerState = {
  /** Profile data, copied in at join time so the board doesn't need to
      cross-reference room_players for names/colors. */
  playerId: string;
  username: string;
  accent_color?: string;

  hp: number;
  mana: number;
  maxMana: number;
  /** Extra mana usable THIS TURN only (cleared on turn end). Pays first. */
  manaBonusThisTurn: number;

  deck: CardId[];          // top of deck = index 0
  hand: CardId[];
  discard: CardId[];

  cardsPlayedThisTurn: number;
  pendingTriggers: Trigger[];

  /** Active damage-over-time effects. Each ticks at the START of this player's
   *  turn for `amount` damage, then `turns` decrements; removed at 0. */
  burns: { amount: number; turns: number; source: string }[];
  /** Set when an opponent silences this player; cleared at the end of this
   *  player's next turn. While true, the listed category can't be cast. */
  silencedDamage?: boolean;
  silencedUtility?: boolean;
  /** Time Warp: this player takes another turn instead of passing. */
  extraTurn?: boolean;
};

/**
 * Structured event log. Each event is a typed record of "what happened" — the
 * board derives display text from it (eventText) AND can latch onto specific
 * kinds for animations later (damage flashes, card-fly tweens, etc.).
 *
 * Adding a new event kind:
 *   1. Extend SDEvent below
 *   2. Push it from the engine (resolveEffect / applyMove)
 *   3. Add a case in eventText() so it renders
 */
export type SDEvent =
  /** Free-form system message (turn announcements, match start). */
  | { kind: 'system'; text: string }
  | { kind: 'turn_started'; seat: Seat; username: string }
  | { kind: 'card_play'; seat: Seat; username: string; cardId: CardId; cardName: string }
  | { kind: 'damage'; from: Seat; to: Seat; toName: string; amount: number }
  | { kind: 'damage_prevented'; to: Seat; toName: string; amount: number; source: string }
  | { kind: 'heal'; seat: Seat; username: string; amount: number }
  | { kind: 'draw'; seat: Seat; username: string; amount: number }
  | { kind: 'force_discard'; from: Seat; fromName: string; by: Seat; amount: number }
  | { kind: 'gain_mana'; seat: Seat; username: string; amount: number }
  | { kind: 'pay_hp'; seat: Seat; username: string; amount: number }
  | { kind: 'trigger_armed'; seat: Seat; username: string; source: string }
  | { kind: 'burn_applied'; to: Seat; toName: string; amount: number; turns: number }
  | { kind: 'burn_tick'; seat: Seat; username: string; amount: number }
  | { kind: 'shield_absorbed'; to: Seat; toName: string; amount: number; source: string }
  | { kind: 'silenced'; to: Seat; toName: string; mode: 'damage' | 'utility' }
  | { kind: 'steal'; by: Seat; byName: string; from: Seat; amount: number }
  | { kind: 'copy_spell'; seat: Seat; username: string; cardName: string }
  | { kind: 'extra_turn'; seat: Seat; username: string }
  | { kind: 'reaction_window'; reactor: Seat; reactorName: string; caster: Seat; cardName: string }
  | { kind: 'countered'; reactor: Seat; reactorName: string; cardName: string }
  | { kind: 'reflected'; reactor: Seat; reactorName: string; caster: Seat; cardName: string; amount: number }
  | { kind: 'game_ended'; winner: Seat | 'draw'; winnerName?: string };

/** One seat's private draft progress. Both seats draft simultaneously before
 *  the duel begins; the engine builds each seat's deck from `picked` once both
 *  finish all rounds. `offer` holds the cards currently on the table for this
 *  round; the player removes cards from it as they pick. */
export type DraftSeatState = {
  round: number;                 // 1..DRAFT_ROUNDS (current round)
  picked: CardId[];              // cards drafted so far (becomes the deck)
  offer: { common: CardId[]; uncommon: CardId[]; rare: CardId[] };
  /** Remaining picks owed this round, by rarity. */
  need: { common: number; uncommon: number; rare: number };
  done: boolean;                 // finished all rounds
};

export type SDState = {
  version?: number;
  phase: 'lobby' | 'drafting' | 'playing' | 'finished';
  seats: { A?: string; B?: string };
  players: { A: PlayerState; B: PlayerState };
  currentSeat: Seat;
  turn: number;
  log: SDEvent[];
  winner: Seat | 'draw' | null;
  /** The last spell each seat cast (most recent), for Mirror to copy. A spell
   *  is recorded only if it had real effects (Counter/Fade/Mirror don't count). */
  lastSpell?: { A?: CardId; B?: CardId };
  /** Set while a spell is mid-cast and the opponent holds a playable reaction.
   *  The game is paused: only the reactor may act (play_reaction / pass_reaction),
   *  and the original spell resolves (or is cancelled) once they respond. The
   *  cast card is ALREADY in the caster's discard and its cost already paid. */
  pendingReaction?: {
    casterSeat: Seat;
    reactorSeat: Seat;
    cardId: CardId;
    targets: ResolvedTarget[];
  };
  /** Present only while phase === 'drafting'. Both seats draft their deck in
   *  parallel; the duel begins once both are `done`. */
  draft?: { A: DraftSeatState; B: DraftSeatState };
};

/** Returns the seat the event "belongs to" for color-coding in the UI. */
export function eventSeat(ev: SDEvent): Seat | 'system' {
  switch (ev.kind) {
    case 'system': case 'game_ended':       return 'system';
    case 'turn_started': case 'card_play':  return ev.seat;
    case 'damage':                          return ev.from;
    case 'damage_prevented':                return ev.to;
    case 'heal': case 'draw': case 'gain_mana':
    case 'pay_hp': case 'trigger_armed':
    case 'burn_tick': case 'copy_spell':
    case 'extra_turn':                      return ev.seat;
    case 'force_discard':                   return ev.by;
    case 'burn_applied': case 'shield_absorbed':
    case 'silenced':                        return ev.to;
    case 'steal':                           return ev.by;
    case 'reaction_window': case 'countered':
    case 'reflected':                       return ev.reactor;
  }
}

/** Renders an event as a display string. Spectators (no viewerSeat) get a
 *  neutral phrasing; seated players get "you / opponent" personalization. */
export function eventText(ev: SDEvent, viewerSeat: Seat | null = null): string {
  const isMe = (s: Seat) => viewerSeat !== null && s === viewerSeat;
  const youOr = (s: Seat, name: string) => isMe(s) ? 'You' : name;
  const yourOr = (s: Seat, name: string) => isMe(s) ? 'Your' : `${name}'s`;
  switch (ev.kind) {
    case 'system':            return ev.text;
    case 'turn_started':      return `${youOr(ev.seat, ev.username)}${isMe(ev.seat) ? "'re" : "'s"} turn.`;
    case 'card_play':         return `${youOr(ev.seat, ev.username)} played ${ev.cardName}.`;
    case 'damage':            return `${youOr(ev.from, '?')} dealt ${ev.amount} damage to ${youOr(ev.to, ev.toName)}.`;
    case 'damage_prevented':  return `${ev.source} prevented ${ev.amount} damage on ${youOr(ev.to, ev.toName)}.`;
    case 'heal':              return `${youOr(ev.seat, ev.username)} healed ${ev.amount}.`;
    case 'draw':              return `${youOr(ev.seat, ev.username)} drew ${ev.amount} card${ev.amount === 1 ? '' : 's'}.`;
    case 'force_discard':     return `${youOr(ev.from, ev.fromName)} discarded ${ev.amount}.`;
    case 'gain_mana':         return `${youOr(ev.seat, ev.username)} gained ${ev.amount} mana (this turn).`;
    case 'pay_hp':            return `${youOr(ev.seat, ev.username)} paid ${ev.amount} HP.`;
    case 'trigger_armed':     return `${youOr(ev.seat, ev.username)} armed ${ev.source}.`;
    case 'burn_applied':      return `${yourOr(ev.to, ev.toName)} burning — ${ev.amount}/turn for ${ev.turns} turn${ev.turns === 1 ? '' : 's'}.`;
    case 'burn_tick':         return `${youOr(ev.seat, ev.username)} took ${ev.amount} burn damage.`;
    case 'shield_absorbed':   return `${ev.source} absorbed ${ev.amount} damage on ${youOr(ev.to, ev.toName)}.`;
    case 'silenced':          return `${youOr(ev.to, ev.toName)} ${isMe(ev.to) ? 'are' : 'is'} silenced (${ev.mode === 'damage' ? 'no damage spells' : 'no utility spells'} next turn).`;
    case 'steal':             return `${youOr(ev.by, ev.byName)} stole ${ev.amount} card${ev.amount === 1 ? '' : 's'} from ${youOr(ev.from, '?')}.`;
    case 'copy_spell':        return `${youOr(ev.seat, ev.username)} copied ${ev.cardName}.`;
    case 'extra_turn':        return `${youOr(ev.seat, ev.username)} ${isMe(ev.seat) ? 'take' : 'takes'} an extra turn!`;
    case 'reaction_window':   return `${youOr(ev.caster, '?')} ${isMe(ev.caster) ? 'are' : 'is'} casting ${ev.cardName} — ${youOr(ev.reactor, ev.reactorName)} may react.`;
    case 'countered':         return `${youOr(ev.reactor, ev.reactorName)} countered ${ev.cardName}!`;
    case 'reflected':         return `${youOr(ev.reactor, ev.reactorName)} reflected ${ev.cardName} — ${ev.amount} damage back at ${youOr(ev.caster, '?')}.`;
    case 'game_ended':
      return ev.winner === 'draw' ? 'Match drawn.'
        : viewerSeat === ev.winner ? 'You won the duel.'
        : viewerSeat !== null      ? 'You were defeated.'
        : `${ev.winnerName ?? ev.winner} won the duel.`;
  }
}

// =====================================================================
// Construction helpers
// =====================================================================

function emptyPlayer(): PlayerState {
  return {
    playerId: '', username: '',
    hp: STARTING_HP, mana: 0, maxMana: 0, manaBonusThisTurn: 0,
    deck: [], hand: [], discard: [],
    cardsPlayedThisTurn: 0, pendingTriggers: [],
    burns: [],
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =====================================================================
// Draft helpers
// =====================================================================

function copiesOf(picked: CardId[], id: CardId): number {
  let n = 0;
  for (const c of picked) if (c === id) n++;
  return n;
}

/** Card ids of a rarity the player hasn't yet maxed out (respects MAX_COPIES;
 *  rares cap at 1 so a drafted rare never reappears). */
function draftableInRarity(picked: CardId[], rarity: Rarity): CardId[] {
  const max = MAX_COPIES[rarity];
  return CARDS_BY_RARITY[rarity].filter(id => copiesOf(picked, id) < max);
}

/** Up to `n` distinct random cards from `pool`. */
function sampleN(pool: CardId[], n: number): CardId[] {
  return shuffle([...pool]).slice(0, Math.min(n, pool.length));
}

/** The cards on the table for `round`, given what the player has already drafted. */
function makeDraftOffer(picked: CardId[], round: number): DraftSeatState['offer'] {
  return {
    common:   sampleN(draftableInRarity(picked, 'common'),   DRAFT_COMMON_OFFER),
    uncommon: sampleN(draftableInRarity(picked, 'uncommon'), DRAFT_UNCOMMON_OFFER),
    rare:     isRareRound(round) ? sampleN(draftableInRarity(picked, 'rare'), DRAFT_RARE_OFFER) : [],
  };
}

/** Picks owed this round, by rarity (rares only on even rounds). */
function makeDraftNeed(round: number): DraftSeatState['need'] {
  return {
    common:   DRAFT_COMMON_PICK,
    uncommon: DRAFT_UNCOMMON_PICK,
    rare:     isRareRound(round) ? DRAFT_RARE_PICK : 0,
  };
}

function newDraftSeat(): DraftSeatState {
  return { round: 1, picked: [], offer: makeDraftOffer([], 1), need: makeDraftNeed(1), done: false };
}

/** Apply one draft pick for `seat`, advancing the round (and finishing the
 *  draft / starting the duel) as needed. Mutates and returns `next`. */
function applyDraftPick(next: SDState, seat: Seat, cardId: CardId): SDState | { error: string } {
  const d = next.draft;
  if (!d) return { error: 'Not in the draft phase' };
  const ds = d[seat];
  if (ds.done) return { error: 'You have finished drafting.' };
  const card = CARDS[cardId];
  if (!card) return { error: 'Unknown card' };
  const rarity = card.rarity;
  if (ds.need[rarity] <= 0) return { error: `No ${rarity} picks remaining this round.` };
  const idx = ds.offer[rarity].indexOf(cardId);
  if (idx < 0) return { error: 'That card is not on offer.' };

  // Take the card off the table and into the deck.
  ds.offer[rarity].splice(idx, 1);
  ds.picked.push(cardId);
  ds.need[rarity]--;

  // Round finished? Advance or finish the whole draft.
  if (ds.need.common === 0 && ds.need.uncommon === 0 && ds.need.rare === 0) {
    if (ds.round >= DRAFT_ROUNDS) {
      ds.done = true;
      ds.offer = { common: [], uncommon: [], rare: [] };
    } else {
      ds.round++;
      ds.offer = makeDraftOffer(ds.picked, ds.round);
      ds.need = makeDraftNeed(ds.round);
    }
  }

  // Both players done → build decks and begin the duel.
  if (d.A.done && d.B.done) return finalizeDraftAndStart(next);
  return next;
}

/** Build each seat's deck from their drafted cards, deal opening hands, pick a
 *  random first player, and flip into the playing phase. */
function finalizeDraftAndStart(next: SDState): SDState {
  for (const seat of ['A', 'B'] as Seat[]) {
    const p = next.players[seat];
    p.deck = shuffle([...next.draft![seat].picked]);
    p.hand = [];
    p.discard = [];
    drawCards(p, STARTING_HAND_SIZE);
  }
  next.draft = undefined;
  next.phase = 'playing';
  next.currentSeat = Math.random() < 0.5 ? 'A' : 'B';
  next.players[next.currentSeat].maxMana = 1;
  next.players[next.currentSeat].mana = 1;
  next.log.push({ kind: 'system', text: 'Decks locked in — the duel begins!' });
  next.log.push({
    kind: 'turn_started',
    seat: next.currentSeat,
    username: next.players[next.currentSeat].username,
  });
  return next;
}

/** Test/fuzzer helper: auto-pick the first available card every step until the
 *  draft completes and the duel starts. Deterministic given the RNG seed. */
export function autoCompleteDraft(state: SDState): SDState {
  let s = state;
  let guard = 0;
  while (s.phase === 'drafting' && s.draft && guard++ < 2000) {
    const d = s.draft;
    const seat: Seat = !d.A.done ? 'A' : 'B';
    const ds = d[seat];
    const rarity: Rarity =
      ds.need.common > 0 ? 'common' : ds.need.uncommon > 0 ? 'uncommon' : 'rare';
    const cardId = ds.offer[rarity][0];
    const playerId = s.seats[seat];
    if (!cardId || !playerId) break;
    const res = applyMove(s, { kind: 'draft_pick', cardId }, playerId);
    if ('error' in res) break;
    s = res;
  }
  return s;
}

export function initialState(): SDState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    seats: {},
    players: { A: emptyPlayer(), B: emptyPlayer() },
    currentSeat: 'A',
    turn: 1,
    log: [],
    winner: null,
  };
}

/** Builds a lobby state with the host seated as A. Decks are NOT dealt here —
 *  both players build their decks via the draft once the second player joins. */
export function createInitialStateForHost(host: {
  userId: string; username: string; accent_color?: string;
}): SDState {
  const s = initialState();
  s.seats.A = host.userId;
  s.players.A = {
    ...emptyPlayer(),
    playerId: host.userId,
    username: host.username,
    accent_color: host.accent_color,
  };
  return s;
}

/** Called by joinRoom when the second player joins. Fills in seat B and opens
 *  the pre-duel DRAFT — both players build their decks before the duel begins.
 *  (Name kept for the actions.ts call site; it now starts the draft, not play.) */
export function seatJoinerAndStart(
  state: SDState,
  joiner: { userId: string; username: string; accent_color?: string },
): SDState {
  if (state.seats.B) return state;
  const next = JSON.parse(JSON.stringify(state)) as SDState;
  next.seats.B = joiner.userId;
  next.players.B.playerId = joiner.userId;
  next.players.B.username = joiner.username;
  next.players.B.accent_color = joiner.accent_color;
  next.phase = 'drafting';
  next.draft = { A: newDraftSeat(), B: newDraftSeat() };
  next.log.push({ kind: 'system', text: 'Draft started — pick your cards to build a deck.' });
  return next;
}

export function removePlayer(state: SDState, playerId: string): SDState {
  // Spellduel doesn't support removing once playing (use the resign / abandon
  // flow). In lobby phase, just clear the seat.
  if (state.phase !== 'lobby') return state;
  const next = JSON.parse(JSON.stringify(state)) as SDState;
  for (const seat of ['A', 'B'] as Seat[]) {
    if (state.seats[seat] === playerId) {
      next.seats[seat] = undefined;
      next.players[seat] = emptyPlayer();
    }
  }
  return next;
}

// =====================================================================
// Core helpers
// =====================================================================

function opp(seat: Seat): Seat { return seat === 'A' ? 'B' : 'A'; }
function effectiveMana(p: PlayerState): number { return p.mana + p.manaBonusThisTurn; }

function drawCards(p: PlayerState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0 && p.discard.length > 0) {
      p.deck = shuffle(p.discard);
      p.discard = [];
    }
    if (p.deck.length === 0) return;
    p.hand.push(p.deck.shift()!);
  }
}

/** Pay `cost` mana — bonus first (use-it-or-lose-it), then permanent mana.
 *  Caller has already verified the player can afford it. */
function payMana(p: PlayerState, cost: number): void {
  const fromBonus = Math.min(cost, p.manaBonusThisTurn);
  p.manaBonusThisTurn -= fromBonus;
  p.mana -= (cost - fromBonus);
}

// =====================================================================
// Effect resolution
// =====================================================================

/** Resolve which seat an effect actually affects. If the effect has a
 *  `targetIdx`, look up the picked target; otherwise fall back to the
 *  per-effect implicit target (opponent for damage/force_discard, self
 *  for everything else). */
function resolveTargetSeat(
  caster: Seat,
  defaultSeat: Seat,
  effect: Effect,
  targets: ResolvedTarget[],
): Seat {
  if (effect.targetIdx === undefined) return defaultSeat;
  const t = targets[effect.targetIdx];
  // Defensive fallback if the targets array got truncated somehow; engine
  // validation in applyMove rejects this case up front anyway.
  if (!t || t.kind !== 'player') return defaultSeat;
  return t.seat;
}

/** Deal `amount` damage to `targetSeat` from `caster`, applying the target's
 *  defensive triggers in FIFO order: `prevent_damage` (Counter — fully blocks
 *  one instance, then consumed) and `shield` (absorbs up to its pool across
 *  instances, breaking only when depleted). Logs what actually lands. */
function dealDamage(state: SDState, caster: Seat, targetSeat: Seat, amount: number): void {
  const target = state.players[targetSeat];
  let remaining = amount;
  for (let i = 0; i < target.pendingTriggers.length && remaining > 0; i++) {
    const t = target.pendingTriggers[i];
    if (t.kind === 'prevent_damage') {
      const prevented = Math.min(remaining, t.amount);
      remaining -= prevented;
      target.pendingTriggers.splice(i, 1); i--;
      state.log.push({ kind: 'damage_prevented', to: targetSeat, toName: target.username, amount: prevented, source: t.source });
    } else if (t.kind === 'shield') {
      const absorbed = Math.min(remaining, t.amount);
      remaining -= absorbed;
      t.amount -= absorbed;
      state.log.push({ kind: 'shield_absorbed', to: targetSeat, toName: target.username, amount: absorbed, source: t.source });
      if (t.amount <= 0) { target.pendingTriggers.splice(i, 1); i--; }
    }
  }
  if (remaining > 0) {
    target.hp -= remaining;
    state.log.push({ kind: 'damage', from: caster, to: targetSeat, toName: target.username, amount: remaining });
  }
}

/** Tick all active burns on `seat` (fires at the start of their turn). Burn
 *  damage is unpreventable (DoT ignores shields/counters). Returns nothing;
 *  caller checks the winner afterward (a burn can be lethal). */
function tickBurns(state: SDState, seat: Seat): void {
  const p = state.players[seat];
  if (p.burns.length === 0) return;
  let total = 0;
  for (const b of p.burns) { total += b.amount; b.turns -= 1; }
  p.burns = p.burns.filter(b => b.turns > 0);
  if (total > 0) {
    p.hp -= total;
    state.log.push({ kind: 'burn_tick', seat, username: p.username, amount: total });
  }
}

/** Apply ONE effect, mutating `state` in place. `caster` is the seat that
 *  played the card; `targets` are the player-picked targets from the action. */
function resolveEffect(
  state: SDState,
  caster: Seat,
  effect: Effect,
  targets: ResolvedTarget[],
): void {
  switch (effect.kind) {
    case 'damage': {
      const targetSeat = resolveTargetSeat(caster, opp(caster), effect, targets);
      dealDamage(state, caster, targetSeat, effect.amount);
      break;
    }
    case 'burn': {
      const targetSeat = resolveTargetSeat(caster, opp(caster), effect, targets);
      const target = state.players[targetSeat];
      const turns = effect.turns ?? 1;
      target.burns.push({ amount: effect.amount, turns, source: 'Burn' });
      state.log.push({ kind: 'burn_applied', to: targetSeat, toName: target.username, amount: effect.amount, turns });
      break;
    }
    case 'silence': {
      const targetSeat = resolveTargetSeat(caster, opp(caster), effect, targets);
      const target = state.players[targetSeat];
      if (effect.mode === 'damage') target.silencedDamage = true;
      else target.silencedUtility = true;
      state.log.push({ kind: 'silenced', to: targetSeat, toName: target.username, mode: effect.mode ?? 'damage' });
      break;
    }
    case 'steal': {
      const fromSeat = opp(caster);
      const from = state.players[fromSeat];
      const me = state.players[caster];
      let stolen = 0;
      for (let i = 0; i < effect.amount && from.hand.length > 0; i++) {
        const idx = Math.floor(Math.random() * from.hand.length);
        me.hand.push(from.hand.splice(idx, 1)[0]);
        stolen++;
      }
      if (stolen > 0) {
        state.log.push({ kind: 'steal', by: caster, byName: me.username, from: fromSeat, amount: stolen });
      }
      break;
    }
    case 'discard_hand': {
      const targetSeat = effect.selfTarget ? caster : opp(caster);
      const target = state.players[targetSeat];
      const n = target.hand.length;
      if (n > 0) {
        target.discard.push(...target.hand);
        target.hand = [];
        state.log.push({ kind: 'force_discard', from: targetSeat, fromName: target.username, by: caster, amount: n });
      }
      break;
    }
    case 'opponent_draw': {
      const targetSeat = opp(caster);
      const target = state.players[targetSeat];
      const before = target.hand.length;
      drawCards(target, effect.amount);
      const drew = target.hand.length - before;
      if (drew > 0) state.log.push({ kind: 'draw', seat: targetSeat, username: target.username, amount: drew });
      break;
    }
    case 'copy_last_spell': {
      const last = state.lastSpell?.[opp(caster)];
      if (last && CARDS[last]) {
        const copied = CARDS[last];
        state.log.push({ kind: 'copy_spell', seat: caster, username: state.players[caster].username, cardName: copied.name });
        const copiedEffects = copied.dynamic ? resolveDynamic(state, caster, copied) : copied.effects;
        // Copying ignores the copied card's own targets (re-targeting is
        // ambiguous); only fire its non-targeted effects. Targeted-only cards
        // (e.g. Hex) thus fizzle when copied — acceptable for v1.
        for (const e of copiedEffects) {
          if (e.targetIdx === undefined) resolveEffect(state, caster, e, []);
        }
      } else {
        state.log.push({ kind: 'system', text: `${state.players[caster].username}: Mirror fizzled — no spell to copy.` });
      }
      break;
    }
    case 'extra_turn': {
      state.players[caster].extraTurn = true;
      break;
    }
    case 'heal': {
      const targetSeat = resolveTargetSeat(caster, caster, effect, targets);
      const target = state.players[targetSeat];
      const healed = Math.min(effect.amount, STARTING_HP - target.hp);
      target.hp += healed;
      if (healed > 0) {
        state.log.push({ kind: 'heal', seat: targetSeat, username: target.username, amount: healed });
      }
      break;
    }
    case 'draw': {
      const targetSeat = resolveTargetSeat(caster, caster, effect, targets);
      const target = state.players[targetSeat];
      const before = target.hand.length;
      drawCards(target, effect.amount);
      const drew = target.hand.length - before;
      state.log.push({ kind: 'draw', seat: targetSeat, username: target.username, amount: drew });
      break;
    }
    case 'force_discard': {
      const targetSeat = resolveTargetSeat(caster, opp(caster), effect, targets);
      const target = state.players[targetSeat];
      let discarded = 0;
      for (let i = 0; i < effect.amount && target.hand.length > 0; i++) {
        const idx = Math.floor(Math.random() * target.hand.length);
        target.discard.push(target.hand.splice(idx, 1)[0]);
        discarded++;
      }
      if (discarded > 0) {
        state.log.push({
          kind: 'force_discard', from: targetSeat, fromName: target.username, by: caster, amount: discarded,
        });
      }
      break;
    }
    case 'gain_mana': {
      const targetSeat = resolveTargetSeat(caster, caster, effect, targets);
      const target = state.players[targetSeat];
      target.manaBonusThisTurn += effect.amount;
      state.log.push({ kind: 'gain_mana', seat: targetSeat, username: target.username, amount: effect.amount });
      break;
    }
    case 'lose_hp': {
      const targetSeat = resolveTargetSeat(caster, caster, effect, targets);
      const target = state.players[targetSeat];
      // Bypass prevent_damage — self-payment, not damage.
      target.hp -= effect.amount;
      state.log.push({ kind: 'pay_hp', seat: targetSeat, username: target.username, amount: effect.amount });
      break;
    }
  }
}

/** Returns null if the picked targets satisfy the card's `targets[]` spec,
 *  otherwise an error message. Spec mismatches are rejected at applyMove
 *  time so cheaters can't fabricate an invalid target index. */
function validateTargets(card: CardDef, targets: ResolvedTarget[]): string | null {
  const specs = card.targets ?? [];
  if (targets.length !== specs.length) {
    return `Expected ${specs.length} target${specs.length === 1 ? '' : 's'}, got ${targets.length}`;
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const t = targets[i];
    if (spec.kind === 'any_player') {
      if (!t || t.kind !== 'player' || (t.seat !== 'A' && t.seat !== 'B')) {
        return `Target ${i + 1} must be a player`;
      }
    }
  }
  return null;
}

/** Some cards build their effects dynamically from state at play time. */
function resolveDynamic(state: SDState, caster: Seat, card: CardDef): Effect[] {
  const me = state.players[caster];
  if (card.dynamic === 'combo') {
    // cardsPlayedThisTurn already incremented before resolution; so 3+ means
    // THIS is the 3rd or later card played this turn.
    const amount = me.cardsPlayedThisTurn >= 3 ? 5 : 1;
    return [{ kind: 'damage', amount }];
  }
  if (card.dynamic === 'last_gasp') {
    // Deal damage equal to your missing HP (more desperate = more powerful).
    const missing = Math.max(0, STARTING_HP - me.hp);
    return [{ kind: 'damage', amount: missing }];
  }
  if (card.dynamic === 'blood_ritual') {
    // Lose half your CURRENT HP (rounded down), gain that much mana this turn.
    const half = Math.floor(me.hp / 2);
    return [{ kind: 'lose_hp', amount: half }, { kind: 'gain_mana', amount: half }];
  }
  return [];
}

/** True if a card counts as a "damage spell" for silence purposes. */
function cardDealsDamage(card: CardDef): boolean {
  if (card.effects.some(e => e.kind === 'damage' || e.kind === 'burn')) return true;
  return card.dynamic === 'combo' || card.dynamic === 'last_gasp';
}

/** Returns the winning seat ('A' | 'B' | 'draw') if this move ended the
 *  match, or null if it didn't. Mutates `state.winner` + `state.phase`. */
function checkWinner(state: SDState): Seat | 'draw' | null {
  const aDead = state.players.A.hp <= 0;
  const bDead = state.players.B.hp <= 0;
  if (aDead && bDead) {
    // Simultaneous KO — whoever just acted wins (their finishing blow landed).
    state.winner = state.currentSeat;
    state.phase = 'finished';
    return state.winner;
  } else if (aDead) {
    state.winner = 'B';
    state.phase = 'finished';
    return 'B';
  } else if (bDead) {
    state.winner = 'A';
    state.phase = 'finished';
    return 'A';
  }
  return null;
}

/** Resolve a cast spell's effects + trigger and record it as the caster's last
 *  spell. Shared by the immediate-cast path and the pass_reaction path so a
 *  spell resolves identically whether or not a reaction window opened first.
 *  The card is assumed already discarded and its cost already paid. */
function resolveCast(state: SDState, caster: Seat, cardId: CardId, targets: ResolvedTarget[]): void {
  const card = CARDS[cardId];
  const me = state.players[caster];
  const effects: Effect[] = card.dynamic ? resolveDynamic(state, caster, card) : card.effects;
  for (const eff of effects) resolveEffect(state, caster, eff, targets);
  if (card.trigger) {
    me.pendingTriggers.push({ ...card.trigger });
    state.log.push({ kind: 'trigger_armed', seat: caster, username: me.username, source: card.trigger.source });
  }
  // Record as the caster's last spell so the opponent's Mirror can copy it —
  // but not Mirror itself (no copy-of-a-copy) and not pure-trigger cards.
  if (cardId !== 'mirror' && effects.length > 0) {
    state.lastSpell = { ...(state.lastSpell ?? {}), [caster]: cardId };
  }
}

/** Indices in `reactorSeat`'s hand of reaction cards that can legally answer
 *  `card` cast by the opponent, given the reactor's currently-available mana.
 *  Counterspell answers anything; Reflect answers only damage spells. The
 *  reactor pays from leftover ("held-up") mana from their own last turn. */
function eligibleReactions(state: SDState, reactorSeat: Seat, card: CardDef): number[] {
  const reactor = state.players[reactorSeat];
  const mana = effectiveMana(reactor);
  const isDamage = cardDealsDamage(card);
  const idxs: number[] = [];
  reactor.hand.forEach((id, i) => {
    const rc = CARDS[id];
    if (!rc?.isReaction) return;
    if (rc.cost > mana) return;
    if (rc.reactionType === 'reflect' && !isDamage) return;
    idxs.push(i);
  });
  return idxs;
}

// =====================================================================
// Public moves
// =====================================================================

export type SDAction =
  | { kind: 'draft_pick'; cardId: CardId }       // pre-duel: take an offered card into your deck
  | { kind: 'play'; cardIdx: number; targets?: ResolvedTarget[] }   // index into the caller's hand
  | { kind: 'play_reaction'; cardIdx: number }  // respond to a pending spell with a reaction card
  | { kind: 'pass_reaction' }                   // decline to react; let the pending spell resolve
  | { kind: 'end_turn' };

export function applyMove(
  state: SDState,
  action: SDAction,
  playerId: string,
): SDState | { error: string } {
  // Draft picks happen during the pre-duel 'drafting' phase, before the normal
  // turn loop — handle them up front (both seats act in parallel here).
  if (action.kind === 'draft_pick') {
    if (state.phase !== 'drafting' || !state.draft) return { error: 'Not in the draft phase' };
    const seat: Seat | null =
      state.seats.A === playerId ? 'A' : state.seats.B === playerId ? 'B' : null;
    if (!seat) return { error: 'You are not seated' };
    const next = JSON.parse(JSON.stringify(state)) as SDState;
    return applyDraftPick(next, seat, action.cardId);
  }

  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  if (state.winner) return { error: 'Match is over' };

  const seat: Seat | null =
    state.seats.A === playerId ? 'A'
    : state.seats.B === playerId ? 'B' : null;
  if (!seat) return { error: 'You are not seated' };

  // Turn gate. During a reaction window only the reactor may act, and only with
  // a reaction response; otherwise it's the current seat's turn as usual.
  if (state.pendingReaction) {
    if (seat !== state.pendingReaction.reactorSeat) {
      return { error: 'Waiting for your opponent to react.' };
    }
    if (action.kind !== 'play_reaction' && action.kind !== 'pass_reaction') {
      return { error: 'You must respond to the spell being cast.' };
    }
  } else {
    if (seat !== state.currentSeat) return { error: "It's not your turn" };
    if (action.kind === 'play_reaction' || action.kind === 'pass_reaction') {
      return { error: 'There is no spell to react to.' };
    }
  }

  const next = JSON.parse(JSON.stringify(state)) as SDState;
  const me = next.players[seat];

  // ---- Reaction responses (out-of-turn) ----
  if (action.kind === 'pass_reaction') {
    const pr = next.pendingReaction!;
    next.pendingReaction = undefined;
    resolveCast(next, pr.casterSeat, pr.cardId, pr.targets);
    const winnerSeat = checkWinner(next);
    if (winnerSeat) {
      next.log.push({
        kind: 'game_ended',
        winner: winnerSeat,
        winnerName: winnerSeat === 'draw' ? undefined : next.players[winnerSeat].username,
      });
    }
    return next;
  }

  if (action.kind === 'play_reaction') {
    const pr = next.pendingReaction!;
    const reactor = me; // the reactor is the acting seat
    if (action.cardIdx < 0 || action.cardIdx >= reactor.hand.length) {
      return { error: 'No card at that index' };
    }
    const rId = reactor.hand[action.cardIdx];
    const rCard = CARDS[rId];
    if (!rCard?.isReaction) return { error: 'That card is not a reaction.' };
    if (effectiveMana(reactor) < rCard.cost) return { error: 'Not enough mana to react.' };
    const pendingCard = CARDS[pr.cardId];
    if (rCard.reactionType === 'reflect' && !cardDealsDamage(pendingCard)) {
      return { error: 'Reflect can only answer a damage spell.' };
    }

    // Pay + discard the reaction card, then close the window.
    reactor.hand.splice(action.cardIdx, 1);
    reactor.discard.push(rId);
    payMana(reactor, rCard.cost);
    next.log.push({ kind: 'card_play', seat, username: reactor.username, cardId: rId, cardName: rCard.name });
    next.pendingReaction = undefined;

    if (rCard.reactionType === 'counter') {
      // The pending spell fizzles — it's already discarded and paid for, so
      // nothing resolves. Its caster simply loses the card.
      next.log.push({ kind: 'countered', reactor: seat, reactorName: reactor.username, cardName: pendingCard.name });
    } else {
      // Reflect: resolve the pending spell as though the reactor cast it, so
      // its opponent-targeted damage/burn lands on the original caster instead.
      const victim = next.players[pr.casterSeat];
      const before = victim.hp;
      resolveCast(next, seat, pr.cardId, pr.targets);
      const dealt = Math.max(0, before - victim.hp);
      next.log.push({
        kind: 'reflected', reactor: seat, reactorName: reactor.username,
        caster: pr.casterSeat, cardName: pendingCard.name, amount: dealt,
      });
    }

    const winnerSeat = checkWinner(next);
    if (winnerSeat) {
      next.log.push({
        kind: 'game_ended',
        winner: winnerSeat,
        winnerName: winnerSeat === 'draw' ? undefined : next.players[winnerSeat].username,
      });
    }
    return next;
  }

  if (action.kind === 'play') {
    if (action.cardIdx < 0 || action.cardIdx >= me.hand.length) {
      return { error: 'No card at that index' };
    }
    const cardId = me.hand[action.cardIdx];
    const card = CARDS[cardId];
    if (!card) return { error: 'Unknown card' };
    if (card.isReaction) {
      return { error: 'Reaction cards can only be played in response to an opponent spell.' };
    }
    if (effectiveMana(me) < card.cost) return { error: 'Not enough mana' };

    // Silence gate: a silenced player can't cast the locked-out category.
    if (cardDealsDamage(card) && me.silencedDamage) {
      return { error: "You're silenced — can't cast damage spells this turn." };
    }
    if (!cardDealsDamage(card) && me.silencedUtility) {
      return { error: "You're silenced — can't cast non-damage spells this turn." };
    }

    // Validate the player's picked targets against the card's TargetSpec.
    const targets = action.targets ?? [];
    const tErr = validateTargets(card, targets);
    if (tErr) return { error: tErr };

    // Discard card and pay cost FIRST (so combo's count is correct + cost
    // is locked in even if the effect ends the game).
    me.hand.splice(action.cardIdx, 1);
    me.discard.push(cardId);
    me.cardsPlayedThisTurn++;
    payMana(me, card.cost);
    next.log.push({ kind: 'card_play', seat, username: me.username, cardId, cardName: card.name });

    // Reaction window: if the opponent holds a playable reaction, pause the
    // spell mid-cast (card already discarded + paid) and let them respond
    // before its effects resolve. The spell completes via pass_reaction or is
    // cancelled/bounced via play_reaction.
    const reactorSeat = opp(seat);
    if (eligibleReactions(next, reactorSeat, card).length > 0) {
      next.pendingReaction = { casterSeat: seat, reactorSeat, cardId, targets };
      next.log.push({
        kind: 'reaction_window', reactor: reactorSeat,
        reactorName: next.players[reactorSeat].username, caster: seat, cardName: card.name,
      });
      return next;
    }

    // No reaction available — resolve immediately.
    resolveCast(next, seat, cardId, targets);

    const winnerSeat = checkWinner(next);
    if (winnerSeat) {
      next.log.push({
        kind: 'game_ended',
        winner: winnerSeat,
        winnerName: winnerSeat === 'draw' ? undefined : next.players[winnerSeat].username,
      });
    }
    return next;
  }

  if (action.kind === 'end_turn') {
    // The ending player's per-turn state resets and their silence clears.
    me.manaBonusThisTurn = 0;
    me.cardsPlayedThisTurn = 0;
    me.silencedDamage = false;
    me.silencedUtility = false;

    // Time Warp: take another turn instead of passing.
    if (me.extraTurn) {
      me.extraTurn = false;
      next.log.push({ kind: 'extra_turn', seat, username: me.username });
      beginTurn(next, seat);
    } else {
      beginTurn(next, opp(seat));
    }

    // A start-of-turn burn can be lethal — resolve the win if so.
    const winnerSeat = checkWinner(next);
    if (winnerSeat) {
      next.log.push({
        kind: 'game_ended',
        winner: winnerSeat,
        winnerName: winnerSeat === 'draw' ? undefined : next.players[winnerSeat].username,
      });
    }
    return next;
  }

  return { error: 'Unknown action' };
}

/** Begin `seat`'s turn: ramp + refill mana, draw 1, tick any burns, announce.
 *  Burns tick at the very start (upkeep) and can be lethal — the caller checks
 *  the winner afterward. */
function beginTurn(state: SDState, seat: Seat): void {
  const p = state.players[seat];
  state.currentSeat = seat;
  state.turn++;
  p.maxMana = Math.min(MAX_MANA, p.maxMana + 1);
  p.mana = p.maxMana;
  drawCards(p, 1);
  tickBurns(state, seat);
  state.log.push({ kind: 'turn_started', seat, username: p.username });
}

// =====================================================================
// Cap log size so the JSON doesn't grow unboundedly across long matches.
// Called from the server action after each state update.
// =====================================================================

export const LOG_MAX = 25;
export function trimLog(state: SDState): SDState {
  if (state.log.length <= LOG_MAX) return state;
  return { ...state, log: state.log.slice(-LOG_MAX) };
}

// =====================================================================
// Migration (registered on the GameDef so old in-flight states keep working
// after we change the shape). Currently handles v1 → v2: convert the old
// LogEntry { seat, text } records into SDEvent { kind: 'system', text }.
// =====================================================================

export function migrateState(raw: unknown): SDState {
  const s = (raw ?? {}) as Partial<SDState> & { log?: unknown[] };
  const version = s.version ?? 1;
  if (version >= STATE_VERSION) return s as SDState;

  // v1 → v2: string-style log → structured-event log
  const migratedLog: SDEvent[] = Array.isArray(s.log)
    ? s.log.map((entry) => {
        const e = entry as { kind?: string; seat?: unknown; text?: string };
        if (e && typeof e === 'object' && typeof e.kind === 'string') return entry as SDEvent;
        return { kind: 'system', text: e?.text ?? '' };
      })
    : (s.log as SDEvent[] | undefined) ?? [];

  // v2 → v3: each player gained a `burns` array (DoT tracking). Ensure it exists
  //          so in-flight games don't crash when burns are read.
  // v3 → v4: added the optional `draft` field + 'drafting' phase. In-flight v3
  //          games are already past the lobby (phase 'playing'), so there's
  //          nothing to backfill — `draft` stays undefined.
  const next = { ...(s as SDState), version: STATE_VERSION, log: migratedLog };
  for (const seat of ['A', 'B'] as Seat[]) {
    if (next.players?.[seat] && !Array.isArray(next.players[seat].burns)) {
      next.players[seat].burns = [];
    }
  }
  return next;
}

// =====================================================================
// Per-viewer state projection (fixes the hand-privacy leak: without this
// the client receives both players' hands + decks in plain JSONB and any
// player can inspect their opponent's hand via devtools).
//
// Rules:
//   • Both decks always hidden (everyone — even their owner — only sees the
//     count, never the order)
//   • Opponent's hand hidden for seated players
//   • Both hands hidden for spectators
//
// Hidden zones are replaced with arrays of HIDDEN_CARD; the board renders
// any entry not in CARDS as a face-down card back.
// =====================================================================

export function projectStateForViewer(state: SDState, viewerId: string | null): SDState {
  const next: SDState = JSON.parse(JSON.stringify(state));
  const mySeat: Seat | null =
    next.seats.A === viewerId ? 'A' :
    next.seats.B === viewerId ? 'B' : null;

  for (const seat of ['A', 'B'] as Seat[]) {
    const p = next.players[seat];
    // Deck contents are private from everyone — only the count matters to the UI.
    p.deck = p.deck.map(() => HIDDEN_CARD as CardId);
    // Hand contents are private from anyone who isn't this seat.
    if (mySeat !== seat) {
      p.hand = p.hand.map(() => HIDDEN_CARD as CardId);
    }
  }

  // During the draft, hide the opponent's offers and drafted cards — only their
  // round/done progress is public. (picked is emptied; round still conveys it.)
  if (next.draft) {
    for (const seat of ['A', 'B'] as Seat[]) {
      if (mySeat !== seat) {
        next.draft[seat].offer = { common: [], uncommon: [], rare: [] };
        next.draft[seat].picked = [];
      }
    }
  }
  return next;
}
