// HeroQuest engine — pure functions over HQState.
//
// Phases:
//   • lobby   → players pick hero classes, host starts the quest
//   • heroes  → one hero takes their turn (roll move, move, one action, end turn)
//   • zargon  → engine runs ALL monsters' turns automatically, then advances
//   • finished → win/lose
//
// The engine is dispatched through applyAction({state, playerId, action}).
// Returns {ok:true, state} on success or {ok:false, error} for invalid moves.
//
// Convention: every public mutation runs through `clone(state)` so callers
// can rely on referential equality to detect changes.

import {
  type HQState,
  type HQAction,
  type ApplyResult,
  type Coord,
  type DieFace,
  type DiceRoll,
  type Door,
  type Hero,
  type HeroClass,
  type LogEntry,
  type Monster,
  type Phase,
  type PendingPrompt,
  type QuestDef,
  type Tile,
  type TreasureCard,
  type HeldPotion,
  type Trap,
  type Furniture,
  type Winner,
  STATE_VERSION,
  DIE_FACES,
} from './types';
import {
  HERO_DEFAULTS,
  QUESTS,
  buildTreasureDeck,
  instantiateMonster,
  makeHero,
  spellsByElement,
} from './content';

// ============================================================================
// State factory / lifecycle
// ============================================================================

export function initialState(): HQState {
  const quest = QUESTS.the_trial;
  // Always 4 hero slots, one per class. playerId starts empty — players
  // claim slots in the lobby; start_game auto-fills any leftover slots by
  // cycling through claimed players.
  const fourClasses: HeroClass[] = ['barbarian', 'dwarf', 'elf', 'wizard'];
  const heroes: Hero[] = fourClasses.map((klass, seat) =>
    makeHero('', '', seat, klass, quest.startCells[seat] ?? quest.startCells[0]),
  );
  const s: HQState = {
    version: STATE_VERSION,
    phase: 'lobby',
    questId: quest.id,
    quest,
    tiles: stampTiles(quest),
    doors: quest.doors.map(d => ({ ...d, open: false, found: !d.secret })),
    furniture: quest.furniture.map(f => ({ ...f, searched: false })),
    traps: quest.traps.map(t => ({ ...t, triggered: false, revealed: false })),
    monsters: [],   // monsters appear when rooms reveal
    heroes,
    turnIndex: 0,
    treasureDeck: shuffle(buildTreasureDeck()),
    treasureDiscard: [],
    log: [],
    logSeq: 0,
    lastRoll: null,
    lastDefenseRoll: null,
    lastMoveRoll: null,
    pendingPrompt: null,
    winner: null,
  };
  // Seed wizard/elf spells immediately (heroes exist on day 1 now).
  assignSpellsToCasters(s);
  return s;
}

function stampTiles(quest: QuestDef): Tile[][] {
  return quest.tiles.map((row, y) =>
    row.map((kind, x) => ({
      kind,
      region: quest.regions[y][x] ?? '',
      revealed: false,
    })),
  );
}

/** Adapter for the registry's "createInitialStateForHost". The host is seated
    as the first hero (class unset until they pick or use random_classes). */
export function createInitialStateForHost(host: {
  userId: string;
  username: string;
  accent_color?: string;
}): HQState {
  const state = initialState();
  return addPlayer(state, host.userId, host.username, 0, host.accent_color);
}

export function addPlayer(
  state: HQState,
  playerId: string,
  username: string,
  seat: number,
  accent_color?: string,
): HQState {
  if (state.phase !== 'lobby') return state;
  if (state.heroes.some(h => h.playerId === playerId)) return state;  // idempotent
  const s = clone(state);
  // Claim the first unowned hero slot in seat order. (Note: the seat arg
  // passed in from the room is the joiner's room-seat, but HeroQuest's hero
  // slots are 0..3 and decoupled from room seats — we always fill 0→3.)
  void seat;
  const free = s.heroes.find(h => !h.playerId);
  if (free) {
    free.playerId = playerId;
    free.username = username;
    free.accent_color = accent_color;
  }
  return s;
}

export function removePlayer(state: HQState, playerId: string): HQState {
  if (state.phase !== 'lobby') return state;
  const s = clone(state);
  // Clear the slot but keep the hero so the party stays at 4. The empty
  // slot will be auto-filled at start_game by cycling through claimed
  // players (or another joiner before then).
  for (const h of s.heroes) {
    if (h.playerId === playerId) {
      h.playerId = '';
      h.username = '';
      h.accent_color = undefined;
    }
  }
  return s;
}

/** A player claims a specific hero slot (by seat 0..3). If they already
    control another slot it becomes unclaimed (one primary hero per player
    in the lobby; auto-fill at start_game may give them more). */
function doClaimHero(state: HQState, playerId: string, seat: number): ApplyResult {
  if (state.phase !== 'lobby') return err('Cannot change heroes after the quest starts.');
  const target = state.heroes.find(h => h.seat === seat);
  if (!target) return err('No such hero slot.');
  // Find the joining player's existing slot (if any) to preserve their identity.
  const existing = state.heroes.find(h => h.playerId === playerId);
  if (!existing) return err('You are not seated in this room.');
  if (target.seat === existing.seat) return ok(state);  // already there
  const s = clone(state);
  const newTarget = s.heroes.find(h => h.seat === seat)!;
  const newExisting = s.heroes.find(h => h.seat === existing.seat)!;
  // Swap identities — if the target slot was held by another player, that
  // player becomes a "co-owner" via auto-fill at start; we DON'T evict them.
  if (newTarget.playerId && newTarget.playerId !== playerId) {
    // Swap the two players: each takes the other's slot.
    const tmp = { id: newTarget.playerId, name: newTarget.username, color: newTarget.accent_color };
    newTarget.playerId = newExisting.playerId;
    newTarget.username = newExisting.username;
    newTarget.accent_color = newExisting.accent_color;
    newExisting.playerId = tmp.id;
    newExisting.username = tmp.name;
    newExisting.accent_color = tmp.color;
  } else {
    // Empty target → just move me over and release my old slot.
    newTarget.playerId = newExisting.playerId;
    newTarget.username = newExisting.username;
    newTarget.accent_color = newExisting.accent_color;
    newExisting.playerId = '';
    newExisting.username = '';
    newExisting.accent_color = undefined;
  }
  return ok(s);
}

/** Assign 9 spells (3 groups of 3) to the wizard and 3 (1 group) to the elf
    so all 12 cards are dealt and no group is duplicated. */
function assignSpellsToCasters(s: HQState): void {
  const elf = s.heroes.find(h => h.klass === 'elf');
  const wiz = s.heroes.find(h => h.klass === 'wizard');
  if (!elf && !wiz) return;
  const groups = spellsByElement();
  const order: Array<keyof typeof groups> = ['air', 'water', 'fire', 'earth'];
  // Elf gets one group (default: air); wizard gets the other three.
  const elfGroup = order[0];
  const wizardGroups = order.slice(1);
  if (elf) {
    elf.spells = groups[elfGroup].map(sp => ({ ...sp }));
    elf.spellsCast = [];
  }
  if (wiz) {
    wiz.spells = wizardGroups.flatMap(g => groups[g].map(sp => ({ ...sp })));
    wiz.spellsCast = [];
  }
}

// ============================================================================
// Registry adapters
// ============================================================================

export function getActivePlayerId(state: HQState): string | null {
  if (state.phase !== 'heroes') return null;
  const h = state.heroes[state.turnIndex];
  return h?.playerId || null;   // '' (unclaimed) collapses to null
}

export function getOrderedPlayerIds(state: HQState): string[] {
  // Distinct claimed player IDs in seat order. With fewer than 4 players,
  // some heroes share a controller — the roster only lists each human once.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of state.heroes) {
    if (h.playerId && !seen.has(h.playerId)) {
      seen.add(h.playerId);
      out.push(h.playerId);
    }
  }
  return out;
}

export function computeHistory(state: HQState): { winnerId: string | null; playerIds: string[] } | null {
  if (state.phase !== 'finished') return null;
  // "Winner" semantics for HeroQuest: heroes win → first claimed player is
  // recorded as the winnerId (representative; the whole party "won"). Zargon
  // win → null (no human "won").
  const playerIds = getOrderedPlayerIds(state);
  if (state.winner === 'heroes') {
    return { winnerId: playerIds[0] ?? null, playerIds };
  }
  return { winnerId: null, playerIds };
}

// Per-viewer projection: nothing private to hide in HeroQuest v1 (no hidden
// hands). Reveal mechanic is server-enforced (monsters/furniture/traps only
// appear in state once the room is revealed), so projecting is a passthrough.
export function projectStateForViewer(state: HQState, _viewerId: string | null): HQState {
  return state;
}

// ============================================================================
// Apply action
// ============================================================================

