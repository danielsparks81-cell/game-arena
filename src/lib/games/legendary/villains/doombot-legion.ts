import type { HenchmanCardDef } from '../types';

// DOOMBOT LEGION henchman group — Dr. Doom's "Always Leads" group.
// 10 identical henchman cards.
// Fight: look at top 2 cards of your deck, KO one, return the other.

export const DOOMBOT_HENCHMAN: HenchmanCardDef = {
  kind: 'henchman',
  cardId: 'doombot_henchman',
  name: 'Doombot Legion',
  attack: 3,
  vp: 1,
  team: 'doombot-legion',
  fight: [{ kind: 'look_top_two_ko_one_return_one' }],
  text: 'Fight: Look at the top two cards of your deck. KO one of them and put the other back.',
};

export const DOOMBOT_HENCHMAN_GROUP = {
  groupId: 'doombot_legion_henchman',
  team: 'doombot-legion' as const,
  cards: [{ def: DOOMBOT_HENCHMAN, copies: 10 }],
};
