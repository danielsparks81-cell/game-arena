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
  TileKind,
  TreasureCard,
} from './types';

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

const BROADSWORD: Item = { id: 'broadsword', name: 'Broadsword', kind: 'weapon', attack: 3, twoHanded: true, description: 'Two-handed; cannot use shield.' };
const SHORT_SWORD: Item = { id: 'short_sword', name: 'Short Sword', kind: 'weapon', attack: 2, description: 'A reliable blade.' };
const DAGGER: Item = { id: 'dagger', name: 'Dagger', kind: 'weapon', attack: 1, description: 'Light, easy to wield.' };
const STAFF: Item = { id: 'staff', name: 'Staff', kind: 'weapon', attack: 1, diagonal: true, description: 'Can attack diagonally.' };

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
  gold: number;
};

export const MONSTER_STATS: Record<MonsterKind, MonsterStats> = {
  goblin:         { kind: 'goblin',         displayName: 'Goblin',         bodyMax: 1, attack: 2, defense: 1, move: 10, gold: 5 },
  orc:            { kind: 'orc',            displayName: 'Orc',            bodyMax: 1, attack: 3, defense: 2, move: 8,  gold: 10 },
  fimir:          { kind: 'fimir',          displayName: 'Fimir',          bodyMax: 2, attack: 3, defense: 3, move: 6,  gold: 20 },
  skeleton:       { kind: 'skeleton',       displayName: 'Skeleton',       bodyMax: 1, attack: 2, defense: 2, move: 6,  gold: 15 },
  zombie:         { kind: 'zombie',         displayName: 'Zombie',         bodyMax: 1, attack: 2, defense: 3, move: 4,  gold: 20 },
  mummy:          { kind: 'mummy',          displayName: 'Mummy',          bodyMax: 2, attack: 3, defense: 4, move: 4,  gold: 25 },
  chaos_warrior:  { kind: 'chaos_warrior',  displayName: 'Chaos Warrior',  bodyMax: 3, attack: 3, defense: 3, move: 6,  gold: 35 },
  gargoyle:       { kind: 'gargoyle',       displayName: 'Gargoyle',       bodyMax: 3, attack: 4, defense: 4, move: 6,  gold: 75 },
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
// Quest 1 — "The Trial" (built programmatically; faithful to the rulebook map)
//
// Layout (25 wide × 17 tall):
//
//   - Entry stairway 'S' on the west edge, mid-height (row 8).
//   - Wide central corridor (rows 7–9) running east-west.
//   - 6 rooms branching off the corridor (3 north, 3 south), each accessible
//     by a single door, matching the rulebook's room cluster.
//
//   Room placements (with rulebook letters in parens):
//     room_a (NW)  goblin pack  — 3 goblins
//     room_b (N)   orc + goblin
//     room_c (NE)  mummy guardian + tomb (Quest 1 'C')
//     room_d (SW)  fimir + goblin
//     room_e (S)   weapons rack 'A' (broken) + chest 'D' (84 gold)
//     room_f (SE)  Verag's lair (gargoyle) + chest 'E' (120 gold) + tomb
//
//   Per the Zargon notes, Quest 1 has NO traps and NO secret doors.
//   Wandering monster: Orc.
//
// Programmatic construction guarantees consistent row widths and lets us
// place doors precisely on the boundary between corridor and room cells.
// ============================================================================

const QUEST1_W = 26;
const QUEST1_H = 19;

// "The Trial" authored as an ASCII map, following the official quest-book
// layout: rooms C/F/D across the top, a throne room (T) and Verag's chamber (E)
// plus an east room (G) across the middle, and rooms A/B with the entry
// staircase along the bottom — all linked by corridors. Legend:
//   #  solid rock        .  corridor floor       S  entry staircase
//   +  door              c f d t e g a b  room floor (region room_<letter>)
const QUEST1_MAP: string[] = [
  '##########################', // 0
  '#cccccc#ffff#ddddd########', // 1
  '#cccccc#ffff#ddddd########', // 2
  '#cccccc#ffff#ddddd########', // 3
  '#cccccc#ffff#ddddd########', // 4
  '###+#####+#####+##########', // 5
  '#....................#####', // 6
  '###+###.###+######+#######', // 7
  '#ttttt#.#eeeeee#gggggg####', // 8
  '#ttttt#.#eeeeee#gggggg####', // 9
  '#ttttt#.#eeeeee#gggggg####', // 10
  '#ttttt#.#eeeeee#gggggg####', // 11
  '#######.##################', // 12
  '#....................#####', // 13
  '##+######+#######+########', // 14
  '#SSS###aaaaaa##bbbbbb#####', // 15
  '#SSS###aaaaaa##bbbbbb#####', // 16
  '#SSS###aaaaaa##bbbbbb#####', // 17
  '##########################', // 18
];

/** Map a room glyph to its region id. */
const QUEST1_REGION: Record<string, string> = {
  c: 'room_c', f: 'room_f', d: 'room_d', t: 'room_t',
  e: 'room_e', g: 'room_g', a: 'room_a', b: 'room_b',
};

// Room interior rectangles (inclusive), for reference when placing furniture
// and monsters below:
//   room_c x1-6  y1-4    room_f x8-11 y1-4    room_d x13-17 y1-4
//   room_t x1-5  y8-11   room_e x9-14 y8-11   room_g x16-21 y8-11
//   room_a x7-12 y15-17  room_b x15-20 y15-17  stairway x1-3 y15-17

function buildQuest1Map(): {
  tiles: TileKind[][]; regions: string[][];
  doorAts: Array<{ x: number; y: number }>; stairsAt: { x: number; y: number };
} {
  const W = QUEST1_W, H = QUEST1_H;
  const tiles: TileKind[][] = Array.from({ length: H }, () => new Array<TileKind>(W).fill('wall'));
  const regions: string[][] = Array.from({ length: H }, () => new Array<string>(W).fill(''));
  const doorAts: Array<{ x: number; y: number }> = [];
  let stairsAt = { x: 1, y: 16 };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = QUEST1_MAP[y][x];
      if (ch === '#') continue;                                  // solid rock (default)
      if (ch === '.') { tiles[y][x] = 'floor'; regions[y][x] = 'corridor'; }
      else if (ch === 'S') { tiles[y][x] = 'stairs'; regions[y][x] = 'stairway'; stairsAt = { x, y }; }
      else if (ch === '+') { tiles[y][x] = 'door'; regions[y][x] = 'corridor'; doorAts.push({ x, y }); }
      else {
        const r = QUEST1_REGION[ch];
        if (r) { tiles[y][x] = 'floor'; regions[y][x] = r; }
      }
    }
  }

  // Give each door the region of the room it opens into (its non-corridor side).
  for (const at of doorAts) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = at.x + dx, ny = at.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const r = regions[ny][nx];
      if (r && r !== 'corridor') { regions[at.y][at.x] = r; break; }
    }
  }

  return { tiles, regions, doorAts, stairsAt };
}

