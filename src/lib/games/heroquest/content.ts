// HeroQuest — static content tables (heroes, monsters, items, treasure) and
// Quest 1 ("The Trial") authored content.
//
// Designed to be data-only and immutable. The engine clones what it needs.

import type {
  Hero,
  HeroClass,
  Item,
  Monster,
  MonsterKind,
  QuestDef,
  Spell,
  TreasureCard,
} from './types';
import { BASE_BOARD, generateConnectingDoors } from './board';

// ============================================================================
// Hero class defaults
// ============================================================================

export type HeroDefaults = {
  klass: HeroClass;
  name: string;          // Display name
  bodyMax: number;
  mindMax: number;
  baseAttack: number;    // unarmed/base
  baseDefense: number;
  startingItems: Item[];
  description: string;
};

// ---- The Armory (between-quests shop). Faithful to the Armory card. ----
// Weapons
const DAGGER: Item = { id: 'dagger', name: 'Dagger', kind: 'weapon', attack: 1, cost: 25, description: 'Attack 1 die. Can be thrown at a monster you can see (lost once thrown).' };
const STAFF: Item = { id: 'staff', name: 'Staff', kind: 'weapon', attack: 1, diagonal: true, twoHanded: true, cost: 100, description: 'Attack 1 die; attacks diagonally. No shield while using it.' };
const SHORT_SWORD: Item = { id: 'short_sword', name: 'Shortsword', kind: 'weapon', attack: 2, cost: 150, noWizard: true, description: 'Attack 2 dice.' };
const BROADSWORD: Item = { id: 'broadsword', name: 'Broadsword', kind: 'weapon', attack: 3, cost: 250, noWizard: true, description: 'Attack 3 dice.' };
const LONGSWORD: Item = { id: 'longsword', name: 'Longsword', kind: 'weapon', attack: 3, diagonal: true, cost: 350, noWizard: true, description: 'Attack 3 dice; attacks diagonally.' };
const CROSSBOW: Item = { id: 'crossbow', name: 'Crossbow', kind: 'weapon', attack: 3, ranged: true, cost: 350, noWizard: true, description: 'Attack 3 dice; fire at any monster you can see, but not an adjacent one.' };
const BATTLE_AXE: Item = { id: 'battle_axe', name: 'Battle Axe', kind: 'weapon', attack: 4, twoHanded: true, cost: 450, noWizard: true, description: 'Attack 4 dice. No shield while using it.' };
// Armor (defense bonuses stack additively)
const HELMET: Item = { id: 'helmet', name: 'Helmet', kind: 'armor', defense: 1, cost: 125, noWizard: true, description: '+1 Defend die.' };
const SHIELD: Item = { id: 'shield', name: 'Shield', kind: 'armor', defense: 1, cost: 150, noWizard: true, description: '+1 Defend die. Not with the Battle Axe or Staff.' };
const CHAIN_MAIL: Item = { id: 'chain_mail', name: 'Chain Mail', kind: 'armor', defense: 1, cost: 500, noWizard: true, description: '+1 Defend die. Combines with Helmet and/or Shield.' };
// Bracers are leather, so the Wizard CAN wear them (the only armor they may use).
const BRACERS: Item = { id: 'bracers', name: 'Bracers', kind: 'armor', defense: 1, cost: 550, description: '+1 Defend die. Combines with Helmet and/or Shield. Wearable by any hero (leather).' };
const PLATE_MAIL: Item = { id: 'plate_mail', name: 'Plate Mail', kind: 'armor', defense: 2, cost: 850, noWizard: true, description: '+2 Defend dice. Combines with Helmet and/or Shield. Heavy: reduced movement while worn.' };
/** Lets non-Dwarf heroes attempt to disarm traps (the Dwarf needs no kit). */
export const TOOL_KIT: Item = { id: 'tool_kit', name: 'Tool Kit', kind: 'tool', cost: 250, description: 'Lets any hero attempt to disarm traps (~50%). The Dwarf never needs one.' };

/** Everything purchasable from the armory between quests, cheapest first. */
export const ARMORY: Item[] = [
  DAGGER, STAFF, HELMET, SHORT_SWORD, SHIELD, BROADSWORD, TOOL_KIT,
  LONGSWORD, CROSSBOW, BATTLE_AXE, CHAIN_MAIL, BRACERS, PLATE_MAIL,
];

