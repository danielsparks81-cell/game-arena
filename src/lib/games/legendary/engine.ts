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
  TROOPERS_AVAILABLE_TOTAL,
  AGENTS_AVAILABLE_TOTAL,
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
    mastermind: { cardId: MASTERMINDS[0].cardId, hitsTaken: 0, tactics: [], bystanders: [] },
    players: [],
    currentPlayerIdx: 0,
    turn: 0,
    thisTurn: emptyTurnState(),
    schemeTwistsRevealed: 0,
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

  // ----- Seed villain groups based on Mastermind's Always Leads + scheme -----
  next.villainGroupIds   = [mastermind.alwaysLeads];
  next.henchmanGroupIds  = [HENCHMAN_GROUPS[0].groupId];

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
  for (const gid of next.henchmanGroupIds) {
    const grp = HENCHMAN_GROUPS.find(g => g.groupId === gid);
    if (!grp) continue;
    for (const { def, copies } of grp.cards) {
      for (let i = 0; i < copies; i++) villainDeck.push(mkInstance(def.cardId));
    }
  }
  for (let i = 0; i < MASTER_STRIKES_IN_DECK; i++) villainDeck.push(mkInstance('master_strike'));
  for (let i = 0; i < scheme.twists; i++)         villainDeck.push(mkInstance('scheme_twist'));
  for (let i = 0; i < scheme.bystanders; i++)     villainDeck.push(mkInstance('bystander'));
  next.villainDeck = shuffle(villainDeck);

  // ----- Bystander stack (rescues drawn from here; refilled by rescuing) -----
  next.bystanderDeck = []; // For MVP we just use the bystanders mixed into the Villain Deck.

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

  // ----- Per-player starting deck: 8 Troopers + 4 Agents, shuffled, then
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
  drawUpTo(next.players[0], STARTING_HAND_SIZE);

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
  /** Clean up turn (discard hand + played) and pass turn. */
  | { kind: 'end_turn' };

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
      action.kind !== 'resolve_choice' && action.kind !== 'skip_choice') {
    return { error: 'Resolve your pending choice first — select a card or click Skip.' };
  }

  switch (action.kind) {
    case 'play_card':         return doPlayCard(next, meNext, action.instanceId);
    case 'recruit_hero':      return doRecruit(next, meNext, action.slot);
    case 'recruit_sidekick':  return doRecruitPool(next, meNext, 'sidekick');
    case 'recruit_officer':   return doRecruitPool(next, meNext, 'shield_officer');
    case 'fight_city':        return doFightCity(next, meNext, action.slot);
    case 'fight_mastermind':  return doFightMastermind(next, meNext);
    case 'resolve_choice':    return doResolveChoice(next, meNext, action.instanceId);
    case 'skip_choice':       return doSkipChoice(next);
    case 'end_turn':          return doEndTurn(next);
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
      if (drew > 0) pushLog(state, { kind: 'system', text: `${me.username} drew ${drew} card${drew === 1 ? '' : 's'}.` });
      return;
    }
    case 'gain_wound': {
      const w = state.woundDeck.shift();
      if (w) {
        me.discard.push(w);
        pushLog(state, { kind: 'wound_taken', seat: me.seat, username: me.username });
      }
      return;
    }
    case 'rescue_bystander': {
      // Rescue from the bystander stack if any; for MVP this is mostly a
      // no-op since bystanders are mixed in the villain deck.
      let n = 0;
      for (let i = 0; i < effect.amount; i++) {
        const b = state.bystanderDeck.shift();
        if (!b) break;
        me.victoryPile.push(b); n++;
      }
      if (n > 0) {
        pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: n });
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

    // ── Player-choice effects (KO / discard from hand) ─────────────────────
    // These set a pendingChoice so the board can prompt the player to pick a
    // card. Subsequent actions are blocked until resolved or skipped.
    case 'ko_from_hand': {
      const hasValid = effect.filter === 'wounds_only'
        ? me.hand.some(c => c.cardId === 'wound')
        : me.hand.length > 0;
      if (!hasValid) return; // no eligible cards — silently skip
      const choice: PendingChoice = {
        kind: 'ko_from_hand',
        bonus: effect.bonus ?? [],
        filter: effect.filter,
      };
      state.thisTurn.pendingChoice = choice;
      return;
    }
    case 'discard_from_hand': {
      if (me.hand.length === 0) return; // nothing to discard
      const choice: PendingChoice = {
        kind: 'discard_from_hand',
        bonus: effect.bonus ?? [],
      };
      state.thisTurn.pendingChoice = choice;
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
  if (slot < 0 || slot >= state.hq.length) return { error: 'No such HQ slot' };
  const card = state.hq[slot];
  if (!card) return { error: 'HQ slot is empty' };
  const def = getCard(card.cardId);
  if (def.kind !== 'hero') return { error: 'Card in HQ is not a hero' };
  if (state.thisTurn.recruit < def.cost) {
    return { error: `Need ${def.cost} Recruit, have ${state.thisTurn.recruit}` };
  }
  state.thisTurn.recruit -= def.cost;
  state.hq[slot] = null;
  me.discard.push(card);
  pushLog(state, {
    kind: 'hero_recruited', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.cardName, cost: def.cost,
  });
  refillHQ(state, true);
  return state;
}

