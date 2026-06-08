// HeroQuest — static content tables (heroes, monsters, items, treasure) and
// Quest 1 ("The Trial") authored content.
//
// Designed to be data-only and immutable. The engine clones what it needs.

import type {
  Coord,
  Furniture,
  Hero,
  HeroClass,
  Item,
  Monster,
  MonsterKind,
  QuestDef,
  Spell,
  TreasureCard,
} from './types';
import { parseAsciiBoard } from './board';
import { QUEST1_MAP, QUEST1_FURNITURE, QUEST1_DOORS, QUEST1_MONSTERS } from './quests/quest1';

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
const HANDAXE: Item = { id: 'handaxe', name: 'Handaxe', kind: 'weapon', attack: 2, ranged: true, cost: 200, description: 'Attack 2 dice; can be thrown at a monster in line of sight (lost once thrown). Usable by any hero.' };
const BATTLE_AXE: Item = { id: 'battle_axe', name: 'Battle Axe', kind: 'weapon', attack: 4, twoHanded: true, cost: 450, noWizard: true, description: 'Attack 4 dice. No shield while using it.' };
// Armor (defense bonuses stack additively)
const HELMET: Item = { id: 'helmet', name: 'Helmet', kind: 'armor', defense: 1, cost: 125, noWizard: true, description: '+1 Defend die.' };
const SHIELD: Item = { id: 'shield', name: 'Shield', kind: 'armor', defense: 1, cost: 150, noWizard: true, description: '+1 Defend die. Not with the Battle Axe or Staff.' };
const CHAIN_MAIL: Item = { id: 'chain_mail', name: 'Chain Mail', kind: 'armor', defense: 1, cost: 500, noWizard: true, description: '+1 Defend die. Combines with Helmet and/or Shield.' };
// Bracers are leather, so the Wizard CAN wear them (the only armor they may use).
const BRACERS: Item = { id: 'bracers', name: 'Bracers', kind: 'armor', defense: 1, cost: 550, description: '+1 Defend die. Combines with Helmet and/or Shield. Wearable by any hero (leather).' };
const PLATE_MAIL: Item = { id: 'plate_mail', name: 'Plate Mail', kind: 'armor', defense: 2, cost: 850, noWizard: true, description: '+2 Defend dice. Combines with Helmet and/or Shield. Heavy: roll 1 less d4 for movement (2d4 instead of 3d4) while worn.' };
/** Lets non-Dwarf heroes attempt to disarm traps (the Dwarf needs no kit). */
export const TOOL_KIT: Item = { id: 'tool_kit', name: 'Tool Kit', kind: 'tool', cost: 250, description: 'Lets any hero attempt to disarm traps (~50%). The Dwarf never needs one.' };
// Consumables sold in the equipment deck (one use, then discarded).
const POTION_OF_SPEED: Item = { id: 'potion_of_speed', name: 'Potion of Speed', kind: 'potion', cost: 200, description: 'Drink any time: roll twice as many movement dice on your next move. One use.' };
const HOLY_WATER: Item = { id: 'holy_water', name: 'Holy Water', kind: 'potion', cost: 400, description: 'Use instead of attacking to instantly kill any one undead (skeleton/zombie/mummy). One use.' };

/** Everything purchasable from the armory between quests, cheapest first. */
export const ARMORY: Item[] = [
  DAGGER, STAFF, HELMET, SHORT_SWORD, SHIELD, HANDAXE, POTION_OF_SPEED, BROADSWORD, TOOL_KIT,
  LONGSWORD, CROSSBOW, HOLY_WATER, BATTLE_AXE, CHAIN_MAIL, BRACERS, PLATE_MAIL,
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
    startingItems: [DAGGER], // card-faithful: Wizard starts with the Dagger only (Staff is buyable)
    description: 'Casts three elemental spell groups. Cannot use heavy armor or weapons.',
  },
};

// ============================================================================
// Spells
// ============================================================================

