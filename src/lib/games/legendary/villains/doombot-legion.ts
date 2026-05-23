import type { VillainCardDef } from '../types';

// DOOMBOT LEGION — Dr. Doom's "Always Leads" group.
// Composition: ruthless robotic enforcers of Latveria.
//   3× Doombot Guard      (basic patrol units)
//   3× Doombot Elite      (mid-tier upgraded models)
//   1× Doom's Champion    (rare enforcer with ambush wound)

export const DOOMBOT_GUARD: VillainCardDef = {
  kind: 'villain',
  cardId: 'doombot_guard',
  name: 'Doombot Guard',
  attack: 3,
  vp: 1,
  team: 'doombot-legion',
  text: 'The streets of Latveria are never safe.',
};

export const DOOMBOT_ELITE: VillainCardDef = {
  kind: 'villain',
  cardId: 'doombot_elite',
  name: 'Doombot Elite',
  attack: 5,
  vp: 3,
  team: 'doombot-legion',
  text: 'Ambush: Each player discards a card from their hand.',
  ambush: [{ kind: 'discard_from_hand', up_to: 1, bonus: [] }],
};

export const DOOMS_CHAMPION: VillainCardDef = {
  kind: 'villain',
  cardId: 'dooms_champion',
  name: "Doom's Champion",
  attack: 7,
  vp: 4,
  team: 'doombot-legion',
  text: 'Ambush: Each player gains a Wound.',
  ambush: [{ kind: 'gain_wound' }],
};

export const DOOMBOT_LEGION_GROUP = {
  groupId: 'doombot-legion',
  team: 'doombot-legion' as const,
  cards: [
    { def: DOOMBOT_GUARD,    copies: 3 },
    { def: DOOMBOT_ELITE,    copies: 3 },
    { def: DOOMS_CHAMPION,   copies: 1 },
  ],
};
