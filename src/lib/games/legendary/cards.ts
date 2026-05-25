// Central registry of every card definition in the game. Keyed by cardId;
// the engine looks up instances through this map and never holds card text
// in state — only the cardId. So updating a card's printed text is a deploy,
// not a state migration.

import type { CardDef, CardId } from './types';

import { TROOPER, AGENT, SHIELD_CARDS } from './heroes/shield';
import { ALL_HERO_CLASSES } from './heroes/all-heroes';
import { HYDRA_GROUP } from './villains/hydra';
import { MASTERS_OF_EVIL_GROUP } from './villains/masters-of-evil';
import { BROTHERHOOD_GROUP } from './villains/brotherhood';
import { DOOMBOT_HENCHMAN_GROUP } from './villains/doombot-legion';
import { ENEMIES_OF_ASGARD_GROUP } from './villains/enemies-of-asgard';
import { HAND_NINJA_GROUP } from './villains/hand-ninjas';
import { SAVAGE_LAND_MUTATES_GROUP } from './villains/savage-land-mutates';
import { SENTINEL_GROUP } from './villains/sentinels';
import { RED_SKULL, RED_SKULL_TACTICS } from './masterminds/red-skull';
import { DR_DOOM, DR_DOOM_TACTICS } from './masterminds/dr-doom';
import { LOKI, LOKI_TACTICS } from './masterminds/loki';
import { MAGNETO, MAGNETO_TACTICS } from './masterminds/magneto';
import { NEGATIVE_ZONE_PRISON_BREAKOUT } from './schemes/prison-breakout';
import { COSMIC_CUBE } from './schemes/cosmic-cube';
import { SUPER_HERO_CIVIL_WAR } from './schemes/super-hero-civil-war';
import { KILLBOTS } from './schemes/killbots';
import { DARK_PORTALS } from './schemes/dark-portals';
import { SKRULL_INVASION } from './schemes/skrull-invasion';
import { MIDTOWN_BANK_ROBBERY } from './schemes/bank-robbery';
import { LEGACY_VIRUS } from './schemes/legacy-virus';

// Hero classes available for selection at game-setup time.
// All 15 base-set classes are registered so their baseAttack/baseRecruit
// stats work when cards are played from the hand.
export const HERO_CLASSES = ALL_HERO_CLASSES;

export const VILLAIN_GROUPS = [HYDRA_GROUP, BROTHERHOOD_GROUP, ENEMIES_OF_ASGARD_GROUP, MASTERS_OF_EVIL_GROUP] as const;
export const HENCHMAN_GROUPS = [
  HAND_NINJA_GROUP,
  DOOMBOT_HENCHMAN_GROUP,
  SAVAGE_LAND_MUTATES_GROUP,
  SENTINEL_GROUP,
] as const;
export const MASTERMINDS = [RED_SKULL, DR_DOOM, LOKI, MAGNETO] as const;
export const SCHEMES = [
  NEGATIVE_ZONE_PRISON_BREAKOUT,
  COSMIC_CUBE,
  SUPER_HERO_CIVIL_WAR,
  KILLBOTS,
  DARK_PORTALS,
  SKRULL_INVASION,
  MIDTOWN_BANK_ROBBERY,
  LEGACY_VIRUS,
] as const;

// "System" cards — wounds and bystanders. Fixed defs the engine references
// directly via these constants.
export const WOUND: CardDef = {
  kind: 'wound', cardId: 'wound', name: 'Wound',
  text: 'Healing: If you don\'t recruit or fight anything on your turn, you may KO all the Wounds from your hand.',
};
export const BYSTANDER: CardDef = {
  kind: 'bystander', cardId: 'bystander', name: 'Bystander', vp: 1,
};
export const MASTER_STRIKE: CardDef = {
  kind: 'master_strike', cardId: 'master_strike', name: 'Master Strike',
};
export const SCHEME_TWIST: CardDef = {
  kind: 'scheme_twist', cardId: 'scheme_twist', name: 'Scheme Twist',
};