export function applyAction(
  state: HQState,
  playerId: string,
  action: HQAction,
): ApplyResult {
  // Lobby actions
  if (action.kind === 'claim_hero') {
    return doClaimHero(state, playerId, action.seat);
  }
  if (action.kind === 'set_class') {
    // Back-compat shim: translate "I want Wizard" to "I want seat 3".
    if (state.phase !== 'lobby') return err('Cannot change heroes after the quest starts.');
    const target = state.heroes.find(h => h.klass === action.classKlass);
    if (!target) return err('No such hero class.');
    return doClaimHero(state, playerId, target.seat);
  }
  if (action.kind === 'random_classes') {
    if (state.phase !== 'lobby') return err('Cannot reshuffle heroes after the quest starts.');
    // Shuffle PLAYER assignments across the 4 fixed hero slots — the classes
    // themselves stay locked to the seats (barbarian@0 / dwarf@1 / elf@2 /
    // wizard@3) so the engine's caster detection stays stable.
    const claimed = state.heroes
      .filter(h => h.playerId)
      .map(h => ({ playerId: h.playerId, username: h.username, accent_color: h.accent_color }));
    if (claimed.length === 0) return ok(state);
    const s = clone(state);
    // Clear all claims, then reassign claimed players to random seats.
    for (const h of s.heroes) {
      h.playerId = '';
      h.username = '';
      h.accent_color = undefined;
    }
    const seats = [0, 1, 2, 3];
    shuffleInPlace(seats);
    claimed.forEach((p, i) => {
      const slot = s.heroes.find(h => h.seat === seats[i]);
      if (slot) {
        slot.playerId = p.playerId;
        slot.username = p.username;
        slot.accent_color = p.accent_color;
      }
    });
    return ok(s);
  }
  if (action.kind === 'start_game') {
    if (state.phase !== 'lobby') return err('Quest already underway.');
    const claimed = state.heroes.filter(h => h.playerId);
    if (claimed.length < 1) return err('Need at least one player to start the quest.');
    // Rebuild from a FRESH initialState so the quest content always reflects the
    // current code. A room's lobby state snapshots the quest when the room is
    // created, so a room made before a quest update would otherwise start with
    // stale content. We carry over who claimed each hero slot (seat → class is
    // fixed), then proceed exactly as before.
    const s = initialState();
    state.heroes.forEach((old, i) => {
      if (!s.heroes[i]) return;
      s.heroes[i].playerId    = old.playerId;
      s.heroes[i].username    = old.username;
      s.heroes[i].accent_color = old.accent_color;
      // Potions are persistent between quests — carry them over to the new quest.
      if (old.foundPotions?.length) s.heroes[i].foundPotions = [...old.foundPotions];
    });
    // Auto-fill any unclaimed hero slots by cycling through claimed players.
    // With 1 player → that player owns all 4. With 2 players → round-robin
    // gives 2 heroes each. With 3 → 2/1/1. With 4 → 1/1/1/1 (no change).
    const claimers = s.heroes.filter(h => h.playerId);
    let cursor = 0;
    for (const slot of s.heroes) {
      if (!slot.playerId) {
        const giver = claimers[cursor % claimers.length];
        slot.playerId = giver.playerId;
        slot.username = giver.username;
        slot.accent_color = giver.accent_color;
        cursor += 1;
      }
    }
    s.phase = 'heroes';
    s.turnIndex = 0;
    // Reveal LOS from each hero's starting cell so the entry corridor lights up.
    for (const h of s.heroes) revealLineOfSightForHero(s, h);
    pushLog(s, 'system', `Quest "${s.quest.name}" begins.`);
    pushLog(s, 'system', s.quest.briefing);
    pushLog(s, 'system', `It is ${heroLabel(s.heroes[0])}'s turn.`);
    return ok(s);
  }

  // Zargon's turn advances one monster at a time. Any client may request a step
  // (the host drives it on a timer); it's a no-op unless it's Zargon's phase.
  if (action.kind === 'zargon_step') return doZargonStep(state);

  // Mid-game gating: only the active player can act.
  if (state.phase !== 'heroes') return err('Wait for the engine to finish.');
  const hero = state.heroes[state.turnIndex];
  if (!hero) return err('No active hero.');
  if (hero.playerId !== playerId) return err('It is not your turn.');
  if (hero.body <= 0) return err('You are dead.');

  if (action.kind === 'roll_move') return doRollMove(state, hero);
  if (action.kind === 'move_to')   return doMoveTo(state, hero, action.at);
  if (action.kind === 'move_path') return doMovePath(state, hero, action.path);
  if (action.kind === 'open_door') return doOpenDoor(state, hero, action.doorId);
  if (action.kind === 'attack')    return doAttack(state, hero, action.monsterId);
  if (action.kind === 'search_treasure') return doSearchTreasure(state, hero);
  if (action.kind === 'search_traps')    return doSearchTraps(state, hero);
  if (action.kind === 'search_secrets')  return doSearchSecrets(state, hero);
  if (action.kind === 'disarm_trap')     return doDisarmTrap(state, hero, action.trapId);
  if (action.kind === 'jump_trap')       return doJumpTrap(state, hero, action.trapId);
  if (action.kind === 'climb_pit')       return doClimbPit(state, hero);
  if (action.kind === 'cast_spell')      return doCastSpell(state, hero, action);
  if (action.kind === 'use_potion')      return doUsePotion(state, hero, action.potionId);
  if (action.kind === 'pass_potion')     return doPassPotion(state, hero, action.potionId, action.toHeroSeat);
  if (action.kind === 'end_turn')        return doEndTurn(state, hero);

  return err('Unknown action.');
}

function rebuildHeroAsClass(hero: Hero, klass: HeroClass, start: Coord): void {
  const d = HERO_DEFAULTS[klass];
  hero.klass = klass;
  hero.bodyMax = d.bodyMax;
  hero.mindMax = d.mindMax;
  hero.body = d.bodyMax;
  hero.mind = d.mindMax;
  hero.items = d.startingItems.map(i => ({ ...i }));
  let attack = d.baseAttack;
  let defense = d.baseDefense;
  for (const it of hero.items) {
    if (it.attack && it.attack > attack) attack = it.attack;
    if (it.defense) defense += it.defense;
  }
  hero.attack = attack;
  hero.defense = defense;
  hero.at = { ...start };
  hero.spells = [];
  hero.spellsCast = [];
}

// ============================================================================
// Hero actions
// ============================================================================

