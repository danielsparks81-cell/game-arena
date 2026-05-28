import type { HenchmanCardDef } from '../types';

// SENTINEL henchman group — 10 identical copies.
// Fight: KO one of your Heroes. (Mandatory — you must KO if you have a Hero card.)

export const SENTINEL: HenchmanCardDef = {
  kind: 'henchman',
  cardId: 'sentinel',
  name: 'Sentinel',
  attack: 3,
  vp: 1,
  team: 'sentinels',
  fight: [{ kind: 'ko_from_hand', filter: 'heroes_only', mandatory: true }],
  text: 'Fight: KO one of your Heroes.',
};

export const SENTINEL_GROUP = {
  groupId: 'sentinels',
  team: 'sentinels' as const,
  cards: [{ def: SENTINEL, copies: 10 }],
};