// ---------------- Recruit from always-available pool ----------------
/** Sidekick (cardId 'sidekick') and S.H.I.E.L.D. Officer ('shield_officer')
 *  sit in unlimited pools beside the board — any player can buy one per turn
 *  for the printed cost. We create a fresh CardInstance rather than pulling
 *  from a pre-seeded stack (the pool is treated as infinite for MVP). */
function doRecruitPool(
  state: LegendaryState,
  me: PlayerState,
  cardId: CardId,
): LegendaryState | { error: string } {
  const def = getCard(cardId);
  if (def.kind !== 'hero') return { error: 'Pool card is not a hero' };
  // Rules: Sidekicks are limited to once per turn (§ "Sidekick Deck").
  // S.H.I.E.L.D. Officers have no such limit.
  if (cardId === 'sidekick' && state.thisTurn.sidekickRecruited) {
    return { error: 'You can only recruit one Sidekick per turn' };
  }
  if (state.thisTurn.recruit < def.cost) {
    return { error: `Need ${def.cost} Recruit, have ${state.thisTurn.recruit}` };
  }
  state.thisTurn.recruit -= def.cost;
  const instance = mkInstance(cardId);
  me.discard.push(instance);
  if (cardId === 'sidekick') state.thisTurn.sidekickRecruited = true;
  pushLog(state, {
    kind: 'hero_recruited', seat: me.seat, username: me.username,
    cardId: def.cardId, cardName: def.cardName, cost: def.cost,
  });
  return state;
}

// ---------------- Fight a villain in the city ----------------

function doFightCity(
  state: LegendaryState,
  me: PlayerState,
  slot: number,
): LegendaryState | { error: string } {
  if (slot < 0 || slot >= state.city.length) return { error: 'No such City slot' };
  const card = state.city[slot];
  if (!card) return { error: 'City slot is empty' };
  const def = getCard(card.cardId);
  if (def.kind !== 'villain' && def.kind !== 'henchman') {
    return { error: 'Card in City is not fightable' };
  }
  if (state.thisTurn.attack < def.attack) {
    return { error: `Need ${def.attack} Attack, have ${state.thisTurn.attack}` };
  }
  state.thisTurn.attack -= def.attack;
  state.city[slot] = null;
  me.victoryPile.push(card);

  // Rescue any bystanders attached to this villain.
  const attached = state.cityBystanders[card.instanceId] ?? [];
  if (attached.length > 0) {
    for (const b of attached) me.victoryPile.push(b);
    delete state.cityBystanders[card.instanceId];
    pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: attached.length });
  }

  // Fight effect on the villain (if any)
  if (def.kind === 'villain' && def.fight) {
    for (const e of def.fight) resolveEffect(state, me, e);
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

  const idx = me.hand.findIndex(c => c.instanceId === instanceId);
  if (idx < 0) return { error: 'Card not in your hand' };

  const card = me.hand[idx];

  // Validate filter
  if (choice.filter === 'wounds_only' && card.cardId !== 'wound') {
    return { error: 'You must choose a Wound card for this effect' };
  }

  // Remove from hand
  me.hand.splice(idx, 1);

  // Determine card's display name for the log
  const cDef = getCard(card.cardId);
  const cardLabel =
    cDef.kind === 'hero'      ? cDef.cardName :
    'name' in cDef            ? (cDef as { name: string }).name :
    card.cardId;

  // KO or discard the chosen card
  if (choice.kind === 'ko_from_hand') {
    state.ko.push(card);
    pushLog(state, { kind: 'system', text: `${me.username} KO'd ${cardLabel} from hand.` });
  } else {
    me.discard.push(card);
    pushLog(state, { kind: 'system', text: `${me.username} discarded ${cardLabel} from hand.` });
  }

  // Clear choice BEFORE resolving bonus (bonus could chain another choice).
  state.thisTurn.pendingChoice = undefined;

  // Resolve the "If you do…" bonus effects.
  for (const eff of choice.bonus) {
    resolveEffect(state, me, eff);
  }

  return state;
}