function doRollMove(state: HQState, hero: Hero): ApplyResult {
  if (hero.hasRolled) return err('You already rolled movement this turn.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  // Movement is 3d4 (range 3–12, centred on ~7–8) — replaces the old 2d6.
  const d1 = 1 + Math.floor(Math.random() * 4);
  const d2 = 1 + Math.floor(Math.random() * 4);
  const d3 = 1 + Math.floor(Math.random() * 4);
  const total = d1 + d2 + d3;
  h.moveRolled = total;
  h.moveLeft = total;
  h.hasRolled = true;
  s.lastMoveRoll = [d1, d2, d3];
  s.lastRoll = null;
  s.lastDefenseRoll = null;
  pushLog(s, 'move', `${heroLabel(h)} rolls ${d1}+${d2}+${d3} = ${total} squares of movement.`);
  return ok(s);
}

/** Spend the hero's one action for the turn. Movement rule: ROLLING the
 *  movement dice commits the hero to moving BEFORE acting — so once they've
 *  rolled, taking an action ends their movement (any unused squares are
 *  forfeited, whether they moved part-way or not at all). Acting BEFORE rolling
 *  leaves them free to roll + move afterwards, so act-then-move still works. */
function markActed(h: Hero, forfeitMove = true) {
  h.hasActed = true;
  // Movement-granting spells (Swift Wind, Veil of Mist) pass forfeitMove=false so
  // they can still hand out movement after the hero has rolled.
  if (forfeitMove && h.hasRolled) h.moveLeft = 0;
}

/** The set of ROOM regions that currently have at least one revealed tile. Used
 *  to detect when a hero looks into a NEW room (the moment Zargon places its
 *  monsters and the hero must stop). Corridor/wall reveals don't count. */
function revealedRoomRegions(s: HQState): Set<string> {
  const set = new Set<string>();
  for (const row of s.tiles) for (const t of row) {
    if (t.revealed && t.region.startsWith('room_')) set.add(t.region);
  }
  return set;
}

/** Walk a hero step-by-step along `path` (each square orthogonally adjacent to
 *  the previous). At EACH square: deduct 1 movement, fire any trap (which stops
 *  movement), then "look" — reveal line of sight. The walk STOPS the moment the
 *  hero springs a trap OR a new area / monster comes into view, so the player
 *  can react (this is how looking works in HeroQuest). An invalid step (not
 *  adjacent, blocked, off-board, onto a monster) also stops the walk. */
function walkPath(s: HQState, h: Hero, path: Coord[]): void {
  let from: Coord = { ...h.at };
  const isStairs = (c: Coord) => s.tiles[c.y]?.[c.x]?.kind === 'stairs';
  const sharedWithHero = (c: Coord) => s.heroes.some(o => o.seat !== h.seat && o.body > 0 && o.at.x === c.x && o.at.y === c.y);
  // You may pass OVER a friendly hero but not STOP on one (except the stairs).
  const standable = (c: Coord) => isStairs(c) || !sharedWithHero(c);
  // Track the last square the hero can legally stand on, so a walk that ends
  // while passing over a friendly snaps back there (refunding that movement).
  let lastSafe: Coord = { ...h.at };
  let spentSinceSafe = 0;
  const settle = () => {
    if (!h.inPit && !standable(h.at)) {
      h.at = { ...lastSafe };
      h.moveLeft += spentSinceSafe;
    }
  };

  for (const sq of path) {
    const adx = Math.abs(sq.x - from.x), ady = Math.abs(sq.y - from.y);
    if (adx + ady !== 1) break;                              // orthogonal single step only
    if (!inBounds(s, sq)) break;
    if (!h.phaseWalls && (!isPassable(s, sq, /*forHero*/ true) || edgeBlocksMove(s, from, sq, false))) break;
    if (s.monsters.some(m => m.at.x === sq.x && m.at.y === sq.y)) break; // monsters block

    // The 2×2 stairway is ONE logical space: moving BETWEEN stair squares is
    // free, so stepping off from the back corner costs 1, not 2. Any step that
    // leaves or enters the stairway costs 1.
    const cameFrom: Coord = { ...from };
    const cost = isStairs(cameFrom) && isStairs(sq) ? 0 : 1;
    if (cost > h.moveLeft) break;                            // can't afford this step

    const roomsBefore = revealedRoomRegions(s);
    const monstersBefore = s.monsters.length;
    h.at = { ...sq };
    h.moveLeft -= cost;
    from = { ...sq };
    spentSinceSafe += cost;

    // Trap on entry → resolve by kind (rulebook pp.17–18). Most outcomes stop the
    // hero; a *dodged* spear lets the walk continue (falls through below).
    const trap = s.traps.find(t => !t.triggered && t.at.x === sq.x && t.at.y === sq.y);
    if (trap) {
      trap.triggered = true;
      trap.revealed = true;

      if (trap.kind === 'pit') {
        // Stumble in: -1 BP, the turn ends, the hero is now in the pit.
        h.inPit = true;
        h.body = Math.max(0, h.body - 1);
        h.moveLeft = 0;
        pushLog(s, 'trap', `${heroLabel(h)} stumbles into a pit trap! (-1 BP)`);
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        settle();
        return;
      }

      if (trap.kind === 'falling_block') {
        // Roll 3 dice, -1 BP per skull, NO defence; the square is sealed forever
        // (a permanent wall) and the hero does not end on it — they fall back.
        const roll = rollDice(3, 'hero');
        s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
        h.body = Math.max(0, h.body - roll.skulls);
        s.tiles[sq.y][sq.x] = { ...s.tiles[sq.y][sq.x], kind: 'blocked', revealed: true };
        h.at = { ...cameFrom };
        h.moveLeft = 0;
        pushLog(s, 'trap',
          `${heroLabel(h)} springs a falling block! The ceiling caves in` +
          (roll.skulls > 0 ? ` (-${roll.skulls} BP)` : ' (no damage)') +
          ' — the square is sealed.');
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        return;
      }

      // Spear: roll 1 die. Any shield = dodge (no damage, keep moving); a skull =
      // struck (-1 BP, turn ends). One-time either way (already marked triggered).
      const roll = rollDice(1, 'hero');
      s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
      if (roll.faces[0] === 'skull') {
        h.body = Math.max(0, h.body - 1);
        h.moveLeft = 0;
        pushLog(s, 'trap', `${heroLabel(h)} is struck by a spear trap! (-1 BP)`);
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        settle();
        return;
      }
      pushLog(s, 'trap', `${heroLabel(h)} dodges a spear trap — it snaps shut, harmless.`);
      // fall through: the dodge counts as a normal step and the walk continues.
    }

    // Look from the new square.
    revealLineOfSightForHero(s, h);
    if (standable(sq)) { lastSafe = { ...sq }; spentSinceSafe = 0; }
    // Stop if a NEW room comes into view (its monsters are placed) or monsters
    // otherwise appear — so the player can react.
    if (revealedRoomRegions(s).size > roomsBefore.size || s.monsters.length > monstersBefore) {
      pushLog(s, 'reveal', `${heroLabel(h)} rounds the corner — a new area comes into view.`);
      settle();
      return;
    }
  }
  settle();
}

function doMoveTo(state: HQState, hero: Hero, dest: Coord): ApplyResult {
  if (!hero.hasRolled) return err('Roll movement first.');
  if (hero.moveLeft <= 0) return err('No movement left.');
  if (hero.inPit) return err('You are in a pit — climb out first.');
  if (!inBounds(state, dest)) return err('Off the board.');
  if (dest.x === hero.at.x && dest.y === hero.at.y) return err('You are already there.');

  const destIsStairs = state.tiles[dest.y][dest.x].kind === 'stairs';
  if (state.monsters.some(m => m.at.x === dest.x && m.at.y === dest.y)) {
    return err('You cannot end your move on a monster.');
  }
  if (!destIsStairs && state.heroes.some(o => o !== hero && o.body > 0 && o.at.x === dest.x && o.at.y === dest.y)) {
    return err('You may pass over a hero but not stop on their square.');
  }
  if (!hero.phaseWalls && !isPassable(state, dest, /*forHero*/ true)) {
    return err('That square is blocked.');
  }

  const path = findPath(state, hero, dest);
  if (!path) return err('There is no clear path there (no diagonals; rooms are entered only through doors).');
  if (pathCost(state, hero.at, path) > hero.moveLeft) return err('That square is out of reach.');

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  const before = h.moveLeft;
  walkPath(s, h, path);
  logMovement(s, h, before);
  if (s.tiles[h.at.y][h.at.x].kind === 'stairs') maybeFinishOnExit(s);
  return ok(s);
}

/** Drag movement: the player traces an explicit square-by-square path. The walk
 *  follows it but stops early on a trap or a new reveal (see walkPath). */
function doMovePath(state: HQState, hero: Hero, path: Coord[]): ApplyResult {
  if (!hero.hasRolled) return err('Roll movement first.');
  if (hero.moveLeft <= 0) return err('No movement left.');
  if (hero.inPit) return err('You are in a pit — climb out first.');
  if (!Array.isArray(path) || path.length === 0) return err('No path to walk.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  const before = h.moveLeft;
  walkPath(s, h, path); // walkPath snaps off a shared final square itself
  logMovement(s, h, before);
  if (s.tiles[h.at.y][h.at.x].kind === 'stairs') maybeFinishOnExit(s);
  return ok(s);
}

/** Record a completed move in the chronicle: how far the hero actually walked
 *  (walkPath may stop short on a trap or a fresh reveal) and where they ended
 *  up. Keeps the log a faithful record of every move, not just the dice roll. */
function logMovement(s: HQState, h: Hero, moveLeftBefore: number): void {
  const used = moveLeftBefore - h.moveLeft;
  if (used <= 0) return;
  const region = s.tiles[h.at.y]?.[h.at.x]?.region ?? '';
  const where = s.tiles[h.at.y]?.[h.at.x]?.kind === 'stairs' ? ' onto the stairway'
    : region.startsWith('room_') ? ' into the chamber'
    : ' along the passage';
  pushLog(s, 'move', `${heroLabel(h)} moves ${used} square${used > 1 ? 's' : ''}${where}.`);
}

/** Movement cost of walking `path` starting from `start`. The 2×2 stairway is
 *  one logical space, so any step between two stair squares is free; every other
 *  step costs 1. (Matches walkPath's per-step cost.) */
function pathCost(s: HQState, start: Coord, path: Coord[]): number {
  const isStairs = (c: Coord) => s.tiles[c.y]?.[c.x]?.kind === 'stairs';
  let prev = start, total = 0;
  for (const c of path) { total += isStairs(prev) && isStairs(c) ? 0 : 1; prev = c; }
  return total;
}

/** Shortest orthogonal path (list of squares to ENTER, ending at dest) from the
 *  hero to dest. Passes THROUGH friendly heroes; blocked by monsters, walls,
 *  blocked tiles, move-blocking furniture, and closed doors (unless phasing).
 *  Returns null if dest is unreachable. */
function findPath(s: HQState, hero: Hero, dest: Coord): Coord[] | null {
  const startKey = `${hero.at.x},${hero.at.y}`;
  const destKey = `${dest.x},${dest.y}`;
  if (startKey === destKey) return [];
  const prev = new Map<string, Coord>();
  const visited = new Set<string>([startKey]);
  const queue: Coord[] = [{ ...hero.at }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of adjacentCells(cur)) {
      const key = `${n.x},${n.y}`;
      if (visited.has(key)) continue;
      if (!inBounds(s, n)) continue;
      if (!hero.phaseWalls && !isPassable(s, n, /*forHero*/ true)) continue;
      if (edgeBlocksMove(s, cur, n, !!hero.phaseWalls)) continue;
      if (s.monsters.some(m => m.at.x === n.x && m.at.y === n.y)) continue; // monsters block
      visited.add(key);
      prev.set(key, cur);
      if (key === destKey) {
        const path: Coord[] = [];
        let c: Coord | undefined = n;
        while (c && `${c.x},${c.y}` !== startKey) { path.push(c); c = prev.get(`${c.x},${c.y}`); }
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

function doOpenDoor(state: HQState, hero: Hero, doorId: string): ApplyResult {
  const door = state.doors.find(d => d.id === doorId);
  if (!door) return err('Door not found.');
  if (door.open) return err('Already open.');
  if (door.secret && !door.found) return err('There is no visible door there.');
  // The hero must be standing on one of the door's cells (i.e. right at the
  // doorway, on either side of the opening).
  const doorCells = door.crossings.flatMap(c => [c.a, c.b]);
  const atDoorway = doorCells.some(c => c.x === hero.at.x && c.y === hero.at.y);
  if (!atDoorway) return err('You must be in the doorway to open it.');

  const s = clone(state);
  const d = s.doors.find(dx => dx.id === doorId)!;
  d.open = true;
  // Reveal the room(s) the door opens into, spawning their monsters.
  for (const c of d.crossings) {
    for (const cell of [c.a, c.b]) {
      const r = s.tiles[cell.y]?.[cell.x]?.region ?? '';
      if (r.startsWith('room_')) { revealRegion(s, r); spawnRoomMonsters(s, r); }
    }
  }
  revealLineOfSightForHero(s, s.heroes[s.turnIndex]);
  pushLog(s, 'reveal', `${heroLabel(hero)} opens a door — the chamber beyond is revealed!`);
  return ok(s);
}

function doAttack(state: HQState, hero: Hero, monsterId: string): ApplyResult {
  // Courage grants one bonus attack even after the action is spent.
  const usingExtraAttack = hero.hasActed && !!hero.extraAttack;
  if (hero.hasActed && !usingExtraAttack) return err('You have already taken your action this turn.');
  const mon = state.monsters.find(m => m.id === monsterId);
  if (!mon) return err('Target not found.');
  // Adjacency / range check (v1: simple adjacency; diagonal allowed if any
  // equipped weapon has diagonal=true).
  const allowDiag = hero.items.some(i => i.diagonal);
  const allowRanged = hero.items.some(i => i.ranged);
  const dx = Math.abs(mon.at.x - hero.at.x);
  const dy = Math.abs(mon.at.y - hero.at.y);
  const adj = dx + dy === 1 || (allowDiag && dx === 1 && dy === 1);
  const ranged = allowRanged && hasLineOfSight(state, hero.at, mon.at);
  if (!adj && !ranged) return err('Target is out of reach.');

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  const m = s.monsters.find(mm => mm.id === monsterId)!;
  // Attack roll — Courage + Potion of Strength add bonus dice; fighting from
  // a pit costs one die (min 1, rulebook p.17).
  const spellBonus  = h.attackBonus    ?? 0;  // Courage spell (expires after this attack)
  const potionBonus = h.potionAtkBonus ?? 0;  // Potion of Strength (expires after this attack)
  const bonus = spellBonus + potionBonus;
  const atk = rollDice(Math.max(1, h.attack + bonus - (h.inPit ? 1 : 0)), 'hero');
  s.lastRoll = atk;
  s.lastMoveRoll = null;
  // Defense roll.
  const def = rollDice(m.defense, 'monster');
  s.lastDefenseRoll = def;
  const damage = Math.max(0, atk.skulls - def.blocks);
  m.body -= damage;
  const bonusNote = spellBonus > 0 && potionBonus > 0
    ? ` (Courage +${spellBonus}, Strength potion +${potionBonus} dice)`
    : spellBonus > 0 ? ` (Courage +${spellBonus} dice)`
    : potionBonus > 0 ? ` (Strength potion +${potionBonus} dice)` : '';
  pushLog(s, 'combat',
    `${heroLabel(h)} attacks ${monsterDisplay(m)} — ${atk.skulls} skulls vs ${def.blocks} blocks${bonusNote}. ` +
    (damage > 0 ? `${monsterDisplay(m)} takes ${damage} BP.` : 'No damage.'),
  );
  if (m.body <= 0) {
    pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
    if (m.gold) {
      h.gold += m.gold;
      pushLog(s, 'system', `${heroLabel(h)} loots ${m.gold} gold from the fallen ${monsterDisplay(m)}.`);
    }
    s.monsters = s.monsters.filter(mm => mm.id !== m.id);
  }
  // Both attack bonuses are consumed on this strike. If this was the free
  // Heroic Brew / Courage extra attack, consume that flag too; otherwise it
  // is the hero's normal action for the turn.
  h.attackBonus    = 0;
  h.potionAtkBonus = 0;
  if (usingExtraAttack) h.extraAttack = false;
  else markActed(h);
  // Check win condition (kill the named monster).
  maybeFinishOnKill(s, m);
  return ok(s);
}

function doSearchTreasure(state: HQState, hero: Hero): ApplyResult {
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const room = state.tiles[hero.at.y][hero.at.x].region;
  if (!room.startsWith('room_')) return err('You can only search for treasure while inside a room.');
  if (hero.searchedRooms.includes(room)) return err('You have already searched this room for treasure.');
  // Treasure can only be searched in a room with no monsters IN it (rulebook
  // p.15) — unlike trap/secret-door searches, monsters merely visible down a
  // corridor don't block looting a cleared room.
  // Check both tile-region (normal monsters) AND roomId (wandering monsters that
  // spawned in an adjacent corridor tile but logically belong to this room).
  if (state.monsters.some(m =>
    state.tiles[m.at.y]?.[m.at.x]?.region === room || m.roomId === room,
  )) {
    return err('You cannot search a room for treasure while monsters are in it.');
  }

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.searchedRooms.push(room);
  // NOTE: markActed is called per-case in resolveTreasureCard (and below for
  // fixed content). Wandering Monster is the ONLY card that does NOT end the
  // hero's action — the rulebook is explicit: the monster "attacks immediately"
  // but the hero's turn continues.

  // Quest-defined fixed content overrides the deck for the FIRST hero to search.
  const fixedFurn = s.furniture.find(f =>
    !f.searched
    && f.fixedContent
    && f.cells.some(c => s.tiles[c.y]?.[c.x]?.region === room),
  );
  if (fixedFurn) {
    fixedFurn.searched = true;
    markActed(h); // fixed content always ends the turn
    if (fixedFurn.fixedContent!.kind === 'gold') {
      h.gold += fixedFurn.fixedContent!.amount;
      pushLog(s, 'search', `${heroLabel(h)} searches the ${fixedFurn.kind} and finds ${fixedFurn.fixedContent!.amount} gold!`);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'fixed', label: `${fixedFurn.fixedContent!.amount} Gold!`, subtitle: 'From the chest', isGood: true };
    } else if (fixedFurn.fixedContent!.kind === 'nothing') {
      pushLog(s, 'search', `${heroLabel(h)} searches the ${fixedFurn.kind}: ${(fixedFurn.fixedContent as { flavor: string }).flavor}`);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'fixed', label: 'Empty!', subtitle: (fixedFurn.fixedContent as { flavor: string }).flavor, isGood: false };
    } else if (fixedFurn.fixedContent!.kind === 'item') {
      pushLog(s, 'search', `${heroLabel(h)} finds an item: ${fixedFurn.fixedContent!.itemId}.`);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'fixed', label: 'Item Found!', isGood: true };
    }
    return ok(s);
  }
  // Otherwise draw a treasure card.
  const card = drawTreasureCard(s);
  if (!card) {
    markActed(h);
    pushLog(s, 'search', `${heroLabel(h)} finds nothing of value (deck exhausted).`);
    return ok(s);
  }
  resolveTreasureCard(s, h, card); // handles markActed and lastTreasureFx internally
  return ok(s);
}

function doUsePotion(state: HQState, hero: Hero, potionId: string): ApplyResult {
  if (hero.body <= 0) return err('A dead hero cannot drink potions.');
  const potion = hero.foundPotions?.find(p => p.id === potionId);
  if (!potion) return err('You do not have that potion.');

  // Heroic Brew must be drunk BEFORE attacking (rulebook: "before you attack").
  // Once the hero has taken their action (hasActed), it's too late.
  if (potion.effect === 'brew' && hero.hasActed) {
    return err('Heroic Brew must be drunk before you attack.');
  }

  const s = clone(state);
  const h = s.heroes[s.turnIndex];

  // Remove from pack — potions are one-shot.
  h.foundPotions = h.foundPotions.filter(p => p.id !== potionId);

  switch (potion.effect) {
    case 'brew':
      // Grants an extra attack: first attack is the hero's action; second uses
      // the extraAttack flag (same mechanic as the Courage spell).
      h.extraAttack = true;
      pushLog(s, 'search', `${heroLabel(h)} drinks the Heroic Brew — two attacks this turn!`);
      break;
    case 'defense':
      h.potionDefBonus = (h.potionDefBonus ?? 0) + 2;
      pushLog(s, 'search', `${heroLabel(h)} drinks a Potion of Defense — +2 defense dice until the next hit!`);
      break;
    case 'strength':
      h.potionAtkBonus = (h.potionAtkBonus ?? 0) + 2;
      pushLog(s, 'search', `${heroLabel(h)} drinks a Potion of Strength — +2 attack dice for the next strike!`);
      break;
    case 'heal_d6': {
      const roll = 1 + Math.floor(Math.random() * 6);
      const restored = Math.min(h.bodyMax - h.body, roll);
      h.body += restored;
      pushLog(s, 'search',
        `${heroLabel(h)} drinks a Potion of Healing — rolled a ${roll}, restored ${restored} BP!`,
      );
      break;
    }
  }
  // Drinking a potion does NOT consume the hero's action.
  return ok(s);
}

/** Pass a held potion from the active hero to an adjacent living hero.
 *  Rulebook: potions may be passed between adjacent heroes as a free action
 *  (does NOT call markActed) on the passer's turn, provided no monster is
 *  orthogonally adjacent to either the passer or the receiver. */
function doPassPotion(state: HQState, hero: Hero, potionId: string, toHeroSeat: number): ApplyResult {
  const potion = hero.foundPotions?.find(p => p.id === potionId);
  if (!potion) return err('You do not have that potion.');

  const receiver = state.heroes.find(h => h.seat === toHeroSeat);
  if (!receiver || receiver.seat === hero.seat) return err('Invalid target hero.');
  if (receiver.body <= 0) return err('Cannot pass to a dead hero.');

  // Must be orthogonally adjacent (no diagonals).
  const dist = Math.abs(receiver.at.x - hero.at.x) + Math.abs(receiver.at.y - hero.at.y);
  if (dist !== 1) return err('You can only pass a potion to an adjacent hero.');

  // No monster may be orthogonally adjacent to the passer.
  const adjToPasser = state.monsters.some(m => m.body > 0 &&
    Math.abs(m.at.x - hero.at.x) + Math.abs(m.at.y - hero.at.y) === 1,
  );
  if (adjToPasser) return err('You cannot pass while a monster is adjacent to you.');

  // No monster may be orthogonally adjacent to the receiver.
  const adjToReceiver = state.monsters.some(m => m.body > 0 &&
    Math.abs(m.at.x - receiver.at.x) + Math.abs(m.at.y - receiver.at.y) === 1,
  );
  if (adjToReceiver) return err(`Cannot pass — a monster is adjacent to ${receiver.username}.`);

  const s = clone(state);
  const h = s.heroes[s.turnIndex];                              // passer (the active hero)
  const r = s.heroes.find(x => x.seat === toHeroSeat)!;        // receiver

  h.foundPotions = h.foundPotions.filter(p => p.id !== potionId);
  if (!r.foundPotions) r.foundPotions = [];
  r.foundPotions.push({ ...potion });

  pushLog(s, 'search', `${heroLabel(h)} passes the ${potion.name} to ${heroLabel(r)}.`);
  // Passing is a free action — does NOT consume the hero's turn action.
  return ok(s);
}

function doSearchTraps(state: HQState, hero: Hero): ApplyResult {
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const region = state.tiles[hero.at.y][hero.at.x].region;
  if (!region) return err('Invalid location.');
  if (hero.searchedTraps.includes(region)) return err('You have already searched this area for traps.');
  if (monstersVisibleToHero(state, hero).length > 0) return err('You cannot search while monsters are in sight.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.searchedTraps.push(region);
  markActed(h);
  let found = 0;
  for (const t of s.traps) {
    if (t.revealed || t.triggered) continue;
    const tRegion = s.tiles[t.at.y]?.[t.at.x]?.region;
    if (tRegion === region) { t.revealed = true; found += 1; }
  }
  pushLog(s, 'search', found > 0
    ? `${heroLabel(h)} searches for traps and uncovers ${found}!`
    : `${heroLabel(h)} searches for traps but finds none.`,
  );
  return ok(s);
}

function doSearchSecrets(state: HQState, hero: Hero): ApplyResult {
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const region = state.tiles[hero.at.y][hero.at.x].region;
  if (!region) return err('Invalid location.');
  if (hero.searchedSecrets.includes(region)) return err('You have already searched this area for secret doors.');
  if (monstersVisibleToHero(state, hero).length > 0) return err('You cannot search while monsters are in sight.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.searchedSecrets.push(region);
  markActed(h);
  let found = 0;
  for (const d of s.doors) {
    if (!d.secret || d.found) continue;
    // A secret door is found if either side of any of its crossings is in the
    // searched region.
    const inRegion = d.crossings.some(c =>
      regionOf(s, c.a) === region || regionOf(s, c.b) === region);
    if (inRegion) { d.found = true; found += 1; }
  }
  pushLog(s, 'search', found > 0
    ? `${heroLabel(h)} discovers ${found} secret door${found > 1 ? 's' : ''}!`
    : `${heroLabel(h)} searches for secret doors but finds none.`,
  );
  return ok(s);
}

function doDisarmTrap(state: HQState, hero: Hero, trapId: string): ApplyResult {
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const trap = state.traps.find(t => t.id === trapId);
  if (!trap) return err('Trap not found.');
  if (!trap.revealed) return err('You don\'t know that trap is there.');
  if (trap.triggered) return err('That trap has already been triggered.');
  const dx = Math.abs(hero.at.x - trap.at.x);
  const dy = Math.abs(hero.at.y - trap.at.y);
  if (dx + dy !== 1) return err('You must be adjacent to the trap.');
  const hasToolKit = hero.items.some(i => i.id === 'tool_kit');
  if (!hasToolKit && hero.klass !== 'dwarf') return err('You need a Dwarf or a Tool Kit to disarm.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  markActed(h);
  // Roll one die (rulebook pp.19–20). The Dwarf is far better: only a black
  // shield springs the trap (~83% success). Everyone else needs a Tool Kit and
  // succeeds on a shield, failing on a skull (~50%).
  const roll = rollDice(1, 'hero');
  s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
  const sprung = h.klass === 'dwarf'
    ? roll.faces[0] === 'black_shield'
    : roll.faces[0] === 'skull';
  const t = s.traps.find(tt => tt.id === trapId)!;
  t.triggered = true;
  if (sprung) {
    h.body = Math.max(0, h.body - 1);
    pushLog(s, 'trap', `${heroLabel(h)} fumbles the disarm — the ${t.kind} trap triggers! (-1 BP)`);
    checkHeroDeath(s, h);
  } else {
    pushLog(s, 'trap', `${heroLabel(h)} carefully disarms the ${t.kind} trap.`);
  }
  return ok(s);
}

/** Jump over a discovered trap (rulebook p.19). Part of movement — NOT one of
 *  the six actions, so it never marks the hero as having acted. Needs >=2
 *  movement and a clear landing square directly beyond the trap. Roll 1 die: a
 *  shield clears it (spend 2 squares, the trap stays for later); a skull springs
 *  it. A sprung PIT can still be jumped; a sprung falling block cannot. */
function doJumpTrap(state: HQState, hero: Hero, trapId: string): ApplyResult {
  if (!hero.hasRolled) return err('Roll movement first.');
  if (hero.inPit) return err('You are in a pit — climb out first.');
  if (hero.moveLeft < 2) return err('Jumping a trap needs at least 2 squares of movement.');
  const trap = state.traps.find(t => t.id === trapId);
  if (!trap) return err('Trap not found.');
  if (!trap.revealed) return err('You can only jump a trap you have discovered.');
  if (trap.triggered && trap.kind !== 'pit') return err('That trap can no longer be jumped.');
  // Must stand orthogonally next to the trap; the landing is the square directly
  // beyond it, in line.
  const dx = trap.at.x - hero.at.x, dy = trap.at.y - hero.at.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return err('You must be next to the trap to jump it.');
  const land: Coord = { x: trap.at.x + dx, y: trap.at.y + dy };
  if (!inBounds(state, land)) return err('There is nowhere to land beyond the trap.');
  if (!isPassable(state, land, /*forHero*/ true)) return err('The landing square is blocked.');
  if (edgeBlocksMove(state, hero.at, trap.at, false) || edgeBlocksMove(state, trap.at, land, false)) {
    return err('A wall blocks the jump.');
  }
  if (state.monsters.some(m => m.at.x === land.x && m.at.y === land.y)) {
    return err('A monster occupies the landing square.');
  }
  const landIsStairs = state.tiles[land.y][land.x].kind === 'stairs';
  if (!landIsStairs && state.heroes.some(o => o !== hero && o.body > 0 && o.at.x === land.x && o.at.y === land.y)) {
    return err('A hero occupies the landing square.');
  }

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  const t = s.traps.find(tt => tt.id === trapId)!;
  const cameFrom: Coord = { ...h.at };
  const kindName = t.kind.replace('_', ' ');
  // Roll one die — a shield clears it, a skull springs it.
  const roll = rollDice(1, 'hero');
  s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
  if (roll.faces[0] !== 'skull') {
    h.at = { ...land };
    h.moveLeft -= 2;
    pushLog(s, 'trap', `${heroLabel(h)} leaps clear over the ${kindName} trap!`);
    revealLineOfSightForHero(s, h);
    if (s.tiles[h.at.y][h.at.x].kind === 'stairs') maybeFinishOnExit(s);
    return ok(s);
  }
  // Failed leap → the trap springs.
  t.triggered = true;
  t.revealed = true;
  if (t.kind === 'pit') {
    h.at = { ...t.at };
    h.inPit = true;
    h.body = Math.max(0, h.body - 1);
    pushLog(s, 'trap', `${heroLabel(h)} misjudges the leap and drops into the pit! (-1 BP)`);
  } else if (t.kind === 'falling_block') {
    const fb = rollDice(3, 'hero');
    h.body = Math.max(0, h.body - fb.skulls);
    s.tiles[t.at.y][t.at.x] = { ...s.tiles[t.at.y][t.at.x], kind: 'blocked', revealed: true };
    h.at = { ...cameFrom };
    pushLog(s, 'trap',
      `${heroLabel(h)} triggers the falling block mid-leap!` +
      (fb.skulls > 0 ? ` (-${fb.skulls} BP)` : ' (no damage)') + ' The square is sealed.');
  } else {
    h.at = { ...t.at };
    h.body = Math.max(0, h.body - 1);
    pushLog(s, 'trap', `${heroLabel(h)} is struck by the spear mid-leap! (-1 BP)`);
  }
  h.moveLeft = 0;
  checkHeroDeath(s, h);
  revealLineOfSightForHero(s, h);
  return ok(s);
}

function doClimbPit(state: HQState, hero: Hero): ApplyResult {
  if (!hero.inPit) return err('You are not in a pit.');
  if (hero.moveLeft < 2) return err('Need at least 2 movement squares to climb out.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.inPit = false;
  h.moveLeft -= 2;
  pushLog(s, 'move', `${heroLabel(h)} climbs out of the pit.`);
  return ok(s);
}

function doCastSpell(
  state: HQState,
  hero: Hero,
  action: Extract<HQAction, { kind: 'cast_spell' }>,
): ApplyResult {
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const spell = hero.spells.find(sp => sp.id === action.spellId);
  if (!spell) return err('You do not know that spell.');
  if (hero.spellsCast.includes(spell.id)) return err('You have already cast that spell.');

  // Line-of-sight gate (character view), validated BEFORE the spell is spent so
  // an unseen target simply isn't targetable (no wasted spell). A monster — or
  // ANOTHER hero — can only be targeted if an unobstructed straight line runs
  // from the caster's square centre to the target's (walls / closed doors /
  // figures block; grazing a corner does not). Self-casts and 'area' spells need
  // no target/line. The UI only offers valid targets; this is the safety net.
  if (spell.target === 'monster') {
    const m = action.targetMonsterId ? state.monsters.find(mm => mm.id === action.targetMonsterId) : null;
    if (!m) return err('Choose a monster you can see.');
    if (!hasLineOfSight(state, hero.at, m.at)) return err('You cannot see that target.');
  } else if (spell.target === 'hero' && action.targetHeroIdx != null) {
    const t = state.heroes[action.targetHeroIdx];
    if (t && t.seat !== hero.seat) { // targeting an ally (self needs no line of sight)
      if (t.body <= 0) return err('That hero is not a valid target.');
      if (!hasLineOfSight(state, hero.at, t.at)) return err('You cannot see that hero.');
    }
  }

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  // Movement spells still grant movement after a roll; other spells follow the
  // normal rule (acting after rolling forfeits remaining movement).
  markActed(h, !(spell.id === 'swift_wind' || spell.id === 'veil_of_mist'));
  h.spellsCast.push(spell.id);
  pushLog(s, 'spell', `${heroLabel(h)} casts ${spell.name}!`);

  // Record where the spell flies for the board animation: caster → target
  // (monster / hero), or the caster's own square for self / area spells.
  let fxTo = { ...h.at };
  if (spell.target === 'monster' && action.targetMonsterId) {
    const tm = s.monsters.find(mm => mm.id === action.targetMonsterId);
    if (tm) fxTo = { ...tm.at };
  } else if (spell.target === 'hero' && action.targetHeroIdx != null) {
    const th = s.heroes[action.targetHeroIdx];
    if (th) fxTo = { ...th.at };
  }
  s.lastSpellFx = { seq: s.logSeq, element: spell.element, from: { ...h.at }, to: fxTo };

  // v1 effect resolution (minimal — covers the most useful subset).
  switch (spell.id) {
    case 'heal_body_w':
    case 'heal_body_e': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const heal = 4;
        const restored = Math.min(target.bodyMax - target.body, heal);
        target.body += restored;
        pushLog(s, 'spell', `${heroLabel(target)} regains ${restored} BP.`);
      }
      return ok(s);
    }
    case 'water_heal': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const restored = Math.min(target.bodyMax - target.body, 2);
        target.body += restored;
        pushLog(s, 'spell', `${heroLabel(target)} regains ${restored} BP.`);
      }
      return ok(s);
    }
    case 'fire_of_wrath': {
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      m.body -= 1;
      pushLog(s, 'spell', `${monsterDisplay(m)} burns for 1 BP.`);
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }
    case 'ball_of_flame': {
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. Spell wasted.`); return ok(s); }
      const roll = rollDice(2, 'hero');
      s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
      const def = rollDice(m.defense, 'monster');
      const damage = Math.max(0, roll.skulls - def.blocks);
      m.body -= damage;
      pushLog(s, 'spell', `${monsterDisplay(m)} takes ${damage} BP from the flames!`);
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }

    // --- Air ----------------------------------------------------------------
    case 'genie': {
      // A summoned genie does your bidding — modelled as a powerful 4-dice
      // magical strike against a monster you can see.
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. The genie returns to its lamp.`); return ok(s); }
      const roll = rollDice(4, 'hero');
      s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
      const def = rollDice(m.defense, 'monster');
      const damage = Math.max(0, roll.skulls - def.blocks);
      m.body -= damage;
      pushLog(s, 'spell', `The genie strikes ${monsterDisplay(m)} for ${damage} BP!`);
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }
    case 'tempest': {
      // Up to two monsters on squares adjacent to the caster are robbed of
      // their next turn.
      const adjacent = s.monsters
        .filter(mm => chebyshev(mm.at, h.at) === 1)
        .slice(0, 2);
      if (adjacent.length === 0) { pushLog(s, 'spell', `…but no monsters stand close enough. The tempest howls in vain.`); return ok(s); }
      for (const mm of adjacent) {
        mm.stunned = true;
        pushLog(s, 'spell', `${monsterDisplay(mm)} is caught in the tempest and will lose its next turn!`);
      }
      return ok(s);
    }
    case 'swift_wind': {
      // The target may move with double its normal movement this turn.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target is no longer able to move.`); return ok(s); }
      if (!target.hasRolled) {
        const r = (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));
        target.moveRolled = r;
        target.moveLeft = r;
        target.hasRolled = true;
      }
      target.moveLeft += target.moveRolled;
      pushLog(s, 'spell', `${heroLabel(target)} is swept along by a swift wind — movement doubled (${target.moveLeft} squares left)!`);
      return ok(s);
    }

    // --- Water --------------------------------------------------------------
    case 'veil_of_mist': {
      // The target slips away in a veil of mist — a free burst of movement to
      // reposition or escape, even if they had not rolled yet.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target is no longer able to move.`); return ok(s); }
      target.hasRolled = true;
      target.moveLeft += 10;
      pushLog(s, 'spell', `${heroLabel(target)} vanishes into a veil of mist — +10 squares of movement to slip away.`);
      return ok(s);
    }

    // --- Fire ---------------------------------------------------------------
    case 'courage': {
      // The target gains +2 attack dice and may make one attack even though
      // the caster's action was spent on the spell.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.attackBonus = (target.attackBonus ?? 0) + 2;
      target.extraAttack = true;
      pushLog(s, 'spell', `${heroLabel(target)} is emboldened — +2 attack dice and may strike at once!`);
      return ok(s);
    }

    // --- Earth --------------------------------------------------------------
    case 'pass_rock': {
      // The target may move through walls and furniture this turn.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.phaseWalls = true;
      pushLog(s, 'spell', `${heroLabel(target)} can pass through solid rock until the end of their turn.`);
      return ok(s);
    }
    case 'rock_skin': {
      // The target gains +2 defense dice until their next turn (survives the
      // upcoming Zargon turn).
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.defenseBonus = (target.defenseBonus ?? 0) + 2;
      pushLog(s, 'spell', `${heroLabel(target)}'s skin turns to stone — +2 defense dice until their next turn.`);
      return ok(s);
    }

    default:
      // Any spell without an implemented effect still consumes the action.
      pushLog(s, 'spell', `(${spell.name} shimmers, but nothing happens.)`);
      return ok(s);
  }
}

