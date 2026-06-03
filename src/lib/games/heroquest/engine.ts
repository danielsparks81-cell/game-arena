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
    const s = clone(state);
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
    pushLog(s, 'system', `It is ${s.heroes[0].username}'s turn (${HERO_DEFAULTS[s.heroes[0].klass].name}).`);
    return ok(s);
  }

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
  if (action.kind === 'climb_pit')       return doClimbPit(state, hero);
  if (action.kind === 'cast_spell')      return doCastSpell(state, hero, action);
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
  pushLog(s, 'move', `${h.username} rolls ${d1}+${d2}+${d3} = ${total} squares of movement.`);
  return ok(s);
}

/** Spend the hero's one action for the turn. Enforces the movement rule —
 *  "move then act, OR act then move, but never move part-way, act, then finish
 *  moving": if the hero had already used some of their movement before acting,
 *  the remaining movement is forfeited. (Acting BEFORE moving leaves the full
 *  allowance, so act-then-move still works.) */
function markActed(h: Hero) {
  h.hasActed = true;
  if (h.hasRolled && h.moveLeft < h.moveRolled) h.moveLeft = 0;
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
    if (h.moveLeft <= 0) break;
    const adx = Math.abs(sq.x - from.x), ady = Math.abs(sq.y - from.y);
    if (adx + ady !== 1) break;                              // orthogonal single step only
    if (!inBounds(s, sq)) break;
    if (!h.phaseWalls && (!isPassable(s, sq, /*forHero*/ true) || edgeBlocksMove(s, from, sq, false))) break;
    if (s.monsters.some(m => m.at.x === sq.x && m.at.y === sq.y)) break; // monsters block

    const roomsBefore = revealedRoomRegions(s);
    const monstersBefore = s.monsters.length;
    const cameFrom: Coord = { ...from };
    h.at = { ...sq };
    h.moveLeft -= 1;
    from = { ...sq };
    spentSinceSafe += 1;

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
        pushLog(s, 'trap', `${h.username} stumbles into a pit trap! (-1 BP)`);
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
          `${h.username} springs a falling block! The ceiling caves in` +
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
        pushLog(s, 'trap', `${h.username} is struck by a spear trap! (-1 BP)`);
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        settle();
        return;
      }
      pushLog(s, 'trap', `${h.username} dodges a spear trap — it snaps shut, harmless.`);
      // fall through: the dodge counts as a normal step and the walk continues.
    }

    // Look from the new square.
    revealLineOfSightForHero(s, h);
    if (standable(sq)) { lastSafe = { ...sq }; spentSinceSafe = 0; }
    // Stop if a NEW room comes into view (its monsters are placed) or monsters
    // otherwise appear — so the player can react.
    if (revealedRoomRegions(s).size > roomsBefore.size || s.monsters.length > monstersBefore) {
      pushLog(s, 'reveal', `${h.username} rounds the corner — a new area comes into view.`);
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
  if (path.length > hero.moveLeft) return err('That square is out of reach.');

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  walkPath(s, h, path);
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
  walkPath(s, h, path); // walkPath snaps off a shared final square itself
  if (s.tiles[h.at.y][h.at.x].kind === 'stairs') maybeFinishOnExit(s);
  return ok(s);
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
  pushLog(s, 'reveal', `${hero.username} opens a door — the chamber beyond is revealed!`);
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
  // Attack roll — Courage adds bonus dice; fighting from a pit costs one die
  // (min 1, rulebook p.17).
  const bonus = h.attackBonus ?? 0;
  const atk = rollDice(Math.max(1, h.attack + bonus - (h.inPit ? 1 : 0)), 'hero');
  s.lastRoll = atk;
  s.lastMoveRoll = null;
  // Defense roll.
  const def = rollDice(m.defense, 'monster');
  s.lastDefenseRoll = def;
  const damage = Math.max(0, atk.skulls - def.blocks);
  m.body -= damage;
  pushLog(s, 'combat',
    `${h.username} attacks ${monsterDisplay(m)} — ${atk.skulls} skulls vs ${def.blocks} blocks` +
    (bonus > 0 ? ` (Courage +${bonus} dice)` : '') + '. ' +
    (damage > 0 ? `${monsterDisplay(m)} takes ${damage} BP.` : 'No damage.'),
  );
  if (m.body <= 0) {
    pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
    if (m.gold) {
      h.gold += m.gold;
      pushLog(s, 'system', `${h.username} loots ${m.gold} gold from the fallen ${monsterDisplay(m)}.`);
    }
    s.monsters = s.monsters.filter(mm => mm.id !== m.id);
  }
  // The attack-die bonus is spent on this strike. If this was the free Courage
  // attack, consume that too; otherwise it's the hero's normal action.
  h.attackBonus = 0;
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
  if (state.monsters.some(m => state.tiles[m.at.y]?.[m.at.x]?.region === room)) {
    return err('You cannot search a room for treasure while monsters are in it.');
  }

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.searchedRooms.push(room);
  markActed(h);
  // Quest-defined fixed content overrides the deck for the FIRST hero to search.
  const fixedFurn = s.furniture.find(f =>
    !f.searched
    && f.fixedContent
    && f.cells.some(c => s.tiles[c.y]?.[c.x]?.region === room),
  );
  if (fixedFurn) {
    fixedFurn.searched = true;
    if (fixedFurn.fixedContent!.kind === 'gold') {
      h.gold += fixedFurn.fixedContent!.amount;
      pushLog(s, 'search', `${h.username} searches the ${fixedFurn.kind} and finds ${fixedFurn.fixedContent!.amount} gold!`);
    } else if (fixedFurn.fixedContent!.kind === 'nothing') {
      pushLog(s, 'search', `${h.username} searches the ${fixedFurn.kind}: ${fixedFurn.fixedContent!.flavor}`);
    } else if (fixedFurn.fixedContent!.kind === 'item') {
      pushLog(s, 'search', `${h.username} finds an item: ${fixedFurn.fixedContent!.itemId}.`);
    }
    return ok(s);
  }
  // Otherwise draw a treasure card.
  const card = drawTreasureCard(s);
  if (!card) {
    pushLog(s, 'search', `${h.username} finds nothing of value (deck exhausted).`);
    return ok(s);
  }
  resolveTreasureCard(s, h, card);
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
    ? `${h.username} searches for traps and uncovers ${found}!`
    : `${h.username} searches for traps but finds none.`,
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
    ? `${h.username} discovers ${found} secret door${found > 1 ? 's' : ''}!`
    : `${h.username} searches for secret doors but finds none.`,
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
    pushLog(s, 'trap', `${h.username} fumbles the disarm — the ${t.kind} trap triggers! (-1 BP)`);
    checkHeroDeath(s, h);
  } else {
    pushLog(s, 'trap', `${h.username} carefully disarms the ${t.kind} trap.`);
  }
  return ok(s);
}

