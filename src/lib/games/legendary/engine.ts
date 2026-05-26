// =====================================================================
// Legendary engine — pure functions over LegendaryState. The server
// action wraps each call with auth + DB persistence; the engine itself
// is deterministic given an input state + an action.
//
// Phase model:
//   • 'lobby'    — waiting for players to join
//   • 'playing'  — turn cycle in progress
//   • 'finished' — `result` set to 'win' or 'loss'
//
// Turn cycle (current player only):
//   1. Refresh: empty Attack/Recruit pools, clear playedThisTurn
//   2. Draw to 6 (handled at end-of-PREVIOUS-turn)
//   3. Player plays cards, recruits from HQ, fights villains/mastermind
//   4. End turn → discard played + remaining hand, refresh HQ, reveal
//      next Villain Deck card (villain/henchman/master_strike/scheme_twist/
//      bystander), check loss conditions, advance currentPlayerIdx, deal
//      6 cards to new active player.
// =====================================================================

import {
  CARDS,
  CITY_SIZE,
  HQ_SIZE,
  HERO_CLASSES_PER_GAME,
  LOG_MAX,
  MASTER_STRIKES_IN_DECK,
  STARTER_AGENTS,
  STARTER_TROOPERS,
  STARTING_HAND_SIZE,
  STATE_VERSION,
  HERO_CLASSES,
  VILLAIN_GROUPS,
  HENCHMAN_GROUPS,
  MASTERMINDS,
  SCHEMES,
  getCard,
} from './cards';
import type {
  CardDef,
  CardId,
  CardInstance,
  CardInstanceId,
  Effect,
  HandPassive,
  HeroCardDef,
  LegendaryEvent,
  LegendaryState,
  PendingChoice,
  PlayerState,
  TurnState,
  VillainCardDef,
} from './types';

// =====================================================================
// Tiny helpers
// =====================================================================

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let instanceCounter = 0;
/** Generate a stable per-card instance id. Uses a counter + Math.random so
 *  collisions across games are astronomically unlikely without needing a
 *  crypto-grade UUID. */