export const HERO_DEFAULTS: Record<HeroClass, HeroDefaults> = {
  barbarian: {
    klass: 'barbarian',
    name: 'Barbarian',
    bodyMax: 8,
    mindMax: 2,
    baseAttack: 3,
    baseDefense: 2,
    startingItems: [BROADSWORD],
    description: 'Strongest melee fighter. Cannot cast spells.',
  },
  dwarf: {
    klass: 'dwarf',
    name: 'Dwarf',
    bodyMax: 7,
    mindMax: 3,
    baseAttack: 2,
    baseDefense: 2,
    startingItems: [SHORT_SWORD],
    description: 'Disarms traps without a tool kit. Cannot wield long weapons.',
  },
  elf: {
    klass: 'elf',
    name: 'Elf',
    bodyMax: 6,
    mindMax: 4,
    baseAttack: 2,
    baseDefense: 2,
    startingItems: [SHORT_SWORD],
    description: 'Casts one elemental spell group.',
  },
  wizard: {
    klass: 'wizard',
    name: 'Wizard',
    bodyMax: 4,
    mindMax: 6,
    baseAttack: 1,
    baseDefense: 2,
    startingItems: [DAGGER, STAFF],
    description: 'Casts three elemental spell groups. Cannot use heavy armor or weapons.',
  },
};

// ============================================================================
// Spells
// ============================================================================

export const SPELLS: Spell[] = [
  // Air
  { id: 'genie',       name: 'Genie',         element: 'air',   target: 'monster', text: 'Summon a genie to strike a monster you can see (4 attack dice).' },
  { id: 'tempest',     name: 'Tempest',       element: 'air',   target: 'area',    text: 'Up to 2 monsters next to you lose their next turn.' },
  { id: 'swift_wind',  name: 'Swift Wind',    element: 'air',   target: 'hero',    text: 'Target hero moves with double movement this turn.' },
  // Water
  { id: 'veil_of_mist', name: 'Veil of Mist', element: 'water', target: 'hero',    text: 'Target hero gains +10 squares of movement to slip away.' },
  { id: 'heal_body_w', name: 'Heal Body',     element: 'water', target: 'hero',    text: 'Restore up to 4 BP to target.' },
  { id: 'water_heal',  name: 'Water of Healing', element: 'water', target: 'hero', text: 'Restore up to 2 BP to target.' },
  // Fire
  { id: 'ball_of_flame', name: 'Ball of Flame', element: 'fire', target: 'monster', text: 'Ranged 2-die attack on any LOS target.' },
  { id: 'courage',     name: 'Courage',       element: 'fire',  target: 'hero',    text: 'Target hero strikes at once with +2 attack dice.' },
  { id: 'fire_of_wrath', name: 'Fire of Wrath', element: 'fire', target: 'monster', text: 'Adjacent target takes 1 BP. No defense allowed.' },
  // Earth
  { id: 'pass_rock',   name: 'Pass Through Rock', element: 'earth', target: 'hero', text: 'Target hero moves through walls & furniture this turn.' },
  { id: 'heal_body_e', name: 'Heal Body',     element: 'earth', target: 'hero',    text: 'Restore up to 4 BP to target.' },
  { id: 'rock_skin',   name: 'Rock Skin',     element: 'earth', target: 'hero',    text: 'Target hero gains +2 defense dice until their next turn.' },
];

/** Per-element spell groups (3 each). */
export function spellsByElement(): Record<Spell['element'], Spell[]> {
  const out: Record<Spell['element'], Spell[]> = { air: [], water: [], fire: [], earth: [] };
  for (const s of SPELLS) out[s.element].push(s);
  return out;
}

// ============================================================================
// Monster stat tables
// ============================================================================

export type MonsterStats = {
  kind: MonsterKind;
  displayName: string;
  bodyMax: number;
  attack: number;
  defense: number;
  move: number;
  /** Mind Points (per the Monster Chart). Not yet used by the engine. */
  mind: number;
  gold: number;
};

