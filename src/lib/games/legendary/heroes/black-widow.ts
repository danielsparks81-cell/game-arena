import type { HeroCardDef } from '../types';

// Black Widow hero class — Avengers, Covert/Tech.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const BW_MISSION_ACCOMPLISHED: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_mission_accomplished',
  className: 'Black Widow',
  cardName: 'Mission Accomplished',
  cost: 2,
  baseRecruit: 1,
  classes: ['tech'],
  teams: ['avengers'],
  text: 'Recruit. Covert: +1 Recruit.',
  onPlay: [
    { kind: 'if_played_class_this_turn', cls: 'covert', minOthers: 1,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
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
  text: '2 Attack. Rescue a Bystander.',
  onPlay: [
    { kind: 'rescue_bystander', amount: 1 },
  ],
};

export const BW_COVERT_OPERATION: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_covert_operation',
  className: 'Black Widow',
  cardName: 'Covert Operation',
  cost: 4,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['covert'],
  teams: ['avengers'],
  text: '+1 Attack for each Covert hero you play this turn, including this one.',
  onPlay: [
    { kind: 'gain_attack_per_class', cls: 'covert', bonus: 1, includeSelf: true },
  ],
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
  text: '4 Attack. Covert: +2 Attack.',
  onPlay: [
    // This card is Covert, so total must be ≥2 for "another Covert" to be true.
    { kind: 'if_played_class_this_turn', cls: 'covert', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 2 }] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const BLACK_WIDOW_CLASS = {
  className: 'Black Widow',
  cards: [
    { def: BW_MISSION_ACCOMPLISHED, copies: 5 },
    { def: BW_DANGEROUS_RESCUE,     copies: 5 },
    { def: BW_COVERT_OPERATION,     copies: 3 },
    { def: BW_SILENT_SNIPER,        copies: 1 },
  ],
};
