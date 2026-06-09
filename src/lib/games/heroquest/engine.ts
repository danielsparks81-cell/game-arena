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
  type DreadSpellId,
  type Hero,
  type HeroClass,
  type Item,
  type LogEntry,
  type Monster,
  type MonsterKind,
  type MonsterPersonality,
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
  ARMORY,
  HERO_DEFAULTS,
  MONSTER_STATS,
  QUESTS,
  CAMPAIGN,
  buildTreasureDeck,
  instantiateMonster,
  makeHero,
  spellsByElement,
} from './content';

// ============================================================================
// State factory / lifecycle
// ============================================================================

export function initialState(questId: string = 'quest_zero'): HQState {
  const quest = QUESTS[questId] ?? QUESTS.quest_zero;
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

const ALL_ELEMENTS: Array<'air' | 'water' | 'fire' | 'earth'> = ['air', 'water', 'fire', 'earth'];

/**
 * Apply final spell assignments once both draft picks are known.
 * wizardSchool = the ONE school the wizard claimed in the draft.
 * elfSchool    = the ONE school the elf claimed.
 * Wizard receives ALL schools EXCEPT elfSchool; elf receives elfSchool only.
 */
function applySpellDraft(
  s: HQState,
  wizardSchool: 'air' | 'water' | 'fire' | 'earth' | null,
  elfSchool:    'air' | 'water' | 'fire' | 'earth' | null,
): void {
  const elf = s.heroes.find(h => h.klass === 'elf');
  const wiz = s.heroes.find(h => h.klass === 'wizard');
  const groups = spellsByElement();

  if (elf && elfSchool) {
    elf.spells = groups[elfSchool].map(sp => ({ ...sp }));
    elf.spellsCast = [];
  }
  if (wiz) {
    const wizSchools = ALL_ELEMENTS.filter(e => e !== elfSchool);
    wiz.spells = wizSchools.flatMap(g => groups[g].map(sp => ({ ...sp })));
    wiz.spellsCast = [];
    void wizardSchool; // captured in draft state for the log; unused directly here
  }
}

/**
 * Begin the pre-quest spell draft after start_game.
 * Draft order: wizard picks first (if present), then elf.
 * If only elf is present, elf picks from all 4 schools.
 * If only wizard, they get everything — no draft needed.
 */
function beginSpellDraft(s: HQState): void {
  const hasElf = s.heroes.some(h => h.klass === 'elf');
  const hasWiz = s.heroes.some(h => h.klass === 'wizard');

  if (!hasElf && !hasWiz) return; // no spellcasters — skip entirely

  if (!hasElf) {
    // Wizard gets every school automatically; no draft UI needed.
    applySpellDraft(s, null, null);
    return;
  }

  // At least elf is present — start the draft.
  s.phase = 'spell_draft';
  s.spellDraft = {
    step: hasWiz ? 'wizard' : 'elf',
    wizardSchool: null,
    remaining: [...ALL_ELEMENTS],
  };
}

function doPickSpellSchool(
  state: HQState,
  playerId: string,
  school: 'air' | 'water' | 'fire' | 'earth',
): ApplyResult {
  if (state.phase !== 'spell_draft') return err('No spell draft is in progress.');
  const draft = state.spellDraft;
  if (!draft) return err('Draft state missing.');

  if (!draft.remaining.includes(school)) return err('That school is not available.');

  const s = clone(state);
  const d = s.spellDraft!;

  if (d.step === 'wizard') {
    const wiz = s.heroes.find(h => h.klass === 'wizard');
    if (!wiz || wiz.playerId !== playerId) return err('Only the Wizard may pick first.');
    d.wizardSchool = school;
    d.remaining = d.remaining.filter(e => e !== school);
    // Is there an elf to pick next?
    const elf = s.heroes.find(h => h.klass === 'elf');
    if (elf) {
      d.step = 'elf';
      pushLog(s, 'system', `The Wizard claims the ${school.charAt(0).toUpperCase() + school.slice(1)} school. The Elf chooses next.`);
    } else {
      // No elf — wizard gets everything, draft done.
      applySpellDraft(s, school, null);
      s.spellDraft = null;
      s.phase = 'heroes';
      pushLog(s, 'system', `The Wizard claims all spell schools. The quest begins!`);
      for (const h of s.heroes) revealLineOfSightForHero(s, h);
    }
    return ok(s);
  }

  // step === 'elf'
  const elf = s.heroes.find(h => h.klass === 'elf');
  if (!elf || elf.playerId !== playerId) return err('Only the Elf may pick now.');
  applySpellDraft(s, d.wizardSchool, school);
  s.spellDraft = null;
  s.phase = 'heroes';
  const elfName = school.charAt(0).toUpperCase() + school.slice(1);
  const wizSchools = ALL_ELEMENTS.filter(e => e !== school);
  pushLog(s, 'system', `The Elf claims ${elfName}. The Wizard takes ${wizSchools.join(', ')}. The quest begins!`);
  for (const h of s.heroes) revealLineOfSightForHero(s, h);
  return ok(s);
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
    if (state.phase !== 'lobby' && state.phase !== 'finished' && state.phase !== 'intermission')
      return err('Quest already underway.');
    const claimed = state.heroes.filter(h => h.playerId);
    if (claimed.length < 1) return err('Need at least one player to start the quest.');
    // Quest routing:
    //   lobby        → always start from the top of the campaign (CAMPAIGN[0]).
    //   intermission → heroes won and visited the Armory → advance to next quest.
    //   finished + heroes won → (final quest, no next) → replay same quest.
    //   finished + heroes lost → retry the same quest.
    let nextQuestId: string;
    if (state.phase === 'lobby') {
      nextQuestId = CAMPAIGN[0];
    } else if (state.phase === 'intermission' || state.winner === 'heroes') {
      const idx = CAMPAIGN.indexOf(state.questId);
      nextQuestId = (idx >= 0 && idx + 1 < CAMPAIGN.length)
        ? CAMPAIGN[idx + 1]
        : state.questId;
    } else {
      nextQuestId = state.questId;
    }
    // Rebuild from a FRESH initialState so the quest content always reflects the
    // current code. A room's lobby state snapshots the quest when the room is
    // created, so a room made before a quest update would otherwise start with
    // stale content. We carry over who claimed each hero slot (seat → class is
    // fixed), then proceed exactly as before.
    const s = initialState(nextQuestId);
    const campaignAdvance = state.winner === 'heroes';
    state.heroes.forEach((old, i) => {
      if (!s.heroes[i]) return;
      s.heroes[i].playerId    = old.playerId;
      s.heroes[i].username    = old.username;
      s.heroes[i].accent_color = old.accent_color;
      if (!campaignAdvance) return;
      // Gold, potions, and non-starting equipment persist between quests.
      // Intermission purchases are already in old.items / old.foundPotions.
      if (old.gold) s.heroes[i].gold = old.gold;
      if (old.foundPotions?.length) s.heroes[i].foundPotions = [...old.foundPotions];
      // Carry over items bought/earned during the quest (exclude starting items
      // that the fresh initialState already provides to avoid duplicates).
      const startingIds = new Set(s.heroes[i].items.map((it: { id: string }) => it.id));
      const extra = (old.items ?? []).filter(it => !startingIds.has(it.id));
      if (extra.length) s.heroes[i].items = [...s.heroes[i].items, ...extra];
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
    s.phase = 'heroes'; // temporary — beginSpellDraft may change this to 'spell_draft'
    s.turnIndex = 0;
    pushLog(s, 'system', `Quest "${s.quest.name}" begins.`);
    pushLog(s, 'system', s.quest.briefing);
    // Begin the spell draft (sets phase to 'spell_draft' if casters present,
    // otherwise assigns spells immediately and keeps phase as 'heroes').
    beginSpellDraft(s);
    if (s.phase === 'heroes') {
      // No draft needed — reveal starting LOS now.
      for (const h of s.heroes) revealLineOfSightForHero(s, h);
      pushLog(s, 'system', `It is ${heroLabel(s.heroes[0])}'s turn.`);
    } else {
      const firstPicker = s.spellDraft?.step === 'wizard' ? 'The Wizard' : 'The Elf';
      pushLog(s, 'system', `${firstPicker} must choose a spell school before the quest begins.`);
    }
    return ok(s);
  }

  // Spell draft picks can arrive while phase === 'spell_draft'.
  if (action.kind === 'pick_spell_school') return doPickSpellSchool(state, playerId, action.school);

  // Death-save prompt: must be resolved before any other action proceeds.
  if (action.kind === 'death_save') return doDeathSave(state, playerId, action.choice);
  if (state.pendingDeathSave) return err('A hero is at death\'s door — resolve the death save first.');

  // Exit-dungeon prompt: the hero at the stairway must decide before play resumes.
  if (action.kind === 'exit_dungeon') return doExitDungeon(state, playerId, action.confirm);
  if (state.pendingPrompt?.kind === 'exit_dungeon') return err('A hero is at the stairway — they must choose to leave or stay first.');

  // Falling-block retreat: the affected hero must pick a safe adjacent square.
  if (action.kind === 'falling_block_move') return doFallingBlockMove(state, playerId, action.at);
  if (state.pendingPrompt?.kind === 'falling_block') return err('A falling block is in play — choose a square to retreat to first.');

  // Zargon's turn advances one monster at a time. Any client may request a step
  // (the host drives it on a timer); it's a no-op unless it's Zargon's phase.
  if (action.kind === 'zargon_step') return doZargonStep(state);

  // Intermission: between-quest Armory. Any player may buy/trade for their heroes.
  if (action.kind === 'buy_item')  return doIntermissionBuyItem(state, playerId, action.heroSeat, action.itemId);
  if (action.kind === 'pass_item') return doIntermissionPassItem(state, playerId, action.heroSeat, action.itemId, action.toHeroSeat);

  // Mid-game gating: only the active player can act.
  if (state.phase !== 'heroes') return err('Wait for the engine to finish.');
  const hero = state.heroes[state.turnIndex];
  if (!hero) return err('No active hero.');
  if (hero.playerId !== playerId) return err('It is not your turn.');
  if (hero.body <= 0) return err('You are dead.');
  if (hero.escaped) return err('You have already escaped the dungeon.');

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
  if (hero.dazed)      return err('You are dazed and cannot act this turn.');
  if (hero.asleep)     return err('You are under a Sleep spell and cannot move.');
  if (hero.paralyzed)  return err('You are paralyzed and cannot move.');
  if (hero.commanded)  return err('You are under Zargon\'s Command and cannot act on your own.');
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
    // Veil of Mist: hero may walk through monster squares (but can't stop on one —
    // that's enforced separately by doMovePath's final-dest check).
    if (!h.phaseMonsters && s.monsters.some(m => m.at.x === sq.x && m.at.y === sq.y)) break;

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
        // Stumble in: -1 BP, movement and turn both end immediately.
        // On subsequent turns the hero forfeits movement to climb out (doClimbPit).
        h.inPit = true;
        h.body = Math.max(0, h.body - 1);
        h.moveLeft = 0;
        pushLog(s, 'trap', `${heroLabel(h)} stumbles into a pit trap! (-1 BP)`);
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        settle();
        advanceTurnAfterTrap(s); // falling in ends the turn
        return;
      }

      if (trap.kind === 'falling_block') {
        // Roll 3 dice, -1 BP per skull, NO defence; the square is sealed forever
        // (a permanent wall) and the hero must choose an adjacent square to retreat to.
        const roll = rollDice(3, 'hero');
        s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
        h.body = Math.max(0, h.body - roll.skulls);
        s.tiles[sq.y][sq.x] = { ...s.tiles[sq.y][sq.x], kind: 'blocked', revealed: true };
        h.moveLeft = 0;
        h.hasActed = true; // springing a falling block ends the turn
        // Park the hero at cameFrom BEFORE calling checkHeroDeath so that if they
        // die, the loot pile lands on a reachable square (sq is now sealed/blocked).
        h.at = { ...cameFrom };
        pushLog(s, 'trap',
          `${heroLabel(h)} springs a falling block! The ceiling caves in` +
          (roll.skulls > 0 ? ` (-${roll.skulls} BP)` : ' (no damage)') +
          ' — the square is sealed.');
        checkHeroDeath(s, h);
        // If the hero died (or is waiting on a death-save), don't present a retreat
        // prompt — the pendingDeathSave UI takes priority, and when the hero declines
        // (or there is no save) killHero auto-advances the turn.
        if (h.body <= 0 || s.pendingDeathSave) {
          revealLineOfSightForHero(s, h);
          return;
        }
        // Compute which adjacent squares the hero can retreat to (the sealed
        // square is now blocked, so only its other orthogonal neighbours qualify).
        const heroIdx = s.heroes.findIndex(x => x.seat === h.seat);
        const dirs = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
        const options: Coord[] = dirs
          .map(d => ({ x: sq.x + d.x, y: sq.y + d.y }))
          .filter(c =>
            inBounds(s, c) &&
            isPassable(s, c, true) &&
            !s.monsters.some(m => m.at.x === c.x && m.at.y === c.y) &&
            !s.heroes.some(o => o.seat !== h.seat && o.body > 0 && o.at.x === c.x && o.at.y === c.y),
          );
        if (options.length === 0) {
          // Nowhere to go — extra -2 BP penalty; hero stays at cameFrom.
          h.body = Math.max(0, h.body - 2);
          pushLog(s, 'trap', `${heroLabel(h)} is crushed with no room to escape! (−2 BP)`);
          checkHeroDeath(s, h);
          revealLineOfSightForHero(s, h);
        } else if (options.length === 1) {
          // Only one option — resolve automatically, no prompt needed.
          h.at = { ...options[0] };
          revealLineOfSightForHero(s, h);
        } else {
          // Multiple options — let the player choose. h.at is already cameFrom.
          revealLineOfSightForHero(s, h);
          s.pendingPrompt = { kind: 'falling_block', heroIdx, options, sealedAt: { ...sq } };
        }
        return;
      }

      // Spear: roll 1 die. Any shield = dodge (no damage, keep moving); a skull =
      // struck (-1 BP, turn ends). One-time either way (already marked triggered).
      const roll = rollDice(1, 'hero');
      s.lastRoll = roll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
      if (roll.faces[0] === 'skull') {
        h.body = Math.max(0, h.body - 1);
        h.moveLeft = 0;
        h.hasActed = true; // struck by a spear ends the turn — only a dodge lets you keep going
        pushLog(s, 'trap', `${heroLabel(h)} is struck by a spear trap! (-1 BP)`);
        checkHeroDeath(s, h);
        revealLineOfSightForHero(s, h);
        settle();
        return;
      }
      pushLog(s, 'trap', `${heroLabel(h)} dodges a spear trap — it snaps shut, harmless.`);
      // fall through: the dodge counts as a normal step and the walk continues.
    }

    // Auto-collect any loot pile on this square (not an action — just walk over it).
    collectLoot(s, h);

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
  if (hero.asleep || hero.paralyzed || hero.commanded)
    return err('You cannot move while under a Dread spell effect.');
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
  if (hero.asleep || hero.paralyzed || hero.commanded)
    return err('You cannot move while under a Dread spell effect.');
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
      // Veil of Mist: hero may pass THROUGH monster squares but cannot stop there.
      // The dest-stop check is enforced by doMoveTo/doMovePath, not here.
      if (!hero.phaseMonsters && s.monsters.some(m => m.at.x === n.x && m.at.y === n.y)) continue;
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
  if (hero.asleep || hero.paralyzed || hero.commanded)
    return err('You cannot open doors while under a Dread spell effect.');
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
  // Dread status effects that block attacking entirely.
  if (hero.asleep)    return err('You are under a Sleep spell and cannot attack.');
  if (hero.paralyzed) return err('You are paralyzed and cannot attack.');
  if (hero.commanded) return err('You are under Zargon\'s Command and cannot act on your own.');
  // Courage grants one bonus attack even after the action is spent.
  const usingExtraAttack = hero.hasActed && !!hero.extraAttack;
  if (hero.hasActed && !usingExtraAttack) return err('You have already taken your action this turn.');
  const mon = state.monsters.find(m => m.id === monsterId);
  if (!mon) return err('Target not found.');
  // Adjacency / range check. Orthogonal melee requires no wall edge between the
  // two squares (edgeBlocksMove). Diagonal melee (special weapon trait) skips
  // the edge check since edgeBlocksMove is only defined for orthogonal pairs.
  // Ranged attacks need line of sight instead.
  const allowDiag = hero.items.some(i => i.diagonal);
  const allowRanged = hero.items.some(i => i.ranged);
  const dx = Math.abs(mon.at.x - hero.at.x);
  const dy = Math.abs(mon.at.y - hero.at.y);
  const orthoAdj = dx + dy === 1 && !edgeBlocksMove(state, hero.at, mon.at, false);
  const diagAdj  = allowDiag && dx === 1 && dy === 1;
  const adj = orthoAdj || diagAdj;
  const ranged = allowRanged && hasLineOfSight(state, hero.at, mon.at);
  if (!adj && !ranged) return err('Target is out of reach.');

  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  const m = s.monsters.find(mm => mm.id === monsterId)!;
  // Attack roll — Courage + Potion of Strength add bonus dice; fighting from
  // a pit costs one die (min 1, rulebook p.17).
  // Dread Fear: hero may only use 1 Attack die (overrides base + bonuses).
  const spellBonus  = h.attackBonus    ?? 0;
  const potionBonus = h.potionAtkBonus ?? 0;
  const bonus = spellBonus + potionBonus;
  const baseAttackDice = h.feared
    ? 1  // Dread Fear: only 1 die regardless of gear or bonuses
    : Math.max(1, h.attack + bonus - (h.inPit ? 1 : 0));
  const atk = rollDice(baseAttackDice, 'hero');
  if (h.feared) {
    pushLog(s, 'spell', `${heroLabel(h)} is gripped by Fear — attacking with only 1 die!`);
  }
  s.lastRoll = atk;
  s.lastMoveRoll = null;
  // Defense roll.
  const def = rollDice(m.defense, 'monster');
  s.lastDefenseRoll = def;
  const damage = Math.max(0, atk.skulls - def.blocks);
  m.body -= damage;
  const bonusNote = h.feared ? ' (Fear: 1 die only)'
    : spellBonus > 0 && potionBonus > 0
      ? ` (Courage +${spellBonus}, Strength potion +${potionBonus} dice)`
      : spellBonus > 0 ? ` (Courage +${spellBonus} dice)`
      : potionBonus > 0 ? ` (Strength potion +${potionBonus} dice)` : '';
  pushLog(s, 'combat',
    `${heroLabel(h)} attacks ${monsterDisplay(m)} — ${atk.skulls} skulls vs ${def.blocks} blocks${bonusNote}. ` +
    (damage > 0 ? `${monsterDisplay(m)} takes ${damage} BP.` : 'No damage.'),
  );
  let escaped = false;
  if (m.body <= 0) {
    // Auto-escape: a monster with an available ds_escape vanishes instead of dying
    // (no gold, no kill credit, no win-condition trigger).
    escaped = tryAutoEscape(s, m);
    if (!escaped) {
      pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
      if (m.goldMin !== undefined && m.goldMax !== undefined) {
        const gold = m.goldMin + Math.floor(Math.random() * (m.goldMax - m.goldMin + 1));
        h.gold += gold;
        pushLog(s, 'system', `${heroLabel(h)} loots ${gold} gold from the fallen ${monsterDisplay(m)}.`);
      }
      s.monsters = s.monsters.filter(mm => mm.id !== m.id);
    }
  }
  // Strength potion bonus is consumed on this strike (one-shot per cast).
  // Courage (attackBonus) is NOT consumed here — it persists for every attack
  // as long as the hero can see at least one monster (expires via LOS check
  // in checkHeroTurnStart).
  h.potionAtkBonus = 0;
  if (usingExtraAttack) h.extraAttack = false;
  else markActed(h);
  // Only check win condition if the monster was actually killed (not escaped).
  if (!escaped) maybeFinishOnKill(s, m);
  return ok(s);
}

