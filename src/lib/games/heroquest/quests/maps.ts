// All 14 Quest Book quests, expressed as overlays on the LOCKED board (board32 —
// our 32×23 layout with wider halls + larger rooms). Text — briefings,
// objectives, rewards, lettered notes — is transcribed from the Quest Book.
// Quest 1's placement is final (matches the live game); quests 2–14 are rough
// auto-drafts that get the real placement ruleset once it's locked on Quest 1.
// See docs/heroquest/quests/placement-ruleset.md.

import { inRoom, stairCells, type Cell, type RoomLabel } from './board32';

export type MonsterKind =
  | 'goblin' | 'orc' | 'skeleton' | 'zombie' | 'abomination' | 'mummy'
  | 'dread_warrior' | 'gargoyle' | 'dread_sorcerer';

export type FurnitureKind =
  | 'table' | 'chest' | 'cupboard' | 'bookcase' | 'rack' | 'weapon_rack'
  | 'throne' | 'tomb' | 'fireplace' | 'sorcerer_table' | 'alchemist_bench';

export type MapMonster = { kind: MonsterKind; at: Cell; name?: string; note?: string };
export type MapFurniture = { kind: FurnitureKind; at: Cell; label?: string };
export type MapTrap = { kind: 'pit' | 'spear' | 'falling_block' | 'chest'; at: Cell };
export type MapMarker = { label: string; at: Cell };           // A, B, C … note anchors / objective (X)
export type MapNote = { label: string; text: string };

export type QuestMap = {
  n: number;
  id: string;
  name: string;
  page: string;              // booklet page label
  briefing: string;          // read-aloud parchment
  objective: string;
  reward: string;
  wandering: string;         // wandering-monster name (or '—')
  special?: string;          // one-line summary of any special rule
  status?: 'final' | 'draft';// 'final' = placement locked; 'draft' = rough, pending ruleset
  startMarker?: Cell;        // when heroes begin somewhere other than the stairway
  stairs?: Cell[];           // (legacy / unused — the board owns the stairway now)
  rockRooms?: string[];      // (legacy / unused — the board owns the solid rock now)
  monsters: MapMonster[];
  furniture: MapFurniture[];
  traps: MapTrap[];
  markers: MapMarker[];
  notes: MapNote[];
};

// ---- placement helpers -----------------------------------------------------
// Compatibility shim: quests 2–14 were first drafted against a 19-room board
// (letters a–s). Map each of those onto the LOCKED 9-room board (board32) so the
// drafts still render while we lock the placement ruleset on Quest 1. These are
// rough — the gallery flags such quests as DRAFT until the ruleset is applied.
const LETTER_TO_ROOM: Record<string, RoomLabel> = {
  k: 'TL', l: 'TC', p: 'TR',
  a: 'ML', b: 'C', i: 'TC', e: 'MR', f: 'MR', q: 'MR',
  g: 'BL', n: 'C', o: 'C', j: 'BR', r: 'BR',
  h: 'BL', c: 'BC', d: 'BC', m: 'BR', s: 'BR',
};
/** Centre of a room. Accepts a room LABEL ('C', 'TR', …) or a legacy letter. */
function R(key: string, dx = 0, dy = 0): Cell {
  const label = (LETTER_TO_ROOM[key] ?? key) as RoomLabel;
  return inRoom(label, dx, dy);
}
/** A literal cell (corridor / explicit placement). */
function C(x: number, y: number): Cell { return { x, y }; }