/**
 * Build the cardId → CardDef map. Every card definition the engine could
 * reference goes through here; the engine deals strictly in cardIds and
 * resolves on read.
 */
function buildCatalog(): Record<CardId, CardDef> {
  const cat: Record<CardId, CardDef> = {};
  const add = (def: CardDef) => { cat[def.cardId] = def; };

  for (const c of SHIELD_CARDS) add(c);
  for (const hc of HERO_CLASSES) for (const { def } of hc.cards) add(def);
  for (const vg of VILLAIN_GROUPS) for (const { def } of vg.cards) add(def);
  for (const hg of HENCHMAN_GROUPS) for (const { def } of hg.cards) add(def);
  for (const mm of MASTERMINDS) add(mm);
  for (const s of SCHEMES) add(s);
  // Mastermind Tactic cards — not iterated from a group, registered individually.
  for (const t of RED_SKULL_TACTICS) add(t);
  for (const t of DR_DOOM_TACTICS) add(t);
  for (const t of LOKI_TACTICS) add(t);
  for (const t of MAGNETO_TACTICS) add(t);
  add(WOUND); add(BYSTANDER); add(MASTER_STRIKE); add(SCHEME_TWIST);
  return cat;
}

/** All known cards, keyed by cardId. */
export const CARDS: Record<CardId, CardDef> = buildCatalog();

/** cardId → copy count within its hero class (1 = rare, 3 = uncommon, 5 = common).
 *  Used for rarity-based visual styling (corner radius). Only covers classes
 *  currently wired into HERO_CLASSES — unknown cards return undefined. */
export const CARD_COPIES: Record<CardId, number> = Object.fromEntries(
  HERO_CLASSES.flatMap(hc => hc.cards.map(({ def, copies }) => [def.cardId, copies]))
);

/** Convenience: look up a card by id, throw if unknown (engine bugs). */
export function getCard(id: CardId): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown cardId: ${id}`);
  return c;
}

/** Quick check for whether a cardId represents a hero (player-deck-eligible
 *  card). Wounds and bystanders are NOT heroes even though they go into
 *  player decks. */
export function isHero(id: CardId): boolean {
  return getCard(id).kind === 'hero';
}

// Pure constants — tunable per scheme/player-count in real Legendary, but
// MVP-static for now. We'll parameterize when we add the second scheme.
export const HQ_SIZE = 5;
export const CITY_SIZE = 5;
export const STARTER_TROOPERS = 4;  // 4 Troopers (Attack) per player
export const STARTER_AGENTS = 8;    // 8 Agents (Recruit) per player
export const STARTING_HAND_SIZE = 6;
/** How many Master Strikes go in the Villain Deck regardless of scheme. */
export const MASTER_STRIKES_IN_DECK = 5;
/** Default per-game hero-class count (~5 fills the HQ and gives variety). */
export const HERO_CLASSES_PER_GAME = 5;
export const TROOPERS_AVAILABLE_TOTAL = 30;
export const AGENTS_AVAILABLE_TOTAL = 16;

/** Human-readable display names for every villain/henchman team ID. Used when
 *  rendering the mastermind's "Always Leads" label in both the board and sandbox. */
export const TEAM_DISPLAY_NAMES: Record<string, string> = {
  'hydra':               'HYDRA',
  'doombot-legion':      'Doombot Legion',
  'enemies-of-asgard':   'Enemies of Asgard',
  'brotherhood':         'Brotherhood',
  'masters-of-evil':     'Masters of Evil',
  'hand_ninjas':         'Hand Ninjas',
  'sentinels':           'Sentinels',
  'savage_land_mutates': 'Savage Land Mutates',
};

/** Resolve a team ID to its display name, falling back to the raw id. */
export function teamDisplayName(team: string): string {
  return TEAM_DISPLAY_NAMES[team] ?? team;
}

// Engine constants
export const LOG_MAX = 500;
export const STATE_VERSION = 1;
export const HIDDEN_CARD: CardId = '__hidden__';