function doSearchTreasure(state: HQState, hero: Hero): ApplyResult {
  if (hero.asleep || hero.paralyzed || hero.commanded)
    return err('You cannot search while under a Dread spell effect.');
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
  if (hero.asleep || hero.paralyzed || hero.commanded)
    return err('You cannot search while under a Dread spell effect.');
  if (hero.hasActed) return err('You have already taken your action this turn.');
  const region = state.tiles[hero.at.y][hero.at.x].region;
  if (!region) return err('Invalid location.');
  if (state.heroes.some(h => h.searchedTraps.includes(region))) return err('This area has already been searched for traps.');
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
  if (state.heroes.some(h => h.searchedSecrets.includes(region))) return err('This area has already been searched for secret doors.');
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
    h.moveLeft = 0;
    checkHeroDeath(s, h);
    revealLineOfSightForHero(s, h);
    advanceTurnAfterTrap(s); // falling in ends the turn
    return ok(s);
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
  if (hero.hasRolled) return err('You already rolled movement this turn — climb out before rolling.');
  const s = clone(state);
  const h = s.heroes[s.turnIndex];
  h.inPit = false;
  // Climbing out forfeits the hero's entire movement for the turn.
  // They can still take their action (attack, search, etc.) after climbing.
  h.moveLeft = 0;
  h.hasRolled = true; // movement phase consumed — hero cannot roll after climbing
  pushLog(s, 'move', `${heroLabel(h)} hauls themselves out of the pit (movement forfeited).`);
  return ok(s);
}

// ============================================================================
// Intermission — between-quest Armory
// ============================================================================

function doIntermissionBuyItem(state: HQState, playerId: string, heroSeat: number, itemId: string): ApplyResult {
  if ((state.phase as string) !== 'intermission') return err('The Armory is only open between quests.');
  const hero = state.heroes[heroSeat];
  if (!hero) return err('Invalid hero seat.');
  if (hero.playerId !== playerId) return err('You do not control that hero.');

  const item = ARMORY.find(it => it.id === itemId);
  if (!item) return err('That item is not sold in the Armory.');
  if (!item.cost) return err('That item has no price.');
  if ((hero.gold ?? 0) < item.cost) return err(`Not enough gold — this costs ${item.cost} gp.`);
  if (item.noWizard && hero.klass === 'wizard') return err('The Wizard cannot use that item.');

  const s = clone(state);
  const h = s.heroes[heroSeat];
  h.gold = (h.gold ?? 0) - item.cost;
  h.items = [...(h.items ?? []), { ...item }];
  pushLog(s, 'search', `${heroLabel(h)} buys ${item.name} for ${item.cost} gp.`);
  return ok(s);
}

function doIntermissionPassItem(state: HQState, playerId: string, heroSeat: number, itemId: string, toHeroSeat: number): ApplyResult {
  if ((state.phase as string) !== 'intermission') return err('Items can only be traded between quests.');
  const giver = state.heroes[heroSeat];
  if (!giver) return err('Invalid hero seat.');
  if (giver.playerId !== playerId) return err('You do not control that hero.');
  const receiver = state.heroes[toHeroSeat];
  if (!receiver) return err('Invalid target hero seat.');
  if (receiver.seat === giver.seat) return err('Cannot pass an item to yourself.');

  const itemIdx = (giver.items ?? []).findIndex(it => it.id === itemId);
  if (itemIdx < 0) return err('That hero does not have that item.');
  const item = giver.items[itemIdx];
  if (item.noWizard && receiver.klass === 'wizard') return err('The Wizard cannot use that item.');

  const s = clone(state);
  const g = s.heroes[heroSeat];
  const r = s.heroes[toHeroSeat];
  g.items = g.items.filter((_, i) => i !== itemIdx);
  r.items = [...(r.items ?? []), { ...item }];
  pushLog(s, 'move', `${heroLabel(g)} gives ${item.name} to ${heroLabel(r)}.`);
  return ok(s);
}

