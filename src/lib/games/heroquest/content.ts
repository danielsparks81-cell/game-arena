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
  { id: 'genie',       name: 'Genie',         element: 'air',   text: 'Choose: attack a monster for 1 BP, OR open a door, OR move the caster.' },
  { id: 'tempest',     name: 'Tempest',       element: 'air',   text: 'Chosen monster skips its next turn.' },
  { id: 'swift_wind',  name: 'Swift Wind',    element: 'air',   text: 'Target hero gets +3 squares of movement this turn.' },
  // Water
  { id: 'veil_of_mist', name: 'Veil of Mist', element: 'water', text: 'Caster teleports to any other hero\'s square.' },
  { id: 'heal_body_w', name: 'Heal Body',     element: 'water', text: 'Restore up to 4 BP to target.' },
  { id: 'water_heal',  name: 'Water of Healing', element: 'water', text: 'Restore up to 2 BP to target.' },
  // Fire
  { id: 'ball_of_flame', name: 'Ball of Flame', element: 'fire', text: 'Ranged 2-die attack on any LOS target.' },
  { id: 'courage',     name: 'Courage',       element: 'fire',  text: 'Target hero rolls 2 extra attack dice on next attack.' },
  { id: 'fire_of_wrath', name: 'Fire of Wrath', element: 'fire', text: 'Adjacent target takes 1 BP. No defense allowed.' },
  // Earth
  { id: 'pass_rock',   name: 'Pass Through Rock', element: 'earth', text: 'Caster moves through walls this turn.' },
  { id: 'heal_body_e', name: 'Heal Body',     element: 'earth', text: 'Restore up to 4 BP to target.' },
  { id: 'rock_skin',   name: 'Rock Skin',     element: 'earth', text: 'Target hero rolls 2 extra defense dice on next defense.' },
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

const QUEST1_W = 25;
const QUEST1_H = 17;

type Rect = { x: number; y: number; w: number; h: number; id: string };

const QUEST1_ROOMS: Rect[] = [
  { id: 'room_a', x: 1,  y: 1,  w: 6, h: 5 },   // NW — goblin pack
  { id: 'room_b', x: 10, y: 1,  w: 5, h: 5 },   // N  — orc + goblin
  { id: 'room_c', x: 18, y: 1,  w: 6, h: 5 },   // NE — mummy guardian (Quest 1 'C')
  { id: 'room_d', x: 1,  y: 11, w: 6, h: 5 },   // SW — fimir + goblin
  { id: 'room_e', x: 10, y: 11, w: 5, h: 5 },   // S  — treasure (chest D + rack A)
  { id: 'room_f', x: 18, y: 11, w: 6, h: 5 },   // SE — Verag (Gargoyle) + chest E
];

/** Doors: cell coords for the door tile itself. Each sits on the wall between
    its room and the central corridor (rows 6 or 10). */
const QUEST1_DOORS: Array<{ at: { x: number; y: number } }> = [
  { at: { x: 3,  y: 6  } },   // room_a → corridor (south wall of A)
  { at: { x: 12, y: 6  } },   // room_b → corridor (south wall of B)
  { at: { x: 20, y: 6  } },   // room_c → corridor (south wall of C)
  { at: { x: 3,  y: 10 } },   // room_d → corridor (north wall of D)
  { at: { x: 12, y: 10 } },   // room_e → corridor (north wall of E)
  { at: { x: 20, y: 10 } },   // room_f → corridor (north wall of F)
];

/** Corridor cells — wide central horizontal hallway. */
function isCorridorCell(x: number, y: number): boolean {
  // Main corridor rows 7-9, columns 1-23.
  return y >= 7 && y <= 9 && x >= 1 && x <= 23;
}

