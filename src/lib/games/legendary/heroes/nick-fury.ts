import type { HeroCardDef } from '../types';

// Nick Fury hero class — S.H.I.E.L.D., Tech/Covert/Strength.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const NICK_FURY_HIGH_TECH_WEAPONRY: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_high_tech_weaponry',
  className: 'Nick Fury',
  cardName: 'High-Tech Weaponry',
  cost: 3,
  baseAttack: 2,
  baseAttackScales: true,
  classes: ['tech'],
  teams: ['shield-officer'],
  text: '[tech]: You get +1[strike].',
  onPlay: [
    // Card IS Tech → need total ≥2 (at least 1 other Tech card played).
    { kind: 'if_played_class_this_turn', cls: 'tech', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const NICK_FURY_BATTLEFIELD_PROMOTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_battlefield_promotion',
  className: 'Nick Fury',
  cardName: 'Battlefield Promotion',
  cost: 4,
  classes: ['covert'],
  teams: ['shield-officer'],
  text: 'You may KO a [shield] Hero from your hand or discard pile. If you do, you may gain a S.H.I.E.L.D. Officer to your hand.',
  onPlay: [
    { kind: 'ko_from_hand', up_to: 1, filter: 'shield_heroes', sources: ['hand', 'discard'],
      bonus: [{ kind: 'gain_card_to_hand', cardId: 'shield_officer' }] },
  ],
};

export const NICK_FURY_LEGENDARY_COMMANDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_legendary_commander',
  className: 'Nick Fury',
  cardName: 'Legendary Commander',
  cost: 6,
  baseAttack: 1,
  baseAttackScales: true,
  classes: ['strength'],
  teams: ['shield-officer'],
  text: 'You get +1[strike] for each other [shield] Hero you played this turn.',
  onPlay: [
    // Card IS shield-officer → includeSelf: false subtracts itself, giving 0 when alone.
    { kind: 'gain_attack_per_team', team: 'shield-officer', bonus: 1, includeSelf: false },
  ],
};

export const NICK_FURY_PURE_FURY: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_pure_fury',
  className: 'Nick Fury',
  cardName: 'Pure Fury',
  cost: 8,
  classes: ['tech'],
  teams: ['shield-officer'],
  text: 'Defeat any Villain or Mastermind whose [strike] is less than the number of [shield] Heroes in the KO pile.',
  onPlay: [
    { kind: 'defeat_villain_under_shield_ko_count' },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const NICK_FURY_CLASS = {
  className: 'Nick Fury',
  cards: [
    { def: NICK_FURY_HIGH_TECH_WEAPONRY,     copies: 5 },
    { def: NICK_FURY_BATTLEFIELD_PROMOTION,  copies: 5 },
    { def: NICK_FURY_LEGENDARY_COMMANDER,    copies: 3 },
    { def: NICK_FURY_PURE_FURY,              copies: 1 },
  ],
};
