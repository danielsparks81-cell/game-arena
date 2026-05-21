import type { HeroCardDef } from '../types';

// Nick Fury hero class — S.H.I.E.L.D., Instinct/Ranged/Tech.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const NICK_FURY_HIGH_TECH_WEAPONRY: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_high_tech_weaponry',
  className: 'Nick Fury',
  cardName: 'High-Tech Weaponry',
  cost: 2,
  baseAttack: 2,
  classes: ['tech'],
  teams: ['shield-officer'],
  text: '2 Attack. Nick Fury: +1 Attack.',
  onPlay: [
    // This card IS a Nick Fury hero (counted). Need total ≥2 for another.
    { kind: 'if_played_hero_this_turn', heroName: 'Nick Fury', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const NICK_FURY_BATTLEFIELD_PROMOTION: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_battlefield_promotion',
  className: 'Nick Fury',
  cardName: 'Battlefield Promotion',
  cost: 3,
  classes: ['instinct'],
  teams: ['shield-officer'],
  text: 'Draw 2 cards. Nick Fury: +3 Recruit.',
  onPlay: [
    { kind: 'draw', amount: 2 },
    { kind: 'if_played_hero_this_turn', heroName: 'Nick Fury', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 3 }] },
  ],
};

export const NICK_FURY_LEGENDARY_COMMANDER: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_legendary_commander',
  className: 'Nick Fury',
  cardName: 'Legendary Commander',
  cost: 5,
  baseAttack: 0,
  baseAttackScales: true,
  classes: ['ranged'],
  teams: ['shield-officer'],
  text: '+1 Attack for each S.H.I.E.L.D. Officer hero you play this turn, including this one.',
  onPlay: [
    // Counts all shield-officer team cards (Nick Fury class cards).
    { kind: 'gain_attack_per_team', team: 'shield-officer', bonus: 1, includeSelf: true },
  ],
};

export const NICK_FURY_PURE_FURY: HeroCardDef = {
  kind: 'hero',
  cardId: 'nick_fury_pure_fury',
  className: 'Nick Fury',
  cardName: 'Pure Fury',
  cost: 6,
  baseRecruit: 5,
  classes: ['instinct'],
  teams: ['shield-officer'],
  text: '5 Recruit. Draw 2 cards.',
  onPlay: [
    { kind: 'draw', amount: 2 },
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