function newInstanceId(): CardInstanceId {
  instanceCounter++;
  return `c-${Date.now().toString(36)}-${instanceCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function mkInstance(cardId: CardId): CardInstance {
  return { instanceId: newInstanceId(), cardId };
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function pushLog(state: LegendaryState, ev: LegendaryEvent): void {
  // Stamp a monotonically-increasing sequence number so the board can track
  // "which events have been animated" by seq rather than by array index.
  // This survives log rotation (LOG_MAX trim) without desynchronising the cursor.
  state.logSeq = (state.logSeq ?? 0) + 1;
  (ev as LegendaryEvent & { seq: number }).seq = state.logSeq;
  state.log.push(ev);
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

// =====================================================================
// State construction
// =====================================================================

export function initialState(): LegendaryState {
  return {
    version: STATE_VERSION,
    phase: 'lobby',
    schemeId: SCHEMES[0].cardId,
    mastermindId: MASTERMINDS[0].cardId,
    heroClassIds: HERO_CLASSES.slice(0, HERO_CLASSES_PER_GAME).map(c => c.className),
    villainGroupIds: [],   // filled at setup based on mastermind's alwaysLeads
    henchmanGroupIds: [],  // filled at setup
    heroDeck: [],
    hq: Array(HQ_SIZE).fill(null),
    villainDeck: [],
    city: Array(CITY_SIZE).fill(null),
    pendingBystanders: [],
    cityBystanders: {},
    escapedPile: [],
    ko: [],
    woundDeck: [],
    bystanderDeck: [],
    sidekickPoolCount: 30,
    officerPoolCount: 30,
    mastermind: { cardId: MASTERMINDS[0].cardId, hitsTaken: 0, tactics: [], bystanders: [] },
    players: [],
    currentPlayerIdx: 0,
    turn: 0,
    thisTurn: emptyTurnState(),
    schemeTwistsRevealed: 0,
    logSeq: 0,
    log: [],
  };
}

function emptyTurnState(): TurnState {
  return {
    attack: 0,
    recruit: 0,
    playedThisTurn: [],
    classPlayedCounts: {},
    teamPlayedCounts: {},
    heroNameCounts: {},
    sidekickRecruited: false,
    pendingChoice: undefined,
    freeBystanderFightAvailable: false,
    rescueBystandersOnKillCount: 0,
    rescueBonusRecruit: 0,
    rescueBonusDraw: 0,
    rescueBonusAttack: 0,
    locationVillainDebuffs: {},
    mastermindAttackDebuff: 0,
    recruitAsAttackEnabled: false,
    extraCardsDrawnThisTurn: 0,
    foughtThisTurn: false,
    recruitedThisTurn: false,
  };
}

/** Build an empty room state with the host already seated at seat 0. */
export function createInitialStateForHost(host: {
  userId: string; username: string; accent_color?: string;
}): LegendaryState {
  const s = initialState();
  s.players.push({
    playerId: host.userId,
    username: host.username,
    accent_color: host.accent_color,
    seat: 0,
    hand: [], deck: [], discard: [], victoryPile: [],
    vp: 0,
  });
  return s;
}

/** Generic add-player for the lobby room (called on joinRoom for a Legendary
 *  game). Seats them next in order; ignores duplicate joins. */
export function addPlayer(
  state: LegendaryState,
  playerId: string,
  username: string,
  seat: number,
  accent_color?: string,
): LegendaryState {
  if (state.players.some(p => p.playerId === playerId)) return state;
  const next = clone(state);
  next.players.push({
    playerId, username, accent_color, seat,
    hand: [], deck: [], discard: [], victoryPile: [],
    vp: 0,
  });
  next.players.sort((a, b) => a.seat - b.seat);
  return next;
}

export function removePlayer(state: LegendaryState, playerId: string): LegendaryState {
  if (state.phase !== 'lobby') return state;
  const next = clone(state);
  next.players = next.players.filter(p => p.playerId !== playerId);
  return next;
}

// =====================================================================
// Lobby configuration — host-only, runs before startGame
// =====================================================================

/** Per-player count → how many hero classes to include in the game. */
function heroClassCountForPlayers(playerCount: number): number {
  if (playerCount <= 1) return 3;
  if (playerCount >= 5) return 6;
  return 5;
}

/** Official setup table — Villain Groups by player count (2-5 players). */
function villainGroupsForPlayers(n: number): number {
  if (n >= 5) return 5;
  if (n === 4) return 4;
  if (n === 3) return 3;
  return 2; // 2 players
}

/** Official setup table — Henchman Groups by player count (2-5 players). */
function henchmanGroupsForPlayers(n: number): number {
  return n >= 4 ? 2 : 1; // 4-5 players: 2 groups; 2-3 players: 1 group
}

/** Official setup table — Bystanders placed in Villain Deck by player count (2-5 players). */
function bystandersInVillainDeckForPlayers(n: number): number {
  if (n >= 5) return 16;
  if (n >= 3) return 8;
  return 2; // 1-2 players
}

export type LegendaryLobbyAction =
  | { kind: 'set_mastermind'; mastermindId: string }
  | { kind: 'set_scheme'; schemeId: string }
  | { kind: 'set_hero_classes'; classNames: string[] }
  | { kind: 'randomize_heroes' };

/**
 * Host-only: mutate the lobby configuration (mastermind, scheme, hero
 * classes). Safe to call any time before startGame — returns a new state.
 */
export function applyLobbyConfig(
  state: LegendaryState,
  action: LegendaryLobbyAction,
): LegendaryState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game already started' };
  const next = clone(state);

  switch (action.kind) {
    case 'set_mastermind': {
      if (!MASTERMINDS.find(m => m.cardId === action.mastermindId)) {
        return { error: 'Unknown mastermind' };
      }
      next.mastermindId = action.mastermindId;
      next.mastermind = { cardId: action.mastermindId, hitsTaken: 0, tactics: [], bystanders: [] };
      return next;
    }
    case 'set_scheme': {
      if (!SCHEMES.find(s => s.cardId === action.schemeId)) {
        return { error: 'Unknown scheme' };
      }
      next.schemeId = action.schemeId;
      return next;
    }
    case 'set_hero_classes': {
      const valid = action.classNames.filter(
        cn => HERO_CLASSES.some(c => c.className === cn)
      );
      next.heroClassIds = valid;
      return next;
    }
    case 'randomize_heroes': {
      const count = heroClassCountForPlayers(next.players.length);
      next.heroClassIds = shuffle([...HERO_CLASSES]).slice(0, count).map(c => c.className);
      return next;
    }
  }
}

// =====================================================================
// Game setup — runs once when the host clicks Start
// =====================================================================

/**
 * Build the hero/villain/bystander/wound decks, deal opening hands, drop
 * the first villain into the City, flip phase to 'playing'.
 *
 * Setup is server-rolled so the shuffle order is private (no client gets to
 * see what's coming next in any deck).
 */
export function startGame(state: LegendaryState): LegendaryState | { error: string } {
  if (state.phase !== 'lobby') return { error: 'Game has already started' };
  if (state.players.length < 1) return { error: 'Need at least 1 player' };

  const next = clone(state);
  const mastermind = MASTERMINDS.find(m => m.cardId === next.mastermindId);
  const scheme     = SCHEMES.find(s => s.cardId === next.schemeId);
  if (!mastermind || !scheme) return { error: 'Invalid mastermind/scheme selection' };

  const playerCount = next.players.length;
  const neededHeroClasses = heroClassCountForPlayers(playerCount);

  // Auto-fill hero classes if the host never picked any (or not enough).
  if (next.heroClassIds.length < neededHeroClasses) {
    const existing = new Set(next.heroClassIds);
    const pool = shuffle(HERO_CLASSES.filter(c => !existing.has(c.className)));
    while (next.heroClassIds.length < neededHeroClasses && pool.length > 0) {
      next.heroClassIds.push(pool.shift()!.className);
    }
  }
  // Trim to max if somehow too many.
  if (next.heroClassIds.length > neededHeroClasses) {
    next.heroClassIds = next.heroClassIds.slice(0, neededHeroClasses);
  }

  // ----- Villain / Henchman groups -----------------------------------------
  // A Mastermind "Always Leads" exactly one group — either a villain group
  // (city-row cards) or a henchman group. We match by team field on the group.
  const leadsVillainGroup  = VILLAIN_GROUPS.find(g => g.team === mastermind.alwaysLeads);
  const leadsHenchmanGroup = !leadsVillainGroup
    ? HENCHMAN_GROUPS.find(g => g.team === mastermind.alwaysLeads)
    : undefined;

  // Seed with the alwaysLeads group; it counts toward the total for its type.
  next.villainGroupIds  = leadsVillainGroup  ? [leadsVillainGroup.groupId]  : [];
  next.henchmanGroupIds = leadsHenchmanGroup ? [leadsHenchmanGroup.groupId] : [];

  if (playerCount >= 2) {
    // Official table-driven counts (2–5 players).
    // Scheme bonus (e.g. Prison Breakout +1 henchman) is added on top.
    const targetVillains = villainGroupsForPlayers(playerCount);
    const targetHenchmen = henchmanGroupsForPlayers(playerCount) + (scheme.extraHenchmanGroups ?? 0);

    const availableVillains = shuffle(VILLAIN_GROUPS.filter(g => !next.villainGroupIds.includes(g.groupId)));
    while (next.villainGroupIds.length < targetVillains && availableVillains.length > 0) {
      next.villainGroupIds.push(availableVillains.shift()!.groupId);
    }
    const availableHenchmen = shuffle(HENCHMAN_GROUPS.filter(g => !next.henchmanGroupIds.includes(g.groupId)));
    while (next.henchmanGroupIds.length < targetHenchmen && availableHenchmen.length > 0) {
      next.henchmanGroupIds.push(availableHenchmen.shift()!.groupId);
    }
  } else {
    // 1-player: official solo rules — ignore "Always Leads", pick groups at random.
    // This ensures variety and allows non-alwaysLeads groups to appear in solo.
    next.villainGroupIds  = [];
    next.henchmanGroupIds = [];
    const soloVillain  = shuffle([...VILLAIN_GROUPS])[0];
    const soloHenchman = shuffle([...HENCHMAN_GROUPS])[0];
    if (soloVillain)  next.villainGroupIds  = [soloVillain.groupId];
    if (soloHenchman) next.henchmanGroupIds = [soloHenchman.groupId];
    // Scheme bonus henchman groups still apply — use all 10 from the extra group.
    const schemeExtraHenchman = scheme.extraHenchmanGroups ?? 0;
    for (let i = 0; i < schemeExtraHenchman; i++) {
      const additional = shuffle(HENCHMAN_GROUPS.filter(g => !next.henchmanGroupIds.includes(g.groupId)))[0];
      if (additional) next.henchmanGroupIds.push(additional.groupId);
    }
    // Starting henchmen: 2 will be set aside in the villain deck builder below.
    next.soloStartingHenchmenPlaced = false;
  }

  // ----- Build hero deck from selected classes + the always-available
  //       Trooper + Agent pools (which are NOT in the HQ rotation in real
  //       Legendary; for MVP we'll keep them OUT of the hero deck and only
  //       in starting decks). -----
  const heroDeck: CardInstance[] = [];
  for (const className of next.heroClassIds) {
    const cls = HERO_CLASSES.find(c => c.className === className);
    if (!cls) continue;
    for (const { def, copies } of cls.cards) {
      for (let i = 0; i < copies; i++) heroDeck.push(mkInstance(def.cardId));
    }
  }
  next.heroDeck = shuffle(heroDeck);

  // ----- Build villain deck: villain group(s) + henchman group(s) +
  //       Master Strikes + Scheme Twists + Bystanders -----
  const villainDeck: CardInstance[] = [];
  for (const gid of next.villainGroupIds) {
    const grp = VILLAIN_GROUPS.find(g => g.groupId === gid);
    if (!grp) continue;
    for (const { def, copies } of grp.cards) {
      for (let i = 0; i < copies; i++) villainDeck.push(mkInstance(def.cardId));
    }
  }
  // Henchman groups. In solo mode the FIRST (primary) group is split: only 2 cards
  // go into the villain deck; 2 more are set aside to enter the city at turn 1.
  // Scheme-bonus groups (e.g. Prison Breakout +1) always use all 10 cards.
  for (let hIdx = 0; hIdx < next.henchmanGroupIds.length; hIdx++) {
    const grp = HENCHMAN_GROUPS.find(g => g.groupId === next.henchmanGroupIds[hIdx]);
    if (!grp) continue;
    const allCards: CardInstance[] = [];
    for (const { def, copies } of grp.cards) {
      for (let i = 0; i < copies; i++) allCards.push(mkInstance(def.cardId));
    }
    if (playerCount === 1 && hIdx === 0) {
      // Solo primary henchman group: 2 in villain deck, 2 set aside for city start.
      const shuffledH = shuffle(allCards);
      villainDeck.push(shuffledH[0], shuffledH[1]);
      next.soloStartingHenchmen = [shuffledH[2], shuffledH[3]];
      // Remaining 6 cards are simply not used (per the rules).
    } else {
      for (const c of allCards) villainDeck.push(c);
    }
  }
  for (let i = 0; i < MASTER_STRIKES_IN_DECK; i++) villainDeck.push(mkInstance('master_strike'));
  for (let i = 0; i < scheme.twists; i++)           villainDeck.push(mkInstance('scheme_twist'));
  // Bystanders in villain deck: official table for 2+ players; exactly 1 for solo.
  const villainDeckBystanders = playerCount >= 2
    ? bystandersInVillainDeckForPlayers(playerCount)
    : 1;
  for (let i = 0; i < villainDeckBystanders; i++)  villainDeck.push(mkInstance('bystander'));
  next.villainDeck = shuffle(villainDeck);

  // ----- Bystander stack (30 bystanders, separate from villain-deck bystanders) -----
  // Per the rules: the Bystander Deck is a finite 30-card pile. When it runs out,
  // rescue effects simply don't produce any cards — the game continues as normal.
  next.bystanderDeck = Array(30).fill(0).map(() => mkInstance('bystander'));

  // ----- Wound deck — a generic stack of wound cards. Real Legendary uses 30. -----
  next.woundDeck = Array(30).fill(0).map(() => mkInstance('wound'));

  // ----- Mastermind + Tactics -----
  // Shuffle the 4 Tactic cards face-down beneath the Mastermind. One is drawn
  // at random each time the Mastermind is hit; all 4 taken = heroes win.
  next.mastermind = {
    cardId: mastermind.cardId,
    hitsTaken: 0,
    tactics: shuffle(mastermind.tacticIds.map(id => mkInstance(id))),
    bystanders: [],
  };

  // ----- Per-player starting deck: 8 Agents + 4 Troopers, shuffled, then
  //       deal STARTING_HAND_SIZE to the active player only at first. -----
  for (const p of next.players) {
    const personal: CardInstance[] = [];
    for (let i = 0; i < STARTER_TROOPERS; i++) personal.push(mkInstance('shield_trooper'));
    for (let i = 0; i < STARTER_AGENTS; i++)   personal.push(mkInstance('shield_agent'));
    p.deck = shuffle(personal);
    p.hand = []; p.discard = []; p.victoryPile = []; p.vp = 0;
  }

  // ----- Fill the HQ -----
  refillHQ(next);

  // ----- Reveal initial villain (start of game, no escape risk) -----
  // Real Legendary actually starts with the City EMPTY and the first villain
  // reveal happens at the end of the first turn. We follow that rule.
  next.city = Array(CITY_SIZE).fill(null);

  // ----- Kick off turn 0 → 1 -----
  next.currentPlayerIdx = 0;
  next.turn = 1;
  next.thisTurn = emptyTurnState();
  // Deal a starting hand to EVERY player up-front so off-turn players can
  // read their hand and plan their next turn. End-of-turn draws then keep
  // each player's hand ready for the moment their turn comes around.
  for (const p of next.players) drawUpTo(p, STARTING_HAND_SIZE);

  next.phase = 'playing';
  pushLog(next, { kind: 'system', text: `Game started: ${mastermind.name} vs the heroes.` });
  pushLog(next, {
    kind: 'turn_started', seat: 0, username: next.players[0].username,
  });
  return next;
}

/** Refill any null slots in the HQ from the top of the Hero Deck. If the
 *  Hero Deck is empty, slots stay null (Legendary rule: HQ may run dry).
 *
 *  Pass `shouldLog = true` during live gameplay so each newly placed card
 *  emits an `hq_refilled` event (drives the per-slot flip-in animation).
 *  Keep it false (the default) during the initial setup in `startGame`. */
function refillHQ(state: LegendaryState, shouldLog = false): void {
  for (let i = 0; i < state.hq.length; i++) {
    if (state.hq[i]) continue;
    const next = state.heroDeck.shift();
    state.hq[i] = next ?? null;
    if (shouldLog && next) {
      const def = getCard(next.cardId);
      const cardName = def.kind === 'hero' ? def.cardName : next.cardId;
      pushLog(state, { kind: 'hq_refilled', slot: i, cardId: next.cardId, cardName });
    }
  }
}

/** Draw `n` cards from p.deck → p.hand, reshuffling discard into deck when
 *  the deck runs out (classic deckbuilder rule). Stops if both are empty. */
function drawUpTo(p: PlayerState, n: number): void {
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) return;
      p.deck = shuffle(p.discard);
      p.discard = [];
    }
    p.hand.push(p.deck.shift()!);
  }
}

// =====================================================================
// Public actions
// =====================================================================

export type LegendaryAction =
  /** Play one card from your hand. Resolves its on-play effects + bumps
   *  resource pools / class-played counters. */
  | { kind: 'play_card'; instanceId: CardInstanceId }
  /** Spend Recruit to buy the hero at HQ index `slot` → into your discard. */
  | { kind: 'recruit_hero'; slot: number }
  /** Spend Recruit to take one Sidekick from the always-available pool. */
  | { kind: 'recruit_sidekick' }
  /** Spend Recruit to take one S.H.I.E.L.D. Officer from the always-available pool. */
  | { kind: 'recruit_officer' }
  /** Spend Attack to defeat the villain at City index `slot` → into your VP. */
  | { kind: 'fight_city'; slot: number }
  /** Spend Attack to hit the Mastermind. When hits reaches the boss's HP
   *  threshold, the game ends in victory. */
  | { kind: 'fight_mastermind' }
  /** Resolve a pending `ko_from_hand` / `discard_from_hand` choice by selecting
   *  a card from hand. If the choice has a filter (e.g. wounds_only) the engine
   *  validates the selection before proceeding. */
  | { kind: 'resolve_choice'; instanceId: CardInstanceId }
  /** Skip the pending choice (forfeit the "If you do…" bonus). */
  | { kind: 'skip_choice' }
  /** Accept a binary pending choice (Deadpool Do-Over, Random Acts). Unlike
   *  `resolve_choice` this does not require selecting a card from hand. */
  | { kind: 'accept_choice' }
  /** Clean up turn (discard hand + played) and pass turn. */
  | { kind: 'end_turn' }
  /** Reveal the first villain card at the start of the game (triggered when
   *  the current player clicks "Game Begins"). Only valid on turn 1 while
   *  all city slots are still empty. */
  | { kind: 'reveal_first_villain' }
  /** Heal wounds: if the player has not fought or recruited this turn, KO all
   *  Wounds from their hand. Only valid when the player has wounds in hand. */
  | { kind: 'play_wound_healing' };

export function applyAction(
  state: LegendaryState,
  playerId: string,
  action: LegendaryAction,
): LegendaryState | { error: string } {
  if (state.phase !== 'playing') return { error: 'Game not in progress' };
  if (state.result) return { error: 'Game already finished' };

  const me = state.players[state.currentPlayerIdx];
  if (!me || me.playerId !== playerId) return { error: "It's not your turn" };

  const next = clone(state);
  const meNext = next.players[next.currentPlayerIdx];

  // If a player-choice is pending, only allow choice-resolution actions.
  if (next.thisTurn.pendingChoice &&
      action.kind !== 'resolve_choice' &&
      action.kind !== 'skip_choice' &&
      action.kind !== 'accept_choice') {
    return { error: 'Resolve your pending choice first — select a card or click Skip.' };
  }

  switch (action.kind) {
    case 'play_card':         return doPlayCard(next, meNext, action.instanceId);
    case 'recruit_hero':      return doRecruit(next, meNext, action.slot);
    case 'recruit_sidekick':  return doRecruitPool(next, meNext, 'sidekick');
    case 'recruit_officer':   return doRecruitPool(next, meNext, 'shield_officer');
    case 'fight_city':        return doFightCity(next, meNext, action.slot);
    case 'fight_mastermind':  return doFightMastermind(next, meNext);
    case 'play_wound_healing': return doWoundHealing(next, meNext);
    case 'resolve_choice':    return doResolveChoice(next, meNext, action.instanceId);
    case 'skip_choice':       return doSkipChoice(next);
    case 'accept_choice':     return doAcceptChoice(next, meNext);
    case 'end_turn':              return doEndTurn(next);
    case 'reveal_first_villain':  return doRevealFirstVillain(next);
  }
}

// ---------------- Play card ----------------

function doPlayCard(
  state: LegendaryState,
  me: PlayerState,
  instanceId: CardInstanceId,
): LegendaryState | { error: string } {
  if (state.thisTurn.pendingChoice) {
    return { error: 'Resolve your pending choice before playing another card' };
  }
  const idx = me.hand.findIndex(c => c.instanceId === instanceId);
  if (idx < 0) return { error: 'Card not in your hand' };
  const instance = me.hand[idx];
  const def = getCard(instance.cardId);
  if (def.kind !== 'hero') {
    return { error: 'You can only play hero cards (wounds/bystanders are passive)' };
  }

  // Move to playedThisTurn FIRST so on-play triggers can see this card in
  // the played-counts when they fire.
  me.hand.splice(idx, 1);
  state.thisTurn.playedThisTurn.push(instance);
  bumpPlayedCounters(state.thisTurn, def);

  // Vanilla stat-stick contributions
  if (def.baseAttack)  state.thisTurn.attack  += def.baseAttack;
  if (def.baseRecruit) state.thisTurn.recruit += def.baseRecruit;

  pushLog(state, {
    kind: 'card_played', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.cardName,
  });

  // On-play effects (may add resources, draw cards, conditional bonuses)
  if (def.onPlay) {
    for (const eff of def.onPlay) resolveEffect(state, me, eff);
  }

  return state;
}

function bumpPlayedCounters(turn: TurnState, def: HeroCardDef): void {
  for (const c of def.classes) turn.classPlayedCounts[c] = (turn.classPlayedCounts[c] ?? 0) + 1;
  for (const t of def.teams)   turn.teamPlayedCounts[t]  = (turn.teamPlayedCounts[t]  ?? 0) + 1;
  // Track hero class-name plays (e.g. 'Hulk', 'Nick Fury') for hero-name synergies.
  turn.heroNameCounts[def.className] = (turn.heroNameCounts[def.className] ?? 0) + 1;
}

// ---------------- Effect resolver ----------------

function resolveEffect(state: LegendaryState, me: PlayerState, effect: Effect): void {
  switch (effect.kind) {
    case 'gain_attack':  state.thisTurn.attack  += effect.amount; return;
    case 'gain_recruit': state.thisTurn.recruit += effect.amount; return;
    case 'draw': {
      const before = me.hand.length;
      drawUpTo(me, effect.amount);
      const drew = me.hand.length - before;
      if (drew > 0) {
        state.thisTurn.extraCardsDrawnThisTurn += drew;
        pushLog(state, { kind: 'system', text: `${me.username} drew ${drew} card${drew === 1 ? '' : 's'}.` });
      }
      return;
    }
    case 'gain_attack_per_unique_class_in_hand': {
      // "You have" = cards still in hand + cards already played this turn.
      // Classless heroes (SHIELD Trooper/Agent/Officer/Sidekick) count as 'grey' — the 6th color.
      const colors = new Set<string>();
      const allCards = [...me.hand, ...state.thisTurn.playedThisTurn];
      for (const c of allCards) {
        const d = getCard(c.cardId);
        if (d.kind !== 'hero') continue;
        const hd = d as HeroCardDef;
        if (hd.classes.length === 0) colors.add('grey');
        else for (const cls of hd.classes) colors.add(cls);
      }
      state.thisTurn.attack += colors.size;
      return;
    }
    case 'gain_recruit_per_unique_class_in_hand': {
      const colors = new Set<string>();
      const allCards = [...me.hand, ...state.thisTurn.playedThisTurn];
      for (const c of allCards) {
        const d = getCard(c.cardId);
        if (d.kind !== 'hero') continue;
        const hd = d as HeroCardDef;
        if (hd.classes.length === 0) colors.add('grey');
        else for (const cls of hd.classes) colors.add(cls);
      }
      state.thisTurn.recruit += colors.size;
      return;
    }

    case 'gain_wound': {
      // Before applying the wound, check if the player has a hand passive that
      // can prevent it (Cap's "reveal to draw instead"). Only intercept if no
      // other choice is already pending.
      if (!state.thisTurn.pendingChoice) {
        const hasBlocker = me.hand.some(c => {
          const d = getCard(c.cardId);
          return d.kind === 'hero' && (d as HeroCardDef).onHand?.some(
            (h: HandPassive) => h.kind === 'prevent_wound_draw'
          );
        });
        if (hasBlocker) {
          state.thisTurn.pendingChoice = { kind: 'reveal_to_prevent_wound' };
          return; // wound deferred — player must resolve or skip
        }
      }
      const w = state.woundDeck.shift();
      if (w) {
        me.discard.push(w);
        pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
      }
      return;
    }
    case 'rescue_bystander': {
      // Pull from the finite bystander deck. Per the rules: if the Bystander Deck
      // runs out, the player simply doesn't receive the card — game continues.
      let n = 0;
      for (let i = 0; i < effect.amount; i++) {
        const b = state.bystanderDeck.shift();
        if (!b) break; // bystander deck exhausted — no more to rescue
        me.victoryPile.push(b); n++;
      }
      if (n > 0) {
        pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: n });
        applyRescueBonuses(state, me, n);
        recomputeVp(me);
      }
      return;
    }

    // ── Scaling per-class/team effects ─────────────────────────────────────
    case 'gain_attack_per_class': {
      const raw = state.thisTurn.classPlayedCounts[effect.cls] ?? 0;
      const count = effect.includeSelf ? raw : Math.max(0, raw - 1);
      state.thisTurn.attack += effect.bonus * count;
      return;
    }
    case 'gain_recruit_per_class': {
      const raw = state.thisTurn.classPlayedCounts[effect.cls] ?? 0;
      const count = effect.includeSelf ? raw : Math.max(0, raw - 1);
      state.thisTurn.recruit += effect.bonus * count;
      return;
    }
    case 'gain_attack_per_team': {
      const raw = state.thisTurn.teamPlayedCounts[effect.team] ?? 0;
      const count = effect.includeSelf ? raw : Math.max(0, raw - 1);
      state.thisTurn.attack += effect.bonus * count;
      return;
    }
    case 'gain_recruit_per_team': {
      const raw = state.thisTurn.teamPlayedCounts[effect.team] ?? 0;
      const count = effect.includeSelf ? raw : Math.max(0, raw - 1);
      state.thisTurn.recruit += effect.bonus * count;
      return;
    }

    // ── Conditional class/team/hero-name synergies ─────────────────────────
    // Counts are already bumped by bumpPlayedCounters before onPlay fires.
    // `minOthers` is the minimum TOTAL count needed (author accounts for self):
    //   cross-class "any X" → minOthers: 1
    //   same-class  "1 other X" → minOthers: 2 (self counted, need ≥2 total)
    case 'if_played_class_this_turn': {
      const count = state.thisTurn.classPlayedCounts[effect.cls] ?? 0;
      if (count >= effect.minOthers) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }
    case 'if_played_team_this_turn': {
      const count = state.thisTurn.teamPlayedCounts[effect.team] ?? 0;
      if (count >= effect.minOthers) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }
    case 'if_played_hero_this_turn': {
      const count = state.thisTurn.heroNameCounts[effect.heroName] ?? 0;
      if (count >= effect.minOthers) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }

    // ── Bystander-count scaling and free-fight flag ────────────────────────
    case 'gain_attack_per_vp_bystander': {
      const count = me.victoryPile.filter(c => c.cardId === 'bystander').length;
      state.thisTurn.attack += count;
      return;
    }
    case 'grant_free_bystander_fight': {
      state.thisTurn.freeBystanderFightAvailable = true;
      return;
    }

    // ── Gambit-specific effects ────────────────────────────────────────────
    case 'put_card_from_hand_on_deck': {
      // "Put a card from your hand on top of your deck." — mandatory, no skip.
      if (me.hand.length === 0) return; // nothing to put back — silently skip
      state.thisTurn.pendingChoice = { kind: 'put_card_on_deck', mandatory: true };
      return;
    }
    case 'reveal_top_draw_if_xmen': {
      // Peek the top card; if it's an X-Men Hero, draw it.
      if (me.deck.length === 0) {
        if (me.discard.length === 0) return;
        me.deck = shuffle(me.discard);
        me.discard = [];
      }
      const top = me.deck[0];
      const topDef = getCard(top.cardId);
      const topName =
        topDef.kind === 'hero' ? topDef.cardName :
        'name' in topDef ? (topDef as { name: string }).name : top.cardId;
      if (topDef.kind === 'hero' && topDef.teams.includes('x-men')) {
        me.deck.shift();
        me.hand.push(top);
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} — X-Men Hero! Drew it.` });
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} — not an X-Men Hero. Left on top.` });
      }
      return;
    }
    case 'reveal_top_discard_or_return': {
      // Peek the top card, set a binary choice: discard it or put it back.
      if (me.deck.length === 0) {
        if (me.discard.length === 0) return;
        me.deck = shuffle(me.discard);
        me.discard = [];
      }
      const topCard = me.deck.shift()!; // remove from deck temporarily
      const topDef = getCard(topCard.cardId);
      const topName =
        topDef.kind === 'hero' ? topDef.cardName :
        'name' in topDef ? (topDef as { name: string }).name : topCard.cardId;
      pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} from the top of their deck.` });
      state.thisTurn.pendingChoice = { kind: 'reveal_top_discard_or_return', card: topCard };
      return;
    }
    case 'reveal_top_discard_or_return_others': {
      // [instinct] bonus: auto-reveal and discard the top card of each other player's deck.
      for (const p of state.players) {
        if (p.playerId === me.playerId) continue;
        if (p.deck.length === 0) {
          if (p.discard.length === 0) continue;
          p.deck = shuffle(p.discard);
          p.discard = [];
        }
        const topCard = p.deck.shift()!;
        const topDef = getCard(topCard.cardId);
        const topName =
          topDef.kind === 'hero' ? topDef.cardName :
          'name' in topDef ? (topDef as { name: string }).name : topCard.cardId;
        p.discard.push(topCard);
        pushLog(state, { kind: 'system', text: `${p.username}'s top card (${topName}) is revealed and discarded.` });
      }
      return;
    }
    case 'gain_attack_equal_to_top_card_cost': {
      // Peek the top card of the deck; gain Attack equal to its cost. Card stays on top.
      if (me.deck.length === 0) {
        if (me.discard.length === 0) return;
        me.deck = shuffle(me.discard);
        me.discard = [];
      }
      const top = me.deck[0]; // peek only — do NOT remove
      const topDef = getCard(top.cardId);
      const cost = topDef.kind === 'hero' ? topDef.cost : 0;
      const topName =
        topDef.kind === 'hero' ? topDef.cardName :
        'name' in topDef ? (topDef as { name: string }).name : top.cardId;
      state.thisTurn.attack += cost;
      pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} (cost ${cost}) — +${cost}⚔.` });
      return;
    }

    // ── Deadpool-specific effects ──────────────────────────────────────────
    case 'villain_captures_bystander': {
      // Player chooses which city Villain/Henchman captures a Bystander.
      // If the city has no villain, the Mastermind captures instead.
      const bystander = mkInstance('bystander');
      const hasVillainInCity = state.city.some(c => {
        if (!c) return false;
        const d = getCard(c.cardId);
        return d.kind === 'villain' || d.kind === 'henchman';
      });
      if (hasVillainInCity) {
        // Let the player pick — board shows a targeting ring on each villain.
        state.thisTurn.pendingChoice = { kind: 'choose_city_villain_for_bystander', bystander };
        pushLog(state, { kind: 'system', text: `${me.username}: choose a Villain in the city to capture a Bystander.` });
        return;
      }
      // City is empty — Mastermind captures.
      {
        const mmDef = getCard(state.mastermind.cardId);
        const mmName = mmDef.kind === 'mastermind' ? mmDef.name : 'The Mastermind';
        state.mastermind.bystanders.push(bystander);
        pushLog(state, { kind: 'bystander_captured', capturedBy: 'mastermind', captorName: mmName });
      }
      return;
    }
    case 'gain_attack_per_odd_cost_hero_played': {
      // "Each OTHER hero with an odd-numbered cost you played this turn."
      // The currently-playing card is the last entry in playedThisTurn —
      // exclude it so we only count heroes played before this one.
      const prevPlayed = state.thisTurn.playedThisTurn.slice(0, -1);
      let count = 0;
      for (const c of prevPlayed) {
        const d = getCard(c.cardId);
        if (d.kind === 'hero' && d.cost % 2 !== 0) count++;
      }
      state.thisTurn.attack += count;
      return;
    }
    case 'if_first_hero_discard_hand_draw_four': {
      // This card is already in playedThisTurn; length === 1 means it's first.
      if (state.thisTurn.playedThisTurn.length !== 1) return;
      if (me.hand.length === 0) return; // nothing to discard — skip the prompt
      state.thisTurn.pendingChoice = { kind: 'discard_hand_draw_four' };
      return;
    }
    case 'optional_gain_wound_pass_left': {
      // "You may gain a Wound to your hand. Then each player passes a card left."
      state.thisTurn.pendingChoice = { kind: 'optional_gain_wound_pass_left' };
      return;
    }

    // ── Jean Grey-specific effects ────────────────────────────────────────
    case 'gain_recruit_per_bystander_rescued_this_turn': {
      state.thisTurn.rescueBonusRecruit += 1;
      return;
    }
    case 'draw_per_bystander_rescued_this_turn': {
      state.thisTurn.rescueBonusDraw += 1;
      return;
    }
    case 'gain_attack_per_bystander_rescued_this_turn': {
      state.thisTurn.rescueBonusAttack += 1;
      return;
    }
    case 'rescue_bystander_per_xmen_played': {
      // "For each OTHER [x-men] Hero you played this turn."
      // Card IS x-men (counted), so others = total - 1.
      const raw = state.thisTurn.teamPlayedCounts['x-men'] ?? 0;
      const count = Math.max(0, raw - 1);
      if (count === 0) return;
      let rescued = 0;
      for (let i = 0; i < count; i++) {
        const b = state.bystanderDeck.shift();
        if (!b) break; // bystander deck exhausted
        me.victoryPile.push(b); rescued++;
      }
      pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
      applyRescueBonuses(state, me, rescued);
      recomputeVp(me);
      return;
    }

    // ── Hulk-specific effects ─────────────────────────────────────────────
    case 'each_player_gains_wound': {
      // Every player (including the active player) takes a Wound into their
      // discard. Applied in seat order; silently skips if the wound deck is
      // empty, consistent with the existing `gain_wound` behavior.
      for (const p of state.players) {
        const w = state.woundDeck.shift();
        if (!w) break; // wound deck exhausted — stop distributing
        p.discard.push(w);
        pushLog(state, { kind: 'wound_taken', seat: p.seat, username: p.username });
      }
      return;
    }

    // ── Hawkeye-specific effects ───────────────────────────────────────────
    case 'gain_rescue_bystanders_on_kill': {
      // Hawkeye – Impossible Trick Shot: set the per-kill rescue counter to 3.
      // Stacks if multiple copies are played (additive).
      state.thisTurn.rescueBystandersOnKillCount += 3;
      return;
    }
    case 'choose_others_draw_or_discard': {
      // Hawkeye – Covering Fire ([tech] bonus): binary choice.
      // Accept = each other player draws a card.
      // Skip  = each other player discards a card.
      if (state.players.length < 2) {
        // Solo: no "other players" to affect — log and skip.
        pushLog(state, { kind: 'system', text: 'Solo game: no other players to draw or discard (effect skipped).' });
        return;
      }
      state.thisTurn.pendingChoice = { kind: 'choose_others_draw_or_discard' };
      return;
    }

    // ── Rogue-specific effects ────────────────────────────────────────────
    case 'copy_played_hero': {
      // Offer a choice only if there are other heroes in playedThisTurn.
      // The Rogue card itself is the last entry — exclude it and any other copy cards.
      const eligible = state.thisTurn.playedThisTurn.slice(0, -1).filter(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && c.cardId !== 'rogue_copy_powers';
      });
      if (eligible.length === 0) return; // nothing to copy — silently skip
      state.thisTurn.pendingChoice = { kind: 'copy_played_hero' };
      return;
    }
    case 'play_copy_each_player_top_card': {
      // Each player reveals (and discards) the top card of their deck.
      // The active player then fires the onPlay of any revealed Hero cards.
      for (const p of state.players) {
        if (p.deck.length === 0) {
          if (p.discard.length === 0) {
            pushLog(state, { kind: 'system', text: `${p.username}'s deck is empty — skipped.` });
            continue;
          }
          p.deck = shuffle(p.discard);
          p.discard = [];
        }
        const top = p.deck.shift()!;
        p.discard.push(top);
        const topDef = getCard(top.cardId);
        const topName = topDef.kind === 'hero' ? topDef.cardName
          : 'name' in topDef ? (topDef as { name: string }).name : top.cardId;
        pushLog(state, { kind: 'system', text: `${p.username} reveals ${topName}.` });
        if (topDef.kind === 'hero') {
          // Bump played counts + base stats as if the active player played this card.
          bumpPlayedCounters(state.thisTurn, topDef);
          if (topDef.baseAttack)  state.thisTurn.attack  += topDef.baseAttack;
          if (topDef.baseRecruit) state.thisTurn.recruit += topDef.baseRecruit;
          if (topDef.onPlay) {
            for (const eff of topDef.onPlay) resolveEffect(state, me, eff);
          }
        }
      }
      return;
    }

    // ── Nick Fury-specific effects ────────────────────────────────────────
    case 'gain_card_to_hand': {
      const cDef = getCard(effect.cardId);
      const cName = cDef.kind === 'hero' ? cDef.cardName
        : 'name' in cDef ? (cDef as { name: string }).name : effect.cardId;
      if (effect.may) {
        // "MAY gain" — prompt the player first.
        state.thisTurn.pendingChoice = { kind: 'optional_gain_card', cardId: effect.cardId, label: cName };
        return;
      }
      const instance = mkInstance(effect.cardId);
      me.hand.push(instance);
      pushLog(state, { kind: 'system', text: `${me.username} gains a ${cName} to their hand.` });
      return;
    }
    case 'defeat_villain_under_shield_ko_count': {
      const shieldTeams = new Set(['shield', 'shield-officer', 'shield-agent', 'shield-trooper']);
      const shieldKoCount = state.ko.filter(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).teams.some(t => shieldTeams.has(t));
      }).length;
      if (shieldKoCount === 0) return;

      // Auto-defeat all eligible city villains (no attack cost).
      for (let i = 0; i < state.city.length; i++) {
        const card = state.city[i];
        if (!card) continue;
        const def = getCard(card.cardId);
        if (def.kind !== 'villain' && def.kind !== 'henchman') continue;
        if (def.attack >= shieldKoCount) continue;

        state.city[i] = null;
        me.victoryPile.push(card);

        const attached = state.cityBystanders[card.instanceId] ?? [];
        if (attached.length > 0) {
          for (const b of attached) me.victoryPile.push(b);
          delete state.cityBystanders[card.instanceId];
          pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: attached.length });
          applyRescueBonuses(state, me, attached.length);
        }
        if (def.kind === 'villain' && def.fight) {
          for (const e of def.fight) resolveEffect(state, me, e);
        }
        if (state.thisTurn.rescueBystandersOnKillCount > 0) {
          const n = state.thisTurn.rescueBystandersOnKillCount;
          let rescued = 0;
          for (let j = 0; j < n; j++) {
            const b = state.bystanderDeck.shift();
            if (!b) break; // bystander deck exhausted
            me.victoryPile.push(b); rescued++;
          }
          if (rescued > 0) {
            pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
            applyRescueBonuses(state, me, rescued);
          }
        }
        pushLog(state, {
          kind: 'villain_defeated', seat: me.seat, username: me.username,
          cardId: def.cardId, cardName: def.name, vp: def.vp,
        });
      }

      // Also hit the mastermind once for free if its attack is under the count.
      const mmDef = getCard(state.mastermind.cardId);
      if (mmDef.kind === 'mastermind' && mmDef.attack < shieldKoCount && state.mastermind.tactics.length > 0) {
        state.mastermind.hitsTaken++;
        const tacticIdx = Math.floor(Math.random() * state.mastermind.tactics.length);
        const [tacticCard] = state.mastermind.tactics.splice(tacticIdx, 1);
        const tacticDef = getCard(tacticCard.cardId);
        if (tacticDef.kind === 'tactic') {
          me.victoryPile.push(tacticCard);
          if (state.mastermind.bystanders.length > 0) {
            const count = state.mastermind.bystanders.length;
            for (const b of state.mastermind.bystanders) me.victoryPile.push(b);
            state.mastermind.bystanders = [];
            pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count });
            applyRescueBonuses(state, me, count);
          }
          const others = state.players.filter(p => p.playerId !== me.playerId);
          for (const eff of tacticDef.fightOthers ?? []) {
            for (const p of others) {
              if (eff.kind === 'discard_from_hand') {
                for (let j = 0; j < eff.up_to && p.hand.length > 0; j++) {
                  const discarded = p.hand.splice(0, 1)[0];
                  p.discard.push(discarded);
                  pushLog(state, { kind: 'system', text: `${p.username} discards a card — ${tacticDef.name}.` });
                }
              } else { resolveEffect(state, p, eff); }
            }
          }
          for (const eff of tacticDef.fightSelf ?? []) resolveEffect(state, me, eff);
          if (state.thisTurn.rescueBystandersOnKillCount > 0) {
            const n = state.thisTurn.rescueBystandersOnKillCount;
            let rescued = 0;
            for (let j = 0; j < n; j++) {
              const b = state.bystanderDeck.shift();
              if (!b) break; // bystander deck exhausted
              me.victoryPile.push(b); rescued++;
            }
            if (rescued > 0) {
              pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
              applyRescueBonuses(state, me, rescued);
            }
          }
          pushLog(state, {
            kind: 'mastermind_hit', seat: me.seat, username: me.username,
            tacticName: tacticDef.name, tacticVp: tacticDef.vp,
            tacticsRemaining: state.mastermind.tactics.length,
            tacticCardId: tacticDef.cardId,
            tacticText: tacticDef.text ?? '',
          });
          if (state.mastermind.tactics.length === 0) {
            state.pendingResult = 'win';
            pushLog(state, { kind: 'system',
              text: `All four Tactics defeated — ${mmDef.name} is vanquished! Finish your turn for bonus VP.` });
          }
        }
      }
      recomputeVp(me);
      return;
    }

    // ── Player-choice effects (KO / discard from hand) ─────────────────────
    // These set a pendingChoice so the board can prompt the player to pick a
    // card. Subsequent actions are blocked until resolved or skipped.
    case 'ko_from_hand': {
      // Always include 'hand' and 'played' (cards played this turn) as sources.
      // Callers may also add 'discard' via effect.sources.
      const baseSources: Array<'hand' | 'discard' | 'played'> = ['hand', 'played'];
      const sources: Array<'hand' | 'discard' | 'played'> =
        effect.sources?.includes('discard') ? [...baseSources, 'discard'] : baseSources;
      const fromHand    = true;
      const fromDiscard = sources.includes('discard');
      const fromPlayed  = true;
      const isShieldHero = (c: CardInstance) => {
        const d = getCard(c.cardId);
        if (d.kind !== 'hero') return false;
        const st = new Set(['shield', 'shield-officer', 'shield-agent', 'shield-trooper']);
        return (d as HeroCardDef).teams.some(t => st.has(t));
      };
      const isHero = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
      const hasValid = effect.filter === 'wounds_only'
        ? (fromHand    && me.hand.some(c => c.cardId === 'wound')) ||
          (fromDiscard && me.discard.some(c => c.cardId === 'wound')) ||
          (fromPlayed  && state.thisTurn.playedThisTurn.some(c => c.cardId === 'wound'))
        : effect.filter === 'shield_heroes'
        ? (fromHand    && me.hand.some(isShieldHero)) ||
          (fromDiscard && me.discard.some(isShieldHero)) ||
          (fromPlayed  && state.thisTurn.playedThisTurn.some(isShieldHero))
        : effect.filter === 'heroes_only'
        ? (fromHand    && me.hand.some(isHero)) ||
          (fromDiscard && me.discard.some(isHero)) ||
          (fromPlayed  && state.thisTurn.playedThisTurn.some(isHero))
        : (fromHand && me.hand.length > 0) ||
          (fromDiscard && me.discard.length > 0) ||
          (fromPlayed  && state.thisTurn.playedThisTurn.length > 0);
      if (!hasValid) return; // no eligible cards — silently skip
      const choice: PendingChoice = {
        kind: 'ko_from_hand',
        bonus: effect.bonus ?? [],
        filter: effect.filter,
        sources,
        mandatory: effect.mandatory,
      };
      state.thisTurn.pendingChoice = choice;
      return;
    }
    case 'discard_from_hand': {
      if (me.hand.length === 0) return; // nothing to discard — mandatory cost simply can't be paid
      const choice: PendingChoice = {
        kind: 'discard_from_hand',
        bonus: effect.bonus ?? [],
        mandatory: effect.mandatory,
      };
      state.thisTurn.pendingChoice = choice;
      return;
    }

    // ── Spider-Man-specific effects ───────────────────────────────────────────
    case 'reveal_top_draw_if_cost_le_2': {
      if (me.deck.length === 0 && me.discard.length > 0) {
        me.deck = shuffle(me.discard); me.discard = [];
      }
      // Deck is a queue: index 0 = top (drawUpTo uses shift()).
      const top = me.deck[0];
      if (!top) return;
      const topDef = getCard(top.cardId);
      const topCost = 'cost' in topDef ? (topDef as { cost: number }).cost : 999;
      const topName = topDef.kind === 'hero' ? topDef.cardName
        : 'name' in topDef ? (topDef as { name: string }).name : top.cardId;
      if (topCost <= 2) {
        me.deck.shift();
        me.hand.push(top);
        state.thisTurn.extraCardsDrawnThisTurn++;
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} (cost ${topCost}) — drawn!` });
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${topName} (cost ${topCost}) — returned to deck.` });
      }
      return;
    }
    case 'reveal_top_three_draw_cost_le_2': {
      if (me.deck.length === 0 && me.discard.length > 0) {
        me.deck = shuffle(me.discard); me.discard = [];
      }
      const take = Math.min(3, me.deck.length);
      if (take === 0) return;
      // Deck is a queue: index 0 = top. splice(0, take) gives top-first order.
      const revealed = me.deck.splice(0, take);
      const drawn: string[] = [];
      const kept: CardInstance[] = [];
      for (const c of revealed) {
        const d = getCard(c.cardId);
        const cost = 'cost' in d ? (d as { cost: number }).cost : 999;
        if (cost <= 2) {
          me.hand.push(c);
          state.thisTurn.extraCardsDrawnThisTurn++;
          const nm = d.kind === 'hero' ? d.cardName : 'name' in d ? (d as { name: string }).name : c.cardId;
          drawn.push(nm);
        } else {
          kept.push(c);
        }
      }
      // Put non-qualifying cards back on top in their original order.
      me.deck.unshift(...kept);
      pushLog(state, { kind: 'system', text:
        `${me.username} reveals 3 cards — draws ${drawn.length > 0 ? drawn.join(', ') : 'none'}; returns ${kept.length}.` });
      return;
    }

    // ── Storm-specific effects ────────────────────────────────────────────────
    case 'villain_debuff_at_location': {
      // CITY_LOCATIONS = ['Sewers','Bank','Rooftops','Streets','Bridge'] (indices 0–4).
      const locationMap: Record<string, number> = {
        sewers: 0, bank: 1, rooftops: 2, streets: 3, bridge: 4,
      };
      const idx = locationMap[effect.location.toLowerCase()];
      if (idx !== undefined) {
        state.thisTurn.locationVillainDebuffs[idx] =
          (state.thisTurn.locationVillainDebuffs[idx] ?? 0) + effect.amount;
      }
      const locLabel = effect.location.charAt(0).toUpperCase() + effect.location.slice(1);
      pushLog(state, { kind: 'system', text:
        `${me.username}: Villains at the ${locLabel} get -${effect.amount} Attack this turn.` });
      return;
    }
    case 'move_villain_rescue_bystanders': {
      const hasVillain = state.city.some(c => c !== null);
      if (!hasVillain) {
        pushLog(state, { kind: 'system', text: 'No Villains in the city to move.' });
        return;
      }
      state.thisTurn.pendingChoice = { kind: 'move_villain_select_villain' };
      return;
    }
    case 'mastermind_attack_debuff': {
      state.thisTurn.mastermindAttackDebuff += effect.amount;
      pushLog(state, { kind: 'system', text:
        `${me.username}: Mastermind gets -${effect.amount} Attack this turn.` });
      return;
    }

    // ── Thor-specific effects ─────────────────────────────────────────────────
    case 'if_recruit_ge': {
      if (state.thisTurn.recruit >= effect.threshold) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }
    case 'enable_recruit_as_attack': {
      state.thisTurn.recruitAsAttackEnabled = true;
      pushLog(state, { kind: 'system', text:
        `${me.username}: Recruit can be used as Attack this turn.` });
      return;
    }

    // ── Wolverine-specific effects ────────────────────────────────────────────
    case 'gain_attack_per_extra_card_drawn_this_turn': {
      const bonus = state.thisTurn.extraCardsDrawnThisTurn * effect.amount;
      if (bonus > 0) {
        state.thisTurn.attack += bonus;
        pushLog(state, { kind: 'system', text:
          `${me.username} gets +${bonus} Attack (${state.thisTurn.extraCardsDrawnThisTurn} extra cards drawn × ${effect.amount}).` });
      }
      return;
    }

    // ── Sidekick ability ──────────────────────────────────────────────────────
    case 'optional_return_sidekick_draw_two': {
      // Binary prompt — resolved in doAcceptChoice (return + draw 2) or
      // doSkipChoice (keep the sidekick in played area, no draw).
      state.thisTurn.pendingChoice = { kind: 'optional_return_sidekick_draw_two' };
      return;
    }

    // ── Red Skull Master Strike ───────────────────────────────────────────────
    case 'each_player_ko_hero_from_hand': {
      // Called once per player (me) by the outer loop in the master_strike handler.
      // Always set the flag — the "are there heroes in hand?" check happens at
      // turn-start when the player has drawn their fresh 6-card hand. We cannot
      // check here because at end-of-turn the current player's hand is already
      // discarded (empty), which would incorrectly skip them.
      if (!me.pendingMasterStrikeKO) {
        me.pendingMasterStrikeKO = true;
        pushLog(state, {
          kind: 'system',
          text: `${me.username} must KO a Hero from their hand at the start of their next turn.`,
        });
      }
      return;
    }

    // ── Dr. Doom Tactic 2: Dark Technology ───────────────────────────────────
    case 'free_recruit_tech_or_ranged_from_hq': {
      const hasEligible = state.hq.some(card => {
        if (!card) return false;
        const d = getCard(card.cardId);
        return d.kind === 'hero' && (d.classes.includes('tech') || d.classes.includes('ranged'));
      });
      if (!hasEligible) {
        pushLog(state, { kind: 'system', text: `${me.username}: No Tech or Ranged Heroes in the HQ — Dark Technology has no targets.` });
        return;
      }
      state.thisTurn.pendingChoice = { kind: 'free_recruit_from_hq' };
      return;
    }

    // ── Dr. Doom Tactic 3: Treasures of Latveria ──────────────────────────────
    case 'extra_hand_cards': {
      me.endOfTurnExtraDraw = (me.endOfTurnExtraDraw ?? 0) + effect.amount;
      pushLog(state, { kind: 'system', text: `${me.username} will draw ${effect.amount} extra cards next hand (Treasures of Latveria)!` });
      return;
    }

    // ── Dr. Doom Master Strike ────────────────────────────────────────────────
    case 'doom_master_strike': {
      // Called once per player (me) by the outer loop. Only affects players with
      // exactly 6 cards in hand (a freshly drawn hand). Moves the 2 cheapest
      // cards to the top of their deck.
      if (me.hand.length !== 6) return;
      const sorted = [...me.hand].sort((a, b) => {
        const da = getCard(a.cardId), db = getCard(b.cardId);
        const ca = da.kind === 'hero' ? (da as HeroCardDef).cost : 0;
        const cb = db.kind === 'hero' ? (db as HeroCardDef).cost : 0;
        return ca - cb; // ascending: cheapest first
      });
      const toMove = sorted.slice(0, 2);
      for (const card of toMove) {
        me.hand = me.hand.filter(c => c.instanceId !== card.instanceId);
        me.deck.unshift(card); // put on top of deck
      }
      const names = toMove.map(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' ? (d as HeroCardDef).cardName
          : 'name' in d ? (d as { name: string }).name : c.cardId;
      });
      pushLog(state, {
        kind: 'system',
        text: `${me.username}: Dr. Doom's strike — ${names.join(' and ')} put on top of deck.`,
      });
      return;
    }

    // ── Dr. Doom Tactic 4 ────────────────────────────────────────────────────
    case 'extra_turn': {
      state.thisTurn.extraTurn = true;
      pushLog(state, { kind: 'system', text: `${me.username} will take another turn!` });
      return;
    }

    // ── Loki Master Strike ────────────────────────────────────────────────────
    case 'loki_master_strike': {
      // If hand is empty (= active player at end-of-turn villain reveal, just
      // discarded), defer to start of their next turn so the strike actually
      // hits their freshly drawn hand. Non-empty hands resolve immediately.
      if (me.hand.length === 0) {
        if (!me.pendingLokiStrike) {
          me.pendingLokiStrike = true;
          pushLog(state, {
            kind: 'system',
            text: `${me.username}: Loki's Master Strike will fire at the start of their next turn (reveal a Strength Hero or gain a Wound).`,
          });
        }
        return;
      }
      const hasStrength = me.hand.some(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).classes.includes('strength');
      });
      if (hasStrength) {
        pushLog(state, { kind: 'system', text: `${me.username} reveals a Strength Hero — no wound from Loki's Master Strike.` });
      } else {
        const wound = state.woundDeck.shift();
        if (wound) {
          me.discard.push(wound);
          pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
        }
      }
      return;
    }

    // ── Loki Tactic 1: Vanishing Illusions ────────────────────────────────────
    case 'ko_villain_from_vp': {
      // Auto-KO the highest-VP Villain/Henchman in this player's Victory Pile.
      let bestIdx = -1, bestVp = -1;
      for (let i = 0; i < me.victoryPile.length; i++) {
        const d = getCard(me.victoryPile[i].cardId);
        if (d.kind !== 'villain' && d.kind !== 'henchman') continue;
        const v = (d as { vp: number }).vp;
        if (v > bestVp) { bestVp = v; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        const koCard = me.victoryPile.splice(bestIdx, 1)[0];
        state.ko.push(koCard);
        const def = getCard(koCard.cardId);
        const name = 'name' in def ? (def as { name: string }).name : koCard.cardId;
        recomputeVp(me);
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${name} from their Victory Pile (Vanishing Illusions).` });
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} has no Villain in their Victory Pile.` });
      }
      return;
    }

    // ── Loki Tactic 2: Whispers and Lies ─────────────────────────────────────
    case 'ko_bystanders_from_vp': {
      let removed = 0;
      for (let i = 0; i < effect.count; i++) {
        const idx = me.victoryPile.findIndex(c => c.cardId === 'bystander');
        if (idx < 0) break;
        const koCard = me.victoryPile.splice(idx, 1)[0];
        state.ko.push(koCard);
        removed++;
      }
      recomputeVp(me);
      if (removed > 0) {
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${removed} Bystander${removed === 1 ? '' : 's'} from their Victory Pile (Whispers and Lies).` });
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} has no Bystanders in their Victory Pile.` });
      }
      return;
    }

    // ── Loki Tactic 3: Cruel Ruler ────────────────────────────────────────────
    case 'grant_fight_city_free': {
      state.thisTurn.fightCityFreeAvailable = true;
      pushLog(state, { kind: 'system', text: `${me.username} may fight one Villain in the City for free (Cruel Ruler)!` });
      return;
    }

    // ── Loki Tactic 4: Maniacal Tyrant ───────────────────────────────────────
    case 'ko_up_to_from_discard': {
      if (me.discard.length === 0) {
        pushLog(state, { kind: 'system', text: `${me.username} has no cards in discard pile to KO.` });
        return;
      }
      state.thisTurn.pendingChoice = {
        kind: 'ko_up_to_from_discard',
        remaining: effect.amount,
        cards: [...me.discard],
      };
      return;
    }

    // ── Magneto Master Strike ─────────────────────────────────────────────────
    case 'magneto_master_strike': {
      // If hand is empty (= active player at end-of-turn villain reveal, just
      // discarded), defer to start of their next turn so the strike actually
      // hits their freshly drawn hand. Non-empty hands resolve immediately.
      if (me.hand.length === 0) {
        if (!me.pendingMagnetoStrike) {
          me.pendingMagnetoStrike = true;
          pushLog(state, {
            kind: 'system',
            text: `${me.username}: Magneto's Master Strike will fire at the start of their next turn (reveal an X-Men Hero or discard down to 4).`,
          });
        }
        return;
      }
      const hasXmen = me.hand.some(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
      });
      if (hasXmen) {
        pushLog(state, { kind: 'system', text: `${me.username} reveals an X-Men Hero — no penalty from Magneto's Master Strike.` });
      } else {
        // Discard down to 4 cards (auto-discard from top of hand)
        while (me.hand.length > 4) {
          const discarded = me.hand.splice(0, 1)[0];
          me.discard.push(discarded);
          const dDef = getCard(discarded.cardId);
          const dName = dDef.kind === 'hero' ? dDef.cardName : 'name' in dDef ? (dDef as { name: string }).name : discarded.cardId;
          pushLog(state, { kind: 'system', text: `${me.username} discards ${dName} (Magneto Master Strike — down to 4).` });
        }
      }
      return;
    }

    // ── Magneto Tactic 2: Bitter Captor ──────────────────────────────────────
    case 'free_recruit_xmen_from_hq_effect': {
      const hasXmen = state.hq.some(card => {
        if (!card) return false;
        const d = getCard(card.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
      });
      if (!hasXmen) {
        pushLog(state, { kind: 'system', text: `${me.username}: No X-Men Heroes in the HQ — Bitter Captor has no targets.` });
        return;
      }
      state.thisTurn.pendingChoice = { kind: 'free_recruit_xmen_from_hq' };
      return;
    }

    // ── Magneto Tactic 3: Electromagnetic Bubble ──────────────────────────────
    case 'em_bubble': {
      const xmenPlayed = state.thisTurn.playedThisTurn.filter(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
      });
      if (xmenPlayed.length === 0) {
        pushLog(state, { kind: 'system', text: `${me.username} has no X-Men Heroes in played area — Electromagnetic Bubble has no effect.` });
        return;
      }
      state.thisTurn.pendingChoice = { kind: 'em_bubble_select_hero' };
      return;
    }

    // ── Super Hero Civil War twist: KO every Hero in HQ, then refill ──────────
    case 'ko_all_heroes_in_hq': {
      let koCount = 0;
      for (let slot = 0; slot < state.hq.length; slot++) {
        const card = state.hq[slot];
        if (!card) continue;
        const d = getCard(card.cardId);
        if (d.kind !== 'hero') continue;
        state.ko.push(card);
        state.hq[slot] = null;
        koCount++;
      }
      if (koCount > 0) {
        pushLog(state, { kind: 'system', text: `Super Hero Civil War: ${koCount} Hero${koCount === 1 ? '' : 'es'} KO'd from the HQ.` });
        refillHQ(state, true);
      } else {
        pushLog(state, { kind: 'system', text: 'Super Hero Civil War: HQ was empty — no Heroes to KO.' });
      }
      return;
    }

    // ── Magneto Tactic 4: Crushing Shockwave ─────────────────────────────────
    case 'reveal_xmen_or_gain_wounds': {
      if (me.hand.length === 0) return;
      const hasXmenCrushing = me.hand.some(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
      });
      if (hasXmenCrushing) {
        pushLog(state, { kind: 'system', text: `${me.username} reveals an X-Men Hero — no wounds from Crushing Shockwave.` });
      } else {
        for (let i = 0; i < effect.amount; i++) {
          const wound = state.woundDeck.shift();
          if (wound) {
            me.hand.push(wound);
            pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
          }
        }
      }
      return;
    }

    // ── Red Skull Tactic 1 ────────────────────────────────────────────────────
    case 'look_top_three_ko_discard_return': {
      // Reveal the top 3 cards; sort by cost and auto-resolve:
      // KO cheapest, discard middle, return most expensive to top.
      // TODO: replace with an interactive choice prompt.
      const top = me.deck.splice(0, Math.min(3, me.deck.length));
      if (top.length === 0) return;
      const sorted = [...top].sort((a, b) => {
        const da = getCard(a.cardId), db = getCard(b.cardId);
        const ca = da.kind === 'hero' ? (da as HeroCardDef).cost : 0;
        const cb = db.kind === 'hero' ? (db as HeroCardDef).cost : 0;
        return ca - cb; // ascending: index 0 = cheapest
      });
      const names = sorted.map(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' ? (d as HeroCardDef).cardName : ('name' in d ? (d as { name: string }).name : c.cardId);
      });
      if (sorted[0]) state.ko.push(sorted[0]);           // KO cheapest
      if (sorted[1]) me.discard.push(sorted[1]);          // discard middle
      if (sorted[2]) me.deck.unshift(sorted[2]);          // return best to top
      pushLog(state, { kind: 'system', text:
        `${me.username} revealed [${names.join(', ')}]: KO'd ${names[0] ?? '—'}, discarded ${names[1] ?? '—'}, kept ${names[2] ?? '—'} on top.` });
      return;
    }

    // ── Red Skull Tactic 3 bonus ──────────────────────────────────────────────
    case 'draw_per_hydra_in_victory_pile': {
      const hydraCount = me.victoryPile.filter(c => {
        const d = getCard(c.cardId);
        return (d.kind === 'villain' || d.kind === 'henchman') &&
               'team' in d && (d as VillainCardDef).team === 'hydra';
      }).length;
      if (hydraCount === 0) return;
      const before = me.hand.length;
      drawUpTo(me, hydraCount);
      const drew = me.hand.length - before;
      if (drew > 0) {
        state.thisTurn.extraCardsDrawnThisTurn += drew;
        pushLog(state, { kind: 'system', text:
          `${me.username} draws ${drew} card${drew === 1 ? '' : 's'} (${hydraCount} Hydra in Victory Pile).` });
      }
      return;
    }

    // ── Brotherhood villain effects ───────────────────────────────────────────

    // Sabretooth Escape (per-player, escape handler iterates):
    case 'reveal_xmen_or_wound': {
      const xmenCard = me.hand.find(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && 'teams' in d && (d as HeroCardDef).teams.includes('x-men');
      });
      if (xmenCard) {
        const xDef = getCard(xmenCard.cardId) as import('./types').HeroCardDef;
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${xDef.cardName} (X-Men) to satisfy Sabretooth.` });
      } else {
        const wound = state.woundDeck.shift();
        if (wound) {
          me.discard.push(wound);
          pushLog(state, { kind: 'system', text: `${me.username} has no X-Men Hero — gains a Wound from Sabretooth.` });
          recomputeVp(me);
        }
      }
      return;
    }

    // Sabretooth Fight (active player only — iterates all players internally):
    case 'each_player_reveal_xmen_or_wound': {
      for (const player of state.players) {
        const xmenCard = player.hand.find(c => {
          const d = getCard(c.cardId);
          return d.kind === 'hero' && 'teams' in d && (d as HeroCardDef).teams.includes('x-men');
        });
        if (xmenCard) {
          const xDef = getCard(xmenCard.cardId) as import('./types').HeroCardDef;
          pushLog(state, { kind: 'system', text: `${player.username} reveals ${xDef.cardName} (X-Men) to satisfy Sabretooth.` });
        } else {
          const wound = state.woundDeck.shift();
          if (wound) {
            player.discard.push(wound);
            pushLog(state, { kind: 'system', text: `${player.username} has no X-Men Hero — gains a Wound from Sabretooth.` });
            recomputeVp(player);
          }
        }
      }
      return;
    }

    // Juggernaut Ambush (per-player): KO up to `amount` Heroes from discard.
    case 'ko_heroes_from_discard': {
      let koed = 0;
      for (let i = 0; i < effect.amount; i++) {
        const idx = me.discard.findIndex(c => getCard(c.cardId).kind === 'hero');
        if (idx < 0) break;
        state.ko.push(me.discard.splice(idx, 1)[0]);
        koed++;
      }
      if (koed > 0) {
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${koed} Hero${koed > 1 ? 's' : ''} from their discard pile (Juggernaut).` });
        recomputeVp(me);
      }
      return;
    }

    // Juggernaut Escape (per-player): KO up to `amount` Heroes from hand.
    case 'ko_heroes_from_hand_immediate': {
      let koed = 0;
      for (let i = 0; i < effect.amount; i++) {
        const idx = me.hand.findIndex(c => getCard(c.cardId).kind === 'hero');
        if (idx < 0) break;
        state.ko.push(me.hand.splice(idx, 1)[0]);
        koed++;
      }
      if (koed > 0) {
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${koed} Hero${koed > 1 ? 's' : ''} from their hand (Juggernaut Escape).` });
        recomputeVp(me);
      }
      return;
    }

    // Scheme twist conditional: fires inner effects only when the current
    // schemeTwistsRevealed count is within [min, max] (inclusive).
    case 'if_twists_revealed': {
      const n = state.schemeTwistsRevealed;
      const inRange = (effect.min === undefined || n >= effect.min)
                   && (effect.max === undefined || n <= effect.max);
      if (inRange) {
        for (const inner of effect.effects) resolveEffect(state, me, inner);
      }
      return;
    }

    // Mystique Escape: trigger the current Scheme's twist effect immediately.
    case 'trigger_scheme_twist': {
      const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
      state.schemeTwistsRevealed++;
      pushLog(state, {
        kind: 'scheme_twist',
        twistsRevealed: state.schemeTwistsRevealed,
        twistsTotal: scheme?.twists ?? state.schemeTwistsRevealed,
      });
      pushLog(state, { kind: 'system', text: `Mystique triggers a Scheme Twist! (${state.schemeTwistsRevealed} total)` });
      if (scheme?.onTwist) {
        for (const eff of scheme.onTwist) {
          for (const p of state.players) resolveEffect(state, p, eff);
        }
      }
      // Check the evil-wins condition immediately (same logic as doEndTurn).
      if (scheme && scheme.evilWinsAfterTwists !== undefined
          && state.schemeTwistsRevealed >= scheme.evilWinsAfterTwists
          && !state.result && !state.pendingResult) {
        state.result = 'loss';
        state.resultReason = `The scheme has succeeded — ${scheme.evilWinsAfterTwists} Scheme Twists revealed (Mystique).`;
        pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
      }
      return;
    }

    // ── Enemies of Asgard villain effects ────────────────────────────────────

    // Frost Giant Escape (per-player, engine iterates): reveal a [ranged] Hero or gain a Wound.
    case 'reveal_ranged_or_wound': {
      const rangedCard = me.hand.find(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && 'classes' in d &&
          (d as HeroCardDef).classes.includes('ranged');
      });
      if (rangedCard) {
        const rDef = getCard(rangedCard.cardId) as import('./types').HeroCardDef;
        pushLog(state, { kind: 'system', text: `${me.username} reveals ${rDef.cardName} (Ranged) — no Wound gained.` });
      } else {
        const wound = state.woundDeck.shift();
        if (wound) {
          me.discard.push(wound);
          pushLog(state, { kind: 'system', text: `${me.username} has no Ranged Hero — gains a Wound.` });
          recomputeVp(me);
        }
      }
      return;
    }

    // Frost Giant Fight (active player only — iterates all players internally).
    case 'each_player_reveal_ranged_or_wound': {
      for (const player of state.players) {
        const rangedCard = player.hand.find(c => {
          const d = getCard(c.cardId);
          return d.kind === 'hero' && 'classes' in d &&
            (d as HeroCardDef).classes.includes('ranged');
        });
        if (rangedCard) {
          const rDef = getCard(rangedCard.cardId) as import('./types').HeroCardDef;
          pushLog(state, { kind: 'system', text: `${player.username} reveals ${rDef.cardName} (Ranged) — no Wound gained.` });
        } else {
          const wound = state.woundDeck.shift();
          if (wound) {
            player.discard.push(wound);
            pushLog(state, { kind: 'system', text: `${player.username} has no Ranged Hero — gains a Wound.` });
            recomputeVp(player);
          }
        }
      }
      return;
    }

    // Ymir Fight: KO all Wounds from active player's hand and discard pile.
    case 'ko_wounds_from_hand_and_discard': {
      const handWounds   = me.hand.filter(c => c.cardId === 'wound');
      const discardWounds = me.discard.filter(c => c.cardId === 'wound');
      me.hand    = me.hand.filter(c => c.cardId !== 'wound');
      me.discard = me.discard.filter(c => c.cardId !== 'wound');
      const total = handWounds.length + discardWounds.length;
      if (total > 0) {
        state.ko.push(...handWounds, ...discardWounds);
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${total} Wound${total !== 1 ? 's' : ''} (Ymir).` });
        recomputeVp(me);
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} has no Wounds to KO (Ymir).` });
      }
      return;
    }

    // Destroyer Fight: auto-KO all S.H.I.E.L.D. Heroes from active player's hand.
    case 'ko_all_shield_from_hand': {
      const shieldCards = me.hand.filter(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' &&
          (d as HeroCardDef).className === 'S.H.I.E.L.D.';
      });
      me.hand = me.hand.filter(c => {
        const d = getCard(c.cardId);
        return !(d.kind === 'hero' &&
          (d as HeroCardDef).className === 'S.H.I.E.L.D.');
      });
      if (shieldCards.length > 0) {
        state.ko.push(...shieldCards);
        pushLog(state, { kind: 'system', text: `${me.username} KOs ${shieldCards.length} S.H.I.E.L.D. Hero${shieldCards.length !== 1 ? 'es' : ''} (Destroyer).` });
        recomputeVp(me);
      } else {
        pushLog(state, { kind: 'system', text: `${me.username} has no S.H.I.E.L.D. Heroes to KO (Destroyer).` });
      }
      return;
    }

    // ── HYDRA villain effects ─────────────────────────────────────────────────
    case 'villain_deck_reveal_top': {
      // Endless Armies of Hydra Fight: reveal top N cards of the Villain Deck.
      pushLog(state, { kind: 'system', text: `${me.username} triggers Endless Armies — revealing top ${effect.amount} card(s) from the Villain Deck!` });
      for (let i = 0; i < effect.amount; i++) {
        if (state.villainDeck.length === 0) break;
        revealOneVillainCard(state);
        if (state.result) break; // stop immediately if evil wins mid-reveal
      }
      return;
    }

    case 'each_player_without_hydra_vp_gains_wound': {
      // Viper Ambush / Fight / Escape: wound every player with no HYDRA villain in their VP.
      for (const player of state.players) {
        const hasHydra = player.victoryPile.some(c => {
          const d = getCard(c.cardId);
          return d.kind === 'villain' && (d as VillainCardDef).team === 'hydra';
        });
        if (!hasHydra) {
          const wound = state.woundDeck.shift();
          if (wound) {
            player.discard.push(wound);
            pushLog(state, { kind: 'system', text: `${player.username} has no HYDRA Villain — gains a Wound (Viper).` });
            recomputeVp(player);
          }
        } else {
          pushLog(state, { kind: 'system', text: `${player.username} has a HYDRA Villain — safe from Viper.` });
        }
      }
      return;
    }

    // ── Masters of Evil villain effects ──────────────────────────────────────
    case 'rescue_bystander_per_avengers_hero': {
      // Baron Zemo Fight: rescue one Bystander per Avengers Hero the active
      // player has in hand or played this turn.
      const allCards = [...me.hand, ...state.thisTurn.playedThisTurn];
      const avengersCount = allCards.filter(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' &&
          (d as HeroCardDef).teams.includes('avengers');
      }).length;
      pushLog(state, { kind: 'system', text:
        `${me.username} has ${avengersCount} Avengers Hero${avengersCount !== 1 ? 'es' : ''} — Baron Zemo: rescuing ${avengersCount} Bystander${avengersCount !== 1 ? 's' : ''}.` });
      let rescued = 0;
      for (let i = 0; i < avengersCount; i++) {
        const b = state.bystanderDeck.shift();
        if (!b) break; // bystander deck exhausted
        me.victoryPile.push(b); rescued++;
      }
      if (rescued > 0) {
        pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
        applyRescueBonuses(state, me, rescued);
        recomputeVp(me);
      }
      return;
    }

    case 'ko_heroes_from_hand_if_at_location': {
      // Whirlwind Fight: if the villain was fought at a named city location,
      // the active player must KO `amount` Heroes — chosen from hand OR played area.
      const locationMap: Record<string, number> = {
        sewers: 0, bank: 1, rooftops: 2, streets: 3, bridge: 4,
      };
      const locationNames: Record<number, string> = {
        0: 'Sewers', 1: 'Bank', 2: 'Rooftops', 3: 'Streets', 4: 'Bridge',
      };
      const targetSlots = effect.locations
        .map(l => locationMap[l.toLowerCase()])
        .filter((s): s is number => s !== undefined);
      const fightSlot = state.thisTurn.lastFightSlot;
      if (fightSlot === undefined || !targetSlots.includes(fightSlot)) {
        const locName = fightSlot !== undefined ? locationNames[fightSlot] : 'unknown';
        pushLog(state, { kind: 'system', text:
          `Whirlwind: fought at ${locName} — not Rooftops or Bridge, no effect.` });
        return;
      }
      const locName = locationNames[fightSlot];
      // Check if there are any Heroes available to KO across hand AND played area.
      const isHero = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
      const hasEligible =
        me.hand.some(isHero) ||
        state.thisTurn.playedThisTurn.some(isHero);
      if (!hasEligible) {
        pushLog(state, { kind: 'system', text:
          `${me.username} fought Whirlwind at the ${locName} — no Heroes available to KO.` });
        return;
      }
      pushLog(state, { kind: 'system', text:
        `${me.username} fought Whirlwind at the ${locName} — KO ${effect.amount} Hero${effect.amount !== 1 ? 'es' : ''} from hand or played area!` });
      state.thisTurn.pendingChoice = {
        kind: 'ko_from_hand',
        bonus: [],
        filter: 'heroes_only',
        sources: ['hand', 'played'],
        mandatory: true,
        // `remaining` = additional KOs still needed AFTER this one resolves.
        remaining: effect.amount - 1,
      };
      return;
    }

    case 'each_player_reveal_tech_hero_or_wound': {
      // Ultron Escape: each player reveals a [tech] Hero from their hand
      // or gains a Wound.
      for (const player of state.players) {
        const hasTech = player.hand.some(c => {
          const d = getCard(c.cardId);
          return d.kind === 'hero' && (d as HeroCardDef).classes.includes('tech');
        });
        if (!hasTech) {
          const wound = state.woundDeck.shift();
          if (wound) {
            player.discard.push(wound);
            recomputeVp(player);
            pushLog(state, { kind: 'wound_taken', seat: player.seat, username: player.username });
            pushLog(state, { kind: 'system', text:
              `${player.username} has no [tech] Hero in hand — gains a Wound (Ultron Escape).` });
          }
        } else {
          pushLog(state, { kind: 'system', text:
            `${player.username} reveals a [tech] Hero — safe from Ultron.` });
        }
      }
      return;
    }

    case 'melter_reveal_top_each_player': {
      // Melter Fight: reveal the top card of each player's deck. The active
      // player may choose to KO it or return it. MVP: auto-KOs all revealed
      // cards. TODO: add interactive PendingChoice for each revealed card.
      pushLog(state, { kind: 'system', text:
        `${me.username} triggers Melter — each player reveals their top deck card!` });
      for (const player of state.players) {
        const topCard = player.deck[0];
        if (!topCard) {
          pushLog(state, { kind: 'system', text:
            `${player.username}'s deck is empty — no card to reveal.` });
          continue;
        }
        const topDef = getCard(topCard.cardId);
        const topName = topDef.kind === 'hero' ? topDef.cardName
          : 'name' in topDef ? (topDef as { name: string }).name : topCard.cardId;
        player.deck.shift();
        state.ko.push(topCard);
        pushLog(state, { kind: 'system', text:
          `${player.username} reveals ${topName} — KO'd by Melter!` });
      }
      return;
    }

    // ── Doombot Legion henchman fight ────────────────────────────────────────
    case 'look_top_two_ko_one_return_one': {
      // Shuffle discard into deck if needed to get 2 cards.
      if (me.deck.length < 2 && me.discard.length > 0) {
        me.deck = shuffle([...me.deck, ...me.discard]); me.discard = [];
      }
      // Peek top 1 or 2 cards (may be fewer if deck is tiny).
      const peeked = me.deck.splice(0, Math.min(2, me.deck.length));
      if (peeked.length === 0) {
        pushLog(state, { kind: 'system', text: `${me.username}'s deck is empty — Doombot Legion fight has no effect.` });
        return;
      }
      if (peeked.length === 1) {
        // Only one card — forced KO.
        const card = peeked[0];
        const cardName = (() => { const d = getCard(card.cardId); return d.kind === 'hero' ? d.cardName : 'name' in d ? (d as { name: string }).name : card.cardId; })();
        state.ko.push(card);
        pushLog(state, { kind: 'system', text: `${me.username} KO'd ${cardName} (only card available — Doombot Legion).` });
        return;
      }
      // Two cards — player must choose one to KO; other goes back on top.
      state.thisTurn.pendingChoice = {
        kind: 'look_top_two_ko_one_return_one',
        cards: peeked,
        mandatory: true,
      };
      return;
    }

    default: {
      // Exhaustiveness guard — TypeScript will flag this if a new Effect kind
      // is added to types.ts without a corresponding case here.
      const _check: never = effect;
      void _check;
      return;
    }
  }
}