export const SPELLS: Spell[] = [
  // Air
  { id: 'genie',       name: 'Genie',         element: 'air',   target: 'genie',   text: 'Open any door on the board, OR attack any visible monster with 5 combat dice.' },
  { id: 'tempest',     name: 'Tempest',        element: 'air',   target: 'monster', text: 'Target monster misses its next turn.' },
  { id: 'swift_wind',  name: 'Swift Wind',     element: 'air',   target: 'hero',    text: 'Target hero rolls twice as many movement dice as normal on their next move.' },
  // Water
  { id: 'veil_of_mist', name: 'Veil of Mist', element: 'water', target: 'hero',    text: 'Target hero may move through monster-occupied squares on their next move.' },
  { id: 'sleep',        name: 'Sleep',         element: 'water', target: 'monster', text: 'Put a monster into a deep sleep. Each Zargon turn it rolls 1d6 per Mind Point — if any die shows 6 it wakes up. Cannot be cast on undead.' },
  { id: 'water_heal',   name: 'Water of Healing', element: 'water', target: 'hero', text: 'Restore up to 4 lost Body Points to target.' },
  // Fire
  { id: 'ball_of_flame', name: 'Ball of Flame', element: 'fire', target: 'monster', text: 'Deal 2 BP of damage to any visible monster. Monster then rolls 2d6 — each 6 reduces the damage by 1.' },
  { id: 'courage',      name: 'Courage',        element: 'fire',  target: 'hero',   text: 'Target hero rolls 2 extra combat dice on their next attack.' },
  { id: 'fire_of_wrath', name: 'Fire of Wrath', element: 'fire', target: 'monster', text: 'Deal 1 BP of damage to any visible monster. Monster then rolls 1d6 — a 6 reduces the damage by 1.' },
  // Earth
  { id: 'pass_rock',   name: 'Pass Through Rock', element: 'earth', target: 'hero', text: 'Target hero moves through walls and solid rock on their next move.' },
  { id: 'heal_body_e', name: 'Heal Body',          element: 'earth', target: 'hero', text: 'Restore up to 4 lost Body Points to target.' },
  { id: 'rock_skin',   name: 'Rock Skin',           element: 'earth', target: 'hero', text: 'Target hero gains +1 defense die. Broken only when the hero suffers 1 Body Point of damage.' },
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
  /** Gold bounty range — a random amount in [goldMin, goldMax] is awarded on kill. */
  goldMin: number;
  goldMax: number;
};

// Base stats from the official Monster Chart
//                            Move  Atk  Def  Body  Mind  Gold (range)
//   Goblin                    10    2    1    1     1     2–4
//   Orc                        8    3    2    1     2     3–7
//   Skeleton                   6    2    2    1     0     2–5
//   Zombie                     5    2    3    1     0     3–6
//   Abomination                6    3    3    2     3     4–8
//   Mummy                      4    3    4    2     0     4–9
//   Dread Warrior              7    4    3    3     3     5–10
//   Gargoyle                   6    4    5    3     4     5–11
export const MONSTER_STATS: Record<MonsterKind, MonsterStats> = {
  goblin:         { kind: 'goblin',         displayName: 'Goblin',         move: 10, attack: 2, defense: 1, bodyMax: 1, mind: 1, goldMin: 1,  goldMax: 3  },
  orc:            { kind: 'orc',            displayName: 'Orc',            move: 8,  attack: 3, defense: 2, bodyMax: 1, mind: 2, goldMin: 2,  goldMax: 6  },
  skeleton:       { kind: 'skeleton',       displayName: 'Skeleton',       move: 6,  attack: 2, defense: 2, bodyMax: 1, mind: 0, goldMin: 1,  goldMax: 4  },
  zombie:         { kind: 'zombie',         displayName: 'Zombie',         move: 5,  attack: 2, defense: 3, bodyMax: 1, mind: 0, goldMin: 2,  goldMax: 5  },
  abomination:    { kind: 'abomination',    displayName: 'Abomination',    move: 6,  attack: 3, defense: 3, bodyMax: 2, mind: 3, goldMin: 3,  goldMax: 7  },
  mummy:          { kind: 'mummy',          displayName: 'Mummy',          move: 4,  attack: 3, defense: 4, bodyMax: 2, mind: 0, goldMin: 3,  goldMax: 8  },
  dread_warrior:  { kind: 'dread_warrior',  displayName: 'Dread Warrior',  move: 7,  attack: 4, defense: 3, bodyMax: 3, mind: 3, goldMin: 4,  goldMax: 9  },
  gargoyle:       { kind: 'gargoyle',       displayName: 'Gargoyle',       move: 6,  attack: 4, defense: 5, bodyMax: 3, mind: 4, goldMin: 4,  goldMax: 10 },
};