function buildQuest1Map(): { tiles: TileKind[][]; regions: string[][]; doorAts: Array<{ x: number; y: number }>; stairsAt: { x: number; y: number } } {
  const W = QUEST1_W, H = QUEST1_H;
  const tiles: TileKind[][] = Array.from({ length: H }, () =>
    new Array<TileKind>(W).fill('wall'),
  );
  const regions: string[][] = Array.from({ length: H }, () =>
    new Array<string>(W).fill(''),
  );

  // Carve rooms.
  for (const r of QUEST1_ROOMS) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        tiles[y][x] = 'floor';
        regions[y][x] = r.id;
      }
    }
  }
  // Carve corridor.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isCorridorCell(x, y) && tiles[y][x] === 'wall') {
        tiles[y][x] = 'floor';
        regions[y][x] = 'corridor';
      }
    }
  }
  // Place doors. A door tile is walkable but blocks LOS until opened. We
  // overlay it on top of an existing wall between corridor & room.
  for (const d of QUEST1_DOORS) {
    tiles[d.at.y][d.at.x] = 'door';
    // Region: prefer the adjacent room (any one of the 4-neighbors).
    let region = 'corridor';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = d.at.x + dx, ny = d.at.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const r = regions[ny][nx];
      if (r && r !== 'corridor' && r !== '') { region = r; break; }
    }
    regions[d.at.y][d.at.x] = region;
  }
  // Stairway on the west edge, row 8 (corridor's middle row).
  const stairsAt = { x: 0, y: 8 };
  tiles[stairsAt.y][stairsAt.x] = 'stairs';
  regions[stairsAt.y][stairsAt.x] = 'stairway';

  return { tiles, regions, doorAts: QUEST1_DOORS.map(d => d.at), stairsAt };
}

function cellsInRect(r: Rect): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  }
  return out;
}

