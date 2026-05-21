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
    mastermind: { cardId: MASTERMINDS[0].cardId, hitsTaken: 0, bystanders: [] },
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

  // ----- Mastermind -----
  next.mastermind = { cardId: mastermind.cardId, hitsTaken: 0, bystanders: [] };

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
 *  Hero Deck is empty, slots stay null (Legendary rule: HQ may run dry). */
function refillHQ(state: LegendaryState): void {
  for (let i = 0; i < state.hq.length; i++) {
    if (state.hq[i]) continue;
    const next = state.heroDeck.shift();
    state.hq[i] = next ?? null;
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

  switch (action.kind) {
    case 'play_card':         return doPlayCard(next, meNext, action.instanceId);
    case 'recruit_hero':      return doRecruit(next, meNext, action.slot);
    case 'recruit_sidekick':  return doRecruitPool(next, meNext, 'sidekick');
    case 'recruit_officer':   return doRecruitPool(next, meNext, 'shield_officer');
    case 'fight_city':        return doFightCity(next, meNext, action.slot);
    case 'fight_mastermind':  return doFightMastermind(next, meNext);
    case 'end_turn':          return doEndTurn(next);
  }
}

// ---------------- Play card ----------------

function doPlayCard(
  state: LegendaryState,
  me: PlayerState,
  instanceId: CardInstanceId,
): LegendaryState | { error: string } {
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
      pushLog(state, { kind: 'system', text: `${me.username} drew ${drew} card${drew === 1 ? '' : 's'}.` });
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
    case 'if_played_class_this_turn': {
      // -1 because the card playing this effect was already counted before
      // its on-play triggers fired. "Another Hulk" means besides me.
      const count = (state.thisTurn.classPlayedCounts[effect.cls] ?? 0) - 1;
      if (count >= effect.minOthers) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }
    case 'if_played_team_this_turn': {
      const count = (state.thisTurn.teamPlayedCounts[effect.team] ?? 0) - 1;
      if (count >= effect.minOthers) {
        for (const e of effect.effects) resolveEffect(state, me, e);
      }
      return;
    }
    case 'ko_from_hand':
    case 'discard_from_hand':
      // These require a player choice (which card to KO/discard) — that's a
      // multi-step interaction. For MVP we make them no-ops; we'll wire a
      // separate "pending choice" mechanic in a future pass.
      return;
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
  refillHQ(state);
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
  if (state.thisTurn.recruit < def.cost) {
    return { error: `Need ${def.cost} Recruit, have ${state.thisTurn.recruit}` };
  }
  state.thisTurn.recruit -= def.cost;
  const instance = mkInstance(cardId);
  me.discard.push(instance);
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
  state.thisTurn.attack -= mmDef.attack;
  state.mastermind.hitsTaken++;
  pushLog(state, {
    kind: 'mastermind_hit', seat: me.seat, username: me.username,
    hitsRemaining: Math.max(0, mmDef.hits - state.mastermind.hitsTaken),
  });
  if (state.mastermind.hitsTaken >= mmDef.hits) {
    // Defeated! Award the Mastermind to this player's victory pile + any
    // bystanders it captured along the way.
    me.victoryPile.push(mkInstance(mmDef.cardId));
    for (const b of state.mastermind.bystanders) me.victoryPile.push(b);
    state.mastermind.bystanders = [];
    state.result = 'win';
    state.resultReason = `${mmDef.name} has been defeated!`;
    state.phase = 'finished';
    pushLog(state, { kind: 'game_ended', result: 'win', reasonText: state.resultReason });
    recomputeVp(me);
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
    if (d.kind === 'bystander')  vp += d.vp;
  }
  p.vp = vp;
}

// ---------------- End turn ----------------

function doEndTurn(state: LegendaryState): LegendaryState | { error: string } {
  const me = state.players[state.currentPlayerIdx];

  // 1. All played cards + remaining hand → discard
  for (const c of state.thisTurn.playedThisTurn) me.discard.push(c);
  for (const c of me.hand) me.discard.push(c);
  me.hand = [];

  // 2. Refresh HQ in case the player bought from it
  refillHQ(state);

  // 3. Reveal one card from the Villain Deck → enters City row, pushing
  //    existing villains forward. The rightmost villain (city[CITY_SIZE-1])
  //    escapes if pushed off.
  const revealed = revealOneVillainCard(state);
  if (state.result) return state; // game ended during reveal (e.g. scheme evil wins)

  // 4. If the scheme's evil-wins threshold has been crossed, end the game.
  const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
  if (scheme && state.schemeTwistsRevealed >= scheme.evilWinsAfterTwists) {
    state.result = 'loss';
    state.resultReason = `${scheme.name} succeeded — the heroes have lost.`;
    state.phase = 'finished';
    pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
    return state;
  }

  // 5. Advance to next player, reset turn state, deal 6
  state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
  state.turn++;
  state.thisTurn = emptyTurnState();
  const nextPlayer = state.players[state.currentPlayerIdx];
  drawUpTo(nextPlayer, STARTING_HAND_SIZE);

  pushLog(state, {
    kind: 'turn_started', seat: nextPlayer.seat, username: nextPlayer.username,
  });
  void revealed;
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
    // Empty villain deck triggers "Evil Wins" in real Legendary; collapse to
    // a loss for the heroes.
    state.result = 'loss';
    state.resultReason = 'The Villain Deck ran out — Evil Wins.';
    state.phase = 'finished';
    pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
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
        refillHQ(state);
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
  const winnerId =
    state.result === 'loss' ? null
    : tieAtTop              ? null
    : ordered[0]?.playerId ?? null;
  return { winnerId, playerIds: ordered.map(p => p.playerId) };
}