function doClimbPit(state: HQState, hero: Hero): ApplyResult {
  if (!hero.inPit) return err('You are not in a pit.');
  if (hero.moveLeft < 2) return err('Need at least 2 movement squares to climb out.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.inPit = false;
  h.moveLeft -= 2;
  pushLog(s, 'move', `${h.username} climbs out of the pit.`);
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
  markActed(h);
  h.spellsCast.push(spell.id);
  pushLog(s, 'spell', `${h.username} casts ${spell.name}!`);

  // v1 effect resolution (minimal — covers the most useful subset).
  switch (spell.id) {
    case 'heal_body_w':
    case 'heal_body_e': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const heal = 4;
        const restored = Math.min(target.bodyMax - target.body, heal);
        target.body += restored;
        pushLog(s, 'spell', `${target.username} regains ${restored} BP.`);
      }
      return ok(s);
    }
    case 'water_heal': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const restored = Math.min(target.bodyMax - target.body, 2);
        target.body += restored;
        pushLog(s, 'spell', `${target.username} regains ${restored} BP.`);
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
      pushLog(s, 'spell', `${target.username} is swept along by a swift wind — movement doubled (${target.moveLeft} squares left)!`);
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
      pushLog(s, 'spell', `${target.username} vanishes into a veil of mist — +10 squares of movement to slip away.`);
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
      pushLog(s, 'spell', `${target.username} is emboldened — +2 attack dice and may strike at once!`);
      return ok(s);
    }

    // --- Earth --------------------------------------------------------------
    case 'pass_rock': {
      // The target may move through walls and furniture this turn.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.phaseWalls = true;
      pushLog(s, 'spell', `${target.username} can pass through solid rock until the end of their turn.`);
      return ok(s);
    }
    case 'rock_skin': {
      // The target gains +2 defense dice until their next turn (survives the
      // upcoming Zargon turn).
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.defenseBonus = (target.defenseBonus ?? 0) + 2;
      pushLog(s, 'spell', `${target.username}'s skin turns to stone — +2 defense dice until their next turn.`);
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
  // After every hero has taken a turn → Zargon turn.
  // Simple model: each hero turn ends individually; once turnIndex would
  // wrap, Zargon plays.
  if (s.turnIndex === 0) {
    runZargonTurn(s);
    // After Zargon, the heroes go again (turnIndex stays at 0, fresh hero turn).
  }
  if (s.phase !== 'finished') {
    pushLog(s, 'system', `It is ${s.heroes[s.turnIndex].username}'s turn.`);
  }
  return ok(s);
}