// ---------------- Recruit ----------------

function doRecruit(
  state: LegendaryState,
  me: PlayerState,
  slot: number,
): LegendaryState | { error: string } {
  if (state.thisTurn.healedThisTurn) {
    return { error: 'You used the Healing action this turn — recruit / fight are locked.' };
  }
  if (slot < 0 || slot >= state.hq.length) return { error: 'No such HQ slot' };
  const card = state.hq[slot];
  if (!card) return { error: 'HQ slot is empty' };
  const def = getCard(card.cardId);
  if (def.kind !== 'hero') return { error: 'Card in HQ is not a hero' };
  // Recruit cost paid from recruit pool only (God of Thunder is recruit→attack, not vice versa).
  if (state.thisTurn.recruit < def.cost) {
    return { error: `Need ${def.cost} Recruit, have ${state.thisTurn.recruit}` };
  }
  state.thisTurn.recruit -= def.cost;
  state.thisTurn.recruitedThisTurn = true;
  state.hq[slot] = null;
  me.discard.push(card);
  pushLog(state, {
    kind: 'hero_recruited', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.cardName, cost: def.cost, slot,
  });
  refillHQ(state, true);
  return state;
}

// ---------------- Recruit from always-available pool ----------------
/** Sidekick (cardId 'sidekick') and S.H.I.E.L.D. Officer ('shield_officer')
 *  sit in finite pools beside the board. Each starts at 30 cards. If the pool
 *  is empty the recruit is simply unavailable — per the rules, the game
 *  continues without giving the card. */
