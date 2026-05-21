import type { HeroCardDef } from '../types';

// S.H.I.E.L.D. cards — starters + generic purchasable pool cards.
//
// Starting deck (per player):  8 Troopers + 4 Agents
// Always-available pool:       SHIELD Officer (buyable for 3★ anytime)
//                              Sidekick       (buyable for 1★ anytime)
//
// Starters never appear in the HQ. Officer / Sidekick sit in separate pools
// beside the board, purchasable any turn.

export const TROOPER: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_trooper',
  className: 'Hero',
  cardName: 'S.H.I.E.L.D. Trooper',
  cost: 0,
  baseAttack: 1,
  classes: [],
  teams: ['shield'],
};

export const AGENT: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_agent',
  className: 'Hero',
  cardName: 'S.H.I.E.L.D. Agent',
  cost: 0,
  baseRecruit: 1,
  classes: [],
  teams: ['shield'],
};

// S.H.I.E.L.D. Officer — always available for purchase (pool of 30).
// TODO: verify cost, stats, and text against physical cards.
export const OFFICER: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_officer',
  className: 'Hero',
  cardName: 'Maria Hill',
  cost: 3,
  baseRecruit: 2,
  classes: [],
  teams: ['shield'],
};

// Sidekick — always available for purchase (pool of 30).
// TODO: verify cost, stats, and text against physical cards.
export const SIDEKICK: HeroCardDef = {
  kind: 'hero',
  cardId: 'sidekick',
  className: 'S.H.I.E.L.D.',
  cardName: 'Sidekick',
  cost: 1,
  baseRecruit: 1,
  classes: ['instinct'],
  teams: ['shield'],
};

export const SHIELD_CARDS = [TROOPER, AGENT, OFFICER, SIDEKICK];
