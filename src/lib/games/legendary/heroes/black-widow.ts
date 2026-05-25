import type { HeroCardDef } from '../types';

// Black Widow hero class — Avengers, Covert/Tech.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).
//
// Card text sourced from physical cards:
//
//   Mission Accomplished (cost 2, Tech):
//     Draw a card.
//     Covert: Rescue a Bystander.
//
//   Dangerous Rescue (cost 3, Covert):
//     2 Attack.
//     Strength: You may KO a card from your hand or discard pile.
//              If you do, rescue a Bystander.
//
//   Covert Operation (cost 4, Covert):
//     +1 Attack for each Bystander in your Victory Pile.
//
//   Silent Sniper (cost 7, Covert):
//     4 Attack.
//     You may fight a villain or mastermind that has a Bystander for free
//     (no Attack cost).

export const BW_MISSION_ACCOMPLISHED: HeroCardDef = {
  kind: 'hero',
  cardId: 'bw_mission_accomplished',
  className: 'Black Widow',
  cardName: 'Mission Accomplished',
  cost: 2,
  // No base Attack or Recruit — purely effect-driven.
  classes: ['tech'],
  teams: ['avengers'],
  text: 'Draw a card.\n[tech]: Rescue a Bystander.',
  onPlay: [
    { kind: 'draw', amount: 1 },
    // "[tech]:" requires another tech card played this turn (not counting this one).
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'rescue_bystander', amount: 1 }] },
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
  text: '[covert]: You may KO a card from your hand or discard pile. If you do, rescue a Bystander.',
  onPlay: [
    // "[covert]:" means you need ANOTHER covert card played this turn (not counting
    // this one). Since Dangerous Rescue IS Covert, minOthers: 2 = self(1) + other(1).
    { kind: 'if_played_class_this_turn', cls: 'covert', minOthers: 2,
      effects: [
        // sources: ['hand', 'discard'] — player may pick from either zone.
        { kind: 'ko_from_hand', up_to: 1,
          sources: ['hand', 'discard'],
          bonus: [{ kind: 'rescue_bystander', amount: 1 }] },
      ] },
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
  text: 'You get +1[strike] for each Bystander in your Victory Pile.',
  onPlay: [
    { kind: 'gain_attack_per_vp_bystander' },
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
  text: 'Defeat a Villain or Mastermind that has a Bystander.',
  onPlay: [
    { kind: 'grant_free_bystander_fight' },
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