// ============================================================================
// Treasure deck — 24 cards (faithful to the HeroQuest rulebook)
//
// Composition:
//   Gold    ×4 (15,15,25,25)  — permanently removed when drawn
//   Gem     ×2 (35,35)        — permanently removed when drawn
//   Jewels  ×2 (50,50)        — permanently removed when drawn
//   Potion  ×6 (4 unique)     — permanently removed when drawn
//   Hazard  ×4                — returned to BOTTOM of deck, ends turn
//   Wandering Monster ×6      — returned to BOTTOM of deck, does NOT end turn
//
// Hazard/Wandering cards cycle back, so over time the proportion of bad cards
// rises as good cards are permanently consumed.
// ============================================================================

export function buildTreasureDeck(): TreasureCard[] {
  let n = 0;
  const id = () => `tr_${++n}`;
  const deck: TreasureCard[] = [
    // ── Gold (4 cards, permanently removed) ─────────────────────────────────
    { id: id(), kind: 'gold',   amount: 15 },
    { id: id(), kind: 'gold',   amount: 15 },
    { id: id(), kind: 'gold',   amount: 25 },
    { id: id(), kind: 'gold',   amount: 25 },
    // ── Gem (2 cards, permanently removed) ──────────────────────────────────
    { id: id(), kind: 'gem',    value: 35 },
    { id: id(), kind: 'gem',    value: 35 },
    // ── Jewels (2 cards, permanently removed) ────────────────────────────────
    { id: id(), kind: 'jewels', value: 50 },
    { id: id(), kind: 'jewels', value: 50 },
    // ── Potions (6 cards, 4 unique, permanently removed) ─────────────────────
    { id: id(), kind: 'potion', name: 'Heroic Brew',
      effect: 'brew',
      description: 'Drink before attacking to make two attacks this turn. The attacks may target different monsters.' },
    { id: id(), kind: 'potion', name: 'Potion of Defense',
      effect: 'defense',
      description: 'Drink at any time — gain +2 defense dice the next time you defend against an attack.' },
    { id: id(), kind: 'potion', name: 'Potion of Strength',
      effect: 'strength',
      description: 'Drink at any time — gain +2 attack dice for your next attack.' },
    { id: id(), kind: 'potion', name: 'Potion of Healing',
      effect: 'heal_d6',
      description: 'Drink at any time — restore Body Points equal to a roll of 1d6 (cannot exceed your maximum).' },
    { id: id(), kind: 'potion', name: 'Potion of Healing',
      effect: 'heal_d6',
      description: 'Drink at any time — restore Body Points equal to a roll of 1d6 (cannot exceed your maximum).' },
    { id: id(), kind: 'potion', name: 'Potion of Healing',
      effect: 'heal_d6',
      description: 'Drink at any time — restore Body Points equal to a roll of 1d6 (cannot exceed your maximum).' },
    // ── Hazard (4 cards, returned to bottom of deck) ─────────────────────────
    { id: id(), kind: 'hazard', flavor: 'You slip and twist an ankle.',  bpLoss: 1 },
    { id: id(), kind: 'hazard', flavor: 'A loose stone gives way.',      bpLoss: 1 },
    { id: id(), kind: 'hazard', flavor: 'A rusty blade nicks your hand.', bpLoss: 1 },
    { id: id(), kind: 'hazard', flavor: 'Disturbed dust fills your lungs.', bpLoss: 1 },
    // ── Wandering Monster (6 cards, returned to bottom of deck) ──────────────
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
    { id: id(), kind: 'wandering' },
  ];
  return deck; // caller must shuffle before use
}

// ============================================================================
// Quest 1 — "The Trial". The board, furniture, doors, monsters and staircase are
// the layout authored in the Map Authoring sandbox (quests/quest1.ts), wired
// into the playable engine 1:1. Quest-book content (Verag as the objective, the
// guardian mummy, and the 84/120-gold chests) is attached on top.
// ============================================================================

const TRIAL_BOARD = parseAsciiBoard(QUEST1_MAP);

