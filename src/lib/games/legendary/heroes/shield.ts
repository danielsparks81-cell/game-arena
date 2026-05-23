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
// The hero depicted is Maria Hill. Card name is 'S.H.I.E.L.D. Officer'.
// className 'Hero' — same as Trooper, Agent, and Sidekick for all game checks.
export const OFFICER: HeroCardDef = {
  kind: 'hero',
  cardId: 'shield_officer',
  className: 'Maria Hill',
  cardName: 'S.H.I.E.L.D. Officer',
  cost: 3,
  baseRecruit: 2,
  classes: [],
  teams: ['shield'],
};

// Sidekick — always available for purchase (pool of 30).
// Up to one may be recruited per turn via the pool (sidekickRecruited flag).
// Playing a Sidekick from hand lets you optionally return it to the stack
// and draw two cards; that does NOT consume the once-per-turn buy limit.
export const SIDEKICK: HeroCardDef = {
  kind: 'hero',
  cardId: 'sidekick',
  className: 'Hero',
  cardName: 'Sidekick',
  cost: 2,
  classes: [],
  teams: [],
  text: 'You may return this card to the Sidekick stack. If you do, draw two cards.',
  onPlay: [{ kind: 'optional_return_sidekick_draw_two' }],
};

export const SHIELD_CARDS = [TROOPER, AGENT, OFFICER, SIDEKICK];
