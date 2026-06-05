// HeroQuest — type definitions for the digital adaptation.
//
// Scope of v1: one quest ("The Trial"), four hero classes, automated Zargon,
// a small monster roster, search/treasure/traps, no between-quest armory.
// Spells are stubbed out (data-only; effects are TODO).

/** Engine state version — bump and write a registry migration when shape changes. */
export const STATE_VERSION = 1;

// ============================================================================
// Geometry
// ============================================================================

/** A grid coordinate. The HeroQuest board is 26 columns × 19 rows. */
export type Coord = { x: number; y: number };

/** What is on a given grid square (board-level, not occupants). */
export type TileKind =
  | 'wall'        // impassable, blocks LOS
  | 'floor'       // walkable corridor / room floor
  | 'door'        // walkable but blocks LOS until opened
  | 'stairs'      // hero exit / entry point
  | 'blocked';    // impassable but not a wall (e.g. rubble)

export type Tile = {
  kind: TileKind;
  /** Room id this tile belongs to (corridors are 'corridor'). */
  region: string;
  /** True after a hero has line-of-sight into this tile at any point. */
  revealed: boolean;
};

/** A door is an opening in a wall — it lives ON the line between cells, not in
 *  a cell, so nothing ever stands "in" a doorway. Each `crossings` entry is a
 *  pair of orthogonally-adjacent cells on opposite sides of the wall; a 2-wide
 *  doorway has two parallel crossings (up to 4 squares touch it). */
export type Door = {
  id: string;
  crossings: { a: Coord; b: Coord }[];
  open: boolean;
  /** Hidden until searched. Treated as solid wall for LOS/movement until found. */
  secret: boolean;
  found: boolean;
};

/** A piece of furniture occupies one or more cells inside a room. Some
    furniture is searchable (chest, alchemy bench) and some blocks LOS only
    (bookshelf), some blocks movement entirely (throne). */
export type Furniture = {
  id: string;
  kind: 'chest' | 'table' | 'cupboard' | 'rack' | 'bookshelf' | 'throne' | 'tomb' | 'altar'
    | 'bench' | 'fireplace' | 'weapon_rack' | 'sorcerer_table' | 'alchemist_bench';
  cells: Coord[];
  /** Orientation 0..3 (90° each) — which way a tall piece faces, for art. */
  facing?: number;
  blocksMove: boolean;
  blocksLos: boolean;
  /** If true, "Search for treasure" while standing in this room also
      considers this furniture. We use a flat "room search" model in v1. */
  searched?: boolean;
  /** Optional fixed contents (quest-specific) — overrides the treasure deck
      for the FIRST hero to search this room. */
  fixedContent?: FixedContent;
};

/** Quest-book pre-defined contents at a location. */
export type FixedContent =
  | { kind: 'gold'; amount: number }
  | { kind: 'nothing'; flavor: string }     // empty / broken
  | { kind: 'item'; itemId: string };

/** A trap on the board. Hidden until searched-for-traps reveals it. */
export type Trap = {
  id: string;
  kind: 'pit' | 'spear' | 'falling_block';
  at: Coord;
  /** Only spear has a meaningful "spent" state in v1; pit and falling block
      stay around after triggering (pit you climb out of, block stays blocked). */
  triggered: boolean;
  revealed: boolean;
};

// ============================================================================
// Heroes
// ============================================================================

export type HeroClass = 'barbarian' | 'dwarf' | 'elf' | 'wizard';

export const HERO_CLASSES: HeroClass[] = ['barbarian', 'dwarf', 'elf', 'wizard'];

export type Spell = {
  id: string;
  name: string;
  element: 'air' | 'water' | 'fire' | 'earth';
  /** Human-readable effect summary, shown on the spell card. */
  text: string;
  /** Who the spell targets — drives the cast UI:
   *  'monster' → pick a visible monster, 'hero' → pick a living hero (self or
   *  ally), 'area' → resolves immediately with no pick (e.g. Tempest). */
  target: 'monster' | 'hero' | 'area';
};

