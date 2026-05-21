import type { HeroCardDef } from '../types';

// Black Widow hero class — Tech / Covert, Avengers.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
// Card names and costs verified against physical cards.
// Card text effects marked TODO — verify against physical cards.

export const BW_MISSION_ACCOMPLISHED: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_mission_accomplished',
  className: 'Black Widow',
  cardName: 'Mission Accomplished',
  cost: 2,
  // No base attack or recruit — effect-only card. TODO: verify card text.
  classes: ['tech'],
  teams: ['avengers'],
};

export const BW_DANGEROUS_RESCUE: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_dangerous_rescue',
  className: 'Black Widow',
  cardName: 'Dangerous Rescue',
  cost: 3,
  baseAttack: 2,
  classes: ['covert'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

export const BW_COVERT_OPERATION: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_covert_operation',
  className: 'Black Widow',
  cardName: 'Covert Operation',
  cost: 4,
  baseAttack: 0,
  baseAttackScales: true,   // renders as 0+⚔
  classes: ['covert'],
  teams: ['avengers'],
  // TODO: verify scaling condition from card text
};

export const BW_SILENT_SNIPER: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_silent_sniper',
  className: 'Black Widow',
  cardName: 'Silent Sniper',
  cost: 7,
  baseAttack: 4,
  classes: ['covert'],
  teams: ['avengers'],
  // TODO: verify any additional effect beyond the base strike
};

// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
export const BLACK_WIDOW_CLASS = {
  className: 'Black Widow',
  cards: [
    { def: BW_MISSION_ACCOMPLISHED, copies: 5 },
    { def: BW_DANGEROUS_RESCUE,     copies: 5 },
    { def: BW_COVERT_OPERATION,     copies: 3 },
    { def: BW_SILENT_SNIPER,        copies: 1 },
  ],
};