function doRecruitPool(
  state: LegendaryState,
  me: PlayerState,
  cardId: CardId,
): LegendaryState | { error: string } {
  if (state.thisTurn.healedThisTurn) {
    return { error: 'You used the Healing action this turn — recruit / fight are locked.' };
  }
  const def = getCard(cardId);
  if (def.kind !== 'hero') return { error: 'Pool card is not a hero' };
  // Rules: Sidekicks are limited to once per turn (§ "Sidekick Deck").
  // S.H.I.E.L.D. Officers have no such limit.
  if (cardId === 'sidekick' && state.thisTurn.sidekickRecruited) {
    return { error: 'You can only recruit one Sidekick per turn' };
  }
  // Pool exhaustion: if the finite pool is empty the card cannot be recruited.
  if (cardId === 'sidekick' && state.sidekickPoolCount <= 0) {
    return { error: 'The Sidekick pool is empty' };
  }
  if (cardId === 'shield_officer' && state.officerPoolCount <= 0) {
    return { error: 'The Officer pool is empty' };
  }
  // Recruit cost paid from recruit pool only (God of Thunder is recruit→attack, not vice versa).
  if (state.thisTurn.recruit < def.cost) {
    return { error: `Need ${def.cost} Recruit, have ${state.thisTurn.recruit}` };
  }
  state.thisTurn.recruit -= def.cost;
  state.thisTurn.recruitedThisTurn = true;
  const instance = mkInstance(cardId);
  me.discard.push(instance);
  if (cardId === 'sidekick') {
    state.thisTurn.sidekickRecruited = true;
    state.sidekickPoolCount--;
  }
  if (cardId === 'shield_officer') {
    state.officerPoolCount--;
  }
  pushLog(state, {
    kind: 'hero_recruited', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.cardName, cost: def.cost, slot: -1,
  });
  return state;
}