/** Inventory item — kept simple for v1 (weapons grant attack dice, armor
    grants defense dice, potions are one-shot). */
export type Item = {
  id: string;
  name: string;
  kind: 'weapon' | 'armor' | 'tool' | 'potion' | 'artifact';
  attack?: number;          // weapon attack dice (replaces base if larger)
  defense?: number;         // armor defense dice (stacks additively in v1)
  twoHanded?: boolean;      // cannot be combined with a shield (axe, staff)
  diagonal?: boolean;       // weapon can attack diagonally
  ranged?: boolean;         // weapon can hit at LOS distance
  /** Armory price in gold (between-quests shop). Undefined = not sold. */
  cost?: number;
  /** The Wizard may not use this item ("may not be used/worn by the Wizard"). */
  noWizard?: boolean;
  description?: string;
};

export type Hero = {
  /** Player UUID who controls this hero — empty string for an unclaimed slot
      (every quest always has 4 hero slots, one per class; with <4 human
      players the engine auto-fills unclaimed slots at start_game by cycling
      through claimed players). */
  playerId: string;
  username: string;
  /** Stable seat index 0..3 — drives turn order and starting position. */
  seat: number;
  accent_color?: string;
  klass: HeroClass;
  at: Coord;
  /** Body Points: current/max. 0 = dead. */
  body: number;
  bodyMax: number;
  /** Mind Points — used by some traps/spells. */
  mind: number;
  mindMax: number;
  /** Total attack dice (base + best weapon equipped). */
  attack: number;
  /** Total defense dice (base + armor). */
  defense: number;
  /** Movement points remaining this turn (after rolling 2d6). 0 if not rolled
      yet OR if movement already spent. */
  moveLeft: number;
  /** Movement allowance rolled this turn (display purposes). */
  moveRolled: number;
  /** Has the hero rolled movement this turn yet? */
  hasRolled: boolean;
  /** Has the hero taken their one action this turn? */
  hasActed: boolean;
  /** Items in inventory; we don't model "equipped" slots in v1 — best weapon
      wins, armor dice stack. */
  items: Item[];
  /** Spells the hero currently holds (Wizard 9, Elf 3). One-shot per quest. */
  spells: Spell[];
  spellsCast: string[];
  /** Gold purse (kept between quests in future expansions). */
  gold: number;
  /** Set of room ids this hero has already searched-for-treasure. */
  searchedRooms: string[];
  /** Set of room/corridor ids this hero has already searched-for-traps. */
  searchedTraps: string[];
  /** Set of room/corridor ids already searched for secret doors. */
  searchedSecrets: string[];
  /** True if currently sitting in a pit (must spend movement to climb out). */
  inPit: boolean;

  // --- Spell buffs ---------------------------------------------------------
  // Per-turn buffs are cleared at the end of the hero's own turn. Rock Skin's
  // defenseBonus is the exception: it lasts "until your next turn" so it
  // survives the intervening Zargon turn and clears when the hero acts again.
  /** Courage: extra attack dice applied to the hero's next attack. */
  attackBonus?: number;
  /** Courage: lets the hero make one attack even after using their action. */
  extraAttack?: boolean;
  /** Rock Skin: extra defense dice until the hero's next turn. */
  defenseBonus?: number;
  /** Pass Through Rock: movement ignores wall / furniture blockers this turn. */
  phaseWalls?: boolean;
};

// ============================================================================
// Monsters
// ============================================================================

export type MonsterKind =
  | 'goblin' | 'orc' | 'abomination' | 'skeleton' | 'zombie' | 'mummy'
  | 'dread_warrior' | 'gargoyle';