function makeQuest1(): QuestDef {
  const { tiles, regions, doorAts, stairsAt } = buildQuest1Map();

  // Build door objects — each door connects two adjacent cells of different
  // regions.
  const doors: QuestDef['doors'] = doorAts.map((at, i) => {
    let a: { x: number; y: number } | null = null;
    let b: { x: number; y: number } | null = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = at.x + dx, ny = at.y + dy;
      if (nx < 0 || ny < 0 || nx >= QUEST1_W || ny >= QUEST1_H) continue;
      const r = regions[ny][nx];
      if (!r) continue;
      if (!a) a = { x: nx, y: ny };
      else if (regions[a.y][a.x] !== r) b = { x: nx, y: ny };
    }
    return { id: `door_${i + 1}`, a: a ?? at, b: b ?? at, secret: false };
  });

  // Room id lookups by representative coordinate (top-left of each rect).
  const findRoomAt = (x: number, y: number) => regions[y]?.[x] ?? '';
  const roomA = findRoomAt(QUEST1_ROOMS[0].x, QUEST1_ROOMS[0].y);   // NW — goblin pack
  const roomB = findRoomAt(QUEST1_ROOMS[1].x, QUEST1_ROOMS[1].y);   // N  — orc + goblin
  const roomC = findRoomAt(QUEST1_ROOMS[2].x, QUEST1_ROOMS[2].y);   // NE — mummy
  const roomD = findRoomAt(QUEST1_ROOMS[3].x, QUEST1_ROOMS[3].y);   // SW — fimir + goblin
  const roomE = findRoomAt(QUEST1_ROOMS[4].x, QUEST1_ROOMS[4].y);   // S  — treasure
  const roomF = findRoomAt(QUEST1_ROOMS[5].x, QUEST1_ROOMS[5].y);   // SE — Verag

  // ---- Furniture ----
  const furniture: QuestDef['furniture'] = [];
  let furnN = 0;
  const cellAt = (r: Rect, dx: number, dy: number) => ({ x: r.x + dx, y: r.y + dy });

  // Room E (S) — Quest 1 location 'A' (broken weapons rack) and 'D' (84g chest).
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'rack',
    cells: [cellAt(QUEST1_ROOMS[4], 0, 0)],
    blocksMove: false,
    blocksLos: true,
    fixedContent: { kind: 'nothing', flavor: 'The rack holds only chipped, rusted weapons.' },
  });
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'chest',
    cells: [cellAt(QUEST1_ROOMS[4], 4, 4)],
    blocksMove: false,
    blocksLos: false,
    fixedContent: { kind: 'gold', amount: 84 },
  });

  // Room F (SE) — Quest 1 location 'E' (120g chest) + tomb scenery near Verag.
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'chest',
    cells: [cellAt(QUEST1_ROOMS[5], 1, 4)],
    blocksMove: false,
    blocksLos: false,
    fixedContent: { kind: 'gold', amount: 120 },
  });
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'tomb',
    cells: [cellAt(QUEST1_ROOMS[5], 4, 0)],
    blocksMove: true,
    blocksLos: true,
  });

  // Room C (NE) — Mummy guardian rises from a tomb. (Quest 1 location 'C'.)
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'tomb',
    cells: [cellAt(QUEST1_ROOMS[2], 4, 0)],
    blocksMove: true,
    blocksLos: true,
  });

  // Room A (NW) — empty cupboard for flavor (drawable nothing).
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'cupboard',
    cells: [cellAt(QUEST1_ROOMS[0], 5, 0)],
    blocksMove: false,
    blocksLos: true,
    fixedContent: { kind: 'nothing', flavor: 'The cupboard is empty save for moth-eaten rags.' },
  });

  // Room B (N) — a table for atmosphere (blocks neither move nor LOS in v1).
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'table',
    cells: [cellAt(QUEST1_ROOMS[1], 2, 2)],
    blocksMove: false,
    blocksLos: false,
  });

  // Room D (SW) — fireplace.
  furniture.push({
    id: `furn_${++furnN}`,
    kind: 'fireplace',
    cells: [cellAt(QUEST1_ROOMS[3], 0, 0)],
    blocksMove: true,
    blocksLos: true,
  });

  // ---- Monsters ----
  const monsters: QuestDef['monsters'] = [];
  let monN = 0;
  const placeIn = (
    r: Rect,
    kind: MonsterKind,
    rid: string,
    opts?: { displayName?: string; bodyMax?: number; attack?: number; cell?: { x: number; y: number } },
  ) => {
    const cell = opts?.cell ?? { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
    const stats = MONSTER_STATS[kind];
    monsters.push({
      id: `mon_${++monN}`,
      kind,
      at: cell,
      bodyMax: opts?.bodyMax ?? stats.bodyMax,
      attack: opts?.attack ?? stats.attack,
      defense: stats.defense,
      move: stats.move,
      displayName: opts?.displayName,
      gold: stats.gold,
      roomId: rid,
    });
  };

  // Room A (NW) — 3 goblins (pack).
  placeIn(QUEST1_ROOMS[0], 'goblin', roomA, { cell: { x: 2, y: 2 } });
  placeIn(QUEST1_ROOMS[0], 'goblin', roomA, { cell: { x: 4, y: 2 } });
  placeIn(QUEST1_ROOMS[0], 'goblin', roomA, { cell: { x: 3, y: 4 } });
  // Room B (N) — orc + goblin.
  placeIn(QUEST1_ROOMS[1], 'orc',    roomB, { cell: { x: 11, y: 2 } });
  placeIn(QUEST1_ROOMS[1], 'goblin', roomB, { cell: { x: 13, y: 4 } });
  // Room C (NE) — mummy guardian (+1 attack die per Quest 1 'C').
  placeIn(QUEST1_ROOMS[2], 'mummy', roomC, { attack: 4, cell: { x: 20, y: 3 } });
  // Room D (SW) — fimir + goblin.
  placeIn(QUEST1_ROOMS[3], 'fimir',  roomD, { cell: { x: 3, y: 13 } });
  placeIn(QUEST1_ROOMS[3], 'goblin', roomD, { cell: { x: 5, y: 13 } });
  // Room E (S) — orc patrol guarding the chest.
  placeIn(QUEST1_ROOMS[4], 'orc',    roomE, { cell: { x: 12, y: 13 } });
  // Room F (SE) — Verag (gargoyle), the quest target.
  placeIn(QUEST1_ROOMS[5], 'gargoyle', roomF, { displayName: 'Verag', cell: { x: 21, y: 13 } });

  // Four starting cells so all 4 heroes have a distinct square at the entry.
  // Stairway is at (0,8); the immediately adjacent corridor cells form a tidy
  // cross of starting positions. If any of these get bumped by future map
  // tweaks, the engine falls back to whichever start cells ARE valid floor.
  const startCells: { x: number; y: number }[] = [
    { x: 0, y: 8 },  // on the stairway
    { x: 1, y: 8 },  // immediately east of stairway
    { x: 1, y: 7 },  // NE
    { x: 1, y: 9 },  // SE
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
    wanderingMonster: 'orc',
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