// ---------------- Jean Grey per-rescue bonus helper ----------------

/** Fire any active Jean Grey per-rescue bonuses for `count` bystanders rescued.
 *  Called every time bystanders land in the active player's victory pile —
 *  whether from villain defeats, mastermind hits, card effects, or Hawkeye
 *  on-kill rescues. */
function applyRescueBonuses(state: LegendaryState, me: PlayerState, count: number): void {
  if (count <= 0) return;
  if (state.thisTurn.rescueBonusRecruit > 0)
    state.thisTurn.recruit += state.thisTurn.rescueBonusRecruit * count;
  if (state.thisTurn.rescueBonusAttack > 0)
    state.thisTurn.attack  += state.thisTurn.rescueBonusAttack  * count;
  if (state.thisTurn.rescueBonusDraw > 0)
    drawUpTo(me, state.thisTurn.rescueBonusDraw * count);
}

// ---------------- Fight a villain in the city ----------------

function doFightCity(
  state: LegendaryState,
  me: PlayerState,
  slot: number,
): LegendaryState | { error: string } {
  if (state.thisTurn.healedThisTurn) {
    return { error: 'You used the Healing action this turn — recruit / fight are locked.' };
  }
  if (slot < 0 || slot >= state.city.length) return { error: 'No such City slot' };
  const card = state.city[slot];
  if (!card) return { error: 'City slot is empty' };
  const def = getCard(card.cardId);
  if (def.kind !== 'villain' && def.kind !== 'henchman') {
    return { error: 'Card in City is not fightable' };
  }

  // Silent Sniper's "fight a villain with a bystander for free" flag.
  const attached = state.cityBystanders[card.instanceId] ?? [];
  const freeBystanderFight = state.thisTurn.freeBystanderFightAvailable && attached.length > 0;
  const freeFight = freeBystanderFight || !!state.thisTurn.fightCityFreeAvailable;

  // Storm – location debuff (Lightning Bolt / Tidal Wave).
  const locationDebuff = state.thisTurn.locationVillainDebuffs[slot] ?? 0;
  const requiredAttack = Math.max(0, def.attack - locationDebuff);

  // Thor – God of Thunder: attack and recruit are interchangeable.
  const availableAttack = state.thisTurn.recruitAsAttackEnabled
    ? state.thisTurn.attack + state.thisTurn.recruit
    : state.thisTurn.attack;

  // Villain fight condition (e.g. Blob requires an X-Men Hero in hand or played).
  if (def.kind === 'villain' && def.fightCondition?.requires === 'xmen_hero') {
    const hasXmen = [...me.hand, ...state.thisTurn.playedThisTurn].some(c => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' && 'teams' in d && (d as HeroCardDef).teams.includes('x-men');
    });
    if (!hasXmen) return { error: `You cannot defeat ${def.name} without an X-Men Hero in your hand or played this turn.` };
  }

  if (!freeFight && availableAttack < requiredAttack) {
    return { error: `Need ${requiredAttack} Attack, have ${state.thisTurn.attack}` };
  }
  state.thisTurn.foughtThisTurn = true;
  if (freeFight) {
    // Consume whichever free-fight flag was active.
    if (freeBystanderFight) {
      state.thisTurn.freeBystanderFightAvailable = false;
    } else {
      state.thisTurn.fightCityFreeAvailable = false;
    }
  } else if (state.thisTurn.recruitAsAttackEnabled) {
    const fromAttack = Math.min(state.thisTurn.attack, requiredAttack);
    state.thisTurn.attack -= fromAttack;
    state.thisTurn.recruit -= (requiredAttack - fromAttack);
  } else {
    state.thisTurn.attack -= requiredAttack;
  }
  state.city[slot] = null;
  me.victoryPile.push(card);

  // Rescue any bystanders attached to this villain (attached is computed above).
  if (attached.length > 0) {
    for (const b of attached) me.victoryPile.push(b);
    delete state.cityBystanders[card.instanceId];
    pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: attached.length });
    applyRescueBonuses(state, me, attached.length);
  }

  // Record which slot this fight is happening at so location-conditional
  // fight effects (e.g. Whirlwind) can read it during resolution.
  state.thisTurn.lastFightSlot = slot;

  // Fight effect on the villain or henchman (if any)
  if ((def.kind === 'villain' || def.kind === 'henchman') && def.fight) {
    for (const e of def.fight) resolveEffect(state, me, e);
  }

  // Hawkeye – Impossible Trick Shot: rescue bystanders on each kill.
  if (state.thisTurn.rescueBystandersOnKillCount > 0) {
    const n = state.thisTurn.rescueBystandersOnKillCount;
    let rescued = 0;
    for (let i = 0; i < n; i++) {
      const b = state.bystanderDeck.shift();
      if (!b) break; // bystander deck exhausted
      me.victoryPile.push(b); rescued++;
    }
    if (rescued > 0) {
      pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
      applyRescueBonuses(state, me, rescued);
    }
  }

  pushLog(state, {
    kind: 'villain_defeated', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.name, vp: def.vp,
  });
  recomputeVp(me);
  return state;
}

// ---------------- Resolve / skip a pending choice ----------------