export type Monster = {
  id: string;
  kind: MonsterKind;
  at: Coord;
  body: number;
  bodyMax: number;
  /** Per-monster baseline stats (denormalized so the engine doesn't keep
      cross-referencing a table during resolution). */
  attack: number;
  defense: number;
  move: number;
  /** Optional override of display name for named bosses (e.g. "Verag"). */
  displayName?: string;
  /** Mind Points — used by Dread-spell resistance (roll 1 die per Mind Point). */
  mind?: number;
  /** Optional gold bounty (deposited in the active hero's purse on kill). */
  gold?: number;
  /** Room this monster was placed in. Used for "wakes when room revealed". */
  roomId: string;
  /** Tempest: the monster loses its next Zargon turn (flag cleared when skipped). */
  stunned?: boolean;
};

// ============================================================================
// Quests
// ============================================================================

/** A single quest's authored content. The engine stamps a fresh copy of this
    into the live state when the game starts. */
export type QuestDef = {
  id: string;
  name: string;
  briefing: string;
  /** Board geometry. 0,0 is top-left. */
  width: number;
  height: number;
  tiles: TileKind[][];
  /** Region id per cell (rooms, corridor). */
  regions: string[][];
  doors: Omit<Door, 'open' | 'found'>[];
  furniture: Omit<Furniture, 'searched'>[];
  traps: Omit<Trap, 'triggered' | 'revealed'>[];
  monsters: Omit<Monster, 'body'>[]; // body defaults to bodyMax
  /** Starting cell(s) for heroes — list of valid entry tiles. */
  startCells: Coord[];
  /** Quest-book defined wandering monster type, or null for none. */
  wanderingMonster: MonsterKind | null;
  /** How the heroes win this quest. */
  winCondition: WinCondition;
  /** Reward granted to the heroes on completion (beyond treasure found). */
  reward: QuestReward;
};

/** Completion reward for a quest. */
export type QuestReward =
  /** No completion bonus (Quest 1 — the reward is the gold in the chests). */
  | { kind: 'none' }
  /** A gold purse: `divided` splits `amount` among living heroes; `each` gives
   *  `amount` to every living hero (e.g. "100 gold coins each"). */
  | { kind: 'gold'; amount: number; split: 'divided' | 'each' };

/** Objective / victory condition for a quest. */
export type WinCondition =
  /** Slay the named boss, then return to the stairway (Q1, 3, 8, 14, …). */
  | { kind: 'kill_and_exit'; monsterDisplayName: string }
  /** Clear every monster on the board (Q11). */
  | { kind: 'kill_all' }
  /** All living heroes reach the stairway — an escape quest (Q6, 9). */
  | { kind: 'escape' };

// ============================================================================
// Treasure deck
// ============================================================================

/** A single treasure card. */
export type TreasureCard =
  | { id: string; kind: 'gold'; amount: number }
  | { id: string; kind: 'gem'; value: number }
  | { id: string; kind: 'potion'; name: string; effect: 'heal'; amount: number }
  | { id: string; kind: 'hazard'; flavor: string; bpLoss: number }
  | { id: string; kind: 'wandering' };

// ============================================================================
// Combat dice
// ============================================================================

/** Face on a HeroQuest custom combat die. 3 skulls, 2 white shields, 1 black shield. */
export type DieFace = 'skull' | 'white_shield' | 'black_shield';
export const DIE_FACES: DieFace[] = [
  'skull', 'skull', 'skull', 'white_shield', 'white_shield', 'black_shield',
];

export type DiceRoll = {
  rolledBy: 'hero' | 'monster';
  faces: DieFace[];
  /** Counted hits (skulls). */
  skulls: number;
  /** Counted blocks (white shields for heroes, black for monsters). */
  blocks: number;
};

// ============================================================================
// Log / animations
// ============================================================================

export type LogEntry = {
  seq: number;
  ts: number;
  text: string;
  /** Optional tag the UI can use to render with an icon (combat, search, etc). */
  tag?: 'system' | 'move' | 'combat' | 'search' | 'spell' | 'trap' | 'death' | 'spawn' | 'zargon' | 'reveal';
};

// ============================================================================
// Top-level state
// ============================================================================