function makeQuest1(): QuestDef {
  const board = TRIAL_BOARD;

  // ---- Furniture: expand each authored footprint into its cells. Furniture
  //      blocks movement (you can't stand on it) and blocks LOS per the author's
  //      flag. Treasure gold rides on the authored chests; the empty chest and
  //      chipped weapons rack get "nothing" flavor (which the editor can't set). ----
  const fixedContentFor = (f: typeof QUEST1_FURNITURE[number]): Furniture['fixedContent'] | undefined => {
    if (f.gold != null) return { kind: 'gold', amount: f.gold };
    if (f.kind === 'chest' && f.x === 20 && f.y === 19) return { kind: 'nothing', flavor: 'The chest is empty.' };
    if (f.kind === 'weapon_rack' && f.x === 13 && f.y === 18) return { kind: 'nothing', flavor: 'The weapons here are chipped, rusted, and broken — nothing you would want.' };
    return undefined;
  };
  const furniture: QuestDef['furniture'] = QUEST1_FURNITURE.map((f, i) => {
    const cells: Coord[] = [];
    for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) cells.push({ x: f.x + dx, y: f.y + dy });
    return {
      id: `furn_${i + 1}`,
      kind: f.kind as Furniture['kind'],
      cells,
      facing: f.rot ?? 0,
      blocksMove: true,
      blocksLos: f.los,
      fixedContent: fixedContentFor(f),
    };
  });

  // ---- Monsters: stats from the chart; roomId read from the parsed board.
  //      Named bosses come straight from the authored data — Verag (the objective)
  //      and the tomb Guardian, who as a named mummy rolls 4 attack dice. ----
  const monsters: QuestDef['monsters'] = QUEST1_MONSTERS.map((m, i) => {
    const kind = m.kind as MonsterKind;
    const st = MONSTER_STATS[kind];
    const isGuardian = kind === 'mummy' && !!m.name;
    return {
      id: `mon_${i + 1}`,
      kind,
      at: { x: m.x, y: m.y },
      bodyMax: st.bodyMax,
      attack: isGuardian ? 4 : st.attack,
      defense: st.defense,
      move: st.move,
      mind: st.mind,
      displayName: m.name,
      goldMin: st.goldMin,
      goldMax: st.goldMax,
      roomId: board.regions[m.y][m.x],
    };
  });

  // ---- Doors: each authored edge-door becomes a 1-cell crossing. v=true sits on
  //      the LEFT edge of (x,y); v=false sits on the TOP edge of (x,y). ----
  const doors: QuestDef['doors'] = QUEST1_DOORS.map((d, i) => ({
    id: `door_${i + 1}`,
    crossings: d.v
      ? [{ a: { x: d.x, y: d.y }, b: { x: d.x - 1, y: d.y } }]
      : [{ a: { x: d.x, y: d.y }, b: { x: d.x, y: d.y - 1 } }],
    secret: !!d.secret,
  }));

  return {
    id: 'the_trial',
    name: 'The Trial',
    briefing:
      '"You have learned well, my friends. Now has come the time of your first trial. You ' +
      'must first enter the catacombs that contain Fellmarg’s tomb. You must seek out and ' +
      'destroy Verag, a foul gargoyle that hides in the catacombs. This quest is not easy, and ' +
      'you must work together in order to survive. This is your first step on the road to ' +
      'becoming true heroes. Tread carefully, my friends."',
    width: board.width,
    height: board.height,
    tiles: board.tiles,
    regions: board.regions,
    doors,
    furniture,
    traps: [],
    monsters,
    startCells: board.startCells,
    wanderingMonster: 'orc', // Quest 1's wandering monster is the Orc (book)
    winCondition: { kind: 'kill_and_exit', monsterDisplayName: 'Verag' },
    reward: { kind: 'none' }, // the reward is the gold in the chests (84 + 120)
    // "Special notes" read aloud when each room is first entered. Short, original
    // placeholders — swap in your own Quest-Book wording per room.
    roomNotes: [
      { at: { x: 8, y: 3 },   text: 'An ancient guardian stirs, barring the way to the tomb beyond.' },
      { at: { x: 12, y: 2 },  text: "Here lies Fellmarg's tomb, watched over by the restless dead." },
      { at: { x: 14, y: 10 }, text: 'A foul gargoyle uncoils from the shadows. You have found Verag.' },
    ],
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
    foundPotions: [],
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
    goldMin: m.goldMin,
    goldMax: m.goldMax,
    roomId: m.roomId,
  };
}