function doCastSpell(
  state: HQState,
  hero: Hero,
  action: Extract<HQAction, { kind: 'cast_spell' }>,
): ApplyResult {
  if (hero.asleep)    return err('You are under a Sleep spell and cannot cast.');
  if (hero.paralyzed) return err('You are paralyzed and cannot cast spells.');
  if (hero.commanded) return err('You are under Zargon\'s Command and cannot act on your own.');
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
    case 'heal_body_e': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const restored = Math.min(target.bodyMax - target.body, 4);
        target.body += restored;
        pushLog(s, 'spell', `${heroLabel(target)} regains ${restored} BP.`);
      }
      return ok(s);
    }
    case 'sleep': {
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. Spell wasted.`); return ok(s); }
      if (m.kind === 'skeleton' || m.kind === 'zombie' || m.kind === 'mummy') {
        pushLog(s, 'spell', `…but undead cannot be put to sleep! The spell has no effect.`); return ok(s);
      }
      if (m.sleeping) { pushLog(s, 'spell', `${monsterDisplay(m)} is already asleep.`); return ok(s); }
      m.sleeping = true;
      pushLog(s, 'spell', `${monsterDisplay(m)} sinks into a deep magical sleep!`);
      return ok(s);
    }
    case 'water_heal': {
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (target) {
        const restored = Math.min(target.bodyMax - target.body, 4);
        target.body += restored;
        pushLog(s, 'spell', `${heroLabel(target)} regains ${restored} BP.`);
      }
      return ok(s);
    }
    case 'fire_of_wrath': {
      // Fire of Wrath: 1 automatic BP to any visible monster. Monster then rolls
      // 1d6 — on a 6 the damage is reduced by 1 (effectively blocked).
      // The save die is surfaced as lastDefenseRoll so the dice overlay triggers
      // and the board delay holds monster death off the canvas until after the reveal.
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. Spell wasted.`); return ok(s); }
      const saveRoll = Math.floor(Math.random() * 6) + 1;
      const saved    = saveRoll === 6 ? 1 : 0;
      const saveFace: DieFace = saveRoll === 6 ? 'black_shield' : 'skull';
      const damage   = Math.max(0, 1 - saved);
      s.lastRoll     = null;
      s.lastMoveRoll = null;
      // Expose save die as defense roll so the dice overlay fires before the board updates.
      s.lastDefenseRoll = { faces: [saveFace], skulls: 1 - saved, blocks: saved, rolledBy: 'monster' };
      if (damage > 0) {
        m.body -= damage;
        pushLog(s, 'spell', `${monsterDisplay(m)} is scorched for ${damage} BP! (save roll: ${saveRoll})`);
      } else {
        pushLog(s, 'spell', `${monsterDisplay(m)} rolls a 6 — the flame is resisted!`);
      }
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }
    case 'ball_of_flame': {
      // Ball of Flame: 2 automatic BP to any visible monster. Monster then rolls
      // 2d6 — each 6 reduces the damage by 1 (min 0).
      // Both save dice are surfaced as lastDefenseRoll (revealed one at a time).
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the spell fizzles.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. Spell wasted.`); return ok(s); }
      const save1 = Math.floor(Math.random() * 6) + 1;
      const save2 = Math.floor(Math.random() * 6) + 1;
      const face1: DieFace = save1 === 6 ? 'black_shield' : 'skull';
      const face2: DieFace = save2 === 6 ? 'black_shield' : 'skull';
      const sixes  = (save1 === 6 ? 1 : 0) + (save2 === 6 ? 1 : 0);
      const damage = Math.max(0, 2 - sixes);
      s.lastRoll     = null;
      s.lastMoveRoll = null;
      s.lastDefenseRoll = { faces: [face1, face2], skulls: 2 - sixes, blocks: sixes, rolledBy: 'monster' };
      m.body -= damage;
      pushLog(s, 'spell',
        `${monsterDisplay(m)} is engulfed — ${damage} BP damage! (save rolls: ${save1}, ${save2}` +
        (sixes > 0 ? `; ${sixes} saved` : '') + `)`,
      );
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }

    // --- Air ----------------------------------------------------------------
    case 'genie': {
      // Dual-mode: open ANY door on the board (no adjacency needed), OR attack
      // any visible monster with 5 combat dice (monster defends normally).
      if (action.targetDoorId) {
        const d = s.doors.find(dd => dd.id === action.targetDoorId);
        if (!d) { pushLog(s, 'spell', `…but that door does not exist.`); return ok(s); }
        if (d.open) { pushLog(s, 'spell', `…but that door is already open.`); return ok(s); }
        d.open = true;
        for (const c of d.crossings) {
          for (const cell of [c.a, c.b]) {
            const r = s.tiles[cell.y]?.[cell.x]?.region ?? '';
            if (r.startsWith('room_')) { revealRegion(s, r); spawnRoomMonsters(s, r); }
          }
        }
        revealLineOfSightForHero(s, h);
        pushLog(s, 'spell', `The genie flings a door open — the chamber beyond is revealed!`);
        return ok(s);
      }
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the genie vanishes.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. The genie returns to its lamp.`); return ok(s); }
      const genieRoll = rollDice(5, 'hero');
      s.lastRoll = genieRoll; s.lastDefenseRoll = null; s.lastMoveRoll = null;
      const genieDef = rollDice(m.defense, 'monster');
      s.lastDefenseRoll = genieDef;
      const genieDmg = Math.max(0, genieRoll.skulls - genieDef.blocks);
      m.body -= genieDmg;
      pushLog(s, 'spell', `The genie strikes ${monsterDisplay(m)} for ${genieDmg} BP!`);
      if (m.body <= 0) {
        pushLog(s, 'death', `${monsterDisplay(m)} is destroyed!`);
        s.monsters = s.monsters.filter(mm => mm.id !== m.id);
        maybeFinishOnKill(s, m);
      }
      return ok(s);
    }
    case 'tempest': {
      // Envelops ONE monster of the hero's choice in a whirlwind — that monster
      // misses its next turn.
      const m = action.targetMonsterId ? s.monsters.find(mm => mm.id === action.targetMonsterId) : null;
      if (!m) { pushLog(s, 'spell', `…but with no valid target, the tempest dissipates.`); return ok(s); }
      if (!hasLineOfSight(s, h.at, m.at)) { pushLog(s, 'spell', `…but you cannot see the target. The tempest blows past.`); return ok(s); }
      m.stunned = true;
      pushLog(s, 'spell', `${monsterDisplay(m)} is caught in a whirlwind and will lose its next turn!`);
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
      // Target hero may move through monster-occupied squares on their next move.
      // Does NOT grant extra movement — the flag just makes monsters transparent
      // to pathfinding/walking. It clears at end of their next turn.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.phaseMonsters = true;
      pushLog(s, 'spell', `${heroLabel(target)} is shrouded in mist — may pass through monster spaces on their next move.`);
      return ok(s);
    }

    // --- Fire ---------------------------------------------------------------
    case 'courage': {
      // Target hero gains +2 attack dice on their NEXT attack. The caster's
      // action is spent on the spell; the buff carries into the target's next turn.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.attackBonus = (target.attackBonus ?? 0) + 2;
      pushLog(s, 'spell', `${heroLabel(target)} is emboldened — +2 attack dice on their next attack!`);
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
      // Target hero gains +1 defense die. This bonus is only removed the moment
      // the hero actually suffers 1 BP of damage — NOT at turn end.
      const target = action.targetHeroIdx != null ? s.heroes[action.targetHeroIdx] : h;
      if (!target || target.body <= 0) { pushLog(s, 'spell', `…but the target has fallen.`); return ok(s); }
      target.defenseBonus = (target.defenseBonus ?? 0) + 1;
      pushLog(s, 'spell', `${heroLabel(target)}'s skin turns to stone — +1 defense die until they take damage.`);
      return ok(s);
    }

    default:
      // Any spell without an implemented effect still consumes the action.
      pushLog(s, 'spell', `(${spell.name} shimmers, but nothing happens.)`);
      return ok(s);
  }
}

/** Shared turn-advancement logic used by doEndTurn and any trap that
 *  immediately ends the hero's turn (pit fall, etc.).  `s` must already be
 *  a cloned state; the function mutates it in-place. */
function advanceTurnAfterTrap(s: HQState): void {
  const roundDone = endHeroTurn(s);
  if (roundDone) { beginZargonTurn(s); return; }
  if ((s.phase as string) === 'finished') return;
  // Skip any dazed heroes who lose their turn.
  while ((s.phase as string) !== 'finished') {
    const next = s.heroes[s.turnIndex];
    if (!next || !next.dazed) break;
    next.dazed = false;
    pushLog(s, 'spell', `${heroLabel(next)} is caught in a whirlwind and loses their turn!`);
    if (endHeroTurn(s)) { beginZargonTurn(s); return; }
  }
  if ((s.phase as string) === 'finished') return;
  checkHeroTurnStart(s);
  pushLog(s, 'system', `It is ${heroLabel(s.heroes[s.turnIndex])}'s turn.`);
}

function doEndTurn(state: HQState, hero: Hero): ApplyResult {
  const s = clone(state);
  advanceTurnAfterTrap(s);
  return ok(s);
}

/** Return the seat index of the next hero (after `fromSeat`, wrapping) that is
 *  alive and not escaped.  Returns null only when no active hero exists. */
function nextActiveHeroSeat(s: HQState, fromSeat: number): number | null {
  for (let i = 1; i <= s.heroes.length; i++) {
    const h = s.heroes[(fromSeat + i) % s.heroes.length];
    if (h.body > 0 && !h.escaped) return h.seat;
  }
  return null;
}

/** Clear per-turn flags for the current hero and advance turnIndex to the next
 *  active (alive + not escaped) hero.  Returns true when the advance wrapped
 *  past the last hero in seat order — the caller should then start Zargon's
 *  turn.  Returns false if more heroes remain in this round. */
function endHeroTurn(s: HQState): boolean {
  const h = s.heroes[s.turnIndex];
  const fromSeat = s.turnIndex; // seat === index (heroes are stored in seat order)
  h.moveLeft = 0;
  h.moveRolled = 0;
  h.hasRolled = false;
  h.hasActed = false;
  // Single-turn spell buffs expire with the turn that used them.
  // Rock Skin's defenseBonus is intentionally NOT cleared here — it lasts
  // through the upcoming Zargon turn and clears when the hero's next turn
  // begins. Similarly, Potion of Defense (potionDefBonus) persists until the
  // hero is actually hit — it is NOT cleared at turn end.
  // Courage (attackBonus) does NOT expire at turn end — it persists until the
  // hero has no monsters in LOS (checked in checkHeroTurnStart each turn).
  h.potionAtkBonus = 0;  // Potion of Strength: unused bonus expires at turn end
  h.extraAttack    = false;
  h.phaseWalls     = false;
  h.phaseMonsters  = false; // Veil of Mist: clears after the hero's move turn
  // Rock Skin (defenseBonus) is NOT cleared here — it persists until the hero
  // actually takes damage. See the monster-attack logic in runMonster.

  // Advance to next active hero, skipping dead and escaped heroes.
  // nextSeat <= fromSeat means we wrapped past the 3→0 boundary, i.e. the
  // round is complete and Zargon should act next.
  const nextSeat = nextActiveHeroSeat(s, fromSeat);
  if (nextSeat === null) return false; // no active heroes — quest ending via maybeEndQuest
  s.turnIndex = nextSeat;
  return nextSeat <= fromSeat; // true = round wrapped → caller starts Zargon's turn
}

// ============================================================================
// Zargon (engine) turn
// ============================================================================

/** Begin Zargon's turn. Monsters act one at a time via zargon_step.
 *  Commanded heroes are slotted into the queue FIRST (before monsters) so their
 *  forced move/attack fires before the monster wave.  Entries are either a
 *  monster id or a `cmd_N` sentinel (N = hero seat index). */
function beginZargonTurn(s: HQState): void {
  if (s.phase !== 'heroes') return;
  s.phase = 'zargon';
  pushLog(s, 'zargon', '— Zargon\'s turn —');
  // Commanded heroes act first (they fight on Zargon's behalf).
  const commandedSentinels = s.heroes
    .filter(h => h.body > 0 && h.commanded)
    .map(h => `cmd_${h.seat}`);
  s.zargonQueue = [...commandedSentinels, ...s.monsters.map(m => m.id)];
  s.zargonActed = [];
  s.zargonActiveId = null;
  if (s.zargonQueue.length === 0) finishZargonTurn(s); // no actors → straight back
}

/** Resolve ONE actor's action (spotlighting it), or end Zargon's turn when the
 *  queue is empty. Actors are either a monster id or a `cmd_N` sentinel for a
 *  commanded hero (N = seat index). A no-op outside Zargon's phase. */
function doZargonStep(state: HQState): ApplyResult {
  if (state.phase !== 'zargon') return ok(state);
  const s = clone(state);
  const queue = s.zargonQueue ?? [];
  if (queue.length === 0) { finishZargonTurn(s); return ok(s); }
  const id = queue[0];
  s.zargonQueue = queue.slice(1);
  s.zargonActiveId = id;
  (s.zargonActed ??= []).push(id);
  if (id.startsWith('cmd_')) {
    // Commanded hero acts on Zargon's behalf.
    const seat = parseInt(id.slice(4), 10);
    const h = s.heroes[seat];
    if (h && h.body > 0 && h.commanded) doCommandedHeroAct(s, h);
  } else {
    const m = s.monsters.find(mm => mm.id === id);
    if (m && m.body > 0) runMonster(s, m);
  }
  if ((s.phase as Phase) === 'finished') clearZargon(s);
  return ok(s);
}

