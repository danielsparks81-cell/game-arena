// Master list of every hero class defined in the codebase.
// Import this wherever you need to enumerate all available hero classes
// (e.g. the sandbox browser, game-setup picker, etc.).
// NOT the same as HERO_CLASSES in cards.ts — that list only contains
// classes currently wired into the live game.

import { SPIDER_MAN_CLASS }      from './spiderman';
import { HULK_CLASS }            from './hulk';
import { CAPTAIN_AMERICA_CLASS } from './captain-america';
import { IRON_MAN_CLASS }        from './iron-man';
import { THOR_CLASS }            from './thor';
import { BLACK_WIDOW_CLASS }     from './black-widow';
import { HAWKEYE_CLASS }         from './hawkeye';
import { NICK_FURY_CLASS }       from './nick-fury';
import { WOLVERINE_CLASS }       from './wolverine';
import { CYCLOPS_CLASS }         from './cyclops';
import { GAMBIT_CLASS }          from './gambit';
import { ROGUE_CLASS }           from './rogue';
import { STORM_CLASS }           from './storm';
import { JEAN_GREY_CLASS }       from './jean-grey';
import { DEADPOOL_CLASS }        from './deadpool';

export const ALL_HERO_CLASSES = [
  SPIDER_MAN_CLASS,
  HULK_CLASS,
  CAPTAIN_AMERICA_CLASS,
  IRON_MAN_CLASS,
  THOR_CLASS,
  BLACK_WIDOW_CLASS,
  HAWKEYE_CLASS,
  NICK_FURY_CLASS,
  WOLVERINE_CLASS,
  CYCLOPS_CLASS,
  GAMBIT_CLASS,
  ROGUE_CLASS,
  STORM_CLASS,
  JEAN_GREY_CLASS,
  DEADPOOL_CLASS,
] as const;

export type HeroClassDef = typeof ALL_HERO_CLASSES[number];