// Base stats from the official Monster Chart
//                            Move  Atk  Def  Body  Mind
//   Goblin                    10    2    1    1     1
//   Orc                        8    3    2    1     2
//   Skeleton                   6    2    2    1     0
//   Zombie                     5    2    3    1     0
//   Abomination                6    3    3    2     3
//   Mummy                      4    3    4    2     0
//   Dread Warrior              7    4    3    3     3
//   Gargoyle                   6    4    5    3     4
export const MONSTER_STATS: Record<MonsterKind, MonsterStats> = {
  goblin:         { kind: 'goblin',         displayName: 'Goblin',         move: 10, attack: 2, defense: 1, bodyMax: 1, mind: 1, gold: 5 },
  orc:            { kind: 'orc',            displayName: 'Orc',            move: 8,  attack: 3, defense: 2, bodyMax: 1, mind: 2, gold: 10 },
  skeleton:       { kind: 'skeleton',       displayName: 'Skeleton',       move: 6,  attack: 2, defense: 2, bodyMax: 1, mind: 0, gold: 15 },
  zombie:         { kind: 'zombie',         displayName: 'Zombie',         move: 5,  attack: 2, defense: 3, bodyMax: 1, mind: 0, gold: 20 },
  abomination:    { kind: 'abomination',    displayName: 'Abomination',    move: 6,  attack: 3, defense: 3, bodyMax: 2, mind: 3, gold: 20 },
  mummy:          { kind: 'mummy',          displayName: 'Mummy',          move: 4,  attack: 3, defense: 4, bodyMax: 2, mind: 0, gold: 25 },
  dread_warrior:  { kind: 'dread_warrior',  displayName: 'Dread Warrior',  move: 7,  attack: 4, defense: 3, bodyMax: 3, mind: 3, gold: 35 },
  gargoyle:       { kind: 'gargoyle',       displayName: 'Gargoyle',       move: 6,  attack: 4, defense: 5, bodyMax: 3, mind: 4, gold: 75 },
};

// ============================================================================
// Treasure deck (v1: 18 cards)
// ============================================================================

export function buildTreasureDeck(): TreasureCard[] {
  let n = 0;
  const id = () => `tr_${++n}`;
  const deck: TreasureCard[] = [
    { id: id(), kind: 'gold', amount: 25 },
    { id: id(), kind: 'gold', amount: 50 },
    { id: id(), kind: 'gold', amount: 75 },
    { id: id(), kind: 'gold', amount: 100 },
    { id: id(), kind: 'gold', amount: 50 },
    { id: id(), kind: 'gold', amount: 25 },
    { id: id(), kind: 'gem', value: 50 },
    { id: id(), kind: 'gem', value: 75 },
    { id: id(), kind: 'potion', name: 'Heroic Brew', effect: 'heal', amount: 4 },
    { id: id(), kind: 'potion', name: 'Holy Water',  effect: 'heal', amount: 4 },
    { id: id(), kind: 'potion', name: 'Healing Salve', effect: 'heal', amount: 2 },
    { id: id(), kind: 'hazard', flavor: 'You slip and twist an ankle.', bpLoss: 1 },
    { id: id(), kind: 'hazard', flavor: 'A loose stone gives way.', bpLoss: 1 },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'gold', amount: 50 },
    { id: id(), kind: 'gold', amount: 25 },
  ];
  return deck;
}

// ============================================================================
// Quest 1 — "The Trial", laid out on the shared BASE_BOARD. Every quest reuses
// the same fixed board (rooms + double-wide halls + entry staircase); a quest
// just drops in its monsters, furniture, traps, and objective. Building quest
// #2, #3, … is then a short list of placements, not a whole new map.
// ============================================================================