function finishZargonTurn(s: HQState): void {
  clearZargon(s);
  if ((s.phase as Phase) === 'finished') return;
  // A hero may have died or escaped DURING Zargon's turn; if so, turnIndex now
  // points to an inactive hero.  Advance to the first active hero for the new
  // round (lowest seat, wrapping from the end of the seat list so we search
  // seats 0 → 1 → 2 → 3 in order).
  const current = s.heroes[s.turnIndex];
  if (!current || current.body <= 0 || current.escaped) {
    const nextSeat = nextActiveHeroSeat(s, s.heroes.length - 1);
    if (nextSeat === null) return; // all heroes resolved — maybeEndQuest() handles it
    s.turnIndex = nextSeat;
  }
  // Skip dazed heroes (Dread Tempest — they miss their next turn entirely).
  while ((s.phase as string) !== 'finished') {
    const h = s.heroes[s.turnIndex];
    if (!h || !h.dazed) break;
    h.dazed = false;
    pushLog(s, 'spell', `${heroLabel(h)} is caught in a whirlwind and loses their turn!`);
    if (endHeroTurn(s)) {
      beginZargonTurn(s);
      return;
    }
  }
  if ((s.phase as string) === 'finished') return;
  // Roll mind-break checks for the first hero of the new round.
  checkHeroTurnStart(s);
  s.phase = 'heroes';
  pushLog(s, 'system', `It is ${heroLabel(s.heroes[s.turnIndex])}'s turn.`);
}

function clearZargon(s: HQState): void {
  s.zargonQueue = undefined;
  s.zargonActiveId = null;
  s.zargonActed = undefined;
}

// ============================================================================
// Dread spell system
// ============================================================================

/** Roll N d6 dice and report whether any show a 6 (mind-break condition). */
function rollMindD6(mindPoints: number): { dice: number[]; broke: boolean } {
  const n = Math.max(1, mindPoints);
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(1 + Math.floor(Math.random() * 6));
  return { dice, broke: dice.some(d => d === 6) };
}

/** Trace a straight-line ray from `from` in direction `dir`.
 *  Returns each cell the bolt passes through (not including the origin).
 *  The ray stops the step BEFORE a wall tile and at closed-door edges (using
 *  the lenient `&&` diagonal LOS rule — a bolt clips through an open corner). */
function traceRay(
  s: HQState,
  from: Coord,
  dir: { dx: number; dy: number },
): Coord[] {
  const cells: Coord[] = [];
  let cur = { ...from };
  for (let step = 0; step < 40; step++) {
    const next = { x: cur.x + dir.dx, y: cur.y + dir.dy };
    if (!inBounds(s, next)) break;
    const t = s.tiles[next.y]?.[next.x];
    if (!t || t.kind === 'wall' || t.kind === 'blocked') break;
    // Check whether the edge (or diagonal corner) stops the bolt.
    const isOrtho = Math.abs(dir.dx) + Math.abs(dir.dy) === 1;
    if (isOrtho) {
      if (edgeBlocksMove(s, cur, next, false)) break;
    } else {
      // Diagonal: blocked only when BOTH corner edges are sealed (same as hasLineOfSight).
      const e1 = edgeBlocksMove(s, cur, { x: next.x, y: cur.y }, false);
      const e2 = edgeBlocksMove(s, cur, { x: cur.x, y: next.y }, false);
      if (e1 && e2) break;
    }
    cells.push({ ...next });
    cur = next;
  }
  return cells;
}

/** Place `count` summoned monsters of `kind` as close to `caster` as possible.
 *  Uses a BFS that expands outward; each free, passable cell gets one monster
 *  until the count is met.  Newly-summoned monsters use default stats from the
 *  monster stat table and inherit the caster's roomId region. */