function doEndTurn(state: HQState, hero: Hero): ApplyResult {
  const s = clone(state);
  endHeroTurn(s);
  // After the last hero's turn (turnIndex wraps to 0) → Zargon's turn, which now
  // plays one monster at a time via zargon_step (the host ticks it). The next
  // hero's "it is your turn" log is emitted when Zargon finishes.
  if (s.turnIndex === 0) {
    beginZargonTurn(s);
    return ok(s);
  }
  if (s.phase !== 'finished') {
    pushLog(s, 'system', `It is ${heroLabel(s.heroes[s.turnIndex])}'s turn.`);
  }
  return ok(s);
}

function endHeroTurn(s: HQState): void {
  const h = s.heroes[s.turnIndex];
  h.moveLeft = 0;
  h.moveRolled = 0;
  h.hasRolled = false;
  h.hasActed = false;
  // Single-turn spell buffs expire with the turn that used them.
  // Rock Skin's defenseBonus is intentionally NOT cleared here — it lasts
  // through the upcoming Zargon turn and clears when the hero's next turn
  // begins. Similarly, Potion of Defense (potionDefBonus) persists until the
  // hero is actually hit — it is NOT cleared at turn end.
  h.attackBonus    = 0;  // Courage spell
  h.potionAtkBonus = 0;  // Potion of Strength (unused strength potion expires at turn end)
  h.extraAttack    = false;
  h.phaseWalls     = false;
  // Advance to next hero, skipping dead heroes.
  let next = s.turnIndex;
  for (let i = 0; i < s.heroes.length; i++) {
    next = (next + 1) % s.heroes.length;
    if (s.heroes[next].body > 0) break;
  }
  s.turnIndex = next;
  // Rock Skin lasts "until your next turn" — clear it as that hero begins.
  s.heroes[next].defenseBonus = 0;
}