function endHeroTurn(s: HQState): void {
  const h = s.heroes[s.turnIndex];
  h.moveLeft = 0;
  h.moveRolled = 0;
  h.hasRolled = false;
  h.hasActed = false;
  // Single-turn spell buffs expire with the turn that used them. (Rock Skin's
  // defenseBonus is intentionally NOT cleared here — it lasts through the
  // upcoming Zargon turn and clears when its bearer's next turn begins.)
  h.attackBonus = 0;
  h.extraAttack = false;
  h.phaseWalls = false;
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

function runZargonTurn(s: HQState): void {
  if (s.phase !== 'heroes') return;
  s.phase = 'zargon';
  pushLog(s, 'zargon', '— Zargon\'s turn —');

  // Snapshot: monsters take turns in placement order.
  const order = s.monsters.map(m => m.id);
  for (const monId of order) {
    const m = s.monsters.find(mm => mm.id === monId);
    if (!m) continue;
    runMonster(s, m);
    // runMonster can flip the phase to 'finished' (TPK during a monster
    // attack). Cast through TS's narrowing to allow the early-out.
    if ((s.phase as Phase) === 'finished') break;
  }

  if ((s.phase as Phase) !== 'finished') s.phase = 'heroes';
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
  // Walk toward target. Monsters move orthogonally only and stop the moment
  // they are orthogonally adjacent — they cannot move OR attack diagonally
  // (rulebook p.20). Checking adjacency at the top of the loop also means a
  // monster that starts in melee range strikes from where it stands instead of
  // shuffling to a diagonal first.
  let steps = m.move;
  while (steps > 0 && !orthoAdjacent(m.at, target.at)) {
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
  // Attack only if orthogonally adjacent.
  if (orthoAdjacent(m.at, target.at)) {
    const atk = rollDice(m.attack, 'monster');
    s.lastRoll = atk;
    s.lastMoveRoll = null;
    // Rock Skin adds bonus defense dice; defending from a pit costs one die
    // (min 1, rulebook p.17).
    const defBonus = target.defenseBonus ?? 0;
    const def = rollDice(Math.max(1, target.defense + defBonus - (target.inPit ? 1 : 0)), 'hero');
    s.lastDefenseRoll = def;
    const damage = Math.max(0, atk.skulls - def.blocks);
    target.body = Math.max(0, target.body - damage);
    pushLog(s, 'combat',
      `${monsterDisplay(m)} attacks ${target.username} — ${atk.skulls} skulls vs ${def.blocks} blocks` +
      (defBonus > 0 ? ` (Rock Skin +${defBonus} dice)` : '') + '. ' +
      (damage > 0 ? `${target.username} loses ${damage} BP.` : 'No damage.'),
    );
    checkHeroDeath(s, target);
  }
}

function checkHeroDeath(s: HQState, h: Hero): void {
  if (h.body > 0) return;
  pushLog(s, 'death', `${h.username} has fallen!`);
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
    s.phase = 'finished';
    s.winner = 'heroes';
    pushLog(s, 'system', 'All monsters defeated. Heroes win!');
  }
}

function maybeFinishOnExit(s: HQState): void {
  const wc = s.quest.winCondition;
  if (wc.kind !== 'kill_and_exit') return;
  // The objective must have been killed first. (Monsters lazy-spawn, so we
  // track an explicit flag rather than inferring "dead" from absence.)
  if (!s.objectiveDefeated) return;
  s.phase = 'finished';
  s.winner = 'heroes';
  pushLog(s, 'system', `Heroes escape the dungeon — quest complete!`);
}

// ============================================================================
// Treasure
// ============================================================================

function drawTreasureCard(s: HQState): TreasureCard | null {
  if (s.treasureDeck.length === 0) {
    if (s.treasureDiscard.length === 0) return null;
    s.treasureDeck = shuffle(s.treasureDiscard);
    s.treasureDiscard = [];
  }
  return s.treasureDeck.shift() ?? null;
}

function resolveTreasureCard(s: HQState, h: Hero, card: TreasureCard): void {
  switch (card.kind) {
    case 'gold':
      h.gold += card.amount;
      pushLog(s, 'search', `${h.username} finds ${card.amount} gold!`);
      return;
    case 'gem':
      h.gold += card.value;  // v1 simplification: gem auto-converts to gold value
      pushLog(s, 'search', `${h.username} finds a gem worth ${card.value} gold!`);
      return;
    case 'potion':
      // v1: auto-applied on draw (heal).
      const restored = Math.min(h.bodyMax - h.body, card.amount);
      h.body += restored;
      pushLog(s, 'search', `${h.username} finds a ${card.name} and drinks it (+${restored} BP).`);
      s.treasureDiscard.push(card);
      return;
    case 'hazard':
      h.body = Math.max(0, h.body - card.bpLoss);
      pushLog(s, 'search', `${h.username}: ${card.flavor} (-${card.bpLoss} BP)`);
      s.treasureDiscard.push(card);
      checkHeroDeath(s, h);
      return;
    case 'wandering': {
      const kind = s.quest.wanderingMonster;
      if (!kind) {
        pushLog(s, 'search', `${h.username} hears danger… but no monster appears.`);
        s.treasureDiscard.push(card);
        return;
      }
      // Spawn adjacent to the hero on first free cell.
      const adj = adjacentCells(h.at).filter(c =>
        inBounds(s, c) && isPassable(s, c, /*forHero*/ false) && !cellOccupied(s, c, false),
      );
      const at = adj[0] ?? h.at;
      const stats = monsterStats(kind);
      const id = `wand_${s.logSeq + 1}_${Math.floor(Math.random() * 1e6)}`;
      const m: Monster = {
        id,
        kind,
        at,
        body: stats.bodyMax,
        bodyMax: stats.bodyMax,
        attack: stats.attack,
        defense: stats.defense,
        move: stats.move,
        gold: stats.gold,
        roomId: s.tiles[h.at.y][h.at.x].region,
      };
      s.monsters.push(m);
      pushLog(s, 'spawn', `A wandering ${stats.displayName} appears next to ${h.username}!`);
      s.treasureDiscard.push(card);
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

/** Orthogonally adjacent (side/front/rear) — the only way monsters may attack
 *  (rulebook p.20: monsters may not move or attack diagonally). */
function orthoAdjacent(a: Coord, b: Coord): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
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

/** Visibility for LOOKING & REVEALING (the PHYSICAL PLAYER's view) — separate
 *  from character line of sight. Stricter so the reveal doesn't leak: you can't
 *  peek diagonally past a wall corner, and you can't see THROUGH a room (its
 *  walls stop the line). Used only to decide which hallway tiles to place. */
function revealVisible(s: HQState, a: Coord, b: Coord): boolean {
  const cells = bresenham(a, b);
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1], c = cells[i];
    const ortho = Math.abs(prev.x - c.x) + Math.abs(prev.y - c.y) === 1;
    if (ortho) {
      if (edgeBlocksSight(s, prev, c)) return false;
    } else {
      // No peeking around a corner: a diagonal is blocked if EITHER corner edge
      // is a wall, or either corner cell is solid rock.
      const e1 = edgeBlocksSight(s, prev, { x: c.x, y: prev.y });
      const e2 = edgeBlocksSight(s, prev, { x: prev.x, y: c.y });
      if (e1 || e2) return false;
      if (s.tiles[prev.y]?.[c.x]?.kind === 'wall' || s.tiles[c.y]?.[prev.x]?.kind === 'wall') return false;
    }
    if (i < cells.length - 1) {
      if (!inBounds(s, c)) return false;
      const t = s.tiles[c.y][c.x];
      if (t.kind === 'wall' || t.kind === 'blocked') return false;
      if (t.region.startsWith('room_')) return false; // can't see through a room
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

/** Lazily instantiate monsters that belong to the just-revealed room. */
function spawnRoomMonsters(s: HQState, region: string): void {
  if (!region) return;
  for (const monDef of s.quest.monsters) {
    if (monDef.roomId !== region) continue;
    if (s.monsters.some(m => m.id === monDef.id)) continue;  // already alive
    s.monsters.push(instantiateMonster(monDef));
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

  // Look down hallways: reveal non-room cells (corridor / stairs / blocked) that
  // are in a straight, unobstructed line of sight — all the way until a wall,
  // but never a room interior (rooms reveal only when their door is opened).
  for (let y = 0; y < s.tiles.length; y++) {
    for (let x = 0; x < s.tiles[0].length; x++) {
      const t = s.tiles[y][x];
      if (t.revealed) continue;
      if (t.kind === 'wall') continue;
      if (t.region.startsWith('room_')) continue; // never reveal a room by looking
      if (x === h.at.x && y === h.at.y) continue;
      if (!revealVisible(s, h.at, { x, y })) continue;
      t.revealed = true;
    }
  }

  // Spawn monsters for any room that's now revealed (your own room, or one whose
  // door was just opened).
  spawnRevealedRooms(s);
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