function summonNearCaster(
  s: HQState,
  caster: Monster,
  kind: MonsterKind,
  count: number,
): void {
  const stats = MONSTER_STATS[kind];
  const visited = new Set<string>([`${caster.at.x},${caster.at.y}`]);
  // Seed BFS with the caster's immediate neighbours.
  const queue: Coord[] = adjacentCells(caster.at).filter(c => {
    if (!inBounds(s, c)) return false;
    visited.add(`${c.x},${c.y}`);
    return true;
  });
  let placed = 0;
  while (queue.length > 0 && placed < count) {
    const cell = queue.shift()!;
    const free =
      isPassable(s, cell, false) &&
      !s.heroes.some(h => h.body > 0 && h.at.x === cell.x && h.at.y === cell.y) &&
      !s.monsters.some(mm => mm.at.x === cell.x && mm.at.y === cell.y);
    if (free) {
      s.monsters.push({
        id: `${kind}_summon_${s.logSeq}_${placed}`,
        kind,
        at: { ...cell },
        body: stats.bodyMax,
        bodyMax: stats.bodyMax,
        attack: stats.attack,
        defense: stats.defense,
        move: stats.move,
        mind: stats.mind,
        goldMin: stats.goldMin,
        goldMax: stats.goldMax,
        roomId: regionOf(s, cell) || caster.roomId,
        personality: assignPersonality(),
      });
      placed++;
    }
    // Expand to neighbours so we can find cells further out if needed.
    for (const next of adjacentCells(cell)) {
      const key = `${next.x},${next.y}`;
      if (!visited.has(key) && inBounds(s, next)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }
  if (placed > 0) {
    pushLog(
      s, 'spawn',
      `${placed} ${stats.displayName}${placed !== 1 ? 's' : ''} materialise near ${monsterDisplay(caster)}!`,
    );
  }
}

/** Return the best dread spell id available for `m` to cast this turn, or null
 *  if none are available / applicable. Priority: status effects first (high
 *  impact), then damage, then summons, then escape (last resort). */
function chooseDreadSpell(s: HQState, m: Monster): DreadSpellId | null {
  const available = (m.dreadSpells ?? []).filter(
    id => !(m.dreadSpellsUsed ?? []).includes(id),
  );
  if (available.length === 0) return null;

  const living = s.heroes.filter(h => h.body > 0);
  if (living.length === 0) return null;

  // Priority order for the AI — pick the first applicable spell.
  const priority: DreadSpellId[] = [
    'ds_cloud_of_dread', 'ds_command', 'ds_sleep', 'ds_fear',
    'ds_firestorm', 'ds_ball_of_flame', 'ds_lightning_bolt', 'ds_rust',
    'ds_summon_undead', 'ds_summon_orcs',
    'ds_tempest',
    'ds_escape',
  ];

  for (const id of priority) {
    if (!available.includes(id)) continue;
    // Check preconditions per spell.
    if (id === 'ds_firestorm') {
      // Room-only: caster must be in a room (not a corridor).
      if (!regionOf(s, m.at).startsWith('room_')) continue;
      const _fsRegion = regionOf(s, m.at);
      // Only worth casting if there are heroes in the same room.
      const _fsHeroes = living.filter(h => regionOf(s, h.at) === _fsRegion);
      if (_fsHeroes.length === 0) continue;
      // Zargon won't firestorm if there are MORE monster allies than hero targets —
      // it would kill more of its own forces than the heroes. Equal counts are fine.
      const _fsMonsters = s.monsters.filter(mm => mm.id !== m.id && regionOf(s, mm.at) === _fsRegion);
      if (_fsMonsters.length > _fsHeroes.length) continue;
    }
    if (id === 'ds_cloud_of_dread') {
      // At least one non-paralyzed hero nearby (same room or adjacent cell).
      const casterRegion = regionOf(s, m.at);
      const targets = living.filter(h =>
        !h.paralyzed &&
        (regionOf(s, h.at) === casterRegion ||
          (Math.abs(h.at.x - m.at.x) <= 2 && Math.abs(h.at.y - m.at.y) <= 2)),
      );
      if (targets.length === 0) continue;
    }
    if (['ds_ball_of_flame', 'ds_fear', 'ds_sleep', 'ds_tempest', 'ds_command', 'ds_rust'].includes(id)) {
      // Needs a visible, living hero.
      const visible = living.filter(h => hasLineOfSight(s, m.at, h.at));
      if (visible.length === 0) continue;
    }
    if (id === 'ds_escape') {
      // Only cast escape if the monster is badly hurt (≤ 25% body).
      if (m.body > Math.ceil(m.bodyMax * 0.25)) continue;
    }
    return id;
  }
  return null;
}

/** Execute a Dread spell for monster `m`. Marks the spell as used, applies its
 *  effect to the board state `s`. */
function doCastDreadSpell(s: HQState, m: Monster, spellId: DreadSpellId): void {
  // Mark the spell as spent before resolving so it can never be double-cast.
  m.dreadSpellsUsed = [...(m.dreadSpellsUsed ?? []), spellId];

  const living = s.heroes.filter(h => h.body > 0);
  if (living.length === 0) return;

  // Helper: pick the living hero with the best condition to be targeted.
  // For offensive spells: the one with the most remaining BP (most to lose).
  const pickTarget = (exclude?: (h: Hero) => boolean): Hero | null => {
    const pool = living.filter(h =>
      hasLineOfSight(s, m.at, h.at) && !(exclude?.(h) ?? false),
    );
    if (pool.length === 0) return null;
    return pool.reduce((best, h) => (h.body > best.body ? h : best));
  };

  pushLog(s, 'spell', `${monsterDisplay(m)} calls upon dark magic — ${spellId.replace('ds_', '').replace(/_/g, ' ')}!`);

  switch (spellId) {
    // ── Damage spells ──────────────────────────────────────────────────────
    case 'ds_ball_of_flame': {
      // Target the hero with the LOWEST remaining BP — most wounded and least able to absorb the hit.
      // LOS required (chooseDreadSpell already blocks if no hero is visible, but guard here too).
      const bofPool = living.filter(h => hasLineOfSight(s, m.at, h.at));
      if (bofPool.length === 0) { pushLog(s, 'spell', '…but no hero is in sight. Zargon holds the spell.'); break; }
      const target = bofPool.reduce((best, h) => (h.body < best.body ? h : best));
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      // Mitigation: each die that shows a 6 reduces damage by 1 (matches the hero spell rule — 6 only).
      const reduces = (d1 === 6 ? 1 : 0) + (d2 === 6 ? 1 : 0);
      const dmg = Math.max(0, 2 - reduces);
      target.body = Math.max(0, target.body - dmg);
      pushLog(s, 'spell',
        `${heroLabel(target)} (lowest BP — ${target.body + dmg} remaining) is struck by a Ball of Flame! Save rolls: [${d1}, ${d2}] (${reduces} reduced) → ${dmg} BP damage.`,
      );
      if (dmg > 0) { target.defenseBonus = 0; checkHeroDeath(s, target); }
      break;
    }

    case 'ds_lightning_bolt': {
      // Pick the direction that hits the most heroes; fall back to a random direction.
      const dirs = [
        {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},
        {dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1},
      ];
      let bestDir = dirs[0];
      let bestScore = -1;
      for (const dir of dirs) {
        const cells = traceRay(s, m.at, dir);
        const heroHits = cells.filter(c => living.some(h => h.at.x === c.x && h.at.y === c.y)).length;
        if (heroHits > bestScore) { bestScore = heroHits; bestDir = dir; }
      }
      const rayCells = traceRay(s, m.at, bestDir);
      const hitHeroes = living.filter(h => rayCells.some(c => c.x === h.at.x && c.y === h.at.y));
      const hitMonsters = s.monsters.filter(mm =>
        mm.id !== m.id && rayCells.some(c => c.x === mm.at.x && c.y === mm.at.y),
      );
      if (hitHeroes.length === 0 && hitMonsters.length === 0) {
        pushLog(s, 'spell', '…the bolt discharges harmlessly into a wall.');
        break;
      }
      pushLog(s, 'spell', `A bolt of lightning tears down the corridor!`);
      for (const h of hitHeroes) {
        h.body = Math.max(0, h.body - 2);
        if (h.body < h.body + 2) h.defenseBonus = 0;
        pushLog(s, 'spell', `${heroLabel(h)} is struck! (−2 BP)`);
        checkHeroDeath(s, h);
      }
      for (const mm of hitMonsters) {
        mm.body = Math.max(0, mm.body - 2);
        pushLog(s, 'spell', `${monsterDisplay(mm)} is struck! (−2 BP)`);
        if (mm.body <= 0) {
          pushLog(s, 'death', `${monsterDisplay(mm)} is destroyed!`);
          s.monsters = s.monsters.filter(x => x.id !== mm.id);
        }
      }
      break;
    }

    case 'ds_firestorm': {
      const casterRegion = regionOf(s, m.at);
      if (!casterRegion.startsWith('room_')) {
        pushLog(s, 'spell', '…but the firestorm cannot ignite in a corridor. Spell wasted.');
        break;
      }
      const heroesInRoom = living.filter(h => regionOf(s, h.at) === casterRegion);
      const monstersInRoom = s.monsters.filter(mm =>
        mm.id !== m.id && regionOf(s, mm.at) === casterRegion,
      );
      if (heroesInRoom.length + monstersInRoom.length === 0) {
        pushLog(s, 'spell', '…but no targets are in the room. Spell wasted.');
        break;
      }
      pushLog(s, 'spell', `A Firestorm engulfs the room!`);
      for (const h of heroesInRoom) {
        // Each victim rolls 3d6 — each 6 reduces damage by 1 (max 3 reduces = full dodge on triple-6).
        const d1 = 1 + Math.floor(Math.random() * 6);
        const d2 = 1 + Math.floor(Math.random() * 6);
        const d3 = 1 + Math.floor(Math.random() * 6);
        const reduces = (d1 === 6 ? 1 : 0) + (d2 === 6 ? 1 : 0) + (d3 === 6 ? 1 : 0);
        const dmg = Math.max(0, 3 - reduces);
        h.body = Math.max(0, h.body - dmg);
        if (dmg > 0) h.defenseBonus = 0;
        pushLog(s, 'spell',
          `${heroLabel(h)} — save rolls: [${d1}, ${d2}, ${d3}]${reduces > 0 ? ` (${reduces} six${reduces > 1 ? 'es' : ''} — ${reduces} damage reduced!)` : ''} → ${dmg} BP damage.`,
        );
        checkHeroDeath(s, h);
      }
      for (const mm of monstersInRoom) {
        const d1 = 1 + Math.floor(Math.random() * 6);
        const d2 = 1 + Math.floor(Math.random() * 6);
        const d3 = 1 + Math.floor(Math.random() * 6);
        const reduces = (d1 === 6 ? 1 : 0) + (d2 === 6 ? 1 : 0) + (d3 === 6 ? 1 : 0);
        const dmg = Math.max(0, 3 - reduces);
        mm.body = Math.max(0, mm.body - dmg);
        pushLog(s, 'spell',
          `${monsterDisplay(mm)} — save rolls: [${d1}, ${d2}, ${d3}]${reduces > 0 ? ` (${reduces} six${reduces > 1 ? 'es' : ''} — ${reduces} damage reduced!)` : ''} → ${dmg} BP damage.`,
        );
        if (mm.body <= 0) {
          pushLog(s, 'death', `${monsterDisplay(mm)} is destroyed!`);
          s.monsters = s.monsters.filter(x => x.id !== mm.id);
        }
      }
      break;
    }

    // ── Item destruction ───────────────────────────────────────────────────
    case 'ds_rust': {
      // Target: the hero with a metal weapon or helmet (not an artifact).
      // Prefer a visible hero; if none visible, skip.
      const rustTargets = living.filter(h =>
        hasLineOfSight(s, m.at, h.at) &&
        h.items.some(i =>
          i.kind !== 'artifact' &&
          (i.kind === 'weapon' || (i.kind === 'armor' && i.id === 'helmet')),
        ),
      );
      if (rustTargets.length === 0) {
        pushLog(s, 'spell', '…but no hero has a metal weapon or helmet in sight. Spell wasted.');
        break;
      }
      // Pick the target with the most attack power (destroy the biggest threat).
      const rustTarget = rustTargets.reduce((best, h) => {
        const bestItem = best.items.find(i => i.kind === 'weapon');
        const hItem    = h.items.find(i => i.kind === 'weapon');
        return (hItem?.attack ?? 0) > (bestItem?.attack ?? 0) ? h : best;
      });
      // Find the best weapon to destroy (highest attack), else target a helmet.
      const metalWeapon = rustTarget.items
        .filter(i => i.kind === 'weapon')  // artifacts have kind 'artifact', not 'weapon'
        .sort((a, b) => (b.attack ?? 0) - (a.attack ?? 0))[0];
      const helmet = rustTarget.items.find(i => i.id === 'helmet');
      const victim = metalWeapon ?? helmet;
      if (!victim) break;
      rustTarget.items = rustTarget.items.filter(i => i.id !== victim.id);
      // Recalculate attack/defense after losing the item.
      const remainingWeapons = rustTarget.items.filter(i => i.kind === 'weapon');
      const bestWeaponAttack = remainingWeapons.reduce((max, i) => Math.max(max, i.attack ?? 0), 0);
      if (metalWeapon) {
        const base = HERO_DEFAULTS[rustTarget.klass].baseAttack;
        rustTarget.attack = Math.max(base, bestWeaponAttack);
      }
      const armorDice = rustTarget.items.filter(i => i.kind === 'armor')
        .reduce((sum, i) => sum + (i.defense ?? 0), 0);
      if (helmet) {
        const base = HERO_DEFAULTS[rustTarget.klass].baseDefense;
        rustTarget.defense = base + armorDice;
      }
      pushLog(s, 'spell',
        `${heroLabel(rustTarget)}'s ${victim.name} crumbles to rust and is destroyed permanently!`,
      );
      break;
    }

    // ── Status effects ─────────────────────────────────────────────────────
    case 'ds_fear': {
      const target = pickTarget(h => !!h.feared);
      if (!target) { pushLog(s, 'spell', '…but no valid target is in sight. Spell wasted.'); break; }
      target.feared = true;
      pushLog(s, 'spell',
        `${heroLabel(target)} is gripped by Fear! They may only use 1 Attack die until they break free.`,
      );
      break;
    }

    case 'ds_sleep': {
      const target = pickTarget(h => !!h.asleep);
      if (!target) { pushLog(s, 'spell', '…but no valid target is in sight. Spell wasted.'); break; }
      // Immediate break attempt.
      const { dice, broke } = rollMindD6(target.mind ?? 0);
      if (broke) {
        pushLog(s, 'spell',
          `${heroLabel(target)} resists the Sleep spell! (mind roll: ${dice.join(', ')})`,
        );
      } else {
        target.asleep = true;
        pushLog(s, 'spell',
          `${heroLabel(target)} falls into a magical sleep! (mind roll: ${dice.join(', ')} — failed to resist)`,
        );
      }
      break;
    }

    case 'ds_tempest': {
      const target = pickTarget(h => !!h.dazed);
      if (!target) { pushLog(s, 'spell', '…but no valid target is in sight. Spell wasted.'); break; }
      target.dazed = true;
      pushLog(s, 'spell',
        `A whirlwind envelops ${heroLabel(target)}! They will lose their next turn.`,
      );
      break;
    }

    case 'ds_command': {
      // Target the visible hero with the LOWEST Mind Points — they have the fewest
      // dice to roll the 6 needed to break free, so Command lasts longer on them.
      const cmdPool = living.filter(h => !h.commanded && hasLineOfSight(s, m.at, h.at));
      if (cmdPool.length === 0) { pushLog(s, 'spell', '…but no valid target is in sight. Spell wasted.'); break; }
      cmdPool.sort((a, b) => (a.mind ?? 0) - (b.mind ?? 0));
      const target = cmdPool[0];
      target.commanded = true;
      pushLog(s, 'spell',
        `${heroLabel(target)} falls under Zargon's Command (${target.mind ?? 0} Mind Points — hardest to break)! They will fight for the darkness.`,
      );
      break;
    }

    case 'ds_cloud_of_dread': {
      const casterRegion = regionOf(s, m.at);
      // Affect all heroes in the same region (room or corridor).
      const affected = living.filter(h =>
        !h.paralyzed && regionOf(s, h.at) === casterRegion,
      );
      if (affected.length === 0) {
        pushLog(s, 'spell', '…but no heroes share this space. Spell wasted.');
        break;
      }
      pushLog(s, 'spell', `A Cloud of Dread descends!`);
      for (const h of affected) {
        const { dice, broke } = rollMindD6(h.mind ?? 0);
        if (broke) {
          pushLog(s, 'spell',
            `${heroLabel(h)} resists the paralysis! (mind roll: ${dice.join(', ')})`,
          );
        } else {
          h.paralyzed = true;
          pushLog(s, 'spell',
            `${heroLabel(h)} is paralyzed! (mind roll: ${dice.join(', ')} — failed to resist)`,
          );
        }
      }
      break;
    }

    // ── Summons ────────────────────────────────────────────────────────────
    case 'ds_summon_orcs': {
      // Lookup: 1-3 → 4 orcs, 4-5 → 5 orcs, 6 → 6 orcs.
      const roll = 1 + Math.floor(Math.random() * 6);
      const count = roll <= 3 ? 4 : roll <= 5 ? 5 : 6;
      pushLog(s, 'spell', `${monsterDisplay(m)} summons orc reinforcements! (rolled ${roll} → ${count} orcs)`);
      summonNearCaster(s, m, 'orc', count);
      break;
    }

    case 'ds_summon_undead': {
      // Lookup table determines composition (escalating power with higher rolls):
      //   1-3 → 4 skeletons
      //   4-5 → 3 skeletons + 2 zombies
      //   6   → 2 zombies + 2 mummies
      const roll = 1 + Math.floor(Math.random() * 6);
      pushLog(s, 'spell', `${monsterDisplay(m)} raises the dead! (rolled ${roll})`);
      if (roll <= 3) {
        pushLog(s, 'spell', `4 skeletons claw their way from the ground!`);
        summonNearCaster(s, m, 'skeleton', 4);
      } else if (roll <= 5) {
        pushLog(s, 'spell', `3 skeletons and 2 zombies shamble forth!`);
        summonNearCaster(s, m, 'skeleton', 3);
        summonNearCaster(s, m, 'zombie', 2);
      } else {
        pushLog(s, 'spell', `2 zombies and 2 mummies emerge from the darkness!`);
        summonNearCaster(s, m, 'zombie', 2);
        summonNearCaster(s, m, 'mummy', 2);
      }
      break;
    }

    // ── Self ───────────────────────────────────────────────────────────────
    case 'ds_escape': {
      pushLog(s, 'spell',
        `${monsterDisplay(m)} vanishes in a cloud of smoke — escaping to a secret location!`,
      );
      s.monsters = s.monsters.filter(mm => mm.id !== m.id);
      // Note: win-condition checks are not triggered by Escape — the monster
      // is simply removed from play (like a retreat, not a kill).
      break;
    }
  }
}

/** Handle a hero who is under the Command spell during Zargon's turn.
 *  The hero moves toward the nearest free (non-commanded) hero and attacks them. */
function doCommandedHeroAct(s: HQState, h: Hero): void {
  const targets = s.heroes.filter(t => t.body > 0 && !t.commanded && t.seat !== h.seat);
  if (targets.length === 0) return;
  // Nearest target by Chebyshev distance.
  targets.sort((a, b) => chebyshev(a.at, h.at) - chebyshev(b.at, h.at));
  const target = targets[0];
  const dist = chebyshev(h.at, target.at);
  if (dist <= 1) {
    // Adjacent — attack.
    const atkDice = Math.max(1, h.attack);
    const atk = rollDice(atkDice, 'monster');
    s.lastRoll = atk;
    s.lastMoveRoll = null;
    const def = rollDice(Math.max(1, target.defense + (target.defenseBonus ?? 0)), 'hero');
    s.lastDefenseRoll = def;
    target.potionDefBonus = 0;
    const dmg = Math.max(0, atk.skulls - def.blocks);
    target.body = Math.max(0, target.body - dmg);
    if (dmg > 0) target.defenseBonus = 0;
    pushLog(s, 'combat',
      `${heroLabel(h)} (commanded) attacks ${heroLabel(target)} — ${atk.skulls} skulls vs ${def.blocks} blocks. ` +
      (dmg > 0 ? `${heroLabel(target)} loses ${dmg} BP!` : 'No damage.'),
    );
    checkHeroDeath(s, target);
  } else {
    // Move one step toward the nearest target.
    const dx = Math.sign(target.at.x - h.at.x);
    const dy = Math.sign(target.at.y - h.at.y);
    const candidates = [
      { x: h.at.x + dx, y: h.at.y },
      { x: h.at.x, y: h.at.y + dy },
      { x: h.at.x + dx, y: h.at.y + dy },
    ].filter(c =>
      inBounds(s, c) && isPassable(s, c, false) &&
      !edgeBlocksMove(s, h.at, c, false) &&
      !s.monsters.some(mm => mm.at.x === c.x && mm.at.y === c.y) &&
      !s.heroes.some(o => o.seat !== h.seat && o.body > 0 && o.at.x === c.x && o.at.y === c.y),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => chebyshev(a, target.at) - chebyshev(b, target.at));
      h.at = { ...candidates[0] };
      pushLog(s, 'move',
        `${heroLabel(h)} (commanded) is compelled toward ${heroLabel(target)}...`,
      );
    }
  }
}

/** Called at the START of each hero's turn (before logging "It is X's turn").
 *  Handles per-turn status effect resolution:
 *  - Dazed: cleared automatically (turn was already skipped via beginHeroTurnSkipDazed).
 *  - Fear / Sleep / Command / Paralyzed: roll 1d6 per Mind Point; any 6 = break free. */
function checkHeroTurnStart(s: HQState): void {
  const h = s.heroes[s.turnIndex];
  if (!h || h.body <= 0) return;

  // Courage (attackBonus) expires when the hero can no longer see any monster.
  if ((h.attackBonus ?? 0) > 0) {
    const canSeeMonster = s.monsters.some(mm => hasLineOfSight(s, h.at, mm.at));
    if (!canSeeMonster) {
      h.attackBonus = 0;
      pushLog(s, 'spell', `${heroLabel(h)}'s Courage fades — no monsters in sight.`);
    }
  }

  const effects: Array<{ flag: keyof Hero; label: string }> = [
    { flag: 'feared',    label: 'Fear' },
    { flag: 'asleep',    label: 'Sleep' },
    { flag: 'commanded', label: 'Command' },
    { flag: 'paralyzed', label: 'Cloud of Dread' },
  ];

  for (const { flag, label } of effects) {
    if (!h[flag]) continue;
    const mind = h.mind ?? 0;
    if (mind === 0) {
      pushLog(s, 'spell',
        `${heroLabel(h)} has 0 Mind Points and cannot break free from ${label}!`,
      );
      continue;
    }
    const { dice, broke } = rollMindD6(mind);
    if (broke) {
      // TypeScript won't let us assign via a generic keyof key — cast to any.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h as any)[flag] = false;
      pushLog(s, 'spell',
        `${heroLabel(h)} breaks free from ${label}! (mind roll: ${dice.join(', ')})`,
      );
    } else {
      pushLog(s, 'spell',
        `${heroLabel(h)} cannot shake off ${label}. (mind roll: ${dice.join(', ')})`,
      );
    }
  }
}

/** Advance past any dazed hero(s) mid-round and call checkHeroTurnStart for the
 *  first non-dazed hero.  Returns true if Zargon's turn should begin instead. */
function advanceToNextActiveTurn(s: HQState): boolean {
  // Skip any dazed heroes — they miss the turn automatically.
  while ((s.phase as string) !== 'finished') {
    const h = s.heroes[s.turnIndex];
    if (!h || !h.dazed) break;
    h.dazed = false;
    pushLog(s, 'spell', `${heroLabel(h)} is caught in a whirlwind and loses their turn!`);
    const roundDone = endHeroTurn(s);
    if (roundDone) return true;  // caller starts Zargon's turn
  }
  checkHeroTurnStart(s);
  return false;
}

/** Check whether a monster that just dropped to 0 BP has an available ds_escape
 *  and should vanish instead of dying.  If it escapes:
 *  - The monster is removed from the board (but NOT counted as a hero kill).
 *  - No gold is awarded, no win-condition trigger fires.
 *  Returns true if the escape fired; the caller must skip normal death processing. */
function tryAutoEscape(s: HQState, m: Monster): boolean {
  if (!m.dreadSpells?.includes('ds_escape')) return false;
  if (m.dreadSpellsUsed?.includes('ds_escape')) return false;  // already spent
  m.dreadSpellsUsed = [...(m.dreadSpellsUsed ?? []), 'ds_escape'];
  pushLog(s, 'spell',
    `${monsterDisplay(m)} vanishes in a swirl of shadow — escaping at death's door! The killing blow was in vain.`,
  );
  s.monsters = s.monsters.filter(mm => mm.id !== m.id);
  return true;
}

function runMonster(s: HQState, m: Monster): void {
  // Tempest: a stunned monster loses this turn (the flag clears as it's spent).
  if (m.stunned) {
    m.stunned = false;
    pushLog(s, 'zargon', `${monsterDisplay(m)} is dazed by the tempest and cannot act.`);
    return;
  }
  // Sleep: roll 1d6 per Mind Point at the start of the monster's turn.
  // If any die shows a 6 the spell breaks (monster wakes but still skips this turn).
  if (m.sleeping) {
    const mindPoints = m.mind ?? 0;
    if (mindPoints === 0) {
      // No mind — sleep is unbreakable by nature (undead have mind 0 but can't be
      // slept, so this branch only fires for hypothetical mind-0 non-undead).
      pushLog(s, 'zargon', `${monsterDisplay(m)} remains in a deep, dreamless sleep.`);
      return;
    }
    const wakeRolls: number[] = [];
    for (let i = 0; i < mindPoints; i++) wakeRolls.push(Math.floor(Math.random() * 6) + 1);
    const woke = wakeRolls.some(r => r === 6);
    if (woke) {
      m.sleeping = false;
      pushLog(s, 'zargon', `${monsterDisplay(m)} jolts awake! (rolls: ${wakeRolls.join(', ')}) — but loses this turn.`);
    } else {
      pushLog(s, 'zargon', `${monsterDisplay(m)} stirs but cannot wake. (rolls: ${wakeRolls.join(', ')})`);
    }
    return; // Waking up counts as the monster's turn.
  }
  const living = s.heroes.filter(h => h.body > 0);
  if (living.length === 0) return;

  // Dread spells: if this monster has an available spell, it casts it INSTEAD
  // of performing a normal move/attack this turn.  Quest notes assign which
  // spells a specific monster may use.
  if (m.dreadSpells && m.dreadSpells.length > 0) {
    const spellId = chooseDreadSpell(s, m);
    if (spellId) {
      doCastDreadSpell(s, m, spellId);
      return; // spell replaces the normal turn
    }
  }

  const personality = m.personality ?? 'aggressor';

  // Sort heroes by this personality's preferred target order.
  const sorted = [...living].sort((a, b) => {
    if (personality === 'predator') {
      // Hunting the most wounded hero — lowest raw BP first.
      return a.body - b.body || chebyshev(a.at, m.at) - chebyshev(b.at, m.at);
    }
    if (personality === 'aggressor') {
      // Always attacks nearest; lower raw BP breaks a distance tie.
      const da = Math.abs(a.at.x - m.at.x) + Math.abs(a.at.y - m.at.y);
      const db = Math.abs(b.at.x - m.at.x) + Math.abs(b.at.y - m.at.y);
      return da - db || a.body - b.body;
    }
    // Methodical: fewest effective defense dice first (defense stat + Rock Skin
    // bonus − pit penalty); tie-break by proximity.
    const defA = (a.defense + (a.defenseBonus ?? 0)) - (a.inPit ? 1 : 0);
    const defB = (b.defense + (b.defenseBonus ?? 0)) - (b.inPit ? 1 : 0);
    return defA - defB || chebyshev(a.at, m.at) - chebyshev(b.at, m.at);
  });

  const primary = sorted[0];

  // BFS: every square this monster can reach within its move allowance.
  const reachable = monsterReachableSquares(s, m);

  // Try to attack the primary target this turn.
  const primarySquares = attackSquaresFor(s, m, primary, reachable);
  if (primarySquares.length > 0) {
    const dest = pickBestAttackSquare(s, m, primary, primarySquares, personality, null);
    m.at = { ...dest };
    doMonsterAttack(s, m, primary);
    return;
  }

  // Primary target unreachable — apply personality fallback.
  if (personality === 'predator') {
    // The Predator still wants to close on its quarry. If another hero is in
    // range, it attacks them but positions on the "far side" (the attack square
    // closest to the primary target) to be one step closer next turn.
    const intermediate = sorted.slice(1).find(
      h => attackSquaresFor(s, m, h, reachable).length > 0,
    );
    if (intermediate) {
      const intSquares = attackSquaresFor(s, m, intermediate, reachable);
      // Pass `primary` so pickBestAttackSquare applies the far-side tie-break.
      const dest = pickBestAttackSquare(s, m, intermediate, intSquares, 'predator', primary);
      m.at = { ...dest };
      pushLog(s, 'zargon',
        `${monsterDisplay(m)} stalks toward ${heroLabel(primary)}, cutting through ${heroLabel(intermediate)}!`,
      );
      doMonsterAttack(s, m, intermediate);
      return;
    }
    // No hero within reach — advance toward the quarry.
    moveTowardGreedy(s, m, primary.at);
    return;
  }

  // Aggressor / Methodical: fall back to the nearest hero they CAN reach.
  const fallback = living
    .map(h => ({ h, squares: attackSquaresFor(s, m, h, reachable) }))
    .filter(x => x.squares.length > 0)
    .sort((a, b) => chebyshev(a.h.at, m.at) - chebyshev(b.h.at, m.at))[0];

  if (fallback) {
    const dest = pickBestAttackSquare(s, m, fallback.h, fallback.squares, personality, null);
    m.at = { ...dest };
    doMonsterAttack(s, m, fallback.h);
    return;
  }

  // No hero attackable from anywhere this turn — move toward primary.
  moveTowardGreedy(s, m, primary.at);
}

// ============================================================================
// Monster personality helpers (called by runMonster above)
// ============================================================================

/** Pick a random personality at spawn — hidden from players until observed. */
function assignPersonality(): MonsterPersonality {
  const r = Math.random();
  if (r < 1 / 3) return 'predator';
  if (r < 2 / 3) return 'aggressor';
  return 'methodical';
}

/** BFS: return every square this monster can reach within its move allowance.
 *  Includes the monster's own square (dist=0 = stay in place).
 *  Heroes and other monsters block passage but are not themselves reachable
 *  destinations — the monster cannot end its move in an occupied cell. */
function monsterReachableSquares(s: HQState, m: Monster): Set<string> {
  const reachable = new Set<string>();
  const visited   = new Set<string>();
  const queue: Array<{ pos: Coord; dist: number }> = [{ pos: m.at, dist: 0 }];
  visited.add(`${m.at.x},${m.at.y}`);
  while (queue.length > 0) {
    const item = queue.shift()!;
    reachable.add(`${item.pos.x},${item.pos.y}`);
    if (item.dist >= m.move) continue;
    for (const next of adjacentCells(item.pos)) {
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;
      if (!inBounds(s, next)) continue;
      if (!isPassable(s, next, false)) continue;
      if (edgeBlocksMove(s, item.pos, next, false)) continue;
      // Can't walk into a square occupied by a living hero or another monster.
      if (s.heroes.some(h => h.body > 0 && h.at.x === next.x && h.at.y === next.y)) continue;
      if (s.monsters.some(mm => mm.id !== m.id && mm.at.x === next.x && mm.at.y === next.y)) continue;
      visited.add(key);
      queue.push({ pos: next, dist: item.dist + 1 });
    }
  }
  return reachable;
}

/** All squares adjacent to `target` (orthogonal AND diagonal) where this monster
 *  could stand to deliver a melee attack: reachable by BFS, no wall blocking the
 *  strike, not occupied by another monster (this monster's own square is OK). */
function attackSquaresFor(s: HQState, m: Monster, target: Hero, reachable: Set<string>): Coord[] {
  return allAdjacentCells(target.at).filter(c =>
    inBounds(s, c) &&
    isPassable(s, c, false) &&
    reachable.has(`${c.x},${c.y}`) &&
    !wallBetween(s, c, target.at) &&
    !s.monsters.some(mm => mm.id !== m.id && mm.at.x === c.x && mm.at.y === c.y),
  );
}

/** Count how many adjacent attack squares (orthogonal + diagonal) around `target`
 *  would remain free for OTHER monsters after this monster claims `mySquare`.
 *  More free squares = less blocking = better for the team. */
function countFreeAttackPositions(s: HQState, m: Monster, target: Hero, mySquare: Coord): number {
  return allAdjacentCells(target.at).filter(c =>
    inBounds(s, c) &&
    isPassable(s, c, false) &&
    !wallBetween(s, c, target.at) &&
    !(c.x === mySquare.x && c.y === mySquare.y) &&
    !s.monsters.some(mm => mm.id !== m.id && mm.at.x === c.x && mm.at.y === c.y),
  ).length;
}

/** From a list of valid attack squares, pick the best one:
 *  1. Don't-block heuristic — prefer the square that leaves the most OTHER attack
 *     lanes around the target open for teammate monsters.
 *  2. Predator far-side tie-break — when tied on free lanes, prefer the square
 *     closest to `primaryTarget` to set up next-turn approach.
 *  3. Minimum movement — prefer staying close to current position. */
function pickBestAttackSquare(
  s: HQState,
  m: Monster,
  target: Hero,
  squares: Coord[],
  personality: MonsterPersonality,
  primaryTarget: Hero | null,
): Coord {
  if (squares.length === 1) return squares[0];
  return squares.reduce((best, c) => {
    const freeC    = countFreeAttackPositions(s, m, target, c);
    const freeBest = countFreeAttackPositions(s, m, target, best);
    if (freeC !== freeBest) return freeC > freeBest ? c : best;
    if (personality === 'predator' && primaryTarget) {
      const distC    = Math.abs(c.x    - primaryTarget.at.x) + Math.abs(c.y    - primaryTarget.at.y);
      const distBest = Math.abs(best.x - primaryTarget.at.x) + Math.abs(best.y - primaryTarget.at.y);
      if (distC !== distBest) return distC < distBest ? c : best;
    }
    const moveC    = Math.abs(c.x    - m.at.x) + Math.abs(c.y    - m.at.y);
    const moveBest = Math.abs(best.x - m.at.x) + Math.abs(best.y - m.at.y);
    return moveC < moveBest ? c : best;
  });
}

/** Execute the monster's melee attack roll against a hero and apply damage.
 *  If the hero is sleeping or paralyzed they cannot defend — all skulls land. */
function doMonsterAttack(s: HQState, m: Monster, target: Hero): void {
  const atk = rollDice(m.attack, 'monster');
  s.lastRoll     = atk;
  s.lastMoveRoll = null;

  // Sleeping / paralyzed heroes cannot defend — damage is unmitigated.
  const canDefend = !target.asleep && !target.paralyzed;

  let damage: number;
  let def: DiceRoll;
  if (canDefend) {
    // Rock Skin + Potion of Defense add bonus defense dice; defending from a
    // pit costs one die (min 1, rulebook p.17). Potion of Defense is consumed
    // on this roll; Rock Skin persists until the hero's next turn.
    const rockBonus   = target.defenseBonus   ?? 0;
    const potDefBonus = target.potionDefBonus ?? 0;
    def = rollDice(
      Math.max(1, target.defense + rockBonus + potDefBonus - (target.inPit ? 1 : 0)),
      'hero',
    );
    s.lastDefenseRoll     = def;
    target.potionDefBonus = 0;
    damage = Math.max(0, atk.skulls - def.blocks);
    if (damage > 0) target.defenseBonus = 0;  // Rock Skin shattered
    const rockBonus2   = target.defenseBonus ?? 0;  // already cleared above if shattered
    const defNote = (target.defenseBonus != null && target.defenseBonus > 0) && potDefBonus > 0
      ? ` (Rock Skin +${rockBonus2}, Defense potion +${potDefBonus} dice)`
      : (rockBonus > 0 && damage === 0)  ? ` (Rock Skin +${rockBonus} dice)` // not shattered
      : potDefBonus > 0 ? ` (Defense potion +${potDefBonus} dice)` : '';
    pushLog(s, 'combat',
      `${monsterDisplay(m)} attacks ${heroLabel(target)} — ${atk.skulls} skulls vs ${def.blocks} blocks${defNote}. ` +
      (damage > 0 ? `${heroLabel(target)} loses ${damage} BP.` : 'No damage.'),
    );
  } else {
    // Helpless target: zero defense dice, damage = all skulls.
    def = { faces: [], skulls: 0, blocks: 0, rolledBy: 'hero' };
    s.lastDefenseRoll = def;
    damage = atk.skulls;
    const status = target.asleep ? 'asleep' : 'paralyzed';
    pushLog(s, 'combat',
      `${monsterDisplay(m)} strikes the ${status} ${heroLabel(target)} — ${atk.skulls} skulls, no defense! ` +
      (damage > 0 ? `${heroLabel(target)} loses ${damage} BP.` : 'No damage.'),
    );
  }

  target.body = Math.max(0, target.body - damage);
  checkHeroDeath(s, target);
}

/** Move the monster greedily toward `dest` one orthogonal step at a time up to
 *  its full move allowance (used when no hero is within attack range). */
function moveTowardGreedy(s: HQState, m: Monster, dest: Coord): void {
  let steps = m.move;
  while (steps > 0) {
    if (Math.abs(m.at.x - dest.x) + Math.abs(m.at.y - dest.y) <= 1) break;
    const nexts = adjacentCells(m.at).filter(c =>
      inBounds(s, c) &&
      isPassable(s, c, false) &&
      !edgeBlocksMove(s, m.at, c, false) &&
      !cellOccupied(s, c, false),
    );
    if (nexts.length === 0) break;
    nexts.sort((a, b) =>
      (Math.abs(a.x - dest.x) + Math.abs(a.y - dest.y)) -
      (Math.abs(b.x - dest.x) + Math.abs(b.y - dest.y)) ||
      chebyshev(a, dest) - chebyshev(b, dest),
    );
    m.at = { ...nexts[0] };
    steps -= 1;
  }
}

// Healing spells usable as a death-save. heal_body_e and water_heal both restore 4 BP.
const HEALING_SPELL_IDS = ['heal_body_e', 'water_heal'];

/** Collect any loot pile on the hero's current square (not an action).
 *  Items and potions merge into the hero's pack; gold goes straight to their purse. */
function collectLoot(s: HQState, h: Hero): void {
  if (!s.lootPiles?.length) return;
  const pile = s.lootPiles.find(p => p.at.x === h.at.x && p.at.y === h.at.y);
  if (!pile) return;
  s.lootPiles = s.lootPiles.filter(p => p !== pile);
  const parts: string[] = [];
  if (pile.items.length) {
    h.items = [...h.items, ...pile.items];
    parts.push(`${pile.items.map(i => i.name).join(', ')}`);
  }
  if (pile.potions.length) {
    h.foundPotions = [...h.foundPotions, ...pile.potions];
    parts.push(`${pile.potions.map(p => p.name).join(', ')}`);
  }
  if (pile.gold > 0) {
    h.gold = (h.gold ?? 0) + pile.gold;
    parts.push(`${pile.gold} gold`);
  }
  pushLog(s, 'search',
    `${heroLabel(h)} claims ${pile.heroName}'s belongings: ${parts.join(', ')}.`,
  );
}

/** Permanently kill a hero: drop their loot, remove from board, check all-dead. */
function killHero(s: HQState, h: Hero): void {
  // Drop all equipment, potions, and gold on the square where the hero died.
  // Any living hero who walks over that square auto-collects it.
  const totalGold = h.gold ?? 0;
  const items     = [...(h.items ?? [])];
  const potions   = [...(h.foundPotions ?? [])];

  if (items.length > 0 || potions.length > 0 || totalGold > 0) {
    (s.lootPiles ??= []).push({
      at:       { ...h.at },
      heroName: heroLabel(h),
      items,
      potions,
      gold: totalGold,
    });
    const pieces: string[] = [];
    if (items.length) pieces.push(`${items.length} item${items.length > 1 ? 's' : ''}`);
    if (potions.length) pieces.push(`${potions.length} potion${potions.length > 1 ? 's' : ''}`);
    if (totalGold) pieces.push(`${totalGold} gold`);
    pushLog(s, 'death',
      `${heroLabel(h)}'s belongings (${pieces.join(', ')}) are left at (${h.at.x},${h.at.y}) — any hero may claim them by passing through.`,
    );
  }

  // Strip the dead hero's inventory (they are removed from the board).
  h.items        = [];
  h.foundPotions = [];
  h.gold         = 0;
  // body stays 0; the hero token is not rendered when body <= 0.
  maybeEndQuest(s);
  // If this hero died on their own hero-phase turn, auto-advance so the game
  // doesn't lock up waiting for a dead player to click End Turn.
  if ((s.phase as string) === 'heroes' && s.heroes[s.turnIndex]?.seat === h.seat) {
    advanceTurnAfterTrap(s);
  }
}

/**
 * Called wherever a hero reaches 0 BP.
 * If the hero has a Potion of Healing or an uncast healing spell, pause the
 * game with pendingDeathSave so the player can choose.  Otherwise kill them.
 */
function checkHeroDeath(s: HQState, h: Hero): void {
  if (h.body > 0) return;

  // Already waiting on a save for this hero — don't double-set.
  if (s.pendingDeathSave?.heroIdx === s.heroes.indexOf(h)) return;

  const heroIdx = s.heroes.indexOf(h);

  const healPotion = h.foundPotions?.find(p => p.effect === 'heal_d6') ?? null;
  const canPotion  = healPotion !== null;

  const healSpell = h.spells?.find(sp => HEALING_SPELL_IDS.includes(sp.id) && !h.spellsCast?.includes(sp.id)) ?? null;
  const canSpell  = !h.hasActed && healSpell !== null;

  pushLog(s, 'death', `${heroLabel(h)} has fallen!`);

  if (canPotion || canSpell) {
    s.pendingDeathSave = {
      heroIdx,
      canPotion,
      canSpell,
      spellId: healSpell?.id ?? null,
    };
    if (canPotion && canSpell) {
      pushLog(s, 'system', `${heroLabel(h)} can drink a Potion of Healing or cast a healing spell to survive!`);
    } else if (canPotion) {
      pushLog(s, 'system', `${heroLabel(h)} can drink a Potion of Healing to survive!`);
    } else {
      pushLog(s, 'system', `${heroLabel(h)} can cast a healing spell to survive!`);
    }
    return;
  }

  // No save available — die immediately.
  killHero(s, h);
}

function doDeathSave(state: HQState, playerId: string, choice: 'potion' | 'spell' | 'decline'): ApplyResult {
  if (!state.pendingDeathSave) return err('No death save is pending.');

  const { heroIdx, canPotion, canSpell } = state.pendingDeathSave;
  const dying = state.heroes[heroIdx];
  if (!dying) return err('Invalid hero index in death save.');

  // Only the dying hero's player can resolve this.
  if (dying.playerId !== playerId) return err('Only the fallen hero\'s player can resolve this.');

  const s = clone(state);
  const h = s.heroes[heroIdx];

  s.pendingDeathSave = null;

  if (choice === 'potion') {
    if (!canPotion) return err('No Potion of Healing available.');
    const potion = h.foundPotions?.find(p => p.effect === 'heal_d6');
    if (!potion) return err('No Potion of Healing found.');
    h.foundPotions = h.foundPotions.filter(p => p.id !== potion.id);
    const roll = 1 + Math.floor(Math.random() * 6);
    const restored = Math.min(h.bodyMax - h.body, roll);
    h.body = Math.max(h.body + restored, 1); // guarantee at least 1 BP
    pushLog(s, 'search',
      `${heroLabel(h)} desperately drinks a Potion of Healing — rolled a ${roll}, restored to ${h.body} BP!`,
    );
    return ok(s);
  }

  if (choice === 'spell') {
    if (!canSpell) return err('No healing spell available.');
    const healSpell = h.spells?.find(sp => HEALING_SPELL_IDS.includes(sp.id) && !h.spellsCast?.includes(sp.id));
    if (!healSpell) return err('No uncast healing spell found.');

    // Resolve the heal — both healing spells restore 4 BP (Water of Healing and Heal Body).
    const restored = Math.min(h.bodyMax - h.body, 4);
    h.body = Math.max(h.body + restored, 1); // guarantee at least 1 BP
    h.spellsCast = [...(h.spellsCast ?? []), healSpell.id];
    h.hasActed = true; // casting costs the hero's action
    pushLog(s, 'spell',
      `${heroLabel(h)} casts ${healSpell.name} at death's door — restored to ${h.body} BP!`,
    );
    return ok(s);
  }

  // choice === 'decline'
  pushLog(s, 'death', `${heroLabel(h)} accepts their fate.`);
  killHero(s, h);
  return ok(s);
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

/** End the quest once every hero is either escaped or dead.
 *  If at least one hero escaped, the heroes win; otherwise Zargon wins.
 *  Call this from any site that can resolve the last active hero. */
function maybeEndQuest(s: HQState): void {
  if (!s.heroes.every(h => h.body <= 0 || h.escaped)) return;
  const escapees = s.heroes.filter(h => h.escaped);
  if (escapees.length > 0) {
    const names = escapees.map(heroLabel).join(', ');
    heroesWin(s, `Quest complete — ${names} escaped the dungeon!`);
  } else {
    s.phase  = 'finished';
    s.winner = 'zargon';
    pushLog(s, 'system', 'All heroes have perished. The quest is lost.');
  }
}

/** Finish the quest with a hero victory: set phase/winner, log, and grant the
 *  quest's completion reward to the living heroes. Centralises every win path.
 *  If a next quest exists in the campaign the game enters 'intermission' so
 *  heroes can visit the Armory before continuing; otherwise it goes straight to
 *  'finished'. */
function heroesWin(s: HQState, message: string): void {
  const idx = CAMPAIGN.indexOf(s.questId);
  const hasNextQuest = idx >= 0 && idx + 1 < CAMPAIGN.length;
  s.phase = hasNextQuest ? 'intermission' : 'finished';
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
  const heroIdx = s.turnIndex;
  const h = s.heroes[heroIdx];
  if (!h || !onStairs(s, h)) return;

  if (wc.kind === 'kill_and_exit') {
    // The objective must have been killed first. (Monsters lazy-spawn, so we
    // track an explicit flag rather than inferring "dead" from absence.)
    if (!s.objectiveDefeated) return;
    // Prompt — hero can leave (winning the quest) or stay for companions.
    s.pendingPrompt = { kind: 'exit_dungeon', heroIdx };
    return;
  }
  if (wc.kind === 'escape') {
    // Any living hero reaching the stairway triggers the exit prompt.
    // The first one to confirm wins the quest for the whole party.
    s.pendingPrompt = { kind: 'exit_dungeon', heroIdx };
    return;
  }
  // kill_all is resolved on the killing blow (maybeFinishOnKill), not on exit.
}

function doExitDungeon(state: HQState, playerId: string, confirm: boolean): ApplyResult {
  if (state.pendingPrompt?.kind !== 'exit_dungeon') return err('No exit prompt is pending.');
  const { heroIdx } = state.pendingPrompt;
  const h = state.heroes[heroIdx];
  if (!h) return err('Invalid hero index.');
  // Only the exiting hero's player can resolve this prompt.
  if (h.playerId !== playerId) return err('Only the hero at the stairway can decide to leave.');
  const s = clone(state);
  s.pendingPrompt = null;
  if (confirm) {
    // Mark this hero as escaped and remove them from the active turn order.
    // The quest continues — Zargon still gets a turn and remaining heroes can
    // still be killed (hurting the party's resources for the next quest).
    // The quest ends only when every hero is either escaped or dead; if at
    // least one escaped the heroes win regardless of how many died.
    const eh = s.heroes[heroIdx];
    eh.escaped = true;
    pushLog(s, 'system', `${heroLabel(eh)} escapes the dungeon!`);
    maybeEndQuest(s);
    if (s.phase !== 'finished') {
      // Quest continues — end this hero's turn and announce the next.
      const roundDone = endHeroTurn(s);
      if (roundDone) {
        beginZargonTurn(s);
      } else {
        // Skip dazed heroes, then run mind-break checks.
        while ((s.phase as string) !== 'finished') {
          const nh = s.heroes[s.turnIndex];
          if (!nh || !nh.dazed) break;
          nh.dazed = false;
          pushLog(s, 'spell', `${heroLabel(nh)} is caught in a whirlwind and loses their turn!`);
          if (endHeroTurn(s)) { beginZargonTurn(s); break; }
        }
        if ((s.phase as string) !== 'finished') {
          checkHeroTurnStart(s);
          pushLog(s, 'system', `It is ${heroLabel(s.heroes[s.turnIndex])}'s turn.`);
        }
      }
    }
  }
  // Decline: hero stays on the stairs, their turn continues normally.
  return ok(s);
}

// ============================================================================
// Falling-block retreat
// ============================================================================

function doFallingBlockMove(state: HQState, playerId: string, at: Coord): ApplyResult {
  if (state.pendingPrompt?.kind !== 'falling_block') return err('No falling block prompt is pending.');
  const { heroIdx, options } = state.pendingPrompt;
  const h = state.heroes[heroIdx];
  if (!h) return err('Invalid hero index.');
  if (h.playerId !== playerId) return err('Only the affected hero\'s player can choose where to retreat.');
  const valid = options.some(o => o.x === at.x && o.y === at.y);
  if (!valid) return err('Invalid retreat square — pick one of the highlighted squares.');
  const s = clone(state);
  s.pendingPrompt = null;
  s.heroes[heroIdx].at = { ...at };
  revealLineOfSightForHero(s, s.heroes[heroIdx]);
  return ok(s);
}

// ============================================================================
// Treasure
// ============================================================================

function drawTreasureCard(s: HQState): TreasureCard | null {
  // The rulebook requires shuffling the deck before every draw.  This is done
  // here rather than after each resolution so that the cycling cards (Hazard /
  // Wandering Monster) are always mixed back in before the next search.
  // If the deck is somehow exhausted, return null as a safety net.
  if (s.treasureDeck.length === 0) return null;
  s.treasureDeck = shuffle(s.treasureDeck);
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
      //
      // If ALL adjacent cells are occupied (e.g. hero pinned in a corner by
      // party-members) we BFS outward through passable tiles until we find the
      // nearest free cell, still preferring same region.  The immediate attack
      // still fires regardless of where the monster ends up.
      const heroRegion = s.tiles[h.at.y][h.at.x].region;
      const adj = adjacentCells(h.at).filter(c =>
        inBounds(s, c) && isPassable(s, c, /*forHero*/ false) && !cellOccupied(s, c, false),
      );
      const sameRegion = adj.filter(c => s.tiles[c.y]?.[c.x]?.region === heroRegion);
      let spawnAt: Coord = h.at; // fallback: hero's own tile (shouldn't occur on a real map)
      if (sameRegion.length > 0) {
        spawnAt = sameRegion[0];
      } else if (adj.length > 0) {
        spawnAt = adj[0];
      } else {
        // BFS outward: expand through passable tiles (including occupied ones so
        // we can reach cells beyond the heroes), picking the nearest free cell
        // with a preference for the hero's region.
        const visited = new Set<string>([`${h.at.x},${h.at.y}`]);
        const bfsQueue: Coord[] = [{ ...h.at }];
        let bestAny: Coord | null = null;
        let bfsFound = false;
        while (bfsQueue.length > 0 && !bfsFound) {
          const cur = bfsQueue.shift()!;
          for (const n of adjacentCells(cur)) {
            const key = `${n.x},${n.y}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (!inBounds(s, n) || !isPassable(s, n, false)) continue;
            if (!cellOccupied(s, n, false)) {
              if ((s.tiles[n.y]?.[n.x]?.region ?? '') === heroRegion) {
                spawnAt = n;
                bfsFound = true;
                break;
              }
              if (!bestAny) bestAny = n; // nearest non-preferred free cell
            }
            bfsQueue.push(n); // expand through occupied tiles to reach cells beyond
          }
        }
        if (!bfsFound) spawnAt = bestAny ?? h.at;
      }
      const stats = monsterStats(kind);
      const mId = `wand_${s.logSeq + 1}_${Math.floor(Math.random() * 1e6)}`;
      const newMonster: Monster = {
        id: mId, kind,
        at: spawnAt,
        body: stats.bodyMax, bodyMax: stats.bodyMax,
        attack: stats.attack, defense: stats.defense, move: stats.move,
        goldMin: stats.goldMin,
        goldMax: stats.goldMax,
        roomId: s.tiles[h.at.y][h.at.x].region,
        personality: assignPersonality(),
      };
      s.monsters.push(newMonster);
      const spawnAdj = Math.abs(spawnAt.x - h.at.x) + Math.abs(spawnAt.y - h.at.y) === 1;
      pushLog(s, 'spawn', `A wandering ${stats.displayName} appears ${spawnAdj ? 'next to' : 'nearby'} ${heroLabel(h)}!`);
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

/** All 8 neighbours (4 orthogonal + 4 diagonal). Used for attack-square
 *  detection so monsters can strike diagonally-adjacent heroes. */
function allAdjacentCells(c: Coord): Coord[] {
  return [
    { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y },
    { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 },
    { x: c.x + 1, y: c.y + 1 }, { x: c.x - 1, y: c.y + 1 },
    { x: c.x + 1, y: c.y - 1 }, { x: c.x - 1, y: c.y - 1 },
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

/** True if a wall blocks a melee attack between p and q.
 *  Orthogonal pairs: single wall-edge check (edgeBlocksMove).
 *  Diagonal pairs: L-path rule — the attack is allowed if AT LEAST ONE of the
 *  two "elbow" routes from p to q is fully unobstructed (no wall on either
 *  orthogonal step of that route). Blocked only when BOTH elbow routes are
 *  wall-blocked. This correctly handles:
 *    - Monster at a doorway can strike diagonally through the open door corner.
 *    - Monster cannot "go around and back" past a solid wall to reach a hero
 *      who is directly behind a wall — both elbows hit a wall in that case. */
function wallBetween(s: HQState, p: Coord, q: Coord): boolean {
  const dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y);
  if (dx + dy === 1) {
    return edgeBlocksMove(s, p, q, false);
  }
  // Diagonal: two possible L-shaped corner paths.
  // Path A: p → cornerA(q.x, p.y) → q
  const cA: Coord = { x: q.x, y: p.y };
  const pathA = !edgeBlocksMove(s, p, cA, false) && !edgeBlocksMove(s, cA, q, false);
  // Path B: p → cornerB(p.x, q.y) → q
  const cB: Coord = { x: p.x, y: q.y };
  const pathB = !edgeBlocksMove(s, p, cB, false) && !edgeBlocksMove(s, cB, q, false);
  return !pathA && !pathB; // blocked only when both elbow routes are walled off
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
  // Once a room is revealed by any means (door opened, hero phased in, etc.),
  // any secret door that borders it becomes "found" — you can see the door frame
  // from inside the room even if you never searched the corridor side.
  if (!region.startsWith('room_')) return;
  for (const door of s.doors) {
    if (!door.secret || door.found) continue;
    const touchesRoom = door.crossings.some(c =>
      s.tiles[c.a.y]?.[c.a.x]?.region === region ||
      s.tiles[c.b.y]?.[c.b.x]?.region === region,
    );
    if (touchesRoom) door.found = true;
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
    const mon = instantiateMonster(monDef);
    mon.personality = assignPersonality();
    s.monsters.push(mon);
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

/** Reveal-visibility from `a` to `b` — the LOOKING-&-REVEALING view.
 *  Diagonal steps use a SPLIT rule:
 *  - Edge check (room walls / closed doors): STRICT (||) — one room boundary
 *    on either flanking side blocks, so heroes inside a room can't look
 *    diagonally through the room wall into a corridor.
 *  - Cell check (solid rock): LENIENT (&&) — only blocks when BOTH flanking
 *    cells are solid rock (true sealed corner). One open side still lets you
 *    see, so a 2-wide corridor lights up fully from a diagonal look.
 *  Unlike hasLineOfSight this is for LOOKING at terrain, so figures never block
 *  it, and intermediate room cells stop the line (rooms reveal only via door). */
function revealVisible(s: HQState, a: Coord, b: Coord): boolean {
  const cells = bresenham(a, b);
  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1], c = cells[i];
    const ortho = Math.abs(prev.x - c.x) + Math.abs(prev.y - c.y) === 1;
    if (ortho) {
      if (edgeBlocksSight(s, prev, c)) return false;
    } else {
      // Diagonal step — CONTEXT-AWARE rule:
      //
      //   isWallEdge() returns true for ANY edge where one side is a room_* tile.
      //   This creates two different situations:
      //
      //   a) Origin is a CORRIDOR tile adjacent to a room: one flanking edge may
      //      point toward a room tile and register as a room boundary (e=true) even
      //      though the hero is just looking along a corridor. Using || here would
      //      wrongly block corridor vision past a room corner. Use && (lenient).
      //
      //   b) Origin is a ROOM tile: a flanking cell inside the same room shares the
      //      same region so its edge gives e=false, while the outward flanking edge
      //      gives e=true (room wall). With &&, false && true = false → leaked vision.
      //      We must use || (strict) so any room-boundary flank blocks the diagonal.
      //
      //   Rule: strict (||) from a room cell, lenient (&&) from a corridor cell.
      const e1 = edgeBlocksSight(s, prev, { x: c.x, y: prev.y });
      const e2 = edgeBlocksSight(s, prev, { x: prev.x, y: c.y });
      const prevIsRoom = regionOf(s, prev).startsWith('room_');
      if (prevIsRoom ? (e1 || e2) : (e1 && e2)) return false;
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