function doSkipChoice(state: LegendaryState): LegendaryState | { error: string } {
  if (!state.thisTurn.pendingChoice) return { error: 'No pending choice to skip' };
  state.thisTurn.pendingChoice = undefined;
  pushLog(state, { kind: 'system', text: 'Choice skipped.' });
  return state;
}

// ---------------- Fight the Mastermind ----------------

function doFightMastermind(
  state: LegendaryState,
  me: PlayerState,
): LegendaryState | { error: string } {
  const mmDef = getCard(state.mastermind.cardId);
  if (mmDef.kind !== 'mastermind') return { error: 'Mastermind misconfigured' };
  if (state.thisTurn.attack < mmDef.attack) {
    return { error: `Need ${mmDef.attack} Attack to hit ${mmDef.name}` };
  }
  if (state.mastermind.tactics.length === 0) {
    return { error: 'Mastermind is already defeated' };
  }

  state.thisTurn.attack -= mmDef.attack;
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

  pushLog(state, {
    kind: 'mastermind_hit',
    seat: me.seat,
    username: me.username,
    tacticName: tacticDef.name,
    tacticVp: tacticDef.vp,
    tacticsRemaining: state.mastermind.tactics.length,
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

function recomputeVp(p: PlayerState): void {
  let vp = 0;
  for (const c of p.victoryPile) {
    const d = getCard(c.cardId);
    if (d.kind === 'villain')    vp += d.vp;
    if (d.kind === 'henchman')   vp += d.vp;
    if (d.kind === 'mastermind') vp += d.vp;
    if (d.kind === 'tactic')     vp += d.vp; // Mastermind Tactics carry the MM's VP
    if (d.kind === 'bystander')  vp += d.vp;
  }
  p.vp = vp;
}

// ---------------- End turn ----------------

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

  // 3. Reveal one card from the Villain Deck (villain/henchman → city;
  //    master_strike / scheme_twist / bystander → resolve without city push).
  revealOneVillainCard(state);

  // ── Evil wins: check immediately after reveal. ────────────────────────────
  // Per the rules: "If the evil Scheme is completed, evil wins immediately.
  // Don't finish the turn." Evil wins takes priority over a tie but NEVER
  // over a pending win (guarded above).
  if (state.result) return state; // set inside revealOneVillainCard if needed

  const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
  if (scheme && state.schemeTwistsRevealed >= scheme.evilWinsAfterTwists) {
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

  // 4. Advance to next player, reset turn state, deal 6.
  state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
  state.turn++;
  state.thisTurn = emptyTurnState();
  const nextPlayer = state.players[state.currentPlayerIdx];
  drawUpTo(nextPlayer, STARTING_HAND_SIZE);
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
      // Scheme Twists go to the KO pile (they do not enter the city and do
      // NOT push any existing city villains forward — only villain/henchman
      // cards entering the city cause the push).
      state.ko.push(card);
      // Some schemes (e.g. Negative Zone Prison Breakout) trigger an
      // additional villain-deck reveal on each twist. Recurse once; the
      // extra card follows the same routing rules — only a villain or
      // henchman will push the city, all other types resolve without pushing.
      if (scheme?.onTwistReveal && !state.result) {
        pushLog(state, { kind: 'system', text: 'Scheme Twist: revealing an extra card from the Villain Deck...' });
        revealOneVillainCard(state);
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
  // Push the rightmost slot off first.
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
          for (const p of state.players) resolveEffect(state, p, eff);
        }
      }

      state.escapedPile.push(escaped);
    }
  }
  // Shift right — all existing villains move one slot toward Bridge.
  // cityBystanders is keyed by instanceId so bystanders travel with their
  // villain automatically (no separate move needed).
  for (let i = state.city.length - 1; i > 0; i--) {
    state.city[i] = state.city[i - 1];
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