function doResolveChoice(
  state: LegendaryState,
  me: PlayerState,
  instanceId: CardInstanceId,
): LegendaryState | { error: string } {
  const choice = state.thisTurn.pendingChoice;
  if (!choice) return { error: 'No pending choice to resolve' };

  // ── Reveal to prevent a wound (Cap's hand passive) ───────────────────────
  if (choice.kind === 'reveal_to_prevent_wound') {
    // Validate: the chosen card must be in hand and have the prevent_wound_draw passive.
    const capIdx = me.hand.findIndex(c => {
      if (c.instanceId !== instanceId) return false;
      const d = getCard(c.cardId);
      return d.kind === 'hero' && (d as HeroCardDef).onHand?.some(
        (h: HandPassive) => h.kind === 'prevent_wound_draw'
      );
    });
    if (capIdx < 0) return { error: 'That card cannot prevent a wound — pick a Captain America card from your hand' };
    // Card STAYS in hand (it is only revealed, not played or discarded).
    state.thisTurn.pendingChoice = undefined;
    // Draw a card instead of taking the wound.
    const before = me.hand.length;
    drawUpTo(me, 1);
    const drew = me.hand.length - before;
    pushLog(state, { kind: 'system', text: `${me.username} reveals their shield — drew ${drew} card${drew === 1 ? '' : 's'} instead of taking a wound.` });
    return state;
  }

  // ── Rogue – Copy Powers: pick a hero from playedThisTurn ─────────────────
  if (choice.kind === 'copy_played_hero') {
    const idx = state.thisTurn.playedThisTurn.findIndex(c => c.instanceId === instanceId);
    if (idx < 0) return { error: 'Card not found in your played cards this turn' };
    const card = state.thisTurn.playedThisTurn[idx];
    const cardDef = getCard(card.cardId);
    if (cardDef.kind !== 'hero') return { error: 'You must copy a Hero card' };
    if (card.cardId === 'rogue_copy_powers') return { error: 'You cannot copy another Copy Powers' };
    state.thisTurn.pendingChoice = undefined;
    // "This card is both Covert and the color you copy" — bump the copied class counts.
    for (const cls of cardDef.classes) {
      state.thisTurn.classPlayedCounts[cls] = (state.thisTurn.classPlayedCounts[cls] ?? 0) + 1;
    }
    pushLog(state, { kind: 'system', text: `${me.username} copies ${cardDef.cardName}.` });
    if (cardDef.onPlay) {
      for (const eff of cardDef.onPlay) resolveEffect(state, me, eff);
    }
    return state;
  }

  // ── Storm – Spinning Cyclone step 1: pick a villain to move ─────────────
  if (choice.kind === 'move_villain_select_villain') {
    const slot = state.city.findIndex(c => c?.instanceId === instanceId);
    if (slot < 0) return { error: 'Card not found in the city' };
    const movedCard = state.city[slot]!;
    const movedDef = getCard(movedCard.cardId);
    const movedName = 'name' in movedDef ? (movedDef as { name: string }).name : movedCard.cardId;
    // Rescue any bystanders attached to this villain first.
    const attached = state.cityBystanders[movedCard.instanceId] ?? [];
    if (attached.length > 0) {
      for (const b of attached) me.victoryPile.push(b);
      delete state.cityBystanders[movedCard.instanceId];
      pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: attached.length });
      applyRescueBonuses(state, me, attached.length);
    }
    // Lift the villain out of the city.
    state.city[slot] = null;
    // Advance to step 2.
    state.thisTurn.pendingChoice = {
      kind: 'move_villain_select_dest',
      sourceSlot: slot,
      sourceName: movedName,
      card: movedCard,
    };
    pushLog(state, { kind: 'system', text: `${me.username} picks up ${movedName} — click a city space to place it.` });
    return state;
  }

  // ── Storm – Spinning Cyclone step 2: pick a destination slot ─────────────
  if (choice.kind === 'move_villain_select_dest') {
    if (!instanceId.startsWith('slot:')) return { error: 'Click a city space to place the villain' };
    const destSlot = parseInt(instanceId.slice(5), 10);
    if (isNaN(destSlot) || destSlot < 0 || destSlot >= state.city.length) {
      return { error: 'Invalid city slot' };
    }
    const existingAtDest = state.city[destSlot];
    // Swap if occupied, or just place if empty.
    if (existingAtDest) {
      state.city[choice.sourceSlot] = existingAtDest;
    }
    state.city[destSlot] = choice.card;
    state.thisTurn.pendingChoice = undefined;
    const locs = ['Sewers', 'Bank', 'Rooftops', 'Streets', 'Bridge'];
    const destName = locs[destSlot] ?? `slot ${destSlot}`;
    const swapText = existingAtDest
      ? ` (swapped with ${(getCard(existingAtDest.cardId) as { name?: string }).name ?? existingAtDest.cardId})`
      : '';
    pushLog(state, { kind: 'system', text: `${me.username} moves ${choice.sourceName} to the ${destName}${swapText}.` });
    return state;
  }

  // ── Dark Technology: free Tech/Ranged recruit from HQ ────────────────────
  if (choice.kind === 'free_recruit_from_hq') {
    const slotIdx = state.hq.findIndex(c => c?.instanceId === instanceId);
    if (slotIdx < 0) return { error: 'That card is not in the HQ' };
    const card = state.hq[slotIdx]!;
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Not a hero card' };
    if (!def.classes.includes('tech') && !def.classes.includes('ranged')) {
      return { error: 'Dark Technology: choose a Tech or Ranged Hero' };
    }
    state.thisTurn.pendingChoice = undefined;
    state.hq[slotIdx] = null;
    me.discard.push(card);
    refillHQ(state, true);
    pushLog(state, {
      kind: 'hero_recruited',
      seat: me.seat,
      username: me.username,
      cardId: def.cardId,
      cardName: def.cardName,
      cost: 0,
      slot: slotIdx,
    });
    return state;
  }

  // ── Solo Twist tuck: player clicked a HQ Hero (cost ≤ 6) to put on bottom of Hero Deck ──
  if (choice.kind === 'solo_twist_tuck_hero') {
    const slotIdx = state.hq.findIndex(c => c?.instanceId === instanceId);
    if (slotIdx < 0) return { error: 'That card is not in the HQ' };
    const card = state.hq[slotIdx]!;
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Select a Hero card from the HQ' };
    if ((def as { cost: number }).cost > 6) return { error: 'Select a Hero costing 6 or less' };
    state.thisTurn.pendingChoice = undefined;
    state.hq[slotIdx] = null;
    state.heroDeck.push(card); // bottom of the Hero Deck
    refillHQ(state, true);
    pushLog(state, {
      kind: 'system',
      text: `${me.username} tucks ${def.cardName} to the bottom of the Hero Deck (Solo Twist bonus).`,
    });
    return state;
  }

  // ── Bitter Captor: free X-Men recruit from HQ ──────────────────────────────
  if (choice.kind === 'free_recruit_xmen_from_hq') {
    const slotIdx = state.hq.findIndex(c => c?.instanceId === instanceId);
    if (slotIdx < 0) return { error: 'That card is not in the HQ' };
    const card = state.hq[slotIdx]!;
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Not a hero card' };
    if (!(def as HeroCardDef).teams.includes('x-men')) return { error: 'Bitter Captor: choose an X-Men Hero' };
    state.thisTurn.pendingChoice = undefined;
    state.hq[slotIdx] = null;
    me.discard.push(card);
    refillHQ(state, true);
    state.thisTurn.recruitedThisTurn = true;
    pushLog(state, {
      kind: 'hero_recruited',
      seat: me.seat, username: me.username,
      cardId: def.cardId, cardName: def.cardName,
      cost: 0, slot: slotIdx,
    });
    return state;
  }

  // ── Maniacal Tyrant: KO from discard ──────────────────────────────────────
  if (choice.kind === 'ko_up_to_from_discard') {
    const idx = me.discard.findIndex(c => c.instanceId === instanceId);
    if (idx < 0) return { error: 'Card not found in discard pile' };
    const card = me.discard.splice(idx, 1)[0];
    state.ko.push(card);
    const def = getCard(card.cardId);
    const name = def.kind === 'hero' ? def.cardName : 'name' in def ? (def as { name: string }).name : card.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} KOs ${name} from discard (Maniacal Tyrant).` });
    const remaining = choice.remaining - 1;
    if (remaining > 0 && me.discard.length > 0) {
      state.thisTurn.pendingChoice = {
        kind: 'ko_up_to_from_discard',
        remaining,
        cards: [...me.discard],
      };
    } else {
      state.thisTurn.pendingChoice = undefined;
    }
    return state;
  }

  // ── Electromagnetic Bubble: select X-Men hero from played area ─────────────
  if (choice.kind === 'em_bubble_select_hero') {
    const idx = state.thisTurn.playedThisTurn.findIndex(c => c.instanceId === instanceId);
    if (idx < 0) return { error: 'Card not found in played area' };
    const card = state.thisTurn.playedThisTurn[idx];
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Select a Hero card' };
    if (!(def as HeroCardDef).teams.includes('x-men')) return { error: 'Select an X-Men Hero' };
    // Remove from playedThisTurn so it won't be discarded at end of turn.
    state.thisTurn.playedThisTurn.splice(idx, 1);
    me.nextHandBonusCard = card;
    state.thisTurn.pendingChoice = undefined;
    pushLog(state, {
      kind: 'system',
      text: `${me.username} selects ${def.cardName} — it will be added to their next hand (Electromagnetic Bubble).`,
    });
    return state;
  }

  // ── Deadpool "Here, Hold This": player clicked a city villain to capture the bystander ──
  if (choice.kind === 'choose_city_villain_for_bystander') {
    const slot = state.city.findIndex(c => c?.instanceId === instanceId);
    if (slot < 0) return { error: 'That card is not in the city' };
    const target = state.city[slot]!;
    const targetDef = getCard(target.cardId);
    if (targetDef.kind !== 'villain' && targetDef.kind !== 'henchman') {
      return { error: 'Choose a Villain or Henchman in the city' };
    }
    const targetName = 'name' in targetDef ? (targetDef as { name: string }).name : target.cardId;
    state.cityBystanders[target.instanceId] = [
      ...(state.cityBystanders[target.instanceId] ?? []),
      choice.bystander,
    ];
    pushLog(state, { kind: 'bystander_captured', capturedBy: 'villain', captorName: targetName });
    state.thisTurn.pendingChoice = undefined;
    return state;
  }

  // ── Doombot Legion: player picks one of the two peeked cards to KO ─────────
  if (choice.kind === 'look_top_two_ko_one_return_one') {
    const koIdx = choice.cards.findIndex(c => c.instanceId === instanceId);
    if (koIdx < 0) return { error: 'Choose one of the two revealed cards to KO' };
    const toKO = choice.cards[koIdx];
    const toReturn = choice.cards[1 - koIdx]; // the other one
    const koName = (() => { const d = getCard(toKO.cardId); return d.kind === 'hero' ? d.cardName : 'name' in d ? (d as { name: string }).name : toKO.cardId; })();
    const retName = (() => { const d = getCard(toReturn.cardId); return d.kind === 'hero' ? d.cardName : 'name' in d ? (d as { name: string }).name : toReturn.cardId; })();
    state.ko.push(toKO);
    me.deck.unshift(toReturn); // return other to top of deck
    pushLog(state, { kind: 'system', text: `${me.username} KO'd ${koName} and returned ${retName} to the top of their deck (Doombot Legion).` });
    state.thisTurn.pendingChoice = undefined;
    return state;
  }

  // Binary choices don't involve card selection — reject if dispatched.
  if (choice.kind === 'discard_hand_draw_four' ||
      choice.kind === 'optional_gain_wound_pass_left' ||
      choice.kind === 'reveal_top_discard_or_return' ||
      choice.kind === 'choose_others_draw_or_discard' ||
      choice.kind === 'optional_gain_card') {
    return { error: 'Use accept_choice / skip_choice for this pending choice — no card selection needed.' };
  }

  // ── Gambit – Stack the Deck: put chosen hand-card on top of deck ──────────
  if (choice.kind === 'put_card_on_deck') {
    const idx = me.hand.findIndex(c => c.instanceId === instanceId);
    if (idx < 0) return { error: 'Card not in your hand' };
    const card = me.hand.splice(idx, 1)[0];
    me.deck.unshift(card); // put on top
    const cDef = getCard(card.cardId);
    const cardName =
      cDef.kind === 'hero' ? cDef.cardName :
      'name' in cDef ? (cDef as { name: string }).name : card.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} puts ${cardName} on top of their deck.` });
    state.thisTurn.pendingChoice = undefined;
    return state;
  }

  // Locate the card in whichever zone(s) the choice allows.
  // (choice is now narrowed to ko_from_hand | discard_from_hand | reveal_to_prevent_wound)
  const sources: ('hand' | 'discard' | 'played')[] =
    'sources' in choice ? (choice.sources ?? ['hand', 'played']) : ['hand', 'played'];
  let zone: 'hand' | 'discard' | 'played' = 'hand';
  let idx = -1;

  if (sources.includes('hand')) {
    idx = me.hand.findIndex(c => c.instanceId === instanceId);
    if (idx >= 0) zone = 'hand';
  }
  if (idx < 0 && sources.includes('discard')) {
    idx = me.discard.findIndex(c => c.instanceId === instanceId);
    if (idx >= 0) zone = 'discard';
  }
  if (idx < 0 && sources.includes('played')) {
    idx = state.thisTurn.playedThisTurn.findIndex(c => c.instanceId === instanceId);
    if (idx >= 0) zone = 'played';
  }
  if (idx < 0) {
    return { error: 'Card not found in a valid zone for this choice' };
  }

  const card =
    zone === 'hand'    ? me.hand[idx] :
    zone === 'discard' ? me.discard[idx] :
                         state.thisTurn.playedThisTurn[idx];

  // Validate filter
  if ('filter' in choice && choice.filter === 'wounds_only' && card.cardId !== 'wound') {
    return { error: 'You must choose a Wound card for this effect' };
  }
  if ('filter' in choice && choice.filter === 'shield_heroes') {
    const d = getCard(card.cardId);
    const shieldTeams = new Set(['shield', 'shield-officer', 'shield-agent', 'shield-trooper']);
    if (d.kind !== 'hero' || !(d as HeroCardDef).teams.some(t => shieldTeams.has(t))) {
      return { error: 'You must choose a S.H.I.E.L.D. Hero card for this effect' };
    }
  }
  if ('filter' in choice && choice.filter === 'heroes_only') {
    if (getCard(card.cardId).kind !== 'hero') {
      return { error: 'You must choose a Hero card for this effect' };
    }
  }

  // Remove from the appropriate zone
  if (zone === 'hand')    me.hand.splice(idx, 1);
  else if (zone === 'discard') me.discard.splice(idx, 1);
  else                    state.thisTurn.playedThisTurn.splice(idx, 1);

  // Determine card's display name for the log
  const cDef = getCard(card.cardId);
  const cardLabel =
    cDef.kind === 'hero'      ? cDef.cardName :
    'name' in cDef            ? (cDef as { name: string }).name :
    card.cardId;
  const zoneLabel = zone === 'discard' ? 'discard pile' : zone === 'played' ? 'played area' : 'hand';

  // KO or discard the chosen card
  if (choice.kind === 'ko_from_hand') {
    state.ko.push(card);
    pushLog(state, { kind: 'system', text: `${me.username} KO'd ${cardLabel} from ${zoneLabel}.` });
  } else {
    // Check if the card has the "return to hand if discarded" passive.
    const hasReturnPassive = cDef.kind === 'hero' && (cDef as HeroCardDef).onHand?.some(
      (h: HandPassive) => h.kind === 'return_to_hand_if_discarded'
    );
    if (hasReturnPassive && zone === 'hand') {
      me.hand.push(card); // bounce back to hand — effect satisfied, card survives
      pushLog(state, { kind: 'system', text: `${me.username}'s ${cardLabel} returns to hand.` });
    } else {
      me.discard.push(card);
      pushLog(state, { kind: 'system', text: `${me.username} discarded ${cardLabel} from ${zoneLabel}.` });
    }
  }

  // Clear choice BEFORE resolving bonus (bonus could chain another choice).
  state.thisTurn.pendingChoice = undefined;

  // Multi-KO chain: if `remaining > 0` (e.g. Whirlwind "KO 2 Heroes"), queue the
  // next KO prompt — but only if there are still eligible cards left to pick from.
  if (choice.kind === 'ko_from_hand' && (choice.remaining ?? 0) > 0) {
    const isHeroCard  = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
    const isShieldCard = (c: CardInstance) => {
      const d = getCard(c.cardId);
      if (d.kind !== 'hero') return false;
      const st = new Set(['shield', 'shield-officer', 'shield-agent', 'shield-trooper']);
      return (d as HeroCardDef).teams.some(t => st.has(t));
    };
    const isWoundCard = (c: CardInstance) => c.cardId === 'wound';
    const matchFn =
      choice.filter === 'heroes_only'  ? isHeroCard  :
      choice.filter === 'shield_heroes' ? isShieldCard :
      choice.filter === 'wounds_only'   ? isWoundCard  :
      () => true;
    const srcs = choice.sources ?? ['hand', 'played'];
    const hasMore =
      (srcs.includes('hand')    && me.hand.some(matchFn)) ||
      (srcs.includes('played')  && state.thisTurn.playedThisTurn.some(matchFn)) ||
      (srcs.includes('discard') && me.discard.some(matchFn));
    if (hasMore) {
      state.thisTurn.pendingChoice = {
        kind: 'ko_from_hand',
        bonus: [],
        filter: choice.filter,
        sources: choice.sources,
        mandatory: choice.mandatory,
        remaining: (choice.remaining ?? 0) - 1,
      };
    }
  }

  // Resolve the "If you do…" bonus effects.
  const bonus = 'bonus' in choice ? choice.bonus : [];
  for (const eff of bonus) {
    resolveEffect(state, me, eff);
  }

  return state;
}

/** Deadpool – Random Acts: each player passes their top hand-card to the left.
 *  "Left" = next seat in ascending seat order, wrapping around.
 *  In a 1-player game this is a no-op (nothing to pass to). */
function executePassCardsLeft(state: LegendaryState): void {
  const n = state.players.length;
  if (n < 2) {
    pushLog(state, { kind: 'system', text: 'Card passing: no other players.' });
    return;
  }
  // Collect the top card from every player's hand simultaneously, then give
  // each to the player at the next seat index (left = +1 mod n).
  const passCards: (CardInstance | null)[] = state.players.map(p =>
    p.hand.length > 0 ? p.hand.splice(0, 1)[0]! : null
  );
  for (let i = 0; i < n; i++) {
    const card = passCards[i];
    if (!card) {
      pushLog(state, { kind: 'system', text: `${state.players[i].username} has no card to pass.` });
      continue;
    }
    const leftPlayer = state.players[(i + 1) % n];
    leftPlayer.hand.push(card);
    pushLog(state, {
      kind: 'system',
      text: `${state.players[i].username} passes a card to ${leftPlayer.username}.`,
    });
  }
}

/** Handle binary (Accept / Skip) pending choices that don't require card selection. */
function doAcceptChoice(
  state: LegendaryState,
  me: PlayerState,
): LegendaryState | { error: string } {
  const choice = state.thisTurn.pendingChoice;
  if (!choice) return { error: 'No pending choice to accept' };

  if (choice.kind === 'reveal_top_discard_or_return') {
    state.thisTurn.pendingChoice = undefined;
    // Accept = discard the revealed card.
    me.discard.push(choice.card);
    const cDef = getCard(choice.card.cardId);
    const cardName =
      cDef.kind === 'hero' ? cDef.cardName :
      'name' in cDef ? (cDef as { name: string }).name : choice.card.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} discards ${cardName}.` });
    return state;
  }

  if (choice.kind === 'discard_hand_draw_four') {
    state.thisTurn.pendingChoice = undefined;
    const discardCount = me.hand.length;
    for (const c of me.hand) me.discard.push(c);
    me.hand = [];
    drawUpTo(me, 4);
    pushLog(state, {
      kind: 'system',
      text: `${me.username} discards ${discardCount} card${discardCount === 1 ? '' : 's'} and draws 4.`,
    });
    return state;
  }

  if (choice.kind === 'optional_gain_wound_pass_left') {
    state.thisTurn.pendingChoice = undefined;
    // "Gain a Wound to your hand" — wound goes to hand, not discard.
    const w = state.woundDeck.shift();
    if (w) {
      me.hand.push(w);
      pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
    } else {
      pushLog(state, { kind: 'system', text: 'No wounds left in the deck.' });
    }
    // Card passing always happens, wound or not.
    executePassCardsLeft(state);
    return state;
  }

  if (choice.kind === 'choose_others_draw_or_discard') {
    state.thisTurn.pendingChoice = undefined;
    // Accept = each other player draws a card.
    for (const p of state.players) {
      if (p.playerId === me.playerId) continue;
      const before = p.hand.length;
      drawUpTo(p, 1);
      const drew = p.hand.length - before;
      if (drew > 0) {
        pushLog(state, { kind: 'system', text: `${p.username} draws a card.` });
      }
    }
    return state;
  }

  if (choice.kind === 'optional_return_sidekick_draw_two') {
    state.thisTurn.pendingChoice = undefined;
    // Remove the most-recently-played Sidekick from playedThisTurn so it
    // doesn't go to the player's discard at end-of-turn (it's "returned to
    // the infinite Sidekick pool"). Then draw two cards.
    const idx = state.thisTurn.playedThisTurn.map(c => c.cardId).lastIndexOf('sidekick');
    if (idx >= 0) {
      state.thisTurn.playedThisTurn.splice(idx, 1);
    }
    const before = me.hand.length;
    drawUpTo(me, 2);
    const drew = me.hand.length - before;
    if (drew > 0) state.thisTurn.extraCardsDrawnThisTurn += drew;
    pushLog(state, { kind: 'system', text: `${me.username} returns a Sidekick and draws ${drew} card${drew === 1 ? '' : 's'}.` });
    return state;
  }

  if (choice.kind === 'optional_gain_card') {
    state.thisTurn.pendingChoice = undefined;
    const instance = mkInstance(choice.cardId);
    me.hand.push(instance);
    const cDef = getCard(choice.cardId);
    const cName = cDef.kind === 'hero' ? cDef.cardName
      : 'name' in cDef ? (cDef as { name: string }).name : choice.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} gains a ${cName} to their hand.` });
    return state;
  }

  return { error: 'Nothing to accept for this choice kind' };
}