export const QUEST_MAPS: QuestMap[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 1, id: 'the_trial', name: 'The Trial', page: 'Page 5',
    briefing:
      'You have learned well, my friends. Now has come the time of your first trial. ' +
      'You must first enter the catacombs that contain Fellmarg’s tomb. You must seek out ' +
      'and destroy Verag, a foul gargoyle that hides in the catacombs. This quest is not ' +
      'easy, and you must work together in order to survive. Tread carefully, my friends.',
    objective: 'Find and destroy Verag (a gargoyle).',
    reward: 'The gold in the chests (84 + 120).',
    wandering: 'Orc',
    special: 'No traps or secret doors in this first quest.',
    status: 'final',
    stairs: stairCells('BL', 'tl'),    // lower-left entrance (matches the live game)
    // Exact placements from the live game (content.ts QUEST1) on the locked board.
    monsters: [
      { kind: 'gargoyle', at: C(13, 9), name: 'Verag', note: 'objective' },
      { kind: 'mummy', at: C(13, 3), name: 'Guardian of Fellmarg’s Tomb', note: 'C — rolls 4 attack dice' },
      { kind: 'goblin', at: C(4, 2) }, { kind: 'goblin', at: C(5, 4) }, { kind: 'goblin', at: C(20, 4) },
      { kind: 'goblin', at: C(4, 9) }, { kind: 'goblin', at: C(12, 17) }, { kind: 'goblin', at: C(14, 16) },
      { kind: 'orc', at: C(13, 16) }, { kind: 'orc', at: C(19, 17) }, { kind: 'orc', at: C(21, 9) }, { kind: 'orc', at: C(5, 9) },
    ],
    furniture: [
      { kind: 'weapon_rack', at: C(12, 15), label: 'A' },
      { kind: 'chest', at: C(20, 15), label: 'B' },
      { kind: 'chest', at: C(20, 3), label: 'D' },
      { kind: 'chest', at: C(15, 8), label: 'E' },
      { kind: 'tomb', at: C(11, 2) },
      { kind: 'table', at: C(5, 16) },
    ],
    traps: [],
    markers: [],
    notes: [
      { label: 'A', text: 'The weapons on this rack are chipped, rusted, broken — nothing the heroes would want.' },
      { label: 'B', text: 'This treasure chest is empty.' },
      { label: 'C', text: 'The mummy guardian of Fellmarg’s tomb rolls 4 attack dice instead of 3.' },
      { label: 'D', text: 'The first hero to search for treasure here finds 84 gold coins.' },
      { label: 'E', text: 'The first hero to search for treasure here finds 120 gold coins.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 2, id: 'rescue_sir_ragnar', name: 'The Rescue of Sir Ragnar', page: 'Page 7',
    briefing:
      'Sir Ragnar, one of the King’s most powerful knights, has been captured. There is ' +
      'reason to believe he is held prisoner by Ulag, the orc warlord. Find Sir Ragnar and ' +
      'bring him back to the stairway. Prince Magnus offers 240 gold coins, divided among ' +
      'the heroes, if Sir Ragnar is rescued. No reward is earned if he is killed in the escape.',
    objective: 'Rescue Sir Ragnar and escort him to the stairs alive.',
    reward: '240 gold (divided) — only if he survives.',
    wandering: 'Orc',
    special: 'Finding Ragnar sounds an alarm: all monsters/doors placed, all doors open. Ragnar rolls 2 defend, 2 Body, can’t attack; escort moves him with 1 red die.',
    stairs: stairCells('ML', 'tl'),    // centre-left
    rockRooms: [],
    monsters: [
      { kind: 'dread_sorcerer', at: R('i'), name: 'Sir Ragnar', note: 'X — prisoner (Dread-sorcerer figure)' },
      { kind: 'orc', at: R('a'), name: 'Ulag', note: 'orc warlord' },
      { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('e') }, { kind: 'orc', at: R('f') },
      { kind: 'orc', at: R('j') }, { kind: 'orc', at: R('d') }, { kind: 'orc', at: R('c') },
      { kind: 'goblin', at: R('k') }, { kind: 'goblin', at: R('m') },
    ],
    furniture: [
      { kind: 'chest', at: R('h'), label: 'A' },
      { kind: 'chest', at: R('p'), label: 'B' },
      { kind: 'tomb', at: R('c', 0, -1) }, { kind: 'bookcase', at: R('e') }, { kind: 'table', at: R('b') },
    ],
    traps: [],
    markers: [{ label: 'X', at: R('i') }],
    notes: [
      { label: 'A', text: 'The chest has a poison-needle trap. Searching before it is disarmed costs 1 Body Point. The chest is empty.' },
      { label: 'B', text: 'First search here finds 60 gold and a Potion of Healing (restores up to 4 Body Points).' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 3, id: 'lair_orc_warlord', name: 'Lair of the Orc Warlord', page: 'Page 9',
    briefing:
      'Prince Magnus has ordered that the orc warlord Ulag — responsible for imprisoning Sir ' +
      'Ragnar — be sought out and destroyed. When Ulag is destroyed the heroes are rewarded ' +
      '180 gold coins, divided among them. Any treasure found in Ulag’s stronghold may be ' +
      'kept by the finder alone.',
    objective: 'Destroy Ulag.',
    reward: '180 gold (divided). Treasure kept by finder alone.',
    wandering: 'Orc',
    special: 'Ulag: Move 10 · Attack 4 · Defend 5 · Body 2 · Mind 3.',
    stairs: stairCells('TC', 'tl'),    // top-centre
    rockRooms: [],
    monsters: [
      { kind: 'orc', at: R('a'), name: 'Ulag', note: 'objective' },
      { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('k') }, { kind: 'orc', at: R('l') },
      { kind: 'orc', at: R('g') }, { kind: 'orc', at: R('h') }, { kind: 'orc', at: R('c') },
      { kind: 'orc', at: R('n') }, { kind: 'orc', at: R('o') }, { kind: 'goblin', at: R('i') },
    ],
    furniture: [
      { kind: 'weapon_rack', at: R('k'), label: 'A' },
      { kind: 'cupboard', at: R('g'), label: 'B' },
      { kind: 'table', at: R('b') }, { kind: 'bookcase', at: R('c') },
    ],
    traps: [],
    markers: [],
    notes: [
      { label: 'A', text: 'The orc’s armory. The first hero to search finds a Staff (keep or give to another hero).' },
      { label: 'B', text: 'First search finds 24 gold and a Potion of Healing (up to 4 Body Points) in the cupboard.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 4, id: 'prince_magnus_gold', name: 'Prince Magnus’ Gold', page: 'Page 11',
    briefing:
      'Three treasure chests were stolen while being taken to the King. A reward of 240 gold ' +
      'coins is offered to any heroes who return the chests and all of the gold. The thieves ' +
      'are a band of orcs of the Dark Mountains, led by Gulthor, a Dread warrior.',
    objective: 'Recover all 3 chests and return them to the stairway.',
    reward: '240 gold. (Gold inside the chests goes to the King.)',
    wandering: 'Abomination',
    special: 'A carried chest limits the hero to 1 red die of movement; only one chest at a time. First quest with traps.',
    stairs: stairCells('BR', 'br'),    // lower-right
    rockRooms: [],
    monsters: [
      { kind: 'dread_warrior', at: R('i'), name: 'Gulthor', note: 'leads the band' },
      { kind: 'orc', at: R('a') }, { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('k') },
      { kind: 'orc', at: R('e') }, { kind: 'orc', at: R('j') }, { kind: 'abomination', at: R('f') },
      { kind: 'abomination', at: R('c') }, { kind: 'orc', at: R('g') }, { kind: 'orc', at: R('h') },
    ],
    furniture: [
      { kind: 'chest', at: R('i', -1, 0), label: 'A' },
      { kind: 'chest', at: R('i', 0, 1), label: 'A' },
      { kind: 'chest', at: R('i', 1, 0), label: 'A' },
      { kind: 'table', at: R('b') }, { kind: 'weapon_rack', at: R('a') }, { kind: 'tomb', at: R('c') },
    ],
    traps: [
      { kind: 'pit', at: R('e', 0, 2) }, { kind: 'spear', at: R('g', 1, 0) },
      { kind: 'pit', at: R('h', -1, 1) }, { kind: 'spear', at: C(12, 9) },
    ],
    markers: [{ label: 'A', at: R('i') }],
    notes: [
      { label: 'A', text: 'The three chests bear the prince’s royal seal. Each is locked and holds 250 gold + items of value to the King. A hero may carry only one chest at a time, moving with just 1 red die; the heroes cannot keep the gold inside.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 5, id: 'melars_maze', name: 'Melar’s Maze', page: 'Page 13',
    briefing:
      'Long ago a powerful wizard named Melar created a Talisman of Lore that enhances the ' +
      'wearer’s understanding of magic. Melar hid the talisman in an underground laboratory ' +
      'at the heart of his maze, fearing the evil minions of Zargon. Beware of many traps ' +
      'and deadly monsters as you search for the talisman.',
    objective: 'Find the Talisman of Lore.',
    reward: 'The Talisman of Lore (artifact).',
    wandering: 'Zombie',
    special: 'B: a statue-gargoyle wakes only when the next door opens, and is unharmable until it moves/attacks. E: a treasure search finds Melar’s key, sliding a throne aside to reveal a secret door.',
    stairs: stairCells('TL', 'tl'),    // upper-left
    rockRooms: ['room_p', 'room_q', 'room_r', 'room_s', 'room_m'],
    monsters: [
      { kind: 'gargoyle', at: R('f'), name: 'Stone statue', note: 'B — dormant / invulnerable' },
      { kind: 'zombie', at: R('a') }, { kind: 'zombie', at: R('b') }, { kind: 'zombie', at: R('g') },
      { kind: 'zombie', at: R('c') }, { kind: 'zombie', at: R('i') }, { kind: 'zombie', at: R('e') },
      { kind: 'zombie', at: R('j') }, { kind: 'zombie', at: R('d') },
    ],
    furniture: [
      { kind: 'alchemist_bench', at: R('a'), label: 'A' },
      { kind: 'chest', at: R('e'), label: 'C' },
      { kind: 'tomb', at: R('d', 0, -1), label: 'D' },
      { kind: 'throne', at: R('j'), label: 'E' },
    ],
    traps: [
      { kind: 'spear', at: R('a', 0, 2) }, { kind: 'pit', at: R('b', 0, 2) },
      { kind: 'spear', at: C(12, 9) }, { kind: 'pit', at: R('i', 0, 2) }, { kind: 'spear', at: R('d', 0, -2) },
    ],
    markers: [{ label: 'D', at: R('d') }],
    notes: [
      { label: 'A', text: 'First treasure search finds a half-filled flask on the alchemist’s bench — a Potion of Healing (up to 2 Body Points).' },
      { label: 'B', text: 'A gargoyle that appears to be a stone statue. It does not move until a hero opens the door into the next room, and cannot be harmed until it has moved or attacked.' },
      { label: 'C', text: 'A chest filled with poisonous gas — a trap! Searching before disarming costs 2 Body Points. It also holds 144 gold.' },
      { label: 'D', text: 'First treasure search finds the Talisman of Lore (the quest objective).' },
      { label: 'E', text: 'Searching for secret doors finds nothing, but searching for treasure finds Melar’s key; touching it slides the throne aside, revealing a secret door.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 6, id: 'legacy_orc_warlord', name: 'Legacy of the Orc Warlord', page: 'Page 15',
    briefing:
      'Ulag’s foul offspring, Grak, has sworn revenge and captured you in an ambush. You are ' +
      'held prisoner in his dungeons. While the guard sleeps outside your cell, you pick the ' +
      'lock with an old rat bone. You must find your equipment and escape to the stairway.',
    objective: 'Recover your equipment (A) and escape via the stairway (B).',
    reward: 'Grak drops the Wizard’s Cloak artifact (goes to the wizard).',
    wandering: 'Abomination',
    special: 'Heroes begin disarmed in the Cell — no equipment or spells until reclaimed; unarmed heroes roll 1 attack / 2 defend. Grak: Move 8 · Atk 4 · Def 3 · Body 3 · Mind 3; casts Fear, Sleep, Tempest.',
    stairs: [C(1, 16), C(1, 17)],
    startMarker: inRoom('ML'),         // begin in the Cell (centre-left)
    rockRooms: [],
    monsters: [
      { kind: 'orc', at: R('e'), name: 'Grak', note: 'casts Dread spells' },
      { kind: 'orc', at: R('a') }, { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('f') },
      { kind: 'abomination', at: R('j') }, { kind: 'orc', at: R('d') }, { kind: 'orc', at: R('c') },
      { kind: 'goblin', at: R('g') }, { kind: 'goblin', at: R('m') }, { kind: 'orc', at: R('p') },
    ],
    furniture: [
      { kind: 'cupboard', at: R('k'), label: 'A' },
      { kind: 'table', at: R('i') }, { kind: 'bookcase', at: R('e') },
    ],
    traps: [
      { kind: 'pit', at: C(8, 18) }, { kind: 'spear', at: C(16, 18) }, { kind: 'pit', at: C(20, 18) },
    ],
    markers: [{ label: 'B', at: C(1, 16) }, { label: 'Cell', at: R('i') }],
    notes: [
      { label: 'A', text: 'The heroes’ equipment is in this cupboard. Each hero must enter to collect their belongings; spells become usable again once a hero reclaims their powers.' },
      { label: 'B', text: 'These stairs lead out to freedom — any hero who moves onto the stairway has escaped.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 7, id: 'the_lost_wizard', name: 'The Lost Wizard', page: 'Page 17',
    briefing:
      'Wardoz, the King’s personal wizard, has disappeared. You must find out what happened ' +
      'to Wardoz. You are each to be paid 100 gold coins upon returning to the stairway.',
    objective: 'Discover Wardoz’s fate (D) and return to the stairway.',
    reward: '100 gold each.',
    wandering: 'Mummy',
    special: 'A: every Dread warrior here is made of stone and rolls 1 extra defend die. C: a cursed purple potion turns the drinker to stone for 5 of their turns (invulnerable), then revives.',
    stairs: stairCells('TL', 'tl'),    // upper-left
    rockRooms: [],
    monsters: [
      { kind: 'zombie', at: R('d'), name: 'Wardoz', note: 'D — the zombie in wizard’s robes' },
      { kind: 'dread_warrior', at: R('a'), note: 'A — stone (+1 defend)' },
      { kind: 'dread_warrior', at: R('e'), note: 'A — stone (+1 defend)' },
      { kind: 'dread_warrior', at: R('j'), note: 'A — stone (+1 defend)' },
      { kind: 'dread_warrior', at: R('c'), note: 'A — stone (+1 defend)' },
      { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('g') }, { kind: 'skeleton', at: R('i') },
      { kind: 'skeleton', at: R('m') },
    ],
    furniture: [
      { kind: 'weapon_rack', at: R('q'), label: 'B' },
      { kind: 'chest', at: R('g'), label: 'C' },
      { kind: 'tomb', at: R('d', 0, -1) }, { kind: 'table', at: R('b') },
    ],
    traps: [
      { kind: 'spear', at: R('g', 0, 2) }, { kind: 'pit', at: C(6, 18) },
    ],
    markers: [{ label: 'D', at: R('d') }],
    notes: [
      { label: 'A', text: 'All Dread warriors in this quest are made of stone and roll 1 extra defend die. (Placed at several locations.)' },
      { label: 'B', text: 'The weapons room — first treasure search finds the artifact Borin’s Armor.' },
      { label: 'C', text: 'A chest with a poison-needle trap (search before disarm → −2 Body). Inside, a flask of purple liquid: a cursed potion that turns the drinker to stone for 5 of their turns (invulnerable), then revives.' },
      { label: 'D', text: 'The zombie in this room is Wardoz. After destroying it, first treasure search finds 144 gold and papers proving he was consumed by Dread magic and turned into a mindless zombie.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 8, id: 'the_fire_mage', name: 'The Fire Mage', page: 'Page 19',
    briefing:
      'The orcs of the Dark Mountains have been using Elemental fire magic in their raids. ' +
      'Balur, the fire mage, leads them. No fire magic can harm Balur. Enter his lair, deep ' +
      'beneath Darkfire Crag. A reward of 100 gold each is offered for Balur’s destruction.',
    objective: 'Destroy Balur.',
    reward: '100 gold each.',
    wandering: 'Abomination',
    special: 'Balur (Dread-sorcerer figure): Move 8 · Atk 2 · Def 5 · Body 3 · Mind 7; immune to fire; casts Ball of Flame, Firestorm, Tempest, Summon Orcs, Fear, Escape. Escape teleports him to the XX square.',
    stairs: stairCells('MR', 'tr'),    // mid-right
    rockRooms: [],
    monsters: [
      { kind: 'dread_sorcerer', at: R('k'), name: 'Balur', note: 'X — start (upper-left)' },
      { kind: 'orc', at: R('a') }, { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('l') },
      { kind: 'abomination', at: R('e') }, { kind: 'orc', at: R('f') }, { kind: 'orc', at: R('g') },
      { kind: 'abomination', at: R('c') }, { kind: 'orc', at: R('j') }, { kind: 'orc', at: R('d') },
      { kind: 'orc', at: R('h') }, { kind: 'orc', at: R('p') },
    ],
    furniture: [
      { kind: 'chest', at: R('m'), label: 'A' },
      { kind: 'sorcerer_table', at: R('i'), label: 'XX' },
      { kind: 'tomb', at: R('c') }, { kind: 'table', at: R('b') },
    ],
    traps: [
      { kind: 'spear', at: R('a', 0, 2) }, { kind: 'pit', at: R('b', 0, 2) }, { kind: 'spear', at: C(12, 9) },
      { kind: 'pit', at: R('e', 0, 2) }, { kind: 'spear', at: R('g', 0, 2) }, { kind: 'pit', at: R('j', 0, 2) },
      { kind: 'spear', at: R('h', 0, -2) }, { kind: 'pit', at: C(20, 9) },
    ],
    markers: [{ label: 'X', at: R('k') }, { label: 'XX', at: R('i') }],
    notes: [
      { label: 'A', text: 'This treasure chest holds 150 gold and the artifact Wand of Magic.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 9, id: 'race_against_time', name: 'Race Against Time', page: 'Page 21',
    briefing:
      'A guide has led you into an underground maze. In a room with three doors he suddenly ' +
      'puts out his torch. “Farewell, my heroes,” he taunts as he escapes. You realize it is ' +
      'a trap! You must escape — make it back to the stairway — or perish.',
    objective: 'Escape back to the stairway.',
    reward: 'The Elixir of Life (artifact) in chest C.',
    wandering: 'Abomination',
    special: 'Start in the three-door room (A), far from the exit stairs.',
    stairs: stairCells('TL', 'tl'),    // upper-left
    startMarker: inRoom('BR'),         // begin lower-right, escape to the stairs
    rockRooms: [],
    monsters: [
      { kind: 'abomination', at: R('a') }, { kind: 'abomination', at: R('e') },
      { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('f') }, { kind: 'orc', at: R('g') },
      { kind: 'orc', at: R('c') }, { kind: 'orc', at: R('j') }, { kind: 'orc', at: R('d') },
      { kind: 'goblin', at: R('i') }, { kind: 'goblin', at: R('m') },
    ],
    furniture: [
      { kind: 'chest', at: R('a'), label: 'B' },
      { kind: 'chest', at: R('g'), label: 'B' },
      { kind: 'chest', at: R('i'), label: 'C' },
      { kind: 'table', at: R('s') }, { kind: 'weapon_rack', at: R('d') },
    ],
    traps: [
      { kind: 'pit', at: R('s', 0, -2) }, { kind: 'spear', at: C(20, 18) },
    ],
    markers: [{ label: 'A', at: R('s') }],
    notes: [
      { label: 'A', text: 'The room where the heroes begin the quest (the three-door room).' },
      { label: 'B', text: 'These treasure chests each contain 100 gold.' },
      { label: 'C', text: 'A chest with a poison-gas trap — search before disarm → −3 Body. Inside is the artifact Elixir of Life.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 10, id: 'castle_of_mystery', name: 'Castle of Mystery', page: 'Page 23',
    briefing:
      'Long ago a wizard named Ollar discovered the entrance to a gold mine and built a magic ' +
      'castle above it. The lower chamber has many magical doors and is guarded by monsters ' +
      'trapped inside. Can you find the entrance to the gold mine?',
    objective: 'Explore and survive; leave via the stairs on a roll of 2 or 12.',
    reward: 'The 5,000 “gold” is fool’s gold; other treasure found is real.',
    wandering: '— (Ollar’s ghost, flavour only)',
    special: 'Teleporting doors: moving through any door stops you and rolls 2 dice → teleport to the numbered square (2–12). One door per turn.',
    stairs: stairCells('BL', 'tl'),    // lower-left
    rockRooms: [],
    monsters: [
      { kind: 'dread_warrior', at: R('j'), note: 'A — one of two' },
      { kind: 'dread_warrior', at: R('j', 1, 1), note: 'A — one of two' },
      { kind: 'orc', at: R('a') }, { kind: 'orc', at: R('b') }, { kind: 'skeleton', at: R('k') },
      { kind: 'skeleton', at: R('e') }, { kind: 'zombie', at: R('f') }, { kind: 'orc', at: R('g') },
      { kind: 'skeleton', at: R('c') }, { kind: 'orc', at: R('d') }, { kind: 'zombie', at: R('m') },
      { kind: 'orc', at: R('p') },
    ],
    furniture: [
      { kind: 'chest', at: R('i'), label: 'B' },
      { kind: 'table', at: R('b') }, { kind: 'bookcase', at: R('e') },
    ],
    traps: [],
    markers: [
      { label: 'B', at: R('i') },
      { label: '2/12', at: C(2, 15) },
      { label: '3', at: R('b') }, { label: '5', at: R('e') }, { label: '7', at: C(13, 9) },
      { label: '9', at: R('g') }, { label: '11', at: R('m') },
    ],
    notes: [
      { label: 'A', text: 'If both Dread warriors here are defeated, the first treasure search finds one wore the artifact Ring of Return.' },
      { label: 'B', text: 'The mine entrance — a hero may take 5,000 gold but cannot attack or defend while carrying it. The quest ends when all monsters are killed or all heroes leave via the stairs on a roll of 2 or 12. The 5,000 is revealed as fool’s gold.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 11, id: 'bastion_of_dread', name: 'Bastion of Dread', page: 'Page 25',
    briefing:
      'Lands to the east have been plagued by marauding orcs and goblins allied with Zargon. ' +
      'Destroy them. They are well protected in the Bastion of Dread, led by a small group of ' +
      'Dread warriors. You must fight your way in and kill all of the monsters.',
    objective: 'Kill every monster in the fortress.',
    reward: 'Per-kill bounty: goblin 10 · orc 20 · abomination 30 · Dread warrior 50.',
    wandering: 'Abomination',
    special: 'B: a gargoyle statue tied to a trap chest — searching the chest before disarming springs it to life; it cannot be harmed until it has moved/attacked.',
    stairs: stairCells('C', 'tl'),     // centre
    rockRooms: [],
    monsters: [
      { kind: 'dread_warrior', at: R('s'), name: 'Orc’s Bane bearer', note: 'C / A — armory' },
      { kind: 'gargoyle', at: R('g'), note: 'B — statue + trap chest' },
      { kind: 'dread_warrior', at: R('i') }, { kind: 'dread_warrior', at: R('d') },
      { kind: 'orc', at: R('a') }, { kind: 'orc', at: R('b') }, { kind: 'orc', at: R('k') },
      { kind: 'orc', at: R('l') }, { kind: 'orc', at: R('e') }, { kind: 'orc', at: R('f') },
      { kind: 'goblin', at: R('n') }, { kind: 'goblin', at: R('o') }, { kind: 'abomination', at: R('j') },
      { kind: 'orc', at: R('c') }, { kind: 'goblin', at: R('h') }, { kind: 'abomination', at: R('m') },
      { kind: 'orc', at: R('p') }, { kind: 'orc', at: R('q') },
    ],
    furniture: [
      { kind: 'weapon_rack', at: R('s'), label: 'A' },
      { kind: 'chest', at: R('g', 0, 1), label: 'B' },
      { kind: 'tomb', at: R('c') }, { kind: 'cupboard', at: R('e') }, { kind: 'table', at: R('b') },
    ],
    traps: [
      { kind: 'spear', at: C(12, 9) }, { kind: 'pit', at: R('e', 0, 2) }, { kind: 'spear', at: R('d', 0, -2) },
    ],
    markers: [{ label: 'C', at: R('s') }],
    notes: [
      { label: 'A', text: 'The armory — first treasure search finds a Shield (other weapons here are unusable).' },
      { label: 'B', text: 'A gargoyle stone statue tied to a trap chest: searching the chest before disarming springs the gargoyle to life. It cannot be harmed until it has moved or attacked.' },
      { label: 'C', text: 'A Dread warrior carries a magic sword — the artifact Orc’s Bane (goes to whoever kills him).' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 12, id: 'barak_tor', name: 'Barak Tor — Barrow of the Witch Lord', page: 'Page 27',
    briefing:
      'War with the eastern orcs is brewing. You must find the ancient Star of the West. A ' +
      'reward of 200 gold, divided evenly, awaits when the Star is returned to safety. The ' +
      'Star lies in Barak Tor, resting place of the evil Witch Lord — defeated long ago by ' +
      'the magical Spirit Blade, the only weapon that could harm him.',
    objective: 'Grab the Star of the West (B) and escape — the Witch Lord can’t be killed here.',
    reward: '200 gold (divided).',
    wandering: 'Skeleton',
    special: 'Witch Lord: only the Spirit Blade can harm him (recovered next quest). Moves 1/turn, 2 attack dice; casts Summon Undead, Fear, Command, Ball of Flame. A: false doors. C: a falling block seals the path back when the last hero passes. D: tomb — he wakes when the first hero enters.',
    stairs: stairCells('BL', 'tl'),    // lower-left
    rockRooms: [],
    monsters: [
      { kind: 'zombie', at: R('i'), name: 'Star bearer', note: 'B — Star is in its hand' },
      { kind: 'dread_sorcerer', at: R('h'), name: 'The Witch Lord', note: 'D — wakes on entry' },
      { kind: 'skeleton', at: R('a') }, { kind: 'skeleton', at: R('b') }, { kind: 'skeleton', at: R('e') },
      { kind: 'zombie', at: R('f') }, { kind: 'skeleton', at: R('j') }, { kind: 'mummy', at: R('d') },
      { kind: 'zombie', at: R('c') }, { kind: 'skeleton', at: R('m') },
    ],
    furniture: [
      { kind: 'tomb', at: R('h'), label: 'D' },
      { kind: 'bookcase', at: R('c'), label: 'E' },
      { kind: 'table', at: R('b') },
    ],
    traps: [
      { kind: 'falling_block', at: R('k', 0, 1) },
    ],
    markers: [
      { label: 'B', at: R('i') },
      { label: 'A', at: C(9, 9) }, { label: 'A', at: C(13, 6) },
      { label: 'C', at: R('k', 0, 1) }, { label: 'X', at: C(1, 11) },
    ],
    notes: [
      { label: 'A', text: 'False doors — these cannot be opened at all. (Placed at several locations.)' },
      { label: 'B', text: 'The Star of the West is in the zombie’s hand.' },
      { label: 'C', text: 'A falling-block trap that collapses automatically when the last hero passes onto the square — afterwards it forever blocks that path back to the stairs.' },
      { label: 'D', text: 'The tomb of the Witch Lord. He is released when the first hero enters the room. “You have broken the magic seal… Now he has awoken, and you must run. Only the Spirit Blade can harm him.”' },
      { label: 'E', text: 'First treasure search finds a magical staff behind the bookcase — the artifact Wizard’s Staff.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 13, id: 'quest_spirit_blade', name: 'Quest for the Spirit Blade', page: 'Page 29',
    briefing:
      'You have awoken the Witch Lord! He must be destroyed before he can bring his army of ' +
      'undead. Your goal is to find the Spirit Blade and return it to safety — only this ' +
      'ancient weapon can harm the Witch Lord. The sword now lies somewhere in an ancient ' +
      'ruined temple.',
    objective: 'Find the Spirit Blade (A) and return it to safety.',
    reward: 'The Spirit Blade (artifact) — needed to defeat the Witch Lord.',
    wandering: 'Dread Warrior',
    special: 'Rubble field (modified falling blocks): a hero who moves onto one rolls 1 die — 4/5/6 = −1 Body (with a helmet, only a 6). Monsters are unaffected and heroes are not blocked.',
    stairs: stairCells('TC', 'tl'),    // centre-upper
    rockRooms: [],
    monsters: [
      { kind: 'dread_warrior', at: R('a') }, { kind: 'dread_warrior', at: R('e') },
      { kind: 'skeleton', at: R('b') }, { kind: 'skeleton', at: R('k') }, { kind: 'zombie', at: R('f') },
      { kind: 'zombie', at: R('g') }, { kind: 'skeleton', at: R('c') }, { kind: 'mummy', at: R('d') },
      { kind: 'skeleton', at: R('j') }, { kind: 'zombie', at: R('m') },
    ],
    furniture: [
      { kind: 'chest', at: R('s'), label: 'A' },
      { kind: 'chest', at: R('g'), label: 'B' },
      { kind: 'tomb', at: R('d', 0, -1) }, { kind: 'weapon_rack', at: R('a') }, { kind: 'table', at: R('b') },
    ],
    traps: [
      { kind: 'falling_block', at: C(12, 9) }, { kind: 'falling_block', at: C(13, 9) },
      { kind: 'falling_block', at: R('f', 0, 2) }, { kind: 'falling_block', at: R('j', 0, -1) },
    ],
    markers: [{ label: 'A', at: R('s') }],
    notes: [
      { label: 'A', text: 'First treasure search here finds the Spirit Blade (the quest objective).' },
      { label: 'B', text: 'This treasure chest holds 200 gold.' },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    n: 14, id: 'return_to_barak_tor', name: 'Return to Barak Tor', page: 'Page 31',
    briefing:
      'Now that you have found the Spirit Blade, you must return to Barak Tor and defeat the ' +
      'Witch Lord. The King has ridden forth to meet the eastern orcs at Darkfire Pass. If ' +
      'you fail, the Witch Lord will lead his army of undead against His Majesty’s forces ' +
      'from the rear, and nothing will prevent the forces of Dread from overrunning the land.',
    objective: 'Destroy the Witch Lord (now killable with the Spirit Blade).',
    reward: 'The Spell Ring artifact; surviving heroes are named “Champion”.',
    wandering: 'Mummy',
    special: 'Witch Lord (stronger now): Move 10 · Atk 5 · Def 6 · Body 4 · Mind 6; still only the Spirit Blade harms him. Casts Summon Undead, Fear (×2), Ball of Flame, Command, Tempest.',
    stairs: stairCells('BL', 'tl'),    // lower-left
    rockRooms: [],
    monsters: [
      { kind: 'dread_sorcerer', at: R('p'), name: 'The Witch Lord', note: 'X — upper-right' },
      { kind: 'skeleton', at: R('a') }, { kind: 'skeleton', at: R('b') }, { kind: 'zombie', at: R('k') },
      { kind: 'mummy', at: R('e') }, { kind: 'dread_warrior', at: R('f') }, { kind: 'skeleton', at: R('g') },
      { kind: 'zombie', at: R('c') }, { kind: 'mummy', at: R('j') }, { kind: 'skeleton', at: R('d') },
      { kind: 'dread_warrior', at: R('i') }, { kind: 'zombie', at: R('m') },
    ],
    furniture: [
      { kind: 'tomb', at: R('g'), label: 'A' },
      { kind: 'table', at: R('b') }, { kind: 'bookcase', at: R('c') },
    ],
    traps: [
      { kind: 'spear', at: R('e', 0, 2) }, { kind: 'pit', at: R('p', 0, 2) },
    ],
    markers: [{ label: 'X', at: R('p') }, { label: 'A', at: R('g') }],
    notes: [
      { label: 'A', text: 'The Witch Lord’s tomb is now empty.' },
    ],
  },
];

export const QUEST_MAP_BY_ID: Record<string, QuestMap> = Object.fromEntries(
  QUEST_MAPS.map(q => [q.id, q]),
);