// ============================================================================
// Zargon (engine) turn
// ============================================================================

/** Begin Zargon's turn. Monsters then act one at a time via zargon_step (the
 *  host ticks it on a timer), so each monster's move/attack is visible. */
function beginZargonTurn(s: HQState): void {
  if (s.phase !== 'heroes') return;
  s.phase = 'zargon';
  pushLog(s, 'zargon', '— Zargon\'s turn —');
  s.zargonQueue = s.monsters.map(m => m.id);  // placement order
  s.zargonActed = [];
  s.zargonActiveId = null;
  if (s.zargonQueue.length === 0) finishZargonTurn(s); // no monsters → straight back
}

/** Resolve ONE monster's action (spotlighting it), or end Zargon's turn when the
 *  queue is empty. A no-op outside Zargon's phase. */
function doZargonStep(state: HQState): ApplyResult {
  if (state.phase !== 'zargon') return ok(state);
  const s = clone(state);
  const queue = s.zargonQueue ?? [];
  if (queue.length === 0) { finishZargonTurn(s); return ok(s); }
  const id = queue[0];
  s.zargonQueue = queue.slice(1);
  s.zargonActiveId = id;
  (s.zargonActed ??= []).push(id);
  const m = s.monsters.find(mm => mm.id === id);
  if (m && m.body > 0) runMonster(s, m);
  if ((s.phase as Phase) === 'finished') clearZargon(s);
  return ok(s);
}

