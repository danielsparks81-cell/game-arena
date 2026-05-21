import type { HeroCardDef } from '../types';

// Spider-Man hero class — Spider-Friends.
// All four cards cost 2-5, verified against physical cards.
// Distribution: 5 / 5 / 3 / 1 (common / common / uncommon / rare).

export const SPIDEY_ASTONISHING_STRENGTH: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_astonishing_strength',
  className: 'Spider-Man',
  cardName: 'Astonishing Strength',
  cost: 2,
  baseRecruit: 1,
  classes: ['strength'],
  teams: ['spider-friends'],
  text: '1 Recruit. Spider-Friends: +1 Recruit.',
  onPlay: [
    // Card IS Spider-Friends → need total ≥2.
    { kind: 'if_played_team_this_turn', team: 'spider-friends', minOthers: 2,
      effects: [{ kind: 'gain_recruit', amount: 1 }] },
  ],
};

export const SPIDEY_GREAT_RESPONSIBILITY: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_great_responsibility',
  className: 'Spider-Man',
  cardName: 'Great Responsibility',
  cost: 3,
  baseAttack: 1,
  classes: ['instinct'],
  teams: ['spider-friends'],
  text: '1 Attack. Spider-Friends: +1 Attack.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'spider-friends', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const SPIDEY_WEB_SHOOTERS: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_web_shooters',
  className: 'Spider-Man',
  cardName: 'Web-Shooters',
  cost: 4,
  baseRecruit: 1,
  classes: ['tech'],
  teams: ['spider-friends'],
  text: '1 Recruit. Spider-Friends: +1 Attack.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'spider-friends', minOthers: 2,
      effects: [{ kind: 'gain_attack', amount: 1 }] },
  ],
};

export const SPIDEY_AMAZING_SPIDER_MAN: HeroCardDef = {
  kind: 'hero',
  cardId: 'spidey_amazing_spider_man',
  className: 'Spider-Man',
  cardName: 'Amazing Spider-Man',
  cost: 5,
  baseRecruit: 1,
  classes: ['ranged'],
  teams: ['spider-friends'],
  text: '1 Recruit. Spider-Friends: +2 Recruit and +1 Attack.',
  onPlay: [
    { kind: 'if_played_team_this_turn', team: 'spider-friends', minOthers: 2,
      effects: [
        { kind: 'gain_recruit', amount: 2 },
        { kind: 'gain_attack',  amount: 1 },
      ] },
  ],
};

// Distribution: 5 / 5 / 3 / 1.
export const SPIDER_MAN_CLASS = {
  className: 'Spider-Man',
  cards: [
    { def: SPIDEY_ASTONISHING_STRENGTH,  copies: 5 },
    { def: SPIDEY_GREAT_RESPONSIBILITY,  copies: 5 },
    { def: SPIDEY_WEB_SHOOTERS,          copies: 3 },
    { def: SPIDEY_AMAZING_SPIDER_MAN,    copies: 1 },
  ],
};