function doSkipChoice(state: LegendaryState): LegendaryState | { error: string } {
  const choice = state.thisTurn.pendingChoice;
  if (!choice) return { error: 'No pending choice to skip' };
  if ('mandatory' in choice && choice.mandatory) {
    return { error: choice.kind === 'put_card_on_deck'
      ? 'You must choose a card to put on top of your deck — this cannot be skipped.'
      : 'You must discard a card — this cost cannot be skipped.' };
  }
  state.thisTurn.pendingChoice = undefined;
  // Gambit – Hypnotic Charm: skip = put the revealed card back on top of deck.
  if (choice.kind === 'reveal_top_discard_or_return') {
    const me = state.players[state.currentPlayerIdx];
    me.deck.unshift(choice.card); // return to top
    const cDef = getCard(choice.card.cardId);
    const cardName =
      cDef.kind === 'hero' ? cDef.cardName :
      'name' in cDef ? (cDef as { name: string }).name : choice.card.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} puts ${cardName} back on top of their deck.` });
    return state;
  }
  // Reveal-to-prevent-wound: player declined, so apply the wound now.
  if (choice.kind === 'reveal_to_prevent_wound') {
    const me = state.players[state.currentPlayerIdx];
    const w = state.woundDeck.shift();
    if (w) {
      me.discard.push(w);
      pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
    } else {
      // Per the rules: if the Wound Deck is empty, no wound is given — game continues.
      pushLog(state, { kind: 'system', text: 'The Wound Deck is empty — no wound taken.' });
    }
    return state;
  }
  // Rogue – Copy Powers: player chose not to copy — nothing happens.
  if (choice.kind === 'copy_played_hero') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} chose not to copy.` });
    return state;
  }
  // Storm – Spinning Cyclone step 1: player chose not to move any villain.
  if (choice.kind === 'move_villain_select_villain') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} chose not to move a Villain.` });
    return state;
  }
  // Storm – Spinning Cyclone step 2: villain was already lifted out; put it back.
  if (choice.kind === 'move_villain_select_dest') {
    const me = state.players[state.currentPlayerIdx];
    state.city[choice.sourceSlot] = choice.card; // return to original slot
    pushLog(state, { kind: 'system', text: `${me.username} returns ${choice.sourceName} to its original space.` });
    return state;
  }
  // Do-Over: player chose to keep their hand — nothing happens.
  if (choice.kind === 'discard_hand_draw_four') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} kept their hand.` });
    return state;
  }
  // Random Acts: player declined the wound, but card-passing still fires.
  if (choice.kind === 'optional_gain_wound_pass_left') {
    executePassCardsLeft(state);
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} declined the wound.` });
    return state;
  }
  // Dark Technology: player chose not to take the free recruit — nothing happens.
  if (choice.kind === 'free_recruit_from_hq') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} passes on the free Tech/Ranged recruit.` });
    return state;
  }
  // Bitter Captor: player chose not to take the free X-Men recruit.
  if (choice.kind === 'free_recruit_xmen_from_hq') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} passes on the free X-Men recruit.` });
    return state;
  }
  // Maniacal Tyrant: player stops KO-ing from discard.
  if (choice.kind === 'ko_up_to_from_discard') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} stops discarding (Maniacal Tyrant).` });
    return state;
  }
  // Electromagnetic Bubble: player skips selecting a hero.
  if (choice.kind === 'em_bubble_select_hero') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} skips Electromagnetic Bubble.` });
    return state;
  }
  // Covering Fire (Skip): each other player discards a card from their hand.
  if (choice.kind === 'choose_others_draw_or_discard') {
    const me = state.players[state.currentPlayerIdx];
    for (const p of state.players) {
      if (p.playerId === me.playerId) continue;
      if (p.hand.length > 0) {
        const card = p.hand.splice(0, 1)[0];
        p.discard.push(card);
        pushLog(state, { kind: 'system', text: `${p.username} discards a card.` });
      }
    }
    return state;
  }
  // optional_gain_card: player declined — nothing happens.
  if (choice.kind === 'optional_gain_card') {
    const me = state.players[state.currentPlayerIdx];
    pushLog(state, { kind: 'system', text: `${me.username} declined to gain a ${choice.label}.` });
    return state;
  }
  pushLog(state, { kind: 'system', text: 'Choice skipped.' });
  return state;
}

// ---------------- Fight the Mastermind ----------------

function doFightMastermind(
  state: LegendaryState,
  me: PlayerState,
): LegendaryState | { error: string } {
  if (state.thisTurn.healedThisTurn) {
    return { error: 'You used the Healing action this turn — recruit / fight are locked.' };
  }
  const mmDef = getCard(state.mastermind.cardId);
  if (mmDef.kind !== 'mastermind') return { error: 'Mastermind misconfigured' };
  if (state.mastermind.tactics.length === 0) {
    return { error: 'Mastermind is already defeated' };
  }

  // Silent Sniper's free-fight flag: fight the Mastermind for free if it holds
  // at least one bystander and the flag has been set this turn.
  const mmFreeFight = state.thisTurn.freeBystanderFightAvailable &&
                      state.mastermind.bystanders.length > 0;

  // Storm – Tidal Wave: mastermind attack debuff.
  const mmRequired = Math.max(0, mmDef.attack - state.thisTurn.mastermindAttackDebuff);

  // Thor – God of Thunder: attack and recruit are interchangeable.
  const mmAvailable = state.thisTurn.recruitAsAttackEnabled
    ? state.thisTurn.attack + state.thisTurn.recruit
    : state.thisTurn.attack;

  if (!mmFreeFight && mmAvailable < mmRequired) {
    return { error: `Need ${mmRequired} Attack to hit ${mmDef.name}` };
  }
  state.thisTurn.foughtThisTurn = true;
  if (mmFreeFight) {
    state.thisTurn.freeBystanderFightAvailable = false;
  } else if (state.thisTurn.recruitAsAttackEnabled) {
    const fromAtk = Math.min(state.thisTurn.attack, mmRequired);
    state.thisTurn.attack -= fromAtk;
    state.thisTurn.recruit -= (mmRequired - fromAtk);
  } else {
    state.thisTurn.attack -= mmRequired;
  }
  state.mastermind.hitsTaken++;

  // ── Step 1: Take a random face-down Tactic card ──────────────────────────
  // Per the rules: "Take a random card from the face-down Tactics underneath
  // the Mastermind and put that Tactic into your Victory Pile."
  const tacticIdx = Math.floor(Math.random() * state.mastermind.tactics.length);
  const [tacticCard] = state.mastermind.tactics.splice(tacticIdx, 1);
  const tacticDef = getCard(tacticCard.cardId);
  if (tacticDef.kind !== 'tactic') return { error: 'Tactic card misconfigured' };
  me.victoryPile.push(tacticCard);

  // ── Step 2: Rescue any Bystanders the Mastermind was holding ────────────
  // Per the rules: "Also rescue any Bystanders the Mastermind was holding,
  // putting them all into your Victory Pile."
  if (state.mastermind.bystanders.length > 0) {
    const count = state.mastermind.bystanders.length;
    for (const b of state.mastermind.bystanders) me.victoryPile.push(b);
    state.mastermind.bystanders = [];
    pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count });
    applyRescueBonuses(state, me, count);
  }

  // ── Step 3: Resolve the Tactic's Fight effects ───────────────────────────
  // "fightOthers" effects target EACH other player (punishments). We resolve
  // them with auto-pick (no prompt) since they are imposed, not chosen.
  const others = state.players.filter(p => p.playerId !== me.playerId);
  for (const eff of tacticDef.fightOthers ?? []) {
    for (const p of others) {
      if (eff.kind === 'discard_from_hand') {
        // Force-discard top card of hand without player choice.
        for (let i = 0; i < eff.up_to && p.hand.length > 0; i++) {
          const discarded = p.hand.splice(0, 1)[0];
          p.discard.push(discarded);
          pushLog(state, { kind: 'system', text: `${p.username} discards a card — ${tacticDef.name}.` });
        }
      } else {
        resolveEffect(state, p, eff);
      }
    }
  }
  // "fightSelf" effects benefit/punish the fighting player.
  for (const eff of tacticDef.fightSelf ?? []) {
    resolveEffect(state, me, eff);
  }

  // Hawkeye – Impossible Trick Shot: rescue bystanders on each mastermind hit.
  if (state.thisTurn.rescueBystandersOnKillCount > 0) {
    const n = state.thisTurn.rescueBystandersOnKillCount;
    let rescued = 0;
    for (let i = 0; i < n; i++) {
      const b = state.bystanderDeck.shift();
      if (!b) break; // bystander deck exhausted
      me.victoryPile.push(b); rescued++;
    }
    if (rescued > 0) {
      pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
      applyRescueBonuses(state, me, rescued);
    }
  }

  pushLog(state, {
    kind: 'mastermind_hit',
    seat: me.seat,
    username: me.username,
    tacticName: tacticDef.name,
    tacticVp: tacticDef.vp,
    tacticsRemaining: state.mastermind.tactics.length,
    tacticCardId: tacticDef.cardId,
    tacticText: tacticDef.text ?? '',
  });
  recomputeVp(me);

  // ── Win condition: all Tactics taken ─────────────────────────────────────
  // Per the rules: "That player can still finish the rest of their turn in
  // case they want to grab a few more Victory Points." We set pendingResult
  // instead of result so the current player may keep acting; the win is
  // committed when they click End Turn. Victory is also immune to any evil-
  // wins condition triggered by the final Tactic's Fight effect.
  if (state.mastermind.tactics.length === 0) {
    state.pendingResult = 'win';
    pushLog(state, {
      kind: 'system',
      text: `All four Tactics defeated — ${mmDef.name} is vanquished! Finish your turn for bonus VP.`,
    });
  }

  return state;
}

function doWoundHealing(
  state: LegendaryState,
  me: PlayerState,
): LegendaryState | { error: string } {
  if (state.thisTurn.foughtThisTurn) {
    return { error: 'You have already fought this turn — Healing is no longer available.' };
  }
  if (state.thisTurn.recruitedThisTurn) {
    return { error: 'You have already recruited this turn — Healing is no longer available.' };
  }
  const wounds = me.hand.filter(c => c.cardId === 'wound');
  if (wounds.length === 0) return { error: 'No Wounds in hand to KO.' };
  // KO all wounds from hand
  me.hand = me.hand.filter(c => c.cardId !== 'wound');
  for (const w of wounds) state.ko.push(w);
  // Lock out recruit / fight for the rest of the turn — healing is conditional
  // on "if you don't recruit or fight anything on your turn".
  state.thisTurn.healedThisTurn = true;
  pushLog(state, { kind: 'system', text: `${me.username} heals: KO'd ${wounds.length} Wound${wounds.length === 1 ? '' : 's'} from their hand. (No more recruit / fight this turn.)` });
  return state;
}

function recomputeVp(p: PlayerState): void {
  let vp = 0;
  for (const c of p.victoryPile) {
    const d = getCard(c.cardId);
    if (d.kind === 'villain') {
      vp += d.vp;
      // Team-scaling — e.g. Supreme HYDRA: +3 VP per other HYDRA villain in VP.
      if (d.vpScale) {
        const { team, amount } = d.vpScale;
        const otherCount = p.victoryPile.filter(vc => {
          if (vc.instanceId === c.instanceId) return false; // exclude self
          const od = getCard(vc.cardId);
          return od.kind === 'villain' && (od as import('./types').VillainCardDef).team === team;
        }).length;
        vp += otherCount * amount;
      }
      // Class-scaling across all cards — e.g. Ultron: +1 VP per [black] Hero
      // among all the player's cards (hand + deck + discard + victoryPile).
      if (d.vpScaleClass) {
        const { cls, amount } = d.vpScaleClass;
        const allCards = [...p.hand, ...p.deck, ...p.discard, ...p.victoryPile];
        const count = allCards.filter(vc => {
          const od = getCard(vc.cardId);
          return od.kind === 'hero' &&
            (od as HeroCardDef).classes.includes(cls as import('./types').HeroClass);
        }).length;
        vp += count * amount;
      }
    }
    if (d.kind === 'henchman')   vp += d.vp;
    if (d.kind === 'mastermind') vp += d.vp;
    if (d.kind === 'tactic')     vp += d.vp; // Mastermind Tactics carry the MM's VP
    if (d.kind === 'bystander')  vp += d.vp;
  }
  p.vp = vp;
}

// ---------------- Reveal first villain ----------------

/** Triggered when the current player (seat 0, turn 1) clicks "Game Begins".
 *  Reveals the opening villain into the city so the reveal animation fires
 *  exactly when the player expects it — not during headless setup.
 *
 *  Solo mode: the 2 starting henchmen enter the city one at a time (each with
 *  their own enterCity call so ambush effects fire correctly), then the normal
 *  first villain-deck reveal happens immediately after. */
function doRevealFirstVillain(state: LegendaryState): LegendaryState | { error: string } {
  if (state.city.some(c => c !== null)) return { error: 'City is not empty — first villain already revealed' };

  if (state.players.length === 1 && !state.soloStartingHenchmenPlaced) {
    state.soloStartingHenchmenPlaced = true;
    for (const hCard of state.soloStartingHenchmen ?? []) {
      const hDef = getCard(hCard.cardId);
      enterCity(state, hCard, hDef);
    }
    state.soloStartingHenchmen = [];
  }

  revealOneVillainCard(state);
  return state;
}

// ---------------- End turn ----------------

/**
 * Resolve any master-strike effects that were deferred because the player's
 * hand was empty when the strike fired (active player at end-of-turn villain
 * reveal). Called after a fresh hand is drawn, so the deferred effect lands
 * on the new hand. Currently handles Red Skull (KO a Hero), Magneto (reveal
 * X-Men or discard down to 4), and Loki (reveal Strength Hero or gain Wound).
 */
function resolvePendingStrikes(state: LegendaryState, player: PlayerState): void {
  // Red Skull: KO a Hero of your choice (prompt via pendingChoice).
  if (player.pendingMasterStrikeKO) {
    player.pendingMasterStrikeKO = undefined;
    const heroes = player.hand.filter(c => getCard(c.cardId).kind === 'hero');
    if (heroes.length > 0) {
      state.thisTurn.pendingChoice = {
        kind: 'ko_from_hand',
        mandatory: true,
        bonus: [],
        filter: 'heroes_only',
      };
      pushLog(state, {
        kind: 'system',
        text: `${player.username}: Master Strike — KO a Hero from your hand before acting.`,
      });
    }
  }

  // Magneto: reveal an X-Men Hero, or discard the hand down to 4 cards.
  if (player.pendingMagnetoStrike) {
    player.pendingMagnetoStrike = undefined;
    const hasXmen = player.hand.some(c => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
    });
    if (hasXmen) {
      pushLog(state, {
        kind: 'system',
        text: `${player.username}: revealed an X-Men Hero — no penalty from Magneto's Master Strike.`,
      });
    } else {
      while (player.hand.length > 4) {
        const discarded = player.hand.splice(0, 1)[0];
        player.discard.push(discarded);
        const dDef = getCard(discarded.cardId);
        const dName = dDef.kind === 'hero' ? dDef.cardName : 'name' in dDef ? (dDef as { name: string }).name : discarded.cardId;
        pushLog(state, {
          kind: 'system',
          text: `${player.username} discards ${dName} (Magneto Master Strike — down to 4).`,
        });
      }
    }
  }

  // Loki: reveal a Strength Hero, or gain a Wound.
  if (player.pendingLokiStrike) {
    player.pendingLokiStrike = undefined;
    const hasStrength = player.hand.some(c => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' && (d as HeroCardDef).classes.includes('strength');
    });
    if (hasStrength) {
      pushLog(state, {
        kind: 'system',
        text: `${player.username}: revealed a Strength Hero — no wound from Loki's Master Strike.`,
      });
    } else {
      const wound = state.woundDeck.shift();
      if (wound) {
        player.discard.push(wound);
        pushLog(state, { kind: 'wound_taken', seat: player.seat, username: player.username });
      }
    }
  }
}