function finishZargonTurn(s: HQState): void {
  clearZargon(s);
  if ((s.phase as Phase) !== 'finished') {
    s.phase = 'heroes';
    pushLog(s, 'system', `It is ${heroLabel(s.heroes[s.turnIndex])}'s turn.`);
  }
}

function clearZargon(s: HQState): void {
  s.zargonQueue = undefined;
  s.zargonActiveId = null;
  s.zargonActed = undefined;
}

function runMonster(s: HQState, m: Monster): void {
  // Tempest: a stunned monster loses this turn (the flag clears as it's spent).
  if (m.stunned) {
    m.stunned = false;
    pushLog(s, 'zargon', `${monsterDisplay(m)} is dazed by the tempest and cannot act.`);
    return;
  }
  // Find the nearest LIVING hero by Chebyshev distance (not strict pathfinding
  // — v1 keeps it simple). Then walk toward them up to `m.move` steps,
  // attacking if adjacent at the end.
  const livingHeroes = s.heroes.filter(h => h.body > 0);
  if (livingHeroes.length === 0) return;
  livingHeroes.sort((a, b) =>
    chebyshev(a.at, m.at) - chebyshev(b.at, m.at)
    || a.body - b.body,
  );
  const target = livingHeroes[0];
  // Walk toward target. Monsters move orthogonally, but (house rule) they may
  // ATTACK diagonally — so they stop the moment they are within one square in
  // any of the 8 directions. Checking at the top of the loop also means a
  // monster that starts in melee range strikes from where it stands.
  let steps = m.move;
  while (steps > 0 && chebyshev(m.at, target.at) !== 1) {
    const dx = Math.sign(target.at.x - m.at.x);
    const dy = Math.sign(target.at.y - m.at.y);
    // Try the toward-target axes first, then perpendicular fallbacks to round a
    // corner. Every candidate is a single orthogonal step (one component zero).
    let moved = false;
    for (const [sx, sy] of [[dx, 0], [0, dy], [0, dx], [dy, 0]]) {
      if (sx === 0 && sy === 0) continue;
      const nx = m.at.x + sx, ny = m.at.y + sy;
      if (!inBounds(s, { x: nx, y: ny })) continue;
      if (!isPassable(s, { x: nx, y: ny }, /*forHero*/ false)) continue;
      if (edgeBlocksMove(s, m.at, { x: nx, y: ny }, /*phaseWalls*/ false)) continue;
      if (cellOccupied(s, { x: nx, y: ny }, /*ignoreHeroPassthrough*/ false)) continue;
      m.at = { x: nx, y: ny };
      moved = true;
      steps -= 1;
      break;
    }
    if (!moved) break;
  }
  // Attack if adjacent in any of the 8 directions (monsters may strike diagonally).
  if (chebyshev(m.at, target.at) === 1) {
    const atk = rollDice(m.attack, 'monster');
    s.lastRoll = atk;
    s.lastMoveRoll = null;
    // Rock Skin + Potion of Defense add bonus defense dice; defending from a
    // pit costs one die (min 1, rulebook p.17). Potion of Defense is consumed
    // on this defense roll; Rock Skin persists until the hero's next turn.
    const rockBonus   = target.defenseBonus   ?? 0;
    const potDefBonus = target.potionDefBonus ?? 0;
    const defBonus = rockBonus + potDefBonus;
    const def = rollDice(Math.max(1, target.defense + defBonus - (target.inPit ? 1 : 0)), 'hero');
    s.lastDefenseRoll = def;
    target.potionDefBonus = 0;  // consumed — Rock Skin (defenseBonus) is NOT cleared here
    const damage = Math.max(0, atk.skulls - def.blocks);
    target.body = Math.max(0, target.body - damage);
    const defNote = rockBonus > 0 && potDefBonus > 0
      ? ` (Rock Skin +${rockBonus}, Defense potion +${potDefBonus} dice)`
      : rockBonus > 0 ? ` (Rock Skin +${rockBonus} dice)`
      : potDefBonus > 0 ? ` (Defense potion +${potDefBonus} dice)` : '';
    pushLog(s, 'combat',
      `${monsterDisplay(m)} attacks ${heroLabel(target)} — ${atk.skulls} skulls vs ${def.blocks} blocks${defNote}. ` +
      (damage > 0 ? `${heroLabel(target)} loses ${damage} BP.` : 'No damage.'),
    );
    checkHeroDeath(s, target);
  }
}

function checkHeroDeath(s: HQState, h: Hero): void {
  if (h.body > 0) return;
  pushLog(s, 'death', `${heroLabel(h)} has fallen!`);
  // All heroes dead → Zargon wins.
  if (s.heroes.every(x => x.body <= 0)) {
    s.phase = 'finished';
    s.winner = 'zargon';
    pushLog(s, 'system', 'All heroes have perished. The quest is lost.');
  }
}

// ============================================================================
// Win conditions
// ============================================================================

function maybeFinishOnKill(s: HQState, killed: Monster): void {
  const wc = s.quest.winCondition;
  if (wc.kind === 'kill_and_exit' && killed.displayName === wc.monsterDisplayName) {
    s.objectiveDefeated = true;
    pushLog(s, 'system', `${wc.monsterDisplayName} has been slain! Return to the stairway to escape.`);
  }
  if (wc.kind === 'kill_all' && s.monsters.length === 0) {
    heroesWin(s, 'All monsters defeated. Heroes win!');
  }
}

/** Is this hero standing on a stairway tile? */
function onStairs(s: HQState, h: Hero): boolean {
  return s.tiles[h.at.y]?.[h.at.x]?.kind === 'stairs';
}

