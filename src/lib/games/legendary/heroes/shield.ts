import type { HeroCardDef } from '../types';

// S.H.I.E.L.D. starter cards — every player begins with 8 Troopers + 4 Agents.
// These never appear in the HQ; they're not "purchasable" heroes in the normal
// sense, just the chaff in your starting deck.

export const TROOPER: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_trooper',
  className: 'S.H.I.E.L.D.',
  cardName: 'S.H.I.E.L.D. Trooper',
  cost: 0,
  baseAttack: 1,
  classes: ['strength'],
  teams: ['shield-trooper'],
};

export const AGENT: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_agent',
  className: 'S.H.I.E.L.D.',
  cardName: 'S.H.I.E.L.D. Agent',
  cost: 0,
  baseRecruit: 1,
  classes: ['covert'],
  teams: ['shield-agent'],
};

export const SHIELD_CARDS = [TROOPER, AGENT];