function doEndTurn(state: LegendaryState): LegendaryState | { error: string } {
  const me = state.players[state.currentPlayerIdx];

  // 1. Discard played cards + remaining hand.
  for (const c of state.thisTurn.playedThisTurn) me.discard.push(c);
  for (const c of me.hand) me.discard.push(c);
  me.hand = [];

  // ── Pending win: finalize immediately, skip villain reveal. ───────────────
  // Per the rules: "as soon as the Mastermind has no more Tactics under them,
  // victory is assured — players will win the game even if the final Tactic's
  // Fight ability would achieve Evil Wins or cause a deck to run out."
  if (state.pendingResult === 'win') {
    const mmDef = getCard(state.mastermind.cardId);
    const mmName = mmDef.kind === 'mastermind' ? mmDef.name : 'The Mastermind';
    state.result       = 'win';
    state.resultReason = `${mmName} has been defeated! Heroes win!`;
    state.phase        = 'finished';
    state.pendingResult = undefined;
    pushLog(state, { kind: 'game_ended', result: 'win', reasonText: state.resultReason });
    return state;
  }

  // 2. Refresh HQ.
  refillHQ(state, true);
  // Hero Deck tie trigger: if the shared HQ supply is exhausted this turn,
  // note it — will be resolved after the villain reveal below.
  if (state.heroDeck.length === 0 && !state.lastTurnTie) {
    state.lastTurnTie = true;
    pushLog(state, {
      kind: 'system',
      text: 'The Hero Deck has run out — this is the heroes\' final turn!',
    });
  }

  // 3. Draw THIS player's next hand now (before villain reveal). The official
  //    rule is that hands are drawn at end-of-turn so the player can plan
  //    their next turn, AND so any master-strike effect fired by the upcoming
  //    villain reveal lands on a real 6-card hand instead of an empty one.
  //    Consumes any per-player draw bonuses (Treasures of Latveria) and
  //    next-hand bonus card (Electromagnetic Bubble).
  const meExtraDraw = me.endOfTurnExtraDraw ?? 0;
  me.endOfTurnExtraDraw = undefined;
  drawUpTo(me, STARTING_HAND_SIZE + meExtraDraw);
  if (me.nextHandBonusCard) {
    const meBonusDef = getCard(me.nextHandBonusCard.cardId);
    const meBonusName = meBonusDef.kind === 'hero' ? meBonusDef.cardName : me.nextHandBonusCard.cardId;
    me.hand.push(me.nextHandBonusCard);
    me.nextHandBonusCard = undefined;
    pushLog(state, { kind: 'system', text: `${me.username}: ${meBonusName} added to hand as 7th card (Electromagnetic Bubble).` });
  }

  // 4. Reveal one card from the Villain Deck (villain/henchman → city;
  //    master_strike / scheme_twist / bystander → resolve without city push).
  revealOneVillainCard(state);

  // ── Evil wins: check immediately after reveal. ────────────────────────────
  // Per the rules: "If the evil Scheme is completed, evil wins immediately.
  // Don't finish the turn." Evil wins takes priority over a tie but NEVER
  // over a pending win (guarded above).
  if (state.result) return state; // set inside revealOneVillainCard if needed

  const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
  if (scheme && scheme.evilWinsAfterTwists !== undefined
      && state.schemeTwistsRevealed >= scheme.evilWinsAfterTwists) {
    state.result       = 'loss';
    state.resultReason = `${scheme.name} succeeded — the heroes have lost.`;
    state.phase        = 'finished';
    pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
    return state;
  }

  // ── Tie: both decks-empty check and "last turn" expiry. ──────────────────
  // Per the rules: "If you have not won or lost by the end of this turn,
  // the game ends in a tie. The player with the most Victory Points wins
  // an individual victory."
  if (state.lastTurnTie) {
    state.result       = 'tie';
    state.resultReason = 'The decks ran dry — heroes survived but couldn\'t defeat the Mastermind. Highest VP wins!';
    state.phase        = 'finished';
    pushLog(state, { kind: 'game_ended', result: 'tie', reasonText: state.resultReason });
    return state;
  }

  // ── Extra turn (Secrets of Time Travel): skip advancing the player index. ──
  // The same player keeps going. Their hand was just drawn above (step 3),
  // so we don't draw again — they continue with the freshly drawn 6 cards.
  if (state.thisTurn.extraTurn && !state.result) {
    const samePlayer = state.players[state.currentPlayerIdx];
    state.turn++;
    state.thisTurn = emptyTurnState();
    resolvePendingStrikes(state, samePlayer);
    pushLog(state, { kind: 'system', text: `${samePlayer.username} takes an extra turn!` });
    pushLog(state, { kind: 'turn_started', seat: samePlayer.seat, username: samePlayer.username });
    return state;
  }

  // 5. Advance to next player, reset turn state. NO draw here — every player's
  //    hand is dealt at end of their previous turn (or at game start for their
  //    first turn), so the next player already has 6 cards waiting.
  // Solo twist tuck: the pendingChoice was set inside revealOneVillainCard, which
  // runs BEFORE this emptyTurnState() call. Preserve it so the solo player is
  // prompted at the start of their next turn rather than having it silently wiped.
  const carryoverTwistTuck = state.thisTurn.pendingChoice?.kind === 'solo_twist_tuck_hero'
    ? state.thisTurn.pendingChoice
    : undefined;
  state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
  state.turn++;
  state.thisTurn = emptyTurnState();
  if (carryoverTwistTuck) state.thisTurn.pendingChoice = carryoverTwistTuck;
  const nextPlayer = state.players[state.currentPlayerIdx];
  resolvePendingStrikes(state, nextPlayer);

  pushLog(state, { kind: 'turn_started', seat: nextPlayer.seat, username: nextPlayer.username });
  return state;
}

/**
 * Reveal a card from the Villain Deck and route it to the right place:
 *   • villain/henchman → enters City, pushes existing villains forward
 *   • master_strike    → mastermind attacks every player (resolves strike)
 *   • scheme_twist     → bumps scheme counter + runs scheme's onTwist
 *   • bystander        → joins pendingBystanders (next villain scoops them)
 *
 * Returns the revealed card instance for the caller to log if desired.
 */
function revealOneVillainCard(state: LegendaryState): CardInstance | null {
  const card = state.villainDeck.shift();
  if (!card) {
    // Per the rules: "If either the Hero Deck or the Villain Deck ever reaches
    // zero cards, you can finish the current turn as your final chance to win.
    // If you have not won or lost by the end of this turn, the game ends in a
    // tie." Exception: if the SCHEME says evil wins when the villain deck runs
    // out, it's an immediate loss — but none of our current schemes do that.
    if (!state.lastTurnTie) {
      state.lastTurnTie = true;
      pushLog(state, {
        kind: 'system',
        text: 'The Villain Deck has run out — this is the heroes\' final turn!',
      });
    }
    return null;
  }
  const def = getCard(card.cardId);

  switch (def.kind) {
    case 'master_strike': {
      const mmDef = getCard(state.mastermind.cardId);
      if (mmDef.kind === 'mastermind') {
        pushLog(state, { kind: 'master_strike', effectText: mmDef.text ?? mmDef.name });
        // Master Strike fires the Mastermind's specific strike effect on
        // EVERY player simultaneously.
        for (const p of state.players) {
          for (const eff of mmDef.strike) resolveEffect(state, p, eff);
        }
      }
      // Master Strikes do NOT push city villains forward — only an actual
      // villain or henchman card entering the city causes the city to push.
      // KO the card (it never sits in the city).
      state.ko.push(card);
      return card;
    }
    case 'scheme_twist': {
      state.schemeTwistsRevealed++;
      const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
      pushLog(state, {
        kind: 'scheme_twist',
        twistsRevealed: state.schemeTwistsRevealed,
        twistsTotal: scheme?.twists ?? state.schemeTwistsRevealed,
      });
      // Fire the scheme's per-twist effect (if any).
      if (scheme?.onTwist) {
        for (const eff of scheme.onTwist) {
          for (const p of state.players) resolveEffect(state, p, eff);
        }
      }
      // Immediately check if this twist triggers the evil-wins condition
      // (e.g. Cosmic Cube Twist 8: Evil Wins!). Mirrors the Mystique check.
      if (scheme && scheme.evilWinsAfterTwists !== undefined
          && state.schemeTwistsRevealed >= scheme.evilWinsAfterTwists
          && !state.result && !state.pendingResult) {
        state.result = 'loss';
        state.resultReason = `${scheme.name} succeeded — the heroes have lost.`;
        state.phase = 'finished';
        pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
      }
      // Scheme Twists go to the KO pile (they do not enter the city and do
      // NOT push any existing city villains forward — only villain/henchman
      // cards entering the city cause the push).
      state.ko.push(card);
      // Some schemes (e.g. Negative Zone Prison Breakout) trigger additional
      // villain-deck reveals on each twist. Each extra reveal follows the same
      // routing rules — only villain/henchman cards push the city.
      const extraReveals = scheme?.onTwistRevealCount ?? 0;
      for (let i = 0; i < extraReveals && !state.result; i++) {
        pushLog(state, { kind: 'system', text: `Scheme Twist: revealing extra card ${i + 1} of ${extraReveals} from the Villain Deck...` });
        revealOneVillainCard(state);
      }
      // Solo extra twist effect: tuck one HQ Hero (cost ≤ 6) to the bottom of the
      // Hero Deck. Only queued once per twist chain (soloTwistTuckPending guards it).
      if (state.players.length === 1 && !state.thisTurn.soloTwistTuckPending && !state.result) {
        const hasEligible = state.hq.some(c => {
          if (!c) return false;
          const d = getCard(c.cardId);
          return d.kind === 'hero' && (d as { cost: number }).cost <= 6;
        });
        if (hasEligible) {
          state.thisTurn.soloTwistTuckPending = true;
          state.thisTurn.pendingChoice = { kind: 'solo_twist_tuck_hero' };
        }
      }
      return card;
    }
    case 'bystander': {
      // Attach immediately to the villain CLOSEST to the Villain Deck (slot 0 =
      // Sewers / entry edge), per the rules. If the city is empty, the
      // Mastermind captures the bystander instead.
      // Slot 0 is always the newest (just entered) and sits at the deck-entry
      // edge; scan 0 → CITY_SIZE−1 for the first occupied slot.
      let capturedByVillain = false;
      for (let s = 0; s < state.city.length; s++) {
        const cityCard = state.city[s];
        if (cityCard) {
          state.cityBystanders[cityCard.instanceId] = [
            ...(state.cityBystanders[cityCard.instanceId] ?? []),
            card,
          ];
          const capDef = getCard(cityCard.cardId);
          const captorName = capDef.kind === 'villain' || capDef.kind === 'henchman'
            ? capDef.name : cityCard.cardId;
          pushLog(state, { kind: 'bystander_captured', capturedBy: 'villain', captorName });
          capturedByVillain = true;
          break;
        }
      }
      if (!capturedByVillain) {
        state.mastermind.bystanders.push(card);
        const mmDef = getCard(state.mastermind.cardId);
        const mmName = mmDef.kind === 'mastermind' ? mmDef.name : 'the Mastermind';
        pushLog(state, { kind: 'bystander_captured', capturedBy: 'mastermind', captorName: mmName });
      }
      return card;
    }
    case 'villain':
    case 'henchman': {
      enterCity(state, card, def);
      return card;
    }
    default:
      // wound/hero/mastermind/scheme defs should never live in the villain
      // deck — defensive fallthrough.
      state.ko.push(card);
      return card;
  }
}

/** Push villains forward in the City and slot a new arrival into position 0.
 *  If a villain is pushed off the right edge, it escapes. Per the rules:
 *
 *  1. KO the highest-cost (≤ 6) hero from the HQ; refill immediately.
 *  2. If the escaping villain had captured bystanders, each player discards
 *     one card from their hand. Bystanders stay in the Escape Pile (lost).
 *  3. Fire any "Escape" effect printed on the villain card.
 *
 *  We auto-pick the KO target (highest cost ≤ 6) since player-choice prompts
 *  are a future pass. */
function enterCity(state: LegendaryState, card: CardInstance, def: CardDef): void {
  // Domino-push rule: a new villain entering at the Sewers (slot 0) only
  // pushes the contiguous leading block of villains toward the Bridge.
  // Any villain that has a gap (empty slot) between itself and slot 0 stays
  // in place — it only moves when something physically fills that gap later.
  //
  // Example: city = [HN, HN, _, HN, _]
  //   firstEmpty = 2 → only slots 0–1 shift → [new, HN, HN, HN, _]
  //   The isolated HN at slot 3 is unaffected.
  //
  // When the city is completely full (firstEmpty === -1) the Bridge villain
  // is pushed off and escapes as normal.
  const firstEmpty = state.city.findIndex(c => !c);

  if (firstEmpty === -1) {
    // ── City fully occupied: Bridge villain escapes ───────────────────────
    const lastIdx = state.city.length - 1;
    const escaped = state.city[lastIdx];
    if (escaped) {
      const eDef = getCard(escaped.cardId);
      if (eDef.kind === 'villain' || eDef.kind === 'henchman') {
        pushLog(state, { kind: 'villain_escaped', cardId: eDef.cardId, cardName: eDef.name });

        // ── Step 1: KO a hero from HQ (highest cost ≤ 6) ─────────────────
        let koSlot = -1;
        let koMaxCost = -1;
        for (let i = 0; i < state.hq.length; i++) {
          const hqCard = state.hq[i];
          if (!hqCard) continue;
          const hqDef = getCard(hqCard.cardId);
          if (hqDef.kind !== 'hero') continue;
          if (hqDef.cost <= 6 && hqDef.cost > koMaxCost) {
            koMaxCost = hqDef.cost;
            koSlot = i;
          }
        }
        if (koSlot >= 0) {
          const koCard = state.hq[koSlot]!;
          state.hq[koSlot] = null;
          state.ko.push(koCard);
          const koHeroDef = getCard(koCard.cardId);
          const heroName = koHeroDef.kind === 'hero' ? koHeroDef.cardName : koCard.cardId;
          pushLog(state, { kind: 'system', text: `Escape: ${eDef.name} KO'd ${heroName} from the HQ.` });
          refillHQ(state, true);
        }

        // ── Step 2: Bystander penalty ──────────────────────────────────────
        // Bystanders stay in the Escape Pile (attached to the escaped villain).
        // Each player that has cards in hand must discard one.
        const bys = state.cityBystanders[escaped.instanceId] ?? [];
        if (bys.length > 0) {
          const byCount = bys.length;
          delete state.cityBystanders[escaped.instanceId];
          for (const p of state.players) {
            if (p.hand.length > 0) {
              const discarded = p.hand.splice(0, 1)[0];
              p.discard.push(discarded);
              pushLog(state, {
                kind: 'system',
                text: `${p.username} discarded a card — ${eDef.name} escaped with ${byCount} bystander${byCount === 1 ? '' : 's'}.`,
              });
            }
          }
        } else {
          delete state.cityBystanders[escaped.instanceId];
        }

        // ── Step 3: Villain's own Escape effect ───────────────────────────
        if (eDef.kind === 'villain' && eDef.escape) {
          for (const eff of eDef.escape) {
            // trigger_scheme_twist must fire exactly once (not once per player).
            if (eff.kind === 'trigger_scheme_twist') {
              resolveEffect(state, state.players[state.currentPlayerIdx], eff);
            } else {
              for (const p of state.players) resolveEffect(state, p, eff);
            }
          }
        }

        state.escapedPile.push(escaped);

        // ── Check escape-count loss condition immediately (e.g. Prison Breakout). ──
        if (!state.result) {
          const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
          if (scheme?.evilWinsAfterEscapes !== undefined
              && state.escapedPile.length >= scheme.evilWinsAfterEscapes) {
            const n = state.escapedPile.length;
            state.result       = 'loss';
            state.resultReason = `${n} villain${n === 1 ? '' : 's'} escaped — ${scheme.name} succeeded.`;
            state.phase        = 'finished';
            pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
          }
        }
      }
    }
    // Full shift — city was fully occupied so every slot advances one step.
    // cityBystanders is keyed by instanceId so bystanders travel with their
    // villain automatically (no separate move needed).
    for (let i = state.city.length - 1; i > 0; i--) {
      state.city[i] = state.city[i - 1];
    }
  } else {
    // ── Gap exists: push only the leading block (slots 0 → firstEmpty−1) ──
    // Villains beyond the first empty slot are unaffected — they stay put.
    for (let i = firstEmpty; i > 0; i--) {
      state.city[i] = state.city[i - 1];
    }
  }

  state.city[0] = card;

  // Log the reveal first, THEN fire Ambush. Per the rules:
  //   • The villain must be fully in the city (slot 0) before Ambush fires.
  //   • Escape effects for any pushed-out villain have already fired above.
  if (def.kind === 'villain' || def.kind === 'henchman') {
    pushLog(state, { kind: 'villain_revealed', cardId: def.cardId, cardName: def.name });
    if (def.kind === 'villain' && def.ambush) {
      for (const eff of def.ambush) {
        for (const p of state.players) resolveEffect(state, p, eff);
      }
    }
  }
}

// =====================================================================
// State projection — same idea as Spellduel; hides per-player decks/hands
// from anyone who isn't that player. Public zones (HQ, City, log, VP
// piles, the mastermind area) are unchanged.
// =====================================================================

const HIDDEN_CARD: CardInstance = { instanceId: '__hidden__', cardId: '__hidden__' };

export function projectStateForViewer(state: LegendaryState, viewerId: string | null): LegendaryState {
  const next = clone(state);
  for (const p of next.players) {
    const isMe = viewerId === p.playerId;
    // Decks always hidden (private from everyone, even owner).
    p.deck = p.deck.map(() => clone(HIDDEN_CARD));
    if (!isMe) {
      // Hand hidden from non-owners; discard piles are face-up so leave them.
      p.hand = p.hand.map(() => clone(HIDDEN_CARD));
    }
  }
  // Villain deck is always opaque (count visible via .length on client).
  next.villainDeck = next.villainDeck.map(() => clone(HIDDEN_CARD));
  next.heroDeck    = next.heroDeck.map(() => clone(HIDDEN_CARD));
  next.woundDeck   = next.woundDeck.map(() => clone(HIDDEN_CARD));
  // Tactics pile is face-down — players see the count but not which card
  // would come next (preserves the "random" feel of the draw).
  next.mastermind.tactics = next.mastermind.tactics.map(() => clone(HIDDEN_CARD));
  return next;
}

// =====================================================================
// Integration with the GameDef registry
// =====================================================================

export function getActivePlayerId(state: LegendaryState): string | null {
  if (state.phase !== 'playing' || state.result) return null;
  return state.players[state.currentPlayerIdx]?.playerId ?? null;
}

export function getOrderedPlayerIds(state: LegendaryState): string[] {
  return [...state.players].sort((a, b) => a.seat - b.seat).map(p => p.playerId);
}

export function computeHistory(state: LegendaryState) {
  if (state.phase !== 'finished' || !state.result) return null;
  const ordered = [...state.players].sort((a, b) => b.vp - a.vp);
  // Cooperative game: a "win" is everyone's win (winnerId = whoever has the
  // highest VP / MVP for that match, or null for a tie at the top).
  const tieAtTop = ordered.length > 1 && ordered[0].vp === ordered[1].vp;
  // On 'loss': no winner. On 'win': cooperative win — highest VP is MVP.
  // On 'tie': game tied but individual highest VP wins (per the rules).
  const winnerId =
    state.result === 'loss' ? null
    : tieAtTop              ? null
    : ordered[0]?.playerId ?? null;
  return { winnerId, playerIds: ordered.map(p => p.playerId) };
}