function makeQuest1(): QuestDef {
  const { tiles, regions, doorAts } = buildQuest1Map();

  // Build door objects — each door bridges its corridor side (a) and room
  // side (b), with the door tile sitting on the wall between them.
  const doors: QuestDef['doors'] = doorAts.map((at, i) => {
    let corridor: { x: number; y: number } | null = null;
    let room: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = at.x + dx, ny = at.y + dy;
      if (nx < 0 || ny < 0 || nx >= QUEST1_W || ny >= QUEST1_H) continue;
      const k = tiles[ny][nx], r = regions[ny][nx];
      if (k === 'wall' || k === 'door') continue;
      if (r === 'corridor') corridor = { x: nx, y: ny };
      else if (r) room = { x: nx, y: ny };
    }
    return { id: `door_${i + 1}`, a: corridor ?? at, b: room ?? at, secret: false };
  });

  // ---- Furniture ----
  const furniture: QuestDef['furniture'] = [];
  let fn = 0;
  const furn = (
    kind: QuestDef['furniture'][number]['kind'],
    x: number, y: number, blocksMove: boolean, blocksLos: boolean,
    fixedContent?: QuestDef['furniture'][number]['fixedContent'],
  ) => {
    furniture.push({ id: `furn_${++fn}`, kind, cells: [{ x, y }], blocksMove, blocksLos, fixedContent });
  };
  furn('fireplace', 8, 1, true, true);                                                     // room F
  furn('throne', 1, 8, true, true);                                                        // room T
  furn('bookshelf', 9, 8, false, true);                                                    // room E
  furn('table', 13, 11, false, false);                                                     // room E
  furn('chest', 14, 11, false, false, { kind: 'gold', amount: 100 });                      // Verag's hoard
  furn('chest', 6, 4, false, false, { kind: 'gold', amount: 50 });                         // room C
  furn('cupboard', 13, 1, false, true, { kind: 'nothing', flavor: 'Empty but for cobwebs.' }); // room D
  furn('table', 16, 4, false, false);                                                      // room D
  furn('cupboard', 21, 8, false, true, { kind: 'nothing', flavor: 'Bare wooden shelves.' });    // room G
  furn('table', 18, 11, false, false);                                                     // room G
  furn('rack', 7, 17, false, true, { kind: 'nothing', flavor: 'Only chipped, rusted weapons remain.' }); // room A
  furn('table', 10, 15, false, false);                                                     // room A
  furn('table', 18, 15, false, false);                                                     // room B

  // ---- Monsters (lazy-spawn when their room is first revealed). ----
  const monsters: QuestDef['monsters'] = [];
  let mn = 0;
  const mob = (
    kind: MonsterKind, x: number, y: number, roomId: string,
    opts?: { displayName?: string; bodyMax?: number; attack?: number },
  ) => {
    const st = MONSTER_STATS[kind];
    monsters.push({
      id: `mon_${++mn}`, kind, at: { x, y },
      bodyMax: opts?.bodyMax ?? st.bodyMax,
      attack: opts?.attack ?? st.attack,
      defense: st.defense, move: st.move,
      displayName: opts?.displayName, gold: st.gold, roomId,
    });
  };
  // Room C — a goblin pack.
  mob('goblin', 2, 1, 'room_c'); mob('goblin', 4, 1, 'room_c');
  mob('goblin', 2, 3, 'room_c'); mob('goblin', 5, 3, 'room_c');
  // Room F (fireplace chamber).
  mob('goblin', 10, 2, 'room_f'); mob('goblin', 11, 3, 'room_f');
  // Room D.
  mob('goblin', 15, 2, 'room_d');
  // Room T (throne room).
  mob('goblin', 3, 9, 'room_t'); mob('goblin', 4, 10, 'room_t');
  // Room E — Verag (the quest target) and a goblin guard.
  mob('gargoyle', 11, 9, 'room_e', { displayName: 'Verag' });
  mob('goblin', 12, 10, 'room_e');
  // Room G (east chamber).
  mob('goblin', 17, 9, 'room_g'); mob('goblin', 20, 10, 'room_g');
  // Room A.
  mob('goblin', 9, 16, 'room_a'); mob('goblin', 11, 16, 'room_a');
  // Room B.
  mob('goblin', 16, 16, 'room_b'); mob('goblin', 19, 16, 'room_b');

  // Heroes begin on the entry staircase (bottom-left).
  const startCells: { x: number; y: number }[] = [
    { x: 1, y: 15 }, { x: 2, y: 15 }, { x: 3, y: 15 }, { x: 2, y: 16 },
  ];

  return {
    id: 'the_trial',
    name: 'The Trial',
    briefing:
      'Mentor: "Welcome, brave heroes. Your first trial is to descend into the catacombs ' +
      'and destroy Verag, a Chaos gargoyle that has nested below. Return alive to the stairway."',
    width: QUEST1_W,
    height: QUEST1_H,
    tiles,
    regions,
    doors,
    furniture,
    traps: [],
    monsters,
    startCells,
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
