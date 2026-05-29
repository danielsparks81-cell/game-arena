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
  SHIELD_TEAMS,
  CITY_LOCATION_INDEX,
  CITY_LOCATIONS,
  effectiveCityStrike,
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
    skrullHeroes: [],
    cityBystanders: {},
    cityAttachedHeroes: {},
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

/** Official setup table — Villain Groups by player count.
 *  Solo (1 player) uses exactly 1 Villain Group. */
function villainGroupsForPlayers(n: number): number {
  if (n <= 1) return 1; // solo
  if (n >= 5) return 5;
  return n; // 2→2, 3→3, 4→4
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
  | { kind: 'randomize_heroes' }
  | { kind: 'set_villain_groups';  groupIds: string[] }
  | { kind: 'set_henchman_groups'; groupIds: string[] }
  | { kind: 'randomize_villains' }
  | { kind: 'randomize_henchmen' };

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
    case 'set_villain_groups': {
      const valid = action.groupIds.filter(id => VILLAIN_GROUPS.some(g => g.groupId === id));
      next.villainGroupIds = valid;
      return next;
    }
    case 'set_henchman_groups': {
      const valid = action.groupIds.filter(id => HENCHMAN_GROUPS.some(g => g.groupId === id));
      next.henchmanGroupIds = valid;
      return next;
    }
    case 'randomize_villains': {
      // Pick a random set sized to the player-count target. The mastermind's
      // alwaysLeads group is always included so the seed villain still gets
      // its scripted intro.
      const target = villainGroupCountForPlayers(next.players.length);
      const mm = MASTERMINDS.find(m => m.cardId === next.mastermindId);
      const leads = mm && VILLAIN_GROUPS.find(g => g.team === mm.alwaysLeads);
      const seed = leads ? [leads.groupId] : [];
      const pool = shuffle(VILLAIN_GROUPS.filter(g => !seed.includes(g.groupId)));
      const extras = pool.slice(0, Math.max(0, target - seed.length)).map(g => g.groupId);
      next.villainGroupIds = [...seed, ...extras];
      return next;
    }
    case 'randomize_henchmen': {
      const target = henchmanGroupCountForPlayers(next.players.length);
      const mm = MASTERMINDS.find(m => m.cardId === next.mastermindId);
      const leads = mm && HENCHMAN_GROUPS.find(g => g.team === mm.alwaysLeads);
      const seed = leads ? [leads.groupId] : [];
      const pool = shuffle(HENCHMAN_GROUPS.filter(g => !seed.includes(g.groupId)));
      const extras = pool.slice(0, Math.max(0, target - seed.length)).map(g => g.groupId);
      next.henchmanGroupIds = [...seed, ...extras];
      return next;
    }
  }
}

/** Target villain-group count by player count — same source of truth as the
 *  game setup so the lobby randomizer picks the exact number the game uses
 *  (solo = 1). */
function villainGroupCountForPlayers(n: number): number {
  return villainGroupsForPlayers(n);
}