/** Finish the quest with a hero victory: set phase/winner, log, and grant the
 *  quest's completion reward to the living heroes. Centralises every win path. */
function heroesWin(s: HQState, message: string): void {
  s.phase = 'finished';
  s.winner = 'heroes';
  pushLog(s, 'system', message);
  const reward = s.quest.reward;
  if (reward.kind === 'gold') {
    const living = s.heroes.filter(h => h.body > 0);
    if (living.length > 0) {
      if (reward.split === 'each') {
        for (const h of living) h.gold += reward.amount;
        pushLog(s, 'system', `The King rewards each hero with ${reward.amount} gold.`);
      } else {
        const share = Math.floor(reward.amount / living.length);
        for (const h of living) h.gold += share;
        pushLog(s, 'system', `The heroes divide a reward of ${reward.amount} gold (${share} each).`);
      }
    }
  }
}

function maybeFinishOnExit(s: HQState): void {
  const wc = s.quest.winCondition;
  if (wc.kind === 'kill_and_exit') {
    // The objective must have been killed first. (Monsters lazy-spawn, so we
    // track an explicit flag rather than inferring "dead" from absence.)
    if (!s.objectiveDefeated) return;
    heroesWin(s, 'Heroes escape the dungeon — quest complete!');
    return;
  }
  if (wc.kind === 'escape') {
    // Win the moment every living hero has reached the stairway (heroes may
    // share stair tiles). Lost only if all heroes die (handled elsewhere).
    const living = s.heroes.filter(h => h.body > 0);
    if (living.length > 0 && living.every(h => onStairs(s, h))) {
      heroesWin(s, 'The heroes escape the dungeon — quest complete!');
    }
    return;
  }
  // kill_all is resolved on the killing blow (maybeFinishOnKill), not on exit.
}

// ============================================================================
// Treasure
// ============================================================================

function drawTreasureCard(s: HQState): TreasureCard | null {
  // Hazard and Wandering Monster cards cycle back to the BOTTOM of the deck
  // after resolution — so the deck never truly empties under normal play (the
  // 10 cycling cards keep circulating). If somehow all cards have been
  // permanently removed (14 good cards gone AND all 10 cycling cards also
  // missing), we return null as a safety net.
  return s.treasureDeck.shift() ?? null;
}

function resolveTreasureCard(s: HQState, h: Hero, card: TreasureCard): void {
  switch (card.kind) {
    case 'gold':
      markActed(h);
      h.gold += card.amount;
      pushLog(s, 'search', `${heroLabel(h)} finds ${card.amount} gold!`);
      s.treasureDiscard.push(card);  // permanently removed from play
      s.lastTreasureFx = { seq: s.logSeq, kind: 'gold', label: `${card.amount} Gold!`, subtitle: 'Added to your purse', isGood: true };
      return;
    case 'gem':
      markActed(h);
      h.gold += card.value;
      pushLog(s, 'search', `${heroLabel(h)} finds a gem worth ${card.value} gold!`);
      s.treasureDiscard.push(card);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'gem', label: 'Gem!', subtitle: `Worth ${card.value} gold`, isGood: true };
      return;
    case 'jewels':
      markActed(h);
      h.gold += card.value;
      pushLog(s, 'search', `${heroLabel(h)} finds jewels worth ${card.value} gold!`);
      s.treasureDiscard.push(card);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'jewels', label: 'Jewels!', subtitle: `Worth ${card.value} gold`, isGood: true };
      return;
    case 'potion': {
      markActed(h);
      // Potions are held in the hero's pack and used at any time (except
      // Heroic Brew, which must be drunk before attacking). They are NOT
      // auto-applied on draw — the hero decides when to use them.
      const held: HeldPotion = { id: card.id, name: card.name, effect: card.effect, description: card.description };
      if (!h.foundPotions) h.foundPotions = [];
      h.foundPotions.push(held);
      s.treasureDiscard.push(card);
      pushLog(s, 'search', `${heroLabel(h)} finds a ${card.name} and tucks it away for later!`);
      s.lastTreasureFx = { seq: s.logSeq, kind: 'potion', label: card.name, subtitle: card.description, isGood: true };
      return;
    }
    case 'hazard':
      markActed(h);  // hazard ends the hero's action
      h.body = Math.max(0, h.body - card.bpLoss);
      pushLog(s, 'search', `${heroLabel(h)}: ${card.flavor} (−${card.bpLoss} BP)`);
      s.treasureDeck.push(card);  // returned to BOTTOM of deck — cycles back
      s.lastTreasureFx = { seq: s.logSeq, kind: 'hazard', label: 'Hazard!', subtitle: `${card.flavor} — −${card.bpLoss} BP`, isGood: false };
      checkHeroDeath(s, h);
      return;
    case 'wandering': {
      // Wandering Monster does NOT end the hero's action (rulebook: the monster
      // attacks immediately but the hero's turn then continues normally).
      s.treasureDeck.push(card);  // returned to BOTTOM of deck — cycles back
      const kind = s.quest.wanderingMonster;
      if (!kind) {
        pushLog(s, 'search', `${heroLabel(h)} hears danger… but no monster appears.`);
        s.lastTreasureFx = { seq: s.logSeq, kind: 'wandering', label: 'Wandering Monster!', subtitle: 'No monster for this quest', isGood: false };
        return;
      }
      // Spawn adjacent to the hero on the first free cell, strongly preferring
      // cells in the same room/region.  This matters for the treasure-search
      // block check: `doSearchTreasure` gates on monsters whose tile.region
      // matches the room — a wandering monster that lands in an adjacent corridor
      // tile would bypass that check and let the next hero search anyway.
      const heroRegion = s.tiles[h.at.y][h.at.x].region;
      const adj = adjacentCells(h.at).filter(c =>
        inBounds(s, c) && isPassable(s, c, /*forHero*/ false) && !cellOccupied(s, c, false),
      );
      const sameRegion = adj.filter(c => s.tiles[c.y]?.[c.x]?.region === heroRegion);
      const spawnAt = (sameRegion[0] ?? adj[0]) ?? h.at;
      const stats = monsterStats(kind);
      const mId = `wand_${s.logSeq + 1}_${Math.floor(Math.random() * 1e6)}`;
      const newMonster: Monster = {
        id: mId, kind,
        at: spawnAt,
        body: stats.bodyMax, bodyMax: stats.bodyMax,
        attack: stats.attack, defense: stats.defense, move: stats.move,
        gold: stats.gold,
        roomId: s.tiles[h.at.y][h.at.x].region,
      };
      s.monsters.push(newMonster);
      pushLog(s, 'spawn', `A wandering ${stats.displayName} appears next to ${heroLabel(h)}!`);
      // Immediate attack — the monster strikes the hero before they can react.
      const atk = rollDice(newMonster.attack, 'monster');
      const defBonus = h.defenseBonus ?? 0;
      const def = rollDice(Math.max(1, h.defense + defBonus - (h.inPit ? 1 : 0)), 'hero');
      const damage = Math.max(0, atk.skulls - def.blocks);
      h.body = Math.max(0, h.body - damage);
      const combatLine = damage > 0
        ? `${atk.skulls} skulls vs ${def.blocks} blocks — ${heroLabel(h)} loses ${damage} BP`
        : `${atk.skulls} skulls vs ${def.blocks} blocks — No damage`;
      pushLog(s, 'combat',
        `${stats.displayName} attacks ${heroLabel(h)} immediately! ${combatLine}.`,
      );
      checkHeroDeath(s, h);
      s.lastTreasureFx = {
        seq: s.logSeq,
        kind: 'wandering',
        label: `${stats.displayName}!`,
        subtitle: combatLine,
        isGood: false,
      };
      return;
    }
  }
}

// Local import-style accessor to MONSTER_STATS to avoid a circular import.
import { MONSTER_STATS } from './content';
function monsterStats(kind: Monster['kind']) {
  return MONSTER_STATS[kind];
}

// ============================================================================
// Helpers — geometry, LOS, dice, log
// ============================================================================

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function ok(state: HQState): { ok: true; state: HQState } { return { ok: true, state }; }
function err(error: string): { ok: false; error: string } { return { ok: false, error }; }

function pushLog(s: HQState, tag: LogEntry['tag'], text: string): void {
  s.logSeq += 1;
  s.log.push({ seq: s.logSeq, ts: Date.now(), text, tag });
  if (s.log.length > 200) s.log = s.log.slice(-200);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  shuffleInPlace(a);
  return a;
}
function shuffleInPlace<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function inBounds(s: HQState, c: Coord): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < s.quest.width && c.y < s.quest.height;
}

function isPassable(s: HQState, c: Coord, forHero: boolean): boolean {
  const t = s.tiles[c.y][c.x];
  if (t.kind === 'wall' || t.kind === 'blocked') return false;
  // Furniture that blocks movement (e.g. tomb).
  const furn = s.furniture.find(f => f.blocksMove && f.cells.some(x => x.x === c.x && x.y === c.y));
  if (furn) return false;
  // For monsters: stairway is passable but doesn't matter (they don't seek it).
  void forHero;
  return true;
}

function cellOccupied(s: HQState, c: Coord, _ignoreHeroPassthrough: boolean): boolean {
  if (s.heroes.some(h => h.body > 0 && h.at.x === c.x && h.at.y === c.y)) return true;
  if (s.monsters.some(m => m.at.x === c.x && m.at.y === c.y)) return true;
  return false;
}

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function adjacentCells(c: Coord): Coord[] {
  return [
    { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y },
    { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 },
  ];
}

// ============================================================================
// Edge-based walls & doors
// ----------------------------------------------------------------------------
// Walls and doors live on the LINES between cells, not in cells. The wall
// between two adjacent cells exists wherever "the colour changes" — i.e. their
// regions differ and at least one is a room. A door is an opening cut into such
// a wall: passable (and see-through) when open, solid when closed.
// ============================================================================

function regionOf(s: HQState, c: Coord): string {
  return s.tiles[c.y]?.[c.x]?.region ?? '';
}

/** Undirected key for the edge between two orthogonally-adjacent cells. */
function edgeKey(p: Coord, q: Coord): string {
  return (p.y < q.y || (p.y === q.y && p.x < q.x))
    ? `${p.x},${p.y}|${q.x},${q.y}`
    : `${q.x},${q.y}|${p.x},${p.y}`;
}

/** True if a wall sits on the edge between p and q (room boundary / colour
 *  change). Same region, or two non-room areas (corridor↔stairway), are open. */