function makeQuest1(): QuestDef {
  // ---- Furniture (placed on board room cells) ----
  const furniture: QuestDef['furniture'] = [];
  let fn = 0;
  const furn = (
    kind: QuestDef['furniture'][number]['kind'],
    x: number, y: number, blocksMove: boolean, blocksLos: boolean,
    fixedContent?: QuestDef['furniture'][number]['fixedContent'],
  ) => {
    furniture.push({ id: `furn_${++fn}`, kind, cells: [{ x, y }], blocksMove, blocksLos, fixedContent });
  };
  furn('chest', 18, 11, false, false, { kind: 'gold', amount: 100 }); // central room — Verag's hoard
  furn('chest', 9, 3, false, false, { kind: 'gold', amount: 50 });
  furn('throne', 5, 4, true, true);
  furn('fireplace', 27, 5, true, true);
  furn('bookshelf', 5, 9, false, true);
  furn('table', 13, 4, false, false);

  // ---- Monsters (spawn when their room is first revealed). roomId is read
  //      straight from the shared board so placements just need a cell. ----
  const monsters: QuestDef['monsters'] = [];
  let mn = 0;
  const mob = (
    kind: MonsterKind, x: number, y: number,
    opts?: { displayName?: string; bodyMax?: number; attack?: number },
  ) => {
    const st = MONSTER_STATS[kind];
    monsters.push({
      id: `mon_${++mn}`, kind, at: { x, y },
      bodyMax: opts?.bodyMax ?? st.bodyMax,
      attack: opts?.attack ?? st.attack,
      defense: st.defense, move: st.move,
      displayName: opts?.displayName, gold: st.gold,
      roomId: BASE_BOARD.regions[y][x],
    });
  };
  // A goblin pack spread across the dungeon, with Verag in the central chamber.
  mob('goblin', 5, 3); mob('goblin', 13, 3); mob('goblin', 27, 3);
  mob('goblin', 5, 8); mob('goblin', 23, 8);
  mob('gargoyle', 16, 11, { displayName: 'Verag' });
  mob('goblin', 17, 12);
  mob('goblin', 5, 18); mob('goblin', 13, 18); mob('goblin', 20, 18); mob('goblin', 27, 18);

  return {
    id: 'the_trial',
    name: 'The Trial',
    briefing:
      'Mentor: "Welcome, brave heroes. Your first trial is to descend into the catacombs ' +
      'and destroy Verag, a Chaos gargoyle that has nested below. Return alive to the stairway."',
    width: BASE_BOARD.width,
    height: BASE_BOARD.height,
    tiles: BASE_BOARD.tiles,
    regions: BASE_BOARD.regions,
    // Auto-placed doors connect every walled room back to the corridors; refine
    // per-quest later (or in the sandbox).
    doors: generateConnectingDoors(),
    furniture,
    traps: [],
    monsters,
    startCells: BASE_BOARD.startCells,
    wanderingMonster: 'goblin',
    winCondition: { kind: 'kill_and_exit', monsterDisplayName: 'Verag' },
  };
}

export const QUEST1: QuestDef = makeQuest1();
export const QUESTS: Record<string, QuestDef> = { the_trial: QUEST1 };

// ============================================================================
// Hero-instance factory
// ============================================================================

export function makeHero(
  playerId: string,
  username: string,
  seat: number,
  klass: HeroClass,
  start: { x: number; y: number },
  accent_color?: string,
): Hero {
  const d = HERO_DEFAULTS[klass];
  const items = d.startingItems.map(i => ({ ...i }));
  let attack = d.baseAttack;
  let defense = d.baseDefense;
  for (const it of items) {
    if (it.attack && it.attack > attack) attack = it.attack;
    if (it.defense) defense += it.defense;
  }
  return {
    playerId,
    username,
    seat,
    accent_color,
    klass,
    at: { ...start },
    body: d.bodyMax,
    bodyMax: d.bodyMax,
    mind: d.mindMax,
    mindMax: d.mindMax,
    attack,
    defense,
    moveLeft: 0,
    moveRolled: 0,
    hasRolled: false,
    hasActed: false,
    items,
    spells: [],
    spellsCast: [],
    gold: 0,
    searchedRooms: [],
    searchedTraps: [],
    searchedSecrets: [],
    inPit: false,
  };
}

/** Convenience for Zargon: build a Monster instance from quest data. */
export function instantiateMonster(m: QuestDef['monsters'][number]): Monster {
  return {
    id: m.id,
    kind: m.kind,
    at: { ...m.at },
    body: m.bodyMax,
    bodyMax: m.bodyMax,
    attack: m.attack,
    defense: m.defense,
    move: m.move,
    displayName: m.displayName,
    gold: m.gold,
    roomId: m.roomId,
  };
}