/** Target henchman-group count by player count. Solo gets 2 (one extra). */
function henchmanGroupCountForPlayers(n: number): number {
  if (n === 1) return 2;
  if (n >= 5) return 2;
  return 1; // 2-4 players
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
  // Scheme may override the hero-class count by player count (Super Hero
  // Civil War: "if only 2 players, use only 4 Heroes").
  const neededHeroClasses =
    scheme.heroClassCountForPlayers?.(playerCount) ?? heroClassCountForPlayers(playerCount);

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

  // Respect host picks: if villain/henchman groups were chosen in the lobby
  // (non-empty arrays), use them verbatim and skip the auto-fill below. The
  // alwaysLeads group is folded in only if it wasn't already chosen.
  const villainsPreset  = next.villainGroupIds.length  > 0;
  const henchmenPreset  = next.henchmanGroupIds.length > 0;

  if (villainsPreset) {
    // Make sure alwaysLeads is present (the engine relies on it for setup logs / bystander capture).
    if (leadsVillainGroup && !next.villainGroupIds.includes(leadsVillainGroup.groupId)) {
      next.villainGroupIds.unshift(leadsVillainGroup.groupId);
    }
  } else {
    // Seed with the alwaysLeads group; it counts toward the total for its type.
    next.villainGroupIds  = leadsVillainGroup  ? [leadsVillainGroup.groupId]  : [];
  }
  if (henchmenPreset) {
    if (leadsHenchmanGroup && !next.henchmanGroupIds.includes(leadsHenchmanGroup.groupId)) {
      next.henchmanGroupIds.unshift(leadsHenchmanGroup.groupId);
    }
  } else {
    next.henchmanGroupIds = leadsHenchmanGroup ? [leadsHenchmanGroup.groupId] : [];
  }

  if (playerCount >= 2) {
    // Official table-driven counts (2–5 players).
    // Scheme bonus (e.g. Prison Breakout +1 henchman) is added on top.
    const targetVillains = villainGroupsForPlayers(playerCount);
    const targetHenchmen = henchmanGroupsForPlayers(playerCount) + (scheme.extraHenchmanGroups ?? 0);

    if (!villainsPreset) {
      const availableVillains = shuffle(VILLAIN_GROUPS.filter(g => !next.villainGroupIds.includes(g.groupId)));
      while (next.villainGroupIds.length < targetVillains && availableVillains.length > 0) {
        next.villainGroupIds.push(availableVillains.shift()!.groupId);
      }
    }
    if (!henchmenPreset) {
      const availableHenchmen = shuffle(HENCHMAN_GROUPS.filter(g => !next.henchmanGroupIds.includes(g.groupId)));
      while (next.henchmanGroupIds.length < targetHenchmen && availableHenchmen.length > 0) {
        next.henchmanGroupIds.push(availableHenchmen.shift()!.groupId);
      }
    }
  } else if (!villainsPreset && !henchmenPreset) {
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
  } else {
    // Solo with pre-selected groups: honor them; still need the soloStartingHenchmen flag.
    next.soloStartingHenchmenPlaced = false;
  }

  // ----- Scheme-required Villain Group (Skrull Invasion requires Skrulls) ----
  // If the scheme demands a specific group and it isn't already in the lineup,
  // swap it in for the last auto-picked group so the count stays correct.
  if (scheme.requiresVillainGroup
      && !next.villainGroupIds.includes(scheme.requiresVillainGroup)
      && VILLAIN_GROUPS.some(g => g.groupId === scheme.requiresVillainGroup)) {
    if (next.villainGroupIds.length > 0) next.villainGroupIds[next.villainGroupIds.length - 1] = scheme.requiresVillainGroup;
    else next.villainGroupIds.push(scheme.requiresVillainGroup);
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
  // Effective twist total — scheme may scale it by player count (Super Hero
  // Civil War: 1–3p = 8, 4–5p = 5). Stored on state as the progress-bar
  // denominator.
  const effectiveTwistTotal = scheme.twistsForPlayers?.(playerCount) ?? scheme.twists;
  next.schemeTwistsTotal = effectiveTwistTotal;
  // Twist cards in deck = scheme total minus any that start placed next to
  // the Scheme (Killbots: 5 in deck because 3 start "next to" the scheme).
  const startingTwists = scheme.startingTwistsRevealed ?? 0;
  const twistsInDeck = Math.max(0, effectiveTwistTotal - startingTwists);
  for (let i = 0; i < twistsInDeck; i++)            villainDeck.push(mkInstance('scheme_twist'));
  // Bystanders in villain deck: respect a scheme-level override (e.g. Killbots
  // requires 18 regardless of player count). Otherwise use the official table
  // (2 / 8 / 16) for 2+ players, exactly 1 for solo.
  const villainDeckBystanders = scheme.bystanders ?? (playerCount >= 2
    ? bystandersInVillainDeckForPlayers(playerCount)
    : 1);
  for (let i = 0; i < villainDeckBystanders; i++)  villainDeck.push(mkInstance('bystander'));

  // ----- Skrull Invasion: shuffle N random Heroes out of the Hero Deck and
  //       into the Villain Deck, where they act as Skrull Villains. Their
  //       instanceIds are tagged in state.skrullHeroes so the reveal / fight /
  //       defeat / escape logic treats them specially. -----
  if (scheme.shuffleHeroesIntoVillainDeck && next.heroDeck.length > 0) {
    const n = Math.min(scheme.shuffleHeroesIntoVillainDeck, next.heroDeck.length);
    const pulled = next.heroDeck.splice(0, n); // heroDeck already shuffled
    next.skrullHeroes = pulled.map(c => c.instanceId);
    for (const c of pulled) villainDeck.push(c);
    pushLog(next, { kind: 'system', text:
      `${scheme.name}: ${n} Heroes are shuffled into the Villain Deck as Skrull Villains.` });
  }

  next.villainDeck = shuffle(villainDeck);

  // Seed the twist counter so schemes that start with N twists already placed
  // next to them (e.g. Killbots: 3) show "3/8" on the progress bar at game
  // start, and downstream onTwist effects keyed to "twists N+" count those.
  next.schemeTwistsRevealed = startingTwists;
  if (startingTwists > 0) {
    pushLog(next, { kind: 'system', text: `${scheme.name}: ${startingTwists} Twist${startingTwists === 1 ? '' : 's'} start next to the Scheme.` });
  }

  // ----- Bystander stack (30 bystanders, separate from villain-deck bystanders) -----
  // Per the rules: the Bystander Deck is a finite 30-card pile. When it runs out,
  // rescue effects simply don't produce any cards — the game continues as normal.
  next.bystanderDeck = Array(30).fill(0).map(() => mkInstance('bystander'));

  // ----- Wound deck — a generic stack of wound cards. Real Legendary uses 30.
  //       Schemes can override with `woundsPerPlayer` (e.g. The Legacy Virus's
  //       "Wound stack holds 6 Wounds per player"). Size scales with playerCount. -----
  const woundDeckSize = scheme.woundsPerPlayer !== undefined
    ? scheme.woundsPerPlayer * playerCount
    : 30;
  next.woundDeck = Array(woundDeckSize).fill(0).map(() => mkInstance('wound'));

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

  // Play-cost prerequisite: cards like Optic Blast / Determination read
  // "To play this card, you must discard a card from your hand." Reject the
  // play up-front if the cost can't be paid (no other card in hand to
  // discard). Without this check the mandatory discard silently no-ops and
  // the player gets the on-play benefit for free.
  const mandatoryDiscard = (def.onPlay ?? []).some(e =>
    e.kind === 'discard_from_hand' && e.mandatory === true
  );
  if (mandatoryDiscard && me.hand.length < 2) {
    return { error: `${def.cardName} requires you to discard another card — your hand has no other cards.` };
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
      // Xavier's Nemesis (Magneto Tactic): "For each of your [x-men] Heroes,
      // rescue a Bystander." This is a Mastermind TACTIC, not a played Hero —
      // it never enters teamPlayedCounts — so we count EVERY [x-men] Hero
      // played this turn (no self-subtraction; that -1 only applies to X-Men
      // hero CARDS that count themselves, like Rogue).
      const count = state.thisTurn.teamPlayedCounts['x-men'] ?? 0;
      if (count === 0) {
        pushLog(state, { kind: 'system', text: `${me.username}: no [x-men] Heroes played this turn — Xavier's Nemesis rescues nothing.` });
        return;
      }
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
      const shieldTeams = SHIELD_TEAMS;
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
                // Defer so each player CHOOSES their discard at their next turn.
                if (p.hand.length > 0) {
                  p.pendingHandDiscard = (p.pendingHandDiscard ?? 0) + eff.up_to;
                  pushLog(state, { kind: 'system', text: `${p.username} must discard ${eff.up_to} card${eff.up_to === 1 ? '' : 's'} at the start of their next turn — ${tacticDef.name}.` });
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
        const st = SHIELD_TEAMS;
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
      // Cards without a printed cost (Wounds, Bystanders, Master Strikes,
      // Scheme Twists) count as cost 0 — so Spider-Man's "draw if cost ≤ 2"
      // happily scoops them up.
      const topCost = 'cost' in topDef ? (topDef as { cost: number }).cost : 0;
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
      // Need 3 cards to reveal; if deck is short, reshuffle discard into deck
      // first so the full reveal can happen (matches the Marvel Legendary
      // "shuffle discard into deck whenever you need to draw and can't" rule).
      if (me.deck.length < 3 && me.discard.length > 0) {
        me.deck.push(...shuffle(me.discard));
        me.discard = [];
      }
      const take = Math.min(3, me.deck.length);
      if (take === 0) return;
      // Deck is a queue: index 0 = top. splice(0, take) gives top-first order.
      const revealed = me.deck.splice(0, take);
      const drawn: string[] = [];
      const kept: CardInstance[] = [];
      for (const c of revealed) {
        const d = getCard(c.cardId);
        // Cards without a printed cost (Wounds, Bystanders, Master Strikes,
        // Scheme Twists) count as cost 0 — so Spider-Man draws them.
        const cost = 'cost' in d ? (d as { cost: number }).cost : 0;
        if (cost <= 2) {
          me.hand.push(c);
          state.thisTurn.extraCardsDrawnThisTurn++;
          const nm = d.kind === 'hero' ? d.cardName : 'name' in d ? (d as { name: string }).name : c.cardId;
          drawn.push(nm);
        } else {
          kept.push(c);
        }
      }
      // 0 kept: nothing to put back. 1 kept: only one valid placement, push
      // directly. 2+ kept: card text says "put the rest back in any order" —
      // prompt the player via an order_top_of_deck pending choice. Click order
      // becomes draw order (first click = top of deck = drawn next).
      if (kept.length > 1) {
        state.thisTurn.pendingChoice = { kind: 'order_top_of_deck', queue: kept, placed: [] };
      } else if (kept.length === 1) {
        me.deck.unshift(kept[0]);
      }
      pushLog(state, { kind: 'system', text:
        `${me.username} reveals ${take} card${take === 1 ? '' : 's'} — draws ${drawn.length > 0 ? drawn.join(', ') : 'none'}; returns ${kept.length}${kept.length > 1 ? ' (choose the order)' : ''}.` });
      return;
    }

    // ── Storm-specific effects ────────────────────────────────────────────────
    case 'villain_debuff_at_location': {
      // CITY_LOCATIONS = ['Sewers','Bank','Rooftops','Streets','Bridge'] (indices 0–4).
      const locationMap = CITY_LOCATION_INDEX;
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

    // ── Extra draw bonus (Treasures of Latveria, Doctor Octopus Fight, etc.) ──
    case 'extra_hand_cards': {
      me.endOfTurnExtraDraw = (me.endOfTurnExtraDraw ?? 0) + effect.amount;
      pushLog(state, { kind: 'system', text: `${me.username} will draw ${effect.amount} extra card${effect.amount === 1 ? '' : 's'} on their next hand draw.` });
      return;
    }

    // ── Dr. Doom Master Strike ────────────────────────────────────────────────
    // "Each player with exactly 6 cards in hand reveals a [tech] Hero or puts
    //  2 cards from their hand on top of their deck."
    //  • Active player with an empty hand (end-of-turn villain reveal) → defer
    //    via pendingDoomStrike so it lands on their freshly drawn hand.
    //  • Otherwise resolve now (reveal a [tech] Hero for no penalty, else the
    //    player CHOOSES which 2 cards to put on top — interactive for the
    //    active player, auto-cheapest fallback for non-active players).
    case 'doom_master_strike': {
      const isActive = me.playerId === state.players[state.currentPlayerIdx]?.playerId;
      if (me.hand.length === 0 && isActive) {
        if (!me.pendingDoomStrike) {
          me.pendingDoomStrike = true;
          pushLog(state, {
            kind: 'system',
            text: `${me.username}: Dr. Doom's Master Strike will fire at the start of their next turn.`,
          });
        }
        return;
      }
      resolveDoomStrike(state, me);
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
      // "Each player reveals an X-Men Hero or discards down to four cards."
      // DEFER for EVERY player (not just the active one): set the flag so that
      // resolveMagnetoStrike runs at the start of each player's own next turn,
      // when they ARE the active player and can be prompted to CHOOSE which
      // cards to discard. (Non-active players can't run an interactive prompt
      // mid-someone-else's-turn, and auto-discarding them robbed them of the
      // choice.) The pendingChoice itself would also be wiped by the turn
      // advance, so the flag is the only reliable carrier.
      if (!me.pendingMagnetoStrike) {
        me.pendingMagnetoStrike = true;
        pushLog(state, {
          kind: 'system',
          text: `${me.username}: Magneto's Master Strike will fire at the start of their next turn (reveal an X-Men Hero or discard down to 4).`,
        });
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

    // ── Abomination (Radiation) Fight: location-conditional rescue ────────
    // If defeated on one of the named city slots, the active player rescues
    // `amount` Bystanders from the bystander deck.
    case 'rescue_bystanders_if_at_locations': {
      const locationMap = CITY_LOCATION_INDEX;
      const locationNames: Record<number, string> = {
        0: 'Sewers', 1: 'Bank', 2: 'Rooftops', 3: 'Streets', 4: 'Bridge',
      };
      const targetSlots = effect.locations
        .map(l => locationMap[l.toLowerCase()])
        .filter((s): s is number => s !== undefined);
      const fightSlot = state.thisTurn.lastFightSlot;
      if (fightSlot === undefined || !targetSlots.includes(fightSlot)) {
        const locName = fightSlot !== undefined ? locationNames[fightSlot] : 'unknown';
        const locList = effect.locations.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(' or ');
        pushLog(state, { kind: 'system', text:
          `Fought at the ${locName} — not ${locList}, no bonus rescue.` });
        return;
      }
      const locName = locationNames[fightSlot];
      let rescued = 0;
      for (let i = 0; i < effect.amount; i++) {
        const b = state.bystanderDeck.shift();
        if (!b) break;
        me.victoryPile.push(b);
        rescued++;
      }
      if (rescued > 0) {
        pushLog(state, { kind: 'bystander_rescued', seat: me.seat, username: me.username, count: rescued });
        applyRescueBonuses(state, me, rescued);
        recomputeVp(me);
        pushLog(state, { kind: 'system', text:
          `Fought at the ${locName} — rescued ${rescued} Bystander${rescued === 1 ? '' : 's'}.` });
      } else {
        pushLog(state, { kind: 'system', text: 'Bystander Deck is empty — no rescue.' });
      }
      return;
    }

    // ── Maestro (Radiation) Fight: KO one Hero per [strength] Hero you have ──
    // "Your [strength] Heroes" = those currently in hand or played this turn.
    // Triggers a chained ko_from_hand prompt (active player picks the heroes
    // to KO) — count = number of strength heroes available across hand+played.
    case 'maestro_ko_per_strength': {
      const isStrengthHero = (c: CardInstance) => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).classes.includes('strength');
      };
      const handCount   = me.hand.filter(isStrengthHero).length;
      const playedCount = state.thisTurn.playedThisTurn.filter(isStrengthHero).length;
      const strengthCount = handCount + playedCount;
      if (strengthCount === 0) {
        pushLog(state, { kind: 'system', text: `${me.username}: Maestro — no [strength] Heroes, no KOs.` });
        return;
      }
      // Need at least one Hero available to KO across the player's zones.
      const isHero = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
      const eligible = me.hand.some(isHero) || state.thisTurn.playedThisTurn.some(isHero);
      if (!eligible) {
        pushLog(state, { kind: 'system', text: `${me.username}: Maestro — no Heroes available to KO.` });
        return;
      }
      pushLog(state, { kind: 'system', text:
        `${me.username}: Maestro — KO ${strengthCount} Hero${strengthCount === 1 ? '' : 'es'} (one per [strength] Hero you have).` });
      state.thisTurn.pendingChoice = {
        kind: 'ko_from_hand',
        bonus: [],
        filter: 'heroes_only',
        mandatory: true,
        remaining: strengthCount - 1,
      };
      return;
    }

    // ── Zzzax (Radiation) Fight: each player reveals a [strength] Hero or
    // ──   gains a Wound (active player iterates all players internally).
    case 'each_player_reveal_strength_or_wound': {
      for (const player of state.players) {
        const strengthCard = player.hand.find(c => {
          const d = getCard(c.cardId);
          return d.kind === 'hero' && (d as HeroCardDef).classes.includes('strength');
        });
        if (strengthCard) {
          const sDef = getCard(strengthCard.cardId) as HeroCardDef;
          pushLog(state, { kind: 'system', text:
            `${player.username} reveals ${sDef.cardName} (Strength) to satisfy Zzzax.` });
        } else {
          const wound = state.woundDeck.shift();
          if (wound) {
            player.discard.push(wound);
            pushLog(state, { kind: 'system', text:
              `${player.username} has no Strength Hero — gains a Wound from Zzzax.` });
            recomputeVp(player);
          }
        }
      }
      return;
    }

    // ── Zzzax Escape: same effect, but fired per-player by the escape loop. ──
    case 'reveal_strength_or_wound': {
      const strengthCard = me.hand.find(c => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' && (d as HeroCardDef).classes.includes('strength');
      });
      if (strengthCard) {
        const sDef = getCard(strengthCard.cardId) as HeroCardDef;
        pushLog(state, { kind: 'system', text:
          `${me.username} reveals ${sDef.cardName} (Strength) to satisfy Zzzax.` });
      } else {
        const wound = state.woundDeck.shift();
        if (wound) {
          me.discard.push(wound);
          pushLog(state, { kind: 'system', text:
            `${me.username} has no Strength Hero — gains a Wound from Zzzax.` });
          recomputeVp(me);
        }
      }
      return;
    }

    // ── The Lizard (Spider-Foes) Fight ─────────────────────────────────────
    // If defeated in the Sewers (city slot 0), each OTHER player gains a
    // Wound to their discard. lastFightSlot is set in doFightCity right
    // before fight effects fire, so we read it here.
    case 'lizard_sewers_wound_others': {
      if (state.thisTurn.lastFightSlot !== 0) {
        pushLog(state, { kind: 'system', text: 'The Lizard wasn\'t fought in the Sewers — no wounds.' });
        return;
      }
      for (const p of state.players) {
        if (p.playerId === me.playerId) continue;
        const w = state.woundDeck.shift();
        if (!w) {
          pushLog(state, { kind: 'system', text: 'The Wound Deck is empty — no wound dealt.' });
          break;
        }
        p.discard.push(w);
        pushLog(state, { kind: 'wound_taken', seat: p.seat, username: p.username });
      }
      return;
    }

    // ── Skrull Shapeshifters / Veranke Fight: gain the attached Hero ───────
    // The attached Hero (set during Ambush) goes to the active player's discard.
    // The attachment record is cleared so the villain leaves the city cleanly.
    case 'skrull_gain_attached_hero': {
      // `me` is the active player resolving the fight. `state.thisTurn.lastFightSlot`
      // was recorded in doFightCity right before fight effects fire, but at this
      // point the villain has already been moved to the victory pile; we look
      // for the attached hero by scanning the cityAttachedHeroes record for
      // any villain instance that's no longer in city. The cleanest path: the
      // top of me.victoryPile is the villain we just defeated.
      const justDefeated = me.victoryPile[me.victoryPile.length - 1];
      if (!justDefeated) return;
      const attached = state.cityAttachedHeroes?.[justDefeated.instanceId];
      if (!attached) {
        pushLog(state, { kind: 'system', text: `${me.username}: Skrull had no Hero attached — nothing to gain.` });
        return;
      }
      me.discard.push(attached);
      delete state.cityAttachedHeroes![justDefeated.instanceId];
      const aDef = getCard(attached.cardId);
      const aName = aDef.kind === 'hero' ? (aDef as HeroCardDef).cardName : attached.cardId;
      pushLog(state, { kind: 'system', text: `${me.username} gains ${aName} from under the defeated Skrull!` });
      return;
    }

    // ── Paibok the Power Skrull Fight: choose an HQ Hero for each player ────
    // "Choose a Hero in the HQ for each player. Each player gains that Hero."
    // The active player picks one HQ Hero per player (interactive, chained);
    // each pick goes to that player's discard and the HQ refills between
    // picks. Recipients are served in seat order starting with the active
    // player. No Heroes in the HQ → nothing happens.
    case 'each_player_gains_hq_hero': {
      const hasHero = state.hq.some(c => c && getCard(c.cardId).kind === 'hero');
      if (!hasHero) {
        pushLog(state, { kind: 'system', text: `${me.username}: no Heroes in the HQ — Paibok's Fight does nothing.` });
        return;
      }
      // Recipient order: active player first, then the rest by seat.
      const seats = [...state.players]
        .sort((a, b) => a.seat - b.seat)
        .map(p => p.seat);
      const ordered = [me.seat, ...seats.filter(s => s !== me.seat)];
      state.thisTurn.pendingChoice = { kind: 'paibok_gain_hq_hero', recipientSeats: ordered };
      const firstName = state.players.find(p => p.seat === ordered[0])?.username ?? 'player';
      pushLog(state, { kind: 'system', text:
        `${me.username}: Paibok — choose a Hero in the HQ for ${firstName}.` });
      return;
    }

    // ── Super-Skrull Fight: each player KOs a Hero from their hand ─────────
    // Official: "Each player KOs one of their Heroes." Fires on the active
    // player's Fight resolution.
    //   • Active player → resolve IMMEDIATELY via an interactive
    //     ko_from_hand prompt over their CURRENT hand + played area. They
    //     just played cards to fight Super-Skrull, so anything in either
    //     zone is fair game — earlier behaviour deferred this to "next
    //     turn" which was wrong for the player who actually killed it.
    //   • Other players → defer to the start of their next turn (same
    //     pattern as Red Skull's master strike), since we can't prompt them
    //     interactively right now without owning their turn.
    case 'each_player_pending_ko_hero': {
      const isHeroCard = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
      const activeHasHero =
        me.hand.some(isHeroCard) || state.thisTurn.playedThisTurn.some(isHeroCard);
      if (activeHasHero) {
        state.thisTurn.pendingChoice = {
          kind: 'ko_from_hand',
          bonus: [],
          filter: 'heroes_only',
          sources: ['hand', 'played'],
          mandatory: true,
        };
        pushLog(state, { kind: 'system', text:
          `${me.username} must KO a Hero from their hand or played area (Super-Skrull).` });
      } else {
        pushLog(state, { kind: 'system', text:
          `${me.username} has no Hero to KO (Super-Skrull).` });
      }
      // Other players → defer to their next turn (multiplayer only; in solo
      // this loop body never runs since `me` is the only player).
      for (const p of state.players) {
        if (p.playerId === me.playerId) continue;
        if (p.pendingMasterStrikeKO) continue;
        p.pendingMasterStrikeKO = true;
        pushLog(state, {
          kind: 'system',
          text: `${p.username} must KO a Hero from their hand at the start of their next turn (Super-Skrull).`,
        });
      }
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

    // ── Dark Portals twist: place the next Dark Portal ────────────────────────
    case 'place_dark_portal': {
      if (!state.darkPortals) state.darkPortals = { mastermind: false, slots: [] };
      const n = state.schemeTwistsRevealed; // 1-based: this twist's number
      if (n === 1) {
        state.darkPortals.mastermind = true;
        pushLog(state, { kind: 'system', text:
          'Dark Portal opens above the Mastermind — it gains +1 strike (permanently).' });
      } else if (n >= 2 && n <= 6) {
        // "Leftmost city space" = the Bridge end as displayed on the board.
        // The board renders slots left→right as [4,3,2,1,0] (Bridge=4 … Sewers=0),
        // so fill 4 → 0: Bridge, then Streets, Rooftops, Bank, Sewers.
        const slot = [4, 3, 2, 1, 0].find(s => !state.darkPortals!.slots.includes(s));
        if (slot !== undefined) {
          state.darkPortals.slots.push(slot);
          pushLog(state, { kind: 'system', text:
            `Dark Portal opens at the ${CITY_LOCATIONS[slot]} — Villains there gain +1 strike (permanently).` });
        }
      }
      // Twist 7 (evil wins) is handled by evilWinsAfterTwists in doEndTurn.
      return;
    }

    // ── Skrull Invasion twist: highest-cost HQ Hero → Sewers as a Skrull ──────
    case 'skrull_invasion_twist': {
      // Find the highest-cost Hero currently in the HQ.
      let bestSlot = -1;
      let bestCost = -1;
      for (let i = 0; i < state.hq.length; i++) {
        const c = state.hq[i];
        if (!c) continue;
        const d = getCard(c.cardId);
        if (d.kind !== 'hero') continue;
        const cost = (d as HeroCardDef).cost;
        if (cost > bestCost) { bestCost = cost; bestSlot = i; }
      }
      if (bestSlot < 0) {
        pushLog(state, { kind: 'system', text: 'Skrull Invasion twist: no Heroes in the HQ to convert.' });
        return;
      }
      const heroCard = state.hq[bestSlot]!;
      const hDef = getCard(heroCard.cardId);
      state.hq[bestSlot] = null;
      (state.skrullHeroes ??= []).push(heroCard.instanceId);
      pushLog(state, { kind: 'system', text:
        `Skrull Invasion: ${hDef.kind === 'hero' ? (hDef as HeroCardDef).cardName : heroCard.cardId} in the HQ was a Skrull — it slips into the Sewers as a Villain!` });
      enterCity(state, heroCard, hDef);
      refillHQ(state, true);
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
      // Reveal the top 3 cards; the PLAYER chooses one to KO, one to discard,
      // and the last returns to the top. Reshuffle the discard in if the deck
      // is short (mirrors Doombot Legion's look-top-two).
      if (me.deck.length < 3 && me.discard.length > 0) {
        me.deck = shuffle([...me.deck, ...me.discard]); me.discard = [];
      }
      const peeked = me.deck.splice(0, Math.min(3, me.deck.length));
      const nameOf = (c: CardInstance) => {
        const d = getCard(c.cardId);
        return d.kind === 'hero' ? (d as HeroCardDef).cardName : ('name' in d ? (d as { name: string }).name : c.cardId);
      };
      if (peeked.length === 0) return;
      if (peeked.length === 1) {
        // Only one card — it simply returns to the top (nothing to KO/discard).
        me.deck.unshift(peeked[0]);
        pushLog(state, { kind: 'system', text: `${me.username} reveals only ${nameOf(peeked[0])} — it stays on top (Red Skull).` });
        return;
      }
      // 2 or 3 cards → interactive: pick one to KO first.
      state.thisTurn.pendingChoice = {
        kind: 'look_top_three_ko_discard_return',
        cards: peeked,
        step: 'ko',
        mandatory: true,
      };
      pushLog(state, { kind: 'system', text:
        `${me.username} reveals the top ${peeked.length} cards (Red Skull) — choose one to KO.` });
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

    // Juggernaut Ambush (per-player): KO `amount` Heroes from discard.
    // Fires at the end-of-turn villain reveal. The turn-ending (active) player
    // gets to CHOOSE which Heroes at the start of their next turn (deferred,
    // since a pending choice set here would be wiped by the turn advance);
    // every other player auto-KOs immediately (can't be prompted mid-turn).
    case 'ko_heroes_from_discard': {
      return juggernautKO(state, me, 'discard', effect.amount);
    }

    // Juggernaut Escape (per-player): KO `amount` Heroes from hand. Same
    // active-player-chooses / others-auto split as the Ambush.
    case 'ko_heroes_from_hand_immediate': {
      return juggernautKO(state, me, 'hand', effect.amount);
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
        twistsTotal: state.schemeTwistsTotal ?? scheme?.twists ?? state.schemeTwistsRevealed,
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

    // Destroyer Fight: KO all of the active player's S.H.I.E.L.D. Heroes —
    // from BOTH their hand AND their played-this-turn area. Card text reads
    // "KO all of your [shield] Heroes" with no zone restriction, so a player
    // who already played their starters mid-turn (hand now empty) still loses
    // them. Note: this targets only the active player, per the official rule.
    case 'ko_all_shield_from_hand': {
      // "KO all of your [shield] Heroes" — the bracketed icon is the
      // S.H.I.E.L.D. team symbol. In our data the symbol can appear as any
      // of four team strings; we match the same canonical set used by other
      // [shield]-counting effects elsewhere in the engine (Nick Fury's
      // Legendary Commander, Pure Fury, etc.). This includes Nick Fury cards
      // alongside the starter S.H.I.E.L.D. Troopers / Agents / Officers.
      const shieldTeams = SHIELD_TEAMS;
      const isShield = (c: CardInstance) => {
        const d = getCard(c.cardId);
        if (d.kind !== 'hero') return false;
        const teams = (d as HeroCardDef).teams ?? [];
        return teams.some(t => shieldTeams.has(t));
      };
      const handShields   = me.hand.filter(isShield);
      const playedShields = state.thisTurn.playedThisTurn.filter(isShield);
      const total = handShields.length + playedShields.length;

      if (total > 0) {
        me.hand                       = me.hand.filter(c => !isShield(c));
        state.thisTurn.playedThisTurn = state.thisTurn.playedThisTurn.filter(c => !isShield(c));
        state.ko.push(...handShields, ...playedShields);
        const zoneParts: string[] = [];
        if (handShields.length   > 0) zoneParts.push(`${handShields.length} from hand`);
        if (playedShields.length > 0) zoneParts.push(`${playedShields.length} from played area`);
        pushLog(state, { kind: 'system', text:
          `${me.username} KOs ${total} S.H.I.E.L.D. Hero${total !== 1 ? 'es' : ''} (Destroyer) — ${zoneParts.join(', ')}.` });
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
      const locationMap = CITY_LOCATION_INDEX;
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
      // Shared by Ultron's Escape and the Legacy Virus twist. `source` labels
      // which one fired (so the log doesn't always say "Ultron Escape").
      const src = effect.source ? ` (${effect.source})` : '';
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
              `${player.username} has no [tech] Hero in hand — gains a Wound${src}.` });
          }
        } else {
          pushLog(state, { kind: 'system', text:
            `${player.username} reveals a [tech] Hero — no Wound${src}.` });
        }
      }
      return;
    }

    case 'melter_reveal_top_each_player': {
      // Melter Fight: reveal top card of each player's deck and queue them
      // for the active player to decide — KO each one OR put it back on top
      // of its owner's deck. Resolution is one card at a time via the
      // melter_decide_card pending choice (Accept = KO, Skip = return).
      pushLog(state, { kind: 'system', text:
        `${me.username} triggers Melter — each player reveals their top deck card!` });
      const queue: { ownerSeat: number; ownerName: string; card: CardInstance }[] = [];
      for (const player of state.players) {
        // Standard Marvel Legendary: reshuffle discard into deck if empty.
        if (player.deck.length === 0 && player.discard.length > 0) {
          player.deck = shuffle([...player.discard]);
          player.discard = [];
        }
        const topCard = player.deck.shift();
        if (!topCard) {
          pushLog(state, { kind: 'system', text:
            `${player.username}'s deck is empty — no card to reveal.` });
          continue;
        }
        const topDef = getCard(topCard.cardId);
        const topName = topDef.kind === 'hero' ? topDef.cardName
          : 'name' in topDef ? (topDef as { name: string }).name : topCard.cardId;
        queue.push({ ownerSeat: player.seat, ownerName: player.username, card: topCard });
        pushLog(state, { kind: 'system', text:
          `${player.username} reveals ${topName}.` });
      }
      if (queue.length > 0) {
        state.thisTurn.pendingChoice = { kind: 'melter_decide_card', queue };
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

    case 'skrull_attach_hero_from_hq': {
      // No-op when reached through resolveEffect — this kind is special-cased
      // by enterCity's ambush loop (it needs the entering villain's instance
      // ID). Listed here purely to satisfy the exhaustiveness guard.
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
  // Skrull Invasion: a Hero in the city is a Skrull Villain and IS fightable.
  const isSkrullHero = def.kind === 'hero' && !!state.skrullHeroes?.includes(card.instanceId);
  if (def.kind !== 'villain' && def.kind !== 'henchman' && !isSkrullHero) {
    return { error: 'Card in City is not fightable' };
  }

  // Silent Sniper's "fight a villain with a bystander for free" flag.
  const attached = state.cityBystanders[card.instanceId] ?? [];
  const freeBystanderFight = state.thisTurn.freeBystanderFightAvailable && attached.length > 0;
  const freeFight = freeBystanderFight || !!state.thisTurn.fightCityFreeAvailable;

  // Storm – location debuff (Lightning Bolt / Tidal Wave).
  const locationDebuff = state.thisTurn.locationVillainDebuffs[slot] ?? 0;
  // Effective base strike:
  //   1. Skrull attach-hero: attached Hero's cost overrides printed value.
  //   2. Killbots scheme: Killbot villains' strike = current twist count.
  //   3. Otherwise: the villain's printed attack.
  const attachedHero = state.cityAttachedHeroes?.[card.instanceId];
  const attachedHeroDef = attachedHero ? getCard(attachedHero.cardId) : undefined;
  const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
  // Shared strike calc — same helper the board uses, so the fight gate can
  // never disagree with the displayed strike.
  // Skrull Invasion: a Hero-Skrull's strike = its [cost] + 2.
  const skrullHeroStrike = isSkrullHero && def.kind === 'hero'
    ? (def as HeroCardDef).cost + 2
    : undefined;
  const { required: requiredAttack } = effectiveCityStrike({
    printedAttack: (def.kind === 'villain' || def.kind === 'henchman') ? def.attack : 0,
    attachedHeroCost: attachedHeroDef?.kind === 'hero' ? (attachedHeroDef as HeroCardDef).cost : undefined,
    skrullHeroStrike,
    isKillbot: card.cardId === 'killbot',
    killbotStrike: state.schemeTwistsRevealed,
    bystanderCount: attached.length,
    strikePerBystander: scheme?.villainStrikePerBystander ?? 0,
    portalBonus: state.darkPortals?.slots.includes(slot) ? 1 : 0,
    locationDebuff,
  });

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
  // Venom (Spider-Foes) — requires a Covert (red [covert] icon) Hero in
  // hand or played this turn. We match on the `covert` class — every Hero
  // with the red icon has it as a primary class.
  if (def.kind === 'villain' && def.fightCondition?.requires === 'covert_hero') {
    const hasCovert = [...me.hand, ...state.thisTurn.playedThisTurn].some(c => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' && (d as HeroCardDef).classes.includes('covert');
    });
    if (!hasCovert) return { error: `You cannot defeat ${def.name} without a [covert] Hero in your hand or played this turn.` };
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
  if (isSkrullHero) {
    // Skrull Invasion: "If you defeat that Hero, you gain it." It goes to the
    // defeating player's discard (a real recruit), NOT the victory pile, and
    // awards no VP. Clear its Skrull tag.
    me.discard.push(card);
    state.skrullHeroes = (state.skrullHeroes ?? []).filter(id => id !== card.instanceId);
    const hName = def.kind === 'hero' ? (def as HeroCardDef).cardName : card.cardId;
    pushLog(state, { kind: 'system', text:
      `${me.username} unmasks and gains the Skrull-impersonated Hero ${hName}!` });
  } else {
    me.victoryPile.push(card);
  }

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

  // Skrull-heroes log their own "unmasked & gained" message above and award
  // no VP, so skip the villain_defeated event for them.
  if (!isSkrullHero && (def.kind === 'villain' || def.kind === 'henchman')) {
    pushLog(state, {
      kind: 'villain_defeated', seat: me.seat, username: me.username,
      cardId: def.cardId, cardName: def.name, vp: def.vp,
    });
  }
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
    // Card text: "Play this card as a copy of another Hero you played this turn.
    // This card is both [covert] and the color you copy." So apply every effect
    // the copied card would normally provide on play:
    //   - vanilla stat stick (baseAttack / baseRecruit)
    //   - class counts (the "and the color you copy" bit)
    //   - team counts (e.g. copying an X-Men card lets Copy Powers count as X-Men
    //     for X-Men synergy effects)
    //   - hero-class-name count (so "another <ClassName> this turn" triggers work)
    //   - onPlay effects (the copied card's actual ability)
    // The Copy Powers card's own contributions were already applied when it was
    // first played; we add the copied card's on top.
    if (cardDef.baseAttack)  state.thisTurn.attack  += cardDef.baseAttack;
    if (cardDef.baseRecruit) state.thisTurn.recruit += cardDef.baseRecruit;
    for (const cls of cardDef.classes) {
      state.thisTurn.classPlayedCounts[cls] = (state.thisTurn.classPlayedCounts[cls] ?? 0) + 1;
    }
    for (const team of cardDef.teams) {
      state.thisTurn.teamPlayedCounts[team] = (state.thisTurn.teamPlayedCounts[team] ?? 0) + 1;
    }
    state.thisTurn.heroNameCounts[cardDef.className] =
      (state.thisTurn.heroNameCounts[cardDef.className] ?? 0) + 1;
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

  // ── Paibok: assign a chosen HQ Hero to the head-of-queue player ──────────
  if (choice.kind === 'paibok_gain_hq_hero') {
    const slotIdx = state.hq.findIndex(c => c?.instanceId === instanceId);
    if (slotIdx < 0) return { error: 'That card is not in the HQ' };
    const card = state.hq[slotIdx]!;
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Paibok: choose a Hero from the HQ' };
    const [recipientSeat, ...rest] = choice.recipientSeats;
    const recipient = state.players.find(p => p.seat === recipientSeat) ?? me;
    state.hq[slotIdx] = null;
    recipient.discard.push(card);
    refillHQ(state, true);
    pushLog(state, { kind: 'system', text:
      `${recipient.username} gains ${def.cardName} from the HQ (Paibok).` });
    // More players still to serve, and HQ still has a Hero? Re-prompt.
    const hqHasHero = state.hq.some(c => c && getCard(c.cardId).kind === 'hero');
    if (rest.length > 0 && hqHasHero) {
      state.thisTurn.pendingChoice = { kind: 'paibok_gain_hq_hero', recipientSeats: rest };
      const nextName = state.players.find(p => p.seat === rest[0])?.username ?? 'player';
      pushLog(state, { kind: 'system', text: `Paibok — choose a Hero in the HQ for ${nextName}.` });
    } else {
      state.thisTurn.pendingChoice = undefined;
    }
    return state;
  }

  // ── Order Top of Deck: player picks the next card to be placed on top ──
  // Click order becomes draw order — first click ends up on top of the deck
  // (drawn next), subsequent clicks below it. When the queue empties, all
  // placed cards are pushed to the deck in their click order.
  if (choice.kind === 'order_top_of_deck') {
    const qIdx = choice.queue.findIndex(c => c.instanceId === instanceId);
    if (qIdx < 0) return { error: 'That card is not in the cards to order' };
    const picked = choice.queue[qIdx];
    const remainingQueue = [...choice.queue.slice(0, qIdx), ...choice.queue.slice(qIdx + 1)];
    const newPlaced = [...choice.placed, picked];
    if (remainingQueue.length === 0) {
      // All ordered — push to deck. placed[0] should be drawn first (on top),
      // so unshift in reverse so the last-unshifted is on top.
      for (let i = newPlaced.length - 1; i >= 0; i--) {
        me.deck.unshift(newPlaced[i]);
      }
      state.thisTurn.pendingChoice = undefined;
      const pickedDef = getCard(picked.cardId);
      const pickedName = pickedDef.kind === 'hero' ? pickedDef.cardName
        : 'name' in pickedDef ? (pickedDef as { name: string }).name : picked.cardId;
      pushLog(state, { kind: 'system', text:
        `${me.username} placed ${pickedName} on top of their deck (order complete).` });
    } else {
      // More to order — re-queue with picked card added to placed.
      state.thisTurn.pendingChoice = { kind: 'order_top_of_deck', queue: remainingQueue, placed: newPlaced };
      const pickedDef = getCard(picked.cardId);
      const pickedName = pickedDef.kind === 'hero' ? pickedDef.cardName
        : 'name' in pickedDef ? (pickedDef as { name: string }).name : picked.cardId;
      pushLog(state, { kind: 'system', text:
        `${me.username} placed ${pickedName} (position ${newPlaced.length}) — ${remainingQueue.length} more to order.` });
    }
    return state;
  }

  // ── Villain Escape penalty: player clicked an HQ Hero to KO ────────────
  // Any HQ Hero is valid — the active player chooses (replaces the prior
  // auto-pick of highest-cost ≤6 Hero).
  if (choice.kind === 'escape_ko_hq_hero') {
    const slotIdx = state.hq.findIndex(c => c?.instanceId === instanceId);
    if (slotIdx < 0) return { error: 'That card is not in the HQ' };
    const card = state.hq[slotIdx]!;
    const def = getCard(card.cardId);
    if (def.kind !== 'hero') return { error: 'Select a Hero card from the HQ' };
    state.thisTurn.pendingChoice = undefined;
    state.hq[slotIdx] = null;
    state.ko.push(card);
    refillHQ(state, true);
    pushLog(state, { kind: 'system', text:
      `${me.username} chose to KO ${def.cardName} from the HQ (${choice.escapedVillainName} escape).` });
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
    // Heroes-only variant (Juggernaut): the clicked card must be a Hero.
    if (choice.heroesOnly && getCard(me.discard[idx].cardId).kind !== 'hero') {
      return { error: 'Choose a Hero from your discard pile' };
    }
    const card = me.discard.splice(idx, 1)[0];
    state.ko.push(card);
    const def = getCard(card.cardId);
    const name = def.kind === 'hero' ? def.cardName : 'name' in def ? (def as { name: string }).name : card.cardId;
    pushLog(state, { kind: 'system', text: `${me.username} KOs ${name} from discard (${choice.label ?? 'Maniacal Tyrant'}).` });
    const remaining = choice.remaining - 1;
    // Candidate pool for the next pick — heroes-only when restricted.
    const pool = choice.heroesOnly
      ? me.discard.filter(c => getCard(c.cardId).kind === 'hero')
      : [...me.discard];
    if (remaining > 0 && pool.length > 0) {
      state.thisTurn.pendingChoice = {
        kind: 'ko_up_to_from_discard',
        remaining,
        cards: pool,
        label: choice.label,
        heroesOnly: choice.heroesOnly,
        mandatory: choice.mandatory,
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

  // ── Red Skull Tactic 1: KO one of 3, discard one, return the last to top ──
  if (choice.kind === 'look_top_three_ko_discard_return') {
    const idx = choice.cards.findIndex(c => c.instanceId === instanceId);
    if (idx < 0) return { error: 'Choose one of the revealed cards' };
    const picked = choice.cards[idx];
    const rest = choice.cards.filter((_, i) => i !== idx);
    const nameOf = (c: CardInstance) => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' ? (d as HeroCardDef).cardName : ('name' in d ? (d as { name: string }).name : c.cardId);
    };
    if (choice.step === 'ko') {
      state.ko.push(picked);
      pushLog(state, { kind: 'system', text: `${me.username} KO'd ${nameOf(picked)} (Red Skull).` });
      if (rest.length <= 1) {
        // Only one card left → it returns to the top; no discard step.
        if (rest[0]) {
          me.deck.unshift(rest[0]);
          pushLog(state, { kind: 'system', text: `${nameOf(rest[0])} returns to the top of the deck (Red Skull).` });
        }
        state.thisTurn.pendingChoice = undefined;
      } else {
        state.thisTurn.pendingChoice = { kind: 'look_top_three_ko_discard_return', cards: rest, step: 'discard', mandatory: true };
        pushLog(state, { kind: 'system', text: `${me.username} — now choose one to discard.` });
      }
    } else {
      // discard step: discard the picked card; the last one returns to top.
      me.discard.push(picked);
      const last = rest[0];
      pushLog(state, { kind: 'system', text: `${me.username} discarded ${nameOf(picked)} (Red Skull).` });
      if (last) {
        me.deck.unshift(last);
        pushLog(state, { kind: 'system', text: `${nameOf(last)} returns to the top of the deck (Red Skull).` });
      }
      state.thisTurn.pendingChoice = undefined;
    }
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
    // More cards still to place (Dr. Doom puts 2)? Re-prompt with one fewer.
    const remaining = choice.remaining ?? 0;
    if (remaining > 0 && me.hand.length > 0) {
      state.thisTurn.pendingChoice = { kind: 'put_card_on_deck', mandatory: true, remaining: remaining - 1 };
    } else {
      state.thisTurn.pendingChoice = undefined;
    }
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
    const shieldTeams = SHIELD_TEAMS;
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

  // Multi-pick chain: if `remaining > 0` (e.g. Whirlwind "KO 2 Heroes", or
  // Magneto's "discard down to 4"), queue the next prompt — but only if
  // there are still eligible cards left to pick from. Applies to both
  // ko_from_hand and discard_from_hand.
  if ((choice.kind === 'ko_from_hand' || choice.kind === 'discard_from_hand')
      && (choice.remaining ?? 0) > 0) {
    const isHeroCard  = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
    const isShieldCard = (c: CardInstance) => {
      const d = getCard(c.cardId);
      if (d.kind !== 'hero') return false;
      const st = SHIELD_TEAMS;
      return (d as HeroCardDef).teams.some(t => st.has(t));
    };
    const isWoundCard = (c: CardInstance) => c.cardId === 'wound';
    const matchFn =
      choice.filter === 'heroes_only'  ? isHeroCard  :
      choice.filter === 'shield_heroes' ? isShieldCard :
      choice.filter === 'wounds_only'   ? isWoundCard  :
      () => true;
    // discard_from_hand only ever pulls from hand; ko_from_hand defaults to
    // both hand and played-area.
    const defaultSrcs: ('hand' | 'discard' | 'played')[] =
      choice.kind === 'discard_from_hand' ? ['hand'] : ['hand', 'played'];
    const srcs = choice.sources ?? defaultSrcs;
    const hasMore =
      (srcs.includes('hand')    && me.hand.some(matchFn)) ||
      (srcs.includes('played')  && state.thisTurn.playedThisTurn.some(matchFn)) ||
      (srcs.includes('discard') && me.discard.some(matchFn));
    if (hasMore) {
      state.thisTurn.pendingChoice = {
        kind: choice.kind,
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

  // Melter Fight — Accept = KO the current revealed card.
  if (choice.kind === 'melter_decide_card') {
    advanceMelterQueue(state, choice, 'ko');
    return state;
  }

  return { error: 'Nothing to accept for this choice kind' };
}

/** Apply the active player's decision to the FIRST queued Melter card and
 *  re-queue the choice if any cards remain. 'ko' sends the card to the KO
 *  pile; 'return' puts it back on top of its owner's deck. */
function advanceMelterQueue(
  state: LegendaryState,
  choice: Extract<PendingChoice, { kind: 'melter_decide_card' }>,
  action: 'ko' | 'return',
): void {
  const [first, ...rest] = choice.queue;
  if (!first) {
    state.thisTurn.pendingChoice = undefined;
    return;
  }
  const def = getCard(first.card.cardId);
  const name = def.kind === 'hero' ? def.cardName
    : 'name' in def ? (def as { name: string }).name : first.card.cardId;
  if (action === 'ko') {
    state.ko.push(first.card);
    pushLog(state, { kind: 'system', text: `Melter: ${first.ownerName}'s ${name} is KO'd.` });
  } else {
    const owner = state.players.find(p => p.seat === first.ownerSeat);
    if (owner) {
      owner.deck.unshift(first.card); // top of deck
      pushLog(state, { kind: 'system', text: `Melter: ${first.ownerName}'s ${name} returns to the top of their deck.` });
    }
  }
  if (rest.length > 0) {
    state.thisTurn.pendingChoice = { kind: 'melter_decide_card', queue: rest };
  } else {
    state.thisTurn.pendingChoice = undefined;
  }
}

function doSkipChoice(state: LegendaryState): LegendaryState | { error: string } {
  const choice = state.thisTurn.pendingChoice;
  if (!choice) return { error: 'No pending choice to skip' };
  if ('mandatory' in choice && choice.mandatory) {
    return { error:
      choice.kind === 'put_card_on_deck'
        ? 'You must choose a card to put on top of your deck — this cannot be skipped.'
      : choice.kind === 'ko_up_to_from_discard'
        ? 'You must KO the required Heroes from your discard pile — this cannot be skipped.'
      : choice.kind === 'ko_from_hand'
        ? 'You must KO the required Heroes — this cannot be skipped.'
        : 'You must discard a card — this cost cannot be skipped.' };
  }
  // A few choice kinds don't carry a `mandatory` flag but still can't be
  // skipped — skipping them would silently lose state (cards disappear).
  if (choice.kind === 'order_top_of_deck') {
    return { error: 'You must order the revealed cards before continuing.' };
  }
  if (choice.kind === 'escape_ko_hq_hero') {
    return { error: 'You must KO a Hero from the HQ — the escape penalty cannot be skipped.' };
  }
  if (choice.kind === 'paibok_gain_hq_hero') {
    return { error: 'You must choose a Hero in the HQ for each player (Paibok).' };
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
  // Maniacal Tyrant: player stops KO-ing from discard. (Juggernaut's variant
  // sets mandatory:true and is rejected by the generic mandatory guard above.)
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
  // Melter Fight — Skip = put the current revealed card back on top of its
  // owner's deck. advanceMelterQueue re-queues the choice if more cards remain.
  if (choice.kind === 'melter_decide_card') {
    advanceMelterQueue(state, choice, 'return');
    return state;
  }
  // Covering Fire (Skip): each other player discards a card from their hand.
  // Defer so each player CHOOSES which card at the start of their next turn
  // (they're non-active right now and can't be prompted mid-turn).
  if (choice.kind === 'choose_others_draw_or_discard') {
    const me = state.players[state.currentPlayerIdx];
    for (const p of state.players) {
      if (p.playerId === me.playerId) continue;
      if (p.hand.length > 0) {
        p.pendingHandDiscard = (p.pendingHandDiscard ?? 0) + 1;
        pushLog(state, { kind: 'system', text: `${p.username} must discard a card at the start of their next turn (Covering Fire).` });
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

  // Storm – Tidal Wave: mastermind attack debuff (per-turn, lowers requirement).
  // Dark Portals: persistent +1 if a portal sits above the Mastermind.
  const mmPortalBonus = state.darkPortals?.mastermind ? 1 : 0;
  const mmRequired = Math.max(0, mmDef.attack + mmPortalBonus - state.thisTurn.mastermindAttackDebuff);

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
  // "fightOthers" effects target EACH other player (punishments). Discards are
  // deferred so each player CHOOSES which card at the start of their next turn;
  // other imposed effects resolve immediately.
  const others = state.players.filter(p => p.playerId !== me.playerId);
  for (const eff of tacticDef.fightOthers ?? []) {
    for (const p of others) {
      if (eff.kind === 'discard_from_hand') {
        if (p.hand.length > 0) {
          p.pendingHandDiscard = (p.pendingHandDiscard ?? 0) + eff.up_to;
          pushLog(state, { kind: 'system', text: `${p.username} must discard ${eff.up_to} card${eff.up_to === 1 ? '' : 's'} at the start of their next turn — ${tacticDef.name}.` });
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

/** Juggernaut Ambush/Escape: KO `amount` Heroes from a player's discard
 *  (ambush) or hand (escape). The turn-ending (active) player defers to an
 *  interactive choice at the start of their next turn; everyone else auto-KOs
 *  the cheapest Heroes immediately. Always logs the card names. */
function juggernautKO(
  state: LegendaryState,
  me: PlayerState,
  zone: 'discard' | 'hand',
  amount: number,
): void {
  const isHero = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
  const pile = zone === 'discard' ? me.discard : me.hand;
  const heroes = pile.filter(isHero);
  const toKo = Math.min(amount, heroes.length);
  const where = zone === 'discard' ? 'discard pile' : 'hand';
  if (toKo === 0) {
    pushLog(state, { kind: 'system', text: `${me.username} has no Heroes in their ${where} to KO (Juggernaut).` });
    return;
  }
  const isActive = me.playerId === state.players[state.currentPlayerIdx]?.playerId;
  if (isActive) {
    me.pendingJuggernautKO = { zone, amount: toKo };
    pushLog(state, { kind: 'system', text:
      `${me.username} must KO ${toKo} Hero${toKo === 1 ? '' : 's'} from their ${where} at the start of their next turn (Juggernaut) — they choose which.` });
    return;
  }
  // Non-active player: auto-KO the cheapest Heroes, naming them.
  const sorted = [...heroes].sort((a, b) => (getCard(a.cardId) as HeroCardDef).cost - (getCard(b.cardId) as HeroCardDef).cost);
  const koed = sorted.slice(0, toKo);
  const names: string[] = [];
  for (const card of koed) {
    const src = zone === 'discard' ? me.discard : me.hand;
    const idx = src.findIndex(c => c.instanceId === card.instanceId);
    if (idx < 0) continue;
    src.splice(idx, 1);
    state.ko.push(card);
    names.push((getCard(card.cardId) as HeroCardDef).cardName);
  }
  if (names.length > 0) {
    pushLog(state, { kind: 'system', text: `${me.username} KOs ${names.join(', ')} from their ${where} (Juggernaut).` });
    recomputeVp(me);
  }
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
 * Resolve Magneto's master-strike against a single player's hand.
 *
 * If the player has any X-Men hero in hand they reveal it for no penalty.
 * Otherwise they must discard down to 4 cards. When the target IS the
 * currently-active player, queue a chained `discard_from_hand` pending
 * choice so the player picks which cards to drop. Non-active players don't
 * get a UI prompt — auto-discard from the top of hand instead (Marvel
 * Legendary's parallel "each player simultaneously…" wording isn't
 * something our turn-by-turn engine can offer per-player UI for).
 */
function resolveMagnetoStrike(state: LegendaryState, player: PlayerState): void {
  if (player.hand.length === 0) return;
  const hasXmen = player.hand.some(c => {
    const d = getCard(c.cardId);
    return d.kind === 'hero' && (d as HeroCardDef).teams.includes('x-men');
  });
  if (hasXmen) {
    pushLog(state, { kind: 'system', text: `${player.username} reveals an X-Men Hero — no penalty from Magneto's Master Strike.` });
    return;
  }
  if (player.hand.length <= 4) {
    pushLog(state, { kind: 'system', text: `${player.username} already has ${player.hand.length} cards — no discard needed (Magneto).` });
    return;
  }
  const toDiscard = player.hand.length - 4;
  // Always interactive: this only runs from resolvePendingStrikes at the start
  // of `player`'s own turn (so they ARE the active player). The player chooses
  // which cards to discard down to 4 — chained discard_from_hand prompts.
  state.thisTurn.pendingChoice = {
    kind: 'discard_from_hand',
    bonus: [],
    mandatory: true,
    sources: ['hand'],
    remaining: toDiscard - 1,
  };
  pushLog(state, { kind: 'system', text: `${player.username}: Magneto's Master Strike — choose ${toDiscard} card${toDiscard === 1 ? '' : 's'} to discard from your hand.` });
}

/**
 * Dr. Doom Master Strike: reveal a [tech] Hero (no penalty) or put 2 cards
 * from hand on top of deck. The active player picks which 2 cards (chained
 * interactive prompt); non-active players auto-shed the 2 cheapest.
 */
function resolveDoomStrike(state: LegendaryState, player: PlayerState): void {
  if (player.hand.length === 0) return;
  const hasTech = player.hand.some(c => {
    const d = getCard(c.cardId);
    return d.kind === 'hero' && (d as HeroCardDef).classes.includes('tech');
  });
  if (hasTech) {
    pushLog(state, { kind: 'system', text: `${player.username} reveals a [tech] Hero — no penalty from Dr. Doom's Master Strike.` });
    return;
  }
  // No tech Hero → put 2 cards on top of the deck. Clamp to hand size.
  const toPut = Math.min(2, player.hand.length);
  if (toPut === 0) return;
  const isActive = state.players[state.currentPlayerIdx]?.playerId === player.playerId;
  if (isActive) {
    state.thisTurn.pendingChoice = {
      kind: 'put_card_on_deck',
      mandatory: true,
      remaining: toPut - 1,
    };
    pushLog(state, { kind: 'system', text: `${player.username}: Dr. Doom's Master Strike — choose ${toPut} card${toPut === 1 ? '' : 's'} to put on top of your deck.` });
  } else {
    // Non-active player: auto-shed the cheapest cards.
    const sorted = [...player.hand].sort((a, b) => {
      const da = getCard(a.cardId), db = getCard(b.cardId);
      const ca = da.kind === 'hero' ? (da as HeroCardDef).cost : 0;
      const cb = db.kind === 'hero' ? (db as HeroCardDef).cost : 0;
      return ca - cb;
    });
    const toMove = sorted.slice(0, toPut);
    for (const card of toMove) {
      player.hand = player.hand.filter(c => c.instanceId !== card.instanceId);
      player.deck.unshift(card);
    }
    const names = toMove.map(c => {
      const d = getCard(c.cardId);
      return d.kind === 'hero' ? (d as HeroCardDef).cardName : 'name' in d ? (d as { name: string }).name : c.cardId;
    });
    pushLog(state, { kind: 'system', text: `${player.username}: Dr. Doom's strike — ${names.join(' and ')} put on top of deck.` });
  }
}

/**
 * Resolve any master-strike effects that were deferred because the player's
 * hand was empty when the strike fired (active player at end-of-turn villain
 * reveal). Called after a fresh hand is drawn, so the deferred effect lands
 * on the new hand. Currently handles Red Skull (KO a Hero), Magneto (reveal
 * X-Men or discard down to 4), Loki (reveal Strength Hero or gain Wound), and
 * Dr. Doom (reveal a [tech] Hero or put 2 cards on top of deck).
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
  // resolveMagnetoStrike handles both the X-Men reveal short-circuit and
  // the interactive vs auto-discard branch (active player gets a prompt).
  if (player.pendingMagnetoStrike) {
    player.pendingMagnetoStrike = undefined;
    resolveMagnetoStrike(state, player);
  }

  // Dr. Doom: reveal a [tech] Hero, or put 2 cards on top of deck (interactive).
  if (player.pendingDoomStrike) {
    player.pendingDoomStrike = undefined;
    resolveDoomStrike(state, player);
  }

  // Juggernaut Ambush/Escape: the player now CHOOSES which Heroes to KO from
  // their discard (ambush) or hand (escape) — an interactive prompt over the
  // freshly available cards.
  if (player.pendingJuggernautKO) {
    const { zone, amount } = player.pendingJuggernautKO;
    player.pendingJuggernautKO = undefined;
    const isHero = (c: CardInstance) => getCard(c.cardId).kind === 'hero';
    if (zone === 'discard') {
      const heroes = player.discard.filter(isHero);
      const toKo = Math.min(amount, heroes.length);
      if (toKo > 0) {
        state.thisTurn.pendingChoice = {
          kind: 'ko_up_to_from_discard',
          remaining: toKo,
          cards: heroes,
          label: 'Juggernaut',
          heroesOnly: true,
          mandatory: true,
        };
        pushLog(state, { kind: 'system', text:
          `${player.username}: Juggernaut — choose ${toKo} Hero${toKo === 1 ? '' : 's'} to KO from your discard pile.` });
      }
    } else {
      const heroes = player.hand.filter(isHero);
      const toKo = Math.min(amount, heroes.length);
      if (toKo > 0) {
        state.thisTurn.pendingChoice = {
          kind: 'ko_from_hand',
          bonus: [],
          filter: 'heroes_only',
          sources: ['hand'],
          mandatory: true,
          remaining: toKo - 1,
        };
        pushLog(state, { kind: 'system', text:
          `${player.username}: Juggernaut — choose ${toKo} Hero${toKo === 1 ? '' : 's'} to KO from your hand.` });
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

  // Generic deferred hand-discard (Hawkeye Covering Fire, Tactic punishments,
  // villain-escape Bystander penalty): the player CHOOSES which cards to
  // discard. Only fire if nothing else already set a prompt this turn — any
  // leftover discard count persists and resolves next turn (rare double-up).
  if (player.pendingHandDiscard && !state.thisTurn.pendingChoice) {
    const owed = player.pendingHandDiscard;
    const toDiscard = Math.min(owed, player.hand.length);
    if (toDiscard > 0) {
      player.pendingHandDiscard = undefined;
      state.thisTurn.pendingChoice = {
        kind: 'discard_from_hand',
        bonus: [],
        mandatory: true,
        sources: ['hand'],
        remaining: toDiscard - 1,
      };
      pushLog(state, { kind: 'system', text:
        `${player.username}: choose ${toDiscard} card${toDiscard === 1 ? '' : 's'} to discard from your hand.` });
    } else {
      player.pendingHandDiscard = undefined; // nothing in hand to discard
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
  // Hero Deck empty: most schemes treat this as the heroes' final turn (→
  // tie). Super Hero Civil War instead makes it an immediate LOSS.
  if (state.heroDeck.length === 0) {
    const sch = SCHEMES.find(s => s.cardId === state.schemeId);
    if (sch?.evilWinsIfHeroDeckEmpty && !state.result) {
      state.result = 'loss';
      state.resultReason = `${sch.name} — the Hero Deck ran out. Evil wins.`;
      state.phase = 'finished';
      pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
      return state;
    }
    if (!state.lastTurnTie) {
      state.lastTurnTie = true;
      pushLog(state, {
        kind: 'system',
        text: 'The Hero Deck has run out — this is the heroes\' final turn!',
      });
    }
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
  //
  //    WARMUP ROUNDS (4-5 player games only): on each player's very first
  //    turn, NO Villain Deck card is revealed — this gives large groups time
  //    to get their decks going before the Villains start invading. `state.turn`
  //    starts at 1 and increments once per player-turn, so the first
  //    `playerCount` turns are each player's first turn.
  const isWarmupTurn = state.players.length >= 4 && state.turn <= state.players.length;
  if (isWarmupTurn) {
    pushLog(state, {
      kind: 'system',
      text: `Warmup Round — no Villain Deck card is revealed this turn (4–5 player rule).`,
    });
  } else {
    revealOneVillainCard(state);
  }

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
  // Legacy Virus-style loss: wound stack depleted.
  if (scheme && scheme.evilWinsIfWoundDeckEmpty && state.woundDeck.length === 0) {
    state.result       = 'loss';
    state.resultReason = `${scheme.name} succeeded — the Wound stack ran out.`;
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
  // Carry over pendingChoices that were set during villain reveal (solo twist
  // tuck, villain escape KO) so they don't get wiped by emptyTurnState() — the
  // player needs to resolve them at the start of their next turn before they
  // can play. (Solo twist tuck stays with the active player in solo; escape
  // KO transfers to whoever is the new active player after advance.)
  const carryoverChoice =
    state.thisTurn.pendingChoice?.kind === 'solo_twist_tuck_hero' ||
    state.thisTurn.pendingChoice?.kind === 'escape_ko_hq_hero'
      ? state.thisTurn.pendingChoice
      : undefined;
  state.currentPlayerIdx = (state.currentPlayerIdx + 1) % state.players.length;
  state.turn++;
  state.thisTurn = emptyTurnState();
  if (carryoverChoice) state.thisTurn.pendingChoice = carryoverChoice;
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
 *   • bystander        → captured immediately by the villain closest to the
 *                        deck-entry edge (or the Mastermind if the city is empty)
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
        twistsTotal: state.schemeTwistsTotal ?? scheme?.twists ?? state.schemeTwistsRevealed,
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
      // Killbots scheme override: bystanders in the Villain Deck count as
      // Killbot Villains. Convert this bystander instance into a Killbot and
      // route it through enterCity as a regular villain. Effective strike
      // scales with the current twist count (handled in doFightCity below).
      if (state.schemeId === 'scheme_killbots') {
        const killbotInstance = mkInstance('killbot');
        const killbotDef = getCard('killbot');
        pushLog(state, { kind: 'system', text:
          `Bystander revealed under Killbots — it animates into a Killbot Villain (strike ${state.schemeTwistsRevealed}).` });
        enterCity(state, killbotInstance, killbotDef);
        return killbotInstance;
      }
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
    case 'hero': {
      // Skrull Invasion: a Hero shuffled into the Villain Deck enters the
      // city as a Skrull Villain (its id is already in state.skrullHeroes).
      // If somehow a non-Skrull hero reaches here, treat it as one anyway.
      if (!state.skrullHeroes?.includes(card.instanceId)) {
        (state.skrullHeroes ??= []).push(card.instanceId);
      }
      pushLog(state, { kind: 'system', text:
        `A Skrull Shapeshifter reveals itself as ${(def as HeroCardDef).cardName} — it enters the city as a Villain!` });
      enterCity(state, card, def);
      return card;
    }
    default:
      // wound/mastermind/scheme defs should never live in the villain deck —
      // defensive fallthrough.
      state.ko.push(card);
      return card;
  }
}

/** Push villains forward in the City and slot a new arrival into position 0.
 *  If a villain is pushed off the right edge, it escapes. Per the rules:
 *
 *  1. The active player CHOOSES a Hero in the HQ to KO (interactive — set
 *     via the escape_ko_hq_hero pending choice); refill afterward.
 *  2. If the escaping villain had captured bystanders, each player discards
 *     one card from their hand. Bystanders stay in the Escape Pile (lost).
 *  3. Fire any "Escape" effect printed on the villain card. */
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
      const isSkrullHeroEscape = eDef.kind === 'hero' && !!state.skrullHeroes?.includes(escaped.instanceId);
      if (eDef.kind === 'villain' || eDef.kind === 'henchman' || isSkrullHeroEscape) {
        const escapedName = eDef.kind === 'hero' ? (eDef as HeroCardDef).cardName : eDef.name;
        pushLog(state, { kind: 'villain_escaped', cardId: eDef.cardId, cardName: escapedName });

        // Skrull Invasion: a Hero-Skrull escaping counts toward the
        // "6 Heroes escape = evil wins" loss timer.
        if (isSkrullHeroEscape) {
          state.escapedHeroes = (state.escapedHeroes ?? 0) + 1;
          state.skrullHeroes = (state.skrullHeroes ?? []).filter(id => id !== escaped.instanceId);
          const ssch = SCHEMES.find(s => s.cardId === state.schemeId);
          if (ssch?.evilWinsAfterEscapedHeroes !== undefined) {
            pushLog(state, { kind: 'system', text:
              `A Hero-Skrull escaped (${state.escapedHeroes}/${ssch.evilWinsAfterEscapedHeroes}).` });
            if ((state.escapedHeroes ?? 0) >= ssch.evilWinsAfterEscapedHeroes && !state.result) {
              state.result = 'loss';
              state.resultReason = `${ssch.name} — ${state.escapedHeroes} Heroes escaped into the Skrull ranks. Evil wins.`;
              state.phase = 'finished';
              pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
            }
          }
        }

        // Killbots scheme: a Killbot Villain escaping counts toward the
        // "5 Killbots escape = evil wins" loss timer.
        if (escaped.cardId === 'killbot') {
          state.escapedKillbots = (state.escapedKillbots ?? 0) + 1;
          const ksch = SCHEMES.find(s => s.cardId === state.schemeId);
          if (ksch?.evilWinsAfterEscapedKillbots !== undefined) {
            pushLog(state, { kind: 'system', text:
              `A Killbot escaped (${state.escapedKillbots}/${ksch.evilWinsAfterEscapedKillbots}).` });
            if ((state.escapedKillbots ?? 0) >= ksch.evilWinsAfterEscapedKillbots && !state.result) {
              state.result = 'loss';
              state.resultReason = `${ksch.name} — ${state.escapedKillbots} Killbots escaped. Evil wins.`;
              state.phase = 'finished';
              pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
            }
          }
        }

        // ── Step 1: prompt the active player to KO a Hero from the HQ ───
        // Was: engine auto-picked the highest-cost (≤6) Hero. Now we set a
        // mandatory pending choice so the active player clicks which Hero
        // dies. Only set if there's actually a Hero in the HQ to target.
        const hasHqHero = state.hq.some(c => {
          if (!c) return false;
          return getCard(c.cardId).kind === 'hero';
        });
        if (hasHqHero) {
          state.thisTurn.pendingChoice = {
            kind: 'escape_ko_hq_hero',
            escapedVillainName: escapedName,
          };
          pushLog(state, { kind: 'system', text:
            `Escape: ${escapedName} escaped — choose a Hero in the HQ to KO.` });
        } else {
          pushLog(state, { kind: 'system', text:
            `Escape: ${escapedName} escaped — no Heroes in the HQ to KO.` });
        }

        // ── Step 2: Bystander penalty ──────────────────────────────────────
        // Bystanders stay in the Escape Pile (attached to the escaped villain).
        // Each player that has cards in hand must discard one.
        const bys = state.cityBystanders[escaped.instanceId] ?? [];
        if (bys.length > 0) {
          const byCount = bys.length;
          delete state.cityBystanders[escaped.instanceId];
          // Count them as "carried away" (Bank Robbery loss timer) and move
          // them to the escape pile.
          state.escapedBystanders = (state.escapedBystanders ?? 0) + byCount;
          state.escapedPile.push(...bys);
          // Each player discards a card — deferred so they CHOOSE which one at
          // the start of their next turn (this fires during the end-of-turn
          // reveal, so an immediate pending choice would be wiped anyway).
          for (const p of state.players) {
            if (p.hand.length > 0) {
              p.pendingHandDiscard = (p.pendingHandDiscard ?? 0) + 1;
              pushLog(state, {
                kind: 'system',
                text: `${p.username} must discard a card at the start of their next turn — ${escapedName} escaped with ${byCount} bystander${byCount === 1 ? '' : 's'}.`,
              });
            }
          }
          // Midtown Bank Robbery: evil wins when 8 Bystanders are carried away.
          const scheme = SCHEMES.find(s => s.cardId === state.schemeId);
          if (scheme?.evilWinsAfterEscapedBystanders !== undefined
              && (state.escapedBystanders ?? 0) >= scheme.evilWinsAfterEscapedBystanders
              && !state.result) {
            state.result = 'loss';
            state.resultReason = `${scheme.name} — ${state.escapedBystanders} Bystanders were carried away. Evil wins.`;
            state.phase = 'finished';
            pushLog(state, { kind: 'game_ended', result: 'loss', reasonText: state.resultReason });
          }
        } else {
          delete state.cityBystanders[escaped.instanceId];
        }

        // Skrull attached Hero: if this escaping villain had a Hero tucked
        // under it, the Hero is KO'd along with the escape (it's lost). Card
        // text on Skrull villains says nothing about returning it, so KO is
        // the safe interpretation that punishes letting the Skrull get away.
        const attachedOnEscape = state.cityAttachedHeroes?.[escaped.instanceId];
        if (attachedOnEscape) {
          state.ko.push(attachedOnEscape);
          delete state.cityAttachedHeroes![escaped.instanceId];
          const aDef = getCard(attachedOnEscape.cardId);
          const aName = aDef.kind === 'hero' ? (aDef as HeroCardDef).cardName : attachedOnEscape.cardId;
          pushLog(state, { kind: 'system', text: `${aName} was KO'd along with the escaping Skrull.` });
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
        // Skrull attach is special-cased: the ambush handler needs the
        // entering villain's instance ID so it can tuck the chosen Hero
        // under THIS specific villain (not per-player like other ambushes).
        if (eff.kind === 'skrull_attach_hero_from_hq') {
          attachHeroToVillain(state, card, eff.mode);
          continue;
        }
        // The Leader (Radiation) ambush "Play the top card of the Villain
        // Deck" fires GLOBALLY — not once per player like most ambushes.
        // Same is true for any other villain_deck_reveal_top ambush.
        if (eff.kind === 'villain_deck_reveal_top') {
          for (let i = 0; i < eff.amount; i++) {
            if (state.villainDeck.length === 0) break;
            revealOneVillainCard(state);
            if (state.result) break;
          }
          continue;
        }
        for (const p of state.players) resolveEffect(state, p, eff);
      }
    }
  }
}

/** Skrull Ambush helper: pulls a Hero out of the HQ (either the rightmost
 *  occupied slot or the highest-cost Hero) and tucks it under the given
 *  villain instance. The villain's effective strike then equals that Hero's
 *  [cost]; defeating it awards the Hero to the active player. */
function attachHeroToVillain(
  state: LegendaryState,
  villain: CardInstance,
  mode: 'rightmost' | 'highest_cost',
): void {
  let slotIdx: number | null = null;
  if (mode === 'rightmost') {
    for (let i = state.hq.length - 1; i >= 0; i--) {
      const c = state.hq[i];
      if (!c) continue;
      const d = getCard(c.cardId);
      if (d.kind === 'hero') { slotIdx = i; break; }
    }
  } else {
    let bestCost = -1;
    for (let i = 0; i < state.hq.length; i++) {
      const c = state.hq[i];
      if (!c) continue;
      const d = getCard(c.cardId);
      if (d.kind !== 'hero') continue;
      const cost = (d as HeroCardDef).cost;
      if (cost > bestCost) { bestCost = cost; slotIdx = i; }
    }
  }
  if (slotIdx === null) {
    pushLog(state, { kind: 'system', text: 'Skrull Ambush: no Hero in the HQ to attach.' });
    return;
  }
  const hero = state.hq[slotIdx]!;
  const heroDef = getCard(hero.cardId);
  if (heroDef.kind !== 'hero') return;
  state.hq[slotIdx] = null;
  if (!state.cityAttachedHeroes) state.cityAttachedHeroes = {};
  state.cityAttachedHeroes[villain.instanceId] = hero;
  const villainDef = getCard(villain.cardId);
  const villainName = villainDef.kind === 'villain' ? villainDef.name : villain.cardId;
  pushLog(state, {
    kind: 'system',
    text: `${villainName} tucks ${heroDef.cardName} (cost ${heroDef.cost}) under itself — its strike is now ${heroDef.cost}.`,
  });
  refillHQ(state, true);
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
  // Analytics meta — recorded into game_history.meta so /legendary-stats can
  // aggregate win-rates per Mastermind / Scheme / Hero class by player count.
  // result is the co-op party outcome (win = party beat the Mastermind).
  const meta = {
    result: state.result,                       // 'win' | 'loss' | 'tie'
    mastermind: state.mastermindId,
    scheme: state.schemeId,
    heroClasses: [...state.heroClassIds],
    playerCount: state.players.length,
  };
  return { winnerId, playerIds: ordered.map(p => p.playerId), meta };
}
