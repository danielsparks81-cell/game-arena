// HeroQuest — public barrel for the engine.

export {
  initialState,
  createInitialStateForHost,
  addPlayer,
  removePlayer,
  applyAction,
  getActivePlayerId,
  getOrderedPlayerIds,
  computeHistory,
  projectStateForViewer,
  hasLineOfSight,
} from './engine';

export type {
  HQState,
  HQAction,
  HeroClass,
  Hero,
  Monster,
  MonsterKind,
  Coord,
  Tile,
  TileKind,
  Door,
  Furniture,
  Trap,
  Spell,
  Item,
  TreasureCard,
  TreasureFx,
  HeldPotion,
  PotionEffect,
  DiceRoll,
  DieFace,
  LogEntry,
  Phase,
  Winner,
  ApplyResult,
  PendingPrompt,
  QuestDef,
  SpellElement,
  SpellDraft,
  LootPile,
  MonsterPersonality,
} from './types';

export { HERO_DEFAULTS, QUESTS, QUEST1, MONSTER_STATS, SPELLS, spellsByElement } from './content';
