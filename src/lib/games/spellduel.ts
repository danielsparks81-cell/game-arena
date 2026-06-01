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
export const STATE_VERSION = 3;

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
  // Uncommons (max 2 per deck) — counterspell/reflect added with the reaction system
  | 'mind_pick' | 'curse' | 'ward' | 'drain' | 'mana_void' | 'mirror'
  | 'pilfer' | 'scorch'
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
  | { kind: 'game_ended'; winner: Seat | 'draw'; winnerName?: string };

export type SDState = {
  version?: number;
  phase: 'lobby' | 'playing' | 'finished';
  seats: { A?: string; B?: string };
  players: { A: PlayerState; B: PlayerState };
  currentSeat: Seat;
  turn: number;
  log: SDEvent[];
  winner: Seat | 'draw' | null;
  /** The last spell each seat cast (most recent), for Mirror to copy. A spell
   *  is recorded only if it had real effects (Counter/Fade/Mirror don't count). */
  lastSpell?: { A?: CardId; B?: CardId };
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

/** Default starter deck — used until the draft system (next increment) takes
 *  over. A 35-card mix across all three rarities that respects MAX_COPIES and
 *  showcases the new mechanics (burn, shield, silence, steal, copy, big rares). */
function buildStarterDeck(): CardId[] {
  const counts: Partial<Record<CardId, number>> = {
    // commons (max 5)
    strike: 4, arcane_bolt: 3, spark: 3, fireball: 2, mend: 3, recuperate: 2,
    insight: 2, mana_spring: 2, counter: 2, fade: 2, blaze: 2, double_strike: 2,
    siphon: 1, overload: 1,
    // uncommons (max 2)
    scorch: 1, ward: 1, drain: 1, pilfer: 1, curse: 1,
    // rares (max 1)
    inferno: 1, arcane_surge: 1, soul_drain: 1,
  };
  const deck: CardId[] = [];
  for (const [id, n] of Object.entries(counts) as [CardId, number][]) {
    for (let i = 0; i < (n ?? 0); i++) deck.push(id);
  }
  return shuffle(deck);
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

/** Builds a state with the host seated as A + both decks pre-shuffled.
 *  The B seat is empty until joinRoom assigns it. */
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
    deck: buildStarterDeck(),
  };
  s.players.B = { ...emptyPlayer(), deck: buildStarterDeck() };
  // Draw both opening hands now so the game is fully primed when B joins.
  drawCards(s.players.A, STARTING_HAND_SIZE);
  drawCards(s.players.B, STARTING_HAND_SIZE);
  return s;
}

/** Called by joinRoom when the second player joins. Fills in seat B,
 *  randomizes who starts, gives the first player 1 mana, and flips phase. */
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
  next.phase = 'playing';
  next.currentSeat = Math.random() < 0.5 ? 'A' : 'B';
  next.players[next.currentSeat].maxMana = 1;
  next.players[next.currentSeat].mana = 1;
  next.log.push({
    kind: 'turn_started',
    seat: next.currentSeat,
    username: next.players[next.currentSeat].username,
  });
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

// =====================================================================
// Public moves
// =====================================================================

export type SDAction =
  | { kind: 'play'; cardIdx: number; targets?: ResolvedTarget[] }   // index into the caller's hand
  | { kind: 'end_turn' };

export function applyMove(
  state: SDState,
  action: SDAction,
  playerId: string,
): SDState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  if (state.winner) return { error: 'Match is over' };

  const seat: Seat | null =
    state.seats.A === playerId ? 'A'
    : state.seats.B === playerId ? 'B' : null;
  if (!seat) return { error: 'You are not seated' };
  if (seat !== state.currentSeat) return { error: "It's not your turn" };

  const next = JSON.parse(JSON.stringify(state)) as SDState;
  const me = next.players[seat];

  if (action.kind === 'play') {
    if (action.cardIdx < 0 || action.cardIdx >= me.hand.length) {
      return { error: 'No card at that index' };
    }
    const cardId = me.hand[action.cardIdx];
    const card = CARDS[cardId];
    if (!card) return { error: 'Unknown card' };
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

    // Resolve effects (static + dynamic).
    const effects: Effect[] = card.dynamic ? resolveDynamic(next, seat, card) : card.effects;
    for (const eff of effects) resolveEffect(next, seat, eff, targets);

    // Plant trigger (if any) after effects resolve.
    if (card.trigger) {
      me.pendingTriggers.push({ ...card.trigger });
      next.log.push({ kind: 'trigger_armed', seat, username: me.username, source: card.trigger.source });
    }

    // Record this as the seat's last spell so the opponent's Mirror can copy it
    // — but not Mirror itself (avoid copy-of-a-copy) and not pure-trigger cards
    // (Counter/Fade have nothing to copy).
    if (cardId !== 'mirror' && (effects.length > 0)) {
      next.lastSpell = { ...(next.lastSpell ?? {}), [seat]: cardId };
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
  // so in-flight games don't crash when burns are read.
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
  return next;
}