/** What the engine is doing this exact moment. */
export type Phase =
  | 'lobby'        // before start, players picking hero classes
  | 'heroes'       // a hero is taking their turn
  | 'zargon'       // engine is resolving monster turns
  | 'finished';    // game over

export type Winner = 'heroes' | 'zargon' | null;

export type HQState = {
  version?: number;
  phase: Phase;
  questId: string;
  /** The active quest's authored content, stamped at start. */
  quest: QuestDef;
  /** Mutable tile state (revealed flag etc.). Same dimensions as quest.tiles. */
  tiles: Tile[][];
  /** Doors with open/found state. */
  doors: Door[];
  /** Furniture with searched state. */
  furniture: Furniture[];
  /** Traps with triggered/revealed state. */
  traps: Trap[];
  /** Live monsters. Killed monsters are spliced out. */
  monsters: Monster[];
  /** All heroes (seated player order). */
  heroes: Hero[];
  /** Current hero's index. Only meaningful when phase === 'heroes'. */
  turnIndex: number;
  /** Treasure deck (top of array = top of deck). */
  treasureDeck: TreasureCard[];
  /** Discard pile. Cards return here after non-keepable resolution. */
  treasureDiscard: TreasureCard[];
  /** Append-only log. */
  log: LogEntry[];
  logSeq: number;
  /** Most recent combat roll — the ATTACKER's dice (for the board's dice panel). */
  lastRoll: DiceRoll | null;
  /** The DEFENDER's dice from the most recent attack (paired with lastRoll). */
  lastDefenseRoll: DiceRoll | null;
  /** Most recent movement roll (the 3d4 faces). Shown by the dice panel when a
   *  hero rolls movement; cleared when a combat/other roll happens. */
  lastMoveRoll: number[] | null;
  /** Pending UI prompt — set when the engine needs the active hero (or
      Zargon-as-engine, in our case it's always the active hero) to make a
      choice that can't be auto-resolved. v1 keeps this small. */
  pendingPrompt: PendingPrompt | null;
  /** True once the quest's named target (e.g. Verag) has been killed. Gates the
      "reach the stairway to escape" win — without it, monsters lazy-spawn so an
      unspawned target would look "absent" and let heroes win instantly. */
  objectiveDefeated?: boolean;
  /** Final result. */
  winner: Winner;
};

export type PendingPrompt =
  | { kind: 'choose_door'; heroIdx: number; doors: { doorId: string }[] }
  | { kind: 'choose_target'; heroIdx: number; monsterIds: string[]; reason: 'attack' | 'spell' }
  | { kind: 'climb_pit'; heroIdx: number };

// ============================================================================
// Action union — wire-level moves from a client to the engine
// ============================================================================

export type HQAction =
  // Lobby
  /** Claim a specific hero slot by seat index. If the player already controls
      another slot, that other slot becomes unclaimed (one primary slot per
      player). */
  | { kind: 'claim_hero'; seat: number }
  /** Legacy "I want this class" — kept for back-compat with older clients;
      same as claim_hero with the matching seat. */
  | { kind: 'set_class'; classKlass: HeroClass }
  | { kind: 'random_classes' }
  | { kind: 'start_game' }
  // Turn — hero
  | { kind: 'roll_move' }
  | { kind: 'move_to'; at: Coord }
  | { kind: 'move_path'; path: Coord[] }
  | { kind: 'open_door'; doorId: string }
  | { kind: 'attack'; monsterId: string }
  | { kind: 'search_treasure' }
  | { kind: 'search_traps' }
  | { kind: 'search_secrets' }
  | { kind: 'disarm_trap'; trapId: string }
  | { kind: 'jump_trap'; trapId: string }
  | { kind: 'climb_pit' }
  | { kind: 'cast_spell'; spellId: string; targetMonsterId?: string; targetHeroIdx?: number }
  | { kind: 'end_turn' };

export type ApplyResult =
  | { ok: true; state: HQState }
  | { ok: false; error: string };