function isWallEdge(s: HQState, p: Coord, q: Coord): boolean {
  const rp = regionOf(s, p), rq = regionOf(s, q);
  if (rp === rq) return false;
  return rp.startsWith('room_') || rq.startsWith('room_');
}

/** The door (if any) sitting on the edge between p and q. */
function doorOnEdge(s: HQState, p: Coord, q: Coord): Door | undefined {
  const key = edgeKey(p, q);
  for (const d of s.doors) {
    for (const c of d.crossings) {
      if (edgeKey(c.a, c.b) === key) return d;
    }
  }
  return undefined;
}

/** Can a figure NOT cross the edge from p to q? (Wall, or a closed/secret door.) */
function edgeBlocksMove(s: HQState, p: Coord, q: Coord, phaseWalls: boolean): boolean {
  if (phaseWalls) return false;
  if (!isWallEdge(s, p, q)) return false;
  const d = doorOnEdge(s, p, q);
  if (d) return (d.secret && !d.found) ? true : !d.open;
  return true; // solid wall
}

/** Does the edge from p to q block line of sight? (Wall or closed/secret door.) */
function edgeBlocksSight(s: HQState, p: Coord, q: Coord): boolean {
  if (!isWallEdge(s, p, q)) return false;
  const d = doorOnEdge(s, p, q);
  if (d) return (d.secret && !d.found) ? true : !d.open;
  return true;
}

// Bresenham line. Sight is blocked by a rock cell or LOS-blocking furniture on
// an intermediate cell, by a figure standing on an intermediate cell, OR by a
// wall / closed door on any edge the ray crosses.
export function hasLineOfSight(s: HQState, a: Coord, b: Coord): boolean {
  const cells = bresenham(a, b);
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1], c = cells[i];
    // Edge crossing prev→c. Orthogonal steps check the single shared wall;
    // diagonal steps are blocked only if BOTH corner edges are blocked.
    const ortho = Math.abs(prev.x - c.x) + Math.abs(prev.y - c.y) === 1;
    if (ortho) {
      if (edgeBlocksSight(s, prev, c)) return false;
    } else {
      const e1 = edgeBlocksSight(s, prev, { x: c.x, y: prev.y });
      const e2 = edgeBlocksSight(s, prev, { x: prev.x, y: c.y });
      if (e1 && e2) return false;
    }
    // Intermediate cells (not the endpoints) block on rock / LOS furniture / figures.
    if (i < cells.length - 1) {
      if (!inBounds(s, c)) return false;
      const t = s.tiles[c.y][c.x];
      if (t.kind === 'wall' || t.kind === 'blocked') return false;
      if (s.furniture.some(f => f.blocksLos && f.cells.some(x => x.x === c.x && x.y === c.y))) return false;
      if (cellOccupied(s, c, false)) return false;
    }
  }
  return true;
}

function bresenham(a: Coord, b: Coord): Coord[] {
  const out: Coord[] = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }
  return out;
}

function rollDice(n: number, who: 'hero' | 'monster'): DiceRoll {
  const faces: DieFace[] = [];
  for (let i = 0; i < n; i++) faces.push(DIE_FACES[Math.floor(Math.random() * 6)]);
  const skulls = faces.filter(f => f === 'skull').length;
  const blocks = faces.filter(f => f === (who === 'hero' ? 'white_shield' : 'black_shield')).length;
  return { rolledBy: who, faces, skulls, blocks };
}

function monsterDisplay(m: Monster): string {
  return m.displayName ?? MONSTER_STATS[m.kind]?.displayName ?? capitalize(m.kind.replace('_', ' '));
}
/** Chronicle label for a hero — always "Player - Class" (e.g. "Makros - Wizard")
 *  so the log is unambiguous when one player controls several heroes. */
function heroLabel(h: Hero): string {
  return `${h.username} - ${HERO_DEFAULTS[h.klass].name}`;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monstersVisibleToHero(s: HQState, h: Hero): Monster[] {
  return s.monsters.filter(m => hasLineOfSight(s, h.at, m.at));
}

// ============================================================================
// Reveal mechanic
// ============================================================================

function revealRegion(s: HQState, region: string): void {
  if (!region) return;
  for (let y = 0; y < s.tiles.length; y++) {
    for (let x = 0; x < s.tiles[0].length; x++) {
      if (s.tiles[y][x].region === region) s.tiles[y][x].revealed = true;
    }
  }
}

/** Lazily instantiate monsters that belong to the just-revealed room — ONCE per
 *  room. Tracking spawned rooms (rather than checking live monsters) means a
 *  killed monster never re-appears when its room is re-revealed. */
function spawnRoomMonsters(s: HQState, region: string): void {
  if (!region) return;
  if (!s.spawnedRooms) s.spawnedRooms = [];
  if (s.spawnedRooms.includes(region)) return;  // already spawned once — never again
  s.spawnedRooms.push(region);
  for (const monDef of s.quest.monsters) {
    if (monDef.roomId !== region) continue;
    s.monsters.push(instantiateMonster(monDef));
  }
  // Read aloud any Quest-Book "special note" for this room (once, on first entry).
  for (const note of s.quest.roomNotes ?? []) {
    if (s.tiles[note.at.y]?.[note.at.x]?.region === region) pushLog(s, 'note', note.text);
  }
}

/** Reveal LOS-visible cells from this hero (used at start of game + after
    moves). v1: cheap implementation — reveal everything in the hero's
    region plus any directly connected corridor cells within LOS. */
// HeroQuest has TWO separate "vision" mechanics — keep them distinct:
//
//  • LOOKING & REVEALING (this function) — the PHYSICAL PLAYER's view: which
//    tiles get placed on the board. You look down a hallway in a straight line
//    and reveal corridor / stairs / blocked squares until a wall stops the line
//    (never around a corner). You do NOT see INTO a room by looking — a room is
//    only placed when its DOOR is OPENED (see doOpenDoor). The room you are
//    standing in is, of course, revealed.
//
//  • LINE OF SIGHT (hasLineOfSight) — the CHARACTER's view: used for attacks /
//    spells / ranged targeting. Separate concern; not reveal.
function revealLineOfSightForHero(s: HQState, h: Hero): void {
  // You see the whole room you're standing in.
  const region = s.tiles[h.at.y]?.[h.at.x]?.region ?? '';
  if (region.startsWith('room_')) revealRegion(s, region);

  // Look down hallways using the LOOKING-&-REVEALING view (revealVisible), which
  // covers straight AND diagonal lines so the FULL width of a passage lights up
  // (a hero in a 2-wide hall sees the whole hall, not just their own row).
  // Diagonal reveals are blocked only if BOTH flanking directions are walled off
  // (same rule as hasLineOfSight) — one open side still lets you see diagonally,
  // matching the HeroQuest "you can see along corridors diagonally" convention.
  // Rooms remain protected by the room_ prefix guard below; solid rock on BOTH
  // flanking sides still blocks true corner peeks. The line also stops at rock,
  // 'blocked' sections, closed/secret doors, LOS-furniture, and room interiors.
  for (let y = 0; y < s.tiles.length; y++) {
    for (let x = 0; x < s.tiles[0].length; x++) {
      const t = s.tiles[y][x];
      if (t.revealed) continue;
      if (t.kind === 'wall') continue;               // never reveal solid rock
      if (t.region.startsWith('room_')) continue;    // rooms reveal only via their door
      if (x === h.at.x && y === h.at.y) continue;
      if (revealVisible(s, h.at, { x, y })) t.revealed = true;
    }
  }

  // Spawn monsters for any room that's now revealed (your own room, or one whose
  // door was just opened).
  spawnRevealedRooms(s);
}

/** Reveal-visibility from `a` to `b` — the LOOKING-&-REVEALING view. An
 *  unobstructed straight or diagonal line. Diagonal steps use the same rule as
 *  hasLineOfSight: blocked only if BOTH flanking corner edges are walls AND both
 *  flanking corner cells are solid rock (true corner, fully sealed). One open
 *  side still lets you see diagonally — a 2-wide corridor lights up fully, and
 *  a hero can see diagonally around a single-wall bend.
 *  Unlike hasLineOfSight this is for LOOKING at terrain, so figures never block
 *  it, and it stops on room interiors (rooms reveal only via their door). */
function revealVisible(s: HQState, a: Coord, b: Coord): boolean {
  const cells = bresenham(a, b);
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1], c = cells[i];
    const ortho = Math.abs(prev.x - c.x) + Math.abs(prev.y - c.y) === 1;
    if (ortho) {
      if (edgeBlocksSight(s, prev, c)) return false;
    } else {
      // Diagonal: blocked only if BOTH flanking edges are walls/closed doors AND
      // both flanking cells are solid rock — i.e. the corner is fully sealed.
      // One open side (e.g. the corridor continues in that direction) still lets
      // you see diagonally, matching how hasLineOfSight handles diagonals and
      // what HeroQuest players expect ("you can see diagonally along corridors").
      // Rooms are still protected by the room_ prefix check in the outer loop.
      const e1 = edgeBlocksSight(s, prev, { x: c.x, y: prev.y });
      const e2 = edgeBlocksSight(s, prev, { x: prev.x, y: c.y });
      if (e1 && e2) return false;
      if (s.tiles[prev.y]?.[c.x]?.kind === 'wall' && s.tiles[c.y]?.[prev.x]?.kind === 'wall') return false;
    }
    // Intermediate cells (not the endpoint) stop the line on solid terrain.
    if (i < cells.length - 1) {
      if (!inBounds(s, c)) return false;
      const t = s.tiles[c.y][c.x];
      if (t.kind === 'wall' || t.kind === 'blocked') return false;
      if (t.region.startsWith('room_')) return false; // can't see through a room
      if (s.furniture.some(f => f.blocksLos && f.cells.some(fc => fc.x === c.x && fc.y === c.y))) return false;
    }
  }
  return true;
}

/** Instantiate the monsters of every room that has become visible. Idempotent
 *  (spawnRoomMonsters skips rooms whose monsters are already on the board). */
function spawnRevealedRooms(s: HQState): void {
  const seen = new Set<string>();
  for (let y = 0; y < s.tiles.length; y++) {
    for (let x = 0; x < s.tiles[0].length; x++) {
      const t = s.tiles[y][x];
      if (t.revealed && t.region.startsWith('room_')) seen.add(t.region);
    }
  }
  for (const r of seen) spawnRoomMonsters(s, r);
}
